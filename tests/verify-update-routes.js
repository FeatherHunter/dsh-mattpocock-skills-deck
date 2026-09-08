// verify-update-routes.js — 安装执行路由门禁（落地票 #548）
// 规则：
//   1) 三系统 × 两种宿主各有断言：路由与参数形态由核心的 installRecipe 定，用假执行零件证明它；
//      适配器不按操作系统分支（本门禁扫源码证明这一点）。
//   2) 普通 DSH 路由一律「运行时可执行文件 + CLI 的 JS 入口 + 参数数组」：不经 shell、不用 PATH 上的 dsh 命令名。
//   3) 桌面宿主一律走 desktopPnpm.runPlugin；激活使用范围与本插件所在范围对不上时宁可不装（诚实失败）。
//   4) 使用范围名原样进参数数组（含空格与非 ASCII 字符不加引号、不被空格切开）。
//   5) 全部门禁用假零件，绝不真跑安装命令；本文件不出现真子进程调用。
// 用法：node tests/verify-update-routes.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

const OSES = ['win32', 'darwin', 'linux']
const RUNTIME = { win32: 'C:\\Program Files\\nodejs\\node.exe', darwin: '/usr/local/bin/node', linux: '/usr/bin/node' }
const ENTRY = { win32: 'C:\\Users\\u\\.dsh\\profiles\\web\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js', darwin: '/home/u/.dsh/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js', linux: '/home/u/.dsh/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js' }
const PROFILE_DIR = { win32: 'C:\\Users\\u\\.dsh\\profiles\\web', darwin: '/home/u/.dsh/profiles/web', linux: '/home/u/.dsh/profiles/web' }

/** 假子进程口子：只收规格、只回退出事实，不真起进程（属性写法，避免出现真调用形状）。 */
function fakeSubprocess(calls, exitCode) {
  return {
    spawn: function (spec) {
      calls.push(spec)
      return { done: Promise.resolve({ exitCode: exitCode === undefined ? 0 : exitCode }) }
    },
  }
}

/** 假桌面服务：只收参数、只回退出事实，不真起进程。 */
function fakeDesktopPnpm(calls, exitCode) {
  return {
    runPlugin: function (argv, invokingDir) {
      calls.push({ argv: argv, invokingDir: invokingDir })
      return { done: Promise.resolve({ exitCode: exitCode === undefined ? 0 : exitCode }) }
    },
  }
}

async function main() {
  console.log('安装执行路由门禁（#548：三系统 × 两种宿主，假执行零件证明路由与命令形态）')
  const commands = await import(pathToFileURL(path.join(ROOT, 'src/shared/update/commands.js')).href)
  const store = await import(pathToFileURL(path.join(ROOT, 'src/host/updateStore.js')).href)
  const PACKAGE = 'dsh-mattpocock-skills-deck'
  const REG = '--registry=https://registry.npmjs.org/'
  const PLUGIN_ARGS = ['add', '--save-exact', `${PACKAGE}@9.9.9`, REG]

  // ---- 1) 配方：路由由宿主种类定，参数形态三系统一致 ----
  {
    const cli = commands.installRecipe({ profileName: 'web', version: '9.9.9', environmentKind: 'cli' })
    const desktop = commands.installRecipe({ profileName: 'web', version: '9.9.9', environmentKind: 'desktop' })
    check(!!cli && cli.route === 'cli-process', '普通 DSH 宿主出命令行路由（实际 ' + ((cli && cli.route) || '无配方') + '）')
    check(!!desktop && desktop.route === 'desktop-service', '桌面宿主出桌面服务路由（实际 ' + ((desktop && desktop.route) || '无配方') + '）')
    check(JSON.stringify(cli && cli.pluginArgs) === JSON.stringify(PLUGIN_ARGS), '配方参数数组带精确版本、--save-exact 与官方源（实际 ' + ((cli && cli.pluginArgs.join(' ')) || '无配方') + '）')
    check(JSON.stringify(desktop && desktop.pluginArgs) === JSON.stringify(cli && cli.pluginArgs), '两条路由共用同一组参数（差异只在走哪条路由）')
    check(!!cli && typeof cli.timeoutMs === 'number' && cli.timeoutMs > 0, '配方带执行时限（实际 ' + ((cli && cli.timeoutMs) || 0) + ' 毫秒）')
    check(commands.installRecipe({ profileName: 'web', version: '9.9.9', environmentKind: 'unknown' }) === null, '宿主种类不认识时不给配方（诚实失败转手工命令）')
    check(commands.installRecipe({ profileName: '', version: '9.9.9', environmentKind: 'cli' }) === null, '使用范围名不可用时不给配方')
  }

  // ---- 2) 命令行路由：三系统都是「运行时 + CLI 入口 + 参数数组」 ----
  for (const os of OSES) {
    const calls = []
    const run = store.createUpdateExecutor({
      subprocess: fakeSubprocess(calls),
      runtimeExecutable: RUNTIME[os],
      runtimeExecArgs: [],
      cliEntry: ENTRY[os],
      profileDir: PROFILE_DIR[os],
    })
    await run({ version: '9.9.9', profileName: 'web', environmentKind: 'cli' })
    const spec = calls[0] || {}
    const argv = spec.argv || []
    const want = [RUNTIME[os], ENTRY[os], 'plugin', '--profile', 'web', ...PLUGIN_ARGS]
    check(calls.length === 1, os + '：命令行路由起一次进程（实际 ' + calls.length + ' 次）')
    check(JSON.stringify(argv) === JSON.stringify(want), os + '：参数数组是「运行时 + CLI 入口 + plugin --profile 名 + 参数」（实际 ' + JSON.stringify(argv) + '）')
    check(argv[0] === RUNTIME[os] && !/\.cmd$|\.bat$/i.test(String(argv[0])), os + '：程序是当前运行时而不是 dsh 垫片（实际 ' + argv[0] + '）')
    check(argv[0] !== 'dsh' && !argv.some((a) => a === 'cmd.exe' || a === '/c' || a === '-c' || a === 'sh'), os + '：不用 PATH 上的 dsh 命令名、不经 shell 解释')
    check(!('shell' in spec), os + '：不给子进程能力传 shell 选项')
    check(spec.cwd === PROFILE_DIR[os], os + '：工作目录是本插件所在的使用范围')
    check(typeof spec.graceMs === 'number' && spec.graceMs > 0, os + '：带终止宽限期（实际 ' + spec.graceMs + ' 毫秒）')
    const stdio = spec.stdio || {}
    check(stdio.stdin === 'ignore' && stdio.stdout && stdio.stderr && typeof stdio.stdout.maxBytes === 'number' && typeof stdio.stderr.maxBytes === 'number', os + '：输出走有界收集（不读不落盘，也不会没人读把子进程卡住）')
  }

  // ---- 3) 桌面路由：三系统都走桌面服务，参数数组原样交出去 ----
  for (const os of OSES) {
    const calls = []
    const run = store.createUpdateExecutor({
      desktopPnpm: fakeDesktopPnpm(calls),
      desktopProfiles: { current: { name: 'web', dir: PROFILE_DIR[os] } },
      profileDir: PROFILE_DIR[os],
    })
    await run({ version: '9.9.9', profileName: 'web', environmentKind: 'desktop' })
    const call = calls[0] || {}
    check(calls.length === 1, os + '：桌面路由调一次桌面服务（实际 ' + calls.length + ' 次）')
    check(JSON.stringify(call.argv) === JSON.stringify(PLUGIN_ARGS), os + '：桌面服务收到完整参数数组（实际 ' + JSON.stringify(call.argv) + '）')
    check(call.invokingDir === PROFILE_DIR[os], os + '：桌面服务收到本插件所在的使用范围目录')
  }
  // 3b) 激活使用范围与本插件所在范围对不上：宁可不装（装错范围比装不上更糟）
  {
    const calls = []
    const run = store.createUpdateExecutor({
      desktopPnpm: fakeDesktopPnpm(calls),
      desktopProfiles: { current: { name: 'desktop', dir: '/home/u/.dsh/profiles/desktop' } },
      profileDir: '/home/u/.dsh/profiles/web',
    })
    let code = ''
    try {
      await run({ version: '9.9.9', profileName: 'web', environmentKind: 'desktop' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'install-failed', '激活使用范围对不上时报安装失败（实际 ' + (code || '没抛错') + '）')
    check(calls.length === 0, '对不上时一次桌面服务都没调（实际 ' + calls.length + ' 次）')
  }
  // 3c) 拿不到桌面服务或宿主信号：诚实失败
  {
    for (const parts of [
      { desktopProfiles: { current: { name: 'web', dir: '/p' } }, profileDir: '/p' },
      { desktopPnpm: fakeDesktopPnpm([]), profileDir: '/p' },
    ]) {
      const run = store.createUpdateExecutor(parts)
      let code = ''
      try {
        await run({ version: '9.9.9', profileName: 'web', environmentKind: 'desktop' })
      } catch (e) { code = (e && e.code) || '' }
      check(code === 'install-failed', '桌面零件缺失时报安装失败（实际 ' + (code || '没抛错') + '）')
    }
  }

  // ---- 4) 使用范围名原样进参数数组（含空格与非 ASCII 字符） ----
  {
    for (const name of ['my profile', '我的配置']) {
      const calls = []
      const run = store.createUpdateExecutor({
        subprocess: fakeSubprocess(calls),
        runtimeExecutable: '/usr/bin/node',
        runtimeExecArgs: ['--no-warnings'],
        cliEntry: '/opt/dsh/lib/bin.js',
        profileDir: '/home/u/.dsh/profiles/web',
      })
      await run({ version: '9.9.9', profileName: name, environmentKind: 'cli' })
      const argv = (calls[0] || {}).argv || []
      const at = argv.indexOf('--profile')
      check(at >= 0 && argv[at + 1] === name, '使用范围名「' + name + '」原样进参数数组（实际 ' + JSON.stringify(at >= 0 ? argv[at + 1] : '') + '）')
      check(!String(argv[at + 1]).includes('"'), '使用范围名不带字面引号（实际 ' + JSON.stringify(at >= 0 ? argv[at + 1] : '') + '）')
      check(JSON.stringify(argv) === JSON.stringify(['/usr/bin/node', '--no-warnings', '/opt/dsh/lib/bin.js', 'plugin', '--profile', name, ...PLUGIN_ARGS]), '运行时参数与参数数组顺序正确（实际 ' + JSON.stringify(argv) + '）')
    }
  }

  // ---- 5) 退出码与缺失零件：一律诚实失败，不静默降级 ----
  {
    const bad = []
    const runBad = store.createUpdateExecutor({
      subprocess: fakeSubprocess(bad, 1),
      runtimeExecutable: '/usr/bin/node',
      cliEntry: '/opt/dsh/lib/bin.js',
      profileDir: '/home/u/.dsh/profiles/web',
    })
    let code = ''
    try {
      await runBad({ version: '9.9.9', profileName: 'web', environmentKind: 'cli' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'install-failed', '子进程退出码非零报安装失败（实际 ' + (code || '没抛错') + '）')

    const noEntry = []
    const runNoEntry = store.createUpdateExecutor({
      subprocess: fakeSubprocess(noEntry),
      runtimeExecutable: '/usr/bin/node',
      cliEntry: '',
      profileDir: '/home/u/.dsh/profiles/web',
    })
    code = ''
    try {
      await runNoEntry({ version: '9.9.9', profileName: 'web', environmentKind: 'cli' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'install-failed' && noEntry.length === 0, '拿不到 CLI 入口时报安装失败且不起进程（实际 ' + (code || '没抛错') + '，起进程 ' + noEntry.length + ' 次）')

    const noParts = store.createUpdateExecutor({ cliEntry: '' })
    code = ''
    try {
      await noParts({ version: '9.9.9', profileName: 'web', environmentKind: 'cli' })
    } catch (e) { code = (e && e.code) || '' }
    check(code === 'install-failed', '什么零件都没有时报安装失败（实际 ' + (code || '没抛错') + '）')
  }

  // ---- 6) CLI 入口反查：名字对得上且与包声明的可执行入口一致才算数 ----
  {
    // 清单按「解析成绝对规范写法」的目录名挂（与真实现逐级向上的口径一致）。
    const manifests = {
      [path.resolve('/opt/dsh')]: { name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } },
      [path.resolve('/opt/other')]: { name: 'some-other-cli', bin: { dsh: 'lib/bin.js' } },
      [path.resolve('/opt/mismatch')]: { name: '@deepseek-ai/dsh', bin: { dsh: 'lib/other.js' } },
    }
    const deps = {
      readManifest: async (dir) => manifests[dir] || null,
      // 假路径解析：只做与真实现同样的「解析成绝对规范写法」，不碰真文件系统。
      realpath: async (p) => path.resolve(p),
    }
    const okEntry = path.resolve('/opt/dsh/lib/bin.js')
    const ok = await store.resolveCliEntry('/opt/dsh/lib/bin.js', deps)
    check(ok === okEntry, '入口对得上包声明的 bin 就采用（实际 ' + (ok || 'null') + '）')
    check(await store.resolveCliEntry('/opt/other/lib/bin.js', deps) === null, '包名对不上不采用')
    check(await store.resolveCliEntry('/opt/mismatch/lib/bin.js', deps) === null, '入口与包声明的 bin 不一致不采用')
    check(await store.resolveCliEntry('', deps) === null, '没有运行入口时不采用')
  }

  // ---- 7) 适配器不按操作系统分支，也不碰 shell 与裸子进程 ----
  {
    const storeSrc = strip(read('src/host/updateStore.js'))
    check(!/win32|darwin|linux|process\.platform/.test(storeSrc), '执行器不按操作系统分支（路由由核心配方定）')
    check(!/node:child_process|execFile|execSync|shell\s*:/.test(storeSrc), '执行器不用裸子进程、不经 shell')
    check(!/buttonCommand|split\(' '\)/.test(storeSrc), '执行器不拼命令串再按空格拆参数')
    check(/awaitOutcome\(handle, recipe\.timeoutMs\)/.test(storeSrc), '命令行路由把配方的执行时限用在等退出上')
    const updateSrc = strip(read('src/host/update.js'))
    check(updateSrc.includes("ctxService(ctx, 'desktopProfiles')"), '宿主种类用官方信号 desktopProfiles 探测')
    check(updateSrc.includes("ctx.inject(['desktopPnpm']"), '桌面服务走嵌套注入（普通 DSH 不加载桌面依赖）')
    check(read('src/host/index.js').includes('ctx: ctx'), '宿主把上下文交给更新胶水（探测宿主种类与接执行零件）')
  }

  // ---- 8) 本门禁不跑真命令 ----
  {
    const mine = read('tests/verify-update-routes.js')
    check(!/(^|[^A-Za-z0-9_])spawn\s*\(|execFile\s*\(/.test(mine), '本门禁无真安装调用（全假零件）')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 安装执行路由门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
