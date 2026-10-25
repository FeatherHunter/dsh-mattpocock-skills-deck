/**
 * tests/verify-1490-four-objects.ts —— #1490 验收③④：四类对象端到端总验收 + 旧布局只读可用。
 *
 * 规格 #1480 把本地 Markdown 后端的文件格式与位置纠正回随包 Matt 技能原文（pin v1.3.1）：
 * 规格是 .scratch/<feature-slug>/spec.md，探索地图是 .scratch/<effort>/map.md，
 * 实施票、地图子票与普通票都是 .scratch/<effort>/issues/<NN>-<slug>.md，一票一文件。
 * 本门禁逐条钉 #1490 票面的验收③与验收④：
 *
 *   ③ 在一个空工作区里只通过 Markdown 后端的对象操作（create / get / update / setAssignees /
 *      close / list / counts）与宿主快照组装器，走完四类对象的建、读、改、完成、列表、快照，
 *      并把落盘文件按原文布局断言：规格七段、地图五段、地图子票完成写 ## Answer 并往 map.md
 *      的 Decisions so far 追加指针、普通票关闭只写 ## Comments、插件信息只放文件头隐藏注释。
 *   ④ 旧布局工作区（工作区根 issues/ 与 .scratch 根级扁平 map.md）只读可用：preflight / list /
 *      get / snapshot 全部跑通，读取时留下兼容降级日志，跑完对全部文件做 SHA256 比对证明
 *      一个字节都没改。机器路径不能进 CI，所以这里把 tests/fixtures/1490-legacy-layout 复制到
 *      临时目录再断言；真机上的 featherhunter 工作区由提交说明里的手工只读记录覆盖。
 *
 * 本门禁不重复实现渲染：新建对象一律经由后端对象操作写盘（不是手写文件），
 * 只在结果上断言原文布局；渲染细节由 verify-1486 / 1487 / 1488 / 1489 各自守。
 *
 * 门禁归属: src/tracker/rooms/markdown/index.ts
 * 门禁归属: src/tracker/rooms/markdown/create-render.ts
 * 门禁归属: src/tracker/rooms/markdown/create-layout.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-read.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-patch.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-status.ts
 * 门禁归属: src/host/tracker/snapshot.ts
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1490-four-objects.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.ts'

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
type Ctx = {
  platform: { path: typeof path; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  events: LogLine[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  get: (name: string) => unknown
}

let failed = false
let checked = 0
const check = (ok: boolean, msg: string) => {
  checked += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const eq = (actual: unknown, expected: unknown, msg: string) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(a === b, a === b ? msg : msg + '（实际 ' + a + '，期望 ' + b + '）')
}

/** 与 tests/verify-1486 / 1487 / 1489 同一套 fs/platform 适配器：真实文件系统 + 事件收集。 */
function makeCtx(cwd: string): Ctx {
  const plat = {
    path: path,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      // 真实平台的写探测会先写一个临时探针再删掉；这里补上删除能力，否则探针文件会留在工作区里，
      // 「跑完只读检查后所有文件逐字节未变」的断言就会把探针算成改动（#1513 起 preflight 也跑写探测）。
      async unlink(t: string) { try { fs.unlinkSync(t) } catch {} },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const events: LogLine[] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

/** 工作区引用照宿主在真实工作区给的形状：refId 给空，用 effortId 指定工作单元目录。 */
function repoOf(effortId?: string, scene?: string): Record<string, unknown> {
  const repo: Record<string, unknown> = { backend: 'markdown', refId: '', name: '', url: '' }
  if (effortId) repo.effortId = effortId
  if (scene) repo.mdScene = scene
  return repo
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}
function h2s(text: string): string[] {
  return text.split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3))
}
function sectionBody(text: string, heading: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === '## ' + heading)
  if (start < 0) return ''
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}
/** 第一个可见标题之前的所有插件隐藏注释行（#1480 允许 deck 写的信息只能出现在这里）。
 *  规格与地图按原文模板不写一级标题，它们的第一个可见标题就是正文第一个段标题（## …），
 *  所以这里遇到一级或二级标题都算正文开始。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#{1,2}\s/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}
function walkFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkFiles(root, p, out)
    else out.push(path.relative(root, p).split(path.sep).join('/'))
  }
  return out
}
function hashTree(root: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const rel of walkFiles(root)) map[rel] = createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex')
  return map
}
/** 门禁可能在链条里以仓库根为 cwd 运行，也可能从别处直接跑；往上找夹具目录定位仓库根。 */
function findRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'tests', 'fixtures', '1490-legacy-layout'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('找不到仓库根：应当在仓库根目录下运行本门禁')
}

function rowOf(rows: Record<string, unknown>[], effortId: string, key: string, type: string): Record<string, unknown> | undefined {
  return rows.find((r) => String(r.effortId || '') === effortId && String(r.key) === key && String(r.type) === type)
}

// ======================= 验收③：四类对象端到端 =======================

const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1490-e2e-'))
const specRepo = repoOf()
const featureRepo = repoOf('积分兑换', 'feature')
const effortRepo = repoOf('effort-a', 'effort')
const specBody = [
  '## Problem Statement', '', '用户想用积分换咖啡。', '',
  '## Solution', '', '积分直接抵扣。', '',
  '## User Stories', '', '- 作为用户，我能用积分换咖啡。', '',
  '## Implementation Decisions', '', '沿用现有订单表。', '',
  '## Testing Decisions', '', '冒烟走一遍。', '',
  '## Out of Scope', '', '不做钱包充值。', '',
  '## Further Notes', '', '无。', '',
].join('\n')

try {
  const ctx = makeCtx(tmp1)
  const be: any = createMarkdownBackend(ctx as never)
  const specPath = path.join(tmp1, '.scratch', '积分兑换', 'spec.md')
  const mapPath = path.join(tmp1, '.scratch', 'effort-a', 'map.md')
  const featureIssuesDir = path.join(tmp1, '.scratch', '积分兑换', 'issues')
  const effortIssuesDir = path.join(tmp1, '.scratch', 'effort-a', 'issues')

  console.log('-- ① 规格：建、读、落盘七段 --')
  const spec: any = await be.create(specRepo, {
    title: '积分兑换',
    body: specBody,
    type: 'spec',
    labels: ['ready-for-agent'],
    idempotencyKey: 'e2e-spec',
  }, ctx)
  check(spec.ok === true, '规格建票返回成功')
  check(spec.ok && spec.data.key === '00', '规格票号是 00（本工作单元第一张）')
  check(spec.ok && spec.data.type === 'spec', '规格对象类型是 spec')
  check(spec.ok && String(spec.data.effortId) === '积分兑换', '规格落在标题推导出的 feature 目录 积分兑换')
  check(fs.existsSync(specPath), '规格文件落在 .scratch/积分兑换/spec.md（原文位置）')
  const specInitial = readText(specPath)
  eq(h2s(specInitial), ['Problem Statement', 'Solution', 'User Stories', 'Implementation Decisions', 'Testing Decisions', 'Out of Scope', 'Further Notes'], '规格文件按原文七段写')
  check(specInitial.split('\n')[0] === '<!-- DSH-FORMAT: md-v1 -->', '规格文件第一行是插件格式隐藏注释')
  check(headerComments(specInitial).length >= 6, '规格的插件信息都以第一个可见标题前的隐藏注释给出：' + JSON.stringify(headerComments(specInitial)))
  check(!/^#[ \t]+\S/m.test(specInitial), '规格不写可见一级标题（原文模板没有标题行）')
  check(headerComments(specInitial).some((l) => l === '<!-- DSH-TITLE: 积分兑换 -->'), '规格标题写进 DSH-TITLE 隐藏注释')
  check(specInitial.indexOf('<!-- DSH-FORMAT') < specInitial.indexOf('## Problem Statement'), '规格隐藏注释在正文第一个段标题之前')
  check(!specInitial.includes('DSH-ISSUE-KIND'), '新写规格不再写 #1486 之前的对象类型标记')
  check(!/^Status:/m.test(specInitial), '规格没有可见 Status 行（状态只放隐藏注释）')
  eq(fs.readdirSync(path.join(tmp1, '.scratch', '积分兑换')).sort(), ['spec.md'], '规格先单独落在 feature 目录，没有多造空目录')

  const gotSpec: any = await be.get(specRepo, '00', {}, ctx)
  check(gotSpec.ok === true && gotSpec.data.type === 'spec', '规格能按票号读回，类型仍是 spec')
  check(gotSpec.ok && String(gotSpec.data.title) === '积分兑换', '规格读回标题是 积分兑换')
  check(gotSpec.ok && String(gotSpec.data.effortId) === '积分兑换', '规格读回带 feature 目录名')

  console.log('-- ② 探索地图：建、读、落盘五段 --')
  const map: any = await be.create(effortRepo, {
    title: '探索地图乙',
    body: '先把现成方案摸清楚。',
    type: 'map',
    labels: ['wayfinder:map'],
    idempotencyKey: 'e2e-map',
  }, ctx)
  check(map.ok === true, '探索地图建票返回成功')
  check(map.ok && String(map.data.key) === '00', '探索地图票号是 00')
  check(map.ok && map.data.type === 'map', '探索地图对象类型是 map')
  check(map.ok && String(map.data.effortId) === 'effort-a', '探索地图落在 effortId 指定的 effort-a')
  check(fs.existsSync(mapPath), '探索地图落在 .scratch/effort-a/map.md（原文位置）')
  const mapInitial = readText(mapPath)
  eq(h2s(mapInitial), ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope'], '探索地图按原文五段写')
  check(sectionBody(mapInitial, 'Destination').includes('先把现成方案摸清楚。'), '探索地图正文落在 Destination 段')
  check(!/^Status:/m.test(mapInitial), '探索地图没有可见 Status 行')
  check(!/^#[ \t]+\S/m.test(mapInitial), '探索地图不写可见一级标题（原文模板没有标题行）')
  check(headerComments(mapInitial).some((l) => l === '<!-- DSH-TITLE: 探索地图乙 -->'), '探索地图标题写进 DSH-TITLE 隐藏注释')
  check(mapInitial.indexOf('<!-- DSH-TITLE') < mapInitial.indexOf('## Destination'), '探索地图隐藏注释在正文第一个段标题之前')
  eq(fs.readdirSync(path.join(tmp1, '.scratch', 'effort-a')).sort(), ['map.md'], '探索地图先单独落在 effort 目录，没有多造空目录')

  const gotMap: any = await be.get(effortRepo, '00', {}, ctx)
  check(gotMap.ok === true && gotMap.data.type === 'map', '探索地图能按票号读回，类型是 map')
  check(gotMap.ok && String(gotMap.data.title) === '探索地图乙', '探索地图读回标题是 探索地图乙')

  console.log('-- ③ 地图子票：建、认领、完成（## Answer 与 Decisions so far 指针） --')
  const child: any = await be.create(effortRepo, {
    title: '现成方案有哪些？',
    body: '把已知的开源方案列出来。',
    type: 'issue',
    typeLine: 'research',
    labels: ['wayfinder:research'],
    parentKey: '00',
    idempotencyKey: 'e2e-child',
  }, ctx)
  check(child.ok === true, '地图子票建票返回成功')
  check(child.ok && String(child.data.key) === '01', '地图子票票号是 01')
  check(child.ok && String(child.data.parentKey) === '00', '地图子票 parentKey 指向地图 00')
  const childFiles = fs.readdirSync(effortIssuesDir).sort()
  eq(childFiles, ['01-现成方案有哪些.md'], '地图子票落在 issues/01-<slug>.md（原文位置与命名）')
  const childPath = path.join(effortIssuesDir, '01-现成方案有哪些.md')
  const childInitial = readText(childPath)
  eq(h2s(childInitial), ['Question'], '地图子票按原文只有 Question 段')
  check(sectionBody(childInitial, 'Question').includes('把已知的开源方案列出来。'), '地图子票正文落在 Question 段')
  check(/^Type: research$/m.test(childInitial), '地图子票有可见 Type: research 行')
  check(!/^Status:/m.test(childInitial), '未认领的地图子票没有可见 Status 行')
  check(headerComments(childInitial).some((l) => l.includes('DSH-PARENT: 00')), '地图子票的父子关系以文件头隐藏注释记录')
  check(!childInitial.includes('DSH-ISSUE-KIND'), '地图子票不再写对象类型标记')

  const claim: any = await be.setAssignees(effortRepo, '01', ['alice'], {}, ctx)
  check(claim.ok === true, '地图子票能认领')
  const childClaimed = readText(childPath)
  check(/^Status: claimed$/m.test(childClaimed), '认领后子票可见 Status 行变成 claimed')
  check(headerComments(childClaimed).some((l) => l.includes('DSH-ASSIGNEES: alice')), '认领人写进文件头隐藏注释')

  const closeChild: any = await be.close(effortRepo, '01', { reason: '现成方案够用，走查完成' }, ctx)
  check(closeChild.ok === true, '地图子票能关闭')
  const childClosed = readText(childPath)
  eq(h2s(childClosed), ['Question', 'Answer'], '完成后地图子票追加 ## Answer 段')
  check(/^Status: resolved$/m.test(childClosed), '完成后子票可见 Status 行是 resolved')
  check(sectionBody(childClosed, 'Answer').includes('现成方案够用，走查完成'), '## Answer 段写入关闭原因')
  const mapAfterChildClose = readText(mapPath)
  check(sectionBody(mapAfterChildClose, 'Decisions so far').includes('- [现成方案有哪些？](issues/01-现成方案有哪些.md): 现成方案够用，走查完成'), '子票完成往 map.md 的 Decisions so far 追加指针')
  eq(h2s(mapAfterChildClose), ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope'], '追加指针后地图仍是原文五段')
  const gotChild: any = await be.get(effortRepo, '01', {}, ctx)
  check(gotChild.ok === true && gotChild.data.state === 'closed', '地图子票读回状态是 closed')
  check(gotChild.ok && String(gotChild.data.parentKey) === '00', '地图子票读回仍带 parentKey 00')

  console.log('-- ④ 普通票：建、改、完成（关闭只写 ## Comments，不写 ## Answer） --')
  const plain: any = await be.create(featureRepo, {
    title: '补一条说明',
    body: '**What to build:** 补一条说明。\n\n- [ ] 能看懂说明',
    type: 'issue',
    idempotencyKey: 'e2e-plain',
  }, ctx)
  check(plain.ok === true, '普通票建票返回成功')
  check(plain.ok && String(plain.data.key) === '01', '普通票票号是 01')
  check(plain.ok && plain.data.parentKey == null, '普通票没有 parentKey（不挂地图）')
  eq(fs.readdirSync(featureIssuesDir).sort(), ['01-补一条说明.md'], '普通票落在 issues/01-<slug>.md（原文位置与命名）')
  const plainPath = path.join(featureIssuesDir, '01-补一条说明.md')
  const plainInitial = readText(plainPath)
  check(plainInitial.includes('**What to build:** 补一条说明。'), '普通票正文按原文加粗字段行写')
  check(plainInitial.includes('**Blocked by:** None (can start immediately)'), '普通票带原文 Blocked by 字段行')
  check(plainInitial.includes('**Status:** ready-for-agent'), '普通票带原文 Status 字段行')
  check(h2s(plainInitial).length === 0, '未关闭的普通票没有二级标题段')

  const update: any = await be.update(featureRepo, '01', { title: '补一条说明（已改）' }, ctx)
  check(update.ok === true, '普通票能改标题')
  check(readText(plainPath).split('\n').some((l) => l === '# 补一条说明（已改）'), '改完盘上 H1 是 补一条说明（已改）')
  eq(fs.readdirSync(featureIssuesDir).sort(), ['01-补一条说明.md'], '改标题不改原位文件名')
  const gotPlain: any = await be.get(featureRepo, '01', {}, ctx)
  check(gotPlain.ok === true && String(gotPlain.data.title).includes('补一条说明（已改）'), '普通票读回标题已改')

  const closePlain: any = await be.close(featureRepo, '01', { reason: '说明补完了' }, ctx)
  check(closePlain.ok === true, '普通票能关闭')
  const plainClosed = readText(plainPath)
  eq(h2s(plainClosed), ['Comments'], '关闭普通票只多出 ## Comments 段（不写 ## Answer）')
  check(!plainClosed.includes('## Answer'), '普通票关闭不写 ## Answer')
  check(sectionBody(plainClosed, 'Comments').includes('说明补完了'), '## Comments 段写入关闭原因')
  check(plainClosed.includes('**Status:** resolved'), '关闭后普通票可见 Status 行是 resolved')
  const gotPlainClosed: any = await be.get(featureRepo, '01', {}, ctx)
  check(gotPlainClosed.ok === true && gotPlainClosed.data.state === 'closed', '普通票读回状态是 closed')

  console.log('-- ⑤ 收口：预检、列表、计数、快照 --')
  const pre: any = await be.preflight({ cwd: tmp1, refId: '' } as never, ctx as never)
  check(pre.ok === true, '四类对象建好后环境预检通过')

  const listed: any = await be.list(repoOf(), {}, ctx)
  check(listed.ok === true, '列表返回成功')
  const rows: Record<string, unknown>[] = listed.ok ? listed.data : []
  eq(rows.length, 4, '列表里恰好四个对象行（规格、地图、子票、普通票）')
  const rowSpec = rowOf(rows, '积分兑换', '00', 'spec')
  const rowMap = rowOf(rows, 'effort-a', '00', 'map')
  const rowChild = rowOf(rows, 'effort-a', '01', 'issue')
  const rowPlain = rowOf(rows, '积分兑换', '01', 'issue')
  check(!!rowSpec && String(rowSpec.state) === 'open', '列表里有规格 00，状态 open')
  check(!!rowMap && String(rowMap.state) === 'open', '列表里有探索地图 00，状态 open')
  check(!!rowChild && String(rowChild.state) === 'closed' && String(rowChild.parentKey) === '00', '列表里有地图子票 01，已关闭且带 parentKey 00')
  check(!!rowPlain && String(rowPlain.state) === 'closed' && rowPlain.parentKey == null, '列表里有普通票 01，已关闭且不挂地图')

  const counts: any = await be.counts(repoOf(), {}, ctx)
  check(counts.ok === true, '计数返回成功')
  eq(counts.ok ? counts.data : null, { open: 0, closed: 2, total: 2 }, '计数只数两张票：open 0、closed 2、total 2')

  const composer: any = createSnapshotComposer({ get(id: string) { return id === 'markdown' ? be : null } }, { snapshotTtl: 50, depsTtl: 50 })
  const snap: any = await composer.composeSnapshot('markdown', repoOf(), ctx, { force: true })
  check(snap.ok === true, '宿主快照组装成功')
  const snapshot: any = snap.ok ? snap.snapshot : {}
  const maps: any[] = snapshot.maps || []
  const specNode = maps.find((m) => m.type === 'spec')
  const mapNode = maps.find((m) => m.type === 'map')
  eq(maps.length, 2, '快照里有规格与地图两个容器')
  check(!!specNode && String(specNode.effortId) === '积分兑换', '快照里规格容器的 effortId 是 feature 目录名')
  check((specNode && Object.keys(specNode.sections || {}).join(',')) === 'problem,solution,userStories,implDecisions,testDecisions,outOfScope,furtherNotes', '快照里规格按原文七段给出 sections')
  check(!!mapNode && String(mapNode.title) === '探索地图乙', '快照里地图容器标题是 探索地图乙')
  check(!!mapNode && String(mapNode.destination).includes('先把现成方案摸清楚。'), '快照里地图的 Destination 来自 map.md')
  check(!!mapNode && Array.isArray(mapNode.tickets) && mapNode.tickets.length === 1 && String(mapNode.tickets[0].key) === '01' && String(mapNode.tickets[0].parentKey) === '00', '快照里地图挂着子票 01（parentKey 00）')
  check(!!mapNode && Array.isArray(mapNode.decisions) && mapNode.decisions.length === 1 && String(mapNode.decisions[0].url) === 'issues/01-现成方案有哪些.md', '快照里地图的 Decisions 指针来自 map.md')
  const snapIssues: any[] = snapshot.issues || []
  eq(snapIssues.length, 1, '快照里只把不挂地图的普通票放 issues 列表')
  check(snapIssues.length === 1 && String(snapIssues[0].key) === '01' && String(snapIssues[0].state) === 'closed' && String(snapIssues[0].title).includes('已改'), '快照里普通票 01 已关闭、标题已改')
  const stats: any = snapshot.deck && snapshot.deck.stats
  check(!!stats && stats.total === 2 && stats.open === 0 && stats.closed === 2, '快照统计 total 2 / open 0 / closed 2')
  check(!fs.existsSync(path.join(tmp1, 'issues')) && !fs.existsSync(path.join(tmp1, '.scratch', 'issues')), '新布局工作区根没有旧布局 issues/ 兜底目录')
} finally {
  fs.rmSync(tmp1, { recursive: true, force: true })
}

// ======================= 验收④：旧布局只读可用 =======================

console.log('-- ⑤ 旧布局工作区：只读列表、单票、快照，一个字节不改 --')
const repoRoot = findRepoRoot()
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', '1490-legacy-layout')
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1490-legacy-'))
try {
  fs.cpSync(path.join(fixtureRoot, 'root-issues'), path.join(tmp2, 'issues'), { recursive: true })
  fs.cpSync(path.join(fixtureRoot, 'dot-scratch'), path.join(tmp2, '.scratch'), { recursive: true })
  const before = hashTree(tmp2)
  eq(Object.keys(before), [
    '.scratch/map.md',
    'issues/01-legacy-ticket.md',
    'issues/02-legacy-ticket-two.md',
    'issues/06-legacy-spec.md',
  ], '夹具复制成旧布局工作区：根 issues/ 三个文件 + .scratch 根级 map.md')

  const ctx2 = makeCtx(tmp2)
  const be2: any = createMarkdownBackend(ctx2 as never)
  const pre2: any = await be2.preflight({ cwd: tmp2, refId: '' } as never, ctx2 as never)
  check(pre2.ok === true, '旧布局工作区环境预检通过')

  const listed2: any = await be2.list(repoOf(), {}, ctx2)
  check(listed2.ok === true, '旧布局列表返回成功')
  const legacyRows: Record<string, unknown>[] = listed2.ok ? listed2.data : []
  eq(legacyRows.length, 4, '旧布局列出四个对象行（旧地图、两张旧票、旧规格）')
  const legacyMap = rowOf(legacyRows, '', '00', 'map')
  const legacyTicketOpen = rowOf(legacyRows, '', '01', 'issue')
  const legacyTicketClosed = rowOf(legacyRows, '', '02', 'issue')
  const legacySpec = rowOf(legacyRows, '', '06', 'spec')
  check(!!legacyMap && String(legacyMap.title).includes('调色板统一'), '旧布局根 .scratch/map.md 被认成探索地图 00')
  check(!!legacyTicketOpen && String(legacyTicketOpen.state) === 'open', '旧布局普通票 01 能列出且状态 open')
  check(!!legacyTicketClosed && String(legacyTicketClosed.state) === 'closed', '旧布局已关闭票 02 能列出且状态 closed')
  check(!!legacySpec && String(legacySpec.state) === 'closed', '旧布局规格 06 能列出（靠旧对象类型标记兜底）且状态 closed')
  check(legacyRows.every((r) => String(r.effortId || '') === ''), '旧布局票的 effortId 都是空串（没有工作单元目录）')

  const counts2: any = await be2.counts(repoOf(), {}, ctx2)
  eq(counts2.ok ? counts2.data : null, { open: 1, closed: 1, total: 2 }, '旧布局计数：open 1、closed 1、total 2')

  const gMap: any = await be2.get(repoOf(), '00', {}, ctx2)
  check(gMap.ok === true && gMap.data.type === 'map' && String(gMap.data.title).includes('调色板统一'), '旧布局单票读取：地图 00 可读')
  const gTicket: any = await be2.get(repoOf(), '01', {}, ctx2)
  check(gTicket.ok === true && gTicket.data.type === 'issue' && gTicket.data.state === 'open', '旧布局单票读取：普通票 01 可读且 open')
  const gClosed: any = await be2.get(repoOf(), '02', {}, ctx2)
  check(gClosed.ok === true && gClosed.data.state === 'closed', '旧布局单票读取：已关闭票 02 可读且 closed')
  const gSpec: any = await be2.get(repoOf(), '06', {}, ctx2)
  check(gSpec.ok === true && gSpec.data.type === 'spec', '旧布局单票读取：规格 06 可读且仍认成 spec')
  check(gSpec.ok && String(gSpec.data.title).includes('调色板 README'), '旧布局规格读回原 H1 标题')

  const composer2: any = createSnapshotComposer({ get(id: string) { return id === 'markdown' ? be2 : null } }, { snapshotTtl: 50, depsTtl: 50 })
  const snap2: any = await composer2.composeSnapshot('markdown', repoOf(), ctx2, { force: true })
  check(snap2.ok === true, '旧布局宿主快照组装成功')
  const snapshot2: any = snap2.ok ? snap2.snapshot : {}
  const maps2: any[] = snapshot2.maps || []
  const legacySpecNode = maps2.find((m) => m.type === 'spec' && String(m.key) === '06')
  const legacyMapNode = maps2.find((m) => m.type === 'map' && String(m.key) === '00')
  check(!!legacyMapNode, '旧布局快照里有旧地图 00')
  check(!!legacySpecNode, '旧布局快照里有旧规格 06')
  check(!!legacySpecNode && Object.keys(legacySpecNode.sections || {}).join(',') === 'problem,solution,userStories,implDecisions,testDecisions,outOfScope,furtherNotes', '旧布局规格的七段在快照里按原文键给出')
  const legacyIssues: any[] = snapshot2.issues || []
  eq(legacyIssues.length, 2, '旧布局快照 issues 列表里有两张票')
  check(legacyIssues.some((i) => String(i.key) === '01') && legacyIssues.some((i) => String(i.key) === '02'), '旧布局快照 issues 里有 01 与 02')

  const degraded = ctx2.events.filter((e) => e.event === 'read.degraded').map((e) => String(e.fields && e.fields.reason))
  check(degraded.includes('list:legacy-root'), '读旧布局列表时留下兼容降级日志 list:legacy-root')
  check(degraded.includes('get:legacy-root'), '读旧布局单票时留下兼容降级日志 get:legacy-root')

  const after = hashTree(tmp2)
  eq(after, before, '旧布局工作区跑完只读检查后所有文件逐字节未变')
  check(!fs.existsSync(path.join(tmp2, '.scratch', 'spec.md')) && !fs.existsSync(path.join(tmp2, '.scratch', 'issues')), '只读检查没有在新位置造文件或目录')
} finally {
  fs.rmSync(tmp2, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log('FAILED（' + checked + ' 条断言里有失败）')
  process.exitCode = 1
} else {
  console.log('ALL PASS（' + checked + ' 条断言）')
}
