// tests/verify-1708-seed-data.ts —— #1708「种子数据：幂等准备 101 张票、两张地图与关系」的黑盒门禁。
//
// 这扇门禁不 import 种子命令的内部函数，也不读命令源码文本；它按执行会话的样子起子进程
// （同一个 node 入口、同一份 ts-hook、同一组参数），只读 stdout JSON、stderr、退出码与文件副作用。
// 假 glab 是本票自己的有种状态夹具（tests/fixtures/real-machine/seed/fake-glab-seed.mts），
// 通过 #1705 夹具的 per-run 环境覆盖把 GLAB_BIN / GLAB_FAKE_STATE 注入子进程，完全不联网。
//
// 四段证据：
//   A 首次播种：101 张票（含 5 张已关闭）、2 张地图与 5 张子票、5 个标签、6 个指派、8 条阻塞关系，
//     manifest 记全 id 与关系；其中 4 条阻塞边故意让假 glab 报 403，验证「原生边失败回落正文成对两行」。
//   B 重跑：manifest 里的 id 复用，假 glab 记账里没有任何写调用（没有重复创建）。
//   C 部分失败：假 glab 对某张票永久报错、对另一张只失败前两次；第一趟退出码 1 且 manifest/错误可读，
//     第二趟只补缺的、不重复已建成的；重试 3 次与退避由调用次数证明。
//   D 只读标记：池子标记 read-only 后，从假 glab 状态里删掉一张票，重跑必须拒绝写并指回 --unlock-readonly；
//     加 --unlock-readonly 才补种，补完恢复 read-only。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1708-seed-data.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1708-seed-data.ts --negative
// --negative 真的起子进程跑一遍能成功的播种与重跑，再故意把三条期望写错，证明断言能红
// （不是删断言换来的红）。正例收尾还会起一份 --negative 子门禁自检。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, createRealMachineHarness } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'
import type { CommandRun, RealMachineHarness } from './lib/real-machine-process.ts'

const GATE = 'verify-1708-seed-data'
const SELF_REL = 'tests/verify-1708-seed-data.ts'
const FAKE_SEED_REL = 'tests/fixtures/real-machine/seed/fake-glab-seed.mts'
const FAKE_SEED = path.join(REPO_ROOT, FAKE_SEED_REL)
const NEGATIVE = process.argv.includes('--negative')

let passed = 0
let failed = 0

/** 一条断言：通过的只留一行；失败的把可定位的现场整段缩进打出来。 */
function check(ok: boolean, message: string, detail?: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message)
  if (!detail) return
  const lines = String(detail).split(/\r?\n/)
  const shown = lines.slice(0, 100)
  for (const line of shown) console.log('       | ' + line)
  if (lines.length > shown.length) console.log('       | …（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function recordsOf(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  const result: JsonRecord[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (record) result.push(record)
  }
  return result
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 一条假 glab 调用记录（与 #1705 的 GlabCall 形状一致）。 */
interface CallRecord {
  argv: string[]
  cwd: string
  matchedRule?: number | 'default'
  exitCode?: number
}

interface SeedCase {
  name: string
  projectPath: string
  batchDir: string
  statePath: string
}

function seedCase(harness: RealMachineHarness, name: string, projectPath: string): SeedCase {
  return {
    name,
    projectPath,
    batchDir: path.join(harness.workRoot, 'batches', name),
    statePath: path.join(harness.workRoot, 'fake-state-' + name + '.json'),
  }
}

function manifestPathOf(item: SeedCase): string {
  return path.join(item.batchDir, 'gitlab-seed.json')
}

/** 写失败注入计划；这次不给规则就写空计划（假 glab 会走正常动态行为）。 */
function writePlan(harness: RealMachineHarness, rules: unknown[]): void {
  fs.writeFileSync(harness.glabPlanFile, JSON.stringify({ rules }, null, 2) + '\n', 'utf8')
}

function seedArgs(item: SeedCase, extras: string[]): string[] {
  return ['--batch', item.batchDir, '--project', item.projectPath].concat(extras)
}

interface SeedRun {
  run: CommandRun
  calls: CallRecord[]
}

/** 起一次 seed-gitlab 子进程，返回这一趟的命令结果与这一趟新增的假 glab 调用。 */
function runSeed(harness: RealMachineHarness, item: SeedCase, extras: string[], rules: unknown[]): SeedRun {
  writePlan(harness, rules)
  const before = harness.readGlabCalls().length
  const run = harness.runCommand('seed-gitlab', {
    args: seedArgs(item, extras),
    env: {
      GLAB_BIN: FAKE_SEED,
      GLAB_FAKE_STATE: item.statePath,
      GLAB_FAKE_PROJECT_PATH: item.projectPath,
    },
    timeoutMs: 240000,
  })
  const calls = harness.readGlabCalls().slice(before) as CallRecord[]
  return { run, calls }
}

function methodOf(call: CallRecord): string {
  const index = call.argv.indexOf('--method')
  if (index < 0 || call.argv[index + 1] === undefined) return 'GET'
  return String(call.argv[index + 1]).toUpperCase()
}

function apiPathOf(call: CallRecord): string {
  return String(call.argv[1] || '')
}

function isWriteCall(call: CallRecord): boolean {
  const method = methodOf(call)
  return method === 'POST' || method === 'PUT' || method === 'DELETE'
}

function countCalls(calls: CallRecord[], predicate: (call: CallRecord) => boolean): number {
  let count = 0
  for (const call of calls) if (predicate(call)) count += 1
  return count
}

function describeCalls(calls: CallRecord[]): string {
  return calls.map((call) => methodOf(call) + ' ' + apiPathOf(call)).join('\n')
}

/** 按 manifest 里的 path 形状读整份 JSON；读不到返回 null。 */
function readJsonFile(file: string): JsonRecord | null {
  if (!fs.existsSync(file)) return null
  try {
    return asRecord(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function readManifest(harness: RealMachineHarness, item: SeedCase): JsonRecord | null {
  return readJsonFile(manifestPathOf(item))
}

function readFakeState(item: SeedCase): JsonRecord | null {
  return readJsonFile(item.statePath)
}

function writeFakeState(item: SeedCase, state: JsonRecord): void {
  fs.writeFileSync(item.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function fakeIssues(state: JsonRecord | null): JsonRecord[] {
  return state ? recordsOf(state.issues) : []
}

function manifestIssues(manifest: JsonRecord | null): JsonRecord[] {
  return manifest ? recordsOf(manifest.issues) : []
}

function issueByKey(manifest: JsonRecord | null, key: string): JsonRecord | null {
  for (const issue of manifestIssues(manifest)) if (textOf(issue.key) === key) return issue
  return null
}

function issueByTitle(state: JsonRecord | null, title: string): JsonRecord | null {
  for (const issue of fakeIssues(state)) if (textOf(issue.title) === title) return issue
  return null
}

/** 从正文文件头里取出 <!-- NAME: 123 --> 的数字；没有返回 null。 */
function hiddenNumber(value: unknown, name: string): number | null {
  const body = textOf(value)
  const marker = '<!-- ' + name + ': '
  const at = body.indexOf(marker)
  if (at < 0) return null
  let digits = ''
  for (const char of body.slice(at + marker.length)) {
    if (char >= '0' && char <= '9') digits += char
    else break
  }
  return digits === '' ? null : Number(digits)
}

/** 从 <!-- DSH-BLOCKED-BY: 12, 13 --> 里取出数字列表。 */
function hiddenNumberList(value: unknown, name: string): number[] {
  const body = textOf(value)
  const marker = '<!-- ' + name + ': '
  const start = body.indexOf(marker)
  if (start < 0) return []
  const end = body.indexOf('-->', start)
  if (end < 0) return []
  const inside = body.slice(start + marker.length, end).trim()
  if (!inside) return []
  const numbers: number[] = []
  for (const part of inside.split(',')) {
    const trimmed = part.trim().replace(/^#/, '')
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) numbers.push(parsed)
  }
  return numbers
}

/** 把 manifest 的「seed key → iid」拍平，用来比较重跑前后 id 有没有被换成新建的。 */
function keyToIid(manifest: JsonRecord | null): string {
  const pairs: string[] = []
  for (const issue of manifestIssues(manifest)) pairs.push(textOf(issue.key) + '=' + String(numberOr(issue.iid)))
  pairs.sort()
  return pairs.join(';')
}

// ── 正例 ────────────────────────────────────────────────────────────────────

function runPositive(harness: RealMachineHarness): void {
  check(fs.existsSync(FAKE_SEED), '0 假 glab（种子）夹具存在：' + FAKE_SEED_REL)

  // ── A. 首次播种 101 张票 ────────────────────────────────────────────────
  const b2 = seedCase(harness, 'b2', 'seed-group/b2-pool')
  const firstRules = [
    {
      // 模拟免费档不收原生阻塞边：前 4 次写边报 403，后面几次放行，逼出「原生边 + 正文成对两行」两条路。
      argvIncludes: ['link_type=is_blocked_by'],
      exitCode: 1,
      stderr: '假 glab：403 Forbidden（免费档不收原生阻塞边）\n',
      failTimes: 4,
    },
  ]
  const first = runSeed(harness, b2, [], firstRules)
  const firstFailure = harness.formatFailure(first.run)
  const firstJson = asRecord(first.run.json)
  check(first.run.exitCode === 0 && first.run.jsonError === '', 'A1 首次播种正常退出（退出码 0、stdout 是单段 JSON）', firstFailure)
  check(firstJson !== null && firstJson.ok === true, 'A2 首次播种回执 ok=true', firstFailure)

  const manifest = readManifest(harness, b2)
  check(manifest !== null, 'A3 批次目录下写了 gitlab-seed.json：' + manifestPathOf(b2), firstFailure)
  check(manifest !== null && manifest.mode === 'read-only', 'A4 种子池建好后 manifest 标记 read-only', JSON.stringify(manifest))
  const spec = manifest !== null ? asRecord(manifest.spec) : null
  check(
    spec !== null &&
      numberOr(spec.ticketCount) === 101 &&
      numberOr(spec.closedCount) === 5 &&
      numberOr(spec.mapCount) === 2 &&
      numberOr(spec.childrenCount) === 5 &&
      numberOr(spec.blockingPairs) === 8,
    'A5 manifest 记着这次播种的规模（101 张票 / 5 张关闭 / 2 张地图 / 5 张子票 / 8 条阻塞）',
    JSON.stringify(spec),
  )
  const issues = manifestIssues(manifest)
  check(issues.length === 101, 'A6 manifest 记着 101 张票', '拿到 ' + issues.length + ' 条')
  const idsComplete = issues.every((issue) => numberOr(issue.iid) !== null && textOf(issue.webUrl) !== '' && textOf(issue.title) !== '')
  check(issues.length === 101 && idsComplete, 'A7 每张票都记着 iid、web_url 与标题', JSON.stringify(issues.slice(0, 3)))
  const iidSet = new Set(issues.map((issue) => numberOr(issue.iid)))
  check(issues.length === 101 && iidSet.size === 101, 'A8 101 张票的 iid 互不相同', '唯一 iid 只有 ' + iidSet.size + ' 个')
  const roleCount = (role: string): number => issues.filter((issue) => textOf(issue.role) === role).length
  check(
    roleCount('map') === 2 && roleCount('child') === 5 && roleCount('issue') === 94,
    'A9 票池由 94 张普通票、2 张地图、5 张子票组成',
    'map=' + roleCount('map') + ' child=' + roleCount('child') + ' issue=' + roleCount('issue'),
  )
  const labels = manifest !== null ? recordsOf(manifest.labels) : []
  const labelNames = labels.map((label) => textOf(label.name))
  check(
    labels.length === 5 && labels.every((label) => numberOr(label.id) !== null) && labelNames.includes('wayfinder:map'),
    'A10 manifest 记着 5 个标签对象（含 wayfinder:map）与它们的 id',
    JSON.stringify(labels),
  )
  const stats = manifest !== null ? asRecord(manifest.stats) : null
  check(
    stats !== null &&
      numberOr(stats.issues) === 101 &&
      numberOr(stats.closedIssues) === 5 &&
      numberOr(stats.maps) === 2 &&
      numberOr(stats.children) === 5 &&
      numberOr(stats.labels) === 5 &&
      numberOr(stats.assignees) === 6 &&
      numberOr(stats.parentEdges) === 5 &&
      numberOr(stats.blockedEdges) === 8,
    'A11 manifest 的统计与播种内容一致（5 张关闭票、6 张指派、5 条父子边、8 条阻塞边）',
    JSON.stringify(stats),
  )

  // 关闭票：manifest 与假 glab 里的状态都要对得上
  const stateAfterFirst = readFakeState(b2)
  const manifestClosed = issues.filter((issue) => textOf(issue.state) === 'closed').length
  const remoteClosed = fakeIssues(stateAfterFirst).filter((issue) => textOf(issue.state) === 'closed').length
  check(
    manifestClosed === 5 && remoteClosed === 5,
    'A12 5 张已关闭的票在 manifest 与远端状态里都是 closed',
    'manifest=' + manifestClosed + ' 远端=' + remoteClosed,
  )

  // 父子关系：子票正文文件头要带正确的 DSH-PARENT 标记，且指向地图的 iid
  const parentRelations = manifest !== null ? recordsOf(asRecord(manifest.relations)?.parent) : []
  let parentMatches = 0
  for (const relation of parentRelations) {
    const child = issueByKey(manifest, textOf(relation.childKey))
    const map = issueByKey(manifest, textOf(relation.mapKey))
    const childIid = child !== null ? numberOr(child.iid) : null
    const mapIid = map !== null ? numberOr(map.iid) : null
    const remoteChild = childIid !== null ? issueByTitle(stateAfterFirst, textOf(child?.title)) : null
    if (remoteChild !== null && mapIid !== null && hiddenNumber(remoteChild.description, 'DSH-PARENT') === mapIid) parentMatches += 1
  }
  check(
    parentRelations.length === 5 && parentMatches === 5,
    'A13 5 条父子关系都写进了子票正文文件头：DSH-PARENT 指向地图 iid',
    JSON.stringify(parentRelations),
  )

  // 阻塞关系：4 条原生边 + 4 条回落成对两行
  const blockingRelations = manifest !== null ? recordsOf(asRecord(manifest.relations)?.blocking) : []
  const nativeRelations = blockingRelations.filter((relation) => textOf(relation.mode) === 'native')
  const descriptionRelations = blockingRelations.filter((relation) => textOf(relation.mode) === 'description')
  check(
    blockingRelations.length === 8 && nativeRelations.length === 4 && descriptionRelations.length === 4,
    'A14 8 条阻塞关系里 4 条写成原生边、4 条按计划回落到正文成对两行',
    JSON.stringify(blockingRelations),
  )
  let fallbackMatches = 0
  for (const relation of descriptionRelations) {
    const source = issueByKey(manifest, textOf(relation.sourceKey))
    const target = issueByKey(manifest, textOf(relation.targetKey))
    const sourceRemote = source !== null ? issueByTitle(stateAfterFirst, textOf(source.title)) : null
    const targetIid = target !== null ? numberOr(target.iid) : null
    const body = sourceRemote !== null ? textOf(sourceRemote.description) : ''
    if (targetIid !== null && body.includes('Blocked by: #' + targetIid) && hiddenNumberList(body, 'DSH-BLOCKED-BY').includes(targetIid)) {
      fallbackMatches += 1
    }
  }
  check(fallbackMatches === 4, 'A15 回落成对两行的人读行（Blocked by: #N）与机器行（DSH-BLOCKED-BY）都写对了', String(fallbackMatches))
  let nativeLandings = 0
  for (const issue of fakeIssues(stateAfterFirst)) {
    for (const link of recordsOf(issue.links)) {
      if (textOf(link.linkType || link.link_type).toLowerCase() === 'is_blocked_by') nativeLandings += 1
    }
  }
  check(nativeLandings === 4, 'A16 4 条原生阻塞边落在假 glab 的 issue links 里', '假 glab 里 is_blocked_by 边有 ' + nativeLandings + ' 条')

  // 指派
  const assigned = fakeIssues(stateAfterFirst).filter((issue) => recordsOf(issue.assignees).length > 0).length
  check(assigned === 6, 'A17 6 张票在远端带着指派用户', '指派了 ' + assigned + ' 张')

  // 调用集合：只建一次、标签显式创建、关票用 PUT
  const firstCreate = countCalls(first.calls, (call) => methodOf(call) === 'POST' && apiPathOf(call).endsWith('/issues'))
  const firstLabels = countCalls(first.calls, (call) => methodOf(call) === 'POST' && apiPathOf(call).endsWith('/labels'))
  const firstClose = countCalls(first.calls, (call) => methodOf(call) === 'PUT' && call.argv.includes('state_event=close'))
  const firstLinks = countCalls(first.calls, (call) => methodOf(call) === 'POST' && apiPathOf(call).endsWith('/links'))
  check(firstCreate === 101, 'A18 假 glab 记账：首次播种正好 101 次建票', '实际 ' + firstCreate + ' 次\n' + describeCalls(first.calls.slice(0, 5)))
  check(firstLabels === 5, 'A19 假 glab 记账：5 个标签是显式创建的', '实际 ' + firstLabels + ' 次')
  check(firstClose === 5, 'A20 假 glab 记账：5 张已关闭的票各发一次 state_event=close', '实际 ' + firstClose + ' 次')
  check(firstLinks === 8, 'A21 假 glab 记账：8 条阻塞关系各尝试一次原生边（4 次被拒后回落）', '实际 ' + firstLinks + ' 次')

  check(
    firstJson !== null && textOf(firstJson.manifestPath).endsWith('gitlab-seed.json') && numberOr(asRecord(firstJson.project)?.id) !== null,
    'A22 回执里带着 manifest 路径与项目 id',
    JSON.stringify(firstJson),
  )

  // ── B. 重跑：幂等，不重复创建 ───────────────────────────────────────────
  const idsBeforeRerun = keyToIid(manifest)
  const second = runSeed(harness, b2, [], [])
  const secondFailure = harness.formatFailure(second.run)
  const secondJson = asRecord(second.run.json)
  const created = secondJson !== null ? asRecord(secondJson.created) : null
  const reused = secondJson !== null ? asRecord(secondJson.reused) : null
  check(second.run.exitCode === 0 && secondJson !== null && secondJson.ok === true, 'B1 重跑正常退出且 ok=true', secondFailure)
  check(created !== null && numberOr(created.issues) === 0, 'B2 重跑报告创建了 0 张新票', JSON.stringify(created))
  check(reused !== null && numberOr(reused.issues) === 101, 'B3 重跑报告复用了 101 张已有票', JSON.stringify(reused))
  const secondWrites = second.calls.filter(isWriteCall)
  check(secondWrites.length === 0, 'B4 假 glab 记账：重跑没有任何写调用（没有重复创建）', describeCalls(secondWrites))
  const manifestAfterRerun = readManifest(harness, b2)
  check(keyToIid(manifestAfterRerun) === idsBeforeRerun, 'B5 重跑前后 manifest 的「种子键 → iid」完全一致（复用已有 id）', keyToIid(manifestAfterRerun))
  check(manifestAfterRerun !== null && manifestAfterRerun.mode === 'read-only', 'B6 重跑后仍是 read-only 标记', JSON.stringify(manifestAfterRerun && manifestAfterRerun.mode))

  // ── C. 部分失败：manifest 与错误可读，重跑只补缺的 ───────────────────────
  const b3 = seedCase(harness, 'b3', 'seed-group/b3-pool')
  const b3Args = ['--ticket-count', '21', '--maps', '1', '--children', '2', '--closed', '2', '--blocking', '2']
  const partialRules = [
    {
      // 永久拒绝：这张票这一次跑到底建不出来
      argvIncludes: ['title=种子票 007'],
      exitCode: 1,
      stderr: '假 glab：按计划永久拒绝创建 种子票 007\n',
    },
    {
      // 只失败前两次：第三次（重试的第 3 次）应当成功
      argvIncludes: ['title=种子票 009'],
      exitCode: 1,
      stderr: '假 glab：第一次创建故意失败\n',
      failTimes: 2,
    },
  ]
  const partial = runSeed(harness, b3, b3Args, partialRules)
  const partialFailure = harness.formatFailure(partial.run)
  const partialJson = asRecord(partial.run.json)
  check(partial.run.exitCode === 1, 'C1 部分失败时退出码 1', partialFailure)
  check(partialJson !== null && partialJson.ok === false, 'C2 部分失败时 stdout 仍是一段 JSON（ok=false，manifest 才是主证据）', partialFailure)
  check(
    partial.run.stderr.includes('种子票 007') && partial.run.stderr.includes('重试 3 次') && partial.run.stderr.includes('第 7 张'),
    'C3 stderr 指得出第几张票、哪个对象、重试几次仍失败',
    partialFailure,
  )
  const partialManifest = readManifest(harness, b3)
  const partialErrors = partialManifest !== null ? recordsOf(partialManifest.errors) : []
  check(partialManifest !== null && partialManifest.mode === 'seedable', 'C4 部分失败后 manifest 可读、仍是 seedable（可以继续补种）', JSON.stringify(partialManifest && partialManifest.mode))
  check(
    partialErrors.length === 1 && textOf(partialErrors[0].seedKey) === 'seed-issue-007' && numberOr(partialErrors[0].attempts) === 3,
    'C5 manifest.errors 记着失败对象、尝试次数与原因',
    JSON.stringify(partialErrors),
  )
  const partialIssueCount = manifestIssues(partialManifest).length
  check(partialIssueCount === 20, 'C6 部分失败这一趟已经建成 20 张票（错的只有那一张）', 'manifest 有 ' + partialIssueCount + ' 条')
  const stateAfterPartial = readFakeState(b3)
  check(issueByTitle(stateAfterPartial, '种子票 009') !== null, 'C7 只失败前两次的票在第 3 次重试时建成了（种子票 009）', JSON.stringify(fakeIssues(stateAfterPartial).map((issue) => issue.title)))
  check(issueByTitle(stateAfterPartial, '种子票 007') === null, 'C8 永久拒绝的票确实没建成（种子票 007）', '')
  const attempts007 = countCalls(partial.calls, (call) => call.argv.includes('title=种子票 007') && methodOf(call) === 'POST')
  const attempts009 = countCalls(partial.calls, (call) => call.argv.includes('title=种子票 009') && methodOf(call) === 'POST')
  check(attempts007 === 3, 'C9 建票失败会重试 3 次（种子票 007 发了 3 次 POST）', '实际 ' + attempts007 + ' 次')
  check(attempts009 === 3, 'C10 重试带退避且在第三次成功（种子票 009 发了 3 次 POST）', '实际 ' + attempts009 + ' 次')

  const fill = runSeed(harness, b3, b3Args, [])
  const fillFailure = harness.formatFailure(fill.run)
  const fillJson = asRecord(fill.run.json)
  const fillCreated = fillJson !== null ? asRecord(fillJson.created) : null
  check(fill.run.exitCode === 0 && fillJson !== null && fillJson.ok === true, 'C11 补种一趟正常退出且 ok=true', fillFailure)
  check(fillCreated !== null && numberOr(fillCreated.issues) === 1, 'C12 补种只建缺的那 1 张票（不重复创建已有的 20 张）', JSON.stringify(fillCreated))
  const filledManifest = readManifest(harness, b3)
  const filledState = readFakeState(b3)
  check(
    manifestIssues(filledManifest).length === 21 && recordsOf(filledManifest?.errors).length === 0 && filledManifest?.mode === 'read-only',
    'C13 补种后 manifest 记满 21 张票、没有遗留错误、恢复 read-only',
    JSON.stringify({ mode: filledManifest?.mode, issues: manifestIssues(filledManifest).length, errors: recordsOf(filledManifest?.errors).length }),
  )
  check(fakeIssues(filledState).length === 21, 'C14 远端一共 21 张票，没有重复创建', '远端有 ' + fakeIssues(filledState).length + ' 张')
  const total007 = attempts007 + countCalls(fill.calls, (call) => call.argv.includes('title=种子票 007') && methodOf(call) === 'POST')
  check(total007 === 4, 'C15 跨两趟看：种子票 007 总共 4 次 POST（前一趟 3 次失败 + 补种 1 次成功）', '实际 ' + total007 + ' 次')
  const b3Blocking = filledManifest !== null ? recordsOf(asRecord(filledManifest.relations)?.blocking) : []
  const b3Parent = filledManifest !== null ? recordsOf(asRecord(filledManifest.relations)?.parent) : []
  check(b3Blocking.length === 2 && b3Parent.length === 2, 'C16 补种后父子关系 2 条、阻塞关系 2 条都齐全', JSON.stringify({ blocking: b3Blocking.length, parent: b3Parent.length }))

  // ── D. 只读标记：池子只读时拒绝补种，显式解锁才写 ─────────────────────
  const beforeTamper = readManifest(harness, b2)
  const victim = issueByKey(beforeTamper, 'seed-issue-060')
  const victimIid = victim !== null ? numberOr(victim.iid) : null
  check(victimIid !== null, 'D1 在 b2 的 manifest 里找到用来模拟丢失的票（seed-issue-060）', JSON.stringify(victim))
  const tamperedState = readFakeState(b2)
  if (tamperedState !== null && victimIid !== null) {
    tamperedState.issues = fakeIssues(tamperedState).filter((issue) => numberOr(issue.iid) !== victimIid)
    writeFakeState(b2, tamperedState)
  }
  const locked = runSeed(harness, b2, [], [])
  const lockedFailure = harness.formatFailure(locked.run)
  check(locked.run.exitCode === 1, 'D2 只读池里发现缺票时重跑失败（退出码 1）', lockedFailure)
  check(locked.run.stderr.includes('只读') && locked.run.stderr.includes('--unlock-readonly'), 'D3 失败原因说清只读标记与 --unlock-readonly 的解锁方式', lockedFailure)
  check(countCalls(locked.calls, isWriteCall) === 0, 'D4 拒绝写之前没有对 GitLab 发任何写调用（先检查标记再写）', describeCalls(locked.calls))
  const afterLocked = readManifest(harness, b2)
  check(afterLocked !== null && afterLocked.mode === 'read-only', 'D5 拒绝写没有动到只读标记', JSON.stringify(afterLocked && afterLocked.mode))
  const unlocked = runSeed(harness, b2, ['--unlock-readonly'], [])
  const unlockedFailure = harness.formatFailure(unlocked.run)
  const unlockedJson = asRecord(unlocked.run.json)
  const unlockedCreated = unlockedJson !== null ? asRecord(unlockedJson.created) : null
  check(unlocked.run.exitCode === 0 && unlockedJson !== null && unlockedJson.ok === true, 'D6 加 --unlock-readonly 后补种成功', unlockedFailure)
  check(unlockedCreated !== null && numberOr(unlockedCreated.issues) === 1, 'D7 解锁后只补建丢的那 1 张票', JSON.stringify(unlockedCreated))
  const afterUnlock = readManifest(harness, b2)
  check(
    afterUnlock !== null && afterUnlock.mode === 'read-only' && manifestIssues(afterUnlock).length === 101,
    'D8 补完恢复 read-only 标记，manifest 仍是 101 张票',
    JSON.stringify({ mode: afterUnlock?.mode, issues: manifestIssues(afterUnlock).length }),
  )
  check(fakeIssues(readFakeState(b2)).length === 101, 'D9 远端恢复到 101 张票（补的票没有重复）', '远端有 ' + fakeIssues(readFakeState(b2)).length + ' 张')

  // ── E. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ──────────
  const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
    encoding: 'utf8',
    timeout: 240000,
    windowsHide: true,
  })
  const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
  const scan = scanGateResult(negativeOutput)
  check(negativeRun.status === 1, 'E1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
  check(
    scan.record !== null && scan.record.failed >= 3 && scan.record.assertions >= 3,
    'E2 --negative 的完成记录自报至少 3 条失败断言',
    negativeOutput,
  )
  check(
    negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
    'E3 负例输出里能看到被故意触发的断言与失败行',
    negativeOutput,
  )
}

// ── 负例通道：真的播种一遍再重跑，然后故意把三条期望写错 ──────────────────────

function runNegative(harness: RealMachineHarness): void {
  const neg = seedCase(harness, 'negative', 'seed-group/negative-pool')
  const args = ['--ticket-count', '6', '--maps', '1', '--children', '1', '--closed', '1', '--blocking', '1']
  const firstRun = runSeed(harness, neg, args, [])
  const firstJson = asRecord(firstRun.run.json)
  check(
    firstRun.run.exitCode === 0 && firstJson !== null && firstJson.ok === true,
    '[负例] 前提：小批播种正常成功',
    harness.formatFailure(firstRun.run),
  )
  const manifest = readManifest(harness, neg)
  const rerun = runSeed(harness, neg, args, [])
  check(rerun.run.exitCode === 0, '[负例] 前提：重跑正常退出', harness.formatFailure(rerun.run))
  check(countCalls(rerun.calls, isWriteCall) === 0, '[负例] 前提：重跑没有任何写调用（幂等）', describeCalls(rerun.calls.filter(isWriteCall)))

  // 以下三条是故意写错的期望，必然失败；它们分别指回「票数」「重跑不重复创建」「只读标记」三条不变式。
  const stats = firstJson !== null ? asRecord(firstJson.stats) : null
  check(
    stats !== null && numberOr(stats.issues) === 999,
    '[负例] 故意期望种出 999 张票：实际按 --ticket-count 6 种出 6 张，这条必须红',
    JSON.stringify(stats),
  )
  check(
    countCalls(rerun.calls, isWriteCall) > 0,
    '[负例] 故意期望重跑再创建一次票：实际幂等、没有任何写调用，这条必须红',
    describeCalls(rerun.calls),
  )
  check(
    manifest !== null && manifest.mode === 'seedable',
    '[负例] 故意期望种完后没有只读标记：实际写的是 read-only，这条必须红',
    JSON.stringify(manifest && manifest.mode),
  )
}

// ── 入口 ────────────────────────────────────────────────────────────────────

function main(): void {
  const harness = createRealMachineHarness({ name: 'verify-1708-seed-data' })
  try {
    console.log('临时工作根：' + harness.workRoot)
    if (NEGATIVE) runNegative(harness)
    else runPositive(harness)
  } finally {
    harness.dispose()
  }
}

try {
  main()
  console.log('')
  console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
  printGateResult(GATE, passed + failed, failed)
  process.exitCode = failed > 0 ? 1 : 0
} catch (error: unknown) {
  failed += 1
  console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
  printGateResult(GATE, passed + failed, failed)
  process.exitCode = 1
}
