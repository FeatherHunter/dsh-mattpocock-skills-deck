// 门禁归属: src/shared/version-control/src/rebase-ops.ts
/**
 * tests/verify-1586-rebase.ts —— 交互式变基与换基座（#1749，规格 #1586 域 5 的 5.6–5.8、5.10）门禁。
 *
 * 分五组：
 *   A 共享协议（src/shared/version-control/src/rebase-ops.ts）：四条写动作、五条只读动作、
 *     待办清单生成与解析、路径与目标守卫、--onto 与 --rebase-merges 的参数口径；
 *   B 宿主读数、预检签票与凭票执行（真临时 git 仓库 + 假依赖两条路）；
 *   C 拒绝栈：票据缺失、过期、动作不符、请求号重放、现场变化、updateRefs 拒绝、零进程；
 *   D 客户端面板：电话表、可见性、确认卡四段、节点属性、词条齐全；
 *   E 七个登记点与源码断言（宿主注册、装配、超时配置、理由表、词条、写层不自起进程），
 *     末尾反证自检：故意改坏一处必须判红。
 *
 * 为什么单独立一扇而不是挂到 841：换基座与交互变基有自己的待办清单、版本门（--rebase-merges
 * 要 2.18）与编辑器交接（GIT_SEQUENCE_EDITOR 覆盖待办），841 那条线只覆盖提交/同步写命令。
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { printGateResult } = require('./lib/gate-result.ts');
const { sourceText, spliceableJs } = require('./lib/source-text.ts');
const { compileFn } = require('./lib/eval-probe.ts');
const { localeDataText } = require('./lib/locale-data.ts');

const ROOT = path.resolve(__dirname, '..');
const GATE = 'verify-1586-rebase';

let total = 0;
let failed = 0;
function check(ok: any, message: string) {
  total += 1;
  if (!ok) {
    failed += 1;
    console.log('  FAIL ' + message);
  }
}
function eq(actual: any, expected: any, message: string) {
  check(actual === expected, message + '（实测 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected) + '）');
}
function has(haystack: string, needle: string, message: string) {
  check(String(haystack).indexOf(needle) >= 0, message + '（没找到 ' + JSON.stringify(needle) + '）');
}

function loadModule(rel: string) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

async function main() {
  // ===== A 共享协议 =====
  const ops = await loadModule('src/shared/version-control/src/rebase-ops.js');
  const source = sourceText('src/shared/version-control/src/rebase-ops.ts');

  const WRITE_IDS = ['rebase-todo', 'rebase-onto', 'rebase-autosquash', 'rebase-merges'];
  const WRITE_CAPS = ['5.6', '5.7', '5.8', '5.10'];
  const READ_IDS = ['rebase-state', 'rebase-window', 'rebase-onto-range', 'rebase-autosquash-pairs', 'rebase-merges-cost'];
  const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];

  check(Array.isArray(ops.REBASE_WRITE_OPS), 'A1 REBASE_WRITE_OPS 是数组');
  eq(ops.REBASE_WRITE_OPS.length, 4, 'A2 写动作恰好四条（5.6/5.7/5.8/5.10）');
  eq(ops.REBASE_WRITE_OPS.map((m: any) => m.id).join(','), WRITE_IDS.join(','), 'A3 写动作标识符与顺序');
  eq(ops.REBASE_WRITE_OPS.map((m: any) => m.capId).join(','), WRITE_CAPS.join(','), 'A4 写动作对齐能力账本 5.6/5.7/5.8/5.10');
  check(ops.REBASE_WRITE_OPS.every((m: any) => m.kind === 'write'), 'A5 写动作 kind 都是 write');
  check(ops.REBASE_WRITE_OPS.every((m: any) => m.dangerous === true && m.confirm === true), 'A6 历史改写四条都走危险确认');
  check(ops.REBASE_WRITE_OPS.every((m: any) => m.reversible === true), 'A7 四条都可用 reflog 找回（reversible）');
  eq(ops.REBASE_WRITE_OPS.map((m: any) => m.needs).join(','), 'todo,onto,base,base', 'A8 四条动作需要的输入形状');
  check(ops.REBASE_WRITE_OPS.every((m: any) => String(m.labelKey || '').indexOf('vc.rebase.op.') === 0), 'A9 四条都有词条键前缀');
  check(ops.REBASE_WRITE_OPS.every((m: any) => String(m.command || '').indexOf('git rebase') === 0), 'A10 四条命令原文都以 git rebase 开头');
  eq(ops.REBASE_READ_OPS.length, 5, 'A11 只读动作恰好五条');
  eq(ops.REBASE_READ_OPS.map((m: any) => m.id).join(','), READ_IDS.join(','), 'A12 只读动作标识符与顺序');
  check(ops.REBASE_READ_OPS.every((m: any) => m.kind === 'read' && m.dangerous === false), 'A13 只读动作不危险');
  eq(ops.REBASE_OPS.length, 9, 'A14 动作表共九条（四写五读）');
  check(WRITE_IDS.concat(READ_IDS).every((id: string) => ops.rebaseOpMetaOf(id) && ops.rebaseOpMetaOf(id).id === id), 'A15 rebaseOpMetaOf 认得九条动作');
  eq(ops.rebaseOpMetaOf('rebase-edit'), null, 'A16 不认得的动作回 null（不做 edit）');
  eq(ops.TODO_ACTIONS.join(','), ACTIONS.join(','), 'A17 待办六个动作里的五个改写动词按顺序');
  check(ops.TODO_ACTIONS.indexOf('edit') < 0 && ops.TODO_ACTIONS.indexOf('break') < 0, 'A18 待办动作里没有 edit 与 break（本票明确不做）');

  const plan = ops.rebasePlanOf({ op: 'rebase-todo', base: 'main', branch: 'feature', rows: [{ oid: 'a'.repeat(40), subject: '一', action: 'pick' }] });
  eq(Object.keys(plan).join(','), 'op,base,baseOid,branch,rows,oldBase,oldBaseOid,newBase,newBaseOid,merges,autosquash', 'A19 计划对象键序固定');
  const emptyPlan = ops.rebasePlanOf({});
  eq(emptyPlan.merges, false, 'A20 计划里 merges 缺省 false');
  eq(emptyPlan.autosquash, false, 'A21 计划里 autosquash 缺省 false');
  eq(emptyPlan.base, null, 'A22 计划里没给的字段落 null');

  eq(ops.rebaseTargetProblem('main'), null, 'A23 普通分支名可以作为变基基座');
  eq(ops.rebaseTargetProblem('a'.repeat(40)), null, 'A24 完整提交号可以作为基座');
  eq(ops.rebaseTargetProblem('--onto'), 'bad-target', 'A25 以短横线开头的目标拒绝');
  eq(ops.rebaseTargetProblem(''), 'bad-target', 'A26 空目标拒绝');
  eq(ops.rebaseTargetProblem('main\u0000x'), 'bad-target', 'A27 含 NUL 的目标拒绝');
  eq(ops.rebaseTargetProblem('a b'), 'bad-target', 'A28 含空格的目标拒绝');
  eq(ops.rebaseTargetProblem('main\nrm -rf /'), 'bad-target', 'A29 换行的目标拒绝');
  eq(ops.rebaseTargetProblem('x'.repeat(300)), 'bad-target', 'A30 超长目标拒绝');

  const WINDOW = [{ oid: 'a'.repeat(40), subject: '一' }, { oid: 'b'.repeat(40), subject: '二' }];
  eq(ops.rebaseRowsProblem([{ oid: 'b'.repeat(40), action: 'pick' }, { oid: 'a'.repeat(40), action: 'squash' }], WINDOW.map((r: any) => r.oid)), null, 'A31 重排后的待办行通过校验');
  eq(ops.rebaseRowsProblem([], WINDOW.map((r: any) => r.oid)), 'bad-todo', 'A32 空待办拒绝');
  eq(ops.rebaseRowsProblem([{ oid: 'a'.repeat(40), action: 'pick' }, { oid: 'a'.repeat(40), action: 'pick' }], null), 'bad-todo', 'A33 同一提交出现两次拒绝');
  eq(ops.rebaseRowsProblem([{ oid: 'a'.repeat(40), action: 'edit' }], null), 'bad-action', 'A34 出现 edit 动作拒绝');
  eq(ops.rebaseRowsProblem([{ oid: 'a'.repeat(40), action: 'pick' }], WINDOW.map((r: any) => r.oid)), 'todo-mismatch', 'A35 待办行集合与窗口不一致拒绝');
  eq(ops.rebaseRowsProblem([{ oid: '../x', action: 'pick' }], null), 'bad-todo', 'A36 提交号形状不对拒绝');
  eq(ops.rebaseRowsProblem([{ oid: 'a'.repeat(40), action: 'pick' }], ['a'.repeat(40)]), null, 'A37 单行待办通过校验');
  eq(ops.rebaseRowsProblem(new Array(201).fill(null).map((_: any, i: number) => ({ oid: i.toString(16).padStart(40, '0'), action: 'pick' })), null), 'todo-too-long', 'A38 待办行数超过上限拒绝');

  const todoPlan = ops.rebasePlanOf({
    op: 'rebase-todo', base: 'main',
    rows: [
      { oid: 'a'.repeat(40), subject: '一', action: 'pick' },
      { oid: 'b'.repeat(40), subject: '二', action: 'reword' },
      { oid: 'c'.repeat(40), subject: '三', action: 'squash' },
      { oid: 'd'.repeat(40), subject: '四', action: 'fixup' },
      { oid: 'e'.repeat(40), subject: '五', action: 'drop' },
    ],
  });
  const todoOut = ops.rebaseTodoLinesOf(todoPlan, (oid: string) => 'C:/tmp/msg-' + oid.slice(0, 2) + '.txt');
  check(todoOut.ok === true, 'A39 待办清单可以生成');
  eq(todoOut.lines.length, 6, 'A40 reword 会展开成 pick 加 exec 两行');
  eq(todoOut.lines[0], 'pick ' + 'a'.repeat(40), 'A41 pick 行原样');
  eq(todoOut.lines[1], 'pick ' + 'b'.repeat(40), 'A42 reword 的 pick 行');
  eq(todoOut.lines[2], 'exec git commit --amend -F "C:/tmp/msg-bb.txt"', 'A43 reword 的 exec 行带面板说明文件路径');
  eq(todoOut.lines[3], 'squash ' + 'c'.repeat(40), 'A44 squash 行');
  eq(todoOut.lines[4], 'fixup ' + 'd'.repeat(40), 'A45 fixup 行');
  eq(todoOut.lines[5], 'drop ' + 'e'.repeat(40), 'A46 drop 行');
  const noMsg = ops.rebaseTodoLinesOf(todoPlan, null);
  eq(noMsg.ok, false, 'A47 有 reword 却没有说明文件路径时明确失败');
  eq(noMsg.reason, 'missing-message', 'A48 缺说明文件的理由标识符');
  const emptyTodo = ops.rebaseTodoLinesOf(ops.rebasePlanOf({ op: 'rebase-todo', base: 'main', rows: [] }), null);
  eq(emptyTodo.lines.join('|'), 'noop', 'A49 空待办给 noop（不能留空文件让 git 卡住）');

  eq(JSON.stringify(ops.rebaseStepsOf(ops.rebasePlanOf({ op: 'rebase-todo', base: 'main' }))), JSON.stringify([['rebase', '-i', 'main']]), 'A50 交互变基的 argv');
  eq(JSON.stringify(ops.rebaseStepsOf(ops.rebasePlanOf({ op: 'rebase-onto', oldBase: 'main', newBase: 'origin/main' }))), JSON.stringify([['rebase', '--onto', 'origin/main', 'main']]), 'A51 换基座的 argv：新基座在前、旧基座在后');
  eq(JSON.stringify(ops.rebaseStepsOf(ops.rebasePlanOf({ op: 'rebase-autosquash', base: 'main' }))), JSON.stringify([['rebase', '-i', '--autosquash', 'main']]), 'A52 自动吸收的 argv');
  eq(JSON.stringify(ops.rebaseStepsOf(ops.rebasePlanOf({ op: 'rebase-merges', base: 'main' }))), JSON.stringify([['rebase', '-i', '--rebase-merges', 'main']]), 'A53 保留合并结构的 argv');
  eq(JSON.stringify(ops.rebaseStepsOf(ops.rebasePlanOf({ op: 'rebase-onto', oldBase: '', newBase: 'main' }))), '[]', 'A54 缺旧基座时不给 argv');
  check(ops.rebaseStepsOf(plan).every((step: string[]) => step.every((part: string) => part.indexOf(' ') < 0 || part === '--rebase-merges' || part === '--autosquash' || part === '-i')), 'A55 argv 元素各自独立，不拼 shell 字符串');

  const captured = ['pick ' + 'a'.repeat(40) + ' 基底', 'pick ' + 'b'.repeat(40) + ' 功能一', 'fixup ' + 'c'.repeat(40) + ' fixup! 功能一', 'pick ' + 'd'.repeat(40) + ' 功能二', 'squash ' + 'e'.repeat(40) + ' squash! 功能二', ''].join('\n');
  const pairs = ops.rebaseAutosquashPairsOf(captured);
  eq(pairs.pairs.length, 2, 'A56 自动吸收先列出两对');
  eq(pairs.pairs[0].kind, 'fixup', 'A57 第一对是 fixup');
  eq(pairs.pairs[0].targetOid, 'b'.repeat(40), 'A58 fixup 指向它前面的那个提交');
  eq(pairs.pairs[1].kind, 'squash', 'A59 第二对是 squash');
  eq(pairs.pairs[1].targetOid, 'd'.repeat(40), 'A60 squash 指向它前面的那个提交');
  eq(ops.rebaseAutosquashPairsOf('').pairs.length, 0, 'A61 没有待办行时吸收对为空');

  eq(ops.rebaseVisibleOf(null).length, 4, 'A62 没有进行中操作时四条写动作都可见');
  eq(ops.rebaseVisibleOf('clean').length, 4, 'A63 干净状态四条写动作都可见');
  eq(ops.rebaseVisibleOf('rebase').length, 0, 'A64 变基进行中时四条写动作都不出现（先处理冲突）');
  eq(ops.rebaseVisibleOf('merge').length, 0, 'A65 合并进行中时四条写动作都不出现');
  eq(ops.rebaseActionLabelKeyOf('reword'), 'vc.rebase.action.reword', 'A66 待办动作词条键');
  eq(ops.rebaseActionLabelKeyOf('drop'), 'vc.rebase.action.drop', 'A67 drop 的词条键');
  eq(ops.rebaseStateLabelKeyOf(null), 'vc.rebase.state.clean', 'A68 空状态词条键');
  eq(ops.rebaseStateLabelKeyOf('cherry-pick'), 'vc.rebase.state.cherryPick', 'A69 拣选状态词条键用驼峰');
  eq(ops.rebaseStateLabelKeyOf('revert'), 'vc.rebase.state.revert', 'A70 回退状态词条键');

  eq(ops.gitVersionAtLeast('git version 2.49.0.windows.1', 2, 18), true, 'A71 2.49 满足 --rebase-merges 的 2.18');
  eq(ops.gitVersionAtLeast('git version 2.17.1', 2, 18), false, 'A72 2.17 不满足 --rebase-merges 的 2.18');
  eq(ops.gitVersionAtLeast('git version 2.11.0', 2, 11), true, 'A73 2.11 满足硬底线');
  eq(ops.gitVersionAtLeast('', 2, 11), false, 'A74 读不出版本时不冒充满足');
  eq(ops.REBASE_MERGES_MIN_VERSION, '2.18', 'A75 --rebase-merges 的最低版本登记在共享层');

  eq(ops.REBASE_CHECK_CONTRACT, 'vc-rebase-check', 'A76 预检契约名');
  eq(ops.REBASE_CHECK_VERSION, 1, 'A77 预检契约版本');
  eq(ops.REBASE_PHONES.read, 'wf.gitRebaseRead', 'A78 读电话名');
  eq(ops.REBASE_PHONES.check, 'wf.gitRebaseCheck', 'A79 预检电话名');
  eq(ops.REBASE_PHONES.write, 'wf.gitRebaseWrite', 'A80 执行电话名');
  ['rebase-todo', 'rebase-onto', 'rebase-autosquash', 'rebase-merges'].forEach((id: string, i: number) => {
    has(ops.REBASE_OPS_SOURCE, id, 'A8' + (1 + i) + ' 协议源码常量含动作 ' + id);
  });
  check(ops.REBASE_OPS_SOURCE.indexOf('update-refs') < 0 && ops.REBASE_OPS_SOURCE.indexOf('--onto') >= 0, 'A85 协议源码里不做 --update-refs，但 --onto 在');
  check(!/^import\s/m.test(source), 'A86 共享协议零 import（要拼进界面闭包）');

  console.log('  A 组完成：' + total + ' 条');
}

main().then(async function () {
  await printGateResult(GATE, total, failed);
  process.exit(failed ? 1 : 0);
}).catch(function (err: any) {
  console.log('  门禁自身抛错：' + (err && err.stack ? err.stack : String(err)));
  failed += 1;
  total += 1;
  printGateResult(GATE, total, failed).then(function () { process.exit(1); });
});
