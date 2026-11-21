/**
 * src/tracker/rooms/gitea/repo/identity.ts —— Gitea 房的仓库身份学习与取回（#15）。
 *
 * 为什么要有它（一句话）：gitea 房的 describe 是同步纯函数、起不了进程、读不了文件，
 * 而自托管实例的宿主（例如 gitea.vvmath.com:8443）只写在本工作区 `.git/config` 的远端
 * 地址里——靠「认仓库那一趟顺手学，describe 同步取」这份进程内缓存把身份带回链接，
 * 与 GitLab 房（src/tracker/rooms/gitlab/repo/identity.ts 的 learnGitlabOrigin）同一套
 * 形状，键与容量也照抄那一份，两个房间互不共享缓存。
 *
 * 学到的东西每区两条：`refId`（'owner/name'）与 `origin`（网页端地址，scheme://host[:port]）。
 * 上一张同族缺陷（提交 1b33dfd8）只修了「行地址」，这张票（#15）补的是「仓库地址」：
 * describe 回不出权威地址时，宿主刷新链只能手拼 github.com，自托管仓库拿到错页面。
 *
 * 约定（不要放宽）：
 * - 只认指向 gitea/forgejo 的远端地址，判据 /gitea|forgejo/i 与本房 matches 同源；
 * - 解析是纯文本、纯函数：不碰文件系统、不起进程、不抛错，喂进来什么都不会让调用方崩；
 * - 缓存是进程内的 best-effort：没学过就如实回 null，调用方按房内既有惯例兜底，绝不猜。
 */

import { remoteUrlsOfGitConfig } from '../../../kernel/git-remote.js'

/** 单个工作区学到的一条身份：仓库坐标与网页端地址。 */
export interface GiteaLearnedIdentity {
  /** 'owner/name'，从远端地址路径最后两段解析。 */
  refId: string
  /** 网页端地址，例如 `https://gitea.example.com:8443`；不带结尾斜杠。 */
  origin: string
}

/** 学到身份的缓存容量：与 GitLab 房那份同数（200 个工作区，超出按最久未更新淘汰）。 */
const LEARNED_IDENTITY_CAPACITY = 200

const learnedByIdentityKey = new Map<string, GiteaLearnedIdentity>()

/** 把 cwd 规范成缓存键：斜杠统一、去掉结尾斜杠、小写（Windows 路径大小写不敏感）。 */
function identityCacheKey(cwd: unknown): string {
  if (typeof cwd !== 'string') return ''
  return cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 从一条远端地址里解析 Gitea 的网页端地址。
 *
 * 认三类地址形状（与本房 repoKeyFromRemoteUrl 同一口径，其余一律回空串）：
 *   · https(s)://host/owner/name(.git) —— host 原样（含端口）；
 *   · git@host:owner/name(.git)（scp 写法）—— 网页端按 https://host 补 scheme；
 *   · ssh://git@host/owner/name(.git) —— 同上。
 * 不是 gitea/forgejo 地址（判据 /gitea|forgejo/i）时回空串——学错比不学更糟。
 */
export function parseGiteaOrigin(url: unknown): string {
  if (typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed || !/gitea|forgejo/i.test(trimmed)) return ''
  const schemeMatch = /^https?:\/\/([^/?#]+)/i.exec(trimmed)
  if (schemeMatch) return schemeMatch[1] ? 'https://' + schemeMatch[1] : ''
  // ssh://git@host/owner/name
  const sshMatch = /^ssh:\/\/(?:[^@/]+@)?([^/:?#]+)(?::\d+)?\//i.exec(trimmed)
  if (sshMatch) return sshMatch[1] ? 'https://' + sshMatch[1] : ''
  // git@host[:port]:owner/name（scp 写法；带端口的那种 host:port:path 形状也接住）
  const scpMatch = /^(?:[^@/\s]+@)([^:\s]+?)(?::(\d+))?:/i.exec(trimmed)
  if (scpMatch) return scpMatch[1] ? 'https://' + scpMatch[1] + (scpMatch[2] ? ':' + scpMatch[2] : '') : ''
  return ''
}

/** 从一条远端地址解析 'owner/name'；解析不出回空串。index.ts 的 repoKeyFromRemoteUrl 委托到这里，解析规则只留这一份。 */
export function refIdOfRemoteUrl(url: unknown): string {
  if (typeof url !== 'string') return ''
  const withoutSuffix = url.trim().replace(/\.git$/i, '')
  // 三类形状先统一成「host[/port]/owner/name」再取路径最后两段：scheme 整段剥掉，scp 的 user@host[:port]: 前缀整段剥掉。
  const withoutScheme = withoutSuffix
    .replace(/^https?:\/\/[^/?#]+\//i, '')
    .replace(/^ssh:\/\/(?:[^@/]+@)?[^/?#]+\//i, '')
    .replace(/^(?:[^@/\s]+@)(?:[^:\s]+?)(?::\d+)?:/, '')
  const segments = withoutScheme.split('/').filter(Boolean)
  if (segments.length < 2) return ''
  const name = segments[segments.length - 1]
  const owner = segments[segments.length - 2]
  if (!owner || !name || owner.includes('@') || owner.includes(':')) return ''
  return owner + '/' + name
}

/**
 * 记下「这个工作区的远端指向哪台 Gitea、仓库叫什么」。
 *
 * 由 matches（读 `.git/config` 那一趟，远端地址就在手里）与 getRepoKey（exec 兜底那一趟）
 * 在认仓库成功时调用；describe 只读同步、起不了进程，靠这份进程内缓存把身份带回链接。
 * 同一个工作区重复学以最后一次为准；url 里解析不出的那一条（refId 或 origin 空）不覆盖旧值。
 *
 * @param cwd 工作区目录
 * @param url 一条远端地址（认不出 gitea 身份时什么也不记）
 */
export function learnGiteaIdentity(cwd: unknown, url: unknown): void {
  if (typeof url !== 'string') return
  const urls = remoteUrlsOfGitConfig(url)
  // 调用方给的是单条地址时 remoteUrlsOfGitConfig 认不出段头，原样用；给了 .git/config 全文也接得住。
  const candidates = urls.length > 0 ? urls : [url]
  for (const candidate of candidates) {
    const origin = parseGiteaOrigin(candidate)
    const refId = refIdOfRemoteUrl(candidate)
    const key = identityCacheKey(cwd)
    if (!key || !origin || !refId) continue
    if (learnedByIdentityKey.has(key)) learnedByIdentityKey.delete(key)
    learnedByIdentityKey.set(key, { refId: refId, origin: origin })
    while (learnedByIdentityKey.size > LEARNED_IDENTITY_CAPACITY) {
      const oldest = learnedByIdentityKey.keys().next()
      if (oldest.done) break
      learnedByIdentityKey.delete(oldest.value)
    }
  }
}

/**
 * 取这个工作区学到的 Gitea 身份；没学过回 null（调用方按房内既有惯例兜底）。
 *
 * @param cwd 工作区目录
 */
export function giteaIdentityOf(cwd: unknown): GiteaLearnedIdentity | null {
  const key = identityCacheKey(cwd)
  if (!key) return null
  return learnedByIdentityKey.get(key) || null
}
