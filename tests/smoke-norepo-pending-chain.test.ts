// 最小门禁：全新目录（gh:remote 判 pending）也要让 NoRepoCard 进入 ChainRenderer 路径，
//   从而拿到 pending 行上挂的建仓向导（issue #1906 红卡侧残留）。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-norepo-pending-chain.test.ts
import { readFileSync } from 'node:fs'
import { stepEvalParallel } from '../src/refresh/rooms/host/chain-step-rows.js'

const src = readFileSync(new URL('../src/client/views/NoRepoCard.ts', import.meta.url), 'utf8')
const cases: Array<[string, boolean]> = [
  ['判定同时放行 fail 与 pending', /s\.status==='fail'\s*\|\|\s*s\.status==='pending'/.test(src)],
  ['ChainRenderer 分支改用新变量名', src.includes('if (isChainRepoNotDone &&') && !src.includes('if (isChainRepoFail &&')],
  ['未引入确定语气的旧红卡文案', !/repoBad\s*=\s*!!\(checkRepo[\s\S]{0,80}pending/.test(src)],
]
// 真值：pending 行带 wizard 动作（上一轮 chain-step-rows 修复），ChainRenderer 才可渲染入口。
const wizard = { type: 'wizard', label: '创建并发布' }
const snap = stepEvalParallel(
  [{ id: 'gh:remote', check: 'gh:remote', onFail: { show: { title: '未关联远端仓库' }, actions: [wizard] }, onPass: { show: null, actions: [] } }],
  { 'gh:remote': null },
)!
const step = snap.steps[0] as any
cases.push(['pending 行带 wizard 动作', step.status === 'pending' && step.actions[0] === wizard])
cases.push(['pending 行 show 仍是名称三格（warn 语气，不是确定红卡）', !!step.show && !!step.show.title])

let failed = 0
for (const [name, ok] of cases) {
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}
console.log(failed ? `\n${failed} 项失败` : `\n全部通过（共 ${cases.length} 项）`)
process.exitCode = failed ? 1 : 0
