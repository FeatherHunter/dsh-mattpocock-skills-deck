/**
 * backends/github/repo.js — 仓库身份与链接供给。
 *
 * 由 #440 从 index.js 纯结构移出（parseGithubRepo / describe / issueUrl / searchUrl /
 * linkPattern / links / capabilities / openRepository / getRepoKey），行为零变化。
 * 以后改仓库识别规则或链接形态的人改它。预估约 150 行。
 */

import { ghClient } from './client.js'

// ============ 仓库定位：parseGithubRepo（从 host 迁移，语义不变） ============
/**
 * 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null（与 host/index.js parseGithubRepo 同构）。
 * 支持 SSH (git@github.com:owner/repo.git) 与 HTTPS (https://github.com/owner/repo.git)
 */
export function parseGithubRepo(url) {
  const s = String(url || '').trim()
  const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
  if (!m) return null
  return { owner: m[1], name: m[2] }
}

// ============ RepositoryRef 供给：describe（契约成员，registry 只转发） ============
/**
 * 出 RepositoryRef：owner/name → url=github.com；handle.refId 优先，其次 cwd basename。
 * 同步纯函数（registry 期望同步），远端解析（getRepoKey）为独立 async 助手，host 按需调用。
 */
export function describe(handle, backendId) {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  const cwd = handle && typeof handle.cwd === 'string' ? String(handle.cwd) : ''
  // refId 若为 owner/name 形态，直接作为 url 源
  let refId = rawRef
  // 若 refId 为空且 cwd 形如 owner/name（极少数显式传入），也接受
  if (!refId && cwd && cwd.includes('/') && !cwd.includes('\\') && cwd.split('/').length === 2) {
    // 启发式：cwd 看起来像 owner/name（非路径），直接用
    const maybe = cwd.trim()
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(maybe)) refId = maybe
  }
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? 'https://github.com/' + refId : ''
  return { backend: backendId, refId: refId || '', name: name || refId || backendId, url }
}

// ============ URL 供给：issueUrl / searchUrl / linkPattern（契约只读 view） ============
export function issueUrl(ref, key) {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return 'https://github.com/' + refId + '/issues/' + String(key)
}

export function searchUrl(name) {
  return 'https://github.com/search?q=' + encodeURIComponent(String(name || ''))
}

export const linkPattern = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g

// ============ UI-lane 描述数据（#231 类别7核销 · 宿主沙箱外只读）：链接模板/能力位/注入文案 后端单源 ============
/** #231：client 渲染与链接识别的模板数据；null 字段=诚实缺该形态。 */
export const links = {
  issueUrlTemplate: 'https://github.com/{refId}/issues/{key}',
  repoUrlTemplate: 'https://github.com/{refId}',
  searchUrlTemplate: 'https://github.com/search?q={q}',
  linkPatternSource: 'github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/issues\\/(\\d+)',
}
/** 界面能力位（D8 末段）：仅驱动 UI 引导入口（标签补全步骤），永不被数据路径读取。 */
export const capabilities = { labelsGuide: true, repoCreateChain: true }
/** #231：开仓契约动作——url 型由 UI 以浏览器新窗打开 describe().url。 */
export const openRepository = 'url'

// ============ 仓库定位（async）：getRepoKey 迁移（原 host/index.js 三级 Tier 语义不变） ============
/**
 * 解析 cwd 对应的 GitHub owner/name（git remote → .git/config → gh repo view）。
 * 供 host snapshot / describe 异步补全使用；语义与 host 原 getRepoKey 等价。
 * @param {string} cwd
 * @param {import('../../contract.js').OpContext} ctx （含 platform/fs/exec/platform.resolveExecutable）
 * @returns {Promise<{owner:string,name:string}|null>}
 */
export async function getRepoKey(cwd, ctx) {
  const execCwd = cwd || ''
  const platform = ctx && ctx.platform ? ctx.platform : null
  const fs = platform && platform.fs ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)

  // Tier 1：git remote get-url origin + parseGithubRepo
  try {
    if (platform && typeof platform.resolveExecutable === 'function') {
      const git = await platform.resolveExecutable('git')
      if (git && ctx && typeof ctx.exec === 'function') {
        try {
          const r = await ctx.exec('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: 3000 })
          const out = (r && (r.stdout || r.text || r.stdout === '' ? (r.stdout || r.text) : '')) || ''
          const k = parseGithubRepo(String(out))
          if (k) return k
        } catch (e) {}
      } else if (git) {
        // 回退：若 ctx.exec 不可用，尝试 platform.exec
        try {
          const execFn = ctx.exec || (platform && platform.exec)
          if (typeof execFn === 'function') {
            const r2 = await execFn('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: 3000 })
            const out2 = (r2 && (r2.stdout || r2.text)) || ''
            const k2 = parseGithubRepo(String(out2))
            if (k2) return k2
          }
        } catch (e2) {}
      }
    }
  } catch (e) {}

  // Tier 2：.git/config 直读 origin
  if (fs && typeof fs.resolve === 'function' && typeof fs.readText === 'function') {
    try {
      const t = await fs.resolve('.git/config', { cwd: execCwd })
      const txt = await fs.readText(t)
      const um = String(txt || '').match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
      if (um) {
        const k = parseGithubRepo(um[1])
        if (k) return k
      }
      // 兼容行级 url=
      const um2 = String(txt || '').match(/url\s*=\s*(.+)/)
      if (um2 && !um) {
        const k2 = parseGithubRepo(um2[1])
        if (k2) return k2
      }
    } catch (e) {}
  }

  // Tier 3：gh repo view 兜底
  try {
    const c = ghClient(ctx)
    const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: execCwd })
    if (rr && rr.ok) {
      const s = (rr.data.stdout || '').trim()
      const idx = s.indexOf('/')
      if (idx > 0) return { owner: s.slice(0, idx), name: s.slice(idx+1) }
    }
  } catch (e) {}
  return null
}
