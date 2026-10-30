/**
 * views/IssueDetail.ts — Issue 详情页（独立叶模块 · v1.7.0 T1/T2/T3）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 对应叶标记处（源码树里只有这一份真源）。
 * 设计约束：每个模块可独立并发开发 — 本文件仅依赖内核 seam（store/router/api/locale/shared组件），
 * 同层禁止 import 其他视图（ListTab/MapDetail 等），像插件般隔离；所有共享能力经 DswsCtx 取用。
 * T2 数据通路：fetchIssueDetail(n)（GraphQL+REST 双通道，host 侧 wf.issueDetail），60s 缓存命中即用，loading/real/err 三态。
 * 本文件由 .js 转来（转时只加类型标注与环境声明，行为一字不动）。
 */
declare function peekNav(...args: any[]): any;
declare function repoStr(...args: any[]): any;
declare function buildColorOf(...args: any[]): any;
declare function fetchIssueDetail(...args: any[]): any;
declare function useIssueDetailFold(...args: any[]): any;
// #1573：失败横幅三块（主行一句话 / kind 小标签 / 原始说明折叠区）的显示口径在 views/issueDetailErrorView.ts。
declare function issueErrorViewOf(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function popNav(...args: any[]): any;
declare function prStateKind(...args: any[]): any;
// #1668：详情顶栏动作按钮能不能点（票已关闭/已合并就压灰）的判据住在 kernel/detail-top-gate.ts。
declare function detailTopGate(...args: any[]): any;
declare function effortNamesOf(...args: any[]): any;
// #1511 / #1564：号码写成「#目录/编号」的显示规则住在 kernel/ticket-label.ts，整颗徽标的画法（四种外壳）
//   收在 views/shared/ticketBadge.ts；详情页头只提供票身份与状态色。
declare function ticketBadgeOf(...args: any[]): any;
declare function rowActionText(...args: any[]): any;
declare function rowActionKind(...args: any[]): any;
declare function actionColorOf(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare function findMapByIdentity(...args: any[]): any;
// #1286 收口：规格容器若被当票详情打开（旧导航或直接链接），顶栏按钮要走容器三态，不能按标签算实施票。
declare function containerKindOf(...args: any[]): any;
declare function containerStateOf(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function pushNav(...args: any[]): any;
declare function copyText(...args: any[]): any;
declare function openInNewSession(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function mdToHtml(...args: any[]): any;
declare function hexA(...args: any[]): any;
declare function darken(...args: any[]): any;
declare function idOfParts(...args: any[]): any;
declare function renderIssueDetailComments(...args: any[]): any;
// 子票/阻塞票的分流判定住在 views/subIssueRouting.ts；签名 (st, 子票节点, effort) 与那里一致。
declare function enterSubDetail(st: any, x: any, issueEffort: any): void;
declare function mdImgOverlay(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function openIssueUrl(...args: any[]): any;
// #1557：票与容器的打开方式由后端声明（openIssue / openContainer），视图只问该画链接还是按钮、
// 点下去走哪个打开动作，不再自己按地址前缀分流。
declare function openModeFor(...args: any[]): any;
declare function openTrackerTarget(...args: any[]): any;
declare function Ic(props?: any): any;
declare const Tip: any;
// 详情页确认提示的停留时间（毫秒）。数值写在 config/ttl.yaml 的 issueDetailConfirmMs，
// 构建时由生成器变成常量拼进界面闭包；这里的 declare 只是让 TypeScript 知道这个名字存在。
declare const ISSUE_DETAIL_CONFIRM_MS: number;
declare const CONTAINER_ACCENT: any;
declare const MOTION: any; // #1236 动效时长统一在 kernel/motion.ts，本文件只引用不写真值
export const IssueDetail = function (props: any): any {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const st = props.st
      // T4 #554：当前工单编号读栈顶（栈顶是工单才取，旧镜像兜底保证旧状态不崩）。
      // 平时镜像与栈顶一致，取值与原来一样；取数与评论通路不动。
      const navTop0 = (typeof peekNav === 'function') ? peekNav(st) : null
      const issueNumber = (navTop0 && navTop0.kind === 'issue') ? navTop0.n : st.activeIssue
      // effort 维度：本票所属 effort（同号票在不同 effort 里是两张票，取数/评论/外链都要带上）
      const issueEffort = (navTop0 && navTop0.kind === 'issue') ? ((navTop0.effortId !== undefined && navTop0.effortId !== null) ? String(navTop0.effortId) : '') : (st.activeEffortId ? String(st.activeEffortId) : '')
      const repoStrLocal = repoStr(st)
      const colorOf = (typeof buildColorOf === 'function') ? buildColorOf(st) : {}
      // 本地容器的编号是 0（key 00），是合法坐标：只拦缺席、空串与非数字，不拦 0。
      if (issueNumber === undefined || issueNumber === null || issueNumber === '' || Number.isNaN(Number(issueNumber))) return null
      // 触发拉取（缓存命中则同步回 real，不多发请求；force 重试由按钮控制）
      React.useEffect(function () {
        if (issueNumber === undefined || issueNumber === null || issueNumber === '' || Number.isNaN(Number(issueNumber))) return
        if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { effortId: issueEffort })
      }, [issueNumber, issueEffort, st.cwd])
      // #255 提交确认闪烁定时清除（类 rowFlash 同语义，防堆积；置于 early-return 之前保 hooks 顺序恒定）
      React.useEffect(function () {
        if (!st.cmtConfirm) return undefined
        // 确认提示的停留时间：提交成功后那句确认话在这里挂多久，到点自动撤掉，免得一直留着。
        const t = setTimeout(function () { st.cmtConfirm = null; emit(st) }, ISSUE_DETAIL_CONFIRM_MS)
        return function () { clearTimeout(t) }
      }, [st.cmtConfirm])
      // #763 顶栏折叠机（hook 在 views/useIssueDetailFold.js；返回优先收到图标，一次折一个，不放省略号）
      const topBarRef = useIssueDetailFold(st, issueNumber, issueEffort)
      // 详情缓存按 (effort, 编号) 键入；比对时 effort 一致才算同一张票（缺字段的旧详情按编号兜底）
      const detail = (st.issueDetail && st.issueDetail.number === issueNumber && (st.issueDetail.effortId === undefined || String(st.issueDetail.effortId) === issueEffort)) ? st.issueDetail : null
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      const snapIssue = issues.find(function (x: any) { return x.number === issueNumber && effortOf(x) === issueEffort }) || issues.find(function (x: any) { return x.number === issueNumber })
      // #693 取数口径：快照那一行只当**轻量预览**用（标题、状态、标签、指派人、被阻塞、
      //   是不是拉取请求这些），**正文与评论一律以详情自己那次取数为准**。
      //   理由：快照那一行可能是不带正文、也不带评论的薄片段（阶段 2 的历史行就是这样），
      //   拿它当「没有」会把「还没拿到」说成「实际上没有」—— 那是说假话。
      //   顶部仍先用快照那一行画出来（秒开，#58 的成果保留），下面 src 只用来画这些轻量字段。
      const src = detail || snapIssue
      const mode = st.issueMode || 'idle'
      const err = st.issueError
      // #1573：失败横幅要用的三块（主行一句话 / kind 小标签 / 原始说明折叠区）住在 views/issueDetailErrorView.ts
      // （从本文件抽出，本文件贴着 350 行上限）；这里算一次，两处横幅共用。
      const errView = err ? issueErrorViewOf(h, err) : null
      // T4 #554：返回只弹一层（上一级是地图就回到该地图，是工单就回到该工单，
      // 栈空才回列表）。直接调弹栈，不经过按种类守卫的旧入口，混合栈也只退一级。
      const goBack = function () { popNav(st) }
      const doRetry = function () { if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { force: true, effortId: issueEffort }) }
      // #1111 · 失败横幅三小块（主行/档位小标签/原文折叠区）的显示口径统一在 views/issueDetailErrorView.ts 里算，
      // 这里只拿结果；errView 在上面按 st.issueError 算好，两处横幅共用同一份。
      const copyUrl = function (n: any) {
        const url = issueUrlFor(st, n, issueEffort)
        copyText(st, url, tr('toast.copiedLink', { n: n }))
      }
      // parent map ribbon（从快照探测，若 detail 含 subIssues 则优先 detail）
      const parentMap = (function () {
        const maps = (st.snapshot && st.snapshot.maps) || []
        for (let mi = 0; mi < maps.length; mi++) {
          const m = maps[mi]
          const hits = (m.tickets || []).some(function (t: any) { return t.number === issueNumber && effortOf(t) === issueEffort })
          if (hits) return m
        }
        return null
      })()
      // T4 #554 面包屑：只看直接上一级与当前级。栈里有上一级时显示“上一级编号 / 当前编号”
      // （从地图进来就是“地图编号 / 工单编号”）；栈深超过两级时更早的层折成一行省略号，
      // 只留直接上一级与当前级；只有一级（从列表进来）时只显示当前编号（#763 C 方案，“列表”二字多余）；
      // 先后经过同一编号（例如 A→B→A）不合并，返回时逐级经过，面包屑照常显示直接上一级。
      // 面包屑就是顶栏里那串编号字（原来叫“列表 / #758”）。窄宽度下它第一个逐字变短，完整串留悬停。
      const navCrumb = (function () {
        let arr = null
        try { arr = (st && Array.isArray(st.navStack)) ? st.navStack : null } catch (e) { arr = null }
        if (arr && arr.length >= 2) {
          const parent = arr[arr.length - 2]
          const head = arr.length > 2 ? '… / ' : ''
          return head + '#' + parent.n + ' / #' + issueNumber
        }
        return '#' + issueNumber
      })()
      // 子票/阻塞票的分流判定整族已移到 views/subIssueRouting.ts（函数名 enterSubDetail 与原文一致），
      // 判断细节（标签优先、无标签按快照找图、effort 继承）写在那份文件里；这里只负责传当前票的 st 与 effort。
      // loading（首拉无缓存且无 snap 降级）
      if (mode === 'loading' && !src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', 'data-press': 'button', 'data-log': 'issue.top.back', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
            h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, navCrumb),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, [h('div', { className: 'dsws-spinner', style: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.15)', borderTopColor: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', borderRadius: '50%', animation: 'dsws-spin ' + MOTION.inlineSpinnerMs + 'ms linear infinite' } }), h('span', null, tr('list.loading'))]),
        ])
      }
      // err 无 src（且非 snap 降级可显）→ 错误横幅
      if (mode === 'err' && !src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', 'data-press': 'button', 'data-log': 'issue.top.back', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
            h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, navCrumb),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '12px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, fontSize: 12, color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { wordBreak: 'break-word' } }, (errView ? errView.say : '')),
              (errView ? errView.kind : '') ? h('span', { style: { fontSize: 10, padding: '0 6px', border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, flex: 'none' } }, (errView ? errView.kind : '')) : null,
              h('span', { style: { flex: 1 } }),
              // 本次界面反馈需求：错误态里「重试」与「在追踪器中查看」是用户此时仅有的两个出口，
              //   各自带按压态、悬停反馈与点击日志；附近没有带 data-log 的祖先，不接就完全没有日志。
              h('button', { className: 'dsws-btn primary dsws-hov', 'data-press': 'button', 'data-log': 'detail.err.retry', onClick: doRetry, style: { padding: '1px 8px', fontSize: 11, background: '#f87171', borderColor: 'transparent', color: '#fff' } }, '重试'),
                            // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
              (function () {
                const _u = issueUrlFor(st, issueNumber, issueEffort)
                const _isUrl = openModeFor(st, 'issue', _u) === 'url'
                const _openLocal = function (e: any) { e.stopPropagation(); openTrackerTarget(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), issueEffort, 'issue') }
                const _props = { className: 'dsws-btn ghost dsws-hov', style: { padding: '1px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 } }
                const _kids = [Ic({ n: 'link', size: 11 }), h('span', null, tr('detail.viewOnTracker'))]
                // 本次界面反馈需求：网页与本地两条分支各带一个定位串，日志里能认出点的是哪一条；
                //   定位串里不写票号以外的内容，票号是自由文本之外的标识仍不入串。
                return _isUrl
                  ? h('a', Object.assign({ href: _u, target: '_blank', rel: 'noreferrer', 'data-press': 'link', 'data-log': 'detail.err.open' }, _props), _kids)
                  : h('button', Object.assign({ type: 'button', onClick: _openLocal, 'data-press': 'button', 'data-log': 'detail.err.open.local' }, _props), _kids)
              })(),
            ]),
            (errView ? errView.rawBlock : null),
          ]),
        ])
      }
      // src 兜底缺失（snap 与 detail 均无）→ 轻量占位（可能为历史 closed 未加载全量，已在 loading 分支处理，此处为缺口保护）
      if (!src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', 'data-press': 'button', 'data-log': 'issue.top.back', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
            h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, navCrumb),
          ]),
          h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 12 } }, tr('detail.bodyNotYet')),
        ])
      }
      const labels = (src.labels && src.labels.nodes) ? src.labels.nodes : (src.labels || [])
      const labelArr = Array.isArray(labels) ? labels : []
      const assigneesRaw = (src.assignees && src.assignees.nodes) ? src.assignees.nodes : (src.assignees || [])
      const assignees = Array.isArray(assigneesRaw) ? assigneesRaw : []
      const stateRaw = src.state || 'OPEN'
      // #599：状态显示三种（打开 / 已关闭 / 已合并）。两种来源都是契约形状（已合并的收成「已关闭」、
      //   合并时间留在 mergedAt），所以判据只看合并时间 —— 那判据收在 views/shared/stateKind.js，
      //   与拉取请求页共用一份，本文件不再自己判。
      const stateKind = prStateKind(src)
      const isOpen = stateKind === 'open'
      const isMerged = stateKind === 'merged'
      const stateColor = isOpen ? '#3fb950' : (isMerged ? ((typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '') : '#8b949e')
      const stateLabel = isOpen ? tr('list.state.open') : (isMerged ? tr('list.state.merged') : tr('list.state.closed'))
      const title = src.title || ('#' + issueNumber)
      // 2026-10-26 维护者要求：effort 徽标先整体隐藏，代码保留、不删除。
      //   背景：#1511 起顶栏标题行的编号已经写成「#目录/01」，这枚徽标写的目录名与它重复。
      //   改回 true 即恢复显示（三处同名开关：ListTabRow、本文件、MapDetailHead）。
      const SHOW_EFFORT_BADGE = false
      // effort 维度：详情页标出这张票属于哪个 effort（只在多 effort 仓库出现，单 effort 界面不变）
      const effortChip = (SHOW_EFFORT_BADGE && issueEffort && effortNamesOf(st).length > 1) ? h(Tip, { content: issueEffort }, h('span', { className: 'dsws-chip dsws-eff', 'aria-label': issueEffort, style: { fontSize: 10, lineHeight: 1.6, padding: '0 6px', flex: 'none', maxWidth: 140, overflow: 'hidden', whiteSpace: 'nowrap', background: 'rgba(88,166,255,.14)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)' } }, issueEffort)) : null
      // #693 正文格：**只有详情回来了才能说「无描述」**。详情没回来时说加载中，取不到时说「还没拿到」。
      //   取数失败的失败原因与重试在页面顶部那条横幅上（这里不重复放一个按钮）。
      const bodySlot = detail
        ? ((detail.body && String(detail.body).trim())
            ? h('div', { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, (typeof mdToHtml === 'function' ? mdToHtml(detail.body, { st: st }) : String(detail.body)))
            : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('detail.noBody')))
        : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-caption,#8b8b95)', display: 'flex', alignItems: 'center', gap: 6 } }, [
            mode === 'err' ? null : h('div', { className: 'dsws-spinner', style: { width: 11, height: 11, border: '2px solid rgba(255,255,255,.15)', borderTopColor: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', borderRadius: '50%', animation: 'dsws-spin ' + MOTION.inlineSpinnerMs + 'ms linear infinite' } }),
            h('span', null, mode === 'err' ? tr('detail.bodyNotYet') : tr('list.loading')),
          ])
      const has = function (nm: any) { return labelArr.some(function (l: any) { return (l.name || l) === nm }) }
      const _isTriageLikeLocal = !labelArr.length || has('needs-triage')
      // #1595：这个假票对象会走行动作那条注入链（rowActionText 按 effort 取链接），必须带上本票所属 effort，否则多 effort 仓库里注入的链接会指到别的目录。
      const fakeIssue = { number: issueNumber, ['title']: title, labels: labelArr.map(function (l: any) { return typeof l === 'string' ? { name: l } : l }), state: stateRaw, effortId: issueEffort }
      // #1286 收口：这一页正常是「票详情」，规格本该进容器详情；万一被旧导航或直接链接当票打开，
      //   顶栏按钮也不能按标签把规格当实施票（注入 /implement），按快照里的容器身份走三态口径。
      const containerInfo = (function (): any {
        try {
          if (typeof findMapByIdentity !== 'function' || typeof containerKindOf !== 'function') return null
          const c: any = findMapByIdentity(st.snapshot && st.snapshot.maps, issueNumber, issueEffort)
          if (!c) return null
          const k: any = containerKindOf(c)
          if (!k) return null
          return { kind: k, state: (typeof containerStateOf === 'function') ? containerStateOf(c) : 'open', c: c }
        } catch (e) { return null }
      })()
      // #763 顶栏主动作按钮：与列表行同口径（图标/文字/注入文本），但自建按钮以便折叠机逐字裁字。
      // 复用行动作的注入文本，不复用它的按钮节点（那个节点写死 flex:none，折叠机裁不动它）。
      // #771 分类走一处 rowActionKind（状态优先于类型：未分流 → 接手 → 补充 → 修复 → 讨论 → 研究 → 原型 → 执行）。
      const primaryInfo = (function () {
        let text = ''
        try { text = (typeof rowActionText === 'function') ? rowActionText(st, fakeIssue) : '' } catch (e) { text = '' }
        // #1286 收口：容器（规格/地图）的顶栏主动作按三态取图标、文字与悬停，注入文本已由 rowActionText 走容器口径。
        if (containerInfo && typeof containerTriState === 'function') {
          try {
            const tri: any = containerTriState(containerInfo.kind, containerInfo.state)
            return { icon: tri.icon, label: tr(tri.labelKey), tip: tr(tri.titleKey), text: text }
          } catch (eC) {}
        }
        let kind = ''
        try { kind = (typeof rowActionKind === 'function') ? rowActionKind(fakeIssue) : '' } catch (eK) { kind = '' }
        let icon = 'play', label = ''
        try {
          if (!kind) {
            if (_isTriageLikeLocal) kind = 'diagnose'
            else if (has('ready-for-human')) kind = 'takeover'
            else if (has('needs-info')) kind = 'supplement'
            else if (has('bug')) kind = 'fix'
            else if (has('wayfinder:grilling')) kind = 'discuss'
            else if (has('wayfinder:research')) kind = 'research'
            else if (has('wayfinder:prototype')) kind = 'prototype'
            else kind = 'execute'
          }
          if (kind === 'diagnose') { icon = 'chat'; label = tr('act.diagnose') }
          else if (kind === 'takeover') { icon = 'play'; label = tr('act.takeover') }
          else if (kind === 'supplement') { icon = 'play'; label = tr('act.supplement') }
          else if (kind === 'fix') { icon = 'hammer'; label = tr('act.fix') }
          else if (kind === 'discuss') { icon = 'chat'; label = tr('act.discuss') }
          else if (kind === 'research') { icon = 'search'; label = tr('act.research') }
          else if (kind === 'prototype') { icon = 'prototype'; label = tr('act.prototype') }
          else { icon = 'play'; label = tr('act.execute') }
        } catch (e) {}
        let tip = label
        try {
          if (label === tr('act.diagnose')) tip = tr('tip.diagnose')
          else if (label === tr('act.takeover')) tip = tr('tip.takeover')
          else if (label === tr('act.supplement')) tip = tr('tip.supplement')
          else if (label === tr('act.fix')) tip = tr('tip.fix')
          else if (label === tr('act.discuss')) tip = tr('tip.discuss')
          else if (label === tr('act.research')) tip = tr('tip.research')
          else if (label === tr('act.prototype')) tip = tr('tip.prototype')
          else if (label === tr('act.execute')) tip = tr('tip.execute')
        } catch (e2) {}
        return { icon: icon, label: label, tip: tip, text: text }
      })()
      let actColor = (typeof actionColorOf === 'function') ? actionColorOf(fakeIssue, colorOf) : stateColor
      // #1286 收口：容器被当票详情打开时，顶栏主按钮底色也取容器三态色（拆票橙 / 执行蓝 / 完成绿）。
      try {
        if (containerInfo && typeof containerTriState === 'function') {
          const _tri: any = containerTriState(containerInfo.kind, containerInfo.state)
          if (_tri && _tri.color) actColor = _tri.color
        }
      } catch (eAC) {}
      const actTextColor = (typeof isLightHex === 'function' && isLightHex(actColor)) ? '#140a1e' : '#ffffff'
      const subNodes = (src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : []
      const subTotal = (src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length
      const blockedNodes = (src.blockedBy && src.blockedBy.nodes) ? src.blockedBy.nodes : []
      // #1668 / #1669：顶栏两颗动作按钮同进退。被阻塞清单只认详情回包那一份（列表快照可能整块没有），
      //   没取到就当没有；判据与原因收在 kernel/detail-top-gate.ts，本文件不自己判。
      const topGate = detailTopGate(src, (detail && detail.blockedBy && detail.blockedBy.nodes) ? detail.blockedBy.nodes : [])
      // 悬停只喊一条原因：票已关闭（含已合并）说「已关闭」；被没做完的票阻塞则点名票号，
      //   票号升序与顿号都来自判据和词表，这里只负责拼句。可点时这句话不用（按钮各有原来的说明）。
      const gateTip = topGate.clickable ? '' : (topGate.reason === 'blocked'
        ? tr('tip.detailBlockedBy', { n: topGate.blockedNumbers.map(function (x: any) { return '#' + x }).join(tr('tip.detailBlockedByJoin')) })
        : tr('tip.detailClosedReadonly'))
      // #693 评论也只认详情那次取数：快照那一行可能不带评论，拿它当「没有评论」会说错话。
      // #1519：详情回包里的评论只有一种形状 —— GraphQL 连接 {nodes, pageInfo}。宿主
      // src/refresh/rooms/host/comment-thread-fetch.ts 的 handleIssueDetail 与旧路 issue-detail-fetch.ts
      // 都按这个形状交回来。界面这边不再兼容数组：多留一条数组分支，只会让「宿主换了形状」这种错
      // 在界面被悄悄兜住、然后显示成「评论 (0)」——那正是 #1519 之前的样子。
      const rawComments = detail ? detail.comments : undefined
      // 同一条判据只算一次：形状对不对（是不是连接）既决定画不画评论列表，也决定显不显示输入框。
      // 名字沿用 rawComments：门禁 tests/verify-issue-comment.ts 会从构建产物里按这个名字切出判据求值。
      let canComment = !!rawComments && Array.isArray(rawComments.nodes)
      const commentsNodes = canComment ? rawComments.nodes : []
      const isStale = !detail && !!snapIssue
      // ======== #255 · 评论输入区（GitHub 单点 · MISSING 零分支）========
      // 显隐以能力字段有无判：comments 存在即渲染（EMPTY=[] 渲染、MISSING=省略 不渲染），
      // 零后端身份分支。形状只认 GraphQL 连接一种，理由同上（#1519）。
      // #693：这个「能力字段」同样只看详情带回来的那一份（rawComments），不看快照那一行。
      // #506 首版只读：拉取请求详情只看评论列表，不给输入框（快照与详情任一来源标为拉取请求即只读；评审合并展示留后续，#507 再验）。
      const fromPullRequest = (src && src.isPullRequest === true) || (snapIssue && snapIssue.isPullRequest === true)
      if (fromPullRequest) canComment = false
      // #693：底部那句「只读」只在**确实不能评论**时才说。详情还没回来时 canComment 也是假
      //   （手上根本没有这份数据），但那只是「还没拿到」，不是「不能评论」——
      //   拉取请求，或详情回来说这个后端不带评论能力，才算真只读。
      const readOnlyKnown = fromPullRequest || (!!detail && !canComment)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        // 顶部固定行（#565 粘性固定，随滚动保持可见；#763 单行逐字折叠：越窄越收，只剩图标，不放省略号）
        // 折叠顺序：返回按钮的字先收（返回列表→返回→只剩图标），再收面包屑，再收快照提示，
        // 再收主动作按钮的字，最后收新会话按钮的字；一次只折一个控件，直至只剩图标再折下一个。
        // 宽度只由阶梯改字数决定，CSS 不并行收缩（除中间空隙外全 flex:none），所以不会多按钮同时半截。
        // 图标永不消失；看不见的字直接裁掉，不补省略号；完整串留悬停。
        h('div', { ref: topBarRef, className: 'dsws-stickybar', 'data-detail-topbar': 1, style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
          // 返回按钮的悬停提示走 Tip（T2/T3 纪律），不再用原生 title
          h(Tip, { content: tr('list.back') }, h('button', { className: 'dsws-btn', 'data-press': 'button', 'data-log': 'issue.top.back', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))])),
          h(Tip, { content: navCrumb }, h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' } }, navCrumb)),
          effortChip,
          h('span', { style: { flex: 1, minWidth: 8 } }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', minWidth: 0, overflow: 'hidden', flexWrap: 'nowrap' } }, [
            detail ? h('span', { 'data-detail-snapshot': 1, 'data-full': (isStale ? '快照' : (mode === 'loading' ? tr('list.loading') : '')), style: { fontSize: 10, color: isStale ? '#f59e0b' : '#8b8b95', flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, isStale ? '快照' : (mode === 'loading' ? tr('list.loading') : '')) : null,
            // 交互决策 6：这两颗按钮不可点时，点击不该被记进日志。点击日志挂在 document 捕获阶段的委托上，
            //   它见到带 data-log 的元素就写一条 ui.action；所以压灰状态下干脆不挂 data-log（值给 undefined，
            //   不是空串），可点时才挂回原来的两个枚举值。data-press 照旧挂着：它管的是按压形状，与日志无关。
            h(Tip, { content: topGate.clickable ? primaryInfo.tip : gateTip }, h('button', { className: 'dsws-btn primary', 'data-press': 'button', 'data-log': topGate.clickable ? 'issue.top.exec' : undefined, 'aria-disabled': topGate.clickable ? undefined : 'true', tabIndex: topGate.clickable ? undefined : -1, onClick: function (e: any) { e.stopPropagation(); if (!topGate.clickable) return; try { inject(st, primaryInfo.text) } catch (err2) {} }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, background: topGate.clickable ? actColor : undefined, borderColor: 'transparent', color: topGate.clickable ? actTextColor : undefined, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: primaryInfo.icon, size: primaryInfo.icon === 'prototype' ? 12 : 10 }), h('span', { 'data-detail-primary-text': 1, 'data-full': primaryInfo.label, style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, primaryInfo.label)])),
            h(Tip, { content: topGate.clickable ? tr('tip.newSession', { n: issueNumber }) : gateTip }, h('button', { className: 'dsws-btn primary', 'data-press': 'button', 'data-log': topGate.clickable ? 'issue.top.newsession' : undefined, 'aria-disabled': topGate.clickable ? undefined : 'true', tabIndex: topGate.clickable ? undefined : -1, onClick: function (e: any) { e.stopPropagation(); if (!topGate.clickable) return; openInNewSession(st, { number: issueNumber, ['title']: title, labels: labelArr, effortId: issueEffort }) }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, background: topGate.clickable ? actColor : undefined, borderColor: 'transparent', color: topGate.clickable ? actTextColor : undefined, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'external-link', size: 10 }), h('span', { 'data-detail-new-text': 1, 'data-full': tr('list.newSessionLabel'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.newSessionLabel'))])),
            h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', 'data-press': 'icon', 'data-log': 'issue.top.copy', onClick: function (e: any) { e.stopPropagation(); copyUrl(issueNumber) }, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 }))),
                        // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
            h(Tip, { content: tr('tip.openInTracker', { n: issueNumber }) }, (function () {
              const _u = issueUrlFor(st, issueNumber, issueEffort)
              const _isUrl = openModeFor(st, 'issue', _u) === 'url'
              const _openLocal = function (e: any) { e.stopPropagation(); openTrackerTarget(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), issueEffort, 'issue') }
              const _props = { className: 'dsws-btn ghost', 'data-press': 'icon', 'data-log': 'issue.top.link', style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }
              return _isUrl
                ? h('a', Object.assign({ href: _u, target: '_blank', rel: 'noreferrer' }, _props), Ic({ n: 'link', size: 13 }))
                : h('button', Object.assign({ type: 'button', onClick: _openLocal }, _props), Ic({ n: 'link', size: 13 }))
            })()),
          ]),
        ]),
        // 顶部 err 横幅（有 src 时可重试，不遮挡主体）：主行给人看的一句话，档位作可选小标签，原文可展开
        // #1379 收口：横幅挂稳定类名，浅色层才有选择器可命中（颜色字面量不动，深色照旧走内联色）。
        mode === 'err' && err ? h('div', { className: 'dsws-detail-err', style: { padding: '8px 10px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 6, fontSize: 11, color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', { style: { wordBreak: 'break-word' } }, (errView ? errView.say : '')),
            (errView ? errView.kind : '') ? h('span', { style: { fontSize: 10, padding: '0 6px', border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, flex: 'none' } }, (errView ? errView.kind : '')) : null,
            h('span', { style: { flex: 1 } }),
            // 本次界面反馈需求：顶部错误横幅的「重试」与详情页错误态的「重试」会出现在同一屏，
            //   两处定位串必须不同，否则日志分不出是哪一颗被点了。
            h('button', { className: 'dsws-btn dsws-hov', 'data-press': 'button', 'data-log': 'detail.err.retry.banner', onClick: doRetry, style: { padding: '1px 6px', fontSize: 11 } }, '重试'),
            // #1379 收口：这句「显示快照降级」也压在 8% 红底上（原色是写死的警告橙，只有约 2:1），同样挂类名走浅色层。
            !detail && snapIssue ? h('span', { className: 'dsws-detail-err-degraded', style: { fontSize: 10, color: '#f59e0b' } }, '（显示快照降级）') : null,
          ]),
          (errView ? errView.rawBlock : null),
        ]) : null,
        // header
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 } }, [
          // header（#1564：上限宽度、两段布局与悬停都走共用徽标组件，本处只给票身份与状态色）
        ticketBadgeOf(h, { key: src.key != null ? src.key : issueNumber, effortId: issueEffort, surface: 'badge', color: actColor }),
          h(Tip, { className: 'dsws-tip', content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 14, fontWeight: 600 } }, title)),
          h('span', { className: 'dsws-chip', style: { fontSize: 10, background: isOpen ? 'rgba(63,185,80,.15)' : 'rgba(139,148,158,.15)', color: stateColor, border: '1px solid ' + stateColor, flex: 'none' } }, [Ic({ n: isOpen ? 'dot' : 'check', size: 9 }), h('span', { style: { marginLeft: 3 } }, stateLabel)]),
        ]),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
          labelArr.map(function (l: any, i: any) {
            const nm = l.name || l
            const col = l.color || ''
            return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA ? hexA(col, 0.18) : ('#' + col), color: col ? '#' + col : '#bc8cff', border: '1px solid ' + (darken ? darken(col, 0.16) : 'rgba(188,140,255,.6)') } }, nm)
          }),
          assignees.map(function (a: any, i: any) {
            const login = (typeof a === 'string') ? a : (a.login || '')
            return h('span', { key: 'a' + i, className: 'dsws-chip', style: { fontSize: 10, background: 'rgba(88,166,255,.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.4)' } }, [Ic({ n: 'person', size: 9 }), h('span', { style: { marginLeft: 3 } }, '@' + login)])
          }),
          src.updatedAt ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, '· 更新 ' + String(src.updatedAt).slice(0,10)) : null,
          src.createdAt ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, '· 创建 ' + String(src.createdAt).slice(0,10)) : null,
          // #155 Q6 2🟡新增：author + closedAt（仅当字段存在时显示，undefined → 不渲染；符合 §2 不新增隐藏逻辑）
          (src.author && src.author.login) ? h('span', { style:{ fontSize:10, color:'#8b8b95', display:'inline-flex', alignItems:'center', gap:3 } }, [
            src.author.avatarUrl ? h('img', { src: src.author.avatarUrl, style:{ width:12, height:12, borderRadius:'50%' } }) : Ic({n:'person',size:10}),
            h('span', null, '@' + src.author.login)
          ]) : null,
          (!isOpen && src.closedAt) ? h('span', { style:{ fontSize:10, color:'#8b8b95' } }, '· 关闭 ' + String(src.closedAt).slice(0,10)) : null,
        ]),
        parentMap ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'rgba(188,140,255,.06)', border: '1px solid rgba(188,140,255,.2)', borderRadius: 6, fontSize: 11 } }, [
          Ic({ n: 'map', size: 11, color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '' }),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '属于'),
          // T4 #554：所属地图链接压栈进下一层（保留返回路径，不断掉上一级）。
          h('a', { href: '#', className: 'dsws-hov', 'data-press': 'row', 'data-log': 'issue.parent.' + parentMap.number, onClick: function (e: any) { e.preventDefault(); pushNav(st, 'map', parentMap.number, effortOf(parentMap)) }, style: { color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', textDecoration: 'underline', fontWeight: 600, display: 'inline-block', borderRadius: 3 } }, '#' + parentMap.number + ' ' + parentMap.title),
        ]) : null,
        // body
        h('div', { style: { padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 4 } }, '描述'),
          bodySlot,
        ]),
        // sub-issues
        subNodes.length || subTotal ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, '子票 ' + subTotal + (subNodes.length ? '' : '（无加载）')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, subNodes.map(function (s: any) {
            const sc = s.state === 'CLOSED' ? '#3fb950' : '#8b8b95'
            // T4 整改 #554：子票走 views/subIssueRouting.ts 的 enterSubDetail 分流（有标签按标签，无标签按快照找图）。
            return h('div', { key: idOfParts((s.effortId!==undefined&&s.effortId!==null)?s.effortId:issueEffort, s.number), className: 'dsws-aggrow', tabIndex: 0, role: 'button', 'aria-label': '#' + s.number + ' ' + (s.title || ''), 'data-press': 'row', 'data-log': 'issue.sub.' + s.number, onClick: function () { enterSubDetail(st, s, issueEffort) }, onKeyDown: function (e: any) { if (!e || e.target !== e.currentTarget) return; const k = e && e.key; if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} } }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                h('span', { className: 'dsws-idnum', style: { color: sc, borderColor: sc, fontSize: 11 } }, '#' + s.number),
                h(Tip, { className: 'dsws-tip', content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, s.title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 12 } }, s.title)),
                h('span', { className: 'dsws-chip', style: { fontSize: 10, background: s.state === 'CLOSED' ? 'rgba(63,185,80,.12)' : 'rgba(139,148,158,.12)', color: sc, border: '1px solid ' + sc } }, s.state === 'CLOSED' ? '已关闭' : 'Open'),
              ])
            ])
          })),
        ]) : null,
        // blockers
        blockedNodes.length ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, tr('detail.blockedPrefix') + blockedNodes.length),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, blockedNodes.map(function (b: any) {
            // T4 整改 #554：阻塞票同样走 enterSubDetail 分流（无标签时按快照找图）。
            return h('div', { key: idOfParts((b.effortId!==undefined&&b.effortId!==null)?b.effortId:issueEffort, b.number), className: 'dsws-aggrow', tabIndex: 0, role: 'button', 'aria-label': '#' + b.number + ' ' + (b.title || ''), 'data-press': 'row', 'data-log': 'issue.blocked.' + b.number, onClick: function () { enterSubDetail(st, b, issueEffort) }, onKeyDown: function (e: any) { if (!e || e.target !== e.currentTarget) return; const k = e && e.key; if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} } }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                // #1286：被阻塞统一红 #f87171（与地图详情页、列表行同一个红；这个红在本仓原本专指
                //   错误与失败，这里被重载为「被阻塞」——读代码时别当成同一个语义）
                Ic({ n: 'lock', size: 10, color: '#f87171' }),
                h('span', { className: 'dsws-idnum', style: { color: '#f87171', borderColor: '#f87171', fontSize: 11 } }, '#' + b.number),
                h(Tip, { className: 'dsws-tip', content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, b.title || ('#' + b.number))]) }, h('span', { style: { flex: 1, fontSize: 12 } }, b.title || ('#' + b.number))),
              ])
            ])
          })),
        ]) : null,
      // comments（列表 + 输入区收进 views/IssueDetailComments.js，纯结构搬移，行为零变化）
      // #693：评论区也只喂详情那一份（快照那一行可能不带评论，喂进去会把「没拿到」画成「没有」）。
      h('div', { style: { padding: '8px 0 4px' } }, renderIssueDetailComments(h, st, issueNumber, detail, mode, commentsNodes, canComment, issueEffort)),
        // 底部动作（#763 主动作已搬到顶栏新会话左侧，底部只留只读提示；无提示时不占一行）
        readOnlyKnown ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } }, [
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('detail.readOnlyHint')),
        ]) : null,
        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）
        (typeof mdImgOverlay === 'function' ? mdImgOverlay(st) : null),
      ])
    }