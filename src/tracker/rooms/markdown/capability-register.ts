/**
 * src/tracker/rooms/markdown/capability-register.ts —— 本地 Markdown 后端对 25 条能力的回答（数据）
 *
 * 三类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家与另外两家不一样的两处（都如实记在下面，别以为是漏写）────────────────
 *   1. 四条操作**明确不支持，但后端自己在实例上放了显式桩**：`getCurrentUser`、`initProject`、
 *      `getRepoPermissions`、`listSubIssues`。它们写 `stubBy: 'backend'`，所以仍然算在实例成员里
 *      （见 `MarkdownBackendMembers`）——「不支持」是分类，不是「成员不在」。
 *   2. 两条定位口（`describe`、`issueAddress`）是提供的，但**住在模块对象上**（`markdownModule`），
 *      不在工厂实例上；`getRepoKey` 则是形态不合（本地票仓没有远端 owner/name 可解析）。
 *
 * ── 与谁是一对 ──────────────────────────────────────────────────────────────────
 *   - 给人读的表：`docs/tracker/capability-markdown.md`（视图，门禁逐条比对）
 *   - 实现真源：`src/tracker/rooms/markdown/index.ts`（工厂交出来的成员由本文件推出来）
 *
 * 改法、以及「本文件只有数据、不许被运行时代码 import」这两条，同 GitHub 那份。
 */
import type { CapabilityRegister } from '../../contract/capability-answer.js'

/** 本地 Markdown 后端：20 条能力真提供（含模块对象上的两条定位口），5 条明确不支持。 */
export const MARKDOWN_CAPABILITY_REGISTER = {
  // —— 操作 22 条：18 条真实现 ——
  preflight: { kind: 'provided' },
  list: { kind: 'provided' },
  get: { kind: 'provided' },
  getDependencies: { kind: 'provided' },
  create: { kind: 'provided' },
  close: { kind: 'provided' },
  reopen: { kind: 'provided' },
  comment: { kind: 'provided' },
  update: { kind: 'provided' },
  setLabels: { kind: 'provided' },
  setAssignees: { kind: 'provided' },
  setParent: { kind: 'provided' },
  setBlockedBy: { kind: 'provided' },
  listLabels: { kind: 'provided' },
  setLabelColors: { kind: 'provided' },
  counts: { kind: 'provided' },
  listPage: { kind: 'provided' },
  ensureLabelColorsFile: { kind: 'provided' },

  // —— 操作 22 条：4 条明确不支持（后端自己在实例上补了显式桩）——
  getCurrentUser: { kind: 'unsupported', stubBy: 'backend' },
  initProject: { kind: 'unsupported', stubBy: 'backend' },
  getRepoPermissions: { kind: 'unsupported', stubBy: 'backend' },
  listSubIssues: { kind: 'unsupported', stubBy: 'backend' },

  // —— 定位口 3 条：2 条提供（在模块对象上），1 条形态不合 ——
  getRepoKey: { kind: 'unsupported', stubBy: 'registry' },
  describe: { kind: 'provided' },
  issueAddress: { kind: 'provided' },
} as const satisfies CapabilityRegister
