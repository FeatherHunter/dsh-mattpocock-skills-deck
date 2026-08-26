/**
 * backends/github/index.js — GitHub 后端适配器（主缝实现，契约对齐）。
 *
 * 定版：#133（labels 对齐）+#138（13 ops 形状归一 + 错误分类）+#129（平台三底座）
 * 对照 contract.js 13 操作集（OPERATIONS）与 shape.js，不手拼 OS 路径，所有 OS 交互经 ctx.platform。
 * 本文件按 13 op 形状装配；不再自造布尔能力表/ detect；matches 为 registry 身份（boolean），不属 OpName。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { ghClient } from './client.js'
import { ghPreflight } from './preflight.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setAssignees } from './issues.js'
import { addComment } from './comments.js'
import { setLabels } from './labels.js'
import { setParent, getDependencies, setBlockedBy } from './graph.js'

/**
 * Registry 身份：matches(handle, ctx) → boolean
 * 启发式：handle.refId 含 '/' → 视为 github（显式绑定）；否则检查 cwd 下 .git/config 是否含 github.com
 * 不抛错；不确定一律 false + diagnostics 由 registry 调用方日志（此处只返回 boolean）
 */
export async function githubMatches(handle, ctx) {
  try {
    if (handle && typeof handle.refId === 'string' && handle.refId.includes('/')) {
      // 若 refId 已显式为 owner/name，视为命中（由 host 显式绑定或 registry describe 产生）
      // 进一步可校验 fs 上是否有 .scratch/map.md，但 GitHub 真实归属以 remote 为准，此处宽松命中
      return true
    }
    // 尝试读 .git/config（经 platform.fs）
    const platform = ctx && ctx.platform ? ctx.platform : null
    const fs = platform && platform.fs ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)
    const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
    if (fs && cwd && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
      try {
        const t = await fs.resolve('.git/config', { cwd })
        const txt = await fs.readText(t)
        if (typeof txt === 'string' && /github\.com/i.test(txt)) return true
      } catch {}
    }
    // 回落：尝试 git remote get-url origin（经 ctx.exec）
    if (ctx && typeof ctx.exec === 'function' && cwd) {
      try {
        const r = await ctx.exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { cwd, timeout: 3000 })
        const out = (r && (r.stdout || r.text)) || ''
        if (/github\.com/i.test(String(out))) return true
      } catch {}
    }
    return false
  } catch {
    return false
  }
}

/**
 * 创建 GitHub 后端适配器（Tracker）。
 * @param {import('../../contract.js').BackendContext} ctx DSH host ctx（platform 已解析实例注入，#113）
 * @returns {import('../../contract.js').Tracker}
 */
export function createGithubBackend(ctx) {
  // 可选：预解析 ghPath 无副作用，此处不做
  void ghClient(ctx)
  return {
    id: 'github',
    preflight: (handle, opCtx) => ghPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(repo, key, blockers, opts, opCtx || ctx),
    getCurrentUser: async (repo, opCtx) => {
      const c = ghClient(opCtx || ctx)
      const r = await c.execGh(['api', 'user', '--jq', '{login: .login, name: .name, avatarUrl: .avatar_url}'], { cwd: (opCtx && opCtx.cwd) || (ctx && ctx.cwd) })
      if (!r.ok) {
        const kind = (r.error && r.error.kind) || 'unsupported'
        // 未登录或无权限 → 返回 unsupported，UI 将不做“本人不显”过滤（全显）
        if (kind === 'auth' || kind === 'unsupported') return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: r.error && r.error.message || 'viewer unsupported' } }
        return { ok: false, error: r.error }
      }
      try {
        const j = JSON.parse(r.data.stdout || r.data.text || '{}')
        const login = String(j.login || '').trim()
        if (!login) return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: 'viewer login empty' } }
        const actor = { login }
        if (j.name) actor.name = String(j.name)
        if (j.avatarUrl) actor.avatarUrl = String(j.avatarUrl)
        else if (j.avatar_url) actor.avatarUrl = String(j.avatar_url)
        actor.kind = 'user'
        return { ok: true, data: actor }
      } catch (e) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: String(e.message || e) } }
      }
    },
  }
}

/**
 * BackendModule（供 registry.register 用）。
 * - id/label/create/matches 四件套；select/describe 由 registry 托管，不属 OpName
 */
export const githubModule = {
  id: 'github',
  label: 'GitHub',
  // #191：品牌色完整色板（B 方案定版 · #177）——后端是配色单一真源，UI 仅消费
  presentation: {
    color: '#0969da',
    darkColor: '#58a6ff',
    bg: 'light-dark(#ddf4ff, rgba(56,139,253,.15))',
    border: 'light-dark(rgba(84,174,255,.4), rgba(56,139,253,.4))',
  },
  create: createGithubBackend,
  matches: githubMatches,
}

export default createGithubBackend
