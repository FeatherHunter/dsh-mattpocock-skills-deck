// cleanup —— 清理验证批次产物：先报占用与文件数，确认后才删。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/cleanup.mts
//         [--root <工作根>]             默认 <工作根>（或环境变量 DSH_VERIFY_WORK_ROOT、仓库 .scratch/verify-run）
//         [--yes]                       真的删除；不加只报账，不动任何文件
//         [--keep-batches 2]            保留最近的几个批次目录
//         [--keep-homes 0]              保留最近的几个隔离 home（home 复制只要一两秒，默认不留）
//         [--include-pkg]               连候选包目录一起算作可删（默认只报账，不删）
//
// 输出：一段 JSON，含每个目录的文件数/字节数/最后修改时间、将要删除的清单、实际删掉的清单与释放的空间。
// 不加 --yes 时 exited 0 且 deleted 为空——这一步只用来让人看清「要删多少」。
//
// 为什么要有这条命令：一次真机批次会留下复制出来的 home（3 万多个文件）、截图、日志与探针目录，
// 2026-10 的一次验收堆到 4.3GB / 4.9 万个文件。清理时机与上限写在
// docs/agents/real-machine-verification.md 的「工具与环境」一节，这里是执行它的唯一入口。

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, printJson, runCli, exists, isDir, dirStats, rmrf, nowIso, formatMs, info, assert } from '../lib/util.mts'
import { workRoot, assertWritableTarget } from '../lib/paths.mts'

interface CleanupEntry {
  name: string
  path: string
  kind: 'batch' | 'home' | 'tmp' | 'pkg' | 'other'
  files: number
  bytes: number
  lastModified: string
  action: 'delete' | 'keep' | 'report-only'
  reason: string
}

function lastModifiedMs(target: string): number {
  let newest = 0
  const walk = (current: string): void => {
    let entries: any[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      try {
        const stat = fs.statSync(abs)
        newest = Math.max(newest, stat.mtimeMs)
      } catch {
        continue
      }
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(target)
  return newest
}

function describe(target: string, kind: CleanupEntry['kind'], action: CleanupEntry['action'], reason: string): CleanupEntry {
  const stats = dirStats(target)
  const modified = lastModifiedMs(target)
  return {
    name: path.basename(target),
    path: target,
    kind,
    files: stats.files,
    bytes: stats.bytes,
    lastModified: modified ? new Date(modified).toISOString() : '',
    action,
    reason,
  }
}

/** 按最后修改时间从新到旧排序，前 keepCount 个保留，其余标记删除。 */
function planGroup(dir: string, kind: 'batch' | 'home', keepCount: number, entries: CleanupEntry[]): void {
  if (!isDir(dir)) return
  const children = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => path.join(dir, entry.name))
  const sorted = children
    .map((target: string) => ({ target, modified: lastModifiedMs(target) }))
    .sort((a: { modified: number }, b: { modified: number }) => b.modified - a.modified)
  sorted.forEach((item: { target: string; modified: number }, index: number) => {
    const keep = index < keepCount
    entries.push(
      describe(
        item.target,
        kind,
        keep ? 'keep' : 'delete',
        keep ? '最近的 ' + keepCount + ' 个之内，保留' : '超出保留数量，重建代价很小',
      ),
    )
  })
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const root = path.resolve(args.get('root') || workRoot())
  assertWritableTarget(root)
  assert(exists(root), '工作根不存在，没有可清理的东西：' + root)
  const keepBatches = args.get('keep-batches') ? Number(args.get('keep-batches')) : 2
  const keepHomes = args.get('keep-homes') ? Number(args.get('keep-homes')) : 0
  assert(Number.isFinite(keepBatches) && keepBatches >= 0, '--keep-batches 必须是不小于 0 的数字')
  assert(Number.isFinite(keepHomes) && keepHomes >= 0, '--keep-homes 必须是不小于 0 的数字')

  const entries: CleanupEntry[] = []
  planGroup(path.join(root, 'batches'), 'batch', keepBatches, entries)
  planGroup(path.join(root, 'homes'), 'home', keepHomes, entries)

  const tmpDir = path.join(root, 'tmp')
  if (isDir(tmpDir)) {
    for (const name of fs.readdirSync(tmpDir, { withFileTypes: true }).filter((entry: any) => entry.isDirectory())) {
      entries.push(describe(path.join(tmpDir, name.name), 'tmp', 'delete', '临时目录，随时可重建'))
    }
  }

  const pkgDir = path.join(root, 'pkg')
  if (isDir(pkgDir)) {
    if (args.has('include-pkg')) entries.push(describe(pkgDir, 'pkg', 'delete', '--include-pkg 指定连候选包一起清'))
    else entries.push(describe(pkgDir, 'pkg', 'report-only', '候选包与清单，发布核对要用，默认不删'))
  }

  // 工作根下不属于上面几类的目录只报账，绝不猜着删。
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (['batches', 'homes', 'tmp', 'pkg'].includes(entry.name)) continue
    entries.push(describe(path.join(root, entry.name), 'other', 'report-only', '不属于已知类别，只报账不删'))
  }

  const totals = entries.reduce(
    (sum, entry) => ({ files: sum.files + entry.files, bytes: sum.bytes + entry.bytes }),
    { files: 0, bytes: 0 },
  )
  const toDelete = entries.filter((entry) => entry.action === 'delete')
  const plannedBytes = toDelete.reduce((sum, entry) => sum + entry.bytes, 0)
  const plannedFiles = toDelete.reduce((sum, entry) => sum + entry.files, 0)

  const summary = {
    root,
    generatedAt: nowIso(),
    dryRun: !args.has('yes'),
    keepBatches,
    keepHomes,
    totals,
    planned: { entries: toDelete.length, files: plannedFiles, bytes: plannedBytes },
    guidance: {
      suggestedLimit: '工作根总量建议不超过 15GB、批次目录不超过 20 个、单个批次不超过 2GB；超过就先清理再开新批次。',
      timing: '每次真机批次结束、发布前、以及换版本重跑之前各清一次；隔离 home 可随时清（复制约 1.5 秒重建）。',
    },
    entries,
    deleted: [] as string[],
    freedBytes: 0,
  }

  if (!args.has('yes')) {
    info('只报账，未删除任何文件。确认无误后加 --yes 执行。')
    printJson(summary)
    return
  }

  const started = Date.now()
  for (const entry of toDelete) {
    rmrf(entry.path)
    summary.deleted.push(entry.path)
    if (entry.kind !== 'pkg') summary.freedBytes += entry.bytes
  }
  info('已删除 ' + summary.deleted.length + ' 个目录，用时 ' + formatMs(Date.now() - started))
  printJson(summary)
})
