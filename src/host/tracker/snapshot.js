/**
 * tracker/snapshot.js — 宿主编排 composeSnapshot（**非契约 op**）。
 *
 * 第一性原理（#124 定版）：
 *  - `snapshot` 不进 OpName：它是宿主编排便利函数（list 组合 + deck 投影），不是后端操作；
 *    `children` 用 `list({parentKey})`（shape 树边 = parentKey + tickets）。
 *  - deck 由 host 计算（deck-derive 纯函数）；**后端绝不存 deck 字段**。
 *  - 缓存只缓存数据（快照 / 依赖边），**绝不缓存 hasField / unsupported 判定**（G5 红线）：
 *    禁止以命中与否跳过 OpResult.unsupported 调用。
 *  - 「可选后端快路径」= 后端可在 Tracker 上提供 `snapshotFast`（**不是 op**、不进 OpName、不进契约验证），
 *    返回完整 Issue[]才使用；否则回落 list 编排（桩不误导：不把半成品当快照）。
 *  - 写操作（create/update/close/reopen/comment/set*）后的自动逐出由**宿主编排层**负责
 *    （调用方须显式 invalidate；本模块不感知写操作）。
 *  - 快照缓存为 LRU（最多留 20 个仓库的快照，超出时丢掉最久没用的），键只用「后端名 + 仓库键」
 *    （版本号存在条目里，不进键；调用方拿版本号比对，不一致就重建）。
 *  - 拉取请求与普通工单放同一个池子（#505 落 #294 形状 A 裁决）：不按类型分片，不新增集合；
 *    同号异类（同 key 但是否为拉取请求不同）靠是否为拉取请求区分身份，不互相吞；
 *    组装层只做 pass-through（有字段原样带，无字段保持省略），不替后端补默认值；
 *    界面按类型过滤是前端页签的事（#506），组装层不过滤、不隐藏任何一类。
 */

import { ERROR_KIND } from '../../shared/tracker/constants.js'
import { deriveDeck } from '../../shared/tracker/deck-derive.js'
import { parseMapBody } from '../../shared/parser.js'

/**
 * 池内身份：key 相同但是否为拉取请求不同，是两个东西（同号异类不混键）。
 * 三态：true=拉取请求（后缀 \0pr）；false=确认为普通工单（后缀 \0issue）；MISSING=无该能力的后端省略该字段（保持裸 key，老快照兼容）。
 * false 与 MISSING 不再混同，各算各的；字段在但不是布尔值记 BAD（后缀 \0bad）单独隔离。混合返回不断言一致，不抛错，不吞票。
 * #504 交接约束：有拉取请求能力的后端逐票必带 isPullRequest（true/false），引用也应带该字段；老引用缺字段时按裸 key 回落找同号票。
 */
function poolIdOf(it) {
  const k = String((it && it.key) || '')
  if (!it || !Object.prototype.hasOwnProperty.call(it, 'isPullRequest')) return k // MISSING
  if (it.isPullRequest === true) return k + '\0pr'
  if (it.isPullRequest === false) return k + '\0issue'
  return k + '\0bad' // BAD：非布尔值，孤儿隔离
}

/** 组装（纯函数）：maps（挂一层 tickets）+ 未挂图票（孤儿：破链 / 根票；map 节点本身不算孤儿——它已在 maps[] 作为容器）。
 * 同池：拉取请求与普通工单都进 tickets/issues，不分片；拷贝原样带字段（EMPTY 保持空值，MISSING 保持省略）。 */
function assembleSnapshot(repo, all) {
  // 口径断言：组装层不判定后端能力是否一致（混合返回不断言一致），只做 pass-through；身份区分靠 poolIdOf（三态），BAD 单独隔离。
  const byParent = new Map()
  for (const it of all) {
    if (!it) continue
    if (it.parentKey != null) {
      const arr = byParent.get(it.parentKey) || []
      arr.push(it)
      byParent.set(it.parentKey, arr)
    }
  }
  const maps = all
    .filter((i) => i && i.type === 'map')
    .map((m) => {
      // map 正文五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）：
      // 后端形状只保证 body；UI 详情页（MapDetail）直接消费解析结果（m.decisions.length 等），
      // GitHub 切到编排器后曾漏解析，点 Map 行进详情页即报 Cannot read properties of undefined (reading 'length')。
      // 在组装层统一解析补齐（与旧 gh 直连路径一致），无区块也给 EMPTY（'' / []），不 MISSING。
      const bp = parseMapBody(m.body)
      return Object.assign({}, m, {
        tickets: (byParent.get(m.key) || []).map((t) => Object.assign({}, t)),
        destination: bp.destination,
        notes: bp.notes,
        decisions: bp.decisions,
        fog: bp.fog,
        outOfScope: bp.outOfScope,
      })
    })
  // 已挂载集合按池内身份记：同 key 的普通工单与拉取请求各算各的，已挂载一个不吞掉另一个。
  const attached = new Set()
  for (const m of maps) for (const t of m.tickets) attached.add(poolIdOf(t))
  // issues = 未挂在任何 map 下的「非 map」票（破链票指 parentKey 指向已删/不存在 map；根票 parentKey=null 也在此——它们无 map 归属）
  const issues = all
    .filter((i) => i && i.type !== 'map' && !attached.has(poolIdOf(i)))
    .map((t) => Object.assign({}, t))
  return { repository: repo, maps, issues, deck: null }
}

/**
 * 创建宿主编排器。
 * @param {{get: (id: string) => Object|undefined}} registry trackerRegistry 实例（或等价 {get}）
 * @param {{snapshotTtl?: number, depsTtl?: number, logCtx?: {fire: Function, isEnabled: Function}}} [opts] 缓存 TTL（ms；默认 5000）；logCtx 可选，不传则静默（老调用方行为不变）
 * @returns {{
 *   composeSnapshot: (backendId: string, ref: import('../../shared/tracker/shape.js').RepositoryRef, ctx?: Object, o?: {force?: boolean}) => Promise<{ok: true, snapshot: import('../../shared/tracker/shape.js').Snapshot, cached?: boolean} | {ok: false, error: Object}>,
 *   getDependencies: (backendId: string, ref: import('../../shared/tracker/shape.js').RepositoryRef, key: string, ctx?: Object) => Promise<{ok: true, data: Object, cached?: boolean} | {ok: false, error: Object}>,
 *   invalidateSnapshot: (backendId: string, ref: import('../../shared/tracker/shape.js').RepositoryRef) => void,
 *   invalidateDependencies: (backendId: string, ref: import('../../shared/tracker/shape.js').RepositoryRef, key?: string) => void,
 *   clear: () => void,
 * }}
 */
export function createSnapshotComposer(registry, opts = {}) {
  const snapshotTtl = (opts && opts.snapshotTtl != null) ? opts.snapshotTtl : 5000
  const depsTtl = (opts && opts.depsTtl != null) ? opts.depsTtl : 5000
  const SNAP_LRU_MAX = 20
  const snapCache = new Map() // `${backendId}:${refId}` -> {snapshot, version, at} LRU20
  function touchSnapLRU(k,v){ if(snapCache.has(k)) snapCache.delete(k); snapCache.set(k,v); if(snapCache.size>SNAP_LRU_MAX){ const f=snapCache.keys().next().value; snapCache.delete(f);} }
  function issueIndexVersion(idx){ try{ const keys=Object.keys(idx||{}).sort(); const str=keys.map(function(k){return k+':'+idx[k]}).join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12); }catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; }}
  // 拉取请求三字段进版号（与 #508 口径一致：字段省略=MISSING 记一类，有值/空值按值记；只改拉取请求字段也换版号，不 served 陈旧 304）。
  function prSigOf(x){ try{ const has=Object.prototype.hasOwnProperty; const pr=!has.call(x,'isPullRequest')?'MISSING':(x.isPullRequest===true?'pr':(x.isPullRequest===false?'issue':'BAD')); const mg=!has.call(x,'mergedAt')?'MISSING':(x.mergedAt==null?'null':String(x.mergedAt)); let rv='MISSING'; if(has.call(x,'reviews')){ rv=!Array.isArray(x.reviews)?'BAD':('n'+x.reviews.length+':'+x.reviews.map(function(r){ try{ return String((r&&r.state)||'')+'@'+String((r&&r.reviewer&&r.reviewer.login)||'')+'@'+String((r&&r.submittedAt)||''); }catch(e){ return '?'; } }).sort().join(',').slice(0,200)); } return pr+'|'+mg+'|'+rv; }catch(e){ return 'ERR'; } }
  function snapshotVersionOf(snap){ try{ const all=[]; const lblOf=function(x){ try{ return (x.labels||[]).map(function(l){ return typeof l==='string'?l:(l.name||''); }).slice().sort().join(','); }catch(e){ return ''; } }; (snap.maps||[]).forEach(function(m){ const mapTitle=String(m.title||''); const mapLbl=lblOf(m); const mapUpd=String(m.updatedAt||''); (m.tickets||[]).forEach(function(t){ all.push(String(t.key||t.number)+':'+String(t.state||'')+':'+String(t.title||'')+':'+lblOf(t)+':'+String(t.updatedAt||'')+':'+String(t.progress||'')+':'+String(t.claimedBy||'')+':'+prSigOf(t)); }); // map 自身变化也计入版号（标题/标签/时间）
      all.push('map:'+String(m.key||m.number)+':'+String(m.state||'')+':'+mapTitle+':'+mapLbl+':'+mapUpd); }); (snap.issues||[]).forEach(function(it){ all.push(String(it.key||it.number)+':'+String(it.state||'')+':'+String(it.title||'')+':'+lblOf(it)+':'+String(it.updatedAt||'')+':'+prSigOf(it)); }); all.sort(); const str=all.join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12);}catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; }}
  const depsCache = new Map() // `${backendId}:${refId}#${key}` -> {data, at}

  const snapKeyOf = (backendId, ref) => `${backendId}:${(ref && ref.refId) || ''}`
  const depKeyOf = (backendId, ref, key) => `${snapKeyOf(backendId, ref)}#${key}`

  const fresh = (e, ttl) => e && (Date.now() - e.at) < ttl

  // 房内日志（#505）：只用现有的两个事件名（不新增事件，不改附录对照表）。
  // 未命中记常驻（每次重建都记，原因只记枚举）；命中记按需（调试开关开着才记，还百分之一采样）。
  // 请求与组装完成事件由外层电话层（wf.snapshot / wf.refresh，经 sessionSnapshot / sessionRefresh）负责，
  // 本层不重复记，避免一次调用记两行；前端水合与扇出是客户端的事，本层不碰。
  const snapLogCtx = (opts && opts.logCtx) || null
  const fire = (snapLogCtx && typeof snapLogCtx.fire === 'function') ? snapLogCtx.fire.bind(snapLogCtx) : null
  let snapHitSampleN = 0

  return {
    /**
     * 宿主编排 composeSnapshot（非 op）：list 全量 → 组装 maps/tickets/未挂图票 → deck 派生 → 缓存。
     * o.force=true 绕过缓存。失败返回 {ok:false,error}（不抛）。
     */
    async composeSnapshot(backendId, ref, ctx = {}, o = {}) {
      const tracker = registry.get(backendId)
      if (!tracker) {
        return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: `backend '${backendId}' not registered (composition aborted)` } }
      }
      const sk = snapKeyOf(backendId, ref)
      const cachedEntry = snapCache.get(sk);
      if (!o.force && o.ifNoneMatch && cachedEntry && cachedEntry.version && cachedEntry.version===o.ifNoneMatch) {
        try { if (fire && snapLogCtx.isEnabled('debug') && ((++snapHitSampleN % 100) === 0)) fire('debug', 'snapshot.cache.hit', { kind: 'snapshot-lru', ageMs: Date.now() - cachedEntry.at }) } catch (eL) {}
        touchSnapLRU(sk, cachedEntry) // 命中刷新 LRU 顺序（只动顺序，不改 at；TTL 照原创建时间过期）
        return { ok: true, notModified:true, status:304, version:cachedEntry.version, snapshot:cachedEntry.snapshot, cached:true };
      }
      if (!o.force && fresh(cachedEntry, snapshotTtl)) {
        try { if (fire && snapLogCtx.isEnabled('debug') && ((++snapHitSampleN % 100) === 0)) fire('debug', 'snapshot.cache.hit', { kind: 'snapshot-lru', ageMs: Date.now() - cachedEntry.at }) } catch (eL) {}
        touchSnapLRU(sk, cachedEntry) // 命中刷新 LRU 顺序（同上；否则退化成先进先出）
        if(o && o.ifNoneMatch && cachedEntry.version===o.ifNoneMatch) return { ok:true, notModified:true, status:304, version:cachedEntry.version, cached:true };
        return { ok: true, snapshot: cachedEntry.snapshot, version:cachedEntry.version, cached: true }
      }
      // 走到这里一定重建：原因只记枚举（版本号对不上记版本不一致，不记版本号原文）。
      const missReason = o.force ? 'force' : (!cachedEntry ? 'empty' : ((o.ifNoneMatch && cachedEntry.version && cachedEntry.version !== o.ifNoneMatch) ? 'version-mismatch' : 'expired'))
      try { if (fire) fire('info', 'snapshot.cache.miss', { reason: missReason }) } catch (eL) {}

      // 可选后端快路径（非 op；只接受完整 Issue[]，否则回落 list——桩不误导）
      let all = null
      if (typeof tracker.snapshotFast === 'function') {
        const fast = await tracker.snapshotFast(ref, ctx)
        if (fast && fast.ok === true && Array.isArray(fast.data)) all = fast.data
      }
      if (!all) {
        const res = await tracker.list(ref, {}, ctx)
        if (!res.ok) return { ok: false, error: res.error }
        all = res.data
      }
      if (!Array.isArray(all)) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: 'list returned non-array data; cannot compose snapshot' } }
      }

      const snapshot = assembleSnapshot(ref, all)
      snapshot.deck = deriveDeck(snapshot)
      try{ const ver=snapshotVersionOf(snapshot); snapshot.version=ver; snapshot.etag=ver; }catch(e){}
      const ent={snapshot, version:snapshot.version||'', at:Date.now()};
      touchSnapLRU(sk, ent);
      if(!o.force && o.ifNoneMatch && ent.version===o.ifNoneMatch) return {ok:true, notModified:true, status:304, version:ent.version, snapshot};
      return { ok: true, snapshot, version:ent.version }
    },

    /**
     * getDependencies（LRU 封装，TTL 默认 5000ms）：**只缓存边数据**（ok:true 的 data）；
     * ok:false（含 unsupported）一律不缓存、每次透传调用（G5 红线）。
     */
    async getDependencies(backendId, ref, key, ctx = {}) {
      const dk = depKeyOf(backendId, ref, key)
      if (fresh(depsCache.get(dk), depsTtl)) {
        return { ok: true, data: depsCache.get(dk).data, cached: true }
      }
      const tracker = registry.get(backendId)
      if (!tracker) {
        return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: `backend '${backendId}' not registered` } }
      }
      const res = await tracker.getDependencies(ref, key, {}, ctx)
      if (res && res.ok === true) depsCache.set(dk, { data: res.data, at: Date.now() })
      return res
    },

    /** 快照缓存逐出（写操作后由编排层调用；API-only，不感知写）。 */
    invalidateSnapshot(backendId, ref) {
      snapCache.delete(snapKeyOf(backendId, ref))
    },

    /** 依赖边缓存逐出：key 省略 = 该 repo 全部（闭包按前缀匹配）；单 key = 精确。 */
    invalidateDependencies(backendId, ref, key) {
      const prefix = `${snapKeyOf(backendId, ref)}#`
      if (key != null) depsCache.delete(prefix + key)
      else for (const k of Array.from(depsCache.keys())) if (k.startsWith(prefix)) depsCache.delete(k)
    },

    /** 全清（快照 + 依赖边）。 */
    clear() {
      snapCache.clear()
      depsCache.clear()
    },
  }
}

export const SNAPSHOT = Object.freeze({ version: 1 })
