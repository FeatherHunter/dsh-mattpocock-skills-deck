// tests/verify-1158-completion-evidence.ts —— 「完成证据」这一层的门禁（#1158）。
//
// 为什么要有它：这一层修的是「跑到一半就收摊、退出码仍是 0」的假绿（#1146 就是实例：
// tests/verify-deck-no-hang.js 的 21 条断言只跑到第 12 条就退出，退出码 0，整条链判绿）。
// 它由三块拼成，任何一块松了假绿都会回来，而且不会有任何东西报出来：
//
//   1. 共享判据 tests/lib/gate-result.ts —— 记录的写法、解析、与期望对数，只有这一份；
//   2. 执行器 scripts/verify-chain.ts（主链与冒烟链都走它，后者是 #1178 接的）、
//      scripts/verify-parallel.mts、scripts/verify-all.mts —— 各只有一处调用，不许各写一份判定；
//   3. 归属表 tests/gate-map.json 的三格 —— gates[].completionRecord（主链上这扇开闸了没有）、
//      gates[].expectedAssertions（它该有多少条断言）、smokeGates[]（冒烟链上同样两件事，#1178）。
//
// 所以本门禁逐块把关：
//   甲 记录行的写法与解析        乙 判据的正例与七种反例
//   丙 期望表的装载              丁 三条执行器 + 冒烟那条路的端到端（临时夹具仓库里正反各跑一趟）
//   戊 真仓里的挂接与登记（含本门禁自己）
//
// 边界：本门禁不替两百多扇门禁各跑一遍（那是链自己的事），也不检查「某扇门禁的断言数写得对不对」——
// 那由链上实际跑一次来对。这里保证的是「判据、执行器、归属表」三处对得上、判据真的会红。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  GATE_RESULT_PREFIX,
  formatGateResult,
  parseGateResultLine,
  scanGateResult,
  judgeGateCompletion,
  judgeStepCompletion,
  loadCompletionExpectations,
  gateNameOf,
  printGateResult,
} from './lib/gate-result.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'tests/verify-1158-completion-evidence.ts'
const SELF_GATE = gateNameOf(SELF)
let total = 0
let failed = 0
function check(ok: unknown, msg: string): void {
  total += 1
  if (ok) {
    console.log('  PASS ' + msg)
    return
  }
  failed += 1
  console.log('  FAIL ' + msg)
}

// ---------------------------------------------------------------------------
// 甲）记录行的写法与解析
// ---------------------------------------------------------------------------
console.log('甲）记录行的写法与解析')
{
  const line = formatGateResult('verify-demo', 3, 0)
  check(line.startsWith(GATE_RESULT_PREFIX), '拼出来的记录行以「' + GATE_RESULT_PREFIX.trim() + '」开头')
  let parsed: unknown = null
  try {
    parsed = JSON.parse(line.slice(GATE_RESULT_PREFIX.length))
  } catch (e) {
    parsed = null
  }
  const rec = parsed as { gate?: unknown; assertions?: unknown; failed?: unknown } | null
  check(!!rec && rec.gate === 'verify-demo' && rec.assertions === 3 && rec.failed === 0, '这一行就是三字段的 JSON（gate / assertions / failed）')
  check(parseGateResultLine(line)?.assertions === 3, '解析合法行能拿到记录')
  check(parseGateResultLine('随便一行普通输出') === null, '非记录行解析回 null')
  check(parseGateResultLine(GATE_RESULT_PREFIX + '不是 JSON') === null, '坏 JSON 解析回 null')
  check(parseGateResultLine(GATE_RESULT_PREFIX + JSON.stringify({ gate: 'x', failed: 0 })) === null, '缺 assertions 字段解析回 null')
  check(parseGateResultLine(GATE_RESULT_PREFIX + JSON.stringify({ gate: 'x', assertions: -1, failed: 0 })) === null, '负数断言解析回 null')
  const two = formatGateResult('verify-demo', 1, 0) + '\n' + formatGateResult('verify-demo', 5, 0)
  check(scanGateResult(two).record?.assertions === 5, '一趟里出现两条记录时取最后一条（收尾那次才是结论）')
  const brokenScan = scanGateResult(formatGateResult('verify-demo', 2, 0) + '\n' + GATE_RESULT_PREFIX + '{坏}')
  check(brokenScan.record?.assertions === 2 && brokenScan.broken.length === 1, '读不懂的记录行单独记下来，不污染能读懂的那条')
  const empty = scanGateResult('什么都没有')
  check(empty.record === null && empty.broken.length === 0, '没有记录行的输出：record 为 null、broken 为空')
}

// ---------------------------------------------------------------------------
// 乙）判据的正例与七种反例
// ---------------------------------------------------------------------------
// 这一段是「反例自证」：判据要是永远返回绿，下面每一条坏样本都会当场把它戳穿。
console.log('乙）判据的正例与七种反例')
{
  const expect = { gate: 'verify-demo', expectedAssertions: 3 }
  const good = judgeGateCompletion({ ...expect, exitCode: 0, output: '收尾汇总行\n' + formatGateResult('verify-demo', 3, 0) })
  check(good.ok === true, '正例：退出码 0、记录齐全、计数对得上 → 判绿')
  const c1 = judgeGateCompletion({ ...expect, exitCode: 7, output: formatGateResult('verify-demo', 3, 0) })
  check(c1.ok === false && c1.reason.includes('7'), '反例一 退出码非零 → 红，理由里报出退出码')
  const c2 = judgeGateCompletion({ ...expect, exitCode: 0, output: '跑到一半就收摊了，一行记录都没有' })
  check(c2.ok === false && c2.reason.includes('缺完成记录'), '反例二 整趟没有记录行 → 红，理由说缺完成记录')
  const c3 = judgeGateCompletion({ ...expect, exitCode: 0, output: GATE_RESULT_PREFIX + '{不是 JSON}' })
  check(c3.ok === false && c3.reason.includes('读不懂'), '反例三 记录行读不懂 → 红')
  const c4 = judgeGateCompletion({ ...expect, exitCode: 0, output: formatGateResult('verify-别的', 3, 0) })
  check(c4.ok === false && c4.reason.includes('对不上'), '反例四 记录里的门禁名对不上 → 红')
  const c5 = judgeGateCompletion({ ...expect, exitCode: 0, output: formatGateResult('verify-demo', 3, 1) })
  check(c5.ok === false && c5.reason.includes('失败'), '反例五 记录自报有失败 → 红')
  const c6 = judgeGateCompletion({ ...expect, exitCode: 0, output: formatGateResult('verify-demo', 2, 0) })
  check(c6.ok === false && c6.reason.includes('少跑了 1 条'), '反例六 少跑断言 → 红，并说清少跑了几条')
  const c7 = judgeGateCompletion({ ...expect, exitCode: 0, output: formatGateResult('verify-demo', 4, 0) })
  check(c7.ok === false && c7.reason.includes('多跑了 1 条'), '反例七 多跑断言 → 红，并提示顺手改归属表')
  check(judgeStepCompletion(undefined, 3, '').ok === true, '没开闸的步骤（表里没期望）保持老行为：只看退出码')
  const openedStep = judgeStepCompletion({ step: 'node tests/x.js', file: 'tests/x.js', gate: 'verify-demo', expectedAssertions: 3 }, 0, '没有记录')
  check(openedStep.ok === false, '开了闸的步骤走判据：退出码 0 但没有记录就红')
}

// ---------------------------------------------------------------------------
// 丙）期望表的装载
// ---------------------------------------------------------------------------
console.log('丙）期望表的装载')
{
  const real = loadCompletionExpectations()
  check(real.byFile.size > 0 && real.byStep.size === real.byFile.size, '真表里抽出 ' + real.byFile.size + ' 扇已开闸的门禁，按文件与按步骤两张索引一致')
  let wellFormed = 0
  for (const e of real.byFile.values()) {
    if (e.expectedAssertions > 0 && e.gate === gateNameOf(e.file) && e.step.includes(e.file)) wellFormed += 1
  }
  check(wellFormed === real.byFile.size, '每扇期望的断言数都是正数，门禁名由文件名推得、步骤原文里含该文件（' + wellFormed + '/' + real.byFile.size + '）')
  const tmpMap = path.join(os.tmpdir(), 'verify-1158-map-' + process.pid + '.json')
  fs.writeFileSync(
    tmpMap,
    JSON.stringify({
      gates: [
        { step: 'node tests/a.js', file: 'tests/a.js', completionRecord: true, expectedAssertions: 2 },
        { step: 'node tests/b.js', file: 'tests/b.js', completionRecord: false, expectedAssertions: 0 },
        { step: 'node tests/c.js', file: 'tests/c.js', completionRecord: true, expectedAssertions: 0 },
      ],
    }),
  )
  const inMemory = loadCompletionExpectations(tmpMap)
  fs.unlinkSync(tmpMap)
  check(inMemory.byFile.size === 1 && inMemory.byFile.has('tests/a.js'), '只收「completionRecord 为 true 且期望是正数」的那一扇（0 期望的不收）')
  check(inMemory.byFile.get('tests/a.js')?.gate === 'a', '按文件名推门禁名（tests/a.js → a）')
}

// ---------------------------------------------------------------------------
// 丁）三条执行器的端到端：临时夹具仓库里正反各跑一趟
// ---------------------------------------------------------------------------
// 为什么在临时目录里造一个小仓：主链名单走规划函数（目录约定加显式排除表，#1125），
// 真仓里没法塞一条「故意不交记录」的步骤。夹具仓把同一份执行器、同一份判据、同一份规划函数、
// 一份小约定摆在一起，正趟证明判据不误伤，反趟证明「退出码 0 却没交记录」真的会被判红 ——
// 这正是本票要修的那类假绿。夹具门禁按约定起名（verify- 前缀），不然规划函数扫不到它们。
console.log('丁）三条执行器的端到端（临时夹具仓库）')
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1158-exec-'))
  const copy = (rel: string): void => {
    const to = path.join(tmpRoot, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(ROOT, rel), to)
  }
  copy('scripts/verify-chain.ts')
  copy('scripts/verify-all.mts')
  copy('scripts/verify-parallel.mts')
  copy('scripts/lib/discover-gates.ts')
  // 夹具约定：单默认段；冒烟专用的 gate-s 排除出主链（它只走冒烟那条路）。
  fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpRoot, 'scripts', 'verify-stages.json'),
    JSON.stringify(
      {
        stages: [{ name: 'behavior', match: [] }],
        exclude: [{ file: 'tests/verify-gate-s.js', reason: '冒烟专用，只走冒烟链（夹具）', ticket: '#1158' }],
      },
      null,
      2,
    ),
  )
  // 装载钩子也要一起搬：三条执行器给 tests/ 下的条目都会挂它（argvOf / withTsHook），
  // 夹具仓里少了这一份，子进程会以「找不到模块」红掉 —— 那就盖住了本门禁真正要看的判据。
  copy('scripts/ts-hook.mts')
  copy('tests/lib/gate-result.ts')
  fs.mkdirSync(path.join(tmpRoot, 'tests'), { recursive: true })
  // 夹具门禁：a 正常交记录（2 条断言）；b 不交记录也没登记（执行器只看退出码）；
  // c 先交记录（正趟用）、反趟前换成收摊版（退出码 0、一行记录都没有，但归属表里登记了 3 条期望）。
  fs.writeFileSync(
    path.join(tmpRoot, 'tests', 'verify-gate-a.js'),
    "const { printGateResult } = require('../tests/lib/gate-result.ts')\nprintGateResult('verify-gate-a', 2, 0)\nprocess.exit(0)\n",
  )
  fs.writeFileSync(path.join(tmpRoot, 'tests', 'verify-gate-b.js'), 'process.exit(0)\n')
  const gateCSrc = (body: string): void => fs.writeFileSync(path.join(tmpRoot, 'tests', 'verify-gate-c.js'), body)
  // 正趟时 c 老实交记录（3 条），反趟前再换成收摊版 —— 主链名单是扫出来的，c 不可能只在反趟出现。
  gateCSrc("const { printGateResult } = require('../tests/lib/gate-result.ts')\nprintGateResult('verify-gate-c', 3, 0)\nprocess.exit(0)\n")
  fs.writeFileSync(
    path.join(tmpRoot, 'tests', 'verify-gate-s.js'),
    "const { printGateResult } = require('../tests/lib/gate-result.ts')\nprintGateResult('verify-gate-s', 4, 0)\nprocess.exit(0)\n",
  )
  fs.writeFileSync(
    path.join(tmpRoot, 'tests', 'gate-map.json'),
    JSON.stringify(
      {
        version: 1,
        gates: [
          { step: 'node tests/verify-gate-a.js', file: 'tests/verify-gate-a.js', completionRecord: true, expectedAssertions: 2 },
          { step: 'node tests/verify-gate-b.js', file: 'tests/verify-gate-b.js', completionRecord: false, expectedAssertions: 0 },
          { step: 'node tests/verify-gate-c.js', file: 'tests/verify-gate-c.js', completionRecord: true, expectedAssertions: 3 },
        ],
        // 冒烟链的期望住在同一张表的另一个数组里（#1178）：冒烟不在主链上，
        // 混进 gates 会让归属与覆盖面跟着算错。
        smokeGates: [
          { step: 'node tests/verify-gate-s.js', file: 'tests/verify-gate-s.js', completionRecord: true, expectedAssertions: 4 },
        ],
      },
      null,
      2,
    ),
  )
  const executors = [
    { name: 'verify-chain.ts', rel: 'scripts/verify-chain.ts', args: [] as string[] },
    { name: 'verify-parallel.mts', rel: 'scripts/verify-parallel.mts', args: [] as string[] },
    { name: 'verify-all.mts', rel: 'scripts/verify-all.mts', args: [] as string[] },
  ]
  // 第四条入口（#1178）：冒烟从前是一条裸的 && 串，判据在它那条路上无事可做。
  // 现在它走同一个执行器的另一串清单（scripts.smoke），所以这里也按「同一份判据」验一遍。
  const smokeExecutor = { name: 'verify-chain.ts --script smoke', rel: 'scripts/verify-chain.ts', args: ['--script', 'smoke'] }
  // 主链名单走夹具约定（目录扫描），这里只用写冒烟那一串（执行器仍从 package.json 读它）。
  const writeSmoke = (smokeSteps: string[]): void => {
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify(
        { name: 'verify-1158-fixture', private: true, scripts: { smoke: smokeSteps.join(' && ') } },
        null,
        2,
      ),
    )
  }
  const run = (rel: string, args: string[] = []) =>
    spawnSync(process.execPath, [path.join(tmpRoot, rel), ...args], { cwd: tmpRoot, encoding: 'utf8' })
  const smokeGateSrc = (body: string): void => fs.writeFileSync(path.join(tmpRoot, 'tests', 'verify-gate-s.js'), body)
  writeSmoke(['node tests/verify-gate-s.js'])
  for (const ex of executors) {
    const r = run(ex.rel, ex.args)
    const out = String(r.stdout || '') + String(r.stderr || '')
    check(r.status === 0, '正趟 ' + ex.name + '：夹具链全绿（退出码 ' + r.status + '）')
    if (ex.name === 'verify-parallel.mts') {
      check(out.includes('完成证据判据：链上 2 步带期望'), '正趟 verify-parallel.mts：认出了链上那两步带期望（a 交记录、c 登记了期望）')
    } else {
      check(out.includes(GATE_RESULT_PREFIX), '正趟 ' + ex.name + '：把门禁交的记录原样透出来')
    }
  }
  // 反趟：主链名单是扫出来的（a 交记录、b 只看退出码、c 该交没交），不用再写链文件，直接跑。
  // 反趟前把 c 换成收摊版（退出码 0、一行记录都没有，但归属表里登记了 3 条期望）。
  gateCSrc("console.log('这扇门禁跑到一半就收摊了，一行记录都没交')\nprocess.exit(0)\n")
  for (const ex of executors) {
    const r = run(ex.rel, ex.args)
    const out = String(r.stdout || '') + String(r.stderr || '')
    check(r.status !== 0, '反趟 ' + ex.name + '：门禁退出码 0 却没交记录，执行器判红（退出码 ' + r.status + '）')
    check(out.includes('缺完成记录') && out.includes('gate-c'), '反趟 ' + ex.name + '：红的时候指名道姓说清是 gate-c 缺完成记录')
  }
  // 冒烟链的三趟：正趟（交记录、数字对）、收摊趟（退出码 0、一行记录都没有）、
  // 数字不符趟（交了记录，但计数与表里的期望不等）—— 票面第四条验收要的正是前两句话。
  writeSmoke(['node tests/verify-gate-s.js', 'node tests/verify-gate-b.js'])
  {
    const r = run(smokeExecutor.rel, smokeExecutor.args)
    const out = String(r.stdout || '') + String(r.stderr || '')
    check(r.status === 0, '冒烟正趟 ' + smokeExecutor.name + '：夹具冒烟链全绿（退出码 ' + r.status + '）')
    check(
      out.includes(GATE_RESULT_PREFIX) && out.includes('全绿（2 条，其中 1 条带完成证据判据）'),
      '冒烟正趟：把冒烟门禁的记录原样透出来，并认出了链上那一步带期望',
    )
  }
  smokeGateSrc("console.log('这扇冒烟跑到一半就收摊了，一行记录都没交')\nprocess.exit(0)\n")
  {
    const r = run(smokeExecutor.rel, smokeExecutor.args)
    const out = String(r.stdout || '') + String(r.stderr || '')
    check(r.status !== 0, '冒烟收摊趟：退出码 0 却没交记录，执行器判红（退出码 ' + r.status + '）')
    check(out.includes('缺完成记录') && out.includes('gate-s'), '冒烟收摊趟：红的时候指名道姓说清是 gate-s 缺完成记录')
  }
  smokeGateSrc("const { printGateResult } = require('../tests/lib/gate-result.ts')\nprintGateResult('verify-gate-s', 3, 0)\nprocess.exit(0)\n")
  {
    const r = run(smokeExecutor.rel, smokeExecutor.args)
    const out = String(r.stdout || '') + String(r.stderr || '')
    check(r.status !== 0, '冒烟数字不符趟：记录说 3 条、表里记 4 条，执行器判红（退出码 ' + r.status + '）')
    check(out.includes('断言数 3 ≠ 归属表里记着的 4'), '冒烟数字不符趟：红的时候把「3 ≠ 4」写出来')
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 戊）真仓里的挂接与登记（含本门禁自己）
// ---------------------------------------------------------------------------
console.log('戊）真仓里的挂接与登记')
{
  // 主链名单走规划函数（#1125）；冒烟那六条还住在 package.json 里，所以「挂在链上」
  // 这句要按两条链一起算：已开闸的门禁恰好挂在一条链上（主链或冒烟链），既不能漏，也不能两边都挂。
  const steps = planGates(ROOT).map((s) => s.cmd)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  const expectations = loadCompletionExpectations()
  const openedFiles = [...expectations.byFile.keys()]
  // 第四条入口 test:smoke（#1178）：它从裸的 && 串改成走同一个链执行器（--script smoke），
  // 判据在它那条路上才真正生效。冒烟的门禁不在主链上，所以「挂在链上」这句要按两条链一起算。
  const smokeEntry = String((pkg.scripts && pkg.scripts['test:smoke']) || '')
  check(
    smokeEntry.includes('scripts/verify-chain.ts') && smokeEntry.includes('--script smoke'),
    'test:smoke 走的是同一个链执行器（scripts/verify-chain.ts --script smoke），不再是一条裸的 && 串',
  )
  const smokeList = String((pkg.scripts && pkg.scripts.smoke) || '')
  const smokeSteps = smokeList.split('&&').map((s) => s.trim()).filter(Boolean)
  const smokeFiles = smokeSteps
    .map((s) => {
      const m = /tests\/\S+\.(js|mjs|cjs|ts|mts|cts)$/.exec(s)
      return m ? m[0] : ''
    })
    .filter(Boolean)
  // 2026-10-17 修：这条原来写死「六条」。冒烟链今天就是五条——第六扇 tests/smoke-host.test.js
  //   与 tests/verify-596 是同一件事的复刻（同一批门禁、同一组锚点），已按对抗审查的结论删除，
  //   package.json 的 scripts.smoke 也随之从六条变成五条。数字抽成带来历的常量：
  //   以后加减冒烟条目时这里与 package.json 要一起改，只改一边会当场红——这正是这条断言的意义。
  const EXPECTED_SMOKE_FILES = 5
  check(
    smokeFiles.length === EXPECTED_SMOKE_FILES && smokeSteps.every((s) => s.includes('--import')),
    '冒烟清单住在 scripts.smoke 里，' + EXPECTED_SMOKE_FILES + ' 条逐条挂装载钩子（今天 ' + smokeFiles.length + ' 条）',
  )
  const smokeOpened = smokeFiles.filter((f) => expectations.byFile.has(f))
  check(
    smokeOpened.length > 0,
    '冒烟链上已有 ' + smokeOpened.length + ' 扇开闸（' + smokeOpened.join('、') + '）：执行器会对它们对数，判据不再「无事可做」',
  )
  // 跨链合计：每扇已开闸的门禁恰好挂在一条链上（主链或冒烟链），既不能漏，也不能两边都挂。
  const allSteps = [...steps, ...smokeSteps]
  const notOnChain = openedFiles.filter((f) => !allSteps.some((s) => s.includes(f)))
  check(notOnChain.length === 0, '已开闸的 ' + openedFiles.length + ' 扇门禁都挂在某一条链上（没挂的 ' + notOnChain.length + ' 扇' + (notOnChain.length ? '：' + notOnChain.join('、') : '') + '）')
  const duplicated = openedFiles.filter((f) => allSteps.filter((s) => s.includes(f)).length !== 1)
  check(duplicated.length === 0, '每扇已开闸的门禁在两条链上合计恰好出现一次（异常 ' + duplicated.length + ' 扇' + (duplicated.length ? '：' + duplicated.join('、') : '') + '）')
  const shared = ['scripts/verify-chain.ts', 'scripts/verify-parallel.mts', 'scripts/verify-all.mts']
  const wired = shared.filter((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('judgeStepCompletion'))
  check(wired.length === shared.length, '三条执行器都从 tests/lib/gate-result.ts 取判据（' + wired.length + '/' + shared.length + '）')
  // 本门禁自己也要开闸：归属表里记的期望条数必须与本趟实际跑出来的条数一致。
  // 这条是「归属表不会悄悄过期」的保证 —— 以后往这里加断言、忘了改归属表，这里当场红。
  const mine = expectations.byFile.get(SELF)
  check(!!mine && mine.gate === SELF_GATE, '本门禁自己已在归属表里开闸（' + (mine ? '记着 ' + mine.expectedAssertions + ' 条' : '没找到') + '）')
  check(!!mine && mine.expectedAssertions === total + 1, '归属表里记的期望条数与本趟实际条数一致（记着 ' + (mine ? mine.expectedAssertions : 0) + '、本趟含这一条共 ' + (total + 1) + ' 条）')
}

console.log('')
console.log('完成证据门禁：' + total + ' 条断言，' + (failed ? failed + ' 条失败' : '全部通过'))
printGateResult(SELF_GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
