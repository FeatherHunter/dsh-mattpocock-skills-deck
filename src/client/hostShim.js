/**
 * client/hostShim.js —— 宿主适配垫片（从 index.js 拆出，#459，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：修宿主环境差异兜底（timer 缺失降级、旧标签迁移）与自由变量绑定的人改它。
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
    // #fix-two-sliders：一次性迁移旧会话中存的 waystation:map 打开记录 → deck:map
    //   仅在 better-sidebar 提供持久化 API 时执行；best-effort，失败不抛（仅 console.warn）
    try {
      const bs0 = ctx.get && ctx.get('betterSidebar')
      if (bs0 && typeof bs0.migrateLegacyTabIds === 'function') {
        try { bs0.migrateLegacyTabIds({ 'waystation:map': 'deck:map' }) } catch (e) { try { console.warn('[MattSkillsDeck] migrateLegacyTabIds failed:', e && e.message) } catch {} }
      } else if (bs0 && typeof bs0.listOpenTabs === 'function') {
        // 退化路径：扫描打开列表 → 替换 → 持久化
        try {
          const open = bs0.listOpenTabs() || []
          const rename = open.filter(function (t) { return t && t.id === 'waystation:map' })
          for (let i = 0; i < rename.length; i++) {
            try { if (typeof bs0.closeTab === 'function') bs0.closeTab('waystation:map') } catch {}
            try { if (typeof bs0.openTab === 'function') bs0.openTab({ type: 'deck:map', path: 'deck:map' }, rename[i].scope) } catch {}
          }
        } catch (e) { try { console.warn('[MattSkillsDeck] legacy migrate fallback failed:', e && e.message) } catch {} }
      }
    } catch {}
