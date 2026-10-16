/**
 * tests/tracker-contract/fixtures/violating.ts — 违规桩。
 *
 * 故意犯两类错，harness 必须都逮住：
 *   1) 把 `source.title` 映到 `issue.body`（字段级错映），且 `issue.title` 留空 → `map title->title` FAIL。
 *   2) 来源无 labels 时**省略**该字段（MISSING），而非 EMPTY → `empty.labels present(EMPTY)` FAIL。
 * 用途：证明契约能**验收**而不是形同虚设。
 *
 * 定版形状（#127）：单 `key`(string)、无 `number`/`subIssues`。不引用任何已删除导出。
 *
 * 由 tests/tracker-contract/fixtures/violating.js 转写：只加可剥离类型标注，
 * 三处“故意犯罪现场”（title 留空、body 错映、有条件省略 labels）原样保留，
 * 不许“修复”、不许给 labels 加默认值或必选类型兜底。
 */

interface RawSource {
  key?: string | number
  effortId?: string
  state?: string
  title?: string
  url?: string
  labels?: Array<string | { name: string, color?: string }>
  [key: string]: unknown
}

interface ViolatingIssue {
  key: string
  effortId: string
  type: string
  title: string
  state: string
  body: string
  url: string
  labels?: Array<{ name: string, color?: string }>
  assignees: unknown[]
  comments: unknown[]
  blockedBy: unknown[]
  reason: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  parentKey: string | null
}

function norm(raw: RawSource): ViolatingIssue {
  const issue: ViolatingIssue = {
    key: String(raw.key ?? 1),
    effortId: String(raw.effortId ?? ''),
    type: 'issue',
    title: '', // 违规：刻意不填 title
    state: raw.state ?? 'open',
    body: (raw.title as string) ?? '', // 违规：title 被映到 body
    url: (raw.url as string) ?? '',
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

export const violatingFixture: {
  name: string
  normalize: (raw: RawSource) => ViolatingIssue
  withData: Record<string, unknown>
  emptyData: Record<string, unknown>
  mappings: Array<{ from: string, to: string }>
  implementedFields: string[]
  missingFields: string[]
} = {
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
