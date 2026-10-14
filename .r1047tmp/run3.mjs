// 临时探针（不入库）：单独重跑三条门禁，抓失败原文，判断它们是不是本图改动带出来的。
import { spawnSync } from 'node:child_process'

const tests = ['tests/verify-prompts.js', 'tests/verify-setup-describe.js', 'tests/verify-686-accept.js']
for (const t of tests) {
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8', cwd: process.cwd() })
  const out = (r.stdout || '') + (r.stderr || '')
  const lines = out.split(/\r?\n/).filter((l) => /FAIL|失败|不通过|Error|错误|缺少|✗/.test(l))
  console.log('=== ' + t + ' | exit=' + r.status + ' | 命中行 ' + lines.length)
  console.log(lines.slice(0, 14).join('\n'))
  console.log('')
}
