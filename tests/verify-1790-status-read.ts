/**
 * verify-1790-status-read.ts — 本地 Markdown 后端读侧的 triage 状态矩阵（#1790 P1）。
 *
 * 这一扇门禁直接打 parseMd 这个公共读入口：给一份票文件文本 + 调用方已知的目录路线，
 * 断言读出来的 status / state / labels / statusVisible / statusSource / statusConflict。
 * 期望值按 research/1790-implementation-plan-2026-11-02.md §1.4–§1.6 的冻结规则手写，
 * 不复用生产函数算期望（否则实现写错时测试会跟着错）。
 */
import assert from 'node:assert/strict'
import { parseMd } from '../src/tracker/rooms/markdown/parse.ts'

const TRIAGE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']
const COMPLETED = ['resolved', 'completed', 'closed', 'done']
const LEGACY_DEFAULT = 'ready-for-agent'

// 四种票型：路线与显式 fileKind 由读路径（issues-locate / issues-create）提供。
// 矩阵用显式 fileKind 锁定票型（建票读回时调用方本来就带着它），否则隐藏的 bug 标签会按
// plan §1.3 的判定顺序把路线改成缺陷票，矩阵就不再是「同一票型的 10×9 格」了。
const KINDS = [
  { kind: 'spec-ticket', meta: { route: 'spec', parentKey: '00', fileKind: 'spec-ticket' } },
  { kind: 'bug', meta: { route: 'spec', parentKey: '00', fileKind: 'bug' } },
  { kind: 'plain-issue', meta: { route: 'plain', parentKey: null, fileKind: 'plain-issue' } },
  { kind: 'map-ticket', meta: { route: 'map', parentKey: '00', fileKind: 'map-ticket' } },
]

// 矩阵两轴：10 种可见值（缺省 + 5 triage + 4 完成值）× 9 种隐藏标签集合。
const VISIBLE_VALUES = ['', ...TRIAGE, ...COMPLETED]
const HIDDEN_SETS = [
  [],
  ['needs-triage'],
  ['needs-info'],
  ['ready-for-agent'],
  ['ready-for-human'],
  ['wontfix'],
  ['needs-info', 'wontfix'],
  ['bug'],
  ['needs-info', 'bug'],
]

function headerOf(hiddenNames) {
  return hiddenNames.length ? '<!-- DSH-LABELS: ' + hiddenNames.join(', ') + ' -->\n' : ''
}
function textOf(visible, hiddenNames) {
  const statusLine = visible ? 'Status: ' + visible + '\n' : ''
  return headerOf(hiddenNames) + '# Ticket\n\n' + statusLine + 'Labels: docs\n\nBody.\n'
}
function metaOf(one, key) {
  return Object.assign({ key: key || '01', isMap: false }, one.meta)
}

function stateOf(status) {
  if (!status) return 'open'
  return status === 'wontfix' || COMPLETED.indexOf(status) >= 0 ? 'closed' : 'open'
}
function nonTriageOf(hiddenNames) {
  const out = ['docs']
  for (const name of hiddenNames) {
    if (TRIAGE.indexOf(name) >= 0) continue
    if (out.indexOf(name) < 0) out.push(name)
  }
  return out
}
function syntheticTriage(labels, status) {
  if (!status || TRIAGE.indexOf(status) < 0) return labels
  return labels.indexOf(status) >= 0 ? labels : labels.concat([status])
}

// 普通三类的读侧规则（plan §1.5–§1.6），字面量实现，供矩阵算期望。
function expectedOrdinary(kind, visible, hiddenNames) {
  const V = visible || null
  const legal = V !== null && (TRIAGE.indexOf(V) >= 0 || COMPLETED.indexOf(V) >= 0)
  const H = hiddenNames.filter((name) => TRIAGE.indexOf(name) >= 0)
  let status = undefined
  let source = undefined
  if (legal && V !== LEGACY_DEFAULT) {
    status = V
    source = 'visible'
  } else if (H.length === 1) {
    status = H[0]
    source = 'hidden'
  } else if (legal) {
    status = V
    source = 'visible'
  } else {
    status = kind === 'spec-ticket' ? 'ready-for-agent' : kind === 'bug' ? 'needs-triage' : undefined
    source = status === undefined ? undefined : 'default'
  }
  const out = { status, source, state: stateOf(status), statusVisible: undefined, conflict: undefined }
  if (V !== null && V !== status) out.statusVisible = V
  if (legal && V !== LEGACY_DEFAULT && H.length === 1 && V !== H[0]) {
    out.conflict = {
      field: 'status',
      visible: V,
      hidden: [H[0]],
      hiddenSource: 'DSH-LABELS',
      stateFromVisible: stateOf(V),
      stateFromHidden: stateOf(H[0]),
      resolution: {
        default: 'visible',
        rule: 'visible-status-wins',
        action: 'write-visible-status-on-next-write',
        history: 'DSH-STATUS-HISTORY',
      },
    }
  }
  out.labels = syntheticTriage(nonTriageOf(hiddenNames), status)
  return out
}

// 地图子票：只认 claimed / resolved，隐藏 triage 忽略、不合成。
function expectedMapTicket(visible, hiddenNames) {
  const V = visible || null
  const legal = V === 'claimed' || V === 'resolved'
  const status = legal ? V : 'claimed'
  const out = {
    status,
    source: legal ? 'visible' : 'default',
    state: stateOf(status),
    statusVisible: V !== null && V !== status ? V : undefined,
    conflict: undefined,
    labels: nonTriageOf(hiddenNames),
  }
  return out
}

const failures = []
let checks = 0
function eq(actual, expected, label) {
  checks += 1
  try {
    assert.deepStrictEqual(actual, expected)
  } catch (err) {
    failures.push(label + ' :: ' + String(err && err.message ? err.message : err))
  }
}
function present(issue, field, want, label) {
  eq(Object.prototype.hasOwnProperty.call(issue, field), want, label + ' hasOwnProperty(' + field + ')')
}

for (const one of KINDS) {
  for (const visible of VISIBLE_VALUES) {
    for (const hiddenNames of HIDDEN_SETS) {
      const caseName = one.kind + ' / visible=' + (visible || '(none)') + ' / hidden=' + (hiddenNames.join(',') || '(none)')
      const issue = parseMd(textOf(visible, hiddenNames), metaOf(one))
      const exp = one.kind === 'map-ticket'
        ? expectedMapTicket(visible, hiddenNames)
        : expectedOrdinary(one.kind, visible, hiddenNames)
      present(issue, 'status', exp.status !== undefined, caseName)
      eq(issue.status, exp.status, caseName + ' status')
      present(issue, 'statusSource', exp.source !== undefined, caseName)
      eq(issue.statusSource, exp.source, caseName + ' statusSource')
      present(issue, 'statusVisible', exp.statusVisible !== undefined, caseName)
      eq(issue.statusVisible, exp.statusVisible, caseName + ' statusVisible')
      present(issue, 'statusConflict', exp.conflict !== undefined, caseName)
      eq(issue.statusConflict, exp.conflict, caseName + ' statusConflict')
      eq(issue.state, exp.state, caseName + ' state')
      eq(issue.labels.map((label) => label.name), exp.labels, caseName + ' labels')
    }
  }
}

// 一、旧文件：可见 ready-for-agent + 隐藏 needs-info 不是冲突，按隐藏值读。
{
  const issue = parseMd(textOf('ready-for-agent', ['needs-info']), metaOf(KINDS[0]))
  eq(issue.status, 'needs-info', 'old-file status')
  eq(issue.statusSource, 'hidden', 'old-file statusSource')
  eq(issue.statusVisible, 'ready-for-agent', 'old-file statusVisible')
  present(issue, 'statusConflict', false, 'old-file')
  eq(issue.state, 'open', 'old-file state')
  eq(issue.labels.map((label) => label.name), ['docs', 'needs-info'], 'old-file labels')
}

// 二、可见非法值：按缺失参与判断，原值归一后保留到 statusVisible。
{
  const plain = parseMd(textOf('in-progress!', []), metaOf(KINDS[2]))
  present(plain, 'status', false, 'illegal plain')
  eq(plain.statusVisible, 'in-progress', 'illegal plain statusVisible')
  present(plain, 'statusSource', false, 'illegal plain')
  eq(plain.state, 'open', 'illegal plain state')
  eq(plain.labels.map((label) => label.name), ['docs'], 'illegal plain labels')

  const bug = parseMd(textOf('in-progress!', []), metaOf(KINDS[1]))
  eq(bug.status, 'needs-triage', 'illegal bug status')
  eq(bug.statusSource, 'default', 'illegal bug statusSource')
  eq(bug.statusVisible, 'in-progress', 'illegal bug statusVisible')
  eq(bug.state, 'open', 'illegal bug state')
}

// 三、可见值带加粗写法：**Status:** resolved。
{
  const text = '# T\n\n**Status:** resolved\n'
  const issue = parseMd(text, metaOf(KINDS[0]))
  eq(issue.status, 'resolved', 'bold status')
  eq(issue.state, 'closed', 'bold status state')
  eq(issue.statusSource, 'visible', 'bold status source')
}

// 四、地图子票可见非法值：默认 claimed，原值保留，隐藏 triage 忽略且不合成。
{
  const issue = parseMd(textOf('ready-for-agent', ['needs-info']), metaOf(KINDS[3]))
  eq(issue.status, 'claimed', 'wayfinder illegal status')
  eq(issue.statusSource, 'default', 'wayfinder illegal source')
  eq(issue.statusVisible, 'ready-for-agent', 'wayfinder illegal statusVisible')
  present(issue, 'statusConflict', false, 'wayfinder illegal')
  eq(issue.state, 'open', 'wayfinder illegal state')
  eq(issue.labels.map((label) => label.name), ['docs'], 'wayfinder illegal labels')
}

// 五、容器继续走旧读法：隐藏 DSH-STATUS 只影响 state，不暴露新的 status 字段。
{
  const specText = '<!-- DSH-STATUS: resolved -->\n## Problem Statement\n\nBody.\n'
  const spec = parseMd(specText, { key: '00', parentKey: null, isMap: false, kind: 'spec', route: 'spec' })
  eq(spec.state, 'closed', 'container hidden DSH-STATUS state')
  present(spec, 'status', false, 'container hidden DSH-STATUS')
  present(spec, 'statusVisible', false, 'container hidden DSH-STATUS')
  present(spec, 'statusSource', false, 'container hidden DSH-STATUS')
  present(spec, 'statusConflict', false, 'container hidden DSH-STATUS')

  const mapText = '<!-- DSH-STATUS: ready-for-agent -->\n## Destination\n\n**Status:** open\n'
  const map = parseMd(mapText, { key: '00', parentKey: null, isMap: true, route: 'map' })
  eq(map.state, 'open', 'container visible status wins')

  const containerLabels = parseMd('<!-- DSH-STATUS: resolved -->\n<!-- DSH-LABELS: ready-for-agent, bug -->\n## Dest\n', { key: '00', parentKey: null, isMap: true, route: 'map' })
  eq(containerLabels.labels.map((label) => label.name), ['ready-for-agent', 'bug'], 'container labels untouched')
}

// 六、标签并集：可见行与隐藏 DSH-LABELS 都算，triage 先过滤再按有效状态合成一枚。
{
  const text = '<!-- DSH-LABELS: needs-info, wayfinder:research -->\n# T\n\nLabels: docs, bug\n'
  const issue = parseMd(text, metaOf(KINDS[0]))
  eq(issue.status, 'needs-info', 'labels union status')
  eq(issue.labels.map((label) => label.name), ['docs', 'bug', 'wayfinder:research', 'needs-info'], 'labels union')
}
{
  const text = '# T\n\nLabels: needs-triage, docs\n'
  const issue = parseMd(text, metaOf(KINDS[0]))
  eq(issue.status, 'ready-for-agent', 'visible triage filter status')
  eq(issue.labels.map((label) => label.name), ['docs', 'ready-for-agent'], 'visible triage filter labels')
}

if (failures.length) {
  console.error('FAIL ' + failures.length + ' / ' + checks + ' 项判据')
  for (const one of failures.slice(0, 40)) console.error('  - ' + one)
  process.exit(1)
}
console.log('PASS ' + checks + ' 项判据（#1790 P1 状态读侧矩阵）')
