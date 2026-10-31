// #1711 报告索引命令的黑盒门禁：只用进程接口跑 scripts/real-machine/commands/report-index.mts，
// 不 import 命令内部函数、不读源码文本。样例快照在 tests/fixtures/report-index/。
//
// 正例覆盖：样例输入 → stdout 一份 JSON + Markdown 快照逐字一致；默认路径；未映射场景；各类非法输入报错带行号。
// 负例：--negative 会真跑一遍成功命令，然后故意写两条例必红的断言，让本门禁自报失败并退出 1；
// 正例里还会 spawn 自己跑一次 --negative，确认这条负例通道没有失效。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealMachineHarness, REPO_ROOT, samePath } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'
import type { CommandRun } from './lib/real-machine-process.ts'
import type { RealMachineHarness } from './lib/real-machine-process.ts'

const GATE = 'verify-1711-report-index'
const NEGATIVE = process.argv.includes('--negative')
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'report-index')
const CANDIDATE_C1 = '1'.repeat(40)

let assertions = 0
let failed = 0

function check(ok: boolean, message: string, detail?: string): void {
  assertions++
  if (ok) {
    console.log('PASS ' + message)
    return
  }
  failed++
  console.log('FAIL ' + message + (detail ? '：' + detail : ''))
}

function show(value: unknown): string {
  return JSON.stringify(value)
}

function firstDiff(expected: unknown, actual: unknown, at: string): string {
  if (expected === actual) return ''
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return at + ' 长度 ' + expected.length + ' !== ' + actual.length
    for (let i = 0; i < expected.length; i++) {
      const diff = firstDiff(expected[i], actual[i], at + '[' + i + ']')
      if (diff) return diff
    }
    return ''
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const expectedObj = expected as Record<string, unknown>
    const actualObj = actual as Record<string, unknown>
    const keys = Object.keys(expectedObj)
    for (const key of keys) {
      const diff = firstDiff(expectedObj[key], actualObj[key], at + '.' + key)
      if (diff) return diff
    }
    const extra = Object.keys(actualObj).filter((key) => !keys.includes(key))
    if (extra.length > 0) return at + ' 多出字段 ' + extra.join('/')
    return ''
  }
  return at + ' 期望 ' + show(expected) + '，实际 ' + show(actual)
}

function deepEqual(expected: unknown, actual: unknown): boolean {
  return firstDiff(expected, actual, '') === ''
}

function fixtureText(rel: string): string {
  return readFileSync(path.join(FIXTURE_DIR, rel), 'utf8')
}

function runReport(harness: RealMachineHarness, args: string[]): CommandRun {
  return harness.runCommand('report-index', { args })
}

function asJson(run: CommandRun): Record<string, any> {
  return (run.json || {}) as Record<string, any>
}

function absolute(harness: RealMachineHarness, rel: string): string {
  return path.join(harness.workRoot, rel)
}

function prepareSample(harness: RealMachineHarness): void {
  harness.writeText('fixtures/index.jsonl', fixtureText(path.join('sample', 'index.jsonl')))
  harness.writeText('fixtures/conditions.jsonl', fixtureText(path.join('sample', 'conditions.jsonl')))
  harness.writeText('fixtures/defects.json', fixtureText(path.join('sample', 'defects.json')))
}

function sampleArgs(harness: RealMachineHarness): string[] {
  return [
    '--index', absolute(harness, 'fixtures/index.jsonl'),
    '--conditions', absolute(harness, 'fixtures/conditions.jsonl'),
    '--defects', absolute(harness, 'fixtures/defects.json'),
  ]
}

// 最小合法索引行，错误路径的测试用例在这上面改一处坏掉，保证报的就是要测的那处错。
function indexRow(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    batch: 'B1',
    scenario: 'J1-01',
    attempt: 1,
    candidate: CANDIDATE_C1,
    verdict: '通过',
    claim: '最小合法行',
    evidencePaths: ['evidence-archive/B1-20261031/J1-01/attempt-1/'],
    independentSide: 'glab-api',
    defect: null,
    retest: null,
    start: '2026-10-31T05:10:00+08:00',
    end: '2026-10-31T05:22:00+08:00',
  }
  return Object.assign(base, overrides || {})
}

function without(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const name of Object.keys(row)) {
    if (name !== key) copy[name] = row[name]
  }
  return copy
}

function jsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
}

function conditionRow(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    condition: '免费档不支持原生阻塞写',
    scope: 'GitLab Free / 所有项目',
    scenario: 'J7-02',
    evidence: 'evidence-archive/B1-20261031/J7-02/attempt-1/',
    alternative: '正文标记',
    expiry: '下一版重验',
    owner: '#1679',
  }
  return Object.assign(base, overrides || {})
}

// 错误路径的公共验收：退出码 1、stdout 不输出 JSON、stderr 里能找到要查的短语。
function checkErrorRun(label: string, run: CommandRun, phrases: string[]): void {
  check(run.exitCode === 1, label + '：退出码 1', '实际退出码 ' + show(run.exitCode) + '，stderr=' + run.stderr.trim())
  check(run.stdout.trim() === '', label + '：stdout 为空', '实际 stdout=' + show(run.stdout))
  check(run.stderr.includes('命令失败'), label + '：stderr 说明命令失败', '实际 stderr=' + run.stderr.trim())
  for (const phrase of phrases) {
    check(run.stderr.includes(phrase), label + '：stderr 含「' + phrase + '」', '实际 stderr=' + run.stderr.trim())
  }
}

async function positiveFlow(harness: RealMachineHarness): Promise<void> {
  const expected = JSON.parse(fixtureText('expected-summary.json')) as Record<string, unknown>
  const expectedMarkdown = fixtureText('expected-summary.md')
  prepareSample(harness)

  // A 段：完整样例跑一遍，逐字比对快照。
  const run = runReport(harness, sampleArgs(harness).concat(['--markdown-out', absolute(harness, 'out/summary.md')]))
  check(run.exitCode === 0, '样例命令退出码 0', harness.formatFailure(run))
  const json = asJson(run)
  check(json.ok === true, '样例输出 ok=true', show(json.ok))
  check(run.json !== null && run.stdout.trim().startsWith('{') && run.stdout.trim().endsWith('}'), 'stdout 只有一段 JSON，前后没有多余输出', show(run.stdout.slice(0, 200)))
  check(run.jsonError === '', 'stdout 是合法 JSON', show(run.jsonError))
  check(deepEqual(expected.totals, json.totals), '样例 totals 与快照一致', firstDiff(expected.totals, json.totals, 'totals'))
  check(deepEqual(expected.assertions, json.assertions), '样例 assertions 与快照一致', firstDiff(expected.assertions, json.assertions, 'assertions'))
  check(deepEqual(expected.unmappedScenarios, json.unmappedScenarios), '样例 unmappedScenarios 与快照一致', firstDiff(expected.unmappedScenarios, json.unmappedScenarios, 'unmappedScenarios'))
  check(deepEqual(expected.candidates, json.candidates), '样例 candidates 与快照一致', firstDiff(expected.candidates, json.candidates, 'candidates'))
  check(deepEqual(expected.defects, json.defects), '样例 defects 与快照一致', firstDiff(expected.defects, json.defects, 'defects'))
  check(deepEqual(expected.conditions, json.conditions), '样例 conditions 与快照一致', firstDiff(expected.conditions, json.conditions, 'conditions'))
  check(typeof json.markdown === 'string' && json.markdown.trimEnd() === expectedMarkdown.trimEnd(), '样例 Markdown 与快照逐字一致', firstDiff(expectedMarkdown.trimEnd(), typeof json.markdown === 'string' ? json.markdown.trimEnd() : json.markdown, 'markdown'))
  const markdownPath = typeof json.markdownPath === 'string' ? json.markdownPath : ''
  check(markdownPath !== '' && samePath(markdownPath, absolute(harness, 'out/summary.md')), '--markdown-out 返回写出的路径', show(json.markdownPath))
  const written = harness.exists('out/summary.md') ? harness.readText('out/summary.md') : ''
  check(written.trimEnd() === expectedMarkdown.trimEnd(), '--markdown-out 文件内容与快照一致', firstDiff(expectedMarkdown.trimEnd(), written.trimEnd(), 'file'))
  check(samePath(String(json.indexPath || ''), absolute(harness, 'fixtures/index.jsonl')), 'indexPath 回显显式传入的索引路径', show(json.indexPath))

  // 关键数字再单独钉一遍：快照若被成批改坏，这里还能指出哪个口径漂了。
  const assertionsById: Record<string, any> = {}
  for (const item of (json.assertions || [])) assertionsById[String(item.id)] = item
  check(assertionsById.A1 && assertionsById.A1.attempts === 5, 'A1 尝试次数 5（A8 未测行不计入 A1 以外重复计数之外的额外行）', show(assertionsById.A1))
  check(assertionsById.A6 && assertionsById.A6.attempts === 9, 'A6 尝试次数 9（含 J7-02 的双断言重复计数）', show(assertionsById.A6))
  check(assertionsById.A8 && assertionsById.A8.attempts === 3, 'A8 按未测行计 3 次', show(assertionsById.A8))
  check(json.totals && json.totals.rows === 18, '总行数 18', show(json.totals && json.totals.rows))
  check((json.candidates || []).length === 2 && json.candidates[0].passRate === 0.3636 && json.candidates[1].passRate === 0.8, '两个候选的有效通过率 0.3636 / 0.8', show(json.candidates))
  const defectGroups = (json.defects || { P0: [], P1: [], P2: [] }) as Record<string, any[]>
  check((defectGroups.P0 || []).length === 1 && (defectGroups.P1 || []).length === 2 && (defectGroups.P2 || []).length === 1, '缺陷按 P0/P1/P2 分组张数 1/2/1', show(json.defects))
  check(json.conditions && json.conditions.count === 3, '条件账本 3 条', show(json.conditions && json.conditions.count))

  // B 段：不给参数时读工作根下的默认位置。
  harness.writeText('evidence-archive/index.jsonl', fixtureText(path.join('sample', 'index.jsonl')))
  harness.writeText('evidence-archive/conditions.jsonl', fixtureText(path.join('sample', 'conditions.jsonl')))
  const defaultRun = runReport(harness, [])
  check(defaultRun.exitCode === 0, '默认路径命令退出码 0', harness.formatFailure(defaultRun))
  const defaultJson = asJson(defaultRun)
  check(defaultJson.totals && defaultJson.totals.rows === 18, '默认路径读到 18 行', show(defaultJson.totals))
  check(samePath(String(defaultJson.indexPath || ''), absolute(harness, 'evidence-archive/index.jsonl')), '默认索引路径在 evidence-archive 下', show(defaultJson.indexPath))
  check(samePath(String(defaultJson.conditionsPath || ''), absolute(harness, 'evidence-archive/conditions.jsonl')), '默认条件路径在 evidence-archive 下', show(defaultJson.conditionsPath))
  check(defaultJson.markdownPath === null, '没传 --markdown-out 时 markdownPath 为 null', show(defaultJson.markdownPath))
  harness.removePath('evidence-archive/conditions.jsonl')
  const noConditionsRun = runReport(harness, [])
  check(noConditionsRun.exitCode === 0, '默认条件文件缺失时命令仍成功', harness.formatFailure(noConditionsRun))
  const noConditionsJson = asJson(noConditionsRun)
  check(noConditionsJson.conditions && noConditionsJson.conditions.count === 0, '默认条件文件缺失时条件数为 0', show(noConditionsJson.conditions))
  check(noConditionsJson.conditionsPath === null, '默认条件文件缺失时 conditionsPath 为 null', show(noConditionsJson.conditionsPath))

  // E 段：未知场景不报错，进未映射清单；其余口径按所属场景。
  const unmappedRows = [
    indexRow(),
    indexRow({ scenario: 'J99-01', attempt: 1 }),
    indexRow({ scenario: 'J99-01', attempt: 2 }),
  ]
  harness.writeText('unmapped/index.jsonl', jsonl(unmappedRows))
  const unmappedRun = runReport(harness, ['--index', absolute(harness, 'unmapped/index.jsonl')])
  check(unmappedRun.exitCode === 0, '未映射场景命令退出码 0', harness.formatFailure(unmappedRun))
  const unmappedJson = asJson(unmappedRun)
  check(deepEqual(unmappedJson.unmappedScenarios, [{ scenario: 'J99-01', attempts: 2 }]), '未映射场景按场景聚合尝试次数', firstDiff([{ scenario: 'J99-01', attempts: 2 }], unmappedJson.unmappedScenarios, 'unmappedScenarios'))
  check(unmappedJson.totals && unmappedJson.totals.unmappedScenarios === 1, '未映射场景数为 1', show(unmappedJson.totals && unmappedJson.totals.unmappedScenarios))
  check(String(unmappedJson.markdown || '').includes('J99-01'), 'Markdown 列出未映射场景', show(unmappedJson.markdown))

  // C 段：一类坏数据一例，报错都要指出行号。
  const errorsDir = 'errors'
  function writeErrorCase(name: string, indexText: string, conditionsText: string | null): string[] {
    const base = errorsDir + '/' + name
    harness.writeText(base + '/index.jsonl', indexText)
    const args = ['--index', absolute(harness, base + '/index.jsonl')]
    if (conditionsText !== null) {
      harness.writeText(base + '/conditions.jsonl', conditionsText)
      args.push('--conditions', absolute(harness, base + '/conditions.jsonl'))
    }
    return args
  }

  checkErrorRun(
    '非法 verdict',
    runReport(harness, writeErrorCase('bad-verdict', jsonl([indexRow(), indexRow({ scenario: 'J1-02', verdict: '通过（基本）' })]), null)),
    ['第 2 行', 'verdict「通过（基本）」', '六类之一'],
  )
  checkErrorRun(
    '缺字段 candidate',
    runReport(harness, writeErrorCase('missing-field', jsonl([without(indexRow(), 'candidate')]), null)),
    ['第 1 行', '缺字段「candidate」'],
  )
  checkErrorRun(
    '重复行',
    runReport(harness, writeErrorCase('duplicate', jsonl([indexRow(), indexRow({ scenario: 'J1-02' }), indexRow()]), null)),
    ['第 3 行与第 1 行重复', '批次 B1', '场景 J1-01', '尝试 1'],
  )
  checkErrorRun(
    'candidate 不完整',
    runReport(harness, writeErrorCase('short-candidate', jsonl([indexRow({ candidate: 'main' })]), null)),
    ['第 1 行', 'candidate「main」不是完整的 40 位提交哈希'],
  )
  checkErrorRun(
    '索引行不是合法 JSON',
    runReport(harness, writeErrorCase('bad-json', jsonl([indexRow()]) + '不是 JSON\n', null)),
    ['第 2 行', '不是合法 JSON'],
  )
  checkErrorRun(
    '场景号形状不对',
    runReport(harness, writeErrorCase('bad-scenario', jsonl([indexRow({ scenario: 'J1-1' })]), null)),
    ['第 1 行', '场景号「J1-1」'],
  )
  checkErrorRun(
    '非产品缺陷行却带缺陷票',
    runReport(harness, writeErrorCase('defect-on-pass', jsonl([indexRow(), indexRow({ scenario: 'J1-02', defect: '#2001' })]), null)),
    ['第 2 行', '不是产品缺陷', '#2001'],
  )
  checkErrorRun(
    '条件缺字段',
    runReport(harness, writeErrorCase('condition-missing', jsonl([indexRow()]), jsonl([without(conditionRow(), 'owner')]))),
    ['conditions.jsonl', '第 1 行', '缺字段「owner」'],
  )
  checkErrorRun(
    '缺陷覆盖清单等级非法',
    (() => {
      harness.writeText('errors/bad-defects/index.jsonl', jsonl([indexRow({ verdict: '产品缺陷', defect: '#2001' })]))
      harness.writeText('errors/bad-defects/defects.json', JSON.stringify([{ ticket: '#2001', level: 'P9' }]))
      return runReport(harness, ['--index', absolute(harness, 'errors/bad-defects/index.jsonl'), '--defects', absolute(harness, 'errors/bad-defects/defects.json')])
    })(),
    ['defects.json', 'P0/P1/P2', 'P9'],
  )

  // F 段：P2 产品缺陷按规格不开缺陷票，defect=null 必须能通过，并单独进「无票」清单。
  harness.writeText('unticketed/index.jsonl', jsonl([indexRow({ verdict: '产品缺陷', claim: 'P2 已知限制', retest: '下一版重验' })]))
  const unticketedRun = runReport(harness, ['--index', absolute(harness, 'unticketed/index.jsonl')])
  check(unticketedRun.exitCode === 0, 'P2 产品缺陷无票号时命令成功', harness.formatFailure(unticketedRun))
  const unticketedJson = asJson(unticketedRun)
  const unticketed = (unticketedJson.unticketedProductDefects || []) as Array<Record<string, unknown>>
  check(unticketed.length === 1 && unticketed[0].scenario === 'J1-01' && unticketed[0].retest === '下一版重验', '无票产品缺陷进 unticketedProductDefects 并带上重验状态', show(unticketedJson.unticketedProductDefects))
  check(JSON.stringify(unticketedJson.defects) === JSON.stringify({ P0: [], P1: [], P2: [] }), '无票产品缺陷不算成带票缺陷', show(unticketedJson.defects))
  check(String(unticketedJson.markdown || '').includes('无缺陷票'), 'Markdown 单列无票 P2 已知限制', String(unticketedJson.markdown || '').slice(-800))

  // 索引文件不存在：报错里要给出默认位置和补救办法。
  harness.removePath('missing/index.jsonl')
  checkErrorRun(
    '索引文件不存在',
    runReport(harness, ['--index', absolute(harness, 'missing/index.jsonl')]),
    ['找不到全局索引', '--index'],
  )

  // D 段：负例通道自检。门禁的负例必须能单独触发，而且真判红。
  const child = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', 'tests/verify-1711-report-index.ts', '--negative'], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: absolute(harness, 'negative-gate') }),
    encoding: 'utf8',
    timeout: 120000,
  })
  const childStdout = String(child.stdout || '')
  const scan = scanGateResult(childStdout)
  check(child.status === 1, '负例单独触发时退出码 1', '实际 status=' + show(child.status) + '，stderr=' + String(child.stderr || '').slice(0, 600))
  check(childStdout.includes('[负例]'), '负例输出带 [负例] 标记', childStdout.slice(-600))
  check(childStdout.includes('FAIL '), '负例输出里有被判红的 FAIL 行', childStdout.slice(-600))
  check(scan.record !== null && scan.record.failed >= 2, '负例自报失败断言不少于 2 条', show(scan.record))
  check(scan.record !== null && scan.record.gate === GATE, '负例的 GATE-RESULT 门禁名正确', show(scan.record && scan.record.gate))
}

async function negativeFlow(harness: RealMachineHarness): Promise<void> {
  prepareSample(harness)
  const run = runReport(harness, sampleArgs(harness))
  const json = asJson(run)

  // 先真跑一遍：这条绿断言证明负例不是「命令压根起不来」，而是后面的故意错误期望判红。
  check(run.exitCode === 0, '[负例准备] 样例命令真的成功（这条应为绿）', harness.formatFailure(run))
  check(json.totals && json.totals.rows === 18, '[负例准备] 样例行数 18（这条应为绿）', show(json.totals))

  // 下面两条是故意的错误期望，负例通道靠它们判红；不要改成正确值。
  check(run.exitCode === 1, '[负例] 故意把成功命令的退出码期望成 1，这条必须判红', '实际退出码 ' + show(run.exitCode))
  const a1 = (json.assertions || []).find((item: any) => item.id === 'A1')
  check(a1 && a1.attempts === 999, '[负例] 故意把 A1 尝试次数期望成 999，这条必须判红', show(a1 && a1.attempts))
}

async function main(): Promise<void> {
  const harness = createRealMachineHarness({ name: 'verify-1711-report-index' })
  try {
    if (NEGATIVE) {
      await negativeFlow(harness)
    } else {
      await positiveFlow(harness)
    }
  } finally {
    harness.dispose()
  }
  if (NEGATIVE) {
    console.log('[负例] 负例自检结束：' + failed + ' 条断言被判红（预期 2 条）')
    printGateResult(GATE, assertions, failed)
    process.exitCode = 1
    return
  }
  const record = printGateResult(GATE, assertions, failed)
  console.log('GATE-SUMMARY ' + JSON.stringify(record))
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  printGateResult(GATE, assertions, failed + 1)
  process.exitCode = 1
})
