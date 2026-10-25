// tests/verify-1489-progress.ts —— #1489 验收②：进度追加的位置与格式与 GitHub 后端同一套，旧文件没有进度区也能补。
//
// 原文（issue-tracker-local.md:11）只说「评论追加到文件底部 ## Comments 下」；进度是 deck 的增强，
// 用共享机制（src/shared/issue-file/src/progress.ts）与 GitHub 后端同一份写法。本地票读回的正文是整份
// 文件，所以「正文末尾」在盘上就是「文件末尾」：进度区要长在最后一段。这一扇走 deck_issue_patch 的
// 真实算法（get 读回整份正文 → ensureBody → planBodyWrite → update 写回 → 写后核对），钉住：
//   · 插件按原文布局建的票：进度区追加在文件末尾，一条记录写法是「- 进度：N%（时间）：说明」；
//   · 手写原文文件（没有 DSH-FORMAT）：同样追加在末尾，不被塞进原文没有的 ## Comments / ## Answer 骨架；
//   · 老插件格式文件（裸字段、自带 Comments/Answer 骨架）：行为与改之前一致，进度加在文末；
//   · 先写进度、再追加评论：评论进 ## Comments 段（位置在进度区之上），进度仍是最后一段，实施票不多个 ## Answer。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1489-progress.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, getIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { updateIssue } from '../src/tracker/rooms/markdown/issues-patch.ts'
import { addComment } from '../src/tracker/rooms/markdown/comments.ts'
import { ensureBody } from '../src/deck/shell/minimal-spec.ts'
import { planBodyWrite, bodyWriteReadbackProblem } from '../src/deck/shell/body-write.ts'
import { PROGRESS_BODY_LIMIT } from '../src/shared/issue-file/src/progress.ts'
import { stampNow } from '../src/shared/issue-file/src/progress-tool.ts'

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
function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}
function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}
/** 进度区是不是文件最后一段：标题之后不再出现别的二级标题。 */
function progressIsLastSection(text: string): boolean {
  const all = text.split('\n')
  let at = -1
  for (let i = 0; i < all.length; i += 1) if (/^##\s*进度\s*$/.test(all[i])) at = i
  if (at < 0) return false
  for (let i = at + 1; i < all.length; i += 1) {
    if (/^##\s+/.test(all[i])) return false
  }
  return true
}
/** 走 deck_issue_patch 的进度写法：读回整份正文 → 补进度骨架 → 计划 → 写回 → 写后核对。 */
async function writeProgressLikeDeck(ctx: unknown, repo: Record<string, unknown>, key: string, percent: number, note: string) {
  const cur: any = await getIssue(ctx as never, repo as never, key, {} as never)
  const base = cur && cur.ok && cur.data && typeof cur.data.body === 'string' ? cur.data.body : null
  if (base === null) return { ok: false as const, why: '旧正文没读回来' }
  const ensured = ensureBody(base, 'issue').body
  const planned = planBodyWrite(ensured, { percent: percent, note: note, updatedAt: stampNow(Date.now()) }, null, PROGRESS_BODY_LIMIT, true)
  if (planned.plan === null) return { ok: false as const, why: planned.problem }
  const r: any = await updateIssue(ctx as never, repo as never, key, { body: planned.plan.next } as never)
  if (!(r && r.ok)) return { ok: false as const, why: JSON.stringify(r) }
  const after: any = await getIssue(ctx as never, repo as never, key, {} as never)
  const body = after && after.ok && after.data && typeof after.data.body === 'string' ? after.data.body : ''
  return { ok: true as const, why: bodyWriteReadbackProblem(planned.plan, body) }
}
function writeEvents(ctx: { events: LogLine[] }, kind: string): LogLine[] {
  return ctx.events.filter((e) => e.event === 'issue.write' && e.fields.kind === kind)
}

async function main(): Promise<void> {
  // ══ 第一段：插件按原文布局建的票 —— 进度追加在文件末尾，格式与 GitHub 同一份 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1489-progress-'))
  const ctx = mkctx(tmp)
  const baseRepo = repoOf()
  await createIssue(ctx as never, baseRepo as never, { title: '买咖啡积分', body: '## Problem Statement\n\n用户想用积分买咖啡。', type: 'spec', idempotencyKey: 'spec-1489-progress' } as never)
  const featureRepo = repoOf('买咖啡积分', 'feature')
  const created: any = await createIssue(ctx as never, featureRepo as never, { title: '第一步', body: '**What to build:** 用户能看到第一步。', type: 'issue', parentKey: '00', idempotencyKey: 'impl-1489-progress-1' } as never)
  check(!!(created && created.ok), '前置：按原文布局建的实施票建得成')
  const implPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '01-第一步.md')
  const before = readText(implPath)
  const w1 = await writeProgressLikeDeck(ctx, featureRepo, '01', 60, '写了一半')
  check(w1.ok && w1.why === '', '② 走 deck 的进度写法回 ok 且写后核对通过：' + (w1.ok ? w1.why : w1.why))
  const after1 = readText(implPath)
  check(after1.indexOf('## 进度') >= 0, '② 文件里出现了 ## 进度 区')
  check(progressIsLastSection(after1), '② 进度区是文件最后一段（正文末尾 = 文件末尾）')
  check(/^-\s*进度：60%（\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}）：写了一半$/m.test(after1), '② 记录写法是共享机制的「- 进度：N%（ISO 时间）：说明」：' + JSON.stringify(after1.split('\n').filter((l) => l.indexOf('进度：60%') >= 0)))
  check(after1.indexOf('## Answer') < 0, '② 实施票写进度不会多出 ## Answer')
  check(after1.indexOf('## Comments') < 0, '② 新布局文件没被塞进原文没有的 ## Comments 骨架')
  const stripped = after1.replace(/\n+## 进度[\s\S]*$/, '').replace(/\s+$/, '')
  check(stripped === before.replace(/\s+$/, ''), '② 去掉进度区后文件其余部分逐字未动')
  const wev = writeEvents(ctx, 'update')
  check(wev.length === 1 && wev[0].fields.ok === true && wev[0].fields.route === 'file', '⑤ 写进度这一趟记了 issue.write（kind=update、route=file）：' + JSON.stringify(wev))

  // ② 先写进度、再追加评论：评论进 ## Comments 段（在进度区之上），进度仍是最后一段。
  const c1: any = await addComment(ctx as never, featureRepo as never, '01', '第一条评论')
  check(!!(c1 && c1.ok), '前置：追加评论回 ok')
  const after2 = readText(implPath)
  check(after2.indexOf('第一条评论') >= 0, '② 评论按既有写法落进文件：' + JSON.stringify(after2.split('\n').filter((l) => l.indexOf('第一条评论') >= 0)))
  check(after2.indexOf('## Comments') >= 0 && after2.indexOf('## Comments') < after2.indexOf('## 进度'), '② 评论段在进度区之上（进度仍长在最后）')
  check(after2.indexOf('## Answer') < 0, '② 实施票追加评论不会多出 ## Answer')
  check(progressIsLastSection(after2), '② 追加评论以后进度区仍是最后一段')
  const w2 = await writeProgressLikeDeck(ctx, featureRepo, '01', 80, '快写完了')
  check(w2.ok && w2.why === '', '② 评论之后再写一条进度，写后核对通过：' + (w2.ok ? w2.why : w2.why))
  const after3 = readText(implPath)
  check(after3.indexOf('- 进度：80%') >= 0 && after3.indexOf('- 进度：60%') >= 0, '② 两条进度记录都在（最新在最上）')
  check(after3.indexOf('第一条评论') >= 0 && progressIsLastSection(after3), '② 评论原样保留、进度区仍在最后')

  // ══ 第二段：手写原文文件（没有 DSH-FORMAT）—— 进度同样加在末尾，不塞插件骨架 ══
  const handPath = path.join(tmp, '.scratch', '手写目录', 'issues', '01-手写实施票.md')
  const handText = '# 01: 手写实施票\n\n**What to build:** 手写票要做的事。\n\n**Blocked by:** None (can start immediately)\n\n**Status:** ready-for-agent\n'
  writeText(handPath, handText)
  const handRepo = repoOf('手写目录')
  const wh = await writeProgressLikeDeck(ctx, handRepo, '01', 40, '手写票第一次记进度')
  check(wh.ok && wh.why === '', '② 手写原文文件写进度回 ok 且写后核对通过：' + (wh.ok ? wh.why : wh.why))
  const handAfter = readText(handPath)
  check(handAfter.indexOf('## 进度') >= 0 && progressIsLastSection(handAfter), '② 手写原文文件的进度区也在文件末尾')
  check(handAfter.indexOf('## Answer') < 0, '② 手写实施票写进度没有被塞进 ## Answer')
  check(handAfter.indexOf('## Comments') < 0, '② 手写实施票写进度没有被塞进 ## Comments 骨架')
  check(handAfter.replace(/\n+## 进度[\s\S]*$/, '').replace(/\s+$/, '') === handText.replace(/\s+$/, ''), '② 手写原文文件除进度区外逐字未动')

  // ══ 第三段：老插件格式文件（裸字段、自带骨架）—— 行为不变，进度加在文末 ══
  const legacyPath = path.join(tmp, '.scratch', '老目录', 'issues', '01-老票.md')
  const legacyText = '# 老票\n\n正文一段。\n\nStatus: ready-for-agent\n\nType: task\n\n## Comments\n\n## Answer\n'
  writeText(legacyPath, legacyText)
  const legacyRepo = repoOf('老目录')
  const wl = await writeProgressLikeDeck(ctx, legacyRepo, '01', 30, '老票第一次记进度')
  check(wl.ok && wl.why === '', '② 老插件格式文件写进度回 ok 且写后核对通过：' + (wl.ok ? wl.why : wl.why))
  const legacyAfter = readText(legacyPath)
  check(legacyAfter.indexOf('## 进度') >= 0 && progressIsLastSection(legacyAfter), '② 老插件格式文件的进度区加在文末')
  check(legacyAfter.indexOf('## Comments') >= 0 && legacyAfter.indexOf('## Answer') >= 0 && legacyAfter.indexOf('正文一段。') >= 0, '② 老文件的正文与骨架原样保留')

  // ══ 第四段：手写原文的地图子票 —— 进度也加在末尾，不塞骨架 ══
  const wfRoot = path.join(tmp, '.scratch', '找方案')
  writeText(path.join(wfRoot, 'map.md'), '# 找方案地图\n\n## Notes\n\n笔记\n')
  const childPath = path.join(wfRoot, 'issues', '01-这个票问什么.md')
  const childText = '# 01: 这个票问什么？\n\nType: research\n\n## Question\n\n要查什么。\n'
  writeText(childPath, childText)
  const wfRepo = repoOf('找方案')
  const wc = await writeProgressLikeDeck(ctx, wfRepo, '01', 20, '查了一点')
  check(wc.ok && wc.why === '', '② 手写地图子票写进度回 ok 且写后核对通过：' + (wc.ok ? wc.why : wc.why))
  const childAfter = readText(childPath)
  check(childAfter.indexOf('## 进度') >= 0 && progressIsLastSection(childAfter), '② 手写地图子票的进度区加在末尾')
  check(childAfter.indexOf('## Comments') < 0 && childAfter.indexOf('## Answer') < 0, '② 手写地图子票没有被塞进 Comments/Answer 骨架')
  check(childAfter.indexOf('## Question') >= 0 && childAfter.indexOf('要查什么。') >= 0, '② 手写地图子票的 Question 原样保留')

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  if (failed) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
