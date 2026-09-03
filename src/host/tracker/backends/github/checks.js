/**
 * backends/github/checks.js — 检查目录定义（GITHUB_CHECKS / checks）。
 *
 * 由 #440 从 index.js 纯结构移出，行为零变化。
 * 以后改检查项定义的人改它。预估约 60 行。
 */

// ============ checks() 目录：GitHub 后端 4 项（c1/c4/c5/c6 语义不变） ============
/**
 * GitHub 后端检查目录（与 check-catalog GITHUB_CATALOG 同源，供链快照/八股校验）。
 * 4 项：仓库定位(github remote 可解析) / gh CLI / gh 已登录 / API 可达
 * 每项形状：{id, label, check, origin}，与 shared/check-catalog 对齐（此处为运行时 view，轻量复用）
 */
// 2026-08-29（审查 S1）：label 与 check-catalog GITHUB_CATALOG 同步人话化——两处必须字面一致（单一口径）。
export const GITHUB_CHECKS = Object.freeze([
  {
    id: 'gh:remote',
    label: '已关联 GitHub 仓库',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoRemote', backendId: 'github' },
    origin: 'host/checkRepo→github/repo.js:parseGithubRepo (inventory 类别 8 c1)',
  },
  {
    id: 'gh:installed',
    label: 'GitHub 助手（gh cli）已安装',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'primitive', primitive: 'commandExists', command: 'gh' },
    origin: 'host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory 类别 8 c4)',
  },
  {
    id: 'gh:authed',
    label: '已登录 GitHub',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'preflight', id: 'ghAuth' },
    origin: 'host/index.js:checkGhAuth / backends/github/preflight.js:2 (c5)',
  },
  {
    id: 'gh:repoAccess',
    label: '仓库在 GitHub 上可访问',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'github' },
    origin: 'backends/github/preflight.js:3 / inventory 类别 8 c6',
  },
])

/**
 * 供编排层/门禁调用的只读 view：按需返回目录（轻量，与 catalogFor('github') 后端段一致）。
 */
export function checks() {
  return [...GITHUB_CHECKS]
}
