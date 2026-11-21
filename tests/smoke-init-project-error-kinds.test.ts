// 最小自测：验证「创建并发布」错误分类器的分档修正（去裸 403/401、重名与限流前置）。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-init-project-error-kinds.test.ts
import { makeCreateErrorClassifier } from '../src/tracker/rooms/github/support/init-project-error-kinds.js'

const classify = makeCreateErrorClassifier({})
const cases: Array<[string, string | null | undefined, string, string]> = [
  ['同名仓库已存在（原文带 403）', 'HTTP 403: repository already exists', null, 'already-exists'],
  ['主限流', 'API rate limit exceeded for user', null, 'network'],
  ['secondary 限流', 'secondary rate limit: please wait', null, 'network'],
  ['真正的权限措辞', 'Resource not accessible by integration', null, 'permission'],
  ['裸 403 不再误判成权限', 'HTTP 403: something else happened', null, 'unknown'],
  ['裸 401 不再误判成权限', 'HTTP 401: whatever', null, 'unknown'],
  ['上游 auth 档仍归一为未登录', 'some message', 'auth', 'not-logged-in'],
  ['上游 network 档仍归一为网络', 'some message', 'network', 'network'],
]
let failed = 0
for (const [name, text, kind, want] of cases) {
  const got = classify(text, kind)
  const ok = got === want
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' —— 期望 ' + want + '，实得 ' + got)
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过（共 ' + cases.length + ' 项）')
process.exitCode = failed ? 1 : 0
