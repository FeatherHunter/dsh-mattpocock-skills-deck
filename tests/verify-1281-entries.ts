// tests/verify-1281-entries.ts —— #1281 双入口 / 规格三态 / 实施票 / 两处接线的门禁
// 门禁归属: config/prompts/ticket-action-templates.yaml, config/prompts/map-advancement.yaml, config/prompts/ticket-creation.yaml, src/client/kernel/router.ts, src/client/kernel/entry-choice.ts, src/client/views/shared/Tabs.ts, src/client/statusbar/StatusBar.ts, src/client/kernel/container-view.ts, src/client/kernel/row-actions.ts, src/client/kernel/locale-spec.ts, src/client/kernel/locale-panel.ts, src/shared/naming-titles.ts
// 验证（每条都能被删掉/改坏而变红）：
//   1) 注册表新增五条：newSpec / tpl.implement / specSplit / specExecute / specComplete，且各自首行技能与占位符正确；
//      完成模板 complete 改成自包含格式（首行 /wayfinder、次行 {url}）。
//   2) #1297 起两处入口合并成一层浮层，宿主不再各自拼开场白：面板 Tabs 与状态栏胶囊悬停菜单都只调
//      entryChooserOpen，选卡后的 newWayfinderText / newSpecText 与会话标题只住 kernel/entry-choice.ts。
//   3) 词条：两处入口的悬停提示合成一句「点一下弹出两张卡，由你自己选」，中英成对；蓝入口的两个键已删。
//   4) 规格三态各注入自己的模板（specSplit / specExecute / specComplete），完成态不再复用地图的 completePrompt。
//   5) 实施票：ready-for-agent 走「实施」，注入 tpl.implement（首行 /implement），按钮标签与提示词成对。
//   6) 会话标题：naming-titles 里 spec 占位是「实施地图」/「Impl map」（#1297 起改名，不再叫旧卡名）。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1281-entries.ts
const path = require('node:path')
const { sourceText } = require('./lib/source-text.ts')
const promptConfig = require('../scripts/lib/prompt-config.mts')

const ROOT = path.resolve(__dirname, '..')
const router = sourceText('src/client/kernel/router.ts')
const entry = sourceText('src/client/kernel/entry-choice.ts')
const tabs = sourceText('src/client/views/shared/Tabs.ts')
const bar = sourceText('src/client/statusbar/StatusBar.ts')
const cv = sourceText('src/client/kernel/container-view.ts')
// 行级动作全家（八选一阶梯、实施票路由、按钮词条）已从 store-derived.ts 抽到 row-actions.ts。
const sd = sourceText('src/client/kernel/row-actions.ts')
const specLocale = sourceText('src/client/kernel/locale-spec.ts')
const panelLocale = sourceText('src/client/kernel/locale-panel.ts')
const naming = sourceText('src/shared/naming-titles.ts')

let failed = false
let total = 0
const check = (ok, msg) => { total++; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 1) 注册表五条新增 + complete 自包含
// #1292 起模板正文的真源是 config/prompts/ 下的五份族 YAML，不再住在 prompts.ts 里。
// 这一块改成读真源数据再断言（走生成器与门禁共用的读取核）：判据一条没减，只是从
// 「抠源码里的字面量」换成「读那条模板的正文」，从此也不会被源码排版的变化骗过。
const promptData = promptConfig.readPromptConfig(ROOT)
function templateOf(id) {
  const spec = promptConfig.PROMPT_TEMPLATE_IDS.filter((t) => t.id === id)[0]
  return spec && promptData.templates[spec.family] ? promptData.templates[spec.family][id] : null
}
function zhOf(id) {
  const entry = templateOf(id)
  return entry ? String(entry.zh || '') : ''
}
function enOf(id) {
  const entry = templateOf(id)
  return entry ? String(entry.en || '') : ''
}

const newSpecEntry = templateOf('newSpec')
check(!!newSpecEntry && newSpecEntry.version === 1, 'newSpec 条目存在且 v1')
check(zhOf('newSpec').indexOf('/grill-with-docs\n请帮我讨论一个需求') === 0, 'newSpec 首行是 /grill-with-docs 且收尾提醒 to-spec（正文在注册表）')
check(zhOf('tpl.implement').indexOf('/implement\n{url}\n\n按 /implement 技能实施这张票。') === 0, 'tpl.implement 首行 /implement、次行 {url}')
check(zhOf('specSplit').indexOf('/to-tickets\n{url}') === 0, 'specSplit 首行 /to-tickets')
// #1383：拆票提示词写死 deck 工具建票（关键词包含判据，不脆断整段逐字）。
//   中英各含：先用 deck_context 确认后端、用 deck_issue_create 建实施票
//   （kind=spec-ticket、parentKey 填规格票号、blockedBy 填依赖）、本地后端不要手写 .scratch 票文件。
check(zhOf('specSplit').indexOf('deck_context') >= 0, 'specSplit.zh 先用 deck_context 确认后端')
check(enOf('specSplit').indexOf('deck_context') >= 0, 'specSplit.en 先用 deck_context 确认后端')
check(zhOf('specSplit').indexOf('deck_issue_create') >= 0, 'specSplit.zh 用 deck_issue_create 建实施票')
check(enOf('specSplit').indexOf('deck_issue_create') >= 0, 'specSplit.en 用 deck_issue_create 建实施票')
check(zhOf('specSplit').indexOf('kind=spec-ticket') >= 0, 'specSplit.zh 实施票 kind=spec-ticket')
check(enOf('specSplit').indexOf('kind=spec-ticket') >= 0, 'specSplit.en 实施票 kind=spec-ticket')
check(zhOf('specSplit').indexOf('kind=ticket') < 0 && enOf('specSplit').indexOf('kind=ticket') < 0, 'specSplit 中英都不再出现旧的 kind=ticket')
check(zhOf('specSplit').indexOf('parentKey') >= 0, 'specSplit.zh parentKey 填这张规格票号')
check(enOf('specSplit').indexOf('parentKey') >= 0, 'specSplit.en parentKey 填这张规格票号')
check(zhOf('specSplit').indexOf('blockedBy') >= 0, 'specSplit.zh blockedBy 填依赖票号')
check(enOf('specSplit').indexOf('blockedBy') >= 0, 'specSplit.en blockedBy 填依赖票号')
check(zhOf('specSplit').indexOf('.scratch') >= 0, 'specSplit.zh 本地后端不要手写 .scratch 票文件')
check(enOf('specSplit').indexOf('.scratch') >= 0, 'specSplit.en 本地后端不要手写 .scratch 票文件')
check(zhOf('specExecute').indexOf('/implement-spec\n{url}') === 0, 'specExecute 首行 /implement-spec')
check(zhOf('specComplete').indexOf('这张规格 issue（{url}）下面的实施 issue 已经全部关闭') >= 0, 'specComplete 是规格收口模板（逐张核对后关闭）')
check(zhOf('complete').indexOf('/wayfinder\n{url}\n\n## 完成核对') === 0, 'complete 自包含：首行 /wayfinder、次行 {url}、完成核对节')
check(zhOf('complete').indexOf('提醒用户手动执行一次 /to-spec') >= 0 && zhOf('complete').indexOf('提醒用户手动执行一次 /to-tickets') >= 0, 'complete 含两步手动交棒提醒')

// 2) 两处入口共用一层浮层，宿主不再各写一份拼装
check(router.indexOf('export const newSpecText') >= 0 && router.indexOf('newSpecPrompt(st)') >= 0, 'router 导出 newSpecText（实施地图卡的唯一拼装函数）')
check(router.indexOf('export const newWayfinderText') >= 0 && router.indexOf('newWayfinderPrompt(st)') >= 0, 'router 导出 newWayfinderText（探索地图卡的唯一拼装函数）')
check(entry.indexOf('newWayfinderText(st)') >= 0 && entry.indexOf('newSpecText(st)') >= 0, '两张卡的开场白拼装都住 entry-choice.ts（唯一一处）')
check(entry.indexOf("newSessionTitleNew(card === 'map' ? 'requirement' : 'spec')") >= 0, '两张卡的会话标题也在这一个文件里配好')
check(tabs.indexOf("entryChooserOpen(s, 'panel'") >= 0 && bar.indexOf("entryChooserOpen(s, 'statusbar'") >= 0, '两处入口打开同一层浮层（面板 / 状态栏）')
check(tabs.indexOf('newSpecText') < 0 && bar.indexOf('newSpecText') < 0, '两处宿主都不再自己拼实施地图卡的开场白')
check((tabs.match(/h\(EntryChooser/g) || []).length === 1 && (bar.match(/h\(EntryChooser/g) || []).length === 1, '两处宿主挂的是同一个 EntryChooser 组件')

// 3) 悬停提示：两处合成一句「点一下弹出两张卡」，中英成对；蓝入口词条已删
check(panelLocale.indexOf("'panel.newWayfinderTitle': '点一下弹出两张卡") >= 0, '面板入口悬停提示：点一下弹出两张卡')
check(panelLocale.indexOf("'nav.takeableNewTitle': '点一下弹出两张卡") >= 0, '胶囊入口悬停提示与面板同句')
check(panelLocale.indexOf('Opens two cards') >= 0, '合并后的悬停提示有英文版')
check(specLocale.indexOf("'panel.newSpec'") < 0 && specLocale.indexOf("'nav.takeableSpec'") < 0, '蓝入口的两个词条已从词表删掉')

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
check(naming.indexOf("spec: '实施地图'") >= 0 && naming.indexOf("spec: 'Impl map'") >= 0, 'spec 占位标题：实施地图 / Impl map')
check(naming.indexOf("t.indexOf('spec')") >= 0 && naming.indexOf("t.indexOf('实施地图')") >= 0, 'placeholderTitleFor 认 spec 分支与新占位词')

console.log('')
console.log(failed ? ('失败 ' + total + ' 条断言') : ('全部通过：' + total + ' 条断言'))
process.exit(failed ? 1 : 0)
