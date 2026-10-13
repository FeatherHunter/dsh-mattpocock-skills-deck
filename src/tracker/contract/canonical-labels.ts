/**
 * src/shared/labels.js — 单源标签清单（#188）
 * 契约：CANONICAL_LABELS[10] 为校验与文档单源（verify-labels-sync 仅比 name 集合，不卡色）
 * 来源：gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/labels 19 条中 10 核心（2026-08-26 实测）
 * 用途：client NoRepoCard 标签步骤 Modal 与 PROMPTS.ensureLabels 同源校验；宿主不自动 gh label create，纯 UI 人机协作
 */
export const CANONICAL_LABELS = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'needs-triage', color: 'fbca04', description: 'Maintainer needs to evaluate this issue (unexamined, awaiting diagnosis)' },
  { name: 'needs-info', color: '5319e7', description: 'Waiting on reporter for more information' },
  { name: 'ready-for-agent', color: '0e8a16', description: 'Fully specified, ready for an AFK agent to implement' },
  { name: 'ready-for-human', color: 'b60205', description: 'Requires human implementation' },
  { name: 'wayfinder:grilling', color: '9D7CD8', description: "Open decision/discussion ticket (wayfinder grilling type) — drives the deck's discuss action" },
  { name: 'wayfinder:map', color: '8b5cf6', description: 'The map issue (wayfinder) — owns Notes/Decisions so far/Fog' },
  { name: 'wayfinder:prototype', color: 'f59e0b', description: 'Prototype ticket (wayfinder)' },
  { name: 'wayfinder:research', color: '0ea5e9', description: 'Research ticket (wayfinder)' },
  { name: 'wayfinder:task', color: '10b981', description: 'Task ticket (wayfinder)' },
]
export const CANONICAL_LABEL_NAMES = CANONICAL_LABELS.map(function (l) { return l.name })
export const CANONICAL_LABEL_SET = new Set(CANONICAL_LABEL_NAMES)
export function isCanonicalLabel(name) { return CANONICAL_LABEL_SET.has(String(name || '').trim()) }
export function missingCanonicalLabels(existingNames) {
  const have = new Set((Array.isArray(existingNames) ? existingNames : []).map(function (n) { return String(n || '').trim().toLowerCase() }))
  return CANONICAL_LABEL_NAMES.filter(function (n) { return !have.has(n.toLowerCase()) })
}
