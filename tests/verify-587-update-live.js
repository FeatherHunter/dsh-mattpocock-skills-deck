// verify-587-update-live.js —— 真机形态验收（#876 重写：真宿主判据 + 入口件真挂载）
//
// 这份门禁回答的是「界面上到底长什么样」，不是「代码里写了什么字」：
//   1. 真宿主判据：拿已安装更新包的宿主读取器（node_modules 里那份 0.7.x，运行时唯一来源）
//      去读真使用范围（装在磁盘上的那份插件的真目录与真清单），证明「清单换个版本、进程还跑旧版」
//      时宿主确实报缺一次重启（pending-restart），而且重启后（运行版本追上磁盘）这条判据当场消失，
//      不依赖那张会过期的任务记录。
//   2. 真挂载渲染：发布产物含入口件绑定包与挂载点；把绑定包挂进 jsdom 真跑一遍，
//      对着界面断言四种场景：已是最新 / 有新版 / 装完待重启 / 点按后弹窗（包的 dialog 原样）。
//      文案取包的单语渲染（中文界面纯中文），关闭与轮询收尾按包的约定来。
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
  console.log('真机形态验收（#876：真宿主判据 + 入口件真挂载）')

  // ============ 一、真宿主判据：跑已安装更新包的读取器，读磁盘上那份插件的真目录 ============
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
  const profilesDir = path.join(home, '.dsh', 'profiles')
  let pkgDir = ''
  try {
    for (const name of fs.readdirSync(profilesDir)) {
      const candidate = path.join(profilesDir, name, 'node_modules', 'dsh-mattpocock-skills-deck')
      // 只认「完好」的那一份：三个入口文件都在（出版方清单里的 main / exports[./client] / dsh.bundle.patch）。
      // 本机桌面那份是旧版实装，缺 cordis.patch.yml，宿主读取器会按「安装无效」拒收，拿它做判据会得出假结论。
      const complete = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'].every((rel) => fs.existsSync(path.join(candidate, rel)))
      if (complete) { pkgDir = candidate; break }
    }
  } catch (e) { /* 没装过就留给下面的断言报 */ }
  check(!!pkgDir, '找得到装在本机使用范围里、且包完好的那份插件（真宿主判据的输入）' + (pkgDir ? '：' + path.basename(path.dirname(path.dirname(pkgDir))) : ''))
  if (!pkgDir) { console.log(LF + '存在失败'); process.exit(1) }

  const manifestPath = path.join(pkgDir, 'package.json')
  const originalManifest = fs.readFileSync(manifestPath, 'utf8')
  const installedVersion = JSON.parse(originalManifest).version
  const profileDir = path.dirname(path.dirname(pkgDir))
  check(!!installedVersion, '读到磁盘上装的那一版（' + installedVersion + '）')

  const readerUrl = require('url').pathToFileURL(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'reader.js')).href
  const readEnv = async (runningVersion) => {
    const readerMod = await import(readerUrl)
    const reader = readerMod.createUpdateReader({ runningVersion: runningVersion, profileDir: profileDir, pluginId: 'dsh-mattpocock-skills-deck', homeDir: path.join(home, '.dsh'), targetPackageDir: pkgDir })
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

  // ============ 二、真挂载渲染：发布产物委托 + 入口件在 jsdom 里真跑 ============
  const product = fs.readFileSync(path.join(ROOT, 'package', 'lib', 'client.js'), 'utf8')
  check(product.includes('__DshUpdateEntry') && product.includes('UpdateEntryHost'), '发布产物含入口件绑定包与挂载点（面板委托已进产物）')
  check(!product.includes('useUpdatePanel'), '发布产物无自有按钮状态机（useUpdatePanel 已删）')

  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:43120/' })
  const { window } = dom
  if (typeof window.MutationObserver === 'undefined') {
    window.MutationObserver = class { constructor() {} observe() {} disconnect() {} }
  }
  const bundleText = fs.readFileSync(path.join(ROOT, 'scripts', 'generated', 'updateEntryPanel.bundle.js'), 'utf8')
  // jsdom 的 window.eval 作用域里没有裸 window，赋值语句会抛；改拿求值返回值。
  const liveEntry = window.eval(bundleText + '\n__DshUpdateEntry;')
  check(!!liveEntry && typeof liveEntry.mountUpdateEntry === 'function', '绑定包在真浏览器环境可加载（挂载函数可用）')
  // 入口件运行时读裸 document 与 navigator，挂载前把本轮 jsdom 的对象挂到 Node 全局上。
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) {}
  if (typeof window.MutationObserver !== 'undefined') global.MutationObserver = window.MutationObserver

  const snapOf = (over) => Object.assign({ runningVersion: '1.7.20', installedVersion: '1.7.20', latestVersion: '1.7.20', canInstall: false, blockedReason: null, job: null }, over)
  const mountWith = async (snapshot) => {
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    const entry = liveEntry.mountUpdateEntry(el, {
      pluginId: 'dsh-mattpocock-skills-deck',
      prefix: 'wf',
      call: async (name) => {
        if (String(name).endsWith('.updateStatus') || String(name).endsWith('.updateCheck')) {
          return { ok: true, snapshot: snapOf(snapshot), manual: null, receipt: null }
        }
        return { ok: false, error: 'check-failed', errorKind: 'check-failed' }
      },
    })
    await sleep(60)
    return { el, entry }
  }
  const unmount = (m) => { try { m.entry.unmount() } catch (e) {} try { if (m.el.parentNode) m.el.parentNode.removeChild(m.el) } catch (e) {} }
  const btnTextOf = (el) => { const b = el.querySelector('button'); return b ? (b.textContent || '').trim() : '' }

  // 场景一：已是最新 —— 按钮空闲态，不打扰（没有浮层）
  {
    const m = await mountWith({})
    const t = btnTextOf(m.el)
    check(!!t && /检查更新/.test(t), '场景一（已是最新）：按钮显示检查更新（实际「' + t + '」）')
    check(!m.el.querySelector('.dsh-upd-overlay'), '场景一：没有浮层（无新版不打扰）')
    unmount(m)
  }

  // 场景二：有新版 —— 按钮带出版本号；点按后开 dialog 浮层
  {
    const m = await mountWith({ latestVersion: '1.7.21', canInstall: true })
    const t = btnTextOf(m.el)
    check(!!t && t.includes('1.7.21'), '场景二（有新版）：按钮带出版本号（实际「' + t + '」）')
    check(!m.el.querySelector('.dsh-upd-overlay'), '场景二：只读到有新版还不弹窗（要用户自己点按）')
    m.entry.open()
    await sleep(60)
    const overlay = m.el.querySelector('.dsh-upd-overlay')
    check(!!overlay, '场景二：点按后 dialog 浮层打开（包的 dialog 原样）')
    const txt = overlay ? overlay.textContent : ''
    check(txt.includes('1.7.21') && txt.includes('1.7.20'), '场景二：浮层写清当前哪版、最新哪版')
    m.entry.close()
    await sleep(30)
    check(!m.el.querySelector('.dsh-upd-overlay'), '场景二：关闭后浮层收掉（按包的关闭约定）')
    unmount(m)
  }

  // 场景三：装完待重启 —— 按钮转成待重启
  {
    const m = await mountWith({ installedVersion: '1.7.21', latestVersion: '1.7.21', canInstall: false, blockedReason: 'pending-restart' })
    const t = btnTextOf(m.el)
    check(!!t && /重启/.test(t), '场景三（装完待重启）：按钮转成待重启（实际「' + t + '」）')
    unmount(m)
  }

  console.log(failed ? LF + '存在失败' : LF + '全部通过 — 真机形态验收生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('验收执行异常：' + ((e && e.stack) || e)); process.exit(1) })
