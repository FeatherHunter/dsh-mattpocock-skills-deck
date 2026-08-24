/**
 * tests/tracker-contract/fixtures/demo.js — demo-mini 合规夹具（G4）
 *
 * 供 harness.runContractTests 与 runPlayback 复用，证明“外部实现可交付合规后端”。
 * - normalize 来自 examples/demo-mini/normalize.js（与仓库内实现同一份）
 * - implementedFields：demo 真实现的 5 个能力字段 → EMPTY
 * - missingFields：demo 不实现的 3 个 → MISSING
 */

import { normalizeIssue } from '../../../examples/demo-mini/normalize.js'

export const demoFixture = {
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
