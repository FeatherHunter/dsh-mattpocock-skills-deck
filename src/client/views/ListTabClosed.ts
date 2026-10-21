// views/ListTabClosed.ts — 主列表「已关闭票按需翻页」的那两件（#690 新增，从 ListTab.js 拆出的叶子）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
// src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
// 以后谁改它：改「展开折叠行 / 切到已关闭 / 滚到底」这三个触发点，或改「已加载 x / 共 N」那句话的人改它。
// 接线：调用方（ListTab.ts）传进 h 与 st；页数据本身住在 kernel/issue-pages.ts（同闭包，直接调）。
//
// 规格出处：docs/design/677-issue-pool-completeness-spec.md 第 7.4 节（三个触发点）、第 9 节（游标失效、
// 后端不支持、拿不到各怎么办）。三个触发点共用同一份页数据与游标（都走 loadIssuePage），不各取各的。

// 本文件由同名 .js 转写为 TypeScript（#1253「界面视图层整批转 TypeScript」）：只加类型标注与中文注释，
//   逻辑、分支条件、字符串、数字、对象键与次序、函数名与导出名一字未改，行为零变化。
// 两条不能再改的约定：①模块说明符仍写 .js（scripts/ts-hook.mts 会把 .js 改指同目录同名 .ts）；
//   ②写法限「可剥离的 TypeScript」——不用 enum、不用构造函数参数属性，因为测试链路上 Node 只删类型、不做语法转换。
// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
//   把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
//   不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare function issuePageStatOf(...args: any[]): any;
declare function loadIssuePage(...args: any[]): any;

// 滚到底触发：这个钩子在「已关闭」筛选下生效时做两件事 —— 进来先把第一页备上（谁切进来的都算，
//   面板筛选条与状态栏那几处写的是同一个字段，钩子盯字段不盯按钮），然后盯住面板的滚动容器，
//   快到底（差 80 像素以内）就要下一页。滚动容器是 .dsws-body（Dock 的根节点里那个滚动区），
//   它可能比本组件晚一步挂上来，所以每次 enabled 变化都重新查一次。
export const useClosedPageScroll = function (st: any, enabled: any) {
      React.useEffect(function () {
        if (!enabled) return
        try { loadIssuePage(st, { view: 'list' }) } catch (e) {}
        if (typeof document === 'undefined') return
        const el = document.querySelector('.dsws-body')
        // 滚动容器可能比本组件晚一步挂上来（面板换页/换布局时会重建）：找得到就盯它，
        // 找不到就先盯 document 的捕获相（滚动事件不冒泡，只有捕获相收得到），真滚起来时再回查一次。
        const bound = (el && typeof el.addEventListener === 'function') ? el : document
        const onScroll = function (ev: any) {
          try {
            const target = (ev && ev.target && ev.target.scrollHeight !== undefined) ? ev.target : (document.querySelector('.dsws-body') || el)
            if (!target || target.scrollHeight === undefined) return
            if ((target.scrollTop + target.clientHeight) < (target.scrollHeight - 80)) return
            loadIssuePage(st, { view: 'list', next: true })
          } catch (e) {}
        }
        bound.addEventListener('scroll', onScroll, { passive: true, capture: true })
        return function () { try { bound.removeEventListener('scroll', onScroll, { capture: true }) } catch (e) {} }
      }, [enabled])
    }

// 「已关闭」视图里那一行小字：把已加载多少/一共多少说清楚，出岔子时也在这行说出来。
//   四个情形按规格第 9 节与第 10 节的第 9、11 条：后端不支持翻页 → 给「在网页上看全部」的出口（不是空白、
//   也不是假列表）；游标失效 → 说已经重新从最近的一页开始；取不到 → 如实说并留着已经加载的行；正常 → 报数。
//   loadedCount 由调用方把「当前列表里真的画了多少张已关闭票」传进来，与折叠行那两个数同源，免得两处各算一遍。
export const closedPagesNode = function (h: any, st: any, loadedCount: any) {
      const stat = issuePageStatOf(st, 'list')
      const x = (typeof loadedCount === 'number') ? loadedCount : stat.loaded
      const n = (stat.total != null) ? stat.total : x
      const started = stat.pages > 0 || stat.loading || !!stat.notice
      if (!started) return null
      const bits = []
      if (stat.notice === 'noweb') {
        bits.push(h('span', { key: 'web', style: { color: '#f59e0b' } }, tr('list.pageAllOnWeb')))
        const url = repoWebIssuesUrlOf(st)
        // 本次界面反馈需求：这个链接是本页唯一能去追踪器看全部票的入口，给它按压态、悬停反馈与点击日志。
        if (url) bits.push(h('a', { key: 'weblink', className: 'dsws-btn ghost dsws-hov', 'data-press': 'link', 'data-log': 'list.closed.web', href: url, target: '_blank', rel: 'noreferrer', style: { padding: '0 6px', fontSize: 10, textDecoration: 'none' } }, tr('act.view')))
      } else if (stat.notice === 'stale') {
        bits.push(h('span', { key: 'stale', style: { color: '#f59e0b' } }, tr('list.pageStale')))
      } else if (stat.notice === 'fail') {
        bits.push(h('span', { key: 'fail', style: { color: '#f87171' } }, tr('list.pageFail')))
      }
      if (stat.loading) bits.push(h('span', { key: 'loading', style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr('list.loading')))
      bits.push(h('span', { key: 'count' }, tr('list.pageLoaded', { x: x, n: n })))
      if (stat.trimmed) bits.push(h('span', { key: 'trimmed', style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('list.pageTrimmed')))
      return h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', margin: '2px 0 6px' } }, bits)
    }

// 「在网页上看全部」的落点：仓库网页的票列表页。拿不到仓库网址就返回空串，那一颗按钮不渲染（不造假链接）。
export const repoWebIssuesUrlOf = function (st: any) {
      try {
        const repo = (st && st.snapshot && st.snapshot.repository) || {}
        const url = String(repo.url || '')
        if (!/^https?:\/\//i.test(url)) return ''
        return url.replace(/\/+$/, '') + '/issues'
      } catch (e) { return '' }
    }
