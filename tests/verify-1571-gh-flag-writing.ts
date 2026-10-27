// tests/verify-1571-gh-flag-writing.ts —— 门禁：GitHub 房间出站参数别再用 -F 传字符串字段（#1571）
//
// 现场（#1481 摸底，2026-10-27 实机复现）：gh 的 -F 会替值做类型推断，纯数字的 owner（例如 776317107）
// 被发成 JSON 数字；而查询把 $owner / $name 声明成 String!，GraphQL 于是回
//   gh: Variable $owner of type String! was provided invalid value
//   Could not coerce value 654970 to String
// 出站前的 normalizeGhStringFields 是第二道保险（#1375 加的，保留不动）；这一扇勒的是调用点本身：
// src/tracker/rooms/github/ 下再用 -F 传 owner/name 就判红。
//
// 为什么单独一扇：分档超时门禁（tests/verify-969-tiered-timeout.ts）守的是超时档位与出站归一化，
// 顺手扫源码会让它一件事守两处（Divergent Change）。这里只回答「调用点的 -F/-f 写法对不对」，
// 包括三面：没有 -F 传字符串字段、每个文件该有的 -f owner/name 一处不少、整型与游标字段仍走 -F。
//
// 为什么只认字面量写法：这些参数表都是数组字面量（'-F', 'owner=' + owner 与 '-f', `owner=${x}` 两种），
// 静态扫描足够拦住新增调用点。查不出的写法（先把 -F 存进变量再 push）只能靠出站归一化兜底 ——
// 这一扇包不住那种情况，改这里的人不要以为它包治百病。
// 扫描时逐行跳过整行注释（以 //、* 开头）：注释里给人看的旧写法示例不算调用点。
//
// 门禁归属: src/tracker/rooms/github
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1571-gh-flag-writing.ts
import fs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const GH_DIR = nodePath.join(ROOT, 'src', 'tracker', 'rooms', 'github')

let total = 0
let failed = 0
/** 逐条断言：打印 PASS/FAIL，失败累计，收尾一起判红。 */
const check = (ok: unknown, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || detail === undefined ? '' : ' — ' + String(detail)))
  if (!ok) failed += 1
}

// 一、没人再用 -F 传字符串字段：单引号与双引号两种写法都算（'-F' / "-F"）。
const STRING_FIELD_WITH_BIG_F = /(['"])-F\1\s*,\s*(['"`])(?:owner|name)=/
// 二、这些字段继续走 -f，而且一处都不能少（少了等于调用点又被改回 -F，或拼写变了）。
const EXPECTED_F_COUNTS: Record<string, number> = {
  'blocked-by-write.ts': 2,
  'comment-paging.ts': 2,
  'counts.ts': 2,
  'deps-read.ts': 2,
  'issues.ts': 8,
  'page.ts': 2,
  'sub-issues.ts': 2,
}
// 三、整型与游标字段仍走 -F：本次只动 owner/name，没有一刀切成 -f。
const FIELDS_STILL_BIG_F = [
  { file: 'comment-paging.ts', field: 'number' },
  { file: 'comment-paging.ts', field: 'after' },
  { file: 'issues.ts', field: 'first' },
  { file: 'sub-issues.ts', field: 'number' },
  { file: 'sub-issues.ts', field: 'first' },
]

console.log('== #1571 GitHub 房间调用点的 -F/-f 写法 ==')

/** 逐行去掉整行注释：注释里写的旧写法给人看，不把它算成调用点。 */
function stripCommentLines(src: string): string {
  return src.split('\n').filter((line) => {
    const t = line.trim()
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
  }).join('\n')
}

const sources = new Map<string, string>()
try {
  for (const name of fs.readdirSync(GH_DIR)) {
    if (!name.endsWith('.ts')) continue
    sources.set(name, stripCommentLines(fs.readFileSync(nodePath.join(GH_DIR, name), 'utf8')))
  }
  check(sources.size > 0, '一、能读到 src/tracker/rooms/github 下的源码', sources.size + ' 个文件')
} catch (e) {
  check(false, '一、能读到 src/tracker/rooms/github 下的源码', String((e && (e as Error).message) || e).slice(0, 200))
}

// 一、污染源：-F 紧跟 owner= 或 name=。注释里提到 -F 不算；测试夹具不在这个目录，也不在扫描范围。
const offenders: string[] = []
for (const [name, src] of sources) {
  const hit = src.match(STRING_FIELD_WITH_BIG_F)
  if (hit) offenders.push(name + '（' + (hit[0] || '') + '）')
}
check(offenders.length === 0, '一、源码里没有再用 -F 传字符串字段 owner/name', offenders.join('、') || '0 处')

// 二、每个文件该有几处 -f owner/name 就写几处：数量对不上说明有人改了回去、删了调用点或换了写法。
const countF = (src: string): number => (src.match(/(['"])-f\1\s*,\s*(['"`])(?:owner|name)=/g) || []).length
let totalF = 0
for (const [name, want] of Object.entries(EXPECTED_F_COUNTS)) {
  const src = sources.get(name)
  const got = src === undefined ? -1 : countF(src)
  totalF += got > 0 ? got : 0
  check(got === want, '二、' + name + ' 有 ' + want + ' 处 -f 传 owner/name', '%d 处（文件%s）'.replace('%d', String(got)).replace('%s', src === undefined ? '不存在' : '存在'))
}
check(totalF === 20, '二、七个文件合计 20 处 -f 传 owner/name（票面数字对得上）', totalF + ' 处')

// 三、整型/游标字段继续 -F：反过来钉住「别把数字也改成 -f」。
for (const { file, field } of FIELDS_STILL_BIG_F) {
  const src = sources.get(file) || ''
  const re = new RegExp("(['\"])-F\\1\\s*,\\s*['\"`]" + field + '=')
  check(re.test(src), '三、' + file + ' 的 ' + field + ' 仍用 -F')
}

printGateResult('verify-1571-gh-flag-writing', total, failed)
if (failed) {
  console.log('\n1571 GH FLAG WRITING TESTS FAILED（共 ' + total + ' 条断言，' + failed + ' 条失败）')
  process.exit(1)
}
console.log('\n1571 GH FLAG WRITING TESTS PASSED（共 ' + total + ' 条断言）')
