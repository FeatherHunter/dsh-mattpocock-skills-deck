// gitlab-projects.mts —— GitLab 沙箱项目的生命周期：建、删、读回、记账。
//
// 为什么要有这一层：真机验证要在 gitlab.com 上建一次性的私有项目，验证完删掉。但 glab 有两处
// 不能只信退出码的地方：
//   1. 建项目：Windows 本地经常报 unexpected EOF，服务器其实已经建好了；这时必须按 URL 编码后的
//      项目完整路径读回，读到就算建成，不能把 EOF 当失败去重试，否则账号里会留下重复项目。
//   2. 删项目：删除是延迟删除，glab 返回 202 Accepted 之后项目还在，只是多出 marked_for_deletion_at
//      字段、路径带 -deletion_scheduled-<id> 后缀；所以删完要按 id 读回这个字段才算完成，
//      不按 404 判、不重复发 DELETE。
//
// 另外两条安全规矩：
//   - 建和删的结果都写进 <批次目录>/gitlab-projects.json（批次清单），删除只认清单里记过的项目，
//     并校验读回来的项目描述里有本批次标记「[dsh-sandbox batch=<批次名>]」，避免误删别人的项目。
//   - 读回失败时保留项目 id（或建项目时保留完整路径）在清单里，命令以非 0 退出并把原因写清楚，
//     下一次重跑可以照清单接着处理，不会丢线索。
//
// 门禁只在命令行进程层测这层（tests/verify-1706-gitlab-project.ts 用假 glab 起子进程），
// 这里不额外提供给测试直接调用的接缝。

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { ensureDir, exists, nowIso, readJson, writeJson } from './util.mts'

/** 项目记录的状态：created=建好且读回过；create-unconfirmed=建过但读回失败（没有 id）；
 *  marked-for-deletion=已标记删除；delete-failed=删过但读回失败（id 还在清单里）。 */
export type GitlabProjectStatus = 'created' | 'create-unconfirmed' | 'marked-for-deletion' | 'delete-failed'

/** 批次清单里的一个沙箱项目。字段名与命令回执保持一致，便于人对着 JSON 核查。 */
export interface GitlabProjectRecord {
  id: number | null
  name: string
  path: string
  pathWithNamespace: string
  webUrl: string
  remoteUrl: string
  description: string
  marker: string | null
  batch: string
  status: GitlabProjectStatus
  createdAt: string
  markedForDeletionAt: string | null
  createExitCode: number | null
  recoveredByReadback: boolean
  lastError: string | null
}

/** <批次目录>/gitlab-projects.json：批次标记、生成时间与这个批次建过的全部项目。 */
export interface GitlabBatchManifest {
  version: 1
  batch: string
  batchDir: string
  marker: string
  generatedAt: string
  projects: GitlabProjectRecord[]
}

/** 命令回执里给会话看的那部分项目信息（不含清单内部字段）。 */
export interface GitlabProjectSummary {
  id: number | null
  path: string
  pathWithNamespace: string
  webUrl: string
  remoteUrl: string
  description: string
  marker: string | null
  status: GitlabProjectStatus
  markedForDeletionAt: string | null
}

export interface CreateSandboxResult {
  batch: string
  batchDir: string
  marker: string
  manifestPath: string
  reused: boolean
  createExitCode: number | null
  recoveredByReadback: boolean
  project: GitlabProjectSummary
}

export interface DeleteSandboxResult {
  batch: string
  batchDir: string
  marker: string
  manifestPath: string
  alreadyDeleted: boolean
  markedForDeletion: boolean
  deleteResponse: Record<string, unknown> | null
  project: GitlabProjectSummary
}

interface GlabRun {
  exitCode: number
  stdout: string
  stderr: string
}

/** Windows 上 GLAB_BIN 指向 .cmd 启动器（假 glab 就是这种）；这种文件不能直接 spawn，要经 ComSpec。 */
function runGlab(args: string[]): GlabRun {
  const bin = process.env.GLAB_BIN || 'glab'
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const options = { encoding: 'utf8' as const, windowsHide: true }
  const result = isWindowsScript
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', bin, ...args], options)
    : spawnSync(bin, args, options)
  const stderr = String(result.stderr || '') || (result.error ? String(result.error.message) : '')
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr,
  }
}

/** 批次标记：同一个批次目录里建的项目都带同一串，删除时据此确认是「我们自己的」项目。 */
export function sandboxMarker(batchName: string): string {
  return '[dsh-sandbox batch=' + batchName + ']'
}

/** 批次清单路径：<批次目录>/gitlab-projects.json。 */
export function batchManifestPath(batchDir: string): string {
  return path.join(path.resolve(batchDir), 'gitlab-projects.json')
}

/**
 * 校验并返回 GitLab 项目完整路径（group/project，group 可以多段）。
 * 参数里的 flagName 只用于错误信息：同一个校验给 create 的 --path 与 make-workspace 的 --project 用。
 */
export function assertProjectPath(value: string, flagName: string): string {
  const text = String(value == null ? '' : value).trim()
  const segments = text.split('/')
  const looksValid =
    text.length > 0 &&
    segments.length >= 2 &&
    segments.every((segment) => segment.trim().length > 0) &&
    !text.startsWith('/') &&
    !text.endsWith('/') &&
    !text.includes('\\') &&
    !/\s/.test(text)
  if (!looksValid) {
    throw new Error(
      flagName + '「' + text + '」不像 GitLab 项目完整路径：需要形如 group/project（group 可以有多段，例如 team/sub/project），不要带 https:// 前缀或空格。',
    )
  }
  return text
}

/** 读批次清单；文件不存在返回 null（还没建过项目），文件坏了给出能指路的错误。 */
export function readBatchManifest(batchDir: string): GitlabBatchManifest | null {
  const file = batchManifestPath(batchDir)
  if (!exists(file)) return null
  try {
    return readJson(file) as GitlabBatchManifest
  } catch (error: unknown) {
    throw new Error('批次清单「' + file + '」读不出来（JSON 坏了？）：' + messageOf(error) + '。请人工看一下这个文件。')
  }
}

function writeBatchManifest(manifest: GitlabBatchManifest): string {
  const file = batchManifestPath(manifest.batchDir)
  ensureDir(path.dirname(file))
  writeJson(file, manifest)
  return file
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 读回项目用 glab api 的引用：按 id 是 projects/<id>，按完整路径要 URL 编码斜杠。 */
function apiRefFor(ref: string | number): string {
  if (typeof ref === 'number') return 'projects/' + ref
  return 'projects/' + encodeURIComponent(ref)
}

/**
 * 按 id 或完整路径读回一个项目；读回失败直接抛中文错误（调用方决定是保留 id 报错还是继续）。
 * 返回的是 GitLab API 的原始对象，字段名保持 snake_case，避免这一层把「读回来的事实」改形。
 */
function readProject(ref: string | number): Record<string, unknown> {
  const apiRef = apiRefFor(ref)
  const run = runGlab(['api', apiRef])
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim() || run.stdout.trim() || '退出码 ' + run.exitCode
    throw new Error('读回项目「' + String(ref) + '」失败（glab api ' + apiRef + '）：' + detail)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch (error: unknown) {
    throw new Error('读回项目「' + String(ref) + '」失败：glab api ' + apiRef + ' 的输出不是 JSON：' + messageOf(error))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('读回项目「' + String(ref) + '」失败：glab api ' + apiRef + ' 的输出不是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

/** 从 API 对象取项目 id；没有 id 说明读回来的东西不是项目，直接报错而不是写 garbage 进清单。 */
function projectIdOf(api: Record<string, unknown>, ref: string): number {
  const id = numberField(api.id)
  if (id === null) throw new Error('读回项目「' + ref + '」失败：返回的 JSON 里没有数字 id，无法记账。')
  return id
}

/** 项目完整路径；老版本 API 字段是 path_with_namespace，缺了就用 path 兜底。 */
function projectFullPathOf(api: Record<string, unknown>, ref: string): string {
  const fullPath = stringField(api.path_with_namespace) || stringField(api.path)
  if (!fullPath) throw new Error('读回项目「' + ref + '」失败：返回的 JSON 里没有 path_with_namespace。')
  return fullPath
}

function isMarkedForDeletion(api: Record<string, unknown>): boolean {
  if (stringField(api.marked_for_deletion_at)) return true
  const names = [api.name, api.path, api.path_with_namespace].map((value) => String(value || '')).join(' ')
  return names.includes('-deletion_scheduled-')
}

/** 把 GitLab API 项目对象转成清单记录。host 固定 gitlab.com：本票只处理 gitlab.com 沙箱项目。 */
function recordFromApi(
  api: Record<string, unknown>,
  options: {
    ref: string
    batch: string
    marker: string
    status: GitlabProjectStatus
    createExitCode: number | null
    recoveredByReadback: boolean
  },
): GitlabProjectRecord {
  const id = projectIdOf(api, options.ref)
  const fullPath = projectFullPathOf(api, options.ref)
  const webUrl = stringField(api.web_url) || 'https://gitlab.com/' + fullPath
  const description = stringField(api.description) || ''
  return {
    id,
    name: stringField(api.name) || fullPath.split('/').pop() || fullPath,
    path: stringField(api.path) || fullPath.split('/').pop() || fullPath,
    pathWithNamespace: fullPath,
    webUrl,
    remoteUrl: webUrl.replace(/\/+$/, '') + '.git',
    description,
    marker: description.includes(options.marker) ? options.marker : null,
    batch: options.batch,
    status: options.status,
    createdAt: nowIso(),
    markedForDeletionAt: stringField(api.marked_for_deletion_at),
    createExitCode: options.createExitCode,
    recoveredByReadback: options.recoveredByReadback,
    lastError: null,
  }
}

function summaryOf(record: GitlabProjectRecord): GitlabProjectSummary {
  return {
    id: record.id,
    path: record.path,
    pathWithNamespace: record.pathWithNamespace,
    webUrl: record.webUrl,
    remoteUrl: record.remoteUrl,
    description: record.description,
    marker: record.marker,
    status: record.status,
    markedForDeletionAt: record.markedForDeletionAt,
  }
}

/** 新记录替换同 id 或同完整路径的旧记录；都没有就追加，保证清单里一个项目只有一条。 */
function upsertProject(manifest: GitlabBatchManifest, record: GitlabProjectRecord): void {
  const index = manifest.projects.findIndex((item) => {
    if (record.id !== null && item.id !== null) return item.id === record.id
    return item.pathWithNamespace.toLowerCase() === record.pathWithNamespace.toLowerCase()
  })
  if (index >= 0) manifest.projects[index] = record
  else manifest.projects.push(record)
}

function newManifest(batchDir: string, batchName: string, marker: string): GitlabBatchManifest {
  return {
    version: 1,
    batch: batchName,
    batchDir: path.resolve(batchDir),
    marker,
    generatedAt: nowIso(),
    projects: [],
  }
}

/** 默认项目描述：说明这是可删的验证夹具；自定义描述会拼在它后面，批次标记始终在最后。 */
function describeProject(base: string | undefined, marker: string): string {
  const prefix = (base || '').trim() || 'DSH GitLab 真机验证沙箱项目，验证完可删'
  return prefix + ' ' + marker
}

/**
 * 建一个沙箱项目（幂等）：先按完整路径查批次清单，已有记录就按 id 读回复用；
 * 否则跑 glab repo create，再不管本地退出码如何都按路径读回。读到就算建成，读不到就保留路径并报错。
 */
export async function createSandboxProject(options: {
  batchDir: string
  batchName?: string
  projectPath: string
  description?: string
}): Promise<CreateSandboxResult> {
  const batchDir = path.resolve(options.batchDir)
  const batchName = options.batchName || path.basename(batchDir)
  const marker = sandboxMarker(batchName)
  const fullPath = assertProjectPath(options.projectPath, '--path')
  const manifest = readBatchManifest(batchDir) || newManifest(batchDir, batchName, marker)

  const existing = manifest.projects.find((item) => item.pathWithNamespace.toLowerCase() === fullPath.toLowerCase())
  if (existing && existing.id === null) {
    // 上次 repo create 之后读回失败，清单里只有路径没有 id。这时绝不能重跑 create，否则会建出重复项目；
    // 必须先有人到 gitlab.com 核对那个项目是不是其实已经建好、id 是多少。
    throw new Error(
      '批次清单里已有项目「' + fullPath + '」，但没有 id（上次建完读回失败，状态 create-unconfirmed）：' +
        '为避免建出重复项目，拒绝重复建。请先到 gitlab.com 核对这个项目是否已建好，把 id 补进批次清单后再继续。',
    )
  }
  if (existing && existing.id !== null) {
    let api: Record<string, unknown>
    try {
      api = readProject(existing.id)
    } catch (error: unknown) {
      throw new Error(
        '批次清单里已有项目「' + fullPath + '」（id ' + existing.id + '），但读回失败：' + messageOf(error) +
          '。项目 id 保留在批次清单里，没有重复建；等 gitlab.com 恢复后可以用 status 复核或直接删。',
      )
    }
    const marked = isMarkedForDeletion(api)
    const record = recordFromApi(api, {
      ref: String(existing.id),
      batch: batchName,
      marker,
      status: marked ? 'marked-for-deletion' : 'created',
      createExitCode: null,
      recoveredByReadback: false,
    })
    if (marked && record.markedForDeletionAt === null) record.markedForDeletionAt = existing.markedForDeletionAt
    upsertProject(manifest, record)
    manifest.generatedAt = nowIso()
    const manifestPath = writeBatchManifest(manifest)
    return {
      batch: batchName,
      batchDir,
      marker,
      manifestPath,
      reused: true,
      createExitCode: null,
      recoveredByReadback: false,
      project: summaryOf(record),
    }
  }

  const description = describeProject(options.description, marker)
  const createRun = runGlab(['repo', 'create', fullPath, '--private', '--skipGitInit', '--readme', '--description', description])

  let api: Record<string, unknown>
  try {
    api = readProject(fullPath)
  } catch (readError: unknown) {
    const localDetail = createRun.stderr.trim() || createRun.stdout.trim() || '退出码 ' + createRun.exitCode
    const record: GitlabProjectRecord = {
      id: null,
      name: fullPath.split('/').pop() || fullPath,
      path: fullPath.split('/').pop() || fullPath,
      pathWithNamespace: fullPath,
      webUrl: 'https://gitlab.com/' + fullPath,
      remoteUrl: 'https://gitlab.com/' + fullPath + '.git',
      description,
      marker,
      batch: batchName,
      status: 'create-unconfirmed',
      createdAt: nowIso(),
      markedForDeletionAt: null,
      createExitCode: createRun.exitCode,
      recoveredByReadback: false,
      lastError: messageOf(readError),
    }
    upsertProject(manifest, record)
    manifest.generatedAt = nowIso()
    writeBatchManifest(manifest)
    throw new Error(
      'repo create 之后读回项目「' + fullPath + '」失败：' + messageOf(readError) +
        '。本地 glab 输出：' + localDetail +
        '。批次清单已记下这个路径（没有 id）但没有重复建；请先到 gitlab.com 核对项目是否已建出来，再决定是否重跑 create。',
    )
  }
  const record = recordFromApi(api, {
    ref: fullPath,
    batch: batchName,
    marker,
    status: 'created',
    createExitCode: createRun.exitCode,
    recoveredByReadback: createRun.exitCode !== 0,
  })
  upsertProject(manifest, record)
  manifest.generatedAt = nowIso()
  const manifestPath = writeBatchManifest(manifest)
  return {
    batch: batchName,
    batchDir,
    marker,
    manifestPath,
    reused: false,
    createExitCode: createRun.exitCode,
    recoveredByReadback: record.recoveredByReadback,
    project: summaryOf(record),
  }
}

/** 删项目时最多读回几次、每次隔多久：DELETE 返回 202 之后 marked_for_deletion_at 可能要几秒才出现。 */
const DELETE_READBACK_ATTEMPTS = 3
const DELETE_READBACK_INTERVAL_MS = 1000

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 删一个沙箱项目（幂等、四道闸）：
 *   1. 批次清单必须存在，且里面有这个 id（没有批次标记的项目一律拒绝删除）；
 *   2. 已标记删除的项目只读回确认，不重复发 DELETE；
 *   3. 发 DELETE 前先按路径读回，确认项目描述里带着本批次标记；
 *   4. DELETE 后按 id 读回 marked_for_deletion_at；读回失败或始终没标记就保留 id、以非 0 退出，不假装删干净。
 */
export async function deleteSandboxProject(options: {
  batchDir: string
  batchName?: string
  id: number
}): Promise<DeleteSandboxResult> {
  const batchDir = path.resolve(options.batchDir)
  const batchName = options.batchName || path.basename(batchDir)
  const marker = sandboxMarker(batchName)
  const manifest = readBatchManifest(batchDir)
  if (!manifest) {
    throw new Error(
      '批次目录「' + batchDir + '」里没有批次清单 gitlab-projects.json：没有批次标记的项目拒绝删除。' +
        '只有先跑 gitlab-sandbox create 记进清单的项目才允许删，避免误删别人或别的批次的 GitLab 项目。',
    )
  }
  if (!manifest.marker) {
    throw new Error('批次清单「' + batchManifestPath(batchDir) + '」里没有批次标记：没有批次标记的项目拒绝删除。')
  }
  const entry = manifest.projects.find((item) => item.id === options.id)
  if (!entry) {
    throw new Error(
      '批次清单里没有项目 id ' + options.id + '：没有批次标记的项目拒绝删除（本批次标记是「' + manifest.marker + '」）。',
    )
  }
  if (!entry.marker || entry.marker !== manifest.marker) {
    throw new Error(
      '批次清单里项目 id ' + options.id + ' 的记录没有本批次标记「' + manifest.marker + '」：拒绝删除。',
    )
  }

  const finish = (result: Omit<DeleteSandboxResult, 'batch' | 'batchDir' | 'marker' | 'manifestPath'>): DeleteSandboxResult => {
    manifest.generatedAt = nowIso()
    const manifestPath = writeBatchManifest(manifest)
    return {
      batch: batchName,
      batchDir,
      marker,
      manifestPath,
      alreadyDeleted: result.alreadyDeleted,
      markedForDeletion: result.markedForDeletion,
      deleteResponse: result.deleteResponse,
      project: result.project,
    }
  }

  if (entry.status === 'marked-for-deletion' || entry.markedForDeletionAt) {
    let api: Record<string, unknown>
    try {
      api = readProject(options.id)
    } catch (error: unknown) {
      throw new Error(
        '项目 id ' + options.id + ' 已标记删除，但读回失败：' + messageOf(error) +
          '。项目 id 保留在批次清单里，没有重复删除；等 gitlab.com 恢复后再复核。',
      )
    }
    const markedAt = stringField(api.marked_for_deletion_at) || entry.markedForDeletionAt
    entry.status = 'marked-for-deletion'
    entry.markedForDeletionAt = markedAt
    entry.lastError = null
    return finish({ alreadyDeleted: true, markedForDeletion: true, deleteResponse: null, project: summaryOf(entry) })
  }

  // 发 DELETE 前先按路径读回：既确认项目还在，也确认描述里的批次标记，防止清单被改后误删。
  let live: Record<string, unknown>
  try {
    live = readProject(entry.pathWithNamespace)
  } catch (error: unknown) {
    throw new Error(
      '删项目 id ' + options.id + ' 之前读回「' + entry.pathWithNamespace + '」失败：' + messageOf(error) +
        '。无法确认批次标记，拒绝删除；项目 id 保留在批次清单里。',
    )
  }
  const liveDescription = stringField(live.description) || ''
  if (!liveDescription.includes(marker)) {
    throw new Error(
      '项目 id ' + options.id + '（' + entry.pathWithNamespace + '）的描述里没有本批次标记「' + marker +
        '」：拒绝删除，避免误删别人的项目。',
    )
  }

  const deleteRun = runGlab(['api', '--method', 'DELETE', 'projects/' + options.id])
  if (deleteRun.exitCode !== 0) {
    const detail = deleteRun.stderr.trim() || deleteRun.stdout.trim() || '退出码 ' + deleteRun.exitCode
    entry.status = 'delete-failed'
    entry.lastError = 'DELETE 失败：' + detail
    finish({ alreadyDeleted: false, markedForDeletion: false, deleteResponse: null, project: summaryOf(entry) })
    throw new Error(
      'DELETE 项目 id ' + options.id + ' 失败：' + detail + '。项目 id 保留在批次清单里，确认原因后可重跑 delete。',
    )
  }

  let deleteResponse: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(deleteRun.stdout)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) deleteResponse = parsed as Record<string, unknown>
  } catch {
    deleteResponse = null
  }

  let markedAt: string | null = null
  let lastError = ''
  for (let attempt = 1; attempt <= DELETE_READBACK_ATTEMPTS; attempt += 1) {
    let api: Record<string, unknown>
    try {
      api = readProject(options.id)
    } catch (error: unknown) {
      // 读回本身失败不重试：这是真实故障，重试只会拖慢并放大调用记录；保留 id 直接报错。
      entry.status = 'delete-failed'
      entry.lastError = 'DELETE 之后读回失败：' + messageOf(error)
      finish({ alreadyDeleted: false, markedForDeletion: false, deleteResponse, project: summaryOf(entry) })
      throw new Error(
        'DELETE 项目 id ' + options.id + ' 已发出，但读回失败：' + messageOf(error) +
          '。项目 id 保留在批次清单里（状态 delete-failed），没有重复删除；稍后复核时先读回再决定是否重试。',
      )
    }
    markedAt = stringField(api.marked_for_deletion_at)
    if (markedAt) break
    lastError = isMarkedForDeletion(api) ? '读回的项目路径带了 -deletion_scheduled- 后缀，但没有 marked_for_deletion_at' : '读回项目还在，还没有 marked_for_deletion_at'
    if (attempt < DELETE_READBACK_ATTEMPTS) await sleep(DELETE_READBACK_INTERVAL_MS)
  }

  if (!markedAt) {
    entry.status = 'delete-failed'
    entry.lastError = lastError
    finish({ alreadyDeleted: false, markedForDeletion: false, deleteResponse, project: summaryOf(entry) })
    throw new Error(
      'DELETE 项目 id ' + options.id + ' 已发出，但读回没看到「已标记删除」：' + lastError +
        '。删除可能是延迟生效的，稍后再复核；项目 id 保留在批次清单里，不要重复发 DELETE。',
    )
  }

  entry.status = 'marked-for-deletion'
  entry.markedForDeletionAt = markedAt
  entry.lastError = null
  return finish({ alreadyDeleted: false, markedForDeletion: true, deleteResponse, project: summaryOf(entry) })
}
