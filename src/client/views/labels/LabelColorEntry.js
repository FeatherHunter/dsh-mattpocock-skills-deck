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
      border: '1px solid ' + edge, color: edge, background: 'transparent',
      cursor: 'pointer', lineHeight: 1, padding: 0, colorScheme: 'light dark',
    },
  }, typeof Ic === 'function' ? Ic({ n: 'palette', size: 10 }) : null)
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
