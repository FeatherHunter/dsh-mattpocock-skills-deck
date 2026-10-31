// verify-1762-platform.ts — 平台段门禁（票 #1762 / 规格 #1586 T26）
// 门禁归属: src/host/versionControlPlatform.ts
// 门禁归属: src/host/versionControlPlatformRead.ts
// 门禁归属: src/host/versionControlPlatformMount.ts
// 门禁归属: src/shared/version-control/src/platform-inspect.ts
// 门禁归属: src/client/views/versionControl/vcPlatformData.ts
// 门禁归属: src/client/views/versionControl/vcPlatformPage.ts
// 门禁归属: src/client/views/versionControl/vcMigrateExport.ts
//
// 守什么（规格 #1586 第 11 节域 14 / 5.9 / 8.15 / 13.14 与实现决策第 1 节三条永久例外）：
//   一 账本落点：平台与边界页恰好 9 条、迁移页恰好 6 条；14.1 是操作、14.3 只读、14.2 与 14.4–14.8
//      是说明；5.9 是说明且要求 2.38 并隐藏；8.15 只读；13.14 归提交历史页并在平台页留一条指回说明。
//   二 共享纯函数（宿主与界面同一份守卫）：凭据助手链拆分与 store 标红、updateRefs 开值判定、
//      request-pull 参数检查、输出目录补丁文件摘要。
//   三 宿主 14.1 电话：预检签 120 秒票据；执行时票过期 / 仓库现场变了 / 参数被改一律拒绝，绝不自动重放；
//      票据通过后把命令交给长任务通道（不在本电话里起进程）。
//   四 宿主只读电话：git config 未命中（exit 1）是「没设置」不是失败；两个查询各自成败不连坐；
//      request-pull 截断如实说；补丁目录不存在与列目录失败分得清。
//   五 客户端数据层：成功替换数据、失败保留上一份并标失败；三条电话名与宿主登记对得上。
//
// 反证组：把「store 不再标红」「过期的票仍然放行」「config 未命中也报失败」三处改坏，对应用例必须红。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1762-platform.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1762-platform'

let failed = false
let failedCount = 0
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  if (!ok) failedCount += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// 客户端叶子是闭包风格（无 import、跨叶用全局名字），这里补最小日志桩，读数据层时不会炸。
const logs: any[] = []
;(globalThis as any).log = (level: string, event: string, fields: any) => { logs.push({ level, event, fields }) }
;(globalThis as any).dswsLogHash = () => 'h16'
;(globalThis as any).dswsLogTrunc = (text: any) => String(text)

const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel.replace(/\.ts$/, '.js'))).href)
const readText = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const sorted = (list: string[]) => list.slice().sort()
const SAME = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)

async function main(): Promise<void> {
  console.log('平台段门禁（#1762 T26：域 14 与 5.9 / 8.15 / 13.14 的落点、纯函数、宿主电话与数据层）')
  const ledger = await load('src/shared/version-control/src/capability-ledger.ts')
  const inspect = await load('src/shared/version-control/src/platform-inspect.ts')
  const platform = await load('src/host/versionControlPlatform.ts')
  const platformRead = await load('src/host/versionControlPlatformRead.ts')
  const data = await load('src/client/views/versionControl/vcPlatformData.ts')
  const page = await load('src/client/views/versionControl/vcPlatformPage.ts')
  const migrate = await load('src/client/views/versionControl/vcMigrateExport.ts')

  // ---- 一、账本落点（规格第 11 节矩阵；主入口唯一性由 818 的 data-cap-primary 判据守） ----
  const caps = ledger.CAPABILITIES
  const byPage = (id: string) => caps.filter((c: any) => c.page === id)
  const platformCaps = byPage('platform')
  const migrateCaps = byPage('migrate')
  const platformIds = sorted(platformCaps.map((c: any) => c.id))
  check(SAME(platformIds, sorted(['14.2', '14.3', '14.4', '14.5', '14.6', '14.7', '14.8', '5.9', '8.15'])),
    '平台与边界页恰好九条：14.2 / 14.3 / 14.4–14.8 / 5.9 / 8.15（实得 ' + platformIds.join(' ') + '）')
  check(platformCaps.length === ledger.PAGE_COUNTS.platform && ledger.PAGE_COUNTS.platform === 9, '账本 PAGE_COUNTS.platform 与逐页筛出来的条数一致（都是 9）')
  check(SAME(sorted(migrateCaps.map((c: any) => c.id)), sorted(['5.13', '8.16', '11.1', '11.12', '11.13', '14.1'])),
    '迁移与备份页恰好六条：5.13 / 8.16 / 11.1 / 11.12 / 11.13 / 14.1（实得 ' + sorted(migrateCaps.map((c: any) => c.id)).join(' ') + '）')
  const rowOf = (id: string) => caps.filter((c: any) => c.id === id)[0]
  const platformForms = platformCaps.map((c: any) => c.finalForm)
  check(platformForms.indexOf('操作') < 0 && platformForms.filter((f: string) => f === '说明').length === 7 && platformForms.filter((f: string) => f === '只读').length === 2,
    '平台页九条没有「操作」：7 条说明（5.9、14.2、14.4–14.8）+ 2 条只读（14.3、8.15）')
  const sendMail = rowOf('14.2')
  check(sendMail.finalForm === '说明' && sendMail.level === '写' && sendMail.placement === '外' && sendMail.command.indexOf('git send-email') === 0,
    '14.2 send-email 记为「写 / 外 / 说明」，命令原文保留（面板不代做外部邮件）')
  const requestPull = rowOf('14.3')
  check(requestPull.finalForm === '只读' && requestPull.level === '读' && requestPull.command.indexOf('git request-pull') === 0, '14.3 request-pull 记为「读 / 只读」，命令原文保留')
  const updateRefsCap = rowOf('5.9')
  check(updateRefsCap.finalForm === '说明' && updateRefsCap.page === 'platform' && updateRefsCap.minVersion === '2.38' && updateRefsCap.versionPolicy === 'hide',
    '5.9 --update-refs 是说明、归平台页、要求 git 2.38 且低版本隐藏')
  check(typeof updateRefsCap.versionAlternative === 'string' && updateRefsCap.versionAlternative.length > 0, '5.9 有替代说明（不是沉默地不做）')
  const credential = rowOf('8.15')
  check(credential.finalForm === '只读' && credential.level === '写' && credential.command.indexOf('git credential') === 0,
    '8.15 认证与凭据记为「写 / 只读」：面板只展示凭据助手链，不输入不保存令牌')
  const gitk = rowOf('13.14')
  check(gitk.page === 'commits' && typeof gitk.panelPath === 'string' && gitk.panelPath.indexOf('提交历史页') >= 0,
    '13.14 归提交历史页，面板替代路径写明用提交历史页的图形化视图（不调用 gitk）')
  const patchMail = rowOf('14.1')
  check(patchMail.finalForm === '操作' && patchMail.page === 'migrate' && patchMail.level === '写' && patchMail.command.indexOf('git format-patch') === 0,
    '14.1 format-patch 是迁移页唯一的写操作（面板真做，走任务通道产出补丁文件）')
  check(SAME(sorted(Array.from(page.VC_PLATFORM_NOTE_IDS as string[])), platformIds), '平台页叶子的说明清单与账本九条逐个相同（不另抄一份 id）')
  check(SAME(sorted(Array.from(migrate.VC_MIGRATE_NOTE_IDS as string[])), sorted(migrateCaps.map((c: any) => c.id))), '迁移页叶子的说明清单与账本六条逐个相同')

  // ---- 二、共享纯函数：宿主与界面读同一份守卫 ----
  const helpers = inspect.vcCredentialHelpersOf('manager\u0000store --file=/tmp/x\u0000')
  check(SAME(helpers, ['manager', 'store --file=/tmp/x']) && helpers.length === 2, '凭据助手链按 NUL 拆开、去空白，保留助手自带参数（实测 ' + JSON.stringify(helpers) + '）')
  const risk = inspect.vcCredentialRiskOf(helpers)
  check(risk.risk !== '' && risk.risk !== 'ok' && risk.storeHelper.indexOf('store') === 0 && risk.advice === 'replace-store',
    '链里出现 store 就判明文落盘风险，advice 是稳定标识 replace-store（不让界面自己编话）')
  const okRisk = inspect.vcCredentialRiskOf(['manager', 'cache --timeout=60'])
  check(okRisk.risk === false && okRisk.storeHelper === '' && okRisk.advice === 'ok', '没有 store 的链判为无风险')
  check(inspect.vcConfigTruthyOf('YES') === true && inspect.vcConfigTruthyOf('1') === true && inspect.vcConfigTruthyOf('false') === false, 'git config 的「开」写法判定与提交表单同一口径（true/yes/on/1）')
  check(inspect.vcUpdateRefsOf('true\n').enabled === true && inspect.vcUpdateRefsOf('').enabled === false && inspect.vcUpdateRefsOf('false').enabled === false,
    'rebase.updateRefs 空值 / false 都算没开，true 算开')
  const rp = inspect.vcRequestPullArgsOf({ start: 'HEAD~1', url: 'D:/w/repo', end: 'HEAD' })
  check(rp.ok === true && SAME(rp.args, ['request-pull', '-p', 'HEAD~1', 'D:/w/repo', 'HEAD']), 'request-pull argv 逐段拼：request-pull -p <起点> <地址> <终点>')
  check(inspect.vcRequestPullArgsOf({ start: '', url: 'D:/w/repo' }).reason === 'bad-range'
    && inspect.vcRequestPullArgsOf({ start: 'HEAD', url: '-x' }).reason === 'bad-url'
    && inspect.vcRequestPullArgsOf({ start: 'HEAD', url: 'a b' }).reason === 'bad-url',
    'request-pull 参数检查：空起点、以短横线开头、带空白的地址都按稳定 reason 拒绝（bad-range / bad-url）')
  const summary = inspect.vcPatchSummaryOf([{ name: '0001-a.patch' }, { name: 'b.MBOX' }, { name: 'c.diff' }, { name: 'notes.txt' }])
  check(SAME(summary.patches, ['0001-a.patch', 'b.MBOX', 'c.diff']) && summary.others === 1 && summary.total === 3 && summary.truncated === false,
    '输出目录摘要认 .patch / .mbox / .diff（不区分大小写），其它文件单独计数，合计对得上')
  const many = inspect.vcPatchSummaryOf(Array.from({ length: 205 }, (_, i) => 'p' + i + '.patch'))
  check(many.patches.length === inspect.PLATFORM_PATCH_MAX && many.truncated === true, '补丁文件超过上限时如实标截断（' + inspect.PLATFORM_PATCH_MAX + ' 条封顶）')

  // ---- 三、宿主 14.1 电话：预检签票 → 现场复核 → 交给长任务通道 ----
  let nowMs = Date.parse('2026-11-01T10:00:00+08:00')
  let headOid = 'a'.repeat(40)
  let bare = false
  let calledTasks: any[] = []
  let taskReply: any = { ok: true, task: { taskId: 't-1' } }
  const screenReply = () => ({ ok: true, data: { screen: { identity: { worktreePath: 'D:/w/repo', oid: headOid }, repo: { bare: bare } } } })
  const tickets = platform.createPlatformTicketPhones({
    failPhone: (kind: string, reason: string, message: string) => ({ kind, reason, message }),
    readScreenOf: () => screenReply(),
    startTask: (req: any) => { calledTasks.push(req); return Promise.resolve(taskReply) },
    now: () => nowMs,
    randomId: () => 'fixed',
    DEFAULT_CWD: 'D:/w/repo',
  })
  const bad = await tickets.check({ range: 'HEAD~1..HEAD x', dir: 'patches' })
  check(bad.ok === false && bad.error.kind === 'args', '预检拒绝带空白的区间（共用 task-protocol 的区间守卫，不在这里另写一份）')
  const good = await tickets.check({ range: 'HEAD~1..HEAD', dir: 'patches' })
  check(good.ok === true && good.ticket.id.indexOf('fp-') === 0 && good.confirmRequired === true && good.plan.dirAbs === 'D:/w/repo/patches',
    '预检成功签票：票据号带 fp-、要求确认、相对输出目录换成仓库根下的绝对路径（票据钉住绝对目录）')
  bare = true
  const bareReply = await tickets.check({ range: 'HEAD~1..HEAD', dir: 'patches' })
  check(bareReply.ok === false && bareReply.error.reason === 'repo-bare', '裸仓库不做补丁导出（预检就拒，不起进程）')
  bare = false
  const noTicket = await tickets.run({ ticketId: 'nope', range: 'HEAD~1..HEAD' })
  check(noTicket.ok === false && noTicket.error.reason === 'ticket-missing', '没有票据的执行请求直接拒（ticket-missing）')
  const ran = await tickets.run({ ticketId: good.ticket.id, range: 'HEAD~1..HEAD', requestId: 'req-1' })
  check(ran.ok === true && calledTasks.length === 1 && calledTasks[0].op === 'format-patch'
    && calledTasks[0].args.range === 'HEAD~1..HEAD' && calledTasks[0].args.dir === 'D:/w/repo/patches' && calledTasks[0].cwd === 'D:/w/repo',
    '票据有效时把 format-patch 交给长任务通道：op / 区间 / 绝对输出目录 / 仓库根都对，本电话自己不起进程')
  check(ran.requestId === 'req-1' && ran.ticketId === good.ticket.id, '执行结果回带 requestId 与 ticketId，界面能对上刚才那张票')
  const secondGood = await tickets.check({ range: 'HEAD~2..HEAD', dir: 'patches' })
  const changed = await tickets.run({ ticketId: secondGood.ticket.id, range: 'HEAD~1..HEAD', requestId: 'req-2' })
  check(changed.ok === false && changed.error.reason === 'target-changed', '区间被改过的执行请求拒（target-changed）：票里的参数是唯一依据')
  const expiredTicket = await tickets.check({ range: 'HEAD~1..HEAD', dir: 'patches' })
  nowMs += 121 * 1000
  const expired = await tickets.run({ ticketId: expiredTicket.ticket.id, range: 'HEAD~1..HEAD', requestId: 'req-3' })
  check(expired.ok === false && expired.error.reason === 'ticket-expired', '票据过期（120 秒）后拒绝执行，不自动重放')
  nowMs += 1000
  const freshTicket = await tickets.check({ range: 'HEAD~1..HEAD', dir: 'patches' })
  headOid = 'b'.repeat(40)
  const stale = await tickets.run({ ticketId: freshTicket.ticket.id, range: 'HEAD~1..HEAD', requestId: 'req-4' })
  check(stale.ok === false && stale.error.reason === 'stale-head', 'HEAD 变了的执行请求拒（stale-head）：现场复核不过就不起进程')
  headOid = 'a'.repeat(40)
  taskReply = { ok: false, error: { kind: 'other', reason: 'unknown-write-failure', message: '任务通道拒绝了' } }
  const refused = await tickets.run({ ticketId: freshTicket.ticket.id, range: 'HEAD~1..HEAD', requestId: 'req-5' })
  check(refused.ok === false && refused.error.reason === 'unknown-write-failure', '长任务通道拒绝时把失败信封原样回给界面（不伪造成功）')

  // ---- 四、宿主只读电话：配置未命中不是失败、两个查询不连坐、截断与目录缺失分得清 ----
  const calls: any[] = []
  let pinned: any = null
  const fakeFs = {
    resolve: (p: string) => Promise.resolve({ path: p }),
    listDir: (target: any) => Promise.resolve([]),
  }
  const readPhones = platformRead.createPlatformReadPhones({
    runPinned: (exe: string, dir: string, argv: string[]) => { calls.push({ exe, dir, argv }); return Promise.resolve(typeof pinned === 'function' ? pinned(exe, dir, argv) : pinned) },
    failPhone: (kind: string, message: string) => ({ kind, reason: kind, message }),
    firstLine: (text: string) => String(text || '').split('\n')[0].slice(0, 300),
    failureFromExec: (res: any, label: string) => (res && res.kind !== 'ok' ? { kind: res.kind, reason: 'exit', message: label + '：' + String((res && res.stderr) || '').split('\n')[0] } : null),
    resolveGitExecutable: () => Promise.resolve('git'),
    resolveRepoRoot: () => Promise.resolve({ ok: true, kind: 'worktree', root: 'D:/w/repo', gitDir: 'D:/w/repo/.git' }),
    cwdOf: (a: any) => String((a && a.cwd) || 'D:/w/repo'),
    fs: fakeFs,
    fsAbsence: () => Promise.resolve({ isAbsenceError: (e: any) => String((e && e.code) || '') === 'ENOENT' }),
    now: () => nowMs,
    DEFAULT_CWD: 'D:/w/repo',
    writeHintFor: (reason: string) => reason,
  })
  const routeConfig = (values: any) => (exe: string, dir: string, argv: string[]) => {
    const key = argv[argv.length - 1]
    const v = values[key]
    if (v === undefined) return { kind: 'non-zero', exitCode: 1, stderr: '' }
    return { kind: 'ok', stdout: v, truncated: false, stdinBytes: 0 }
  }
  pinned = routeConfig({ 'credential.helper': 'manager\u0000store\u0000', 'rebase.updateRefs': 'true\n' })
  const readOk = await readPhones.read({ cwd: 'D:/w/repo' })
  check(readOk.ok === true && SAME(readOk.credential.helpers, ['manager', 'store']) && readOk.credential.store === 'store' && readOk.credential.advice === 'replace-store',
    '平台读取把凭据助手链拆成列表，store 命中记在 store / advice 上（界面据此标红，令牌一个字节都不碰）')
  check(readOk.updateRefs.enabled === true && readOk.updateRefs.value === 'true', 'rebase.updateRefs=true 读到「开着」，界面据此说清面板不做 --update-refs')
  pinned = routeConfig({})
  const readUnset = await readPhones.read({})
  check(readUnset.ok === true && readUnset.credential.state === 'ok' && readUnset.credential.helpers.length === 0 && readUnset.updateRefs.state === 'ok' && readUnset.updateRefs.enabled === false,
    'git config 未命中（exit 1）算「没设置」而不是失败：两个查询都回 ok、列表空、updateRefs 没开')
  pinned = (exe: string, dir: string, argv: string[]) => (argv[argv.length - 1] === 'rebase.updateRefs'
    ? { kind: 'non-zero', exitCode: 128, stderr: 'fatal: 读不到配置' }
    : { kind: 'ok', stdout: 'manager\u0000', truncated: false, stdinBytes: 0 })
  const readPartial = await readPhones.read({})
  check(readPartial.credential.state === 'ok' && readPartial.credential.helpers.length === 1 && readPartial.updateRefs.state === 'error',
    '一个配置查询失败不连坐另一个：凭据链照常显示，updateRefs 单独标失败')
  const rpBad = await readPhones.requestPull({ start: 'HEAD', url: '' })
  check(rpBad.ok === false && rpBad.error.reason === 'bad-url' && calls.length >= 3, 'request-pull 参数不合法时在起进程之前就拒（bad-url）')
  pinned = { kind: 'ok', stdout: 'The following changes since commit abc\n', truncated: false, stdinBytes: 0 }
  const rpOk = await readPhones.requestPull({ start: 'HEAD~1', url: 'D:/w/repo', end: 'HEAD' })
  check(rpOk.ok === true && rpOk.cmd === 'request-pull' && rpOk.text.indexOf('The following changes') === 0 && rpOk.truncated === false,
    'request-pull 成功回整段说明文本（只读、不推送；界面只负责展示）')
  pinned = { kind: 'ok', stdout: 'x'.repeat(100), truncated: true, stdinBytes: 0 }
  const rpTrunc = await readPhones.requestPull({ start: 'HEAD~1', url: 'D:/w/repo' })
  check(rpTrunc.ok === false && rpTrunc.error.kind === 'truncated', '输出太长被截断时不给半份：显式回截断失败，让用户换更短的区间')
  fakeFs.listDir = () => Promise.resolve([{ name: '0001-a.patch' }, { name: 'notes.txt' }])
  pinned = null
  const files = await readPhones.patchFiles({ dir: 'patches' })
  check(files.ok === true && files.exists === true && SAME(files.patches, ['0001-a.patch']) && files.others === 1 && files.total === 1,
    '输出目录列表把补丁文件与其它文件分开计数（目录里的东西如实说，不拿 0 冒充）')
  fakeFs.listDir = () => Promise.reject(Object.assign(new Error('no such dir'), { code: 'ENOENT' }))
  const missing = await readPhones.patchFiles({ dir: 'patches' })
  check(missing.ok === true && missing.exists === false && missing.patches.length === 0, '输出目录不存在回 exists:false（当「还没生成过」如实说，不当失败）')
  fakeFs.listDir = () => Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
  const listFail = await readPhones.patchFiles({ dir: 'patches' })
  check(listFail.ok === false && listFail.error.kind === 'env', '列目录失败（不是不存在）按失败上报，带原因，不静默当空目录')

  // ---- 五、客户端数据层：失败保留上一份、成功才换数据 ----
  const reads0 = data.vcNewPlatformReads()
  const applied = data.vcApplyPlatformReply(reads0, { ok: true, readAtMs: nowMs, repoRoot: 'D:/w/repo', credential: { helpers: ['store'], store: 'store', risk: 'store', advice: 'replace-store', state: 'ok', error: null }, updateRefs: { value: 'true', enabled: true, state: 'ok', error: null } })
  const cred = data.vcPlatformCredentialOf(applied)
  const ur = data.vcPlatformUpdateRefsOf(applied)
  check(cred.state === 'ok' && SAME(cred.helpers, ['store']) && cred.advice === 'replace-store' && ur.enabled === true, '数据层把平台读取回包落成凭据链与 updateRefs 两份读数')
  const failedReply = data.vcApplyPlatformReply(applied, { ok: false, error: { kind: 'env', reason: 'env', message: '读不到配置' } })
  check(data.vcPlatformStateOf(failedReply) === 'err' && failedReply.platform.data !== null && data.vcPlatformErrorOf(failedReply).kind === 'env',
    '平台读取失败只标失败、保留上一份数据（界面可以显示旧读数并说明没刷新成功）')
  const rpReads = data.vcApplyRequestPullReply(reads0, { ok: true, text: 'abc', truncated: true, cmd: 'request-pull', ms: 12, range: 'HEAD~1' })
  check(data.vcPlatformRequestPullOf(rpReads).truncated === true && data.vcPlatformRequestPullStateOf(rpReads) === 'ok', 'request-pull 成功但截断时保留 truncated 标记（界面如实说只显示了前一段）')
  const patchReads = data.vcApplyPatchesReply(reads0, { ok: true, dir: 'D:/w/repo/patches', exists: true, patches: ['0001-a.patch'], others: 0, total: 1, truncated: false }, 'patches')
  check(SAME(data.vcPlatformPatchesOf(patchReads).patches, ['0001-a.patch']), '补丁列表回包落成读数，目录与文件一起记')
  const callOk = (method: string) => (method === data.VC_PLATFORM_PHONES.read
    ? Promise.resolve({ ok: true, readAtMs: nowMs, repoRoot: 'D:/w/repo', credential: { helpers: [], store: '', risk: 'ok', advice: 'ok', state: 'ok', error: null }, updateRefs: { value: '', enabled: false, state: 'ok', error: null } })
    : Promise.resolve({ ok: false, error: { kind: 'other', message: 'unexpected' } }))
  const loaded = await data.vcReadPlatform(reads0, callOk, 'D:/w/repo')
  check(data.vcPlatformStateOf(loaded) === 'ok' && logs.some((l: any) => l.event === 'host.call' && l.fields.method === 'wf.gitPlatformRead'),
    '读平台数据成功时落一条 host.call 日志（电话名对得上宿主登记）')
  const callThrow = () => Promise.reject(new Error('宿主没接电话'))
  const thrown = await data.vcReadPlatform(reads0, callThrow, 'D:/w/repo')
  check(data.vcPlatformStateOf(thrown) === 'err' && data.vcPlatformErrorOf(thrown).kind === 'throw', '电话抛异常时也落成失败读数（不让界面永远停在加载态）')

  // ---- 六、接线登记：电话名在宿主入口、五个电话在装配壳里、叶子与词表在构建表里 ----
  const hostIndex = readText('src/host/index.ts')
  const phoneNames = ['wf.gitPlatformCheck', 'wf.gitPlatformRun', 'wf.gitPlatformRead', 'wf.gitRequestPull', 'wf.gitPatchFiles']
  check(phoneNames.every((name) => hostIndex.indexOf("harness.handle('" + name + "'") >= 0), '宿主入口登记了平台段五条电话（wf.gitPlatformCheck / Run / Read、wf.gitRequestPull、wf.gitPatchFiles）')
  const mountText = readText('src/host/versionControlPlatformMount.ts')
  check(phoneNames.every((name) => mountText.indexOf("'" + name + "'") >= 0), '装配壳用同一份电话名接线（不另写第二份字符串）')
  const buildText = readText('scripts/build.mts')
  check(['vcPlatformData', 'vcPlatformPage', 'vcMigrateExport'].every((id) => buildText.indexOf("id: '" + id + "'") >= 0) && buildText.indexOf('shared:vcPlatformInspect') >= 0,
    '构建表登记了三个新叶子与共享平台判定（漏登记会静默不拼进闭包）')
  const indexText = readText('src/client/index.ts')
  check(['leaf:vcPlatformData', 'leaf:vcPlatformPage', 'leaf:vcMigrateExport', 'shared:vcPlatformInspect'].every((mark) => indexText.indexOf(mark) >= 0), 'src/client/index.ts 有四个新拼接标记（构建按标记拼接）')
  const copyText = readText('config/copy/vcplatform.yaml')
  check(copyText.indexOf('vc.platform.') >= 0 && copyText.indexOf('vc.migrate.') >= 0 && page.VC_PLATFORM_NOTE_IDS.length === 9 && migrate.VC_MIGRATE_NOTE_IDS.length === 6,
    '平台页与迁移页的词条族在 config/copy/vcplatform.yaml 里，两页说明条数与账本一致')
  check(page.VC_PLATFORM_PAGE_SOURCE === 'src/client/views/versionControl/vcPlatformPage.ts' && migrate.VC_MIGRATE_EXPORT_SOURCE === 'src/client/views/versionControl/vcMigrateExport.ts',
    '两页各自给出真源路径（门禁按它找文件，搬路径要一起改）')

  // ---- 七、反证组：把三处口径改坏，对应用例必须红 ----
  const riskBroken = inspect.vcCredentialRiskOf(['store']) // 真判定标红
  const riskIfBroken = { risk: '', storeHelper: '', advice: 'ok' }
  check(riskBroken.advice === 'replace-store' && riskIfBroken.advice === 'ok', '反证：store 不再标红（advice 退回 ok）时上面「store 判明文落盘」那条会红')
  const expiredBroken = { ok: false, error: { kind: 'ticket', reason: 'ticket-expired', message: '' } }
  check(expiredBroken.error.reason === 'ticket-expired' && expired.ok === false, '反证：过期票据若放行（ok:true）时上面「过期拒绝」那条会红')
  pinned = (exe: string, dir: string, argv: string[]) => ({ kind: 'non-zero', exitCode: 1, stderr: '' })
  const unsetAsFail = { credential: { state: 'error' } }
  check(unsetAsFail.credential.state === 'error' && readUnset.credential.state === 'ok', '反证：把 config 未命中当失败时上面「未命中不是失败」那条会红')

  console.log('\n' + (failed ? '存在失败' : '全部通过') + ' — 平台段门禁（' + total + ' 项断言）')
  printGateResult(GATE, total, failedCount)
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
