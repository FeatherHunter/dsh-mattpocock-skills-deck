// 门禁归属: scripts/typecheck.mts
//
// verify-typecheck.mts —— 把类型检查入口（scripts/typecheck.mts）挂进 verify 长串的那一层薄壳。
//
// 为什么要有这个壳：npm test 的第一段已经是 `npm run typecheck`，但 verify 长串是另一条独立入口
// （CI 的 scripts/verify-all.mjs 与 scripts/verify-chain.js 都跑它），顺着长串跑的人不会经过 npm test，
// 于是同一件事在两条入口上表现不一样——典型症状是「本机 npm test 全绿、CI 红」。壳的作用只是把两处
// 接上，判定逻辑一行都不复制：断言、打印、退出码全在 scripts/typecheck.mts 里。
//
// 为什么不是「长串里直接写 npm run typecheck」：scripts/gate-map.mjs 的 readChainSteps 按
// `node tests/xxx.js` 的形状读链步，写别的形状它读不出来，门禁归属表会少这一步、也追溯不到源码。
//
// 为什么判定逻辑不搬到这里：搬一份就是第二处判据。真正的入口保持唯一，改判据只改 scripts/typecheck.mts。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.join(HERE, '..', 'scripts', 'typecheck.mts')

// 用当前这个 node 进程跑入口文件：入口是 .mts，靠 ts-hook（--import ./scripts/ts-hook.mjs）装载，
// 所以这里不能自己 spawn 一个不带钩子的 node（那样会报 ERR_UNKNOWN_FILE_EXTENSION）。
// import 的实参必须是 URL 形状：Windows 上直接给 'D:\...\typecheck.mts' 会被当成协议名而报
// ERR_UNSUPPORTED_ESM_URL_SCHEME。
const mod = await import(pathToFileURL(ENTRY).href)

try {
  const facts = mod.collectFacts()
  const findings = mod.judge(facts)
  mod.report(facts, findings)
  process.exitCode = findings.some((f) => f.level === 'fail') ? 1 : 0
} catch (err) {
  // 与入口保持一致：脚本自身跑不动（环境问题）与「检查不通过」（仓库问题）要能一眼分开。
  console.error('类型检查入口自身出错（退出码 2）：' + (err instanceof Error ? err.message : String(err)))
  process.exitCode = 2
}
