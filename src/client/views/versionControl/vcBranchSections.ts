// views/versionControl/vcBranchSections.ts —— 「分支与标签」页的后两段正文与小工具（#1881 从 vcBranchPage 拆出）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 为什么单独一片：#1881 要给每条分支行加一颗「⋯」菜单、再把页尾收成两行，而 vcBranchPage.ts 当时
// 已经用到 346 / 350 有效行，再往里写就会撞 tests/verify-file-granularity.ts 的每文件上限。
// 拆出来的是页面的 ② 标签段与 ③ 上游跟踪段，加上它们共用的四件小工具：
//   1) vcBranchTextOf —— 统一过词表取词（t 缺席时回键本身，独立求值的那几扇门禁不传词表）；
//   2) vcBranchOidTextOf —— 提交短号（分支行与标签行都要）；
//   3) vcBranchWhenOf —— 「什么时候」那一句（相对时间由 vcText 的同一判据给）；
//   4) vcBranchEmptyOf —— 段内空态（两段都要画「这里为什么是空的 + 下一步」）。
//
// 依赖方向单向：本叶只调 vcPageHead.ts 的三个原语（分区、事实网格、对象行）与 vcText.ts 的 vcWhenText，
// vcBranchPage.ts 反过来 declare 本叶的函数；本叶不引用 vcBranchPage 里的任何东西。
// vcWhenText 缺席时本叶如实不画时间（vcBranchWhenOf 返回空串），不自己编一个——verify-1586-branches
// 拼的是数据层、本叶与页面叶子，没有 vcText，所以这条兜底不是可选的。

declare const vcWhenText: any
// 来自页面骨架原语 vcPageHead.ts（#1829 阶段 4）：分区、事实网格、对象行三件。
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcPageFactGridNode(h: any, t: any, o: any): any

// 词条取值：叶子内部统一过 t，调用方只给键；t 缺席时回键本身（独立求值的那几扇门禁不传词表）。
export const vcBranchTextOf = function (t: any, key: string, vars?: any): string {
  return typeof t !== 'function' ? key : (vars ? String(t(key, vars)) : String(t(key)))
}

// 提交号只取前 7 位：行里放整串 40 位会把 300 宽撑破；短号只是标识，不承担唯一定位。
export const vcBranchOidTextOf = function (oid: any) { const s = String(oid === null || oid === undefined ? '' : oid); return s.length > 7 ? s.slice(0, 7) : s }

// 提交时间怎么说交给 vcText 的同一个判据（一周内相对、更早绝对）；verify-1586-branches 拼的是
//   数据层、本叶与页面叶子，闭包里没有 vcText，就如实不画时间，不自己编一个。
export const vcBranchWhenOf = function (t: any, nowMs: any, ms: any) {
  if (!(Number(nowMs) > 0)) return ''
  if (typeof vcWhenText !== 'function') return ''
  return String(vcWhenText(t, Number(nowMs), ms) || '')
}

// 段内空态：一句话说清这里为什么是空的，再补一句下一步；绝不画假行。
export const vcBranchEmptyOf = function (h: any, t: any, titleKey: string, nextKey: string, cls: string) {
  return h('div', { key: 'empty', className: cls }, [
    h('span', { key: 'title', className: 'vcs-branch2-empty-title' }, t(titleKey)),
    h('span', { key: 'next', className: 'vcs-branch2-empty-next' }, t(nextKey)),
  ])
}

// 一条标签行：名字 + 附注标记 + 提交短号；下一行是打标签的时间与标签说明。
//   行尾两颗：验签（4.12，只读动作，走预检电话）与删除（4.11，危险动作，先确认卡后执行）。
//   data-vc-tag-name 必须挂在行上：容器的事件委托按行取标签名（vcRealDelegate 读的是行属性）。
export const vcBranchTagRowOf = function (h: any, t: any, o: any, tag: any) {
  const name = String(tag.name || '')
  const titleKids: any[] = [h('span', { key: 'name', className: 'vcs-branch2-name' }, name)]
  const oid = vcBranchOidTextOf(tag.oid)
  if (oid !== '') titleKids.push(h('span', { key: 'oid', className: 'obj-oid vcs-branch2-oid' }, oid))
  if (tag.annotated === true) titleKids.push(h('span', { key: 'ann', className: 'vcs-branch2-tag' }, t('vc.shell.branch2.annotated')))
  const when = vcBranchWhenOf(t, o.nowMs, tag.atMs)
  const subject = String(tag.subject || '')
  const subParts: string[] = []
  if (when !== '') subParts.push(when)
  if (subject !== '') subParts.push(subject)
  const main: any[] = [h('span', { key: 'title', className: 'obj-title' }, titleKids)]
  if (subParts.length > 0) main.push(h('span', { key: 'sub', className: 'obj-sub' }, subParts.join(' · ')))
  const side: any[] = [
    h('button', { key: 'verify', type: 'button', className: 'vcs-branch2-act', 'data-vc-tag-action': 'verify', 'data-vc-op': '4.12', 'data-press': 'button', 'data-log': 'vc.branch.page.tag.verify' }, t('vc.shell.branch2.verify')),
    h('button', { key: 'delete', type: 'button', className: 'vcs-branch2-act vcs-branch2-danger', 'data-vc-tag-action': 'delete', 'data-vc-op': '4.11', 'data-press': 'button', 'data-log': 'vc.branch.page.tag.delete' }, t('vc.shell.branch2.tagDelete')),
  ]
  return vcPageObjRowNode(h, t, { main: main, side: side, attrs: { 'data-vc-tag-row': name, 'data-vc-tag-name': name, 'data-vc-tag-annotated': tag.annotated === true ? '1' : '0' } })
}

// ② 标签段：一行一个标签；没有标签时给空态，不画空列表。
export const vcBranchTagsSectionOf = function (h: any, t: any, board: any, view: any) {
  const tags: any[] = Array.isArray(board.tags) ? board.tags : []
  const kids: any[] = []
  if (tags.length > 0) {
    kids.push(h('div', { key: 'rows', className: 'obj-list', 'data-vc-tag-list': String(tags.length) }, tags.map(function (tag: any) { return vcBranchTagRowOf(h, t, view, tag) })))
  } else {
    kids.push(h('div', { key: 'empty', className: 'vcs-branch2-list', 'data-vc-tag-list': '0' }, [
      vcBranchEmptyOf(h, t, 'vc.shell.branch2.noTags', 'vc.shell.branch2.noTagsNext', 'vcs-branch2-empty'),
    ]))
  }
  return vcPageSectionNode(h, t, {
    title: 'vc.shell.branch2.section.tags',
    countText: vcBranchTextOf(t, 'vc.shell.branch2.tagsCount', { n: String(tags.length) }),
    note: 'vc.shell.branch2.note.tags',
    children: kids,
  })
}

// ③ 上游跟踪段：四条事实。值全部来自这一次读回包，缺哪一条就说「没有」，不补 0、不编依据。
export const vcBranchTrackingSectionOf = function (h: any, t: any, board: any) {
  const rows: any[] = Array.isArray(board.branches) ? board.branches : []
  const currentName = board.current ? String(board.current.name || '') : ''
  let currentRow: any = null
  for (let i = 0; i < rows.length; i += 1) if (rows[i] && (rows[i].current === true || String(rows[i].name || '') === currentName)) currentRow = rows[i]
  const upstream = currentRow ? String(currentRow.upstream || '') : ''
  const ahead = currentRow ? Number(currentRow.ahead) || 0 : 0
  const behind = currentRow ? Number(currentRow.behind) || 0 : 0
  const currentGone = !!(currentRow && currentRow.gone === true)
  const syncText = upstream === ''
    ? vcBranchTextOf(t, 'vc.shell.branch2.noUpstream')
    : (currentGone
      ? vcBranchTextOf(t, 'vc.shell.branch2.upstreamGone')
      : (ahead === 0 && behind === 0
        ? vcBranchTextOf(t, 'vc.shell.branch2.inSync')
        : vcBranchTextOf(t, 'vc.shell.branch2.aheadBehind', { ahead: String(ahead), behind: String(behind) })))
  // 读时刻只用来算「读于多久之前」这一句：它不是可调时长，所以不新起一个带时间后缀的名字。
  const readAt = Number(board.readAtMs) || 0
  const basis = readAt > 0
    ? vcBranchTextOf(t, 'vc.shell.branch2.basis.known', { when: vcBranchWhenOf(t, readAt, readAt) })
    : vcBranchTextOf(t, 'vc.shell.branch2.basis.unknown')
  const facts: any[] = [
    { key: 'vc.shell.branch2.fact.current', value: currentName || vcBranchTextOf(t, 'vc.shell.branch2.unknown'), mono: currentName !== '', attrs: { 'data-vc-branch-current': currentName } },
    { key: 'vc.shell.branch2.fact.upstream', value: upstream === '' ? vcBranchTextOf(t, 'vc.shell.branch2.noUpstream') : upstream, mono: upstream !== '' },
    { key: 'vc.shell.branch2.fact.sync', value: syncText },
    { key: 'vc.shell.branch2.fact.basis', value: basis },
  ]
  return vcPageSectionNode(h, t, {
    title: 'vc.shell.branch2.section.tracking',
    note: 'vc.shell.branch2.note.tracking',
    children: [vcPageFactGridNode(h, t, { facts: facts })],
  })
}
