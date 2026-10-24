// verify-1487-map-create.ts —— Markdown 探索地图与地图子票落盘门禁（#1487，父票 #1480）。
// 门禁归属: src/tracker/rooms/markdown/create-render.ts
// 门禁归属: src/tracker/rooms/markdown/create-layout.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/issues-status.ts
// 门禁归属: src/tracker/rooms/markdown/format/generated.ts
//
// 这一扇门禁守 #1487 的四条验收：
//   ① 建探索地图落成 .scratch/<effort>/map.md；地图子票落成同目录 issues/NN-<slug>.md。
//   ② 地图正文五段标题逐字按原文（Destination / Notes / Decisions so far / Not yet specified / Out of scope）；
//      子票的标题是 `# NN: <问句>`，正文是 `## Question`，Type / Status / Blocked by 行按原文写法（不加粗）。
//   ③ 子票完成（Status: resolved）时，往同一目录 map.md 的 Decisions so far 追加一条指向它的指针；重复关闭不重复追加。
//   ④ 手写的、没有插件注释的 map.md 与子票文件也能正确读出五段与子票（父票按目录回落到 00）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1487-map-create.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, closeIssue, listIssues, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { renderMap, renderWayfinderChild } from '../src/tracker/rooms/markdown/create-render.ts'
import { MD_FORMAT } from '../src/tracker/rooms/markdown/format/generated.ts'
import { parseMapBody, MAP_SECTION_TITLES } from '../src/tracker/body-parse.ts'
import { slugify } from '../src/tracker/rooms/markdown/parse.ts'

let checks = 0
const failures: string[] = []

function check(ok: boolean, message: string): void {
  checks += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
  if (!ok) failures.push(message)
}

/** 最小平台文件层：与 markdown 后端现有门禁用的是同一套形状（resolve/readText/writeText/lstat/listDir/stat）。 */
function platformStub() {
  return {
    path: path,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) {
        fs.mkdirSync(path.dirname(t), { recursive: true })
        fs.writeFileSync(t, c, 'utf8')
      },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
}

function mkctx(cwd: string) {
  const plat = platformStub()
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    get(name: string) { return name === 'fs' ? plat.fs : undefined },
  }
}

function repoOf(effortId?: string, scene?: string) {
  const repo: Record<string, unknown> = { backend: 'markdown', refId: '', name: '', url: '' }
  if (effortId) repo.effortId = effortId
  if (scene) repo.mdScene = scene
  return repo
}

async function create(ctx: unknown, repo: Record<string, unknown>, input: Record<string, unknown>) {
  return await createIssue(ctx as never, repo as never, input as never)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

function listFiles(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return [] }
}

/** 第一个一级标题之前的所有 DSH 隐藏注释行；顺序原样保留。 */
function headerComments(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^#\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}

/** 一段正文在某个二级标题下的内容（不含标题本身，到下一个二级标题为止）。 */
function sectionBody(text: string, heading: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === '## ' + heading)
  if (start < 0) return ''
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

async function main(): Promise<void> {
  // ══ 第一段：后端建一张探索地图 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1487-map-'))
  const ctx = mkctx(tmp)
  const effortRepo = repoOf('effort-a', 'effort')

  const mapInput = {
    title: '探索地图甲',
    body: '这张地图要弄清现成方案。',
    type: 'map',
    labels: ['wayfinder:map'],
    idempotencyKey: 'map-1487-a',
  }
  const map = await create(ctx, effortRepo, mapInput)
  check(!!(map && map.ok), '① 建探索地图返回 ok：' + (map && map.ok ? '' : JSON.stringify(map)))
  const mapPath = path.join(tmp, '.scratch', 'effort-a', 'map.md')
  check(fs.existsSync(mapPath), '① 地图落在 .scratch/effort-a/map.md')
  if (map && map.ok) {
    check(map.data.key === '00', '① 地图是容器编号 00：' + map.data.key)
    check(map.data.type === 'map', '① 地图读回来是 map：' + map.data.type)
    check(map.data.effortId === 'effort-a', '① 回执说清目录：' + map.data.effortId)
    check(map.data.parentKey === null, '① 地图没有父票：' + String(map.data.parentKey))
  }

  const mapText = readText(mapPath)
  check(mapText.startsWith('<!-- DSH-FORMAT: md-v1 -->'), '② 地图文件第一行是 DSH-FORMAT')
  check(/^# 探索地图甲$/m.test(mapText), '② 地图标题按原文形状 # <地图标题>')
  // 五段标题逐字按原文，而且按原文顺序出现。
  const headingOrder = MAP_SECTION_TITLES.map((title) => mapText.indexOf('## ' + title))
  check(headingOrder.every((at) => at >= 0), '② 地图正文五段标题逐字齐：' + JSON.stringify(headingOrder))
  check(headingOrder.every((at, i) => i === 0 || at > headingOrder[i - 1]), '② 五段标题按原文顺序排列')
  check(sectionBody(mapText, 'Destination').indexOf('这张地图要弄清现成方案。') >= 0, '② Destination 段保留建图时给的正文')
  check(!/^\s*\*\*(?:What to build|Blocked by|Status):\*\*/m.test(mapText), '② 地图正文没有实施票的加粗字段行')
  check(!/^\s*Status\s*[:：]/m.test(mapText), '② 地图没有可见 Status 行（状态只在文件头注释里）')
  const mapHeader = headerComments(mapText)
  check(mapHeader[0] === '<!-- DSH-FORMAT: md-v1 -->', '② 地图隐藏注释第一条是 DSH-FORMAT')
  check(mapHeader.indexOf('<!-- DSH-STATUS: ready-for-agent -->') >= 0, '② 地图状态写进 DSH-STATUS')
  check(mapHeader.indexOf('<!-- DSH-LABELS: wayfinder:map -->') >= 0, '② 地图标签写进 DSH-LABELS')
  check(mapHeader.some((l) => /^<!-- DSH-IDEMPOTENCY-KEY: map-1487-a -->$/.test(l)), '② 地图幂等键写进隐藏注释')
  check(mapHeader.every((l) => mapText.indexOf(l) < mapText.indexOf('# 探索地图甲')), '② 地图隐藏注释都在第一个一级标题之前')
  check(!/DSH-PARENT/.test(mapText), '② 地图不写 DSH-PARENT')

  // 同一幂等键重复建同一条地图：不重复生成目录，仍回 00。
  const mapAgain = await create(ctx, effortRepo, mapInput)
  check(!!(mapAgain && mapAgain.ok && mapAgain.data.key === '00'), '① 同一幂等键重复建地图仍回 00')
  const scratchDirs = fs.readdirSync(path.join(tmp, '.scratch'))
  check(scratchDirs.length === 1, '① 重复建地图没有多出目录：' + JSON.stringify(scratchDirs))

  // ══ 第二段：建地图子票（问句在正文，Type / Blocked by 行按原文） ══
  const childInput = {
    title: '现成方案有哪些？',
    body: '先把已知的开源方案列出来。',
    type: 'issue',
    typeLine: 'research',
    labels: ['wayfinder:research'],
    parentKey: '00',
    idempotencyKey: 'child-1487-a',
  }
  const child = await create(ctx, effortRepo, childInput)
  check(!!(child && child.ok), '① 建地图子票返回 ok：' + (child && child.ok ? '' : JSON.stringify(child)))
  // 文件名后缀按原文用标题转出来的 slug（标点压成连字符，中文保留）：问题里的「？」不进文件名。
  const childFile = '01-' + slugify('现成方案有哪些？') + '.md'
  const childPath = path.join(tmp, '.scratch', 'effort-a', 'issues', childFile)
  check(fs.existsSync(childPath), '① 子票落在 .scratch/effort-a/issues/01-现成方案有哪些？.md，盘上文件：' + JSON.stringify(listFiles(path.join(tmp, '.scratch', 'effort-a', 'issues'))))
  const childText = readText(childPath)
  check(childText.startsWith('<!-- DSH-FORMAT: md-v1 -->'), '② 子票文件第一行是 DSH-FORMAT')
  check(/^# 01: 现成方案有哪些？$/m.test(childText), '② 子票标题按原文形状 # NN: <问句标题>')
  check(/^Type: research$/m.test(childText), '② 子票有一行裸 Type: research（不加粗）')
  check(!/\*\*Type:\*\*/.test(childText), '② 子票不写加粗的 **Type:** 行')
  check(!/^\s*\*\*(?:What to build|Blocked by|Status):\*\*/m.test(childText), '② 子票不写实施票的加粗字段行')
  check(/^## Question$/m.test(childText), '② 子票正文有 ## Question 段')
  check(sectionBody(childText, 'Question').indexOf('先把已知的开源方案列出来。') >= 0, '② 子票的问题写在 ## Question 下')
  const childHeader = headerComments(childText)
  check(childHeader.indexOf('<!-- DSH-PARENT: 00 -->') >= 0, '② 子票父票写进 DSH-PARENT: 00')
  check(childHeader.indexOf('<!-- DSH-LABELS: wayfinder:research -->') >= 0, '② 子票标签写进 DSH-LABELS')
  check(childHeader.indexOf('<!-- DSH-STATUS: ready-for-agent -->') < 0, '② 子票不写隐藏 DSH-STATUS（可见 Status 行才是状态）')
  if (child && child.ok) {
    check(child.data.key === '01', '① 子票编号从 01 起：' + child.data.key)
    check(child.data.parentKey === '00', '① 子票父票读回来是 00：' + String(child.data.parentKey))
  }

  // 同一幂等键重复建子票：仍是 01，不重复落盘。
  const childAgain = await create(ctx, effortRepo, childInput)
  check(!!(childAgain && childAgain.ok && childAgain.data.key === '01'), '① 同一幂等键重复建子票仍回 01')
  check(listFiles(path.join(tmp, '.scratch', 'effort-a', 'issues')).length === 1, '① 重复建子票没有多落一份')

  // 第二张子票带 Blocked by: 裸编号（不加粗）。
  const child2 = await create(ctx, effortRepo, {
    title: '要不要自研？',
    body: '如果现成方案够用就不自研。',
    type: 'issue',
    typeLine: 'grilling',
    labels: ['wayfinder:grilling'],
    parentKey: '00',
    blockedBy: ['01'],
    idempotencyKey: 'child-1487-b',
  })
  const child2Path = path.join(tmp, '.scratch', 'effort-a', 'issues', '02-' + slugify('要不要自研？') + '.md')
  check(!!(child2 && child2.ok) && fs.existsSync(child2Path), '① 第二张子票编号接着 02')
  const child2Text = readText(child2Path)
  check(/^Blocked by: 01$/m.test(child2Text), '② 子票阻塞行按原文写法 Blocked by: 01（不加粗）')
  check(!/\*\*Blocked by:\*\*/.test(child2Text), '② 子票不写加粗的 **Blocked by:** 行')

  // ══ 第三段：子票完成 → map.md 的 Decisions so far 追加一条指针 ══
  const closed = await closeIssue(ctx as never, effortRepo as never, '01', { reason: '现成方案够用，走查完成' } as never)
  check(!!(closed && closed.ok), '③ 关闭子票返回 ok：' + (closed && closed.ok ? '' : JSON.stringify(closed)))
  const childAfterClose = readText(childPath)
  check(/^Status: resolved$/m.test(childAfterClose), '③ 关闭子票后可见 Status 行变成 resolved')
  const mapAfterClose = readText(mapPath)
  const decisions = sectionBody(mapAfterClose, 'Decisions so far')
  const pointerRe = new RegExp('^- \\[现成方案有哪些？\\]\\(issues\\/' + childFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\): .+', 'm')
  check(pointerRe.test(decisions), '③ map.md 的 Decisions so far 多了一条指针：' + JSON.stringify(decisions))
  const pointerCount = (decisions.match(new RegExp(childFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  check(pointerCount === 1, '③ 指针只出现一次：' + pointerCount)
  // 重复关闭同一张子票：不重复追加（幂等）。
  await closeIssue(ctx as never, effortRepo as never, '01', { reason: '现成方案够用，走查完成' } as never)
  const decisionsAgain = sectionBody(readText(mapPath), 'Decisions so far')
  check((decisionsAgain.match(new RegExp(childFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 1, '③ 重复关闭不重复追加指针')
  // 指针必须长在 Decisions so far 段里，不能跑到别的段。
  check(sectionBody(mapAfterClose, 'Not yet specified').indexOf('01-现成方案有哪些？') < 0, '③ 指针没有跑到别的段里')

  // ══ 第四段：手写的、没有插件注释的 map.md 与子票也能正确读出五段与子票 ══
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1487-hand-'))
  const ctx2 = mkctx(tmp2)
  const handMap = [
    '# 手写地图', '',
    '## Destination', '', '把手写的那件事做完。', '',
    '## Notes', '', '领域笔记。', '',
    '## Decisions so far', '', '',
    '## Not yet specified', '', '- 还没想清楚的地方', '',
    '## Out of scope', '', '- 明确不做的事', '',
  ].join('\n')
  const handMapPath = path.join(tmp2, '.scratch', 'hand', 'map.md')
  writeText(handMapPath, handMap)
  const handTicketPath = path.join(tmp2, '.scratch', 'hand', 'issues', '01-手写子票.md')
  writeText(handTicketPath, '# 01: 手写子票\n\nType: research\n\n## Question\n\n手写的问题是什么？\n')
  check(!/DSH-/.test(handMap), '④ 夹具自检：手写地图里没有插件注释')

  const listed = await listIssues(ctx2 as never, repoOf() as never, {})
  check(!!(listed && listed.ok), '④ 手写文件也列得出来：' + (listed && listed.ok ? '' : JSON.stringify(listed)))
  const rows = listed && listed.ok ? listed.data : []
  const handMapRow = rows.find((row: { key: string }) => row.key === '00')
  const handChildRow = rows.find((row: { key: string }) => row.key === '01')
  check(!!handMapRow, '④ 手写的 map.md 被认成地图容器 00')
  check(!!handChildRow, '④ 手写的子票被认成 01')
  check(!!handChildRow && handChildRow.parentKey === '00', '④ 手写子票的父票按目录回落到 00：' + (handChildRow && handChildRow.parentKey))
  const blocks = parseMapBody(handMapRow && handMapRow.body)
  check(blocks.destination.indexOf('把手写的那件事做完。') >= 0, '④ 手写地图读出 Destination 段：' + JSON.stringify(blocks.destination))
  check(blocks.notes.indexOf('领域笔记。') >= 0, '④ 手写地图读出 Notes 段')
  check(blocks.fog.some((one: string) => one.indexOf('还没想清楚') >= 0), '④ 手写地图读出 Not yet specified 段')
  check(blocks.outOfScope.some((one: string) => one.indexOf('明确不做的事') >= 0), '④ 手写地图读出 Out of scope 段')
  check(!/DSH-/.test(readText(handMapPath)), '④ 读手写地图没有往盘上回写插件注释')
  const handMapGot = await getIssue(ctx2 as never, repoOf() as never, '00', {})
  check(!!(handMapGot && handMapGot.ok && handMapGot.data.type === 'map'), '④ 按 00 取回手写地图，类型是 map')
  const handChildGot = await getIssue(ctx2 as never, repoOf() as never, '01', {})
  check(!!(handChildGot && handChildGot.ok && handChildGot.data.parentKey === '00'), '④ 按 01 取回手写子票，父票 00')

  // 手写子票完成时同样往手写 map.md 追加指针（第③条对原文布局一视同仁）。
  const handClosed = await closeIssue(ctx2 as never, repoOf() as never, '01', { reason: '手写的也做完了' } as never)
  check(!!(handClosed && handClosed.ok), '④ 手写子票关得掉：' + (handClosed && handClosed.ok ? '' : JSON.stringify(handClosed)))
  const handDecisions = sectionBody(readText(handMapPath), 'Decisions so far')
  check(/- \[手写子票\]\(issues\/01-手写子票\.md\): .+/.test(handDecisions), '④ 手写 map.md 的 Decisions so far 也追加了指针：' + JSON.stringify(handDecisions))

  // ══ 第五段：模板文字必须从 MD_FORMAT 渲染，不能手写一份 ══
  const objects = (MD_FORMAT as unknown as { objects: Record<string, Record<string, unknown>> }).objects
  const mapObject = objects.map
  const mapTitleShape = String(mapObject['title-shape'])
  mapObject['title-shape'] = '# 地图模板哨兵: <地图标题>'
  try {
    const probe = renderMap({ title: '哨兵地图', body: '' }, { createdAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'probe', labels: [], assignees: [] })
    check(probe.indexOf('# 地图模板哨兵: 哨兵地图') >= 0, '⑤ 地图标题从 MD_FORMAT 渲染（改配置，输出跟着变）')
  } finally {
    mapObject['title-shape'] = mapTitleShape
  }
  const childObject = objects['wayfinder-child']
  const bodySection = String(childObject['body-section'])
  childObject['body-section'] = '问题'
  try {
    const probe = renderWayfinderChild({ title: '哨兵子票', body: '哨兵问题', typeLine: 'research' }, { number: '09', createdAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'probe', labels: ['wayfinder:research'], assignees: [], parentKey: '00' })
    check(probe.indexOf('## 问题') >= 0, '⑤ 子票正文段名从 MD_FORMAT 渲染（改配置，输出跟着变）')
  } finally {
    childObject['body-section'] = bodySection
  }
  const topLines = childObject['top-lines'] as Array<Record<string, unknown>>
  const blockedShape = String(topLines[2]['line-shape'])
  topLines[2]['line-shape'] = '阻塞: <NN>, <NN>'
  try {
    const probe = renderWayfinderChild({ title: '哨兵子票', body: '', blockedBy: ['01'] }, { number: '09', createdAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'probe', labels: [], assignees: [], parentKey: '00' })
    check(/阻塞: 01/.test(probe), '⑤ 子票阻塞行从 MD_FORMAT 渲染（改配置，输出跟着变）')
  } finally {
    topLines[2]['line-shape'] = blockedShape
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(tmp2, { recursive: true, force: true }) } catch { /* 同上 */ }

  console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' verify-1487-map-create: ' + checks + ' checks, ' + failures.length + ' failed')
  if (failures.length) {
    console.log('失败项：\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('门禁脚本自己抛了：', e)
  process.exitCode = 1
})
