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

  // ===== B 宿主预检与执行（假依赖，零进程拒绝栈） =====
  const envelopeMod = await loadModule('src/shared/version-control/exec-envelope.js')
  const ticketMod = await loadModule('src/shared/version-control/src/write-ticket.js')
  const reasonsMod = await loadModule('src/shared/version-control/src/write-reasons.js')
  const checkMod = await loadModule('src/host/versionControlRebaseCheck.js')
  const writeMod = await loadModule('src/host/versionControlRebaseWrite.js')
  const clock = { t: 1000 }
  function failPhone(kind: string, message: string, extra: any) { return Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {}) }
  const baseBindings = ticketMod.makeBindings({ preconditions: { planDigest: 'a'.repeat(16), worktreeDigest: 'b'.repeat(16), configOldValue: 'false', remoteOid: null, pathAbsent: [] }, counters: { indexEntries: null } })
  const GIT_VERSION = 'git version 2.49.0.windows.1'
  const BASE_OID = 'a'.repeat(40)
  const ROW_OID = 'c'.repeat(40)
  function sceneSummary(over: any) { return Object.assign({ repoRoot: 'C:/repo', headOid: BASE_OID, state: null, branch: 'main', updateRefs: false, gitVersion: GIT_VERSION }, over || {}) }
  function fakeScene(o: any) {
    const spec: any = o || {}
    const base: any = sceneSummary(spec.scene)
    const signBindings: any = spec.signBindings || baseBindings
    let measureCount = 0
    return {
      measure: async function () {
        measureCount += 1
        // 预检是第一次量现场，执行层复核是第二次；measureSecond 只从第二次起生效。
        // 这样夹具能造出「签票时干净、执行时现场变了」的真实时序，而不是预检就直接拦下。
        const w: any = (spec.measureSecond && measureCount >= 2) ? spec.measureSecond : spec
        if (spec.measureFail === true) return { ok: false, envelope: failPhone('blocked', 'target-changed', '读不回现场') }
        return {
          ok: true,
          repoRoot: w.measureRepoRoot || base.repoRoot,
          headOid: w.measureHeadOid || base.headOid,
          state: w.measureState !== undefined ? w.measureState : base.state,
          updateRefs: w.measureUpdateRefs !== undefined ? w.measureUpdateRefs : base.updateRefs,
          branch: base.branch,
          gitVersion: base.gitVersion,
          baseOid: w.baseOid === undefined ? 'b'.repeat(40) : w.baseOid,
          oldBaseOid: w.oldBaseOid === undefined ? 'd'.repeat(40) : w.oldBaseOid,
          newBaseOid: w.newBaseOid === undefined ? 'e'.repeat(40) : w.newBaseOid,
          windowOids: w.windowOids || [ROW_OID],
          bindings: w.measureBindings || baseBindings,
          scene: base,
        }
      },
      bindingsOf: function () { return signBindings },
      sceneOf: async function () { return Object.assign({ ok: true, exe: 'git', screen: {}, readAtMs: clock.t }, base) },
      windowOf: async function () { return { ok: true, base: 'main', baseOid: 'b'.repeat(40), headOid: ROW_OID, commits: [{ oid: ROW_OID, subject: 'third' }], commitCount: 1, readAtMs: clock.t } },
      ontoRangeOf: async function () { return { ok: true, oldBase: 'old', oldBaseOid: 'd'.repeat(40), newBase: 'new', newBaseOid: 'e'.repeat(40), moved: [{ oid: ROW_OID, subject: 'moved' }], incoming: [], movedCount: 1, incomingCount: 0, readAtMs: clock.t } },
      autosquashPairsOf: async function () { return { ok: true, base: 'main', baseOid: 'b'.repeat(40), pairs: [{ oid: ROW_OID, kind: 'fixup', targetOid: BASE_OID }], todoText: '', readAtMs: clock.t } },
      mergesCostOf: async function () { return { ok: true, base: 'main', baseOid: 'b'.repeat(40), mergeCommits: [], count: 0, gitVersion: GIT_VERSION, readAtMs: clock.t } },
    }
  }
  function makeTmp() {
    let n = 0
    const files: any = {}
    return {
      write: async function (text: string) { n += 1; const p: string = 'C:/tmp/rebase-' + n + '.txt'; files[p] = String(text); return { ok: true, path: p } },
      read: async function (p: string) { return Object.prototype.hasOwnProperty.call(files, p) ? { ok: true, text: files[p] } : { ok: false, reason: 'missing' } },
      remove: async function (p: string) { delete files[p] },
      files: files,
      count: function () { return Object.keys(files).length },
    }
  }
  /** 真文件临时目录：待办覆盖靠 git 自带的 cp 去读文件，夹具必须把待办真写到磁盘上。 */
  function makeRealTmp() {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-rebase-'))
    let n = 0
    const files: any = {}
    return {
      write: async function (text: string) {
        n += 1
        // git 的 sh 里双引号内反斜杠是转义字符，路径统一换成斜杠再交给 cp。
        const p: string = path.join(dir, 'f' + n + '.txt').replace(/\\/g, '/')
        fs.writeFileSync(p, String(text), 'utf8')
        files[p] = String(text)
        return { ok: true, path: p }
      },
      read: async function (p: string) {
        try { return { ok: true, text: fs.readFileSync(p, 'utf8') } } catch (e) { return { ok: false, reason: 'missing' } }
      },
      remove: async function (p: string) { try { fs.unlinkSync(p) } catch (e) { /* 已经不在就算了 */ } delete files[p] },
      files: files,
      dir: dir,
      count: function () { return Object.keys(files).length },
    }
  }
  function makeRig(o: any) {
    const spec: any = o || {}
    const scene: any = fakeScene(spec)
    const tmp: any = makeTmp()
    let n = 0
    const check: any = checkMod.createRebaseCheck({ scene: scene, failPhone: failPhone, now: function () { return clock.t }, randomId: function () { n += 1; return 'ticket-' + n } })
    const runs: any[] = []
    const write: any = writeMod.createRebaseWrite({
      failPhone: failPhone,
      runPinned: async function (exe: any, dir: any, argv: any[], opts: any) {
        runs.push({ argv: argv.slice(), env: (opts && opts.env) || null, gitEditor: (opts && opts.gitEditor) || null })
        return (spec.runResult !== undefined) ? spec.runResult : { kind: 'ok', exitCode: 0, stdout: '', stderr: '' }
      },
      resolveGitExecutable: async function () { return 'git' },
      measure: scene.measure,
      scene: scene,
      now: function () { return clock.t },
      tickets: check.tickets,
      results: check.results,
      tmp: (spec.tmpMissing === true ? null : tmp),
    })
    return { check: check, write: write, runs: runs, tmp: tmp, scene: scene }
  }
  function reasonOf(out: any) { return String((out && (out.reason || (out.error && out.error.reason))) || '') }
  function rowPlan() { return { base: 'main', rows: [{ oid: ROW_OID, action: 'pick', message: '' }] } }
  console.log('  B 宿主预检与执行（假依赖，零进程拒绝栈）')
  {
    const rig = makeRig({})
    const bUnknown = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'nope' })
    eq(reasonOf(bUnknown), 'bad-target', 'B1 不认识的动作当场拒绝：bad-target')
    const bNoCwd = await rig.check.handleRebaseCheck({ op: 'rebase-todo', payload: rowPlan() })
    eq(reasonOf(bNoCwd), 'bad-target', 'B2 缺少仓库目录：bad-target')
    const bTodo = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    check(bTodo.ok === true && bTodo.contract === 'vc-rebase-check' && bTodo.version === 1, 'B3 待办预检放行：契约名与版本随回包')
    check(bTodo.ticket.expiresAtMs - bTodo.ticket.checkedAtMs === 120000, 'B4 票据时限 120 秒（短期确认，过期即失效）')
    eq(bTodo.confirmRequired, true, 'B5 历史改写四条都要求显式确认')
    check(!!bTodo.confirm && bTodo.confirm.what !== '' && bTodo.confirm.wont !== '' && bTodo.confirm.reversible !== '' && bTodo.confirm.verb !== '', 'B6 确认卡四段齐全（会动什么、不会做什么、能不能回退、按哪个词执行）')
    eq(bTodo.plan.rows.length, 1, 'B7 票里保存待办清单（面板排好的动作进票据）')
    eq(rig.runs.length, 0, 'B8 预检这一趟一条执行命令都没起（只读现场）')
    const bOnto = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-onto', payload: { oldBase: 'old', newBase: 'new' } })
    check(bOnto.ok === true && bOnto.extra.movedCount === 1, 'B9 换基座预检带上搬移范围计数')
    const bAuto = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-autosquash', payload: { base: 'main' } })
    check(bAuto.ok === true && bAuto.extra.pairCount === 1, 'B10 自动吸收预检先列出将吸收的提交对')
    const bMerges = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    check(bMerges.ok === true && bMerges.extra.mergeCount === 0, 'B11 保留合并结构预检带上合并提交计数（代价先给用户看）')
    const bState = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-state' })
    check(bState.ok === true && bState.canRebase === true && bState.updateRefs === false, 'B12 读数电话 rebase-state：干净仓库可开始变基')
    const bWin = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-window', base: 'main' })
    check(bWin.ok === true && bWin.commitCount === 1 && bWin.commits[0].oid === ROW_OID, 'B13 读数电话 rebase-window：窗口清单按提交号回')
    const bRange = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-onto-range', oldBase: 'old', newBase: 'new' })
    check(bRange.ok === true && bRange.movedCount === 1 && bRange.incomingCount === 0, 'B14 读数电话 rebase-onto-range：两段范围分开数')
    const bPairs = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-autosquash-pairs', base: 'main' })
    check(bPairs.ok === true && bPairs.pairCount === 1, 'B15 读数电话 rebase-autosquash-pairs：配对清单可先看')
    const bCost = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-merges-cost', base: 'main' })
    check(bCost.ok === true && bCost.count === 0, 'B16 读数电话 rebase-merges-cost：代价可先看')
    const bBadRead = await rig.check.handleRebaseRead({ cwd: 'C:/repo', op: 'rebase-todo' })
    eq(reasonOf(bBadRead), 'bad-target', 'B17 写动作不能走只读电话（不认识这个只读动作）')
  }
  {
    const rig = makeRig({})
    const bGone = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', ticketId: 'NOSUCH', requestId: 'b-req-gone', confirmed: true })
    check(reasonOf(bGone) === 'ticket-missing' && rig.runs.length === 0, 'B18 伪造票：ticket-missing 且零进程')
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    const bBadReq = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'bad id!', confirmed: true })
    check(reasonOf(bBadReq) === 'bad-target' && rig.runs.length === 0, 'B19 请求号形状不合法：bad-target 且零进程（重放机制不能被脏号污染）')
    const bSwap = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-swap', confirmed: true })
    check(reasonOf(bSwap) === 'ticket-op-mismatch' && rig.runs.length === 0, 'B20 换动作用票：ticket-op-mismatch 且零进程')
    const bNoConfirm = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-noconfirm' })
    check(reasonOf(bNoConfirm) === 'need-confirm' && rig.runs.length === 0, 'B21 没带显式确认：need-confirm 且零进程')
    clock.t += 120001
    const bExpired = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-expired', confirmed: true })
    clock.t -= 120001
    check(reasonOf(bExpired) === 'ticket-expired' && rig.runs.length === 0, 'B22 票据过期（超过 120 秒）：ticket-expired 且零进程')
  }
  {
    const rig = makeRig({ measureUpdateRefs: true })
    const bUpdateRefs = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    check(reasonOf(bUpdateRefs) === 'update-refs-on' && rig.runs.length === 0, 'B23 仓库开着 rebase.updateRefs：预检就拒（面板不替人改配置、不做 --update-refs）')
    check(String(bUpdateRefs.error.message).indexOf('git config --local rebase.updateRefs false') >= 0, 'B24 拒绝话术给出关掉这个开关的确切命令')
    check(bUpdateRefs.decision && bUpdateRefs.decision.verdict === 'block', 'B25 拒绝回包带判定（verdict block）')
  }
  {
    const rig = makeRig({ scene: { state: 'rebase' } })
    const bBusy = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    check(reasonOf(bBusy) === 'operation-in-progress' && rig.runs.length === 0, 'B26 已经有进行中的操作：预检拒绝且零进程（先把当前操作处理完）')
    eq(bBusy.state, 'rebase', 'B27 拒绝回包点名当前是哪种操作')
  }
  {
    const rig = makeRig({ oldBaseOid: 'd'.repeat(40), newBaseOid: 'd'.repeat(40) })
    const bSame = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-onto', payload: { oldBase: 'old', newBase: 'new' } })
    check(reasonOf(bSame) === 'nothing-to-do' && rig.runs.length === 0, 'B28 新旧基座指向同一提交：nothing-to-do 且零进程')
  }
  {
    const rig = makeRig({})
    const badRows = { base: 'main', rows: [{ oid: 'f'.repeat(40), action: 'pick', message: '' }] }
    const bMismatch = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: badRows })
    check(reasonOf(bMismatch) === 'todo-mismatch' && rig.runs.length === 0, 'B29 待办行与当时窗口对不上：todo-mismatch 且零进程（不把旧判断套到新现场）')
    const rewordBad = { base: 'main', rows: [{ oid: ROW_OID, action: 'reword', message: '' }] }
    const bNoMsg = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rewordBad })
    check(reasonOf(bNoMsg) === 'missing-message', 'B30 改说明却没填正文：missing-message 当场拒绝')
  }
  {
    const rig = makeRig({ measureSecond: { measureUpdateRefs: true } })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    const bChanged = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' }, ticketId: pre.ticket.id, requestId: 'b-req-cfg', confirmed: true })
    check(pre.ok === true && reasonOf(bChanged) === 'update-refs-on' && rig.runs.length === 0, 'B31 签票后这个开关被打开：执行层重验现场，update-refs-on 且零进程')
  }
  {
    const rig = makeRig({ measureSecond: { measureState: 'merge' } })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    const bChanged = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' }, ticketId: pre.ticket.id, requestId: 'b-req-busy', confirmed: true })
    check(reasonOf(bChanged) === 'operation-in-progress' && rig.runs.length === 0, 'B32 签票后仓库进入别的操作：operation-in-progress 且零进程')
  }
  {
    const rig = makeRig({ measureSecond: { measureHeadOid: 'f'.repeat(40) } })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    const bChanged = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' }, ticketId: pre.ticket.id, requestId: 'b-req-head', confirmed: true })
    check(reasonOf(bChanged) === 'target-changed' && rig.runs.length === 0, 'B33 签票后 HEAD 动了：target-changed 且零进程')
  }
  {
    const rig = makeRig({ measureSecond: { measureRepoRoot: 'C:/other' } })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    const bChanged = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' }, ticketId: pre.ticket.id, requestId: 'b-req-repo', confirmed: true })
    check(reasonOf(bChanged) === 'stale-repo' && rig.runs.length === 0, 'B34 换仓库用票：stale-repo 且零进程')
  }
  {
    const otherBindings = ticketMod.makeBindings({ preconditions: { planDigest: 'f'.repeat(16), worktreeDigest: 'b'.repeat(16), configOldValue: 'false', remoteOid: null, pathAbsent: [] }, counters: { indexEntries: null } })
    const rig = makeRig({ measureSecond: { measureBindings: otherBindings } })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' } })
    const bChanged = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-merges', payload: { base: 'main' }, ticketId: pre.ticket.id, requestId: 'b-req-bind', confirmed: true })
    check(reasonOf(bChanged) === 'target-changed' && rig.runs.length === 0, 'B35 签票后计划摘要或工作区摘要变了：target-changed 且零进程')
  }
  {
    const rig = makeRig({})
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    const done = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-ok', confirmed: true })
    check(done.ok === true && done.conflicted === false, 'B36 正常执行：回包 ok 且不是冲突')
    eq(rig.runs.length, 1, 'B37 一次成功只起一条 git 命令')
    eq(rig.runs[0].argv.join(' '), 'rebase -i main', 'B38 待办变基的 argv 是 rebase -i <基座>（独立元素）')
    check(String(rig.runs[0].env.GIT_SEQUENCE_EDITOR).indexOf('cp "') === 0, 'B39 待办文件靠 GIT_SEQUENCE_EDITOR 指向 cp 覆盖（规格第 7 节编辑器交接）')
    eq(rig.runs[0].gitEditor, null, 'B40 没有压缩行时 GIT_EDITOR 不覆盖（仍是必失败命令）')
    eq(rig.tmp.count(), 0, 'B41 执行完临时文件全部删掉')
    const replay = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: { base: 'WRONG', rows: [] }, ticketId: 'NOPE', requestId: 'b-req-ok', confirmed: true })
    check(replay.ok === true && replay.reused === true && rig.runs.length === 1, 'B42 同一个请求号重放：回同一份结果、不再起命令（重复点按钮不重复执行）')
  }
  {
    const two = ['1'.repeat(40), '2'.repeat(40)]
    const rig = makeRig({ windowOids: two })
    const rows = { base: 'main', rows: [{ oid: two[0], action: 'reword', message: '新的说明' }, { oid: two[1], action: 'squash', message: '' }] }
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rows })
    const done = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rows, ticketId: pre.ticket.id, requestId: 'b-req-squash', confirmed: true })
    check(pre.ok === true && done.ok === true && rig.runs.length === 1, 'B43 待办里同时有改说明与压缩：预检放行、执行一次')
    eq(rig.runs[0].gitEditor, 'true', 'B44 有压缩行时把 GIT_EDITOR 覆盖成 true（接受 git 的默认合并说明，不弹外部编辑器）')
    eq(rig.tmp.count(), 0, 'B45 改说明的临时文件执行完也删干净')
  }
  {
    const conflicted = { kind: 'non-zero', exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in a.txt', stderr: '' }
    const rig = makeRig({ runResult: conflicted })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    const done = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-conflict', confirmed: true })
    check(done.ok === true && done.conflicted === true, 'B46 变基撞冲突不是执行失败：回包 ok 且 conflicted=true（交给冲突向导接着处理）')
  }
  {
    const failure = { kind: 'non-zero', exitCode: 128, stdout: '', stderr: 'fatal: bad revision' }
    const rig = makeRig({ runResult: failure })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    const out = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-fail', confirmed: true })
    check(out.ok === false && reasonOf(out) === 'unknown-write-failure', 'B47 真失败按失败信封回（不落 unknown 之外的理由）')
    const keys = Object.keys(out.error || {}).sort().join(',')
    eq(keys, 'kind,message,reason', 'B48 失败信封固定三键（kind / reason / message）')
    check(out.git === 'fatal: bad revision' && out.step !== '' && out.expected !== '' && out.actual === '退出码 128', 'B49 失败信封带现场：git 原话、环节、期望、实际退出码')
  }
  {
    const rig = makeRig({ tmpMissing: true })
    const pre = await rig.check.handleRebaseCheck({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan() })
    const out = await rig.write.handleRebaseWrite({ cwd: 'C:/repo', op: 'rebase-todo', payload: rowPlan(), ticketId: pre.ticket.id, requestId: 'b-req-notmp', confirmed: true })
    check(reasonOf(out) === 'env' && rig.runs.length === 0, 'B50 临时文件服务不可用：明确失败且零进程（不静默改成别的做法）')
  }
  console.log('  B 组完成：' + total + ' 条')

  // ===== C 真临时 git 仓库 =====
  const commandsMod = await loadModule('src/shared/version-control/src/commands.js')
  const sceneMod = await loadModule('src/host/versionControlRebaseScene.js')
  const nodeCp = require('node:child_process')
  function gitSync(cwd: string, args: string[]) {
    const r = nodeCp.spawnSync('git', ['-C', cwd].concat(args), { cwd: cwd, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }), encoding: 'utf8' })
    if (r.error) throw new Error('git 起不来：' + r.error.message)
    return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
  }
  function gitMust(cwd: string, args: string[]) {
    const r = gitSync(cwd, args)
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' 失败：' + r.err + r.out)
    return r
  }
  function mkRepo(tag: string) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1586-r-' + tag + '-'))
    gitMust(dir, ['init', '-q', '-b', 'main'])
    gitMust(dir, ['config', 'user.name', '门禁'])
    gitMust(dir, ['config', 'user.email', 'gate@example.com'])
    gitMust(dir, ['config', 'commit.gpgsign', 'false'])
    return dir
  }
  function commitFile(dir: string, name: string, text: string, msg: string) {
    fs.writeFileSync(path.join(dir, name), text)
    gitMust(dir, ['add', name])
    gitMust(dir, ['commit', '-q', '-m', msg])
    return gitMust(dir, ['rev-parse', 'HEAD']).out.trim()
  }
  function realScreenOf(cwd: string) {
    const root: string = gitMust(cwd, ['rev-parse', '--show-toplevel']).out.trim()
    const oid: string = gitMust(root, ['rev-parse', 'HEAD']).out.trim()
    const ver: string = gitMust(root, ['--version']).out.trim()
    let gitDir: string = gitMust(root, ['rev-parse', '--git-dir']).out.trim()
    if (!path.isAbsolute(gitDir)) gitDir = path.resolve(root, gitDir)
    const has = function (p: string) { return fs.existsSync(path.join(gitDir, p)) }
    const names = function (args: string[]) { return gitSync(root, args).out.split(/\r?\n/).filter(function (s: string) { return s !== '' }) }
    return {
      ok: true,
      gitVersion: ver,
      screen: {
        identity: { oid: oid, worktreePath: root },
        repo: { worktreePath: root, bare: false, merging: has('MERGE_HEAD'), rebasing: has('rebase-merge') || has('rebase-apply'), cherryPicking: has('CHERRY_PICK_HEAD'), reverting: has('REVERT_HEAD') },
        staged: names(['diff', '--cached', '--name-only']),
        unstaged: names(['diff', '--name-only']),
        conflictCount: names(['diff', '--name-only', '--diff-filter=U']).length,
      },
    }
  }
  function realResolveRepoRoot(exe: string, cwd: string) {
    const r = nodeCp.spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    if (r.status !== 0) return { ok: false, error: { kind: 'env', message: '不是 git 仓库' } }
    return { ok: true, root: String(r.stdout || '').trim() }
  }
  function makeRealRig() {
    const spawns: any[] = []
    const tmp: any = makeRealTmp()
    const runPinned = async function (exe: string, dir: string, args: string[], opts: any) {
      const argv: string[] = ['-C', dir].concat(commandsMod.fixedPrefix()).concat(args)
      spawns.push({ dir: dir, args: args.slice(), argv: argv, env: (opts && opts.env) || null, gitEditor: (opts && opts.gitEditor) || null })
      const env: any = Object.assign({}, process.env, (opts && opts.env) || {}, { GIT_EDITOR: (opts && opts.gitEditor) ? String(opts.gitEditor) : 'false', GIT_TERMINAL_PROMPT: '0' })
      Object.keys(env).forEach(function (k: string) { if (env[k] === undefined) delete env[k] })
      const r = nodeCp.spawnSync(exe, argv, { cwd: dir, env: env, encoding: 'utf8' })
      if (r.error) return { kind: 'spawn-failed', message: String(r.error.message) }
      return { kind: r.status === 0 ? 'ok' : 'non-zero', exitCode: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
    }
    const scene = sceneMod.createRebaseScene({ failPhone: failPhone, firstLine: envelopeMod.firstLine, failureFromExec: envelopeMod.failureFromExec, runPinned: runPinned, resolveGitExecutable: async function () { return 'git' }, resolveRepoRoot: realResolveRepoRoot, readScreenOf: async function (cwd: string) { return realScreenOf(cwd) }, tmp: tmp, now: function () { return clock.t } })
    let n = 0
    const check = checkMod.createRebaseCheck({ scene: scene, failPhone: failPhone, now: function () { return clock.t }, randomId: function () { n += 1; return 'rticket-' + n } })
    const write = writeMod.createRebaseWrite({ failPhone: failPhone, runPinned: runPinned, resolveGitExecutable: async function () { return 'git' }, measure: scene.measure, scene: scene, now: function () { return clock.t }, tickets: check.tickets, results: check.results, tmp: tmp })
    const rebaseArgs = function () { return spawns.filter(function (s: any) { return s.args[0] === 'rebase' }) }
    return { scene: scene, check: check, write: write, spawns: spawns, rebaseArgs: rebaseArgs }
  }
  function rowsFrom(commits: any, overrides: any) {
    return commits.map(function (c: any, i: number) {
      const action: string = (overrides && overrides[i]) ? overrides[i] : 'pick'
      return { oid: c.oid, action: action, message: '' }
    })
  }
  console.log('  C 真临时 git 仓库')
  {
    const repo = mkRepo('basic')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    const c2: string = commitFile(repo, 'b.txt', '2\n', 'c2')
    const c3: string = commitFile(repo, 'c.txt', '3\n', 'c3')
    gitMust(repo, ['checkout', '-q', '-b', 'side', c1])
    const n1: string = commitFile(repo, 'side.txt', 'side\n', 'n1')
    gitMust(repo, ['checkout', '-q', 'main'])
    const rig = makeRealRig()
    const sc = await rig.scene.sceneOf(repo)
    check(sc.ok === true && sc.state === null && sc.branch === 'main' && sc.updateRefs === false, 'C1 真仓库现场：干净、在 main、updateRefs 关')
    has(sc.gitVersion, 'git version', 'C2 现场读数带完整 git 版本串（含 git version 前缀）')
    const win = await rig.scene.windowOf(repo, c1)
    check(win.ok === true && win.commitCount === 2 && win.commits[0].oid === c2 && win.commits[1].oid === c3, 'C3 待办窗口：基座之后两个提交，按从旧到新排')
    const range = await rig.scene.ontoRangeOf(repo, c1, 'side')
    check(range.ok === true && range.movedCount === 2 && range.incomingCount === 1, 'C4 换基座范围：要搬走 2 个、新基座带来 1 个')
    const stRead = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-state' })
    check(stRead.ok === true && stRead.canRebase === true, 'C5 读数电话在真仓库上可开始变基')
    const winRead = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-window', base: c1 })
    check(winRead.ok === true && winRead.commitCount === 2, 'C6 读数电话读出真窗口两条')
    const rangeRead = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-onto-range', oldBase: c1, newBase: 'side' })
    check(rangeRead.ok === true && rangeRead.movedCount === 2 && rangeRead.incomingCount === 1, 'C7 读数电话读出真换基座范围')
    const missing = await rig.scene.windowOf(repo, 'no-such-branch')
    check(missing.ok === false && reasonOf(missing.envelope) === 'target-missing', 'C8 基座不存在：target-missing（明确失败，不猜）')
    const ontoPre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-onto', payload: { oldBase: c1, newBase: 'side' } })
    check(ontoPre.ok === true && ontoPre.ticket.op === 'rebase-onto' && ontoPre.plan.oldBaseOid === c1 && ontoPre.plan.newBaseOid === n1, 'C9 换基座预检把新旧基座解析成确切提交号写进票')
    const ontoRun = await rig.write.handleRebaseWrite({ cwd: repo, op: 'rebase-onto', payload: { oldBase: c1, newBase: 'side' }, ticketId: ontoPre.ticket.id, requestId: 'c-req-onto', confirmed: true })
    const ontoCount = gitMust(repo, ['rev-list', '--count', n1 + '..HEAD']).out.trim()
    const ancestor = gitSync(repo, ['merge-base', '--is-ancestor', n1, 'HEAD']).status
    check(ontoRun.ok === true && ontoRun.conflicted === false && ontoCount === '2' && ancestor === 0, 'C10 换基座真执行：两个提交搬到新基座之上，新基座成了 HEAD 的祖先')
    eq(rig.rebaseArgs()[0].args.join(' '), 'rebase --onto side ' + c1, 'C11 换基座的 argv 是 rebase --onto <新基座> <旧基座>（新前旧后，逐元素独立）')
  }
  {
    const repo = mkRepo('todo')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    const c2: string = commitFile(repo, 'b.txt', '2\n', 'c2')
    const c3: string = commitFile(repo, 'c.txt', '3\n', 'c3')
    const rig = makeRealRig()
    const win = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-window', base: c1 })
    const rows = rowsFrom(win.commits, ['pick', 'drop'])
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-todo', payload: { base: c1, rows: rows } })
    check(pre.ok === true && pre.extra.windowCount === 2, 'C12 待办预检：窗口两条都认，票里记窗口条数')
    const run = await rig.write.handleRebaseWrite({ cwd: repo, op: 'rebase-todo', payload: { base: c1, rows: rows }, ticketId: pre.ticket.id, requestId: 'c-req-todo', confirmed: true })
    const count = gitMust(repo, ['rev-list', '--count', c1 + '..HEAD']).out.trim()
    check(run.ok === true && run.conflicted === false && count === '1', 'C13 待办里把第三条标成丢弃：真执行后基座之后只剩一条提交（drop 生效）')
    const seq = rig.rebaseArgs()[0]
    check(seq.args.join(' ') === 'rebase -i ' + c1 && String(seq.env.GIT_SEQUENCE_EDITOR).indexOf('cp "') === 0, 'C14 待办变基的 argv 与待办覆盖通道都按规格第 7 节')
  }
  {
    const repo = mkRepo('conflict')
    commitFile(repo, 'f.txt', 'base\n', 'c1')
    gitMust(repo, ['checkout', '-q', '-b', 'side'])
    const s: string = commitFile(repo, 'f.txt', 'side\n', 's')
    gitMust(repo, ['checkout', '-q', 'main'])
    const m: string = commitFile(repo, 'f.txt', 'main\n', 'm')
    gitMust(repo, ['checkout', '-q', 'side'])
    const rig = makeRealRig()
    const win = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-window', base: m })
    check(win.ok === true && win.commitCount === 1 && win.commits[0].oid === s, 'C15 冲突仓库的待办窗口只有那一条会冲突的提交')
    const rows = rowsFrom(win.commits, ['pick'])
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-todo', payload: { base: m, rows: rows } })
    check(pre.ok === true, 'C16 会冲突的待办也能签票（冲突不是预检能预知的失败）')
    const run = await rig.write.handleRebaseWrite({ cwd: repo, op: 'rebase-todo', payload: { base: m, rows: rows }, ticketId: pre.ticket.id, requestId: 'c-req-conflict', confirmed: true })
    check(run.ok === true && run.conflicted === true && run.state === 'rebase', 'C17 撞冲突：回包如实说 conflicted 与现在停在 rebase 中，不报 git-failed')
    const st = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-state' })
    check(st.ok === true && st.state === 'rebase' && st.canRebase === false, 'C18 冲突后读数电话如实报进行中，不再允许开始新变基')
    const preAgain = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-todo', payload: { base: m, rows: rows } })
    check(reasonOf(preAgain) === 'operation-in-progress', 'C19 冲突未处理时再点变基：operation-in-progress 拒绝')
    gitMust(repo, ['rebase', '--abort'])
    const headAfter = gitMust(repo, ['rev-parse', 'HEAD']).out.trim()
    const st2 = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-state' })
    check(headAfter === s && st2.ok === true && st2.state === null, 'C20 中止后 HEAD 回到操作前、状态干净（不伪造成功，能回原状态）')
  }
  {
    const repo = mkRepo('stale')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    const c2: string = commitFile(repo, 'b.txt', '2\n', 'c2')
    const rig = makeRealRig()
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-todo', payload: { base: c1, rows: [{ oid: c2, action: 'pick', message: '' }] } })
    const c3: string = commitFile(repo, 'c.txt', '3\n', 'c3')
    const before = rig.rebaseArgs().length
    const run = await rig.write.handleRebaseWrite({ cwd: repo, op: 'rebase-todo', payload: { base: c1, rows: [{ oid: c2, action: 'pick', message: '' }] }, ticketId: pre.ticket.id, requestId: 'c-req-stale', confirmed: true })
    check(pre.ok === true && reasonOf(run) === 'target-changed' && rig.rebaseArgs().length === before && gitMust(repo, ['rev-parse', 'HEAD']).out.trim() === c3, 'C21 签票后又提交了一条：target-changed、零 rebase 进程、HEAD 不动')
  }
  {
    const repo = mkRepo('merges')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    gitMust(repo, ['checkout', '-q', '-b', 'feat'])
    commitFile(repo, 'f.txt', 'feat\n', 'feat')
    gitMust(repo, ['checkout', '-q', 'main'])
    commitFile(repo, 'm.txt', 'main\n', 'm2')
    gitMust(repo, ['merge', '-q', '--no-ff', '-m', 'merge feat', 'feat'])
    const rig = makeRealRig()
    const cost = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-merges-cost', base: c1 })
    check(cost.ok === true && cost.count === 1, 'C22 保留合并结构的代价：真数出 1 个合并提交')
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-merges', payload: { base: c1 } })
    check(pre.ok === true && pre.extra.mergeCount === 1, 'C23 保留合并结构预检把代价计数写进回包（先给用户看再确认）')
  }
  {
    const repo = mkRepo('autosquash')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    commitFile(repo, 'b.txt', '2\n', 'feat: 新功能')
    commitFile(repo, 'b2.txt', '3\n', 'fixup! feat: 新功能')
    const rig = makeRealRig()
    const pairs = await rig.check.handleRebaseRead({ cwd: repo, op: 'rebase-autosquash-pairs', base: c1 })
    check(pairs.ok === true && pairs.pairCount === 1 && pairs.pairs[0].kind === 'fixup', 'C24 自动吸收清单：真仓库里认出 fixup! 与它的目标提交')
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-autosquash', payload: { base: c1 } })
    check(pre.ok === true && pre.extra.pairCount === 1, 'C25 自动吸收预检先把将吸收的提交对列出来（执行前看得见）')
  }
  {
    const repo = mkRepo('updaterefs')
    const c1: string = commitFile(repo, 'a.txt', '1\n', 'c1')
    commitFile(repo, 'b.txt', '2\n', 'c2')
    gitMust(repo, ['config', 'rebase.updateRefs', 'true'])
    const rig = makeRealRig()
    const sc = await rig.scene.sceneOf(repo)
    check(sc.ok === true && sc.updateRefs === true, 'C26 真仓库开着 rebase.updateRefs 时现场读数为真')
    const pre = await rig.check.handleRebaseCheck({ cwd: repo, op: 'rebase-todo', payload: { base: c1, rows: [{ oid: gitMust(repo, ['rev-parse', 'HEAD']).out.trim(), action: 'pick', message: '' }] } })
    check(reasonOf(pre) === 'update-refs-on' && rig.rebaseArgs().length === 0, 'C27 开着 updateRefs：预检拒绝且零进程（面板不替人改配置、不做 --update-refs）')
  }

  console.log('  C 组完成：' + total + ' 条')

  // ===== D 客户端面板：动作模型、可见性、待办重排、确认卡与结果条、词条 =====
  console.log('  D 客户端面板（变基待办页）')
  function fakeH(tag: any, props: any, children: any) {
    return { tag: tag, props: props || {}, children: Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children]) }
  }
  function fakeT(key: any, params: any) {
    return String(key) + (params === undefined || params === null ? '' : ' ' + JSON.stringify(params))
  }
  function findAll(node: any, pred: any) {
    const out: any[] = []
    if (!node || typeof node !== 'object') return out
    if (pred(node)) out.push(node)
    const kids: any[] = Array.isArray(node.children) ? node.children : []
    for (let i = 0; i < kids.length; i += 1) {
      const more: any[] = findAll(kids[i], pred)
      for (let j = 0; j < more.length; j += 1) out.push(more[j])
    }
    return out
  }
  function attrAll(node: any, name: string) {
    return findAll(node, function (n: any) { return n.props && n.props[name] !== undefined && n.props[name] !== null })
  }
  function textAll(node: any) {
    const out: string[] = []
    if (node === null || node === undefined) return out
    if (typeof node === 'string') { out.push(node); return out }
    if (typeof node !== 'object') return out
    const kids: any[] = Array.isArray(node.children) ? node.children : []
    for (let i = 0; i < kids.length; i += 1) {
      const more: string[] = textAll(kids[i])
      for (let j = 0; j < more.length; j += 1) out.push(more[j])
    }
    return out
  }
  const clientOpsSrc: string = sourceText('src/client/views/versionControl/vcRebaseOps.ts')
  const clientPageSrc: string = sourceText('src/client/views/versionControl/vcRebasePage.ts')
  const leafBody = spliceableJs('src/client/views/versionControl/vcRebaseOps.ts') + '\n' + spliceableJs('src/client/views/versionControl/vcRebasePage.ts') + '\nreturn { VC_REBASE_PHONES: VC_REBASE_PHONES, VC_REBASE_OPS: VC_REBASE_OPS, VC_REBASE_TODO_ACTIONS: VC_REBASE_TODO_ACTIONS, VC_REBASE_TODO_MOVES: VC_REBASE_TODO_MOVES, vcRebaseOpMetaOf: vcRebaseOpMetaOf, vcRebaseOpLabelKeyOf: vcRebaseOpLabelKeyOf, vcRebaseOpVerbKeyOf: vcRebaseOpVerbKeyOf, vcRebaseActionLabelKeyOf: vcRebaseActionLabelKeyOf, vcRebaseStateLabelKeyOf: vcRebaseStateLabelKeyOf, vcRebaseRequestIdOf: vcRebaseRequestIdOf, vcRebaseVisibleOf: vcRebaseVisibleOf, vcRebaseRowsOf: vcRebaseRowsOf, vcRebaseMoveOf: vcRebaseMoveOf, vcRebaseRowPatchOf: vcRebaseRowPatchOf, vcRebasePayloadOf: vcRebasePayloadOf, vcRebaseCheckArgsOf: vcRebaseCheckArgsOf, vcRebaseReadArgsOf: vcRebaseReadArgsOf, vcRebaseWriteArgsOf: vcRebaseWriteArgsOf, vcRebaseTargetOf: vcRebaseTargetOf, vcRebaseRowTextOf: vcRebaseRowTextOf, vcRebasePageNode: vcRebasePageNode };'
  const leaf: any = compileFn(['h', 't', 'vcWriteErrFamilyOf'], leafBody)(fakeH, fakeT, function () { return 'notReady' })
  function rebaseReconcile(sharedRows: any[], clientRows: any[]) {
    const problems: string[] = []
    if (sharedRows.length !== clientRows.length) problems.push('件数 ' + sharedRows.length + ' 与 ' + clientRows.length + ' 不一致')
    const n: number = Math.min(sharedRows.length, clientRows.length)
    for (let i = 0; i < n; i += 1) {
      const s: any = sharedRows[i]
      const c: any = clientRows[i]
      const got: any = { op: c.op, capId: c.capId, write: c.write, dangerous: c.dangerous, confirm: c.confirm, needs: c.needs }
      const want: any = { op: s.id, capId: s.capId, write: s.kind === 'write', dangerous: s.dangerous, confirm: s.confirm, needs: s.needs }
      const keys: string[] = ['op', 'capId', 'write', 'dangerous', 'confirm', 'needs']
      for (let k = 0; k < keys.length; k += 1) if (got[keys[k]] !== want[keys[k]]) problems.push(String(want.op) + ' 的 ' + keys[k] + ' 不一致')
    }
    return problems
  }
  const sharedRows = ops.REBASE_OPS.map(function (m: any) { return { id: m.id, capId: m.capId, kind: m.kind, dangerous: m.dangerous, confirm: m.confirm, needs: m.needs } })

  eq(leaf.VC_REBASE_PHONES.read, 'wf.gitRebaseRead', 'D1 客户端电话表：读')
  eq(leaf.VC_REBASE_PHONES.check, 'wf.gitRebaseCheck', 'D2 客户端电话表：预检')
  eq(leaf.VC_REBASE_PHONES.write, 'wf.gitRebaseWrite', 'D3 客户端电话表：执行')
  eq(leaf.VC_REBASE_OPS.length, 9, 'D4 客户端动作名单九条（四写五读）')
  eq(rebaseReconcile(sharedRows, leaf.VC_REBASE_OPS).join('；'), '', 'D5 客户端动作名单与共享协议逐条对账（动作名、能力号、读写、危险、确认、输入形状）')
  eq(leaf.VC_REBASE_OPS.filter(function (m: any) { return m.write === true }).map(function (m: any) { return m.capId }).join(','), '5.6,5.7,5.8,5.10', 'D6 四条写动作的能力号顺序')
  eq(leaf.VC_REBASE_TODO_ACTIONS.join(','), 'pick,reword,squash,fixup,drop', 'D7 待办五个改写动词')
  check(leaf.VC_REBASE_TODO_ACTIONS.indexOf('edit') < 0 && leaf.VC_REBASE_TODO_ACTIONS.indexOf('break') < 0, 'D8 待办动词里没有 edit 与 break')
  eq(leaf.VC_REBASE_TODO_MOVES.join(','), 'move-up,move-down', 'D9 两个纯重排动作')
  eq(leaf.vcRebaseVisibleOf(null, false).join(','), 'rebase-todo,rebase-onto,rebase-autosquash,rebase-merges', 'D10 干净状态四条写动作都可见')
  eq(leaf.vcRebaseVisibleOf('rebase', false).length, 0, 'D11 变基进行中四条写动作都不出现（不是灰着）')
  eq(leaf.vcRebaseVisibleOf(null, true).length, 0, 'D12 仓库开着 updateRefs 时四条写动作都不出现（面板不替人改配置）')
  const rid: string = leaf.vcRebaseRequestIdOf(1000, 'rebase-todo')
  check(/^r[0-9a-z]+(-[A-Za-z0-9]{1,12})?$/.test(rid), 'D13 请求号形状合法（实测 ' + rid + '）')
  eq(leaf.vcRebaseRequestIdOf(1000, 'a b!').indexOf(' ') < 0, true, 'D14 请求号里的盐去掉非字母数字字符')
  const todoVals: any = { base: 'main', rows: [{ oid: ROW_OID, action: 'reword', message: '新说明' }, { oid: BASE_OID, action: 'pick', message: '不该带的说明' }] }
  const todoPayload: any = leaf.vcRebasePayloadOf('rebase-todo', todoVals)
  eq(todoPayload.base, 'main', 'D15 待办载荷带基座')
  eq(todoPayload.rows[0].message, '新说明', 'D16 reword 行把面板说明带进载荷')
  check(todoPayload.rows[1].message === undefined, 'D17 非 reword 行不带说明字段（不让旧说明混进待办）')
  eq(JSON.stringify(leaf.vcRebasePayloadOf('rebase-onto', { oldBase: 'old', newBase: 'new' })), JSON.stringify({ oldBase: 'old', newBase: 'new' }), 'D18 换基座载荷字段与宿主读取一致')
  eq(JSON.stringify(leaf.vcRebasePayloadOf('rebase-merges', { base: 'main' })), JSON.stringify({ base: 'main' }), 'D19 保留合并结构载荷只有一个基座')
  const cargs: any = leaf.vcRebaseCheckArgsOf('C:/repo', 'rebase-todo', todoVals)
  check(cargs.cwd === 'C:/repo' && cargs.op === 'rebase-todo' && Array.isArray(cargs.rows), 'D20 预检参数带 cwd、动作与展开的载荷')
  const wargs: any = leaf.vcRebaseWriteArgsOf('C:/repo', 'rebase-onto', { oldBase: 'old', newBase: 'new' }, 'ticket-1', 'req-1')
  check(wargs.ticketId === 'ticket-1' && wargs.requestId === 'req-1' && wargs.confirmed === true && wargs.oldBase === 'old', 'D21 执行参数带票号、请求号、显式确认与载荷')
  eq(JSON.stringify(leaf.vcRebaseReadArgsOf('C:/repo', 'rebase-window', { base: 'main' })), JSON.stringify(leaf.vcRebaseCheckArgsOf('C:/repo', 'rebase-window', { base: 'main' })), 'D22 读参数与预检同形（同一条电话口径）')
  const rows0: any[] = leaf.vcRebaseRowsOf([{ oid: ROW_OID, subject: 'third' }, { oid: BASE_OID, subject: 'second' }])
  check(rows0.length === 2 && rows0[0].action === 'pick' && rows0[0].message === '' && rows0[1].oid === BASE_OID, 'D23 窗口提交整理成待办行：默认保留、说明为空')
  const moved: any[] = leaf.vcRebaseMoveOf(rows0, 1, 'move-up')
  eq(moved[0].oid, BASE_OID, 'D24 上移把这一行换到前一行')
  eq(leaf.vcRebaseMoveOf(rows0, 0, 'move-up')[0].oid, rows0[0].oid, 'D25 已经在最上面时上移原样返回')
  eq(leaf.vcRebaseMoveOf(rows0, 1, 'move-down')[1].oid, rows0[1].oid, 'D26 已经在最下面时下移原样返回')
  const patched: any[] = leaf.vcRebaseRowPatchOf(todoVals.rows, 0, { action: 'squash' })
  check(patched[0].action === 'squash' && patched[0].message === '新说明', 'D27 改动作不动说明（字段原样保留）')
  eq(leaf.vcRebaseTargetOf('rebase-onto', { oldBase: 'old', newBase: 'new' }, fakeT), 'old → new', 'D28 换基座确认卡写清新旧基座')
  const todoTarget: string = leaf.vcRebaseTargetOf('rebase-todo', todoVals, fakeT)
  check(todoTarget.indexOf('main') >= 0 && todoTarget.indexOf('2') >= 0, 'D29 待办确认卡写清基座与行数（实测 ' + todoTarget + '）')
  eq(leaf.vcRebaseRowTextOf({ oid: ROW_OID, subject: 'third' }), ROW_OID.slice(0, 10) + ' third', 'D30 待办行文本是短提交号加说明')
  const cleanPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: { state: null, branch: 'main', headOid: BASE_OID, updateRefs: false }, values: todoVals, rows: {}, handlers: {} } })
  eq(attrAll(cleanPage, 'data-vc-rebase-page').length, 1, 'D31 页面节点带页面标记')
  eq(attrAll(cleanPage, 'data-vc-rebase-op-count')[0].props['data-vc-rebase-op-count'], '9', 'D32 页面节点声明九条动作')
  eq(attrAll(cleanPage, 'data-vc-rebase-primary').length, 4, 'D33 干净状态有四颗可执行按钮（四条写动作）')
  eq(attrAll(cleanPage, 'data-vc-rebase-hidden').length, 5, 'D34 五条只读动作不画执行按钮，只画「不在这里做」的说明')
  const busyPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: { state: 'rebase', branch: 'main', headOid: BASE_OID, updateRefs: false }, values: {}, rows: {}, handlers: {} } })
  eq(attrAll(busyPage, 'data-vc-rebase-primary').length, 0, 'D35 变基进行中一颗写动作按钮都不画（先处理冲突）')
  const refsPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: { state: null, updateRefs: true }, values: {}, rows: {}, handlers: {} } })
  eq(attrAll(refsPage, 'data-vc-rebase-updaterefs').length, 1, 'D36 开着 updateRefs 时页面顶上说清这件事')
  eq(attrAll(refsPage, 'data-vc-rebase-primary').length, 0, 'D37 开着 updateRefs 时四条写动作都不画')
  const rowPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: { state: null }, values: {}, rows: {}, handlers: {}, todoRows: 0 } })
  check(rowPage !== null, 'D38 没有待办行时页面仍能画（空清单不崩）')
  const listPage: any = leaf.vcRebasePageNode(fakeH, fakeT, {
    rebase: {
      state: { state: null, updateRefs: false },
      values: { base: 'main' },
      rows: [{ oid: ROW_OID, subject: 'third', action: 'pick', message: '' }, { oid: BASE_OID, subject: 'second', action: 'reword', message: '' }],
      handlers: {},
    },
  })
  eq(attrAll(listPage, 'data-vc-rebase-row').length, 2, 'D39 待办窗口两行都画出来')
  eq(attrAll(listPage, 'data-vc-rebase-row-action').length, 2, 'D40 每行都有动作下拉')
  const firstSelect: any = attrAll(listPage, 'data-vc-rebase-row-action')[0]
  eq((firstSelect.children || []).length, 5, 'D41 动作下拉五个改写动词')
  eq(attrAll(listPage, 'data-vc-rebase-message').length, 1, 'D42 只有改说明那一行出现说明输入框')
  const upBtns: any[] = attrAll(listPage, 'data-vc-rebase-move').filter(function (n: any) { return n.props['data-vc-rebase-move'] === 'up' })
  check(upBtns.length === 2 && upBtns[0].props.disabled === true && upBtns[1].props.disabled === false, 'D43 上移按钮在第一行禁用、第二行可用')
  const downBtns: any[] = attrAll(listPage, 'data-vc-rebase-move').filter(function (n: any) { return n.props['data-vc-rebase-move'] === 'down' })
  check(downBtns.length === 2 && downBtns[0].props.disabled === false && downBtns[1].props.disabled === true, 'D44 下移按钮在最后一行禁用')
  const readsPage: any = leaf.vcRebasePageNode(fakeH, fakeT, {
    rebase: {
      state: { state: null, updateRefs: false },
      values: { base: 'main', oldBase: 'old', newBase: 'new' },
      rows: {},
      handlers: {},
      reads: {
        window: { base: 'main', commits: [{ oid: ROW_OID, subject: 'third' }], commitCount: 1 },
        onto: { oldBase: 'old', newBase: 'new', moved: [{ oid: ROW_OID, subject: 'third' }], movedCount: 1, incomingCount: 2 },
        pairs: { pairs: [{ oid: ROW_OID, kind: 'fixup', targetOid: BASE_OID }] },
        merges: { mergeCommits: [], count: 3 },
      },
    },
  })
  eq(attrAll(readsPage, 'data-vc-rebase-read').length, 4, 'D45 三块只读预览都画出来（窗口/范围/吸收对/合并代价四块卡片）')
  eq(attrAll(readsPage, 'data-vc-rebase-window-count')[0].props['data-vc-rebase-window-count'], '1', 'D46 窗口预览带提交条数')
  eq(attrAll(readsPage, 'data-vc-rebase-incoming-count')[0].props['data-vc-rebase-incoming-count'], '2', 'D47 换基座范围分开数搬走与带进来的提交')
  eq(attrAll(readsPage, 'data-vc-rebase-pair-count')[0].props['data-vc-rebase-pair-count'], '1', 'D48 自动吸收先列出将吸收的提交对')
  eq(attrAll(readsPage, 'data-vc-rebase-merge-count')[0].props['data-vc-rebase-merge-count'], '3', 'D49 保留合并结构的代价先给用户看')
  const confirmPage: any = leaf.vcRebasePageNode(fakeH, fakeT, {
    rebase: {
      state: { state: null, updateRefs: false },
      values: todoVals,
      rows: {},
      handlers: {},
      confirmOp: 'rebase-todo',
      ticketId: 'ticket-1',
      confirm: { wont: '不改远端', reversible: '可用 reflog 找回', verb: '变基' },
    },
  })
  eq(attrAll(confirmPage, 'data-vc-rebase-confirm').length, 1, 'D50 四条写动作都要显式确认后才画确认卡')
  eq(attrAll(confirmPage, 'data-vc-rebase-confirm-seg').length, 4, 'D51 确认卡四段齐全（会动什么、不会做什么、能不能回退、按哪个词执行）')
  check(attrAll(confirmPage, 'data-vc-rebase-confirm-cancel').length === 1 && attrAll(confirmPage, 'data-vc-rebase-confirm-go').length === 1, 'D52 确认卡有取消与确认两颗按钮')
  const okPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: {}, rows: { 'rebase-onto': { result: { op: 'rebase-onto', ok: true, conflicted: false, state: 'clean' } } }, handlers: {} } })
  eq(attrAll(okPage, 'data-vc-rebase-result-ok')[0].props['data-vc-rebase-result-ok'], '1', 'D53 成功结果条带成功标记')
  const conflictPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: { state: 'rebase' }, rows: { 'rebase-todo': { result: { op: 'rebase-todo', ok: true, conflicted: true, state: 'rebase' } } }, handlers: {} } })
  const conflictTexts: string[] = textAll(conflictPage).join('|')
  check(conflictTexts.indexOf('result.conflicted') >= 0 && conflictTexts.indexOf('state.rebase') >= 0, 'D54 撞冲突时结果条如实说停在变基里，不报成功（实测 ' + conflictTexts + '）')
  const failPage: any = leaf.vcRebasePageNode(fakeH, fakeT, { rebase: { state: {}, rows: { 'rebase-merges': { result: { op: 'rebase-merges', ok: false, error: { reason: 'todo-mismatch', kind: 'env', message: 'fatal: 原话' } } } }, handlers: {} } })
  const failTexts: string[] = textAll(failPage).join('|')
  check(attrAll(failPage, 'data-vc-rebase-result-ok')[0].props['data-vc-rebase-result-ok'] === '0' && failTexts.indexOf('fatal: 原话') >= 0, 'D55 失败结果条带失败标记与 git 原话')
  const clickable: any[] = findAll(cleanPage, function (n: any) { return n.props && n.props['data-log'] !== undefined })
  check(clickable.length > 0 && clickable.every(function (n: any) { return String(n.props['data-log']).indexOf('.') > 0 && n.props['data-press'] === 'button' }), 'D56 每个可点控件都有 data-log（小写点分名字）与 data-press（实测 ' + clickable.length + ' 个）')
  function stripComments(text: string) { return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') }
  check(/[\u4e00-\u9fff]/.test(stripComments(clientPageSrc)) === false, 'D57 页面叶子除注释外没有中文字面量（可见文字全走词条）')
  check(/[\u4e00-\u9fff]/.test(stripComments(clientOpsSrc)) === false, 'D58 动作叶子除注释外没有中文字面量')

  const yamlText: string = fs.readFileSync(path.join(ROOT, 'config/copy/vcrebase.yaml'), 'utf8')
  const yamlKeys: string[] = []
  const yamlRe = /^\s{2}(vc\.rebase\.[A-Za-z0-9.]+):/gm
  let yamlHit: any = yamlRe.exec(yamlText)
  while (yamlHit) { if (yamlKeys.indexOf(yamlHit[1]) < 0) yamlKeys.push(yamlHit[1]); yamlHit = yamlRe.exec(yamlText) }
  check(yamlKeys.length >= 60, 'D59 变基页词条真源至少六十条（实测 ' + yamlKeys.length + ' 条）')
  check(yamlKeys.every(function (k: string) { return (yamlText.split(k + ':').length - 1) === 2 }), 'D60 每个词条键在 zh 与 en 两段里各出现一次')
  const localeText: string = localeDataText()
  const lostKeys: string[] = yamlKeys.filter(function (k: string) { return localeText.indexOf("'" + k + "'") < 0 })
  eq(lostKeys.length, 0, 'D61 全部词条都进了界面词表生成物（缺：' + lostKeys.join(',') + '）')
  const requiredKeys: string[] = []
  ;['vc.rebase.state.clean', 'vc.rebase.state.merge', 'vc.rebase.state.rebase', 'vc.rebase.state.cherryPick', 'vc.rebase.state.revert'].forEach(function (k: string) { requiredKeys.push(k) })
  ;['pick', 'reword', 'squash', 'fixup', 'drop', 'moveUp', 'moveDown'].forEach(function (a: string) { requiredKeys.push('vc.rebase.action.' + a) })
  ;['rebaseTodo', 'rebaseOnto', 'rebaseAutosquash', 'rebaseMerges'].forEach(function (o: string) { requiredKeys.push('vc.rebase.op.' + o); requiredKeys.push('vc.rebase.op.verb.' + o) })
  ;['ok', 'fail', 'conflicted', 'retry'].forEach(function (k: string) { requiredKeys.push('vc.rebase.result.' + k) })
  ;['base', 'oldBase', 'newBase'].forEach(function (k: string) { requiredKeys.push('vc.rebase.field.' + k) })
  requiredKeys.push('vc.rebase.pageTitle', 'vc.rebase.hint', 'vc.rebase.hidden', 'vc.rebase.updateRefsOn', 'vc.rebase.target.todo', 'vc.rebase.confirm.title', 'vc.rebase.confirm.cancel', 'vc.rebase.confirm.go', 'vc.rebase.confirm.what')
  ;['window', 'ontoRange', 'pairs', 'merges'].forEach(function (k: string) { requiredKeys.push('vc.rebase.read.' + k) })
  const missingKeys: string[] = requiredKeys.filter(function (k: string) { return yamlKeys.indexOf(k) < 0 })
  eq(missingKeys.length, 0, 'D62 状态/动作/确认卡/结果/字段/预览该有的词条键都登记了（缺：' + missingKeys.join(',') + '）')
  const pageStaticKeys: string[] = []
  const tRe = /t\('([^']+)'/g
  let tHit: any = tRe.exec(clientPageSrc)
  while (tHit) { if (pageStaticKeys.indexOf(tHit[1]) < 0) pageStaticKeys.push(tHit[1]); tHit = tRe.exec(clientPageSrc) }
  const unknownPageKeys: string[] = pageStaticKeys.filter(function (k: string) { return k.indexOf('vc.writeErr.') !== 0 && k.charAt(k.length - 1) !== '.' && yamlKeys.indexOf(k) < 0 && requiredKeys.indexOf(k) < 0 })
  eq(unknownPageKeys.length, 0, 'D63 页面里用到的静态词条键都在真源里（缺：' + unknownPageKeys.join(',') + '）')
  const shellSource: string = sourceText('src/client/views/versionControl/vcShellPages.ts')
  check(shellSource.indexOf('declare function vcRebasePageNode') >= 0, 'D64 页面壳声明了变基页叶子')
  has(shellSource, "page === 'rebase'", 'D65 页面壳按页 id 挂载变基页')
  has(shellSource, 'rebase: opts.rebase', 'D66 页面壳把变基页数据透传下去')
  const buildSource: string = sourceText('scripts/build.mts')
  check(buildSource.indexOf("id: 'vcRebaseOps'") >= 0 && buildSource.indexOf("id: 'vcRebasePage'") >= 0, 'D67 构建清单登记了变基页两片叶子')
  const clientIndexSource: string = sourceText('src/client/index.ts')
  eq((clientIndexSource.match(/leaf:vcRebaseOps/g) || []).length, 1, 'D68 客户端入口有 vcRebaseOps 的叶子标记且只有一处')
  eq((clientIndexSource.match(/leaf:vcRebasePage/g) || []).length, 1, 'D69 客户端入口有 vcRebasePage 的叶子标记且只有一处')

  // 反证自检：故意把客户端动作名单改坏一处，对账必须报出来。
  const tampered: any[] = leaf.VC_REBASE_OPS.map(function (m: any) {
    if (m.op === 'rebase-merges') return Object.assign({}, m, { capId: '5.9' })
    return m
  })
  const tamperProblems: string[] = rebaseReconcile(sharedRows, tampered)
  eq(tamperProblems.length >= 1, true, 'D70 反证：客户端名单把 5.10 写成 5.9 时对账必须报错（实测 ' + tamperProblems.length + ' 条）')

  console.log('  D 组完成：' + total + ' 条')

  // ===== E 七个登记点与源码断言（写层不许自己起进程） =====
  console.log('  E 登记点与源码断言')
  const mountSource: string = sourceText('src/host/versionControlRebaseMount.ts')
  has(mountSource, 'export function createRebaseMount', 'E1 装配外壳导出 createRebaseMount')
  check(mountSource.indexOf('createRebaseScene') >= 0 && mountSource.indexOf('createRebaseCheck') >= 0 && mountSource.indexOf('createRebaseWrite') >= 0, 'E2 装配外壳懒加载并装起三片宿主叶子')
  eq((mountSource.match(/loggedPhone\(/g) || []).length, 3, 'E3 装配外壳三条电话都走 loggedPhone（host.call 日志口径）')
  const parentSource: string = sourceText('src/host/versionControl.ts')
  has(parentSource, 'createRebaseMount', 'E4 父装配文件引入变基待办装配')
  check(parentSource.indexOf('handleGitRebaseRead:') >= 0 && parentSource.indexOf('handleGitRebaseCheck:') >= 0 && parentSource.indexOf('handleGitRebaseWrite:') >= 0 && parentSource.indexOf('rebaseTickets:') >= 0, 'E5 父装配文件把三条电话与票据表挂到返回值上')
  const hostIndexSource: string = sourceText('src/host/index.ts')
  eq((hostIndexSource.match(/harness\.handle\('wf\.gitRebaseRead'/g) || []).length, 1, 'E6 宿主注册读电话且只有一处')
  eq((hostIndexSource.match(/harness\.handle\('wf\.gitRebaseCheck'/g) || []).length, 1, 'E7 宿主注册预检电话且只有一处')
  eq((hostIndexSource.match(/harness\.handle\('wf\.gitRebaseWrite'/g) || []).length, 1, 'E8 宿主注册执行电话且只有一处')
  check(hostIndexSource.split('\n').length <= 400, 'E9 宿主入口仍守四百行上限（实测 ' + hostIndexSource.split('\n').length + ' 行）')
  const timeoutsSource: string = sourceText('config/timeouts.yaml')
  check(timeoutsSource.indexOf('vcRebaseReadTimeoutMs: 15000') >= 0 && timeoutsSource.indexOf('vcRebaseWriteTimeoutMs: 30000') >= 0, 'E10 超时配置登记了变基页两条（读 15 秒、写 30 秒）')
  const genSource: string = sourceText('scripts/generate-time-config.mts')
  check(genSource.indexOf("'vcRebaseReadTimeoutMs'") >= 0 && genSource.indexOf("'vcRebaseWriteTimeoutMs'") >= 0, 'E11 时间常量生成器登记了两条新键')
  const timeGateSource: string = sourceText('tests/verify-time-config.ts')
  check(timeGateSource.indexOf("key: 'vcRebaseReadTimeoutMs'") >= 0 && timeGateSource.indexOf("key: 'vcRebaseWriteTimeoutMs'") >= 0, 'E12 时间配置门禁登记了这两条引用')
  has(sourceText('src/host/versionControlRebaseScene.ts'), 'VC_REBASE_READ_TIMEOUT_MS', 'E13 读数叶子用登记过的读超时常量')
  has(sourceText('src/host/versionControlRebaseWrite.ts'), 'VC_REBASE_WRITE_TIMEOUT_MS', 'E14 执行叶子用登记过的写超时常量')
  const reasonIds: string[] = ['update-refs-on', 'bad-todo', 'todo-too-long', 'todo-mismatch', 'missing-message', 'bad-action']
  const missingReasons: string[] = reasonIds.filter(function (r: string) { return String(reasonsMod.writeHintFor(r)) === String(reasonsMod.writeHintFor('unknown-write-failure')) })
  eq(missingReasons.length, 0, 'E15 六条新理由都在理由表里且各有话术（缺：' + missingReasons.join(',') + '）')
  const checkLeafSource: string = sourceText('src/host/versionControlRebaseCheck.ts')
  check(WRITE_IDS.every(function (id: string) { return checkLeafSource.indexOf(id) >= 0 }), 'E16 预检叶子认得四条写动作')
  check(READ_IDS.every(function (id: string) { return checkLeafSource.indexOf(id) >= 0 }), 'E17 预检叶子认得五条只读动作')
  const writeLeafSource: string = sourceText('src/host/versionControlRebaseWrite.ts')
  check(writeLeafSource.indexOf('GIT_SEQUENCE_EDITOR') >= 0 && writeLeafSource.indexOf('gitEditor') >= 0, 'E18 执行叶子把待办文件用 GIT_SEQUENCE_EDITOR 覆盖（规格第 7 节编辑器交接）')
  check(writeLeafSource.indexOf("'update-refs-on'") >= 0, 'E19 执行叶子在签票后重验 updateRefs（现场变化零进程拒绝）')
  const sceneSource: string = sourceText('src/host/versionControlRebaseScene.ts')
  check(sceneSource.indexOf('--autosquash') >= 0 && sceneSource.indexOf('--rebase-merges') >= 0, 'E20 读数叶子用干跑列出自动吸收对与合并代价')
  check(sceneSource.indexOf('rebase.updateRefs') >= 0, 'E21 读数叶子读仓库的 rebase.updateRefs 配置')
  const ledger: any = await loadModule('src/shared/version-control/src/capability-ledger.js')
  const rebaseCaps: any[] = ledger.CAPABILITIES.filter(function (c: any) { return c.page === 'rebase' && ['5.6', '5.7', '5.8', '5.10'].indexOf(c.id) >= 0 })
  eq(rebaseCaps.length, 4, 'E22 能力账本里这四条都归变基待办页')
  check(rebaseCaps.every(function (c: any) { return c.primaryEntry === '变基待办' }), 'E23 四条的主入口都是变基待办')
  const noLedgerIds: string[] = ['5.6', '5.7', '5.8', '5.10'].filter(function (id: string) { return !rebaseCaps.some(function (c: any) { return c.id === id }) })
  eq(noLedgerIds.length, 0, 'E24 账本覆盖四条能力号（缺：' + noLedgerIds.join(',') + '）')
  const hostLeaves: string[] = ['src/host/versionControlRebaseScene.ts', 'src/host/versionControlRebaseCheck.ts', 'src/host/versionControlRebaseWrite.ts', 'src/host/versionControlRebaseMount.ts']
  const selfSpawn: string[] = hostLeaves.filter(function (rel: string) { const s: string = sourceText(rel); return s.indexOf('child_process') >= 0 || /\.spawn\s*\(/.test(s) })
  eq(selfSpawn.length, 0, 'E25 写层四片叶子都不自己起进程（全部走父文件注入的 runPinned；越界：' + selfSpawn.join(',') + '）')
  const settingsGateSource: string = sourceText('tests/verify-settings-phones.ts')
  check(settingsGateSource.indexOf('check(nPhones === 91') >= 0, 'E26 宿主电话计数门禁登记到九十一条')
  const sameLayer: string = sourceText('tests/same-layer-baseline.json')
  const rebaseEntryFiles: string[] = ['versionControlRebaseMount.ts', 'versionControlRebaseScene.ts', 'versionControlRebaseCheck.ts', 'versionControlRebaseWrite.ts'].filter(function (name: string) { return sameLayer.indexOf(name) >= 0 })
  eq(rebaseEntryFiles.length, 4, 'E27 同层引用基线登记了变基页四片的装配扇入（缺：' + rebaseEntryFiles.join(',') + '）')
  const vcWriteSource: string = sourceText('src/client/views/versionControl/vcWrite.ts')
  check(reasonIds.every(function (r: string) { return vcWriteSource.indexOf("'" + r + "':") >= 0 }), 'E28 界面失败话术表登记了六条新理由（与写页同源）')
  const gateSelf: string = sourceText('tests/verify-1586-rebase.ts')
  has(gateSelf, '// 门禁归属: src/shared/version-control/src/rebase-ops.ts', 'E29 本门禁文件头写明归属源码')
  has(gateSelf, 'printGateResult(GATE, total, failed)', 'E30 本门禁按约定输出 GATE-RESULT')

  // 反证自检：账本缺一条能力号时对账必须报出来。
  function ledgerGap(ids: string[], caps: any[]) {
    return ids.filter(function (id: string) { return !caps.some(function (c: any) { return c.id === id }) })
  }
  eq(ledgerGap(['5.6', '5.7', '5.8', '5.10'], rebaseCaps).length, 0, 'E31 账本对账在四齐时没有缺口')
  eq(ledgerGap(['5.6', '5.7', '5.8', '5.10'], rebaseCaps.filter(function (c: any) { return c.id !== '5.10' })).join(','), '5.10', 'E32 反证：把 5.10 从账本拿掉，对账必须点名它')

  console.log('  E 组完成：' + total + ' 条')

}

main().then(async function () {
  await printGateResult(GATE, total, failed);
  process.exit(failed ? 1 : 0);
}).catch(function (err: any) {
  console.log('  门禁自身抛错：' + (err && err.stack ? err.stack : String(err)));
  failed += 1;
  total += 1;
  printGateResult(GATE, total, failed);
  process.exit(1);
});
