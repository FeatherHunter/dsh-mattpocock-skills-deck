/**
 * shared/matt-skills.ts — Matt Pocock 技能套件 单一真源（#280 · D10 · #fix-banner）
 *
 * 契约：
 *   1) MATT_SKILL_PROBE_NAMES：host 半运行时 import() 用作正交探测清单（chain 链上「技能已安装」检查）；
 *      这份名单不手写，由下方 SKILLS_DATA 数据表一行派生（#1342：一个名字全仓只写一处）。
 *   2) SKILLS：client 半「技能目录」的渲染底座——技能页面的列表、状态栏的「技能套件」悬浮列表、
 *      安装后的参数字典（src/client/index.ts 的 installSkillsParams）都从这里取名字与档位。
 *      数组顺序就是面板上的展示顺序，别按字母重排。
 *      importance ∈ 'core' | 'common' | 'rare'：决定技能行左边方点的颜色与实心/空心（#1837 起取代原来的
 *      状态档位）。这一档是「重要程度」，不是「能不能用」：随包的 27 个技能都可以用，颜色只说明
 *      该先关注哪个。档位外观映射在下面的 SKILL_IMPORTANCE_STYLES 一处定义，行与标题行右侧的图例共用，
 *      所以图例上写的颜色不会和行里画的对不上。
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

// 技能重要程度只有这三个字面量：core 是默认工作流里的一段、或者开工前/收尾时要用的；
// common 是多数任务里顺手会用的支撑技能；rare 是只在特定场合才用得上的专项技能。
// 判据按上面的顺序命中即停，「重要」说的是在默认工作流里的位置，不是影响力或出场频率——
// 这两条换个人来评就会换一套答案，位置是仓库里能指着说的东西（判据与 27 项分档见 #1837）。
// 列表上的方块颜色与标题行右侧的图例都按这三个字画，写错一个字母就会落到「常用」的默认色，
// 图例说明的含义当场变形，所以 tests/verify-1837-skill-importance.ts 会把三档枚举钉住。
// 这个联合类型对外导出：client 的 pixelProps 用 import type 连到这里，props 不再退化成 string。
export type MattSkillImportance = 'core' | 'common' | 'rare'

// 技能目录里的一行：name 是唯一键，importance 决定方块颜色与空心。
// 描述不放在这里：渲染时按 name 到 locale 的 skilldesc.<name> 取文案（#1342 删掉了全仓没人读的中文 use）。
// 探测名单 MATT_SKILL_PROBE_NAMES 也从这张表派生，因此 27 个名字只在这一处写一遍。
type MattSkillEntry = { name: string; importance: MattSkillImportance }

const SKILLS_DATA: MattSkillEntry[] = [
  { name: 'ask-matt',                      importance: 'core' },   // 入口：不知道该用哪个技能时先问它
  { name: 'setup-matt-pocock-skills',      importance: 'core' },   // 前置：仓库初始化，不跑后面的流程接不上
  { name: 'wayfinder',                     importance: 'core' },   // 主干：多议题项目的决策地图与拆票
  { name: 'grill-me',                      importance: 'core' },   // 主干：拍板前的追问
  { name: 'grill-with-docs',               importance: 'core' },   // 主干：对照仓库文档的追问
  { name: 'to-spec',                       importance: 'core' },   // 主干：讨论固化成规格
  { name: 'to-tickets',                    importance: 'core' },   // 主干：规格拆成票
  { name: 'implement',                     importance: 'core' },   // 主干：按规格逐项实现
  { name: 'handoff',                       importance: 'core' },   // 主干收尾：压缩成交接文档
  { name: 'research',                      importance: 'common' }, // 支撑：后台调研写文档
  { name: 'prototype',                     importance: 'common' }, // 支撑：一次性原型
  { name: 'triage',                        importance: 'core' },   // 主干：issue 分流，工作里有票就先用它
  { name: 'wizard',                        importance: 'rare' },   // 专项：人工步骤向导
  { name: 'code-review',                   importance: 'common' }, // 支撑：改动审查
  { name: 'diagnosing-bugs',               importance: 'common' }, // 支撑：硬 bug 定位
  { name: 'retro',                         importance: 'rare' },   // 专项：会话复盘
  { name: 'grilling',                      importance: 'core' },   // 主干：拍板前的追问（通用版）
  { name: 'domain-modeling',               importance: 'common' }, // 支撑：统一术语
  { name: 'to-questionnaire',              importance: 'rare' },   // 专项：整理成问卷
  { name: 'implement-spec',                importance: 'core' },   // 主干：整份规格一次跑完
  { name: 'tdd',                           importance: 'common' }, // 支撑：先写失败测试
  { name: 'codebase-design',               importance: 'rare' },   // 专项：模块边界与接口设计
  { name: 'improve-codebase-architecture', importance: 'rare' },   // 专项：深化机会扫描
  { name: 'pr',                            importance: 'common' }, // 支撑：写 PR 正文
  { name: 'teach',                         importance: 'rare' },   // 专项：跨 session 教学
  { name: 'wait-what',                     importance: 'rare' },   // 专项：用大白话重讲
  { name: 'writing-for-agents',            importance: 'rare' },   // 专项：写给 agent 的文档写法
]
// 三档在技能列表上的外观（#1837）：颜色一律引用皮肤令牌，不写死色值——深色/浅色两套皮肤
// 各换自己的令牌就整体换装，改色只改皮肤文件一处。备用档画空心方点：底色透明、只留描边，
// 让「不需要常惦记」在形状上也能一眼分辨，不单靠橙绿两色（也照顾橙绿分不清的人）。
// 行与图例都从这张表取，改档位颜色时两边同时变，tests/verify-1837-skill-importance.ts 会钉住这里的三项。
export const SKILL_IMPORTANCE_STYLES: Record<MattSkillImportance, { color: string; hollow: boolean }> = {
  core:   { color: 'var(--pixel-warn)', hollow: false },
  common: { color: 'var(--pixel-ok)', hollow: false },
  rare:   { color: 'transparent', hollow: true },
}
// 探测名单由数据表派生：增删技能只改上面的 SKILLS_DATA，名字不会两边分叉。
// 这里的顺序跟随面板展示顺序；探测只按集合用（verify-bundled-skills 与 sync 脚本都做集合比对），顺序不参与判定。
export const MATT_SKILL_PROBE_NAMES: string[] = SKILLS_DATA.map((s) => s.name)
// #1342：技能目录只留 SKILLS 一个导出名。原先还多一个 MATT_SKILL_CATALOG 指向同一个数组，
//   查遍仓内消费者（client 片段只 declare SKILLS、tests 只 import SKILLS、宿主只 import MATT_SKILL_PROBE_NAMES）
//   没有任何地方读它，删掉。
export const SKILLS: MattSkillEntry[] = SKILLS_DATA
