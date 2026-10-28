/**
 * src/refresh/rooms/host/gh-execution.ts（来源：src/refresh/rooms/host/gh-execution.js，#839；本次只加类型标注与注释，逻辑一行未动；#1429 C8 把 gh 命令执行从 git-execution.js 并入，见文件尾那一节）。
 */
 // src/refresh/rooms/host/gh-execution.js —— 安全地跑「可能弹凭据提示」的 git 命令（#839）
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
//   * 不代替用户登录：需要登录时只回一句话，指去命令行手跑一次；没有登录流程、没有浏览器跳转。
//   * 不在没有用户点击时发起网络动作：本文件不排定时器、不自动重试；每次调用都由调用方在一次用户
//     动作里发起，出站前先经共享出口报闸。
//   * 不决定跑什么命令：argv 由调用方给；也判断不了「这条命令是不是写操作」。
//
// 默认档与更狠的一档：默认**保留**用户的凭据助手，只把它按成非交互。理由是摘掉助手会让「已配好
// 凭据助手」的机器永远认证不上，而那正是地图终点要支持的情形；需要「一个助手都不许碰」的场合
// （公开仓库的匿名读探针、或排查用的一次性命令）传 clearHelpers:true，会额外加 -c credential.helper=。

// 调用级预算、预算上下限、探针超时与每类操作的默认预算都住中央 YAML（config/timeouts.yaml 的
// gitCredentialCallBudgetMs / gitCredentialMinBudgetMs / gitCredentialMaxBudgetMs / gitCredentialProbeTimeoutMs
// 与 gitCredentialLsRemoteBudgetMs / gitCredentialFetchBudgetMs / gitCredentialPullBudgetMs /
// gitCredentialPushBudgetMs / gitCredentialDefaultBudgetMs 键）：这里直接引用中央常量，调时间改 YAML。
// 三个数的分工：CALL_BUDGET_MS 是「一次调用（一次用户动作）」的总预算默认值；MIN/MAX_BUDGET_MS 是夹取范围——
// 调用方给的每操作预算与总预算都要夹在这两个数之间（上限用来守住「到点强杀」这条兜底，别被一个大数废掉）。
// 路径走域构建产物写法（与 src/refresh/rooms/host/chain-coalescing.ts 引 values.js 同例），值由 tests/verify-time-config.ts 看守一致。
import { GIT_CREDENTIAL_CALL_BUDGET_MS as CALL_BUDGET_MS, GIT_CREDENTIAL_MIN_BUDGET_MS as MIN_BUDGET_MS, GIT_CREDENTIAL_MAX_BUDGET_MS as MAX_BUDGET_MS, GIT_CREDENTIAL_PROBE_TIMEOUT_MS, GIT_CREDENTIAL_LS_REMOTE_BUDGET_MS, GIT_CREDENTIAL_FETCH_BUDGET_MS, GIT_CREDENTIAL_PULL_BUDGET_MS, GIT_CREDENTIAL_PUSH_BUDGET_MS, GIT_CREDENTIAL_DEFAULT_BUDGET_MS, GIT_LOW_SPEED_TIMEOUT_MS, PROC_PROBE_GRACE_MS, PROC_GRACE_MS, GH_VERSION_PROBE_MS } from '../../../shared/time-config/src/values.js'

import { timeoutForGhArgs, queueTimeoutForTier, isWriteGhArgs, ghCommandLabel, normalizeGhStringFields, outboundCooldownOf, outboundQueueTimeoutOf, transportFailureReasonOf, ghCooldownReply } from '../../../tracker/kernel/outbound-tiers.js'
import { getGhLane } from './outbound-admission.js'
import { reportGhRunOutcome } from './gh-run-report.js'
import { getChainRide } from './chain-coalescing.js'
import { onceRelease, abandonCommand, startWaitTimeout, DISPOSED_MESSAGE } from '../../../shared/command-cleanup/src/command-cleanup.js'
/** 每类操作的默认预算（毫秒）：写操作要联网，给得比只读命令宽；到点一律强杀。
 *  真源是中央 YAML（config/timeouts.yaml 的 gitCredentialLsRemoteBudgetMs / gitCredentialFetchBudgetMs /
 *  gitCredentialPullBudgetMs / gitCredentialPushBudgetMs / gitCredentialDefaultBudgetMs 键），
 *  这里只把这些常量摆成「每类操作到常量名」的对照表，值由 tests/verify-time-config.ts 看守一致。 */
export const OPERATION_BUDGETS: Record<string, number> = { 'ls-remote': GIT_CREDENTIAL_LS_REMOTE_BUDGET_MS, fetch: GIT_CREDENTIAL_FETCH_BUDGET_MS, pull: GIT_CREDENTIAL_PULL_BUDGET_MS, push: GIT_CREDENTIAL_PUSH_BUDGET_MS, default: GIT_CREDENTIAL_DEFAULT_BUDGET_MS }
/** 一次调用的总预算默认值（毫秒）：一次调用里跑几步也不许超过它。导出名不许改：其它文件与门禁按这个名字读它。 */
export { CALL_BUDGET_MS } // 中央 YAML 的 gitCredentialCallBudgetMs（一次用户动作的总预算默认值）
// MIN_BUDGET_MS 是中央 YAML 的 gitCredentialMinBudgetMs：预算夹取的下限，低于它一步都跑不完
// MAX_BUDGET_MS 是中央 YAML 的 gitCredentialMaxBudgetMs：预算夹取的上限，防止调用方拿一个大数把强杀兜底废掉
/** http 传输低于 1000 字节/秒、连续这么多秒就放弃。这个开关对抗式报告里没实测过，本票实测：黑洞服务下 2 秒即由 git 自己放弃（Operation too slow，exit 128），比预算强杀更早、更干净。
 *  值住中央 YAML（config/timeouts.yaml 的 gitLowSpeedTimeoutMs，20 秒）：git 的 http.lowSpeedTime 只认秒，
 *  中央那份一律写毫秒，所以这里除以 1000；除法与这一档的毫秒数都由 tests/verify-time-config.ts 的 TEXT 表锁住。 */
const LOW_SPEED_SECONDS: number = GIT_LOW_SPEED_TIMEOUT_MS / 1000
const LOW_SPEED_LIMIT: string = '1000'

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖只有共享 git 出口、平台、环境读口三个（形状按本文件实际用到的成员写成最小），
// 全部用 any 接住；分类函数与提示函数收发都是字符串；执行器内部的预算、信封、怀疑对象全是运行时算出来的值，
// 类型只描述不约束，运行时行为一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：共享 git 出口 runGit、平台、环境读口，全由调用点显式传入。 */
interface CredentialSafeGitDeps {
  runGit: any
  getPlatform: any
  getEnv: any
  DEFAULT_CWD: any
  lowSpeedSeconds?: any
  lowSpeedLimit?: any
}

/** 把 git 的话归类成稳定标识符；顺序有意义：先认「传输停住」，再认凭据三档，最后才是网络。 */
export function classifyGitFailure(exitCode: any, text: any): string {
  const t: string = String(text || '').toLowerCase()
  if (/operation too slow|low speed limit|timed out after \d+ milliseconds with 0 bytes|rpc failed.*timed out/.test(t)) return 'stalled'
  if (/terminal prompts disabled|cannot prompt because user interactivity has been disabled|could not read username|could not read password|unable to get password|failed to execute prompt script|no such device or address/.test(t)) return 'need-credentials'
  if (/authentication failed|invalid username or password|could not authenticate|401 unauthorized|returned error: 401/.test(t)) return 'auth-rejected'
  if (/permission to .* denied|repository not found|not found|403 forbidden|returned error: 403|access denied|you do not have permission|publickey/.test(t)) return 'no-permission'
  if (/could not resolve host|connection (refused|timed out|reset)|network is unreachable|failed to connect|proxy|ssl|tls|unable to access/.test(t)) return 'network'
  return 'other'
}

/** 每一档给一句能照做的话；界面直接显示它，不自己编词。 */
export function hintFor(kind: any): string {
  if (kind === 'need-credentials') return '这台机器上 git 拿不到凭据，而我们已经把「问用户」关掉了。请你在命令行里手动跑一次同样的操作（例如 git fetch）把登录做完，再回来重试。'
  if (kind === 'auth-rejected') return '远端不认这台机器上的凭据（多半过期或被撤销）。请在命令行里重新登录一次再回来。'
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
export function createCredentialSafeGit(deps: CredentialSafeGitDeps): any {
  const { runGit, getPlatform, getEnv, DEFAULT_CWD } = (deps as any) || {}

  /** 非交互的 argv 前缀：helper 的非交互开关；clearHelpers 时再把一切助手摘掉。 */
  function nonInteractiveArgs(clearHelpers: any): string[] {
    const args: string[] = ['-c', 'credential.interactive=false']
    if (clearHelpers === true) args.push('-c', 'credential.helper=')
    return args
  }

  /** ssh 那条路：BatchMode 关提问、accept-new 免掉主机密钥确认框、ConnectTimeout 管连接不回的远端。 */
  function sshCommand(callBudgetMs: any): string {
    const sec: number = Math.max(5, Math.min(60, Math.round(callBudgetMs / 1000)))
    const guard: string = '-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=' + sec
    let inherited: string = ''
    try { if (typeof getEnv === 'function') inherited = String(getEnv('GIT_SSH_COMMAND') || '') } catch (e: any) {}
    return inherited ? (inherited + ' ' + guard) : ('ssh ' + guard)
  }

  /**
   * 固定非交互环境。值为 undefined 的键是 DSH 的子进程环境「墓碑」：它会把这一项从继承环境里删掉
   * （README 原文：显式的 undefined 墓碑值则移除一个普通的环境项）——清 GIT_ASKPASS 这类变量靠的就是它。
   */
  function nonInteractiveEnv(callBudgetMs: any): any {
    const lowSpeedSeconds: number = (typeof (deps as any).lowSpeedSeconds === 'number' && (deps as any).lowSpeedSeconds > 0) ? Math.floor((deps as any).lowSpeedSeconds) : LOW_SPEED_SECONDS
    const lowSpeedLimit: string = (typeof (deps as any).lowSpeedLimit === 'string' && (deps as any).lowSpeedLimit) ? (deps as any).lowSpeedLimit : LOW_SPEED_LIMIT
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

  function clamp(v: any, fallback: any, min: any, max: any): number {
    const n: number = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : NaN
    if (!isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }

  /** 按子命令取每操作默认预算；认不出的按 default 给。 */
  function budgetFor(args: any): number {
    const sub: string = String((Array.isArray(args) && args[0]) || '')
    return OPERATION_BUDGETS[sub] || OPERATION_BUDGETS.default
  }

  function firstLine(text: any): string { const t: string = String(text || '').replace(/\r/g, '').trim(); if (!t) return ''; const i: number = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).trim().slice(0, 300) }

  /** 真原因取最后一条 fatal:/error: 行（前面往往只是 GCM 之类的警告横幅）；一条都没有才退回首行。 */
  function reasonLine(text: any): string {
    const lines: string[] = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
    for (let i: number = lines.length - 1; i >= 0; i -= 1) if (/^(fatal|error):/i.test(lines[i])) return lines[i].slice(0, 300)
    return firstLine(text)
  }

  /** 给调用方留一条能看原文的尾巴：只留最后 1500 字，截断就标注（写层读不到 stderr 时靠它）。 */
  function tailOf(text: any): string {
    const t: string = String(text || '').replace(/\r/g, '').trim()
    if (!t) return ''
    const LIMIT: number = 1500
    return t.length <= LIMIT ? t : '…（已截断，下面只留最后 ' + LIMIT + ' 字）' + '\n' + t.slice(t.length - LIMIT)
  }

  /** 失败信封的唯一真源（扁平信封；kind 是稳定标识符，话术在 hintFor；detail 是截断后的 stderr 尾巴，读不到 stderr 的调用方靠它）。 */
  // 尾参 extra 标成可选：原 .js 里所有失败出口都只传两个实参（见下面 runWithin 等五处），少传在运行时就是 undefined，函数体用 `extra || {}` 兜住；标成必选 tsc 会报 2554，改成 `?` 不产生任何运行时代码。
  function fail(kind: any, message: any, extra?: any): any {
    return Object.assign({ ok: false, kind: kind, message: message || '', detail: '', hint: hintFor(kind) }, extra || {})
  }

  /** 找 git 命令；找不到转成明确失败值，不抛。 */
  async function resolveGitExecutable(): Promise<string | null> {
    try {
      const platform: any = await getPlatform()
      if (!platform || typeof platform.resolveExecutable !== 'function') return null
      const exe: any = await platform.resolveExecutable('git')
      return (typeof exe === 'string' && exe) ? exe : null
    } catch (e: any) { return null }
  }

  /** 这条命令看起来走不走 ssh（参数里带 ssh:// 或 scp 样式的地址）。 */
  function looksLikeSsh(args: any): boolean {
    return (args || []).some(function (a: any) {
      const s: string = String(a)
      return /^ssh:\/\//.test(s) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(s)
    })
  }

  /** 卡住的角色：这一步只在失败之后才花一条本地 git 命令的钱（happy path 不付）。 */
  async function suspectOf(exe: any, cwd: any, args: any, kind: any): Promise<string> {
    if (looksLikeSsh(args)) return 'ssh 通道（这条命令走的是 ssh，凭据问题与服务端都要看它）'
    if (kind === 'timeout' || kind === 'need-credentials' || kind === 'auth-rejected' || kind === 'stalled') {
      // 探针这一条（只在本步已经失败之后才跑，问一句本机配了什么凭据助手）：单条超时直接取中央 YAML 的
      // gitCredentialProbeTimeoutMs（GIT_CREDENTIAL_PROBE_TIMEOUT_MS）——给得短，探针不该把失败回包拖慢。
      const r: any = await runGit(exe, cwd, ['-C', cwd, 'config', '--get', 'credential.helper'], { timeoutMs: GIT_CREDENTIAL_PROBE_TIMEOUT_MS, stdoutLimit: 4096 })
      const name: string = (r && r.kind === 'ok') ? String(r.stdout || '').trim() : ''
      if (name) return '本机配的凭据助手 ' + name + '（它没在预算内回话；也可能是远端或代理）'
      return '本机的凭据链（没有配凭据助手；也可能是远端或代理）'
    }
    return ''
  }

  /** 在截止时刻之内跑一条命令；返回扁平信封。 */
  async function runWithin(deadline: any, callOpts: any, request: any): Promise<any> {
    const started: number = Date.now()
    const req: any = request || {}
    const args: any = Array.isArray(req.args) ? req.args : []
    if (args.length === 0) return fail('args', '没有给出要跑的 git 参数')
    const total: number = Math.round(deadline - started)
    if (total < MIN_BUDGET_MS) return fail('budget-exhausted', '这一次操作的总预算已经用完，这一步没有开始')
    const exe: any = await resolveGitExecutable()
    if (!exe) return fail('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    if (typeof runGit !== 'function') return fail('env', '没有拿到共享的 git 进程出口（runGit）')
    // #1003 契约（2026-10-12 维护者拍板）：拿不到工作区目录时如实失败，不许拿进程目录顶上——
    //   这一条会真的执行 git（凭据操作），落到别人的目录里就是在错的仓库上动手。
    const cwd: any = (typeof req.cwd === 'string' && req.cwd.trim()) ? req.cwd : ''
    if (!cwd) return fail('cwd', '这个工作区还没就绪（还没认出是哪个目录），所以这一次没有执行任何 git 命令')
    const clearHelpers: boolean = req.clearHelpers === true || (callOpts && callOpts.clearHelpers === true)
    const perOp: number = clamp(req.timeoutMs, budgetFor(args), MIN_BUDGET_MS, MAX_BUDGET_MS)
    const budget: number = Math.max(MIN_BUDGET_MS, Math.min(perOp, total))
    const callBudget: any = (callOpts && callOpts.totalBudgetMs) || CALL_BUDGET_MS
    const argv: any = ['-C', cwd].concat(nonInteractiveArgs(clearHelpers), args)
    const env: any = nonInteractiveEnv(callBudget)
    const res: any = await runGit(exe, cwd, argv, { timeoutMs: budget, stdoutLimit: req.stdoutLimit, env: env, stallMs: req.stallMs })
    const elapsedMs: number = Date.now() - started
    if (res && res.kind === 'ok') return { ok: true, kind: 'ok', exitCode: 0, stdout: res.stdout, truncated: res.truncated === true, elapsedMs: elapsedMs }
    if (res && res.kind === 'timeout') {
      const suspect: string = await suspectOf(exe, cwd, args, 'timeout')
      return fail('timeout', '这条命令在 ' + budget + ' 毫秒里没有回话，已经整棵停掉', { exitCode: -1, elapsedMs: elapsedMs, suspect: suspect })
    }
    if (res && res.kind === 'stalled') { // #847：看门狗判的「传输停住」，与文字归类出来的 stalled 同一档
      const suspect: string = await suspectOf(exe, cwd, args, 'stalled')
      return fail('stalled', '命令的输出停了 ' + res.stallMs + ' 毫秒没有再增长，已经整棵停掉', { exitCode: -1, elapsedMs: elapsedMs, suspect: suspect })
    }
    if (!res || res.kind === 'spawn-failed') return fail('spawn-failed', '起不了 git 进程：' + String((res && res.message) || '未知'), { exitCode: -1, elapsedMs: elapsedMs })
    const text: string = String(res.stderr || '')
    const kind: string = classifyGitFailure(res.exitCode, text)
    const suspect: string = await suspectOf(exe, cwd, args, kind)
    const extra: any = { exitCode: res.exitCode, elapsedMs: elapsedMs, detail: tailOf(text) }
    if (suspect) extra.suspect = suspect
    return fail(kind, reasonLine(text) || ('git 退出码 ' + res.exitCode), extra)
  }

  /** 开一次调用：一次用户动作 = 一次调用，所有步骤共用这一份总预算。 */
  function startCall(opts: any): any {
    const o: any = opts || {}
    const total: number = clamp(o.totalBudgetMs, CALL_BUDGET_MS, MIN_BUDGET_MS, MAX_BUDGET_MS)
    const deadline: number = Date.now() + total
    return {
      totalBudgetMs: total,
      remainingMs: function (): number { return Math.max(0, deadline - Date.now()) },
      run: function (request: any): Promise<any> { return runWithin(deadline, o, request) },
    }
  }

  /** 一次性调用（内部自己开一次调用）。 */
  function runOnce(request: any): Promise<any> { return startCall({}).run(request) }

  return {
    runOnce: runOnce,
    startCall: startCall,
    nonInteractiveArgs: nonInteractiveArgs,
    nonInteractiveEnv: nonInteractiveEnv,
    budgetFor: budgetFor,
    classify: classifyGitFailure,
  }
}

// ---------------------------------------------------------------------------
// gh 命令执行（#1429 C8 拆分：从 git-execution.ts 整段并入，只移动代码、行为零变化；
//  原来多缩进的两格在搬动时抹平，逻辑一字未动）。
//
// 为什么住这里：地图 C9 把「GitHub 调用怎么跑」判给本文件；原来它与 git 本地执行挤在
// 一个组装函数里，改 gh 超时要读完整文件的上下文。搬进来之后 gh 只改这一节。
// 组装关系：调用点（git-execution.ts 的 createRepoKeys）把 gh 专属依赖连同三个共享小件
// （reportOutbound、hash8、canonicalKey——两边共用，出站报账与散列状态只许有一份）显式传进来。
// ---------------------------------------------------------------------------

/** gh 调用的结果：成的那支一定带文本；败的那支带归一化类别与错误正文（code/text 不是每条都有）。 */
interface GhCallOk { ok: true; text: string }
interface GhCallFail { ok: false; kind: string; error: string | null; code?: number; text?: string }
type GhCallResult = GhCallOk | GhCallFail

/** createGhExecution 收到的依赖：gh 专属（缓存、平台、执行口、勾子）由接线处经 git 侧转供给；
 *  后三项是 git 执行侧供给的共享小件（报账、散列、目录归一），两边共用一份，不各留拷贝。 */
interface GhExecutionDeps {
  subprocess: any
  timer: any
  DEFAULT_CWD: any
  getGhPath: any
  setGhPath: any
  getGhLastError: any
  setGhLastError: any
  getPlatform: any
  getWorkspaceStore: () => Promise<{ clear(): unknown }>
  clearWorkspaceStore?: any
  setCache: any
  namingSweepSoon: any
  getChainBackoff?: () => Promise<{ noteWriteActivity(): unknown } | null | undefined>
  logCtx: any
  reportOutbound: any
  hash8: any
  canonicalKey: any
}

/** 造出 gh 执行三件套：找 gh 二进制、清 gh 缓存、跑一条 gh 命令。 */
export function createGhExecution(deps: GhExecutionDeps): { resolveGh: () => Promise<string | null>; resetGhCache: () => unknown; runGh: (args: string[], cwd: string, via?: string) => Promise<GhCallResult> } {
  const { subprocess, timer, DEFAULT_CWD, getGhPath, setGhPath, getGhLastError, setGhLastError, getPlatform, getWorkspaceStore, clearWorkspaceStore, setCache, namingSweepSoon, getChainBackoff, logCtx, reportOutbound, hash8, canonicalKey } = deps
  let lastNormKind = ''
  // ============ gh 封装 ============
  // #195 修复：resolveGh 不再缓存失败（ghLastError 仅最近一次失败，环境修复后下次探测即恢复）
  async function resolveGh(): Promise<string | null> {
    if (getGhPath()) return getGhPath()
    const platform = await getPlatform()
    // 2026-08-29 去重（research 实锤「DSH_GH_PATH 三端不一致」）：DSH_GH_PATH 兜底已下沉至 composePlatform
    //   通用层单点拥有（platform.resolveExecutable('gh') 内置 env.get+lstat 校验），此处不再重复实现，
    //   host 只保留未命中的诚实错误信息与 ghPath 缓存。
    const p = await platform.resolveExecutable('gh').catch(function () { return null })
    if (p) { setGhPath(p); setGhLastError(null); return p }
    // 回退：platform 未找到时，直接探测 gh 是否在 PATH 可执行（与 pwsh 的 where gh 一致）
    // 避免因 subprocess.resolveExecutable 的 PATH 与用户终端 PATH 分叉导致 414 这类外部建票永远拉不到
    try {
      // #723（T19）：这一条 `gh --version` 探测也是一笔真实出站（虽然不扣配额），照记一笔。
      reportOutbound(['--version'])
      const probeHandle = subprocess.spawn({ argv: ['gh', '--version'], cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: PROC_PROBE_GRACE_MS })
      // #1392：下面建计时器那一步在实例已销毁时会同步抛错，race 根本不会被调用；先给 done 接一个空处理，
      //   免得这条探活子进程后来失败时变成未处理拒绝、把宿主带走（这个计时器本身按票面边界另票处理）。
      void probeHandle.done.catch(function () {})
      const probeOutcome = await Promise.race([probeHandle.done, timer.timeout(GH_VERSION_PROBE_MS).then(function(){ try{ probeHandle.terminate(); }catch(e){} return { exitCode: -1 } })])
      const outProbe = (probeHandle.collected && probeHandle.collected.stdout) ? probeHandle.collected.stdout.readFrom(0) : { text: '' }
      if (probeOutcome && probeOutcome.exitCode === 0 && String(outProbe.text||'').includes('gh version')) { setGhPath('gh'); setGhLastError(null); return 'gh' }
    } catch {}
    setGhLastError('gh 不可用：DSH 启动时继承的 PATH 中未解析到 gh 可执行文件（不代表未安装；若已安装，将 gh 所在目录加入 PATH 或将 DSH_GH_PATH 设为 gh 可执行文件的绝对路径，再重启 DSH；确认未安装时访问 https://cli.github.com/）')
    try { if (logCtx) { let hasGhPath = false; try { hasGhPath = !!(platform && platform.env && platform.env.get && platform.env.get('DSH_GH_PATH')) } catch (eH) {} logCtx.fire('warn', 'gh.resolve.fail', { hasDSH_GH_PATH: hasGhPath, errorHash: hash8(getGhLastError()) }) } } catch (eL) {}
    return null
  }
  // #195 修复：force 探测路径调 resetGhCache 清空成功缓存，强制下次 resolveGh 重探
  function resetGhCache() { setGhPath(null); setGhLastError(null); try { if (typeof clearWorkspaceStore === 'function') clearWorkspaceStore(); } catch {} try { getWorkspaceStore().then(function(ws){ try{ ws.clear(); }catch(e){} }).catch(function(){}); } catch {} }

  // #1101：第三个参数 via 是「这一次 gh 调用是谁发的、走的哪一支」（调用点写死的短标签，例如
  //   repoAccess / ghAuth）。从前函数只认前两位、多传的第三个被丢掉，宿主那一路的 gh.exec 行
  //   因此全是不带 via 的空格（2026-10-20 一天 51,564 行），事后分不出探测、面板读、改票各占多少。
  async function runGh(args: string[], cwd: string, via?: string): Promise<GhCallResult> {
    // #1375：gh 的 -F 会把纯数字 owner 发成 JSON 数字，GraphQL 的 String! 直接拒收；出站前归一成 -f。
    args = normalizeGhStringFields(args)
    const ghT0 = Date.now()
    // #1003 契约（2026-10-12 维护者拍板）：拿不到工作区目录时如实失败，不许拿进程目录顶上——
    //   gh 命令会按工作区解析仓库身份（`gh repo view`、`gh api` 等），落到别人的目录就是在错的仓库上读或写。
    //   这一条发生在拿名额之前，所以没有名额要还；如实回一条环境档失败，让调用方按「还没就绪」处理。
    if (!(typeof cwd === 'string' && cwd.trim())) {
      try { if (logCtx) logCtx.fire('warn', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: ghCommandLabel(args), cwdHash: hash8(''), latencyMs: Date.now() - ghT0, kind: 'no-cwd', exitCode: -1 }) } catch (eL) {}
      return { ok: false, kind: 'env', error: '这个工作区还没就绪（还没认出是哪个目录），所以这一次没有执行任何 gh 命令' }
    }
    // #969 分档超时（读短写长探活最短）；#965 读写分桶拿名额（满了等；不传取消信号，拿不到只会等不会抛）。
    const rkBucket = isWriteGhArgs(args) ? 'write' : 'read'
    const rkTimeout = timeoutForGhArgs(args)
    // #960 复核：排队段单独计时。gh.exec 的 latencyMs 含排队（从进函数算起），waitedMs 只记排队这一段，
    //   两者一减就是命令自己的耗时 —— 票面问「是命令慢还是守在门口」时靠这两个数分辨。
    const rkWaitT0 = Date.now()
    // 这一条是哪一类 gh 命令（#1007）：所有日志行、冷却回话与失败上报共用一个短标签。
    const rkCmd = ghCommandLabel(args)
    // #1570：排队拿名额这一段也要有时间上限，但「等多久」改由准入闸自己管 ——
    //   这里只把预算（本档预算与中央配置 ghQueueWaitTimeoutMs 里更小的那个）递给闸，
    //   到点由闸抛排队超时、并负责把晚到的名额放回队列；不再由这里起表赛跑、也不再自己归还。
    //   拿到名额之后起进程的等待仍按本档超时算，不在闸里。
    const rkQueueCtrl = (typeof AbortController === 'function') ? new AbortController() : null
    const rkQueueTimeout = queueTimeoutForTier(rkTimeout)
    let rkRelease: (() => void) | null = null
    try {
      rkRelease = await getGhLane(logCtx).acquire({ bucket: rkBucket, signal: rkQueueCtrl ? rkQueueCtrl.signal : undefined, cmd: rkCmd, service: 'github', waitMs: rkQueueTimeout })
    } catch (eAcq) {
      const rkWaitedMs = Date.now() - rkWaitT0
      // 到点是排队的表掐的（host-queue），不是命令自己慢：日志把这一层写清楚，回话也说清一次没跑起来。
      if (outboundQueueTimeoutOf(eAcq)) {
        try { if (logCtx) logCtx.fire('warn', 'gh.timeout', { argv0: 'gh', timeoutMs: rkQueueTimeout, layer: 'host-queue', via: String(via || ''), cmd: rkCmd, waitedMs: rkWaitedMs, phase: 'queue' }) } catch (eL) {}
        try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'network', exitCode: -1 }) } catch (eL) {}
        return { ok: false, kind: 'network', code: -1, error: 'gh 在 ' + rkQueueTimeout + ' 毫秒内没等到出站名额（命令 ' + (rkCmd || 'gh') + '；排队上限 ' + rkQueueTimeout + ' 毫秒，本档预算 ' + rkTimeout + ' 毫秒；到点时它还在排队，一次都没有跑起来）。这一笔已经中止。' }
      }
      // 冷却期间拿名额会被准入闸直接拒绝（code=admission-cooldown）：这一笔没有起进程，
      // 回一句「通路不通」比笼统的「限时没回来」有用；这句和房间 client、平台通道共用 outbound-tiers 的口径。
      if (outboundCooldownOf(eAcq)) {
        try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'network', exitCode: -1 }) } catch (eL) {}
        return { ok: false, kind: 'network', code: -1, error: ghCooldownReply(eAcq, rkCmd) }
      }
      throw eAcq
    }
    // #1392：归还包成幂等，下面每条退出路径都调 releaseSlot()，保证恰好一次。
    const releaseSlot = onceRelease(rkRelease)
    const rkWaitedMs = Date.now() - rkWaitT0
    const exe = await resolveGh()
    if (!exe) { releaseSlot(); return { ok: false, kind: 'env', error: getGhLastError() } }
    // #723（T19）：这一笔真实出站先报给闸（I1 的唯一出口）。报在拿名额之后 —— 真要起进程了才报；
    // resolveGh 失败那一条根本没有出站，不该记进账。
    reportOutbound(args)
    let handle
    try {
      handle = subprocess.spawn({
        argv: [exe].concat(args),
        cwd: cwd, // 走到这里 cwd 一定非空（空的那条在上面早返回了）：不再写「缺省回退兜底值」那种死写法
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
        graceMs: PROC_GRACE_MS,
      })
    } catch (e) {
      // #1007：进程根本没起来也是 transport 级失败（spawn-failed）：同一只桶进入冷却窗口，
      // 随后调用立刻回「通路不通」，不再一次一次重新赔满超时。
      try { getGhLane(logCtx).reportTransportFailure({ bucket: rkBucket, reason: 'spawn-failed', cmd: rkCmd }) } catch (eR) {}
      try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'spawn', exitCode: -1 }) } catch (eL) {}
      releaseSlot()
      return { ok: false, kind: 'spawn', error: String((e && (e as { message?: unknown }).message) || e) }
    }
    // #969：等待上限按本条命令的分档暂定值（读短、写长、探活最短），不再一律 30 秒。
    // #1392：实例已经被销毁时，建计时器这一步会同步抛 INACTIVE_EFFECT。startWaitTimeout 先收尾
    //   （还名额、终止子进程、接住 done）再返回 null；其它错误收完尾照旧抛，保持原行为。
    const to = startWaitTimeout(timer, rkTimeout, function () { abandonCommand(handle, releaseSlot) })
    if (!to) {
      try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: ghCommandLabel(args), cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'disposed', exitCode: -1 }) } catch (eL) {}
      return { ok: false, kind: 'disposed', error: DISPOSED_MESSAGE }
    }
    let outcome
    try {
      outcome = await Promise.race([
        handle.done,
        to.then(function () { handle.terminate(); return { exitCode: -1, signal: 'timeout' } }),
      ])
    } catch (e) {
      // #1392：这一路是「计时器已经建出来、实例随后才被销毁」——计时器被撤销时它的 Promise 会以拒绝
      //   落定，race 跟着拒绝。收尾与销毁那一档相同；失败类别仍按原行为报 spawn：这一路也可能是
      //   子进程自己失败，两种错误形状在这里分不开，不新增 kind 值。
      abandonCommand(handle, releaseSlot)
      // 这一路可能是子进程自己失败，也可能是计时器被销毁连累到 race；认得出是 transport 类才设冷却。
      try { const rkR = transportFailureReasonOf(String((e && (e as { message?: unknown }).message) || e)); if (rkR) getGhLane(logCtx).reportTransportFailure({ bucket: rkBucket, reason: rkR, cmd: rkCmd }) } catch (eR) {}
      try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'spawn', exitCode: -1 }) } catch (eL) {}
      return { ok: false, kind: 'spawn', error: String((e && (e as { message?: unknown }).message) || e) }
    }
    const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
    const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
    const all = (err.text || '') + (out.text || '')
    if (outcome.exitCode !== 0) {
      let kind = 'exit'
      const t = all.toLowerCase()
      // #969：等满分档被杀掉的一律归网络档（慢网下显示未知而不是没登录），即使没有任何输出文本。
      const rkTimedOut = !!(outcome && outcome.signal === 'timeout')
      if (rkTimedOut) kind = 'network'
      else if (/not logged in|auth failed|bad credentials|failed to log in|token.*invalid|keyring|re-authenticate|auth refresh/i.test(t)) kind = 'auth'
      else if (/404|not found|could not resolve to an? (issue|pull request)/i.test(t)) kind = 'notfound'
      else if (/network|econn|unexpected eof|timed out|connect/i.test(t)) kind = 'network'
      // #916/#917 复核：被归成「没登录」时把归因条件和宿主环境一起记下来 —— 票面症状是「终端明明登录了，
      //   面板却说没登录」。只看 kind=auth 分不清「确实没凭据」与「代理/网络坏了让 gh 打印出认证类字样」，
      //   所以这里只记命中的是哪一组关键词（signal 短枚举）与宿主进程里有没有代理变量、有没有换配置目录
      //   （proxySet / ghConfigDir 两个布尔），绝不记 stderr 原文与变量值。
      if (kind === 'auth') {
        let proxySet = false
        let ghConfigDir = false
        try {
          const plat: any = await getPlatform()
          if (plat && plat.env && typeof plat.env.get === 'function') {
            proxySet = !!(plat.env.get('HTTPS_PROXY') || plat.env.get('HTTP_PROXY') || plat.env.get('ALL_PROXY') || plat.env.get('https_proxy') || plat.env.get('http_proxy'))
            ghConfigDir = !!plat.env.get('GH_CONFIG_DIR')
          }
        } catch (eAuthEnv) {}
        let signal = 'auth-phrase'
        if (/not logged in/i.test(t)) signal = 'not-logged-in'
        else if (/bad credentials|auth failed|failed to log in/i.test(t)) signal = 'bad-credentials'
        else if (/token.*invalid|re-authenticate|auth refresh/i.test(t)) signal = 'token-invalid'
        else if (/keyring/i.test(t)) signal = 'keyring'
        try { if (logCtx) logCtx.fire('warn', 'gh.auth.env', { signal: signal, cwdHash: hash8(cwd || DEFAULT_CWD), exitCode: outcome.exitCode || -1, proxySet: proxySet, ghConfigDir: ghConfigDir }) } catch (eL) {}
      }
      // #1101：超时那一行补上 via / cmd / waitedMs —— 面板「所有功能超时」只能靠这三格分清
      //   是哪个入口（探测、面板读、写票）在排队还是命令本身跑不完；同族 gh.exec 行也带 via。
      try { if (logCtx && rkTimedOut) logCtx.fire('warn', 'gh.timeout', { argv0: 'gh', timeoutMs: rkTimeout, layer: 'host-clamp', via: String(via || ''), cmd: ghCommandLabel(args), waitedMs: rkWaitedMs }) } catch (eL) {}
      try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: kind, exitCode: outcome.exitCode || -1 }) } catch (eL) {}
      try { if (logCtx && logCtx.isEnabled('debug') && kind !== lastNormKind) { lastNormKind = kind; logCtx.fire('debug', 'error.normalize', function () { return { rawKind: 'exit:' + String((outcome && outcome.exitCode) || -1), mappedKind: kind } }) } } catch (eL) {}
      // #1007：这一趟的结局要回写给同一只准入桶；三条口径（谁能清零、谁算 transport 失败）见 gh-run-report.ts。
      reportGhRunOutcome({ lane: getGhLane(logCtx), bucket: rkBucket, cmd: rkCmd, timedOut: rkTimedOut, outcome: outcome, text: all })
      releaseSlot()
      return { ok: false, kind: kind, code: outcome.exitCode, error: all.slice(0, 400), text: out.text || '' }
    }
    // 彻底移除：issuePath 1A 白名单检测已移除（#345），只保留两项与面包屑无关的职责：
    //   ① create/edit 等写操作失效快照缓存，支撑右侧面板增量更新；
    //   ② create 成功仍触发 namingSweepSoon(500)——#266 建号感知快路径（新会话 0.5-2s 内归属编号档）不随面包屑退役。
    try {
      const a = Array.isArray(args) ? args : []
      if (a.length >= 2 && a[0] === 'issue' && /^(create|edit|close|comment|reopen)$/.test(String(a[1]))) {
        try { let rkWrite = cwd; try { rkWrite = await canonicalKey(cwd || DEFAULT_CWD) } catch {} setCache({ ts: 0, snapshot: null, error: null, cwd: rkWrite }) } catch {} // #696 只清自己根
        if (String(a[1]) === 'create') { try { namingSweepSoon(500) } catch (eW) {} }
        // #709（T5）「写入成功之后」这一类事件：写很可能改变检查链（首次建号、仓库刚有内容等），
        // 所以把退避拉回第一档 —— 下一个事件到来时立刻真算一次，不必等到退到 5 分钟那一档。
        try { if (typeof getChainBackoff === 'function') getChainBackoff().then(function (b) { try { if (b) b.noteWriteActivity() } catch (e) {} }).catch(function () {}) } catch (eWr) {}
      }
    } catch (e) {}
    try { if (logCtx) logCtx.fire('info', 'gh.exec', { argv0: 'gh', via: String(via || ''), cmd: rkCmd, cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - ghT0, waitedMs: rkWaitedMs, kind: 'ok', exitCode: 0 }) } catch (eL) {}
    // #1007：跑完拿到退出码 0，通路是通的 —— 冷却窗口立刻清零（没有冷却时这里什么也不做、不记事件）。
    try { getGhLane(logCtx).reportSuccess({ bucket: rkBucket }) } catch (eS) {}
    // #966 收口：写成功记一笔搭车账，写过东西之后来的探测不搭旧车。
    try { if (isWriteGhArgs(args)) getChainRide().markWrite() } catch {}
    releaseSlot()
    return { ok: true, text: out.text || '' }
  }
  return { resolveGh, resetGhCache, runGh }
}
