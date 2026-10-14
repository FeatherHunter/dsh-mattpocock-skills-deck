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
//
// #1148 加的第二段：判据的假事实自查。judge() 本来就是按「喂事实、出结论」分出来的（见它的注释），
// 上半段用几组假的配置事实把归属口径钉住——「顺 import 看到别人目录的文件」与「include 声明了别人
// 目录的文件」是两件事，前者不报越界、不报重复归属，后者才报。这几条用真仓库验不出来：真仓库今天
// 恰好没有「声明越界」的配置，只有「顺 import 看见」这种正常依赖，光跑一遍真仓库只能证明它不红。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 类型从入口借，不在这里手抄一份：假事实将来少填一格、或判据多读一格，这里跟着报错，
// 而不是继续全绿。这个 import 只有类型、运行时会被整句删掉（Node 的类型剥离 + ts-hook 都不受影响）；
// 写全 `.mts` 后缀是因为这份测试今天不在任何 tsconfig 里，将来真给它配一份时用 noEmit +
// allowImportingTsExtensions 就能直接查（仓里所有配置都是 noEmit）。
import type { ConfigFacts, Facts, Finding } from '../scripts/typecheck.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.join(HERE, '..', 'scripts', 'typecheck.mts')

// 用当前这个 node 进程跑入口文件：入口是 .mts，靠 ts-hook（--import ./scripts/ts-hook.mjs）装载，
// 所以这里不能自己 spawn 一个不带钩子的 node（那样会报 ERR_UNKNOWN_FILE_EXTENSION）。
// import 的实参必须是 URL 形状：Windows 上直接给 'D:\...\typecheck.mts' 会被当成协议名而报
// ERR_UNSUPPORTED_ESM_URL_SCHEME。
// 标上入口的类型（实参是 URL 字符串，编译器认不出它指向谁，不标就是 any）：
// 下面 judge() 的返回、report() 的入参才有类型，`(f) => f.level` 这类回调也不再是隐式 any。
const mod: typeof import('../scripts/typecheck.mts') = await import(pathToFileURL(ENTRY).href)

/** 造假配置事实时可以拨的几格。 */
type FakeConfigOptions = { claimed?: string[]; files?: string[]; checkCode?: number }

/**
 * 一条假配置事实：只填判据真正读到的字段，其余给不骗人的空值。
 * 返回值标成入口导出的 ConfigFacts，就是为了让「少填一格」在类型上站不住——不然判据多读一格时，
 * 这组自查照样全绿，反而成了新的假安全。
 */
function fakeConfig(config: string, dir: string, { claimed = [], files = [], checkCode = 0 }: FakeConfigOptions = {}): ConfigFacts {
  return { config, dir, files, claimed, claimedFrom: 'include', enumCode: 0, enumOutput: '', checkCode, errors: [] }
}

/** 一次假调查：配置事实 + 仓库源码清单 + 一份「基线齐、没涨没缩」的棘轮对账。 */
function fakeFacts(configs: ConfigFacts[], repoScripts: string[]): Facts {
  return {
    configs,
    repoScripts,
    repoScriptsInSrc: repoScripts.filter((f) => f.startsWith('src/')),
    ratchet: { current: [], baseline: [], added: [], gone: [], baselineFound: true },
  }
}

/** 某类结论里点到某个文件的那些条。 */
const hits = (findings: Finding[], topic: string, file: string): Finding[] =>
  findings.filter((f) => f.topic === topic && f.msg.includes(file))

const caseFailures: string[] = []
function checkCase(name: string, run: () => string | null): void {
  try {
    const bad = run()
    if (bad) {
      caseFailures.push(name + '：' + bad)
      console.log('FAIL ' + name + ' —— ' + bad)
    } else {
      console.log('PASS ' + name)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    caseFailures.push(name + '：判据抛异常（' + msg + '）')
    console.log('FAIL ' + name + ' —— 判据抛异常（' + msg + '）')
  }
}

checkCase('顺 import 看到别人目录的文件：不报越界、不报重复归属', () => {
  // deck 那条配置的真实形状：include 只声明自己目录，闭包里有 tracker 的文件。
  const facts = fakeFacts(
    [
      fakeConfig('src/deck/tsconfig.json', 'src/deck', { claimed: ['src/deck/a.ts'], files: ['src/deck/a.ts', 'src/tracker/b.ts'] }),
      fakeConfig('src/tracker/tsconfig.json', 'src/tracker', { claimed: ['src/tracker/b.ts'], files: ['src/tracker/b.ts'] }),
    ],
    ['src/deck/a.ts', 'src/tracker/b.ts'],
  )
  const findings = mod.judge(facts)
  if (hits(findings, '越界', 'src/tracker/b.ts').length) return '把「顺 import 看见」当成了越界'
  if (hits(findings, '重复归属', 'src/tracker/b.ts').length) return '把「顺 import 看见」当成了重复归属'
  return null
})

checkCase('两份配置都声明同一个文件：报重复归属', () => {
  const facts = fakeFacts(
    [
      fakeConfig('src/a/tsconfig.json', 'src/a', { claimed: ['src/a/a.ts', 'src/b/b.ts'], files: ['src/a/a.ts', 'src/b/b.ts'] }),
      fakeConfig('src/b/tsconfig.json', 'src/b', { claimed: ['src/b/b.ts'], files: ['src/b/b.ts'] }),
    ],
    ['src/a/a.ts', 'src/b/b.ts'],
  )
  const findings = mod.judge(facts)
  if (!hits(findings, '重复归属', 'src/b/b.ts').length) return '两份配置都声明了 src/b/b.ts，却没报重复归属'
  return null
})

checkCase('声明自己目录之外的文件：报越界', () => {
  const facts = fakeFacts(
    [fakeConfig('src/a/tsconfig.json', 'src/a', { claimed: ['src/a/a.ts', 'src/b/b.ts'], files: ['src/a/a.ts', 'src/b/b.ts'] })],
    ['src/a/a.ts', 'src/b/b.ts'],
  )
  const findings = mod.judge(facts)
  if (!hits(findings, '越界', 'src/b/b.ts').length) return 'include 声明了 src/b/b.ts，却没报越界'
  return null
})

checkCase('仓库根上的配置：跳越界（它的「自己目录」就是根）', () => {
  const facts = fakeFacts(
    [fakeConfig('tsconfig.contract.json', '', { claimed: ['src/b/b.ts'], files: ['src/b/b.ts'] })],
    ['src/b/b.ts'],
  )
  const findings = mod.judge(facts)
  if (hits(findings, '越界', 'src/b/b.ts').length) return '根上的配置被误判成越界'
  return null
})

checkCase('缺口仍按程序闭包判：顺 import 看过就算有人管', () => {
  // 声明是空的、闭包里有 src/a/a.ts：缺口判据若跟着改成看声明，会把 a.ts 误报成「没人检查」。
  const facts = fakeFacts(
    [fakeConfig('src/a/tsconfig.json', 'src/a', { claimed: [], files: ['src/a/a.ts'] })],
    ['src/a/a.ts', 'src/c/c.ts'],
  )
  const findings = mod.judge(facts)
  if (hits(findings, '缺口', 'src/a/a.ts').length) return '被编译器看过的 src/a/a.ts 被误报成缺口'
  if (!hits(findings, '缺口', 'src/c/c.ts').length) return '谁都没看的 src/c/c.ts 没被报成缺口'
  return null
})

try {
  const facts = mod.collectFacts()
  const findings = mod.judge(facts)
  mod.report(facts, findings)
  const auditFailed = findings.some((f) => f.level === 'fail')
  if (caseFailures.length) console.log('判据自查不通过：' + caseFailures.length + ' 条，逐条见上。')
  process.exitCode = auditFailed || caseFailures.length ? 1 : 0
} catch (err) {
  // 与入口保持一致：脚本自身跑不动（环境问题）与「检查不通过」（仓库问题）要能一眼分开。
  console.error('类型检查入口自身出错（退出码 2）：' + (err instanceof Error ? err.message : String(err)))
  process.exitCode = 2
}
