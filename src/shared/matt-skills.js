/**
 * shared/matt-skills.js — Matt Pocock 技能套件单一真源（10 技能）· #282 单一真源化
 *
 * 生效日期：2026-08-29
 * 效力规则：本文件为十技能名单的唯一真源；host 探测名单、check-catalog 通用检查、
 *   client 技能卡片渲染、提示词占位符均由此派生。
 * 变更时只需修改此处数组，构建期自动注入提示词占位、检查链与渲染卡片保持逐项相等。
 * 与 #274 根因 5（19 项硬编码漏技 grill-me）对应：此处含 grill-me，渲染侧同步可见。
 */

/** Matt Pocock 官方 skills 套件 10 成员（固定顺序，构建期与运行时共享） */
export const MATT_SKILLS = Object.freeze([
  'wayfinder',
  'triage',
  'grilling',
  'grill-me',
  'implement',
  'ask-matt',
  'research',
  'prototype',
  'handoff',
  'setup-matt-pocock-skills',
])

/** 展示用：斜杠分隔的技能清单（用于提示词与 banner 文案） */
export const MATT_SKILLS_LABEL = MATT_SKILLS.join(' / ')

/** 校验：名单长度恒为 10 */
export const MATT_SKILLS_COUNT = MATT_SKILLS.length

/** 工具：是否为合法 Matt 技能名 */
export function isMattSkill(name) {
  return MATT_SKILLS.includes(String(name))
}
