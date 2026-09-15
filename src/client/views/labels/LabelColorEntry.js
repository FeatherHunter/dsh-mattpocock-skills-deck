/**
 * views/labels/LabelColorEntry.js — 面板头部右侧的标签配色入口（#621 新增）
 *
 * 一个 16×16 的小图标按钮，规格与仓库名右侧那颗「切换后端」的按钮一致（同样 16 像素见方、
 * 圆角 4、只描边不填底），放在它旁边；点击打开改色弹窗。悬停提示走仓库的 Tip（不用原生 title 属性）。
 *
 * 为什么放在头部：头部常驻可见，用户不用先滚到列表某处去找改颜色的地方。头部那套自适应折叠逻辑
 * （空间不够时先藏标题、再缩仓库名）不碰这颗按钮——它是定宽且不参与裁切的，窄面板下不会消失。
 *
 * 弹窗只在打开时才挂载，所以「打开就现取一次标签清单」发生在用户真正点开的那一刻，
 * 不用在面板启动时白跑一次电话。
 *
 * 图标颜色（#637）：这只调色盘整只上色——盘身暖木色，四颗颜料点取四个 wayfinder 标签的
 * 真实颜色，算法在纯函数层（labelColorPalette.js 的 lcEntryPaletteOf），这颗按钮只负责
 * 「挂载时取一次清单、取回来之前与取失败时都显示默认色」。取数走的还是那条 wf.listLabels
 * （与弹窗里那次同一条电话、同一套记账：成功记 info host.call、失败记 warn host.call.fail，
 * 不新增日志事件）。异常、标签不存在、回包形状不对，统统按默认色兜底，按钮上不摆任何报错——
 * 报错是点开弹窗之后的事，入口按钮只保证任何时刻都画得出一只彩色调色盘。
 */
export const LabelColorEntry = (props) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const [open, setOpen] = React.useState(false)
  const cwd = (props && props.cwd) || ''
  // 会话号一路传给两条宿主电话：宿主靠它算「写工作区」要用的沙箱政策（宿主读的字段名就是 sessionId）。
  const sessionId = (props && props.sessionId) || ''
  const narrow = !!(props && props.narrow)
  const onSaved = props && props.onSaved
  const tip = tr('lc.entryTip')
  const edge = 'var(--dsw-alias-label-secondary,#a1a1aa)'
  // #637 追改：按钮那圈描边不再是灰的，改成和调色盘盘身边框同一个木色（深浅两档由面板按主题挑），
  // 按钮与图标连起来看是一只完整的调色盘。按钮的尺寸圆角都不动，动的只有描边色。
  const edgeTint = LC_ENTRY_PALETTE_BODY.stroke
  // #637：图标颜色先摆默认色，清单取回来再换成真实颜色（取失败就一直是默认色，不报错）。
  const [dots, setDots] = React.useState(lcEntryPaletteOf(null))
  // 取数参的形状与 useLabelColors 的 phoneArgs 同一句话（cwd、会话号、面板当前后端）：
  // 两处调的是同一条电话，带上去的东西必须一致，宿主才认得这是同一种调用。
  React.useEffect(function () {
    let alive = true
    const args = { cwd: String(cwd || ''), sessionId: String(sessionId || '') }
    try {
      const pb = lcPanelBackendOf((typeof storeOf === 'function') ? storeOf(String(sessionId || '')) : null)
      if (pb) args.backendId = pb
    } catch (e) { /* 读不到面板状态就不带，宿主照旧诚实失败，图标保持默认色 */ }
    const t0 = Date.now()
    let p = null
    try {
      p = (typeof host !== 'undefined' && host && typeof host.call === 'function') ? host.call('wf.listLabels', args) : null
    } catch (e) { p = null }
    Promise.resolve(p).then(function (res) {
      try {
        if (res && res.ok === true) log('info', 'host.call', { method: 'wf.listLabels', latencyMs: Date.now() - t0, ok: true, kind: 'label-colors' })
        else log('warn', 'host.call.fail', { method: 'wf.listLabels', kind: 'label-colors', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error && (res.error.message || res.error.kind)) || 'label-colors-not-ok'), 120, 'error')) })
      } catch (eL) { /* 记日志失败不影响图标 */ }
      if (!alive) return
      const list = lcLabelsOf(res)
      if (list) setDots(lcEntryPaletteOf(list))
    }).catch(function (e) {
      try { log('warn', 'host.call.fail', { method: 'wf.listLabels', kind: 'label-colors', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) { /* 忽略 */ }
      // 取失败：保持默认色，不报错（兜底口径见本文件头）。
    })
    return function () { alive = false }
  }, [cwd])
  const button = h('button', {
    type: 'button',
    'data-label-colors': 1,
    'aria-label': tip,
    onClick: function (e) {
      try { if (e && e.preventDefault) e.preventDefault() } catch (e1) { /* 忽略 */ }
      try { if (e && e.stopPropagation) e.stopPropagation() } catch (e2) { /* 忽略 */ }
      setOpen(true)
    },
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: 4, flex: 'none',
      border: '1px solid ' + edgeTint, color: edge, background: 'transparent',
      cursor: 'pointer', lineHeight: 1, padding: 0, colorScheme: 'light dark',
    },
  }, typeof Ic === 'function' ? Ic({ n: 'palette', size: 10, colors: dots, bodyFill: LC_ENTRY_PALETTE_BODY.fill, bodyStroke: LC_ENTRY_PALETTE_BODY.stroke }) : null)
  return h(React.Fragment, null, [
    h(Tip, { key: 'entry', content: tip }, button),
    open ? h(LabelColorDialog, {
      key: 'dialog',
      cwd: cwd,
      sessionId: sessionId,
      narrow: narrow,
      onSaved: onSaved,
      onClose: function () { setOpen(false) },
    }) : null,
  ])
}
