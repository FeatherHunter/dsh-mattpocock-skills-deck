// 门禁归属: src/shared/version-control/src/maintenance-ops.ts
// verify-1586-maintenance —— 规格 #1586 域 11 的 11.2–11.11（仓库维护，#1758 T22）：
// 维护页十条能力的动作表、版本门、计划与任务通道参数、宿主预检/凭票执行与两页界面。
// 本文件只做观察：读真源码文本、真 import 共享纯模块、在真临时 git 仓库里跑真命令；
// 每组末尾不依赖被测代码自证，反证组会故意改坏一份副本并断言对账必然报错。
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const { localeDataText } = require('./lib/locale-data.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-maintenance'
let total = 0
let failed = 0
function check(ok, msg) { total += 1; if (!ok) { failed += 1; console.log('  FAIL ' + msg) } }
function eq(actual, expected, msg) { check(actual === expected, msg + '（实测 ' + String(actual) + '，期望 ' + String(expected) + '）') }
function has(haystack, needle, msg) { check(String(haystack).indexOf(needle) >= 0, msg) }
function digest16(text) { return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16) }
function idsOf(list) { return (list || []).map(function (x) { return x.id }).join(',') }
function loadModule(rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }
function stripComments(text) { return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') }

async function main() {
  // ---------- A 组：共享协议（十条能力、动作表、版本门、计划与任务通道参数） ----------
  const ops = await loadModule('src/shared/version-control/src/maintenance-ops.js')

  eq(ops.MAINTENANCE_OPS.length, 16, 'A1 动作表十六条：五条写、九条读、两条任务')
  eq(idsOf(ops.MAINTENANCE_OPS), 'fsck-basic,fsck-unreachable,unreachable,objects,gc,prune-preview,prune,repack,maintenance-status,maintenance-run,maintenance-enable,maintenance-disable,commit-graph,multi-pack-index,pack-refs,overview', 'A2 动作顺序按能力编号排，一眼能从诊断读到维护')
  eq(idsOf(ops.MAINTENANCE_WRITE_OPS), 'gc,prune,maintenance-run,maintenance-enable,maintenance-disable', 'A3 写动作五条')
  eq(idsOf(ops.MAINTENANCE_READ_OPS), 'unreachable,objects,prune-preview,repack,maintenance-status,commit-graph,multi-pack-index,pack-refs,overview', 'A4 读动作九条')
  eq(idsOf(ops.MAINTENANCE_TASK_ACTIONS), 'fsck-basic,fsck-unreachable', 'A5 走任务通道的只有两条完整性检查')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.primary }).length, 10, 'A6 十条能力各有且只有一个主入口')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.primary }).map(function (m) { return m.id }).join(','), 'fsck-basic,fsck-unreachable,objects,gc,prune,repack,maintenance-run,commit-graph,multi-pack-index,pack-refs', 'A7 主入口逐条对得上 11.2 到 11.11')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return !m.primary }).map(function (m) { return m.id }).join(','), 'unreachable,prune-preview,maintenance-status,maintenance-enable,maintenance-disable,overview', 'A8 其余六条是辅助动作或总览读数')
  eq(ops.MAINTENANCE_PRIMARY_IDS.join(','), 'fsck-basic,fsck-unreachable,objects,gc,prune,repack,maintenance-run,commit-graph,multi-pack-index,pack-refs', 'A9 主入口清单单独导出，界面与门禁都从这里读')
  eq(ops.MAINTENANCE_OPS.map(function (m) { return m.capId }).filter(function (c, i, a) { return c !== '' && a.indexOf(c) === i }).join(','), '11.2,11.3,11.4,11.5,11.6,11.7,11.8,11.9,11.10,11.11', 'A10 十条能力编号一个不多一个不少')
  check(ops.MAINTENANCE_OPS.every(function (m) {
    if (m.id === 'fsck-basic') return m.capId === '11.2'
    if (m.id === 'fsck-unreachable' || m.id === 'unreachable') return m.capId === '11.3'
    return true
  }), 'A11 11.2 与 11.3 的动作归位正确')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.capId === '11.8' }).map(function (m) { return m.id }).join(','), 'maintenance-status,maintenance-run,maintenance-enable,maintenance-disable', 'A12 11.8 自动维护一条能力四个动作：看状态、立即跑、开启、关闭')
  check(ops.MAINTENANCE_OPS.every(function (m) { return m.needs === 'none' }), 'A13 维护动作都不需要额外的路径或分支输入')
  check(ops.MAINTENANCE_WRITE_OPS.every(function (m) { return m.kind === 'write' && m.confirm === true }), 'A14 写动作都要过确认卡')
  eq(ops.MAINTENANCE_WRITE_OPS.filter(function (m) { return m.dangerous }).map(function (m) { return m.id }).join(','), 'prune', 'A15 危险区只有清除不可达对象一条')
  eq(ops.MAINTENANCE_WRITE_OPS.filter(function (m) { return m.reversible === false }).map(function (m) { return m.id }).join(','), 'prune', 'A16 不可自动恢复的也只有清除不可达对象')
  eq(ops.MAINTENANCE_WRITE_OPS.filter(function (m) { return m.requiresBackup }).map(function (m) { return m.id }).join(','), 'prune', 'A17 动手前必须整仓备份的只有清除不可达对象')
  check(ops.MAINTENANCE_OPS.every(function (m) { return typeof m.labelKey === 'string' && m.labelKey.indexOf('vc.maintenance.') === 0 }), 'A18 文案键统一前缀')
  check(ops.MAINTENANCE_OPS.every(function (m) { return typeof m.command === 'string' && m.command.indexOf('git ') === 0 }), 'A19 每条动作都写清对应的 git 命令')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.id === 'prune' })[0].command, 'git prune', 'A20 清除不可达对象对应的就是 git prune')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.id === 'prune-preview' })[0].command, 'git prune -n -v', 'A21 预演用 -n，不真删')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.id === 'pack-refs' })[0].command, 'git pack-refs', 'A22 打包引用只读展示，不提供触发按钮')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.id === 'objects' })[0].command, 'git count-objects -vH', 'A23 对象与体积读的就是 count-objects -vH')
  eq(ops.MAINTENANCE_PHONES.read + ',' + ops.MAINTENANCE_PHONES.check + ',' + ops.MAINTENANCE_PHONES.write, 'wf.gitMaintenanceRead,wf.gitMaintenanceCheck,wf.gitMaintenanceWrite', 'A24 三条电话名字固定')
  eq(ops.MAINTENANCE_CHECK_CONTRACT, 'vc-maintenance-check', 'A25 预检契约名固定')
  eq(ops.MAINTENANCE_CHECK_VERSION, 1, 'A26 预检契约版本从 1 起')
  has(ops.MAINTENANCE_OPS_SOURCE, 'fsck-basic', 'A27 协议原文包含完整性检查')
  has(ops.MAINTENANCE_OPS_SOURCE, '--unreachable', 'A28 协议原文包含不可达检查参数')
  has(ops.MAINTENANCE_OPS_SOURCE, 'maintenance', 'A29 协议原文包含自动维护')
  check(ops.MAINTENANCE_OPS_SOURCE.indexOf('import ') < 0, 'A30 共享协议零 import，能直接拼进界面闭包')
  eq(ops.MAINTENANCE_OPS.map(function (m) { return m.labelKey }).filter(function (k, i, a) { return a.indexOf(k) === i }).length, 16, 'A31 每条动作的文案键不重复')
  eq(ops.MAINTENANCE_OPS.map(function (m) { return m.id }).filter(function (k, i, a) { return a.indexOf(k) === i }).length, 16, 'A32 动作 id 不重复')

  eq(ops.MAINTENANCE_PLAN_KEYS.join(','), 'op,mode', 'A33 计划字段固定为动作与模式两个')
  eq(JSON.stringify(ops.maintenancePlanOf({})), JSON.stringify({ op: '', mode: '' }), 'A34 空计划把两格填成空串，不留 undefined')
  eq(JSON.stringify(ops.maintenancePlanOf({ op: 'prune' })), JSON.stringify({ op: 'prune', mode: '' }), 'A35 写动作的计划只带动作名')
  eq(JSON.stringify(ops.maintenancePlanOf({ op: 'fsck-unreachable', mode: 'unreachable' })), JSON.stringify({ op: 'fsck-unreachable', mode: 'unreachable' }), 'A36 任务动作的计划带上模式')
  eq(ops.maintenancePlanInput(ops.maintenancePlanOf({ op: 'prune' })), '{"mode":"","op":"prune"}', 'A37 计划摘要输入按键名排序，换机器也稳定')
  check(ops.maintenancePlanInput(ops.maintenancePlanOf({ op: 'prune' })) !== ops.maintenancePlanInput(ops.maintenancePlanOf({ op: 'gc' })), 'A38 不同动作的计划摘要不同')
  eq(ops.maintenanceOpMetaOf('gc').capId, '11.5', 'A39 按 id 取动作元信息')
  eq(ops.maintenanceOpMetaOf('不存在的动作'), null, 'A40 认不出的动作回 null，交给上层拒绝')
  eq(ops.maintenanceWriteOpOf('gc').id, 'gc', 'A41 写动作判定')
  eq(ops.maintenanceWriteOpOf('objects'), null, 'A42 只读动作不算写动作')
  eq(ops.maintenanceWriteOpOf('不存在的动作'), null, 'A43 认不出的动作也不当写动作')
  eq(ops.maintenanceTaskActionOf('fsck-unreachable').capId, '11.3', 'A44 任务动作判定')
  eq(ops.maintenanceTaskActionOf('gc'), null, 'A45 写动作不走任务动作表')

  eq(JSON.stringify(ops.maintenanceTaskRequestOf('gc')), JSON.stringify({ op: 'gc' }), 'A46 垃圾回收的任务请求只带动作')
  eq(JSON.stringify(ops.maintenanceTaskRequestOf('prune')), JSON.stringify({ op: 'prune' }), 'A47 清除不可达对象也走任务通道')
  eq(JSON.stringify(ops.maintenanceTaskRequestOf('maintenance-run')), JSON.stringify({ op: 'maintenance-run' }), 'A48 立即跑自动维护走任务通道')
  eq(JSON.stringify(ops.maintenanceTaskRequestOf('fsck-basic')), JSON.stringify({ op: 'fsck', args: { mode: 'default' } }), 'A49 完整性检查走任务通道，模式显式写 default')
  eq(JSON.stringify(ops.maintenanceTaskRequestOf('fsck-unreachable')), JSON.stringify({ op: 'fsck', args: { mode: 'unreachable' } }), 'A50 不可达检查走任务通道，模式显式写 unreachable')
  eq(ops.maintenanceTaskRequestOf('objects'), null, 'A51 普通读数不起任务')
  eq(ops.maintenanceTaskRequestOf('不存在的动作'), null, 'A52 认不出的动作不起任务')
  eq(JSON.stringify(ops.maintenanceLocalStepsOf('maintenance-enable')), JSON.stringify([['maintenance', 'start']]), 'A53 开启自动维护只走 git maintenance start')
  eq(JSON.stringify(ops.maintenanceLocalStepsOf('maintenance-disable')), JSON.stringify([['maintenance', 'stop'], ['maintenance', 'unregister']]), 'A54 关闭自动维护先 stop 摘调度项再 unregister')
  eq(JSON.stringify(ops.maintenanceLocalStepsOf('gc')), JSON.stringify([]), 'A55 走任务通道的动作没有本地步骤')
  eq(ops.maintenanceRequiresBackupOf('prune'), true, 'A56 清除不可达对象必须先备份')
  eq(ops.maintenanceRequiresBackupOf('gc'), false, 'A57 垃圾回收不强制备份')
  eq(ops.maintenanceRequiresBackupOf('不存在的动作'), false, 'A58 认不出的动作不要求备份')

  eq(ops.maintenanceModeProblem(undefined), null, 'A59 不填模式按默认处理')
  eq(ops.maintenanceModeProblem('default'), null, 'A60 default 合法')
  eq(ops.maintenanceModeProblem('unreachable'), null, 'A61 unreachable 合法')
  eq(ops.maintenanceModeProblem('lost-found'), 'bad-mode', 'A62 会写 .git/lost-found 的模式不开放')
  eq(ops.maintenanceModeProblem(3), 'bad-mode', 'A63 模式必须是字符串')

  eq(ops.maintenanceVersionAtLeast('git version 2.49.0.windows.1', '2.30'), true, 'A64 能从完整版本串读出主次版本')
  eq(ops.maintenanceVersionAtLeast('git version 2.17.1', '2.18'), false, 'A65 主版本相同比次版本')
  eq(ops.maintenanceVersionAtLeast('2.30.1', '2.30'), true, 'A66 也接受不带前缀的版本串')
  eq(ops.maintenanceVersionAtLeast('git version 2.11.0', '2.11'), true, 'A67 恰好同版本算够用')
  eq(ops.maintenanceVersionAtLeast('读不出', '2.30'), false, 'A68 读不出就按不够处理，宁可隐藏不误导')
  eq(JSON.stringify(ops.MAINTENANCE_VERSION_HIDE), JSON.stringify({ '11.8': '2.30', '11.9': '2.18', '11.10': '2.21' }), 'A69 版本门与账本三条 versionPolicy=hide 对齐')
  eq(ops.maintenanceVersionProblem(ops.maintenanceOpMetaOf('maintenance-run'), 'git version 2.29.0'), 'version-unsupported', 'A70 2.29 没有 maintenance 子命令')
  eq(ops.maintenanceVersionProblem(ops.maintenanceOpMetaOf('maintenance-run'), 'git version 2.30.0'), null, 'A71 2.30 起自动维护可用')
  eq(ops.maintenanceVersionProblem(ops.maintenanceOpMetaOf('commit-graph'), 'git version 2.17.0'), 'version-unsupported', 'A72 2.18 以下没有提交图')
  eq(ops.maintenanceVersionProblem(ops.maintenanceOpMetaOf('multi-pack-index'), 'git version 2.20.0'), 'version-unsupported', 'A73 2.21 以下没有多包索引')
  eq(ops.maintenanceVersionProblem(ops.maintenanceOpMetaOf('gc'), 'git version 2.11.0'), null, 'A74 垃圾回收不受新版本门限制')
  eq(ops.maintenanceVisibleOf('11.8', 'git version 2.29.0'), false, 'A75 版本不够的自动维护隐藏')
  eq(ops.maintenanceVisibleOf('11.8', 'git version 2.30.0'), true, 'A76 版本够了才出现')
  eq(ops.maintenanceVisibleOf('11.5', 'git version 2.11.0'), true, 'A77 没有版本门的动作任何版本都出现')
  check(ops.maintenanceVisibleOf('11.9', 'git version 2.17.0') === false && ops.maintenanceVisibleOf('11.9', 'git version 2.18.0') === true, 'A78 提交图的版本门在 2.18')
  check(ops.maintenanceVisibleOf('11.10', 'git version 2.20.0') === false && ops.maintenanceVisibleOf('11.10', 'git version 2.21.0') === true, 'A79 多包索引的版本门在 2.21')

  eq(ops.maintenanceSceneProblem({ repoBare: false, operation: null }), null, 'A80 干净仓库放行')
  eq(ops.maintenanceSceneProblem({ repoBare: true, operation: null }), 'repo-bare', 'A81 裸仓库不能在这里维护')
  eq(ops.maintenanceSceneProblem({ repoBare: false, operation: 'merge' }), 'operation-in-progress', 'A82 合并中等操作进行时先拒绝')

  // 与能力账本逐条对账：编号、页面、主入口、版本门都必须同源。
  const ledger = await loadModule('src/shared/version-control/src/capability-ledger.js')
  const rows = ledger.CAPABILITIES.filter(function (c) { return /^11\.(?:[2-9]|10|11)$/.test(c.id) })
  eq(rows.length, 10, 'A83 账本里 11.2 到 11.11 恰好十条')
  eq(rows.map(function (r) { return r.id }).join(','), '11.2,11.3,11.4,11.5,11.6,11.7,11.8,11.9,11.10,11.11', 'A84 账本编号连续')
  eq(rows.filter(function (r) { return r.page === 'diagnostics' }).map(function (r) { return r.id }).join(','), '11.2,11.3,11.4', 'A85 三条诊断能力落在诊断页')
  eq(rows.filter(function (r) { return r.page === 'maintenance' }).map(function (r) { return r.id }).join(','), '11.5,11.6,11.7,11.8,11.9,11.10,11.11', 'A86 七条维护能力落在维护页')
  const diagIds = ['11.2', '11.3', '11.4']
  const maintIds = ['11.5', '11.6', '11.7', '11.8', '11.9', '11.10', '11.11']
  check(rows.filter(function (r) { return diagIds.indexOf(r.id) >= 0 }).every(function (r) { return r.primaryEntry === '管理·诊断' }), 'A87 11.2 到 11.4 的主入口是管理·诊断')
  check(rows.filter(function (r) { return maintIds.indexOf(r.id) >= 0 }).every(function (r) { return r.primaryEntry === '管理·维护' }), 'A88 11.5 到 11.11 的主入口是管理·维护')
  const gap = []
  rows.forEach(function (r) {
    const primary = ops.MAINTENANCE_OPS.filter(function (m) { return m.primary && m.capId === r.id })
    if (primary.length !== 1) gap.push(r.id)
    const hideNeed = ops.MAINTENANCE_VERSION_HIDE[r.id]
    if ((r.versionPolicy === 'hide' ? r.minVersion : null) !== (hideNeed || null)) gap.push(r.id + ':version')
  })
  eq(gap.join(','), '', 'A89 十条能力的唯一主入口与版本门跟账本逐条对得上')
  eq(rows.filter(function (r) { return r.versionPolicy === 'hide' }).map(function (r) { return r.id }).join(','), '11.8,11.9,11.10', 'A90 版本门只压三条')
  check(rows.filter(function (r) { return r.versionPolicy === 'hide' }).every(function (r) { return ledger.VERSION_GATED_IDS.indexOf(r.id) >= 0 }), 'A91 三条版本门都在账本的受控清单里')
  const task = await loadModule('src/shared/version-control/src/task-protocol.js')
  const taskIds = task.TASK_OPS.map(function (o) { return o.id })
  check(['fsck', 'gc', 'prune', 'maintenance-run'].every(function (id) { return taskIds.indexOf(id) >= 0 }), 'A92 维护动作要用到的任务类型都在任务通道清单里')
  eq(ops.MAINTENANCE_OPS.filter(function (m) { return m.kind === 'task' }).length, taskIds.filter(function (id) { return id === 'fsck' }).length + 1, 'A93 任务动作两条都指向同一个 fsck 任务类型')
  console.log('  A 组完成：' + total + ' 条')

  // ---------- B 组：宿主预检与执行（假依赖，零真进程；拒绝栈必须一条命令都不起） ----------
  const ticketMod = await loadModule('src/shared/version-control/src/write-ticket.js')
  const envelope = await loadModule('src/shared/version-control/exec-envelope.js')
  const readMod = await loadModule('src/host/versionControlMaintenanceRead.js')
  const checkMod = await loadModule('src/host/versionControlMaintenanceCheck.js')
  const writeMod = await loadModule('src/host/versionControlMaintenanceWrite.js')
  const OID1 = 'a'.repeat(40)
  const OID2 = 'b'.repeat(40)
  function makeScreen(over) {
    const base = { identity: { oid: 'h1' }, repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false }, staged: [], unstaged: [], conflictCount: 0 }
    const o = over || {}
    return { identity: Object.assign({}, base.identity, o.identity || {}), repo: Object.assign({}, base.repo, o.repo || {}), staged: o.staged || base.staged, unstaged: o.unstaged || base.unstaged, conflictCount: o.conflictCount === undefined ? 0 : o.conflictCount }
  }
  function makeRig(spec) {
    const s = spec || {}
    const state = { screenCalls: 0, runCalls: [], runOpts: [], taskStarts: [], backups: [] }
    const clock = { t: 1000 }
    const root = s.root || 'C:/repo'
    const gitVersion = s.gitVersion || 'git version 2.49.0.windows.1'
    function screenNow() {
      state.screenCalls += 1
      if (s.screenSecond && state.screenCalls >= 2) return makeScreen(s.screenSecond)
      return s.screen || makeScreen()
    }
    async function runPinned(exe, dir, args, opts) {
      state.runCalls.push(args.slice())
      state.runOpts.push(opts || null)
      if (typeof s.runPinned === 'function') {
        const r = await s.runPinned(args, state)
        if (r) return r
      }
      const key = args.join(' ')
      if (key === 'version') return { kind: 'ok', stdout: gitVersion + '\n', stderr: '' }
      if (key === 'rev-parse --git-dir') return { kind: 'ok', stdout: '.git\n', stderr: '' }
      if (key === 'rev-parse --abbrev-ref HEAD') return { kind: 'ok', stdout: 'main\n', stderr: '' }
      if (key === 'count-objects -v') return { kind: 'ok', stdout: 'count: 5\nsize: 8\nin-pack: 2\npacks: 1\nsize-pack: 4\nprune-packable: 0\ngarbage: 0\n', stderr: '' }
      if (key === 'fsck --unreachable --no-progress') return { kind: 'ok', stdout: s.unreachableText === undefined ? ('unreachable blob ' + OID1 + '\n') : s.unreachableText, stderr: '' }
      if (key === 'prune -n -v') return { kind: 'ok', stdout: s.pruneText === undefined ? (OID1 + ' blob\n') : s.pruneText, stderr: '' }
      if (key === 'config --get-all maintenance.repo') return s.repos ? { kind: 'ok', stdout: s.repos, stderr: '' } : { kind: 'non-zero', exitCode: 1, stdout: '', stderr: '' }
      if (key === 'config --get-regexp ^maintenance.') return s.maintConfig ? { kind: 'ok', stdout: s.maintConfig, stderr: '' } : { kind: 'non-zero', exitCode: 1, stdout: '', stderr: '' }
      if (key === 'commit-graph verify' || key === 'multi-pack-index verify') return { kind: 'ok', stdout: '', stderr: '' }
      return { kind: 'ok', stdout: '', stderr: '' }
    }
    const readDeps = {
      runPinned: runPinned,
      resolveGitExecutable: async function () { return 'git' },
      resolveRepoRoot: async function () { return { ok: true, root: root, kind: 'worktree' } },
      readScreenOf: async function () { return { ok: true, screen: screenNow() } },
      fs: { statfs: async function () { return { bsize: 4096, bavail: 262144 } } },
      now: function () { return clock.t },
      readTimeoutMs: 15000,
    }
    const read = readMod.createMaintenanceRead(readDeps)
    const failPhone = envelope.failPhone
    const check = checkMod.createMaintenanceCheck({ read: read, failPhone: failPhone, now: function () { return clock.t }, randomId: function () { return 'tkt-' + String(state.screenCalls) + '-' + String(state.runCalls.length) } })
    const backup = {
      runBackup: async function (exe, r, plan) {
        state.backups.push({ exe: exe, root: r, plan: plan })
        if (s.backupFail) return { ok: false, reason: 'backup-failed', message: '磁盘满了，备份没做成' }
        return { ok: true, point: { kind: plan.kind, path: plan.path, bytes: 4096, elapsedMs: 9, atMs: clock.t } }
      },
    }
    const taskStart = async function (req) {
      state.taskStarts.push(req)
      if (typeof s.taskStart === 'function') return s.taskStart(req)
      return { ok: true, task: { id: 'task-1', op: req.op } }
    }
    const write = writeMod.createMaintenanceWrite({ read: read, failPhone: failPhone, runPinned: runPinned, taskStart: taskStart, backup: backup, now: function () { return clock.t }, tickets: check.tickets, results: check.results, writeTimeoutMs: 123456 })
    return { read: read, check: check, write: write, state: state, clock: clock }
  }

  {
    const rig = makeRig({})
    const badOp = await rig.check.handleMaintenanceRead({ cwd: 'C:/repo', op: '不存在的动作' })
    eq(badOp.ok, false, 'B1 只读电话认不出动作时回失败')
    eq(badOp.reason, 'bad-target', 'B2 认不出动作的理由是 bad-target')
    eq(badOp.error.kind, 'args', 'B3 认不出动作归输入类失败')
    const noCwd = await rig.check.handleMaintenanceRead({ op: 'objects' })
    eq(noCwd.ok, false, 'B4 只读电话缺仓库目录时回失败')
    eq(noCwd.reason, 'bad-target', 'B5 缺仓库目录的理由是 bad-target')
    const writeOpAsRead = await rig.check.handleMaintenanceRead({ cwd: 'C:/repo', op: 'gc' })
    eq(writeOpAsRead.ok, false, 'B6 写动作不能当只读动作读')
    const objs = await rig.check.handleMaintenanceRead({ cwd: 'C:/repo', op: 'objects' })
    eq(objs.ok, true, 'B7 对象读数能读出来')
    eq(objs.looseCount, 5, 'B8 松散对象条数按 count-objects 解析')
    eq(objs.looseSizeBytes, 8192, 'B9 松散对象体积按 KiB 换算成字节')
    eq(objs.repoSizeBytes, 12288, 'B10 仓库体积等于松散加打包')
    eq(objs.contract, 'vc-maintenance-check', 'B11 只读回包也带契约名，界面只认一种形状')
    eq(objs.capId, '11.4', 'B12 对象读数标注能力编号 11.4')
    const overview = await rig.check.handleMaintenanceRead({ cwd: 'C:/repo', op: 'overview' })
    eq(overview.ok, true, 'B13 总览一次读完')
    check(overview.objects && overview.repack && overview.maintenance, 'B14 总览三块读数都在')
    eq(overview.gitVersion, 'git version 2.49.0.windows.1', 'B15 总览带上完整 git 版本串')
    const verGate = makeRig({ gitVersion: 'git version 2.10.0' })
    const gated = await verGate.check.handleMaintenanceRead({ cwd: 'C:/repo', op: 'commit-graph' })
    eq(gated.ok, false, 'B16 版本不够的只读能力拒绝')
    eq(gated.reason, 'version-unsupported', 'B17 版本不够的理由是 version-unsupported')
    eq(gated.capId, '11.9', 'B18 拒绝回包点名是哪条能力')
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-maint-b-'))
    fs.mkdirSync(path.join(dir, '.git', 'objects', OID1.slice(0, 2)), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'objects', OID1.slice(0, 2), OID1.slice(2)), 'x')
    const rig = makeRig({ root: dir.replace(/\\/g, '/'), unreachableText: 'unreachable blob ' + OID1 + '\nunreachable commit ' + OID2 + '\n' })
    const un = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'unreachable' })
    eq(un.ok, true, 'B19 不可达对象读数能读出来')
    eq(un.count, 2, 'B20 不可达对象条数按清单解析')
    eq(un.items[0].oid, OID1, 'B21 清单第一项带完整提交号')
    eq(un.items[1].type, 'commit', 'B22 清单带对象类型')
    eq(un.looseFound, 1, 'B23 只有松散对象读得到修改时间')
    eq(un.packedUnknown, 1, 'B24 打包对象读不到时间就如实计数')
    eq(typeof un.earliestAtMs, 'number', 'B25 读得到最早时间时回毫秒数')
    const pv = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'prune-preview' })
    eq(pv.ok, true, 'B26 清除预演能读出来')
    eq(pv.count, 1, 'B27 预演清单条数按 prune -n -v 解析')
    eq(typeof pv.earliestAtMs, 'number', 'B28 预演也给最早时间')
    const scene = await rig.read.sceneOf(dir)
    eq(scene.ok, true, 'B29 量现场成功')
    eq(scene.scene.branch, 'main', 'B30 现场带当前分支')
    eq(scene.scene.dirty, false, 'B31 干净工作区判不脏')
    eq(scene.scene.operation, null, 'B32 没有进行中操作')
    eq(scene.scene.objects.looseCount, 5, 'B33 现场带上对象统计')
    const dirty = makeRig({ root: dir.replace(/\\/g, '/'), screen: makeScreen({ staged: [{ path: 'a.txt' }] }) })
    const scene2 = await dirty.read.sceneOf(dir)
    eq(scene2.scene.dirty, true, 'B34 有暂存改动判脏')
    const merging = makeRig({ root: dir.replace(/\\/g, '/'), screen: makeScreen({ repo: { merging: true } }) })
    const scene3 = await merging.read.sceneOf(dir)
    eq(scene3.scene.operation, 'merge', 'B35 合并中能认出来')
    fs.rmSync(dir, { recursive: true, force: true })
  }

  {
    const rig = makeRig({})
    const bad = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: '不存在的动作' })
    eq(bad.ok, false, 'B36 预检认不出动作时拒绝')
    eq(bad.reason, 'bad-target', 'B37 认不出动作的理由是 bad-target')
    eq(rig.state.runCalls.length, 0, 'B38 认不出动作时一条命令都不起')
    const noCwd = await rig.check.handleMaintenanceCheck({ op: 'gc' })
    eq(noCwd.reason, 'bad-target', 'B39 预检缺仓库目录拒绝')
    const busy = makeRig({ screen: makeScreen({ repo: { rebasing: true } }) })
    const busyOut = await busy.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    eq(busyOut.ok, false, 'B40 变基进行中拒绝维护动作')
    eq(busyOut.reason, 'operation-in-progress', 'B41 进行中操作的拒绝理由是 operation-in-progress')
    const old = makeRig({ gitVersion: 'git version 2.20.0' })
    const oldOut = await old.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-run' })
    eq(oldOut.ok, false, 'B42 版本不够时预检拒绝')
    eq(oldOut.reason, 'version-unsupported', 'B43 版本不够的预检理由是 version-unsupported')
    eq(oldOut.needed, '2.30', 'B44 拒绝回包点名需要的版本')
    const reg = makeRig({ repos: 'C:/repo\n', maintConfig: 'maintenance.gc.enabled true\n' })
    const regOut = await reg.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-enable' })
    eq(regOut.ok, false, 'B45 已经登记后台维护时不再重复开启')
    eq(regOut.reason, 'nothing-to-do', 'B46 重复开启的理由是 nothing-to-do')
    const unreg = makeRig({})
    const unregOut = await unreg.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-disable' })
    eq(unregOut.ok, false, 'B47 没登记时不能关闭')
    eq(unregOut.reason, 'nothing-to-do', 'B48 没登记关闭的理由是 nothing-to-do')
    const nothing = makeRig({ unreachableText: '', pruneText: '' })
    const nothingOut = await nothing.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'prune' })
    eq(nothingOut.ok, false, 'B49 没有不可达对象时拒绝清理')
    eq(nothingOut.reason, 'nothing-to-do', 'B50 没有可清理对象的理由是 nothing-to-do')
    check(nothingOut.preview && nothingOut.preview.count === 0, 'B51 拒绝回包仍带上预演事实（零个）')
  }

  {
    const rig = makeRig({})
    const signed = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    eq(signed.ok, true, 'B52 普通维护动作能签票')
    eq(signed.decision.verdict, 'allow', 'B53 签票的决策是放行')
    eq(signed.confirmRequired, true, 'B54 维护动作都要确认')
    eq(signed.ticket.op, 'gc', 'B55 票上记着动作')
    eq(signed.ticket.expiresAtMs - signed.ticket.checkedAtMs, 120000, 'B56 票据时限一百二十秒')
    eq(signed.plan.mode, '', 'B57 不需要模式的动作计划里模式为空串')
    check(signed.confirm && signed.confirm.what && signed.confirm.wont && signed.confirm.verb, 'B58 确认卡四段齐全')
    eq(signed.confirm.reversible, true, 'B59 垃圾回收在确认卡上标明可恢复（旧提交还有引用）')
    const pRun = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-run' })
    eq(pRun.ticket.op, 'maintenance-run', 'B60 立即跑自动维护也能签票')
    const pruneRig = makeRig({})
    const pruneSigned = await pruneRig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'prune' })
    eq(pruneSigned.ok, true, 'B61 清除不可达对象能签票')
    eq(pruneSigned.confirm.reversible, false, 'B62 清除不可达对象在确认卡上标明不可自动恢复')
    eq(pruneSigned.backup.required, true, 'B63 签票回包带上强制备份计划')
    check(String(pruneSigned.backup.path).indexOf('-backup-') >= 0, 'B64 备份路径带 -backup- 便于人找')
    check(pruneSigned.preview && pruneSigned.preview.count === 1, 'B65 签票回包带上不可达对象个数')
    check(pruneSigned.confirm.backup && pruneSigned.confirm.backup.path === pruneSigned.backup.path, 'B66 确认卡里也写着备份放哪')
  }

  {
    const rig = makeRig({})
    const pre = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    const ticketId = pre.ticket.id
    const missing = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: 'nope', requestId: 'r1', confirmed: true })
    eq(missing.ok, false, 'B67 找不到票时拒绝')
    eq(missing.reason, 'ticket-missing', 'B68 找不到票的理由是 ticket-missing')
    const badRid = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: ticketId, requestId: 'bad id!', confirmed: true })
    eq(badRid.reason, 'bad-target', 'B69 请求号形状不对时拒绝')
    const mismatch = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'maintenance-run', ticketId: ticketId, requestId: 'r2', confirmed: true })
    eq(mismatch.reason, 'ticket-op-mismatch', 'B70 票上动作与这次动作不符时拒绝')
    const noConfirm = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: ticketId, requestId: 'r3' })
    eq(noConfirm.reason, 'need-confirm', 'B71 没确认时拒绝')
    eq(noConfirm.error.kind, 'need-confirm', 'B72 没确认的失败类型是 need-confirm')
    rig.clock.t = 1000 + 121000
    const expired = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: ticketId, requestId: 'r4', confirmed: true })
    eq(expired.reason, 'ticket-expired', 'B73 票过期后拒绝')
    check(rig.state.taskStarts.length === 0, 'B74 拒绝栈里一条任务都没起')
    check(rig.state.backups.length === 0, 'B75 拒绝栈里一次备份都没做')
  }

  {
    const rig = makeRig({ screenSecond: makeScreen({ identity: { oid: 'h2' } }) })
    const pre = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    const moved = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: pre.ticket.id, requestId: 'r5', confirmed: true })
    eq(moved.ok, false, 'B76 预检后 HEAD 动了拒绝')
    eq(moved.reason, 'target-changed', 'B77 HEAD 动了的理由是 target-changed')
    check(rig.state.taskStarts.length === 0, 'B78 HEAD 动了时一条任务都不起')
    const dirtyRig = makeRig({ screenSecond: makeScreen({ staged: [{ path: 'a.txt' }] }) })
    const pre2 = await dirtyRig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    const changed = await dirtyRig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: pre2.ticket.id, requestId: 'r6', confirmed: true })
    eq(changed.reason, 'target-changed', 'B79 预检后工作区变了拒绝')
  }

  {
    const rig = makeRig({})
    const pre = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'gc' })
    const same = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: pre.ticket.id, requestId: 'r7', confirmed: true })
    eq(same.ok, true, 'B80 现场没变时凭票执行成功')
    eq(same.kind, 'task', 'B81 垃圾回收走长任务通道')
    eq(same.task.op, 'gc', 'B82 起的是垃圾回收任务')
    eq(rig.state.taskStarts.length, 1, 'B83 只起一次任务')
    eq(rig.state.taskStarts[0].op, 'gc', 'B84 任务参数里的动作是 gc')
    eq(JSON.stringify(same.steps), JSON.stringify(['task']), 'B85 不需要备份的动作只有任务一步')
    const replay = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'gc', ticketId: pre.ticket.id, requestId: 'r7', confirmed: true })
    eq(replay.reused, true, 'B86 同一请求号重放回上次结果')
    eq(rig.state.taskStarts.length, 1, 'B87 重放不重复起任务')
    const runRig = makeRig({})
    const pre2 = await runRig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-run' })
    const ran = await runRig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'maintenance-run', ticketId: pre2.ticket.id, requestId: 'r8', confirmed: true })
    eq(ran.task.op, 'maintenance-run', 'B88 立即跑自动维护也走任务通道')
  }

  {
    const failRig = makeRig({ backupFail: true })
    const pre = await failRig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'prune' })
    const blocked = await failRig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'prune', ticketId: pre.ticket.id, requestId: 'r9', confirmed: true })
    eq(blocked.ok, false, 'B89 备份失败时中止')
    eq(blocked.reason, 'backup-failed', 'B90 备份失败的理由是 backup-failed')
    eq(failRig.state.taskStarts.length, 0, 'B91 备份失败时绝不启动清除任务')
    eq(failRig.state.backups.length, 1, 'B92 备份确实尝试过一次')
  }

  {
    const rig = makeRig({})
    const pre = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'prune' })
    const done = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'prune', ticketId: pre.ticket.id, requestId: 'r10', confirmed: true })
    eq(done.ok, true, 'B93 备份成功后才执行清除')
    eq(JSON.stringify(done.steps), JSON.stringify(['backup', 'task']), 'B94 清除动作两步：先备份再起任务')
    eq(rig.state.backups.length, 1, 'B95 备份只做一次')
    eq(rig.state.taskStarts.length, 1, 'B96 备份成功后才起任务')
    eq(rig.state.taskStarts[0].op, 'prune', 'B97 起的是清除不可达对象任务')
    check(done.backup && done.backup.bytes === 4096, 'B98 回包带上备份实际大小')
    has(String(done.backupSummary), '备份在', 'B99 回包带上人话备份摘要')
    eq(done.backupRestoreSteps.length, 3, 'B100 回包带上三步还原指引')
  }

  {
    const rig = makeRig({})
    const pre = await rig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-enable' })
    const enabled = await rig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'maintenance-enable', ticketId: pre.ticket.id, requestId: 'r11', confirmed: true })
    eq(enabled.ok, true, 'B101 开启自动维护走本地命令并成功')
    eq(enabled.kind, 'local', 'B102 开启自动维护是本地动作')
    eq(JSON.stringify(enabled.argv), JSON.stringify([['maintenance', 'start']]), 'B103 开启执行 maintenance start')
    check(rig.state.runCalls.some(function (a) { return a.join(' ') === 'maintenance start' }), 'B104 本地命令真的跑过 maintenance start')
    check(rig.state.taskStarts.length === 0, 'B105 本地动作不起长任务')
    eq(enabled.maintenance.registered, false, 'B106 执行后回读自动维护状态')
    const stepCall = rig.state.runCalls.filter(function (a) { return a.join(' ') === 'maintenance start' })[0]
    const startAt = rig.state.runCalls.findIndex(function (a) { return a.join(' ') === 'maintenance start' })
    eq(rig.state.runOpts[startAt] && rig.state.runOpts[startAt].timeoutMs, 123456, 'B107 本地命令带着写层注入的超时预算')
  }

  {
    const failLocal = makeRig({ runPinned: async function (args) { if (args.join(' ') === 'maintenance start') return { kind: 'non-zero', exitCode: 128, stdout: '', stderr: 'fatal: 系统调度任务装不上\n' }; return null } })
    const pre = await failLocal.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-enable' })
    const bad = await failLocal.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'maintenance-enable', ticketId: pre.ticket.id, requestId: 'r12', confirmed: true })
    eq(bad.ok, false, 'B108 本地维护命令失败时如实报错')
    eq(bad.error.kind, 'git-failed', 'B109 本地命令失败的失败类型是 git-failed')
    has(String(bad.error && bad.error.message), 'fatal: 系统调度任务装不上', 'B110 失败信封带 git 原话')
    eq(bad.step, 'maintenance start', 'B111 失败信封点名是哪一步')
  }

  {
    const disableRig = makeRig({ repos: 'C:/repo\n', maintConfig: 'maintenance.gc.enabled true\n' })
    const pre = await disableRig.check.handleMaintenanceCheck({ cwd: 'C:/repo', op: 'maintenance-disable' })
    const off = await disableRig.write.handleMaintenanceWrite({ cwd: 'C:/repo', op: 'maintenance-disable', ticketId: pre.ticket.id, requestId: 'r13', confirmed: true })
    eq(off.ok, true, 'B112 关闭自动维护能成功')
    eq(JSON.stringify(off.argv), JSON.stringify([['maintenance', 'stop'], ['maintenance', 'unregister']]), 'B113 关闭按 stop 再 unregister 顺序执行')
    check(disableRig.state.runCalls.some(function (a) { return a.join(' ') === 'maintenance stop' }) && disableRig.state.runCalls.some(function (a) { return a.join(' ') === 'maintenance unregister' }), 'B114 两条本地命令都跑过')
  }
  console.log('  B 组完成：' + total + ' 条')

  // ---------- C 组：真临时 git 仓库（真读数、真备份、真拒绝；长任务用假通道接收） ----------
  const commands = await loadModule('src/shared/version-control/src/commands.js')
  const backupMod = await loadModule('src/host/versionControlBackup.js')
  const gitHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-maint-home-'))
  const gitEnv = Object.assign({}, process.env, { HOME: gitHome, USERPROFILE: gitHome, GIT_EDITOR: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
  function gitRaw(cwd, args) {
    const full = ['-C', cwd].concat(commands.fixedPrefix(), args)
    return cp.spawnSync('git', full, { cwd: cwd, env: gitEnv, encoding: 'utf8' })
  }
  function gitText(cwd, args) { const r = gitRaw(cwd, args); return String(r.stdout || '') }
  function gitMust(cwd, args) {
    const r = gitRaw(cwd, args)
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' 失败：' + String(r.stderr || r.stdout))
    return String(r.stdout || '')
  }
  const realCleanup = []
  function mkRepo(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-maint-c-' + tag + '-')).replace(/\\/g, '/')
    realCleanup.push(dir)
    gitMust(dir, ['init', '-q', '-b', 'main'])
    gitMust(dir, ['config', 'user.name', '测试用户'])
    gitMust(dir, ['config', 'user.email', 'test@example.com'])
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    // 先放一份几十 KB 的确定内容：count-objects 的 size 单位是 KiB，小仓库会被取整成 0，
    // 夹具里留一个真实体积才能断言「仓库体积大于零」这条读数真的算出来了。
    fs.writeFileSync(path.join(dir, 'bulk.txt'), crypto.randomBytes(64 * 1024).toString('hex') + '\n')
    gitMust(dir, ['add', '--', 'a.txt', 'bulk.txt'])
    gitMust(dir, ['commit', '-q', '-m', 'first'])
    return dir
  }
  function realScreenOf(cwd) {
    const head = gitText(cwd, ['rev-parse', 'HEAD']).trim()
    const flag = function (rel) { return fs.existsSync(path.join(cwd, rel)) }
    const staged = []
    const unstaged = []
    let conflictCount = 0
    String(gitText(cwd, ['status', '--porcelain=v1'])).replace(/\r/g, '').split('\n').forEach(function (line) {
      if (line.length < 3) return
      const x = line.charAt(0)
      const y = line.charAt(1)
      const rel = line.slice(3)
      if ('AU UD UA DU AA UU DD'.split(' ').indexOf(x + y) >= 0) { conflictCount += 1; return }
      if (x !== ' ' && x !== '?') staged.push({ path: rel })
      if (y !== ' ' && y !== '?') unstaged.push({ path: rel })
      if (x === '?' && y === '?') unstaged.push({ path: rel })
    })
    return { ok: true, screen: { identity: { oid: head }, repo: { merging: flag('.git/MERGE_HEAD'), rebasing: flag('.git/rebase-merge') || flag('.git/rebase-apply'), cherryPicking: flag('.git/CHERRY_PICK_HEAD'), reverting: flag('.git/REVERT_HEAD') }, staged: staged, unstaged: unstaged, conflictCount: conflictCount } }
  }
  function makeRealRig(cwd, over) {
    const o = over || {}
    const state = { taskStarts: [], backups: [] }
    async function runPinned(exe, dir, args, opts) {
      const r = gitRaw(dir, args)
      const stdout = String(r.stdout || '')
      const stderr = String(r.stderr || '')
      if (r.status === 0) return { kind: 'ok', stdout: stdout, stderr: stderr }
      return { kind: 'non-zero', exitCode: r.status === null ? 1 : r.status, stdout: stdout, stderr: stderr }
    }
    const deps = {
      runPinned: runPinned,
      resolveGitExecutable: async function () { return 'git' },
      resolveRepoRoot: async function () { return o.bare ? { ok: true, root: cwd, kind: 'bare' } : { ok: true, root: cwd, kind: 'worktree' } },
      readScreenOf: async function () { return realScreenOf(cwd) },
      fs: { statfs: async function () { return { bsize: 4096, bavail: 262144 } } },
      now: function () { return Date.now() },
      readTimeoutMs: 30000,
    }
    const read = readMod.createMaintenanceRead(deps)
    const check = checkMod.createMaintenanceCheck({ read: read, failPhone: envelope.failPhone, now: function () { return Date.now() }, randomId: function () { return 'rc-' + Math.random().toString(36).slice(2, 10) } })
    const backup = backupMod.createBackupRunner({ runPinned: runPinned, now: function () { return Date.now() }, writeTimeoutMs: 120000, failurePrefix: '整仓备份失败，已中止清理（测试）：' })
    const write = writeMod.createMaintenanceWrite({
      read: read,
      failPhone: envelope.failPhone,
      runPinned: runPinned,
      taskStart: async function (req) { state.taskStarts.push(req); return { ok: true, task: { id: 'task-real-1', op: req.op } } },
      backup: backup,
      now: function () { return Date.now() },
      tickets: check.tickets,
      results: check.results,
    })
    return { read: read, check: check, write: write, state: state }
  }

  {
    const dir = mkRepo('read')
    const rig = makeRealRig(dir)
    const objs = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'objects' })
    eq(objs.ok, true, 'C1 真仓库对象读数能读出来')
    check(objs.looseCount >= 1, 'C2 真仓库有松散对象')
    check(objs.repoSizeBytes > 0, 'C3 仓库体积大于零')
    const none = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'unreachable' })
    eq(none.count, 0, 'C4 没有不可达对象时计数为零')
    fs.writeFileSync(path.join(dir, 'dangling.txt'), 'dangling\n')
    const oid = gitMust(dir, ['hash-object', '-w', 'dangling.txt']).trim()
    const un = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'unreachable' })
    check(un.count >= 1, 'C5 fsck --unreachable 能列出悬空对象')
    check(un.items.some(function (it) { return it.oid === oid }), 'C6 悬空对象的提交号在清单里')
    eq(un.looseFound >= 1, true, 'C7 悬挂 blob 是松散对象，读得到时间')
    check(typeof un.earliestAtMs === 'number', 'C8 悬空对象带最早时间')
    const pv = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'prune-preview' })
    check(pv.count >= 1, 'C9 prune -n -v 能列出会被删的对象')
    check(pv.items.some(function (it) { return it.oid === oid }), 'C10 预演清单里有那个悬空对象')
    const cgBefore = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'commit-graph' })
    eq(cgBefore.supported, true, 'C11 提交图在当前 git 版本受支持')
    eq(cgBefore.exists, false, 'C12 没写过提交图时文件不存在')
    gitMust(dir, ['commit-graph', 'write', '--reachable'])
    const cgAfter = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'commit-graph' })
    eq(cgAfter.exists, true, 'C13 写过之后文件真的存在')
    eq(cgAfter.verifyOk, true, 'C14 提交图校验通过')
    check(cgAfter.bytes > 0, 'C15 提交图有实际字节数')
    const miBefore = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'multi-pack-index' })
    eq(miBefore.supported, true, 'C16 多包索引在当前 git 版本受支持')
    eq(miBefore.exists, false, 'C17 没写过多包索引时文件不存在')
    gitMust(dir, ['repack', '-a', '-d'])
    gitMust(dir, ['multi-pack-index', 'write'])
    const miAfter = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'multi-pack-index' })
    eq(miAfter.exists, true, 'C18 写过之后多包索引文件存在')
    eq(miAfter.verifyOk, true, 'C19 多包索引校验通过')
    const prBefore = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'pack-refs' })
    check(prBefore.looseRefCount >= 1, 'C20 打包前有松散引用文件')
    gitMust(dir, ['pack-refs', '--all'])
    const prAfter = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'pack-refs' })
    eq(prAfter.packedRefsExists, true, 'C21 打包后 packed-refs 文件出现')
    check(prAfter.packedRefCount >= 1, 'C22 packed-refs 里数出引用条数')
    eq(prAfter.looseRefCount, 0, 'C23 打包后松散引用清零')
    const msBefore = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'maintenance-status' })
    eq(msBefore.registered, false, 'C24 未登记后台维护时状态为否')
    gitMust(dir, ['maintenance', 'register'])
    const msReg = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'maintenance-status' })
    eq(msReg.registeredLocal, true, 'C25 登记后本地仓库出现在维护清单里')
    gitMust(dir, ['maintenance', 'unregister'])
    const msOff = await rig.check.handleMaintenanceRead({ cwd: dir, op: 'maintenance-status' })
    eq(msOff.registered, false, 'C26 注销后回到未登记')
    const scene = await rig.read.sceneOf(dir)
    eq(scene.ok, true, 'C27 真仓库量现场成功')
    eq(scene.scene.branch, 'main', 'C28 现场分支是 main')
    eq(scene.scene.dirty, true, 'C29 有未跟踪的测试文件判脏（悬空对象文件还留在工作区）')
    eq(scene.scene.operation, null, 'C30 干净仓库没有进行中操作')
    eq(scene.scene.headOid, gitText(dir, ['rev-parse', 'HEAD']).trim(), 'C31 现场 HEAD 与真仓库一致')
    eq(scene.scene.gitVersion.indexOf('git version '), 0, 'C32 现场带完整 git 版本串')
    const bareRig = makeRealRig(dir, { bare: true })
    const bareOut = await bareRig.check.handleMaintenanceCheck({ cwd: dir, op: 'gc' })
    eq(bareOut.ok, false, 'C33 裸仓库拒绝维护动作')
    eq(bareOut.reason, 'repo-bare', 'C34 裸仓库的拒绝理由是 repo-bare')
    fs.mkdirSync(path.join(dir, '.git', 'rebase-merge'), { recursive: true })
    const busyScene = await rig.read.sceneOf(dir)
    eq(busyScene.scene.operation, 'rebase', 'C35 有变基目录时认得进行中的操作')
    const busyOut = await rig.check.handleMaintenanceCheck({ cwd: dir, op: 'gc' })
    eq(busyOut.reason, 'operation-in-progress', 'C36 变基进行中拒绝维护动作')
    fs.rmSync(path.join(dir, '.git', 'rebase-merge'), { recursive: true, force: true })
  }

  {
    const dir = mkRepo('exec')
    fs.writeFileSync(path.join(dir, 'dangling.txt'), 'dangling-2\n')
    const oid = gitMust(dir, ['hash-object', '-w', 'dangling.txt']).trim()
    const rig = makeRealRig(dir)
    const gcPre = await rig.check.handleMaintenanceCheck({ cwd: dir, op: 'gc' })
    eq(gcPre.ok, true, 'C37 真仓库垃圾回收预检能签票')
    eq(gcPre.ticket.expiresAtMs - gcPre.ticket.checkedAtMs, 120000, 'C38 真仓库签的票同样一百二十秒')
    const gcDone = await rig.write.handleMaintenanceWrite({ cwd: dir, op: 'gc', ticketId: gcPre.ticket.id, requestId: 'cr1', confirmed: true })
    eq(gcDone.ok, true, 'C39 凭票执行垃圾回收成功')
    eq(rig.state.taskStarts.length, 1, 'C40 垃圾回收起了一条任务')
    eq(rig.state.taskStarts[0].op, 'gc', 'C41 任务是 gc')
    const prunePre = await rig.check.handleMaintenanceCheck({ cwd: dir, op: 'prune' })
    eq(prunePre.ok, true, 'C42 真仓库清除预检能签票')
    eq(prunePre.preview.count >= 1, true, 'C43 预检带上不可达对象个数')
    check(String(prunePre.backup.path).indexOf('-backup-') >= 0, 'C44 备份路径带 -backup-')
    check('mirror' === prunePre.backup.kind || 'bundle' === prunePre.backup.kind, 'C45 备份方式只有镜像克隆与整仓打包两种')
    const pruneDone = await rig.write.handleMaintenanceWrite({ cwd: dir, op: 'prune', ticketId: prunePre.ticket.id, requestId: 'cr2', confirmed: true })
    eq(pruneDone.ok, true, 'C46 备份成功后清除动作成功')
    check(fs.existsSync(pruneDone.backup.path), 'C47 备份真的落在磁盘上')
    check(pruneDone.backup.bytes > 0, 'C48 备份大小大于零')
    eq(JSON.stringify(pruneDone.steps), JSON.stringify(['backup', 'task']), 'C49 清除动作先备份再起任务')
    eq(rig.state.taskStarts.length, 2, 'C50 清除也起了一条任务')
    eq(rig.state.taskStarts[1].op, 'prune', 'C51 任务是 prune')
    has(pruneDone.backupSummary, '备份在', 'C52 回包带人话备份摘要')
    eq(pruneDone.backupRestoreSteps.length, 3, 'C53 回包带三步还原指引')
    fs.rmSync(pruneDone.backup.path, { recursive: true, force: true })
    fs.rmSync(pruneDone.backup.path + '.bundle', { recursive: true, force: true })
    const before = rig.state.taskStarts.length
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
    gitMust(dir, ['add', '--', 'a.txt'])
    const moved = await rig.write.handleMaintenanceWrite({ cwd: dir, op: 'prune', ticketId: prunePre.ticket.id, requestId: 'cr3', confirmed: true })
    eq(moved.reason, 'target-changed', 'C54 预检后工作区变了拒绝执行')
    eq(rig.state.taskStarts.length, before, 'C55 现场变了的拒绝不重复起任务')
    const fake = await rig.write.handleMaintenanceWrite({ cwd: dir, op: 'gc', ticketId: 'nope', requestId: 'cr4', confirmed: true })
    eq(fake.reason, 'ticket-missing', 'C56 真仓库里假票号被拒绝')
    check(String(oid).length === 40 || String(oid).length === 64, 'C57 真仓库对象号是完整长度')
  }

  {
    const dir = mkRepo('gate')
    const rig = makeRealRig(dir)
    const off = await rig.check.handleMaintenanceCheck({ cwd: dir, op: 'maintenance-disable' })
    eq(off.reason, 'nothing-to-do', 'C58 没登记的仓库不能关闭自动维护')
    const en = await rig.check.handleMaintenanceCheck({ cwd: dir, op: 'maintenance-enable' })
    eq(en.ok, true, 'C59 未登记仓库能签开启票')
    eq(en.backup === undefined || en.backup === null, true, 'C60 开启自动维护不需要备份计划')
    check(en.confirm && typeof en.confirm.what === 'string' && en.confirm.what.length > 0, 'C61 开启票带四段确认卡')
    const noCwd = await rig.check.handleMaintenanceCheck({ cwd: '', op: 'gc' })
    eq(noCwd.ok, false, 'C62 真仓库夹具里缺目录仍被拒绝')
    eq(noCwd.reason, 'bad-target', 'C63 缺目录的拒绝理由是 bad-target')
  }

  realCleanup.forEach(function (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* 已删就跳过 */ } })
  try { fs.rmSync(gitHome, { recursive: true, force: true }) } catch (e) { /* 已删就跳过 */ }


  // ---------- D 组：客户端三叶与词表（真求值叶子、真读生成后的词条表） ----------
  console.log('  D 组开始（客户端与词条）')
  const dH = function (tag: any, props: any, kids: any) { return { tag: tag, props: props, children: kids } }
  const dT = function (key: any, params: any) { return String(key) + (params ? ' ' + JSON.stringify(params) : '') }
  const dReact: any = { createElement: dH, useState: function (v: any) { return [v, function () {}] }, useEffect: function () {}, useRef: function (v: any) { return { current: v } }, useMemo: function (fn: any) { return fn() }, useCallback: function (fn: any) { return fn } }
  const maintMod = await loadModule('src/shared/version-control/src/maintenance-ops.js')
  const rewriteMod = await loadModule('src/shared/version-control/src/rewrite-ops.js')
  const dataSourceOf = function (): string { return spliceableJs('src/client/views/versionControl/vcMaintenanceData.ts') }
  const dataLeaf = compileFn(['h', 't', 'React', 'vcWriteErrFamilyOf', 'MAINTENANCE_OPS', 'REWRITE_FORMS'], dataSourceOf() + '\nreturn { VC_MAINTENANCE_PAGE_SOURCE: VC_MAINTENANCE_PAGE_SOURCE, VC_MAINTENANCE_PHONES: VC_MAINTENANCE_PHONES, VC_MAINTENANCE_ACTIONS: VC_MAINTENANCE_ACTIONS, VC_MAINTENANCE_VERSION_GATES: VC_MAINTENANCE_VERSION_GATES, VC_MAINTENANCE_DANGER_IDS: VC_MAINTENANCE_DANGER_IDS, VC_MAINTENANCE_DANGER_FORMS: VC_MAINTENANCE_DANGER_FORMS, VC_MAINTENANCE_PAGE_HINT: VC_MAINTENANCE_PAGE_HINT, vcMaintenanceCamelOf: vcMaintenanceCamelOf, vcMaintenanceOpMetaOf: vcMaintenanceOpMetaOf, vcMaintenanceOpLabelKeyOf: vcMaintenanceOpLabelKeyOf, vcMaintenanceOpVerbKeyOf: vcMaintenanceOpVerbKeyOf, vcMaintenanceOpsOfPage: vcMaintenanceOpsOfPage, vcMaintenanceVisibleOf: vcMaintenanceVisibleOf, vcMaintenanceRequestIdOf: vcMaintenanceRequestIdOf, vcMaintenanceReadArgsOf: vcMaintenanceReadArgsOf, vcMaintenanceCheckArgsOf: vcMaintenanceCheckArgsOf, vcMaintenanceWriteArgsOf: vcMaintenanceWriteArgsOf, vcMaintenanceTaskArgsOf: vcMaintenanceTaskArgsOf, vcMaintenanceReplyKindOf: vcMaintenanceReplyKindOf, vcMaintenanceReasonOf: vcMaintenanceReasonOf, vcMaintenanceTicketOf: vcMaintenanceTicketOf, vcMaintenanceConfirmOf: vcMaintenanceConfirmOf, vcMaintenanceBackupOf: vcMaintenanceBackupOf, vcMaintenancePreviewOf: vcMaintenancePreviewOf, vcMaintenanceObjectsOf: vcMaintenanceObjectsOf, vcMaintenanceStatusOf: vcMaintenanceStatusOf, vcMaintenanceTaskOf: vcMaintenanceTaskOf, vcMaintenanceBackupPointOf: vcMaintenanceBackupPointOf, vcMaintenanceBackupSummaryOf: vcMaintenanceBackupSummaryOf, vcMaintenanceRestoreStepsOf: vcMaintenanceRestoreStepsOf, vcMaintenanceStateOf: vcMaintenanceStateOf, vcMaintenanceTaskConclusionOf: vcMaintenanceTaskConclusionOf, vcMaintenanceTaskEndedOf: vcMaintenanceTaskEndedOf, vcMaintenanceProgressOf: vcMaintenanceProgressOf, vcMaintenanceFailTextOf: vcMaintenanceFailTextOf };')(dH, dT, dReact, function () { return 'notReady' }, maintMod.MAINTENANCE_OPS, rewriteMod.REWRITE_FORMS)
  // 维护页叶子与它依赖的数据叶子拼在一起求值：页面里的危险区常量真来自共享动作表，不是测试另喂一份。
  const pageParams = ['h', 't', 'React', 'vcWriteErrFamilyOf', 'humanBytesOf', 'Tip', 'vcTaskRowNode', 'MAINTENANCE_OPS', 'REWRITE_FORMS']
  const pageLeafOf = function (opsList: any[], formsList: any[]): any {
    const body = dataSourceOf() + '\n' + spliceableJs('src/client/views/versionControl/vcMaintenancePage.ts') + '\nreturn { VC_MAINTENANCE_PAGE_BODY_SOURCE: VC_MAINTENANCE_PAGE_BODY_SOURCE, VC_MAINTENANCE_PAGE_WRITES: VC_MAINTENANCE_PAGE_WRITES, VC_MAINTENANCE_PAGE_READS: VC_MAINTENANCE_PAGE_READS, VC_MAINTENANCE_PAGE_DANGER: VC_MAINTENANCE_PAGE_DANGER, VC_MAINTENANCE_PAGE_DANGER_FORMS: VC_MAINTENANCE_PAGE_DANGER_FORMS, vcMaintenancePageNode: vcMaintenancePageNode };'
    return compileFn(pageParams, body)(dH, dT, dReact, function () { return 'notReady' }, function (n: any) { return String(n || 0) + ' B' }, dH, null, opsList, formsList)
  }
  const pageLeaf = pageLeafOf(maintMod.MAINTENANCE_OPS, rewriteMod.REWRITE_FORMS)
  const diagLeaf = compileFn(['h', 't', 'React', 'vcTaskRowNode', 'Tip', 'VC_TASK_POLL_INTERVAL_MS'], spliceableJs('src/client/views/versionControl/vcMaintenanceDiag.ts') + '\nreturn { VC_MAINTENANCE_DIAG_SOURCE: VC_MAINTENANCE_DIAG_SOURCE, VC_MAINTENANCE_DIAG_TASKS: VC_MAINTENANCE_DIAG_TASKS, VC_MAINTENANCE_DIAG_ITEM_LIMIT: VC_MAINTENANCE_DIAG_ITEM_LIMIT, VC_MAINTENANCE_DIAG_EXITS: VC_MAINTENANCE_DIAG_EXITS, vcMaintenanceDiagNode: vcMaintenanceDiagNode };')(dH, dT, dReact, null, dH, 5000)
  const reconcileMaint = function (viewOps: any[], protoOps: any[]): string[] {
    const issues: string[] = []
    if (viewOps.length !== protoOps.length) issues.push('件数 ' + viewOps.length + ' 不等于 ' + protoOps.length)
    const byOp: any = {}
    viewOps.forEach(function (o: any) { byOp[o.op] = o })
    protoOps.forEach(function (p: any) {
      const v: any = byOp[p.id]
      if (!v) { issues.push('缺 ' + p.id); return }
      if (String(v.capId) !== String(p.capId)) issues.push(p.id + ' 能力号')
      if (String(v.kind) !== String(p.kind)) issues.push(p.id + ' 种类')
      if ((v.dangerous === true) !== (p.dangerous === true)) issues.push(p.id + ' 危险标记')
      if ((v.confirm === true) !== (p.confirm === true)) issues.push(p.id + ' 确认标记')
      if ((v.requiresBackup === true) !== (p.requiresBackup === true)) issues.push(p.id + ' 备份标记')
    })
    return issues
  }
  eq(dataLeaf.VC_MAINTENANCE_PHONES.read, 'wf.gitMaintenanceRead', 'D1 读数电话名与宿主注册一致')
  eq(dataLeaf.VC_MAINTENANCE_PHONES.check, 'wf.gitMaintenanceCheck', 'D2 预检电话名与宿主注册一致')
  eq(dataLeaf.VC_MAINTENANCE_PHONES.write, 'wf.gitMaintenanceWrite', 'D3 执行电话名与宿主注册一致')
  check(dataLeaf.VC_MAINTENANCE_PHONES.taskStart === 'wf.gitTaskStart' && dataLeaf.VC_MAINTENANCE_PHONES.taskQuery === 'wf.gitTaskQuery' && dataLeaf.VC_MAINTENANCE_PHONES.taskCancel === 'wf.gitTaskCancel', 'D4 长任务三条电话复用任务通道已有的名字（不另造一套）')
  eq(dataLeaf.VC_MAINTENANCE_ACTIONS.length, 16, 'D5 界面动作模型镜像 16 条能力')
  const dIssues = reconcileMaint(dataLeaf.VC_MAINTENANCE_ACTIONS, maintMod.MAINTENANCE_OPS)
  eq(dIssues.length, 0, 'D6 界面动作模型与共享协议逐条对账零问题：' + JSON.stringify(dIssues.slice(0, 3)))
  eq(JSON.stringify(dataLeaf.VC_MAINTENANCE_ACTIONS.map(function (a: any) { return a.op })), JSON.stringify(maintMod.MAINTENANCE_OPS.map(function (a: any) { return a.id })), 'D7 16 条动作顺序与共享协议一字不差')
  const expectedDangerIds: string[] = maintMod.MAINTENANCE_OPS.filter(function (o: any) { return o.dangerous === true }).map(function (o: any) { return String(o.id) })
  const expectedFormIds: string[] = rewriteMod.REWRITE_FORMS.filter(function (f: any) { return f.dangerous === true }).map(function (f: any) { return String(f.id) })
  eq(JSON.stringify(dataLeaf.VC_MAINTENANCE_DANGER_IDS), JSON.stringify(expectedDangerIds), 'D8 危险区动作从共享动作表派生（实测 ' + JSON.stringify(expectedDangerIds) + '）')
  eq(JSON.stringify(dataLeaf.VC_MAINTENANCE_DANGER_FORMS.map(function (f: any) { return String(f.id) })), JSON.stringify(expectedFormIds), 'D8b 危险区重写表单从共享表单表派生（实测 ' + JSON.stringify(expectedFormIds) + '）')
  const dangerRows = maintMod.MAINTENANCE_OPS.filter(function (o: any) { return o.dangerous === true }).map(function (o: any) { return ledger.CAPABILITIES.filter(function (c: any) { return c.id === o.capId })[0] }).concat(rewriteMod.REWRITE_FORMS.filter(function (f: any) { return f.dangerous === true }).map(function (f: any) { return ledger.CAPABILITIES.filter(function (c: any) { return c.id === f.capId })[0] }))
  check(dangerRows.length > 0 && dangerRows.every(function (row: any) { return row && row.level === '毁' }), 'D8c 危险区每一条在能力账本里都是毁级动作（实测 ' + dangerRows.length + ' 条）')
  eq(JSON.stringify(dataLeaf.VC_MAINTENANCE_VERSION_GATES), JSON.stringify(maintMod.MAINTENANCE_VERSION_HIDE), 'D9 版本门与共享协议同源（不抄两份数字）')
  eq(dataLeaf.vcMaintenanceVisibleOf(dataLeaf.vcMaintenanceOpMetaOf('commit-graph'), 'git version 2.17.0'), false, 'D10 版本不到 2.18 时提交图能力不可见')
  eq(dataLeaf.vcMaintenanceVisibleOf(dataLeaf.vcMaintenanceOpMetaOf('commit-graph'), 'git version 2.18.0'), true, 'D11 刚好 2.18 时提交图能力可见')
  eq(dataLeaf.vcMaintenanceOpsOfPage('diagnostics').length, 4, 'D12 诊断页四条动作（11.2/11.3 两条认 + 11.4 读数）')
  eq(dataLeaf.vcMaintenanceOpsOfPage('maintenance').length, 12, 'D13 维护页十二条动作')
  const dRid = dataLeaf.vcMaintenanceRequestIdOf(1000, 'a b!')
  check(/^m[0-9a-z]+(-[A-Za-z0-9]{1,12})?$/.test(dRid), 'D14 请求号形状合规（实测 ' + dRid + '）')
  eq(JSON.stringify(dataLeaf.vcMaintenanceReadArgsOf('D:/w', 'objects')), JSON.stringify({ cwd: 'D:/w', op: 'objects' }), 'D15 只读参数整形状')
  eq(JSON.stringify(dataLeaf.vcMaintenanceCheckArgsOf('D:/w', 'gc')), JSON.stringify({ cwd: 'D:/w', op: 'gc' }), 'D16 预检参数整形状')
  eq(JSON.stringify(dataLeaf.vcMaintenanceCheckArgsOf('D:/w', 'fsck-unreachable')), JSON.stringify({ cwd: 'D:/w', op: 'fsck-unreachable' }), 'D17 预检参数按动作整形状')
  eq(JSON.stringify(dataLeaf.vcMaintenanceWriteArgsOf('D:/w', 'gc', 'T1', 'r1')), JSON.stringify({ cwd: 'D:/w', op: 'gc', ticketId: 'T1', requestId: 'r1', confirmed: true }), 'D18 执行参数带票号与请求号，并显式确认')
  eq(JSON.stringify(dataLeaf.vcMaintenanceTaskArgsOf('D:/w', 'fsck-basic', 'r2')), JSON.stringify({ cwd: 'D:/w', op: 'fsck', args: { mode: 'default' }, confirm: true, requestId: 'r2' }), 'D19 默认完整性检查走任务通道的 fsck default 模式')
  eq(JSON.stringify(dataLeaf.vcMaintenanceTaskArgsOf('D:/w', 'fsck-unreachable', 'r3')), JSON.stringify({ cwd: 'D:/w', op: 'fsck', args: { mode: 'unreachable' }, confirm: true, requestId: 'r3' }), 'D20 找不可达对象走 fsck unreachable 模式')
  eq(dataLeaf.vcMaintenanceReplyKindOf({ ok: true, ticket: { id: 'x' } }), 'allow', 'D21 带票的成功回包归放行')
  eq(dataLeaf.vcMaintenanceReplyKindOf({ ok: true, readAtMs: 1 }), 'read', 'D22 只读回包归读数')
  eq(dataLeaf.vcMaintenanceReplyKindOf({ ok: false, decision: { verdict: 'block' }, reason: 'dirty-worktree' }), 'block', 'D23 现场闸拒绝归阻止')
  eq(dataLeaf.vcMaintenanceReplyKindOf({ ok: false, error: { kind: 'blocked', reason: 'x', message: 'm' } }), 'block', 'D24 失败类型是 blocked 时也归阻止')
  eq(dataLeaf.vcMaintenanceReasonOf({ ok: false, reason: 'dirty-worktree', error: { reason: 'dirty-worktree' } }), 'dirty-worktree', 'D25 失败理由优先从顶层读')
  eq(dataLeaf.vcMaintenanceReasonOf({ ok: false, error: { reason: 'ticket-expired' } }), 'ticket-expired', 'D26 顶层没有理由时从失败信封里读')
  eq(dataLeaf.vcMaintenanceTicketOf({ ok: true, ticket: { id: 'T9', expiresAtMs: 5 } }).id, 'T9', 'D27 票号从成功回包里取（被拦的回包没有票）')
  eq(JSON.stringify(dataLeaf.vcMaintenanceConfirmOf({ ok: true, confirm: { what: 'w' } })), JSON.stringify({ what: 'w' }), 'D28 确认卡原样交给界面')
  check(dataLeaf.vcMaintenanceBackupOf({ ok: true, backup: { required: true, path: 'D:/b' } }).path === 'D:/b', 'D29 备份计划从成功回包里取')
  check(dataLeaf.vcMaintenanceBackupPointOf({ ok: true, backup: { kind: 'mirror', path: 'D:/b', bytes: 10 } }).bytes === 10, 'D30 备份点从执行回包里取')
  check(String(dataLeaf.vcMaintenanceBackupSummaryOf({ ok: true, backupSummary: '备份在 D:/b' })).indexOf('备份在') >= 0, 'D31 备份摘要用宿主给的人话')
  eq(dataLeaf.vcMaintenanceRestoreStepsOf({ ok: true, backupRestoreSteps: ['一', '二', '三'] }).length, 3, 'D32 三步还原指引原样交给界面')
  eq(dataLeaf.vcMaintenanceTaskConclusionOf({ state: 'done' }), 'done', 'D33 任务结论成功')
  eq(dataLeaf.vcMaintenanceTaskConclusionOf({ state: 'failed' }), 'failed', 'D34 任务结论失败')
  eq(dataLeaf.vcMaintenanceTaskConclusionOf({ state: 'cancelled' }), 'cancelled', 'D35 任务结论被取消')
  eq(dataLeaf.vcMaintenanceTaskConclusionOf({ state: 'interrupted' }), 'interrupted', 'D36 任务结论进程中断（重启后如实说中断）')
  eq(dataLeaf.vcMaintenanceTaskEndedOf({ state: 'done' }), true, 'D37 结论落地后任务算结束（轮询可以停）')
  eq(dataLeaf.vcMaintenanceTaskEndedOf({ state: 'running' }), false, 'D38 还在跑的任务不算结束')
  eq(JSON.stringify(dataLeaf.vcMaintenanceProgressOf({ progress: { percent: 12, phase: 'p' } })), JSON.stringify({ percent: 12, phase: 'p', bytes: null, uncertain: false }), 'D39 进度读数整形状')
  eq(dataLeaf.vcMaintenanceProgressOf({ progress: { phase: 'p', bytes: 9 } }).uncertain, true, 'D40 解析不出百分比就如实标不确定')
  check(String(dataLeaf.vcMaintenanceFailTextOf(dT, { ok: false, error: { kind: 'blocked', reason: 'dirty-worktree', message: '脏', hint: 'h' } }, function (r: any) { return r === 'dirty-worktree' ? 'notNow' : 'other' })).indexOf('vc.maintenance.fail.notNow') >= 0, 'D41 失败话术按理由族走词条，不拼字符串')
  eq(JSON.stringify(pageLeaf.VC_MAINTENANCE_PAGE_WRITES), JSON.stringify(['gc', 'maintenance-run', 'maintenance-enable', 'maintenance-disable']), 'D42 维护页写动作四条（prune 移到独立危险区）')
  eq(JSON.stringify(pageLeaf.VC_MAINTENANCE_PAGE_READS), JSON.stringify(['repack', 'commit-graph', 'multi-pack-index', 'pack-refs', 'maintenance-status']), 'D43 维护页只读动作五条')
  eq(JSON.stringify(pageLeaf.VC_MAINTENANCE_PAGE_DANGER), JSON.stringify(expectedDangerIds), 'D44 维护页危险区动作与共享动作表同源')
  eq(JSON.stringify(pageLeaf.VC_MAINTENANCE_PAGE_DANGER_FORMS.map(function (f: any) { return String(f.id) })), JSON.stringify(expectedFormIds), 'D44b 维护页危险区收下 5.11 五张重写表单（与共享表单表同源）')
  eq(JSON.stringify(diagLeaf.VC_MAINTENANCE_DIAG_TASKS), JSON.stringify(['fsck-basic', 'fsck-unreachable']), 'D45 诊断页两条完整性检查走任务通道')
  eq(JSON.stringify(diagLeaf.VC_MAINTENANCE_DIAG_EXITS), JSON.stringify(['branch', 'offline']), 'D46 不可达对象给两个出口：从这里建分支、导出离线包')
  eq(diagLeaf.VC_MAINTENANCE_DIAG_ITEM_LIMIT, 100, 'D47 不可达清单一次最多列一百条（不把整库倒进界面）')
  const pageSrc = sourceText('src/client/views/versionControl/vcMaintenancePage.ts')
  check(pageSrc.indexOf("'data-vc-maint-page'") >= 0 && pageSrc.indexOf("'data-vc-maint-action'") >= 0 && pageSrc.indexOf("'data-vc-maint-confirm'") >= 0 && pageSrc.indexOf("'data-vc-maint-result'") >= 0, 'D48 维护页正文带页面/动作/确认卡/结果四类锚点')
  check(pageSrc.indexOf("data-vc-maint-confirm-seg") >= 0 && pageSrc.indexOf("'what'") >= 0 && pageSrc.indexOf("'wont'") >= 0 && pageSrc.indexOf("'reversible'") >= 0, 'D49 确认卡四段在正文里各有段落锚点')
  const nodesOfTree = function (node: any, out: any[]): any[] {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) { node.forEach(function (kid: any) { nodesOfTree(kid, out) }); return out }
    if (typeof node !== 'object') return out
    if (node.props) out.push(node)
    nodesOfTree(node.children, out)
    return out
  }
  const dangerFactsOf = function (entry: any): string[] {
    return nodesOfTree(entry, []).map(function (n: any) { return n.props['data-vc-maint-danger-fact'] }).filter(function (x: any) { return !!x })
  }
  const dangerProblemsOf = function (tree: any, formIds: string[]): string[] {
    const all = nodesOfTree(tree, [])
    const problems: string[] = []
    const has = function (name: string) { return all.some(function (n: any) { return n.props[name] === '1' }) }
    if (!has('data-vc-maint-danger-section')) problems.push('no-section')
    if (!has('data-vc-maint-danger-title')) problems.push('no-title')
    if (!has('data-vc-maint-danger-boundary')) problems.push('no-boundary')
    const needFacts = ['loss', 'reversible', 'recovery', 'backup']
    const pruneEntry = all.filter(function (n: any) { return n.props['data-vc-maint-danger-entry'] === 'prune' })[0]
    if (!pruneEntry) problems.push('no-prune')
    else needFacts.forEach(function (k: string) { if (dangerFactsOf(pruneEntry).indexOf(k) < 0) problems.push('no-prune-fact:' + k) })
    formIds.forEach(function (id: string) {
      const entry = all.filter(function (n: any) { return n.props['data-vc-maint-danger-form'] === id })[0]
      if (!entry) { problems.push('no-form:' + id); return }
      needFacts.forEach(function (k: string) { if (dangerFactsOf(entry).indexOf(k) < 0) problems.push('no-form-fact:' + id + ':' + k) })
    })
    const jump = all.filter(function (n: any) { return n.props['data-vc-maint-danger-jump'] })[0]
    if (!jump || jump.props.href !== '#vc-rewrite-page') problems.push('no-jump')
    return problems
  }
  const renderedMaint = pageLeaf.vcMaintenancePageNode({ t: dT, cwd: 'D:/w', call: null })
  const dangerProblems = dangerProblemsOf(renderedMaint, expectedFormIds)
  eq(dangerProblems.length, 0, 'D50 危险区独立成块：标题 + 边界 + prune/五张重写各带四段后果 + 跳转锚点（实测问题 ' + JSON.stringify(dangerProblems.slice(0, 4)) + '）')
  const diagSrc = sourceText('src/client/views/versionControl/vcMaintenanceDiag.ts')
  check(diagSrc.indexOf("'data-vc-maint-diag-page'") >= 0 && diagSrc.indexOf("'data-vc-maint-exit'") >= 0 && diagSrc.indexOf("'data-vc-maint-unreachable'") >= 0, 'D51 诊断页正文带页面/出口/不可达清单锚点')
  check(diagSrc.indexOf('vcTaskRowNode') >= 0 && diagSrc.indexOf('VC_MAINTENANCE_PHONES.taskStart') >= 0, 'D52 诊断页两条检查复用任务区行与任务通道电话')
  const logSource = sourceText('src/client/views/versionControl/vcMaintenancePage.ts') + '\n' + sourceText('src/client/views/versionControl/vcMaintenanceDiag.ts')
  const logLiterals = (logSource.match(/'(vc\.maint\.[^']*)'/g) || []).map(function (x: any) { return String(x).replace(/'/g, '') })
  const badLogKeys = logLiterals.filter(function (k: any) { return !/^vc\.maint\.[a-z0-9.\-]*$/.test(k) })
  check(logLiterals.length >= 6 && badLogKeys.length === 0, 'D53 可点控件的 data-log 名字都在小写字母数字点横线范围内（实测 ' + logLiterals.length + ' 个，违规 ' + JSON.stringify(badLogKeys.slice(0, 3)) + '）')
  check(pageSrc.indexOf("'data-press'") >= 0 && diagSrc.indexOf("'data-press'") >= 0, 'D54 可点控件都带 data-press（界面反馈靠它分类）')
  const cleanPage = stripComments(pageSrc); const cleanDiag = stripComments(diagSrc); const cleanData = stripComments(sourceText('src/client/views/versionControl/vcMaintenanceData.ts'))
  check(!/[\u4e00-\u9fa5]/.test(cleanPage) && !/[\u4e00-\u9fa5]/.test(cleanDiag) && !/[\u4e00-\u9fa5]/.test(cleanData), 'D55 三片客户端叶子里没有中文字面量（可见文字全走词条）')
  const yamlText = fs.readFileSync(path.join(ROOT, 'config/copy/vcmaintenance.yaml'), 'utf8')
  const yamlKeys = yamlText.split('\n').filter(function (l: any) { return /^  [A-Za-z]/.test(l) }).map(function (l: any) { return l.trim().split(':')[0] })
  const yamlUniq: string[] = []
  yamlKeys.forEach(function (k: any) { if (yamlUniq.indexOf(k) < 0) yamlUniq.push(k) })
  check(yamlKeys.length === yamlUniq.length * 2, 'D56 词表每条键中英各一份（实测 ' + yamlKeys.length + ' 行 / ' + yamlUniq.length + ' 键）')
  check(yamlUniq.length >= 102 && yamlUniq.every(function (k: any) { return k.indexOf('vc.maintenance.') === 0 }), 'D57 词表至少一百零二条且都在 vc.maintenance. 前缀下（实测 ' + yamlUniq.length + ' 条）')
  const localeText = localeDataText()
  const missingLocale = yamlUniq.filter(function (k: any) { return localeText.indexOf("'" + k + "'") < 0 })
  eq(missingLocale.length, 0, 'D58 词表每条键都进了生成后的词条表：' + JSON.stringify(missingLocale.slice(0, 3)))
  const tKeysOf = function (src: string): string[] {
    const found: string[] = []
    const re = /(?:^|[^A-Za-z0-9_$.])t\('([^']+)'/g
    let m: any = re.exec(stripComments(src))
    while (m) { if (m[1].charAt(m[1].length - 1) !== '.') found.push(m[1]); m = re.exec(stripComments(src)) }
    return found
  }
  const usedKeys = tKeysOf(sourceText('src/client/views/versionControl/vcMaintenancePage.ts')).concat(tKeysOf(sourceText('src/client/views/versionControl/vcMaintenanceDiag.ts'))).concat(tKeysOf(sourceText('src/client/views/versionControl/vcMaintenanceData.ts')))
  const missingUsed = usedKeys.filter(function (k: any) { return yamlUniq.indexOf(k) < 0 })
  eq(missingUsed.length, 0, 'D59 三片叶子静态引用的词条都在真源里：' + JSON.stringify(missingUsed.slice(0, 3)))
  const opKeyMissing: string[] = []
  dataLeaf.VC_MAINTENANCE_ACTIONS.forEach(function (a: any) {
    const labelKey: string = String(dataLeaf.vcMaintenanceOpLabelKeyOf(a.op))
    const verbKey: string = String(dataLeaf.vcMaintenanceOpVerbKeyOf(a.op))
    if (yamlUniq.indexOf(labelKey) < 0) opKeyMissing.push(labelKey)
    if (yamlUniq.indexOf(verbKey) < 0) opKeyMissing.push(verbKey)
  })
  eq(opKeyMissing.length, 0, 'D60 十六条动作都有名字与动词词条：' + JSON.stringify(opKeyMissing.slice(0, 3)))
  const dCounter = dataLeaf.VC_MAINTENANCE_ACTIONS.filter(function (a: any) { return a.op !== 'prune' })
  const dCounterIssues = reconcileMaint(dCounter, maintMod.MAINTENANCE_OPS)
  check(dCounterIssues.length > 0 && dCounterIssues.join(',').indexOf('prune') >= 0, 'D61 反证自检：界面少登记一条动作时对账必须报错（实测 ' + JSON.stringify(dCounterIssues.slice(0, 2)) + '）')
  const noFormLeaf = pageLeafOf(maintMod.MAINTENANCE_OPS, rewriteMod.REWRITE_FORMS.map(function (f: any) { return Object.assign({}, f, { dangerous: false }) }))
  const noFormProblems = dangerProblemsOf(noFormLeaf.vcMaintenancePageNode({ t: dT, cwd: 'D:/w', call: null }), expectedFormIds)
  check(noFormProblems.indexOf('no-form:' + expectedFormIds[0]) >= 0, 'D62 反证自检：把 filter-repo 表单从危险区去掉，正文检查必须报缺表单（实测 ' + JSON.stringify(noFormProblems.slice(0, 3)) + '）')
  const noPruneLeaf = pageLeafOf(maintMod.MAINTENANCE_OPS.map(function (o: any) { return Object.assign({}, o, { dangerous: false }) }), rewriteMod.REWRITE_FORMS)
  const noPruneProblems = dangerProblemsOf(noPruneLeaf.vcMaintenancePageNode({ t: dT, cwd: 'D:/w', call: null }), expectedFormIds)
  check(noPruneProblems.indexOf('no-prune') >= 0, 'D62b 反证自检：把 prune 从危险区去掉，正文检查必须报缺 prune（实测 ' + JSON.stringify(noPruneProblems.slice(0, 3)) + '）')
  const dangerKeyMissing: string[] = []
  expectedDangerIds.forEach(function (id: any) {
    ;['loss', 'reversible', 'recovery', 'backup'].forEach(function (part: string) { const k: string = 'vc.maintenance.danger.' + id + '.' + part; if (yamlUniq.indexOf(k) < 0) dangerKeyMissing.push(k) })
  })
  expectedFormIds.forEach(function (id: any) {
    const camel: string = dataLeaf.vcMaintenanceCamelOf(id)
    const keys: string[] = ['vc.maintenance.danger.rewrite.loss.' + camel, 'vc.maintenance.danger.rewrite.reversible', 'vc.maintenance.danger.rewrite.recovery', 'vc.maintenance.danger.rewrite.backup']
    keys.forEach(function (k: string) { if (yamlUniq.indexOf(k) < 0) dangerKeyMissing.push(k) })
  })
  ;['vc.maintenance.danger.title', 'vc.maintenance.danger.boundary', 'vc.maintenance.danger.rewrite.title', 'vc.maintenance.danger.rewrite.goto'].forEach(function (k: string) { if (yamlUniq.indexOf(k) < 0) dangerKeyMissing.push(k) })
  eq(dangerKeyMissing.length, 0, 'D63 危险区每一条的四段后果与跳转都有中英词条：' + JSON.stringify(dangerKeyMissing.slice(0, 4)))
  console.log('  D 组完成：' + total + ' 条')
  console.log('  C 组完成：' + total + ' 条')


  // ---------- E 组：装配、七个登记点与源码断言（不碰真仓库、不起进程） ----------
  console.log('  E 组开始（登记点与源码断言）')
  const eMountSrc = sourceText('src/host/versionControlMaintenanceMount.ts')
  const eParentSrc = sourceText('src/host/versionControl.ts')
  const eIndexSrc = sourceText('src/host/index.ts')
  const eReadSrc = sourceText('src/host/versionControlMaintenanceRead.ts')
  const eCheckSrc = sourceText('src/host/versionControlMaintenanceCheck.ts')
  const eWriteSrc = sourceText('src/host/versionControlMaintenanceWrite.ts')
  const eBackupSrc = sourceText('src/host/versionControlBackup.ts')
  check(/export function createMaintenanceMount/.test(eMountSrc), 'E1 装配壳导出 createMaintenanceMount（父文件只多一行调用）')
  check(/versionControlMaintenanceRead/.test(eMountSrc) && /versionControlMaintenanceCheck/.test(eMountSrc) && /versionControlMaintenanceWrite/.test(eMountSrc), 'E2 装配壳懒加载三片宿主叶子')
  check(/loggedPhone\('wf\.gitMaintenanceRead', 'git-maintenance-read'/.test(eMountSrc) && /loggedPhone\('wf\.gitMaintenanceCheck', 'git-maintenance-check'/.test(eMountSrc) && /loggedPhone\('wf\.gitMaintenanceWrite', 'git-maintenance-write'/.test(eMountSrc), 'E3 三条电话都经统一日志出口包装（host.call / host.call.fail）')
  check(eMountSrc.indexOf('维护页这一层装配失败') >= 0 && /createBackupRunner/.test(eMountSrc), 'E4 装配失败有明确失败回包，危险动作的备份走共用备份装置')
  check(eParentSrc.indexOf('createMaintenanceMount') >= 0, 'E5 父文件 versionControl.ts 装配了维护页装配壳')
  check(['handleGitMaintenanceRead', 'handleGitMaintenanceCheck', 'handleGitMaintenanceWrite', 'maintenanceTickets'].every(function (k) { return eParentSrc.indexOf(k) >= 0 }), 'E6 父文件把三条电话与票表读取口都挂进出参对象')
  check(eIndexSrc.split("harness.handle('wf.gitMaintenanceRead'").length - 1 === 1 && eIndexSrc.split("harness.handle('wf.gitMaintenanceCheck'").length - 1 === 1 && eIndexSrc.split("harness.handle('wf.gitMaintenanceWrite'").length - 1 === 1, 'E7 宿主入口三条注册各一次（不多不少）')
  check(eIndexSrc.split('\n').length <= 400, 'E8 宿主入口物理行不超过四百行（实测 ' + eIndexSrc.split('\n').length + ' 行）')
  const eSettingsSrc = sourceText('tests/verify-settings-phones.ts')
  // 电话总数由 tests/verify-settings-phones.ts 钉住；别处加电话时这一条也要跟着改（#1776 M4b 加远端预检后 118 → 119，#1806 第 2 步加工作区记录两条后 119 → 121，第 3 步加查依据与并入上级两条后 121 → 123）。
  check(eSettingsSrc.indexOf('nPhones === 123') >= 0, 'E9 宿主电话总数登记为一百二十三条（维护页三条、#1776 M4b 的远端预检电话与 #1806 的四条工作区电话都算进去了）')
  const eTimeouts = fs.readFileSync(path.join(ROOT, 'config/timeouts.yaml'), 'utf8')
  check(/vcMaintenanceReadTimeoutMs: 30000/.test(eTimeouts) && /vcMaintenanceWriteTimeoutMs: 600000/.test(eTimeouts), 'E10 时间配置两条键带值（读 30 秒 / 写 10 分钟盖住整仓备份）')
  const eGen = sourceText('scripts/generate-time-config.mts')
  check(eGen.indexOf("'vcMaintenanceReadTimeoutMs', 'VC_MAINTENANCE_READ_TIMEOUT_MS'") >= 0 && eGen.indexOf("'vcMaintenanceWriteTimeoutMs', 'VC_MAINTENANCE_WRITE_TIMEOUT_MS'") >= 0, 'E11 生成器登记两条时间键（生成常量给源码用）')
  const eVtc = sourceText('tests/verify-time-config.ts')
  check(eVtc.indexOf('versionControlMaintenanceRead') >= 0 && eVtc.indexOf('versionControlMaintenanceWrite') >= 0, 'E12 时间配置门禁登记两个使用点（常量名与键名同源）')
  check(eReadSrc.indexOf('VC_MAINTENANCE_READ_TIMEOUT_MS') >= 0 && eReadSrc.indexOf('readTimeoutMs') >= 0, 'E13 读数叶子超时取生成常量，不写死数字')
  check(eWriteSrc.indexOf('VC_MAINTENANCE_WRITE_TIMEOUT_MS') >= 0, 'E14 执行叶子超时取生成常量')
  check(eWriteSrc.indexOf('backup.runBackup(') >= 0 && eWriteSrc.indexOf('backup.runBackup(') < eWriteSrc.indexOf('taskStart('), 'E15 执行叶子先做备份再起任务（顺序写死在源码里，备份失败走不到任务）')
  const eReasons = await loadModule('src/shared/version-control/src/write-reasons.js')
  check(typeof eReasons.WRITE_REASONS['bad-mode'] === 'string' && String(eReasons.writeHintFor('bad-mode')) !== String(eReasons.writeHintFor('unknown-write-failure')), 'E16 新增理由 bad-mode 有话术，且与兜底话术不同')
  const eVcWrite = sourceText('src/client/views/versionControl/vcWrite.ts')
  check(eVcWrite.indexOf("'bad-mode'") >= 0, 'E17 界面失败族映射登记了 bad-mode（失败话术同源）')
  const eLeaves = eReadSrc + '\n' + eCheckSrc + '\n' + eWriteSrc + '\n' + eMountSrc + '\n' + eBackupSrc
  check(!/child_process|spawnSync|execSync|\.spawn\(/.test(eLeaves), 'E18 维护页五片宿主叶子都不自己起进程（进程出口只有注入的 runPinned / subprocess）')
  const ePorts = sourceText('src/shared/version-control/src/ports.ts')
  check(ePorts.indexOf("export type WriteOp = 'commit' | 'pull' | 'push' | 'fetch' | ChangesWriteOp") >= 0, 'E19 共享 WriteOp 联合类型一个字都没改（维护动作走自己的动作表，不并进写票族）')
  const eTaskProto = await loadModule('src/shared/version-control/src/task-protocol.js')
  const eFsckDefault = eTaskProto.taskArgsFor('fsck', { args: { mode: 'default' } })
  check(eFsckDefault.ok === true && JSON.stringify(eFsckDefault.args) === JSON.stringify(['fsck', '--no-progress']), 'E20 默认完整性检查的 argv 是 fsck --no-progress')
  const eFsckUnreach = eTaskProto.taskArgsFor('fsck', { args: { mode: 'unreachable' } })
  check(eFsckUnreach.ok === true && JSON.stringify(eFsckUnreach.args) === JSON.stringify(['fsck', '--no-progress', '--unreachable']), 'E21 找不可达对象那档追加 --unreachable')
  const eFsckBad = eTaskProto.taskArgsFor('fsck', { args: { mode: 'lost-found' } })
  check(eFsckBad.ok === false && eFsckBad.reason === 'bad-mode', 'E22 不认识的 fsck 模式明确拒绝（不偷偷跑别的档）')
  check(eTaskProto.taskArgsFor('fsck', { args: { mode: 'unreachable' } }).args.indexOf('--lost-found') < 0, 'E23 任务通道里没有 --lost-found（会往 .git 写文件，不在面板跑）')
  const eSameLayer = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/same-layer-baseline.json'), 'utf8'))
  const eOwn = eSameLayer.entries.filter(function (x) { return String(x.owner || '').indexOf('#1758') >= 0 })
  check(eOwn.length === 6, 'E24 同层引用基线登记六条装配扇入（实测 ' + eOwn.length + ' 条）')
  const eOwnFiles = eOwn.map(function (x) { return String(x.file || '') + '>' + String(x.spec || '') }).join(',')
  check(eOwnFiles.indexOf('MaintenanceMount') >= 0 && eOwnFiles.indexOf('versionControlBackup') >= 0, 'E25 六条里既有装配扇入也有共用备份装置：' + eOwnFiles)
  const eSelf = fs.readFileSync(__filename, 'utf8')
  check(eSelf.indexOf('// 门禁归属: src/shared/version-control/src/maintenance-ops.ts') >= 0, 'E26 门禁文件头写明守的是哪份源码')
  check(eSelf.indexOf("const GATE = 'verify-1586-maintenance'") >= 0, 'E27 门禁名与登记脚本里的名字一致')
  check(dataLeaf.VC_MAINTENANCE_PAGE_SOURCE === 'src/client/views/versionControl/vcMaintenanceData.ts' && pageLeaf.VC_MAINTENANCE_PAGE_BODY_SOURCE === 'src/client/views/versionControl/vcMaintenancePage.ts' && diagLeaf.VC_MAINTENANCE_DIAG_SOURCE === 'src/client/views/versionControl/vcMaintenanceDiag.ts', 'E28 三片叶子各自登记自己那份源码路径（不许留旧名字）')
  check(eCheckSrc.indexOf('makeTicket(') >= 0 && eCheckSrc.indexOf('TICKET_MAX') >= 0, 'E29 预检叶子用共享票据工厂签票，票表有上限')
  const eWriteIds = ['gc', 'prune', 'maintenance-run', 'maintenance-enable', 'maintenance-disable']
  check(eWriteSrc.indexOf('maintenanceWriteOpOf(op)') >= 0 && eWriteSrc.indexOf('maintenanceTaskRequestOf(op)') >= 0 && eWriteSrc.indexOf('maintenanceLocalStepsOf(op)') >= 0, 'E30 执行叶子的动作分派接到共享动作表（五个写动作走同一张表，不各写一份判定分支）：' + eWriteIds.join(','))
  check(eReadSrc.indexOf('总览：维护页一次读完所有卡片要的读数') >= 0 && eReadSrc.indexOf('data = { ok: true, objects: objects, repack: repack, maintenance: status') >= 0, 'E31 总览读数一次合并三块，判定分支在读数叶子里')
  const eLedger = await loadModule('src/shared/version-control/src/capability-ledger.js')
  const eDomain11 = eLedger.CAPABILITIES.filter(function (c) { return /^11\.(?:[2-9]|10|11)$/.test(String(c.id)) })
  check(eDomain11.length === 10 && eDomain11.every(function (c) { return c.page === 'maintenance' || c.page === 'diagnostics' }), 'E32 账本里域 11 的十条能力都落在维护页或诊断页（实测 ' + eDomain11.length + ' 条）')
  const eHideIds = eDomain11.filter(function (c) { return c.versionPolicy === 'hide' }).map(function (c) { return String(c.id) }).sort()
  check(JSON.stringify(eHideIds) === JSON.stringify(Object.keys(maintMod.MAINTENANCE_VERSION_HIDE).sort()), 'E33 账本里有版本门的三条与共享协议同源：' + JSON.stringify(eHideIds))
  const eWriteOpsJudge = function (ids) {
    const want = ['gc', 'prune', 'maintenance-run', 'maintenance-enable', 'maintenance-disable']
    const issues = []
    want.forEach(function (id) { if (ids.indexOf(id) < 0) issues.push('缺 ' + id) })
    ids.forEach(function (id) { if (want.indexOf(id) < 0) issues.push('多 ' + id) })
    return issues
  }
  const eRealIds = maintMod.MAINTENANCE_WRITE_OPS.map(function (x) { return String(x.id) })
  check(eWriteOpsJudge(eRealIds).length === 0, 'E34 五个写动作清单与共享协议一致（不靠人工抄一遍）')
  const eWriteOpsCounter = eWriteOpsJudge(eRealIds.filter(function (x) { return x !== 'gc' }))
  check(eWriteOpsCounter.length > 0 && eWriteOpsCounter.join(',').indexOf('gc') >= 0, 'E35 反证自检：执行层少登记一条写动作时必须报错（实测 ' + JSON.stringify(eWriteOpsCounter) + '）')
  console.log('  E 组完成：' + total + ' 条')
}

main().then(function () { return printGateResult(GATE, total, failed) }).then(function () { process.exit(failed ? 1 : 0) }).catch(function (err) {
  console.log('  门禁自身抛错：' + (err && err.stack ? err.stack : String(err)))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
