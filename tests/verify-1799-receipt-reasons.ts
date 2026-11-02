// verify-1799-receipt-reasons.ts —— #1799 门禁：非 ok 回执的 reason 只看一处映射。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1799-receipt-reasons.ts
//
// 为什么要这一段：deck 九件工具以前每件自己决定失败回执的 reason，于是同一类失败在不同
// 工具里说着不同的话（读不存在的票回 backend-unsupported、同计划并发锁也回 backend-unsupported）。
// #1799 把「kind + stage + 读/写阶段 + 本地失败来源」到八个原因码的映射收进
// src/deck/shell/receipt-reason.ts 一处。本文件逐格钉住这张映射表：
//   ① 七种本地失败来源各回哪个码；
//   ② 八档 kind 在读、写两个阶段各回哪个码；
//   ③ 房间标注的 stage（input-refused / anchor-lookup）如何盖过或改写 kind 表；
//   ④ 一批失败项里最该先告诉人的那个码（worstReason 的优先级）；
//   ⑤ 回执/失败项两种调用形状都能用，且绝不产出八个码以外的值；
//   ⑥ 一批 items 收口成顶层 reason（partial 两种形状）；
//   ⑦ 正文写后核对的失败项自带码与本地来源。
// 本文件不联网、不碰文件系统：只调纯函数。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/deck/shell/receipt-reason.ts')).href)
  const shell = await import(pathToFileURL(path.join(ROOT, 'src/deck/shell/call-shell.ts')).href)
  const R = shell.REFUSAL_REASONS
  const KNOWN = Object.keys(R).map((k) => R[k])
  const fn = (name) => typeof mod[name] === 'function'
  check(fn('reasonForFailure') && fn('reasonForResult') && fn('worstReason') && fn('failureOf'),
    'receipt-reason 导出 reasonForFailure / reasonForResult / worstReason / failureOf 四个函数')
  const { reasonForFailure, reasonForResult, worstReason, failureOf, evidenceFields, reasonForItems } = mod

  check(Object.keys(R).length === 8, '原因码仍是八个（不因本票新增码）')
  check(KNOWN.indexOf(R.BACKEND_TIMEOUT) >= 0 && KNOWN.indexOf(R.BAD_ARGS) >= 0, '八个码里含 backend-timeout 与 bad-args')

  // ① 本地失败来源：同一次失败发生在本地哪一环，下一步该做什么就不同。
  const localCases = [
    ['budget', R.BACKEND_THREW, '单次调用时间预算用尽：下一步是原样重试'],
    ['lock', R.BACKEND_THREW, '同票/同计划锁被占：下一步是稍后重试'],
    ['stale', R.BACKEND_THREW, '并发写打赢了这次：下一步是重读再改'],
    ['unconfirmed', R.BACKEND_TIMEOUT, '写下去但没等到回执：先读回确认，别盲目重试'],
    ['input', R.BAD_ARGS, '本地参数校验不过：改输入'],
    ['surface', R.OVER_CAP, '工具面规矩不允许：这件事 AI 不许做'],
    ['verify', R.BACKEND_UNSUPPORTED, '写后读回不见：后端没做到，别重试'],
  ]
  for (const c of localCases) {
    check(reasonForFailure({ phase: 'write', local: c[0] }) === c[1], '本地来源 ' + c[0] + ' → ' + c[1] + '（' + c[2] + '）')
  }

  // ②a 读阶段：读失败重试通常便宜，但「票不存在」「环境/权限/不支持」要分开。
  const readCases = [
    ['env', R.BACKEND_UNSUPPORTED], ['auth', R.BACKEND_UNSUPPORTED], ['unsupported', R.BACKEND_UNSUPPORTED],
    ['rate-limit', R.OVER_CAP], ['not-found', R.BAD_ARGS],
    ['conflict', R.BACKEND_THREW], ['network', R.BACKEND_THREW], ['parse', R.BACKEND_THREW],
    ['timeout', R.BACKEND_TIMEOUT], ['aborted', R.BACKEND_THREW], ['over-budget', R.BACKEND_THREW],
    ['backend-threw', R.BACKEND_THREW],
  ]
  for (const c of readCases) {
    check(reasonForFailure({ phase: 'read', kind: c[0] }) === c[1], '读阶段 kind ' + c[0] + ' → ' + c[1])
  }

  // ②b 写阶段：写请求发出去后「没收到回复」可能已经生效，与读阶段结论不同。
  const writeCases = [
    ['env', R.BACKEND_UNSUPPORTED], ['auth', R.BACKEND_UNSUPPORTED], ['unsupported', R.BACKEND_UNSUPPORTED],
    ['rate-limit', R.OVER_CAP], ['not-found', R.BAD_ARGS],
    ['network', R.BACKEND_TIMEOUT], ['parse', R.BACKEND_TIMEOUT], ['timeout', R.BACKEND_TIMEOUT],
    ['conflict', R.BACKEND_THREW], ['aborted', R.BACKEND_THREW], ['over-budget', R.BACKEND_THREW],
    ['backend-threw', R.BACKEND_THREW],
  ]
  for (const c of writeCases) {
    check(reasonForFailure({ phase: 'write', kind: c[0] }) === c[1], '写阶段 kind ' + c[0] + ' → ' + c[1])
  }

  // ②c 不知道 kind（或给出表外值）：停，别发明一个「重试就好」。
  for (const phase of ['read', 'write']) {
    check(reasonForFailure({ phase }) === R.BACKEND_UNSUPPORTED, phase + ' 阶段没给 kind → backend-unsupported')
    check(reasonForFailure({ phase, kind: '某个表外值' }) === R.BACKEND_UNSUPPORTED, phase + ' 阶段表外 kind → backend-unsupported')
  }

  // ③a 房间在动手前拒绝输入：无论哪一档 kind、读还是写，都是「改输入」。
  // 契约八档逐档走一遍 + 传输层四档：stage 是「房间动手前拒了输入」的事实，下一步只有改输入。
  const stageKinds = ['env', 'auth', 'rate-limit', 'conflict', 'unsupported', 'not-found', 'network', 'parse', 'timeout', 'aborted', 'over-budget', 'backend-threw']
  for (const phase of ['read', 'write']) {
    for (const kind of stageKinds) {
      check(reasonForFailure({ phase, kind, stage: 'input-refused' }) === R.BAD_ARGS,
        phase + ' 阶段 kind ' + kind + ' 带 input-refused → bad-args（不是后端做不到）')
    }
  }
  // ③b 锚回查失败是「票没建、重试安全」的读侧说明，不改变下一步判断：按读阶段算。
  // 八档逐档钉住：anchor-lookup 不该把任何一档改写成本地失败。
  const readTable = new Map(readCases)
  for (const phase of ['read', 'write']) {
    for (const kind of stageKinds) {
      check(reasonForFailure({ phase, kind, stage: 'anchor-lookup' }) === readTable.get(kind),
        phase + ' 阶段 kind ' + kind + ' 带 anchor-lookup → 按读阶段查表得 ' + readTable.get(kind))
    }
  }
  // ③c 本地来源比 stage/kind 更贴近事实：它就是这次失败的那一环。
  check(reasonForFailure({ phase: 'write', kind: 'not-found', stage: 'input-refused', local: 'verify' }) === R.BACKEND_UNSUPPORTED,
    '本地来源 verify 盖过 stage/kind')
  check(reasonForFailure({ phase: 'write', kind: 'network', local: 'unconfirmed' }) === R.BACKEND_TIMEOUT,
    '本地来源 unconfirmed 盖过 kind（写生效未确认）')

  // ④ 一批失败项里先说最要紧的那个：先确认写入是否生效，再说改输入/换路/停。
  check(worstReason([]) === '', '没有失败项 → 空串')
  check(worstReason([undefined, null, '']) === '', '失败项都没有码 → 空串')
  check(worstReason([R.BACKEND_THREW, R.GATE_DEFER, R.OVER_CAP, R.BACKEND_UNSUPPORTED, R.BAD_ARGS, R.BACKEND_TIMEOUT]) === R.BACKEND_TIMEOUT,
    '一批码里 backend-timeout 优先')
  check(worstReason([R.BACKEND_THREW, R.BACKEND_UNSUPPORTED, R.BAD_ARGS]) === R.BAD_ARGS, 'bad-args 先于 backend-unsupported')
  check(worstReason([R.BACKEND_THREW, R.OVER_CAP, R.BACKEND_UNSUPPORTED]) === R.BACKEND_UNSUPPORTED, 'backend-unsupported 先于 ai-tool-refused')
  check(worstReason([R.BACKEND_THREW, R.GATE_DEFER]) === R.GATE_DEFER, 'gate-defer 先于 backend-threw')
  check(worstReason(['表外值', R.BACKEND_THREW]) === R.BACKEND_THREW, '表外码被忽略，不参与排序')
  check(worstReason(['表外值']) === '', '只有表外码 → 空串')

  // ⑤a 失败项形状：工具手里既有「回执/结果」也有「失败项」两种形状，都要能取到同一结论。
  check(reasonForResult({ ok: false, error: { kind: 'not-found' } }, 'read') === R.BAD_ARGS, '结果形状的失败按映射走')
  check(reasonForResult({ kind: 'timeout' }, 'write') === R.BACKEND_TIMEOUT, '裸失败形状（失败项）也能映射')
  check(reasonForResult(null, 'read') === R.BACKEND_UNSUPPORTED, '没有失败详情 → backend-unsupported')
  check(reasonForResult({ ok: false, error: { kind: 'parse', stage: 'input-refused' } }, 'write') === R.BAD_ARGS,
    '结果形状里的 stage 同样生效')
  const facts = failureOf({ error: { kind: 'parse', stage: 'input-refused', message: '正文模板校验不过' } }, 'write')
  check(facts && facts.code === R.BAD_ARGS && facts.errorKind === 'parse' && facts.stage === 'input-refused',
    'failureOf 同时给出码、原始 kind 与 stage（证据不丢）')
  check(failureOf(null, 'read').code === R.BACKEND_UNSUPPORTED, 'failureOf 对空失败详情也给码')

  // ⑤c 失败证据：本地失败另带 local，后端失败另带 errorKind/stage；两边都不写空串格。
  const budgetEv = failureOf(null, 'write', 'budget')
  check(budgetEv.code === R.BACKEND_THREW && budgetEv.local === 'budget' && budgetEv.errorKind === undefined && budgetEv.stage === undefined,
    '本地额度失败的证据：code + local，没有后端 kind/stage')
  const budgetFields = evidenceFields(budgetEv)
  check(budgetFields.code === R.BACKEND_THREW && budgetFields.local === 'budget' && !('errorKind' in budgetFields) && !('kind' in budgetFields) && !('stage' in budgetFields),
    'evidenceFields 铺出来的本地失败：只有 code 与 local 两格')
  const backendEv = failureOf({ error: { kind: 'parse', stage: 'input-refused' } }, 'write')
  const backendFields = evidenceFields(backendEv)
  check(backendFields.code === R.BAD_ARGS && backendFields.kind === 'parse' && backendFields.stage === 'input-refused' && !('errorKind' in backendFields) && !('local' in backendFields),
    'evidenceFields 默认铺法（data.error 用）：code + kind + stage，没有 local')
  const backendItemFields = evidenceFields(backendEv, 'errorKind')
  check(backendItemFields.errorKind === 'parse' && !('kind' in backendItemFields),
    'items 里那一格叫 errorKind 时，键名跟着换、值不变')

  // ⑤b 绝不产出八个码以外的值。
  const probes = []
  for (const phase of ['read', 'write']) {
    for (const kind of ['env', 'auth', 'rate-limit', 'conflict', 'unsupported', 'not-found', 'network', 'parse', 'timeout', 'aborted', 'over-budget', 'backend-threw', '']) {
      probes.push(reasonForFailure({ phase, kind }))
      probes.push(reasonForFailure({ phase, kind, stage: 'input-refused' }))
      probes.push(reasonForResult({ error: { kind } }, phase))
    }
    for (const local of ['budget', 'lock', 'unconfirmed', 'input', 'surface', 'stale', 'verify']) {
      probes.push(reasonForFailure({ phase, local }))
    }
  }
  check(probes.every((code) => KNOWN.indexOf(code) >= 0), '所有映射结果都在八个已知原因码之内（' + probes.length + ' 个探针）')

  // ⑥ 一批 items 收口成顶层 reason：partial 的两种形状从这里分开。
  check(reasonForItems([]) === '', '没有 items → 空串（不是 ok 回执）')
  check(reasonForItems([{ status: 'ok' }, { status: 'ok' }]) === '', 'items 全成、只是没做完 → 空串（partial 的第一种形状）')
  check(reasonForItems([{ status: 'ok' }, { status: 'failed', code: R.BAD_ARGS }]) === R.BAD_ARGS,
    '有一项失败 → 按那一项的码（partial 的第二种形状）')
  check(reasonForItems([{ status: 'failed', code: R.BACKEND_THREW }, { status: 'failed', code: R.BACKEND_TIMEOUT }]) === R.BACKEND_TIMEOUT,
    '多项失败 → 取最该先告诉人的那个（worstReason 优先级）')
  check(reasonForItems([{ status: 'failed' }, { status: 'failed', code: '' }]) === '',
    '失败项都没带码 → 空串（不发明兜底码）')

  // ⑦ 正文写后核对的失败项自带码与来源：它以前只写一句人话，顶层于是拿不到码（#1799 回归点）。
  const twv = await import(pathToFileURL(path.join(ROOT, 'src/deck/shell/text-write-verify.ts')).href)
  const plan = { next: '', progress: null, originalWords: null, beforeProgress: '', skipped: false, strictRoundTrip: false }
  const budgetItem = twv.textWriteVerifyItem({ key: 'K', plan, body: null, failure: '', outOfBudget: true })
  check(budgetItem.status === 'failed' && budgetItem.code === R.BACKEND_THREW && budgetItem.local === 'budget' && !('errorKind' in budgetItem),
    '正文核对遇额度不够：码 backend-threw + local budget，没把本地失败写成后端档位')
  const timeoutItem = twv.textWriteVerifyItem({ key: 'K', plan, body: null, failure: '读回超时', outOfBudget: false, evidence: evidenceFields(failureOf({ kind: 'timeout' }, 'read'), 'errorKind') })
  check(timeoutItem.code === R.BACKEND_TIMEOUT && timeoutItem.errorKind === 'timeout' && !('local' in timeoutItem),
    '正文读回超时：码 backend-timeout，后端档位留在 errorKind')
  const noBodyItem = twv.textWriteVerifyItem({ key: 'K', plan, body: null, failure: '', outOfBudget: false })
  check(noBodyItem.code === R.BACKEND_TIMEOUT && noBodyItem.local === 'unconfirmed',
    '写后没读回正文：码 backend-timeout + local unconfirmed（别当成已经写好）')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
