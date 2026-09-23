/**
 * src/client/kernel/attention-heartbeat.js — 内核模块（#707 第二阶段：视野模型 + 心跳 + 客户端节拍）
 *
 * 这个文件回答一个问题：**「我在看哪个工作区」这件事，界面怎么可靠地说给宿主听。**
 * 它只做四件事，一件都不多做（节拍、重试、配额判断都不在界面这一层，界面没有能力犯错）：
 *   ① 给这个窗口造一个身份：平台不提供窗口身份与焦点信号（research/dsh-platform-facts-2026-09-23.md 第三节），
 *      所以标识由客户端自己造，放 sessionStorage —— **不能放 localStorage**（同源所有窗口共享，
 *      后写覆盖先写，几个窗口会互相冒充）。sessionStorage 的寿命正好是「这个标签页/窗口的这一份会话」。
 *   ② 在会话切换、面板打开、窗口获焦时上报一次「我在看谁」（工作区根，不是会话目录）。
 *   ③ 面板可见时每 20 秒一次**本地心跳**：零配额、不出网，只上报「界面还在看这个工作区」这个事实。
 *   ④ 把宿主回话里的探测间隔与处境（是不是在活跃集合里）交给同一闭包的探测循环，界面自己不做判断。
 *
 * 依据：docs/architecture/refresh-budget-architecture.html 第三章「界面层」与第四章第 02 件
 * （心跳、信号失效怎么办、多窗口的兜底）。心跳间隔来自契约层 SYNC.ATTENTION_HEARTBEAT_MS
 * （与 refresh-core/src/budget.ts 的同一个数同源，客户端半边不 import 核心产物，见 tracker/sync.js 头）。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，
 * 把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内原位），一源两物、src 零复制。
 * 依赖同闭包的 host / stores / shared / wsKeyOf / dshLogHash / isEnabled / log / tr，都在运行时调用。
 */
    /** 这个窗口的身份：sessionStorage 里现造一个，造不出来就退回内存里那一个（绝不退回空串）。 */
    export let _attentionWindowId = ''
    export const attentionWindowId = function () {
      if (_attentionWindowId) return _attentionWindowId
      try {
        const k = 'dsws.windowId'
        const got = (typeof sessionStorage !== 'undefined' && sessionStorage) ? sessionStorage.getItem(k) : ''
        if (got) { _attentionWindowId = String(got); return _attentionWindowId }
        // 造一个够短的随机标识：时间戳 + 随机片段。它不是密钥，只是「这个窗口和那个窗口不一样」。
        const made = 'w' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36)
        try { if (typeof sessionStorage !== 'undefined' && sessionStorage) sessionStorage.setItem(k, made) } catch (eSet) {}
        _attentionWindowId = made
      } catch (e) {
        // sessionStorage 整个不可用（隐私模式、被策略挡掉）：退回内存里的那一个，本窗口内仍然稳定。
        _attentionWindowId = 'w' + Date.now().toString(36) + '-mem'
      }
      return _attentionWindowId
    }
    /** 面板此刻可不可见（页签藏起来时 document.visibilityState 会说 hidden）。 */
    export const attentionVisible = function () {
      try { return !(typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') } catch (e) { return true }
    }
    /** 最近一次人类输入是什么时候（点击 / 按键 / 滚轮 / 触摸）。心跳只证明「还看着」，这一条才是「真有人在用」。 */
    export let _attentionHumanAt = 0
    export const attentionNoteHuman = function () { try { _attentionHumanAt = Date.now() } catch (e) {} }
    /** 这个工作区根对应的那个会话状态（面板正在看的那个；shared 优先，其次任意一个非空 cwd 的 store）。 */
    export const attentionStoreOf = function (st) {
      if (st && st.cwd) return st
      try { if (shared && shared.cwd) return shared } catch (e0) {}
      try {
        const keys = Object.keys(stores)
        for (let i = 0; i < keys.length; i++) { const one = stores[keys[i]]; if (one && one.cwd) return one }
      } catch (e1) {}
      return st || null
    }
    /** 这个会话现在在看哪个工作区根：优先用宿主已经答过的那个值（wf.cwd 顺路带回，零额外请求）。 */
    export const attentionRootOf = function (st) {
      const one = attentionStoreOf(st)
      if (!one) return ''
      try {
        const known = String(one.sessionWorkspaceRoot || '').trim()
        if (known) return known
        const cached = (typeof getCachedSnapshot === 'function') ? getCachedSnapshot(one.cwd || '') : null
        if (cached && cached.workspaceRoot) return String(cached.workspaceRoot)
        if (one.snapshot && one.snapshot.workspaceRoot) return String(one.snapshot.workspaceRoot)
        // 拿不到权威的工作区根就报所选目录本身：宿主那一侧会照同一把尺子（canonicalKey）再锚一次根，
        // 所以这里报粗一点也不会算成两个工作区。
        return String(one.cwd || '')
      } catch (e) { return '' }
    }
    /** #707：宿主对同一条目录的两种写法算两个工作区就白省了额度，所以上报前先按工作区键洗一次。 */
    export const attentionKeyOf = function (cwd) {
      try { return (typeof wsKeyOf === 'function') ? wsKeyOf(String(cwd || '')) : String(cwd || '').toLowerCase() } catch (e) { return String(cwd || '') }
    }
    /** 位置态：这个工作区根现在按什么间隔探测、我在不在活跃集合里、上限几个（宿主只说事实，界面不自己判）。 */
    export const _attentionPlan = { root: '', intervalMs: 0, lingerMs: 0, standing: '', limit: 0, atMs: 0 }
    /** 上一次心跳是什么时候（同一窗口内只用来判「该不该再报一次」，不做节流决策）。 */
    export let _attentionLastBeatAt = 0
    /** 最近一次「宿主真的收下了我的上报」是什么时候（毫秒时刻）。它断流就是断流，界面不许把故障装成安静。 */
    export let _attentionAckAt = 0
    /** #707：90 秒内没有任何回话 → 自动刷新已被宿主停掉，界面要直说「自动刷新已暂停」（第 10 章那句话的读取点）。 */
    export const ATTENTION_SILENT_MS = 90000
    export const attentionSuspended = function () {
      try {
        if (!_attentionAckAt) return false
        return (Date.now() - _attentionAckAt) > ATTENTION_SILENT_MS
      } catch (e) { return false }
    }

    /**
     * 上报一次「我在看谁」。kind 见 refresh-core/src/attention.ts 的取值表：focus / panel-open /
     * session-switch / heartbeat / window-blur / panel-hidden。
     * 三件事同时发生：① 立刻把旧快照铺满（同步，≤100 毫秒，见 kernel/probe-snapshot.js 的缓存优先）；
     * ② 这一条跨边界调用按日志纪律记一行；③ 回话里的间隔交给探测循环。
     */
    export const reportWorkspaceAttention = function (st, kind, syncFirst) {
      try {
        const one = attentionStoreOf(st)
        if (typeof syncFirst === 'function') syncFirst()
        if (typeof host === 'undefined' || typeof host.call !== 'function') return Promise.resolve(null)
        const root = attentionRootOf(one)
        if (!root) return Promise.resolve(null)
        const args = {
          windowId: attentionWindowId(),
          workspaceRoot: root,
          kind: kind || 'focus',
          visible: attentionVisible(),
          lastHumanInputMs: _attentionHumanAt || 0,
        }
        const t0 = Date.now()
        const p = host.call('wf.focus', args)
        return p.then(function (res) {
          try {
            const okRes = !!(res && res.ok)
            if (okRes) log('info', 'host.call', { method: 'wf.focus', latencyMs: Date.now() - t0, ok: true, kind: String(kind || 'focus') })
            else log('warn', 'host.call.fail', { method: 'wf.focus', kind: String(kind || 'focus'), errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'focus-not-ok'), 120, 'error')) })
          } catch (eL) {}
          try { if (res && res.ok) adoptAttentionPlan(res, root) } catch (ePlan) {}
          return res        }).catch(function (e) {
          try { log('warn', 'host.call.fail', { method: 'wf.focus', kind: String(kind || 'focus'), errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
          return null
        })
      } catch (e) { return Promise.resolve(null) }
    }
    /** 收下宿主的回话：这个根按多少毫秒探一次、我在不在活跃集合里。界面据此起停那条本地探测。 */
    export const adoptAttentionPlan = function (res, root) {
      _attentionPlan.root = String((res && res.root) || root || '')
      _attentionPlan.standing = String((res && res.standing) || '')
      _attentionPlan.limit = (res && typeof res.limit === 'number') ? res.limit : 0
      _attentionPlan.atMs = Date.now()
      // 只有真收下过回话才记这一笔：断流时这个时刻会停在原地，界面据此说「自动刷新已暂停」。
      if (res && res.ok) _attentionAckAt = Date.now()
      const interval = (res && typeof res.probeIntervalMs === 'number') ? res.probeIntervalMs : 0
      const linger = (res && typeof res.probeIntervalLingerMs === 'number') ? res.probeIntervalLingerMs : 0
      _attentionPlan.intervalMs = interval > 0 ? interval : 0
      _attentionPlan.lingerMs = linger > 0 ? linger : 0
      try { if (typeof startActiveProbeLoop === 'function') startActiveProbeLoop() } catch (eLoop) {}
      return _attentionPlan
    }
    /** 界面要说的那句话：这个工作区根现在在不在被刷新的那一档（不在 →「未在刷新（同时活跃上限 2）」）。 */
    export const attentionStandingOf = function (cwd) {
      try {
        const key = attentionKeyOf(cwd)
        if (!_attentionPlan.root || !key) return ''
        if (attentionKeyOf(_attentionPlan.root) !== key) return ''
        return _attentionPlan.standing || ''
      } catch (e) { return '' }
    }

    /**
     * 20 秒一次的本地心跳。零配额、不出网那一半说的是「它不引发任何探测」：它只上报事实。
     * 三条门在源头上就把它掐掉 —— 面板不可见、窗口不在前台、最近一分钟没有任何人类输入（人走开了的窗口
     * 不该靠心跳一直霸着活跃名额）。三条任何一条不成立，连 host.call 都不发。
     */
    export const attentionBeat = function () {
      try {
        if (!attentionVisible()) return
        try { if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) return } catch (eF) {}
        if (!_attentionHumanAt || (Date.now() - _attentionHumanAt) > 60000) return
        _attentionLastBeatAt = Date.now()
        reportWorkspaceAttention(null, 'heartbeat', null)
      } catch (e) {}
    }
    /** 心跳定时器（只起一个；跨 reload 时清掉旧的，与 #232 那条探测定时器同一个防重复做法）。 */
    export const startAttentionHeartbeat = function () {
      try {
        if (typeof globalThis !== 'undefined' && globalThis.__dswsOldBeatTimer) {
          try { clearInterval(globalThis.__dswsOldBeatTimer) } catch (eOld) {}
          globalThis.__dswsOldBeatTimer = null
        }
        if (shared._beatTimer) return
        if (timer === undefined || typeof timer.interval !== 'function') return
        shared._beatTimer = timer.interval(function () { attentionBeat() }, ((typeof SYNC === 'object' && SYNC && SYNC.ATTENTION_HEARTBEAT_MS) || 20000))
        if (typeof globalThis !== 'undefined') globalThis.__dswsOldBeatTimer = shared._beatTimer
      } catch (e) {}
    }
    /** 装监听：窗口获焦、页签可见性变化、人类输入三样。幂等（只装一次）。 */
    export const startAttentionSignals = function () {
      try {
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('visibilitychange', function () {
            try { if (attentionVisible()) reportWorkspaceAttention(null, 'focus', null) } catch (eV) {}
          })
          // 有人动过：记下时刻。心跳只证明「还看着」，这一条才是「真有人在用」（被动回前台不算）。
          const human = function () { attentionNoteHuman() }
          document.addEventListener('pointerdown', human, true)
          document.addEventListener('keydown', human, true)
          document.addEventListener('wheel', human, true)
          document.addEventListener('touchstart', human, true)
        }
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('focus', function () { try { reportWorkspaceAttention(null, 'focus', null) } catch (eW) {} })
          window.addEventListener('blur', function () { try { reportWorkspaceAttention(null, 'window-blur', null) } catch (eB) {} })
        }
      } catch (e) {}
      startAttentionHeartbeat()
    }
    /** 页面要关掉/销毁时最后报一次「我不再活跃了」（能发出去就发，发不出去也不留尾巴）。 */
    export const stopAttentionSignals = function () {
      try { reportWorkspaceAttention(null, 'panel-hidden', null) } catch (e) {}
      try { if (shared._beatTimer && typeof clearInterval === 'function') clearInterval(shared._beatTimer) } catch (e2) {}
      try { shared._beatTimer = null } catch (e3) {}
    }
