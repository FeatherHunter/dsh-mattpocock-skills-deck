// views/versionControl/vcBranchPopover.ts —— 分支浮层的四段结构（#1829 阶段 4-D）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶符号用 declare，本文件不 import 任何东西。
//
// 浮层按规格固定成四段，顺序不可改（有门禁按这个顺序数节点）：
//   1. 标题行 vcs-branch-head：h3.vcs-branch-title 与关闭按钮 vcs-branch-close；
//   2. 当前分支 vcs-branch-cur：一行读数，类名沿用旧浮层的 vcs-branch-cur；
//   3. 五个动作名 vcs-branch-list：list / create / delete / merge / rebase 各一行；
//   4. 指路 vcs-branch-pointer：一句话说明这五个动作在「管理 › 分支与标签」页做。
//
// 不造假按钮：五个动作只是名字与去处，保持 span，不画成按钮；点击意图由容器按
// data-vc-branch-action 的事件委托接走。浮层里唯一的真按钮是关闭键（data-vc-branch-close）。
// 样式不在本文件：类名由 vcShellStyles.ts 给，本文件只保证结构。

export const vcBranchPopoverNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const branch = String(opts.branch || '')
  // 五个动作名的顺序是规格写死的顺序，门禁按 join(',') 与它逐字比对，不要按字母或词表顺序重排。
  const actionIds = ['list', 'create', 'delete', 'merge', 'rebase']
  const actions: any[] = []
  for (let i = 0; i < actionIds.length; i += 1) {
    const id = actionIds[i]
    actions.push(h('li', { key: id, className: 'vcs-branch-item' }, [
      h('span', { key: 'label', className: 'vcs-branch-label', 'data-vc-branch-action': id }, t('vc.shell.branch.' + id)),
    ]))
  }
  return h('div', {
    id: opts.id,
    className: 'vcs-branch-overlay',
    'data-vc-branch-overlay': '1',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': t('vc.shell.branch.title'),
  }, [
    h('div', { key: 'head', className: 'vcs-branch-head' }, [
      h('h3', { key: 'title', className: 'vcs-branch-title' }, t('vc.shell.branch.title')),
      h('button', { key: 'close', type: 'button', className: 'vcs-branch-close', 'data-vc-branch-close': '1' }, t('vc.shell.branch.close')),
    ]),
    h('p', { key: 'cur', className: 'vcs-branch-cur' }, t('vc.shell.branch.current', { branch: branch })),
    h('ul', { key: 'acts', className: 'vcs-branch-list' }, actions),
    h('p', { key: 'ptr', className: 'vcs-branch-pointer' }, t('vc.shell.branch.pointer')),
  ])
}
