/**
 * backends/gitlab/preflight.js — 探测/登录/API 可达。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：glab auth status / API reachable。注意 free/CE 原生 blocking 缺失需回退。
 */

import { BACKEND_KIND } from '../../../../shared/tracker/constants.js'

export async function glabPreflight(ctx, repo) {
  void ctx; void repo
  return {
    backend: BACKEND_KIND.GITLAB,
    ok: false,
    capabilities: { labels: false, subIssue: false, depGraph: false, comments: false, closedState: false, liveUpdates: false, remoteSharing: false },
    detail: 'gitlab preflight pending #116',
  }
}
export default glabPreflight
