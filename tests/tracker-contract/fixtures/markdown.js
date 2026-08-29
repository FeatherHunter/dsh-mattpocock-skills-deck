/**
 * tests/tracker-contract/fixtures/markdown.js — Markdown 后端合规桩（真实适配器）。
 *
 * 用真实 `parseMd`/`normalizeIssue` 驱动 harness，验证：
 *  - 来源有数据 → 逐项映射正确
 *  - 单 key、无 number/subIssues、无 blocking
 *  - state 两态
 *  - 空值 → 能实现字段 EMPTY、不能实现 MISSING（milestone/auth）—— #312 后 labels 已实现
 *  - diagnoseCapabilities 日志二分
 *  - frontier/indeterminate/NOT-FOUND 安全 blocked
 *
 * 由 #142 落地：真实适配器过 G4 契约测试（合规桩全 PASS）。
 */

import { parseMd } from '../../../src/host/tracker/backends/markdown/parse.js'
import { normalizeIssue } from '../../../src/host/tracker/backends/markdown/normalize.js'

// helper：把 markdown 文本 + meta 组装成 Issue
function normFromSource(source) {
  // source: { text, meta }
  const text = source.text || ''
  const meta = source.meta || { key: '01', parentKey: null, isMap: false }
  return normalizeIssue(text, meta)
}

// withData：含完整字段（Status/Type/Blocked by/Comments/标题/parentKey）
const withData = {
  text: `# Hello World

Body for hello world.

Status: claimed
Type: task
Blocked by: #02

## Comments

### local — 2026-08-24T00:00:00.000Z
First comment.

## Answer

Answer body.

## 进度：30%
`,
  meta: { key: '01', parentKey: '00', isMap: false, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T01:00:00.000Z' },
}

// emptyData：空值版（无 Type？但仍需满足 core 字段补空；能力字段按支持给 EMPTY）
const emptyData = {
  text: `# Empty Issue

Status: ready-for-agent
Type: task
Blocked by:

## Comments

## Answer
`,
  meta: { key: '01', parentKey: null, isMap: false, createdAt: '', updatedAt: '' },
}

// 额外：无 Status 的 indeterminate 样本（用于 deckCases）
const indeterminateText = `# No Status Issue

Body without status line.

## Comments
`

export const markdownFixture = {
  name: 'markdown-real',
  normalize: (source) => normFromSource(source),
  withData,
  emptyData,
  mappings: [],
  // 覆盖 harness 的通用断言：单独为 markdown 定制
  // implementedFields：本地支持 → 必须 EMPTY（存在且空）而非 MISSING
  implementedFields: ['assignees', 'blockedBy', 'comments', 'reason', 'labels'],
  missingFields: ['milestone'],
  deckCases: [
    {
      name: 'empty-open-unclaimed',
      issue: normalizeIssue(withData.text, withData.meta),
      expected: { claimed: true, blocked: true, frontier: false }, // claimed + blockedBy #02 open → blocked true
    },
    {
      name: 'ready-for-agent-frontier',
      issue: normalizeIssue('# Ready\n\nStatus: ready-for-agent\nBlocked by:\n\n## Comments\n', { key: '02', parentKey: '00', isMap: false }),
      expected: { claimed: false, blocked: false, frontier: true },
    },
    {
      name: 'blocked-open',
      issue: {
        key: '03', type: 'issue', title: 'blocked', state: 'open', body: '', url: '',
        createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
        assignees: [], blockedBy: [{ key: '02', title: '', state: 'open' }], comments: [], reason: '',
      },
      lookup: (k) => (k === '02' ? { state: 'open' } : undefined),
      expected: { claimed: false, blocked: true, frontier: false },
    },
    {
      name: 'indeterminate-missing-assignees',
      issue: normalizeIssue(indeterminateText, { key: '04', parentKey: null, isMap: false }),
      expected: { claimed: null, blocked: false, frontier: false },
    },
    {
      name: 'notfound-dep-safe-blocked',
      issue: {
        key: '05', type: 'issue', title: 'broken', state: 'open', body: '', url: '',
        createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
        assignees: [], blockedBy: [{ key: 'ghost-1', title: 'missing', state: 'closed' }], comments: [], reason: '',
      },
      lookup: () => undefined,
      expected: { claimed: false, blocked: true, frontier: false },
    },
  ],
}

// 重写 harness 需要的 mappings：校验 key 与 title 与 state
// 由于 source 是 {text, meta}，harness 的 deepEq 会直接比 source[withData.meta.key] 等，需定制
// 我们在下方提供一个适配后的 run 入口，供 verify 脚本直接调用 parse 的字段校验

export function markdownExtraAssertions() {
  const out = []
  const assert = (name, cond, detail) => out.push({ name: `markdown-real · ${name}`, ok: !!cond, detail: detail || '' })
  const w = normalizeIssue(withData.text, withData.meta)
  const e = normalizeIssue(emptyData.text, emptyData.meta)
  // key 透传
  assert('key is 01', w.key === '01', `got ${w.key}`)
  assert('title extracted', w.title === 'Hello World', `got ${w.title}`)
  assert('state claimed→open', w.state === 'open', `got ${w.state}`)
  assert('blockedBy parsed', Array.isArray(w.blockedBy) && w.blockedBy.length === 1 && w.blockedBy[0].key === '02', JSON.stringify(w.blockedBy))
  assert('comments parsed', Array.isArray(w.comments) && w.comments.length >= 1, JSON.stringify(w.comments))
  assert('customFields Type', Array.isArray(w.customFields) && w.customFields[0]?.value === 'task', JSON.stringify(w.customFields))
  assert('empty state open', e.state === 'open', e.state)
  assert('empty assignees EMPTY', 'assignees' in e && Array.isArray(e.assignees), JSON.stringify(e.assignees))
  assert('empty blockedBy EMPTY', 'blockedBy' in e && Array.isArray(e.blockedBy) && e.blockedBy.length === 0, JSON.stringify(e.blockedBy))
  assert('labels EMPTY', 'labels' in e && Array.isArray(e.labels) && e.labels.length===0, JSON.stringify(e.labels))
  assert('no milestone field', !('milestone' in e), 'milestone present')
  assert('no number field', !('number' in e), 'number present')
  assert('no subIssues field', !('subIssues' in e), 'subIssues present')
  assert('no blocking field', !('blocking' in e), 'blocking present')
  assert('parentKey core', 'parentKey' in e, 'parentKey missing')
  assert('indeterminate missing assignees', !('assignees' in normalizeIssue(indeterminateText, { key: '04', parentKey: null, isMap: false })), 'assignees should be MISSING for no Status')
  return out
}

export default markdownFixture