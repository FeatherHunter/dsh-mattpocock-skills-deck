// tests/verify-1451-suggest-session-keep.ts —— 门禁：建议气泡按会话保留（#1451 后续）
//
// 为什么要有这一扇：平台打开旧会话时把历史事件重放成 replace 通知，而取数层只认 append 增量
// （见 src/client/statusbar/suggestStream.ts 文件头），所以「切走再切回来」时历史里那几次
// 建议调用不会再交付一遍。取数层因此在内存里按会话留了一份建议组：切回来要能放回原位，
// 用户显式点走或关掉的不许复活，留的份数有上限、不许无限涨。
//
// 这一扇钉住四件事：
//   ① 三个缓存纯函数的语义（取回同一组、同会话覆盖、忘掉、空会话名忽略、超上限删最早记入的）；
//   ② 挂载组件的行为（A 有建议 → 切 B 不串味 → B 有自己的 → 切回 A 原组回来 → 关掉后不再复活）；
//   ③ 用户点走一条也要忘掉（同关闭按钮一条路）；
//   ④ 源码守卫：缓存只在内存里（Map）、不落盘、不加定时器，组件里接的是这三个函数。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1451-suggest-session-keep.ts
// 断言数变化时同步 scripts/gate-map.mts 里 COMPLETION_RECORDED_GATES 的 verify-1451-suggest-session-keep。
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

function callEvent(callId, turn, items) {
  return { type: 'tool/call', data: { turn: turn, step: 1, callId: callId, name: 'suggest_next_steps', arguments: JSON.stringify({ items: items }) } }
}
function startEvent(turn) { return { type: 'turn/start', data: { turn: turn, step: 1 } } }
function endEvent(turn) { return { type: 'turn/end', data: { turn: turn, reason: { kind: 'completed' } } } }

const A_ITEMS = [
  { intro: '甲一', prompt: '/a-one', reason: '理由甲一' },
  { intro: '甲二', prompt: '/a-two', reason: '理由甲二' },
]
const B_ITEMS = [
  { intro: '乙一', prompt: '/b-one', reason: '理由乙一' },
  { intro: '乙二', prompt: '/b-two', reason: '理由乙二' },
]

/** 假事件流：只提供取数层用到的那两个方法；append 把一批事件当成一次 append 增量通知订阅者。 */
function makeSource() {
  const listeners = []
  const api = {
    push(change) {
      const snapshot = { change: change }
      api.snapshot = snapshot
      listeners.slice().forEach(function (cb) { cb() })
    },
    append(events) {
      api.push({ kind: 'append', entries: events.map(function (event) { return { event: event } }) })
    },
    listenerCount() { return listeners.length },
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

  // 词表：与 config/copy/panel.yaml 的 suggest.* 同形；键缺了按键名回退（和真 tr 一致）。
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
  // #1236：动画时长住在 kernel/motion.ts 的 MOTION 里（样式叶子求值时要用）。
  const motionMod = await imp('src/client/kernel/motion.ts')
  global.MOTION = motionMod.MOTION
  const injectCalls = []
  global.inject = function (st, text) { injectCalls.push({ st: st, text: text }) }
  global.PortalOverlay = function (props, children) { return React.createElement('div', props || {}, children) }

  // 取数层把「解析事件、解析参数」当相邻叶子的自由变量用（真机由构建闭包提供），这里接上真实现。
  const facts = await imp('src/client/statusbar/suggestFacts.ts')
  globalThis.suggestHash = facts.suggestHash
  globalThis.suggestItemsOf = facts.suggestItemsOf
  globalThis.suggestEventOf = facts.suggestEventOf
  const streamMod = await imp('src/client/statusbar/suggestStream.ts')
  const bubbleMod = await imp('src/client/statusbar/suggestBubble.ts')
  // 取数层把建议气泡的渲染薄壳当相邻叶子的自由变量用（真机由构建闭包按次序拼进来）。
  globalThis.SuggestBubble = bubbleMod.SuggestBubble

  // ---------- ① 三个缓存纯函数的语义 ----------
  {
    const g1 = { id: 1, items: A_ITEMS }
    const g2 = { id: 2, items: B_ITEMS }
    check(streamMod.suggestGroupRecall('cache-empty') === null, '没记过的会话取回 null')
    streamMod.suggestGroupRemember('cache-a', g1)
    check(streamMod.suggestGroupRecall('cache-a') === g1, '记下后再取回的是同一组（不是拷贝）')
    streamMod.suggestGroupRemember('cache-a', g2)
    check(streamMod.suggestGroupRecall('cache-a') === g2, '同一个会话再记一次会覆盖旧的')
    streamMod.suggestGroupForget('cache-a')
    check(streamMod.suggestGroupRecall('cache-a') === null, '忘掉之后取回 null')
    streamMod.suggestGroupRemember('', g1)
    check(streamMod.suggestGroupRecall('') === null, '空会话名不记（也取不到）')
    streamMod.suggestGroupForget('')
    const ids = []
    for (let i = 0; i < 32; i++) {
      const sid = 'cache-limit-' + i
      ids.push(sid)
      streamMod.suggestGroupRemember(sid, { id: i + 1, items: A_ITEMS })
    }
    streamMod.suggestGroupRemember('cache-limit-0', { id: 100, items: A_ITEMS })
    streamMod.suggestGroupRemember('cache-limit-32', { id: 101, items: A_ITEMS })
    check(streamMod.suggestGroupRecall('cache-limit-0') !== null, '重记过的会话刷新到队尾，超上限时不被删')
    check(streamMod.suggestGroupRecall('cache-limit-1') === null, '超过上限时删掉最早记入的那一组')
    check(streamMod.suggestGroupRecall('cache-limit-2') !== null && streamMod.suggestGroupRecall('cache-limit-32') !== null, '其余会话的组都还在')
    ids.forEach(function (sid) { streamMod.suggestGroupForget(sid) })
    streamMod.suggestGroupForget('cache-limit-32')
  }

  // ---------- ② 挂载组件：A 有、切 B 不串味、B 有、切回 A 原组回来 ----------
  const sources = {}
  function sourceForSid(sid) {
    if (!sources[sid]) sources[sid] = makeSource()
    return sources[sid]
  }
  const sessions = { binding(sid) { return { eventSource: sourceForSid(sid).source } } }
  const st = { injector: function () {} }
  const cxStub = { storeSvc: { useStore: function () { return st } }, ctx: { get: function (name) { return name === 'sessions' ? sessions : null } } }
  global.DswsCtx = React.createContext(cxStub)

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = ReactDOMClient.createRoot(host)
  function Host(props) {
    return React.createElement(streamMod.SuggestStreamMount, { sid: props.sid })
  }
  async function showSid(sid) {
    await act(async function () {
      root.render(React.createElement(Host, { sid: sid }))
      await tick()
    })
  }
  async function append(sid, events) {
    await act(async function () {
      sourceForSid(sid).append(events)
      await tick()
    })
  }
  function layer() { return document.querySelector('.dsws-sugg-layer') }
  function pills() { return Array.prototype.slice.call(document.querySelectorAll('.dsws-sugg-pill')) }
  function closeBtn() { return document.querySelector('.dsws-sugg-close') }
  function pillTexts() { return pills().map(function (node) { return node.textContent }) }
  function textHas(needle) { return pillTexts().join('|').indexOf(needle) >= 0 }

  await showSid('sid-A')
  check(layer() === null, '刚打开会话、还没有建议时不出气泡')
  await append('sid-A', [startEvent(1), callEvent('call-A1', 1, A_ITEMS), endEvent(1)])
  check(pills().length === 2, 'A 会话收到建议后出现两颗选项')
  check(textHas('甲一') && textHas('甲二'), 'A 会话显示的是 A 自己的两条建议')

  await showSid('sid-B')
  check(layer() === null, '切到 B 会话时 A 的气泡不留在 B 上')
  check(sourceForSid('sid-A').listenerCount() === 0, '切走后 A 的事件流订阅已经退掉')

  await append('sid-B', [startEvent(1), callEvent('call-B1', 1, B_ITEMS), endEvent(1)])
  check(pills().length === 2 && textHas('乙一') && !textHas('甲一'), 'B 会话只显示 B 自己的建议')

  await showSid('sid-A')
  check(layer() !== null, '切回 A 会话时上次那组建议放回来了')
  check(textHas('甲一') && !textHas('乙一'), '放回来的是 A 的原组，不是 B 的')

  await showSid('sid-B')
  check(textHas('乙一'), '再切到 B 会话，B 的组也还在')

  // ---------- ③ 关掉 / 点走之后不再复活 ----------
  await showSid('sid-A')
  const close = closeBtn()
  check(!!close, 'A 的气泡上有整组关闭按钮')
  await act(async function () { close.click(); await tick() })
  check(layer() === null, '点关闭后气泡立刻消失')
  await showSid('sid-B')
  await showSid('sid-A')
  check(layer() === null, '关掉 A 的组后再切走切回，A 不再自己冒出来')

  await showSid('sid-B')
  const firstPill = pills()[0]
  check(!!firstPill, 'B 的气泡选项在（点走一条的用例）')
  await act(async function () { firstPill.click(); await tick() })
  check(layer() === null, '点走一条后整组消失')
  check(injectCalls.length === 1 && injectCalls[0].text === '/b-one', '点走的那条提示词交给了注入口子')
  await showSid('sid-A')
  await showSid('sid-B')
  check(layer() === null, '点走的组也算用完：切走切回 B 不再复活')

  await act(async function () { root.unmount() })

  // ---------- ④ 源码守卫：只在内存、不加定时器、组件里接的是这三个函数 ----------
  const streamSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStream.ts'), 'utf8')
  const code = codeOnly(streamSrc)
  check(/const suggestGroupsBySid: any = new Map\(\)/.test(code), '按会话的缓存是一张模块级 Map（只在内存里）')
  check(code.indexOf('localStorage') < 0 && code.indexOf('readFileSync') < 0 && code.indexOf('writeFileSync') < 0, '建议组不落盘')
  check(code.indexOf('setInterval') < 0 && code.indexOf('setTimeout') < 0, '不新增常驻定时器（保留/丢弃都不靠计时器）')
  check(code.indexOf('suggestGroupRemember(sid, next)') >= 0, '新建议上屏前先记进按会话的缓存')
  check(code.indexOf('suggestGroupRecall(sid)') >= 0 && code.indexOf('React.useState(function () { return suggestGroupRecall(sid) })') >= 0, '挂载时与换会话时都从缓存取回')
  check(code.indexOf('suggestGroupForget(sid)') >= 0, '用户关掉/点走时忘掉这个会话的组')
  check(!/\.retain\(/.test(code) && code.indexOf('retainScope') < 0, '缓存不碰会话保活接口（只借订阅不 retain）')

  console.log('\n' + total + ' 条断言，' + (failures.length ? '失败' : '通过'))
  if (failures.length) failures.forEach(function (label) { console.log('  FAIL ' + label) })
  printGateResult('verify-1451-suggest-session-keep', total, failures.length ? 1 : 0)
  process.exit(failures.length ? 1 : 0)
}

main().catch(function (e) { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
