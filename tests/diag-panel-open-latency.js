// tests/diag-panel-open-latency.js
//
// 用途（一次性诊断，不是门禁）：量出「右侧面板打开/刷新」这条链上，每一趟外部命令要花多久、
// 一趟要走几次网络往返。用来回答「面板为什么要 5 秒以上才出内容」。
//
// 为什么这么量：真机上把时钟打进了日志，能看出哪些调用慢，看不出慢在哪一步。
//   这个脚本把源码里实际会敲的 gh 命令原样拿出来跑，逐步计时，于是「页数 × 每页往返」这个
//   成本结构直接可见，不依赖读代码猜。
//
// 直接跑：node tests/diag-panel-open-latency.js [owner/repo]
//   不带参数用本仓库（FeatherHunter/dsh-mattpocock-skills-deck），即用户在开发的那个工作区。

const { execFileSync } = require('child_process')

const REPO = process.argv[2] || 'FeatherHunter/dsh-mattpocock-skills-deck'
const CWD = __dirname

function time(label, argv) {
  const t0 = Date.now()
  let out = ''
  let failed = null
  try {
    out = execFileSync('gh', argv, { cwd: CWD, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    failed = e.message.split('\n')[0]
    out = (e.stdout || '') + ''
  }
  const ms = Date.now() - t0
  const lines = out.split('\n').filter(function (s) { return s.trim() })
  return { label, ms, lines: lines.length, failed }
}

function report(r) {
  console.log('  ' + r.label.padEnd(46) + String(r.ms).padStart(7) + ' ms   items=' + String(r.lines).padStart(4) + (r.failed ? '  FAILED' : ''))
  return r.ms
}

;(function main() {
  console.log('=== 面板打开链路逐步计时 · repo=' + REPO + ' ===\n')

  // 步骤 1：新鲜度校验（src/host/issueList.js fetchIssueIndex）
  //   命令原样取自 issueList.js:166 —— 这就是高频那条「变了吗」检查。
  console.log('[1] 新鲜度校验 fetchIssueIndex —— 每次校验都要把全仓库 issue 扫一遍')
  const idx = report(time('gh api --paginate issues?state=all&per_page=100', [
    'api', '--paginate', 'repos/' + REPO + '/issues?state=all&per_page=100',
    '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}',
  ]))

  // 步骤 2：同样的校验，但只看未关闭的票。用来证明「成本由页数决定，与数据量无关」。
  console.log('\n[2] 同一份数据只要未关闭的 —— 页数降下来后应当快到不成比例')
  const open = report(time('gh api --paginate issues?state=open&per_page=100', [
    'api', '--paginate', 'repos/' + REPO + '/issues?state=open&per_page=100',
    '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}',
  ]))

  // 步骤 3：单页一次往返要多久 —— 用来算「页数 × 往返」这条乘法
  console.log('\n[3] 单页一次往返的基线')
  const pages = []
  for (let p = 1; p <= 6; p++) {
    pages.push(time('  page ' + p + '. 单页', [
      'api', 'repos/' + REPO + '/issues?state=all&per_page=100&page=' + p,
      '--jq', '.[] | select(.pull_request == null) | .number',
    ]))
  }
  let pageSum = 0
  pages.forEach(function (p) { pageSum += report({ label: p.label.trim(), ms: p.ms, lines: p.lines, failed: p.failed }) })
  const nonEmpty = pages.filter(function (p) { return p.lines > 0 })
  const avg = nonEmpty.length ? Math.round(pageSum / nonEmpty.length) : 0

  // 步骤 4：面板列表真正用的那份数据（fetchIssues / fetchAllIssuesREST）
  console.log('\n[4] 面板列表数据 —— 带标题、标签、认领人、头像的整份拉取')
  const full = report(time('gh api --paginate issues（含全部字段）', [
    'api', '--paginate', 'repos/' + REPO + '/issues?state=all&per_page=100',
    '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}',
  ]))

  // 步骤 5：地图列表（fetchMaps，issueList.js:12 原样）
  console.log('\n[5] 地图列表 fetchMaps')
  const maps = report(time('gh issue list --label wayfinder:map', [
    'issue', 'list', '--state', 'open', '--label', 'wayfinder:map', '--repo', REPO,
    '--json', 'number,title,body,labels,assignees,state,updatedAt',
  ]))

  console.log('\n=== 成本结构 ===')
  console.log('  单页平均往返：        ' + avg + ' ms')
  console.log('  新鲜度校验实际页数：  ' + nonEmpty.length + ' 页  →  ' + idx + ' ms（实测）')
  console.log('  未关闭票的校验：      ' + open + ' ms  →  省下 ' + Math.max(0, idx - open) + ' ms')
  console.log('  列表整份拉取：        ' + full + ' ms  （' + nonEmpty.length + ' 页 × ' + avg + ' ms ≈ ' + (nonEmpty.length * avg) + ' ms）')
  console.log('  地图列表：            ' + maps + ' ms')
  console.log('')
  console.log('  结论：一趟外部命令的耗时 ≈ 页数 × 单页往返。数据本身只有几百 KB，')
  console.log('        慢的是「一页一页串起来问」这个动作的次数，不是读了多少字节。')
})()

module.exports = {}
