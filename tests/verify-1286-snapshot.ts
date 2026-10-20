// tests/verify-1286-snapshot.ts —— #1286 规格（实施地图）容器：识别与组装的门禁
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1286-snapshot.ts，可独立运行。
//
// 断四件事：
//  ① 归一层：正文首行独占一行那串隐藏标记的票，认成规格（type='spec'）；普通票仍是普通票；
//     标记不在首行就不算（只认首行）。
//  ② 判定的红线：正文标记排最前 —— 既带标记又带 wayfinder:map 标签的票判成规格
//     （GLOSSARY.md「对象类型」词条：标记 → 标签 → 形状，标记是唯一真源）。
//  ③ 组装层：规格进容器数组、不进「未挂图票」那一份（漏了那处，列表页会出两行），
//     实施票挂到规格底下；探索地图的五个槽照旧，规格不填那五个槽。
//  ④ 规格容器带七段 sections，中英文标题都认。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail !== undefined && detail !== null ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }

/** 规格容器在正文首行的隐藏标记（与 contract/vocabulary.ts 的 SPEC_BODY_MARKER 同一串）。 */
const MARKER = '<!-- DSH-ISSUE-KIND: spec -->'

/** 一份写全的规格正文：七段各一段，后面几段各一行。 */
const SPEC_BODY = [
  MARKER,
  '',
  '## 问题陈述',
  '现在改一处规格要翻三个文件。',
  '',
  '## 解决方案',
  '把规格正文按七段切开存。',
  '',
  '## 用户故事',
  '- 作为作者，我要看到规格正文的第一段。',
  '',
  '## 实现决策',
  '- 容器共用一份数组。',
  '',
  '## 测试决策',
  '- 认出来的票要能被组装置顶。',
  '',
  '## 不在范围内',
  '- 不做写侧改造。',
  '',
  '## 补充说明',
  '- 标记只认首行。',
].join('\n')

/** 池里的一行：形状与归一层产出的 Issue 一致（组装层只读这几格）。 */
function row(key: string, type: string, title: string, body: string, parentKey: string | null): any {
  return {
    key: key, effortId: '', type: type, title: title, state: 'open', body: body,
    url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: parentKey,
    labels: [], assignees: [], comments: [], blockedBy: [],
  }
}

async function main() {
  console.log('#1286 门禁：规格（实施地图）容器的识别与组装')
  const gh = await import(pathToFileURL(path.join(ROOT, 'src/tracker/rooms/github/normalize.js')).href)
  const gl = await import(pathToFileURL(path.join(ROOT, 'src/tracker/rooms/gitlab/normalize.js')).href)
  const asm = await import(pathToFileURL(path.join(ROOT, 'src/host/tracker/snapshotAssemble.js')).href)
  const leaf = await import(pathToFileURL(path.join(ROOT, 'src/tracker/body-parse.js')).href)
  const assembleSnapshot = asm.assembleSnapshot

  // ① 识别：正文首行的隐藏标记
  const spec = gh.normalizeIssue({ number: 100, title: '规格', body: SPEC_BODY })
  check(spec.type === 'spec', '正文首行带隐藏标记的票认成规格（type=spec）', spec.type)
  const plain = gh.normalizeIssue({ number: 101, title: '普通票', body: '就是一段普通正文' })
  check(plain.type === 'issue', '普通票仍是普通票（type=issue）', plain.type)
  const notFirst = gh.normalizeIssue({ number: 102, title: '标记不在首行', body: '一段正文\n' + MARKER })
  check(notFirst.type === 'issue', '标记不在首行不算规格（只认首行、整行精确匹配）', notFirst.type)

  // ② 正文标记优先（红线：标记是唯一真源，标签只在这张票没有标记时才看）
  const both = gh.normalizeIssue({ number: 103, title: '又标签又标记', body: SPEC_BODY, labels: [{ name: 'wayfinder:map' }] })
  check(both.type === 'spec', '标记与标签同时在场时判成规格（正文标记优先）', both.type)

  // GitLab 房这一版没有接规格识别（#1286 收回 GitLab 房改动时只改了源码，没同步这条断言；
  // 设计文档 docs/design/1286-implementation-map-visual.md 第 4.1 节把这个缺口记成「等另一张票补镜像」）。
  // 这里钉住当前已知状态：规格标记落到 GitLab 房仍然是普通票，别让它悄悄漂成一种没人记得的约定。
  const glSpec = gl.normalizeIssue({ iid: 200, title: '规格', description: SPEC_BODY })
  check(glSpec.type === 'issue', 'GitLab 房暂未接规格识别（已知缺口，等单独的票补镜像）', glSpec.type)
  const glPlain = gl.normalizeIssue({ iid: 201, title: '普通票', description: '普通正文' })
  check(glPlain.type === 'issue', 'GitLab 房的普通票仍是普通票', glPlain.type)

  // ③ 组装：容器认两类，未挂图票那一份把两类容器都排掉
  const rows = [
    row('100', 'spec', '规格', SPEC_BODY, null),
    row('101', 'issue', '实施票', '', '100'),
    row('102', 'issue', '普通票', '', null),
    row('200', 'map', '探索地图', '## Destination\n去某处\n', null),
  ]
  const snap = assembleSnapshot({ refId: 'o/n' }, rows)
  const containers = snap.maps || []
  const specRow = containers.find((m: any) => m.type === 'spec')
  const mapRow = containers.find((m: any) => m.type === 'map')
  check(!!specRow, '规格进容器数组', containers.map((m: any) => m.type).join(','))
  check(!!mapRow, '探索地图照旧进容器数组', containers.map((m: any) => m.type).join(','))
  const issueKeys = (snap.issues || []).map((i: any) => i.key)
  check(issueKeys.indexOf('100') === -1, '规格不在未挂图票那一份里（漏了那处列表页会出两行）', issueKeys.join(','))
  check(issueKeys.indexOf('200') === -1, '探索地图也不在未挂图票那一份里', issueKeys.join(','))
  check(issueKeys.indexOf('101') === -1, '实施票不在未挂图票那一份里（它挂在规格底下）', issueKeys.join(','))
  check(issueKeys.indexOf('102') !== -1, '真正的普通票仍在未挂图票那一份里', issueKeys.join(','))
  check(!!specRow && Array.isArray(specRow.tickets) && specRow.tickets.length === 1 && specRow.tickets[0].key === '101',
    '实施票挂到规格底下', specRow ? JSON.stringify((specRow.tickets || []).map((t: any) => t.key)) : 'no spec row')

  // ④ 七段：中文标题、英文标题、探索地图那五个槽不填
  const sec = specRow && specRow.sections
  check(!!sec, '规格容器带七段 sections')
  check(!!sec && sec.problem === '现在改一处规格要翻三个文件。', 'sections.problem 取到问题陈述', sec && sec.problem)
  check(!!sec && sec.solution === '把规格正文按七段切开存。', 'sections.solution 取到解决方案', sec && sec.solution)
  check(!!sec && Array.isArray(sec.userStories) && sec.userStories.length === 1, 'sections.userStories 取到用户故事', sec && JSON.stringify(sec.userStories))
  check(!!sec && Array.isArray(sec.implDecisions) && sec.implDecisions.length === 1, 'sections.implDecisions 取到实现决策', sec && JSON.stringify(sec.implDecisions))
  check(!!sec && Array.isArray(sec.testDecisions) && sec.testDecisions.length === 1, 'sections.testDecisions 取到测试决策', sec && JSON.stringify(sec.testDecisions))
  check(!!sec && Array.isArray(sec.outOfScope) && sec.outOfScope.length === 1, 'sections.outOfScope 取到不在范围内', sec && JSON.stringify(sec.outOfScope))
  check(!!sec && Array.isArray(sec.furtherNotes) && sec.furtherNotes.length === 1, 'sections.furtherNotes 取到补充说明', sec && JSON.stringify(sec.furtherNotes))
  check(!!specRow && specRow.destination === undefined && specRow.notes === undefined && specRow.decisions === undefined && specRow.fog === undefined,
    '规格容器不填探索地图那五个槽', specRow ? Object.keys(specRow).join(',') : '')
  check(!!mapRow && mapRow.destination === '去某处' && mapRow.sections === undefined, '探索地图照旧填那五个槽、不带 sections',
    mapRow ? JSON.stringify({ destination: mapRow.destination, sections: mapRow.sections }) : 'no map row')
  const en = leaf.parseSpecBody('## Problem Statement\n问题是什么\n\n## Solution\n怎么做\n')
  check(en.problem === '问题是什么' && en.solution === '怎么做', '英文标题也认（与中文同一段）', JSON.stringify(en))

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · #1286 门禁（共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
