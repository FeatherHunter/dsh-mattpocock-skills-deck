// tests/verify-1281-entries.ts —— #1281 双入口 / 规格三态 / 实施票 / 两处接线的门禁
// 门禁归属: src/client/kernel/prompts.ts, src/client/kernel/router.ts, src/client/views/shared/Tabs.ts, src/client/statusbar/StatusBar.ts, src/client/kernel/container-view.ts, src/client/kernel/store-derived.ts, src/client/kernel/locale-spec.ts, src/client/kernel/locale-panel.ts, src/shared/naming-titles.ts
// 验证（每条都能被删掉/改坏而变红）：
//   1) 注册表新增五条：newSpec / tpl.implement / specSplit / specExecute / specComplete，且各自首行技能与占位符正确；
//      完成模板 complete 改成自包含格式（首行 /wayfinder、次行 {url}）。
//   2) 两个入口各自只有一个拼装函数：newWayfinderText / newSpecText；面板 Tabs 与状态栏胶囊悬停菜单两处都调同一个
//      newSpecText，并都用 newSessionTitleNew('spec') 生成会话标题。
//   3) 词条：新入口的紫色/蓝色悬停提示从「两条路的本质区别」各说一句（还没想清 / 已经想清），中英成对。
//   4) 规格三态各注入自己的模板（specSplit / specExecute / specComplete），完成态不再复用地图的 completePrompt。
//   5) 实施票：ready-for-agent 走「实施」，注入 tpl.implement（首行 /implement），按钮标签与提示词成对。
//   6) 会话标题：naming-titles 里 spec 占位是「写规格」/「Write Spec」。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1281-entries.ts
const { sourceText } = require('./lib/source-text.ts')

const prompts = sourceText('src/client/kernel/prompts.ts')
const router = sourceText('src/client/kernel/router.ts')
const tabs = sourceText('src/client/views/shared/Tabs.ts')
const bar = sourceText('src/client/statusbar/StatusBar.ts')
const cv = sourceText('src/client/kernel/container-view.ts')
const sd = sourceText('src/client/kernel/store-derived.ts')
const specLocale = sourceText('src/client/kernel/locale-spec.ts')
const panelLocale = sourceText('src/client/kernel/locale-panel.ts')
const naming = sourceText('src/shared/naming-titles.ts')

let failed = false
let total = 0
const check = (ok, msg) => { total++; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 1) 注册表五条新增 + complete 自包含
check(/\"newSpec\": \{ version: 1,/.test(prompts), 'newSpec 条目存在且 v1')
check(prompts.indexOf("'/grill-with-docs\\n请帮我讨论一个需求") >= 0, 'newSpec 首行是 /grill-with-docs 且收尾提醒 to-spec（正文在注册表）')
check(prompts.indexOf("'/implement\\n{url}\\n\\n按 /implement 技能实施这张票。") >= 0, 'tpl.implement 首行 /implement、次行 {url}')
check(prompts.indexOf("'/to-tickets\\n{url}") >= 0, 'specSplit 首行 /to-tickets')
check(prompts.indexOf("'/implement-spec\\n{url}") >= 0, 'specExecute 首行 /implement-spec')
check(prompts.indexOf('这张规格 issue（{url}）下面的实施 issue 已经全部关闭') >= 0, 'specComplete 是规格收口模板（逐张核对后关闭）')
check(prompts.indexOf("'/wayfinder\\n{url}\\n\\n## 完成核对") >= 0, 'complete 自包含：首行 /wayfinder、次行 {url}、完成核对节')
check(prompts.indexOf('提醒用户手动执行一次 /to-spec') >= 0 && prompts.indexOf('提醒用户手动执行一次 /to-tickets') >= 0, 'complete 含两步手动交棒提醒')

// 2) 两处入口共用一个拼装函数
check(router.indexOf('export const newSpecText') >= 0 && router.indexOf('newSpecPrompt(st)') >= 0, 'router 导出 newSpecText（唯一拼装函数）')
const specCall = "openTextInNewSession(s, newSpecText(s), newSessionTitleNew('spec'))"
check(tabs.indexOf(specCall) >= 0, '面板 Tabs 调 newSpecText + newSessionTitleNew(spec)')
check(bar.indexOf(specCall) >= 0, '状态栏胶囊悬停菜单调同一行（逐字一致）')
check((tabs.match(/openTextInNewSession\(s, newWayfinderText\(s\)/g) || []).length >= 1, '面板保留紫色入口（newWayfinderText）')
check((bar.match(/openTextInNewSession\(s, newWayfinderText\(s\)/g) || []).length >= 1, '胶囊菜单保留紫色入口（newWayfinderText）')

// 3) 悬停提示：说清两条路的本质区别（还没想清 / 已经想清），中英成对、两处同句
check(panelLocale.indexOf("'panel.newWayfinderTitle': '适合还没想清的需求") >= 0, '紫色入口悬停提示 zh：还没想清的需求')
check(panelLocale.indexOf("'nav.takeableNewTitle': '适合还没想清的需求") >= 0, '胶囊紫色入口悬停提示 zh：与面板同句')
check(specLocale.indexOf("'panel.newSpecTitle': '适合已经想清的需求") >= 0, '蓝色入口悬停提示 zh：已经想清的需求')
check(specLocale.indexOf("'nav.takeableSpecTitle': '适合已经想清的需求") >= 0, '胶囊蓝色入口悬停提示 zh：与面板同句')
check(panelLocale.indexOf("For requirements that are not clear yet") >= 0 && specLocale.indexOf("For requirements that are already clear") >= 0, '两条悬停提示都有英文版且语义相反')

// 4) 规格三态各走自己的模板
check(cv.indexOf("promptTextFor(st, 'specSplit'") >= 0, '规格空态注入 specSplit')
check(cv.indexOf("promptTextFor(st, 'specExecute'") >= 0, '规格执行态注入 specExecute')
check(cv.indexOf("promptTextFor(st, 'specComplete'") >= 0, '规格完成态注入 specComplete（不再复用地图的 completePrompt）')

// 5) 实施票路由与按钮
check(sd.indexOf("if (has('ready-for-agent')) return 'implement'") >= 0, 'ready-for-agent 行级动作是「实施」')
check(sd.indexOf("promptText('tpl.implement'") >= 0, '实施动作注入 tpl.implement 模板')
check(sd.indexOf("tr('act.implement')") >= 0 && sd.indexOf("tr('tip.implement')") >= 0, '实施按钮的标签与悬停提示走同一对词条')
check(specLocale.indexOf("'act.implement': '实施'") >= 0 && specLocale.indexOf("'tip.implement':") >= 0, 'act.implement / tip.implement 中英词条成对登记')

// 6) 会话标题占位
check(naming.indexOf("spec: '写规格'") >= 0 && naming.indexOf("spec: 'Write Spec'") >= 0, 'spec 占位标题：写规格 / Write Spec')
check(naming.indexOf("t.indexOf('spec')") >= 0, 'placeholderTitleFor 认 spec 分支')

console.log('')
console.log(failed ? ('失败 ' + total + ' 条断言') : ('全部通过：' + total + ' 条断言'))
process.exit(failed ? 1 : 0)
