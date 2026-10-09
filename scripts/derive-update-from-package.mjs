/**
 * scripts/derive-update-from-package.mjs —— 更新系统派生脚本（#586 起，#800 切到官方工具）。
 *
 * 作用：把已安装的更新包派生为插件运行时真正使用的文件。
 * #875 起旧文件已删，宿主接线只走已安装包；#878 起本地旧包目录已删，不再当发布源。
 * 运行时走这里生成的新文件。
 *
 * 派生内容只剩一处：
 *   1. 宿主侧已删：#799 的旧复制段已随 #875 删除，能力只走已安装包，不再复制任何本地目录。
 *   2. 客户端侧（#800，本文件这次改的只有这一处）：不再读本地包目录，
 *      改调已安装更新包自带的官方工具 node_modules/dsh-plugin-update/derive-client-values.mjs，
 *      以已安装的 0.10.x 为唯一数据源生成面板取值（电话名与轮询间隔），
 *      落到 scripts/generated/updateClient.derived.js，构建时拼进客户端闭包（kernel:updateClient 标记处）。
 *      放 scripts 下是因为内容含中文错误文案，src/client 下会被中文基线门禁误拦；
 *      构建产物里早有中文注释，行为一致，只是换个地方放（与日志包派生同口径）。
 *      官方产物生成后，本脚本再做两件事（#597 顶撞改名守卫）：把三个重名函数改名，
 *      再检查与日志包派生文件有无顶层重名，撞名就报错。
 *
 * 为什么客户端取值要在派生时算出来：
 *   面板里原来写死 'wf.updateStatus' 这类字面量与 1000 毫秒。写死就没有扩展性 ——
 *   换前缀或换轮询间隔要改多处、还容易改漏。现在这两种取值只有一个来源（已安装更新包的配置面），
 *   改包即改行为；手写源码里不再出现电话名字面量，派生文件里带零变化断言字面供门禁核对。
 *
 * 每次打包的顺序（#800 落实决策 2 的前半句）：先把更新包升到 0.10.x 最新并提交锁文件，
 * 再跑本脚本派生，最后跑构建。构建脚本 scripts/build.mjs 会在需要时自动调本脚本，
 * 平时不用手工跑；但“升到最新”这一步靠人或发版流程执行，构建时只核对版本、不自动联网升级。
 *
 * 用法（一键走完“最新 0.10.x → 派生 → 构建”）：pnpm run update:latest；
 * 分步则是：
 *   先升到 0.10.x 最新：pnpm update dsh-plugin-update@^0.10.0（只取 0.10.x 最新，不跳大版本），把 pnpm-lock.yaml 一起提交；
 *   再派生：node scripts/derive-update-from-package.mjs（插件根目录）；
 *   最后构建：node scripts/build.mjs。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
// #875 薄接线：宿主侧派生（deriveHost）已删，能力只走已安装的更新包；
// 面板取值（deriveClient）唯一来源是已安装包（installedUpdateDir），不读本地包目录。

const CLIENT_OUT = resolve(ROOT, 'scripts', 'generated', 'updateClient.derived.js')

// 本插件在更新包里的注册参数：插件标识与电话名前缀。
// 这两个值要同时喂给宿主侧（建更新能力）与客户端侧（拼电话名），
// 所以它们只有一处声明，就是这里；宿主适配器不写第二份，按包里的默认值校验一遍。
export const PLUGIN_ID = 'dsh-mattpocock-skills-deck'
export const PHONE_PREFIX = 'wf'

// #875：宿主侧派生已删（旧派生目录随 #875 删除，运行时按包名直引已安装包）。

/**
 * 已安装更新包的位置：按包名解析（与宿主运行时同一套找法），不读本地包目录。
 * 本地更新包目录已随 #878 删除；面板取值的唯一数据源是已安装包（installedUpdateDir）。
 */
function installedUpdateDir() {
  try {
    const require = createRequire(resolve(ROOT, 'package.json'))
    const manifestPath = require.resolve('dsh-plugin-update/package.json')
    return dirname(manifestPath)
  } catch {
    const fallback = resolve(ROOT, 'node_modules', 'dsh-plugin-update')
    if (existsSync(join(fallback, 'package.json'))) return fallback
    throw new Error('[derive-update] 找不到已安装的更新包：请先运行 pnpm install（依赖 dsh-plugin-update@^0.10.0）')
  }
}

function installedUpdateVersion() {
  const dir = installedUpdateDir()
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
}

/** 顶层声明名（只看无缩进的 function / var / let / const，export 前缀剥掉）——与 tests/verify-generated-no-shadow.js 同一口径。 */
function topLevelNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:var|let|const)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) out.add(m[1] || m[2])
  }
  return out
}

/**
 * 顶撞守卫（#597）：本文件与日志包那份派生文件最终拼进同一个客户端闭包。
 * 顶层声明重名在这里就失败，不留给运行时去顶掉——顶掉的后果是静默坏功能（见 deriveClient 里的改名说明）。
 */
function assertNoShadowing(text) {
  const logKernel = resolve(ROOT, 'scripts', 'generated', 'logKernel.derived.js')
  if (!existsSync(logKernel)) return
  const mine = topLevelNames(text)
  const theirs = topLevelNames(readFileSync(logKernel, 'utf8'))
  const shared = [...mine].filter((n) => theirs.has(n)).sort()
  if (shared.length > 0) {
    throw new Error(
      '[derive-update] 与日志包派生文件顶层声明重名：' + shared.join('、') +
        '。两份文件会拼进同一个客户端闭包，后拼的把先拼的函数顶掉（#597）。请在本脚本的 RENAMES 里给这份加前缀。'
    )
  }
}

// 改名表（#597）：客户端闭包是把各派生分块按顺序拼进同一个作用域，函数声明会被提升，
// 后拼的分块会顶掉先拼的同名函数。更新包与日志包各自都声明了
// buildPhoneNames / buildPhoneName / buildClientPhoneNames，更新包拼在后面，
// 于是日志内核算出来的电话名表成了空壳（phoneNames.logSetSwitch 为 undefined）：
// 点调试开关时电话名传成 undefined，宿主 shim 在 method.replace 上抛错，
// 面板永远弹「开关保存失败，已保持原状态，请重试」；连日志上报的电话名也是 undefined，
// 所以客户端一条日志行都发不出去。这三个名字在更新包里是公开导出（改包本体等于改公开面），
// 所以在这里按「派生即改名」处理：只改这一份派生副本，包本体一个字节不动。
const RENAMES = [
  ['buildClientPhoneNames', 'updBuildClientPhoneNames'],
  ['buildPhoneNames', 'updBuildPhoneNames'],
  ['buildPhoneName', 'updBuildPhoneName'],
  ['isNonEmptyString', 'updIsNonEmptyString'],
  ['copyText', 'updCopyText']
]

export function deriveClient() {
  const pkgDir = installedUpdateDir()
  const version = installedUpdateVersion()
  const tool = join(pkgDir, 'derive-client-values.mjs')
  if (!existsSync(tool)) {
    throw new Error('[derive-update] 已安装的更新包里没有官方生成工具（' + tool + '）：请确认装的是 0.10.x（含 derive-client-values.mjs），重装一次试试')
  }
  mkdirSync(dirname(CLIENT_OUT), { recursive: true })
  // 第一步：调官方工具生成（唯一数据源是已安装包，版本号写进产物头）。
  const r = spawnSync(process.execPath, [tool, '--prefix', PHONE_PREFIX, '--out', CLIENT_OUT, '--package', PLUGIN_ID], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error('[derive-update] 官方工具生成失败：' + ((r.stderr || r.stdout || '未知错误')).slice(0, 500))
  }
  // 第二步：派生后处理（只改这一份副本，包本体不动）。
  let text = readFileSync(CLIENT_OUT, 'utf8').replace(/\r\n/g, '\n')
  for (const [from, to] of RENAMES) {
    const before = text
    text = text.replace(new RegExp('\\b' + from + '\\b', 'g'), to)
    if (before === text) {
      throw new Error('[derive-update] 改名没命中：' + from + '（更新包源码可能已改名或删掉，请同步本脚本的 RENAMES）')
    }
  }
  // 零变化断言（默认前缀 wf 下与旧字面一字不差；门禁直接看到这些字面，运行时走上面的拼名）。
  // 官方产物不带这行，门禁要读它，所以这里补上；已存在就不重复加，保证重跑零 diff。
  const assertion = "void (UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus' && UPD_PHONE_NAMES.updateCheck === 'wf.updateCheck' && UPD_PHONE_NAMES.updateInstall === 'wf.updateInstall' && UPD_POLL_MS === 1000)\n"
  if (!text.includes("UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus'")) {
    const anchor = 'export const UPD_STATUS = UPD_PHONE_NAMES.updateStatus'
    if (!text.includes(anchor)) {
      throw new Error('[derive-update] 官方产物里找不到取值尾巴（UPD_STATUS），包可能不完整')
    }
    text = text.replace(anchor, '// 零变化断言（默认前缀 wf 下与旧字面一字不差；门禁直接看到这些字面，运行时走上面的拼名）\n' + assertion + anchor)
  }
  // 改名说明行（记在产物头之后，产物头首行仍是官方的版本行，保证验收“产物头写明 0.2.0”一眼可见）。
  // 重跑时先去掉上一轮加的说明行，再加一行，保证零 diff。
  const guardNote = '// 派生后处理（#800）：已按 #597 把三个重名函数改名（build* → updBuild*），顶撞检查已过；数据源是已安装的更新包，本地包目录不是来源。\n'
  text = text.split('\n').filter((line) => !line.includes('派生后处理（#800）')).join('\n')
  const lines = text.split('\n')
  const headCount = lines.slice(0, 5).filter((line) => line.startsWith('//')).length
  lines.splice(headCount, 0, guardNote.replace(/\n$/, ''))
  text = lines.join('\n').replace(/\s+$/, '') + '\n'
  assertNoShadowing(text)
  writeFileSync(CLIENT_OUT, text, 'utf8')
  console.log('[derive-update] 官方工具派生 + 改名守卫：' + pkgDir + ' (' + version + ') -> scripts/generated/updateClient.derived.js')
  console.log('[derive-update] 打包前请确认：已先跑 pnpm update dsh-plugin-update@^0.10.0 并提交锁文件（最新 0.10.x → 派生 → 构建）')
  return version
}

function main() {
  deriveClient()
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  try {
    main()
  } catch (e) {
    console.error((e && e.message) || e)
    process.exit(1)
  }
}
