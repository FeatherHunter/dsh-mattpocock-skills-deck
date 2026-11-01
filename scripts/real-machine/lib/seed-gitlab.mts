// seed-gitlab.mts —— #1708 种子数据：把 101 张票、两张地图与关系幂等地种进一个 GitLab 沙箱项目。
//
// 为什么要有这个库：真机验证的票池（B2/B3/B4 批次）必须能反复重建、也能在跑到一半失败后接着补，
// 不能每次都重新手搓。这里把「种什么」「写什么」「怎么认回已经种过的」放在一处：
//
//   - 种什么：buildSeedSpec() 按参数生成一份确定的播种计划（票、地图、子票、标签、指派、父子、阻塞）。
//   - 写什么：全部走 glab api，写法与产品侧 GitLab 后端（src/tracker/rooms/gitlab）一致：
//     建票 POST projects/<id>/issues -f title=…；标签 POST projects/<id>/labels；
//     关票 PUT …/issues/<iid> -f state_event=close；父子关系写进子票正文文件头 <!-- DSH-PARENT: <地图 iid> -->；
//     阻塞优先写原生边 POST …/issues/<iid>/links -f link_type=is_blocked_by，失败（免费档常 403/404）
//     回落到正文成对两行：人读 Blocked by: #N + 程序读 <!-- DSH-BLOCKED-BY: N -->。
//   - 怎么认回：每张票的描述文件头都写 <!-- DSH-SEED-KEY: <稳定键> -->，批次目录下的 gitlab-seed.json
//     记着每个对象的 id/iid/关系与统计。重跑先按 state=all 读回整池票，按稳定键认回已有的，只补缺的；
//     票池建好后 manifest.mode 置 read-only，之后任何写操作前都先检查这个标记，不会悄悄污染只读池。
//
// 外部程序只从 GLAB_BIN 注入（真机是 glab，门禁里是本票的假 glab），本库不访问网络、不碰真实凭证。
// 建票失败会自动重试 3 次并逐次退避（研究笔记 1677 的 Q7）；部分失败时 manifest 与 errors 可读，
// 命令以退出码 1 结束，重跑只补缺的那几个。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureDir, exists, info, nowIso, sleep, writeJson } from './util.mts'
import { assertWritableTarget } from './paths.mts'

/** 批次目录下记录这次播种结果的清单文件名。 */
export const SEED_MANIFEST_FILE = 'gitlab-seed.json'

/** 建票这类写操作失败后最多试几次；与文档口径一致：3 次。 */
export const MAX_ATTEMPTS = 3

/** 每次重试前的等待：第 1 次失败等 200ms，第 2 次等 400ms（退避，别把 GitLab 打急）。 */
export const RETRY_DELAY_MS = 200

/** 播种计划里每张票的稳定键前缀；重跑就靠它从远端认回票，不靠标题猜。 */
const SEED_KEY_PREFIX = '<!-- DSH-SEED-KEY: '
const SEED_KEY_RE = /<!--\s*DSH-SEED-KEY\s*:\s*([^\s]+)\s*-->/
const PARENT_RE = /<!--\s*DSH-PARENT\s*:\s*(\d+)\s*-->/
const BLOCKED_HIDDEN_RE = /<!--\s*DSH-BLOCKED-BY\s*:\s*([^>]*?)-->/

/** 产品侧 GitLab 后端的稳定标签名：地图靠这个标签被识别成地图，子票靠 wayfinder 系列标签归类。 */
const MAP_LABEL = 'wayfinder:map'
const RESEARCH_LABEL = 'wayfinder:research'
const TASK_LABEL = 'wayfinder:task'
const AREA_LABEL = 'seed:area-core'
const PRIORITY_LABEL = 'seed:priority-high'

// ── 播种计划 ─────────────────────────────────────────────────────────────────

export interface SeedLabelSpec {
  key: string
  name: string
  color: string
}

export interface SeedIssueSpec {
  /** 稳定键，重跑认回票用；也写进描述文件头。 */
  key: string
  /** issue=普通票，map=地图（带 wayfinder:map 标签），child=地图下的子票（正文带 DSH-PARENT）。 */
  role: 'issue' | 'map' | 'child'
  title: string
  /** 这张票在同类里的序号（从 1 开始），错误信息里说「第几张」用它。 */
  ordinal: number
  parentKey: string | null
  labels: string[]
  closed: boolean
  assignee: boolean
  blockedByKey: string | null
}

export interface SeedSpec {
  projectPath: string
  ticketCount: number
  closedCount: number
  mapCount: number
  childrenCount: number
  blockingPairs: number
  labels: SeedLabelSpec[]
  /** 创建顺序：先地图、再子票（父 iid 要已经有了）、最后普通票。 */
  issues: SeedIssueSpec[]
}

export interface SeedSpecInput {
  projectPath: string
  ticketCount: number
  closedCount: number
  mapCount: number
  childrenCount: number
  blockingPairs: number
}

function padNumber(value: number, width: number): string {
  let text = String(value)
  while (text.length < width) text = '0' + text
  return text
}

function assertCount(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) throw new Error(name + ' 必须是大于等于 ' + min + ' 的整数，拿到的是「' + String(value) + '」。')
}

/**
 * 按参数生成一份确定的播种计划。
 * 票数口径：ticketCount 是项目里的票总数，包含地图与子票；closedCount 只能是普通票（地图要保持可用）。
 * 关系分配也是确定的：前 6 张普通票带指派，已关闭的普通票按固定间隔挑，阻塞关系按 (2,3)、(12,13)… 配对，
 * 这样门禁与真机报告都能按同样的形状核对统计。
 */
export function buildSeedSpec(input: SeedSpecInput): SeedSpec {
  assertCount('--ticket-count', input.ticketCount, 1)
  assertCount('--closed', input.closedCount, 0)
  assertCount('--maps', input.mapCount, 0)
  assertCount('--children', input.childrenCount, 0)
  assertCount('--blocking', input.blockingPairs, 0)
  if (input.mapCount === 0 && input.childrenCount > 0) throw new Error('--children 大于 0 时必须同时有至少 1 张地图（--maps）。')
  if (input.mapCount + input.childrenCount >= input.ticketCount) {
    throw new Error('--ticket-count 要大于地图数加子票数（' + input.ticketCount + ' > ' + (input.mapCount + input.childrenCount) + ' 不成立）。')
  }
  const ordinaryCount = input.ticketCount - input.mapCount - input.childrenCount
  if (input.closedCount > ordinaryCount) throw new Error('--closed 不能超过普通票数 ' + ordinaryCount + '。')

  const labels: SeedLabelSpec[] = [
    { key: 'label-map', name: MAP_LABEL, color: '#1f78d1' },
    { key: 'label-research', name: RESEARCH_LABEL, color: '#2f9e44' },
    { key: 'label-task', name: TASK_LABEL, color: '#e8590c' },
    { key: 'label-area', name: AREA_LABEL, color: '#7048e8' },
    { key: 'label-priority', name: PRIORITY_LABEL, color: '#d6336c' },
  ]

  const issues: SeedIssueSpec[] = []
  const mapKeys: string[] = []
  for (let index = 0; index < input.mapCount; index += 1) {
    const key = 'seed-map-' + padNumber(index + 1, 2)
    mapKeys.push(key)
    issues.push({
      key,
      role: 'map',
      title: '种子地图 ' + padNumber(index + 1, 2),
      ordinal: index + 1,
      parentKey: null,
      labels: [MAP_LABEL],
      closed: false,
      assignee: false,
      blockedByKey: null,
    })
  }
  for (let index = 0; index < input.childrenCount; index += 1) {
    const mapIndex = input.mapCount === 0 ? 0 : index % input.mapCount
    issues.push({
      key: 'seed-child-' + padNumber(index + 1, 2),
      role: 'child',
      title: '种子子票 ' + padNumber(index + 1, 2),
      ordinal: index + 1,
      parentKey: mapKeys[mapIndex],
      labels: [index % 2 === 0 ? RESEARCH_LABEL : TASK_LABEL],
      closed: false,
      assignee: false,
      blockedByKey: null,
    })
  }
  const ordinary: SeedIssueSpec[] = []
  for (let index = 0; index < ordinaryCount; index += 1) {
    const ordinal = index + 1
    ordinary.push({
      key: 'seed-issue-' + padNumber(ordinal, 3),
      role: 'issue',
      title: '种子票 ' + padNumber(ordinal, 3),
      ordinal,
      parentKey: null,
      labels: ordinal % 10 === 0 ? [AREA_LABEL, PRIORITY_LABEL] : [AREA_LABEL],
      closed: false,
      assignee: ordinal <= 6,
      blockedByKey: null,
    })
  }
  // 已关闭的普通票按等间隔挑：先避开前 6 张（那几张带指派，关掉就看不到指派效果了），
  // 票少的时候从尾部挑。这样关闭的票不会落在带指派的票上，统计口径稳定。
  const closedIndexes = new Set<number>()
  if (input.closedCount > 0 && ordinaryCount > 0) {
    for (let index = 0; index < input.closedCount; index += 1) {
      let pick = ordinaryCount <= 6 ? ordinaryCount - index : 7 + Math.floor((index * (ordinaryCount - 6)) / input.closedCount)
      if (pick < 1) pick = 1
      if (pick > ordinaryCount) pick = ordinaryCount
      while (closedIndexes.has(pick) && pick > 1) pick -= 1
      closedIndexes.add(pick)
    }
  }
  for (const spec of ordinary) if (closedIndexes.has(spec.ordinal)) spec.closed = true
  // 阻塞关系：从第 1 张普通票起两张配一对，源票被目标票阻塞；跳过已关闭的票，保持关系落在还能改的票上。
  // 配不满 requested 对时报错，而不是悄悄少配——统计口径必须和参数一致，真机报告才能复核。
  const byOrdinal = new Map<number, SeedIssueSpec>()
  for (const spec of ordinary) byOrdinal.set(spec.ordinal, spec)
  let pairs = 0
  let cursor = 1
  while (pairs < input.blockingPairs && cursor + 1 <= ordinaryCount) {
    const source = byOrdinal.get(cursor)
    const target = byOrdinal.get(cursor + 1)
    if (!source || !target) break
    if (source.closed || target.closed) {
      cursor += 1
      continue
    }
    source.blockedByKey = target.key
    pairs += 1
    cursor += 2
  }
  if (pairs < input.blockingPairs) {
    throw new Error('普通票只有 ' + ordinaryCount + ' 张（其中已关闭 ' + input.closedCount + ' 张），分不出 ' + input.blockingPairs + ' 对阻塞关系；请减少 --blocking 或增加 --ticket-count。')
  }
  issues.push(...ordinary)

  return {
    projectPath: input.projectPath,
    ticketCount: input.ticketCount,
    closedCount: input.closedCount,
    mapCount: input.mapCount,
    childrenCount: input.childrenCount,
    blockingPairs: pairs,
    labels,
    issues,
  }
}

// ── 批次清单（manifest）──────────────────────────────────────────────────────

export interface SeedProjectRecord {
  id: number
  path: string
  pathWithNamespace: string
  webUrl: string
}

export interface SeedManifestIssue {
  key: string
  role: 'issue' | 'map' | 'child'
  title: string
  iid: number
  id: number
  webUrl: string
  state: string
  labels: string[]
  parentKey: string | null
  blockedByKey: string | null
  assigneeIds: number[]
}

export interface SeedManifestLabel {
  key: string
  name: string
  color: string
  id: number
}

export interface SeedBlockingRelation {
  sourceKey: string
  targetKey: string
  /** native=原生 is_blocked_by 边；description=正文成对两行（免费档拿不到原生能力时的回落）。 */
  mode: 'native' | 'description'
}

export interface SeedParentRelation {
  childKey: string
  mapKey: string
}

export interface SeedManifestStats {
  issues: number
  closedIssues: number
  maps: number
  children: number
  labels: number
  assignees: number
  parentEdges: number
  blockedEdges: number
}

export interface SeedError {
  phase: string
  seedKey: string
  title: string
  attempts: number
  message: string
}

export interface SeedManifest {
  version: 1
  kind: 'gitlab-seed'
  batch: string
  batchDir: string
  generatedAt: string
  updatedAt: string
  project: SeedProjectRecord
  spec: SeedSpec
  mode: 'seedable' | 'read-only'
  assigneeUserId: number | null
  labels: SeedManifestLabel[]
  issues: SeedManifestIssue[]
  relations: { parent: SeedParentRelation[]; blocking: SeedBlockingRelation[] }
  errors: SeedError[]
  stats: SeedManifestStats
}

export function seedManifestPath(batchDir: string): string {
  return path.join(path.resolve(batchDir), SEED_MANIFEST_FILE)
}

/** 读批次清单；没有返回 null。读不懂时报清楚是哪份文件，不要静默当新池子重建。 */
export function readSeedManifest(file: string): SeedManifest | null {
  if (!exists(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error('种子清单读不懂：' + file + '（' + messageOf(error) + '）')
  }
  const record = asRecord(parsed)
  if (!record || record.kind !== 'gitlab-seed' || numberOr(record.version) !== 1) {
    throw new Error('种子清单形状不对：' + file + '。它不是 seed-gitlab 写的批次清单，换一个批次目录。')
  }
  return parsed as SeedManifest
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function computeStats(manifest: SeedManifest): SeedManifestStats {
  const closed = manifest.issues.filter((issue) => issue.state === 'closed').length
  return {
    issues: manifest.issues.length,
    closedIssues: closed,
    maps: manifest.issues.filter((issue) => issue.role === 'map').length,
    children: manifest.issues.filter((issue) => issue.role === 'child').length,
    labels: manifest.labels.length,
    assignees: manifest.issues.filter((issue) => issue.assigneeIds.length > 0).length,
    parentEdges: manifest.relations.parent.length,
    blockedEdges: manifest.relations.blocking.length,
  }
}

// ── glab 调用：外部世界只从这里进 ───────────────────────────────────────────

interface GlabResult {
  exitCode: number | null
  stdout: string
  stderr: string
  display: string
}

function displayArgv(argv: string[]): string {
  return argv.map((item) => (item.includes(' ') ? '"' + item + '"' : item)).join(' ')
}

/**
 * 起一次 glab。GLAB_BIN 可以是：
 *   - .cmd/.bat（Windows 上 glab 常见形态）：照 scripts/real-machine/lib/candidate.mts 的做法经 ComSpec 起；
 *   - .mts/.js/.mjs（门禁里的假 glab）：直接用当前 node 跑，免得受文件关联影响；
 *   - 其它可执行文件：原样起。
 */
function runGlabRaw(args: string[]): GlabResult {
  const bin = process.env.GLAB_BIN || 'glab'
  const display = displayArgv([bin].concat(args))
  let executable = bin
  let argv = args
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    executable = process.env.ComSpec || 'cmd.exe'
    argv = ['/d', '/c', bin].concat(args)
  } else if (/\.(mts|mjs|js|ts)$/i.test(bin)) {
    executable = process.execPath
    argv = ['--no-warnings', bin].concat(args)
  }
  const result = spawnSync(executable, argv, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const error = result.error as NodeJS.ErrnoException | undefined
  if (error) {
    throw new Error('起不了 glab（' + display + '）：' + error.message)
  }
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    display,
  }
}

function glabTail(result: GlabResult): string {
  const text = (result.stderr || result.stdout || '').trim()
  if (!text) return '退出码 ' + String(result.exitCode) + '（没有任何输出）'
  const lines = text.split(/\r?\n/).slice(-6)
  return lines.join(' / ').slice(0, 600)
}

/** 调一次 glab api 并解析 JSON；失败按 MAX_ATTEMPTS 重试并退避。 */
async function glabJson<T>(args: string[], label: string, attempts = MAX_ATTEMPTS): Promise<T> {
  let last = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runGlabRaw(args)
    if (result.exitCode === 0) {
      const text = result.stdout.trim()
      if (!text) return null as unknown as T
      try {
        return JSON.parse(text) as T
      } catch (error) {
        last = 'stdout 不是合法 JSON：' + messageOf(error)
      }
    } else {
      last = glabTail(result)
    }
    if (attempt < attempts) await sleep(attempt * RETRY_DELAY_MS)
  }
  throw new Error(label + '：重试 ' + attempts + ' 次仍失败：' + last)
}

function apiArgs(method: string, apiPath: string, fields?: Record<string, string>): string[] {
  const args = ['api', apiPath]
  if (method !== 'GET') args.push('--method', method)
  if (fields) {
    for (const key of Object.keys(fields)) args.push('-f', key + '=' + fields[key])
  }
  return args
}

function projectApiRef(projectId: number): string {
  return 'projects/' + String(projectId)
}

function issuesApiPath(projectId: number): string {
  return projectApiRef(projectId) + '/issues'
}

function issueApiPath(projectId: number, iid: number): string {
  return issuesApiPath(projectId) + '/' + String(iid)
}

interface RemoteLabel {
  id: number
  name: string
  color: string
}

interface RemoteIssue {
  id: number
  iid: number
  title: string
  description: string
  state: string
  labels: string[]
  assigneeIds: number[]
  webUrl: string
}

function normalizeRemoteLabel(value: unknown): RemoteLabel {
  const record = asRecord(value)
  return {
    id: numberOr(record?.id) === null ? 0 : Number(record?.id),
    name: typeof record?.name === 'string' ? record.name : '',
    color: typeof record?.color === 'string' ? record.color : '',
  }
}

function normalizeRemoteIssue(value: unknown): RemoteIssue {
  const record = asRecord(value)
  const labelNames: string[] = []
  if (Array.isArray(record?.labels)) {
    for (const label of record.labels) {
      if (typeof label === 'string') labelNames.push(label)
      else {
        const item = asRecord(label)
        if (item && typeof item.name === 'string') labelNames.push(item.name)
      }
    }
  }
  const assigneeIds: number[] = []
  if (Array.isArray(record?.assignees)) {
    for (const assignee of record.assignees) {
      const item = asRecord(assignee)
      const id = numberOr(item?.id)
      if (id !== null) assigneeIds.push(id)
    }
  } else if (Array.isArray(record?.assignee_ids)) {
    for (const raw of record.assignee_ids) {
      const id = numberOr(raw)
      if (id !== null) assigneeIds.push(id)
    }
  }
  return {
    id: numberOr(record?.id) === null ? 0 : Number(record?.id),
    iid: numberOr(record?.iid) === null ? 0 : Number(record?.iid),
    title: typeof record?.title === 'string' ? record.title : '',
    description: typeof record?.description === 'string' ? record.description : '',
    state: typeof record?.state === 'string' ? record.state : 'opened',
    labels: labelNames,
    assigneeIds,
    webUrl: typeof record?.web_url === 'string' ? record.web_url : '',
  }
}

/** 按路径读项目：外面传 group/project，GitLab 的 REST 路径是 projects/<URL 编码后的路径>。 */
async function fetchProject(projectPath: string): Promise<SeedProjectRecord> {
  const raw = await glabJson<unknown>(apiArgs('GET', 'projects/' + encodeURIComponent(projectPath)), '读项目 ' + projectPath)
  const record = asRecord(raw)
  const id = numberOr(record?.id)
  if (!record || id === null) throw new Error('读项目 ' + projectPath + ' 失败：回包里没有数字 id。')
  return {
    id,
    path: typeof record.path === 'string' ? record.path : projectPath,
    pathWithNamespace: typeof record.path_with_namespace === 'string' ? record.path_with_namespace : projectPath,
    webUrl: typeof record.web_url === 'string' ? record.web_url : '',
  }
}

/** 读回整池票：必须带 state=all，否则已关闭的票看不到，重跑会把它们当缺失再建一遍。 */
async function listAllRemoteIssues(projectId: number): Promise<RemoteIssue[]> {
  const all: RemoteIssue[] = []
  const perPage = 100
  for (let page = 1; page <= 50; page += 1) {
    const apiPath = issuesApiPath(projectId) + '?state=all&per_page=' + perPage + '&page=' + page
    const raw = await glabJson<unknown>(apiArgs('GET', apiPath), '读回票列表第 ' + page + ' 页', MAX_ATTEMPTS)
    const items = Array.isArray(raw) ? raw : []
    for (const item of items) all.push(normalizeRemoteIssue(item))
    if (items.length < perPage) break
  }
  return all
}

async function fetchCurrentUserId(): Promise<number> {
  const raw = await glabJson<unknown>(apiArgs('GET', 'user'), '读当前用户')
  const id = numberOr(asRecord(raw)?.id)
  if (id === null) throw new Error('读当前用户失败：回包里没有数字 id（指派要用它）。')
  return id
}

async function listProjectLabels(projectId: number): Promise<RemoteLabel[]> {
  const raw = await glabJson<unknown>(apiArgs('GET', projectApiRef(projectId) + '/labels'), '读标签列表')
  const items = Array.isArray(raw) ? raw : []
  return items.map(normalizeRemoteLabel)
}

async function createLabel(projectId: number, name: string, color: string): Promise<RemoteLabel> {
  const raw = await glabJson<unknown>(apiArgs('POST', projectApiRef(projectId) + '/labels', { name, color }), '创建标签 ' + name)
  return normalizeRemoteLabel(raw)
}

async function createRemoteIssue(
  projectId: number,
  spec: SeedIssueSpec,
  description: string,
  assigneeUserId: number | null,
): Promise<RemoteIssue> {
  const fields: Record<string, string> = { title: spec.title, description }
  if (spec.labels.length > 0) fields.labels = spec.labels.join(',')
  if (assigneeUserId !== null) fields.assignee_ids = String(assigneeUserId)
  const raw = await glabJson<unknown>(apiArgs('POST', issuesApiPath(projectId), fields), '第 ' + spec.ordinal + ' 张票（' + spec.key + '，' + spec.title + '）建票')
  return normalizeRemoteIssue(raw)
}

async function closeRemoteIssue(projectId: number, iid: number, label: string): Promise<void> {
  await glabJson<unknown>(apiArgs('PUT', issueApiPath(projectId, iid), { state_event: 'close' }), label)
}

async function updateRemoteDescription(projectId: number, iid: number, description: string, label: string): Promise<void> {
  await glabJson<unknown>(apiArgs('PUT', issueApiPath(projectId, iid), { description }), label)
}

async function listRemoteLinks(projectId: number, iid: number, label: string): Promise<Array<Record<string, unknown>>> {
  const raw = await glabJson<unknown>(apiArgs('GET', issueApiPath(projectId, iid) + '/links'), label)
  const items = Array.isArray(raw) ? raw : []
  const result: Array<Record<string, unknown>> = []
  for (const item of items) {
    const record = asRecord(item)
    if (record) result.push(record)
  }
  return result
}

async function createNativeBlockLink(projectId: number, sourceIid: number, targetIid: number, label: string): Promise<void> {
  await glabJson<unknown>(
    apiArgs('POST', issueApiPath(projectId, sourceIid) + '/links', {
      target_project_id: String(projectId),
      target_issue_iid: String(targetIid),
      link_type: 'is_blocked_by',
    }),
    label,
    1,
  )
}

function linkTargetMatches(link: Record<string, unknown>, targetIid: number): boolean {
  const linkType = String(link.link_type || '').toLowerCase()
  if (linkType !== 'is_blocked_by') return false
  const other = numberOr(link.iid)
  if (other !== null) return other === targetIid
  const target = numberOr(link.target_issue_iid)
  return target !== null && target === targetIid
}

async function nativeBlockLinkExists(projectId: number, sourceIid: number, targetIid: number): Promise<boolean> {
  const links = await listRemoteLinks(projectId, sourceIid, '确认票 ' + sourceIid + ' 的原生阻塞边')
  return links.some((link) => linkTargetMatches(link, targetIid))
}

// ── 正文里的标记 ────────────────────────────────────────────────────────────

function seedKeyOfDescription(description: string): string | null {
  const match = SEED_KEY_RE.exec(description)
  return match ? match[1] : null
}

function parentIidOfDescription(description: string): number | null {
  const match = PARENT_RE.exec(description)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function blockedTargetsOfDescription(description: string): number[] {
  const match = BLOCKED_HIDDEN_RE.exec(description)
  if (!match) return []
  const numbers: number[] = []
  for (const part of match[1].split(',')) {
    const trimmed = part.trim().replace(/^#/, '')
    if (!trimmed) continue
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) numbers.push(parsed)
  }
  return numbers
}

function composeDescription(spec: SeedIssueSpec, parentIid: number | null): string {
  const lines: string[] = []
  if (spec.role === 'child') {
    if (parentIid === null) throw new Error('子票 ' + spec.key + ' 还没有父地图 iid，不能建。')
    lines.push('<!-- DSH-PARENT: ' + String(parentIid) + ' -->')
  }
  lines.push(SEED_KEY_PREFIX + spec.key + ' -->')
  lines.push('')
  lines.push('# ' + spec.title)
  lines.push('')
  lines.push('真机验证用的种子票：这张票由 scripts/real-machine/commands/seed-gitlab.mts 幂等种出来，')
  lines.push('描述文件头的标记由那个命令维护，请不要手工删除；要重建整个票池请换一个批次目录。')
  return lines.join('\n') + '\n'
}

function withBlockedPair(oldDescription: string, targetIid: number): string {
  const body = oldDescription.replace(/\s+$/, '')
  return body + '\n\nBlocked by: #' + String(targetIid) + '\n<!-- DSH-BLOCKED-BY: ' + String(targetIid) + ' -->\n'
}

function descriptionHasPair(description: string, targetIid: number): boolean {
  return description.includes('Blocked by: #' + String(targetIid)) && blockedTargetsOfDescription(description).includes(targetIid)
}

// ── 执行 ────────────────────────────────────────────────────────────────────

export interface SeedProvidedCounts {
  ticketCount?: number
  closedCount?: number
  mapCount?: number
  childrenCount?: number
  blockingPairs?: number
}

export interface SeedOptions {
  batchDir: string
  projectPath: string
  ticketCount: number
  closedCount: number
  mapCount: number
  childrenCount: number
  blockingPairs: number
  unlockReadonly: boolean
  /** 命令行里显式写了的规模参数；重跑时用来发现「参数和清单记的不一样」。 */
  provided?: SeedProvidedCounts
}

export interface SeedRunResult {
  ok: boolean
  action: 'seed'
  batch: string
  batchDir: string
  manifestPath: string
  project: SeedProjectRecord
  mode: 'seedable' | 'read-only'
  spec: SeedSpec
  stats: SeedManifestStats
  created: { labels: number; issues: number; relations: number }
  reused: { labels: number; issues: number; relations: number }
  errors: SeedError[]
}

function createEmptyManifest(batchDir: string, batch: string, project: SeedProjectRecord, spec: SeedSpec): SeedManifest {
  const now = nowIso()
  return {
    version: 1,
    kind: 'gitlab-seed',
    batch,
    batchDir,
    generatedAt: now,
    updatedAt: now,
    project,
    spec,
    mode: 'seedable',
    assigneeUserId: null,
    labels: [],
    issues: [],
    relations: { parent: [], blocking: [] },
    errors: [],
    stats: { issues: 0, closedIssues: 0, maps: 0, children: 0, labels: 0, assignees: 0, parentEdges: 0, blockedEdges: 0 },
  }
}

function assertProvidedMatches(spec: SeedSpec, provided?: SeedProvidedCounts): void {
  if (!provided) return
  const checks: Array<[string, number | undefined, number]> = [
    ['--ticket-count', provided.ticketCount, spec.ticketCount],
    ['--closed', provided.closedCount, spec.closedCount],
    ['--maps', provided.mapCount, spec.mapCount],
    ['--children', provided.childrenCount, spec.childrenCount],
    ['--blocking', provided.blockingPairs, spec.blockingPairs],
  ]
  for (const [flag, given, recorded] of checks) {
    if (given !== undefined && given !== recorded) {
      throw new Error('这次传的 ' + flag + ' ' + String(given) + ' 与清单里记的 ' + String(recorded) + ' 不一致：同一个批次目录只按第一次的规模补种，要换规模请换批次目录。')
    }
  }
}

/** 断点续跑时用读回结果刷新清单里每个对象的 id/state；返回规范里仍然缺失的稳定键。 */
function reconcileManifest(manifest: SeedManifest, remoteByKey: Map<string, RemoteIssue>): string[] {
  const missing: string[] = []
  for (const spec of manifest.spec.issues) {
    const remote = remoteByKey.get(spec.key)
    if (!remote) {
      missing.push(spec.key)
      continue
    }
    let record: SeedManifestIssue | null = null
    for (const issue of manifest.issues) if (issue.key === spec.key) record = issue
    if (!record) {
      record = {
        key: spec.key,
        role: spec.role,
        title: spec.title,
        iid: remote.iid,
        id: remote.id,
        webUrl: remote.webUrl,
        state: remote.state,
        labels: remote.labels.slice(),
        parentKey: spec.parentKey,
        blockedByKey: spec.blockedByKey,
        assigneeIds: remote.assigneeIds.slice(),
      }
      manifest.issues.push(record)
    } else {
      record.iid = remote.iid
      record.id = remote.id
      record.webUrl = remote.webUrl
      record.state = remote.state
      record.assigneeIds = remote.assigneeIds.slice()
    }
  }
  return missing
}

/** 只读池的复核：父地图标记、已关闭状态、阻塞关系都要对得上；有问题就列出可读的原因。 */
async function verifyReadOnlyRelations(manifest: SeedManifest, remoteByKey: Map<string, RemoteIssue>, projectId: number): Promise<string[]> {
  const problems: string[] = []
  for (const record of manifest.issues) {
    const remote = remoteByKey.get(record.key)
    if (!remote) continue
    if (record.role === 'child' && record.parentKey) {
      let mapIid: number | null = null
      for (const issue of manifest.issues) if (issue.key === record.parentKey) mapIid = issue.iid
      const seen = parentIidOfDescription(remote.description)
      if (mapIid === null || seen !== mapIid) problems.push('子票 ' + record.key + ' 正文里的父地图标记不是 ' + String(mapIid) + '（读到 ' + String(seen) + '）')
    }
    if (record.state !== remote.state && record.state === 'closed') problems.push('票 ' + record.key + ' 清单里记着已关闭，远端状态是 ' + remote.state)
  }
  for (const relation of manifest.relations.blocking) {
    const source = remoteByKey.get(relation.sourceKey)
    const target = remoteByKey.get(relation.targetKey)
    if (!source || !target) {
      problems.push('阻塞关系 ' + relation.sourceKey + ' → ' + relation.targetKey + ' 的一端在远端找不到')
      continue
    }
    if (relation.mode === 'native') {
      const existsNow = await nativeBlockLinkExists(projectId, source.iid, target.iid)
      if (!existsNow) problems.push('原生阻塞边 ' + relation.sourceKey + ' → ' + relation.targetKey + ' 在远端没有了')
    } else if (!descriptionHasPair(source.description, target.iid)) {
      problems.push('回落写法的阻塞关系 ' + relation.sourceKey + ' → ' + relation.targetKey + ' 不在正文里')
    }
  }
  return problems
}

/**
 * 种一批票。返回命令要打印的回执；部分失败时 ok=false，errors 里有可定位的失败项，清单已落盘。
 * 幂等口径：先读回整池票按稳定键认回；只读标记在写之前检查；补种只补缺失项。
 */
export async function runSeed(options: SeedOptions): Promise<SeedRunResult> {
  const batchDir = path.resolve(options.batchDir)
  assertWritableTarget(batchDir)
  ensureDir(batchDir)
  const manifestPath = seedManifestPath(batchDir)
  const batch = path.basename(batchDir)
  const existing = readSeedManifest(manifestPath)
  if (existing && existing.spec.projectPath !== options.projectPath) {
    throw new Error('这个批次目录记的是项目「' + existing.spec.projectPath + '」，这次传的是「' + options.projectPath + '」：换一个批次目录，别把两个池子种到一起。')
  }
  const spec = existing
    ? existing.spec
    : buildSeedSpec({
        projectPath: options.projectPath,
        ticketCount: options.ticketCount,
        closedCount: options.closedCount,
        mapCount: options.mapCount,
        childrenCount: options.childrenCount,
        blockingPairs: options.blockingPairs,
      })
  if (existing) assertProvidedMatches(spec, options.provided)

  const project = await fetchProject(options.projectPath)
  if (existing && existing.project.id !== project.id) {
    throw new Error('批次清单里的项目 id 是 ' + String(existing.project.id) + '，这次读到的是 ' + String(project.id) + '：同名项目被重建过，换一个批次目录重新种。')
  }
  const manifest = existing || createEmptyManifest(batchDir, batch, project, spec)
  manifest.project = project
  manifest.spec = spec
  manifest.updatedAt = nowIso()
  manifest.errors = []

  const persist = (): void => {
    manifest.updatedAt = nowIso()
    writeJson(manifestPath, manifest)
  }

  info('种子数据：项目 ' + project.pathWithNamespace + '（id ' + String(project.id) + '），批次目录 ' + batchDir)
  const remoteList = await listAllRemoteIssues(project.id)
  const remoteByKey = new Map<string, RemoteIssue>()
  for (const remote of remoteList) {
    const key = seedKeyOfDescription(remote.description)
    if (key) remoteByKey.set(key, remote)
  }
  info('种子数据：远端读回 ' + String(remoteList.length) + ' 张票，按稳定键认出 ' + String(remoteByKey.size) + ' 张')
  const missingBefore = reconcileManifest(manifest, remoteByKey)

  const created = { labels: 0, issues: 0, relations: 0 }
  const reused = { labels: 0, issues: 0, relations: 0 }

  // 只读标记：写任何东西之前先检查。
  if (manifest.mode === 'read-only') {
    const problems: string[] = missingBefore.map((key) => '缺少票 ' + key)
    if (problems.length === 0) problems.push(...(await verifyReadOnlyRelations(manifest, remoteByKey, project.id)))
    if (problems.length === 0) {
      reused.issues = manifest.issues.length
      reused.labels = manifest.labels.length
      reused.relations = manifest.relations.blocking.length
      manifest.stats = computeStats(manifest)
      persist()
      info('种子数据：只读票池自检通过（' + String(manifest.issues.length) + ' 张票），没有写任何东西')
      return {
        ok: true,
        action: 'seed',
        batch,
        batchDir,
        manifestPath,
        project,
        mode: 'read-only',
        spec,
        stats: manifest.stats,
        created,
        reused,
        errors: [],
      }
    }
    if (!options.unlockReadonly) {
      throw new Error(
        '种子票池已标记为只读（manifest.mode=read-only），但读回发现 ' +
          String(problems.length) +
          ' 处缺失：' +
          problems.slice(0, 8).join('；') +
          '。确认要补种请加 --unlock-readonly（补完会恢复只读标记）。',
      )
    }
    manifest.mode = 'seedable'
    info('种子数据：显式 --unlock-readonly，临时解除只读标记，补 ' + String(problems.length) + ' 处缺失')
    persist()
  }

  const fresh = manifest.mode !== 'read-only'

  // 1) 标签：显式建标签对象（颜色带 # 加六位十六进制），票上再按名字挂。
  const remoteLabels = await listProjectLabels(project.id)
  for (const labelSpec of spec.labels) {
    const known = manifest.labels.find((label) => label.key === labelSpec.key)
    if (known) {
      reused.labels += 1
      continue
    }
    const already = remoteLabels.find((label) => label.name === labelSpec.name)
    if (already) {
      manifest.labels.push({ key: labelSpec.key, name: labelSpec.name, color: already.color || labelSpec.color, id: already.id })
      reused.labels += 1
    } else {
      const label = await createLabel(project.id, labelSpec.name, labelSpec.color)
      manifest.labels.push({ key: labelSpec.key, name: labelSpec.name, color: labelSpec.color, id: label.id })
      created.labels += 1
    }
    persist()
  }

  // 2) 指派用户 id：先读当前用户，建票时直接带 assignee_ids（少一趟 PUT）。
  const needsAssignee = spec.issues.some((issue) => issue.assignee)
  if (fresh && needsAssignee && manifest.assigneeUserId === null) {
    manifest.assigneeUserId = await fetchCurrentUserId()
    persist()
  }

  // 3) 建票：先地图、再子票、最后普通票；失败按 3 次重试，仍失败就记下来继续建别的。
  const mapIids = new Map<string, number>()
  for (const specIssue of spec.issues) {
    if (remoteByKey.has(specIssue.key)) {
      const remote = remoteByKey.get(specIssue.key)
      if (remote) mapIids.set(specIssue.key, remote.iid)
      reused.issues += 1
      continue
    }
    try {
      let parentIid: number | null = null
      if (specIssue.parentKey) {
        const known = mapIids.get(specIssue.parentKey)
        if (known === undefined) {
          throw new Error('父地图 ' + specIssue.parentKey + ' 没有建成，这张子票跳过')
        }
        parentIid = known
      }
      const description = composeDescription(specIssue, parentIid)
      const assigneeUserId = specIssue.assignee ? manifest.assigneeUserId : null
      const remote = await createRemoteIssue(project.id, specIssue, description, assigneeUserId)
      const record: SeedManifestIssue = {
        key: specIssue.key,
        role: specIssue.role,
        title: specIssue.title,
        iid: remote.iid,
        id: remote.id,
        webUrl: remote.webUrl,
        state: remote.state,
        labels: specIssue.labels.slice(),
        parentKey: specIssue.parentKey,
        blockedByKey: specIssue.blockedByKey,
        assigneeIds: remote.assigneeIds.slice(),
      }
      const known = manifest.issues.find((issue) => issue.key === specIssue.key)
      if (known) {
        known.iid = record.iid
        known.id = record.id
        known.webUrl = record.webUrl
        known.state = record.state
        known.assigneeIds = record.assigneeIds.slice()
      } else {
        manifest.issues.push(record)
      }
      remoteByKey.set(specIssue.key, remote)
      mapIids.set(specIssue.key, remote.iid)
      created.issues += 1
      persist()
    } catch (error) {
      const failure: SeedError = {
        phase: 'issue',
        seedKey: specIssue.key,
        title: specIssue.title,
        attempts: MAX_ATTEMPTS,
        message: messageOf(error),
      }
      manifest.errors.push(failure)
      persist()
      info('第 ' + String(specIssue.ordinal) + ' 张票（' + specIssue.key + '，' + specIssue.title + '）没建成：' + failure.message)
    }
  }

  // 4) 关掉该关闭的票；已经关着的不重复发。
  for (const specIssue of spec.issues) {
    if (!specIssue.closed) continue
    const record = manifest.issues.find((issue) => issue.key === specIssue.key)
    if (!record || record.state === 'closed') continue
    try {
      await closeRemoteIssue(project.id, record.iid, '关闭 ' + specIssue.key)
      record.state = 'closed'
      persist()
    } catch (error) {
      manifest.errors.push({ phase: 'close', seedKey: specIssue.key, title: specIssue.title, attempts: MAX_ATTEMPTS, message: messageOf(error) })
      persist()
      info('第 ' + String(specIssue.ordinal) + ' 张票（' + specIssue.key + '）关票失败：' + messageOf(error))
    }
  }

  // 5) 父子关系：写进子票正文文件头（产品侧 GitLab 后端就是靠这个隐藏标记认父子的）。
  manifest.relations.parent = []
  for (const record of manifest.issues) {
    if (record.role === 'child' && record.parentKey) manifest.relations.parent.push({ childKey: record.key, mapKey: record.parentKey })
  }

  // 6) 阻塞关系：优先原生边，失败回落正文成对两行；断点续跑时先确认已有的边还在。
  manifest.relations.blocking = manifest.relations.blocking.filter((relation) => {
    const source = remoteByKey.get(relation.sourceKey)
    const target = remoteByKey.get(relation.targetKey)
    return Boolean(source && target)
  })
  for (const specIssue of spec.issues) {
    if (!specIssue.blockedByKey) continue
    const sourceRecord = manifest.issues.find((issue) => issue.key === specIssue.key)
    const targetRecord = manifest.issues.find((issue) => issue.key === specIssue.blockedByKey)
    if (!sourceRecord || !targetRecord) continue
    const existingRelation = manifest.relations.blocking.find(
      (relation) => relation.sourceKey === specIssue.key && relation.targetKey === specIssue.blockedByKey,
    )
    if (existingRelation) {
      const sourceRemote = remoteByKey.get(specIssue.key)
      let stillThere = false
      if (existingRelation.mode === 'native') {
        stillThere = await nativeBlockLinkExists(project.id, sourceRecord.iid, targetRecord.iid)
      } else if (sourceRemote) {
        stillThere = descriptionHasPair(sourceRemote.description, targetRecord.iid)
      }
      if (stillThere) {
        reused.relations += 1
        continue
      }
      manifest.relations.blocking = manifest.relations.blocking.filter((relation) => relation !== existingRelation)
    }
    const label = '第 ' + String(specIssue.ordinal) + ' 张票（' + specIssue.key + '）写阻塞边 → ' + specIssue.blockedByKey
    try {
      await createNativeBlockLink(project.id, sourceRecord.iid, targetRecord.iid, label)
      manifest.relations.blocking.push({ sourceKey: specIssue.key, targetKey: specIssue.blockedByKey, mode: 'native' })
      created.relations += 1
      persist()
      continue
    } catch (nativeError) {
      const sourceRemote = remoteByKey.get(specIssue.key)
      const fallbackDescription = withBlockedPair(sourceRemote ? sourceRemote.description : '', targetRecord.iid)
      try {
        await updateRemoteDescription(project.id, sourceRecord.iid, fallbackDescription, label + '（原生边不可用，回落正文）')
        if (sourceRemote) sourceRemote.description = fallbackDescription
        manifest.relations.blocking.push({ sourceKey: specIssue.key, targetKey: specIssue.blockedByKey, mode: 'description' })
        created.relations += 1
        persist()
      } catch (fallbackError) {
        manifest.errors.push({
          phase: 'blocking',
          seedKey: specIssue.key,
          title: specIssue.title,
          attempts: 1,
          message: '原生边失败（' + messageOf(nativeError) + '）；回落正文也失败（' + messageOf(fallbackError) + '）',
        })
        persist()
        info(label + '没写成：原生边与回落写法都失败')
      }
    }
  }

  // 7) 收尾：统计、只读标记、回执。
  manifest.stats = computeStats(manifest)
  manifest.mode = manifest.errors.length === 0 ? 'read-only' : 'seedable'
  persist()
  const ok = manifest.errors.length === 0
  info(
    '种子数据：' +
      (ok ? '完成' : '没完成') +
      '，共 ' + String(manifest.stats.issues) + ' 张票（已关闭 ' + String(manifest.stats.closedIssues) + ' 张），' +
      '本次新建 ' + String(created.issues) + ' 张、复用 ' + String(reused.issues) + ' 张' +
      (ok ? '，票池已标记只读' : '，错误见 ' + manifestPath),
  )
  return {
    ok,
    action: 'seed',
    batch,
    batchDir,
    manifestPath,
    project,
    mode: manifest.mode,
    spec,
    stats: manifest.stats,
    created,
    reused,
    errors: manifest.errors.slice(),
  }
}
