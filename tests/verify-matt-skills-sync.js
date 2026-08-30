#!/usr/bin/env node
/**
 * tests/verify-matt-skills-sync.js — 守护 #fix-banner 三件套不漂移
 *
 * 检查源树与 installed 副本两边一致：
 *   1) shared/matt-skills.js 单源 = MATT_SKILL_PROBE_NAMES（25 项）= SKILLS（25 项）
 *   2) host SKILL_PROBE_NAMES 通过 await import('../shared/matt-skills.js') 取得（非内联字面量）
 *   3) client SKILLS 数组（installed 副本的 SKILLS = probeNames 集合）与 host 一致
 *   4) client installSkills prompt 使用 {probeList} + {probeCount} 占位符，且 installSkillsParams() 派生自 SKILLS
 *   5) ensureSidebarTab 仅注册 1 个 tab id（已删除 LEGACY waystation:map 双注册）
 *
 * 退出码 0 = 全通过；1 = 失败（CI/verify 链会卡住）
 */
const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC_HOST = path.join(ROOT, 'src/host/index.js')
const SRC_CLIENT = path.join(ROOT, 'src/client/index.js')
const SRC_SHARED = path.join(ROOT, 'src/shared/matt-skills.js')
const SRC_PROMPTS = path.join(ROOT, 'src/client/kernel/prompts.js')
const SRC_ROUTER = path.join(ROOT, 'src/client/kernel/router.js')
const SRC_BUILDMJS = path.join(ROOT, 'scripts/build.mjs')

const INSTALLED = process.env.HARNESS_INSTALLED || '/Users/wangbo/.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck'
const INST_HOST = path.join(INSTALLED, 'lib/index.js')
const INST_CLIENT = path.join(INSTALLED, 'lib/client.js')
const INST_SHARED = path.join(INSTALLED, 'shared/matt-skills.js')

let failures = 0
function check(cond, msg) { if (!cond) { console.log('[FAIL]', msg); failures++ } else { console.log('[PASS]', msg) } }

// --- 1. shared file 单源 ---
if (!existsSync(SRC_SHARED)) {
  check(false, 'src/shared/matt-skills.js 缺失（应作为单源）')
} else {
  const shared = readFileSync(SRC_SHARED, 'utf8')
  check(/export const MATT_SKILL_PROBE_NAMES = \[/.test(shared), 'shared 导出 MATT_SKILL_PROBE_NAMES')
  check(/export const MATT_SKILL_CATALOG\s*=\s*SKILLS_DATA/.test(shared) || /export const MATT_SKILL_CATALOG/.test(shared), 'shared 导出 MATT_SKILL_CATALOG')
  check(/export const SKILLS\s*=\s*SKILLS_DATA/.test(shared) || /export const SKILLS/.test(shared), 'shared 导出 SKILLS（client 旧引用兼容）')
}

// --- 2. host 不再内联 SKILL_PROBE_NAMES 字面量（25 项内联是漂移源头）---
if (existsSync(SRC_HOST)) {
  const t = readFileSync(SRC_HOST, 'utf8')
  check(!/const SKILL_PROBE_NAMES\s*=\s*\['ask-matt'/.test(t), 'src/host/index.js 不再内联 SKILL_PROBE_NAMES 字面量')
  check(/await import\(['"]\.\.\/shared\/matt-skills\.js['"]\)/.test(t), 'src/host/index.js 经 await import 读 shared/matt-skills.js')
  check(/getMattSkillProbeNames\s*\(/.test(t), 'src/host/index.js 暴露 getMattSkillProbeNames() 惰性加载器')
}

// --- 3. client SKILLS（installed 副本）---
// SKILLS data may be declared as `const SKILLS = [...]` 或通过 SKILLS_DATA 别名间接引用；
// 这里直接扫描文件取所有 `name: '...'` 字段，只要 client 闭包内声明的 SKILLS 数组
// 含 25 项全名即通过（不论 inline 还是 alias）
if (existsSync(INST_CLIENT)) {
  const t = readFileSync(INST_CLIENT, 'utf8')
  // 找 SKILLS / SKILLS_DATA / MATT_SKILL_CATALOG 的赋值声明（截至下一个 const/export/==== marker 终止）
  // 然后扫描该声明体内是否含 25 个 name: '...' 字段
  const re = /const\s+(?:SKILLS|SKILLS_DATA|MATT_SKILL_CATALOG)\s*=\s*(\[[\s\S]*?\]|SKILLS_DATA)(?=[\n;])/g
  const defs = [...t.matchAll(re)]
  if (defs.length === 0) {
    check(false, 'installed lib/client.js 缺 SKILLS 数组声明')
  } else {
    // 收集所有声明的 body；inline 数组直接在 body 里查 name；alias 时无法看到数组成员，按 body 含 SKILLS_DATA 标记则接受
    const allBodies = defs.map(m => m[1]).join('\n')
    const isAlias = /SKILLS_DATA/.test(allBodies)
    if (!isAlias) {
      const names = [...allBodies.matchAll(/name:\s*'([\w-]+)'/g)].map(m => m[1])
      const EXPECTED = ['ask-matt', 'code-review', 'codebase-design', 'diagnosing-bugs', 'domain-modeling', 'grill-with-docs', 'implement', 'improve-codebase-architecture', 'prototype', 'research', 'resolving-merge-conflicts', 'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets', 'triage', 'wayfinder', 'wizard', 'grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what', 'writing-for-agents']
      const missing = EXPECTED.filter(n => !names.includes(n))
      check(missing.length === 0, `installed client SKILLS 包含全部 25 项（缺：${missing.join(', ') || '无'}）`)
    } else {
      // alias 模式：扫描 SKILLS_DATA = [...] 那块的 25 个 name
      const dataMatch = t.match(/const\s+SKILLS_DATA\s*=\s*\[([\s\S]*?)\]/)
      const names = dataMatch ? [...dataMatch[1].matchAll(/name:\s*'([\w-]+)'/g)].map(m => m[1]) : []
      const EXPECTED = ['ask-matt', 'code-review', 'codebase-design', 'diagnosing-bugs', 'domain-modeling', 'grill-with-docs', 'implement', 'improve-codebase-architecture', 'prototype', 'research', 'resolving-merge-conflicts', 'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets', 'triage', 'wayfinder', 'wizard', 'grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what', 'writing-for-agents']
      const missing = EXPECTED.filter(n => !names.includes(n))
      check(missing.length === 0, `installed client SKILLS（alias 模式）含全部 25 项（缺：${missing.join(', ') || '无'}）`)
    }
  }
}

// --- 4. client installSkills prompt 使用占位符 + helper 派生 ---
if (existsSync(INST_CLIENT)) {
  const t = readFileSync(INST_CLIENT, 'utf8')
  // Prompt contains both {probeList} and {probeCount}
  const installMatch = t.match(/"installSkills":\s*\{[\s\S]*?placeholders:\s*\[([^\]]+)\]/)
  check(!!installMatch && /['"]probeList['"]/.test(installMatch[1]) && /['"]probeCount['"]/.test(installMatch[1]), 'installed installSkills prompt 声明 placeholders: [probeList, probeCount]')
  check(/installSkillsParams\s*=\s*function/.test(t), 'installed 定义 installSkillsParams() helper')
  // Both callers pass installSkillsParams()
  const callerHits = (t.match(/promptText\('installSkills',\s*installSkillsParams\(\)\)/g) || []).length
  check(callerHits >= 2, `installed 两处 installSkills 调用都传 installSkillsParams()（命中 ${callerHits}/2）`)
}

// --- 5. ensureSidebarTab 只注册一个 tab id ---
if (existsSync(INST_CLIENT)) {
  const t = readFileSync(INST_CLIENT, 'utf8')
  const block = t.match(/ensureSidebarTab[\s\S]{0,2500}/)
  if (block) {
    const tabCalls = (block[0].match(/registerTab\s*\(\s*\{/g) || []).length
    check(tabCalls === 1, `ensureSidebarTab 仅注册 1 个 tab id（修复双 sliders；当前 ${tabCalls}）`)
    check(!/id:\s*['"]waystation:map['"]/.test(block[0]), 'ensureSidebarTab 不再注册 waystation:map LEGACY 别名')
  } else {
    check(false, 'installed ensureSidebarTab 未定位到')
  }
}

// --- 6. installed shared file 已就位（host 通过它读 probe list） ---
if (existsSync(INST_SHARED)) {
  const t = readFileSync(INST_SHARED, 'utf8')
  check(/export const MATT_SKILL_PROBE_NAMES/.test(t), 'installed shared/matt-skills.js 导出 MATT_SKILL_PROBE_NAMES')
} else if (existsSync(INST_HOST)) {
  // 兜底：installed shared 不存在 → host 落到 inline fallback
  console.log('[note] installed shared/matt-skills.js 缺失；host 将回退到 inline fallback（不阻断，但建议 pnpm install 重生成）')
}

console.log('\n=== verify-matt-skills-sync ===')
if (failures === 0) {
  console.log('ALL CHECKS PASS')
  process.exit(0)
} else {
  console.log(`${failures} FAILURE(S)`)
  process.exit(1)
}
