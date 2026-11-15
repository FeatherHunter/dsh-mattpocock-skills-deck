#!/usr/bin/env node
// tests/verify-gitea-gt-write-vocabulary.ts —— 门禁：gt 写路径接入（票 #23）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-gitea-gt-write-vocabulary.ts
//
// 票 #23 定的口径：gt 路径的全部写操作（建票、关票、重开、改票、写评论、建标签、改色、
// setLabels/setAssignees）经词汇表按 preflight 选中的执行器分派；tea 写路径代码零改动、
// 行为与改动前一致。gt 的拼法以票 #20 真机核对 + 2026-11-15 本机 gt 1.2.0 实测为准：
//   gt issue create -R <ref> --title T [--body D] [--label 名]* [--assignee 登录名]* --json
//   gt issue close|reopen <编号> -R <ref> --json
//   gt issue edit <编号> -R <ref> [--title T] [--body D] [--add-label 名]* [--remove-label 名]*
//                   [--set-labels a,b] [--set-assignees a,b] --json
//   gt issue comment <编号> -R <ref> --body 正文 --json
//   gt label list -R <ref> --json -L/--page；gt label create <名> --color 色 -R <ref> --json；
//   gt label edit <数字id> --color 色 -R <ref> --json
//
// 门禁盯七件事（全部只测外部行为，假 exec，与 verify-gitea-gt-read-vocabulary 同一接缝）：
//   ① 选中 gt 时写命令的参数逐字对上实测拼法（create/close/reopen/edit/comment/标签三口）；
//   ② 建票编号从 --json 回包的 number 读到（成功 / 缺 number / 非 JSON 各档，失败不猜编号）；
//   ③ gt 错误判档结构化：退出码 4 带 auth 档、2 带 parse 档、其余取 GITEA_CLI_ERROR_FORMAT=json
//     的 JSON 错误行 message，没设时退回 stderr 文本兜底；
//   ④ gt 的 setLabels 走 --set-labels 整集替换一步到位；tea 仍按差集发 --add-labels/--remove-labels；
//   ⑤ runWrite/runRead 同一条分派：gt 选中走 exec('gt', …)，tea 选中走 exec('tea', …)；
//   ⑥ 选中 tea 时写词汇输出与改动前逐字节一致（tea 写路径零改动的行为证据）；
//   ⑦ 评论与标签清单的回包按执行器各自解析（gt 剥提示行、tea 原样）。
// 门禁归属: src/tracker/rooms/gitea/support/tea-run.ts
// 门禁归属: src/tracker/rooms/gitea/support/gt-run.ts
// 门禁归属: src/tracker/rooms/gitea/issues/write.ts
// 门禁归属: src/tracker/rooms/gitea/comments/write.ts
// 门禁归属: src/tracker/rooms/gitea/graph/write.ts
// 门禁归属: src/tracker/rooms/gitea/labels/assign.ts
// 门禁归属: src/tracker/rooms/gitea/labels/colors.ts
// 门禁归属: src/tracker/rooms/gitea/labels/list.ts
// 门禁归属: src/tracker/rooms/gitea/room/prompts.ts
const nodePath = require('path')
const fs = require('fs')
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
// 里程碑空串口径的出处文件（票 #26）：update 对 milestone:null 产生空串，两分支都从这里走。
const writeMod = await import(url('src/tracker/rooms/gitea/issues/write.ts'))

/** 假执行器：记下每次调用，按 handler 应答。 */
function makeExec(handler) {
  const calls = []
  const exec = async function (cmd, args, opts) {
    calls.push({ cmd: cmd, args: args, opts: opts })
    return handler(cmd, args, opts)
  }
  return { exec: exec, calls: calls }
}
const okExec = () => makeExec(function () { return Promise.resolve({ code: 0, stdout: '', stderr: '' }) })

title('① 选中 gt：写命令参数逐字对上实测拼法')
{
  setSelectedExecutor('gt')
  must(
    JSON.stringify(teaRun.argsIssueCreate('o/r', '标题', '正文', ['bug', 'p1'], ['zhaolj'])) ===
      JSON.stringify(['issue', 'create', '-R', 'o/r', '--title', '标题', '--body', '正文', '--label', 'bug', '--label', 'p1', '--assignee', 'zhaolj', '--json']),
    'create：gt issue create -R --title --body + 每标签一项 --label + --assignee + --json',
    JSON.stringify(teaRun.argsIssueCreate('o/r', '标题', '正文', ['bug', 'p1'], ['zhaolj'])),
  )
  must(
    JSON.stringify(teaRun.argsIssueCreate('o/r', '标题', '', [], [])) ===
      JSON.stringify(['issue', 'create', '-R', 'o/r', '--title', '标题', '--json']),
    'create：空正文不带 --body，空标签/认领人不带空项',
  )
  must(
    JSON.stringify(teaRun.argsIssueClose('o/r', 7)) === JSON.stringify(['issue', 'close', '7', '-R', 'o/r', '--json']),
    'close：gt issue close <编号> -R <ref> --json',
  )
  must(
    JSON.stringify(teaRun.argsIssueReopen('o/r', 7)) === JSON.stringify(['issue', 'reopen', '7', '-R', 'o/r', '--json']),
    'reopen：gt issue reopen <编号> -R <ref> --json',
  )
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { title: '新标题', description: '新正文', addLabels: ['a', 'b'], removeLabels: ['c'], setLabels: ['x', 'y'], setAssignees: 'z', milestone: 'v1' })) ===
      JSON.stringify(['issue', 'edit', '7', '-R', 'o/r', '--title', '新标题', '--body', '新正文', '--add-label', 'a', '--add-label', 'b', '--remove-label', 'c', '--set-labels', 'x,y', '--set-assignees', 'z', '--milestone', 'v1', '--json']),
    'edit：--title/--body + 每标签一项 --add-label/--remove-label + --set-labels/--set-assignees/--milestone + --json',
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { title: '新标题', description: '新正文', addLabels: ['a', 'b'], removeLabels: ['c'], setLabels: ['x', 'y'], setAssignees: 'z', milestone: 'v1' })),
  )
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { setLabels: [] })) ===
      JSON.stringify(['issue', 'edit', '7', '-R', 'o/r', '--set-labels', '', '--json']),
    'edit：setLabels 空数组 = --set-labels 空串（清空语义）',
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { setLabels: [] })),
  )
  must(
    JSON.stringify(teaRun.argsCommentAdd('o/r', 7, '评注')) ===
      JSON.stringify(['issue', 'comment', '7', '-R', 'o/r', '--body', '评注', '--json']),
    'comment：gt issue comment <编号> -R <ref> --body <正文> --json',
  )
  must(
    JSON.stringify(teaRun.argsLabelsPage('o/r', 50, 2)) ===
      JSON.stringify(['label', 'list', '-R', 'o/r', '--json', '--limit', '50', '--page', '2']),
    '标签清单：gt label list -R --json --limit --page',
  )
  must(
    JSON.stringify(teaRun.argsLabelCreate('o/r', '新标签')) ===
      JSON.stringify(['label', 'create', '新标签', '--color', '00aabb', '-R', 'o/r', '--json']),
    '建标签：gt label create <名> --color -R --json',
  )
  must(
    JSON.stringify(teaRun.argsLabelUpdate('o/r', 12, 'aabbcc')) ===
      JSON.stringify(['label', 'edit', '12', '--color', 'aabbcc', '-R', 'o/r', '--json']),
    '改色：gt label edit <数字id> --color -R --json（认 id 不认名字）',
  )
}

title('② 建票编号从 --json 回包的 number 读到（三档）')
{
  must(gtRun.createdIssueNumberOf(JSON.stringify({ number: 42, title: 't' })) === '42', '成功档：单对象 number 读出 42')
  must(gtRun.createdIssueNumberOf(JSON.stringify({ title: 't' })) === null, '缺 number：回 null（不猜编号）')
  must(gtRun.createdIssueNumberOf('不是 JSON') === null, '非 JSON：回 null（不猜编号）')
  must(gtRun.createdIssueNumberOf(JSON.stringify({ number: 0 })) === null, 'number 为 0/负数：回 null')
  must(gtRun.createdIssueNumberOf(JSON.stringify({ number: '42' })) === '42', 'number 是数字串也收')
}

title('③ gt 错误判档结构化（退出码 + JSON 错误行）')
{
  const e4 = gtRun.gtFailureError({ code: 4, stdout: '', stderr: 'auth 缺失' }, null)
  must(e4.kind === 'auth', '退出码 4：Error 带 auth 档（判档表 carriedKind 透传）', String(e4.kind))
  const e2 = gtRun.gtFailureError({ code: 2, stdout: '', stderr: 'unknown flag: --nope' }, null)
  must(e2.kind === 'parse', '退出码 2：Error 带 parse 档（词汇表拼错旗标不是远端问题）', String(e2.kind))
  const jsonLine = '{"error":{"code":1,"kind":"failure","message":"issue #999999 not found in o/r","status":404}}\n'
  const eJson = gtRun.gtFailureError({ code: 1, stdout: '', stderr: jsonLine }, null)
  must(eJson.message === 'issue #999999 not found in o/r', '其余退出码：消息取 JSON 错误行的 message', eJson.message)
  must(eJson.status === 404, 'JSON 错误行的 status 带上（判档事实层可见）', String(eJson.status))
  const eText = gtRun.gtFailureError({ code: 1, stdout: '', stderr: '纯文本错误' }, null)
  must(eText.message === '纯文本错误' && eText.kind === undefined, '没设 JSON 格式：退回 stderr 文本，不带档位（判档表按文字判）', eText.message)
  must(gtRun.parseGtJsonError('{"error":{}}') === null, 'JSON 错误行缺 message：回 null 走文本兜底')
  must(gtRun.parseGtJsonError('{"error":123}') === null, 'error 不是对象：回 null')
  must(gtRun.parseGtJsonError('') === null, '空 stderr：回 null')
}

title('④ setLabels：gt 走 --set-labels 整集替换，tea 仍按差集增删')
{
  setSelectedExecutor('gt')
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { setLabels: ['a', 'b'] })).indexOf('--set-labels') !== -1,
    'gt 选中：setLabels 字段拼成 --set-labels a,b',
  )
  setSelectedExecutor('tea')
  const teaArgs = teaRun.argsIssueEdit('o/r', 7, { setLabels: ['ignored'], addLabels: ['a'], removeLabels: ['b'] })
  must(JSON.stringify(teaArgs).indexOf('--set-labels') === -1, 'tea 选中：setLabels 字段被忽略（tea 没有整集替换旗标）', JSON.stringify(teaArgs))
  must(JSON.stringify(teaArgs).indexOf('--add-labels') !== -1 && JSON.stringify(teaArgs).indexOf('--remove-labels') !== -1, 'tea 选中：差集增删旗标照常', JSON.stringify(teaArgs))
}

title('⑤ runWrite/runRead 同一条分派')
{
  setSelectedExecutor('gt')
  const gBag = okExec()
  await teaRun.runWrite({ exec: gBag.exec, cwd: 'D:/demo' }, teaRun.argsIssueClose('o/r', 7))
  must(gBag.calls[0] && gBag.calls[0].cmd === 'gt', 'gt 选中：runWrite 走 exec(gt, …)', JSON.stringify(gBag.calls.map((c) => c.cmd)))
  const rBag = okExec()
  await teaRun.runRead({ exec: rBag.exec, cwd: 'D:/demo' }, teaRun.argsLabelsPage('o/r', 50, 1))
  must(rBag.calls[0] && rBag.calls[0].cmd === 'gt', 'gt 选中：runRead 走 exec(gt, …)')
  setSelectedExecutor('tea')
  const tBag = okExec()
  await teaRun.runWrite({ exec: tBag.exec, cwd: 'D:/demo' }, teaRun.argsIssueClose('o/r', 7))
  must(tBag.calls[0] && tBag.calls[0].cmd === 'tea', 'tea 选中：runWrite 走 exec(tea, …)')
  const noExec = await teaRun.runWrite(null, ['x'])
  must(noExec.code === 127, '缺执行器：runWrite 回 127（与 runRead 同口径）')
}

title('⑥ 选中 tea：写词汇输出与改动前逐字节一致')
{
  setSelectedExecutor('tea')
  must(
    JSON.stringify(teaRun.argsIssueCreate('o/r', '标题', '正文', ['bug'], ['zhaolj'])) ===
      JSON.stringify(['issues', 'create', '--repo', 'o/r', '--title', '标题', '--description', '正文', '--labels', 'bug', '--assignees', 'zhaolj']),
    'tea create 参数与改动前逐字节一致',
    JSON.stringify(teaRun.argsIssueCreate('o/r', '标题', '正文', ['bug'], ['zhaolj'])),
  )
  must(
    JSON.stringify(teaRun.argsIssueClose('o/r', 7)) === JSON.stringify(['issues', 'close', '7', '--repo', 'o/r', '--output', 'json']),
    'tea close 参数不变',
  )
  must(
    JSON.stringify(teaRun.argsIssueReopen('o/r', 7)) === JSON.stringify(['issues', 'reopen', '7', '--repo', 'o/r', '--output', 'json']),
    'tea reopen 参数不变',
  )
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { title: 'T', description: 'D', addLabels: ['a'], removeLabels: ['b'], setAssignees: 'z', milestone: 'M' })) ===
      JSON.stringify(['issues', 'edit', '7', '--repo', 'o/r', '--title', 'T', '--description', 'D', '--add-labels', 'a', '--remove-labels', 'b', '--set-assignees', 'z', '--milestone', 'M', '--output', 'json']),
    'tea edit 参数不变（无 --set-labels 出现）',
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { title: 'T', description: 'D', addLabels: ['a'], removeLabels: ['b'], setAssignees: 'z', milestone: 'M' })),
  )
  must(
    JSON.stringify(teaRun.argsCommentAdd('o/r', 7, '评注')) ===
      JSON.stringify(['comments', 'add', '7', '--repo', 'o/r', '--description', '评注', '--output', 'json']),
    'tea comment 参数不变',
  )
  must(
    JSON.stringify(teaRun.argsLabelsPage('o/r', 50, 2)) ===
      JSON.stringify(['labels', 'ls', '--repo', 'o/r', '--output', 'json', '--limit', '50', '--page', '2']),
    'tea 标签清单参数不变',
  )
  must(
    JSON.stringify(teaRun.argsLabelCreate('o/r', '新标签')) ===
      JSON.stringify(['labels', 'create', '--name', '新标签', '--color', '00aabb', '--repo', 'o/r', '--output', 'json']),
    'tea 建标签参数不变',
  )
  must(
    JSON.stringify(teaRun.argsLabelUpdate('o/r', 12, 'aabbcc')) ===
      JSON.stringify(['labels', 'update', '--id', '12', '--color', 'aabbcc', '--repo', 'o/r', '--output', 'json']),
    'tea 改色参数不变',
  )
  // tea 的建票编号仍是抠 #编号 文本：改动前后同一条路。
  must(teaRun.createdKeyFrom('Created issue #42 on o/r') === '42', 'tea 选中：建票编号仍抠 #编号 文本')
  must(gtRun.createdIssueNumberOf('Created issue #42 on o/r') === null, 'gt 的回读不吃 tea 的文本回包（两条路不串）')
  // 失败文案也按执行器给命令原文（票 #23 评审收编）：tea 侧与票 #12 改动前逐字一致。
  must(
    teaRun.writeFailureTexts('create').fallback === 'create: tea issues create 失败' &&
      teaRun.writeFailureTexts('create').human === '建票失败：tea issues create 没有跑成。请稍后重试。',
    'tea 选中：create 失败文案与改动前逐字节一致',
  )
  must(
    teaRun.writeFailureTexts('setAssignees').fallback === 'setAssignees: tea issues edit 失败' &&
      teaRun.writeFailureTexts('setBlockedBy').human === '改阻塞关系失败：tea issues edit 没有跑成。请稍后重试。',
    'tea 选中：edit 系失败文案与改动前逐字节一致',
    JSON.stringify([teaRun.writeFailureTexts('setAssignees'), teaRun.writeFailureTexts('setBlockedBy')]),
  )
}

title('⑥b 选中 gt：失败文案带 gt 的真实命令原文')
{
  setSelectedExecutor('gt')
  must(
    teaRun.writeFailureTexts('create').fallback === 'create: gt issue create 失败' &&
      teaRun.writeFailureTexts('comment').human === '写评论失败：gt issue comment 没有跑成。请稍后重试。',
    'gt 选中：失败文案写的是 gt 的命令',
    JSON.stringify([teaRun.writeFailureTexts('create'), teaRun.writeFailureTexts('comment')]),
  )
  setSelectedExecutor('tea')
}

title('⑦ 回包按执行器各自解析')
{
  setSelectedExecutor('gt')
  const gtRow = JSON.stringify({ name: 'l', color: 'aa1122', id: 12 })
  const withHint = '[' + gtRow + ']\nmore results available; use --page 2\n'
  must(Array.isArray(teaRun.parseReadRows(withHint)) && teaRun.parseReadRows(withHint).length === 1, 'gt 标签清单：带提示行剥掉后解析出 1 行')
  setSelectedExecutor('tea')
  must(teaRun.parseReadRows(withHint) === null, 'tea 选中：gt 的带提示行回包不成形状（如实回 null）')
}

title("⑧ 里程碑清空口径钉死（票 #27，依据 2026-11-16 真机实测：gt --milestone '' 退出码 2，清空唯一方式 --remove-milestone）")
{
  // 真机结论（2026-11-16 实测，记录在 docs/research/gitea-cli-gt-migration-2026-11-12.md 第 6 条）：
  // gt 1.2.0 的 issue edit --milestone '' 退出码 2（用法错），清里程碑唯一方式 --remove-milestone，
  // 回读 milestone 为 null，与 tea 的 --milestone "" 清空语义对齐。插件口径（票 #27）：契约层
  // 统一「清空给空串」，gt 分支在词汇表把空串转译成 --remove-milestone，tea 分支照值直传不变。
  const issueBag = JSON.stringify({ number: 7, title: 't', state: 'open', body: '', url: '', index: 7 })

  // 8.1 gt 分支空串转清空旗标：milestone:'' 拼出 --remove-milestone，绝不直传 --milestone ''（直传退出码 2）。
  setSelectedExecutor('gt')
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { milestone: '' })) ===
      JSON.stringify(['issue', 'edit', '7', '-R', 'o/r', '--remove-milestone', '--json']),
    "gt：milestone 空串转译成 --remove-milestone（2026-11-16 真机口径：--milestone '' 退出码 2，--remove-milestone 清空对齐 tea 语义）",
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { milestone: '' })),
  )
  must(
    JSON.stringify(teaRun.argsIssueEdit('o/r', 7, { milestone: '' })).indexOf('"--milestone",""') === -1,
    'gt：清空绝不直传成 --milestone 空串（直传在 gt 1.2.0 是退出码 2 的用法错，行为漂移先挡在门禁）',
  )
  // gt 选中时 update 对 milestone:null 实际发出 --remove-milestone（假 exec 记参验证）。
  {
    const bag = okExec()
    bag.exec = async function (cmd, args) { bag.calls.push({ cmd, args }); return { code: 0, stdout: issueBag, stderr: '' } }
    const up = await writeMod.updateIssue({ exec: bag.exec, cwd: '' }, { refId: 'o/r' }, '7', { milestone: null }, null)
    must(up && up.ok === true, 'gt：update(milestone:null) 写成功（回包可直接归一，不触发回查）', JSON.stringify(up && up.error))
    must(bag.calls.length === 1, 'gt：update 只发一条 edit 命令（不发额外读）', JSON.stringify(bag.calls.map((c) => c.cmd)))
    const gtArgs = bag.calls[0] && bag.calls[0].args ? bag.calls[0].args : []
    must(gtArgs.indexOf('--remove-milestone') !== -1, 'gt：update(milestone:null) 实际发出 --remove-milestone', JSON.stringify(gtArgs))
    must(!(gtArgs.includes('--milestone') && gtArgs[gtArgs.indexOf('--milestone') + 1] === ''), 'gt：update(milestone:null) 绝不直传 --milestone 空串（直传退出码 2）', JSON.stringify(gtArgs))
  }

  // 8.2 空串口径出处：write.ts 对 milestone:null 产生 fields.milestone = ''（契约层统一口径），tea 分支同样成立。
  setSelectedExecutor('tea')
  {
    const bag = okExec()
    bag.exec = async function (cmd, args) { bag.calls.push({ cmd, args }); return { code: 0, stdout: issueBag, stderr: '' } }
    const up = await writeMod.updateIssue({ exec: bag.exec, cwd: '' }, { refId: 'o/r' }, '7', { milestone: null }, null)
    must(up && up.ok === true, 'tea：update(milestone:null) 写成功', JSON.stringify(up && up.error))
    const args = bag.calls[0] && bag.calls[0].args
    const i = args ? args.indexOf('--milestone') : -1
    must(i !== -1 && args[i + 1] === '', "tea：update(milestone:null) 的编辑参数里 milestone 值恰为空串（清空口径：--milestone ''）", JSON.stringify(args))
    must(args && args[0] === 'issues' && args[1] === 'edit' && args[2] === '7', 'tea：update 发的是 issues edit <编号>（命令形状不漂）', JSON.stringify(args))
  }
  // 口径注释防漂移：write.ts 里「清空给空串」契约口径与 gt 转译说明两处注释还在，文字改了就响门禁。
  const writeSrc = fs.readFileSync(nodePath.join(ROOT, 'src/tracker/rooms/gitea/issues/write.ts'), 'utf8')
  must(
    writeSrc.indexOf('给名字，清空给空串') !== -1,
    'write.ts 注释里的契约层空串口径文字仍在（防口径漂移）',
  )
  const teaRunSrc = fs.readFileSync(nodePath.join(ROOT, 'src/tracker/rooms/gitea/support/tea-run.ts'), 'utf8')
  must(
    teaRunSrc.indexOf('--remove-milestone') !== -1 && teaRunSrc.indexOf('空串转译') !== -1,
    'tea-run.ts 词汇表注释写明 gt 空串转译口径（语义词防漂移，不钉措辞日期）',
  )
  setSelectedExecutor('tea')
}

  console.log('\n共 ' + total + ' 条不变式' + (broken.length ? '，破 ' + broken.length + ' 条' : '，全绿'))
  if (broken.length) {
    for (const b of broken) console.log('BROKEN ' + b)
    process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
