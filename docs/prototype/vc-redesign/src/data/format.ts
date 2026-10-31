/**
 * data/format.ts —— 把真实数据翻成界面直接可用的说法，纯函数，不碰 DOM。
 *
 * 时间一律走真实 state.ts 的 describeTime()：近一周返回分钟数、更早返回绝对时间戳。
 * 中文说法在这里补，和真实客户端 vcText.ts 的分工一致（核心只给结构化判断）。
 */
import { describeTime } from './core'
import type { BranchSync, FileChange } from './core'

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；超出七天用绝对日期。 */
export function whenText(nowMs: number, ms: number): string {
  const described = describeTime(nowMs, ms)
  if (described.style === 'absolute') return clockText(described.ms, nowMs)
  const minutes = described.minutes
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 绝对时间：同年省掉年份，跨年带上年份。 */
function clockText(ms: number, nowMs: number): string {
  const date = new Date(ms)
  const now = new Date(nowMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const month = date.getMonth() + 1
  const day = date.getDate()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.getFullYear() === now.getFullYear() ? `${month} 月 ${day} 日 ${time}` : `${date.getFullYear()} 年 ${month} 月 ${day} 日`
}

/** 把路径拆成「目录」和「文件名」两段：界面靠字号区分，不从中段截断文件名。 */
export function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, '/')
  const cut = normalized.lastIndexOf('/')
  if (cut < 0) return { dir: '', name: normalized }
  return { dir: normalized.slice(0, cut + 1), name: normalized.slice(cut + 1) }
}

/** 变更类型在权限上的字母徽章：A / M / D / R / T / ? 。 */
export function changeBadge(change: FileChange): { letter: string; tone: ChangeTone } {
  switch (change) {
    case 'added': return { letter: 'A', tone: 'add' }
    case 'deleted': return { letter: 'D', tone: 'del' }
    case 'renamed': return { letter: 'R', tone: 'rename' }
    case 'typechange': return { letter: 'T', tone: 'type' }
    case 'untracked': return { letter: '?', tone: 'untracked' }
    default: return { letter: 'M', tone: 'mod' }
  }
}

export type ChangeTone = 'add' | 'mod' | 'del' | 'rename' | 'type' | 'untracked'

/** 同步状态：有领先落后时给两个独立计数，其余状态给一句话。 */
export type SyncModel =
  | { kind: 'counts'; ahead: number; behind: number }
  | { kind: 'text'; text: string; tone: 'muted' | 'warn' }

export function syncModel(sync: BranchSync, ahead: number, behind: number): SyncModel {
  switch (sync) {
    case 'tracked-known':
    case 'tracked-unknown':
      return { kind: 'counts', ahead, behind }
    case 'no-upstream':
      return { kind: 'text', text: '尚未设置上游', tone: 'muted' }
    case 'upstream-gone':
      return { kind: 'text', text: '推送目标已不存在', tone: 'warn' }
    case 'detached':
      return { kind: 'text', text: '分离头指针', tone: 'muted' }
    default:
      return { kind: 'text', text: '同步状态读不到', tone: 'warn' }
  }
}

/**
 * 行数差：null（未跟踪或读不到）时不显示，不造 0。
 * 0 也算「没有」：纯新增文件的删除行、纯删除文件的新增行都会是 0，
 * 画成「+2 −0」会让读者先去找那 0 行在哪，所以直接不显示。
 */
export function lineDelta(added: number | null, deleted: number | null): { added: string | null; deleted: string | null } {
  return {
    added: added === null || added === 0 ? null : `+${added}`,
    deleted: deleted === null || deleted === 0 ? null : `−${deleted}`,
  }
}

/** 提交短号：保留七位，和 git 默认一致。 */
export function shortOid(oid: string): string {
  return oid.slice(0, 7)
}
