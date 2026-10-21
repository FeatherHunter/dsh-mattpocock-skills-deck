/**
 * shared/matt-skills.ts — Matt Pocock 技能套件 单一真源（#280 · D10 · #fix-banner）
 *
 * 契约：
 *   1) MATT_SKILL_PROBE_NAMES：host 半运行时 import() 用作正交探测清单（chain 链上「技能已安装」检查）；
 *      这份名单不手写，由下方 SKILLS_DATA 数据表一行派生（#1342：一个名字全仓只写一处）。
 *   2) SKILLS：client 半「技能目录」（设置页 / 推荐 / T0 状态栏）渲染底座。
 *      数组顺序就是面板上的展示顺序，别按字母重排。
 *      level ∈ 'ok' | 'warn' | 'alert'：驱动状态栏胶囊颜色与设置页标签。
 *      条目不带描述字段——界面文案在渲染时按 name 取 locale 的 skilldesc.<name> 翻译。
 *
 * 历史：原注释承诺 `shared/matt-skills.js` 是「单一真源」，但 src 与 installed 两半的 SKILL_PROBE_NAMES 数组
 *       各自手写，client SKILLS 数组在 v1.5 之后漂移到只列 20 项（v1.7.3），丢失 grill-with-docs / wizard /
 *       grill-me / to-questionnaire / wait-what / writing-for-agents 六项；同时 installSkills prompt 硬编码 10 项，
 *       安装按钮的验证清单因此不完整 → 横幅永远报警、状态栏 skills 胶囊显示不全、MattSkills slider 双注册。
 *
 * 本文件 = 单一真源；host 经 await import('../shared/matt-skills.js') 读；
 *                 client 由 scripts/build.mts 以 SHARED_SPLICE 拼入 src/client/index.ts。
 *                 splice 提取会剥掉 `export ` 前缀，因此本文件用 const SKILLS_DATA 命名原始数组，
 *                 再以 export const SKILLS = SKILLS_DATA 导出给 client 片段用（#1342：原来还有一个
 *                 MATT_SKILL_CATALOG 指向同一数组，全仓没人读，已删掉，只留 SKILLS 一个名字）。
 */

// 技能状态档位只有这三个字面量：ok 表示就绪，warn 表示能用但要先看说明，alert 表示有问题先处理。
// 状态栏胶囊颜色与设置页标签都按这三个字画，写错一个字母就会落到默认色，报警会被当成正常。
type MattSkillLevel = 'ok' | 'warn' | 'alert'

// 技能目录里的一行：name 是唯一键，level 决定颜色。
// 描述不放在这里：渲染时按 name 到 locale 的 skilldesc.<name> 取文案（#1342 删掉了全仓没人读的中文 use）。
// 探测名单 MATT_SKILL_PROBE_NAMES 也从这张表派生，因此 27 个名字只在这一处写一遍。
type MattSkillEntry = { name: string; level: MattSkillLevel }

const SKILLS_DATA: MattSkillEntry[] = [
  { name: 'ask-matt',                      level: 'warn' },
  { name: 'setup-matt-pocock-skills',      level: 'ok' },
  { name: 'wayfinder',                     level: 'warn' },
  { name: 'grill-me',                      level: 'ok' },
  { name: 'grill-with-docs',               level: 'ok' },
  { name: 'to-spec',                       level: 'warn' },
  { name: 'to-tickets',                    level: 'warn' },
  { name: 'implement',                     level: 'warn' },
  { name: 'handoff',                       level: 'warn' },
  { name: 'research',                      level: 'ok' },
  { name: 'prototype',                     level: 'ok' },
  { name: 'triage',                        level: 'ok' },
  { name: 'wizard',                        level: 'ok' },
  { name: 'code-review',                   level: 'ok' },
  { name: 'diagnosing-bugs',               level: 'ok' },
  { name: 'retro',                         level: 'ok' },
  { name: 'grilling',                      level: 'ok' },
  { name: 'domain-modeling',               level: 'ok' },
  { name: 'to-questionnaire',              level: 'ok' },
  { name: 'implement-spec',                level: 'warn' },
  { name: 'tdd',                           level: 'ok' },
  { name: 'codebase-design',               level: 'ok' },
  { name: 'improve-codebase-architecture', level: 'ok' },
  { name: 'pr',                            level: 'ok' },
  { name: 'teach',                         level: 'ok' },
  { name: 'wait-what',                     level: 'ok' },
  { name: 'writing-for-agents',            level: 'warn' },
]
// 探测名单由数据表派生：增删技能只改上面的 SKILLS_DATA，名字不会两边分叉。
// 这里的顺序跟随面板展示顺序；探测只按集合用（verify-bundled-skills 与 sync 脚本都做集合比对），顺序不参与判定。
export const MATT_SKILL_PROBE_NAMES: string[] = SKILLS_DATA.map((s) => s.name)
// #1342：技能目录只留 SKILLS 一个导出名。原先还多一个 MATT_SKILL_CATALOG 指向同一个数组，
//   查遍仓内消费者（client 片段只 declare SKILLS、tests 只 import SKILLS、宿主只 import MATT_SKILL_PROBE_NAMES）
//   没有任何地方读它，删掉。
export const SKILLS: MattSkillEntry[] = SKILLS_DATA
