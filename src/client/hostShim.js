/**
 * client/hostShim.js —— 宿主适配垫片（从 index.js 拆出，#459，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：修宿主环境差异兜底（现在只剩 timer 缺失降级这一件）与自由变量绑定的人改它。
 * 接线：本文件只用闭包已有名字（ctx/React/setTimeout/console），不引用其他新文件。
 */
    // 2026-08-28 实机修复：timer 服务在部分宿主上下文（better-sidebar tab / Web 壳）可能未注入、
    //   或仅提供 setTimeout 而无 timeout 方法——曾出现「Cannot read properties of undefined (reading 'timeout')」
    //   整面板红条（better-sidebar RenderBoundary 捕获）。
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
    // #598：这里原有一段「把旧会话里存的 waystation:map 打开记录迁回 deck:map」的兜底代码，已整段删除，原因两条：
    //   1) 它调的两个方法（migrateLegacyTabIds 与 listOpenTabs）在 dsh-better-sidebar 0.19.0 里根本不存在，
    //      两处 typeof 判断恒为假，整段从落地起就没执行过 —— 是看着在兜底、实际不动的死代码；
    //   2) #598 决定不再保留旧名兼容：直接删掉那个别名注册，不做任何迁移（旧布局里残留的旧名标签
    //      会渲染成可关闭的占位页，维护者已接受这个代​价）。
