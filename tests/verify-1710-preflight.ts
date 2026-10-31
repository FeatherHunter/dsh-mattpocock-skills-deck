// tests/verify-1710-preflight.ts —— #1710「批次前置巡检：一条命令输出完整环境预检并逐项报失败原因」的自证门禁。
//
// 只走规格 #1703 定下的唯一测试接缝：命令行进程接口。本文件不 import 预检命令内部函数，也不读命令源码文本；
// 它起子进程跑 scripts/real-machine/commands/preflight.mts，只读 stdout 的 JSON、stderr、退出码与文件副作用。
// 外部世界（glab、屏幕信息命令、工作根、隔离 home）全部从进程边界注入，不访问真实 gitlab.com、不碰真实凭据。
//
// 覆盖的验收判据：
//   A. 正例：一条命令输出一段完整预检 JSON，九项硬检查齐全且全绿；屏幕分辨率与主屏来自预检自己执行
//      注入的屏幕命令，不靠人抄；默认 --out 文件与 stdout 内容一致；glab 只走注入的假 glab。
//   B. 负例：九个硬项各起一次子进程、每次只破坏那一项，断言退出码非 0、那一项 ok=false 且 reason 非空、
//      stderr 点到项名，其余八项仍然全绿（证明每个硬项都能单独触发）。
//   C. --negative 通道：先造出完整正例环境跑一次会成功的预检，再故意把三处期望写错，证明断言真的能红
//      （不是删掉断言换来的红）。正例收尾还会起一份 --negative 子门禁自检，让负例本身也进每次全链。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1710-preflight.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1710-preflight.ts --negative

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, createRealMachineHarness, samePath } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'

const GATE = 'verify-1710-preflight'
const SELF_REL = 'tests/verify-1710-preflight.ts'
const NEGATIVE = process.argv.includes('--negative')

const PROJECT_ID = 910001
const PROJECT_SHORT_NAME = 'dsh-preflight-test'
const PROJECT_PATH = 'FixtureGroup/dsh-preflight-test'
const VERSION = '1.2.3-fixture'
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const ITEM_IDS = ['candidate', 'isolation-home', 'workspace', 'glab', 'sandbox-project', 'ticket-pool', 'log-dir', 'screen', 'node']
const SCREEN_CMD_ENV = 'DSH_PREFLIGHT_SCREEN_CMD'

let passed = 0
let failed = 0

/** 一条断言：通过的只留一行；失败的把可定位的现场整段缩进打出来，供人直接照着查。 */
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
  const shown = lines.slice(0, 80)
  for (const line of shown) console.log('       | ' + line)
  if (lines.length > shown.length) console.log('       | …（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function itemById(report: JsonRecord | null, id: string): JsonRecord | null {
  if (!report) return null
  for (const item of asArray(report.items)) {
    const record = asRecord(item)
    if (record && record.id === id) return record
  }
  return null
}

function detailOf(item: JsonRecord | null): JsonRecord {
  return item ? asRecord(item.details) || {} : {}
}

/** 直接往临时工作根里写文件（夹具准备现场用）；路径都是绝对路径，调用方保证在 workRoot 下。 */
function writeAbs(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

function readJsonAbs(file: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** 项目对象照 gitlab.com 的 projects API 形状写：path 是短名，path_with_namespace 是完整路径。 */
function projectJson(extra?: JsonRecord): JsonRecord {
  const base: JsonRecord = {
    id: PROJECT_ID,
    name: PROJECT_SHORT_NAME,
    path: PROJECT_SHORT_NAME,
    path_with_namespace: PROJECT_PATH,
    web_url: 'https://gitlab.com/' + PROJECT_PATH,
    description: '门禁夹具 [dsh-sandbox batch=preflight]',
    visibility: 'private',
    default_branch: 'main',
  }
  return Object.assign(base, extra || {})
}

function seedIssues(count: number): JsonRecord[] {
  const issues: JsonRecord[] = []
  for (let index = 1; index <= count; index += 1) {
    issues.push({
      key: 'issue-' + String(index).padStart(3, '0'),
      role: 'issue',
      title: '夹具票 ' + String(index),
      iid: index,
      id: 500000 + index,
      webUrl: 'https://gitlab.com/' + PROJECT_PATH + '/-/issues/' + String(index),
      state: index <= 5 ? 'closed' : 'opened',
      labels: [],
      parentKey: null,
      blockedByKey: null,
      assigneeIds: [],
    })
  }
  return issues
}

/** 写种子清单：issues 数组与 stats.issues 同时跟着 count 变，方便负例只破坏票数。 */
function writeSeedManifest(file: string, count: number, batchDir: string): void {
  const issues = seedIssues(count)
  const manifest: JsonRecord = {
    version: 1,
    kind: 'gitlab-seed',
    batch: 'preflight',
    batchDir,
    generatedAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    project: {
      id: PROJECT_ID,
      path: PROJECT_SHORT_NAME,
      pathWithNamespace: PROJECT_PATH,
      webUrl: 'https://gitlab.com/' + PROJECT_PATH,
    },
    spec: {
      projectPath: PROJECT_PATH,
      ticketCount: 101,
      closedCount: 5,
      mapCount: 2,
      childrenCount: 5,
      blockingPairs: 8,
      labels: [],
      issues: [],
    },
    mode: 'read-only',
    assigneeUserId: 12345678,
    labels: [],
    issues,
    relations: { parent: [], blocking: [] },
    errors: [],
    stats: {
      issues: count,
      closedIssues: Math.min(count, 5),
      maps: 0,
      children: 0,
      labels: 0,
      assignees: 0,
      parentEdges: 0,
      blockedEdges: 0,
    },
  }
  writeAbs(file, JSON.stringify(manifest, null, 2) + '\n')
}

/** 写一个假屏幕命令启动器：Windows 写 .cmd，其它平台写可执行 sh；两种都直接调 node 跑夹具。 */
function writeScreenLauncher(binDir: string): string {
  const fixtureAbs = path.join(REPO_ROOT, 'tests/fixtures/real-machine/preflight/fake-screen.mts')
  if (!fs.existsSync(fixtureAbs)) throw new Error('假屏幕夹具不存在：' + fixtureAbs)
  if (process.platform === 'win32') {
    const file = path.join(binDir, 'screen.cmd')
    fs.writeFileSync(file, '@echo off\r\n"' + process.execPath + '" --no-warnings "' + fixtureAbs + '" %*\r\n', 'utf8')
    return file
  }
  const file = path.join(binDir, 'screen')
  fs.writeFileSync(file, '#!/bin/sh\nexec "' + process.execPath + '" --no-warnings "' + fixtureAbs + '" "$@"\n', 'utf8')
  fs.chmodSync(file, 0o755)
  return file
}

interface Fixtures {
  workRoot: string
  batchDir: string
  candidatePath: string
  tgzPath: string
  tgzSha256: string
  tgzBytes: number
  homeDir: string
  seedPath: string
  screenCmd: string
  workspaceDir: string
  expectedRemote: string
}

/** 造一份完整批次环境：candidate、隔离 home（插件已装）、工作区、批次项目清单、种子票池、假屏幕命令。 */
function prepareFixtures(harness: ReturnType<typeof createRealMachineHarness>): Fixtures {
  const workRoot = harness.workRoot
  const batchDir = path.join(workRoot, 'batches', 'preflight')
  const screenCmd = writeScreenLauncher(harness.binDir)

  // candidate.json：提交是 40 位十六进制，tgz 的 SHA256 由门禁独立算（不由被测命令算，避免自证）。
  const pkgDir = path.join(workRoot, 'pkg')
  const tgzPath = path.join(pkgDir, 'candidate-fixture.tgz')
  const tgzBytes = Buffer.from('preflight gate fixture tgz bytes, not a real npm pack\n', 'utf8')
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(tgzPath, tgzBytes)
  const tgzSha256 = crypto.createHash('sha256').update(tgzBytes).digest('hex')
  const candidatePath = path.join(pkgDir, 'candidate.json')
  const candidate = {
    schemaVersion: 1,
    generatedAt: '2026-10-31T00:00:00.000Z',
    tool: 'tests/verify-1710-preflight.ts',
    ticket: '1710',
    candidateName: 'preflight-fixture',
    version: VERSION,
    git: { commit: COMMIT, branch: 'ticket/1710-preflight', clean: true, dirtyFiles: [] },
    build: { skipped: true, command: '', exitCode: 0, elapsedMs: 0 },
    package: {
      tgzPath,
      tgzBytes: tgzBytes.length,
      tgzSha256,
      filename: path.basename(tgzPath),
      fileCount: 1,
      files: [{ path: 'package.json', bytes: tgzBytes.length, sha256: tgzSha256 }],
    },
    install: null,
    ui: null,
    reproducible: null,
  }
  writeAbs(candidatePath, JSON.stringify(candidate, null, 2) + '\n')

  // 隔离 home：profiles/web 下插件已装，包版本与 candidate 一致，client.js 带界面版本常量。
  const homeDir = path.join(batchDir, 'homes', 'instance-a')
  const pluginDir = path.join(homeDir, 'profiles', 'web', 'node_modules', 'dsh-mattpocock-skills-deck')
  writeAbs(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({ name: 'dsh-mattpocock-skills-deck', version: VERSION }, null, 2) + '\n',
  )
  writeAbs(path.join(pluginDir, 'lib', 'client.js'), 'export const DSW_VERSION = "v' + VERSION + '"\n')

  // 工作区与批次项目清单都由真命令造：make-workspace 本地 git init + remote add，gitlab-sandbox 走假 glab。
  harness.writeGlabPlan({
    rules: [
      { argvPrefix: ['repo', 'create', PROJECT_PATH], stdout: 'Created project https://gitlab.com/' + PROJECT_PATH + '\n' },
      { argvPrefix: ['api', 'projects/' + encodeURIComponent(PROJECT_PATH)], stdout: JSON.stringify(projectJson()) + '\n' },
    ],
    default: { exitCode: 2, stderr: '假 glab：造夹具项目时不该有别的调用' + '\n' },
  })
  const wsRun = harness.runCommand('make-workspace', {
    args: ['--batch', batchDir, '--kind', 'gitlab', '--name', 'ws', '--project', PROJECT_PATH],
  })
  check(wsRun.exitCode === 0, '准备：make-workspace 造出批次工作区', harness.formatFailure(wsRun))
  const sandboxRun = harness.runCommand('gitlab-sandbox', {
    args: ['create', '--batch', batchDir, '--path', PROJECT_PATH],
  })
  check(sandboxRun.exitCode === 0, '准备：gitlab-sandbox create 写回批次项目清单', harness.formatFailure(sandboxRun))

  const seedPath = path.join(batchDir, 'gitlab-seed.json')
  writeSeedManifest(seedPath, 101, batchDir)

  const workspaceDir = path.join(batchDir, 'workspaces', 'ws')
  return {
    workRoot,
    batchDir,
    candidatePath,
    tgzPath,
    tgzSha256,
    tgzBytes: tgzBytes.length,
    homeDir,
    seedPath,
    screenCmd,
    workspaceDir,
    expectedRemote: 'https://gitlab.com/' + PROJECT_PATH + '.git',
  }
}

/** 正例的假 glab 应答：版本、登录账号、项目读回、票数统计。规则顺序有意义，先放的先命中。 */
function setPositivePlan(harness: ReturnType<typeof createRealMachineHarness>): void {
  harness.writeGlabPlan({
    rules: [
      { argvPrefix: ['--version'], stdout: 'glab version 1.50.0 (fixture)\n' },
      { argvPrefix: ['auth', 'status'], stdout: 'gitlab.com\n  ✓ Logged in to gitlab.com as FeatherHunter (keyring)\n' },
      {
        argvPrefix: ['api', 'projects/' + String(PROJECT_ID) + '/issues_statistics'],
        stdout: JSON.stringify({ statistics: { counts: { all: 101 } } }) + '\n',
      },
      { argvPrefix: ['api', 'projects/' + String(PROJECT_ID)], stdout: JSON.stringify(projectJson()) + '\n' },
    ],
    default: { exitCode: 2, stderr: '假 glab：预检不该有别的调用\n' },
  })
}

/** glab 未认证的负例计划：版本正常，auth status 退出码 1。 */
function setUnauthenticatedPlan(harness: ReturnType<typeof createRealMachineHarness>): void {
  harness.writeGlabPlan({
    rules: [
      { argvPrefix: ['--version'], stdout: 'glab version 1.50.0 (fixture)\n' },
      {
        argvPrefix: ['auth', 'status'],
        exitCode: 1,
        stderr: 'gitlab.com\n  x 没有登录到 gitlab.com。\n',
      },
      {
        argvPrefix: ['api', 'projects/' + String(PROJECT_ID) + '/issues_statistics'],
        stdout: JSON.stringify({ statistics: { counts: { all: 101 } } }) + '\n',
      },
      { argvPrefix: ['api', 'projects/' + String(PROJECT_ID)], stdout: JSON.stringify(projectJson()) + '\n' },
    ],
    default: { exitCode: 2, stderr: '假 glab：预检不该有别的调用\n' },
  })
}

/** 项目已被标记删除的负例计划：读回带 marked_for_deletion_at 与 -deletion_scheduled- 路径。 */
function setMarkedForDeletionPlan(harness: ReturnType<typeof createRealMachineHarness>): void {
  const markedShortName = PROJECT_SHORT_NAME + '-deletion_scheduled-' + String(PROJECT_ID)
  const markedFullPath = PROJECT_PATH.split('/').slice(0, -1).concat([markedShortName]).join('/')
  const marked = projectJson({
    name: markedShortName,
    path: markedShortName,
    path_with_namespace: markedFullPath,
    marked_for_deletion_at: '2026-10-30T15:56:04Z',
    marked_for_deletion_on: '2026-10-30',
  })
  harness.writeGlabPlan({
    rules: [
      { argvPrefix: ['--version'], stdout: 'glab version 1.50.0 (fixture)\n' },
      { argvPrefix: ['auth', 'status'], stdout: 'gitlab.com\n  ✓ Logged in to gitlab.com as FeatherHunter (keyring)\n' },
      {
        argvPrefix: ['api', 'projects/' + String(PROJECT_ID) + '/issues_statistics'],
        stdout: JSON.stringify({ statistics: { counts: { all: 101 } } }) + '\n',
      },
      { argvPrefix: ['api', 'projects/' + String(PROJECT_ID)], stdout: JSON.stringify(marked) + '\n' },
    ],
    default: { exitCode: 2, stderr: '假 glab：预检不该有别的调用\n' },
  })
}

/** 负例断言：退出码非 0、整体 ok=false、目标硬项 ok=false 且 reason 非空、stderr 点到项名、其余八项仍全绿。 */
function checkNegative(run: ReturnType<ReturnType<typeof createRealMachineHarness>['runCommand']>, targetId: string, label: string): void {
  const report = asRecord(run.json)
  const items = asArray(report ? report.items : null)
  const target = itemById(report, targetId)
  check(run.exitCode !== 0, label + '：退出码非 0', harnessFailure(run))
  check(report !== null && report.ok === false, label + '：整体 ok=false', harnessFailure(run))
  check(
    target !== null && target.ok === false && typeof target.reason === 'string' && target.reason.length > 0,
    label + '：硬项「' + targetId + '」ok=false 且 reason 非空',
    harnessFailure(run),
  )
  check(String(run.stderr || '').includes(targetId), label + '：stderr 点到硬项名「' + targetId + '」', harnessFailure(run))
  const others = items
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => item !== null && item.id !== targetId)
  check(
    items.length === ITEM_IDS.length && others.length === ITEM_IDS.length - 1 && others.every((item) => item.ok === true),
    label + '：其余八项仍然全绿（只破坏了这一项）',
    harnessFailure(run),
  )
}

/** checkNegative 里拿不到 harness.formatFailure（它要 harness），失败现场用 run 自带信息拼。 */
function harnessFailure(run: ReturnType<ReturnType<typeof createRealMachineHarness>['runCommand']>): string {
  const lines: string[] = []
  lines.push('命令：' + run.command)
  lines.push('退出码：' + (run.exitCode === null ? '（没拿到）' : String(run.exitCode)) + '；耗时：' + run.elapsedMs + 'ms')
  if (run.jsonError) lines.push('stdout 解析：' + run.jsonError)
  lines.push('—— stdout ——')
  lines.push(run.stdout.slice(0, 4000) || '（空）')
  lines.push('—— stderr ——')
  lines.push(run.stderr.slice(0, 2000) || '（空）')
  return lines.join('\n')
}

interface NegativeCase {
  targetId: string
  label: string
  args: string[]
  env?: Record<string, string>
  prepare?: () => void
  cleanup?: () => void
}

/** --negative 通道：先把正例环境跑通一次，再故意把三处期望写错，证明断言真能红。 */
function runNegativeChannel(harness: ReturnType<typeof createRealMachineHarness>, fixtures: Fixtures): void {
  setPositivePlan(harness)
  const run = harness.runCommand('preflight', { args: ['--batch', fixtures.batchDir], env: { [SCREEN_CMD_ENV]: fixtures.screenCmd } })
  const report = asRecord(run.json)
  const screen = itemById(report, 'screen')
  const devices = asArray(detailOf(screen).devices)
  check(run.exitCode === 1, '[负例] 故意把一条成功命令的退出码期望成 1：这条断言必须红', harnessFailure(run))
  check(asArray(report ? report.items : null).length === 3, '[负例] 故意期望只报 3 个检查项（实际 9 个）：这条断言必须红', harnessFailure(run))
  check(devices.length === 0, '[负例] 故意期望屏幕设备数为 0（实际 2 台）：这条断言必须红', harnessFailure(run))
}

async function main(): Promise<void> {
  const harness = createRealMachineHarness({ name: 'verify-1710' })
  try {
    console.log('临时工作根：' + harness.workRoot)
    const fixtures = prepareFixtures(harness)

    if (NEGATIVE) {
      runNegativeChannel(harness, fixtures)
      return
    }

    // ── A. 正例：一条命令输出完整预检 JSON，九项硬检查全绿 ────────────────────
    setPositivePlan(harness)
    const beforeCalls = harness.readGlabCalls().length
    const run = harness.runCommand('preflight', { args: ['--batch', fixtures.batchDir], env: { [SCREEN_CMD_ENV]: fixtures.screenCmd } })
    check(run.exitCode === 0, 'A1 正例：预检命令退出码 0', harness.formatFailure(run))
    check(run.json !== null && run.jsonError === '', 'A2 stdout 是一段可解析的 JSON（没有第二段文字）', harness.formatFailure(run))
    check(String(run.stderr || '').trim() === '', 'A3 成功时 stderr 为空（说明都走 stdout 的 JSON）', harness.formatFailure(run))
    const report = asRecord(run.json)
    check(
      report !== null && report.schemaVersion === 1 && typeof report.tool === 'string' && report.tool.endsWith('scripts/real-machine/commands/preflight.mts'),
      'A4 顶层字段：schemaVersion=1、tool 指到预检命令',
      harness.formatFailure(run),
    )
    check(
      report !== null && typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(String(report.generatedAt))),
      'A5 顶层字段：generatedAt 是 ISO 时间',
      harnessFailure(run),
    )
    const batch = report ? asRecord(report.batch) : null
    check(
      batch !== null && samePath(String(batch.dir), fixtures.batchDir) && batch.name === 'preflight',
      'A6 顶层字段：batch.dir 指到批次目录、batch.name 是批次名',
      harnessFailure(run),
    )
    check(report !== null && report.ok === true, 'A7 顶层字段：整体 ok=true（九项硬检查全绿）', harnessFailure(run))
    const summary = report ? asRecord(report.summary) : null
    check(
      summary !== null && summary.total === 9 && summary.hard === 9 && summary.hardFailed === 0 && summary.soft === 0 && summary.softFailed === 0,
      'A8 summary 统计：total=9、hard=9、hardFailed=0、soft=0',
      harnessFailure(run),
    )
    const items = asArray(report ? report.items : null)
    const ids = items.map((item) => String(asRecord(item)?.id || ''))
    check(
      items.length === ITEM_IDS.length && ITEM_IDS.every((id, index) => ids[index] === id),
      'A9 items 正好九项、稳定 id 与顺序都对',
      JSON.stringify(ids),
    )
    let shapeOk = items.length === ITEM_IDS.length
    const shapeProblems: string[] = []
    for (const item of items) {
      const record = asRecord(item)
      if (
        !record ||
        typeof record.id !== 'string' ||
        typeof record.name !== 'string' ||
        record.name.length === 0 ||
        record.hard !== true ||
        record.ok !== true ||
        typeof record.reason !== 'string' ||
        asRecord(record.details) === null
      ) {
        shapeOk = false
        shapeProblems.push(JSON.stringify(item))
      }
    }
    check(shapeOk, 'A10 每一项都有 id/中文名/hard=true/ok=true/reason/details 字段', shapeProblems.join('\n'))

    const candidateItem = itemById(report, 'candidate')
    const candidateDetails = detailOf(candidateItem)
    check(
      candidateItem !== null && candidateItem.ok === true,
      'A11 候选包身份项：candidate.json 里的提交与 tgz SHA256 都对上',
      JSON.stringify(candidateItem, null, 2),
    )
    check(
      candidateDetails.commit === COMMIT &&
        candidateDetails.tgzSha256Actual === fixtures.tgzSha256 &&
        candidateDetails.tgzBytesActual === fixtures.tgzBytes &&
        candidateDetails.version === VERSION &&
        candidateDetails.hashMatches === true,
      'A12 候选包身份项 details：commit、tgzSha256、tgzBytes、version、hashMatches 都是实测值',
      JSON.stringify(candidateDetails, null, 2),
    )

    const homeItem = itemById(report, 'isolation-home')
    const homeDetails = detailOf(homeItem)
    const installed = asRecord(homeDetails.installed)
    check(
      homeItem !== null && homeItem.ok === true && samePath(String(homeDetails.home || ''), fixtures.homeDir) && homeDetails.profile === 'web',
      'A13 隔离 home 项：路径与 profile 指到批次里的隔离 home',
      JSON.stringify(homeItem, null, 2),
    )
    check(
      homeDetails.isolated === true &&
        installed !== null &&
        installed.version === VERSION &&
        homeDetails.versionMatches === true,
      'A14 隔离 home 项 details：落在隔离位置、已装插件版本与候选版本一致',
      JSON.stringify(homeDetails, null, 2),
    )

    const workspaceItem = itemById(report, 'workspace')
    const workspaceDetails = detailOf(workspaceItem)
    check(
      workspaceItem !== null &&
        workspaceItem.ok === true &&
        workspaceDetails.backendId === 'gitlab' &&
        workspaceDetails.origin === fixtures.expectedRemote &&
        workspaceDetails.remoteMatches === true,
      'A15 工作区项：workspace.yaml backendId=gitlab、origin 指向本批项目地址',
      JSON.stringify(workspaceItem, null, 2),
    )

    const glabItem = itemById(report, 'glab')
    const glabDetails = detailOf(glabItem)
    check(
      glabItem !== null &&
        glabItem.ok === true &&
        glabDetails.version === '1.50.0' &&
        glabDetails.authenticated === true &&
        glabDetails.account === 'FeatherHunter',
      'A16 glab 项：版本串与登录账号都从注入的假 glab 读回',
      JSON.stringify(glabItem, null, 2),
    )

    const projectItem = itemById(report, 'sandbox-project')
    const projectDetails = detailOf(projectItem)
    const readback = asRecord(projectDetails.readback)
    check(
      projectItem !== null &&
        projectItem.ok === true &&
        readback !== null &&
        readback.id === PROJECT_ID &&
        readback.pathWithNamespace === PROJECT_PATH &&
        readback.state === 'active' &&
        projectDetails.status === 'created',
      'A17 沙箱项目项：按 id 读回的 id/path_with_namespace/状态都正常，没被标记删除',
      JSON.stringify(projectItem, null, 2),
    )

    const ticketItem = itemById(report, 'ticket-pool')
    const ticketDetails = detailOf(ticketItem)
    const independent = asRecord(ticketDetails.independentReadback)
    check(
      ticketItem !== null &&
        ticketItem.ok === true &&
        ticketDetails.count === 101 &&
        ticketDetails.minTickets === 101 &&
        independent !== null &&
        independent.ok === true &&
        independent.count === 101 &&
        independent.matchesManifest === true,
      'A18 票池项：种子清单 101 张票，独立读回也是 101 张',
      JSON.stringify(ticketItem, null, 2),
    )

    const logItem = itemById(report, 'log-dir')
    const logDetails = detailOf(logItem)
    check(
      logItem !== null &&
        logItem.ok === true &&
        logDetails.written === true &&
        logDetails.deleted === true &&
        logDetails.existsBefore === false,
      'A19 日志目录项：真的写了探针文件又删掉',
      JSON.stringify(logItem, null, 2),
    )

    const screenItem = itemById(report, 'screen')
    const screenDetails = detailOf(screenItem)
    const devices = asArray(screenDetails.devices)
    const primary = asRecord(screenDetails.primaryDevice)
    check(
      screenItem !== null &&
        screenItem.ok === true &&
        devices.length === 2 &&
        primary !== null &&
        primary.width === 1920 &&
        primary.height === 1080 &&
        primary.primary === true,
      'A20 屏幕项：分辨率与主屏来自预检自己执行注入的屏幕命令（不靠人抄）',
      JSON.stringify(screenItem, null, 2),
    )

    const nodeItem = itemById(report, 'node')
    const nodeDetails = detailOf(nodeItem)
    check(
      nodeItem !== null && nodeItem.ok === true && nodeDetails.version === process.versions.node && nodeDetails.minimum === '24.15.0',
      'A21 Node 项：版本与最小值都记下来了',
      JSON.stringify(nodeItem, null, 2),
    )

    const outPath = String(report ? report.outPath : '')
    const expectedOut = path.join(fixtures.batchDir, 'preflight.json')
    check(samePath(outPath, expectedOut), 'A22 默认 --out 落在 <批次目录>/preflight.json', outPath)
    check(fs.existsSync(expectedOut), 'A23 默认 out 文件真的写了', expectedOut)
    const outJson = readJsonAbs(expectedOut)
    check(
      outJson !== null && report !== null && JSON.stringify(outJson) === JSON.stringify(report),
      'A24 out 文件内容与 stdout 的 JSON 完全一致',
      JSON.stringify(outJson, null, 2),
    )
    const newCalls = harness.readGlabCalls().slice(beforeCalls).map((call) => call.argv.join(' '))
    check(
      newCalls.includes('--version') &&
        newCalls.includes('auth status') &&
        newCalls.includes('api projects/' + String(PROJECT_ID)) &&
        newCalls.includes('api projects/' + String(PROJECT_ID) + '/issues_statistics'),
      'A25 预检只通过注入的假 glab 读信息（版本/认证/项目/票数）',
      JSON.stringify(newCalls, null, 2),
    )

    // ── B. 负例：九个硬项各单独破坏一次 ───────────────────────────────────────
    // 放辅助目录里，别放进 <批次目录>/workspaces：那里现在只该有正例工作区一个，否则预检的默认工作区解析会被干扰。
    // 目录名别叫 aux：Windows 上 AUX 是保留设备名，git init 会报 Invalid argument。
    const noRemoteDir = path.join(fixtures.workRoot, 'helper', 'no-remote')
    fs.mkdirSync(noRemoteDir, { recursive: true })
    const gitInit = harness.runOnPath('git', ['init'], { cwd: noRemoteDir })
    check(gitInit.exitCode === 0, '准备：造一个没有 remote 的 git 仓库给工作区负例', harness.formatFailure(gitInit))
    writeAbs(path.join(noRemoteDir, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: gitlab\n')
    const logBlocker = path.join(fixtures.batchDir, 'log-blocked')
    writeAbs(logBlocker, '这是一个文件，用来挡日志目录（负例现场）\n')

    const cases: NegativeCase[] = [
      {
        targetId: 'candidate',
        label: 'B1 候选包不存在',
        args: ['--candidate', path.join(fixtures.workRoot, 'pkg', 'missing-candidate.json')],
      },
      {
        targetId: 'isolation-home',
        label: 'B2 隔离 home 不存在',
        args: ['--home', path.join(fixtures.batchDir, 'homes', 'missing-home')],
      },
      {
        targetId: 'workspace',
        label: 'B3 工作区缺 git remote',
        args: ['--workspace', noRemoteDir],
      },
      {
        targetId: 'glab',
        label: 'B4 glab 未认证',
        args: [],
        prepare: () => setUnauthenticatedPlan(harness),
        cleanup: () => setPositivePlan(harness),
      },
      {
        targetId: 'sandbox-project',
        label: 'B5 沙箱项目被标记删除',
        args: [],
        prepare: () => setMarkedForDeletionPlan(harness),
        cleanup: () => setPositivePlan(harness),
      },
      {
        targetId: 'ticket-pool',
        label: 'B6 票池数量不足',
        args: [],
        prepare: () => writeSeedManifest(fixtures.seedPath, 5, fixtures.batchDir),
        cleanup: () => writeSeedManifest(fixtures.seedPath, 101, fixtures.batchDir),
      },
      {
        targetId: 'log-dir',
        label: 'B7 日志目录不可写',
        args: ['--log-dir', logBlocker],
      },
      {
        targetId: 'screen',
        label: 'B8 屏幕命令取不到显示器',
        args: [],
        env: { FAKE_SCREEN_MODE: 'fail' },
      },
      {
        targetId: 'node',
        label: 'B9 Node 版本低于最小值',
        args: ['--node-min', '99.0.0'],
      },
    ]
    for (const negativeCase of cases) {
      setPositivePlan(harness)
      if (negativeCase.prepare) negativeCase.prepare()
      const negativeRun = harness.runCommand('preflight', {
        args: ['--batch', fixtures.batchDir].concat(negativeCase.args),
        env: Object.assign({ [SCREEN_CMD_ENV]: fixtures.screenCmd }, negativeCase.env || {}),
      })
      checkNegative(negativeRun, negativeCase.targetId, negativeCase.label)
      // 把回执里的失败汇总行原样打出来：这是「退出码非 0 且点到了项名」的人读证据，报告与排查都直接引它。
      const receiptLine = String(negativeRun.stderr || '').trim().split(/\r?\n/)[0] || '（没有 stderr 汇总行）'
      console.log('  证据：' + negativeCase.label + ' → ' + receiptLine)
      if (negativeCase.cleanup) negativeCase.cleanup()
    }

    // ── C. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ───────
    const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
    })
    const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
    const scan = scanGateResult(negativeOutput)
    check(negativeRun.status === 1, 'C1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
    check(
      scan.record !== null && scan.record.failed >= 2 && scan.record.assertions >= 2,
      'C2 --negative 的完成记录自报至少 2 条失败断言',
      negativeOutput,
    )
    check(
      negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
      'C3 负例输出里能看到被故意触发的断言与失败行',
      negativeOutput,
    )
  } finally {
    harness.dispose()
  }
}

main()
  .then(() => {
    console.log('')
    console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error: unknown) => {
    failed += 1
    console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = 1
  })
