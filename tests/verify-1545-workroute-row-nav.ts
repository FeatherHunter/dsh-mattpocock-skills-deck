// tests/verify-1545-workroute-row-nav.ts —— 门禁：#1545 在办表行点击跳转。
//
// 背景：workroute 弹窗里的行整表没有点击入口（WorkRouteRow 与 WorkRouteTable
// 无 onClick/pushNav），Map 容器行点不动是它的一个表现。本门禁锁住修完之后的样子：
//   1) 每一行按票号加工作单元在快照容器表里找容器：找得到且认得出种类 → 进容器详情；
//      否则（含快照里没有这张地图、行数据退化）→ 回落普通票详情（与子票/阻塞票分流
//      enterSubDetail 同一条口径：有字可看，不静默回列表）；
//   2) 行可点时是真的按钮形态（role/tabIndex/回车空格同路、data-press 写日志），
//      点后关浮层；导航能力不在（单文件求值）时退回今天的纯展示行，不崩、不跳错地方。
//
// 手法：与 verify-1082 同一套——真源码按构建同一套做法（spliceableJs 剥 export）装进
// 假 React 求值；容器判定与导航用探针替身（记下 pushNav 实参），只验这一片的接线，
// 不重验身份算法本身。纯内存、无落盘、可并发。
//
// 门禁归属: src/client/views/shared/workRouteTable.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1545-workroute-row-nav.ts
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function makeReact() {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) { if (Array.isArray(k)) { k.forEach(walk); return } if (k === null || k === undefined || k === false) return; kids.push(k) }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) {
      const v = typeof init === 'function' ? init() : init
      return [v, function () {}]
    },
    useRef: function (init: any) { return { current: init === undefined ? null : init } },
    useEffect: function () { return undefined },
  }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out }
  if (pred(node)) out.push(node)
  if (node.children) findAll(node.children, pred, out)
  if (node.props && node.props.content) findAll(node.props.content, pred, out)
  return out
}

async function main() {
  console.log('#1545 在办表行点击跳转：容器行进容器详情、普通行进票详情')
  const pagesUrl = (await import('./lib/source-text.ts') as any).sourcePath('src/client/kernel/locale-pages.js')
  const zh = (await imp(pagesUrl) as any).L_PAGES.zh
  const trZh = (k: string, p?: any) => {
    let s = zh[k] !== undefined ? zh[k] : k
    Object.keys(p || {}).forEach((key) => { s = s.split('{' + key + '}').join(String((p || {})[key])) })
    return s
  }
  // #1511：编号写法住在 kernel/ticket-label.ts，本门禁按文本/模块单独加载视图叶子时
  // 构建闭包里才有的名字在这里不存在，补上真身（与 verify-1082 同一做法，不另抄规则）。
  ;(globalThis as any).ticketLabelOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelOf
  // 探针替身：容器判定只认自带 type 的两类；导航记下实参不真跳。
  const pushCalls: any[] = []
  ;(globalThis as any).findMapByIdentity = function (maps: any, num: any, effortId: any) {
    const list: any[] = Array.isArray(maps) ? maps : []
    return list.find(function (m: any) {
      return m && String(m.number) === String(num).trim() && String(m.effortId || '') === String(effortId || '')
    }) || null
  }
  ;(globalThis as any).containerKindOf = function (x: any) {
    if (!x) return null
    if (x.type === 'spec') return 'spec'
    if (x.type === 'map') return 'map'
    return null
  }
  ;(globalThis as any).pushNav = function (st: any, kind: any, n: any, effortId: any) {
    pushCalls.push({ kind: kind, n: n, effortId: effortId })
    return null
  }
  try {
    const leafSrc = spliceableJs('src/client/views/shared/workRouteTable.js').replace(/^[ \t]*export[ \t]+/gm, '')
    const leaf = compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h', 'Ic', 'portalTop', 'DSW_VERSION'],
      leafSrc + '\nreturn { WORK_ROUTE_TABLE_CELLS, workRouteTableOf, workRouteNavOf, WorkRouteRow, WorkRouteTable, WorkRouteTrigger }')(
      makeReact(), null, (props: any, child: any) => ({ type: 'Tip', props: props || {}, children: [child] }),
      trZh, null, (args: any) => ({ type: 'Icon', props: args || {}, children: [] }),
      (node: any) => ({ type: 'Portal', props: {}, children: [node] }), '9.9.9-test')

    const maps = [
      { number: 7, effortId: '', title: '地图七', type: 'map' },
      { number: 0, effortId: 'ticket-convention', title: '本地票务约定', type: 'map' },
    ]
    const at = '2026-10-26T04:00:00.000Z'
    const st: any = { snapshot: {
      workRouteTable: { ok: true, readout: { at: at, staleCount: 0, entries: [
        { ticketKey: '7', title: '地图七', sessionLabel: '会话 甲', action: 'report', actionAt: at, active: true, currentSession: false },
        { ticketKey: '101', title: '普通票', sessionLabel: '会话 乙', action: 'edit', actionAt: at, active: true, currentSession: true },
      ] } },
      maps: maps,
    } }

    // 一、导航口径：容器进容器页、普通进票详情、退化身份回落票详情。
    check(typeof leaf.workRouteNavOf === 'function', '行跳转有可测的导航口径 workRouteNavOf（#1545 修完的样子）')
    const navMap = leaf.workRouteNavOf(st, st.snapshot.workRouteTable.readout.entries[0])
    check(navMap && navMap.kind === 'map', 'Map 行：导航目标是容器详情（实得 ' + JSON.stringify(navMap) + '）')
    const navIssue = leaf.workRouteNavOf(st, st.snapshot.workRouteTable.readout.entries[1])
    check(navIssue && navIssue.kind === 'issue', '普通行：导航目标是票详情（实得 ' + JSON.stringify(navIssue) + '）')
    const navLocal = leaf.workRouteNavOf({ snapshot: { maps: maps } }, { ticketKey: '0', effortId: 'ticket-convention', title: 't', sessionLabel: 's', action: '', actionAt: '', active: true, currentSession: false })
    check(navLocal && navLocal.kind === 'map', '本地后端目录行（#目录/00）：同样认出容器（实得 ' + JSON.stringify(navLocal) + '）')
    const navUnknown = leaf.workRouteNavOf(st, { ticketKey: '999', title: 't', sessionLabel: 's', action: '', actionAt: '', active: true, currentSession: false })
    check(navUnknown && navUnknown.kind === 'issue', '快照里没有这张地图：回落票详情，不静默没反应（实得 ' + JSON.stringify(navUnknown) + '）')
    check(leaf.workRouteNavOf(st, { ticketKey: '  ', title: 't', sessionLabel: 's', action: '', actionAt: '', active: true, currentSession: false }) === null, '票号取不到：不给导航目标（调用方不挂点击）')

    // 二、行是真的按钮形态，点按与回车走同一条路。
    const tree = leaf.WorkRouteTable({ st: st })
    const rows = findAll(tree, (n: any) => n.props && n.props['data-work-route-row'] === 1)
    check(rows.length === 2, '两行都在（实得 ' + rows.length + ' 行）')
    check(rows.length === 2 && rows.every((r: any) => typeof r.props.onClick === 'function'), '两行都挂了点击入口（今天是整表都没有）')
    check(rows.length === 2 && rows.every((r: any) => r.props.role === 'button' && r.props.tabIndex === 0), '可点的行能被键盘走到（role=button + tabIndex）')
    check(rows.length === 2 && rows.every((r: any) => r.props['data-press'] === 'row' && String(r.props['data-log'] || '').indexOf('workroute.row.') === 0), '点击写调试日志（data-press=row，target 带票号）')
    pushCalls.length = 0
    if (rows.length === 2) rows[0].props.onClick()
    check(pushCalls.length === 1 && pushCalls[0].kind === 'map' && String(pushCalls[0].n) === '7', '点 Map 行：压栈进地图详情（实得 ' + JSON.stringify(pushCalls[0]) + '）')
    if (rows.length === 2) rows[1].props.onClick()
    check(pushCalls.length === 2 && pushCalls[1].kind === 'issue' && String(pushCalls[1].n) === '101', '点普通行：压栈进票详情（实得 ' + JSON.stringify(pushCalls[1]) + '）')
    const keyEvt = { key: 'Enter', preventDefault: function () {}, target: 't', currentTarget: 't' }
    ;(keyEvt as any).target = (keyEvt as any).currentTarget = {}
    if (rows.length === 2) rows[0].props.onKeyDown(keyEvt)
    check(pushCalls.length === 3 && pushCalls[2].kind === 'map', '回车与点按走同一条路（行内无按钮，不误触）')
    const spaceEvt: any = { key: ' ', preventDefault: function () {} }
    spaceEvt.target = spaceEvt.currentTarget = {}
    if (rows.length === 2) rows[1].props.onKeyDown(spaceEvt)
    check(pushCalls.length === 4 && pushCalls[3].kind === 'issue', '空格与点按走同一条路（实得 ' + JSON.stringify(pushCalls[3]) + '）')
    const tl = (globalThis as any).ticketLabelOf
    check(rows.length === 2 && String(rows[0].props['aria-label']) === tl('7', undefined) + ' 地图七', '读屏名与首列同写法（走 ticketLabelOf，不自己拼 #号，实得 ' + (rows.length === 2 ? String(rows[0].props['aria-label']) : '无行') + '）')

    // 三、点后关浮层；导航能力不在时退回纯展示行。
    let navigated = 0
    const tree2 = leaf.WorkRouteTable({ st: st, onNavigate: function () { navigated++ } })
    const rows2 = findAll(tree2, (n: any) => n.props && n.props['data-work-route-row'] === 1)
    if (rows2.length > 0) rows2[0].props.onClick()
    check(navigated === 1, '点后调 onNavigate（浮层靠它收起）')
    const savedPush = (globalThis as any).pushNav
    delete (globalThis as any).pushNav
    const tree3 = leaf.WorkRouteTable({ st: st })
    const rows3 = findAll(tree3, (n: any) => n.props && n.props['data-work-route-row'] === 1)
    check(rows3.length === 2 && rows3.every((r: any) => typeof r.props.onClick !== 'function'), '导航能力不在（单文件求值）：退回纯展示行，不挂坏掉的点击')
    ;(globalThis as any).pushNav = savedPush

    if (total === 0) check(false, '一条断言都没跑')
  } finally {
    delete (globalThis as any).ticketLabelOf
    delete (globalThis as any).findMapByIdentity
    delete (globalThis as any).containerKindOf
    delete (globalThis as any).pushNav
  }
}

main().then(function () {
  console.log('\n共 ' + total + ' 条断言')
  if (failed) { console.log('存在失败'); process.exit(1) }
  console.log('全部通过')
}).catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
