// tests/verify-1489-claim-labels.ts —— #1489 验收①：认领人与标签只写在原文规定的位置。
//
// 原文规定（issue-tracker-local.md:26-27、generated.ts 的 hidden-comments.entries）：
//   - 认领人、标签这些「deck 需要而原文没有」的信息放文件头隐藏注释（DSH-ASSIGNEES / DSH-LABELS），一行一条；
//   - 地图子票的认领状态是可见的裸行 Status: claimed，实施票的可见状态是加粗行 **Status:**，
//     认领实施票不改这个值（原文字段里没有 claimed 这一档）。
// 这一扇同时钉住：改认领/标签时可见正文一字不动、隐藏注释同步更新、旧布局仍走原来的可见行。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1489-claim-labels.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { setAssigneesIssue, setLabelsIssue } from '../src/tracker/rooms/markdown/issues-patch.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
/** 最小平台文件层：与 markdown 后端现有门禁用的是同一套形状。 */
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
/** 第一个一级标题之前的隐藏注释行（不含空白与正文里的同款注释）。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}
/** 一级标题到第一个二级标题之间的可见行（隐藏注释行先剔掉）。 */
function visibleTop(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^#\s+/.test(l))
  if (start < 0) return ''
  const out: string[] = []
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break
    if (/^\s*<!--/.test(lines[i])) continue
    out.push(lines[i])
  }
  return out.join('\n').replace(/\s+$/, '')
}
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
function logins(issue: unknown): string[] {
  const list = issue && Array.isArray((issue as { assignees?: unknown }).assignees) ? (issue as { assignees: unknown[] }).assignees : []
  return list.map((a) => String((a && (a as { login?: unknown }).login) || '')).filter(Boolean)
}

async function main(): Promise<void> {
  // ══ 第一段：实施票 —— 认领人只进隐藏注释，可见加粗状态行不动 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-claim-'))
  const ctx = mkctx(tmp)
  const spec = await create(ctx, repoOf(), { title: '买咖啡积分', body: '## Problem Statement\n\n用户想用积分买咖啡。', type: 'spec', idempotencyKey: 'spec-1489-claim' })
  check(!!(spec && spec.ok), '前置：规格建得成：' + (spec && spec.ok ? '' : JSON.stringify(spec)))
  const featureRepo = repoOf('买咖啡积分', 'feature')
  const impl = await create(ctx, featureRepo, { title: '第一步', body: '**What to build:** 用户能看到第一步。', type: 'issue', parentKey: '00', idempotencyKey: 'impl-1489-claim' })
  check(!!(impl && impl.ok), '前置：实施票建得成：' + (impl && impl.ok ? '' : JSON.stringify(impl)))
  const implPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '01-第一步.md')
  const implBefore = readText(implPath)
  check(headerComments(implBefore).every((line) => line.indexOf('DSH-ASSIGNEES') < 0), '前置：实施票还没有认领人注释')

  const assigned = await setAssigneesIssue(ctx as never, featureRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(assigned && assigned.ok), '① 认领实施票返回 ok：' + (assigned && assigned.ok ? '' : JSON.stringify(assigned)))
  const implAfter = readText(implPath)
  check(headerComments(implAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, '① 认领人写进文件头隐藏注释：' + JSON.stringify(headerComments(implAfter)))
  check(/\*\*Status:\*\* ready-for-agent/.test(implAfter), '① 可见加粗状态行原样保留（实施票没有 claimed 这一档）')
  check(!/^Status\s*[:：]/m.test(implAfter), '① 没有新插裸 Status 行')
  check(!/^Assignees\s*[:：]/m.test(implAfter), '① 没有新插可见 Assignees 行（原文没有这一行）')
  check(visibleTop(implAfter) === visibleTop(implBefore), '① 可见正文除隐藏注释外一字未改：' + JSON.stringify(visibleTop(implAfter)))
  const implRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(implRead && implRead.ok), '① 读回实施票 ok')
  check(logins(implRead && implRead.ok ? implRead.data : null).join(',') === 'alice', '① 读回认领人是 alice：' + JSON.stringify(logins(implRead && implRead.ok ? implRead.data : null)))

  // 同一份名单再写一次：文本没变就不写盘，日志里是 noop。
  const eventsBeforeDup = ctx.events.length
  await setAssigneesIssue(ctx as never, featureRepo as never, '01', ['alice'] as never, {} as never)
  const dupEvents = ctx.events.slice(eventsBeforeDup).filter((e) => e.event === 'issue.write' && e.fields.kind === 'setAssignees')
  check(dupEvents.length === 1 && dupEvents[0].fields.reason === 'noop', '① 同一份名单重写是 noop：' + JSON.stringify(dupEvents))
  check(headerComments(readText(implPath)).filter((line) => line.indexOf('DSH-ASSIGNEES') >= 0).length === 1, '① 重写不重复追加认领人注释')

  const cleared = await setAssigneesIssue(ctx as never, featureRepo as never, '01', [] as never, {} as never)
  check(!!(cleared && cleared.ok), '① 解除认领返回 ok')
  const implCleared = readText(implPath)
  check(headerComments(implCleared).every((line) => line.indexOf('DSH-ASSIGNEES') < 0), '① 解除认领删掉隐藏注释：' + JSON.stringify(headerComments(implCleared)))
  const implClearedRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(logins(implClearedRead && implClearedRead.ok ? implClearedRead.data : null).length === 0, '① 解除认领后读回空名单')

  // ══ 第二段：地图子票 —— 认领人进隐藏注释，可见裸行写 claimed ══
  const effortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-claim-map-'))
  const mapCtx = mkctx(effortTmp)
  const effortRepo = repoOf('effort-a', 'effort')
  const map = await create(mapCtx, effortRepo, { title: '探索地图甲', body: '先把现成方案摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1489-claim' })
  check(!!(map && map.ok), '前置：地图建得成：' + (map && map.ok ? '' : JSON.stringify(map)))
  const child = await create(mapCtx, effortRepo, { title: '现成方案有哪些？', body: '先把已知的开源方案列出来。', type: 'issue', typeLine: 'research', labels: ['wayfinder:research'], parentKey: '00', idempotencyKey: 'child-1489-claim' })
  check(!!(child && child.ok), '前置：地图子票建得成：' + (child && child.ok ? '' : JSON.stringify(child)))
  const childFile = fs.readdirSync(path.join(effortTmp, '.scratch', 'effort-a', 'issues')).filter((f) => f.indexOf('01-') === 0)[0]
  const childPath = path.join(effortTmp, '.scratch', 'effort-a', 'issues', childFile)
  const childBefore = readText(childPath)
  check(!/^Status\s*[:：]/m.test(childBefore), '前置：未认领的子票没有可见状态行')

  const childAssigned = await setAssigneesIssue(mapCtx as never, effortRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(childAssigned && childAssigned.ok), '① 认领地图子票返回 ok：' + (childAssigned && childAssigned.ok ? '' : JSON.stringify(childAssigned)))
  const childAfter = readText(childPath)
  check(headerComments(childAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, '① 子票认领人写进隐藏注释：' + JSON.stringify(headerComments(childAfter)))
  check(/^Status: claimed$/m.test(childAfter), '① 子票可见状态行写 claimed（原文两档之一）')
  check(childAfter.indexOf('**Status:**') < 0, '① 子票不用实施票的加粗状态行')
  check(sectionBody(childAfter, 'Question').indexOf('先把已知的开源方案列出来。') >= 0, '① 子票的 ## Question 原文保留')
  const childRead = await getIssue(mapCtx as never, effortRepo as never, '01', {} as never)
  check(logins(childRead && childRead.ok ? childRead.data : null).join(',') === 'alice', '① 子票读回认领人 alice')

  const childCleared = await setAssigneesIssue(mapCtx as never, effortRepo as never, '01', [] as never, {} as never)
  check(!!(childCleared && childCleared.ok), '① 子票解除认领返回 ok')
  const childClearedText = readText(childPath)
  check(!/^Status\s*[:：]/m.test(childClearedText), '① 子票解除认领删掉可见状态行（回到「没人派」的原文形态）')
  check(headerComments(childClearedText).every((line) => line.indexOf('DSH-ASSIGNEES') < 0), '① 子票解除认领删掉隐藏认领人注释')

  // ══ 第三段：规格容器 —— 认领人也只进隐藏注释 ══
  const specPath = path.join(tmp, '.scratch', '买咖啡积分', 'spec.md')
  const specBefore = readText(specPath)
  const specAssigned = await setAssigneesIssue(ctx as never, featureRepo as never, '00', ['alice'] as never, {} as never)
  check(!!(specAssigned && specAssigned.ok), '① 认领规格返回 ok：' + (specAssigned && specAssigned.ok ? '' : JSON.stringify(specAssigned)))
  const specAfter = readText(specPath)
  check(headerComments(specAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, '① 规格认领人写进隐藏注释')
  check(specAfter.replace(/^[ \t]*<!--\s*DSH-ASSIGNEES:[^\n]*-->\n?/m, '') === specBefore, '① 规格文件除这一行注释外一字未改：' + JSON.stringify(specAfter))

  // ══ 第四段：标签 —— 只改 DSH-LABELS；手写文件已有的可见 Labels 行同步，免得读回不一致 ══
  const labeled = await setLabelsIssue(ctx as never, featureRepo as never, '01', ['bug', 'needs-triage'] as never, {} as never)
  check(!!(labeled && labeled.ok), '① 改实施票标签返回 ok：' + (labeled && labeled.ok ? '' : JSON.stringify(labeled)))
  const implLabeled = readText(implPath)
  check(headerComments(implLabeled).indexOf('<!-- DSH-LABELS: bug, needs-triage -->') >= 0, '① 标签写进隐藏注释：' + JSON.stringify(headerComments(implLabeled)))
  check(!/^Labels\s*[:：]/m.test(implLabeled), '① 实施票正文不插可见 Labels 行')
  const implLabelRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(JSON.stringify((implLabelRead && implLabelRead.ok && implLabelRead.data.labels) || []).indexOf('bug') >= 0, '① 读回标签里有 bug')
  check(JSON.stringify((implLabelRead && implLabelRead.ok && implLabelRead.data.labels) || []).indexOf('needs-triage') >= 0, '① 读回标签里有 needs-triage')

  const labelsCleared = await setLabelsIssue(ctx as never, featureRepo as never, '01', [] as never, {} as never)
  check(!!(labelsCleared && labelsCleared.ok), '① 清空标签返回 ok')
  check(headerComments(readText(implPath)).every((line) => line.indexOf('DSH-LABELS') < 0), '① 清空标签删掉隐藏注释')

  // 手写文件：人写了可见 Labels 行时，两处一起改成同一个值，解析仍以可见行为准。
  const handPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '02-手写实施票.md')
  writeText(handPath, '# 02: 手写实施票\n\n**What to build:** 手写一张。\n\n**Blocked by:** None (can start immediately)\n\n**Status:** ready-for-agent\n\nLabels: old\n')
  const handLabeled = await setLabelsIssue(ctx as never, featureRepo as never, '02', ['bug'] as never, {} as never)
  check(!!(handLabeled && handLabeled.ok), '① 手写票改标签返回 ok：' + (handLabeled && handLabeled.ok ? '' : JSON.stringify(handLabeled)))
  const handAfter = readText(handPath)
  check(/^Labels: bug$/m.test(handAfter), '① 手写票已有的可见 Labels 行同步成新值：' + JSON.stringify(handAfter.split('\n').filter((l) => /Labels/.test(l))))
  check(headerComments(handAfter).indexOf('<!-- DSH-LABELS: bug -->') >= 0, '① 手写票也补上隐藏标签注释')
  const handRead = await getIssue(ctx as never, featureRepo as never, '02', {} as never)
  const handLabels = ((handRead && handRead.ok && handRead.data.labels) || []).map((l) => (l && typeof l === 'object' ? l.name : l))
  check(JSON.stringify(handLabels) === '["bug"]', '① 手写票读回标签是 bug：' + JSON.stringify(handLabels))

  // ══ 第五段：旧布局回归 —— 可见 Status/Assignees/Labels 行，行为不变 ══
  const legacyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-claim-legacy-'))
  const legacyCtx = mkctx(legacyTmp)
  const legacyRepo = repoOf()
  writeText(path.join(legacyTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n')
  const legacyPath = path.join(legacyTmp, '.scratch', 'demo', 'issues', '01-first-ticket.md')
  writeText(legacyPath, '# 第一张票\n\n正文\n\nStatus: ready-for-agent\n\n## Comments\n')
  const legacyAssigned = await setAssigneesIssue(legacyCtx as never, legacyRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(legacyAssigned && legacyAssigned.ok), '旧布局：认领返回 ok')
  const legacyAfter = readText(legacyPath)
  check(/^Status: claimed$/m.test(legacyAfter), '旧布局：认领仍写可见 Status: claimed')
  check(/^Assignees: alice$/m.test(legacyAfter), '旧布局：认领仍写可见 Assignees 行')
  const legacyLabeled = await setLabelsIssue(legacyCtx as never, legacyRepo as never, '01', ['bug'] as never, {} as never)
  check(!!(legacyLabeled && legacyLabeled.ok), '旧布局：改标签返回 ok')
  check(/^Labels: bug$/m.test(readText(legacyPath)), '旧布局：标签仍写可见 Labels 行')

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(effortTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
  try { fs.rmSync(legacyTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
