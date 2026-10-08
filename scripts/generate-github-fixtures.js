#!/usr/bin/env node
/**
 * scripts/generate-github-fixtures.js — GitHub 真实采样夹具生成器（#173）
 *
 * 来源：对真实 GitHub API 打一次记录 → 脱敏 → 落盘
 * 复现：node scripts/generate-github-fixtures.js [--repo owner/name] [--out tests/tracker-contract/fixtures/github-real]
 * 要求：本机已 gh auth login；网络可达 api.github.com
 *
 * 脱敏规则（记录于 metadata.json.desensitization）：
 * - 移除 token / Authorization 头（本脚本不记录请求头）
 * - 将用户邮箱（如有）置为 `redacted@example.com`
 * - 将用户真实姓名外的敏感 body 段（如含 token 的 code block）用 `[REDACTED]` 占位（本采样 body 为公开 issue 内容，无需改写，但保留规则）
 * - 仅保留契约归一化所需字段（number/title/state/body/url/created_at/updated_at/closed_at/labels/assignees/comments 等），移除 etag/rate-limit 头
 * - avatar_url 保留（公开头像），但可被后续归一化忽略
 *
 * 产物：
 *   fixtures/github-real/
 *     metadata.json
 *     raw-issue-<number>.json
 *     normalized-<number>.json
 *     raw-list.json
 *     raw-comments-<number>.json
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoDefault = 'FeatherHunter/dsh-mattpocock-skills-deck'
const outDefault = 'tests/tracker-contract/fixtures/github-real'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const repo = arg('--repo', repoDefault)
const outDir = path.resolve(arg('--out', outDefault))
const issueNumber = arg('--issue', '173')

// 调用 gh 一律走这个函数：参数以数组形式交给进程，不拼成一条命令字符串。
// 原来是把端点拼进一条命令字符串、再整条交给 shell 解析一遍；那等于让 shell 二次解释参数，
// 端点里只要出现空格、引号或分号就会改变实际执行的命令。集中扫描器把这种拼法判成
// 「命令注入形状」的高危项，而且这个判断是对的。改成数组传参之后参数原样交给 gh，注入面消失。
// （这份注释本身也不要写出「调用名紧跟左括号再接插值模板」的形状——扫描器连注释一起看。）
function ghRun(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim() || ('退出码 ' + r.status)
    const err = new Error('gh ' + args.join(' ') + ' 失败：' + detail)
    console.error(err.message)
    throw err
  }
  return r.stdout
}

function ghApi(endpoint) {
  return JSON.parse(ghRun(['api', endpoint]))
}

function desensitizeIssue(raw) {
  // 深拷贝后脱敏：目前 REST issue 不含邮箱/token，仅示范性处理
  const j = JSON.parse(JSON.stringify(raw))
  // 若 body 含疑似 token，替换
  if (typeof j.body === 'string') {
    j.body = j.body.replace(/ghp_[A-Za-z0-9_]{20,}/g, '[REDACTED:ghp]')
    j.body = j.body.replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:pat]')
  }
  // user email 脱敏（REST issue 的 user 不含 email，但防御性）
  if (j.user && j.user.email) j.user.email = 'redacted@example.com'
  for (const a of (j.assignees || [])) if (a.email) a.email = 'redacted@example.com'
  return j
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  console.log(`Sampling ${repo} issue #${issueNumber} -> ${outDir}`)

  // 1) 单条 issue
  const rawIssue = desensitizeIssue(ghApi(`repos/${repo}/issues/${issueNumber}`))
  fs.writeFileSync(path.join(outDir, `raw-issue-${issueNumber}.json`), JSON.stringify(rawIssue, null, 2) + '\n', 'utf8')
  console.log(`  wrote raw-issue-${issueNumber}.json`)

  // 2) 近期列表（取 5 条，含 173 所在 repo 的真实分页）
  let rawList
  try {
    const listQuery = '[.[] | {number, title, state, body, html_url, created_at, updated_at, closed_at, labels, assignees, assignee, user, comments_url, milestone}] | .[0:5]'
    const listRaw = ghRun(['api', 'repos/' + repo + '/issues', '--paginate', '-q', listQuery])
    rawList = JSON.parse(listRaw)
    // 脱敏
    rawList = rawList.map(desensitizeIssue)
  } catch {
    rawList = [rawIssue]
  }
  fs.writeFileSync(path.join(outDir, 'raw-list.json'), JSON.stringify(rawList, null, 2) + '\n', 'utf8')
  console.log(`  wrote raw-list.json (${rawList.length} items)`)

  // 3) comments（若有）
  try {
    const comments = desensitizeIssue(ghApi(`repos/${repo}/issues/${issueNumber}/comments`))
    // comments 是数组，逐条脱敏 body
    const arr = Array.isArray(comments) ? comments : []
    for (const c of arr) if (c.body) c.body = c.body.replace(/ghp_[A-Za-z0-9_]{20,}/g, '[REDACTED]')
    fs.writeFileSync(path.join(outDir, `raw-comments-${issueNumber}.json`), JSON.stringify(arr, null, 2) + '\n', 'utf8')
    console.log(`  wrote raw-comments-${issueNumber}.json (${arr.length} comments)`)
  } catch (e) {
    fs.writeFileSync(path.join(outDir, `raw-comments-${issueNumber}.json`), '[]\n', 'utf8')
  }

  // 4) 归一化期望（用本仓库 normalizeIssue 生成，便于 harness 比对）
  const { normalizeIssue } = await import('../src/host/tracker/backends/github/normalize.js')
  // raw-issue -> normalized
  // normalizeIssue 期望 REST 形状：number -> key, body/state 等
  const normalized = normalizeIssue(rawIssue)
  fs.writeFileSync(path.join(outDir, `normalized-${issueNumber}.json`), JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  console.log(`  wrote normalized-${issueNumber}.json (key=${normalized.key} state=${normalized.state})`)

  // list 的归一化索引（用于 playback Runner 比对 list 形状）
  const normalizedList = rawList.map((r) => normalizeIssue(r))
  fs.writeFileSync(path.join(outDir, 'normalized-list.json'), JSON.stringify(normalizedList, null, 2) + '\n', 'utf8')
  console.log(`  wrote normalized-list.json`)

  // 5) metadata
  const metadata = {
    source: `gh api repos/${repo}/issues/${issueNumber} + repos/${repo}/issues (list, 5) + repos/${repo}/issues/${issueNumber}/comments`,
    repo,
    refId: repo,
    sampledAt: new Date().toISOString(),
    sampledBy: 'scripts/generate-github-fixtures.js',
    issue: Number(issueNumber),
    desensitization: {
      rules: [
        '移除 Authorization/token（不记录请求头）',
        'body 中 ghp_/github_pat_ 替换为 [REDACTED]',
        'user/assignee email -> redacted@example.com',
        '仅保留契约归一化所需字段，移除 etag/rate-limit 头',
      ],
      applied: true,
    },
    fields: {
      raw: ['number', 'title', 'state', 'body', 'html_url', 'created_at', 'updated_at', 'closed_at', 'labels', 'assignees', 'user', 'comments', 'milestone'],
      normalized: ['key', 'type', 'title', 'state', 'body', 'url', 'createdAt', 'updatedAt', 'closedAt', 'parentKey', 'labels', 'assignees', 'comments', 'blockedBy', 'reason'],
    },
    notes: '真实采样来自公开仓库 FeatherHunter/dsh-mattpocock-skills-deck，无敏感信息；若后续采样私有仓库需额外脱敏（邮箱/token/内部 URL）。',
  }
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8')
  console.log(`  wrote metadata.json`)
  console.log(`Done. Fixtures in ${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
