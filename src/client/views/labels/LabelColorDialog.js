/**
 * views/labels/LabelColorDialog.js — 标签配色弹窗本体（#621 新增）
 *
 * 形态按 #617 的低保真原型（docs/prototype/617-label-colors-dialog.html）：全屏遮罩加居中卡片，
 * 顶部标题与关闭叉，下面一条提示带，再下面是标签清单（全部标签、不分组、一行一个），底部一个批量保存按钮。
 * 浮层沿用仓库现成的 .dsws-modal 与 .dsws-modalbox（与检查更新的弹窗同一套），点遮罩空白处可关。
 *
 * 打开就现取一次权威清单，所以正文有五种形态，互不混淆：
 *   加载中    —— 转圈加一句「正在读取标签清单…」；
 *   加载失败  —— 说清哪一档、后端原话是什么，给一个「重试」；
 *   这个后端不做这个操作（unsupported）—— 只给一条诚实的「暂时做不到」，不摆保存按钮，
 *               免得做成「看起来能用、点了才报错」；
 *   空态      —— 一个标签都没有时只给「先去建标签」那一句，底部**整条按钮区都不渲染**
 *               （原型里建议把保存按钮灰掉；这里直接不摆：空态没有可保存的对象，摆一个灰按钮反而多一个要解释的东西）；
 *   就绪      —— 有标签就一行一个列出来，底部按钮区出现。
 *
 * 保存是做法 B：不提前猜会话是不是只读，允许点保存；点了失败就把原因写清楚（尤其是插件自己的
 * 沙箱限制那一档，文案必须让人认出不是自己的文件夹权限问题）。保存后由状态机重新取一次真实清单，
 * 界面显示的颜色一律是后端刚返回的那份，不做乐观刷新。
 *
 * 窄面板（面板宽度小于 380 像素）：保存按钮的文字收成图标，鼠标停上去有文字提示（走仓库的 Tip，
 * 不用原生 title 属性）。这一条与原型一致；行内不再隐藏颜色值——原型隐藏的是只读的文字，
 * 而这里的颜色值是可以直接改的输入框，藏掉就没法在窄面板里配色了。
 */
export const LabelColorDialog = (props) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cwd = (props && props.cwd) || ''
  const sessionId = (props && props.sessionId) || ''
  const narrow = !!(props && props.narrow)
  const onClose = props && props.onClose
  const onSaved = props && props.onSaved
  const lc = useLabelColors(cwd, onSaved, sessionId)

  const closeOnBackdrop = function (e) { if (e && e.target === e.currentTarget && typeof onClose === 'function') onClose() }
  const unsupported = lc.phase === 'failed' && lc.loadError && lc.loadError.kind === 'unsupported'
  const loading = lc.phase === 'loading'
  const busy = lc.saving
  // 每一行用的那份文字（用户填的原文，或者这一行现在显示的颜色）——与下面渲染各行时取的是同一份。
  const textOfRow = function (r) { return Object.prototype.hasOwnProperty.call(lc.draft, r.name) ? lc.draft[r.name] : lcToDisplay(r.color) }
  // 只要有一行还没填完（写错字、或把原本有颜色的格子清空），就不让保存按钮亮：后端按解析档逐条拒，
  // 与其让用户点了再一条条看失败，不如当场说清楚。清空不算「清除颜色」这个动作（本图不做，要清得去配色文件里删那一行）。
  const anyIncomplete = lc.phase === 'ready' && lc.rows.some(function (r) { return lcRowIncomplete(r, textOfRow(r)) })
  const canSave = lc.phase === 'ready' && lc.rows.length > 0 && lc.changes.length > 0 && !anyIncomplete && !busy

  const head = h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flex: 'none' } }, [
    typeof Ic === 'function' ? Ic({ n: 'palette', size: 14 }) : null,
    h('span', { style: { fontSize: 13, fontWeight: 700 } }, tr('lc.title')),
    lc.changes.length ? h('span', { key: 'draft', style: { fontSize: 10.5, color: '#f59e0b', border: '1px solid rgba(245,158,11,.45)', borderRadius: 4, padding: '0 5px', lineHeight: 1.6 } }, tr('lc.draftHint')) : null,
    h('span', { key: 'sp', style: { flex: 1 } }),
    h(Tip, { key: 'close', content: tr('lc.close') }, h('button', { className: 'dsws-btn ghost', type: 'button', 'aria-label': tr('lc.close'), onClick: onClose, style: { padding: '2px 6px', fontSize: 11 } }, typeof Ic === 'function' ? Ic({ n: 'x', size: 12 }) : '✕')),
  ])

  // 顶部提示带：保存中 / 全部成功 / 部分成功 / 一个都没成，四种各一句，数目都用实际条数。
  let banner = null
  if (busy) banner = { color: '#8b8b95', text: tr('lc.saving') }
  else if (lc.outcome) {
    if (lc.outcome.appliedCount === 0) banner = { color: '#f87171', text: tr('lc.savedNone', { f: lc.outcome.failedCount }) }
    else if (lc.outcome.failedCount === 0) banner = { color: '#4ade80', text: tr('lc.savedAll', { a: lc.outcome.appliedCount }) }
    else banner = { color: '#f59e0b', text: tr('lc.savedSome', { a: lc.outcome.appliedCount, f: lc.outcome.failedCount }) }
  }
  const bannerNode = banner ? h('div', { key: 'banner', style: { flex: 'none', fontSize: 11.5, lineHeight: 1.6, color: banner.color, border: '1px solid ' + banner.color, borderRadius: 8, padding: '6px 9px', marginBottom: 8, wordBreak: 'break-word' } }, banner.text) : null

  let body = null
  if (loading) {
    body = h('div', { key: 'loading', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 2px', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12 } }, [
      h('span', { className: 'dsws-spinner', style: { width: 13, height: 13, borderWidth: 2, display: 'inline-block' } }),
      h('span', null, tr('lc.loading')),
    ])
  } else if (unsupported) {
    body = h('div', { key: 'unsupported', style: { padding: '10px 2px' } }, [
      h('div', { key: 'ttl', style: { fontSize: 12.5, fontWeight: 700, color: '#f59e0b', marginBottom: 4 } }, tr('lc.unsupportedTitle')),
      h('div', { key: 'msg', style: { fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr('lc.err.unsupported')),
    ])
  } else if (lc.phase === 'failed') {
    const err = lc.loadError || { kind: '', message: '' }
    body = h('div', { key: 'failed', style: { padding: '10px 2px' } }, [
      h('div', { key: 'ttl', style: { fontSize: 12.5, fontWeight: 700, color: '#f87171', marginBottom: 4 } }, tr('lc.loadFailTitle')),
      h('div', { key: 'kind', style: { fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr(lcKindKey(err.kind))),
      err.message ? h('div', { key: 'raw', style: { fontSize: 11, lineHeight: 1.6, marginTop: 4, color: '#8b8b95', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '5px 8px', wordBreak: 'break-word' } }, tr('lc.backendSaid', { msg: err.message })) : null,
      h('div', { key: 'acts', style: { marginTop: 10 } }, h('button', { className: 'dsws-btn', type: 'button', onClick: function () { lc.reload({ keepOutcome: true }) }, style: { fontSize: 12, padding: '4px 12px' } }, tr('lc.retry'))),
    ])
  } else if (!lc.rows.length) {
    body = h('div', { key: 'empty', style: { padding: '10px 2px' } }, [
      h('div', { key: 'ttl', style: { fontSize: 12.5, fontWeight: 700, marginBottom: 4 } }, tr('lc.emptyTitle')),
      h('div', { key: 'desc', style: { fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr('lc.emptyDesc')),
    ])
  } else {
    body = h('div', { key: 'rows' }, lc.rows.map(function (r) {
      return h(LabelColorRow, { key: r.name, row: r, text: textOfRow(r), narrow: narrow, result: lcOutcomeRowOf(lc.outcome, r.name), onChangeText: lc.setRowText })
    }))
  }

  const saveText = busy ? tr('lc.saving') : tr('lc.save')
  const saveBtn = h('button', {
    className: 'dsws-btn primary',
    type: 'button',
    disabled: !canSave,
    'aria-label': saveText,
    onClick: function () { lc.save() },
    style: { fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: canSave ? 'pointer' : 'not-allowed' },
  }, narrow ? (busy ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block' } }) : (typeof Ic === 'function' ? Ic({ n: 'check', size: 12 }) : saveText)) : saveText)

  const foot = lc.phase === 'ready' && lc.rows.length > 0 ? h('div', { key: 'foot', style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
    h('span', { key: 'hint', style: { flex: 1, minWidth: 0, fontSize: 11, color: anyIncomplete ? '#f87171' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, anyIncomplete ? tr('lc.hexFormat') : (lc.changes.length ? tr('lc.draftHint') : tr('lc.saveNone'))),
    narrow ? h(Tip, { key: 'tip', content: saveText }, saveBtn) : saveBtn,
  ]) : null

  return h('div', { className: 'dsws-modal', 'data-role': 'label-colors-dialog', onClick: closeOnBackdrop }, [
    h('div', { className: 'dsws-modalbox', 'data-role': 'label-colors-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('lc.title'), onClick: function (e) { e.stopPropagation() }, style: { width: 520, maxWidth: '94vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' } }, [
      head,
      bannerNode,
      h('div', { key: 'body', style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } }, body),
      foot,
    ]),
  ])
}
