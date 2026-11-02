// tests/verify-1790-status-model.ts —— #1790 P0：本地 Markdown 票的 triage 状态模型（纯函数层）。
//
// 这一扇只打 status.ts 的公共出口：状态词表、规范化、票型判定、读侧四分支、冲突对象、
// 标签合成/过滤、正文 Status 行提取、DSH-STATUS-HISTORY 追加与去重。
// 期望值全部写成字面量（不拿生产常量反算），生产函数改了行为就会在这里红。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1790-status-model.ts

import assert from 'node:assert/strict'
import {
  TRIAGE_STATUS_ROLES,
  COMPLETED_STATUS_VALUES,
  LEGACY_STATUS_DEFAULT,
  normalizeStatus,
  isTriageStatus,
  stateOfStatus,
  defaultStatusOf,
  statusKindOf,
  resolveStatusRead,
  hiddenLabelsOf,
  labelsWithSynthesizedTriage,
  statusInBody,
  readStatusHistory,
  appendStatusHistory,
} from '../src/tracker/rooms/markdown/status.js'

let failed = false
let passed = 0

function check(ok: unknown, msg: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + msg)
  } else {
    failed = true
    console.log('  FAIL ' + msg)
  }
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  try {
    assert.deepStrictEqual(actual, expected)
    check(true, msg)
  } catch {
    check(false, msg + '（实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected) + '）')
  }
}

// ══════ 一、词表：三组取值必须与冻结契约逐字一致 ══════
console.log('\n一、状态词表')
eq(TRIAGE_STATUS_ROLES, ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'], '五个 triage 角色')
eq(COMPLETED_STATUS_VALUES, ['resolved', 'completed', 'closed', 'done'], '四个完成值')
eq(LEGACY_STATUS_DEFAULT, 'ready-for-agent', '旧渲染器给 issue 文件写的默认值')

// ══════ 二、normalizeStatus：大小写、空格、标点 ══════
console.log('\n二、normalizeStatus')
eq(normalizeStatus(null), null, 'null 归一为 null')
eq(normalizeStatus(undefined), null, 'undefined 归一为 null')
eq(normalizeStatus(''), null, '空串归一为 null')
eq(normalizeStatus('   '), null, '全空白归一为 null')
eq(normalizeStatus('ready-for-agent'), 'ready-for-agent', '合法值原样保留')
eq(normalizeStatus('  READY-FOR-AGENT  '), 'ready-for-agent', '大小写与两侧空格')
eq(normalizeStatus('Ready For Agent'), 'ready-for-agent', '内部空格换成连字符')
eq(normalizeStatus('needs_triage'), 'needs-triage', '下划线换成连字符')
eq(normalizeStatus('wontfix.'), 'wontfix', '去掉句尾标点')
eq(normalizeStatus('**done**'), 'done', '去掉 Markdown 强调符号')
eq(normalizeStatus('ready-for-agent,'), 'ready-for-agent', '去掉句尾逗号')
eq(normalizeStatus('  ** Blocked **  '), 'blocked', '强调符号与空格一起处理')
eq(normalizeStatus(42), null, '非字符串归一为 null')

// ══════ 三、isTriageStatus / 九类状态与 state 映射 ══════
console.log('\n三、状态分类与 state')
eq(isTriageStatus('needs-info'), true, 'needs-info 是 triage')
eq(isTriageStatus(' WONT-FIX '), false, 'wont-fix 不是合法词')
eq(isTriageStatus('wontfix'), true, 'wontfix 是 triage')
eq(isTriageStatus('claimed'), false, 'claimed 不是 triage')
eq(isTriageStatus('resolved'), false, 'resolved 不是 triage')
const stateCases: Array<[string | null, string]> = [
  ['needs-triage', 'open'],
  ['needs-info', 'open'],
  ['ready-for-agent', 'open'],
  ['ready-for-human', 'open'],
  ['wontfix', 'closed'],
  ['resolved', 'closed'],
  ['completed', 'closed'],
  ['closed', 'closed'],
  ['done', 'closed'],
  [null, 'open'],
  ['', 'open'],
  ['claimed', 'open'],
  ['不是状态词', 'open'],
]
for (const [value, expected] of stateCases) {
  eq(stateOfStatus(value), expected, 'stateOfStatus(' + JSON.stringify(value) + ') === ' + expected)
}

// ══════ 四、四类票型的默认状态 ══════
console.log('\n四、票型默认')
eq(defaultStatusOf('spec-ticket'), 'ready-for-agent', 'spec-ticket 默认 ready-for-agent')
eq(defaultStatusOf('bug'), 'needs-triage', 'bug 默认 needs-triage')
eq(defaultStatusOf('plain-issue'), undefined, 'plain-issue 没有默认状态')
eq(defaultStatusOf('map-ticket'), 'claimed', 'map-ticket 默认 claimed')

// ══════ 五、statusKindOf：显式 fileKind > 地图路线 > bug 标签 > 其余路线 > 原文线索 > 普通票 ══════
console.log('\n五、statusKindOf')
eq(statusKindOf({ fileKind: 'plain-issue' }, ['bug'], '**What to build:** x'), 'plain-issue', '显式 fileKind 优先于 bug 标签与正文线索')
eq(statusKindOf({ fileKind: 'bug' }, [], ''), 'bug', '显式 fileKind 直接采用')
eq(statusKindOf({}, ['bug'], ''), 'bug', 'bug 标签其次')
// 地图目录是物理事实：子票的状态词只有 claimed / resolved，一枚 bug 标签不能把它换成 triage 票。
eq(statusKindOf({ route: 'map' }, ['bug'], ''), 'map-ticket', '地图路线先于 bug 标签')
eq(statusKindOf({ route: 'spec' }, ['bug'], ''), 'bug', 'bug 标签先于其余目录路线')
eq(statusKindOf({ route: 'map' }, [], ''), 'map-ticket', 'route map 是地图子票')
eq(statusKindOf({ route: 'spec' }, [], ''), 'spec-ticket', 'route spec 是实施票')
eq(statusKindOf({ route: 'plain' }, [], ''), 'plain-issue', 'route plain 是普通票')
eq(statusKindOf({ route: '' }, [], 'Type: research\n\nStatus: claimed'), 'map-ticket', '没有路线线索时 Type 行判地图子票')
eq(statusKindOf({ route: '' }, [], '# 01: 问句\n\n## Question\n\n问题'), 'map-ticket', '没有路线线索时 ## Question 判地图子票')
eq(statusKindOf({ route: '' }, [], '# 01: 步骤\n\n**What to build:** 行为'), 'spec-ticket', '没有路线线索时 What to build 判实施票')
eq(statusKindOf({ route: '' }, [], '就一段普通描述'), 'plain-issue', '什么线索都没有时按普通票')
eq(statusKindOf(null, null, null), 'plain-issue', 'meta 与 labels 都缺时按普通票')

// ══════ 六、resolveStatusRead：四个分支、非法值、多隐藏值 ══════
console.log('\n六、resolveStatusRead')
eq(resolveStatusRead('spec-ticket', 'done', []), { status: 'done', statusSource: 'visible', state: 'closed' }, '① 可见合法且非旧默认：取可见值')
eq(
  resolveStatusRead('spec-ticket', 'ready-for-agent', ['needs-info']),
  { status: 'needs-info', statusSource: 'hidden', statusVisible: 'ready-for-agent', state: 'open' },
  '② 可见旧默认 + 隐藏恰好一个 triage：取隐藏值（旧文件兼容读，不是冲突）',
)
eq(
  resolveStatusRead('spec-ticket', 'ready-for-agent', []),
  { status: 'ready-for-agent', statusSource: 'visible', state: 'open' },
  '③ 隐藏没有 triage：取可见的旧默认值',
)
eq(
  resolveStatusRead('spec-ticket', 'ready-for-agent', ['needs-info', 'wontfix']),
  { status: 'ready-for-agent', statusSource: 'visible', state: 'open' },
  '隐藏有多个 triage 时跳过第 ② 条，可见旧默认仍成立',
)
eq(
  resolveStatusRead('spec-ticket', '', []),
  { status: 'ready-for-agent', statusSource: 'default', state: 'open' },
  '④ spec-ticket 没有可见值：票型默认 ready-for-agent',
)
eq(
  resolveStatusRead('bug', '', []),
  { status: 'needs-triage', statusSource: 'default', state: 'open' },
  '④ bug 没有可见值：票型默认 needs-triage',
)
eq(resolveStatusRead('plain-issue', '', []), { state: 'open' }, '④ plain-issue 没有默认状态，字段按需省略')
eq(
  resolveStatusRead('spec-ticket', 'claimed', []),
  { status: 'ready-for-agent', statusSource: 'default', statusVisible: 'claimed', state: 'open' },
  '非法可见值按缺失参与判断，原值留在 statusVisible',
)
eq(
  resolveStatusRead('plain-issue', 'claimed', []),
  { statusVisible: 'claimed', state: 'open' },
  'plain-issue 的非法可见值最终没有 status，仍保留 statusVisible',
)
eq(
  resolveStatusRead('bug', 'claimed', ['needs-info', 'wontfix']),
  { status: 'needs-triage', statusSource: 'default', statusVisible: 'claimed', state: 'open' },
  '可见值非法且隐藏有多个 triage：落到票型默认，落选值留给第一次写入记录',
)
eq(
  resolveStatusRead('spec-ticket', 'claimed', ['needs-info']),
  { status: 'needs-info', statusSource: 'hidden', statusVisible: 'claimed', state: 'open' },
  '可见值非法 + 隐藏恰好一个：取隐藏值，不因非法值变成默认',
)
eq(
  resolveStatusRead('spec-ticket', 'needs-triage', ['needs-triage']),
  { status: 'needs-triage', statusSource: 'visible', state: 'open' },
  '可见与隐藏同值：取可见来源，不报冲突',
)

// ══════ 七、wayfinder 子票：只认 claimed / resolved，不参与隐藏 triage 与冲突 ══════
console.log('\n七、wayfinder 子票')
eq(
  resolveStatusRead('map-ticket', 'resolved', []),
  { status: 'resolved', statusSource: 'visible', state: 'closed' },
  '可见 resolved：closed',
)
eq(
  resolveStatusRead('map-ticket', 'claimed', ['needs-info']),
  { status: 'claimed', statusSource: 'visible', state: 'open' },
  '隐藏 triage 对地图子票不参与判定，也不报冲突',
)
eq(
  resolveStatusRead('map-ticket', '', []),
  { status: 'claimed', statusSource: 'default', state: 'open' },
  '没有可见值：默认 claimed',
)
eq(
  resolveStatusRead('map-ticket', 'ready-for-agent', []),
  { status: 'claimed', statusSource: 'default', statusVisible: 'ready-for-agent', state: 'open' },
  '可见值不属于 claimed/resolved：按默认 claimed，原值留 statusVisible',
)
eq(
  resolveStatusRead('map-ticket', 'done', []),
  { status: 'claimed', statusSource: 'default', statusVisible: 'done', state: 'open' },
  '完成值也不是地图子票的合法值：仍按 claimed',
)

// ══════ 八、真冲突对象：逐字断言 ══════
console.log('\n八、真冲突')
eq(
  resolveStatusRead('spec-ticket', 'wontfix', ['ready-for-agent']),
  {
    status: 'wontfix',
    statusSource: 'visible',
    state: 'closed',
    statusConflict: {
      field: 'status',
      visible: 'wontfix',
      hidden: ['ready-for-agent'],
      hiddenSource: 'DSH-LABELS',
      stateFromVisible: 'closed',
      stateFromHidden: 'open',
      resolution: {
        default: 'visible',
        rule: 'visible-status-wins',
        action: 'write-visible-status-on-next-write',
        history: 'DSH-STATUS-HISTORY',
      },
    },
  },
  '可见 wontfix 与隐藏 ready-for-agent 不一致：冲突对象逐字匹配',
)
eq(
  resolveStatusRead('bug', 'ready-for-human', ['needs-triage']),
  {
    status: 'ready-for-human',
    statusSource: 'visible',
    state: 'open',
    statusConflict: {
      field: 'status',
      visible: 'ready-for-human',
      hidden: ['needs-triage'],
      hiddenSource: 'DSH-LABELS',
      stateFromVisible: 'open',
      stateFromHidden: 'open',
      resolution: {
        default: 'visible',
        rule: 'visible-status-wins',
        action: 'write-visible-status-on-next-write',
        history: 'DSH-STATUS-HISTORY',
      },
    },
  },
  '两个 triage 角色不一致也是真冲突',
)
eq(
  resolveStatusRead('map-ticket', 'wontfix', ['needs-triage']),
  { status: 'claimed', statusSource: 'default', statusVisible: 'wontfix', state: 'open' },
  '地图子票从不产生 statusConflict',
)

// ══════ 九、标签：hiddenLabelsOf 过滤 triage / labelsWithSynthesizedTriage 合成一枚 ══════
console.log('\n九、标签变换')
eq(
  hiddenLabelsOf(['bug', 'needs-triage', 'ready-for-agent', 'wayfinder:research', 'needs-info']),
  ['bug', 'wayfinder:research'],
  'hiddenLabelsOf 只留非 triage 标签',
)
eq(hiddenLabelsOf([{ name: 'bug' }, { name: 'wontfix' }]), ['bug'], '对象形状的标签同样过滤')
eq(hiddenLabelsOf([]), [], '空标签返回空数组')
eq(hiddenLabelsOf(null), [], '缺标签返回空数组')
eq(hiddenLabelsOf(['bug', 'bug']), ['bug'], '重复标签只留一份')
eq(
  labelsWithSynthesizedTriage(['bug', 'wayfinder:task'], 'needs-triage'),
  ['bug', 'wayfinder:task', 'needs-triage'],
  '按有效状态合成一枚 triage 标签',
)
eq(labelsWithSynthesizedTriage(['bug'], 'claimed'), ['bug'], 'claimed 不是 triage，不合成')
eq(labelsWithSynthesizedTriage(['bug'], undefined), ['bug'], '没有状态时不合成')
eq(labelsWithSynthesizedTriage(['needs-info'], 'needs-info'), ['needs-info'], '已有同一枚 triage 时不重复')

// ══════ 十、statusInBody：只看第一个一级标题之前的 Status 行 ══════
console.log('\n十、statusInBody')
eq(statusInBody('**Status:** Needs-Triage'), 'needs-triage', '认加粗字段行并归一')
eq(statusInBody('Status: claimed\n\n## Question'), 'claimed', '认裸行')
eq(statusInBody('some prose\n\n**Status:** wontfix.\n'), 'wontfix', '没有一级标题时扫描整段正文')
eq(statusInBody('# 01: 标题\n\n**Status:** ready-for-agent'), null, '一级标题之后的 Status 行不算')
eq(statusInBody('Status: ready-for-agent\n\n# 示例\n\nStatus: wontfix'), 'ready-for-agent', '只取第一个一级标题之前的 Status 行')
eq(statusInBody(''), null, '空正文没有 Status 行')
eq(statusInBody('**Status:** **'), null, '空值等于没有 Status 行')
eq(statusInBody('Status：claimed'), 'claimed', '全角冒号同样认')

// ══════ 十一、DSH-STATUS-HISTORY：追加位置、去重、读回 ══════
console.log('\n十一、DSH-STATUS-HISTORY')
const before = [
  '<!-- DSH-FORMAT: md-v1 -->',
  '<!-- DSH-LABELS: bug -->',
  '',
  '# 01: 示例票',
  '',
  '**Status:** ready-for-agent',
  '',
].join('\n')
const historyLine = '<!-- DSH-STATUS-HISTORY: source=hidden discarded=needs-info adopted=ready-for-agent at=2026-11-02T02:00:00.000Z -->'
const afterOnce = [
  '<!-- DSH-FORMAT: md-v1 -->',
  '<!-- DSH-LABELS: bug -->',
  historyLine,
  '',
  '# 01: 示例票',
  '',
  '**Status:** ready-for-agent',
  '',
].join('\n')
const entryOne = { source: 'hidden', discarded: 'needs-info', adopted: 'ready-for-agent', at: '2026-11-02T02:00:00.000Z' }
eq(appendStatusHistory(before, entryOne), afterOnce, '历史行追加在最后一个隐藏注释之后、第一个标题之前')
eq(readStatusHistory(before), [], '没有历史行时读回空数组')
eq(readStatusHistory(afterOnce), [entryOne], '历史行读回一条')
eq(appendStatusHistory(afterOnce, entryOne), afterOnce, '同一条（来源 + 落选值 + 采用值）不重复追加')
eq(
  appendStatusHistory(afterOnce, { ...entryOne, at: '2026-11-02T03:00:00.000Z' }),
  afterOnce,
  '只有时间不同也算同一条，不重复追加',
)
const entryTwo = { source: 'visible', discarded: 'wontfix', adopted: 'resolved', at: '2026-11-02T04:00:00.000Z' }
const afterTwice = appendStatusHistory(afterOnce, entryTwo)
eq(readStatusHistory(afterTwice), [entryOne, entryTwo], '不同的一条继续追加，读回两条按文件顺序')
check(afterTwice.split('<!-- DSH-STATUS-HISTORY:').length === 3, '两次追加后文件里恰好两条历史行')
eq(appendStatusHistory('', entryOne), '<!-- DSH-STATUS-HISTORY: source=hidden discarded=needs-info adopted=ready-for-agent at=2026-11-02T02:00:00.000Z -->\n', '空文本上追加也写成完整一行')

// ---- 汇总 ----
console.log('')
if (failed) {
  console.log('FAIL verify-1790-status-model：' + passed + ' 项通过，有失败项')
  process.exit(1)
}
console.log('PASS verify-1790-status-model：' + passed + ' 项判据全过（词表 / 归一 / state / 票型默认 / 票型判定 / 读侧 / 冲突 / 标签 / 正文 / 历史）')
