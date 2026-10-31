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

  await printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })