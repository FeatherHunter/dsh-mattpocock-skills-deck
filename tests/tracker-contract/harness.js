/**
 * tests/tracker-contract/harness.js — 契约测试骨架（G4）：各后端必须通过。
 *
 * 断言方向（第一性原理：「契约要能被验收」，而非「能跑起来」）：
 *   - 来源**有数据** → 字段**逐项映射**正确（source.title → issue.title，值相等）。
 *   - `state` 只归一化成 open|closed。
 *   - 来源**无** → 能实现字段必须** EMPTY**（属性存在且为空）而非 MISSING；且值空。
 *   - labels 每项为 {name:string, color:string}；closedAt 类型 string|null；EMPTY 判定正确。
 *   - capability-by-fill 可推导、且**不撒谎**（无 ops 时 liveUpdates 缺省 false）。
 *
 * 用法：传一个 fixture（含 normalize / withData / emptyData / mappings / implementedFields）。
 */
import { deriveCapabilities, hasField, isEmpty } from '../../src/host/tracker/capability.js'

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * @param {Object} t
 * @param {string} t.name
 * @param {(source: Object) => Object} t.normalize
 * @param {Object} t.withData 来源（有数据）
 * @param {Object} t.emptyData 来源（无数据）
 * @param {{from: string, to: string}[]} [t.mappings] 字段级映射断言
 * @param {string[]} [t.implementedFields] 能实现字段（须 EMPTY 而非 MISSING）
 * @returns {{ok: boolean, name: string, detail: string}[]}
 */
export function runContractTests(t) {
  const out = []
  const assert = (name, cond, detail) => out.push({ name: `${t.name} · ${name}`, ok: !!cond, detail: detail || '' })

  // 1) 有数据 → 逐字段级映射正确
  const w = t.normalize(t.withData)
  for (const m of (t.mappings || [])) {
    assert(`map ${m.from}->${m.to}`,
      deepEq(w[m.to], t.withData[m.from]),
      `got=${JSON.stringify(w[m.to])} want=${JSON.stringify(t.withData[m.from])}`)
  }

  // 2) state 归一化（只两态）
  assert('state ∈ {open,closed}', w.state === 'open' || w.state === 'closed', 'state=' + w.state)

  // 3) 无数据 → 能实现字段必须 EMPTY（存在）且值空
  const e = t.normalize(t.emptyData)
  for (const f of (t.implementedFields || [])) {
    assert(`empty.${f} present(EMPTY)`, hasOwn(e, f), 'omitted(MISSING)')
    assert(`empty.${f} empty-value`, isEmpty(e[f]), `got=${JSON.stringify(e[f])}`)
  }

  // 4) labels 项形状（若返回）
  if (hasOwn(e, 'labels')) {
    for (const l of (e.labels || [])) {
      assert('label {name,color:string}', l && typeof l.name === 'string' && typeof l.color === 'string', JSON.stringify(l))
    }
  }

  // 5) closedAt 类型 string|null
  assert('closedAt string|null', e.closedAt === null || typeof e.closedAt === 'string', 'typeof=' + typeof e.closedAt)

  // 6) capability 可推导 + 不撒谎（无 ops 时 liveUpdates 缺省 false）
  let caps = null
  try { caps = deriveCapabilities(e); assert('capability 可推导', true) } catch (err) { assert('capability 可推导', false, String(err)) }
  if (caps) assert('liveUpdates 缺省 false(不撒谎)', caps.liveUpdates === false, String(caps.liveUpdates))

  return out
}

export default runContractTests
