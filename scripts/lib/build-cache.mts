// 构建缓存的事实与「产物是不是当前源码构建出来的」判据，只有这一份实现。
//
// 为什么单独抽成一个模块（#1326）：输入范围、派生文件判定、产物清单、输入内容摘要算法、
// 缓存读取，原先都写在 scripts/build.mts 里。新鲜度门禁要用这些事实，只有「构建产出、门禁读取」
// 和「门禁自己抄一份」两条路；抄一份一定会漂移（matrix-full.ts 与 matrix-smoke.ts 各抄一份源码清单，
// 已经是要靠人记得同步的活例子）。所以把事实搬到这里，build.mts 反过来 import 它，门禁也 from 这里取判据。
// 这个模块只导出纯函数与常量：加载它不跑构建、不打印、不写盘（唯一允许的顶层动作是用 import.meta.url
// 推出仓库根路径，不碰文件系统）。唯一会打印的是 reportJudgements：它把一批判定结论按统一格式交给
// 门禁的 check 回调打印，只在被调用时打印，加载模块本身仍然不打印。
//
// 本模块里的进程内记忆（见下方 memo 段）只对「读判据的门禁进程」成立；构建进程是缓存唯一的写者，
// 它写回前必须重新读盘（readCacheFileUncached），不能复用开头判缓存命中时读到的那份快照。
//
// 关于「产物新鲜」的判据，从修改时间换成内容摘要（#1326）——为什么不再看修改时间：
//   · 产物只是被 touch 过、被检出/还原过、从备份恢复过时，修改时间变了而内容没变，按时间判会假红；
//   · 产物被人手工改过时，修改时间通常反而更新，按时间判会假绿；
//   · 只有「产物字节 = 某次成功构建记下的字节」并且「那次构建的输入与当前输入内容一致」这两条合起来，
//     才能回答真正要问的那句话：盘上这份产物是不是当前源码构建出来的。
//
// 一个必须说清的确定性假设：输入摘要只由「输入文件的仓库相对路径 + 内容摘要」决定，不看修改时间。
// 因此内容判据证明的是「盘上产物等于上一次成功构建的产物」，不等价于「此刻重新构建会得到同样的字节」。
// 后一句由仓库已有的证据支撑（tests/verify-1325-build-cache-nowrite.ts 断言两次构建产物一致、
// docs/adr/20260913-builtin-ts-shape.md 建立在「构建现场生成、可重现」上），但本模块不假装自己证明了它。
//
// 缓存文件是「本机便利记录」，不是信任边界：有人手改缓存把摘要改成「都对」，内容判据就会假绿。
// 这与按修改时间判断同样可伪造（把产物 touch 一下即可），不算新增风险；这里写明，免得后来的人误以为
// 缓存内容有防篡改保证。
//
// 缓存缺失、损坏、版本不符、与门禁查的那一档构建对不上时，判据回落成旧的「按修改时间判断」。
// 回落是降级判断：只判红、不修、不静默——即使判绿也返回一行说明「这次是按修改时间判断的、因为什么」，
// 并且只给一条可以照抄的构建命令，不在门禁里偷偷跑构建或改缓存。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录：本文件在 scripts/lib/ 下，往上两级。调用方也可以显式传 root（行为证据脚本用临时目录时有意义）。 */
export const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 缓存格式版本。本票（#1326）不改缓存格式、不升版本：条目里的 at 字段已经是「上次成功构建时间」，
// 只是以前没人用它做提示，现在判据回落的说明里会把它读出来。升级格式属于另一张票。
export const CACHE_VERSION: number = 2

/** 默认仓库的缓存文件位置。缓存落在 node_modules/.cache/ 下（不进版本库，不会被提交）。 */
export function cachePath(root: string = REPO_ROOT): string {
  return join(root, 'node_modules', '.cache', 'dsh-build.json')
}

/** 默认仓库的缓存文件绝对路径（build.mts 直接用这个常量）。 */
export const CACHE_PATH: string = cachePath(REPO_ROOT)

// 四个计算核已按 #1023 搬进 src/shared/<功能名>/，被 'src' 一条罩住，不再单列它们的旧目录名。
// 为什么要收 'tests'：测试树里住着构建与门禁都要读的数据（七个 version-control 真机样本在
// tests/fixtures/version-control/）。四个核还在仓库根的时候，它们的目录整棵在输入范围内，改样本能触发重建；
// 核目录一删，样本就落到输入范围之外了，所以把测试树收进来补上这一段。代价是改任何测试文件都会让输入摘要变、
// 走一次全量重建——这是正确行为，不是故障：测试改了，就该重新构建一次再判定。
// #1294：界面词表的真源 config/copy/ 也收进输入范围——改一份 YAML 必须让输入摘要变、触发重新生成。
export const INPUT_ROOTS: string[] = ['src', 'scripts', 'tests', 'config/copy']
export const INPUT_EXTRA: string[] = ['package.json', 'package/package.json', 'README.md', 'tsconfig.client.json', 'tsconfig.contract.json', 'config/timeouts.yaml', 'config/intervals.yaml', 'config/ttl.yaml', 'config/languages.yaml', 'config/prompts/workspace-initialization.yaml', 'config/prompts/repository-alignment.yaml', 'config/prompts/map-advancement.yaml', 'config/prompts/ticket-action-templates.yaml', 'config/prompts/ticket-creation.yaml', 'scripts/lib/prompt-config.mts', 'scripts/lib/copy-config.mts']
export const ARTIFACT_FILES: string[] = ['client.js', 'host.js', 'package/README.md']
// package/lib 要整目录收进来：它下面除了两份入口，还有构建写出来的其他镜像，
// 而 verify-log-artifacts 比的是「package/lib 里的镜像 vs src 里的真源」，两边必须一起收进产物清单。
// #1018 起 package/deck 与 package/tracker 也是构建写出来的镜像（新树转译投放），同理收进来，
// 否则缓存会把「新树产物缺了」误判成命中而跳过构建。2026-10-19 第三阶段：共享层产物（域转译 + 散文件转译）
// 从源码树搬到了仓库根的 .build/，这里必须把 .build 一起收进产物清单——不然「.build 被删了但源码没动」
// 会被缓存判成命中，构建直接跳过、产物缺席，门禁才在很远的地方报一句看不懂的错。
// 从前这里还列着 src/host/logPkg（上游日志包在本仓源码树里的副本）；#1016 把宿主日志改成直接取用
// 已安装的 dsh-log 包之后，src/ 下不再有那份副本，这一项跟着删掉。
export const ARTIFACT_DIRS: string[] = ['.build', 'package/lib', 'package/deck', 'package/tracker', 'scripts/generated', 'package/scripts', 'package/bundled-skills']

/** 派生文件的标记：这些文件是构建写出来的，不算输入（否则构建一跑，输入摘要就自己变了，缓存永远命中不了）。 */
export function looksDerived(abs: string): boolean {
  try {
    const head: string = readFileSync(abs, 'utf8').slice(0, 300)
    return head.includes('AUTO-GENERATED') || head.includes('人手不改') || head.includes('DO NOT EDIT')
  } catch {
    return false
  }
}

/** 走一棵树，返回仓库相对路径清单（跳过 node_modules 与 .git）。root 默认为仓库根。 */
export function walkTree(root: string, rootRel: string, out: string[] = []): string[] {
  const walk = (absDir: string, relDir: string): void => {
    let ents: any
    try {
      ents = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      // 以点开头的目录与文件一律不进输入：这类路径按约定是工具自己用的（缓存、临时输出、
      // 编辑器状态），不是手写源码。测试树里就有两处这样的遗留临时仓库副本（tests/.tmp-repo-out
      // 与 .tmp-repo-out2），跳过这一条让输入范围天然不含它们，不必为具体目录名单列排除名单。
      if (e.name.startsWith('.')) continue
      const rel: string = relDir ? relDir + '/' + e.name : e.name
      const abs: string = join(absDir, e.name)
      if (e.isDirectory()) walk(abs, rel)
      else if (e.isFile()) out.push(rel)
    }
  }
  walk(join(root, rootRel), rootRel)
  return out
}

export function sha256File(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

/** 手写输入清单：src / scripts / tests / config/copy 四棵，去掉派生文件，再补上根上的几份配置。 */
export function listInputs(root: string = REPO_ROOT): string[] {
  const out: string[] = []
  for (const r of INPUT_ROOTS) {
    for (const rel of walkTree(root, r)) {
      const abs: string = join(root, rel)
      if (rel.startsWith('scripts/generated/')) continue
      if (looksDerived(abs)) continue
      out.push(rel)
    }
  }
  for (const f of INPUT_EXTRA) if (existsSync(join(root, f))) out.push(f)
  return Array.from(new Set(out)).sort()
}

/** 产物清单：根上两份开发产物、包内两份打包产物、派生进 src 的那批、几个生成目录。 */
export function listOutputs(root: string = REPO_ROOT): string[] {
  const out: string[] = []
  for (const f of ARTIFACT_FILES) if (existsSync(join(root, f))) out.push(f)
  for (const d of ARTIFACT_DIRS) {
    if (!existsSync(join(root, d))) continue
    for (const rel of walkTree(root, d)) out.push(rel)
  }
  for (const rel of walkTree(root, 'src')) if (looksDerived(join(root, rel))) out.push(rel)
  return Array.from(new Set(out)).sort()
}

/** 不改变构建产物内容的开关：只影响本次运行的行为，不参与缓存档位命名（#1539）。
 *
 * 为什么要单列这份名单：档名决定缓存条目写到哪里；行为类开关一旦进档名，
 * 构建就会写出门禁永远不查的一次性条目（例如 --force 写出 entries['--force']，
 * 而门禁与下一次普通构建查的都是 entries.full），导致强制重建后门禁仍判旧、
 * 下一次普通构建还要再重建一次。名单用「拒绝名单」而不是「只认 --dev-only
 * 这类档名」：漏掉一个行为开关，最坏只是多重建一次（多花一次构建，方向是安全的）；
 * 反过来漏掉一个真正的档名，不同档的构建就会共用同一条记录（会用错缓存，方向是危险的）。 */
const NON_MODE_FLAGS: string[] = ['--force', '--break-stale-lock']

/** 从命令行参数推出这次构建属于哪一档：--dev-only / --pkg-only 按字母排序拼接，不带参数就是 full。 */
export function buildModeKey(argv: string[] = process.argv.slice(2)): string {
  const flags: string[] = argv.filter((a) => a.startsWith('--') && !NON_MODE_FLAGS.includes(a)).sort()
  return flags.length ? flags.join(' ') : 'full'
}

// 输入摘要与缓存读取都按 (root, mode) 在进程内记忆一次：一条输入摘要要读约 1049 个输入文件（约 100 毫秒），
// 一扇门禁里可能判多批产物（verify-log-artifacts 有 78 个镜像），不记忆就会把同一趟扫描重复几十遍。
// 门禁进程里输入与缓存都不会中途变化，所以记忆是安全的；构建进程例外——它在开头读一次判命中，
// 真构建几十秒后再写回，中间可能被别的会话写过缓存，所以写回前要用 readCacheFileUncached 重新读盘。
// 行为证据脚本要在同一进程里改缓存、改产物，用 resetBuildCacheMemo() 主动失效即可。
const memoInputFingerprint = new Map<string, string>()
const memoCacheFile = new Map<string, CacheReadResult>()

/** 清掉进程内记忆的输入摘要与缓存读取结果（行为证据脚本、以及任何在同一进程里改过缓存/输入的调用方用）。 */
export function resetBuildCacheMemo(): void {
  memoInputFingerprint.clear()
  memoCacheFile.clear()
}

/** 当前手写输入的内容摘要。只由相对路径与文件内容决定，不看修改时间——这就是判据确定性的来源。 */
export function inputFingerprint(root: string = REPO_ROOT, mode: string = 'full'): string {
  const key: string = root + '\u0000' + mode
  const hit: string | undefined = memoInputFingerprint.get(key)
  if (hit !== undefined) return hit
  const h = createHash('sha256')
  h.update('v' + CACHE_VERSION + '|node' + process.version + '|mode:' + mode + '|')
  for (const rel of listInputs(root)) h.update(rel + '\u0000' + sha256File(join(root, rel)) + '\n')
  const digest: string = h.digest('hex')
  memoInputFingerprint.set(key, digest)
  return digest
}

export interface CacheEntry {
  fingerprint: string
  outputs: Record<string, string>
  at: string
}

export interface CacheFile {
  version: number
  entries: Record<string, CacheEntry>
}

/**
 * 读缓存文件的结果。读不到时 ok=false，reason 是写给人类看的中文原因（不是错误码），
 * 让门禁能把「缓存不存在」与「源码过期」两种情况分开说。cache 只在文件是合法 JSON 且版本相符时给出，
 * 构建写回时要拿它保留别的构建模式的条目；entry 只在所查那一档存在且字段齐全时给出。
 */
export interface CacheReadResult {
  ok: boolean
  reason: string
  cache: CacheFile | null
  entry: CacheEntry | null
}

/**
 * 真正读盘的实现：五种读不到的情况分别给一句人话原因；不把「版本不符」笼统说成「缓存缺失」。
 * 不走进程内记忆，因为构建进程写回缓存前必须看到磁盘上的最新内容（构建进程是缓存唯一的写者，
 * 开头判缓存命中时读过的那份快照可能已经过时）。门禁读判据请用下面的 readCacheFile。
 */
export function readCacheFileUncached(root: string, mode: string): CacheReadResult {
  const file: string = cachePath(root)
  if (!existsSync(file)) {
    return { ok: false, reason: '文件不存在（还没有成功构建过，或 node_modules/.cache 被清过）', cache: null, entry: null }
  }
  let raw: any
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件（可能写入了一半，或被改坏了）', cache: null, entry: null }
  }
  if (!raw || typeof raw !== 'object' || raw.version !== CACHE_VERSION || !raw.entries || typeof raw.entries !== 'object') {
    const version: any = raw && raw.version
    return { ok: false, reason: '记录的格式版本是 ' + String(version === undefined ? '（缺）' : version) + '，当前构建用的是 ' + CACHE_VERSION + '（缓存格式变过，需要重新构建）', cache: null, entry: null }
  }
  const cache: CacheFile = raw as CacheFile
  const entry: any = cache.entries[mode]
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: '里没有「' + (mode === 'full' ? '完整构建（full）' : mode) + '」这一档的记录（可能只跑过别的构建模式）', cache, entry: null }
  }
  if (typeof entry.fingerprint !== 'string' || !entry.fingerprint || !entry.outputs || typeof entry.outputs !== 'object') {
    return { ok: false, reason: '里「' + (mode === 'full' ? '完整构建（full）' : mode) + '」这一档的记录缺字段（没有构建输入摘要或产物摘要）', cache, entry: null }
  }
  return { ok: true, reason: '', cache, entry: entry as CacheEntry }
}

export function readCacheFile(root: string = REPO_ROOT, mode: string = 'full'): CacheReadResult {
  const key: string = root + '\u0000' + mode
  const hit: CacheReadResult | undefined = memoCacheFile.get(key)
  if (hit !== undefined) return hit
  const result: CacheReadResult = readCacheFileUncached(root, mode)
  memoCacheFile.set(key, result)
  return result
}

export type Freshness = 'fresh' | 'stale' | 'missing'

export interface ProductJudgement {
  product: string
  freshness: Freshness
  reason: string
}

export interface JudgeResult {
  products: ProductJudgement[]
  /** 回落判断的说明（即使判绿也给出）；正常情况下为空。门禁要把它打成 INFO 行，不许静默。 */
  notices: string[]
}

/** 缺失产物的原因文案：各门禁原本就这么写，保持不变。 */
const MISSING_REASON: string = '缺失（请先运行 node scripts/build.mts）'

/**
 * 唯一一段「单个产物新不新鲜」的判断代码。
 * expectedSha 非空时走内容判据（与上次成功构建记录的摘要比）；为空时走回落的修改时间判据。
 * fallbackCause 说明这次为什么没有内容判据，会拼进回落判红的说明里，让红行本身能自解释（不靠前一行 INFO）。
 * 两条路径共用同一个入口，是为了让「内容比较」与「回落比较」不会各长一套、日后悄悄分叉（AC④）。
 */
function judgeOne(root: string, product: string, sources: string[], expectedSha: string | null, fallbackCause: string = ''): ProductJudgement {
  const abs: string = join(root, product)
  if (!existsSync(abs)) return { product, freshness: 'missing', reason: MISSING_REASON }
  if (expectedSha !== null) {
    const actual: string = sha256File(abs)
    if (actual === expectedSha) return { product, freshness: 'fresh', reason: '与上次成功构建的内容一致' }
    return {
      product,
      freshness: 'stale',
      // 门禁打印时已经带上产物名（「产物门禁 <产物>：…」），这里不再重复；文案保持两类原因的区别：
      // 内容判据判红说的是「内容对不上」，回落判红会在 judgeByMtime 里说明「没有可用的构建记录」。
      reason: '产物内容与上次成功构建不一致（可能被人手改过，或构建没跑完）。请运行 node scripts/build.mts 重建。',
    }
  }
  return judgeByMtime(root, product, sources, fallbackCause)
}

/**
 * 回落的旧判据：产物修改时间不晚于这几份源码（容差 1 秒）就算「按时间看是新鲜的」。
 * 没有可用构建记录时，手上的证据只有修改时间，所以只能说「没看出过期」，不能说「内容没变」。
 * 这条路径只在回落时使用，正常路径永远走内容摘要。
 * fallbackCause 是这次回落的直接原因，会拼进判红的说明里，让单看一行红字也知道「这是回落判的」；
 * 调用方没有给可比较的源码时，按修改时间也无从判断，必须判 stale 而不是当成新鲜——
 * 构建命中判断就依赖这一条（否则缓存里某个产物的摘要坏了会被当成新鲜而跳过真构建）。
 */
function judgeByMtime(root: string, product: string, sources: string[], fallbackCause: string): ProductJudgement {
  if (sources.length === 0) {
    return {
      product,
      freshness: 'stale',
      reason: (fallbackCause ? fallbackCause + '，' : '') + '且调用方没有提供可比较的源码清单，无法判断是否过期；请运行 node scripts/build.mts',
    }
  }
  const productMtime: number = statSync(join(root, product)).mtimeMs
  for (const src of sources) {
    const abs: string = join(root, src)
    if (!existsSync(abs)) continue
    if (statSync(abs).mtimeMs > productMtime + 1000) {
      return {
        product,
        freshness: 'stale',
        reason: '过期（' + src + ' 比产物新，请运行 node scripts/build.mts 重新构建；这次没有可用的构建记录，只能按修改时间判断：' + fallbackCause + '）',
      }
    }
  }
  return { product, freshness: 'fresh', reason: '按修改时间判断为新鲜' }
}

/** 把产物清单拼成一句人话，用于回落提示。 */
function productsText(products: string[]): string {
  return products.join('、')
}

/**
 * 判断一批产物是不是当前源码构建出来的。门禁只传自己盯的产物清单与（回落用的）源码清单，
 * 构建自己也用同一个函数判断缓存能否命中——「产物新不新鲜」的判据只有这一份实现。
 *
 * 参数：products 产物仓库相对路径；sources 回落判据用的源码相对路径（内容判据成立时用不到）；
 * root 仓库根（默认本模块推出来的仓库根）；mode 查哪一档构建记录（门禁一律用默认的 full）。
 */
export function judgeProducts(options: { products: string[]; sources?: string[]; root?: string; mode?: string }): JudgeResult {
  const root: string = options.root === undefined ? REPO_ROOT : options.root
  const mode: string = options.mode === undefined ? 'full' : options.mode
  const products: string[] = options.products
  const sources: string[] = options.sources === undefined ? [] : options.sources
  const results: ProductJudgement[] = []
  const notices: string[] = []

  // ① 产物不存在：与缓存无关，直接说缺失、给出可照抄的命令。
  const existing: string[] = []
  for (const product of products) {
    if (existsSync(join(root, product))) existing.push(product)
    else results.push({ product, freshness: 'missing', reason: MISSING_REASON })
  }
  if (existing.length === 0) return { products: results, notices }

  // ② 读不到缓存：整批回落，并把原因、受影响产物、上次成功构建时间都写出来。
  const cache: CacheReadResult = readCacheFile(root, mode)
  if (!cache.ok) {
    const at: string = cache.cache && cache.cache.entries[mode] && cache.cache.entries[mode].at ? '缓存条目记下的上次成功构建时间是 ' + cache.cache.entries[mode].at + '。' : ''
    const cause: string = '构建缓存' + cache.reason
    notices.push(
      cause + '，这次退回按修改时间判断（受影响产物：' + productsText(existing) + '）。' + at +
      '要恢复内容判据请运行 node scripts/build.mts（这不是源码过期，是本机没有可用的构建记录）。',
    )
    for (const product of existing) results.push(judgeOne(root, product, sources, null, cause))
    return { products: results.sort((a, b) => a.product.localeCompare(b.product)), notices }
  }

  const entry: CacheEntry = cache.entry as CacheEntry

  // ③ 构建输入与上次成功构建不一致：缓存里没有逐文件输入摘要，说不出是哪一份变了，只能整批回落。
  const currentFingerprint: string = inputFingerprint(root, mode)
  if (currentFingerprint !== entry.fingerprint) {
    const cause: string = '构建输入在上次成功构建之后有变化（缓存里没有逐个文件的内容摘要，无法指出是哪一份）'
    notices.push(
      cause + '，这次退回按修改时间判断（受影响产物：' + productsText(existing) + '）。' +
      '上次成功构建时间是 ' + entry.at + '。要恢复内容判据请运行 node scripts/build.mts。',
    )
    for (const product of existing) results.push(judgeOne(root, product, sources, null, cause))
    return { products: results.sort((a, b) => a.product.localeCompare(b.product)), notices }
  }

  // ④ 逐产物比内容摘要。某个产物不在上次构建的产物记录里（产物清单变过）时，只让这一个回落并点名。
  const notRecorded: string[] = []
  for (const product of existing) {
    const expected: string | undefined = entry.outputs[product]
    if (typeof expected === 'string' && expected) results.push(judgeOne(root, product, sources, expected))
    else notRecorded.push(product)
  }
  if (notRecorded.length) {
    notices.push(
      '构建记录里没有这些产物的内容摘要（产物清单变过？）：' + productsText(notRecorded) + '。这部分退回按修改时间判断。' +
      '要恢复内容判据请运行 node scripts/build.mts。',
    )
    for (const product of notRecorded) {
      results.push(judgeOne(root, product, sources, null, '构建记录里没有这个产物的内容摘要'))
    }
  }

  return { products: results.sort((a, b) => a.product.localeCompare(b.product)), notices }
}

/**
 * 门禁统一的「判定结论 → PASS/FAIL 行」打印辅助。十处门禁原来各抄一段一模一样的循环：打 INFO、
 * 逐个产物 find 结论、拼 reason、调 check。判据只有一份，但这十份报错文案日后一定会漂，所以收拢到这里。
 * options.label 是每行前缀（默认 '产物门禁 '），options.freshText 是判绿时括号里的说明
 * （默认 '（存在且新鲜）'），options.products 指定打印顺序（默认按判定结果里排好的顺序）。
 * 输出格式与原先逐字一致：先打 '  INFO <说明>'，再逐产物打 '<label><产物><继续或：reason>'。
 */
export interface JudgeReportOptions {
  label?: string
  freshText?: string
  products?: string[]
}

export function reportJudgements(judged: JudgeResult, check: (ok: boolean, message: string) => void, options: JudgeReportOptions = {}): void {
  const label: string = options.label === undefined ? '产物门禁 ' : options.label
  const freshText: string = options.freshText === undefined ? '（存在且新鲜）' : options.freshText
  for (const notice of judged.notices) console.log('  INFO ' + notice)
  const products: string[] = options.products === undefined ? judged.products.map((p) => p.product) : options.products
  for (const product of products) {
    const found: ProductJudgement | undefined = judged.products.find((p) => p.product === product)
    check(
      !!found && found.freshness === 'fresh',
      label + product + (!found ? '：判据没有给出这个产物的结论' : found.freshness === 'fresh' ? freshText : '：' + found.reason),
    )
  }
}

