/**
 * backends/gitlab/index.js — GitLab 后端适配器（主缝实现）。
 *
 * 定版：#135（labels/milestone分流）+ #144 一页纸（数据归一8文件表 + blocking双路径 + preflight + parentKey归一 + 三底座）
 * 严格对照 contract.js 13操作集（OPERATIONS）与 shape.js；按 #113 平台抽象（ctx.platform / ctx.exec / ctx.fs）。
 * 能力诚实：未就绪op由registry Proxy补unsupported桩，此处不再自造布尔capabilities表。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue } from './issues.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { getDependencies, setBlockedBy, setParent, setAssignees } from './graph.js'

function repoId(handle) {
  if (!handle) return ''
  if (typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (typeof handle.cwd === 'string' && handle.cwd) return handle.cwd
  return ''
}

/**
 * GitLab matches：启发式 boolean（读 .git/config / glab remote / issue-tracker.md）
 * 不确定一律 false + diagnostics（ctx.log.warn）
 */
async function matches(handle, ctx) {
  try {
    if (!handle || typeof handle !== 'object') return false
    // refId 显式含 gitlab 串 → true
    if (typeof handle.refId === 'string' && /gitlab/i.test(handle.refId)) return true
    const cwd = handle.cwd
    if (!cwd || typeof cwd !== 'string') return false
    const platform = ctx && ctx.platform
    const fs = (ctx && ctx.fs) || (platform && platform.fs)
    const log = ctx && ctx.log
    if (!fs || !platform) return false
    // 1) .git/config 是否含 gitlab
    try {
      const cfgPath = platform.path.join(cwd, '.git', 'config')
      // target-shaped需先resolve path-shaped；平台层path已处理，此处直接读
      const text = await fs.readText(cfgPath)
      if (typeof text === 'string' && /gitlab/i.test(text)) return true
    } catch {}
    // 2) issue-tracker.md 是否声明 gitlab
    try {
      const trackerPath = platform.path.join(cwd, 'docs', 'agents', 'issue-tracker.md')
      const text = await fs.readText(trackerPath)
      if (typeof text === 'string' && /gitlab/i.test(text)) return true
    } catch {}
    // 3) exec git remote 兜底（best-effort，5s）
    try {
      const exec = ctx.exec
      if (exec) {
        const res = await exec('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 2000 })
        const out = (res.stdout || '') + (res.stderr || '')
        if (/gitlab/i.test(out)) return true
      }
    } catch {}
    return false
  } catch (e) {
    try { if (ctx && ctx.log && ctx.log.warn) ctx.log.warn('gitlab matches error: ' + String(e)) } catch {}
    return false
  }
}

/**
 * 创建 GitLab 后端适配器（13 ops 完整形状）。
 * @param {Object} ctx BackendContext（platform/fs/exec/timers/log）
 * @returns {import('../../contract.js').Tracker}
 */
export function createGitlabBackend(ctx) {
  const unsupported = (op) => fail(ERROR_KIND.UNSUPPORTED, `gitlab ${op} pending #145 stub`)

  return {
    id: 'gitlab',
    preflight: (handle, opCtx) => glabPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(ctx, repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(ctx, repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(ctx, repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(ctx, repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(ctx, repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(ctx, repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(ctx, repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(ctx, repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(ctx, repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(ctx, repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(ctx, repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(ctx, repo, key, blockers, opts, opCtx || ctx),
  }
}

/** BackendModule（registry可插拔） */
export const gitlabBackend = {
  id: 'gitlab',
  label: 'GitLab',
  presentation: { color: '#c25100' },
  create: createGitlabBackend,
  matches,
}

export default createGitlabBackend
