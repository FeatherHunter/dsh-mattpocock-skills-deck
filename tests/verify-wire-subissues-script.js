/*
 * tests/verify-wire-subissues-script.js —— #572 子议题关联脚本门禁（命令行黑盒）
 * 用法: node tests/verify-wire-subissues-script.js（在插件根目录；不联网、不碰真票）
 *
 * 测什么（契约 #576 定的测试缝：只测最高的一道——脚本命令行黑盒，参数进、回包加退出码出）：
 *   1) 正常补齐：地图正文写回并读回校验 + 子票挂成原生子议题 + 阻塞声明升格成原生阻塞边，命令序列逐条钉死；
 *   2) 已是目标状态：直接返回 changed:[]，一个请求都不发（连校验用的重复读也不发）；
 *   3) 重复跑一致：第一次有改动，第二次零写请求；
 *   4) 演练：不联网、不写，回包带将要写入的正文与将要执行的命令数组；
 *   5) 数量对不上：非零退出、不吞错、失败评论落在缺边的那张子票下；
 *   6) 失败自动重试一次，第二次成功要在人话里说明；
 *   7) 两次都失败：退出码 1 + 固定格式失败评论（脚本名、参数、失败原因）；连评论也失败时 commented=false；
 *   8) 阻塞声明只认正文第一处有内容的行；正文别处的声明只告警不建边；
 *   9) 原生旗明确不可用时才回退裸接口（子议题边与阻塞边各一条），且裸接口用 -F 传数据库编号；
 *  10) 降级：原生阻塞边明确不支持时写子票正文首部文字行，ok=true 但 edge=false，warnings 说明；
 *  11) 不删既有边、不清理历史文字行；
 *  12) 参数与输入校验：缺参/格式错/正文不像地图正文（四种绕过）/自挂/不存在票/改挂/票号 0：退出码 2；
 *  13) 非 GitHub 后端（Markdown / GitLab / 没有主锚）：退出码 2 并指明正确做法；
 *  14) 计数口径：--children 去重、地图含名单外子票时 actual 的口径、地图总数进 warnings、>100 张要翻页；
 *  15) 回包字段集合与类型与姊妹脚本 scripts/fix-issue-body.mjs 同形；
 *  16) 本门禁已接进 npm run verify 链，且紧跟姊妹门禁之后；
 *  17) 失败分支全覆盖：读地图正文/读子议题列表/读子票/读现有阻塞边/写地图正文/写回不一致/挂子议题边/
 *      建阻塞边/校验读回/降级写文字行 各失败一次，退出码、评论落点、commented 都对；
 *  18) 泄密：失败评论、stderr、回包 error 里不出现本地绝对路径，反引号不会把行内代码截断；
 *  19) --repo 的 happy path：issue 命令带 --repo，api 路径带 owner/name。
 *
 * 假 gh：一个 .mjs，用 DSH_GH_PATH 指过去；它记录每次调用的 argv，并用一份 JSON 状态文件模拟 GitHub。
 * 假 gh 刻意贴真 gh：未知票报错（不是返回空正文）、拒绝自挂与改挂、拒绝重复边、按 per_page 截断、
 * 正文按服务端规则归一化（CRLF→LF）。可用 FAKE_GH_FAIL_AT / FAKE_GH_* 开关切换失败与不支持。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'wire-subissues.mjs')
const SIBLING_SCRIPT = path.join(ROOT, 'scripts', 'fix-issue-body.mjs')
const SCRIPT_NAME = 'scripts/wire-subissues.mjs'

let failed = false
const check = function (ok, msg) {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ——— 临时工作区：一个带主锚文件的小目录，脚本认后端就读这里 ———
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-wire-subissues-'))
const wsGithub = path.join(TMP, 'ws-github')
const wsMarkdown = path.join(TMP, 'ws-markdown')
const wsGitlab = path.join(TMP, 'ws-gitlab')
const wsNoDoc = path.join(TMP, 'ws-nodoc')
function writeTrackerDoc(dir, title) {
  fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
  if (title) fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), title + '\n', 'utf8')
}
writeTrackerDoc(wsGithub, '# Issue tracker: GitHub')
writeTrackerDoc(wsMarkdown, '# Issue tracker: Markdown')
writeTrackerDoc(wsGitlab, '# Issue tracker: GitLab')
fs.mkdirSync(wsNoDoc, { recursive: true })

// ——— 正文夹具 ———
const MAP_BODY = '## Destination\n\n把子票挂到地图下，并补齐原生阻塞边。\n\n## Notes\n\n- 首批只做 GitHub。\n\n## 计划\n\n1. 做 #571。\n'
const MAP_BODY_STALE = '## Destination\n\n这是地图上的旧正文，和文件不一样。\n\n## Notes\n\n- 旧的。\n'
const CHILD_PLAIN = '## Question\n\n这张票没有阻塞声明。\n'
const CHILD_BLOCKED = 'Blocked by: #570\n\n## Question\n\n这张票被 #570 挡着。\n'
// 声明行不在正文首部（用来验证降级时会把文字行补写到首部）
const CHILD_BLOCKED_LATE = '## Question\n\n这张票被 #570 挡着。\n\nBlocked by: #570\n'
// 正文别处（历史小节）的声明（用来验证只告警不建边）
const CHILD_HISTORY = '## Question\n\n这张票没有首行声明。\n\n## 历史\n\nBlocked by: #999（后来解除了）\n'

let fixtureSeq = 0
function writeFixture(text) {
  const p = path.join(TMP, 'fixture-' + (++fixtureSeq) + '.md')
  fs.writeFileSync(p, text, 'utf8')
  return p
}
const mapFixture = writeFixture(MAP_BODY)

// ——— 假 gh（刻意贴真 gh） ———
const fakeGh = path.join(TMP, 'fake-gh.mjs')
const fakeLog = path.join(TMP, 'fake-gh.log')
const fakeState = path.join(TMP, 'fake-gh-state.json')
const FAKE_GH_SRC = [
  "import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const STATE = process.env.FAKE_GH_STATE",
  "const LOG = process.env.FAKE_GH_LOG",
  "function load() { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch (e) { return { issues: [], subIssues: {}, blockedBy: {}, bodies: {}, dbIds: {}, comments: [] } } }",
  "function save(s) { writeFileSync(STATE, JSON.stringify(s), 'utf8') }",
  "function out(t) { process.stdout.write(t) }",
  "function die(msg, code) { process.stderr.write(msg + '\\n'); process.exit(typeof code === 'number' ? code : 1) }",
  "appendFileSync(LOG, JSON.stringify(args) + '\\n')",
  "function logCount() {",
  "  try { const key = JSON.stringify(args); const lines = readFileSync(LOG, 'utf8').split('\\n').filter(Boolean); return lines.filter(function (l) { return l === key }).length } catch (e) { return 1 }",
  "}",
  "function failAt(kind, target) {",
  "  const spec = process.env.FAKE_GH_FAIL_AT || ''",
  "  if (!spec) return",
  "  const occ = logCount()",
  "  const list = spec.split(',').map(function (x) { return x.trim() }).filter(Boolean)",
  "  for (const w of list) {",
  "    const p = w.split(':')",
  "    if (p[0] !== kind || String(p[1]) !== String(target)) continue",
  "    if (p[2] && Number(p[2]) !== occ) continue",
  "    die('HTTP 500: 假 gh 按 FAKE_GH_FAIL_AT=' + w + ' 故意失败')",
  "  }",
  "}",
  "function argAfter(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }",
  "const s = load()",
  "function exists(n) { return s.issues.map(Number).indexOf(Number(n)) >= 0 }",
  "function parentOf(n) { for (const k of Object.keys(s.subIssues)) { if ((s.subIssues[k] || []).map(Number).indexOf(Number(n)) >= 0) return Number(k) } return null }",
  "function dbIdOf(n) { return s.dbIds[n] === undefined ? 1000000 + Number(n) : s.dbIds[n] }",
  "function byDbId(id) { for (const k of Object.keys(s.dbIds)) { if (Number(s.dbIds[k]) === Number(id)) return Number(k) } const n = Number(id) - 1000000; return n > 0 ? n : null }",
  "function mustExist(n) { if (!exists(n)) die('HTTP 404: could not resolve to an Issue (# ' + n + ')') }",
  "function serverNormalize(text) { return String(text).replace(/\\r\\n/g, '\\n').replace(/\\s+$/, '') }",
  "if (args[0] === 'issue' && args[1] === 'view') {",
  "  const n = String(args[2])",
  "  const fields = String(argAfter('--json') || 'body').split(',')",
  "  const o = {}",
  "  if (fields.indexOf('body') >= 0) { failAt('view-body', n); mustExist(n); o.body = s.bodies[n] === undefined ? '' : s.bodies[n] }",
  "  if (fields.indexOf('parent') >= 0) { failAt('view-child', n); mustExist(n); const p = parentOf(n); o.parent = p === null ? null : { number: p } }",
  "  if (fields.indexOf('blockedBy') >= 0) {",
  "    failAt('view-edges', n); mustExist(n)",
  "    const list = s.blockedBy[n] || []",
  "    o.blockedBy = { nodes: list.map(function (x) { return { number: x } }), totalCount: list.length }",
  "  }",
  "  out(JSON.stringify(o)); process.exit(0)",
  "}",
  "if (args[0] === 'issue' && args[1] === 'edit') {",
  "  const n = String(args[2])",
  "  mustExist(n)",
  "  const bodyFile = argAfter('--body-file')",
  "  if (bodyFile) {",
  "    failAt('edit-body', n)",
  "    if (process.env.FAKE_GH_BODY_FAIL === '1') die('HTTP 422: 假 gh 故意让写正文失败')",
  "    if (process.env.FAKE_GH_BODY_SILENT === '1') { save(s); process.exit(0) }",
  "    s.bodies[n] = serverNormalize(readFileSync(bodyFile, 'utf8'))",
  "  }",
  "  const parent = argAfter('--parent')",
  "  if (parent) {",
  "    failAt('edit-parent', n)",
  "    if (process.env.FAKE_GH_PARENT_FLAG_BROKEN === '1') die('unknown flag: --parent')",
  "    if (process.env.FAKE_GH_PARENT_FAIL === n) die('HTTP 500: 假 gh 故意让 --parent 失败')",
  "    if (Number(parent) === Number(n)) die('HTTP 422: cannot add an issue as its own sub-issue')",
  "    const cur = parentOf(n)",
  "    if (cur !== null && cur !== Number(parent)) die('HTTP 422: #' + n + ' is already a sub-issue of #' + cur)",
  "    if (process.env.FAKE_GH_PARENT_SILENT === n) { save(s); process.exit(0) }",
  "    if (!s.subIssues[parent]) s.subIssues[parent] = []",
  "    if (s.subIssues[parent].map(Number).indexOf(Number(n)) < 0) s.subIssues[parent].push(Number(n))",
  "  }",
  "  const blockedBy = argAfter('--add-blocked-by')",
  "  if (blockedBy) {",
  "    failAt('edit-block', n)",
  "    if (process.env.FAKE_GH_BLOCK_FLAG_BROKEN === '1') die('unknown flag: --add-blocked-by')",
  "    if (process.env.FAKE_GH_UNSUPPORTED === '1') die('sub_issues not supported on this server')",
  "    if (process.env.FAKE_GH_BLOCK_FAIL === n) die('HTTP 500: 假 gh 故意让 --add-blocked-by 失败')",
  "    mustExist(blockedBy)",
  "    if (!s.blockedBy[n]) s.blockedBy[n] = []",
  "    if (s.blockedBy[n].map(Number).indexOf(Number(blockedBy)) >= 0) die('HTTP 422: #' + n + ' is already blocked by #' + blockedBy)",
  "    s.blockedBy[n].push(Number(blockedBy))",
  "  }",
  "  save(s); process.exit(0)",
  "}",
  "if (args[0] === 'issue' && args[1] === 'comment') {",
  "  const n = String(args[2])",
  "  failAt('comment', n)",
  "  if (process.env.FAKE_GH_COMMENT_FAIL === '1') die('HTTP 403: 假 gh 故意让评论失败')",
  "  mustExist(n)",
  "  s.comments.push({ issue: n, body: readFileSync(argAfter('--body-file'), 'utf8') })",
  "  save(s); process.exit(0)",
  "}",
  "if (args[0] === 'api') {",
  "  const p = String(args[1])",
  "  const method = argAfter('--method') || 'GET'",
  "  function typedField() { const i = args.indexOf('-F'); return i >= 0 ? String(args[i + 1]) : '' }",
  "  let m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)\\/sub_issues(\\?.*)?$/)",
  "  if (m) {",
  "    const map = m[1]",
  "    if (method === 'POST') {",
  "      failAt('api-sub', map)",
  "      if (process.env.FAKE_GH_API_PARENT_FAIL === '1') die('HTTP 500: 假 gh 故意让裸接口建子议题边失败')",
  "      const child = byDbId(typedField().split('=')[1])",
  "      if (!child || !exists(child)) die('HTTP 422: 假 gh 不认识 sub_issue_id')",
  "      if (Number(child) === Number(map)) die('HTTP 422: cannot add an issue as its own sub-issue')",
  "      const cur = parentOf(child)",
  "      if (cur !== null && cur !== Number(map)) die('HTTP 422: #' + child + ' is already a sub-issue of #' + cur)",
  "      if (!s.subIssues[map]) s.subIssues[map] = []",
  "      if (s.subIssues[map].map(Number).indexOf(Number(child)) < 0) s.subIssues[map].push(Number(child))",
  "      save(s); out('{}'); process.exit(0)",
  "    }",
  "    failAt('list', map)",
  "    const q = (p.split('?')[1] || '')",
  "    const perPage = Number((q.match(/per_page=(\\d+)/) || [])[1] || 30)",
  "    let list = (s.subIssues[map] || []).map(Number)",
  "    if (args.indexOf('--paginate') < 0) list = list.slice(0, perPage)",
  "    if (String(argAfter('--jq') || '') === '.[].number') { out(list.join('\\n')); process.exit(0) }",
  "    out(JSON.stringify(list.map(function (x) { return { number: x } }))); process.exit(0)",
  "  }",
  "  m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)\\/dependencies\\/blocked_by$/)",
  "  if (m && method === 'POST') {",
  "    const child = m[1]",
  "    failAt('api-dep', child)",
  "    if (process.env.FAKE_GH_UNSUPPORTED === '1') die('dependencies not supported on this server')",
  "    if (process.env.FAKE_GH_BLOCK_404 === '1') die('HTTP 404: Not Found')",
  "    if (process.env.FAKE_GH_BLOCK_API_FAIL === '1') die('HTTP 500: 假 gh 故意让依赖接口失败')",
  "    const blocker = byDbId(typedField().split('=')[1])",
  "    if (!blocker || !exists(blocker)) die('HTTP 422: 假 gh 不认识 issue_id')",
  "    if (!s.blockedBy[child]) s.blockedBy[child] = []",
  "    if (s.blockedBy[child].map(Number).indexOf(Number(blocker)) >= 0) die('HTTP 422: #' + child + ' is already blocked by #' + blocker)",
  "    s.blockedBy[child].push(Number(blocker))",
  "    save(s); out('{}'); process.exit(0)",
  "  }",
  "  m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)$/)",
  "  if (m) {",
  "    const n = m[1]",
  "    failAt('api-issue', n)",
  "    mustExist(n)",
  "    const id = dbIdOf(n)",
  "    if (String(argAfter('--jq') || '').trim() === '.id') { out(String(id)); process.exit(0) }",
  "    out(JSON.stringify({ id: id, number: Number(n) })); process.exit(0)",
  "  }",
  "  die('假 gh 不认识的 api 路径：' + p)",
  "}",
  "die('假 gh 不认识的命令：' + args.join(' '))",
].join('\n')
fs.writeFileSync(fakeGh, FAKE_GH_SRC, 'utf8')

function stateFor(spec) {
  const s = spec || {}
  const subIssues = s.subIssues || {}
  const blockedBy = s.blockedBy || {}
  const bodies = s.bodies || {}
  const dbIds = s.dbIds || {}
  const set = new Set()
  const add = function (v) { if (Number.isFinite(Number(v))) set.add(Number(v)) }
  add(s.map === undefined ? 567 : s.map)
  ;(s.issues || []).forEach(add)
  Object.keys(subIssues).forEach(function (k) { add(k); (subIssues[k] || []).forEach(add) })
  Object.keys(blockedBy).forEach(function (k) { add(k); (blockedBy[k] || []).forEach(add) })
  Object.keys(bodies).forEach(function (k) {
    add(k)
    // 正文里提到 #n 就说明这张票存在（贴真 gh：不存在的票读不出来）
    const t = String(bodies[k] || '')
    const re = /#(\d+)/g
    let mm
    while ((mm = re.exec(t)) !== null) add(mm[1])
  })
  Object.keys(dbIds).forEach(add)
  return { issues: Array.from(set), subIssues: subIssues, blockedBy: blockedBy, bodies: bodies, dbIds: dbIds, comments: [] }
}
function resetFake(state) {
  fs.writeFileSync(fakeState, JSON.stringify(state), 'utf8')
  fs.writeFileSync(fakeLog, '', 'utf8')
}
function readFake() { return JSON.parse(fs.readFileSync(fakeState, 'utf8')) }
function argvLog() {
  return String(fs.readFileSync(fakeLog, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(function (l) { return JSON.parse(l) })
}
function countCmd(tokens) {
  return argvLog().filter(function (a) { return tokens.every(function (t, i) { return a[i] === t }) }).length
}
function isWrite(a) {
  if (a[0] === 'issue' && a[1] === 'edit') return true
  if (a[0] === 'issue' && a[1] === 'comment') return true
  if (a[0] === 'api' && a.indexOf('--method') >= 0 && a[a.indexOf('--method') + 1] === 'POST') return true
  return false
}
/** 把一条命令压成可读的标签，用来钉死整条命令序列。 */
function shapeOf(a) {
  if (a[0] === 'issue' && a[1] === 'view') {
    const n = a[2]
    const jf = a.indexOf('--json')
    const f = jf >= 0 ? a[jf + 1] : ''
    if (f === 'body') return 'view-body:' + n
    if (f === 'body,parent') return 'view-child:' + n
    if (f === 'blockedBy') return 'view-edges:' + n
    return 'view-other:' + n + ':' + f
  }
  if (a[0] === 'issue' && a[1] === 'edit') {
    const n = a[2]
    if (a.indexOf('--body-file') >= 0) return 'edit-body:' + n
    const pi = a.indexOf('--parent'); if (pi >= 0) return 'edit-parent:' + n + ':' + a[pi + 1]
    const bi = a.indexOf('--add-blocked-by'); if (bi >= 0) return 'edit-block:' + n + ':' + a[bi + 1]
    return 'edit-other:' + n
  }
  if (a[0] === 'issue' && a[1] === 'comment') return 'comment:' + a[2]
  if (a[0] === 'api') {
    const p = a[1]
    const method = a.indexOf('--method') >= 0 ? a[a.indexOf('--method') + 1] : 'GET'
    if (/\/sub_issues(\?.*)?$/.test(p)) return method === 'POST' ? 'api-sub-post' : 'api-sub-list:' + (a.indexOf('--paginate') >= 0 ? 'paginate' : 'nopaginate')
    if (/\/dependencies\/blocked_by$/.test(p)) return 'api-dep-post'
    if (/\/issues\/\d+$/.test(p)) return 'api-issue-id'
    return 'api-other:' + p
  }
  return 'other:' + a.join(' ')
}
function shapes() { return argvLog().map(shapeOf) }
function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

function runScript(args, cwd, extraEnv) {
  const res = spawnSync(process.execPath, [SCRIPT].concat(args), {
    cwd: cwd || wsGithub,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: Object.assign({}, process.env, { DSH_GH_PATH: fakeGh, FAKE_GH_LOG: fakeLog, FAKE_GH_STATE: fakeState }, extraEnv || {}),
  })
  let json = null
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  try { json = JSON.parse(line) } catch (e) { json = null }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', json: json }
}

function runSibling(args, cwd) {
  const res = spawnSync(process.execPath, [SIBLING_SCRIPT].concat(args), {
    cwd: cwd || wsGithub, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })
  let json = null
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  try { json = JSON.parse(line) } catch (e) { json = null }
  return { status: res.status, json: json }
}

/** 常见的「地图已满、正文已一致」状态：用来测幂等。 */
function targetState(over) {
  return stateFor(Object.assign({
    map: 567,
    subIssues: { '567': [571, 572] },
    blockedBy: { '572': [570] },
    bodies: { '567': MAP_BODY, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
  }, over || {}))
}

console.log('子议题关联脚本门禁（#572 · 命令行黑盒）')

// ——— 1) 正常补齐：正文写回 + 读回校验 + 子议题边 + 阻塞边，命令序列钉死 ———
{
  resetFake(stateFor({
    map: 567,
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '1.1 正常补齐：退出码 0 且 ok=true')
  check(r.json && r.json.expected === 2 && r.json.actual === 2, '1.2 expected=2 / actual=2')
  check(r.json && r.json.edge === true, '1.3 edge=true（子议题边与声明的阻塞边都到位）')
  check(r.json && sameList(r.json.changed, [
    '#567 正文：按文件内容写回',
    '#571 已挂到 #567 下',
    '#572 已挂到 #567 下',
    '#572 新增原生阻塞边：#570',
  ]), '1.4 changed 逐条对得上（正文、两张子票、一条阻塞边）')
  const expect = [
    'view-body:567', 'api-sub-list:paginate',
    'view-child:571', 'view-edges:571', 'view-child:572', 'view-edges:572',
    'edit-body:567', 'view-body:567',
    'edit-parent:571:567', 'edit-parent:572:567',
    'edit-block:572:570',
    'api-sub-list:paginate', 'view-edges:572',
  ]
  check(sameList(shapes(), expect), '1.5 命令序列与预期逐条相同（先读、写、读回校验、再读回核对）：' + shapes().join(' → '))
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/567/sub_issues', '--method', 'POST']) === 0, '1.6 原生旗可用时不发裸接口')
  const st = readFake()
  check((st.subIssues['567'] || []).slice().sort().join(',') === '571,572', '1.7 状态里两张子票都挂上了')
  check((st.blockedBy['572'] || []).indexOf(570) >= 0, '1.8 状态里阻塞边升格成功')
  check(st.bodies['567'] === MAP_BODY.replace(/\s+$/, ''), '1.9 地图正文按文件内容写回')
}

// ——— 2) 已是目标状态：一个请求都不发（含校验用的重复读） ———
{
  resetFake(targetState())
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '2.1 已是目标状态：退出码 0 且 ok=true')
  check(r.json && Array.isArray(r.json.changed) && r.json.changed.length === 0, '2.2 已是目标状态：changed 为空')
  check(r.json && r.json.edge === true && r.json.expected === 2 && r.json.actual === 2, '2.3 已是目标状态：edge/expected/actual 仍然如实')
  check(argvLog().filter(isWrite).length === 0, '2.4 已是目标状态：不再发任何写请求（可重复跑）')
  check(sameList(shapes(), ['view-body:567', 'api-sub-list:paginate', 'view-child:571', 'view-edges:571', 'view-child:572', 'view-edges:572']),
    '2.5 已是目标状态：只发这 6 次读，连校验用的重复读都不发：' + shapes().join(' → '))
}

// ——— 3) 重复跑一致：第一次有改动，第二次零写请求 ———
{
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN } }))
  const args = ['--map', '567', '--children', '571', '--body-file', mapFixture]
  const first = runScript(args)
  check(first.status === 0 && first.json.changed.length > 0, '3.1 第一次跑有改动')
  fs.writeFileSync(fakeLog, '', 'utf8')
  const second = runScript(args)
  check(second.status === 0 && second.json.changed.length === 0, '3.2 第二次跑 changed 为空')
  check(argvLog().filter(isWrite).length === 0, '3.3 第二次跑零写请求')
}

// ——— 4) 演练：不联网、不写 ———
{
  resetFake(stateFor({
    map: 567,
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture, '--dry-run'])
  check(r.status === 0 && r.json && r.json.dryRun === true && r.json.ok === true, '4.1 演练：退出码 0、dryRun=true、ok=true')
  check(r.json && r.json.body === MAP_BODY, '4.2 演练回包带将要写入的地图正文')
  check(r.json && sameList(r.json.command, [
    ['gh', 'issue', 'edit', '567', '--body-file', '<临时文件，演练时未创建>'],
    ['gh', 'issue', 'edit', '571', '--parent', '567'],
    ['gh', 'issue', 'edit', '572', '--parent', '567'],
  ]), '4.3 演练回包的命令逐条对得上（正文写回 + 两张子票挂父）')
  check(argvLog().length === 0, '4.4 演练一个 gh 请求都不发（不联网）')
  check(r.json && r.json.edge === null && r.json.actual === null, '4.5 演练不联网时 edge/actual 是 null（未取）')
  check(r.json && (r.json.warnings || []).join(' ').indexOf('列不出') >= 0, '4.6 warnings 说明演练列不出阻塞边（阻塞边要联网读子票正文）')
  check(readFake().bodies['567'] === MAP_BODY_STALE, '4.7 演练不改任何东西')
}

// ——— 5) 数量对不上：非零退出、不吞错、失败评论落在缺边的那张子票下 ———
{
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN, '572': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_SILENT: '572' })
  check(r.status === 1 && r.json && r.json.ok === false, '5.1 数量对不上：退出码 1 且 ok=false')
  check(r.json && r.json.expected === 2 && r.json.actual === 1, '5.2 expected=2 / actual=1')
  check(countCmd(['issue', 'edit', '572', '--parent', '567']) === 1, '5.3 建边命令自己返回成功时不重试')
  check(r.json && r.json.commented === true, '5.4 数量对不上时留了失败评论')
  const st = readFake()
  check(st.comments.length === 1 && st.comments[0].issue === '572', '5.5 评论落在缺边的那张子票下（不是地图下）')
}

// ——— 6) 失败自动重试一次，第二次成功要说明 ———
{
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_FAIL_AT: 'edit-parent:571:1' })
  check(r.status === 0 && r.json && r.json.ok === true, '6.1 重试一次后成功：退出码 0 且 ok=true')
  check(countCmd(['issue', 'edit', '571', '--parent', '567']) === 2, '6.2 同一建边命令调了 2 次（重试一次）')
  check(r.stderr.indexOf('重试一次后成功') >= 0, '6.3 人话里说明「重试一次后成功」')
}

// ——— 7) 两次都失败：退出码 1 + 固定格式失败评论（且不泄本地绝对路径） ———
{
  const weirdName = 'weird`name$(x).md'
  const weirdPath = path.join(TMP, 'deep-dir', weirdName)
  fs.mkdirSync(path.dirname(weirdPath), { recursive: true })
  fs.writeFileSync(weirdPath, MAP_BODY, 'utf8')

  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', weirdPath], wsGithub,
    { FAKE_GH_PARENT_FAIL: '571', FAKE_GH_API_PARENT_FAIL: '1' })
  check(r.status === 1 && r.json && r.json.ok === false && r.json.commented === true, '7.1 两次都失败：退出码 1 且留了评论')
  const st = readFake()
  const c = st.comments[0] || { issue: '', body: '' }
  check(c.issue === '571', '7.2 评论落在失败的那张子票下')
  check(c.body.indexOf('<!-- 失败留痕：' + SCRIPT_NAME + ' -->') === 0, '7.3 评论首行是固定格式的失败留痕锚')
  check(c.body.indexOf(SCRIPT_NAME) >= 0, '7.4 评论里带脚本名')
  check(c.body.indexOf('--map 567 --children 571 --body-file') >= 0, '7.5 评论里带参数')
  check(c.body.indexOf('HTTP 500: 假 gh 故意让裸接口建子议题边失败') >= 0, '7.6 评论里带失败原因原文')
  check(c.body.indexOf(weirdName) >= 0, '7.7 评论里只写正文文件名（' + weirdName + '）')
  check(c.body.indexOf(TMP) < 0 && c.body.indexOf(path.dirname(weirdPath)) < 0, '7.8 评论里不出现本地绝对路径')
  check(c.body.indexOf('``--map 567') >= 0 && c.body.indexOf('weird`name$(x).md``') >= 0, '7.9 文件名里的反引号不会把行内代码截断（改用双反引号定界）')
  check(r.stderr.indexOf(TMP) < 0 && String(r.json.error || '').indexOf(TMP) < 0, '7.10 stderr 与回包 error 里也不出现本地绝对路径')

  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const r2 = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub,
    { FAKE_GH_PARENT_FAIL: '571', FAKE_GH_API_PARENT_FAIL: '1', FAKE_GH_COMMENT_FAIL: '1' })
  check(r2.status === 1 && r2.json && r2.json.commented === false, '7.11 连评论也留不上：commented=false 且仍非零退出')
}

// ——— 8) 阻塞声明升格：用原生旗，一次一条 ———
{
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [573] },
    bodies: { '567': MAP_BODY, '573': 'Blocked by: #571, #572\n\n## Question\n\n被两张票挡着。\n' },
  }))
  const r = runScript(['--map', '567', '--children', '573', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true && r.json.edge === true, '8.1 声明的阻塞边全部升格成功')
  check(countCmd(['issue', 'edit', '573', '--add-blocked-by', '571']) === 1, '8.2 第一条阻塞边用 --add-blocked-by')
  check(countCmd(['issue', 'edit', '573', '--add-blocked-by', '572']) === 1, '8.3 第二条阻塞边用 --add-blocked-by')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/573/dependencies/blocked_by', '--method', 'POST']) === 0, '8.4 原生旗可用时不发裸接口')
  check((readFake().blockedBy['573'] || []).slice().sort().join(',') === '571,572', '8.5 两条边都建上了')
}

// ——— 9) 声明只认正文第一处有内容的行：别处的声明只告警不建边 ———
{
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [574] },
    bodies: { '567': MAP_BODY, '574': CHILD_HISTORY },
  }))
  const r = runScript(['--map', '567', '--children', '574', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '9.1 首行没有声明时照常跑通')
  check(countCmd(['issue', 'edit', '574', '--add-blocked-by', '999']) === 0, '9.2 正文别处的 Blocked by: 不建边')
  check((readFake().blockedBy['574'] || []).length === 0, '9.3 状态里没有多出来的边')
  check(r.json && (r.json.warnings || []).join(' ').indexOf('#999') >= 0, '9.4 warnings 点名正文别处的声明被忽略')

  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [574] },
    bodies: { '567': MAP_BODY, '574': 'Blocked by: #570\n\n## 历史\n\nBlocked by: #999（后来解除了）\n' },
  }))
  const r2 = runScript(['--map', '567', '--children', '574', '--body-file', mapFixture])
  check(countCmd(['issue', 'edit', '574', '--add-blocked-by', '570']) === 1 && countCmd(['issue', 'edit', '574', '--add-blocked-by', '999']) === 0,
    '9.5 首行声明照建、别处声明仍不建')
  check(r2.json && (r2.json.warnings || []).join(' ').indexOf('#999') >= 0, '9.6 仍然告警点出别处的声明')
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [574] },
    bodies: { '567': MAP_BODY, '574': CHILD_BLOCKED_LATE },
  }))
  const r3 = runScript(['--map', '567', '--children', '574', '--body-file', mapFixture])
  check(countCmd(['issue', 'edit', '574', '--add-blocked-by', '570']) === 0, '9.7 声明只在正文尾部（首行不是声明）时也不建边')
  check(r3.json && (r3.json.warnings || []).join(' ').indexOf('#570') >= 0, '9.8 仍然告警点出尾部的声明被忽略')
}

// ——— 10) 原生旗明确不可用时才回退裸接口 ———
{
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_FLAG_BROKEN: '1' })
  check(r.status === 0 && r.json && r.json.ok === true && r.json.actual === 1, '10.1 --parent 旗不可用时仍能挂上（回退裸接口）')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/567/sub_issues', '--method', 'POST', '-F', 'sub_issue_id=1000571']) === 1, '10.2 裸接口建子议题边，且用 -F 传数据库编号')

  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
  }))
  const r2 = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_BLOCK_FLAG_BROKEN: '1' })
  check(r2.status === 0 && r2.json && r2.json.ok === true && r2.json.edge === true, '10.3 --add-blocked-by 旗不可用时仍能建边（回退裸接口）')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/572/dependencies/blocked_by', '--method', 'POST', '-F', 'issue_id=1000570']) === 1, '10.4 裸接口建阻塞边，且用 -F 传数据库编号')
}

// ——— 11) 降级：原生阻塞边明确不支持时，声明的文字行就是终态 ———
{
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
  }))
  const r = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_UNSUPPORTED: '1' })
  check(r.status === 0 && r.json && r.json.ok === true, '11.1 降级成功：退出码 0 且 ok=true')
  check(r.json && r.json.edge === false, '11.2 降级时 edge=false（原生边没建上）')
  check(r.json && (r.json.warnings || []).join(' ').indexOf('不支持原生阻塞边') >= 0, '11.3 warnings 说明降级原因')
  check(r.json && (r.json.changed || []).some(function (c) { return c.indexOf('已降级为文字行') >= 0 }), '11.4 changed 如实记录降级')
  const st = readFake()
  check(String(st.bodies['572']).indexOf('Blocked by: #570') === 0, '11.5 子票正文首部的文字行就是降级终态（声明源与降级目标同一行）')
  check(countCmd(['issue', 'edit', '572', '--body-file']) === 0, '11.6 文字行已在首部就不重复写子票正文（幂等）')

  // 裸接口 404 也按「接口不存在」降级（GONE_RE 分支）
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
  }))
  const r2 = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_BLOCK_FLAG_BROKEN: '1', FAKE_GH_BLOCK_404: '1' })
  check(r2.status === 0 && r2.json && r2.json.ok === true && r2.json.edge === false, '11.7 裸接口 404 时也降级（edge=false、仍 ok）')
  check((r2.json.changed || []).some(function (c) { return c.indexOf('已降级为文字行') >= 0 }), '11.8 404 降级也如实记进 changed')
}

// ——— 12) 不删既有边、不清理历史文字行 ———
{
  resetFake(stateFor({
    map: 567,
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
    blockedBy: { '572': [999] },
  }))
  const r = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '12.1 已有别的阻塞边时照样跑通')
  check(sameList(shapes(), ['view-body:567', 'api-sub-list:paginate', 'view-child:572', 'view-edges:572', 'edit-block:572:570', 'api-sub-list:paginate', 'view-edges:572']),
    '12.2 只补缺的那条边，没有删除类命令、也没有多余的写：' + shapes().join(' → '))
  const st = readFake()
  check((st.blockedBy['572'] || []).slice().sort().join(',') === '570,999', '12.3 既有边保留、缺的边补上')
  check(st.bodies['572'] === CHILD_BLOCKED, '12.4 不写子票正文（不清理历史文字行）')
}

// ——— 13) 参数与输入校验 ———
{
  const body = writeFixture(MAP_BODY)
  fs.writeFileSync(fakeLog, '', 'utf8')
  const cases = [
    { args: ['--children', '571', '--body-file', body], code: 2, needle: '没给 --map', name: '缺 --map' },
    { args: ['--map', 'abc', '--children', '571', '--body-file', body], code: 2, needle: '只接受数字编号', name: '--map 非数字' },
    { args: ['--map', '0', '--children', '571', '--body-file', body], code: 2, needle: '大于 0', name: '--map 是 0' },
    { args: ['--map', '567', '--body-file', body], code: 2, needle: '没给 --children', name: '缺 --children' },
    { args: ['--map', '567', '--children', '571,abc', '--body-file', body], code: 2, needle: '逗号分隔的数字编号', name: '--children 非数字' },
    { args: ['--map', '567', '--children', '571,0', '--body-file', body], code: 2, needle: '大于 0', name: '--children 含 0' },
    { args: ['--map', '567', '--children', '567', '--body-file', body], code: 2, needle: '不能当自己的子票', name: '--children 含地图自己' },
    { args: ['--map', '567', '--children', '571'], code: 2, needle: '没给 --body-file', name: '缺 --body-file' },
    { args: ['--map', '567', '--children', '571', '--body-file', path.join(TMP, '不存在.md')], code: 2, needle: '读不到正文文件', name: '正文文件不存在' },
    { args: ['--map', '567', '--children', '571', '--body-file', body, '--repo', 'not-a-slug'], code: 2, needle: 'owner/name', name: '--repo 格式不对' },
    { args: ['--map', '567', '--children', '571', '--body-file', body, '--unknown-flag'], code: 2, needle: '不认识的参数', name: '不认识的参数' },
  ]
  let ok = 0
  for (const c of cases) {
    const r = runScript(c.args)
    const good = r.status === c.code && r.json && r.json.ok === false && r.stderr.indexOf(c.needle) >= 0
    if (good) ok++
    else check(false, '13.x ' + c.name + '：期望退出码 ' + c.code + ' 且话里含「' + c.needle + '」，实际 exit=' + r.status + ' stderr=' + JSON.stringify(r.stderr.slice(0, 120)))
  }
  check(ok === cases.length, '13.1 参数与输入校验共 ' + cases.length + ' 条全部退出 2 并说清（实际 ' + ok + '）')
  check(argvLog().length === 0, '13.2 参数错误时一个 gh 请求都不发（命令根本没执行）')
}

// ——— 14) 正文文件不像地图正文：各条绕过都要退出 2；正例要放行 ———
{
  fs.writeFileSync(fakeLog, '', 'utf8')
  const bypass = [
    { name: '围栏里引用地图格式', text: '## Question\n\n```\n## Destination\n\n示例\n```\n', needle: '## Destination' },
    { name: '子票自己有一节 Destination（首行不是）', text: '## Question\n\n正文一段。\n\n## Destination\n\n抄来的\n', needle: '## Destination' },
    { name: '字面 \\n 转义被归一化造出该行', text: '## Question\\n\\n## Destination\\n', needle: '## Destination' },
    { name: '普通子票正文', text: '## Question\n\n这张票被 #570 挡着。\n', needle: '## Destination' },
    { name: '首行就是 ## Destination，但没有规范章节（红队 G 用例）', text: '## Destination\n\n子票自己也有一节叫 Destination（子票正文写进地图就会被覆盖）。\n\n## 计划\n\n1. 子票的计划。\n', needle: '规范章节' },
    { name: '首行 Destination + 规范章节只出现在围栏里', text: '## Destination\n\n```\n## Notes\n```\n\n正文。\n', needle: '规范章节' },
  ]
  let ok = 0
  for (const b of bypass) {
    const r = runScript(['--map', '567', '--children', '571', '--body-file', writeFixture(b.text)])
    if (r.status === 2 && r.stderr.indexOf(b.needle) >= 0) ok++
    else check(false, '14.x ' + b.name + '：期望退出 2 且话里含「' + b.needle + '」，实际 exit=' + r.status + ' stderr=' + JSON.stringify(r.stderr.slice(0, 120)))
  }
  check(ok === bypass.length, '14.1 ' + bypass.length + ' 种「看起来像地图正文」的子票正文都被拒绝（实际 ' + ok + '/' + bypass.length + '）')
  check(argvLog().length === 0, '14.2 拒绝时一个 gh 请求都不发')

  // 正例：首行 Destination + 一个规范章节 → 放行（防过度收紧）
  resetFake(stateFor({ map: 567, subIssues: { '567': [571] }, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const positive = writeFixture('## Destination\n\n地图正文。\n\n## Not yet specified\n\n- 暂无。\n')
  const rp = runScript(['--map', '567', '--children', '571', '--body-file', positive])
  check(rp.status === 0 && rp.json && rp.json.ok === true, '14.3 首行 Destination + 一个规范章节 → 正常放行（防过度收紧）')
  check(readFake().bodies['567'].indexOf('## Not yet specified') >= 0, '14.4 正例的正文确实写回了地图')
}

// ——— 15) 子票不存在 / 改挂：假 gh 像真 gh 一样报错 ———
{
  resetFake(stateFor({ map: 567, issues: [571], bodies: { '567': MAP_BODY, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571,999999', '--body-file', mapFixture])
  check(r.status === 2 && r.json && r.json.ok === false, '15.1 不存在的子票：退出码 2（输入不对，命令根本没执行）')
  check(r.stderr.indexOf('999999') >= 0, '15.2 话里点名是哪张票读不到')
  check(argvLog().filter(isWrite).length === 0, '15.3 不存在的子票不会建出任何边')

  resetFake(stateFor({
    map: 567,
    subIssues: { '384': [999] },
    bodies: { '567': MAP_BODY, '999': CHILD_PLAIN },
  }))
  const r2 = runScript(['--map', '567', '--children', '999', '--body-file', mapFixture])
  check(r2.status === 2 && r2.stderr.indexOf('已经挂在 #384') >= 0, '15.4 已挂在别的地图下的子票：拒绝改挂')
  check(argvLog().filter(isWrite).length === 0, '15.5 拒绝改挂时不写任何东西')
  check((readFake().subIssues['384'] || []).indexOf(999) >= 0, '15.6 原父关系没被破坏')
}

// ——— 16) 后端不是 GitHub：直接拒绝 ———
{
  const body = writeFixture(MAP_BODY)
  const md = runScript(['--map', '1', '--children', '2', '--body-file', body], wsMarkdown)
  check(md.status === 2 && md.stderr.indexOf('直接改文件') >= 0, '16.1 本地 Markdown 工作区：拒绝并指明直接改文件')

  const gl = runScript(['--map', '1', '--children', '2', '--body-file', body], wsGitlab)
  check(gl.status === 2 && gl.stderr.indexOf('GitLab') >= 0, '16.2 GitLab 工作区：拒绝并指明待第二批')

  const no = runScript(['--map', '1', '--children', '2', '--body-file', body], wsNoDoc)
  check(no.status === 2 && no.stderr.indexOf('issue-tracker.md') >= 0, '16.3 没有主锚文件：拒绝并指明怎么认后端')
}

// ——— 17) 计数口径：去重、名单外子票、总数告警、翻页 ———
{
  // 17a --children 去重
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY, '570': CHILD_PLAIN, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571,570,571', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.expected === 2, '17.1 --children 去重后 expected=2（传了 3 个、其中 1 个重复）')
  check(countCmd(['issue', 'view', '571', '--json', 'body,parent']) === 1, '17.2 重复的票号只处理一次')

  // 17b 地图上还有名单外的子票：actual 只数名单内的（地图正文故意弄旧，逼脚本走到写回与校验那一步）
  resetFake(targetState({ subIssues: { '567': [571, 572, 576] }, blockedBy: { '572': [570] }, bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN, '572': CHILD_BLOCKED } }))
  const r2 = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r2.status === 0 && r2.json && r2.json.ok === true, '17.3 地图含名单外子票时照样通过（不假红）')
  check(r2.json && r2.json.expected === 2 && r2.json.actual === 2, '17.4 actual 只数 --children 里的（2），不是地图总数（3）')
  check(r2.json && (r2.json.warnings || []).join(' ').indexOf('总数为 3 张') >= 0, '17.5 warnings 说明地图总数 3、本次只校验 2 张')

  // 17b2 同样的名单外子票，但已是目标状态（走「直接返回」那条路）：总数告警同样要给
  resetFake(targetState({ subIssues: { '567': [571, 572, 576] }, blockedBy: { '572': [570] } }))
  const r2b = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r2b.status === 0 && r2b.json && r2b.json.changed.length === 0, '17.5b 已是目标状态时也走直接返回')
  check(r2b.json && (r2b.json.warnings || []).join(' ').indexOf('总数为 3 张') >= 0, '17.5c 直接返回那条路也要给出总数告警')
  check(r2b.json && (r2b.json.warnings || []).length === (r2b.json.warnings || []).filter(function (w, i, a) { return a.indexOf(w) === i }).length, '17.5d warnings 里没有重复条目')

  // 17c 超过一页：101 张子票必须翻页读全
  const many = []
  for (let i = 0; i < 101; i++) many.push(800 + i)
  const bodies = { '567': MAP_BODY }
  many.forEach(function (n) { bodies[String(n)] = CHILD_PLAIN })
  resetFake(stateFor({ map: 567, subIssues: { '567': many }, bodies: bodies }))
  const r3 = runScript(['--map', '567', '--children', many.join(','), '--body-file', mapFixture])
  check(r3.status === 0 && r3.json && r3.json.ok === true, '17.6 101 张子票不假红（退出 0）')
  check(r3.json && r3.json.expected === 101 && r3.json.actual === 101, '17.7 101 张都数到了（翻页读全）')
  check(argvLog().filter(isWrite).length === 0, '17.8 101 张都在位时零写请求')
}

// ——— 18) 回包与姊妹脚本同形 ———
{
  const sister = runSibling(['--issue', '1', '--body-file', writeFixture('## 进度：90%\n\n下一步：等确认。\n'), '--dry-run'])
  const sisterKeys = sister.json ? Object.keys(sister.json).sort() : []
  check(sisterKeys.length > 0, '18.1 姊妹脚本回包可解析（作为同形的基准）')

  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN } }))
  const dry = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture, '--dry-run'])
  const dryKeys = dry.json ? Object.keys(dry.json).sort() : []
  check(JSON.stringify(dryKeys) === JSON.stringify(sisterKeys), '18.2 演练回包字段集合与姊妹脚本逐字相同：' + dryKeys.join(','))

  const real = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture])
  const realKeys = real.json ? Object.keys(real.json).sort() : []
  const expectReal = sisterKeys.filter(function (k) { return k !== 'body' && k !== 'command' })
  check(JSON.stringify(realKeys) === JSON.stringify(expectReal), '18.3 真跑回包字段集合 = 姊妹脚本字段去掉演练专属两项：' + realKeys.join(','))
  check(!!real.json && Array.isArray(real.json.changed) && typeof real.json.edge === 'boolean' && Number.isInteger(real.json.expected) && Number.isInteger(real.json.actual) && typeof real.json.commented === 'boolean' && typeof real.json.ok === 'boolean' && Array.isArray(real.json.warnings) && typeof real.json.dryRun === 'boolean', '18.4 六字段类型正确（changed 数组 / edge 布尔 / expected、actual 整数 / commented、ok 布尔）')
  check(String(real.stdout).trim().split(/\r?\n/).filter(Boolean).length === 1, '18.5 stdout 恰好一行 JSON')
}

// ——— 19) 失败分支全覆盖 ———
{
  const base = { map: 567, bodies: { '567': MAP_BODY, '571': CHILD_PLAIN, '572': CHILD_BLOCKED }, subIssues: { '567': [571] } }
  const cases = [
    { name: '读地图正文失败', env: { FAKE_GH_FAIL_AT: 'view-body:567:1' }, exit: 1, on: '567', needle: '读不到地图 #567 的当前正文' },
    { name: '读子议题列表失败', env: { FAKE_GH_FAIL_AT: 'list:567:1' }, exit: 1, on: '567', needle: '读不到地图 #567 的子议题列表' },
    { name: '读子票失败（网络类）', env: { FAKE_GH_FAIL_AT: 'view-child:571:1' }, exit: 1, on: '567', needle: '读不到子票 #571' },
    { name: '读现有阻塞边失败', env: { FAKE_GH_FAIL_AT: 'view-edges:571:1' }, exit: 1, on: '571', needle: '读不到子票 #571 的现有阻塞边' },
    { name: '写地图正文失败', env: { FAKE_GH_BODY_FAIL: '1' }, exit: 1, on: '567', needle: '写回 #567 正文失败', staleBody: true },
    { name: '正文写回后读回不一致', env: { FAKE_GH_BODY_SILENT: '1' }, exit: 1, on: '567', needle: '读回来不一样', staleBody: true },
    { name: '挂子议题边失败', env: { FAKE_GH_PARENT_FAIL: '572', FAKE_GH_API_PARENT_FAIL: '1' }, exit: 1, on: '572', needle: '把 #572 挂到 #567 下失败' },
    { name: '建阻塞边失败（非不支持）', env: { FAKE_GH_BLOCK_FAIL: '572', FAKE_GH_BLOCK_API_FAIL: '1' }, exit: 1, on: '572', needle: '建阻塞边 #570 失败' },
    { name: '校验时读回列表失败', env: { FAKE_GH_FAIL_AT: 'list:567:2' }, exit: 1, on: '567', needle: '读回子议题列表失败' },
  ]
  for (const c of cases) {
    const st0 = stateFor(base)
    if (c.staleBody) st0.bodies['567'] = MAP_BODY_STALE
    resetFake(st0)
    const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture], wsGithub, c.env)
    const st = readFake()
    const commentedOn = st.comments.length ? st.comments[0].issue : null
    const good = r.status === c.exit && r.json && r.json.ok === false && r.json.commented === true && commentedOn === c.on && String(r.json.error || '').indexOf(c.needle) >= 0
    if (good) check(true, '19.x ' + c.name + '：退出 ' + c.exit + '、评论落在 #' + c.on + '、原因点题')
    else check(false, '19.x ' + c.name + '：期望 exit=' + c.exit + ' 评论落 #' + c.on + ' 原因含「' + c.needle + '」，实际 exit=' + r.status + ' 评论落 ' + commentedOn + ' error=' + JSON.stringify(String(r.json && r.json.error).slice(0, 120)))
  }

  // 降级时不需要写子票正文（声明源就在首部），所以这里只断言「没有多余的写」
  resetFake(stateFor({ map: 567, subIssues: { '567': [572] }, bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED } }))
  const r = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_UNSUPPORTED: '1' })
  check(r.status === 0 && countCmd(['issue', 'edit', '572', '--body-file']) === 0 && readFake().bodies['572'] === CHILD_BLOCKED,
    '19.10 降级时不写子票正文（首部文字行就是终态）')

  // 校验时读子票阻塞边失败：只告警并把 edge 置 false，不算失败
  resetFake(stateFor({ map: 567, subIssues: { '567': [572] }, bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED } }))
  const r2 = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_FAIL_AT: 'view-edges:572:2' })
  check(r2.status === 0 && r2.json.ok === true && r2.json.edge === false, '19.11 校验时读阻塞边失败：仍 ok、edge=false')
  check((r2.json.warnings || []).join(' ').indexOf('校验时读不到子票 #572') >= 0, '19.12 warnings 说明校验时读不到那条边')
}

// ——— 20) --repo 的 happy path ———
{
  const slug = 'FeatherHunter/dsh-mattpocock-skills-deck'
  resetFake(stateFor({ map: 567, bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture, '--repo', slug])
  check(r.status === 0 && r.json && r.json.ok === true, '20.1 传 --repo 时照常跑通')
  const log = argvLog()
  const issueCmds = log.filter(function (a) { return a[0] === 'issue' })
  check(issueCmds.length > 0 && issueCmds.every(function (a) { const i = a.indexOf('--repo'); return i >= 0 && a[i + 1] === slug }),
    '20.2 每条 issue 命令都带 --repo ' + slug)
  const apiCmds = log.filter(function (a) { return a[0] === 'api' })
  check(apiCmds.length > 0 && apiCmds.every(function (a) { return String(a[1]).indexOf('repos/' + slug + '/') === 0 }),
    '20.3 每条 api 路径都写成 repos/' + slug + '/...（不再用 {owner}/{repo} 占位符）')
}

// ——— 21) 已接入 npm run verify 链，且紧跟姊妹门禁之后 ———
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const steps = String(pkg.scripts.verify || '').split(' && ')
  const mine = 'node tests/verify-wire-subissues-script.js'
  const sisterStep = 'node tests/verify-issue-body-script.js'
  check(steps.indexOf(mine) >= 0, '21.1 npm run verify 链已纳入本门禁')
  check(steps.indexOf(sisterStep) >= 0 && steps[steps.indexOf(sisterStep) + 1] === mine, '21.2 本门禁紧跟姊妹门禁 tests/verify-issue-body-script.js 之后')
}

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响判定 */ }

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
