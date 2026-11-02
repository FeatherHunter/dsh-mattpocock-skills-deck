// workspace-seed.mts —— 往批次 home 里种工作区注册表。
//
// 这批函数原样搬自旧工具台的 home.mts：那份文件负责「复制真实 web profile 成批次 home」，
// 而种子逻辑（算工作区编号、读写 <home>/storages/workspace.json）与复制过程没有关系，
// 真机场景的钩子只需要种子这一段。搬出来是为了让场景钩子能在不复制 profile 的情况下复用同一份实现，
// 而不是在 verify/ 里手抄一份注册表格式——两份实现一旦分叉，界面里能不能看到工作区就会时对时错。
//
// 搬动时语义、错误消息与写盘的 JSON 结构（字段名、字段顺序、unit/global/tables 三层）逐字保留。
// 旧工具台在阶段 B 整体删除，现在唯一的调用方是 verify/hooks.ts 与场景门禁。

import path from 'node:path'
import { assertWritableTarget } from './paths.mts'
import { exists, isDir, readJson, sha256Text, writeJson } from './util.mts'

export interface WorkspaceSpec {
  /** 工作区根目录的绝对路径。 */
  path: string
  /** 界面里显示的名字；省略时用目录名。 */
  title?: string
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
