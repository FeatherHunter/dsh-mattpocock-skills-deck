/**
 * views/DetailActionBar.ts —— 容器详情页底部的三态动作组（#1286）
 *
 * 为什么从 MapDetail.ts 拆出来：那个文件贴着仓库 350 有效行的上限（tests/verify-file-granularity.ts），
 *   规格那一套再塞进去就超了。与 #807 当年把顶栏拆成 MapDetailTop.ts、#691 把头部拆成
 *   MapDetailHead.ts 是同一个理由。这次只搬代码、不改行为。
 *
 * 这一块画的是「容器」的动作：探索地图与规格共用同一套详情页骨架，差的是按钮文字、底色与
 *   点下去注入的提示词。取色与取词一律问内核 container-view.ts（containerTriState /
 *   containerPromptText）——列表页用的是同一份，所以「按钮上写什么」与「点下去注入什么」
 *   两边永远对得上。
 *
 * 提示词口径（#1286 拍板）：
 * - 探索地图：空态「检查」注入检查提示词；有未关「执行」注入推进式提示词；全关「完成」注入收尾提示词。
 * - 规格：空态「拆票」注入 /to-tickets 链接；有未关「执行」注入 /implement-spec 链接；全关「完成」注入收尾提示词。
 *   规格不用通用「执行这张票」模板——那个模板的正文首行是 /wayfinder，用在规格上不对。
 *   这几条技能调用的正式文案归 #1281（提示词那条线），这里先给最小可用形态。
 */
declare function Ic(props?: any): any;
declare const Tip: any;
declare function issueUrlFor(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function inspectPrompt(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function startText(...args: any[]): any;
declare function completePrompt(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function containerPromptText(...args: any[]): any;
declare const CONTAINER_ACCENT: any;

export const DetailActionBar = ({ st, m, kind, cState, effStats, tri }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cKind = kind || 'map'
  const state = cState || 'open'
  // 三态配置：真源在 container-view.ts（列表页同一份）。真源不在时（例如门禁单独求值本文件）
  //   退回同口径的老表：探索地图三态与今天一字不差。
  const t = tri || (typeof containerTriState === 'function'
    ? containerTriState(cKind, state)
    : (state === 'empty'
      ? { labelKey: 'act.inspect', color: '#f59e0b', icon: 'search', titleKey: 'map.inspectTitle' }
      : (state === 'done'
        ? { labelKey: 'act.done', color: '#3fb950', icon: 'check', titleKey: 'map.doneTitle' }
        : { labelKey: 'act.execute', color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', icon: 'play', titleKey: 'map.executeTitle' })))
  const url = (typeof issueUrlFor === 'function') ? (function () { try { return issueUrlFor(st, m.number) } catch (e) { return '' } })() : ''
  // 点下去注入什么。真源是 container-view.ts 的 containerPromptText；它不在时退回今天的老口径
  //   （检查 / 完成 / 推进三段），行为与今天一字不差。
  const promptText = function (): string {
    if (typeof containerPromptText === 'function') {
      try {
        // 统计用 effStats（按需取回的那一份），让收尾提示词里的数字与头部计数行一致。
        return containerPromptText(st, Object.assign({}, m, { stats: effStats || m.stats }), cKind, state, url)
      } catch (e) { /* 落回老口径 */ }
    }
    if (state === 'empty') {
      // 规格空态：注入拆票技能调用（正式文案归 #1281）。这个兜底只在 container-view.ts
      //   不在时才会走到，口径与它保持一致。
      if (cKind === 'spec') return '/to-tickets ' + url
      let t2 = ''
      try { t2 = inspectPrompt(st, m.number, m.title) } catch (e) {
        try {
          t2 = promptTextFor(st, 'mapInspect', { n: String(m.number || ''), ['title']: String(m.title || ''), url: url })
          if (t2) t2 = '/wayfinder ' + url + '\n\n' + t2
        } catch (_) { t2 = startText(st, m) }
      }
      return t2
    }
    if (state === 'done') return completePrompt(st, m.number, m.title, (effStats ? effStats.total : 0), (effStats ? effStats.closed : 0))
    // 规格未完成：注入 /implement-spec 链接；通用执行模板首行是 /wayfinder，用在规格上不对（§3.4）。
    if (cKind === 'spec') return '/implement-spec ' + url
    return startText(st, m)
  }
  // 字色：完成态沿用今天的深绿字（#0c1a10），其余按底色深浅在深墨与白字之间择优。
  const textColor = state === 'done' ? '#0c1a10' : ((typeof isLightHex === 'function' && isLightHex(t.color)) ? '#140a1e' : '#ffffff')
  return h('div', { className: 'acts' }, [
    h(Tip, { content: tr(t.titleKey) }, h('button', { className: 'dsws-btn primary', onClick: function () {
      inject(st, promptText())
    }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: t.color, borderColor: 'transparent', color: textColor, fontWeight: 700 } }, [
      Ic({ n: t.icon, size: 11 }),
      h('span', null, tr(t.labelKey)),
    ])),
    (function () {
      // 存档链接：GitHub 票给网页链接，本地 Markdown 房给「让宿主打开这个路径」的按钮。
      const archiveUrl = issueUrlFor(st, m.number)
      const archiveIsHttp = /^https?:\/\//i.test(String(archiveUrl || ''))
      const openArchive = function (e: any) {
        e.stopPropagation()
        const u = issueUrlFor(st, m.number)
        if (!u) return
        if (/^https?:\/\//i.test(String(u))) {
          try { window.open(u, '_blank', 'noreferrer') } catch (err) {}
        } else {
          try { if (typeof host !== 'undefined' && host.call) host.call('wf.openPath', { path: u }) } catch (err2) {}
        }
      }
      const archiveBtnStyle: any = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 }
      return archiveIsHttp
        ? h('a', { className: 'dsws-btn ghost', href: archiveUrl, target: '_blank', rel: 'noreferrer', style: archiveBtnStyle }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))])
        : h('button', { className: 'dsws-btn ghost', onClick: openArchive, style: archiveBtnStyle }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))])
    })(),
  ])
}
