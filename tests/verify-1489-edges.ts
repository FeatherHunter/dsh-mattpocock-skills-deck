// tests/verify-1489-edges.ts —— #1489 验收②③：父子边与阻塞边写文件头隐藏注释，可见行同步，读取能还原。
//
// 原文（issue-tracker-local.md:27、to-tickets 模板）规定：
//   - 实施票的可见阻塞行是加粗的 **Blocked by:** #NN，没被阻塞时写 None (can start immediately)；
//   - 地图子票的可见阻塞行是裸行 Blocked by: NN, NN，没有就不写这一行；
//   - 父票与「谁阻塞谁」这类原文没有的边信息放文件头隐藏注释（DSH-PARENT / DSH-BLOCKED-BY），一行一条。
// 这一扇钉住：写边只改规定位置、旧文件没有注释时按目录结构兜底、读取能还原、日志是 edge.write。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1489-edges.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { setBlockedByIssue, setParentIssue } from '../src/tracker/rooms/markdown/issues-patch.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
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
/** 文件头（第一个一级标题之前）的隐藏注释行。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}
/** 边编号归一：读回来是 {key} 对象，写成逗号串方便断言。 */
function edgeKeys(issue: unknown): string {
  const list = issue && Array.isArray((issue as { blockedBy?: unknown }).blockedBy) ? (issue as { blockedBy: unknown[] }).blockedBy : []
  return list.map((b) => String((b && (b as { key?: unknown }).key) || '')).join(',')
}
function edgeEvents(ctx: { events: LogLine[] }, kind: string): LogLine[] {
  return ctx.events.filter((e) => e.event === 'edge.write' && e.fields.kind === kind)
}

async function main(): Promise<void> {
  // ══ 第一段：实施票的阻塞边 —— 可见加粗行与隐藏注释一起改，不留第二条可见行 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-edges-'))
  const ctx = mkctx(tmp)
  const baseRepo = repoOf()
  await create(ctx, baseRepo, { title: '买咖啡积分', body: '## Problem Statement\n\n用户想用积分买咖啡。', type: 'spec', idempotencyKey: 'spec-1489-edge' })
  const featureRepo = repoOf('买咖啡积分', 'feature')
  const impl1 = await create(ctx, featureRepo, { title: '第一步', body: '**What to build:** 用户能看到第一步。', type: 'issue', parentKey: '00', blockedBy: ['02'], idempotencyKey: 'impl-1489-e1' })
  check(!!(impl1 && impl1.ok), '前置：带阻塞边的实施票建得成：' + (impl1 && impl1.ok ? '' : JSON.stringify(impl1)))
  await create(ctx, featureRepo, { title: '第二步', body: '**What to build:** 用户能看到第二步。', type: 'issue', parentKey: '00', idempotencyKey: 'impl-1489-e2' })
  const implPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '01-第一步.md')
  const created = readText(implPath)
  check(/^\*\*Blocked by:\*\* #02$/m.test(created), '前置：建票时可见阻塞行是加粗写法：' + JSON.stringify(created.split('\n').filter((l) => /Blocked by/.test(l))))
  check(headerComments(created).indexOf('<!-- DSH-BLOCKED-BY: 02 -->') >= 0, '前置：建票时阻塞边写进隐藏注释')

  const changed = await setBlockedByIssue(ctx as never, featureRepo as never, '01', ['03'] as never, {} as never)
  check(!!(changed && changed.ok), '② 改阻塞边返回 ok：' + (changed && changed.ok ? '' : JSON.stringify(changed)))
  const after = readText(implPath)
  check(/^\*\*Blocked by:\*\* #03$/m.test(after), '② 可见加粗阻塞行原地换成 #03：' + JSON.stringify(after.split('\n').filter((l) => /Blocked by/.test(l))))
  check(headerComments(after).indexOf('<!-- DSH-BLOCKED-BY: 03 -->') >= 0, '② 隐藏阻塞注释同步成 03：' + JSON.stringify(headerComments(after)))
  check(after.split('\n').filter((l) => /Blocked by/.test(l)).length === 1, '② 文件里只有一条阻塞行（没有另插裸行）')
  const read1 = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(edgeKeys(read1 && read1.ok ? read1.data : null) === '03', '② 读回阻塞边是 03：' + edgeKeys(read1 && read1.ok ? read1.data : null))
  const blockEvents = edgeEvents(ctx, 'block')
  check(blockEvents.length === 1 && blockEvents[0].fields.reason === 'diff' && blockEvents[0].fields.added === 1 && blockEvents[0].fields.removed === 1, '② 阻塞边这一趟记了 edge.write（diff、加一条撤一条）：' + JSON.stringify(blockEvents))

  const cleared = await setBlockedByIssue(ctx as never, featureRepo as never, '01', [] as never, {} as never)
  check(!!(cleared && cleared.ok), '② 清空阻塞边返回 ok')
  const clearedText = readText(implPath)
  check(/^\*\*Blocked by:\*\* None \(can start immediately\)$/m.test(clearedText), '② 没有阻塞时可见行写原文的 None (can start immediately)：' + JSON.stringify(clearedText.split('\n').filter((l) => /Blocked by/.test(l))))
  check(headerComments(clearedText).every((line) => line.indexOf('DSH-BLOCKED-BY') < 0), '② 没有阻塞时隐藏注释整行删掉')
  const read2 = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(edgeKeys(read2 && read2.ok ? read2.data : null) === '', '② 读回阻塞边为空')

  // ══ 第二段：地图子票的阻塞边 —— 可见裸行与隐藏注释一起改 ══
  const effortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-edges-map-'))
  const mapCtx = mkctx(effortTmp)
  const effortRepo = repoOf('effort-a', 'effort')
  await create(mapCtx, effortRepo, { title: '探索地图甲', body: '先把现成方案摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1489-edge' })
  const child1 = await create(mapCtx, effortRepo, { title: '现成方案有哪些？', body: '列方案。', type: 'issue', typeLine: 'research', labels: ['wayfinder:research'], parentKey: '00', idempotencyKey: 'child-1489-e1' })
  check(!!(child1 && child1.ok), '前置：地图子票一建得成：' + (child1 && child1.ok ? '' : JSON.stringify(child1)))
  const child2 = await create(mapCtx, effortRepo, { title: '哪个方案最省事？', body: '比一比。', type: 'issue', typeLine: 'research', labels: ['wayfinder:research'], parentKey: '00', blockedBy: ['01'], idempotencyKey: 'child-1489-e2' })
  check(!!(child2 && child2.ok), '前置：地图子票二建得成：' + (child2 && child2.ok ? '' : JSON.stringify(child2)))
  const childDir = path.join(effortTmp, '.scratch', 'effort-a', 'issues')
  const child2File = fs.readdirSync(childDir).filter((f) => f.indexOf('02-') === 0)[0]
  const child2Path = path.join(childDir, child2File)
  check(/^Blocked by: 01$/m.test(readText(child2Path)), '前置：子票可见阻塞行是裸行 Blocked by: 01')
  const childChanged = await setBlockedByIssue(mapCtx as never, effortRepo as never, '02', ['03'] as never, {} as never)
  check(!!(childChanged && childChanged.ok), '② 改子票阻塞边返回 ok：' + (childChanged && childChanged.ok ? '' : JSON.stringify(childChanged)))
  const childAfter = readText(child2Path)
  check(/^Blocked by: 03$/m.test(childAfter), '② 子票可见裸行换成 03：' + JSON.stringify(childAfter.split('\n').filter((l) => /Blocked by/.test(l))))
  check(headerComments(childAfter).indexOf('<!-- DSH-BLOCKED-BY: 03 -->') >= 0, '② 子票隐藏阻塞注释同步成 03')
  check(childAfter.split('\n').filter((l) => /Blocked by/.test(l)).length === 1, '② 子票文件里只有一条阻塞行')
  const childCleared = await setBlockedByIssue(mapCtx as never, effortRepo as never, '02', [] as never, {} as never)
  check(!!(childCleared && childCleared.ok), '② 清空子票阻塞边返回 ok')
  const childClearedText = readText(child2Path)
  check(!/^Blocked by\s*[:：]/m.test(childClearedText), '② 没有阻塞时子票删掉可见裸行（原文没有这一行）')
  check(headerComments(childClearedText).every((line) => line.indexOf('DSH-BLOCKED-BY') < 0), '② 没有阻塞时子票删掉隐藏注释')

  // ══ 第三段：父子边写 DSH-PARENT，旧文件没注释时按目录结构兜底 ══
  const parent = await setParentIssue(ctx as never, featureRepo as never, '01', '02' as never, {} as never)
  check(!!(parent && parent.ok), '③ 改父子边返回 ok：' + (parent && parent.ok ? '' : JSON.stringify(parent)))
  const parentText = readText(implPath)
  check(headerComments(parentText).indexOf('<!-- DSH-PARENT: 02 -->') >= 0, '③ 父票写进隐藏注释 DSH-PARENT：' + JSON.stringify(headerComments(parentText)))
  check(!/<!--\s*parentKey\s*:/.test(parentText), '③ 原文布局不再写旧的 parentKey 注释')
  check(parentText.split('\n').filter((l) => /DSH-PARENT/.test(l)).length === 1, '③ 父票注释只有一行（旧值原地换掉）')
  const parentRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(parentRead && parentRead.ok && parentRead.data.parentKey === '02'), '③ 读回父票是 02：' + JSON.stringify(parentRead && parentRead.ok ? parentRead.data.parentKey : parentRead))
  const parentEvents = edgeEvents(ctx, 'parent')
  check(parentEvents.length === 1 && parentEvents[0].fields.reason === 'diff' && parentEvents[0].fields.added === 1 && parentEvents[0].fields.removed === 1, '③ 父子边这一趟记了 edge.write（diff、换挂一条）：' + JSON.stringify(parentEvents))

  const unparent = await setParentIssue(ctx as never, featureRepo as never, '01', null, {} as never)
  check(!!(unparent && unparent.ok), '③ 解除父子返回 ok：' + (unparent && unparent.ok ? '' : JSON.stringify(unparent)))
  const unparentText = readText(implPath)
  check(headerComments(unparentText).every((line) => line.indexOf('DSH-PARENT') < 0), '③ 解除父子删掉隐藏注释')
  const unparentRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(unparentRead && unparentRead.ok && (unparentRead.data.parentKey === null || unparentRead.data.parentKey === undefined)), '③ 旧文件没有父注释时读回按目录结构兜底（这里是没有父）：' + JSON.stringify(unparentRead && unparentRead.ok ? unparentRead.data.parentKey : unparentRead))
  const unparentEvents = edgeEvents(ctx, 'parent')
  check(unparentEvents.length === 2 && unparentEvents[1].fields.reason === 'removed' && unparentEvents[1].fields.removed === 1, '③ 解除父子这一趟记了撤掉一条：' + JSON.stringify(unparentEvents))

  // ══ 第四段：手写原文实施票（没有隐藏注释）—— 写边时补注释，可见行原地改 ══
  const handPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '03-手写实施票.md')
  writeText(handPath, '# 03: 手写实施票\n\n**What to build:** 手写一张。\n\n**Blocked by:** None (can start immediately)\n\n**Status:** ready-for-agent\n')
  const handChanged = await setBlockedByIssue(ctx as never, featureRepo as never, '03', ['01'] as never, {} as never)
  check(!!(handChanged && handChanged.ok), '② 手写票补阻塞边返回 ok：' + (handChanged && handChanged.ok ? '' : JSON.stringify(handChanged)))
  const handText = readText(handPath)
  check(/^\*\*Blocked by:\*\* #01$/m.test(handText), '② 手写票可见阻塞行原地换：' + JSON.stringify(handText.split('\n').filter((l) => /Blocked by/.test(l))))
  check(headerComments(handText).indexOf('<!-- DSH-BLOCKED-BY: 01 -->') >= 0, '② 手写票补上隐藏阻塞注释（文件头第一个标题之前）')
  const handRead = await getIssue(ctx as never, featureRepo as never, '03', {} as never)
  check(edgeKeys(handRead && handRead.ok ? handRead.data : null) === '01', '② 手写票读回阻塞边 01')

  // ══ 第五段：旧布局回归 —— 继续写可见行与 parentKey 注释 ══
  const legacyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-edges-legacy-'))
  const legacyCtx = mkctx(legacyTmp)
  const legacyRepo = repoOf()
  writeText(path.join(legacyTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n')
  const legacyDir = path.join(legacyTmp, '.scratch', 'demo', 'issues')
  writeText(path.join(legacyDir, '01-first-ticket.md'), '# 第一张票\n\n正文\n\nStatus: ready-for-agent\n\n## Comments\n')
  writeText(path.join(legacyDir, '02-second-ticket.md'), '# 第二张票\n\n正文\n\nStatus: ready-for-agent\n\n## Comments\n')
  const legacyBlock = await setBlockedByIssue(legacyCtx as never, legacyRepo as never, '01', ['02'] as never, {} as never)
  check(!!(legacyBlock && legacyBlock.ok), '旧布局：改阻塞边返回 ok')
  check(/^Blocked by: #02$/m.test(readText(path.join(legacyDir, '01-first-ticket.md'))), '旧布局：阻塞边仍写可见行 Blocked by: #02')
  const legacyParent = await setParentIssue(legacyCtx as never, legacyRepo as never, '01', '02' as never, {} as never)
  check(!!(legacyParent && legacyParent.ok), '旧布局：改父子边返回 ok')
  check(/<!-- parentKey: 02 -->/.test(readText(path.join(legacyDir, '01-first-ticket.md'))), '旧布局：父子边仍写旧的 parentKey 注释')

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(effortTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
  try { fs.rmSync(legacyTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
