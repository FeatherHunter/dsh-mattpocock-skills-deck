/**
 * tests/tracker-contract/harness.js — 契约测试骨架（G4）：各后端必须通过。
 *
 * 断言方向（第一性原理：「契约要能被验收」，而非「能跑起来」）：
 *   - 来源**有数据** → 字段**逐项映射**正确（source.title → issue.title，值相等）。
 *   - 定版形状骨架：单 `key`(string)、无 `number`/`subIssues`、核心字段齐（parentKey）。
 *   - `state` 只归一化成 open|closed。
 *   - 来源**无** → 能实现字段必须 **EMPTY**（属性存在且为空）而非 MISSING；不能实现 → MISSING。
 *   - labels 每项为 {name:string, color:string}；closedAt 类型 string|null；EMPTY 判定正确。
 *   - capability-by-fill = `diagnoseCapabilities`（只做日志二分），EMPTY=字段在但空、MISSING=省略。
 *   - EMPTY vs MISSING 不可混用；frontier 排除 indeterminate（assignees MISSING）、NOT-FOUND 依赖安全 blocked。
 *
 * 用法：传一个 fixture（含 normalize / withData / emptyData / mappings / implementedFields /
 * missingFields / deckCases）。
 */
import { diagnoseCapabilities, hasField, isEmpty } from '../../src/host/tracker/capability.js'

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * deck 推导的最小**测试**实现（契约 §5.2 判定口径；纯测试校验，不属能力表/缓存）。
 * frontier 须「assignees 已知且空 + !claimed + !blocked」= 天然排除 indeterminate。
 */
function hasOpenBlocker(blockedBy, lookup) {
  if (!blockedBy || blockedBy.length === 0) return false
  return blockedBy.some((ref) => {
    if (!lookup) return ref.state === 'open'
    const target = lookup(ref.key)
    if (!target) return true // NOT-FOUND → blocked（安全，绝不误判 frontier）
    return target.state === 'open'
  })
}

function deckBitsOf(issue, lookup) {
  const claimed = hasField(issue, 'assignees')
    ? (Array.isArray(issue.assignees) && issue.assignees.length > 0)
    : null // null = indeterminate（assignees MISSING，未知认领态）
  const blocked = issue.state === 'open' && hasOpenBlocker(issue.blockedBy, lookup)
  const frontier = issue.state === 'open' && claimed === false && !blocked
  return { claimed, blocked, frontier }
}

/**
 * @param {Object} t
 * @param {string} t.name
 * @param {(source: Object) => Object} t.normalize
 * @param {Object} t.withData 来源（有数据）
 * @param {Object} t.emptyData 来源（无数据）
 * @param {{from: string, to: string}[]} [t.mappings] 字段级映射断言
 * @param {string[]} [t.implementedFields] 能实现字段（须 EMPTY 而非 MISSING）
 * @param {string[]} [t.missingFields] 不能实现字段（须 MISSING 而非 EMPTY）
 * @param {{name: string, issue: Object, lookup?: Function, expected: {claimed: boolean|null, blocked: boolean, frontier: boolean}}[]} [t.deckCases] frontier/indeterminate 判定用例
 * @returns {{ok: boolean, name: string, detail: string}[]}
 */
export function runContractTests(t) {
  const out = []
  const assert = (name, cond, detail) => out.push({ name: `${t.name} · ${name}`, ok: !!cond, detail: detail || '' })

  // 1) 有数据 → 逐字段级映射正确
  const w = t.normalize(t.withData)
  for (const m of (t.mappings || [])) {
    assert(`map ${m.from}->${m.to}`, deepEq(w[m.to], t.withData[m.from]),
      `got=${JSON.stringify(w[m.to])} want=${JSON.stringify(t.withData[m.from])}`)
  }

  // 2) 定版形状骨架：单 key、无 number/subIssues、核心字段齐
  assert('key string', typeof w.key === 'string', 'key=' + JSON.stringify(w.key))
  assert('no number field', !hasOwn(w, 'number'), 'number present=' + JSON.stringify(w.number))
  assert('no subIssues field', !hasOwn(w, 'subIssues'), 'subIssues present=' + JSON.stringify(w.subIssues))
  assert('no blocking field (Issue 无 blocking；blocking 仅 projection/派生)', !hasOwn(w, 'blocking'), 'blocking present=' + JSON.stringify(w.blocking))
  assert('type ∈ {issue,map}', w.type === 'issue' || w.type === 'map', 'type=' + w.type)
  assert('parentKey core (string|null)', w.parentKey === null || typeof w.parentKey === 'string', 'parentKey=' + JSON.stringify(w.parentKey))

  // 3) state 归一化（只两态）
  assert('state ∈ {open,closed}', w.state === 'open' || w.state === 'closed', 'state=' + w.state)

  // 4) 无数据 → 能实现字段必须 EMPTY（存在）且值空；不能实现 → MISSING（省略）
  const e = t.normalize(t.emptyData)
  for (const f of (t.implementedFields || [])) {
    assert(`empty.${f} present(EMPTY)`, hasOwn(e, f), 'omitted(MISSING)')
    assert(`empty.${f} empty-value`, isEmpty(e[f]), 'got=' + JSON.stringify(e[f]))
  }
  for (const f of (t.missingFields || [])) {
    assert(`empty.${f} omitted(MISSING)`, !hasOwn(e, f), 'present=' + JSON.stringify(e[f]))
  }

  // 5) labels 项形状（若返回）
  if (hasOwn(e, 'labels')) {
    for (const l of (e.labels || [])) {
      assert('label {name,color:string}', l && typeof l.name === 'string' && typeof l.color === 'string', JSON.stringify(l))
    }
  }

  // 6) closedAt 类型 string|null
  assert('closedAt string|null', e.closedAt === null || typeof e.closedAt === 'string', 'typeof=' + typeof e.closedAt)

  // 7) diagnoseCapabilities 只做日志二分（EMPTY=字段在但空；MISSING=省略；不撒谎）
  let log = null
  try { log = diagnoseCapabilities(e); assert('diagnose 可运行', Array.isArray(log), 'log=' + typeof log) } catch (err) { assert('diagnose 可运行', false, String(err)) }
  if (log) {
    for (const f of (t.implementedFields || [])) {
      const entry = log.find((x) => x.label === f)
      assert(`log.${f} EMPTY`, !!entry && entry.value === 'EMPTY', JSON.stringify(entry))
    }
    for (const f of (t.missingFields || [])) {
      const entry = log.find((x) => x.label === f)
      assert(`log.${f} MISSING`, !!entry && entry.value === 'MISSING', JSON.stringify(entry))
    }
  }

  // 8) EMPTY vs MISSING 不可混用：implemented 在 empty 必须 EMPTY（有能力无内容）
  for (const f of (t.implementedFields || [])) {
    assert(`EMPTY≠MISSING ${f}`, hasOwn(e, f) && isEmpty(e[f]), 'got=' + JSON.stringify(e[f]))
  }

  // 9) indeterminate/frontier 排除：assignees MISSING=indeterminate；EMPTY([])=未认领可 frontier
  for (const c of (t.deckCases || [])) {
    const bits = deckBitsOf(c.issue, c.lookup)
    for (const k of ['claimed', 'blocked', 'frontier']) {
      assert(`deckBits ${c.name}.${k}`, bits[k] === c.expected[k], 'got=' + JSON.stringify(bits[k]) + ' want=' + JSON.stringify(c.expected[k]))
    }
  }

  return out
}

export default runContractTests
