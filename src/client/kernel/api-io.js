/**
 * src/client/kernel/api-io.js — 内核模块（#457 由 api.js 拆出之行级打开、注入复制与问题详情）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // #361 原入口：行级「在新会话打开」保留（rowActionText 文本 + 票标题命名）
    // 2026-08-30 hardening: newSessionTitle throws on non-numeric number (prevent silent MapDetail new-session no-op), rowActionText falls back to #number when url missing
    export const openInNewSession = function (st, x) {
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
      openTextInNewSession(st, text, title)
    }
    // 彻底移除：extractIssueRefs 已移除（#345）
    export const inject = (st, text) => {
      if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
      else copyText(st, text, tr('toast.copiedFallback'))
      // 彻底移除：issuePath 提及识别已移除（#345）
      // v1.5 T10 R9（Q4 拍板）：关键动作（完成/执行/交接/认领）后延迟探测，面板尽快反映变化
      scheduleActionProbe()
    }
    // v1.6：技能安装引导已收编进 PROMPTS 注册表（installSkills 条目），见下方 promptText('installSkills') 引用
    // v1.5 引导链：打开外部 URL（gh 安装/登录文档）
    export const openUrl = function (url) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* 忽略 */ } }
    export const copyText = (st, text, okMsg) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok') }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn') })
      } else flash(st, tr('toast.clipboardUnavailable'), 'warn')
    }
    const dswsDetailHitN = { n: 0 } // #498 详情缓存命中采样计数（百一采样，只增不显）
    // T2 #7 · fetchIssueDetail 数据通路（独立缓存 + GraphQL aliases 思路复用 + REST 降级搬运 + 配额止血）
    // 契约：st.issueCache {[n]:{ts,data}}, st.issueMode='idle'|'loading'|'real'|'err', st.issueDetail, st.issueError
    //   TTL 60s 命中即用，miss 走 host.call('wf.issueDetail')；错误形状与 fetchMapsDetail 对齐 {ok, error:{kind,message}}
    //   kind 细化 env|parse|graphql|network|rateLimit|notFound|404（由 host 归一化，client 透传）
    export const fetchIssueDetail = function (st, n, opts) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number' } })
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
        const err = { kind: 'env', message: tr('err.hostUnavailable') }
        st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.issueMode = 'loading'; st.issueError = null; emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const dtT0 = Date.now()
      return host.call('wf.issueDetail', Object.assign({ number: num }, effortId ? { effortId } : {}, cwdArg)).then(function (res) {
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.issueDetail', latencyMs: Date.now() - dtT0, ok: true, kind: 'detail' }); else log('warn', 'host.call.fail', { method: 'wf.issueDetail', kind: 'detail', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'detail-not-ok')), 120, 'error')) }) } catch (eL) {}
        if (!res) {
          const err = { kind: 'network', message: tr('err.snapshotEmpty') }
          st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
          return { ok: false, error: err }
        }
        if (res.ok) {
          const issue = res.issue || res.value && res.value.issue || res.value
          if (!issue || typeof issue.number !== 'number') {
            const err = { kind: 'parse', message: 'issue missing' }
            st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
            return { ok: false, error: err }
          }
          // 缓存
          if (!st.issueCache) st.issueCache = {}
          st.issueCache[cacheKey] = { ts: Date.now(), data: issue }
          st.issueDetail = issue
          st.issueMode = 'real'
          st.issueError = null
          emit(st)
          return { ok: true, issue: issue }
        } else {
          const err = res.error || { kind: 'network', message: String(res.error || 'fetch failed') }
          // 细化 404 / notFound
          if (/404/i.test(String(err.message || err.kind)) ) err.kind = '404'
          else if (/not.?found/i.test(String(err.message || ''))) err.kind = 'notFound'
          else if (/rate.?limit/i.test(String(err.message || ''))) err.kind = 'rateLimit'
          st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
          return { ok: false, error: err }
        }
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.issueDetail', kind: 'detail', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        const err = { kind: 'network', message: String((e && e.message) || e) }
        st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
        return { ok: false, error: err }
      })
    }
    export const clearIssueDetailCache = function (st, n, effortId) {
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
    export const fetchIssueComments = function (st, n, after, opts) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number' } })
      if (st.issueCommentsMoreLoading) return Promise.resolve({ ok: false, error: { kind: 'throttle', message: 'loading' } })
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        const err = { kind: 'env', message: tr('err.hostUnavailable') }
        st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
        emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.issueCommentsMoreLoading = true; emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const afterArg = (after != null) ? String(after) : (st.issueDetail && st.issueDetail.comments && st.issueDetail.comments.pageInfo && st.issueDetail.comments.pageInfo.endCursor) ? String(st.issueDetail.comments.pageInfo.endCursor) : String((st.issueDetail && st.issueDetail.comments && st.issueDetail.comments.nodes && st.issueDetail.comments.nodes.length) || 0)
      const cmT0 = Date.now()
      const cmEffort = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      return host.call('wf.issueComments', Object.assign({ number: num, after: afterArg }, cmEffort ? { effortId: cmEffort } : {}, cwdArg)).then(function (res) {
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.issueComments', latencyMs: Date.now() - cmT0, ok: true, kind: 'comments' }); else log('warn', 'host.call.fail', { method: 'wf.issueComments', kind: 'comments', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'comments-not-ok')), 120, 'error')) }) } catch (eL) {}
        st.issueCommentsMoreLoading = false
        if (!res) {
          st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1; emit(st)
          return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty') } }
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
          nodes.forEach(function (c) { existing.push(c) })
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
          const err = res.error || { kind: 'network', message: String(res.error || 'fetch failed') }
          if (/404/i.test(String(err.message||err.kind))) err.kind='404'
          else if (/not.?found/i.test(String(err.message||''))) err.kind='notFound'
          else if (/rate.?limit/i.test(String(err.message||''))) err.kind='rateLimit'
          st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
          emit(st)
          return { ok: false, error: err }
        }
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.issueComments', kind: 'comments', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        st.issueCommentsMoreLoading = false
        st.issueCommentsFailCount = (st.issueCommentsFailCount || 0) + 1
        emit(st)
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e) } }
      })
    }
    // #255 · 详情页评论提交（GitHub 单点）：宿主透传 wf.commentIssue → tracker.comment（契约 op）。
    // 本函数只做：调透传端点 + 规范化 OpResult 错误（auth / rate-limit|rateLimit / 其他），不动 UI 状态；
    // 推进序列由视图编排 —— 成功后清空输入、fetchIssueDetail(force) 击穿详情缓存重取、probeNow 静默快照刷新，
    // 全程无乐观插入（新评论必须来自服务端重取的证据）。
    export const submitIssueComment = function (st, n, body, opts) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number' } })
      const text = String(body == null ? '' : body)
      if (!text.trim()) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'comment body required' } })
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, error: { kind: 'env', message: tr('err.hostUnavailable') } })
      }
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const ciT0 = Date.now()
      const ciEffort = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      return host.call('wf.commentIssue', Object.assign({ number: num, body: text }, ciEffort ? { effortId: ciEffort } : {}, cwdArg)).then(function (res) {
        try { if (res && res.ok === true) log('info', 'host.call', { method: 'wf.commentIssue', latencyMs: Date.now() - ciT0, ok: true, kind: 'comment' }); else log('warn', 'host.call.fail', { method: 'wf.commentIssue', kind: 'comment', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'comment-not-ok')), 120, 'error')) }) } catch (eL) {}
        if (!res) return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty') } }
        // #715：评论真写进远端之后，记下「这一行刚写过」的时刻 —— 列表那一行据此在合并窗口内显示
        //   「更新中」，窗口一过自动消失（窗口长度取自 budget.ts，标记本身不改状态也不改布局）。
        if (res.ok === true) { try { if (typeof markRowWrite === 'function') markRowWrite(st, num, ciEffort) } catch (eW) {}; return { ok: true, comment: res.data != null ? res.data : (res.comment || null) } }
        const err = res.error || {}
        // 契约 canonical kind（rate-limit/not-found）与 wf 遗产通道拼写（rateLimit/notFound）双兼容
        let k = String(err.kind || '')
        if (/rate.?limit/i.test(k + ' ' + String(err.message || ''))) k = 'rate-limit'
        else if (k === 'rateLimit' || k === 'rate_limit') k = 'rate-limit'
        else if (k === 'notFound' || k === 'notfound' || k === '404') k = 'not-found'
        else if (!k) k = 'network'
        return { ok: false, error: { kind: k, message: String(err.message || err.error || 'comment failed') } }
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.commentIssue', kind: 'comment', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e) } }
      })
    }
    // #690 · 历史票按页取（宿主电话 wf.issuesPage 的客户端包装）：主列表翻已关闭票的那三个触发点都走它。
    // 本函数只负责「把这一页要到手」并如实回形状；页数据怎么存、怎么在下一次静默刷新后还在、最多留几页，
    // 都不在这里（见 kernel/issue-pages.js）。契约那条操作叫 listPage，语义见宿主侧 contract-page.js。
    // 日志点 issues.page 就落在这里（常驻：用户自己点出来的操作，次数少；字段按 #489 附录 1.4 的白名单）——
    // 翻这一页到底取回几行、一共多少行、等了多久，只有拿到请求参数与回包的这一层知道。
    export const fetchIssuesPage = function (st, opts) {
      const o = opts || {}
      const state = (o.state === 'open' || o.state === 'closed') ? String(o.state) : ''
      const labels = Array.isArray(o.labels) ? o.labels.filter(function (x) { return typeof x === 'string' && x }) : []
      const cursor = (o.cursor != null) ? String(o.cursor) : ''
      const limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : 50
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, error: { kind: 'env', message: tr('err.hostUnavailable') } })
      }
      const args = Object.assign({
        state: state, labels: labels, cursor: cursor, limit: limit,
      }, o.effortId ? { effortId: String(o.effortId) } : {}, o.backendId ? { backendId: String(o.backendId) } : {}, (st && st.cwd) ? { cwd: st.cwd } : {})
      const pgT0 = Date.now()
      const logPage = function (res, errText) {
        try {
          const ok = !errText && !!(res && res.ok)
          const items = (res && Array.isArray(res.items)) ? res.items : []
          const total = (res && typeof res.total === 'number') ? res.total : -1
          const raw = errText || String(((res && res.error && (res.error.message || res.error.kind)) || 'issues-page-not-ok'))
          if (ok) log('info', 'issues.page', { state: state, labelsCount: labels.length, returned: items.length, total: total, latencyMs: Date.now() - pgT0, ok: true, errorHash: '' })
          else log('warn', 'issues.page', { state: state, labelsCount: labels.length, returned: items.length, total: total, latencyMs: Date.now() - pgT0, ok: false, errorHash: dswsLogHash(dswsLogTrunc(String(raw), 120, 'error')) })
        } catch (eL) {}
      }
      return host.call('wf.issuesPage', args).then(function (res) {
        try { if (res && res.ok === true) log('info', 'host.call', { method: 'wf.issuesPage', latencyMs: Date.now() - pgT0, ok: true, kind: 'issues-page' }); else log('warn', 'host.call.fail', { method: 'wf.issuesPage', kind: 'issues-page', errorHash: dswsLogHash(dswsLogTrunc(String(((res && res.error && (res.error.message || res.error.kind)) || 'issues-page-not-ok')), 120, 'error')) }) } catch (eL) {}
        logPage(res, null)
        if (!res) return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty') } }
        if (res.ok === true) {
          return { ok: true, items: Array.isArray(res.items) ? res.items : [], nextCursor: res.nextCursor || null, total: (typeof res.total === 'number') ? res.total : null }
        }
        return { ok: false, error: res.error || { kind: 'network', message: 'issues page failed' } }
      }).catch(function (e) {
        logPage(null, String((e && e.message) || e))
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e) } }
      })
    }
    // #691（阶段 3）· 地图子票按需取（宿主电话 wf.mapTickets）。
    // 为什么单独一份：快照首屏不再装已关闭地图的子票（宿主侧 tracker/snapshot.js 里写明），
    //   用户在面板里点开一张地图时才现去取 —— 取回的是那张地图的**全部**子票（开放与已关闭都在），
    //   宿主已经把它们分层、算好统计，正文也剥掉了，界面直接画。
    // 放在哪：st.mapTickets 按「工作单元 + 地图编号」分桶（同号地图在不同工作单元里是两张，不能互相顶掉），
    //   每个桶是 { mode, items, stats, total, fetched, capped, missing, error, ts }；不落磁盘（随时可再取）。
    // 在途去重：同一张地图的并发请求合并成一次 —— 面板一重渲染就会连着触发，不合并会白花额度。
    const dswsMapTicketsInflight = {}
    const MAP_TICKETS_TTL = 60 * 1000
    export const fetchMapTickets = function (st, n, opts) {
      // 地图的编号按原样当字符串用：本地 Markdown 后端的地图编号是 '00'，GitHub 是 '692' —— 两边都收。
      // （早先写成 Number() 判一下是不行的：Markdown 工作区里连「调一次、按真实返回退化」都做不到。）
      const mKey = String(n === undefined || n === null ? '' : n).trim()
      if (!mKey) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'missing map key' } })
      const force = !!(opts && opts.force)
      const effortId = (opts && opts.effortId !== undefined && opts.effortId !== null) ? String(opts.effortId) : ''
      const bucketKey = idOfParts(effortId, mKey)
      if (!st.mapTickets) st.mapTickets = {}
      const cur = st.mapTickets[bucketKey]
      const now = Date.now()
      if (!force && cur && cur.mode === 'real' && (now - (cur.ts || 0)) < MAP_TICKETS_TTL) return Promise.resolve({ ok: true, fromCache: true })
      if (!force && dswsMapTicketsInflight[bucketKey]) return dswsMapTicketsInflight[bucketKey]
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        const err = { kind: 'env', message: tr('err.hostUnavailable') }
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'loading', error: null })
      emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const mtT0 = Date.now()
      const p = host.call('wf.mapTickets', Object.assign({ key: mKey }, effortId ? { effortId: effortId } : {}, cwdArg)).then(function (res) {
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
        const err = (res && res.error) || { kind: 'network', message: tr('err.snapshotEmpty') }
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return { ok: false, error: err }
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.mapTickets', kind: 'map-tickets', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        const err = { kind: 'network', message: String((e && e.message) || e) }
        st.mapTickets[bucketKey] = Object.assign({}, cur, { mode: 'err', error: err })
        emit(st)
        return { ok: false, error: err }
      })
      dswsMapTicketsInflight[bucketKey] = p
      p.then(function () { delete dswsMapTicketsInflight[bucketKey] }, function () { delete dswsMapTicketsInflight[bucketKey] })
      return p
    }