/**
 * backends/github/preflight.js — 探测/登录/API 可达（三项门禁，只判环境，不预判能力）。
 *
 * 定版依据：#138 §1.5 + contract.js preflight 签名 + #129 平台三底座
 * - 签名：(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>
 *   handle: {cwd?, refId?}；ctx: BackendContext（含 platform/exec/timers/fs/log）+ cwd/signal/refId
 * - 三项检查顺序：1) gh 可执行 → env；2) 登录态 → auth；3) 仓库可达 → not-found/auth/network/rate-limit
 * - 不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）
 * - 错误归一全经 classifyGhError
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'

// #195 修复：后端提供完整引导 prompt（多态），UI 直接 inject，不持有后端文案
// 文案由后端决定，UI 仅透传；此处为 GitHub 后端专属
const GH_INSTALL_PROMPT = '请为 DSH 安装 GitHub CLI（gh）—— 面板所有数据依赖 gh（issue / PR / label / 探测链 / 契约后端）：\\n\\n1. 先检查：终端执行 `gh --version`；有版本号输出 → 直接汇报已装版本并结束，不要重复安装；\\n2. 无 gh 则按 OS 安装（DSH 探测按 PATH + PATHEXT 找 gh.exe / gh）：\\n   - Windows（PowerShell / pwsh）→ `winget install --id GitHub.cli` 或 `winget install --id GitHub.GitHubDesktop` 后勾选 GitHub CLI；或从 https://cli.github.com/ 下载 GitHubCLI.msi 安装，安装时勾选 PATH 选项；\\n   - macOS → `brew install gh`；或 `brew install --cask github-cli`；无 brew 则 https://cli.github.com/ 下载 .pkg；\\n   - Linux（Debian/Ubuntu）→ `sudo apt install gh` 或官方源 https://github.com/cli/cli/blob/trunk/docs/install_linux.md；\\n   - Linux（Fedora）→ `sudo dnf install gh`；\\n3. 安装后验证：重开终端使 PATH 生效，`gh --version` 输出版本号；\\n4. 若 gh 已装但 DSH 仍报未安装：用户需在 DSH 中点环境检查的「重测」按钮（force 重探），或重启 DSH Desktop 让 ghPath 缓存失效；\\n5. 完成后汇报：gh 版本号 + DSH 环境检查中「gh CLI 可用」项已变绿（如已登录 gh auth login，则「gh 已登录」也变绿）。'

function parseRepoRef(handle, ctx) {
  // 优先 handle.refId，其次 ctx.refId，再尝试从 cwd 的 git remote 解析（简化：若 refId 无则用 gh repo view）
  if (handle && typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (ctx && typeof ctx.refId === 'string' && ctx.refId) return ctx.refId
  return null
}

function repoFromRefId(refId) {
  if (!refId || typeof refId !== 'string') return null
  const idx = refId.indexOf('/')
  if (idx <= 0) return null
  return { owner: refId.slice(0, idx), name: refId.slice(idx + 1) }
}

/**
 * @param {import('../../contract.js').RepoHandle} handle
 * @param {import('../../contract.js').OpContext} ctx
 * @returns {Promise<import('../../contract.js').PreflightResult>}
 */
export async function ghPreflight(handle, ctx) {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || undefined
  const opCtx = Object.assign({}, ctx || {}, cwd ? { cwd } : {})

  // 1) gh 可执行
  try {
    const platform = opCtx.platform
    if (!platform || typeof platform.resolveExecutable !== 'function') {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable unavailable' }, prompt: GH_INSTALL_PROMPT }
    }
    const ghPath = await platform.resolveExecutable('gh')
    if (!ghPath) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)' }, prompt: GH_INSTALL_PROMPT }
    }
  } catch (e) {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: String((e && e.message) || e).slice(0, 400) }, prompt: GH_INSTALL_PROMPT }
  }

  // 2) 登录态：gh auth status
  try {
    const c = ghClient(opCtx)
    const r = await c.execGh(['auth', 'status'], { cwd })
    if (!r.ok) {
      const kind = r.error && r.error.kind ? r.error.kind : classifyGhError(r.error)
      // auth status 非 0 → auth（若 classify 为 env 则仍按 env，不强行 auth）
      if (kind === ERROR_KIND.ENV) return { ok: false, error: r.error }
      // gh auth status 的 stderr 含 not logged in 文案时 classifyGhError 已归 auth
      if (kind === ERROR_KIND.AUTH) return { ok: false, error: r.error }
      // 其他错误按分类返回
      return { ok: false, error: r.error }
    }
  } catch (e) {
    const kind = classifyGhError(e)
    if (kind === ERROR_KIND.AUTH) return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
    return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
  }

  // 3) 仓库可达（含权限）：gh api repos/{owner}/{name}
  try {
    let refId = parseRepoRef(handle, opCtx)
    // 若无 refId，尝试 gh repo view 取当前仓库（与 host/index.js getRepoKey 同源）
    if (!refId) {
      const c = ghClient(opCtx)
      const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd })
      if (rr.ok) {
        const s = (rr.data.stdout || '').trim()
        if (s && s.includes('/')) refId = s
      }
    }
    if (!refId) {
      // 无仓库上下文→ 视为 not-found（无法判定仓库可达）
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)' } }
    }
    const repo = repoFromRefId(refId)
    if (!repo) return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: `repo refId malformed: ${refId}` } }
    const c = ghClient(opCtx)
    const r = await c.execGh(['api', `repos/${repo.owner}/${repo.name}`], { cwd })
    if (!r.ok) {
      // 分类已在 client 层归一，此处直接返回
      return { ok: false, error: r.error }
    }
    return { ok: true }
  } catch (e) {
    const kind = classifyGhError(e)
    return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
  }
}

export default ghPreflight
