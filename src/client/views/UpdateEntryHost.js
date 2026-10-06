/**
 * views/UpdateEntryHost.js —— 配置页更新入口的挂载点（地图 #873 落地票 #876）。
 *
 * 为什么有它：配置页标题行那颗检查更新按钮与更新面板 dialog 形态，
 * 不再由本仓自己拼按钮状态机与浮层弹窗，改由更新包的入口件一行挂上。
 * 本文件只做挂载与卸载两件事：进页面时把入口件挂到容器上，
 * 离开时按包的约定收尾（只停轮询，安装在宿主侧继续跑，重开面板立刻重新读取状态）。
 *
 * 定案（2026-10-06，人已确认）：按钮用包的默认摆法，不传尺寸覆盖；
 * 弹窗用包的 dialog 原样，不传关闭与重启接线，不做语言接入与尺寸对齐等附加项；
 * 皮肤由主题票切档案卷，本票不传皮肤参数，走包默认皮肤。
 * 调用只走包的电话名与轮询间隔：入口件内部从前缀算电话名、用包默认轮询间隔，
 * 本文件不写电话名字面量，不自己起定时器。
 */
const UpdateEntryHost = (props) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const boxRef = React.useRef(null)
  React.useEffect(function () {
    const el = boxRef.current
    if (!el) return undefined
    let entry = null
    try {
      const bundle = typeof __DshUpdateEntry !== 'undefined' ? __DshUpdateEntry : null
      if (!bundle || typeof bundle.mountUpdateEntry !== 'function') return undefined
      const callThrough = function (name, args) {
        try {
          if (typeof host !== 'undefined' && host && typeof host.call === 'function') return host.call(name, args)
        } catch (eHost) {}
        return Promise.reject(new Error('host-unavailable'))
      }
      // 插件标识与电话名前缀与宿主侧一致（单源在 scripts/derive-update-from-package.mjs，
      // 宿主适配器按包默认值校验一遍；这里只传值，不拼电话名字面量）。
      entry = bundle.mountUpdateEntry(el, {
        pluginId: 'dsh-mattpocock-skills-deck',
        prefix: 'wf',
        call: callThrough,
      })
    } catch (eMount) {}
    return function () { try { if (entry && typeof entry.unmount === 'function') entry.unmount() } catch (eUn) {} }
  }, [])
  return h('span', { ref: boxRef, style: { display: 'inline-flex', alignItems: 'center' } })
}
