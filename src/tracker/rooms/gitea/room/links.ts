/**
 * src/tracker/rooms/gitea/room/links.ts — Gitea 房的地址与链接（#2 起步骨架）。
 *
 * 起步只交三件：默认网页域名、票的地址（issueAddress）、按名搜仓库的地址（repoSearchAddress）。
 * GitLab 房那三件链接（票地址 / 认票写法 / 搜仓库）同位对应，接手的人对照着补即可。
 */

import type { RepositoryRef } from '../../../contract/entities.js'

/** Gitea 官方站的网页地址；自托管实例由 describe 带出来的 host 覆盖它。 */
export const DEFAULT_GITEA_WEB_ORIGIN = 'https://gitea.com'

/**
 * 一张票的网页地址：`<host>/<owner>/<repo>/issues/<编号>`。
 *
 * ref 没带 host 时退回官方站；refId 缺失时给空串（调用方按「没有地址」处理，不猜）。
 */
export function issueAddress(ref: Partial<RepositoryRef> | null | undefined, key: string | number): string {
  if (!ref) return ''
  const refId = typeof ref.refId === 'string' ? ref.refId.trim() : ''
  if (!refId || !refId.includes('/')) return ''
  const host = typeof ref.host === 'string' && ref.host.trim() !== '' ? ref.host.trim().replace(/\/+$/, '') : DEFAULT_GITEA_WEB_ORIGIN
  return `${host}/${refId}/issues/${String(key)}`
}

/**
 * 按名搜仓库的地址：网页搜索页的查询串写法。
 */
export function repoSearchAddress(query: string): string {
  return `${DEFAULT_GITEA_WEB_ORIGIN}/explore/repos?q=${encodeURIComponent(query || '')}`
}
