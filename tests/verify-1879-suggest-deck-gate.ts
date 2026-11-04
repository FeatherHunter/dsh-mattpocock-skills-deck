#!/usr/bin/env node
/**
 * tests/verify-1879-suggest-deck-gate.ts —— #1879「关掉整个 deck 之后下一步建议气泡还在、且没有独立开关」的门禁。
 *
 * 这张票要三件事，这一份门禁逐件量：
 *   一、设置文件多一格 suggest（on 显示、off 不显示，缺省 on）。它和 #1612 那两格一样按工作区记，
 *      名字在核的名单里（名单外整份写入会被判未知键拒绝），写出去的时候带一行注释。
 *   二、气泡该不该显示只有一个判据：deck 没有收起，并且这个工作区的建议开关是开。收起包括两种 ——
 *      deck 工具箱关掉、胶囊状态栏被收起；两种都不显示。判据在 src/client/statusbar/suggestGate.ts 一处。
 *   三、关掉整个 deck 的那一刻，屏上那组建议按「已跳过」处理：清掉按会话的缓存，并写一份跨刷新的关闭标记；
 *      重新展开 deck、刷新页面都不再补出来。只收起胶囊、或只是把建议开关关掉，都只隐藏、不作废。
 *
 * 量的是真件：设置文件的读写用 src/host/configStore.ts 的真实现；deck 状态读口用
 *   src/client/kernel/deck-state.ts 的真实现（它读的那一格用一张假表喂）；判据与挂载组件用
 *   src/client/statusbar/suggestGate.ts 与 suggestStream.ts 的真实现，在 jsdom 里真挂一遍 React 树。
 *   只有界面基础函数（h、tr、PortalOverlay）与事件流是替身。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1879-suggest-deck-gate.ts
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ROOT = path.resolve(__dirname, '..')
const imp = function (rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }
const readText = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

let passed = 0
let failed = 0
function check(ok, msg, detail) {
  if (ok) { console.log('  PASS ' + msg); passed += 1 }
  else { failed += 1; console.log('  FAIL ' + msg + (detail === undefined ? '' : ' —— ' + String(detail).slice(0, 300))) }
}
function tick() { return new Promise(function (resolve) { setTimeout(resolve, 0) }) }

function callEvent(callId, turn, items) {
  return { type: 'tool/call', data: { turn: turn, step: 1, callId: callId, name: 'suggest_next_steps', arguments: JSON.stringify({ items: items }) } }
}
function startEvent(turn) { return { type: 'turn/start', data: { turn: turn, step: 1 } } }
function endEvent(turn) { return { type: 'turn/end', data: { turn: turn, reason: { kind: 'completed' } } } }

const ITEMS = [
  { intro: '甲一', prompt: '/a-one', reason: '理由甲一' },
  { intro: '甲二', prompt: '/a-two', reason: '理由甲二' },
]

/** 一份最小的合法设置文件文本：只给工作区节那几行，其余两节写成空表，读的时候由核补默认值。 */
function settingsText(wsLines) {
  return ['version: 1', 'ui: {}', 'workspaces:'].concat(wsLines || []).concat(['debug:', '  enabled: false', '  sampleRate: 1', 'templates: {}', '']).join('\n')
}

/** 假事件流：只提供取数层用到的那两个方法；append 把一批事件当成一次 append 增量通知订阅者。 */
function makeSource() {
  const listeners = []
  const api = {
    push(change) {
      api.snapshot = { change: change }
      listeners.slice().forEach(function (cb) { cb() })
    },
    append(events) {
      api.push({ kind: 'append', entries: events.map(function (event) { return { event: event } }) })
    },
    source: {
      subscribe(cb) {
        listeners.push(cb)
        return function () {
          const at = listeners.indexOf(cb)
          if (at >= 0) listeners.splice(at, 1)
        }
      },
      getSnapshot() { return api.snapshot },
    },
    snapshot: { change: null },
  }
  return api
}

async function main() {
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const { parseConfig, stringifyConfig } = core

  // ── 第一件事：设置文件认 suggest 这一格 ──
  console.log('')
  console.log('== 第一件事：设置文件里的 suggest（on 显示、off 不显示，缺省 on） ==')
  const parseSettings = function (text) { return parseConfig(text, 'settings') }
  const wsOf = function (ok) { return (ok && ok.ok === true) ? ok.value.workspaces : null }

  const defaultWs = wsOf(parseSettings(settingsText(['  D:\\ws\\demo:', '    statusBar: show'])))
  check(!!defaultWs && defaultWs['D:\\ws\\demo'].suggest === 'on', '文件里没写 suggest 时按缺省 on 补上（保持今天 deck 开着就显示的行为）。', JSON.stringify(defaultWs && defaultWs['D:\\ws\\demo']))
  const offWs = wsOf(parseSettings(settingsText(['  D:\\ws\\demo:', '    suggest: off'])))
  check(!!offWs && offWs['D:\\ws\\demo'].suggest === 'off', 'suggest: off 照读。', JSON.stringify(offWs && offWs['D:\\ws\\demo']))
  const onWs = wsOf(parseSettings(settingsText(['  D:\\ws\\demo:', '    suggest: on'])))
  check(!!onWs && onWs['D:\\ws\\demo'].suggest === 'on', 'suggest: on 照读。', JSON.stringify(onWs && onWs['D:\\ws\\demo']))
  const badWs = parseSettings(settingsText(['  D:\\ws\\demo:', '    suggest: yes']))
  check(badWs.ok === false && String(badWs.message || '').indexOf('suggest') >= 0, 'suggest 写成认不出的字面量（yes）按坏形状拒，并点名是哪个字段。', JSON.stringify(badWs))
  const boolWs = parseSettings(settingsText(['  D:\\ws\\demo:', '    suggest: true']))
  check(boolWs.ok === false, 'suggest 写成真假值也按坏形状拒（它不是布尔开关）。', JSON.stringify(boolWs))

  const wroteDoc = {
    version: 1,
    ui: {},
    workspaces: { 'D:\\ws\\demo': { statusBar: 'show', deckTools: 'on', suggest: 'off', noRepoDismissed: false, subwsMarkAutoShown: false } },
    debug: { enabled: false, sampleRate: 1 },
    templates: {},
  }
  const wrote = stringifyConfig(wroteDoc, 'settings')
  const wroteText = wrote.ok === true ? wrote.text : ''
  check(wrote.ok === true, '带 suggest: off 的设置文档能写出去。', wrote.ok ? '' : wrote.message)
  check(wroteText.indexOf('suggest: "off"') >= 0, '写出去的一份里出现 suggest: "off"（on/off 是 YAML 的保留词，必须带引号）。', wroteText.slice(0, 600))
  check(wroteText.indexOf('# 下一步建议气泡：on 显示、off 不显示（关掉只影响气泡，模型照常可以给建议）') >= 0, '写出去的那一行上面有一句看得懂的注释。', wroteText.slice(0, 600))
  const wroteBack = parseSettings(wroteText)
  check(wroteBack.ok === true && wroteBack.value.workspaces['D:\\ws\\demo'].suggest === 'off', '写出去再读回来，suggest 仍是 off（往返稳定）。', JSON.stringify(wroteBack.ok ? wroteBack.value.workspaces : wroteBack.message))

  // 临时记录（#1641）只写点过的格：没点过 suggest 时不种它。
  const tempWs = wsOf(parseSettings(settingsText(['  D:\\ws\\other:', '    statusBar: show', '    unopened: true'])))
  check(!!tempWs && tempWs['D:\\ws\\other'].suggest === undefined, '还没打开过的工作区那条临时记录不种 suggest（点过没点过靠格在不在判）。', JSON.stringify(tempWs && tempWs['D:\\ws\\other']))

  // ── 第二件事：deck 状态读口读得到 suggest，写口写得进 ──
  console.log('')
  console.log('== 第二件事：deck-state 的 suggest 读口与写口 ==')
  let flagTable = {}
  const reads = []
  const writes = []
  const emitted = []
  globalThis.viewFlagOf = function (cwd, name) {
    reads.push(String(cwd) + '|' + String(name))
    return flagTable[String(cwd) + '|' + String(name)]
  }
  globalThis.setViewFlagValue = function (cwd, name, value, listed) {
    writes.push({ cwd: String(cwd), name: String(name), value: value, listed: listed === true })
    return true
  }
  globalThis.keyOf = function (p) { return String(p == null ? '' : p).replace(/[\\/]+$/, '').toLowerCase() }
  globalThis.emit = function (st) { emitted.push(st) }
  globalThis.shared = { cwd: 'D:/ws/demo' }
  globalThis.stores = { s1: { cwd: 'D:/ws/demo/' }, s2: { cwd: 'D:/ws/other' } }
  const deckMod = await imp('src/client/kernel/deck-state.ts')
  check(typeof deckMod.deckSuggestOf === 'function' && typeof deckMod.setDeckSuggest === 'function', 'deck-state 导出了 suggest 的读口与写口。')
  flagTable = {}
  check(deckMod.deckSuggestOf('D:/ws/demo') === 'on', '文件里没有这一格时读口按开算（缺省显示）。')
  flagTable = { 'D:/ws/demo|suggest': 'off' }
  check(deckMod.deckSuggestOf('D:/ws/demo') === 'off', '文件里写着 off 时读口读到 off。')
  flagTable = { 'D:/ws/demo|suggest': 'wat' }
  check(deckMod.deckSuggestOf('D:/ws/demo') === 'on', '文件里是认不出的写法时按开算（不把用户没关的东西悄悄关掉）。')
  flagTable = {}
  writes.length = 0; emitted.length = 0
  const okWrite = deckMod.setDeckSuggest('D:/ws/demo', false)
  check(okWrite === true && writes.length === 1 && writes[0].name === 'suggest' && writes[0].value === 'off', 'setDeckSuggest(cwd,false) 把 suggest=off 交给写文件那条路。', JSON.stringify(writes))
  check(emitted.length === 2 && emitted.indexOf(globalThis.shared) >= 0 && emitted.indexOf(globalThis.stores.s1) >= 0 && emitted.indexOf(globalThis.stores.s2) < 0, '写完之后同一个工作区的会话各重画一次，别的工作区不碰。')
  writes.length = 0
  check(deckMod.setDeckSuggest('D:/ws/demo', true, true) === true && writes[0].value === 'on' && writes[0].listed === true, 'setDeckSuggest(cwd,true,true) 写 on，并把 listed 原样传给写口。', JSON.stringify(writes))

  // ── 第三件事：判据只有一条，四种组合逐条量 ──
  console.log('')
  console.log('== 第三件事：可见性判据 = deck 没有收起 且 建议开关为开 ==')
  // 判据自己用的三个读口接真实现：deckTools/statusBar/suggest 三格都从上面那张假表来。
  globalThis.isDeckCapsuleFolded = deckMod.isDeckCapsuleFolded
  globalThis.deckSuggestOf = deckMod.deckSuggestOf
  globalThis.isDeckClosed = deckMod.isDeckClosed
  const gateMod = await imp('src/client/statusbar/suggestGate.ts')
  const visibleOf = function (table) {
    flagTable = table
    return gateMod.suggestBubbleVisibleOf('D:/ws/demo')
  }
  check(visibleOf({ 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }) === true, 'deck 开着、开关开 → 显示。')
  check(visibleOf({ 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'off' }) === false, 'deck 开着、开关关 → 不显示。')
  check(visibleOf({ 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'hide', 'D:/ws/demo|suggest': 'on' }) === false, '只是胶囊收起（deck 工具箱仍开）→ 不显示。')
  check(visibleOf({ 'D:/ws/demo|deckTools': 'off', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }) === false, 'deck 工具箱关掉（胶囊开关仍是 show）→ 不显示。')
  check(visibleOf({ 'D:/ws/demo|deckTools': 'off' }) === false, 'deck 工具箱关掉、另外两格都缺省 → 不显示。')
  // 判据函数缺席（老产物、渲染替身）时按显示处理，行为与改动前一样。
  const savedFolded = globalThis.isDeckCapsuleFolded
  delete globalThis.isDeckCapsuleFolded
  flagTable = {}
  check(gateMod.suggestBubbleVisibleOf('D:/ws/demo') === true, '判据函数缺席时按显示处理（老产物里不藏气泡）。')
  globalThis.isDeckCapsuleFolded = savedFolded

  // ── 第四件事：真挂一遍 React 树，四条验收逐条走 ──
  console.log('')
  console.log('== 第四件事：挂载组件按判据显示，关 deck 时把屏上那组记为已跳过 ==')
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
  const win = dom.window
  global.window = win
  global.document = win.document
  try { global.navigator = win.navigator } catch (eNav) {}
  global.Node = win.Node
  global.HTMLElement = win.HTMLElement
  global.getComputedStyle = win.getComputedStyle.bind(win)
  global.requestAnimationFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (cb) { return setTimeout(cb, 0) }
  global.cancelAnimationFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function (id) { clearTimeout(id) }
  // 关闭标记住在 localStorage（#1853）：这一扇要能读回它，所以把 jsdom 那一份接到全局。
  global.localStorage = win.localStorage
  win.localStorage.clear()
  win.React = React
  global.React = React
  const ReactDOMClient = require('react-dom/client')
  global.ReactDOM = ReactDOMClient
  global.IS_REACT_ACT_ENVIRONMENT = true
  const act = React.act

  const dict = {
    'suggest.group': '下一步建议',
    'suggest.close': '关闭（等于一条都不选）',
    'suggest.label.score': '推荐分',
    'suggest.label.reason': '理由',
    'suggest.label.gain': '优点',
    'suggest.label.cost': '缺点',
    'suggest.live': '有 {n} 条下一步建议',
  }
  global.tr = function (key, params) {
    let text = (dict[key] !== undefined) ? dict[key] : key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) { return (params[name] !== undefined) ? String(params[name]) : m })
    }
    return text
  }
  const appearanceMod = await imp('src/client/statusbar/suggestAppearance.ts')
  global.SUGGEST_Z = appearanceMod.SUGGEST_Z
  global.SUGGEST_APPEARANCE = appearanceMod.SUGGEST_APPEARANCE
  global.MOTION = (await imp('src/client/kernel/motion.ts')).MOTION
  global.inject = function () {}
  global.PortalOverlay = function (props, children) { return React.createElement('div', props || {}, children) }
  const facts = await imp('src/client/statusbar/suggestFacts.ts')
  globalThis.suggestHash = facts.suggestHash
  globalThis.suggestItemsOf = facts.suggestItemsOf
  globalThis.suggestEventOf = facts.suggestEventOf
  const bubbleMod = await imp('src/client/statusbar/suggestBubble.ts')
  globalThis.SuggestBubble = bubbleMod.SuggestBubble
  const streamMod = await imp('src/client/statusbar/suggestStream.ts')
  // 判据钩子与它的三个缓存写口：真机里都在同一个闭包，这里按全局名字接上同一份实现。
  globalThis.useSuggestBubbleGate = gateMod.useSuggestBubbleGate
  globalThis.suggestBubbleVisibleOf = gateMod.suggestBubbleVisibleOf
  globalThis.suggestGroupRecall = streamMod.suggestGroupRecall
  globalThis.suggestGroupForget = streamMod.suggestGroupForget
  globalThis.suggestClosedRemember = streamMod.suggestClosedRemember

  const sources = {}
  function sourceFor(sid) { if (!sources[sid]) sources[sid] = makeSource(); return sources[sid] }
  const sessions = { binding: function (sid) { return { eventSource: sourceFor(sid).source } } }
  const st = { cwd: 'D:/ws/demo', injector: function () {} }
  const cxStub = { storeSvc: { useStore: function () { return st } }, ctx: { get: function (name) { return name === 'sessions' ? sessions : null } } }
  global.DswsCtx = React.createContext(cxStub)

  const host = win.document.createElement('div')
  win.document.body.appendChild(host)
  const root = ReactDOMClient.createRoot(host)
  function Host(props) { return React.createElement(streamMod.SuggestStreamMount, { sid: props.sid, cwd: 'D:/ws/demo' }) }
  let mountSeq = 0
  // 每次 show 都是一次重新挂载：真机上收起态与展开态是两棵不同的树，deck 状态一变 React 就会卸载再挂载。
  async function show(sid) {
    mountSeq += 1
    await act(async function () {
      root.render(React.createElement(Host, { key: 'm' + mountSeq, sid: sid }))
      await tick()
    })
  }
  async function append(sid, events) {
    await act(async function () { sourceFor(sid).append(events); await tick() })
  }
  function layer() { return win.document.querySelector('.dsws-sugg-layer') }
  function pills() { return Array.prototype.slice.call(win.document.querySelectorAll('.dsws-sugg-pill')) }
  function closedMarkOf(sid) {
    try {
      const raw = win.localStorage.getItem('dsws.suggestClosed')
      if (!raw) return ''
      const table = JSON.parse(raw)
      return (table && table[sid] && table[sid].callId) ? String(table[sid].callId) : ''
    } catch (e) { return '' }
  }

  // ① 今天的行为：deck 开着、开关开 → 气泡照常出现。
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-keep')
  await append('sid-keep', [startEvent(1), callEvent('call-keep', 1, ITEMS), endEvent(1)])
  check(layer() !== null && pills().length === 2, 'deck 开着、开关开时建议气泡照常出现（今天的行为没变）。', String(pills().length))

  // ② 只收起胶囊（deck 工具箱仍开）：不显示，但这组建议不作废，展开后显示最新一组。
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'hide', 'D:/ws/demo|suggest': 'on' }
  await show('sid-fold')
  await append('sid-fold', [startEvent(1), callEvent('call-fold', 1, ITEMS), endEvent(1)])
  check(layer() === null, '只是胶囊收起时气泡不显示。')
  check(streamMod.suggestGroupRecall('sid-fold') !== null, '收起期间新到的建议照常缓存（收起不等于跳过）。')
  check(closedMarkOf('sid-fold') === '', '收起不写跨刷新的关闭标记（只是隐藏）。')
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-fold')
  check(layer() !== null && pills().length === 2, '展开胶囊之后显示收起期间收到的最新一组。', String(pills().length))

  // ③ 只是关掉建议开关：不显示，重新打开开关又显示当前最新一组（只隐藏、不作废）。
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'off' }
  await show('sid-keep')
  check(layer() === null, '建议开关关掉之后气泡不显示。')
  check(streamMod.suggestGroupRecall('sid-keep') !== null, '开关关掉只是隐藏：这组建议还留着。')
  check(closedMarkOf('sid-keep') === '', '开关关掉不写关闭标记（不算跳过）。')
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-keep')
  check(layer() !== null && pills().length === 2, '重新打开开关，当前最新一组立刻回来。', String(pills().length))

  // ④ 关掉整个 deck：屏上那组记为已跳过，重新展开与刷新都不补。
  flagTable = { 'D:/ws/demo|deckTools': 'off', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-keep')
  check(layer() === null, 'deck 工具箱关掉之后气泡不显示。')
  check(streamMod.suggestGroupRecall('sid-keep') === null, '关 deck 时屏上那组已经从按会话的缓存里清掉。')
  check(closedMarkOf('sid-keep') === 'call-keep', '同时写了跨刷新的关闭标记（会话号 + 那条调用的编号），刷新后才挡得住历史重放。', closedMarkOf('sid-keep'))
  check(streamMod.suggestSessionWasDismissed('sid-keep') === true, '内存里也记下了「这个会话这组已跳过」，同一次会话里不再补出。')
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-keep')
  check(layer() === null, '重新展开 deck 也不把这组补出来（关 deck 等于这次建议已跳过）。')

  // ⑤ 关闭期间闸门生效前已经发出、关掉之后才到的那一组：按已跳过处理，不在重新打开时补出来。
  flagTable = { 'D:/ws/demo|deckTools': 'off', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-late')
  await append('sid-late', [startEvent(1), callEvent('call-late', 1, ITEMS), endEvent(1)])
  check(layer() === null && streamMod.suggestGroupRecall('sid-late') === null, '关闭期间才到的一组也按已跳过处理（不进缓存、不上屏）。')
  check(closedMarkOf('sid-late') === 'call-late', '这一组同样写了跨刷新的关闭标记。', closedMarkOf('sid-late'))
  flagTable = { 'D:/ws/demo|deckTools': 'on', 'D:/ws/demo|statusBar': 'show', 'D:/ws/demo|suggest': 'on' }
  await show('sid-late')
  check(layer() === null, '重新展开 deck 也不补出关闭期间到达的那一组。')

  // ⑥ 刷新之后：内存里的组缓存与内存关闭标记都没了，只剩 localStorage 那份关闭标记。
  //    这里另起一份全新的取数层实例（相当于刷新页面后的模块状态），喂它一份「历史里有这条调用」的事件窗口：
  //    补出逻辑要认得出这条调用的关闭标记并跳过；把标记去掉再跑一遍，同一份历史就会补出来（反证）。
  const freshStreamMod = await import(pathToFileURL(path.join(ROOT, 'src/client/statusbar/suggestStream.ts')).href + '?refresh=1879')
  const replayEntries = [
    { event: startEvent(1) },
    { event: callEvent('call-keep', 1, ITEMS) },
    { event: endEvent(1) },
  ]
  const replaySource = {
    subscribe: function () { return function () {} },
    getSnapshot: function () { return { entries: replayEntries } },
  }
  const replayProbe = function (sid) {
    let restored = 0
    const stream = freshStreamMod.createSuggestStream({
      sessions: { binding: function () { return { eventSource: replaySource } } },
      sid: sid,
      restoreReplay: true,
      onReady: function () { restored += 1 },
    })
    try { stream.dispose() } catch (e) {}
    return restored
  }
  check(replayProbe('sid-keep') === 0, '刷新之后（内存缓存与内存标记都没了）历史重放里那一组被跨刷新的关闭标记挡住，不再补出来。')
  win.localStorage.removeItem('dsws.suggestClosed')
  check(replayProbe('sid-keep') === 1, '反证：把那份关闭标记去掉，同一份历史重放就会把这组补出来（挡住它的确实是这条标记）。')
  // 收尾：后面接线的断言与这份标记无关，清掉不影响。
  win.localStorage.clear()

  await act(async function () { root.unmount() })

  // ── 第五件事：关掉建议开关不影响工具闸门（模型照常可以调用 suggest_next_steps） ──
  console.log('')
  console.log('== 第五件事：建议开关只管界面气泡，不收走模型工具 ==')
  const hostGate = await imp('src/host/deckToolGate.ts')
  const onlySuggestOff = hostGate.deckSwitchesOf({ workspaces: { 'D:/ws/demo': { statusBar: 'show', deckTools: 'on', suggest: 'off' } } })
  check(onlySuggestOff.known === true && onlySuggestOff.offKeys.length === 0, '把建议开关关掉之后，宿主的 deck 工具闸门里这个工作区不是「关」，suggest_next_steps 照常可用。', JSON.stringify(onlySuggestOff))
  const deckToolsOff = hostGate.deckSwitchesOf({ workspaces: { 'D:/ws/demo': { statusBar: 'show', deckTools: 'off', suggest: 'on' } } })
  check(deckToolsOff.known === true && deckToolsOff.offKeys.length === 1, '真正关掉 deck 工具箱时闸门照旧认得出（这条判据没有被我改松）。', JSON.stringify(deckToolsOff))

  // ── 第六件事：接线（状态栏把 cwd 交给挂载组件，判据登记进构建） ──
  console.log('')
  console.log('== 第六件事：接线 ==')
  const statusBarSrc = readText('src/client/statusbar/StatusBar.ts')
  check(statusBarSrc.indexOf('SuggestStreamMount, { sid: sid, cwd: s.cwd }') >= 0, '状态栏两处挂载都把 cwd 交给取数组件（判据要靠它读本工作区的开关）。')
  const streamSrc = readText('src/client/statusbar/suggestStream.ts')
  check(streamSrc.indexOf('useSuggestBubbleGate(props, group, setGroup)') >= 0 && streamSrc.indexOf('if (!group || !visible) return null') >= 0, '挂载组件问判据钩子，并在不该显示时不画气泡。')
  const gateSrc = readText('src/client/statusbar/suggestGate.ts')
  check(gateSrc.indexOf('isDeckCapsuleFolded') >= 0 && gateSrc.indexOf('deckSuggestOf') >= 0, '判据真的由「deck 收没收起」和「建议开关」合成。')
  const indexSrc = readText('src/client/index.ts')
  const buildSrc = readText('scripts/build.mts')
  check(indexSrc.indexOf('// ==== leaf:suggestGate (spliced by build) ====') >= 0, '客户端入口有这一叶的拼接标记。')
  check(buildSrc.indexOf("file: 'src/client/statusbar/suggestGate.ts'") >= 0, '构建清单登记了这一叶（不登记会静默不编译）。')
  const wsSrc = readText('src/client/views/SettingsWorkspaces.ts')
  check(wsSrc.indexOf("'settings.workspaces.suggest'") >= 0 && wsSrc.indexOf('setDeckSuggest') >= 0, '设置页工作区行画出了第三颗开关，并接到 suggest 的写口。')

  console.log('')
  console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条。')
  printGateResult('verify-1879-suggest-deck-gate', passed + failed, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
