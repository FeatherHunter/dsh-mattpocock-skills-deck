// src/host/gitCredentialExec.js —— 安全地跑「可能弹凭据提示」的 git 命令（#839）
//
// 这一层是地图 810「拉取/推送在面板里点得完」的前置：git 需要凭据时会在终端等输入、或者让凭据助手
// 弹一个 GUI 窗口，插件现在起进程一律把标准输入钉成 ignore，碰上就挂住。这个文件给出「能安全地跑」
// 的那条路径与它的事故边界。命令口径（跑什么参数）归后面那张实现票，这里只管「怎么跑才安全」。
//
// 设计（每一条都有 .tmp-839-attack/REPORT.md 的真机实测撑腰）：
//   1. 非交互环境做成这一族命令的固定前缀，本文件一处集中（别散到调用点）：GIT_TERMINAL_PROMPT=0
//      （终端提示变快失败，实测 56ms）+ GCM_INTERACTIVE=never 与 -c credential.interactive=false
//      （GCM 不许弹窗提问，实测 0.4-0.5 秒快失败）+ 清掉 GIT_ASKPASS/SSH_ASKPASS/DISPLAY（继承来的
//      GUI askpass 是隐藏地雷：实测 GIT_TERMINAL_PROMPT=0 拦不住它，它一睡就挂）+ ssh 走 BatchMode
//      （关掉口令提问与主机密钥确认框）+ http 传输的低速放弃阈值。
//   2. 只有开关不够：helper/askpass 自己卡住、黑洞代理、对端不回包这三类，任何环境变量都救不了
//      （实测都在 6 秒后被强杀）。所以还要「每操作预算 + 调用级总预算」兜底；到点由共享出口
//      handle.terminate() 拆掉整个受管进程范围（DSH 在 Windows 上用 Job 对象覆盖整棵进程树）。
//   3. 停顿判据两条：① git 自己的 GIT_HTTP_LOW_SPEED_LIMIT/TIME（传输停住它自己放弃，放弃时给的是
//      一次普通的非零退出，我们按 stalled 归类）；② 预算到点强杀。宿主收集器的字节增长看门狗本票
//      没做——它要改共享出口 runGit 的竞速逻辑，超出「只把预算参数化」的范围，列进后续票。
//   4. 失败分档（need-credentials / auth-rejected / no-permission / network / stalled / timeout /
//      budget-exhausted / spawn-failed / other），每档一句能照做的话。卡住的角色按「最可能的那个」报
//      （凭据助手名 / ssh / 远端），因为插件上下文里没有进程表 API，真正的进程树枚举做不到。
//
// 与既有出口的关系（#839 第 3 条：不许另起一套起进程的代码）：本文件自己不起进程、不写 spawn、
// 不自己打日志。它把 argv 与环境交给注入的 runGit —— 就是 src/host/versionControl.js 里那一个出口，
// 于是自然共用同一条 subprocess 服务、同一套字节上限与超时、同一条 git.exec / git.exec.fail 事件、
// 同一个 gate.noteOutbound 报闸与同一份四情形返回值。
//
// 边界（这一版明确不做，写在这里免得后人误会）：
//   * 不保存凭据：本文件不读、不写、不复制任何令牌或密码；也不把凭据助手的回显带进回包。
//   * 不改用户的 git 配置：只在这一次进程的命令行上用 -c 覆盖，不写任何 gitconfig。
//   * 不代替用户登录：需要登录时只回一句话，指去侧栏终端手跑一次；没有登录流程、没有浏览器跳转。
//   * 不在没有用户点击时发起网络动作：本文件不排定时器、不自动重试；每次调用都由调用方在一次用户
//     动作里发起，出站前先经共享出口报闸。
//   * 不决定跑什么命令：argv 由调用方给；也判断不了「这条命令是不是写操作」。
//
// 默认档与更狠的一档：默认**保留**用户的凭据助手，只把它按成非交互。理由是摘掉助手会让「已配好
// 凭据助手」的机器永远认证不上，而那正是地图终点要支持的情形；需要「一个助手都不许碰」的场合
// （公开仓库的匿名读探针、或排查用的一次性命令）传 clearHelpers:true，会额外加 -c credential.helper=。

/** 每类操作的默认预算（毫秒）：写操作要联网，给得比只读命令宽；到点一律强杀。 */
export const OPERATION_BUDGETS = { 'ls-remote': 20000, fetch: 120000, pull: 180000, push: 120000, default: 60000 }
/** 一次调用的总预算默认值（毫秒）：一次调用里跑几步也不许超过它。 */
export const CALL_BUDGET_MS = 240000
const MIN_BUDGET_MS = 1000
const MAX_BUDGET_MS = 600000
/** http 传输低于 1000 字节/秒、连续这么多秒就放弃。这个开关对抗式报告里没实测过，本票实测：黑洞服务下 2 秒即由 git 自己放弃（Operation too slow，exit 128），比预算强杀更早、更干净。 */
const LOW_SPEED_SECONDS = 20
const LOW_SPEED_LIMIT = '1000'

/** 把 git 的话归类成稳定标识符；顺序有意义：先认「传输停住」，再认凭据三档，最后才是网络。 */
export function classifyGitFailure(exitCode, text) {
  const t = String(text || '').toLowerCase()
  if (/operation too slow|low speed limit|timed out after \d+ milliseconds with 0 bytes|rpc failed.*timed out/.test(t)) return 'stalled'
  if (/terminal prompts disabled|cannot prompt because user interactivity has been disabled|could not read username|could not read password|unable to get password|failed to execute prompt script|no such device or address/.test(t)) return 'need-credentials'
  if (/authentication failed|invalid username or password|could not authenticate|401 unauthorized|returned error: 401/.test(t)) return 'auth-rejected'
  if (/permission to .* denied|repository not found|not found|403 forbidden|returned error: 403|access denied|you do not have permission|publickey/.test(t)) return 'no-permission'
  if (/could not resolve host|connection (refused|timed out|reset)|network is unreachable|failed to connect|proxy|ssl|tls|unable to access/.test(t)) return 'network'
  return 'other'
}

/** 每一档给一句能照做的话；界面直接显示它，不自己编词。 */
export function hintFor(kind) {
  if (kind === 'need-credentials') return '这台机器上 git 拿不到凭据，而我们已经把「问用户」关掉了。请你在右侧栏终端里手动跑一次同样的操作（例如 git fetch）把登录做完，再回来重试。'
  if (kind === 'auth-rejected') return '远端不认这台机器上的凭据（多半过期或被撤销）。请在右侧栏终端里重新登录一次再回来。'
  if (kind === 'no-permission') return '凭据是有效的，但这个账号对目标仓库没有权限。请换一个有权限的账号，或让仓库管理员开权限。'
  if (kind === 'network') return '连不上远端（网络或代理问题），与凭据无关；检查网络或代理之后重试。'
  if (kind === 'stalled') return '传输停住了：远端在低速阈值内没有继续送数据，git 自己放弃了这次传输。换网络或稍后重试。'
  if (kind === 'timeout') return '这条命令在预算时间内没有回话，已经把它整棵停掉了（这样做是为了不挂在等输入上）。稍后重试；若反复如此，按上面那句「疑似卡在」去查。'
  if (kind === 'budget-exhausted') return '这一次操作的总预算用完了，后面的步骤没有开始。请分开操作，或稍后再试。'
  if (kind === 'spawn-failed') return 'git 进程没起来（环境问题，不是凭据问题）。请确认这台机器上装了 git 并且能找到它。'
  if (kind === 'env') return '宿主现在拿不到 git 命令或进程出口，这一步做不了。'
  if (kind === 'args') return '这一步没有给出要跑的 git 参数。'
  return 'git 报了一个我们没归类的失败；上面那行是它的原话。'
}

/** 造一个安全执行器；依赖全部由入口显式传入（runGit 就是那条共享的 git 进程出口）。 */
export function createCredentialSafeGit(deps) {
  const { runGit, getPlatform, getEnv, DEFAULT_CWD } = deps || {}

  /** 非交互的 argv 前缀：helper 的非交互开关；clearHelpers 时再把一切助手摘掉。 */
  function nonInteractiveArgs(clearHelpers) {
    const args = ['-c', 'credential.interactive=false']
    if (clearHelpers === true) args.push('-c', 'credential.helper=')
    return args
  }

  /** ssh 那条路：BatchMode 关提问、accept-new 免掉主机密钥确认框、ConnectTimeout 管连接不回的远端。 */
  function sshCommand(callBudgetMs) {
    const sec = Math.max(5, Math.min(60, Math.round(callBudgetMs / 1000)))
    const guard = '-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=' + sec
    let inherited = ''
    try { if (typeof getEnv === 'function') inherited = String(getEnv('GIT_SSH_COMMAND') || '') } catch (e) {}
    return inherited ? (inherited + ' ' + guard) : ('ssh ' + guard)
  }

  /**
   * 固定非交互环境。值为 undefined 的键是 DSH 的子进程环境「墓碑」：它会把这一项从继承环境里删掉
   * （README 原文：显式的 undefined 墓碑值则移除一个普通的环境项）——清 GIT_ASKPASS 这类变量靠的就是它。
   */
  function nonInteractiveEnv(callBudgetMs) {
    const lowSpeedSeconds = (typeof deps.lowSpeedSeconds === 'number' && deps.lowSpeedSeconds > 0) ? Math.floor(deps.lowSpeedSeconds) : LOW_SPEED_SECONDS
    const lowSpeedLimit = (typeof deps.lowSpeedLimit === 'string' && deps.lowSpeedLimit) ? deps.lowSpeedLimit : LOW_SPEED_LIMIT
    return {
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C', // 失败分类靠英文正则（#841 第三批 ⑤）：把 git 的文案钉在英文，别跟着系统语言变
      LANG: 'C',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: undefined,
      SSH_ASKPASS: undefined,
      SSH_ASKPASS_REQUIRE: 'never',
      DISPLAY: undefined,
      GIT_SSH_COMMAND: sshCommand(callBudgetMs),
      GIT_HTTP_LOW_SPEED_LIMIT: lowSpeedLimit,
      GIT_HTTP_LOW_SPEED_TIME: String(lowSpeedSeconds),
    }
  }

  function clamp(v, fallback, min, max) {
    const n = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : NaN
    if (!isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }

  /** 按子命令取每操作默认预算；认不出的按 default 给。 */
  function budgetFor(args) {
    const sub = String((Array.isArray(args) && args[0]) || '')
    return OPERATION_BUDGETS[sub] || OPERATION_BUDGETS.default
  }

  function firstLine(text) { const t = String(text || '').replace(/\r/g, '').trim(); if (!t) return ''; const i = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).trim().slice(0, 300) }

  /** 真原因取最后一条 fatal:/error: 行（前面往往只是 GCM 之类的警告横幅）；一条都没有才退回首行。 */
  function reasonLine(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
    for (let i = lines.length - 1; i >= 0; i -= 1) if (/^(fatal|error):/i.test(lines[i])) return lines[i].slice(0, 300)
    return firstLine(text)
  }

  /** 给调用方留一条能看原文的尾巴：只留最后 1500 字，截断就标注（写层读不到 stderr 时靠它）。 */
  function tailOf(text) {
    const t = String(text || '').replace(/\r/g, '').trim()
    if (!t) return ''
    const LIMIT = 1500
    return t.length <= LIMIT ? t : '…（已截断，下面只留最后 ' + LIMIT + ' 字）' + '\n' + t.slice(t.length - LIMIT)
  }

  /** 失败信封的唯一真源（扁平信封；kind 是稳定标识符，话术在 hintFor；detail 是截断后的 stderr 尾巴，读不到 stderr 的调用方靠它）。 */
  function fail(kind, message, extra) {
    return Object.assign({ ok: false, kind: kind, message: message || '', detail: '', hint: hintFor(kind) }, extra || {})
  }

  /** 找 git 命令；找不到转成明确失败值，不抛。 */
  async function resolveGitExecutable() {
    try {
      const platform = await getPlatform()
      if (!platform || typeof platform.resolveExecutable !== 'function') return null
      const exe = await platform.resolveExecutable('git')
      return (typeof exe === 'string' && exe) ? exe : null
    } catch (e) { return null }
  }

  /** 这条命令看起来走不走 ssh（参数里带 ssh:// 或 scp 样式的地址）。 */
  function looksLikeSsh(args) {
    return (args || []).some(function (a) {
      const s = String(a)
      return /^ssh:\/\//.test(s) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(s)
    })
  }

  /** 卡住的角色：这一步只在失败之后才花一条本地 git 命令的钱（happy path 不付）。 */
  async function suspectOf(exe, cwd, args, kind) {
    if (looksLikeSsh(args)) return 'ssh 通道（这条命令走的是 ssh，凭据问题与服务端都要看它）'
    if (kind === 'timeout' || kind === 'need-credentials' || kind === 'auth-rejected' || kind === 'stalled') {
      const r = await runGit(exe, cwd, ['-C', cwd, 'config', '--get', 'credential.helper'], { timeoutMs: 5000, stdoutLimit: 4096 })
      const name = (r && r.kind === 'ok') ? String(r.stdout || '').trim() : ''
      if (name) return '本机配的凭据助手 ' + name + '（它没在预算内回话；也可能是远端或代理）'
      return '本机的凭据链（没有配凭据助手；也可能是远端或代理）'
    }
    return ''
  }

  /** 在截止时刻之内跑一条命令；返回扁平信封。 */
  async function runWithin(deadline, callOpts, request) {
    const started = Date.now()
    const req = request || {}
    const args = Array.isArray(req.args) ? req.args : []
    if (args.length === 0) return fail('args', '没有给出要跑的 git 参数')
    const total = Math.round(deadline - started)
    if (total < MIN_BUDGET_MS) return fail('budget-exhausted', '这一次操作的总预算已经用完，这一步没有开始')
    const exe = await resolveGitExecutable()
    if (!exe) return fail('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    if (typeof runGit !== 'function') return fail('env', '没有拿到共享的 git 进程出口（runGit）')
    const cwd = (typeof req.cwd === 'string' && req.cwd) ? req.cwd : DEFAULT_CWD
    const clearHelpers = req.clearHelpers === true || (callOpts && callOpts.clearHelpers === true)
    const perOp = clamp(req.timeoutMs, budgetFor(args), MIN_BUDGET_MS, MAX_BUDGET_MS)
    const budget = Math.max(MIN_BUDGET_MS, Math.min(perOp, total))
    const callBudget = (callOpts && callOpts.totalBudgetMs) || CALL_BUDGET_MS
    const argv = ['-C', cwd].concat(nonInteractiveArgs(clearHelpers), args)
    const env = nonInteractiveEnv(callBudget)
    const res = await runGit(exe, cwd, argv, { timeoutMs: budget, stdoutLimit: req.stdoutLimit, env: env, stallMs: req.stallMs })
    const elapsedMs = Date.now() - started
    if (res && res.kind === 'ok') return { ok: true, kind: 'ok', exitCode: 0, stdout: res.stdout, truncated: res.truncated === true, elapsedMs: elapsedMs }
    if (res && res.kind === 'timeout') {
      const suspect = await suspectOf(exe, cwd, args, 'timeout')
      return fail('timeout', '这条命令在 ' + budget + ' 毫秒里没有回话，已经整棵停掉', { exitCode: -1, elapsedMs: elapsedMs, suspect: suspect })
    }
    if (res && res.kind === 'stalled') { // #847：看门狗判的「传输停住」，与文字归类出来的 stalled 同一档
      const suspect = await suspectOf(exe, cwd, args, 'stalled')
      return fail('stalled', '命令的输出停了 ' + res.stallMs + ' 毫秒没有再增长，已经整棵停掉', { exitCode: -1, elapsedMs: elapsedMs, suspect: suspect })
    }
    if (!res || res.kind === 'spawn-failed') return fail('spawn-failed', '起不了 git 进程：' + String((res && res.message) || '未知'), { exitCode: -1, elapsedMs: elapsedMs })
    const text = String(res.stderr || '')
    const kind = classifyGitFailure(res.exitCode, text)
    const suspect = await suspectOf(exe, cwd, args, kind)
    const extra = { exitCode: res.exitCode, elapsedMs: elapsedMs, detail: tailOf(text) }
    if (suspect) extra.suspect = suspect
    return fail(kind, reasonLine(text) || ('git 退出码 ' + res.exitCode), extra)
  }

  /** 开一次调用：一次用户动作 = 一次调用，所有步骤共用这一份总预算。 */
  function startCall(opts) {
    const o = opts || {}
    const total = clamp(o.totalBudgetMs, CALL_BUDGET_MS, MIN_BUDGET_MS, MAX_BUDGET_MS)
    const deadline = Date.now() + total
    return {
      totalBudgetMs: total,
      remainingMs: function () { return Math.max(0, deadline - Date.now()) },
      run: function (request) { return runWithin(deadline, o, request) },
    }
  }

  /** 一次性调用（内部自己开一次调用）。 */
  function runOnce(request) { return startCall({}).run(request) }

  return {
    runOnce: runOnce,
    startCall: startCall,
    nonInteractiveArgs: nonInteractiveArgs,
    nonInteractiveEnv: nonInteractiveEnv,
    budgetFor: budgetFor,
    classify: classifyGitFailure,
  }
}
