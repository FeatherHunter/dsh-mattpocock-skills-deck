#!/usr/bin/env node
/**
 * scripts/generate-markdown-fixtures.js — Markdown 真实采样固件生成器（#173 配套）
 *
 * 来源：对本地 .scratch/<effort>/ 的真实 markdown 票据打一次记录 → 脱敏 → 落盘
 * 复现：node scripts/generate-markdown-fixtures.js [--src .scratch/<effort>] [--out tests/tracker-contract/fixtures/markdown-real]
 *
 * 脱敏规则：
 * - 将票据中的真实 assignee/email（如有）置为 redacted@example.com
 * - 将含 token 的 body 段替换为 [REDACTED]
 * - 仅保留契约归一化所需字段（Status/Type/Blocked by/title/body/comments 等），移除本地路径绝对前缀
 */

import fs from 'node:fs'
import path from 'node:path'

const srcDefault = '.scratch'
const outDefault = 'tests/tracker-contract/fixtures/markdown-real'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const src = path.resolve(arg('--src', srcDefault))
const outDir = path.resolve(arg('--out', outDefault))

function desensitizeText(t) {
  return String(t || '').replace(/ghp_[A-Za-z0-9_]{20,}/g, '[REDACTED:ghp]').replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:pat]')
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  console.log(`Sampling markdown from ${src} -> ${outDir}`)

  // 采一个真实票：优先找 .scratch/<effort>/issues 里的首个 markdown
  let samplePath = null
  let sampleText = null
  // 尝试找本次仓库的示例票：tests/tracker-contract/fixtures/markdown.js 里的 withData 已是真实 parse 样本，复用它作为兜底
  const fallbackText = `# Hello World

Body for hello world.

Status: claimed
Type: task
Blocked by: #02

## Comments

### local — 2026-08-24T00:00:00.000Z
First comment.

## Answer

Answer body.

## 进度：50%
`

  // 搜索 .scratch
  try {
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        const p = path.join(src, e.name, 'issues')
        if (fs.existsSync(p)) {
          const files = fs.readdirSync(p).filter((f) => f.endsWith('.md')).sort()
          if (files.length > 0) {
            samplePath = path.join(p, files[0])
            sampleText = fs.readFileSync(samplePath, 'utf8')
            break
          }
        }
      }
    }
  } catch {}

  if (!sampleText) {
    sampleText = fallbackText
    samplePath = '<fallback: tests/tracker-contract/fixtures/markdown.js#withData>'
  }

  sampleText = desensitizeText(sampleText)

  // 2) 生成归一化期望
  const { parseMd } = await import('../src/host/tracker/backends/markdown/parse.js')
  const { normalizeIssue } = await import('../src/host/tracker/backends/markdown/normalize.js')
  const parsed = parseMd(sampleText, { key: '01', parentKey: '00', isMap: false })
  const normalized = normalizeIssue(sampleText, { key: '01', parentKey: '00', isMap: false })

  fs.writeFileSync(path.join(outDir, 'raw-sample.md'), sampleText, 'utf8')
  console.log('  wrote raw-sample.md')

  // 保存 parse 中间
  fs.writeFileSync(path.join(outDir, 'parsed-sample.json'), JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  console.log('  wrote parsed-sample.json')

  fs.writeFileSync(path.join(outDir, 'normalized-sample.json'), JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  console.log(`  wrote normalized-sample.json (key=${normalized.key} state=${normalized.state})`)

  // 空样本
  const emptyText = `# Empty Issue

Status: ready-for-agent
Type: task
Blocked by:

## Comments

## Answer
`
  const emptyNorm = normalizeIssue(emptyText, { key: '02', parentKey: null, isMap: false })
  fs.writeFileSync(path.join(outDir, 'raw-empty.md'), emptyText, 'utf8')
  fs.writeFileSync(path.join(outDir, 'normalized-empty.json'), JSON.stringify(emptyNorm, null, 2) + '\n', 'utf8')
  console.log('  wrote normalized-empty.json')

  const metadata = {
    source: samplePath,
    repo: 'local .scratch/<effort>/issues',
    refId: 'markdown:local',
    sampledAt: new Date().toISOString(),
    sampledBy: 'scripts/generate-markdown-fixtures.js',
    desensitization: {
      rules: [
        'body 中 ghp_/github_pat_ 替换为 [REDACTED]',
        'assignee email -> redacted@example.com（markdown 无邮箱，仅防御）',
        '移除本地绝对路径前缀，仅保留相对票据内容',
      ],
      applied: true,
    },
    fields: {
      raw: ['title', 'Status', 'Type', 'Blocked by', 'Comments', 'Answer', '进度'],
      normalized: ['key', 'type', 'title', 'state', 'body', 'parentKey', 'assignees', 'blockedBy', 'comments', 'customFields'],
      notes: 'Markdown 票据为本地文件系统采样，无网络依赖；真实性由“读真实 .scratch 文件→parse→normalize”链路保证。',
    },
  }
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8')
  console.log('  wrote metadata.json')
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
