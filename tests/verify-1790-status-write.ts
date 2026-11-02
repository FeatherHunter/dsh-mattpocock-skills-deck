// tests/verify-1790-status-write.ts —— #1790 缺陷 A 写侧判据：可见 Status 行是 triage 状态的唯一真源。
//
// 这一扇守五件事：
//   ① 建票：四种票型各自的默认状态（实施票 ready-for-agent、缺陷票 needs-triage、地图子票 claimed、
//      普通票没有状态行）；隐藏 DSH-LABELS 只留非 triage 标签，triage 绝不双写。
//   ② 改标签：标签里的 triage 并成可见 Status 行；多枚 triage 整次拒绝；非 triage 只进隐藏名单；
//      文件本来有可见 Labels 行时同步它。
//   ③ 关票：状态落 resolved；原本是 wontfix 的票保留 wontfix；关闭原因进 ## Comments。
//   ④ 重开：按票型回到默认（实施票 ready-for-agent、缺陷票 needs-triage、地图子票 claimed），
//      普通票重开后删除可见 Status 行（普通票可以没有状态）。
//   ⑤ 旧文件第一次被写时归一：可见旧默认值让位给隐藏 triage，落选值记进 DSH-STATUS-HISTORY，且幂等。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1790-status-write.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue, closeIssue, reopenIssue, getIssue, setLabelsIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { normalizeIssueStatusText, statusReadOfText } from '../src/tracker/rooms/markdown/status-write.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}

/** 最小平台文件层：与 markdown 后端现有门禁用同一套形状。 */
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
    events: [] as unknown[],
    logEvent() {},
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
async function labels(ctx: unknown, repo: Record<string, unknown>, key: string, names: string[], opts?: Record<string, unknown>) {
  return await setLabelsIssue(ctx as never, repo as never, key, names as never, opts as never)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}
function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}
/** 某目录 issues/ 下指定编号的票文件；找不到回空串。 */
function issueFile(root: string, effortId: string, key: string): string {
  const dir = path.join(root, '.scratch', effortId, 'issues')
  let entries: string[] = []
  try { entries = fs.readdirSync(dir) } catch { return '' }
  const hit = entries.filter((one) => one.indexOf(key + '-') === 0)[0]
  return hit ? path.join(dir, hit) : ''
}
/** 可见状态行（加粗或裸行）的值；没有回空串。加粗行的冒号在星号里面（**Status:** 值），行尾还可能再收一对星号。 */
function statusValue(text: string): string {
  const m = /^[ \t]*(?:\*\*)?Status(?:\*\*)?[ \t]*[:：][ \t]*(?:\*\*)?[ \t]*(\S.*?)[ \t]*$/m.exec(text)
  return m ? m[1].replace(/\*\*[ \t]*$/, '').trim() : ''
}
/** 文件头隐藏 DSH-LABELS 的值（没这一行回空串）。 */
function hiddenLabels(text: string): string {
  const m = /<!--\s*DSH-LABELS:\s*([^>]*?)\s*-->/.exec(text)
  return m ? m[1] : ''
}
/** 文件里 DSH-STATUS-HISTORY 的行。 */
function historyLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.indexOf('<!-- DSH-STATUS-HISTORY:') === 0)
}
/** 第一段二级标题下的正文（不含标题本身，到下一个二级标题为止）。 */
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

async function main(): Promise<void> {
  // ══ 一、建票：四种票型的默认状态与隐藏标签过滤 ══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1790-status-write-'))
  const ctx = mkctx(tmp)
  const feature = '状态写侧演示'
  const featureRepo = repoOf(feature, 'feature')
  const demoRepo = repoOf('demo')
  const spec = await create(ctx, repoOf(), { title: feature, body: '## Problem Statement\n\n状态写侧演示。', type: 'spec', idempotencyKey: 'spec-1790-status-write' })
  check(!!(spec && spec.ok), '前置：规格建得成：' + (spec && spec.ok ? '' : JSON.stringify(spec)))

  const impl = await create(ctx, featureRepo, {
    title: '实施票默认状态',
    body: '**What to build:** 能看到默认状态。',
    type: 'issue',
    parentKey: '00',
    labels: ['ready-for-agent', 'front-end'],
    idempotencyKey: 'impl-1790-status-write',
  })
  check(!!(impl && impl.ok), '前置：实施票建得成：' + (impl && impl.ok ? '' : JSON.stringify(impl)))
  const implPath = issueFile(tmp, feature, '01')
  const implText = readText(implPath)
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(implText), '① 实施票默认写加粗状态行 ready-for-agent')
  check(hiddenLabels(implText) === 'front-end', '① 隐藏 DSH-LABELS 只留非 triage（ready-for-agent 没有双写）：' + JSON.stringify(hiddenLabels(implText)))

  const bug = await create(ctx, demoRepo, {
    title: '缺陷票默认状态',
    body: '## 缺陷说明\n\n默认状态应为 needs-triage。',
    type: 'bug',
    labels: ['bug', 'front-end'],
    idempotencyKey: 'bug-1790-status-write',
  })
  check(!!(bug && bug.ok), '前置：缺陷票建得成：' + (bug && bug.ok ? '' : JSON.stringify(bug)))
  const bugPath = issueFile(tmp, 'demo', '01')
  const bugText = readText(bugPath)
  check(/^\*\*Status:\*\* needs-triage$/m.test(bugText), '① 缺陷票默认写 needs-triage')
  check(hiddenLabels(bugText) === 'bug, front-end', '① 缺陷票的 DSH-LABELS 只留非 triage（needs-triage 不进隐藏名单）：' + JSON.stringify(hiddenLabels(bugText)))

  const plain = await create(ctx, demoRepo, {
    title: '普通票没有状态',
    body: '**What to build:** 普通票可以没有状态。',
    type: 'issue',
    labels: ['front-end'],
    idempotencyKey: 'plain-1790-status-write',
  })
  check(!!(plain && plain.ok), '前置：普通票建得成：' + (plain && plain.ok ? '' : JSON.stringify(plain)))
  const plainPath = issueFile(tmp, 'demo', '02')
  const plainText = readText(plainPath)
  check(statusValue(plainText) === '', '① 普通票建票不写可见 Status 行（没有默认状态）')
  check(hiddenLabels(plainText) === 'front-end', '① 普通票的 DSH-LABELS 正常写非 triage 标签')

  const effort = '状态写侧地图'
  const effortRepo = repoOf(effort, 'effort')
  const map = await create(ctx, effortRepo, { title: effort, body: '## Destination\n\n状态写侧地图。', type: 'map', labels: ['wayfinder:map'], idempotencyKey: 'map-1790-status-write' })
  check(!!(map && map.ok), '前置：地图建得成：' + (map && map.ok ? '' : JSON.stringify(map)))
  const child = await create(ctx, effortRepo, {
    title: '子票默认状态？',
    body: '子票默认应当已认领。',
    type: 'issue',
    typeLine: 'task',
    parentKey: '00',
    labels: ['wayfinder:task'],
    idempotencyKey: 'child-1790-status-write',
  })
  check(!!(child && child.ok), '前置：地图子票建得成：' + (child && child.ok ? '' : JSON.stringify(child)))
  const childPath = issueFile(tmp, effort, '01')
  const childText = readText(childPath)
  check(/^Status: claimed$/m.test(childText), '① 地图子票默认写裸行 Status: claimed（与认领人无关）')
  check(hiddenLabels(childText) === 'wayfinder:task', '① 地图子票的 DSH-LABELS 只留 wayfinder:task')

  // ══ 二、改标签：triage 并成可见 Status 行 ══
  const oneTriage = await labels(ctx, demoRepo, '02', ['ready-for-agent'])
  check(!!(oneTriage && oneTriage.ok), '② 普通票贴一枚 triage 标签成功：' + (oneTriage && oneTriage.ok ? '' : JSON.stringify(oneTriage)))
  const afterOne = readText(plainPath)
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(afterOne), '② 标签里的 triage 落成可见 Status 行')
  check(hiddenLabels(afterOne) === '', '② triage 不再写进隐藏 DSH-LABELS')
  const plainRead = await getIssue(ctx as never, demoRepo as never, '02', {} as never)
  check(!!(plainRead && plainRead.ok && plainRead.data.status === 'ready-for-agent'), '② 读回状态 ready-for-agent')

  const multi = await labels(ctx, demoRepo, '02', ['needs-triage', 'ready-for-human'])
  check(!!(multi && !multi.ok && multi.error.kind === 'parse'), '② 多枚 triage 整次拒绝（kind=parse）：' + JSON.stringify(multi && !multi.ok ? multi.error.kind : multi))
  check(readText(plainPath) === afterOne, '② 被拒绝的写入一个字节都不动')

  const nonTriage = await labels(ctx, demoRepo, '02', ['front-end', 'back-end'])
  check(!!(nonTriage && nonTriage.ok), '② 只贴非 triage 标签成功：' + (nonTriage && nonTriage.ok ? '' : JSON.stringify(nonTriage)))
  const afterNon = readText(plainPath)
  check(hiddenLabels(afterNon) === 'front-end, back-end', '② 非 triage 只进隐藏名单：' + JSON.stringify(hiddenLabels(afterNon)))
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(afterNon), '② 没有 triage 时保留当前有效状态')

  // 手写票有可见 Labels 行：改标签时同步可见行，triage 仍只进状态行。
  const handPath = path.join(tmp, '.scratch', 'demo', 'issues', '09-手写标签票.md')
  writeText(handPath, '# 09: 手写标签票\n\nLabels: old-label\n\n正文\n')
  const synced = await labels(ctx, demoRepo, '09', ['front-end', 'ready-for-agent'])
  check(!!(synced && synced.ok), '② 手写票改标签成功：' + (synced && synced.ok ? '' : JSON.stringify(synced)))
  const handText = readText(handPath)
  check(/^Labels: front-end$/m.test(handText), '② 可见 Labels 行同步成非 triage 名单：' + JSON.stringify(handText.split('\n').filter((l) => /Labels/.test(l))))
  check(/^Status: ready-for-agent$/m.test(handText), '② 手写票的 triage 落成可见裸行 Status')

  // ══ 三、关票：resolved / wontfix 保留 / 原因进 ## Comments ══
  const bugClosed = await closeIssue(ctx as never, demoRepo as never, '01', { reason: '缺陷修完了' } as never)
  check(!!(bugClosed && bugClosed.ok), '③ 关缺陷票返回 ok：' + (bugClosed && bugClosed.ok ? '' : JSON.stringify(bugClosed)))
  const bugAfterClose = readText(bugPath)
  check(/^\*\*Status:\*\* resolved$/m.test(bugAfterClose), '③ 缺陷票关闭写 resolved')
  check(sectionBody(bugAfterClose, 'Comments').indexOf('缺陷修完了') >= 0, '③ 关闭原因进 ## Comments')

  const wont = await labels(ctx, featureRepo, '01', ['wontfix'])
  check(!!(wont && wont.ok), '前置：实施票状态改 wontfix：' + (wont && wont.ok ? '' : JSON.stringify(wont)))
  const implClosed = await closeIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(implClosed && implClosed.ok), '③ 关 wontfix 的实施票返回 ok')
  check(/^\*\*Status:\*\* wontfix$/m.test(readText(implPath)), '③ 关票不把 wontfix 覆盖成 resolved')
  const implRead = await getIssue(ctx as never, featureRepo as never, '01', {} as never)
  check(!!(implRead && implRead.ok && implRead.data.state === 'closed'), '③ wontfix 读回 state=closed')

  // ══ 四、重开：按票型回到默认 ══
  const implReopen = await reopenIssue(ctx as never, featureRepo as never, '01')
  check(!!(implReopen && implReopen.ok), '④ 重开实施票返回 ok')
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(readText(implPath)), '④ 实施票重开回 ready-for-agent')
  const bugReopen = await reopenIssue(ctx as never, demoRepo as never, '01')
  check(!!(bugReopen && bugReopen.ok), '④ 重开缺陷票返回 ok')
  const bugAfterReopen = readText(bugPath)
  check(/^\*\*Status:\*\* needs-triage$/m.test(bugAfterReopen), '④ 缺陷票重开回 needs-triage')
  check(historyLines(bugAfterReopen).length === 0, '④ 普通关闭/重开不写 DSH-STATUS-HISTORY（不是归一）')

  const plainClosed = await closeIssue(ctx as never, demoRepo as never, '02', {} as never)
  check(!!(plainClosed && plainClosed.ok), '④ 关普通票返回 ok')
  check(/^\*\*Status:\*\* resolved$/m.test(readText(plainPath)), '④ 普通票关闭写 resolved')
  const plainReopen = await reopenIssue(ctx as never, demoRepo as never, '02')
  check(!!(plainReopen && plainReopen.ok), '④ 重开普通票返回 ok')
  const plainAfterReopen = readText(plainPath)
  check(statusValue(plainAfterReopen) === '', '④ 普通票重开删除可见 Status 行（普通票可以没有状态）')
  const plainReopenRead = await getIssue(ctx as never, demoRepo as never, '02', {} as never)
  check(!!(plainReopenRead && plainReopenRead.ok && plainReopenRead.data.state === 'open'), '④ 普通票重开后读回 open')

  const childClosed = await closeIssue(ctx as never, effortRepo as never, '01', {} as never)
  check(!!(childClosed && childClosed.ok), '④ 关地图子票返回 ok')
  check(/^Status: resolved$/m.test(readText(childPath)), '④ 地图子票关闭写 resolved')
  const childReopen = await reopenIssue(ctx as never, effortRepo as never, '01')
  check(!!(childReopen && childReopen.ok), '④ 重开地图子票返回 ok')
  check(/^Status: claimed$/m.test(readText(childPath)), '④ 地图子票重开回 claimed')

  // ══ 五、旧文件第一次写：归一 + DSH-STATUS-HISTORY ══
  const legacyPath = path.join(tmp, '.scratch', feature, 'issues', '08-旧文件票.md')
  writeText(legacyPath, [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-LABELS: needs-triage -->',
    '# 08: 旧文件票',
    '',
    '**What to build:** 旧文件归一。',
    '',
    '**Status:** ready-for-agent',
    '',
  ].join('\n'))
  const legacyBefore = readText(legacyPath)
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(legacyBefore) && hiddenLabels(legacyBefore) === 'needs-triage', '前置：旧文件是「可见旧默认值 + 隐藏 triage」形态')
  const legacyRead = await getIssue(ctx as never, featureRepo as never, '08', {} as never)
  check(!!(legacyRead && legacyRead.ok && legacyRead.data.status === 'needs-triage'), '前置：读侧按隐藏 triage 读出 needs-triage')
  check(!!(legacyRead && legacyRead.ok && legacyRead.data.statusVisible === 'ready-for-agent'), '前置：可见旧默认值留在 statusVisible')

  const normalized = await labels(ctx, featureRepo, '08', ['front-end'])
  check(!!(normalized && normalized.ok), '⑤ 旧文件第一次写成功：' + (normalized && normalized.ok ? '' : JSON.stringify(normalized)))
  const legacyAfter = readText(legacyPath)
  check(/^\*\*Status:\*\* needs-triage$/m.test(legacyAfter), '⑤ 可见 Status 行归一成读侧的有效状态')
  check(hiddenLabels(legacyAfter) === 'front-end', '⑤ 隐藏 DSH-LABELS 只留非 triage')
  const history = historyLines(legacyAfter)
  check(history.length === 1, '⑤ 落选值记一行 DSH-STATUS-HISTORY：' + JSON.stringify(history))
  check(history[0].indexOf('source=visible') >= 0 && history[0].indexOf('discarded=ready-for-agent') >= 0 && history[0].indexOf('adopted=needs-triage') >= 0, '⑤ 历史行写清来源、落选值、采用值：' + JSON.stringify(history[0]))
  const again = await labels(ctx, featureRepo, '08', ['front-end'])
  check(!!(again && again.ok), '⑤ 同一份归一重复写成功')
  check(historyLines(readText(legacyPath)).length === 1, '⑤ 重复写不重复追加历史行（幂等）')

  // 真冲突且没有显式状态：整次不写，由调用方先选一个值（deck 层会给 retry）。
  const conflictPath = path.join(tmp, '.scratch', feature, 'issues', '07-冲突票.md')
  writeText(conflictPath, [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-LABELS: ready-for-agent -->',
    '# 07: 冲突票',
    '',
    '**What to build:** 可见与隐藏冲突。',
    '',
    '**Status:** wontfix',
    '',
  ].join('\n'))
  const conflictBefore = readText(conflictPath)
  const refused = await labels(ctx, featureRepo, '07', [])
  check(!!(refused && !refused.ok && refused.error.kind === 'parse'), '⑤ 真冲突且无显式状态：整次拒绝（kind=parse）：' + JSON.stringify(refused && !refused.ok ? refused.error.kind : refused))
  check(readText(conflictPath) === conflictBefore, '⑤ 冲突被拒后文件一个字节都不动')
  // 冲突的解除方式是「先显式选一个状态」：写侧收 opts.status（deck 层把 resolveStatus 翻成这个值）。
  const resolvedConflict = await labels(ctx, featureRepo, '07', ['front-end'], { status: 'wontfix' })
  check(!!(resolvedConflict && resolvedConflict.ok), '⑤ 带显式状态重试可成功：' + (resolvedConflict && resolvedConflict.ok ? '' : JSON.stringify(resolvedConflict)))
  const conflictAfter = readText(conflictPath)
  check(/^\*\*Status:\*\* wontfix$/m.test(conflictAfter), '⑤ 显式选的状态落成可见 Status 行')
  check(hiddenLabels(conflictAfter) === 'front-end', '⑤ 冲突后隐藏名单只留非 triage')
  check(historyLines(conflictAfter).length === 1 && historyLines(conflictAfter)[0].indexOf('discarded=ready-for-agent') >= 0, '⑤ 冲突解决后落选值记进历史：' + JSON.stringify(historyLines(conflictAfter)))

  // ══ 六、§七.9 写侧矩阵：4 票型 × 10 可见值 × 9 隐藏集合，归一幂等 ══
  // 读侧矩阵住在 verify-1790-status-read（直接打 parseMd）；这一扇打写侧归一这一对纯函数：
  // 不论起点是旧默认值、真冲突、非法可见值、多枚隐藏 triage 还是地图子票的隐藏 triage，
  // 归一都必须把文件落成同一套规则（可见行是唯一真源、隐藏只留非 triage、落选值记历史），
  // 而且连着归一两次的结果逐字相同（幂等）。任何一格没有定义、两次结果不同都算红。
  const M_TRIAGE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']
  const M_COMPLETED = ['resolved', 'completed', 'closed', 'done']
  const M_VISIBLE = ['', ...M_TRIAGE, ...M_COMPLETED]
  // 九种隐藏集合：空、五枚 triage 各一枚、两枚 triage、非 triage 名称、非 triage + 多枚 triage。
  // 'bug' 会改变票型判定（隐藏 bug 标签把 spec 路线读成缺陷票），所以对缺陷票那一组单独补上它，
  // 其余三组用 'front-end' 占住「非 triage 名称」这一格，保证每种票型的九格都是同一票型。
  const M_HIDDEN = [[], ['needs-triage'], ['needs-info'], ['ready-for-agent'], ['ready-for-human'], ['wontfix'], ['needs-info', 'wontfix'], ['front-end'], ['needs-info', 'front-end']]
  const M_KINDS: Array<{ kind: string; route: 'spec' | 'plain' | 'map' }> = [
    { kind: 'spec-ticket', route: 'spec' },
    { kind: 'bug', route: 'spec' },
    { kind: 'plain-issue', route: 'plain' },
    { kind: 'map-ticket', route: 'map' },
  ]
  const matrixProblems: string[] = []
  let matrixCases = 0
  const mtext = (visible: string, hidden: string[]): string => {
    const head = hidden.length ? '<!-- DSH-LABELS: ' + hidden.join(', ') + ' -->\n' : ''
    const statusLine = visible ? '**Status:** ' + visible + '\n' : ''
    return head + '# 矩阵票\n\n' + statusLine + 'Body.\n'
  }
  for (const one of M_KINDS) {
    for (const visible of M_VISIBLE) {
      for (const base of M_HIDDEN) {
        const hidden = one.kind === 'bug' ? ['bug', ...base] : base
        const caseName = one.kind + ' / visible=' + (visible || '(none)') + ' / hidden=' + hidden.join(',')
        matrixCases += 1
        const read1 = statusReadOfText(mtext(visible, hidden), one.route)
        if (read1.kind !== one.kind) { matrixProblems.push(caseName + ' :: 票型读成 ' + read1.kind); continue }
        // 归一的显式状态取读侧答案（冲突时读侧按可见行回答，正好是默认规则 visible 的答案）；
        // 普通票没有状态时明确要求删掉状态行。
        const choice = read1.status !== undefined ? { status: read1.status } : { dropStatus: true, labels: [] as string[] }
        const once = normalizeIssueStatusText(mtext(visible, hidden), one.route, choice)
        if (!once.ok) { matrixProblems.push(caseName + ' :: 归一失败 ' + JSON.stringify(once.error)); continue }
        const afterText = once.data.text
        const read2 = statusReadOfText(afterText, one.route)
        if (read2.status !== read1.status) matrixProblems.push(caseName + ' :: 归一后状态变了 ' + JSON.stringify({ was: read1.status, now: read2.status }))
        if (read2.statusConflict !== undefined) matrixProblems.push(caseName + ' :: 归一后仍报冲突 ' + JSON.stringify(read2.statusConflict))
        const hidden2 = hiddenLabels(afterText).split(',').map((x) => x.trim()).filter(Boolean)
        const triageLeft = hidden2.filter((x) => M_TRIAGE.indexOf(x) >= 0)
        if (triageLeft.length) matrixProblems.push(caseName + ' :: 隐藏名单里还留着 triage ' + JSON.stringify(triageLeft))
        if (one.kind !== 'map-ticket' && read1.status !== undefined && statusValue(afterText) !== read1.status) matrixProblems.push(caseName + ' :: 可见状态行没落成 ' + JSON.stringify({ want: read1.status, got: statusValue(afterText) }))
        const twice = normalizeIssueStatusText(afterText, one.route, choice)
        if (!twice.ok) { matrixProblems.push(caseName + ' :: 第二次归一失败 ' + JSON.stringify(twice.error)); continue }
        if (twice.data.text !== afterText) matrixProblems.push(caseName + ' :: 两次归一结果不一致（幂等被破坏）')
      }
    }
  }
  check(matrixCases === 360, '⑥ 写侧矩阵覆盖 4 票型 × 10 可见值 × 9 隐藏集合：' + matrixCases + ' 格')
  check(matrixProblems.length === 0, '⑥ 写侧矩阵每一格都有定义、归一幂等、归一后无冲突且隐藏名单不含 triage：' + (matrixProblems.length ? JSON.stringify(matrixProblems.slice(0, 6)) : '360 格全过'))

  // ══ 七、wayfinder 子票：隐藏 triage 在首次写入时移除并记历史；重开不重复记 ══
  const mapLegacyPath = path.join(tmp, '.scratch', effort, 'issues', '05-地图旧子票.md')
  writeText(mapLegacyPath, [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-LABELS: needs-triage -->',
    '# 05: 地图旧子票',
    '',
    'Status: claimed',
    '',
    '正文',
    '',
  ].join('\n'))
  const mapLegacyBefore = readText(mapLegacyPath)
  const mapLegacyClosed = await closeIssue(ctx as never, effortRepo as never, '05', {} as never)
  check(!!(mapLegacyClosed && mapLegacyClosed.ok), '⑦ 带隐藏 triage 的地图子票关得成：' + (mapLegacyClosed && mapLegacyClosed.ok ? '' : JSON.stringify(mapLegacyClosed)))
  const mapLegacyAfter = readText(mapLegacyPath)
  check(/^Status: resolved$/m.test(mapLegacyAfter), '⑦ 关闭把可见状态行写成 resolved')
  check(hiddenLabels(mapLegacyAfter).indexOf('needs-triage') < 0, '⑦ 隐藏 DSH-LABELS 里的 triage 被移除：' + JSON.stringify(hiddenLabels(mapLegacyAfter)))
  const mapHistory = historyLines(mapLegacyAfter)
  check(mapHistory.length === 1 && mapHistory[0].indexOf('source=hidden') >= 0 && mapHistory[0].indexOf('discarded=needs-triage') >= 0 && mapHistory[0].indexOf('adopted=resolved') >= 0, '⑦ 隐藏 triage 的去向记进 DSH-STATUS-HISTORY：' + JSON.stringify(mapHistory))
  const mapLegacyReopen = await reopenIssue(ctx as never, effortRepo as never, '05')
  check(!!(mapLegacyReopen && mapLegacyReopen.ok), '⑦ 重开这张地图子票返回 ok')
  const mapReopenedText = readText(mapLegacyPath)
  check(/^Status: claimed$/m.test(mapReopenedText), '⑦ 重开把可见状态行写回 claimed')
  check(historyLines(mapReopenedText).length === 1, '⑦ 重开不再加历史行（同一段已经记过）：' + JSON.stringify(historyLines(mapReopenedText)))

  // ══ 八、重开遇真冲突同样拒绝：没有显式状态入口时不许替调用方挑一侧 ══
  const reopenConflictPath = path.join(tmp, '.scratch', feature, 'issues', '06-重开冲突票.md')
  writeText(reopenConflictPath, [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-LABELS: ready-for-agent -->',
    '# 06: 重开冲突票',
    '',
    '**What to build:** 重开遇冲突。',
    '',
    '**Status:** wontfix',
    '',
  ].join('\n'))
  const reopenConflictBefore = readText(reopenConflictPath)
  const reopenConflict = await reopenIssue(ctx as never, featureRepo as never, '06')
  check(!!(reopenConflict && !reopenConflict.ok && reopenConflict.error.kind === 'parse'), '⑧ 重开遇真冲突整次拒绝（kind=parse）：' + JSON.stringify(reopenConflict && !reopenConflict.ok ? reopenConflict.error.kind : reopenConflict))
  let reopenRaw: Record<string, unknown> = {}
  try { reopenRaw = JSON.parse(String((reopenConflict && !reopenConflict.ok ? reopenConflict.error.raw : '') || '{}')) } catch (e) { reopenRaw = {} }
  check(reopenRaw.field === 'status' && reopenRaw.visible === 'wontfix' && Array.isArray(reopenRaw.hidden) && reopenRaw.hidden[0] === 'ready-for-agent' && String(reopenRaw.hiddenSource) === 'DSH-LABELS' && !!(reopenRaw.resolution && (reopenRaw.resolution as Record<string, unknown>).default === 'visible'), '⑧ 拒绝回执的 raw 是读侧那一份冲突 JSON（调用方可据此先归一）：' + JSON.stringify(reopenRaw))
  check(readText(reopenConflictPath) === reopenConflictBefore, '⑧ 被拒绝的重开一个字节都不动')
  check(mapLegacyBefore.indexOf('DSH-LABELS: needs-triage') >= 0, '⑧ 前置：地图旧子票起点确实是隐藏 triage 形态')

  ws_cleanup(tmp)
  console.log(failed ? '存在失败' : '全部通过')
  process.exit(failed ? 1 : 0)
}

function ws_cleanup(tmp: string): void {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

main().catch(function(e) { console.error(String((e && e.stack) || e)); process.exit(1) })
