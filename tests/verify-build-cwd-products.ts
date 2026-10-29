// tests/verify-build-cwd-products.ts —— #1644 构建产物不许随「当前目录」漂移
// 门禁归属: scripts/build.mts
// 门禁归属: scripts/bundle-update-entry.mts
//
// 要守的事（票 #1644 的验收判据 1 与 4）：
//   同一个提交，从仓库根构建一次、从 package/ 目录构建一次，两次产出的 package/ 下每一个文件
//   逐字节相同。发布时 npm 就是在 package/ 目录里重跑构建（package/package.json 的 prepublishOnly
//   写的是 `node ../scripts/build.mts --pkg-only`），所以「仓库根构建的产物」与「发布时重跑构建的产物」
//   必须是同一份字节，否则发布出去的包就不是真机验证过的那个候选包。
//
// 为什么这件事要紧（#1644 的起因）：在这张票之前，从 package/ 目录构建出来的 package/lib/client.js
// 比从仓库根构建出来的多 102 字节——esbuild 给每个模块打注释时写的是它干活时的当前目录：
// 仓库根跑是 `// node_modules/.pnpm/...`，package/ 目录跑就多一层 `// ../node_modules/.pnpm/...`，
// 34 处各多 3 个字符，正好 102 字节。
//
// 怎么测：两次都跑同一个命令 `--pkg-only --force`（带 --force 是绕开构建缓存，确保两次都是真构建；
// 两次唯一的差别只有子进程的当前目录），构建成功后把 package/ 下每个文件的内容摘要（sha256）与字节数
// 记下来，逐文件比对；另外单独查一条：#1644 验收判据 4 说的那种带 `../` 的模块注释不许再出现。
//
// 为什么只比 package/ 这一棵树：#1644 管的是「发布出去的包」与「真机验证过的候选包」是否同一份字节，
// 发布内容就是 package/ 下的文件。开发产物 client.js 与 host.js 不在这条入口（--pkg-only 跳过），
// 没法在两次构建之间比；它们不会漂移的原因在构建入口：scripts/build.mts 一进来就把当前目录固定成仓库根，
// 两种入口走的是同一段代码。
//
// 为什么要查「两次构建之间输入没变」：这个仓库允许同一个工作区里同时跑多路会话（见
// docs/agents/parallel-sessions.md），而本门禁要跑两遍真构建、前后约 15 秒。如果这 15 秒里有别的会话
// 存了源码，两次构建看到的输入就不是同一份，逐字节比对会红在一个与当前目录无关的文件上，让人白查半天。
// 所以每轮前后各取一次输入指纹（scripts/lib/build-cache.mts 的 inputFingerprint），变了就自动重跑一轮；
// 两轮都不稳定才判红，并且红在「本轮比对不可信」这条断言上，不红在产物差异上。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-build-cwd-products.ts
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PKG_DIR = path.join(ROOT, 'package')
const BUILD = path.join(ROOT, 'scripts', 'build.mts')
// 发布入口的那条命令：npm 在 package/ 目录里跑 prepublishOnly 时，用的就是这个相对路径写法。
const PKG_ENTRY = '../scripts/build.mts'
// 输入指纹只管输入文件，不管产物；但它在同一个进程里会缓存，所以每次调用前先清一次缓存。
const buildCache = require(path.join(ROOT, 'scripts', 'lib', 'build-cache.mts'))

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '（' + detail + '）'))
  if (!ok) failed = true
}

/** 当前仓库里参与构建的输入文件整体指纹。变了说明两轮构建之间有人动过源码。 */
function fingerprint() {
  buildCache.resetBuildCacheMemo()
  return buildCache.inputFingerprint(ROOT, 'full')
}

/** 跑一次真构建，把整段输出收下来，失败时能贴出末尾几行。 */
function runBuild(cwd, scriptArg) {
  const started = Date.now()
  const r = spawnSync(process.execPath, [scriptArg, '--pkg-only', '--force'], { cwd, encoding: 'utf8' })
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || ''), ms: Date.now() - started }
}

/** 失败时贴构建输出的末尾几行，省得人再手动跑一遍去猜。 */
function tailOf(text, n) {
  return text.split(/\r?\n/).filter(Boolean).slice(-n).join(' / ')
}

/** 走完 package/ 下整棵树，返回按仓库相对路径排好序的文件清单。 */
function listPackageFiles(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) listPackageFiles(abs, out)
    else if (ent.isFile()) out.push(abs)
  }
  return out
}

/**
 * package/ 下每个文件的快照：键是仓库相对路径（如 package/lib/client.js），值是内容摘要与字节数。
 * 字节数要在构建完当场记下来：第二次构建会覆盖同一批路径，等比对时再去 stat，两边量到的是同一个
 * 当前文件，差永远是 0，没法说明问题（这正是第一版门禁的毛病）。
 */
function snapshotPackage() {
  const snap = {}
  for (const abs of listPackageFiles(PKG_DIR, []).sort()) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    const buf = fs.readFileSync(abs)
    snap[rel] = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }
  }
  return snap
}

console.log('构建产物不随当前目录漂移（#1644）')

// ── 先跑两遍构建。输入在这期间被改过就重跑一轮，避免把别的会话的改动算成本门禁的红。 ──
const MAX_ATTEMPTS = 2
let attempt = null
let hardFail = null
for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
  if (n > 1) {
    console.log('')
    console.log('  上一轮两次构建之间仓库输入被改过，重跑一轮再比。')
  }
  const before = fingerprint()

  const fromRoot = runBuild(ROOT, BUILD)
  if (fromRoot.status !== 0) {
    hardFail = { which: '从仓库根构建', r: fromRoot }
    break
  }
  const rootSnap = snapshotPackage()

  const fromPackage = runBuild(PKG_DIR, PKG_ENTRY)
  if (fromPackage.status !== 0) {
    hardFail = { which: '从 package/ 目录构建', r: fromPackage }
    break
  }
  const pkgSnap = snapshotPackage()

  const after = fingerprint()
  attempt = { n, fromRoot, rootSnap, fromPackage, pkgSnap, stable: before === after }
  if (attempt.stable) break
  console.log('  第 ' + n + ' 轮：两次构建期间输入指纹变了（多半是同一个工作区里另一路会话在写文件），这轮比对不算数。')
}

if (hardFail) {
  check(
    false,
    '两次构建都成功跑完',
    hardFail.which + '失败，退出码 ' + String(hardFail.r.status) + '；输出末尾：' + tailOf(hardFail.r.out + '\n' + hardFail.r.err, 6),
  )
  console.log('')
  console.log('构建都没过，两种入口的产物一致性无从谈起，先修构建。')
  process.exit(1)
}

console.log('  从仓库根构建花了 ' + attempt.fromRoot.ms + 'ms')
console.log('  从 package/ 目录构建花了 ' + attempt.fromPackage.ms + 'ms')
check(
  attempt.stable,
  '两次构建之间仓库的输入文件没有变（这轮逐字节比对可信）',
  '两轮尝试期间输入指纹都变过：多半是同一个工作区里另一路会话在写文件；等它写完，或去自己的工作树里重跑本门禁',
)
if (!attempt.stable) {
  console.log('')
  console.log('这一轮的两次构建看到的不是同一份源码，产物差异不能算到「当前目录」头上，门禁判红；这不是代码问题，重跑即可。')
  process.exit(1)
}

const rootSnap = attempt.rootSnap
const pkgSnap = attempt.pkgSnap
check(Object.keys(rootSnap).length > 0, '从仓库根构建后 package/ 下有产物（' + Object.keys(rootSnap).length + ' 个文件）')

// ── 核心断言：两次构建的 package/ 逐文件比对 ──
const rootFiles = Object.keys(rootSnap)
const pkgFiles = Object.keys(pkgSnap)
const missing = rootFiles.filter((f) => !(f in pkgSnap))
const extra = pkgFiles.filter((f) => !(f in rootSnap))
check(missing.length === 0, '两次构建的产物清单一致：没有「仓库根构建有、package/ 目录构建没有」的文件', '缺 ' + missing.length + ' 个：' + missing.slice(0, 5).join('、'))
check(extra.length === 0, '两次构建的产物清单一致：没有「package/ 目录构建多出来」的文件', '多 ' + extra.length + ' 个：' + extra.slice(0, 5).join('、'))

const changed = []
for (const rel of rootFiles) {
  if (!(rel in pkgSnap)) continue
  if (rootSnap[rel].sha256 !== pkgSnap[rel].sha256) changed.push(rel)
}
check(
  changed.length === 0,
  '两种入口构建出的 ' + rootFiles.length + ' 个文件逐个 sha256 相等',
  changed.length + ' 个文件不一致：' + changed.slice(0, 5).join('、') + (changed.length > 5 ? ' 等' : ''),
)

// 不一致时把每个文件的字节数差出来：102 字节那次的形态就是这样一眼看到的（客户端产物多一层 ../）。
if (changed.length) {
  for (const rel of changed.slice(0, 5)) {
    const a = rootSnap[rel].size
    const b = pkgSnap[rel].size
    console.log('    ' + rel + '：仓库根构建 ' + a + ' 字节 vs package/ 目录构建 ' + b + ' 字节（差 ' + (b - a) + '）')
  }
}

// ── 验收判据 4：模块注释里的路径形态不许带 ../ ──
// esbuild 打给打包进来的依赖模块的注释长这样：单独一行，以两个斜杠一个空格开头，后面是从当前目录
// 起算的模块路径。注意这些注释可能缩进（被打包进客户端产物时就在行首多了两个空格），所以判据要允许
// 行首空白，否则缩进的那种会漏掉——#1644 修复前，初版门禁正是因为只认行首的 `// `，把带 ../ 的
// 34 处注释全漏过去了，误判成 PASS。
// 从 package/ 目录构建时如果当前目录没被固定住，这里就会写成 ../node_modules/...（#1644 的 102 字节就是这么来的）。
const clientPath = path.join(PKG_DIR, 'lib', 'client.js')
let clientText = ''
try {
  clientText = fs.readFileSync(clientPath, 'utf8')
} catch (e) {
  check(false, '读得到 package/lib/client.js（第二次构建的客户端产物）', String((e && e.message) || e))
}
if (clientText) {
  const rootComments = (clientText.match(/^[ \t]*\/\/ node_modules\//gm) || []).length
  const upComments = (clientText.match(/^[ \t]*\/\/ \.\.\/node_modules\//gm) || []).length
  check(rootComments > 0, '客户端产物里的模块注释按仓库根起算（有 ' + rootComments + ' 处以 // node_modules/ 开头，允许行首缩进）', '一处都没找到：产物格式可能变了，本门禁的这条判据要跟着改')
  check(
    upComments === 0,
    '客户端产物里的模块注释不再带 ../（从 package/ 目录构建也不再改变路径形态）',
    '还有 ' + upComments + ' 处以 // ../node_modules/ 开头，例如：' + (((clientText.match(/^[ \t]*\/\/ \.\.\/node_modules\/.*$/m) || [''])[0]) || '').trim(),
  )
}

console.log('')
console.log(failed ? '门禁判红：共跑了 ' + total + ' 条断言' : '全部通过：' + total + ' 条断言（两次构建各 ' + rootFiles.length + ' 个产物文件）')
process.exit(failed ? 1 : 0)
