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
 *  - 骨架简化说明：snapCache/depsCache 为**无界 Map**（按需 TTL 过期，无容量上限）——
 *    容量上限/逐出策略随下游 orchestration 需求再定（#113/#114 接线时），当前契约层调用量下可接受。
 */

import { ERROR_KIND } from '../../shared/tracker/constants.js'
import { deriveDeck } from '../../shared/tracker/deck-derive.js'
import { parseMapBody } from '../../shared/parser.js'

/** 组装（纯函数）：maps（挂一层 tickets）+ 未挂图票（孤儿：破链 / 根票；map 节点本身不算孤儿——它已在 maps[] 作为容器）。 */
function assembleSnapshot(repo, all) {
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
  const attached = new Set()
  for (const m of maps) for (const t of m.tickets) attached.add(t.key)
  // issues = 未挂在任何 map 下的「非 map」票（破链票指 parentKey 指向已删/不存在 map；根票 parentKey=null 也在此——它们无 map 归属）
  const issues = all
    .filter((i) => i && i.type !== 'map' && !attached.has(i.key))
    .map((t) => Object.assign({}, t))
  return { repository: repo, maps, issues, deck: null }
}

/**
 * 创建宿主编排器。
 * @param {{get: (id: string) => Object|undefined}} registry trackerRegistry 实例（或等价 {get}）
 * @param {{snapshotTtl?: number, depsTtl?: number}} [opts] 缓存 TTL（ms；默认 5000）
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
  function snapshotVersionOf(snap){ try{ const all=[]; const lblOf=function(x){ try{ return (x.labels||[]).map(function(l){ return typeof l==='string'?l:(l.name||''); }).slice().sort().join(','); }catch(e){ return ''; } }; (snap.maps||[]).forEach(function(m){ const mapTitle=String(m.title||''); const mapLbl=lblOf(m); const mapUpd=String(m.updatedAt||''); (m.tickets||[]).forEach(function(t){ all.push(String(t.key||t.number)+':'+String(t.state||'')+':'+String(t.title||'')+':'+lblOf(t)+':'+String(t.updatedAt||'')+':'+String(t.progress||'')+':'+String(t.claimedBy||'')); }); // map 自身变化也计入版号（标题/标签/时间）
      all.push('map:'+String(m.key||m.number)+':'+String(m.state||'')+':'+mapTitle+':'+mapLbl+':'+mapUpd); }); (snap.issues||[]).forEach(function(it){ all.push(String(it.key||it.number)+':'+String(it.state||'')+':'+String(it.title||'')+':'+lblOf(it)+':'+String(it.updatedAt||'')); }); all.sort(); const str=all.join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12);}catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; }}
  const depsCache = new Map() // `${backendId}:${refId}#${key}` -> {data, at}

  const snapKeyOf = (backendId, ref) => `${backendId}:${(ref && ref.refId) || ''}`
  const depKeyOf = (backendId, ref, key) => `${snapKeyOf(backendId, ref)}#${key}`

  const fresh = (e, ttl) => e && (Date.now() - e.at) < ttl

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
        return { ok: true, notModified:true, status:304, version:cachedEntry.version, snapshot:cachedEntry.snapshot, cached:true };
      }
      if (!o.force && fresh(cachedEntry, snapshotTtl)) {
        if(o && o.ifNoneMatch && cachedEntry.version===o.ifNoneMatch) return { ok:true, notModified:true, status:304, version:cachedEntry.version, cached:true };
        return { ok: true, snapshot: cachedEntry.snapshot, version:cachedEntry.version, cached: true }
      }

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
