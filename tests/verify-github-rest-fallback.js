#!/usr/bin/env node
/**
 * 回归门禁：GitHub 后端 list/get 的 REST 降级（#415 承接 #414 刷新现场）。
 *
 * 背景：2026-09-02 现场实测 —— api.github.com/graphql 的 POST 在本机偶发
 * `unexpected EOF`（网络层），而 REST 单页稳定（gh api repos/.../issues?page=k）。
 * 面板刷新（wf.refresh → composer → listIssues(GraphQL)）因此失败，
 * 客户端静默保留旧快照 → 列表不出现 414、状态栏时间却走针。
 *
 * 本测试两路：
 *  - 文件断言：issues.js 含 REST 降级辅助（fetchAllIssuesREST / repairParentLinksREST / applyIssueFilter）；
 *  - 行为断言：stub ctx（GraphQL 恒失败 / REST 恒成功），listIssues 必须经 REST 返回
 *    全量并修复树边（子票 parentKey 指向 wayfinder:map 地图票），getIssue 同样可用。
 *
 * 运行：node --no-warnings tests/verify-github-rest-fallback.js
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function check (cond, msg) { if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else console.log('PASS', msg) }

// ---------- 1) 文件断言 ----------
const src = readFileSync(resolve(ROOT, 'src/host/tracker/backends/github/issues.js'), 'utf8')
check(src.includes('fetchAllIssuesREST'), 'issues.js 含 fetchAllIssuesREST（REST 分页降级）')
check(src.includes('repairParentLinksREST'), 'issues.js 含 repairParentLinksREST（sub_issues 树边修复）')
check(src.includes('applyIssueFilter'), 'issues.js 含 applyIssueFilter（两路共用过滤）')
const normSrc = readFileSync(resolve(ROOT, 'src/host/tracker/backends/github/normalize.js'), 'utf8')
check(normSrc.includes('html_url'), 'normalize.js 优先 html_url（REST 展示地址）')
const probeSrc = readFileSync(resolve(ROOT, 'src/client/kernel/probe.js'), 'utf8')
check(!probeSrc.includes('sanitizeIssueUrls') && !probeSrc.includes('api\\.github\\.com'), '客户端 kernel 不含 github 专属 url 归一（后端无关，UI 零耦合）')

// ---------- 2) 行为断言（stub 双路）----------
const { listIssues, getIssue } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/issues.js')).href)

// 固定夹具：150 条（page1=100, page2=50），其中 #1 为 wayfinder:map 地图；#7 为地图（有子票 414、8）；#414 在 page2
function makeIssue (n) {
  const labels = n === 1 || n === 7 ? [{ name: 'wayfinder:map' }] : [{ name: 'bug' }]
  return { number: n, title: 'issue ' + n, state: 'open', labels, user: { login: 'tester' }, html_url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/' + n }
}
const all = []
for (let n = 1; n <= 149; n++) all.push(makeIssue(n))
all.push(makeIssue(414)) // 外部建票 414（模拟现场：它在第 2 页）

const ctx = {
  cwd: ROOT,
  platform: { resolveExecutable: async (name) => name === 'gh' ? 'gh' : null },
  exec: async function (cmd, args, opts) {
    const joined = (args || []).join(' ')
    if (joined.includes('graphql')) {
      // 模拟本机现场：GraphQL POST 必 EOF
      return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
    }
    const page = /[?&]page=(\d+)/.exec(joined)
    if (joined.includes('/issues?state=all')) {
      const p = page ? Number(page[1]) : 1
      const start = (p - 1) * 100
      const slice = all.slice(start, start + 100)
      return { code: 0, stdout: JSON.stringify(slice), stderr: '' }
    }
    const sub = /issues\/(\d+)\/sub_issues/.exec(joined)
    if (sub) {
      const m = Number(sub[1])
      const kids = m === 7 ? [414, 8] : []
      return { code: 0, stdout: JSON.stringify(kids.map((n) => ({ number: n, title: 'child ' + n, state: 'open' }))), stderr: '' }
    }
    const single = /repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(joined)
    if (single) {
      const n = Number(single[1])
      const it = all.find((x) => x.number === n)
      return it ? { code: 0, stdout: JSON.stringify(it), stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined }
  },
}

const repo = { refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'FeatherHunter/dsh-mattpocock-skills-deck' }

const lr = await listIssues(repo, {}, ctx)
check(lr && lr.ok === true, 'listIssues: GraphQL 失败后 REST 降级成功')
if (lr && lr.ok) {
  const data = lr.data || []
  check(data.length === 150, 'listIssues: REST 全量 150 条（got ' + data.length + '）')
  const i414 = data.find((x) => String(x.key) === '414')
  check(!!i414, 'listIssues: 返回含 414')
  check(i414 && i414.parentKey === '7', 'listIssues: 414 树边修复 parentKey=7（got ' + (i414 && i414.parentKey) + '）')
  check(i414 && i414.url === 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/414', 'listIssues: 414 url 为页面地址（REST html_url 优先，got ' + (i414 && i414.url) + '）')
  const i8 = data.find((x) => String(x.key) === '8')
  check(i8 && i8.parentKey === '7', 'listIssues: 8 树边修复 parentKey=7')
  const m7 = data.find((x) => String(x.key) === '7')
  check(m7 && m7.type === 'map', 'listIssues: 地图票 #7 type=map（REST labels 推断）')
  const f = await listIssues(repo, { state: 'open', parentKey: '7' }, ctx)
  check(f && f.ok && f.data.length === 2, 'listIssues: 过滤 parentKey=7 得 2 条')
} else {
  console.error('listIssues result:', JSON.stringify(lr))
}

const gr = await getIssue(repo, '414', {}, ctx)
check(gr && gr.ok === true && gr.data && String(gr.data.key) === '414', 'getIssue: GraphQL 失败后 REST 降级成功（got ' + JSON.stringify(gr && gr.error ? gr.error : (gr && gr.data && gr.data.key)) + '）')

if (!process.exitCode) console.log('\nGREEN 全部通过 — GitHub REST 降级（list/get）就绪')
else console.log('\nRED 存在失败项')
