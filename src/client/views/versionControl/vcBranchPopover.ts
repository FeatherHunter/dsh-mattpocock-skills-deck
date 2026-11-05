// views/versionControl/vcBranchPopover.ts —— 分支浮层（#1846 收口：列出本地分支并在浮层里直接切换）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶符号用 declare，本文件不 import 任何东西。
//
// 浮层固定成五段，顺序不可改（有门禁按这个顺序数节点）：
//   1. 标题行 vcs-branch-head：h3.vcs-branch-title 与关闭按钮 vcs-branch-close；
//   2. 当前分支 vcs-branch-cur：一行读数，类名沿用旧浮层的 vcs-branch-cur；
//   3. 本地分支清单 vcs-branch-branches：一条分支一行真按钮（data-vc-branch-pick），
//      当前分支带标记且 disabled（不可点）；没有读数时如实写「还没读到」，不编造行；
//   4. 其余四个动作名 vcs-branch-list：create / delete / merge / rebase 各一行；
//   5. 指路 vcs-branch-pointer：一句话说清四个动作各自去哪一页（新建与删除 → 分支与标签，
//      合并 → 冲突向导，变基 → 变基待办）。这句话必须与 vcRealShell 的落点表一一对上：
//      说去哪一页，点下去就落在哪一页的入口，门禁 verify-1776 按落点表逐页核对文案。
// 再往后只在需要时出现：确认卡（预检判成 warn，即工作区有未提交改动）与结果（预检或执行回包）。
//
// 为什么只有「切换」做成真交互：切换是这一层最常做的事，而且它的预检、确认、凭票执行本来就是
//   4.3 那条通路（vcRealManageActions 里调），浮层只是换了一处触发点，不新增任何写命令；
//   其余四个动作要输入或要整页的确认卡，塞进来会把浮层变成第二个管理页（#1846 边界）。
// 分支读数只来自首屏快照的 workspace 片：打开浮层不新发命令，容器的动作层在切换成功后重读首屏。
// 本文件只画结构，不看 React 状态，也不发电话。

declare const vcShellConfirmCardNode: any
declare const vcShellResultNode: any

// 只指路的四个动作，顺序是规格写死的顺序，门禁按 join(',') 逐字比对。
export const VC_BRANCH_POPOVER_ACTIONS: string[] = ['create', 'delete', 'merge', 'rebase']

/**
 * 首屏快照里的本地分支读数 → 浮层要画的行。
 * 两种键都认：真机回包是 BranchInfo.short（见 src/shared/version-control/src/state.ts），
 * 早期夹具与旧快照写 name；认不出名字的行直接跳过，不画空行。
 * current 取读数里的标记，其次按身份行读到的当前分支名对齐；分离头指针时两者都是空/假，
 * 这时照实不标当前分支——不拿「大概是谁」补位。
 */
export const vcBranchPopoverRowsOf = function (seed: any, currentName: any) {
  const s: any = seed || {}
  const slice: any = s.slices && s.slices.workspace ? s.slices.workspace : null
  const ws: any = slice && slice.state === 'ok' ? slice.data : null
  const raw: any[] = ws && Array.isArray(ws.branches) ? ws.branches : (Array.isArray(s.branches) ? s.branches : [])
  const cur: string = String(currentName === undefined || currentName === null ? '' : currentName)
  const rows: any[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const b: any = raw[i] || {}
    const name: string = String(b.short || b.name || '')
    if (name === '') continue
    rows.push({
      name: name,
      current: b.current === true || (cur !== '' && name === cur),
      upstream: String(b.upstream || ''),
      gone: b.upstreamGone === true,
      ahead: Math.max(0, Number(b.ahead) || 0),
      behind: Math.max(0, Number(b.behind) || 0),
    })
  }
  // 当前分支排第一行，其余保持读数的顺序：只挪这一行，不做整体重排（与分支页同一条规则）。
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].current) {
      const one: any = rows.splice(i, 1)[0]
      rows.unshift(one)
      break
    }
  }
  return rows
}

// 一条分支的上游与领先 / 落后：与「管理 › 分支与标签」页同一套说法，两处说的是同一件事。
const vcBranchPopoverMetaOf = function (t: any, row: any) {
  const parts: string[] = []
  if (row.upstream === '') parts.push(t('vc.shell.branch2.noUpstream'))
  else if (row.gone) parts.push(row.upstream + ' · ' + t('vc.shell.branch2.upstreamGone'))
  else parts.push(row.upstream)
  if (row.ahead > 0) parts.push(t('vc.shell.branch2.ahead', { ahead: String(row.ahead) }))
  if (row.behind > 0) parts.push(t('vc.shell.branch2.behind', { behind: String(row.behind) }))
  return parts.join(' · ')
}

// 一条分支：名字 + 当前分支徽章 + 上游事实；整行是一颗真按钮（当前分支那颗置灰）。
//   data-vc-branch-pick 是事件委托认这一行的唯一依据；data-log 与 data-press 按全仓点击纪律一起挂。
//   按钮文字由三颗 span 拼成，所以行按钮自己的 white-space 要在样式里改回 normal（见 vcShellStyles）。
const vcBranchPopoverRowOf = function (h: any, t: any, row: any) {
  const kids: any[] = [h('span', { key: 'name', className: 'vcs-branch-branch-name' }, row.name)]
  if (row.current) kids.push(h('span', { key: 'cur', className: 'vcs-branch-branch-badge' }, t('vc.shell.branch2.currentBadge')))
  kids.push(h('span', { key: 'meta', className: 'vcs-branch-branch-meta' }, vcBranchPopoverMetaOf(t, row)))
  const attrs: any = {
    key: row.name,
    type: 'button',
    className: 'vcs-branch-branch',
    'data-vc-branch-pick': row.name,
    'data-press': 'button',
    'data-log': 'vc.branch.popover.pick',
    title: row.current ? t('vc.shell.branch.branchCurrentHint', { branch: row.name }) : t('vc.shell.branch.branchPick', { branch: row.name }),
  }
  if (row.current) {
    attrs.disabled = true
    attrs['aria-current'] = 'true'
    attrs['data-vc-branch-current'] = '1'
  }
  return h('li', { key: row.name, className: 'vcs-branch-li' }, [h('button', attrs, kids)])
}

// 第三段：本地分支清单。有行就画清单一句话与条数，没有行就画空态——两种状态各有自己的样子，
//   不让读者把「还没读到」当成「这个仓库没有分支」。
const vcBranchPopoverBranchesOf = function (h: any, t: any, rows: any[]) {
  const kids: any[] = [h('p', { key: 'hint', className: 'vcs-branch-branches-hint' }, t('vc.shell.branch.branchesHint'))]
  if (rows.length === 0) {
    kids.push(h('p', { key: 'empty', className: 'vcs-branch-empty', 'data-vc-branch-empty': '1' }, t('vc.shell.branch.branchEmpty')))
  } else {
    kids.push(h('p', { key: 'count', className: 'vcs-branch-count', 'data-vc-branch-count': String(rows.length) }, t('vc.shell.branch2.branchesCount', { n: String(rows.length) })))
    kids.push(h('ul', { key: 'list', className: 'vcs-branch-branches-list' }, rows.map(function (row: any) {
      return vcBranchPopoverRowOf(h, t, row)
    })))
  }
  return h('div', { key: 'branches', className: 'vcs-branch-branches', 'data-vc-branch-branches': String(rows.length) }, kids)
}

// 第四段：只指路的四个动作。它们保持 span（不画假按钮），点击意图由容器按 data-vc-branch-action 接走。
const vcBranchPopoverActionsOf = function (h: any, t: any) {
  const items: any[] = []
  for (let i = 0; i < VC_BRANCH_POPOVER_ACTIONS.length; i += 1) {
    const id: string = VC_BRANCH_POPOVER_ACTIONS[i]
    items.push(h('li', { key: id, className: 'vcs-branch-item' }, [
      h('span', { key: 'label', className: 'vcs-branch-label', 'data-vc-branch-action': id }, t('vc.shell.branch.' + id)),
    ]))
  }
  return h('ul', { key: 'acts', className: 'vcs-branch-list' }, items)
}

export const vcBranchPopoverNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const branch = String(opts.branch || '')
  const rows: any[] = vcBranchPopoverRowsOf(opts.seed, branch)
  const kids: any[] = [
    h('div', { key: 'head', className: 'vcs-branch-head' }, [
      h('h3', { key: 'title', className: 'vcs-branch-title' }, t('vc.shell.branch.title')),
      h('button', { key: 'close', type: 'button', className: 'vcs-branch-close', 'data-vc-branch-close': '1', 'data-press': 'button', 'data-log': 'vc.branch.popover.close' }, t('vc.shell.branch.close')),
    ]),
    h('p', { key: 'cur', className: 'vcs-branch-cur' }, t('vc.shell.branch.current', { branch: branch })),
    vcBranchPopoverBranchesOf(h, t, rows),
    vcBranchPopoverActionsOf(h, t),
    h('p', { key: 'ptr', className: 'vcs-branch-pointer' }, t('vc.shell.branch.pointer')),
  ]
  // 确认卡与结果贴在浮层里（结果永远留在触发它的那一块之后），不把浮层关掉：
  //   切换成功后读者还要在同一个位置看见「切过去了」，而不是回页面自己找。
  if (opts.confirm) kids.push(Object.assign({}, vcShellConfirmCardNode(h, t, opts.confirm), { key: 'confirm' }))
  if (opts.result) kids.push(Object.assign({}, vcShellResultNode(h, t, opts.result), { key: 'result' }))
  return h('div', {
    id: opts.id,
    className: 'vcs-branch-overlay',
    'data-vc-branch-overlay': '1',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': t('vc.shell.branch.title'),
  }, kids)
}
