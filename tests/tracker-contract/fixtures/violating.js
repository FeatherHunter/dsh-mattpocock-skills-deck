/**
 * tests/tracker-contract/fixtures/violating.js — 违规桩。
 *
 * 故意犯两类错，harness 必须都逮住：
 *   1) 把 `source.title` 映到 `issue.body`（字段级错映）。
 *   2) 来源无 labels 时**省略**该字段（MISSING），而非 EMPTY。
 * 用途：证明契约能**验收**而不是形同虚设。
 */

function norm(raw) {
  const issue = {
    key: String(raw.number ?? 1),
    number: raw.number ?? null,
    type: 'issue',
    title: '', // 违规：刻意不填 title
    state: raw.state ?? 'open',
    body: raw.title ?? '', // 违规：title 被映到 body
    url: raw.url ?? '',
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
  if (raw.labels) {
    issue.labels = raw.labels.map((l) => (typeof l === 'string' ? { name: l, color: '' } : l))
  }
  // else: 故意不写 labels —— MISSING（违规：labels 是能实现字段，应 EMPTY）
  return issue
}

export const violatingFixture = {
  name: 'violating-stub',
  normalize: norm,
  withData: { number: 3, title: 'hello', state: 'open' },
  emptyData: {},
  mappings: [{ from: 'title', to: 'title' }, { from: 'number', to: 'number' }],
  implementedFields: ['labels', 'subIssues', 'blockedBy', 'comments'],
}
export default violatingFixture
