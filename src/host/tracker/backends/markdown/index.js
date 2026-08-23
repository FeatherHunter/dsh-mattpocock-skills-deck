/**
 * backends/markdown/index.js — 本地 Markdown 后端适配器（主缝实现）。
 *
 * ⌈ 骨架占位 ⌉ 实现归子图「定稿本地 Markdown 后端」（#115）。严格按 mattpocock 的
 * `.scratch/<feature-slug>/` 规则读写**同一文件集**（spec.md / map.md / issues/<NN>-<slug>.md），
 * 不造第二套格式（见设计契约 §5）。无 labels（用 Status/Type 行内字段表达语义）。
 * 访问 OS 只经 platform（#113）。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { mdPath } from './path.js'
import { parseMd } from './parse.js'
import { readFile } from './read.js'
import { writeFile } from './write.js'
import { normalizeIssue } from './normalize.js'
import { listIssues, getIssue, createIssue, closeIssue } from './issues.js'
import { listComments, addComment } from './comments.js'
import { readBlockedBy } from './graph.js'

const EMPTY_CAPS = Object.freeze({ labels: false, subIssue: false, depGraph: false, comments: false, closedState: false, liveUpdates: false, remoteSharing: false })

export function createMarkdownBackend(ctx) {
  const unsupported = () => ({ ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: 'markdown op pending #115' } })
  return {
    id: 'markdown',
    detect: async (repo) => {
      try {
        await readFile(ctx, mdPath(repo, 'map'))
        // 契约 §5：本地格式支持 subIssue(目录层级)/depGraph(Blocked by)/comments(## Comments)/closedState(Status 草案)
        return { backend: 'markdown', ok: true, capabilities: { labels: false, subIssue: true, depGraph: true, comments: true, closedState: true, liveUpdates: false, remoteSharing: false }, detail: '' }
      } catch (e) {
        return { backend: 'markdown', ok: false, capabilities: EMPTY_CAPS, detail: 'no .scratch/map.md' }
      }
    },
    list: (repo, opts) => listIssues(ctx, repo, opts),
    get: (repo, key) => getIssue(ctx, repo, key),
    create: (repo, input) => createIssue(ctx, repo, input),
    comment: (repo, key, body) => addComment(ctx, repo, key, body),
    close: (repo, key) => closeIssue(ctx, repo, key),
    label: () => unsupported(),
    subIssue: () => unsupported(),
    blockedBy: (repo, childKey) => readBlockedBy(ctx, repo, childKey),
    syncSnapshot: () => unsupported(),
    preflight: async (repo) => {
      try { await readFile(ctx, mdPath(repo, 'map')); return { ok: true } }
      catch (e) { return { ok: false } }
    },
    normalize: normalizeIssue,
    parse: parseMd,
  }
}

export default createMarkdownBackend
