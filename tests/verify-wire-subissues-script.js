/*
 * tests/verify-wire-subissues-script.js —— #572 子议题关联脚本门禁（命令行黑盒）
 * 用法: node tests/verify-wire-subissues-script.js（在插件根目录；不联网、不碰真票）
 *
 * 测什么（契约 #576 定的测试缝：只测最高的一道——脚本命令行黑盒，参数进、回包加退出码出）：
 *   1) 正常补齐：地图正文写回 + 子票挂成原生子议题 + 阻塞声明升格成原生阻塞边，回包计数与状态都对；
 *   2) 已是目标状态：直接返回 changed:[]，一个写请求都不发（可重复跑）；
 *   3) 重复跑一致：第一次有改动，第二次零写请求；
 *   4) 演练：不联网、不写，回包带将要写入的正文与将要执行的命令数组；
 *   5) 数量对不上：非零退出、不吞错、失败评论落在缺边的那张子票下；
 *   6) 失败自动重试一次，第二次成功要在人话里说明；
 *   7) 两次都失败：退出码 1 + 固定格式失败评论（脚本名、参数、失败原因）；连评论也失败时 commented=false；
 *   8) 阻塞声明升格：用 gh 原生旗 --add-blocked-by，不用裸接口；
 *   9) 原生旗明确不可用时才回退裸接口（子议题边与阻塞边各一条），且裸接口用 -F 传数据库编号；
 *  10) 降级：原生阻塞边明确不支持时写子票正文首部文字行，ok=true 但 edge=false，warnings 说明；
 *  11) 不删既有边、不清理历史文字行；
 *  12) 参数缺失/格式错/正文文件不像地图正文：退出码 2 且说清缺什么；
 *  13) 非 GitHub 后端（Markdown / GitLab / 没有主锚）：退出码 2 并指明正确做法；
 *  14) 计数回归：地图从 0 补到 6（对照线上事故 #345 的用例）；
 *  15) 回包字段集合与类型与姊妹脚本 scripts/fix-issue-body.mjs 同形；
 *  16) 本门禁已接进 npm run verify 链，且紧跟姊妹门禁之后。
 *
 * 假 gh：一个 .mjs，用 DSH_GH_PATH 指过去；它记录每次调用的 argv，并用一份 JSON 状态文件
 * 模拟 GitHub（子议题边、阻塞边、票正文、数据库编号、评论），可用环境变量切换失败/不支持/静默。
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
const MAP_BODY = '## Destination\n\n把子票挂到地图下，并补齐原生阻塞边。\n\n## 计划\n\n1. 做 #571。\n'
const MAP_BODY_STALE = '## Destination\n\n这是地图上的旧正文，和文件不一样。\n'
const CHILD_PLAIN = '## Question\n\n这张票没有阻塞声明。\n'
const CHILD_BLOCKED = 'Blocked by: #570\n\n## Question\n\n这张票被 #570 挡着。\n'
// 声明行不在正文首部（用来验证降级时会把文字行补写到首部）
const CHILD_BLOCKED_LATE = '## Question\n\n这张票被 #570 挡着。\n\nBlocked by: #570\n'

let fixtureSeq = 0
function writeFixture(text) {
  const p = path.join(TMP, 'fixture-' + (++fixtureSeq) + '.md')
  fs.writeFileSync(p, text, 'utf8')
  return p
}
const mapFixture = writeFixture(MAP_BODY)

// ——— 假 gh ———
const fakeGh = path.join(TMP, 'fake-gh.mjs')
const fakeLog = path.join(TMP, 'fake-gh.log')
const fakeState = path.join(TMP, 'fake-gh-state.json')
const FAKE_GH_SRC = [
  "import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const STATE = process.env.FAKE_GH_STATE",
  "const LOG = process.env.FAKE_GH_LOG",
  "function load() { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch (e) { return { subIssues: {}, blockedBy: {}, bodies: {}, dbIds: {}, comments: [] } } }",
  "function save(s) { writeFileSync(STATE, JSON.stringify(s), 'utf8') }",
  "function out(t) { process.stdout.write(t) }",
  "function die(msg, code) { process.stderr.write(msg + '\\n'); process.exit(typeof code === 'number' ? code : 1) }",
  "appendFileSync(LOG, JSON.stringify(args) + '\\n')",
  "function sameCount() {",
  "  try { const key = JSON.stringify(args); const lines = readFileSync(LOG, 'utf8').split('\\n').filter(Boolean); return lines.filter(function (l) { return l === key }).length } catch (e) { return 1 }",
  "}",
  "function argAfter(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }",
  "const s = load()",
  "if (args[0] === 'issue' && args[1] === 'view') {",
  "  const n = String(args[2])",
  "  const fields = String(argAfter('--json') || 'body').split(',')",
  "  const o = {}",
  "  if (fields.indexOf('body') >= 0) o.body = s.bodies[n] === undefined ? '' : s.bodies[n]",
  "  if (fields.indexOf('blockedBy') >= 0) { const list = s.blockedBy[n] || []; o.blockedBy = { nodes: list.map(function (x) { return { number: x } }), totalCount: list.length } }",
  "  out(JSON.stringify(o)); process.exit(0)",
  "}",
  "if (args[0] === 'issue' && args[1] === 'edit') {",
  "  const n = String(args[2])",
  "  const bodyFile = argAfter('--body-file')",
  "  if (bodyFile) { if (process.env.FAKE_GH_BODY_FAIL === '1') die('HTTP 422: 假 gh 故意让写正文失败'); s.bodies[n] = readFileSync(bodyFile, 'utf8') }",
  "  const parent = argAfter('--parent')",
  "  if (parent) {",
  "    if (process.env.FAKE_GH_PARENT_FLAG_BROKEN === '1') die('unknown flag: --parent')",
  "    if (process.env.FAKE_GH_PARENT_FAIL === n) die('HTTP 500: 假 gh 故意让 --parent 失败')",
  "    if (process.env.FAKE_GH_PARENT_FAIL_ONCE === n && sameCount() === 1) die('HTTP 502: 假 gh 让 --parent 第一次失败')",
  "    if (process.env.FAKE_GH_PARENT_SILENT === n) { save(s); process.exit(0) }",
  "    if (!s.subIssues[parent]) s.subIssues[parent] = []",
  "    if (s.subIssues[parent].indexOf(Number(n)) < 0) s.subIssues[parent].push(Number(n))",
  "  }",
  "  const blockedBy = argAfter('--add-blocked-by')",
  "  if (blockedBy) {",
  "    if (process.env.FAKE_GH_BLOCK_FLAG_BROKEN === '1') die('unknown flag: --add-blocked-by')",
  "    if (process.env.FAKE_GH_UNSUPPORTED === '1') die('sub_issues not supported on this server')",
  "    if (process.env.FAKE_GH_BLOCK_FAIL === n) die('HTTP 500: 假 gh 故意让 --add-blocked-by 失败')",
  "    if (!s.blockedBy[n]) s.blockedBy[n] = []",
  "    if (s.blockedBy[n].indexOf(Number(blockedBy)) < 0) s.blockedBy[n].push(Number(blockedBy))",
  "  }",
  "  save(s); process.exit(0)",
  "}",
  "if (args[0] === 'issue' && args[1] === 'comment') {",
  "  const n = String(args[2])",
  "  if (process.env.FAKE_GH_COMMENT_FAIL === '1') die('HTTP 403: 假 gh 故意让评论失败')",
  "  s.comments.push({ issue: n, body: readFileSync(argAfter('--body-file'), 'utf8') })",
  "  save(s); process.exit(0)",
  "}",
  "if (args[0] === 'api') {",
  "  const p = String(args[1])",
  "  const method = argAfter('--method') || 'GET'",
  "  function typedField() { const i = args.indexOf('-F'); return i >= 0 ? String(args[i + 1]) : '' }",
  "  function byDbId(id) { const keys = Object.keys(s.dbIds); for (const k of keys) { if (Number(s.dbIds[k]) === Number(id)) return Number(k) } return null }",
  "  let m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)\\/sub_issues(\\?.*)?$/)",
  "  if (m) {",
  "    const map = m[1]",
  "    if (method === 'POST') {",
  "      if (process.env.FAKE_GH_API_PARENT_FAIL === '1') die('HTTP 500: 假 gh 故意让裸接口建子议题边失败')",
  "      const child = byDbId(typedField().split('=')[1])",
  "      if (!child) die('HTTP 422: 假 gh 不认识 sub_issue_id')",
  "      if (!s.subIssues[map]) s.subIssues[map] = []",
  "      if (s.subIssues[map].indexOf(child) < 0) s.subIssues[map].push(child)",
  "      save(s); out('{}'); process.exit(0)",
  "    }",
  "    const list = s.subIssues[map] || []",
  "    out(JSON.stringify(list.map(function (x) { return { number: x } }))); process.exit(0)",
  "  }",
  "  m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)\\/dependencies\\/blocked_by$/)",
  "  if (m && method === 'POST') {",
  "    const child = m[1]",
  "    if (process.env.FAKE_GH_UNSUPPORTED === '1') die('dependencies not supported on this server')",
  "    if (process.env.FAKE_GH_BLOCK_FAIL === child) die('HTTP 500: 假 gh 故意让依赖接口失败')",
  "    const blocker = byDbId(typedField().split('=')[1])",
  "    if (!blocker) die('HTTP 422: 假 gh 不认识 issue_id')",
  "    if (!s.blockedBy[child]) s.blockedBy[child] = []",
  "    if (s.blockedBy[child].indexOf(blocker) < 0) s.blockedBy[child].push(blocker)",
  "    save(s); out('{}'); process.exit(0)",
  "  }",
  "  m = p.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)$/)",
  "  if (m) {",
  "    const n = m[1]",
  "    const id = s.dbIds[n] === undefined ? 100000 + Number(n) : s.dbIds[n]",
  "    if (String(argAfter('--jq') || '').trim() === '.id') { out(String(id)); process.exit(0) }",
  "    out(JSON.stringify({ id: id, number: Number(n) })); process.exit(0)",
  "  }",
  "  die('假 gh 不认识的 api 路径：' + p)",
  "}",
  "die('假 gh 不认识的命令：' + args.join(' '))",
].join('\n')
fs.writeFileSync(fakeGh, FAKE_GH_SRC, 'utf8')

function baseState(over) {
  return Object.assign({ subIssues: {}, blockedBy: {}, bodies: {}, dbIds: {}, comments: [] }, over || {})
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
  return argvLog().filter(function (a) {
    return tokens.every(function (t, i) { return a[i] === t })
  }).length
}
function isWrite(a) {
  if (a[0] === 'issue' && a[1] === 'edit') return true
  if (a[0] === 'issue' && a[1] === 'comment') return true
  if (a[0] === 'api' && a.indexOf('--method') >= 0 && a[a.indexOf('--method') + 1] === 'POST') return true
  return false
}

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

console.log('子议题关联脚本门禁（#572 · 命令行黑盒）')

// ——— 1) 正常补齐：正文写回 + 子议题边 + 阻塞边 ———
{
  resetFake(baseState({
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
    dbIds: { 570: 1000570, 571: 1000571, 572: 1000572 },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '1.1 正常补齐：退出码 0 且 ok=true')
  check(r.json && r.json.expected === 2 && r.json.actual === 2, '1.2 expected=2 / actual=2')
  check(r.json && r.json.edge === true, '1.3 edge=true（子议题边与声明的阻塞边都到位）')
  const ch = (r.json && r.json.changed) || []
  check(ch.some(function (c) { return c === '#567 正文：按文件内容写回' }), '1.4 changed 记录地图正文写回')
  check(ch.some(function (c) { return c === '#571 已挂到 #567 下' }) && ch.some(function (c) { return c === '#572 已挂到 #567 下' }), '1.5 changed 记录两张子票挂上')
  check(ch.some(function (c) { return c === '#572 新增原生阻塞边：#570' }), '1.6 changed 记录阻塞边升格')
  check(countCmd(['issue', 'edit', '571', '--parent', '567']) === 1, '1.7 子议题边用 gh 原生旗 --parent')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/567/sub_issues', '--method', 'POST']) === 0, '1.8 原生旗可用时不发裸接口')
  const log = argvLog()
  check(JSON.stringify(log[0]) === JSON.stringify(['issue', 'view', '567', '--json', 'body']), '1.9 第一条命令是读地图正文（先读后写）')
  check(log.length > 0 && isWrite(log[log.length - 1]) === false, '1.10 最后一条命令是读回校验（写完读回）')
  const st = readFake()
  check((st.subIssues['567'] || []).slice().sort(function (a, b) { return a - b }).join(',') === '571,572', '1.11 状态里两张子票都挂上了')
  check((st.blockedBy['572'] || []).indexOf(570) >= 0, '1.12 状态里阻塞边升格成功')
  check(st.bodies['567'] === MAP_BODY, '1.13 地图正文按文件内容写回')
}

// ——— 2) 已是目标状态：一个写请求都不发 ———
{
  resetFake(baseState({
    subIssues: { '567': [571, 572] },
    blockedBy: { '572': [570] },
    bodies: { '567': MAP_BODY, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
    dbIds: { 570: 1000570, 571: 1000571, 572: 1000572 },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '2.1 已是目标状态：退出码 0 且 ok=true')
  check(r.json && Array.isArray(r.json.changed) && r.json.changed.length === 0, '2.2 已是目标状态：changed 为空')
  check(r.json && r.json.edge === true && r.json.expected === 2 && r.json.actual === 2, '2.3 已是目标状态：edge/expected/actual 仍然如实')
  check(argvLog().filter(isWrite).length === 0, '2.4 已是目标状态：不再发任何写请求（可重复跑）')
}

// ——— 3) 重复跑一致：第一次有改动，第二次零写请求 ———
{
  resetFake(baseState({
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN },
    dbIds: { 571: 1000571 },
  }))
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
  resetFake(baseState({
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN, '572': CHILD_BLOCKED },
    dbIds: { 570: 1000570, 571: 1000571, 572: 1000572 },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture, '--dry-run'])
  check(r.status === 0 && r.json && r.json.dryRun === true && r.json.ok === true, '4.1 演练：退出码 0、dryRun=true、ok=true')
  check(r.json && r.json.body === MAP_BODY, '4.2 演练回包带将要写入的地图正文')
  check(r.json && Array.isArray(r.json.command) && r.json.command.length >= 3, '4.3 演练回包带将要执行的命令数组')
  check(r.json && r.json.command.some(function (c) { return c.indexOf('--body-file') >= 0 }), '4.4 计划里的正文写回走 --body-file')
  check(r.json && r.json.command.some(function (c) { return c.indexOf('--parent') >= 0 }), '4.5 计划里列出将挂的子票边')
  check(argvLog().length === 0, '4.6 演练一个 gh 请求都不发（不联网）')
  check(r.json && r.json.edge === null && r.json.actual === null, '4.7 演练不联网时 edge/actual 是 null（未取）')
  check(readFake().bodies['567'] === MAP_BODY_STALE, '4.8 演练不改任何东西')
}

// ——— 5) 数量对不上：非零退出、不吞错、失败评论落在缺边的那张子票下 ———
{
  resetFake(baseState({
    bodies: { '567': MAP_BODY, '571': CHILD_PLAIN, '572': CHILD_PLAIN },
    dbIds: { 571: 1000571, 572: 1000572 },
  }))
  const r = runScript(['--map', '567', '--children', '571,572', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_SILENT: '572' })
  check(r.status === 1 && r.json && r.json.ok === false, '5.1 数量对不上：退出码 1 且 ok=false')
  check(r.json && r.json.expected === 2 && r.json.actual === 1, '5.2 expected=2 / actual=1')
  check(countCmd(['issue', 'edit', '572', '--parent', '567']) === 1, '5.3 建边命令自己返回成功时不重试')
  check(r.json && r.json.commented === true, '5.4 数量对不上时留了失败评论')
  const st = readFake()
  check(st.comments.length === 1 && st.comments[0].issue === '572', '5.5 评论落在缺边的那张子票下')
}

// ——— 6) 失败自动重试一次，第二次成功要说明 ———
{
  resetFake(baseState({ bodies: { '567': MAP_BODY, '571': CHILD_PLAIN }, dbIds: { 571: 1000571 } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_FAIL_ONCE: '571' })
  check(r.status === 0 && r.json && r.json.ok === true, '6.1 重试一次后成功：退出码 0 且 ok=true')
  check(countCmd(['issue', 'edit', '571', '--parent', '567']) === 2, '6.2 同一建边命令调了 2 次（重试一次）')
  check(r.stderr.indexOf('重试一次后成功') >= 0, '6.3 人话里说明「重试一次后成功」')
}

// ——— 7) 两次都失败：退出码 1 + 固定格式失败评论 ———
{
  resetFake(baseState({ bodies: { '567': MAP_BODY, '571': CHILD_PLAIN }, dbIds: { 571: 1000571 } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_FAIL: '571', FAKE_GH_API_PARENT_FAIL: '1' })
  check(r.status === 1 && r.json && r.json.ok === false && r.json.commented === true, '7.1 两次都失败：退出码 1 且留了评论')
  const st = readFake()
  const c = st.comments[0] || { issue: '', body: '' }
  check(c.issue === '571', '7.2 评论落在失败的那张子票下')
  check(c.body.indexOf('<!-- 失败留痕：' + SCRIPT_NAME + ' -->') === 0, '7.3 评论首行是固定格式的失败留痕锚')
  check(c.body.indexOf(SCRIPT_NAME) >= 0, '7.4 评论里带脚本名')
  check(c.body.indexOf('--map 567 --children 571 --body-file') >= 0, '7.5 评论里带参数')
  check(c.body.indexOf('HTTP 500: 假 gh 故意让裸接口建子议题边失败') >= 0, '7.6 评论里带失败原因原文')

  resetFake(baseState({ bodies: { '567': MAP_BODY, '571': CHILD_PLAIN }, dbIds: { 571: 1000571 } }))
  const r2 = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_FAIL: '571', FAKE_GH_API_PARENT_FAIL: '1', FAKE_GH_COMMENT_FAIL: '1' })
  check(r2.status === 1 && r2.json && r2.json.commented === false, '7.7 连评论也留不上：commented=false 且仍非零退出')
}

// ——— 8) 阻塞声明升格：用原生旗，一次一条 ———
{
  resetFake(baseState({
    subIssues: { '567': [573] },
    bodies: { '567': MAP_BODY, '573': 'Blocked by: #571, #572\n\n## Question\n\n被两张票挡着。\n' },
    dbIds: { 571: 1000571, 572: 1000572 },
  }))
  const r = runScript(['--map', '567', '--children', '573', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true && r.json.edge === true, '8.1 声明的阻塞边全部升格成功')
  check(countCmd(['issue', 'edit', '573', '--add-blocked-by', '571']) === 1, '8.2 第一条阻塞边用 --add-blocked-by')
  check(countCmd(['issue', 'edit', '573', '--add-blocked-by', '572']) === 1, '8.3 第二条阻塞边用 --add-blocked-by')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/573/dependencies/blocked_by', '--method', 'POST']) === 0, '8.4 原生旗可用时不发裸接口')
  check((readFake().blockedBy['573'] || []).slice().sort(function (a, b) { return a - b }).join(',') === '571,572', '8.5 两条边都建上了')
}

// ——— 9) 原生旗明确不可用时才回退裸接口 ———
{
  resetFake(baseState({ bodies: { '567': MAP_BODY, '571': CHILD_PLAIN }, dbIds: { 571: 1000571 } }))
  const r = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture], wsGithub, { FAKE_GH_PARENT_FLAG_BROKEN: '1' })
  check(r.status === 0 && r.json && r.json.ok === true && r.json.actual === 1, '9.1 --parent 旗不可用时仍能挂上（回退裸接口）')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/567/sub_issues', '--method', 'POST', '-F', 'sub_issue_id=1000571']) === 1, '9.2 裸接口建子议题边，且用 -F 传数据库编号')

  resetFake(baseState({
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
    dbIds: { 570: 1000570 },
    blockedBy: {},
  }))
  const r2 = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_BLOCK_FLAG_BROKEN: '1' })
  check(r2.status === 0 && r2.json && r2.json.ok === true && r2.json.edge === true, '9.3 --add-blocked-by 旗不可用时仍能建边（回退裸接口）')
  check(countCmd(['api', 'repos/{owner}/{repo}/issues/572/dependencies/blocked_by', '--method', 'POST', '-F', 'issue_id=1000570']) === 1, '9.4 裸接口建阻塞边，且用 -F 传数据库编号')
}

// ——— 10) 降级：原生阻塞边明确不支持时写文字行 ———
{
  resetFake(baseState({
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED_LATE },
    dbIds: { 570: 1000570 },
    blockedBy: {},
  }))
  const r = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture], wsGithub, { FAKE_GH_UNSUPPORTED: '1' })
  check(r.status === 0 && r.json && r.json.ok === true, '10.1 降级成功：退出码 0 且 ok=true')
  check(r.json && r.json.edge === false, '10.2 降级时 edge=false（原生边没建上）')
  check(r.json && (r.json.warnings || []).join(' ').indexOf('不支持原生阻塞边') >= 0, '10.3 warnings 说明降级原因')
  check(r.json && (r.json.changed || []).some(function (c) { return c.indexOf('已降级为文字行') >= 0 }), '10.4 changed 如实记录降级')
  const st = readFake()
  check(String(st.bodies['572']).indexOf('Blocked by: #570') === 0, '10.5 文字行写进子票正文首部')
  check(countCmd(['issue', 'edit', '572', '--body-file']) === 1, '10.6 文字行走文件参数写回')
}

// ——— 11) 不删既有边、不清理历史文字行 ———
{
  resetFake(baseState({
    subIssues: { '567': [572] },
    bodies: { '567': MAP_BODY, '572': CHILD_BLOCKED },
    dbIds: { 570: 1000570 },
    blockedBy: { '572': [999] },
  }))
  const r = runScript(['--map', '567', '--children', '572', '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '11.1 已有别的阻塞边时照样跑通')
  const log = argvLog()
  check(log.every(function (a) { return a.indexOf('--remove-blocked-by') < 0 && a.indexOf('DELETE') < 0 }), '11.2 日志里没有删除类命令')
  const st = readFake()
  check((st.blockedBy['572'] || []).slice().sort(function (a, b) { return a - b }).join(',') === '570,999', '11.3 既有边保留、缺的边补上')
  check(countCmd(['issue', 'edit', '572', '--body-file']) === 0, '11.4 不写子票正文（不清理历史文字行）')
}

// ——— 12) 参数与文件错误 ———
{
  const body = writeFixture(MAP_BODY)
  fs.writeFileSync(fakeLog, '', 'utf8')
  const r1 = runScript(['--children', '571', '--body-file', body])
  check(r1.status === 2 && r1.json && r1.json.ok === false, '12.1 缺 --map：退出码 2 且 ok=false')
  check(r1.stderr.indexOf('--map') >= 0, '12.2 缺 --map：错误话里说清缺什么')

  const r2 = runScript(['--map', 'abc', '--children', '571', '--body-file', body])
  check(r2.status === 2 && r2.stderr.indexOf('只接受数字编号') >= 0, '12.3 --map 非数字：退出码 2')

  const r3 = runScript(['--map', '567', '--body-file', body])
  check(r3.status === 2 && r3.stderr.indexOf('--children') >= 0, '12.4 缺 --children：退出码 2 并说清')

  const r4 = runScript(['--map', '567', '--children', '571,abc', '--body-file', body])
  check(r4.status === 2 && r4.stderr.indexOf('逗号分隔的数字编号') >= 0, '12.5 --children 非数字：退出码 2')

  const r5 = runScript(['--map', '567', '--children', '571'])
  check(r5.status === 2 && r5.stderr.indexOf('--body-file') >= 0, '12.6 缺 --body-file：退出码 2 并说清')

  const r6 = runScript(['--map', '567', '--children', '571', '--body-file', path.join(TMP, '不存在.md')])
  check(r6.status === 2 && r6.stderr.indexOf('读不到正文文件') >= 0, '12.7 正文文件不存在：退出码 2 并说清')

  const r7 = runScript(['--map', '567', '--children', '571', '--body-file', writeFixture('## Question\n\n这是子票正文，不是地图正文。\n')])
  check(r7.status === 2 && r7.stderr.indexOf('## Destination') >= 0, '12.8 正文文件不像地图正文：退出码 2，不写任何东西')

  const r8 = runScript(['--map', '567', '--children', '571', '--body-file', body, '--repo', 'not-a-slug'])
  check(r8.status === 2 && r8.stderr.indexOf('owner/name') >= 0, '12.9 --repo 格式不对：退出码 2')

  const r9 = runScript(['--map', '567', '--children', '571', '--body-file', body, '--unknown-flag'])
  check(r9.status === 2 && r9.stderr.indexOf('不认识的参数') >= 0, '12.10 不认识的参数：退出码 2')

  const r10 = runScript(['--help'])
  check(r10.status === 0 && r10.stderr.indexOf('--children') >= 0, '12.11 --help 退出码 0 且打印用法')

  check(argvLog().length === 0, '12.12 参数错误时一个 gh 请求都不发（命令根本没执行）')
}

// ——— 13) 后端不是 GitHub：直接拒绝 ———
{
  const body = writeFixture(MAP_BODY)
  const md = runScript(['--map', '1', '--children', '2', '--body-file', body], wsMarkdown)
  check(md.status === 2 && md.stderr.indexOf('直接改文件') >= 0, '13.1 本地 Markdown 工作区：拒绝并指明直接改文件')

  const gl = runScript(['--map', '1', '--children', '2', '--body-file', body], wsGitlab)
  check(gl.status === 2 && gl.stderr.indexOf('GitLab') >= 0, '13.2 GitLab 工作区：拒绝并指明待第二批')

  const no = runScript(['--map', '1', '--children', '2', '--body-file', body], wsNoDoc)
  check(no.status === 2 && no.stderr.indexOf('issue-tracker.md') >= 0, '13.3 没有主锚文件：拒绝并指明怎么认后端')
}

// ——— 14) 计数回归：地图从 0 补到 6 ———
{
  const kids = [601, 602, 603, 604, 605, 606]
  const bodies = { '567': MAP_BODY }
  const dbIds = {}
  kids.forEach(function (k) { bodies[String(k)] = CHILD_PLAIN; dbIds[k] = 1000000 + k })
  resetFake(baseState({ bodies: bodies, dbIds: dbIds }))
  const r = runScript(['--map', '567', '--children', kids.join(','), '--body-file', mapFixture])
  check(r.status === 0 && r.json && r.json.ok === true, '14.1 从 0 补到 6：退出码 0 且 ok=true')
  check(r.json && r.json.expected === 6 && r.json.actual === 6, '14.2 expected=6 / actual=6（对照 #345 的线上事故用例）')
  check(readFake().subIssues['567'].length === 6, '14.3 六张子票都挂上了')
}

// ——— 15) 回包与姊妹脚本同形 ———
{
  const sister = runSibling(['--issue', '1', '--body-file', writeFixture('## 进度：90%\n\n下一步：等确认。\n'), '--dry-run'])
  const sisterKeys = sister.json ? Object.keys(sister.json).sort() : []
  check(sisterKeys.length > 0, '15.1 姊妹脚本回包可解析（作为同形的基准）')

  resetFake(baseState({
    bodies: { '567': MAP_BODY_STALE, '571': CHILD_PLAIN },
    dbIds: { 571: 1000571 },
  }))
  const dry = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture, '--dry-run'])
  const dryKeys = dry.json ? Object.keys(dry.json).sort() : []
  check(JSON.stringify(dryKeys) === JSON.stringify(sisterKeys), '15.2 演练回包字段集合与姊妹脚本逐字相同：' + dryKeys.join(','))

  const real = runScript(['--map', '567', '--children', '571', '--body-file', mapFixture])
  const realKeys = real.json ? Object.keys(real.json).sort() : []
  const expectReal = sisterKeys.filter(function (k) { return k !== 'body' && k !== 'command' })
  check(JSON.stringify(realKeys) === JSON.stringify(expectReal), '15.3 真跑回包字段集合 = 姊妹脚本字段去掉演练专属两项：' + realKeys.join(','))
  check(!!real.json && Array.isArray(real.json.changed) && typeof real.json.edge === 'boolean' && Number.isInteger(real.json.expected) && Number.isInteger(real.json.actual) && typeof real.json.commented === 'boolean' && typeof real.json.ok === 'boolean' && Array.isArray(real.json.warnings) && typeof real.json.dryRun === 'boolean', '15.4 六字段类型正确（changed 数组 / edge 布尔 / expected、actual 整数 / commented、ok 布尔）')
  check(String(real.stdout).trim().split(/\r?\n/).filter(Boolean).length === 1, '15.5 stdout 恰好一行 JSON')
}

// ——— 16) 已接入 npm run verify 链，且紧跟姊妹门禁之后 ———
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const steps = String(pkg.scripts.verify || '').split(' && ')
  const mine = 'node tests/verify-wire-subissues-script.js'
  const sisterStep = 'node tests/verify-issue-body-script.js'
  check(steps.indexOf(mine) >= 0, '16.1 npm run verify 链已纳入本门禁')
  check(steps.indexOf(sisterStep) >= 0 && steps[steps.indexOf(sisterStep) + 1] === mine, '16.2 本门禁紧跟姊妹门禁 tests/verify-issue-body-script.js 之后')
}

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响判定 */ }

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
