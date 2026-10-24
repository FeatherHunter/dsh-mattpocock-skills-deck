// verify-1463-env-counts-pending.ts — #1463 环境计数与黄条口径一致：pending 计入分母
// 背景：同一份链快照，环境计数把 pending 开除出分母（9 步里 1 步 pending 显示 8/8 全绿），
//   横幅却按 #916 诚实报 pending（黄条继续挂）。两边各说各话，不需要旧快照也能复现截图。
// 修法：pending 计入分母、不计入分子 —— 没确认就是没通过，全绿只在全部 done 时出现。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1463-env-counts-pending.ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spliceableJs } from './lib/source-text.ts'
import { compileFn } from './lib/eval-probe.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }

function loadProbe() {
  const body = spliceableJs('src/refresh/rooms/client/probe-chain-subscription.js')
  const sandbox = {
    promptLang: () => 'zh',
    wsKeyOf: (cwd) => String(cwd || ''),
    getChainCacheKey: (ws, bid, lang) => String(ws) + '|' + String(bid) + '|' + String(lang),
    isEnabled: () => false,
    log: () => {},
    dswsLogHash: (s) => String(s || ''),
    dswsLogTrunc: (s) => String(s || ''),
    host: { call: () => Promise.resolve(null) },
    getCachedChain: () => null,
    setCachedChain: () => {},
    userHintOf: () => undefined,
    nowStr: () => '',
    emit: () => {},
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { readyCount: readyCount, envTotal: envTotal, envLabel: envLabel }')
  return factory(...names.map((n) => sandbox[n]))
}

// 9 步链：8 步 done + 登录那一步 pending（1463 截图的形状）
const mk9 = (authedStatus) => ({
  cwd: '/w/demo',
  chainSnapshot: {
    steps: [
      { id: 'tracker:initialized', status: 'done' },
      { id: 'env:home', status: 'done' },
      { id: 'env:node', status: 'done' },
      { id: 'gh:installed', status: 'done' },
      { id: 'gh:authed', status: authedStatus },
      { id: 'gh:remote', status: 'done' },
      { id: 'gh:access', status: 'done' },
      { id: 'skill:core', status: 'done' },
      { id: 'docs:ok', status: 'done' },
    ],
  },
})

async function main() {
  const mod = loadProbe()

  console.log('== 1. 1463 形状：8 done + 1 pending → 不许报 8/8 全绿 ==')
  const pend = mk9('pending')
  ok(mod.envTotal(pend) === 9, '分母是全部 9 步（实得 ' + mod.envTotal(pend) + '）')
  ok(mod.readyCount(pend) === 8, '分子只数 done 的 8 步（实得 ' + mod.readyCount(pend) + '）')
  ok(mod.envLabel(pend) === '8/9', '标签是 8/9 而不是 8/8（实得 ' + mod.envLabel(pend) + '）')

  console.log('== 2. 全过 → 仍然 9/9（绿色的判定 n===t 不变） ==')
  const done = mk9('done')
  ok(mod.envTotal(done) === 9 && mod.readyCount(done) === 9, '全过时 9/9')
  ok(mod.envLabel(done) === '9/9', '标签是 9/9（实得 ' + mod.envLabel(done) + '）')

  console.log('== 3. fail/current 照旧计入分母、不计入分子（只动 pending） ==')
  const fail = mk9('fail')
  ok(mod.envTotal(fail) === 9 && mod.readyCount(fail) === 8, 'fail 版 8/9（实得 ' + mod.envLabel(fail) + '）')
  const cur = mk9('current')
  ok(mod.envTotal(cur) === 9 && mod.readyCount(cur) === 8, 'current 版 8/9（实得 ' + mod.envLabel(cur) + '）')

  console.log('== 4. 空快照 → 仍然 --（首屏无数据不断言成 0/0） ==')
  const empty = { cwd: '/w/demo', chainSnapshot: { steps: [] } }
  ok(mod.envTotal(empty) === 0, '空快照分母为 0')
  ok(mod.envLabel(empty) === '--', '空快照标签仍是 --（实得 ' + mod.envLabel(empty) + '）')
  const nosnap = { cwd: '/w/demo' }
  ok(mod.envLabel(nosnap) === '--', '无快照标签仍是 --')

  console.log('== 5. 全 pending（例如断网刚评完）→ 0/2 诚实黄，不报 -- 也不报全绿 ==')
  const allpend = { cwd: '/w/demo', chainSnapshot: { steps: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }] } }
  ok(mod.envTotal(allpend) === 2 && mod.readyCount(allpend) === 0, '全 pending 时 0/2')
  ok(mod.envLabel(allpend) === '0/2', '标签是 0/2（实得 ' + mod.envLabel(allpend) + '）')

  if (failed) { console.log('\n1463 ENV COUNT TESTS FAILED'); process.exitCode = 1; return }
  console.log('\n1463 ENV COUNT TESTS PASSED')
}

main().catch((e) => { console.log('FAIL 沙箱求值失败：' + String((e && e.message) || e)); process.exitCode = 1 })
