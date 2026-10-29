// workspaces.mts —— 工作区生成器：GitHub 后端、离线冷启动、Markdown 后端、1612 用的 A/B 两套。
//
// Markdown 后端的文件形状不手抄：直接调用仓库自己的渲染器（渲染器与插件读文件走同一份模板），
// 生成的 map.md 与 issues/NN-<slug>.md 因而与插件真实读取的形状一致。
// 绑定文件 docs/agents/workspace.yaml 也用仓库自己的 stringifyWorkspace 生成，不手写 YAML。
//
// 三个使用约定：
//   1. GitHub 后端工作区是「冻结提交的 git worktree」：拿主仓库某次提交的只读快照去验证，验证中不会污染主工作树。
//   2. 离线冷启动工作区故意什么都不放：验证没有仓库、没有网络、没有绑定时插件从零启动的表现。
//   3. Markdown 工作区不依赖 git 与网络：.scratch/<effort>/map.md 加 issues/ 子票就够插件识别后端。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assertWritableTarget } from './paths.mts'
import { dirStats, ensureDir, exists, nowIso, repoRoot, rmrf, writeJson, writeText } from './util.mts'

export interface GeneratedWorkspace {
  kind: 'github' | 'cold' | 'markdown' | 'ab'
  dir: string
  title: string
  backendId: string
  bindingFile?: string
  extra: Record<string, any>
}

interface RepoModules {
  stringifyWorkspace: (value: unknown, layouts: readonly string[]) => any
  DOC_LAYOUT_VALUES: readonly string[]
  renderMap: (input: any, opts: any) => string
  renderWayfinderChild: (input: any, opts: any) => string
  renderSpec: (input: any, opts: any) => string
  slugify: (text: string) => string
}

let repoModulesPromise: Promise<RepoModules> | null = null

/**
 * 加载仓库自己的渲染器与配置文件拼装函数。
 * 仓库里这些模块写成 .js 说明符、实体是 .ts，所以命令必须带 scripts/ts-hook.mts 运行；
 * 找不到模块时给出这句提示，而不是让调用方去猜 ERR_MODULE_NOT_FOUND 是什么意思。
 */
async function repoModules(): Promise<RepoModules> {
  if (!repoModulesPromise) {
    repoModulesPromise = (async () => {
      try {
        const base = new URL('../../../', import.meta.url)
        const config = await import(new URL('src/shared/config-store/src/workspace.js', base).href)
        const layouts = await import(new URL('src/shared/doc-layout/src/layouts.js', base).href)
        const mapRender = await import(new URL('src/tracker/rooms/markdown/map-render.js', base).href)
        const createRender = await import(new URL('src/tracker/rooms/markdown/create-render.js', base).href)
        const parse = await import(new URL('src/tracker/rooms/markdown/parse.js', base).href)
        return {
          stringifyWorkspace: config.stringifyWorkspace,
          DOC_LAYOUT_VALUES: layouts.DOC_LAYOUT_VALUES,
          renderMap: mapRender.renderMap,
          renderWayfinderChild: mapRender.renderWayfinderChild,
          renderSpec: createRender.renderSpec,
          slugify: parse.slugify,
        }
      } catch (error: any) {
        throw new Error(
          '加载仓库渲染器失败：' + String(error && error.message ? error.message : error) +
            '。命令要用 node --import ./scripts/ts-hook.mts 运行（Node 24.15 及以上），否则 .js 说明符指不到同名 .ts。',
        )
      }
    })()
  }
  return repoModulesPromise
}

/** 写 docs/agents/workspace.yaml 绑定：后端编号、布局、选择时间都按插件认的版本 2 写。 */
export async function bindWorkspace(
  dir: string,
  options: { backendId: 'github' | 'markdown' | 'gitlab'; layout?: 'single' | 'multi'; pickedAt?: number },
): Promise<{ file: string; text: string; bytes: number }> {
  const mods = await repoModules()
  const value: Record<string, unknown> = {
    version: 2,
    backendId: options.backendId,
    pickedAt: options.pickedAt ?? Date.now(),
    source: 'user',
  }
  if (options.layout) value.layout = options.layout
  const result = mods.stringifyWorkspace(value, mods.DOC_LAYOUT_VALUES)
  if (!result.ok) throw new Error('生成 docs/agents/workspace.yaml 失败：' + String(result.message || result.reason || ''))
  const file = path.join(path.resolve(dir), 'docs', 'agents', 'workspace.yaml')
  ensureDir(path.dirname(file))
  writeText(file, result.text)
  return { file, text: result.text, bytes: fs.statSync(file).size }
}

/** 跑一条 git 命令；失败时把 stderr 带出来，便于判断是路径问题还是仓库状态问题。 */
function git(cwd: string, args: string[]): { stdout: string; stderr: string; code: number | null } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), code: result.status }
}

function gitOk(cwd: string, args: string[], hint: string): string {
  const result = git(cwd, args)
  if (result.code !== 0) throw new Error('git ' + args.join(' ') + ' 失败：' + (result.stderr.trim() || result.stdout.trim() || '退出码 ' + result.code) + '。' + hint)
  return result.stdout
}

/** 目录清理：只允许删批次目录与系统临时目录下的东西。 */
function prepareTarget(target: string, options: { force?: boolean }): void {
  assertWritableTarget(target)
  if (exists(target) && fs.readdirSync(target).length > 0) {
    if (!options.force) throw new Error('目标目录「' + target + '」已经有东西：换一个目录，或加 --force 清掉重建。')
    rmrf(target)
  }
  ensureDir(target)
}

/**
 * 生成 GitHub 后端工作区：源仓库某个冻结提交的 git worktree，加 docs/agents/workspace.yaml 绑定。
 * 验证过程中改这个工作区不会碰到主工作树；用完可以用 removeGithubWorkspace 清掉。
 */
export async function createGithubWorkspace(options: {
  dir: string
  sourceRepo?: string
  commit?: string
  layout?: 'single' | 'multi'
  force?: boolean
}): Promise<GeneratedWorkspace> {
  const target = path.resolve(options.dir)
  const sourceRepo = path.resolve(options.sourceRepo || repoRoot())
  if (!exists(path.join(sourceRepo, '.git')) && !exists(sourceRepo)) throw new Error('源仓库「' + sourceRepo + '」不存在。')
  const commit = (options.commit || gitOk(sourceRepo, ['rev-parse', 'HEAD'], '检查源仓库是否是一个 git 仓库。')).trim()
  assertWritableTarget(path.dirname(target))
  ensureDir(path.dirname(target))
  if (exists(target)) {
    if (!options.force) throw new Error('工作区目录「' + target + '」已经存在：换一个目录，或加 --force 清掉重建。')
    // 先尝试按 git worktree 注销，避免源仓库里留下无效登记；失败也继续删目录。
    git(sourceRepo, ['worktree', 'remove', '--force', target])
    git(sourceRepo, ['worktree', 'prune'])
    if (exists(target)) rmrf(target)
  }
  gitOk(sourceRepo, ['worktree', 'add', '--detach', target, commit], '确认该提交存在，且目标目录不在另一个工作树里。')
  if (!exists(path.join(target, '.git'))) throw new Error('worktree 看起来没建成：「' + target + '」里没有 .git。')
  const binding = await bindWorkspace(target, { backendId: 'github', layout: options.layout })
  return {
    kind: 'github',
    dir: target,
    title: path.basename(target),
    backendId: 'github',
    bindingFile: binding.file,
    extra: { sourceRepo, commit, detached: true, bindingBytes: binding.bytes },
  }
}

/** 注销一个 GitHub 工作区的 worktree 登记并删目录；验证批次收尾时调用。 */
export function removeGithubWorkspace(options: { dir: string; sourceRepo?: string; force?: boolean }): { removed: boolean; worktreePruned: boolean } {
  const target = path.resolve(options.dir)
  assertWritableTarget(target)
  const sourceRepo = path.resolve(options.sourceRepo || repoRoot())
  let pruned = false
  if (exists(path.join(sourceRepo, '.git')) || exists(sourceRepo)) {
    git(sourceRepo, ['worktree', 'remove', '--force', target])
    const pruneResult = git(sourceRepo, ['worktree', 'prune'])
    pruned = pruneResult.code === 0
  }
  if (exists(target)) rmrf(target)
  return { removed: !exists(target), worktreePruned: pruned }
}

/**
 * 离线冷启动工作区：一个空目录，没有仓库、没有任何绑定与 .scratch。
 * 用来验证插件在「没网、没仓库、第一次见到这个目录」时能不能正常启动并显示未初始化状态。
 * 传 git=true 时额外初始化一个只有初始提交的本地仓库（仍然不联网），用来区分「没有仓库」与「有仓库但没绑定」。
 */
export function createColdWorkspace(options: { dir: string; git?: boolean; force?: boolean }): GeneratedWorkspace {
  const target = path.resolve(options.dir)
  prepareTarget(target, { force: options.force })
  const extra: Record<string, any> = { git: false }
  if (options.git) {
    gitOk(target, ['init'], '检查本机 git 是否可用。')
    gitOk(target, ['-c', 'user.email=harness@example.invalid', '-c', 'user.name=harness', 'commit', '--allow-empty', '-m', '离线冷启动工作区的初始提交'], '检查 git 的用户配置。')
    extra.git = true
    extra.head = gitOk(target, ['rev-parse', 'HEAD'], '检查初始提交是否成功。').trim()
  }
  const readme = path.join(target, 'README.md')
  writeText(readme, '# 离线冷启动工作区\n\n这是验证夹具：目录是空的，没有 docs/agents/workspace.yaml，也没有 .scratch/。\n插件第一次看到它时应当能离线启动，并显示尚未初始化。\n')
  return { kind: 'cold', dir: target, title: path.basename(target), backendId: 'none', extra }
}

export interface MarkdownChildSpec {
  /** 子票标题，通常是一个问句。 */
  title: string
  /** wayfinder 类型词：research / prototype / grilling / task，默认 research。 */
  type?: string
  body?: string
  /** 状态行取值，默认 open。 */
  status?: string
  /** 被哪些子票阻塞（编号字符串）。 */
  blockedBy?: string[]
  labels?: string[]
  assignees?: string[]
}

export interface MarkdownEffortSpec {
  /** .scratch/ 下的目录名，越具体越好；长名字能顺便验证长路径。 */
  name: string
  title?: string
  body?: string
  children?: MarkdownChildSpec[]
}

export interface MarkdownWorkspaceOptions {
  dir: string
  efforts?: MarkdownEffortSpec[]
  layout?: 'single' | 'multi'
  bind?: boolean
  force?: boolean
}

const DEFAULT_EFFORTS: MarkdownEffortSpec[] = [
  {
    name: 'card-flicker-and-layout-shift-on-workspace-switch-2026-10',
    title: '工作区切换时卡片闪烁与布局跳动',
    body: '验证工作区切换、状态栏折叠、面板展开时卡片是否闪烁或布局跳动。',
    children: [
      { title: '卡片闪烁是不是因为切换后重复渲染？', type: 'research', body: '用浏览器工具录下连续两次截图与 DOM 文本。' },
      { title: '布局跳动是不是因为状态栏高度先算错再修正？', type: 'prototype', body: '给状态栏加固定高度试一次。' },
      { title: '面板展开时滚动位置会不会被重置？', type: 'grilling', body: '对比展开前后的 scrollTop。' },
    ],
  },
  {
    name: 'rate-limit-and-quota-observability-for-workspace-actions',
    title: '工作区操作触发限流时的可观测性',
    body: '验证限流命中时插件是否把原因、等待时间与重试次数写清楚。',
    children: [
      { title: '限流错误在界面上有没有说明为什么会失败？', type: 'research', body: '构造一次 429 响应，看界面提示。' },
      { title: '重试次数与等待时间有没有进日志？', type: 'task', body: '按事件名检索日志。' },
    ],
  },
]

/**
 * 生成 Markdown 后端工作区：多个长名字 .scratch/<effort>/，每个含 map.md 与 issues/ 子票。
 * 默认两套 effort、共五张子票；也可以传自己的 efforts。绑定文件默认写 markdown 后端。
 */
export async function createMarkdownWorkspace(options: MarkdownWorkspaceOptions): Promise<GeneratedWorkspace> {
  const target = path.resolve(options.dir)
  prepareTarget(target, { force: options.force })
  const mods = await repoModules()
  const efforts = options.efforts && options.efforts.length > 0 ? options.efforts : DEFAULT_EFFORTS
  const createdAt = nowIso()
  const stampText = String(Date.now())
  const generatedEfforts: any[] = []
  for (const effort of efforts) {
    const effortDir = path.join(target, '.scratch', effort.name)
    const issuesDir = path.join(effortDir, 'issues')
    ensureDir(issuesDir)
    const mapFile = path.join(effortDir, 'map.md')
    const mapText = mods.renderMap(
      { title: effort.title || effort.name, body: effort.body || '（夹具地图，用于验证 Markdown 后端渲染。）' },
      { createdAt, idempotencyKey: 'harness-' + effort.name + '-map-' + stampText, labels: ['wayfinder:map'], assignees: [] },
    )
    writeText(mapFile, mapText)
    const childFiles: any[] = []
    const children = effort.children || []
    children.forEach((child, index) => {
      const number = String(index + 1).padStart(2, '0')
      const type = child.type || 'research'
      const childText = mods.renderWayfinderChild(
        {
          title: child.title,
          body: child.body || '',
          typeLine: type,
          status: child.status || 'open',
          blockedBy: child.blockedBy || [],
        },
        {
          number,
          createdAt,
          idempotencyKey: 'harness-' + effort.name + '-child-' + number + '-' + stampText,
          labels: child.labels || ['wayfinder:' + type],
          assignees: child.assignees || [],
          parentKey: '00',
        },
      )
      const slug = mods.slugify(child.title) || 'ticket'
      const childFile = path.join(issuesDir, number + '-' + slug + '.md')
      writeText(childFile, childText)
      childFiles.push({ number, title: child.title, file: childFile, type })
    })
    const stats = dirStats(effortDir)
    generatedEfforts.push({ name: effort.name, dir: effortDir, mapFile, children: childFiles, files: stats.files, bytes: stats.bytes })
  }
  let binding: { file: string; text: string; bytes: number } | undefined
  if (options.bind !== false) binding = await bindWorkspace(target, { backendId: 'markdown', layout: options.layout || 'multi' })
  return {
    kind: 'markdown',
    dir: target,
    title: path.basename(target),
    backendId: options.bind === false ? 'none' : 'markdown',
    bindingFile: binding && binding.file,
    extra: { efforts: generatedEfforts },
  }
}

/** 1612 要用的 A/B 两个工作区：形状相同、内容不同，便于验证设置与视图互不影响。 */
export async function createAbWorkspaces(options: { baseDir: string; force?: boolean }): Promise<[GeneratedWorkspace, GeneratedWorkspace]> {
  const baseDir = path.resolve(options.baseDir)
  assertWritableTarget(baseDir)
  ensureDir(baseDir)
  const a = await createMarkdownWorkspace({
    dir: path.join(baseDir, 'ws-a'),
    force: options.force,
    layout: 'multi',
    efforts: [
      {
        name: 'alpha-long-effort-name-for-settings-and-view-isolation-check-2026-10',
        title: '工作区 A 的验证地图',
        body: 'A 工作区只用来验证自己的设置与视图。',
        children: [
          { title: 'A 工作区设置改动会不会影响 B？', type: 'research', body: '在 A 里改状态栏折叠，确认 B 不变。' },
          { title: 'A 工作区切走再切回时视图会不会丢？', type: 'task', body: '记录切换前后的卡片数量。' },
        ],
      },
    ],
  })
  a.title = '工作区 A'
  const b = await createMarkdownWorkspace({
    dir: path.join(baseDir, 'ws-b'),
    force: options.force,
    layout: 'single',
    efforts: [
      {
        name: 'beta-long-effort-name-for-cross-workspace-isolation-check-2026-10',
        title: '工作区 B 的验证地图',
        body: 'B 工作区与 A 使用不同布局，用来验证两个实例互不串味。',
        children: [{ title: 'B 工作区布局是 single，切到 A 的 multi 会不会串？', type: 'prototype', body: '两个实例各自打开一个工作区，对比布局。' }],
      },
    ],
  })
  b.title = '工作区 B'
  return [a, b]
}

/** 把生成结果写成清单，放到批次目录里；commands/make-workspace 会调用它。 */
export function writeWorkspaceManifest(batchDir: string, workspaces: GeneratedWorkspace[]): string {
  const file = path.join(path.resolve(batchDir), 'workspaces.json')
  ensureDir(path.dirname(file))
  writeJson(file, { generatedAt: nowIso(), workspaces })
  return file
}