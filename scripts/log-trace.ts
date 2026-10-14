// scripts/log-trace.ts —— 日志阅读器：把一份日志（或一个日志目录）里「一趟操作」的行挑出来按时间排好。
//
// 为什么要有它：仓里的日志纪律写着「新流程与核心链路用当天导出包走一遍，只看日志定位」。在这之前，
// 这句话只能靠人肉在几十行长得一样的记录里找。这个脚本把「一趟操作」当成一个可检索的对象：
// 宿主起这一趟时生成的编号（opId）同时记在宿主那一层（host.call / host.call.fail）与房间那一层
// （gh.exec / read.degraded / preflight.gate），于是两层能靠一个键对上，不必再按时间戳猜。
//
// 怎么用（两个子命令）：
//   1. 先看这一份日志里有哪些操作：
//        node scripts/log-trace.ts list <日志文件或日志目录>
//      输出每趟操作的编号、起止时刻、花了多久、成没成、起了几条外部命令、有没有降级结论。
//   2. 挑一趟，把它按时间排出来看：
//        node scripts/log-trace.ts show <日志文件或日志目录> <操作编号>
//      输出这一趟的每一行：相对起点的偏移、事件名、关键字段（读得懂的那几个，其余不铺开）。
//
// 为什么单独写一份、不塞进门禁：这是给人（和 AI）事后排查用的阅读器，不是「代码有没有违反规矩」的断言。
// 门禁管的是「字段该不该记」，这里管的是「记下来的东西能不能读出一趟操作走到哪一步」。
//
// 边界：只读，不改任何文件；认不出的行跳过并计数（不因为一行坏掉就整份读不出来）。
//
// 为什么是 .ts：AGENTS.md「TypeScript 优先」一节要求新写的源码一律 .ts（手写 JavaScript 名单是棘轮，
// 涨了 typecheck 就红）。这份文件里每个读日志用的形状都写成了接口——日志是外部数据，字段随版本变，
// 类型在这里的作用是「读错字段名当场看得见」，不是给内部结构上锁。
// 跑法用 Node 自带的类型剥离（engines 要求 22.22.2 及以上，自带剥离），不需要先构建。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 日志里的一行。字段是外部数据，只声明本脚本真读的那几个，其余原样放着。 */
interface LogLine {
  /** 这一行落盘的毫秒时间戳，排序与算偏移都用它。 */
  ts?: number
  /** 事件名，例如 gh.exec、host.call、read.degraded。 */
  event?: string
  /** 这一行的字段包，opId 就藏在里面。 */
  fields?: Record<string, unknown>
}

/** 一趟操作的概览，list 一行、show 的表头都用它。 */
interface OpSummary {
  opId: string
  startTs: number
  endTs: number
  wallMs: number
  methods: string[]
  verdict: string
  hostLatencyMs: number
  ghCount: number
  ghVia: string[]
  gates: number[]
  degraded: string[]
}

/** 一行坏行也不丢：解析不出来的计数，最后一起交代。 */
function parseLines(text: string): { entries: LogLine[]; bad: number } {
  const out: LogLine[] = []
  let bad = 0
  for (const line of String(text || '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as unknown
      if (o && typeof o === 'object' && (o as LogLine).event) out.push(o as LogLine)
      else bad += 1
    } catch {
      bad += 1
    }
  }
  return { entries: out, bad }
}

/** 输入可以是单个文件，也可以是一个目录（目录里所有 .log 都读）。 */
function collectFiles(input: string): { files: string[]; error: string } {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(input)
  } catch {
    return { files: [], error: '读不到这个路径：' + input }
  }
  if (st.isFile()) return { files: [input], error: '' }
  const files: string[] = []
  try {
    for (const name of readdirSync(input)) {
      if (!/\.log$/i.test(name)) continue
      const p = join(input, name)
      try {
        if (statSync(p).isFile()) files.push(p)
      } catch {
        // 单个文件探不到就跳过：目录里有个读不动的条目，不该让整份日志读不出来。
      }
    }
  } catch {
    return { files: [], error: '列不出这个目录：' + input }
  }
  return { files: files.sort(), error: '' }
}

function readAll(files: string[]): { entries: LogLine[]; bad: number } {
  const entries: LogLine[] = []
  let bad = 0
  for (const f of files) {
    let text = ''
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const parsed = parseLines(text)
    entries.push(...parsed.entries)
    bad += parsed.bad
  }
  entries.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  return { entries, bad }
}

/** 时间戳只用来给人看，取本地时区的时分秒。 */
function hhmmss(ts: unknown): string {
  const d = new Date(Number(ts) || 0)
  const p = (n: number): string => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

/** 耗时字段收敛成非负整数毫秒；没有、是负数、不是数字，一律回 0。 */
function msOf(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** 一趟操作 = 同一个 opId 的那些行。没有编号的行单独成组，末尾一并交代。 */
function groupByOpId(entries: LogLine[]): { groups: Map<string, LogLine[]>; noId: LogLine[] } {
  const groups = new Map<string, LogLine[]>()
  const noId: LogLine[] = []
  for (const e of entries) {
    const id = e.fields && typeof e.fields.opId === 'string' ? e.fields.opId : ''
    if (!id) {
      noId.push(e)
      continue
    }
    const bucket = groups.get(id)
    if (bucket) bucket.push(e)
    else groups.set(id, [e])
  }
  return { groups, noId }
}

/** 一趟操作的概览：起止、耗时、成没成、起了几条外部命令、有哪些降级结论。 */
function summarize(rows: LogLine[]): OpSummary {
  const first = rows[0]
  const last = rows[rows.length - 1]
  const host = rows.filter((r) => r.event === 'host.call' || r.event === 'host.call.fail')
  const okRow = host.find((r) => r.event === 'host.call')
  const failRow = host.find((r) => r.event === 'host.call.fail')
  const gh = rows.filter((r) => r.event === 'gh.exec')
  const degraded = rows.filter((r) => r.event === 'read.degraded')
  const gates = rows.filter((r) => r.event === 'preflight.gate')
  const methods = Array.from(new Set(host.map((r) => String((r.fields && r.fields.method) || '')))).filter(Boolean)
  return {
    opId: String((first.fields && first.fields.opId) || ''),
    startTs: Number(first.ts || 0),
    endTs: Number(last.ts || 0),
    wallMs: Math.max(0, Number(last.ts || 0) - Number(first.ts || 0)),
    methods,
    // 结论只认宿主那一层的两行：房间那层「起 gh 成功」不等于这一趟电话成了。
    verdict: okRow ? '成' : failRow ? '败' : '没有结论行',
    hostLatencyMs: okRow ? msOf(okRow.fields && okRow.fields.latencyMs) : 0,
    ghCount: gh.length,
    ghVia: Array.from(new Set(gh.map((r) => String((r.fields && r.fields.via) || '(没标签)')))).filter(Boolean),
    gates: gates.map((r) => Number((r.fields && r.fields.gate) || 0)),
    degraded: degraded.map((r) => String((r.fields && r.fields.op) || '') + '/' + String((r.fields && r.fields.reason) || '')),
  }
}

function cmdList(input: string): number {
  const { files, error } = collectFiles(input)
  if (error) {
    console.log(error)
    return 1
  }
  if (!files.length) {
    console.log('这个路径下没有 .log 文件：' + input)
    return 1
  }
  const { entries, bad } = readAll(files)
  const { groups, noId } = groupByOpId(entries)
  console.log('读了 ' + files.length + ' 份日志、' + entries.length + ' 行（坏行 ' + bad + ' 行跳过）')
  console.log('')
  if (!groups.size) {
    console.log('没有带操作编号（opId）的行。两种可能：')
    console.log('  · 这份日志来自还没有这一格的版本（2026-10-14 之前）；')
    console.log('  · 这一趟操作不是从宿主电话进来的（比如房间被别的路径直接调用）。')
    if (noId.length) console.log('  另有 ' + noId.length + ' 行没有编号。')
    return 0
  }
  const rows = Array.from(groups.values())
    .map(summarize)
    .sort((a, b) => a.startTs - b.startTs)
  console.log('共 ' + rows.length + ' 趟操作：')
  console.log('')
  console.log('  操作编号        开始      花多久   结论  外部命令  这一趟都起了哪些命令                    降级结论')
  for (const r of rows) {
    const via = r.ghVia.join(' ') || '(没有带标签的外部命令)'
    const deg = r.degraded.join(' ') || ''
    console.log(
      '  ' + r.opId.padEnd(14) + ' ' + hhmmss(r.startTs) + '  ' + String(r.wallMs + 'ms').padEnd(8) + ' ' +
        r.verdict.padEnd(6) + String(r.ghCount).padEnd(8) + ' ' + via.slice(0, 38).padEnd(38) + ' ' + deg,
    )
  }
  console.log('')
  console.log('看某一趟的每一行：node scripts/log-trace.ts show <路径> <操作编号>')
  if (noId.length) console.log('另有 ' + noId.length + ' 行没有编号（客户端转发汇总、别的域的事件等），它们不参与分组。')
  return 0
}

/** 把一行翻成人话；认不出的事件原样铺开一小段，不猜。 */
function describeRow(r: LogLine): string {
  const f = (r.fields || {}) as Record<string, unknown>
  if (r.event === 'host.call') {
    return '电话 ' + String(f.method || '') + ' 成了，kind=' + String(f.kind || '') + '，电话自己报 ' + msOf(f.latencyMs) + 'ms，工作区 ' + String(f.cwdHash || '')
  }
  if (r.event === 'host.call.fail') {
    return '电话 ' + String(f.method || '') + ' 没成，kind=' + String(f.kind || '') + '，错误散列 ' + String(f.errorHash || '') + '，工作区 ' + String(f.cwdHash || '')
  }
  if (r.event === 'gh.exec') {
    return '起 gh：' + String(f.via || '(没标签)') + '，' + String(f.kind || '') + '，退出码 ' + String(f.exitCode) + '，花了 ' + msOf(f.latencyMs) + 'ms' +
      (msOf(f.waitedMs) ? '（排队等了 ' + msOf(f.waitedMs) + 'ms）' : '')
  }
  if (r.event === 'read.degraded') {
    return '这一趟读没成/没读全：' + String(f.op || '') + '，原因 ' + String(f.reason || '') + '，到这里花了 ' + msOf(f.latencyMs) + 'ms'
  }
  if (r.event === 'preflight.gate') {
    return '探测第 ' + String(f.gate) + ' 项过了，花了 ' + msOf(f.latencyMs) + 'ms'
  }
  return JSON.stringify(f).slice(0, 120)
}

function cmdShow(input: string, opId: string): number {
  const { files, error } = collectFiles(input)
  if (error) {
    console.log(error)
    return 1
  }
  const { entries, bad } = readAll(files)
  const { groups } = groupByOpId(entries)
  const rows = groups.get(opId)
  if (!rows || !rows.length) {
    console.log('这份日志里没有编号为「' + opId + '」的行。先跑一遍 list 看看有哪些编号。')
    return 1
  }
  const s = summarize(rows)
  const t0 = Number(rows[0].ts || 0)
  console.log('这一趟操作：' + s.opId)
  console.log('  电话      ' + (s.methods.join('、') || '(没记到)'))
  console.log('  起点      ' + hhmmss(s.startTs) + '，一共花了 ' + s.wallMs + 'ms' + (s.hostLatencyMs ? '（电话自己报的是 ' + s.hostLatencyMs + 'ms）' : ''))
  console.log('  结论      ' + s.verdict)
  console.log('  外部命令  ' + s.ghCount + ' 条' + (s.ghVia.length ? '：' + s.ghVia.join('、') : ''))
  if (s.gates.length) console.log('  门禁      ' + s.gates.map((g) => '第' + g + '项过了').join('、'))
  if (s.degraded.length) console.log('  降级结论  ' + s.degraded.join('、'))
  console.log('')
  console.log('  偏移      事件              这一行说了什么')
  for (const r of rows) {
    const off = '+' + String(Math.max(0, Number(r.ts || 0) - t0)).padStart(6) + 'ms'
    console.log('  ' + off + '  ' + String(r.event).padEnd(17) + ' ' + describeRow(r))
  }
  if (bad) {
    console.log('')
    console.log('（另有 ' + bad + ' 行不是合法 JSON，跳过了）')
  }
  return 0
}

const args = process.argv.slice(2)
const cmd = args[0] || ''
if (cmd === 'list' && args[1]) process.exit(cmdList(args[1]))
if (cmd === 'show' && args[1] && args[2]) process.exit(cmdShow(args[1], args[2]))
console.log('用法：')
console.log('  node scripts/log-trace.ts list <日志文件或日志目录>')
console.log('  node scripts/log-trace.ts show <日志文件或日志目录> <操作编号>')
console.log('')
console.log('说明：日志是每行一条 JSON 的文件（导出包里那一份）。目录的话会把这个目录下所有 .log 一起读。')
process.exit(cmd ? 1 : 0)
