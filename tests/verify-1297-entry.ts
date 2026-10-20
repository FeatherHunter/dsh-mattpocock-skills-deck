// tests/verify-1297-entry.ts —— #1297 入口浮层（一个「新建需求」入口 → 两张卡）与两处接线的门禁
// 门禁归属: config/copy/cards.yaml, config/copy/panel.yaml, config/copy/spec.yaml, config/prompts/ticket-creation.yaml, src/client/kernel/entry-card.ts, src/client/kernel/entry-choice.ts, src/client/kernel/store-snapshot.ts, src/client/views/shared/Tabs.ts, src/client/statusbar/StatusBar.ts, src/client/statusbar/StatusMenus.ts, src/client/index.ts, scripts/build.mts, src/shared/naming-titles.ts
// 验证（每条都能被删掉/改坏而红）：
//   1) 只有一个入口：两处宿主（面板页签行、状态栏胶囊悬停菜单）都只调 entryChooserOpen，
//      面板右端只剩紫入口与「+ bug」两颗（data-priority 2 与 1，没有 3），不再有蓝按钮。
//   2) 浮层只有一份：两处都挂同一个 EntryChooser 组件；选卡后的开场白拼装（newWayfinderText /
//      newSpecText + 会话标题）只住 kernel/entry-choice.ts，宿主一处都不许自己拼。
//   3) 卡面文案只住 config/copy/cards.yaml：浮层标题、两张卡的眉标 / 状态句 / 主体文本、脚注、
//      技能链标签都在 YAML，客户端源码里搜不到这些句子（只留 card.entry.* 键名）。
//   4) 卡面形状：368×232，主体文本最多三行、每行不超过 12 个汉字（按词断行，标点后优先断）；
//      探索地图的技能链左侧按原型的位置起画，分叉的两段落差都留 6px 才画得出箭头
//      （箭头三角占 3.4px，只留 2px 时三角会整根压在竖干和盒子左边框上）；
//      四个并行步骤的右沿外侧用一个 `}` 形花括号汇总进「目标明确」，不再用斜线扇形加圆点。
//   5) 词表：#1297 删掉 panel.newSpec / nav.takeableSpec；两句入口悬停提示合成一句「点一下弹出两张卡」。
//   6) 构建接线：index.ts 两个 kernel 标记都排在 leaf:tabs / leaf:statusBar 之前，build.mts 登记两片。
//   7) 两条路：探索卡 → /wayfinder，实施卡 → /grill-with-docs，且实施卡收尾提醒 /to-spec 与 /to-tickets。
//   8) 日志：entry.open / entry.pick 两个事件的埋点在 entry-choice.ts（字段与计数由 verify-log-* 守）。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1297-entry.ts
const fs = require('node:fs')
const path = require('node:path')
const { sourceText } = require('./lib/source-text.ts')
const promptConfig = require('../scripts/lib/prompt-config.mts')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const cardsYaml = read('config/copy/cards.yaml')
const panelYaml = read('config/copy/panel.yaml')
const specYaml = read('config/copy/spec.yaml')
const tabs = sourceText('src/client/views/shared/Tabs.ts')
const bar = sourceText('src/client/statusbar/StatusBar.ts')
const entryChoice = sourceText('src/client/kernel/entry-choice.ts')
const entryCard = sourceText('src/client/kernel/entry-card.ts')
const index = sourceText('src/client/index.ts')
const buildScript = read('scripts/build.mts')
const art = require('../src/client/kernel/entry-card.ts')

// 1) 只有一个入口：两处宿主都只调 entryChooserOpen，面板右端只剩两颗按钮
check(tabs.indexOf("entryChooserOpen(s, 'panel'") >= 0, '面板页签行的紫入口调 entryChooserOpen(…, panel)')
check(bar.indexOf("entryChooserOpen(s, 'statusbar'") >= 0, '状态栏胶囊悬停菜单调 entryChooserOpen(…, statusbar)')
check((tabs.match(/'data-priority': 2/g) || []).length === 1 && (tabs.match(/'data-priority': 1/g) || []).length === 1, '面板右端恰好两颗：紫入口 data-priority 2、+ bug data-priority 1')
check(tabs.indexOf("'data-priority': 3") < 0, '面板右端没有第三颗（原来那颗蓝入口的 priority 3 已删）')
check(tabs.indexOf('newSpecText') < 0 && bar.indexOf('newSpecText') < 0, '两处宿主都不再自己引用 newSpecText')
check(tabs.indexOf("tr('panel.newSpec')") < 0 && bar.indexOf("tr('nav.takeableSpec')") < 0, '两处宿主都不再引用蓝入口词条')
check(tabs.indexOf("Ic({ n: 'chev-down'") >= 0, '紫入口带一个向下的小箭头（暗示点开有浮层）')

// 2) 浮层只有一份：两处挂同一个组件，选卡拼装只住 entry-choice.ts
check((tabs.match(/h\(EntryChooser/g) || []).length === 1 && (bar.match(/h\(EntryChooser/g) || []).length === 1, '两处宿主挂的是同一个 EntryChooser 组件')
check(tabs.indexOf("from: 'panel'") >= 0 && bar.indexOf("from: 'statusbar'") >= 0, '两处宿主各自自报 from，浮层据此只画当时打开它的那一层')
check(entryChoice.indexOf("String(st.entryFrom) === hostFrom") >= 0, 'entry-choice.ts 按 entryFrom 与宿主 from 相同才画，避免两处同时画两层')
check(entryChoice.indexOf('export const EntryChooser') >= 0 && entryChoice.indexOf('export const entryChooserOpen') >= 0 && entryChoice.indexOf('export const entryChooserClose') >= 0, 'entry-choice.ts 导出 EntryChooser / entryChooserOpen / entryChooserClose')
check(entryChoice.indexOf('newWayfinderText(st)') >= 0 && entryChoice.indexOf('newSpecText(st)') >= 0, '两张卡的开场白都在这一个文件里拼（探索 / 实施）')
check(entryChoice.indexOf("newSessionTitleNew(card === 'map' ? 'requirement' : 'spec')") >= 0, '两张卡的会话标题也在这一个文件里配好')
check(entryChoice.indexOf('ENTRY_CHOOSER_WIDTH = 392') >= 0, '面板那一处竖排两张卡的浮层宽 392（卡片 368 加左右各 12 的内边距）')
check(entryChoice.indexOf('ENTRY_CHOOSER_WIDE = 769') >= 0, '状态栏那一处横排两张卡的浮层宽 769（两张 368 的卡 + 卡间隙 9 + 左右内边距各 12）')
check(entryChoice.indexOf("flexDirection: horizontal ? 'row' : 'column'") >= 0, '状态栏横排（探索在左、实施在右），面板竖排（探索在上、实施在下）')
check(entryChoice.indexOf('rect.left') >= 0 && entryChoice.indexOf('vp.w - width - 8') >= 0, '左右先与触发按钮左沿对齐，右边放不下时把浮层右沿顶到屏幕右沿')
check(entryChoice.indexOf('top: Math.round(bottom + 6)') >= 0 && entryChoice.indexOf('bottom: Math.max(8, Math.round(vp.h - top + 6))') >= 0, '面板从按钮下方弹出、状态栏从按钮上方弹出')

// 3) 卡面文案只住 YAML：客户端源码里搜不到这些句子
const COPY = [
  '这条需求，你现在能说清要做什么吗？',
  '探索地图', '实施地图',
  '目标大而模糊', '目标明确清晰',
  '想清楚了要做什么，没想清楚细节，也没想清楚做到什么程度。',
  '要做什么、细节和做到什么程度都想清楚了，还没写成规格。',
  '目标明确',
]
for (const s of COPY) {
  check(cardsYaml.indexOf(s) >= 0, 'card.entry.* 里有这句文案：' + s)
}
const srcFiles = []
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name
    if (e.isDirectory()) walk(rel)
    else if (e.isFile() && e.name.endsWith('.ts') && e.name !== 'locale-data.ts' && e.name !== 'prompt-data.ts') srcFiles.push(rel)
  }
}
walk('src')
// 卡面文案的泄漏检查只看「客户端运行时会用到的源码」：先把注释剥掉（注释里写「探索地图」这类
// 概念词是给人读的，不是硬写一份卡面文案），再扫字符串。生成物 locale-data.ts 是 YAML 的产物，跳过。
const clientFiles = srcFiles.filter((rel) => rel.indexOf('src/client/') === 0)
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
const srcBlob = clientFiles.map((rel) => stripComments(read(rel))).join('\n')
const leaked = COPY.filter((s) => srcBlob.indexOf(s) >= 0)
check(leaked.length === 0, '卡面文案没有漏进客户端源码（漏进：' + (leaked.join('、') || '无') + '）')
check(entryCard.indexOf('card.entry.explore.body') >= 0 && entryCard.indexOf('card.entry.impl.body') >= 0, '卡面正文读的是 card.entry.* 键名')
check(cardsYaml.indexOf('card.entry.close') >= 0, '关闭按钮的无障碍文案也走词表（card.entry.close）')
check(cardsYaml.split('card.entry.').length - 1 === 36, 'card.entry.* 中英各 18 个键（共 36 行）')

// 4) 卡面形状：368×232；主体文本最多三行、每行不超过 12 个汉字
check(art.ENTRY_CARD_W === 368 && art.ENTRY_CARD_H === 232, '卡面 368×232')
check(typeof art.entryBodyLines === 'function', 'entry-card.ts 导出 entryBodyLines（供这条门禁核对断行）')
const bodyZh = [
  '想清楚了要做什么，没想清楚细节，也没想清楚做到什么程度。',
  '要做什么、细节和做到什么程度都想清楚了，还没写成规格。',
]
for (const body of bodyZh) {
  const lines = art.entryBodyLines(body)
  const tooMany = lines.length > 3
  const tooWide = lines.some((line) => line.length > 12)
  check(!tooMany && !tooWide, '主体文本 ≤3 行且每行 ≤12 个汉字：' + body + '（实际 ' + lines.length + ' 行：' + lines.join(' / ') + '）')
}
check(entryCard.indexOf('function chainBrace') >= 0, '并行技能汇总处画的是 } 形花括号（尖朝「目标明确」）')
check(entryCard.indexOf('chainMergeFan') < 0, '汇总处不再画斜线扇形加圆点（已还原成花括号）')
check(entryCard.indexOf('const wayX = 22') >= 0 && entryCard.indexOf('const startX = 26') >= 0, '探索地图链从左边距 22 起画（比实施链略左，因为 /wayfinder 盒子更宽）、实施链从 26 起画')
check(entryCard.indexOf('const gx = sx + 6') >= 0, '分叉线上每一行都留出 6px 才画箭头（箭头三角占 3.4px，只留 2px 时三角整根压在竖干和盒边上）')

// 5) 词表：删掉蓝入口的两个键，两句悬停提示合成一句
check(specYaml.indexOf('panel.newSpec') < 0 && specYaml.indexOf('nav.takeableSpec') < 0, 'panel.newSpec / nav.takeableSpec 已从词表删掉')
check(panelYaml.indexOf('panel.newWayfinderTitle: 点一下弹出两张卡') >= 0 && panelYaml.indexOf('nav.takeableNewTitle: 点一下弹出两张卡') >= 0, '面板与状态栏两处入口的悬停提示合成同一句')
check(panelYaml.indexOf('Opens two cards') >= 0, '合并后的悬停提示有英文版')
check(srcBlob.indexOf('写规格') < 0 && srcBlob.indexOf('Write Spec') < 0, '源码里搜不到旧卡名（写规格 / Write Spec）')

// 6) 构建接线：kernel 标记顺序与 build.mts 登记
const iEntryCard = index.indexOf('kernel:entryCard (spliced by build)')
const iEntryChoice = index.indexOf('kernel:entryChoice (spliced by build)')
const iRouter = index.indexOf('kernel:router (spliced by build)')
const iTabs = index.indexOf('leaf:tabs (spliced by build)')
const iBar = index.indexOf('leaf:statusBar (spliced by build)')
check(iRouter >= 0 && iEntryCard > iRouter && iEntryChoice > iEntryCard, 'index.ts 里两片 kernel 标记接在 router 之后、且卡面画法在前')
check(iTabs > iEntryChoice && iBar > iEntryChoice, '两片 kernel 标记都排在 leaf:tabs / leaf:statusBar 之前（宿主拼进来时已经拿到组件）')
check(buildScript.indexOf('src/client/kernel/entry-card.ts') >= 0 && buildScript.indexOf('src/client/kernel/entry-choice.ts') >= 0, 'scripts/build.mts 的 KERNEL_MODULES 登记了这两片')
check(buildScript.indexOf("name: 'entryCard'") >= 0 && buildScript.indexOf("name: 'entryChoice'") >= 0, '两片的标记名与 index.ts 对得上')

// 7) 两条路：探索卡走 /wayfinder，实施卡走 /grill-with-docs（收尾提醒 /to-spec 与 /to-tickets）
const promptData = promptConfig.readPromptConfig(ROOT)
function zhOf(id) {
  const spec = promptConfig.PROMPT_TEMPLATE_IDS.filter((t) => t.id === id)[0]
  return spec && promptData.templates[spec.family] ? String(promptData.templates[spec.family][id].zh || '') : ''
}
check(zhOf('newWayfinder').indexOf('/wayfinder\n请帮我处理一个需求') === 0, '探索地图卡的提示词首行 /wayfinder')
check(zhOf('newSpec').indexOf('/grill-with-docs\n请帮我讨论一个需求') === 0, '实施地图卡的提示词首行 /grill-with-docs')
check(zhOf('newSpec').indexOf('/to-spec') >= 0 && zhOf('newSpec').indexOf('/to-tickets') >= 0, '实施地图卡收尾提示 /to-spec 与 /to-tickets')
check(entryChoice.indexOf("card === 'map' ? newWayfinderText") >= 0 || (entryChoice.indexOf("newWayfinderText(st)") >= 0 && entryChoice.indexOf("newSpecText(st)") >= 0), '选卡后按卡种分流到两条路（不自动分流）')

// 8) 日志：两个事件的埋点在 entry-choice.ts
check(entryChoice.indexOf("log('info', 'entry.open'") >= 0 && entryChoice.indexOf('{ from: src, cards: ENTRY_CARDS.length }') >= 0, '打开浮层记 entry.open（from、cards 两张卡）')
check(entryChoice.indexOf("log('info', 'entry.pick'") >= 0 && entryChoice.indexOf('textLen:') >= 0, '选卡记 entry.pick（from、card、ok、textLen）')
check(entryChoice.indexOf("log('warn', 'entry.pick'") >= 0, '选卡失败档记 warn 级 entry.pick（ok:false）')

console.log('')
console.log(failed ? ('失败 ' + total + ' 条断言') : ('全部通过：' + total + ' 条断言'))
process.exit(failed ? 1 : 0)
