/**
 * shared/matt-skills.js — Matt Pocock 技能套件单一真源（25 技能）· #282 单一真源化
 */
export const MATT_SKILLS = Object.freeze([
  'ask-matt',
  'code-review',
  'codebase-design',
  'diagnosing-bugs',
  'domain-modeling',
  'grill-with-docs',
  'implement',
  'improve-codebase-architecture',
  'prototype',
  'research',
  'resolving-merge-conflicts',
  'setup-matt-pocock-skills',
  'tdd',
  'to-spec',
  'to-tickets',
  'triage',
  'wayfinder',
  'wizard',
  'grill-me',
  'grilling',
  'handoff',
  'teach',
  'to-questionnaire',
  'wait-what',
  'writing-for-agents',
])
export const MATT_SKILLS_LABEL = MATT_SKILLS.join(' / ')
export const MATT_SKILLS_COUNT = MATT_SKILLS.length
export function isMattSkill(name) { return MATT_SKILLS.includes(String(name)) }
// 组件版本锁定：与桌面版同款精确发行号，禁止裸 latest；单一真源，随上游升级一处更新（#283）
export const SKILLS_CLI_VERSION = '0.3.1'
