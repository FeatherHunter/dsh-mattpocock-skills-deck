/*
 * tests/verify-issue-body-script.js —— #571 正文写回脚本门禁（命令行黑盒）
 * 用法: node tests/verify-issue-body-script.js（在插件根目录；不联网、不碰真票）
 *
 * 测什么（契约 #576 定的测试缝：只测最高的一道——脚本命令行黑盒，参数进、回包加退出码出）：
 *   1) 正常正文：不改写、无告警、回包 command 走 --body-file 且不出现内联 --body；
 *   2) Windows 编辑器另存带的开头不可见字符被剥掉；
 *   3) 字面 \n 转义在阈值内还原成真实换行（含还原后「标题后没留空行」的告警）；
 *   4) 真实换行已达阈值时字面转义原样保留（不误伤正常正文）；
 *   5) 标题没独占一行、标题后没留空行：只告警、不改写；代码围栏与行内代码里的写法不误报；
 *   6) CRLF 正文照常处理且不改写换行；
 *   7) 参数缺失、正文文件不存在：退出码 2 且回包 ok:false；
 *   8) 工作区后端不是 GitHub（Markdown / GitLab / 没有主锚）：直接拒绝并指明正确做法；
 *   9) 差分钉住：脚本的校正结果逐字等于 src/shared/parser.js 的 normalizeBody（真源）；
 *  10) 本门禁已接进 npm run verify 链。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'fix-issue-body.mjs')
const SCRIPT_NAME = 'scripts/fix-issue-body.mjs'
const TRUTH = path.join(ROOT, 'src', 'shared', 'parser.js')

let failed = false
const check = function (ok, msg) {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ——— 临时工作区：一个带主锚文件的小目录，脚本认后端就读这里 ———
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-issue-body-'))
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

let fixtureSeq = 0
function writeFixture(text) {
  const p = path.join(TMP, 'fixture-' + (++fixtureSeq) + '.md')
  fs.writeFileSync(p, text, 'utf8')
  return p
}

function runScript(args, cwd, extraEnv) {
  const res = spawnSync(process.execPath, [SCRIPT].concat(args), {
    cwd: cwd || wsGithub,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: Object.assign({}, process.env, extraEnv || {}),
  })
  let json = null
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  try { json = JSON.parse(line) } catch (e) { json = null }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', json: json }
}

function dryRun(text, issue) {
  return runScript(['--issue', String(issue || 571), '--body-file', writeFixture(text), '--dry-run'])
}

// ——— 真源：src/shared/parser.js 的 normalizeBody（用 --no-warnings 子进程读，避免模块类型提示刷屏） ———
function truthNormalize(text) {
  const code = 'import { normalizeBody } from ' + JSON.stringify(pathToFileURL(TRUTH).href) +
    ';process.stdout.write(normalizeBody(Buffer.from(process.argv[1], "base64").toString("utf8")))'
  const res = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code, Buffer.from(text, 'utf8').toString('base64')], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  if (res.status !== 0) throw new Error('读取真源 normalizeBody 失败：' + (res.stderr || ''))
  return res.stdout
}

console.log('正文写回脚本门禁（#571 · 命令行黑盒）')

// ——— 1) 正常正文：不改写、无告警、命令走文件参数 ———
{
  const body = '## 进度：90%\n\n下一步：等确认。\n'
  const r = dryRun(body)
  check(r.status === 0 && r.json && r.json.ok === true, '1.1 正常正文：退出码 0 且 ok=true')
  check(r.json && r.json.body === body, '1.2 正常正文：校正后逐字不变（不误伤）')
  check(r.json && Array.isArray(r.json.warnings) && r.json.warnings.length === 0, '1.3 正常正文：无格式告警')
  const cmd = (r.json && r.json.command) || []
  check(cmd.indexOf('--body-file') >= 0, '1.4 回包命令含 --body-file（正文走文件）')
  check(cmd.indexOf('--body') < 0, '1.5 回包命令不出现内联 --body（禁内联正文）')
  check(r.json && r.json.edge === null && r.json.expected === null && r.json.actual === null, '1.6 不适用字段保持 null（与关联脚本同形）')
  check(r.json && r.json.dryRun === true, '1.7 演练模式在回包里标出来')
}

// ——— 2) Windows 编辑器另存带的开头不可见字符 ———
{
  const r = dryRun('\uFEFF## 进度：90%\n\n下一步：等确认。\n')
  check(r.status === 0 && r.json && r.json.body.startsWith('## 进度'), '2.1 开头不可见字符被剥掉')
  check(r.json && r.json.changed.some(function (c) { return c.indexOf('不可见字符') >= 0 }), '2.2 回包说清剥掉了不可见字符')
}

// ——— 3) 字面 \n 转义在阈值内还原 ———
{
  const r = dryRun('## 进度：90%\\n下一步：等确认。')
  check(r.json && r.json.body === '## 进度：90%\n下一步：等确认。', '3.1 字面转义还原成真实换行')
  check(r.json && r.json.changed.some(function (c) { return c.indexOf('还原') >= 0 }), '3.2 回包说清还原了几处')
  check(r.json && r.json.warnings.some(function (w) { return w.indexOf('标题后没留空行') >= 0 }), '3.3 还原后仍缺空行时给出告警')
}

// ——— 4) 真实换行已达阈值：字面转义原样保留 ———
{
  const body = '第一段。\n\n第二段里有字面 \\n 转义（举例说明用的）。\n\n第三段。\n'
  const r = dryRun(body)
  check(r.json && r.json.body === body, '4.1 真实换行够多时字面转义原样保留（不误伤）')
}

// ——— 5) 格式检查只告警不改写 ———
{
  const glued = '正文一段## 进度：90%\n\n下一步：等确认。\n'
  const r1 = dryRun(glued)
  check(r1.json && r1.json.body === glued, '5.1 标题没独占一行：不改写原文')
  check(r1.json && r1.json.warnings.some(function (w) { return w.indexOf('没独占一行') >= 0 }), '5.2 标题没独占一行：给出告警')

  const noBlank = '## 进度：90%\n下一步：等确认。\n'
  const r2 = dryRun(noBlank)
  check(r2.json && r2.json.warnings.some(function (w) { return w.indexOf('标题后没留空行') >= 0 }), '5.3 标题后没留空行：给出告警')

  const fenced = '```\n## 这是代码里的样子\n正文一段## 也在代码里\n```\n\n正常段落。\n'
  const r3 = dryRun(fenced)
  check(r3.json && r3.json.warnings.length === 0, '5.4 代码围栏内的写法不误报')

  const inlineCode = '正文里写「`## 进度：90%`」是举例，不是标题。\n\n正常段落。\n'
  const r4 = dryRun(inlineCode)
  check(r4.json && r4.json.warnings.length === 0, '5.5 行内代码里的写法不误报')
}

// ——— 6) CRLF 正文照常处理 ———
{
  const body = '## 进度：90%\r\n\r\n下一步：等确认。\r\n'
  const r = dryRun(body)
  check(r.status === 0 && r.json && r.json.body === body, '6.1 CRLF 正文按原样保留（按行切分兼容两种换行）')
  check(r.json && r.json.warnings.length === 0, '6.2 CRLF 正文不误报格式告警')
}

// ——— 7) 参数与文件错误 ———
{
  const r1 = runScript(['--issue', '571', '--dry-run'])
  check(r1.status === 2 && r1.json && r1.json.ok === false, '7.1 缺 --body-file：退出码 2 且 ok=false')
  check(r1.stderr.indexOf('--body-file') >= 0, '7.2 缺 --body-file：错误话里说清缺什么')

  const r2 = runScript(['--body-file', writeFixture('x'), '--dry-run'])
  check(r2.status === 2, '7.3 缺 --issue：退出码 2')

  const r3 = runScript(['--issue', 'abc', '--body-file', writeFixture('x'), '--dry-run'])
  check(r3.status === 2, '7.4 --issue 非数字：退出码 2')

  const r4 = runScript(['--issue', '571', '--body-file', path.join(TMP, '不存在.md'), '--dry-run'])
  check(r4.status === 2 && r4.stderr.indexOf('读不到正文文件') >= 0, '7.5 正文文件不存在：退出码 2 并说清')

  const r5 = runScript(['--help'])
  check(r5.status === 0 && r5.stderr.indexOf('--body-file') >= 0, '7.6 --help 退出码 0 且打印用法')
}

// ——— 8) 后端不是 GitHub：直接拒绝 ———
{
  const body = writeFixture('## 进度：90%\n\n下一步：等确认。\n')
  const md = runScript(['--issue', '1', '--body-file', body, '--dry-run'], wsMarkdown)
  check(md.status === 2 && md.stderr.indexOf('直接改文件') >= 0, '8.1 本地 Markdown 工作区：拒绝并指明直接改文件')

  const gl = runScript(['--issue', '1', '--body-file', body, '--dry-run'], wsGitlab)
  check(gl.status === 2 && gl.stderr.indexOf('GitLab') >= 0, '8.2 GitLab 工作区：拒绝并指明待第二批')

  const no = runScript(['--issue', '1', '--body-file', body, '--dry-run'], wsNoDoc)
  check(no.status === 2 && no.stderr.indexOf('issue-tracker.md') >= 0, '8.3 没有主锚文件：拒绝并指明怎么认后端')
}

// ——— 9) 失败重试、失败留痕、已是目标状态不再发请求（用假 gh 离线演练，不碰真票） ———
{
  const fakeGh = path.join(TMP, 'fake-gh.mjs')
  const fakeLog = path.join(TMP, 'fake-gh.log')
  const fakeSrc = [
    "import { appendFileSync, readFileSync } from 'node:fs'",
    "const args = process.argv.slice(2)",
    "appendFileSync(process.env.FAKE_GH_LOG, 'issue ' + args.slice(1).join(' ') + '\\n')",
    "if (args[0] === 'issue' && args[1] === 'view') { process.stdout.write(JSON.stringify({ body: '旧正文' })); process.exit(0) }",
    "if (args[0] === 'issue' && args[1] === 'edit') { process.stderr.write('HTTP 422: Validation Failed（假 gh 故意让写回失败）\\n'); process.exit(1) }",
    "if (args[0] === 'issue' && args[1] === 'comment') { const i = args.indexOf('--body-file'); appendFileSync(process.env.FAKE_GH_LOG, 'COMMENT_BODY>>>' + readFileSync(args[i + 1], 'utf8') + '<<<\\n'); process.exit(process.env.FAKE_GH_COMMENT_FAIL === '1' ? 1 : 0) }",
    "process.stderr.write('假 gh 不认识的命令：' + args.join(' ') + '\\n'); process.exit(2)",
  ].join('\n')
  fs.writeFileSync(fakeGh, fakeSrc, 'utf8')

  const body = writeFixture('## 进度：90%\n\n下一步：等确认。\n')
  fs.writeFileSync(fakeLog, '', 'utf8')
  const r = runScript(['--issue', '571', '--body-file', body], wsGithub, { DSH_GH_PATH: fakeGh, FAKE_GH_LOG: fakeLog })
  const log = fs.readFileSync(fakeLog, 'utf8')
  check(r.status === 1 && r.json && r.json.ok === false, '9.1 写回失败：退出码 1 且 ok=false')
  check((log.match(/^issue edit/gm) || []).length === 2, '9.2 失败自动重试一次（issue edit 共调 2 次）')
  check(r.json && r.json.commented === true, '9.3 还失败就在该票下留评论（commented=true）')
  check(log.indexOf(SCRIPT_NAME) >= 0 && log.indexOf('--issue 571') >= 0 && log.indexOf('Validation Failed') >= 0, '9.4 失败评论含脚本名、参数与失败原因')

  fs.writeFileSync(fakeLog, '', 'utf8')
  const r2 = runScript(['--issue', '571', '--body-file', body], wsGithub, { DSH_GH_PATH: fakeGh, FAKE_GH_LOG: fakeLog, FAKE_GH_COMMENT_FAIL: '1' })
  check(r2.status === 1 && r2.json && r2.json.commented === false, '9.5 连评论也留不上：commented=false 且仍非零退出')

  fs.writeFileSync(fakeLog, '', 'utf8')
  const same = writeFixture('旧正文')
  const r3 = runScript(['--issue', '571', '--body-file', same], wsGithub, { DSH_GH_PATH: fakeGh, FAKE_GH_LOG: fakeLog })
  const log3 = fs.readFileSync(fakeLog, 'utf8')
  check(r3.status === 0 && r3.json && r3.json.changed.length === 0, '9.6 已经是目标状态：直接返回且 changed 为空')
  check((log3.match(/^issue edit/gm) || []).length === 0, '9.7 已经是目标状态：不再发写回请求（可重复跑）')
}

// ——— 10) 差分钉住真源 normalizeBody ———
{
  const cases = [
    '## 进度：90%\n\n下一步：等确认。\n',
    '\uFEFF## 进度：90%\n\n下一步：等确认。\n',
    '## 进度：90%\\n下一步：等确认。',
    '第一段。\n\n第二段里有字面 \\n 转义。\n\n第三段。\n',
    '单行正文\\n带字面转义\\n还有第二处',
    '',
    '普通正文，没有换行也没有转义。',
  ]
  let same = 0
  cases.forEach(function (text, i) {
    const r = dryRun(text, 900 + i)
    const expected = truthNormalize(text)
    if (r.json && r.json.body === expected) same++
    else check(false, '10.x 差分不一致（夹具 ' + (i + 1) + '）：脚本=' + JSON.stringify(r.json && r.json.body) + ' 真源=' + JSON.stringify(expected))
  })
  check(same === cases.length, '10.1 校正结果与真源 normalizeBody 逐字一致（' + same + '/' + cases.length + '）')
}

// ——— 11) 已接入 npm run verify 链 ———
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  check(String(pkg.scripts.verify || '').indexOf('verify-issue-body-script.js') >= 0, '11.1 npm run verify 链已纳入本门禁')
}

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响判定 */ }

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
