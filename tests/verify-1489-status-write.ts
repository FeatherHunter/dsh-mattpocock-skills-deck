// tests/verify-1489-status-write.ts —— #1489 验收①④：状态按原文落盘，实施票与地图子票的「完成」行为分开。
//
// 这一扇守三件事：
//   ① 实施票（to-tickets 模板）的状态是可见的加粗行 `**Status:**`，关票只改它，不写 Close reason、不写 ## Answer；
//      关闭原因按原文「comments append to the bottom」追加成一条评论（issue-tracker-local.md:10-11）。
//   ② 探索地图子票的状态是裸行 `Status:`，完成时把答案写进 `## Answer`、状态改 resolved，
//      再往同一目录 map.md 的 Decisions so far 追加指针（issue-tracker-local.md:26-30）。
//   ③ 容器（规格 spec.md / 地图 map.md）的状态只写在文件头隐藏注释 DSH-STATUS 里，可见正文不动。
// 旧布局（可见 Status + Close reason 行）的行为一字不变，也在这里做回归。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1489-status-write.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, closeIssue, reopenIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
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
/** 第一段：某个二级标题下的正文（不含标题本身，到下一个二级标题为止）。 */
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
/** 第一个一级标题之前的 DSH 隐藏注释行。 */
function headerComments(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^#\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}
/** 评论条数：## Comments 段里的 ### 标题个数。 */
function commentCount(text: string): number {
  return (sectionBody(text, 'Comments').match(/^###\s/gm) || []).length
}

async function main(): Promise<void> {
  // ══ 第一段：实施票 —— 关闭只改加粗状态行 + 追加一条评论 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-status-'))
  const ctx = mkctx(tmp)
  const spec = await create(ctx, repoOf(), {
    title: '买咖啡积分',
    body: '## Problem Statement\n\n用户想用积分买咖啡。',
    type: 'spec',
    idempotencyKey: 'spec-1489-status',
  })
  check(!!(spec && spec.ok), '前置：规格建得成：' + (spec && spec.ok ? '' : JSON.stringify(spec)))
  const featureRepo = repoOf('买咖啡积分', 'feature')
  const impl = await create(ctx, featureRepo, {
    title: '第一步',
    body: '**What to build:** 用户能看到第一步。\n\n- [ ] 能看到结果',
    type: 'issue',
    parentKey: '00',
    labels: ['ready-for-agent'],
    idempotencyKey: 'impl-1489-status',
  })
  check(!!(impl && impl.ok), '前置：实施票建得成：' + (impl && impl.ok ? '' : JSON.stringify(impl)))
  const implPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '01-第一步.md')
  const beforeClose = readText(implPath)
  check(/\*\*Status:\*\* ready-for-agent/.test(beforeClose), '前置：实施票是原文的加粗状态行')

  const closed = await closeIssue(ctx as never, featureRepo as never, '01', { reason: '第一步做完了' } as never)
  check(!!(closed && closed.ok), '① 关实施票返回 ok：' + (closed && closed.ok ? '' : JSON.stringify(closed)))
  const afterClose = readText(implPath)
  check(/\*\*Status:\*\* resolved$/.test(afterClose.split('\n').filter((l) => l.indexOf('**Status:**') === 0)[0] || ''), '① 加粗状态行原地改成 resolved')
  check(!/^Status\s*[:：]/m.test(afterClose), '① 没有新插一行裸 Status 行（可见状态只有原文那一行）')
  check(afterClose.indexOf('Close reason') < 0, '① 实施票不写 Close reason 行')
  check(!/^##\s*Answer\s*$/m.test(afterClose), '① 实施票完成不写 ## Answer（原文只要求地图子票写答案）')
  check(/^## Comments$/m.test(afterClose), '① 关闭原因写进 ## Comments 段')
  check(commentCount(afterClose) === 1, '① ## Comments 下只有一条评论：' + commentCount(afterClose))
  check(/^### local \u2014 \d{4}-\d{2}-\d{2}T/m.test(sectionBody(afterClose, 'Comments')), '① 评论头沿用同一套房规：### <actor> — <ISO 时间>')
  check(sectionBody(afterClose, 'Comments').indexOf('第一步做完了') >= 0, '① 关闭原因成为评论正文')
  check(/\*\*What to build:\*\* 用户能看到第一步。/.test(afterClose) && /- \[ \] 能看到结果/.test(afterClose), '① 正文与验收项原样保留')
  check(headerComments(afterClose).length === headerComments(beforeClose).length, '① 隐藏注释只同步、不多写：' + JSON.stringify(headerComments(afterClose)))
  check(headerComments(afterClose).indexOf('<!-- DSH-STATUS: closed -->') < 0, '① 实施票状态不写隐藏 DSH-STATUS（可见行才是状态）')
  check(/^# 01: 第一步$/m.test(afterClose), '① 一级标题原样保留、没有被搬动')
  check(afterClose.indexOf('# 01: 第一步') > afterClose.indexOf('<!-- DSH-CREATED:'), '① 标题仍然在隐藏注释之后')

  const implState = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(implState && implState.ok), '① 读回实施票 ok')
  check(!!(implState && implState.ok && implState.data.state === 'closed'), '① 读回状态是 closed（加粗状态行要能解析）：' + (implState && implState.ok ? implState.data.state : JSON.stringify(implState)))

  // 同一次关闭重复调用：状态已经 resolved、最后一条评论正文又相同，不该再追加一条、也不该写盘。
  const eventsBefore = ctx.events.length
  const again = await closeIssue(ctx as never, featureRepo as never, '01', { reason: '第一步做完了' } as never)
  check(!!(again && again.ok), '① 重复关闭仍返回 ok')
  check(commentCount(readText(implPath)) === 1, '① 重复关闭不重复追加同一条评论')
  const dupWrites = ctx.events.slice(eventsBefore).filter((e) => e.event === 'issue.write' && e.fields.kind === 'close')
  check(dupWrites.length === 1, '⑤ 重复关闭有 issue.write 事件：' + JSON.stringify(dupWrites))
  check(!!(dupWrites[0] && dupWrites[0].fields.reason === 'noop'), '⑤ 文本没变时 reason 是 noop：' + JSON.stringify(dupWrites[0] && dupWrites[0].fields))

  const reopened = await reopenIssue(ctx as never, featureRepo as never, '01')
  check(!!(reopened && reopened.ok), '① 重开返回 ok')
  const afterReopen = readText(implPath)
  check(/\*\*Status:\*\* ready-for-agent/.test(afterReopen), '① 重开把加粗状态行改回 ready-for-agent')
  check(commentCount(afterReopen) === 1, '① 重开不动已有评论')
  const reopenedState = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(reopenedState && reopenedState.ok && reopenedState.data.state === 'open'), '① 重开后读回 open')

  // ══ 第二段：规格与地图容器 —— 状态只在隐藏注释里，可见正文不动 ══
  const specPath = path.join(tmp, '.scratch', '买咖啡积分', 'spec.md')
  const specBefore = readText(specPath)
  const specClosed = await closeIssue(ctx as never, featureRepo as never, '00', {} as never)
  check(!!(specClosed && specClosed.ok), '③ 关规格返回 ok：' + (specClosed && specClosed.ok ? '' : JSON.stringify(specClosed)))
  const specAfter = readText(specPath)
  check(headerComments(specAfter).indexOf('<!-- DSH-STATUS: closed -->') >= 0, '③ 规格状态只写隐藏 DSH-STATUS')
  check(!/^\s*Status\s*[:：]/m.test(specAfter), '③ 规格正文没有可见 Status 行')
  check(specAfter.replace(/<!--\s*DSH-STATUS:[^>]*-->/, '') === specBefore.replace(/<!--\s*DSH-STATUS:[^>]*-->/, ''), '③ 除状态注释外规格文件一字未改')

  const effortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-status-map-'))
  const mapCtx = mkctx(effortTmp)
  const effortRepo = repoOf('effort-a', 'effort')
  const map = await create(mapCtx, effortRepo, { title: '探索地图甲', body: '先把现成方案摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1489-status' })
  check(!!(map && map.ok), '前置：地图建得成：' + (map && map.ok ? '' : JSON.stringify(map)))
  const mapPath = path.join(effortTmp, '.scratch', 'effort-a', 'map.md')
  const mapClosed = await closeIssue(mapCtx as never, effortRepo as never, '00', {} as never)
  check(!!(mapClosed && mapClosed.ok), '③ 关地图返回 ok：' + (mapClosed && mapClosed.ok ? '' : JSON.stringify(mapClosed)))
  const mapAfter = readText(mapPath)
  check(headerComments(mapAfter).indexOf('<!-- DSH-STATUS: closed -->') >= 0, '③ 地图状态写隐藏 DSH-STATUS')
  check(!/^\s*Status\s*[:：]/m.test(mapAfter), '③ 地图正文没有被塞进可见 Status 行')

  // ══ 第三段：地图子票 —— 完成时写 ## Answer + 裸 Status: resolved + 地图指针 ══
  const child = await create(mapCtx, effortRepo, {
    title: '现成方案有哪些？',
    body: '先把已知的开源方案列出来。',
    type: 'issue',
    typeLine: 'research',
    labels: ['wayfinder:research'],
    parentKey: '00',
    idempotencyKey: 'child-1489-status',
  })
  check(!!(child && child.ok), '前置：地图子票建得成：' + (child && child.ok ? '' : JSON.stringify(child)))
  const childFile = fs.readdirSync(path.join(effortTmp, '.scratch', 'effort-a', 'issues')).filter((f) => f.indexOf('01-') === 0)[0]
  const childPath = path.join(effortTmp, '.scratch', 'effort-a', 'issues', childFile)
  const childBefore = readText(childPath)
  check(!/^Status\s*[:：]/m.test(childBefore), '前置：未认领的子票没有 Status 行（原文：open、unassigned 即 unclaimed）')

  const childClosed = await closeIssue(mapCtx as never, effortRepo as never, '01', { reason: '现成方案够用，走查完成' } as never)
  check(!!(childClosed && childClosed.ok), '④ 关地图子票返回 ok：' + (childClosed && childClosed.ok ? '' : JSON.stringify(childClosed)))
  const childAfter = readText(childPath)
  check(/^Status: resolved$/m.test(childAfter), '④ 子票裸状态行改成 resolved')
  check(childAfter.indexOf('**Status:**') < 0, '④ 子票不写实施票的加粗状态行')
  check(/^## Answer$/m.test(childAfter), '④ 子票完成写 ## Answer')
  check(sectionBody(childAfter, 'Answer').indexOf('现成方案够用，走查完成') >= 0, '④ 关闭原因写进 ## Answer')
  check(childAfter.indexOf('Close reason') < 0, '④ 地图子票不写 Close reason 行')
  check(sectionBody(childAfter, 'Question').indexOf('先把已知的开源方案列出来。') >= 0, '④ ## Question 原样保留')
  const decisions = sectionBody(readText(mapPath), 'Decisions so far')
  check(decisions.indexOf('现成方案有哪些？') >= 0, '④ 地图的 Decisions so far 追加了指针：' + JSON.stringify(decisions))
  const childState = await getIssue(mapCtx as never, effortRepo as never, '01', {} as never)
  check(!!(childState && childState.ok && childState.data.state === 'closed'), '④ 读回子票状态 closed')
  // 重复关闭：不重复写 Answer、不重复追加地图指针。
  await closeIssue(mapCtx as never, effortRepo as never, '01', { reason: '现成方案够用，走查完成' } as never)
  const childAgain = readText(childPath)
  check((childAgain.match(/^## Answer$/gm) || []).length === 1, '④ 重复关闭只有一个 ## Answer 段')
  check(sectionBody(childAgain, 'Answer').indexOf('现成方案够用，走查完成') >= 0, '④ 重复关闭不重复写答案')
  check((sectionBody(readText(mapPath), 'Decisions so far').match(/现成方案有哪些？/g) || []).length === 1, '④ 重复关闭不重复追加地图指针')

  // ══ 第四段：旧布局回归 —— 可见 Status + Close reason 行，一字不动 ══
  const legacyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-status-legacy-'))
  const legacyCtx = mkctx(legacyTmp)
  const legacyRepo = repoOf()
  writeText(path.join(legacyTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n')
  const legacyPath = path.join(legacyTmp, '.scratch', 'demo', 'issues', '01-first-ticket.md')
  writeText(legacyPath, '# 第一张票\n\n正文\n\nStatus: ready-for-agent\nType: task\n\n## Comments\n')
  const legacyBefore = readText(legacyPath)
  const legacyClosed = await closeIssue(legacyCtx as never, legacyRepo as never, '01', { reason: '老票也关了' } as never)
  check(!!(legacyClosed && legacyClosed.ok), '旧布局：关票返回 ok：' + (legacyClosed && legacyClosed.ok ? '' : JSON.stringify(legacyClosed)))
  const legacyAfter = readText(legacyPath)
  check(/^Status: resolved$/m.test(legacyAfter), '旧布局：可见 Status 行改成 resolved（旧行为不变）')
  check(/^Close reason: 老票也关了$/m.test(legacyAfter), '旧布局：仍然写 Close reason 行（旧行为不变）')
  check(!/\*\*Status:\*\*/.test(legacyAfter), '旧布局：不会被改成加粗行')
  check(legacyAfter.indexOf('## Answer') < 0, '旧布局：不新增 ## Answer')
  // 旧布局关票只该动两处：Status 行的值，和新增的一行 Close reason；其余原文一字不差。
  // （不能拿「原文是不是连续子串」来判 —— 新插入的 Close reason 行把原文切成了两段。）
  const legacyNormalized = legacyAfter.replace(/^Close reason: .*\n?/m, '').replace(/Status: resolved/, 'Status: ready-for-agent').replace(/\n$/, '')
  check(legacyNormalized === legacyBefore.replace(/\n$/, ''), '旧布局：除状态与原因行外原文保留：' + JSON.stringify(legacyNormalized))

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(effortTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
  try { fs.rmSync(legacyTmp, { recursive: true, force: true }) } catch { /* 同上 */ }
}

main()
  .catch((e) => {
    console.error(e)
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
