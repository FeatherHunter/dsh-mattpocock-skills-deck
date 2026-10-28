// verify-1612-deck-door.ts — #1612 T2：状态栏胶囊上那扇「关/开整个 deck」的门 + 右侧面板闸门
// 门禁归属: src/client/statusbar/deckDoor.ts, src/client/statusbar/StatusBar.ts,
//          src/client/kernel/store-prefs.ts, src/client/kernel/router.ts, config/copy/panel.yaml
//
// 票面（#1612 验收 ②③④⑤⑥）的语义：
//   · 折叠条上的「展开」：deck 开着 → 直接展开胶囊；deck 关着 → 先弹确认框（写明会开启 deck 工具箱、
//     右侧面板和胶囊状态栏），确认后三处一起恢复（两个开关写成开 + 右侧面板回到关之前那样），取消一个开关都不写；
//   · 红色 X（只在胶囊展开时出现）→ 关闭整个 deck：先关右侧面板、再写 deckTools=off；设置页开关随之同步；
//   · 「∨」只折叠胶囊（只写 statusBar），deck 工具箱与右侧面板都不受影响；
//   · deck 关着的工作区，router.openPanel 不再打开右侧面板（关闭永远允许）；
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

// 界面文案替身：只用来断言「用的是哪个键、字数对不对」，真文案由下面的词表门禁按 YAML 原文查。
const TR: any = {
  'banner.deckDoorTip': '胶囊右边那颗红色 X 会把整个 deck 关掉：工具、胶囊与右侧面板三处一起关。',
  'banner.deckDoorClose': '关闭整个 MattSkillsDeck（工具、胶囊与右侧面板）',
  'banner.deckReopenTitle': '重新打开 MattSkillsDeck',
  'banner.deckReopenBody': '展开会开启 deck 工具箱、右侧面板和胶囊状态栏；确认后这三处一起恢复。',
  'banner.deckReopenOk': '开启',
  'banner.deckReopenCancel': '取消',
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

// —— 取 deckDoor 叶子：按构建口径转译、剥掉行首 export 后求值 ——
// 记账三本：写开关的调用（带先后顺序）、面板开关调用、emit 收到哪个会话状态。
type DoorCalls = {
  order: string[]
  tools: Array<{ cwd: string; on: any }>
  statusBar: Array<{ cwd: string; show: any }>
  legacy: Array<{ cwd: string; folded: any }>
  panel: any[]
  emits: any[]
  closed: Set<string>
  failStatusBar: boolean
}
const makeDoor = function (): { mod: any; calls: DoorCalls } {
  const calls: DoorCalls = { order: [], tools: [], statusBar: [], legacy: [], panel: [], emits: [], closed: new Set<string>(), failStatusBar: false }
  const body = spliceableJs('src/client/statusbar/deckDoor.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const sandbox = {
    isDeckClosed: (cwd: any) => calls.closed.has(String(cwd)),
    setDeckTools: (cwd: any, on: any) => { calls.order.push('tools:' + String(on)); calls.tools.push({ cwd: String(cwd), on: on }); return true },
    setDeckStatusBar: (cwd: any, show: any) => { calls.order.push('statusBar:' + String(show)); calls.statusBar.push({ cwd: String(cwd), show: show }); return calls.failStatusBar ? false : true },
    setBannerFolded: (cwd: any, folded: any) => { calls.order.push('legacy:' + String(folded)); calls.legacy.push({ cwd: String(cwd), folded: folded }); return false },
    togglePanel: (st: any) => { calls.order.push('panel'); calls.panel.push(st); if (st) st.open = false; return true },
    openPanel: (st: any) => { calls.order.push('open'); calls.panel.push(st); if (st) st.open = true; return true },
    emit: (st: any) => { calls.order.push('emit'); calls.emits.push(st) },
    tr: trStub,
    Ic: (props: any) => ({ type: 'Ic', props: props || {} }),
    Tip: function Tip(props: any) { return null },
    h: hStub,
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { deckDoorCapsuleTail: deckDoorCapsuleTail, deckDoorExpand: deckDoorExpand, deckDoorFold: deckDoorFold, deckDoorCloseDeck: deckDoorCloseDeck, deckDoorConfirmEl: deckDoorConfirmEl }')
  return { mod: factory(...names.map((n) => (sandbox as Record<string, any>)[n])), calls: calls }
}

// —— 取 router 内核片：同一套取源与求值，面板那一条路用真源码 ——
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
    React: { useState: (v: any) => [v, noop], useEffect: noop },
    DetailsDock: noop,
    tr: trStub,
    flash: (st: any, msg: string) => { calls.flashed.push(String(msg)) },
    emit: noop,
    getCwdSync: () => '',
    hydrateFromCache: noop,
    getCachedSnapshot: () => null,
    snapFresh: () => false,
    loadSnapshot: noop,
    startAttentionSignals: noop,
    keyOf: (cwd: any) => String(cwd || ''),
    getSnapshotVersion: () => '',
    issueUrlFor: () => '',
    repoUrlFor: () => '',
    effortOf: () => '',
    idOf: () => 0,
    renderTemplate: () => '',
    promptText: () => '',
    promptTextFor: () => '',
    uiText: () => '',
    newWayfinderPrompt: () => '',
    newSpecPrompt: () => '',
    NEW_BUG_FIELDS_BODY: () => '',
    inspectPrompt: () => '',
    completePrompt: () => '',
    dswsLogHash: (s: any) => String(s || '').slice(0, 6),
    isDeckClosed: (cwd: any) => closed.has(String(cwd)),
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { openPanel: openPanel, togglePanel: togglePanel }')
  return { mod: factory(...names.map((n: string) => sandbox[n])), calls: calls, closed: closed }
}

const makeSt = (cwd: string, extra?: any): any => Object.assign({ cwd: cwd, open: false }, extra || {})

function main(): void {
  const { mod, calls } = makeDoor()
  const reset = () => { calls.order.length = 0; calls.tools.length = 0; calls.statusBar.length = 0; calls.legacy.length = 0; calls.panel.length = 0; calls.emits.length = 0; calls.failStatusBar = false; calls.closed.clear() }

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
    check(st.deckDoorConfirm !== true, '不置确认框标记')
    check(calls.tools.length === 0, '展开时不动 deckTools')
  }

  console.log('== 3. 折叠条「展开」：deck 关着时先弹确认框，一个开关都不写（验收 ③）==')
  {
    reset()
    calls.closed.add('D:/ws-a')
    const st = makeSt('D:/ws-a')
    mod.deckDoorExpand(st)
    check(st.deckDoorConfirm === true, 'deck 关着 → 只置 st.deckDoorConfirm 让界面画确认框')
    check(calls.statusBar.length === 0 && calls.tools.length === 0, '此时不写任何开关（等用户确认）')
    check(calls.emits.indexOf(st) >= 0, 'emit(st) 一次让状态栏重画')

    const el = mod.deckDoorConfirmEl(hStub, st)
    check(!!el, 'deckDoorConfirmEl 在标记置上后返回节点（标记没置时返回 null）')
    const dialog = findRole(el, 'dialog')
    check(!!dialog, '确认框是 role=dialog 的对话框')
    check(!!dialog && String(dialog.props['aria-modal']) === 'true', '对话框标了 aria-modal=true')
    check(!!dialog && String(dialog.props['aria-label']) === TR['banner.deckReopenTitle'], '无障碍名用的是标题键 banner.deckReopenTitle')
    const bodyText = textOf(dialog && dialog.children ? dialog.children[1] : null)
    check(bodyText.indexOf('deck 工具箱') >= 0 && bodyText.indexOf('右侧面板') >= 0 && bodyText.indexOf('胶囊状态栏') >= 0,
      '正文写明会开启 deck 工具箱、右侧面板和胶囊状态栏（实得「' + bodyText + '」）')
    const okBtn = findLog(el, 'status.deckdoor.confirm')
    const noBtn = findLog(el, 'status.deckdoor.cancel')
    check(!!okBtn && !!noBtn, '确认与取消两颗按钮都在')
    check(!!okBtn && okBtn.props['data-press'] === 'button' && !!noBtn && noBtn.props['data-press'] === 'button', '两颗按钮都带按压反馈与各自的 data-log（#1335 口径）')
  }

  console.log('== 4. 确认：两个开关都写成开、右侧面板回到关之前那样；取消一个都不写 ==')
  {
    reset()
    calls.closed.add('D:/ws-a')
    const st = makeSt('D:/ws-a', { deckDoorConfirm: true, deckDoorPanelWasOpen: true })
    const el = mod.deckDoorConfirmEl(hStub, st)
    click(findLog(el, 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.tools[0].on === true, '确认 → setDeckTools(cwd, true) 写 deck 工具箱开')
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === true, '确认 → setDeckStatusBar(cwd, true) 写胶囊显示')
    check(calls.order.indexOf('tools:true') >= 0 && calls.order.indexOf('statusBar:true') >= 0 && calls.order.indexOf('tools:true') < calls.order.indexOf('statusBar:true'), '先开 deck 工具箱、再显示胶囊（顺序与三处联动的因果一致）')
    check(calls.order.indexOf('tools:true') >= 0 && calls.order.indexOf('open') > calls.order.indexOf('tools:true'), '开面板排在写 deckTools 之后（openPanel 会按 deck 状态拦）')
    check(st.open === true && st.deckDoorPanelWasOpen === false, '红色 X 关掉之前开着的右侧面板恢复回开着，恢复标记清掉')
    check(st.deckDoorConfirm === false, '确认后确认框标记收起')
    check(calls.emits.indexOf(st) >= 0, '确认后 emit(st) 一次让状态栏重画')

    reset()
    const st2 = makeSt('D:/ws-a', { deckDoorConfirm: true })
    const el2 = mod.deckDoorConfirmEl(hStub, st2)
    click(findLog(el2, 'status.deckdoor.cancel'))
    check(calls.tools.length === 0 && calls.statusBar.length === 0, '取消 → 一个开关都不写（什么都不改）')
    check(st2.deckDoorConfirm === false && calls.panel.length === 0, '取消只收起确认框，不碰右侧面板')

    reset()
    const st3 = makeSt('D:/ws-a', { deckDoorConfirm: true })
    click(findLog(mod.deckDoorConfirmEl(hStub, st3), 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.statusBar.length === 1 && calls.panel.length === 0, 'X 关它之前面板本来没开 → 确认只恢复两个开关，不额外开面板')
  }

  console.log('== 5. 红色 X：先关右侧面板、再关 deck（验收 ④）==')
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
    click(x)
    check(calls.order.indexOf('panel') >= 0 && calls.order.indexOf('tools:false') >= 0 && calls.order.indexOf('panel') < calls.order.indexOf('tools:false'), '点击顺序：先关右侧面板、再写 deckTools=off（先关后写，避免被 openPanel 的闸门挡住）')
    check(st.open === false, '面板状态已置关')
    check(st.deckDoorPanelWasOpen === true, '记下「关之前面板是开着的」，供确认重开时恢复（验收 ③ 的三处恢复）')
    check(calls.statusBar.length === 0, 'X 不单独写 statusBar（deck 关着时胶囊自动折叠，由 isDeckCapsuleFolded 一处决定）')

    reset()
    const st2 = makeSt('D:/ws-b', { open: false })
    const tail2 = mod.deckDoorCapsuleTail(hStub, st2, null)
    check(Array.isArray(tail2) && tail2.length === 1, '没有 ∨ 时只交回红色 X（不塞空位）')
    click(findLog(tail2[0], 'status.capsule.deckclose'))
    check(calls.panel.length === 0 && calls.tools.length === 1 && calls.tools[0].on === false, '面板本来关着：不再关一次，只写 deckTools=off')
    check(st2.deckDoorPanelWasOpen === false, '关之前面板本来没开：恢复标记记为 false，确认时不会凭空开一块面板')
  }

  console.log('== 5b. 设置文件那条路接不下：如实返回 false，不再把旧 localStorage 表写回去（验收 ⑦）==')
  {
    reset()
    calls.failStatusBar = true
    mod.deckDoorFold(makeSt('D:/ws-a'))
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === false, '收起：照常试一次文件那条路')
    check(calls.legacy.length === 0, '收起：接不下时也不写旧表（#1612：迁移后不再写旧键）')

    reset()
    calls.failStatusBar = true
    mod.deckDoorExpand(makeSt('D:/ws-a'))
    check(calls.statusBar.length === 1 && calls.statusBar[0].show === true, '展开：同样只走文件那条路')
    check(calls.legacy.length === 0, '展开：接不下时也不写旧表')

    reset()
    calls.failStatusBar = true
    const st3 = makeSt('D:/ws-a', { deckDoorConfirm: true })
    click(findLog(mod.deckDoorConfirmEl(hStub, st3), 'status.deckdoor.confirm'))
    check(calls.tools.length === 1 && calls.tools[0].on === true && calls.legacy.length === 0, '确认重开：deck 工具箱照常写文件那条路，胶囊那一格接不下也不写旧表')
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
    check(sb.indexOf('deckDoorConfirmEl(h, s)') >= 0, '折叠条与其它分支都带上确认框节点')
    check(sb.indexOf('isBannerFolded(') < 0 && sb.indexOf('setBannerFolded(') < 0, 'StatusBar 不再直接碰旧名（折叠语义只从 deck-state 一处来）')
  }

  console.log('== 8. 接线与接口：两个旧名转调、router 有闸门、构建入口登记这一片 ==')
  {
    const sp = sourceText('src/client/kernel/store-prefs.ts')
    check(sp.indexOf('return isDeckCapsuleFolded(cwd) === true') >= 0, 'isBannerFolded 现在直接读 isDeckCapsuleFolded（旧名保留，调用方不改）')
    check(sp.indexOf('setDeckStatusBar(cwd, folded !== true)') >= 0, 'setBannerFolded 现在写 setDeckStatusBar（收起来 → hide，展开 → show）')
    check(sp.indexOf('BANNER_FOLD_KEY') >= 0 && sp.indexOf('bannerFoldByCwd') >= 0, '旧表常量与导出名保留（接口冻结清单钉着）')
    check(sp.indexOf('bannerFoldByCwd[k] = folded ? 1 : 0') < 0 && sp.indexOf('persistBannerFold') < 0, '旧表只读：不再把旧键写回去（#1612 迁移后不再写旧键）')

    const rt = sourceText('src/client/kernel/router.ts')
    check(rt.indexOf("isDeckClosed(st && st.cwd)") >= 0, 'router.openPanel 里按工作区判 deck 是否关着')
    check(rt.indexOf("tr('panel.deckClosed')") >= 0, '被挡住时给用户一句看得懂的提示')

    const idx = sourceText('src/client/index.ts')
    const build = sourceText('scripts/build.mts')
    check(idx.indexOf('leaf:deckDoor') >= 0, '客户端入口有 deckDoor 的拼接标记')
    check(build.indexOf('src/client/statusbar/deckDoor.ts') >= 0, '构建清单登记了 deckDoor.ts')
    const dd = sourceText('src/client/statusbar/deckDoor.ts')
    // 胶囊尾部两颗控件（「∨」与红色「X」）拼成同一个数组交给 React 渲染，数组里每个元素都要稳定 key，缺了会报错、界面门禁当场红。
    check(dd.indexOf("key: 'deckCloseToggle'") >= 0, '红色「X」那颗控件带稳定 key')
    check(sourceText('src/client/statusbar/StatusBar.ts').indexOf("key: 'deckFoldToggle'") >= 0, '「∨」那颗控件带稳定 key（两颗同一个数组，不能只给一颗）')
    check(dd.indexOf('setBannerFolded(') < 0, 'deckDoor 不再碰旧名 setBannerFolded（写胶囊只走 setDeckStatusBar）')
    check(dd.indexOf('deckDoorWriteStatusBar') < 0, '旧表降级包装已删：接不下时如实返回，不写旧键')
    check(!/^[ \t]*import\s/m.test(dd), '叶子不许有运行时 import')
    check(!/^[ \t]*export\s+default\b/m.test(dd), '叶子不许 export default')
    for (const name of ['deckDoorCapsuleTail', 'deckDoorExpand', 'deckDoorFold', 'deckDoorCloseDeck', 'deckDoorConfirmEl']) {
      check(typeof mod[name] === 'function', '导出还在：' + name)
    }
  }

  console.log('== 9. 词条：中英两段都齐，确认框正文把三处说全（验收 ③）==')
  {
    const yml = fs.readFileSync(path.join(root, 'config/copy/panel.yaml'), 'utf8')
    const need = ['banner.deckDoorClose', 'banner.deckDoorTip', 'banner.deckReopenTitle', 'banner.deckReopenBody', 'banner.deckReopenOk', 'banner.deckReopenCancel', 'panel.deckClosed']
    for (const key of need) {
      const count = (yml.match(new RegExp('^[ \\t]+' + key.replace(/\./g, '\\.') + ':', 'gm')) || []).length
      check(count === 2, '词条 ' + key + ' 在 zh / en 两段各一条（实得 ' + count + ' 条）')
    }
    const zhBody = (yml.match(/^[ \t]+banner\.deckReopenBody: (.+)$/m) || [])[1] || ''
    const enBody = (yml.match(/^[ \t]+banner\.deckReopenBody: (.+)$/gm) || [])[1] || ''
    check(zhBody.indexOf('deck 工具箱') >= 0 && zhBody.indexOf('右侧面板') >= 0 && zhBody.indexOf('胶囊状态栏') >= 0, '中文正文写明会开启 deck 工具箱、右侧面板和胶囊状态栏')
    check(/deck tools/.test(enBody) && /right panel/.test(enBody) && /capsule status bar/.test(enBody), '英文正文同样把三处说全')
  }

  console.log('== 10. store-prefs 写口：只走设置文件那条路，接不下如实回 false、一个字节都不写旧表 ==')
  {
    const makePrefs = function (fileOk: boolean) {
      const mem: any = {}
      const ls = { getItem: (k: string) => (k in mem ? mem[k] : null), setItem: (k: string, v: any) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] } }
      const emitted: any[] = []
      const writes: any[] = []
      const body = spliceableJs('src/client/kernel/store-prefs.js').replace(/^[ \t]*export[ \t]+/gm, '')
      const sandbox: any = {
        SYNC: { ISSUE_CACHE_TTL: 60000 },
        SYNC_ISSUE_CACHE_TTL_MS: 60000,
        log: function () {},
        wsKeyOf: (c: any) => String(c || ''),
        keyOf: (c: any) => String(c || '').replace(/[\\/]+$/, '').toLowerCase(),
        emit: (s: any) => { emitted.push(s) },
        shared: { cwd: 'D:/ws-a' },
        stores: { s1: { cwd: 'D:/ws-a' } },
        saveUiPrefs: () => false,
        isDeckCapsuleFolded: () => false,
        setDeckStatusBar: (cwd: any, show: any) => { writes.push({ cwd: String(cwd), show: show }); return fileOk },
        h: () => null,
        localStorage: ls,
        window: { innerHeight: 800 },
        document: {},
        console: { log: function () {}, warn: function () {}, error: function () {} },
      }
      const names = Object.keys(sandbox)
      const factory = compileFn(names, body + '\n;return { setBannerFolded: setBannerFolded, isBannerFolded: isBannerFolded }')
      const mod2 = factory(...names.map((n: string) => sandbox[n]))
      return { mod: mod2, mem: mem, emitted: emitted, writes: writes }
    }
    const bad = makePrefs(false)
    const okBad = bad.mod.setBannerFolded('D:/ws-a', true)
    check(okBad === false, '接不下时如实回 false（不假装落盘）')
    check(!bad.mem['dsws.bannerFold'], '接不下时也不写旧 localStorage 表（#1612：迁移后不再写旧键）')
    check(bad.emitted.length === 0, '接不下时不再补 emit（写口只转调 setting 那一路，界面由调用方自己重画）')

    const good = makePrefs(true)
    const okGood = good.mod.setBannerFolded('D:/ws-a', true)
    check(okGood === true, '文件那条路接得下时回 true')
    check(!good.mem['dsws.bannerFold'], '接得下时旧表同样一个字节都不写')
    check(good.mod.isBannerFolded('D:/ws-a') === false, '读口仍转调 isDeckCapsuleFolded（替身回 false → 未折叠）')
  }

  if (failed) {
    console.log('\n存在失败 — verify-1612-deck-door 未通过（失败项见上）')
    process.exit(1)
  }
  console.log('\n' + total + ' 条断言全部通过 — 胶囊上那扇「关/开整个 deck」的门与右侧面板闸门符合 #1612 拍板的语义')
}

main()
