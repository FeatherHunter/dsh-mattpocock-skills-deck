#!/usr/bin/env node
/**
 * verify-671-modal-global-overlay.js — 「建仓弹窗与右侧面板无关」门禁（2026-09-21）
 *
 * 起因（用户在真机上报）：点横幅那颗「创建并发布」，弹窗**出得很慢**、而且**像是依赖右侧面板**。
 *   查明之后是同一件事：弹窗的界面本来就全屏（`.dsws-modal` 走 portalTop 挂到 document.body），
 *   但它的 React 生命原来绑在右侧面板的检查页上（`Dock.js` 只在「面板当前页 = 检查」时才渲染 ChecksTab）。
 *   于是面板没打开、或不在检查页时，点那颗按钮**什么都不会发生**（状态写进去了，没有组件渲染它），
 *   用户之后打开面板切到检查页，弹窗才突然冒出来 —— 看起来就是「点了没反应 / 出得很慢」；
 *   反方向也错：在检查页点出来之后切到别的标签页，弹窗跟着消失。
 *   修法：座位搬去状态栏（`statusbar/StatusBar.js`，挂在宿主输入区 dock 上，与右侧面板无关），检查页那份删掉。
 *
 * 断两组：
 *   A 源码层：那个座位只在状态栏（声明一处、三支渲染都带上）；检查页里不再有它（防两处同挂叠两层遮罩）。
 *   B 真渲染层（jsdom + 真产物 + 同一个 React 实例）：把产物里那个弹窗座位拿出来、喂一份「仓库还没建」的
 *     会话状态（弹窗已置为打开），它必须真的渲染出 `.dsws-modal`，并且父节点是 `document.body`（走 portalTop）。
 *     外加一条反证：同一个座位喂一份「没有弹窗」的状态时，必须量不到 `.dsws-modal`。
 *
 * 为什么不做「整条插件启起来再点横幅」那一版：状态栏组件经 `DswsCtx` 取会话状态，而那要跟产物共用同一个
 *   React 实例（两份 React 时 `useContext` 拿到的是各自那份 context 的默认值，界面读的是另一个状态对象）。
 *   本门要证的是「座位在哪一层、跟面板有没有关系」，上面这一版已经钉死；点按钮那一整条链由
 *   `tests/verify-665-fresh-workspace-chain.js` 在模块层钉着（含「点仓库那一段开的是哪个弹窗」）。
 *
 * 用法：node tests/verify-671-modal-global-overlay.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

let passed = 0
let failed = 0
function check (ok, msg) { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const SB = resolve('src/client/statusbar/StatusBar.js')
const CT = resolve('src/client/views/ChecksTab.js')
const PKG = resolve('package/lib/client.js')
for (const p of [SB, CT, PKG]) if (!existsSync(p)) check(false, p + ' 读不到（先跑 npm run build）')
const sbSrc = readFileSync(SB, 'utf8')
const ctSrc = readFileSync(CT, 'utf8')
const clientSrc = readFileSync(PKG, 'utf8')

console.log('== A 源码层：座位只在状态栏（三支都带上），检查页不再挂 ==')
{
  const decls = (sbSrc.match(/const modalSeat = /g) || []).length
  check(decls === 1, '状态栏里那个座位只声明一处（实得 ' + decls + '）')
  const uses = (sbSrc.match(/modalSeat\b/g) || []).length
  check(uses === 4, '状态栏里那个座位被三支渲染都用上（含声明共 4 次，实得 ' + uses + '）')
  check(ctSrc.indexOf('FormModalSeat') < 0, '检查页不再挂那个座位（两处同挂会叠两层遮罩）')
  check(ctSrc.indexOf('formModalNode') < 0, '检查页也不留旧变量名（真搬走，不是注释掉）')
  check(clientSrc.indexOf('const FormModalSeat = function') >= 0, '产物里带着那个弹窗组件')
}

// —— B 组的取值口径：产物里那段弹窗渲染体，原样抽出来跑（不启动整条插件）——
//   抽法：从「const FormModalSeat = function」那一行开始，按花括号配平找它的收尾
//   （不能按「下一个顶层声明」找：那一段里还有别的东西，会切在半截，语法就崩了）。
function extractSeatSource (code) {
  const lines = code.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) { if (lines[i].indexOf('const FormModalSeat = function') >= 0) { start = i; break } }
  if (start < 0) throw new Error('产物里没有找到弹窗组件那一段')
  let depth = 0
  let end = -1
  for (let i = start; i < lines.length; i++) {
    for (let c = 0; c < lines[i].length; c++) {
      const ch = lines[i][c]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end >= 0) break
  }
  if (end < 0) throw new Error('按花括号配平找不到弹窗组件那一段的收尾')
  return { src: lines.slice(start, end + 1).join('\n'), lineCount: end - start + 1 }
}

const { JSDOM } = await import('jsdom')
const React = (await import('react')).default
const ReactDOMClient = await import('react-dom/client')
const require = createRequire(import.meta.url)
const ReactDOMBrowser = require('react-dom')
const { act } = await import('react')

const seat = extractSeatSource(clientSrc)
console.log('')
console.log('== B 真渲染层（jsdom + 真产物）：只挂那个座位，弹窗必须落到 document.body 上 ==')
check(seat.lineCount > 100, '从产物里抽到了弹窗组件那一段（' + seat.lineCount + ' 行）')

function makeStore (withModal) {
  return {
    sessionId: 'sid-671', cwd: 'D:\\tmp\\671-browser', tab: 'list',
    selection: { backendId: 'github', source: 'explicit' }, subs: [], tick: 0,
    formModal: withModal
      ? {
          open: true, isWizard: true, stepIndex: 0, pending: false, success: null,
          label: '创建并发布', stepId: 'gh:remote',
          steps: [
            { title: '仓库信息', schema: [{ name: 'name', type: 'text', label: '仓库名' }] },
            { title: '可见性', schema: [{ name: 'visibility', type: 'single', label: '可见性', options: [{ value: 'public', label: '公开' }, { value: 'private', label: '私有' }] }] },
          ],
          valuesByStep: [{}, {}], schema: [],
          submitAction: { type: 'rpc', method: 'wf.initPublish', params: {} },
        }
      : { open: false, isWizard: false, steps: null, stepIndex: 0, valuesByStep: null, schema: [], pending: false, success: null, label: '' },
  }
}

/** 造一个页面：同一个 React 实例下，把产物里那段弹窗组件挂进 DswsCtx.Provider。 */
async function renderSeat (withModal) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:59519/', runScripts: 'dangerously' })
  const { window } = dom
  const prev = { window: global.window, document: global.document }
  global.window = window
  global.document = window.document
  try {
    const st = makeStore(withModal)
    // 那段组件的自由变量：h / React / DswsCtx / portalTop，以及几个只在这条路上用到的（给空实现即可）。
    const DswsCtx = React.createContext(null)
    const h = React.createElement
    const portalTop = (node) => (ReactDOMBrowser.createPortal ? ReactDOMBrowser.createPortal(node, window.document.body) : node)
    const noop = () => {}
    const deps = {
      h, React, DswsCtx, portalTop,
      fillDefaults: (schema, base) => Object.assign({}, base),
      emit: noop, flash: noop, closeFormModal: noop, consumePendingSetup: noop,
      visLabelOf: () => '', startRepoSync: noop, runRepoSyncRecheck: noop, resolveFailText: () => '',
      guideInjectTextOf: () => '', moduleMetaOf: () => null, promptLang: () => 'zh', promptTextFor: () => '',
      inject: noop, tr: (k) => k, loadSnapshot: noop, loadChain: noop, openUrl: noop, retryPushFlow: noop,
      Ic: () => null, host: { call: () => Promise.resolve({ ok: true }) },
      timer: { setTimeout: (fn, ms) => setTimeout(fn, ms), timeout: (fn, ms) => setTimeout(fn, ms) },
      supportsBackend: () => false,
      _queueLen: () => 0,
    }
    const names = Object.keys(deps)
    const factory = new Function(...names, seat.src + '\n;return FormModalSeat')
    const Seat = factory(...names.map((n) => deps[n]))
    const host = window.document.createElement('div')
    window.document.body.appendChild(host)
    const root = ReactDOMClient.createRoot(host)
    const cx = { h, rdom: ReactDOMBrowser, storeSvc: { useStore: () => st } }
    await act(async () => {
      root.render(React.createElement(DswsCtx.Provider, { value: cx }, React.createElement(Seat, { st })))
      await new Promise((r) => setTimeout(r, 40))
    })
    const modal = window.document.querySelector('.dsws-modal')
    const out = {
      hasModal: !!modal,
      parentIsBody: !!modal && modal.parentElement === window.document.body,
      boxes: window.document.querySelectorAll('.dsws-modalbox').length,
      panels: window.document.querySelectorAll('[data-dsws-host]').length,
      bodyTail: window.document.body.innerHTML.slice(-160),
    }
    root.unmount()
    return out
  } finally {
    if (prev.window === undefined) delete global.window; else global.window = prev.window
    if (prev.document === undefined) delete global.document; else global.document = prev.document
  }
}

let pos = null
try { pos = await renderSeat(true) } catch (e) { check(false, 'B 组跑不起来：' + e.message) }
if (pos) {
  check(pos.hasModal, '弹窗渲染出来了（这一趟里一个面板组件都没有）')
  check(pos.parentIsBody, '弹窗的父节点就是 document.body（走 portalTop，不是就地渲染）')
  check(pos.boxes === 1, '只有一层弹窗壳（两处同挂会叠两层，实得 ' + pos.boxes + '）')
  check(pos.panels === 0, '页面里没有任何面板容器（实得 ' + pos.panels + '）')
}

console.log('')
console.log('== B 的反证：同一段组件、喂「没有弹窗」的状态，必须量不到 ==')
let neg = null
try { neg = await renderSeat(false) } catch (e) { check(false, '反证跑不起来：' + e.message) }
if (neg) {
  check(!neg.hasModal, '没有弹窗状态时量不到 .dsws-modal（否则这一段是恒真）')
}

console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
