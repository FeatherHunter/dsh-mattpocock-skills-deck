/**
 * tests/tracker-contract/fixtures/demo.ts — demo-mini 合规夹具（G4）
 *
 * 供 harness.runContractTests 与 runPlayback 复用，证明“外部实现可交付合规后端”。
 * - normalize 来自 examples/demo-mini/normalize.js（与仓库内实现同一份）
 * - implementedFields：demo 真实现的 5 个能力字段 → EMPTY
 * - missingFields：demo 不实现的 3 个 → MISSING
 *
 * 由 tests/tracker-contract/fixtures/demo.js 转写：只加可剥离类型标注，
 * import 路径保持 .js 后缀（ts-hook 靠同名改指），数据字样一字不动。
 */

import { normalizeIssue } from '../../../examples/demo-mini/normalize.js'

interface DemoSource {
  key?: string
  title?: string
  state?: string
  body?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  closedAt?: string | null
  parentKey?: string | null
  labels?: unknown[]
  assignees?: unknown[]
  comments?: unknown[]
  blockedBy?: unknown[]
  reason?: string
  [key: string]: unknown
}

interface DeckIssue {
  key: string
  type: string
  title: string
  state: string
  body: string
  url: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  parentKey: string | null
  labels?: unknown[]
  assignees?: unknown[]
  comments?: unknown[]
  blockedBy?: unknown[]
  reason?: string
}

interface DeckCase {
  name: string
  issue: DeckIssue
  expected: { claimed: boolean | null, blocked: boolean, frontier: boolean }
}

export const demoFixture: {
  name: string
  normalize: (source: DemoSource) => DeckIssue
  withData: Record<string, unknown>
  emptyData: Record<string, unknown>
  mappings: Array<{ from: string, to: string }>
  implementedFields: string[]
  missingFields: string[]
  deckCases: DeckCase[]
} = {
  name: 'demo-mini',
  normalize: normalizeIssue,
  withData: {
    key: '1',
    title: 'Demo issue 1',
    state: 'open',
    body: 'demo body 1',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'alice' }],
    comments: [{ author: { login: 'alice' }, body: 'hi', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', authorAssociation: 'OWNER' }],
    blockedBy: [{ key: '2', title: 'Demo issue 2', state: 'open' }],
    reason: '',
  },
  emptyData: {
    key: '1',
    title: '',
    state: 'open',
    body: '',
    url: '',
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    parentKey: null,
  },
  mappings: [
    { from: 'title', to: 'title' },
    { from: 'state', to: 'state' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['author', 'milestone', 'customFields'],
  deckCases: [
    {
      name: 'demo-frontier',
      issue: {
        key: '10', type: 'issue', title: 'frontier', state: 'open', body: '', url: '',
        createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
        labels: [], assignees: [], comments: [], blockedBy: [], reason: '',
      },
      expected: { claimed: false, blocked: false, frontier: true },
    },
    {
      name: 'demo-indeterminate',
      issue: {
        key: '11', type: 'issue', title: 'indeterminate', state: 'open', body: '', url: '',
        createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
        labels: [], comments: [], blockedBy: [], reason: '',
        // assignees 省略 → indeterminate
      },
      expected: { claimed: null, blocked: false, frontier: false },
    },
  ],
}

export default demoFixture
