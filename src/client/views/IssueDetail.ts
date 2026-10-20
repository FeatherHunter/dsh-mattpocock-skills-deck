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
declare function effortOf(...args: any[]): any;
declare function popNav(...args: any[]): any;
declare function prStateKind(...args: any[]): any;
declare function effortNamesOf(...args: any[]): any;
declare function rowActionText(...args: any[]): any;
declare function rowActionKind(...args: any[]): any;
declare function actionColorOf(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare function findMapByIdentity(...args: any[]): any;
declare function pushNav(...args: any[]): any;
declare function copyText(...args: any[]): any;
declare function openInNewSession(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function mdToHtml(...args: any[]): any;
declare function hexA(...args: any[]): any;
declare function darken(...args: any[]): any;
declare function idOfParts(...args: any[]): any;
declare function renderIssueDetailComments(...args: any[]): any;
declare function mdImgOverlay(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function openIssueUrl(...args: any[]): any;
declare function Ic(props?: any): any;
declare const Tip: any;
// 详情页确认提示的停留时间（毫秒）。数值写在 config/ttl.yaml 的 issueDetailConfirmMs，
// 构建时由生成器变成常量拼进界面闭包；这里的 declare 只是让 TypeScript 知道这个名字存在。
declare const ISSUE_DETAIL_CONFIRM_MS: number;
declare const CONTAINER_ACCENT: any;
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
      if (!issueNumber) return null
      // 触发拉取（缓存命中则同步回 real，不多发请求；force 重试由按钮控制）
      React.useEffect(function () {
        if (!issueNumber) return
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
      // T4 #554：返回只弹一层（上一级是地图就回到该地图，是工单就回到该工单，
      // 栈空才回列表）。直接调弹栈，不经过按种类守卫的旧入口，混合栈也只退一级。
      const goBack = function () { popNav(st) }
      const doRetry = function () { if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, issueNumber, { force: true, effortId: issueEffort }) }
      // #1111 · 失败横幅共用的三小块（整页横幅与「有快照可显」的细横幅都用它们）。
      // 一条失败拆成三样：主行是给人看的一句话（后端或界面自己写的那句 message），
      // 档位只当可选的小标签（kind，八档取值，可能没有），后端原文收进可展开区（raw，没有就不渲染这一段）。
      // 这三样都由 api-io 的 dswsNormalizeError 统一给出；这里不再照着原文另猜档位。
      const errSayOf = function (e: any) {
        const said = String((e && e.message) || '').trim()
        return said || tr('list.loadFail')
      }
      const errKindOf = function (e: any) { return String((e && e.kind) || '').trim() }
      const errRawOf = function (e: any) {
        const direct = String((e && e.raw) || '').trim()
        if (direct) return direct
        // 兼容本次修复之前就已经存进状态里的错误对象：那时后端原文放在 error 字段里
        return (e && typeof e.error === 'string') ? String(e.error).trim() : ''
      }
      const errRawBlockOf = function (e: any) {
        const rawText = errRawOf(e)
        if (!rawText) return null
        return h('details', { style: { width: '100%', marginTop: 2, paddingTop: 4, borderTop: '1px solid rgba(248,113,113,.25)' } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tr('vc.fail.raw', { msg: rawText })),
          h('div', { style: { marginTop: 4, padding: '6px 8px', background: 'rgba(0,0,0,.18)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 6, fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' } }, rawText),
        ])
      }
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
      // T4 整改 #554：子票与阻塞票点击按地图行同口径分流（T3 的做法）。
      // 节点自带标签时按标签判：有地图标签且快照里找得到这张地图才进地图详情，否则回落工单详情；
      // 节点没有标签（阻塞票节点只有编号标题状态）时按快照本地找图：找得到进地图详情，
      // 找不到回落普通工单详情（有字可看，不静默回列表）。只定种类与编号，取数与评论不动。
      const subLabelsOf = function (x: any) {
        if (!x || x.labels == null) return []
        if (Array.isArray(x.labels)) return x.labels
        if (typeof x.labels === 'object' && Array.isArray(x.labels.nodes)) return x.labels.nodes
        return []
      }
      const subHasRoutingInfo = function (x: any) {
        if (!x) return false
        if (subLabelsOf(x).length > 0) return true
        return typeof x.type === 'string' && x.type !== ''
      }
      // #1286：规格（实施地图）也是容器，点进去要走到同一套详情页骨架
      const subHasMapTag = function (x: any) {
        const ls = subLabelsOf(x)
        for (let i = 0; i < ls.length; i++) { const n = (typeof ls[i] === 'string') ? ls[i] : ls[i].name; if (n === 'wayfinder:map') return true }
        return x && (x.type === 'map' || x.type === 'spec')
      }
      const enterSubDetail = function (x: any) {
        if (!x || x.number == null) return
        // effort 维度：子票/阻塞票的 effort 取节点自带字段，没有就跟当前票同 effort（同 effort 内的引用）
        const eid = (x.effortId !== undefined && x.effortId !== null) ? String(x.effortId) : issueEffort
        if (subHasRoutingInfo(x)) {
          if (subHasMapTag(x) && findMapByIdentity(st.snapshot && st.snapshot.maps, x.number, eid)) pushNav(st, 'map', x.number, eid)
          else pushNav(st, 'issue', x.number, eid)
        } else {
          if (findMapByIdentity(st.snapshot && st.snapshot.maps, x.number, eid)) pushNav(st, 'map', x.number, eid)
          else pushNav(st, 'issue', x.number, eid)
        }
      }
      // loading（首拉无缓存且无 snap 降级）
      if (mode === 'loading' && !src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
            h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, navCrumb),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, [h('div', { className: 'dsws-spinner', style: { width: 14, height: 14, border: '2px solid rgba(255,255,255,.15)', borderTopColor: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', borderRadius: '50%', animation: 'dsws-spin 1s linear infinite' } }), h('span', null, tr('list.loading'))]),
        ])
      }
      // err 无 src（且非 snap 降级可显）→ 错误横幅
      if (mode === 'err' && !src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
            h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 11, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, navCrumb),
            h('span', { style: { flex: 1 } }),
          ]),
          h('div', { style: { padding: '12px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, fontSize: 12, color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { wordBreak: 'break-word' } }, errSayOf(err)),
              errKindOf(err) ? h('span', { style: { fontSize: 10, padding: '0 6px', border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, flex: 'none' } }, errKindOf(err)) : null,
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'dsws-btn primary', onClick: doRetry, style: { padding: '1px 8px', fontSize: 11, background: '#f87171', borderColor: 'transparent', color: '#fff' } }, '重试'),
                            // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
              (function () {
                const _u = issueUrlFor(st, issueNumber, issueEffort)
                const _isHttp = /^https?:\/\//i.test(String(_u || ''))
                const _openLocal = function (e: any) { e.stopPropagation(); openIssueUrl(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), issueEffort) }
                const _props = { className: 'dsws-btn ghost', style: { padding: '1px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 } }
                const _kids = [Ic({ n: 'link', size: 11 }), h('span', null, tr('detail.viewOnTracker'))]
                return _isHttp
                  ? h('a', Object.assign({ href: _u, target: '_blank', rel: 'noreferrer' }, _props), _kids)
                  : h('button', Object.assign({ type: 'button', onClick: _openLocal }, _props), _kids)
              })(),
            ]),
            errRawBlockOf(err),
          ]),
        ])
      }
      // src 兜底缺失（snap 与 detail 均无）→ 轻量占位（可能为历史 closed 未加载全量，已在 loading 分支处理，此处为缺口保护）
      if (!src) {
        return h('div', null, [
          h('div', { ref: topBarRef, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
            h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))]),
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
      // effort 维度：详情页标出这张票属于哪个 effort（只在多 effort 仓库出现，单 effort 界面不变）
      const effortChip = (issueEffort && effortNamesOf(st).length > 1) ? h(Tip, { content: issueEffort }, h('span', { className: 'dsws-chip dsws-eff', 'aria-label': issueEffort, style: { fontSize: 10, lineHeight: 1.6, padding: '0 6px', flex: 'none', maxWidth: 140, overflow: 'hidden', whiteSpace: 'nowrap', background: 'rgba(88,166,255,.14)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)' } }, issueEffort)) : null
      // #693 正文格：**只有详情回来了才能说「无描述」**。详情没回来时说加载中，取不到时说「还没拿到」。
      //   取数失败的失败原因与重试在页面顶部那条横幅上（这里不重复放一个按钮）。
      const bodySlot = detail
        ? ((detail.body && String(detail.body).trim())
            ? h('div', { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, (typeof mdToHtml === 'function' ? mdToHtml(detail.body, { st: st }) : String(detail.body)))
            : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('detail.noBody')))
        : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-caption,#8b8b95)', display: 'flex', alignItems: 'center', gap: 6 } }, [
            mode === 'err' ? null : h('div', { className: 'dsws-spinner', style: { width: 11, height: 11, border: '2px solid rgba(255,255,255,.15)', borderTopColor: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', borderRadius: '50%', animation: 'dsws-spin 1s linear infinite' } }),
            h('span', null, mode === 'err' ? tr('detail.bodyNotYet') : tr('list.loading')),
          ])
      const has = function (nm: any) { return labelArr.some(function (l: any) { return (l.name || l) === nm }) }
      const _isTriageLikeLocal = !labelArr.length || has('needs-triage')
      const fakeIssue = { number: issueNumber, ['title']: title, labels: labelArr.map(function (l: any) { return typeof l === 'string' ? { name: l } : l }), state: stateRaw }
      // #763 顶栏主动作按钮：与列表行同口径（图标/文字/注入文本），但自建按钮以便折叠机逐字裁字。
      // 复用行动作的注入文本，不复用它的按钮节点（那个节点写死 flex:none，折叠机裁不动它）。
      // #771 分类走一处 rowActionKind（状态优先于类型：未分流 → 接手 → 补充 → 修复 → 讨论 → 研究 → 原型 → 执行）。
      const primaryInfo = (function () {
        let text = ''
        try { text = (typeof rowActionText === 'function') ? rowActionText(st, fakeIssue) : '' } catch (e) { text = '' }
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
      const actColor = (typeof actionColorOf === 'function') ? actionColorOf(fakeIssue, colorOf) : stateColor
      const actTextColor = (typeof isLightHex === 'function' && isLightHex(actColor)) ? '#140a1e' : '#ffffff'
      const subNodes = (src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : []
      const subTotal = (src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length
      const blockedNodes = (src.blockedBy && src.blockedBy.nodes) ? src.blockedBy.nodes : []
      // #693 评论也只认详情那次取数：快照那一行可能不带评论，拿它当「没有评论」会说错话。
      const commentsSource = detail ? detail.comments : undefined
      const commentsNodes = (commentsSource && commentsSource.nodes) ? commentsSource.nodes : []
      const isStale = !detail && !!snapIssue
      // ======== #255 · 评论输入区（GitHub 单点 · MISSING 零分支）========
      // 显隐以能力字段有无判：comments 存在即渲染（EMPTY=[] 渲染、MISSING=省略 不渲染），
      // 零后端身份分支。数组形状（契约 Comment[]）与 GraphQL 形状（{nodes,pageInfo}）双兼容。
      // #693：这个「能力字段」同样只看详情带回来的那一份（commentsSource），不看快照那一行。
      const rawComments = commentsSource
      let canComment = !!rawComments && (Array.isArray(rawComments) ? true : !!(typeof rawComments === 'object' && Array.isArray(rawComments.nodes)))
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
        h('div', { ref: topBarRef, className: 'dsws-stickybar', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' } }, [
          // 返回按钮的悬停提示走 Tip（T2/T3 纪律），不再用原生 title
          h(Tip, { content: tr('list.back') }, h('button', { className: 'dsws-btn', onClick: goBack, style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'back', size: 12 }), h('span', { 'data-detail-back-text': 1, 'data-full': tr('list.back'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.back'))])),
          h(Tip, { content: navCrumb }, h('span', { 'data-detail-crumb': 1, 'data-full': navCrumb, style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' } }, navCrumb)),
          effortChip,
          h('span', { style: { flex: 1, minWidth: 8 } }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', minWidth: 0, overflow: 'hidden', flexWrap: 'nowrap' } }, [
            detail ? h('span', { 'data-detail-snapshot': 1, 'data-full': (isStale ? '快照' : (mode === 'loading' ? tr('list.loading') : '')), style: { fontSize: 10, color: isStale ? '#f59e0b' : '#8b8b95', flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, isStale ? '快照' : (mode === 'loading' ? tr('list.loading') : '')) : null,
            h(Tip, { content: primaryInfo.tip }, h('button', { className: 'dsws-btn primary', onClick: function (e: any) { e.stopPropagation(); try { inject(st, primaryInfo.text) } catch (err2) {} }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, background: actColor, borderColor: 'transparent', color: actTextColor, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: primaryInfo.icon, size: primaryInfo.icon === 'prototype' ? 12 : 10 }), h('span', { 'data-detail-primary-text': 1, 'data-full': primaryInfo.label, style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, primaryInfo.label)])),
            h(Tip, { content: tr('tip.newSession', { n: issueNumber }) }, h('button', { className: 'dsws-btn primary', onClick: function (e: any) { e.stopPropagation(); openInNewSession(st, { number: issueNumber, ['title']: title, labels: labelArr }) }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, background: actColor, borderColor: 'transparent', color: actTextColor, flex: 'none', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' } }, [Ic({ n: 'external-link', size: 10 }), h('span', { 'data-detail-new-text': 1, 'data-full': tr('list.newSessionLabel'), style: { overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 } }, tr('list.newSessionLabel'))])),
            h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost', onClick: function (e: any) { e.stopPropagation(); copyUrl(issueNumber) }, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 }))),
                        // 本地票的 url 是文件路径不是网址：https 走新页，本地走宿主打开（裸 href 点了没反应，#1145）
            h(Tip, { content: tr('tip.openInTracker', { n: issueNumber }) }, (function () {
              const _u = issueUrlFor(st, issueNumber, issueEffort)
              const _isHttp = /^https?:\/\//i.test(String(_u || ''))
              const _openLocal = function (e: any) { e.stopPropagation(); openIssueUrl(st, issueNumber, (typeof host !== 'undefined' ? host : undefined), issueEffort) }
              const _props = { className: 'dsws-btn ghost', style: { display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }
              return _isHttp
                ? h('a', Object.assign({ href: _u, target: '_blank', rel: 'noreferrer' }, _props), Ic({ n: 'link', size: 13 }))
                : h('button', Object.assign({ type: 'button', onClick: _openLocal }, _props), Ic({ n: 'link', size: 13 }))
            })()),
          ]),
        ]),
        // 顶部 err 横幅（有 src 时可重试，不遮挡主体）：主行给人看的一句话，档位作可选小标签，原文可展开
        mode === 'err' && err ? h('div', { style: { padding: '8px 10px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 6, fontSize: 11, color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', { style: { wordBreak: 'break-word' } }, errSayOf(err)),
            errKindOf(err) ? h('span', { style: { fontSize: 10, padding: '0 6px', border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, flex: 'none' } }, errKindOf(err)) : null,
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-btn', onClick: doRetry, style: { padding: '1px 6px', fontSize: 11 } }, '重试'),
            !detail && snapIssue ? h('span', { style: { fontSize: 10, color: '#f59e0b' } }, '（显示快照降级）') : null,
          ]),
          errRawBlockOf(err),
        ]) : null,
        // header
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 } }, [
          h('span', { className: 'dsws-idnum', style: { color: actColor, borderColor: actColor, flex: 'none' } }, '#' + issueNumber),
          h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 14, fontWeight: 600 } }, title)),
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
          h('a', { href: '#', onClick: function (e: any) { e.preventDefault(); pushNav(st, 'map', parentMap.number, effortOf(parentMap)) }, style: { color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', textDecoration: 'underline', fontWeight: 600 } }, '#' + parentMap.number + ' ' + parentMap.title),
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
            // T4 整改 #554：子票按上面 enterSubDetail 分流（有标签按标签，无标签按快照找图）。
            return h('div', { key: idOfParts((s.effortId!==undefined&&s.effortId!==null)?s.effortId:issueEffort, s.number), className: 'dsws-aggrow', tabIndex: 0, role: 'button', 'aria-label': '#' + s.number + ' ' + (s.title || ''), onClick: function () { enterSubDetail(s) }, onKeyDown: function (e: any) { if (!e || e.target !== e.currentTarget) return; const k = e && e.key; if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} } }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                h('span', { className: 'dsws-idnum', style: { color: sc, borderColor: sc, fontSize: 11 } }, '#' + s.number),
                h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, s.title)]) }, h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontSize: 12 } }, s.title)),
                h('span', { className: 'dsws-chip', style: { fontSize: 10, background: s.state === 'CLOSED' ? 'rgba(63,185,80,.12)' : 'rgba(139,148,158,.12)', color: sc, border: '1px solid ' + sc } }, s.state === 'CLOSED' ? '已关闭' : 'Open'),
              ])
            ])
          })),
        ]) : null,
        // blockers
        blockedNodes.length ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginBottom: 6 } }, tr('detail.blockedPrefix') + blockedNodes.length),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, blockedNodes.map(function (b: any) {
            // T4 整改 #554：阻塞票同样按 enterSubDetail 分流（无标签时按快照找图）。
            return h('div', { key: idOfParts((b.effortId!==undefined&&b.effortId!==null)?b.effortId:issueEffort, b.number), className: 'dsws-aggrow', tabIndex: 0, role: 'button', 'aria-label': '#' + b.number + ' ' + (b.title || ''), onClick: function () { enterSubDetail(b) }, onKeyDown: function (e: any) { if (!e || e.target !== e.currentTarget) return; const k = e && e.key; if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} } }, style: { cursor: 'pointer', padding: '6px 8px' } }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
                // #1286：被阻塞统一红 #f87171（与地图详情页、列表行同一个红；这个红在本仓原本专指
                //   错误与失败，这里被重载为「被阻塞」——读代码时别当成同一个语义）
                Ic({ n: 'lock', size: 10, color: '#f87171' }),
                h('span', { className: 'dsws-idnum', style: { color: '#f87171', borderColor: '#f87171', fontSize: 11 } }, '#' + b.number),
                h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, b.title || ('#' + b.number))]) }, h('span', { style: { flex: 1, fontSize: 12 } }, b.title || ('#' + b.number))),
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