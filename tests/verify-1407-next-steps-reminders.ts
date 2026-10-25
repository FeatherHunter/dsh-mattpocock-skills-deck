// tests/verify-1407-next-steps-reminders.ts —— #1407 门禁：20 个注入模板各带一行「推荐下一步」提醒、17 处 /retro 提醒行已删掉
// 门禁归属: config/prompts/ticket-action-templates.yaml
// 门禁归属: config/prompts/ticket-creation.yaml
// 门禁归属: config/prompts/map-advancement.yaml
// 门禁归属: config/prompts/workspace-initialization.yaml
// 门禁归属: config/prompts/repository-alignment.yaml
//
// 为什么要有这一扇门禁（#1407）：
//   规格 #1397 要让模型在恰当的时候调用 suggest_next_steps 推荐下一步，做法是在带「## 工具」章节的
//   注入提示词模板里各加一行提醒；同时把和 /ask-matt 重复的 /retro 提醒行删掉。这两件事都容易只做一半：
//   加漏一条、删了中文忘了英文，或者顺手把一份本来不该动的模板也改了。所以这里按模板逐条数，
//   缺一条判红、多一条也判红，负向自检见文件末尾（把真数据改坏，看判据会不会跟着红）。
//
// 判据（对应票 #1407 的验收标准）：
//   ① 名单里 20 个模板的中英正文各恰有一行提醒，且这行是「## 工具」/「## Tools」节的最后一条；
//   ② 这 20 个模板的版本号都抬到了 #1407 之后的下限（版本只许升不许降，所以判 ≥ 而不是判等于）；
//   ③ 原来在「## 收尾」里带 /retro 提醒行的 17 个模板，中英正文里都不再出现 /retro；
//   ④ 五份族 YAML 的所有模板正文里都不再出现 /retro 提醒行（防止换个模板又把重复提醒加回去）；
//   ⑤ 本来就不带工具节的 workspace-initialization 与 repository-alignment，一条提醒都不许有；
//   ⑥ 带「## 工具」章节的模板集合恰好就是名单里这 20 个（漏写或多写都红）。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1407-next-steps-reminders.ts
const path = require('node:path')
const { printGateResult } = require('./lib/gate-result.ts')
const promptConfig = require('../scripts/lib/prompt-config.mts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1407-next-steps-reminders'

// 提醒行的两份原文：字面照 #1407 验收标准写，中英各一行；下面所有判据都从这里取，别在别处再抄一遍。
const REMINDER_ZH = '- [ ] 回复前最后一步，结合当下实际场景 按 /ask-matt 的规则，判断是否可以推荐当前最适合的技能，并且调用 suggest_next_steps 工具 进行推荐。'
const REMINDER_EN = '- [ ] As the last step before replying, based on the current actual scenario and following the /ask-matt rules, determine whether the most suitable skill can be recommended, and call the suggest_next_steps tool to recommend it.'
const TOOLS_ZH = '## 工具'
const TOOLS_EN = '## Tools'

// 20 个要加提醒的模板（按族分组）与它们 #1407 之后的下限版本号。
// 为什么分族写：模板住哪一份 YAML 由注入时机决定（见 scripts/lib/prompt-config.mts 的 PROMPT_TEMPLATE_IDS），
// 族写错会当场对不上，这也顺带守住「三份 YAML 各改各的、别人不背锅」。
const TARGETS = {
  'ticket-action-templates': {
    'tpl.diagnose': 19,
    'tpl.discuss': 19,
    'tpl.execute': 19,
    'tpl.fix': 17,
    'tpl.implement': 4,
    'tpl.prototype': 13,
    'tpl.research': 13,
    'tpl.supplement': 7,
    'tpl.takeover': 10,
  },
  'ticket-creation': { newBugWayfinder: 15, newSpec: 4, newWayfinder: 23 },
  'map-advancement': {
    complete: 16,
    fixate: 11,
    healthCheck: 5,
    mapExecute: 20,
    mapInspect: 12,
    specComplete: 6,
    specExecute: 5,
    specSplit: 5,
  },
}

// 原来带 /retro 提醒行的 17 个模板（#1269 立的那份名单就是这 17 个；#1407 把整行删掉）。
// 20 个目标模板里另外 3 个（tpl.diagnose / healthCheck / mapInspect）本来就没有这行，所以不在这张表里。
// 这张表用来按模板逐个数：17 个都删干净，才算「17 处已删」。
const RETRO_RETIRED = [
  'tpl.fix', 'tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.execute', 'tpl.takeover', 'tpl.supplement', 'tpl.implement',
  'mapExecute', 'complete', 'newWayfinder', 'newBugWayfinder', 'fixate',
  'newSpec', 'specSplit', 'specExecute', 'specComplete',
]

// 两份不带工具节、也不该加提醒的模板族（#1407 验收标准点名 workspace-initialization 与 repository-alignment）。
const NO_REMINDER_FAMILIES = ['workspace-initialization', 'repository-alignment']

// 把正文切成去空白的行：判「恰好一行」「在工具节里」「是最后一条」都按行看，不按段落看。
function splitLines(text) {
  return String(text || '').split('\n').map(function (line) { return line.trim() })
}

// 一行提醒在正文里的位置判据：必须在指定章节里、恰好出现一次、且是该节的最后一条。
// 返回空串表示合格，否则返回一句人话说明差在哪（判红时直接打给人看，不用再猜）。
function reminderPlacementIssue(text, heading, bullet) {
  const lines = splitLines(text)
  const head = lines.indexOf(heading)
  if (head < 0) return '缺「' + heading + '」章节'
  let sectionEnd = lines.length
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].indexOf('## ') === 0) { sectionEnd = i; break }
  }
  const hits = []
  lines.forEach(function (line, i) { if (line === bullet) hits.push(i) })
  if (hits.length !== 1) return '提醒行出现 ' + hits.length + ' 次（要恰好 1 次）'
  const at = hits[0]
  if (at <= head || at >= sectionEnd) return '提醒行不在「' + heading + '」章节里'
  let last = -1
  for (let i = head + 1; i < sectionEnd; i++) { if (lines[i]) last = i }
  if (last !== at) return '提醒行不是「' + heading + '」章节的最后一条'
  return ''
}

// 把五份族 YAML 的模板展平成一张 id → 条目 的表，下面所有判据都按 id 找，不按族猜。
function flattenTemplates(templates) {
  const byId = {}
  Object.keys(templates).forEach(function (family) {
    const entries = templates[family] || {}
    Object.keys(entries).forEach(function (id) { byId[id] = entries[id] })
  })
  return byId
}

// 判据本体：输入一份模板表（真配置或负向自检里改坏的副本），按固定顺序产出每一行断言。
// 行数固定（81 行），负向自检靠同一份判据跑改坏的副本，所以判据只有一处，不会真假两份慢慢分家。
function evaluate(templates) {
  const rows = []
  const push = function (name, ok, why) { rows.push({ name: name, ok: !!ok, why: ok ? '' : String(why || '') }) }
  const byId = flattenTemplates(templates)

  // ①② 名单里每个模板：中文一行、英文一行、版本已抬到下限。
  Object.keys(TARGETS).forEach(function (family) {
    const ids = TARGETS[family]
    Object.keys(ids).forEach(function (id) {
      const entry = byId[id] || { zh: '', en: '', version: 0 }
      const zhIssue = reminderPlacementIssue(entry.zh, TOOLS_ZH, REMINDER_ZH)
      push(id + ' 中文正文在「## 工具」章节末尾恰有一行提醒', zhIssue === '', zhIssue)
      const enIssue = reminderPlacementIssue(entry.en, TOOLS_EN, REMINDER_EN)
      push(id + ' 英文正文在「## Tools」章节末尾恰有一行提醒', enIssue === '', enIssue)
      const min = ids[id]
      push(id + ' 的版本号已抬到 v' + min + ' 以上', Number(entry.version) >= min, '现在是 v' + entry.version + '（#1407 改了文案就该升 version）')
    })
  })

  // ③ 17 处 retro 提醒行按模板逐个判缺席：中英两边都不许再出现 /retro。
  RETRO_RETIRED.forEach(function (id) {
    const entry = byId[id] || { zh: '', en: '' }
    const sides = []
    if (String(entry.zh).indexOf('/retro') >= 0) sides.push('中文')
    if (String(entry.en).indexOf('/retro') >= 0) sides.push('英文')
    push(id + ' 中英正文都不再含 /retro 提醒行', sides.length === 0, sides.join('与') + '正文里还留着 /retro')
  })

  // ④ 全量兜底：五份族 YAML 的所有模板正文里都不许再有 /retro（防止换个模板把重复提醒加回去）。
  const stillRetro = Object.keys(byId).filter(function (id) {
    return String(byId[id].zh).indexOf('/retro') >= 0 || String(byId[id].en).indexOf('/retro') >= 0
  })
  push('五份族 YAML 的所有模板正文里都不再出现 /retro 提醒行', stillRetro.length === 0, '这些模板还带 /retro：' + stillRetro.join('、'))

  // ⑤ 两份不带工具节的模板族：一条 suggest_next_steps 提醒都不许有。
  NO_REMINDER_FAMILIES.forEach(function (family) {
    const entries = templates[family] || {}
    const bad = Object.keys(entries).filter(function (id) {
      const entry = entries[id] || {}
      return String(entry.zh).indexOf('suggest_next_steps') >= 0 || String(entry.en).indexOf('suggest_next_steps') >= 0
    })
    push(family + ' 的模板一条 suggest_next_steps 提醒都不带', bad.length === 0, '这些模板不该带提醒却带了：' + bad.join('、'))
  })

  // ⑥ 带工具节的模板集合恰好是名单里的 20 个：少一个说明有人漏加，多一个说明没想清楚就动了别的模板。
  const toolIds = Object.keys(byId).filter(function (id) { return splitLines(byId[id].zh).indexOf(TOOLS_ZH) >= 0 }).sort()
  const targetIds = []
  Object.keys(TARGETS).forEach(function (family) { Object.keys(TARGETS[family]).forEach(function (id) { targetIds.push(id) }) })
  targetIds.sort()
  const sameSet = toolIds.length === targetIds.length && toolIds.every(function (id, i) { return id === targetIds[i] })
  push('带「## 工具」章节的模板集合恰好是名单里这 20 个', sameSet, '实际带工具节的是 ' + toolIds.length + ' 个：' + toolIds.join('、'))

  return rows
}

// 负向自检：拿一份改坏的副本跑同一份判据，确认它有反应。判据要是对改坏也没反应，上面那些绿都不算数。
function evaluateMutated(templates, mutate) {
  const copy = JSON.parse(JSON.stringify(templates))
  mutate(copy)
  return evaluate(copy)
}
function hasFailedRow(rows, namePart) {
  return rows.some(function (row) { return !row.ok && row.name.indexOf(namePart) >= 0 })
}

const config = promptConfig.readPromptConfig(ROOT)
const rows = evaluate(config.templates)

let total = 0
let failedCount = 0
const check = function (ok, msg, why) {
  total += 1
  if (!ok) failedCount += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : '（' + String(why || '') + '）'))
}

rows.forEach(function (row) { check(row.ok, row.name, row.why) })

// 下面六条是负向自检：改坏一处，判据必须点名对应的那一条。这些行本身也是断言。
const noZhReminder = evaluateMutated(config.templates, function (t) {
  const entry = t['ticket-action-templates']['tpl.fix']
  entry.zh = splitLines(entry.zh).filter(function (line) { return line !== REMINDER_ZH }).join('\n')
})
check(hasFailedRow(noZhReminder, 'tpl.fix 中文正文'), '负向自检：抹掉 tpl.fix 的中文提醒行，判据会红')

const duplicateReminder = evaluateMutated(config.templates, function (t) {
  t['ticket-action-templates']['tpl.diagnose'].zh += '\n' + REMINDER_ZH
})
check(hasFailedRow(duplicateReminder, 'tpl.diagnose 中文正文'), '负向自检：给 tpl.diagnose 多加一行提醒，判据会红（多一条也算错）')

const retroBack = evaluateMutated(config.templates, function (t) {
  t['map-advancement']['specComplete'].zh += '\n- [ ] 当前会话的任务全部完成时，主动提醒用户执行一次 /retro'
})
check(hasFailedRow(retroBack, 'specComplete 中英正文都不再含 /retro'), '负向自检：把 /retro 提醒行加回 specComplete，判据会红')

const reminderInNoReminderFamily = evaluateMutated(config.templates, function (t) {
  t['workspace-initialization']['setupRun'].zh += '\n' + REMINDER_ZH
})
check(hasFailedRow(reminderInNoReminderFamily, 'workspace-initialization 的模板一条 suggest_next_steps 提醒都不带'), '负向自检：给 workspace-initialization 的模板加提醒，判据会红')

const oldVersion = evaluateMutated(config.templates, function (t) {
  t['map-advancement']['specSplit'].version = 1
})
check(hasFailedRow(oldVersion, 'specSplit 的版本号已抬到'), '负向自检：把 specSplit 的版本号降回 v1，判据会红')

const extraToolsSection = evaluateMutated(config.templates, function (t) {
  t['workspace-initialization']['setupRun'].zh += '\n\n## 工具\n- [ ] 多出来的工具节'
})
check(hasFailedRow(extraToolsSection, '带「## 工具」章节的模板集合恰好是名单里这 20 个'), '负向自检：给不该带工具节的模板加一节工具，集合判据会红')

console.log('')
console.log('断言 ' + total + ' 条里过了 ' + (total - failedCount) + ' 条')
printGateResult(GATE, total, failedCount)
process.exit(failedCount ? 1 : 0)
