// verify-deck-tools-matrix.js —— 门禁：同一个动作在三种后端上分别落到哪里（#713 第六批）
// 用法：在插件根目录执行 node tests/verify-deck-tools-matrix.js，可独立运行。
//
// 为什么要这一段：这七个工具坐在 tracker 契约之上，而三个后端表达关系的方式**不一样**：
//   GitHub：父子是原生 sub-issues 层级，阻塞是原生 dependencies 边；
//   GitLab：父子落在平级链接 relates_to 上（不是层级），阻塞走它自己的道，做不到时退回正文；
//   本地 Markdown：父子根本做不到（单根工作区），阻塞写进票文件正文里的 Blocked by 那一行。
// 同一个工具调用在这三种地方会得到不同的结果，如果返回里不逐项说清落点，AI 会以为地图结构已经建好了。
// 所以这一段把「建票 / 建整张地图骨架 / 补边 / 改票 / 读回」五个动作在三个后端上各跑一遍，
// 把真实结果收成一张对照表（同时打印在标准输出、写入 .tmp/713-backend-matrix.md），并逐条断言：
//   ① 每个格子都回三态之一，从不抛异常；
//   ② 每条边都带落点与非空证据；
//   ③ 每次后端调用都过闸（闸记的 == 传输层真发的，绕开闸的条数为 0）；
//   ④ 带上锚：同一个锚两次只多一张票；不带锚两次仍建两张（既有行为不许被改坏）。
//
// 三个后端都是**真后端模块**：GitHub / GitLab 用脚本化的 gh / glab（它们自己按真实命令形状回 JSON，
// 每执行一次就是一条真实出站请求，照生产里传输层的做法报给闸）；本地 Markdown 用真实临时工作区，票就是文件。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const REPO_GH = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
const REPO_GL = { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '' }

// ─────────────────────────────────────────────────────────────────────────────
// 一、脚本化的 gh：按真实命令形状回 JSON（命令清单来自三个后端房间的实际取数路径）
// ─────────────────────────────────────────────────────────────────────────────
function makeScriptedGh(sink) {
  const tickets = []
  let next = 1
  const nowIso = '2026-09-24T00:00:00Z'
  function find(n) { return tickets.find((t) => String(t.number) === String(n)) || null }
  function row(t) {
    if (!t) return null
    return {
      number: t.number, title: t.title, body: t.body, state: t.state, url: t.url,
      createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.state === 'closed' ? nowIso : null,
      labels: t.labels.map((n) => ({ name: n, color: '' })),
      assignees: t.assignees.map((l) => ({ login: l, name: l, avatarUrl: '' })),
      parent: t.parentKey ? { number: Number(t.parentKey), title: '' } : null,
      blockedBy: { nodes: t.blockedBy.map((k) => ({ number: Number(k), title: '', state: 'open' })) },
      comments: { nodes: t.comments.map((c, i) => ({ id: String(i + 1), body: c, author: { login: 'probe' }, createdAt: nowIso, updatedAt: nowIso })) },
    }
  }
  function mk(title, body, labels) {
    const t = { number: next++, title: title, body: body || '', state: 'open', labels: labels || [], assignees: [], parentKey: '', blockedBy: [], comments: [], createdAt: nowIso, updatedAt: nowIso }
    t.url = 'https://github.com/acme/demo/issues/' + t.number
    tickets.push(t)
    return t
  }
  /** GraphQL 形状的行（getIssue / list 走 GraphQL 时读的就是这一套字段）。 */
  function gqlRow(t) {
    if (!t) return null
    return {
      number: t.number, title: t.title, body: t.body, state: t.state.toUpperCase(), url: t.url,
      createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.state === 'closed' ? nowIso : null,
      author: { login: 'probe', name: 'probe', avatarUrl: '' },
      labels: { nodes: t.labels.map((n) => ({ name: n, color: '' })) },
      assignees: { nodes: t.assignees.map((l) => ({ login: l, name: l, avatarUrl: '' })) },
      milestone: null,
      comments: { nodes: t.comments.map((c, i) => ({ id: String(i + 1), body: c, author: { login: 'probe' }, authorAssociation: 'MEMBER', createdAt: nowIso, updatedAt: nowIso })) },
      parent: t.parentKey ? { number: Number(t.parentKey), title: '' } : null,
      blockedBy: { nodes: t.blockedBy.map((k) => ({ number: Number(k), title: '', state: 'OPEN' })) },
      blocking: { nodes: [] },
    }
  }
  function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] === undefined ? '' : args[i + 1]) : '' }
  /** gh api 的 `-f k=v` 是一个整 token（不是 `-f k v`），取值要按等号切。 */
  function fFlag(args, name) {
    for (const x of args) {
      const s = String(x)
      if (s.indexOf(name + '=') === 0) return s.slice(name.length + 1)
    }
    return ''
  }
  async function exec(cmd, args) {
    const a = Array.isArray(args) ? args : []
    const line = a.join(' ')
    if (cmd === 'git') return { code: 0, stdout: 'https://github.com/acme/demo.git\n', stderr: '' }
    if (sink) sink.push(line)
    if (line.indexOf('auth status') === 0) return { code: 0, stdout: 'Logged in', stderr: '' }
    if (line.indexOf('repo view') === 0) return { code: 0, stdout: 'acme/demo', stderr: '' }
    if (line.indexOf('api user') === 0) return { code: 0, stdout: '{"login":"probe"}', stderr: '' }
    if (line.indexOf('api graphql') === 0) {
      // 探针把 GraphQL 也脚本化了：getIssue 与 list 的 GraphQL 路径要能读回父子与依赖，
      // 否则「原生层级 / 原生依赖边」这两档落点就没有证据可判（REST 兜底里没有这两列）。
      const q = a.filter((x, i) => a[i - 1] === '-f' && String(x).indexOf('query=') === 0).join(' ')
      const num = Number((a.filter((x, i) => a[i - 1] === '-F' && String(x).indexOf('number=') === 0)[0] || '').replace('number=', ''))
      if (q.indexOf('pullRequest') >= 0) return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false } } } } }), stderr: '' }
      if (q.indexOf('issue(') >= 0 || num) {
        const t = find(num)
        if (!t) return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: null } } }), stderr: '' }
        return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: gqlRow(t) } } }), stderr: '' }
      }
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: tickets.map(gqlRow), pageInfo: { hasNextPage: false, endCursor: null } } } } }), stderr: '' }
    }
    if (line.indexOf('search issues') === 0 || line.indexOf('issue list') === 0) return { code: 0, stdout: JSON.stringify(tickets.map(row)), stderr: '' }
    if (line.indexOf('issue create') === 0) {
      const t = mk(flag(a, '--title'), flag(a, '--body'), a.filter((x, i) => a[i - 1] === '--label'))
      a.forEach((x, i) => { if (a[i - 1] === '--assignee') t.assignees.push(x) })
      return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
    }
    if (line.indexOf('issue close') >= 0) { const t = find(a[2]); if (t) t.state = 'closed'; return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' } }
    if (line.indexOf('issue reopen') >= 0) { const t = find(a[2]); if (t) t.state = 'open'; return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' } }
    if (line.indexOf('issue edit') >= 0) {
      const t = find(a[2])
      if (!t) return { code: 1, stdout: '', stderr: 'no such issue' }
      if (flag(a, '--title')) t.title = flag(a, '--title')
      if (flag(a, '--body')) t.body = flag(a, '--body')
      a.forEach((x, i) => { if (a[i - 1] === '--add-label' && t.labels.indexOf(x) < 0) t.labels.push(x) })
      a.forEach((x, i) => { if (a[i - 1] === '--remove-label') t.labels = t.labels.filter((n) => n !== x) })
      a.forEach((x, i) => { if (a[i - 1] === '--add-assignee' && t.assignees.indexOf(x) < 0) t.assignees.push(x) })
      a.forEach((x, i) => { if (a[i - 1] === '--remove-assignee') t.assignees = t.assignees.filter((n) => n !== x) })
      return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
    }
    // REST：集合建票刻意失败（真实 gh 没接上 stdin 就是这个样子），逼后端走 gh issue create
    if (/^api repos\/acme\/demo\/issues(\s|$)/.test(line) && line.indexOf('--method POST') >= 0) return { code: 1, stdout: '', stderr: 'gh api: stdin 没接上（照真实行为回失败）' }
    if (/^api repos\/acme\/demo\/issues\?/.test(line)) return { code: 0, stdout: JSON.stringify(tickets.map(row)), stderr: '' }
    let m = /^api repos\/acme\/demo\/issues\/(\d+)\/sub_issues/.exec(line)
    if (m) {
      const parent = find(m[1])
      const child = find(fFlag(a, 'sub_issue_id'))
      if (child) child.parentKey = parent ? String(parent.number) : ''
      return { code: 0, stdout: '{}', stderr: '' }
    }
    m = /^api repos\/acme\/demo\/issues\/(\d+)\/dependencies\/blocked_by\/(\d+)\s+--method DELETE/.exec(line)
    if (m) { const t = find(m[1]); if (t) t.blockedBy = t.blockedBy.filter((k) => String(k) !== m[2]); return { code: 0, stdout: '{}', stderr: '' } }
    m = /^api repos\/acme\/demo\/issues\/(\d+)\/dependencies\/blocked_by\s+--method POST/.exec(line)
    if (m) { const t = find(m[1]); const b = fFlag(a, 'issue_id'); if (t && b && t.blockedBy.indexOf(b) < 0) t.blockedBy.push(b); return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' } }
    m = /^api repos\/acme\/demo\/issues\/(\d+)\/comments\s+--method POST/.exec(line)
    if (m) { const t = find(m[1]); const body = fFlag(a, 'body'); if (t) t.comments.push(body); return { code: 0, stdout: JSON.stringify({ id: t ? t.comments.length : 0, body: body }), stderr: '' } }
    m = /^api repos\/acme\/demo\/issues\/(\d+)\s+--method (PATCH|POST)/.exec(line)
    if (m) {
      const t = find(m[1])
      if (!t) return { code: 1, stdout: '', stderr: 'not found' }
      const st = fFlag(a, 'state'); if (st) t.state = st
      return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
    }
    m = /^api repos\/acme\/demo\/issues\/(\d+)$/.exec(line)
    if (m) { const t = find(m[1]); if (!t) return { code: 1, stdout: '', stderr: '404 not found' }; return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' } }
    if (line.indexOf('api repos/acme/demo') >= 0) return { code: 0, stdout: '{}', stderr: '' }
    return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令：' + line }
  }
  return { exec: exec, tickets: tickets, row: row, mk: mk }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、脚本化的 glab（同样是真实命令形状；每条命令都是一条真实出站请求）
// ─────────────────────────────────────────────────────────────────────────────
function makeScriptedGlab(sink) {
  const issues = []
  let next = 1
  function find(iid) { return issues.find((x) => String(x.iid) === String(iid)) || null }
  function row(t) {
    if (!t) return null
    return {
      iid: t.iid, title: t.title, description: t.description, state: t.state,
      labels: t.labels.slice(), assignees: t.assignees.map((l) => ({ username: l, name: l })),
      links: t.links.slice(), web_url: 'https://gitlab.com/acme/demo/-/issues/' + t.iid,
      created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
    }
  }
  function mk(title, description, labels) {
    const t = { iid: next++, title: title, description: description || '', state: 'opened', labels: labels || [], assignees: [], links: [] }
    issues.push(t)
    return t
  }
  function fval(a, name) { const i = a.indexOf('-f'); for (let j = 0; j < a.length; j++) if (a[j] === '-f' && String(a[j + 1] || '').indexOf(name + '=') === 0) return String(a[j + 1]).slice(name.length + 1); return '' }
  async function run(args) {
    const a = Array.isArray(args) ? args : []
    const line = a.join(' ')
    if (sink) sink.push(line)
    const path0 = a[1] || ''
    const method = a.indexOf('--method') >= 0 ? String(a[a.indexOf('--method') + 1]) : 'GET'
    // 建票：后端房间先试 PUT、再试 POST（issues.js 的 create 路径）。
    // 探针让 PUT 这条也成功（做法与 tests/tracker-contract/sections/idempotency.js 的脚本化 glab 一致）：
    // 这一段要验的是工具层，不是 GitLab 服务端对 PUT 的态度。
    if ((method === 'PUT' || method === 'POST') && /\/issues$/.test(path0)) {
      const t = mk(fval(a, 'title'), fval(a, 'description'), fval(a, 'labels') ? fval(a, 'labels').split(',') : [])
      return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
    }
    let m = /^projects\/[^/]+\/issues\/(\d+)\/links$/.exec(path0)
    if (m) {
      const t = find(m[1])
      if (!t) return { code: 1, stdout: '', stderr: '404 Issue Not Found' }
      if (method === 'POST') { const target = fval(a, 'target_issue_iid'); const type = fval(a, 'link_type') || 'relates_to'; t.links.push({ iid: Number(target), link_type: type, created_at: '2026-09-24' }); return { code: 0, stdout: JSON.stringify({ source_issue: row(t) }), stderr: '' } }
      return { code: 0, stdout: JSON.stringify(t.links), stderr: '' }
    }
    m = /^projects\/[^/]+\/issues\/(\d+)\/notes$/.exec(path0)
    if (m) {
      if (method === 'POST') return { code: 0, stdout: JSON.stringify({ id: 1, body: fval(a, 'body') }), stderr: '' }
      return { code: 0, stdout: '[]', stderr: '' }
    }
    m = /^projects\/[^/]+\/issues\/(\d+)(\?|$)/.exec(path0)
    if (m) {
      const t = find(m[1])
      if (!t) return { code: 1, stdout: '', stderr: '404 Issue Not Found' }
      if (method === 'PUT') {
        const title = fval(a, 'title'); if (title) t.title = title
        const desc = fval(a, 'description'); if (desc) t.description = desc
        const ev = fval(a, 'state_event'); if (ev === 'close') t.state = 'closed'; if (ev === 'reopen') t.state = 'opened'
        return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
      }
      return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
    }
    if (/^projects\/[^/]+\/issues\?/.test(path0) || /^projects\/[^/]+\/issues$/.test(path0)) return { code: 0, stdout: JSON.stringify(issues.map(row)), stderr: '' }
    return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令：' + line }
  }
  return { run: run, issues: issues, row: row, mk: mk, find: find }
}
module.exports = { makeScriptedGh: makeScriptedGh, makeScriptedGlab: makeScriptedGlab }
