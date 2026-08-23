/**
 * backends/gitlab/index.js — GitLab 后端适配器（主缝实现）。
 *
 * ⌈ 骨架占位 ⌉ 实现归子图「定稿 GitLab 后端」（#116），用 `glab`。结构镜像 github/，
 * 但注意：GitLab 原生 blocking 仅 Premium/Ultimate，free/CE 回退 `Blocked by:` 行。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGlabError } from './errors.js'
import { glabPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue } from './issues.js'
import { listComments, addComment } from './comments.js'
import { listLabels, addLabel } from './labels.js'
import { addSubIssue, readBlockedBy } from './graph.js'

export function createGitlabBackend(ctx) {
  const unsupported = () => fail(ERROR_KIND.UNSUPPORTED, 'gitlab backend pending #116')
  return {
    id: 'gitlab',
    detect: (repo) => glabPreflight(ctx, repo),
    list: (repo, opts) => listIssues(ctx, repo, opts),
    get: (repo, key) => getIssue(ctx, repo, key),
    create: (repo, input) => createIssue(ctx, repo, input),
    comment: (repo, key, body) => addComment(ctx, repo, key, body),
    close: (repo, key) => closeIssue(ctx, repo, key),
    label: (repo, key, labels) => addLabel(ctx, repo, key, labels),
    subIssue: (repo, parentKey, childKey) => addSubIssue(ctx, repo, parentKey, childKey),
    blockedBy: (repo, childKey) => readBlockedBy(ctx, repo, childKey),
    syncSnapshot: () => unsupported(),
    preflight: (repo) => glabPreflight(ctx, repo),
    normalize: normalizeIssue,
    classifyError: classifyGlabError,
  }
}

export default createGitlabBackend
