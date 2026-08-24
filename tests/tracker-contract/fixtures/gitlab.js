/**
 * tests/tracker-contract/fixtures/gitlab.js — GitLab 真实适配器夹具（G4）。
 *
 * 按 #135/#144 一页纸：labels恒EMPTY/milestone独立/blocking双路径。
 * 提供两套：free回退（Blocked by:行） vs premium原生（blocked_by）
 */

import { normalizeIssue } from '../../../src/host/tracker/backends/gitlab/normalize.js'

function baseWith(labels, extra = {}) {
  return {
    iid: 3,
    title: 'hello',
    state: 'opened',
    description: 'hello body',
    web_url: 'http://gitlab.example/group/proj/-/issues/3',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: null,
    labels: labels || [{ name: 'bug', color: 'red' }],
    milestone: { title: 'M1', description: 'desc', state: 'active', due_date: '2024-02-01' },
    author: { username: 'alice', name: 'Alice', avatar_url: '' },
    assignee: null,
    notes: [],
    ...extra,
  }
}

export const gitlabFreeFixture = {
  name: 'gitlab-free(fallback)',
  normalize: normalizeIssue,
  // withData含Blocked by行（free回退）
  withData: baseWith([{ name: 'bug', color: 'red' }], {
    description: 'Blocked by: #1, #2\n\nhello body',
  }),
  emptyData: {
    iid: 1,
    title: 'empty',
    state: 'opened',
    description: '',
    web_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    milestone: null,
    author: null,
  },
  mappings: [
    { from: 'title', to: 'title' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['milestone', 'customFields'], // author在emptyData中省略（MISSING）但withData有→按#135 milestone独立，此处以MISSING示例；author也MISSING
  deckCases: [],
  // 额外断言：free回退下blockedBy应解析出2条
  checkFreeBlockedBy: true,
}

export const gitlabPremiumFixture = {
  name: 'gitlab-premium(native)',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }], {
    description: 'hello body',
    blocked_by: [{ iid: 9, title: 'x', state: 'opened' }],
  }),
  emptyData: {
    iid: 1,
    title: 'empty',
    state: 'opened',
    description: '',
    web_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    milestone: null,
  },
  mappings: [{ from: 'title', to: 'title' }],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['milestone', 'customFields'],
  deckCases: [],
}

export const gitlabMilestoneFixture = {
  name: 'gitlab-milestone',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }], {
    milestone: { title: 'M1', description: 'desc', state: 'active', due_date: '2024-02-01' },
  }),
  emptyData: {
    iid: 1,
    title: 'empty',
    state: 'opened',
    description: '',
    web_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    milestone: null,
  },
  mappings: [{ from: 'title', to: 'title' }],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['milestone', 'customFields'],
  deckCases: [],
}

export default gitlabFreeFixture
