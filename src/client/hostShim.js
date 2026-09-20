/**
 * client/hostShim.js —— 宿主适配垫片（从 index.js 拆出，#459，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：修宿主环境差异兜底（现在只剩 timer 缺失降级这一件）与自由变量绑定的人改它。
 * 接线：本文件只用闭包已有名字（ctx/React/setTimeout/console），不引用其他新文件。
 */
    // 2026-08-28 实机修复：timer 服务在部分宿主上下文（Web 壳）里可能未注入、
    //   或仅提供 setTimeout 而无 timeout 方法——曾出现「Cannot read properties of undefined (reading 'timeout')」
    //   整面板变成一条红条（当年那格挂在 better-sidebar 的容器里，它用 RenderBoundary 把异常画成了红条；
    //   2026-09-21 起本插件不再用 better-sidebar，但 Web 壳这条上下文仍在，降级逻辑照旧保留）。
    //   根治：timer 恒为非空包装对象——timeout 优先走原服务；缺失时降级原服务的 setTimeout；再缺失用全局 setTimeout。
    export const _timerRaw = ctx.get('timer')
    export const timer = {
      timeout: function (fn, ms) {
        try {
          if (_timerRaw && typeof _timerRaw.timeout === 'function') return _timerRaw.timeout(fn, ms)
          if (_timerRaw && typeof _timerRaw.setTimeout === 'function') return _timerRaw.setTimeout(fn, ms)
          return setTimeout(fn, ms)
        } catch (e) { try { return setTimeout(fn, ms) } catch (e2) { return null } }
      },
      setTimeout: function (fn, ms) {
        return timer.timeout(fn, ms)
      },
    }
    export const h = React.createElement
    // 2026-09-21：这里原本还有一段说明，讲当年往 dsh-better-sidebar 注册面板类型时留下的一个坑。
    //   那套东西已经整段删除（面板现在只有 DSH 原生右侧边栏一条路），说明随之撤掉；
    //   留一句记住这里的规矩：本文件只放「修宿主环境差异的兜底」与自由变量绑定，不放业务。
