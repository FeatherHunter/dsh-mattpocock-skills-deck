// src/refresh/rooms/host/chain-env-map.ts —— #1444 从 check-chain-evaluation.ts 按接缝搬出，纯结构、行为零变化。
// 以后谁改它：改环境那一关（gh / 登录态 / 仓库）怎么问、怎么判的人。
//
// 这里住的是「环境那一关怎么问、问回来怎么读」：只读会话的能力面（preflight 与取当前登录名两条读法）、
// 一次求值里只问一次环境的那只探针，以及两个谓词（仓库可达、登录态）读完 preflight 回包之后的档位分派。
// 求值本身的编排（退避、同键搭车、快照拼接、缓存、日志）仍留在 check-chain-evaluation.ts。
//
// 为什么拆：文件粒度门禁要求单文件不超过 350 有效行（口径见 scripts/lib/effective-lines.mts）；更实在的理由是
// 编排与环境读法混在一处时，读代码的人得先穿过一整套环境判断，才看得见求值主干。
//
// 约定（改之前先读这三条）：
//   1. 这一份只做判断，不发请求、不记日志、不读钟。开会话与读仓库名都由调用方当成能力交进来，
//      这样「一次求值只问一次环境」由调用方掌握，测试也能直接把能力换成假的。
//      反例：在这里自己起 gh 子进程或调 Date.now —— 探针复用计数与日志采样就对不上账。
//   2. 档位表 CHAIN_ENV_STAGE_OF 把 preflight 的失败档位归到三关：gh（本机环境：命令、网络或宿主接线）、auth（登录态）、repo（仓库）。
//      表里没有的档位一律按 auth 算：宁可说「登录态未知」，也不能把一次没归类的失败说成「仓库不存在」——
//      后者会误导人去建一个已经存在的仓库。
//   3. 两个谓词的分派与话术（中英双语）和 check-chain-evaluation.ts 的注册处是同一套字面量，
//      改文案或改档位要同步 tests/verify-chain-env-e2e.ts 的期望；env 档那几句（缺可执行 vs 其它本机故障）
//      另有 tests/verify-916-ghauth-crosscheck.ts 与 tests/verify-1187-gitlab-chain-predicates.ts 盯着（#1571）。

// ── 会话的能力面（#1415 起宿主侧有真实现，见 session-opener.ts；这里只写调用方依赖的形状）──
// 规格第 9 节：除 readBudget 外不新增能力、不改参数。所以这里只声明真用到的几条读能力。
// #1187 加了第三条 getRepoKey —— 它是 Tracker 本来就有的定位口（不是新能力）：GitHub 的仓库身份
// 能由宿主自己从本地 git 配置读出来，GitLab 这类后端只有房间知道怎么认（本地 git 配置 →
// `glab repo view` 兜底），所以必须经会话问它；不声明这一条，GitLab 的「仓库可达」那一行
// 就永远没有 refId 可核对，只能显示一句「暂时确认不了」。
type ChainReadError = { kind?: string; message?: string; raw?: string }
/** 房间 preflight 的入参（RepoHandle 的子集：本文件只给得出目录、仓库 refId 与后端 id）。 */
type ChainRepoHandle = { cwd?: string; refId?: string; backend?: string }
/** 房间 getCurrentUser 的入参（RepositoryRef 的子集：房间真正读的是 opCtx.cwd，这几格按契约给全）。 */
type ChainRepoRef = { backend: string; refId: string; name: string; url: string }
/** 只读会话：本文件只用这几条读能力。 */
type ChainReadSession = {
  preflight(handle: ChainRepoHandle, ctx: unknown): Promise<{ ok: boolean; error?: ChainReadError | null }>
  getCurrentUser(repo: ChainRepoRef, ctx: unknown): Promise<{ ok: boolean; data?: { login?: string } | null; error?: ChainReadError | null }>
  /**
   * 从工作区目录解析仓库身份（owner/name）；解析不出来回 null，不抛。
   * 可选：仓库身份由宿主自己认得清的后端（GitHub）不填这一格，走 probeChainEnv 交进来的 getRepoKey；
   * GitLab 这类后端必须由房间回答 —— 本地 git 配置里是 gitlab 地址时，宿主那份只认 github 的解析器读不出来。
   */
  getRepoKey?(cwd: string, ctx: unknown): Promise<{ owner?: string; name?: string } | null>
}
/** 开会话成功那一份：call(fn) 把会话与这一次的 opCtx 交给能力函数（形状见 session-opener.ts）。 */
type OpenedChainSession = { ok: true; backendId?: string; call<T>(fn: (session: ChainReadSession, ctx: unknown) => Promise<T>): Promise<T> }
/** 开会话的两种回包：成功可调能力，失败带原因（本文件不重试、不抛，只降级）。 */
export type OpenSessionReply = OpenedChainSession | { ok: false; reason?: string; detail?: string }

/**
 * 环境那一关的结论：pass 三关全过；none 会话没接上（接线缺省或开不出来）；
 * 其余三种是停在哪一关——本机环境那一关（含缺可执行）/ 登录态问不出来 / 仓库不可达。
 */
type ChainEnvProbeReply = {
  stage: 'pass' | 'none' | 'gh' | 'auth' | 'repo'
  kind?: string
  message?: string
  /**
   * 这一次 preflight 实际拿去核对仓库的那个 refId（空串 = 本地认不出仓库身份）。
   * 为什么要把身份带回来：「仓库可达」这一项要区分「接口调通了」与「根本没仓库可核对」——
   * 没有 refId 时房间会跳过第三关直接回成功，不能据此说仓库可达。
   */
  refId?: string
}

/**
 * preflight 的失败档位 → 这一次求值停在哪一关（写死的对照表，#1444）。
 *
 * 为什么需要反推：房间的 preflight 只回一个错误档位（TrackerError.kind），不回「停在第几步」；
 * 而链上两行要按关分开显示，所以只能按「哪种档位只可能在哪一关出现」反推：
 *   · env 只可能落在第一关，但不等于「找不到 gh 可执行」：出站控制面没接上、执行器没注入也归 env
 *     （#1571 起 pending 文案按原文分流，见下面 envPendingDetail）；
 *   · not-found 只可能是第三关（仓库不存在 / 无权限）；
 *   · 其余档位（auth/network/rate-limit/conflict/unsupported/parse）都只可能出现在第二关（登录态那次出站）。
 * 表里没有的档位按第二关算：宁可说「登录态未知」，也不能把一次没归类的失败说成「仓库不存在」——
 * 后者会误导人去建一个已经存在的仓库。
 */
const CHAIN_ENV_STAGE_OF: Record<string, 'gh' | 'auth' | 'repo'> = {
  env: 'gh',
  auth: 'auth',
  network: 'auth',
  'rate-limit': 'auth',
  conflict: 'auth',
  unsupported: 'auth',
  parse: 'auth',
  'not-found': 'repo',
}
/** 查表兜底：未知档位保守归第二关（登录态未知），理由见上面那张表的注释。 */
function chainEnvStageOf(kind: string): 'gh' | 'auth' | 'repo' {
  return CHAIN_ENV_STAGE_OF[kind] || 'auth'
}

// ── 本文件自用的小类型（都不导出：外面只按函数签名读这里）──────────────────────────
/** catch 里接到的异常：只按「可能带 message」读——把 unknown 收口成这张脸，运行期一个字不动。 */
type CaughtError = { message?: unknown }
/** 谓词判定对象（与 check-chain-evaluation.ts 里 PredicateResultView 的几格一致，只列这里写到的）。 */
type ChainPredicateVerdict = { status: 'pass' | 'fail' | 'pending'; detail?: string; hint?: string }
/** 探针要的两条能力：由调用方从接线里取出来递进来，本文件不自己去找依赖。 */
type ChainEnvProbeDeps = {
  /** 读本地 git 配置里的 GitHub 仓库（owner/name）；只读本地，不起进程。非 GitHub 后端不走它。 */
  getRepoKey(cwd: string): Promise<{ owner?: string; name?: string } | null>
  /** 开一次 Tracker 只读会话；缺省时探针诚实回「会话没接上」，其余各步照旧求值。 */
  openSession?: (cwd: string, opts?: unknown) => Promise<OpenSessionReply>
}
/** 一次求值的环境预检探针：会话、preflight、登录名各只开一次，求值结束即丢弃。 */
type ChainEnvProbe = {
  preflightOnce(): Promise<ChainEnvProbeReply>
  viewer(): Promise<{ ok: boolean; login?: string }>
  asked(): number
  reused(): number
}

// ── env 档的 pending 说明（#1571）──────────────────────────────────────────────
/** 中文原文最多留多少字：够看清卡在哪一层，又不至于让长地址把一行撑满。 */
export const ENV_PENDING_CLIP_ZH = 160
/** 英文字符更窄，同样一行能放下的字数多些。 */
export const ENV_PENDING_CLIP_EN = 240

/**
 * 这段原文像不像在说「本机没有这个可执行程序」。
 *
 * 为什么不只认 not found 一类字眼：env 档还可能来自出站控制面没接上、执行器 ctx.exec 没注入
 * （房间 client.ts 的 #1159 那道闸），这些原文里也可能碰巧带 not found 字样；只按字眼判，会把
 * 宿主接线的毛病说成「命令没装」，看界面的人于是白跑一趟去重装。所以要求原文同时提到这个命令名
 * （按整词查，'github' 里的 gh 不算），再认「找不到」句式。
 *
 * 认的句式覆盖两处 preflight 的真实原文：gh 的 'gh not found: platform.resolveExecutable …'
 * 与 glab 的 'glab not found'；老一点的环境还可能给 command not found / which: no gh 这类写法。
 * 反例：把 errors.ts 判档表里那份正则直接搬过来 —— 那边管的是「归哪一档」，这边管的是「文案怎么说」，
 * 两者职责不同；而且本文件只许依赖 src/shared（见文件头约定 1），跨房间 import 判档表会破坏分层。
 */
function looksLikeMissingExecutable(message: string, exe: string): boolean {
  const escaped = exe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '([^A-Za-z0-9_-]|$)', 'i').test(message)) return false
  return /not found|no such file|command not found|is not recognized|enoent|resolveexecutable|which:/i.test(message)
}

/** 原文截断：超长时在末尾加一个省略号，读的人知道后面还有没显示出来的内容。 */
function clipEnvMessage(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * env 档的 pending 说明：env 档并不只有「本机没装 gh/glab」一种。出站控制面没接上（房间
 * client.ts 的 #1159 那道闸）与执行器 ctx.exec 没注入，也归 env 档；这两种情形再写「没找到 gh
 * 可执行」，事情就被说反了 —— 命令明明装着，卡住的是宿主接线，看界面的人会白跑一趟去重装。
 *
 * 分三种情形说话：
 *   · 原文确实在说找不到可执行文件 → 沿用旧文案（确实缺 gh 时界面与今天一致）；
 *   · 原文为空（老调用方只给 stage 不给原因）→ 只说「环境检查没通过」，不断言缺什么；
 *   · 其余 env 失败 → 「环境检查没通过」加截断后的原文，供排查真正卡在哪一处。
 * #1505 的口径：pending 要能区分「没仓库」「会话没接上」「确实缺 gh」，不能一句兜底话术盖住三种原因。
 */
function envPendingDetail(pr: ChainEnvProbeReply, zh: boolean, exe: string, subject: 'repo' | 'login'): string {
  const text = String(pr.message || '').trim()
  const isRepo = subject === 'repo'
  if (looksLikeMissingExecutable(text, exe)) {
    if (zh) return '暂时无法确认' + (isRepo ? '仓库可访问' : '登录状态') + '（没找到 ' + exe + ' 可执行）'
    return exe + ' executable not found; ' + (isRepo ? 'repo reachability unknown' : 'login state unknown')
  }
  const subjectZh = isRepo ? '仓库可访问' : '登录状态'
  if (!text) {
    return zh ? '环境检查没通过，暂时无法确认' + subjectZh : (isRepo ? 'environment check failed; repo reachability unknown' : 'environment check failed; login state unknown')
  }
  const clip = clipEnvMessage(text, zh ? ENV_PENDING_CLIP_ZH : ENV_PENDING_CLIP_EN)
  if (zh) return '环境检查没通过，暂时无法确认' + subjectZh + '：' + clip
  return (isRepo ? 'environment check failed; repo reachability unknown: ' : 'environment check failed; login state unknown: ') + clip
}

// ── 两个谓词的档位分派（#1444：读 preflight 回包，不再自己起进程）──────────────────────
/**
 * 仓库可达这一项的判定（第三关）。
 *
 * 只有「确定仓库不存在或无权限」（kind=not-found）才判 fail 并挂「创建并发布」修复动作；
 * 未登录（auth）、网络异常、以及读会话没接上，一律 pending（诚实未知）。
 * 反例：把 auth/network 也算成 fail —— 仓库已定位而 gh 未登录时，链条唯一的引导应是登录那一行，
 * 绝不能让人去建一个已经存在的仓库（2026-08-28 实机复核修正的正是这一条）。
 */
export function repoAccessVerdict(pr: ChainEnvProbeReply, zh: boolean): ChainPredicateVerdict {
  if (pr.stage === 'pass') return { status: 'pass', detail: zh ? 'GitHub 接口访问正常' : 'api.github.com 200' }
  if (pr.stage === 'gh') return { status: 'pending', detail: envPendingDetail(pr, zh, 'gh', 'repo') }
  // 2026-08-28 实机复核修正（用户反馈：仓库已找到却提示创建发布——错误）：只有「确定仓库不存在/无权限」
  //   （kind=not-found）才判 fail 并挂「创建并发布」修复动作；未登录（auth）/网络/其他异常一律 pending（诚实未知）——
  //   仓库已定位（gh:remote 通过）而 gh 未登录时，链条唯一引导是 gh:authed 行的「登录指引」，绝不该误导用户去创建仓库。
  if (pr.stage === 'repo') {
    if (pr.kind === 'not-found') return { status: 'fail', detail: zh ? 'GitHub 上访问不到该仓库（可能还没创建，或你没有权限）' : 'API 404: repo not found (may not exist or no access)' }
    return { status: 'pending', detail: zh ? '暂无法确认仓库可访问（网络或登录态未知）：' + String(pr.message || '').slice(0, 160) : 'API not accessible (' + String(pr.kind || 'exit') + '): ' + String(pr.message || '').slice(0, 240) }
  }
  if (pr.stage === 'auth') return { status: 'pending', detail: zh ? '暂无法确认仓库可访问（网络或登录态未知）：' + String(pr.message || '').slice(0, 160) : 'API not accessible (' + String(pr.kind || 'exit') + '): ' + String(pr.message || '').slice(0, 240) }
  return { status: 'pending', detail: zh ? '读会话还没接上，暂无法确认仓库可访问' : 'read session not available; repo reachability unknown' }
}

/**
 * 登录态这一项的判定（前两关）。
 *
 * 只有明确「未登录」（kind=auth）才判 fail 并展示登录指引；网络抖动归 pending（诚实未知）。
 * 仓库不可达那一档说明前两关已经过了，所以这一项判 pass（否则会把「仓库没建」显示成「没登录」）。
 * 反例：把网络失败也判成「未登录」，TLS 网络抖动时会把一次连不上说成人没登录。
 */
export function ghAuthVerdict(pr: ChainEnvProbeReply, zh: boolean): ChainPredicateVerdict {
  if (pr.stage === 'pass') return { status: 'pass', detail: zh ? '已登录' : 'Logged in' }
  if (pr.stage === 'gh') return { status: 'pending', detail: envPendingDetail(pr, zh, 'gh', 'login') }
  // 仓库不可达那一档说明前两关已经过了：登录态这一项要判 pass，否则会把「仓库没建」显示成「没登录」。
  if (pr.stage === 'repo') return { status: 'pass', detail: zh ? '已登录（仓库可达性由下一项判断）' : 'logged in (repo reachability is checked by the next item)' }
  if (pr.stage === 'auth') {
    // 2026-08-28 实机修复：仅当明确「未登录」（kind=auth）才判 fail 并展示登录指引；
    //   网络失败/其他异常归 pending（诚实未知），避免在 TLS 网络抖动时误导用户「未登录」。
    const kind = pr.kind || 'exit'
    const errMsg = String(pr.message || '').slice(0, 240)
    if (kind === 'auth') return { status: 'fail', detail: zh ? 'GitHub 登录状态已失效（重新登录 gh auth login / refresh）' : 'gh credential invalid or not logged in: re-authenticate (gh auth refresh / gh auth login)' }
    if (kind === 'network') return { status: 'pending', detail: zh ? '网络异常，暂时无法确认登录状态' : 'gh auth status network failure: ' + errMsg }
    return { status: 'pending', detail: zh ? '暂时无法确认登录状态（' + kind + '）' : 'gh auth status failed (' + kind + '): ' + errMsg }
  }
  return { status: 'pending', detail: zh ? '读会话还没接上，暂时无法确认登录状态' : 'read session not available; login state unknown' }
}

// ── GitLab 的两行（#1187）：与上面两个谓词同构，只换后端与话术 ───────────────────────────
/**
 * 判断一段错误原文像不像网络或环境故障（而不是「凭据确实失效」）。
 *
 * 为什么 GitLab 这一路要自己看原文：房间预检的第二关（glab auth status）按「这一步问的是登录了没有」
 * 把一切失败都归 auth 档（src/tracker/rooms/gitlab/preflight.ts 文件头写了这条约定），起进程失败
 * 与本地超时也在其中。直接拿 auth 档判 fail，就会把一次网络不通说成人没登录。这里只排除两种
 * 确定不是「凭据失效」的原文：网络类与「命令找不到」类；其余仍按 auth 判 fail。
 */
function looksLikeTransportFailure(message?: string): boolean {
  const text = String(message || '')
  return /network|timeout|timed out|econnrefused|econnreset|etimedout|enotfound|dns|proxy|socket|tls|connection|command not found|is not recognized|enoent|service unavailable|502|503|504/i.test(text)
}

/**
 * 「GitLab 仓库可达」这一项的判定（第三关）。
 *
 * 与 GitHub 那行同一套口径：只有「确定仓库不存在或无权限」（kind=not-found）才判 fail；
 * 未登录、网络异常、以及读会话没接上，一律 pending（诚实未知）。
 * GitLab 多一条诚实：本地认不出仓库地址时房间会跳过第三关直接回成功（没有 refId 可核对），
 * 此时不能顺水推舟说「可达」，按 pending 说明原因。
 */
export function glabRepoAccessVerdict(pr: ChainEnvProbeReply, zh: boolean): ChainPredicateVerdict {
  if (pr.stage === 'pass') {
    if (pr.refId) return { status: 'pass', detail: zh ? 'GitLab 接口访问正常' : 'gitlab.com api 200' }
    return { status: 'pending', detail: zh ? '暂时无法确认仓库可访问（本地认不出 GitLab 仓库地址）' : 'repo ref unknown locally; GitLab repo reachability unknown' }
  }
  if (pr.stage === 'gh') return { status: 'pending', detail: envPendingDetail(pr, zh, 'glab', 'repo') }
  if (pr.stage === 'repo') {
    if (pr.kind === 'not-found') return { status: 'fail', detail: zh ? 'GitLab 上访问不到该仓库（可能还没创建，或你没有权限）' : 'API 404: repo not found (may not exist or no access)' }
    return { status: 'pending', detail: zh ? '暂时无法确认仓库可访问（网络或登录态未知）' : 'GitLab repo reachability unknown (network or auth unknown)' }
  }
  if (pr.stage === 'auth') return { status: 'pending', detail: zh ? '暂时无法确认仓库可访问（网络或登录态未知）' : 'GitLab repo reachability unknown (network or auth unknown)' }
  return { status: 'pending', detail: zh ? '读会话还没接上，暂时无法确认仓库可访问' : 'read session not available; repo reachability unknown' }
}

/**
 * 「glab 已登录」这一项的判定（前两关）。
 *
 * 与 GitHub 那行同一套口径：只有明确「未登录」（kind=auth）才判 fail 并展示登录指引，
 * 网络抖动归 pending（诚实未知）。区别在于 GitLab 房间把起进程失败也归在 auth 档，
 * 所以这里要用 looksLikeTransportFailure 把网络类与「命令找不到」类原文退回 pending。
 */
export function glabAuthVerdict(pr: ChainEnvProbeReply, zh: boolean): ChainPredicateVerdict {
  if (pr.stage === 'pass') return { status: 'pass', detail: zh ? '已登录' : 'Logged in' }
  if (pr.stage === 'gh') return { status: 'pending', detail: envPendingDetail(pr, zh, 'glab', 'login') }
  if (pr.stage === 'repo') return { status: 'pass', detail: zh ? '已登录（仓库可达性由下一项判断）' : 'logged in (repo reachability is checked by the next item)' }
  if (pr.stage === 'auth') {
    const kind = pr.kind || 'exit'
    if (kind === 'network' || looksLikeTransportFailure(pr.message)) return { status: 'pending', detail: zh ? '网络异常，暂时无法确认 glab 登录状态' : 'glab auth status transport failure; login state unknown' }
    if (kind === 'auth') return { status: 'fail', detail: zh ? 'glab 登录状态已失效（重新执行 glab auth login）' : 'glab credential invalid or not logged in: re-authenticate (glab auth login)' }
    return { status: 'pending', detail: zh ? '暂时无法确认登录状态（' + kind + '）' : 'glab auth status failed (' + kind + '); login state unknown' }
  }
  return { status: 'pending', detail: zh ? '读会话还没接上，暂时无法确认登录状态' : 'read session not available; login state unknown' }
}

// ── 一次求值只问一次环境的那只探针（#1444）────────────────────────────────────────
/** 探针可选设置：这次求值问哪个后端的环境（缺省 github，老调用方的行为不变）。 */
type ChainEnvProbeOptions = { backendId?: string }

/**
 * #1444：一次求值的环境预检探针（登录态、仓库可达、当前登录用户名三件事都收在这里）。
 *
 * 为什么只开一个：这三件事问的是同一个工作区的同一份环境；会话的一次 preflight 已经把「找命令行 →
 * 登录态 → 仓库可达」三关走完，再问一遍只是多花一条 REST。所以探针在这一次求值里只开一次会话、
 * 只问一次 preflight，两个谓词与取登录名共用最后一份结果；求值结束探针即丢弃，
 * 失败结果绝不跨次缓存（下一次求值重新问）。
 *
 * 问的是哪个后端的环境由调用方在第三参给（缺省 github）：GitHub 的仓库身份宿主自己能读，
 * GitLab 的必须问会话能力（见 repoRefOnce 的注释）。
 *
 * 失败形状：开会话失败、能力失败、能力抛异常，一律收成「诚实未知」的档位交给调用方，
 * 绝不把异常抛给上层 —— 上层要照旧降级回缓存，而不是整条链变成 host.call.fail。
 */
export function probeChainEnv(deps: ChainEnvProbeDeps, probeCwd: string, opts?: ChainEnvProbeOptions): ChainEnvProbe {
  const { getRepoKey, openSession } = deps
  const backend = (opts && typeof opts.backendId === 'string' && opts.backendId) ? opts.backendId : 'github'
  let opened: Promise<OpenSessionReply> | null = null
  let preflight: Promise<ChainEnvProbeReply> | null = null
  let viewer: Promise<{ ok: boolean; login?: string }> | null = null
  let repoRef: Promise<string> | null = null
  let asked = 0
  let reused = 0
  function openOnce(): Promise<OpenSessionReply> {
    if (!opened) {
      opened = (async function (): Promise<OpenSessionReply> {
        if (typeof openSession !== 'function') return { ok: false, reason: '接线没有给 openSession' }
        try { return await openSession(probeCwd) } catch (e) { return { ok: false, reason: String((e && (e as CaughtError).message) || e) } }
      })()
    }
    return opened
  }
  /** 在会话里跑一次能力：开会话失败、能力抛异常都收成 {ok:false}，调用方按「未知」处理。 */
  async function callSession<T>(fn: (session: ChainReadSession, ctx: unknown) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const reply = await openOnce()
    if (!reply || reply.ok !== true || typeof reply.call !== 'function') {
      return { ok: false, reason: String((reply && (reply as { reason?: string }).reason) || 'open-failed') }
    }
    try { return { ok: true, value: await reply.call(fn) } } catch (e) { return { ok: false, reason: String((e && (e as CaughtError).message) || e) } }
  }
  /**
   * 房间要的这一次操作上下文：平台、起进程口、日志口与出站闸全在会话交来的那一份里。
   *
   * 为什么必须把会话交来的 ctx 原样带上：房间的 preflight 第一关就是读 opCtx.platform.resolveExecutable
   * （src/tracker/rooms/github/read/preflight.ts 的第 1 关，#1686 搬进 read/），getCurrentUser 也要经 opCtx 起 gh。只给 { cwd }
   * 时房间会立刻按环境失败收场（'gh not found: platform.resolveExecutable unavailable'），而记日志用的
   * opCtx.logEvent 同样不在，连一行失败日志都落不下来 —— 现象就是链上两项永远 pending、日志里查不到原因。
   * cwd 用本次求值的目录覆盖，是因为房间会拿它当 gh 的工作目录。
   */
  function opCtxOf(ctx: unknown, cwdStr: string): Record<string, unknown> {
    const base = (ctx && typeof ctx === 'object') ? (ctx as Record<string, unknown>) : {}
    return Object.assign({}, base, { cwd: cwdStr })
  }
  /**
   * 本次求值用来核对仓库的 refId（owner/name 形状，与会话 getRepoKey 的返回同形）；解析不到就空着，
   * 让谓词如实说「暂时确认不了」。
   *
   * 为什么按后端分两路：GitHub 的仓库身份宿主自己能读（deps.getRepoKey 只读本地 git 配置、不起进程）；
   * GitLab 的宿主读不出来 —— 它只认 GitHub 形状的地址，纯 GitLab 工作区会拿到空。房间才知道怎么认
   * （git remote → .git/config → glab repo view 三层），所以非 GitHub 后端经会话 getRepoKey 问房间；
   * 走会话也就是过操作管线的裁决与记账（与 #1453 同一口径）。
   */
  function repoRefOnce(): Promise<string> {
    if (!repoRef) repoRef = (async function () {
      if (backend !== 'github') {
        const r = await callSession(async function (session, ctx) {
          const ask = session.getRepoKey
          if (typeof ask !== 'function') return null
          return ask.call(session, probeCwd, opCtxOf(ctx, probeCwd))
        })
        if (!r.ok) return ''
        const rk = r.value
        return (rk && rk.owner && rk.name) ? rk.owner + '/' + rk.name : ''
      }
      try { const rk = await getRepoKey(probeCwd); return (rk && rk.owner && rk.name) ? rk.owner + '/' + rk.name : '' } catch (e) { return '' }
    })()
    return repoRef
  }
  function preflightOnce(): Promise<ChainEnvProbeReply> {
    if (preflight) { reused += 1; return preflight }
    asked += 1
    preflight = (async function (): Promise<ChainEnvProbeReply> {
      const refId = await repoRefOnce()
      const handle: ChainRepoHandle = { cwd: probeCwd, backend: backend }
      if (refId) handle.refId = refId
      // 第二格是这一次的操作上下文（见 opCtxOf 的注释）：只给 { cwd } 会让房间找不到命令行工具。
      const r = await callSession(function (session, ctx) { return session.preflight(handle, opCtxOf(ctx, probeCwd)) })
      if (!r.ok) return { stage: 'none', message: r.reason, refId: refId }
      const res = r.value
      if (res && res.ok === true) return { stage: 'pass', refId: refId }
      const error = (res && res.error) || {}
      const kind = String(error.kind || '')
      // refId 一起带回去：GitLab 的「仓库可达」要据此区分「确实没有」与「本地认不出、没核对」。
      return { stage: chainEnvStageOf(kind), kind: kind || 'unknown', message: String(error.message || ''), refId: refId }
    })()
    return preflight
  }
  function viewerOnce(): Promise<{ ok: boolean; login?: string }> {
    if (viewer) return viewer
    viewer = (async function () {
      const refId = await repoRefOnce()
      const r = await callSession(function (session, ctx) {
        // 与 preflight 同一份上下文（见 opCtxOf 的注释）：取登录名同样要经 opCtx 起 gh。
        return session.getCurrentUser({ backend: 'github', refId: refId, name: refId, url: '' }, opCtxOf(ctx, probeCwd))
      })
      if (!r.ok) return { ok: false }
      const res = r.value
      const login = (res && res.ok && res.data && res.data.login) ? String(res.data.login) : ''
      return { ok: !!login, login: login }
    })()
    return viewer
  }
  return { preflightOnce: preflightOnce, viewer: viewerOnce, asked: function () { return asked }, reused: function () { return reused } }
}

// ── #1566 仓库身份证据：两条检查谓词共用的一份结论 ────────────────────────────────────
// 为什么住在这里：「已关联 GitHub 仓库」与「仓库在 GitHub 上可访问」都要先回答「这个工作区的 GitHub
// 仓库是哪一个」。从前两条各自拿单值的 getRepoKey（只认 origin），origin 是自建 GitLab、GitHub 只是第二个
// 远端时必然判成「没有」。这份读法把宿主的 getRepoIdentity（三级本地证据、会扫全部远端）收成一次求值只读
// 一份结论：两个谓词并行跑也拿到同一个答案，不会一行说成功一行说失败。
// 约定（改之前先读）：1. 只读本地证据，不起进程、不发请求；2. 不跨求值缓存结论（人改完远端配置，下一次
// 重新检查必须看到新的）；3. 回 null 是「两条读远端的路都不可用」，调用方把它落 pending 并照实说
// 暂时确认不了，不许说成「一个 GitHub 远端都没有」。
/** 仓库身份证据的形状与宿主 getRepoIdentity 的返回一致：唯一身份 / 多个不同地址（不猜） / 一个都没有；null 另表读不到。 */
export type RepoIdentityEvidence = { kind: 'identity'; owner: string; name: string } | { kind: 'ambiguous'; candidates: Array<{ owner: string; name: string }> } | { kind: 'none' }

/** 把宿主的两条仓库身份读法收成一个按次求值缓存的小口子；调用方只需 forEval / failDetail / unknownDetail。 */
export function createRepoIdentityEvidence(deps: { getRepoKey(cwd: string): Promise<{ owner: string; name: string } | null>; getRepoIdentity?(cwd: string): Promise<RepoIdentityEvidence | null> }) {
  const { getRepoKey, getRepoIdentity } = deps
  /** 读一次身份证据：新接线先问 getRepoIdentity（它会扫全部远端），旧接线退回 getRepoKey 的单值结论。 */
  async function read(at: string): Promise<RepoIdentityEvidence | null> {
    if (typeof getRepoIdentity === 'function') { const ev = await getRepoIdentity(at); if (ev) return ev }
    const rk = await getRepoKey(at)
    if (rk && rk.owner && rk.name) return { kind: 'identity', owner: rk.owner, name: rk.name }
    // 新接线里 getRepoIdentity 回 null 就是「读不到」；旧接线（没有这一格）里 getRepoKey 回空才是「没有」。
    return typeof getRepoIdentity === 'function' ? null : { kind: 'none' }
  }
  // 键是这次求值的谓词上下文对象（一次求值一个，求值结束即可回收）：并行跑的两条谓词共用同一份 promise。
  const byEval = new WeakMap<object, Promise<RepoIdentityEvidence | null>>()
  function forEval(pctx: object | undefined, at: string): Promise<RepoIdentityEvidence | null> {
    const key = pctx && typeof pctx === 'object' ? pctx : null
    if (!key) return read(at)
    const hit = byEval.get(key)
    if (hit) return hit
    const pending = read(at)
    byEval.set(key, pending)
    return pending
  }
  /** 两条谓词共用的失败话术：「没有远端」与「有多个、不猜」必须能区分，后者还要告诉人怎么收口。 */
  function failDetail(ev: RepoIdentityEvidence, zh: boolean) {
    if (ev.kind === 'ambiguous') { const list = ev.candidates.map(function (c) { return c.owner + '/' + c.name }).join('、'); return zh ? '本地有多个不同的 GitHub 远端（' + list + '），无法确定用哪一个；请把主仓库的远端命名为 origin，或删掉多余的远端' : 'multiple GitHub remotes found (' + list + '); name the main repository remote origin, or remove the extra remotes' }
    return zh ? '本地没有指向 GitHub 的远端（git remote 与 .git/config 都查过）' : 'no GitHub remote in this workspace (checked git remote and .git/config)'
  }
  /** 连远端列表都读不到时的待定话术：不冒充「没有」，也不冒充出站失败。 */
  function unknownDetail(zh: boolean) {
    return zh ? '读不到本地仓库信息（没有 git，也读不到 .git/config），暂时确认不了' : 'cannot read local repository info (no git, and .git/config unreadable); cannot confirm yet'
  }
  return { forEval: forEval, failDetail: failDetail, unknownDetail: unknownDetail }
}
