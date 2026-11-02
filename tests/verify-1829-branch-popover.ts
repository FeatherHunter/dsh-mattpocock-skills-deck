// tests/verify-1829-branch-popover.ts —— 门禁：#1829 阶段 4-D 分支浮层的四段结构。
//
// 背景：分支浮层原来只有「当前分支 + 指路 + 五个动作名 + 关闭键」四块平铺，没有标题行；
// 阶段 4-D 把它重做成「标题行 / 当前分支 / 五个动作名 / 指路」四段，结构由
// src/client/views/versionControl/vcBranchPopover.ts 给，浮层整体仍由页面壳挂到页面上。
//
// 这一扇锁住的结构约定（改了就会红的那些）：
//   1) 外层仍是 div.vcs-branch-overlay[role=dialog][aria-modal=false][data-vc-branch-overlay=1]，
//      aria-label 读真词表；id 由调用方透传，浮层不自己造；
//   2) 子节点顺序固定为：标题行（标题 + 关闭键）、当前分支、五个动作名、指路；
//   3) 五个动作的 data-vc-branch-action 顺序必须恰好是 list,create,delete,merge,rebase；
//      它们保持 span（不造假按钮，点击意图走事件委托），浮层里唯一的真按钮是关闭键；
//   4) 关闭键带 data-vc-branch-close=1 且 type=button。
//
// 手法与 verify-1545 一致：真源码按构建同一套口径（spliceableJs 转译并剥 export）装进假 h 求值，
// 只验这片结构，不启动浏览器。纯内存、无落盘、可并发。
//
// 门禁归属: src/client/views/versionControl/vcBranchPopover.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1829-branch-popover.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { sourcePath, spliceableJs } from './lib/source-text.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-branch-popover'
const LEAF = 'src/client/views/versionControl/vcBranchPopover.ts'
// 五个动作名的顺序是规格写死的顺序，门禁逐字比对，不按字母表重排。
const ACTION_IDS = ['list', 'create', 'delete', 'merge', 'rebase']

let total = 0
let failures = 0
const check = (ok: any, msg: string) => {
  total += 1
  if (!ok) failures += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

/** 假 h：把 React.createElement 的入参收成 { type, props, children }，只够读结构用。 */
function makeH() {
  const createElement = function (type: any, props: any, ...kids0: any[]) {
    const kids: any[] = []
    const walk = function (k: any) {
      if (Array.isArray(k)) { k.forEach(walk); return }
      if (k === null || k === undefined || k === false) return
      kids.push(k)
    }
    walk(kids0)
    return { type: type, props: props || {}, children: kids }
  }
  return createElement
}

/** 深度优先找出所有满足条件的节点；数组按元素顺序展开，所以结果顺序就是渲染顺序。 */
function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out }
  if (pred(node)) out.push(node)
  if (node.children) findAll(node.children, pred, out)
  return out
}

/** 按词表取值并替换 {name} 占位符；键不在词表里时原样回键名，让断言里看得出来。 */
function fill(dict: any, key: string, params?: any): string {
  let s = dict[key] === undefined ? key : String(dict[key])
  Object.keys(params || {}).forEach((k) => { s = s.split('{' + k + '}').join(String((params || {})[k])) })
  return s
}

async function main() {
  console.log('#1829 阶段 4-D：分支浮层的标题行 / 当前分支 / 五个动作 / 指路')
  const locMod: any = await import(pathToFileURL(path.join(ROOT, sourcePath('src/client/kernel/locale-vcshell.js'))).href)
  const zh = locMod.L_VCSHELL.zh
  const en = locMod.L_VCSHELL.en
  const trZh = (key: string, params?: any) => fill(zh, key, params)
  const keys = ['title', 'current', 'list', 'create', 'delete', 'merge', 'rebase', 'pointer', 'close'].map((k) => 'vc.shell.branch.' + k)
  const missing = keys.filter((k) => typeof zh[k] !== 'string' || !String(zh[k]).trim() || typeof en[k] !== 'string' || !String(en[k]).trim())
  check(missing.length === 0, '词表里九个分支浮层键在中英两边都有非空文案（缺的：' + (missing.length ? missing.join('、') : '无') + '）')

  const src = spliceableJs(LEAF) + '\nreturn { vcBranchPopoverNode }'
  const leaf: any = compileFn(['h', 't'], src)(makeH(), trZh)
  check(typeof leaf.vcBranchPopoverNode === 'function', '真源码求值后取到 vcBranchPopoverNode（导出名与构建拼闭包的口径一致）')

  const id = 'vc-1829-branch-overlay'
  const branch = 'feat/branch-popover'
  const tree = leaf.vcBranchPopoverNode(makeH(), trZh, { id: id, branch: branch })

  // 一、外层：属性原样保留，id 由调用方透传。
  check(tree && tree.type === 'div', '外层是 div（实得 ' + (tree && tree.type) + '）')
  check(tree && tree.props.id === id, 'id 原样透传（期望 ' + id + '，实得 ' + String(tree && tree.props.id) + '）')
  check(tree && tree.props.className === 'vcs-branch-overlay' && tree.props['data-vc-branch-overlay'] === '1', '外层带 vcs-branch-overlay 类与 data-vc-branch-overlay=1')
  check(tree && tree.props.role === 'dialog' && tree.props['aria-modal'] === 'false', '外层是 dialog 语义且 aria-modal=false')
  check(tree && tree.props['aria-label'] === trZh('vc.shell.branch.title'), '外层 aria-label 读真词表（期望「' + trZh('vc.shell.branch.title') + '」）')

  // 二、四段顺序：标题行 → 当前分支 → 五个动作 → 指路。
  const order = ['vcs-branch-head', 'vcs-branch-cur', 'vcs-branch-list', 'vcs-branch-pointer']
  const gotOrder = ((tree && tree.children) || []).map((n: any) => String((n.props || {}).className || ''))
  check(gotOrder.length === 4 && gotOrder.join(',') === order.join(','), '四个子节点顺序为 标题行、当前分支、五个动作、指路（实得 ' + gotOrder.join('、') + '）')

  // 三、标题行：标题 + 关闭键；关闭键是浮层里唯一的真按钮。
  const head = tree && tree.children ? tree.children[0] : null
  const headKids = (head && head.children) || []
  check(head && head.type === 'div' && head.props.className === 'vcs-branch-head' && headKids.length === 2, '标题行是 div.vcs-branch-head，恰好两个孩子（标题与关闭键）')
  const title = headKids[0]
  const close = headKids[1]
  check(title && title.type === 'h3' && title.props.className === 'vcs-branch-title' && title.children[0] === trZh('vc.shell.branch.title'), '标题是 h3.vcs-branch-title，文字读真词表（实得「' + String(title && title.children[0]) + '」）')
  check(close && close.type === 'button' && close.props.type === 'button' && close.props['data-vc-branch-close'] === '1', '关闭键是真按钮且带 data-vc-branch-close=1')
  check(close && close.children[0] === trZh('vc.shell.branch.close'), '关闭键文字读真词表（实得「' + String(close && close.children[0]) + '」）')
  const buttons = findAll(tree, (n: any) => n.type === 'button')
  check(buttons.length === 1 && buttons[0] === close, '浮层里唯一的真按钮就是关闭键（实得 ' + buttons.length + ' 颗）')
  const fakeButtons = findAll(tree, (n: any) => n.type === 'button' && n.props && n.props['data-vc-branch-action'] !== undefined)
  check(fakeButtons.length === 0, '五个动作没有画成按钮（不造假按钮，实得 ' + fakeButtons.length + ' 颗）')

  // 四、当前分支与指路：类名保留、文字读真词表。
  const cur = tree && tree.children ? tree.children[1] : null
  check(cur && cur.type === 'p' && cur.props.className === 'vcs-branch-cur', '当前分支是 p.vcs-branch-cur（类名保留）')
  const curText = String(cur && cur.children[0])
  check(curText === trZh('vc.shell.branch.current', { branch: branch }) && curText.indexOf(branch) >= 0, '当前分支文字读真词表并代入分支名（实得「' + curText + '」）')
  const ptr = tree && tree.children ? tree.children[3] : null
  check(ptr && ptr.type === 'p' && ptr.props.className === 'vcs-branch-pointer' && ptr.children[0] === trZh('vc.shell.branch.pointer'), '指路文字读真词表（实得「' + String(ptr && ptr.children[0]) + '」）')

  // 五、五个动作：数量、顺序、span 形态、文字各读真词表。
  const list = tree && tree.children ? tree.children[2] : null
  const items = (list && list.children) || []
  check(list && list.type === 'ul' && list.props.className === 'vcs-branch-list' && items.length === 5, '五个动作是 ul.vcs-branch-list 下的五个 li（实得 ' + items.length + ' 项）')
  check(items.length === 5 && items.every((li: any) => li.type === 'li' && li.props.className === 'vcs-branch-item' && (li.children || []).length === 1), '每个 li.vcs-branch-item 里恰好一个动作节点')
  const actionNodes = findAll(list, (n: any) => n.props && n.props['data-vc-branch-action'] !== undefined)
  const actionOrder = actionNodes.map((n: any) => String(n.props['data-vc-branch-action'])).join(',')
  check(actionOrder === ACTION_IDS.join(','), '五个 data-vc-branch-action 顺序恰为 ' + ACTION_IDS.join(',') + '（实得 ' + actionOrder + '）')
  check(actionNodes.length === 5 && actionNodes.every((n: any) => n.type === 'span' && n.props.className === 'vcs-branch-label'), '五个动作节点是 span.vcs-branch-label（不是 button）')
  const wrongText = ACTION_IDS.filter((id2, i) => !actionNodes[i] || actionNodes[i].children[0] !== trZh('vc.shell.branch.' + id2))
  check(wrongText.length === 0, '五个动作文字各读真词表（不对的：' + (wrongText.length ? wrongText.join('、') : '无') + '）')

  // 六、调用方没给分支读数时不崩，占位符退化成空串。
  const bare = leaf.vcBranchPopoverNode(makeH(), trZh, { id: 'bare-overlay' })
  const bareCur = bare && bare.children ? bare.children[1].children[0] : null
  check(bareCur === trZh('vc.shell.branch.current', { branch: '' }), '没给分支读数：当前分支退化成空串，不崩（实得「' + String(bareCur) + '」）')
}

main().then(function () {
  console.log('\n共 ' + total + ' 条断言')
  if (failures > 0) {
    console.log('存在失败：' + failures + ' 条')
    printGateResult(GATE, total, failures)
    process.exit(1)
  }
  console.log('全部通过')
  printGateResult(GATE, total, 0)
}).catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  printGateResult(GATE, total, Math.max(1, failures))
  process.exit(1)
})
