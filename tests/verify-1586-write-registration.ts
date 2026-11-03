// 门禁归属: src/host/versionControlWrite.ts
// verify-1586-write-registration.ts —— 写命令七个登记点门禁（规格 #1586 之 T06 #1741）。
//
// 守的东西：一条写命令要真的能用，光有处理逻辑不够，还必须在多个地方同时登记上。
// 老流程（暂存 / 提交 / 拉取 / 推送 / 抓取）的登记点固定七处：
//   ① 操作枚举（共享核心的 WriteOp / Operation 联合类型）
//   ② 判定分支（rules.judge 的 switch，漏了会永远落到 unknown-operation）
//   ③ 检查白名单（预检只放行登记过的动作）
//   ④ 写处理函数（执行层真的有这个函数，并且被装配返回出去）
//   ⑤ 宿主注册（harness.handle 的 'wf.gitXxx' 电话名）
//   ⑥ 电话表（界面层 op 名 → 电话名的对照表）
//   ⑦ 超时配置（中央 YAML 里这条命令的单条超时，以及执行层真的引用了它）
//
// 27 票新增的写动作族换了形状：一族一套预检 / 执行电话，动作表与白名单搬到共享层，
// 所以逐族断言四件事（口径见票 #1741 的评审意见）：
//   · 预检电话与执行电话都在 src/host/index.ts 注册；
//   · 白名单 / 理由表在预检源码里真的被引用，且共享动作表里登记着这一族的动作；
//   · 这一族的超时配置能在 config/timeouts.yaml 里找到；
//   · 客户端调用点写的就是这几个电话名（不是旧名、不是拼出来的名字）。
// 族清单按源码里实际存在的写动作取，不硬凑：只有读电话的族不进表；一条电话服务多个族的，
// 由对应族各自认领它自己那一处调用点。
//
// 反证至少四条（删一行宿主注册 / 改一个客户端电话名 / 少一个超时键 / 改一处白名单），
// 每条只改一份副本、只期望一条缺，改完的副本跑同一个判据必须报红——判据太松时这几条会先红。
// 电话总数不写死：从宿主源码数出实际条数，再核对它覆盖了本表登记的电话；总数登记在
// tests/verify-settings-phones.ts 的 E9（nPhones === 119：2026-11-03 撤掉 #1806 的四条工作区电话后回到 119；
// #1776 M4b 给远端族补的预检电话算在里面）。
// 本文件是 CommonJS：判据工具用 require 取 .ts 需要钩子，跑法见文件末尾注释。
const fs = require('fs')
const path = require('path')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-write-registration'
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

const cache = new Map()
function read(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  return cache.get(rel)
}
const shortName = (rel) => rel.split('/').pop()

/** 老流程的七个登记点：这一片只读源码文本，按「登记点 × 期望记号」逐项查在不在。 */
const SOURCES = {
  ports: read('src/shared/version-control/src/ports.ts'),
  rules: read('src/shared/version-control/src/rules.ts'),
  check: read('src/host/versionControlCheck.ts'),
  write: read('src/host/versionControlWrite.ts'),
  hostIndex: read('src/host/index.ts'),
  clientPhones: read('src/client/views/versionControl/vcWriteRun.ts'),
  yaml: read('config/timeouts.yaml'),
}
const POINTS = [
  { point: '① 操作枚举', file: 'ports', tokens: ["export type WriteOp = 'commit' | 'pull' | 'push' | 'fetch'"] },
  { point: '② 判定分支', file: 'rules', tokens: ["case 'stage':", "case 'commit':", "case 'pull':", "case 'push':", "case 'fetch':", "'unknown-operation'"] },
  { point: '③ 检查白名单', file: 'check', tokens: ["op !== 'commit'", "op !== 'pull'", "op !== 'push'", "op !== 'fetch'"] },
  { point: '④ 写处理函数', file: 'write', tokens: ['handleGitStage: handleGitStage', 'handleGitUnstage: handleGitUnstage', 'handleGitCommit: handleGitCommit', 'handleGitPull: handleGitPull', 'handleGitFetch: handleGitFetch', 'handleGitPush: handleGitPush'] },
  { point: '⑤ 宿主注册', file: 'hostIndex', tokens: ["harness.handle('wf.gitWriteCheck'", "harness.handle('wf.gitStage'", "harness.handle('wf.gitUnstage'", "harness.handle('wf.gitCommit'", "harness.handle('wf.gitPull'", "harness.handle('wf.gitFetch'", "harness.handle('wf.gitPush'"] },
  { point: '⑥ 电话表', file: 'clientPhones', tokens: ["check: 'wf.gitWriteCheck'", "stage: 'wf.gitStage'", "unstage: 'wf.gitUnstage'", "commit: 'wf.gitCommit'", "pull: 'wf.gitPull'", "fetch: 'wf.gitFetch'", "push: 'wf.gitPush'"] },
  { point: '⑦ 超时配置', file: 'yaml', tokens: ['vcRunTimeoutMs:', 'vcCheckCallBudgetMs:', 'vcAddTimeoutMs:', 'vcCommitTimeoutMs:', 'vcPullTimeoutMs:', 'vcPushTimeoutMs:', 'vcFetchTimeoutMs:'] },
  { point: '⑦ 超时接线', file: 'write', tokens: ['ADD_TIMEOUT_MS', 'COMMIT_TIMEOUT_MS', 'PULL_TIMEOUT_MS', 'PUSH_TIMEOUT_MS', 'FETCH_TIMEOUT_MS'] },
]

/**
 * 27 票新增写动作族。每族字段：
 *   name     族名（与人看的页面名一致）
 *   check    预检电话；没有预检的族写 null（远端写动作由各自处理函数直接校验）
 *   exec     执行电话（凭票执行 / 长任务入口）
 *   guard    [预检源码, 白名单或理由表记号]：记号取「少了它这一族就会收下未知动作」的那一句
 *   ops      [共享动作表源码, 表名, 代表动作]：共享层必须还登记着这些动作
 *   timeouts YAML 里的超时键（只断言键存在；整趟预算与单条超时的算法在各族自己的门禁里）
 *   clients  [客户端源码, 该文件里必须出现的电话名]
 * 电话名一律用源码里的字面量（含引号），防止「拼字符串拼出旧名」也能蒙混过关。
 */
const FAMILIES = [
  {
    name: '提交页',
    check: 'wf.gitWriteCheck',
    exec: ['wf.gitCommit'],
    guard: ['src/host/versionControlCheck.ts', "op !== 'commit'"],
    ops: ['src/shared/version-control/src/rules.ts', "case 'commit':", ["case 'pull':"]],
    timeouts: ['vcCommitTimeoutMs', 'vcAddTimeoutMs'],
    clients: [['src/client/views/versionControl/vcCommitOps.ts', ['wf.gitCommitForm', 'wf.gitWriteCheck', 'wf.gitCommit']]],
  },
  {
    name: '改动页',
    check: 'wf.gitChangesCheck',
    exec: ['wf.gitChangesWrite'],
    guard: ['src/host/versionControlChangesCheck.ts', 'changesOpMetaOf(op)'],
    ops: ['src/shared/version-control/src/changes-protocol.ts', 'export const CHANGES_WRITE_OPS', ["'stage-file'", "'discard-all'"]],
    timeouts: ['vcChangesReadTimeoutMs', 'vcChangesWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcChangesPage.ts', ['wf.gitChangesCheck', 'wf.gitChangesWrite']]],
  },
  {
    name: '分支与标签',
    check: 'wf.gitBranchCheck',
    exec: ['wf.gitBranchWrite'],
    guard: ['src/host/versionControlBranchCheck.ts', 'branchPlanOf(String(a.op'],
    ops: ['src/shared/version-control/src/branch-ticket.ts', 'export const BRANCH_TICKET_OPS', ["'switch'", "'tag-create'"]],
    timeouts: ['vcBranchReadTimeoutMs', 'vcBranchWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcBranches.ts', ['wf.gitBranches', 'wf.gitBranchCheck', 'wf.gitBranchWrite']]],
  },
  {
    name: '工作树',
    check: 'wf.gitWorktreeCheck',
    exec: ['wf.gitWorktreeRun'],
    guard: ['src/host/versionControlWorktrees.ts', "if (!action) return fail('bad-op'"],
    ops: ['src/shared/version-control/src/worktree-ops.ts', 'export const WORKTREE_ACTIONS', ["'add'", "'remove'"]],
    timeouts: ['vcWorktreeOpTimeoutMs'],
    clients: [['src/client/views/versionControl/vcWorktreesOps.ts', ['wf.gitWorktreeCheck', 'wf.gitWorktreeRun']]],
  },
  {
    name: '贮藏',
    check: 'wf.gitStashCheck',
    exec: ['wf.gitStash'],
    guard: ['src/host/versionControlStash.ts', 'stashOpOf(op)'],
    ops: ['src/shared/version-control/src/stash-rules.ts', 'export const STASH_OPS', ["'push'", "'drop'"]],
    timeouts: ['vcRunTimeoutMs'],
    clients: [['src/client/views/versionControl/vcStashOps.ts', ['wf.gitStash']]],
  },
  {
    name: '同步',
    check: 'wf.gitSyncCheck',
    exec: ['wf.gitSyncWrite'],
    guard: ['src/host/versionControlSyncCheck.ts', 'syncActionOf(a.action)'],
    ops: ['src/shared/version-control/src/sync-actions.ts', 'export const SYNC_ACTIONS', ["'pull-rebase'", "'force-push'"]],
    timeouts: ['vcBranchReadTimeoutMs', 'vcPullTimeoutMs', 'vcPushTimeoutMs'],
    clients: [['src/client/views/versionControl/vcSyncData.ts', ['wf.gitSyncCheck', 'wf.gitSyncWrite']]],
  },
  {
    name: '冲突',
    check: 'wf.gitConflictCheck',
    exec: ['wf.gitConflictWrite'],
    guard: ['src/host/versionControlConflictCheck.ts', 'conflictOpMetaOf(op)'],
    ops: ['src/shared/version-control/src/conflict-ops.ts', 'export const CONFLICT_WRITE_OPS', ["'merge'", "'take-side'"]],
    timeouts: ['vcConflictReadTimeoutMs', 'vcConflictWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcConflictsOps.ts', ['wf.gitConflicts', 'wf.gitConflictCheck', 'wf.gitConflictWrite']]],
  },
  {
    name: '撤销',
    check: 'wf.gitUndoCheck',
    exec: ['wf.gitUndoWrite'],
    guard: ['src/host/versionControlUndoCheck.ts', 'undoOpOf(op)'],
    ops: ['src/shared/version-control/src/undo-ops.ts', 'export const UNDO_OPS', ["'reset-hard'", "'cherry-pick'"]],
    timeouts: ['vcUndoReadTimeoutMs', 'vcUndoWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcUndoOps.ts', ['wf.gitUndoCheck', 'wf.gitUndoWrite']]],
  },
  {
    name: '变基',
    check: 'wf.gitRebaseCheck',
    exec: ['wf.gitRebaseWrite'],
    guard: ['src/host/versionControlRebaseCheck.ts', 'rebaseOpMetaOf(op)'],
    ops: ['src/shared/version-control/src/rebase-ops.ts', 'export const REBASE_WRITE_OPS', ["'rebase-todo'", "'rebase-onto'"]],
    timeouts: ['vcRebaseReadTimeoutMs', 'vcRebaseWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcRebaseOps.ts', ['wf.gitRebaseRead', 'wf.gitRebaseCheck', 'wf.gitRebaseWrite']]],
  },
  {
    name: '全库重写',
    check: 'wf.gitRewriteCheck',
    exec: ['wf.gitRewriteRun'],
    guard: ['src/host/versionControlRewriteCheck.ts', 'rewriteFormProblem(plan.form, plan)'],
    ops: ['src/shared/version-control/src/rewrite-ops.ts', 'export const REWRITE_FORMS', ["'remove-paths'", "'replace-text'"]],
    timeouts: ['vcRewriteReadTimeoutMs', 'vcRewriteWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcRewriteOps.ts', ['wf.gitRewritePreview', 'wf.gitRewriteCheck', 'wf.gitRewriteRun']]],
  },
  {
    name: '维护',
    check: 'wf.gitMaintenanceCheck',
    exec: ['wf.gitMaintenanceWrite'],
    guard: ['src/host/versionControlMaintenanceCheck.ts', 'maintenanceWriteOpOf(op)'],
    ops: ['src/shared/version-control/src/maintenance-ops.ts', 'export const MAINTENANCE_OPS', ["'prune'", "'gc'"]],
    timeouts: ['vcMaintenanceReadTimeoutMs', 'vcMaintenanceWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcMaintenanceData.ts', ['wf.gitMaintenanceRead', 'wf.gitMaintenanceCheck', 'wf.gitMaintenanceWrite']]],
  },
  {
    name: '子模块',
    check: 'wf.gitSubmoduleCheck',
    exec: ['wf.gitSubmoduleWrite', 'wf.gitSubmoduleTask'],
    guard: ['src/host/versionControlSubmodulesCheck.ts', "if (!menu) return fail('invalid', 'unknown-action'"],
    ops: ['src/shared/version-control/src/submodule-ops.ts', 'export const SUBMODULE_WRITE_OPS', ["'set-url'", "'deinit'"]],
    timeouts: ['vcSubmoduleReadTimeoutMs', 'vcSubmoduleWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcSubmodulesData.ts', ['wf.gitSubmodules', 'wf.gitSubmoduleCheck', 'wf.gitSubmoduleWrite', 'wf.gitSubmoduleTask']]],
  },
  {
    name: '克隆向导',
    check: 'wf.gitCloneCheck',
    exec: ['wf.gitCloneWrite'],
    guard: ['src/host/versionControlClone.ts', "['start', 'cleanup'].indexOf(op)"],
    timeouts: ['vcCloneReadTimeoutMs', 'vcCloneWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcClonePage.ts', ['wf.gitCloneCheck', 'wf.gitCloneWrite']]],
  },
  {
    name: '迁移与备份',
    check: 'wf.gitMigrateCheck',
    exec: ['wf.gitMigrateWrite'],
    guard: ['src/host/versionControlMigrateCheck.ts', 'migrateActionOf(args && args.action)'],
    ops: ['src/shared/version-control/src/migrate-actions.ts', 'export const MIGRATE_ACTIONS', ["'bundle-create'", "'fast-import'"]],
    timeouts: ['vcBranchReadTimeoutMs', 'vcRunTimeoutMs'],
    clients: [['src/client/views/versionControl/vcMigrateData.ts', ['wf.gitMigrateCheck', 'wf.gitMigrateWrite']]],
  },
  {
    name: '配置与钩子',
    check: 'wf.gitConfigCheck',
    exec: ['wf.gitConfigWrite'],
    guard: ['src/host/versionControlConfig.ts', 'CONFIG_WRITE_OPS.indexOf(op)'],
    ops: ['src/shared/version-control/src/config-rules.ts', 'export const CONFIG_WRITE_OPS', ["'config-set'", "'hook-run'"]],
    timeouts: ['vcConfigReadTimeoutMs', 'vcConfigWriteTimeoutMs', 'vcHookRunTimeoutMs'],
    clients: [['src/client/views/versionControl/vcConfigOps.ts', ['wf.gitConfigRead', 'wf.gitConfigCheck', 'wf.gitConfigWrite']]],
  },
  {
    name: '诊断',
    check: 'wf.gitDiagnosticsCheck',
    exec: ['wf.gitDiagnosticsWrite'],
    guard: ['src/host/versionControlDiagnosticsCheck.ts', 'diagnosticsWritePlanOf(op, a)'],
    ops: ['src/shared/version-control/src/diagnostics-commands.ts', 'export const DIAGNOSTICS_WRITE_OPS', ["'bisect-start'", "'replace-create'"]],
    timeouts: ['vcDiagnosticsReadTimeoutMs', 'vcDiagnosticsWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcDiagnostics.ts', ['wf.gitDiagnosticsRead', 'wf.gitDiagnosticsCheck', 'wf.gitDiagnosticsWrite']]],
  },
  {
    name: '远端',
    check: 'wf.gitRemoteCheck',
    exec: ['wf.gitRemoteAdd', 'wf.gitRemoteRename', 'wf.gitRemoteRemove', 'wf.gitRemoteSetUrl', 'wf.gitRemoteOnline'],
    guard: ['src/host/versionControlRemoteCheck.ts', 'remoteWriteActionOf('],
    ops: ['src/shared/version-control/src/remote.ts', 'export const REMOTE_WRITE_ACTIONS', ["'add'", "'rename'"]],
    timeouts: ['vcRemoteTimeoutMs', 'vcRemoteOnlineTimeoutMs', 'vcRemoteWriteTimeoutMs'],
    clients: [['src/client/views/versionControl/vcRemoteData.ts', ['wf.gitRemoteList', 'wf.gitRemoteCheck', 'wf.gitRemoteAdd', 'wf.gitRemoteRename', 'wf.gitRemoteRemove', 'wf.gitRemoteSetUrl', 'wf.gitRemoteOnline']]],
  },
  {
    name: '平台段',
    check: 'wf.gitPlatformCheck',
    exec: ['wf.gitPlatformRun', 'wf.gitRequestPull', 'wf.gitPatchFiles'],
    guard: ['src/host/versionControlPlatform.ts', 'taskArgsFor(VC_PLATFORM_PATCH_OP'],
    timeouts: ['vcRunTimeoutMs'],
    clients: [
      ['src/client/views/versionControl/vcMigrateExport.ts', ['wf.gitPlatformCheck', 'wf.gitPlatformRun']],
      ['src/client/views/versionControl/vcPlatformData.ts', ['wf.gitPlatformRead', 'wf.gitRequestPull', 'wf.gitPatchFiles']],
    ],
  },
]

/**
 * 判据本体：给一族源码，回每一小项的对错与说明。
 * over 只在反证里用：它带着「被改坏的那一份副本」，其余文件照常从磁盘读，
 * 这样反证与正式判据跑的是同一段逻辑，不会出现「反证过了、真判据另有一套」。
 */
function familyAssertions(f, over) {
  const text = function (rel) { return over && typeof over[rel] === 'string' ? over[rel] : read(rel) }
  const out = []
  const host = text('src/host/index.ts')
  const reg = (p) => host.indexOf("harness.handle('" + p + "'") >= 0
  if (f.check) out.push([reg(f.check), '预检电话在宿主注册：' + f.check])
  for (const p of f.exec) out.push([reg(p), '执行电话在宿主注册：' + p])
  const guardText = text(f.guard[0])
  out.push([guardText.indexOf(f.guard[1]) >= 0, '白名单/理由表有登记：' + shortName(f.guard[0]) + ' ← ' + f.guard[1]])
  if (f.ops) {
    const opsText = text(f.ops[0])
    out.push([opsText.indexOf(f.ops[1]) >= 0, '共享动作表有登记：' + shortName(f.ops[0]) + ' ← ' + f.ops[1]])
    for (const one of f.ops[2]) out.push([opsText.indexOf(one) >= 0, '共享动作表登记着动作：' + one])
  }
  const yaml = text('config/timeouts.yaml')
  for (const k of f.timeouts) out.push([yaml.indexOf(k + ':') >= 0, '超时配置在 YAML：' + k])
  for (const pair of f.clients) for (const p of pair[1]) out.push([text(pair[0]).indexOf("'" + p + "'") >= 0, '客户端用对电话：' + shortName(pair[0]) + ' → ' + p])
  return out
}

/** 从宿主源码数出注册了多少条 wf.git* 电话：计数来自源码，不写死数字。 */
function registeredPhoneCount(host) {
  const found = host.match(/harness\.handle\('(wf\.git[A-Za-z]+)'/g) || []
  return new Set(found).size
}

console.log('旧流程：七个登记点逐项查在不在')
for (const p of POINTS) for (const token of p.tokens) check(SOURCES[p.file].indexOf(token) >= 0, p.point + ' 登记在 ' + p.file + '：' + token)

console.log('')
console.log('27 票新增写动作族：逐族查预检电话 / 执行电话 / 白名单 / 超时 / 客户端调用点')
for (const f of FAMILIES) {
  for (const [ok, label] of familyAssertions(f)) check(ok, f.name + '：' + label)
}

// 电话总数：从源码数，不与本表登记数脱节；E9 那扇门禁钉 119 条（#1776 M4b 加了远端预检 wf.gitRemoteCheck；
// #1806 的四条工作区电话 2026-11-03 已随身份记录机制撤掉）。
const hostPhones = registeredPhoneCount(SOURCES.hostIndex)
const listedPhones = new Set()
for (const f of FAMILIES) { if (f.check) listedPhones.add(f.check); for (const p of f.exec) listedPhones.add(p) }
for (const p of ['wf.gitWriteCheck', 'wf.gitStage', 'wf.gitUnstage', 'wf.gitCommit', 'wf.gitPull', 'wf.gitFetch', 'wf.gitPush']) listedPhones.add(p)
check(hostPhones >= listedPhones.size, '宿主注册的 wf.git* 电话从源码数出 ' + hostPhones + ' 条，覆盖本门禁登记的 ' + listedPhones.size + ' 条')
check(read('tests/verify-settings-phones.ts').indexOf('nPhones === 119') >= 0, 'E9 宿主电话总数仍由 tests/verify-settings-phones.ts 钉在 119 条（#1776 M4b 的远端预检电话算进去了；#1806 的四条工作区电话 2026-11-03 已撤，几处一起改）')

console.log('')
console.log('反证：各改一份副本的一处，同一判据必须只报出那一处缺')
const proof = function (label, rel, from, to, familyName, expectText) {
  const mutated = {}
  mutated[rel] = read(rel).split(from).join(to)
  const family = FAMILIES.filter(function (x) { return x.name === familyName })[0]
  const bad = familyAssertions(family, mutated).filter(function (x) { return !x[0] })
  check(bad.length === 1 && bad[0][1].indexOf(expectText) >= 0, '反证：' + label + ' → 判据正好报出这一处缺（' + (bad.length ? bad[0][1] : '没有报缺') + '）')
}
proof('把改动页执行电话的宿主注册改掉', 'src/host/index.ts', "harness.handle('wf.gitChangesWrite'", "harness.handle('wf.gitChangesWriteX'", '改动页', '执行电话在宿主注册')
proof('把工作树客户端里执行电话名改掉', 'src/client/views/versionControl/vcWorktreesOps.ts', "'wf.gitWorktreeRun'", "'wf.gitWorktreeRunX'", '工作树', '客户端用对电话')
proof('把维护页写超时键改名', 'config/timeouts.yaml', 'vcMaintenanceWriteTimeoutMs:', 'vcMaintenanceWriteTimeoutMsX:', '维护', '超时配置在 YAML：vcMaintenanceWriteTimeoutMs')
proof('把改动页预检里的白名单函数名改掉', 'src/host/versionControlChangesCheck.ts', 'changesOpMetaOf(op)', 'changesOpMetaOfX(op)', '改动页', '白名单/理由表有登记')

console.log('')
if (failed) console.log('存在失败 — ' + GATE + ' 未通过')
else console.log('全部通过 — 老七处登记点一处不漏，新增写动作族逐族五查（' + total + ' 项断言）')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
