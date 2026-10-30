/**
 * src/tracker/rooms/github/write/init-project.ts — 开仓发布流程。
 * #1687 阶段 1：从房间根迁入 write/，房间根的同名转发文件已在 #1687 末批删除，行为零变化。
 *
 * 由 #440 从 index.js 纯结构移出（initProject），行为零变化。
 * 以后改创建发布流程的人改它。预估约 215 行。
 */

import { ghClient } from '../transport/client.js'
import { getRepoKey } from '../model/repo.js'
// #993 / #994：分类器与「属主不一致」判断都收进 src/shared/tracker/（cross-import 门禁的白名单目录），
//   与面板那条路（src/host/publishFlow.js）共用同一份实现，避免两处各判一套而漂移。
import { makeCreateErrorClassifier, KIND_UNKNOWN } from '../support/init-project-error-kinds.js'
// 结果词表里凡是要说 TrackerError 八档中某一档的地方，取值都引用真源常量，不写裸字符串，
// 免得「少一个连字符」「换个近义词」这类偏差逃过检查；本文件其余自成一档的结果词不在八档内，保持原样。
import { ERROR_KIND } from '../../../contract/vocabulary.js'
import { isOwnershipMismatch, ownershipPathFrom, safeDirectoryCommand } from '../../../kernel/workspace-ownership.js'
// #1111：失败结果统一是三段式（kind / message / raw），这里几条直接写出来的失败字面量也要带原文段 ——
//   原文取法走跟踪器层唯一那套（多路合并、遮蔽凭据、头尾截断），与 fail() 一致。
import { rawText } from '../../../kernel/preflight.js'
import type { OpContext, RepoHandle } from '../../../contract/contexts.js';
import type { RepositoryRef } from '../../../contract/entities.js';
import type { InitProjectInput } from '../../../contract/inputs.js';
// #106 `repo.init`：开仓发布这一趟的常驻结论线（轨迹形状与发射口在 ./write-log.js）。
import { beginWriteTrail, emitRepoInitWrite } from '../support/write-log.js'
import type { WriteTrail } from '../support/write-log.js';
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GIT_PROBE_TIMEOUT_MS, GITHUB_INIT_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/**
 * 开仓失败的错误：三段式，但 kind 是开仓自己的结果词（bad-name/no-git/no-gh/not-logged-in/
 * already-exists/network/permission/git-ownership/unknown 这些，不在 TrackerError 八档内，见函数头注释）。
 * raw 只是通常有：建仓那条分支历史上就没带原文段，保持原样（不断言、不补），所以标成可选。
 */
interface InitProjectError {
  kind: string;
  message: string;
  raw?: string;
  prompt?: string;
  repoUrl?: string;
}

/** 开仓的返回：成功带仓库身份，失败带上面那句。 */
type InitProjectOutcome = { ok: true; data: RepositoryRef } | { ok: false; error: InitProjectError };

/** 本地进程执行结果：成功带原文，失败带退出码与一句短错（原文段由调用方另取，这里只记短错）。 */
type ProcResult = { ok: true; code: number; text: string } | { ok: false; code: number; error: string; text: string };

/**
 * 工作区 git 可用性结论：能用（本来就能用、刚自愈好、本来就不是仓库三选一）或不能用（带档位与 git 原话）。
 * 可选格只出现在成功分支里，调用方 `usable.notRepoYet` 读到的一定是成功分支，不用再收窄。
 */
type WorktreeUsable =
  | { ok: true; healed?: boolean; notRepoYet?: boolean }
  | { ok: false; kind: string; text: string; triedRepair?: boolean };

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，直接读 message 报缺成员；
// 转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown, len: number): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}

// ============ initProject 契约 op（git init→commit→gh repo create→push） ============
/**
 * 工作区初始化并发布为 GitHub 仓库。
 * 流程与 host 原 wf.initPublish 等价（错误分类档位语义不变；#993 起兜底为 unknown、增属主一档）：
 *  - 前置：#994 工作区 git 可用性（属主不一致则补 safe.directory 重试一次）/ git / gh / auth
 *    （失败快返，避免已改动工作区）
 *  - 步骤：git init(已是 git 则跳过) → git add . → git commit(--allow-empty+user.*兜底) → gh repo create(--source=.--push 或 set-url+push)
 *  - 成功：{ok:true, data:RepositoryRef}
 *  - 失败：{ok:false, error:{kind, message, raw}} kind∈{no-git,no-gh,not-logged-in,already-exists,network,permission,git-ownership,unknown}
 *    （raw 是原文段：确实没有原文的本地判断给空串，有 git / gh 原话的一律交出来，界面能展开看）
 */
/** 开仓发布的对外入口：建一趟轨迹、交给内层干、出口按 #106 `repo.init` 记一行结论 ——
 *  事后能回答「仓库到底建没建起来、走到第几条命令、卡在推之前还是推之后」。 */
export async function initProject(handle: RepoHandle, input: InitProjectInput, ctx: OpContext): Promise<InitProjectOutcome> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await initProjectInner(handle, input, ctx, trail)
  emitRepoInitWrite(ctx, trail, r, t0)
  return r
}

/** 开仓发布的本体（对外名字与行为都在上面那个入口上）。 */
async function initProjectInner(handle: RepoHandle, input: InitProjectInput, ctx: OpContext, trail: WriteTrail): Promise<InitProjectOutcome> {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
  const name = input && input.name ? String(input.name).trim() : ''
  const visibility = input && input.visibility === 'public' ? 'public' : 'private'
  if (!name) return { ok: false, error: { kind: 'bad-name', message: '仓库名为空', raw: '' } }
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
    return { ok: false, error: { kind: 'bad-name', message: '仓库名仅支持字母/数字/._- 且 ≤100：' + name, raw: String(name) } }
  }
  const visFlag = visibility === 'public' ? '--public' : '--private'

  const platform = ctx && ctx.platform ? ctx.platform : null
  const execFn = ctx && typeof ctx.exec === 'function' ? ctx.exec.bind(ctx) : (platform && typeof platform.exec === 'function' ? platform.exec.bind(platform) : null)

  // gh 也记一步：gh 走房间唯一的出口（ghClient），不经过上面的 execProcLocal。
  async function ghStep(args: string[], opts: { cwd: string }) {
    trail.steps += 1
    return ghClient(ctx).execGh(args, opts)
  }

  // helper: execProc 兼容层（ctx.exec 契约 {stdout,stderr,code}；host 旧 execProc 返回 {ok,text,error}）
  async function execProcLocal(argv: string[], execCwd: string): Promise<ProcResult> {
    // 起一条命令算一步：#106 `repo.init` 的 steps 就这么数出来的（「走到第几步」由它回答）。
    trail.steps += 1
    const cmd = argv[0]
    const args = argv.slice(1)
    if (execFn) {
      try {
        const r = await execFn(cmd, args, { cwd: execCwd || cwd, timeout: GITHUB_INIT_TIMEOUT_MS })
        const code = r && typeof r.code === 'number' ? r.code : 0
        const out = r && typeof r.stdout === 'string' ? r.stdout : (r && r.text ? r.text : '')
        const err = r && typeof r.stderr === 'string' ? r.stderr : ''
        if (code !== 0) return { ok: false, code, error: (err || out || 'exit '+code).slice(0,400), text: out }
        return { ok: true, code: 0, text: out }
      } catch (e) {
        return { ok: false, code: -1, error: caughtMessage(e, 400), text: '' }
      }
    }
    // 回退：尝试 ghClient 的底层（仅用于测试 mock）
    return { ok: false, code: -1, error: 'exec unavailable', text: '' }
  }

  async function resolveGitLocal() {
    if (platform && typeof platform.resolveExecutable === 'function') {
      try { const p = await platform.resolveExecutable('git'); if (p) return p } catch (e) {}
    }
    if (execFn) {
      try { const r = await execFn('git', ['--version'], { cwd, timeout: GIT_PROBE_TIMEOUT_MS }); if (r && r.code===0) return 'git' } catch (e) {}
    }
    return null
  }

  async function resolveGhLocal() {
    if (platform && typeof platform.resolveExecutable === 'function') {
      try { const p = await platform.resolveExecutable('gh'); if (p) return p } catch (e) {}
    }
    return null
  }

  // #993：分类器与宿主那条路（src/host/publishFlow.js）共用一份，见文件头引入说明。
  const classifyCreateError = makeCreateErrorClassifier({ isOwnership: isOwnershipMismatch })

  // ============ #994：动手前的「工作区 git 可用性」探测与属主自愈 ============
  // 与 publishFlow.js 同一套判据（探针命令、自愈写法、失败信封都一致），两处共用共享模块出判断。
  const NOT_A_REPO_RE = /not a git repository/i

  async function probeWorktreeUsable(git: string, cwd: string): Promise<WorktreeUsable> {
    const r = await execProcLocal([git, '-C', cwd, 'rev-parse', '--is-inside-work-tree'], cwd)
    if (r.ok) return { ok: true }
    const text = String(r.error || '')
    if (isOwnershipMismatch(text)) return { ok: false, kind: 'git-ownership', text }
    if (NOT_A_REPO_RE.test(text)) return { ok: true, notRepoYet: true }
    return { ok: false, kind: classifyCreateError(text, null), text }
  }

  async function healOwnership(git: string, cwd: string, probeText: string): Promise<{ ok: boolean; dir: string }> {
    const dir = ownershipPathFrom(probeText) || cwd
    const r = await execProcLocal([git, 'config', '--global', '--add', 'safe.directory', dir], cwd)
    return { ok: !!r.ok, dir: dir }
  }

  // git 侧失败的统一信封：属主那一档给可照做的一句话，unknown 那一档把 git 原话带给用户。
  function gitFail(errText: string, cwd: string): { ok: false; error: InitProjectError } {
    const kind = classifyCreateError(errText, null)
    const raw = String(errText || '')
    if (kind === 'git-ownership') {
      const cmd = safeDirectoryCommand(ownershipPathFrom(raw) || cwd || '')
      return { ok: false, error: { kind: kind, message: '这个工作区的属主不是当前运行用户，git 拒绝操作（原文：dubious ownership）。' + (cmd ? '修法：' + cmd : ''), raw: raw } }
    }
    if (kind === KIND_UNKNOWN) {
      return { ok: false, error: { kind: kind, message: '创建失败，未识别的原因。git 原话：' + raw.slice(0, 160), raw: raw } }
    }
    return { ok: false, error: { kind: kind, message: raw, raw: raw } }
  }

  // 返回 ok 时，工作区要么本来就能用 git，要么刚补好 safe.directory 并已确认能用；
  //   返回失败时，这一步一步都没改过这个目录。
  async function preflightWorkspaceGit(git: string, cwd: string): Promise<WorktreeUsable> {
    const first = await probeWorktreeUsable(git, cwd)
    if (first.ok) return first
    if (first.kind !== 'git-ownership') return first
    await healOwnership(git, cwd, first.text)
    const second = await probeWorktreeUsable(git, cwd)
    if (second.ok) return { ok: true, healed: true }
    // 修了还是不行（写不进全局配置，或配置里的路径与 git 认的不是同一个字符串）—— 如实报。
    return { ok: false, kind: 'git-ownership', text: second.text, triedRepair: true }
  }

  // 前置探测：git / gh / auth（失败快返，避免已改动工作区）
  const git = await resolveGitLocal()
  if (!git) return { ok: false, error: { kind: 'no-git', message: '未找到 git（请安装 https://git-scm.com/）', raw: '' } }
  const gh = await resolveGhLocal()
  if (!gh) return { ok: false, error: { kind: 'no-gh', message: '未在 DSH 启动时继承的 PATH 中解析到 gh 可执行文件（可能未安装，也可能安装后未重启 DSH）', raw: '', prompt: 'DSH 进程启动时从父进程继承的 PATH 中未解析到 GitHub CLI（gh）可执行文件。该结果不等同于 gh 未安装。按以下顺序处理：\n\n1. 在 DSH 之外的终端执行 `gh --version`。\n2. 有版本号输出：gh 已安装。无需重复安装。将 gh 所在目录加入用户级或系统级 PATH，或将本插件读取的 DSH_GH_PATH 设为 gh 可执行文件的绝对路径，再重启 DSH Desktop；若该目录已在 PATH 中，直接重启 DSH Desktop。重启时从开始菜单、桌面或资源管理器启动，避免从旧终端或旧 IDE 会话启动（其进程环境可能未包含新 PATH）。\n3. 无版本号输出：该终端也无法执行 gh。检查 gh 的安装目录（Windows 默认：C:\\Program Files\\GitHub CLI\\gh.exe）；确认未安装后，按官方说明安装：https://cli.github.com/。安装后重启 DSH。\n4. “重新检查”只重跑检查逻辑，不重新读取进程环境变量；不能替代重启 DSH。\n5. 完成后确认：`gh --version` 有输出，环境检查的 gh 项通过。' } }
  // auth 探测
  try {
    const authR = await ghStep(['auth', 'status'], { cwd })
    if (!authR.ok) {
      const t = String((authR.error && authR.error.message) || authR.error || '').toLowerCase()
      const kind = authR.error && authR.error.kind
      if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
        return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: String(authR.error.message || authR.error).slice(0,400), raw: rawText(authR.error) } }
      }
      return { ok: false, error: { kind: 'not-logged-in', message: String(authR.error.message || authR.error).slice(0,400), raw: rawText(authR.error) } }
    }
  } catch (e) {
    // 判定口径不动：网络味仍在前 400 字里认（与原来一字不差）。400 字之后的关键字今天认不出来，
    // 这是已知欠账（超长输出的误判），改判定口径另立一票，不在这次类型化里顺手改。
    const eb = e as CaughtMsg;
    const full = String((eb && eb.message) || e)
    const t = full.slice(0, 400).toLowerCase()
    if (/network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: full.slice(0, 400), raw: rawText(e) } }
    return { ok: false, error: { kind: 'not-logged-in', message: full.slice(0, 400), raw: rawText(e) } }
  }

  // 取当前登录用户（用于 already-exists 时拼 repoUrl 与成功后 owner 兜底）
  let currentUser = ''
  try {
    const u = await ghStep(['api', 'user', '-q', '.login'], { cwd })
    if (u && u.ok) currentUser = (u.data.stdout || '').trim()
  } catch (e) { /* 忽略 */ }

  // 0. #994：动手改工作区之前的可用性关卡（属主不一致在这一步被拦下并试着自愈，
  //    不会等到 git add 才炸；失败时这一步没有改动过这个目录）。
  const usable = await preflightWorkspaceGit(git, cwd)
  if (!usable.ok) return gitFail(usable.text, cwd)

  // 1. git init（若已是 git 仓库则跳过）
  try {
    if (usable.notRepoYet) {
      const initR = await execProcLocal([git, 'init'], cwd)
      if (!initR.ok) return gitFail(initR.error, cwd)
    }
  } catch (e) {
    const initR = await execProcLocal([git, 'init'], cwd)
    if (!initR.ok) return gitFail(initR.error, cwd)
  }

  // 2. git add .
  const addR = await execProcLocal([git, 'add', '.'], cwd)
  if (!addR.ok) return gitFail(addR.error, cwd)

  // 3. git commit --allow-empty（含 identity 缺失兜底）
  let commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
  if (!commitR.ok) {
    const low = String(commitR.error || '').toLowerCase()
    if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
      await execProcLocal([git, 'config', 'user.email', 'dsh@local'], cwd)
      await execProcLocal([git, 'config', 'user.name', 'DSH User'], cwd)
      commitR = await execProcLocal([git, 'commit', '-m', 'initial commit', '--allow-empty'], cwd)
    }
    if (!commitR.ok) return gitFail(commitR.error, cwd)
  }

  // 4. 探测 remote origin 是否已存在（决定 gh 调用分支）
  let hasOrigin = false
  try {
    const ro = await execProcLocal([git, 'remote', 'get-url', 'origin'], cwd)
    hasOrigin = !!ro.ok
  } catch (e) { hasOrigin = false }

  // 5. gh repo create
  if (!hasOrigin) {
    // 走的是「新建远程仓库并推上去」那条路。
    trail.route = 'created'
    const cr = await ghStep(['repo', 'create', name, visFlag, '--source=.', '--push'], { cwd })
    if (!cr.ok) {
      // 为什么断言一下：失败的 message 恒有字（空串才退回整个错误值），分类器只要字符串；断言只为过编译，交的还是原来那个值，运行时不变。
      const kind = classifyCreateError((cr.error.message || cr.error) as string, cr.error && cr.error.kind)
      const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
      // 为什么错误体单列形状：建仓这条分支历史上就不带原文段（raw 缺席），与别处的三段式不一样；标成可选是如实记录现状，不是漏写。
      const err: InitProjectError = { kind, message: String(cr.error.message || cr.error).slice(0, 400) }
      if (repoUrl) err.repoUrl = repoUrl
      // 为什么断言：gh 的失败里没有 prompt 这一格（类型上就没有），但旧逻辑留了这道门（万一哪天有了就透传）；
      // 断言只为过编译，读的还是原来那一格，有就是有、没有就是没有，运行时不变。
      const maybePrompt = (cr.error as unknown as { prompt?: unknown }).prompt;
      if (cr.error && maybePrompt) err.prompt = maybePrompt as string;
      return { ok: false, error: err }
    }
  } else {
    // origin 已存在：先创建远程仓库（不带 --source），再 set-url + push
    // 走的是「推到一个已经存在的远程」那条路。
    trail.route = 'existing'
    const cr2 = await ghStep(['repo', 'create', name, visFlag], { cwd })
    if (!cr2.ok) {
      // 为什么断言一下：同上，分类器只要字符串，交的还是原来那个值，运行时不变。
      const kind = classifyCreateError((cr2.error.message || cr2.error) as string, cr2.error && cr2.error.kind)
      const repoUrl = (kind === 'already-exists' && currentUser) ? ('https://github.com/' + currentUser + '/' + name) : undefined
      const err: InitProjectError = { kind, message: String(cr2.error.message || cr2.error).slice(0, 400) }
      if (repoUrl) err.repoUrl = repoUrl
      return { ok: false, error: err }
    }
    // 解析新建仓库 URL（gh 输出含 https://github.com/owner/name）
    let remoteUrl = ''
    if (currentUser) remoteUrl = 'https://github.com/' + currentUser + '/' + name + '.git'
    else {
      const m = String((cr2.data && cr2.data.stdout) || '').match(/https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+/)
      if (m) remoteUrl = m[0] + '.git'
    }
    if (remoteUrl) {
      await execProcLocal([git, 'remote', 'set-url', 'origin', remoteUrl], cwd)
    }
    const pushR = await execProcLocal([git, 'push', '-u', 'origin', 'HEAD'], cwd)
    if (!pushR.ok) return gitFail(pushR.error, cwd)
  }

  // 成功：解析 owner（优先 getRepoKey，回退 currentUser）
  let owner = currentUser
  try {
    const rk = await getRepoKey(cwd, ctx)
    if (rk && rk.owner) owner = rk.owner
  } catch (e) {}
  if (!owner) {
    try {
      const u2 = await ghStep(['api', 'user', '-q', '.login'], { cwd })
      if (u2 && u2.ok) owner = (u2.data.stdout || '').trim()
    } catch (e2) {}
  }
  const refId = owner ? owner + '/' + name : name
  const repoRef = { backend: 'github', refId, name: refId, url: 'https://github.com/' + refId }
  return { ok: true, data: repoRef }
}
