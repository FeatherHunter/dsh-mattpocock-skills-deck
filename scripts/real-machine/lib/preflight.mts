// scripts/real-machine/lib/preflight.mts —— #1710「批次前置巡检」的检查库。
//
// 为什么要有这个库：规格 #1703 的每批标准步骤第 1 步是前置巡检，任何一项红了就先停下修，别带着
// 半截环境进场景。这里把「一批开始前必须核对什么」收在一处，命令脚本只负责解析参数、写回执；
// 九项硬检查各自返回稳定的 id、中文名、ok、失败原因（写清期望与实际差在哪）与可复核的 details。
//
// 设计口径：
//   - 外部世界只从进程边界进：glab 走 GLAB_BIN（默认 glab），屏幕信息走可注入的屏幕命令
//     （--screen-cmd / DSH_PREFLIGHT_SCREEN_CMD，默认 powershell），工作根走 DSH_VERIFY_WORK_ROOT。
//     本库不访问网络、不读真实凭据；真实 home 只用来判断隔离是否成立。
//   - 每个检查自己 catch 异常并落成 ok=false + 中文原因，不让一项失败把整段回执打没——
//     人看回执就知道哪几项红了、各自期望什么。
//   - 回执 stdout 只有一段 JSON；失败时命令另往 stderr 写一行汇总，把硬项 id 与中文名都点到。
//
// 九项硬检查与 id 是对外契约（门禁与批次开始评论按 id 引用），改 id 等于改接口：
//   candidate        候选包身份（candidate.json 里的提交与 tgz SHA256）
//   isolation-home   隔离 home 与 profile
//   workspace        工作区文件与 git remote
//   glab             glab 版本与认证
//   sandbox-project  沙箱项目 id 与状态
//   ticket-pool      票池数量
//   log-dir          日志目录可写
//   screen           屏幕分辨率与主屏
//   node             Node 版本

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureDir, exists, isDir, nowIso, sha256File } from './util.mts'
import { realDshHome, workRoot } from './paths.mts'
import { findInstalledPackage } from './candidate.mts'
import { batchManifestPath, readBatchManifest } from './gitlab-projects.mts'
import type { GitlabProjectRecord } from './gitlab-projects.mts'
import { readSeedManifest, seedManifestPath } from './seed-gitlab.mts'

/** 本库唯一读的插件名：隔离 profile 里必须找得到它，才算「插件已装」。 */
export const PLUGIN_NAME = 'dsh-mattpocock-skills-deck'

/** 预检回执的 schema 版本；字段形状一改就加一，门禁与批次评论都按它读。 */
export const PREFLIGHT_SCHEMA_VERSION = 1

/** 预检命令的仓库内路径，写进回执的 tool 字段，方便下一个人直接找到是谁生成的。 */
export const PREFLIGHT_TOOL = 'scripts/real-machine/commands/preflight.mts'

/** 九项硬检查的稳定 id，顺序就是回执 items 的顺序（门禁与评论按这个顺序读）。 */
export const PREFLIGHT_ITEM_IDS = [
  'candidate',
  'isolation-home',
  'workspace',
  'glab',
  'sandbox-project',
  'ticket-pool',
  'log-dir',
  'screen',
  'node',
]

/** 每项检查的中文名；人读回执与 stderr 汇总都用它，改文案不影响 id。 */
export const PREFLIGHT_ITEM_NAMES: Record<string, string> = {
  candidate: '候选包身份（candidate.json 提交与 tgz SHA256）',
  'isolation-home': '隔离 home 与 profile',
  workspace: '工作区文件与 git remote',
  glab: 'glab 版本与认证',
  'sandbox-project': '沙箱项目 id 与状态',
  'ticket-pool': '票池数量',
  'log-dir': '日志目录可写',
  screen: '屏幕分辨率与主屏',
  node: 'Node 版本',
}

export interface PreflightItem {
  /** 稳定 id，见 PREFLIGHT_ITEM_IDS。 */
  id: string
  /** 中文名。 */
  name: string
  /** 是否硬项：硬项失败整批不许开始，退出码非 0。 */
  hard: boolean
  ok: boolean
  /** 失败原因：写清期望与实际差在哪；通过时是空字符串。 */
  reason: string
  /** 供人复核的实测细节。 */
  details: Record<string, unknown>
}

export interface PreflightSummary {
  total: number
  hard: number
  hardFailed: number
  soft: number
  softFailed: number
}

export interface PreflightReport {
  schemaVersion: number
  tool: string
  generatedAt: string
  batch: { dir: string; name: string; workRoot: string }
  ok: boolean
  summary: PreflightSummary
  items: PreflightItem[]
  /** 同一段 JSON 也写进这个文件（默认 <批次目录>/preflight.json）。 */
  outPath: string
}

export interface PreflightOptions {
  /** 批次目录（必填）：候选、home、工作区、项目清单、种子清单都从这里找。 */
  batchDir: string
  /** candidate.json 路径；缺省 <工作根>/pkg/candidate.json。 */
  candidatePath?: string
  /** 隔离 home 路径；缺省 <批次目录>/homes/instance-a。 */
  home?: string
  /** profile 名；缺省 web。 */
  profile?: string
  /** 工作区路径；缺省先找 <批次目录>/fixtures/workspace，再找 <批次目录>/workspaces 下唯一子目录。 */
  workspace?: string
  /** 要核对的沙箱项目 id；缺省取批次清单里第一个状态 created 且有 id 的项目。 */
  projectId?: number
  /** 票池下限；缺省 101（B2 批次口径）。 */
  minTickets?: number
  /** 日志目录；缺省 <批次目录>/run-a。 */
  logDir?: string
  /** Node 最低版本；缺省 24.15.0（本地验证链的下限）。 */
  nodeMin?: string
  /** 取屏幕信息的命令；缺省读 DSH_PREFLIGHT_SCREEN_CMD，再缺省 powershell。 */
  screenCommand?: string
  /** 回执落盘路径；缺省 <批次目录>/preflight.json。 */
  outPath?: string
  /** 工作根覆盖；缺省走 paths.workRoot()。测试与命令都从环境变量注入，这里留给同进程调用。 */
  workRootOverride?: string
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 一个检查的结果：没失败时只给 details，失败时再给一句写清期望与实际的中文原因。 */
interface CheckOutcome {
  ok: boolean
  reason: string
  details: Record<string, unknown>
}

function pass(details: Record<string, unknown>): CheckOutcome {
  return { ok: true, reason: '', details }
}

function fail(details: Record<string, unknown>, reason: string): CheckOutcome {
  return { ok: false, reason, details }
}

/** 读一份 JSON 文件；解析失败抛中文错误，由调用方落成该项失败。 */
function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 路径是不是落在某个根之内（相等不算之内，批次根本身不能当 home/工作区）。 */
function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative) return false
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isUnderOrEqual(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** 把 argv 拼成一行人能直接抄去复跑的命令；只用于写 details / 错误信息。 */
function displayArgv(argv: string[]): string {
  return argv.map((item) => (item.includes(' ') ? '"' + item + '"' : item)).join(' ')
}

interface GlabRun {
  exitCode: number
  stdout: string
  stderr: string
  display: string
}

/**
 * 起一次 glab。写法与 scripts/real-machine/lib/gitlab-projects.mts 一致：
 * GLAB_BIN 缺省 glab；Windows 的 .cmd/.bat 经 ComSpec；退出码拿不到按 1 算（没跑起来就是失败）。
 */
function runGlab(args: string[]): GlabRun {
  const bin = process.env.GLAB_BIN || 'glab'
  const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const executable = isBatch ? process.env.ComSpec || 'cmd.exe' : bin
  const argv = isBatch ? ['/d', '/c', bin].concat(args) : args
  const result = spawnSync(executable, argv, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  })
  let stderr = result.stderr || ''
  if (result.error) stderr = stderr + (stderr ? '\n' : '') + '[preflight] 起 glab 失败：' + result.error.message
  const exitCode = typeof result.status === 'number' ? result.status : 1
  return { exitCode, stdout: result.stdout || '', stderr, display: displayArgv([bin].concat(args)) }
}

// ── 候选包身份 ───────────────────────────────────────────────────────────────

/** 从 candidate.json 里读候选版本，供隔离 home 项核对已装插件版本；读不到返回 null（交给 candidate 项报红）。 */
function readCandidateVersion(candidatePath: string): string | null {
  try {
    const record = asRecord(readJsonFile(candidatePath))
    const version = stringOf(record ? record.version : '')
    return version || null
  } catch {
    return null
  }
}

function checkCandidate(options: ResolvedOptions): CheckOutcome {
  const details: Record<string, unknown> = { path: options.candidatePath }
  if (!exists(options.candidatePath)) {
    return fail(details, 'candidate.json 不存在：期望有冻结候选清单 ' + options.candidatePath + '，实际文件不在（先跑 freeze-candidate）')
  }
  let parsed: unknown
  try {
    parsed = readJsonFile(options.candidatePath)
  } catch (error) {
    return fail(details, 'candidate.json 读不懂：期望是 freeze-candidate 写的 JSON，实际解析失败（' + messageOf(error) + '）')
  }
  const record = asRecord(parsed)
  if (!record) return fail(details, 'candidate.json 形状不对：期望 JSON 对象，实际是 ' + (Array.isArray(parsed) ? '数组' : typeof parsed))
  const git = asRecord(record.git)
  const pkg = asRecord(record.package)
  const commit = stringOf(git ? git.commit : '')
  const version = stringOf(record.version)
  const declaredSha = stringOf(pkg ? pkg.tgzSha256 : '')
  const rawTgzPath = stringOf(pkg ? pkg.tgzPath : '')
  const tgzPath = rawTgzPath ? (path.isAbsolute(rawTgzPath) ? rawTgzPath : path.resolve(path.dirname(options.candidatePath), rawTgzPath)) : ''
  details.commit = commit
  details.version = version
  details.tgzPath = tgzPath
  details.tgzSha256Declared = declaredSha
  const problems: string[] = []
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    problems.push('candidate.json 的 git.commit 期望 40 位十六进制提交哈希，实际是「' + (commit || '（空）') + '」')
  }
  if (!/^[0-9a-f]{64}$/i.test(declaredSha)) {
    problems.push('candidate.json 的 package.tgzSha256 期望 64 位十六进制 SHA256，实际是「' + (declaredSha || '（空）') + '」')
  }
  if (!rawTgzPath) {
    problems.push('candidate.json 的 package.tgzPath 是空的：期望指到冻结的候选 tgz 文件')
  } else if (!exists(tgzPath)) {
    problems.push('候选 tgz 文件不存在：candidate.json 写的是「' + tgzPath + '」，实际找不到这个文件')
  } else {
    let actualSha = ''
    try {
      actualSha = sha256File(tgzPath)
    } catch (error) {
      problems.push('候选 tgz 读不出来：期望能算 SHA256，实际读失败（' + messageOf(error) + '）')
    }
    details.tgzSha256Actual = actualSha
    details.hashMatches = actualSha !== '' && actualSha === declaredSha
    if (actualSha && actualSha !== declaredSha) {
      problems.push('候选 tgz 的 SHA256 与清单不一致：期望 ' + declaredSha + '，实际 ' + actualSha)
    }
    try {
      details.tgzBytesActual = fs.statSync(tgzPath).size
    } catch {
      details.tgzBytesActual = null
    }
    details.tgzBytesDeclared = numberOrNull(pkg ? pkg.tgzBytes : null)
    details.filename = stringOf(pkg ? pkg.filename : '')
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  return pass(details)
}

// ── 隔离 home 与 profile ─────────────────────────────────────────────────────

function checkIsolationHome(options: ResolvedOptions): CheckOutcome {
  const home = options.home
  const profile = options.profile
  const profileDir = path.join(home, 'profiles', profile)
  const realHome = realDshHome()
  const details: Record<string, unknown> = { home, profile, profileDir, realHome }
  const problems: string[] = []
  if (!isDir(home)) {
    return fail(details, '隔离 home 不存在：期望有本批次的 home 目录 ' + home + '，实际目录不在（先 copy-home）')
  }
  if (!isDir(profileDir)) {
    problems.push('隔离 home 里没有 profile「' + profile + '」：期望目录 ' + profileDir + ' 存在，实际不在')
  }
  const isolated = !isUnderOrEqual(realHome, home)
  details.isolated = isolated
  details.isolatedReason = isolated
    ? 'home 既不是真实用户 home，也不在它下面，不会读写真实 DSH 配置'
    : 'home 落在真实用户 home「' + realHome + '」或其子目录里，会污染真实 DSH 配置'
  if (!isolated) {
    problems.push('隔离 home 位置不对：期望落在批次目录或验证工作根之内、且不碰真实用户目录，实际是 ' + home + '（真实 home 是 ' + realHome + '）')
  }
  const insideRoots = [options.batchDir, options.workRoot].filter((root) => isInside(root, home))
  details.insideCertificateRoot = insideRoots.length > 0
  if (insideRoots.length === 0) {
    problems.push('隔离 home 不在批次目录或验证工作根之内：期望在「' + options.batchDir + '」或「' + options.workRoot + '」之下，实际是 ' + home)
  }
  const installed = findInstalledPackage(home, profile, PLUGIN_NAME)
  details.installed = installed
    ? { dir: installed.dir, version: installed.version, versionConstant: installed.versionConstant, clientSha256: installed.clientSha256 }
    : null
  const candidateVersion = readCandidateVersion(options.candidatePath)
  details.candidateVersion = candidateVersion
  if (!installed) {
    problems.push('profile 里没有已装的插件：期望 ' + path.join(profileDir, 'node_modules', PLUGIN_NAME, 'package.json') + ' 与 lib/client.js 都在（先 copy-home 并确认插件已装）')
  } else if (candidateVersion) {
    const versionMatches = installed.version === candidateVersion
    details.versionMatches = versionMatches
    if (!versionMatches) {
      problems.push('已装插件版本与候选不一致：期望「' + candidateVersion + '」，实际「' + installed.version + '」')
    }
  } else {
    details.versionMatches = null
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  return pass(details)
}

// ── 工作区文件与 git remote ──────────────────────────────────────────────────

function readOrigin(workspaceDir: string, details: Record<string, unknown>): { origin: string; problem: string } {
  const result = spawnSync('git', ['-C', workspaceDir, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  })
  if (result.error) {
    return { origin: '', problem: '读不到工作区的 git remote：期望本机能跑 git 命令，实际起不来（' + result.error.message + '）' }
  }
  const stdout = String(result.stdout || '').trim()
  const stderr = String(result.stderr || '').trim()
  details.originExitCode = typeof result.status === 'number' ? result.status : null
  if (typeof result.status !== 'number' || result.status !== 0 || !stdout) {
    return {
      origin: '',
      problem: '工作区没有名为 origin 的 remote：期望 git remote get-url origin 成功并输出项目地址，实际退出码 ' + String(result.status) + (stderr ? '，stderr：' + stderr : ''),
    }
  }
  return { origin: stdout, problem: '' }
}

function checkWorkspace(options: ResolvedOptions): CheckOutcome {
  const details: Record<string, unknown> = {}
  let workspaceDir = options.workspace
  if (!workspaceDir) {
    const fixturesDir = path.join(options.batchDir, 'fixtures', 'workspace')
    const workspacesDir = path.join(options.batchDir, 'workspaces')
    const candidates = isDir(workspacesDir)
      ? fs
          .readdirSync(workspacesDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(workspacesDir, entry.name))
      : []
    if (isDir(fixturesDir)) {
      workspaceDir = fixturesDir
    } else if (candidates.length === 1) {
      workspaceDir = candidates[0]
    } else {
      details.candidates = candidates
      return fail(
        details,
        '找不到本批工作区：期望 --workspace 指到工作区，或 <批次目录>/fixtures/workspace 存在，或 <批次目录>/workspaces 下正好一个工作区；实际候选是 ' + (candidates.length === 0 ? '（空）' : candidates.join('、')),
      )
    }
  }
  details.dir = workspaceDir
  const problems: string[] = []
  if (!isDir(workspaceDir)) {
    return fail(details, '工作区目录不存在：期望有本地工作区目录 ' + workspaceDir + '，实际不在（先跑 make-workspace）')
  }
  if (!isDir(path.join(workspaceDir, '.git'))) {
    problems.push('工作区里没有 .git：期望 ' + path.join(workspaceDir, '.git') + ' 存在（make-workspace 生成的本地仓库）')
  }
  const workspaceFile = path.join(workspaceDir, 'docs', 'agents', 'workspace.yaml')
  details.workspaceFile = workspaceFile
  if (!exists(workspaceFile)) {
    problems.push('工作区缺 docs/agents/workspace.yaml：期望文件存在并写着 backendId: gitlab，实际不在')
  } else {
    let text = ''
    try {
      text = fs.readFileSync(workspaceFile, 'utf8')
    } catch (error) {
      problems.push('workspace.yaml 读不出来：期望能读文本，实际失败（' + messageOf(error) + '）')
    }
    const match = /^backendId:\s*(\S+)/m.exec(text)
    const backendId = match ? match[1] : ''
    details.backendId = backendId
    if (backendId !== 'gitlab') {
      problems.push('workspace.yaml 的 backendId 不对：期望 gitlab，实际是「' + (backendId || '（没找到 backendId 这一行）') + '」')
    }
  }
  const originResult = readOrigin(workspaceDir, details)
  details.origin = originResult.origin
  if (originResult.problem) problems.push(originResult.problem)
  const picked = pickProjectRecord(options)
  details.expectedRemote = picked.record ? picked.record.remoteUrl : ''
  if (picked.record && originResult.origin) {
    const remoteMatches = originResult.origin === picked.record.remoteUrl
    details.remoteMatches = remoteMatches
    if (!remoteMatches) {
      problems.push('工作区 origin 与批次项目清单不一致：期望「' + picked.record.remoteUrl + '」，实际「' + originResult.origin + '」')
    }
  } else {
    details.remoteMatches = null
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  return pass(details)
}

// ── glab 版本与认证 ──────────────────────────────────────────────────────────

function checkGlab(): CheckOutcome {
  const details: Record<string, unknown> = {}
  const versionRun = runGlab(['--version'])
  details.versionCommand = versionRun.display
  details.versionExitCode = versionRun.exitCode
  details.versionText = versionRun.stdout.trim() || versionRun.stderr.trim()
  if (versionRun.exitCode !== 0) {
    return fail(
      details,
      'glab --version 失败：期望退出码 0，实际 ' + String(versionRun.exitCode) + (versionRun.stderr.trim() ? '，stderr：' + versionRun.stderr.trim() : '') + '（确认 GLAB_BIN 指到 glab 可执行文件）',
    )
  }
  const versionMatch = /(\d+)\.(\d+)\.(\d+)/.exec(versionRun.stdout)
  details.version = versionMatch ? versionMatch[1] + '.' + versionMatch[2] + '.' + versionMatch[3] : ''
  if (!versionMatch) {
    return fail(
      details,
      'glab --version 的输出里读不出版本号：期望形如「glab version 1.50.0」，实际是「' + (versionRun.stdout.trim() || '（空）') + '」',
    )
  }
  const authRun = runGlab(['auth', 'status'])
  const authText = (authRun.stdout + '\n' + authRun.stderr).trim()
  details.authCommand = authRun.display
  details.authExitCode = authRun.exitCode
  details.authText = authText.slice(0, 2000)
  const authMatch = /Logged in to ([^\s]+) as ([^\s(]+)/.exec(authText)
  if (authRun.exitCode !== 0 || !authMatch) {
    return fail(
      details,
      'glab 未认证：期望 glab auth status 退出码 0 且输出「Logged in to gitlab.com as <账号>」，实际退出码 ' +
        String(authRun.exitCode) +
        '、输出「' +
        (authText || '（空）') +
        '」（先在本机登录 gitlab.com）',
    )
  }
  const host = authMatch[1]
  const account = authMatch[2]
  details.authenticated = true
  details.host = host
  details.account = account
  if (!host.includes('gitlab.com')) {
    return fail(details, 'glab 登录的站点不对：期望 gitlab.com，实际是「' + host + '」')
  }
  return pass(details)
}

// ── 沙箱项目 id 与状态 ───────────────────────────────────────────────────────

interface PickedProject {
  manifestPath: string
  record: GitlabProjectRecord | null
  problem: string
  projects: GitlabProjectRecord[]
}

/** 从批次清单里挑项目：显式 --project-id 优先，否则第一个 status=created 且有 id 的。 */
function pickProjectRecord(options: ResolvedOptions): PickedProject {
  const manifestPath = batchManifestPath(options.batchDir)
  const empty: PickedProject = { manifestPath, record: null, problem: '', projects: [] }
  if (!exists(manifestPath)) {
    return Object.assign(empty, {
      problem: '批次项目清单不存在：期望 ' + manifestPath + ' 存在（先跑 gitlab-sandbox create）',
    })
  }
  let manifest
  try {
    manifest = readBatchManifest(options.batchDir)
  } catch (error) {
    return Object.assign(empty, { problem: '批次项目清单读不懂：期望是 gitlab-sandbox 写的 JSON，实际解析失败（' + messageOf(error) + '）' })
  }
  if (!manifest || !Array.isArray(manifest.projects)) {
    return Object.assign(empty, { problem: '批次项目清单里没有 projects 数组：期望至少一个沙箱项目记录' })
  }
  const projects = manifest.projects
  const result: PickedProject = { manifestPath, record: null, problem: '', projects }
  if (typeof options.projectId === 'number') {
    const wanted = options.projectId
    const found = projects.find((item) => item.id === wanted) || null
    if (!found) return Object.assign(result, { problem: '批次项目清单里没有 id 为 ' + String(wanted) + ' 的项目' })
    result.record = found
    return result
  }
  const created = projects.find((item) => item.status === 'created' && typeof item.id === 'number') || null
  if (!created) {
    const visible = projects.map((item) => String(item.id) + '（' + item.status + '）').join('、')
    return Object.assign(result, { problem: '批次项目清单里没有状态 created 且有 id 的项目：实际记录是 ' + (visible || '（空）') })
  }
  result.record = created
  return result
}

function checkSandboxProject(options: ResolvedOptions): CheckOutcome {
  const picked = pickProjectRecord(options)
  const details: Record<string, unknown> = {
    manifestPath: picked.manifestPath,
    projectCount: picked.projects.length,
  }
  if (!picked.record) {
    details.status = null
    return fail(details, picked.problem)
  }
  const record = picked.record
  details.status = record.status
  details.manifestRecord = {
    id: record.id,
    pathWithNamespace: record.pathWithNamespace,
    webUrl: record.webUrl,
    status: record.status,
    markedForDeletionAt: record.markedForDeletionAt,
  }
  const problems: string[] = []
  if (typeof record.id !== 'number' || !Number.isInteger(record.id) || record.id <= 0) {
    return fail(details, '批次项目清单里这个项目没有可用 id：期望正整数，实际是 ' + String(record.id) + '')
  }
  if (record.status !== 'created') {
    problems.push('批次清单里项目状态不是 created：期望 created，实际是「' + String(record.status) + '」')
  }
  const readback = runGlab(['api', 'projects/' + String(record.id)])
  details.readbackCommand = readback.display
  details.readbackExitCode = readback.exitCode
  if (readback.exitCode !== 0) {
    return fail(
      details,
      'glab api projects/' + String(record.id) + ' 读回失败：期望退出码 0，实际 ' + String(readback.exitCode) + (readback.stderr.trim() ? '，stderr：' + readback.stderr.trim() : ''),
    )
  }
  let api: Record<string, unknown> | null = null
  try {
    api = asRecord(readJsonText(readback.stdout))
  } catch (error) {
    return fail(details, 'glab api 读回的项目不是合法 JSON：期望 projects API 的 JSON 对象，实际解析失败（' + messageOf(error) + '）')
  }
  if (!api) return fail(details, 'glab api 读回的项目形状不对：期望 JSON 对象，实际是数组或空值')
  const apiId = numberOrNull(api.id)
  const apiPath = stringOf(api.path_with_namespace)
  const apiWebUrl = stringOf(api.web_url)
  const markedAt = stringOf(api.marked_for_deletion_at)
  const markedByName = [stringOf(api.name), stringOf(api.path), apiPath].join(' ').includes('-deletion_scheduled-')
  const markedForDeletion = markedAt !== '' || markedByName
  details.readback = {
    id: apiId,
    pathWithNamespace: apiPath,
    webUrl: apiWebUrl,
    markedForDeletion,
    markedForDeletionAt: markedAt || null,
    state: markedForDeletion ? 'marked-for-deletion' : stringOf(api.state) || 'active',
  }
  if (markedForDeletion) {
    problems.push('项目已被标记删除：期望项目正常可用，实际读回 marked_for_deletion_at=' + (markedAt || '（路径带 -deletion_scheduled-）'))
  }
  if (apiId !== record.id) {
    problems.push('读回的项目 id 与批次清单不一致：期望 ' + String(record.id) + '，实际 ' + String(apiId))
  }
  if (apiPath && record.pathWithNamespace && apiPath !== record.pathWithNamespace) {
    problems.push('读回的 path_with_namespace 与批次清单不一致：期望「' + record.pathWithNamespace + '」，实际「' + apiPath + '」')
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  details.webUrl = apiWebUrl
  return pass(details)
}

/** 把一段字符串当 JSON 读；glab 有时在 JSON 前后混一行提示，取第一段 {...} 再解析。 */
function readJsonText(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('没有 JSON 对象')
  }
}

// ── 票池数量 ─────────────────────────────────────────────────────────────────

function checkTicketPool(options: ResolvedOptions): CheckOutcome {
  const file = seedManifestPath(options.batchDir)
  const details: Record<string, unknown> = { seedManifestPath: file, minTickets: options.minTickets }
  if (!exists(file)) {
    return fail(details, '种子清单不存在：期望 ' + file + ' 存在（先跑 seed-gitlab 种票）')
  }
  let seed
  try {
    seed = readSeedManifest(file)
  } catch (error) {
    return fail(details, messageOf(error))
  }
  if (!seed) return fail(details, '种子清单不存在：期望 ' + file + ' 存在（先跑 seed-gitlab 种票）')
  const issues = Array.isArray(seed.issues) ? seed.issues : []
  const stats = asRecord(seed.stats)
  const fromArray = issues.length
  const fromStats = numberOrNull(stats ? stats.issues : null)
  const count = fromArray > 0 ? fromArray : fromStats !== null ? fromStats : -1
  details.count = count
  details.source = fromArray > 0 ? '种子清单 issues 数组长度' : '种子清单 stats.issues'
  details.mode = seed.mode
  details.stats = stats
  const problems: string[] = []
  if (count < 0) {
    problems.push('种子清单里数不出票数：期望 issues 数组或 stats.issues 给出正整数，实际都没有')
  } else if (count < options.minTickets) {
    problems.push('票池数量不足：期望至少 ' + String(options.minTickets) + ' 张票（--min-tickets），实际种子清单里是 ' + String(count) + ' 张')
  }
  // 独立读回：能用 glab api 再数一遍就记在 details 里；读不到不单独判红（票数已由种子清单核对），
  // 但读到数与清单不一致时这一项也判红，防止清单写得好好的、远端池子却是空的。
  const project = asRecord(seed.project)
  const projectId = numberOrNull(project ? project.id : null)
  if (projectId !== null) {
    const source = 'glab api projects/' + String(projectId) + '/issues_statistics'
    const run = runGlab(['api', 'projects/' + String(projectId) + '/issues_statistics'])
    const readback: Record<string, unknown> = { ok: false, source }
    if (run.exitCode === 0) {
      try {
        const api = asRecord(readJsonText(run.stdout))
        const statistics = asRecord(api ? api.statistics : null)
        const counts = asRecord(statistics ? statistics.counts : null)
        const all = numberOrNull(counts ? counts.all : null)
        if (all !== null) {
          readback.ok = true
          readback.count = all
          readback.matchesManifest = count === all
          if (count >= 0 && all !== count) {
            problems.push('独立读回的票数与种子清单不一致：清单 ' + String(count) + ' 张，glab api 读回 ' + String(all) + ' 张')
          }
        } else {
          readback.error = '读回的 JSON 里没有 statistics.counts.all'
        }
      } catch (error) {
        readback.error = '读回内容不是合法 JSON：' + messageOf(error)
      }
    } else {
      readback.error = 'glab api 退出码 ' + String(run.exitCode) + (run.stderr.trim() ? '：' + run.stderr.trim() : '')
    }
    details.independentReadback = readback
  } else {
    details.independentReadback = { ok: false, source: '', error: '种子清单里没有 project.id，没法独立读回票数' }
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  return pass(details)
}

// ── 日志目录可写 ─────────────────────────────────────────────────────────────

function checkLogDir(options: ResolvedOptions): CheckOutcome {
  const logDir = options.logDir
  const details: Record<string, unknown> = {
    logDir,
    startupDir: path.join(options.batchDir, 'run-a'),
    existsBefore: isDir(logDir),
    created: false,
    written: false,
    deleted: false,
  }
  const problems: string[] = []
  try {
    ensureDir(logDir)
    details.created = true
  } catch (error) {
    return fail(details, '日志目录不可写：期望能创建目录 ' + logDir + '，实际创建失败（' + messageOf(error) + '）')
  }
  const probeFile = path.join(logDir, '.preflight-probe-' + String(Date.now()) + '.tmp')
  details.probeFile = probeFile
  try {
    fs.writeFileSync(probeFile, 'preflight probe\n', 'utf8')
    details.written = true
  } catch (error) {
    return fail(details, '日志目录不可写：期望能在 ' + logDir + ' 里写探针文件 ' + probeFile + '，实际写入失败（' + messageOf(error) + '）')
  }
  try {
    fs.rmSync(probeFile, { force: true })
    details.deleted = true
  } catch (error) {
    problems.push('日志目录写进去的探针文件删不掉：期望删除 ' + probeFile + ' 成功，实际失败（' + messageOf(error) + '）')
  }
  if (problems.length > 0) return fail(details, problems.join('；'))
  return pass(details)
}

// ── 屏幕分辨率与主屏 ─────────────────────────────────────────────────────────

/**
 * 用系统命令取显示器信息（Windows 上是 System.Windows.Forms.Screen.AllScreens）。
 * 只取「批次开始时刻的宿主显示状态」，作为人读证据；真正视口以 page-diagnostics.json 为准。
 * 命令路径可注入：门禁用假命令替换，不依赖本机有没有显示器。
 */
const SCREEN_SCRIPT =
  'Add-Type -AssemblyName System.Windows.Forms; ' +
  '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { ' +
  '[pscustomobject]@{ deviceName = $_.DeviceName; width = $_.Bounds.Width; height = $_.Bounds.Height; primary = $_.Primary } ' +
  '} | ConvertTo-Json -Compress'

interface ScreenDevice {
  deviceName: string
  width: number
  height: number
  primary: boolean
}

function parseScreenDevice(value: unknown): ScreenDevice | null {
  const record = asRecord(value)
  if (!record) return null
  const deviceName = stringOf(record.deviceName) || stringOf(record.DeviceName)
  const width = numberOrNull(record.width !== undefined ? record.width : record.Width)
  const height = numberOrNull(record.height !== undefined ? record.height : record.Height)
  const primaryRaw = record.primary !== undefined ? record.primary : record.Primary
  if (typeof primaryRaw !== 'boolean') return null
  if (width === null || height === null || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
  return { deviceName, width, height, primary: primaryRaw }
}

function checkScreen(options: ResolvedOptions): CheckOutcome {
  const command = options.screenCommand
  const args = ['-NoProfile', '-Command', SCREEN_SCRIPT]
  const details: Record<string, unknown> = { command, argsScript: SCREEN_SCRIPT }
  const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const executable = isBatch ? process.env.ComSpec || 'cmd.exe' : command
  const argv = isBatch ? ['/d', '/c', command].concat(args) : args
  let result
  try {
    result = spawnSync(executable, argv, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    return fail(details, '屏幕命令起不来：期望命令 ' + command + ' 可执行，实际抛出错误（' + messageOf(error) + '）')
  }
  details.exitCode = typeof result.status === 'number' ? result.status : null
  const stderr = String(result.stderr || '')
  if (result.error) {
    return fail(details, '屏幕命令起不来：期望命令「' + command + '」可执行，实际错误（' + result.error.message + '）（Windows 上要能跑 powershell；门禁里用 --screen-cmd 或 DSH_PREFLIGHT_SCREEN_CMD 注入假命令）')
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    return fail(
      details,
      '屏幕命令失败：期望退出码 0，实际 ' + String(result.status) + (stderr.trim() ? '，stderr：' + stderr.trim() : '') + '（命令是「' + command + '」）',
    )
  }
  const raw = String(result.stdout || '').trim()
  details.raw = raw.slice(0, 2000)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail(
      details,
      '屏幕命令的输出读不懂：期望一段 JSON（显示器数组，字段 deviceName/width/height/primary），实际是「' + (raw || '（空）') + '」',
    )
  }
  const rawDevices = Array.isArray(parsed) ? parsed : [parsed]
  const devices: ScreenDevice[] = []
  for (const item of rawDevices) {
    const device = parseScreenDevice(item)
    if (device) devices.push(device)
  }
  details.devices = devices
  if (devices.length === 0) {
    return fail(details, '屏幕命令没返回可用的显示器信息：期望每台设备都有正整数 width/height 与布尔 primary，实际一台都解析不出来（原始输出「' + (raw.slice(0, 500) || '（空）') + '」）')
  }
  const primaries = devices.filter((device) => device.primary)
  if (primaries.length !== 1) {
    return fail(details, '主屏数量不对：期望恰好 1 台 primary=true 的显示器，实际 ' + String(primaries.length) + ' 台（原始输出「' + raw.slice(0, 500) + '」）')
  }
  details.primaryDevice = primaries[0]
  return pass(details)
}

// ── Node 版本 ────────────────────────────────────────────────────────────────

interface VersionTriple {
  major: number
  minor: number
  patch: number
}

function parseVersionTriple(text: string): VersionTriple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareVersion(left: VersionTriple, right: VersionTriple): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

function checkNode(options: ResolvedOptions): CheckOutcome {
  const version = process.versions.node
  const minimum = options.nodeMin
  const details: Record<string, unknown> = { version, minimum, platform: process.platform, arch: process.arch }
  const actual = parseVersionTriple(version)
  const wanted = parseVersionTriple(minimum)
  if (!wanted) {
    return fail(details, '--node-min 不是一个版本号：期望形如 24.15.0，实际是「' + minimum + '」')
  }
  if (!actual) {
    return fail(details, '当前 Node 版本读不出来：期望形如 24.19.0，实际是「' + version + '」')
  }
  details.compare = compareVersion(actual, wanted)
  if (compareVersion(actual, wanted) < 0) {
    return fail(details, 'Node 版本太低：期望 >= ' + minimum + '，实际是 ' + version + '（本地验证链要求 Node 24.15 及以上）')
  }
  return pass(details)
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────

interface ResolvedOptions {
  batchDir: string
  workRoot: string
  candidatePath: string
  home: string
  profile: string
  workspace: string
  projectId: number | undefined
  minTickets: number
  logDir: string
  nodeMin: string
  screenCommand: string
  outPath: string
}

function resolveOptions(options: PreflightOptions): ResolvedOptions {
  const batchDir = path.resolve(options.batchDir)
  const root = options.workRootOverride ? path.resolve(options.workRootOverride) : workRoot()
  const minTickets = typeof options.minTickets === 'number' && Number.isFinite(options.minTickets) ? options.minTickets : 101
  return {
    batchDir,
    workRoot: root,
    candidatePath: options.candidatePath ? path.resolve(options.candidatePath) : path.join(root, 'pkg', 'candidate.json'),
    home: options.home ? path.resolve(options.home) : path.join(batchDir, 'homes', 'instance-a'),
    profile: options.profile || 'web',
    workspace: options.workspace ? path.resolve(options.workspace) : '',
    projectId: options.projectId,
    minTickets,
    logDir: options.logDir ? path.resolve(options.logDir) : path.join(batchDir, 'run-a'),
    nodeMin: options.nodeMin || '24.15.0',
    screenCommand: options.screenCommand || process.env.DSH_PREFLIGHT_SCREEN_CMD || 'powershell',
    outPath: options.outPath ? path.resolve(options.outPath) : path.join(batchDir, 'preflight.json'),
  }
}

/** 跑一遍九项硬检查，返回完整回执（含 ok、summary、outPath）。检查抛出的异常一律落成该项失败。 */
export function runPreflight(options: PreflightOptions): PreflightReport {
  const resolved = resolveOptions(options)
  const checks: Array<{ id: string; run: () => CheckOutcome }> = [
    { id: 'candidate', run: () => checkCandidate(resolved) },
    { id: 'isolation-home', run: () => checkIsolationHome(resolved) },
    { id: 'workspace', run: () => checkWorkspace(resolved) },
    { id: 'glab', run: () => checkGlab() },
    { id: 'sandbox-project', run: () => checkSandboxProject(resolved) },
    { id: 'ticket-pool', run: () => checkTicketPool(resolved) },
    { id: 'log-dir', run: () => checkLogDir(resolved) },
    { id: 'screen', run: () => checkScreen(resolved) },
    { id: 'node', run: () => checkNode(resolved) },
  ]
  const items: PreflightItem[] = []
  for (const check of checks) {
    let outcome: CheckOutcome
    try {
      outcome = check.run()
    } catch (error) {
      outcome = fail({}, '检查自己抛了异常：' + messageOf(error))
    }
    items.push({
      id: check.id,
      name: PREFLIGHT_ITEM_NAMES[check.id] || check.id,
      hard: true,
      ok: outcome.ok,
      reason: outcome.ok ? '' : outcome.reason || '检查失败，但没有给出原因',
      details: outcome.details,
    })
  }
  const hard = items.filter((item) => item.hard)
  const soft = items.filter((item) => !item.hard)
  const hardFailed = hard.filter((item) => !item.ok).length
  const softFailed = soft.filter((item) => !item.ok).length
  const summary: PreflightSummary = { total: items.length, hard: hard.length, hardFailed, soft: soft.length, softFailed }
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    tool: PREFLIGHT_TOOL,
    generatedAt: nowIso(),
    batch: { dir: resolved.batchDir, name: path.basename(resolved.batchDir), workRoot: resolved.workRoot },
    ok: hardFailed === 0,
    summary,
    items,
    outPath: resolved.outPath,
  }
}

/** 把回执写进 --out 指定的文件；命令与同进程调用共用这一段，保证 stdout 与文件内容一致。 */
export function writePreflightReport(report: PreflightReport): number {
  ensureDir(path.dirname(report.outPath))
  fs.writeFileSync(report.outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  return fs.statSync(report.outPath).size
}

/** 失败硬项的一行汇总，命令写到 stderr；门禁按它核对「点到了项名」。 */
export function hardFailureLine(report: PreflightReport): string {
  const failed = report.items.filter((item) => item.hard && !item.ok)
  if (failed.length === 0) return ''
  return (
    '[preflight] 硬项失败（' + String(failed.length) + '）：' +
    failed.map((item) => item.id + '（' + item.name + '）').join('、')
  )
}
