// 门禁归属: src/client/views/versionControl/vcWorktreesPage.ts
// 门禁归属: src/client/views/versionControl/vcWorktreesView.ts
// 门禁归属: src/client/views/versionControl/vcWorktreesData.ts
// 门禁归属: src/client/views/versionControl/vcWorktreesOps.ts
// 门禁归属: src/shared/version-control/src/worktree-ops.ts
// 门禁归属: config/copy/vcworktrees.yaml
// verify-1586-worktrees.ts —— 工作树页域九八条的门禁（规格 #1586 之 T17 #1752；#1904 补原型 93–97 的三张表单）。
//
// 这一扇守三件事，缺一条都算没过：
//   ① 八条能力（9.1 列表 / 9.2 新建 / 9.3 用已有分支建 / 9.4 删除 / 9.5 清除失效登记 /
//      9.6 锁与解锁 / 9.7 移动 / 9.8 稀疏检出）在页面上各有一个真实动作，动作落到真正的 git 子命令上；
//   ② 安全边界：不信 --force 与 -f -f 那两个口子，危险动作（删 / 清 / 移 / 写稀疏规则）先预检再确认，
//      锁必须写原因，版本不够时给替代做法而不是硬画一个点不动的按钮；
//   ③ 一份数据：页面与首屏聚合读的是同一份 worktrees 片，版本门读的是同一份 version 片里的 switches，
//      判定调的是共享层 worktreeJudge 这同一个纯函数 —— 界面不另写一份；
//   ④ #1904：新建（新建分支带 -b / 已有分支）、移动、稀疏检出三条入口按原型 93–97 落在页脚与展开行，
//      三种新建表单错误留在表单里；旧的能力入口清单与稀疏计划面已拆，界面不留第二条路。
//
// 做法：先读真源码文本（页面 / 处理层 / 数据层 / 宿主叶子 / 挂载点 / 构建登记 / 词表），按组断言；
// 再直接加载共享层的真模块（worktree-ops.ts 无 import，可以直接 import）跑纯函数，
// 断言八条动作的 argv、判定与清单行模型；最后用「把某一处故意改坏」的副本反证每组判据真的会红。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1586-worktrees.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-worktrees'
let failed = false
let total = 0
const check = (ok: any, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const raw = (text: string): string => String(text).split('\r\n').join('\n')
// 只看代码、不看注释：注释里写明「不提供 --force」「绝不用 data-cap-primary」是说明，不算真的用了。
// 块注释与行注释都去掉；字符串里的「不提供 --force」这类人话仍会留下，所以判开关用「整段就是那个开关」的字面量匹配。
const codeOnly = (text: string): string => raw(text).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(function (line: string): string {
  const at = line.indexOf('//')
  return at < 0 ? line : line.slice(0, at)
}).join('\n')
const FORCE_TOKEN_RE = /['"](?:--force|-f|-ff|--force-with-lease)['"]/

/** 页面 / 处理层 / 数据层 / 宿主叶子 / 挂载点 / 构建登记 / 词表：全部读真源文本，不读产物。 */
const SRC = {
  page: raw(read('src/client/views/versionControl/vcWorktreesPage.ts')),
  ops: raw(read('src/client/views/versionControl/vcWorktreesOps.ts')),
  data: raw(read('src/client/views/versionControl/vcWorktreesData.ts')),
  hostLeaf: raw(read('src/host/versionControlWorktrees.ts')),
  host: raw(read('src/host/versionControl.ts')),
  mount: raw(read('src/host/versionControlWorktreesMount.ts')),
  hostIndex: raw(read('src/host/index.ts')),
  shell: raw(read('src/client/views/versionControl/vcShellPages.ts')),
  ui: raw(read('src/client/views/versionControl/vcWorktreesUi.ts')),
  formOps: raw(read('src/client/views/versionControl/vcWorktreesFormOps.ts')),
  view: raw(read('src/client/views/versionControl/vcWorktreesView.ts')),
  formView: raw(read('src/client/views/versionControl/vcWorktreesFormView.ts')),
  rows: raw(read('src/client/views/versionControl/vcWorktreesRows.ts')),
  build: raw(read('scripts/build.mts')),
  entry: raw(read('src/client/index.ts')),
  yaml: raw(read('config/copy/vcworktrees.yaml')),
}

/** 每一条判定：给一份源码表，回「这一组是否真的守住了」。反证靠把它们逐个改坏来验证。 */
const J = {
  // 八条能力各有入口，四条行内动作挂在清单行上。
  entries: (s: any): boolean => ['9.1', '9.2', '9.3', '9.4', '9.5', '9.6', '9.7', '9.8'].every(function (id: string): boolean {
    return s.page.indexOf("capId: '" + id + "'") >= 0
  }),
  rowActions: (s: any): boolean => ["{ capId: '9.4', op: 'remove', row: true },", "{ capId: '9.6', op: 'lock', row: true },", "{ capId: '9.7', op: 'move', row: true },", "{ capId: '9.8', op: 'sparse-list', row: true },"].every(function (t: string): boolean { return s.page.indexOf(t) >= 0 }),
  // 两条电话：预检与执行，名字与宿主注册一致；界面只走这两条。
  phones: (s: any): boolean => s.ops.indexOf("check: 'wf.gitWorktreeCheck'") >= 0 && s.ops.indexOf("run: 'wf.gitWorktreeRun'") >= 0 &&
    s.hostIndex.indexOf("harness.handle('wf.gitWorktreeCheck'") >= 0 && s.hostIndex.indexOf("harness.handle('wf.gitWorktreeRun'") >= 0,
  // 执行必须带票据、请求号与显式确认；预检与执行都只从 VC_WORKTREE_PHONES 取电话名。
  runArgs: (s: any): boolean => s.ops.indexOf('confirm: true,') >= 0 && s.ops.indexOf('ticketId: vcWtStr(ticketId)') >= 0 && s.ops.indexOf('requestId: vcWtStr(requestId)') >= 0 &&
    s.ops.indexOf('call(VC_WORKTREE_PHONES.check') >= 0 && s.ops.indexOf('call(VC_WORKTREE_PHONES.run') >= 0,
  // 长任务走 T05 的通道（wf.gitTask*），工作树这八条是本地短写，一条都不许落过去。
  noLongTask: (s: any): boolean => codeOnly(s.ops).indexOf('wf.gitTask') < 0 && codeOnly(s.hostLeaf).indexOf('wf.gitTask') < 0 && codeOnly(s.page).indexOf('wf.gitTask') < 0,
  // 页面与首屏共用同一份片：worktrees 片出清单、version 片出开关。
  sameSlice: (s: any): boolean => s.data.indexOf("vcFirstScreenSliceOf(reads, 'worktrees')") >= 0 && s.data.indexOf("vcFirstScreenSliceOf(reads, 'version')") >= 0 && s.data.indexOf('switches') >= 0,
  // 判定只有一个真源：界面与宿主都调共享层的 worktreeJudge。
  oneJudge: (s: any): boolean => s.data.indexOf('worktreeJudge(op, ctx)') >= 0 && s.hostLeaf.indexOf('worktreeJudge(op, ctx)') >= 0,
  // 数据层只读快照，不自己发电话（那是首屏聚合的活）。
  dataNoPhone: (s: any): boolean => s.data.indexOf('wf.git') < 0 && s.data.indexOf('call(') < 0,
  // 危险动作的确认卡借页面壳的四段固定画法，不自己拼一套。
  confirmCard: (s: any): boolean => codeOnly(s.page).indexOf('vcShellConfirmCardNode') >= 0 && codeOnly(s.page).indexOf("'data-wt-confirm'") >= 0,
  // 版本门说明常驻画出来（hidden / degraded 两种），并带替代做法。
  versionHint: (s: any): boolean => s.page.indexOf("'data-wt-version'") >= 0 && s.page.indexOf('vcWorktreesVersionHintOf') >= 0,
  // 页面绝不用主入口标记 data-cap-primary（每条能力的唯一主入口由能力行负责，818 逐条数）。
  noPrimary: (s: any): boolean => codeOnly(s.page).indexOf('data-cap-primary') < 0,
  // #1904：三条入口按原型 93–97 落到页脚与展开行，旧的能力入口清单与稀疏计划面整块消失。
  //   判据看的是「新表单真的在画 / 旧计划面真的没了」，不是只看常量还在。
  forms: (s: any): boolean => s.formView.indexOf('vcWtCreateFormNode') >= 0 && s.formView.indexOf('vcWtMoveFormNode') >= 0 &&
    s.formView.indexOf('vcWtSparsePanelNode') >= 0 && s.formView.indexOf("'data-wt-create-form': '1'") >= 0 &&
    s.formView.indexOf("'data-wt-move-form': path") >= 0 && s.formView.indexOf("'data-wt-sparse-form': path") >= 0,
  oldPlanGone: (s: any): boolean => codeOnly(s.page).indexOf('vcWtEntriesNode') < 0 && codeOnly(s.page).indexOf('vcWtSparsePlanNode') < 0 &&
    codeOnly(s.view).indexOf('vcWtEntriesNode') < 0 && s.page.indexOf("'data-wt-entry'") < 0 && s.page.indexOf("'data-wt-plan'") < 0,
  // 表单提交后直接预检并凭票执行：三张表单各自带 auto 标记，runNow 一定存在；三条错误键留在处理层。
  autoRun: (s: any): boolean => s.formOps.indexOf('auto: true') >= 0 && s.formOps.indexOf('onSuccess') >= 0 &&
    s.formOps.indexOf('onFailure') >= 0 && s.ops.indexOf('const runNow') >= 0 && s.ops.indexOf('o.auto === true') >= 0 &&
    ['vc.wt.create.emptyPath', 'vc.wt.create.emptyBranch', 'vc.wt.create.noBranch', 'vc.wt.create.taken'].every(function (k: string): boolean { return s.formOps.indexOf(k) >= 0 }),
  // 结果条在页脚之后（原型 97 的位置），新建表单在页脚之前（原型 93 的页底浮层）。
  resultOrder: (s: any): boolean => {
    const list = s.view.indexOf('Array.prototype.push.apply(kids, vcWtListNodesOf')
    const create = s.view.indexOf("if (ui.create && ui.create.open === true) kids.push(vcWtCreateFormNode")
    const foot = s.view.indexOf('kids.push(vcWtFootNode')
    const banner = s.view.indexOf('const banner: any = vcWtResultBannerNode')
    return list >= 0 && create > list && foot > create && banner > foot && s.formView.indexOf("'data-wt-result': tone") >= 0
  },
  // 宿主叶子只借父文件的 runPinned 起进程，不自己碰 subprocess。
  pinnedOnly: (s: any): boolean => s.hostLeaf.indexOf('runPinned(') >= 0 && s.hostLeaf.indexOf('child_process') < 0 && s.hostLeaf.indexOf('spawn(') < 0,
  // 票据：有上限、有到期、六类过期与变化理由都翻成人话而不是静默重跑。
  ticketFlow: (s: any): boolean => ['TICKET_MAX', 'expiresAtMs', 'ticket-missing', 'ticket-expired', 'worktrees-changed', 'target-changed'].every(function (t: string): boolean { return s.hostLeaf.indexOf(t) >= 0 }),
  // 页面壳挂载点：只给工作树页加一段，且把读数与处理函数透传下去。
  shellMount: (s: any): boolean => s.shell.indexOf('#1752') >= 0 && s.shell.indexOf("page === 'worktrees'") >= 0 && s.shell.indexOf('vcWorktreesPageNode(h, t') >= 0 && s.shell.indexOf('reads: opts.reads') >= 0 && s.shell.indexOf('ops: opts.ops') >= 0,
  // 构建登记：共享层片段一处、客户端三叶按依赖次序各一行。
  buildReg: (s: any): boolean => s.build.indexOf('shared:vcWorktreeOps (spliced by build)') >= 0 && s.build.indexOf("id: 'vcWorktreesData'") >= 0 && s.build.indexOf("id: 'vcWorktreesOps'") >= 0 && s.build.indexOf("id: 'vcWorktreesPage'") >= 0,
  entryReg: (s: any): boolean => s.entry.indexOf('shared:vcWorktreeOps') >= 0 && s.entry.indexOf('leaf:vcWorktreesData') >= 0 && s.entry.indexOf('leaf:vcWorktreesOps') >= 0 && s.entry.indexOf('leaf:vcWorktreesPage') >= 0,
  // 词表：中英两段都得有这些键（理由标识符 / 动作名 / 替代做法）。
  words: (s: any): boolean => {
    const at = s.yaml.indexOf('\nen:')
    if (at < 0) return false
    const zh = s.yaml.slice(0, at)
    const en = s.yaml.slice(at)
    const keys: string[] = []
    for (const r of REASONS) keys.push('vc.wt.why.' + r)
    for (const a of ['list', 'add', 'add-branch', 'remove', 'prune', 'lock', 'unlock', 'move', 'sparse-list', 'sparse-set']) keys.push('vc.wt.action.' + a)
    for (const c of ['9.4', '9.5', '9.6', '9.7', '9.8']) keys.push('vc.wt.alt.' + c)
    // #1904 的三张表单与结果条：每个键都可能是单独出现的一句提示，两段缺一个就会在切换语言时露英文键名。
    for (const k of ['vc.wt.create.open', 'vc.wt.create.title', 'vc.wt.create.path', 'vc.wt.create.pathPlaceholder',
      'vc.wt.create.branch', 'vc.wt.create.branchPlaceholder', 'vc.wt.create.modeNew', 'vc.wt.create.modeExisting',
      'vc.wt.create.hintNew', 'vc.wt.create.hintExisting', 'vc.wt.create.recent', 'vc.wt.create.submit',
      'vc.wt.create.cancel', 'vc.wt.create.emptyPath', 'vc.wt.create.emptyBranch', 'vc.wt.create.noBranch',
      'vc.wt.create.taken', 'vc.wt.create.failed', 'vc.wt.move.title', 'vc.wt.move.label', 'vc.wt.move.hint',
      'vc.wt.move.submit', 'vc.wt.move.empty', 'vc.wt.move.taken', 'vc.wt.move.same', 'vc.wt.sparse.title',
      'vc.wt.sparse.hint', 'vc.wt.sparse.save', 'vc.wt.sparse.cancel', 'vc.wt.sparse.empty', 'vc.wt.sparse.current',
      'vc.wt.sparse.noDirs', 'vc.wt.sparse.keep', 'vc.wt.sparse.unkeep', 'vc.wt.result.tag', 'vc.wt.result.close',
      'vc.wt.result.closeGlyph', 'vc.wt.result.created', 'vc.wt.result.createdNewDetail',
      'vc.wt.result.createdExistingDetail', 'vc.wt.result.moved', 'vc.wt.result.movedDetail',
      'vc.wt.result.sparseSaved', 'vc.wt.result.sparseAll', 'vc.wt.result.sparseDetail',
      'vc.wt.result.sparseAllDetail', 'vc.wt.result.failed', 'vc.wt.listSep']) keys.push(k)
    return keys.every(function (k: string): boolean { return zh.indexOf('\n  ' + k + ':') >= 0 && en.indexOf('\n  ' + k + ':') >= 0 })
  },
}

/** 八条能力的动作合同（能力号 / 动作 / 强度 / 要哪些输入 / 要不要确认 / 是不是破坏性）。 */
const CONTRACTS: any[] = [
  ['list', '9.1', '读', '', false, false],
  ['add', '9.2', '写', 'path', true, false],
  ['add-branch', '9.3', '写', 'path,branch', true, false],
  ['remove', '9.4', '毁', 'path', true, true],
  ['prune', '9.5', '写', '', true, true],
  ['lock', '9.6', '写', 'path,reason', true, false],
  ['unlock', '9.6', '写', 'path', true, false],
  ['move', '9.7', '写', 'path,dest', true, true],
  ['sparse-list', '9.8', '读', 'path', false, false],
  ['sparse-set', '9.8', '写', 'path,dirs', true, true],
]
/** 理由标识符的固定表（新增理由必须先登记，界面按它取词；少一条就会掉回「未知」）。 */
const REASONS: string[] = ['ok', 'path-blank', 'path-bad', 'path-exists', 'path-missing', 'path-same', 'path-occupied', 'dest-blank', 'dest-bad', 'branch-blank', 'branch-bad', 'branch-missing', 'reason-blank', 'reason-bad', 'dirs-blank', 'dirs-bad', 'worktree-not-listed', 'worktree-is-current', 'worktree-locked', 'worktree-not-locked', 'worktree-dirty', 'nothing-to-prune', 'version-too-old', 'version-unknown', 'confirm-required', 'worktrees-changed', 'target-changed', 'ticket-missing', 'ticket-expired']

/** 清单行的样板：当前这一棵 + 一棵普通工作树 + 一棵锁着的 + 一棵待清理的。 */
const rowOf = (over: any): any => Object.assign({ path: 'D:/w/repo/.wt/a', display: 'a', head: 'a'.repeat(40), branch: 't/a', detached: false, bare: false, current: false, locked: false, lockReason: '', lockUnknown: false, prunable: false, prunableReason: '' }, over || {})
const ROWS: any[] = [rowOf({ path: 'D:/w/repo', display: 'repo', branch: 'main', current: true }), rowOf({}), rowOf({ path: 'D:/w/repo/.wt/locked', display: 'locked', locked: true, lockReason: '演示' }), rowOf({ path: 'D:/w/repo/.wt/gone', display: 'gone', prunable: true, prunableReason: '目录不在了' })]

async function main(): Promise<void> {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/worktree-ops.ts')).href)
  const loc = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/locale-data.ts')).href)
  console.log('工作树页域九八条门禁（#1752：入口与真实动作 / 危险确认 / 版本门 / 一份数据 / 构建挂载 / 反证）')

  // ---------- 一、共享动作层：八条能力 → 十个动作 → 真实 argv ----------
  check(JSON.stringify(mod.WORKTREE_CAP_IDS) === JSON.stringify(['9.1', '9.2', '9.3', '9.4', '9.5', '9.6', '9.7', '9.8']), '一·1 八条能力号就是规格域九的 9.1–9.8，次序逐字一致')
  const got = (mod.WORKTREE_ACTIONS as any[]).map(function (a: any): string { return [a.id, a.capId, a.level, (a.needs || []).join(','), a.confirm, a.danger].join('|') })
  const want = CONTRACTS.map(function (c: any[]): string { return c.join('|') })
  check(got.length === want.length && got.every(function (g: string, i: number): boolean { return g === want[i] }), '一·2 十个动作的合同逐条一致（能力号 / 强度 / 输入 / 确认 / 破坏性），实得 ' + got.length + ' 条')
  for (const c of CONTRACTS) {
    const a = (mod.WORKTREE_ACTIONS as any[]).filter(function (x: any): boolean { return x.id === c[0] })[0]
    check(!!a && a.capId === c[1] && (a.needs || []).join(',') === c[3] && a.confirm === c[4] && a.danger === c[5], '一·3 动作 ' + c[0] + ' 归在能力 ' + c[1] + '，要输入 [' + c[3] + ']，确认 ' + c[4] + '，破坏性 ' + c[5])
  }
  check(JSON.stringify(mod.WORKTREE_REASONS) === JSON.stringify(REASONS), '一·4 理由标识符固定表 ' + REASONS.length + ' 条，一条不多一条不少（界面按它取词）')
  const ARGV: any[] = [
    ['list', {}, ['worktree', 'list', '--porcelain', '-z']],
    ['list-plain', {}, ['worktree', 'list', '--porcelain']],
    ['add', { path: 'D:/w/x' }, ['worktree', 'add', 'D:/w/x']],
    // #1904：原型 93 / 97 的「新建分支」是 git worktree add -b <分支> <目录>；不带分支名的旧形态一个字节不变。
    ['add', { path: 'D:/w/x', branch: 't/x' }, ['worktree', 'add', '-b', 't/x', 'D:/w/x']],
    ['add-branch', { path: 'D:/w/x', branch: 't/x' }, ['worktree', 'add', 'D:/w/x', 't/x']],
    ['remove', { path: 'D:/w/x' }, ['worktree', 'remove', 'D:/w/x']],
    ['prune-preview', {}, ['worktree', 'prune', '--dry-run', '--verbose']],
    ['prune', {}, ['worktree', 'prune', '--verbose']],
    ['lock', { path: 'D:/w/x', reason: '演示' }, ['worktree', 'lock', '--reason', '演示', 'D:/w/x']],
    ['unlock', { path: 'D:/w/x' }, ['worktree', 'unlock', 'D:/w/x']],
    ['move', { path: 'D:/w/x', dest: 'D:/w/y' }, ['worktree', 'move', 'D:/w/x', 'D:/w/y']],
    ['sparse-list', { path: 'D:/w/x' }, ['sparse-checkout', 'list']],
    ['sparse-candidates', {}, ['ls-tree', '-d', '--name-only', 'HEAD']],
    ['sparse-rule-dir', {}, ['rev-parse', '--git-dir']],
    ['sparse-set', { dirs: ['src', 'docs'] }, ['sparse-checkout', 'set', '--cone', 'src', 'docs']],
  ]
  let argvBad = 0
  for (const a of ARGV) {
    const gotA = mod.worktreeArgsOf(a[0], a[1])
    const ok = JSON.stringify(gotA) === JSON.stringify(a[2]) && mod.worktreeForbiddenFlagIn(gotA) === ''
    if (!ok) argvBad += 1
    check(ok, '一·5 动作 ' + a[0] + ' 的 argv 逐字对：' + JSON.stringify(a[2]))
  }
  const forceLeaks = ['hostLeaf', 'page', 'ops'].filter(function (k: string): boolean { return FORCE_TOKEN_RE.test(codeOnly((SRC as any)[k])) })
  check(argvBad === 0 && forceLeaks.length === 0, '一·6 十六个 argv 一个都不带 --force / -f / -ff，宿主叶子与界面的代码里也没有这些开关的字面量（边界：不提供强删；漏在 ' + (forceLeaks.join('、') || '哪都没有') + '）')
  check(mod.worktreeCmdNameOf('remove') === 'git worktree remove' && mod.worktreeCmdNameOf('sparse-set') === 'git sparse-checkout' && mod.worktreeCmdNameOf('prune') === 'git worktree prune', '一·7 结果卡只显示 git 子命令名（remove / sparse-set / prune 三个都翻对）')

  // ---------- 二、判定：版本门、目标状态、危险动作与票据前置 ----------
  const av = (state: string, needed?: string, alternative?: string): any => ({ state: state, needed: needed || '', alternative: alternative || '' })
  const J_CASES: any[] = [
    ['九·1 旧版本 2.17 以下，9.4 删除被版本门挡下', 'remove', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', availability: av('hidden', '2.17', '终端删') }, 'block', 'version-too-old'],
    ['九·2 版本读不到（未知）按不知道拦，不冒充能用', 'add', { rows: ROWS, targetPath: 'D:/w/new', availability: null }, 'block', 'version-unknown'],
    ['九·3 2.31 以下锁标记读不到：锁定动作照常但带一条提醒', 'lock', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', availability: av('degraded'), reason: '演示' }, 'warn', 'version-unknown'],
    ['九·4 列表动作在版本可用时放行', 'list', { rows: ROWS, availability: av('full') }, 'allow', 'ok'],
    ['九·5 新建的路径已经被占了', 'add', { rows: ROWS, targetPath: 'D:/w/new', targetExists: true, availability: av('full') }, 'block', 'path-exists'],
    ['九·6 新建路径空', 'add', { rows: ROWS, targetPath: '', availability: av('full') }, 'block', 'path-blank'],
    ['九·7 用已有分支建但分支名空', 'add-branch', { rows: ROWS, targetPath: 'D:/w/new', branch: '', availability: av('full') }, 'block', 'branch-blank'],
    ['九·8 用已有分支建但那个分支不存在', 'add-branch', { rows: ROWS, targetPath: 'D:/w/new', branch: 't/none', branchMissing: true, availability: av('full') }, 'block', 'branch-missing'],
    ['九·9 删当前这一棵被拒（边界：不改主工作树）', 'remove', { rows: ROWS, targetPath: 'D:/w/repo', availability: av('full') }, 'block', 'worktree-is-current'],
    ['九·10 删锁定的那一棵被拒（先解锁再删）', 'remove', { rows: ROWS, targetPath: 'D:/w/repo/.wt/locked', availability: av('full') }, 'block', 'worktree-locked'],
    ['九·11 删有未提交改动的那一棵：放行但提醒先贮藏', 'remove', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dirtyCount: 3, availability: av('full') }, 'warn', 'worktree-dirty'],
    ['九·12 清单里没有的目标路径', 'unlock', { rows: ROWS, targetPath: 'D:/w/typo', availability: av('full') }, 'block', 'worktree-not-listed'],
    ['九·13 待清理的登记一项都没有', 'prune', { rows: ROWS, prunableCount: 0, availability: av('full') }, 'block', 'nothing-to-prune'],
    ['九·14 清不掉是因为清单读不出来', 'prune', { rows: ROWS, prunableCount: -1, availability: av('full') }, 'block', 'worktree-not-listed'],
    ['九·15 有得清就放行', 'prune', { rows: ROWS, prunableCount: 2, availability: av('full') }, 'allow', 'ok'],
    ['九·16 锁一个已经锁着的树被拒', 'lock', { rows: ROWS, targetPath: 'D:/w/repo/.wt/locked', reason: '演示', availability: av('full') }, 'block', 'worktree-locked'],
    ['九·17 锁必须写原因', 'lock', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', reason: '', availability: av('full') }, 'block', 'reason-blank'],
    ['九·18 解锁一棵没锁的树被拒', 'unlock', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', availability: av('full') }, 'block', 'worktree-not-locked'],
    ['九·19 锁标记读不到时允许解锁（按未知状态处理）', 'unlock', { rows: ROWS.map(function (r: any): any { return r.path === 'D:/w/repo/.wt/a' ? rowOf({ lockUnknown: true }) : r }), targetPath: 'D:/w/repo/.wt/a', availability: av('full') }, 'allow', 'ok'],
    ['九·20 移动目的地空', 'move', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dest: '', availability: av('full') }, 'block', 'dest-blank'],
    ['九·21 移动目的地的写法非法', 'move', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dest: '-bad', availability: av('full') }, 'block', 'dest-bad'],
    ['九·22 移动目的地就是它自己', 'move', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dest: 'D:/w/repo/.wt/a/', availability: av('full') }, 'block', 'path-same'],
    ['九·23 移动目的地已经被占了', 'move', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dest: 'D:/w/occupied', destExists: true, availability: av('full') }, 'block', 'path-exists'],
    ['九·24 稀疏检出要勾目录，一个都没勾', 'sparse-set', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dirs: [], availability: av('full') }, 'block', 'dirs-blank'],
    ['九·25 勾了目录就放行', 'sparse-set', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', dirs: ['src'], availability: av('full') }, 'allow', 'ok'],
    ['九·26 稀疏规则读出来是只读动作，不确认', 'sparse-list', { rows: ROWS, targetPath: 'D:/w/repo/.wt/a', availability: av('full') }, 'allow', 'ok'],
    ['九·27 新建分支时分支名不合法（-b 分支也要过形状检查）', 'add', { rows: ROWS, targetPath: 'D:/w/new', branch: '-bad', availability: av('full') }, 'block', 'branch-bad'],
    ['九·28 新建分支时分支名合法，路径也空着就放行', 'add', { rows: ROWS, targetPath: 'D:/w/new', branch: 't/new', availability: av('full') }, 'allow', 'ok'],
  ]
  for (const c of J_CASES) {
    const d = mod.worktreeJudge(c[1], c[2])
    check(d.decision === c[3] && d.reasons[0] === c[4], c[0] + '（判定 ' + c[3] + '，首条理由 ' + c[4] + '）')
  }

  // ---------- 三、清单行 / 待清理 / 稀疏规则：界面与宿主共用的形状 ----------
  const rows = mod.worktreeRowsOf([ROWS[1], ROWS[2], ROWS[3]], ROWS[0])
  check(rows.length === 4 && rows[0].current === true && rows[1].path <= rows[2].path, '三·1 清单行当前这一棵排最前，其余按路径稳定排序（两次读数顺序一致）')
  check(rows[3].locked === true && rows[3].lockReason === '演示' && rows[3].lockUnknown === false, '三·2 锁着的行带原因；锁标记读不到时由 lockUnknown 单独标出，不冒充没锁')
  const prune = mod.worktreePruneEntriesOf(rows)
  check(prune.length === 1 && prune[0].path === 'D:/w/repo/.wt/gone', '三·3 待清理清单只留目录不在、非当前、非锁定的登记项（其余一项都不碰）')
  check(mod.worktreeSparseRulePathOf('D:/w/repo/.wt/a', 'D:/w/repo/.git/worktrees/a') === 'D:/w/repo/.git/worktrees/a/info/sparse-checkout', '三·4 稀疏检出的规则文件路径拼在 git 目录下（details 里能把「将更新哪个文件」说清）')
  check(mod.worktreeSparseRulePathOf('D:/w/repo/.wt/a', '../../.git') === 'D:/w/repo/.git/info/sparse-checkout', '三·4b --git-dir 给相对路径时先拼到目标工作树再折叠「..」（两种输出都指同一个文件）')
  check(JSON.stringify(mod.worktreeSparseCandidatesOf('src\ndocs\nsrc\n\n')) === JSON.stringify(['docs', 'src']), '三·5 稀疏目录候选去空行、去重、排序（读数稳定）')
  const digestA = mod.worktreeDigestOf(rows)
  const digestB = mod.worktreeDigestOf(rows.map(function (r: any): any { return r.path === 'D:/w/repo/.wt/a' ? rowOf({ locked: true }) : r }))
  check(digestA !== digestB && digestA.length > 0, '三·6 清单摘要随锁定状态变化（宿主凭它发现预检之后清单变了）')
  check(mod.worktreeSamePathOf('D:/w/x/', 'd:/w/x') === true && mod.worktreeSamePathOf('D:/w/x', 'D:/w/X') === false, '三·7 路径比较只归一盘符大小写与末尾斜杠，其余按原样比（免得把两棵不同的树认成一棵）')

  // ---------- 四、宿主电话：真进程只走 runPinned，票据与重验一个不少 ----------
  for (const name of ['phones', 'runArgs', 'noLongTask', 'pinnedOnly', 'ticketFlow']) check((J as any)[name](SRC), '四·' + name + ' 宿主与处理层的约定守住了（' + name + '）')
  check(SRC.hostLeaf.indexOf('createWorktreePhones') >= 0 && SRC.hostLeaf.indexOf('handleGitWorktreeCheck: handleGitWorktreeCheck') >= 0 && SRC.hostLeaf.indexOf('handleGitWorktreeRun: handleGitWorktreeRun') >= 0, '四·6 宿主叶子导出两条处理函数并原样装配返回（定义了却没装配出去也算缺）')
  check(SRC.host.indexOf('createWorktreesMount(') >= 0 && SRC.host.indexOf('versionControlWorktreesMount.js') >= 0, '四·7 父文件把两条电话的装配壳接进返回对象（父文件只留一行调用，实现搬去同层壳）')
  check(SRC.mount.indexOf("import('./versionControlWorktrees.js')") >= 0 && SRC.mount.indexOf('handleGitWorktreeCheck') >= 0 && SRC.mount.indexOf('handleGitWorktreeRun') >= 0 && SRC.mount.indexOf("'wf.gitWorktreeCheck'") >= 0 && SRC.mount.indexOf("'wf.gitWorktreeRun'") >= 0 && SRC.mount.indexOf('loggedPhone') >= 0, '四·7b 装配壳首次调用时才 import 叶子，两条电话都包上日志再交出去（载入失败回明确失败）')
  check(SRC.hostLeaf.indexOf('capabilityAvailability(cap,') >= 0, '四·8 宿主的版本门用共享层 capabilityAvailability 算，不自己写一份版本比较')

  // ---------- 四·9 / 四·10 票据的边界时刻与容量：真宿主叶子 + 假 git 现场 ----------
  // 为什么要加载宿主叶子：过期判据与容量上限写在 sweep 与执行电话里，只读源码文本看不出「恰好到期算不算过期」。
  // 这里的现场全来自假 route、时间全来自 clock，所以边界时刻能精确到毫秒；同一份清单读两次摘要不变，重验才放行。
  const wtLeaf: any = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControlWorktrees.ts')).href)
  const T0 = 1800000000000
  const clock: any = { t: T0 }
  let seq = 0
  const OID_A = 'a'.repeat(40)
  const OID_B = 'b'.repeat(40)
  const WT_LISTING = 'worktree D:/w/repo\u0000HEAD ' + OID_A + '\u0000branch refs/heads/main\u0000\u0000worktree D:/w/repo/.wt/a\u0000HEAD ' + OID_B + '\u0000branch refs/heads/t/a\u0000\u0000'
  const mkDeps = (): any => ({
    resolveGitExecutable: async (): Promise<any> => 'git',
    resolveRepoRoot: async (): Promise<any> => ({ ok: true, root: 'D:/w/repo', gitDir: 'D:/w/repo/.git' }),
    runPinned: async (exe: any, dir: any, argv: any, opts?: any): Promise<any> => {
      if (argv[0] === '--version') return { kind: 'ok', stdout: 'git version 2.30.0\n' }
      if (argv[0] === 'worktree' && argv[1] === 'list') return { kind: 'ok', stdout: WT_LISTING }
      return { kind: 'ok', stdout: '' }
    },
    failPhone: (kind: any, message: any, extra?: any): any => Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {}),
    firstLine: (s: any): string => String(s === undefined || s === null ? '' : s).split(/\r?\n/)[0],
    failureFromExec: (res: any, what: any): any => (res && res.kind === 'ok') ? null : { ok: false, error: { kind: 'git-failed', message: String(what) } },
    cwdOf: (a: any): string => 'D:/w/repo',
    pathExists: async (): Promise<boolean> => false,
    nowMs: (): number => clock.t,
    randomId: (): string => 'r' + (++seq),
  })
  const mintWt = async (phones: any, p: string): Promise<any> => phones.handleGitWorktreeCheck({ op: 'add', path: p })
  const runWt = async (phones: any, ticketId: string, requestId: string, p: string): Promise<any> => phones.handleGitWorktreeRun({ op: 'add', ticketId: ticketId, requestId: requestId, path: p, confirm: true })

  const phonesA: any = wtLeaf.createWorktreePhones(mkDeps())
  clock.t = T0
  const mintEarly: any = await mintWt(phonesA, 'D:/w/repo/.wt/fresh')
  check(mintEarly.ok === true && !!mintEarly.ticket && mintEarly.ticket.expiresAtMs === T0 + 120000, '四·9 预检签出的票据有效期是 120000 毫秒（下面两条毫秒边界的前提）')
  clock.t = T0 + 119999
  const early: any = await runWt(phonesA, mintEarly.ticket.id, 'req-early', 'D:/w/repo/.wt/fresh')
  check(early.ok === true, '四·9a 还差 1 毫秒到期时票据仍有效，动作照常执行')
  clock.t = T0
  const mintLate: any = await mintWt(phonesA, 'D:/w/repo/.wt/late')
  clock.t = T0 + 120000
  const late: any = await runWt(phonesA, mintLate.ticket.id, 'req-late', 'D:/w/repo/.wt/late')
  // 恰好到期的这一刻，票据必须已经不在表里：sweep 在查找之前按「now < expiresAtMs 才算有效」清掉它，
  // 所以理由是 ticket-missing。旧写法 expiresAtMs < t 会把它留到下一毫秒，放行这次执行（那时会回 ok:true）。
  check(late.ok === false && late.error.kind === 'ticket-missing', '四·9b 恰好到期的那一刻票据已经作废，凭它执行被拒（旧写法在这一毫秒还会放行）')

  clock.t = T0
  const phonesB: any = wtLeaf.createWorktreePhones(mkDeps())
  const capIds: string[] = []
  for (let i = 0; i < 201; i += 1) {
    const m: any = await mintWt(phonesB, 'D:/w/repo/.wt/new-' + i)
    if (m.ok === true && m.ticket) capIds.push(m.ticket.id)
  }
  check(capIds.length === 201, '四·10 连续预检 201 次都拿到票据（容量上界断言的前提）')
  const oldest: any = await runWt(phonesB, capIds[0], 'req-new-0', 'D:/w/repo/.wt/new-0')
  check(oldest.ok === false && oldest.error.kind === 'ticket-missing', '四·10a 票据表只留 200 张：第 201 张签出后最旧的一张已被淘汰，凭它执行被拒')
  const second: any = await runWt(phonesB, capIds[1], 'req-new-1', 'D:/w/repo/.wt/new-1')
  const mid: any = await runWt(phonesB, capIds[100], 'req-new-100', 'D:/w/repo/.wt/new-100')
  check(second.ok === true && mid.ok === true, '四·10b 第 2 张与第 101 张仍在表里、照常执行（容量若退回 64，这两张早被淘汰）')

  // ---------- 五、界面三层：数据层 / 处理层 / 页面体 ----------
  for (const name of ['entries', 'rowActions', 'phones', 'runArgs', 'noLongTask', 'sameSlice', 'oneJudge', 'dataNoPhone', 'confirmCard', 'versionHint', 'noPrimary', 'forms', 'oldPlanGone', 'autoRun', 'resultOrder']) check((J as any)[name](SRC), '五·' + name + ' 界面三层的约定守住了（' + name + '）')
  check(SRC.ops.indexOf("'idle', 'checking', 'plan', 'confirm', 'blocked', 'running', 'done', 'failed'") >= 0, '五·12 处理层的八个状态齐全（预检 / 计划 / 确认 / 拦下 / 执行 / 完成 / 失败各有落点）')
  check(SRC.ops.indexOf('vcWorktreesActionDecisionOf(model, opName, input)') >= 0, '五·13 发电话之前先按首屏模型判一次（同一判定在界面先拦，不靠宿主兜底）')
  check(SRC.ops.indexOf('vcReadFirstScreenOnManual') >= 0, '五·14 动作完成后用首屏的手动刷新时机重读同一份片（不另发一条清单电话）')
  check(SRC.ops.indexOf("kind: 'git-worktree'") >= 0 && SRC.ops.indexOf('host.call.fail') >= 0, '五·15 两条电话的成败都记在既有的 host.call / host.call.fail 上（多一个 git-worktree 种类区分来源）')
  check(SRC.formView.indexOf('data-wt-create-path') >= 0 && SRC.formView.indexOf('data-wt-create-branch-input') >= 0 && SRC.formView.indexOf('data-wt-move-input') >= 0 && SRC.formView.indexOf("name: 'dirs'") < 0, '五·16 新建表单给了目录与分支两栏、移动表单给了新目录输入框（稀疏目录仍用勾选，不手填）')
  check(SRC.formView.indexOf('data-wt-sparse-dir') >= 0 && SRC.formView.indexOf('data-wt-sparse-form') >= 0 && SRC.rows.indexOf("'data-wt-sparse-current': path") >= 0, '五·17 稀疏检出在展开行里列出候选目录，保存后常驻「当前规则」一句（不让人盲写）')
  check(SRC.formView.indexOf("'data-wt-create-error': '1'") >= 0 && SRC.formView.indexOf('wt-form-error') >= 0 && SRC.formView.indexOf('vc.wt.result.tag') >= 0, '五·20 新建表单的错误画在自己的 wt-form-error 里，结果条另有一条来源标记（错误不跳到页底）')
  check(SRC.rows.indexOf("op: 'move-open'") >= 0 && SRC.rows.indexOf("op: 'sparse-open'") >= 0 && SRC.rows.indexOf('vc.wt.action.sparse-list') >= 0, '五·21 移动与稀疏检出各有一颗行内入口，按钮位置在动作行里（原型 95 / 96）')
  check(SRC.page.indexOf('dirtyCount') >= 0 && SRC.page.indexOf('vc.wt.plan.stashPath') >= 0, '五·18 删脏工作树前把「先贮藏再移除」的路径讲清楚（不传 --force）')
  check(SRC.page.indexOf("'data-vc-wt-page': '1'") >= 0 && SRC.page.indexOf('data-vc-wt-mode') >= 0 && SRC.page.indexOf('data-vc-wt-state') >= 0, '五·19 页面根节点带页面 / 模式 / 整体状态三个标记（四态与禁用原因都有落点）')

  // ---------- 六、挂载点、构建登记与词表 ----------
  for (const name of ['shellMount', 'buildReg', 'entryReg', 'words']) check((J as any)[name](SRC), '六·' + name + ' 登记与词表守住了（' + name + '）')
  const LOCW = loc.L_VCWORKTREES
  const need: string[] = REASONS.map(function (r: string): string { return 'vc.wt.why.' + r })
  const missZh = need.filter(function (k: string): boolean { return !LOCW.zh[k] || String(LOCW.zh[k]).length === 0 })
  const missEn = need.filter(function (k: string): boolean { return !LOCW.en[k] || String(LOCW.en[k]).length === 0 })
  check(missZh.length === 0 && missEn.length === 0, '六·5 真字典里 ' + need.length + ' 条判定理由中英都有非空说法（' + (missZh.concat(missEn).join('、') || '一条不缺') + '）')
  const altKeys: string[] = ['9.4', '9.5', '9.6', '9.7', '9.8'].map(function (c: string): string { return 'vc.wt.alt.' + c })
  check(altKeys.every(function (k: string): boolean { return LOCW.zh[k] && LOCW.en[k] }), '六·6 五条被版本门管住的能力，中英都写明「这个版本以下怎么办」的替代做法')
  const actionKeys: string[] = ['list', 'add', 'add-branch', 'remove', 'prune', 'lock', 'unlock', 'move', 'sparse-list', 'sparse-set'].map(function (a: string): string { return 'vc.wt.action.' + a })
  check(actionKeys.every(function (k: string): boolean { return LOCW.zh[k] && LOCW.en[k] }), '六·7 十个动作的中英说法都有（确认卡与结果卡按动作名说人话）')
  const formKeys: string[] = ['vc.wt.create.emptyPath', 'vc.wt.create.emptyBranch', 'vc.wt.create.noBranch', 'vc.wt.create.taken',
    'vc.wt.move.empty', 'vc.wt.move.taken', 'vc.wt.move.same', 'vc.wt.sparse.empty', 'vc.wt.sparse.current',
    'vc.wt.result.created', 'vc.wt.result.moved', 'vc.wt.result.sparseSaved', 'vc.wt.result.sparseAll', 'vc.wt.result.tag']
  check(formKeys.every(function (k: string): boolean { return LOCW.zh[k] && LOCW.en[k] }), '六·8 三张表单的三种错误与四类结果说法中英都有（错误留下来才改得动，结果条才说得清）')
  const placeholderKeys: string[] = ['vc.wt.create.failed', 'vc.wt.move.empty', 'vc.wt.result.created', 'vc.wt.result.createdNewDetail',
    'vc.wt.result.moved', 'vc.wt.result.movedDetail', 'vc.wt.result.sparseSaved', 'vc.wt.sparse.current', 'vc.wt.sparse.keep']
  const placeholdersOf = function (text: string): string[] {
    const out: string[] = []
    const reg = /\{(\w+)\}/g
    let m: any = reg.exec(text)
    while (m) { out.push(String(m[1])); m = reg.exec(text) }
    return out.join(',')
  }
  check(placeholderKeys.every(function (k: string): boolean { return placeholdersOf(String(LOCW.zh[k] || '')) === placeholdersOf(String(LOCW.en[k] || '')) }), '六·9 表单与结果词条的中英占位符一字不差（少一个占位符，切到英文就会把原文里的花括号印出来）')

  // ---------- 七、反证：把每一组的一处故意改坏，对应判据必须当场变红 ----------
  const ANTI: any[] = [
    ['页面删掉 9.7 移动的入口', 'page', function (t: string): string { return t.replace("  { capId: '9.7', op: 'move', row: true },\n", '') }, 'entries'],
    ['页面偷偷挂一枚 data-cap-primary（主入口标记不许抢）', 'page', function (t: string): string { return t + '\nconst vcWtStolenPrimary = "data-cap-primary"\n' }, 'noPrimary'],
    ['页面又把旧能力入口清单画回来（同一件事两条路）', 'page', function (t: string): string { return t + '\nconst vcWtEntriesNode = 1\n' }, 'oldPlanGone'],
    ['视图把新建表单的标记改名（三张表单少一张）', 'formView', function (t: string): string { return t.replace("'data-wt-create-form': '1'", "'data-wt-create-form': '0'") }, 'forms'],
    ['表单处理层把新建分支的自动执行关掉（又回去等确认卡）', 'formOps', function (t: string): string { return t.split('auto: true').join('auto: false') }, 'autoRun'],
    ['执行电话改名成 wf.gitTaskStart（落回长任务通道）', 'ops', function (t: string): string { return t.replace("run: 'wf.gitWorktreeRun'", "run: 'wf.gitTaskStart'") }, 'phones'],
    ['执行时不带显式确认', 'ops', function (t: string): string { return t.replace('confirm: true,', 'confirm: false,') }, 'runArgs'],
    ['数据层不再读 worktrees 片（另起一份清单）', 'data', function (t: string): string { return t.replace("vcFirstScreenSliceOf(reads, 'worktrees')", "vcFirstScreenSliceOf(reads, 'otherWorktrees')") }, 'sameSlice'],
    ['数据层不再调共享判定（界面自己判）', 'data', function (t: string): string { return t.replace('worktreeJudge(op, ctx)', 'vcOwnJudge(op, ctx)') }, 'oneJudge'],
    ['页面不再借壳的四段确认卡（自己拼一句「确定吗」）', 'page', function (t: string): string { return t.split('vcShellConfirmCardNode').join('vcOwnConfirm') }, 'confirmCard'],
    ['宿主叶子自己起进程（绕过 runPinned）', 'hostLeaf', function (t: string): string { return t.split('runPinned(').join('spawnGit(') }, 'pinnedOnly'],
    ['宿主不再区分「预检之后清单变了」', 'hostLeaf', function (t: string): string { return t.split("'worktrees-changed'").join("'changed'") }, 'ticketFlow'],
    ['页面壳删掉工作树页的挂载段', 'shell', function (t: string): string { return t.split("page === 'worktrees'").join("page === 'never'") }, 'shellMount'],
    ['构建登记里删掉动作层那一叶', 'build', function (t: string): string { return t.replace("shared:vcWorktreeOps (spliced by build)", 'shared:vcNoWorktrees (spliced by build)') }, 'buildReg'],
    ['词表中文段删掉一条判定理由', 'yaml', function (t: string): string { return t.replace('\n  vc.wt.why.ok:', '\n  vc.wt.why.removed:') }, 'words'],
  ]
  for (const a of ANTI) {
    const before = SRC[a[1]]
    const after = a[2](before)
    const applied = after !== before
    const broke = applied && (J as any)[a[3]](Object.assign({}, SRC, { [a[1]]: after })) === false
    check(applied, '七·自证 ' + a[0] + '：这一处改法真的改到了源码（改不中就等于没证）')
    check(broke, '七·反证 ' + a[0] + '：改坏之后「' + a[3] + '」那条判据当场变红')
  }

  console.log('')
  if (failed) console.log('存在失败 — ' + GATE + ' 未通过')
  else console.log('全部通过 — 工作树页八条能力入口、真实动作、危险确认、版本门与一份数据都钉住了（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any): void { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
