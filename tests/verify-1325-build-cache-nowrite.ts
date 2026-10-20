// tests/verify-1325-build-cache-nowrite.ts —— #1325 构建缓存命中时不许改写产物
// 门禁归属: scripts/build.mts
//
// 要守的事（票 #1325 的验收判据）：连续跑两次构建，第二次输入与产物摘要都一致时，
// 不写任何产物文件；第二次仍报告缓存命中、退出码 0、产物大小清单与第一次一致。
//
// 为什么这件事要紧：本地以 link 方式装着的插件正被界面使用，DSH 按文件变化热更客户端产物。
// 缓存命中时若把几百个产物的修改时间（mtime）提到当前，界面就会跟着反复闪烁——
// 而验证链每跑一次就会命中一次缓存，一次链跑下来闪十几回。
//
// 怎么测：先跑一次构建把缓存坐实（链上前面已有预构建，这一次通常就是缓存命中）；
// 再从缓存条目里取出「这次构建写了哪些产物」，逐个记下修改时间；然后跑第二次构建，逐个比对。
// 为什么「修改时间不变」能当作「没写盘」的证据：写文件必然把修改时间抬到当前时刻，
// 没写则一个纳秒都不动。#1325 修复前这条门禁是红的：命中路径会把每个产物的 mtime 一律提到当前。
//
// 不测的两件事（都属于「今天的行为不许变」，代码路径本票没碰）：
//   · 带 --force 或设 DSH_BUILD_NO_CACHE=1 走完整构建——跑一次真构建要几十秒；
//   · 完整构建产出的字节与今天逐字节一致——构建产物本身就没改，改的只是命中路径。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1325-build-cache-nowrite.ts

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const BUILD = path.join(ROOT, 'scripts', 'build.mts')
const CACHE_PATH = path.join(ROOT, 'node_modules', '.cache', 'dsh-build.json')

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '（' + detail + '）'))
  if (!ok) failed = true
}

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
  ms: number
}

/** 跑一次构建（不带参数 = 完整模式），把整段输出收下来供断言。 */
function runBuild(): RunResult {
  const started = Date.now()
  const r: any = spawnSync(process.execPath, [BUILD], { cwd: ROOT, encoding: 'utf8' })
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), ms: Date.now() - started }
}

/** 构建收尾那五行（`[build] OK` 加四行产物大小）——两次构建应当逐行一致。 */
function sizeLines(out: string): string[] {
  return out
    .split(/\r?\n/)
    .filter((line: string) => /^\[build\] OK$/.test(line) || /^ {2}(client\.js|host\.js|package\/lib\/(client|index)\.js) /.test(line))
}

/** 失败时把构建输出的末尾几行贴出来，省得人再手动跑一遍去猜。 */
function tailOf(out: string, n: number): string {
  return out.split(/\r?\n/).filter(Boolean).slice(-n).join(' / ')
}

/**
 * 这一趟是缓存命中还是真构建。
 * 判据取「缓存命中：」这个带冒号的短句，而不是裸的「缓存命中」——完整构建那一行日志里也写着
 * 「缓存命中时整个构建跳过」，裸词会把真构建误认成命中（本门禁第一次写时就踩过）。
 */
function isCacheHit(out: string): boolean {
  return out.indexOf('缓存命中：') >= 0
}

console.log('构建缓存命中时不许改写产物（#1325）')

// 这个环境变量会让构建无条件走完整构建（那是另一条验收：行为与今天一致，本门禁不测）。
// 它一旦被外部环境带进来，第二次构建必然真写盘，本门禁就会报成「产物被改了」那种误导性的红；
// 前提不成立时直接说清楚，别让人去查一个不存在的回归。
if (process.env.DSH_BUILD_NO_CACHE) {
  check(false, '本门禁需要构建缓存生效，但当前环境设了 DSH_BUILD_NO_CACHE=1：清掉它再跑（链上不会带这个变量）')
  process.exit(1)
}

// ── 第一次构建：把缓存坐实。冷缓存时这一步是真构建，链上跑时前面已有预构建，这一步通常命中缓存 ──
const first = runBuild()
check(first.status === 0, '第一次 node scripts/build.mts 退出码 0', '退出码 ' + String(first.status) + '；输出末尾：' + tailOf(first.stdout + '\n' + first.stderr, 6))
if (first.status !== 0) {
  console.log('')
  console.log('第一次构建都没过，下面关于「不写盘」的断言不可信（可能有人正在同时改文件或构建），先修构建。')
  process.exit(1)
}
console.log('  第一次构建花了 ' + first.ms + 'ms（' + (isCacheHit(first.stdout) ? '缓存命中' : '完整构建') + '）')

// ── 从缓存条目里取出这次构建的产物清单。清单是构建自己记的，不是本门禁另抄的一份 ──
let outputs: string[] = []
let cacheError = ''
try {
  const cache: any = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  const entry: any = cache.entries && cache.entries.full
  if (!entry || !entry.outputs) cacheError = '缓存里没有 full 这一段（构建刚跑过，按理该有；先看构建有没有报缓存写不进去）'
  else outputs = Object.keys(entry.outputs)
} catch (e: any) {
  cacheError = '读构建缓存失败：' + (e && e.message ? e.message : e)
}
check(outputs.length > 0, '缓存条目里记着这次构建的产物清单（' + outputs.length + ' 个文件）', cacheError)
if (outputs.length === 0) {
  console.log('')
  console.log('拿不到产物清单就比对不了修改时间，先看上面那条失败原因。')
  process.exit(1)
}

// ── 记下「第二次构建之前」每个产物的修改时间与大小，以及缓存文件自己的修改时间 ──
interface Stamp {
  mtimeMs: number
  size: number
}
const before: Record<string, Stamp> = {}
const missingBefore: string[] = []
for (const rel of outputs) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    missingBefore.push(rel)
    continue
  }
  const st = fs.statSync(abs)
  before[rel] = { mtimeMs: st.mtimeMs, size: st.size }
}
check(missingBefore.length === 0, '缓存清单里的 ' + outputs.length + ' 个产物都在盘上', '缺 ' + missingBefore.length + ' 个：' + missingBefore.slice(0, 5).join('、'))

const cacheBefore = fs.existsSync(CACHE_PATH) ? fs.statSync(CACHE_PATH) : null

// ── 第二次构建：输入与产物都没变，它只该看一眼缓存然后收工 ──
const sizesBefore = sizeLines(first.stdout)
check(sizesBefore.length === 5, '第一次构建打出了五行产物大小清单', '只认到 ' + sizesBefore.length + ' 行')

const second = runBuild()
check(second.status === 0, '第二次 node scripts/build.mts 退出码 0', '退出码 ' + String(second.status) + '；输出末尾：' + tailOf(second.stdout + '\n' + second.stderr, 6))
check(isCacheHit(second.stdout), '第二次构建报告缓存命中', '第二次输出里没有「缓存命中：」：' + tailOf(second.stdout, 4))
check(
  second.stdout.indexOf('没有写任何产物文件') >= 0,
  '缓存命中的提示写明这次没有写任何产物文件',
  '第二次输出里没写清楚「没写盘」：' + tailOf(second.stdout, 4),
)
console.log('  第二次构建花了 ' + second.ms + 'ms（' + (isCacheHit(second.stdout) ? '缓存命中' : '完整构建') + '）')

// ── 核心断言：逐个产物比对修改时间，一个都没动；缓存文件自己也不能被重写 ──
const changed: string[] = []
const vanished: string[] = []
for (const rel of outputs) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    vanished.push(rel)
    continue
  }
  const st = fs.statSync(abs)
  if (st.mtimeMs !== before[rel].mtimeMs) changed.push(rel + '（' + before[rel].mtimeMs + ' → ' + st.mtimeMs + '）')
}
check(vanished.length === 0, '第二次构建跑完，缓存清单里的产物一个都没少', '少了 ' + vanished.length + ' 个：' + vanished.slice(0, 5).join('、'))
check(
  changed.length === 0,
  '第二次构建没有改写任何产物文件：' + outputs.length + ' 个产物的修改时间一个都没变',
  '有 ' + changed.length + ' 个产物的修改时间被动了：' + changed.slice(0, 5).join('、') + (changed.length > 5 ? ' 等' : ''),
)

if (cacheBefore) {
  const cacheAfter = fs.existsSync(CACHE_PATH) ? fs.statSync(CACHE_PATH) : null
  check(
    cacheAfter !== null && cacheAfter.mtimeMs === cacheBefore.mtimeMs && cacheAfter.size === cacheBefore.size,
    '连缓存文件自己都没被重写（命中路径不往盘上写任何东西）',
    cacheAfter === null ? '缓存文件不见了' : '缓存文件变了：修改时间 ' + cacheBefore.mtimeMs + ' → ' + cacheAfter.mtimeMs,
  )
}

const sizesAfter = sizeLines(second.stdout)
check(sizesAfter.length === 5, '第二次构建也打出了五行产物大小清单', '只认到 ' + sizesAfter.length + ' 行')
check(
  sizesAfter.join('\n') === sizesBefore.join('\n'),
  '第二次的产物大小清单与第一次逐行一致（大小一个字节都没变）',
  '两次清单不一致：第一次 [' + sizesBefore.join(' / ') + ']，第二次 [' + sizesAfter.join(' / ') + ']',
)

console.log('')
console.log(failed ? '失败 ' + total + ' 条断言' : '全部通过：' + total + ' 条断言')
process.exit(failed ? 1 : 0)
