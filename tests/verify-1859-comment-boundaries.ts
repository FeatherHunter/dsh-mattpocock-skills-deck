// tests/verify-1859-comment-boundaries.ts —— #1859 回归：评论正文里的标题行不再被当成文件结构。
//
// 这一扇守的是「一条评论的正文到哪里结束」这一件事：
//   · 正文里出现 `## 二级标题`、`### 三级标题`、围栏代码块里的标题，都仍然是这条评论的正文；
//   · 正文中间单独一行 `---` 是内容，只有评论块末尾那条分隔线才去掉；
//   · 追加第二条评论时，新评论接在评论区末尾，不能插进上一条评论的正文中间；
//   · 关闭原因、地图子票的 `## Answer`、手写旧票的评论区，都走同一套边界判断。
//
// 这张票只修「判断」，不改磁盘上的可见格式；正文里恰好出现已知段名（例如 `## Answer`），
// 或者恰好长得像真实评论头（`### 名字 — 2026-01-01T00:00:00.000Z`），仍然可能误判——
// 那是换磁盘格式才能彻底解决的事，本门禁不把它写成已解决。
// 另外，真实评论头之后的手写旧头（没有 ISO 时间）无法和正文里的 H3 区分，本门禁只保证
// 追加评论不会制造这种形状；CRLF 文件按 LF 读回正文，不保留原换行符。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1859-comment-boundaries.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMd } from '../src/tracker/rooms/markdown/parse.ts'
import { appendSectionBlock } from '../src/tracker/rooms/markdown/original-fields.ts'
import { mergeWholeBodyForPatch } from '../src/tracker/rooms/markdown/patch-body.ts'
import { createIssue, closeIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { addComment, listComments } from '../src/tracker/rooms/markdown/comments.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}
function same(actual: unknown, expected: unknown, msg: string): void {
  check(actual === expected, msg + '（实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected) + '）')
}
function bodiesOf(text: string): string[] {
  return (parseMd(text, { key: '01' }).comments || []).map((one) => one.body)
}
function commentTicket(body: string): string {
  return '# 票\n\nStatus: ready-for-agent\n\n## Comments\n\n' +
    '### local \u2014 2026-11-03T00:00:00.000Z\n\n' + body + '\n'
}

// ══ 第一段：只读解析 —— 标题行、围栏、分隔线都留在评论正文里 ══
function testParser(): void {
  const h2 = commentTicket('先给结论。\n\n## 这段是二级标题\n\n后面还有内容。')
  const h2Bodies = bodiesOf(h2)
  same(h2Bodies.length, 1, 'H2 标题行不截断评论区，仍是一条评论')
  same(h2Bodies[0], '先给结论。\n\n## 这段是二级标题\n\n后面还有内容。', 'H2 标题行逐字留在评论正文里')

  const h3 = commentTicket('先给结论。\n### 这段是三级标题\n后面还有内容。')
  const h3Bodies = bodiesOf(h3)
  same(h3Bodies.length, 1, 'H3 标题行不再凭空造出第二条评论')
  same(h3Bodies[0], '先给结论。\n### 这段是三级标题\n后面还有内容。', 'H3 标题行逐字留在评论正文里')

  const plain = '先给结论。\n\n##\n\n##\t制表符后面没有标题文字\n\n  ## 两格缩进的标题\n\n#### 四级标题\n\n# 一级标题\n\n\\## 一个反斜杠\n\n\\\\## 两个反斜杠\n\n###\n\n后面还有内容。'
  const plainBodies = bodiesOf(commentTicket(plain))
  same(plainBodies.length, 1, '裸标题、缩进、tab、四级/一级标题、反斜杠行都不拆评论')
  same(plainBodies[0], plain, '这些行逐字留在评论正文里')

  const fence = commentTicket('示例：\n\n\u0060\u0060\u0060md\n## 围栏里的二级标题\n### 围栏里的三级标题\n---\n\u0060\u0060\u0060\n\n结束。')
  const fenceBodies = bodiesOf(fence)
  same(fenceBodies.length, 1, '围栏代码块里的标题行不拆评论')
  same(fenceBodies[0], '示例：\n\n\u0060\u0060\u0060md\n## 围栏里的二级标题\n### 围栏里的三级标题\n---\n\u0060\u0060\u0060\n\n结束。', '围栏代码块里的标题与分隔线逐字保留')

  const middleRule = commentTicket('第一段。\n\n---\n\n第二段。')
  same(bodiesOf(middleRule)[0], '第一段。\n\n---\n\n第二段。', '正文中间的单独一行 --- 是内容，不截断')

  const tailRule = commentTicket('正文。\n\n---')
  same(bodiesOf(tailRule)[0], '正文。\n\n---', '评论区最后一块后面的 --- 是用户正文，不是块间分隔线，原样保留')

  const crlf = '# 票\r\n\r\n## Comments\r\n\r\n### local \u2014 2026-11-03T00:00:00.000Z\r\n\r\n第一段。\r\n\r\n## 正文里的标题\r\n\r\n后文。\r\n'
  const crlfBodies = bodiesOf(crlf)
  same(crlfBodies.length, 1, 'CRLF 票的评论区仍读得到')
  same(crlfBodies[0], '第一段。\n\n## 正文里的标题\n\n后文。', 'CRLF 票的评论正文按 LF 读回，内容不丢')

  // 第二条评论的第一条正文里含有假二级标题：新评论不能被插进上一条正文中间。
  const two = '# 票\n\n## Comments\n\n' +
    '### local \u2014 2026-11-03T00:00:00.000Z\n\n先给结论。\n\n## 正文里的标题\n\n后文。\n\n---\n\n' +
    '### local \u2014 2026-11-03T01:00:00.000Z\n\n第二条。\n'
  const twoBodies = bodiesOf(two)
  same(twoBodies.length, 2, '两条真实评论都读得到')
  same(twoBodies[0], '先给结论。\n\n## 正文里的标题\n\n后文。', '第一条含 H2 的正文完整')
  same(twoBodies[1], '第二条。', '第二条评论正文完整')

  const noSpaceAnchor = '# 票\n\n##Comments\n\n### local \u2014 2026-11-03T00:00:00.000Z\n\n评论。\n'
  same(bodiesOf(noSpaceAnchor).length, 1, '##Comments（无空格）与 ## Comments 是同一个评论区锚点')

  const fakeAnchor = '# 票\n\n描述里提到：\n\n## Comments\n\n这不是真的评论区。\n\n## Comments\n\n' +
    '### local \u2014 2026-11-03T00:00:00.000Z\n\n真评论。\n'
  const fakeBodies = bodiesOf(fakeAnchor)
  same(fakeBodies.length, 1, '正文里先出现的假 ## Comments 不会盖住后面的真评论区')
  same(fakeBodies[0], '真评论。', '只读后面那个真实评论区里的评论')

  // 假锚后面恰好跟一行 H3（会被手写旧头判据认成评论头）：真实评论头更可信，不能被假锚抢走。
  const fakeWithH3 = '# 票\n\n## Comments\n\n描述\n\n### 这不是评论头\n\n## Comments\n\n' +
    '### local \u2014 2026-11-03T00:00:00.000Z\n\n真评论。\n'
  const fakeWithH3Bodies = bodiesOf(fakeWithH3)
  same(fakeWithH3Bodies.length, 1, '假锚后面跟一行 H3 时，后面的真实评论区仍是选中的锚')
  same(fakeWithH3Bodies[0], '真评论。', '假锚与它后面的 H3 都没有变成评论')

  // 真评论区之后，评论正文里又出现一行假 ## Comments：锚不能被它抢走（反过来更糟：两条真评论会整段消失）。
  const fakeAfter = '# 票\n\n## Comments\n\n### local \u2014 2026-11-03T00:00:00.000Z\n\n' +
    '第一段。\n\n## Comments\n\n第二段。\n'
  const fakeAfterBodies = bodiesOf(fakeAfter)
  same(fakeAfterBodies.length, 1, '评论正文里后出现的假 ## Comments 不抢锚点')
  same(fakeAfterBodies[0], '第一段。\n\n## Comments\n\n第二段。', '假锚前后的正文都留在同一条评论里')

  const progressPercent = '# 票\n\n## Comments\n\n### local \u2014 2026-11-03T00:00:00.000Z\n\n评论。\n\n## 进度：30%\n\n- 进度：30%\n'
  same(bodiesOf(progressPercent)[0], '评论。', '带百分比的旧进度标题仍算评论区结束边界')
  const progressAppended = appendSectionBlock(progressPercent, 'Comments', '### local \u2014 2026-11-03T01:00:00.000Z\n\n新评论。')
  check(progressAppended.indexOf('新评论。') >= 0 && progressAppended.indexOf('新评论。') < progressAppended.indexOf('## 进度：30%'),
    '带百分比的进度区仍在评论区之后，新评论追加在进度区前面')

  const legacyNoIso = '# 旧票\n\n正文\n\n## Comments\n\n### local \u2014 2026-10-01\n\n旧评论。\n'
  const legacyComments = parseMd(legacyNoIso, { key: '01' }).comments || []
  same(legacyComments.length, 1, '没有 ISO 时间的手写旧评论仍读得到')
  same(legacyComments[0].author.login, 'local', '无 ISO 旧评论的用户名仍按分隔符切出')
  same(legacyComments[0].body, '旧评论。', '无 ISO 旧评论的正文完整')

  // 追加位置：新评论接在评论区末尾，不插进上一条评论的正文中间。
  const appended = appendSectionBlock(two, 'Comments', '### local \u2014 2026-11-03T02:00:00.000Z\n\n第三条。')
  const afterBodyAt = appended.indexOf('后文。')
  const thirdAt = appended.indexOf('第三条。')
  const secondBodyAt = appended.indexOf('第二条。')
  check(afterBodyAt >= 0 && thirdAt >= 0 && afterBodyAt < thirdAt, '追加的新评论在上一条正文之后，不插进正文中间')
  check(secondBodyAt >= 0 && thirdAt > secondBodyAt, '追加的新评论在评论区末尾')
}

// ══ 第二段：真实 API —— 发评论、读评论、关票原因、地图 Answer、旧票追加 ══
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
type LogLine = { level: string; event: string; fields: Record<string, unknown> }
function mkctx(cwd: string) {
  const plat = platformStub()
  const events: LogLine[] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
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
/** 读评论并把失败形状压成空数组：测试只关心「读出来了几条、正文是什么」。 */
async function commentsOf(ctx: unknown, repo: Record<string, unknown>, key: string): Promise<Array<{ body: string }>> {
  const got = await listComments(ctx as never, repo as never, key)
  return got.ok ? (got.data || []) : []
}

async function testApi(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1859-'))
  const ctx = mkctx(tmp)
  const spec = await create(ctx, repoOf(), {
    title: '评论边界',
    body: '## Problem Statement\n\n评论正文里的标题行不该被当成文件结构。',
    type: 'spec',
    idempotencyKey: 'spec-1859',
  })
  check(!!(spec && spec.ok), '前置：规格建得成')
  const featureRepo = repoOf('评论边界', 'feature')
  const impl = await create(ctx, featureRepo, {
    title: '第一条',
    body: '**What to build:** 评论正文原样往返。',
    type: 'issue',
    parentKey: '00',
    idempotencyKey: 'impl-1859',
  })
  check(!!(impl && impl.ok), '前置：实施票建得成')
  const implPath = path.join(tmp, '.scratch', '评论边界', 'issues', '01-第一条.md')
  const ticketHead = readText(implPath).split('\n## Comments')[0]

  const first = '先给结论。\n\n## 这段是二级标题\n\n后面还有内容。'
  const firstAdd = await addComment(ctx as never, featureRepo as never, '01', first)
  check(!!(firstAdd && firstAdd.ok), '① 发一条含 H2 的评论成功')
  const afterFirst = await listComments(ctx as never, featureRepo as never, '01')
  same(afterFirst.ok && (afterFirst.data || []).length, 1, '① 发完读回只有一条评论')
  same(afterFirst.ok && afterFirst.data[0].body, first, '① H2 评论正文逐字往返')

  const second = '再补一句。\n### 这段是三级标题\n后面还有内容。'
  const secondAdd = await addComment(ctx as never, featureRepo as never, '01', second)
  check(!!(secondAdd && secondAdd.ok), '② 发第二条含 H3 的评论成功')
  const afterSecond = await listComments(ctx as never, featureRepo as never, '01')
  same(afterSecond.ok && (afterSecond.data || []).length, 2, '② 两条评论都读得到，H3 没有造出伪评论')
  same(afterSecond.ok && afterSecond.data[1].body, second, '② 第二条评论正文逐字往返')
  const rawAfterSecond = readText(implPath)
  check((rawAfterSecond.match(/^### local \u2014 /gm) || []).length === 2, '② 磁盘上仍只有两个真实评论头')
  same(rawAfterSecond.split('\n## Comments')[0], ticketHead, '② 追加评论不改动票面正文（评论区之前的原文逐字不变）')
  const firstTailAt = rawAfterSecond.indexOf('后面还有内容。')
  const secondHeadAt = rawAfterSecond.indexOf(second.split('\n')[0])
  check(firstTailAt >= 0 && secondHeadAt >= 0 && firstTailAt < secondHeadAt, '② 第二条评论头在第一条正文之后，不插进正文中间')

  const fenced = '示例：\n\n\u0060\u0060\u0060md\n## 围栏里的标题\n---\n\u0060\u0060\u0060\n\n结束。'
  const fencedAdd = await addComment(ctx as never, featureRepo as never, '01', fenced)
  check(!!(fencedAdd && fencedAdd.ok), '③ 发含围栏标题的评论成功')
  const afterFenced = await listComments(ctx as never, featureRepo as never, '01')
  same(afterFenced.ok && (afterFenced.data || []).length, 3, '③ 三条评论都读得到')
  same(afterFenced.ok && afterFenced.data[2].body, fenced, '③ 围栏里的标题行逐字往返')

  // 关闭实施票：原因里带 H2，读回仍是一条完整评论；重复关闭不再追加。
  const reason = '这一步做完了。\n\n## 结论\n\n全部完成。'
  const closed = await closeIssue(ctx as never, featureRepo as never, '01', { reason } as never)
  check(!!(closed && closed.ok), '④ 关闭实施票成功')
  const afterClose = await listComments(ctx as never, featureRepo as never, '01')
  same(afterClose.ok && (afterClose.data || []).length, 4, '④ 关闭原因成为第四条评论')
  same(afterClose.ok && afterClose.data[3].body, reason, '④ 关闭原因含 H2 也逐字往返')
  await closeIssue(ctx as never, featureRepo as never, '01', { reason } as never)
  const afterAgain = await listComments(ctx as never, featureRepo as never, '01')
  same(afterAgain.ok && (afterAgain.data || []).length, 4, '④ 重复关闭是幂等的，不再追加评论')

  const state = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(state && state.ok && state.data.state === 'closed'), '④ 关闭后读回的状态仍是 closed')

  // 地图子票：关闭原因里带 H2，Answer 段要完整；重复关闭不重复写。
  const mapTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1859-map-'))
  const mapCtx = mkctx(mapTmp)
  const effortRepo = repoOf('effort-1859', 'effort')
  const map = await create(mapCtx, effortRepo, {
    title: '地图甲', body: '先把边界摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1859',
  })
  check(!!(map && map.ok), '前置：地图建得成')
  const child = await create(mapCtx, effortRepo, {
    title: '第一条线索', body: '先把已知方案列出来。', type: 'issue', typeLine: 'research',
    labels: ['wayfinder:research'], parentKey: '00', idempotencyKey: 'child-1859',
  })
  check(!!(child && child.ok), '前置：地图子票建得成')
  const childPath = path.join(mapTmp, '.scratch', 'effort-1859', 'issues')
  const childFile = fs.readdirSync(childPath).filter((name) => name.indexOf('01-') === 0)[0]
  const childFull = path.join(childPath, childFile)
  const mapReason = '第一步做完了。\n\n## 附注\n\n还有下文。'
  const childClosed = await closeIssue(mapCtx as never, effortRepo as never, '01', { reason: mapReason } as never)
  check(!!(childClosed && childClosed.ok), '⑤ 关闭地图子票成功')
  const childAfter = readText(childFull)
  check((childAfter.match(/^## Answer$/gm) || []).length === 1, '⑤ 地图子票只有一个 ## Answer 段')
  check(childAfter.indexOf('第一步做完了。\n\n## 附注\n\n还有下文。') >= 0, '⑤ Answer 段完整保留含 H2 的原因')
  await closeIssue(mapCtx as never, effortRepo as never, '01', { reason: mapReason } as never)
  const childAgain = readText(childFull)
  check((childAgain.match(/^## Answer$/gm) || []).length === 1, '⑤ 重复关闭不重复写 ## Answer')
  check((childAgain.match(/还有下文。/g) || []).length === 1, '⑤ 重复关闭不重复写答案正文')

  // 手写旧票（legacy）：追加评论要接在真评论区里，不能因为正文里的 H2 把旧评论截掉。
  const legacyRepo = repoOf('effort-1859-legacy')
  const legacyPath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '01-旧票.md')
  writeText(legacyPath,
    '# 旧票\n\n正文\n\nStatus: ready-for-agent\nType: task\n\n## Comments\n\n' +
    '### local \u2014 2026-10-01T00:00:00.000Z\n\n旧评论。\n')
  const legacyAdd = await addComment(ctx as never, legacyRepo as never, '01', '先给结论。\n\n## 二级标题\n\n后面还有内容。')
  check(!!(legacyAdd && legacyAdd.ok), '⑥ 旧票追加评论成功')
  const legacyList = await listComments(ctx as never, legacyRepo as never, '01')
  same(legacyList.ok && (legacyList.data || []).length, 2, '⑥ 旧票的两条评论都读得到')
  same(legacyList.ok && legacyList.data[0].body, '先给结论。\n\n## 二级标题\n\n后面还有内容。', '⑥ 旧票新评论正文完整')
  same(legacyList.ok && legacyList.data[1].body, '旧评论。', '⑥ 旧票的旧评论没有被截掉')
  const legacyRaw = readText(legacyPath)
  check((legacyRaw.match(/^##\s*Comments\s*$/gm) || []).length === 1, '⑥ 旧票只有一个评论区锚点')

  // 旧票的旧评论头没有 ISO 时间：新评论不能盖在它前面，否则读侧只认第一个真实头之前的旧头，旧评论会消失。
  const weakPath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '04-手写头.md')
  writeText(weakPath,
    '# 手写头旧票\n\n正文\n\nStatus: ready-for-agent\nType: task\n\n## Comments\n\n' +
    '### alice\n\n旧评论甲。\n\n### bob\n\n旧评论乙。\n')
  const weakAdd = await addComment(ctx as never, legacyRepo as never, '04', '新评论。')
  check(!!(weakAdd && weakAdd.ok), '⑥b 没有 ISO 旧头的旧票追加评论成功')
  const weakList = await commentsOf(ctx, legacyRepo, '04')
  same(weakList.length, 3, '⑥b 两条手写旧评论与新评论都读得到')
  check(weakList.some((one) => one.body === '旧评论甲。'), '⑥b 旧评论甲没有被吞进新评论正文')
  check(weakList.some((one) => one.body === '旧评论乙。'), '⑥b 旧评论乙没有被吞进新评论正文')
  check(weakList.some((one) => one.body === '新评论。'), '⑥b 新评论自己也没有被吞掉')

  // 评论正文里后出现一行假 ## Comments：真评论区的旧评论不能被挤掉（读写选锚一致）。
  const afterFakePath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '05-后置假锚.md')
  writeText(afterFakePath,
    '# 后置假锚旧票\n\n正文\n\nStatus: ready-for-agent\nType: task\n\n## Comments\n\n' +
    '### local \u2014 2026-10-01T00:00:00.000Z\n\n第一段。\n\n## Comments\n\n第二段。\n')
  const afterFakeAdd = await addComment(ctx as never, legacyRepo as never, '05', '新评论。')
  check(!!(afterFakeAdd && afterFakeAdd.ok), '⑥c 正文后置假锚的旧票追加评论成功')
  const afterFakeList = await commentsOf(ctx, legacyRepo, '05')
  same(afterFakeList.length, 2, '⑥c 旧评论与新评论都读得到，假锚没有吃掉旧评论区')
  check(afterFakeList.some((one) => one.body === '第一段。\n\n## Comments\n\n第二段。'), '⑥c 旧评论正文里的假 ## Comments 原样保留')
  const afterFakeRaw = readText(afterFakePath)
  // 正文里本来就有一行假 ## Comments，所以全文会有两行同名标题：一行是真锚，一行是评论正文。
  check((afterFakeRaw.match(/^##\s*Comments\s*$/gm) || []).length === 2, '⑥c 正文后置假锚的旧票没有在文末再建第二个评论区（全文只有真锚与正文里的那一行）')

  // CRLF 文件：评论区与评论头都要认得出，追加后旧评论不能消失。
  const crlfPath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '06-CRLF.md')
  writeText(crlfPath,
    '# CRLF旧票\r\n\r\n正文\r\n\r\nStatus: ready-for-agent\r\nType: task\r\n\r\n## Comments\r\n\r\n' +
    '### local \u2014 2026-10-01T00:00:00.000Z\r\n\r\n旧评论。\r\n')
  const crlfAdd = await addComment(ctx as never, legacyRepo as never, '06', '新评论。')
  check(!!(crlfAdd && crlfAdd.ok), '⑥d CRLF 旧票追加评论成功')
  const crlfList = await commentsOf(ctx, legacyRepo, '06')
  same(crlfList.length, 2, '⑥d CRLF 旧票的旧评论与新评论都读得到')
  const crlfRaw = readText(crlfPath)
  check((crlfRaw.match(/^##\s*Comments\s*$/gm) || []).length === 1, '⑥d CRLF 旧票没有在文末再建第二个评论区')

  // 旧票的 ##Comments（无空格）也要认同一把锚，不能把新评论插到另一个段里。
  const noSpacePath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '02-无空格.md')
  writeText(noSpacePath,
    '# 无空格旧票\n\n正文\n\nStatus: ready-for-agent\nType: task\n\n##Comments\n\n' +
    '### local \u2014 2026-10-01T00:00:00.000Z\n\n旧评论。\n')
  const noSpaceAdd = await addComment(ctx as never, legacyRepo as never, '02', '新评论。')
  check(!!(noSpaceAdd && noSpaceAdd.ok), '⑦ ##Comments 无空格旧票追加评论成功')
  const noSpaceList = await listComments(ctx as never, legacyRepo as never, '02')
  same(noSpaceList.ok && (noSpaceList.data || []).length, 2, '⑦ 无空格锚点里的新旧评论都读得到')
  const noSpaceRaw = readText(noSpacePath)
  check((noSpaceRaw.match(/^##\s*Comments\s*$/gm) || []).length === 1, '⑦ 无空格旧票没有被再建出第二个评论区')

  // 正文里先有一个假 ## Comments：读写都认最后一个真锚，不把假段当评论区。
  const fakePath = path.join(tmp, '.scratch', 'effort-1859-legacy', 'issues', '03-假锚.md')
  writeText(fakePath,
    '# 假锚旧票\n\n描述里提到：\n\n## Comments\n\n这不是真的评论区。\n\n## Comments\n\n' +
    '### local \u2014 2026-10-01T00:00:00.000Z\n\n旧评论。\n')
  const fakeAdd = await addComment(ctx as never, legacyRepo as never, '03', '新评论。')
  check(!!(fakeAdd && fakeAdd.ok), '⑧ 正文里有假 ## Comments 的旧票追加评论成功')
  const fakeList = await listComments(ctx as never, legacyRepo as never, '03')
  same(fakeList.ok && (fakeList.data || []).length, 2, '⑧ 假锚没有变成一条评论，真评论仍读得到')
  same(fakeList.ok && fakeList.data.some((one) => one.body === '这不是真的评论区。'), false, '⑧ 假锚里的文字没有被当成评论')

  // 整份改正文时，评论段要一直搬到 Answer（或文末），不能因为正文里的 H2 被截短。
  const disk = '# 票\n\n## Comments\n\n### local \u2014 2026-11-03T00:00:00.000Z\n\n' +
    '第一段。\n\n## 正文里的标题\n\n后文。\n\n## Answer\n\n答案。\n'
  const merged = mergeWholeBodyForPatch('# 票\n\n新正文。\n', disk)
  check(merged.indexOf('第一段。') >= 0 && merged.indexOf('## 正文里的标题') >= 0 && merged.indexOf('后文。') >= 0,
    '⑨ 整份改正文时，含 H2 的旧评论段整段搬回，不被截短')
  check(merged.indexOf('## Answer') >= 0, '⑨ 整份改正文时 Answer 段仍在')

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(mapTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
}

testParser()
testApi()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    if (failed) {
      console.log('\nFAILED')
      process.exitCode = 1
    } else {
      console.log('\nALL PASS')
    }
  })
