/**
 * views/UpdateEntryHost.ts —— 配置页更新入口的挂载点（地图 #873 落地票 #876 搭架、主题票 #877 切档案卷皮肤）。
 *
 * 为什么有它：配置页标题行那颗检查更新按钮与更新面板 dialog 形态，
 * 不再由本仓自己拼按钮状态机与浮层弹窗，改由更新包的入口件一行挂上。
 * 本文件只做挂载与卸载两件事：进页面时把入口件挂到容器上，
 * 离开时按包的约定收尾（只停轮询，安装在宿主侧继续跑，重开面板立刻重新读取状态）。
 *
 * 定案（2026-10-06，人已确认）：按钮用包的默认摆法，不传尺寸覆盖；
 * 弹窗用包的 dialog 原样，不传关闭与重启接线，不做语言接入与尺寸对齐等附加项；
 * 皮肤只用档案卷：挂载时传档案卷皮肤，不自定义皮肤变量；深浅跟随系统，
 * 档案头与印章与待重启横幅按包的档案卷呈现（入口件打开的 dialog 面板同步换肤）。
 * 调用只走包的电话名与轮询间隔：入口件内部从前缀算电话名、用包默认轮询间隔，
 * 本文件不写电话名字面量，不自己起定时器。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、分支条件、
 * 字符串、数字、对象键与次序、函数名一字未动。一条**转写时刻意保持不动**的形态：原文件里
 *   没有 `export` 行（它不是按模块导出被消费的），转写后照旧没有——按本批规矩不自己改写法。
 *   它在构建里由 scripts/build.mts 的 leaf 清单按文件路径整段拼进 src/client/index.ts 的客户端
 *   闭包，剥行首 export 那一套对它本来就不起作用。若以后要按模块 import 它，得先和登记处一起改。
 * 类型检查时的连带效果：一份没有 import / export 的 .ts 会被编译器当「全局脚本」看，下面
 *   `const UpdateEntryHost` 因此落在全局作用域——仓里别的客户端 .ts 都是模块，不会有重名冲突。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * `__DshUpdateEntry` 是宿主注入的更新入口件绑定包（构建产物 scripts/generated/ 下那份 bundle），
 * 本文件只声明形状、不参与转译。React / DswsCtx / host 由 src/client/ts-pixel-ambient.d.ts
 * 统一声明，这里不重复声明。为什么不写 import：拼进闭包的片段里留着运行时 import，运行时就是语法错。
 */
declare const __DshUpdateEntry: any;

const UpdateEntryHost = (props: any) => {
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
      const callThrough = function (name: any, args: any) {
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
        theme: 'archive',
      })
    } catch (eMount) {}
    return function () { try { if (entry && typeof entry.unmount === 'function') entry.unmount() } catch (eUn) {} }
  }, [])
  return h('span', { ref: boxRef, style: { display: 'inline-flex', alignItems: 'center' } })
}
