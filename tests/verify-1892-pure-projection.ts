/**
 * tests/verify-1892-pure-projection.ts —— 快照组装是纯投影门禁（#1892，规格 #1885 I5）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 等价性基线：搬之前用当时的实现（snapshotOfProjection → assembleSnapshot）把几份现网样本
 *     投影出来的结果，逐字节存在 tests/fixtures/1892/*.json 的 expected 里；搬之后用新的纯投影
 *     projectSnapshotView 对同一批行再投一次，必须与 expected 逐字相等（字节级比较，不比字段子集）。
 *     样本覆盖：有容器树的地图与规格、父子边、阻塞边与引用态、已关闭容器里的已关闭子票（瘦身行）、
 *     拉取请求、多工作单元，以及空库。
 *   B 同样输入连续两次投影逐字相同（并且两次拿到的是两份独立的对象，不是同一份缓存）。
 *   C 打乱行的插入顺序（倒序、轮转、固定种子的随机洗牌）之后投影结果不变。
 *   D 纯函数运行时不变量：把 Date.now / performance.now / 零参数的 new Date() 换成会抛错的桩，
 *     投影照样成功且结果与基线逐字相同；入参深度冻结后照常投影（不改入参）；上一份输出被就地改坏
 *     不影响下一次投影（不复用缓存）。源码只作辅助证据：投影模块只允许一条运行时 import（组装器），
 *     不出现时钟、网络、文件与数据库的调用。
 *   E 版本只进信封：同样的行换一个库版本，投影内容逐字不变，只有信封里的 version 跟着变。
 *
 * 为什么这么测：这一票是「只搬不改行为」，判据必须来自搬动之前冻下来的输出，而不是从现在这份
 * 实现反推一遍同样的算法（那样测试会跟代码一起错）。样本行是从真 SQLite 快照库写进去再读回来的，
 * 顺序就是生产上库列表读会给的那个顺序。
 *
 * 夹具的来历与重生成（详见 tests/fixtures/1892/regenerate.mts 的文件头）：
 *   · 01-real-1682.json：仓库里已有的 #1682 真机夹具（脱敏后的两页 GitHub 列表行，8 张工单 + 2 个
 *     拉取请求），经 GitHub 归一化、真 SQLite 快照库写入、readList({state:'all'}) 读回。
 *   · 02-edges-and-closed.json：内容参照本仓库规格与地图票面的页面样本（两张地图、一张规格、
 *     阻塞边、已关闭子票、破链票、两个拉取请求）。
 *   · 03-multi-effort.json：本地 Markdown 形态的两个工作单元（编号各自从 00 起）。
 *   · 04-empty.json：空库。
 *   这份基线是在改代码之前跑的：node --import ./scripts/ts-hook.mts tests/fixtures/1892/regenerate.mts
 *   搬完之后重跑它会把基线换成新实现的输出（等价性证据随之丢失），只在确认行为有意改变且评审过之后才做。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1892-pure-projection.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-view-projection.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-view.ts

import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { projectSnapshotView } from '../src/refresh/rooms/host/snapshot-view-projection.ts'
import { snapshotOfProjection } from '../src/refresh/rooms/host/snapshot-library-view.ts'

const GATE = 'verify-1892-pure-projection'
const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', '1892')
const MODULE_FILE = path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'snapshot-view-projection.ts')

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

interface Fixture {
  note: string
  repo: any
  version: number
  rows: any[]
  expected: any
}

/** 逐字比较：JSON 序列化之后按字符串比，不比字段子集，也不做键排序（键顺序本身就是输出的一部分）。 */
function bytes(value: unknown): string {
  return JSON.stringify(value)
}

function loadFixtures(): Array<{ file: string, data: Fixture }> {
  const files = readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json')).sort()
  return files.map((file) => ({
    file,
    data: JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), 'utf8')) as Fixture,
  }))
}

/** 固定种子的洗牌：每次跑出来的顺序一样，失败时能照着复现。 */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = list.slice()
  let state = seed >>> 0
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/** 原地递归冻结：投影若写入参，严格模式下会抛错，这比「比较前后是否相等」更能抓住悄悄写入。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/**
 * 在「时钟一读就炸」的环境里跑一段投影。
 *
 * 为什么连零参数的 new Date() 也挡：Date.now 只是读时钟的一种写法，new Date() 同样是；
 * 投影要用的只有 new Date(毫秒数) 这一种带参数的构造（把库里的毫秒转成 ISO）。
 */
function withClockGuards<T>(fn: () => T): T {
  const RealDate = Date
  class GuardedDate extends RealDate {
    constructor(value?: unknown) {
      if (arguments.length === 0) throw new Error('投影读了时钟：new Date()')
      super(value as number)
    }
    static now(): number { throw new Error('投影读了时钟：Date.now()') }
  }
  const perf = performance as { now?: () => number }
  const realNow = perf.now
  let perfGuarded = false
  ;(globalThis as unknown as { Date: unknown }).Date = GuardedDate
  try {
    perf.now = function (): number { throw new Error('投影读了时钟：performance.now()') }
    perfGuarded = true
  } catch { /* 有的运行时里 performance.now 不可写：下面还有源码静态判据兜底 */ }
  try {
    return fn()
  } finally {
    ;(globalThis as unknown as { Date: unknown }).Date = RealDate
    if (perfGuarded) perf.now = realNow
  }
}

/** 只去掉注释：注释里写着 Date.now 不算调用。 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 再去掉字符串字面量里的内容：字符串里的说明文字不该被当成调用。 */
function codeOnly(source: string): string {
  return withoutComments(source)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\x60(?:[^\x60\\]|\\.)*\x60/g, '""')
}

const fixtures = loadFixtures()
check(fixtures.length >= 4, 'A0 夹具至少四份（现网样本、容器树/边、多工作单元、空库）', fixtures.length)

// ---------------------------------------------------------------------------
// A 等价性基线：搬前的输出与搬后的输出逐字相等
// ---------------------------------------------------------------------------
for (const { file, data } of fixtures) {
  check(
    !!data && typeof data.version === 'number' && Array.isArray(data.rows) && data.expected && typeof data.expected === 'object',
    'A1 ' + file + ' 夹具形状完整（repo / version / rows / expected）',
  )
  const got = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version })
  check(bytes(got.snapshot) === bytes(data.expected), 'A2 ' + file + ' 搬后投影与搬前基线逐字相等', {
    got: bytes(got.snapshot).slice(0, 160),
    want: bytes(data.expected).slice(0, 160),
  })
  check(got.version === data.version, 'A3 ' + file + ' 版本原样回传', got.version)
  const viaOldEntry = snapshotOfProjection(data.repo, { mergeVersion: data.version, generatedAtMs: 0, issues: data.rows } as any)
  check(bytes(viaOldEntry) === bytes(data.expected), 'A4 ' + file + ' 原来的调用口（snapshotOfProjection）仍给出同一份形状')
}

// ---------------------------------------------------------------------------
// B 同样输入连续两次投影逐字相同（两份独立对象）
// ---------------------------------------------------------------------------
for (const { file, data } of fixtures) {
  const first = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version })
  const second = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version })
  check(bytes(first.snapshot) === bytes(second.snapshot), 'B1 ' + file + ' 连续两次投影逐字相同')
  check(first.snapshot !== second.snapshot, 'B2 ' + file + ' 两次拿到的是独立对象（不是同一份缓存）')
  check(first.snapshot.maps !== second.snapshot.maps && first.snapshot.issues !== second.snapshot.issues, 'B3 ' + file + ' 数组也不共用')
}

// ---------------------------------------------------------------------------
// C 打乱行的插入顺序：结果不变
// ---------------------------------------------------------------------------
for (const { file, data } of fixtures) {
  const want = bytes(data.expected)
  const orders: Array<{ name: string, rows: any[] }> = [
    { name: '倒序', rows: data.rows.slice().reverse() },
    { name: '轮转一位', rows: data.rows.length ? data.rows.slice(1).concat(data.rows.slice(0, 1)) : [] },
  ]
  for (const seed of [1, 7, 13, 42]) orders.push({ name: '洗牌种子 ' + seed, rows: shuffled(data.rows, seed) })
  let allSame = true
  let firstBad = ''
  for (const order of orders) {
    const got = bytes(projectSnapshotView({ repo: data.repo, issues: order.rows as any, version: data.version }).snapshot)
    if (got !== want) { allSame = false; firstBad = order.name; break }
  }
  check(allSame, 'C1 ' + file + ' 打乱行顺序后投影结果不变' + (firstBad ? '（先坏在：' + firstBad + '）' : ''))
}

// ---------------------------------------------------------------------------
// D 纯函数运行时不变量：不读时钟、不改入参、不复用缓存
// ---------------------------------------------------------------------------
for (const { file, data } of fixtures) {
  const input = deepFreeze({ repo: data.repo, issues: data.rows.slice(), version: data.version })
  let guardedSnapshot: any = null
  let clockError = ''
  try {
    guardedSnapshot = withClockGuards(() => projectSnapshotView(input as any)).snapshot
  } catch (e) {
    clockError = String((e as Error).message || e)
  }
  check(clockError === '', 'D1 ' + file + ' 时钟桩没有被打到（投影不读时钟）', clockError)
  check(guardedSnapshot !== null && bytes(guardedSnapshot) === bytes(data.expected), 'D2 ' + file + ' 时钟被换成会抛错的桩后投影仍成功且与基线逐字相等')
}

{
  const { data } = fixtures[fixtures.length - 1] as { data: Fixture }
  const input = deepFreeze({ repo: data.repo, issues: data.rows.slice(), version: data.version })
  let threw = ''
  try { projectSnapshotView(input as any) } catch (e) { threw = String((e as Error).message || e) }
  check(threw === '', 'D3 入参深度冻结后投影不抛错（不改入参）', threw)
}

{
  const { data } = fixtures[fixtures.length - 1] as { data: Fixture }
  const first = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version })
  const before = bytes(first.snapshot)
  // 就地改坏上一份输出：下一次投影若复用了它（缓存/共享结构），结果会跟着变。
  first.snapshot.repository = { polluted: true }
  first.snapshot.maps.push({ polluted: true })
  first.snapshot.issues.push({ polluted: true })
  first.snapshot.deck = { polluted: true }
  const again = withClockGuards(() => projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version }))
  check(bytes(again.snapshot) === before, 'D4 上一份输出被就地改坏，下一次投影仍给出原样的形状（不复用缓存）')
}

{
  const source = codeOnly(readFileSync(MODULE_FILE, 'utf8'))
  check(!/\bDate\.now\s*\(/.test(source), 'D5 投影模块源码里没有 Date.now() 调用')
  check(!/\bperformance\.now\s*\(/.test(source), 'D6 投影模块源码里没有 performance.now() 调用')
  check(!/new\s+Date\s*\(\s*\)/.test(source), 'D7 投影模块源码里没有零参数的 new Date()')
  check(!/\bfetch\s*\(|\bwriteFile\s*\(|\bwriteFileSync\s*\(/.test(source), 'D8 投影模块源码里没有网络或文件写入调用')
  check(!/node:(fs|sqlite|http|https)|snapshotLibrary|\.prepare\s*\(/.test(source), 'D9 投影模块源码里没有数据库、文件系统或快照库门面的引用')
  const imports = withoutComments(readFileSync(MODULE_FILE, 'utf8')).split(/\r?\n/).filter((line) => /^\s*import\s/.test(line))
  check(imports.length === 3, 'D10 投影模块只有三条 import（两条类型、一条组装器）', imports)
  const runtimeImports = imports.filter((line) => !/^\s*import\s+type\s/.test(line))
  check(runtimeImports.length === 1 && /from\s+'[^']*snapshotAssemble\.js'/.test(runtimeImports[0] || ''), 'D11 唯一的运行时依赖是快照组装器（不碰库、不碰缓存）', runtimeImports)
}

// ---------------------------------------------------------------------------
// E 版本只进信封，不进内容
// ---------------------------------------------------------------------------
{
  const { data } = fixtures[1] as { data: Fixture }
  const base = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version })
  const bumped = projectSnapshotView({ repo: data.repo, issues: data.rows as any, version: data.version + 41 })
  check(bytes(bumped.snapshot) === bytes(base.snapshot), 'E1 换一个库版本，投影内容逐字不变')
  check(bumped.version === data.version + 41 && base.version === data.version, 'E2 版本只在信封里跟着变')
}

// ---------------------------------------------------------------------------
// F 空库：明确的空形状，不是 null、也不是缺字段
// ---------------------------------------------------------------------------
{
  const empty = fixtures.filter((entry) => entry.data.rows.length === 0)[0]
  check(!!empty, 'F0 夹具里有一份空库样本')
  if (empty) {
    const snap = projectSnapshotView({ repo: empty.data.repo, issues: [], version: empty.data.version }).snapshot
    check(Array.isArray(snap.maps) && snap.maps.length === 0 && Array.isArray(snap.issues) && snap.issues.length === 0, 'F1 空库投影给出空容器与空票（数组为空，不是 null）')
    check(Array.isArray(snap.thinTickets) && snap.thinTickets.length === 0 && snap.deck === null, 'F2 空库的瘦身行与 deck 仍是确定形状')
    check(bytes(snap.repository) === bytes(empty.data.repo), 'F3 空库也保留仓库身份')
  }
}

console.log('快照纯投影门禁：' + (total - failed) + '/' + total + ' 通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
