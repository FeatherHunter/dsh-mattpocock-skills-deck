// log-query —— 定位实例日志，按事件名、级别、字段检索，并可断言条数。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/log-query.mts
//         --log <启动目录 | instance.json | 日志目录 | 日志文件> [--date YYYY-MM-DD]
//         [--event 事件名 ...] [--level info|warn|error] [--field 字段=值 ...]
//         [--since-ms 毫秒时间] [--tail 20] [--assert-min 1] [--assert-count 3] [--json-out <文件>]
//
// 输出：文件路径、事件总数、按事件名与级别的统计、匹配到的最近 N 条。
// 断言不满足时退出码 1。

import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, parseArgs, printJson, runCli } from '../lib/util.mts'
import { findLogFile, queryLogEvents, readLogEvents, summarizeLogEvents, type LogQuery } from '../lib/logs.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const target = args.require('log', '启动目录、instance.json、日志目录或日志文件')
  const file = findLogFile(target, { date: args.get('date') })
  const read = readLogEvents(file)
  const fields: Record<string, string | number | boolean> = {}
  for (const pair of args.getAll('field')) {
    const eq = pair.indexOf('=')
    if (eq < 0) throw new Error('--field 要写成 字段=值，收到「' + pair + '」。')
    const key = pair.slice(0, eq)
    const raw = pair.slice(eq + 1)
    fields[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw
  }
  const query: LogQuery = {
    event: args.getAll('event').length === 0 ? undefined : args.getAll('event'),
    level: args.get('level'),
    fields: Object.keys(fields).length === 0 ? undefined : fields,
    sinceMs: args.get('since-ms') ? Number(args.get('since-ms')) : undefined,
  }
  const matches = queryLogEvents(read.events, query)
  const tail = args.get('tail') ? Number(args.get('tail')) : 20
  const assertions: { name: string; ok: boolean; detail: string }[] = []
  if (args.has('assert-min')) {
    const want = Number(args.require('assert-min'))
    assertions.push({ name: '匹配条数 >= ' + want, ok: matches.length >= want, detail: '实际 ' + matches.length })
  }
  if (args.has('assert-count')) {
    const want = Number(args.require('assert-count'))
    assertions.push({ name: '匹配条数 == ' + want, ok: matches.length === want, detail: '实际 ' + matches.length })
  }
  if (args.has('assert-no-bad-lines')) {
    assertions.push({ name: '没有坏行', ok: read.badLines === 0, detail: '坏行数 ' + read.badLines })
  }
  const result = {
    file,
    matchCount: matches.length,
    badLines: read.badLines,
    summary: summarizeLogEvents(read.events),
    matches: matches.slice(-tail).map((entry) => ({ line: entry.line, ts: entry.ts, level: entry.level, event: entry.event, json: entry.json })),
    assertions,
    ok: assertions.every((entry) => entry.ok),
  }
  const jsonOut = args.get('json-out')
  if (jsonOut) {
    ensureDir(path.dirname(path.resolve(jsonOut)))
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(result, null, 2) + '\n', 'utf8')
  }
  printJson(result)
  if (!result.ok) process.exitCode = 1
})
