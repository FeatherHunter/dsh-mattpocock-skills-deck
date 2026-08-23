/**
 * tests/tracker-contract/fixtures/compliant.js — 合规桩。
 *
 * 一个「最小化、形状完整」的后端 normalize：来源有数据 → 逐项映射；来源无 → 必 EMPTY（不 MISSING）。
 * 用途：证明契约可被满足（当它通过 harness，说明契约骨架自洽）。
 */

function norm(raw) {
  const labels = raw.labels
    ? (Array.isArray(raw.labels)
        ? raw.labels.map((l) => (typeof l === 'string' ? { name: l, color: '' } : { name: l.name, color: l.color || '' }))
        : [])
    : [] // 来源无 → EMPTY（不是 MISSING）
  return {
    key: String(raw.number ?? 1),
    number: raw.number ?? null,
    type: 'issue',
    title: raw.title ?? '',
    state: raw.state ?? 'open',
    body: raw.body ?? '',
    url: raw.url ?? '',
    labels,
    assignees: [],
    comments: [],
    subIssues: [],
    blockedBy: [],
    blocking: [],
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    parentKey: null,
  }
}

export const compliantFixture = {
  name: 'compliant-stub',
  normalize: norm,
  withData: { number: 3, title: 'hello', state: 'open', labels: [{ name: 'bug', color: 'red' }] },
  emptyData: {},
  mappings: [{ from: 'title', to: 'title' }, { from: 'state', to: 'state' }, { from: 'number', to: 'number' }],
  implementedFields: ['labels', 'subIssues', 'blockedBy', 'comments'],
}
export default compliantFixture
