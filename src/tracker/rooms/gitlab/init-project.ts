/**
 * src/tracker/rooms/gitlab/init-project.ts —— GitLab 房的「开仓发布」：把当前工作区建成一张新仓库并推上去。
 *
 * ── 与 GitHub 房那份的关系 ────────────────────────────────────────────────────
 * 契约（`contract/operations.ts` 的 `initProject`）只有一份，两个远端后端各写一遍。GitHub 那份
 * （`rooms/github/init-project.ts`）的步骤是本房的模板：
 *   前置（git 在不在、登录了没有）→ 本地 `git init` / `add` / `commit --allow-empty`
 *   → 建远端仓库 → 把 origin 指过去 → `git push -u origin HEAD` → 回 `RepositoryRef`。
 * 本房照这五步做，只把 GitHub 专有的那段换成 glab，**没有照搬的两处**如实记在这里：
 *   · GitHub 走 `gh repo create <name> --source=. --push`（一条命令里建仓 + 推），glab 没有等价开关；
 *     本房因此把「建远端」与「配 remote + 推」拆成两条命令，顺序与 GitHub 那条 `--source` 分支一致。
 *   · GitHub 前置里有 #994 那道「工作区属主不一致就补 `safe.directory` 自愈一步」，本房今天没搬
 *     （GitLab 房第一次实现开仓发布，先做最小等价序列）；撞上属主问题时 git 的原话会经
 *     `failGlab` 带出来，人看得见原因，只是要自己修一次。
 *
 * ── glab 这一侧到底有什么（官方 CLI 文档，2026-10-14 查）────────────────────────
 * `glab repo create [path] [flags]`，与本房有关的参数：
 *   `-n/--name`、`-d/--description`、`-p/--private`、`-P/--public`、`--internal`、
 *   `--group <namespace>`、`--defaultBranch`、`-s/--skipGitInit`、`--remoteName`。
 * 三件要写下来的实话：
 *   1）**没有 `--source` 这个开关**（那是 `gh repo create` 的）；票面里写的 `--source` 在 glab 上不存在。
 *   2）不带 `--group` 时，项目建在当前登录人的命名空间下（文档原文：defaults to the current user's namespace）。
 *   3）不带 `--private` / `--public` / `--internal` 时，可见性取实例默认值 —— 所以本房**总是显式给一个**
 *      （契约的 `InitProjectInput.visibility` 省略时按私有处理，那就显式传 `--private`）。
 * 另外两处要说清楚（2026-10-15 查官方文档与 glab 源码核实）：
 *   · `-s/--skipGitInit` **要传**。官方 CLI 文档那一页原文是
 *     「`-s, --skipGitInit            Skip local repository setup (skips both 'git init' and cloning).`」
 *     （https://docs.gitlab.com/cli/repo/create/；源文件 docs/source/repo/create.md）。
 *     glab 源码 `internal/commands/project/create/project_create.go` 里，本函数用的这一路
 *     （`glab repo create <名字>`，带一个名字参数）默认会问一句「Create a local project directory for <项目全路径>?」，
 *     答「是」就在**新建的子目录**里 `git init` + `git remote add origin`；源码里那一段的门就是
 *     `if !skipGitInit && …`，也就是说只有 `-s` 能把它整个关掉。
 *     而本函数在这之前已经自己在工作区里 `git init` / `add` / `commit` 过，之后又自己把 origin 指到新仓库 ——
 *     再让 glab 做一次本地初始化，要么在交互式终端里多一次挡路的提问、要么在别处多建一个没人要的目录，
 *     两种结果都不是本函数想要的。宿主没有终端时 glab 本来就不做本地初始化，传 `-s` 是把这条口径**写明**，
 *     让它不再取决于「这一次有没有终端」。
 *   · `--remoteName` 仍然不传：默认值本来就是 origin，配 remote 这一步由本函数自己做，看得见也测得出。
 *
 * ── 一次失败可能已经改过世界，写清楚免得人误判 ─────────────────────────────────
 * 远端仓库建成之后还有两步（配 remote、`git push`），这两步失败时**远端仓库已经存在**：
 * 失败回包里那句话就是照着这个事实写的（「远端仓库已经建好了，本地提交还在，修好之后重推即可」），
 * 别把它读成「什么都没发生」。
 *
 * ── 安全：这条路会真的建远端仓库、真的 push ────────────────────────────────────
 * 它只由用户点「发布」那条链触发；写代码的人不要拿它去试跑。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { OpContext, RepoHandle } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { InitProjectInput } from '../../contract/inputs.js'
import type { OpResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { projectPath } from './queries.js'
import { parseGitlabRepo } from './repo.js'

/** glab 客户端的最小口：本文件只用它的 run，类型从工厂的返回里取，不另写一份。 */
type GlabClient = ReturnType<typeof glabClient>

/** 本地进程的一次执行结果：三格与 glabClient 的回包同形状，git 那几条命令走同一套读法。 */
interface ProcResult {
  code: number
  stdout: string
  stderr: string
}

/** 认出来的新建仓库：`refId` 是 `group/sub/project`，`repoUrl` 是不带 .git 的浏览地址。 */
interface CreatedProject {
  refId: string
  repoUrl: string
}

/** 取异常里那句话；取不到就把异常本身转成字符串（与房内其余文件的同一套写法）。 */
function errText(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/** 把一段文本当 JSON 对象读；空串、数组、解析不了、字面 null 一律回 null。 */
function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  try {
    const v = JSON.parse(t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * 把执行器的回包归一成三格。
 *
 * 为什么要兼容层：契约里 `ctx.exec` 的回包是 `{stdout, stderr, code}`，而宿主旧接口给的是
 * `{ok, out, error}` / `{text}`（同一套兼容层在 `./client.ts` 里也有一份，那边是给 glab 用的）。
 * 少了它，换一台宿主就会把「命令失败了」读成「命令成功了、输出为空」。
 */
function toProc(raw: unknown): ProcResult {
  const bag = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const stdout =
    typeof bag['stdout'] === 'string'
      ? bag['stdout']
      : typeof bag['text'] === 'string'
        ? bag['text']
        : typeof bag['out'] === 'string'
          ? bag['out']
          : ''
  const stderr = typeof bag['stderr'] === 'string' ? bag['stderr'] : typeof bag['error'] === 'string' ? bag['error'] : ''
  const code =
    typeof bag['code'] === 'number' ? bag['code'] : typeof bag['ok'] === 'boolean' ? (bag['ok'] ? 0 : 1) : 0
  return { code, stdout, stderr }
}

/**
 * 从 `glab repo create` 的输出里认出新建项目的地址。
 *
 * 为什么以它的输出为主：glab 建完会把项目地址打出来（含真实主机，自建实例也照打），
 * 这是唯一一条不用我们拼主机、也不用再问一次远端的来源。认不出的（改了输出格式、被本地化）
 * 只是没有这一格，不当作故障 —— 调用方还会去回查一次。
 *
 * @param stdout 那一次 `glab repo create` 的标准输出
 */
function addressFromOutput(stdout: string): CreatedProject | null {
  const urls = String(stdout || '').match(/https?:\/\/[^\s"'<>]+/g) ?? []
  for (const raw of urls) {
    // 末尾常挂标点（句号、右括号），先修掉再交给 parser；parser 自己会去掉 .git 与查询串。
    const cleaned = raw.replace(/[)\]},.;:'"]+$/, '')
    const key = parseGitlabRepo(cleaned)
    if (!key) continue
    return { refId: key.owner + '/' + key.name, repoUrl: cleaned.replace(/\.git$/i, '').replace(/\/+$/, '') }
  }
  return null
}

/**
 * 回查刚建好的项目，拿它的全路径与地址（`addressFromOutput` 认不出时的第二条路）。
 *
 * 为什么要回查而不是自己拼 `https://gitlab.com/<登录人>/<名字>`：拼出来的主机名只在一处是对的
 * （gitlab.com），自建实例上会拼出一个指向别处的地址 —— 而 `git push` 到别处是**真的会写**。
 * 宁可为这一格多问一次，也不拿猜出来的地址去配 remote。
 *
 * @param c glab 客户端
 * @param fallbackPath 「登录人/仓库名」，不带 `--group` 建仓时项目就落在登录人的命名空间下
 */
async function readCreatedProject(c: GlabClient, fallbackPath: string): Promise<CreatedProject | null> {
  const res = await c.run(['api', projectPath(fallbackPath)], { timeout: 8000 })
  if (res.code !== 0) return null
  const bag = parseJsonObject(res.stdout)
  if (!bag) return null

  const full = typeof bag['path_with_namespace'] === 'string' ? bag['path_with_namespace'].trim() : ''
  const web =
    typeof bag['web_url'] === 'string'
      ? bag['web_url'].trim()
      : typeof bag['http_url_to_repo'] === 'string'
        ? String(bag['http_url_to_repo']).trim()
        : ''
  // 地址那一格必须是真地址：没有它就没有可信的主机名，宁可回 null 让上层如实失败。
  if (!web) return null
  const fromWeb = parseGitlabRepo(web)
  // 全路径优先（它是项目的权威坐标，多段分组也照原样保留）；地址反推只作兜底。
  const refId = full || (fromWeb ? fromWeb.owner + '/' + fromWeb.name : '')
  if (!refId || refId.split('/').filter((s) => s.length > 0).length < 2) return null
  const repoUrl = web.replace(/\.git$/i, '').replace(/\/+$/, '')
  return { refId, repoUrl }
}

/**
 * 初始化并发布工作区（契约的 `initProject`）。
 *
 * 步骤与失败归因，一条一条对着 GitHub 那份：
 *   0）仓库名先校验（空、含非法字符、超过 100 字 → `parse`；此时一个进程都没起、工作区没动）；
 *   1）前置：git 在不在（不在 → `env`）、glab 答不答得出当前登录人（答不出 → `failGlab` 按原文判档，
 *      多半是 `env` 或 `auth`）。放在改工作区之前，是为了避免「已经 commit 了才发现没登录」；
 *   2）`git rev-parse --is-inside-work-tree` 不是仓库才 `git init`；
 *   3）`git add .`；4）`git commit -m 'initial commit' --allow-empty`（identity 缺失时补一次再重试）；
 *   5）`glab repo create <名字> --private|--public`（建远端；这一步之后世界已经变了）；
 *   6）认地址（先认 glab 的输出，认不出回查一次接口；两条都不成 → 如实失败，不猜地址、不配 remote）；
 *   7）origin 已有就 `set-url`、没有就 `add`（与 GitHub 那份同一套分支）；
 *   8）`git push -u origin HEAD`；
 *   9）成功回 `{backend: 'gitlab', refId, name: refId, url}`（`name` 用 refId，与 `index.ts` 的
 *      `describe` 同一口径：GitLab 上显示名就是全路径）。
 *
 * @param handle 识别时给的那点线索（本函数只读 `cwd`；`refId` 那一格对「建新仓库」没有意义）
 * @param input 建仓输入（`name` 必填；`visibility` 省略按私有处理）
 * @param ctx 单次调用上下文（git 走 `ctx.exec`、glab 走本房唯一的出口 `glabClient`）
 */
export async function initProject(
  handle: RepoHandle,
  input: InitProjectInput,
  ctx: OpContext,
): Promise<OpResult<RepositoryRef>> {
  const cwd = (handle && typeof handle.cwd === 'string' && handle.cwd) || (ctx && ctx.cwd) || ''
  const name = input && typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return fail(ERROR_KIND.PARSE as ErrorKind, 'initProject: 仓库名不能为空', '')
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
    // 原文取调用方给的那个名字（名字里可能有换行之类，原样带出去让界面能展开看）。
    return fail(
      ERROR_KIND.PARSE as ErrorKind,
      'initProject: 仓库名只支持字母、数字、点、下划线、连字符，最长 100 个字符',
      String(input.name),
    )
  }
  const visibility = input && input.visibility === 'public' ? 'public' : 'private'
  const visFlag = visibility === 'public' ? '--public' : '--private'

  const platform = ctx && ctx.platform ? ctx.platform : null
  const execFn =
    ctx && typeof ctx.exec === 'function'
      ? ctx.exec.bind(ctx)
      : platform && typeof platform.exec === 'function'
        ? platform.exec.bind(platform)
        : null

  /** 起一条 git 命令：失败不抛，归一成三格交给调用方判（与房内 glab 那套同形）。 */
  async function git(args: string[], timeout: number): Promise<ProcResult> {
    if (!execFn) return { code: -1, stdout: '', stderr: 'exec unavailable' }
    try {
      const r = await execFn('git', args, { cwd: cwd || undefined, signal: ctx?.signal || undefined, timeout })
      return toProc(r)
    } catch (e: unknown) {
      return { code: -1, stdout: '', stderr: errText(e) }
    }
  }

  // ── 1）前置：git 与登录状态。都不动工作区 ────────────────────────────────────
  if (platform && typeof platform.resolveExecutable === 'function') {
    let gitExe: string | null = null
    try {
      gitExe = await platform.resolveExecutable('git')
    } catch {
      // 解析器自己抛了也按「找不到」处理：下一步那条命令会把真正的原因带出来。
      gitExe = null
    }
    if (!gitExe) {
      return fail(
        ERROR_KIND.ENV as ErrorKind,
        'initProject: 未找到 git（开仓发布要先在这个工作区建一个本地仓库，请先安装 https://git-scm.com/）',
        '',
      )
    }
  }

  const c = glabClient(ctx)
  const userRes = await c.run(['api', 'user'], { timeout: 8000 })
  if (userRes.code !== 0) {
    // glab 不在（127）、没登录、远端回绝，都在这里拦下；档位交 failGlab 按原文判。
    return failGlab(userRes, userRes.stderr || userRes.stdout || 'initProject: glab 没答出当前登录人', userRes, ctx)
  }
  const me = parseJsonObject(userRes.stdout)
  const login = me && typeof me['username'] === 'string' ? me['username'].trim() : ''
  if (!login) {
    return fail(
      ERROR_KIND.PARSE as ErrorKind,
      'initProject: glab 的登录人回包里没有 username，拿不到归属命名空间',
      userRes.stdout,
    )
  }

  // ── 2）本地仓库：不在仓库里才 init ───────────────────────────────────────────
  const probe = await git(['rev-parse', '--is-inside-work-tree'], 10000)
  if (probe.code !== 0) {
    const init = await git(['init'], 30000)
    if (init.code !== 0) return failGlab(init, 'initProject: git init 没做成', init, ctx)
  }

  // ── 3）提交本地现状 ──────────────────────────────────────────────────────────
  const add = await git(['add', '.'], 30000)
  if (add.code !== 0) return failGlab(add, 'initProject: git add 没做成', add, ctx)

  let commit = await git(['commit', '-m', 'initial commit', '--allow-empty'], 60000)
  if (commit.code !== 0) {
    // 机器上没配 git 身份时，git 会以「请告诉我你是谁」拒绝提交；补一次仓库级身份再重试，
    // 与 GitHub 那份同一个写法（本地身份，不写全局配置，不动用户的 git 设置）。
    const low = (commit.stderr + '\n' + commit.stdout).toLowerCase()
    if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
      await git(['config', 'user.email', 'dsh@local'], 10000)
      await git(['config', 'user.name', 'DSH User'], 10000)
      commit = await git(['commit', '-m', 'initial commit', '--allow-empty'], 60000)
    }
    if (commit.code !== 0) return failGlab(commit, 'initProject: git commit 没做成', commit, ctx)
  }

  // ── 4）建远端仓库（这一步之后远端已经有东西了）────────────────────────────────
  // 为什么带 --skipGitInit：本函数在这之前已经自己 `git init` / `add` / `commit` 过，第 6 步又自己配 origin，
  // 所以不要 glab 再碰本地仓库 —— glab 的 `repo create <名字>` 默认会问一句要不要在本地建一个项目目录，
  // 只有这个开关能把那段本地动作整个关掉（逐条依据与出处见文件头）。
  const create = await c.run(['repo', 'create', name, visFlag, '--skipGitInit'], { timeout: 60000 })
  if (create.code !== 0) {
    return failGlab(create, 'initProject: glab repo create 没建成远端仓库', create, ctx)
  }

  // ── 5）认地址：先认输出，再回查一次接口；两条都不成就停下 ──────────────────────
  const created = addressFromOutput(create.stdout) ?? (await readCreatedProject(c, `${login}/${name}`))
  if (!created) {
    return fail(
      ERROR_KIND.PARSE as ErrorKind,
      'initProject: 远端仓库已经建好，但认不出它的地址（glab 的输出里没有可用地址，回查接口也没拿到 path_with_namespace / web_url），已停下，没有配 remote',
      create.stdout,
    )
  }

  // ── 6）把 origin 指到新仓库，然后推 ─────────────────────────────────────────
  const remoteUrl = created.repoUrl.replace(/\.git$/i, '') + '.git'
  const hasOrigin = (await git(['remote', 'get-url', 'origin'], 10000)).code === 0
  // origin 已存在就改指过去（与 GitHub 那份同一套分支）：这一步的语义是「把这个工作区发布到刚建的这张仓库」，
  // 留着一条指向别处的 origin 会把提交推到另一个地方去。
  const wire = hasOrigin
    ? await git(['remote', 'set-url', 'origin', remoteUrl], 10000)
    : await git(['remote', 'add', 'origin', remoteUrl], 10000)
  if (wire.code !== 0) {
    return failGlab(
      wire,
      'initProject: 远端仓库已经建好了，但 origin 没配上（' + (hasOrigin ? 'git remote set-url' : 'git remote add') + ' 失败），本地提交还在',
      wire,
      ctx,
    )
  }

  const push = await git(['push', '-u', 'origin', 'HEAD'], 120000)
  if (push.code !== 0) {
    return failGlab(
      push,
      'initProject: 远端仓库已经建好了，但 git push 没推上去，本地提交还在，修好之后重推即可',
      push,
      ctx,
    )
  }

  return {
    ok: true,
    data: { backend: 'gitlab', refId: created.refId, name: created.refId, url: created.repoUrl },
  }
}

export default initProject
