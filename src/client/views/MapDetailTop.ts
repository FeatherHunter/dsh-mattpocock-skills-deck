/**
 * views/MapDetailTop.ts — 地图详情顶部操作行（#807 从 MapDetail.js 拆出）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，与 MapDetailHead.ts 同模式）。
 * 为什么单独拆一份：MapDetail.ts 贴着仓库 350 行的上限，顶栏这次要加折叠标记、
 * 右侧归组、新会话实心、复制与外链两颗图标，直接改会顶穿上限。
 *
 * 与 IssueDetail.ts #763 同口径：单行不换行、越窄越收、只剩图标、不放省略号；
 * 图标永不消失；看不见的字直接裁掉，不补省略号；完整串留悬停。
 * 五串字（折叠机按此顺序让位）：返回按钮的字、面包屑、地图片的 wayfinder:map
 * （复用折叠机的 snapshot 槽，与工单页快照提示同位）、主动作按钮的字、新会话按钮的字。
 * 复制与外链是纯图标按钮，无字可折，不进阶梯。
 */

// 本文件由同名 .js 转写为 TypeScript（#1253「界面视图层整批转 TypeScript」）：只加类型标注与中文注释，
//   逻辑、分支条件、字符串、数字、对象键与次序、函数名与导出名一字未改，行为零变化。
// 两条不能再改的约定：①模块说明符仍写 .js（scripts/ts-hook.mts 会把 .js 改指同目录同名 .ts）；
//   ②写法限「可剥离的 TypeScript」——不用 enum、不用构造函数参数属性，因为测试链路上 Node 只删类型、不做语法转换。
// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
//   把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
//   不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare function Ic(...args: any[]): any;
declare function completePrompt(...args: any[]): any;
declare function copyText(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function inspectPrompt(...args: any[]): any;
declare function openInNewSession(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function startText(...args: any[]): any;
declare function useIssueDetailFold(...args: any[]): any;
declare const Tip: any;
declare const issueUrlFor: any;
declare function isLightHex(...args: any[]): any;
// #1286：容器三态与角标的真源在 kernel/container-view.ts（列表页同一份）
declare function containerStateOf(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function containerPromptText(...args: any[]): any;
declare const CONTAINER_CHIP_CLASS: any;
declare const CONTAINER_CHIP_LABEL_KEY: any;
declare const CONTAINER_ACCENT: any;
// #1343：容器三态的两枚固定色也从中央色表取（同 kernel/container-view.ts），这里只声明形状。
declare const CONTAINER_DONE_COLOR: any;
declare const CONTAINER_EMPTY_COLOR: any;

export const MapDetailTop = ({ st, m, navCrumb, effStats, goBack, kind, tri: triProp }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mEffort = (function () { try { return effortOf(m) } catch (e) { return '' } })()
  // #763 顶栏折叠机（与 IssueDetail.ts 同一台；读顶栏 DOM 上的 data-detail-* 标记逐字收字）
  const topBarRef = useIssueDetailFold(st, m.number, mEffort)
  // #1286：这顶栏服务两类容器（探索地图 / 规格）。三态配置（底色/文字/图标）由调用方按同一份
  //   container-view.ts 的判定算好传进来；没传（本文件被单独求值时）就地按同口径算一遍。
  const cKind = kind || 'map'
  const cState = (typeof containerStateOf === 'function')
    ? containerStateOf({ stats: effStats })
    : (effStats && effStats.total === 0 ? 'empty' : (effStats && effStats.total > 0 && effStats.closed === effStats.total ? 'done' : 'open'))
  // #1343：两枚固定色只从中央色表取，真源不在时退回空串，不再抄一份同值兜底。
  const triEmptyColor = function () {
    return (typeof CONTAINER_EMPTY_COLOR === 'string' && CONTAINER_EMPTY_COLOR) ? CONTAINER_EMPTY_COLOR : ''
  }
  const triDoneColor = function () {
    return (typeof CONTAINER_DONE_COLOR === 'string' && CONTAINER_DONE_COLOR) ? CONTAINER_DONE_COLOR : ''
  }
  const tri = triProp || (typeof containerTriState === 'function'
    ? containerTriState(cKind, cState)
    : (cState === 'empty' ? { labelKey: 'act.inspect', color: triEmptyColor(), icon: 'search', titleKey: 'map.inspectTitle' }
      : (cState === 'done' ? { labelKey: 'act.done', color: triDoneColor(), icon: 'check', titleKey: 'map.doneTitle' }
        : { labelKey: 'act.execute', color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', icon: 'play', titleKey: 'map.executeTitle' })))
  // 字色：完成态沿用今天的深绿字（#0c1a10），其余按底色深浅在深墨与白字之间择优。
  const triTextColor = cState === 'done' ? '#0c1a10' : ((typeof isLightHex === 'function' && isLightHex(tri.color)) ? '#140a1e' : '#ffffff')
  // 新会话与主按钮永远同色实心：两处取同一份 tri.color，不再靠 CSS 默认值碰巧相同。
  const newStyle: any = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', borderColor: 'transparent', background: tri.color, color: triTextColor, fontWeight: 600 }
  // 顶栏角标说明这一页是哪种容器：探索地图「地图」，规格「规格」。词表键与样式类取
  //   container-view.ts 那一份（列表页角标用的是同一份），别处不再各写一份。
  const chipClass = (typeof CONTAINER_CHIP_CLASS === 'object' && CONTAINER_CHIP_CLASS && CONTAINER_CHIP_CLASS[cKind]) ? CONTAINER_CHIP_CLASS[cKind] : (cKind === 'spec' ? 'dsws-chip-s' : 'dsws-chip-m')
  const chipLabelKey = (typeof CONTAINER_CHIP_LABEL_KEY === 'object' && CONTAINER_CHIP_LABEL_KEY && CONTAINER_CHIP_LABEL_KEY[cKind]) ? CONTAINER_CHIP_LABEL_KEY[cKind] : (cKind === 'spec' ? 'list.specChip' : 'list.mapChip')
  const chipText = tr(chipLabelKey)
  const copyUrl = function (e: any) {
    if (e && e.stopPropagation) e.stopPropagation()
    try { copyText(st, issueUrlFor(st, m.number, mEffort), tr('toast.copiedLink', { n: m.number })) } catch (err) {}
  }
  const openUrl = (typeof issueUrlFor === 'function') ? (function () { try { return issueUrlFor(st, m.number, mEffort) } catch (err) { return '' } })() : ''
  const openIsHttp = /^https?:\/\//i.test(String(openUrl || ''))
  const openWeb = function (e: any) {
    if (e && e.stopPropagation) e.stopPropagation()
    const u = (typeof issueUrlFor === 'function') ? (function () { try { return issueUrlFor(st, m.number, mEffort) } catch (err2) { return '' } })() : ''
    if (!u) return
    if (/^https?:\/\//i.test(String(u))) { try { window.open(u, '_blank', 'noreferrer') } catch (err3) {} }
    else { try { if (typeof host !== 'undefined' && host.call) host.call('wf.openPath', { path: u }) } catch (err4) {} }
  }
  // 主动作：探索地图是 检查 / 执行 / 完成，规格是 拆票 / 执行 / 完成。文字、底色、图标与
  //   点下去注入的提示词都取同一份三态配置（container-view.ts），所以按钮上写什么与点下去注入什么
  //   永远对得上。
  const promptText = function (): string {
    if (typeof containerPromptText === 'function') {
      try {
        // 统计用 effStats（按需取回的那一份），让收尾提示词里的数字与头部计数行一致。
        return containerPromptText(st, Object.assign({}, m, { stats: effStats || m.stats }), cKind, cState, openUrl)
      } catch (e) { /* 落回老口径 */ }
    }
    if (cState === 'empty') {
      // 规格空态：还没有实施票，注入拆票技能调用（正式文案归 #1281）。这段兜底只在
      //   container-view.ts 不在时才会走到（例如门禁单独求值本文件），口径要与它保持一致。
      if (cKind === 'spec') return '/to-tickets ' + openUrl
      let t2 = ''
      try { t2 = inspectPrompt(st, m.number, m.title) } catch (e) {
        try {
          t2 = promptTextFor(st, 'mapInspect', { n: String(m.number || ''), ['title']: String(m.title || ''), url: openUrl })
          if (t2) t2 = '/wayfinder ' + openUrl + '\n\n' + t2
        } catch (_) { t2 = startText(st, m) }
      }
      return t2
    }
    if (cState === 'done') return completePrompt(st, m.number, m.title, (effStats ? effStats.total : 0), (effStats ? effStats.closed : 0))
    // 规格未完成：注入 /implement-spec 链接；通用「执行这张票」模板的正文首行是 /wayfinder，
    //   用在规格上不对（设计文档 §3.4）。探索地图的推进式提示词照旧。
    if (cKind === 'spec') return '/implement-spec ' + openUrl
    return startText(st, m)
  }
  const primaryBtn = h(Tip, { content: tr(tri.titleKey) }, h('button', { className: 'dsws-btn primary', 'data-press': 'button', 'data-log': 'map.top.exec', onClick: function () {
    inject(st, promptText())
  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: tri.color, borderColor: 'transparent', color: triTextColor, fontWeight: 600, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
    Ic({ n: tri.icon, size: 10 }),
    h('span', { 'data-detail-primary-text': 1, 'data-full': tr(tri.labelKey), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr(tri.labelKey)),
  ]))
  return h('div', { ref: topBarRef, className: 'dsws-stickybar', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
    // 返回按钮的悬停提示走 Tip（T2/T3 纪律），不再用原生 title
    h(Tip, { content: tr('list.back') }, h('button', { className: 'dsws-btn', 'data-press': 'button', 'data-log': 'map.top.back', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
      Ic({ n: 'back', size: 12 }),
      h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back')),
    ])),
    h(Tip, { content: navCrumb }, h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' } }, navCrumb)),
    h(Tip, { content: chipText }, h('span', { className: 'dsws-chip ' + chipClass, style: { flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [
      Ic({ n: 'map', size: 11 }),
      h('span', { 'data-detail-snapshot': 1, 'data-full': chipText, style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, chipText),
    ])),
    h('span', { style: { flex: 1, minWidth: 8 } }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', minWidth: 0, overflow: 'hidden', flexWrap: 'nowrap' } }, [
      primaryBtn,
      h(Tip, { content: tr('map.newSessionTitle') }, h('button', { className: 'dsws-btn primary', 'data-press': 'button', 'data-log': 'map.top.newsession', onClick: function (e: any) { e.stopPropagation(); openInNewSession(st, m) }, style: newStyle }, [
        Ic({ n: 'external-link', size: 10 }),
        h('span', { 'data-detail-new-text': 1, 'data-full': tr('list.newSessionLabel'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.newSessionLabel')),
      ])),
      h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', 'data-press': 'icon', 'data-log': 'map.top.copy', onClick: copyUrl, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 }))),
      openIsHttp
        ? h(Tip, { content: tr('tip.openInTracker', { n: m.number }) }, h('a', { className: 'dsws-btn ghost', href: openUrl, target: '_blank', rel: 'noreferrer', 'data-press': 'icon', 'data-log': 'map.top.link', onClick: function (e: any) { e.stopPropagation() }, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' }, 'aria-label': tr('tip.openInTracker', { n: m.number }) }, Ic({ n: 'link', size: 13 })))
        : h(Tip, { content: tr('tip.openInTracker', { n: m.number }) }, h('button', { className: 'dsws-btn ghost', onClick: openWeb, 'data-press': 'icon', 'data-log': 'map.top.link', style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' }, 'aria-label': tr('tip.openInTracker', { n: m.number }) }, Ic({ n: 'link', size: 13 }))),
    ]),
  ])
}
