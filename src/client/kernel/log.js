/**
 * src/client/kernel/log.js — 内核模块（#490 client 底座，落实设计 #335 第 1、4 章的 client 部分）。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 *
 * 房间纪律：只用闭包里已有的名字（host、timer、localStorage、broadcastLogSwitch），
 * 不引用其他源文件，不新增跨文件导入；渲染函数里不为日志做对象转文本与字符串拼接。
 */
    // 本地开关存一份：新键 dsws.debug，形状为 { enabled 布尔, sampleRate 数字, rev 版本号 }，
    // 不动 dsws.cfg 现有字段（设计 1.3，沿 config.js 同例：读本地、全文覆写保存、失败不抛错）。
    export const LOG_DEBUG_KEY = 'dsws.debug'
    // 通道批量字面（设计 2.5 与 #489 附录：每批最多 50 条、每 1000 毫秒发一次、
    // 单包 128KB 或 100 条先到先截；失败丢弃并计数，不背压等待，不无界缓冲）。
    export const LOG_BATCH_MAX = 50
    export const LOG_FLUSH_MS = 1000
    export const LOG_PACKET_BYTES = 131072
    export const LOG_QUEUE_MAX = 100
    // 自监控看门狗阈值（#499）：开关写与启动对账超过这么多毫秒未回，就记一行告警自举证。
    export const LOG_WATCHDOG_MS = 5000
    // 开关形状版本号：以后开关加字段就把这里加一，旧本地值读到缺字段时用默认补齐。
    export const LOG_REV = 1
    // 级别只有四个：error、warn、info、debug（设计 1.2）。
    export const LOG_LEVELS = ['error', 'warn', 'info', 'debug']
    // 读本地开关（启动秒显用）：同步读本地存储，读不到或读坏都用默认（默认关闭）。
    export const readLocalDebugSwitch = function () {
      const fallback = { enabled: false, sampleRate: 1, rev: LOG_REV }
      try {
        const raw = localStorage.getItem(LOG_DEBUG_KEY)
        if (!raw) return fallback
        const saved = JSON.parse(raw)
        if (!saved || typeof saved !== 'object') return fallback
        return {
          enabled: saved.enabled === true,
          sampleRate: (typeof saved.sampleRate === 'number' && isFinite(saved.sampleRate)) ? saved.sampleRate : 1,
          rev: (typeof saved.rev === 'number' && isFinite(saved.rev)) ? saved.rev : LOG_REV,
        }
      } catch (e) { return fallback }
    }
    // 写本地开关：全文覆写，失败不抛错（沿命名守护同例），返回是否写成功。
    export const persistLocalDebugSwitch = function (state) {
      try {
        localStorage.setItem(LOG_DEBUG_KEY, JSON.stringify({
          enabled: !!(state && state.enabled),
          sampleRate: (state && typeof state.sampleRate === 'number' && isFinite(state.sampleRate)) ? state.sampleRate : 1,
          rev: (state && typeof state.rev === 'number' && isFinite(state.rev)) ? state.rev : LOG_REV,
        }))
        return true
      } catch (e) { return false }
    }
    // 开关内存值：顶层同步读本地，界面秒显不等待宿主；随后启动对账再向宿主看齐。
    // 对账前不产生调试日志（调用处外层判断此时读到的就是本地值）。
    export const logSwitch = readLocalDebugSwitch()
    // 内存批量队列：调用处只进队列就返回，不等转发完成；转发走宿主记录电话。
    export const logQueue = []
    // 累计丢弃数：队列满丢弃、超包裁剪、转发失败都只计数不抛错。
    export const logDroppedState = { count: 0 }
    // 转发汇总状态（#499 自监控 48）：只记上次汇总位置与最近一次丢弃原因，汇总行本身不逐条。
    export const logForwardState = { lastSummaryAt: 0, lastSummaryDropped: 0, lastReason: '' }
    export const logFlushTimer = { id: null }
    // 读当前级别是否允许产生日志；关闭时调用处直接返回（设计 1.4 外层判断纪律）。
    // 错误与告警始终允许；其余只在调试开关打开时允许（与宿主 logStore 同名同参同语义）。
    export const isEnabled = function (level) {
      if (level === 'error' || level === 'warn') return true
      try { return logSwitch.enabled === true } catch (e) { return false }
    }
    // 记一行日志：体内仍先判断一次再写，做漏加外层判断的兜底（设计 1.4）。
    // 但兜底拦不住调用前已求值的拼接，所以高频调用处仍必须写外层判断，不许省略。
    export const log = function (level, event, fields) {
      if (!isEnabled(level)) return
      if (logQueue.length >= LOG_QUEUE_MAX) { logDroppedState.count += 1; logForwardState.lastReason = 'queue-full'; return }
      logQueue.push({
        ts: Date.now(),
        level: level,
        event: String(event || ''),
        fields: (fields && typeof fields === 'object') ? fields : {},
      })
      if (level === 'error' || level === 'warn') scheduleLogFlush(true)
      else scheduleLogFlush(false)
    }
    // 安排一次转发：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次等待立刻发，
    // 但调用处仍只进队列就返回，不等转发完成，崩溃窗口只剩毫秒级）。
    export const scheduleLogFlush = function (immediate) {
      const later = function (fn, ms) {
        try {
          if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
        } catch (e) {}
        return setTimeout(fn, ms)
      }
      if (immediate) {
        if (logFlushTimer.id !== null) { try { clearTimeout(logFlushTimer.id) } catch (e) {} logFlushTimer.id = null }
        later(sendLogBatch, 0)
        return
      }
      if (logFlushTimer.id !== null) return
      logFlushTimer.id = later(function () { logFlushTimer.id = null; sendLogBatch() }, LOG_FLUSH_MS)
    }
    // 估算一次转发的包体积（只在转发时做，渲染路径不做对象转文本）。
    export const estimateBatchBytes = function (entries) {
      try {
        const text = JSON.stringify(entries)
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
        return String(text).length
      } catch (e) { return LOG_PACKET_BYTES + 1 }
    }
    // 转发汇总行（#499 自监控 48）：批量发送落定后，有新增丢弃才记一行；无丢弃的窗口不打扰。
    // 汇总行本身走告警直通再触发下一次发送，下一次无新增丢弃即止，链条自然终止。
    export const maybeForwardSummary = function () {
      const delta = logDroppedState.count - logForwardState.lastSummaryDropped
      if (delta <= 0) return
      logForwardState.lastSummaryDropped = logDroppedState.count
      const now = Date.now()
      const windowMs = now - logForwardState.lastSummaryAt
      logForwardState.lastSummaryAt = now
      try { log('warn', 'log.forward.summary', { droppedDelta: delta, totalDropped: logDroppedState.count, reason: logForwardState.lastReason || 'send-fail', windowMs: windowMs }) } catch (e) {}
    }
    // 散列小函数（与宿主房外埋点同算法；脱敏散列缺席时兜底用，纯散列不记原文）。
    export const hash8 = function (s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
    // 导出链路行（#499 自监控 50）：状态栏菜单与设置页两处复用；成功路径不调用，失败分支才记一行。
    export const logExportFail = function (op, reason, err) {
      try {
        if (typeof dswsLogHash === 'function' && typeof dswsLogTrunc === 'function') log('warn', 'log.export.fail', { op: op, reason: reason, errorHash: dswsLogHash(dswsLogTrunc(String((err && err.message) || err || reason), 120, 'error')) })
        else log('warn', 'log.export.fail', { op: op, reason: reason, errorHash: hash8(String((err && err.message) || err || reason)) })
      } catch (e) {}
    }
    // 开关看门狗（#499 自监控 49）：操作与 5 秒计时竞跑，计时先到记一行告警；原调用不取消、不重试、不改返回值。
    export const watchSwitchOp = function (op, pending) {
      let settled = false
      try { if (pending && typeof pending.then === 'function') pending.then(function () { settled = true }, function () { settled = true }) } catch (e) {}
      const fire = function () { if (!settled) { settled = true; try { log('warn', 'log.switch.watchdog', { op: op, timeoutMs: LOG_WATCHDOG_MS, stage: 'waiting-host' }) } catch (e) {} } }
      try {
        if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') { timer.timeout(fire, LOG_WATCHDOG_MS); return }
      } catch (e) {}
      try { setTimeout(fire, LOG_WATCHDOG_MS) } catch (e2) {}
    }
    // 发一批：一次最多 50 条；单包超 128KB 或队列超 100 条时先到先截，
    // 裁掉的记入丢弃数并在包尾最后一条记截断标记；失败整批记丢弃，不等待不重试。
    export const sendLogBatch = function () {
      if (logQueue.length === 0) return Promise.resolve({ ok: true, sent: 0 })
      const entries = logQueue.splice(0, LOG_BATCH_MAX)
      let trimmed = 0
      while (entries.length > 1 && estimateBatchBytes(entries) > LOG_PACKET_BYTES) { entries.pop(); trimmed += 1 }
      // 队列里还压着超过 100 条说明消费跟不上：只留 100 条，其余丢弃并计数（不无界缓冲）。
      while (logQueue.length > LOG_QUEUE_MAX) { logQueue.shift(); trimmed += 1 }
      if (trimmed > 0) {
        logDroppedState.count += trimmed
        logForwardState.lastReason = 'packet-trim'
        try { entries[entries.length - 1].truncated = true } catch (e) {}
      }
      const args = { entries: entries, droppedCount: logDroppedState.count }
      // 防自激：这一批如果只剩上一行汇总自己，失败只计数不再记新汇总，否则汇总会自己养活自己停不下来。
      const onlySummary = entries.length === 1 && entries[0] && entries[0].event === 'log.forward.summary'
      if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
        logDroppedState.count += entries.length
        logForwardState.lastReason = 'send-fail'
        if (!onlySummary) maybeForwardSummary()
        return Promise.resolve({ ok: false, sent: 0 })
      }
      try {
        return host.call('wf.logBatch', args).then(function (res) {
          if (!res || res.ok !== true) { logDroppedState.count += entries.length; logForwardState.lastReason = 'host-reject' }
          if (res && res.ok === true) maybeForwardSummary()
          else if (!onlySummary) maybeForwardSummary()
          return { ok: !!(res && res.ok === true), sent: entries.length }
        }).catch(function () {
          logDroppedState.count += entries.length
          logForwardState.lastReason = 'send-fail'
          if (!onlySummary) maybeForwardSummary()
          return { ok: false, sent: 0 }
        })
      } catch (e) {
        logDroppedState.count += entries.length
        logForwardState.lastReason = 'send-fail'
        if (!onlySummary) maybeForwardSummary()
        return Promise.resolve({ ok: false, sent: 0 })
      }
    }
    // 立刻转发一次（取消本次防抖等待）；客户端侧的 flush 只管转发，不管落盘。
    export const flush = function () {
      if (logFlushTimer.id !== null) { try { clearTimeout(logFlushTimer.id) } catch (e) {} logFlushTimer.id = null }
      try { sendLogBatch() } catch (e) {}
      return { ok: true }
    }
    // 读累计丢弃数（队列满与转发失败都只计数不抛错，与宿主同名同参）。
    export const getDroppedCount = function () {
      return logDroppedState.count
    }
    // 启动对账：向宿主读开关，以宿主为准（设计 1.3）；宿主不可用或读失败就保持本地值，
    // 不回退为开启，不抛错，不产生调试日志。成功后持久化到本地并向全组广播。
    export const reconcileLogSwitch = function () {
      if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate })
      }
      try {
        const pendingGet = host.call('wf.logGetSwitch', {})
        watchSwitchOp('reconcile', pendingGet)
        return pendingGet.then(function (res) {
          if (!res || res.ok !== true) return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
          logSwitch.enabled = res.enabled === true
          if (typeof res.sampleRate === 'number' && isFinite(res.sampleRate)) logSwitch.sampleRate = res.sampleRate
          persistLocalDebugSwitch(logSwitch)
          try { if (typeof broadcastLogSwitch === 'function') broadcastLogSwitch() } catch (e) {}
          return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
        }).catch(function () {
          return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
        })
      } catch (e) {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate })
      }
    }
    // 开关写失败分类行（#526）：写开关是低频用户动作，三条失败路各落一条告警行。
    // 复用现成常驻事件 host.call.fail（不新增事件名、不碰 54 总数），字段只用白名单三键；
    // 告警级始终落盘、不依赖调试开关，下次导出日志即可看出是哪一类失败。
    const logSwitchSetFail = function (kind, hint) {
      try {
        log('warn', 'host.call.fail', {
          method: 'wf.logSetSwitch',
          kind: 'set-switch-' + kind,
          errorHash: hash8(String(hint === undefined || hint === null ? kind : hint).slice(0, 120)),
        })
      } catch (e) {}
    }
    // 调用抛错再按文案分一小类：未知端点与连接不可用各单列，其余归通用抛错。
    // 只做归类、不记原文（原文只进散列），低频路径、关闭时零代价。
    const switchThrowKind = function (e) {
      const msg = String((e && (e.code || e.message)) || e || '')
      if (/unknown endpoint/i.test(msg)) return 'throw-unknown-endpoint'
      if (/connection|host\.call 不可用|unavailable/i.test(msg)) return 'throw-connection'
      return 'throw'
    }
    // 写开关代际（#526 灰掉案）：调用 hang 住时超时放行，迟到回包按代际丢弃，不碰状态、不记新行。
    const setLogSwitchGen = { n: 0 }
    // 设置页保存开关：先写宿主，宿主生效才更新本地与内存并广播；写失败保持本地旧值并返回失败，
    // 由调用处提示用户，不回退为开启（设计 1.3）。失败原因只给机器码（host-unavailable、host-rejected），
    // 面向用户的文案由界面批次经多语言系统转换，本底座不写中文字符串（文案完整性门禁要求新文件零中文串）。
    export const setLogSwitch = function (enabled, sampleRate) {
      const next = {
        enabled: enabled === true,
        sampleRate: (typeof sampleRate === 'number' && isFinite(sampleRate)) ? sampleRate : logSwitch.sampleRate,
      }
      if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
        logSwitchSetFail('host-unavailable', 'host-unavailable')
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: 'host-unavailable' })
      }
      try {
        const pendingSet = host.call('wf.logSetSwitch', next)
        watchSwitchOp('set', pendingSet)
        // 超时放行（#526 灰掉案）：调用 hang 住不再卡死界面，与看门狗同超时；
        // 无计时器时永不超时，原样等待（行为退化到修前）。
        const myGen = (setLogSwitchGen.n += 1)
        const timeoutAt = new Promise(function (resolve) {
          const fire = function () { resolve({ switchTimedOut: true }) }
          try {
            if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') { timer.timeout(fire, LOG_WATCHDOG_MS); return }
          } catch (e) {}
          try { setTimeout(fire, LOG_WATCHDOG_MS) } catch (e2) {}
        })
        return Promise.race([pendingSet, timeoutAt]).then(function (res) {
          if (res && res.switchTimedOut === true) {
            logSwitchSetFail('timeout', 'timeout-' + LOG_WATCHDOG_MS)
            return { ok: false, enabled: logSwitch.enabled, error: 'switch-timeout' }
          }
          if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: 'stale' }
          if (!res || res.ok !== true) {
            logSwitchSetFail('host-rejected', 'host-rejected')
            return { ok: false, enabled: logSwitch.enabled, error: 'host-rejected' }
          }
          logSwitch.enabled = res.enabled === true
          logSwitch.sampleRate = next.sampleRate
          persistLocalDebugSwitch(logSwitch)
          try { if (typeof broadcastLogSwitch === 'function') broadcastLogSwitch() } catch (e) {}
          return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
        }).catch(function (e) {
          if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: 'stale' }
          logSwitchSetFail(switchThrowKind(e), (e && (e.code || e.message)) || e)
          return { ok: false, enabled: logSwitch.enabled, error: (e && e.message) || String(e) }
        })
      } catch (e) {
        logSwitchSetFail(switchThrowKind(e), (e && (e.code || e.message)) || e)
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: (e && e.message) || String(e) })
      }
    }
