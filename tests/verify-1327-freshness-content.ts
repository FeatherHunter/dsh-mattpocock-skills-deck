// tests/verify-1327-freshness-content.ts —— 产物新鲜度「内容判据」的回归门禁（#1327）
// 归属说明：它守的判据实现在 scripts/lib/build-cache.mts；本文件最后一段还会读真实树上的四个产物与几份
// 源码，所以 gate-map 把它同时归到 scripts/lib 与那些源码路径。它守的是判据本身，真实树那一段只是顺手
// 核对生产树上的产物仍然判 fresh。
//
// 守的是什么：产物新不新鲜，全仓只有一个判据——scripts/lib/build-cache.mts 的 judgeProducts()。
// #1326 把这个判据从「比修改时间」换成了「比内容」：只有当
//   ① 当前源码输入的内容摘要，等于上次成功构建记下的输入摘要；并且
//   ② 每个产物的 sha256，等于那次构建记下的产物摘要；
// 两条同时成立，才判 fresh。
//
// 为什么需要单独一扇门禁守着它（而不是靠已有的那批新鲜度门禁）：已有的 8 扇新鲜度门禁
// （verify-ctx、verify-kernel、verify-leaves、verify-parse-leaf、verify-tabsfold-leaf、
// verify-platform-contract、verify-log-client、verify-log-artifacts）都在真实仓库树上问一句
// 「盘上这些产物是不是当前源码构建的」；如果哪天有人把判据悄悄改回只比修改时间，它们可能照样绿——
// 因为正常构建出来的产物，修改时间本来就比源码新。也就是说「判据本身退化」这件事，它们测不出来。
// 本扇门禁守的就是「内容判据不退化」：它用临时目录里一份完全可控的小样本直接验证判据本身，
// 把三件事钉死——内容不同一定判 stale 并点名具体产物；内容相同一定判 fresh（且走的是内容判据，
// 不是回落的修改时间判据）；缓存坏了必须回落并且说清原因（不静默）。
// 将来谁把判据改回只比修改时间，或者只比整批而不点名产物，这扇门禁就会红。
//
// 与那 8 扇的分工：那 8 扇测「判据的使用方」——这棵树上产物新不新鲜；本扇测「判据本身」——
// 它还认不认内容。两者坏了都会红，但红的原因不同，报错会指向不同地方。
//
// 怎么保证确定性、不依赖真实构建耗时、不 sleep：不跑 node scripts/build.mts，也不碰真实仓库的
// 构建缓存。临时目录里只放一份输入文件、一份产物和一条手写的构建记录（格式与 build.mts 写的一致），
// 改产物内容时用 utimesSync 把修改时间原样放回去，所以「内容变了、时间没变」这个最容易被旧判据
// 漏掉的场景是构造出来的、不靠等待。测试结束把临时目录删掉，不留在仓库里。
//
// 唯一一条与真实仓库有关的断言放在最后：正常树上 client.js、host.js、package/lib/client.js、
// package/lib/index.js 四个产物都应判 fresh。链上构建之后跑时缓存有效，走内容判据；
// 缓存不可用时回落按修改时间判断，也应该绿（回落说明会打在 INFO 行里）。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1327-freshness-content.ts

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// 判据只有一份实现（#1326）：这里加载的就是生产用的那一份，不另抄一套期望值。
const { CACHE_VERSION, judgeProducts, inputFingerprint, sha256File, resetBuildCacheMemo, cachePath } =
  require('../scripts/lib/build-cache.mts')

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 把一条产物结论说成人话，失败时直接贴进断言消息里，省得人再去跑一遍。 */
function describe(j: any): string {
  if (!j) return '判据没有给出这个产物的结论'
  return 'freshness=' + j.freshness + '，reason=' + j.reason
}

console.log('产物新鲜度内容判据门禁（#1327）')

// ---------------------------------------------------------------------------
// 临时目录里造一份最小仓库：src 下一份输入、根上一份产物、一条手写的构建记录
// ---------------------------------------------------------------------------
const tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-1327-' + process.pid + '-'))
const PRODUCT = 'product.js'
const SOURCE = 'src/input.ts'
const ORIGINAL = 'console.log("product v1")\n'
const productAbs: string = path.join(tmpRoot, PRODUCT)
const sourceAbs: string = path.join(tmpRoot, SOURCE)

/** 按 build.mts 写的格式落一条 full 档构建记录：输入摘要 + 逐产物内容摘要。 */
function writeGoodCache(): void {
  const file: string = cachePath(tmpRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: CACHE_VERSION,
      entries: {
        full: {
          fingerprint: inputFingerprint(tmpRoot, 'full'),
          outputs: { [PRODUCT]: sha256File(productAbs) },
          at: new Date().toISOString(),
        },
      },
    }),
  )
}

/** 这一批产物的判定结果，按产物名取一条。 */
function judgedOf(products: string[] = [PRODUCT]): any {
  const judged: any = judgeProducts({ products, sources: [SOURCE], root: tmpRoot })
  ;(judged.notices as string[]).forEach((n: string) => console.log('  INFO ' + n))
  return judged
}

try {
  fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true })
  fs.writeFileSync(sourceAbs, 'export const answer = 1\n')
  fs.writeFileSync(productAbs, ORIGINAL)
  // 源码的修改时间故意比产物旧：回落的修改时间判据只有在「源码比产物新」时才判 stale，
  // 把源码放旧，后面「缓存坏掉仍判 fresh」才是回落真的生效了，而不是碰巧。
  const old = new Date(Date.now() - 60_000)
  fs.utimesSync(sourceAbs, old, old)
  writeGoodCache()
  console.log('  临时仓库：' + tmpRoot)

  // ---- ① 内容一致 → fresh，而且必须走内容判据（不是回落） ----
  let judged = judgedOf()
  let j: any = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(!!j && j.freshness === 'fresh', '内容一致时判 fresh（' + describe(j) + '）')
  check(!!j && String(j.reason).includes('内容'), '这一判是内容判据给的结论，不是回落的修改时间判据（' + describe(j) + '）')
  check(judged.notices.length === 0, '缓存与输入都对得上时不产生回落说明（共 ' + judged.notices.length + ' 条）')

  // ---- ①b 产物内容没变、只把产物修改时间改得比源码还旧 → 仍判 fresh（#1326 AC①）----
  // 旧的按修改时间判据在这里会假红（源码比产物新），内容判据必须完全不受修改时间影响。
  const freshStat = fs.statSync(productAbs)
  const older = new Date(Date.now() - 120_000)
  fs.utimesSync(productAbs, older, older)
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(!!j && j.freshness === 'fresh', '产物只被改旧修改时间（比源码还旧）时仍判 fresh（' + describe(j) + '）')
  check(
    !!j && String(j.reason).includes('内容') && !String(j.reason).includes('按修改时间'),
    '这一判是内容判据给的结论，没有退回按修改时间判断（' + describe(j) + '）',
  )
  fs.utimesSync(productAbs, freshStat.atime, freshStat.mtime)

  // ---- ② 只改产物内容一个字节、修改时间原样放回 → stale，且点名具体产物 ----
  const before = fs.statSync(productAbs)
  fs.writeFileSync(productAbs, ORIGINAL.replace('v1', 'v2'))
  fs.utimesSync(productAbs, before.atime, before.mtime)
  const after = fs.statSync(productAbs)
  check(Math.abs(after.mtimeMs - before.mtimeMs) < 1, '构造成功：产物内容变了，修改时间没变（前后差 ' + (after.mtimeMs - before.mtimeMs) + 'ms）')
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(!!j && j.freshness === 'stale', '产物内容与构建记录不一致时判 stale（' + describe(j) + '）')
  check(!!j && j.product === PRODUCT, 'stale 的结论落在具体产物 ' + PRODUCT + ' 上（reason 不再重复产物名，门禁前缀已带出）（' + describe(j) + '）')

  // ---- ③ 把内容还原 → 又 fresh（内容判据两个方向都能转） ----
  fs.writeFileSync(productAbs, ORIGINAL)
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(!!j && j.freshness === 'fresh', '内容还原后重新判 fresh（' + describe(j) + '）')

  // ---- ③b 源码内容变了、修改时间保持旧 → 整批回落，并说清是「构建输入变了」 ----
  // 缓存里只记了整批输入的摘要，没有逐文件摘要，所以只能说「输入变了」、退回按修改时间判断。
  const sourceStat = fs.statSync(sourceAbs)
  fs.writeFileSync(sourceAbs, 'export const answer = 2\n')
  fs.utimesSync(sourceAbs, sourceStat.atime, sourceStat.mtime)
  resetBuildCacheMemo()
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(
    (judged.notices as string[]).some((n: string) => n.includes('构建输入在上次成功构建之后有变化')),
    '缓存里的输入摘要与当前输入对不上时，说明里点出「构建输入变了」（' + (judged.notices[0] || '（没有说明）') + '）',
  )
  check(
    !!j && j.freshness === 'fresh' && String(j.reason).includes('修改时间'),
    '输入变过时整批回落，按修改时间判断（产物比源码新，判 fresh）（' + describe(j) + '）',
  )
  fs.writeFileSync(sourceAbs, 'export const answer = 1\n')
  fs.utimesSync(sourceAbs, sourceStat.atime, sourceStat.mtime)
  resetBuildCacheMemo()

  // ---- ③c 记录里漏掉某个产物的摘要 → 点名它，且不给源码清单时必须判 stale（A3）----
  // 构建的缓存命中判断就传空的源码清单：如果这里假装 fresh，判据会把「摘要坏了」当成「产物新鲜」而跳过真构建。
  fs.writeFileSync(
    cachePath(tmpRoot),
    JSON.stringify({ version: CACHE_VERSION, entries: { full: { fingerprint: inputFingerprint(tmpRoot, 'full'), outputs: {}, at: new Date().toISOString() } } }),
  )
  resetBuildCacheMemo()
  const judgedNoSources: any = judgeProducts({ products: [PRODUCT], root: tmpRoot })
  ;(judgedNoSources.notices as string[]).forEach((n: string) => console.log('  INFO ' + n))
  j = (judgedNoSources.products as any[]).find((x: any) => x.product === PRODUCT)
  check(
    (judgedNoSources.notices as string[]).some((n: string) => n.includes('构建记录里没有这些产物的内容摘要') && n.includes(PRODUCT)),
    '记录里漏掉产物摘要时，说明里点名了具体产物 ' + PRODUCT + '（' + (judgedNoSources.notices[0] || '（没有说明）') + '）',
  )
  check(
    !!j && j.freshness === 'stale' && String(j.reason).includes('没有提供可比较的源码清单'),
    '没有源码清单可回落时判 stale，不假装新鲜（' + describe(j) + '）',
  )
  writeGoodCache()
  resetBuildCacheMemo()

  // ---- ④ 删掉构建缓存 → 回落按修改时间判断，且回落不静默 ----
  fs.rmSync(cachePath(tmpRoot))
  resetBuildCacheMemo()
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(judged.notices.length > 0, '缓存不存在时给出回落说明，不静默（共 ' + judged.notices.length + ' 条）')
  check(
    (judged.notices as string[]).some((n: string) => n.includes(PRODUCT)),
    '回落说明里点名了受影响的产物（' +
      (judged.notices[0] || '（没有说明）') +
      '）',
  )
  check(!!j && j.freshness === 'fresh' && String(j.reason).includes('修改时间'), '回落到修改时间判据生效：产物比源码新，判 fresh（' + describe(j) + '）')

  // ---- ⑤ 缓存 JSON 写坏 → 同样回落，并说清读不了的原因 ----
  const cacheFile: string = cachePath(tmpRoot)
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, '{ this is not valid json')
  resetBuildCacheMemo()
  judged = judgedOf()
  j = (judged.products as any[]).find((x: any) => x.product === PRODUCT)
  check(
    (judged.notices as string[]).some((n: string) => n.includes('不是合法的 JSON')),
    '缓存 JSON 写坏时回落说明写清了原因（' +
      (judged.notices[0] || '（没有说明）') +
      '）',
  )
  check(!!j && j.freshness === 'fresh', '缓存坏掉时回落到修改时间判据并判 fresh（' + describe(j) + '）')
} finally {
  // 临时目录测完就删，不留在仓库里也不留在系统临时目录里。
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // 删不掉只影响整洁，不影响判据结论；不把它算成门禁失败。
  }
}

// ---------------------------------------------------------------------------
// 正常仓库树：四个入口产物都应是 fresh（链上构建之后跑；缓存有效或回落都应绿）
// ---------------------------------------------------------------------------
// 产物与源码清单也只有一份（scripts/lib/build-products.mts，#1342）：这里不再手抄第二份，
// 免得改产物集合时漏改这扇门禁，让真实树那段还按旧清单自说自话。
const { BUILD_PRODUCTS: REAL_PRODUCTS, BUILD_SOURCES: REAL_SOURCES } = require('../scripts/lib/build-products.mts')
const real: any = judgeProducts({ products: REAL_PRODUCTS, sources: REAL_SOURCES })
;(real.notices as string[]).forEach((n: string) => console.log('  INFO ' + n))
// 链上构建之后跑时缓存有效，四产物必须走内容判据、不产生回落说明；缓存不存在（新克隆、刚清过缓存）时
// 允许回落、允许打 INFO，但产物仍必须判 fresh——否则这扇门禁单跑时会被环境差异判假红。
if (fs.existsSync(cachePath())) {
  check((real.notices as string[]).length === 0, '真实仓库有构建缓存时四产物走内容判据、不产生回落说明（共 ' + (real.notices as string[]).length + ' 条）')
}
for (const p of REAL_PRODUCTS) {
  const j: any = (real.products as any[]).find((x: any) => x.product === p)
  check(!!j && j.freshness === 'fresh', '正常仓库树上产物 ' + p + ' 判 fresh' + (j ? '（' + j.reason + '）' : '：判据没有给出结论'))
}

console.log('')
console.log(failed ? '存在失败（' + total + ' 条断言）' : '全部通过（' + total + ' 条断言）')
process.exit(failed ? 1 : 0)
