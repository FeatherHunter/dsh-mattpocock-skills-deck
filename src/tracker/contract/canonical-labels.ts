/**
 * src/tracker/contract/canonical-labels.ts — 核心标签的唯一真源（#188 起，2026-10-21 口径升级）
 * 契约：CANONICAL_LABELS[10] 的名字、颜色、描述就是唯一清单；tests/verify-labels-sync.ts 逐字比对这三样
 * 来源：gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/labels 19 条中 10 核心（2026-08-26 实测）
 * 用途：client 的标签步骤与 PROMPTS.ensureLabels 都从这里派生；宿主不自动 gh label create，纯 UI 人机协作
 */
import { NEEDS_INFO_LABEL, NEEDS_TRIAGE_LABEL, READY_FOR_AGENT_LABEL, READY_FOR_HUMAN_LABEL } from './triage-states.js'

// 四枚 triage 状态的名字不在这里再写一遍：名单的唯一名册是同目录的 triage-states.ts，
// 这里只引用常量拼进核心清单（契约目录内部数据互引是允许的，见 tests/verify-contract-types.ts 第二项）。
// wontfix 不在核心十枚里：它不是面板要预建的标签，仓库里有没有由各仓库自己决定。
export const CANONICAL_LABELS = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: NEEDS_TRIAGE_LABEL, color: 'fbca04', description: 'Maintainer needs to evaluate this issue (unexamined, awaiting diagnosis)' },
  { name: NEEDS_INFO_LABEL, color: '5319e7', description: 'Waiting on reporter for more information' },
  { name: READY_FOR_AGENT_LABEL, color: '0e8a16', description: 'Fully specified, ready for an AFK agent to implement' },
  { name: READY_FOR_HUMAN_LABEL, color: 'b60205', description: 'Requires human implementation' },
  { name: 'wayfinder:grilling', color: '9D7CD8', description: "Open decision/discussion ticket (wayfinder grilling type) — drives the deck's discuss action" },
  { name: 'wayfinder:map', color: '8b5cf6', description: 'The map issue (wayfinder) — owns Notes/Decisions so far/Fog' },
  { name: 'wayfinder:prototype', color: 'f59e0b', description: 'Prototype ticket (wayfinder)' },
  { name: 'wayfinder:research', color: '0ea5e9', description: 'Research ticket (wayfinder)' },
  { name: 'wayfinder:task', color: '10b981', description: 'Task ticket (wayfinder)' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 由清单现算的东西不住在这里：名单（CANONICAL_LABEL_NAMES）、集合（CANONICAL_LABEL_SET）、
// `isCanonicalLabel` / `missingCanonicalLabels` 四样是行为，按地图02开发票（#1026）的裁决
// 已搬到 `src/tracker/label-names.ts`。本文件只留上面的数组（契约自己的数据）。
// ─────────────────────────────────────────────────────────────────────────────
