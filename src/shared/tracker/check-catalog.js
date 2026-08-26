/**
 * tracker/check-catalog.js — 通用检查目录与后端检查目录边界（#217 定版，2026-08-27 修订 #219/#245 删 na）。
 *
 * 第一性原理：
 *  - 通用 = 真值不随 backendId 改变（所有后端都要问，恒脱离后端可检测）；后端 = 真值随 backendId 改变（仅该后端需要，物理隔离）。
 *  - 判据形式化：若把 backendId 从 'github' 切到 'markdown' / 'gitlab'，该检查的期望结果不变 → 通用；否则 → 后端。
 *  - 2026-08-27 起删 na：通用恒适用，无不适用场景；后端按物理隔离，行不存在而非标 na。
 *  - 本文件为目录边界的唯一真源，供编排链票（开门链 / 前置环境检测链）直接消费；后续新增检查必须先在此分类。
 *
 * 依据：.scratch/research/ui-hardcode-inventory-20260826.md 类别 8（host 检查链 14 项必迁）+ #198 五票结论 + #219 定版。
 */

import { PRIMITIVE_KIND } from './chain.js'

/**
 * 目录项形态（目录只描述，不执行；执行由 predicateRegistry + 后端 preflight 完成）。
 * @typedef {Object} CatalogItem
 * @property {string} id チェック唯一 id（与 chain CheckItem.id 对齐）
 * @property {string} label 人读标签
 * @property {'generic'|'backend'} scope 通用或后端
 * @property {string[]} backends 适用后端（generic 为 ['github','markdown','gitlab']，backend 为子集）
 * @property {import('./chain.js').Check} check 谓词描述（primitive/backend/preflight）
 * @property {string} origin 盘点来源（文件:行号或 inventory 类别）
 */

/** 通用检查目录（与后端无关，所有后端都要问，恒适用，无 na）。 */
export const GENERIC_CATALOG = Object.freeze([
  {
    id: 'skill:wayfinder',
    label: '技能 wayfinder 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'wayfinder' },
    origin: 'host/index.js:SKILL_PROBE_NAMES (inventory 类别 8)',
  },
  {
    id: 'skill:setup-mattpocock-skills',
    label: '技能 setup-mattpocock-skills 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'setup-mattpocock-skills' },
    origin: 'host/index.js:SKILL_PROBE_NAMES',
  },
  {
    id: 'skill:ask-matt',
    label: '技能 ask-matt 已安装',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.SKILL_PROBE, skill: 'ask-matt' },
    origin: 'host/index.js:SKILL_PROBE_NAMES',
  },
  {
    id: 'env:home',
    label: '用户主目录可解析',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.ENV, key: 'HOME' },
    origin: 'platform/getHome (inventory 类别 8)',
  },
  {
    id: 'tracker:initialized',
    label: '工作区已初始化（docs/agents/issue-tracker.md 存在）',
    scope: 'generic',
    backends: ['github','markdown','gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: 'docs/agents/issue-tracker.md' },
    origin: 'host/checkTracker (inventory 类别 8)',
  },
])

/** GitHub 后端检查目录（仅 github 适用，物理隔离，其他后端该行不存在）。 */
export const GITHUB_CATALOG = Object.freeze([
  {
    id: 'gh:installed',
    label: 'GitHub CLI (gh) 已安装',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.COMMAND_EXISTS, command: 'gh' },
    origin: 'host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory 类别 8)',
  },
  {
    id: 'gh:authed',
    label: 'gh 已登录（gh auth status）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'preflight', id: 'ghAuth' },
    origin: 'host/index.js:checkGhAuth / backends/github/preflight.js:2',
  },
  {
    id: 'gh:repoAccess',
    label: '仓库可达（gh api repos/{owner}/{name}）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'github' },
    origin: 'backends/github/preflight.js:3 / inventory 类别 8',
  },
  {
    id: 'gh:labels',
    label: '标签已齐（10 核心标签）',
    scope: 'backend',
    backends: ['github'],
    check: { kind: 'backend', id: 'labels', backendId: 'github' },
    origin: 'host/checkLabels / inventory 类别 4/6',
  },
])

/** GitLab 后端检查目录（仅 gitlab 适用）。 */
export const GITLAB_CATALOG = Object.freeze([
  {
    id: 'glab:installed',
    label: 'GitLab CLI (glab) 已安装',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.COMMAND_EXISTS, command: 'glab' },
    origin: 'backends/gitlab/preflight.js:1 (inventory 类别 8 推导)',
  },
  {
    id: 'glab:authed',
    label: 'glab 已登录',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'preflight', id: 'glabAuth' },
    origin: 'backends/gitlab/preflight.js:2',
  },
  {
    id: 'glab:repoAccess',
    label: 'GitLab 仓库可达',
    scope: 'backend',
    backends: ['gitlab'],
    check: { kind: 'backend', id: 'repoAccess', backendId: 'gitlab' },
    origin: 'backends/gitlab/preflight.js:3',
  },
])

/** Markdown 后端检查目录（仅 markdown 适用）。 */
export const MARKDOWN_CATALOG = Object.freeze([
  {
    id: 'md:scratchWritable',
    label: '.scratch 目录可写',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: '.scratch' },
    origin: 'backends/markdown/preflight.js / inventory 类别 8',
  },
  {
    id: 'md:parseOk',
    label: '本地图谱可解析',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'parseOk', backendId: 'markdown' },
    origin: 'backends/markdown/parse.js',
  },
])

/** 全量目录（按 scope 分组，供编排链票直接合并）。 */
export const ALL_CATALOGS = Object.freeze({
  generic: GENERIC_CATALOG,
  github: GITHUB_CATALOG,
  gitlab: GITLAB_CATALOG,
  markdown: MARKDOWN_CATALOG,
})

/**
 * 判定某检查项是否通用（形式化判据）。
 * @param {string} checkId
 * @returns {'generic'|'backend'|null}
 */
export function scopeOf(checkId) {
  if (GENERIC_CATALOG.some(c => c.id === checkId)) return 'generic'
  if (GITHUB_CATALOG.some(c => c.id === checkId) || GITLAB_CATALOG.some(c => c.id === checkId) || MARKDOWN_CATALOG.some(c => c.id === checkId)) return 'backend'
  return null
}

/**
 * 按 backendId 过滤出适用目录（通用 + 该后端），2026-08-27 起无 na，行不存在而非标 na。
 * @param {'github'|'markdown'|'gitlab'|null} backendId
 * @returns {CatalogItem[]}
 */
export function catalogFor(backendId) {
  const base = [...GENERIC_CATALOG]
  if (backendId === 'github') base.push(...GITHUB_CATALOG)
  else if (backendId === 'gitlab') base.push(...GITLAB_CATALOG)
  else if (backendId === 'markdown') base.push(...MARKDOWN_CATALOG)
  return base
}

/**
 * 14 项必迁映射（inventory 类别 8 → 本目录 id），供下游 227-231 直接消费。
 */
export const MIGRATION_MAP = Object.freeze({
  'skill:wayfinder': 'GENERIC_CATALOG[0]',
  'skill:setup-mattpocock-skills': 'GENERIC_CATALOG[1]',
  'skill:ask-matt': 'GENERIC_CATALOG[2]',
  'env:home': 'GENERIC_CATALOG[3]',
  'tracker:initialized': 'GENERIC_CATALOG[4]',
  'gh:installed': 'GITHUB_CATALOG[0]',
  'gh:authed': 'GITHUB_CATALOG[1]',
  'gh:repoAccess': 'GITHUB_CATALOG[2]',
  'gh:labels': 'GITHUB_CATALOG[3]',
  'glab:installed': 'GITLAB_CATALOG[0]',
  'glab:authed': 'GITLAB_CATALOG[1]',
  'glab:repoAccess': 'GITLAB_CATALOG[2]',
  'md:scratchWritable': 'MARKDOWN_CATALOG[0]',
  'md:parseOk': 'MARKDOWN_CATALOG[1]',
})

export const CATALOG_VERSION = 1