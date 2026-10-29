// verify-1612-deck-door.ts — #1612 T2：状态栏胶囊上那扇「关/开整个 deck」的门 + 右侧面板闸门
// #1655 起两边都是跟随式二次确认（T1 关红色叉 / T2 展开对称跟随，老的全屏居中确认框下线）。
// 门禁归属: src/client/statusbar/deckDoor.ts, src/client/statusbar/StatusBar.ts,
//          src/client/kernel/store-prefs.ts, src/client/kernel/router.ts, config/copy/panel.yaml
//
// 票面（#1612 验收 ②③④⑤⑥ + #1655 跟随确认）的语义：
//   · 折叠条上的「展开」：deck 开着 → 直接展开胶囊；deck 关着 → 先在展开键旁边冒跟随小浮层（上方优先、
//     放不下翻到下方、贴边内收、宽 220），写明会开启 deck 工具箱、右侧面板和胶囊状态栏，确认后三处一起
//     恢复（两个开关写成开 + 右侧面板回到关之前那样），取消（点外面、按退出键、点取消）一个开关都不写；
//   · 红色 X（只在胶囊展开时出现）→ 先在叉旁边冒跟随小浮层（位置规则与开同一套），确认才关闭整个 deck：
//     先关右侧面板、再写 deckTools=off；取消口径与开对称；写失败浮层不收、原地提示；
//   · 「∨」只折叠胶囊（只写 statusBar），deck 工具箱与右侧面板都不受影响；
//   · deck 关着的工作区，router.openPanel 不再打开右侧面板（关闭永远允许）；
//   · deck 关着时，原生右栏里本插件那一格只画一句说明，不挂面板本体（从右栏直接点进来也绕不进去）；
//   · 胶囊折叠时只渲染折叠条，蓝条黄条一起不显示。
//
// 做法照 tests/verify-663-banner-chain.ts：叶子是 ESM 导出，不能直接 import 进源码树，
// 用 tests/lib/source-text.ts 取「按构建口径转译并剥 export」的文本，再交给 tests/lib/eval-probe.ts 的
// compileFn 求值；闭包里那些跨文件名字按真形状顶替（每个替身同时是观察窗）。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1612-deck-door.ts
const fs = require('fs')
const path = require('path')
const { compileFn } = require('./lib/eval-probe.js')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')

const root = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string) => { total++; if (ok) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }

// 界面文案替身：只用来断言「用的是哪个键、字数对不对」，真文案由下面的词条门禁按 YAML 原文查。
const TR: any = {
  'banner.deckDoorTip': '胶囊右边那颗红色 X 会把整个 deck 关掉：工具、胶囊、右侧面板三处一起关。',
  'banner.deckDoorClose': '关闭整个 MattSkillsDeck（工具、胶囊与右侧面板）',
  'banner.deckReopenTitle': '重新打开 MattSkillsDeck',
  'banner.deckReopenBody': '展开会开启 deck 工具箱、右侧面板和胶囊状态栏；确认后这三处一起恢复。',
  'banner.deckReopenOk': '开启',
  'banner.deckReopenCancel': '取消',
  'banner.deckReopenFail': '没打开，请再试一次',
  'banner.deckCloseTitle': '关闭整个 MattSkillsDeck',
  'banner.deckCloseBody': '关闭会关掉 deck 工具箱、胶囊状态栏和右侧面板；确认后这三处一起关，可随时去设置页重新打开。',
  'banner.deckCloseOk': '关闭',
  'banner.deckCloseCancel': '取消',
  'banner.deckCloseFail': '没关掉，请再试一次',
  'panel.deckClosed': '这个工作区的 deck 工具箱已经关了',
}
const trStub = (key: string) => (TR[key] !== undefined ? TR[key] : String(key))

// 假 h：把树原样留住，断言时按 props 里的 data-log / role 找节点、按 children 取文字。
// 这是测试桩，不是产品代码；h 只负责拼装，不负责渲染。
const hStub = function (tag: any, props: any, children?: any): any {
  const el: any = { type: tag, props: props || {} }
  if (children !== undefined) el.children = Array.isArray(children) ? children : [children]
  return el
}
const walk = function (node: any, out: any[]): any[] {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out }
  if (typeof node !== 'object') return out
  out.push(node)
  if (node.children) walk(node.children, out)
  return out
}
const findLog = function (node: any, log: string): any {
  return walk(node, []).find((el: any) => el.props && el.props['data-log'] === log) || null
}
const findAllLog = function (node: any, log: string): any[] {
  return walk(node, []).filter((el: any) => el.props && el.props['data-log'] === log)
}
const findRole = function (node: any, role: string): any {
  return walk(node, []).find((el: any) => el.props && el.props.role === role) || null
}
const textOf = function (node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}
// 点一下：控件上的 onClick 就是产品代码里那一颗，点击事件替身只提供 stopPropagation 与两个 target。
const click = function (el: any, self?: any): void {
  const target = self || el
  el.props.onClick({ stopPropagation: function () {}, target: target, currentTarget: target })
}
// 按一下键：退出键走 onKeyDown 冒泡到遮罩，与点外面、点取消同一条取消口径。
const keyDown = function (el: any, key: string): void {
  el.props.onKeyDown({ key: key, stopPropagation: function () {} })
}
// 合成锚：点按钮那一下量到的那颗按钮的矩形（e.currentTarget.getBoundingClientRect 的形状）。
const fakeAnchor = function (rect: any): any {
  return { getBoundingClientRect: function () { return rect } }
}

// —— 取 deckDoor 叶子：按构建口径转译、剥掉行首 export 后求值 ——
// 记账三本：写开关的调用（带先后顺序）、面板开关调用、emit 收到哪个会话状态。
type DoorCalls = {
  order: string[]
  tools: Array<{ cwd: string; on: any }>
  statusBar: Array<{ cwd: string; show: any }>
  panel: any[]
  emits: any[]
  closed: Set<string>
  failStatusBar: boolean
  failTools: boolean
}
const makeDoor = function (): { mod: any; calls: DoorCalls } {
  const calls: DoorCalls = { order: [], tools: [], statusBar: [], panel: [], emits: [], closed: new Set<string>(), failStatusBar: false, failTools: false }
  const body = spliceableJs('src/client/statusbar/deckDoor.js').replace(/^[ \t]*export[ \t]+/gm, '')
  // computeTipPlace 在这里是测试替身：只镜像定位契约（上方优先、放不下翻到下方、贴边内收、宽按调用方上限），
  // 真函数的穷举边界由它自己的门禁钉死；这里只验门逻辑有没有按契约传参（锚、尺寸、视口、上限 220）。
  const computeTipPlaceStub = function (anchorRect: any, tipSize: any, viewport: any, maxWidth?: any): any {
    if (!anchorRect || !viewport) return null
    const GAP = 8
    const EDGE = 4
    const W = (typeof maxWidth === 'number' && maxWidth > 0) ? maxWidth : 220
    const vpW = Number(viewport.width) || 0
    const vpH = Number(viewport.height) || 0
    const tipW = Math.max(0, Number((tipSize && tipSize.width) || 0))
    const tipH = Math.max(0, Number((tipSize && tipSize.height) || 0))
    const availW = Math.max(0, vpW - EDGE * 2)
    const availH = Math.max(0, vpH - EDGE * 2)
    const eff = Math.max(0, Math.min(W, availW))
    const placeW = Math.max(0, Math.min(tipW, eff, availW))
    const placeH = Math.max(0, Math.min(tipH, availH))
    const aL = Number(anchorRect.left) || 0
    const aT = Number(anchorRect.top) || 0
    const aR = (anchorRect.right !== undefined && anchorRect.right !== null) ? Number(anchorRect.right) : aL + (Number(anchorRect.width) || 0)
    const aB = (anchorRect.bottom !== undefined && anchorRect.bottom !== null) ? Number(anchorRect.bottom) : aT + (Number(anchorRect.height) || 0)
    const cx = (aL + aR) / 2
    const clampX = function (x: number): number {
      if (placeW >= availW) return EDGE
      return Math.max(EDGE, Math.min(x, vpW - placeW - EDGE))
    }
    const yAbove = aT - GAP - placeH
    if (yAbove >= EDGE) return { placement: 'above', x: Math.round(clampX(cx - placeW / 2)), y: Math.round(yAbove), effectiveMaxWidth: eff }
    const yBelow = aB + GAP
    return { placement: 'below', x: Math.round(clampX(cx - placeW / 2)), y: Math.round(yBelow), effectiveMaxWidth: eff }
  }
  const sandbox = {
    isDeckClosed: (cwd: any) => calls.closed.has(String(cwd)),
    setDeckTools: (cwd: any, on: any) => { calls.order.push('tools:' + String(on)); calls.tools.push({ cwd: String(cwd), on: on }); return calls.failTools ? false : true },
    setDeckStatusBar: (cwd: any, show: any) => { calls.order.push('statusBar:' + String(show)); calls.statusBar.push({ cwd: String(cwd), show: show }); return calls.failStatusBar ? false : true },
    togglePanel: (st: any) => { calls.order.push('panel'); calls.panel.push(st); if (st) st.open = false; return true },
    openPanel: (st: any) => { calls.order.push('open'); calls.panel.push(st); if (st) st.open = true; return true },
    emit: (st: any) => { calls.order.push('emit'); calls.emits.push(st) },
    computeTipPlace: computeTipPlaceStub,
    tr: trStub,
    Ic: (props: any) => ({ type: 'Ic', props: props || {} }),
    Tip: function Tip(props: any) { return null },
    h: hStub,
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { deckDoorCapsuleTail: deckDoorCapsuleTail, deckDoorExpand: deckDoorExpand, deckDoorFold: deckDoorFold, deckDoorCloseDeck: deckDoorCloseDeck, deckDoorCloseRequest: deckDoorCloseRequest, deckDoorCloseCancel: deckDoorCloseCancel, deckDoorConfirmEl: deckDoorConfirmEl, deckDoorCloseConfirmEl: deckDoorCloseConfirmEl }')
  return { mod: factory(...names.map((n) => (sandbox as Record<string, any>)[n])), calls: calls }
}

// —— 取 router 内核片：同一套取源与求值，面板那条路用真源码 ——
type RouterCalls = { order: string[]; logs: any[]; flashed: string[]; ctxGet: string[]; logsAt: number }
const makeRouter = function (): { mod: any; calls: RouterCalls; closed: Set<string> } {
  const closed = new Set<string>()
  const calls: RouterCalls = { order: [], logs: [], flashed: [], ctxGet: [], logsAt: 0 }
  const body = spliceableJs('src/client/kernel/router.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const noop = function () {}
  const sandbox: any = {
    isEnabled: () => false,
    log: (level: string, event: string, fields: any) => { calls.logs.push({ level: level, event: event, fields: fields }) },
    ctx: { get: (k: any) => { calls.ctxGet.push(String(k)); return null } },
    h: hStub,
    // 面板那一格按「已经就绪」那一次渲染来量：useState 直接回 true，跳过那两跳 rAF 的空壳阶段。
    React: { useState: (v: any) => [true, noop], useEffect: noop },
    // 面板本体用有名函数当替身：树里出现它，就说明这一格挂了面板；没出现就是没挂。
    DetailsDock: function DetailsDock(): any { return null },
    tr: trStub,
    flash: (st: any, msg: string) => { calls.flashed.push(String(msg)) },
    emit: noop,
    // 会话号 → 工作区目录的替身：两个会话各对一个工作区，量「按工作区拦面板」要用到。
    getCwdSync: (sid: any) => (String(sid) === 'sid-a' ? 'D:/ws-a' : String(sid) === 'sid-b' ? 'D:/ws-b' : ''),
    hydrateFromCache: noop,
    getCachedSnapshot: () => null,
    snapFresh: () => false,
    loadSnapshot: noop,
    startAttentionSignals: noop,
    keyOf: (cwd: any) => String(cwd || ''),
    getSnapshotVersion: () => '',
    issueUrlFor: () => '',
    repoUrlFor: () => '',
    effortOf: () => 0,
    idOf: () => 0,
    renderTemplate: () => '',
    promptText: () => '',
    promptTextFor: () => '',
    uiText: () => '',
    newWayfinderPrompt: () => '',
    newSpecPrompt: () => '',
    NEW_BUG_FIELDS_BUTTON: () => '',
    inspectPrompt: () => '',
    completePrompt: () => '',
    dswsLogHash: (s: any) => String(s || '').slice(0, 6),
    isDeckClosed: (cwd: any) => closed.has(String(cwd)),
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { openPanel: openPanel, togglePanel: togglePanel, DeckSidebarTab: DeckSidebarTab }')
  return { mod: factory(...names.map((n: string) => sandbox[n])), calls: calls, closed: closed }
}

const makeSt = (cwd: string, extra?: any): any => Object.assign({ cwd: cwd, open: false }, extra || {})
// 底部的按钮锚（红色叉 / 展开键都住在这一带）：贴近视口底部，贴右缘。
const BOTTOM_ANCHOR = { left: 1240, top: 700, right: 1268, bottom: 724, width: 28, height: 24 }
const WIDE_VIEWPORT = { width: 1280, height: 800 }

function main(): void {
  const { mod, calls } = makeDoor()
  const reset = () => { calls.order.length = 0; calls.tools.length = 0; calls.statusBar.length = 0; calls.panel.length = 0; calls.emits.length = 0; calls.failStatusBar = false; calls.failTools = false; calls.closed.clear() }

  console.log('== 1. 「∨」只折叠胶囊：只写 statusBar=hide，deckTools 一个字不碰（验收 ⑤）==')
  {
    reset()
    const st = makeSt('D:/ws-a')
    mod.deckDoorFold(st)
    check(calls.statusBar.length === 1 && calls.statusBar[0].cwd === 'D:/ws-a' && calls.statusBar[0].show === false, 'fold → setDeckStatusBar(cwd, false)')
    check(calls.tools.length === 0, 'fold 不调 setDeckTools（工具与右侧面板不受影响）')
    check(calls.panel.length === 0, 'fold 不碰右侧面板')
  }

  console.log('== 2. 折叠条「展开」：deck 开着就直接展开胶囊，不弹确认框 ==')
  {
    reset()
    const st = makeSt('D:/ws-a')
    mod.deckDoorExpand(st)
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === true, 'deck 开着 → setDeckStatusBar(cwd, true) 直接展开')
    check(st.deckDoorConfirm !== true, '不置重新打开确认框标记')
    check(st.deckDoorCloseConfirm !== true, '不置关闭确认框标记')
    check(calls.tools.length === 0, '展开时不动 deckTools')
  }

  console.log('== 3. 折叠条「展开」：deck 关着时在展开键旁边冒跟随浮层，一个开关都不写（#1655 T2）==')
  {
    reset()
    calls.closed.add('D:/ws-a')
    const st = makeSt('D:/ws-a')
    mod.deckDoorExpand(st, fakeAnchor(BOTTOM_ANCHOR))
    check(st.deckDoorConfirm === true, 'deck 关着 → 只置 st.deckDoorConfirm 让界面画跟随浮层')
    check(calls.statusBar.length === 0 && calls.tools.length === 0, '此时不写任何开关（等用户确认）')
    check(calls.emits.indexOf(st) >= 0, 'emit(st) 一次让状态栏重画')
    check(st.deckDoorConfirmAnchor && st.deckDoorConfirmAnchor.left === BOTTOM_ANCHOR.left && st.deckDoorConfirmAnchor.top === BOTTOM_ANCHOR.top, '锚记下展开键的矩形（跟随定位用它）')

    st.deckDoorConfirmViewport = Object.assign({}, WIDE_VIEWPORT)
    const el = mod.deckDoorConfirmEl(hStub, st)
    check(!!el, 'deckDoorConfirmEl 在标记置上后返回节点（标记没置时返回 null）')
    const dialog = findRole(el, 'dialog')
    check(!!dialog, '跟随浮层是 role=dialog 的对话框')
    check(!!dialog && String(dialog.props['aria-modal']) === 'true', '对话框标了 aria-modal=true')
    check(!!dialog && String(dialog.props['aria-label']) === TR['banner.deckReopenTitle'], '无障碍名用的是标题键 banner.deckReopenTitle（文案一字不动）')
    const bodyText = textOf(dialog && dialog.children ? dialog.children[1] : null)
    check(bodyText.indexOf('deck 工具箱') >= 0 && bodyText.indexOf('右侧面板') >= 0 && bodyText.indexOf('胶囊状态栏') >= 0,
      '正文写明会开启 deck 工具箱、右侧面板和胶囊状态栏（实得「' + bodyText + '」）')
    const okBtn = findLog(el, 'status.deckdoor.confirm')
    const noBtn = findLog(el, 'status.deckdoor.cancel')
    check(!!okBtn && !!noBtn, '确认与取消两颗按钮都在')
    check(!!okBtn && okBtn.props['data-press'] === 'button' && !!noBtn && noBtn.props['data-press'] === 'button', '两颗按钮都带按压反馈与各自的 data-log（#1335 口径）')
    check(!!okBtn && okBtn.props.autoFocus === true, '确认键自动聚焦（键盘不靠鼠标也能走完）')
    check(findAllLog(el, 'status.deckdoor.confirm').length === 1 && findAllLog(el, 'status.deckdoor.close.confirm').length === 0, '开的确认键与关的确认键各记一行可区分的点击')
    const backdrop = el
    check(!!backdrop && backdrop.props['data-log'] === 'status.deckdoor.backdrop', '遮罩带自己的 data-log（status.deckdoor.backdrop）')
    check(!!backdrop && backdrop.props.style && backdrop.props.style.background === 'transparent', '遮罩透明只接点外面，不挡视线（老 dim 居中框已下线）')
    const cardStyle = dialog && dialog.props && dialog.props.style
    check(!!cardStyle && cardStyle.position === 'fixed' && cardStyle.maxWidth === 220, '卡片跟随按钮（position:fixed），宽上限 220（与悬停提示同一套）')
    check(!!cardStyle && typeof cardStyle.left === 'number' && typeof cardStyle.top === 'number', '卡片按锚算出左上角（首帧估高，挂载后按实测纠正）')
    check(!!cardStyle && (cardStyle.top + 180) <= BOTTOM_ANCHOR.top, '默认长在按钮上方（上方放得下不翻面）')
    check(!!cardStyle && cardStyle.left >= 4 && (cardStyle.left + 220) <= (WIDE_VIEWPORT.width - 4), '贴右缘时整块左移内收，不越界（1280 宽下左缘应为 1056）')
    check(!!cardStyle && cardStyle.left === 1056, '右缘内收算对了数（1056 = 1280 - 220 - 4）')
    check(textOf(dialog).indexOf(TR['banner.deckReopenFail']) < 0, '没失败时不画失败提示')
  }

  console.log('== 3b. 上方放不下翻到下方：定位规则与关闭同一套（#1655 T2）==')
  {
    reset()
    calls.closed.add('D:/ws-a')
    const highAnchor = { left: 600, top: 20, right: 630, bottom: 44, width: 30, height: 24 }
    const st = makeSt('D:/ws-a')
    mod.deckDoorExpand(st, fakeAnchor(highAnchor))
    st.deckDoorConfirmViewport = { width: 1280, height: 300 }
    const el = mod.deckDoorConfirmEl(hStub, st)
    const dialog = findRole(el, 'dialog')
    const cardStyle = dialog && dialog.props && dialog.props.style
    check(!!cardStyle && cardStyle.top === highAnchor.bottom + 8, '上方放不下翻到下方（top = 锚底 + 8）')
  }

  console.log('== 4. 重新打开：确认三处一起恢复（两个开关 + 右侧面板）；取消口径对称，一个都不写 ==')
  {
    reset()
    calls.closed.add('D:/ws-a')
    const st = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    const el = mod.deckDoorConfirmEl(hStub, st)
    click(findLog(el, 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.tools[0].on === true, '确认 → setDeckTools(cwd, true) 写 deck 工具箱开')
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === true, '确认 → setDeckStatusBar(cwd, true) 写胶囊显示')
    check(calls.order.indexOf('tools:true') >= 0 && calls.order.indexOf('statusBar:true') >= 0 && calls.order.indexOf('tools:true') < calls.order.indexOf('statusBar:true'), '先开 deck 工具箱、再显示胶囊（顺序与三处联动的因果一致）')
    check(calls.order.indexOf('tools:true') >= 0 && calls.order.indexOf('open') > calls.order.indexOf('tools:true'), '开面板排在写 deckTools 之后（openPanel 会按 deck 状态拦）')
    check(st.open === true, '右侧面板也重新打开（三处恢复：工具箱、胶囊状态栏、右侧面板）')
    check(st.deckDoorConfirm === false, '确认后确认框标记收起')
    check(calls.emits.indexOf(st) >= 0, '确认后 emit(st) 一次让状态栏重画')

    reset()
    const st2 = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    const el2 = mod.deckDoorConfirmEl(hStub, st2)
    click(findLog(el2, 'status.deckdoor.cancel'))
    check(calls.tools.length === 0 && calls.statusBar.length === 0, '点取消 → 一个开关都不写（什么都不改）')
    check(st2.deckDoorConfirm === false && calls.panel.length === 0, '取消只收起浮层，不碰右侧面板')

    reset()
    const st3 = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    const el3 = mod.deckDoorConfirmEl(hStub, st3)
    click(el3)
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && st3.deckDoorConfirm === false, '点浮层外面 → 等同取消，一个开关都不写')

    reset()
    const st4 = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    const el4 = mod.deckDoorConfirmEl(hStub, st4)
    keyDown(el4, 'Escape')
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && st4.deckDoorConfirm === false, '按退出键 → 等同取消，一个开关都不写')

    reset()
    const st5 = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(findLog(mod.deckDoorConfirmEl(hStub, st5), 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.statusBar.length === 1 && calls.panel.length === 1 && st5.open === true, '面板本来没开也照样打开：浮层文案承诺的三处恢复不因刷新而少一处')
  }

  console.log('== 4b. 写设置文件失败：浮层不收，原地提示没打开、请再试一次 ==')
  {
    reset()
    calls.failStatusBar = true
    const st = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorConfirmAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorConfirmViewport: Object.assign({}, WIDE_VIEWPORT) })
    const el = mod.deckDoorConfirmEl(hStub, st)
    click(findLog(el, 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.tools[0].on === true, '失败前 deck 工具箱照常写文件那条路')
    check(st.deckDoorConfirm === true, '写失败浮层不收（标记仍在）')
    check(st.deckDoorConfirmFail === true, '竖起失败旗')
    check(textOf(mod.deckDoorConfirmEl(hStub, st)).indexOf(TR['banner.deckReopenFail']) >= 0, '原地提示没打开、请再试一次')
    check(calls.panel.length === 0 && st.open !== true, '失败不碰右侧面板（没写进去就不假装打开）')
  }

  console.log('== 5. 红色 X：先冒跟随浮层，不再直关（#1655 T1）；浮层文案把三处与回去的路说全 ==')
  {
    reset()
    const st = makeSt('D:/ws-a', { open: true })
    const tail = mod.deckDoorCapsuleTail(hStub, st, { marker: 'capsuleToggle' })
    check(Array.isArray(tail) && tail.length === 2, '胶囊尾部交回两个控件（∨ 与红色 X）')
    check(Array.isArray(tail) && tail[0] && tail[0].marker === 'capsuleToggle', '第一个仍是原来的「∨」')
    check(Array.isArray(tail) && !!findLog(tail[1], 'status.capsule.deckclose'), '第二个是红色 X（带自己的 data-log）')
    const x = findLog(tail[1], 'status.capsule.deckclose')
    check(!!x && x.props['data-press'] === 'icon', 'X 是纯图标，只接按压压暗')
    check(!!x && !!(x.props['aria-label']), 'X 有无障碍名（不是只有颜色）')
    check(!!x && !!x.props.style && x.props.style.color === '#f87171', 'X 是红色的，尺寸与胶囊里既有小控件同档（12px 图标 + 2px 内边距）')
    click(x, fakeAnchor(BOTTOM_ANCHOR))
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && calls.panel.length === 0, '点 X 只冒浮层，一个开关都不写（不再直关）')
    check(st.deckDoorCloseConfirm === true, '点 X 置 st.deckDoorCloseConfirm 让界面画关闭浮层')
    check(st.deckDoorCloseAnchor && st.deckDoorCloseAnchor.left === BOTTOM_ANCHOR.left, '锚记下叉的矩形（跟随定位用它）')
    check(calls.emits.indexOf(st) >= 0, 'emit(st) 一次让状态栏重画')

    st.deckDoorCloseViewport = Object.assign({}, WIDE_VIEWPORT)
    const el = mod.deckDoorCloseConfirmEl(hStub, st)
    check(!!el, 'deckDoorCloseConfirmEl 在标记置上后返回节点（标记没置时返回 null）')
    check(mod.deckDoorCloseConfirmEl(hStub, makeSt('D:/ws-a')) === null, '标记没置时返回 null')
    const dialog = findRole(el, 'dialog')
    check(!!dialog, '关闭浮层是 role=dialog 的对话框')
    check(!!dialog && String(dialog.props['aria-modal']) === 'true', '对话框标了 aria-modal=true')
    check(!!dialog && String(dialog.props['aria-label']) === TR['banner.deckCloseTitle'], '无障碍名用的是关闭标题键 banner.deckCloseTitle')
    const bodyText = textOf(dialog && dialog.children ? dialog.children[1] : null)
    check(bodyText.indexOf('deck 工具箱') >= 0 && bodyText.indexOf('胶囊') >= 0 && bodyText.indexOf('右侧面板') >= 0, '正文列出三处（实得「' + bodyText + '」）')
    check(bodyText.indexOf('设置页') >= 0, '正文写清从设置页可开回来')
    const okBtn = findLog(el, 'status.deckdoor.close.confirm')
    const noBtn = findLog(el, 'status.deckdoor.close.cancel')
    check(!!okBtn && !!noBtn, '关闭 / 取消两颗按钮都在')
    check(!!okBtn && okBtn.props.autoFocus === true, '关闭键自动聚焦')
    check(!!okBtn && okBtn.props['data-press'] === 'button' && !!noBtn && noBtn.props['data-press'] === 'button', '两颗按钮都带按压反馈与各自的 data-log')
    check(findAllLog(el, 'status.deckdoor.confirm').length === 0, '关的确认键与开的确认键各记一行可区分的点击')
    const backdrop = el
    check(!!backdrop && backdrop.props['data-log'] === 'status.deckdoor.close.backdrop', '遮罩带自己的 data-log（status.deckdoor.close.backdrop）')
    check(!!backdrop && backdrop.props.style && backdrop.props.style.background === 'transparent', '遮罩透明只接点外面')
    const cardStyle = dialog && dialog.props && dialog.props.style
    check(!!cardStyle && cardStyle.position === 'fixed' && cardStyle.maxWidth === 220, '卡片跟随叉（position:fixed），宽上限 220')
    check(!!cardStyle && typeof cardStyle.left === 'number' && typeof cardStyle.top === 'number', '卡片按锚算出左上角')
    check(!!cardStyle && (cardStyle.top + 180) <= BOTTOM_ANCHOR.top, '默认长在叉的上方')
    check(!!cardStyle && cardStyle.left === 1056, '贴右缘整块左移内收（1056 = 1280 - 220 - 4）')
    check(textOf(dialog).indexOf(TR['banner.deckCloseFail']) < 0, '没失败时不画失败提示')

    reset()
    const st2 = makeSt('D:/ws-b', { open: false })
    const tail2 = mod.deckDoorCapsuleTail(hStub, st2, null)
    check(Array.isArray(tail2) && tail2.length === 1, '没有 ∨ 时只交回红色 X（不塞空位）')
    click(findLog(tail2[0], 'status.capsule.deckclose'), fakeAnchor(BOTTOM_ANCHOR))
    check(calls.panel.length === 0 && calls.tools.length === 0 && st2.deckDoorCloseConfirm === true, '面板本来关着：点 X 同样只冒浮层，一个开关都不写')
  }

  console.log('== 5b. 点关闭：先关右侧面板、再写工具箱关；取消口径对称，一个都不写 ==')
  {
    reset()
    const st = makeSt('D:/ws-a', { open: true, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(findLog(mod.deckDoorCloseConfirmEl(hStub, st), 'status.deckdoor.close.confirm'))
    check(calls.order.indexOf('panel') >= 0 && calls.order.indexOf('tools:false') >= 0 && calls.order.indexOf('panel') < calls.order.indexOf('tools:false'), '点击顺序：先关右侧面板、再写 deckTools=off（先关后写，避免被 openPanel 的闸门挡住）')
    check(st.open === false, '面板状态已置关')
    check(calls.statusBar.length === 0, 'X 不单独写 statusBar（deck 关着时胶囊自动折叠，由 isDeckCapsuleFolded 一处决定）')
    check(st.deckDoorCloseConfirm === false, '确认后关闭浮层标记收起')
    check(calls.emits.indexOf(st) >= 0, '确认后 emit(st) 一次让状态栏重画')

    reset()
    const st2 = makeSt('D:/ws-a', { open: false, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(findLog(mod.deckDoorCloseConfirmEl(hStub, st2), 'status.deckdoor.close.confirm'))
    check(calls.panel.length === 0 && calls.tools.length === 1 && calls.tools[0].on === false, '面板本来关着：不再关一次，只写 deckTools=off')

    reset()
    const st3 = makeSt('D:/ws-a', { open: true, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(findLog(mod.deckDoorCloseConfirmEl(hStub, st3), 'status.deckdoor.close.cancel'))
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && calls.panel.length === 0, '点取消 → 一个开关都不写，只收起浮层')
    check(st3.deckDoorCloseConfirm === false && st3.open === true, '取消不碰右侧面板（原来开着还开着）')

    reset()
    const st4 = makeSt('D:/ws-a', { open: true, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(mod.deckDoorCloseConfirmEl(hStub, st4))
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && calls.panel.length === 0 && st4.deckDoorCloseConfirm === false, '点浮层外面 → 等同取消，一个开关都不写')

    reset()
    const st5 = makeSt('D:/ws-a', { open: true, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    keyDown(mod.deckDoorCloseConfirmEl(hStub, st5), 'Escape')
    check(calls.tools.length === 0 && calls.statusBar.length === 0 && calls.panel.length === 0 && st5.deckDoorCloseConfirm === false, '按退出键 → 等同取消，一个开关都不写')
  }

  console.log('== 5c. 关闭写失败：浮层不收，原地提示没关掉、请再试一次（面板改回原样）==')
  {
    reset()
    calls.failTools = true
    const st = makeSt('D:/ws-a', { open: true, deckDoorCloseConfirm: true, deckDoorCloseAnchor: Object.assign({}, BOTTOM_ANCHOR), deckDoorCloseViewport: Object.assign({}, WIDE_VIEWPORT) })
    click(findLog(mod.deckDoorCloseConfirmEl(hStub, st), 'status.deckdoor.close.confirm'))
    check(calls.tools.length === 1 && calls.tools[0].on === false, '失败前照常走文件那条路（setDeckTools(cwd, false) 调过一次）')
    check(st.deckDoorCloseConfirm === true, '写失败浮层不收（标记仍在）')
    check(st.deckDoorCloseFail === true, '竖起失败旗')
    check(textOf(mod.deckDoorCloseConfirmEl(hStub, st)).indexOf(TR['banner.deckCloseFail']) >= 0, '原地提示没关掉、请再试一次')
    check(st.open === true, '面板改回点之前那样（没写进去就不假装关掉了）')
  }

  console.log('== 5d. 旧 localStorage 表一个字节都不写（验收 ⑦ 的退役口径不变）==')
  {
    reset()
    calls.failStatusBar = true
    mod.deckDoorFold(makeSt('D:/ws-a'))
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === false, '收起：只把 statusBar 写成 hide（接不下也不写旧键）')

    reset()
    calls.failStatusBar = true
    mod.deckDoorExpand(makeSt('D:/ws-a'))
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === true, '展开：只把 statusBar 写成 show（接不下也不写旧键）')
  }

  console.log('== 6. 右侧面板闸门：deck 关着时 openPanel 不开；关面板永远允许（验收 ②）==')
  {
    const { mod: rmod, calls: rcalls, closed } = makeRouter()
    const st = makeSt('D:/ws-a')
    closed.add('D:/ws-a')
    rmod.openPanel(st)
    check(rcalls.ctxGet.length === 0, 'deck 关着 → 根本不碰宿主右栏控制器（不试试看再说）')
    check(rcalls.flashed.length === 1 && rcalls.flashed[0] === TR['panel.deckClosed'], '给用户一句看得懂的提示（用的是 panel.deckClosed 那条词）')
    check(rcalls.logs.length === 0, '没有走到 panel.open 那一行日志')

    rcalls.ctxGet.length = 0; rcalls.flashed.length = 0; rcalls.logs.length = 0
    closed.clear()
    rmod.openPanel(st)
    check(rcalls.ctxGet.length === 1, 'deck 开着 → 照旧去拿宿主右栏控制器（打开这条路一点没变）')
    check(rcalls.logs.length === 1 && rcalls.logs[0].event === 'panel.open', '照旧记 panel.open 那一行')

    rcalls.ctxGet.length = 0
    closed.add('D:/ws-a')
    const stOpen = makeSt('D:/ws-a', { open: true })
    rmod.togglePanel(stOpen)
    check(stOpen.open === false && rcalls.ctxGet.length === 0, 'togglePanel 的「关」分支不受闸门影响：deck 关着也能把已经开着的面板关掉（红色 X 的「先关面板」靠它）')
  }

  console.log('== 6b. 右栏那一格：deck 关着只画一句说明、不挂面板本体（验收 ②）==')
  {
    const { mod: rmod, closed } = makeRouter()
    const hasDock = (node: any): boolean => walk(node, []).some((n: any) => typeof n.type === 'function' && n.type.name === 'DetailsDock')
    closed.add('D:/ws-a')
    const elClosed = rmod.DeckSidebarTab({ sessionId: 'sid-a' })
    check(!!elClosed && !!(elClosed.props && elClosed.props.className === 'dsws-deckclosed'), 'deck 关着：面板那一格换成说明用的空态（class .dsws-deckclosed）')
    check(textOf(elClosed) === TR['panel.deckClosed'], 'deck 关着：那一格写的就是 panel.deckClosed 这条词')
    check(!hasDock(elClosed), 'deck 关着：面板本体（DetailsDock）根本不挂，右栏直连也绕不进来')
    closed.clear()
    const elOpen = rmod.DeckSidebarTab({ sessionId: 'sid-a' })
    check(hasDock(elOpen), 'deck 开着：照旧挂面板本体，面板那条路没被这次改动影响')
  }

  console.log('== 7. 折叠时横幅不渲染（验收 ⑥）：折叠分支早返回，横幅都在它后面 ==')
  {
    const sb = sourceText('src/client/statusbar/StatusBar.ts')
    const foldAt = sb.indexOf('if (deckFolded) {')
    const bannAt = sb.indexOf('const bann = function')
    check(foldAt >= 0 && bannAt > foldAt, '折叠分支（if (deckFolded)）在黄条 bann 与 stepBanner 之前早返回，所以折叠时蓝条黄条都不渲染')
    const foldedBlock = sb.slice(foldAt, sb.indexOf('data-log\': \'status.banner.expand', foldAt) + 600)
    check(foldedBlock.indexOf('stepBanner') < 0 && foldedBlock.indexOf('infoBar') < 0 && foldedBlock.indexOf('bann(') < 0, '折叠分支里没有横幅渲染代码')
    check(sb.indexOf('const deckFolded = isDeckCapsuleFolded(s.cwd)') >= 0, '折叠判据换成 isDeckCapsuleFolded：deck 关着时一定算折叠')
    check(sb.indexOf('...deckDoorCapsuleTail(h, s, capsuleToggle)') >= 0, '胶囊尾部接的是 deckDoorCapsuleTail（∨ + 红色 X）')
    check(sb.indexOf('deckDoorConfirmEl(h, s)') >= 0, '折叠条与其它分支都带上重新打开浮层节点')
    check(sb.indexOf('deckDoorCloseConfirmEl(h, s)') >= 0, '三个分支都带上关闭浮层节点（折叠中确认也能画出来）')
    check(sb.indexOf('deckDoorExpand(s, e') >= 0, '展开键把按钮本体传进门逻辑留锚（跟随定位用它）')
    check(sb.indexOf('isBannerFolded(') < 0 && sb.indexOf('setBannerFolded(') < 0, 'StatusBar 不再直接碰旧名（折叠语义只从 deck-state 一处来）')
  }

  console.log('== 8. 接线与接口：旧迁移已删、router 有闸门、构建入口登记这一片、老的居中框已下线 ==')
  {
    const sp = sourceText('src/client/kernel/store-prefs.ts')
    for (const name of ['BANNER_FOLD_KEY', 'bannerFoldByCwd', 'isBannerFolded', 'setBannerFolded']) {
      check(sp.indexOf(name) < 0, '旧名已删：' + name + '（维护者 2026-10-29 拍板删掉旧迁移）')
    }
    check(sp.indexOf("'dsws.bannerFold'") < 0, 'store-prefs 不再读写旧 localStorage 键（注释里写一句「已退役」不算碰它）')

    const rt = sourceText('src/client/kernel/router.ts')
    check(rt.indexOf('isDeckClosed(st && st.cwd)') >= 0, 'router.openPanel 里按工作区判 deck 是否关着')
    check(rt.indexOf("tr('panel.deckClosed')") >= 0, '被挡住时给用户一句看得懂的提示')
    check(rt.indexOf("className: 'dsws-deckclosed'") >= 0, '右侧面板那一格挂的是 .dsws-deckclosed，不往内联样式里写色值')
    const styles = sourceText('src/client/kernel/styles.ts')
    check(styles.indexOf('.dsws-deckclosed{') >= 0 && styles.indexOf('var(--dsw-alias-label-caption,#8b8b95)') >= 0, '说明的样式登记在 styles.ts 的唯一真源里，文字用二级文字色令牌，不自造 CSS 变量')

    const idx = sourceText('src/client/index.ts')
    const build = sourceText('scripts/build.mts')
    check(idx.indexOf('leaf:deckDoor') >= 0, '客户端入口有 deckDoor 的拼接标记')
    check(build.indexOf('src/client/statusbar/deckDoor.ts') >= 0, '构建清单登记了 deckDoor.ts')
    const dd = sourceText('src/client/statusbar/deckDoor.ts')
    // 胶囊尾部两颗控件（「∨」与红色「X」）拼成同一个数组交给 React 渲染，数组里每个元素都要稳定 key，缺了会报错、界面门禁当场红。
    check(dd.indexOf("key: 'deckCloseToggle'") >= 0, '红色「X」那颗控件带稳定 key')
    check(sourceText('src/client/statusbar/StatusBar.ts').indexOf("key: 'deckFoldToggle'") >= 0, '「∨」那颗控件带稳定 key（两颗同一个数组，不能只给一颗）')
    check(dd.indexOf('setBannerFolded(') < 0, 'deckDoor 不再碰旧名 setBannerFolded（写胶囊只走 setDeckStatusBar）')
    check(dd.indexOf('deckDoorWriteStatusBar(') < 0, '旧表降级包装已删：接不下时如实返回，不写旧键')
    check(dd.indexOf('computeTipPlace') >= 0, '定位直接复用悬停提示的纯函数（上方优先、翻面、内收，不新写定位）')
    check(dd.indexOf('380') < 0, '老的全屏居中卡（maxWidth 380）已下线')
    check(dd.indexOf("background: 'rgba(0,0,0,.55)'") < 0, '老的全屏遮罩（dim + 居中）已下线，遮罩透明只接点外面')
    check(dd.indexOf("background: 'transparent'") >= 0, '跟随浮层的遮罩透明，不挡视线')
    check(dd.indexOf('deckDoorCloseRequest(st') >= 0, '红色 X 点下去只冒浮层（调 deckDoorCloseRequest），不再直关三处')
    check(!/^[ \t]*import\s/m.test(dd), '叶子不许有运行时 import')
    check(!/^[ \t]*export\s+default\b/m.test(dd), '叶子不许 export default')
    for (const name of ['deckDoorCapsuleTail', 'deckDoorExpand', 'deckDoorFold', 'deckDoorCloseDeck', 'deckDoorCloseRequest', 'deckDoorCloseCancel', 'deckDoorConfirmEl', 'deckDoorCloseConfirmEl']) {
      check(typeof mod[name] === 'function', '导出还在：' + name)
    }
  }

  console.log('== 9. 词条：中英两段都齐，关闭正文把三处与回去的路说全（#1655）==')
  {
    const yml = fs.readFileSync(path.join(root, 'config/copy/panel.yaml'), 'utf8')
    const need = ['banner.deckDoorClose', 'banner.deckDoorTip', 'banner.deckReopenTitle', 'banner.deckReopenBody', 'banner.deckReopenOk', 'banner.deckReopenCancel', 'banner.deckReopenFail', 'banner.deckCloseTitle', 'banner.deckCloseBody', 'banner.deckCloseOk', 'banner.deckCloseCancel', 'banner.deckCloseFail', 'panel.deckClosed']
    for (const key of need) {
      const count = (yml.match(new RegExp('^[ \\t]+' + key.replace(/\\./g, '\\.') + ':', 'gm')) || []).length
      check(count === 2, '词条 ' + key + ' 在 zh / en 两段各一条（实得 ' + count + ' 条）')
    }
    const zhBody = (yml.match(/^[ \t]+banner\.deckReopenBody: (.+)$/m) || [])[1] || ''
    const enBody = (yml.match(/^[ \t]+banner\.deckReopenBody: (.+)$/gm) || [])[1] || ''
    check(zhBody.indexOf('deck 工具箱') >= 0 && zhBody.indexOf('右侧面板') >= 0 && zhBody.indexOf('胶囊状态栏') >= 0, '中文重开正文写明会开启 deck 工具箱、右侧面板和胶囊状态栏')
    check(/deck tools/.test(enBody) && /right panel/.test(enBody) && /capsule status bar/.test(enBody), '英文重开正文同样把三处说全')
    const zhClose = (yml.match(/^[ \t]+banner\.deckCloseBody: (.+)$/m) || [])[1] || ''
    const enClose = (yml.match(/^[ \t]+banner\.deckCloseBody: (.+)$/gm) || [])[1] || ''
    check(zhClose.indexOf('deck 工具箱') >= 0 && zhClose.indexOf('右侧面板') >= 0 && zhClose.indexOf('胶囊') >= 0 && zhClose.indexOf('设置页') >= 0, '中文关闭正文列出三处并写清从设置页可开回来')
    check(/deck tools/.test(enClose) && /right panel/.test(enClose) && /capsule/.test(enClose) && /settings/.test(enClose), '英文关闭正文列出三处并写清回去的路')
  }

  console.log('== 10. 旧迁移退役：接口冻结清单与契约文档都不再列四个旧名 ==')
  {
    const kernelGate = sourceText('tests/verify-kernel.ts')
    for (const name of ['BANNER_FOLD_KEY', 'bannerFoldByCwd', 'isBannerFolded', 'setBannerFolded']) {
      check(kernelGate.indexOf("'" + name + "'") < 0, '接口冻结清单已去掉 ' + name)
    }
    const contract = sourceText('docs/architecture/kernel-contract.md')
    check(contract.indexOf('BANNER_FOLD_KEY') < 0 && contract.indexOf('bannerFoldByCwd') < 0 && contract.indexOf('isBannerFolded') < 0 && contract.indexOf('setBannerFolded') < 0,
      'kernel 契约文档已去掉四个旧名')
    const settingsView = sourceText('src/client/kernel/settings-view.ts')
    check(settingsView.indexOf("key: 'dsws.bannerFold'") < 0, '旧键登记表里不再有 dsws.bannerFold（迁移删了）')
    check(settingsView.indexOf("key: 'dsws.subwsAutoShown'") >= 0, '红文件夹标志那条旧表读法还在（本次只退役横幅折叠那一格）')
  }

  if (failed) {
    console.log('\n存在失败 — verify-1612-deck-door 未通过（失败项见上）')
    process.exit(1)
  }
  console.log('\n' + total + ' 条断言全部通过 — 胶囊上那扇「关/开整个 deck」的门与右侧面板闸门符合 #1612 + #1655 拍板的语义')
}

main()
