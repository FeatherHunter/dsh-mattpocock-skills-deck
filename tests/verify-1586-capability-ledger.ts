// verify-1586-capability-ledger.ts — 版本管理页能力账本门禁（规格 #1586 / 票 #1737 的 T02）
// 门禁归属: src/shared/version-control/src/capability-ledger.ts
// 门禁归属: scripts/generate-1586-capability-ledger.mts
//
// 守什么：规格 #1586 第 11 节 162 条能力矩阵的单一数据源。界面、命令面板、覆盖验收与测试都从
// src/shared/version-control/src/capability-ledger.ts 读；谁在别处再抄一份 id、名称、命令原文或统计
// 数字，或者手改生成出来的账本，这里当场判红。
//
// 断言分四组：
//   一 生成物新鲜：文件头带自动生成标记与来源脚本；生成器的 --check 必须过；生成器渲染结果与提交的
//      文件逐字一致（手改一个字就对不上）。
//   二 账本形状：162 条、能力号唯一且与域号一致、级别/落点/终局枚举合法、三组分布与规格数一致、
//      16 个页面与主入口一一对应且没有空页、命令原文保留、研究依据与域号一致、最低版本与替代路径
//      按规格第 6 节与第 11 节后的替代路径说明逐条对齐。
//   三 单一数据源的用法：capabilities.ts 的版本可用性纯函数从账本读最低版本与替代说明。
//   四 反证组（test-the-test）：把账本副本改坏（删条、重复号、越界枚举、计数变化、清空命令、改错
//      页面、改错版本、多写替代路径、清空依据），同一套判据必须逐条判红；把生成头改掉，生成物判据
//      必须判红。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-capability-ledger.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync } = require('child_process')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const LEDGER_REL = 'src/shared/version-control/src/capability-ledger.ts'
const GENERATOR_REL = 'scripts/generate-1586-capability-ledger.mts'
const GATE = 'verify-1586-capability-ledger'

let failed = false
let failedCount = 0
let total = 0
const check = (ok, msg) => { total += 1; if (!ok) failedCount += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const LEVELS = ['读', '写', '毁', '改写', '非 git']
const PLACEMENTS = ['直', '折', '诊', '外']
const FINAL_FORMS = ['操作', '只读', '说明']
const PAGE_KINDS = ['页签', '管理分区', '二级页', '全局面']
const FLOOR = '2.11'
const GATED_IDS = ['1.5', '1.6', '1.7', '4.2', '4.3', '4.4', '5.9', '6.10', '7.3', '8.12', '9.4', '9.5', '9.6', '9.7', '9.8', '11.8', '11.9', '11.10', '12.6']
const MIN_VERSIONS = {
  '1.5': '2.23', '1.6': '2.23', '1.7': '2.23',
  '4.2': '2.23', '4.3': '2.23', '4.4': '2.23',
  '5.9': '2.38', '6.10': '2.38', '7.3': '2.35', '8.12': '2.30',
  '9.4': '2.17', '9.5': '2.31', '9.6': '2.31', '9.7': '2.17', '9.8': '2.25',
  '11.8': '2.30', '11.9': '2.18', '11.10': '2.21', '12.6': '2.36',
}
const PANEL_IDS = ['2.7', '5.11', '6.7', '6.9', '13.14']
const KNOWN_COMMANDS = {
  '1.1': 'git status --porcelain=v2 --branch -z',
  '1.2': 'git add -p（面板等价于读 diff 后 apply --cached）',
  '1.12': 'gitignore + git check-ignore -v',
  '2.7': 'git commit（不带 -m）',
  '6.7': '外部编辑器',
  '6.11': '--continue（merge / rebase / cherry-pick / revert / am 共用）',
  '8.12': 'git push --force-with-lease',
  '11.15': 'scalar',
  '12.5': 'githooks + core.hooksPath',
  '13.14': 'gitk',
  '14.2': 'git send-email',
  '14.4': '',
}
const EXTERNAL_COMMAND_PREFIXES = ['gitignore ', '外部编辑器', 'scalar', 'githooks ', 'gitk', '--']

const countBy = function (list, key) {
  const out = {}
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1
  return out
}
const countsMatch = function (list, key, expected) {
  const got = countBy(list, key)
  const names = Object.keys(expected)
  if (Object.keys(got).length !== names.length) return false
  for (const name of names) if (got[name] !== expected[name]) return false
  return true
}
const sameJson = function (a, b) { return JSON.stringify(a) === JSON.stringify(b) }
const sortedCopy = function (list) { return list.slice().sort() }
const versionParts = function (text) { return String(text).split('.').map(Number) }
const versionAtLeast = function (text, floor) {
  const a = versionParts(text)
  const b = versionParts(floor)
  if (a[0] !== b[0]) return a[0] > b[0]
  if (a[1] !== b[1]) return a[1] > b[1]
  return (a[2] || 0) >= (b[2] || 0)
}

// 账本形状判据：真账本必须一条问题都没有；反证组把副本改坏，这里必须报出问题。
const problemsOf = function (list, ledger) {
  const problems = []
  if (!Array.isArray(list) || list.length !== 162) problems.push('总数不是 162')
  if (!Array.isArray(list)) return problems
  if (new Set(list.map((c) => c.id)).size !== list.length) problems.push('能力号不唯一')
  if (!list.every((c) => /^([1-9]|1[0-4])\.\d+$/.test(c.id) && Number(c.id.split('.')[0]) === c.domain)) problems.push('能力号形状或与域号不一致')
  if (Object.keys(ledger.DOMAIN_NAMES).length !== 14) problems.push('域不是 14 个')
  if (!list.every((c) => ledger.DOMAIN_NAMES[c.domain] === c.domainName)) problems.push('域中文名与域号表不一致')
  if (!list.every((c) => LEVELS.indexOf(c.level) >= 0)) problems.push('级别有表外取值')
  if (!list.every((c) => PLACEMENTS.indexOf(c.placement) >= 0)) problems.push('落点有表外取值')
  if (!list.every((c) => FINAL_FORMS.indexOf(c.finalForm) >= 0)) problems.push('终局有表外取值')
  if (!list.every((c) => c.versionPolicy === null || c.versionPolicy === 'degrade' || c.versionPolicy === 'hide')) problems.push('版本策略有表外取值')
  if (!countsMatch(list, 'level', ledger.LEVEL_COUNTS)) problems.push('级别分布与常量不一致')
  if (!countsMatch(list, 'placement', ledger.PLACEMENT_COUNTS)) problems.push('落点分布与常量不一致')
  if (!countsMatch(list, 'finalForm', ledger.FINAL_FORM_COUNTS)) problems.push('终局计数与常量不一致')
  if (!list.every((c) => ledger.PRIMARY_ENTRY_PAGE[c.primaryEntry] === c.page)) problems.push('页面与主入口映射不一致')
  if (!countsMatch(list, 'page', ledger.PAGE_COUNTS)) problems.push('各页面条数与常量不一致')
  if (!list.every((c) => typeof c.command === 'string')) problems.push('命令原文不是字符串')
  const emptyCommands = sortedCopy(list.filter((c) => c.command === '').map((c) => c.id))
  if (!sameJson(emptyCommands, ['14.4', '14.5', '14.6', '14.7', '14.8'])) problems.push('命令为空的不是 14.4-14.8 恰好五行')
  if (!list.every((c) => c.command === '' || c.command.indexOf('git ') === 0 || EXTERNAL_COMMAND_PREFIXES.some((p) => c.command.indexOf(p) === 0))) problems.push('有非 git 开头的命令不在已知外部命令清单里')
  for (const id of Object.keys(KNOWN_COMMANDS)) {
    const row = list.filter((c) => c.id === id)[0]
    if (!row || row.command !== KNOWN_COMMANDS[id]) problems.push('能力 ' + id + ' 的命令原文被改动')
  }
  if (!list.every((c) => typeof c.researchBasis === 'string' && /^1588 §2-域\d+/.test(c.researchBasis))) problems.push('研究依据为空或形状不对')
  if (!list.every((c) => {
    const m = typeof c.researchBasis === 'string' ? /^1588 §2-域(\d+)/.exec(c.researchBasis) : null
    return m !== null && Number(m[1]) === c.domain
  })) problems.push('研究依据里的域号与能力域不一致')
  const panels = sortedCopy(list.filter((c) => c.panelPath !== null).map((c) => c.id))
  if (!sameJson(panels, sortedCopy(PANEL_IDS))) problems.push('面板替代路径不是固定的五条')
  if (!list.every((c) => c.panelPath === null || (typeof c.panelPath === 'string' && c.panelPath.length > 0))) problems.push('替代路径写成空串')
  const gated = sortedCopy(list.filter((c) => c.minVersion !== FLOOR).map((c) => c.id))
  if (!sameJson(gated, sortedCopy(GATED_IDS))) problems.push('被版本限制的能力号集合与规格第 6 节不一致')
  if (!list.every((c) => typeof c.minVersion === 'string')) problems.push('最低版本不是字符串')
  for (const id of GATED_IDS) {
    const row = list.filter((c) => c.id === id)[0]
    if (!row) continue
    if (row.minVersion !== MIN_VERSIONS[id]) problems.push('能力 ' + id + ' 的最低版本应为 ' + MIN_VERSIONS[id])
    if ((row.versionPolicy !== 'degrade' && row.versionPolicy !== 'hide') || typeof row.versionAlternative !== 'string' || row.versionAlternative.length === 0) problems.push('能力 ' + id + ' 缺版本策略或替代说明')
  }
  if (!list.every((c) => c.minVersion !== FLOOR || (c.versionPolicy === null && c.versionAlternative === null))) problems.push('2.11 底线内的能力不该带版本策略或替代说明')
  return problems
}

async function main() {
  console.log('版本管理页能力账本门禁（规格 #1586 第 11 节：162 条单一数据源 + 生成物对账 + 反证组）')
  const fileText = fs.readFileSync(path.join(ROOT, LEDGER_REL), 'utf8')
  const ledger = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'capability-ledger.js')).href)
  const caps = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'capabilities.js')).href)
  const generator = await import(pathToFileURL(path.join(ROOT, GENERATOR_REL)).href)

  // ---- 一、生成物新鲜：文件头、--check、渲染结果逐字一致 ----
  const headerOk = function (text) {
    return text.indexOf('// AUTO-GENERATED') === 0
      && text.indexOf('scripts/generate-1586-capability-ledger.mts') >= 0
      && text.indexOf('#1586') >= 0
      && text.indexOf('不要手改') >= 0
  }
  check(headerOk(fileText), '账本文件头带自动生成标记与来源脚本（#1586 与生成器路径），并写明不要手改')
  const tryCheck = spawnSync(process.execPath, [path.join(ROOT, GENERATOR_REL), '--check'], { cwd: ROOT, encoding: 'utf8' })
  check(tryCheck.status === 0, '生成器 --check 通过（提交的账本与生成器数据表一致；对不上时输出：' + String(tryCheck.stdout || '').trim() + '）')
  const rendered = generator.renderLedger()
  check(typeof rendered === 'string' && rendered === fileText, '生成器 renderLedger() 渲染结果与被提交的账本逐字一致（手改一个字就对不上）')
  const handEdited = rendered.replace('export const CAPABILITY_TOTAL = 162', 'export const CAPABILITY_TOTAL = 163')
  check(typeof rendered === 'string' && handEdited !== rendered, '反证：手改一个字后渲染结果与文件不再一致（新鲜度判据拦得住）')
  check(headerOk(fileText.replace('// AUTO-GENERATED', '// 人手维护')) === false, '反证：把生成头改掉后，生成物判据必须判红')

  // ---- 二、账本形状（逐条对齐规格 #1586 第 11 节矩阵与第 6 节版本条款） ----
  const list = ledger.CAPABILITIES
  check(Array.isArray(list) && list.length === 162 && ledger.CAPABILITY_TOTAL === 162, '能力表总共 162 条（导出常量与数组长度一致）')
  check(Array.isArray(list) && new Set(list.map((c) => c.id)).size === list.length, '162 个能力号互不重复')
  check(Array.isArray(list) && list.every((c) => /^([1-9]|1[0-4])\.\d+$/.test(c.id) && Number(c.id.split('.')[0]) === c.domain), '能力号形如 域号.序号，且与 domain 字段一致')
  const expectedDomains = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  check(Object.keys(ledger.DOMAIN_NAMES).length === 14 && expectedDomains.every((d) => list.some((c) => c.domain === d))
    && list.every((c) => ledger.DOMAIN_NAMES[c.domain] === c.domainName), '14 个域都有能力，且域中文名与域号表一致')
  check(sameJson(ledger.LEVEL_COUNTS, { '读': 48, '写': 83, '毁': 15, '改写': 11, '非 git': 5 }) && countsMatch(list, 'level', ledger.LEVEL_COUNTS),
    '级别分布：读 48 / 写 83 / 毁 15 / 改写 11 / 非 git 5，且导出常量与实测一致')
  check(sameJson(ledger.PLACEMENT_COUNTS, { '直': 42, '折': 62, '诊': 34, '外': 24 }) && countsMatch(list, 'placement', ledger.PLACEMENT_COUNTS),
    '落点分布：直 42 / 折 62 / 诊 34 / 外 24，且导出常量与实测一致')
  check(sameJson(ledger.FINAL_FORM_COUNTS, { '操作': 119, '只读': 36, '说明': 7 }) && countsMatch(list, 'finalForm', ledger.FINAL_FORM_COUNTS),
    '终局计数：操作 119 / 只读 36 / 说明 7，且导出常量与实测一致')
  check(list.every((c) => LEVELS.indexOf(c.level) >= 0) && list.every((c) => PLACEMENTS.indexOf(c.placement) >= 0) && list.every((c) => FINAL_FORMS.indexOf(c.finalForm) >= 0),
    '级别 / 落点 / 终局都是合法枚举，没有表外取值')
  check(list.every((c) => c.versionPolicy === null || c.versionPolicy === 'degrade' || c.versionPolicy === 'hide'), '版本策略只有 degrade / hide / null 三种')
  check(ledger.PAGE_SURFACES.length === 16 && new Set(ledger.PAGE_SURFACES.map((p) => p.id)).size === 16 && ledger.PAGE_SURFACES.every((p) => PAGE_KINDS.indexOf(p.kind) >= 0),
    '16 个页面，页面 id 唯一、类型合法（页签 / 管理分区 / 二级页 / 全局面）')
  const entries = Object.keys(ledger.PRIMARY_ENTRY_PAGE)
  check(entries.length === 16 && entries.every((e) => list.some((c) => c.primaryEntry === e)) && list.every((c) => ledger.PRIMARY_ENTRY_PAGE[c.primaryEntry] === c.page),
    '主入口恰好 16 个、每个都有能力，且每条能力的页面与主入口映射一致')
  check(countsMatch(list, 'page', ledger.PAGE_COUNTS), '各页面条数与 PAGE_COUNTS 实测一致')
  check(ledger.PAGE_SURFACES.every((p) => (ledger.PAGE_COUNTS[p.id] || 0) > 0), '没有空页：每个页面至少落了一条能力')
  check(list.filter((c) => c.command !== '').length === 157 && sameJson(sortedCopy(list.filter((c) => c.command === '').map((c) => c.id)), ['14.4', '14.5', '14.6', '14.7', '14.8']),
    '157 条有命令原文；命令为空的恰好是 14.4-14.8 五条平台与邮件边界')
  let knownCommandsOk = true
  for (const id of Object.keys(KNOWN_COMMANDS)) {
    const row = list.filter((c) => c.id === id)[0]
    if (!row || row.command !== KNOWN_COMMANDS[id]) knownCommandsOk = false
  }
  check(knownCommandsOk, '命令原文保留：抽查 12 条逐字相同（含 git commit（不带 -m）、外部编辑器、gitk、scalar 等特殊行）')
  check(list.every((c) => c.command === '' || c.command.indexOf('git ') === 0 || EXTERNAL_COMMAND_PREFIXES.some((p) => c.command.indexOf(p) === 0)),
    '非空命令要么以 git 开头，要么是已知的外部命令（不自造命令原文）')
  check(list.every((c) => typeof c.researchBasis === 'string' && /^1588 §2-域\d+/.test(c.researchBasis)), '每条能力都有研究依据，形如 1588 §2-域N')
  check(list.every((c) => Number(/^1588 §2-域(\d+)/.exec(c.researchBasis)[1]) === c.domain), '研究依据里的域号与该能力的域号一致')
  check(sameJson(sortedCopy(list.filter((c) => c.panelPath !== null).map((c) => c.id)), sortedCopy(PANEL_IDS)), '面板替代路径恰好五条：2.7 / 5.11 / 6.7 / 6.9 / 13.14')
  check(list.filter((c) => c.panelPath !== null).every((c) => typeof c.panelPath === 'string' && c.panelPath.length > 0), '五条替代路径都写清了面板里的做法')
  check(list.every((c) => typeof c.minVersion === 'string' && /^\d+\.\d+(\.\d+)?$/.test(c.minVersion) && versionAtLeast(c.minVersion, FLOOR)),
    '每条能力都有最低版本，且不低于 2.11 硬底线')
  check(sameJson(sortedCopy(list.filter((c) => c.minVersion !== FLOOR).map((c) => c.id)), sortedCopy(GATED_IDS)), '被版本限制的能力恰好 19 条，能力号集合与规格第 6 节一致')
  check(list.filter((c) => c.minVersion !== FLOOR).every((c) => c.versionPolicy === 'degrade' || c.versionPolicy === 'hide')
    && list.filter((c) => c.minVersion !== FLOOR).every((c) => typeof c.versionAlternative === 'string' && c.versionAlternative.length > 0),
    '19 条被限制的能力都写了降级/隐藏策略与替代说明（隐藏不等于沉默）')
  check(list.every((c) => c.minVersion === FLOOR || c.minVersion === MIN_VERSIONS[c.id]), '19 条的最低版本与规格第 6 节的已知版本条款逐条一致')
  check(list.every((c) => c.minVersion !== FLOOR || (c.versionPolicy === null && c.versionAlternative === null)), '2.11 底线内的能力不带版本策略与替代说明（没有多余的隐藏）')
  check(ledger.CAPABILITY_LEDGER_SOURCE === LEDGER_REL, '账本给出自己的仓库相对路径 CAPABILITY_LEDGER_SOURCE')
  const shapeProblems = problemsOf(list, ledger)
  check(shapeProblems.length === 0, '账本形状判据汇总一条问题都没有' + (shapeProblems.length ? ' —— 问题：' + shapeProblems.join('；') : ''))

  // ---- 三、单一数据源的用法：版本可用性直接读账本 ----
  const restoreRow = list.filter((c) => c.id === '1.5')[0]
  const availability = typeof caps.capabilityAvailability === 'function' ? caps.capabilityAvailability(restoreRow, '2.22.1') : null
  check(!!availability && availability.state === 'degraded' && availability.needed === '2.23'
    && availability.alternative === restoreRow.versionAlternative,
    '版本可用性纯函数直接读账本的 minVersion 与替代说明（不在别处另抄一份版本表）')

  // ---- 四、反证组：把账本副本改坏，同一套判据必须判红 ----
  const mutate = function (fn) {
    const copy = list.map((c) => Object.assign({}, c))
    fn(copy)
    return copy
  }
  const reverseCases = [
    ['删掉一条（总数不再是 162）', mutate((l) => l.pop())],
    ['把两条改成同一个能力号（能力号不再唯一）', mutate((l) => { l[l.length - 1].id = l[0].id })],
    ['把一条的级别改成表外取值', mutate((l) => { l[0].level = '看' })],
    ['把一条终局从说明改成操作（终局计数对不上）', mutate((l) => { l.filter((c) => c.finalForm === '说明')[0].finalForm = '操作' })],
    ['把一条的命令原文清空（命令原文必须保留）', mutate((l) => { l[0].command = '' })],
    ['把一条的页面改错（页面与主入口映射对不上）', mutate((l) => { l[0].page = 'commits' })],
    ['把一条被版本限制的能力改成 2.11（版本表对不上）', mutate((l) => { l.filter((c) => c.id === '13.14')[0].minVersion = '2.30' })],
    ['给一条不该有替代路径的能力补一条（替代路径集合变多）', mutate((l) => { l[0].panelPath = '随手补的替代路径' })],
    ['把一条的研究依据清空', mutate((l) => { l[0].researchBasis = '' })],
  ]
  for (const item of reverseCases) {
    const issues = problemsOf(item[1], ledger)
    check(issues.length > 0, '反证：' + item[0] + ' → 判据必须判红' + (issues.length ? '（' + issues.join('；') + '）' : '（没红，判据漏了）'))
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过') + ' — 能力账本门禁（' + total + ' 项断言）')
  printGateResult(GATE, total, failedCount)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
