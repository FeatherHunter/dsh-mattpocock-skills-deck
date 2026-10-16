/**
 * tests/tracker-contract/harness.ts — 契约测试骨架（G4）：各后端必须通过。
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

const deepEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** 字段级映射断言：来源的 from 字段必须逐项映射到产出的 to 字段（值相等）。 */
export interface ContractMapping {
  from: string
  to: string
}

/** deck 判定三位的期望口径（§5.2）：claimed 允许 null（indeterminate，未知认领态）。 */
export interface DeckBitsExpect {
  claimed: boolean | null
  blocked: boolean
  frontier: boolean
}

/** frontier/indeterminate 判定用例：一条 issue（可带 lookup）对应一组期望三位。 */
export interface DeckCase {
  name: string
  issue: Record<string, unknown>
  lookup?: (key: string) => { state: string } | undefined
  expected: DeckBitsExpect
}

/** 传给 runContractTests 的后端夹具形状（normalize / withData / emptyData 必填，其余按需）。 */
export interface ContractFixture {
  name: string
  normalize: (source: Record<string, unknown>) => Record<string, unknown>
  withData: Record<string, unknown>
  emptyData: Record<string, unknown>
  mappings?: ContractMapping[]
  implementedFields?: string[]
  missingFields?: string[]
  deckCases?: DeckCase[]
}

/** 单条契约断言的结果：ok 为判定，name 带后端名前缀，detail 留现场。 */
export interface ContractResult {
  ok: boolean
  name: string
  detail: string
}

/** 能力日志里的一行：label 是字段名，value 只取 EMPTY 或 MISSING（二分）。 */
interface CapabilityEntry {
  label: string
  value: string
}

/**
 * deck 推导的最小**测试**实现（契约 §5.2 判定口径；纯测试校验，不属能力表/缓存）。
 * frontier 须「assignees 已知且空 + !claimed + !blocked」= 天然排除 indeterminate。
 */
function hasOpenBlocker(
  blockedBy: unknown,
  lookup?: (key: string) => { state: string } | undefined,
): boolean {
  const refs = blockedBy as Array<{ key: string; state: string }>
  if (!refs || refs.length === 0) return false
  return refs.some((ref) => {
    if (!lookup) return ref.state === 'open'
    const target = lookup(ref.key)
    if (!target) return true // NOT-FOUND → blocked（安全，绝不误判 frontier）
    return target.state === 'open'
  })
}

function deckBitsOf(
  issue: Record<string, unknown>,
  lookup?: (key: string) => { state: string } | undefined,
): DeckBitsExpect {
  const claimed = hasField(issue, 'assignees')
    ? (Array.isArray(issue.assignees) && issue.assignees.length > 0)
    : null // null = indeterminate（assignees MISSING，未知认领态）
  const blocked = issue.state === 'open' && hasOpenBlocker(issue.blockedBy, lookup)
  const frontier = issue.state === 'open' && claimed === false && !blocked
  return { claimed, blocked, frontier }
}

/**
 * 跑完一个后端夹具的全部契约断言，返回逐条结果（不抛：调用方按 ok 汇总）。
 */
export function runContractTests(t: ContractFixture): ContractResult[] {
  const out: ContractResult[] = []
  const assert = (name: string, cond: unknown, detail?: string): void => {
    out.push({ name: `${t.name} · ${name}`, ok: !!cond, detail: detail || '' })
  }

  // 1) 有数据 → 逐字段级映射正确
  const w = t.normalize(t.withData)
  for (const m of (t.mappings || [])) {
    assert(`map ${m.from}->${m.to}`, deepEq(w[m.to], t.withData[m.from]),
      `got=${JSON.stringify(w[m.to])} want=${JSON.stringify(t.withData[m.from])}`)
  }

  // 2) 定版形状骨架：单 key、无 number/subIssues、核心字段齐
  assert('key string', typeof w.key === 'string', 'key=' + JSON.stringify(w.key))
  // effort 维度：effortId 是核心字段（永远存在；单 effort 后端 ''）——身份 = (RepositoryRef, effortId, key)
  assert('effortId core (string)', typeof w.effortId === 'string', 'effortId=' + JSON.stringify(w.effortId))
  assert('no number field', !hasOwn(w, 'number'), 'number present=' + JSON.stringify(w.number))
  assert('no subIssues field', !hasOwn(w, 'subIssues'), 'subIssues present=' + JSON.stringify(w.subIssues))
  assert('no blocking field (Issue 无 blocking；blocking 仅 projection/派生)', !hasOwn(w, 'blocking'), 'blocking present=' + JSON.stringify(w.blocking))
  // 2b) 拉取请求不新增独立实体（#508 落 #294 形状 A 裁决：复用工单形状加三个可选字段，快照不分片）
  assert('no pullRequests entity collection', !hasOwn(w, 'pullRequests') && !hasOwn(w, 'pullRequest'), 'pullRequests=' + JSON.stringify(w.pullRequests) + ' pullRequest=' + JSON.stringify(w.pullRequest))
  // 2c) 三个可选扩展字段出现了就必须类型合规；没出现 = 无能力后端省略（MISSING），同样合法
  if (hasOwn(w, 'isPullRequest')) {
    assert('isPullRequest boolean', typeof w.isPullRequest === 'boolean', 'got=' + JSON.stringify(w.isPullRequest))
  }
  if (hasOwn(w, 'mergedAt')) {
    assert('mergedAt string|null', w.mergedAt === null || typeof w.mergedAt === 'string', 'got=' + JSON.stringify(w.mergedAt))
  }
  if (hasOwn(w, 'reviews')) {
    // 评审细分出现了就必须是数组（null 也不行）；每条必须有评审结论文字，
    // 写了评审人就必须有登录名文字，写了评审时间就必须是时间文字。
    const reviewsOk = Array.isArray(w.reviews) && (w.reviews as unknown[]).every((r) => {
      if (!r || typeof r !== 'object') return false
      const rec = r as Record<string, unknown>
      if (typeof rec.state !== 'string') return false
      if (hasOwn(rec, 'reviewer')) {
        const reviewer = rec.reviewer as Record<string, unknown> | null | undefined
        if (!reviewer || typeof reviewer !== 'object' || typeof reviewer.login !== 'string') return false
      }
      if (hasOwn(rec, 'submittedAt') && typeof rec.submittedAt !== 'string') return false
      return true
    })
    assert('reviews Review[]（每一条都有评审结论文字）', reviewsOk, 'got=' + JSON.stringify(w.reviews))
  }
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
    for (const l of ((e.labels || []) as unknown[])) {
      const rec = l as Record<string, unknown>
      assert('label {name,color:string}', !!l && typeof rec.name === 'string' && typeof rec.color === 'string', JSON.stringify(l))
    }
  }

  // 6) closedAt 类型 string|null
  assert('closedAt string|null', e.closedAt === null || typeof e.closedAt === 'string', 'typeof=' + typeof e.closedAt)

  // 7) diagnoseCapabilities 只做日志二分（EMPTY=字段在但空；MISSING=省略；不撒谎）
  let log: unknown = null
  try { log = diagnoseCapabilities(e); assert('diagnose 可运行', Array.isArray(log), 'log=' + typeof log) } catch (err) { assert('diagnose 可运行', false, String(err)) }
  if (Array.isArray(log)) {
    for (const f of (t.implementedFields || [])) {
      const entry = (log as CapabilityEntry[]).find((x) => x.label === f)
      assert(`log.${f} EMPTY`, !!entry && entry.value === 'EMPTY', JSON.stringify(entry))
    }
    for (const f of (t.missingFields || [])) {
      const entry = (log as CapabilityEntry[]).find((x) => x.label === f)
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
    for (const k of (['claimed', 'blocked', 'frontier'] as const)) {
      assert(`deckBits ${c.name}.${k}`, bits[k] === c.expected[k], 'got=' + JSON.stringify(bits[k]) + ' want=' + JSON.stringify(c.expected[k]))
    }
  }

  return out
}

export default runContractTests
