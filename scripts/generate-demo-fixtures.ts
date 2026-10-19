#!/usr/bin/env node
// 迁移说明（#1252）：本文件由 scripts/generate-demo-fixtures.js 转写而来，只加类型注解，行为零变化。
/**
 * scripts/generate-demo-fixtures.ts — 从 examples/demo-mini 内存存储采样生成 fixtures/demo-real
 *
 * 用法：node scripts/generate-demo-fixtures.ts
 * 产物：examples/demo-mini/fixtures/demo-real/{metadata.json,raw-*.json,normalized-*.json}
 * 已脱敏：无 token/邮箱，按 tests/tracker-contract/README.md 规则
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// examples/demo-mini 的入口在 #1252 之后转成了 TypeScript（51aed970），这里能顺着 .ts 拿到形状；
// 原先遮 TS7016 的 @ts-expect-error 因此变成多余指令（TS2578），随合并 main 一并删掉。
import { normalizeIssue } from '../examples/demo-mini/normalize.js'

const __dirname: string = path.dirname(fileURLToPath(import.meta.url))
const root: string = path.join(__dirname, '..')
const outDir: string = path.join(root, 'examples/demo-mini/fixtures/demo-real')

type DemoRaw = {
  key: string
  title: string
  state: string
  body: string
  url: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  parentKey: string | null
  labels: Array<{ name: string; color: string; description: string }>
  assignees: Array<{ login: string; name: string; avatarUrl: string }>
  comments: Array<{ id: string; author: { login: string }; authorAssociation: string; body: string; createdAt: string; updatedAt: string }>
  blockedBy: Array<{ key: string; title: string; state: string }>
  reason: string
}

const raws: DemoRaw[] = [
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

const metadata: {
  source: string
  sampledAt: string
  repo: Record<string, string>
  refId: string
  desensitization: { rules: string[]; checkedAt: string }
  fields: { implemented: string[]; missing: string[] }
  fixtures: string[]
  notes: string
} = {
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
  notes: 'fixtures 由 scripts/generate-demo-fixtures.ts 从 normalize + store 采样生成，已脱敏（无 token/邮箱）。',
}

const fixtures: string[] = []
for (const raw of raws) {
  const normalized: unknown = normalizeIssue(raw)
  const rawFile: string = `raw-issue-${raw.key}.json`
  const normFile: string = `normalized-${raw.key}.json`
  fs.writeFileSync(path.join(outDir, rawFile), JSON.stringify(raw, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, normFile), JSON.stringify(normalized, null, 2) + '\n')
  fixtures.push(rawFile, normFile)
}
metadata.fixtures = fixtures
fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n')

// 额外：校验无 token 残留
const allText: string = JSON.stringify(raws)
if (/ghp_|github_pat_/.test(allText)) {
  console.error('desensitization failed: token pattern found')
  process.exit(1)
}
console.log(`generated ${fixtures.length} fixtures + metadata.json → ${outDir}`)
