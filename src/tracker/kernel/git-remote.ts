/**
 * src/tracker/kernel/git-remote.ts —— 从 `.git/config` 文本里读出远端地址的那一小段解析（#1533）。
 *
 * 为什么要有它：GitHub 与 GitLab 两个后端都要回答「这个工作区是不是我这家的」，
 * 而正确的依据只有一样东西——git 记下的远端地址（remote url）。旧写法是在整份
 * `.git/config` 文本里找 `github.com` / `gitlab` 字样，于是分支名恰好带这两个词时
 * （真机事故里是 `[branch "ticket/1187-gitlab-chain-predicates"]` 这一段）两个后端会
 * 同时认领同一个仓库，注册表判 multi-match，读会话直接失败，登录状态一直停在
 * 「暂时确认不了」（#1533）。
 *
 * 约定（不要放宽）：只认 `[remote "<名字>"]` 段里的 `url = ...` 行；`[branch ...]`、
 * `[core]`、`[url ...]` 等其它段一律不看。远端名字不限，`origin` 只是最常见的一个。
 * 解析是纯文本、纯函数：不碰文件系统、不抛错，喂进来什么都不会让调用方崩。
 */

/** 一段 git config 段头的内文，例如 `remote "origin"` 或旧的 `remote.origin`。 */
const SECTION_HEAD = /^\[([^\]]*)\]/

/** 这个段头是不是 `[remote ...]` 段（两种写法都认：`remote "名字"` 与 `remote.名字`）。 */
function isRemoteSection(inner: string): boolean {
  return /^remote(?:\s+"[^"]*"|\.[^\s"]+)?$/i.test(inner.trim())
}

/**
 * 读出 `.git/config` 文本里所有远端地址。
 *
 * @param text `.git/config` 的全文；null、空串或不是字符串时回空数组
 * @returns 每遇到一个 `[remote ...]` 段里的 `url = ...` 就收一条，顺序与文件里一致
 */
export function remoteUrlsOfGitConfig(text: unknown): string[] {
  if (typeof text !== 'string' || text === '') return []
  const urls: string[] = []
  let inRemote = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const head = SECTION_HEAD.exec(line)
    if (head) {
      inRemote = isRemoteSection(head[1])
      continue
    }
    if (!inRemote) continue
    const url = /^url\s*=\s*(.+)$/i.exec(line)
    if (url) urls.push(url[1].trim())
  }
  return urls
}
