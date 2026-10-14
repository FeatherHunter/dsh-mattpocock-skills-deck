/**
 * src/tracker/rooms/gitlab/repo.ts —— GitLab 房从工作区目录认出「这是哪个仓库」。
 *
 * ── 这一条能力为什么归本房 ──────────────────────────────────────────────────────
 * 契约把 `getRepoKey` 与 `describe`、`issueAddress` 一起归为「定位口」，并写明定位口不由注册表
 * 补桩（`src/tracker/registry/shape.ts` 第 8 行那段）：问「这个仓库叫什么」，答案要么是名字要么是空，
 * 空本身也是答案 —— 没有「我不支持」这种回答可给。GitHub 房早就交了这条（`rooms/github/repo.ts`），
 * GitLab 房一直缺着：`docs/tracker/capability-gitlab.md` 里它记的是「当前不支持、未来会开发」。
 * 本文件把它补上，于是这一房从 15 条能力变成 16 条。
 *
 * ── GitLab 与 GitHub 在这一处的真实差别 ─────────────────────────────────────────
 * GitHub 的仓库路径恒定是「用户名/仓库名」两段；**GitLab 允许分组套分组**（`group/sub/project`），
 * 两段以上的路径是常态，不是异常。契约给的形状只有 `{owner, name}` 两格，所以本房的落法是：
 * **`owner` 装全部分组（`group/sub`），`name` 装最后一段项目名**，两者拼回去正好是
 * `path_with_namespace` 的原文，一个字符不多不少。反过来若按 GitHub 那样只取前两段、
 * 把第三段丢掉，`group/sub/project` 会被认成 `group/sub` —— 指向另一个仓库，而且不报错。
 *
 * ── 三层兜底（与 GitHub 房同一套顺序，换成本地的 glab） ──────────────────────────
 *   第 1 层：问 git（`git -C <目录> remote get-url origin`），认得出就回。
 *   第 2 层：直读 `.git/config` 里 origin 的 url 行（git 命令起不来时还能活）。
 *   第 3 层：问 glab（`glab repo view --output json` 的 `path_with_namespace`）—— 兜底那一步
 *           连本地没配 remote 也能认出当前目录属于哪个项目。
 * 每层只记一行 `repo.resolve.tier`（层号、成没成、耗时），认不出来回 `null` 而不是抛异常：
 * 调用方拿空值继续往下走（契约对定位口就是这么定的）。
 */

import type { OpContext } from '../../contract/contexts.js'
import { glabClient } from './client.js'
import { emitRepoTier } from './read-log.js'

/** 认出来的仓库坐标：分组（可能多段）+ 项目名。 */
export interface RepoKey {
  owner: string
  name: string
}

/**
 * 从一段远端地址里认出 GitLab 仓库坐标。
 *
 * 认得出就回 `{owner, name}`，认不出回 `null`（**不抛异常**，也不猜）。
 *
 * 支持这几种写法（都是 git 与 glab 自己会写出来的）：
 *   - `https://gitlab.com/group/project.git`
 *   - `https://gitlab.com/group/sub/project`      ← 多段分组，落成 owner='group/sub'
 *   - `git@gitlab.com:group/project.git`
 *   - `ssh://git@gitlab.com:22/group/project.git`
 *   - `http://gitlab.internal:8080/group/project.git`  ← 自建实例也认，认的是「主机 + 路径」这个形状
 *
 * 认不出的情形（回 null，不要在这里编一个）：
 *   - 没有主机名的裸路径（`./some/dir`、`C:\\work\\proj`）——那是本地目录，不是远端仓库；
 *   - 路径只有一段（`https://gitlab.com/foo`）——GitLab 上一个项目至少要「分组/项目」两段；
 *   - 空串、非字符串、纯主机名。
 *
 * @param url 远端地址原文（多行也接受，只取第一行里像地址的那一段）
 */
export function parseGitlabRepo(url: unknown): RepoKey | null {
  if (typeof url !== 'string') return null
  const text = url.trim()
  if (!text) return null

  let host = ''
  let rest = ''

  // 形状一：带协议（https:// / http:// / ssh:// / git://）
  const withScheme = text.match(/^[a-z][a-z0-9+.-]*:\/\/([^/\s]+)\/(.+)$/i)
  // 形状二：scp 那种写法（git@host:path）——注意冒号在主机名后，不是协议
  const scpLike = text.match(/^[^\s/@]+@([^/\s:]+):(.+)$/)
  if (withScheme) {
    // 主机那一格可能带端口（gitlab.internal:8080）；端口与仓库路径无关，去掉。
    host = withScheme[1].split(':')[0]
    rest = withScheme[2]
  } else if (scpLike) {
    host = scpLike[1]
    rest = scpLike[2]
  } else {
    return null
  }

  // 主机必须像域名（带点）或者是 localhost：没有点的单个词更像是被人误传的裸路径。
  if (!host || (host.indexOf('.') < 0 && host !== 'localhost')) return null

  // 去掉查询串、锚点、结尾的 .git、两头与中间的空白；GitLab 路径本身不含空格。
  const path = rest
    .split(/[?#]/)[0]
    .replace(/\.git$/i, '')
    .trim()
  const segs = path.split('/').filter((s) => s.length > 0)
  if (segs.length < 2) return null

  const name = segs[segs.length - 1]
  const owner = segs.slice(0, -1).join('/')
  if (!owner || !name) return null
  return { owner, name }
}

/**
 * 从工作区目录认出 GitLab 仓库坐标（契约里的定位口 `getRepoKey`）。
 *
 * @param cwd 工作区目录（空串也接受：第 1、2 层会问不出来，落到第 3 层由 glab 按当前目录认）
 * @param ctx 单次调用上下文；缺 `platform` / `exec` / `fs` 都不会抛，只是少一层兜底
 * @returns 认出来就是 `{owner, name}`，认不出来是 `null`（**不是异常**，调用方拿空值继续走）
 */
export async function getRepoKey(cwd: string, ctx: OpContext): Promise<RepoKey | null> {
  const t0 = Date.now()
  const execCwd = cwd || ''
  const platform = ctx && ctx.platform ? ctx.platform : null
  const fs = (platform && platform.fs) || (ctx && ctx.fs) || null

  // 第 1 层：问 git。resolveExecutable 先确认这台机器上真有 git，免得白起一次进程。
  try {
    if (platform && typeof platform.resolveExecutable === 'function') {
      const git = await platform.resolveExecutable('git')
      const execFn = (ctx && ctx.exec) || (platform && platform.exec)
      if (git && typeof execFn === 'function') {
        try {
          const r = await execFn('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], {
            cwd: execCwd,
            timeout: 3000,
          })
          const out = String((r && (r.stdout || r.text)) || '')
          const k = parseGitlabRepo(out)
          if (k) {
            emitRepoTier(ctx, 1, true, t0)
            return k
          }
        } catch {
          // 这一层没成不是故障：目录可能不是 git 仓库，或者还没配 origin，接着走下一层。
        }
      }
    }
  } catch {
    // resolveExecutable 自己抛了也接着走下一层。
  }

  // 第 2 层：直读 .git/config。git 命令起不来（没装、被拦、超时）时，这一层还能救回来。
  if (fs && typeof fs.resolve === 'function' && typeof fs.readText === 'function') {
    try {
      const target = await fs.resolve('.git/config', { cwd: execCwd })
      const txt = String((await fs.readText(target)) || '')
      // 先只认 origin 那一段（别的 remote 的 url 不算数）；
      // origin 那一段没写 url 时，再退而认文件里第一处 url=（与 GitHub 房同一套写法）。
      const originBlock = txt.match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
      const anyUrl = txt.match(/url\s*=\s*(.+)/)
      const candidate = originBlock ? originBlock[1] : anyUrl ? anyUrl[1] : ''
      const k = parseGitlabRepo(candidate)
      if (k) {
        emitRepoTier(ctx, 2, true, t0)
        return k
      }
    } catch {
      // 读不到 .git/config 也不是故障：可能是别的工作区形状，接着走第 3 层。
    }
  }

  // 第 3 层：问 glab。这一层认的是「glab 眼里的当前项目」，所以连本地没配 remote 也能认出来。
  // 取 path_with_namespace 而不是 path：前者是全路径（含分组），正好是 owner/name 拼回去的样子。
  try {
    const res = await glabClient(ctx).run(['repo', 'view', '--output', 'json'], { cwd: execCwd || undefined })
    if (res && res.code === 0) {
      const parsed = parseJsonObject(res.stdout)
      const full = parsed && typeof parsed['path_with_namespace'] === 'string' ? parsed['path_with_namespace'] : ''
      // 拼回一个带主机的地址再走同一个解析：这样「多段分组怎么切」只有 parseGitlabRepo 一处口径。
      const k = parseGitlabRepo('https://gitlab.com/' + full)
      if (k) {
        emitRepoTier(ctx, 3, true, t0)
        return k
      }
    }
  } catch {
    // glab 不在、没登录、目录不在任何项目里 —— 都落到下面回 null。
  }

  emitRepoTier(ctx, 3, false, t0)
  return null
}

/** 把一段文本当 JSON 对象解析；不是对象（数组、字符串、解析不了）一律回 null。 */
function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  try {
    const v = JSON.parse(t)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export default { parseGitlabRepo, getRepoKey }
