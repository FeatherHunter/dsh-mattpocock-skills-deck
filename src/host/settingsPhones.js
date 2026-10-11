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
import { mkdir as nodeMkdir, readFile as nodeReadFile, unlink as nodeUnlink, writeFile as nodeWriteFile } from 'node:fs/promises'

// 缺席判据同时认两种失败码：系统直连的 ENOENT 与平台文件服务的 FS_NOT_FOUND。
// 原因是调用方传进来的读写口可能是真系统文件，也可能是门禁里的假文件，
// 两种失败码都表示文件确实不在，都要按没有这份文件处理。
export function isSettingsAbsenceError(e) {
  const code = String((e && (e.code || (e.cause && e.cause.code))) || '')
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return true
  const msg = String((e && e.message) || e || '')
  if (/ENOENT|FS_NOT_FOUND/i.test(msg)) return true
  return /cannot read.*not found/i.test(msg)
}

// 内部原因到回执种类的映射表，键是核与适配器内部的原因名，值是回给界面的种类。
// 值故意不照抄内部原因名，原因是内部原因名是给插件自己看的，
// 界面只需要知道这一次是文件不在还是内容坏了还是环境问题还是只读。
const SETTINGS_KIND_MAP = {
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
function mapSettingsKind(reason) {
  if (Object.prototype.hasOwnProperty.call(SETTINGS_KIND_MAP, reason)) return SETTINGS_KIND_MAP[reason]
  return 'environment'
}

// 造两条本机设置电话的处理体，依赖全部由入口显式传入，本文件不自取任何环境。
export function createSettingsPhones(deps) {
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
      async readText(absPath) {
        return sysFs.readFile(String(absPath), 'utf8')
      },
      async writeText(absPath, text) {
        await sysFs.writeFile(String(absPath), String(text), 'utf8')
      },
      async mkdir(dirPath) {
        await sysFs.mkdir(String(dirPath), { recursive: true })
      },
      async rm(absPath) {
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

  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

  // 电话体记一行日志，成功落已有电话事件，失败落已有电话失败事件。
  // 类型统一记成设置，电话名写在方法字段里，不新增事件名。
  function phoneLog(method, t0, res, err) {
    try {
      if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: 'settings', errorHash: hash8(String((err && err.message) || err)) }) }
      else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: 'settings' }) }
      else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: 'settings', errorHash: hash8(String((res && res.error && (res.error.message || res.error.kind)) || 'settings-not-ok')) })
    } catch (eL) {}
  }

  // 进程内串行队列，两笔写不会同时进读改写，后到的写会等前面的写落盘之后再开始。
  let writeQueue = Promise.resolve()
  function serialWrite(task) {
    const next = writeQueue.then(task, task)
    writeQueue = next.then(function () {}, function () {})
    return next
  }

  // 读本机设置，成功保留值与警告与只读标记与来源四个字段，失败按映射表分档。
  async function handleGetSettings() {
    const home = await resolveHome()
    if (!home) return { ok: false, error: { kind: 'environment', message: '拿不到用户主目录，所以读不出本机设置文件。请检查平台主目录能力是否可用，然后重试。' } }
    if (typeof readLocalSettings !== 'function') return { ok: false, error: { kind: 'environment', message: '读本机设置这一步没有装好，所以没有读任何文件。请重试一次，如果仍然失败请把这条提示原文报告给插件维护者。' } }
    let raw = null
    try {
      raw = await readLocalSettings(home, buildIo())
    } catch (e) {
      return { ok: false, error: { kind: 'environment', message: '读本机设置文件这一步出错了，可能是当前账号读不到它，也可能是它正被别的程序占用。请检查后重试。错误原文：' + String((e && e.message) || e).slice(0, 120) } }
    }
    if (raw && raw.ok === true) {
      return { ok: true, value: raw.value, warnings: raw.warnings || [], readonly: raw.readonly === true, from: raw.from || 'yaml' }
    }
    const reason = String((raw && raw.reason) || 'env')
    return { ok: false, error: { kind: mapSettingsKind(reason), message: String((raw && raw.message) || '读本机设置文件这一步出错了。') } }
  }

  // 写本机设置，写之前先读一次，只读为真直接回升级文案，不动盘上任何字节。
  // 原因是高版本文件是新版插件写的，旧版本写回去会把新字段抹掉，所以必须拒绝。
  async function handleSetSettings(args) {
    return serialWrite(async function () {
      const home = await resolveHome()
      if (!home) return { ok: false, error: { kind: 'environment', message: '拿不到用户主目录，所以保存不了本机设置文件。请检查平台主目录能力是否可用，然后重试。' } }
      if (typeof readLocalSettings !== 'function' || typeof writeLocalSettings !== 'function') return { ok: false, error: { kind: 'environment', message: '写本机设置这一步没有装好，所以没有动盘上的任何文件。请重试一次，如果仍然失败请把这条提示原文报告给插件维护者。' } }
      const inputValue = (args && typeof args.value === 'object' && args.value !== null) ? args.value : ((args && typeof args.settings === 'object' && args.settings !== null) ? args.settings : null)
      if (inputValue === null) return { ok: false, error: { kind: 'invalid', message: '要保存的本机设置不是一份名字到值的组合，请回到设置界面重新保存一次。' } }
      let before = null
      try {
        before = await readLocalSettings(home, buildIo())
      } catch (e) {
        before = null
      }
      if (before && before.ok === true && before.readonly === true) {
        return { ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件只认识到版本一，可以读来展示，不许写回去，请升级插件到最新版本后再改。' } }
      }
      let made = null
      try {
        made = await writeLocalSettings(inputValue, home, buildIo())
      } catch (e) {
        return { ok: false, error: { kind: 'environment', message: '保存失败，写不进本机设置文件，请检查它的上一级目录在不在与当前账号能不能写入，然后重试。错误原文：' + String((e && e.message) || e).slice(0, 120) } }
      }
      if (made && made.ok === true) {
        return { ok: true, from: made.from || 'yaml', warnings: made.warnings || [] }
      }
      const reason = String((made && made.reason) || 'env')
      // 写时遇到高版本同样按只读拒绝，文案与读前检查同一句，不让两种只读说两种话。
      if (reason === 'version-newer') {
        return { ok: false, error: { kind: 'readonly', message: '这份本机设置文件是新版本插件写的，当前插件只认识到版本一，可以读来展示，不许写回去，请升级插件到最新版本后再改。' } }
      }
      const out = { kind: mapSettingsKind(reason), message: String((made && made.message) || '保存失败，写不进本机设置文件。') }
      if (made && Array.isArray(made.keys)) out.keys = made.keys
      return { ok: false, error: out }
    })
  }

  // 带日志的包装，电话名写在方法字段里，类型统一记成设置。
  async function handleGetSettingsLogged(args) {
    const t0 = Date.now()
    try { const r = await handleGetSettings(args); phoneLog('wf.getSettings', t0, r); return r } catch (e) { phoneLog('wf.getSettings', t0, null, e); throw e }
  }

  async function handleSetSettingsLogged(args) {
    const t0 = Date.now()
    try { const r = await handleSetSettings(args); phoneLog('wf.setSettings', t0, r); return r } catch (e) { phoneLog('wf.setSettings', t0, null, e); throw e }
  }

  return { handleGetSettings: handleGetSettingsLogged, handleSetSettings: handleSetSettingsLogged }
}

export default { createSettingsPhones, isSettingsAbsenceError }
