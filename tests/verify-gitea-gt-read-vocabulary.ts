#!/usr/bin/env node
// tests/verify-gitea-gt-read-vocabulary.ts —— 门禁：gt 双套词汇表与读路径接入（票 #22）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-gitea-gt-read-vocabulary.ts
//
// 规格（父票 #19 纵切第二步）定的口径：gt 路径的全部读操作（列票、读票、读评论）经词汇表
// 按 preflight 选中的执行器分派；tea 读路径代码零改动、输出与改动前一致。
// gt 的拼法与回包形状以票 #20 真机核对 + 2026-11-15 本机 gt 1.2.0 实测为准：
//   `gt issue list -R <ref> --state all --json -L N --page P [--label 名 …]`；
//   `gt issue view <编号> -R <ref> --json`；
//   `gt issue comment list <编号> -R <ref> --json -L N --page P`；
//   list 还有下一页时 stdout 尾部追加 `more results available; use --page N`（真末页不带）；
//   回包里 author / assignees 是登录名字符串，票号字段叫 number。
//
// 门禁盯五件事（全部只测外部行为，假 exec，与 verify-gitea-executor-preflight 同一接缝）：
//   ① 选中 gt 时三条读命令的参数逐字对上实测拼法；
//   ② gt 回包带提示行也能解析出行数组；真末页（无提示行）同样解析；
//   ③ author / assignees 字符串被适配成 {login} 形状，票号从 number 取到；
//   ④ 评论回包的 author 字符串同样适配（id 保持数字）；
//   ⑤ 选中 tea 时词汇表输出与改动前逐字节一致，执行仍走 exec('tea', …)。
// 门禁归属: src/tracker/rooms/gitea/support/tea-run.ts
// 门禁归属: src/tracker/rooms/gitea/support/gt-run.ts
// 门禁归属: src/tracker/rooms/gitea/issues/pages.ts
// 门禁归属: src/tracker/rooms/gitea/issues/read.ts
// 门禁归属: src/tracker/rooms/gitea/issues/counts.ts
// 门禁归属: src/tracker/rooms/gitea/room/prompts.ts
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

async function main() {
const teaRun = await import(url('src/tracker/rooms/gitea/support/tea-run.ts'))
const gtRun = await import(url('src/tracker/rooms/gitea/support/gt-run.ts'))
const promptMod = await import(url('src/tracker/rooms/gitea/room/prompts.ts'))
const { setSelectedExecutor } = promptMod

/** 假执行器：记下每次调用，按 cmd 查回包。 */
function makeExec(handler) {
  const calls = []
  const exec = async function (cmd, args, opts) {
    calls.push({ cmd: cmd, args: args, opts: opts })
    return handler(cmd, args, opts)
  }
  return { exec: exec, calls: calls }
}
/** gt 应答一份 list 回包（带不带提示行由调用方拼）。 */
function gtListHandler(stdout) {
  return function (cmd, args) {
    if (cmd !== 'gt') throw new Error('选中 gt 时执行器应该是 gt，实跑：' + cmd)
    if (args[0] === 'issue' && args[1] === 'list') return Promise.resolve({ code: 0, stdout: stdout, stderr: '' })
    return Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }
}
const ctx = () => makeExec(function () { return Promise.resolve({ code: 0, stdout: '', stderr: '' }) })

title('① 选中 gt：三条读命令的参数逐字对上实测拼法')
{
  setSelectedExecutor('gt')
  must(teaRun.readExecutor() === 'gt', 'readExecutor 读到 gt')
  must(
    JSON.stringify(teaRun.argsIssueListPage('o/r', 'all', ['bug', 'p1'], 100, 2)) ===
      JSON.stringify(['issue', 'list', '-R', 'o/r', '--state', 'all', '--json', '--limit', '100', '--page', '2', '--label', 'bug', '--label', 'p1']),
    'issue list：-R/--state/--json/-L/--page + 每标签一项 --label',
    JSON.stringify(teaRun.argsIssueListPage('o/r', 'all', ['bug', 'p1'], 100, 2)),
  )
  must(
    JSON.stringify(teaRun.argsIssueGet('o/r', 7)) === JSON.stringify(['issue', 'view', '7', '-R', 'o/r', '--json']),
    '单票：gt issue view <编号> -R <ref> --json',
    JSON.stringify(teaRun.argsIssueGet('o/r', 7)),
  )
  must(
    JSON.stringify(teaRun.argsCommentsPage('o/r', 7, 100, 3)) ===
      JSON.stringify(['issue', 'comment', 'list', '7', '-R', 'o/r', '--json', '--limit', '100', '--page', '3']),
    '评论：gt issue comment list <编号> -R <ref> --json -L/--page',
    JSON.stringify(teaRun.argsCommentsPage('o/r', 7, 100, 3)),
  )
  // 无标签时不许出现空 --label 项。
  must(
    JSON.stringify(teaRun.argsIssueListPage('o/r', 'open', [], 50, 1)).indexOf('--label') === -1,
    '无标签时不带 --label',
  )
}

title('② gt 回包带提示行也能解析（真末页不带提示行同样解析）')
{
  setSelectedExecutor('gt')
  const row = JSON.stringify({ number: 6, state: 'open', title: 't' })
  const withHint = '[' + row + ',' + row.replace('6', '5') + ']\nmore results available; use --page 2\n'
  const r1 = teaRun.parseReadRows(withHint)
  must(Array.isArray(r1) && r1.length === 2, '带提示行的 list 回包解析出 2 行', JSON.stringify(r1))
  const r2 = teaRun.parseReadRows('[' + row + ']\n')
  must(Array.isArray(r2) && r2.length === 1, '真末页（无提示行）照常解析')
  must(gtRun.stripGtHint('[{"a":1}]\nmore results available; use --page 2\n') === '[{"a":1}]', 'stripGtHint 只剥提示行与尾部空行')
  must(teaRun.parseReadRows('不是 JSON') === null, '非法回包仍回 null（形状不对的档位不变）')
}

title('③ author/assignees 字符串适配成 {login}，票号从 number 取到')
{
  setSelectedExecutor('gt')
  const raw = {
    number: 6, title: '[真机验证] C 被阻塞', state: 'open',
    author: 'zhaolj', assignees: ['zhaolj', ''], body: 'x', comments: 3,
    labels: [{ name: 'l', color: 'aa1122' }], url: 'https://gitea.example/o/r/issues/6',
  }
  const norm = await import(url('src/tracker/rooms/gitea/model/normalize.ts'))
  const adapted = teaRun.parseReadRows(JSON.stringify([raw]))[0]
  const out = norm.normalizeIssue(adapted)
  must(out.key === '6', '票号从 gt 的 number 字段取到', JSON.stringify(out.key))
  must(out.author && out.author.login === 'zhaolj', 'author 字符串适配成 {login}', JSON.stringify(out.author))
  must(Array.isArray(out.assignees) && out.assignees.length === 1 && out.assignees[0].login === 'zhaolj', 'assignees 字符串数组适配成 {login} 数组', JSON.stringify(out.assignees))
  must(out.commentCount === 3, 'comments 数字段进 commentCount')
  must(out.labels.length === 1 && out.labels[0].color === 'aa1122', 'labels 对象形状照常归一')
}

title('④ 评论回包的 author 字符串同样适配（id 保持数字）')
{
  setSelectedExecutor('gt')
  const rows = teaRun.parseReadRows(JSON.stringify([{ id: 926, author: 'zhaolj', body: 'c', created_at: '2026-11-15T09:25:18+08:00' }]))
  const norm = await import(url('src/tracker/rooms/gitea/model/normalize.ts'))
  // 与 read.ts fetchComments 同一条口径：行数组塞进票面 notes 后由 normalizeComments 消费。
  const bag = { index: 8, title: 't', state: 'open', comments: rows }
  const out = norm.normalizeIssue(bag)
  must(out.comments.length === 1 && out.comments[0].author.login === 'zhaolj', '评论 author 字符串适配成 {login}', JSON.stringify(out.comments))
  must(out.comments[0].id === '926', '评论 id 保持数字再转字符串')
}

title('⑤ 选中 tea：词汇表输出与改动前逐字节一致，执行仍走 exec(tea)')
{
  setSelectedExecutor('tea')
  must(teaRun.readExecutor() === 'tea', 'readExecutor 读到 tea')
  must(promptMod.prompts.commandVocabulary.cli === 'tea', '词表 cli getter 同步为 tea')
  must(
    JSON.stringify(teaRun.argsIssueListPage('o/r', 'all', ['bug'], 100, 2)) ===
      JSON.stringify(['issues', 'ls', '--repo', 'o/r', '--state', 'all', '--output', 'json', '--limit', '100', '--page', '2', '--fields', 'index,title,state,author,milestone,labels,owner,repo,url', '--labels', 'bug']),
    'tea 列表页参数与改动前逐字节一致',
    JSON.stringify(teaRun.argsIssueListPage('o/r', 'all', ['bug'], 100, 2)),
  )
  must(
    JSON.stringify(teaRun.argsIssueGet('o/r', 7)) === JSON.stringify(['issues', '7', '--repo', 'o/r', '--output', 'json']),
    'tea 单票参数不变',
  )
  must(
    JSON.stringify(teaRun.argsCommentsPage('o/r', 7, 100, 3)) ===
      JSON.stringify(['issues', '7', 'comments', '--repo', 'o/r', '--output', 'json', '--limit', '100', '--page', '3']),
    'tea 评论参数不变',
  )
  const bag = makeExec(function (cmd, args) {
    return Promise.resolve({ code: 0, stdout: JSON.stringify([{ index: 7, title: 't', state: 'open', author: { login: 'a' } }]), stderr: '' })
  })
  const res = await teaRun.runRead({ exec: bag.exec, cwd: 'D:/demo' }, teaRun.argsIssueListPage('o/r', 'all', [], 50, 1))
  must(res.code === 0 && bag.calls.length === 1 && bag.calls[0].cmd === 'tea', 'tea 选中时执行器仍是 exec(tea, …)', JSON.stringify(bag.calls.map((c) => c.cmd)))
  must(bag.calls[0].opts && bag.calls[0].opts.timeout === 10000, 'tea 读超时仍是 10 秒整档')
  const rows = teaRun.parseReadRows(res.stdout)
  must(Array.isArray(rows) && rows[0].author.login === 'a', 'tea 回包不经 gt 适配、原样解析')
  // 缺执行器：127 如实回（两条分支同一口径）。
  const noExec1 = await teaRun.runRead(null, ['x'])
  must(noExec1.code === 127, '缺执行器回 127')
}

  console.log('\n共 ' + total + ' 条不变式' + (broken.length ? '，破 ' + broken.length + ' 条' : '，全绿'))
  if (broken.length) {
    for (const b of broken) console.log('BROKEN ' + b)
    process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
