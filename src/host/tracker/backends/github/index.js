/**
 * backends/github/index.js — GitHub 后端适配器（主缝实现）。
 *
 * ⌈ 骨架占位 ⌉ 本后端实现归子图「定稿 GitHub 后端」（#114）严格对照 contract.js 填写。
 * 本文件把下列各操作域文件组装成一个符合 `Tracker` 接口的对象。
 * 未实现前各 op 抛 `kind:'unsupported'`（见 preflight.fail）。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

import { ghClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGhError } from './errors.js'
import { ghPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue } from './issues.js'
import { listComments, addComment } from './comments.js'
import { listLabels, addLabel } from './labels.js'
import { addSubIssue, readBlockedBy } from './graph.js'

/**
 * 创建 GitHub 后端适配器。
 * @param {Object} ctx DSH host ctx（subprocess/timer/fs…）；#114 用其取平台层与 gh 客户端
 * @returns {import('../../contract.js').Tracker}
 */
export function createGithubBackend(ctx) {
  const c = ghClient(ctx) // #114：拿到 gh 封装（含 resolve/超时/terminate）
  void c
  const unsupported = () => fail(ERROR_KIND.UNSUPPORTED, 'github backend pending #114')
  return {
    id: 'github',
    detect: (repo) => ghPreflight(ctx, repo),
    list: (repo, opts) => listIssues(ctx, repo, opts),
    get: (repo, key) => getIssue(ctx, repo, key),
    create: (repo, input) => createIssue(ctx, repo, input),
    comment: (repo, key, body) => addComment(ctx, repo, key, body),
    close: (repo, key) => closeIssue(ctx, repo, key),
    label: (repo, key, labels) => addLabel(ctx, repo, key, labels),
    subIssue: (repo, parentKey, childKey) => addSubIssue(ctx, repo, parentKey, childKey),
    blockedBy: (repo, childKey) => readBlockedBy(ctx, repo, childKey),
    syncSnapshot: () => unsupported(), // #114：一次拿 map 树 + 各票详情
    preflight: (repo) => ghPreflight(ctx, repo),
    normalize: normalizeIssue, // 供契约测试/其它后端参考
    classifyError: classifyGhError, // 错误从 gh 归类到 ERROR_KIND
  }
}

export default createGithubBackend
