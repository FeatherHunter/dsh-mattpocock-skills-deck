/**
 * src/client/kernel/api-io.ts — 内核模块（#457 由 api.js 拆出之行级打开、注入复制与问题详情）
 *
 * 契约：本文件为模块真源，源码语言是 TypeScript（#1111 由 api-io.js 改名而来，行为零变化）。
 * 构建（scripts/build.mts）直接读这份 .ts 真源、用 esbuild 当场转译，去掉每行行首的 export
 * 关键字后按拼接标记拼回 src/client/index.ts 的 apply 闭包内，与 ctx/seam 同模式；源码树里
 * 只有这一份真源，没有再生成一份 .js 产物。改这里就够。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    import { DRAFT_REFOCUS_RETRY_MS } from '../../shared/time-config/values.js'
    //! #361 原入口：行级「在新会话打开」保留（rowActionText 文本 + 用票标题命名会话）
    // 上面这一行刻意写成 `//!`（法律注释）：esbuild 转译时会保留它，于是 products 里也留着这条终止锚点。
    // tests/verify-newsession-*.js 把几个 api 文件拼起来后，就是切到这一行为止；写成普通 `//` 的话
    // 产物里没有它，那三支测试在编译后的 package/lib/client.js 上就找不到终止锚点（#1111 实测踩到）。
    // 2026-08-30 加固：newSessionTitle 遇到不是数字的编号会抛错（免得地图页新建会话静默空转），
    //   rowActionText 拿不到链接时退回「#编号」。
    // #746 Knife1：下单时种类已知，显式随 opts 传给创建管线，不再靠文本前缀反推；未知种类传空，回退文本推断。
    // ---- 本文件跑在面板闭包里要用到的、由别处提供的自由变量（#1111 TS 化时补）----
    // api-io 会被拼进 src/client/index.ts 的 apply 闭包，下面这些名字来自同一闭包里的别的叶子或宿主注入，
    // 本文件不 import 它们。这里只声明形状、不生成任何代码（esbuild 会把 declare 整行删掉），作用是让
    // tsc -p tsconfig.client.json 能过。类型一律写 any 是刻意的：这些值的真源在别的文件里，
    // 在这里凭记忆写窄，只会把别处正常的改动变成这里的假报错、逼着两处一起改。
    // 位置说明：#1111 之后这一段放在「#361 原入口」这行注释**后面**是有意的——tests/verify-newsession-*.js
    //   会把这几个 api 文件拼起来，并从 `openTextInNewSession` 的定义切到那行注释为止；declare 若排在它前面，
    //   切片里就会混进 `declare` 这种 TypeScript 专有写法，沙箱用 new Function 编译直接语法报错。
    declare const newSessionTitle: any
    declare const rowActionText: any
    declare const issueUrlFor: any
    declare const rowActionKind: any
    declare const openTextInNewSession: any
    declare const flash: any
    declare const scheduleActionProbe: any
    declare const idOfParts: any
    declare const ISSUE_CACHE_TTL: number
    declare const isEnabled: any
    declare const markRowWrite: any
    export const openInNewSession = function (st: any, x: any) {
      let title = null
      try { title = newSessionTitle(x) } catch(e) {
        const n = (x && (x.number != null ? x.number : x.key != null ? x.key : ''))
        const base = (x && x.title) ? String(x.title).slice(0,80) : ''
        title = (n !== '' ? '[#' + String(n) + '] ' + base : '[New]')
        if (!title || title === '[#] ') title = '[New]'
      }
      let text = ''
      try { text = rowActionText(st, x) } catch(e) {
        try { text = rowActionText(st, x) } catch(e2) { text = '' }
        if (!text) {
          const u = (typeof issueUrlFor === 'function' ? (function(){ try{ return issueUrlFor(st, x && x.number) }catch(_){ return '' } })() : '')
          const uu = u || (x && x.number != null ? '#' + String(x.number) : '')
          text = uu ? ('/wayfinder ' + uu) : '/wayfinder'
        }
      }
      let kind = null
      try { kind = (typeof rowActionKind === 'function' ? rowActionKind(x) : null) } catch (eK) {}
      openTextInNewSession(st, text, title, kind ? { kind: kind } : null)
    }
    // 彻底移除：extractIssueRefs 已移除（#345）
    export const inject = (st: any, text: any) => {
      var bodyText = text
      try { if (typeof withTrailingNewline === 'function') bodyText = withTrailingNewline(text) } catch (eNl) {}
      if (st.injector) { st.injector(bodyText); flash(st, tr('toast.injected'), 'ok'); try { if (typeof ensureInjectFocusAtEnd === 'function') ensureInjectFocusAtEnd() } catch (eFocus) {} }
      else copyText(st, bodyText, tr('toast.copiedFallback'))
      // 彻底移除：issuePath 提及识别已移除（#345）
      // v1.5 T10 R9（Q4 拍板）：关键动作（完成/执行/交接/认领）后延迟探测，面板尽快反映变化
      scheduleActionProbe()
    }
    // #789 · 注入文本尾部归一（A 方案：补 1 个换行）：不是以换行结尾就补 1 个，已经是的不重复补；
    //   调宿主写草稿的三处共用（主注入、草稿消费、新会话直注），光标兜底随即落到新行开头。空文本不动。
    export const withTrailingNewline = function (text: any) {
      try {
        var s = String(text == null ? '' : text)
        if (!s) return s
        if (s.charAt(s.length - 1) === '\n') return s
        return s + '\n'
      } catch (eN) { try { return String(text) } catch (eN2) { return '' } }
    }
    // #786 · 注入后光标落末尾的插件侧兜底（B 方案）：宿主 inputActions.setDraft 只收全文、没有光标参数，
    //   本仓调用后下一帧把宿主输入框的光标置末、滚到底。找不到宿主输入框就安静跳过，绝不抛错；
    //   插件自己的输入框（[data-dsws-host] 与 .dsws-modal 内）一律排除，不碰只读框的全选语义与弹窗首控件聚焦。
    //   不新增日志事件：调用次数少但这是同文档内的聚焦收尾，既有注入提示与探测已有轨迹，不进常驻/按需名单。
    export const ensureInjectFocusAtEnd = function () {
      try {
        if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') return
        var attempts = 0
        var run = function () {
          attempts += 1
          try {
            var nodes: any = []
            try { nodes = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]') } catch (eQ) { nodes = [] }
            var list: any[] = []
            try { list = Array.prototype.slice.call(nodes, 0) } catch (eS) { list = [] }
            var isPluginNode = function (el: any) {
              try { if (el && typeof el.closest === 'function' && el.closest('[data-dsws-host], .dsws-modal, [data-dsws-logmenu]')) return true } catch (eC) {}
              return false
            }
            var isVisible = function (el: any) {
              try {
                if (!el) return false
                if (el.disabled) return false
                if (el.readOnly) return false
                if (el.offsetParent !== null) return true
                if (typeof el.getClientRects === 'function' && el.getClientRects().length) return true
                return false
              } catch (eV) { return false }
            }
            var hostFirst: any[] = []
            var hostRest: any[] = []
            list.forEach(function (el) {
              if (!isVisible(el)) return
              if (isPluginNode(el)) return
              try {
                if (el.closest && (el.closest('.p_FcLG_card') || el.closest('.p_FcLG_root') || el.closest('[data-dsh-composer]') || el.closest('[data-conversation-input]'))) hostFirst.push(el)
                else hostRest.push(el)
              } catch (eP) { hostRest.push(el) }
            })
            var el: any = null
            try {
              var ae: any = document.activeElement
              if (ae && (ae.tagName === 'TEXTAREA' || ae.isContentEditable) && isVisible(ae) && !isPluginNode(ae)) el = ae
            } catch (eA) {}
            if (!el) el = hostFirst.length ? hostFirst[hostFirst.length - 1] : (hostRest.length ? hostRest[hostRest.length - 1] : null)
            if (!el) return
            try {
              var tag = (el.tagName || '').toUpperCase()
              if (tag === 'TEXTAREA' || tag === 'INPUT') {
                var len = 0
                try { len = String(el.value == null ? '' : el.value).length } catch (eL) { len = 0 }
                try { el.focus({ preventScroll: true }) } catch (eF1) { try { el.focus() } catch (eF2) {} }
                try { el.setSelectionRange(len, len) } catch (eS2) {}
                try { el.scrollTop = el.scrollHeight } catch (eT) {}
              } else if (el.isContentEditable) {
                try { el.focus({ preventScroll: true }) } catch (eF3) { try { el.focus() } catch (eF4) {} }
                try {
                  var sel = null
                  try { sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : (typeof document.getSelection === 'function' ? document.getSelection() : null) } catch (eG) { sel = null }
                  var range = null
                  try { range = (typeof document.createRange === 'function') ? document.createRange() : null } catch (eC2) { range = null }
                  if (sel && range) {
                    range.selectNodeContents(el)
                    range.collapse(false)
                    sel.removeAllRanges()
                    sel.addRange(range)
                  }
                } catch (eR) {}
                try { el.scrollTop = el.scrollHeight } catch (eT2) {}
              } else {
                try { el.focus() } catch (eF5) {}
              }
            } catch (eApply) {}
          } catch (eRun) {}
          // 宿主用异步方式写草稿，第一帧可能还在旧值，最多补一次，窗口很小（120 毫秒那条值住
          // config/intervals.yaml 的 draftRefocusRetryMs），避免抢用户后续输入。
          if (attempts < 2) { try { if (typeof setTimeout === 'function') setTimeout(run, DRAFT_REFOCUS_RETRY_MS) } catch (eT3) {} }
        }
        try {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { try { setTimeout(run, 0) } catch (e0) { try { run() } catch (e1) {} } })
          else if (typeof setTimeout === 'function') setTimeout(run, 0)
          else run()
        } catch (eSch) { try { run() } catch (eR2) {} }
      } catch (eTop) {}
    }
    // v1.6：技能安装引导已收编进 PROMPTS 注册表（installSkills 条目），见下方 promptText('installSkills') 引用
    // v1.5 引导链：打开外部 URL（gh 安装/登录文档）
    export const openUrl = function (url: any) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* 忽略 */ } }
    export const copyText = (st: any, text: any, okMsg: any) => { // #951：多返回真实结果给调用点换图标，提示行为与原来逐字一致
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok'); return true }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn'); return false })
      } else { flash(st, tr('toast.clipboardUnavailable'), 'warn'); return Promise.resolve(false) }
    }
    const dswsDetailHitN = { n: 0 } // #498 详情缓存命中采样计数（百一采样，只增不显）

    // ==================== #1111 · 客户端这一侧唯一的「失败档位」出口 ====================
    //
    // 档位的真源只有一个：跟踪器契约（src/tracker/contract/vocabulary.ts 的 ERROR_KIND）。
    // 八档的合法取值是 env / auth / rate-limit / conflict / unsupported / not-found / network / parse
    // —— 注意 rate-limit 与 not-found 都带连字符，也没有「unknown」这一档。
    //
    // 为什么要收在一处：宿主尚未迁移的那三个电话（wf.issueDetail / wf.issueComments / wf.commentIssue）
    // 报上来的可能还是老写法。从前客户端拿着错误原文自己又猜一遍档位（正文里有 404 就判 404、
    // 有 not found 就判 notFound），同一件事写在两处必然漂移，而且猜错的方向正是让用户白跑一趟的那种
    // （跟踪器那边的判据表已把这段教训写死在 src/tracker/kernel/error-rules.ts 开头）。现在改成：
    // 只认传上来的档位，认不出才按机器给的事实轻量兜底。
    //
    // 本文件返回的每一个错误对象都带齐三样：kind（八档之一）、message（给人看的一句话）、
    // raw（后端原文，原样交出去让人自己判断；客户端自己发现的前置错误没有原文，给空串）。
    const dswsErrorKinds = ['env', 'auth', 'rate-limit', 'conflict', 'unsupported', 'not-found', 'network', 'parse']
    // 宿主老写法 → 八档。只登记 src/host 里确实还会送过来的那几个字面量
    // （src/refresh/rooms/host/issue-detail-fetch.js 与 src/refresh/rooms/host/comment-thread-fetch.js）：'404' 与 'notFound' → not-found，
    // 'rateLimit' → rate-limit；'env' / 'parse' / 'network' / 'unsupported' 与八档同名，直接透传、不必登记。
    // 'graphql' 是宿主那一层「GraphQL 回包里带着 errors、拿不到数据」的记号：宿主发出它之前，已经先把
    // 限流（isRateLimitError 分支）与找不到（not found 分支）两路分走了，剩下的就是「回包不是我们能用的
    // 形状」，这正是八档里 parse 的定义；这里不替用户猜「到底是没登录还是没权限」——原文会随 raw 摊给
    // 用户自己看。这张表什么时候可以删：那三个电话迁到跟踪器通道、不再送老写法之后。
    const dswsLegacyKinds: Record<string, string> = { '404': 'not-found', 'notfound': 'not-found', 'notFound': 'not-found', 'rateLimit': 'rate-limit', 'rate_limit': 'rate-limit', 'graphql': 'parse' }
    // HTTP 码 → 八档（与跟踪器判据表第①层同一口径：机器给的码最硬，先看它）。只列会改变结论的那几个码：
    // 别的 4xx 与「什么线索都没有」都由下面的 network 兜住，所以这里不必再写一支 5xx。
    const dswsHttpKinds: Record<number, string> = { 401: 'auth', 403: 'auth', 404: 'not-found', 409: 'conflict', 422: 'conflict', 429: 'rate-limit' }
    /**
     * 把一处失败整理成客户端统一的错误形状 {kind, message, raw}。
     *
     * kind 的取法（顺序就是判据，与跟踪器「先看机器给的事实」同口径，但这里只做轻量兜底，
     * 不复制跟踪器那张完整的判档表 —— 复制出来就会各长各的）：
     *   ① 传来的 kind 已经是八档取值 → 原样透传（跟踪器通道给的一定是这一档）；
     *   ② 是宿主老写法 → 查 dswsLegacyKinds 翻成八档（只兜尚未迁移的那三个电话）；
     *   ③ 还是认不出 → 看 HTTP 状态码：错误对象自己带的（status / statusCode / httpCode）优先，
     *      其次在原文里找那三个数字（宿主常常只把 gh 的报错原文送上来）；
     *   ④ 连接层特征（DNS 解析不了、拒连、超时、断流）与「完全没有任何线索」这两档不分开判：
     *      它们同归 network，正是跟踪器判据表第⑤层的既定口径（一条都没命中就归网络）。
     *      所以这里不需要再写一张连接层词表 —— 少一张表就少一处会漂移的判据。
     *
     * message 是给人看的一句话；raw 是后端原文：跟踪器通道已经把它放在 err.raw，宿主老通道放在
     * err.error（约定是字符串，个别处写成 {message}，整条错误也可能就是个字符串）。原文只往界面上摊，
     * 不进日志；认不出的形状一律当没有原文，不 String() 出一个 [object Object] 给用户看。
     */
    const dswsNormalizeError = function (input: any, fallbackText: any) {
      const o = (input && typeof input === 'object') ? input : null
      const field = o ? o.error : input
      const text = (typeof field === 'string') ? field : String((field && field.message) || '')
      const raw = String((typeof (o && o.raw) === 'string' ? o.raw : '') || text || (o && o.message) || '')
      const given = String((o && o.kind) || '')
      const known = (dswsErrorKinds.indexOf(given) >= 0) ? given : (Object.prototype.hasOwnProperty.call(dswsLegacyKinds, given) ? dswsLegacyKinds[given] : '')
      const seen = (o && (o.status || o.statusCode || o.httpCode)) || (/\b(401|403|404|409|422|429)\b/.exec(raw) || [0])[0]
      return { kind: known || dswsHttpKinds[Number(seen)] || 'network', message: String((o && o.message) || raw || fallbackText || ''), raw: raw }
    }

    // T2 #7 · fetchIssueDetail 数据通路（独立缓存 + GraphQL aliases 思路复用 + REST 降级搬运 + 配额止血）
    // 契约：st.issueCache {[n]:{ts,data}}, st.issueMode='idle'|'loading'|'real'|'err', st.issueDetail, st.issueError
    //   TTL 60s 命中即用，miss 走 host.call('wf.issueDetail')；错误形状与 fetchMapsDetail 对齐
    //   {ok, error:{kind, message, raw}}，kind 收八档（见上面 dswsNormalizeError）
    export const fetchIssueDetail = function (st: any, n: any, opts: any) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number', raw: '' } })
      // 详情这条通路上的四个失败出口做的是同样四件事：记成 err 态、清掉详情、通知重画、把失败交回调用方。
      // 收成一处，四个出口各自只写「是什么错」。上面「编号不是数」那一支故意不走这里：那时还没碰过状态。
      const failDetail = function (err: any) { st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st); return { ok: false, error: err } }
      const force = !!(opts && opts.force)
      // effort 维度：详情缓存按票身份 (effort, 编号) 键入，否则两个 effort 的同号票会互相顶掉
      const effortId = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      const cacheKey = idOfParts(effortId, num)
      const now = Date.now()
      const entry = st.issueCache && st.issueCache[cacheKey]
      if (!force && entry && (now - entry.ts) < ISSUE_CACHE_TTL) {
        st.issueDetail = entry.data
        st.issueMode = 'real'
        st.issueError = null
        emit(st)
        try { dswsDetailHitN.n += 1; if (isEnabled('debug') && dswsDetailHitN.n % 100 === 0) log('debug', 'detail.cache.hit', { numHash: dswsLogHash(String(num)), ageMs: now - entry.ts }) } catch (eL) {}
        return Promise.resolve({ ok: true, issue: entry.data, fromCache: true })
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve(failDetail({ kind: 'env', message: tr('err.hostUnavailable'), raw: '' }))
      }
      st.issueMode = 'loading'; st.issueError = null; emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const dtT0 = Date.now()
      return host.call('wf.issueDetail', Object.assign({ number: num }, effortId ? { effortId } : {}, cwdArg)).then(function (res: any) {
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.issueDetail', latencyMs: Date.now() - dtT0, ok: true, kind: 'detail' }); else log('warn', 'host.call.fail', { method: 'wf.issueDetail', kind: 'detail', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'detail-not-ok')), 120, 'error')) }) } catch (eL) {}
        if (!res) return failDetail({ kind: 'network', message: tr('err.snapshotEmpty'), raw: '' })
        if (res.ok) {
          const issue = res.issue || res.value && res.value.issue || res.value
          if (!issue || typeof issue.number !== 'number') return failDetail({ kind: 'parse', message: 'issue missing', raw: '' })
          // 缓存
          if (!st.issueCache) st.issueCache = {}
          st.issueCache[cacheKey] = { ts: Date.now(), data: issue }
          st.issueDetail = issue
          st.issueMode = 'real'
          st.issueError = null
          emit(st)
          return { ok: true, issue: issue }
        }
        // #1111：档位只认宿主报上来那一个（认不出才按 HTTP 码兜底，再兜是 network），不再照原文里的
        // 「404 / not found / rate limit」几个词另猜一遍 —— 判档判据只有跟踪器那一张表。
        return failDetail(dswsNormalizeError(res.error, tr('err.snapshotEmpty')))
      }).catch(function (e: any) {
        try { log('warn', 'host.call.fail', { method: 'wf.issueDetail', kind: 'detail', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        // 请求本身抛错 = 根本没拿到回包：这是纯网络/超时那一档，原文就是异常那句话
        return failDetail({ kind: 'network', message: String((e && e.message) || e), raw: String((e && e.message) || e) })
      })
    }
    export const clearIssueDetailCache = function (st: any, n: any, effortId: any) {
      if (n != null) {
        const num = Number(n)
        if (st.issueCache) {
          // 带 effort 就精确删；不带就把该编号在所有 effort 下的缓存都删（旧调用方零改动）
          if (effortId !== undefined && effortId !== null) delete st.issueCache[idOfParts(String(effortId), num)]
          // 没给 effort：按缓存里那份详情自己的编号删（读数据，不反解身份串）
          else Object.keys(st.issueCache).forEach(function (k) {
            const ent = st.issueCache[k]
            const dn = ent && ent.data && ent.data.number != null ? Number(ent.data.number) : null
            if (k === String(num) || dn === num) delete st.issueCache[k]
          })
        }
      } else if (st.issueCache) st.issueCache = {}
      emit(st)
    }
    // T5 #10 · 评论分页加载与节流错误态（首 50 同 fetchIssueDetail，加载更多 → fetchIssueComments(n, after) 反向分页 cursor，节流 600ms，失败重试与 3 次兜底）
    // 契约：st.issueDetail.comments.nodes 首 50，st.issueCommentsMoreLoading 布尔，st.issueCommentsFailCount 计数，st.issueCommentsHasMore 布尔（pageInfo.hasNextPage）
    export const fetchIssueComments = function (st: any, n: any, after: any, opts: any) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number', raw: '' } })
      // 客户端本地的前置态（上一页还在路上，别重复发）：不是后端失败，所以没有原文。
      // 'throttle' 是客户端自己的「忙」标记，不是契约八档里的取值——调用方只看 ok，没有人认这个值；
      // 留在这里是为了与旧回包形状一致（#1111 只收口「按 message 猜档位」，不重做这条本地态）。
      if (st.issueCommentsMoreLoading) return Promise.resolve({ ok: false, error: { kind: 'throttle', message: 'loading', raw: '' } })
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        const err = { kind: 'env', message: tr('err.hostUnavailable'), raw: '' }
        st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
        emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.issueCommentsMoreLoading = true; emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const afterArg = (after != null) ? String(after) : (st.issueDetail && st.issueDetail.comments && st.issueDetail.comments.pageInfo && st.issueDetail.comments.pageInfo.endCursor) ? String(st.issueDetail.comments.pageInfo.endCursor) : String((st.issueDetail && st.issueDetail.comments && st.issueDetail.comments.nodes && st.issueDetail.comments.nodes.length) || 0)
      const cmT0 = Date.now()
      const cmEffort = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      return host.call('wf.issueComments', Object.assign({ number: num, after: afterArg }, cmEffort ? { effortId: cmEffort } : {}, cwdArg)).then(function (res: any) {
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.issueComments', latencyMs: Date.now() - cmT0, ok: true, kind: 'comments' }); else log('warn', 'host.call.fail', { method: 'wf.issueComments', kind: 'comments', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'comments-not-ok')), 120, 'error')) }) } catch (eL) {}
        st.issueCommentsMoreLoading = false
        if (!res) {
          st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1; emit(st)
          return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty'), raw: '' } }
        }
        if (res.ok) {
          const nodes = res.nodes || (res.value && res.value.nodes) || []
          const pageInfo = res.pageInfo || (res.value && res.value.pageInfo) || { hasNextPage: nodes.length === 50, endCursor: String((Number(afterArg||0)+nodes.length)) }
          // 合并到 issueDetail
          if (!st.issueDetail) st.issueDetail = { number: num, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
          if (!st.issueDetail.comments) st.issueDetail.comments = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
          if (!Array.isArray(st.issueDetail.comments.nodes)) st.issueDetail.comments.nodes = []
          // 去重（按 author+body+createdAt 极简）
          const existing = st.issueDetail.comments.nodes
          nodes.forEach(function (c: any) { existing.push(c) })
          st.issueDetail.comments.pageInfo = pageInfo
          st.issueCommentsHasMore = !!pageInfo.hasNextPage
          st.issueCommentsFailCount = 0
          // 同步缓存（更新 ts 不重置 TTL，仅追加评论）
          const cmCacheKey = idOfParts(cmEffort, num)
          if (st.issueCache && st.issueCache[cmCacheKey]) { st.issueCache[cmCacheKey].data = st.issueDetail; st.issueCache[cmCacheKey].ts = Date.now() }
          emit(st)
          // 探测后续变化（v1.5 R9）
          if (typeof scheduleActionProbe === 'function') try { scheduleActionProbe() } catch (e) {}
          return { ok: true, nodes: nodes, pageInfo: pageInfo }
        } else {
          // #1111：与详情同口径 —— 只消费宿主报上来的档位，认不出才按 HTTP 码兜底，不再照着原文另猜一遍
          const err = dswsNormalizeError(res.error, tr('err.snapshotEmpty'))
          st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
          emit(st)
          return { ok: false, error: err }
        }
      }).catch(function (e: any) {
        try { log('warn', 'host.call.fail', { method: 'wf.issueComments', kind: 'comments', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        st.issueCommentsMoreLoading = false
        st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
        emit(st)
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e), raw: String((e && e.message) || e) } }
      })
    }
    // #255 · 详情页评论提交（GitHub 单点）：宿主透传 wf.commentIssue → tracker.comment（契约 op）。
    // 本函数只做：调透传端点 + 规范化 OpResult 错误（auth / rate-limit|rateLimit / 其他），不动 UI 状态；
    // 推进序列由视图编排 —— 成功后清空输入、fetchIssueDetail(force) 击穿详情缓存重取、probeNow 静默快照刷新，
    // 全程无乐观插入（新评论必须来自服务端重取的证据）。
    export const submitIssueComment = function (st: any, n: any, body: any, opts: any) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number', raw: '' } })
      const text = String(body == null ? '' : body)
      if (!text.trim()) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'comment body required', raw: '' } })
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, error: { kind: 'env', message: tr('err.hostUnavailable'), raw: '' } })
      }
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const ciT0 = Date.now()
      const ciEffort = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      return host.call('wf.commentIssue', Object.assign({ number: num, body: text }, ciEffort ? { effortId: ciEffort } : {}, cwdArg)).then(function (res: any) {
        try { if (res && res.ok === true) log('info', 'host.call', { method: 'wf.commentIssue', latencyMs: Date.now() - ciT0, ok: true, kind: 'comment' }); else log('warn', 'host.call.fail', { method: 'wf.commentIssue', kind: 'comment', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'comment-not-ok')), 120, 'error')) }) } catch (eL) {}
        if (!res) return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty'), raw: '' } }
        // #715：评论真写进远端之后，记下「这一行刚写过」的时刻 —— 列表那一行据此在合并窗口内显示
        //   「更新中」，窗口一过自动消失（窗口长度取自 budget.ts，标记本身不改状态也不改布局）。
        if (res.ok === true) { try { if (typeof markRowWrite === 'function') markRowWrite(st, num, ciEffort) } catch (eW) {}; return { ok: true, comment: res.data != null ? res.data : (res.comment || null) } }
        // #1111：跟踪器侧已经统一成八档（rate-limit / not-found 带连字符），直接透传就够；
        // dswsNormalizeError 是给宿主尚未迁移的通道留的兼容层（老写法 'rateLimit' / 'notFound' / '404'），
        // 认不出的档位才按 HTTP 码兜底 —— 客户端不再照着错误原文自己猜一遍。
        const err = dswsNormalizeError(res.error, 'comment failed')
        return { ok: false, error: err }
      }).catch(function (e: any) {
        try { log('warn', 'host.call.fail', { method: 'wf.commentIssue', kind: 'comment', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e), raw: String((e && e.message) || e) } }
      })
    }
    // #690 · 历史票按页取（宿主电话 wf.issuesPage 的客户端包装）：主列表翻已关闭票的那三个触发点都走它。
    // 本函数只负责「把这一页要到手」并如实回形状；页数据怎么存、怎么在下一次静默刷新后还在、最多留几页，
    // 都不在这里（见 kernel/issue-pages.js）。契约那条操作叫 listPage，语义见宿主侧 contract-page.js。
    // 日志点 issues.page 就落在这里（常驻：用户自己点出来的操作，次数少；字段按 #489 附录 1.4 的白名单）——
    // 翻这一页到底取回几行、一共多少行、等了多久，只有拿到请求参数与回包的这一层知道。
    export const fetchIssuesPage = function (st: any, opts: any) {
      const o = opts || {}
      const state = (o.state === 'open' || o.state === 'closed') ? String(o.state) : ''
      const labels = Array.isArray(o.labels) ? o.labels.filter(function (x: any) { return typeof x === 'string' && x }) : []
      const cursor = (o.cursor != null) ? String(o.cursor) : ''
      const limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : 50
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, error: { kind: 'env', message: tr('err.hostUnavailable'), raw: '' } })
      }
      const args = Object.assign({
        state: state, labels: labels, cursor: cursor, limit: limit,
      }, o.effortId ? { effortId: String(o.effortId) } : {}, o.backendId ? { backendId: String(o.backendId) } : {}, (st && st.cwd) ? { cwd: st.cwd } : {})
      const pgT0 = Date.now()
      const logPage = function (res: any, errText: any) {
        try {
          const ok = !errText && !!(res && res.ok)
          const items = (res && Array.isArray(res.items)) ? res.items : []
          const total = (res && typeof res.total === 'number') ? res.total : -1
          const raw = errText || String(((res && res.error && (res.error.message || res.error.kind)) || 'issues-page-not-ok'))
          if (ok) log('info', 'issues.page', { state: state, labelsCount: labels.length, returned: items.length, total: total, latencyMs: Date.now() - pgT0, ok: true, errorHash: '' })
          else log('warn', 'issues.page', { state: state, labelsCount: labels.length, returned: items.length, total: total, latencyMs: Date.now() - pgT0, ok: false, errorHash: dswsLogHash(dswsLogTrunc(String(raw), 120, 'error')) })
        } catch (eL) {}
      }
      return host.call('wf.issuesPage', args).then(function (res: any) {
        try { if (res && res.ok === true) log('info', 'host.call', { method: 'wf.issuesPage', latencyMs: Date.now() - pgT0, ok: true, kind: 'issues-page' }); else log('warn', 'host.call.fail', { method: 'wf.issuesPage', kind: 'issues-page', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'issues-page-not-ok')), 120, 'error')) }) } catch (eL) {}
        logPage(res, null)
        if (!res) return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty'), raw: '' } }
        if (res.ok === true) {
          return { ok: true, items: Array.isArray(res.items) ? res.items : [], nextCursor: res.nextCursor || null, total: (typeof res.total === 'number') ? res.total : null }
        }
        // #1111：宿主报的档位原样用，认不出才按 HTTP 码兜底；raw 一定带出来（认不出时是空串，不编原文）
        return { ok: false, error: dswsNormalizeError(res.error, 'issues page failed') }
      }).catch(function (e: any) {
        logPage(null, String((e && e.message) || e))
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e), raw: String((e && e.message) || e) } }
      })
    }
    // #691（阶段 3）· 地图子票按需取（宿主电话 wf.mapTickets）。
    // 为什么单独一份：快照首屏不再装已关闭地图的子票（宿主侧 tracker/snapshot.js 里写明），
    //   用户在面板里点开一张地图时才现去取 —— 取回的是那张地图的**全部**子票（开放与已关闭都在），
    //   宿主已经把它们分层、算好统计，正文也剥掉了，界面直接画。
    // 放在哪：st.mapTickets 按「工作单元 + 地图编号」分桶（同号地图在不同工作单元里是两张，不能互相顶掉），
    //   每个桶是 { mode, items, stats, total, fetched, capped, missing, error, ts }；不落磁盘（随时可再取）。
    // 在途去重：同一张地图的并发请求合并成一次 —— 面板一重渲染就会连着触发，不合并会白花额度。
    const dswsMapTicketsInflight: Record<string, any> = {}
    // 存续期住中央 YAML（调时间改 config/ttl.yaml）：界面闭包由构建把产物拼进来，本文件只声明名字（同 ISSUE_CACHE_TTL 的做法）。
    declare const MAP_TICKETS_TTL_MS: number
    export const fetchMapTickets = function (st: any, n: any, opts: any) {
      // 地图的编号按原样当字符串用：本地 Markdown 后端的地图编号是 '00'，GitHub 是 '692' —— 两边都收。
      // （早先写成 Number() 判一下是不行的：Markdown 工作区里连「调一次、按真实返回退化」都做不到。）
      const mKey = String(n === undefined || n === null ? '' : n).trim()
      if (!mKey) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'missing map key', raw: '' } })
      const force = !!(opts && opts.force)
      const effortId = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      const bucketKey = idOfParts(effortId, mKey)
      if (!st.mapTickets) st.mapTickets = {}
      const cur = st.mapTickets[bucketKey]
      const now = Date.now()
      if (!force && cur && cur.mode === 'real' && (now - (cur.ts || 0)) < MAP_TICKETS_TTL_MS) return Promise.resolve({ ok: true, fromCache: true })
      if (!force && dswsMapTicketsInflight[bucketKey]) return dswsMapTicketsInflight[bucketKey]
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        const err = { kind: 'env', message: tr('err.hostUnavailable'), raw: '' }
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'loading', error: null })
      emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const mtT0 = Date.now()
      const p = host.call('wf.mapTickets', Object.assign({ key: mKey }, effortId ? { effortId: effortId } : {}, cwdArg)).then(function (res: any) {
        try { if (res && res.ok === true) log('info', 'host.call', { method: 'wf.mapTickets', latencyMs: Date.now() - mtT0, ok: true, kind: 'map-tickets' }); else log('warn', 'host.call.fail', { method: 'wf.mapTickets', kind: 'map-tickets', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'map-tickets-not-ok')), 120, 'error')) }) } catch (eL) {}
        if (res && res.ok === true) {
          const bucket = {
            mode: 'real', ts: Date.now(),
            items: Array.isArray(res.items) ? res.items : [],
            stats: res.stats || null,
            total: (typeof res.total === 'number') ? res.total : null,
            fetched: (typeof res.fetched === 'number') ? res.fetched : null,
            capped: res.capped === true,
            missing: (typeof res.missing === 'number') ? res.missing : 0,
            error: null,
          }
          st.mapTickets[bucketKey] = bucket
          emit(st)
          return { ok: true, bucket: bucket }
        }
        // #1111：与详情、评论同口径 —— 宿主报的档位原样用，认不出才按 HTTP 码兜底；raw 一定带出来
        const err = dswsNormalizeError(res && res.error, tr('err.snapshotEmpty'))
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return { ok: false, error: err }
      }).catch(function (e: any) {
        try { log('warn', 'host.call.fail', { method: 'wf.mapTickets', kind: 'map-tickets', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        const err = { kind: 'network', message: String((e && e.message) || e), raw: String((e && e.message) || e) }
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return { ok: false, error: err }
      })
      dswsMapTicketsInflight[bucketKey] = p
      p.then(function () { delete dswsMapTicketsInflight[bucketKey] }, function () { delete dswsMapTicketsInflight[bucketKey] })
      return p
    }