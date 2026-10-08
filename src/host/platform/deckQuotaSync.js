// src/host/platform/deckQuotaSync.js —— 剩余额度读数的那截接线（#758）
//
// 只讲一件事：闸的裁决要看剩余额度，可剩余额度读数从没有任何一路写入
// （账本的 syncDue / syncServer 都在，调它的生产代码一处都没有）。
// 重启后剩余额度恒为零，读请求撞上保底线、工具调用撞上红档，
// 七个工具在闸口就被诚实推迟——干跑码钓到的 gate-defer 就是它。
//
// 修法不是改裁决数字（那是定版政策，另立票才动），而是把设计好的同步接上：
// 工具动手前先看账本差不差这一次读数，差就经闸打一次免费的 `gh api rate_limit`
// （裁决里 quota-read 恒放行，不扣配额），读数落账后再走原流程。
// 进程里 60 秒最多打一次（节拍归账本），并发调用只打一次（本实例内并单）。
// gh 不在、没登录、解析不出，三种都认失败并让原流程照旧被闸推迟——
// 如实，不抛，不替工作区攒失败计数（perform 内吞掉，不进退避）。
//
// 住在平台区：宿主层文件之间不许互相引用，平台区是被排除的位置。
// 本文件零导入，闸、账本、起 gh 三件全由接线方显式传入。
// 日志不新增：走闸与落账自带既有的 gh.exec 与 quota.spend 两行。

/** 从 `gh api rate_limit` 的 stdout 里取出两桶读数，缺任何一格都算失败。 */
export function parseRateLimit(text) {
  try {
    const body = JSON.parse(String(text || ''))
    const resources = body && body.resources
    if (!resources || typeof resources !== 'object') return null
    const core = resources.core
    const graphql = resources.graphql
    if (!core || typeof core !== 'object' || !graphql || typeof graphql !== 'object') return null
    const num = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : null }
    const limit1 = num(core.limit)
    const remaining1 = num(core.remaining)
    const reset1 = num(core.reset)
    const limit2 = num(graphql.limit)
    const remaining2 = num(graphql.remaining)
    const reset2 = num(graphql.reset)
    if (limit1 === null || remaining1 === null || reset1 === null) return null
    if (limit2 === null || remaining2 === null || reset2 === null) return null
    return {
      rest: { limit: limit1, remaining: remaining1, reset: reset1 },
      graphql: { limit: limit2, remaining: remaining2, reset: reset2 },
    }
  } catch (e) { return null }
}

export function createDeckQuotaSync(deps) {
  const d = deps || {}
  const send = d.send
  const syncDue = d.syncDue
  const syncServer = d.syncServer
  const noteRateLimited = d.noteRateLimited
  const runGh = d.runGh
  const logCtx = d.logCtx || null
  // 失败冷却：gh 不在的机器上失败是常态，不加冷却每次调用白起一次失败的 gh。
  // 成功清零，失败记时，冷却内直接认失败（调用方照旧被闸推迟）。
  const cooldownMs = (typeof d.cooldownMs === 'number' && d.cooldownMs >= 0) ? Math.floor(d.cooldownMs) : 60000
  let lastFailAt = 0

  // 读数落账这一笔留痕（常驻：进程里 60 秒至多一次，跨进程边界，低频）。
  // 成功记既有 host.call；失败靠既有 gh.exec / gh.resolve.fail 那几行，不另记（缺 gh 的机器不刷屏）。
  function fireSynced(ms) {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'deck.quotaSync', latencyMs: ms, ok: true, kind: 'deck-tool' }) } catch (eL) {}
  }

  let flying = null

  function doSync(cwd, workspaceKey) {
    if (flying) return flying
    flying = (async function () {
      const t0 = Date.now()
      try {
        if (typeof send !== 'function' || typeof runGh !== 'function' || typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
        let applied = false
        await send(
          { source: 'quota.sync', kind: 'quota-read', bucket: 'rest', workspaceKey: String(workspaceKey || 'unknown'), plan: [{ phase: 'rate-limit' }] },
          async function () {
            // perform 内永不抛：gh 起不来或解析不出都只记失败，不进工作区的失败退避计数。
            try {
              const r = await runGh(['api', 'rate_limit'], cwd)
              const readings = r && r.ok ? parseRateLimit(r.text) : null
              if (readings) {
                try { syncServer(readings); applied = true } catch (eS) {}
                // #927 ①：读数里哪一桶剩 0，就说明这一桶已经用完——按服务端给的「重置时刻」降档到那时为止。
                // 秒数取自读数自己的 reset（服务端给的数，不是编的）；拿不到正秒数就不报（noteRetryAfter 会抛）。
                try {
                  if (typeof noteRateLimited === 'function') {
                    for (const b of ['rest', 'graphql']) {
                      const x = readings[b]
                      if (!x || x.remaining !== 0) continue
                      const resetMs = (x.reset > 1e12) ? x.reset : x.reset * 1000
                      const secs = Math.round((resetMs - Date.now()) / 1000)
                      if (secs > 0) noteRateLimited(b, secs, String(workspaceKey || 'unknown'))
                    }
                  }
                } catch (eN) {}
              }
            } catch (eR) {}
            return { requests: 1, points: 0 }
          },
        )
        if (applied) { fireSynced(Date.now() - t0); return { ok: true, fresh: true } }
        return { ok: false, reason: 'sync-empty' }
      } catch (e) { return { ok: false, reason: 'sync-threw' } } finally {
        flying = null
      }
    })()
    return flying
  }

  /**
   * 动手前保一次读数：账本说不差就直接过，差就打一次免费的。
   * 任何一步走不通都回不成功，调用方照旧走原流程（闸会诚实推迟）。
   * 本函数永不抛。
   */
  async function ensureReading(cwd, workspaceKey) {
    try {
      if (typeof syncDue === 'function' && !syncDue()) return { ok: true, fresh: false }
      if (typeof syncDue !== 'function' && typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
      if (lastFailAt !== 0 && Date.now() - lastFailAt < cooldownMs) return { ok: false, reason: 'sync-cooldown' }
      const r = await doSync(cwd, workspaceKey)
      if (r && r.ok) lastFailAt = 0
      else if (lastFailAt === 0) lastFailAt = Date.now()
      return r
    } catch (e) { return { ok: false, reason: 'ensure-threw' } }
  }

  return { ensureReading: ensureReading, parseRateLimit: parseRateLimit }
}
