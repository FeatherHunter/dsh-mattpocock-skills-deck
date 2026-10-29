// logs.mts —— 插件日志工具：定位启动目录下的日志文件，按事件名与字段检索、断言。
//
// 插件把日志写到「DSH 进程的当前目录」下的 .dsh-mattskillsdeck-cache/logs/<当天日期>.log，
// 每行是一条 JSON。本工具只读，不写日志文件。

import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_CACHE_DIR } from './home.mts'
import { exists, isDir, today } from './util.mts'

export interface LogEvent {
  line: number
  raw: string
  json: any
  event: string
  level: string
  ts: number | null
}

export interface LogQuery {
  /** 事件名，全等匹配；省略表示不限。 */
  event?: string | string[]
  /** 级别，例如 info / warn / error。 */
  level?: string
  /** 字段条件：字段名到期望值的映射；字符串用包含比较，其它用全等。 */
  fields?: Record<string, string | number | boolean>
  /** 只取时间戳在这个毫秒时间之后的记录（配合实例启动时间可只看本次启动）。 */
  sinceMs?: number
}

/** 找日志文件：可以给启动目录、instance.json、日志目录，或直接给文件。不给日期时取最新一份。 */
export function findLogFile(target: string, options: { date?: string } = {}): string {
  const resolved = path.resolve(target)
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
  let logDir = resolved
  const instanceFile = path.join(resolved, 'instance.json')
  if (!options.date && isDir(resolved) && exists(instanceFile)) {
    try {
      const instance = JSON.parse(fs.readFileSync(instanceFile, 'utf8'))
      const fromInstance = String((instance && instance.pluginLogFile) || '')
      if (fromInstance && exists(fromInstance)) return fromInstance
      const logDirFromInstance = String((instance && instance.pluginLogDir) || '')
      if (logDirFromInstance && isDir(logDirFromInstance)) logDir = logDirFromInstance
    } catch {
      // 实例文件读不了就按普通目录处理。
    }
  } else if (isDir(path.join(resolved, 'logs'))) logDir = path.join(resolved, 'logs')
  else if (!resolved.endsWith(PLUGIN_CACHE_DIR + path.sep + 'logs') && !isDir(resolved)) {
    throw new Error('找不到日志目录「' + resolved + '」：给启动目录、实例文件或 .dsh-mattskillsdeck-cache/logs 目录。')
  }
  if (!isDir(logDir)) throw new Error('日志目录「' + logDir + '」不存在：实例还没启动过，或启动目录不对。')
  if (options.date) {
    const file = path.join(logDir, options.date + '.log')
    if (!exists(file)) throw new Error('没有 ' + options.date + ' 的日志：「' + file + '」不存在。')
    return file
  }
  const files = fs
    .readdirSync(logDir)
    .filter((name: string) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .map((name: string) => ({ name, file: path.join(logDir, name) }))
    .sort((left: { name: string }, right: { name: string }) => (left.name < right.name ? 1 : -1))
  if (files.length === 0) throw new Error('日志目录「' + logDir + '」里还没有日志文件。')
  return files[0].file
}

/** 读全部日志事件；坏行跳过并计数，不因一行坏了就整体失败。 */
export function readLogEvents(file: string): { file: string; events: LogEvent[]; badLines: number } {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const events: LogEvent[] = []
  let badLines = 0
  lines.forEach((raw: string, index: number) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    try {
      const json = JSON.parse(trimmed)
      events.push({
        line: index + 1,
        raw: trimmed,
        json,
        event: String(json.event || ''),
        level: String(json.level || ''),
        ts: typeof json.ts === 'number' ? json.ts : null,
      })
    } catch {
      badLines += 1
    }
  })
  return { file, events, badLines }
}

function matchValue(actual: any, expected: string | number | boolean): boolean {
  if (actual === undefined || actual === null) return false
  if (typeof expected === 'string') return String(actual).indexOf(expected) >= 0
  return actual === expected
}

/** 按事件名、级别、字段与时间过滤日志。 */
export function queryLogEvents(events: LogEvent[], query: LogQuery): LogEvent[] {
  const eventsFilter = query.event === undefined ? null : Array.isArray(query.event) ? query.event : [query.event]
  return events.filter((entry) => {
    if (eventsFilter && eventsFilter.indexOf(entry.event) < 0) return false
    if (query.level && entry.level !== query.level) return false
    if (query.sinceMs !== undefined && (entry.ts === null || entry.ts < query.sinceMs)) return false
    if (query.fields) {
      const fields = entry.json && entry.json.fields ? entry.json.fields : {}
      for (const key of Object.keys(query.fields)) {
        const expected = query.fields[key]
        const actual = fields[key] !== undefined ? fields[key] : entry.json[key]
        if (!matchValue(actual, expected)) return false
      }
    }
    return true
  })
}

/** 统计每种事件出现了几次，用于快速看一趟启动里都发生了什么。 */
export function summarizeLogEvents(events: LogEvent[]): { total: number; firstTs: number | null; lastTs: number | null; byEvent: Record<string, number>; byLevel: Record<string, number> } {
  const byEvent: Record<string, number> = {}
  const byLevel: Record<string, number> = {}
  let firstTs: number | null = null
  let lastTs: number | null = null
  for (const entry of events) {
    if (entry.event) byEvent[entry.event] = (byEvent[entry.event] || 0) + 1
    if (entry.level) byLevel[entry.level] = (byLevel[entry.level] || 0) + 1
    if (entry.ts !== null) {
      if (firstTs === null || entry.ts < firstTs) firstTs = entry.ts
      if (lastTs === null || entry.ts > lastTs) lastTs = entry.ts
    }
  }
  return { total: events.length, firstTs, lastTs, byEvent, byLevel }
}

/** 等到某个事件出现；超时抛出带「现在有哪些事件」的说明。 */
export async function waitForLogEvent(
  target: string,
  query: LogQuery & { timeoutMs?: number; pollMs?: number },
): Promise<{ file: string; matches: LogEvent[] }> {
  const timeoutMs = query.timeoutMs ?? 15000
  const pollMs = query.pollMs ?? 200
  const startedAt = Date.now()
  let file = ''
  let best: LogEvent[] = []
  while (Date.now() - startedAt < timeoutMs) {
    try {
      file = findLogFile(target)
      const read = readLogEvents(file)
      const matches = queryLogEvents(read.events, query)
      if (matches.length > 0) return { file, matches }
      best = read.events
    } catch {
      // 日志文件或目录还没出现，继续等。
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  const names = Array.from(new Set(best.map((entry) => entry.event))).join('、')
  throw new Error('等了 ' + timeoutMs + 'ms 没等到匹配的日志事件。现有事件：' + (names || '（还没有日志）') + '。')
}

/** 今天的日期字符串，日志工具里也常用。 */
export { today }
