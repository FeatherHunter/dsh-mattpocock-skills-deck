/**
 * tests/verify-tracker-contract.js — 契约测试入口（对齐仓库 verify-* 约定）。
 *
 * 运行：node tests/verify-tracker-contract.js
 * 期望：合规桩全 PASS；违规桩被逮住（FAIL）。退出码 0 = 契约骨架自洽。
 */
import runContractTests from './tracker-contract/harness.js'
import compliant from './tracker-contract/fixtures/compliant.js'
import violating from './tracker-contract/fixtures/violating.js'

const results = [
  ...runContractTests(compliant), // 合规 → 应全 PASS
  ...runContractTests(violating), // 违规 → 应至少一 FAIL
]

let passed = 0
let failed = 0
for (const r of results) {
  if (r.ok) passed++
  else failed++
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
}

console.log(`\ncontract-test: ${passed} passed, ${failed} failed`)

// 校验契约骨架自洽：合规桩全过、违规桩至少逮住一个
const compliantOk = results.filter((r) => r.name.startsWith(compliant.name) && !r.ok).length === 0
const caughtViolation = results.filter((r) => r.name.startsWith(violating.name) && !r.ok).length > 0
if (!(compliantOk && caughtViolation)) {
  console.error('CONTRACT SKELETON NOT SELF-CONSISTENT')
  process.exit(1)
}
console.log('CONTRACT SKELETON OK')
