/**
 * src/tracker/contract/triage-states.ts —— 五种 triage 状态标签的名字（#1832）
 *
 * 这张票回答一个问题：「一张票同一时刻最多只能有一枚 triage 状态」，这五枚状态各叫什么名字。
 * 名字只在这里写一遍：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。
 *
 * 为什么住契约层：读它的有三处，分在不同层 —— 本地 Markdown 房的状态词表（src/tracker/rooms/）、
 * deck 的建票与改标签判据（src/deck/rules/）、核心标签清单（同目录 canonical-labels.ts）。
 * 房间不许被 deck 引用，deck 的纯规则侧也不许引用房间；两边都只被允许引契约层，所以名单放这里。
 *
 * 契约层只放数据：本文件只有字符串常量，没有任何判断。「这枚标签算不算状态」「这批里出现了几枚」
 * 这类行为住在 src/deck/rules/triage-state.ts 与各后端自己的状态模块里（本目录的规矩是只许类型与
 * 数据，由 tests/verify-contract-types.ts 的第二项守着）。
 *
 * 与本地 Markdown 房配置的关系：房侧从 original-skills.yaml 的 status.triage-roles 读这五个词，
 * 读不到才回退到这里；tests/verify-md-format-config.ts 逐项比对配置与这份名单 —— 只改一处会当场判红。
 * 上游出处：随包原文 package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md 的五个 triage 角色。
 */
export const NEEDS_TRIAGE_LABEL = 'needs-triage'
export const NEEDS_INFO_LABEL = 'needs-info'
export const READY_FOR_AGENT_LABEL = 'ready-for-agent'
export const READY_FOR_HUMAN_LABEL = 'ready-for-human'
export const WONTFIX_LABEL = 'wontfix'

/** 五枚状态的全部名单，顺序固定（拒绝文案与配置比对都按这个顺序）。 */
export const TRIAGE_STATE_LABELS = [
  NEEDS_TRIAGE_LABEL,
  NEEDS_INFO_LABEL,
  READY_FOR_AGENT_LABEL,
  READY_FOR_HUMAN_LABEL,
  WONTFIX_LABEL,
] as const

/** 名单里某一枚状态的名字类型（给「只要五枚之一」的形参用）。 */
export type TriageStateLabel = (typeof TRIAGE_STATE_LABELS)[number]
