/**
 * tests/tracker-contract/fixtures/violating.js — 违规桩。
 *
 * 故意犯两类错，harness 必须都逮住：
 *   1) 把 `source.title` 映到 `issue.body`（字段级错映），且 `issue.title` 留空 → `map title->title` FAIL。
 *   2) 来源无 labels 时**省略**该字段（MISSING），而非 EMPTY → `empty.labels present(EMPTY)` FAIL。
 * 用途：证明契约能**验收**而不是形同虚设。
 *
 * 定版形状（#127）：单 `key`(string)、无 `number`/`subIssues`。不引用任何已删除导出。
 */

function norm(raw) {
  const issue = {
    key: String(raw.key ?? 1),
    type: 'issue',
    title: '', // 违规：刻意不填 title
    state: raw.state ?? 'open',
    body: raw.title ?? '', // 违规：title 被映到 body
    url: raw.url ?? '',
    assignees: [],
    comments: [],
    blockedBy: [],
    reason: '',
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
  withData: { key: '3', title: 'hello', state: 'open', labels: [{ name: 'bug', color: 'red' }] },
  emptyData: {},
  mappings: [
    { from: 'title', to: 'title' },
    { from: 'state', to: 'state' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['author', 'milestone', 'customFields'],
}
export default violatingFixture
