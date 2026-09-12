// verify-587-update-live.js —— #587 真机形态验收（真宿主判据 + 真产物渲染）
//
// 这份门禁回答的是「界面上到底长什么样」，不是「代码里写了什么字」：
//   1. 真宿主判据：拿**装在磁盘上的那份插件**自己的宿主读取器（lib/updatePkg/reader.js，用的就是 profile 里的真文件）
//      去读真使用范围，证明「清单换个版本、进程还跑旧版」时宿主确实报缺一次重启（pending-restart），
//      而且重启后（运行版本追上磁盘）这条判据当场消失，不依赖那张会过期的任务记录。
//   2. 真产物渲染：把发布用的客户端产物（package/lib/client.js）挂进 jsdom 真跑一遍，
//      渲染配置文件页，对着界面断言四种场景：已是最新 / 装完待重启 / 有新版 / 点按后弹窗。
//      弹窗那一段用同一份产物里的弹窗源码渲染（产物是单文件工厂，组件不外露），
//      渲染方式与产物里那一行调用同一形状：h(UpdateDialog, { open, latest, running, manual, ... })，文案取真的中文词条。
//
// 用法：node tests/verify-587-update-live.js（在仓库根目录；先跑 node scripts/build.mjs）
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const LF = String.fromCharCode(10)
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async function main() {
  console.log('真机形态验收（#587：真宿主判据 + 真产物渲染）')

  // ============ 一、真宿主判据：跑磁盘上那份插件的读取器 ============
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
  const profilesDir = path.join(home, '.dsh', 'profiles')
  let pkgDir = ''
  try {
    for (const name of fs.readdirSync(profilesDir)) {
      const candidate = path.join(profilesDir, name, 'node_modules', 'dsh-mattpocock-skills-deck')
      // 只认「完好」的那一份：三个入口文件都在（出版方清单里的 main / exports[./client] / dsh.bundle.patch）。
      // 本机桌面那份是旧版实装，缺 cordis.patch.yml，宿主读取器会按「安装无效」拒收，拿它做判据会得出假结论。
      const complete = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'].every((rel) => fs.existsSync(path.join(candidate, rel)))
      if (complete && fs.existsSync(path.join(candidate, 'lib', 'updatePkg', 'reader.js'))) { pkgDir = candidate; break }
    }
  } catch (e) { /* 没装过就留给下面的断言报 */ }
  check(!!pkgDir, '找得到装在本机使用范围里、且包完好的那份插件（真宿主判据的输入）' + (pkgDir ? '：' + path.basename(path.dirname(path.dirname(pkgDir))) : ''))
  if (!pkgDir) { console.log(LF + '存在失败'); process.exit(1) }

  const manifestPath = path.join(pkgDir, 'package.json')
  const originalManifest = fs.readFileSync(manifestPath, 'utf8')
  const installedVersion = JSON.parse(originalManifest).version
  const profileDir = path.dirname(path.dirname(pkgDir))
  check(!!installedVersion, '读到磁盘上装的那一版（' + installedVersion + '）')

  const readerUrl = require('url').pathToFileURL(path.join(pkgDir, 'lib', 'updatePkg', 'reader.js')).href
  const readEnv = async (runningVersion) => {
    const readerMod = await import(readerUrl)
    const reader = readerMod.createUpdateReader({ runningVersion: runningVersion, profileDir: profileDir, pluginId: 'dsh-mattpocock-skills-deck', homeDir: path.join(home, '.dsh') })
    return await reader.readEnv()
  }
  try {
    const same = await readEnv(installedVersion)
    check(same.installedVersion === installedVersion, '进程与磁盘同版：读到的已装版本就是这一版（' + same.installedVersion + '）')
    check(same.blockedReason !== 'pending-restart', '进程与磁盘同版：不报缺一次重启（实际 ' + (same.blockedReason || '无阻拦') + '）')

    const bumped = JSON.parse(originalManifest)
    bumped.version = '9.9.9'
    fs.writeFileSync(manifestPath, JSON.stringify(bumped, null, 2) + LF, 'utf8')
    const pending = await readEnv(installedVersion)
    check(pending.installedVersion === '9.9.9', '换了清单版本后宿主读到的是新版本号（读的是真文件）')
    check(pending.blockedReason === 'pending-restart', '磁盘已是新版、进程仍跑旧版：报缺一次重启（实际 ' + (pending.blockedReason || '无阻拦') + '）')

    const afterRestart = await readEnv('9.9.9')
    check(afterRestart.installedVersion === '9.9.9' && afterRestart.blockedReason !== 'pending-restart', '按新版重启后（运行版本追上磁盘）缺一次重启消失（实际 ' + (afterRestart.blockedReason || '无阻拦') + '）')
  } catch (e) {
    check(false, '真宿主判据跑通（异常：' + ((e && e.message) || e) + '）')
  } finally {
    fs.writeFileSync(manifestPath, originalManifest, 'utf8')
    const back = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
    check(back === installedVersion, '已把使用范围里的清单版本还原成原样（' + back + '）')
  }

  // ============ 二、真产物渲染：界面长什么样 ============
  const { JSDOM } = require('jsdom')
  const React = require('react')
  const ReactDOMClient = require('react-dom/client')
  const { act } = require('react')
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div><textarea class="uV2eYG_input" style="width:780px"></textarea></body></html>', { url: 'http://127.0.0.1:43120/', runScripts: 'dangerously' })
  const { window } = dom
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) { /* 老 node 不给赋值，跳过 */ }
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  global.getComputedStyle = window.getComputedStyle
  global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
  global.cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.ResizeObserver = window.ResizeObserver
  if (!window.document.fonts) window.document.fonts = { ready: Promise.resolve() }
  window.React = React
  window.ReactDOM = ReactDOMClient
  global.React = React
  global.ReactDOM = ReactDOMClient

  // 宿主桥：面板发出的每一次电话都照脚本给回包（回包形状与第 1 步真宿主里读到的一致）
  // 调用形状就是产物里的那条：connection.rpc.call(载体路径, 载体端点, { method, payload })
  // 回包按电话名分开排队：快照、绑定清单等别的电话不会把更新这一族的回包吃掉。
  const queues = {}
  const called = []
  const pushReply = (method, value) => { (queues[method] = queues[method] || []).push(value) }
  const rpcReply = async (channel, endpoint, body) => {
    const method = body && body.method ? String(body.method) : ''
    called.push(method || '(无方法名)')
    const mine = queues[method] || []
    const next = mine.length
      ? mine.shift()
      : { ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.20', latestVersion: '1.7.20', canInstall: false, blockedReason: null, job: null } }
    return { ok: true, value: next }
  }
  // 界面按当前语言取词条；这台机器上界面是中文，所以只收中文那一半（与真实界面口径一致）
  const dict = {}
  const trFn = (key, params) => {
    let s = dict[key] !== undefined ? dict[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    return s
  }
  const registrations = []
  const services = {
    slots: { register: (meta, comp) => { registrations.push({ meta, comp }); return () => {} }, inject: (name, fn) => { try { fn() } catch (e) {} } },
    connection: { rpc: { call: rpcReply } },
    locale: { register: (ns, d) => { Object.assign(dict, d.zh || {}); return () => {} }, bind: () => trFn },
    workspaces: { list: async () => [] },
    sessions: { list: async () => [] },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
  }
  const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
  let loaded = null
  window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
  window.eval(fs.readFileSync(path.join(ROOT, 'package', 'lib', 'client.js'), 'utf8'))
  const mod = loaded.factory((m) => { if (m === 'react') return React; if (m === 'react-dom') return ReactDOMClient; throw new Error('unexpected require: ' + m) })
  mod.apply(ctx)
  const settingsReg = registrations.find((r) => r.meta && r.meta.name === 'settings.plugins.tab')
  check(!!settingsReg, '真产物注册了配置文件页（settings.plugins.tab）')

  async function mountPage() {
    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    const root = ReactDOMClient.createRoot(container)
    await act(async () => { root.render(React.createElement(settingsReg.comp, { sessionId: 'live-sid' })); await sleep(30) })
    await act(async () => { await sleep(40) })
    return { container, root }
  }
  async function unmount(page) {
    try { await act(async () => { page.root.unmount() }) } catch (e) {}
    try { if (page.container.parentNode) page.container.parentNode.removeChild(page.container) } catch (e) {}
  }
  const btnOf = (container) => {
    for (const b of container.querySelectorAll('button')) {
      const t = (b.textContent || '').trim()
      if (/检查更新|检查中|更新至|待手动重启|正在更新/.test(t)) return b
    }
    return null
  }

  // 场景一：已是最新 —— 不打扰（没有常驻提示、没有弹窗）
  {
    pushReply('updateStatus', { ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.20', latestVersion: '1.7.20', canInstall: false, blockedReason: null, job: null } })
    const page = await mountPage()
    const btn = btnOf(page.container)
    check(!!btn && (btn.textContent || '').trim() === dict['cfg.updateCheck'], '场景一（已是最新）：按钮显示「' + dict['cfg.updateCheck'] + '」，页面安静')
    check(!page.container.querySelector('[data-role="update-restart-banner"]'), '场景一：没有待重启常驻提示')
    check(!page.container.querySelector('[data-role="update-dialog"]'), '场景一：没有弹窗（无新版不打扰）')
    await unmount(page)
  }

  // 场景二：装完还没重启 —— 常驻提示出现，按钮转成待重启并禁用
  {
    pushReply('updateStatus', { ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.21', latestVersion: '1.7.21', canInstall: false, blockedReason: 'pending-restart', job: null } })
    const page = await mountPage()
    const banner = page.container.querySelector('[data-role="update-restart-banner"]')
    check(!!banner, '场景二（装完待重启）：常驻提示出现在配置页上')
    const t = banner ? banner.textContent : ''
    check(t.includes(dict['cfg.updateRestart']), '场景二：提示里写明「' + dict['cfg.updateRestart'] + '」')
    check(t.includes('1.7.20') && t.includes('1.7.21'), '场景二：提示里同时给出正在跑的与已装的版本号（1.7.20 → 1.7.21）')
    const btn = btnOf(page.container)
    check(!!btn && (btn.textContent || '').trim() === dict['cfg.updateRestart'], '场景二：按钮也转成「' + dict['cfg.updateRestart'] + '」')
    check(!!btn && btn.disabled === true, '场景二：待重启期间按钮禁用（不会重复装）')
    check(!page.container.querySelector('[data-role="update-dialog"]'), '场景二：不再弹窗（这件事交给常驻提示说）')
    await unmount(page)
  }

  // 场景三：有新版 —— 按钮转成「更新至某版」，但只读状态不弹窗（要用户自己点）
  {
    const okNew = { ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.20', latestVersion: '1.7.21', canInstall: true, blockedReason: null, job: null }, manual: 'dsh plugin --profile web add --save-exact dsh-mattpocock-skills-deck@1.7.21 --registry=https://registry.npmjs.org/' }
    pushReply('updateStatus', okNew)
    const page = await mountPage()
    const btn = btnOf(page.container)
    check(!!btn && (btn.textContent || '').includes('1.7.21'), '场景三（有新版）：按钮显示「更新至 1.7.21」')
    check(!!btn && btn.disabled === false, '场景三：有新版时按钮可点（不误禁用）')
    check(!page.container.querySelector('[data-role="update-dialog"]'), '场景三：只读到有新版还不弹窗（要用户自己点）')
    await unmount(page)
  }

  // 场景四：弹窗本体 —— 用产物里的弹窗源码按产物里那一行的调用形状渲染，看浮层结构与里面的字
  {
    const { UpdateDialog } = await import(require('url').pathToFileURL(path.join(ROOT, 'src', 'client', 'views', 'UpdateDialog.js')).href)
    check(typeof UpdateDialog === 'function', '弹窗组件可用（真产物里那一行调用的就是它）')
    const manual = 'dsh plugin --profile web add --save-exact dsh-mattpocock-skills-deck@1.7.21 --registry=https://registry.npmjs.org/'
    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    const root = ReactDOMClient.createRoot(container)
    const props = {
      h: React.createElement,
      tr: trFn,
      open: true,
      latest: '1.7.21',
      running: '1.7.20',
      canInstall: true,
      checkId: 'live-check-1',
      busy: false,
      manual: manual,
      reason: null,
      failText: null,
      onClose: function () {},
      onCopy: function () {},
      onStart: function () {},
    }
    try {
      await act(async () => { root.render(React.createElement(UpdateDialog, props)); await sleep(30) })
      const dlg = container.querySelector('[data-role="update-dialog"]')
      const box = dlg ? dlg.querySelector('[data-role="update-dialog-box"]') : null
      check(!!dlg, '场景四：浮层弹窗渲染出来（是浮层，不是页内分组）')
      check(!!dlg && dlg.className.includes('dsws-modal'), '场景四：浮层用的是仓库现成的遮罩样式（dsws-modal）')
      check(!!box && box.className.includes('dsws-modalbox'), '场景四：浮层里是居中卡片（dsws-modalbox）')
      const txt = box ? box.textContent : ''
      const title = dict['cfg.updateDialogTitle'].replace('{v}', '1.7.21')
      check(txt.includes(title), '场景四：弹窗标题写明要装的版本（' + title + '）')
      check(txt.includes('1.7.20') && txt.includes('1.7.21'), '场景四：弹窗写清「当前哪版、最新哪版」')
      check(txt.includes(dict['cfg.updateRestartNote']), '场景四：弹窗提前说明「装完要重启一次才生效」')
      check(txt.includes(manual), '场景四：弹窗里有可复制的手工命令（宿主给的原文）')
      const texts = [...(box ? box.querySelectorAll('button') : [])].map((b) => (b.textContent || '').trim())
      check(texts.includes(dict['cfg.updateStart']) && texts.includes(dict['cfg.updateLater']), '场景四：弹窗里有「' + dict['cfg.updateStart'] + '」与「' + dict['cfg.updateLater'] + '」两个键')
      // 关掉之后再渲染一次：没开的时候不应在页面上留东西
      await act(async () => { root.render(React.createElement(UpdateDialog, Object.assign({}, props, { open: false }))); await sleep(20) })
      check(!container.querySelector('[data-role="update-dialog"]'), '场景四：关掉后页面上不留空壳')
      // 安装失败那一档：原因要看得见（#541 那次实测：失败后弹窗已关、用户以为点了没反应）
      await act(async () => { root.render(React.createElement(UpdateDialog, Object.assign({}, props, { failText: dict['cfg.updateFailInstall'] }))); await sleep(20) })
      check((container.textContent || '').includes(dict['cfg.updateFailed'].replace('{reason}', dict['cfg.updateFailInstall'])), '场景四：安装失败时弹窗里写明原因')
    } catch (e) {
      check(false, '场景四渲染弹窗（异常：' + ((e && e.message) || e) + '）')
    } finally {
      try { await act(async () => { root.unmount() }) } catch (e) {}
      try { container.parentNode.removeChild(container) } catch (e) {}
    }
  }

  console.log(failed ? LF + '存在失败' : LF + '全部通过 — 真机形态验收生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('验收执行异常：' + ((e && e.stack) || e)); process.exit(1) })
