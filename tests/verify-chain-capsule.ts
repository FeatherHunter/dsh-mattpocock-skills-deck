#!/usr/bin/env node
// verify-chain-capsule.ts —— 门禁：状态栏胶囊里「这个会话在办哪张票」那一段
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-chain-capsule.ts，可独立运行。
//
// #1271 起这一段只读一个来源：面板快照的 workRouteTable 字段（宿主 src/refresh/rooms/host/work-route-readout.ts
// 的产物，与工具回执 data.workRoute 同一份读数）；旧链的 workRoute 字段、碎片号、读数模块与旧叶子已退役。
// 门禁按组量：
//   A 判据（纯函数，不开浏览器）：没快照/没挂字段 → 空（整段不画）；表里没记录/当前会话没记录 → 空；
//     读坏了 → 原因透出（小图标）；对上格了 → 挑当前会话最新一条，标题按快照补，剩几条数出来。
//   B 版面纪律：真渲染出来的版面上没有内部行话与会话原文；空态不占位、坏态不独占一行。
//   C 折叠让位表没被动过（还是 12 段）与环境段那条词条已经落了。
//   D 同一份读数：胶囊判据与面板在办表读的是同一格（与 workRouteTableOf 对拍，不另抄一份期望值）。
//   E 地图那一条：认身份换图标，文字通道仍留号（#780）。
//   F #1404 表头单行：左右两簇、四段词条、两枚分隔线，外加 420 宽、跨天与陈旧标记；
//     末尾接 #1732 三条：单子打开即停在末行（在办单子沉底）、在办单子表头吸顶、高度跟着 DSH 窗口长。
// 【2026-10-12 清理】原先 B、C 两组里还有一批读文件文本钉形状的断言，断言对象都是
//   文件文本，按维护者「清掉读源码文本钉形状的门禁」的要求撤掉，逐条说明留在各组的注释里。
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { sourcePath, spliceableJs } from './lib/source-text.ts'
// #1511：编号写成「#目录/编号」的真实现住在 kernel/ticket-label.ts。本门禁按文本/模块单独加载视图叶子，
// 构建时那个闭包里才有的名字在这里不存在，所以补上真身 —— 不另抄一份规则，否则门禁会跟着实现一起漂。
;(globalThis as any).ticketLabelOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelOf
;(globalThis as any).ticketLabelNodesOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelNodesOf
;(globalThis as any).ticketLabelPartsOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelPartsOf
;(globalThis as any).ticketLabelCapsuleFoldOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelCapsuleFoldOf
;(globalThis as any).TICKET_LABEL_MAX_WIDTH = (await import('../src/client/kernel/ticket-label.js')).TICKET_LABEL_MAX_WIDTH
// #1564：整颗徽标收进共享叶子 ticketBadge.ts；叶子单独求值时闭包里没有这个名字，也补上真身。
;(globalThis as any).ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.js')).ticketBadgeOf
// 徽标自己的悬停壳 Tip 同样来自闭包：求值时合成的树只记节点、不调组件，给一个同形的纯函数即可。
;(globalThis as any).Tip = function (props: any): any { return props && props.children ? props.children : null }
// #1518：容器身份（探索地图 / 规格 / 普通票）的判据真源住在 kernel/container-view.ts。本门禁按模块单独加载视图叶子，
//   构建闭包里才有的名字这里也要补真身 —— 不另抄一份判定，否则门禁会跟着实现一起漂。
const realContainerKindOf = (await import('../src/client/kernel/container-view.js')).containerKindOf

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 门禁要从生成物里拿导出（例如界面词表 L_PAGES）时用它：按仓库相对路径动态导入，与别的门禁同一写法。
const imp = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)
let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }
const read = (rel) => {
  let real = rel
  try { const p = sourcePath(rel); if (p !== rel) real = p } catch (e) { real = rel }
  return readFileSync(resolve(ROOT, real), 'utf8')
}

const LEAF = 'src/client/statusbar/SessionChainCapsule.js'
// src/client 下的同名 .js 是构建产物（这一阶段要删），真源住在同名 .ts 里：先问取源入口它今天在哪一份。
//   两种扩展名都不存在时 sourcePath 会抛错，这里接住并照原来的样子报「缺文件」退出，不让异常栈代替提示。
let leafPath = ''
try { leafPath = resolve(ROOT, sourcePath(LEAF)) } catch (e) { leafPath = '' }
if (!leafPath || !existsSync(leafPath)) { console.log('缺文件 ' + LEAF); process.exit(1) }

// 在办表的真叶子（动作词条键、时钟与取数）：胶囊拼闭包时 ambient 的那三个名字就指它。
const tableLeaf = (function () {
  const src = spliceableJs('src/client/views/shared/workRouteTable.js').replace(/^[ \t]*export[ \t]+/gm, '')
  return compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h'],
    src + '\nreturn { WORK_ROUTE_TABLE_FIELD, workRouteActionKeyOf, workRouteTableClock, workRouteTableOf }')(
    { createElement: function () { return null }, useContext: function () { return null } },
    null, function () { return null }, function (k) { return String(k) }, function () { return null })
})()

// 与构建同一套做法：剥行首 export，丢进调用方给的作用域里跑。只动判据时给取数口即可；
// 渲染组件时把十六个名字给全（与构建拼闭包时带进来的同一套）。
function loadCap(deps) {
  const src = spliceableJs(LEAF).replace(/^[ \t]*export[ \t]+/gm, '')
  const factory = compileFn(
    ['React', 'DswsCtx', 'Tip', 'Ic', 'tr', 'pushNav', 'findMapByIdentity', 'openPanel', 'PortalOverlay', 'placeStatusOverlay', 'clearStatusClose', 'scheduleStatusClose', 'workRouteActionKeyOf', 'workRouteTableClock', 'workRouteTableOf', 'emit', 'containerKindOf'],
    src + '\nreturn { sessionChainCapsuleOf, SessionChainCapsule }')
  const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  const React = deps.React || {
    createElement: h,
    useContext: function () { return { h: h } },
    useRef: function (v) { return { current: v } },
    useState: function () { return [null, function () {}] },
  }
  return factory(React,
    deps.DswsCtx !== undefined ? deps.DswsCtx : null,
    deps.Tip || function () { return null },
    deps.Ic || function () { return null },
    deps.tr || function (k) { return String(k) },
    deps.pushNav || function () {},
    deps.findMapByIdentity || function () { return null },
    deps.openPanel || function () {},
    deps.PortalOverlay || function (o, kids) { return { overlay: true, props: o, children: kids } },
    deps.placeStatusOverlay || function () { return { left: 1, bottom: 2 } },
    deps.clearStatusClose || function () {},
    deps.scheduleStatusClose || function (r, fn) { fn() },
    deps.workRouteActionKeyOf || tableLeaf.workRouteActionKeyOf,
    deps.workRouteTableClock || tableLeaf.workRouteTableClock,
    deps.workRouteTableOf || tableLeaf.workRouteTableOf,
    deps.emit || function () {},
    deps.containerKindOf === null ? null : (deps.containerKindOf || realContainerKindOf))
}

// 拼一份在办表的新形状：读数只带票号/动作/时刻/会话归属，标题由胶囊按快照补。
function tableFor(entries) {
  return { ok: true, readout: { at: new Date().toISOString(), staleCount: 0, entries: entries } }
}
// 一条在办记录的新形状（currentSession 由宿主挂表时标好，胶囊只收标着的那几行）。
function entryOf(key, extra) {
  return Object.assign({ ticketKey: String(key), title: '', sessionLabel: 'sess-mine-aaa', action: 'edit', actionAt: new Date(Date.now() - 3600000).toISOString(), active: true, currentSession: true }, extra)
}

console.log('A) 判据：跟谁走、空态、坏态')
{
  const cap = loadCap({})
  const judge = cap.sessionChainCapsuleOf
  check(judge(null, 's1').state === 'idle', '没快照 → idle（调用方整段不画）')
  check(judge({ snapshot: {} }, 's1').state === 'idle', '字段没挂上 → idle（与没快照同一条：整段不画，不把「还没有」说成坏了）')
  check(judge({ snapshot: { workRouteTable: tableFor([]) } }, 's1').state === 'empty', '表里没记录 → empty（不把「还没有」说成坏了）')
  const other = judge({ snapshot: { workRouteTable: tableFor([entryOf('800', { title: '别人的票', sessionLabel: 'sess-other', currentSession: false })]) } }, 's1')
  check(other.state === 'empty', '当前会话没记录 → empty（不把别的会话的票算到当前头上）')
  // #1271：新存储读不到文件时直接给空表（ok:true + 空 entries），不再有 absent 这一档；
  //   上面「表里没记录 → empty」那一条守的就是这条路。
  const mine = judge({ snapshot: {
    issues: [{ key: '951', number: 951, title: '演示票', state: 'open', type: 'issue' }],
    workRouteTable: tableFor([
      entryOf('951', { title: '', actionAt: new Date(200).toISOString() }),
      entryOf('950', { title: '', actionAt: new Date(100).toISOString() }),
    ]),
  } }, 's1')
  check(mine.state === 'ok' && mine.entry && mine.entry.ticketKey === '951' && mine.list.length === 2 && mine.list[1].ticketKey === '950', '对上格 → 最新一条是 951，单子共 2 条')
  check(mine.entry && mine.entry.ticketTitle === '演示票', '标题按快照补（读数没带标题）')
  const broken = judge({ snapshot: { workRouteTable: { ok: false, reason: 'host.work-route.read-failed' } } }, 's1')
  check(broken.state === 'unreadable' && broken.reason === 'host.work-route.read-failed', '真坏了 → 原因透出（调用方画小图标，不独占一行）')
}
console.log('B) 版面纪律：真渲染出来的版面上没有内部行话与会话原文')
{
  // 【已删除】原先 B 组开头是六条读源码文本的断言，断言对象都是源码文本的写法，
  //   按维护者「清掉读源码文本钉形状的门禁」的要求整组撤掉。下面留的是真渲染出来的版面读数。
  // 真渲染两条：版面只有号；单子打开时是当前会话的单子（行上挂着跳转）
  const leafR = (function () {
    const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
    const box = { init: false, active: null }
    const React = {
      createElement: h,
      useContext: function () { return { h: h } },
      useRef: function (v) { return { current: v } },
      useState: function (v) { if (!box.init) { box.init = true; box.active = v } return [box.active, function (nv) { box.active = nv }] },
    }
    return loadCap({ React: React })
  })()
  const st = { snapshot: {
    issues: [{ key: '951', number: 951, title: '很长很长的标题很长很长的标题', state: 'open', type: 'issue' }],
    workRouteTable: tableFor([
      entryOf('951', { title: '', actionAt: new Date(Date.now() - 3600000).toISOString() }),
      entryOf('950', { title: '', actionAt: new Date(Date.now() - 7200000).toISOString() }),
    ]),
  } }
  const shut = leafR.SessionChainCapsule({ st: st, sid: 's1' })
  const flat = []
  ;(function walk(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { flat.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk) }
  })(shut)
  // 版面那个号：普通票与容器都写完整编号（#1553 起容器不再写裸号，见 E 节）。
  const faces = flat.filter(function (s) { return /^#?\d{1,10}$/.test(s) || /^\d{1,10}$/.test(s) })
  check(flat.join('').indexOf('#951') >= 0 && faces.length === 1, '单子没打开时版面只有一个号（标题再长也不上版面）')
  check(flat.some(function (s) { return s.indexOf('dsws-chainmenu') >= 0 }) === false, '单子没打开时版面上没有单子节点')
  st.chainMenuOpen = true
  st.chainMenuPos = { left: 1, bottom: 2 }
  const open = leafR.SessionChainCapsule({ st: st, sid: 's1' })
  const flat2 = []
  ;(function walk2(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { flat2.push(n); return }
    if (typeof n === 'object' && n.overlay === true) { flat2.push('[menu]'); (n.children || []).forEach(walk2); return }
    if (Array.isArray(n)) { n.forEach(walk2); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk2) }
  })(open)
  check(flat2.indexOf('[menu]') >= 0, '悬停打开的是同一套悬浮单子（与 BUG / 可接菜单同形）')
  check(flat2.join('').indexOf('#951') >= 0 && flat2.join('').indexOf('#950') >= 0, '单子里是当前会话的记录（两张都在，带标题；B 方案后目录与编号是相邻两段，拼起来读）')
  check(flat2.some(function (s) { return s.indexOf('sess-mine-aaa') >= 0 }) === false, '单子里没有会话原文（只计数、不泄标识）')
  const findRows = function (root) {
    const out = []
    ;(function walk(n) {
      if (n === null || n === undefined) return
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (typeof n === 'object' && !n.overlay) {
        if (n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0) out.push(n)
        ;(n.c || []).forEach(walk)
      } else if (typeof n === 'object') { (n.children || []).forEach(walk) }
    })(root)
    return out
  }
  const rows0 = findRows(open)
  check(rows0.length === 2 && rows0.every(function (r) { return r.p.style.background === 'transparent' }), '没悬停时两行都无底色')
  rows0[1].p.onMouseEnter()
  const hovered = leafR.SessionChainCapsule({ st: st, sid: 's1' })
  const rows1 = findRows(hovered)
  check(rows1[1].p.style.background === 'rgba(88,166,255,.12)' && rows1[0].p.style.background === 'transparent', '悬停哪行亮哪行（只有第二行高亮）')
  rows0[1].p.onMouseLeave()
  const left = leafR.SessionChainCapsule({ st: st, sid: 's1' })
  check(findRows(left).every(function (r) { return r.p.style.background === 'transparent' }), '鼠标离开后高亮收回')
  const firstAria = String(rows1[0].p['aria-label'] || '')
  const lastAria = String(rows1[rows1.length - 1].p['aria-label'] || '')
  check(firstAria.indexOf('#950') === 0 && lastAria.indexOf('#951') === 0, '旧在上新在下（首行 #950，末行 #951）')
  check(rows1[rows1.length - 1].p.className.indexOf('is-latest') >= 0 && rows1[0].p.className.indexOf('is-latest') < 0, '最新标识落在沉底那一行')
  check(rows1.every(function (r) { return String(r.p['aria-label'] || '').indexOf('·') < 0 }), '行内不用 · 分隔')
  const pillBadges = []
  ;(function walkPill(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(walkPill); return }
    if (typeof n === 'object' && !n.overlay) {
      if (n.p && n.p.style && n.p.style.borderRadius === 99 && typeof n.c !== 'undefined') {
        const texts = []
        ;(function inner(m) {
          if (typeof m === 'string') texts.push(m)
          else if (Array.isArray(m)) m.forEach(inner)
          else if (m && typeof m === 'object') (m.c || []).forEach(inner)
        })(n.c)
        if (texts.some(function (t) { return /^#?\d{1,10}$/.test(t) })) pillBadges.push(texts.join(''))
      }
      ;(n.c || []).forEach(walkPill)
    } else if (typeof n === 'object') { (n.children || []).forEach(walkPill) }
  })(hovered)
  check(pillBadges.length === 2 && pillBadges.some(function (t) { return t === '#950' }) && pillBadges.some(function (t) { return t === '#951' }), '号做成了徽章（两行的号徽章各就各位）')
}
console.log('C) 接线：折叠让位表与环境段')
{
  // 【已删除】原先 C 组开头是六条读文件文本的断言，断言对象全是文件文本的写法，
  //   按维护者「清掉读源码文本钉形状的门禁」的要求整组撤掉。下面留的是真函数与词条。
  const capFoldSrc = spliceableJs('src/client/statusbar/capFold.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const capFold = compileFn([], capFoldSrc + '\nreturn { CAP_FOLD_POLICY }')()
  const keys = Object.keys(capFold.CAP_FOLD_POLICY || {}).sort(function (a, b) { return Number(a) - Number(b) })
  check(JSON.stringify(keys) === JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']), '让位表是 12 段（环境计数 5 早于时间，在办编号 12 排在最后）')
  const zh = read('src/client/kernel/locale-pages.js')
  check(zh.indexOf("'chainView.capsuleDoing'") >= 0, '中英文词条 chainView.capsuleDoing 已落（zh/en 各一）')
}

console.log('D) 同一份读数：胶囊与面板在办表读同一格')
{
  // #1271：两处都只认快照上 WORK_ROUTE_TABLE_FIELD 那一格；在办表改形状，胶囊必须跟着变，
  //   否则面板与胶囊各说各话。这里拿真叶子对拍，不另抄一份期望值。
  const st = { snapshot: { workRouteTable: tableFor([entryOf('951'), entryOf('950')]) } }
  const tview = tableLeaf.workRouteTableOf(st)
  const cap = loadCap({}).sessionChainCapsuleOf(st, 's1')
  check(tview.state === 'ok' && tview.rows.length === 2, '在办表读出两行')
  check(cap.state === 'ok' && cap.list.length === tview.rows.length && cap.entry.ticketKey === tview.rows[0].ticketKey, '胶囊挑的那一条就是表里第一行，条数一致')
  check(tableLeaf.WORK_ROUTE_TABLE_FIELD === 'workRouteTable', '两处认的是同一个字段名')
}
console.log('E) 容器那一条（地图与规格）：认身份换图标，文字通道仍留号（#780 / #1518）')
{
  // 【已删除】原先这里读 LEAF 的源码文本断言地图图标，断言对象是源码文本的写法，撤掉；
  //   版面是不是地图图标由下面真渲染的图标与号徽章读数守。
  // 容器身份统一问 kernel/container-view.ts 的 containerKindOf（#1518 起本文件只调用，不再自己比 type）：
  //   探索地图（type='map'）与规格（type='spec'）都算容器；普通票不是容器。
  const st = { snapshot: {
    issues: [
      { key: '40', number: 40, title: '某地图', state: 'open', type: 'map' },
      { key: '780', number: 780, title: '普通票', state: 'open', type: 'issue' },
      { key: '1460', number: 1460, title: '规格容器', state: 'open', type: 'spec' },
    ],
    // 真实的规格容器与探索地图一样坐在 snapshot.maps 里：点开去向不能只看「找不找得到地图对象」。
    maps: [
      { key: '40', number: 40, tickets: [] },
      { key: '1460', number: 1460, tickets: [] },
    ],
    workRouteTable: tableFor([
      entryOf('40', { title: '', actionAt: new Date(Date.now() - 3600000).toISOString() }),
      entryOf('780', { title: '', actionAt: new Date(Date.now() - 7200000).toISOString() }),
      entryOf('1460', { title: '', actionAt: new Date(Date.now() - 10800000).toISOString() }),
    ]),
  } }
  const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  const icons = []
  const nav: any[] = []
  const built = loadCap({
    React: { createElement: h, useContext: function () { return { h: h } }, useRef: function (v) { return { current: v } }, useState: function () { return [null, function () {}] } },
    Ic: function (props) { icons.push(props && props.n); return { t: 'Ic', p: props || {}, c: [] } },
    pushNav: function (_st: any, kind: any, num: any) { nav.push({ kind: kind, num: num }) },
    findMapByIdentity: function (list: any, n: any) { let hit: any = null; (Array.isArray(list) ? list : []).forEach(function (m: any) { if (!hit && m && String(m.key) === String(n)) hit = m }); return hit },
  })
  const shut = built.SessionChainCapsule({ st: st, sid: 's1' })
  const flat = []
  ;(function walk(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { flat.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk) }
  })(shut)
  check(flat.join('').indexOf('#40') >= 0, '#1553 地图那一条版面上是完整编号 #40（地图图标仍在，见下一条）')
  check(icons.indexOf('map') >= 0 && icons.indexOf('pin') >= 0, '地图那一条同时有图钉与地图图标')
  const foldSlots = []
  ;(function collect(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(collect); return }
    if (typeof n !== 'object') return
    if (n.p && n.p['data-fold-priority'] !== undefined) foldSlots.push(n)
    ;(n.c || []).forEach(collect)
  })(shut)
  check(foldSlots.length === 1, '整条胶囊上只有一个挂让位号的元素')
  check(foldSlots.every(function (s) { return (s.c || []).every(function (x) { return typeof x === 'string' }) }), '挂让位号的元素里没有元素子节点（收字机器写 textContent 时抹不掉图标）')
  st.chainMenuOpen = true
  st.chainMenuPos = { left: 1, bottom: 2 }
  const open = built.SessionChainCapsule({ st: st, sid: 's1' })
  const rowNodes = []
  ;(function walkRows(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(walkRows); return }
    if (typeof n === 'object' && n.overlay) { (n.children || []).forEach(walkRows); return }
    if (typeof n === 'object') {
      if (n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0) { rowNodes.push(n); return }
      ;(n.c || []).forEach(walkRows)
    }
  })(open)
  check(rowNodes.length === 3, '单子里三行都在（地图 / 普通票 / 规格容器）')
  const rowOf = function (key) { return rowNodes.filter(function (r) { return String(r.p['aria-label'] || '').indexOf('#' + key) >= 0 })[0] || null }
  const mapRow = rowOf('40')
  const plainRow = rowOf('780')
  const specRow = rowOf('1460')
  check(!!mapRow && !!plainRow && !!specRow, '单子里认得出哪一行是地图、哪一行是普通票、哪一行是规格容器')
  const pillOf = function (row) {
    let hit = null
    ;(function find(n) {
      if (hit || n === null || n === undefined) return
      if (Array.isArray(n)) { n.forEach(find); return }
      if (typeof n !== 'object') return
      if (n.p && n.p.style && n.p.style.borderRadius === 99) { hit = n; return }
      ;(n.c || []).forEach(find)
    })(row)
    return hit
  }
  const textsIn = function (n) {
    const out = []
    ;(function inner(m) {
      if (typeof m === 'string') { out.push(m); return }
      if (Array.isArray(m)) { m.forEach(inner); return }
      if (m && typeof m === 'object') (m.c || []).forEach(inner)
    })(n && n.c)
    return out
  }
  const hasIcon = function (n, name) {
    let hit = false
    ;(function find(m) {
      if (hit || m === null || m === undefined) return
      if (Array.isArray(m)) { m.forEach(find); return }
      if (typeof m !== 'object') return
      if (m.p && m.p.n === name) { hit = true; return }
      ;(m.c || []).forEach(find)
    })(n)
    return hit
  }
  const mapPill = mapRow ? pillOf(mapRow) : null
  const plainPill = plainRow ? pillOf(plainRow) : null
  const specPill = specRow ? pillOf(specRow) : null
  check(!!mapPill && hasIcon(mapPill, 'map') && textsIn(mapPill).join('').indexOf('#40') >= 0, '#1553 单子里地图那行的号徽章是「地图图标 + 完整编号 #40」（B 方案后目录与编号是相邻两段，拼起来读）')
  check(!!plainPill && textsIn(plainPill).join('').indexOf('#780') >= 0, '单子里普通票那行的号徽章仍是 #780（B 方案后目录与编号是相邻两段，拼起来读）')
  check(!!specPill && hasIcon(specPill, 'map') && textsIn(specPill).join('').indexOf('#1460') >= 0, '#1553 单子里规格容器那行的号徽章也是「地图图标 + 完整编号 #1460」（B 方案后目录与编号是相邻两段，拼起来读）')
  check(!!mapRow && String(mapRow.p['aria-label']).indexOf('#40') >= 0 && String(mapRow.p['aria-label']).indexOf('type.map') >= 0, '地图那行的无障碍名里仍是 #40 且带上类型词')
  check(!!plainRow && String(plainRow.p['aria-label']).indexOf('type.map') < 0, '普通票那行不冒充地图')
  check(!!specRow && String(specRow.p['aria-label']).indexOf('#1460') >= 0 && String(specRow.p['aria-label']).indexOf('type.spec') >= 0, '#1518 规格容器那行的无障碍名里仍是 #1460 且带上「规格」类型词')
  check(!!specRow && String(specRow.p['aria-label']).indexOf('type.map') < 0, '#1518 规格容器那行不冒充探索地图（类型词不是「地图」）')
  // #1518 交付说明点名的风险：画成容器之后点开去向不能错位。规格即使和地图一样躺在 snapshot.maps 里，
  //   也仍落票详情那条路（严格只认 'map' 才压地图栈）；探索地图与普通票两条老路各自不动。
  const clickRow = function (row: any) { row.p.onClick({ stopPropagation: function () {} }) }
  nav.length = 0
  clickRow(specRow)
  check(nav.length === 1 && nav[0].kind === 'map' && nav[0].num === 1460, '#1553 点开规格行进容器详情（与面板 workRouteNavOf 同口径：spec 压 map 栈；#1518 的票详情口径已推翻；实得 ' + JSON.stringify(nav) + '）')
  nav.length = 0
  clickRow(mapRow)
  check(nav.length === 1 && nav[0].kind === 'map' && nav[0].num === 40, '#1518 点开探索地图行仍进地图详情页（实得 ' + JSON.stringify(nav) + '）')
  nav.length = 0
  clickRow(plainRow)
  check(nav.length === 1 && nav[0].kind === 'issue' && nav[0].num === 780, '#1518 点开普通票行仍落票详情（实得 ' + JSON.stringify(nav) + '）')
  // #1518：同一票号出现在两个工作目录时，行上的种类与标题按（工作单元，票号）认，不再撞成别目录那张票。
  const twinSt: any = { snapshot: {
    issues: [
      { key: '5', number: 5, title: 'A 目录的规格', state: 'open', type: 'spec', effortId: 'dirA' },
      { key: '5', number: 5, title: 'B 目录的普通票', state: 'open', type: 'issue', effortId: 'dirB' },
    ],
    workRouteTable: tableFor([
      entryOf('5', { title: '', effortId: 'dirB', actionAt: new Date(Date.now() - 3600000).toISOString() }),
      entryOf('5', { title: '', effortId: 'dirA', actionAt: new Date(Date.now() - 7200000).toISOString() }),
    ]),
  } }
  const twin = loadCap({}).sessionChainCapsuleOf(twinSt, 's1')
  const twinOf = function (eff: string) { return (twin.list || []).filter(function (r: any) { return r.effortId === eff })[0] || null }
  const twinB = twinOf('dirB')
  const twinA = twinOf('dirA')
  check(!!twinB && twinB.containerKind === '' && twinB.ticketTitle === 'B 目录的普通票', '#1518 同号两目录：B 目录那行认得自己的普通票身份（实得 ' + JSON.stringify({ kind: twinB && twinB.containerKind, title: twinB && twinB.ticketTitle }) + '）')
  check(!!twinA && twinA.containerKind === 'spec' && twinA.ticketTitle === 'A 目录的规格', '#1518 同号两目录：A 目录那行认得自己的规格身份（实得 ' + JSON.stringify({ kind: twinA && twinA.containerKind, title: twinA && twinA.ticketTitle }) + '）')
  // #1518：判据里每一行都带着容器种类（空串 / 'map' / 'spec'），版面与文字通道都读它，不再各处自己比 type。
  const kinds = loadCap({}).sessionChainCapsuleOf(st, 's1')
  const kindOfKey = function (key) { const hit = (kinds.list || []).filter(function (r) { return r.ticketKey === key })[0]; return hit ? hit.containerKind : '?' }
  check(!!kinds.entry && kinds.entry.containerKind === 'map', '#1518 判据：地图那一条带着容器种类 map（实得 ' + JSON.stringify(kinds.entry && kinds.entry.containerKind) + '）')
  check(kindOfKey('1460') === 'spec' && kindOfKey('780') === '', '#1518 判据：规格容器带 spec、普通票带空串（实得 ' + JSON.stringify(kindOfKey('1460')) + ' / ' + JSON.stringify(kindOfKey('780')) + '）')
  // #1518：规格容器进主胶囊时同样换图标、文字通道补「规格」类型词（与悬停单子那条读的是同一个判据）。
  const specOnly: any = { snapshot: {
    issues: [{ key: '1460', number: 1460, title: '规格容器', state: 'open', type: 'spec' }],
    workRouteTable: tableFor([entryOf('1460', { title: '' })]),
  } }
  const specIcons: any[] = []
  const builtSpec = loadCap({ Ic: function (props) { specIcons.push(props && props.n); return { t: 'Ic', p: props || {}, c: [] } } })
  const specShut = builtSpec.SessionChainCapsule({ st: specOnly, sid: 's1' })
  const specFlat: any[] = []
  ;(function walk2(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { specFlat.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk2); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk2) }
  })(specShut)
  let specAria = ''
  ;(function findAria(n) {
    if (!n || specAria) return
    if (Array.isArray(n)) { n.forEach(findAria); return }
    if (typeof n !== 'object') return
    if (n.p && typeof n.p['aria-label'] === 'string' && n.p['aria-label'].indexOf('chainView.capsuleDoing') >= 0) { specAria = n.p['aria-label']; return }
    ;(n.c || []).forEach(findAria)
  })(specShut)
  check(specFlat.join('').indexOf('#1460') >= 0, '#1553 主胶囊里规格容器是完整编号 #1460（地图图标仍在，见下一条）')
  check(specIcons.indexOf('map') >= 0, '#1518 主胶囊里规格容器那一条也画地图图标（与地图同形）')
  check(specAria.indexOf('#1460') >= 0 && specAria.indexOf('type.spec') >= 0, '#1518 主胶囊的无障碍名里仍是 #1460 且带上「规格」类型词（实得 ' + JSON.stringify(specAria) + '）')
  // #1518：门禁按模块单独加载本文件时，内核 containerKindOf 不在作用域里（构建闭包里才带进来）。
  //   守卫要退回同一口径的退化判定 —— 规格仍按容器画，而不是整条胶囊抛错或退化成普通票。
  const fbIcons: any[] = []
  const fbBuilt = loadCap({ containerKindOf: null, Ic: function (props: any) { fbIcons.push(props && props.n); return { t: 'Ic', p: props || {}, c: [] } } })
  const fbShut = fbBuilt.SessionChainCapsule({ st: specOnly, sid: 's1' })
  const fbFlat: any[] = []
  ;(function walkFb(n: any) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { fbFlat.push(n); return }
    if (Array.isArray(n)) { n.forEach(walkFb); return }
    if (typeof n === 'object') { (n.c || []).forEach(walkFb) }
  })(fbShut)
  let fbAria = ''
  ;(function findFb(n: any) {
    if (!n || fbAria) return
    if (Array.isArray(n)) { n.forEach(findFb); return }
    if (typeof n !== 'object') return
    if (n.p && typeof n.p['aria-label'] === 'string' && n.p['aria-label'].indexOf('chainView.capsuleDoing') >= 0) { fbAria = n.p['aria-label']; return }
    ;(n.c || []).forEach(findFb)
  })(fbShut)
  check(fbFlat.join('').indexOf('#1460') >= 0, '#1553 内核不在时规格仍按容器画（退化判定回 spec，版面上是完整编号 #1460）')
  check(fbIcons.indexOf('map') >= 0 && fbAria.indexOf('type.spec') >= 0, '#1518 内核不在时规格仍画地图图标、文字通道仍带「规格」类型词（退化判定与内核同口径）')
}

console.log('G) #1553 容器 00 行：完整编号可点，不再静默没反应')
{
  // 本地后端每个目录的容器编号都是 00：徽章要写 `#目录/00` 完整形式，点了要进容器详情。
  // 回归点有两处：① chainKeyTextOf 曾对容器回裸号；② capsuleOpenTicket 把票号转数字，
  //   Number('00') = 0 撞上 n <= 0 的 early return，跳转代码到不了（面板照常打开，看着像点了没换内容）。
  const nowIso = new Date(Date.now() - 3600000).toISOString()
  // 快照形状按生产快照如实写：numOf 把容器 '00' 转成数字 0（读数存档里仍是字串 '00'），
  //   就近表靠 capsuleNumOf 把两边归一，两种写法都要认得出。
  const st00: any = { snapshot: {
    issues: [
      { key: '00', number: 0, title: '某目录的地图', state: 'open', type: 'map', effortId: 'demo' },
      { key: '00', number: '00', title: '某目录的规格', state: 'open', type: 'spec', effortId: 'demo2' },
    ],
    maps: [
      { key: '00', number: 0, tickets: [], effortId: 'demo' },
      { key: '00', number: '00', tickets: [], effortId: 'demo2' },
    ],
    workRouteTable: tableFor([
      entryOf('00', { title: '', effortId: 'demo', actionAt: nowIso }),
      entryOf('00', { title: '', effortId: 'demo2', actionAt: nowIso }),
    ]),
  } }
  const h = function (t: any, p: any) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  const nav00: any[] = []
  const built00 = loadCap({
    React: { createElement: h, useContext: function () { return { h: h } }, useRef: function (v: any) { return { current: v } }, useState: function () { return [null, function () {}] } },
    pushNav: function (_st: any, kind: any, num: any) { nav00.push({ kind: kind, num: num }) },
    // 真实现按（工作单元，编号）精确命中，新老快照另有数字兜底；这里照抄可比行为：编号按补零两位比。
    findMapByIdentity: function (list: any, n: any, eid: any) {
      let hit: any = null
      ;(Array.isArray(list) ? list : []).forEach(function (m: any) {
        if (!hit && m && String(m.key).padStart(2, '0') === String(n).padStart(2, '0') && String(m.effortId || '') === String(eid || '')) hit = m
      })
      return hit
    },
  })
  st00.chainMenuOpen = true
  st00.chainMenuPos = { left: 1, bottom: 2 }
  const open00 = built00.SessionChainCapsule({ st: st00, sid: 's1' })
  const rowNodes00: any[] = []
  ;(function walkRows(n: any) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(walkRows); return }
    if (typeof n === 'object' && n.overlay) { (n.children || []).forEach(walkRows); return }
    if (typeof n === 'object') {
      if (n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0) { rowNodes00.push(n); return }
      ;(n.c || []).forEach(walkRows)
    }
  })(open00)
  check(rowNodes00.length === 2, '#1553 单子里两行 00 都在（地图 / 规格各一行）')
  const pillTexts00 = function (row: any) {
    const out: any[] = []
    ;(function inner(m: any) {
      if (typeof m === 'string') { out.push(m); return }
      if (Array.isArray(m)) { m.forEach(inner); return }
      if (m && typeof m === 'object') (m.c || []).forEach(inner)
    })(row)
    return out
  }
  const mapRow00 = rowNodes00.filter(function (r: any) { return String(r.p['aria-label'] || '').indexOf('#demo/00') >= 0 })[0] || null
  const specRow00 = rowNodes00.filter(function (r: any) { return String(r.p['aria-label'] || '').indexOf('#demo2/00') >= 0 })[0] || null
  check(!!mapRow00 && pillTexts00(mapRow00).join('').indexOf('#demo/00') >= 0, '#1553 地图 00 行徽章写完整编号 #demo/00（B 方案后目录与编号是相邻两段，拼起来读；实得 ' + JSON.stringify(pillTexts00(mapRow00)) + '）')
  check(!!specRow00 && pillTexts00(specRow00).join('').indexOf('#demo2/00') >= 0, '#1553 规格 00 行徽章写完整编号 #demo2/00（B 方案后目录与编号是相邻两段，拼起来读；实得 ' + JSON.stringify(pillTexts00(specRow00)) + '）')
  nav00.length = 0
  mapRow00.p.onClick({ stopPropagation: function () {} })
  check(nav00.length === 1 && nav00[0].kind === 'map' && nav00[0].num === 0, '#1553 点地图 00 进容器详情，不再静默没反应（实得 ' + JSON.stringify(nav00) + '）')
  nav00.length = 0
  specRow00.p.onClick({ stopPropagation: function () {} })
  check(nav00.length === 1 && nav00[0].kind === 'map' && nav00[0].num === 0, '#1553 点规格 00 进容器详情，不再静默没反应（实得 ' + JSON.stringify(nav00) + '）')
}

console.log('F) #1404 表头单行：左右两簇、四段词条、两枚分隔线与尺寸契约')
{
  const nowMs = Date.now()
  // 「一小时前」在本地时间 0 点到 1 点之间会落到昨天，而推断这次只要求「最近一条是今天」；
  //   夹具落到昨天时表头时间会改显示「月-日 时:分」，断言就会在凌晨跑门禁时假红。这里把「就近」夹在今天之内。
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const freshAt = Math.max(startOfToday.getTime(), nowMs - 60 * 60 * 1000)
  const staleAt = nowMs - 25 * 60 * 60 * 1000
  const pad2 = function (n: any) { return (n < 10 ? '0' : '') + String(n) }
  const freshDay = new Date(freshAt)
  const freshHHmm = pad2(freshDay.getHours()) + ':' + pad2(freshDay.getMinutes())
  const h = function (t: any, p: any) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  // 期望文案不手抄：从词表生成物的中文段取词，再用与 tr 相同的占位符替换得到期望文本。
  //   （#1294：词表真源在 config/copy/pages.yaml，运行时代码与这里读的是同一份生成物 locale-data.ts；
  //     门禁里再抄一遍字面量就等于同一个值有两处定义，改 YAML 会假红。）
  const pagesUrl = sourcePath('src/client/kernel/locale-pages.js')
  const pages = (await imp(pagesUrl) as any).L_PAGES
  const zh = pages.zh
  const en = pages.en
  const CAP_HEAD_KEYS = ['chainView.capsuleHeaderTitle', 'chainView.capsuleHeaderOwn', 'chainView.capsuleHeaderOthers', 'chainView.readAtFull']
  check(CAP_HEAD_KEYS.every(function (k: any) { return zh[k] !== undefined && en[k] !== undefined }), '表头四段词条中英文都有（键对等）')
  const zhText = function (k: any, params?: any) {
    let s = (zh[k] !== undefined) ? String(zh[k]) : String(k)
    if (params) s = s.replace(/\{(\w+)\}/g, function (m: any, name: any) { return (name in params) ? String(params[name]) : m })
    return s
  }
  const trFor = function (calls: any[]) {
    return function (k: any, params: any) {
      calls.push({ k: String(k), params: params })
      return zhText(k, params)
    }
  }
  const textsOf = function (n: any): any[] {
    const out: any[] = []
    const walk = function (x: any) {
      if (x === null || x === undefined) return
      if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return }
      if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); return }
      if (typeof x === 'object') { const kids = childrenOf(x); for (let i = 0; i < kids.length; i++) walk(kids[i]) }
    }
    walk(n)
    return out
  }
  const nodesOf = function (n: any, tag: any): any[] {
    const out: any[] = []
    const walk = function (x: any) {
      if (x === null || x === undefined) return
      if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); return }
      if (typeof x !== 'object') return
      if (x.t === tag) out.push(x)
      const kids = childrenOf(x)
      for (let i = 0; i < kids.length; i++) walk(kids[i])
    }
    walk(n)
    return out
  }
  // 假 h 的 children 是「按参数原样装进 c」，传数组时会多一层嵌套；真 React 会拍平。
  //   这里按真 React 的语义把数组拍平，只留元素节点（字符串也留，后面对段文字还要用）。
  const childrenOf = function (n: any): any[] {
    const out: any[] = []
    const walk = function (x: any) {
      if (x === null || x === undefined) return
      if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); return }
      out.push(x)
    }
    const raw = n ? (Array.isArray(n.c) ? n.c : n.children) : null
    const kids = Array.isArray(raw) ? raw : []
    for (let i = 0; i < kids.length; i++) walk(kids[i])
    return out
  }
  const findMenu = function (n: any): any {
    let found: any = null
    const walk = function (x: any) {
      if (found || x === null || x === undefined || typeof x !== 'object') return
      if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); return }
      if (x.overlay === true) { found = x; return }
      const kids = childrenOf(x)
      for (let i = 0; i < kids.length; i++) walk(kids[i])
    }
    walk(n)
    return found
  }
  const isHeaderNode = function (n: any) {
    return !!n && typeof n === 'object' && n.p && n.p.style && n.p.style.fontSize === 11 && n.p.style.padding === '2px 8px'
  }
  const stringStyle = function (n: any) { return (n && n.p && n.p.style) ? n.p.style : {} }

  // 一、本会话两条（最近一条在今天内），别的会话两个、共三条 → 表头两簇齐全
  const trCalls: any[] = []
  const built = loadCap({ tr: trFor(trCalls) })
  const st = { snapshot: { workRouteTable: tableFor([
    entryOf('951', { title: 'fresh', actionAt: new Date(freshAt).toISOString() }),
    entryOf('950', { title: '', actionAt: new Date(staleAt).toISOString() }),
    entryOf('800', { title: 'other', sessionLabel: 'sess-other', currentSession: false, actionAt: new Date(freshAt).toISOString() }),
    entryOf('801', { title: 'other2', sessionLabel: 'sess-other', currentSession: false, actionAt: new Date(freshAt).toISOString() }),
    entryOf('802', { title: 'other3', sessionLabel: 'sess-third', currentSession: false, actionAt: new Date(freshAt).toISOString() }),
  ]) }, chainMenuOpen: true, chainMenuPos: { left: 1, bottom: 2 } }
  const open = built.SessionChainCapsule({ st: st, sid: 's1' })
  const menuNode: any = findMenu(open)
  check(!!menuNode, 'menu opens')
  const menuStyle: any = (menuNode && menuNode.props && menuNode.props.style) || {}
  check(menuStyle.width === 420 && menuStyle.maxWidth === 420 && menuStyle.maxHeight === 380, 'popover width 420 and max height 380（门禁里没有视口，退回旧值）')
  const menuKids: any[] = childrenOf(menuNode)
  check(!!menuKids[0] && menuKids[0].t === 'div', '表头是弹层里的第一个节点')
  const headerNodes = menuKids.filter(isHeaderNode)
  check(headerNodes.length === 1, '表头只有一个节点（不再有上下两行）')
  const head: any = menuKids[0]
  const hs: any = stringStyle(head)
  // 只断言「是不是一行、是不是横向摆」以及单行高的判据；不钉簇内间距、字重、省略号三件套这类内部样式。
  check(hs.display === 'flex' && hs.alignItems === 'center' && hs.whiteSpace === 'nowrap', '表头是一行不换行的横向 flex 行')
  check(hs.fontSize === 11 && hs.lineHeight === '18px' && hs.padding === '2px 8px', '字号 11px、行高 18px、上下内边距 2px（单行总高 22px）')
  check(head.p.tabIndex === undefined && head.p.role === undefined && head.p.onClick === undefined && head.p.onMouseEnter === undefined && head.p.onMouseLeave === undefined, '表头不可聚焦、不可点、没有悬停反馈')

  const clusters: any[] = childrenOf(head).filter(function (n: any) { return !!n && typeof n === 'object' && n.t })
  check(clusters.length === 2, '表头分成左右两簇')
  const left: any = clusters[0]
  const right: any = clusters[1]
  // 「右簇靠右」只看这一个结构抓手：自动外边距吸收两簇之间的空白，把右簇推到行尾。
  //   布局结果最终由浏览器算，像素级对齐由 D:\temp\1404-header-proof 的证明页人工核对；规格不新增像素级门禁。
  check(stringStyle(right).marginLeft === 'auto', '右簇用自动外边距推到行尾（自动外边距吸收两簇之间的空白）')

  const leftTexts = textsOf(left)
  const leftExpected = zhText('chainView.capsuleHeaderTitle') + zhText('chainView.capsuleHeaderOwn', { n: 2 }) + zhText('chainView.readAtFull', { time: freshHHmm })
  check(leftTexts.join('') === leftExpected, '左簇依次是标题、本会话条数、更新时间（实得 ' + leftTexts.join('') + '）')

  const hiddenSvg = function (s: any) { const p = (s && s.p) || {}; return p['aria-hidden'] === true || String(p['aria-hidden']) === 'true' }
  const svgs: any[] = nodesOf(head, 'svg')
  check(svgs.length === 2 && svgs.every(hiddenSvg), '表头里有两枚分隔线 SVG（都从无障碍树里隐藏）')

  const rightTexts = textsOf(right)
  check(rightTexts.join('') === zhText('chainView.capsuleHeaderOthers', { x: 2, y: 3 }), '右簇是一整句「另有 … 个会话在办 … 条」（实得 ' + rightTexts.join('') + '）')

  const callOf = function (key: string) { return trCalls.filter(function (c: any) { return c.k === key })[0] }
  check(!!callOf('chainView.capsuleHeaderTitle'), '短标题词条被调用')
  // 这两段词条取的是带占位符的原文，数字由切段函数替换后单独成节点（tr 因此不接参数）；
  //   参数对不对由上面「左簇整行文字」与「右簇整行文字」逐字对拍，不另断言内部切段方式。
  const ownCall: any = callOf('chainView.capsuleHeaderOwn')
  check(!!ownCall, '本会话条数词条被调用')
  const timeCall: any = callOf('chainView.readAtFull')
  check(!!timeCall && !!timeCall.params && timeCall.params.time === freshHHmm, '更新时间复用「{time} 更新」词条并带上本地时钟')
  const othersCall: any = callOf('chainView.capsuleHeaderOthers')
  check(!!othersCall, '「另有 …」词条被调用')
  check(!trCalls.some(function (c: any) { return c.k === 'chainView.capsuleHeaderLine1' || c.k === 'chainView.capsuleHeaderLine2' }), '两行表头的老词条不再被调用')

  const texts = textsOf(menuNode)
  const staleWord = zhText('chainView.capsuleStale')
  const staleWordHit = texts.some(function (s: any) { return s.indexOf(staleWord) >= 0 })
  check(staleWordHit, 'rows older than 24h carry the stale marker')
  const datedHit = texts.some(function (s: any) { return /\d{2}-\d{2} \d{2}:\d{2}/.test(s) })
  check(datedHit, 'cross-day rows carry month-day plus time')
  const rowNodes = menuKids.filter(function (n: any) { return !!n && typeof n === 'object' && n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0 })
  check(rowNodes.length === 2, 'only current session rows are listed')
  const staleAria = rowNodes.some(function (r: any) { return String(r.p['aria-label'] || '').indexOf(staleWord) >= 0 })
  check(staleAria, 'stale marker also reaches the accessible name')

  // 二、只有本会话一条、没有别的会话 → 右簇与组间那条分隔线都不渲染，表头仍是一行高
  const soloCalls: any[] = []
  const soloBuilt = loadCap({ tr: trFor(soloCalls) })
  const soloSt = { snapshot: { workRouteTable: tableFor([entryOf('951', { title: 'solo', actionAt: new Date(freshAt).toISOString() })]) }, chainMenuOpen: true, chainMenuPos: { left: 1, bottom: 2 } }
  const soloOpen = soloBuilt.SessionChainCapsule({ st: soloSt, sid: 's1' })
  const soloMenu: any = findMenu(soloOpen)
  const soloKids: any[] = childrenOf(soloMenu)
  const soloHeaders = soloKids.filter(isHeaderNode)
  check(soloHeaders.length === 1, '没有别的会话时表头仍只有一个节点')
  const soloHead: any = soloHeaders[0]
  const soloClusters: any[] = childrenOf(soloHead).filter(function (n: any) { return !!n && typeof n === 'object' && n.t })
  check(soloClusters.length === 1, '没有其他会话时右簇不渲染')
  const soloExpected = zhText('chainView.capsuleHeaderTitle') + zhText('chainView.capsuleHeaderOwn', { n: 1 }) + zhText('chainView.readAtFull', { time: freshHHmm })
  check(textsOf(soloHead).join('') === soloExpected, '只剩左簇三段（实得 ' + textsOf(soloHead).join('') + '）')
  const soloSvgs: any[] = nodesOf(soloHead, 'svg')
  check(soloSvgs.length === 1 && soloSvgs.every(hiddenSvg), '没有其他会话时只剩内部那条分隔线')
  check(!soloCalls.some(function (c: any) { return c.k === 'chainView.capsuleHeaderOthers' }), '没有其他会话时不调用「另有 …」词条')
  check(stringStyle(soloHead).lineHeight === '18px' && stringStyle(soloHead).padding === '2px 8px', '表头恒为一行高（18 + 2 + 2 = 22px）')

  // 三、#1732（三条）：单子打开就停在末行（在办单子沉底，最新一条贴底、离鼠标最近）、
  //   在办单子表头吸顶不跟着滚走、高度跟着 DSH 窗口长（底边钉在胶囊上沿，上方可用高度都用上，窗口矮时收小）。
  check(menuStyle.boxSizing === 'border-box', '高度上限含内边距与边框（box-sizing: border-box）')
  check(menuStyle.padding === '0 4px 4px' && menuStyle.scrollPaddingTop === 24, '单子顶部不放内边距（滚动口顶上不露行），并给键盘聚焦行留出表头高度（实得 ' + JSON.stringify([menuStyle.padding, menuStyle.scrollPaddingTop]) + '）')
  check(hs.position === 'sticky' && hs.top === 0, '表头吸顶（sticky，贴在滚动容器顶上）')
  check(!!hs.background && hs.zIndex >= 1, '吸顶表头有底色且盖在行上面（行从它底下滚过去不透出来）')
  const refFn = (menuNode && menuNode.props) ? menuNode.props.ref : null
  check(typeof refFn === 'function', '滚动容器上挂了 ref 回调（打开时用它滚到末行）')
  const menuKey = (menuNode && menuNode.props) ? String(menuNode.props.key || '') : ''
  check(menuKey === 'chainmenu-2', '单子的 key 带行数（行数变了才重新挂载，实得 ' + JSON.stringify(menuKey) + '）')
  const scroller: any = { scrollTop: 0, scrollHeight: 640 }
  let refThrew = false
  try { refFn(scroller) } catch (eRef) { refThrew = true }
  check(!refThrew && scroller.scrollTop === 640, '一挂上就把列表滚到末行（scrollTop = scrollHeight，实得 ' + scroller.scrollTop + '）')
  let nullRefThrew = false
  try { refFn(null) } catch (eNull) { nullRefThrew = true }
  check(!nullRefThrew, '卸载时 ref 回调收 null 不抛（同一函数兼作卸载清理）')
  const openAgain: any = findMenu(built.SessionChainCapsule({ st: st, sid: 's1' }))
  check(!!openAgain && openAgain.props.ref === refFn, 'ref 回调跨渲染保持同一个引用（悬停重渲染不把列表拽回底部）')
  check(!!openAgain && openAgain.props.key === (menuNode && menuNode.props.key), '行数没变时 key 不变（悬停重渲染不重挂载、不抢回滚位）')
  const stMore: any = { snapshot: { workRouteTable: tableFor([
    entryOf('952', { title: 'newest', actionAt: new Date(freshAt).toISOString() }),
    entryOf('951', { title: 'fresh', actionAt: new Date(freshAt).toISOString() }),
    entryOf('950', { title: '', actionAt: new Date(staleAt).toISOString() }),
  ]) }, chainMenuOpen: true, chainMenuPos: { left: 1, bottom: 2 } }
  const moreMenu: any = findMenu(built.SessionChainCapsule({ st: stMore, sid: 's1' }))
  check(!!moreMenu && String(moreMenu.props.key) === 'chainmenu-3', '列表变长时 key 跟着行数换（重挂载后 ref 再滚一次，末行重新贴底，实得 ' + JSON.stringify(moreMenu && moreMenu.props.key) + '）')
  const withViewport = function (vh: any, fn: any) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window')
    const prev = (globalThis as any).window
    ;(globalThis as any).window = { innerHeight: vh }
    try { fn() } finally { if (had) (globalThis as any).window = prev; else delete (globalThis as any).window }
  }
  const heightAt = function (vh: any, bottom: any) {
    let got: any = null
    withViewport(vh, function () {
      const probeSt: any = { snapshot: st.snapshot, chainMenuOpen: true, chainMenuPos: { left: 1, bottom: bottom } }
      const probeMenu: any = findMenu(built.SessionChainCapsule({ st: probeSt, sid: 's1' }))
      got = (probeMenu && probeMenu.props && probeMenu.props.style) ? probeMenu.props.style.maxHeight : null
    })
    return got
  }
  check(heightAt(900, 2) === 890, 'DSH 窗口高时单子跟着长（视口 900 - 底边 2 - 缝 8 = 890，实得 ' + heightAt(900, 2) + '）')
  check(heightAt(700, 658) === 34, '窗口矮时按可用空间收小、不越过顶边（视口 700 - 底边 658 - 缝 8 = 34，实得 ' + heightAt(700, 658) + '）')
  check(heightAt(700, 690) === 2, '可用空间只剩一条缝时按实得给，不撑出去（700 - 690 - 8 = 2，实得 ' + heightAt(700, 690) + '）')
  check(heightAt(700, 800) === 24, '底边跑到视口外时只留 24（至少露出在办单子表头，实得 ' + heightAt(700, 800) + '）')
  check(heightAt(0, 2) === 380, '读不到视口时退回旧值 380（不至于算成 0 高）')
}

console.log('H) #1563 窄栏：目录先让位，编号永不缩写')
{
  const longEffort = 'very-long-directory-name-that-exceeds-width'
  const stNarrow: any = { snapshot: { workRouteTable: tableFor([entryOf('1563', { title: '窄栏用例', effortId: longEffort })]) } }
  const builtNarrow = loadCap({})
  const shutNarrow = builtNarrow.SessionChainCapsule({ st: stNarrow, sid: 's1' })
  const flatNarrow: any[] = []
  ;(function walk(n: any) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { flatNarrow.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk) }
  })(shutNarrow)
  const full = '#' + longEffort + '/1563'
  check(flatNarrow.join('').indexOf(full) >= 0, '#1563 窄栏下完整编号仍在版面上（拼起来读，实得 ' + JSON.stringify(flatNarrow.join('')) + '）')
  const foldSlotsNarrow: any[] = []
  ;(function collect(n: any) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(collect); return }
    if (typeof n !== 'object') return
    if (n.p && n.p['data-fold-priority'] !== undefined) foldSlotsNarrow.push(n)
    ;(n.c || []).forEach(collect)
  })(shutNarrow)
  check(foldSlotsNarrow.length === 1, '#1563 整条胶囊仍只有一个挂让位号的元素（让位表仍是 12 段那一格）')
  const onlySlotTexts = (foldSlotsNarrow[0] && foldSlotsNarrow[0].c || []).filter(function (x: any) { return typeof x === 'string' }).join('')
  check(onlySlotTexts.indexOf('1563') < 0, '#1563 挂让位号的是目录段，`/编号` 段不挂让位号（实得 ' + JSON.stringify(onlySlotTexts) + '）')
  check(onlySlotTexts.indexOf('/') < 0, '#1563 `/` 跟编号走：目录段里没有 `/`（#1579，实得 ' + JSON.stringify(onlySlotTexts) + '）')
  const numNodes: any[] = []
  ;(function findNum(n: any) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(findNum); return }
    if (typeof n !== 'object') return
    if (typeof n.c !== 'undefined' && Array.isArray(n.c) && n.c.length === 1 && n.c[0] === '/1563') numNodes.push(n)
    ;(n.c || []).forEach(findNum)
  })(shutNarrow)
  check(numNodes.length === 1 && numNodes[0].p && numNodes[0].p['data-fold-priority'] === undefined, '#1563 `/编号` 段不挂让位数据，收窄时不被收字机裁掉')
  check(numNodes.length === 1 && String((numNodes[0].p && numNodes[0].p.style && (numNodes[0].p.style as any).flex) || '') === 'none', '#1563 `/编号` 段钉在行尾不收缩（flex none）')
  check(onlySlotTexts.length > 0 && String((foldSlotsNarrow[0].p.style as any).textOverflow) === 'ellipsis', '#1563 目录段超长时按省略号收起，而不是把编号挤掉')
  let tipContent = ''
  let tipAria = ''
  ;(function findTip(n: any) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(findTip); return }
    if (typeof n !== 'object') return
    if (!tipContent && n.p && typeof n.p.content === 'string' && n.p.content.indexOf('1563') >= 0 && n.p.content.indexOf(longEffort) >= 0) { tipContent = n.p.content }
    if (!tipAria && n.p && typeof n.p['aria-label'] === 'string' && n.p['aria-label'].indexOf('chainView.capsuleDoing') >= 0) { tipAria = String(n.p['aria-label'] || '') }
    ;(n.c || []).forEach(findTip)
  })(shutNarrow)
  check(tipContent === full, '#1563 悬停提示仍是完整编号（实得 ' + JSON.stringify(tipContent) + '）')
  check(tipAria.indexOf(full) >= 0, '#1563 无障碍名仍是完整编号（实得 ' + JSON.stringify(tipAria) + '）')
}

console.log(failed ? '\n存在失败' : '\n全部通过')
process.exit(failed ? 1 : 0)
