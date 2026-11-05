/**
 * src/tracker/rooms/gitlab/room/links.ts —— 这一房交给界面与注册表的链接、地址与识别用默认站点。
 *
 * 为什么独立成文件：链接与地址的拼法不是操作，也不出网；入口只负责把模块对象拼起来。
 * 改一处地址规则时打开这一个文件就够了，不必在入口里翻。
 *
 * 公开名字（issueAddress / repoSearchAddress / issueRefPattern / links）与取值必须逐字保持原样：
 * 房外今天仍按旧路径从入口 import 这些名字，入口会把它们原样再导出；换名字或换值都是改行为。
 */

import type { RepositoryRef } from '../../../contract/entities.js'

/** GitLab 官方站点的网页端地址：只有没从远端学到主机时，链接才用它兜底。 */
export const DEFAULT_GITLAB_WEB_ORIGIN = 'https://gitlab.com'

/**
 * 拼链接时该用的网页端 origin：仓库引用上带 host 就用它，否则用服务商默认域名。
 *
 * host 来自两处（都不保证有）：
 *   1. 调用方传进来的 RepositoryRef.host（例如快照里已经补齐的身份）；
 *   2. describe 在本进程里先收到过的「这台工作区的远端在哪」——由 getRepoKey 认仓库时学住
 *      （见 repo.ts 的 learnGitlabOrigin）。
 */
function refOrigin(ref: Partial<RepositoryRef> | null | undefined): string {
  const declared = ref && typeof ref.host === 'string' ? ref.host.trim().replace(/\/+$/, '') : ''
  if (declared) return declared
  // 有些调用方只拿得到仓库地址（快照里的 repository.url），原样是 https://host/owner/name：
  // 从它身上取 origin，比一律退回服务商默认域名更接近事实。
  const url = ref && typeof ref.url === 'string' ? ref.url.trim() : ''
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/([^/\s]+)\//i)
  if (m) return m[1].toLowerCase() + '://' + m[2].replace(/^[^@]*@/, '')
  return DEFAULT_GITLAB_WEB_ORIGIN
}

// 链接三件（#1110 实现决定第 14 条 / #1135 改名 / #1141 删旧名）：名字讲的是「地址」而不是「网址」，
// 因为本地 Markdown 后端给的是票文件的绝对路径；网址口吻的旧名字已按 #1141 删净。
// 票地址只认 refId，是因为 GitLab 的票链完全由仓库标识决定，拿不到就如实给空串不猜。
export function issueAddress(ref: Partial<RepositoryRef> | null | undefined, key: string | number): string {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return refOrigin(ref) + '/' + refId + '/-/issues/' + String(key)
}

// 按名搜仓库的地址只做编码拼串，是因为全站搜索页不需要鉴权，拼不出就等调用方自己处理空串。
// 第二格是可选的仓库引用：给了且带 host（自托管）就搜那台实例，否则搜默认站点。
export function repoSearchAddress(
  name: string | null | undefined,
  ref?: Partial<RepositoryRef> | null,
): string {
  return refOrigin(ref) + '/search?search=' + encodeURIComponent(String(name || ''))
}

export const issueRefPattern = /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g

// #231：client 渲染模板数据（UI-lane 只读）。
// 这三条模板只是**最后兜底**：快照里的 repository.url 与票自己的 url（GitLab API 的 web_url）
// 才是权威地址，客户端优先用它们；模板拼不了自托管主机，所以只在两者都缺时才用。
export const links = {
  issueUrlTemplate: 'https://gitlab.com/{refId}/-/issues/{key}',
  repoUrlTemplate: 'https://gitlab.com/{refId}',
  searchUrlTemplate: 'https://gitlab.com/search?search={q}',
  linkPatternSource: 'gitlab\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/-\\/issues\\/(\\d+)',
}
