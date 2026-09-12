// verify-log-exec-606.js —— #606 门禁：经 ctx.exec 起的外部命令要留下计数与耗时，且关闭调试开关时这条路零代价。
//
// 为什么要有这一条：面板列表的主取数路（列表页与单票页）、每次探测的预检、取当前登录用户、所有写操作，
//   走的都是宿主给后端的 `ctx.exec`。这条路原先一条日志都不留，于是「一整天起了多少次外部命令、每次多久」
//   没人知道。补上 exec.run 之后，光看代码看不出「关着开关时到底付了多少代价」，所以这里用假零件
//   （假子进程、假计时器、假记录器）把两件事量出来：
//     一、开关打开：每条命令恰好落一行，四个字段齐，工作区只落短指纹不落原始路径；
//     二、开关关闭：一条都不落，而且日志点连时钟都不读 —— 唯一代价是读一次开关的布尔值。
//
// 用法：node tests/verify-log-exec-606.js（在插件根目录，不需要构建产物）。
const path = require('path')
const os = require('os')
const nodeFs = require('fs')
const { pathToFileURL } = require('url')

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const ROOT = path.resolve(__dirname, '..')
const CWD = 'D:\\some\\user\\private-workspace'

console.log('日志按需测点门禁（#606：经 ctx.exec 起的外部命令留计数与耗时，关闭开关时零代价）')

// 假子进程：立刻交回一个已完成的句柄；句柄形状按宿主契约（collected.stdout/stderr + done + terminate）。
function makeSubprocess(outText, exitCode, delayMs) {
  const calls = []
  return {
    calls,
    spawn(cfg) {
      calls.push(cfg)
      const outcome = { exitCode: exitCode === undefined ? 0 : exitCode }
      const done = delayMs ? new Promise((resolve) => { setTimeout(() => resolve(outcome), delayMs) }) : Promise.resolve(outcome)
      return {
        collected: {
          stdout: { readFrom: () => ({ text: outText === undefined ? '' : outText }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
        done,
        terminate() {},
      }
    },
  }
}
// 假计时器：超时分支永不触发（这里只关心命令正常结束那条路）。
const makeTimer = () => ({ timeout: () => new Promise(() => {}) })
// 假记录器：数 isEnabled 与 fire 各被调用几次，并收下每一行的字段。
function makeLogCtx(enabled) {
  const lines = []
  let isEnabledCalls = 0
  let fireCalls = 0
  return {
    lines,
    get isEnabledCalls() { return isEnabledCalls },
    get fireCalls() { return fireCalls },
    isEnabled(level) { isEnabledCalls += 1; if (level === 'error' || level === 'warn') return true; return enabled === true },
    fire(level, event, fieldsOrFn) {
      fireCalls += 1
      lines.push({ level, event, fields: (typeof fieldsOrFn === 'function') ? fieldsOrFn() : fieldsOrFn })
    },
  }
}
// 数 Date.now 被调用几次：用来证明「关着时日志点连时钟都不读」，而不是只靠看代码推断。
const countDateNow = async (fn) => {
  const real = Date.now
  let n = 0
  Date.now = function () { n += 1; return real.apply(Date, arguments) }
  try { await fn() } finally { Date.now = real }
  return n
}

async function main() {
  const platMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'platformChannel.js')).href)
  const repoMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'repoKeys.js')).href)

  // ---- 一、开关打开：两处接缝各落一行，四个字段齐，路径只落短指纹 ----
  {
    const logCtx = makeLogCtx(true)
    const subprocess = makeSubprocess('ok')
    const plat = platMod.createPlatformChannel({
      ctx: { get: () => null }, subprocess, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      getMattSkillProbeNames: async () => [], probeSkill: async () => ({ level: 'ok' }), logCtx,
    })
    const repo = repoMod.createRepoKeys({
      subprocess, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      repoKeys: {}, repoRoots: {}, getGhPath: () => null, setGhPath: () => {}, getGhLastError: () => null, setGhLastError: () => {},
      getPlatform: async () => null, getWorkspaceStore: async () => null, setCache: () => {}, clearWorkspaceStore: () => {},
      namingSweepSoon: () => {}, parseGithubRepo: () => null, logCtx,
    })

    await plat.detectionExec('gh', ['api', 'user'], { cwd: CWD, timeout: 30000 })
    await repo.execProc(['git', '-C', CWD, 'remote', 'get-url', 'origin'], CWD)

    check(logCtx.lines.length === 2, '开关打开时每条外部命令落一行（实得 ' + logCtx.lines.length + ' 行）' + (logCtx.lines.length ? '' : ' —— 一行都没有，说明接缝上的测点没接上'))
    const events = logCtx.lines.map((l) => l.event)
    check(events.every((e) => e === 'exec.run'), '两行都是 exec.run（实得 ' + events.join('、') + '）')
    check(logCtx.lines.every((l) => l.level === 'debug'), '按需级：两行都是调试级别（实得 ' + logCtx.lines.map((l) => l.level).join('、') + '）')
    const names = logCtx.lines.map((l) => l.fields && l.fields.argv0)
    check(names[0] === 'gh' && names[1] === 'git', '命令名如实：detectionExec 记 gh、execProc 记 git（实得 ' + names.join('、') + '）')
    const keysOk = logCtx.lines.every((l) => {
      const k = Object.keys(l.fields || {}).sort().join(',')
      return k === 'argv0,cwdHash,exitCode,latencyMs'
    })
    check(keysOk, '字段恰为白名单四项（argv0、cwdHash、latencyMs、exitCode），不记完整参数')
    const noParamLeak = logCtx.lines.every((l) => JSON.stringify(l.fields).indexOf('remote') < 0 && JSON.stringify(l.fields).indexOf('api') < 0)
    check(noParamLeak, '参数一个都没进日志（记的是命令名，不是 argv 全串）')
    const hashesOk = logCtx.lines.every((l) => /^[0-9a-f]{8}$/.test(String(l.fields.cwdHash)))
    check(hashesOk, '工作区只记八位短指纹（实得 ' + logCtx.lines.map((l) => l.fields.cwdHash).join('、') + '）')
    const noRawPath = logCtx.lines.every((l) => JSON.stringify(l.fields).indexOf('private-workspace') < 0 && JSON.stringify(l.fields).indexOf('D:') < 0)
    check(noRawPath, '原始路径一个字都没进日志')
    const msOk = logCtx.lines.every((l) => typeof l.fields.latencyMs === 'number' && l.fields.latencyMs >= 0)
    check(msOk, '每次耗时是数字（实得 ' + logCtx.lines.map((l) => l.fields.latencyMs).join('、') + ' 毫秒）')
    const codeOk = logCtx.lines.every((l) => l.fields.exitCode === 0)
    check(codeOk, '成功命令退出码记为 0（实得 ' + logCtx.lines.map((l) => l.fields.exitCode).join('、') + '）')
    // 调用方若给了带目录的完整路径，也只留程序名 —— 否则一条文件系统路径就漏进日志了。
    await plat.detectionExec(process.execPath, ['--version'], { cwd: CWD, timeout: 30000 })
    const lastArgv0 = logCtx.lines[logCtx.lines.length - 1].fields.argv0
    check(lastArgv0 === path.basename(process.execPath), '给了带目录的完整路径也只记程序名（实得 ' + lastArgv0 + '，没有目录部分）')
    check(logCtx.lines.length === subprocess.calls.length, '起了多少条命令就落多少行（起了 ' + subprocess.calls.length + ' 次、落了 ' + logCtx.lines.length + ' 行），不会一次命令记两行')
  }

  // ---- 二、失败与超时也计数：退出码非零照记，退出码拿不到记 -1 ----
  {
    const logCtx = makeLogCtx(true)
    const subprocess = makeSubprocess('', 3)
    const repo = repoMod.createRepoKeys({
      subprocess, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      repoKeys: {}, repoRoots: {}, getGhPath: () => null, setGhPath: () => {}, getGhLastError: () => null, setGhLastError: () => {},
      getPlatform: async () => null, getWorkspaceStore: async () => null, setCache: () => {}, clearWorkspaceStore: () => {},
      namingSweepSoon: () => {}, parseGithubRepo: () => null, logCtx,
    })
    await repo.execProc(['git', 'status'], CWD)
    check(logCtx.lines.length === 1 && logCtx.lines[0].fields.exitCode === 3, '失败的命令同样计数，退出码如实记 3（实得 ' + (logCtx.lines[0] ? logCtx.lines[0].fields.exitCode : '无') + '）')
  }

  // ---- 二之二、耗时是真量出来的：让假子进程慢 30 毫秒，记下的必须跟着涨 ----
  {
    const logCtx = makeLogCtx(true)
    const slow = makeSubprocess('ok', 0, 30)
    const plat = platMod.createPlatformChannel({
      ctx: { get: () => null }, subprocess: slow, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      getMattSkillProbeNames: async () => [], probeSkill: async () => ({ level: 'ok' }), logCtx,
    })
    await plat.detectionExec('gh', ['api', 'user'], { cwd: CWD, timeout: 30000 })
    const ms = logCtx.lines[0] ? logCtx.lines[0].fields.latencyMs : -1
    check(ms >= 25, '耗时跟着命令真的走（假子进程慢 30 毫秒，记下 ' + ms + ' 毫秒），不是写死的 0')
  }

  // ---- 三、开关关闭：一条都不落，连时钟都不读（唯一代价是读一次开关） ----
  {
    const logCtx = makeLogCtx(false)
    const subprocess = makeSubprocess('ok')
    // 故意让外部命令本身不读时钟（假子进程与假计时器都不读），这样窗口内数到的 Date.now 只可能来自日志点。
    const plat = platMod.createPlatformChannel({
      ctx: { get: () => null }, subprocess, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      getMattSkillProbeNames: async () => [], probeSkill: async () => ({ level: 'ok' }), logCtx,
    })
    const repo = repoMod.createRepoKeys({
      subprocess, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      repoKeys: {}, repoRoots: {}, getGhPath: () => null, setGhPath: () => {}, getGhLastError: () => null, setGhLastError: () => {},
      getPlatform: async () => null, getWorkspaceStore: async () => null, setCache: () => {}, clearWorkspaceStore: () => {},
      namingSweepSoon: () => {}, parseGithubRepo: () => null, logCtx,
    })
    const rounds = 5
    const nowCalls = await countDateNow(async () => {
      for (let i = 0; i < rounds; i++) {
        await plat.detectionExec('gh', ['api', 'user'], { cwd: CWD, timeout: 30000 })
        await repo.execProc(['git', 'status'], CWD)
      }
    })
    check(logCtx.fireCalls === 0, '关闭时一行都不落（fire 调用 ' + logCtx.fireCalls + ' 次），所以没有任何东西进队列')
    check(logCtx.lines.length === 0, '关闭时字段对象一个都没收到（收到 ' + logCtx.lines.length + ' 个）')
    check(nowCalls === 0, '关闭时日志点连时钟都不读（窗口内 Date.now 调用 ' + nowCalls + ' 次），说明起始时刻与字段对象都没产生')
    check(logCtx.isEnabledCalls === rounds * 2, '关闭时每条命令只读一次开关（实得 ' + logCtx.isEnabledCalls + ' 次，命令 ' + (rounds * 2) + ' 条）')
    check(subprocess.calls.length === rounds * 2, '关闭时外部命令照常起（实得 ' + subprocess.calls.length + ' 次），测点不影响主流程')
  }

  // ---- 四、整条回路走一遍：开关打开 → 起外部命令 → 落盘 → 从日志文件里读出次数与每次耗时 ----
  // 这一段用的是真的日志库（src/host/logStore.js）与真的落盘文件，只是把子进程与文件位置换成临时的，
  // 所以它给出的数字就是「打开调试开关后，日志里到底看得到什么」。
  {
    const logStoreMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'logStore.js')).href)
    const tmpDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'dsws-606-'))
    const fsSvc = {
      async readText(p) { try { return nodeFs.readFileSync(p, 'utf8') } catch (e) { return '' } },
      async writeText(p, text) { nodeFs.mkdirSync(path.dirname(p), { recursive: true }); nodeFs.writeFileSync(p, text); return true },
      async mkdir(p) { try { nodeFs.mkdirSync(p, { recursive: true }) } catch (e) {} },
      async resolve(p) { return p },
    }
    const store = logStoreMod.createLogStore({
      fs: fsSvc, timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
      getCacheDir: async () => tmpDir, getPlatform: async () => null, DEFAULT_CWD: tmpDir,
    })
    await store.setSwitch(true, 1)
    const logCtx = {
      isEnabled: (level) => store.isEnabled(level),
      fire: (level, event, fieldsOrFn) => store.log(level, event, (typeof fieldsOrFn === 'function') ? fieldsOrFn() : fieldsOrFn),
    }
    const slow = makeSubprocess('ok', 0, 20)
    const plat = platMod.createPlatformChannel({
      ctx: { get: () => null }, subprocess: slow, timer: makeTimer(), fs: {}, DEFAULT_CWD: CWD, TIMEOUT_MS: 30000,
      getMattSkillProbeNames: async () => [], probeSkill: async () => ({ level: 'ok' }), logCtx,
    })
    const rounds = 3
    for (let i = 0; i < rounds; i++) await plat.detectionExec('gh', ['api', 'user'], { cwd: CWD, timeout: 30000 })
    store.flush()
    await new Promise((r) => setTimeout(r, 50))

    const logFile = path.join(tmpDir, 'logs', logStoreMod.formatLogFileName(new Date()))
    const exist = nodeFs.existsSync(logFile)
    check(exist, '开关打开后日志真的落到盘上（' + (exist ? logFile.replace(tmpDir, '<临时目录>') : '没找到 ' + logFile.replace(tmpDir, '<临时目录>')) + '）')
    let rows = []
    if (exist) {
      rows = nodeFs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
    }
    const execRows = rows.filter((r) => r.event === 'exec.run')
    check(execRows.length === rounds, '从日志文件里数得出调用次数：起了 ' + rounds + ' 次命令、文件里有 ' + execRows.length + ' 条 exec.run')
    check(execRows.every((r) => r.level === 'debug'), '日志文件里的 exec.run 都是调试级别（按需级）')
    check(execRows.every((r) => r.fields && r.fields.argv0 === 'gh'), '每行都带命令名 gh')
    check(execRows.every((r) => r.fields && /^[0-9a-f]{8}$/.test(String(r.fields.cwdHash))), '每行的工作区都是八位短指纹，落盘无原始路径：' + (execRows[0] ? String(execRows[0].fields.cwdHash) : '无'))
    const latencies = execRows.map((r) => r.fields && r.fields.latencyMs)
    check(latencies.length === rounds && latencies.every((m) => typeof m === 'number' && m >= 15), '每次耗时逐个读得出来（假子进程慢 20 毫秒，实得 ' + latencies.join('、') + ' 毫秒）')
    const rawLeak = nodeFs.existsSync(logFile) && nodeFs.readFileSync(logFile, 'utf8').indexOf('private-workspace') >= 0
    check(!rawLeak, '整份日志文件里没有出现工作区原始路径')
    console.log('  样例（同一次运行里连续三行，逐行自己的毫秒数）：')
    for (const r of execRows) console.log('    ' + JSON.stringify(r))
    try { nodeFs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
  }

  // ---- 五、客户端：临时测点撤干净了，正式的 panel.render 能用 ----
  // 先按文本核：这是本仓库对客户端文件惯用的核实方式（渲染目录没法直接跑起来）。
  {
    const read = (rel) => nodeFs.readFileSync(path.join(ROOT, rel), 'utf8')
    const routerSrc = read(path.join('src', 'client', 'kernel', 'router.js'))
    const dockSrc = read(path.join('src', 'client', 'panel', 'Dock.js'))
    const dockSyncSrc = read(path.join('src', 'client', 'panel', 'DockSync.js'))
    const listTabSrc = read(path.join('src', 'client', 'views', 'ListTab.js'))

    // 1) panel.open 只剩正式那一条，字段还是原来那六个，没有多也没有少。
    const panelOpenSites = routerSrc.split('\n').filter((l) => l.includes("'panel.open'"))
    check(panelOpenSites.length === 1, 'panel.open 只剩一行记录点（实得 ' + panelOpenSites.length + ' 行）')
    const formalOk = panelOpenSites.length === 1 && ['mode', 'hasCache', 'snapFresh', 'keyHash', 'snapVersion', 'backendId'].every((k) => panelOpenSites[0].includes(k + ':')) && panelOpenSites[0].includes("log('info', 'panel.open'")
    check(formalOk, 'panel.open 仍是原来那条正式记录（信息级、六个字段：mode、hasCache、snapFresh、keyHash、snapVersion、backendId）')
    // 2) 把耗时编码进 mode 取值的临时写法没了。
    const tempModes = ['sidebar-t0', 'sidebar-beforeTab', 'sidebar-ensureDone', 'sidebar-tabReturned', 'sidebar-painted', 'dock-render', 'loaf-late']
    const leftOver = tempModes.filter((m) => routerSrc.includes(m) || dockSyncSrc.includes(m) || dockSrc.includes(m) || listTabSrc.includes(m))
    check(leftOver.length === 0, '临时写在 mode 取值里的那几个名字全撤了' + (leftOver.length ? ' —— 残留：' + leftOver.join('、') : '（查过 ' + tempModes.length + ' 个）'))
    // 3) 挂在全局变量与状态对象上的临时计时字段全撤了。
    const tempGlobals = ['__dswsLoaf', '__dswsDockRenderStart', '__dswsDockRenderLogged', '__dswsDockCommitMs', '__dswsDockSeg', '__dswsMarkFn', '__dswsFitMs', '__openMs', '_dswsLoafText']
    const globalsLeft = tempGlobals.filter((g) => routerSrc.includes(g) || dockSyncSrc.includes(g) || dockSrc.includes(g) || listTabSrc.includes(g))
    check(globalsLeft.length === 0, '全局变量与状态对象上的临时计时字段全撤了' + (globalsLeft.length ? ' —— 残留：' + globalsLeft.join('、') : '（查过 ' + tempGlobals.length + ' 个）'))
    // 4) 四个文件都往同一个计时对象写，阶段名齐。
    const stages = ['sidebar-registered', 'sidebar-opened', 'render-commit', 'render-paint', 'fit-measure', 'click-to-painted']
    const missingStage = stages.filter((s) => !(routerSrc + dockSyncSrc).includes("'" + s + "'"))
    check(missingStage.length === 0, '六个阶段名都在代码里' + (missingStage.length ? ' —— 缺：' + missingStage.join('、') : '（' + stages.join('、') + '）'))
    check(routerSrc.includes('panelClock') && dockSyncSrc.includes('panelClock') && dockSrc.includes('panelClock') && listTabSrc.includes('panelClock'), '四个文件共用同一个 panelClock 计时对象（启动、渲染、提交、折叠各自写自己那段）')
    check(!/\bglobalThis\b/.test(dockSyncSrc.split('\n').filter((l) => l.includes('panelClock')).join('')), '计时对象没挂在 globalThis 上')

    // 再按运行核：把 router.js 里那三段真代码抽出来，配假记录器跑一遍。
    const start = routerSrc.indexOf('export const panelClock')
    const end = routerSrc.indexOf('export const openPagePanel')
    check(start >= 0 && end > start, '能从 router.js 里抽到计时与记日志那三段真代码')
    let lines = []
    let enabled = false
    const body = routerSrc.slice(start, end).replace(/^\s*export\s+/gm, '')
    const factory = new Function('isEnabled', 'log', body + '\nreturn { panelClock: panelClock, panelNow: panelNow, logPanelStage: logPanelStage };')
    const mod = factory(
      (level) => (level === 'error' || level === 'warn') ? true : enabled,
      (level, event, fields) => { lines.push({ level, event, fields }) }
    )
    mod.logPanelStage('click-to-painted', 123)
    check(enabled === false && lines.length === 0, '关闭时记阶段一行都不落（实得 ' + lines.length + ' 行）')
    enabled = true
    mod.panelClock.mode = 'sidebar'
    mod.panelClock.t0 = mod.panelNow()
    mod.logPanelStage('sidebar-registered', 3)
    mod.logPanelStage('render-commit', 7)
    mod.logPanelStage('render-paint', 9)
    mod.logPanelStage('fit-measure', 2)
    mod.logPanelStage('click-to-painted', 179)
    check(lines.length === 5, '打开时每个阶段各落一行（实得 ' + lines.length + ' 行）')
    check(lines.every((l) => l.event === 'panel.render' && l.level === 'debug'), '五行都是调试级的 panel.render（按需级）')
    const msRead = lines.map((l) => l.fields && l.fields.ms)
    check(msRead.join(',') === '3,7,9,2,179', '每行都带自己那段的毫秒数，各段读得出（实得 ' + msRead.join('、') + '）')
    check(lines.every((l) => Object.keys(l.fields).sort().join(',') === 'mode,ms,stage'), '字段恰为白名单三项（stage、ms、mode）')
    check(lines.every((l) => l.fields.mode === 'sidebar'), '每行都带打开形态（sidebar）')
    console.log('  样例（同一轮打开的五条阶段行，逐行自己的毫秒数）：')
    for (const l of lines) console.log('    ' + JSON.stringify({ level: l.level, event: l.event, fields: l.fields }))
  }

  console.log(failed ? '\n存在失败 — verify-log-exec-606 未通过' : '\n全部通过 — 外部命令测点门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
