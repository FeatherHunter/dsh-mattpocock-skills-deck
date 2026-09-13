/**
 * views/labels/LabelColorDialog.js — 标签配色弹窗本体（#621 新增）
 *
 * 形态按 #617 的低保真原型（docs/prototype/617-label-colors-dialog.html）：全屏遮罩加居中卡片，
 * 顶部标题与关闭叉，下面一条提示带，再下面是标签清单（全部标签、不分组、一行一个），底部一个批量保存按钮。
 * 浮层沿用仓库现成的 .dsws-modal 与 .dsws-modalbox（与检查更新的弹窗同一套），点遮罩空白处可关。
 *
 * 打开就现取一次权威清单，所以正文有五种形态，互不混淆：
 *   加载中    —— 转圈加一句「正在读取标签清单…」；
 *   加载失败  —— 说清哪一档、后端返回的说明是什么，给一个「重试」；
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
 *
 * 底部按钮区（#622）：左边「复制推荐配色 prompt」、右边「保存」，与 #617 原型定的位置关系一致；
 * 窄面板下两颗按钮都收成图标（各带一条悬停提示，复制那条始终挂着，顺带说明「只写剪贴板、不往会话里发东西」）。
 * 复制按钮点下去**只写剪贴板**：该拼哪一套文案、这一次到底能不能拼、写没写成，全由纯函数层判断
 * （见 labelColorErrors.js 的 lcCopyAttemptOf / lcCopyFeedbackOf），界面只渲染，不自己猜。
 * 三种结果各有各的话：写成了显示「已复制」并自己消失；**没写成如实说「复制失败，请手动选中复制」，
 * 并把这段文字摊在一个只读框里**（「手动选中」得有东西可选，否则那句话就是空话——#617 的已知缺陷是
 * 写不进去也显示「已复制」，这里按真实结果说话）；后端那一档没读到开仓方式时不拼也不写剪贴板，如实说明。
 *
 * 底部按钮区（#630）：最左「退出」、中间「复制推荐配色 prompt」、最右「保存」。三颗按钮的宽度都不随
 * 状态变——保存那颗在「保存 / 保存中… / 不可用」三态之间宽度完全一样（做法见下面 saveFace：两种文字
 * 叠在同一个网格格里，切换状态只切可见性不换内容），所以点了保存以后整条按钮区不会往左挪。
 * 「退出」那颗的文字固定不变：有未保存的改动时，第一次点只在按钮区上方摆一句「再点一次就关掉」的提示，
 * 并把按钮自己改成琥珀色，第二次点才真的关——按钮文字不动，宽度自然也不动。
 * 「复制推荐配色 prompt」的结果本来就摆在按钮区上方那一行（不写进按钮里），它的文字也不随状态变。
 *
 * 关闭的三条路（#632）：底部「退出」、右上角的 ×、点弹窗外的空白处。三条共用同一份确认状态与同一条提示
 * 词条（lc.closeUnsaved，见下面 closeArmed / askClose）：有未保存的改动时，第一次点三条里的哪一条都只把
 * 确认摆出来（「退出」与 × 一起变琥珀色，按钮区上方出一句提示），第二次点哪一条都真关；没有未保存的改动
 * 时三条都一点就关。所以提示词条写成「三处点哪一处都算」，它在这三条路上的说法完全一样。
 *
 * 加载失败那一段（#631）：档位那一句（词条 lc.err.*）只管说这一档是什么意思，**不替后端猜这一次的成因**，
 * 「为什么、下一步怎么做」交给下面那个「后端返回的说明」框；对「这一步没定下用哪个后端」这一档另外补一句
 * 明写去哪儿选后端（lc.errWherePick）与一个一次点击的入口（关掉弹窗并把注意力引到面板头部那颗
 * 「切换后端」按钮上，见 onGoPick）。为什么只在这一档补：这两条电话里这一档只有这一个来源（见下面 needPick 处）。
 *
 * 这一档还要分待定与非待定（#631 的 D1 补修）：面板还在识别这个工作区用哪个后端时（selection.pending，
 * 读数见下面的 lcPanelPendingOf），面板头部那颗「切换后端」按钮自己就是**禁用的**，把用户支使过去点它
 * 就是又一次无效动作。所以待定时两样都不摆——那颗入口按钮和「去哪儿选」那一句一起收起，改摆一句诚实的
 * 话（词条 lc.errWaitBackend，说的就是后端返回的说明那一件事：等识别出结果再重试）。
 */

/**
 * 面板此刻是不是「有后端的身份识别还没出结果」（#631 的 D1 补修加的读数）。
 *
 * 取法与面板头部那颗「切换后端」按钮同一句话：`store.selection || store.snapshot.selection` 的 pending，
 * 而且是同一个 store 对象（那个按钮在 panel/Dock.js，它也正是按这个字段把自己置灰的）。
 * 读不到 → false：**不编一个待定出来**，界面照「不是待定」办（也就是照旧摆那颗入口按钮，与这次补修之前
 * 的行为一样）。
 *
 * 为什么它住在这个文件里，而不在 labelColorErrors.js（读「选了哪个后端」的 lcPanelBackendOf 住在那里）：
 * 只有这个弹窗用得到它，而那一层已经贴着 350 行的文件门禁上限（349/350），加不进去了。
 */
export const lcPanelPendingOf = function (store) {
  try {
    const st = store || null
    const sel = (st && st.selection) || (st && st.snapshot && st.snapshot.selection) || null
    return !!(sel && sel.pending)
  } catch (e) { return false }
}

export const LabelColorDialog = (props) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cwd = (props && props.cwd) || ''
  const sessionId = (props && props.sessionId) || ''
  const narrow = !!(props && props.narrow)
  const onClose = props && props.onClose
  const onSaved = props && props.onSaved
  const lc = useLabelColors(cwd, onSaved, sessionId)
  // 复制这一侧的三种结果（都由纯函数层决定，界面只负责渲染，见 labelColorErrors.js 的 lcCopyAttemptOf / lcCopyFeedbackOf）：
  //   kind ''（还没点过 / 成功那句已自己消失）、'ok'、'fail'、'blocked'；key 是要显示的那句词条，text 只在失败时用（摊给用户手动选）。
  const [copyState, setCopyState] = React.useState({ kind: '', key: '', text: '' })
  // 关闭确认的状态（#632）：三条关闭路径共用这一份。有未保存的改动时，第一次触发只把它置真
  // （摆提示、两处关闭控件变琥珀色），第二次触发才真关。
  const [closeArmed, setCloseArmed] = React.useState(false)
  // 草稿一动（或者改动已经没有了），上次的确认就作废：不能让「刚才点过一次」一直挂在身上，
  // 否则用户改完新东西再点一下，连新改动一起丢掉。setCloseArmed(false) 在本来就是假的时候不触发重渲染。
  React.useEffect(function () { setCloseArmed(false) }, [lc.draft, lc.changes.length])
  const closeArmedNow = closeArmed && lc.changes.length > 0

  // 三条关闭路径都走这一个函数：底部「退出」、右上角的 ×、点弹窗外的空白处。
  // 三处各写一份判据迟早漏掉一处，那正是 #632 要修的毛病——另外两条路原样把没保存的改动丢掉了。
  // 这里的判据只有「有没有未保存的改动」这一条，不看是不是正在保存，与 #630 那颗按钮原来的行为逐字一致：
  // 保存中点关也照这一条走，不新增任何与保存抢时序的分支。
  const askClose = function () {
    if (lc.changes.length && !closeArmed) { setCloseArmed(true); return }
    if (typeof onClose === 'function') onClose()
  }
  // 点弹窗外的空白处：点卡片里面不算（卡片自己会拦住冒泡）。这一条同样走 askClose，有未保存改动时也要两次。
  const onBackdrop = function (e) { if (e && e.target === e.currentTarget) askClose() }
  // 点「关掉弹窗，去面板头部选定后端」（#631 三、）：只做两件事——把这个弹窗关掉，然后把注意力引到面板头部
  // 那颗「切换后端」按钮上（就是面板自己的那颗，它带着 data-repo-switch 标记）。
  // 不做第三件事：不替用户选后端、不调任何宿主接口、也不假装已经选好了。
  // 那颗按钮此刻不在（这个工作区还没绑后端时，面板头部就不摆它）就只是关掉弹窗，不再多做一个动作——
  // 硬要「引过去」一个不存在的东西，等于骗用户。
  const onGoPick = function () {
    if (typeof onClose === 'function') onClose()
    try {
      const el = (typeof document !== 'undefined' && document && typeof document.querySelector === 'function')
        ? document.querySelector('[data-repo-switch]')
        : null
      if (el && typeof el.focus === 'function') el.focus()
    } catch (e) { /* 聚焦不成不影响「弹窗已经关了」这件事 */ }
  }
  const unsupported = lc.phase === 'failed' && lc.loadError && lc.loadError.kind === 'unsupported'
  const loading = lc.phase === 'loading'
  // 面板此刻是不是「还在识别这个工作区用哪个后端」（#631 的 D1 补修，读数见文件头的 lcPanelPendingOf）。
  // 这一档下不能摆「去选定后端」那颗入口按钮：面板头部那颗「切换后端」按钮此刻是禁用的，点了没反应。
  const panelPending = lcPanelPendingOf((typeof storeOf === 'function') ? storeOf(sessionId) : null)
  const busy = lc.saving
  // 每一行用的那份文字（用户填的原文，或者这一行现在显示的颜色）——与下面渲染各行时取的是同一份。
  const textOfRow = function (r) { return Object.prototype.hasOwnProperty.call(lc.draft, r.name) ? lc.draft[r.name] : lcToDisplay(r.color) }
  // 只要有一行还没填完（写错字、或把原本有颜色的格子清空），就不让保存按钮亮：后端按解析档逐条拒，
  // 与其让用户点了再一条条看失败，不如当场说清楚。清空不算「清除颜色」这个动作（本图不做，要清得去配色文件里删那一行）。
  const anyIncomplete = lc.phase === 'ready' && lc.rows.some(function (r) { return lcRowIncomplete(r, textOfRow(r)) })
  const canSave = lc.phase === 'ready' && lc.rows.length > 0 && lc.changes.length > 0 && !anyIncomplete && !busy

  // 点底部「退出」（#630 加、#632 起与另外两条路共用 askClose）：有未保存改动时不许一点就丢，
  // 第一次点只把提示摆出来，第二次点才真的关；没有改动时一点就关——那时候没什么可丢的。
  // 判据与提示都在上面 askClose / closeNote 那一处，这一颗自己不再写一份。

  // 点「复制推荐配色 prompt」：先问纯函数层这一次到底能不能拼（后端声明了开仓方式才拼），
  // 拼出来再写剪贴板，最后按**真实结果**说话（写不进去就是写不进去，绝不显示「已复制」）。
  // 这一段只走剪贴板：不注入会话、不调任何宿主接口、也不碰标签数据与保存。
  const onCopy = function () {
    const attempt = lcCopyAttemptOf({
      store: (typeof storeOf === 'function') ? storeOf(sessionId) : null,
      cwd: cwd,
      backendId: lc.backendId,
      rows: lc.rows,
      textOf: textOfRow,
      t: tr,
    })
    if (!attempt.write) { setCopyState({ kind: attempt.kind, key: attempt.key, text: '' }); return }
    return lcWriteClipboard(attempt.text).then(function (written) {
      const fb = lcCopyFeedbackOf(written, attempt.text)
      setCopyState({ kind: fb.kind, key: fb.key, text: fb.text })
      if (fb.kind !== 'ok') return
      try {
        if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') {
          timer.timeout(function () {
            setCopyState(function (prev) { return prev.kind === 'ok' ? { kind: '', key: '', text: '' } : prev })
          }, 2600)
        }
      } catch (e) { /* 自动收起这一步失败不影响已经显示出来的「已复制」 */ }
    })
  }

  // 右上角那颗 ×（#632 起也进确认里）：样子与原来完全一样，只是在确认摆出来以后变琥珀色——与底部「退出」
  // 同一套颜色与同一个状态，眼睛停在两处里哪一处都知道再点一下就关。
  const closeXStyle = { padding: '2px 6px', fontSize: 11 }
  if (closeArmedNow) { closeXStyle.borderColor = '#f59e0b'; closeXStyle.color = '#f59e0b' }

  const head = h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flex: 'none' } }, [
    typeof Ic === 'function' ? Ic({ n: 'palette', size: 14 }) : null,
    h('span', { style: { fontSize: 13, fontWeight: 700 } }, tr('lc.title')),
    lc.changes.length ? h('span', { key: 'draft', style: { fontSize: 10.5, color: '#f59e0b', border: '1px solid rgba(245,158,11,.45)', borderRadius: 4, padding: '0 5px', lineHeight: 1.6 } }, tr('lc.draftHint')) : null,
    h('span', { key: 'sp', style: { flex: 1 } }),
    h(Tip, { key: 'close', content: tr('lc.close') }, h('button', { className: 'dsws-btn ghost', type: 'button', 'data-lc-close-x': 1, 'aria-label': tr('lc.close'), onClick: askClose, style: closeXStyle }, typeof Ic === 'function' ? Ic({ n: 'x', size: 12 }) : '✕')),
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
    // 「这一步没定下用哪个后端」这一档（#631 三、）：后端返回的说明会让用户先去面板里选定这个工作区的后端，
    //   而用户在这个弹窗里没有任何能去的地方——死胡同。所以这一档补两样：一句写明去哪儿选（面板头部那颗
    //   「切换后端」按钮），和一个一次点击的入口。
    //   为什么只在这一档摆：这个弹窗这两条电话里，conflict 只有「还没定下用哪个后端」这一个来源——
    //   列表与改色那两种后端都不产生 conflict（见 src/host/workspaceCwd.js 的 pickBackend 与
    //   backends/*/label-colors-ops.js 各一处）。所以这不是替后端猜原因，说的就是这一档本身的意思。
    //   这一档里还要看面板在不在「待定」上（#631 的 D1 补修）：待定时面板头部那颗按钮是禁用的，所以入口按钮
    //   与「去哪儿选」那一句都不摆（把用户支使去点一个点不动的按钮，就是又一次无效动作），改摆一句诚实的
    //   话——「正在识别，等它出结果再点重试」，与后端返回的说明是同一个意思。
    const conflict = err.kind === 'conflict'
    const waitingBackend = conflict && panelPending
    const needPick = conflict && !panelPending
    body = h('div', { key: 'failed', style: { padding: '10px 2px' } }, [
      h('div', { key: 'ttl', style: { fontSize: 12.5, fontWeight: 700, color: '#f87171', marginBottom: 4 } }, tr('lc.loadFailTitle')),
      h('div', { key: 'kind', style: { fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr(lcKindKey(err.kind))),
      err.message ? h('div', { key: 'raw', style: { fontSize: 11, lineHeight: 1.6, marginTop: 4, color: '#8b8b95', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '5px 8px', wordBreak: 'break-word' } }, tr('lc.backendSaid', { msg: err.message })) : null,
      needPick ? h('div', { key: 'where', 'data-lc-where': 1, style: { fontSize: 11.5, lineHeight: 1.7, marginTop: 8, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr('lc.errWherePick')) : null,
      waitingBackend ? h('div', { key: 'waiting', 'data-lc-wait': 1, style: { fontSize: 11.5, lineHeight: 1.7, marginTop: 8, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr('lc.errWaitBackend')) : null,
      h('div', { key: 'acts', style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('button', { key: 'retry', className: 'dsws-btn', type: 'button', onClick: function () { lc.reload({ keepOutcome: true }) }, style: { fontSize: 12, padding: '4px 12px' } }, tr('lc.retry')),
        needPick ? h('button', { key: 'gopick', className: 'dsws-btn', type: 'button', 'data-lc-gopick': 1, onClick: onGoPick, style: { fontSize: 12, padding: '4px 12px' } }, tr('lc.actGoPick')) : null,
      ]),
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

  // 「保存 / 保存中…」两种文字叠在同一个网格格里（gridArea 都是 1/1），切状态只切可见性、不换内容：
  // 按钮的宽度因此永远等于这两种文字里更宽的那一份（中文是「保存中…」，英文是 Saving…），
  // 「保存 → 保存中…」时按钮不宽一分，整条底部按钮区不会往左挪。不写死像素宽，换语言换字体都不会露馅。
  // 两段文字都带 aria-hidden：按钮的无障碍名由下面那个 aria-label 给（就是当前那份文字）。
  const saveText = busy ? tr('lc.saving') : tr('lc.save')
  const saveFace = h('span', { key: 'face', style: { display: 'grid', alignItems: 'center', justifyItems: 'center' } }, [
    h('span', { key: 'idle', 'aria-hidden': 'true', style: { gridArea: '1 / 1', visibility: busy ? 'hidden' : 'visible' } }, tr('lc.save')),
    h('span', { key: 'busy', 'aria-hidden': 'true', style: { gridArea: '1 / 1', visibility: busy ? 'visible' : 'hidden' } }, tr('lc.saving')),
  ])
  // 窄面板下按钮只剩一个图标：转圈和勾都是 12 像素见方，那一条本来就等宽（宽度与文字无关）。
  const saveBtn = h('button', {
    key: 'save',
    className: 'dsws-btn primary',
    type: 'button',
    disabled: !canSave,
    'aria-label': saveText,
    onClick: function () { lc.save() },
    style: { fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 'none', cursor: canSave ? 'pointer' : 'not-allowed' },
  }, narrow ? (busy ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block' } }) : (typeof Ic === 'function' ? Ic({ n: 'check', size: 12 }) : saveText)) : saveFace)

  // 底部「退出」按钮：文字固定不变（有未保存改动时也不换成别的字，只变颜色并另起一行摆提示），
  // 所以它的宽度天生不随状态变。位置在按钮区最左、复制按钮左边——三颗按钮挨在一起，都在保存附近。
  const exitLabel = tr('lc.exit')
  const exitStyle = { fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', cursor: 'pointer' }
  if (closeArmedNow) { exitStyle.borderColor = '#f59e0b'; exitStyle.color = '#f59e0b' }
  const exitBtn = h('button', {
    key: 'exit',
    className: 'dsws-btn',
    type: 'button',
    'data-lc-exit': 1,
    'aria-label': exitLabel,
    onClick: askClose,
    style: exitStyle,
  }, exitLabel)

  // 「复制推荐配色 prompt」按钮：与保存按钮同一套尺寸，位置在保存左边（#617 原型定的关系）。
  // 悬停提示与宽窄无关，始终挂着 lc.copyTip（它顺带说明「只写剪贴板、不往会话里发东西」这条口径）；
  // 窄面板下按钮只剩图标，这条提示更要点得出来。
  const copyLabel = tr('lc.copy')
  const copyBtn = h('button', {
    className: 'dsws-btn',
    type: 'button',
    'data-lc-copy': 1,
    'aria-label': copyLabel,
    onClick: onCopy,
    style: { fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', cursor: 'pointer' },
  }, narrow ? (typeof Ic === 'function' ? Ic({ n: 'clipboard', size: 12 }) : copyLabel) : copyLabel)
  const copyBtnWrapped = h(Tip, { key: 'tipcopy', content: tr('lc.copyTip') }, copyBtn)

  // 复制结果的提示带（在按钮区正上方，窄面板下也放得下）：
  //   成功 —— 一句绿的「已复制」，几秒后自己消失；
  //   失败 —— 如实说「复制失败，请手动选中复制」，并把那段文字摊在一个只读框里（点一下全选），
  //           「手动选中」这句话才有东西可选；这一条不自动消失，用户什么时候选完什么时候算；
  //   这次不拼 —— 后端那一档没读到（快照里没有这个后端模块，或它没声明开仓动作），如实说清是哪一种。
  let copyNote = null
  if (copyState.kind === 'ok') {
    copyNote = h('div', { key: 'copyok', style: { flex: 'none', fontSize: 11, color: '#4ade80', marginTop: 8 } }, tr(copyState.key || 'lc.copied'))
  } else if (copyState.kind === 'fail') {
    copyNote = h('div', { key: 'copyfail', style: { flex: 'none', marginTop: 8 } }, [
      h('div', { key: 'msg', style: { fontSize: 11, lineHeight: 1.6, color: '#f87171' } }, tr(copyState.key || 'lc.copyFailed')),
      h('textarea', {
        key: 'text',
        readOnly: true,
        value: copyState.text,
        spellCheck: false,
        rows: 6,
        'aria-label': tr(copyState.key || 'lc.copyFailed'),
        onFocus: function (e) { try { if (e && e.target && e.target.select) e.target.select() } catch (e1) { /* 选不中也不影响用户自己拖选 */ } },
        style: { width: '100%', boxSizing: 'border-box', marginTop: 5, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, fontFamily: 'Consolas,Menlo,monospace', resize: 'vertical', colorScheme: 'light dark' },
      }),
    ])
  } else if (copyState.kind === 'blocked') {
    copyNote = h('div', { key: 'copyblocked', style: { flex: 'none', fontSize: 11, lineHeight: 1.6, color: '#f59e0b', marginTop: 8 } }, tr(copyState.key || 'lc.copyNoBackend'))
  }

  // 关闭确认的提示（#630 加、#632 起三条路共用这一句）：第一次触发时摆在按钮区正上方那一行——
  // 与复制结果提示同一个位置、同一种做法。摆在按钮外面而不是塞进按钮里，是为了让「退出」的文字
  // （也就它的宽度）固定不变；「退出」与右上角的 ×同时变琥珀色，眼睛停在哪一处都知道要再点一次。
  // 这一句不点名某一颗按钮，因为三条路共用它：词条 lc.closeUnsaved 写清「三处点哪一处都算」。
  const closeNote = closeArmedNow
    ? h('div', { key: 'closewarn', 'data-lc-close-warn': 1, style: { flex: 'none', fontSize: 11, lineHeight: 1.6, color: '#f59e0b', marginTop: 8 } }, tr('lc.closeUnsaved'))
    : null

  // 底部按钮区：左边一句状态说明（占满剩余宽度），右边三颗按钮，顺序是「退出 · 复制推荐配色 prompt · 保存」。
  // 三颗按钮都是 flex:none 且文字不随状态变，所以它们的位置只由对话框宽度决定，不随保存/复制/确认状态挪动。
  const foot = lc.phase === 'ready' && lc.rows.length > 0 ? h('div', { key: 'foot', style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
    h('span', { key: 'hint', style: { flex: 1, minWidth: 0, fontSize: 11, color: anyIncomplete ? '#f87171' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, anyIncomplete ? tr('lc.hexFormat') : (lc.changes.length ? tr('lc.draftHint') : tr('lc.saveNone'))),
    exitBtn,
    copyBtnWrapped,
    narrow ? h(Tip, { key: 'tipsave', content: saveText }, saveBtn) : saveBtn,
  ]) : null

  return h('div', { className: 'dsws-modal', 'data-role': 'label-colors-dialog', onClick: onBackdrop }, [
    h('div', { className: 'dsws-modalbox', 'data-role': 'label-colors-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('lc.title'), onClick: function (e) { e.stopPropagation() }, style: { width: 520, maxWidth: '94vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' } }, [
      head,
      bannerNode,
      h('div', { key: 'body', style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } }, body),
      copyNote,
      closeNote,
      foot,
    ]),
  ])
}
