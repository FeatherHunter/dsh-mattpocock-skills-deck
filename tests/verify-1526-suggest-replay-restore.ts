// tests/verify-1526-suggest-replay-restore.ts —— 门禁：切回后台会话时补出最后一组没上过屏的建议气泡（#1526，规格 #1525）
//
// 为什么要有这一扇：平台打开旧会话时把历史事件重放成 replace 通知，而取数层只认 append 增量
// （见 src/client/statusbar/suggestStream.ts 文件头），所以「在后台跑完一轮、当时没在看」的会话
// 切回来时，那组建议从来没上过屏、按会话缓存也是空的，用户就永远看不到它。#1525 定的补法是：
// 挂载后先看按会话缓存，缓存为空才读一次事件流快照，在历史重放里找最后一条「所在轮已收尾」的
// 建议调用，走既有交付通路补出一组；同一个会话被用户点走/关掉过就不再补。
//
// 这一扇钉住五件事：
//   ① 直接建流：重放里有已收尾的建议时只补最后一组，记 suggest.ready outcome=restored；
//   ② 重放尾部那一轮还没收尾时不补，等增量通路送来 turn/end 后正常交付一次；
//   ③ 重放里没有建议、参数坏、快照读不到、形状不认识时安静不做（只留能指路的日志）；
//   ④ 挂载后到达的 replace 仍然不冒泡（#1409 的既有断言不回归）；按会话缓存非空时不补；
//   ⑤ 挂载组件：缓存为空才补、补出的组走到既有上屏/关闭通路、关掉后本次运行内不再复活、
//      之后有新建议正常交付时关闭标记失效、两个会话互不串味；源码守卫仍是不落盘不加定时器不 retain。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1526-suggest-replay-restore.ts
// 断言数变化时同步 scripts/gate-map.mts 里 COMPLETION_RECORDED_GATES 的 verify-1526-suggest-replay-restore。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ROOT = path.resolve(__dirname, '..')
const imp = function (rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

const failures = []
let total = 0
function check(ok, label) {
  total++
  if (!ok) failures.push(label)
}
function tick() { return new Promise(function (resolve) { setTimeout(resolve, 0) }) }
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(function (line) { return line.trim().indexOf('//') !== 0 })
    .join('\n')
}

const A_ITEMS = [
  { intro: '甲一', prompt: '/a-one', reason: '理由甲一' },
  { intro: '甲二', prompt: '/a-two', reason: '理由甲二' },
]
const B_ITEMS = [
  { intro: '乙一', prompt: '/b-one', reason: '理由乙一' },
  { intro: '乙二', prompt: '/b-two', reason: '理由乙二' },
]
const PTC_ITEMS = {
  items: [
    { prompt: '/ptc-one', reason: 'PTC 里的第一条' },
    { prompt: '/ptc-two', reason: 'PTC 里的第二条' },
  ],
}

// 事件夹具：原生 tool/call 带轮次、参数是 JSON 文本；PTC 派发事件不带轮次、参数已是对象。
function callEvent(callId, turn, items) {
  return { type: 'tool/call', data: { turn: turn, step: 1, callId: callId, name: 'suggest_next_steps', arguments: JSON.stringify({ items: items }) } }
}
function ptcCallEvent(subCallId, args) {
  return { type: 'tool/ptc-dispatch-start', data: { rootCallId: 'call_root', parentCallId: 'call_root', subCallId: subCallId, name: 'suggest_next_steps', arguments: args } }
}
function startEvent(turn) { return { type: 'turn/start', data: { turn: turn, step: 1 } } }
function endEvent(turn) { return { type: 'turn/end', data: { turn: turn, reason: { kind: 'completed' } } } }

/** 抓日志：把内核的 isEnabled / log 换成测试替身，跑完必须 restore（否则后面的场景互相串味）。 */
function captureLog() {
  const records = []
  const prevEnabled = globalThis.isEnabled
  const prevLog = globalThis.log
  let enabled = true
  globalThis.isEnabled = function () { return enabled }
  globalThis.log = function (level, event, fields) { records.push({ level: level, event: event, fields: fields || {} }) }
  return {
    records: records,
    setEnabled: function (value) { enabled = value },
    restore: function () {
      if (prevEnabled === undefined) delete globalThis.isEnabled
      else globalThis.isEnabled = prevEnabled
      if (prevLog === undefined) delete globalThis.log
      else globalThis.log = prevLog
    },
  }
}
function rowsOf(records, event) { return records.filter(function (r) { return r.event === event }) }
function outcomesOf(records, event) { return rowsOf(records, event).map(function (r) { return r.fields.outcome }) }
function hasOutcome(records, event, outcome) { return outcomesOf(records, event).indexOf(outcome) >= 0 }
function flatItemTexts(records) {
  return records.map(function (items) { return (items || []).map(function (it) { return it.prompt }).join('|') }).join(' / ')
}

/** 假事件流：初始快照就是一次「历史重放」（replace 通知），append 后手动通知监听者。 */
function makeEnv(config) {
  const cfg = config || {}
  const initial = (cfg.entries || []).map(function (event) { return { event: event } })
  const env = {
    listeners: [],
    unsubscribed: 0,
    ready: [],
    bindingCalls: [],
    snapshot: { revision: 0, entries: initial, change: { kind: 'replace', entries: initial } },
    source: null,
    binding: null,
    sessions: null,
  }
  env.source = {
    subscribe: function (fn) {
      if (cfg.subscribeThrows) throw new Error('subscribe failed')
      env.listeners.push(fn)
      return function () {
        env.unsubscribed += 1
        const at = env.listeners.indexOf(fn)
        if (at >= 0) env.listeners.splice(at, 1)
      }
    },
    getSnapshot: function () {
      if (cfg.snapshotThrows) throw new Error('snapshot failed')
      return env.snapshot
    },
  }
  env.binding = { sessionId: cfg.sid || 'sid-A', session: {}, eventSource: env.source, ctx: {} }
  env.sessions = {
    binding: function (id) {
      env.bindingCalls.push(id)
      return env.binding
    },
  }
  env.notify = function (events, kind) {
    const entries = (events || []).map(function (event) { return { event: event } })
    env.snapshot = { revision: env.snapshot.revision + 1, entries: entries, change: { kind: kind || 'append', entries: entries } }
    const copy = env.listeners.slice()
    for (let i = 0; i < copy.length; i++) copy[i]()
  }
  env.onReady = function (items) { env.ready.push(items) }
  return env
}

async function main() {
  const facts = await imp('src/client/statusbar/suggestFacts.ts')
  const streamMod = await imp('src/client/statusbar/suggestStream.ts')

  // 取数层把「解析事件、解析参数、短散列」当相邻叶子的自由变量用（真机由构建闭包提供），这里接上真实现。
  globalThis.suggestHash = facts.suggestHash
  globalThis.suggestItemsOf = facts.suggestItemsOf
  globalThis.suggestEventOf = facts.suggestEventOf

  // ── ① 直接建流：从历史重放补出最后一组 ──
  const cap = captureLog()
  // 1) 两条都已收尾：只补最后一条，日志记 restored，不记 delivered。
  {
    const env = makeEnv({ entries: [startEvent(1), callEvent('his-a1', 1, A_ITEMS), endEvent(1), startEvent(2), callEvent('his-b1', 2, B_ITEMS), endEvent(2)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-A', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 1, '重放里两轮各有一条建议：只补出一组')
    check(env.ready.length === 1 && flatItemTexts(env.ready) === '/b-one|/b-two', '补出的是尾部最后一组建议，不是更早那组')
    check(hasOutcome(cap.records, 'suggest.ready', 'restored'), '补出的这一趟日志结论记 restored')
    check(outcomesOf(cap.records, 'suggest.ready').indexOf('delivered') < 0, '补出不算增量交付：日志里没有 delivered')
    check(hasOutcome(cap.records, 'suggest.bind', 'bound'), '照常借事件流订阅（补出不另开订阅）')
    // 9) 同一次调用再从增量到达：按既有去重不重复交付。
    env.notify([callEvent('his-b1', 3, B_ITEMS), endEvent(3)])
    check(env.ready.length === 1, '补出过的调用再从增量到达时不重复交付')
    check(hasOutcome(cap.records, 'suggest.call', 'dup'), '重复到达的调用在日志里记 dup')
    stream.dispose()
  }

  // 2) 尾部那一轮还没收尾：不补；等增量送来 turn/end 后正常交付一次（更早那条已收尾的不补）。
  {
    const env = makeEnv({ entries: [startEvent(1), callEvent('his-a2', 1, A_ITEMS), endEvent(1), startEvent(2), callEvent('his-b2', 2, B_ITEMS)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-B', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 0, '重放尾部那一轮还没收尾：先不补')
    check(hasOutcome(cap.records, 'suggest.ready', 'queued'), '没收尾的那条被收下等待整轮结束（日志记 queued）')
    env.notify([endEvent(2)])
    check(env.ready.length === 1 && flatItemTexts(env.ready) === '/b-one|/b-two', '增量送来 turn/end 后正常交付一次（交的是尾部那一组）')
    check(outcomesOf(cap.records, 'suggest.ready').indexOf('delivered') >= 0, '这一趟日志结论记 delivered（不是 restored）')
    check(flatItemTexts(env.ready).indexOf('/a-one') < 0, '更早那条已收尾的建议自始至终没有补出来')
    stream.dispose()
  }

  // 3) 重放里没有建议：安静不做。
  {
    const before = cap.records.length
    const env = makeEnv({ entries: [startEvent(1), endEvent(1)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-C', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 0, '重放里没有建议调用：不出气泡')
    const after = cap.records.slice(before)
    check(after.filter(function (r) { return r.event === 'suggest.ready' }).length === 0, '没有建议时连 ready 日志都不记（安静）')
    stream.dispose()
  }

  // 4) 参数坏：安静不做，只记能指路的日志（沿用既有 bad-args 结论）。
  {
    const badEvent = { type: 'tool/call', data: { turn: 1, step: 1, callId: 'his-bad', name: 'suggest_next_steps', arguments: '{oops' } }
    const env = makeEnv({ entries: [startEvent(1), badEvent, endEvent(1)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-D', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 0, '重放里那条调用的参数坏了：不出气泡')
    check(hasOutcome(cap.records, 'suggest.call', 'bad-args'), '坏参数在日志里记 bad-args')
    stream.dispose()
  }

  // 5) 快照读不到：安静不做，只记一条能指路的 bind 日志。
  {
    const env = makeEnv({ snapshotThrows: true, entries: [startEvent(1), callEvent('his-a5', 1, A_ITEMS), endEvent(1)] })
    let threw = false
    let stream = null
    try { stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-E', restoreReplay: true, onReady: env.onReady }) } catch (e) { threw = true }
    check(!threw, '读快照抛错不连累挂载（安静吞掉）')
    check(env.ready.length === 0, '读不到快照就不补，也不影响增量通路')
    check(hasOutcome(cap.records, 'suggest.bind', 'error') && rowsOf(cap.records, 'suggest.bind').some(function (r) { return r.fields.reason === 'restore-snapshot' }), '读快照失败在 bind 日志里留下原因 restore-snapshot')
    if (stream) stream.dispose()
  }

  // 5b) 订阅本身失败：按 #1409 的契约安静不做，也不补历史（没订上就别投递）。
  {
    const env = makeEnv({ subscribeThrows: true, entries: [startEvent(1), callEvent('his-a5b', 1, A_ITEMS), endEvent(1)] })
    const before = cap.records.filter(function (r) { return r.event === 'suggest.ready' }).length
    let threw = false
    let stream = null
    try { stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-E2', restoreReplay: true, onReady: env.onReady }) } catch (e) { threw = true }
    check(!threw, '订阅抛错不连累挂载（安静吞掉）')
    check(env.ready.length === 0, '事件流没借上时不补历史（不投递没有订阅的会话）')
    check(hasOutcome(cap.records, 'suggest.bind', 'error') && rowsOf(cap.records, 'suggest.bind').some(function (r) { return r.fields.reason === 'subscribe' }), '订阅失败在 bind 日志里留下原因 subscribe')
    const after = cap.records.filter(function (r) { return r.event === 'suggest.ready' }).length
    check(after === before, '没借上事件流时连 ready 日志都不记（不假装补出过）')
    if (stream) stream.dispose()
  }

  // 6) 挂载后到达的 replace 仍然不冒泡（#1409 既有断言不回归）。
  {
    const env = makeEnv({})
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-F', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 0, '空快照挂载时不出气泡')
    env.notify([startEvent(1), callEvent('late-replace', 1, A_ITEMS), endEvent(1)], 'replace')
    check(env.ready.length === 0, '挂载之后才到的历史重放（replace）仍然不出气泡')
    stream.dispose()
  }

  // 7) 上层说「缓存里已经有这一组」时（restoreReplay=false）不从重放补。
  {
    const env = makeEnv({ entries: [startEvent(1), callEvent('cached-a', 1, A_ITEMS), endEvent(1)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-G', restoreReplay: false, onReady: env.onReady })
    check(env.ready.length === 0, '按会话缓存非空时不从重放补（该显示哪组由缓存决定）')
    stream.dispose()
  }

  // 8) PTC 预设：重放里的派发事件不带轮次，靠它前面的 turn/start 补出来再补出一组。
  {
    const env = makeEnv({ entries: [startEvent(7), ptcCallEvent('ptc-his', PTC_ITEMS), endEvent(7)] })
    const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: 'sid-H', restoreReplay: true, onReady: env.onReady })
    check(env.ready.length === 1 && flatItemTexts(env.ready) === '/ptc-one|/ptc-two', '重放里的 PTC 调用也能补出（轮次由 turn/start 补）')
    check(hasOutcome(cap.records, 'suggest.ready', 'restored'), 'PTC 补出同样记 restored')
    stream.dispose()
  }

  cap.restore()

  // ── ② 挂载组件：缓存为空才补、关掉不复活、新建议后恢复、两个会话不串味 ──
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1:59519/',
    runScripts: 'dangerously',
  })
  const win = dom.window
  global.window = win
  global.document = win.document
  try { global.navigator = win.navigator } catch (eNav) {}
  global.Node = win.Node
  global.HTMLElement = win.HTMLElement
  global.getComputedStyle = win.getComputedStyle.bind(win)
  global.requestAnimationFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (cb) { return setTimeout(cb, 0) }
  global.cancelAnimationFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function (id) { clearTimeout(id) }
  win.React = React
  global.React = React
  const ReactDOMClient = require('react-dom/client')
  win.ReactDOM = ReactDOMClient
  global.ReactDOM = ReactDOMClient
  global.IS_REACT_ACT_ENVIRONMENT = true
  const act = React.act

  const dict = {
    'suggest.group': '下一步建议',
    'suggest.close': '关闭（等于一条都不选）',
    'suggest.ariaPill': '{prompt}；推荐理由：{reason}',
    'suggest.live': '有 {n} 条下一步建议',
  }
  function trFn(key, params) {
    let text = (dict[key] !== undefined) ? dict[key] : key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return (params[name] !== undefined) ? String(params[name]) : m
      })
    }
    return text
  }
  global.tr = trFn

  const appearanceMod = await imp('src/client/statusbar/suggestAppearance.ts')
  global.SUGGEST_Z = appearanceMod.SUGGEST_Z
  global.SUGGEST_APPEARANCE = appearanceMod.SUGGEST_APPEARANCE
  global.inject = function () {}
  global.PortalOverlay = function (props, children) { return React.createElement('div', props || {}, children) }
  const bubbleMod = await imp('src/client/statusbar/suggestBubble.ts')
  globalThis.SuggestBubble = bubbleMod.SuggestBubble

  const sources = {}
  function sourceForSid(sid, entries) {
    if (!sources[sid]) {
      const env = makeEnv({ sid: sid, entries: entries || [] })
      sources[sid] = env
    }
    return sources[sid]
  }
  function mountEnv(sid, entries) { sourceForSid(sid, entries) }
  const sessions = { binding: function (sid) { return { eventSource: sourceForSid(sid).source } } }
  const st = { injector: function () {} }
  const cxStub = { storeSvc: { useStore: function () { return st } }, ctx: { get: function (name) { return name === 'sessions' ? sessions : null } } }
  global.DswsCtx = React.createContext(cxStub)

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = ReactDOMClient.createRoot(host)
  function Host(props) { return React.createElement(streamMod.SuggestStreamMount, { sid: props.sid }) }
  async function showSid(sid) {
    await act(async function () {
      root.render(React.createElement(Host, { sid: sid }))
      await tick()
    })
  }
  async function append(sid, events) {
    await act(async function () {
      sourceForSid(sid).notify(events)
      await tick()
    })
  }
  function layer() { return document.querySelector('.dsws-sugg-layer') }
  function pills() { return Array.prototype.slice.call(document.querySelectorAll('.dsws-sugg-pill')) }
  function closeBtn() { return document.querySelector('.dsws-sugg-close') }
  function pillTexts() { return pills().map(function (node) { return node.textContent }) }
  function textHas(needle) { return pillTexts().join('|').indexOf(needle) >= 0 }

  const cap2 = captureLog()

  // a) 缓存为空 + 重放里有已收尾的建议：切回来直接补出最后一组。
  mountEnv('sid-m1', [startEvent(1), callEvent('m-a1', 1, A_ITEMS), endEvent(1), startEvent(2), callEvent('m-b1', 2, B_ITEMS), endEvent(2)])
  await showSid('sid-m1')
  check(layer() !== null, '切回这个会话时补出一组气泡（缓存原本是空的）')
  check(textHas('乙一') && !textHas('甲一'), '补出的是重放尾部最后一组建议')
  check(hasOutcome(cap2.records, 'suggest.ready', 'restored'), '挂载补出这一趟日志记 restored')

  // b) 按会话缓存里已经有这一组：显示缓存，不从重放另补。
  streamMod.suggestGroupRemember('sid-m2', { id: 77, items: A_ITEMS })
  mountEnv('sid-m2', [startEvent(1), callEvent('m-b2', 1, B_ITEMS), endEvent(1)])
  await showSid('sid-m2')
  check(layer() !== null && textHas('甲一') && !textHas('乙一'), '缓存非空时显示缓存里那一组，不从重放另补')
  {
    const before = cap2.records.filter(function (r) { return r.event === 'suggest.ready' && r.fields.outcome === 'restored' }).length
    await showSid('sid-m2')
    const after = cap2.records.filter(function (r) { return r.event === 'suggest.ready' && r.fields.outcome === 'restored' }).length
    check(after === before, '同一会话再挂载时缓存已在，不再走补出')
  }

  // c) 用户点关闭之后：本次运行内再切回来不补（关闭标记生效）。
  await showSid('sid-m1')
  const close = closeBtn()
  check(!!close, '补出的气泡上有整组关闭按钮（沿用既有界面通路）')
  if (close) await act(async function () { close.click(); await tick() })
  check(layer() === null, '点关闭后气泡立刻消失')
  await showSid('sid-m2')
  await showSid('sid-m1')
  check(layer() === null, '关掉之后本次运行内再切回同一会话，不再从重放补出来')

  // d) 这个会话之后有新建议正常交付：关闭标记失效，切走再切回按缓存找回这一组。
  await append('sid-m1', [startEvent(3), callEvent('m-new', 3, B_ITEMS), endEvent(3)])
  check(layer() !== null && textHas('乙一'), '关掉之后该会话来了新建议：照常交付并冒出气泡')
  check(hasOutcome(cap2.records, 'suggest.ready', 'delivered'), '新建议这一趟日志记 delivered')
  await showSid('sid-m2')
  await showSid('sid-m1')
  check(layer() !== null && textHas('乙一'), '新建议交付过之后切走再切回，按会话缓存放回这一组')

  // e) 两个会话各归各：m2 的补出/缓存不在 m1 上，m1 的也不串到 m2。
  await showSid('sid-m2')
  check(textHas('甲一') && !textHas('乙一'), '切到另一个会话时只显示它自己那一组')
  const m2Env = sourceForSid('sid-m2')
  await act(async function () { m2Env.notify([startEvent(2), callEvent('m2-new', 2, B_ITEMS), endEvent(2)]); await tick() })
  check(textHas('乙一') && !textHas('甲一'), '另一个会话收到自己的新建议时也只换它自己的气泡')

  await act(async function () { root.unmount() })
  cap2.restore()

  // ── ③ 源码守卫：补出只借只读快照，不落盘、不加定时器、不 retain ──
  const streamSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStream.ts'), 'utf8')
  const code = codeOnly(streamSrc)
  check(code.indexOf('restoreReplay') >= 0, '取数层接受「要不要从重放补」的开关（缓存非空时不补）')
  check(code.indexOf("change.kind !== 'replace'") >= 0, '补出只认历史重放（replace），增量通路仍只认 append')
  check(code.indexOf("deliver('restored'") >= 0, '补出走既有交付函数，日志结论是 restored')
  check(/const suggestDismissedBySid: any = new Set\(\)/.test(code), '按会话的关闭标记是模块级 Set（只在内存里）')
  check(code.indexOf('suggestSessionWasDismissed(sid)') >= 0, '补出前先看这个会话有没有被关掉过')
  check(code.indexOf('suggestSessionClearDismissed(sid)') >= 0, '有新建议正常交付时清掉关闭标记')
  check(code.indexOf('localStorage') < 0 && code.indexOf('readFileSync') < 0 && code.indexOf('writeFileSync') < 0, '补出与标记都不落盘')
  check(code.indexOf('setInterval') < 0 && code.indexOf('setTimeout') < 0, '补出不加任何定时器（不用计时器猜历史）')
  check(!/\.retain\(/.test(code) && code.indexOf('retainScope') < 0, '补出不碰会话保活接口（只读快照，不 retain）')
  check(code.indexOf('getSnapshot()') >= 0, '补出读一次事件流快照（沿用既有只读接口）')

  console.log('\n' + total + ' 条断言，' + (failures.length ? '失败' : '通过'))
  if (failures.length) failures.forEach(function (label) { console.log('  FAIL ' + label) })
  printGateResult('verify-1526-suggest-replay-restore', total, failures.length ? 1 : 0)
  process.exit(failures.length ? 1 : 0)
}

main().catch(function (e) { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
