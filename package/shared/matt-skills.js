/**
 * shared/matt-skills.js — Matt Pocock 技能套件 单一真源（#280 · D10 · #fix-banner）
 *
 * 契约：
 *   1) MATT_SKILL_PROBE_NAMES：host 半运行时 import() 用作正交探测清单（chain 链上「技能已安装」检查）；
 *   2) MATT_SKILL_CATALOG / SKILLS：client 半「技能目录」（设置页 / 推荐 / T0 状态栏）渲染底座。
 *      level ∈ 'ok' | 'warn' | 'alert'：驱动状态栏胶囊颜色与设置页标签。
 *      use 是中文短描述（en 在 locale skilldesc.<name> 翻译）。
 *
 * 历史：原注释承诺 `shared/matt-skills.js` 是「单一真源」，但 src 与 installed 两半的 SKILL_PROBE_NAMES 数组
 *       各自手写，client SKILLS 数组在 v1.5 之后漂移到只列 20 项（v1.7.3），丢失 grill-with-docs / wizard /
 *       grill-me / to-questionnaire / wait-what / writing-for-agents 六项；同时 installSkills prompt 硬编码 10 项，
 *       安装按钮的验证清单因此不完整 → 横幅永远报警、状态栏 skills 胶囊显示不全、MattSkills slider 双注册。
 *
 * 本文件 = 单一真源；host 经 await import('../shared/matt-skills.js') 读；
 *                 client 由 scripts/build.mjs 以 SHARED_SPLICE 拼入 src/client/index.js。
 *                 splice 提取会剥掉 `export ` 前缀，因此本文件用 const SKILLS_DATA 命名原始数组，
 *                 再用 export const MATT_SKILL_CATALOG = SKILLS_DATA 与 export const SKILLS = SKILLS_DATA 双导出；
 *                 splice 后产物同时具备 MATT_SKILL_CATALOG 与 SKILLS 两种命名（兼容老 client 代码）。
 */
export const MATT_SKILL_PROBE_NAMES = [
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
  'writing-for-agents'
]

const SKILLS_DATA = [
  { name: 'ask-matt',                      level: 'warn', use: '技能路由器：不知道该用哪个 skill 时问它' },
  { name: 'setup-matt-pocock-skills',      level: 'ok',   use: '仓库初始化：issue tracker / 标签 / 文档路径' },
  { name: 'wayfinder',                     level: 'warn', use: '巨型项目决策地图（本插件服务的对象）' },
  { name: 'triage',                        level: 'ok',   use: 'issue 分流：归类→验证→追问，直至 ready-for-agent' },
  { name: 'grilling',                      level: 'ok',   use: '穷追不舍的对齐提问（设计树）' },
  { name: 'grill-with-docs',               level: 'ok',   use: '在仓库文档里追问与对齐（grilling + 文档引用）' },
  { name: 'grill-me',                      level: 'ok',   use: '脱离工作区的纯对话 grilling（不写文档）' },
  { name: 'domain-modeling',               level: 'ok',   use: '领域术语与统一语言' },
  { name: 'research',                      level: 'ok',   use: '后台调研，写进 repo 内 markdown 并引源' },
  { name: 'prototype',                     level: 'ok',   use: '一次性原型回答设计问题' },
  { name: 'implement',                     level: 'warn', use: '把规格落成代码（task 型 ticket）' },
  { name: 'code-review',                   level: 'ok',   use: '按标准 + 规格双轴审查改动' },
  { name: 'codebase-design',               level: 'ok',   use: '深模块设计词汇' },
  { name: 'diagnosing-bugs',               level: 'ok',   use: '硬 bug 与性能回归诊断循环' },
  { name: 'improve-codebase-architecture', level: 'ok',   use: '扫 deepening opportunities 出 HTML 报告' },
  { name: 'tdd',                           level: 'ok',   use: '红-绿-重构' },
  { name: 'wizard',                        level: 'ok',   use: '生成交互式 bash 引导完成人工才能做的步骤' },
  { name: 'handoff',                       level: 'warn', use: '把当前对话压缩成交接文档' },
  { name: 'teach',                         level: 'ok',   use: '跨 session 教你新技能' },
  { name: 'to-spec',                       level: 'warn', use: '把讨论固化成规格' },
  { name: 'to-tickets',                    level: 'warn', use: '把规格拆成 tickets' },
  { name: 'to-questionnaire',              level: 'ok',   use: '给第三方写一份可填写的问卷' },
  { name: 'resolving-merge-conflicts',     level: 'ok',   use: '解决合并冲突' },
  { name: 'wait-what',                     level: 'ok',   use: '用大白话重说上一轮你没接住的内容' },
  { name: 'writing-for-agents',            level: 'warn', use: '为 agent 写文档（skills / AGENTS.md）' },
]
export const MATT_SKILL_CATALOG = SKILLS_DATA
export const SKILLS = SKILLS_DATA
