// src/host/publishFlow.ts —— 建仓发布与重试推送（H6 #450 从 host/index.js 855–1005/1007–1028 搬出，纯结构；classifyCreateError 由 initPublish 内提升为模块共享）。
// 2026-10-14（#1161）从 .js 转成 .ts：只加类型标注与注释，逻辑一行未动（唯一的写法调整：loggedPhone 的
//   `fn.apply(null, arguments)` 换成剩余参数 `fn(...a)`，同一个调用语义，为了拿到类型）。
// 以后谁改它：改建仓发布流程或推送重试的人。预估约190行，超 350 打回。
// 接线：由 index.js 动态 import 加载；repoKeys/repoRoots 与 H1 同形（对象引用，删除才删得中）。
//
// 2026-10-10（票 #993 / #994）：本文件原先自带一份 classifyCreateError，与 GitHub 房里那份逐字符相同。
//   两处都改成引共享实现：initProjectErrorKinds —— 兜底从 permission 改成 unknown，「认不出来」不再等于
//   「没权限」；workspaceOwnership —— 「属主不一致」这一档的唯一判断，两票共用。
//   另外 #994 在流程最前面加了「工作区 git 可用性」探测：属主不一致时补一条 safe.directory
//   再重试一次，仍然不行才报错 —— 不再让问题推迟到 git add 才炸。
// 2026-10-14（票 #1161）：这两件从前是本文件直接 import 房间实现拿的。宿主侧不许再深引房间
//   （规则 rooms-imported-only-by-assembly），改由调用方（index.js）经装配点 src/tracker/registry/builtins.ts
//   取到后注入：deps.makeCreateErrorClassifier 与 deps.KIND_UNKNOWN。
import { isOwnershipMismatch, ownershipPathFrom, safeDirectoryCommand } from '../tracker/kernel/workspace-ownership.js'

/** git 命令的返回信封（宿主注入的 execProc 产出的形状）：ok/text/error 三样本文件都读，退出码可缺（缺了按 ok 推）。 */
interface ExecReply { ok: boolean; error?: unknown; text?: string; code?: number }

/** 工作区可用性探测的结果：ok 为真时可能带 notRepoYet（这个目录还没建仓）；为假时带分类与原话。 */
type UsableResult =
  | { ok: true; notRepoYet?: boolean; healed?: boolean; dir?: string }
  | { ok: false; kind: string; text: string; triedRepair?: boolean }

/** 建仓发布的入参（前端传进来的原始对象，字段一律按 unknown 收、用到时再转）。 */
interface InitPublishArgs { cwd?: string; name?: unknown; visibility?: unknown }
/** 重试推送的入参（半成功时由前端从 initPublish 结果带出）。 */
interface RetryPushArgs { cwd?: string; name?: unknown; repoUrl?: unknown; owner?: unknown }

/** 写会话的执行器：房间起外部命令时用它（形状与 src/refresh/rooms/host/session-opener.ts 的 SessionExec 一致）。 */
type SessionExec = (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number; signal?: AbortSignal }) => Promise<unknown>

/**
 * 开会话的结果（成功那一份只列本文件用到的成员；失败那一份只要 ok 与 reason）。
 *
 * 为什么只列用到的：这份类型是本文件对「写会话」的全部要求，写全了会把宿主的接线细节
 * 抄进宿主另一份文件里，两边一改就得同步改类型。call 的参数类型也用 any —— 会话能力
 * 的形状属于契约层（TrackerSession），本文件不该再声明一遍。
 */
type SessionOpened =
  | { ok: true; backendId?: string; canWrite?: boolean; repoRef?: { backend?: string; refId?: string; name?: string; url?: string } | null; budget?: unknown; call: (fn: (session: any, ctx: any) => Promise<any>) => Promise<any> }
  | { ok: false; reason?: string; detail?: unknown }

/** 写会话的开启函数：由宿主在接线处注入，本文件不碰注册表、不选后端。 */
type OpenSessionFn = (cwd: unknown, opts?: { write?: boolean; exec?: SessionExec }) => Promise<SessionOpened>

/** 接线处注入的依赖（形状按本文件实际用到的部分写）。 */
interface Deps {
  DEFAULT_CWD: string
  resolveGit(): Promise<string | null>
  execProc(argv: string[], cwd: string, phase: string): Promise<ExecReply>
  canonicalKey(cwd: string): Promise<string | null> | string | null
  repoKeys: Record<string, unknown>
  repoRoots: Record<string, unknown>
  setCache(entry: { ts: number; snapshot: unknown; error: unknown; cwd: string | null }): unknown
  logCtx?: { fire(level: string, event: string, fields?: unknown): void } | null
  makeCreateErrorClassifier(deps: { isOwnership: (text: string) => boolean }): (errText: unknown, kind?: unknown) => string
  KIND_UNKNOWN: string
  /** 写会话的开启函数（票 #1445）。缺省时建仓回环境失败、不抛：本文件不自己调注册表兜底。 */
  openSession?: OpenSessionFn | null
}

/** 从任意结果信封里取一句错误指纹原料（原写法 `res.error.message || res.error || res.errorKind` 的类型安全版）。 */
function errFingerprint(v: unknown): string {
  const o = (v && typeof v === 'object') ? (v as { error?: unknown; errorKind?: unknown }) : null
  const inner = (o && o.error && typeof o.error === 'object') ? (o.error as { message?: unknown }).message : undefined
  return String(inner || (o ? o.error : undefined) || (o ? o.errorKind : undefined) || 'publish-not-ok')
}

export function createPublishFlow(deps: Deps) {
  // 只取真正用到的字段：gh 的解析与调用自 #1445 起都由房间负责，宿主这边不再持有 gh 相关依赖。
  const { DEFAULT_CWD, resolveGit, execProc, canonicalKey, repoKeys, repoRoots, setCache, logCtx, makeCreateErrorClassifier, KIND_UNKNOWN, openSession } = deps
  // #606：本文件里的外部命令全是 git，都属于「初始化仓库 / 推送」这条链，统一打上链名再往下传，
  //   这样日志里的 exec.run 行就能答出「这条命令是发布链起的」。
  const gitExec = function (argv: string[], cwd: string) { return execProc(argv, cwd, 'publish') }
  // #993：分类器收进共享模块（两处调用方共用一份，见文件头 2026-10-10 注）。属主那一档由
  //   共享的 workspaceOwnership 判断，这里只把判断函数注入进去。
  // #1161：分类器本身由调用方从装配点取来注入（见文件头 2026-10-14 注）。
  const classifyCreateError = makeCreateErrorClassifier({ isOwnership: isOwnershipMismatch })

  // ============ #994：动手前的「工作区 git 可用性」探测与属主自愈 ============
  // 为什么必须有这一步：git 的 safe.directory 保护会在属主与运行用户不一致时直接拒绝操作
  //   （stderr 原文 `fatal: detected dubious ownership ...`）。检测这件事的命令本来就跑在流程
  //   第一步，但原先它的结果只被用来决定「要不要 git init」，没有当成环境结论；于是问题被推迟
  //   到 git add 才炸，而那条报错又被分类成「权限不足」，把人的排查方向整体带偏（票 #993）。
  //
  // 探针用 `rev-parse --is-inside-work-tree`，已实测（git 2.49，GIT_TEST_ASSUME_DIFFERENT_OWNER=1）：
  //   属主不一致时它自己就会以退出码 128 失败并报出同一段原文，所以拿它当前置关卡够用。
  //
  // 「不在仓库里」不是错误：这个工作区本来就还没建仓，流程接着走 git init。判据取 git 原话
  //   `not a git repository`，与「属主不一致」一样都是读原文，不做别的猜测。
  const NOT_A_REPO_RE = /not a git repository/i

  async function probeWorktreeUsable(git: string, cwd: string): Promise<UsableResult> {
    const r = await gitExec([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
    if (r.ok) return { ok: true }
    const text = String(r.error || '')
    if (isOwnershipMismatch(text)) return { ok: false, kind: 'git-ownership', text }
    if (NOT_A_REPO_RE.test(text)) return { ok: true, notRepoYet: true }
    return { ok: false, kind: classifyCreateError(text, null), text }
  }

  // 属主不一致时的自愈：补一条 safe.directory 再让调用方重试一次。
  //   用 git 报出来的那个目录（它报的就是它实际比对过的路径），不自己拼路径 —— Android 上
  //   /sdcard 常是软链，两种写法在配置里是两个不同字符串，拼错那个等于没修。
  //   用 --add 是维护者定的写法；实测这一条是幂等的（同值重复添加不会写出第二行），不会堆积。
  async function healOwnership(git: string, cwd: string, probeText: string) {
    const dir = ownershipPathFrom(probeText) || cwd
    const r = await gitExec([git, 'config', '--global', '--add', 'safe.directory', dir], cwd)
    return { ok: !!r.ok, dir: dir, repaired: !!r.ok }
  }

  // git 侧失败的统一信封（分类器认档 + 这一档对用户说什么）。
  //   #993 的两条要求就落在这里：属主那一档给「能照做的一句话」，unknown 那一档把 git 的原始
  //   报错原样交给用户 —— 认不出来却翻译成「权限不足」，正是这次要修掉的毛病。
  //
  //   第二参数是调用方的工作区目录：修属主那一档要拼一句「照着跑就能修」的命令，而命令里的目录
  //   必须是被 git 拒掉的那个工作区。原 .js 里这一支写的是 `|| cwd`，可 `cwd` 只是两个处理函数的
  //   局部量、在 gitFail 里并不存在 —— 真走到这一档会抛 ReferenceError（错误分支反而崩掉）。
  //   现在由调用方把 `cwd` 传进来，这一档才真的能给出修法。
  function gitFail(errText: unknown, cwd: string) {
    const kind = classifyCreateError(errText, null)
    const raw = String(errText || '')
    if (kind === 'git-ownership') {
      const cmd = safeDirectoryCommand(ownershipPathFrom(raw) || cwd)
      return {
        ok: false,
        errorKind: kind,
        error: '这个工作区的属主不是当前运行用户，git 拒绝操作（原文：dubious ownership）。' +
          (cmd ? '修法：' + cmd : ''),
      }
    }
    if (kind === KIND_UNKNOWN) {
      return { ok: false, errorKind: kind, error: '创建失败，未识别的原因。git 原话：' + raw.slice(0, 160) }
    }
    return { ok: false, errorKind: kind, error: raw }
  }

  // #994：这一段是「动手改工作区之前」的环境关卡。返回 ok 时，工作区要么本来就能用 git，
  //   要么刚刚补好 safe.directory 之后已确认能用；返回失败时一步都还没改过这个目录。
  async function preflightWorkspaceGit(git: string, cwd: string): Promise<UsableResult> {
    const first = await probeWorktreeUsable(git, cwd)
    if (first.ok) return first
    if (first.kind !== 'git-ownership') return first
    // 属主不一致：补一条 safe.directory 再试一次。
    const heal = await healOwnership(git, cwd, first.text)
    const second = await probeWorktreeUsable(git, cwd)
    if (second.ok) return { ok: true, healed: !!heal.ok, dir: heal.dir }
    // 修了还是不行（写不进全局配置、或配置里的路径与 git 认的不是同一个字符串）—— 如实报，
    //   不许把「没修好」说成「已修复」。
    return { ok: false, kind: 'git-ownership', text: second.text, triedRepair: true }
  }
  // ============ 写会话的执行器（#1445）============
  // 房间起外部命令时要的是「{ code, stdout, stderr }」，宿主这份 execProc 给的是「{ ok, text, error }」。
  //   不转这一道不行：房间的兼容层只把 stderr 当失败原文，转丢了 stderr，git 的属主/磁盘这些档位就全成了空串。
  // 为什么把宿主的 execProc 交给会话（openSession 的 opts.exec）：refresh 给会话默认配的执行器是
  //   detectionExec，gh 命令按探活档超时；建仓要推一个大仓，必须走宿主这条带自己超时与名额的执行器。
  //   opts.timeout 这里不转：超时口径归宿主执行器，房间给的数只对它自己起的进程有意义。
  function sessionExecOf(outerCwd: string): SessionExec {
    return async function (cmd: string, argv: string[], opts?: { cwd?: string }) {
      const o = opts || {}
      const r = await execProc([cmd].concat(Array.isArray(argv) ? argv : []), o.cwd || outerCwd, 'publish')
      const code = typeof r.code === 'number' ? r.code : (r.ok ? 0 : 1)
      return { code: code, stdout: r.ok ? String(r.text || '') : '', stderr: r.ok ? '' : String(r.error || '') }
    }
  }

  // #1621：no-gh 那条排查/安装提示由宿主给（面板文案归宿主）。同一段话在房间的 src/tracker/rooms/github/init-project.ts
  //   里还存着一份（房间回包要自带 prompt），两处必须逐字一致；门禁 tests/verify-1621-gh-missing-copy.ts 盯着这件事，
  //   改一处就同步改另一处。
  const NO_GH_PROMPT = 'DSH 进程启动时从父进程继承的 PATH 中未解析到 GitHub CLI（gh）可执行文件。该结果不等同于 gh 未安装。按以下顺序处理：\n\n1. 在 DSH 之外的终端执行 `gh --version`。\n2. 有版本号输出：gh 已安装。无需重复安装。将 gh 所在目录加入用户级或系统级 PATH，或将本插件读取的 DSH_GH_PATH 设为 gh 可执行文件的绝对路径，再重启 DSH Desktop；若该目录已在 PATH 中，直接重启 DSH Desktop。重启时从开始菜单、桌面或资源管理器启动，避免从旧终端或旧 IDE 会话启动（其进程环境可能未包含新 PATH）。\n3. 无版本号输出：该终端也无法执行 gh。检查 gh 的安装目录（Windows 默认：C:\\Program Files\\GitHub CLI\\gh.exe）；确认未安装后，按官方说明安装：https://cli.github.com/。安装后重启 DSH。\n4. “重新检查”只重跑检查逻辑，不重新读取进程环境变量；不能替代重启 DSH。\n5. 完成后确认：`gh --version` 有输出，环境检查的 gh 项通过。'

  // 失败回包的映射（#1445）：房间的档位名与宿主原来的 errorKind 是同一套（no-git / no-gh / not-logged-in /
  //   already-exists / network / permission / git-ownership / unknown），所以档位原样透传，界面那边的分支不用改。
  // 半成功契约（#420/#426）要保住：远端仓库建起来了、只是推送没完成时，前端要拿到 repoUrl 才能给「重试推送」。
  //   房间在 already-exists 那一档会自己带 repoUrl；推失败那一档它只有 git 的失败原文（不带 URL）——
  //   可那时 set-url 已经把新远端写进了本地仓库，回读一次 origin 就能把这格补回来。
  async function publishFailure(r: unknown, name: string, cwd: string, git: string) {
    const rr = r as { error?: { kind?: unknown; message?: unknown; repoUrl?: unknown } } | null | undefined
    const e = (rr && rr.error) || {}
    const kind = String(e.kind || KIND_UNKNOWN)
    const message = String(e.message || '')
    let repoUrl = e.repoUrl ? String(e.repoUrl) : ''
    if (!repoUrl && kind !== 'already-exists') {
      try {
        const ro = await gitExec([git, 'remote', 'get-url', 'origin'], cwd)
        const originUrl = ro.ok ? String(ro.text || '').trim() : ''
        if (originUrl && originUrl.indexOf('/' + name) >= 0) repoUrl = originUrl.replace(/\.git$/, '')
      } catch (e2) { /* 读不到远端就按「没有半成功」处理，不编造 URL */ }
    }
    const owner = repoUrl ? (repoUrl.split('/')[3] || '') : ''
    const out: {
      ok: false; errorKind: string; error: string; repoUrl?: string
      repo?: { owner: string; name: string }; halfCreated: boolean; prompt?: string
    } = {
      ok: false,
      errorKind: kind,
      error: message,
      repoUrl: repoUrl || undefined,
      repo: repoUrl ? { owner: owner, name: name } : undefined,
      // 半成功 =「我们刚创建成功但推送未完成」；already-exists 是仓库原本已存在（只给去查看，不给重试推送）。
      halfCreated: (kind !== 'already-exists') && !!repoUrl,
    }
    if (kind === 'no-gh') out.prompt = NO_GH_PROMPT
    return out
  }

  // ============ 红卡建仓发布（T1 #34 · 无仓库时一键建仓发布）============
  // 输入：{ cwd, name, visibility }（visibility = 'public' | 'private'，默认 private）
  // #1445 起流程：#994 工作区 git 可用性探测（属主不一致则补 safe.directory 重试一次）→ 开一个写会话 →
  //   把建仓整步交给当前后端房间的 initProject（gh 解析、登录态、git init/add/commit、repo create、push 全在里面）→
  //   按房间回包映射成败。为什么宿主还留着 bad-name 与 git 前置：这两件不碰 gh、也不该等开会话才回答，
  //   而属主自愈改的是用户机器上的全局配置，是面板这条路的既有行为，换路不能丢。
  // 返回：{ ok: true, repo: { owner, name } } | { ok: false, errorKind, error, repoUrl? }
  // errorKind: no-git / no-gh / not-logged-in / already-exists / network / permission / git-ownership / unknown / env
  //   （#993：兜底从 permission 改成 unknown，「属主不一致」单独成 git-ownership 一档；#1445 起 env 表示写会话没接上）
  async function handleInitPublish(args?: InitPublishArgs | null) {
    const cwd = (args && args.cwd) || DEFAULT_CWD
    const name = args && args.name ? String(args.name).trim() : ''
    const visibility = (args && args.visibility) === 'public' ? 'public' : 'private'
    if (!name) return { ok: false, errorKind: 'bad-name', error: '仓库名为空' }
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
      return { ok: false, errorKind: 'bad-name', error: '仓库名仅支持字母/数字/._- 且 ≤100：' + name }
    }
    // 前置：git 可执行 + 工作区 git 可用性（#994）。失败快返，一步都不改这个目录。
    const git = await resolveGit()
    if (!git) return { ok: false, errorKind: 'no-git', error: '未找到 git（请安装 https://git-scm.com/）' }
    const usable = await preflightWorkspaceGit(git, cwd)
    if (!usable.ok) return gitFail(usable.text, cwd)
    // #1445：建仓整步交给写会话。宿主没接 openSession 时如实回环境失败 —— 不自己调注册表、
    //   也不偷偷退回直调 gh 的老路（那条路正是这一票要拆掉的）。
    if (typeof openSession !== 'function') {
      return { ok: false, errorKind: 'env', error: '写会话没接上（宿主没有注入 openSession），这次建仓没有开始。' }
    }
    const opened = await openSession(cwd, { write: true, exec: sessionExecOf(cwd) })
    if (!opened || !opened.ok) {
      const why = (opened && opened.reason) ? String(opened.reason) : 'unknown'
      return { ok: false, errorKind: 'env', error: '写会话没开起来（' + why + '），这次建仓没有开始。' }
    }
    // 房间的入口是 initProject(handle, input, ctx)：ctx 由会话的 call 交过来（工作目录、平台、出站面都在里面），
    //   本文件不自己拼上下文，也不往实参里塞别的键 —— 房间读的是它自己拿到的那一份。
    let r: unknown = null
    try {
      r = await opened.call(function (session: any, ctx: any) {
        return session.initProject({ cwd: cwd }, { name: name, visibility: visibility }, ctx)
      })
    } catch (e) {
      const eb = e as { message?: unknown } | null
      const msg = String((eb && eb.message) || e).slice(0, 200)
      return { ok: false, errorKind: 'env', error: '写会话调用失败：' + msg }
    }
    if (!r || !(r as { ok?: boolean }).ok) return publishFailure(r, name, cwd, git)
    // 成功：仓库身份取会话回包的 repoRef（房间按 getRepoKey → currentUser 的顺序定 owner），
    //   不再由宿主用 getRepoKey 重解析、也不再兜一次 gh api user —— 那两步是旧实现自己的解析链，房间已经做过。
    const ref = ((r as { data?: { refId?: unknown; name?: unknown; url?: unknown } }).data) || {}
    const refId = String(ref.refId || ref.name || name)
    const slash = refId.indexOf('/')
    const owner = slash > 0 ? refId.slice(0, slash) : ''
    const repoName = slash > 0 ? refId.slice(slash + 1) : refId
    // #696 只清自己根那条（建仓改了这一个工作区的身份，别的根不动）；钥匙先规整，删才删得中。
    const rk3 = await canonicalKey(cwd || DEFAULT_CWD)
    try { setCache({ ts: 0, snapshot: null, error: null, cwd: rk3 }) } catch (eCache) { /* 缓存失效兜底 */ }
    if (rk3 && repoKeys[rk3] !== undefined) delete repoKeys[rk3]
    if (rk3 && repoRoots[rk3] !== undefined) delete repoRoots[rk3]
    // URL 以房间给的那份为准；拿不到 owner 时沿用旧口径给空串（没有 owner 拼出来的地址是错的）。
    // #1191：兜底按会话后端选域（GitLab 房走 gitlab.com），房间正常回 url 时这一格不触发。
    const backendId = String((opened as { backendId?: unknown }).backendId || '')
    const fallbackBase = backendId === 'gitlab' ? 'https://gitlab.com/' : 'https://github.com/'
    const repoUrl = owner ? (String(ref.url || '') || (fallbackBase + owner + '/' + repoName)) : ''
    return { ok: true, repo: { owner: owner, name: repoName }, repoUrl: repoUrl }
  }

  // ============ 契约操作分发（#1191：UI 的 contract-op 落到这里按当前后端执行）============
  // 入参：{ op, cwd?, name?, visibility? }（op 如 initProject；只取 cwd/name/visibility 三键透给对应操作，其余键丢弃）。
  // 为什么只有 initProject：今天 UI 只有建仓向导用 contract-op；未知 op 诚实回 unsupported，不猜、不兜。
  interface ContractOpArgs { op?: unknown; cwd?: unknown; name?: unknown; visibility?: unknown }
  async function handleContractOp(args?: ContractOpArgs | null) {
    const op = args && args.op ? String(args.op).trim() : ''
    if (!op) return { ok: false, errorKind: 'bad-name', error: '缺少 op（契约操作名，如 initProject）' }
    if (op !== 'initProject') return { ok: false, errorKind: 'unsupported', error: '不支持的契约操作：' + op }
    const cwd = (args && args.cwd ? String(args.cwd) : '') || DEFAULT_CWD
    const name = args && args.name ? String(args.name) : ''
    const visibility = (args && args.visibility) === 'public' ? 'public' : 'private'
    return handleInitPublish({ cwd: cwd, name: name, visibility: visibility })
  }

  // ============ 重试推送（#420/#426 定版：仅推送，不动建仓）============
  // 入参：{ cwd, name, repoUrl, owner }（半成功时由前端从 initPublish 结果带出）
  // 流程：origin 缺失则以 repoUrl 补 remote → git push -u origin HEAD；成功 ok:true（前端走成功闭环），失败回带半成功契约
  async function handleRetryPush(args?: RetryPushArgs | null) {
    const cwd = (args && args.cwd) || DEFAULT_CWD
    const name = args && args.name ? String(args.name).trim() : ''
    const repoUrl = args && typeof args.repoUrl === 'string' && args.repoUrl ? String(args.repoUrl) : ''
    const owner = args && args.owner ? String(args.owner) : ''
    const git = await resolveGit()
    if (!git) return { ok: false, errorKind: 'no-git', error: '未找到 git（请安装 https://git-scm.com/）' }
    try {
      const ro = await gitExec([git, 'remote', 'get-url', 'origin'], cwd)
      if (!ro.ok && repoUrl) { await gitExec([git, 'remote', 'add', 'origin', repoUrl + '.git'], cwd) }
    } catch (e) { /* remote 缺失时兜底 */ }
    const pushR = await gitExec([git, 'push', '-u', 'origin', 'HEAD'], cwd)
    if (pushR.ok) {
      try { const rkRetry = await canonicalKey(cwd || DEFAULT_CWD); setCache({ ts: 0, snapshot: null, error: null, cwd: rkRetry }) } catch (eCache) { try { setCache({ ts: 0, snapshot: null, error: null, cwd: null }) } catch {} /* #696 锚根失败兜底清全部（拿不出目录，仅此一条） */ }
      return { ok: true, repo: { owner: owner, name: name }, repoUrl: repoUrl || (owner ? ('https://github.com/' + owner + '/' + name) : '') } // 成功回的地址优先用入参那份（半成功结果带的是真域，GitLab 给 gitlab.com）；入参没有才按旧口径拼
    }
    const gf = gitFail(pushR.error, cwd)
    return { ok: false, errorKind: gf.errorKind, error: gf.error, repoUrl: repoUrl || undefined, repo: { owner: owner, name: name }, halfCreated: true }
  }
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method: string, kind: string, t0: number, res: unknown, err?: unknown): void { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err as { message?: unknown } | null | undefined)?.message || err)) }) }
    else if ((res as { ok?: boolean } | null | undefined)?.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(errFingerprint(res)) }) } catch (eL) {} }
  /** 给一个动作套上「进一次、出一次」的日志：返回值与入参原样透传，外面看到的签名不变（泛型 F 就是原函数类型）。 */
  function loggedPhone<F extends (...a: never[]) => Promise<unknown>>(method: string, kind: string, fn: F): F {
    const wrapped = async function (...a: never[]): Promise<unknown> { const t0 = Date.now(); try { const r = await fn(...a); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } }
    return wrapped as unknown as F
  }
  return { handleInitPublish: loggedPhone('wf.initPublish', 'publish', handleInitPublish), handleContractOp: loggedPhone('wf.contractOp', 'publish', handleContractOp), handleRetryPush: loggedPhone('wf.retryPush', 'publish', handleRetryPush) }
}
