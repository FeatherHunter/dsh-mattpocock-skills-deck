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
      if (logQueue.length >= LOG_QUEUE_MAX) { logDroppedState.count += 1; return }
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
        try { entries[entries.length - 1].truncated = true } catch (e) {}
      }
      const args = { entries: entries, droppedCount: logDroppedState.count }
      if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
        logDroppedState.count += entries.length
        return Promise.resolve({ ok: false, sent: 0 })
      }
      try {
        return host.call('wf.logBatch', args).then(function (res) {
          if (!res || res.ok !== true) logDroppedState.count += entries.length
          return { ok: !!(res && res.ok === true), sent: entries.length }
        }).catch(function () {
          logDroppedState.count += entries.length
          return { ok: false, sent: 0 }
        })
      } catch (e) {
        logDroppedState.count += entries.length
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
        return host.call('wf.logGetSwitch', {}).then(function (res) {
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
    // 设置页保存开关：先写宿主，宿主生效才更新本地与内存并广播；写失败保持本地旧值并返回失败，
    // 由调用处提示用户，不回退为开启（设计 1.3）。失败原因只给机器码（host-unavailable、host-rejected），
    // 面向用户的文案由界面批次经多语言系统转换，本底座不写中文字符串（文案完整性门禁要求新文件零中文串）。
    export const setLogSwitch = function (enabled, sampleRate) {
      const next = {
        enabled: enabled === true,
        sampleRate: (typeof sampleRate === 'number' && isFinite(sampleRate)) ? sampleRate : logSwitch.sampleRate,
      }
      if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: 'host-unavailable' })
      }
      try {
        return host.call('wf.logSetSwitch', next).then(function (res) {
          if (!res || res.ok !== true) return { ok: false, enabled: logSwitch.enabled, error: 'host-rejected' }
          logSwitch.enabled = res.enabled === true
          logSwitch.sampleRate = next.sampleRate
          persistLocalDebugSwitch(logSwitch)
          try { if (typeof broadcastLogSwitch === 'function') broadcastLogSwitch() } catch (e) {}
          return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
        }).catch(function (e) {
          return { ok: false, enabled: logSwitch.enabled, error: (e && e.message) || String(e) }
        })
      } catch (e) {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: (e && e.message) || String(e) })
      }
    }
