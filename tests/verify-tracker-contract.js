/**
 * tests/verify-tracker-contract.js — 契约测试入口（对齐仓库 verify-* 约定）。
 *
 * 多段（#132 Q2=B 定决）：
 *   1. normalize harness（合规桩全 PASS / 违规桩被逮）
 *   2. contract 段：OpName 形状（无 detect、含 getDependencies、snapshot 非 op）+ ERROR_KIND 新枚举
 *   3. registry 段：Proxy 桩 / duplicate-id / replace / 'other' 禁注册 / select 三级联三态 /
 *      multiHit / AbortSignal / Disposable / on / describe / MIGRATE_KEY
 *   4. preflight 段：classifyError 顺序（auth>rate-limit>env>not-found>unsupported>parse>network，
 *      兜底 NETWORK；conflict 透传非 regex）
 *   5. deck 段：progressOf / levelOf（环 visited 守卫 + NFD 按 0 计）/ stats / blockedByKeys / labels 并集
 *   6. snapshot 段：composeSnapshot（非 op）/ 双缓存 / invalidate·clear / 快路径（完整才用）/ unsupported 不缓存
 *
 * 每段含「✗ probe」违规样例自证测试会逮。
 * 运行：node tests/verify-tracker-contract.js
 * 期望：合规桩全 PASS；违规桩被逮住（FAIL）；各段全 PASS。退出码 0 = 契约骨架自洽。
 */
import runContractTests from './tracker-contract/harness.js'
import compliant from './tracker-contract/fixtures/compliant.js'
import violating from './tracker-contract/fixtures/violating.js'
import contractSection from './tracker-contract/sections/contract.js'
import registrySection from './tracker-contract/sections/registry.js'
import preflightSection from './tracker-contract/sections/preflight.js'
import deckSection from './tracker-contract/sections/deck.js'
import snapshotSection from './tracker-contract/sections/snapshot.js'

const results = [
  ...runContractTests(compliant), // 合规 → 应全 PASS
  ...runContractTests(violating), // 违规 → 应至少一 FAIL
]

for (const s of [contractSection, registrySection, preflightSection, deckSection, snapshotSection]) {
  try {
    const r = await s.run()
    results.push(...r)
  } catch (e) {
    results.push({ name: `${s.name} · section-crash`, ok: false, detail: String(e) })
  }
}

let passed = 0
let failed = 0
for (const r of results) {
  if (r.ok) passed++
  else failed++
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
}

console.log(`\ncontract-test: ${passed} passed, ${failed} failed`)

// 校验契约骨架自洽：合规桩全过、违规桩至少逮住一个、行为段全 PASS（含 probe 自证）
const compliantOk = results.filter((r) => r.name.startsWith(compliant.name) && !r.ok).length === 0
const caughtViolation = results.filter((r) => r.name.startsWith(violating.name) && !r.ok).length > 0
const sectionsOk = results.filter((r) => !r.name.startsWith(compliant.name) && !r.name.startsWith(violating.name) && !r.ok).length === 0
if (!(compliantOk && caughtViolation && sectionsOk)) {
  console.error('CONTRACT SKELETON NOT SELF-CONSISTENT')
  process.exit(1)
}
console.log('CONTRACT SKELETON OK')
