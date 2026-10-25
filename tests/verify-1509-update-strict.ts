// verify-1509-update-strict.ts —— 改写也一次写对（#1509，父规格 #1506）。
// 门禁归属: src/tracker/rooms/markdown/template-guard.ts
// 门禁归属: src/tracker/rooms/markdown/issues-patch.ts
//
// 这一扇门禁守的是 #1509 的四条验收：
//   ① 整份正文替换带远端四段模板（## Parent / ## What to build / ## Acceptance criteria / ## Blocked by）
//      被拒绝：报错与新建票是同一套人话（点名哪几段、本地模板该写成什么样），
//      磁盘上一个字节都没变，错误里带回原文。
//   ② 正常的整份正文替换照样成功，getIssue 读回来的正文与写下去的一致。
//   ③ 只改状态、只加评论这类局部改动不走整份替换那条路，仍然成功，正文原样保留。
//   ④ 代码围栏（``` 与 ~~~）里的四段举例不算错，整份替换能成功，举例原样留在票里。
//   ⑤ 改写路径用的是 template-guard 的同一份判据与同一套文案，没有第二份四段标题正则/文案。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1509-update-strict.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIssue, getIssue, updateIssue, closeIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { addComment } from '../src/tracker/rooms/markdown/comments.ts'
import { remoteTemplateRefusalFor, remoteTemplateSections } from '../src/tracker/rooms/markdown/template-guard.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

async function update(ctx: unknown, repo: Record<string, unknown>, key: string, patch: Record<string, unknown>) {
  return await updateIssue(ctx as never, repo as never, key, patch as never)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
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

/** 成功结果里的正文；失败时返回空串。 */
function bodyOf(result: unknown): string {
  const r = result as { ok?: boolean; data?: { body?: unknown } }
  return r && r.ok && r.data ? String(r.data.body || '') : ''
}

function okOf(result: unknown): boolean {
  return !!(result && (result as { ok?: boolean }).ok === true)
}

/** 目录里的文件名单（排序），用来证明被拒后没有留下半份文件或临时文件。 */
function namesIn(dir: string): string {
  try { return fs.readdirSync(dir).sort().join('\n') } catch { return '' }
}

/** 远端四段模板的原文：四段都在，模拟从 GitHub / Linear 整段复制过来的正文。 */
const REMOTE_FOUR = [
  '## Parent',
  '',
  '#1506 改写一次写对',
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

/** 这次要写的整份正文：它先满足「整份」的形状（有可见一级标题），正文里带着远端四段。 */
const WHOLE_REMOTE = '# 01: 四段模板票\n\n' + REMOTE_FOUR

/** 本地模板写法：一条字段行就能让正文按「整份」处理，内容本身完全合法。 */
const LOCAL_BODY = [
  '**What to build:** 用户能看到第一步。',
  '',
  '**Blocked by:** 03',
  '',
  '**Status:** ready-for-agent',
  '',
  '- [ ] 能看到结果',
  '',
].join('\n')

/** 围栏里的四段模板：只是举例，不是这次要写的模板。 */
const FENCED_WHOLE = [
  '# 01: 围栏里的例子',
  '',
  '**What to build:** 文档里要举例说明远端模板长什么样。',
  '',
  '**Status:** ready-for-agent',
  '',
  '- [ ] 例子照原样留在票里',
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
].join('\n')

async function main(): Promise<void> {
  // ══ ① 整份正文替换带远端四段：被拒，报错是同一套人话，磁盘一字节未变 ══
  const guardTmp = tmpDir('md-1509-guard-')
  const guardCtx = mkctx(guardTmp)
  const guardRepo = repoOf('改写防错', 'feature')
  const made = await create(guardCtx, guardRepo, {
    title: '四段模板票',
    body: LOCAL_BODY,
    type: 'issue',
    parentKey: '00',
    idempotencyKey: 'upd-1509-a',
  })
  check(okOf(made), '① 前置：本地模板的实施票建得成：' + JSON.stringify(failOf(made)))
  const guardKey = keyOf(made)
  const guardFile = path.join(guardTmp, '.scratch', '改写防错', 'issues', '01-四段模板票.md')
  const guardBefore = readText(guardFile)
  const guardDir = path.dirname(guardFile)
  const guardNamesBefore = namesIn(guardDir)
  check(guardBefore.length > 0 && guardBefore.indexOf('**What to build:**') >= 0, '① 前置：盘上这份票是本地模板写法')

  const rejected = await update(guardCtx, guardRepo, guardKey, { body: WHOLE_REMOTE })
  const rejectedFail = failOf(rejected)
  check(!okOf(rejected), '① 整份正文替换带远端四段时改不进去')
  check(rejectedFail.kind === 'parse', '① 拒绝的错型是 parse（判不出合法正文，不是环境或冲突）：' + rejectedFail.kind)
  check(rejectedFail.raw === WHOLE_REMOTE, '① 报错带回这次要写的原文，没有丢信息')
  check(rejectedFail.message.indexOf('## Parent') >= 0, '① 报错点名了「## Parent」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('## What to build') >= 0, '① 报错点名了「## What to build」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('## Acceptance criteria') >= 0, '① 报错点名了「## Acceptance criteria」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('## Blocked by') >= 0, '① 报错点名了「## Blocked by」：' + JSON.stringify(rejectedFail.message))
  check(
    rejectedFail.message.indexOf('**What to build:**') >= 0 &&
    rejectedFail.message.indexOf('**Blocked by:**') >= 0 &&
    rejectedFail.message.indexOf('**Status:**') >= 0,
    '① 报错给出了本地模板的三条字段行：' + JSON.stringify(rejectedFail.message),
  )
  check(rejectedFail.message.indexOf('# NN: 标题') >= 0, '① 报错说清本地标题写成「# NN: 标题」：' + JSON.stringify(rejectedFail.message))
  check(rejectedFail.message.indexOf('- [ ]') >= 0, '① 报错给出了本地验收项的写法：' + JSON.stringify(rejectedFail.message))
  check(readText(guardFile) === guardBefore, '① 拒绝后盘上这份票一个字节都没变')
  check(namesIn(guardDir) === guardNamesBefore, '① 拒绝后目录里没有多出半份文件或临时文件')

  // 同一份正文走新建那条路，报错必须是同一句 —— 两条路共用一份判据与一套文案（#1506）。
  const sections = remoteTemplateSections(WHOLE_REMOTE)
  check(sections.length === 4, '⑤ 判据认出四段（顺序原样）：' + JSON.stringify(sections))
  const createTwin = await create(guardCtx, guardRepo, {
    title: '新建对照票',
    body: WHOLE_REMOTE,
    type: 'issue',
    idempotencyKey: 'upd-1509-twin',
  })
  const twinFail = failOf(createTwin)
  check(!okOf(createTwin), '① 对照：同一份正文在新建那条路上也被拒')
  check(twinFail.message === remoteTemplateRefusalFor('issue', sections), '⑤ 新建的拒绝语来自 template-guard 的同一个函数')
  check(rejectedFail.message === twinFail.message, '① 整份改写与新建给的是同一句拒绝语（不是另写一份文案）')

  // ══ ③ 只改状态、只加评论：不走整份替换那条路，正文里带着远端段也照样成功 ══
  const partialTmp = tmpDir('md-1509-partial-')
  const partialCtx = mkctx(partialTmp)
  const partialRepo = repoOf('局部改动', 'feature')
  const partialFile = path.join(partialTmp, '.scratch', '局部改动', 'issues', '01-存量正文带远端段.md')
  writeText(partialFile, [
    '# 01: 存量正文带远端段',
    '',
    '**What to build:** 存量正文里带着远端模板段。',
    '',
    '**Status:** ready-for-agent',
    '',
    '## Parent',
    '',
    '#1506',
    '',
  ].join('\n'))
  const partialBefore = readText(partialFile)

  const closed = await closeIssue(partialCtx as never, partialRepo as never, '01')
  check(okOf(closed), '③ 只改状态（关票）不受影响：' + JSON.stringify(failOf(closed)))
  const closedText = readText(partialFile)
  check(/^\*\*Status:\*\* resolved$/m.test(closedText), '③ 关票把状态改成了 resolved')
  check(closedText.indexOf('## Parent') >= 0 && closedText.indexOf('#1506') >= 0, '③ 关票后正文里的远端段原样还在（没被误拦成整份改写）')
  check(closedText !== partialBefore, '③ 关票确实写了文件（不是什么都没做）')

  const commented = await addComment(partialCtx as never, partialRepo as never, '01', '只加一条评论，正文不许动。')
  check(okOf(commented), '③ 只加评论不受影响：' + JSON.stringify(failOf(commented)))
  const commentedText = readText(partialFile)
  check(commentedText.indexOf('只加一条评论，正文不许动。') >= 0, '③ 评论写进了文件')
  check(commentedText.indexOf('## Parent') >= 0 && commentedText.indexOf('#1506') >= 0, '③ 加评论后正文里的远端段原样还在')
  check(/^\*\*Status:\*\* resolved$/m.test(commentedText), '③ 加评论没有把刚才的状态改回去')

  const partialRejected = await update(partialCtx, partialRepo, '01', { body: '# 01: 存量正文带远端段\n\n' + REMOTE_FOUR })
  check(!okOf(partialRejected), '① 存量文件被整份改写成远端模板同样被拒')
  check(readText(partialFile) === commentedText, '① 存量文件的整份改写被拒后一个字节都没变')

  // ══ ④ 代码围栏里的举例不算错：整份替换能成功，两个围栏原样留在票里 ══
  const fencedTmp = tmpDir('md-1509-fenced-')
  const fencedCtx = mkctx(fencedTmp)
  const fencedRepo = repoOf('围栏例子', 'feature')
  const fencedMade = await create(fencedCtx, fencedRepo, {
    title: '围栏里的例子',
    body: '**What to build:** 先建一张普通的票。',
    type: 'issue',
    idempotencyKey: 'upd-1509-fenced',
  })
  check(okOf(fencedMade), '④ 前置：围栏例子的票建得成：' + JSON.stringify(failOf(fencedMade)))
  const fencedUpdated = await update(fencedCtx, fencedRepo, keyOf(fencedMade), { body: FENCED_WHOLE })
  check(okOf(fencedUpdated), '④ 围栏里的四段举例不算错，整份替换成功：' + JSON.stringify(failOf(fencedUpdated)))
  const fencedFile = path.join(fencedTmp, '.scratch', '围栏例子', 'issues', '01-围栏里的例子.md')
  const fencedText = readText(fencedFile)
  check(fencedText.indexOf('```markdown') >= 0 && fencedText.indexOf('~~~text') >= 0, '④ 两种围栏都原样写进了票里')
  check(fencedText.indexOf('## Parent') > fencedText.indexOf('```markdown'), '④ 围栏里的 ## Parent 是例子，留在正文里')
  check(fencedText.indexOf('## Acceptance criteria') < 0 || fencedText.indexOf('## Acceptance criteria') > fencedText.indexOf('```markdown'), '④ 围栏里的 ## Acceptance criteria 没有被当成模板段拦下')
  check(fencedText.indexOf('## Blocked by') > fencedText.indexOf('~~~text'), '④ 波浪号围栏里的 ## Blocked by 也原样留着')
  check(readText(fencedFile) === bodyOf(await readBack(fencedCtx, fencedRepo, keyOf(fencedMade))), '④ 读回来的正文与盘上的一致')

  // ══ ② 正常的整份正文替换：成功，读回来与写下去一字不差 ══
  const wholeTmp = tmpDir('md-1509-whole-')
  const wholeCtx = mkctx(wholeTmp)
  const wholeRepo = repoOf('正常改写', 'feature')
  const wholeMade = await create(wholeCtx, wholeRepo, {
    title: '可整份改写',
    body: LOCAL_BODY,
    type: 'issue',
    parentKey: '00',
    idempotencyKey: 'upd-1509-whole',
  })
  check(okOf(wholeMade), '② 前置：本地模板的实施票建得成：' + JSON.stringify(failOf(wholeMade)))
  const wholeKey = keyOf(wholeMade)
  const wholeBack = await readBack(wholeCtx, wholeRepo, wholeKey)
  const beforeWhole = bodyOf(wholeBack)
  check(beforeWhole.indexOf('用户能看到第一步。') >= 0, '② 前置：读回正文里有这段原文')
  const nextWhole = beforeWhole.replace('用户能看到第一步。', '用户能看到第二步。')
  check(nextWhole !== beforeWhole, '② 前置：这次整份替换确实改了一处内容')

  const wholeUpdated = await update(wholeCtx, wholeRepo, wholeKey, { body: nextWhole })
  check(okOf(wholeUpdated), '② 正常整份正文替换成功：' + JSON.stringify(failOf(wholeUpdated)))
  const wholeReadBack = await readBack(wholeCtx, wholeRepo, wholeKey)
  check(okOf(wholeReadBack), '② 改写后读得回来：' + JSON.stringify(failOf(wholeReadBack)))
  check(bodyOf(wholeReadBack) === nextWhole, '② getIssue 读回的正文与写下去的一字不差')
  check(bodyOf(wholeReadBack).indexOf('用户能看到第二步。') >= 0, '② 读回正文里是改过的新内容')
  const wholeFile = path.join(wholeTmp, '.scratch', '正常改写', 'issues', '01-可整份改写.md')
  check(readText(wholeFile) === nextWhole, '② 盘上文件与读回的正文一致')
  check(nextWhole.indexOf('**Status:** ready-for-agent') >= 0, '② 本地模板的字段行照样保留')

  // ══ ⑤ 改写路径只有 template-guard 这一份判据与文案 ══
  const patchSrc = readText(path.join(ROOT, 'src', 'tracker', 'rooms', 'markdown', 'issues-patch.ts'))
  check(patchSrc.indexOf("from './template-guard.js'") >= 0, '⑤ 改写路径从 template-guard 导入判据')
  check(patchSrc.indexOf('remoteTemplateSections(') >= 0, '⑤ 改写路径用 template-guard 的 remoteTemplateSections 认段')
  check(patchSrc.indexOf('remoteTemplateRefusalForLocalFile(') >= 0, '⑤ 改写路径用 template-guard 的同一套拒绝语')
  check(patchSrc.indexOf('REMOTE_SECTIONS') < 0, '⑤ 改写路径没有另抄一份远端段名清单')
  check(!/##[ \t]*(?:Parent|What to build|Acceptance criteria|Blocked by)\b/.test(patchSrc), '⑤ 改写路径没有第二份四段标题正则/文案')
  const patchBodySrc = readText(path.join(ROOT, 'src', 'tracker', 'rooms', 'markdown', 'patch-body.ts'))
  const statusSrc = readText(path.join(ROOT, 'src', 'tracker', 'rooms', 'markdown', 'issues-status.ts'))
  check(!/##[ \t]*(?:Parent|What to build|Acceptance criteria|Blocked by)\b/.test(patchBodySrc + statusSrc), '⑤ 合并与状态那两条路也没有第二份四段标题判据')

  // 地图子票：拒绝语换成问句模板那一套（与新建同一条分派），仍不落盘。
  const mapTmp = tmpDir('md-1509-map-')
  const mapCtx = mkctx(mapTmp)
  const mapRepo = repoOf('地图改写', 'effort')
  const mapFile = path.join(mapTmp, '.scratch', '地图改写', 'issues', '01-现成方案有哪些.md')
  writeText(mapFile, [
    '# 01: 现成方案有哪些？',
    '',
    'Type: research',
    '',
    '## Question',
    '',
    '现在有哪些现成方案？',
    '',
  ].join('\n'))
  const mapBefore = readText(mapFile)
  const mapWhole = '# 01: 现成方案有哪些？\n\n' + REMOTE_FOUR
  const mapRejected = await update(mapCtx, mapRepo, '01', { body: mapWhole })
  const mapFail = failOf(mapRejected)
  check(!okOf(mapRejected), '① 地图子票整份替换带远端四段同样被拒')
  check(mapFail.message === remoteTemplateRefusalFor('map-ticket', remoteTemplateSections(mapWhole)), '⑤ 地图子票的拒绝语也来自 template-guard（逐字相同）')
  check(mapFail.message.indexOf('## Question') >= 0 && mapFail.message.indexOf('Type:') >= 0, '① 地图子票报错说清本地问句形态：' + JSON.stringify(mapFail.message))
  check(mapFail.message.indexOf('**What to build:**') < 0, '① 地图子票报错不照搬实施票的字段模板')
  check(readText(mapFile) === mapBefore, '① 地图子票被拒后文件一个字节都没变')

  // ══ 汇总 ══
  console.log('')
  if (failures.length) {
    console.log('verify-1509-update-strict: ' + failures.length + ' 条没过（共 ' + checks + ' 条）')
    for (const line of failures) console.log('  - ' + line)
    process.exitCode = 1
    return
  }
  console.log('verify-1509-update-strict: 全过（共 ' + checks + ' 条）')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
