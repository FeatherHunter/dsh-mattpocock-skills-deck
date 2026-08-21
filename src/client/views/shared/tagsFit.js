/**
 * views/shared/tagsFit.js — 标签贪心折叠（fitAllTags，v1.3.3）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.5 主列表（v14：三选一动作 / map 行突出 + 开始执行 / 已关闭折叠行 / chips 深边框 / 窄屏双栏）----
    // v1.3.3 UI：行2 标签贪心折叠 —— 渲染后测量可用宽度，逐个放标签，放不下的隐藏进 +N（单行不换行）
export     const _tagsFpOf = (typeof WeakMap !== 'undefined') ? new WeakMap() : { get: function () { return undefined }, set: function () { } }
export     const fitAllTags = function () {
      if (typeof document === 'undefined') return
      document.querySelectorAll('.dsws-tags').forEach(function (tags) {
        const more = tags.querySelector('.dsws-more')
        if (!more) return
        const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
        chips.forEach(function (c) { c.style.display = 'inline-flex' })
        more.style.display = 'inline-flex'
        const avail = tags.clientWidth
        const moreW = more.offsetWidth
        const gap = 3
        const room = avail - moreW - gap
        let used = 0, shown = 0
        chips.forEach(function (c, i) {
          const w = c.offsetWidth
          if (used + w <= room || i === 0) { c.style.display = 'inline-flex'; used += w + gap; shown++ }
          else c.style.display = 'none'
        })
        const hidden = chips.length - shown
        more.textContent = '+' + hidden
        more.style.display = hidden > 0 ? 'inline-flex' : 'none'
      })
    }
