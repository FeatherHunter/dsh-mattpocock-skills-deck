// 门禁归属: src/shared/version-control/src/stash-rules.ts
// 贮藏页十条（#1751 T16，规格 #1586 域 7）门禁：规则层、宿主真跑、界面叶子与端到端冒烟，每组带反证。
// 夹具：真 git 临时仓库（每条场景自己造）+ 与 verify-841 同形状的 subprocess 垫片（argv 直传、不经 shell）。
// 界面叶子按构建同一份拼接口径求值（spliceableJs，与 818 的 buildView 同一条路），不 import 模块。
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-stash-page'
let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
}
function mkRepo(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1751-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main'])
  git(base, ['config', 'user.name', 'x'])
  git(base, ['config', 'user.email', 'x@y'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\n')
  git(base, ['add', '-A'])
  git(base, ['commit', '-q', '-m', '基线'])
  return base
}
const write = (base, name, text) => fs.writeFileSync(path.join(base, name), text)
const readFile = (base, name) => fs.readFileSync(path.join(base, name), 'utf8')
const cleanTree = (base) => { git(base, ['checkout', '--', '.']); fs.rmSync(path.join(base, 'b.txt'), { force: true }) }

// 票据组的两个观测点：时钟可拨（判过期）与进程日志（判拒绝发生在起 git 之前）。
let clockNow = 1000
const spawnLog = []

function makeVc() {
  const deps = {
    subprocess: {
      spawn(req) {
        spawnLog.push(req.argv.join(' '))
        const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 })
        const mk = (b) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) })
        return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk(r.stdout), stderr: mk(r.stderr) }, terminate() {} }
      },
    },
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fs: {
      stat: async (p) => await fs.promises.stat(p),
      lstat: async (p) => await fs.promises.lstat(p),
      exists: async (p) => { try { await fs.promises.access(p); return true } catch (e) { return false } },
    },
    getPlatform: async () => ({ resolveExecutable: async (n) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT,
    TIMEOUT_MS: 30000,
    gate: { noteOutbound() {} },
    logCtx: { fire() {} },
    now: () => clockNow,
  }
  return vcMod.createVersionControl(deps)
}

// 界面叶子按构建同一份拼接口径求值：共享规则 → 同层叶子 → 基础画法 → 贮藏页。
function buildStashLeaves() {
  const files = [
    'src/shared/version-control/src/stash-rules.ts',
    'src/client/views/versionControl/vcStashOps.ts',
    'src/client/views/versionControl/vcShellPrimitives.ts',
    'src/client/views/versionControl/vcStashDetail.ts',
    'src/client/views/versionControl/vcStashPage.ts',
  ]
  const src = files.map((f) => spliceableJs(f)).join('\n')
  // 真实构建里全局提示叶子 Tip 拼在所有视图叶子之前；这里给一个同形状垫片：把子节点原样交出去，
  // 叶子测试只关心「提示挂上没挂上、正文里的字对不对」，悬停面板本身由 818 与浏览器门禁去看。
  const tipStub = 'const Tip = function (props) { return (props && props.children !== undefined) ? props.children : null }\n'
  const body = tipStub + src + '\nreturn { STASH_OPS, VC_STASH_STAGED_OP, STASH_STAGED_MIN_VERSION, vcStashPageNode, vcStashStateNew, vcStashStagedStateOf, vcStashActionPayloadOf, vcStashApplyReply, vcStashFailKeyOf, vcStashOpVersionStateOf, vcStashConfirmOf, vcStashConfirmPayloadOf, vcStashWhenOf, vcStashShortOidOf, vcStashNeedsTicketOf, vcStashRequestIdOf, vcStashCheckCallOf, vcStashWriteCallOf, vcStashCheckConfirmOf, vcStashBranchPrefillOf }\n'
  return compileFn([], body)()
}

function fakeH(tag, props) {
  const children = []
  for (let i = 2; i < arguments.length; i += 1) {
    const c = arguments[i]
    if (Array.isArray(c)) children.push.apply(children, c.filter(Boolean))
    else if (c !== null && c !== undefined && c !== false) children.push(c)
  }
  return { type: tag, props: props || {}, children: children }
}
function findAll(node, pred, out) {
  const acc = out || []
  if (!node || typeof node !== 'object') return acc
  if (pred(node)) acc.push(node)
  const kids = Array.isArray(node.children) ? node.children : []
  for (let i = 0; i < kids.length; i += 1) findAll(kids[i], pred, acc)
  return acc
}
const attrsOf = (node, name) => findAll(node, (n) => n.props && n.props[name] !== undefined).map((n) => n.props[name])
const fakeT = (key, vars) => key + (vars ? '|' + JSON.stringify(vars) : '')

function firstScreenSeed(entries, gitVersion) {
  return {
    contract: 'first-screen', version: 1, readAtMs: 1000,
    slices: {
      workspace: { state: 'ok', data: {} }, changes: { state: 'ok', data: {} }, history: { state: 'ok', data: {} }, worktrees: { state: 'ok', data: {} },
      stashes: { state: 'ok', data: { entries: entries || [] }, error: null },
      sync: { state: 'ok', data: {} },
      version: { state: 'ok', data: { gitVersion: gitVersion || 'git version 2.49.0', tier: 'full', switches: [] } },
    },
  }
}
const entry = (n) => ({ selector: 'stash@{' + n + '}', oid: ('a' + n).repeat(20).slice(0, 40), atMs: 1700000000000 + n * 1000, subject: '第' + n + '条贮藏' })

let vcMod = null
async function main() {
  console.log('贮藏页十条门禁（#1751：规则 / 宿主真跑 / 界面叶子 / 端到端冒烟）')
  vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const rules = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'stash-rules.js')).href)
  const cmds = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'commands.js')).href)
  const parsed = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'parse-stash.js')).href)

  // 写动作的调用姿势与界面一致：先预检签票（wf.gitStashCheck），再凭票执行（wf.gitStash）。
  // 读动作（list / show）不签票，票据层直接放行，所以这里也直接调执行电话。
  async function stashDo(vc: any, input: any): Promise<any> {
    if (!rules.stashNeedsTicketOf(input.op)) return await vc.handleGitStash(input)
    const pre = await vc.handleGitStashCheck(input)
    if (!pre.ok) return pre
    return await vc.handleGitStash(Object.assign({}, input, { ticketId: pre.ticket.id }))
  }

  // ---------- A 规则层：十条唯一名单、命令拼装、校验、版本门与恢复路径 ----------
  console.log('A 规则层（十条名单 / argv / 校验 / 版本门 / 恢复）')
  check(Array.isArray(rules.STASH_OPS) && rules.STASH_OPS.length === 10, '十条贮藏动作全部登记，不多不少')
  check(rules.STASH_OPS.map((o) => o.id).join(',') === '7.1,7.2,7.3,7.4,7.5,7.6,7.7,7.8,7.9,7.10', '能力编号按账本 7.1–7.10 排，界面按同一个次序画')
  check(rules.STASH_OPS.map((o) => o.op).join(',') === 'push,push-untracked,push-staged,list,show,apply,pop,branch,drop,clear', '动作短名与 git 子命令一一对应')
  check(rules.STASH_OPS.every((o) => typeof o.nameKey === 'string' && o.nameKey.indexOf('vc.stash.op.') === 0), '每条动作都有词条键，界面不印裸动作名')
  check(rules.stashDangerOpsOf().join(',') === 'drop,clear', '危险动作只有删除与清空两条')
  check(rules.stashOpOf('push').id === '7.1' && rules.stashOpById('7.10').op === 'clear' && rules.stashOpOf('nope') === null, '按短名与按编号都认人，认不出回 null')
  const argvOf = (op, p) => rules.stashOperationArgs(op, p || {})
  const msg = '这批改动'
  check(argvOf('push', { message: msg }).args.join('|') === 'stash|push|-m|' + msg, '7.1 贮藏带 -m 说明')
  check(argvOf('push-untracked', { message: msg }).args.join('|') === '--no-literal-pathspecs|stash|push|-u|-m|' + msg, '7.2 连未跟踪文件一起贮藏，并在子命令前关掉 --literal-pathspecs（否则 git 静默不收未跟踪文件）')
  check(argvOf('push-staged', { message: msg }).args.join('|') === 'stash|push|--staged|-m|' + msg, '7.3 只贮藏已暂存的文件（--staged）')
  const listArgv = argvOf('list').args
  check(listArgv.join('|') === cmds.stashListArgs().join('|'), '7.4 列表 argv 与 commands.stashListArgs 逐项一致（不写第二份格式）')
  check(argvOf('show', { selector: 'stash@{0}' }).args.join('|') === 'stash|show|-p|stash@{0}', '7.5 查看内容是 stash show -p')
  check(argvOf('apply', { selector: 'stash@{0}' }).args.join('|') === 'stash|apply|stash@{0}', '7.6 应用保留记录（apply）')
  check(argvOf('pop', { selector: 'stash@{0}' }).args.join('|') === 'stash|pop|stash@{0}', '7.7 应用并删记录（pop）')
  check(argvOf('branch', { selector: 'stash@{0}', branch: 'feature/x' }).args.join('|') === 'stash|branch|feature/x|stash@{0}', '7.8 从贮藏建分支（新分支名在提交号前）')
  check(argvOf('drop', { selector: 'stash@{0}' }).args.join('|') === 'stash|drop|stash@{0}', '7.9 删除单条（drop）')
  check(argvOf('clear').args.join('|') === 'stash|clear', '7.10 清空全部（clear）')
  check(argvOf('push', { message: '' }).ok === false && argvOf('push', {}).error.kind === 'message', '说明为空当场拒（不起进程）')
  check(argvOf('push', { message: 'x'.repeat(rules.STASH_MESSAGE_MAX + 1) }).ok === false, '说明超长当场拒')
  check(argvOf('apply', {}).ok === false && argvOf('apply', {}).error.kind === 'selector', '要选择器的动作没给选择器当场拒')
  check(argvOf('apply', { selector: 'stash@{x}' }).ok === false, '选择器形状不对（不是 stash@{n}）当场拒')
  check(rules.vcStashSelectorOk('stash@{12}') === true && rules.vcStashSelectorOk('stash@{ }') === false, '选择器判据只认 stash@{数字}')
  check(rules.vcStashBranchError('') === 'empty' && rules.vcStashBranchError('bad name') === 'invalid' && rules.vcStashBranchError('a..b') === 'invalid' && rules.vcStashBranchError('x'.repeat(201)) === 'too-long', '分支名空、含空格/..、超长各自给稳定原因码')
  check(rules.vcStashBranchError('feature/x-1') === '' && rules.vcStashBranchError('中文分支') === '', '普通与中文分支名放行（合法判断交给 git 前先别误伤）')
  check(rules.vcStashMessageError('好的说明') === '' && rules.vcStashMessageError('x'.repeat(201)) === 'too-long', '说明校验空/超长两种原因码')
  check(rules.vcStashOpVersionStateOf('push-staged', '2.49.0') === 'full', '2.49 上 7.3 完整可用')
  check(rules.vcStashOpVersionStateOf('push-staged', '2.34.9') === 'hidden', '2.34 上 7.3 藏起来（反证：版本门不是恒放行）')
  check(rules.vcStashOpVersionStateOf('push-staged', '') === 'hidden' && rules.vcStashOpVersionStateOf('push-staged', '2.10.0') === 'hidden', '版本读不到或低于 2.11 一律藏')
  check(rules.vcStashOpVersionStateOf('push', '2.11.0') === 'full' && rules.vcStashOpVersionStateOf('push', '2.9.0') === 'hidden', '其余动作的底线是 2.11')
  check(rules.stashVersionAtLeast('git version 2.49.0', '2.35.0') === true && rules.stashVersionAtLeast('git version 2.34.0', '2.35.0') === false, '版本比较按数字段，不做字符串比大小')
  const restore = rules.stashRestoreArgs('第1条', 'a'.repeat(40))
  check(restore.ok === true && restore.args[0] === 'stash' && restore.args[1] === 'store' && restore.args[restore.args.length - 1] === 'a'.repeat(40), '丢弃恢复走 stash store（不额外造本地引用）')
  check(rules.stashRestoreArgs('x', 'not-a-hash').ok === false, '恢复时的提交号必须是 40/64 位十六进制')
  const NUL = String.fromCharCode(0)
  const sample = parsed.parseStashList('stash@{0}' + NUL + 'b'.repeat(40) + NUL + '1700000000' + NUL + 'On main: 第1条')
  check(sample.ok === true && sample.entries[0].selector === 'stash@{0}' && sample.entries[0].subject === 'On main: 第1条', '列表解析器与列表格式对得上（同一条四段 NUL 口径）')
  check(rules.STASH_STAGED_ALTERNATIVE === '先做一次全量贮藏，再恢复未暂存的部分', '7.3 的低版本替代做法就是规格第 6 节那一句')
  check(rules.STASH_RECENT_MAX === 20 && rules.STASH_MESSAGE_MAX === 200 && rules.STASH_BRANCH_MAX === 200, '最近丢弃与说明/分支名上限都有明确常量')

  // ---------- B 宿主真跑：十条动作在真仓库里各做一遍 ----------
  console.log('B 宿主真跑（真 git 仓库，十条动作与失败路径）')
  const r1 = mkRepo('push')
  write(r1, 'a.txt', 'a\nb\n')
  git(r1, ['add', 'a.txt'])
  write(r1, 'b.txt', 'untracked\n')
  const vc1 = makeVc()
  const list0 = await stashDo(vc1, { cwd: r1, op: 'list' })
  check(list0.ok === true && Array.isArray(list0.entries) && list0.entries.length === 0, 'B0 空仓库列表回空数组（不是错误）')
  const push1 = await stashDo(vc1, { cwd: r1, op: 'push', message: '第一条贮藏' })
  check(push1.ok === true && push1.entries.length === 1, 'B1 7.1 新建贮藏后列表多一条')
  check(push1.entries[0].selector === 'stash@{0}' && push1.entries[0].oid.length >= 40, 'B1b 回包带选择器与完整提交号')
  check(String(push1.entries[0].subject).indexOf('第一条贮藏') >= 0, 'B1c 列表主题里带用户写的说明')
  check(readFile(r1, 'a.txt') === 'a\n', 'B1d 贮藏后工作区回到干净基线')
  check(readFile(r1, 'b.txt') === 'untracked\n', 'B1e 普通贮藏不动未跟踪文件（7.2 才带它们）')
  const show1 = await stashDo(vc1, { cwd: r1, op: 'show', selector: push1.entries[0].selector })
  check(show1.ok === true && show1.files.indexOf('a.txt') >= 0 && String(show1.patch).indexOf('+b') >= 0, 'B2 7.5 查看内容给出文件清单与完整差异')
  check(show1.fileCount === show1.files.length && show1.truncated === false, 'B2b 文件数与实际清单一致，没过短时不标截断')
  const showMissing = await stashDo(vc1, { cwd: r1, op: 'show', selector: 'stash@{9}' })
  check(showMissing.ok === false && showMissing.error.kind === 'stash-missing', 'B2c 查看不存在的贮藏：stash-missing（不猜别的记录）')
  const apply1 = await stashDo(vc1, { cwd: r1, op: 'apply', selector: push1.entries[0].selector })
  check(apply1.ok === true && apply1.entries.length === 1, 'B3 7.6 应用保留记录（应用后列表仍一条）')
  check(readFile(r1, 'a.txt') === 'a\nb\n', 'B3b 应用后工作区真的拿回改动')
  cleanTree(r1)
  write(r1, 'a.txt', 'a\nb\n')
  const push2 = await stashDo(vc1, { cwd: r1, op: 'push', message: '第二条' })
  check(push2.ok === true && push2.entries.length === 2, 'B3c 第二条贮藏后列表两条')
  const pop1 = await stashDo(vc1, { cwd: r1, op: 'pop', selector: 'stash@{0}' })
  check(pop1.ok === true && pop1.entries.length === 1, 'B4 7.7 弹出应用并删记录（列表少一条）')
  check(readFile(r1, 'a.txt') === 'a\nb\n', 'B4b 弹出后改动回到工作区')
  cleanTree(r1)
  write(r1, 'a.txt', 'a\nc\n')
  write(r1, 'b.txt', 'untracked\n')
  const pushU = await stashDo(vc1, { cwd: r1, op: 'push-untracked', message: '带未跟踪' })
  check(pushU.ok === true && pushU.entries.length === 2, 'B5 7.2 连未跟踪文件一起贮藏成功')
  check(fs.existsSync(path.join(r1, 'b.txt')) === false, 'B5b 未跟踪文件真的被收进贮藏')
  const showU = await stashDo(vc1, { cwd: r1, op: 'show', selector: pushU.entries[0].selector })
  check(showU.ok === true && showU.files.indexOf('b.txt') >= 0, 'B5c 查看内容能看到未跟踪文件')
  const badOp = await stashDo(vc1, { cwd: r1, op: 'nope' })
  check(badOp.ok === false && badOp.error.kind === 'usage', 'B6 不认识的动作用 usage 拒（不落到某条命令上）')
  const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1751-norepo-'))
  const noRepo = await stashDo(vc1, { cwd: nonRepoDir, op: 'list' })
  check(noRepo.ok === false && noRepo.error.kind === 'not-repo', 'B6b 非仓库目录（目录存在但不是仓库）：not-repo')
  const emptyMsg = await stashDo(vc1, { cwd: r1, op: 'push', message: '' })
  check(emptyMsg.ok === false && emptyMsg.error.kind === 'message', 'B6c 空说明在宿主侧也拒（界面之外的第二道闸）')
  const dropNo = await vc1.handleGitStash({ cwd: r1, op: 'drop', selector: pushU.entries[0].selector })
  check(dropNo.ok === false && dropNo.error.kind === 'confirm' && dropNo.error.reason === 'ticket-missing', 'B7 删除不带预检票：confirm / ticket-missing 拒（反证：危险动作不是不带票就能跑）')
  const dropOid = pushU.entries[0].oid
  const drop1 = await stashDo(vc1, { cwd: r1, op: 'drop', selector: pushU.entries[0].selector })
  check(drop1.ok === true && drop1.entries.length === 1, 'B7b 预检拿到票再执行：删除成功，列表少一条')
  check(Array.isArray(drop1.recent) && drop1.recent.length === 1 && drop1.recent[0].oid === dropOid, 'B7c 删除进「最近丢弃」并记下提交号')
  const restore1 = await stashDo(vc1, { cwd: r1, op: 'restore', oid: dropOid, subject: drop1.recent[0].subject })
  check(restore1.ok === true && restore1.entries.length === 2, 'B7d 从「最近丢弃」恢复：列表回到两条')
  check(restore1.recent.length === 0, 'B7e 恢复后该条从最近丢弃里移除（不重复留）')
  const clearNo = await vc1.handleGitStash({ cwd: r1, op: 'clear' })
  check(clearNo.ok === false && clearNo.error.kind === 'confirm' && clearNo.error.reason === 'ticket-missing', 'B8 清空不带预检票：confirm / ticket-missing 拒')
  const clear1 = await stashDo(vc1, { cwd: r1, op: 'clear' })
  check(clear1.ok === true && clear1.entries.length === 0, 'B8b 凭票清空全部')
  check(clear1.recent.length === 2, 'B8c 清空把每一条都记进最近丢弃')

  // 只贮藏已暂存（7.3）：真 git 支持就真跑，不支持则断言版本门把它藏住（两条路都判）。
  const r2 = mkRepo('staged')
  write(r2, 'a.txt', 'a\nstaged\n')
  git(r2, ['add', 'a.txt'])
  write(r2, 'b.txt', 'keep-unstaged\n')
  const vc2 = makeVc()
  const stagedRun = await stashDo(vc2, { cwd: r2, op: 'push-staged', message: '只藏暂存' })
  if (rules.stashVersionAtLeast(git(r2, ['--version']).out, '2.35.0')) {
    check(stagedRun.ok === true && stagedRun.entries.length === 1, 'B9 7.3 在这版 git 上真跑：只贮藏已暂存的文件')
    check(readFile(r2, 'a.txt') === 'a\n', 'B9b 暂存区里的改动被收走')
    check(readFile(r2, 'b.txt') === 'keep-unstaged\n', 'B9c 未暂存的改动留在工作区')
    const showS = await stashDo(vc2, { cwd: r2, op: 'show', selector: stagedRun.entries[0].selector })
    check(showS.ok === true && showS.files.join(',') === 'a.txt', 'B9d 贮藏里只有暂存过的那个文件')
  } else {
    check(stagedRun.ok === false && stagedRun.error.kind === 'version-hidden' && stagedRun.needed === '2.35.0', 'B9 这版 git 低于 2.35：宿主回 version-hidden 并说清需要什么版本')
  }

  // 从贮藏建分支（7.8）：名字合法、且不能已存在。
  const r3 = mkRepo('branch')
  write(r3, 'a.txt', 'a\nbranch\n')
  const vc3 = makeVc()
  const pushB = await stashDo(vc3, { cwd: r3, op: 'push', message: '建分支用' })
  const selB = pushB.entries[0].selector
  const badBranch = await stashDo(vc3, { cwd: r3, op: 'branch', selector: selB, branch: 'bad name' })
  check(badBranch.ok === false && badBranch.error.kind === 'branch', 'B10 分支名不合法：branch 拒（不建出怪名字）')
  git(r3, ['branch', 'taken'])
  const existsBranch = await stashDo(vc3, { cwd: r3, op: 'branch', selector: selB, branch: 'taken' })
  check(existsBranch.ok === false && existsBranch.error.kind === 'branch-exists', 'B10b 分支名已存在：branch-exists（不覆盖现有分支）')
  const okBranch = await stashDo(vc3, { cwd: r3, op: 'branch', selector: selB, branch: 'from-stash' })
  check(okBranch.ok === true, 'B10c 合法且不存在：建分支成功')
  check(git(r3, ['rev-parse', '--verify', 'refs/heads/from-stash']).code === 0, 'B10d 新分支真的落在仓库里')
  check(okBranch.entries.length === 0, 'B10e git 建分支成功后会应用并删掉这条贮藏（stash branch 自身行为，界面按回包刷新列表）')

  // ---------- C 界面叶子：十条入口、危险确认卡、版本门、最近丢弃、动作回调 ----------
  console.log('C 界面叶子（十条入口 / 确认卡 / 版本门 / 最近丢弃 / 回调）')
  const leaf = buildStashLeaves()
  check(leaf.STASH_OPS.length === 10, '界面闭包拿到同一份十条名单（不是界面另抄一份）')
  const page = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0), entry(1)], 'git version 2.49.0') })
  check(page.props['data-vc-stash-page'] === '1', '贮藏页画出自己的根标记')
  check(page.props['data-vc-stash-count'] === '2', '根上带真实条数（与首屏贮藏片同一份数据）')
  const caps = attrsOf(page, 'data-vc-stash-cap')
  // #1905 之后：三种收法（7.1 / 7.2 / 7.3）搬到改动页提交区的储藏拆分按钮，贮藏页不再有它们；
  // 页面上留下的是记录行（应用 7.6 / 弹出 7.7 / 丢弃 7.9，查看 7.5 与建分支 7.8 收进行尾 ⋯ 菜单）
  // 与标题行的刷新 7.4、清空 7.10。DOM 次序是「先标题行、后记录」。
  check(caps.join(',') === ['7.4', '7.10', '7.6', '7.7', '7.9', '7.5', '7.8', '7.6', '7.7', '7.9', '7.5', '7.8'].join(','), '贮藏页上的七条入口按新位置画出来：标题行刷新 + 清空，记录行应用/弹出/丢弃，⋯ 菜单里查看与建分支（实得 ' + caps.join(',') + '）')
  check(caps.indexOf('7.1') < 0 && caps.indexOf('7.2') < 0 && caps.indexOf('7.3') < 0, '三种收法已搬到改动页提交区（贮藏页不再画它们，不留两条路）')
  // 工具行在页底折叠区里，按 data-vc-stash-cap 找它对应的 data-vc-stash-op（不能再用「前 N 个 op」的次序）。
  const capOp: any = {}
  findAll(page, (n) => n.props && n.props['data-vc-stash-cap'] && n.props['data-vc-stash-op']).forEach((n) => { capOp[n.props['data-vc-stash-cap']] = n.props['data-vc-stash-op'] })
  check(capOp['7.4'] === 'list' && capOp['7.10'] === 'clear' && capOp['7.5'] === 'show' && capOp['7.8'] === 'branch', '刷新与清空挂在标题行、查看与建分支挂在记录行 ⋯ 菜单（实得 ' + JSON.stringify(capOp) + '）')
  const dangerAttrs = attrsOf(page, 'data-vc-stash-danger')
  check(dangerAttrs.length === 3, '危险动作三处（清空一处 + 每条记录删除两处）都带危险标记')
  // 7.3 的版本门跟着动作搬到改动页提交区：那一边由 verify-1586-changes-page 与本票新增的断言守；
  // 贮藏页这一层只需要证明自己不再画 7.3（不留两条路）。
  const oldPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0)], 'git version 2.34.0') })
  const oldCaps = attrsOf(oldPage, 'data-vc-stash-cap')
  check(oldCaps.indexOf('7.3') < 0, '2.34 上贮藏页不画 7.3（它已搬到改动页提交区）')
  check(leaf.vcStashStagedStateOf('git version 2.34.0').needed === '2.35.0' && leaf.vcStashStagedStateOf('git version 2.49.0').state === 'full', '版本门口径来自共享规则，界面不自己比版本号')
  const calls = []
  const actPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0)], 'git version 2.49.0'), onStash: (input) => calls.push(input) })
  // #1905：7.1 已搬到改动页提交区；这里用留在页上的记录行动作证明「点击把真实动作交给回调」这条路没变。
  const applyBtn = findAll(actPage, (n) => n.props && n.props['data-vc-stash-op'] === 'apply' && n.props['data-vc-stash-cap'] === '7.6')[0]
  applyBtn.props.onClick()
  check(calls.length === 1 && calls[0].op === 'apply' && calls[0].selector === 'stash@{0}', '点 7.6 把真实动作与记录选择器交给回调')
  // #1905 真机复验抓到的：⋯ 菜单里的「从这条记录建分支」原来直接发动作、分支名是空的，宿主一律回
  //   「分支名不合法」，表单永远打不开。现在它先打开表单并把分支名预填好，人改完再点「建分支」。
  const edits: any[] = []
  const branchPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0)], 'git version 2.49.0'), onStashEdit: (patch: any) => edits.push(patch) })
  const branchItem = findAll(branchPage, (n: any) => n.props && n.props['data-vc-stash-op'] === 'branch')[0]
  branchItem.props.onClick()
  check(edits.length === 1 && edits[0].branch && edits[0].branch.selector === 'stash@{0}' && String(edits[0].branch.name).indexOf('stash/') === 0,
    '点 7.8 先打开建分支表单并把分支名预填好（不再拿空名字直接发动作，实得 ' + JSON.stringify(edits[0] || null) + '）')
  check(leaf.vcStashBranchPrefillOf({ oid: 'abcdef1234567' }) === 'stash/abcdef1' && leaf.vcStashBranchPrefillOf({}) === 'stash/new-branch',
    '预填的分支名按记录对象号起名，缺对象号时给一个固定名')
  const dropBtn = findAll(actPage, (n) => n.props && n.props['data-vc-stash-op'] === 'drop' && n.props['data-vc-stash-cap'] === '7.9')[0]
  dropBtn.props.onClick()
  check(calls.length === 2 && calls[1].op === 'drop' && calls[1].selector === 'stash@{0}' && calls[1].confirm !== true, '点 7.9 先交 drop 对象（不直接带确认，确认卡在前一步）')
  // #1905 票面：清空之后结果条要写清掉几条，不能只说一句「完成」。
  const clearedState = Object.assign(leaf.vcStashStateNew(), { result: { ok: true, op: 'clear', kind: '', dropped: 2 } })
  const clearedPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([], 'git version 2.49.0'), state: clearedState })
  check(attrsOf(clearedPage, 'data-vc-stash-dropped').join(',') === '2', '清空之后结果条写清清掉几条（实得 ' + attrsOf(clearedPage, 'data-vc-stash-dropped').join(',') + '）')
  const confirmState = { confirm: { op: 'drop', selector: 'stash@{0}', subject: '第1条贮藏' } }
  const confirmPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0)]), state: Object.assign(leaf.vcStashStateNew(), confirmState) })
  check(attrsOf(confirmPage, 'data-vc-stash-confirm').join(',') === 'drop', '危险动作贴触发点出确认卡（带动作名）')
  check(attrsOf(confirmPage, 'data-vc-confirm-seg').join(',') === 'what,wont,reversible,verb', '确认卡四段齐全（做什么 / 不会做什么 / 能不能撤销 / 动作名）')
  check(attrsOf(confirmPage, 'data-focus-default').join(',') === 'cancel', '确认卡默认焦点在取消键')
  const confirmCalls = []
  const confirmPage2 = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([entry(0)]), state: Object.assign(leaf.vcStashStateNew(), confirmState), onStash: (input) => confirmCalls.push(input) })
  findAll(confirmPage2, (n) => n.props && n.props['data-vc-stash-confirm-go'] === '1')[0].props.onClick()
  check(confirmCalls.length === 1 && confirmCalls[0].op === 'drop' && confirmCalls[0].confirm === true, '确认之后才带 confirm:true 交给宿主（与宿主侧第二道闸对得上）')
  // 三段式的两通电话由数据层拼好：预检先签票（不带 confirm），执行凭票（带 ticketId / requestId / confirmed）。
  const drawer1 = []
  const fakeCall1 = (phone, args) => { drawer1.push({ phone, args }); return { ok: true } }
  const ticketOps = ['push', 'push-untracked', 'push-staged', 'apply', 'pop', 'branch', 'drop', 'clear']
  check(ticketOps.every((op) => leaf.vcStashNeedsTicketOf(op)) && !leaf.vcStashNeedsTicketOf('list') && !leaf.vcStashNeedsTicketOf('show'), '八个写动作要预检票、两个读动作不要（十动作按这一条分流）')
  const actionPayload = leaf.vcStashActionPayloadOf({ op: 'drop', selector: 'stash@{0}', confirm: true })
  check(actionPayload.confirm === true, '确认过的动作参数里带 confirm:true（页面只把确认过的对象交给宿主）')
  leaf.vcStashCheckCallOf(fakeCall1, '/w/repo', actionPayload)
  check(drawer1.length === 1 && drawer1[0].phone === 'wf.gitStashCheck' && drawer1[0].args.op === 'drop' && drawer1[0].args.selector === 'stash@{0}' && drawer1[0].args.cwd === '/w/repo' && drawer1[0].args.confirm === undefined, '预检电话走 wf.gitStashCheck：带动作与对象、带 cwd，不带 confirm（还没确认）')
  const requestId = leaf.vcStashRequestIdOf(1700000000000, 'drop')
  check(/^[A-Za-z0-9_-]+$/.test(requestId) && requestId.length <= 64 && requestId === leaf.vcStashRequestIdOf(1700000000000, 'drop'), '请求号同输入稳定可重放，字符集与长度符合宿主约定')
  leaf.vcStashWriteCallOf(fakeCall1, '/w/repo', actionPayload, 'st-ticket', requestId)
  check(drawer1.length === 2 && drawer1[1].phone === 'wf.gitStash' && drawer1[1].args.ticketId === 'st-ticket' && drawer1[1].args.requestId === requestId && drawer1[1].args.confirmed === true && drawer1[1].args.confirm === undefined, '执行电话走 wf.gitStash：带预检签出的 ticketId、requestId，confirmed 标明确认卡已过目')
  const confirmModel = leaf.vcStashCheckConfirmOf(actionPayload, { ok: true, ticket: { id: 'st-ticket' }, plan: { subject: '第1条贮藏' } }, requestId)
  check(confirmModel && confirmModel.op === 'drop' && confirmModel.selector === 'stash@{0}' && confirmModel.subject === '第1条贮藏' && confirmModel.ticketId === 'st-ticket' && confirmModel.requestId === requestId, '预检回包落成确认卡模型：动作、对象、票据、请求号都带着走')
  check(leaf.vcStashCheckConfirmOf(actionPayload, { ok: false, error: { kind: 'exit' } }, requestId) === null, '预检失败没签出票时确认卡不出现（反证：不会凭失败回包硬发执行电话）')
  check(leaf.vcStashConfirmPayloadOf(null) === null, '没有确认态时不会凭空造出 confirm:true')
  const recentState = Object.assign(leaf.vcStashStateNew(), { recent: [{ selector: 'stash@{0}', oid: 'c'.repeat(40), subject: '丢掉的', atMs: 1, droppedAtMs: 2, byOp: 'drop' }] })
  const recentPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([]), state: recentState })
  check(attrsOf(recentPage, 'data-vc-stash-recent').join(',') === '1', '最近丢弃区带真实条数')
  check(attrsOf(recentPage, 'data-vc-stash-restore').length === 1, '丢弃的条目有恢复按钮')
  // #1860 D8：详情按选择器存在 details 里（一屏前十条自动读），每份带 state。
  const detailState = Object.assign(leaf.vcStashStateNew(), { details: { 'stash@{0}': { selector: 'stash@{0}', oid: 'd'.repeat(40), files: ['a.txt', 'b.txt'], fileCount: 2, patch: '+x', truncated: true, state: 'ok' } } })
  const detailPage = leaf.vcStashPageNode(fakeH, fakeT, { seed: firstScreenSeed([]), state: detailState })
  check(attrsOf(detailPage, 'data-vc-stash-file').slice(0, 2).join(',') === 'a.txt,b.txt', '查看内容后就地铺开涉及的文件')
  check(attrsOf(detailPage, 'data-vc-stash-truncated').length === 1, '差异被截断时如实标记')
  check(attrsOf(detailPage, 'data-vc-stash-patch').length === 1, '差异正文铺在详情里')
  check(leaf.vcStashFailKeyOf('branch-exists') === 'vc.stash.fail.branchExists' && leaf.vcStashFailKeyOf('weird') === 'vc.stash.fail.other', '宿主失败原因码各自有词条，认不出落其他')
  const reply = { ok: true, op: 'list', entries: [entry(0)], recent: [{ selector: 'stash@{1}', oid: 'e'.repeat(40), subject: 'x', atMs: 1, droppedAtMs: 2, byOp: 'drop' }] }
  const nextState = leaf.vcStashApplyReply(leaf.vcStashStateNew(), reply)
  check(nextState.entries.length === 1 && nextState.recent.length === 1 && nextState.result.ok === true, '成功回包把列表与最近丢弃一起落状态')
  const failState = leaf.vcStashApplyReply(nextState, { ok: false, error: { kind: 'confirm', message: 'x' } })
  check(failState.result.ok === false && failState.result.kind === 'confirm' && failState.entries.length === 1, '失败回包只记错误，不清掉已读到的列表')
  const whenText = leaf.vcStashWhenOf(1700000000000)
  check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(whenText), '时间印成「年-月-日 时:分」')
  check(leaf.vcStashShortOidOf('f'.repeat(40)) === 'f'.repeat(10), '正文只印前 10 位提交号')
  const shellSrc = sourceText('src/client/views/versionControl/vcShellPages.ts')
  check(shellSrc.indexOf('#1751') >= 0 && shellSrc.indexOf("page === 'stash'") >= 0 && shellSrc.indexOf('vcStashPageNode(h, t') >= 0, '页面壳只加一小段把贮藏页挂进贮藏页签（#1751 注释包着）')
  check(shellSrc.indexOf('typeof vcStashPageNode ===') >= 0, '挂载前先判叶子在不在（拼装次序变化不会当场炸）')
  const opsSrc = sourceText('src/client/views/versionControl/vcStashOps.ts')
  check(opsSrc.indexOf('wf.gitStash') >= 0 && opsSrc.indexOf('vcStashOpVersionStateOf') >= 0, '界面数据层走 wf.gitStash，版本门问共享规则')
  const localeText = localeDataText()
  const localeKeys = leaf.STASH_OPS.map((o) => o.nameKey).concat(['vc.stash.title', 'vc.stash.lede', 'vc.stash.list.empty', 'vc.stash.list.err', 'vc.stash.confirm.target', 'vc.stash.recent.title', 'vc.stash.gate.hidden', 'vc.stash.gate.alternative', 'vc.stash.fail.confirm', 'vc.stash.fail.branchExists', 'vc.stash.fail.versionHidden', 'vc.stash.fail.stashMissing', 'vc.stash.fail.exit', 'vc.stash.fail.timeout'])
  const missing = localeKeys.filter((k) => localeText.indexOf("'" + k + "'") < 0)
  check(missing.length === 0, '贮藏页词条全部在词表里（缺：' + missing.join('、') + '）')

  // ---------- D 端到端冒烟：改文件 → 暂存 → 提交 → 建分支 → 合并冲突 → 解决 → 贮藏 → 应用 ----------
  console.log('D 端到端冒烟（真仓库走完整链路，贮藏两步走本票电话）')
  const r4 = mkRepo('e2e')
  const vc4 = makeVc()
  write(r4, 'a.txt', 'base\nfeature\n')
  git(r4, ['add', 'a.txt'])
  git(r4, ['commit', '-q', '-m', '特性改动'])
  git(r4, ['checkout', '-q', '-b', 'feature'])
  write(r4, 'a.txt', 'feature-only\n')
  git(r4, ['add', 'a.txt'])
  git(r4, ['commit', '-q', '-m', '特性分支改同一行'])
  git(r4, ['checkout', '-q', 'main'])
  write(r4, 'a.txt', 'main-only\n')
  git(r4, ['add', 'a.txt'])
  git(r4, ['commit', '-q', '-m', '主分支改同一行'])
  const merge = git(r4, ['merge', 'feature'])
  check(merge.code !== 0, 'D1 合并同一行产生冲突（真冲突，不是假的）')
  write(r4, 'a.txt', 'resolved\n')
  git(r4, ['add', 'a.txt'])
  const mergeCommit = git(r4, ['commit', '-q', '--no-edit'])
  check(mergeCommit.code === 0, 'D2 解决冲突后提交合并')
  write(r4, 'a.txt', 'resolved\nstash-me\n')
  write(r4, 'b.txt', 'untracked-e2e\n')
  const e2eStash = await stashDo(vc4, { cwd: r4, op: 'push-untracked', message: '端到端冒烟' })
  check(e2eStash.ok === true && e2eStash.entries.length === 1, 'D3 贮藏当前改动与未跟踪文件')
  check(readFile(r4, 'a.txt') === 'resolved\n' && fs.existsSync(path.join(r4, 'b.txt')) === false, 'D4 贮藏后工作区回到合并提交的状态')
  const e2eApply = await stashDo(vc4, { cwd: r4, op: 'apply', selector: e2eStash.entries[0].selector })
  check(e2eApply.ok === true && e2eApply.entries.length === 1, 'D5 应用后改动回来、记录还在')
  check(readFile(r4, 'a.txt') === 'resolved\nstash-me\n' && readFile(r4, 'b.txt') === 'untracked-e2e\n', 'D6 文件内容与未跟踪文件都真的回来了')
  cleanTree(r4)
  const e2ePop = await stashDo(vc4, { cwd: r4, op: 'pop', selector: e2eApply.entries[0].selector })
  check(e2ePop.ok === true && e2ePop.entries.length === 0, 'D7 应用后先清干净工作区再弹出（同一份改动不能应用两次），弹出后列表清空、整条链路收口')
  check(readFile(r4, 'a.txt') === 'resolved\nstash-me\n' && readFile(r4, 'b.txt') === 'untracked-e2e\n', 'D7b 弹出也把改动与未跟踪文件一起还回来（与 7.6 两条路都要真的动文件）')

  // ---------- E 票据层：预检签票、凭票执行、重放去重与现场变化（#1751 补：写动作 120 秒预检票据） ----------
  console.log('E 票据层（预检签票 / 零命令拒绝 / 过期 / 换动作 / 现场变化 / requestId 重放）')
  const r5 = mkRepo('ticket')
  write(r5, 'a.txt', 'a\nticketed\n')
  const vc5 = makeVc()
  spawnLog.length = 0
  const pre1 = await vc5.handleGitStashCheck({ cwd: r5, op: 'push', message: '票据第一条' })
  check(pre1.ok === true && typeof pre1.ticket.id === 'string' && pre1.ticket.id.length > 0, 'E1 预检成功签票，回包带票号')
  check(pre1.ticket.expiresAtMs - pre1.ticket.checkedAtMs === 120000, 'E2 票的有效期是中央配置的 120 秒（与改动页同一口径）')
  check(pre1.op === 'push' && pre1.entries.length === 0 && pre1.facts.hasChanges === true && pre1.facts.head.length >= 40, 'E3 预检读真实现场：清单、HEAD 与工作区形状都带回来')
  const preSpawns = spawnLog.slice()
  check(preSpawns.length > 0 && preSpawns.every((l) => !/\bstash (push|apply|pop|drop|clear|branch)\b/.test(l)), 'E4 预检只读不写（起过的命令里没有写动作，实得 ' + preSpawns.length + ' 条只读命令）')
  const baseSpawns = spawnLog.length
  const noTicket = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '票据第一条' })
  const fakeTicket = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '票据第一条', ticketId: 'not-a-real-ticket' })
  check(noTicket.ok === false && noTicket.error.kind === 'confirm' && noTicket.error.reason === 'ticket-missing', 'E5 不带票直接执行：confirm / ticket-missing 拒')
  check(fakeTicket.ok === false && fakeTicket.error.kind === 'confirm' && fakeTicket.error.reason === 'ticket-missing', 'E6 伪造票号也拒（票只活在宿主内存里，猜不出来）')
  check(spawnLog.length === baseSpawns, 'E7 无票与伪造票都是零进程（拒绝发生在起 git 之前，实增 ' + (spawnLog.length - baseSpawns) + ' 条）')
  const pushT = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '票据第一条', ticketId: pre1.ticket.id })
  check(pushT.ok === true && pushT.entries.length === 1, 'E8 凭票执行成功，贮藏真的建起来')
  write(r5, 'a.txt', 'a\nsecond line\n')
  const pre2 = await vc5.handleGitStashCheck({ cwd: r5, op: 'push', message: '第二张票' })
  const wrongOp = await vc5.handleGitStash({ cwd: r5, op: 'apply', selector: pushT.entries[0].selector, ticketId: pre2.ticket.id })
  check(wrongOp.ok === false && wrongOp.error.kind === 'confirm' && wrongOp.error.reason === 'ticket-op-mismatch', 'E9 拿 push 的票去 apply：动作不符拒（票不能串用）')
  clockNow += 120001
  const expired = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '第二张票', ticketId: pre2.ticket.id })
  clockNow = 1000
  check(expired.ok === false && expired.error.kind === 'stale' && expired.error.reason === 'ticket-expired', 'E10 过期票（超过 120 秒）零命令拒，界面上就是重开确认卡')
  const preDrop = await vc5.handleGitStashCheck({ cwd: r5, op: 'drop', selector: pushT.entries[0].selector })
  check(preDrop.ok === true && preDrop.plan.oid === pushT.entries[0].oid, 'E11 删除预检把要动的那条提交号写进票（绑定到具体那一条）')
  git(r5, ['stash', 'drop', 'stash@{0}'])
  const changed = await vc5.handleGitStash({ cwd: r5, op: 'drop', selector: pushT.entries[0].selector, ticketId: preDrop.ticket.id })
  check(changed.ok === false && changed.error.kind === 'stale' && changed.error.reason === 'target-changed', 'E12 确认之后目标被别处删掉：target-changed 拒（绝不猜着删下一条）')
  write(r5, 'a.txt', 'a\nreplay\n')
  const pre3 = await vc5.handleGitStashCheck({ cwd: r5, op: 'push', message: '重放' })
  const beforeReplay = spawnLog.length
  const first = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '重放', ticketId: pre3.ticket.id, requestId: 'req-1751-a' })
  const spawnsAfterFirst = spawnLog.length
  const second = await vc5.handleGitStash({ cwd: r5, op: 'push', message: '重放', ticketId: pre3.ticket.id, requestId: 'req-1751-a' })
  check(first.ok === true && second.ok === true && JSON.stringify(second.entries) === JSON.stringify(first.entries), 'E13 同一个 requestId 再来一次：回同一份结果（不会重复建第二条贮藏）')
  check(spawnLog.length === spawnsAfterFirst && spawnsAfterFirst > beforeReplay, 'E14 重放不再起进程（第一次真跑，第二次走结果表）')
  const writeCmds = spawnLog.slice(beforeReplay, spawnsAfterFirst).filter((l) => /\bstash (push|apply|pop|drop|clear|branch)\b/.test(l))
  check(writeCmds.length === 1 && writeCmds[0].indexOf('stash push') >= 0, 'E15 成功路径只起一条写命令（实得 ' + writeCmds.length + ' 条：' + writeCmds.join(' / ') + '）')
  const r6 = mkRepo('crossrepo')
  write(r6, 'a.txt', 'a\nother\n')
  const crossRepo = await vc5.handleGitStash({ cwd: r6, op: 'push', message: '跨仓库', ticketId: pre3.ticket.id })
  check(crossRepo.ok === false && crossRepo.error.kind === 'stale' && crossRepo.error.reason === 'stale-repo', 'E16 确认之后换到另一个仓库：stale-repo 拒（票绑着仓库）')
  const readNoTicket = await vc5.handleGitStash({ cwd: r5, op: 'list' })
  check(readNoTicket.ok === true && readNoTicket.entries.length === 1, 'E17 读动作（list）不签票直接放行，界面刷新不被票据流程误伤')
  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
