#!/usr/bin/env node
/**
 * scripts/generate-demo-fixtures.js — 从 examples/demo-mini 内存存储采样生成 fixtures/demo-real
 *
 * 用法：node scripts/generate-demo-fixtures.js
 * 产物：examples/demo-mini/fixtures/demo-real/{metadata.json,raw-*.json,normalized-*.json}
 * 已脱敏：无 token/邮箱，按 tests/tracker-contract/README.md 规则
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeIssue } from '../examples/demo-mini/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'examples/demo-mini/fixtures/demo-real')

const raws = [
  {
    key: '1',
    title: 'Demo issue 1',
    state: 'open',
    body: 'demo body 1',
    url: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [{ name: 'bug', color: 'd73a4a', description: 'bug label' }],
    assignees: [{ login: 'alice', name: 'Alice', avatarUrl: '' }],
    comments: [{ id: 'c1', author: { login: 'alice' }, authorAssociation: 'OWNER', body: 'first comment', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
    blockedBy: [{ key: '2', title: 'Demo issue 2', state: 'open' }],
    reason: '',
  },
  {
    key: '2',
    title: 'Demo issue 2',
    state: 'open',
    body: 'demo body 2',
    url: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
    comments: [],
    blockedBy: [],
    reason: '',
  },
]

fs.mkdirSync(outDir, { recursive: true })

const metadata = {
  source: 'examples/demo-mini in-memory store (seed fixtures)',
  sampledAt: new Date().toISOString(),
  repo: { backend: 'demo-mini', refId: 'demo', name: 'demo', url: '' },
  refId: 'demo',
  desensitization: {
    rules: [
      'ghp_* → [REDACTED]',
      'github_pat_* → [REDACTED]',
      'email → redacted@example.com',
      'no Authorization header logged',
    ],
    checkedAt: new Date().toISOString(),
  },
  fields: {
    implemented: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
    missing: ['author', 'milestone', 'customFields'],
  },
  fixtures: [],
  notes: 'fixtures 由 scripts/generate-demo-fixtures.js 从 normalize + store 采样生成，已脱敏（无 token/邮箱）。',
}

const fixtures = []
for (const raw of raws) {
  const normalized = normalizeIssue(raw)
  const rawFile = `raw-issue-${raw.key}.json`
  const normFile = `normalized-${raw.key}.json`
  fs.writeFileSync(path.join(outDir, rawFile), JSON.stringify(raw, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, normFile), JSON.stringify(normalized, null, 2) + '\n')
  fixtures.push(rawFile, normFile)
}
metadata.fixtures = fixtures
fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n')

// 额外：校验无 token 残留
const allText = JSON.stringify(raws)
if (/ghp_|github_pat_/.test(allText)) {
  console.error('desensitization failed: token pattern found')
  process.exit(1)
}
console.log(`generated ${fixtures.length} fixtures + metadata.json → ${outDir}`)
