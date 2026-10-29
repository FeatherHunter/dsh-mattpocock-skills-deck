// home.mts —— 批次专属的 DSH home：复制真实 web profile、种工作区注册表。
//
// 两件事都只写「批次自己的 home 目录」，绝不碰真实 home。复制过程只报文件数与字节数，
// 不列出文件名、不读文件内容，因此不会把任何凭证打出来。

import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from './paths.mts'
import { dirStats, ensureDir, exists, isDir, readJson, rmrf, sha256Text, writeJson } from './util.mts'

export interface WorkspaceSpec {
  /** 工作区根目录的绝对路径。 */
  path: string
  /** 界面里显示的名字；省略时用目录名。 */
  title?: string
}

export interface CopyHomeOptions {
  /** 目标 home 目录（批次自己的），必须不存在或为空，除非传 force。 */
  home: string
  /** 真实 DSH home，默认由命令按环境变量算出来。 */
  sourceHome?: string
  /** #1631 产出的 home-template 目录；给了它就不再复制真实 profile。 */
  template?: string
  /** 复制哪个 profile，默认 web。 */
  profile?: string
  /** 目标已存在时清掉重来。 */
  force?: boolean
}

export interface CopyHomeResult {
  home: string
  profile: string
  profileDir: string
  source: { kind: 'profile' | 'template'; path: string }
  copyMs: number
  files: number
  bytes: number
  staleLogsRemoved: string[]
}

/** 插件缓存目录名：profile 里与启动目录下用的是同一个名字。 */
export const PLUGIN_CACHE_DIR = '.dsh-mattskillsdeck-cache'

/**
 * 把真实 web profile（或 #1631 的 home-template）安静复制成批次专属 home。
 * 复制完顺手删掉 profile 里带过来的旧日志，以免「按日期找日志」时被上一台机器的日志误导。
 */
export function copyWebProfile(options: CopyHomeOptions): CopyHomeResult {
  const targetHome = path.resolve(options.home)
  assertWritableTarget(targetHome)
  const profile = options.profile || 'web'
  const template = options.template ? path.resolve(options.template) : ''
  const sourceHome = options.sourceHome ? path.resolve(options.sourceHome) : ''

  if (options.force && exists(targetHome)) rmrf(targetHome)
  if (exists(targetHome) && fs.readdirSync(targetHome).length > 0) {
    throw new Error('目标 home「' + targetHome + '」已经有东西：换一个空目录，或加 --force 重新复制。')
  }
  ensureDir(targetHome)

  let profileSource: string
  let sourceKind: 'profile' | 'template'
  if (template) {
    profileSource = path.join(template, 'profiles', profile)
    sourceKind = 'template'
    if (!isDir(profileSource)) {
      const available = exists(path.join(template, 'profiles')) ? fs.readdirSync(path.join(template, 'profiles')).join('、') : '（没有 profiles 目录）'
      throw new Error(
        'home-template「' + template + '」里没有 profiles/' + profile + '。现有 profile：' + available + '。' +
          'home-template 应当是一个完整的 DSH home 目录（里面有 profiles/<名字>/）。',
      )
    }
  } else {
    if (!sourceHome) throw new Error('没有给 --source，也没有给 --template：不知道该从哪里复制 home。')
    profileSource = path.join(sourceHome, 'profiles', profile)
    sourceKind = 'profile'
    if (!isDir(profileSource)) {
      const available = isDir(path.join(sourceHome, 'profiles')) ? fs.readdirSync(path.join(sourceHome, 'profiles')).join('、') : '（没有 profiles 目录）'
      throw new Error('真实 home「' + sourceHome + '」里没有 profiles/' + profile + '。现有 profile：' + available + '。')
    }
  }

  const targetProfile = path.join(targetHome, 'profiles', profile)
  ensureDir(path.dirname(targetProfile))
  const startedAt = Date.now()
  fs.cpSync(profileSource, targetProfile, { recursive: true, force: true })
  const copyMs = Date.now() - startedAt

  const staleLogsRemoved: string[] = []
  const copiedLogs = path.join(targetProfile, PLUGIN_CACHE_DIR, 'logs')
  if (exists(copiedLogs)) {
    for (const name of fs.readdirSync(copiedLogs)) staleLogsRemoved.push(name)
    rmrf(copiedLogs)
  }

  const stats = dirStats(targetProfile)
  writeJson(path.join(targetHome, 'copy-home.json'), {
    generatedAt: new Date().toISOString(),
    source: { kind: sourceKind, path: profileSource },
    profile,
    copyMs,
    files: stats.files,
    bytes: stats.bytes,
    staleLogsRemoved,
  })

  return {
    home: targetHome,
    profile,
    profileDir: targetProfile,
    source: { kind: sourceKind, path: profileSource },
    copyMs,
    files: stats.files,
    bytes: stats.bytes,
    staleLogsRemoved,
  }
}

/** 由工作区路径算一个稳定的工作区编号（同一路径永远是同一个编号，重复种不会长出两份）。 */
export function workspaceIdForPath(target: string): string {
  const digest = sha256Text(path.resolve(target).toLowerCase()).slice(0, 32)
  return (
    digest.slice(0, 8) +
    '-' +
    digest.slice(8, 12) +
    '-4' +
    digest.slice(13, 16) +
    '-8' +
    digest.slice(17, 20) +
    '-' +
    digest.slice(20, 32)
  )
}

export interface RegistryEntry {
  id: string
  path: string
  title: string
}

export interface SeedResult {
  registryPath: string
  defaultWorkspaceId: string
  workspaces: RegistryEntry[]
}

/**
 * 往批次 home 里种工作区：写 <home>/storages/workspace.json。
 * DSH 启动时读这张表，把工作区显示在「选择工作区」菜单里，并让新建会话的 cwd 指向表里的路径。
 * 这样每个实例都能看到自己的批次工作区，不需要在界面上点「添加工作区」走原生目录选择器。
 */
export function seedWorkspaceRegistry(
  homeDir: string,
  workspaces: WorkspaceSpec[],
  options: { defaultPath?: string } = {},
): SeedResult {
  if (workspaces.length === 0) throw new Error('没有工作区可种：至少给一个 --workspace 目录。')
  const targetHome = path.resolve(homeDir)
  assertWritableTarget(targetHome)
  const registryPath = path.join(targetHome, 'storages', 'workspace.json')

  const entries: RegistryEntry[] = []
  const seen = new Set<string>()
  for (const spec of workspaces) {
    const target = path.resolve(spec.path)
    if (!isDir(target)) throw new Error('工作区目录「' + target + '」不存在：先用 make-workspace 生成它，再种注册表。')
    const id = workspaceIdForPath(target)
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({ id, path: target, title: spec.title || path.basename(target) })
  }

  let base: Record<string, any>
  if (exists(registryPath)) {
    base = readJson<Record<string, any>>(registryPath)
  } else {
    base = {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: '' },
      tables: { workspaces: {} },
    }
  }
  base.unit = base.unit || { name: 'workspace', version: 2 }
  base.global = base.global || {}
  base.tables = base.tables || {}
  base.tables.workspaces = base.tables.workspaces || {}
  const ids: string[] = Array.isArray(base.global.workspaceIds) ? base.global.workspaceIds : []
  const nowIso = new Date().toISOString()
  for (const entry of entries) {
    base.tables.workspaces[entry.id] = {
      path: entry.path,
      title: entry.title,
      sessionIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    if (ids.indexOf(entry.id) < 0) ids.push(entry.id)
  }
  base.global.workspaceIds = ids
  base.global.archivedSessionIds = base.global.archivedSessionIds || []
  base.global.pinnedSessionIds = base.global.pinnedSessionIds || []
  const defaultEntry = entries.find((entry) => path.resolve(entry.path) === path.resolve(options.defaultPath || entries[0].path)) || entries[0]
  base.global.defaultWorkspaceId = defaultEntry.id
  base.global.initialized = true

  writeJson(registryPath, base)
  return { registryPath, defaultWorkspaceId: defaultEntry.id, workspaces: entries }
}

/** 读注册表里的工作区列表，供启动后的自检使用。 */
export function readWorkspaceRegistry(homeDir: string): { registryPath: string; workspaces: RegistryEntry[]; defaultWorkspaceId: string } | null {
  const registryPath = path.join(path.resolve(homeDir), 'storages', 'workspace.json')
  if (!exists(registryPath)) return null
  const data = readJson<Record<string, any>>(registryPath)
  const tables = (data.tables && data.tables.workspaces) || {}
  const workspaces: RegistryEntry[] = Object.keys(tables).map((id) => ({ id, path: String(tables[id].path || ''), title: String(tables[id].title || '') }))
  return { registryPath, workspaces, defaultWorkspaceId: String((data.global && data.global.defaultWorkspaceId) || '') }
}