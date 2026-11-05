// tests/verify-1829-branch-popover.ts —— 门禁：分支浮层的结构（#1846 收口后：清单 + 切换 + 四个指路动作）。
//
// 背景：分支浮层在 #1829 阶段 4-D 只有「标题行 / 当前分支 / 五个动作名 / 指路」四段，五个动作全是 span。
// #1846（并入 #1884）把它改成「本地分支清单 + 就地切换」：清单里的每一行是能点的真按钮，
// 当前分支那一行带徽章且不可点；其余四个动作（新建 / 删除 / 合并 / 变基）仍只是名字与指路。
// 切换需要确认时，确认卡与结果贴在浮层里，浮层不关。
//
// 这一扇锁住的结构约定（改了就会红的那些）：
//   1) 外层仍是 div.vcs-branch-overlay[role=dialog][aria-modal=false][data-vc-branch-overlay=1]，
//      aria-label 读真词表；id 由调用方透传，浮层不自己造；
//   2) 五段顺序固定为：标题行、当前分支、本地分支清单、四个动作名、指路；
//      确认卡与结果只在调用方给了的时候追加在最后；
//   3) 清单每行是一颗 type=button、带 data-vc-branch-pick 的委托按钮；当前分支那一行 disabled、
//      带 data-vc-branch-current=1 与 aria-current=true，整棵树里没有别的假按钮；
//   4) 四个动作的 data-vc-branch-action 顺序必须恰好是 create,delete,merge,rebase，且保持 span；
//   5) 没有分支读数时画空态（data-vc-branch-empty=1），不凭空画行；
//   6) 清单读数两种键都认（真机 BranchInfo.short、早期夹具 name），当前分支排第一行。
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
import { compileFn } from './lib/eval-probe.ts'
import { sourcePath, spliceableJs } from './lib/source-text.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-branch-popover'
const LEAF = 'src/client/views/versionControl/vcBranchPopover.ts'
// 四个指路动作的顺序是规格写死的顺序，门禁逐字比对，不按字母表重排。
const ACTION_IDS = ['create', 'delete', 'merge', 'rebase']

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

function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}

/** 按词表取值并替换 {name} 占位符；键不在词表里时原样回键名，让断言里看得出来。 */
function fill(dict: any, key: string, params?: any): string {
  let s = dict[key] === undefined ? key : String(dict[key])
  Object.keys(params || {}).forEach((k) => { s = s.split('{' + k + '}').join(String((params || {})[k])) })
  return s
}

// 首屏快照夹具：三条分支，当前分支不在第一条（要验「当前排第一」），三种上游状态各一条。
// 真机回包的键是 short（BranchInfo），这里就用 short；另一段单独验旧的 name 形状也能读。
const SEED = {
  slices: {
    workspace: {
      state: 'ok',
      data: {
        branches: [
          { short: 'main', current: false, upstream: 'origin/main', ahead: 0, behind: 0 },
          { short: 'feat/x', current: true, upstream: '', ahead: 2, behind: 1 },
          { short: 'old/topic', current: false, upstream: 'origin/old/topic', upstreamGone: true },
        ],
      },
    },
  },
}

async function main() {
  console.log('#1846 分支浮层：本地分支清单 + 就地切换 + 四个指路动作')
  const locMod: any = await import(pathToFileURL(path.join(ROOT, sourcePath('src/client/kernel/locale-vcshell.js'))).href)
  const zh = locMod.L_VCSHELL.zh
  const en = locMod.L_VCSHELL.en
  const trZh = (key: string, params?: any) => fill(zh, key, params)
  const keys = ['title', 'current', 'create', 'delete', 'merge', 'rebase', 'pointer', 'close', 'branchesHint', 'branchPick', 'branchCurrentHint', 'branchEmpty'].map((k) => 'vc.shell.branch.' + k)
  const missing = keys.filter((k) => typeof zh[k] !== 'string' || !String(zh[k]).trim() || typeof en[k] !== 'string' || !String(en[k]).trim())
  check(missing.length === 0, '词表里十二个分支浮层键在中英两边都有非空文案（缺的：' + (missing.length ? missing.join('、') : '无') + '）')

  // 确认卡与结果用真原语（vcShellPrimitives 按构建次序排在本叶之前），不在这扇门禁里另写一份假卡。
  const primSrc = spliceableJs('src/client/views/versionControl/vcShellPrimitives.ts') +
    '\nreturn { vcShellConfirmCardNode: vcShellConfirmCardNode, vcShellResultNode: vcShellResultNode }'
  const prim: any = compileFn(['h', 't', 'vcBlockKeyOf', 'vcPageDepthOf'], primSrc)(
    makeH(), trZh, function () { return 'vc.shell.block.other' }, function () { return 1 },
  )
  const src = spliceableJs(LEAF) +
    '\nreturn { vcBranchPopoverNode: vcBranchPopoverNode, vcBranchPopoverRowsOf: vcBranchPopoverRowsOf, VC_BRANCH_POPOVER_ACTIONS: VC_BRANCH_POPOVER_ACTIONS }'
  const leaf: any = compileFn(['h', 't', 'vcShellConfirmCardNode', 'vcShellResultNode'], src)(
    makeH(), trZh, prim.vcShellConfirmCardNode, prim.vcShellResultNode,
  )
  check(typeof leaf.vcBranchPopoverNode === 'function' && typeof leaf.vcBranchPopoverRowsOf === 'function', '真源码求值后取到 vcBranchPopoverNode 与 vcBranchPopoverRowsOf')

  const id = 'vc-1829-branch-overlay'
  const branch = 'feat/x'
  const tree = leaf.vcBranchPopoverNode(makeH(), trZh, { id: id, branch: branch, seed: SEED })

  // 一、外层：属性原样保留，id 由调用方透传。
  check(tree && tree.type === 'div', '外层是 div（实得 ' + (tree && tree.type) + '）')
  check(tree && tree.props.id === id, 'id 原样透传（期望 ' + id + '，实得 ' + String(tree && tree.props.id) + '）')
  check(tree && tree.props.className === 'vcs-branch-overlay' && tree.props['data-vc-branch-overlay'] === '1', '外层带 vcs-branch-overlay 类与 data-vc-branch-overlay=1')
  check(tree && tree.props.role === 'dialog' && tree.props['aria-modal'] === 'false', '外层是 dialog 语义且 aria-modal=false')
  check(tree && tree.props['aria-label'] === trZh('vc.shell.branch.title'), '外层 aria-label 读真词表（期望「' + trZh('vc.shell.branch.title') + '」）')

  // 二、五段顺序：标题行 → 当前分支 → 本地分支清单 → 四个动作 → 指路。
  const order = ['vcs-branch-head', 'vcs-branch-cur', 'vcs-branch-branches', 'vcs-branch-list', 'vcs-branch-pointer']
  const gotOrder = ((tree && tree.children) || []).map((n: any) => String((n.props || {}).className || ''))
  check(gotOrder.length === 5 && gotOrder.join(',') === order.join(','), '五个子节点顺序为 标题行、当前分支、分支清单、四个动作、指路（实得 ' + gotOrder.join('、') + '）')

  // 三、标题行：标题 + 关闭键；关闭键带点击纪律要求的两个属性。
  const head = tree && tree.children ? tree.children[0] : null
  const headKids = (head && head.children) || []
  check(head && head.type === 'div' && head.props.className === 'vcs-branch-head' && headKids.length === 2, '标题行是 div.vcs-branch-head，恰好两个孩子（标题与关闭键）')
  const title = headKids[0]
  const close = headKids[1]
  check(title && title.type === 'h3' && title.props.className === 'vcs-branch-title' && title.children[0] === trZh('vc.shell.branch.title'), '标题是 h3.vcs-branch-title，文字读真词表（实得「' + String(title && title.children[0]) + '」）')
  check(close && close.type === 'button' && close.props.type === 'button' && close.props['data-vc-branch-close'] === '1' && close.props['data-press'] === 'button' && String(close.props['data-log'] || '').indexOf('vc.branch.popover.') === 0, '关闭键是真按钮，带 data-vc-branch-close=1 与 data-press / data-log')
  check(close && close.children[0] === trZh('vc.shell.branch.close'), '关闭键文字读真词表（实得「' + String(close && close.children[0]) + '」）')

  // 四、当前分支：一行读数。
  const cur = tree && tree.children ? tree.children[1] : null
  check(cur && cur.type === 'p' && cur.props.className === 'vcs-branch-cur', '当前分支是 p.vcs-branch-cur（类名保留）')
  const curText = String(cur && cur.children[0])
  check(curText === trZh('vc.shell.branch.current', { branch: branch }) && curText.indexOf(branch) >= 0, '当前分支文字读真词表并代入分支名（实得「' + curText + '」）')

  // 五、本地分支清单：三行、当前排第一且 disabled，其余是可点的委托按钮。
  const wrap = tree && tree.children ? tree.children[2] : null
  check(wrap && wrap.type === 'div' && wrap.props.className === 'vcs-branch-branches' && wrap.props['data-vc-branch-branches'] === '3', '分支清单是 div.vcs-branch-branches，条数为 3（实得 ' + String(wrap && wrap.props['data-vc-branch-branches']) + '）')
  const hint = findAll(wrap, (n: any) => (n.props || {}).className === 'vcs-branch-branches-hint')[0]
  check(!!hint && textOf(hint) === trZh('vc.shell.branch.branchesHint'), '清单上方的提示读真词表（实得「' + textOf(hint) + '」）')
  const countNode = findAll(wrap, (n: any) => (n.props || {}).className === 'vcs-branch-count')[0]
  check(!!countNode && textOf(countNode) === trZh('vc.shell.branch2.branchesCount', { n: '3' }), '条数行读真词表并写 3 条（实得「' + textOf(countNode) + '」）')
  const rowList = findAll(wrap, (n: any) => n.type === 'ul' && (n.props || {}).className === 'vcs-branch-branches-list')[0]
  const rowItems = (rowList && rowList.children) || []
  const rowButtons = rowItems.map((li: any) => (li.children || [])[0])
  const rowNames = rowButtons.map((btn: any) => String((btn.props || {})['data-vc-branch-pick']))
  check(rowItems.length === 3 && rowNames.join(',') === 'feat/x,main,old/topic', '三行分支且当前分支排第一、其余保持读数顺序（实得 ' + rowNames.join(',') + '）')
  check(rowButtons.every((btn: any) => btn && btn.type === 'button' && btn.props.type === 'button' && btn.props['data-press'] === 'button' && String(btn.props['data-log'] || '').length > 0), '每行都是 type=button 的委托按钮，带 data-press / data-log（不是 div 假按钮）')
  const currentBtn = rowButtons[0]
  check(!!currentBtn && currentBtn.props.disabled === true && currentBtn.props['data-vc-branch-current'] === '1' && currentBtn.props['aria-current'] === 'true', '当前分支那一行 disabled、带 data-vc-branch-current=1 与 aria-current=true（不可点）')
  const others = rowButtons.slice(1)
  check(others.every((btn: any) => btn.props.disabled === undefined && btn.props['data-vc-branch-current'] === undefined), '其余分支行没有 disabled 与当前标记（可以点）')
  const badge = findAll(currentBtn, (n: any) => (n.props || {}).className === 'vcs-branch-branch-badge')[0]
  check(!!badge && textOf(badge) === trZh('vc.shell.branch2.currentBadge'), '当前分支行带「当前」徽章（实得「' + textOf(badge) + '」）')
  const curTitle = String((currentBtn && currentBtn.props.title) || '')
  const pickTitle = String((others[0] && others[0].props.title) || '')
  check(curTitle === trZh('vc.shell.branch.branchCurrentHint', { branch: 'feat/x' }) && pickTitle === trZh('vc.shell.branch.branchPick', { branch: 'main' }), '当前行与可点行的 title 各说自己的事（实得「' + curTitle + '」「' + pickTitle + '」）')
  const metas = rowButtons.map((btn: any) => textOf(findAll(btn, (n: any) => (n.props || {}).className === 'vcs-branch-branch-meta')[0]))
  check(metas[0].indexOf(trZh('vc.shell.branch2.ahead', { ahead: '2' })) >= 0 && metas[0].indexOf(trZh('vc.shell.branch2.behind', { behind: '1' })) >= 0 && metas[0].indexOf(trZh('vc.shell.branch2.noUpstream')) >= 0, '当前分支那行写出没有上游、领先 2、落后 1（实得「' + metas[0] + '」）')
  check(metas[2].indexOf(trZh('vc.shell.branch2.upstreamGone')) >= 0, '上游已删除的那一行照实写「上游已不存在」（实得「' + metas[2] + '」）')

  // 六、四个指路动作：数量、顺序、span 形态、文字各读真词表。
  const acts = tree && tree.children ? tree.children[3] : null
  const items = (acts && acts.children) || []
  check(acts && acts.type === 'ul' && acts.props.className === 'vcs-branch-list' && items.length === 4, '四个动作是 ul.vcs-branch-list 下的四个 li（实得 ' + items.length + ' 项）')
  check(items.length === 4 && items.every((li: any) => li.type === 'li' && li.props.className === 'vcs-branch-item' && (li.children || []).length === 1), '每个 li.vcs-branch-item 里恰好一个动作节点')
  const actionNodes = findAll(acts, (n: any) => n.props && n.props['data-vc-branch-action'] !== undefined)
  const actionOrder = actionNodes.map((n: any) => String(n.props['data-vc-branch-action'])).join(',')
  check(actionOrder === ACTION_IDS.join(','), '四个 data-vc-branch-action 顺序恰为 ' + ACTION_IDS.join(',') + '（实得 ' + actionOrder + '）')
  check(actionNodes.length === 4 && actionNodes.every((n: any) => n.type === 'span' && n.props.className === 'vcs-branch-label'), '四个动作节点是 span.vcs-branch-label（不画假按钮）')
  const wrongText = ACTION_IDS.filter((id2, i) => !actionNodes[i] || actionNodes[i].children[0] !== trZh('vc.shell.branch.' + id2))
  check(wrongText.length === 0, '四个动作文字各读真词表（不对的：' + (wrongText.length ? wrongText.join('、') : '无') + '）')
  check(leaf.VC_BRANCH_POPOVER_ACTIONS.join(',') === ACTION_IDS.join(','), '导出的动作名单与断言用的是同一份顺序（实得 ' + leaf.VC_BRANCH_POPOVER_ACTIONS.join(',') + '）')
  const buttons = findAll(tree, (n: any) => n.type === 'button')
  const pickButtons = buttons.filter((n: any) => n.props['data-vc-branch-pick'] !== undefined)
  check(buttons.length === 4 && pickButtons.length === 3, '整棵树里的按钮恰好是关闭键 + 三行分支（实得 ' + buttons.length + ' 颗，其中分支行 ' + pickButtons.length + ' 颗）')

  // 七、指路文字：说清四个动作各自去哪一页（分支与标签 / 冲突向导 / 变基待办）。
  //   这里只验它读真词表；「文案点名的页与真实落点一致」由 verify-1776 按落点表核对。
  const ptr = tree && tree.children ? tree.children[4] : null
  check(ptr && ptr.type === 'p' && ptr.props.className === 'vcs-branch-pointer' && ptr.children[0] === trZh('vc.shell.branch.pointer'), '指路文字读真词表（实得「' + textOf(ptr) + '」）')

  // 八、空态：没给读数时如实画「还没读到」，不凭空空一行；旧 name 形状也能读出来。
  const bare = leaf.vcBranchPopoverNode(makeH(), trZh, { id: 'bare-overlay' })
  const bareEmpty = findAll(bare, (n: any) => n.props && n.props['data-vc-branch-empty'] === '1')
  check(bareEmpty.length === 1 && textOf(bareEmpty[0]) === trZh('vc.shell.branch.branchEmpty'), '没给分支读数：画空态并读真词表（实得 ' + bareEmpty.length + ' 块）')
  check(findAll(bare, (n: any) => n.props && n.props['data-vc-branch-pick'] !== undefined).length === 0, '没给分支读数：不画任何分支行（不拿假数据补位）')
  const bareCur = bare && bare.children ? bare.children[1].children[0] : null
  check(bareCur === trZh('vc.shell.branch.current', { branch: '' }), '没给分支读数：当前分支退化成空串，不崩（实得「' + String(bareCur) + '」）')
  const legacyRows = leaf.vcBranchPopoverRowsOf({ branches: [{ name: 'main', current: false }, { name: 'dev', current: true }] }, '')
  check(legacyRows.length === 2 && legacyRows[0].name === 'dev' && legacyRows[0].current === true, '旧的 name 形状也读得出来，当前分支仍排第一（实得 ' + legacyRows.map((r: any) => r.name + ':' + r.current).join(',') + '）')
  const noCurrentRows = leaf.vcBranchPopoverRowsOf({ slices: { workspace: { state: 'ok', data: { branches: [{ short: 'main' }, { short: 'dev' }] } } } }, '')
  check(noCurrentRows.every((r: any) => r.current === false), '分离头指针（读数里没有 current、身份行也没有分支名）时不硬指一个当前分支')

  // 九、确认卡与结果：只在给了的时候追加在五段之后，且不改变五段的顺序。
  const withConfirm = leaf.vcBranchPopoverNode(makeH(), trZh, {
    id: 'confirm-overlay', branch: branch, seed: SEED,
    confirm: { verb: '切换到分支 feat/x', target: 'feat/x', kind: 'switch' },
  })
  const confirmNodes = findAll(withConfirm, (n: any) => n.props && n.props['data-vc-confirm'] === '1')
  check(confirmNodes.length === 1 && withConfirm.children.length === 6 && withConfirm.children[5] === confirmNodes[0], '要求确认时确认卡追加在第五段之后（实得子节点 ' + withConfirm.children.length + ' 个）')
  const goBtn = findAll(withConfirm, (n: any) => n.props && String(n.props.className || '').indexOf('vcs-confirm-go') >= 0)[0]
  check(!!goBtn && goBtn.type === 'button' && String(goBtn.children[0] || '').indexOf('切换到分支 feat/x') >= 0, '确认卡上的执行键写着这一次的动词（实得「' + textOf(goBtn) + '」）')
  const withResult = leaf.vcBranchPopoverNode(makeH(), trZh, {
    id: 'result-overlay', branch: branch, seed: SEED,
    result: { state: 'fail', error: true, git: 'fatal: 切不过去', step: 'switch', expected: '', actual: '', cause: '工作区有冲突' },
  })
  const resultNode = findAll(withResult, (n: any) => n.props && n.props['data-vc-result'] !== undefined)[0]
  check(!!resultNode && withResult.children.length === 6 && withResult.children[5] === resultNode, '结果块追加在第五段之后（实得子节点 ' + withResult.children.length + ' 个）')
  check(!!resultNode && resultNode.props['data-vc-result'] === 'fail' && textOf(resultNode).indexOf('fatal: 切不过去') >= 0, '失败结果写出 git 原话与环节（实得「' + textOf(resultNode) + '」）')
  check(findAll(tree, (n: any) => n.props && (n.props['data-vc-confirm'] !== undefined || n.props['data-vc-result'] !== undefined)).length === 0, '常态下不画确认卡与结果（只有给了才出现）')
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
