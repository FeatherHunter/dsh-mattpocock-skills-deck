// verify-587-update-live.ts —— 真机形态验收（#876 搭架、主题票 #877 切档案卷皮肤：真宿主判据 + 入口件真挂载）
//
// 这份门禁回答的是「界面上到底长什么样」，不是「代码里写了什么字」：
//   1. 真宿主判据：拿已安装更新包的宿主读取器（node_modules 里那份已装版，运行时唯一来源）
//      去读真使用范围（装在磁盘上的那份插件的真目录与真清单），证明「清单换个版本、进程还跑旧版」
//      时宿主确实报缺一次重启（pending-restart），而且重启后（运行版本追上磁盘）这条判据当场消失，
//      不依赖那张会过期的任务记录。
//   2. 真挂载渲染：发布产物含入口件绑定包与挂载点；把绑定包挂进 jsdom 真跑一遍，
//      对着界面断言四种场景：已是最新 / 有新版 / 装完待重启 / 点按后弹窗（包的 dialog 原样）。
//      入口件与 dialog 面板按包的档案卷呈现（挂载传档案卷皮肤，不自定义皮肤变量，
//      深浅跟随系统，档案头与印章与待重启横幅走档案卷样式）。
//      文案取包的单语渲染（中文界面纯中文），关闭与轮询收尾按包的约定来。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-587-update-live.ts（在仓库根目录；先跑 node scripts/build.mts）
const fs = require('fs')
const os = require('os')
const path = require('path')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
const LF = String.fromCharCode(10)
let failed = false
let total = 0
const check = (ok: unknown, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
/** 把 catch 到的异常转成一句能读的文字（带 message 的对象与普通值都认）。 */
const errText = (e: unknown): string => (e && (e as { message?: string }).message) ? String((e as { message?: string }).message) : String(e)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

;(async function main() {
  console.log('真机形态验收（#876 搭架 + #877 档案卷皮肤：真宿主判据 + 入口件真挂载）')

  // ============ 一、真宿主判据：跑已安装更新包的读取器，读磁盘上那份插件的真目录 ============
  const home: string = process.env.USERPROFILE || process.env.HOME || os.homedir() as string
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
  const originalManifest: string = fs.readFileSync(manifestPath, 'utf8')
  // 还原内容时要把修改时间一起还原：正常路径的内容判据不看 mtime，但缓存不可用时的回落判据按 mtime 判，
  // 只还原内容会让 package/package.json 的修改时间停在测试跑完的这一刻，回落路径上的新鲜度门禁因此可能报假红。
  const originalManifestStat = fs.statSync(manifestPath)
  const installedVersion = JSON.parse(originalManifest).version
  const profileDir = path.dirname(path.dirname(pkgDir))
  check(!!installedVersion, '读到磁盘上装的那一版（' + installedVersion + '）')

  // 0.18.33 起更新包内部按域拆到 dist/core 等子目录，reader 的落点跟着搬（升级 0.18.37 时适配）。
  const readerUrl = require('url').pathToFileURL(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'core', 'reader.js')).href
  // 通道按磁盘上装的那一版推：0.11.0 起稳定通道下装好的测试版走「通道不对」（channel-mismatch），
  // 于是本该报「缺一次重启」的场景报成别的（0.10.0 及之前是「安装无效」）。
  // 本机装的是稳定版时行为一个字不变；装的是测试版时按测试版通道判，两种装法都成立（2026-10-10）。
  const releaseChannel = /-/.test(installedVersion) ? 'prerelease' : 'stable'
  const profileSpec = (JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dependencies || {})['dsh-mattpocock-skills-deck'] || ''
  const readEnv = async (runningVersion: string): Promise<any> => {
    const readerMod = await import(readerUrl)
    const reader = readerMod.createUpdateReader({ runningVersion: runningVersion, profileDir: profileDir, pluginId: 'dsh-mattpocock-skills-deck', homeDir: path.join(home, '.dsh'), targetPackageDir: pkgDir, releaseChannel: releaseChannel })
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
    // 本机把插件按精确测试版钉在 profile 里时（dependencies 写 "1.9.0-beta.5" 这种），
    // dsh-plugin-update@0.11.0 起 registrySpec() 认精确预发布（validReleaseVersion），整包装不再被判成「从源码装的」，
    // 缺一次重启这条判据在这台机器上同样可达（0.10.0 及之前才走 source-install 分支，见 #878/#892）。
    // 但本机这份是「源码链接安装」（profile 里写 link:<仓库>/package）：dsh-plugin-update@0.18.25 的
    // registrySpec() 只认版本号，link:/file: 一律归为 source-install——链接安装下磁盘文件和运行代码本来就是同一份，
    // 没有「磁盘已换新版、进程还跑旧版」这回事，读取器判 source-install 才是对的。
    // 所以这里按安装形态分别断言，两种形态都守住「不会报成别的、不会静默当成已是最新」。
    // 注意还有第三种形态：profile 里写的是版本号，但 node_modules 下这份实际是 junction / 软链
    // （本机用工作区源码安装，桌面 profile 的包目录指向仓库的 package）。这种形态下磁盘文件就是
    // 运行代码的那一份，读取器同样判 source-install，所以这里按「安装目录的物理位置是否就是
    // profile 里那个位置」来识别链接安装，而不是只看 profile 的写法。
    const linkedInstall = /^(?:link|file):/.test(profileSpec) || fs.realpathSync(pkgDir) !== path.resolve(pkgDir)
    const expectedReason = linkedInstall ? 'source-install' : 'pending-restart'
    check(pending.blockedReason === expectedReason, '磁盘已是新版、进程仍跑旧版：' + (linkedInstall ? '链接安装报源码安装' : '报缺一次重启') + '（实际 ' + (pending.blockedReason || '无阻拦') + '，profile 写法 ' + (profileSpec || '空') + '）')

    const afterRestart = await readEnv('9.9.9')
    check(afterRestart.installedVersion === '9.9.9' && afterRestart.blockedReason !== 'pending-restart', '按新版重启后（运行版本追上磁盘）缺一次重启消失（实际 ' + (afterRestart.blockedReason || '无阻拦') + '）')
  } catch (e) {
    check(false, '真宿主判据跑通（异常：' + errText(e) + '）')
  } finally {
    fs.writeFileSync(manifestPath, originalManifest, 'utf8')
    try {
      fs.utimesSync(manifestPath, originalManifestStat.atime, originalManifestStat.mtime)
    } catch (e) {
      // 时间戳还原失败不影响内容判据（版本号已还原），但会让回落路径上的新鲜度门禁多一次假红，记成明确失败。
      check(false, '清单修改时间还原（异常：' + errText(e) + '）')
    }
    const back = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
    check(back === installedVersion, '已把使用范围里的清单版本还原成原样（' + back + '）')
    // Windows 的 utimes 只有毫秒精度，留 2ms 余量；差得多了说明还原没生效，回落判据会因此误判。
    const backStat = fs.statSync(manifestPath)
    check(Math.abs(backStat.mtimeMs - originalManifestStat.mtimeMs) <= 2, '清单还原后修改时间也回到原样（差 ' + (backStat.mtimeMs - originalManifestStat.mtimeMs).toFixed(2) + 'ms；回落判据不会因此误判）')
  }

  // ============ 二、真挂载渲染：发布产物委托 + 入口件在 jsdom 里真跑 ============
  const product: string = fs.readFileSync(path.join(ROOT, 'package', 'lib', 'client.js'), 'utf8')
  check(product.includes('__DshUpdateEntry') && product.includes('UpdateEntryHost'), '发布产物含入口件绑定包与挂载点（面板委托已进产物）')
  // 判据是「产物里挂载点确实传了档案卷皮肤」，不是「源码怎么写引号」：入口件源码转成 TypeScript 之后
  // 由 esbuild 产出，字符串引号会统一成双引号，所以两种引号都认（#1253 改，含义未变）。
  check(/theme:\s*['"]archive['"]/.test(product), '发布产物挂载点传档案卷皮肤（只用档案卷）')
  check(!product.includes('useUpdatePanel'), '发布产物无自有按钮状态机（useUpdatePanel 已删）')

  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:43120/' })
  const { window } = dom
  if (typeof window.MutationObserver === 'undefined') {
    window.MutationObserver = class { constructor() {} observe() {} disconnect() {} }
  }
  const bundleText: string = fs.readFileSync(path.join(ROOT, 'scripts', 'generated', 'updateEntryPanel.bundle.js'), 'utf8')
  // jsdom 的 window.eval 作用域里没有裸 window，赋值语句会抛；改拿求值返回值。
  // 这里选 compileFn：这份 jsdom 没开 runScripts，原来那个 window.eval 其实是 Node 全局的间接求值（不是页面内执行，插脚本也不会被执行），所以把绑定包当函数体跑、末尾显式 return 那个变量，取到的值与原来逐字相同。
  const liveEntry = compileFn([], bundleText + '\nreturn __DshUpdateEntry')()
  check(!!liveEntry && typeof liveEntry.mountUpdateEntry === 'function', '绑定包在真浏览器环境可加载（挂载函数可用）')
  check(bundleText.includes('[data-theme="archive"]'), '绑定包内有档案卷皮肤样式（入口件与面板按档案卷呈现）')
  // 入口件运行时读裸 document 与 navigator，挂载前把本轮 jsdom 的对象挂到 Node 全局上。
  ;(global as unknown as Record<string, unknown>).window = window
  ;(global as unknown as Record<string, unknown>).document = window.document
  try { ;(global as unknown as Record<string, unknown>).navigator = window.navigator } catch (e) {}
  if (typeof window.MutationObserver !== 'undefined') (global as unknown as Record<string, unknown>).MutationObserver = window.MutationObserver

  const snapOf = (over: Record<string, unknown>) => Object.assign({ runningVersion: '1.7.20', installed: true, installedVersion: '1.7.20', latestVersion: '1.7.20', canInstall: false, blockedReason: null, job: null }, over)
  const mountWith = async (snapshot: Record<string, unknown>) => {
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    const entry = liveEntry.mountUpdateEntry(el, {
      pluginId: 'dsh-mattpocock-skills-deck',
      prefix: 'wf',
      theme: 'archive',
      call: async (name: string) => {
        if (String(name).endsWith('.updateStatus') || String(name).endsWith('.updateCheck')) {
          return { ok: true, snapshot: snapOf(snapshot), manual: null, receipt: null }
        }
        return { ok: false, error: 'check-failed', errorKind: 'check-failed' }
      },
    })
    await sleep(60)
    return { el, entry }
  }
  const unmount = (m: { entry: { unmount: () => void }; el: { parentNode: { removeChild: (c: unknown) => void } | null } }) => { try { m.entry.unmount() } catch (e) {} try { if (m.el.parentNode) m.el.parentNode.removeChild(m.el) } catch (e) {} }
  const btnTextOf = (el: { querySelector: (s: string) => { textContent: string | null } | null }) => { const b = el.querySelector('button'); return b ? (b.textContent || '').trim() : '' }

  // 场景一：已是最新 —— 按钮本身即已是最新（0.9.0 默认摆法，可点再查，不打扰）
  {
    const m = await mountWith({})
    const t = btnTextOf(m.el)
    check(!!t && /已是最新/.test(t) && t.includes('1.7.20'), '场景一（已是最新）：按钮本身显示已是最新并带版本号（实际「' + t + '」）')
    check(!m.el.querySelector('.dsh-upd-overlay'), '场景一：没有浮层（无新版不打扰）')
    check(!!m.el.querySelector('.dsh-upd-entry[data-theme="archive"]'), '场景一：入口件按档案卷呈现（挂载传档案卷皮肤）')
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
    check(!!m.el.querySelector('.dsh-upd[data-theme="archive"]'), '场景二：dialog 面板按档案卷呈现（与入口件同步换肤）')
    check(!!m.el.querySelector('.dsh-upd[data-theme="archive"][data-seal]'), '场景二：大印章按档案卷呈现（面板根带印章字与色调）')
    check(!!m.el.querySelector('.dsh-upd-banner[data-mini]'), '场景二：横幅小印章一字按档案卷呈现')
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
    check(!!m.el.querySelector('.dsh-upd-entry[data-theme="archive"]'), '场景三：待重启按钮态按档案卷呈现（深浅跟随系统，不自定义变量）')
    m.entry.open()
    await sleep(60)
    const overlay3 = m.el.querySelector('.dsh-upd-overlay')
    check(!!overlay3, '场景三：待重启时点按同样能开 dialog 浮层（包的 dialog 原样）')
    check(!!m.el.querySelector('.dsh-upd[data-theme="archive"]'), '场景三：待重启横幅所在面板按档案卷呈现')
    check(!!m.el.querySelector('.dsh-upd-banner[data-kind="restart"]'), '场景三：待重启横幅按档案卷呈现（衬线横幅配手绘标）')
    m.entry.close()
    await sleep(30)
    unmount(m)
  }

  console.log(failed ? LF + '存在失败' : LF + '全部通过 — 真机形态验收生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
})().catch((e: unknown) => { console.error('验收执行异常：' + (((e as Error) && (e as Error).stack) || e)); process.exit(1) })
