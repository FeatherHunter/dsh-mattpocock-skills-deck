// 临时探针（不入库）：跑本轮改动可能影响到的门禁，逐个报退出码与末行。
import { spawnSync } from 'node:child_process'

const tests = [
  'tests/verify-1109-matches-timeout.ts',
  'tests/verify-669-choice-precedence.js',
  'tests/verify-detection-cascade.js',
  'tests/verify-tracker-contract.js',
  'tests/verify-contract-types.js',
  'tests/verify-gate-map.js',
  'tests/verify-log-fields.js',
]
for (const t of tests) {
  const r = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mjs', t], { encoding: 'utf8', cwd: process.cwd() })
  const out = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter((l) => l.trim())
  console.log('=== ' + t + ' | exit=' + r.status)
  console.log(out.slice(-3).map((l) => '    ' + l).join('\n'))
}
