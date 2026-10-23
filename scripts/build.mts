/**
 * scripts/build.mts —— 构建管线（#1252 由同名 .mjs 转写而来），T0 阶段 0 入口。
 *
 * 本文件由 scripts/build.mjs 原样转写而来（#1252），只加类型注解，不改任何运行时语义。
 * 全部中文注释原样保留；经 createRequire 拿到的 require 调用写法原样保留，
 * 模板字符串里的 module.exports 与 exports 字样原样保留；
 * 指向测试目录的 .js 后缀不动；catch 里原来写成 (e && e.message) || e 的地方，
 * 转写后保留 && 短路形状（(e as Error) && (e as Error).message || e），as 只做类型擦除：
 * 转译产物与旧文件逐字节一致，且 throw null/undefined 时仍走原分支（#1252 对抗结论，见票面）。
 */
/**
 * scripts/build.mts — T0 阶段 0 构建管线（先把内置 TypeScript 核逐个转译，再 esbuild 双 entry）
 *
 * 第 0 步（#629）：把内置 TypeScript 核（四个，按 #1023 搬进 src/shared/<功能名>/）逐文件转译进
 *   各自的域目录，并跑一次类型检查。这一步由本文件在派生步骤之前调用，
 *   为的是让「改一行代码到看见效果」仍然只有一条命令 node scripts/build.mts。
 *
 * 规范方言 = 动态版方言（src/client/index.ts / src/host/index.ts，host/styles/React/timer 为自由变量）。
 * 一源出两物：
 *   _dev → 根 client.js / host.js（cordis_define 函数体形态，须过 precheckCode）
 *   _pkg → package/lib/client.js / package/lib/index.js（ModuleLoader / ESM 形态，pkg entry 提供 shim）
 *
 * seam（src/seam/*）：B1 runtime / B2 style / B3 rpc / B4 timer / B5 editor + G 门禁。
 * pkg 产物 = 规范源函数体（逐字保留）+ 工厂壳 + seam shim 词法绑定 —— 文本组合而非 esbuild 重写，
 * 因此 verify-* 的文本特征断言（zIndex: 2147483000、单引号、const L = { 等）保持不变。
 *
 * 门禁（G）：
 *   - dev 产物：precheckCode 包装编译（等价宿主 (async () => {code})() 校验）
 *   - pkg 产物：vm 编译 + __ModuleLoader__ 特征 + 单组件单声明
 *   - DSW_VERSION：从 package/package.json 注入（__DSW_VERSION__ 占位符替换）
 *
 * 用法：node scripts/build.mts [--dev-only|--pkg-only]
 *
 * 同步原则：永不同步。构建只产出 client.js / host.js / package/lib/*，不写任何已装配置，
 * 也不读取本机 DSH 环境（不碰 HOME 下的 .dsh/profiles，不做哈希回写）。
 * 新版本一律由人自己升级（市场升级、软件内升级、自己敲安装命令），构建不再代劳。
 * 历史上的 --sync / DSW_SYNC=1 入口已于 1.8.0-rc.1 彻底移除：再传 --sync 会直接报错退出，
 * 避免一次编译顺手改掉本机已装插件。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { spawnSync, spawn } from 'node:child_process'
import { cpus } from 'node:os'
import { deriveClient } from './derive-log-from-package.mts'
import { deriveClient as deriveUpdateClient } from './derive-update-from-package.mts'
import { bundleEntryPanel } from './bundle-update-entry.mts'

// #1023 内置 TypeScript 域的逐文件转译：原先四个计算核各自带一份 build.mjs，
// 现在收成 scripts/lib 里的一份共用实现（transpile-domains.mts），由本条命令统一驱动。
// 这样「谁写产物」只有一处：构建。做法与为什么这么做写在那个文件里。
import { buildDomain, buildSharedProductPath, domainPaths, findDomains, isLeafSourcePath, listSources, readSpliceFragmentSource, transpileUnit } from './lib/transpile-domains.mts'
import { TRANSPILE_OPTIONS, inlineExportDeclarations, generatedHeader } from './lib/transpile-unit.mts'
// #1326：构建缓存的事实（输入范围、产物清单、内容摘要算法、缓存读取）与唯一一份「产物新不新鲜」判据
// 都搬到了 lib/build-cache.mts；构建只负责按这些事实证明能不能命中、真构建成功后写回缓存。
import { CACHE_PATH, CACHE_VERSION, buildModeKey, inputFingerprint, judgeProducts, listOutputs, readCacheFile, readCacheFileUncached, sha256File } from './lib/build-cache.mts'
// #1365：同工作区构建互斥的跨进程文件锁（#1323 方案甲）。缓存没命中、真要构建时才拿锁；
// 命中直接退出的那条路不碰锁（锁只盖住删目录与写产物的那一段）。
import { acquireBuildLock, pulseBuildLock, releaseBuildLock } from './lib/build-lock.mts'

// 域里允许住**不是域源码产物**的 .js（没有域源码里的同名真源，也不该被当成陈旧产物）：
// 它们要么是手写模块、要么是域根散文件的转译产物，都住在域产物同一个目录（.build/shared/<域>/）里，
// 域的双向对账（checkDomainConsistency）要按名字豁免它们，否则会把它们报成「无源产物」。
// 今天一份：
//   · version-control/exec-envelope.js —— 真源是 src/shared/version-control/exec-envelope.ts（域根上的散文件，
//     不属于 <域>/src/ 那一圈域源码），产物由 buildSharedTs 写进同一个 .build/shared/version-control/ 目录。
// #1425 删掉 refresh 那条：refresh/chain-ride.js、refresh/refusal-text.js 是 #1023 时代的手写 .js 的防御性声明，
// refresh 域本身已经搬空（源码进 src/refresh/，产物进 .build/refresh/），.build/shared/refresh/ 不再出现，
// 留着这条只会让人以为 refresh 域还在。
const HAND_WRITTEN_IN_DOMAINS: Record<string, string[]> = {
  'version-control': ['exec-envelope.js'],
}


const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 构建缓存：输入与产物都没变就跳过这 30 秒 ----------
//
// 缓存的事实（输入范围、产物清单、内容摘要算法、缓存读取、以及唯一一份「产物新不新鲜」判据）
// 在 scripts/lib/build-cache.mts，本文件只负责按这些事实证明构建起来：命中就收工，真构建成功后写回缓存。
// 为什么搬家、判据为什么从修改时间换成内容摘要，见那个模块文件头的长注释（#1326）。
//
// 判定口径（两条都满足才跳过）：
//   一、手写输入的内容摘要与上次成功构建时一致（按内容算，不是按修改时间：只碰一下没改内容不该触发重建）；
//   二、上次成功构建记下的每个产物逐字节一致且都在盘上（产物被人改过、删过、少过，一律重建）。
// 跳过的含义是「产物与上次成功构建完全相同」，不是「构建没跑过所以结果未知」；任何输入变化都会走完整构建。
//
// 命中时一个文件都不写：产物一个字节不改、修改时间（mtime）保持原样，缓存文件也不重写（#1325）。
// 以前命中会把每个产物的 mtime 提到当前，好让「产物比源新」那几扇新鲜度门禁不误报；但本地以 link 方式
// 装着的插件正被界面使用，DSH 按文件变化热更客户端产物，每次命中都把几百个产物的 mtime 提到当前，
// 界面就跟着反复闪烁——验证链跑一次要命中十几回，面板就闪十几回。判据换成内容摘要后（#1326），
// 除缓存不可用时的回落判据外，全仓没有别处再看 mtime；这里也就不需要再动任何 mtime。
//
// 强制重建：node scripts/build.mts --force，或设 DSH_BUILD_NO_CACHE=1。
// 缓存文件落在 node_modules/.cache/ 下（不进版本库，不会被提交）。

function printArtifactSizes(devOnly: boolean, pkgOnly: boolean): void {
  const size = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8').length + ' bytes' : 'skipped')
  console.log('[build] OK')
  console.log('  client.js (dev)      ' + (devOnly ? 'skipped' : size('client.js')))
  console.log('  host.js (dev)        ' + (devOnly ? 'skipped' : size('host.js')))
  console.log('  package/lib/client.js (pkg) ' + (pkgOnly ? 'skipped' : size('package/lib/client.js')))
  console.log('  package/lib/index.js (pkg)  ' + (pkgOnly ? 'skipped' : size('package/lib/index.js')))
}

/** 缓存命中就返回 true（调用方直接收工）。任何一条对不上都返回 false，走完整构建。 */
function tryBuildCacheHit(args: string[]): boolean {
  if (args.includes('--force') || process.env.DSH_BUILD_NO_CACHE === '1') {
    console.log('[build] 按要求强制重建（--force 或 DSH_BUILD_NO_CACHE=1），不使用缓存。')
    return false
  }
  const mode: string = buildModeKey()
  const read = readCacheFile(ROOT, mode)
  if (!read.ok || !read.entry) return false
  if (read.entry.fingerprint !== inputFingerprint(ROOT, mode)) {
    console.log('[build] 手写输入有变化 → 正常构建。')
    return false
  }
  // 产物逐字节判断调用公共判据（scripts/lib/build-cache.mts 的 judgeProducts），不在构建里另写一套比较：
  // 「产物新不新鲜」只有一份实现，构建与新鲜度门禁才不会分叉（#1326 AC④）。
  // 这里传 last 记录里的全部产物；sources 传空是因为输入摘要已经单独比过，命中判断不需要回落路径。
  // 真出现「记录里没有某个产物的摘要」时，判据在没有源码清单的情况下会判 stale 而不是假装新鲜，
  // 于是照常走真构建、把记录补全——这正是命中判断想要的结果。
  const judged = judgeProducts({ root: ROOT, mode, products: Object.keys(read.entry.outputs), sources: [] })
  // 判据回落时的说明不能吞掉：命中判断虽然不生成门禁 INFO 行，也要让人看得到「这次为什么按旧办法判」。
  for (const notice of judged.notices) console.log('[build] 注意：' + notice)
  const bad: string[] = judged.products.filter((p) => p.freshness !== 'fresh').map((p) => p.product)
  if (bad.length) {
    console.log('[build] 产物与上次成功构建不一致 → 正常构建（' + bad.slice(0, 5).join(' / ') + '）。')
    return false
  }
  // 命中时不写盘：产物一个字节不改、mtime 原样（理由见文件头缓存那段注释，#1325）。
  // 这里只要「什么都不做」，就是这段逻辑想要的最终效果。
  console.log('[build] 缓存命中：输入与产物都没变，这次没有重建、没有写任何产物文件（产物修改时间保持原样，省下约 30 秒；要强制重建加 --force）')
  printArtifactSizes(args.includes('--dev-only'), args.includes('--pkg-only'))
  console.log('[build] 构建只写仓库内产物，不碰本机已装配置')
  return true
}

/** 构建成功后记下「这次是哪些输入、产出了哪些字节」，供下次比对。 */
function writeBuildCache(): void {
  try {
    const outputs: Record<string, string> = {}
    for (const rel of listOutputs(ROOT)) outputs[rel] = sha256File(join(ROOT, rel))
    // 写回前先读已有缓存：别的构建模式（--pkg-only 等）的条目要留着，不能因为本档写入就整份丢掉。
    // 这里必须重新读盘（readCacheFileUncached），不能复用开头判缓存命中时读到的快照：
    // 那个快照是几十秒前真构建开始前读的，这期间别的会话可能写回过缓存；构建进程是缓存唯一的写者，
    // 但写者自己也要按磁盘最新内容合并，否则会把别人刚写进来的条目整份盖掉。
    const read = readCacheFileUncached(ROOT, buildModeKey())
    const cache: any = read.cache ?? { version: CACHE_VERSION, entries: {} }
    cache.version = CACHE_VERSION
    cache.entries[buildModeKey()] = { fingerprint: inputFingerprint(ROOT, buildModeKey()), outputs, at: new Date().toISOString() }
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8')
  } catch (e) {
    console.log('[build] 构建缓存写不进去（不影响本次构建）：' + ((e as Error) && (e as Error).message || e))
  }
}

// ---------- 工具 ----------
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')
const write = (p: string, content: string): void => {
  const abs: string = resolve(ROOT, p)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** 已安装更新包的版本号（#800：面板派生唯一数据源；读不到就报未知，不阻断构建，派生步骤会再报错）。 */
function deriveUpdateClientVersionForLog(): string {
  try {
    return JSON.parse(read('node_modules/dsh-plugin-update/package.json')).version || '未知'
  } catch {
    return '未知'
  }
}

/** 从规范源模块提取插件对象函数体（export default { ... } 的 `{ ... }` 部分，含 apply 方法）。
 *  插件对象 = export default 之后到文件末尾的内容（规范源约定：对象闭合是文件最后一个 `}`）。 */
/** esbuild 降级复原：transformSync 把 `export default {` 变成 `var 〈名〉 = {` + 尾部重导出，
 * 名字是 esbuild 按输入起的（无文件名时叫 stdin_default），这里不写死名字：头用正则认，
 * 尾用同名反查，两处任一对不上就抛（esbuild 一改形状构建当场红，不产出半吊子包）。 */
function restoreLoweredDefault(tsCode: string): string {
  const head: RegExpMatchArray | null = tsCode.match(/^var ([\w$]+) = \{$/m)
  if (!head) throw new Error('[build] 宿主入口转译产物里找不到降级的默认导出')
  const varName: string = head[1]
  const esc: string = varName.replace(/\$/g, '\\$')
  const tailRe: RegExp = new RegExp('\\nexport \\{\\s*' + esc + ' as default\\s*\\};?\\s*$')
  if (!tailRe.test(tsCode)) throw new Error('[build] 宿主入口转译产物尾不是 export { ' + varName + ' as default }')
  return tsCode.replace(tailRe, '\n').replace(/^var [\w$]+ = \{$/m, 'export default {')
}
function extractPluginBody(srcPath: string, srcTextOverride?: string): { header: string; body: string } {
  // #1074（修）：调用方把转译好的文本直接递进来时不再读盘（宿主入口转成 .ts 后，抽的是转译产物不是手写源）；
  //   不传就走老路。srcPath 只剩报错指路用。
  const src: string = (srcTextOverride !== undefined) ? srcTextOverride : read(srcPath)
  const marker: string = 'export default {'
  const idx: number = src.indexOf(marker)
  if (idx < 0) throw new Error(`${srcPath}: 找不到 export default {`)
  const start: number = idx + marker.length - 1 // 指向 {
  const end: number = src.lastIndexOf('}') // 对象闭合 = 文件末尾的 }
  if (end < start) throw new Error(`${srcPath}: 找不到对象闭合`)
  return {
    header: src.slice(0, idx).replace(/\s+$/, ''), // 头注释
    body: src.slice(start, end + 1), // { apply(ctx) {...} }
  }
}

// ---------- seam shim 文本（pkg 方言绑定） ----------
/** B3 rpc + B2 style + B4 timer 的 pkg 方言 shim（工厂壳内词法绑定，源函数体的自由变量解析到它们）。 */
const PKG_CLIENT_SHIMS: string = `    // ===================== seam shims（pkg 方言绑定 · B3 rpc / B2 style / B4 timer） =====================
    const React = require('react')
    let __DSW_CTX__ = null
    // #596：DSH 的 connection.rpc.call 按 channel/endpoint 拼请求路径。走公开的 /api 载体时，
    // 拼出的是 /api/dsws——与宿主 connection.fetch.register 注册的精确路径同源；
    // 真正的端点名与入参装进请求体（{method, payload}，与 dsh-im-companion 同构）。
    // 旧写法 channel='/dsws' 拼出 /dsws/<端点>，要落到那条需要 webServer 注入的前缀路由上，注册期必抛。
    const CARRIER_CHANNEL = '/api'
    const CARRIER_ENDPOINT = 'dsws'
    const __rpcCall = async function (endpoint, args) {
      const ctx = __DSW_CTX__
      const conn = ctx && ctx.get ? ctx.get('connection') : undefined
      if (conn === undefined || conn.rpc === undefined) throw new Error('connection 服务不可用')
      const res = await conn.rpc.call(CARRIER_CHANNEL, CARRIER_ENDPOINT, { method: endpoint, payload: args })
      if (res && res.ok) return res.value
      throw new Error((res && res.error && res.error.message) || ('RPC 失败：' + endpoint))
    }
    const host = {
      call: (method, args) => __rpcCall(method.replace(/^wf\\./, ''), args)
    }
    const styles = {
      insert: (css) => {
        const ctx = __DSW_CTX__
        const styleEl = document.createElement('style')
        styleEl.setAttribute('data-plugin', 'dsh-mattpocock-skills-deck')
        styleEl.textContent = typeof css === 'string' ? css : Array.isArray(css) ? css.join('') : String(css)
        document.head.appendChild(styleEl)
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略 */ }
          }, 'dsh-mattpocock-skills-deck: styles')
        }
        return () => {
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略 */ }
        }
      }
    }
    const timer = {
      schedule: (fn, ms) => {
        const ctx = __DSW_CTX__
        const timerSvc = ctx && ctx.get ? ctx.get('timer') : undefined
        if (timerSvc !== undefined && timerSvc.timeout) return timerSvc.timeout(fn, ms)
        return setTimeout(fn, ms)
      }
    }`
/** 宿主侧 pkg shim：harness.handle('wf.x', fn) → dispatch 表（对外分发见 src/host/rpcChannel.js）。
 *  #172 方案 C 原样复制已不再使用此拼接，保留常量仅作历史参照（零打包不变量）。
 *  #596：分发通道由 connection.rpc.handle 换成 DSH 公开的精确路由 connection.fetch.register，
 *  注册路径 /api/dsws（单条精确路由，端点名走请求体）。 */
const PKG_HOST_PREAMBLE: string = `// ===================== seam shims（pkg 方言绑定 · B3 rpc host 侧） =====================
const __DSW_HANDLERS__ = new Map()
const harness = {
  handle: (method, fn) => {
    const endpoint = method.replace(/^wf\\./, '')
    __DSW_HANDLERS__.set(endpoint, fn)
  }
}
`

// ---------- 版本注入 ----------
function dswVersion(): string {
  const pkg = JSON.parse(read('package/package.json'))
  return 'v' + pkg.version
}

/** 仓库主页 URL（#repo-link）：package/package.json 的 repository 字段（string 或 {url}），
 *  去 git+ 前缀与 .git 后缀。版本号可点跳转的单一真源；客户端源码只有 __DSW_REPO_URL__ 占位符，
 *  无 URL 字面量（过硬编码门禁 F2），产物中的字面量已在门禁 RE_LICENSED 登记。 */
function dswRepoUrl(): string {
  const pkg = JSON.parse(read('package/package.json'))
  const r: any = pkg.repository
  const raw: any = typeof r === 'string' ? r : (r && r.url) || ''
  const url: string = String(raw).replace(/^git\+/, '').replace(/\.git$/, '')
  if (!url) throw new Error('[build] package/package.json 缺 repository 字段，__DSW_REPO_URL__ 注入无源')
  return url
}

function injectVersion(body: string, version: string, repoUrl: string): string {
  return body.split('__DSW_VERSION__').join(`'${version}'`).split('__DSW_REPO_URL__').join(`'${repoUrl}'`)
}

// ---------- 说明同步（单说明源头 · #479 最简收口） ----------
/** 根 README.md 为唯一源头；package/README.md 为构建生成物（npm 页面展示用），禁止手改。
 *  生成时只做四类机械替换（正文一字不动）：相对图片转仓库绝对地址（npm 包内无
 *  assets 目录）、相对文档链接转仓库绝对地址、版本 pin 跟随当前版本。
 *  注意：'1.7.14' 字面在此充当版本槽位（源头里所有出现处均为现行版本引用）；
 *  若未来正文出现历史版本号行，请改写措辞避开该字面。
 *  tests/verify-readme-sync.js 按同口径断言，手改生成物即红。 */
const readmeAutogenBanner = (version: string): string => `<!-- AUTO-GENERATED by scripts/build.mts — DO NOT EDIT. Source: ../README.md @ ${version} -->\n\n`
function readmeForNpm(rootMd: string, version: string, repoUrl: string): string {
  const verNum: string = String(version).replace(/^v/, '')
  const base: string = String(repoUrl).replace(/\/$/, '')
  const rawBase: string = base + '/raw/main/'
  const blobBase: string = base + '/blob/main/'
  return rootMd
    .split('src="assets/').join(`src="${rawBase}assets/`)
    .split('](assets/').join(`](${rawBase}assets/`)
    .split('](docs/').join(`](${blobBase}docs/`)
    .split('(docs/').join(`(${blobBase}docs/`)
    .split('1.7.14').join(verNum)
}
function syncReadme(version: string, repoUrl: string): void {
  const out: string = readmeAutogenBanner(version) + readmeForNpm(read('README.md'), version, repoUrl)
  write('package/README.md', out)
  console.log(`[build] README 已同步 package/README.md（${out.length} bytes，源头 README.md）`)
}

// ---------- 门禁（G） ----------
function gatePrecheck(code: string, label: string): void {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    if (process.env.DSH_PRECHECK_LOC) console.error('LOC '+label+' :: '+((e as Error).stack||'').split('\n').slice(1,3).join(' | '))
    throw new Error(`[G门禁] ${label} precheckCode 失败：${(e as Error).message}`)
  }
}
function gateSyntax(code: string, label: string): boolean {
  // ESM（export）用 node --check 校验（.mjs 按模块解析）；其余用 vm.Script。
  // 不用 esbuild：它的异步与同步校验都要经后台服务落临时文件，本机删临时文件被拦截
  // （Access is denied，换目录重跑三次同一位置失败，2026-09-29 实测）。node --check 的
  // 校验语义等价（只解析不执行），临时文件落在仓库 .tmp 内（已忽略），删不掉也不碍事。
  if (/\bexport\b/.test(code)) {
    try {
      // 临时文件名带上进程号：同一台机器上两个构建同时跑时（本仓常有并发会话，门禁内部也可能再跑一次构建），
      // 固定文件名会出现「一个刚写完、另一个已删掉」，node --check 于是报找不到文件，把一次正常构建误判成语法失败。
      const tmpFile: string = resolve(ROOT, `.tmp/gate-syntax-check-${process.pid}.mjs`)
      mkdirSync(dirname(tmpFile), { recursive: true })
      writeFileSync(tmpFile, code, 'utf8')
      const r: any = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' })
      try { rmSync(tmpFile, { force: true }) } catch { /* 删不掉就留着，.tmp 不入库 */ }
      if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'node --check 非 0').split('\n').slice(0, 3).join(' | '))
    } catch (e) {
      if ((e as Error) && (e as Error).message && (e as Error).message.startsWith('[G门禁]')) throw e
      throw new Error(`[G门禁] ${label} 语法编译失败：${(e as Error).message}`)
    }
    return true
  }
  try {
    new vm.Script(code, { filename: `gate-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} 语法编译失败：${(e as Error).message}`)
  }
  return true
}
function gateModuleLoader(code: string, label: string): void {
  if (!code.includes('window.__ModuleLoader__.load')) {
    throw new Error(`[G门禁] ${label} 缺 __ModuleLoader__ 特征`)
  }
}
function gateSingleDeclaration(code: string, label: string, names: string[]): void {
  for (const name of names) {
    const re = new RegExp(`(?:const|function|var)\\s+${name}\\s*[=(]`, 'g')
    const hits = code.match(re) || []
    if (hits.length > 1) throw new Error(`[G门禁] ${label} ${name} 声明 ${hits.length} 次（应恰好 1 次）`)
  }
}

// ---------- Ctx 模块组合（阶段 2 步骤 1 · #95） ----------
/** 从 src/client/kernel/ctx.ts 提取声明体（.ts 先按全仓唯一口径转译再去行首 export）。
 *  注入 client 插件对象 apply 闭包顶部 —— 双产物同构，一源两物（与 seam shims 同模式）。
 *  #1251：旧真源 ctx.js 已删，这里改指新真源。读取一律走 spliceText（统一入口：转译 + 去行首
 *  export + 补末尾换行），不再直调更底层的 readSpliceFragmentSource —— 那样会绕开补换行那一步，
 *  也正是 tests/verify-1207-splice-ts.ts 判红的「除统一入口外还有别的读缝调用」。 */
function extractCtxBlock(): string {
  return spliceText('src/client/kernel/ctx.ts').trim()
}
function wireCtx(body: string): string {
  // #1254：入口转 .ts 后这里是 `apply(ctx: any) {`——注入点按形状认（apply(ctx…) {），不钉死冒号注解。
  const m: RegExpMatchArray | null = body.match(/apply\(ctx(?::[^)]*)?\) \{/)
  if (!m || m.index === undefined) throw new Error('src/client/index.ts 找不到 apply(ctx) { 注入点（Ctx 接线失败）')
  const end: number = m.index + m[0].length
  return body.slice(0, end) + '\n' + extractCtxBlock() + '\n' + body.slice(end)
}

// ---------- Kernel 模块组合（阶段 2 内核迁移 · #96 T3）----------
/** 内核模块清单（docs/architecture/kernel-contract.md · G3 冻结 · 迁移完成即全活跃）。
 *  index.js 中每模块原位置留标记 `// ==== kernel:<name> (spliced by build) ====`，
 *  构建时把模块文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化。 */
const KERNEL_MODULES: { name: string; file: string }[] = [
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'backendList', file: 'src/client/kernel/builtin-backends.ts' },
  { name: 'link', file: 'src/client/kernel/link.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'styles', file: 'src/client/kernel/styles.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'portal', file: 'src/client/kernel/portal.ts' },
  // #1294：界面词表的生成物（config/languages.yaml + config/copy/*.yaml → locale-data.ts）。
  //   必须在 locale.ts 之前拼进去：本片给出 LANG_CONFIG / LOCALE_LANGS / LOCALE_COPY 与各族词条常量
  //   （L_PANEL … L_SPEC），locale.ts 的合并器与取词助手直接用这几个名字（客户端闭包不许 module 级 import）。
  //   生成物不入库，由 scripts/generate-locale-config.mts 现场生成（见下方生成器 spawn 块）。
  { name: 'localeData', file: 'src/client/kernel/locale-data.ts' },
  // #1294：界面词表的合并器、按语言清单取词的助手、注册 dsws 命名空间与这趟的日志（原十份片段已搬进 config/copy/）。
  { name: 'locale', file: 'src/client/kernel/locale.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'icons', file: 'src/client/kernel/icons.ts' },
  // #685：「体检」按钮的件数派生与开新会话注入（游离票口径见 #678、按钮形态见 #681）；
  //   它写的那条常驻日志必须落在内核文件里（渲染目录写日志是一张点名白名单），所以单独一片。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'healthCheck', file: 'src/client/kernel/health-check.ts' },
  // #1292：提示词配置的生成物（config/prompts/ 下的 YAML + config/languages.yaml → prompt-data.ts）。
  //   必须在 prompts.ts 之前拼进去：本片给出 PROMPT_TEMPLATE_DATA / PROMPT_FRAGMENT_DATA / LANGUAGES_YAML
  //   三个运行时名字，prompts.ts 与 prompts-backend.ts 在闭包里直接用这三个名字（客户端闭包不许 module 级 import）。
  { name: 'promptData', file: 'src/client/kernel/prompt-data.ts' },
  // #1209：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 从此是 pixel-ts 那一步的产物，不再入库）。
  { name: 'prompts', file: 'src/client/kernel/prompts.ts' },
  // #698：初始化那段文案「该不该注入 / 先问还是先给」的决策（layoutCardShouldOpen / injectSetupDecision）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'promptsSetup', file: 'src/client/kernel/prompts-setup.ts' },
  // #1292：「按当前后端渲染一条 prompt」那一族导出从 prompts.ts 拆出（避 350 行上限）。
  //   拼装顺序必须在 prompts.ts 之后：本片里的 currentBackendId / vocabularyParamsFrom / promptText 由
  //   prompts.ts 先提供，backendParamsFor / promptTextFor 再被本片正确定位。
  { name: 'promptsBackend', file: 'src/client/kernel/prompts-backend.ts' },
  // #698：弹窗表单字段那一串渲染（slotRenderer-modal-view.js 那时到了 404 行）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'modalFields', file: 'src/client/kernel/modal-fields.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'config', file: 'src/client/kernel/config.ts' },
  // #586 切更新包：面板要用的电话名与轮询间隔由更新包派生（改名或改间隔只改包，不在这里写死）
  { name: 'updateClient', file: 'scripts/generated/updateClient.derived.js' },
  // #876 入口件浏览器绑定包（已安装更新包 dist/entry.js 含内部 dialog 面板，摆法与关闭轮询约定走包默认）
  { name: 'updateEntryBundle', file: 'scripts/generated/updateEntryPanel.bundle.js' },
  { name: 'log', file: 'scripts/generated/logKernel.derived.js' },
  // 本次界面反馈需求：全客户端唯一的按压委托与点击日志口（ui.action），必须排在 log 之后、页面组件之前。
  { name: 'uiFeedback', file: 'src/client/kernel/ui-feedback.ts' },
  // 构建内核清单含日志模块（运行时拼上面的派生文件，#564 留派生不搬；
  //   #1251：旧手写真源 log.js 已删，同内容住在 src/client/kernel/log.ts，只供门禁经钩子直读）。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'storePrefs', file: 'src/client/kernel/store-prefs.ts' },
  // #1012：按工作区的观看状态（横幅折叠、红文件夹标志自动展开过没有）从 localStorage 搬到本机设置文件。
  //   store-prefs.js 在搬出这一族之前（父提交 3a7063b9）按门禁算法已 317 行（上限 350），
  //   这一族读写照仓库惯例单独成片：
  //   键与文档、读一格、把文档交给界面都在 src/client/kernel/settings-view.js 里；
  //   写这一趟（待写队列、防抖、写前重读合并、写失败重试）在 src/client/kernel/settings-view-write.js 里。
  //   上面那一片（settingsViewState）是这两片的前置：设置文档异步读来，「问完真源了没有」这两个口子
  //   （viewFlagReadyNow / viewFlagSubscribe）与状态对象都在它里面，标记必须排在本文这一行之前；
  //   写那一片又要用读这一片的键与文档工具，所以它的标记必须排在 settingsView 之后。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'settingsViewState', file: 'src/client/kernel/settings-view-state.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'settingsView', file: 'src/client/kernel/settings-view.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'settingsViewWrite', file: 'src/client/kernel/settings-view-write.ts' },
  // #1012 第 3 步：界面偏好那三格（列表筛选/排序键/排序方向）从 localStorage 搬到本机设置文件的 ui 节。
  //   与上面那一族共用同一个待写队列与同一份文档，所以标记必须排在 settingsViewWrite 之后；
  //   旧键 dsws.listPrefs 那一条留着当过渡，读写两头的分工见该文件开头的说明。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'settingsUi', file: 'src/client/kernel/settings-ui.ts' },
  // #1012 第 4 步：11 条动作模板从 localStorage 的旧键 dsws.templates 搬到本机设置文件的 templates 节。
  //   与上面那两族共用同一个待写队列与同一份文档，所以标记必须排在 settingsViewWrite 之后；
  //   旧键那一条留着当过渡（读先看文件、写成功就不写旧键），读写两头与拼接次序的理由见该文件开头的说明。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'settingsTemplates', file: 'src/client/kernel/settings-templates.ts' },
  // #1012 第 8 条：调试开关的真源从宿主那份 log-switch.json（与旧键 dsws.debug）搬进本机设置文件的 debug 节。
  //   与上面三族共用同一个待写队列与同一份文档，所以标记必须排在 settingsViewWrite 之后；它还要用运行时那份
  //   日志内核的名字（上面第 500 行的 log），所以必须排在 log 之后。
  { name: 'settingsDebug', file: 'src/client/kernel/settings-debug.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'storeSwitch', file: 'src/client/kernel/store-switch.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'storeSnapshot', file: 'src/client/kernel/store-snapshot.ts' },
  // #1355：每个会话自己的工作路线读数（剥表、补拉、三处接线共用的请求决策）从 storeSnapshot 拆到这里——
  //   那片从 #707 起贴着 350 行上限，本票再加三件判断就会超。标记排在 storeSnapshot 之后：
  //   本片只调用标在它前面的 snapNeedsOwnWorkRoute，且只在运行时调用，拼接次序按这条依赖关系排。
  { name: 'workRouteOwn', file: 'src/client/kernel/work-route-own.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'storeDerived', file: 'src/client/kernel/store-derived.ts' },
  // 行级动作全家从 store-derived.ts 原样抽出（那份越过每文件 350 有效行的门禁）；
  //   必须排在本条之后：findMapByIdentity 与 isLightHex 由 store-derived 定义。
  { name: 'rowActions', file: 'src/client/kernel/row-actions.ts' },
  // #1286：容器（探索地图与规格）的判定、取色与提示词单一真源。
  { name: 'containerView', file: 'src/client/kernel/container-view.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'apiNaming', file: 'src/client/kernel/api-naming.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'apiPresetGuard', file: 'src/client/kernel/api-preset-guard.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'apiWorkspace', file: 'src/client/kernel/api-workspace.ts' },
  // #1251：交接执行那一族（探测交接文档、生成交接文档、带着交接文档开新会话）从下面 apiNewSession
  //   里拆了出来 —— 拆的原因与 #636 拆 api-workspace 一样：原文件有效行超过 350 行上限。
  //   标记排在 apiNewSession 之前，与拆出前这一族所在的位置一致：闭包内声明按标记先后求值，
  //   保持原顺序就不必再论证「谁先谁后」（openTextInNewSession 在运行时调 probeHandoffReady）。
  { name: 'apiHandoff', file: 'src/client/kernel/api-handoff.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'apiNewSession', file: 'src/client/kernel/api-new-session.ts' },
  { name: 'apiIo', file: 'src/client/kernel/api-io.ts' },
  // #690：历史票的页数据（已关闭票按需翻页）—— 按工作区/后端/仓库/视图/筛选分桶、按身份去重、
  //   静默刷新不清空、内存最多留 10 页；单独一片是因为 storeSnapshot 已贴 350 行上限，塞不进去。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'issuePages', file: 'src/client/kernel/issue-pages.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'actions', file: 'src/client/kernel/actions.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'slots', file: 'src/client/kernel/slots.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'slotRendererQueue', file: 'src/client/kernel/slotRenderer-queue.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'slotRendererRepoSync', file: 'src/client/kernel/slotRenderer-repo-sync.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'slotRendererModalView', file: 'src/client/kernel/slotRenderer-modal-view.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeChain', file: 'src/client/kernel/probe-chain.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeStale', file: 'src/client/kernel/probe-stale.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeSnapshot', file: 'src/client/kernel/probe-snapshot.ts' },
  // #727：「这个工作区用哪个后端」这条事实的两条专用轨迹（进工作区补问一次 wf.selection；
  //   那次快照超时之后、回包迟到时怎么落地那一小块）。理由与上一行的 #707 同一条：
  //   probe-snapshot.js 一直贴着 350 行上限，塞不进去。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeSelect', file: 'src/client/kernel/probe-select.ts' },
  // #707：probe-snapshot.js 拆到这里之前 349 行（门禁上限 350），已无下脚的地方，故把颜色小函数、
  //   数据层增量差异、高亮清除这三样与「下载快照」无关的东西搬成单独一片。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeSnapshotHelpers', file: 'src/client/kernel/probe-snapshot-helpers.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'probeAuto', file: 'src/client/kernel/probe-auto.ts' },
  // #707：视野模型的客户端半边 —— 窗口标识（sessionStorage，不能放 localStorage）、焦点与可见性监听、
  //   面板可见时每 20 秒一次的本地心跳（零配额、不出网）、以及「只服务活跃工作区」那条探测节拍。
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'attentionHeartbeat', file: 'src/client/kernel/attention-heartbeat.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { name: 'router', file: 'src/client/kernel/router.ts' },
  // #1297：入口浮层（一个「新建需求」入口 → 浮层里探索地图 / 实施地图两张卡）。
  //   卡面画法（entryCard）在前，浮层与选卡接线（entryChoice）在后：后者画卡要调前者；
  //   两片的拼接点都在 leaf:tabs / leaf:statusBar 之前（见 src/client/index.ts 的 marker 次序）。
  { name: 'entryCard', file: 'src/client/kernel/entry-card.ts' },
  { name: 'entryChoice', file: 'src/client/kernel/entry-choice.ts' },
]

// ---------- 共享核心拼装（一源两物 · #265）----------
/** 共享纯函数模块（src/shared/*）：host 半运行时 import()；client 半按与 kernel 同模式的
 *  标记拼回闭包 —— 原文零复制（去行首 export），两半共用同一份实现文本，无第二处命名真源。
 *  shared-0（#443）接线结论：下面各项与 src/client/index.ts 里拼接标记一一对应，已经对齐；(#1254 真源转写)
 *  chain 系与 check-catalog 系只被 host 半在运行时引用，client 半没有运行时引用，
 *  所以不进拼接清单，S1/S3 拆分时不新设拼接标记；naming-guardian.js（498 行）两半都要用，
 *  S2（#452）已拆成标题、跟踪、归属 3 个文件，此处记 3 个拼接项与 3 个标记位（做法见 #443 票内接线图）。
 *  跟踪与归属文件内复刻的标题小函数改了名前缀，拼回同一个界面闭包时不与标题文件重名。 */
const SHARED_SPLICE: { marker: string; file: string }[] = [
  // effort 维度（2026-09-09）：票身份算法（effortOf / idOf / idOfParts）与常量同住，
  // #1026 之后真源是五份（常量仍住契约目录，行为已搬出）：常量 canonical-labels.ts 与
  // vocabulary.ts、票身份 identity-keys.ts、名单派生 label-names.ts、修复拼装 fix-contract.ts；
  // 这五份各自是普通模块（彼此用相对 import 连），拼进闭包之前必须合成一段：所以构造时先把它们
  // 拼成一段再转译，落到 .tmp/vocabulary.client.js（见下面的 buildVocabularySpliceInput；.tmp 是
  // 构建自己的临时目录，不入库、每次构建重算），这里拼的是那一份临时输入。
  // 面板侧要按 (effort, 编号) 定位，故把这份零依赖叶子一并拼进界面闭包（host 半走 import，同源同文本）。
  { marker: '// ==== shared:trackerConstants (spliced by build) ====', file: '.tmp/vocabulary.client.js' },
  // #668：首开引导链的步骤清单是「一份顺序、三处读它」里的那一份真源（规格见 #662「定版一」）。
  // 宿主按它给链快照排序（src/refresh/rooms/host/check-chain-evaluation.js）；状态栏横幅与注入决策（#663 / #664）也要读它，
  // 所以这份零依赖清单必须拼进界面闭包 —— 客户端半边今天没有任何对 src/shared 的运行时 import。
  { marker: '// ==== shared:guideSteps (spliced by build) ====', file: 'src/shared/tracker/guide-steps.ts' },
  { marker: '// ==== shared:namingTitles (spliced by build) ====', file: 'src/shared/naming-titles.ts' },
  { marker: '// ==== shared:namingTracking (spliced by build) ====', file: 'src/shared/naming-tracking.ts' },
  { marker: '// ==== shared:namingAttribution (spliced by build) ====', file: 'src/shared/naming-attribution.ts' },
  { marker: '// ==== shared:trackerSync (spliced by build) ====', file: 'src/shared/tracker/sync.ts' },
  { marker: '// ==== shared:slots (spliced by build) ====', file: 'src/shared/ui/slots.ts' },
  { marker: '// ==== shared:mattSkills (spliced by build) ====', file: 'src/shared/matt-skills.ts' },
  { marker: '// ==== shared:workspaceKey (spliced by build) ====', file: 'src/shared/workspaceKey.ts' },
  // #629 配色核心的两份真源：宿主半走普通相对 import，客户端半要按同一份口径判断
  // 用户填的颜色能不能用、颜色有没有变，所以把这两份零依赖真源一并拼进界面闭包。
  // 它们的顶层名字由 tests/verify-generated-no-shadow.ts 与既有的派生文件一起比对，
  // 产物里不许出现 __DSW_VERSION__ 与 __DSW_REPO_URL__（拼接发生在版本注入之后）。
  { marker: '// ==== shared:labelColors (spliced by build) ====', file: 'src/shared/label-color/src/colors.ts' },
  { marker: '// ==== shared:labelColorPrompt (spliced by build) ====', file: 'src/shared/label-color/src/prompt.ts' },
  // #715 诚实显示：新鲜度阈值（5 分钟黄 / 30 分钟红）、合并窗口（10 秒）、降档的延迟承诺，
  // 全部只有一份真源 src/refresh/kernel/host-budget.ts（#1425 起从 src/shared/refresh/src/budget.ts 搬来）。
  // 拼接标记的名字沿用 shared:refreshBudget（src/client/index.ts 与 truthLines.ts 按这个名字对接，改名要动界面两处）；
  // 界面那一半不能运行时 import（客户端半边今天没有任何对 src/shared 的运行时 import），
  // 所以按同一套拼接做法把这一份真源拼进界面闭包 —— 界面只许消费这些名字，不许再写一份数字。
  { marker: '// ==== shared:refreshBudget (spliced by build) ====', file: 'src/refresh/kernel/host-budget.ts' },
  // #842 写操作：判定（能不能暂存/提交/拉取/推送）只有一份真源 src/shared/version-control/src/rules.ts，
  //   界面不许自己算（自己算就会与宿主执行前那次判定各说各话），所以把这一份也拼进界面闭包。
  { marker: '// ==== shared:vcRules (spliced by build) ====', file: 'src/shared/version-control/src/rules.ts' },
  // #1342 域文档布局的取值（单上下文 / 多上下文）只有一份真源 src/shared/doc-layout/src/layouts.ts。
  //   界面侧状态栏与初始化卡要按同一份名单校验用户选的那一项（拒收第三档取值），所以拼进界面闭包；
  //   宿主侧选择记忆与工作区配置核按普通相对 import 取同一份源文件（不是拼接，是同一个文件）。
  { marker: '// ==== shared:docLayout (spliced by build) ====', file: 'src/shared/doc-layout/src/layouts.ts' },
  // #1215 中央时间参数：全部时间旋钮只有一份真源（config/ 下的 timeouts.yaml / intervals.yaml / ttl.yaml），
  // 产物由生成器落到 .build/shared/time-config/values.js（真源是生成出来的 src/shared/time-config/src/values.ts；
  // 构建会先重跑生成器，见上面的预域再生；2026-10-19 第三阶段起共享层产物统一住 .build/shared/）。
  // 界面那一半不能运行时 import（客户端半边今天没有任何对 src/shared 的运行时 import），
  // 所以按同一套拼接做法把客户端消费的那几个常量拼进界面闭包 —— 整份 values.js 不能拼（与 refreshBudget
  // 重名，见下面的 buildTimeConfigClientFragment），这里拼的是摘出来的 .tmp 片段（不入库，每次构建重算）。
  // 消费文件自己写模块级 declare const（见 src/client/views/pixelProps.d.ts 的约定）。
  { marker: '// ==== shared:timeConfig (spliced by build) ====', file: '.tmp/time-config.client.js' },
]

// ---------- 叶子模块组合（阶段 2 叶子迁移 · #97 T4）----------
/** 叶子组件模块清单（G3 共享 → views/shared/ · G4 严格一文件 ≤350 行）。
 *  与 kernel 同模式：index.js 中原位置留标记 `// ==== leaf:<id> (spliced by build) ====`，
 *  构建时把叶子文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化；
 *  组件经 React.useContext(DswsCtx) 消费 cx（ARCHITECTURE-CTX.md §2）。 */
const LEAF_MODULES: { id: string; file: string }[] = [
  { id: 'chips', file: 'src/client/views/shared/chips.ts' },
  { id: 'hoverTip', file: 'src/client/views/primitives/HoverTip.ts' },
  { id: 'tip', file: 'src/client/views/primitives/Tip.ts' },
  // 本次界面反馈需求：液态墨块（页签与列表筛选药丸共用），必须排在 leaf:tabs 之前登记。
  { id: 'liquidInk', file: 'src/client/views/shared/liquidInk.ts' },
  // 887 技能详情像素风：八个最小组件（无依赖，按使用次序登记）
  { id: 'pixelBtn', file: 'src/client/views/pixel/PixelBtn.ts' },
  { id: 'pixelDot', file: 'src/client/views/pixel/PixelDot.ts' },
  { id: 'pixelNum', file: 'src/client/views/pixel/PixelNum.ts' },
  { id: 'pixelStateIcon', file: 'src/client/views/pixel/PixelStateIcon.ts' },
  { id: 'pixelSeal', file: 'src/client/views/pixel/PixelSeal.ts' },
  { id: 'pixelSkeleton', file: 'src/client/views/pixel/PixelSkeleton.ts' },
  { id: 'pixelBanner', file: 'src/client/views/pixel/PixelBanner.ts' },
  { id: 'pixelStatusLine', file: 'src/client/views/pixel/PixelStatusLine.ts' },
  // S1/S6/S7 三种卡片：先主题与皮肤，再共享小件，最后三张大卡（次序即依赖次序）。
  { id: 'cardsTheme', file: 'src/client/views/cards/PixelCardTheme.ts' },
  { id: 'cardsStyles', file: 'src/client/views/cards/PixelCardsStyles.ts' },
  { id: 'cardPin', file: 'src/client/views/cards/PixelCardPin.ts' },
  { id: 'cardTitle', file: 'src/client/views/cards/PixelCardTitle.ts' },
  { id: 'cardNo', file: 'src/client/views/cards/PixelCardNo.ts' },
  { id: 'cardTags', file: 'src/client/views/cards/PixelCardTags.ts' },
  { id: 'cardNote', file: 'src/client/views/cards/PixelCardNote.ts' },
  { id: 'cardFoot', file: 'src/client/views/cards/PixelCardFoot.ts' },
  { id: 'cardStamp', file: 'src/client/views/cards/PixelCardStamp.ts' },
  { id: 'blockedChrome', file: 'src/client/views/cards/PixelBlockedChrome.ts' },
  { id: 'cardBtns', file: 'src/client/views/cards/PixelCardBtns.ts' },
  { id: 'mapDots', file: 'src/client/views/cards/PixelMapDots.ts' },
  { id: 'cardHead', file: 'src/client/views/cards/PixelCardHead.ts' },
  { id: 'issueCard', file: 'src/client/views/cards/PixelIssueCard.ts' },
  { id: 'issueMapCard', file: 'src/client/views/cards/PixelIssueMapCard.ts' },
  { id: 'mapCard', file: 'src/client/views/cards/PixelMapCard.ts' },
  { id: 'backendSelector', file: 'src/client/views/shared/BackendSelector.ts' },
  { id: 'switchConfirmModal', file: 'src/client/views/shared/SwitchConfirmModal.ts' },
  // #621 标签配色的七个叶子（纯函数三份 + 状态机一份 + 界面三份；按拼接次序登记，次序即依赖次序）
  { id: 'labelColorErrors', file: 'src/client/views/labels/labelColorErrors.ts' },
  { id: 'labelColorPatch', file: 'src/client/views/labels/labelColorPatch.ts' }, // #635 新增：保存成功后把后端确认的颜色写进面板那份快照（面板当场按新色显示，不等那次全量重拉）
  { id: 'labelColorPalette', file: 'src/client/views/labels/labelColorPalette.ts' }, // #637 新增：入口图标的颜色（四个 wayfinder 标签的真实颜色加默认兜底，纯函数）
  { id: 'useLabelColors', file: 'src/client/views/labels/useLabelColors.ts' },
  { id: 'labelColorRow', file: 'src/client/views/labels/LabelColorRow.ts' },
  { id: 'labelColorDialog', file: 'src/client/views/labels/LabelColorDialog.ts' },
  { id: 'labelColorEntry', file: 'src/client/views/labels/LabelColorEntry.ts' },
  { id: 'subworkspaceMark', file: 'src/client/views/SubworkspaceMark.ts' }, // #653 新增：面板头部「当前目录属于工作区 X」那一枚标志（形态由 #650 定稿）
  { id: 'md', file: 'src/client/views/shared/md.ts' },
  { id: 'ticket', file: 'src/client/views/shared/ticket.ts' },
  { id: 'stateKind', file: 'src/client/views/shared/stateKind.ts' }, // #599 新增：票的状态判据（打开/已关闭/已合并）单源，拉取请求页与单票详情页共用一个函数
  { id: 'tagsFit', file: 'src/client/views/shared/tagsFit.ts' },
  // #818 版本管理页签（规格单 #821）：纯文字规则 → 折叠阶梯 → 块模型 → 显隐谓词 → 数据层 → 入口组件。
  //   按依赖次序登记，六项都排在 tabs 之前（Tabs.js 按 vcTabVisible 决定这个页签显不显示）。
  { id: 'vcText', file: 'src/client/views/versionControl/vcText.ts' },
  { id: 'vcFold', file: 'src/client/views/versionControl/vcFold.ts' },
  { id: 'vcDiff', file: 'src/client/views/versionControl/vcDiff.ts' }, // #819 审查后从 vcBlocks 拆出：一处差异该怎么画（那个文件贴着 350 行）
  { id: 'vcCommit', file: 'src/client/views/versionControl/vcCommit.ts' }, // 规格故事 32：「这笔提交改了什么」那一层（排在 vcBlocks 之前，行是 vcBlocks 现传进去的同一份）
  { id: 'vcStyles', file: 'src/client/views/versionControl/vcStyles.ts' }, // #851 版本管理页签的视觉语言（档案索引）：一段 CSS 文本，经同一个 styles.insert 接缝注入
  { id: 'vcRows', file: 'src/client/views/versionControl/vcRows.ts' }, // #842 从 vcBlocks 原样搬出：行分组 / 行画法 / 其他工作树行 / 某路径的差异读数（vcBlocks 要腾行给写操作）
  { id: 'vcWrite', file: 'src/client/views/versionControl/vcWrite.ts' }, // #842 写操作的纯规则层（判定→状态、理由→词条、写失败→话术族、确认框内容）
  { id: 'vcWriteRun', file: 'src/client/views/versionControl/vcWriteRun.ts' }, // #842 写操作的执行层（预检、四条写电话、结果记账、成功后的重读）
  { id: 'vcWriteUi', file: 'src/client/views/versionControl/vcWriteUi.ts' }, // #842 写操作的画法层（按钮、提交区、确认框模型）
  { id: 'vcWriteOps', file: 'src/client/views/versionControl/vcWriteOps.ts' }, // #842 写操作的动作层（点下去发生什么：预检、写电话、重读）
  { id: 'vcWriteView', file: 'src/client/views/versionControl/vcWriteView.ts' }, // #842 写操作的节点画法（从入口组件搬出，组件守住 350 行）
  { id: 'vcDiffOps', file: 'src/client/views/versionControl/vcDiffOps.ts' }, // #857 差异与提交那几路的动作（从入口组件搬出，组件守 350 行）
  { id: 'vcBlocks', file: 'src/client/views/versionControl/vcBlocks.ts' },
  { id: 'vcViews', file: 'src/client/views/versionControl/vcViews.ts' }, // #853 第三步：布局 C 的三个视图（改动 / 提交历史 / 工作树）
  { id: 'vcAiHandoff', file: 'src/client/views/versionControl/vcAiHandoff.ts' }, // #854：「让 AI 帮我解决」交接按钮（prompt 三段式 + 开新会话路由）
  { id: 'vcTabVisible', file: 'src/client/views/versionControl/vcTabVisible.ts' },
  { id: 'vcData', file: 'src/client/views/versionControl/vcData.ts' },
  { id: 'vcCache', file: 'src/client/views/versionControl/vcCache.ts' }, // #864：进出缓存（首屏与历史首批按工作区暂存）
  { id: 'vcInView', file: 'src/client/views/versionControl/vcInView.ts' }, // #997：「还能显示更多」那几处什么时候接着显示（进入视野就接着显示、显示完再判一次；三处共用一套）
  { id: 'versionControlTab', file: 'src/client/views/versionControl/VersionControlTab.ts' },
  { id: 'tabs', file: 'src/client/views/shared/Tabs.ts' },
  { id: 'truthLines', file: 'src/client/views/shared/truthLines.ts' }, // #715 新增：面板头部那几句「上次更新 / 刷新失败 / 现在是不是降级」的判据（纯函数，画在 ListTab 最上面那一行；行上的「更新中」标记也问它）
  { id: 'restFallbackBanner', file: 'src/client/views/shared/RestFallbackBanner.ts' }, // 2026-09-24 由 ListTab.js 拆出：那条降级横幅的「画」这一段（判据仍是上面 truthLines 的 restFallbackView；ListTab 贴着 350 行上限）
  { id: 'workRouteTable', file: 'src/client/views/shared/workRouteTable.ts' }, // #1082 新增：面板「跨会话在办表」（判据与画法；只读快照里的 workRouteTable 字段，与工具回执 data.workRoute 同源）
  { id: 'ticketRow', file: 'src/client/views/TicketRow.ts' },
  { id: 'mapDetailHead', file: 'src/client/views/MapDetailHead.ts' }, // #691 由 MapDetail.js 拆出：编号/标题/「本图 N 张子票」那一行（MapDetail 贴着 350 行上限）
  { id: 'mapDetailTop', file: 'src/client/views/MapDetailTop.ts' }, // #807 由 MapDetail.js 拆出：顶部操作行（不换行/逐字折叠/新会话实心/补图标，MapDetail 贴着 350 行上限）
  { id: 'mapDetail', file: 'src/client/views/MapDetail.ts' },
  { id: 'detailActionBar', file: 'src/client/views/DetailActionBar.ts' }, // #1286 由 MapDetail.ts 拆出：容器详情页底部的三态动作组（探索地图与规格共用，MapDetail 贴着 350 行上限）
  { id: 'mapDetailSpecBody', file: 'src/client/views/MapDetailSpecBody.ts' }, // #1286 由 MapDetail.ts 拆出：规格（实施地图）详情页的正文七段（MapDetail 贴着 350 行上限）
  // #1398 V2 地图详情页：先纯逻辑（票的刻画 / 看板顺序 / 取数状态），再容器档案与两张适配层
  //   （票 → 卡片 props、整页一次算完），最后接线与三块界面。次序即依赖次序，必须都排在页面容器之前。
  //   档案正文不再在这里画：点标题进 issue 详情页看原文（维护者 2026-10-23 定），所以没有抽屉叶子。
  { id: 'mapV2TicketFacts', file: 'src/client/views/mapDetailV2/model/tickets/ticketCardFacts.ts' },
  { id: 'mapV2TicketBoard', file: 'src/client/views/mapDetailV2/model/tickets/ticketBoard.ts' },
  { id: 'mapV2TicketFeed', file: 'src/client/views/mapDetailV2/model/tickets/ticketFeed.ts' },
  { id: 'mapV2Profile', file: 'src/client/views/mapDetailV2/model/container/mapProfile.ts' },
  { id: 'mapV2CardProps', file: 'src/client/views/mapDetailV2/model/assembly/cardPropsOf.ts' },
  { id: 'mapV2PageModel', file: 'src/client/views/mapDetailV2/model/assembly/mapDetailPageModel.ts' },
  { id: 'mapV2Styles', file: 'src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts' }, // 页面外壳样式（卡片皮肤仍由 cardsStyles 那一片提供，深浅两套在卡片自己身上）
  { id: 'mapV2UseFeed', file: 'src/client/views/mapDetailV2/wiring/useMapTicketsFeed.ts' }, // 进页面就拉这张图的全部子票（含已关闭），取数状态由模型翻译成人话
  { id: 'mapV2Actions', file: 'src/client/views/mapDetailV2/wiring/pageActionHandlers.ts' }, // 卡片四个按钮的回调（注入提示词 / 新会话 / 复制链接 / 打开）
  { id: 'mapV2ProfileHeader', file: 'src/client/views/mapDetailV2/view/profile/MapProfileHeader.ts' },
  { id: 'mapV2CardFlow', file: 'src/client/views/mapDetailV2/view/flow/TicketCardFlow.ts' },
  { id: 'mapV2Page', file: 'src/client/views/mapDetailV2/view/MapDetailV2Page.ts' },
  { id: 'IssueDetailComments', file: 'src/client/views/IssueDetailComments.ts' },
  { id: 'issueDetailFold', file: 'src/client/views/issueDetailFold.ts' }, // #763 新增：详情页顶栏逐字折叠阶梯（纯函数，返回优先收到图标）
  { id: 'useIssueDetailFold', file: 'src/client/views/useIssueDetailFold.ts' }, // #763 新增：同一处的折叠机（读写顶栏 DOM；判据在上一项）
        { id: 'subIssueRouting', file: 'src/client/views/subIssueRouting.ts' }, // 子票/阻塞票分流判定，从 IssueDetail.ts 原样抽出
  { id: 'IssueDetail', file: 'src/client/views/IssueDetail.ts' },
  { id: 'noRepoCard', file: 'src/client/views/NoRepoCard.ts' },
  { id: 'setupCard', file: 'src/client/views/SetupCard.ts' }, // #698 新增：盖住整个应用的「域文档布局」小卡（原先只渲染在黄条下面，工作区一初始化就没有地方可画）
  { id: 'ListTabClosed', file: 'src/client/views/ListTabClosed.ts' }, // #690 新增：折叠行展开、滚到底这两个触发点，与「已加载 x / 共 N」那一行（排在 ListTab 之前，ListTab 调它们）
  { id: 'ListTabRow', file: 'src/client/views/ListTabRow.ts' },
  // 本次界面反馈需求：列表页三组筛选药丸那一行（含三块液态墨块）从 ListTab 抽出，ListTab 贴着 350 行上限。
  { id: 'listFilterRow', file: 'src/client/views/listFilterRow.ts' },
  { id: 'listTab', file: 'src/client/views/ListTab.ts' },
  { id: 'prTab', file: 'src/client/views/PrTab.ts' },
  { id: 'skillsTab', file: 'src/client/views/SkillsTab.ts' },
  // 887 技能详情像素风：皮肤、中组件与整页（PixelMarkdown 无横向 import，只调全局 emit/tr）
  { id: 'pixelStyles', file: 'src/client/views/skillDetail/PixelStyles.ts' },
  { id: 'feedbackStyles', file: 'src/client/views/feedback/feedback-styles.ts' }, // 948 交互反馈三批的视觉语言（样式叶子：一段 CSS 文本，经同一个 styles.insert 接缝注入；styles.js 已贴 350 行上限，照 #851 做法另起叶子）
  { id: 'pixelContents', file: 'src/client/views/skillDetail/PixelContents.ts' },
  { id: 'pixelMarkdown', file: 'src/client/views/skillDetail/PixelMarkdown.ts' },
  { id: 'pixelSkillRow', file: 'src/client/views/skillDetail/PixelSkillRow.ts' },
  { id: 'pixelSkillList', file: 'src/client/views/skillDetail/PixelSkillList.ts' },
  { id: 'pixelSkillDetailModal', file: 'src/client/views/skillDetail/PixelSkillDetailModal.ts' },
  { id: 'pixelSkillOps', file: 'src/client/views/skillDetail/PixelSkillOps.ts' }, // 888：详情取数（开合、阶段、缓存、重试），依赖宿主电话 skill.readDoc
  { id: 'checksTab', file: 'src/client/views/ChecksTab.ts' },
  { id: 'SettingsWorkspaces', file: 'src/client/views/SettingsWorkspaces.ts' },
  { id: 'diagnosticLogModel', file: 'src/client/views/diagnosticLog/diagnosticLogModel.ts' }, // 诊断日志的纯推演层：失败翻译、日期、开关选句（#597 那张表由此搬入，DebugSwitchFailHint.js 删档）
  { id: 'diagnosticLogActions', file: 'src/client/views/diagnosticLog/diagnosticLogActions.ts' }, // 诊断日志的不纯跑腿层：五个动作调宿主弹提示，世界全从参数进（原来设置页 toggleDbg 与 do 开头那一串）
  { id: 'diagnosticLogSection', file: 'src/client/views/diagnosticLog/DiagnosticLogSection.ts' }, // 诊断日志分组画法：抱住五个 useState，接好世界，画原来沉底那一组（原来设置页 194-220 行）
  { id: 'updateEntryHost', file: 'src/client/views/UpdateEntryHost.ts' }, // #876 更新入口挂载点：只挂包的入口件（含内部 dialog 面板），本仓不再自带按钮状态机与浮层弹窗
  { id: 'settingsPage', file: 'src/client/views/SettingsPage.ts' }, // 真源是同名 .ts（调试分组搬走后转成 TS）：拼接缝自己转译，登记真源这一支（与 SkillsTab 同例）
  { id: 'runPanel', file: 'src/client/views/RunPanel.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'DockSync', file: 'src/client/panel/DockSync.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'headFold', file: 'src/client/panel/headFold.ts' }, // #667 新增：面板头部第一行的逐字折叠阶梯（纯函数，无组件）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'repoChipSkeleton', file: 'src/client/panel/RepoChipSkeleton.ts' }, // 2026-09-24 由 Dock.js 拆出：快照还没回来时那条灰色占位骨架（组件，Dock 贴着 350 行上限）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'dock', file: 'src/client/panel/Dock.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'namingFailBanner', file: 'src/client/panel/NamingFailBanner.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'OverlayGate', file: 'src/client/panel/OverlayGate.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'seg', file: 'src/client/statusbar/Seg.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'checksums', file: 'src/client/statusbar/checksums.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'StatusMenus', file: 'src/client/statusbar/StatusMenus.ts' },
  // #1209：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 从此是 pixel-ts 那一步的产物，不再入库）。
  { id: 'StatusBackend', file: 'src/client/statusbar/StatusBackend.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'capFold', file: 'src/client/statusbar/capFold.ts' }, // #725 新增：状态栏胶囊那条横条的逐字折叠阶梯（纯函数，无组件）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'capFoldMachine', file: 'src/client/statusbar/capFoldMachine.ts' }, // #725 新增：同一处的阶梯机（读写胶囊那一段 DOM；判据在上一项，接线在 statusBar）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'bannerChain', file: 'src/client/statusbar/bannerChain.ts' }, // #663 新增：状态栏那条横幅按引导链清单决定出哪一条、那颗按钮点了做什么
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'logDangerConfirm', file: 'src/client/statusbar/LogDangerConfirm.ts' }, // #954 高危险动作的就近确认框与留痕横幅（从 StatusLogMenu 搬出，那份叶子贴 350 行粒度红线）
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'StatusLogMenu', file: 'src/client/statusbar/StatusLogMenu.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  // #1409：界面借会话事件流取数通路的两个叶子。纯函数那片先拼（订阅层要调用它导出的识别与解析），
  //   订阅层那片再拼（状态栏要挂它导出的 SuggestStreamMount）。顺序反了闭包里会拿到未定义的自由变量。
  { id: 'suggestFacts', file: 'src/client/statusbar/suggestFacts.ts' },
  { id: 'suggestStream', file: 'src/client/statusbar/suggestStream.ts' },
  { id: 'suggestTimeline', file: 'src/client/statusbar/suggestTimeline.ts' },
  { id: 'suggestEngine', file: 'src/client/statusbar/suggestEngine.ts' },
  // #1411：状态胶囊上方的下一步建议气泡。外观旋钮（含层级常量）先求值，样式叶子读它拼 CSS；
  //   渲染薄壳在订阅层之前（订阅层拿到建议直接调它）。index.ts 的标记次序保证了这个依赖顺序。
  { id: 'suggestAppearance', file: 'src/client/statusbar/suggestAppearance.ts' },
  { id: 'suggestStyles', file: 'src/client/statusbar/suggestStyles.ts' },
  { id: 'suggestBubble', file: 'src/client/statusbar/suggestBubble.ts' },
  { id: 'statusBar', file: 'src/client/statusbar/StatusBar.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'sessionChainCapsule', file: 'src/client/statusbar/SessionChainCapsule.ts' }, // 胶囊里「这个会话在办哪张票」那一段（只读快照 workRouteTable 里当前会话那几行，不进折叠阶梯）
  { id: 'chainRenderer', file: 'src/client/views/shared/ChainRenderer.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'skillFloatList', file: 'src/client/floating/SkillFloatList.ts' },
  // #1251：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'pop', file: 'src/client/floating/Pop.ts' },
  // #1254：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'hostShim', file: 'src/client/hostShim.ts' }, // #459 由 index.js 拆出：宿主适配垫片（timer 兜底加旧标签迁移）
  // #1254：这一片由手写 .js 转成 .ts，这里改指新真源（读源由 readSpliceFragmentSource 按扩展名分派，
  //   它会把 .ts 转译成可拼接的 JavaScript；同名 .js 已删，不再入库）。
  { id: 'panelAssembly', file: 'src/client/panelAssembly.ts' }, // #459 由 index.js 拆出：面板装配（Ctx 装配加插槽注册加启动收尾）
]
/**
 * 把登记过的片段拼进闭包（#1207）。
 *
 * 三个拼接点（kernel / leaf / shared 各一处）都走同一个入口，不各写一份读取逻辑：
 * 片段读取与「行首 export 去掉、首尾空白去掉」那条判据收在 scripts/lib/transpile-domains.mts 的
 * readSpliceFragmentSource 与 scripts/lib/transpile-unit.mts 的 toSpliceableFragment 里。
 *
 * 一条片段既可以是手写的 .js，也可以是从 .ts 转译来的（.ts 片段先在那一处按全仓唯一那份转译口径
 * 变成 JavaScript 再拼）；转完仍留着模块级 import/export 的，那边会当场指名报错。
 */
/**
 * 取一条要拼进闭包的片段文本，并保证它以一个换行收尾（#1209）。
 *
 * 为什么要在这里补这一下：`toSpliceableFragment` 会把片段首尾空白一起 trim 掉，而 src/client/index.ts（#1254 前叫 index.js）
 * 里有一批标记是**同一行上连着写**的（例如 `// ==== leaf:StatusMenus ==== // ==== leaf:StatusBackend ==== //…`，见 index.js:275 那一行）。
 * 片段末尾不带换行时，前一条片段的收尾 `}` 会与后一条片段开头的 `const` 拼成 `} const X = …`——
 * 而前一条片段最后往往是一行 `//` 注释，那一拼就把后一条片段的头一行整行吃进注释里。
 * 实测（#1209 转 StatusBackend 时）：拼出来的闭包在 precheck 处报 `Unexpected token 'const'`，
 * 报错行是 `} const SETUP_LAYOUT_VALUES = ["single", "multi"];`，而真因在上一行那条注释。
 *
 * 统一补在取片段这一个入口上，三个拼接点（kernel / leaf / shared）都受益；判据只认「末尾是不是换行」，
 * 不改成别的空白形态，免得同一个标记位置在不同片段下拼出不一样的字节。
 */
function spliceText(file: string): string {
  const text: string = readSpliceFragmentSource(file)
  return /\n$/.test(text) ? text : text + '\n'
}

function wireModules(body: string): string {
  let out: string = body
  for (const m of KERNEL_MODULES) {
    const marker: string = `// ==== kernel:${m.name} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.ts 加标记并在 KERNEL_MODULES 注册`)
    out = out.replace(marker, () => spliceText(m.file))
  }
  for (const m of LEAF_MODULES) {
    const marker: string = `// ==== leaf:${m.id} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.ts 加标记并在 LEAF_MODULES 注册`)
    out = out.replace(marker, () => spliceText(m.file))
  }
  for (const m of SHARED_SPLICE) {
    const marker: string = m.marker
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.ts 加标记并在 SHARED_SPLICE 注册`)
    out = out.replace(marker, () => spliceText(m.file))
  }
  auditLeafRegistration()
  return out
}

// 反向检查：src 下有叶子文件却未在 LEAF_MODULES 登记（比“忘贴纸条”更隐蔽）。
// wireModules（.js 老路）与 maskSpliceMarkers（.ts 占位路）共用这一份，免得两条路各埋一份、改一处漏一处。
function auditLeafRegistration(): void {
  try {
    const leafFiles: string[] = []
    const walk = (dir: string): void => {
      const abs: string = resolve(ROOT, dir)
      if (!existsSync(abs)) return
      for (const ent of readdirSync(abs, { withFileTypes: true })) {
        const rel: string = dir + '/' + ent.name
        const absEnt: string = resolve(ROOT, rel)
        if (ent.isDirectory()) walk(rel)
        else if (ent.isFile() && isLeafSourcePath(ROOT, rel)) leafFiles.push(rel)
      }
    }
    walk('src/client/views'); walk('src/client/panel'); walk('src/client/statusbar'); walk('src/client/floating')
    const registered: Set<string> = new Set(LEAF_MODULES.map(m => m.file))
    for (const f of leafFiles) {
      if (!registered.has(f)) throw new Error(`[build] ${f} 未在 LEAF_MODULES 登记 — 新加叶子需在 LEAF_MODULES 加一项并在 src/client/index.ts 加 // ==== leaf:<id> ==== 标记`)
    }
  } catch (e) {
    if ((e as Error) && (e as Error).message && (e as Error).message.startsWith('[build]')) throw e
  }
}

// #1254：拼接标记的占位语句。标记本身是注释，转译会被吞；占位是一次具名调用
//   `__build_splice__("…");`——调用有潜在副作用，转译不会删也不会改写，字符串字面一字不动，
//   转译完再按占位换回片段（占位从不进产物：换不回去就报错）。占位只出现在 apply 闭包函数体内
//   （标记也只在那里），不会落进对象字面量，所以语法恒合法；片段里不会出现 __build_splice__ 前缀，不会误换。
function splicePlaceholder(kind: string, key: string): string {
  return `__build_splice__("__SPLICE__:${kind}:${key}");`
}
// 骨架里的拼接标记逐个换成占位（缺标记报错，语义与 wireModules 一致），记下占位与片段文件的对应。
function maskSpliceMarkers(body: string): { masked: string; slots: { ph: string; file: string }[] } {
  let out: string = body
  const slots: { ph: string; file: string }[] = []
  const mask = (marker: string, kind: string, key: string, file: string): void => {
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${file} — 请在 src/client/index.ts 加标记并在清单注册`)
    const ph: string = splicePlaceholder(kind, key)
    slots.push({ ph, file })
    out = out.replace(marker, () => ph)
  }
  for (const m of KERNEL_MODULES) mask(`// ==== kernel:${m.name} (spliced by build) ====`, 'kernel', m.name, m.file)
  for (const m of LEAF_MODULES) mask(`// ==== leaf:${m.id} (spliced by build) ====`, 'leaf', m.id, m.file)
  for (const m of SHARED_SPLICE) mask(m.marker, 'shared', m.marker, m.file)
  auditLeafRegistration()
  return { masked: out, slots }
}
// 转译完的骨架里按占位换回片段（占位被转译吞掉就报错：占位写法与转译口径需同改）。
function wirePlaceholders(body: string, slots: { ph: string; file: string }[]): string {
  let out: string = body
  for (const s of slots) {
    if (out.indexOf(s.ph) < 0) throw new Error(`[build] 转译吞了拼接占位 ${s.ph} 对应 ${s.file} — 占位写法与转译口径需同改`)
    out = out.replace(s.ph, () => spliceText(s.file))
  }
  return out
}

/**
 * 「这个文件算不算一份要拼进闭包的叶子源码」这条判据已经搬进 scripts/lib/transpile-domains.mts 的
 * isLeafSourcePath（#1207 对抗式审查指出：它住在 build.mjs 里时，门禁只能拿正则看它有没有写，
 * 把实现掏空成 `return false` 也全绿）。搬过去之后它接一个显式的根目录参数，门禁能在临时目录里
 * 把 .js / 没有同名 .js 的 TypeScript / 有同名 .js 的 TypeScript / .d.ts 四种情形都真跑一遍。
 */

// ---------- 构建 client ----------
async function buildClient({ version, repoUrl }: { version: string; repoUrl: string }): Promise<{ devCode: string; pkgCode: string }> {
  // #1254（修：构建先行兼容）：客户端入口真源可能是手写 .js（转制前）或 .ts（转制后）。
  //   .ts 先抽取（头与体分离），骨架经占位、转译、复原、再抽取后按占位接回片段（见下）；
  //   .js 路径仍在时走老路。转制提交只换真源扩展名，构建不用再动。
  const clientTsRel: string = 'src/client/index.ts'
  const clientJsRel: string = 'src/client/index.js'
  const useClientTs: boolean = existsSync(resolve(ROOT, clientTsRel))
  const clientSrcRel: string = useClientTs ? clientTsRel : clientJsRel
  // #1254（修：骨架先转译、占位后接线）：入口里的 `// ==== kernel/leaf:<名> (spliced by build) ====`
  //   标记是注释，转译会整段吞掉；但“拼完整个闭包再转译”会让 esbuild 把派生日志核 tail 的重导出
  //   （const logSwitch = __pkgLog.logSwitch…）与包体内同名声明当成同域重复声明，顺手改名（…2 后缀
  //   进产物，门禁锚点与可读性都受损）。所以分两步：标记先换成占位语句（字符串字面过转译一字不动），
  //   骨架转译完再把占位换成片段（片段各走各的单文件转译，不进同一编译单元，不存在跨片段改名）。
  //   .js 老路不变：原文抽取拼接，不转译。
  const extracted: { header: string; body: string } = extractPluginBody(clientSrcRel, read(clientSrcRel))
  // #1254：.ts 真源头部的 `declare const …` 行只给 tsc 看（闭包自由变量的形状声明），
  //   转译会整句删掉；头部不经过转译，所以去 declare 行这一步只能手做——
  //   只删整行 declare（转译删的也是整句），注释原样保留，产物头部与 .js 时代一致。
  const header: string = useClientTs
    ? extracted.header.split('\n').filter((l: string) => !/^\s*declare\s/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n')
    : extracted.header
  // ctx 接线与版本注入只做纯文本替换，不认拼接标记，先做；转译只吃骨架，片段随后。
  const wired: string = wireCtx(injectVersion(extracted.body, version, repoUrl))
  // #1254：转译骨架时外面必须包着 `export default `——裸的 `{ apply(ctx) {…} }` 会被当成语句块，
  //   转译完复原降级、再抽一次体，最后按占位接回片段。
  const bodyW: string = useClientTs
    ? (() => {
        const masked = maskSpliceMarkers(wired)
        const transpiled: string = restoreLoweredDefault(transpileClientText('export default ' + masked.masked))
        const re: { header: string; body: string } = extractPluginBody(clientSrcRel + '（转译后）', transpiled)
        return wirePlaceholders(re.body, masked.slots)
      })()
    : wireModules(wired)
  // 根产物降级声明（G1 · T5 #98）：client.js/host.js 为构建产物，人手不碰
  const devBanner: string = `// AUTO-GENERATED by scripts/build.mts — DO NOT EDIT. Source: ${clientSrcRel} + kernel/* + leaves/* (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mts 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态 ----
  const devCode: string = `${devBanner}${header}\n\nreturn ${bodyW}\n`
  gatePrecheck(devCode, 'client-dev')
  write('client.js', devCode)

  // ---- _pkg：ModuleLoader 工厂壳 + seam shims ----
  const pkgCode: string = `${header}

window.__ModuleLoader__.load({
  id: 'dsh-mattpocock-skills-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${PKG_CLIENT_SHIMS}
    const __plugin = ${bodyW}
    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']
    exports.apply = function (ctx) { __DSW_CTX__ = ctx; return __plugin.apply(ctx) }
    return module.exports
  }
})
`
  await gateSyntax(pkgCode, 'client-pkg')
  gateModuleLoader(pkgCode, 'client-pkg')
  gateSingleDeclaration(pkgCode, 'client-pkg', ['StatusBar', 'DetailsDock', 'SettingsPage', 'RunPanel', 'IssueDetail'])
  write('package/lib/client.js', pkgCode)
  return { devCode, pkgCode }
}

// ---------- 搬家跟随（#1018）：新树的转译与投放 ----------
//
// 为什么需要这一段：#1019 把一百多份模块搬进了新树（src/deck、src/tracker 全是 TypeScript，
// src/host 里也多了 16 份 TypeScript），而构建还停在搬家之前——拼接登记指着旧路径（上面
// SHARED_SPLICE 第一项），宿主复制整树照搬（含 TypeScript 源码），发布清单指着旧文件。
// 这一段把三件事补上，源码一律不动（#1018 的边界：只动发布脚本与清单）：
//
// 一、词汇表拼接输入：常量（canonical-labels.ts、vocabulary.ts，仍住契约目录）与已搬出的
//   三份行为（identity-keys.ts、label-names.ts、fix-contract.ts）共五份真源，导出名与旧闭包
//   逐个相同、合起来零依赖。构建把五份拼成一段再转译，产物写到契约目录的 vocabulary.js
//   （机器生成头、不入库，忽略规则见根 .gitignore），SHARED_SPLICE 拼这一份。转译与四个
//   计算域同口径（同一份转译参数，行首导出改写也调同一份实现），拼进闭包的形态与别家一致。
//
// 二、新树投放：package/ 按 src/ 的相对位置镜像（package/lib 对 src/host、package/deck
//   对 src/deck、package/tracker 对 src/tracker、package/refresh 对 src/refresh（#1425 起）；
//   package/shared 对 src/shared 早就是这样），
//   这样源码里以 .js 结尾的相对引用在包里原样成立，不用改源码。TypeScript 逐文件转译成
//   JavaScript（只剥类型、不打包，引用原样保留），手写 JavaScript 直接复制。
//   发布包的目录与入口登记见 package/package.json（files 加 deck、tracker 两项，
//   exports 里 "./tools" 指到新位置）。
//
// 三、宿主引用改写：新树里有 6 处引用指回宿主树（src/tracker/index.ts 两处、
//   src/tracker/rooms/github/client.ts 三处、src/tracker/detection/detectionService.ts 一处），
//   在源码里它们写作 ../host/...，在包里宿主住在 package/lib，必须改写成 ../lib/...。
//   改写只动转译产物的引用串，不动源码；改写逐条记日志，审计步骤逐条核对去向文件在不在盘上。
//
// 产物字节形态与四个计算域有一处不同：这里不做行首导出改写。原因是新树里有再导出
// （export { 名字 } from），转译器把它们收成“文件头 import＋文件尾导出块”，
// 改写函数只认“块里每个名字都能在同一份文件找到声明”这种情形，再导出的名字声明在别的文件，
// 强行改写会抛错。而包内模块由 Node 直接加载，文件尾导出块是合法写法，不需要改。
// 词汇表那一份要拼进闭包，所以它仍做改写（它没有再导出，形态与计算域产物一样）。
//
// 类型检查不在这里做：新树（src/tracker/ 与 src/deck/ 两片）还没有自己的 tsconfig，而类型检查按
// 「每个域一份配置、一个文件只属于一个域」这条路走——deck 域那份的票是 #1107，跟踪器域那份今天
// 还没有票；在它落地之前，这里只保证“转得过去、投得下去、引用落得到”。转译失败当场抛错，不静默跳过。
// 归属的现状可以直接看：`node --import ./scripts/ts-hook.mts tests/verify-typecheck.mts` 会逐条列出
// 「不在任何配置的检查范围内」的源码文件，两片新树都在名单里——2026-10-14 在干净检出上实测：该门禁
// 报「不通过 122 条」，其中 108 条是这类缺口（在带未提交改动的工作树里量会偏大，别在主工作树里量）。
const MOVED_TREE_MAP: { src: string; pkg: string }[] = [
  { src: 'src/host', pkg: 'package/lib' },
  { src: 'src/deck', pkg: 'package/deck' },
  { src: 'src/tracker', pkg: 'package/tracker' },
  // #1425 起刷新机制的新家也按镜像进包：src/refresh/** → package/refresh/**。
  // 镜像成立的依据是两边深度永远相等（都只换一节前缀），源码里的相对引用在包里原样成立；
  // 唯一跨出树的两档（../contract/ 与 ../../shared/time-config/）在包里落在同样位置，
  // rewriteMovedSpecifiers 不用加分支，直通即可（摊平的那一档只有 src/shared/<域>/src/ 形状，
  // 刷新文件里没有这一档）。
  { src: 'src/refresh', pkg: 'package/refresh' },
]

/** 源码相对路径推包内相对路径：换树前缀、后缀 .ts 换 .js，别的都不动。 */
function pkgPathForSrc(srcRel: string): string {
  const rel: string = srcRel.replace(/\\/g, '/')
  for (const m of MOVED_TREE_MAP) {
    if (rel === m.src || rel.startsWith(m.src + '/')) {
      return m.pkg + rel.slice(m.src.length).replace(/\.ts$/, '.js')
    }
  }
  throw new Error(`[moved-trees] 认不出这份文件属于哪棵新树：「${srcRel}」（只收 src/host、src/deck、src/tracker、src/refresh 四棵）`)
}

/** 扫出四棵新树里的 TypeScript 真源（不含纯类型声明），次序固定，日志可比对。 */
function collectMovedTs(): string[] {
  const out: string[] = []
  for (const m of MOVED_TREE_MAP) {
    const abs: string = resolve(ROOT, m.src)
    if (!existsSync(abs)) continue
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p: string = join(d, ent.name)
        if (ent.isDirectory()) { walk(p); continue }
        if (!ent.name.endsWith('.ts') || ent.name.endsWith('.d.ts')) continue
        out.push(relative(ROOT, p).replace(/\\/g, '/'))
      }
    }
    walk(abs)
  }
  return out.sort()
}

/**
 * 把一份 TypeScript 转成包内 JavaScript 文本。转译参数与计算域、客户端像素段是同一份，
 * 改一处三条流水线一起变。forSplice 给拼闭包的那一份用（行首导出改写），
 * 包内运行的那一份不用（再导出的名字声明在别的文件，改写会抛错，理由见上面那段注释）。
 */
/** 客户端入口拼接体转文本：拼完的闭包体（已无拼接标记）整体转成 JavaScript。
 * 口径与 transpileMovedTs 同一份 TRANSPILE_OPTIONS，只是不读盘、不加产物头——
 * 产物头（generatedHeader）是给落盘文件标来源的，拼进闭包的半截文本不需要。 */
function transpileClientText(src: string): string {
  const require = createRequire(resolve(ROOT, 'package.json'))
  let esbuild: any
  try { esbuild = require('esbuild') }
  catch (e) { throw new Error('[build] 没装 esbuild（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  let code: string
  try { code = esbuild.transformSync(src, TRANSPILE_OPTIONS).code }
  catch (e) { throw new Error('[build] 客户端入口转译失败：' + ((e as Error) && (e as Error).message || e)) }
  return code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
}
function transpileMovedTs(srcRel: string, { forSplice = false }: { forSplice?: boolean } = {}): string {
  const require = createRequire(resolve(ROOT, 'package.json'))
  let esbuild: any
  try { esbuild = require('esbuild') }
  catch (e) { throw new Error('[moved-trees] 没装 esbuild（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  const source: string = readFileSync(resolve(ROOT, srcRel), 'utf8')
  let code: string
  try { code = esbuild.transformSync(source, TRANSPILE_OPTIONS).code }
  catch (e) { throw new Error(`[moved-trees] 转译失败 ${srcRel}：` + ((e as Error) && (e as Error).message || e)) }
  const normalized: string = code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
  if (!forSplice) return generatedHeader(srcRel) + normalized
  return generatedHeader(srcRel) + inlineExportDeclarations(normalized, '[moved-trees]')
}

/** 词汇表拼接输入就位：五份真源拼成一段再转译，产物写到真源旁边（并排、不入库），拼接拼这一份。 */
function buildVocabularySpliceInput(): void {
  // 五份的次序即依赖次序：名单派生读数组常量，所以数组常量必须在前；其余四份互相零依赖。
  const parts: string[] = [
    'src/tracker/contract/canonical-labels.ts',
    'src/tracker/contract/vocabulary.ts',
    // #1159：票身份那份搬进了 kernel/，拼接清单跟着改；拼接的次序与内容不变。
    'src/tracker/kernel/identity-keys.ts',
    'src/tracker/label-names.ts',
    'src/tracker/fix-contract.ts',
  ]
  // label-names.ts 在 Node 侧用相对引用读数组常量；拼成一段后同处一个作用域，这句引用
  // 必须去掉（esbuild 只剥类型、不解引用，留着它闭包里会多一句指到不存在模块的 import）。
  // 逐字匹配、找不到当场抛错：改了引用写法的人必须同时改这里，不许静默拼错。
  const labelNamesImport: string = `import { CANONICAL_LABELS } from './contract/canonical-labels.js'`
  const combined: string = parts.map((srcRel) => {
    let text: string = readFileSync(resolve(ROOT, srcRel), 'utf8')
    if (srcRel.endsWith('/label-names.ts')) {
      if (!text.includes(labelNamesImport)) {
        throw new Error(`[moved-trees] ${srcRel} 里找不到预期的引用句，拼接输入拒绝生成：${labelNamesImport}`)
      }
      text = text.replace(labelNamesImport, '// （拼接输入：CANONICAL_LABELS 与本段同作用域，引用句已去掉）')
    }
    return `// ---- splice part: ${srcRel} ----\n` + text
  }).join('\n')
  const require = createRequire(resolve(ROOT, 'package.json'))
  let esbuild: any
  try { esbuild = require('esbuild') }
  catch (e) { throw new Error('[moved-trees] 没装 esbuild（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  let code: string
  try { code = esbuild.transformSync(combined, { ...TRANSPILE_OPTIONS, loader: 'ts' }).code }
  catch (e) { throw new Error('[moved-trees] 词汇表五份拼段转译失败：' + ((e as Error) && (e as Error).message || e)) }
  const normalized: string = code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
  // 落到 .tmp 而不是真源旁边：这份拼段只是「拼进客户端闭包」的中间输入，不是任何人的运行时模块，
  // 放在 src/ 里会让源码树混进构建产物（src 只留 .ts 的手写代码）。.tmp 是构建自己的临时目录，不入库。
  const outRel: string = '.tmp/vocabulary.client.js'
  mkdirSync(resolve(ROOT, '.tmp'), { recursive: true })
  writeFileSync(resolve(ROOT, outRel), generatedHeader('vocabulary splice: ' + parts.join(' + ')) + inlineExportDeclarations(normalized, '[moved-trees]'), 'utf8')
  console.log(`[moved-trees] 词汇表五份拼段 -> ${outRel}（拼接输入就位）`)
}

/** 按段拼相对路径（源码引用串的算术，不读盘）。 */
function resolveRelPosix(baseDir: string, spec: string): string {
  const parts = baseDir.split('/').filter((p) => p.length > 0)
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue
    else if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 从包内目录看目标文件的相对路径（改写后的引用串）。 */
function relativePosix(fromDir: string, toFile: string): string {
  const a = fromDir.split('/').filter((p) => p.length > 0)
  const b = toFile.split('/').filter((p) => p.length > 0)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const rel: string = [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
  return rel.startsWith('.') ? rel : './' + rel
}

const MOVED_SPEC_RE: RegExp = /\bfrom\s*(['"])(\.[^'"]*)\1|import\s*\(\s*(['"])(\.[^'"]*)\3\s*\)/g

/**
 * 把转译产物里指向宿主树的引用串改到包内位置。只认“解出来落在 src/host/ 下”
 * 的相对引用，别的原样保留。返回改写后的文本与改写清单（清单记日志备查）。
 */
function rewriteMovedSpecifiers(code: string, srcRel: string, outRel: string): { code: string; rewrites: string[] } {
  const srcDir = srcRel.slice(0, srcRel.lastIndexOf('/'))
  const outDir = outRel.slice(0, outRel.lastIndexOf('/'))
  const rewrites: string[] = []
  const next: string = code.replace(MOVED_SPEC_RE, (whole, q1, spec1, q2, spec2) => {
    const spec: string = spec1 !== undefined ? spec1 : spec2
    const resolved: string = resolveRelPosix(srcDir, spec)
    // 共享层的域真源在包里被摊平一层：源码写 `../shared/<域>/src/<名>.js`，
    // 包内产物是 `package/shared/<域>/<名>.js`。这一档先换，再走宿主树的改写。
    const domainTruth = /^src\/shared\/([^/]+)\/src\/(.+)$/.exec(resolved)
    if (domainTruth) {
      const fixed: string = relativePosix(outDir, 'package/shared/' + domainTruth[1] + '/' + domainTruth[2])
      rewrites.push(`${spec} -> ${fixed}`)
      return whole.replace(spec, fixed)
    }
    if (!resolved.startsWith('src/host/')) return whole
    const fixed: string = relativePosix(outDir, 'package/lib/' + resolved.slice('src/host/'.length))
    // 宿主树内部的引用在镜像后串不变（例如 package/lib 内 ./refresh/x.js 仍是 ./refresh/x.js），
    // 不记、不换，只改写真正换了位置的那几条（tracker、deck 里指回宿主的）。
    if (fixed === spec) return whole
    rewrites.push(`${spec} -> ${fixed}`)
    return whole.replace(spec, fixed)
  })
  return { code: next, rewrites }
}

/**
 * 递归复制手写 JavaScript。同目录有同名 TypeScript 的那份跳过——它是并排的转译产物，
 * 归转译步骤写目标，这里再抄会把“谁写产物”变成两处（今天只有词汇表那一份）。
 */
function copyJsTree(srcAbs: string, dstAbs: string): number {
  let copied: number = 0
  const copyOpts = { recursive: true, force: true }
  const walk = (s: string, d: string): void => {
    mkdirSync(d, { recursive: true })
    for (const ent of readdirSync(s, { withFileTypes: true })) {
      const ps: string = join(s, ent.name)
      const pd: string = join(d, ent.name)
      if (ent.isDirectory()) { walk(ps, pd); continue }
      if (!ent.name.endsWith('.js')) continue
      if (existsSync(join(s, ent.name.slice(0, -'.js'.length) + '.ts'))) continue
      cpSync(ps, pd, copyOpts)
      copied++
    }
  }
  if (existsSync(srcAbs)) walk(srcAbs, dstAbs)
  return copied
}

/**
 * 包内引用审计：lib、deck、tracker、refresh 四处产物里的相对引用，条条都要在包内落到实文件。
 * 转译漏写、复制漏抄、源码引用了不存在的文件，都会在这里当场红，而不是等用户装机后失败。
 *
 * 只看真正的引用语句：先去掉块注释（JSDoc 里的 import() 类型注解不是引用，
 * 例如客户端闭包里写给人看的 import('../../shared/...')），再跳过整行注释。
 * 尾随在语句后面的行尾注释不影响（引用串在注释前面，照常扫到）。
 */
function auditPackageSpecifiers(dirs: string[]): void {
  const missing: string[] = []
  for (const dir of dirs) {
    const abs: string = resolve(ROOT, dir)
    if (!existsSync(abs)) continue
    const files: string[] = []
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p: string = join(d, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (p.endsWith('.js')) files.push(p)
      }
    }
    walk(abs)
    for (const f of files) {
      const rel: string = relative(ROOT, f).replace(/\\/g, '/')
      const relDir: string = rel.slice(0, rel.lastIndexOf('/'))
      const text: string = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line: any) => !/^\s*\/\//.test(line))
        .join('\n')
      for (const m of text.matchAll(MOVED_SPEC_RE)) {
        const spec: string = m[2] !== undefined ? m[2] : m[4]
        const target: string = resolveRelPosix(relDir, spec)
        const candidates: string[] = target.endsWith('.js') ? [target] : [target, target + '.js']
        const hit: boolean = candidates.some((c) => {
          try { return statSync(resolve(ROOT, c)).isFile() } catch { return false }
        })
        if (!hit) missing.push(`${rel} -> ${spec}`)
      }
    }
  }
  const uniq: string[] = [...new Set(missing)]
  if (uniq.length > 0) {
    throw new Error('[moved-trees] 包内相对引用有落空（转译或复制漏了文件）：\n  - ' + uniq.slice(0, 20).join('\n  - ') + (uniq.length > 20 ? `\n  - ……共 ${uniq.length} 条` : ''))
  }
  console.log(`[moved-trees] 包内引用审计通过（${dirs.join('、')}）`)
}

/** 新树投放：四棵树的 .ts 转译进包、手写 .js 复制进包，最后审计引用。幂等，可重跑。 */
function deployMovedTrees(): void {
  const sources = collectMovedTs()
  let rewrote: number = 0
  for (const srcRel of sources) {
    const outRel: string = pkgPathForSrc(srcRel)
    const { code, rewrites }: { code: string; rewrites: string[] } = rewriteMovedSpecifiers(transpileMovedTs(srcRel), srcRel, outRel)
    mkdirSync(dirname(resolve(ROOT, outRel)), { recursive: true })
    writeFileSync(resolve(ROOT, outRel), code, 'utf8')
    for (const r of rewrites) console.log(`[moved-trees] 改写 ${srcRel}：${r}`)
    rewrote += rewrites.length
  }
  // gitlab 房已无手写 .js（2026-10-14 #1147 转完 13+1 个文件，全部 .ts 化；copyJsTree 遇到同名 .ts 会自动跳过 .js，这里只抄还剩 .js 的文件）。词汇表并排产物不归这里抄（见 copyJsTree）。
  const copiedJs = copyJsTree(resolve(ROOT, 'src/tracker'), resolve(ROOT, 'package/tracker'))
  console.log(`[moved-trees] 转译 ${sources.length} 份 TypeScript 进包（改写宿主引用 ${rewrote} 处），复制手写 JavaScript ${copiedJs} 份`)
  auditPackageSpecifiers(['package/lib', 'package/deck', 'package/tracker', 'package/refresh'])
}

/** 散文件投放（#1256）：src/shared 下不属于域源码（`<域>/src/`）的 .ts 转译进 package/shared。
 *
 * 为什么单独一段：collectMovedTs 只扫 src/host、src/deck、src/tracker、src/refresh 四棵新树，域产物的包内镜像
 * （deployDomainProducts）只收每个域 `src/` 下的源码，两处都够不着这里的散文件——不补这一段，
 * package/shared 里就没有它们，包内相对引用审计（tests/verify-build-artifacts.ts 4f）当场红。
 * 口径与 src/shared/tsconfig.json 的 include 一致：根上 *.ts、每个子目录根上的 *.ts
 * （子目录是域目录时，`<域>/src/` 下的源码归 buildDomain 管，这里只收域根上的散文件，
 * 例如 version-control/exec-envelope.ts：它住在域目录里但不是域源码）。
 * 转译口径与新树投放同一份（transpileMovedTs：只剥类型、不改写导出块），包内由 Node 直接加载。
 */
function deployLooseShared(): void {
  const sharedAbs: string = resolve(ROOT, 'src/shared')
  if (!existsSync(sharedAbs)) return
  const rels = []
  for (const ent of readdirSync(sharedAbs, { withFileTypes: true })) {
    if (ent.isFile()) {
      if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) rels.push('src/shared/' + ent.name)
    } else if (ent.isDirectory()) {
      // 子目录根上的 .ts 一律算散文件：没有 tsconfig 的子目录（tracker/、ui/）全是散文件；
      // 有 tsconfig 的域目录只收根上这一层，`src/` 下的域源码归 buildDomain。
      for (const f of readdirSync(join(sharedAbs, ent.name), { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.d.ts')) {
          rels.push('src/shared/' + ent.name + '/' + f.name)
        }
      }
    }
  }
  rels.sort()
  for (const srcRel of rels) {
    const outRel: string = 'package/shared/' + srcRel.slice('src/shared/'.length).replace(/\.ts$/, '.js')
    const code = transpileMovedTs(srcRel)
    mkdirSync(dirname(resolve(ROOT, outRel)), { recursive: true })
    writeFileSync(resolve(ROOT, outRel), code, 'utf8')
  }
  console.log(`[散文件投放] ${rels.length} 份 TypeScript 进 package/shared`)
}

// L1 全树 --check 的定长 worker 池：node 进程挨个起是构建里最胖的一块，
// 并行只摊启动开销，每个文件的检查本身一字不差；失败按文件顺序报第一个。
// 并发封顶 8（与 verify-parallel 的封顶口径一致）：小核机行为不变，高核机不一次起几十个 node 进程。
// 失败文本与串行同形（stderr 为空才取 stdout，只取前三行）：同一份文件串并行报同一段文字。
// 空数组直接放行、spawn 起不来也记一个 settled：L1 恒 302 文件走不到这两条，守的是将来有人复用这函数。
function checkTreeWithPool(files: string[]): Promise<void> {
  const concurrency: number = Math.min(8, Math.max(1, cpus().length))
  const problems: (string | null)[] = new Array(files.length).fill(null)
  let next: number = 0
  let done: number = 0
  let activeCount: number = 0
  return new Promise<void>((resolve, reject) => {
    if (files.length === 0) { resolve(); return }
    const finishOne = (): void => {
      if (done !== files.length) { launch(); return }
      for (let k: number = 0; k < problems.length; k++) {
        if (problems[k] !== null) {
          reject(new Error(`[L1] node --check 失败 ${problems[k]}`))
          return
        }
      }
      resolve()
    }
    const launch = (): void => {
      while (activeCount < concurrency && next < files.length) {
        const i: number = next++
        activeCount++
        const child: any = spawn(process.execPath, ['--check', files[i]], { encoding: 'utf8' })
        let errText: string = ''
        let outText: string = ''
        if (child.stderr) child.stderr.on('data', (d: any) => { errText += String(d) })
        if (child.stdout) child.stdout.on('data', (d: any) => { outText += String(d) })
        let settled: boolean = false
        const settle = (msg: string | null): void => {
          if (settled) return
          settled = true
          activeCount--
          done++
          if (msg !== null) problems[i] = `${files[i]}: ${msg}`
          finishOne()
        }
        child.on('close', (code: any) => {
          if (code !== 0) settle((errText || outText || 'node --check 非 0').split('\n').slice(0, 3).join(' | '))
          else settle(null)
        })
        child.on('error', (err: any) => { settle(`spawn 失败 ${(err as Error).message}`) })
      }
    }
    launch()
  })
}

// ---------- 构建 host（方案 C 原样复制 · #136/#172） ----------
async function buildHost({ version }: { version: string }): Promise<{ devCode: string; pkgCode: string }> {
  // #1074（修：构建先行兼容）：宿主入口真源可能是手写 .js（转制前）或 .ts（转制后）。
  //   .ts 先按全仓唯一转译口径转成 JavaScript（去掉产物头一行再抽取），再走同一条抽取；
  //   .js 路径仍在时走老路，产物字节一字不变。转制提交只换真源扩展名，构建不用再动。
  const indexTsRel: string = 'src/host/index.ts'
  const indexJsRel: string = 'src/host/index.js'
  const useTsEntry: boolean = existsSync(resolve(ROOT, indexTsRel))
  const indexSrcRel: string = useTsEntry ? indexTsRel : indexJsRel
  const indexSrcText: string = useTsEntry
    ? restoreLoweredDefault(transpileMovedTs(indexTsRel).replace(/^\/\/ AUTO-GENERATED[^\n]*\n/, ''))
    : read(indexJsRel)
  const { header, body }: { header: string; body: string } = extractPluginBody(indexSrcRel, indexSrcText)
  const hostDevBanner: string = `// AUTO-GENERATED by scripts/build.mts — DO NOT EDIT. Source: ${indexSrcRel}${useTsEntry ? '（转译）' : ''} (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mts 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态（保留，host.js 不在发布包，#172 不碰其函数体）----
  const devCodeRaw: string = `${hostDevBanner}${header}\n\nreturn ${body}\n`
  // 2026-10-19 第三阶段：共享层产物从源码树搬到仓库根的 .build/shared/，dev 产物里那两句
  // import("../shared/time-config/values.js")（中央时间参数，运行到才取）必须跟着改指向。
  //
  // 为什么改成 ../../.build/shared/ 而不是 ../../../：dev 产物是 cordis_define 的函数体，
  // 里面其余相对说明符（./dispatchMeta.js、./refresh/wiring.js、../deck/registration/host-delegate.js）
  // 都是按「这个文件住在 src/host/」这一基准写的——src/host/dispatchMeta.ts 在那里，仓库根没有
  // dispatchMeta.js，所以唯一自洽的解析基准是 src/host/。从 src/host/ 出发，../.. 才是仓库根
  // （src/host/../.. = 仓库根），到仓库根的 .build/shared/ 就是 ../../.build/shared/。
  //
  // 假定与依据：dev 产物在本仓库里没有本地消费者（docs/workflow/DEV-WORKFLOW.md 把它记作
  // 「动态 runner 的潜在路径」，不是发布包里真实加载的那份），无法本地真跑验证，所以层数只能按
  // 「与 dev 产物里其余相对说明符同一个基准」来定，并用路径算术核对：src/host/ + ../../.build/shared/
  // 正好落在仓库根/.build/shared/。将来若运行器换了解析基准，这两句要跟着换——届时验收第 3 条
  // （host.js 文本里出现 .build/shared/time-config/values.js）会先暴露出来，不会静默错到底。
  // 域源码的说明符写成 `../shared/<域>/src/<名>.js`（指向真源，tsc 靠扩展名替换解析到 .ts），
// 而 .build/shared 下是摊平的 `<域>/<名>.js`：先把带 /src/ 的那一档折掉，再统一换前缀。
// 刷新文件（#1425 起住 src/refresh/）的说明符写成 `../../refresh/<层>/<名>.js`（从 src/host/ 出发两档），
// dev 产物里按同一基准（src/host/）换成仓库根的 .build/refresh/。包内那一半不用换：
// package/refresh 与 src/refresh 镜像，相对引用原样成立（见 MOVED_TREE_MAP 那条注释）。
const devCode: string = devCodeRaw
  .replace(/(['"])\.\.\/shared\/([A-Za-z0-9_.-]+)\/src\//g, '$1../../.build/shared/$2/')
  .replace(/(['"])\.\.\/shared\//g, '$1../../.build/shared/')
  .replace(/(['"])\.\.\/\.\.\/refresh\//g, '$1../../.build/refresh/')
  gatePrecheck(devCode, 'host-dev')
  write('host.js', devCode)

  // ---- _pkg：.js 原样复制＋.ts 转译投放 —— src/host 的手写 .js → package/lib，
  //   四棵新树的 .ts 转译成 .js 进包（deployMovedTrees），src/shared → package/shared ----
  // 幂等清理：先清旧产物再复制；lib/client.js 工厂壳由 buildClient 负责，不在此删
  const pkgLib: string = resolve(ROOT, 'package/lib')
  const pkgShared: string = resolve(ROOT, 'package/shared')
  const pkgDeck: string = resolve(ROOT, 'package/deck')
  const pkgTracker: string = resolve(ROOT, 'package/tracker')
  const pkgRefresh: string = resolve(ROOT, 'package/refresh') // #1425 起：刷新新家的包内镜像位
  // 清理 package/lib 下的 host 树（保留 lib/client.js）：从前只点名删 index.js、platform、
  // tracker、logPkg 四处，搬家后 host 树里多了 refresh、outbound 与根上 7 份 .ts 的产物，
  // 点名删会漏。改成“除 client.js 外全清”，再由复制与投放两步重写——产物要么是复制来的，
  // 要么是转译来的，没有第三种来源，全清重写不会误删东西。
  // #1016：src/host/logPkg 已删（宿主日志改成直接取用已安装的 dsh-log 包），
  // 这里全清之后，旧构建留下的 package/lib/logPkg 也一并消失，不会再作为多余产物躺在包里。
  if (existsSync(pkgLib)) {
    for (const ent of readdirSync(pkgLib)) {
      if (ent === 'client.js') continue
      try { rmSync(join(pkgLib, ent), { recursive: true, force: true }) } catch {}
    }
  }
  for (const p of [pkgShared, pkgDeck, pkgTracker, pkgRefresh]) {
    try { rmSync(p, { recursive: true, force: true }) } catch {}
  }
  mkdirSync(pkgLib, { recursive: true })
  mkdirSync(pkgShared, { recursive: true })
  mkdirSync(pkgDeck, { recursive: true })
  mkdirSync(pkgTracker, { recursive: true })
  mkdirSync(pkgRefresh, { recursive: true })
  // 复制 src/host → package/lib：只收 .js。搬家后 src/host 里住进了 16 份 .ts 真源，
  // 整树照搬会把源码带进发布包；.ts 的包内产物由下面的 deployMovedTrees 转译写入。
  // 同目录有同名 .ts 的 .js 是并排转译产物（今天没有，防御性跳过），归转译步骤写。
  const srcHost: string = resolve(ROOT, 'src/host')
  // Node 16.7+ cpSync 原生支持；fall back 手写
  const copyOpts = { recursive: true, force: true }
  // 域产物的包内镜像（2026-10-19 第三阶段）：从每个域的 src/*.ts 用同一份域转译口径写进
  // package/shared/<域>/<名>.js，不再从源码树复制 .js。
  //
  // 为什么不再复制：源码树里的 .js 已经删掉（产物挪到 .build/），继续按「复制域目录根下的 .js」
  // 写包内镜像，来源就变成一份构建中间文件；直接吃真源、与域构建共用 transpileUnit() 同一份流水线
  // （转译参数、宿主引用改写、行首导出都在那一份实现里），包内镜像与 .build 产物只有落点不同，
  // 由同一次构建写出，不会各自漂移。域根上的散文件（version-control/exec-envelope.ts 这类）归
  // 后面的 deployLooseShared，不在这里。
  //
  // 域类型检查已经在 buildDomain 里跑过（主流程先构建域、再进 buildHost），这里只转译、不重复查。
  function deployDomainProducts(dstRoot: string): void {
    let written: number = 0
    for (const domain of findDomains()) {
      const p = domainPaths(domain)
      for (const tsName of listSources(p.absSources)) {
        const srcRel: string = `${p.relFromRoot}/src/${tsName}`
        const outAbs: string = join(dstRoot, domain, tsName.replace(/\.ts$/, '.js'))
        mkdirSync(dirname(outAbs), { recursive: true })
        writeFileSync(outAbs, transpileUnit(srcRel), 'utf8')
        written++
      }
    }
    console.log(`[域产物镜像] ${written} 份域产物进 package/shared`)
  }
  try {
    if (typeof cpSync === 'function') {
      // 复制 src/host → package/lib（只收 .js，逐文件内容一致；.ts 由投放步骤转译写入）
      const copyHostJs = (s: string, d: string): void => {
        for (const ent of readdirSync(s, { withFileTypes: true })) {
          const ps: string = join(s, ent.name)
          const pd: string = join(d, ent.name)
          if (ent.isDirectory()) { copyHostJs(ps, pd); continue }
          if (!ent.name.endsWith('.js')) continue
          if (existsSync(join(s, ent.name.slice(0, -'.js'.length) + '.ts'))) continue
          mkdirSync(dirname(pd), { recursive: true })
          cpSync(ps, pd, copyOpts)
        }
      }
      copyHostJs(srcHost, pkgLib)
    } else {
      throw new Error('cpSync unavailable')
    }
  } catch (e) {
    // fallback 手写递归（同样只收 .js，.ts 由投放步骤转译写入）
    function cpRecur(src: string, dst: string): void {
      const st = statSync(src)
      if (st.isDirectory()) {
        mkdirSync(dst, { recursive: true })
        for (const ent of readdirSync(src)) cpRecur(join(src, ent), join(dst, ent))
      } else {
        if (!src.endsWith('.js')) return
        if (existsSync(src.slice(0, -'.js'.length) + '.ts')) return
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(src))
      }
    }
    cpRecur(srcHost, pkgLib)
  }
  // 域产物的包内镜像放在复制那一步外面：它按真源转译，与 cpSync 在不在无关，
  // 失败应当直接抛出去（转译不过、源码缺失都是内容问题，重跑复制也修不了）。
  deployDomainProducts(pkgShared)
  // 散文件投放：src/shared 下不属于任何域源码（<域>/src/）的 .ts —— 根上 9 份、tracker/ 与 ui/
  // 两个没有 tsconfig 的目录、以及 version-control/exec-envelope.ts 这种域根散文件 ——
  // 一并转译进 package/shared。
  // 必须排在新树投放之前：deployMovedTrees 末尾会审计 package/lib 里的相对引用能不能逐条解开，
  // 而宿主（package/lib）引用共享层用的就是 ../shared/<名>.js；散文件产物还没写进去时，
  // 这套引用会被判成「落空」而误报。两者都只写 package/shared，先后不影响内容。
  deployLooseShared()
  // 新树投放：三棵树的 .ts 转译进包、tracker 手写 .js 复制进包、包内引用逐条审计。
  // 放在复制之后、校验之前：投放失败（转译不过、引用落空）当场抛错，不进 fallback
  // （fallback 只管“复制工具不可用”这一种故障，内容问题重跑复制也一样）。
  deployMovedTrees()
  // 校验：入口一致性（#1074 修：跟真源走）。手写 .js 真源在时守旧不变量（包内入口与手写源逐字节一致）；
  //   .ts 真源在时守新不变量（包内入口 === 按同一条投放流水线重算一遍的结果，转译漏投放当场红）。
  try {
    if (existsSync(resolve(ROOT, 'src/host/index.ts'))) {
      const outRel: string = 'package/lib/index.js'
      const replayed: string = rewriteMovedSpecifiers(transpileMovedTs('src/host/index.ts'), 'src/host/index.ts', outRel).code
      const b: string = readFileSync(resolve(ROOT, outRel), 'utf8')
      if (replayed !== b) throw new Error('package/lib/index.js 与 src/host/index.ts 的投放重算不一致（转译投放失败）')
    } else {
      const a: string = readFileSync(resolve(ROOT, 'src/host/index.js'), 'utf8')
      const b: string = readFileSync(join(pkgLib, 'index.js'), 'utf8')
      if (a !== b) throw new Error('package/lib/index.js 与 src/host/index.js 不一致（原样复制失败）')
    }
  } catch (e) {
    throw new Error(`[build] 入口一致性校验失败：${(e as Error).message}`)
  }
  // 校验：发布清单里点名的每个文件都得在盘上（#1023 第二刀的构建期断言）。
  // 为什么放在构建里、不做成一道门禁：入口指错文件这件事，构建当场能看出来，也只有在构建
  // 刚写完这些东西的那一刻最该问；做成门禁等于让「构建错了」这件事等到测试阶段才暴露。
  // 为什么只查 exports 不查 files：files 是白名单（列的是目录，允许目录里今天没东西），
  // exports 是入口（列的是具体文件，指错了消费者 import 就失败）。
  try {
    const pkgJson: any = JSON.parse(readFileSync(resolve(ROOT, 'package/package.json'), 'utf8'))
    const pkgRoot: string = resolve(ROOT, 'package')
    const missing: string[] = []
    const checkTarget = (label: string, target: any): void => {
      if (typeof target !== 'string' || !target.startsWith('./')) return
      if (!existsSync(resolve(pkgRoot, target))) missing.push(`${label} → ${target}`)
    }
    for (const [key, val] of Object.entries(pkgJson.exports || {})) {
      if (typeof val === 'string') checkTarget(`exports["${key}"]`, val)
      else if (val && typeof val === 'object') for (const [cond, target] of Object.entries(val)) checkTarget(`exports["${key}"].${cond}`, target)
    }
    checkTarget('main', pkgJson.main)
    if (missing.length > 0) {
      throw new Error('发布清单点名的文件不在盘上：\n  - ' + missing.join('\n  - ') + '\n（检查 package/package.json 的 exports 与构建的复制步骤是否对得上）')
    }
    console.log(`[build] 发布清单校验通过：exports 与 main 点名的文件都在 package/ 里（${Object.keys(pkgJson.exports || {}).length} 条 exports）`)
  } catch (e) {
    throw new Error(`[build] 发布清单校验失败：${((e as Error) && (e as Error).message || e)}`)
  }
  // #875 薄接线：旧派生目录已删，不再随包复制 updatePkg（能力只走已安装的更新包）。
  // 分发 scripts/：消费者工作区调用的两条脚本随包发布（#588 总指挥裁定：只收两条消费者脚本，
  // 构建/调试脚本（build.mts、ui-*、wizard-*、generate-*、matrix-*、sync-* 等）不许进发布包；
  // 清单写死在这里并注释原因，不另维护第二份——门禁从这份清单机械求值发布包脚本集合）。
  const SHIPPED_SCRIPTS: string[] = ['fix-issue-body.mts', 'wire-subissues.mts']
  const pkgScripts: string = resolve(ROOT, 'package/scripts')
  try { rmSync(pkgScripts, { recursive: true, force: true }) } catch {}
  mkdirSync(pkgScripts, { recursive: true })
  for (const name of SHIPPED_SCRIPTS) {
    writeFileSync(join(pkgScripts, name), readFileSync(join(resolve(ROOT, 'scripts'), name)))
  }
  console.log(`[build] scripts 已随包分发 → package/scripts（${SHIPPED_SCRIPTS.length} 个文件：${SHIPPED_SCRIPTS.join('、')}）`)
  // 这里原先有一段 utimesSync 递归 touch（把 package/lib、package/deck 等产物目录的修改时间提到当前），
  // 它存在的唯一理由是让旧的「按修改时间判产物新鲜」的几扇门禁不误报。判据换成内容摘要之后（#1326），
  // 全仓已经没有判据再看 mtime；这段每次都白白制造几万个文件的修改时间变化，还会触发界面热更，
  // 所以删除。原样复制出来的文件内容没变，也不需要再人为碰时间。

  // L1 冒烟：构建内 await import('package/lib/index.js') 入口 + node --check 全树
  // --check 全树
  function collectJs(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p: string = join(d, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (p.endsWith('.js')) out.push(p)
      }
    }
    if (existsSync(dir)) walk(dir)
    return out
  }
  const allHostJs: string[] = collectJs(pkgLib).concat(collectJs(pkgShared), collectJs(pkgDeck), collectJs(pkgTracker))
  // L1 全树 --check 走定长 worker 池：302 个 node 进程挨个起是构建里最胖的一块
  //（实测串行 15.2s → 并行 1.6s，证据见 .scratch/bench-1252-l1check.mjs）。
  // 每个文件照旧查一遍；全部跑完后按文件顺序报第一个失败——与串行“遇红即停”报的是同一份。
  await checkTreeWithPool(allHostJs)
  // 入口 import 冒烟（显式 .js 已在 src 侧保证，此处验证 runtime 解析）
  const entryUrl: string = pathToFileURL(join(pkgLib, 'index.js')).href
  let mod: any
  try {
    mod = await import(entryUrl)
  } catch (e) {
    throw new Error(`[L1] import(package/lib/index.js) 失败：${(e as Error).message}`)
  }
  // 方案 C：src/host/index.ts 为 export default { apply } 默认导出，非命名导出；兼容两种形态
  const hasApply: boolean = typeof mod.apply === 'function' || typeof mod.default?.apply === 'function'
  const hasName: boolean = typeof mod.name === 'string' || typeof mod.default?.name === 'string'
  if (!mod || !hasApply) {
    throw new Error(`[L1] 入口导出校验失败：hasApply=${hasApply} name=${mod?.name ?? mod?.default?.name} apply=${typeof (mod?.apply ?? mod?.default?.apply)} keys=${Object.keys(mod)}`)
  }
  const dispName: any = mod.name ?? mod.default?.name ?? '(default)'
  const dispInject: string = Array.isArray(mod.inject) ? mod.inject.join(',') : Array.isArray(mod.default?.inject) ? mod.default.inject.join(',') : '(default.apply)'
  console.log(`[L1] host pkg 入口冒烟通过：name=${dispName} inject=${dispInject} apply=function`)

  const pkgCode: string = readFileSync(join(pkgLib, 'index.js'), 'utf8')
  return { devCode, pkgCode }
}

// ---------- 产物自检（风险A） ----------
function gateBuildArtifacts(): void {
  for (const p of ['client.js', 'host.js']) {
    if (existsSync(resolve(ROOT, p))) {
      const txt = read(p)
      if (!txt.startsWith('// AUTO-GENERATED')) {
        console.warn(`[warn] ${p} 缺 AUTO-GENERATED 横幅 — 可能为手改产物，下次 build 将被覆盖`)
      }
    }
  }
}

// ---------- 捆绑技能存在性检查（#388 T1 · G2 定版：目录直铺 27，空目录期跳过校验） ----------
function ensureBundledSkills(): void {
  const bundledDir: string = resolve(ROOT, 'package/bundled-skills')
  if (!existsSync(bundledDir)) {
    console.warn('[build] 警告：package/bundled-skills 不存在，跳过捆绑校验（早期分支容忍）。请运行 node scripts/sync-matt-skills.mts --pin v1.3.1 --verify 同步')
    return
  }
  const entries: string[] = readdirSync(bundledDir, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name)
  if (entries.length !== 27) {
    console.warn(`[build] 警告：bundled-skills 期望 27 项，当前 ${entries.length} 项（可能未同步完成）`)
  }
  // 轻量校验：每项含 SKILL.md 且 frontmatter name 与目录一致（与 verify-bundled-skills 同口径，失败仅 warn 不阻断 build）
  for (const name of entries) {
    const mdPath: string = join(bundledDir, name, 'SKILL.md')
    if (!existsSync(mdPath)) {
      console.warn(`[build] 警告：${name}/SKILL.md 缺失`)
      continue
    }
    try {
      const md: string = readFileSync(mdPath, 'utf8')
      const m: RegExpMatchArray | null = md.match(/^name:\s*(.+)$/m)
      const fm: string = m ? m[1].trim().replace(/^[\'\"]|[\'\"]$/g, '') : ''
      if (fm && fm !== name) console.warn(`[build] 警告：${name}/SKILL.md name:${fm} ≠ 目录名`)
    } catch {}
  }
  const verPath: string = join(bundledDir, 'VERSION')
  const licPath: string = join(bundledDir, 'LICENSE')
  if (!existsSync(verPath)) console.warn('[build] 警告：bundled-skills/VERSION 缺失')
  if (!existsSync(licPath)) console.warn('[build] 警告：bundled-skills/LICENSE 缺失')
}

// ---------- main ----------

const args: string[] = process.argv.slice(2)
const devOnly: boolean = args.includes('--dev-only')
const pkgOnly: boolean = args.includes('--pkg-only')

// 先看缓存：手写输入与产物都没变，就没必要再花 30 秒重跑一遍打包（链上 13 扇门禁各跑一次，只有第一次该付这个钱）。
// 拿构建锁（#1365 方案甲）：从这里起真构建开始删目录、写产物，锁盖到 writeBuildCache() 之后。
// 拿锁成功后先复核一次缓存——排队等的这段时间里，前面那个构建很可能已经把活干完了，
// 这时直接释放锁退出，不用再重建一遍。
const buildLock = acquireBuildLock({ repoRoot: ROOT, cacheDir: join(ROOT, 'node_modules', '.cache'), breakStale: args.includes('--break-stale-lock') })
// 兜底：真构建中途抛错，进程退出时同步释放，保证不留死锁（正常走完在 writeBuildCache() 后显式释放）。
process.on('exit', () => { releaseBuildLock(buildLock) })
if (tryBuildCacheHit(args)) {
  releaseBuildLock(buildLock)
  process.exit(0)
}
const version: string = dswVersion()
const repoUrl: string = dswRepoUrl()
console.log(`[build] DSW_VERSION=${version} (package/package.json)`)
console.log(`[build] DSW_REPO_URL=${repoUrl} (package/package.json repository)`)

// A 自检（build 前）：若产物存在但无横幅，给 warn（不阻断，防旧产物）
gateBuildArtifacts()
ensureBundledSkills()
syncReadme(version, repoUrl)
// 大阶段边界：同步刷新一次锁心跳（同步段里事件循环不转，定时器指不上，只有边界上的同步写能证明进程还活着）。
// 下面几个 pulseBuildLock 都是同一个意思，不再逐个解释。
pulseBuildLock(buildLock)

// 内置 TypeScript 域的逐文件转译：src/shared 下每个带 tsconfig.json 的目录算一个域，
// 每个域先跑类型检查、再把它的 src/*.ts 逐份转译成同目录同名的 .js。
// 放在两段派生之前：这些产物是客户端闭包与宿主模块的输入，必须先就位。
// 域里没有源码目录时（发布包与 package/ 子树）这一步自己跳过并打印一行提示，构建继续走。
// #1215：进域循环之前，先按 config/ 下的三份时间参数文件重算 time-config 域的生成源码——
// 域构建的第一步是该域的类型检查，生成必须在它之前，否则检查的是上一版的数字。
// #1292：客户端内核要用的提示词数据（config/prompts/ 下的 YAML + config/languages.yaml）由生成器
// 现场写成 src/client/kernel/prompt-data.ts，再由 KERNEL_MODULES 的 promptData 一项拼进闭包 ——
// 所以生成必须排在客户端拼装之前，与 time-config 同款纪律（见 docs/adr/20261016-time-config-yaml.md §2.2）。
// #1294：界面词表同理（config/copy/*.yaml + config/languages.yaml → locale-data.ts）。它要把
// {{时间参数}} 烘成数字，所以排在 time-config 生成之后。
{
  const r1: any = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'generate-prompt-config.mts')], { encoding: 'utf8' })
  if (r1.status !== 0) {
    throw new Error('提示词 YAML 配置生成失败（config/prompts/ + config/languages.yaml → prompt-data.ts）：' + String((r1.stdout || '') + (r1.stderr || '')).trim().split('\n').slice(0, 3).join(' ／ '))
  }
}
{
  const r: any = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'generate-time-config.mts')], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error('中央时间参数生成失败（config/ 下的三份时间参数文件 → time-config 域）：' + String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(0, 3).join(' ／ '))
  }
}
{
  const r: any = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'generate-locale-config.mts')], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error('界面词表配置生成失败（config/copy/ + config/languages.yaml → locale-data.ts）：' + String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(0, 3).join(' ／ '))
  }
}
for (const domain of findDomains()) {
  buildDomain(domain, { handWritten: HAND_WRITTEN_IN_DOMAINS[domain] || [] })
}

// #1215 客户端时间参数片段：界面闭包不能运行时 import（客户端半边没有任何对 src/shared 的
// 运行时 import），所以把闭包里要用的中央常量一次摘出来，落到 .tmp（不入库，每次构建重算），再拼进闭包。
// 名单里不能有重名（同一名字拼两遍，client-dev 预检报 Identifier has already been declared）；
// 闭包里裸用的中央名字必须都在名单里，少一个就是运行时的 ReferenceError——
// tests/verify-time-config.ts 第三节逐个核对（名单里的每个名字都有文件在用，用到的每个名字都在名单里）。
// 加新的客户端消费名时，把名字追加到 CLIENT_TIME_NAMES 即可，不用动拼接管线。
const CLIENT_TIME_NAMES: string[] = [
  'MAP_TICKETS_TTL_MS',
  'SETTINGS_DEBUG_PUSH_WAIT_MS',
  'CLIENT_SESSION_TICK_MS',
  'CLIENT_HANDOFF_DELAY_MS',
  'PROBE_AUTO_WAIT_MS',
  'SLOT_QUEUE_STEP_MS',
  'SLOT_MODAL_OPEN_DELAY_MS',
  'STORE_SWITCH_CONFIRM_MS',
  'STATUS_MENU_DISMISS_DELAY_MS',
  'STATUS_MENU_HOVER_OPEN_DELAY_MS',
  'STATUS_MENU_FALLBACK_DELAY_MS',
  'SNAPSHOT_PROBE_MS',
  'STORE_NOTICE_DISMISS_MS',
  'ISSUE_DETAIL_CONFIRM_MS',
  'COMMENT_RESULT_FLASH_MS',
  'COMMENTS_MORE_LOADING_MIN_MS',
  'COPY_FLASH_MS',
  // 客户端里那几处「SYNC 缺席时的兜底」也用中央常量，不在源码里留第二份数字。
  'SYNC_FALLBACK_PROBE_MS',
  'SYNC_FOCUS_PROBE_MIN_MS',
  'SYNC_SNAP_FRESH_MS',
  'SYNC_ISSUE_CACHE_TTL_MS',
  // 拼进闭包的 trackerSync（sync.js）函数体里裸用下面这些 SYNC 名字：import 行剥掉之后，
  // 声明只能是这一片给。单源头改造前 sync.js 的 SYNC 对象里是字面量，现在声明搬到了这里。
  'SYNC_EVAL_GAP_MS',
  'SYNC_DIRTY_PROBE_DEBOUNCE_MS',
  'SYNC_OVERLAP_SKEW_MS',
  'SYNC_FAILURE_BACKOFF_MS',
  'SYNC_DIRTY_ECHO_TTL_MS',
  'SYNC_POLL_GRID_MS',
  'SYNC_ACTION_PROBE_WINDOW_MS',
  'SNAP_WAIT_MS',
  'VIEW_FLAG_WRITE_DEBOUNCE_MS',
  'REST_FALLBACK_STALE_MS',
  'TIP_SHOW_DELAY_MS',
  'TIP_HIDE_DELAY_MS',
  'VC_RELATIVE_WINDOW_MS',
  // 回填草稿后补焦点的重试延时（api-io.ts 剥掉 import 行之后，名字由这一片提供）。
  'DRAFT_REFOCUS_RETRY_MS',
  // 改名冷却窗（naming-tracking.js 拼进闭包，剥掉 import 行之后名字由这一片提供）。
  'NAMING_RETRY_COOLDOWN_MS',
  // 刷新预算那一片（budget.js 拼进闭包）：它的函数体里裸用下面这些名字，import 行剥掉之后，
  // 声明只能是这一片给。单源头改造前这些名字由 budget.js 自己声明（字面量），现在声明搬到了这里，
  // 值还是同一份（同一份 values.js 摘出来），闭包里只出现一次。
  'PROBE_INTERVAL_MS',
  'PROBE_INTERVAL_YELLOW_MS',
  'PROBE_INTERVAL_LINGER_MS',
  'REBUILD_MIN_INTERVAL_YELLOW_MS',
  'RECONCILE_INTERVAL_MS',
  'PREFLIGHT_TTL_MS',
  'CHAIN_BACKOFF_MS',
  'FAILURE_HALF_OPEN_DELAY_MS',
  'CHAIN_ALL_GREEN_TTL_MS',
  'PATCH_MERGE_WINDOW_MS',
  'DEFER_EXPIRY_MS',
  'ACTIVE_LINGER_MS',
  'ATTENTION_HEARTBEAT_MS',
  'ATTENTION_EXPIRY_MS',
  'QUOTA_SYNC_INTERVAL_MS',
  'FRESHNESS_YELLOW_MS',
  'FRESHNESS_RED_MS',
  // 界面叶子里的三处停留与两处延时（SkillFloatList / LabelColorDialog / PixelSkillDetailModal /
  // panelAssembly / PixelSkillOps）：import 行剥掉之后名字由这一片提供。
  'SKILL_FLOAT_CLOSE_DELAY_MS',
  'LABEL_COPY_FLASH_MS',
  'SKILL_DETAIL_COPIED_FLASH_MS',
  'NATIVE_TAB_RETRY_INTERVAL_MS',
  'SKILL_SKELETON_DELAY_MS',
]
function buildTimeConfigClientFragment(): void {
  // 读构建产物而不是源码树：中央时间参数的域产物（values.js）从 2026-10-19 起落在 .build/shared/ 下，
  // 它由本次构建前面的域构建步骤刚写出来（主流程里 buildDomain 在它前面跑）。
  // 为什么仍读产物、不读 src/time-config/src/values.ts：界面闭包要的是 JavaScript 常量行，
  // 产物就是构建按同一份转译口径写出来的那一份，读它等于读「宿主吃的那份值」，不会抄出错位。
  const src: string = read('.build/shared/time-config/values.js')
  const lines: string[] = []
  for (const name of CLIENT_TIME_NAMES) {
    const hit: string[] = src.split('\n').filter((l) => l.startsWith(`export const ${name} = `))
    if (hit.length !== 1) throw new Error(`[build] 客户端时间片段摘不到 ${name}（期望恰好一行 export const，实得 ${hit.length} 行）`)
    lines.push(hit[0])
  }
  mkdirSync(resolve(ROOT, '.tmp'), { recursive: true })
  writeFileSync(resolve(ROOT, '.tmp/time-config.client.js'),
    `// AUTO-GENERATED by scripts/build.mts — DO NOT EDIT. Source: .build/shared/time-config/values.js（闭包里要用的中央常量，一次摘 ${CLIENT_TIME_NAMES.length} 个，值与宿主吃的是同一份 YAML）\n` + lines.join('\n') + '\n', 'utf8')
  console.log(`[build] 客户端时间片段已摘 ${lines.length} 个常量 → .tmp/time-config.client.js`)
}
buildTimeConfigClientFragment()

// 887 客户端 TS 真源（px 系列）：真源是同名 .ts，构建不再为它们转译同名 .js。
// 拼接缝（readSpliceFragmentSource）自己按扩展名认 .ts，当场转译再拼进闭包，产物只留在
// client.js / package/lib/client.js 里；源码树只放真源。这一段留下的是类型检查：
// tsc --noEmit 仍然要跑，它守「真源本身没有类型错误」，与拼不拼产物无关。
// #1209：statusbar 也在内 —— StatusBackend.ts 住在那里。
// #1253：views 下的 feedback / labels / primitives / shared 四个子目录原先全是手写 .js，整批转成 .ts。
// 2026-10-19：pixel-ts 那一步（逐文件写同名 .js + AUTO-GENERATED 头）连同 166 份产物一起删掉，
//   读它们的门禁同批改走 tests/lib/source-text.ts 取真源；此后 src/client 只有 .ts。
const PX_TS_DIRS: string[] = ['src/client/views', 'src/client/views/pixel', 'src/client/views/skillDetail', 'src/client/views/cards', 'src/client/views/versionControl', 'src/client/views/feedback', 'src/client/views/labels', 'src/client/views/primitives', 'src/client/views/shared', 'src/client/kernel', 'src/client/statusbar', 'src/client/panel', 'src/client/floating']
function pixelTsTruthFiles(): string[] {
  const out: string[] = []
  for (const d of PX_TS_DIRS) {
    const abs: string = resolve(ROOT, d)
    if (!existsSync(abs)) continue
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(join(abs, ent.name))
    }
  }
  return out
}
function checkPixelTs(): void {
  if (pixelTsTruthFiles().length === 0) return
  const require = createRequire(resolve(ROOT, 'package.json'))
  let tscBin: string
  try { tscBin = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc') }
  catch (e) { throw new Error('[pixel-ts] 没装 typescript（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  const r: any = spawnSync(process.execPath, [tscBin, '-p', resolve(ROOT, 'tsconfig.client.json')], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('[pixel-ts] tsc --noEmit 未通过：\n' + (r.stdout || '') + (r.stderr || ''))
  console.log('[pixel-ts] tsc --noEmit 通过')
}

// 887 客户端 TS 真源：只跑类型检查，不再逐文件写同名 .js。拼接缝读的是 .ts 真源本身
// （readSpliceFragmentSource 按扩展名分派，转译发生在拼接那一刻），所以这一段不产出文件。
checkPixelTs()
pulseBuildLock(buildLock)

// #1256 散文件 TS 真源（src/shared 下不属于域源码的）：真源是同目录的 .ts，esbuild 逐文件转译出 .js
// （AUTO-GENERATED 头，gitignore 不入库），tsc --noEmit 只做类型检查。
// 2026-10-19 第三阶段：产物不再写回真源旁边，统一落在仓库根 .build/shared/<相对 src/shared 的路径>.js
// （整个 .build/ 被 gitignore 忽略，源码树里只留手写 TypeScript）。
// 为什么与 pixel-ts 同模式、另起一段：产物用途不同——客户端产物拼进闭包，散文件产物给三类消费者：
//   ① 开发产物按 .js 说明符直解（根 host.js 里 ../shared/... 那两句已改写成 ../../.build/shared/...，
//      见 buildHost 里的说明）；发布包那一半由 deployLooseShared 从真源另投一份进 package/shared；
//   ② 门禁按 .js 路径直读文本（noExport 剥行首 export 当场求值，读到 .ts 会因类型注解求值失败），
//      门禁读的就是 .build/shared/ 下这一份；
//   ③ 测试与模块说明符走装载钩子的「同名 .ts 优先 / <目录>/src/<同名>.ts 回落」，不读产物。
// 所以同样要行首 export 形态（inlineExportDeclarations，与 pixel-ts 共用同一份实现，不另抄），
// 真源集合口径与类型检查共用同一份（src/shared/tsconfig.json 的 include：根上 *.ts、各子目录根上 *.ts；
// 有 tsconfig 的域只圈自己 src/ 下的源码，域目录根上的散文件两边都不重叠，归这里）。
function sharedTsTruthFiles(): string[] {
  const sharedAbs: string = resolve(ROOT, 'src/shared')
  const out: string[] = []
  if (!existsSync(sharedAbs)) return out
  for (const ent of readdirSync(sharedAbs, { withFileTypes: true })) {
    if (ent.isFile()) {
      if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(join(sharedAbs, ent.name))
    } else if (ent.isDirectory()) {
      // 有 tsconfig.json 的是域目录（findDomains 的认定）：域源码（src/ 下的 .ts）归域构建写；
      // 但域目录根上散落的 .ts（例如 version-control/exec-envelope.ts：从 host 下沉的纯函数，
      // 住域目录里但不是域源码，域构建的 src/**/*.ts 圈不到它）归这里写。两边按「src/ 内外」分工，不重叠。
      const sub = join(sharedAbs, ent.name)
      for (const f of readdirSync(sub, { withFileTypes: true })) {
        if (f.isDirectory()) continue
        if (f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.d.ts')) {
          out.push(join(sub, f.name))
        }
      }
    }
  }
  return out.sort()
}
function buildSharedTs(): void {
  const files: string[] = sharedTsTruthFiles()
  if (files.length === 0) { console.log('[shared-ts] 散文件没有 TS 真源，跳过。'); return }
  const require = createRequire(resolve(ROOT, 'package.json'))
  let esbuild: any
  try { esbuild = require('esbuild') } catch (e) { throw new Error('[shared-ts] 没装 esbuild（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  for (const f of files) {
    const source: string = readFileSync(f, 'utf8')
    let code: string
    try { code = esbuild.transformSync(source, TRANSPILE_OPTIONS).code }
    catch (e) { throw new Error('[shared-ts] 转译失败 ' + f + '：' + ((e as Error) && (e as Error).message || e)) }
    const rel: string = 'src/shared/' + relative(resolve(ROOT, 'src/shared'), f).replace(/\\/g, '/')
    const normalized: string = code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
    // 行首 export 形态：门禁按 .js 路径直读文本时剥行首 export 当场求值，尾部 export { ... } 会被当成废块。
    // 改写口径与 pixel-ts、内置域产物完全一样，调用同一份实现，不在这里再抄一遍。
    // 例外（#1256：session-cwd.ts、exec-envelope.ts 带 export default）：esbuild 把默认导出改成
    // `X as default` 的改名条目，inlineExportDeclarations 按设计拒收改名（pixel-ts 那边同样拒收）。
    // 这两份没有文本直读的消费者（730 门禁走模块 import，host 调用走运行时 import），尾部导出块是合法 ESM、
    // 行为与原来一字不差，所以这里退回 esbuild 原样输出，不为它们另改共用的改写函数。
    // 新鲜度门禁照抄同一套 try/catch 口径（见 tests/verify-build-artifacts.ts 的 shared-ts 那一节），两边不会打架。
    let inlined: string
    try { inlined = inlineExportDeclarations(normalized, '[shared-ts]') }
    catch (e) { inlined = normalized }
    // 落点换算只做一次前缀（src/shared/ → .build/shared/），形状仍由真源路径决定，不在这里重推。
    // 后缀单独换：buildSharedProductPath 只负责「挪到哪个目录」，.ts → .js 是转译产物的后缀规则，
    // 两件事分开写，读的人一眼能看出哪一步在改位置、哪一步在改后缀。
    const outRel: string = buildSharedProductPath(rel).replace(/\.ts$/, '.js')
    mkdirSync(dirname(resolve(ROOT, outRel)), { recursive: true })
    writeFileSync(resolve(ROOT, outRel), '// AUTO-GENERATED by node scripts/build.mts (shared-ts) — DO NOT EDIT. Source: ' + rel + '\n' + inlined)
  }
  console.log(`[shared-ts] 转译 ${files.length} 个 TS 真源 → .build/shared/ 下的 .js`)
}
function checkSharedTs(): void {
  if (sharedTsTruthFiles().length === 0) return
  const require = createRequire(resolve(ROOT, 'package.json'))
  let tscBin: string
  try { tscBin = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc') }
  catch (e) { throw new Error('[shared-ts] 没装 typescript（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  const r: any = spawnSync(process.execPath, [tscBin, '-p', resolve(ROOT, 'src/shared/tsconfig.json')], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('[shared-ts] tsc --noEmit 未通过：\n' + (r.stdout || '') + (r.stderr || ''))
  console.log('[shared-ts] tsc --noEmit 通过')
}

// ---------- 刷新新家产物（#1425）：src/refresh/** → .build/refresh/** ----------
//
// 为什么另起一段、不并进上面的 shared-ts：三件事不一样 ——
// ① 根不一样（src/refresh/ 整棵递归，shared-ts 只收 src/shared 根上与子目录根上一层）；
// ② 类型检查走另一份配置（src/refresh/tsconfig.json，contract/kernel/rooms/registry 四层全圈，
//    住户 #1426-#1428 搬进来不用再改配置）；
// ③ 落点前缀不一样（.build/refresh/）。除此之外口径完全一样：同一份 TRANSPILE_OPTIONS、
//    同一行首导出改写（门禁按 .js 路径直读文本，尾部导出块会被当成废块，口径见 buildSharedTs 那段注释）、
//    同一句话产物头（第一行 AUTO-GENERATED，4g 门禁只认这一行）。
// dev 产物里 `../../refresh/` 那一句改写（见 buildHost）与词汇门禁读的都是这里写出来的文件，
// 缺了构建当场红不了，要等门禁跑起来才暴露，所以与 shared-ts 同一节拍：转译与类型检查都放在
// 主流程里、跑在 buildHost 之前。
function refreshTruthFiles(): string[] {
  const refreshAbs: string = resolve(ROOT, 'src/refresh')
  const out: string[] = []
  if (!existsSync(refreshAbs)) return out
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p: string = join(d, ent.name)
      if (ent.isDirectory()) { walk(p); continue }
      if (!ent.name.endsWith('.ts') || ent.name.endsWith('.d.ts')) continue
      out.push(relative(ROOT, p).replace(/\\/g, '/'))
    }
  }
  walk(refreshAbs)
  return out.sort()
}
function buildRefreshTree(): void {
  const files: string[] = refreshTruthFiles()
  if (files.length === 0) { console.log('[refresh-ts] src/refresh 下没有 TS 真源，跳过。'); return }
  const require = createRequire(resolve(ROOT, 'package.json'))
  let esbuild: any
  try { esbuild = require('esbuild') } catch (e) { throw new Error('[refresh-ts] 没装 esbuild（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  for (const rel of files) {
    const source: string = readFileSync(resolve(ROOT, rel), 'utf8')
    let code: string
    try { code = esbuild.transformSync(source, TRANSPILE_OPTIONS).code }
    catch (e) { throw new Error('[refresh-ts] 转译失败 ' + rel + '：' + ((e as Error) && (e as Error).message || e)) }
    const normalized: string = code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
    let inlined: string
    try { inlined = inlineExportDeclarations(normalized, '[refresh-ts]') }
    catch (e) { inlined = normalized }
    const outRel: string = rel.replace(/^src\//, '.build/').replace(/\.ts$/, '.js')
    mkdirSync(dirname(resolve(ROOT, outRel)), { recursive: true })
    writeFileSync(resolve(ROOT, outRel), '// AUTO-GENERATED by node scripts/build.mts (refresh-ts) — DO NOT EDIT. Source: ' + rel + '\n' + inlined)
  }
  console.log(`[refresh-ts] 转译 ${files.length} 个 TS 真源 → .build/refresh/ 下的 .js`)
}
function checkRefreshTree(): void {
  if (refreshTruthFiles().length === 0) return
  const require = createRequire(resolve(ROOT, 'package.json'))
  let tscBin: string
  try { tscBin = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc') }
  catch (e) { throw new Error('[refresh-ts] 没装 typescript（先跑 pnpm install 再构建）：' + ((e as Error) && (e as Error).message || e)) }
  const r: any = spawnSync(process.execPath, [tscBin, '-p', resolve(ROOT, 'src/refresh/tsconfig.json')], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('[refresh-ts] tsc --noEmit 未通过：\n' + (r.stdout || '') + (r.stderr || ''))
  console.log('[refresh-ts] tsc --noEmit 通过')
}

// #1256 散文件 TS 真源：先转译再跑类型检查。与 pixel-ts 同一节拍：产物是门禁文本直读的输入
// （.build/shared/ 下那几份；dev host.js 的 ../shared 引用也指到这里），缺了构建当场红不了，
// 要等门禁跑起来才暴露，所以放在主流程里、跑在 buildHost 之前。
// 类型检查不需要产物旁的声明桩：源码里的 `shared/<域>/src/<名>.js` 说明符会被 tsc 的扩展名替换
// 规则解析到同名 .ts 真源（2026-10-19 第三阶段第二版做法；第一版在源码树里生成 .d.ts 桩，
// 那些桩本身又是落在源码树的构建产物，与「源码树只放真源」冲突，已撤掉）。
// 转译失败或类型不过当场抛错，不进 fallback（内容问题重跑复制也一样）。
buildSharedTs()
checkSharedTs()
pulseBuildLock(buildLock)
buildRefreshTree()
checkRefreshTree()
pulseBuildLock(buildLock)

// #1018 词汇表拼接输入：产物是客户端闭包的输入，必须比 buildClient 先就位。
// 包内投放（package/deck、package/tracker、package/lib 里的转译产物）由 buildHost 内的
// deployMovedTrees 负责，那里包目录已经清好；这里只管拼闭包要用的并排那一份。
buildVocabularySpliceInput()
pulseBuildLock(buildLock)

// #1016 两半版本一致断言：宿主那一半与客户端那一半必须来自同一个 dsh-log 版本。
// 为什么必须有这一条：宿主侧从裸包名 'dsh-log/host' 取用（装机时按 package/package.json 里声明的版本解析），
// 客户端那一半是构建时按本仓已安装的那一份打包出来的。两半的事件名册、配置校验、电话名靠版本对齐，
// 一旦解析到不同版本就会静默错配（症状是日志行对不上、开关读不出，现场还看不出是版本问题）。
// 从前插件在自己的源码树里自带一份副本，两半天然同版本，所以不需要这条；副本删掉之后（#1016）必须补上。
// 判据两条：package/package.json 里必须钉死一个确切版本（写 ^ 这类浮动范围等于放弃这条保证），
// 且它与本仓已安装的那一份必须相同。已安装版本的读法：包只开放 host/client/node 三个子路径，
// 读不到它的 package.json，所以经已开放的 host 入口反推包目录再读清单（同派生脚本里的做法）。
function assertLogHalvesVersionMatch(): void {
  const pkgJsonPath: string = resolve(ROOT, 'package', 'package.json')
  let declared: string = ''
  try {
    declared = (JSON.parse(readFileSync(pkgJsonPath, 'utf8')).dependencies || {})['dsh-log'] || ''
  } catch (e) {
    throw new Error('读不出 package/package.json 里声明的 dsh-log 版本：' + ((e as Error) && (e as Error).message || e))
  }
  if (!declared) {
    throw new Error('package/package.json 里没有声明 dsh-log：宿主那半 import 的 dsh-log/host 装机后解析不到，启动即失败')
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(declared)) {
    throw new Error('package/package.json 里 dsh-log 的版本写的是「' + declared + '」，不是钉死的确切版本：浮动范围会让宿主与客户端两半各自解析到不同版本，这条保证就没了')
  }
  const require = createRequire(resolve(ROOT, 'package.json'))
  let installed: string = ''
  try {
    const hostEntry: string = require.resolve('dsh-log/host')
    installed = JSON.parse(readFileSync(resolve(dirname(dirname(hostEntry)), 'package.json'), 'utf8')).version
  } catch (e) {
    throw new Error('读不出本仓已安装的 dsh-log 版本（先跑 pnpm install）：' + ((e as Error) && (e as Error).message || e))
  }
  if (installed !== declared) {
    throw new Error('日志两半版本不一致：package/package.json 声明 ' + declared + '，本仓已安装的是 ' + installed + '（客户端那半按已安装的这一份打包，宿主那半按声明的版本解析）')
  }
  console.log('[build] 日志两半版本一致：dsh-log@' + installed + '（宿主按包声明解析，客户端按本仓这一份打包）')
}

// #1016 日志系统派生：先把日志包产物派生为运行时文件（旧文件不动），再拼装。
// #586 更新系统派生：同样先把更新包产物派生为运行时文件（旧文件不动）。
// #800 面板派生已切到官方工具：取值唯一来源是已安装的更新包（node_modules/dsh-plugin-update@0.13.x），
//   本构建只做“派生→构建”两步；“升到 0.13.x 最新并提交锁文件”这一步在构建前由人或发版流程执行，
//   构建时不自动联网升级（顺序：最新 0.13.x → 派生 → 构建）。
// 两个包 dist 缺失时会报错并提示先跑各自的 build。
// 两半版本一致的断言放在派生之前：错配当场拦住，不留给运行时（理由见上面那条注释）。
assertLogHalvesVersionMatch()
pulseBuildLock(buildLock)
try {
  deriveClient()
} catch (e) {
  throw new Error('[build] 日志派生失败（取值来源是已安装的日志包：先确认 pnpm install 已装好 dsh-log@^0.2.2，再重跑本构建）：' + ((e as Error) && (e as Error).message || e))
}
try {
  const updVersion: string = deriveUpdateClientVersionForLog()
  console.log(`[build] 更新包面板取值来源：已安装 dsh-plugin-update@${updVersion}（面板派生唯一数据源；打包前应已先升到 0.13.x 最新并提交锁文件）`)
  deriveUpdateClient()
  await bundleEntryPanel()
} catch (e) {
  throw new Error('[build] 更新派生失败（面板取值来源是已安装的更新包：先确认 pnpm install 已装好 dsh-plugin-update@^0.13.0，再重跑本构建）：' + ((e as Error) && (e as Error).message || e))
}

const out: { clientDev?: string; clientPkg?: string; hostDev?: string; hostPkg?: string } = {}
if (!pkgOnly) out.clientDev = (await buildClient({ version, repoUrl })).devCode
if (!devOnly) out.clientPkg = (await buildClient({ version, repoUrl })).pkgCode
if (!pkgOnly) out.hostDev = (await buildHost({ version })).devCode
if (!devOnly) out.hostPkg = (await buildHost({ version })).pkgCode

console.log('[build] OK')
console.log(`  client.js (dev)      ${out.clientDev ? read('client.js').length + ' bytes' : 'skipped'}`)
console.log(`  host.js (dev)        ${out.hostDev ? read('host.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/client.js (pkg) ${out.clientPkg ? read('package/lib/client.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/index.js (pkg)  ${out.hostPkg ? read('package/lib/index.js').length + ' bytes' : 'skipped'}`)
// 与缓存命中路径的日志分清（#1325 验收判据）：命中时打的是「缓存命中：…没有写任何产物文件」，
// 这一行只在真构建时出现，看日志的人能直接分出「这次真的重建并写盘了」与「只是命中缓存没写盘」。
// 带 --dev-only / --pkg-only 时只构建其中一类产物、另一类显示 skipped，所以措辞按「本次构建范围」说，不冒充全部产物。
console.log('[build] 完整构建：本次要构建的产物已重新生成并写盘（缓存命中时整个构建跳过，产物一个字节都不会被写）')

// A 自检（build 后）：产物必须带横幅
gateBuildArtifacts()

// 本地同步已于 1.8.0-rc.1 彻底移除：构建永不读写本机已装配置（不碰 HOME 下的
// .dsh/profiles）。历史上的 --sync / DSW_SYNC=1 在这里直接报错，避免一次编译
// 顺手改掉本机 DSH 环境；新版本一律由人自己升级。
if (args.includes('--sync') || args.includes('--no-sync') || process.env.DSW_SYNC === '1' || process.env.DSW_NO_SYNC === '1') {
  throw new Error('[build] 本地同步已取消：构建不再支持 --sync（也不再读取 DSW_SYNC），新版本请走市场升级、软件内升级或自己敲安装命令')
}
console.log('[build] 构建只写仓库内产物，不碰本机已装配置')

// 走到这里说明这一遍是真构建、而且成功了：记下输入指纹与产物哈希，供下一次比对（下一次若一致就跳过构建）。
writeBuildCache()
// 真构建写完了，放锁：等锁的人拿到锁后会先复核缓存（一般直接命中退出，不用再建一遍）。
releaseBuildLock(buildLock)