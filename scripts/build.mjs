/**
 * scripts/build.mjs — T0 阶段 0 构建管线（先把内置 TypeScript 核逐个转译，再 esbuild 双 entry）
 *
 * 第 0 步（#629）：把仓库根 label-color-core/ 里的内置 TypeScript 逐文件转译进
 *   src/shared/label-color/，并跑一次类型检查。这一步由本文件在派生步骤之前调用，
 *   为的是让「改一行代码到看见效果」仍然只有一条命令 node scripts/build.mjs。
 *
 * 规范方言 = 动态版方言（src/client/index.js / src/host/index.js，host/styles/React/timer 为自由变量）。
 * 一源出两物：
 *   _dev → 根 client.js / host.js（cordis_define 函数体形态，须过 precheckCode）
 *   _pkg → package/lib/client.js / package/lib/index.js（ModuleLoader / ESM 形态，pkg entry 提供 shim）
 *
 * seam（src/seam/*）：B1 runtime / B2 style / B3 rpc / B4 timer / B5 editor / B6 sidebar + G 门禁。
 * pkg 产物 = 规范源函数体（逐字保留）+ 工厂壳 + seam shim 词法绑定 —— 文本组合而非 esbuild 重写，
 * 因此 verify-* 的文本特征断言（zIndex: 2147483000、单引号、const L = { 等）保持不变。
 *
 * 门禁（G）：
 *   - dev 产物：precheckCode 包装编译（等价宿主 (async () => {code})() 校验）
 *   - pkg 产物：vm 编译 + __ModuleLoader__ 特征 + 单组件单声明
 *   - DSW_VERSION：从 package/package.json 注入（__DSW_VERSION__ 占位符替换）
 *
 * 用法：node scripts/build.mjs [--dev-only|--pkg-only] [--out-dir DIR]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync, utimesSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import * as esbuild from 'esbuild'
import { deriveHost, deriveClient } from './derive-log-from-package.mjs'
import { deriveHost as deriveUpdateHost, deriveClient as deriveUpdateClient } from './derive-update-from-package.mjs'

// #629 配色核心（label-color-core/）：转译与类型检查都写在它自己的 build.mjs 里，
// 这里只负责在一条命令里把它带上。为什么要写成「先试着加载、加载不到只打印一行提示」，
// 而不是文件头的静态 import：那棵源码树不进 npm 包（package/package.json 的 files
// 白名单里没有它），在只有 scripts/ 与 shared/ 的子树里跑构建时，静态 import 会在加载
// 阶段直接抛错，把整个构建打断，连一行提示都打不出来。这里要的是「这一步跳过、其余照跑」。
let buildLabelColorCore = null
try {
  buildLabelColorCore = (await import('../label-color-core/build.mjs')).buildAll
} catch (e) {
  console.log('[build] 没能加载 label-color-core/build.mjs（' + ((e && e.message) || e) + '），本次构建跳过内置 TypeScript 核的转译与类型检查。')
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 工具 ----------
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const write = (p, content) => {
  const abs = resolve(ROOT, p)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** 从规范源模块提取插件对象函数体（export default { ... } 的 `{ ... }` 部分，含 apply 方法）。
 *  插件对象 = export default 之后到文件末尾的内容（规范源约定：对象闭合是文件最后一个 `}`）。 */
function extractPluginBody(srcPath) {
  const src = read(srcPath)
  const marker = 'export default {'
  const idx = src.indexOf(marker)
  if (idx < 0) throw new Error(`${srcPath}: 找不到 export default {`)
  const start = idx + marker.length - 1 // 指向 {
  const end = src.lastIndexOf('}') // 对象闭合 = 文件末尾的 }
  if (end < start) throw new Error(`${srcPath}: 找不到对象闭合`)
  return {
    header: src.slice(0, idx).replace(/\s+$/, ''), // 头注释
    body: src.slice(start, end + 1), // { apply(ctx) {...} }
  }
}

// ---------- seam shim 文本（pkg 方言绑定） ----------
/** B3 rpc + B2 style + B4 timer 的 pkg 方言 shim（工厂壳内词法绑定，源函数体的自由变量解析到它们）。 */
const PKG_CLIENT_SHIMS = `    // ===================== seam shims（pkg 方言绑定 · B3 rpc / B2 style / B4 timer） =====================
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
const PKG_HOST_PREAMBLE = `// ===================== seam shims（pkg 方言绑定 · B3 rpc host 侧） =====================
const __DSW_HANDLERS__ = new Map()
const harness = {
  handle: (method, fn) => {
    const endpoint = method.replace(/^wf\\./, '')
    __DSW_HANDLERS__.set(endpoint, fn)
  }
}
`

// ---------- 版本注入 ----------
function dswVersion() {
  const pkg = JSON.parse(read('package/package.json'))
  return 'v' + pkg.version
}

/** 仓库主页 URL（#repo-link）：package/package.json 的 repository 字段（string 或 {url}），
 *  去 git+ 前缀与 .git 后缀。版本号可点跳转的单一真源；客户端源码只有 __DSW_REPO_URL__ 占位符，
 *  无 URL 字面量（过硬编码门禁 F2），产物中的字面量已在门禁 RE_LICENSED 登记。 */
function dswRepoUrl() {
  const pkg = JSON.parse(read('package/package.json'))
  const r = pkg.repository
  const raw = typeof r === 'string' ? r : (r && r.url) || ''
  const url = String(raw).replace(/^git\+/, '').replace(/\.git$/, '')
  if (!url) throw new Error('[build] package/package.json 缺 repository 字段，__DSW_REPO_URL__ 注入无源')
  return url
}

function injectVersion(body, version, repoUrl) {
  return body.split('__DSW_VERSION__').join(`'${version}'`).split('__DSW_REPO_URL__').join(`'${repoUrl}'`)
}

// ---------- 说明同步（单说明源头 · #479 最简收口） ----------
/** 根 README.md 为唯一源头；package/README.md 为构建生成物（npm 页面展示用），禁止手改。
 *  生成时只做四类机械替换（正文一字不动）：相对图片转仓库绝对地址（npm 包内无
 *  assets 目录）、相对文档链接转仓库绝对地址、版本 pin 跟随当前版本。
 *  注意：'1.7.14' 字面在此充当版本槽位（源头里所有出现处均为现行版本引用）；
 *  若未来正文出现历史版本号行，请改写措辞避开该字面。
 *  tests/verify-readme-sync.js 按同口径断言，手改生成物即红。 */
const readmeAutogenBanner = (version) => `<!-- AUTO-GENERATED by scripts/build.mjs — DO NOT EDIT. Source: ../README.md @ ${version} -->\n\n`
function readmeForNpm(rootMd, version, repoUrl) {
  const verNum = String(version).replace(/^v/, '')
  const base = String(repoUrl).replace(/\/$/, '')
  const rawBase = base + '/raw/main/'
  const blobBase = base + '/blob/main/'
  return rootMd
    .split('src="assets/').join(`src="${rawBase}assets/`)
    .split('](assets/').join(`](${rawBase}assets/`)
    .split('](docs/').join(`](${blobBase}docs/`)
    .split('(docs/').join(`(${blobBase}docs/`)
    .split('1.7.14').join(verNum)
}
function syncReadme(version, repoUrl) {
  const out = readmeAutogenBanner(version) + readmeForNpm(read('README.md'), version, repoUrl)
  write('package/README.md', out)
  console.log(`[build] README 已同步 package/README.md（${out.length} bytes，源头 README.md）`)
}

// ---------- 门禁（G） ----------
function gatePrecheck(code, label) {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    if (process.env.DSH_PRECHECK_LOC) console.error('LOC '+label+' :: '+(e.stack||'').split('\n').slice(1,3).join(' | '))
    throw new Error(`[G门禁] ${label} precheckCode 失败：${e.message}`)
  }
}
function gateSyntax(code, label) {
  // ESM（export）用 esbuild 校验语法（可解析 module 语法）；其余用 vm.Script。
  if (/\bexport\b/.test(code)) {
    return esbuild.transform(code, { loader: 'js', format: 'esm' }).then(() => true).catch((e) => {
      throw new Error(`[G门禁] ${label} 语法编译失败：${e.message}`)
    })
  }
  try {
    new vm.Script(code, { filename: `gate-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} 语法编译失败：${e.message}`)
  }
  return true
}
function gateModuleLoader(code, label) {
  if (!code.includes('window.__ModuleLoader__.load')) {
    throw new Error(`[G门禁] ${label} 缺 __ModuleLoader__ 特征`)
  }
}
function gateSingleDeclaration(code, label, names) {
  for (const name of names) {
    const re = new RegExp(`(?:const|function|var)\\s+${name}\\s*[=(]`, 'g')
    const hits = code.match(re) || []
    if (hits.length > 1) throw new Error(`[G门禁] ${label} ${name} 声明 ${hits.length} 次（应恰好 1 次）`)
  }
}

// ---------- Ctx 模块组合（阶段 2 步骤 1 · #95） ----------
/** 从 src/client/kernel/ctx.js 提取声明体（去每行行首 export 关键字）。
 *  注入 client 插件对象 apply 闭包顶部 —— 双产物同构，一源两物（与 seam shims 同模式）。 */
function extractCtxBlock() {
  return read('src/client/kernel/ctx.js')
    .split('\n')
    .map((l) => l.replace(/^export\s+/, ''))
    .join('\n')
    .trim()
}
function wireCtx(body) {
  const marker = 'apply(ctx) {'
  const idx = body.indexOf(marker)
  if (idx < 0) throw new Error('src/client/index.js 找不到 apply(ctx) { 注入点（Ctx 接线失败）')
  return body.slice(0, idx + marker.length) + '\n' + extractCtxBlock() + '\n' + body.slice(idx + marker.length)
}

// ---------- Kernel 模块组合（阶段 2 内核迁移 · #96 T3）----------
/** 内核模块清单（docs/architecture/kernel-contract.md · G3 冻结 · 迁移完成即全活跃）。
 *  index.js 中每模块原位置留标记 `// ==== kernel:<name> (spliced by build) ====`，
 *  构建时把模块文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化。 */
const KERNEL_MODULES = [
  { name: 'backendList', file: 'src/client/kernel/builtin-backends.js' },
  { name: 'link', file: 'src/client/kernel/link.js' },
  { name: 'styles', file: 'src/client/kernel/styles.js' },
  { name: 'portal', file: 'src/client/kernel/portal.js' },
  { name: 'localePanel', file: 'src/client/kernel/locale-panel.js' },
  { name: 'localeFlow', file: 'src/client/kernel/locale-flow.js' },
  { name: 'localeWord', file: 'src/client/kernel/locale-word.js' },
  // #621 标签配色弹窗的中英词条：单独一份片段，由 locale.js 的合并器一起并进 L
  { name: 'localeLabels', file: 'src/client/kernel/locale-labels.js' },
  { name: 'locale', file: 'src/client/kernel/locale.js' },
  { name: 'icons', file: 'src/client/kernel/icons.js' },
  { name: 'prompts', file: 'src/client/kernel/prompts.js' },
  { name: 'config', file: 'src/client/kernel/config.js' },
  // #586 切更新包：面板要用的电话名与轮询间隔由更新包派生（改名或改间隔只改包，不在这里写死）
  { name: 'updateClient', file: 'scripts/generated/updateClient.derived.js' },
  { name: 'log', file: 'scripts/generated/logKernel.derived.js' },
  // 构建内核清单含日志模块（旧真源 src/client/kernel/log.js 原地只读留存，运行时拼入上面的派生文件，#564 留而不搬）
  { name: 'storePrefs', file: 'src/client/kernel/store-prefs.js' },
  { name: 'storeSwitch', file: 'src/client/kernel/store-switch.js' },
  { name: 'storeSnapshot', file: 'src/client/kernel/store-snapshot.js' },
  { name: 'storeDerived', file: 'src/client/kernel/store-derived.js' },
  { name: 'apiNaming', file: 'src/client/kernel/api-naming.js' },
  { name: 'apiPresetGuard', file: 'src/client/kernel/api-preset-guard.js' },
  { name: 'apiNewSession', file: 'src/client/kernel/api-new-session.js' },
  { name: 'apiIo', file: 'src/client/kernel/api-io.js' },
  { name: 'actions', file: 'src/client/kernel/actions.js' },
  { name: 'slots', file: 'src/client/kernel/slots.js' },
  { name: 'slotRendererQueue', file: 'src/client/kernel/slotRenderer-queue.js' },
  { name: 'slotRendererRepoSync', file: 'src/client/kernel/slotRenderer-repo-sync.js' },
  { name: 'slotRendererModalView', file: 'src/client/kernel/slotRenderer-modal-view.js' },
  { name: 'probeChain', file: 'src/client/kernel/probe-chain.js' },
  { name: 'probeSnapshot', file: 'src/client/kernel/probe-snapshot.js' },
  { name: 'probeAuto', file: 'src/client/kernel/probe-auto.js' },
  { name: 'router', file: 'src/client/kernel/router.js' },
]

// ---------- 共享核心拼装（一源两物 · #265）----------
/** 共享纯函数模块（src/shared/*）：host 半运行时 import()；client 半按与 kernel 同模式的
 *  标记拼回闭包 —— 原文零复制（去行首 export），两半共用同一份实现文本，无第二处命名真源。
 *  shared-0（#443）接线结论：下面各项与 src/client/index.js 里拼接标记一一对应，已经对齐；
 *  chain 系与 check-catalog 系只被 host 半在运行时引用，client 半没有运行时引用，
 *  所以不进拼接清单，S1/S3 拆分时不新设拼接标记；naming-guardian.js（498 行）两半都要用，
 *  S2（#452）已拆成标题、跟踪、归属 3 个文件，此处记 3 个拼接项与 3 个标记位（做法见 #443 票内接线图）。
 *  跟踪与归属文件内复刻的标题小函数改了名前缀，拼回同一个界面闭包时不与标题文件重名。 */
const SHARED_SPLICE = [
  // effort 维度（2026-09-09）：票身份算法（effortOf / idOf / idOfParts）与常量同住 constants.js，
  // 面板侧要按 (effort, 编号) 定位，故把这份零依赖叶子一并拼进界面闭包（host 半走 import，同源同文本）。
  { marker: '// ==== shared:trackerConstants (spliced by build) ====', file: 'src/shared/tracker/constants.js' },
  { marker: '// ==== shared:namingTitles (spliced by build) ====', file: 'src/shared/naming-titles.js' },
  { marker: '// ==== shared:namingTracking (spliced by build) ====', file: 'src/shared/naming-tracking.js' },
  { marker: '// ==== shared:namingAttribution (spliced by build) ====', file: 'src/shared/naming-attribution.js' },
  { marker: '// ==== shared:trackerSync (spliced by build) ====', file: 'src/shared/tracker/sync.js' },
  { marker: '// ==== shared:slots (spliced by build) ====', file: 'src/shared/ui/slots.js' },
  { marker: '// ==== shared:mattSkills (spliced by build) ====', file: 'src/shared/matt-skills.js' },
  { marker: '// ==== shared:workspaceKey (spliced by build) ====', file: 'src/shared/workspaceKey.js' },
  // #629 配色核心的两个产物：宿主半走普通相对 import，客户端半要按同一份口径判断
  // 用户填的颜色能不能用、颜色有没有变，所以把这两份零依赖产物一并拼进界面闭包。
  // 它们的顶层名字由 tests/verify-generated-no-shadow.js 与既有的派生文件一起比对，
  // 产物里不许出现 __DSW_VERSION__ 与 __DSW_REPO_URL__（拼接发生在版本注入之后）。
  { marker: '// ==== shared:labelColors (spliced by build) ====', file: 'src/shared/label-color/colors.js' },
  { marker: '// ==== shared:labelColorPrompt (spliced by build) ====', file: 'src/shared/label-color/prompt.js' },
]

// ---------- 叶子模块组合（阶段 2 叶子迁移 · #97 T4）----------
/** 叶子组件模块清单（G3 共享 → views/shared/ · G4 严格一文件 ≤350 行）。
 *  与 kernel 同模式：index.js 中原位置留标记 `// ==== leaf:<id> (spliced by build) ====`，
 *  构建时把叶子文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化；
 *  组件经 React.useContext(DswsCtx) 消费 cx（ARCHITECTURE-CTX.md §2）。 */
const LEAF_MODULES = [
  { id: 'chips', file: 'src/client/views/shared/chips.js' },
  { id: 'hoverTip', file: 'src/client/views/primitives/HoverTip.js' },
  { id: 'tip', file: 'src/client/views/primitives/Tip.js' },
  { id: 'backendSelector', file: 'src/client/views/shared/BackendSelector.js' },
  { id: 'switchConfirmModal', file: 'src/client/views/shared/SwitchConfirmModal.js' },
  // #621 标签配色的五个叶子（纯函数两份 + 状态机一份 + 界面三份；按拼接次序登记，次序即依赖次序）
  { id: 'labelColorErrors', file: 'src/client/views/labels/labelColorErrors.js' },
  { id: 'useLabelColors', file: 'src/client/views/labels/useLabelColors.js' },
  { id: 'labelColorRow', file: 'src/client/views/labels/LabelColorRow.js' },
  { id: 'labelColorDialog', file: 'src/client/views/labels/LabelColorDialog.js' },
  { id: 'labelColorEntry', file: 'src/client/views/labels/LabelColorEntry.js' },
  { id: 'md', file: 'src/client/views/shared/md.js' },
  { id: 'ticket', file: 'src/client/views/shared/ticket.js' },
  { id: 'stateKind', file: 'src/client/views/shared/stateKind.js' }, // #599 新增：票的状态判据（打开/已关闭/已合并）单源，拉取请求页与单票详情页共用一个函数
  { id: 'tagsFit', file: 'src/client/views/shared/tagsFit.js' },
  { id: 'tabs', file: 'src/client/views/shared/Tabs.js' },
  { id: 'ticketRow', file: 'src/client/views/TicketRow.js' },
  { id: 'mapDetail', file: 'src/client/views/MapDetail.js' },
  { id: 'IssueDetailComments', file: 'src/client/views/IssueDetailComments.js' },
  { id: 'IssueDetail', file: 'src/client/views/IssueDetail.js' },
  { id: 'noRepoCard', file: 'src/client/views/NoRepoCard.js' },
  { id: 'ListTabRow', file: 'src/client/views/ListTabRow.js' },
  { id: 'listTab', file: 'src/client/views/ListTab.js' },
  { id: 'prTab', file: 'src/client/views/PrTab.js' },
  { id: 'ringSkills', file: 'src/client/views/RingSkills.js' },
  { id: 'skillsTab', file: 'src/client/views/SkillsTab.js' },
  { id: 'checksTab', file: 'src/client/views/ChecksTab.js' },
  { id: 'SettingsWorkspaces', file: 'src/client/views/SettingsWorkspaces.js' },
  { id: 'debugSwitchFailHint', file: 'src/client/views/shared/DebugSwitchFailHint.js' }, // #597 由 SettingsPage.js 拆出：写开关失败的机器码挑提示词条（无组件，纯函数）
  { id: 'updateDialog', file: 'src/client/views/UpdateDialog.js' }, // #587 由 SettingsPage.js 拆出：检查更新的浮层弹窗（组件）
  { id: 'updateRestartBanner', file: 'src/client/views/UpdateRestartBanner.js' }, // #587 新增：装完待重启的常驻提示行（组件）
  { id: 'useUpdatePanel', file: 'src/client/views/useUpdatePanel.js' }, // #587 由 SettingsPage.js 拆出：检查更新的状态与电话调用（钩子，无组件）
  { id: 'settingsPage', file: 'src/client/views/SettingsPage.js' },
  { id: 'runPanel', file: 'src/client/views/RunPanel.js' },
  { id: 'DockSync', file: 'src/client/panel/DockSync.js' },
  { id: 'dock', file: 'src/client/panel/Dock.js' },
  { id: 'namingFailBanner', file: 'src/client/panel/NamingFailBanner.js' },
  { id: 'OverlayGate', file: 'src/client/panel/OverlayGate.js' },
  { id: 'overlay', file: 'src/client/panel/Overlay.js' },
  { id: 'seg', file: 'src/client/statusbar/Seg.js' },
  { id: 'checksums', file: 'src/client/statusbar/checksums.js' },
  { id: 'StatusMenus', file: 'src/client/statusbar/StatusMenus.js' },
  { id: 'StatusBackend', file: 'src/client/statusbar/StatusBackend.js' },
  { id: 'StatusLogMenu', file: 'src/client/statusbar/StatusLogMenu.js' },
  { id: 'statusBar', file: 'src/client/statusbar/StatusBar.js' },
  { id: 'chainRenderer', file: 'src/client/views/shared/ChainRenderer.js' },
  { id: 'skillFloatList', file: 'src/client/floating/SkillFloatList.js' },
  { id: 'pop', file: 'src/client/floating/Pop.js' },
  { id: 'hostShim', file: 'src/client/hostShim.js' }, // #459 由 index.js 拆出：宿主适配垫片（timer 兜底加旧标签迁移）
  { id: 'panelAssembly', file: 'src/client/panelAssembly.js' }, // #459 由 index.js 拆出：面板装配（Ctx 装配加插槽注册加启动收尾）
]
function extractModuleBlock(file) {
  return read(file).split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n').trim()
}
function wireModules(body) {
  let out = body
  for (const m of KERNEL_MODULES) {
    const marker = `// ==== kernel:${m.name} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 KERNEL_MODULES 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  for (const m of LEAF_MODULES) {
    const marker = `// ==== leaf:${m.id} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 LEAF_MODULES 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  for (const m of SHARED_SPLICE) {
    const marker = m.marker
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 SHARED_SPLICE 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  // 反向检查：src 下有叶子文件却未在 LEAF_MODULES 登记（比“忘贴纸条”更隐蔽）
  try {
    const leafFiles = []
    const walk = (dir) => {
      const abs = resolve(ROOT, dir)
      if (!existsSync(abs)) return
      for (const ent of readdirSync(abs, { withFileTypes: true })) {
        const rel = dir + '/' + ent.name
        const absEnt = resolve(ROOT, rel)
        if (ent.isDirectory()) walk(rel)
        else if (ent.isFile() && rel.endsWith('.js')) leafFiles.push(rel)
      }
    }
    walk('src/client/views'); walk('src/client/panel'); walk('src/client/statusbar'); walk('src/client/floating')
    const registered = new Set(LEAF_MODULES.map(m => m.file))
    for (const f of leafFiles) {
      if (!registered.has(f)) throw new Error(`[build] ${f} 未在 LEAF_MODULES 登记 — 新加叶子需在 LEAF_MODULES 加一项并在 src/client/index.js 加 // ==== leaf:<id> ==== 标记`)
    }
  } catch (e) {
    if (e && e.message && e.message.startsWith('[build]')) throw e
  }
  return out
}

// ---------- 构建 client ----------
async function buildClient({ version, repoUrl }) {
  const { header, body } = extractPluginBody('src/client/index.js')
  const bodyW = wireCtx(wireModules(injectVersion(body, version, repoUrl)))
  // 根产物降级声明（G1 · T5 #98）：client.js/host.js 为构建产物，人手不碰
  const devBanner = `// AUTO-GENERATED by scripts/build.mjs — DO NOT EDIT. Source: src/client/index.js + kernel/* + leaves/* (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mjs 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态 ----
  const devCode = `${devBanner}${header}\n\nreturn ${bodyW}\n`
  gatePrecheck(devCode, 'client-dev')
  write('client.js', devCode)

  // ---- _pkg：ModuleLoader 工厂壳 + seam shims ----
  const pkgCode = `${header}

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
  gateSingleDeclaration(pkgCode, 'client-pkg', ['StatusBar', 'DetailsDock', 'OverlayPanel', 'SettingsPage', 'RunPanel', 'IssueDetail'])
  write('package/lib/client.js', pkgCode)
  return { devCode, pkgCode }
}

// ---------- 构建 host（方案 C 原样复制 · #136/#172） ----------
async function buildHost({ version }) {
  const { header, body } = extractPluginBody('src/host/index.js')
  const hostDevBanner = `// AUTO-GENERATED by scripts/build.mjs — DO NOT EDIT. Source: src/host/index.js (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mjs 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态（保留，host.js 不在发布包，#172 不碰其函数体）----
  const devCode = `${hostDevBanner}${header}\n\nreturn ${body}\n`
  gatePrecheck(devCode, 'host-dev')
  write('host.js', devCode)

  // ---- _pkg：原样复制（零打包）—— src/host 整树 → package/lib, src/shared → package/shared ----
  // 幂等清理：先清旧产物再复制，确保双向差集 0；lib/client.js 工厂壳由 buildClient 负责，不在此删
  const pkgLib = resolve(ROOT, 'package/lib')
  const pkgShared = resolve(ROOT, 'package/shared')
  // 清理 package/lib 下的 host 树（保留 lib/client.js）
  const toRemove = [
    join(pkgLib, 'index.js'),
    join(pkgLib, 'platform'),
    join(pkgLib, 'tracker'),
  ]
  for (const p of toRemove) {
    try { rmSync(p, { recursive: true, force: true }) } catch {}
  }
  try { rmSync(pkgShared, { recursive: true, force: true }) } catch {}
  mkdirSync(pkgLib, { recursive: true })
  mkdirSync(pkgShared, { recursive: true })
  // 复制 src/host → package/lib（逐文件 sha256 一致）
  const srcHost = resolve(ROOT, 'src/host')
  // Node 16.7+ cpSync 原生支持；fall back 手写
  const copyOpts = { recursive: true, force: true }
  try {
    if (typeof cpSync === 'function') {
      // 复制 src/host/* 到 package/lib/*
      const entries = readdirSync(srcHost, { withFileTypes: true })
      for (const ent of entries) {
        const s = join(srcHost, ent.name)
        const d = join(pkgLib, ent.name)
        cpSync(s, d, copyOpts)
      }
      cpSync(resolve(ROOT, 'src/shared'), pkgShared, copyOpts)
    } else {
      throw new Error('cpSync unavailable')
    }
  } catch (e) {
    // fallback 手写递归
    function cpRecur(src, dst) {
      const st = statSync(src)
      if (st.isDirectory()) {
        mkdirSync(dst, { recursive: true })
        for (const ent of readdirSync(src)) cpRecur(join(src, ent), join(dst, ent))
      } else {
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(src))
      }
    }
    const entries = readdirSync(srcHost, { withFileTypes: true })
    for (const ent of entries) cpRecur(join(srcHost, ent.name), join(pkgLib, ent.name))
    cpRecur(resolve(ROOT, 'src/shared'), pkgShared)
  }
  // 校验：package/lib/index.js 必须与 src/host/index.js 逐字节一致（零打包不变量）
  try {
    const a = readFileSync(resolve(ROOT, 'src/host/index.js'), 'utf8')
    const b = readFileSync(join(pkgLib, 'index.js'), 'utf8')
    if (a !== b) throw new Error('package/lib/index.js 与 src/host/index.js 不一致（原样复制失败）')
  } catch (e) {
    throw new Error(`[build] 原样复制校验失败：${e.message}`)
  }
  // #586 更新包派生副本：src/host/updatePkg/* → package/lib/updatePkg/*（逐文件原样，包内相对引用保持有效）
  {
    const srcUpdatePkg = resolve(ROOT, 'src/host/updatePkg')
    const dstUpdatePkg = join(pkgLib, 'updatePkg')
    try { rmSync(dstUpdatePkg, { recursive: true, force: true }) } catch {}
    mkdirSync(dstUpdatePkg, { recursive: true })
    const names = readdirSync(srcUpdatePkg)
    for (const name of names) {
      const from = join(srcUpdatePkg, name)
      const to = join(dstUpdatePkg, name)
      writeFileSync(to, readFileSync(from))
      const a = readFileSync(from, 'utf8')
      const b = readFileSync(to, 'utf8')
      if (a !== b) throw new Error(`[build] updatePkg/${name} 原样复制不一致`)
    }
    console.log(`[build] 更新包派生副本已随包 → package/lib/updatePkg（${names.length} 个文件）`)
  }
  // 分发 scripts/：消费者工作区调用的两条脚本随包发布（#588 总指挥裁定：只收两条消费者脚本，
  // 构建/调试脚本（build.mjs、ui-*、wizard-*、generate-*、matrix-*、sync-* 等）不许进发布包；
  // 清单写死在这里并注释原因，不另维护第二份——门禁从这份清单机械求值发布包脚本集合）。
  const SHIPPED_SCRIPTS = ['fix-issue-body.mjs', 'wire-subissues.mjs']
  const pkgScripts = resolve(ROOT, 'package/scripts')
  try { rmSync(pkgScripts, { recursive: true, force: true }) } catch {}
  mkdirSync(pkgScripts, { recursive: true })
  for (const name of SHIPPED_SCRIPTS) {
    writeFileSync(join(pkgScripts, name), readFileSync(join(resolve(ROOT, 'scripts'), name)))
  }
  console.log(`[build] scripts 已随包分发 → package/scripts（${SHIPPED_SCRIPTS.length} 个文件：${SHIPPED_SCRIPTS.join('、')}）`)
  // 触新 mtime：确保产物新鲜度门禁（verify-parse-leaf 检查产物 mtime > 源 mtime），原样复制需显式 touch
  try {
    const now = new Date()
    const touch = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name)
        if (ent.isDirectory()) touch(p)
        else try { utimesSync(p, now, now) } catch {}
      }
    }
    touch(pkgLib)
    touch(pkgShared)
    touch(pkgScripts)
  } catch {}

  // L1 冒烟：构建内 await import('package/lib/index.js') 入口 + node --check 全树
  // --check 全树
  function collectJs(dir) {
    const out = []
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (p.endsWith('.js')) out.push(p)
      }
    }
    if (existsSync(dir)) walk(dir)
    return out
  }
  const allHostJs = collectJs(pkgLib).concat(collectJs(pkgShared))
  for (const f of allHostJs) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`[L1] node --check 失败 ${f}: ${r.stderr || r.stdout}`)
  }
  // 入口 import 冒烟（显式 .js 已在 src 侧保证，此处验证 runtime 解析）
  const entryUrl = pathToFileURL(join(pkgLib, 'index.js')).href
  let mod
  try {
    mod = await import(entryUrl)
  } catch (e) {
    throw new Error(`[L1] import(package/lib/index.js) 失败：${e.message}`)
  }
  // 方案 C：src/host/index.js 为 export default { apply } 默认导出，非命名导出；兼容两种形态
  const hasApply = typeof mod.apply === 'function' || typeof mod.default?.apply === 'function'
  const hasName = typeof mod.name === 'string' || typeof mod.default?.name === 'string'
  if (!mod || !hasApply) {
    throw new Error(`[L1] 入口导出校验失败：hasApply=${hasApply} name=${mod?.name ?? mod?.default?.name} apply=${typeof (mod?.apply ?? mod?.default?.apply)} keys=${Object.keys(mod)}`)
  }
  const dispName = mod.name ?? mod.default?.name ?? '(default)'
  const dispInject = Array.isArray(mod.inject) ? mod.inject.join(',') : Array.isArray(mod.default?.inject) ? mod.default.inject.join(',') : '(default.apply)'
  console.log(`[L1] host pkg 入口冒烟通过：name=${dispName} inject=${dispInject} apply=function`)

  const pkgCode = readFileSync(join(pkgLib, 'index.js'), 'utf8')
  return { devCode, pkgCode }
}

// ---------- 产物自检（风险A） ----------
function gateBuildArtifacts() {
  for (const p of ['client.js', 'host.js']) {
    if (existsSync(resolve(ROOT, p))) {
      const txt = read(p)
      if (!txt.startsWith('// AUTO-GENERATED')) {
        console.warn(`[warn] ${p} 缺 AUTO-GENERATED 横幅 — 可能为手改产物，下次 build 将被覆盖`)
      }
    }
  }
}

// ---------- 捆绑技能存在性检查（#388 T1 · G2 定版：目录直铺 25，空目录期跳过校验） ----------
function ensureBundledSkills() {
  const bundledDir = resolve(ROOT, 'package/bundled-skills')
  if (!existsSync(bundledDir)) {
    console.warn('[build] 警告：package/bundled-skills 不存在，跳过捆绑校验（早期分支容忍）。请运行 node scripts/sync-matt-skills.mjs --pin v1.2.3 --verify 同步')
    return
  }
  const entries = readdirSync(bundledDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  if (entries.length !== 25) {
    console.warn(`[build] 警告：bundled-skills 期望 25 项，当前 ${entries.length} 项（可能未同步完成）`)
  }
  // 轻量校验：每项含 SKILL.md 且 frontmatter name 与目录一致（与 verify-bundled-skills 同口径，失败仅 warn 不阻断 build）
  for (const name of entries) {
    const mdPath = join(bundledDir, name, 'SKILL.md')
    if (!existsSync(mdPath)) {
      console.warn(`[build] 警告：${name}/SKILL.md 缺失`)
      continue
    }
    try {
      const md = readFileSync(mdPath, 'utf8')
      const m = md.match(/^name:\s*(.+)$/m)
      const fm = m ? m[1].trim().replace(/^[\'\"]|[\'\"]$/g, '') : ''
      if (fm && fm !== name) console.warn(`[build] 警告：${name}/SKILL.md name:${fm} ≠ 目录名`)
    } catch {}
  }
  const verPath = join(bundledDir, 'VERSION')
  const licPath = join(bundledDir, 'LICENSE')
  if (!existsSync(verPath)) console.warn('[build] 警告：bundled-skills/VERSION 缺失')
  if (!existsSync(licPath)) console.warn('[build] 警告：bundled-skills/LICENSE 缺失')
}

// ---------- main ----------

const args = process.argv.slice(2)
const devOnly = args.includes('--dev-only')
const pkgOnly = args.includes('--pkg-only')
const version = dswVersion()
const repoUrl = dswRepoUrl()
console.log(`[build] DSW_VERSION=${version} (package/package.json)`)
console.log(`[build] DSW_REPO_URL=${repoUrl} (package/package.json repository)`)

// A 自检（build 前）：若产物存在但无横幅，给 warn（不阻断，防旧产物）
gateBuildArtifacts()
ensureBundledSkills()
syncReadme(version, repoUrl)

// #629 内置 TypeScript 核（配色核心）：先转译再跑类型检查，产物落进 src/shared/label-color/。
// 它自己会判源码目录在不在（发布包与 package/ 子树里没有这棵源码树），不在就跳过并打印提示。
// 放在两段派生之前：产物是客户端闭包的输入，必须比闭包先就位。
if (buildLabelColorCore) buildLabelColorCore()

// #564 日志系统派生：先把日志包产物派生为运行时文件（旧文件不动），再拼装。
// #586 更新系统派生：同样先把更新包产物派生为运行时文件（旧文件不动）。
// 两个包 dist 缺失时会报错并提示先跑各自的 build。
try {
  deriveHost()
  deriveClient()
} catch (e) {
  throw new Error('[build] 日志派生失败（先跑 node packages/dsh-log/build.mjs 再重跑本构建）：' + ((e && e.message) || e))
}
try {
  deriveUpdateHost()
  deriveUpdateClient()
} catch (e) {
  throw new Error('[build] 更新派生失败（先跑 node packages/dsh-plugin-update/build.mjs 再重跑本构建）：' + ((e && e.message) || e))
}

const out = {}
if (!pkgOnly) out.clientDev = (await buildClient({ version, repoUrl })).devCode
if (!devOnly) out.clientPkg = (await buildClient({ version, repoUrl })).pkgCode
if (!pkgOnly) out.hostDev = (await buildHost({ version })).devCode
if (!devOnly) out.hostPkg = (await buildHost({ version })).pkgCode

console.log('[build] OK')
console.log(`  client.js (dev)      ${out.clientDev ? read('client.js').length + ' bytes' : 'skipped'}`)
console.log(`  host.js (dev)        ${out.hostDev ? read('host.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/client.js (pkg) ${out.clientPkg ? read('package/lib/client.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/index.js (pkg)  ${out.hostPkg ? read('package/lib/index.js').length + ' bytes' : 'skipped'}`)

// A 自检（build 后）：产物必须带横幅
gateBuildArtifacts()

// C 自动同步（默认同步，--no-sync 可跳过）
if (!args.includes('--no-sync')) {
  // 同步为 async 需 await，main 已在顶层 async 上下文（文件整体为 ESM，顶层 await 可用）
  const _home = process.env.HOME || process.env.USERPROFILE || ''
  if (_home) {
    try {
      // 2026-09-11 现场修复：以前只同步 web 这一个 profile，而界面完全可能跑在别的 profile 上
      //   （桌面应用用的是 desktop），于是「源码改了、构建也过了」，用户复制出来的提示词却还是旧的。
      //   现在把「装了本插件的 profile」全部同步，一个不漏。
      const profilesDir = resolve(_home, '.dsh/profiles')
      const targets = []
      try {
        for (const ent of readdirSync(profilesDir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const base = resolve(profilesDir, ent.name, 'node_modules/dsh-mattpocock-skills-deck')
          if (existsSync(base)) targets.push(base)
        }
      } catch (eEnum) { /* 目录不存在或读不了，走下面的空表提示 */ }
      if (!targets.length) console.warn('[build] 没找到任何装过本插件的 profile，跳过同步（装过的才会被同步）')
      for (const profileBase of targets) {
        // 整树同步 package/lib、package/shared 与 package/scripts（#545：只同步两个文件会漏掉宿主新增模块，
        // 注册了电话但缺模块文件，调用时动态导入失败；与“原样复制”哲学一致，只增不删）。
        // scripts 随包分发；#603 起提示词改走 gh 直连写法，脚本作为可选工具仍在包里。
        for (const tree of ['lib', 'shared', 'scripts']) {
          const srcDir = resolve(ROOT, 'package', tree)
          const dstDir = resolve(profileBase, tree)
          if (!existsSync(srcDir)) continue
          mkdirSync(dstDir, { recursive: true })
          const syncRecur = (s, d) => {
            for (const ent of readdirSync(s, { withFileTypes: true })) {
              const ps = join(s, ent.name)
              const pd = join(d, ent.name)
              if (ent.isDirectory()) {
                mkdirSync(pd, { recursive: true })
                syncRecur(ps, pd)
              } else if (ent.isFile()) {
                writeFileSync(pd, readFileSync(ps))
              }
            }
          }
          syncRecur(srcDir, dstDir)
        }
        console.log(`[build] 已同步 profile → ${profileBase}`)
        // hash 校验（入口加动态导入的更新模块，缺一个就红；随包分发的两条消费者脚本同口径抽查）
        try {
          const pairs = [['package/lib/client.js', 'lib/client.js'], ['package/lib/index.js', 'lib/index.js'], ['package/lib/update.js', 'lib/update.js'], ['package/scripts/fix-issue-body.mjs', 'scripts/fix-issue-body.mjs'], ['package/scripts/wire-subissues.mjs', 'scripts/wire-subissues.mjs']]
          let mismatch = ''
          for (const [srcRel, dstRel] of pairs) {
            const a = readFileSync(resolve(ROOT, srcRel), 'utf8')
            const b = readFileSync(resolve(profileBase, dstRel), 'utf8')
            if (a !== b) mismatch += dstRel + ' '
          }
          if (mismatch) console.warn('[build] profile 同步 hash 不一致：' + mismatch)
          else console.log('[build] profile 同步 hash 校验通过')
        } catch {}
      }
    } catch (e) {
      console.warn('[build] profile 同步跳过:', e.message)
    }
  }
} else {
  console.log('[build] --no-sync 已跳过 profile 同步')
}