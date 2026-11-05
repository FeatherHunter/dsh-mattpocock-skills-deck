// 门禁归属: tests/verify-1903-history-entries.ts
/**
 * src/host/versionControlLogFiles.ts —— 给一批提交补上「改到了哪些文件」「哪几条有备注」（#1903）
 *
 * 为什么单独成一个叶子：两处都要这份读数 —— 首屏聚合的历史片（列表一打开就要能按文件搜、
 * 有备注的行一打开就带标记）与 wf.gitLog（「加载更早的提交」续读回来的那几批）。
 * 两处各写一遍就会有一处忘了补，症状是「同一个词，首屏那些提交搜得到、续读回来的搜不到」。
 * 所以只有这一份读法。
 *
 * 边界：这是两条「锦上添花」的读 —— 读不到就把路径留空 / 把备注标记记为「没有」，
 * 历史片与续读本身照常可用，不因为补不上就让整块变红。合并提交与空提交本来就没有文件清单，
 * 它们在结果里就是空数组，不补假数据。
 *
 * 依赖全部由调用方传入（与同目录其它叶子同一约定）：本文件不自取仓库、不拿时钟、不读环境。
 */
import { commandFor } from '../shared/version-control/src/commands.js'
import { parseLogFiles } from '../shared/version-control/src/parse-log.js'

/** 文件路径清单最多读这么大：一批 50 条提交的路径清单远小于这个数，超了就是不正常，按「读不到」处理。 */
const NAMES_LIMIT: number = 4 * 1024 * 1024
/** git notes list 的输出上限：一行「备注对象 提交号」，一万条备注也只有几百 KB。 */
const NOTES_LIMIT: number = 2 * 1024 * 1024

/**
 * 读一批提交各自改到的文件：回「提交号 → 路径数组」，读不到回 null。
 * skip 与这次日志读取的 skip 必须一致，否则补上的文件名会错位到别的提交上。
 */
export async function readCommitFilePaths(runPinned: any, exe: any, root: any, count: any, skip: any): Promise<Record<string, string[]> | null> {
  const n: number = Number(count)
  if (!isFinite(n) || n <= 0) return {}
  try {
    const res: any = await runPinned(exe, root, (commandFor('log', { logCount: n, logNames: true, logSkip: Number(skip) || 0 }) as any).args, { stdoutLimit: NAMES_LIMIT })
    if (!res || res.kind !== 'ok' || res.truncated) return null
    const parsed: any = parseLogFiles(res.stdout)
    if (parsed.ok !== true) return null
    const byOid: Record<string, string[]> = {}
    for (let i = 0; i < parsed.commits.length; i += 1) byOid[String(parsed.commits[i].oid)] = parsed.commits[i].paths
    return byOid
  } catch (e) {
    return null
  }
}

/** 哪些提交挂着备注：回提交号集合，读不到回 null（界面据此不画「备注」标记，而不是画成「没有」）。 */
export async function readNoteIndex(runPinned: any, exe: any, root: any): Promise<Record<string, boolean> | null> {
  try {
    const res: any = await runPinned(exe, root, ['notes', 'list'], { stdoutLimit: NOTES_LIMIT })
    // git notes list 在没有备注时退出码是 0、输出为空；仓库还没有提交时退出码非零，按「读不到」处理。
    if (!res || res.kind !== 'ok' || res.truncated) return null
    const out: Record<string, boolean> = {}
    const lines: string[] = String(res.stdout || '').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line: string = lines[i].trim()
      if (line === '') continue
      const at: number = line.lastIndexOf(' ')
      if (at <= 0) continue
      const oid: string = line.slice(at + 1).trim()
      if (/^[0-9a-f]{40}$/.test(oid) || /^[0-9a-f]{64}$/.test(oid)) out[oid] = true
    }
    return out
  } catch (e) {
    return null
  }
}

/**
 * 把两份读贴到提交记录上：paths 是这条提交改到的文件（读不到就是空数组），
 * hasNote 是这条提交有没有备注（读不到一律 false，界面上就是没有标记）。
 */
export async function attachCommitFileInfo(runPinned: any, exe: any, root: any, commits: any[], skip: any): Promise<void> {
  if (!Array.isArray(commits) || commits.length === 0) return
  const byOid: Record<string, string[]> | null = await readCommitFilePaths(runPinned, exe, root, commits.length, skip)
  const notes: Record<string, boolean> | null = await readNoteIndex(runPinned, exe, root)
  for (let i = 0; i < commits.length; i += 1) {
    const oid: string = String(commits[i] && commits[i].oid)
    commits[i].paths = byOid && Object.prototype.hasOwnProperty.call(byOid, oid) ? byOid[oid] : []
    commits[i].hasNote = !!(notes && notes[oid] === true)
  }
}

export const LOG_FILES_SOURCE = 'src/host/versionControlLogFiles.ts'
