// 最小自测：pending 行也必须带修复动作（issue #1906 / BUG-007），与共享层 chain-evaluate.ts 对齐。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-chain-step-pending-actions.test.ts
import { stepEvalParallel } from '../src/refresh/rooms/host/chain-step-rows.js'

const wizard = { type: 'wizard', label: '创建并发布' }
const prompt = { type: 'inject-prompt', label: '补指引' }
const item = (id: string) => ({
  id,
  check: id,
  onFail: { show: null, actions: [wizard] },
  onPass: { show: null, actions: [prompt] },
})
const snap = stepEvalParallel(
  [item('pass-step'), item('fail-step'), item('pending-step'), item('pending-nofail')],
  {
    'pass-step': 'pass',
    'fail-step': 'fail',
    'pending-step': null,
    'pending-nofail': { status: 'pending' },
  },
)!
const steps = Object.fromEntries(snap.steps.map((s: any) => [s.id, s])) as Record<string, any>
const cases: Array<[string, boolean]> = [
  ['pass 行不带动作', JSON.stringify(steps['pass-step'].actions) === '[]'],
  ['fail 行带 onFail 动作', steps['fail-step'].actions[0] === wizard],
  ['pending(null) 行带 onFail 动作', steps['pending-step'].actions[0] === wizard],
  ['pending(对象) 行带 onFail 动作', steps['pending-nofail'].actions[0] === wizard],
  ['pending 行 show 仍为名称三格（不含修复文案）', steps['pending-step'].show === steps['pending-step'].show && !!steps['pending-step'].show],
]
let failed = 0
for (const [name, ok] of cases) {
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过（共 ' + cases.length + ' 项）')
process.exitCode = failed ? 1 : 0
