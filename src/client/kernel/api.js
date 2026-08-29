/**
 * src/client/kernel/api.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const injectFixate = (st) => { inject(st, fixateText()) }

    // v24-48：交接 —— 第一击自动注入 /handoff 模板（带时间戳文件名 + 引导句）并记忆该时间戳；
    // 第二击优先读「第一击模板里的同一个文件」（模板写什么名就读什么名，不再查目录导致旧文件名）；
    // 仅当未点过第一击（如刷新后）才回退 host 查最新实际文档；+ 复制 + 开新空白会话
    // v25 · T2b（F1 修正）：交接两击走模板渲染；{ts} 第一击注入时生成并记忆；
    //   {file} = 第一击模板渲染后解析出的实际文件名（用户改文件名结构也一致），解析失败兜底 handoffTs + '.md'
    export let handoffTs = null  // v24：第一击模板使用的时间戳（第二击按 {ts}-*.md 前缀匹配真实文件名）
    export let handoffFile = null  // 真实交接文件名（含 AI 生成的短标题，如 {ts}-修复提示词.md；由探测按 {ts}-*.md 前缀发现）
    export const handoffPrompt = function (ts) {
      return renderTemplate('handoff1', { ts: ts })
    }
    // 从第一击注入文本解析 .scratch/handoff/<name>.md 的实际文件名（T1 规格 §2 发现 1；短标题方案下主路径走前缀探测，此处仅兼容保留）
    export const extractHandoffFile = function (text) {
      const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
      return m ? m[1] : null
    }
    // 拼绝对路径：{path} = cwd/.scratch/handoff/{file}（跨工作区 / 用户自行查看移动用；分隔符跟随 cwd）
    export const absHandoffPath = function (cwd, file) {
      if (!cwd || !file) return file || ''
      const sep = cwd.indexOf('/') >= 0 ? '/' : '\\'
      return (cwd.replace(/[\\/]+$/, '')) + sep + '.scratch' + sep + 'handoff' + sep + file
    }
    export const handoffReadText = function (file, cwd) {
      if (!file) return ''
      return renderTemplate('handoff2', { path: absHandoffPath(cwd, file), file: file })
    }
    // 跨会话预填（issue #12 BUG4 r3 终极修复）：单变量保留，但消费侧彻底锁死 deps 为 [props.sessionId]，
//   当前会话的 props 重渲染不会再触发 effect 重跑，从根本上消除「当前会话 effect 抢先消费」竞态。
// r4（#62/#63 回归 2026-08-21）：旧 r3 用 boolean consumedDraftRef 导致首次消费后 ref=true 常驻，任何新会话 effect 直接 return（62/63 新开会话不注入）；且 pendingDraft 为全局单变量，旧会话重渲染若 deps 含 props 可能抢先消费。r4 改为 sid 锚定：pendingDraftTargetSid 记录新会话 sid，消费侧仅当 pendingDraftTargetSid===props.sessionId 才消费，且 ref 按 sid 存储。
export let pendingDraft = null
export let pendingDraftTargetSid = null
    // ============ 命名守护（#265 · 草稿档垂直线 · 界面半渲染钩子）============
    // 分工（#264 D2）：host 常驻轻量任务持跟踪态并产出「待办改名计划单」（wf.namingPlan）；
    // 本侧只做渲染钩子 —— 拉取计划单、按本机语言落地档位词、经会话门面（face.rename）执行改名、回报结果。
    // 纯判定真源 = src/shared/naming-guardian.js（构建经 shared:namingGuardian splice 注入本闭包，无第二处实现）。
    // 旧 #211 的 5 秒手改跳过标记（死代码）自本版起全面移除：手改保护由值比对锁真检测承担。
    export const NAMING_POLL_MS = 5000
    let _namingPollTimer = null
    let _namingPullBusy = false
    // 值比对锁的「当前标题」来源：优先 sessions.get(sid) 实时标题（若宿主暴露，即时而非快照），回退到 sessions.list 快照 byId[sid].title
    export function namingCurrentTitleOf(sid) {
      try {
        const sessions = ctx.get('sessions')
        if (!sessions) return null
        // 优先实时接口（若可用，规避 5s 快照旧照片竞态；见 #315 手改被盖的 TOCTOU）
        try {
          if (typeof sessions.get === 'function') {
            const s = sessions.get(sid)
            if (s && typeof s.title === 'string' && s.title) return s.title
          }
        } catch (eGet) {}
        if (!sessions.list || typeof sessions.list.getSnapshot !== 'function') return null
        const snap = sessions.list.getSnapshot()
        const row = snap && snap.byId ? snap.byId[sid] : null
        if (row && typeof row.title === 'string' && row.title) return row.title
      } catch (e) {}
      return null
    }
    // 面包屑语义线索：claim 源节点优先，其次首节点（与 recordIssuePath 记账同源 · CONTEXT「面包屑」词条）
    export function namingHintOf(st) {
      try {
        const ip = st && st.issuePath
        if (ip && Array.isArray(ip.nodes) && ip.nodes.length) {
          const claim = ip.nodes.find(function (n) { return n.source === 'claim' && n.title })
          const src = claim || ip.nodes[0]
          return src && src.title ? String(src.title).slice(0, 80) : null
        }
      } catch (e) {}
      return null
    }
    function reportNamingResult(sid, outcome, extra) {
      try {
        if (typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.namingResult', Object.assign({ sessionId: sid, outcome: outcome }, extra || {})).catch(function () {})
        }
      } catch (e) {}
    }
    // 执行一条计划单：值比对锁判定（判手改即锁定回报，永不触碰）→ 按档位合成目标名
    //   （draft 本机语言落地 composeDraftTitle；numbered 语言无关 newSessionTitle —— [#n] 前缀
    //    契约 #205 由共享核心保证永不破坏）→ face.rename → 回报
    export function executeNamingOrder(o) {
      if (!o || !o.sessionId) return
      const sid = o.sessionId
      const lock = o.lock || {}
      const cur = namingCurrentTitleOf(sid)
      if (cur === null) return  // 当前标题不可读：本轮跳过，绝不盲写
      const judge = evaluateRenameLock({ currentTitle: cur, lastMachineTitle: lock.lastMachineTitle, baselineTitle: lock.baselineTitle })
      if (judge === 'locked' || lock.locked) { reportNamingResult(sid, 'locked', { currentTitle: cur }); return }
      if (judge === 'unknown') return
      let target = null
      if (o.kind === 'draft') {
        let langIsEn = false
        try { langIsEn = typeof promptLang === 'function' && promptLang() === 'en' } catch (eLang) {}
        target = composeDraftTitle({ hint: o.hint, lang: langIsEn ? 'en' : 'zh' })
      } else if (o.kind === 'numbered') {
        const num = Number(o.number)
        if (!isFinite(num) || num <= 0) return
        try { target = newSessionTitle({ number: num, title: o.title || '' }) } catch (eT) { return }
      } else {
        return
      }
      if (!target || target === cur) { reportNamingResult(sid, 'renamed', { title: cur || target }); return }  // 已在位（如上次改名落定但回报失败）→ 收敛记账
      try {
        const sessions = ctx.get('sessions')
        if (!sessions || typeof sessions.scope !== 'function' || typeof sessions.sessionOf !== 'function') return
        const scope = sessions.scope(sid)
        const face = scope ? sessions.sessionOf(scope) : null
        if (!face || typeof face.rename !== 'function') return
        // #315 防御：若面对象暴露会话标识，校验必须与订单 sid 一致，防止跨会话错写（宿主对非当前会话面解析回退到当前会话时拦截）
        try {
          const faceSid = (face && (face.sessionId || face.id || face.sid)) || (scope && (scope.sessionId || scope.id || scope.sid))
          if (faceSid && String(faceSid) !== String(sid)) {
            reportNamingResult(sid, 'failed', { error: 'session face mismatch: expected ' + sid + ' got ' + faceSid })
            return
          }
        } catch (eFaceCheck) {}
        // 二次校验：执行前再次确认当前标题仍为判定时的 cur，防止并发改名竞态错写
        try {
          const cur2 = namingCurrentTitleOf(sid)
          if (cur2 !== cur) {
            reportNamingResult(sid, 'failed', { error: 'title changed before rename' })
            return
          }
        } catch (eCur2) {}
        Promise.resolve(face.rename(target)).then(function (r) {
          if (r && r.ok) reportNamingResult(sid, 'renamed', { title: (r.value && r.value.title) || target })
          else reportNamingResult(sid, 'failed', { error: (r && r.error && r.error.message) || 'rename failed' })
        }).catch(function () { reportNamingResult(sid, 'failed', { error: 'rename rejected' }) })
      } catch (eExec) {}
    }
    // ==== 面板级失败可见性（#267 · F4）====
    // 定败（有限重试耗尽）会话的两条化解路，均「只读探测、绝不盲写」：
    //   手改 → 值比对锁判 locked 回报（「手改永不被覆盖」闭环收尾，横幅随锁定终局消失）；
    //   值一致（上次实际改名已落定但回报丢失）→ 按目标名收敛记账 renamed。
    export function reconcileNamingFailure(f) {
      if (!f || !f.sessionId || typeof evaluateRenameLock !== 'function') return false
      const sid = f.sessionId
      const cur = namingCurrentTitleOf(sid)
      if (!cur) return false
      const lock = f.lock || {}
      const judge = evaluateRenameLock({ currentTitle: cur, lastMachineTitle: lock.lastMachineTitle, baselineTitle: lock.baselineTitle })
      if (judge === 'unknown') return false
      if (judge === 'locked' || lock.locked) { reportNamingResult(sid, 'locked', { currentTitle: cur }); return true }
      let target = null
      if (f.kind === 'numbered' || f.stage === NAMING_STAGES.NUMBERED) {
        const num = Number(f.number)
        if (!(isFinite(num) && num > 0)) return false
        try { target = newSessionTitle({ number: num, title: f.numberTitle || '' }) } catch (eT) { return false }
      } else {
        let langIsEn = false
        try { langIsEn = typeof promptLang === 'function' && promptLang() === 'en' } catch (eLang) {}
        target = composeDraftTitle({ hint: f.hint, lang: langIsEn ? 'en' : 'zh' })
      }
      if (target && target === cur) { reportNamingResult(sid, 'renamed', { title: cur }); return true }
      return false
    }
    // 定败清单 → 共享 store（DetailsDock 常驻横幅消费）；账目里会话已消失的不呈现（防幽灵横幅，账不动）。
    export function applyNamingFailurePanel(failures) {
      try {
        const arr = Array.isArray(failures) ? failures : []
        let rows = null
        try {
          const sessions = ctx.get('sessions')
          if (sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
            const snap = sessions.list.getSnapshot()
            rows = snap && snap.byId ? snap.byId : {}
          }
        } catch (eR) {}
        const vis = arr.filter(function (f) { return f && f.sessionId && (!rows || rows[f.sessionId]) }).map(function (f) {
          return Object.assign({}, f, { _title: (rows && rows[f.sessionId] && rows[f.sessionId].title) ? String(rows[f.sessionId].title) : '' })
        })
        const sh = storeOf(null)
        const key = JSON.stringify(vis)
        if (sh.namingFailKey !== key || !sh.namingFailures) {
          sh.namingFailKey = key
          sh.namingFailures = vis
          emit(sh)
        }
      } catch (eF) {}
    }
    // 渲染钩子：拉取计划单 → 执行 → 回报（防重入；host 无单时零开销）
    // #266 追加：tracked 终局清理 —— 已终局（锁定/编号落定）且会话已不存在于 DSH 列表的
    //   受踪账目经 wf.cancelNewSessionWatcher 注销（防账目堆积；未终局项绝不误删）。
    export function namingGuardianKick() {
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      if (_namingPullBusy) return
      _namingPullBusy = true
      host.call('wf.namingPlan', {}).then(function (res) {
        _namingPullBusy = false
        if (!res || !res.ok || !Array.isArray(res.orders)) return
        for (let i = 0; i < res.orders.length; i++) executeNamingOrder(res.orders[i])
        // #267：定败清单 → 只读协商化解 + 落共享 store（面板级横幅；化解即自动撤下）
        try {
          const fails = Array.isArray(res.failures) ? res.failures : []
          for (let i = 0; i < fails.length; i++) { try { reconcileNamingFailure(fails[i]) } catch (eRec) {} }
          applyNamingFailurePanel(fails)
        } catch (ePanel) {}
        try {
          if (!Array.isArray(res.tracked)) return
          const sessions = ctx.get('sessions')
          if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return
          const snap = sessions.list.getSnapshot()
          const rows = snap && snap.byId ? snap.byId : null
          if (!rows) return
          for (let i = 0; i < res.tracked.length; i++) {
            const t = res.tracked[i]
            if (t && t.done && !rows[t.sessionId]) {
              host.call('wf.cancelNewSessionWatcher', { sessionId: t.sessionId }).catch(function () {})
            }
          }
        } catch (eClean) {}
      }).catch(function () { _namingPullBusy = false })
    }
    // 常驻拉询（web 半加载即活，面板未开也续跑；globalThis 单例句柄清热重载遗留环）
    export function startNamingGuardianPoll() {
      try {
        if (typeof globalThis !== 'undefined') {
          const prev = globalThis.__dswsNamingPollTimer
          if (prev) try { clearTimeout(prev) } catch (ePrev) {}
        }
      } catch (eGuard) {}
      if (_namingPollTimer) return
      namingGuardianKick()
      const tick = function () { namingGuardianKick(); _namingPollTimer = setTimeout(tick, NAMING_POLL_MS) }
      _namingPollTimer = setTimeout(tick, NAMING_POLL_MS)
      try { if (typeof globalThis !== 'undefined') globalThis.__dswsNamingPollTimer = _namingPollTimer } catch (eKeep) {}
    }
    // 需求1（2026-08-18）：交接按钮 = 第一击（注入 /handoff 模板，不再变字）；「新会话交接」小按钮 = 原第二击逻辑
    // 需求1·二阶段 rev（2026-08-18）：灰/亮双态的真实依据 = 磁盘上确实存在交接文档（wf.handoffLatest 探测）。
    //   probeHandoffReady：探测 → 写 st.handoffReady + emit（右半亮蓝/灰 + 允许/禁止 的开关）；任何路径都不得在无文档时开新会话。
    // issue #12 BUG4 · 主路径（r2 终极形态）：用户刚点过第一击（handoffFile 已设）→ 直接用 handoffFile 作为 prompt
    //   文件名 + 亮蓝，**不查磁盘**。理由：prompt 必须与第一击注入的 `/handoff` 模板时间戳一致（用户视角的「两段文本应该对应同一份文档」），
    //   即便 AI 还没落盘，handoff-open 仍应预填 handoffFile（保证两段 prompt 一致）。若 AI 真没写，新会话 `/read` 会失败 —— 那是 AI 行为问题。
    //   未点过第一击（handoffFile=null，如刷新后 / 直接点右半）→ 调 wf.handoffLatest 探磁盘取 mtime 最新。
    //   始终返回 Promise.resolve(done(...))，让调用方（doHandoffOpen / probe chain）能稳定 .then。
    export const probeHandoffReady = function (st) {
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const done = function (file) {
        const ready = !!file
        if (ready) handoffFile = file
        if (st.handoffReady !== ready) { st.handoffReady = ready; emit(st) }  // 状态变了才重渲染（长轮询免重复绘）
        return file
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { done(null); return Promise.resolve(null) }
      // 主路径：已发现真实文件名（handoffFile 已设）→ 直接返回（prompt 与第一击 {ts}-*.md 一致）
      if (handoffFile) return Promise.resolve(done(handoffFile))
      // 副路径 A：刚点过第一击（handoffTs 已设）→ 按 {handoffTs}-*.md 前缀匹配真实文件名（含 AI 短标题）
      if (handoffTs) {
        return host.call('wf.handoffResolve', Object.assign({ name: handoffTs + '*' }, cwdArg)).then(function (res) {
          if (res && res.ok && res.file) return done(res.file)
          // 前缀未命中 → 回退取最新，但仅当最新文件名确实以 handoffTs 开头才引用（避免引用无关的旧文档）
          return host.call('wf.handoffLatest', cwdArg).then(function (r2) {
            const f = (r2 && r2.ok && r2.file) ? r2.file : null
            return done((f && f.indexOf(handoffTs) === 0) ? f : null)
          }).catch(function () { return done(null) })
        }).catch(function () { return done(null) })
      }
      // 副路径 B：刷新后 / 从未点第一击 → 走 wf.handoffLatest 探磁盘最新
      return host.call('wf.handoffLatest', cwdArg).then(function (res) {
        return done((res && res.ok && res.file) ? res.file : null)
      }).catch(function () { return done(null) })
    }
    export const doHandoff = function (st) {
      handoffTs = timeStampStr()
      const text = handoffPrompt(handoffTs)
      handoffFile = null  // 真实文件名由探测按 {ts}-*.md 前缀发现（含 AI 短标题），不再从模板解析
      inject(st, text)
      flash(st, tr('toast.injectedHandoff'), 'ok')
      // 轮询探测：AI 写成文档后右半亮蓝（真实文件名 = {ts}-<短标题>.md，按前缀匹配）；1s 间隔、~10min 窗口覆盖复杂文档
      probeHandoffReady(st)
      let tries = 0
      const tick = function () {
        if (handoffFile) return  // 已发现真实文件名 → 停止轮询
        if (++tries > 600) return  // 上限 ~10min（5min+ 复杂文档也覆盖）
        probeHandoffReady(st)
        if (timer !== undefined) timer.timeout(tick, 1000)
      }
      if (timer !== undefined) timer.timeout(tick, 1000)
    }
    let lastHandoffOpenTs = 0  // 防抖：防止 1s 内连点几十下反复探测/开会话
    export const doHandoffOpen = function (st) {
      const now = Date.now()
      if (now - lastHandoffOpenTs < 800) return  // 800ms 内重复点击忽略
      lastHandoffOpenTs = now
      st.handoffSearching = true; emit(st)  // 搜索动画：右半转圈
      const ws = ctx.get('workspaces')
      const doneSearch = function () { st.handoffSearching = false; emit(st) }  // 2s 后恢复，避免闪烁
      const finish = function (file, msg) {
        const text = handoffReadText(file, st.cwd)
        pendingDraft = text
        pendingDraftTargetSid = null
        copyText(st, text, msg || tr('toast.copiedHandoff'))
        if (ws && typeof ws.startSession === 'function') {
          ws.startSession()
        } else {
          pendingDraft = null
          pendingDraftTargetSid = null
        }
        setTimeout(doneSearch, 2000)  // 至少转 2s
      }
      // 引导门 v3（2026-08-18 rev）：无论本会话是否点过第一击，一律先探测磁盘真实文档——
      //   有 latest → 置 ready + 放行开新会话；没有 → toast 引导「请先点「交接」生成交接文档」，绝不打开空会话
      probeHandoffReady(st).then(function (file) {
        if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
        else { flash(st, tr('toast.handoffGrey'), 'warn'); setTimeout(doneSearch, 2000) }
      })
    }

    // #361：在新会话中打开 —— 同 cwd + 自动命名 + 预填指令
    //   契约（dsh-client-runtime ISessions）：create({cwd}) → SessionId；scope(sid) → AgentContext；
    //   sessionOf(ctx) → SessionFace.rename(title)；open(sid) 切换。任一步失败降级为当前会话注入 + 提醒。
    export const openTextInNewSession = function (st, text, title) {
      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      const doFallback = function () {
        inject(st, text)
        flash(st, tr('toast.newSessionManual', { title: title }), 'warn')
      }
      if (!sessions || typeof sessions.create !== 'function') { doFallback(); return }
      // v1.5：新会话默认继承「点击时所在会话」的工作区（st.cwd）；
      //   缺失时：1) 同步读 sessions.list（权威 cwd，避免 host 异步窗口）2) 再向 host 解析兜底
      const ensureCwd = function () {
        const sync = getCwdSync(st.sessionId)
        if (sync) {
          if (sync !== st.cwd) st.cwd = sync
          return Promise.resolve(sync)
        }
        if (st.cwd) return Promise.resolve(st.cwd)
        if (typeof host !== 'undefined' && typeof host.call === 'function' && st.sessionId) {
          return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
            if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
            return null
          }).catch(function () { return null })
        }
        return Promise.resolve(null)
      }
      // #60 修复：cwd → workspaceId 解析（session.create({cwd}) 不会自动归属工作区，需显式 workspaceId）
      const ensureWorkspaceId = function (cwd) {
        if (!workspaces || !cwd) return Promise.resolve(null)
        try {
          let items = []
          if (workspaces.list) {
            let snap = null
            try {
              if (typeof workspaces.list.getSnapshot === 'function') snap = workspaces.list.getSnapshot()
              else if (typeof workspaces.list.getCurrent === 'function') snap = workspaces.list.getCurrent()
            } catch (e2) {}
            if (snap) {
              if (Array.isArray(snap.items)) items = snap.items
              else if (Array.isArray(snap)) items = snap
              else if (snap.byId) {
                items = snap.items || []
              }
            }
          }
          const targetNorm = (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase())
          for (let i = 0; i < items.length; i++) {
            const w = items[i]
            const wPath = w.path || w.cwd
            if (wPath && (typeof keyOf === 'function' ? keyOf(wPath) : String(wPath||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()) === targetNorm) {
              const wid = w.workspaceId || w.id
              if (wid) return Promise.resolve(wid)
            }
          }
          if (typeof workspaces.create === 'function') {
            return workspaces.create({ path: cwd }).then(function (ws) {
              const wid = ws && (ws.workspaceId || ws.id)
              return wid || null
            }).catch(function () { return null })
          }
        } catch (e) {}
        return Promise.resolve(null)
      }
      ensureCwd().then(function (cwd) {
        if (!cwd) { doFallback(); return }
        ensureWorkspaceId(cwd).then(function (workspaceId) {
          const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }
          sessions.create(createOpts).then(function (sid) {
          // 新会话秒显共享缓存为唯一来源（#301 / #324）：同工作区共享缓存在 storeOf 已尝试水合，此处 cwd 刚赋值需再次水合
          // 移除“继承打开它的会话 snapshot”作为版本来源；无共享缓存时可作兜底
          const ns = storeOf(sid)
          if (ns) {
            ns.cwd = cwd
            const hydrated = (typeof hydrateFromCache === 'function' ? hydrateFromCache(ns) : false)
            if (!hydrated) {
              // 无共享缓存且源会话有快照且同工作区：临时兜底（避免首开无数据转圈）
              try {
                const hasShared = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
                if (!hasShared && st.snapshot && st.cwd && (typeof keyOf === 'function' ? keyOf(st.cwd) : String(st.cwd||'')) === (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||''))) {
                  ns.snapshot = st.snapshot
                  ns.snapMode = 'real'
                }
              } catch(eFb){ if (st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode='real'; } }
            }
            // 版本以最新 generatedMs 者胜：若源快照更新，则以最新者为准（hydrate 已处理，但兜底后需校正）
            try {
              const sharedSnap = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
              if (sharedSnap && ns.snapshot && sharedSnap.generatedMs && ns.snapshot.generatedMs && sharedSnap.generatedMs > ns.snapshot.generatedMs) {
                ns.snapshot = sharedSnap
              }
            } catch(eVer){}
          }
          // issuePath · 新会话锚点：把本次打开的 issue 记为新会话的起点（Q10 A+B）
          try {
            const __refs = (typeof issueRefNumbersFrom==='function') ? issueRefNumbersFrom(text) : [] // #231：锚点识别改由后端 linkPatternSource 驱动
            if (__refs.length && ns) {
              const __tg = String(title || '').slice(0,80)
              recordIssuePath(ns, __refs[0], 'claim', __tg)
              for (let _i=1; _i<__refs.length; _i++) recordIssuePath(ns, __refs[_i], 'mention', '')
            }
          } catch (e) {}
          // 自动命名（失败不阻塞打开）— 占位标题在创建前已确定，跟随 harness 语言；
          // 改名落定后把会话交给命名守护（#265）：以宿主实际接受的归一化占位标题为基准注册跟踪态，
          // 附面包屑语义线索；此后常驻渲染钩子按计划单执行草稿档升级，值比对锁守护手改。
          const __placeholderTitle = title
          try {
            const scopeCtx = sessions.scope(sid)
            const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
            const registerTracked = function (acceptedTitle) {
              try {
                const name0 = acceptedTitle || __placeholderTitle
                const isPlaceholder = (typeof isNewPlaceholderTitle === 'function' ? isNewPlaceholderTitle(name0) : /^\[New\] /.test(String(name0)))
                if (!isPlaceholder) return
                if (typeof host !== 'undefined' && typeof host.call === 'function') {
                  // #266：注册走 #211 复原名「注册监视」（wf.registerNewSessionWatcher，host 侧为收编跟踪态 + 索引基线）；
                  // wf.namingRegister 为 #265 兼容别名，双名同本体，守卫钉死。
                  host.call('wf.registerNewSessionWatcher', { sessionId: sid, baselineTitle: name0, cwd: cwd || '', hint: (ns ? namingHintOf(ns) : null) }).then(function () { namingGuardianKick() }).catch(function () {})
                }
              } catch (eReg) {}
            }
            const runRename = (face && typeof face.rename === 'function') ? Promise.resolve(face.rename(title)) : Promise.resolve(null)
            runRename.then(function (rRename) {
              const accepted = (rRename && rRename.ok && rRename.value && rRename.value.title) ? rRename.value.title : null
              registerTracked(accepted)
            }).catch(function () { registerTracked(null) })
          } catch (eName) { /* 命名失败忽略 */ }
          // 预填（r4）：写入 pendingDraft + 目标 sid 锚定，消费侧仅新会话消费，杜绝旧会话抢先
          pendingDraft = text
          pendingDraftTargetSid = sid
          sessions.open(sid)
          flash(st, tr('toast.newSessionOpened'), 'ok')
        }).catch(function () { doFallback() })
        })
      })
    }
    // #361 原入口：行级「在新会话打开」保留（rowActionText 文本 + 票标题命名）
    export const openInNewSession = function (st, x) {
      openTextInNewSession(st, rowActionText(st, x), newSessionTitle(x))
    }
    export const extractIssueRefs = function (text) {
      // #231：真源在各后端 links.linkPatternSource；无快照时经 shared 缓存解析，未达则 helper 内 LEGACY 过渡
      return (typeof issueRefNumbersFrom === 'function') ? issueRefNumbersFrom(text) : []
    }
    export const inject = (st, text) => {
      if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
      else copyText(st, text, tr('toast.copiedFallback'))
      // issuePath · 1C 提及识别（主路径 URL 扫描，零误判；#\d+ 辅路径待 toast 确认，首版仅 URL 自动记）
      try {
        const refs = extractIssueRefs(text)
        if (refs.length) {
          const titleGuess = (text && text.split('\n').slice(0, 3).join(' ').slice(0, 80)) || ''
          recordIssuePath(st, refs[0], 'mention', titleGuess)
          for (let i = 1; i < refs.length; i++) recordIssuePath(st, refs[i], 'mention', '')
          try { if (typeof host !== 'undefined' && typeof host.call === 'function') host.call('wf.issuePathPush', { number: refs[0], source: 'mention', title: titleGuess }).catch(function () {}) } catch (e) {}
        }
      } catch (e) {}
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
