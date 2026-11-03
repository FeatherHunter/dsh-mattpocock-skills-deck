// views/versionControl/vcShellIdentity.ts —— 版本管理页的身份行（#1829，按 #1860 还原成定稿原型的 rail）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 这一段按定稿原型 docs/prototype/vc-redesign/src/ui/rail.ts 与 62-changes-460.png 画成原型的 rail：
//   第一行（任何页面都有）：仓库名（悬停给完整工作区路径）、分支按钮（没有分支时换成「分离头指针」标签）、
//     短提交号，右侧是四颗图标入口：复制工作区路径、交给 AI、命令面板、管理；
//   第二行（只有四个一级页签）：同步事实：领先 / 落后、读取于、远端依据（点它去「远端与同步」页）、重新读取；
//   第三行（只有四个一级页签）：拉取 / 获取 / 推送（点它们同样去「远端与同步」页）+ 一句下一步；
//   第四行（只有四个一级页签、且拉取或推送有原因时）：每个有原因的动作一行「动作名 + 原因句」，
//     判定走核心 rules.judge（推送再用 vcWrite 的同一条修正），颜色分开机与提醒。
// 二级页（管理分区与顶栏入口页）按定稿原型 37/39 只保留第一行，同步两行让位给页头与正文。
//
// 与原型已知的差异（写进 #1860 的偏差表）：原型原因行里「推送但没有可推的提交」这一条，
//   核心判定没有对应理由（领先为 0 时核心仍允许推送），这里不画。
// 这些入口里只有复制路径自己处理点击（剪贴板不需要宿主电话）；其余只给 data-*，由容器的事件委托翻译。

declare const CAPABILITIES: any[]
// 原因行要用的判定与词条映射都住在客户端闭包里（核心 rules.judge、vcWrite 的推送修正与理由键映射），
//   跨叶只声明，不复制判据。
declare function judge(screen: any, op: any): any
declare function vcReasonKeysOf(reasons: any): any
declare function vcPushDecisionOf(decision: any): any

// 身份行用到的六个图标：路径抄自原型 docs/prototype/vc-redesign/src/ui/dom.ts 的 ICON_PATHS，
//   形状与线宽与原型一致（24×24 视窗、1.8 线宽、圆头圆角）。
const VC_RAIL_ICON_PATHS: Record<string, string> = {
  copy: 'M8 8h10v12H8zM6 16H4V4h12v2',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14M16.5 16.5L21 21',
  settings: 'M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2',
  chevron: 'M6 9l6 6 6-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
}

const vcRailIconOf = function (h: any, kind: string, size: number) {
  return h('svg', {
    className: 'icon', viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, [h('path', { key: 'p', d: VC_RAIL_ICON_PATHS[kind] })])
}

// 图标按钮：可见内容只有一个内联 svg，可读名字全在 aria-label / title 上（原型 .icon-btn 同款）。
const vcRailIconButtonOf = function (h: any, t: any, o: any) {
  const attrs: any = {
    className: 'icon-btn' + (o.on === true ? ' is-on' : ''),
    type: 'button',
    'aria-label': o.label,
    title: o.title,
  }
  if (o.key) attrs.key = o.key
  if (o.expanded !== undefined) attrs['aria-expanded'] = o.expanded ? 'true' : 'false'
  if (o.controls) attrs['aria-controls'] = o.controls
  if (o.action) attrs['data-vc-' + o.action + ''] = '' + (o.value === undefined ? '1' : o.value)
  if (o.press) attrs['data-press'] = o.press
  if (o.log) attrs['data-log'] = o.log
  if (typeof o.onClick === 'function') attrs.onClick = o.onClick
  // 四颗全局入口的图标与原型一致用 14px（原型 icon(..., 14)）；只有重新读取那颗仍是 13px。
  attrs.children = vcRailIconOf(h, o.icon, o.size || 14)
  return h('button', attrs)
}

// 原因行的数据：拉取与推送各自把核心 rules.judge 的判定理由翻成页面那两行（原型 rail-reasons）。
//   推送沿用写操作面板的同一条修正（没有上游 / 上游被删不算不能推，见 vcWrite.vcPushDecisionOf），
//   否则会出现「按钮能点、原因行却说被挡住」的矛盾。没有原因的动作不出行；两行都没原因就是空数组。
//   只翻词条、不写文案：理由键 → 词条键的映射只有 vcWrite 那一处（VC_BLOCK_KEY）。
//   门禁直接调它算期望值（verify-1776 的 T4e / T31g），所以导出成一支纯函数，不碰 React。
export const vcRailReasonsOf = function (screen: any, t: any): any[] {
  if (!screen || typeof t !== 'function') return []
  const rows: any[] = []
  const ids: string[] = ['pull', 'push']
  ids.forEach(function (id: string) {
    const decision: any = id === 'push' ? vcPushDecisionOf(judge(screen, 'push')) : judge(screen, 'pull')
    // 'ok' 是「没有理由」的占位：映射表里它的词条键是空串，而 vcReasonKeysOf 会把空串落到兜底
    //   「该步骤当前不可用」——那是给表外理由的兜底，不能让允许的动作也冒出一行原因，所以先摘掉再翻。
    const reasons: any[] = (Array.isArray(decision && decision.reasons) ? decision.reasons : []).filter(function (r: any) { return String(r) !== 'ok' })
    const keys: string[] = vcReasonKeysOf(reasons)
    if (keys.length === 0) return
    rows.push({
      id: id,
      act: t('vc.shell.sync.' + id),
      text: keys.map(function (k: string) { return t(k) }).join('；'),
      tone: decision && decision.verdict === 'block' ? 'block' : 'warn',
    })
  })
  return rows
}

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
  const detached = opts.detached === true || branch === ''
  const secondary = opts.secondary === true
  // 原因行由容器算好再传进来（每条 { id: 'pull' | 'push', act, text, tone: 'block' | 'warn' }）：
  //   这里只按原型的形状画，不自己判可点性；数组为空时整块不出现。
  const reasons: any[] = Array.isArray(opts.reasons) ? opts.reasons : []
  // ── 第一行：仓库名 / 分支 / 短号 + 右侧四颗图标入口 ─────────────────────────────
  const idMain: any[] = []
  // 仓库名读不到时退回分支名，不留空行（与改造前的兜底一致）。
  idMain.push(h('span', {
    key: 'repo', className: 'rail-repo mono', 'data-vc-worktree-path': path, title: path,
  }, repo !== '' ? repo : (branch !== '' ? branch : t('vc.shell.identity.detachedChip'))))
  if (detached) {
    idMain.push(h('span', { key: 'detached', className: 'chip chip-warn chip-sm' }, t('vc.shell.identity.detachedChip')))
  } else {
    idMain.push(h('span', { key: 'slash', className: 'rail-slash', 'aria-hidden': 'true' }, '/'))
    const branchAttrs: any = {
      key: 'branch', className: 'rail-branch-btn', type: 'button', 'data-vc-branch-btn': '1',
      'aria-expanded': opts.branchOpen ? 'true' : 'false',
      title: t('vc.shell.identity.branchHint'), 'aria-label': t('vc.shell.identity.branchHint'),
    }
    if (opts.branchOpen) branchAttrs['aria-controls'] = opts.branchOverlayId
    idMain.push(h('button', branchAttrs, [
      h('span', { key: 'name', className: 'rail-branch mono' }, branch),
      h('span', { key: 'chev', className: 'rail-branch-chevron', 'aria-hidden': 'true' }, vcRailIconOf(h, 'chevron', 11)),
    ]))
  }
  if (oid !== '') idMain.push(h('span', { key: 'oid', className: 'rail-oid mono' }, oid.slice(0, 7)))
  // 复制路径是这里唯一自己处理点击的入口：剪贴板不可用或被拒时静默退回，不做假的「已复制」提示。
  const copyBtn = vcRailIconButtonOf(h, t, {
    key: 'copy', icon: 'copy', action: 'copy-path', value: path, press: 'button', log: 'vc.shell.identity.copy-path',
    label: t('vc.shell.identity.copyPath'), title: t('vc.shell.identity.copyPathHint'),
    onClick: function () {
      const nav: any = typeof navigator === 'undefined' ? null : navigator
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        let writing: any = null
        try { writing = nav.clipboard.writeText(path) } catch (e) { writing = null }
        if (writing && typeof writing.catch === 'function') writing.catch(function () {})
      }
    },
  })
  const tools: any[] = [copyBtn]
  // 交给 AI 只在容器把同一套交接回调传进来时画：点它开新会话预填提示，不碰 git。
  if (typeof opts.onOpenHandoff === 'function') {
    tools.push(vcRailIconButtonOf(h, t, {
      key: 'handoff', icon: 'spark', action: 'identity-handoff', press: 'button', log: 'vc.shell.identity.handoff',
      label: t('vc.shell.identity.handoff'), title: t('vc.shell.identity.handoffHint'), onClick: function () { opts.onOpenHandoff() },
    }))
  }
  tools.push(vcRailIconButtonOf(h, t, {
    key: 'search', icon: 'search', action: 'search-entry', expanded: opts.paletteOpen === true, controls: opts.paletteOpen ? opts.paletteId : '',
    label: t('vc.shell.identity.paletteHint', { n: CAPABILITIES.length }), title: t('vc.shell.identity.paletteHint', { n: CAPABILITIES.length }),
  }))
  tools.push(vcRailIconButtonOf(h, t, {
    key: 'gear', icon: 'settings', action: 'gear-btn', expanded: opts.gearOpen === true, controls: opts.gearOpen ? opts.gearId : '',
    on: opts.gearOpen === true, label: t('vc.shell.identity.gearHint'), title: t('vc.shell.identity.gearHint'),
  }))
  const kids: any[] = [h('div', { key: 'id', className: 'rail-row rail-id' }, [
    h('div', { key: 'main', className: 'rail-id-main' }, idMain),
    h('div', { key: 'tools', className: 'rail-tools', role: 'group', 'aria-label': t('vc.shell.identity.tools') }, tools),
  ])]
  // ── 第二、三行：同步事实与同步动作（只有一级页签才有）──────────────────────────
  if (!secondary) {
    const zero = function (v: number) { return v === 0 ? ' is-zero' : '' }
    kids.push(h('div', { key: 'sync', className: 'rail-row rail-sync', 'data-vc-sync-facts': '1' }, [
      h('span', { key: 'delta', className: 'sync-delta', role: 'group', 'aria-label': t('vc.shell.identity.ahead', { n: ahead }) + ' / ' + t('vc.shell.identity.behind', { n: behind }) }, [
        h('span', { key: 'ahead', className: 'sync-delta-item is-ahead' + zero(ahead), 'data-vc-ahead': String(ahead) }, [
          h('span', { key: 'k', className: 'sync-delta-label' }, t('vc.shell.sync.aheadLabel')),
          h('span', { key: 'v', className: 'sync-delta-num' }, String(ahead)),
        ]),
        h('span', { key: 'sep', className: 'sync-delta-sep', 'aria-hidden': 'true' }, ' '),
        h('span', { key: 'behind', className: 'sync-delta-item is-behind' + zero(behind), 'data-vc-behind': String(behind) }, [
          h('span', { key: 'k', className: 'sync-delta-label' }, t('vc.shell.sync.behindLabel')),
          h('span', { key: 'v', className: 'sync-delta-num' }, String(behind)),
        ]),
      ]),
      h('span', { key: 'read', className: 'fact', 'aria-label': t('vc.shell.identity.readHint'), title: t('vc.shell.identity.readHint') }, [
        h('span', { key: 'k', className: 'fact-k' }, t('vc.shell.sync.readLabel')),
        h('span', { key: 'v', className: 'fact-v', 'data-vc-read-at': when }, when),
      ]),
      h('button', {
        key: 'basis', className: 'fact fact-btn', type: 'button', 'data-vc-sync': '1', 'data-vc-sync-remote': remote,
        title: t('vc.shell.identity.basisHint'), 'aria-label': t('vc.shell.identity.basisHint'),
      }, [
        h('span', { key: 'k', className: 'fact-k' }, basis !== '' ? t('vc.shell.sync.basisRemote', { remote: remote }) : t('vc.shell.sync.basisLabel')),
        h('span', { key: 'v', className: 'fact-v' }, basis !== '' ? basis : t('vc.shell.identity.basisUnknown')),
      ]),
      h('button', {
        key: 'reload', className: 'icon-text-btn', type: 'button', 'data-vc-refresh': '1',
        title: t('vc.shell.identity.reload') + '（' + when + '）',
      }, [
        h('span', { key: 'i', className: 'icon-text-btn-icon', 'aria-hidden': 'true' }, vcRailIconOf(h, 'refresh', 13)),
        h('span', { key: 'label', className: 'icon-text-btn-label' }, t('vc.shell.identity.reload')),
      ]),
    ]))
    const acts: any[] = ['pull', 'fetch', 'push'].map(function (id: string) {
      const suggested = (id === 'push' && ahead > 0) || (id === 'pull' && behind > 0)
      const kind = id === 'fetch' ? 'ghost' : 'secondary'
      const attrs: any = {
        key: id, type: 'button',
        className: 'btn btn-' + kind + ' btn-sm' + (suggested ? ' is-suggested' : ''),
        'data-vc-sync': '1', 'data-vc-sync-remote': remote, 'data-vc-sync-intent': id,
        'aria-label': t('vc.shell.sync.actHint', { act: t('vc.shell.sync.' + id) }),
      }
      if (suggested) attrs['data-vc-sync-primary'] = '1'
      return h('button', attrs, t('vc.shell.sync.' + id))
    })
    kids.push(h('div', { key: 'acts', className: 'rail-row rail-acts', 'data-vc-sync-acts': '1' }, acts.concat([
      h('span', { key: 'next', className: 'next-step', 'aria-label': t('vc.shell.identity.nextHint'), title: t('vc.shell.identity.nextHint') }, [
        h('span', { key: 'k', className: 'next-k' }, t('vc.shell.sync.nextLabel')),
        h('span', { key: 'v', className: 'next-v' }, t('vc.shell.sync.nextStage')),
      ]),
    ])))
    // 原因行：原型只在有原因时画这一块，每行一个动作（拉取 / 推送），动作名在前、原因句在后；
    //   被挡住的行按 is-block 着色、只提醒的行按 is-warn 着色（颜色由样式表按类名给）。
    if (reasons.length > 0) {
      kids.push(h('div', { key: 'reasons', className: 'rail-reasons', 'data-vc-reasons': '1' }, reasons.map(function (row: any) {
        const id = String(row && row.id ? row.id : '')
        const block = row && row.tone === 'block'
        return h('div', { key: id, className: 'reason' + (block ? ' is-block' : ' is-warn'), 'data-vc-reason': id }, [
          h('span', { key: 'k', className: 'reason-k' }, String(row && row.act ? row.act : '')),
          h('span', { key: 'v', className: 'reason-v' }, String(row && row.text ? row.text : '')),
        ])
      })))
    }
  }
  return h('header', { className: 'rail' + (secondary ? ' is-page' : ''), 'data-vc-identity': '1', 'aria-label': t('vc.shell.identity.label') }, kids)
}
