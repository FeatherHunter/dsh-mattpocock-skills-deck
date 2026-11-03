// views/versionControl/vcShellIdentity.ts —— 版本管理页的身份行与同步带（#1829）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 这一段按定稿原型 docs/prototype/vc-redesign/screenshots/62-changes-460.png 画三行：
//   1. 身份行：仓库名（悬停给完整工作区路径）、分支按钮、短提交号、能力计数，
//      右侧是复制工作区路径、全库搜索、管理三个入口；
//   2. 同步事实行：领先 / 落后、读取于、远端依据（点它去「远端与同步」页）、重新读取；
//   3. 同步动作行：拉取 / 获取 / 推送（点它们同样去「远端与同步」页）+ 一句下一步。
// 工作区完整路径按定稿原型收进仓库名的悬停提示与复制按钮，不再单独占一行（原型 README 第 317 行）；
//   票面验收写「工作树路径」时指的是同一份读数，这里用 title 与 data-vc-worktree-path 带着它。
// 能力计数仍留在身份行：162 条账本「每条恰一个主入口」的门禁按 .vcs-identity-count 找它。
// 除复制路径外，这些入口只翻译 data-* 交给容器的事件委托；复制路径自己处理点击（它不需要宿主电话）。

declare const CAPABILITIES: any[]

export const vcShellIdentityNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const branch = String(opts.branch || '')
  const repo = String(opts.repo || '')
  const path = String(opts.worktreePath || '')
  const oid = String(opts.oid || '')
  const when = String(opts.when || '')
  const basis = String(opts.basis || '')
  const remote = String(opts.remote || 'origin')
  const ahead = Number(opts.ahead || 0)
  const behind = Number(opts.behind || 0)
  const detached = opts.detached === true
  const left: any[] = []
  // 仓库名与分支连着读作「哪个仓库的哪个分支」；仓库名读不到时退回分支名，不留空行。
  left.push(h('span', { key: 'repo', className: 'vcs-id-repo', 'data-vc-worktree-path': path }, repo !== '' ? repo : branch))
  const branchAttrs: any = {
    key: 'branch',
    className: 'vcs-identity-branch',
    type: 'button',
    'data-vc-branch-btn': '1',
    'aria-expanded': opts.branchOpen ? 'true' : 'false',
  }
  if (opts.branchOpen) branchAttrs['aria-controls'] = opts.branchOverlayId
  left.push(h('button', branchAttrs, detached ? t('vc.shell.identity.detached') : t('vc.shell.identity.branch') + '：' + branch))
  if (oid !== '') left.push(h('span', { key: 'oid', className: 'vcs-id-oid' }, oid.slice(0, 7)))
  left.push(h('span', { key: 'count', className: 'vcs-identity-count' }, t('vc.shell.identity.capCount', { n: CAPABILITIES.length })))
  const right: any[] = []
  // 复制路径是这里唯一自己处理点击的入口：剪贴板不可用时静默退回，不做假的「已复制」提示。
  right.push(h('button', {
    key: 'copy', className: 'vcs-identity-copy', type: 'button', 'aria-label': t('vc.shell.identity.copyPath'),
    'data-vc-copy-path': path, 'data-press': 'button', 'data-log': 'vc.shell.identity.copy-path',
    onClick: function () {
      const nav: any = typeof navigator === 'undefined' ? null : navigator
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        // writeText 返回 Promise：剪贴板没权限或被拒时静默退回，不做假的「已复制」提示，也不留未处理的拒绝。
        let writing: any = null
        try { writing = nav.clipboard.writeText(path) } catch (e) { writing = null }
        if (writing && typeof writing.catch === 'function') writing.catch(function () {})
      }
    },
  }, t('vc.shell.identity.copyPath')))
  // 定稿原型身份行右侧的四颗入口（docs/prototype/vc-redesign/README:77）：复制路径、交给 AI、全库搜索、管理。
  //   交给 AI 这一颗只在容器把同一套交接回调传进来时画，点它开新会话预填提示、不碰 git。
  if (typeof opts.onOpenHandoff === 'function') {
    right.push(h('button', {
      key: 'handoff', className: 'vcs-identity-handoff', type: 'button', 'aria-label': t('vc.shell.identity.handoff'),
      'data-vc-identity-handoff': '1', 'data-press': 'button', 'data-log': 'vc.shell.identity.handoff',
      onClick: function () { opts.onOpenHandoff() },
    }, t('vc.shell.identity.handoff')))
  }
  const searchAttrs: any = {
    key: 'search', className: 'vcs-identity-search', type: 'button',
    'data-vc-search-entry': '1', 'aria-expanded': opts.paletteOpen ? 'true' : 'false',
  }
  if (opts.paletteOpen) searchAttrs['aria-controls'] = opts.paletteId
  right.push(h('button', searchAttrs, t('vc.shell.identity.search')))
  const gearAttrs: any = {
    key: 'gear', className: 'vcs-identity-gear', type: 'button',
    'data-vc-gear-btn': '1', 'aria-expanded': opts.gearOpen ? 'true' : 'false',
  }
  if (opts.gearOpen) gearAttrs['aria-controls'] = opts.gearId
  right.push(h('button', gearAttrs, t('vc.shell.gear.open')))
  // 同步事实行：四个读数各占一格；「远端依据」是一颗按钮，点它进远端与同步页看依据时间与上游。
  const facts: any[] = [
    h('span', { key: 'ahead', className: 'vcs-sync-ahead', 'data-vc-ahead': String(ahead) }, t('vc.shell.identity.ahead', { n: ahead })),
    h('span', { key: 'behind', className: 'vcs-sync-behind', 'data-vc-behind': String(behind) }, t('vc.shell.identity.behind', { n: behind })),
    h('span', { key: 'read', className: 'vcs-sync-read', 'data-vc-read-at': when }, t('vc.shell.identity.readAt', { when: when })),
    h('button', { key: 'basis', className: 'vcs-sync-basis', type: 'button', 'data-vc-sync': '1', 'data-vc-sync-remote': remote, 'aria-label': t('vc.shell.sync.open') }, basis !== '' ? t('vc.shell.identity.basis', { when: basis }) : t('vc.shell.identity.basisUnknown')),
    h('button', { key: 'reload', className: 'vcs-sync-reload', type: 'button', 'data-vc-refresh': '1' }, t('vc.shell.identity.reload')),
  ]
  // 同步动作行：三颗按钮都只给导航意图（data-vc-sync），真正的拉取 / 获取 / 推送在「远端与同步」页里做。
  const acts: any[] = ['pull', 'fetch', 'push'].map(function (id: string) {
    const attrs: any = {
      key: id, type: 'button', className: 'vcs-sync-act', 'data-vc-sync': '1', 'data-vc-sync-remote': remote,
      'data-vc-sync-intent': id, 'aria-label': t('vc.shell.sync.actHint', { act: t('vc.shell.sync.' + id) }),
    }
    // 建议态跟随领先 / 落后：领先时建议推送，落后时建议拉取，两边都没有时不加建议态。
    if ((id === 'push' && ahead > 0) || (id === 'pull' && behind > 0)) attrs['data-vc-sync-primary'] = '1'
    return h('button', attrs, t('vc.shell.sync.' + id))
  })
  acts.push(h('span', { key: 'next', className: 'vcs-sync-next' }, t('vc.shell.sync.next', { step: t('vc.shell.sync.nextStage') })))
  // #1829 阶段 4：二级页（管理分区与顶栏入口页，打开时带返回来源页）按定稿原型 37/39 只保留身份行；
  //   同步事实行与同步动作行属于「改动 / 提交 / 工作树 / 贮藏」四个一级页签，二级页让位给页头与正文。
  const secondary = opts.secondary === true
  const kids: any[] = [
    h('div', { key: 'main', className: 'vcs-id-main' }, [
      h('div', { key: 'left', className: 'vcs-identity-left' }, left),
      h('div', { key: 'right', className: 'vcs-identity-right' }, right),
    ]),
  ]
  if (!secondary) {
    kids.push(h('div', { key: 'facts', className: 'vcs-sync-facts', 'data-vc-sync-facts': '1' }, facts))
    kids.push(h('div', { key: 'acts', className: 'vcs-sync-acts', 'data-vc-sync-acts': '1' }, acts))
  }
  return h('header', { className: 'vcs-identity' + (secondary ? ' is-secondary' : ''), 'data-vc-identity': '1' }, kids)
}
