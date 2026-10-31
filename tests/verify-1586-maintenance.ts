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
}

main().then(function () { return printGateResult(GATE, total, failed) }).then(function () { process.exit(failed ? 1 : 0) }).catch(function (err) {
  console.log('  门禁自身抛错：' + (err && err.stack ? err.stack : String(err)))
  failed += 1
  printGateResult(GATE, total, failed)
  process.exit(1)
})
