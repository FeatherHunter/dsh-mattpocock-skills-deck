/**
 * views/shared/tagsFit.ts — 标签贪心折叠（fitAllTags，v1.3.3）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、
 * 数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mjs 构建时剥掉行首 export 后把声明体拼进 src/client/index.js 的客户端闭包
 * （一源两物）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mjs 改指同名 .ts。
 * 本文件没有闭包依赖（只用浏览器自带的 document 与 WeakMap），所以不需要环境声明。
 * 三段式（先全显示、再一次读完宽度、最后按算好的结果写回）是它存在的理由，不能改成边读边写。
 */
    // ---- 5.5 主列表（v14：三选一动作 / map 行突出 + 开始执行 / 已关闭折叠行 / chips 深边框 / 窄屏双栏）----
    // v1.3.3 UI：行2 标签贪心折叠 —— 渲染后测量可用宽度，逐个放标签，放不下的隐藏进 +N（单行不换行）
    // 2026-09-11 修「首次打开右侧面板要等五六秒」：原写法在同一个循环里「读一次 offsetWidth（浏览器必须
    //   先把脏了的布局重排一遍才能给数）→ 紧接着写一次 style.display（又把布局弄脏）」，量改交替，
    //   500 行、每行几个标签就是两三千次强制重排。真机实测这一段占 4.9 秒（整次提交 4.95 秒），
    //   浏览器自己的长动画帧账本也记到同一次任务里被强制布局吃掉 4.8 秒。
    //   本处按「布局零抖动」改写（纪律与判据见 docs/adr/20260911-zero-layout-jitter.md，证据见 #602；
    //   词条见 CONTEXT.md）：先全部显示（单独一段写）→ 一次读完所有宽度（测量相）
    //   → 按算好的结果写回（变更相）。
    //   为什么结果一定相同：样式表里 `.dsws-tags .dsws-chip{flex:none}`，单个标签的宽度只由它自己的
    //   内容决定，与兄弟显示与否无关，所以测量相一次全读，读到的与原来边隐藏边逐个读的是同一组值。
export     const _tagsFpOf = (typeof WeakMap !== 'undefined') ? new WeakMap() : { get: function () { return undefined }, set: function () { } }
export     const fitAllTags = function () {
      if (typeof document === 'undefined') return
      // 这两处标 any 是「只加类型、不改代码」的必要代价：querySelectorAll 在类型上给的是 Element，
      // 而 Element 上没有 style / offsetWidth（那些挂在 HTMLElement 上）；rows 里除了元素还要挂
      // avail / moreW / widths 三个算出来的中间值，标成 any[] 才能照原样往上挂键。
      const all: any = document.querySelectorAll('.dsws-tags')
      const rows: any[] = []
      // 第一趟（只写）：把上一次的隐藏状态全部还原成显示。此后到「读完所有宽度」之前不再写任何样式。
      for (let i = 0; i < all.length; i++) {
        const tags = all[i]
        const more = tags.querySelector('.dsws-more')
        if (!more) continue
        const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
        for (let k = 0; k < chips.length; k++) chips[k].style.display = 'inline-flex'
        more.style.display = 'inline-flex'
        rows.push({ tags: tags, more: more, chips: chips })
      }
      // 第二趟（只读）：把所有要用的宽度一次读完。这一趟里不写任何样式，所以只触发一次重排。
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        r.avail = r.tags.clientWidth
        r.moreW = r.more.offsetWidth
        const widths = []
        for (let k = 0; k < r.chips.length; k++) widths.push(r.chips[k].offsetWidth)
        r.widths = widths
      }
      // 第三趟（只写）：按算好的结果显示或隐藏，不再读任何几何属性。
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const gap = 3
        const room = r.avail - r.moreW - gap
        let used = 0, shown = 0
        for (let k = 0; k < r.chips.length; k++) {
          const w = r.widths[k]
          if (used + w <= room || k === 0) { used += w + gap; shown++ }
          else r.chips[k].style.display = 'none'
        }
        const hidden = r.chips.length - shown
        r.more.textContent = '+' + hidden
        r.more.style.display = hidden > 0 ? 'inline-flex' : 'none'
      }
    }
