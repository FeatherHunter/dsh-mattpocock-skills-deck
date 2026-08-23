/**
 * tests/tracker-contract/sections/registry.js — registry.js 行为段（#132 Q2=B）。
 *
 * 第一性原理（#125 定版）：
 *  - 注册只验模块形状（id/label/create/matches），不因缺 op 拒绝；缺方法由 Proxy 补 unsupported 桩。
 *  - id 冲突默认抛 duplicate-id（replace 供 HMR）；'other' 弃用不注册；create 说谎（id 不一致/非对象）拒绝。
 *  - select 三级联三态（explicit > matches > fallback；matches 超时→pending:true 排除决策集；
 *    平局=注册序 + multiHit 暴露；无 explicit/match/pending 才 fallback→null 且 ref 省略；
 *    pending:true = 仲裁未决（UI 显示等待/bind，不静默 OtherCard））。
 *  - on(unsubscribe) / Disposable（按代隔离：replace 后旧代 dispose 不误杀新代）/ 监听抛错隔离 /
 *    describe / MIGRATE_KEY；unregister stale 通知携带真实 handle。
 */

import { createRegistry, TrackerRegistryError, MIGRATE_KEY } from '../../../src/host/tracker/registry.js'

const mkModule = (id, over = {}) => Object.assign({
  id,
  label: id,
  create: () => ({ list: async () => ({ ok: true, data: [] }) }),
  matches: async () => false,
}, over)

const handle = { cwd: '/workspace' }
const ref0 = { backend: 'fake', refId: 'r0', name: 'R0', url: '' }

export async function run() {
  const out = []
  const P = 'registry · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  const threw1 = (fn, code) => {
    try { fn(); return '(no throw)' } catch (e) { return (e instanceof TrackerRegistryError && (code == null || e.code === code)) ? 'ok' : `wrong:${e && e.code}:${e.message}` }
  }

  // ── 注册 / 形状 ──
  {
    const r = createRegistry()
    const d = r.register(mkModule('alpha'))
    await assert('register 返回 Disposable(dispose)', d && typeof d.dispose === 'function')
    await assert('get(id).id === 模块 id', r.get('alpha').id === 'alpha')
    await assert('命中未实现 op → unsupported 桩（返回不抛）', (async () => {
      const res = await r.get('alpha').update(ref0, 'k', {}, {})
      return res && res.ok === false && res.error.kind === 'unsupported'
    })(), 'stub must return unsupported')
    await assert('已实现 op 原样可用', (async () => {
      const res = await r.get('alpha').list(ref0, {}, {})
      return res && res.ok === true && Array.isArray(res.data)
    })(), 'implemented list must work')
  }

  await assert('duplicate-id 默认抛错', (() => {
    const r = createRegistry()
    r.register(mkModule('dup'))
    return threw1(() => r.register(mkModule('dup')), 'duplicate-id') === 'ok'
  })(), 'duplicate without replace must throw')
  await assert('replace:true 允许 HMR 覆盖', (() => {
    const r = createRegistry()
    r.register(mkModule('rep'))
    const d2 = r.register(mkModule('rep', { label: 'REP2' }), { replace: true })
    return !!(d2 && r.get('rep')) && r.modules().length === 1
  })(), 'replace must not duplicate entries')
  await assert("'other' 弃用不注册", (() => {
    const r = createRegistry()
    return threw1(() => r.register(mkModule('other')), 'other-not-registrable') === 'ok'
  })(), "'other' must be rejected")
  await assert('形状违规拒绝：缺 create', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: 'x', label: 'x', matches: async () => false }), 'shape') === 'ok'
  })(), 'missing create must throw shape')
  await assert('形状违规拒绝：缺 matches', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: 'x', label: 'x', create: () => ({}) }), 'shape') === 'ok'
  })(), 'missing matches must throw shape')
  await assert('形状违规拒绝：空 id', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: '', label: 'x', create: () => ({}), matches: async () => false }), 'shape') === 'ok'
  })(), 'empty id must throw shape')
  await assert('create 说谎拒绝：返回非对象', (() => {
    const r = createRegistry()
    return threw1(() => r.register(mkModule('nonobj', { create: () => 42 })), 'shape') === 'ok'
  })(), 'create() returning non-object must throw shape')
  await assert('create 说谎拒绝：id 不一致', (() => {
    const r = createRegistry()
    return threw1(() => r.register(mkModule('liar', { create: () => ({ id: 'OTHER', list: async () => ({ ok: true, data: [] }) }) })), 'shape') === 'ok'
  })(), 'inconsistent id must throw shape (契约说真话)')

  // ── 卸载 / 事件 ──
  await assert('unregister 幂等 + modules 移除', (() => {
    const r = createRegistry()
    r.register(mkModule('gone'))
    r.unregister('gone')
    r.unregister('gone')
    return r.get('gone') === undefined && !r.has('gone') && r.modules().every((m) => m.id !== 'gone')
  })(), 'unregister must be idempotent')
  await assert('Disposable.dispose 触发卸载', (() => {
    const r = createRegistry()
    const d = r.register(mkModule('dp'))
    d.dispose()
    return r.get('dp') === undefined
  })(), 'dispose must unregister')
  await assert('replace 后旧代 dispose 不误杀新代（按代隔离）', (() => {
    const r = createRegistry()
    const d1 = r.register(mkModule('gen'))
    const t1 = r.get('gen')
    const d2 = r.register(mkModule('gen', { label: 'GEN2' }), { replace: true })
    const t2 = r.get('gen')
    d1.dispose()
    return t2 !== t1 && r.get('gen') === t2 && r.modules().length === 1
  })(), 'dispose of a replaced generation must not kill the new tracker')
  await assert('unregister stale bind 负载含真实 handle（F6）', (() => {
    const r = createRegistry()
    r.register(mkModule('st'))
    const h = { cwd: '/ws-stale' }
    r.bind(h, 'st')
    let got = null
    r.on('bind', (p) => { if (p && p.stale) got = p })
    r.unregister('st')
    return got !== null && got.backendId === null && got.handle === h && got.stale === true
  })(), 'stale bind notification must carry the real handle, not a string key')
  await assert('on(register) 触发 + 取消订阅', (() => {
    const r = createRegistry()
    let n = 0
    const off = r.on('register', () => n++)
    r.register(mkModule('e1'))
    off()
    r.register(mkModule('e2'))
    return n === 1
  })(), 'listener must fire once and stop after unsubscribe')
  await assert('监听抛错隔离', (() => {
    const r = createRegistry()
    let n = 0
    r.on('register', () => { throw new Error('listener boom') })
    r.on('register', () => n++)
    r.register(mkModule('iso'))
    return n === 1
  })(), 'a throwing listener must not block others')
  await assert('非法事件名抛 bad-event', (() => {
    const r = createRegistry()
    return threw1(() => r.on('unknown', () => {}), 'bad-event') === 'ok'
  })(), 'unknown event must throw')

  // ── select 三级联三态 ──
  await assert('explicit: bind → select 命中且出 ref', (async () => {
    const r = createRegistry()
    r.register(mkModule('hitA'))
    r.bind(handle, 'hitA')
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'hitA' && sel.source === 'explicit' && sel.ref && sel.ref.backend === 'hitA' && sel.multiHit === undefined
  })(), 'bound handle must short-circuit to explicit')
  await assert('explicit null: 无后端（ref 省略）', (async () => {
    const r = createRegistry()
    r.bind(handle, null)
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null && sel.source === 'explicit' && !('ref' in sel)
  })(), 'Selection.backendId:null must omit ref')
  await assert('matches 单命中 → source matches + ref', (async () => {
    const r = createRegistry()
    r.register(mkModule('m1', { matches: async () => true }))
    r.register(mkModule('m2', { matches: async () => false }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'm1' && sel.source === 'matches' && sel.ref && sel.ref.backend === 'm1' && sel.multiHit === undefined
  })(), 'single matches must choose the hit')
  await assert('multiHit：平局=注册序 + multiHit 暴露', (async () => {
    const r = createRegistry()
    r.register(mkModule('a', { matches: async () => true }))
    r.register(mkModule('b', { matches: async () => true }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'a' && Array.isArray(sel.multiHit) && sel.multiHit.join(',') === 'a,b'
  })(), 'tie must pick first registered and expose multiHit')
  await assert('fallback：无 explicit/match/pending → null + 无 ref', (async () => {
    const r = createRegistry()
    r.register(mkModule('n1', { matches: async () => false }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null && sel.source === 'fallback' && !('ref' in sel) && !sel.pending
  })(), 'no match must fallback to null (ref omitted)')
  await assert('pending：matches 超时 → pending:true + backendId:null', (async () => {
    const r = createRegistry({}, { matchesTimeout: 15 })
    r.register(mkModule('slow', { matches: () => new Promise(() => {}) }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null && sel.pending === true
  })(), 'timeout must surface pending:true (仲裁未决), not silently OtherCard')
  await assert('pending 被排除：有命中时选命中但保留 pending:true', (async () => {
    const r = createRegistry({}, { matchesTimeout: 15 })
    r.register(mkModule('slow', { matches: () => new Promise(() => {}) }))
    r.register(mkModule('fast', { matches: async () => true }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'fast' && sel.pending === true
  })(), 'pending must not join decision set')
  await assert('matches 抛错 → 按 false（不炸 select）', (async () => {
    const r = createRegistry()
    r.register(mkModule('boom', { matches: async () => { throw new Error('boom') } }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null
  })(), 'throwing matches must degrade to false')
  await assert('OpContext.signal 传给 matches（AbortSignal）', (async () => {
    let seen = null
    const r = createRegistry()
    r.register(mkModule('sig', { matches: async (h, ctx) => { seen = ctx && ctx.signal; return false } }))
    await r.select(handle, { cwd: handle.cwd })
    return seen !== null && typeof seen === 'object' && typeof seen.aborted === 'boolean'
  })(), 'signal must be injected into matches ctx')

  // ── bind / bound / describe / migrateKey ──
  await assert('bind 未注册后端抛 unknown-backend', (() => {
    const r = createRegistry()
    return threw1(() => r.bind(handle, 'ghost'), 'unknown-backend') === 'ok'
  })(), 'bind to unregistered must throw')
  await assert('bound() 三态（undefined/null/id）', (() => {
    const r = createRegistry()
    r.register(mkModule('bnd'))
    if (r.bound(handle) !== undefined) return false
    r.bind(handle, null)
    if (r.bound(handle) !== null) return false
    r.bind(handle, 'bnd')
    return r.bound(handle) === 'bnd'
  })(), 'bound must distinguish never/explicit-null/id')
  await assert('describe 出 RepositoryRef（markdown refId=cwd）', (() => {
    const r = createRegistry()
    const ref = r.describe({ cwd: '/a/b' }, 'markdown')
    return ref.backend === 'markdown' && ref.refId === '/a/b' && typeof ref.name === 'string' && ref.url === ''
  })(), 'describe must yield backend/refId/name/url')
  await assert('MIGRATE_KEY = {other:null} 先落地', MIGRATE_KEY && MIGRATE_KEY.other === null, JSON.stringify(MIGRATE_KEY))

  // ✗ probe：未实现 op 冒充成功必须被逮（Proxy 桩不说谎）
  await assert('✗ probe: 未实现 op 冒充成功被逮', (async () => {
    const r = createRegistry()
    r.register(mkModule('probe'))
    const res = await r.get('probe').setBlockedBy(ref0, 'k', [], {}, {})
    return res.ok === false && res.error.kind === 'unsupported'
  })(), 'missing op must NOT lie ok:true')

  return out
}

export default { name: 'registry', run }
