/**
 * tests/tracker-contract/fixtures/compliant.js — 合规桩。
 *
 * 一个「最小化、形状完整」的后端 normalize：来源有数据 → 逐项映射；来源无 → 必 EMPTY（不 MISSING）。
 * 用途：证明契约可被满足（当它通过 harness，说明契约骨架自洽）。
 *
 * 定版形状（#127）：单 `key`(string)、无 `number`/`subIssues`、无 `blocking`（blocking 仅投影/派生）；
 * `parentKey` 核心字段；
 * 能力字段可 MISSING（本桩实现 labels/assignees/comments/blockedBy/reason → EMPTY；
 * author/milestone/customFields → MISSING）。
 *
 * deckCases 校验契约 §5.2 口径：assignees MISSING → indeterminate；EMPTY([]) → 未认领可 frontier；
 * NOT-FOUND 依赖 → 安全 blocked（绝不误判 frontier）。
 */

function norm(raw) {
  const labels = raw.labels
    ? (Array.isArray(raw.labels)
        ? raw.labels.map((l) => (typeof l === 'string' ? { name: l, color: '' } : { name: l.name, color: l.color || '' }))
        : [])
    : [] // 来源无 → EMPTY（不是 MISSING）
  return {
    key: String(raw.key ?? 1),
    type: raw.type ?? 'issue',
    title: raw.title ?? '',
    state: raw.state ?? 'open',
    body: raw.body ?? '',
    url: raw.url ?? '',
    labels,
    assignees: [],
    comments: [],
    blockedBy: [],
    reason: '', // 支持 closedReason 的后端：open 也输出 ''(EMPTY)
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    parentKey: null,
  }
}

const deckIssues = {
  emptyUnclaimed: {
    key: '11', type: 'issue', title: 'empty', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], assignees: [], comments: [], blockedBy: [], reason: '',
  },
  claimed: {
    key: '12', type: 'issue', title: 'claimed', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], assignees: [{ login: 'a' }], comments: [], blockedBy: [], reason: '',
  },
  blockedOpen: {
    key: '13', type: 'issue', title: 'blocked', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], assignees: [], comments: [], blockedBy: [{ key: '9', title: 'x', state: 'open' }], reason: '',
  },
  indeterminateMissingAssignees: {
    key: '14', type: 'issue', title: 'indeterminate', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], comments: [], blockedBy: [], reason: '',
    // assignees 省略（MISSING）→ indeterminate（未知认领态）
  },
  notFoundDepSafeBlocked: {
    key: '15', type: 'issue', title: 'broken', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], assignees: [], comments: [],
    blockedBy: [{ key: 'ghost-1', title: 'missing', state: 'closed' }], reason: '',
  },
}

export const compliantFixture = {
  name: 'compliant-stub',
  normalize: norm,
  withData: { key: '3', title: 'hello', state: 'open', labels: [{ name: 'bug', color: 'red' }] },
  emptyData: {},
  mappings: [
    { from: 'key', to: 'key' },
    { from: 'title', to: 'title' },
    { from: 'state', to: 'state' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['author', 'milestone', 'customFields'],
  deckCases: [
    { name: 'empty-open-unclaimed', issue: deckIssues.emptyUnclaimed, expected: { claimed: false, blocked: false, frontier: true } },
    { name: 'claimed', issue: deckIssues.claimed, expected: { claimed: true, blocked: false, frontier: false } },
    { name: 'blocked-open', issue: deckIssues.blockedOpen, lookup: (k) => (k === '9' ? { state: 'open' } : undefined), expected: { claimed: false, blocked: true, frontier: false } },
    { name: 'indeterminate-missing-assignees', issue: deckIssues.indeterminateMissingAssignees, expected: { claimed: null, blocked: false, frontier: false } },
    { name: 'notfound-dep-safe-blocked', issue: deckIssues.notFoundDepSafeBlocked, lookup: () => undefined, expected: { claimed: false, blocked: true, frontier: false } },
  ],
}
export default compliantFixture
