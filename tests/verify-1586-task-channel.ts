// 门禁归属: src/shared/version-control/src/task-protocol.ts
// 长任务通道（#1740）契约门禁：协议、任务库、运行器、宿主接线与日志白名单。
// 全篇用真实文件系统与假进程夹具，不联网、不依赖本机 git 安装状态。
'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-task-channel'
let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}
// 收尾要走一次真实落盘（异步写文件），所以给一个短等待而不是只让出一个宏任务。
const settle = () => new Promise((r) => setTimeout(r, 30))

function mkTmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1740-' + tag + '-'))
}

// 任务库用真实文件系统：生产注入的是宿主文件服务，形状是 resolve/readText/writeText/mkdir/exists。
function fsAdapter() {
  return {
    resolve: async (p) => p,
    readText: async (p) => fsp.readFile(p, 'utf8'),
    writeText: async (p, text) => fsp.writeFile(p, text, 'utf8'),
    mkdir: async (p) => fsp.mkdir(p, { recursive: true }),
    exists: async (p) => { try { await fsp.access(p); return true } catch { return false } },
  }
}

function hash8(s) {
  const { createHash } = require('node:crypto')
  return createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16)
}

// 假进程手柄：done 由测试控制；terminate 可以选择让 done 立刻结束（软取消走得掉）或永远不结束（走强杀）。
function fakeHandle(kind) {
  const handle = { terminated: 0, stdinError: null }
  let resolveDone
  handle.done = new Promise((r) => { resolveDone = r })
  handle.finish = (result) => resolveDone(result || { exitCode: 0, stdout: '', stderr: '', truncated: false })
  handle.terminate = () => {
    handle.terminated += 1
    if (kind === 'soft') resolveDone({ exitCode: null, stdout: '', stderr: '', truncated: false, signalled: true })
  }
  return handle
}

function makeLaunch(kind) {
  const calls = []
  const launch = (options) => {
    const handle = fakeHandle(kind || 'hard')
    options.handle = handle
    calls.push(options)
    return { ok: true, handle }
  }
  return { launch, calls }
}

function nowAt(t) { return () => t }

async function main() {
  const proto = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/task-protocol.js')).href)
  const storeMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlTaskStore.js')).href)
  const runMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlTaskRun.js')).href)

  // 一、长任务清单：票面点名十七种动作一个不少，且全是纯协议常量（不散落在界面或宿主判断里）。
  const wantOps = ['clone', 'fetch', 'pull', 'push', 'submodule-init', 'submodule-update', 'archive', 'bundle',
    'format-patch', 'fast-export', 'fast-import', 'filter-repo', 'svn-fetch', 'gc', 'prune', 'fsck', 'maintenance-run']
  check(Array.isArray(proto.TASK_OPS), '协议导出 TASK_OPS 数组')
  const gotOps = proto.TASK_OPS.map((o) => o.id)
  check(wantOps.every((id) => gotOps.indexOf(id) >= 0), '十七种长任务全部登记（实得 ' + gotOps.join('、') + '）')
  check(gotOps.every((id) => wantOps.indexOf(id) >= 0), '长任务清单不许扩成任意命令执行（多余 ' + gotOps.filter((id) => wantOps.indexOf(id) < 0).join('、') + '）')
  check(proto.TASK_CONCLUSIONS.join('|') === 'succeeded|failed|cancelled|interrupted', '四类结论字面固定为成功/失败/取消/中断')
  check(proto.isTaskOp('clone') === true && proto.isTaskOp('status') === false, 'isTaskOp 只认清单内的动作')
  const meta = proto.taskOpMetaOf('fast-import')
  check(!!meta && meta.stdinFile === true, 'fast-import 是唯一带输入文件的动作')
  check(proto.TASK_OPS.filter((o) => o.stdinFile).length === 1, '除 fast-import 外没有第二个走输入文件的动作')
  check(!!proto.taskOpMetaOf('clone') && proto.taskOpMetaOf('clone').progress === true, 'clone/fetch/pull/push 一类标了可解析百分比')

  // 二、命令拼装：argv 各自独立、不拼 shell，refspec 与路径守卫生效。
  const cloneR = proto.taskArgsFor('clone', { url: 'https://example.com/a.git', dir: 'clone-target', depth: 1 })
  check(cloneR.ok === true && cloneR.args[0] === 'clone', 'clone 第一段是子命令本身')
  check(JSON.stringify(cloneR.args) === JSON.stringify(['clone', '--progress', '--depth', '1', 'https://example.com/a.git', 'clone-target']), 'clone 参数逐项独立（不拼成一整行）')
  check(proto.taskArgsFor('clone', { url: '--upload-pack=evil', dir: 'x' }).ok === false, '远程地址以短横线开头被拒（防选项注入）')
  check(proto.taskArgsFor('clone', { url: 'https://example.com/a.git', dir: '-x' }).ok === false, '目标目录以短横线开头被拒')
  check(proto.taskArgsFor('fetch', { remote: 'origin', refspecs: ['main'] }).ok === true, 'fetch 普通 refspec 放行')
  check(proto.taskArgsFor('fetch', { remote: 'origin', refspecs: ['+main:evil'] }).ok === false, '强制 refspec 前导加号被拒')
  check(proto.taskArgsFor('fetch', { remote: '--exec=evil', refspecs: [] }).ok === false, '远程名以短横线开头被拒')
  check(proto.taskArgsFor('pull', { upstream: 'origin/main', mode: 'ff-only' }).args.indexOf('--ff-only') >= 0, 'pull 快进档带 --ff-only')
  check(proto.taskArgsFor('push', { remote: 'origin', localBranch: 'main', branch: 'main' }).ok === true, 'push 显式 refspec 拼装成功')
  check(proto.taskArgsFor('push', { remote: 'origin', localBranch: '+main', branch: 'main' }).ok === false, 'push 带前导加号的分支被拒')
  check(proto.taskArgsFor('fast-import', {}).args[0] === 'fast-import', 'fast-import 走 stdin 流，参数里没有输入文件路径')
  check(proto.taskArgsFor('gc', {}).ok === true && proto.taskOpMetaOf('gc').requiresConfirm === true, 'gc 一类危险动作要求显式确认')
  check(proto.taskArgsFor('format-patch', { range: 'HEAD~2..HEAD', dir: 'patches' }).ok === true, 'format-patch 输出目录是独立参数')
  check(proto.taskArgsFor('archive', { ref: 'HEAD', outputPath: 'C:/tmp/x.tar' }).ok === true, 'archive 输出路径是独立参数')
  check(proto.taskArgsFor('archive', { ref: 'HEAD', outputPath: '../escape.tar' }).ok === false, 'archive 输出路径含上跳段被拒')

  // 三、进度解析：能解析就画百分比，解析不出必须如实给不确定（percent 为 null）。
  const p1 = proto.parseTaskProgress('Receiving objects:  42% (12/34), 1.2 MiB | 300.00 KiB/s')
  check(p1.phase === 'Receiving objects' && p1.percent === 42, '解析出阶段名与真实百分比（实得 ' + JSON.stringify(p1) + '）')
  check(p1.bytes > 0, '解析出已传字节数')
  const p2 = proto.parseTaskProgress('Enumerating objects: 5, done.')
  check(p2.phase === 'Enumerating objects' && p2.percent === null, '没有百分比时 percent 为 null（显示不确定）')
  const p3 = proto.parseTaskProgress('remote: Total 5 (delta 0), reused 0')
  check(p3.percent === null, '不含百分比的行不得瞎编进度')
  check(proto.parseTaskProgress('随便一句没有阶段的话').phase === null, '认不出阶段时回 null')

  // 四、任务库：真文件落盘、只留安全字段、超上限裁剪、坏文件当空。
  const dir = mkTmp('store')
  const storeDeps = { fs: fsAdapter(), dir, fileKey: hash8('repo-a'), now: nowAt(5000), limit: 3 }
  const s1 = storeMod.createTaskStore(storeDeps)
  await s1.load()
  check((await s1.list()).length === 0, '首次加载空任务库')
  await s1.put({ taskId: 't1', op: 'clone', state: 'done', conclusion: 'succeeded', argv: ['secret'], path: 'C:/x' })
  await s1.put({ taskId: 't2', op: 'fetch', state: 'done', conclusion: 'failed' })
  await s1.put({ taskId: 't3', op: 'gc', state: 'done', conclusion: 'cancelled' })
  await s1.put({ taskId: 't4', op: 'fsck', state: 'running', conclusion: null })
  const listed = await s1.list()
  check(listed.length === 3, '任务库按上限裁剪，最多留 3 条（实得 ' + listed.length + '）')
  check(listed[0].taskId === 't4' && listed[2].taskId === 't2', '裁剪先丢最旧，运行中的留在最前')
  const raw = await fsp.readFile(s1.filePath, 'utf8')
  check(raw.indexOf('argv') < 0 && raw.indexOf('secret') < 0 && raw.indexOf('C:/x') < 0, '落盘只存安全字段，不存参数原文与原始路径')
  const s2 = storeMod.createTaskStore(storeDeps)
  await s2.load()
  check((await s2.get('t4')).op === 'fsck', '换一个任务库实例能从磁盘读回记录')
  await fsp.writeFile(s1.filePath, '{不是 json', 'utf8')
  const s3 = storeMod.createTaskStore(storeDeps)
  await s3.load()
  check((await s3.list()).length === 0, '坏文件当空任务库处理，不让界面崩')

  // 五、运行器：开始、进度、取消、重启中断、在途去重、requestId 重放。
  function runnerOf(launch, storeDir, timer) {
    const store = storeMod.createTaskStore({ fs: fsAdapter(), dir: storeDir, fileKey: hash8('repo-run'), now: nowAt(1000), limit: 20 })
    const logs = []
    const runner = runMod.createTaskRunner({
      store,
      launch,
      prepareStdinFile: async (spec) => ({ ok: true, bytes: Buffer.from(new Uint8Array(spec.sizeBytes || 0)) }),
      timer: timer || { timeout: () => new Promise(() => {}) },
      now: nowAt(1000),
      hash8,
      instanceId: 'inst-new',
      repoRoot: 'C:/repo',
      fire: (level, event, fields) => logs.push({ level, event, fields }),
    })
    return { runner, store, logs }
  }

  // 5.1 开始与去重
  const d1 = mkTmp('dedupe')
  const l1 = makeLaunch('soft')
  const r1 = await runnerOf(l1.launch, d1)
  await r1.runner.resumeInterrupted()
  const st1 = await r1.runner.start({ requestId: 'rq-1', op: 'fetch', args: { remote: 'origin', refspecs: ['main'] } })
  check(st1.ok === true && typeof st1.task.taskId === 'string' && st1.task.taskId.length > 0, '开始一件长任务回任务 id')
  check(st1.task.state === 'running' && st1.reused !== true, '首次开始是在途状态')
  check(l1.calls.length === 1 && l1.calls[0].args[0] === 'fetch', '开始只发起一次进程，子命令在参数首位')
  const st2 = await r1.runner.start({ op: 'fetch', args: { remote: 'origin', refspecs: ['main'] } })
  check(st2.ok === true && st2.task.taskId === st1.task.taskId && st2.reused === true, '同一对象同一动作在途去重，重复点击复用那一次结果')
  check(l1.calls.length === 1, '去重时不再发第二个进程')
  const st3 = await r1.runner.start({ op: 'clone', args: { url: 'https://example.com/b.git', dir: 'b' } })
  check(st3.ok === true && st3.task.taskId !== st1.task.taskId, '不同动作可以并行开始')
  check(l1.calls.length === 2, '不同动作各发一个进程')

  // 5.2 拒绝路径：未知动作、缺确认、输入文件越界
  const bad = await r1.runner.start({ op: 'status', args: {} })
  check(bad.ok === false && bad.error.kind === 'invalid-request' && bad.error.reason === 'unknown-op', '未知动作明确拒绝，不落到 unknown 分支')
  const noConfirm = await r1.runner.start({ op: 'gc', args: {} })
  check(noConfirm.ok === false && noConfirm.error.reason === 'confirm-required', '危险动作没有显式确认时拒绝')
  const badStdin = await r1.runner.start({ op: 'fetch', args: { remote: 'origin' }, stdinFile: { path: 'C:/x', sizeBytes: 4, sha256: 'a'.repeat(64) } })
  check(badStdin.ok === false && badStdin.error.reason === 'stdin-not-allowed', '只有 fast-import 允许输入文件，其它动作带文件被拒')
  check(l1.calls.length === 2, '所有拒绝路径都不起进程')

  // 5.3 快进结果：成功、进度、截断、日志
  const doneHandle = l1.calls[0].handle
  doneHandle.finish({ exitCode: 0, stdout: '', stderr: 'Receiving objects:  42% (12/34), 1.2 MiB', truncated: true })
  await settle()
  const q1 = await r1.runner.query()
  const t1 = q1.tasks.find((t) => t.taskId === st1.task.taskId)
  check(q1.ok === true && !!t1 && t1.state === 'done', '进程结束后查询显示已完成')
  check(t1.conclusion === 'succeeded' && t1.exitCode === 0, '退出码 0 判成功')
  check(t1.percent === 42 && t1.phase === 'Receiving objects', '结束时保留解析出的阶段与百分比')
  check(t1.truncated === true, '输出被截断时如实标记')
  check(t1.elapsedMs >= 0 && t1.endedAt >= t1.startedAt, '结论里带耗时与起止时间')
  const finishLog = r1.logs.filter((l) => l.event === 'git.task' && l.fields.taskId === st1.task.taskId)
  check(finishLog.length >= 2, '同一任务至少在开始与结束时各记一条 git.task')
  check(finishLog.some((l) => l.fields.conclusion === 'succeeded'), '日志事件含任务 id、阶段、耗时与结论')
  check(finishLog.every((l) => l.fields.via === 'version-control-task'), '日志带固定来源标记')

  // 5.4 失败分类：失败带 git 原话，不落 unknown
  const d2 = mkTmp('fail')
  const l2 = makeLaunch('soft')
  const r2 = await runnerOf(l2.launch, d2)
  const f1 = await r2.runner.start({ op: 'fsck', args: {} })
  l2.calls[0].handle.finish({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\nmore', truncated: false })
  await settle()
  const fq = await r2.runner.query()
  const ft = fq.tasks.find((t) => t.taskId === f1.task.taskId)
  check(ft.conclusion === 'failed' && ft.failureKind === 'non-zero', '非零退出判失败并分类为 non-zero')
  check(ft.failureLine === 'fatal: not a git repository', '失败结论里带 git 原话首行')
  check(ft.failureKind !== 'unknown', '失败分类不落 unknown')

  // 5.5 软取消：先发信号再给结论，残留如实说明
  const d3 = mkTmp('cancel')
  const l3 = makeLaunch('soft')
  const r3 = await runnerOf(l3.launch, d3)
  const c1 = await r3.runner.start({ op: 'clone', args: { url: 'https://example.com/c.git', dir: 'c' } })
  const cr = await r3.runner.cancel({ taskId: c1.task.taskId })
  check(cr.ok === true && cr.task.conclusion === 'cancelled', '取消给出被取消结论')
  check(l3.calls[0].handle.terminated === 1, '软取消先给进程发一次终止信号')
  check(typeof cr.task.residual === 'string' && cr.task.residual.length > 0, '软取消写明残留说明（例如目录未清理）')
  const cancelLog = r3.logs.filter((l) => l.event === 'git.task' && l.fields.conclusion === 'cancelled')
  check(cancelLog.length >= 1, '取消也记日志结论')
  const cr2 = await r3.runner.cancel({ taskId: c1.task.taskId })
  check(cr2.ok === false && cr2.error.reason === 'task-ended', '已结束任务再取消明确拒绝，不重复发信号')
  check(l3.calls[0].handle.terminated === 1, '重复取消不会再发一次终止信号')

  // 5.6 强杀：进程不响应时仍给结论，并如实说可能残留
  const d4 = mkTmp('hardcancel')
  const l4 = makeLaunch('hard')
  const r4 = await runnerOf(l4.launch, d4, { timeout: () => Promise.resolve({ fired: true }) })
  const h1 = await r4.runner.start({ op: 'gc', args: {}, confirm: true })
  const hc = await r4.runner.cancel({ taskId: h1.task.taskId })
  check(hc.ok === true && hc.task.conclusion === 'cancelled', '不响应信号的进程也被判为取消')
  check(l4.calls[0].handle.terminated === 2, '宽限期过后补一次强杀')
  check(/残留/.test(hc.task.residual), '强杀后残留说明写清楚')

  // 5.7 requestId 重放：同一请求号回上次结果，不重复执行
  const d5 = mkTmp('replay')
  const l5 = makeLaunch('soft')
  const r5 = await runnerOf(l5.launch, d5)
  const p1r = await r5.runner.start({ requestId: 'req-9', op: 'fsck', args: {} })
  l5.calls[0].handle.finish({ exitCode: 0, stdout: '', stderr: '', truncated: false })
  await settle()
  const p2r = await r5.runner.start({ requestId: 'req-9', op: 'fsck', args: {} })
  check(p2r.ok === true && p2r.task.taskId === p1r.task.taskId && p2r.reused === true, '同一请求号重放回上次任务')
  check(l5.calls.length === 1, '重放不再起进程')
  check(p2r.task.conclusion === 'succeeded', '重放回的是上次结论')

  // 5.8 重启中断：上一进程留下的在途记录必须如实标中断
  const d6 = mkTmp('resume')
  const storeDeps6 = { fs: fsAdapter(), dir: d6, fileKey: hash8('repo-resume'), now: nowAt(9000), limit: 20 }
  const oldStore = storeMod.createTaskStore(storeDeps6)
  await oldStore.load()
  await oldStore.put({ taskId: 'old-1', op: 'clone', state: 'running', conclusion: null, instanceId: 'inst-old', startedAt: 1000 })
  const logs6 = []
  const newStore = storeMod.createTaskStore({ fs: fsAdapter(), dir: d6, fileKey: hash8('repo-resume'), now: nowAt(9000), limit: 20 })
  const runner6 = await runMod.createTaskRunner({
    store: newStore,
    launch: () => ({ ok: false, kind: 'spawn-failed', message: '不应起进程' }),
    prepareStdinFile: async () => ({ ok: true, bytes: Buffer.from('') }),
    timer: { timeout: () => Promise.resolve({ fired: true }) },
    now: nowAt(9000),
    hash8,
    instanceId: 'inst-new',
    repoRoot: 'C:/repo',
    fire: (level, event, fields) => logs6.push({ level, event, fields }),
  })
  const resumed = await runner6.resumeInterrupted()
  check(resumed.ok === true && resumed.interrupted === 1, '重启后把上一实例的在途任务标成中断')
  const rq6 = await runner6.query()
  const oldRec = rq6.tasks.find((t) => t.taskId === 'old-1')
  check(!!oldRec && oldRec.conclusion === 'interrupted' && oldRec.interrupted === true, '中断结论可被界面识别')
  check(logs6.some((l) => l.event === 'git.task' && l.fields.conclusion === 'interrupted'), '重启中断也记日志结论')

  // 5.9 输入文件：只有快进通道校验后送入，字节数与摘要进记录，不存内容
  const d7 = mkTmp('stdin')
  const l7 = makeLaunch('soft')
  const store7 = storeMod.createTaskStore({ fs: fsAdapter(), dir: d7, fileKey: hash8('repo-stdin'), now: nowAt(1000), limit: 20 })
  const runner7 = await runMod.createTaskRunner({
    store: store7,
    launch: l7.launch,
    prepareStdinFile: async (spec) => ({ ok: true, bytes: Buffer.from('blob\n', 'utf8') }),
    timer: { timeout: () => Promise.resolve({ fired: true }) },
    now: nowAt(1000), hash8, instanceId: 'inst-new', repoRoot: 'C:/repo', fire: () => {},
  })
  const si = await runner7.start({
    op: 'fast-import', args: {},
    stdinFile: { path: 'C:/tmp/x.fi', sizeBytes: 5, sha256: 'b'.repeat(64) },
  })
  check(si.ok === true && l7.calls[0].stdinBytes && l7.calls[0].stdinBytes.length === 5, 'fast-import 输入字节送入进程')
  check(si.task.stdinBytes === 5, '任务记录只存输入字节数，不存文件内容')
  const badSpec = await runner7.start({ op: 'fast-import', args: {}, stdinFile: { path: 'C:/tmp/x.fi', sizeBytes: 5 } })
  check(badSpec.ok === false && badSpec.error.reason.indexOf('stdin') === 0, '输入文件规格不全时明确拒绝')
  const badBytes = await runMod.createTaskRunner({
    store: storeMod.createTaskStore({ fs: fsAdapter(), dir: mkTmp('badbytes'), fileKey: hash8('bad'), now: nowAt(1), limit: 5 }),
    launch: () => ({ ok: true, handle: fakeHandle('soft'), stdinError: 'epipe' }),
    prepareStdinFile: async () => ({ ok: true, bytes: Buffer.from('x') }),
    timer: { timeout: () => Promise.resolve({ fired: true }) },
    now: nowAt(1), hash8, instanceId: 'inst-new', repoRoot: 'C:/repo', fire: () => {},
  })
  const epipeStart = await badBytes.start({ op: 'fast-import', args: {}, stdinFile: { path: 'C:/tmp/x.fi', sizeBytes: 1, sha256: 'c'.repeat(64) } })
  const epipeQ = await badBytes.query()
  const epipeTask = epipeQ.tasks.find((t) => t.taskId === epipeStart.task.taskId)
  check(epipeTask.conclusion === 'failed' && epipeTask.failureKind === 'stdin-failed', '输入通道被提前关闭（EPIPE）判失败并单独分类，不静默忽略')

  // 六、七登记点：一条长任务通道要同时出现在七处，漏一处就「界面看起来能点、实际必被拦」。
  // 这里按源码文本对账，七处各给一个稳定代号；末尾拿四份篡改副本反证扫描器真会判红。
  const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const reg = {
    protocol: readRel('src/shared/version-control/src/task-protocol.ts'),
    runner: readRel('src/host/versionControlTaskRun.ts'),
    host: readRel('src/host/versionControl.ts'),
    taskHost: readRel('src/host/versionControlTask.ts'),
    index: readRel('src/host/index.ts'),
    leaf: readRel('src/client/views/versionControl/vcTaskPanel.ts'),
    shell: readRel('src/client/views/versionControl/vcShellPages.ts'),
    timeouts: readRel('config/timeouts.yaml'),
    timeGen: readRel('scripts/generate-time-config.mts'),
  }
  const TASK_PHONE_NAMES = ['wf.gitTaskStart', 'wf.gitTaskQuery', 'wf.gitTaskCancel']
  const TASK_TIMEOUT_KEYS = ['vcTaskPollIntervalMs', 'vcTaskCancelGraceMs', 'vcTaskHardKillGraceMs']
  const TASK_TIMEOUT_CONSTS = ['VC_TASK_POLL_INTERVAL_MS', 'VC_TASK_CANCEL_GRACE_MS', 'VC_TASK_HARD_KILL_MS']
  const registrationProblems = (tx) => {
    const problems = []
    // 1 操作枚举：十七种动作都在协议的 TASK_OPS 里，不许另外再写一份清单。
    if (!wantOps.every((id) => tx.protocol.indexOf('meta(\'' + id + '\'') >= 0)) problems.push('op-enum')
    // 2 判定分支：运行器按动作元数据决定行为，认不出的动作必须落到 unknown-op。
    if (tx.runner.indexOf('taskOpMetaOf(req.op)') < 0 || tx.runner.indexOf('unknown-op') < 0) problems.push('decision-branch')
    // 3 检查白名单：只有 fast-import 能带输入文件，其余一律 stdin-not-allowed。
    if (tx.runner.indexOf('meta.stdinFile') < 0 || tx.runner.indexOf('stdin-not-allowed') < 0) problems.push('check-whitelist')
    // 4 写处理函数：执行层（起进程闭包 makeLaunchTaskGit 与通道装配）住同层叶子 versionControlTask.ts，
    //   父文件只留 taskPhone() 装配与三个处理函数；两段源码合起来看，缺一样都判红。
    const hostText = tx.host + '\n' + tx.taskHost
    if (hostText.indexOf('makeLaunchTaskGit') < 0 || tx.host.indexOf('taskPhone()') < 0) problems.push('write-handler')
    else if (!/handleGitTask(Start|Query|Cancel)/.test(tx.host)) problems.push('write-handler')
    // 5 宿主注册：三条电话在入口一个字面一条地注册（循环注册躲不过检查）。
    if (!TASK_PHONE_NAMES.every((name) => tx.index.indexOf('harness.handle(\'' + name + '\'') >= 0)) problems.push('host-registration')
    // 6 电话表：客户端叶子里三条电话名齐全，页面壳真的把任务区挂上去。
    if (!TASK_PHONE_NAMES.every((name) => tx.leaf.indexOf("'" + name + "'") >= 0) || tx.shell.indexOf('vcTaskPanelNode(h, t') < 0) problems.push('phone-table')
    // 7 超时配置：YAML 里有键、生成器登记了常量、通道真读了常量——三处缺一不可。
    if (!TASK_TIMEOUT_KEYS.every((k) => tx.timeouts.indexOf(k + ':') >= 0)) problems.push('timeout-config')
    else if (!TASK_TIMEOUT_CONSTS.every((k) => tx.timeGen.indexOf(k) >= 0)) problems.push('timeout-config')
    else if (!TASK_TIMEOUT_CONSTS.every((k) => tx.taskHost.indexOf(k) >= 0)) problems.push('timeout-config')
    return problems
  }
  const regProblems = registrationProblems(reg)
  check(regProblems.length === 0, '七登记点一处不漏（缺：' + regProblems.join('、') + '）')
  const tamperReg = (patch) => registrationProblems(Object.assign({}, reg, patch))
  check(tamperReg({ index: reg.index.replace("harness.handle('wf.gitTaskCancel'", "harness.handle('wf.gitTaskCancelTypo'") }).indexOf('host-registration') >= 0, '反证一：宿主少注册一条电话时判红')
  check(tamperReg({ leaf: reg.leaf.replace("'wf.gitTaskCancel'", "'wf.gitTaskCancelX'") }).indexOf('phone-table') >= 0, '反证二：电话表少一条取消电话时判红')
  check(tamperReg({ timeouts: reg.timeouts.replace('vcTaskHardKillGraceMs', 'vcTaskHardKillGraceMsOld') }).indexOf('timeout-config') >= 0, '反证三：超时配置少一条键时判红')
  check(tamperReg({ runner: reg.runner.replace('taskOpMetaOf(req.op)', 'taskOpMetaOf(req.op, true)') }).indexOf('decision-branch') >= 0, '反证四：判定分支被换形状时判红')

  // 七、宿主装配真跑：真的 createVersionControl + 假进程与假计时服务，验证固定前缀、GIT_EDITOR、
  //     标准输入窄例外与三条电话的整条链路——不是看源码文本，是真把进程请求接下来看形状。
  const vcMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControl.js')).href)
  const cmdMod = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/commands.js')).href)
  const { createHash } = require('node:crypto')
  const hostSpawns = []
  const hostLogs = []
  let hostOutbound = 0
  let nextHostStdout = ''
  function hostProc(preloadOut) {
    let resolveDone
    const done = new Promise((r) => { resolveDone = r })
    const readerOf = (text) => ({
      readFrom(off) {
        const all = String(text || '')
        if (off >= all.length) return { text: '', nextOffset: off, lossy: false }
        return { text: all.slice(off), nextOffset: all.length, lossy: false }
      },
    })
    const stdinWrites = []
    return {
      done,
      stdinWrites,
      collected: { stdout: readerOf(preloadOut), stderr: readerOf('') },
      stdin: { write(b) { stdinWrites.push(b) }, end() {}, on() {} },
      terminate() { resolveDone({ exitCode: null, signal: 'SIGTERM' }) },
      finish(result) { resolveDone(result || { exitCode: 0, stdout: '', stderr: '', truncated: false }) },
    }
  }
  const hostCache = mkTmp('hostcache')
  const hostRepo = mkTmp('hostrepo')
  const vc = vcMod.createVersionControl({
    subprocess: { spawn(req) { const h = hostProc(nextHostStdout); nextHostStdout = ''; hostSpawns.push({ req, handle: h }); return h } },
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, Math.max(5000, Number(ms) || 0))) },
    fs: fsAdapter(),
    getPlatform: async () => ({ resolveExecutable: async () => 'git' }),
    DEFAULT_CWD: hostRepo,
    TIMEOUT_MS: 1000,
    gate: { noteOutbound() { hostOutbound += 1 } },
    logCtx: { fire(level, event, fields) { hostLogs.push({ level, event, fields }) } },
    now: () => Date.now(),
    getCacheDir: async () => hostCache,
  })
  check(typeof vc.handleGitTaskStart === 'function' && typeof vc.handleGitTaskQuery === 'function' && typeof vc.handleGitTaskCancel === 'function', '宿主装配出开始/查询/取消三条长任务电话')
  nextHostStdout = 'Receiving objects:  55% (11/20), 2.0 MiB | 300.00 KiB/s\n'
  const hStart = await vc.handleGitTaskStart({ op: 'fetch', args: { remote: 'origin', refspecs: ['main'] }, cwd: hostRepo, requestId: 'host-rq-1' })
  check(hStart.ok === true && hStart.task && hStart.task.state === 'running', '开始一件 fetch 任务，回在途任务')
  check(hostSpawns.length === 1, '开始一件任务只起一个进程')
  const sreq = hostSpawns[0].req
  check(Array.isArray(sreq.argv) && sreq.argv[0] === 'git' && sreq.argv[1] === '-C' && sreq.argv[2] === hostRepo, 'argv 前两段钉死程序与仓库目录（-C）')
  check(sreq.argv[3] === '--no-pager', '固定前缀第一项就是 --no-pager')
  check(sreq.argv.indexOf('--no-pager') < sreq.argv.indexOf('fetch'), '--no-pager 排在子命令之前')
  check(sreq.argv.indexOf('fetch') > 0 && sreq.argv[sreq.argv.length - 1] === 'main' && sreq.argv[sreq.argv.length - 2] === 'origin', '子命令与参数逐项独立（不拼 shell 字符串）')
  check(sreq.cwd === hostRepo, '进程工作目录与 -C 指向的仓库一致')
  check(sreq.env && sreq.env.GIT_EDITOR === cmdMod.FAILING_EDITOR, '子进程 GIT_EDITOR 被设成必失败命令（面板没覆盖成功时 git 直接失败，不弹编辑器）')
  check(sreq.stdio && sreq.stdio.stdin === 'ignore', '默认标准输入忽略')
  check(!!sreq.stdio && !!sreq.stdio.stdout && typeof sreq.stdio.stdout.maxBytes === 'number' && sreq.stdio.stdout.maxBytes > 0, '标准输出有字节上限（超过由宿主截断并标记）')
  check(hostOutbound >= 1, '起进程前先向闸记一笔外发')
  const hQuery = await vc.handleGitTaskQuery({})
  const hTask = hQuery.ok === true ? hQuery.tasks.find((t) => t.taskId === hStart.task.taskId) : null
  check(hQuery.ok === true && hQuery.running === 1 && !!hTask && hTask.state === 'running', '查询能看到这条在途任务')
  check(!!hTask && hTask.percent === 55 && hTask.phase === 'Receiving objects', '进度读的是 git 自己报的真实百分比（实得 ' + JSON.stringify(hTask && { percent: hTask.percent, phase: hTask.phase }) + '）')
  check(hostSpawns[0].handle.stdinWrites.length === 0, '普通任务没有往标准输入写任何字节')
  const hCancel = await vc.handleGitTaskCancel({ taskId: hStart.task.taskId })
  check(hCancel.ok === true && hCancel.task && hCancel.task.conclusion === 'cancelled' && typeof hCancel.task.residual === 'string' && hCancel.task.residual.length > 0, '取消走软取消并给出残留说明')
  const stdinDir = mkTmp('stdinfile')
  const stdinPath = path.join(stdinDir, 'in.fi')
  const stdinBuf = Buffer.from('blob\nmark :1\ndata 3\nhi\n', 'utf8')
  fs.writeFileSync(stdinPath, stdinBuf)
  const stdinDigest = createHash('sha256').update(stdinBuf).digest('hex')
  const fiStart = await vc.handleGitTaskStart({ op: 'fast-import', args: {}, cwd: hostRepo, stdinFile: { path: stdinPath, sizeBytes: stdinBuf.length, sha256: stdinDigest } })
  check(fiStart.ok === true && hostSpawns.length === 2, 'fast-import 通过文件校验后起进程')
  const freq = hostSpawns.length === 2 ? hostSpawns[1].req : null
  check(!!freq && freq.stdio && freq.stdio.stdin === 'pipe', 'fast-import 的标准输入是管道（唯一窄例外）')
  check(!!freq && freq.argv.indexOf('fast-import') > 0, 'fast-import 子命令排在固定前缀之后')
  const fiWrites = hostSpawns.length === 2 ? hostSpawns[1].handle.stdinWrites : []
  check(fiWrites.length === 1 && Buffer.isBuffer(fiWrites[0]) && fiWrites[0].length === stdinBuf.length, '宿主把输入文件字节送进标准输入，且只送一次')
  check(fiWrites.length === 1 && fiWrites[0].equals(stdinBuf), '送进去的字节与文件内容完全一致')
  if (hostSpawns.length === 2) hostSpawns[1].handle.finish({ exitCode: 0, stdout: '', stderr: '', truncated: false })
  await settle()
  const fiQuery = await vc.handleGitTaskQuery({})
  const fiTask = fiQuery.tasks.find((t) => t.taskId === fiStart.task.taskId)
  check(!!fiTask && fiTask.conclusion === 'succeeded' && fiTask.stdinBytes === stdinBuf.length, '任务记录只留输入字节数并如实收尾')
  const storedNames = fs.readdirSync(hostCache).filter((n) => n.indexOf('vc-task-events__') === 0)
  const storedText = storedNames.map((n) => fs.readFileSync(path.join(hostCache, n), 'utf8')).join('\n')
  check(storedText.length > 0 && storedText.indexOf('blob') < 0 && storedText.indexOf(stdinPath) < 0, '任务状态落盘不含输入文件内容与原始路径')
  const beforeReject = hostSpawns.length
  const fiNoFile = await vc.handleGitTaskStart({ op: 'fast-import', args: {}, cwd: hostRepo })
  check(fiNoFile.ok === false && fiNoFile.error && fiNoFile.error.reason === 'stdin-required', 'fast-import 没给输入文件时明确拒绝，不空着管道跑')
  const fetchWithFile = await vc.handleGitTaskStart({ op: 'fetch', args: { remote: 'origin' }, cwd: hostRepo, stdinFile: { path: stdinPath, sizeBytes: stdinBuf.length, sha256: stdinDigest } })
  check(fetchWithFile.ok === false && fetchWithFile.error && fetchWithFile.error.reason === 'stdin-not-allowed', '非 fast-import 命令带输入文件被拒')
  check(hostSpawns.length === beforeReject, '两条拒绝路径都是零进程')
  check(hostLogs.some((l) => l.event === 'host.call' && l.fields && l.fields.method === 'wf.gitTaskStart'), '电话层记 host.call（含方法名）')
  const taskLogs = hostLogs.filter((l) => l.event === 'git.task')
  check(taskLogs.length >= 2 && taskLogs.every((l) => l.fields && l.fields.via === 'version-control-task'), 'git.task 日志至少开始与结束两条，字段带来源')

  // 八、客户端任务区：真求值那份叶子，进度、四类结论、取消按钮与三条电话的整形都按界面契约验证。
  const fakeH = function (tag, props, children) {
    const kids = children === undefined ? [] : (Array.isArray(children) ? children : [children])
    return { tag, props: props || {}, children: kids }
  }
  const fakeT = function (key, params) { return params ? key + JSON.stringify(params) : key }
  const leaf = compileFn(['h', 't'], spliceableJs('src/client/views/versionControl/vcTaskPanel.ts') + '\nreturn { VC_TASK_PHONES: VC_TASK_PHONES, vcTaskStart: vcTaskStart, vcTaskQuery: vcTaskQuery, vcTaskCancel: vcTaskCancel, vcTaskProgressOf: vcTaskProgressOf, vcTaskConclusionOf: vcTaskConclusionOf, vcTaskRowNode: vcTaskRowNode, vcTaskPanelNode: vcTaskPanelNode, vcTaskOpLabelKeyOf: vcTaskOpLabelKeyOf };')(fakeH, fakeT)
  function findAll(node, pred, out) {
    const acc = out || []
    if (Array.isArray(node)) { for (const item of node) findAll(item, pred, acc); return acc }
    if (!node || typeof node !== 'object') return acc
    if (pred(node)) acc.push(node)
    if (Array.isArray(node.children)) for (const kid of node.children) findAll(kid, pred, acc)
    return acc
  }
  function textOf(node) {
    if (node === null || node === undefined) return ''
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    return textOf(node.children)
  }
  check(leaf.VC_TASK_PHONES.start === 'wf.gitTaskStart' && leaf.VC_TASK_PHONES.query === 'wf.gitTaskQuery' && leaf.VC_TASK_PHONES.cancel === 'wf.gitTaskCancel', '任务区电话表三条电话名与宿主注册一致')
  const prog = leaf.vcTaskProgressOf({ state: 'running', percent: 42.4, phase: 'Receiving objects', receivedBytes: 2048, elapsedMs: 900 })
  check(prog.percent === 42 && prog.uncertain === false && prog.phase === 'Receiving objects' && prog.receivedBytes === 2048, '真实百分比照实画，进度模型带上阶段与字节数')
  const progBad = leaf.vcTaskProgressOf({ state: 'running', percent: 142 })
  check(progBad.percent === null && progBad.uncertain === true, '超出范围的百分比不认，在途任务标成不确定')
  check(leaf.vcTaskProgressOf({ state: 'running' }).uncertain === true, '没有百分比的在途任务如实标不确定')
  check(leaf.vcTaskProgressOf({ state: 'done', conclusion: 'succeeded' }).uncertain === false, '已结束任务不再标不确定')
  check(leaf.vcTaskConclusionOf({ conclusion: 'succeeded' }).key === 'vc.task.doneSucceeded', '成功结论取成功词条')
  const cFailed = leaf.vcTaskConclusionOf({ conclusion: 'failed', failureLine: 'fatal: remote error' })
  check(cFailed.state === 'failed' && cFailed.noteKey === 'vc.task.doneFailedLine' && cFailed.noteParams.line === 'fatal: remote error', '失败结论带 git 原话一行')
  const cCancelled = leaf.vcTaskConclusionOf({ conclusion: 'cancelled', residual: '目标目录可能只写了一半' })
  check(cCancelled.state === 'cancelled' && cCancelled.noteKey === 'vc.task.residual', '取消结论带残留说明')
  const cInterrupted = leaf.vcTaskConclusionOf({ interrupted: true })
  check(cInterrupted.state === 'interrupted' && cInterrupted.noteKey === 'vc.task.interruptedNote', '重启后的在途任务如实说已中断')
  check(leaf.vcTaskConclusionOf({ conclusion: 'weird' }).state === 'failed', '不认识的结论按失败兜底，绝不显示成已完成')
  check(leaf.vcTaskConclusionOf({ state: 'running' }) === null, '在途任务没有结论')
  const emptyPanel = leaf.vcTaskPanelNode(fakeH, fakeT, { tasks: [] })
  check(findAll(emptyPanel, (n) => n.props && n.props['data-vc-task-empty'] === '1').length === 1, '任务区空态给一句说明')
  const cancelledIds = []
  const runningPanel = leaf.vcTaskPanelNode(fakeH, fakeT, { tasks: [{ taskId: 't1', op: 'clone', state: 'running', phase: 'Receiving objects' }], onCancel: (id) => cancelledIds.push(id) })
  const rowNode = findAll(runningPanel, (n) => n.props && n.props['data-vc-task-row'] === '1')[0]
  check(!!rowNode && rowNode.props['data-vc-task-state'] === 'running', '在途任务画成行并带状态')
  const cancelBtns = findAll(runningPanel, (n) => n.props && n.props['data-vc-task-cancel'] === '1')
  check(cancelBtns.length === 1, '在途任务有取消按钮')
  cancelBtns[0].props.onClick({ stopPropagation() {} })
  check(cancelledIds.length === 1 && cancelledIds[0] === 't1', '点取消把任务 id 交给页面回调')
  check(findAll(runningPanel, (n) => n.props && n.props['data-vc-task-uncertain'] === '1').length === 1, '没有百分比时显示「无法确定」而不是编进度')
  const donePanel = leaf.vcTaskPanelNode(fakeH, fakeT, { tasks: [{ taskId: 't2', op: 'gc', state: 'done', conclusion: 'succeeded' }], onCancel: () => { throw new Error('不该画取消按钮') } })
  check(findAll(donePanel, (n) => n.props && n.props['data-vc-task-cancel'] === '1').length === 0, '已结束任务没有取消按钮')
  check(findAll(donePanel, (n) => n.props && n.props['data-vc-task-conclusion'] === 'succeeded').length === 1, '已结束任务画结论')
  const interruptedRow = leaf.vcTaskRowNode(fakeH, fakeT, { taskId: 't3', op: 'pull', state: 'done', interrupted: true }, {})
  check(findAll(interruptedRow, (n) => n.props && n.props['data-vc-task-conclusion'] === 'interrupted').length === 1, '中断任务画中断结论')
  check(findAll(interruptedRow, (n) => n.props && n.props['data-vc-task-note'] === 'vc.task.interruptedNote').length === 1, '中断任务带上「上一次任务已中断」说明')
  const failedRow = leaf.vcTaskRowNode(fakeH, fakeT, { taskId: 't4', op: 'push', state: 'done', conclusion: 'failed', failureLine: 'fatal: no upstream' }, {})
  check(textOf(failedRow).indexOf('fatal: no upstream') >= 0, '失败行把 git 原话显示出来')
  const calls = []
  const fakeCall = (method, args) => { calls.push({ method, args }); return { ok: true } }
  leaf.vcTaskStart(fakeCall, 'C:/repo', 'fetch', { args: { remote: 'origin' }, requestId: 'rq-2', confirm: true })
  check(calls[0].method === 'wf.gitTaskStart' && calls[0].args.cwd === 'C:/repo' && calls[0].args.op === 'fetch' && calls[0].args.confirm === true && calls[0].args.requestId === 'rq-2', '开始任务把目录、动作、确认与请求号交给宿主')
  check(!('content' in (calls[0].args.stdinFile || {})) && Object.keys(calls[0].args).indexOf('stdinFile') < 0, '没有输入文件时不夹带 stdinFile')
  leaf.vcTaskStart(fakeCall, 'C:/repo', 'fast-import', { stdinFile: { path: 'C:/x.fi', sizeBytes: 9, sha256: 'a'.repeat(64), content: 'blob' } })
  const fiArgs = calls[1].args.stdinFile
  check(calls[1].method === 'wf.gitTaskStart' && !!fiArgs && Object.keys(fiArgs).sort().join(',') === 'path,sha256,sizeBytes', '输入文件只交路径、大小与摘要，界面不读文件内容')
  leaf.vcTaskQuery(fakeCall)
  check(calls[2].method === 'wf.gitTaskQuery' && Object.keys(calls[2].args).length === 0, '查询任务不带参数（工作区由宿主自己认）')
  leaf.vcTaskCancel(fakeCall, 'task-1')
  check(calls[3].method === 'wf.gitTaskCancel' && calls[3].args.taskId === 'task-1', '取消任务只带任务 id')
  const shellText = sourceText('src/client/views/versionControl/vcShellPages.ts')
  check(shellText.indexOf('vcTaskPanelNode(h, t') >= 0 && shellText.indexOf('opts.tasks !== undefined') >= 0, '页面壳把任务区接到页面节点上')
  const localeText = localeDataText()
  const commonKeys = ['vc.task.title', 'vc.task.count', 'vc.task.empty', 'vc.task.running', 'vc.task.phase', 'vc.task.phaseUnknown', 'vc.task.percent', 'vc.task.percentUnknown', 'vc.task.bytes', 'vc.task.elapsed', 'vc.task.cancel', 'vc.task.doneSucceeded', 'vc.task.doneFailed', 'vc.task.doneFailedLine', 'vc.task.doneCancelled', 'vc.task.doneInterrupted', 'vc.task.interruptedNote', 'vc.task.residual', 'vc.task.truncated', 'vc.task.start', 'vc.task.query', 'vc.task.confirmRequired']
  const opKeys = wantOps.map((op) => 'vc.task.op.' + op.replace(/-([a-z])/g, (m, c) => c.toUpperCase()))
  const allKeys = commonKeys.concat(opKeys)
  const missingKeys = allKeys.filter((k) => localeText.indexOf("'" + k + "'") < 0)
  check(missingKeys.length === 0, '任务区词条全部在词表里（缺：' + missingKeys.join('、') + '）')

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })