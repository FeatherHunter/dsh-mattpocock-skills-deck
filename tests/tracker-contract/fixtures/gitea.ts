/**
 * tests/tracker-contract/fixtures/gitea.ts — Gitea 适配器夹具（G4，票 #3 契约完整化）。
 *
 * 仿 gitlab.ts 的形状：normalize 直接连 rooms/gitea 的 `normalizeIssue`，
 * 跑既有 contract runner（tests/verify-tracker-contract.ts）。票 #3 起的能力口径：
 *   - labels / assignees / comments / blockedBy / reason 字段在、值可为空（EMPTY 口径）；
 *   - milestone / author 有→对象、无→省略（withData 两处都给了值，emptyData 省略）；
 *   - customFields 恒省略（Gitea 无此概念）；
 *   - blockedBy 与 parentKey 的真相是票面正文标记：三套夹具分别盖住
 *     原生（无标记）、隐藏机器表优先（`<!-- DSH-BLOCKED-BY: ... -->`）、
 *     可见 `Blocked by:` 行兜底三条路。
 * import 写 .js 后缀（真实文件是 normalize.ts，全靠钩子改指），与 gitlab.ts 同一写法。
 */

import { normalizeIssue } from '../../../src/tracker/rooms/gitea/model/normalize.js'

interface GiteaSource {
  index?: number
  title?: string
  state?: string
  body?: string
  html_url?: string
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  labels?: Array<{ name: string, color?: string }>
  assignees?: Array<{ login?: string, username?: string, full_name?: string }>
  milestone?: { title: string, description?: string, state?: string, due_on?: string } | null
  author?: { login?: string, username?: string, full_name?: string } | null
  notes?: unknown[]
  [key: string]: unknown
}

interface GiteaFixture {
  name: string
  normalize: (source: GiteaSource) => Record<string, unknown>
  withData: GiteaSource
  emptyData: GiteaSource
  mappings: Array<{ from: string, to: string }>
  implementedFields: string[]
  missingFields: string[]
  deckCases: unknown[]
}

function baseWith(labels: Array<{ name: string, color?: string }> | null, extra: Record<string, unknown> = {}): GiteaSource {
  return {
    index: 3,
    title: 'hello',
    state: 'open',
    body: 'hello body',
    html_url: 'http://gitea.example/group/proj/issues/3',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: null,
    labels: labels || [{ name: 'bug', color: 'red' }],
    assignees: [],
    milestone: { title: 'M1', description: 'desc', state: 'active', due_on: '2024-02-01' },
    author: { login: 'alice', full_name: 'Alice' },
    notes: [{ id: 11, author: { login: 'bob' }, body: 'first note', created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-03T00:00:00Z' }],
    ...extra,
  }
}

/** 主夹具：无正文标记。blockedBy 走「没有任何标记→空数组」这条路（字段在、值为空）。 */
export const giteaMinimalFixture: GiteaFixture = {
  name: 'gitea-minimal',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }]),
  emptyData: {
    index: 1,
    title: 'empty',
    state: 'open',
    body: '',
    html_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    assignees: [],
    milestone: null,
    author: null,
  } as GiteaSource,
  mappings: [
    { from: 'title', to: 'title' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['customFields'],
  deckCases: [],
}

/** 隐藏机器表夹具：正文文件头同时有父标记与阻塞机器表，两条都要按隐藏表读出来。 */
export const giteaMinimalHiddenFixture: GiteaFixture = {
  name: 'gitea-minimal-hidden',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }], {
    body: '<!-- DSH-IDEMPOTENCY-KEY: abc -->\n<!-- DSH-PARENT: 7 -->\n<!-- DSH-BLOCKED-BY: 1, 2 -->\n\n# hello\n\nhello body',
  }),
  emptyData: {
    index: 1,
    title: 'empty',
    state: 'open',
    body: '',
    html_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    assignees: [],
    milestone: null,
    author: null,
  } as GiteaSource,
  mappings: [{ from: 'title', to: 'title' }],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['customFields'],
  deckCases: [],
}

/** 可见行兜底夹具：没有隐藏表，只有人写的 `Blocked by: #1, #2` 行——阻塞照样要读出来。 */
export const giteaMinimalVisibleFixture: GiteaFixture = {
  name: 'gitea-minimal-visible',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }], {
    body: 'Blocked by: #1, #2\n\nhello body',
  }),
  emptyData: {
    index: 1,
    title: 'empty',
    state: 'open',
    body: '',
    html_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    assignees: [],
    milestone: null,
    author: null,
  } as GiteaSource,
  mappings: [{ from: 'title', to: 'title' }],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['customFields'],
  deckCases: [],
}

export default giteaMinimalFixture
