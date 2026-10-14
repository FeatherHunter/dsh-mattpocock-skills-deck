/**
 * src/tracker/rooms/markdown/capability-register.ts —— 本地 Markdown 后端对 25 条能力的回答（数据）
 *
 * 四类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家与另外两家不一样的三处（都如实记在下面，别以为是漏写）────────────────
 *   1. 四条操作**明确不支持，但后端自己在实例上放了显式桩**：`getCurrentUser`、`initProject`、
 *      `getRepoPermissions`、`listSubIssues`。它们写 `stubBy: 'backend'`，所以仍然算在实例成员里
 *      （见 `MarkdownBackendMembers`）——「不支持」是分类，不是「成员不在」。
 *   2. 两条定位口（`describe`、`issueAddress`）是提供的，但**住在模块对象上**（`markdownModule`），
 *      不在工厂实例上；`getRepoKey` 在实例上，答案恒为空（见下面的说明）。
 *   3. 四条操作是 `partial`（做了、但有某些输入与承诺对不上）。这一档是 #1174 加的：
 *      在此之前它们只能记成 `provided`，于是登记表替这些缺口说了「一切正常」。
 *
 * ── 与谁是一对 ──────────────────────────────────────────────────────────────────
 *   - 给人读的表：`docs/tracker/capability-markdown.md`（视图，门禁逐条比对）
 *   - 实现真源：`src/tracker/rooms/markdown/index.ts`（工厂交出来的成员由本文件推出来）
 *
 * 改法、以及「本文件只有数据、不许被运行时代码 import」这两条，同 GitHub 那份。
 */
import type { CapabilityRegister } from '../../contract/capability-answer.js'

/** 本地 Markdown 后端：25 条里 17 条真提供、4 条做了但有对不上的输入、4 条明确不支持（后端自己补桩）。
 *
 *  `getRepoKey` 为什么算「提供」而不是「不支持」：契约对定位口只有一种答案形态 —— 名字或者空，
 *  空也是答案、不是失败（见 `contract/operations.ts` 定位口那一段）。本地房的身份就是工作区目录本身，
 *  没有 owner/name 可解析，所以它诚实回 `null`。以前这一格写的是「由注册表补桩」，
 *  可注册表只按 22 条操作那个名录补桩、**根本不给定位口补桩**（见 `registry/shape.ts`），
 *  于是这个后端实例上压根没有这个方法，调用方一调就抛类型错误。现在改成真的实现一条回空的。
 *  #1174 决策 2、决策 11③。 */
export const MARKDOWN_CAPABILITY_REGISTER = {
  // —— 操作 22 条：14 条真提供（每种合法输入都对得上承诺）——
  preflight: { kind: 'provided' },
  list: { kind: 'provided' },
  create: { kind: 'provided' },
  close: { kind: 'provided' },
  reopen: { kind: 'provided' },
  comment: { kind: 'provided' },
  setLabels: { kind: 'provided' },
  setAssignees: { kind: 'provided' },
  setBlockedBy: { kind: 'provided' },
  listLabels: { kind: 'provided' },
  setLabelColors: { kind: 'provided' },
  counts: { kind: 'provided' },
  listPage: { kind: 'provided' },
  ensureLabelColorsFile: { kind: 'provided' },

  // —— 操作 22 条：4 条做了但有对不上的输入（差在哪写在 gap 里，这是给人看的账）——
  getDependencies: {
    kind: 'partial',
    gap: '一次问多个编号（opts.keys）这一条不认：契约的返回形状只装得下一个编号的依赖关系，本后端的做法是如实回「不支持」，请逐个编号调用。单个编号的读取、以及两个方向（被谁阻塞、阻塞了谁）都正常。',
    ticket: '#1174',
  },
  get: {
    kind: 'partial',
    gap: '评论分页只认「要前几条」（opts.comments.first）；「从某一条之后接着读」（opts.comments.after）不认，因为本后端不往外发评论游标，调用方拿不到可以回传的值，与其静默从头再给一遍，不如当场说清。',
    ticket: '#1174',
  },
  update: {
    kind: 'partial',
    gap: '里程碑、以及「类型」以外的自定义字段不认：本地票文件里没有放这些的地方，传了就如实回「不支持」，不再静默丢掉然后回一句成功。标题、正文、标签照常。',
    ticket: '#1174',
  },
  setParent: {
    kind: 'partial',
    gap: '认在同一个工作单元里换父；父挂在别的工作单元时不认（本地是「目录即父子」，跨目录等于要搬文件），如实回「不支持」。这条限制从本地后端做出来那天就在，不是这次新加的。',
    ticket: '#1174',
  },

  // —— 操作 22 条：4 条明确不支持（后端自己在实例上补了显式桩）——
  getCurrentUser: { kind: 'unsupported', stubBy: 'backend' },
  initProject: { kind: 'unsupported', stubBy: 'backend' },
  getRepoPermissions: { kind: 'unsupported', stubBy: 'backend' },
  listSubIssues: { kind: 'unsupported', stubBy: 'backend' },

  // —— 定位口 3 条：全部提供；其中两条在模块对象上，getRepoKey 在实例上、答案恒为空 ——
  getRepoKey: { kind: 'provided' },
  describe: { kind: 'provided' },
  issueAddress: { kind: 'provided' },
} as const satisfies CapabilityRegister
