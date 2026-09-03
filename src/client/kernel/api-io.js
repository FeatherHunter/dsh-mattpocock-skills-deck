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
    // T2 #7 · fetchIssueDetail 数据通路（独立缓存 + GraphQL aliases 思路复用 + REST 降级搬运 + 配额止血）
    // 契约：st.issueCache {[n]:{ts,data}}, st.issueMode='idle'|'loading'|'real'|'err', st.issueDetail, st.issueError
    //   TTL 60s 命中即用，miss 走 host.call('wf.issueDetail')；错误形状与 fetchMapsDetail 对齐 {ok, error:{kind,message}}
    //   kind 细化 env|parse|graphql|network|rateLimit|notFound|404（由 host 归一化，client 透传）
    export const fetchIssueDetail = function (st, n, opts) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number' } })
      const force = !!(opts && opts.force)
      const now = Date.now()
      const entry = st.issueCache && st.issueCache[num]
      if (!force && entry && (now - entry.ts) < ISSUE_CACHE_TTL) {
        st.issueDetail = entry.data
        st.issueMode = 'real'
        st.issueError = null
        emit(st)
        return Promise.resolve({ ok: true, issue: entry.data, fromCache: true })
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        const err = { kind: 'env', message: tr('err.hostUnavailable') }
        st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
        return Promise.resolve({ ok: false, error: err })
      }
      st.issueMode = 'loading'; st.issueError = null; emit(st)
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      return host.call('wf.issueDetail', Object.assign({ number: num }, cwdArg)).then(function (res) {
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
          st.issueCache[num] = { ts: Date.now(), data: issue }
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
        const err = { kind: 'network', message: String((e && e.message) || e) }
        st.issueMode = 'err'; st.issueError = err; st.issueDetail = null; emit(st)
        return { ok: false, error: err }
      })
    }
    export const clearIssueDetailCache = function (st, n) {
      if (n != null) { const num = Number(n); if (st.issueCache) delete st.issueCache[num] }
      else if (st.issueCache) st.issueCache = {}
      emit(st)
    }
    // T5 #10 · 评论分页加载与节流错误态（首 50 同 fetchIssueDetail，加载更多 → fetchIssueComments(n, after) 反向分页 cursor，节流 600ms，失败重试与 3 次兜底）
    // 契约：st.issueDetail.comments.nodes 首 50，st.issueCommentsMoreLoading 布尔，st.issueCommentsFailCount 计数，st.issueCommentsHasMore 布尔（pageInfo.hasNextPage）
    export const fetchIssueComments = function (st, n, after) {
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
      return host.call('wf.issueComments', Object.assign({ number: num, after: afterArg }, cwdArg)).then(function (res) {
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
          if (st.issueCache && st.issueCache[num]) { st.issueCache[num].data = st.issueDetail; st.issueCache[num].ts = Date.now() }
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
    export const submitIssueComment = function (st, n, body) {
      const num = Number(n)
      if (!num || isNaN(num)) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'invalid number' } })
      const text = String(body == null ? '' : body)
      if (!text.trim()) return Promise.resolve({ ok: false, error: { kind: 'parse', message: 'comment body required' } })
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, error: { kind: 'env', message: tr('err.hostUnavailable') } })
      }
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      return host.call('wf.commentIssue', Object.assign({ number: num, body: text }, cwdArg)).then(function (res) {
        if (!res) return { ok: false, error: { kind: 'network', message: tr('err.snapshotEmpty') } }
        if (res.ok === true) return { ok: true, comment: res.data != null ? res.data : (res.comment || null) }
        const err = res.error || {}
        // 契约 canonical kind（rate-limit/not-found）与 wf 遗产通道拼写（rateLimit/notFound）双兼容
        let k = String(err.kind || '')
        if (/rate.?limit/i.test(k + ' ' + String(err.message || ''))) k = 'rate-limit'
        else if (k === 'rateLimit' || k === 'rate_limit') k = 'rate-limit'
        else if (k === 'notFound' || k === 'notfound' || k === '404') k = 'not-found'
        else if (!k) k = 'network'
        return { ok: false, error: { kind: k, message: String(err.message || err.error || 'comment failed') } }
      }).catch(function (e) {
        return { ok: false, error: { kind: 'network', message: String((e && e.message) || e) } }
      })
    }