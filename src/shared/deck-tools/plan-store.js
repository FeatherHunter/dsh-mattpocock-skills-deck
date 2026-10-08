// src/shared/deck-tools/plan-store.js —— 批量建图的续跑游标（#895）
//
// 为什么有这个文件：批量建图是多步写，任何一步之后都可能超时。游标记下
// “地图票号、已建子票、已建边”，同计划标识重跑时跳过已建。幂等锚（票正文
// 里那一行）永远是权威——游标只是加速器，对不上时以锚与读回为准。
// 落盘形态：一个工作区一个目录，一个计划一个小 JSON；成功即删、过期即清。
// 接口全异步（load/save/remove 皆回 Promise），内存与落盘同一套形状。
// 住共享层、零导入（同层禁互引）：读写文件的本事由调用方以 io 传进来。
// 日志：静默持久化，不新增事件名（成败 already 体现在工具回执里）。

function hash8(t) {
  let h = 5381; const s = String(t || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}
function safeName(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'plan' }
function num(v, d) { const n = (typeof v === 'number' && isFinite(v)) ? v : NaN; return isNaN(n) ? d : n }

/** 进程内存形态（宿主没给落盘能力时的退路；返回值里如实说 durable:false）。 */
export function createMemoryPlanStore() {
  const table = new Map()
  return {
    durable: false,
    load: async function (planId) { return table.get(String(planId)) || null },
    save: async function (planId, state) { table.set(String(planId), state) },
    remove: async function (planId) { table.delete(String(planId)) },
  }
}

/**
 * 落盘形态。io：{ readText(path), writeText(path, text), mkdir(path) }，
 * 读不到文件时 readText 应抛错或回空（都按“没有”处理）；缺任一即退化成内存形态。
 * dir：目录；workspaceKey：工作区键（隔离文件名）；now：取时间；ttlMs：过期毫秒数。
 * 读到坏 JSON 按没有处理（锚权威兜底）；写失败吞掉（内存里那份还在）。
 */
export function createFilePlanStore(opt) {
  const o = opt || {}
  const io = o.io || {}
  const dir = String(o.dir || '')
  const ws = String(o.workspaceKey || 'ws')
  const nowFn = (typeof o.now === 'function') ? o.now : Date.now
  const ttl = num(o.ttlMs, 7 * 24 * 3600 * 1000)
  const mem = createMemoryPlanStore()
  const canDisk = dir && typeof io.readText === 'function' && typeof io.writeText === 'function'
  if (!canDisk) return mem
  function fileOf(planId) { return dir + '/deck-plan-' + safeName(ws) + '-' + safeName(planId) + '.json' }
  async function mkdirBestEffort() {
    try { if (typeof io.mkdir === 'function') await io.mkdir(dir) } catch (e) {}
  }
  function fresh(state) {
    if (!state || typeof state !== 'object') return null
    const at = num(state.updatedAt, 0)
    if (at > 0 && (nowFn() - at) > ttl) return null
    return state
  }
  return {
    durable: true,
    load: async function (planId) {
      let text = null
      try { text = await io.readText(fileOf(planId)) } catch (e) { return mem.load(planId) }
      if (text === null || text === undefined || text === '') return mem.load(planId)
      try { return fresh(JSON.parse(String(text))) } catch (e) { return mem.load(planId) }
    },
    save: async function (planId, state) {
      const stamped = Object.assign({}, state, { updatedAt: nowFn() })
      await mem.save(planId, stamped)
      try {
        await mkdirBestEffort()
        await io.writeText(fileOf(planId), JSON.stringify(stamped))
      } catch (e) {}
    },
    remove: async function (planId) {
      await mem.remove(planId)
      try {
        await mkdirBestEffort()
        await io.writeText(fileOf(planId), '')
      } catch (e) {}
    },
  }
}

/** 短指纹（工作区隔离文件名用，不记原始路径，脱敏口径与日志一致）。 */
export function workspaceFingerprint(s) { return hash8(String(s || '')) }
