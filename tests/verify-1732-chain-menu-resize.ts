#!/usr/bin/env node
// verify-1732-chain-menu-resize.ts —— 门禁：#1732 在办单子开着时窗口大小变了，高度跟着重算、末行重新贴底
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1732-chain-menu-resize.ts
// 门禁归属: src/client/statusbar/StatusMenus.ts
// 验证（每条都能被删掉/改坏而红）：
//   1) 什么都没开时，钩子不挂任何监听（effect 返回 undefined）。
//   2) 只有「在办单子」开着时，钩子也会挂上 window 的 resize 监听。
//   3) resize 时 emit 一次（让胶囊按新窗口重算高度），下一帧把在办单子滚到末行。
//   4) 同一帧里 resize 连发多次，只重算一次。
//   5) 在办单子自己滚起来时（scroll 事件）：不 emit、也不拽回末行 —— 否则用户滚不动。
//   6) 卸载时清掉监听与待执行的那一帧。
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'

let passed = 0, failed = 0
function check(cond: any, msg: string) { if (cond) { passed++; console.log('  PASS ' + msg) } else { failed++; console.log('  FAIL ' + msg) } }

// —— 按文本求值加载 StatusMenus 叶子：与别的门禁同一做法，闭包里才有的名字（React / emit）在这里补桩。
const leafSrc = spliceableJs('src/client/statusbar/StatusMenus.js').replace(/^[ \t]*export[ \t]+/gm, '')
const effects: any[] = []
const emitted: any[] = []
const React = { useEffect: function (fn: any, deps: any) { effects.push({ fn: fn, deps: deps }) } }
const emit = function (s: any) { emitted.push(s) }
const leaf = compileFn(['React', 'emit', 'STATUS_MENU_FALLBACK_DELAY_MS'], leafSrc + '\nreturn { useStatusMenus }')(React, emit, 160)

// —— 浏览器侧的桩：只记监听与下一帧，不真跑 React 渲染。
const listeners: any = { window: {}, document: {} }
const fakeMenu = { scrollTop: 0, scrollHeight: 640 }
const fakeDom = {
  querySelector: function (sel: any) { return sel === '.dsws-chainmenu' ? fakeMenu : null },
  addEventListener: function (type: any, fn: any) { listeners.document[type] = fn },
  removeEventListener: function (type: any) { delete listeners.document[type] },
}
const fakeWin = {
  innerHeight: 700,
  addEventListener: function (type: any, fn: any) { listeners.window[type] = fn },
  removeEventListener: function (type: any) { delete listeners.window[type] },
}
function FakeResizeObserver(this: any, cb: any) { this.cb = cb }
FakeResizeObserver.prototype.observe = function () {}
FakeResizeObserver.prototype.disconnect = function () {}

const frames = new Map()
let nextFrameId = 1
const rafStub = function (fn: any) { const id = nextFrameId++; frames.set(id, fn); return id }
const cafStub = function (id: any) { frames.delete(id) }
function flushFrames() {
  // 一帧里排出来的下一帧（滚动要等重渲染把高度写进 DOM 之后才量）也要接着跑完，最多十轮防死循环。
  for (let round = 0; round < 10 && frames.size; round++) {
    const all = Array.from(frames.entries())
    frames.clear()
    all.forEach(function (pair: any) { pair[1](0) })
  }
}

const g = globalThis as any
const saved = { window: g.window, document: g.document, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame, ResizeObserver: g.ResizeObserver }
g.window = fakeWin
g.document = fakeDom
g.requestAnimationFrame = rafStub
g.cancelAnimationFrame = cafStub
g.ResizeObserver = FakeResizeObserver

function mount(s: any) {
  effects.length = 0
  const refs = {
    bugAnchorRef: { current: null }, backendAnchorRef: { current: null }, takeAnchorRef: { current: null },
    bugCloseRef: { current: null }, backendCloseRef: { current: null }, takeCloseRef: { current: null },
  }
  leaf.useStatusMenus(s, refs)
  return effects[0]
}
function resetWorld() {
  listeners.window = {}; listeners.document = {}
  frames.clear(); emitted.length = 0
  fakeMenu.scrollTop = 0; fakeMenu.scrollHeight = 640; fakeWin.innerHeight = 700
}
const allClosed = { bugMenuOpen: false, backendMenuOpen: false, takeMenuOpen: false, chainMenuOpen: false }
const chainOnly = { bugMenuOpen: false, backendMenuOpen: false, takeMenuOpen: false, chainMenuOpen: true, chainMenuPos: { left: 8, bottom: 24 } }

console.log('#1732：在办单子跟着窗口大小重算高度')

// 1) 什么都没开：不挂监听。
resetWorld()
let entry = mount(allClosed)
let cleanup = entry.fn()
check(cleanup === undefined, '什么都没开时 effect 返回 undefined（不挂监听）')
check(!listeners.window.resize && !listeners.document.scroll, '什么都没开时没挂 resize / scroll 监听')

// 2) 只有在办单子开着：照样挂 resize，并在打开那一帧 emit 一次、滚到末行。
resetWorld()
entry = mount(chainOnly)
cleanup = entry.fn()
check(typeof listeners.window.resize === 'function', '只有在办单子开着时也挂上 window 的 resize 监听')
check(typeof listeners.document.scroll === 'function', '只有在办单子开着时也挂上 document 的 scroll 监听')
flushFrames()
check(emitted.length === 1, '打开那一帧 emit 一次（胶囊按新窗口重算高度）')
check(fakeMenu.scrollTop === fakeMenu.scrollHeight, '打开那一帧把在办单子滚到末行（末行贴底）')

// 3) 窗口变矮：高度要重算（emit），末行仍贴底。
fakeMenu.scrollTop = 100
fakeMenu.scrollHeight = 900
fakeWin.innerHeight = 500
listeners.window.resize({ type: 'resize' })
flushFrames()
check(emitted.length === 2, '窗口大小变了再 emit 一次（高度跟着重算）')
check(fakeMenu.scrollTop === 900, '窗口变矮后重新滚到末行（末行贴底）')

// 4) 同一帧里 resize 连发多次，只重算一次。
listeners.window.resize({ type: 'resize' })
listeners.window.resize({ type: 'resize' })
flushFrames()
check(emitted.length === 3, '同一帧里 resize 连发多次只重算一次')

// 5) 单子自己滚起来：不 emit、不拽回末行。
fakeMenu.scrollTop = 120
listeners.document.scroll({ type: 'scroll', target: fakeMenu })
flushFrames()
check(emitted.length === 3, '单子自己滚动时不 emit（不打断用户翻看）')
check(fakeMenu.scrollTop === 120, '单子自己滚动时不拽回末行（用户滚得动）')

// 6) 卸载：清监听、清掉待执行的那一帧。
listeners.window.resize({ type: 'resize' })
cleanup()
check(!listeners.window.resize && !listeners.document.scroll, '卸载时清掉 resize / scroll 监听')
check(frames.size === 0, '卸载时清掉待执行的那一帧')

g.window = saved.window
g.document = saved.document
g.requestAnimationFrame = saved.requestAnimationFrame
g.cancelAnimationFrame = saved.cancelAnimationFrame
g.ResizeObserver = saved.ResizeObserver

console.log('\n' + (failed ? '存在失败（' + failed + ' 条断言）' : '全部通过（' + passed + ' 条断言）'))
if (failed) process.exit(1)
