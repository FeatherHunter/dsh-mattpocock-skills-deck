/**
 * src/client/kernel/api-naming.js — 内核模块（#457 由 api.js 拆出之交接头、草稿、预设与建会话、命名守护）
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
    // ============ 单点工厂 createPTCSession 原子化（#363 · 承接 #361 闸门与 #362 可判定门禁）============
    // 目标：任何入口新建会话必为 PTC 且已归属工作区且首条可原子化注入，三者同一次创建内成立。
    // 工厂是会话创建的唯一出口：所有新建分支都经此函数，入参显式携带 agentPreset:'ptc'。
    // 复用闸门同步谓词：可复用仅当 blank 并且预设健康（首版字面 code 判不健康）并且工作区键非空且等于目标。
    // 空永不复用：空工作区隔离，切断空对空与空对非空的跨区污染（#361 空文件夹幽灵 选 A）。
    export const getRowPreset = function(row) {
      if (!row) return ''
      try {
        if (row.projectionValues && typeof row.projectionValues.agentPreset === 'string' && row.projectionValues.agentPreset) return row.projectionValues.agentPreset
      } catch (e) {}
      try {
        if (row.header && typeof row.header.agentPreset === 'string' && row.header.agentPreset) return row.header.agentPreset
      } catch (e2) {}
      return ''
    }
    export const isHealthyPreset = function(preset) {
      // V1 仅字面 code 判不健康，二期扩展 broken 泛化（#361 选项权衡 判据形态 选 A）
      return String(preset || '') !== 'code'
    }
    export const isReusableBlank = function(row, normTarget) {
      if (!row || !row.blank) return false
      const preset = getRowPreset(row)
      if (!isHealthyPreset(preset)) return false
      const rawCwd = row.cwd || ''
      let normRow = ''
      try {
        normRow = typeof keyOf === 'function' ? keyOf(rawCwd) : String(rawCwd || '').trim()
        if (typeof keyOf !== 'function') {
          let tmp = String(rawCwd || '').trim().toLowerCase().split(String.fromCharCode(92)).join('/')
          while (tmp.indexOf('//') >= 0) tmp = tmp.split('//').join('/')
          while (tmp.length > 1 && tmp.charAt(tmp.length - 1) === '/') tmp = tmp.slice(0, -1)
          normRow = tmp
        }
      } catch (e) {
        let tmp = String(rawCwd || '').trim().toLowerCase().split(String.fromCharCode(92)).join('/')
        while (tmp.indexOf('//') >= 0) tmp = tmp.split('//').join('/')
        while (tmp.length > 1 && tmp.charAt(tmp.length - 1) === '/') tmp = tmp.slice(0, -1)
        normRow = tmp
      }
      if (!normRow) return false
      if (normRow !== normTarget) return false
      return true
    }
    export const buildCreateOpts = function(workspaceId, cwd) {
      // 单点入参构造：有工作区标识优先，无则回落路径，但两分支必带 agentPreset:'ptc'（#362 判据 P）
      // #364：回退矩阵的唯一显式锚点——workspaceId 有则走 {workspaceId,ptc}，无则走 {cwd,ptc}，
      //   两分支互斥（防 bad-request workspaceId+cwd 同传），且 cwd 即使为空也携带 ptc 让上层 doFallback 之前仍满足 P。
      if (workspaceId) return { workspaceId: workspaceId, agentPreset: 'ptc' }
      return { cwd: cwd, agentPreset: 'ptc' }
    }
    export const createPTCSession = function(sessions, workspaceId, cwd, text) {
      // 单点工厂：唯一调用 sessions.create 的出口，显式 ptc + 工作区 + 首条原子化（#363）
      // #364 保真与兼容增强：首条在同链路内原子化挂载 pendingDraft+targetSid；
      //   若首次创建因 alpha 新参（workspaceId 不认 / agentPreset 更名）抛错，则自动回退到 {cwd,ptc} 或兼容 presetId 重试，
      //   仍保证 ptc 显式且首条不丢，避免因底座入参变化导致创建链中断而丢首条。
      if (!sessions || typeof sessions.create !== 'function') return Promise.reject(new Error('sessions.create not available'))
      const opts = buildCreateOpts(workspaceId, cwd)
      const doCreate = function (o) { try { return sessions.create(o) } catch (eSync) { return Promise.reject(eSync) } }
      return doCreate(opts).then(function(sid) {
        // 首条原子化：与创建同链路挂载 pendingDraft，消费侧以 targetSid 锚定避免旧会话抢消费（#315 r4）
        pendingDraft = text
        pendingDraftTargetSid = sid
        return sid
      }).catch(function(err) {
        const msg = String((err && err.message) || err || '')
        // 回退 1：workspaceId 不认 → 回落 cwd+ptc（兼容 workspaceId 必填化回退或未登记场景）
        const hasWid = !!(opts && opts.workspaceId)
        if (hasWid && /workspaceId|workspace/i.test(msg) && /bad-request|unknown|invalid|not.*found/i.test(msg)) {
          const fb = buildCreateOpts(null, cwd)
          return doCreate(fb).then(function(sid2) {
            pendingDraft = text
            pendingDraftTargetSid = sid2
            return sid2
          })
        }
        // 回退 2：agentPreset 更名兼容（如 presetId）→ 试探兼容键
        if (/agentPreset|preset/i.test(msg) && /bad-request|unknown|invalid/i.test(msg)) {
          const alt = hasWid ? { workspaceId: workspaceId, presetId: 'ptc' } : { cwd: cwd, presetId: 'ptc' }
          // 同时尝试 agentPresetId 兜底
          return doCreate(alt).catch(function() {
            const alt2 = hasWid ? { workspaceId: workspaceId, agentPresetId: 'ptc' } : { cwd: cwd, agentPresetId: 'ptc' }
            return doCreate(alt2)
          }).then(function(sid3) {
            pendingDraft = text
            pendingDraftTargetSid = sid3
            return sid3
          })
        }
        throw err
      })
    }
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
    export function namingHintOf(st) {
      // 彻底移除：原从 issuePath 面包屑取线索（#345），现恒为 null
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
        target = composeDraftTitle({ hint: o.hint, lang: langIsEn ? 'en' : 'zh', baselineTitle: (o.lock && o.lock.baselineTitle) || '' })
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
        target = composeDraftTitle({ hint: f.hint, lang: langIsEn ? 'en' : 'zh', baselineTitle: (lock && lock.baselineTitle) || '' })
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