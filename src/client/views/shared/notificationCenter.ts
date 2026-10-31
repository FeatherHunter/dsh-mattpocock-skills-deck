/**
 * views/shared/notificationCenter.ts — 面板内通知中心的两个组件（票 #1697）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts
 * 的 leaf:notificationCenter 标记处（源码树里只有这一份真源）。
 *
 * 两个组件：
 *   NotificationCenter —— 面板头部的入口：有未读才画一颗带数字的铃铛（没有未读整颗不画，不占窄面板的地方），
 *     点开把历史浮层挂到 document.body（portalTop），不占列表页高度。这一格挂在 panel/Dock.ts 头部那一排里，
 *     折叠阶梯（panel/headFold.ts 的 badge 步）在窄面板里先收它、再收时间与仓库名。
 *   NotificationHistoryPanel —— 历史浮层本身：当前状态一句话（只读快照）、按类型筛选、按时间从新到旧的列表、
 *     「全部已读」与「清除已读标记」。
 *
 * 三条不能改的约定：
 * 1) 浮层里「当前状态」那句话只从快照画（noticeCurrentDegradedOf），历史与当前对不上时补一句说明，
 *    打开/关闭历史不写快照、不写事件库 —— 通知中心只读历史。
 * 2) 未读与已读标记只走会话呈现态（model 里那把 sessionStorage 键），组件自己不另存一份。
 * 3) 文案一律 tr(词条)（config/copy/panel.yaml 的 notice.* 中英各一份），组件里不写死中文。
 */
declare const React: any
declare const DswsCtx: any
declare const portalTop: any
declare const Ic: any
declare const tr: any
declare function Tip(...args: any[]): any
declare const NOTICE_TYPES: any[]
declare function noticeRowsOf(...args: any[]): any
declare function noticeCurrentDegradedOf(...args: any[]): any
declare function noticeHistoryMismatchOf(...args: any[]): any
declare function noticeUnreadTextOf(...args: any[]): any
declare function noticeTypeKeyOf(...args: any[]): any
declare function noticeHeadBadgeOf(...args: any[]): any
declare function noticeToneColorOf(...args: any[]): any

/** 浮层最小宽度：面板再窄也读得下发时间与标题（与尾部注释「宽度怎么定」一条）。 */
const NOTICE_POPOVER_MIN_WIDTH = 320

/**
 * 历史浮层。props：{ st, view, onClose }。view 是 model 的 useNotifications 回包。
 * 打开时面板只画历史，不把当前状态写回任何地方；关掉就是收起。
 */
export const NotificationHistoryPanel = ({ st, view, onClose }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const [filter, setFilter] = React.useState('all')
  const now = Date.now()
  const events = (view && Array.isArray(view.events)) ? view.events : []
  const rows = noticeRowsOf(events, filter, view ? view.readIds : {}, now)
  const degraded = noticeCurrentDegradedOf(st)
  const mismatch = noticeHistoryMismatchOf(st, events)
  const unread = (view && Number(view.unread)) || 0
  const filters = [{ value: 'all', key: 'notice.filter.all' }].concat(NOTICE_TYPES.map(function (t: any) { return { value: t, key: noticeTypeKeyOf(t) } }))
  const actionBtn = function (label: any, log: any, onClick: any) {
    return h('button', { key: log, className: 'dsws-btn dsws-hov', 'data-press': 'button', 'data-log': log, type: 'button', onClick: onClick, style: { fontSize: 11, padding: '2px 8px' } }, label)
  }
  const head = h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px' } }, [
    h('span', { key: 'icon', style: { lineHeight: 0 } }, Ic({ n: 'bell', size: 13 })),
    h('span', { key: 'title', style: { fontSize: 12, fontWeight: 700, color: 'var(--dsw-alias-label-primary,#e6e6e6)' } }, tr('notice.title')),
    h('span', { key: 'gap', style: { flex: 1 } }),
    actionBtn(tr('notice.markAllRead'), 'notice.markallread', function () { if (view && typeof view.markAllRead === 'function') view.markAllRead() }),
    actionBtn(tr('notice.clearRead'), 'notice.clearread', function () { if (view && typeof view.clearRead === 'function') view.clearRead() }),
    h('button', { key: 'close', className: 'dsws-btn dsws-hov', 'data-press': 'icon', 'data-log': 'notice.close', 'data-notice-close': 1, type: 'button', 'aria-label': tr('notice.close'), onClick: function () { if (typeof onClose === 'function') onClose() }, style: { lineHeight: 0, padding: '2px 5px' } }, Ic({ n: 'x', size: 11 })),
  ])
  const current = h('div', { key: 'current', 'data-notice-current': degraded ? 'degraded' : 'normal', style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '0 2px 6px', color: degraded ? noticeToneColorOf('warn') : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
    h('span', { key: 'label' }, tr('notice.current') + '：'),
    h('span', { key: 'value' }, degraded ? tr('notice.currentDegraded') : tr('notice.currentNormal')),
    unread > 0 ? h('span', { key: 'unread', 'data-notice-unread-count': 1, style: { marginLeft: 'auto' } }, tr('notice.unreadCount', { n: unread })) : null,
  ])
  const mismatchRow = mismatch
    ? h('div', { key: 'mismatch', 'data-notice-mismatch': 1, style: { fontSize: 10, lineHeight: 1.5, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '0 2px 6px' } }, tr('notice.historyMismatch'))
    : null
  const filterRow = h('div', { key: 'filters', style: { display: 'flex', gap: 4, flexWrap: 'wrap', padding: '0 2px 6px' } }, filters.map(function (f: any) {
    const on = filter === f.value
    return h('button', { key: f.value, className: 'dsws-btn dsws-hov' + (on ? ' primary' : ''), 'data-press': 'chip', 'data-log': 'notice.filter', 'data-notice-filter': f.value, 'data-notice-filter-on': on ? '1' : '0', type: 'button', onClick: function () { setFilter(f.value) }, style: { fontSize: 10, padding: '1px 7px' } }, tr(f.key))
  }))
  const body = rows.length === 0
    ? h('div', { key: 'empty', 'data-notice-empty': 1, style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, padding: '10px 2px' } }, tr('notice.empty'))
    : h('div', { key: 'list', 'data-notice-list': 1, style: { display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 280, overflowY: 'auto' } }, rows.map(function (row: any) {
        return h('div', { key: row.id, 'data-notice-row': 1, 'data-notice-id': row.id, 'data-notice-type': row.type, 'data-notice-read': row.read ? '1' : '0', className: 'dsws-hov', 'data-press': 'row', 'data-log': 'notice.row', style: { display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 6px', borderRadius: 6 } }, [
          h('span', { key: 'dot', 'data-notice-dot': 1, style: { width: 6, height: 6, borderRadius: '50%', background: row.color, marginTop: 5, flex: 'none' } }),
          h('div', { key: 'text', style: { flex: 1, minWidth: 0 } }, [
            h('div', { key: 'line', style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, [
              h('span', { key: 'title', style: { fontSize: 11, fontWeight: row.read ? 400 : 700 } }, row.title),
              h('span', { key: 'time', style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', whiteSpace: 'nowrap' } }, row.time),
              row.count > 1 ? h('span', { key: 'times', 'data-notice-times': 1, style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('notice.times', { n: row.count })) : null,
            ]),
            row.detail ? h('div', { key: 'detail', style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, wordBreak: 'break-word' } }, row.detail) : null,
          ]),
          row.read ? null : h('span', { key: 'unread', 'data-notice-unread-row': 1, style: { fontSize: 9, color: '#58a6ff', border: '1px solid rgba(88,166,255,.4)', borderRadius: 5, padding: '0 4px', marginTop: 2, whiteSpace: 'nowrap' } }, tr('notice.read')),
        ])
      }))
  return h('div', { 'data-notification-center': 1, 'data-notice-panel': 1, 'aria-label': tr('notice.title'), style: { padding: '6px 8px' } }, [head, current, mismatchRow, filterRow, body])
}

/**
 * 头部入口：一颗带未读数字的铃铛 + 点开的历史浮层。
 * props：{ st, view, folded }。folded 为真时这整格先收走（折叠阶梯的 badge 步），浮层跟着一起不画。
 * 位置怎么定：不量入口那一格的坐标，浮层交给 kernel/portal 挂到 body 上、由 CSS 贴着头部右缘摆；
 * 宽 min(NOTICE_POPOVER_MIN_WIDTH, 视口宽减两侧留白)，高不超过视口，这样 300 至 520 像素的窄面板也不会越界。
 */
export const NotificationCenter = ({ st, view, folded }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const [open, setOpen]: any = React.useState(false)
  const entryRef: any = React.useRef(null)
  const popRef: any = React.useRef(null)
  const close = function () { setOpen(false) }
  const readable = !!(view && view.readable)
  const unread = (view && Number(view.unread)) || 0
  const toggle = function (e: any) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
    if (open) { close(); return }
    if (view && typeof view.refresh === 'function') { try { view.refresh() } catch (eR) {} }
    setOpen(true)
  }
  React.useEffect(function () {
    if (!open) return undefined
    const onDown = function (e: any) {
      const t = e && e.target
      if (t && entryRef.current && typeof entryRef.current.contains === 'function' && entryRef.current.contains(t)) return
      if (t && popRef.current && typeof popRef.current.contains === 'function' && popRef.current.contains(t)) return
      close()
    }
    const onKey = function (e: any) { if (e && e.key === 'Escape') close() }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }
    return function () {
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }
  }, [open])
  if (!readable || (!unread && !open)) return null
  const countText = noticeUnreadTextOf(view)
  const label = countText ? tr('notice.unreadCount', { n: countText }) : tr('notice.entryLabel')
  const entry = h('button', { ref: entryRef, 'data-notice-entry': 1, className: 'dsws-btn dsws-hov', 'data-press': 'icon', 'data-log': 'notice.entry', type: 'button', 'aria-label': label, 'aria-expanded': open ? 'true' : 'false', onClick: toggle, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 5px', lineHeight: 0 } }, [
    h('span', { key: 'icon', style: { lineHeight: 0 } }, Ic({ n: 'bell', size: 12 })),
    countText ? h('span', { key: 'count', 'data-notice-unread': 1, style: { fontSize: 10, fontWeight: 700, color: noticeToneColorOf('warn'), lineHeight: '12px' } }, countText) : null,
  ])
  const pop = open ? portalTop(h('div', {
    ref: popRef,
    'data-notification-center': 1,
    'data-notice-popover': 1,
    style: {
      position: 'fixed',
      top: 44,
      right: 12,
      width: 'min(' + NOTICE_POPOVER_MIN_WIDTH + 'px, calc(100vw - 24px))',
      maxHeight: 'calc(100vh - 56px)',
      overflowY: 'auto',
      zIndex: 2147483000,
      background: 'var(--dsw-alias-bg-layer-2,#16181d)',
      border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)',
      borderRadius: 10,
      boxShadow: '0 10px 30px rgba(0,0,0,.45)',
    },
  }, [h(NotificationHistoryPanel, { key: 'panel', st: st, view: view, onClose: close })])) : null
  return h('span', { 'data-head-fold': 'badge', 'data-notice-badge': 1, className: folded ? 'dsws-folded' : undefined, style: { lineHeight: 0 } }, [h(Tip, { key: 'tip', content: tr('notice.entryTip') }, entry), pop])
}
