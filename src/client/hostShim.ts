/**
 * client/hostShim.ts —— 宿主适配垫片（从 index.js 拆出，#459，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
 * 以后谁改它：修宿主环境差异兜底（timer 缺失降级、计时器句柄的撤销两件）与自由变量绑定的人改它。
 * 接线：本文件只用闭包已有名字（ctx/React/setTimeout/console），不引用其他新文件。
 */

// 本文件由同名 .js 转写为 TypeScript（#1254 收口三份根文件之一）：只加类型标注与中文注释，
//   逻辑、分支条件、字符串、数字、对象键与次序、函数名与导出名一字未改，行为零变化。
// 两条不能再改的约定：①模块说明符仍写 .js（scripts/ts-hook.mts 会把 .js 改指同目录同名 .ts）；
//   ②写法限「可剥离的 TypeScript」——不用 enum、不用构造函数参数属性，因为测试链路上 Node 只删类型、不做语法转换。
// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
//   把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
//   不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare const ctx: any;
declare const React: any;
    // 2026-08-28 实机修复：timer 服务在部分宿主上下文（Web 壳）里可能未注入、
    //   或仅提供 setTimeout 而无 timeout 方法——曾出现「Cannot read properties of undefined (reading 'timeout')」
    //   整面板变成一条红条（当年那格挂在 better-sidebar 的容器里，它用 RenderBoundary 把异常画成了红条；
    //   2026-09-21 起本插件不再用 better-sidebar，但 Web 壳这条上下文仍在，降级逻辑照旧保留）。
    //   根治：timer 恒为非空包装对象——timeout 优先走原服务；缺失时降级原服务的 setTimeout；再缺失用全局 setTimeout。
    export const _timerRaw: any = ctx.get('timer')
    export const timer: any = {
      timeout: function (fn: any, ms: any) {
        try {
          if (_timerRaw && typeof _timerRaw.timeout === 'function') return _timerRaw.timeout(fn, ms)
          if (_timerRaw && typeof _timerRaw.setTimeout === 'function') return _timerRaw.setTimeout(fn, ms)
          return setTimeout(fn, ms)
        } catch (e) { try { return setTimeout(fn, ms) } catch (e2) { return null } }
      },
      setTimeout: function (fn: any, ms: any) {
        return timer.timeout(fn, ms)
      },
      // #1220：宿主那支 timer 服务本来就有 interval，但客户端这片包装从前只转发 timeout/setTimeout，
      //   于是 src/refresh/rooms/client/refresh-timer.js 那条 5 秒节拍判「没有 interval 出口」直接不排，
      //   #891 的「初始化完成后自动重算」因此从没跑过（真机 probe.loop 全是 reason=no-timer）。
      //   与 timeout 同一条降级链：宿主有 interval 就用宿主的，没有就退回页面自己的 setInterval。
      interval: function (fn: any, ms: any) {
        try {
          if (_timerRaw && typeof _timerRaw.interval === 'function') return _timerRaw.interval(fn, ms)
          return setInterval(fn, ms)
        } catch (e) { try { return setInterval(fn, ms) } catch (e2) { return null } }
      },
      // 撤销一支计时器句柄。宿主那支服务（cordis 的 timer）交回的是**一支可调用的撤销器函数**，
      //   对它调全局 clearTimeout 不报错、也撤不掉（#1115 实测）；装了 dispose 的对象与页面自己的
      //   数字句柄又各是另一档，所以按形状分三档，顺序不能反：先认显式 dispose，再才是调用句柄本身。
      //   这一套判断与 src/refresh/contract/host-timer-ports.ts 的 cancelHostTimer 是同一份约定 ——
      //   客户端这片是拼进 src/client/index.ts 的叶子（构建剥行首 export 直接拼文本），不能用 import
      //   引那份共享源码，所以这里照抄一份；改一处要同时改另一处，两边都有门禁钉着。
      clearTimeout: function (id: any) {
        try {
          if (id && typeof id.dispose === 'function') { id.dispose(); return }
          if (typeof id === 'function') { id(); return }
          if (id !== undefined && id !== null) clearTimeout(id)
        } catch (e) {}
      },
    }
    export const h: any = React.createElement
    // 2026-09-21：这里原本还有一段说明，讲当年往 dsh-better-sidebar 注册面板类型时留下的一个坑。
    //   那套东西已经整段删除（面板现在只有 DSH 原生右侧边栏一条路），说明随之撤掉；
    //   留一句记住这里的规矩：本文件只放「修宿主环境差异的兜底」与自由变量绑定，不放业务。
