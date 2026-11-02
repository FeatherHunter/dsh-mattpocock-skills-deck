// tests/verify-1788-write-route.ts —— #1788 验收：本地 Markdown 后端按「票所在目录」决定写路线。
//
// 故障原貌：一张手写的普通票（例如只写了 # 01: 标题 和裸 Status: needs-triage），
// 写认领时被票面「像不像地图子票」误导，可见 Status 被静默覆盖成 claimed。
// 这一扇钉住的是「路线由目录决定、字段按票面已有样式写」这条行为：
//   A 规格目录里的手写普通票：认领只写文件头隐藏注释，可见 Status 一字不动；
//   B 手写票带裸 Type: task 也不认成地图子票：认领只写隐藏注释，Type 行原样；
//   C 未认领直接关闭手写普通票：可见 Status: resolved，原因进 ## Comments，不写 ## Answer / Close reason；
//   D 先认领再关闭：认领后票面形状不变，关闭结果与 C 相同（#1788 的原始故障点）；
//   E 重开：可见 Status 回到 ready-for-agent，文件里只有一行可见状态行；
//   F 加粗实施票：认领/关闭/重开只改 **Status:** 加粗行，不混入裸 Status 行；
//   G 真正的地图子票：认领写 Status: claimed，关闭写 Status: resolved + 原因进 ## Answer，
//     并在同目录 map.md 的 ## Decisions so far 追加指向这张子票的指针行；
//   H 旧扁平路径（.scratch/map.md + .scratch/issues/）写认领仍然被拒绝，文件一个字节不动；
//   I Blocked by 按票面已有样式写（只有裸字段的票写裸行，加粗实施票写加粗行）；
//   J 挂父票写文件头隐藏 <!-- DSH-PARENT: NN -->，不再写旧的 <!-- parentKey: NN -->。
//   K 目录里没有编号的手写票（文件名与标题都没有编号）：认领同样只写隐藏注释、可见 Status 不动。
//   L 对 00 号容器（spec.md / map.md 本身）写阻塞边：如实拒绝，文件一个字节不动。
//   M 规格路线（手写票、加粗实施票、规格容器）上写 customFields Type：如实拒绝，文件一个字节不动；
//   N 地图子票写 Type：只改那行裸 Type（值只认四个类型词），不加粗、不出现第二行。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1788-write-route.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, getIssue, updateIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { setAssigneesIssue, setBlockedByIssue, setParentIssue } from '../src/tracker/rooms/markdown/issues-patch.ts'
import { closeIssue, reopenIssue } from '../src/tracker/rooms/markdown/issues-status.ts'
import { ticketFormOf } from '../src/tracker/rooms/markdown/original-fields.ts'

let failed = false
let passed = 0
let failedCount = 0
function check(ok: unknown, msg: string): void {
  if (ok) { passed += 1; console.log('  PASS ' + msg) }
  else { failed = true; failedCount += 1; console.log('  FAIL ' + msg) }
}
/** 失败信息里只截一段文本，避免把整张票刷进日志。 */
function head(text: string, n?: number): string {
  const limit = n || 240
  return JSON.stringify(text.length > limit ? text.slice(0, limit) + '…' : text)
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
/** 去掉指定的那一行隐藏注释（连同行尾换行），用来断言「除这一行外一字未改」。 */
function withoutHiddenComment(text: string, name: string): string {
  const re = new RegExp('^[ \\t]*<!--\\s*' + name + ':[^\\n]*-->[ \\t]*\\r?\\n', 'm')
  return text.replace(re, '')
}
function countStatusLines(text: string): number {
  return text.split('\n').filter((line) => /^Status\s*[:：]/.test(line)).length
}
function countTypeLines(text: string): number {
  return text.split('\n').filter((line) => /^\s*(?:\*\*)?Type(?:\*\*)?\s*[:：]/.test(line)).length
}

async function main(): Promise<void> {
  // ══ 第一组临时目录：规格目录（spec 路线）里的手写普通票 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1788-route-spec-'))
  const ctx = mkctx(tmp)
  const spec = await create(ctx, repoOf(), { title: '验收甲', body: '## Problem Statement\n\n普通票写路径的验收。', type: 'spec', idempotencyKey: 'spec-1788-route' })
  check(!!(spec && spec.ok), '前置：规格目录「验收甲」建得成；实际返回：' + JSON.stringify(spec))
  const featureRepo = repoOf('验收甲', 'feature')
  const issuesDir = path.join(tmp, '.scratch', '验收甲', 'issues')
  const ticket01 = path.join(issuesDir, '01-只有裸状态的手写票.md')
  const ticket02 = path.join(issuesDir, '02-带类型行的普通票.md')
  const ticket03 = path.join(issuesDir, '03-未认领直接关闭.md')
  const ticket04 = path.join(issuesDir, '04-先认领再关闭.md')
  const ticket05 = path.join(issuesDir, '05-改阻塞的手写票.md')
  const ticket06 = path.join(issuesDir, '06-挂父票的手写票.md')
  writeText(ticket01, '# 01: 只有裸状态的手写票\n\n正文只有一句。\n\nStatus: needs-triage\n')
  writeText(ticket02, '# 02: 带类型行的普通票\n\n正文只有一句。\n\nType: task\n\nStatus: needs-triage\n')
  writeText(ticket03, '# 03: 未认领直接关闭的手写票\n\n正文只有一句。\n\nStatus: needs-triage\n')
  writeText(ticket04, '# 04: 先认领再关闭的手写票\n\n正文只有一句。\n\nType: task\n\nStatus: needs-triage\n')
  writeText(ticket05, '# 05: 改阻塞的手写票\n\n正文只有一句。\n\nStatus: needs-triage\n')
  writeText(ticket06, '# 06: 挂父票的手写票\n\n正文只有一句。\n\nStatus: needs-triage\n')

  // —— 场景 A：最小手写票，认领只进隐藏注释 ——
  const aBefore = readText(ticket01)
  const aClaim = await setAssigneesIssue(ctx as never, featureRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(aClaim && aClaim.ok), 'A 认领手写普通票要成功；实际返回：' + JSON.stringify(aClaim))
  const aAfter = readText(ticket01)
  const aComments = headerComments(aAfter)
  check(aComments.indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'A 认领人写进文件头隐藏注释 <!-- DSH-ASSIGNEES: alice -->；实际文件头注释：' + JSON.stringify(aComments))
  check(withoutHiddenComment(aAfter, 'DSH-ASSIGNEES') === aBefore, 'A 除新增的那一行认领人注释外，票面一字未改；实际：' + head(withoutHiddenComment(aAfter, 'DSH-ASSIGNEES')))
  check(/^Status: needs-triage$/m.test(aAfter), 'A 可见 Status 仍是 needs-triage，没有被覆盖成 claimed；实际：' + JSON.stringify(aAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(!/^Assignees\s*[:：]/m.test(aAfter), 'A 没有新插可见 Assignees 行（原文没有这一行）')
  check(ticketFormOf(aBefore) === ticketFormOf(aAfter), 'A 票面形状（ticketFormOf）认领前后相同；认领前：' + ticketFormOf(aBefore) + '，认领后：' + ticketFormOf(aAfter))
  const aRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(logins(aRead && aRead.ok ? aRead.data : null).join(',') === 'alice', 'A 读回认领人是 alice；实际：' + JSON.stringify(logins(aRead && aRead.ok ? aRead.data : null)))

  // —— 场景 B：带裸 Type: task 的手写票也不能被当成地图子票 ——
  const bBefore = readText(ticket02)
  const bClaim = await setAssigneesIssue(ctx as never, featureRepo as never, '02', ['alice'] as never, {} as never)
  check(!!(bClaim && bClaim.ok), 'B 认领「# 02: 标题 + 裸 Type: task」的手写票要成功；实际返回：' + JSON.stringify(bClaim))
  const bAfter = readText(ticket02)
  check(headerComments(bAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'B 认领人只写进文件头隐藏注释；实际文件头注释：' + JSON.stringify(headerComments(bAfter)))
  check(withoutHiddenComment(bAfter, 'DSH-ASSIGNEES') === bBefore, 'B 除认领人注释外票面一字未改；实际：' + head(withoutHiddenComment(bAfter, 'DSH-ASSIGNEES')))
  check(/^Type: task$/m.test(bAfter), 'B 手写的 Type: task 行原样保留；实际：' + JSON.stringify(bAfter.split('\n').filter((l) => /^Type/.test(l))))
  check(/^Status: needs-triage$/m.test(bAfter), 'B 可见 Status 仍是 needs-triage；实际：' + JSON.stringify(bAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(ticketFormOf(bBefore) === ticketFormOf(bAfter), 'B 票面形状认领前后相同；认领前：' + ticketFormOf(bBefore) + '，认领后：' + ticketFormOf(bAfter))

  // —— 场景 C：未认领直接关闭 ——
  const closeReason = '验收：没认领也能直接关闭。'
  const cBefore = readText(ticket03)
  check(cBefore.indexOf('## Comments') < 0, '前置：03 号票关闭前还没有 ## Comments 段')
  const cClose = await closeIssue(ctx as never, featureRepo as never, '03', { reason: closeReason } as never)
  check(!!(cClose && cClose.ok), 'C 关闭手写普通票要成功；实际返回：' + JSON.stringify(cClose))
  const cAfter = readText(ticket03)
  check(/^Status: resolved$/m.test(cAfter), 'C 可见状态改成裸行 Status: resolved；实际：' + JSON.stringify(cAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(countStatusLines(cAfter) === 1, 'C 文件里只有一行可见 Status；实际 ' + countStatusLines(cAfter) + ' 行')
  check(sectionBody(cAfter, 'Comments').indexOf(closeReason) >= 0, 'C 关闭原因写进 ## Comments 段；实际 Comments 段：' + head(sectionBody(cAfter, 'Comments')))
  check(cAfter.indexOf('## Answer') < 0, 'C 普通票关闭不写 ## Answer 段')
  check(!/^Close reason\s*[:：]/m.test(cAfter), 'C 普通票关闭不写 Close reason 行')
  check(cAfter.indexOf('**Status:**') < 0, 'C 普通票不出现加粗 **Status:** 行')

  // —— 场景 D：先认领再关闭（#1788 的原始故障点） ——
  const dBefore = readText(ticket04)
  const dClaim = await setAssigneesIssue(ctx as never, featureRepo as never, '04', ['alice'] as never, {} as never)
  check(!!(dClaim && dClaim.ok), 'D 先认领 04 号票要成功；实际返回：' + JSON.stringify(dClaim))
  const dClaimed = readText(ticket04)
  check(ticketFormOf(dBefore) === ticketFormOf(dClaimed), 'D 认领后票面形状不变；认领前：' + ticketFormOf(dBefore) + '，认领后：' + ticketFormOf(dClaimed))
  check(/^Status: needs-triage$/m.test(dClaimed), 'D 认领后可见 Status 仍是 needs-triage；实际：' + JSON.stringify(dClaimed.split('\n').filter((l) => /^Status/.test(l))))
  const dReason = '验收：先认领再关闭。'
  const dClose = await closeIssue(ctx as never, featureRepo as never, '04', { reason: dReason } as never)
  check(!!(dClose && dClose.ok), 'D 认领之后再关闭要成功；实际返回：' + JSON.stringify(dClose))
  const dAfter = readText(ticket04)
  check(/^Status: resolved$/m.test(dAfter), 'D 关闭后可见状态是裸行 Status: resolved；实际：' + JSON.stringify(dAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(countStatusLines(dAfter) === 1, 'D 文件里只有一行可见 Status；实际 ' + countStatusLines(dAfter) + ' 行')
  check(sectionBody(dAfter, 'Comments').indexOf(dReason) >= 0, 'D 关闭原因写进 ## Comments 段；实际 Comments 段：' + head(sectionBody(dAfter, 'Comments')))
  check(dAfter.indexOf('## Answer') < 0, 'D 普通票关闭不写 ## Answer 段')
  check(!/^Close reason\s*[:：]/m.test(dAfter), 'D 普通票关闭不写 Close reason 行')
  check(headerComments(dAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'D 关闭后文件头仍保留认领人注释（关闭不抹掉认领记录）')

  // —— 场景 E：重开 ——
  const eReopen = await reopenIssue(ctx as never, featureRepo as never, '03')
  check(!!(eReopen && eReopen.ok), 'E 重开已关闭的票要成功；实际返回：' + JSON.stringify(eReopen))
  const eAfter = readText(ticket03)
  check(/^Status: ready-for-agent$/m.test(eAfter), 'E 可见状态回到裸行 Status: ready-for-agent；实际：' + JSON.stringify(eAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(countStatusLines(eAfter) === 1, 'E 重开后文件里只有一行可见 Status；实际 ' + countStatusLines(eAfter) + ' 行')
  check(eAfter.indexOf('**Status:**') < 0, 'E 普通票重开后不出现加粗 **Status:** 行')

  // —— 场景 I（手写票）：Blocked by 按已有样式写裸行 ——
  const iBefore = readText(ticket05)
  const iBlocked = await setBlockedByIssue(ctx as never, featureRepo as never, '05', ['01'] as never, {} as never)
  check(!!(iBlocked && iBlocked.ok), 'I 手写票改阻塞要成功；实际返回：' + JSON.stringify(iBlocked))
  const iAfter = readText(ticket05)
  check(/^Blocked by\s*[:：]\s*#?01\s*$/m.test(iAfter), 'I 只有裸字段的手写票写裸 Blocked by 行（值 01 或 #01）；实际：' + JSON.stringify(iAfter.split('\n').filter((l) => /Blocked by/.test(l))))
  check(iAfter.indexOf('**Blocked by:**') < 0, 'I 手写票不出现加粗 **Blocked by:** 行')
  check(/^Status: needs-triage$/m.test(iAfter), 'I 改阻塞不动已有的可见 Status；实际：' + JSON.stringify(iAfter.split('\n').filter((l) => /^Status/.test(l))))

  // —— 场景 J：挂父票写隐藏 DSH-PARENT ——
  const jBefore = readText(ticket06)
  const jParent = await setParentIssue(ctx as never, featureRepo as never, '06', '02', {} as never)
  check(!!(jParent && jParent.ok), 'J 手写票挂父票要成功；实际返回：' + JSON.stringify(jParent))
  const jAfter = readText(ticket06)
  check(headerComments(jAfter).indexOf('<!-- DSH-PARENT: 02 -->') >= 0, 'J 父票关系写进文件头隐藏注释 <!-- DSH-PARENT: 02 -->；实际文件头注释：' + JSON.stringify(headerComments(jAfter)))
  check(!/<!--\s*parentKey\s*:/.test(jAfter), 'J 不再写旧的 <!-- parentKey: ... --> 注释')
  check(withoutHiddenComment(jAfter, 'DSH-PARENT') === jBefore, 'J 除父票注释外票面一字未改；实际：' + head(withoutHiddenComment(jAfter, 'DSH-PARENT')))

  // —— 场景 K：目录里没有编号的手写票（文件名与一级标题都没有编号） ——
  // 分诊认定最容易被误伤的正是这种票：手写票不一定按插件建票的 NN-前缀命名。
  const ticketK = path.join(issuesDir, '没有编号的手写票.md')
  writeText(ticketK, '# 没有编号的手写票\n\n正文只有一句。\n\nStatus: needs-triage\n')
  const kBefore = readText(ticketK)
  const kClaim = await setAssigneesIssue(ctx as never, featureRepo as never, '没有编号的手写票', ['alice'] as never, {} as never)
  check(!!(kClaim && kClaim.ok), 'K 认领没有编号的手写票要成功；实际返回：' + JSON.stringify(kClaim))
  const kAfter = readText(ticketK)
  check(headerComments(kAfter).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'K 认领人写进文件头隐藏注释；实际文件头注释：' + JSON.stringify(headerComments(kAfter)))
  check(withoutHiddenComment(kAfter, 'DSH-ASSIGNEES') === kBefore, 'K 除认领人注释外票面一字未改；实际：' + head(withoutHiddenComment(kAfter, 'DSH-ASSIGNEES')))
  check(/^Status: needs-triage$/m.test(kAfter), 'K 可见 Status 仍是 needs-triage；实际：' + JSON.stringify(kAfter.split('\n').filter((l) => /^Status/.test(l))))
  check(ticketFormOf(kBefore) === ticketFormOf(kAfter), 'K 票面形状认领前后相同；认领前：' + ticketFormOf(kBefore) + '，认领后：' + ticketFormOf(kAfter))

  // —— 场景 L：00 号容器（spec.md 本身）没有 Blocked by 字段，写阻塞边要如实拒绝 ——
  const specPath = path.join(tmp, '.scratch', '验收甲', 'spec.md')
  const lSpecBefore = readText(specPath)
  const lSpecBlocked = await setBlockedByIssue(ctx as never, featureRepo as never, '00', ['01'] as never, {} as never)
  check(!(lSpecBlocked && lSpecBlocked.ok), 'L 对规格容器 00 写阻塞边要失败（容器原文没有 Blocked by）；实际返回：' + JSON.stringify(lSpecBlocked))
  check(!!(lSpecBlocked && !lSpecBlocked.ok && lSpecBlocked.error.kind === 'unsupported'), 'L 失败档位是 unsupported；实际：' + JSON.stringify(lSpecBlocked && !lSpecBlocked.ok ? lSpecBlocked.error : lSpecBlocked))
  check(readText(specPath) === lSpecBefore, 'L 被拒绝后 spec.md 一个字节都没变；实际：' + head(readText(specPath)))
  check(readText(specPath).indexOf('Blocked by') < 0, 'L spec.md 里没有被插入 Blocked by 行')

  // —— 场景 M（规格路线）：原文实施票与普通票都没有 Type 字段，写它要如实拒绝 ——
  const mSpecBefore = readText(ticket02)
  const mSpecType = await updateIssue(ctx as never, featureRepo as never, '02', { customFields: [{ name: 'Type', value: 'prototype', type: 'single' }] } as never)
  check(!(mSpecType && mSpecType.ok), 'M 对规格目录里的手写票写 customFields Type 要失败（原文实施票没有 Type）；实际返回：' + JSON.stringify(mSpecType))
  check(!!(mSpecType && !mSpecType.ok && mSpecType.error.kind === 'unsupported'), 'M 失败档位是 unsupported；实际：' + JSON.stringify(mSpecType && !mSpecType.ok ? mSpecType.error : mSpecType))
  check(readText(ticket02) === mSpecBefore, 'M 被拒绝后手写票一个字节都没变；实际：' + head(readText(ticket02)))
  check(countTypeLines(readText(ticket02)) === 1, 'M 手写票里仍然只有原来那一行 Type: task；实际 ' + countTypeLines(readText(ticket02)) + ' 行')

  const mContainerBefore = readText(specPath)
  const mContainerType = await updateIssue(ctx as never, featureRepo as never, '00', { customFields: [{ name: 'Type', value: 'task', type: 'single' }] } as never)
  check(!(mContainerType && mContainerType.ok), 'M 对规格容器 00 写 customFields Type 同样要失败；实际返回：' + JSON.stringify(mContainerType))
  check(readText(specPath) === mContainerBefore, 'M 被拒绝后 spec.md 一个字节都没变；实际：' + head(readText(specPath)))
  check(readText(specPath).indexOf('Type:') < 0, 'M spec.md 里没有被插入 Type 行')

  // ══ 第二组临时目录：加粗实施票（impl-ticket 路线语义不变） ══
  const tmpImpl = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1788-route-impl-'))
  const ctxImpl = mkctx(tmpImpl)
  const spec2 = await create(ctxImpl, repoOf(), { title: '实施票验收', body: '## Problem Statement\n\n加粗实施票的写路径。', type: 'spec', idempotencyKey: 'spec-1788-impl' })
  check(!!(spec2 && spec2.ok), '前置：规格目录「实施票验收」建得成；实际返回：' + JSON.stringify(spec2))
  const implRepo = repoOf('实施票验收', 'feature')
  const implA = await create(ctxImpl, implRepo, { title: '加粗实施票甲', body: '**What to build:** 只改加粗行。', type: 'issue', parentKey: '00', idempotencyKey: 'impl-1788-a' })
  const implB = await create(ctxImpl, implRepo, { title: '加粗实施票乙', body: '**What to build:** 当阻塞方用。', type: 'issue', parentKey: '00', idempotencyKey: 'impl-1788-b' })
  check(!!(implA && implA.ok), '前置：加粗实施票甲建得成；实际返回：' + JSON.stringify(implA))
  check(!!(implB && implB.ok), '前置：加粗实施票乙建得成；实际返回：' + JSON.stringify(implB))
  const implPathA = implA && implA.ok ? String(implA.data.url) : ''
  const fBefore = readText(implPathA)
  check(fBefore.indexOf('**Status:** ready-for-agent') >= 0, '前置：加粗实施票甲本来就有 **Status:** ready-for-agent；实际：' + head(fBefore))

  const fClaim = await setAssigneesIssue(ctxImpl as never, implRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(fClaim && fClaim.ok), 'F 认领加粗实施票要成功；实际返回：' + JSON.stringify(fClaim))
  const fClaimed = readText(implPathA)
  check(headerComments(fClaimed).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'F 认领人写进文件头隐藏注释；实际文件头注释：' + JSON.stringify(headerComments(fClaimed)))
  check(fClaimed.indexOf('**Status:** ready-for-agent') >= 0, 'F 认领后加粗状态行仍是 ready-for-agent；实际：' + JSON.stringify(fClaimed.split('\n').filter((l) => /Status/.test(l))))
  check(countStatusLines(fClaimed) === 0, 'F 认领后不出现裸 Status 行；实际裸行数：' + countStatusLines(fClaimed))

  const fBlocked = await setBlockedByIssue(ctxImpl as never, implRepo as never, '01', ['02'] as never, {} as never)
  check(!!(fBlocked && fBlocked.ok), 'F 加粗实施票改阻塞要成功；实际返回：' + JSON.stringify(fBlocked))
  const fBlockedText = readText(implPathA)
  check(/\*\*Blocked by:\*\*\s*#?02/.test(fBlockedText), 'F 加粗实施票写加粗 Blocked by 行（值 02 或 #02）；实际：' + JSON.stringify(fBlockedText.split('\n').filter((l) => /Blocked by/.test(l))))
  check(!/^Blocked by\s*[:：]/m.test(fBlockedText), 'F 加粗实施票不出现裸 Blocked by 行')
  check(countStatusLines(fBlockedText) === 0, 'F 改阻塞后仍然没有裸 Status 行')

  const fReason = '验收：加粗实施票关闭。'
  const fClose = await closeIssue(ctxImpl as never, implRepo as never, '01', { reason: fReason } as never)
  check(!!(fClose && fClose.ok), 'F 关闭加粗实施票要成功；实际返回：' + JSON.stringify(fClose))
  const fClosed = readText(implPathA)
  check(fClosed.indexOf('**Status:** resolved') >= 0, 'F 关闭后加粗状态行改成 **Status:** resolved；实际：' + JSON.stringify(fClosed.split('\n').filter((l) => /Status/.test(l))))
  check(countStatusLines(fClosed) === 0, 'F 关闭后不出现裸 Status 行；实际裸行数：' + countStatusLines(fClosed))
  check(sectionBody(fClosed, 'Comments').indexOf(fReason) >= 0, 'F 关闭原因写进 ## Comments 段；实际：' + head(sectionBody(fClosed, 'Comments')))
  check(fClosed.indexOf('## Answer') < 0, 'F 加粗实施票关闭不写 ## Answer 段')

  const fReopen = await reopenIssue(ctxImpl as never, implRepo as never, '01')
  check(!!(fReopen && fReopen.ok), 'F 重开加粗实施票要成功；实际返回：' + JSON.stringify(fReopen))
  const fReopened = readText(implPathA)
  check(fReopened.indexOf('**Status:** ready-for-agent') >= 0, 'F 重开后加粗状态行回到 **Status:** ready-for-agent；实际：' + JSON.stringify(fReopened.split('\n').filter((l) => /Status/.test(l))))
  check(countStatusLines(fReopened) === 0, 'F 重开后仍然没有裸 Status 行；实际裸行数：' + countStatusLines(fReopened))

  // —— 场景 M（加粗实施票）：没有 Type 字段，写 Type 不能再插一行裸行 ——
  const implBPath = implB && implB.ok ? String(implB.data.url) : ''
  const mImplBefore = readText(implBPath)
  check(mImplBefore.indexOf('Type:') < 0, '前置：加粗实施票乙本来没有 Type 行')
  const mImplType = await updateIssue(ctxImpl as never, implRepo as never, '02', { customFields: [{ name: 'Type', value: 'prototype', type: 'single' }] } as never)
  check(!(mImplType && mImplType.ok), 'M 对加粗实施票写 customFields Type 要失败；实际返回：' + JSON.stringify(mImplType))
  check(readText(implBPath) === mImplBefore, 'M 被拒绝后加粗实施票一个字节都没变；实际：' + head(readText(implBPath)))

  // ══ 第三组临时目录：真正的地图子票（map 路线语义不变） ══
  const tmpMap = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1788-route-map-'))
  const ctxMap = mkctx(tmpMap)
  const mapRepo = repoOf('effort-a', 'effort')
  const map = await create(ctxMap, mapRepo, { title: '探索地图甲', body: '先把现成方案摸清楚。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1788-route' })
  check(!!(map && map.ok), '前置：地图「探索地图甲」建得成；实际返回：' + JSON.stringify(map))
  const child = await create(ctxMap, mapRepo, { title: '现有方案有哪些？', body: '先把已知的开源方案列出来。', type: 'issue', typeLine: 'research', labels: ['wayfinder:research'], parentKey: '00', idempotencyKey: 'child-1788-route' })
  check(!!(child && child.ok), '前置：地图子票建得成；实际返回：' + JSON.stringify(child))
  const child2 = await create(ctxMap, mapRepo, { title: '还有哪些替代方案？', body: '把可替代的方案也列一列。', type: 'issue', typeLine: 'research', labels: ['wayfinder:research'], parentKey: '00', idempotencyKey: 'child2-1788-route' })
  check(!!(child2 && child2.ok), '前置：第二张地图子票建得成；实际返回：' + JSON.stringify(child2))
  const mapPath = map && map.ok ? String(map.data.url) : ''
  const childPath = child && child.ok ? String(child.data.url) : ''
  const child2Path = child2 && child2.ok ? String(child2.data.url) : ''
  const mapBefore = readText(mapPath)
  const gChildClaim = await setAssigneesIssue(ctxMap as never, mapRepo as never, '01', ['alice'] as never, {} as never)
  check(!!(gChildClaim && gChildClaim.ok), 'G 认领地图子票要成功；实际返回：' + JSON.stringify(gChildClaim))
  const gClaimed = readText(childPath)
  check(/^Status: claimed$/m.test(gClaimed), 'G 地图子票认领后可见状态行是 Status: claimed；实际：' + JSON.stringify(gClaimed.split('\n').filter((l) => /Status/.test(l))))
  check(gClaimed.indexOf('**Status:**') < 0, 'G 地图子票不用加粗状态行')
  check(headerComments(gClaimed).indexOf('<!-- DSH-ASSIGNEES: alice -->') >= 0, 'G 地图子票的认领人也写进隐藏注释')

  const gReason = '结论：先把两套现成方案跑通。'
  const gClose = await closeIssue(ctxMap as never, mapRepo as never, '01', { reason: gReason } as never)
  check(!!(gClose && gClose.ok), 'G 关闭地图子票要成功；实际返回：' + JSON.stringify(gClose))
  const gClosed = readText(childPath)
  check(/^Status: resolved$/m.test(gClosed), 'G 地图子票关闭后可见状态行是 Status: resolved；实际：' + JSON.stringify(gClosed.split('\n').filter((l) => /Status/.test(l))))
  check(sectionBody(gClosed, 'Answer').indexOf(gReason) >= 0, 'G 关闭原因写进 ## Answer 段；实际 Answer 段：' + head(sectionBody(gClosed, 'Answer')))
  const mapAfter = readText(mapPath)
  const childFile = path.basename(childPath)
  const pointerLines = mapAfter.split('\n').filter((line) => line.indexOf('](issues/' + childFile + ')') >= 0)
  check(pointerLines.length === 1, 'G 地图的 ## Decisions so far 追加一条指向该子票的指针行；实际匹配 ' + pointerLines.length + ' 行：' + JSON.stringify(pointerLines))
  check(pointerLines.length > 0 && /^-\s/.test(pointerLines[0]), 'G 指针行是列表项（以 - 开头）；实际：' + JSON.stringify(pointerLines[0]))
  check(mapAfter.indexOf('## Decisions so far') >= 0, 'G 地图里仍有 ## Decisions so far 段')
  check(mapAfter !== '' && mapBefore !== '', '前置：地图文件读得到')

  // —— 场景 L（地图容器）：map.md 本身同样没有 Blocked by 字段，也要如实拒绝 ——
  const lMapBefore = readText(mapPath)
  const lMapBlocked = await setBlockedByIssue(ctxMap as never, mapRepo as never, '00', ['01'] as never, {} as never)
  check(!(lMapBlocked && lMapBlocked.ok), 'L 对地图容器 00 写阻塞边同样要失败；实际返回：' + JSON.stringify(lMapBlocked))
  check(readText(mapPath) === lMapBefore, 'L 被拒绝后 map.md 一个字节都没变；实际：' + head(readText(mapPath)))
  check(readText(mapPath).indexOf('Blocked by') < 0, 'L map.md 里没有被插入 Blocked by 行')

  // —— 场景 N（地图路线）：Type 是地图子票的字段，按原文裸行改、值只认四个类型词 ——
  const nBefore = readText(child2Path)
  check(ticketFormOf(nBefore) === 'map-ticket', '前置：第二张子票的票面形状是地图子票；实际：' + ticketFormOf(nBefore))
  const nType = await updateIssue(ctxMap as never, mapRepo as never, '02', { customFields: [{ name: 'Type', value: 'prototype', type: 'single' }] } as never)
  check(!!(nType && nType.ok), 'N 地图子票改 Type 要成功；实际返回：' + JSON.stringify(nType))
  const nAfter = readText(child2Path)
  check(/^Type: prototype$/m.test(nAfter), 'N 地图子票的 Type 改成裸行 Type: prototype；实际：' + JSON.stringify(nAfter.split('\n').filter((l) => /Type/.test(l))))
  check(countTypeLines(nAfter) === 1, 'N 文件里只有一行 Type；实际 ' + countTypeLines(nAfter) + ' 行')
  check(nAfter.indexOf('**Type:**') < 0, 'N 地图子票不用加粗 Type 行')
  check(nAfter === nBefore.replace(/^Type: research$/m, 'Type: prototype'), 'N 除 Type 的值以外票面一字未改；实际：' + head(nAfter))
  check(ticketFormOf(nAfter) === 'map-ticket', 'N 改完 Type 后票面形状仍是地图子票；实际：' + ticketFormOf(nAfter))

  const nBadBefore = readText(child2Path)
  const nBad = await updateIssue(ctxMap as never, mapRepo as never, '02', { customFields: [{ name: 'Type', value: 'not-a-type', type: 'single' }] } as never)
  check(!(nBad && nBad.ok), 'N 地图子票的 Type 写四个类型词以外的值要失败；实际返回：' + JSON.stringify(nBad))
  check(!!(nBad && !nBad.ok && nBad.error.kind === 'unsupported'), 'N 非法 Type 值的失败档位是 unsupported；实际：' + JSON.stringify(nBad && !nBad.ok ? nBad.error : nBad))
  check(readText(child2Path) === nBadBefore, 'N 非法 Type 值被拒绝后票文件一字未改；实际：' + head(readText(child2Path)))

  const nContainerBefore = readText(mapPath)
  const nContainer = await updateIssue(ctxMap as never, mapRepo as never, '00', { customFields: [{ name: 'Type', value: 'task', type: 'single' }] } as never)
  check(!(nContainer && nContainer.ok), 'N 对地图容器 00 写 customFields Type 也要失败；实际返回：' + JSON.stringify(nContainer))
  check(readText(mapPath) === nContainerBefore, 'N 被拒绝后 map.md 一个字节都没变；实际：' + head(readText(mapPath)))

  // ══ 第四组临时目录：旧扁平路径（写路线仍拒绝） ══
  const tmpLegacy = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1788-route-legacy-'))
  const ctxLegacy = mkctx(tmpLegacy)
  writeText(path.join(tmpLegacy, '.scratch', 'map.md'), '# Demo 地图\n\n## Destination\n\n演示用。\n')
  const legacyPath = path.join(tmpLegacy, '.scratch', 'issues', '01-旧票.md')
  writeText(legacyPath, '# 旧票\n\n正文只有一句。\n\nStatus: needs-triage\n')
  const hBefore = readText(legacyPath)
  const hClaim = await setAssigneesIssue(ctxLegacy as never, repoOf() as never, '01', ['alice'] as never, {} as never)
  check(!(hClaim && hClaim.ok), 'H 旧扁平路径（.scratch/map.md + .scratch/issues/）写认领仍然要失败；实际返回：' + JSON.stringify(hClaim))
  check(readText(legacyPath) === hBefore, 'H 拒绝写时票文件一个字节都没变；实际：' + head(readText(legacyPath)))

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(tmpImpl, { recursive: true, force: true }) } catch { /* 同上 */ }
  try { fs.rmSync(tmpMap, { recursive: true, force: true }) } catch { /* 同上 */ }
  try { fs.rmSync(tmpLegacy, { recursive: true, force: true }) } catch { /* 同上 */ }
  console.log('\n共 ' + (passed + failedCount) + ' 条检查，PASS ' + passed + '，FAIL ' + failedCount)
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
