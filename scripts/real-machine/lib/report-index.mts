// #1711 报告索引库（纯聚合）：把全局 index.jsonl 与 conditions.jsonl 汇总成
// 「8 条支持度断言分组 + 候选通过率 + P0/P1/P2 缺陷票 + 条件账本」的结构。
//
// 数据形状以 research/1677-execution-orchestration.md 第 9.4 节为准；
// 场景到支持度断言的映射以 research/1675-coverage-matrix.md 第 2.1、4、10.1 节为准。
// 这里只做读文件与聚合，不写文件、不打日志；命令层负责解析路径与写 Markdown，
// 门禁层只通过进程接口调用命令，所以这个库可以放心被命令与后续票复用。
import * as fs from 'node:fs'

export const VERDICTS = ['通过', '产品缺陷', '使用限制', '环境限制', '未测', '测试或工具问题'] as const
export type Verdict = (typeof VERDICTS)[number]

export const DEFECT_LEVELS = ['P0', 'P1', 'P2'] as const
export type DefectLevel = (typeof DEFECT_LEVELS)[number]

export type LevelSource = '缺陷清单' | '场景最高 P 级上限'

export interface IndexRow {
  line: number
  batch: string
  scenario: string
  attempt: number
  candidate: string
  verdict: Verdict
  claim: string
  evidencePaths: string[]
  independentSide: string
  defect: string | null
  retest: string | null
  start: string
  end: string
}

export interface ConditionRow {
  line: number
  condition: string
  scope: string
  scenario: string
  evidence: string
  alternative: string
  expiry: string
  owner: string
}

export interface DefectOverride {
  ticket: string
  level: DefectLevel
}

export interface VerdictCounts {
  '通过': number
  '产品缺陷': number
  '使用限制': number
  '环境限制': number
  '未测': number
  '测试或工具问题': number
}

export interface AssertionSummary {
  id: string
  title: string
  judgmentPoints: string[]
  attempts: number
  scenarioCount: number
  scenarios: string[]
  verdictCounts: VerdictCounts
}

export interface UnmappedScenario {
  scenario: string
  attempts: number
}

export interface CandidateSummary {
  candidate: string
  attempts: number
  validAttempts: number
  passed: number
  untested: number
  passRate: number
  passRateAll: number
  verdictCounts: VerdictCounts
}

export interface DefectRowRef {
  batch: string
  scenario: string
  attempt: number
  candidate: string
  verdict: Verdict
  retest: string | null
}

export interface DefectEntry {
  ticket: string
  level: DefectLevel
  levelSource: LevelSource
  scenarios: string[]
  attempts: number
  retest: string[]
  rows: DefectRowRef[]
}

export interface ConditionSummary {
  count: number
  byExpiry: Record<string, number>
  items: ConditionRow[]
}

export interface ReportTotals {
  rows: number
  scenarios: number
  batches: number
  candidates: number
  unmappedScenarios: number
  conditions: number
}

export interface ReportSummary {
  totals: ReportTotals
  assertions: AssertionSummary[]
  unmappedScenarios: UnmappedScenario[]
  candidates: CandidateSummary[]
  defects: Record<DefectLevel, DefectEntry[]>
  // P2 产品缺陷按规格不开缺陷票，单独列出来：它们不进上面的缺陷票表，但报告已知限制要能逐行核对。
  unticketedProductDefects: DefectRowRef[]
  conditions: ConditionSummary
}

export interface AggregateOptions {
  indexRows: IndexRow[]
  conditionRows?: ConditionRow[]
  defectOverrides?: DefectOverride[]
}

// 8 条支持度断言：标题与判断点照 #1675 第 10.1 节抄录，顺序固定，报告里按这个顺序排。
const ASSERTION_DEFS: Array<{ id: string; title: string; judgmentPoints: string[] }> = [
  { id: 'A1', title: '能把 GitLab 后端绑定到工作区，并且环境自检可修复', judgmentPoints: ['V1', 'V2'] },
  { id: 'A2', title: '读到的内容可信：与网页一致，读不全时如实说', judgmentPoints: ['V3'] },
  { id: 'A3', title: '写操作真的落地：网页可见、不假成功、不伤邻字段', judgmentPoints: ['V4'] },
  { id: 'A4', title: '关系真的成立：父子、阻塞、认领、降级写法在网页与正文一致', judgmentPoints: ['V5', 'V6'] },
  { id: 'A5', title: '桌面外壳可达：面板、页签、状态栏、技能、设置、日志在三形态下能进能退', judgmentPoints: ['V7', 'V8', 'V9'] },
  { id: 'A6', title: '错误说得清、救得回：403/404/未登录/未装/超限的话术与原因一致，有出路', judgmentPoints: ['V6', 'V11'] },
  { id: 'A7', title: '边界安全：迁移清空置灰、建仓不污染、并发不静默覆盖', judgmentPoints: ['V10'] },
  { id: 'A8', title: '未测项如实记录，结论带作用域', judgmentPoints: ['V12'] },
]

// 判断点落哪几条断言。V6 的归属按 #1675 第 10.1 节表注拆开：
// 错误话术落 A6，关系部分落 A4；具体到场景再用下面的 V6_ASSERTIONS_BY_SCENARIO 细分。
const POINT_ASSERTIONS: Record<string, string[]> = {
  V1: ['A1'],
  V2: ['A1'],
  V3: ['A2'],
  V4: ['A3'],
  V5: ['A4'],
  V6: ['A4', 'A6'],
  V7: ['A5'],
  V8: ['A5'],
  V9: ['A5'],
  V10: ['A7'],
  V11: ['A6'],
  V12: ['A8'],
}

// V6 的场景级裁定（#1675 第 10.1 节表注与第 10.9 节）：哪些场景的 V6 只支撑 A6、只支撑 A4 或两者都支撑。
// 不在表里的 V6 场景按 POINT_ASSERTIONS 的默认值（A4、A6）处理。
const V6_ASSERTIONS_BY_SCENARIO: Record<string, string[]> = {
  'J2-02': ['A6'],
  'J5-04': ['A6'],
  'J6-04': ['A4'],
  'J7-02': ['A4', 'A6'],
  'J11-03': ['A6'],
}

// 40 个真机场景的判断点，照 #1675 第 4 节场景总览表抄录。
const SCENARIO_POINTS: Record<string, string[]> = {
  'J1-01': ['V1'],
  'J1-02': ['V1', 'V7', 'V10'],
  'J1-03': ['V8'],
  'J2-01': ['V2'],
  'J2-02': ['V2', 'V6'],
  'J2-03': ['V2'],
  'J2-04': ['V2', 'V10'],
  'J3-01': ['V8', 'V9'],
  'J3-02': ['V8'],
  'J3-03': ['V4', 'V8'],
  'J3-04': ['V8'],
  'J4-01': ['V3', 'V11'],
  'J4-02': ['V8'],
  'J4-03': ['V5', 'V9'],
  'J4-04': ['V8'],
  'J5-01': ['V3'],
  'J5-02': ['V3', 'V11'],
  'J5-03': ['V3', 'V5', 'V9'],
  'J5-04': ['V6', 'V11'],
  'J5-05': ['V3'],
  'J6-01': ['V3', 'V5'],
  'J6-02': ['V3', 'V8'],
  'J6-03': ['V4'],
  'J6-04': ['V5', 'V6'],
  'J6-05': ['V4', 'V10'],
  'J6-06': ['V4', 'V7'],
  'J7-01': ['V5'],
  'J7-02': ['V5', 'V6', 'V10'],
  'J7-03': ['V5'],
  'J8-01': ['V8', 'V9'],
  'J8-02': ['V8'],
  'J9-01': ['V8', 'V9'],
  'J9-02': ['V7'],
  'J9-03': ['V8'],
  'J9-04': ['V4', 'V7', 'V9'],
  'J10-01': ['V7', 'V9'],
  'J10-02': ['V10'],
  'J11-01': ['V1'],
  'J11-02': ['V3', 'V11'],
  'J11-03': ['V6', 'V9'],
}

// 每个场景的「最高 P 级上限」，照 #1675 第 4 节总览表括号里的优先级抄录。
// 缺陷票本身没有等级字段，报告按这条上限推定，--defects 可以逐票覆盖。
const SCENARIO_LEVEL: Record<string, DefectLevel> = {
  'J1-01': 'P0',
  'J1-02': 'P0',
  'J1-03': 'P1',
  'J2-01': 'P1',
  'J2-02': 'P1',
  'J2-03': 'P1',
  'J2-04': 'P0',
  'J3-01': 'P1',
  'J3-02': 'P1',
  'J3-03': 'P1',
  'J3-04': 'P1',
  'J4-01': 'P1',
  'J4-02': 'P2',
  'J4-03': 'P1',
  'J4-04': 'P2',
  'J5-01': 'P1',
  'J5-02': 'P1',
  'J5-03': 'P1',
  'J5-04': 'P1',
  'J5-05': 'P1',
  'J6-01': 'P1',
  'J6-02': 'P1',
  'J6-03': 'P0',
  'J6-04': 'P1',
  'J6-05': 'P0',
  'J6-06': 'P0',
  'J7-01': 'P0',
  'J7-02': 'P0',
  'J7-03': 'P1',
  'J8-01': 'P2',
  'J8-02': 'P2',
  'J9-01': 'P2',
  'J9-02': 'P1',
  'J9-03': 'P2',
  'J9-04': 'P1',
  'J10-01': 'P1',
  'J10-02': 'P0',
  'J11-01': 'P1',
  'J11-02': 'P1',
  'J11-03': 'P1',
}

const LEVEL_RANK: Record<DefectLevel, number> = { P0: 0, P1: 1, P2: 2 }
const SCENARIO_SHAPE = /^J\d{1,2}-\d{2}$/
const CANDIDATE_SHAPE = /^[0-9a-f]{40}$/
const TICKET_SHAPE = /^#\d+$/
const REQUIRED_INDEX_FIELDS = ['batch', 'scenario', 'attempt', 'candidate', 'verdict', 'claim', 'evidencePaths', 'independentSide', 'defect', 'retest', 'start', 'end']
const REQUIRED_CONDITION_FIELDS = ['condition', 'scope', 'scenario', 'evidence', 'alternative', 'expiry', 'owner']

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error('读不到文件「' + file + '」：' + (error instanceof Error ? error.message : String(error)))
  }
}

function scenarioOrder(left: string, right: string): number {
  const leftMatch = /^J(\d+)-(\d+)$/.exec(left)
  const rightMatch = /^J(\d+)-(\d+)$/.exec(right)
  if (leftMatch && rightMatch) {
    const dayDiff = Number(leftMatch[1]) - Number(rightMatch[1])
    if (dayDiff !== 0) return dayDiff
    return Number(leftMatch[2]) - Number(rightMatch[2])
  }
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyVerdictCounts(): VerdictCounts {
  return { '通过': 0, '产品缺陷': 0, '使用限制': 0, '环境限制': 0, '未测': 0, '测试或工具问题': 0 }
}

function addVerdictCount(counts: VerdictCounts, verdict: Verdict): void {
  counts[verdict] = counts[verdict] + 1
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function assertionsForScenario(scenario: string): string[] {
  const points = SCENARIO_POINTS[scenario]
  if (!points) return []
  const wanted = new Set<string>()
  for (const point of points) {
    const ids = point === 'V6' ? (V6_ASSERTIONS_BY_SCENARIO[scenario] || POINT_ASSERTIONS.V6) : POINT_ASSERTIONS[point]
    for (const id of ids || []) wanted.add(id)
  }
  return ASSERTION_DEFS.map((def) => def.id).filter((id) => wanted.has(id))
}

function scenarioLevelOf(scenario: string, line: number, ticket: string): DefectLevel {
  const level = SCENARIO_LEVEL[scenario]
  if (!level) {
    throw new Error('第 ' + line + ' 行：缺陷票 ' + ticket + ' 所在场景「' + scenario + '」不在 40 个真机场景里，没有 P 级上限可推定，请在 --defects 里显式给出等级')
  }
  return level
}

function parseIndexRow(record: Record<string, unknown>, line: number, errors: string[]): IndexRow | null {
  const before = errors.length
  for (const key of REQUIRED_INDEX_FIELDS) {
    if (!(key in record)) errors.push('第 ' + line + ' 行：缺字段「' + key + '」')
  }
  if (errors.length > before) return null

  const textFields = ['batch', 'scenario', 'claim', 'independentSide', 'start', 'end']
  for (const key of textFields) {
    if (!isNonEmptyString(record[key])) errors.push('第 ' + line + ' 行：字段「' + key + '」必须是非空字符串')
  }
  if (!isNonEmptyString(record.candidate)) {
    errors.push('第 ' + line + ' 行：字段「candidate」必须是非空字符串')
  } else if (!CANDIDATE_SHAPE.test(record.candidate)) {
    errors.push('第 ' + line + ' 行：candidate「' + record.candidate + '」不是完整的 40 位提交哈希（要写全小写十六进制，不要写 main 或 latest）')
  }
  if (!isNonEmptyString(record.verdict)) {
    errors.push('第 ' + line + ' 行：字段「verdict」必须是非空字符串')
  } else if (!(VERDICTS as readonly string[]).includes(record.verdict)) {
    errors.push('第 ' + line + ' 行：verdict「' + record.verdict + '」不是六类之一（通过/产品缺陷/使用限制/环境限制/未测/测试或工具问题）')
  }
  if (!Number.isInteger(record.attempt) || (record.attempt as number) < 1) {
    errors.push('第 ' + line + ' 行：字段「attempt」必须是正整数')
  }
  if (!Array.isArray(record.evidencePaths) || record.evidencePaths.length === 0 || record.evidencePaths.some((item) => !isNonEmptyString(item))) {
    errors.push('第 ' + line + ' 行：字段「evidencePaths」必须是非空字符串数组')
  }
  if (record.defect !== null && !(typeof record.defect === 'string' && TICKET_SHAPE.test(record.defect))) {
    errors.push('第 ' + line + ' 行：字段「defect」必须是 null 或 #<数字> 形式的缺陷票号')
  }
  if (record.retest !== null && !isNonEmptyString(record.retest)) {
    errors.push('第 ' + line + ' 行：字段「retest」必须是 null 或非空字符串')
  }
  if (isNonEmptyString(record.scenario) && !SCENARIO_SHAPE.test(record.scenario)) {
    errors.push('第 ' + line + ' 行：场景号「' + record.scenario + '」不是 J<批次数字>-<两位场景号> 的形状（例如 J1-01）')
  }
  if (errors.length > before) return null

  const verdict = record.verdict as Verdict
  const defect = (record.defect as string | null) === null ? null : String(record.defect)
  // 产品缺陷行允许 defect 为 null：规格规定 P2 只进已知限制、不开缺陷票，P0/P1 才必须带票号。
  // 反过来非产品缺陷行不许带票，避免把缺陷票挂到通过行上。
  if (verdict !== '产品缺陷' && defect !== null) {
    errors.push('第 ' + line + ' 行：verdict「' + verdict + '」不是产品缺陷，却带了缺陷票 ' + defect)
  }
  if (errors.length > before) return null

  return {
    line: line,
    batch: record.batch as string,
    scenario: record.scenario as string,
    attempt: record.attempt as number,
    candidate: record.candidate as string,
    verdict: verdict,
    claim: record.claim as string,
    evidencePaths: (record.evidencePaths as unknown[]).map((item) => String(item)),
    independentSide: record.independentSide as string,
    defect: defect,
    retest: (record.retest as string | null) === null ? null : String(record.retest),
    start: record.start as string,
    end: record.end as string,
  }
}

// 读全局 index.jsonl。校验错误收集成一条消息（带行号，用「；」连接）后一起抛出，
// 这样一轮就能把样例里所有坏行改完，而不是修一处跑一次。
export function readIndexRows(file: string): IndexRow[] {
  const text = readTextFile(file)
  const lines = text.split(/\r?\n/)
  const rows: IndexRow[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1
    const rawLine = lines[index]
    if (rawLine.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(rawLine)
    } catch (error) {
      errors.push('第 ' + line + ' 行：不是合法 JSON（' + (error instanceof Error ? error.message : String(error)) + '）')
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('第 ' + line + ' 行：不是 JSON 对象')
      continue
    }
    const row = parseIndexRow(parsed as Record<string, unknown>, line, errors)
    if (!row) continue
    const key = row.batch + '\u0000' + row.scenario + '\u0000' + row.attempt
    const firstLine = seen.get(key)
    if (firstLine !== undefined) {
      errors.push('第 ' + line + ' 行与第 ' + firstLine + ' 行重复：批次 ' + row.batch + '、场景 ' + row.scenario + '、尝试 ' + row.attempt)
      continue
    }
    seen.set(key, line)
    rows.push(row)
  }
  if (errors.length > 0) throw new Error('index.jsonl 有 ' + errors.length + ' 处问题：' + errors.join('；'))
  return rows
}

function parseConditionRow(record: Record<string, unknown>, line: number, errors: string[]): ConditionRow | null {
  const before = errors.length
  for (const key of REQUIRED_CONDITION_FIELDS) {
    if (!(key in record)) errors.push('第 ' + line + ' 行：缺字段「' + key + '」')
  }
  if (errors.length > before) return null
  for (const key of REQUIRED_CONDITION_FIELDS) {
    if (!isNonEmptyString(record[key])) errors.push('第 ' + line + ' 行：字段「' + key + '」必须是非空字符串')
  }
  if (isNonEmptyString(record.scenario) && !SCENARIO_SHAPE.test(record.scenario)) {
    errors.push('第 ' + line + ' 行：场景号「' + record.scenario + '」不是 J<批次数字>-<两位场景号> 的形状（例如 J7-02）')
  }
  if (errors.length > before) return null
  return {
    line: line,
    condition: record.condition as string,
    scope: record.scope as string,
    scenario: record.scenario as string,
    evidence: record.evidence as string,
    alternative: record.alternative as string,
    expiry: record.expiry as string,
    owner: record.owner as string,
  }
}

export function readConditionRows(file: string): ConditionRow[] {
  const text = readTextFile(file)
  const lines = text.split(/\r?\n/)
  const rows: ConditionRow[] = []
  const errors: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1
    const rawLine = lines[index]
    if (rawLine.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(rawLine)
    } catch (error) {
      errors.push('第 ' + line + ' 行：不是合法 JSON（' + (error instanceof Error ? error.message : String(error)) + '）')
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('第 ' + line + ' 行：不是 JSON 对象')
      continue
    }
    const row = parseConditionRow(parsed as Record<string, unknown>, line, errors)
    if (row) rows.push(row)
  }
  if (errors.length > 0) throw new Error('conditions.jsonl 有 ' + errors.length + ' 处问题：' + errors.join('；'))
  return rows
}

// 缺陷等级覆盖清单：JSON 数组，每项 {"ticket":"#2001","level":"P1"}。
// 报告定级前以缺陷票的正式等级为准，这张清单让报告不必猜；不传时按场景最高 P 级上限推定。
export function readDefectOverrides(file: string): DefectOverride[] {
  const text = readTextFile(file)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('defects.json 不是合法 JSON（' + (error instanceof Error ? error.message : String(error)) + '）')
  }
  if (!Array.isArray(parsed)) throw new Error('defects.json 必须是 JSON 数组：每项形如 {"ticket":"#2001","level":"P1"}')
  const errors: string[] = []
  const overrides: DefectOverride[] = []
  const seen = new Set<string>()
  for (let index = 0; index < parsed.length; index++) {
    const label = '第 ' + (index + 1) + ' 条'
    const item = parsed[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(label + '：不是 JSON 对象')
      continue
    }
    const record = item as Record<string, unknown>
    if (!isNonEmptyString(record.ticket) || !TICKET_SHAPE.test(record.ticket)) {
      errors.push(label + '：ticket「' + String(record.ticket) + '」必须是 #<数字> 形式的缺陷票号')
      continue
    }
    const level = record.level
    if (level !== 'P0' && level !== 'P1' && level !== 'P2') {
      errors.push(label + '：等级「' + String(level) + '」不是 P0/P1/P2 之一')
      continue
    }
    if (seen.has(record.ticket)) {
      errors.push(label + '：缺陷票 ' + record.ticket + ' 重复出现')
      continue
    }
    seen.add(record.ticket)
    overrides.push({ ticket: record.ticket, level: level })
  }
  if (errors.length > 0) throw new Error('defects.json 有 ' + errors.length + ' 处问题：' + errors.join('；'))
  return overrides
}

// 汇总。口径（与 tests/fixtures/report-index/expected-summary.json 一一对应）：
// - 断言分组的尝试次数按「场景映射到的断言」重复计数，所以各断言次数相加会大于总行数；
// - A8 单独按 verdict=未测 的行计数，这些行仍按所属场景计入 A1-A7；
// - 候选有效通过率的分母扣掉「环境限制」与「测试或工具问题」；
// - 缺陷等级优先用覆盖清单，否则取该票所有行所在场景里最高的 P 级（P0 最严重）；
// - 未知场景（不在 #1675 的 40 条里）不报错，只进未映射清单，不归任何断言。
export function aggregateReport(options: AggregateOptions): ReportSummary {
  const indexRows = options.indexRows
  const conditionRows = options.conditionRows || []
  const overrideLevel = new Map<string, DefectLevel>()
  for (const override of options.defectOverrides || []) overrideLevel.set(override.ticket, override.level)

  const scenarioSet = new Set<string>()
  const batchSet = new Set<string>()
  const rowsByScenario = new Map<string, IndexRow[]>()
  const rowsByCandidate = new Map<string, IndexRow[]>()
  for (const row of indexRows) {
    scenarioSet.add(row.scenario)
    batchSet.add(row.batch)
    if (!rowsByScenario.has(row.scenario)) rowsByScenario.set(row.scenario, [])
    ;(rowsByScenario.get(row.scenario) as IndexRow[]).push(row)
    if (!rowsByCandidate.has(row.candidate)) rowsByCandidate.set(row.candidate, [])
    ;(rowsByCandidate.get(row.candidate) as IndexRow[]).push(row)
  }

  const unmappedScenarios: UnmappedScenario[] = []
  const mappedScenarios = new Map<string, string[]>()
  for (const scenario of scenarioSet) {
    const assertionIds = assertionsForScenario(scenario)
    if (assertionIds.length === 0) {
      unmappedScenarios.push({ scenario: scenario, attempts: (rowsByScenario.get(scenario) as IndexRow[]).length })
    } else {
      mappedScenarios.set(scenario, assertionIds)
    }
  }
  unmappedScenarios.sort((left, right) => scenarioOrder(left.scenario, right.scenario))

  const assertions: AssertionSummary[] = ASSERTION_DEFS.map((def) => {
    let rows: IndexRow[]
    let scenarios: string[]
    if (def.id === 'A8') {
      rows = indexRows.filter((row) => row.verdict === '未测')
      scenarios = Array.from(new Set(rows.map((row) => row.scenario))).sort(scenarioOrder)
    } else {
      rows = []
      for (const [scenario, assertionIds] of mappedScenarios) {
        if (assertionIds.includes(def.id)) rows.push(...(rowsByScenario.get(scenario) as IndexRow[]))
      }
      scenarios = Array.from(new Set(rows.map((row) => row.scenario))).sort(scenarioOrder)
    }
    const verdictCounts = emptyVerdictCounts()
    for (const row of rows) addVerdictCount(verdictCounts, row.verdict)
    return {
      id: def.id,
      title: def.title,
      judgmentPoints: def.judgmentPoints.slice(),
      attempts: rows.length,
      scenarioCount: scenarios.length,
      scenarios: scenarios,
      verdictCounts: verdictCounts,
    }
  })

  const candidates: CandidateSummary[] = Array.from(rowsByCandidate.keys()).sort().map((candidate) => {
    const rows = rowsByCandidate.get(candidate) as IndexRow[]
    const verdictCounts = emptyVerdictCounts()
    for (const row of rows) addVerdictCount(verdictCounts, row.verdict)
    const attempts = rows.length
    const validAttempts = attempts - verdictCounts['环境限制'] - verdictCounts['测试或工具问题']
    const passed = verdictCounts['通过']
    return {
      candidate: candidate,
      attempts: attempts,
      validAttempts: validAttempts,
      passed: passed,
      untested: verdictCounts['未测'],
      passRate: validAttempts === 0 ? 0 : round4(passed / validAttempts),
      passRateAll: attempts === 0 ? 0 : round4(passed / attempts),
      verdictCounts: verdictCounts,
    }
  })

  const defectRowsByTicket = new Map<string, IndexRow[]>()
  for (const row of indexRows) {
    if (row.defect === null) continue
    if (!defectRowsByTicket.has(row.defect)) defectRowsByTicket.set(row.defect, [])
    ;(defectRowsByTicket.get(row.defect) as IndexRow[]).push(row)
  }
  const defects: Record<DefectLevel, DefectEntry[]> = { P0: [], P1: [], P2: [] }
  const ticketNumbers = new Map<string, number>()
  for (const [ticket, rows] of defectRowsByTicket) {
    let level = overrideLevel.get(ticket)
    let levelSource: LevelSource = '缺陷清单'
    if (!level) {
      levelSource = '场景最高 P 级上限'
      let rank = LEVEL_RANK.P2
      for (const row of rows) {
        const rowLevel = scenarioLevelOf(row.scenario, row.line, ticket)
        rank = Math.min(rank, LEVEL_RANK[rowLevel])
      }
      level = rank === 0 ? 'P0' : rank === 1 ? 'P1' : 'P2'
    }
    const scenarios = Array.from(new Set(rows.map((row) => row.scenario))).sort(scenarioOrder)
    const retest = Array.from(new Set(rows.map((row) => row.retest).filter((item): item is string => item !== null))).sort()
    const sortedRows = rows.slice().sort((left, right) => {
      if (left.batch !== right.batch) return left.batch < right.batch ? -1 : 1
      const order = scenarioOrder(left.scenario, right.scenario)
      if (order !== 0) return order
      return left.attempt - right.attempt
    })
    defects[level].push({
      ticket: ticket,
      level: level,
      levelSource: levelSource,
      scenarios: scenarios,
      attempts: rows.length,
      retest: retest,
      rows: sortedRows.map((row) => ({
        batch: row.batch,
        scenario: row.scenario,
        attempt: row.attempt,
        candidate: row.candidate,
        verdict: row.verdict,
        retest: row.retest,
      })),
    })
    ticketNumbers.set(ticket, Number(ticket.slice(1)))
  }
  for (const level of DEFECT_LEVELS) {
    defects[level].sort((left, right) => (ticketNumbers.get(left.ticket) as number) - (ticketNumbers.get(right.ticket) as number))
  }

  // 判定为产品缺陷但没有票号的行，按规格是 P2、只进已知限制；单列出来让报告能逐行引用，
  // 不混进缺陷票表（那里每行都必须对应一张真实票）。
  const unticketedProductDefects: DefectRowRef[] = indexRows
    .filter((row) => row.verdict === '产品缺陷' && row.defect === null)
    .sort((left, right) => {
      if (left.batch !== right.batch) return left.batch < right.batch ? -1 : 1
      const order = scenarioOrder(left.scenario, right.scenario)
      if (order !== 0) return order
      return left.attempt - right.attempt
    })
    .map((row) => ({
      batch: row.batch,
      scenario: row.scenario,
      attempt: row.attempt,
      candidate: row.candidate,
      verdict: row.verdict,
      retest: row.retest,
    }))

  const expiryCounts = new Map<string, number>()
  for (const condition of conditionRows) expiryCounts.set(condition.expiry, (expiryCounts.get(condition.expiry) || 0) + 1)
  const byExpiry: Record<string, number> = {}
  for (const key of Array.from(expiryCounts.keys()).sort()) byExpiry[key] = expiryCounts.get(key) as number

  return {
    totals: {
      rows: indexRows.length,
      scenarios: scenarioSet.size,
      batches: batchSet.size,
      candidates: rowsByCandidate.size,
      unmappedScenarios: unmappedScenarios.length,
      conditions: conditionRows.length,
    },
    assertions: assertions,
    unmappedScenarios: unmappedScenarios,
    candidates: candidates,
    defects: defects,
    unticketedProductDefects: unticketedProductDefects,
    conditions: {
      count: conditionRows.length,
      byExpiry: byExpiry,
      items: conditionRows.map((condition) => ({
        condition: condition.condition,
        scope: condition.scope,
        scenario: condition.scenario,
        evidence: condition.evidence,
        alternative: condition.alternative,
        expiry: condition.expiry,
        owner: condition.owner,
      })),
    },
  }
}

function percent(value: number): string {
  return (value * 100).toFixed(2) + '%'
}

// 把汇总渲染成 Markdown 摘要（#1678 直接贴进报告）。
// 数字全部来自上面的聚合结果，这里不做二次计算，避免摘要与 JSON 口径打架。
export function renderMarkdown(summary: ReportSummary): string {
  const lines: string[] = []
  lines.push('# 真机验证报告索引摘要')
  lines.push('')
  lines.push('这份摘要由 report-index 命令从全局 index.jsonl 与 conditions.jsonl 汇总生成，数字可直接回到原始 JSONL 手工核对。')
  lines.push('')
  lines.push('口径说明：一个场景可能支撑多条支持度断言（按 #1675 判断点表映射），所以各断言的尝试次数相加会大于总行数；同一场景的多次尝试按次数分别计入。')
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('- 尝试行数：' + summary.totals.rows)
  lines.push('- 场景数：' + summary.totals.scenarios)
  lines.push('- 批次数：' + summary.totals.batches)
  lines.push('- 候选数：' + summary.totals.candidates)
  lines.push('- 未映射场景数：' + summary.totals.unmappedScenarios)
  lines.push('- 条件账本条目数：' + summary.totals.conditions)

  if (summary.unmappedScenarios.length > 0) {
    lines.push('')
    lines.push('## 未映射场景')
    lines.push('')
    lines.push('这些场景不在 #1675 的 40 个真机场景里，不能归入 8 条支持度断言，只计入总览与候选通过率。')
    lines.push('')
    lines.push('| 场景 | 尝试次数 |')
    lines.push('|---|---|')
    for (const item of summary.unmappedScenarios) lines.push('| ' + item.scenario + ' | ' + item.attempts + ' |')
  }

  lines.push('')
  lines.push('## 按支持度断言分组')
  lines.push('')
  lines.push('| 断言 | 尝试次数 | 涉及场景数 | 通过 | 产品缺陷 | 使用限制 | 环境限制 | 未测 | 测试或工具问题 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const item of summary.assertions) {
    lines.push('| ' + item.id + ' ' + item.title + ' | ' + item.attempts + ' | ' + item.scenarioCount + ' | ' +
      item.verdictCounts['通过'] + ' | ' + item.verdictCounts['产品缺陷'] + ' | ' + item.verdictCounts['使用限制'] + ' | ' +
      item.verdictCounts['环境限制'] + ' | ' + item.verdictCounts['未测'] + ' | ' + item.verdictCounts['测试或工具问题'] + ' |')
  }
  lines.push('')
  lines.push('说明：A8 按未测记录计数，这些行同时按所属场景计入 A1-A7；条件账本 ' + summary.conditions.count + ' 条是「结论带作用域」的组成部分。')
  lines.push('')
  lines.push('## 候选通过率')
  lines.push('')
  lines.push('通过率 = 通过次数 ÷ 有效尝试数；有效尝试数 = 总尝试数 − 环境限制 − 测试或工具问题。')
  lines.push('')
  lines.push('| 候选 | 尝试数 | 有效尝试数 | 通过 | 未测 | 有效通过率 | 全量通过率 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const candidate of summary.candidates) {
    lines.push('| ' + candidate.candidate + ' | ' + candidate.attempts + ' | ' + candidate.validAttempts + ' | ' +
      candidate.passed + ' | ' + candidate.untested + ' | ' + percent(candidate.passRate) + ' | ' + percent(candidate.passRateAll) + ' |')
  }
  lines.push('')
  lines.push('## 缺陷票（按 P0/P1/P2 分组）')
  lines.push('')
  lines.push('等级来源：缺陷清单给定的用给定值，没给的按所在场景的最高 P 级上限推定；同一缺陷只计一次；重验状态取索引里的 retest 字段。')
  for (const level of DEFECT_LEVELS) {
    lines.push('')
    lines.push('### ' + level)
    lines.push('')
    lines.push('| 缺陷票 | 等级来源 | 涉及场景 | 尝试 | 重验状态 |')
    lines.push('|---|---|---|---|---|')
    const entries = summary.defects[level]
    if (entries.length === 0) {
      lines.push('| （无） | — | — | 0 | — |')
    } else {
      for (const entry of entries) {
        lines.push('| ' + entry.ticket + ' | ' + entry.levelSource + ' | ' + entry.scenarios.join('、') + ' | ' +
          entry.attempts + ' | ' + (entry.retest.length === 0 ? '—' : entry.retest.join('、')) + ' |')
      }
    }
  }
  if (summary.unticketedProductDefects.length > 0) {
    lines.push('')
    lines.push('### P2（无缺陷票，按规格只进已知限制）')
    lines.push('')
    lines.push('这些行判定为产品缺陷，但按规格 P2 不开缺陷票，所以不进上面的缺陷票表；报告正文把它们写进已知限制。')
    lines.push('')
    lines.push('| 批次 | 场景 | 尝试 | 候选 | 重验状态 |')
    lines.push('|---|---|---|---|---|')
    for (const row of summary.unticketedProductDefects) {
      lines.push('| ' + row.batch + ' | ' + row.scenario + ' | ' + row.attempt + ' | ' + row.candidate + ' | ' +
        (row.retest === null ? '—' : row.retest) + ' |')
    }
  }
  lines.push('')
  lines.push('## 条件账本')
  lines.push('')
  lines.push('| 条件 | 适用范围 | 场景 | 替代路径 | 到期 | 来源 |')
  lines.push('|---|---|---|---|---|---|')
  for (const condition of summary.conditions.items) {
    lines.push('| ' + condition.condition + ' | ' + condition.scope + ' | ' + condition.scenario + ' | ' +
      condition.alternative + ' | ' + condition.expiry + ' | ' + condition.owner + ' |')
  }
  return lines.join('\n') + '\n'
}
