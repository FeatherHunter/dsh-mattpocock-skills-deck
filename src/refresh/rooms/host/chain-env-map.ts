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
//   2. 档位表 CHAIN_ENV_STAGE_OF 把 preflight 的失败档位归到三关：gh（命令或网络）、auth（登录态）、repo（仓库）。
//      表里没有的档位一律按 auth 算：宁可说「登录态未知」，也不能把一次没归类的失败说成「仓库不存在」——
//      后者会误导人去建一个已经存在的仓库。
//   3. 两个谓词的分派与话术（中英双语）和 check-chain-evaluation.ts 的注册处是同一套字面量，
//      改文案或改档位要同步 tests/verify-chain-env-e2e.ts 的期望。

// ── 会话的能力面（#1415 起宿主侧有真实现，见 session-opener.ts；这里只写调用方依赖的形状）──
// 规格第 9 节：除 readBudget 外不新增能力、不改参数。所以这里只声明真用到的两条读能力；
// 多一个字段就是扩契约，宁可另立一票。
type ChainReadError = { kind?: string; message?: string; raw?: string }
/** 房间 preflight 的入参（RepoHandle 的子集：本文件只给得出目录、仓库 refId 与后端 id）。 */
type ChainRepoHandle = { cwd?: string; refId?: string; backend?: string }
/** 房间 getCurrentUser 的入参（RepositoryRef 的子集：房间真正读的是 opCtx.cwd，这几格按契约给全）。 */
type ChainRepoRef = { backend: string; refId: string; name: string; url: string }
/** 只读会话：本文件只用这两条读能力。 */
type ChainReadSession = {
  preflight(handle: ChainRepoHandle, ctx: unknown): Promise<{ ok: boolean; error?: ChainReadError | null }>
  getCurrentUser(repo: ChainRepoRef, ctx: unknown): Promise<{ ok: boolean; data?: { login?: string } | null; error?: ChainReadError | null }>
}
/** 开会话成功那一份：call(fn) 把会话与这一次的 opCtx 交给能力函数（形状见 session-opener.ts）。 */
type OpenedChainSession = { ok: true; backendId?: string; call<T>(fn: (session: ChainReadSession, ctx: unknown) => Promise<T>): Promise<T> }
/** 开会话的两种回包：成功可调能力，失败带原因（本文件不重试、不抛，只降级）。 */
export type OpenSessionReply = OpenedChainSession | { ok: false; reason?: string; detail?: string }

/**
 * 环境那一关的结论：pass 三关全过；none 会话没接上（接线缺省或开不出来）；
 * 其余三种是停在哪一关——gh 可执行没找到 / 登录态问不出来 / 仓库不可达。
 */
type ChainEnvProbeReply = { stage: 'pass' | 'none' | 'gh' | 'auth' | 'repo'; kind?: string; message?: string }

/**
 * preflight 的失败档位 → 这一次求值停在哪一关（写死的对照表，#1444）。
 *
 * 为什么需要反推：房间的 preflight 只回一个错误档位（TrackerError.kind），不回「停在第几步」；
 * 而链上两行要按关分开显示，所以只能按「哪种档位只可能在哪一关出现」反推：
 *   · env 只可能是第一关（找不到 gh 可执行）；
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
  /** 读本地 git 配置里的 GitHub 仓库（owner/name）；只读本地，不起进程。 */
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
  if (pr.stage === 'gh') return { status: 'pending', detail: zh ? '暂时无法确认仓库可访问（没找到 gh 可执行）' : 'gh executable not found; repo reachability unknown' }
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
  if (pr.stage === 'gh') return { status: 'pending', detail: zh ? '暂时无法确认登录状态（没找到 gh 可执行）' : 'gh executable not found; login state unknown' }
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

// ── 一次求值只问一次环境的那只探针（#1444）────────────────────────────────────────
/**
 * #1444：一次求值的环境预检探针（登录态、仓库可达、当前登录用户名三件事都收在这里）。
 *
 * 为什么只开一个：这三件事问的是同一个工作区的同一份环境；会话的一次 preflight 已经把「找 gh →
 * gh auth status → api repos/o/n」三关走完，再问一遍只是多花一条 REST。所以探针在这一次求值里
 * 只开一次会话、只问一次 preflight，两个谓词与取登录名共用最后一份结果；求值结束探针即丢弃，
 * 失败结果绝不跨次缓存（下一次求值重新问）。
 *
 * 失败形状：开会话失败、能力失败、能力抛异常，一律收成「诚实未知」的档位交给调用方，
 * 绝不把异常抛给上层 —— 上层要照旧降级回缓存，而不是整条链变成 host.call.fail。
 */
export function probeChainEnv(deps: ChainEnvProbeDeps, probeCwd: string): ChainEnvProbe {
  const { getRepoKey, openSession } = deps
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
   * （src/tracker/rooms/github/preflight.ts 的第 1 关），getCurrentUser 也要经 opCtx 起 gh。只给 { cwd }
   * 时房间会立刻按环境失败收场（'gh not found: platform.resolveExecutable unavailable'），而记日志用的
   * opCtx.logEvent 同样不在，连一行失败日志都落不下来 —— 现象就是链上两项永远 pending、日志里查不到原因。
   * cwd 用本次求值的目录覆盖，是因为房间会拿它当 gh 的工作目录。
   */
  function opCtxOf(ctx: unknown, cwdStr: string): Record<string, unknown> {
    const base = (ctx && typeof ctx === 'object') ? (ctx as Record<string, unknown>) : {}
    return Object.assign({}, base, { cwd: cwdStr })
  }
  /** 本地解析仓库 refId（getRepoKey 只读本地 git 配置，不起进程）；解析不到就空着，交给房间自己回 not-found。 */
  function repoRefOnce(): Promise<string> {
    if (!repoRef) repoRef = (async function () { try { const rk = await getRepoKey(probeCwd); return (rk && rk.owner && rk.name) ? rk.owner + '/' + rk.name : '' } catch (e) { return '' } })()
    return repoRef
  }
  function preflightOnce(): Promise<ChainEnvProbeReply> {
    if (preflight) { reused += 1; return preflight }
    asked += 1
    preflight = (async function (): Promise<ChainEnvProbeReply> {
      const refId = await repoRefOnce()
      const handle: ChainRepoHandle = { cwd: probeCwd, backend: 'github' }
      if (refId) handle.refId = refId
      // 第二格是这一次的操作上下文（见 opCtxOf 的注释）：只给 { cwd } 会让房间找不到 gh。
      const r = await callSession(function (session, ctx) { return session.preflight(handle, opCtxOf(ctx, probeCwd)) })
      if (!r.ok) return { stage: 'none', message: r.reason }
      const res = r.value
      if (res && res.ok === true) return { stage: 'pass' }
      const error = (res && res.error) || {}
      const kind = String(error.kind || '')
      return { stage: chainEnvStageOf(kind), kind: kind || 'unknown', message: String(error.message || '') }
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
