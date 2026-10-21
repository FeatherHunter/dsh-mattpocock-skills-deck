/**
 * views/ListTab.ts — 主列表（排序/过滤/chips/行动作，5.5）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 */

// 本文件由同名 .js 转写为 TypeScript（#1253「界面视图层整批转 TypeScript」）：只加类型标注与中文注释，
//   逻辑、分支条件、字符串、数字、对象键与次序、函数名与导出名一字未改，行为零变化。
// 两条不能再改的约定：①模块说明符仍写 .js（scripts/ts-hook.mts 会把 .js 改指同目录同名 .ts）；
//   ②写法限「可剥离的 TypeScript」——不用 enum、不用构造函数参数属性，因为测试链路上 Node 只删类型、不做语法转换。
// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
//   把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
//   不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare function Ic(...args: any[]): any;
declare function applyStandaloneBlocks(...args: any[]): any;
declare function chainSteps(...args: any[]): any;
declare function chipProps(...args: any[]): any;
// #1286：容器角标上的标记类名（内核 container-view.ts 给出）：列表页按它认出「这一行是容器」
declare const CONTAINER_CHIP_MARKER_CLASS: any;
// #1295：容器种类判定（内核 container-view.ts 给出）：列表页的分桶与行渲染必须看同一个结论，
//   否则同一张票会「行画成地图、却排在普通票堆里」。
declare function containerKindOf(...args: any[]): any;
declare function closedPagesNode(...args: any[]): any;
declare function listFilterRowNode(...args: any[]): any;
declare function compute(...args: any[]): any;
declare function darken(...args: any[]): any;
declare function deckCountsOf(...args: any[]): any;
declare function effortNamesOf(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function fitAllTags(...args: any[]): any;
declare function getCachedSnapshot(...args: any[]): any;
declare function healthCheckCountOf(...args: any[]): any;
declare function healthCheckVisible(...args: any[]): any;
declare function hexA(...args: any[]): any;
declare function isEnabled(...args: any[]): any;
declare function isOccupied(...args: any[]): any;
declare function issuePageRowsOf(...args: any[]): any;
declare function listIssueRow(...args: any[]): any;
declare function listSkeletonNode(...args: any[]): any;
declare function loadIssuePage(...args: any[]): any;
declare function mapBlockOf(...args: any[]): any;
declare function openHealthCheck(...args: any[]): any;
declare function openIssuesOf(...args: any[]): any;
declare function panelNow(...args: any[]): any;
declare function saveLabelClicks(...args: any[]): any;
declare function saveListPrefs(...args: any[]): any;
declare function ticketRowsOf(...args: any[]): any;
declare function truthNoticeLines(...args: any[]): any;
declare function useClosedPageScroll(...args: any[]): any;
declare const RestFallbackBanner: any;
declare const Tip: any;
declare const _tagsFpOf: any;
declare const labelClicks: any;
declare const listPrefs: any;
declare const panelClock: any;
declare const CONTAINER_ACCENT: any;

// #1295：上一次落过的 container.split 分桶指纹（只在调试档用）。同一份分桶结果不重复落行 ——
//   切页签、改筛选会让下面那个副作用再跑一趟，但四组条数与兜底标记都没变就没有新信息，记了属于「无变化的心跳」。
let _splitLogFp: string = ''

export     const MAP_ROW_GUARD_NARROW = 320
export     const MAP_ROW_GUARD_WIDE = 440
export     const authorColor = function(l: any){let h=0;for(let i=0;i<l.length;i++)h=(h*31+l.charCodeAt(i))%360;h=(h*137.508)%360;let s=0.72,ll=0.5,c=(1-Math.abs(2*ll-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=ll-c/2,r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);return '#'+[r,g,b].map((v: any)=>v.toString(16).padStart(2,'0')).join('');}
// 2026-09-11 同类毛病一并修（与 views/shared/tagsFit.ts 同一回事；纪律「布局零抖动」见
//   docs/adr/20260911-zero-layout-jitter.md，证据见 #602）：原写法每个地图行都
//   「写一次类名（把编号改横排、并把标题切进测量态）→ 立即读一次 scrollWidth」，量改交替，
//   48 个地图行就是 48 次强制重排。现分相改四趟：先一次读完所有行宽（测量相）
//   → 单独一段只写类名并把要量的行切进测量态 → 只读（测量相，整趟只重排一次）
//   → 只写（变更相：收掉测量态、放不下的退回竖排）。
export     const fitMapRows = function () {
      if (typeof document === 'undefined') return
      const rows = document.querySelectorAll('.dsws-aggrow')
      // 第一趟（只读）：行宽由外层容器决定，与行内编号是横排还是竖排无关，所以先读再写读到的是同一个值。
      // 标注 : any[] 只为过类型检查：第三趟要往每个元素上回写测量结果 it.fits，
      //   让 TypeScript 按字面量推断就会说 fits 这个属性不存在；运行时形状一个字节没变。
      const items: any[] = []
      for (let i = 0; i < rows.length; i++) {
        const rowEl = rows[i]
        const idcol = rowEl.querySelector('.dsws-idcol')
        const title = rowEl.querySelector('.dsws-tt-wrap')
        if (!idcol || !title) continue
        // #1286：容器行（探索地图 / 规格）都要横排 —— 按角标上的容器标记类认，不按颜色认。
        //   标记类名取自内核 container-view.ts；门禁单独求值本文件时那份常量不在，退回同名兜底。
        const containerMarker = (typeof CONTAINER_CHIP_MARKER_CLASS === 'string' && CONTAINER_CHIP_MARKER_CLASS) ? CONTAINER_CHIP_MARKER_CLASS : 'dsws-chip-container'
        items.push({ idcol: idcol, title: title, isContainer: !!idcol.querySelector('.' + containerMarker), avail: rowEl.clientWidth })
      }
      // 第二趟（只写）：非地图行与极窄行去掉横排；宽行直接横排；中间行先横排并切进测量态。
      const measure: any[] = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (!it.isContainer || it.avail < MAP_ROW_GUARD_NARROW) { it.idcol.classList.remove('h'); continue }
        it.idcol.classList.add('h')
        if (it.avail < MAP_ROW_GUARD_WIDE) { it.title.classList.add('dsws-measure'); measure.push(it) }
      }
      // 第三趟（只读）：标题在测量态下放不放得下。这一趟不写任何样式，所以只触发一次重排。
      for (let i = 0; i < measure.length; i++) {
        const it = measure[i]
        it.fits = it.title.scrollWidth <= it.title.clientWidth + 1
      }
      // 第四趟（只写）：收掉测量态；放不下的退回竖排。
      for (let i = 0; i < measure.length; i++) {
        const it = measure[i]
        it.title.classList.remove('dsws-measure')
        it.title.classList.remove('measure')
        if (!it.fits) it.idcol.classList.remove('h')
      }
    }
export     const ListTab = ({ st, narrow }: any) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // v1.3.3 UI：每次渲染后执行贪心折叠（含窗口/列宽变化后的重渲染）
      // v1.5 T10 提速：按内容指纹跳过 —— 仅快照内容/tab/过滤变化才重排（refreshing 态等无关渲染不触发布局测量）
      React.useLayoutEffect(function () {
        // #606 常规测点（折叠测量耗时）：本副作用跑在提交阶段，落在渲染期计时的盲区里，
        //   是「那一帧在建什么」的主要嫌疑之一，所以把这段耗时累加进 panelClock 交给 DockSync 打日志；
        //   这里的耗时只累加数字、不打测量日志（原由 tests/verify-log-truncate.js 第 4 组的「渲染目录点名
        //   名单」拦着，那份名单已随 #1052 收编不存在；现行约束是日志契约 1.5：渲染路径只许记编号与计数）。
        //   #1295 起这个副作用另有一条调试档的 container.split（见下），只记分桶计数，与这里的耗时测点无关。
        const _tFit0 = isEnabled('debug') ? panelNow() : 0
        const _addFit = function () { try { if (_tFit0) panelClock.fitMs = Math.round((panelClock.fitMs || 0) + (panelNow() - _tFit0)) } catch (eF) {} }
        const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
        if (_tagsFpOf.get(st) === fp) { _addFit(); return }
        _tagsFpOf.set(st, fp)
        fitAllTags()
        try { fitMapRows() } catch (e) {}
        // #1295 分流口径日志（调试档）：这一轮列表把行分到哪几组 —— 探索地图 / 实施地图（规格）/ 普通票 / 已关闭，
        //   外加「容器判定是否退回了本文件内的兜底」。只记计数与一个快照时刻，不记任何票面原文
        //   （日志契约 1.5：渲染路径只许记编号与计数）。genMs 是这份快照的生成时刻，用来把这一行与同一份
        //   快照的宿主侧 snapshot.built 对起来；四个计数取的是标签筛选之前的分桶数（筛选在画行时才生效）。
        //   切页签、改筛选会让这个副作用再跑一趟，但四组条数与兜底标记都没变时不重复落行（日志纪律：无变化不记）。
        //   字段含义与读法见 research/489-appendix.md 第 1 章 #114。
        if (isEnabled('debug')) {
          const degraded: boolean = !(typeof containerKindOf === 'function')
          const exploreN: number = mapOnlyIssues.length
          const specN: number = specOnlyIssues.length
          const splitFp: string = exploreN + '|' + specN + '|' + plainOpenIssues.length + '|' + closedIssues.length + '|' + (degraded ? 1 : 0)
          if (splitFp !== _splitLogFp) {
            _splitLogFp = splitFp
            log('debug', 'container.split', { explore: exploreN, spec: specN, plain: plainOpenIssues.length, closed: closedIssues.length, degraded: degraded, genMs: (st.snapshot && st.snapshot.generatedMs) || 0 })
          }
        }
        _addFit()
      })
      // Map #120 T1：标题适配 + 宽度护栏 的容器尺寸监听（面板拖拽 / 字体加载 / window resize）
      React.useLayoutEffect(function () {
        const doFit = function () { try { fitMapRows() } catch (e) {} }
        doFit()
        // 标 : any 是因为初值是 null、真正的实例在下面的分支里才赋上；不标会被推断成 null，后面 ro.observe 就没法过。
        let ro: any = null
        try {
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(function () { doFit() })
            // #646：面板容器现在在右侧边栏里（Dock 的根节点带 data-dsws-host），页内浮窗已退役
            const panel = document.querySelector('[data-dsws-host]')
            const body = document.querySelector('.dsws-body')
            if (panel) try { ro.observe(panel) } catch (e) {}
            if (body) try { ro.observe(body) } catch (e) {}
            document.querySelectorAll('.dsws-aggrow').forEach(function (el: any) { try { ro.observe(el) } catch (e) {} })
          }
        } catch (e) {}
        const onWin = function () { doFit() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        let fontsDone = false
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { if (!fontsDone) { fontsDone = true; doFit() } })
        }
        return function () {
          try { if (ro) ro.disconnect() } catch (e) {}
          if (typeof window !== 'undefined') window.removeEventListener('resize', onWin)
        }
      }, [])
      // #690：历史票按需翻页。这一钩子在「看得到已关闭票」的两处生效（状态筛到「已关闭」，或底部那条
      //   折叠行被展开）：进去先把第一页备上，滚到底再顺着游标取下一页。三个触发点共用同一份页数据。
      useClosedPageScroll(st, st.stateFilter === 'closed' || st.closedFoldOpen === true)
      // effort 维度：仓库里有几个 effort（去重排序，来自共享小件；单 effort 后端恒 []，界面不变）
      const effortNames = effortNamesOf(st)
      const multiEffort = effortNames.length > 1
      // effort 筛选（会话私有，不持久化）：没选=全部；选了=只看这些 effort 的行
      const effPass = function (x: any) {
        const sel = st.effFilters || []
        return !sel.length || sel.indexOf(effortOf(x)) >= 0
      }
      // #689 工单口径：拉取请求不进主列表（面板另有专门的拉取请求页签；口径判断住在 store-derived 的
      //   isTicketRow，与 KPI、状态栏共用同一处）。池子（snapshot.issues）本身不动，仍是原样全收。
      // #690：再并上「按需翻回来的那些页」里池子没有的行（issuePageRowsOf 已按身份去掉重复的），
      //   于是已关闭那一堆里既有首屏那一百条、也有用户翻出来的更早的票；静默刷新只换池子，页数据不动。
      const issues = ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).concat(issuePageRowsOf(st, 'list'))
      // #374：多维排序 —— map 行恒置顶，map 组与普通组各自按所选维度排序；默认 更新时间↓（与现状一致）
      // #1253 优化（行为不变，只是把重复计算挪到排序前算一次）：原来每比较一对票就要现做一次
      //   String(...) 转换与 localeCompare 的入参准备，一张五千行的列表要比较约六万次；现在先把
      //   每张票的比较键（数字键 / 小写标题 / 所选维度文本 / effort）各算一次，再让比较函数只用
      //   算好的键。排序口径逐条照抄：主键不同就按方向返回，相同则先 effort 后编号升序兜底。
      const sortIssues = function (arr: any) {
        const dir = st.sortDir === 'asc' ? 1 : -1
        const key = st.sortKey
        const decorated = arr.map(function (x: any) {
          return {
            x: x,
            n: key === 'number' ? x.number : undefined,
            t: key === 'title' ? String(x.title).toLowerCase() : undefined,
            s: (key === 'number' || key === 'title') ? undefined : String(x[key] || ''),
            e: String(x.effortId || ''),
          }
        })
        decorated.sort(function (a: any, b: any) {
          let c
          if (key === 'number') { c = a.n - b.n; if (c !== 0) return dir * c }
          else if (key === 'title') { c = a.t.localeCompare(b.t); if (c !== 0) return dir * c }
          else { c = a.s.localeCompare(b.s); if (c !== 0) return dir * c }
          return a.e.localeCompare(b.e) || (a.x.number - b.x.number)  // 同键兜底：先 effort 再编号升序（稳定）
        })
        return decorated.map(function (d: any) { return d.x })
      }
      // #1253 这一笔优化（转写零变化之后单独的一笔，行为不变，只是少扫几趟）：
      //   一趟渲染把整个列表扫一遍就分好桶：每张票只判一次状态、只判一次「是哪种容器」。
      // #1295：容器种类判定收口到内核 `src/client/kernel/container-view.ts` 的 `containerKindOf` 一处，
      //   这里不再维护第二份判据（票面 AC 要求「不复制多份」）。内核那份同时认「type 字段」与
      //   `wayfinder:map` 标签（对象式与字符串式都认）；这里若自己另判一份，同一张带字符串式标签的
      //   地图票就会「行画成地图、却排在普通票堆里」，列表顺序与行外观各说各话。
      //   构建把内核拼进同一作用域，成品里直接用内核；只有「单文件求值」的门禁环境里它不在作用域，
      //   才走下面这份同口径兜底（判定次序与内核一致：spec → map → 普通票）。这是显式的降级路径，
      //   不是第二份真源：降级时日志 degraded 记 true，门禁 AC8k 还会比对两条路的行顺序必须一致。
      const containerKindOfSafe: any = (typeof containerKindOf === 'function') ? containerKindOf : function (x: any): any {
        if (!x) return null
        if (x.type === 'spec') return 'spec'
        if (x.type === 'map') return 'map'
        const labs: any[] = Array.isArray(x.labels) ? x.labels : []
        for (let i: number = 0; i < labs.length; i++) {
          const l: any = labs[i]
          const nm: any = (typeof l === 'string') ? l : (l && l.name)
          if (nm === 'wayfinder:map') return 'map'
        }
        return null
      }
      const mapOnlyIssues: any[] = []
      // #1286：规格容器单独一桶。列表顺序是「探索地图 → 规格 → 普通票」，
      //   两类容器各自成组；组内按最近更新降序（容器是正在推进的东西，组内不看面板选的那个排序档）。
      const specOnlyIssues: any[] = []
      const plainOpenIssues: any[] = []
      const closedIssues: any[] = []
      for (const x of issues) {
        if (x.state === 'CLOSED') { closedIssues.push(x); continue }
        const cKind: any = containerKindOfSafe(x)
        if (cKind === 'spec') { specOnlyIssues.push(x); continue }
        if (cKind === 'map') { mapOnlyIssues.push(x); continue }
        plainOpenIssues.push(x)
      }
      // #1286：容器组内按最近更新降序。updatedAt 是宿主给的 ISO 时间串，字典序即时间序；
      //   同一时刻用编号升序兜底，保证顺序稳定。
      const sortContainers = function (arr: any[]) {
        return arr.slice().sort(function (a: any, b: any) {
          const av = String((a && a.updatedAt) || '')
          const bv = String((b && b.updatedAt) || '')
          if (av !== bv) return av < bv ? 1 : -1
          return (a.number - b.number)
        })
      }
      const sortedMaps = sortContainers(mapOnlyIssues)
      const sortedSpecs = sortContainers(specOnlyIssues)
      const sortedOpen = sortIssues(plainOpenIssues)
      const closedSorted = sortIssues(closedIssues)
      const groups = compute(st)
      const occ = groups.reduce(function (n: any, g: any) { return n + g.blocked.length + g.claimed.length }, 0)
      // #284：环境坏项计数改从链快照步骤派生（fail/current 均为需处理项）
      const nBad = chainSteps(st).filter(function (s: any) { return s.status === 'fail' || s.status === 'current' }).length
      // 标签统计（含地图子票）与配色：票面最终色（工作区改色已在票面），不直读 palette
      // 两个都是「按标签名当键」的累加表：键要等遍历时才出现，所以只能标 : any，不能按 {} 字面量推断。
      const stat: any = {}, colorOf: any = {}
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
      if (snapLabels) snapLabels.forEach(function (l: any) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') })
      const allForColor = issues.slice()
      ;(st.snapshot && Array.isArray(st.snapshot.maps) ? st.snapshot.maps : []).forEach(function(m: any){(m.tickets||[]).forEach(function(t: any){allForColor.push(t)})})
      allForColor.forEach(function (x: any) {(x.labels||[]).forEach(function(l: any){const nm=l&&l.name?String(l.name).trim():'';if(!nm)return;stat[nm]=(stat[nm]||0)+1;if(l.color)colorOf[nm]=String(l.color).trim().replace(/^#/, '')})})
      const tagNames = Object.keys(stat).sort(function (a: any, b: any) { return stat[b] - stat[a] })
      // #375：全量 label（快照 labels 字段优先；旧快照无该字段降级 issue 统计）；配色按票面最终色已覆盖，缺失才用快照表
      const labelNames = snapLabels ? snapLabels.map(function (l: any) { return l.name }) : tagNames.slice()
      // 点击记忆双键排序：次数降序 → 最近点击降序 → 出现频次降序 → 名称序
      const sortedLabels = labelNames.slice().sort(function (a: any, b: any) {
        const ca = labelClicks[a], cb = labelClicks[b]
        const na = ca ? ca.n : 0, nb = cb ? cb.n : 0
        if (na !== nb) return nb - na
        const ta = ca ? ca.ts : 0, tb = cb ? cb.ts : 0
        if (ta !== tb) return tb - ta
        const fa = stat[a] || 0, fb = stat[b] || 0
        if (fa !== fb) return fb - fa
        return String(a).localeCompare(String(b))
      })
      // v15-26：主列表关联 map 子票阻塞信息（open 阻塞者才算阻塞；数据来自快照 maps.tickets.blockedBy，无需额外请求）
      // effort 维度：阻断表由共享函数产出（按票身份 (effort, 编号) 键入、阻塞引用只在同 effort 内解析）
      const blockOf = mapBlockOf(st.snapshot)
      // #544 独立票阻塞边：快照 issues 自带 blockedBy（列表查询片段已复用，零请求），
      // 只挂自己身上（已是地图子票的行跳过，不碰地图层级与计数），逻辑见 store-derived.applyStandaloneBlocks。
      // 此处不包 try：函数缺失说明构建拼接坏了，必须 loud；单票坏数据由函数内逐票兜底，不崩整表。
      applyStandaloneBlocks(st, blockOf)
      // #374：状态过滤（全部/Open/阻塞/已关闭）与 label 过滤叠加
      // v1.3.3 T3：blocked 过滤真正实现 —— open 且存在 open 阻塞者（blockOf 命中）
      const showOpen = st.stateFilter !== 'closed'
      const showClosedList = st.stateFilter === 'closed'
      // v1.5：多选标签过滤（OR 语义：命中任一选中标签即显示）
      const byLabel = function (x: any) {
        const ls = st.lblFilters || []
        if (!ls.length) return true
        const labs = x.labels || []
        if (!labs.length) return ls.indexOf('needs-triage') >= 0
        return labs.some(function (l: any) { return ls.indexOf(l.name) >= 0 })
      }
      // #1286：三段顺序 —— 探索地图 → 规格 → 普通票（容器组在前，普通票仍按面板排序档）
      const openRows = sortedMaps.concat(sortedSpecs).concat(sortedOpen).filter(effPass)
      const closedRows = closedSorted.filter(effPass)
      const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
      // v1.3.3 #6：阻塞 = 被占用口径（isOccupied：有 assignee 或存在 open 阻塞者）——与 KPI「占用 N」一致，
      //   用户点「阻塞」应筛出全部被占用项（此前 blockOf 只覆盖 map 子票的 blockedBy，漏掉 assignee 占用的）
      const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x: any) { return isOccupied(st, x) })
        : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x: any) { return !isOccupied(st, x) }) : openFiltered)) : []
      const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedRows.filter(byLabel) : closedRows) : []
      // KPI 口径：与全局一致，但跟随 effort 筛选（未选 effort 时就是全局）
      // #689：两个数字优先读宿主给的后端计数（deck.counts）—— 「已关闭」直接是它；「可接」= 后端说的未关闭
      //   张数减去本地数出来的阻塞（阻塞要逐票看指派人、看有没有开放阻塞者，后端计数给不了）。
      //   拿不到计数、或界面带着筛选时退回按池子派生：deckCountsOf 那时会返回 null（全仓数字与筛过的一屏
      //   不是一个口径），宁可退回派生值，也不拿全仓数字冒充筛过的数字。
      const kpiFiltered = !!((st.effFilters || []).length)
      const kpiCounts = deckCountsOf(st, kpiFiltered)
      const kpiOpenScoped = openIssuesOf(st).filter(effPass)
      const kpiOcc = kpiOpenScoped.filter(function (x: any) { return isOccupied(st, x) }).length
      const kpiFrontier = kpiCounts ? Math.max(0, kpiCounts.open - kpiOcc) : (kpiOpenScoped.length - kpiOcc)
      const kpiClosed = kpiCounts ? kpiCounts.closed : closedIssues.filter(effPass).length
      // 折叠行那两个数：N（一共多少张）来自后端计数、x（列表里已经加载了多少张）就是手上这些行。
      //   带任何筛选时 N 退回手上的行数 —— 后端给的是全仓总数，与筛过的列表对不上会让人以为少了票。
      const foldCounts = deckCountsOf(st, !!(((st.effFilters || []).length) || ((st.lblFilters || []).length)))
      const kpi = (num: any, lab: any, icon: any, color: any) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
      return h('div', null, [
        // v1.5：已选标签过滤条（仅标签 · 颜色 = 该标签配置色 · 点 ✕ 关闭）
        (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
          (st.lblFilters || []).map(function (nm: any, i: any) {
            const c = colorOf[nm]
            const hex = c ? '#' + c : '#bc8cff'
            return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
              nm,
              // 本次界面反馈需求：✕ 是一颗能点的小控件（去掉这一个标签的过滤），给它自己的按压态与点击日志；
              //   定位串用它在已选标签条里的序号（标签名可能是中文，进不了定位串）。
              h('span', chipProps({ 'data-press': 'chip', 'data-log': 'list.filter.remove.' + i, onClick: function (e: any) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x: any) { return x !== nm }); emit(st) }, 'aria-label': tr('list.filterRemoveAria', { name: nm }), style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }), '✕'),
            ])
          }),
          // 本次界面反馈需求：「清除」药丸能点（清空已选标签），给它自己的按压态与点击日志。
          h('span', chipProps({ key: 'f-label-clear', className: 'dsws-chip dsws-hov', 'data-press': 'chip', 'data-log': 'list.filter.clear', onClick: function (e: any) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }), tr('list.filterClear')),
        ]) : null,
        // B Timeline 定版（2026-08-28）：全屏红卡（NoRepoCard）不再挂载于列表页顶部——
        //   远端未关联/环境未就绪由检查页行内红卡表达，列表页保持 KPI + 列表（无顶部错误信息）
        // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
          kpi(kpiFrontier, tr('list.kpi.takeable'), 'target', '#4ade80'),
          kpi(kpiOcc, tr('list.kpi.occupied'), 'lock', '#f0883e'),
          kpi(kpiClosed, tr('list.kpi.closed'), 'check', '#52525b'),
          // #689 的 partial 状态不再单独占一格（橙色胶囊太抢眼，又长得像按钮但点不动）——
          //   改为数字右上角一颗 5px 圆点 + 悬浮说明追加一句（圆点是状态不是控件；竖条试过，太生硬）。
          h('span', { style: { flex: 1 } }),
          // #685：「体检」按钮 —— 贴这一行的右边缘（左三枚是读数、右边这颗是动作，用位置把两类分开；
          //   与页签行那枚刷新按钮形成「面板级操作都在右侧」的一致手势，#681 定版）。
          //   件数口径见 #678（未关闭 + 不是地图 + 不在任何地图的子票里，与列表里独立票的行数一致），
          //   算不出来时只显示名字、绝不显示 0；三种情况整颗不渲染（见 healthCheckVisible）。
          //   点一下开一个新会话并把当前后端的体检提示词带过去（讲清为什么见 openHealthCheck 里那段注释）。
          (function () {
            if (!healthCheckVisible(st)) return null
            const nHc = healthCheckCountOf(st)
            const isPartial = !!(st.snapshot && st.snapshot.deck && st.snapshot.deck.partial === true) // #689：行数据不全时数字右上角多一颗圆点，悬浮里追加一句（圆点是状态不是控件）
            const btnTier = (!narrow && tr('list.healthCheck').length > 6) ? '' : (nHc == null ? ' narrow-icon' : ' narrow-count')
            // 下面是「先定基线、再按 btnTier 覆盖个别字段」的写法：justifyContent 只在窄图标态才补上，
            //   按字面量推断会报「该属性不存在」，所以标 : any。
            const hcStyle: any = { display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none', alignSelf: 'center', fontSize: 11, padding: '1px 6px', background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.15)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', position: 'relative' }
            if (btnTier === ' narrow-icon') { hcStyle.padding = '0'; hcStyle.justifyContent = 'center' }
            else if (btnTier === ' narrow-count') { hcStyle.padding = '1px 5px'; hcStyle.gap = 2 }
            return h(Tip, { content: tr('list.healthCheckTitle') + (isPartial ? '\n' + tr('list.partialTitle') : '') }, h('button', {
              // 本次界面反馈需求：体检按钮带按压态与点击日志，点了它从日志一眼认出是它；
              //   窄态（narrow-icon）下它只剩一枚图标，按用户口径只给按压态、不给下沉位移。
              className: 'dsws-btn' + btnTier + (btnTier === ' narrow-icon' ? '' : ' dsws-hov'),
              'data-press': 'button',
              'data-log': 'list.healthcheck',
              onClick: function (e: any) { e.stopPropagation(); openHealthCheck(st) },
              style: hcStyle,
            }, [Ic({ n: 'clipboard', size: 11 }), (btnTier === ' narrow-count' || btnTier === '') ? h('span', null, tr('list.healthCheck') + (nHc == null ? '' : ' ' + nHc)) : null, (isPartial ? h('span', { 'aria-label': tr('list.partial'), style: { position: 'absolute', top: 1, right: 3, width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 0 1px rgba(0,0,0,.6)', pointerEvents: 'none' } }) : null)]))
          })(),
          // T2 #2：刷新按钮已上移至面板 tabs 行（页内浮窗退役后，面板只有右侧边栏这一处）
        ]),
        // B Timeline 定版（2026-08-28）：「N 项环境未就绪」红条已移除（顶部无错误信息；状态由检查页行级表达）
        // effort 筛选行（仅多 effort 仓库出现）：点一下只看某个 effort，再点取消；与状态/label 过滤叠加
        multiEffort ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
          h('span', chipProps({ key: 'eff-all', className: 'dsws-chip dsws-hov', 'data-press': 'chip', 'data-log': 'list.effort.all', onClick: function (e: any) { e.stopPropagation(); st.effFilters = []; emit(st) }, style: { cursor: 'pointer', fontSize: 10, background: !(st.effFilters || []).length ? 'rgba(88,166,255,.18)' : 'rgba(255,255,255,.06)', color: !(st.effFilters || []).length ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (!(st.effFilters || []).length ? 'rgba(88,166,255,.6)' : 'rgba(255,255,255,.15)') } }), tr('list.all')),
          effortNames.map(function (nm: any, i: any) {
            const on = (st.effFilters || []).indexOf(nm) >= 0
            // 本次界面反馈需求：effort 药丸能点（只看某个 effort），给它自己的按压态与点击日志；
            //   定位串用序号（effort 名可能是任意字符，进不了定位串）。
            return h(Tip, { content: nm }, h('span', chipProps({ key: 'eff-' + nm, className: 'dsws-chip dsws-hov', 'aria-label': nm, 'data-press': 'chip', 'data-log': 'list.effort.' + i, onClick: function (e: any) {
              e.stopPropagation()
              const cur = st.effFilters || []
              st.effFilters = on ? cur.filter(function (x: any) { return x !== nm }) : cur.concat([nm])
              emit(st)
            }, style: { cursor: 'pointer', fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: on ? 'rgba(88,166,255,.18)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.6)' : 'rgba(255,255,255,.15)') } }), nm))
          }),
        ]) : null,
        listFilterRowNode(h, st, colorOf, sortedLabels),
        // #690：历史票翻页那一行 —— 「已加载 x / 共 N」、翻页位置失效、取不到、后端不支持翻页各说各的
        //   （出处见 views/ListTabClosed.js 的注释；x 与折叠行那两个数同源：就是当前列表里真的画出来的行数）。
        closedPagesNode(h, st, closedRows.length),
        // T3 #5：加载遮罩（替代单行文本，全屏遮罩 + 禁点）
        // v1.3.3 修复：加载遮罩仅首开无数据时显示（手动刷新已走静默路径，不再叠加）
        // #58 缓存优先：已有快照（本 store 或 per-cwd 缓存）时不显示全屏 loading，秒开旧列表 + 后台静默刷新；行形骨架见 #953（同一时刻只用一个主力过程）。
        // #1302：遮罩里不再画五根写死宽度的灰条，改成照真实行的形状画（listSkeletonNode，形状真源在 ListTabRow.ts），
        //   从列表区顶部往下排；「加载中」那句留在最上面当一句说明，不再居中堆在骨架中间。
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 8, padding: '10px 0 0', overflow: 'hidden', zIndex: 5, pointerEvents: 'auto' } }, [
          h('span', { style: { fontSize: 12, color: '#e6edf3', textAlign: 'center', flex: 'none', padding: '0 0 6px' } }, tr('list.loading')),
          listSkeletonNode(h, 8),
        ]) : null,
        (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
        // #715（诚实显示）：这一行说清「这份数据多新、上次刷新成不成、现在是不是降级」。取数时刻取快照的 generatedMs（不是渲染时刻）；判据与词条见 views/shared/truthLines.js，没有事实的那句不画（不替宿主编事实）。
        (function () {
          // 2026-09-22 维护者定：「上次更新」那一条搬去面板头部第一行右侧那个小时间标签（panel/Dock.js），这一行从此只说其余那些状态句（刷新失败 / 已暂停 / 落后 / 已推后 / 未在刷新…），同一条信息不再出现两次。
          const ls = truthNoticeLines(st, Date.now())
          if (!ls.length) return null
          const tone = function (t: any) { return t === 'red' ? '#f87171' : (t === 'yellow' ? '#f59e0b' : 'var(--dsws-label-caption,#8b8b95)') }
          return h('div', { className: 'dsws-truth', style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 11, padding: '2px 2px 4px' } }, ls.map(function (ln: any) { return h('span', { key: ln.kind || ln.key, style: { color: tone(ln.tone) } }, tr(ln.key, ln.params)) }))
        })(),
        // v1.5 B5 降级横幅：走 REST 通道取回来的那份数据要明说 —— 判据（restFallbackView）与画法都在 views/shared/RestFallbackBanner.js。
        h(RestFallbackBanner, { key: 'restFallback', st: st }),
        // #374：状态过滤渲染 —— open 主体 / closed 列表 / 「全部」态保留已关闭折叠行
        showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x: any) { return listIssueRow(h, st, x, true, narrow, blockOf, colorOf, multiEffort) })) : null,
        showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x: any) { return listIssueRow(h, st, x, false, narrow, blockOf, colorOf, multiEffort) })) : null,
        // v14-4⑤：列表底部「已关闭 (N)」折叠行（仅「全部」状态显示；默认收起，只占一行，展开可见）
        // #689：文案改成「已关闭 N（已加载 x）」—— N 是后端计数说的总数，x 是列表里真加载到的行数；
        //   两个不一样时（本仓现在就是）用户一眼能看出「还有多少没装进来」，而不是以为列表就是全部。
        (st.stateFilter === 'all' && closedRows.length) ? h('details', { style: { marginTop: 8 }, onToggle: function (e: any) { const open = !!(e && e.target && e.target.open); st.closedFoldOpen = open; emit(st); if (open) loadIssuePage(st, { view: 'list' }) } }, [
          // 本次界面反馈需求：折叠条能点（展开已关闭列表），给它自己的按压态与点击日志。
          h('summary', { className: 'dsws-hov', 'data-press': 'button', 'data-log': 'list.fold.closed', style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
            Ic({ n: 'check', size: 11 }),
            h('span', null, tr('list.closedN', { n: foldCounts ? foldCounts.closed : closedRows.length, x: closedRows.length })),
          ]),
          h('div', null, closedRows.map(function (x: any) { return listIssueRow(h, st, x, false, narrow, blockOf, colorOf, multiEffort) })),
        ]) : null,
      ])
    }
