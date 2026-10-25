/**
 * tests/verify-1480-review-fixes.ts —— #1480 两轴评审确认成立的四项修复与一项文档论证的收口门禁。
 *
 * #1480（规格）的七张实施票全部关闭后，两轴 code-review 又确认了四处规格偏差，本门禁按主题逐节钉住：
 *
 *   A 规格与地图不再写可见一级标题：原文模板（package/bundled-skills/to-spec/SKILL.md 第 23 行起、
 *     package/bundled-skills/wayfinder/SKILL.md 第 31-53 行）没有标题行，标题应进文件头隐藏注释 DSH-TITLE。
 *     这里断言落盘无可见一级标题、DSH-TITLE 有值、第一个可见标题就是原文第一个段标题；手写无注释、
 *     无一级标题的 spec.md 读取时标题降级成目录名、不报错；改标题只动 DSH-TITLE、不凭空插一级标题；
 *     整份正文改写与片段正文改写都不丢文件头注释、不把正文插到注释前面。
 *   B 00 号读写判据统一：读取侧不带范围先找 spec 再找 map，写入侧也要同序 —— 不带 feature 参数能关 spec 00、
 *     不带 effort 参数能关 map 00，两个 00 并存时读写都命中同一个对象、不串。
 *   C 建票不再落旧位置：空工作区里没给 feature 目录时，旧路径如实失败、一个字节都不落盘，
 *     不再回落到工作区根 issues/ 或 .scratch/issues/。
 *   D 旧布局只读：工作区根 issues/ 与 .scratch/issues/ 里的旧票仍可读、可列、可单取，
 *     但关闭、改正文、评论、认领、标签这些写路径一律如实失败，跑完 SHA256 逐字节相等，并留下写日志。
 *
 * 门禁归属: src/tracker/rooms/markdown/create-render.ts
 * 门禁归属: src/tracker/rooms/markdown/map-render.ts
 * 门禁归属: src/tracker/rooms/markdown/parse.ts
 * 门禁归属: src/tracker/rooms/markdown/original-fields.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-patch.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-status.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-create.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-locate.ts
 * 门禁归属: src/tracker/rooms/markdown/comments.ts
 * 门禁归属: src/tracker/rooms/markdown/patch-body.ts
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1480-review-fixes.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'

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

/** 与 tests/verify-1486 / 1487 / 1490 同一套 fs/platform 适配器：真实文件系统 + 事件收集。 */
function makeCtx(cwd: string): Ctx {
  const plat = {
    path: path,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
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
/** 文件里第一个可见标题（一级或二级）之前的隐藏注释行；规格与地图的第一个可见标题就是段标题。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#{1,2}\s/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}
function visibleH1Count(text: string): number {
  return (text.match(/^#[ \t]+\S.*/gm) || []).length
}
/** 第一个不空、不是注释的行：规格/地图落盘时它必须是原文第一个段标题。 */
function firstVisibleLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('<!--')) continue
    return line
  }
  return ''
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
/** 门禁可能在链条里以仓库根为 cwd 运行；往上找夹具目录定位仓库根。 */
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

const SPEC_BODY = [
  '## Problem Statement', '', '用户想用积分换咖啡。', '',
  '## Solution', '', '积分直接抵扣。', '',
  '## User Stories', '', '- 作为用户，我能用积分换咖啡。', '',
  '## Implementation Decisions', '', '沿用现有订单表。', '',
  '## Testing Decisions', '', '冒烟走一遍。', '',
  '## Out of Scope', '', '不做钱包充值。', '',
  '## Further Notes', '', '无。', '',
].join('\n')

// ======================= A：规格与地图不写可见一级标题，标题进 DSH-TITLE =======================

console.log('-- A 规格：无可见一级标题、标题在 DSH-TITLE、改标题与整份改写都不丢文件头注释 --')
const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1480-fixes-a-'))
try {
  const ctxA = makeCtx(tmpA)
  const beA: any = createMarkdownBackend(ctxA as never)
  const specRepoA = repoOf()
  const specPathA = path.join(tmpA, '.scratch', '买咖啡积分', 'spec.md')

  const specA: any = await beA.create(specRepoA, {
    title: '买咖啡积分', body: SPEC_BODY, type: 'spec', labels: ['ready-for-agent'], idempotencyKey: 'fix-a-spec',
  }, ctxA)
  check(specA.ok === true, 'A 规格建票成功')
  check(fs.existsSync(specPathA), 'A 规格落在 .scratch/买咖啡积分/spec.md')
  const specText = readText(specPathA)
  eq(visibleH1Count(specText), 0, 'A 规格落盘没有可见一级标题（原文模板没有标题行）')
  check(headerComments(specText).some((l) => l === '<!-- DSH-TITLE: 买咖啡积分 -->'), 'A 规格标题写进 DSH-TITLE 隐藏注释')
  eq(firstVisibleLine(specText), '## Problem Statement', 'A 规格第一个可见行就是原文第一个段标题 ## Problem Statement')
  check(specText.indexOf('<!-- DSH-TITLE') < specText.indexOf('## Problem Statement'), 'A DSH-TITLE 在第一个段标题之前')
  check(headerComments(specText).length >= 6, 'A 规格的插件信息都在第一个段标题之前：' + JSON.stringify(headerComments(specText)))

  const gotA: any = await beA.get(repoOf(), '00', {}, ctxA)
  check(gotA.ok === true && String(gotA.data.title) === '买咖啡积分', 'A 规格读回标题来自 DSH-TITLE')

  const renamed: any = await beA.update(repoOf(), '00', { title: '买咖啡积分改名' }, ctxA)
  check(renamed.ok === true, 'A 改规格标题成功')
  const specRenamed = readText(specPathA)
  eq(visibleH1Count(specRenamed), 0, 'A 改标题没有凭空插一级标题')
  check(specRenamed.includes('<!-- DSH-TITLE: 买咖啡积分改名 -->'), 'A 改标题只改了 DSH-TITLE 的值')
  check(specRenamed.includes('<!-- DSH-FORMAT: md-v1 -->'), 'A 改标题后文件头格式注释还在')

  // 整份正文改写：递进来的整份正文带幂等锚（整份判据认它），盘上的 DSH-TITLE 必须被搬回来。
  const wholeBody = [
    '<!-- DSH-IDEMPOTENCY-KEY: fix-a-spec -->',
    '', '## Problem Statement', '', '整份改写后的新问题陈述。', '',
    '## Solution', '', '整份改写后的新方案。', '',
  ].join('\n')
  const whole: any = await beA.update(repoOf(), '00', { body: wholeBody }, ctxA)
  check(whole.ok === true, 'A 整份正文改写成功')
  const specWhole = readText(specPathA)
  eq(visibleH1Count(specWhole), 0, 'A 整份正文改写没有插一级标题')
  check(specWhole.includes('<!-- DSH-TITLE: 买咖啡积分改名 -->'), 'A 整份正文改写没有丢 DSH-TITLE（标题不降级成目录名）')
  check(specWhole.includes('<!-- DSH-FORMAT: md-v1 -->'), 'A 整份正文改写没有丢 DSH-FORMAT 文件头注释')
  check(specWhole.includes('整份改写后的新问题陈述。'), 'A 整份正文改写写进了新正文')
  const gotWhole: any = await beA.get(repoOf(), '00', {}, ctxA)
  check(gotWhole.ok === true && String(gotWhole.data.title) === '买咖啡积分改名', 'A 整份正文改写后读回标题仍是改名后的标题')

  // 片段正文改写：不能插到文件头注释前面。
  const frag: any = await beA.update(repoOf(), '00', { body: '这是一段补充说明。' }, ctxA)
  check(frag.ok === true, 'A 片段正文改写成功')
  const specFrag = readText(specPathA)
  const fragLines = specFrag.split('\n')
  check(/^[ \t]*<!--/.test(fragLines[0] || ''), 'A 片段正文改写后第一行仍是文件头注释（正文没被插到注释前面）')
  const lastCommentAt = Math.max(...headerComments(specFrag).map((l) => specFrag.indexOf(l)))
  const fragAt = specFrag.indexOf('这是一段补充说明。')
  check(fragAt > lastCommentAt && fragAt < specFrag.indexOf('## Problem Statement'), 'A 片段正文落在文件头注释之后、第一个段标题之前')
  eq(visibleH1Count(specFrag), 0, 'A 片段正文改写没有插一级标题')
  check(specFrag.includes('## Problem Statement') && specFrag.includes('## Solution') && specFrag.includes('整份改写后的新问题陈述。'),
    'A 片段正文改写保留原有段标题与正文（只插入，不吞段）')
  check(specFrag.indexOf('## Problem Statement') < specFrag.indexOf('## Solution'), 'A 片段正文改写后原有段落顺序不变')

  console.log('-- A 地图：无可见一级标题、标题在 DSH-TITLE --')
  const mapRepoA = repoOf('effort-a', 'effort')
  const mapPathA = path.join(tmpA, '.scratch', 'effort-a', 'map.md')
  const mapA: any = await beA.create(mapRepoA, {
    title: '探索地图甲', body: '先把现成方案摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'fix-a-map',
  }, ctxA)
  check(mapA.ok === true, 'A 地图建票成功')
  const mapText = readText(mapPathA)
  eq(visibleH1Count(mapText), 0, 'A 地图落盘没有可见一级标题（原文模板没有标题行）')
  check(headerComments(mapText).some((l) => l === '<!-- DSH-TITLE: 探索地图甲 -->'), 'A 地图标题写进 DSH-TITLE 隐藏注释')
  eq(firstVisibleLine(mapText), '## Destination', 'A 地图第一个可见行就是原文第一个段标题 ## Destination')
  eq(h2s(mapText), ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope'], 'A 地图仍按原文五段写')
  const mapRenamed: any = await beA.update(mapRepoA, '00', { title: '探索地图甲改名' }, ctxA)
  check(mapRenamed.ok === true, 'A 改地图标题成功')
  const mapRenamedText = readText(mapPathA)
  check(mapRenamedText.includes('<!-- DSH-TITLE: 探索地图甲改名 -->'), 'A 改地图标题只改了 DSH-TITLE')
  eq(visibleH1Count(mapRenamedText), 0, 'A 改地图标题没有凭空插一级标题')

  console.log('-- A 手写无注释、无一级标题的 spec.md：标题降级不报错，能改标题 --')
  const handDir = path.join(tmpA, '.scratch', 'hand')
  const handPath = path.join(handDir, 'spec.md')
  fs.mkdirSync(handDir, { recursive: true })
  fs.writeFileSync(handPath, '## Problem Statement\n\n手写的问题陈述。\n\n## Solution\n\n手写的方案。\n', 'utf8')
  const handRepo = repoOf('hand', 'feature')
  const gotHand: any = await beA.get(handRepo, '00', {}, ctxA)
  check(gotHand.ok === true, 'A 手写无注释 spec.md 能读出来、不报错')
  check(gotHand.ok && String(gotHand.data.title) === 'hand', 'A 手写无注释 spec.md 标题降级成目录名 hand，不拿段标题当标题')
  const handRename: any = await beA.update(handRepo, '00', { title: '手写改名' }, ctxA)
  check(handRename.ok === true, 'A 手写无注释 spec.md 能改标题')
  const handText = readText(handPath)
  check(handText.includes('<!-- DSH-TITLE: 手写改名 -->'), 'A 手写文件改标题写进 DSH-TITLE')
  eq(visibleH1Count(handText), 0, 'A 手写文件改标题没有凭空插一级标题')
  check(handText.includes('手写的问题陈述。'), 'A 手写文件改标题没有动正文')
} finally {
  fs.rmSync(tmpA, { recursive: true, force: true })
}

// ======================= B：00 号读写判据统一 =======================

console.log('-- B 两个 00 并存：不带 feature 读到的规格，不带 feature 也要能关掉 --')
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1480-fixes-b-'))
try {
  const ctxB = makeCtx(tmpB)
  const beB: any = createMarkdownBackend(ctxB as never)
  const specRepoB = repoOf('积分兑换', 'feature')
  const mapRepoB = repoOf('effort-b', 'effort')
  const specPathB = path.join(tmpB, '.scratch', '积分兑换', 'spec.md')
  const mapPathB = path.join(tmpB, '.scratch', 'effort-b', 'map.md')
  const specB: any = await beB.create(specRepoB, { title: '规格乙', body: SPEC_BODY, type: 'spec', labels: ['ready-for-agent'] }, ctxB)
  const mapB: any = await beB.create(mapRepoB, { title: '地图乙', body: '地图正文。', type: 'map', labels: ['wayfinder:map'] }, ctxB)
  check(specB.ok === true && mapB.ok === true, 'B 同一工作区里规格与地图两个 00 都建成功')

  const gotB: any = await beB.get(repoOf(), '00', {}, ctxB)
  check(gotB.ok === true && gotB.data.type === 'spec', 'B 不带范围读 00 先命中规格（与读取侧既有顺序一致）')
  const patchedB: any = await beB.update(repoOf(), '00', { title: '规格乙改名' }, ctxB)
  check(patchedB.ok === true, 'B 不带范围改 00 标题成功')
  check(readText(specPathB).includes('<!-- DSH-TITLE: 规格乙改名 -->'), 'B 改到的是规格的 DSH-TITLE')
  check(readText(mapPathB).includes('<!-- DSH-TITLE: 地图乙 -->'), 'B 地图的标题没被串着改掉')

  const closedB: any = await beB.close(repoOf(), '00', {}, ctxB)
  check(closedB.ok === true, 'B 不带 feature 参数关规格 00 成功')
  check(readText(specPathB).includes('<!-- DSH-STATUS: closed -->'), 'B 被关掉的是规格文件（DSH-STATUS closed）')
  check(!readText(mapPathB).includes('<!-- DSH-STATUS: closed -->'), 'B 地图没有被一起关掉')
  check(closedB.ok && closedB.data.type === 'spec', 'B 关票返回的对象类型是 spec')
} finally {
  fs.rmSync(tmpB, { recursive: true, force: true })
}

console.log('-- B 只有地图时：不带 effort 参数关 map 00 --')
const tmpB2 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1480-fixes-b2-'))
try {
  const ctxB2 = makeCtx(tmpB2)
  const beB2: any = createMarkdownBackend(ctxB2 as never)
  const mapRepoB2 = repoOf('effort-c', 'effort')
  const mapPathB2 = path.join(tmpB2, '.scratch', 'effort-c', 'map.md')
  const mapB2: any = await beB2.create(mapRepoB2, { title: '只有地图', body: '地图正文。', type: 'map', labels: ['wayfinder:map'] }, ctxB2)
  check(mapB2.ok === true, 'B 只有地图的工作区建图成功')
  const gotB2: any = await beB2.get(repoOf(), '00', {}, ctxB2)
  check(gotB2.ok === true && gotB2.data.type === 'map', 'B 不带范围读 00 找不到规格时回落地图')
  const closedB2: any = await beB2.close(repoOf(), '00', {}, ctxB2)
  check(closedB2.ok === true, 'B 不带 effort 参数关地图 00 成功')
  check(readText(mapPathB2).includes('<!-- DSH-STATUS: closed -->'), 'B 地图文件真的写上了 closed 状态')
  check(closedB2.ok && closedB2.data.type === 'map', 'B 关票返回的对象类型是 map')
} finally {
  fs.rmSync(tmpB2, { recursive: true, force: true })
}

// ======================= C：建票不再落旧位置 =======================

console.log('-- C 空工作区不带 feature 建票：如实失败、一个字节不落盘 --')
const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1480-fixes-c-'))
try {
  const ctxC = makeCtx(tmpC)
  const beC: any = createMarkdownBackend(ctxC as never)
  // #1500 S4 起旧路径已删：无 typeLine 的四值（这里的 task）按普通票走原文布局，
  // 与普通票同路按标题新建 feature 目录并成功；「旧位置兜底」（工作区根 issues/）仍不存在，由下面的断言守。
  const oldPathCreate: any = await beC.create(repoOf(), { title: '没给目录的旧路径票', type: 'task' }, ctxC)
  check(oldPathCreate.ok === true, 'C 无 typeLine 的 task 按普通票走原文布局建成功')
  if (oldPathCreate.ok === true) {
    const oldUrl = String(oldPathCreate.data.url || '').replace(/\\/g, '/')
    check(oldUrl.includes('/.scratch/') && oldUrl.includes('/issues/'), 'C task 票落在 .scratch/<目录>/issues/ 原文位置：' + oldUrl)
  }
  // 普通票走原文布局（new layout）会按标题新建 feature 目录，这是 #1486 定的落点；
  // 但同样不许落旧位置：工作区根 issues/ 与 .scratch/issues/ 都不该出现。
  const plainCreate: any = await beC.create(repoOf(), { title: '没给目录的普通票', type: 'issue' }, ctxC)
  if (plainCreate.ok) {
    const url = String(plainCreate.data.url || '').replace(/\\/g, '/')
    check(url.includes('/.scratch/') && url.includes('/issues/'), 'C 普通票落在 .scratch/<目录>/issues/ 原文位置：' + url)
  } else {
    check(String(plainCreate.error.message).length > 0, 'C 普通票没给 feature 时如实失败：' + plainCreate.error.message)
  }
  check(!fs.existsSync(path.join(tmpC, 'issues')), 'C 盘上没有出现工作区根 issues/')
  check(!fs.existsSync(path.join(tmpC, '.scratch', 'issues')), 'C 盘上没有出现 .scratch/issues/')
  eq(fs.readdirSync(tmpC).filter((n) => n !== '.scratch'), [], 'C 空工作区里没有落下任何新文件')
} finally {
  fs.rmSync(tmpC, { recursive: true, force: true })
}

// ======================= D：旧布局只读 =======================

console.log('-- D 旧布局票可读可列，写路径一律如实失败、逐字节不变 --')
const repoRoot = findRepoRoot()
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', '1490-legacy-layout')
const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1480-fixes-d-'))
try {
  fs.cpSync(path.join(fixtureRoot, 'root-issues'), path.join(tmpD, 'issues'), { recursive: true })
  fs.cpSync(path.join(fixtureRoot, 'dot-scratch'), path.join(tmpD, '.scratch'), { recursive: true })
  // 再补一张 .scratch/issues/ 扁平旧布局的票：同一层只读判据要同样拦住它。
  fs.mkdirSync(path.join(tmpD, '.scratch', 'issues'), { recursive: true })
  fs.writeFileSync(path.join(tmpD, '.scratch', 'issues', '03-flat-ticket.md'), '# 扁平旧票\n\n## What to build\n\n旧扁平目录里的票。\n\nStatus: open\n', 'utf8')
  const before = hashTree(tmpD)
  check(Object.keys(before).includes('issues/01-legacy-ticket.md'), 'D 夹具复制出工作区根 issues/ 旧票')
  check(Object.keys(before).includes('.scratch/issues/03-flat-ticket.md'), 'D 夹具里补了 .scratch/issues/ 扁平旧票')

  const ctxD = makeCtx(tmpD)
  const beD: any = createMarkdownBackend(ctxD as never)
  const listedD: any = await beD.list(repoOf(), {}, ctxD)
  check(listedD.ok === true, 'D 旧布局能列表')
  const rowsD: Record<string, unknown>[] = listedD.ok ? listedD.data : []
  eq(rowsD.length, 5, 'D 旧布局列出五个对象行（旧地图、三张根票、一张扁平旧票）')
  const gotD: any = await beD.get(repoOf(), '01', {}, ctxD)
  check(gotD.ok === true && gotD.data.state === 'open', 'D 旧根 issues/ 的票能按编号读回')
  const gotFlat: any = await beD.get(repoOf(), '03', {}, ctxD)
  check(gotFlat.ok === true && String(gotFlat.data.title).includes('扁平旧票'), 'D .scratch/issues/ 的扁平旧票也能读回')

  const attempts: Array<{ name: string; run: () => Promise<any> }> = [
    { name: '关闭', run: () => beD.close(repoOf(), '01', {}, ctxD) },
    { name: '改正文', run: () => beD.update(repoOf(), '01', { body: '试图改旧票正文。' }, ctxD) },
    { name: '评论', run: () => beD.comment(repoOf(), '01', '试图评论旧票。', ctxD) },
    { name: '认领', run: () => beD.setAssignees(repoOf(), '01', ['alice'], {}, ctxD) },
    { name: '贴标签', run: () => beD.setLabels(repoOf(), '01', ['bug'], {}, ctxD) },
    { name: '关闭扁平旧票', run: () => beD.close(repoOf(), '03', {}, ctxD) },
  ]
  for (const attempt of attempts) {
    const r: any = await attempt.run()
    check(r.ok === false, 'D 旧布局票的「' + attempt.name + '」写路径如实失败')
    check(r.ok === false && String(r.error.kind) === 'unsupported', 'D 「' + attempt.name + '」失败档位是 unsupported')
    check(r.ok === false && /旧布局/.test(String(r.error.message)) && /只读/.test(String(r.error.message)), 'D 「' + attempt.name + '」话术说清旧布局只读：' + (r.ok ? '' : r.error.message))
  }
  const writeLogs = ctxD.events.filter((e) => e.event === 'issue.write')
  const failedLogs = writeLogs.filter((e) => e.fields && e.fields.ok === false && e.fields.reason === 'fail:unsupported')
  check(failedLogs.length >= attempts.length, 'D 每次失败都留下 issue.write 失败日志（fail:unsupported）：' + failedLogs.length + ' 条')
  const degradedD = ctxD.events.filter((e) => e.event === 'read.degraded').map((e) => String(e.fields && e.fields.reason))
  check(degradedD.includes('list:legacy-root') && degradedD.includes('get:legacy-root'), 'D 读旧布局仍照旧留下兼容降级日志')

  const after = hashTree(tmpD)
  eq(after, before, 'D 写路径全部失败后旧布局工作区逐字节未变')
} finally {
  fs.rmSync(tmpD, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log('FAILED（' + checked + ' 条断言里有失败）')
  process.exitCode = 1
} else {
  console.log('ALL PASS（' + checked + ' 条断言）')
}
