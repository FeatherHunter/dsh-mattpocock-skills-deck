// tests/verify-1489-original-fields.ts —— #1489：原文布局的文件形状判定与字段读写原语。
//
// 这张票的验收 ①②③ 都建立在同一件事上：原文规定「哪些信息放可见行、放文件的哪个位置」，
// 插件自己需要而原文没有的信息（认领人、标签、幂等键、创建时间、父子与阻塞边）放文件头的隐藏注释。
// 这个文件直接测那层原语：形状判定、隐藏注释的存在与空值区分、加粗字段行与裸字段行的原地替换/删除、
// 段落尾部追加。门禁只调这些纯函数，不碰磁盘。（#1500 S6 起进度区搬家函数已删，不再测它。）
import {
  ticketFormOf,
  hiddenCommentOf,
  upsertHiddenComment,
  boldFieldOf,
  replaceBoldField,
  bareFieldOf,
  replaceBareField,
  removeBareField,
  appendSectionBlock,
} from '../src/tracker/rooms/markdown/original-fields.ts'

let failed = false
function check(ok: unknown, msg: string): void {
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(a === e, msg + '（实际 ' + a + '，期望 ' + e + '）')
}
function has(text: string, needle: string, msg: string): void {
  check(text.indexOf(needle) >= 0, msg + '（期望包含 ' + JSON.stringify(needle) + '）')
}

// 一份插件按原文模板建出来的实施票：隐藏注释在文件头，可见字段是加粗行。
const IMPL = [
  '<!-- DSH-FORMAT: md-v1 -->',
  '<!-- DSH-PARENT: 00 -->',
  '<!-- DSH-LABELS: bug -->',
  '<!-- DSH-BLOCKED-BY: 02 -->',
  '<!-- DSH-CREATED: 2026-10-24T22:42:21.905Z -->',
  '# 01: 实施票一',
  '',
  '**What to build:** 做点事',
  '',
  '**Blocked by:** #02',
  '',
  '**Status:** ready-for-agent',
  '',
].join('\n')

// 一份手写的地图子票：没有隐藏注释，只有原文的裸字段行与 ## Question（issue-tracker-local.md:26-27）。
const MAP_TICKET = ['# 01: 手写子票', '', 'Type: research', '', 'Blocked by: 01', '', '## Question', '', '手写的问题是什么？', ''].join('\n')

// 一份旧布局票：可见的 Status/Assignees 行、## Comments 骨架，没有插件注释（旧行为全靠它，不能被本票带偏）。
const LEGACY = ['# 旧票', '', 'Status: ready-for-agent', 'Assignees: alice', '', '## Body', '', '正文', '', '## Comments', '', '### local — 2026-10-01T00:00:00.000Z', '', '旧评论', ''].join('\n')

console.log('形状判定：按文件内容认原文布局的两种票，认不出来就是旧布局')
eq(ticketFormOf(IMPL), 'impl-ticket', '插件建的实施票是加粗字段行那种（impl-ticket）')
eq(ticketFormOf(MAP_TICKET), 'map-ticket', '有 ## Question 与裸 Type 行的是地图子票（map-ticket）')
eq(ticketFormOf(LEGACY), 'legacy', '没有加粗字段也没有 ## Question 的旧票按旧布局处理（legacy）')
eq(ticketFormOf('# 01: 手写实施票\n\n**What to build:** 做点事\n\n**Status:** ready-for-agent\n'), 'impl-ticket', '没有插件注释但按 to-tickets 模板手写的实施票也认成 impl-ticket')

console.log('隐藏注释：必须区分「没有这一行」与「行在值为空」')
eq(hiddenCommentOf(IMPL, 'DSH-PARENT'), { found: true, value: '00' }, '有这一行就读出值')
eq(hiddenCommentOf(IMPL, 'DSH-STATUS'), { found: false, value: '' }, '没有这一行就是没有（不能与空值混为一谈）')
eq(hiddenCommentOf('<!-- DSH-ASSIGNEES:  -->\n# 01: 空名单\n', 'DSH-ASSIGNEES'), { found: true, value: '' }, '行在但值为空要认成「明确的空名单」')
eq(hiddenCommentOf('# 01: 无注释\n\n<!-- DSH-LABELS: bug -->\n', 'DSH-LABELS'), { found: false, value: '' }, '正文里的同款注释不算文件头注释')

console.log('隐藏注释：改值、补行、删行都只动文件头那一行')
{
  const after = upsertHiddenComment(IMPL, 'DSH-PARENT', '03')
  has(after, '<!-- DSH-PARENT: 03 -->', '已有注释整行替换'
  )
  eq((after.match(/DSH-PARENT/g) || []).length, 1, '替换不会留下第二行')
  has(after, '<!-- DSH-CREATED: 2026-10-24T22:42:21.905Z -->', '别的注释原样保留')
}
{
  // 没有 DSH-IDEMPOTENCY-KEY 行的文件：补的注释接在最后一条隐藏注释后面，仍然在第一个一级标题之前。
  const after = upsertHiddenComment(IMPL.replace('<!-- DSH-LABELS: bug -->\n', ''), 'DSH-LABELS', 'bug, needs-triage')
  const lines0 = after.split('\n')
  const labelIdx = lines0.findIndex(function (l) { return l.indexOf('DSH-LABELS: bug, needs-triage') >= 0 })
  const h1Idx = lines0.findIndex(function (l) { return l.indexOf('# 01:') === 0 })
  check(labelIdx >= 0 && labelIdx < h1Idx, '补进来的注释落在第一个一级标题之前（第 ' + labelIdx + ' 行，标题在第 ' + h1Idx + ' 行）')
  has(after, '<!-- DSH-CREATED: 2026-10-24T22:42:21.905Z -->', '补行不影响别的注释')
}
{
  const after = upsertHiddenComment(IMPL, 'DSH-STATUS', 'closed')
  const lines1 = after.split('\n')
  const statusIdx = lines1.findIndex(function (l) { return l.indexOf('DSH-STATUS: closed') >= 0 })
  const h1Idx = lines1.findIndex(function (l) { return l.indexOf('# 01:') === 0 })
  check(statusIdx >= 0 && statusIdx < h1Idx, '文件里一条注释都没有时也能补在第一行')
}
{
  const after = upsertHiddenComment(IMPL, 'DSH-LABELS', null)
  check(after.indexOf('DSH-LABELS') < 0, '值为 null 就把那一行删掉')
  check(after.indexOf('<!-- DSH-PARENT: 00 -->') >= 0 && after.indexOf('# 01: 实施票一') >= 0, '删一行不碰别的内容')
  eq(after.split('\n').length, IMPL.split('\n').length - 1, '删掉的就是一整行')
}

console.log('加粗字段行：原地换值，缺行才补，正文里的同款文字不算')
eq(boldFieldOf(IMPL, 'Status'), { found: true, value: 'ready-for-agent' }, '读得到 **Status:** 的值')
eq(boldFieldOf(IMPL, 'What to build'), { found: true, value: '做点事' }, '读得到 **What to build:** 的值')
{
  const after = replaceBoldField(IMPL, 'Status', 'resolved')
  has(after, '**Status:** resolved', '原地换成新值')
  check(after.indexOf('**Status:** ready-for-agent') < 0, '旧值不残留')
  check(after.indexOf('<!-- DSH-BLOCKED-BY: 02 -->') >= 0, '隐藏注释不动')
  check(after.indexOf('**Blocked by:** #02') >= 0, '别的加粗字段不动作')
  check(after.indexOf('Close reason') < 0, '实施票的状态改写不新增 Close reason 行')
}
{
  const after = replaceBoldField(IMPL, 'Blocked by', '#03, #04')
  has(after, '**Blocked by:** #03, #04', '**Blocked by:** 原地换成新值')
}
{
  // 加粗字段缺行时才补：补在已有加粗字段块的末尾，不插进标题与正文之间。
  const noStatus = '# 01: 缺状态的票\n\n**What to build:** 做点事\n\n**Blocked by:** None (can start immediately)\n'
  const after = replaceBoldField(noStatus, 'Status', 'ready-for-agent')
  has(after, '**Status:** ready-for-agent', '缺行时补一行')
  check(after.indexOf('**What to build:**') < after.indexOf('**Status:**'), '补的行在加粗字段块里，不在它前面')
}
{
  const body = '# 01: x\n\n**Status:** ready-for-agent\n\n## Comments\n\n### local — t\n\n**Status:** 这是评论正文，不是字段\n'
  eq(boldFieldOf(body, 'Status'), { found: true, value: 'ready-for-agent' }, '只认第一个二级标题之前的字段行')
}

console.log('裸字段行：地图子票的 Type/Status/Blocked by 原地换，空名单时删行')
eq(bareFieldOf(MAP_TICKET, 'Type'), { found: true, value: 'research' }, '读得到裸 Type 行')
eq(bareFieldOf(MAP_TICKET, 'Status'), { found: false, value: '' }, '没有 Status 行')
{
  const after = replaceBareField(MAP_TICKET, 'Status', 'claimed')
  has(after, 'Status: claimed', '缺行时补一行 Status: claimed')
  has(after, '## Question', '## Question 段原样保留')
  eq((after.match(/^Status:/gm) || []).length, 1, '只写一行 Status')
}
{
  const after = replaceBareField(MAP_TICKET, 'Blocked by', '01')
  has(after, 'Blocked by: 01', '**Blocked by:** 换值')
  eq((after.match(/^Blocked by:/gm) || []).length, 1, '只写一行 Blocked by')
}
{
  const after = removeBareField('# 01: x\n\nType: research\n\nStatus: claimed\n\n## Question\n\n问题\n', 'Status')
  check(after.indexOf('Status: claimed') < 0, '删掉了 Status 行')
  has(after, 'Type: research', '别的裸字段还在')
  eq(after.indexOf('\n\n\n'), -1, '删行后不留连续两个空行')
}

console.log('段落尾部追加：原文说评论追加文件底部；没有段就新建，新建时让在进度区前面')
{
  const withComments = '# 01: x\n\n**Status:** ready-for-agent\n\n## Comments\n\n### local — t1\n\n第一条反馈\n'
  const after = appendSectionBlock(withComments, 'Comments', '### local — t2\n\n第二条反馈')
  has(after, '第一条反馈\n\n### local — t2', '新块接在同一段落已有内容的后面')
  check(after.indexOf('### local — t2') > after.indexOf('### local — t1'), '新评论在旧评论后面，不在前面')
}
{
  const noSection = '# 01: x\n\n**Status:** ready-for-agent\n'
  const after = appendSectionBlock(noSection, 'Answer', '答案正文')
  has(after, '## Answer\n\n答案正文', '没有段时在文末新建')
  eq(after.indexOf('## Answer') > after.indexOf('**Status:**'), true, '新建的段落在字段行之后')
}
{
  const withProgressLast = '# 01: x\n\n**Status:** ready-for-agent\n\n## 进度\n\n- 进度：10%（2026-10-25T00:00+08:00）：刚开工\n'
  const after = appendSectionBlock(withProgressLast, 'Comments', '### local — t\n\n反馈')
  const cIdx = after.indexOf('## Comments')
  const pIdx = after.indexOf('## 进度')
  check(cIdx >= 0 && pIdx >= 0 && cIdx < pIdx, '进度区在末尾时，新建的 Comments 段插在它前面（顺序稳定）')
  has(after, '- 进度：10%（2026-10-25T00:00+08:00）：刚开工', '进度内容原样保留')
}

// #1500 S6：relocateProgressToEnd 死代码已删，对应的搬家用例一并删除（appendSectionBlock 的进度区行为仍由上面的用例覆盖）。

if (failed) {
  console.log('\nFAILED')
  process.exitCode = 1
} else {
  console.log('\nALL PASS')
}
