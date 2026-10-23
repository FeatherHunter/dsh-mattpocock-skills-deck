/**
 * src/host/settingsPhones.ts —— 本机设置两条电话的处理体（来源：src/host/settingsPhones.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：读与写两条电话；用户主目录一定从平台取，写路径在同一实例内串行。
 *
 * 三条不能改的约定（改之前先看原 settingsPhones.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

// src/host/settingsPhones.js —— 本机设置两条电话的处理体：wf.getSettings（读）与 wf.setSettings（写）。
//
// 本文件用 JavaScript 而不用 TypeScript，一共有三条书面理由，每一条都是完整的一句话。
// 第一条理由是文件粒度门禁只扫描 JavaScript 文件，所以本票的新叶子必须写成 JavaScript 才能被门禁统计到行数里。
// 第二条理由是宿主构建对宿主目录的 JavaScript 文件是原样复制而不做转译，所以用 JavaScript 写不会引入新的构建步骤。
// 第三条理由是如果为本票单独新建一条宿主 TypeScript 编译管线，就属于一次大爆炸式的改动，所以本票沿用 JavaScript 例外。
//
// 为什么单独成一个文件：宿主入口已经贴着文件粒度门禁的三百五十行上限，
// 两条电话的读写真体放不进去了，所以照仓库惯例搬成一个自包含叶子，入口只留一行动态加载器。
// 本文件不引用其他宿主干活文件，全部依赖都由入口显式传入，所以仓库里仍然只有一份读写实现。
//
// 用户主目录一定从平台取，文件读写一定走系统文件直连，绝不走平台文件服务写主目录。
// 原因是平台文件服务是带写栅栏的沙箱，工作区之外的用户主目录写不进去，
// 而系统文件直连可以直接读写用户主目录下的设置文件。
//
// 写路径在同一个电话实例的进程内串行执行，后到的写会等前面的写落盘之后再开始，所以同一个实例的两笔写不会互相覆盖。
// 外部手改文件或者多个进程同时写仍然可以交错，这两种情况不在本串行的保证范围内。
// 日志走调用方传进来的已有包装，类型统一记成设置，事件只用已有的两个电话事件，不新增事件名。
// 本域 tsconfig 有意不加载任何类型包（types 为空），Node 内建模块的类型声明随 @types/node 一起被挡在门外；运行时一定是 Node，这些模块必然存在。所以只忽略这一行导入的类型错误（纯类型层面，不影响运行时转译）。
// @ts-expect-error
import { mkdir as nodeMkdir, readFile as nodeReadFile, unlink as nodeUnlink, writeFile as nodeWriteFile } from 'node:fs/promises'

// 缺席判据同时认两种失败码：系统直连的 ENOENT 与平台文件服务的 FS_NOT_FOUND。
// 原因是调用方传进来的读写口可能是真系统文件，也可能是门禁里的假文件，
// 两种失败码都表示文件确实不在，都要按没有这份文件处理。
export function isSettingsAbsenceError(e?: any): any {
  const code = String((e && ((e as any).code || ((e as any).cause && (e as any).cause.code))) || '')
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return true
  const msg = String((e && (e as any).message) || e || '')
  if (/ENOENT|FS_NOT_FOUND/i.test(msg)) return true
  return /cannot read.*not found/i.test(msg)
}

// 内部原因到回执种类的映射表，键是核与适配器内部的原因名，值是回给界面的种类。
// 值故意不照抄内部原因名，原因是内部原因名是给插件自己看的，
// 界面只需要知道这一次是文件不在还是内容坏了还是环境问题还是只读。
// 映射表只加类型不改值（键原先是字面量并集，外部原因按 any 进来时索引会报隐式 any；标成 Record<string, string> 后查表语义不变）。
const SETTINGS_KIND_MAP: Record<string, string> = {
  'missing': 'absent',
  'env': 'environment',
  'bad-shape': 'invalid',
  'oversize': 'invalid',
  'aliases': 'invalid',
  'yaml-error': 'invalid',
  'unknown-keys': 'invalid',
  'version-newer': 'readonly',
}

// 把内部原因翻成回执种类，未知的内部原因一律按环境问题处理。
// 原因是未知原因说明插件自己也没分清，不能让界面猜，所以诚实说成环境问题。
function mapSettingsKind(reason?: any) {
  if (Object.prototype.hasOwnProperty.call(SETTINGS_KIND_MAP, reason)) return SETTINGS_KIND_MAP[reason]
  return 'environment'
}

// 造两条本机设置电话的处理体，依赖全部由入口显式传入，本文件不自取任何环境。
export function createSettingsPhones(deps?: any): any {
  const input = deps || {}
  const getPlatform = input.getPlatform
  const readLocalSettings = input.readLocalSettings
  const writeLocalSettings = input.writeLocalSettings
  const logCtx = input.logCtx || null
  const fsPort = input.fs || null

  // 系统文件直连的默认实现，门禁可以传假文件进来替换它。
  // 读映射成读文件，写映射成写文件，建目录映射成递归建目录，删文件映射成删文件。
  const sysFs = fsPort || { readFile: nodeReadFile, writeFile: nodeWriteFile, mkdir: nodeMkdir, unlink: nodeUnlink }

  // 给适配器用的文件读写口，形状与测试里的内存假文件系统一致。
  // 这里只做映射，不吞错，缺席与否由适配器按两种失败码判定。
  function buildIo() {
    return {
      async readText(absPath?: any) {
        return sysFs.readFile(String(absPath), 'utf8')
      },
      async writeText(absPath?: any, text?: any) {
        await sysFs.writeFile(String(absPath), String(text), 'utf8')
      },
      async mkdir(dirPath?: any) {
        await sysFs.mkdir(String(dirPath), { recursive: true })
      },
      async rm(absPath?: any) {
        await sysFs.unlink(String(absPath))
      },
    }
  }

  // 从平台问用户主目录，问不到就按环境问题返回空。
  // 原因是用户主目录的唯一真相在平台层，插件自己不猜，也不用进程环境变量。
  async function resolveHome() {
    try {
      if (typeof getPlatform !== 'function') return ''
      const platform = await getPlatform()
      if (!platform || typeof platform.getHome !== 'function') return ''
      const home = await platform.getHome()
      if (typeof home !== 'string' || home.trim() === '') return ''
      return home
    } catch (e) {
      return ''
    }
  }

  function hash8(s?: any) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

  // 电话体记一行日志，成功落已有电话事件，失败落已有电话失败事件。
  // 类型统一记成设置，电话名写在方法字段里，不新增事件名。
  function phoneLog(method?: any, t0?: any, res?: any, err?: any) {
    try {
      if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: 'settings', errorHash: hash8(String((err && err.message) || err)) }) }
      else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: 'settings' }) }
      else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: 'settings', errorHash: hash8(String((res && res.error && (res.error.message || res.error.kind)) || 'settings-not-ok')) })
    } catch (eL) {}
  }

  // 进程内串行队列，两笔写不会同时进读改写，后到的写会等前面的写落盘之后再开始。
  let writeQueue = Promise.resolve()
  function serialWrite(task?: any): Promise<any> {
    const next = writeQueue.then(task, task)
    writeQueue = next.then(function() {}, function() {})
    return next
  }

  // 读本机设置，成功保留值与警告与只读标记与来源四个字段，失败按映射表分档。
  async function handleGetSettings() {
    const home = await resolveHome()
    if (!home) return { ok: false, error: { kind: 'environment', message: '拿不到用户主目录，所以读不出本机设置文件。请检查平台主目录能力是否可用，然后重试。' } }
    if (typeof readLocalSettings !== 'function') return { ok: false, error: { kind: 'environment', message: '读本机设置这一步没有装好，所以没有读任何文件。请重试一次，如果仍然失败请把这条提示原文报告给插件维护者。' } }
    let raw: any = null
    try {
      raw = await readLocalSettings(home, buildIo())
    } catch (e) {
      return { ok: false, error: { kind: 'environment', message: '读本机设置文件这一步出错了，可能是当前账号读不到它，也可能是它正被别的程序占用。请检查后重试。错误原文：' + String((e && (e as any).message) || e).slice(0, 120) } }
    }
    if (raw && raw.ok === true) {
      return { ok: true, value: raw.value, warnings: raw.warnings || [], readonly: raw.readonly === true, from: raw.from || 'yaml' }
    }
    const reason = String((raw && raw.reason) || 'env')
    return { ok: false, error: { kind: mapSettingsKind(reason), message: String((raw && raw.message) || '读本机设置文件这一步出错了。') } }
  }

  // 写本机设置，写之前先读一次，只读为真直接回升级文案，不动盘上任何字节。
  // 原因是高版本文件是新版插件写的，旧版本写回去会把新字段抹掉，所以必须拒绝。
  async function handleSetSettings(args?: any) {
    return serialWrite(async function() {
      const home = await resolveHome()
      if (!home) return { ok: false, error: { kind: 'environment', message: '拿不到用户主目录，所以保存不了本机设置文件。请检查平台主目录能力是否可用，然后重试。' } }
      if (typeof readLocalSettings !== 'function' || typeof writeLocalSettings !== 'function') return { ok: false, error: { kind: 'environment', message: '写本机设置这一步没有装好，所以没有动盘上的任何文件。请重试一次，如果仍然失败请把这条提示原文报告给插件维护者。' } }
      const inputValue = (args && typeof args.value === 'object' && args.value !== null) ? args.value : ((args && typeof args.settings === 'object' && args.settings !== null) ? args.settings : null)
      if (inputValue === null) return { ok: false, error: { kind: 'invalid', message: '要保存的本机设置不是一份名字到值的组合，请回到设置界面重新保存一次。' } }
      let before: any = null
      try {
        before = await readLocalSettings(home, buildIo())
      } catch (e) {
        before = null
      }
      if (before && before.ok === true && before.readonly === true) {
        return { ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件只认识到版本一，可以读来展示，不许写回去，请升级插件到最新版本后再改。' } }
      }
      let made: any = null
      try {
        made = await writeLocalSettings(inputValue, home, buildIo())
      } catch (e) {
        return { ok: false, error: { kind: 'environment', message: '保存失败，写不进本机设置文件，请检查它的上一级目录在不在与当前账号能不能写入，然后重试。错误原文：' + String((e && (e as any).message) || e).slice(0, 120) } }
      }
      if (made && made.ok === true) {
        return { ok: true, from: made.from || 'yaml', warnings: made.warnings || [] }
      }
      const reason = String((made && made.reason) || 'env')
      // 写时遇到高版本同样按只读拒绝，文案与读前检查同一句，不让两种只读说两种话。
      if (reason === 'version-newer') {
        return { ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件只认识到版本一，可以读来展示，不许写回去，请升级插件到最新版本后再改。' } }
      }
      // out 后面可能按条件追加 keys（一句内核返回的键清单）；先标成 any，追加语义与原来一致。
      const out: any = { kind: mapSettingsKind(reason), message: String((made && made.message) || '保存失败，写不进本机设置文件。') }
      if (made && Array.isArray(made.keys)) out.keys = made.keys
      return { ok: false, error: out }
    })
  }

  // 调试日志开关那一格（#1432：开关只认本机设置文件一处真源，宿主开机时直接来问这里）。
  // 回 true 或 false 表示文件里写明的值；回 null 表示这一趟问不出值（文件还没建、内容坏了、或者主目录拿不到），
  // 调用方把 null 当作「按默认值（关）处理」。这里一律不抛：开关缺席不该挡住日志底座初始化。
  // 成功与失败各记一行既有电话日志（host.call / host.call.fail），电话名沿用宿主开关电话的名字，不新增事件名。
  async function readDebugSwitchEnabled(): Promise<boolean | null> {
    const t0 = Date.now()
    let out: boolean | null = null
    let failKind = ''
    try {
      const home = await resolveHome()
      if (!home || typeof readLocalSettings !== 'function') failKind = 'no-home'
      else {
        const raw: any = await readLocalSettings(home, buildIo())
        if (raw && raw.ok === true) {
          const debug = raw.value && typeof raw.value === 'object' ? raw.value.debug : null
          if (debug && typeof debug === 'object' && typeof debug.enabled === 'boolean') out = debug.enabled
          else failKind = 'no-debug-switch'
        } else failKind = String((raw && raw.reason) || 'read-not-ok')
      }
    } catch (e) { failKind = 'read-throw' }
    if (out === null) phoneLog('wf.logGetSwitch', t0, { ok: false, error: { kind: failKind } })
    else phoneLog('wf.logGetSwitch', t0, { ok: true })
    return out
  }

  // 写调试日志开关那一格：只改本机设置文件 debug.enabled 这一格，文件里其余内容原样保留。
  // 走与 setSettings 同一条串行队列，避免两笔读改写交错；文件不在、内容坏了、只读或写不进去都回 null，
  // 调用方据此知道这一笔没有落盘。值本来就相等时不再写盘（客户端先把文件写好再来通知宿主，多半走这一趟）。
  async function writeDebugSwitchEnabled(enabled?: any): Promise<boolean | null> {
    const t0 = Date.now()
    const on = enabled === true
    const out = await serialWrite(async function (): Promise<boolean | null> {
      try {
        const home = await resolveHome()
        if (!home || typeof readLocalSettings !== 'function' || typeof writeLocalSettings !== 'function') return null
        const before: any = await readLocalSettings(home, buildIo())
        if (!before || before.ok !== true || before.readonly === true) return null
        const value = before.value && typeof before.value === 'object' ? before.value : null
        if (!value) return null
        const debug = value.debug && typeof value.debug === 'object' ? value.debug : {}
        if (debug.enabled === on) return on
        const next = Object.assign({}, value, { debug: Object.assign({}, debug, { enabled: on }) })
        const made: any = await writeLocalSettings(next, home, buildIo())
        return made && made.ok === true ? on : null
      } catch (e) { return null }
    })
    if (out === null) phoneLog('wf.logSetSwitch', t0, { ok: false, error: { kind: 'write-not-ok' } })
    else phoneLog('wf.logSetSwitch', t0, { ok: true })
    return out
  }

  // 带日志的包装：形状与仓库既有叶子完全一致（见 workspaceCwd.js 的 loggedPhone），
  //   按电话名逐条包住处理体，出口只记一行（成功 host.call，业务失败与抛错 host.call.fail）。
  //   写成这个形状而不是各写一份包装，是为了让日志覆盖门禁的既有判据照样量得到这两条电话，
  //   不需要为了新增两条电话去放宽那道门禁。
  function loggedPhone(method?: any, fn?: any) {
    return async function() {
      const t0 = Date.now()
      try { const r = await fn.apply(null, arguments); phoneLog(method, t0, r); return r } catch (e) { phoneLog(method, t0, null, e); throw e }
    }
  }

  return {
    handleGetSettings: loggedPhone('wf.getSettings', handleGetSettings),
    handleSetSettings: loggedPhone('wf.setSettings', handleSetSettings),
    // #1432：宿主开关来源（index.ts 的 _log() 把它包成 switchSource 递给日志包与旧回退实现）。
    readDebugSwitchEnabled,
    writeDebugSwitchEnabled,
  }
}

export default { createSettingsPhones, isSettingsAbsenceError }
