// verify-1507-create-strict.ts —— 建票一次写对（#1507，父规格 #1506）。
// 门禁归属: src/tracker/rooms/markdown/template-guard.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/create-render.ts
// 门禁归属: src/deck/rules/minimal-spec.ts
//
// 这一扇门禁守的是 #1507 的六条验收：
//   ① 带远端四段模板（## Parent / ## What to build / ## Acceptance criteria / ## Blocked by）
//      的新建请求被拒绝：报错用中文说清错在哪一段、本地模板该写成什么样，磁盘上不留半张票。
//   ② 用本地模板照常能建，读回来的正文与写下去的一致。
//   ③ 新建的票必然带 Status 行：没给状态、只给空白都落成模板默认值，不会出现「没有状态、被当成未开始」。
//   ④ Blocked by 落盘只写编号或标题，不出现 #05 这种带井号的写法；隐藏字段与可见行说的是同一件事。
//   ⑤ 地图正文为空时不再写那句没登记的占位注释。
//   ⑥ 代码围栏里的举例不算错（判据只认围栏外的二级标题）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1507-create-strict.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { renderMap } from '../src/tracker/rooms/markdown/map-render.ts'
import { ensureBody } from '../src/deck/rules/minimal-spec.ts'

let checks = 0
const failures: string[] = []

function check(ok: boolean, message: string): void {
  checks += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
  if (!ok) failures.push(message)
}

/** 最小平台文件层：与 markdown 后端其它门禁用同一套形状（resolve/readText/writeText/lstat/listDir/stat）。 */
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

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), tag))
}

async function create(ctx: unknown, repo: Record<string, unknown>, input: Record<string, unknown>) {
  return await createIssue(ctx as never, repo as never, input as never)
}

async function readBack(ctx: unknown, repo: Record<string, unknown>, key: string) {
  return await getIssue(ctx as never, repo as never, key, {} as never)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function listFiles(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return [] }
}

/** 失败结果里要看的三个字段；成功时返回空串，方便后面逐条断言。 */
function failOf(result: unknown): { kind: string; message: string; raw: string } {
  const r = result as { ok?: boolean; error?: { kind?: unknown; message?: unknown; raw?: unknown } }
  if (!r || r.ok || !r.error) return { kind: '', message: '', raw: '' }
  return { kind: String(r.error.kind || ''), message: String(r.error.message || ''), raw: String(r.error.raw || '') }
}

/** 成功结果的编号；失败时返回空串。 */
function keyOf(result: unknown): string {
  const r = result as { ok?: boolean; data?: { key?: unknown } }
  return r && r.ok && r.data ? String(r.data.key || '') : ''
}

/** 第一个可见标题之前的 DSH 隐藏注释行（顺序原样）。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#{1,2}\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}

/** 可见阻塞行与隐藏 DSH-BLOCKED-BY 的值，用来证明两行说的是同一件事。 */
function blockedLines(text: string): { visible: string; hidden: string } {
  const visible = /^\*\*Blocked by:\*\*[ \t]*(.*)$/m.exec(text)
  const hidden = /<!--[ \t]*DSH-BLOCKED-BY[ \t]*:[ \t]*(.*?)[ \t]*-->/m.exec(text)
  return {
    visible: visible ? visible[1].trim() : '（没有可见 Blocked by 行）',
    hidden: hidden ? hidden[1].trim() : '',
  }
}

function countProgress(text: string): number {
  const m = text.match(/^## 进度[ \t]*$/gm)
  return m ? m.length : 0
}

/** 远端四段模板的原文：四段都在，模拟从 GitHub/Linear 整段复制过来的票。 */
const REMOTE_FOUR = [
  '## Parent',
  '',
  '#1506 建票一次写对',
  '',
  '## What to build',
  '',
  '正文里不该出现这四段。',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] 一条验收',
  '',
  '## Blocked by',
  '',
  'None',
  '',
].join('\n')

/** 本地模板的原文：to-tickets 的「Local files」一节，平时人照着写的形状。 */
const LOCAL_TEMPLATE = [
  '**What to build:** 用户能看到第一步。',
  '',
  '**Blocked by:** 03',
  '',
  '**Status:** ready-for-agent',
  '',
  '- [ ] 能看到结果',
  '',
].join('\n')

/** 代码围栏里的四段模板：只是举例，不是这次要写的模板。 */
const FENCED_EXAMPLE = [
  '**What to build:** 文档里要举例说明远端模板长什么样。',
  '',
  '```markdown',
  '## Parent',
  '',
  '#1506',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] 一条',
  '```',
  '',
  '~~~text',
  '## Blocked by',
  '',
  'None',
  '~~~',
  '',
  '- [ ] 例子照原样留在票里',
  '',
].join('\n')

async function main(): Promise<void> {
  // ══ ① 远端四段模板：新建被拒，报错说清哪一段、本地怎么写，磁盘上不留半张票 ══
  const guardTmp = tmpDir('md-1507-guard-')
  const guardCtx = mkctx(guardTmp)
  const featureRepo = repoOf('防错', 'feature')

  const rejected = await create(guardCtx, featureRepo, {
    title: '四段模板票',
    body: REMOTE_FOUR,
    type: 'issue',
    parentKey: '00',
    status: 'ready-for-agent',
    idempotencyKey: 'guard-1507-a',
  })
  const rejectedFail = failOf(rejected)
  check(!(rejected && (rejected as { ok?: boolean }).ok), '① 带远端四段模板的实施票建不出来')
  check(rejectedFail.kind === 'parse', '① 拒绝的错型是 parse（判不出合法正文，不是环境或冲突）：' + rejectedFail.kind)
  check(rejectedFail.message.indexOf('## Parent') >= 0, '① 报错点名了第一段「## Parent」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('## Acceptance criteria') >= 0, '① 报错点名了「## Acceptance criteria」：' + JSON.stringify(rejectedFail.message))
  check(
    rejectedFail.message.indexOf('**What to build:**') >= 0 &&
    rejectedFail.message.indexOf('**Blocked by:**') >= 0 &&
    rejectedFail.message.indexOf('**Status:**') >= 0,
    '① 报错给出了本地模板的三个字段行：' + JSON.stringify(rejectedFail.message),
  )
  check(rejectedFail.message.indexOf('- [ ]') >= 0, '① 报错给出了本地验收项的写法：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('# NN: 标题') >= 0, '① 报错说清本地标题写成「# NN: 标题」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.raw === REMOTE_FOUR, '① 报错带回原文，没有丢信息')
  check(listFiles(path.join(guardTmp, '.scratch', '防错', 'issues')).length === 0, '① 被拒后 issues 目录下没有半张票')
  check(!fs.existsSync(path.join(guardTmp, '.scratch', '防错')), '① 被拒后连票目录都没建')

  const singleSection = await create(guardCtx, featureRepo, {
    title: '只带一段',
    body: '## Blocked by\n\n#01\n',
    type: 'issue',
    idempotencyKey: 'guard-1507-b',
  })
  const singleFail = failOf(singleSection)
  check(singleFail.message.indexOf('## Blocked by') >= 0, '① 只有一段时同样点名这一段：' + JSON.stringify(singleFail.message))
  check(singleFail.message.indexOf('## Parent') < 0, '① 没出现的段不瞎报：' + JSON.stringify(singleFail.message))

  const plainRejected = await create(guardCtx, featureRepo, {
    title: '普通票也写错',
    body: '## What to build\n\n做点什么。\n',
    type: 'issue',
    idempotencyKey: 'guard-1507-c',
  })
  check(!(plainRejected && (plainRejected as { ok?: boolean }).ok), '① 普通票带远端模板同样被拒（规格 #1506 的 User Story 3）')

  const effortRepo = repoOf('effort-a', 'effort')
  const childRejected = await create(guardCtx, effortRepo, {
    title: '现成方案有哪些？',
    body: '## Parent\n\n#1450 探索地图甲\n',
    type: 'issue',
    typeLine: 'research',
    labels: ['wayfinder:research'],
    parentKey: '00',
    idempotencyKey: 'guard-1507-child',
  })
  const childFail = failOf(childRejected)
  check(!(childRejected && (childRejected as { ok?: boolean }).ok), '① 地图子票带远端模板被拒（User Story 2：地图下只有问句形态的子票）')
  check(childFail.message.indexOf('## Parent') >= 0, '① 子票报错点名了「## Parent」：' + JSON.stringify(childFail.message))
  check(childFail.message.indexOf('## Question') >= 0 && childFail.message.indexOf('Type:') >= 0, '① 子票报错说清本地问句形态（Type 行 + 一段 ## Question）：' + JSON.stringify(childFail.message))
  check(childFail.message.indexOf('**What to build:**') < 0, '① 子票报错不照搬实施票的字段模板：' + JSON.stringify(childFail.message))

  // ══ ⑥ 代码围栏里的举例不算错 ══
  const fenced = await create(guardCtx, featureRepo, {
    title: '围栏里的例子',
    body: FENCED_EXAMPLE,
    type: 'issue',
    idempotencyKey: 'guard-1507-fenced',
  })
  check(!!(fenced && (fenced as { ok?: boolean }).ok), '⑥ 围栏里的四段举例不算错，票建得成：' + JSON.stringify(failOf(fenced)))
  const fencedText = readText(path.join(guardTmp, '.scratch', '防错', 'issues', '01-围栏里的例子.md'))
  check(fencedText.indexOf('```markdown') >= 0 && fencedText.indexOf('~~~text') >= 0, '⑥ 两种围栏原样写进票里')
  check(fencedText.indexOf('## Parent') >= fencedText.indexOf('```markdown'), '⑥ 围栏里的 ## Parent 是例子，留在正文里')
  check(fencedText.indexOf('## Acceptance criteria') < 0 || fencedText.indexOf('## Acceptance criteria') > fencedText.indexOf('```markdown'), '⑥ 围栏里的 Acceptance criteria 没有被当成模板段挪走')

  // ══ ② 本地模板照常能建，读回来与写下去一致 ══
  const localTmp = tmpDir('md-1507-local-')
  const localCtx = mkctx(localTmp)
  const localRepo = repoOf('本地模板', 'feature')
  const local = await create(localCtx, localRepo, {
    title: '第一步落地',
    body: LOCAL_TEMPLATE,
    type: 'issue',
    parentKey: '00',
    idempotencyKey: 'local-1507-a',
  })
  check(!!(local && (local as { ok?: boolean }).ok), '② 本地模板照常能建：' + JSON.stringify(failOf(local)))
  check(keyOf(local) === '01', '② 本地模板票落在 01：' + keyOf(local))
  const localPath = path.join(localTmp, '.scratch', '本地模板', 'issues', '01-第一步落地.md')
  const localText = readText(localPath)
  check(/^# 01: 第一步落地$/m.test(localText), '② 标题写成「# NN: 标题」')
  check(localText.indexOf('**What to build:** 用户能看到第一步。') >= 0, '② What to build 字段行保留')
  check(/^\*\*Blocked by:\*\* 03$/m.test(localText), '② Blocked by 字段行保留编号')
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(localText), '② Status 字段行保留')
  check(/^- \[ \] 能看到结果$/m.test(localText), '② 验收项保留')
  check(!/^## (Parent|What to build|Acceptance criteria|Blocked by)/m.test(localText), '② 落盘的票里没有远端四段标题')

  const localRead = await readBack(localCtx, localRepo, '01')
  const localData = (localRead && (localRead as { ok?: boolean }).ok ? (localRead as { data?: Record<string, unknown> }).data : null) || {}
  check(!!(localRead && (localRead as { ok?: boolean }).ok), '② 建完读得回来：' + JSON.stringify(failOf(localRead)))
  check(String(localData.body || '') === localText, '② 读回来的正文与磁盘上写下去的一致')
  check(String(localData.title || '') === '第一步落地', '② 读回来的标题一致：' + String(localData.title || ''))
  check(String(localData.state || '') === 'open', '② 读回来的状态是 open（ready-for-agent 属于未关闭）：' + String(localData.state || ''))
  const localEdges = Array.isArray(localData.blockedBy) ? (localData.blockedBy as Record<string, unknown>[]) : []
  check(localEdges.length === 1 && String(localEdges[0].key || '') === '03', '② 读回来的阻塞边是 03：' + JSON.stringify(localEdges))

  // ══ ③ 新建的票必然带 Status 行 ══
  const statusTmp = tmpDir('md-1507-status-')
  const statusCtx = mkctx(statusTmp)
  const statusRepo = repoOf('状态', 'feature')
  const noStatus = await create(statusCtx, statusRepo, {
    title: '没给状态',
    body: '**What to build:** 没给状态也要有 Status 行。',
    type: 'issue',
    idempotencyKey: 'status-1507-a',
  })
  check(!!(noStatus && (noStatus as { ok?: boolean }).ok), '③ 没给状态的票建得成：' + JSON.stringify(failOf(noStatus)))
  const noStatusText = readText(path.join(statusTmp, '.scratch', '状态', 'issues', '01-没给状态.md'))
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(noStatusText), '③ 没给状态时落成模板默认值 ready-for-agent')
  check((noStatusText.match(/^\*\*Status:\*\*/gm) || []).length === 1, '③ 只有一行 Status，不重复')
  check(headerComments(noStatusText).indexOf('<!-- DSH-STATUS: ready-for-agent -->') < 0, '③ 实施票不另写隐藏状态（可见行就是状态）')

  const blankStatus = await create(statusCtx, statusRepo, {
    title: '空白状态',
    body: '**What to build:** 只给空白状态也要落成默认值。',
    type: 'issue',
    status: '   ',
    idempotencyKey: 'status-1507-b',
  })
  check(!!(blankStatus && (blankStatus as { ok?: boolean }).ok), '③ 只给空白状态也建得成：' + JSON.stringify(failOf(blankStatus)))
  const blankText = readText(path.join(statusTmp, '.scratch', '状态', 'issues', '02-空白状态.md'))
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(blankText), '③ 只给空白状态时仍落成 ready-for-agent：' + JSON.stringify(blankText.split('\n').filter((l) => /Status/.test(l))))
  check(!/^\*\*Status:\*\*[ \t]*$/m.test(blankText), '③ 不出现只有标签、没有值的 Status 行')

  const specInput = await create(statusCtx, repoOf(), {
    title: '空白状态规格',
    body: '## Problem Statement\n\n规格的状态只进隐藏注释。',
    type: 'spec',
    status: '   ',
    idempotencyKey: 'status-1507-spec',
  })
  check(!!(specInput && (specInput as { ok?: boolean }).ok), '③ 只给空白状态的规格也建得成：' + JSON.stringify(failOf(specInput)))
  const specText = readText(path.join(statusTmp, '.scratch', '空白状态规格', 'spec.md'))
  check(specText.indexOf('<!-- DSH-STATUS: ready-for-agent -->') >= 0, '③ 规格只给空白状态时也落成默认值：' + JSON.stringify(headerComments(specText)))

  // ══ ④ Blocked by 只写编号、不带井号；隐藏字段与可见行同一件事 ══
  const edgeTmp = tmpDir('md-1507-edges-')
  const edgeCtx = mkctx(edgeTmp)
  const edgeRepo = repoOf('阻塞', 'feature')

  const numbered = await create(edgeCtx, edgeRepo, {
    title: '按数组给阻塞',
    body: '**What to build:** 数组形态的阻塞编号。',
    type: 'issue',
    blockedBy: ['5'],
    idempotencyKey: 'edge-1507-a',
  })
  check(!!(numbered && (numbered as { ok?: boolean }).ok), '④ 带阻塞边的新票建得成：' + JSON.stringify(failOf(numbered)))
  const numberedText = readText(path.join(edgeTmp, '.scratch', '阻塞', 'issues', '01-按数组给阻塞.md'))
  const numberedLines = blockedLines(numberedText)
  check(numberedLines.visible === '05', '④ 可见行只写编号，不写 #05：' + JSON.stringify(numberedLines.visible))
  check(numberedText.indexOf('Blocked by:** #') < 0, '④ 落盘的票里没有「**Blocked by:** #」这种写法')
  check(numberedLines.hidden === numberedLines.visible, '④ 隐藏字段与可见行一致：可见 ' + JSON.stringify(numberedLines.visible) + ' / 隐藏 ' + JSON.stringify(numberedLines.hidden))

  const fromBody = await create(edgeCtx, edgeRepo, {
    title: '正文自带阻塞',
    body: '**What to build:** 正文里写了带井号的阻塞行。\n\n**Blocked by:** #05\n',
    type: 'issue',
    idempotencyKey: 'edge-1507-b',
  })
  check(!!(fromBody && (fromBody as { ok?: boolean }).ok), '④ 正文自带阻塞行也建得成：' + JSON.stringify(failOf(fromBody)))
  const fromBodyText = readText(path.join(edgeTmp, '.scratch', '阻塞', 'issues', '02-正文自带阻塞.md'))
  const fromBodyLines = blockedLines(fromBodyText)
  check(fromBodyLines.visible === '05', '④ 正文里的 #05 落盘时去掉井号：' + JSON.stringify(fromBodyLines.visible))
  check(fromBodyLines.hidden === '05', '④ 正文里的阻塞边同样写进隐藏字段：' + JSON.stringify(fromBodyLines.hidden))
  check(fromBodyLines.hidden === fromBodyLines.visible, '④ 正文形态下两行也一致')

  const twoKeys = await create(edgeCtx, edgeRepo, {
    title: '两条阻塞',
    body: '**What to build:** 两条阻塞边。',
    type: 'issue',
    blockedBy: ['03', '04'],
    idempotencyKey: 'edge-1507-c',
  })
  check(!!(twoKeys && (twoKeys as { ok?: boolean }).ok), '④ 两条阻塞边建得成')
  const twoText = readText(path.join(edgeTmp, '.scratch', '阻塞', 'issues', '03-两条阻塞.md'))
  const twoLines = blockedLines(twoText)
  check(twoLines.visible === '03, 04', '④ 多条编号用逗号隔开、不带井号：' + JSON.stringify(twoLines.visible))
  check(twoLines.hidden === '03, 04', '④ 多条时隐藏字段与可见行一致：' + JSON.stringify(twoLines.hidden))

  const noEdge = await create(edgeCtx, edgeRepo, {
    title: '没有阻塞',
    body: '**What to build:** 没有阻塞边也要写明。',
    type: 'issue',
    idempotencyKey: 'edge-1507-d',
  })
  check(!!(noEdge && (noEdge as { ok?: boolean }).ok), '④ 没有阻塞边建得成')
  const noEdgeText = readText(path.join(edgeTmp, '.scratch', '阻塞', 'issues', '04-没有阻塞.md'))
  const noEdgeLines = blockedLines(noEdgeText)
  check(noEdgeLines.visible === 'None (can start immediately)', '④ 没有阻塞时可见行仍是原文的 None (can start immediately)：' + JSON.stringify(noEdgeLines.visible))
  check(noEdgeLines.hidden === '', '④ 没有阻塞时不写隐藏阻塞字段')

  const hashOnly = await create(edgeCtx, edgeRepo, {
    title: '只剩井号',
    body: '**What to build:** 正文那行只剩一个井号。\n\n**Blocked by:** #\n',
    type: 'issue',
    idempotencyKey: 'edge-1507-e',
  })
  check(!!(hashOnly && (hashOnly as { ok?: boolean }).ok), '④ 正文阻塞行只剩井号时也建得成')
  const hashOnlyText = readText(path.join(edgeTmp, '.scratch', '阻塞', 'issues', '05-只剩井号.md'))
  check(blockedLines(hashOnlyText).visible === 'None (can start immediately)', '④ 井号后面没有编号时按「没有阻塞」写：' + JSON.stringify(blockedLines(hashOnlyText).visible))

  // ══ ⑤ 地图正文为空时不再写占位注释 ══
  const emptyMap = ensureBody('', 'map')
  check(emptyMap.body.indexOf('这张地图的正文由') < 0, '⑤ 空地图正文里没有那句占位注释：' + JSON.stringify(emptyMap.body.slice(0, 80)))
  check(emptyMap.body.indexOf('<!--') < 0, '⑤ 空地图正文里没有任何注释')
  check(emptyMap.body.replace(/^\s+/, '').indexOf('## Destination') === 0, '⑤ 空地图正文以原文第一段「## Destination」开头')
  check(countProgress(emptyMap.body) === 1, '⑤ 空地图正文只补一段进度')
  check(emptyMap.body.indexOf('## Destination') < emptyMap.body.indexOf('## 进度'), '⑤ 五个区块都在进度区之前')
  const renderedMap = renderMap({
    title: '空地图',
    body: emptyMap.body,
    status: '',
  } as never, {
    createdAt: '2026-01-01T00:00:00.000Z',
    idempotencyKey: 'map-1507-empty',
    labels: ['wayfinder:map'],
    assignees: [],
  })
  check(renderedMap.indexOf('这张地图的正文由') < 0, '⑤ 渲染出来的地图正文也没有占位注释')
  check(renderedMap.indexOf('## Destination') > 0 && renderedMap.indexOf('## Destination') < renderedMap.indexOf('## 进度'), '⑤ 渲染后第一段是 Destination、进度在最后')

  // ══ 回归：旁边已有的旧格式票不影响新票（守卫只看这次请求的正文，不去读别人的文件） ══
  const legacyTmp = tmpDir('md-1507-legacy-')
  const legacyCtx = mkctx(legacyTmp)
  const legacyRepo = repoOf('老票邻', 'feature')
  const legacyPath = path.join(legacyTmp, '.scratch', '老票邻', 'issues', '01-老票.md')
  const legacyText = '# 01: 老票\n\n## Problem Statement\n\n这一段是旧写法，没有 Status 行。\n'
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
  fs.writeFileSync(legacyPath, legacyText, 'utf8')
  const fresh = await create(legacyCtx, legacyRepo, {
    title: '新票',
    body: '**What to build:** 旁边有旧票也照常建。',
    type: 'issue',
    idempotencyKey: 'legacy-1507-a',
  })
  check(!!(fresh && (fresh as { ok?: boolean }).ok), '回归：旁边有旧格式票时新票照常建：' + JSON.stringify(failOf(fresh)))
  check(keyOf(fresh) === '02', '回归：新票按顺序落在 02：' + keyOf(fresh))
  check(readText(legacyPath) === legacyText, '回归：旧票文件一个字节都没动')

  // ══ ⑦ 容器（规格）不受四段判据管：同一份四段正文写给规格，照常建得出来 ══
  // 这是「哪些形状受管」的外部证据：#1510 那扇门禁用纯函数钉分派表本身，这里走真正的建票入口，
  // 有人把 spec 加进受管清单，规格就建不出来了，这条会红。
  const containerTmp = tmpDir('md-1507-container-')
  const containerCtx = mkctx(containerTmp)
  const specBody = '## Problem Statement\n\n规格正文。\n\n' + REMOTE_FOUR
  const specMade = await create(containerCtx, repoOf(), {
    title: '容器豁免规格',
    body: specBody,
    type: 'spec',
    idempotencyKey: 'container-1507-a',
  })
  check(!!(specMade && (specMade as { ok?: boolean }).ok), '⑦ 规格正文里出现远端四段也照常建：' + JSON.stringify(failOf(specMade)))
  const specFile = readText(path.join(containerTmp, '.scratch', '容器豁免规格', 'spec.md'))
  check(specFile.indexOf('## Parent') >= 0, '⑦ 规格正文里那份四段原样留着（容器不做模板判据）')

  // ══ 汇总 ══
  console.log('')
  if (failures.length) {
    console.log('verify-1507-create-strict: ' + failures.length + ' 条没过（共 ' + checks + ' 条）')
    for (const line of failures) console.log('  - ' + line)
    process.exitCode = 1
    return
  }
  console.log('verify-1507-create-strict: 全过（共 ' + checks + ' 条）')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
