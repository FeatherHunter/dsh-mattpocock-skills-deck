// tests/verify-suggest-next-steps.ts —— 门禁：suggest_next_steps 工具本体与独立登记（#1406）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-suggest-next-steps.ts，可独立运行。
//
// 为什么要有这一扇：这颗工具的参数里就直接带着给界面用的建议清单——界面从这次工具调用的参数本身
// 读走建议、画成气泡，工具只校验、钳制、截断、回执，不写票、不落任何状态；它又必须留在九个追踪器
// 工具之外单独登记，九工具的参数表、回执表、点数表、装配顺序一个字都不能动。两件事都很容易在后续
// 改动里被顺手破坏，
// 所以这里逐条钉住：
//   ① 参数：2~4 条合法；多于 4 条从尾部截到前 4 条并保留顺序；少于 2 条或条目缺字段整次拒绝（不补编建议）；
//   ② 超长文本按 Unicode 码点截断并补省略号，不报错；
//   ③ 回执沿用九工具那套统一回执壳（工具名、会话、耗时、结论）与既有日志事件、字段白名单；
//   ④ 工具在 agent 工具列表里、不在 DECK_TOOL_ORDER；九工具的装配顺序与文件清单仍是冻结的九条；
//   ⑤ 负向自检：把建议工具塞进装配顺序时，本门禁用的判据必须判红——只跑正向的门禁守不住任何东西。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
let total = 0
let failed = 0
function check(ok, message) {
  total += 1
  if (ok) console.log('  PASS ' + message)
  else { failed += 1; console.log('  FAIL ' + message) }
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// 九工具的冻结顺序与日志字段白名单：本文件按字面量再写一遍，改动必须两边一起改（这样才有门禁的意义）。
const ORDER = ['deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_list', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch', 'deck_issue_report']
const ALLOWED_HOST_CALL = ['method', 'latencyMs', 'ok', 'kind', 'pluginId', 'opId', 'cwdHash', 'reason']
const ALLOWED_HOST_CALL_FAIL = ['method', 'kind', 'errorHash', 'pluginId', 'errorKind', 'opId', 'cwdHash']
const EXEC = { agent: { session: { cwd: '/ws/proj', id: 'sess-7' } } }
// 真机形状的 exec：会话顶层没有目录，目录住在 header 里（#1406 真机缺口回归用）。
const EXEC_HEADER_CWD = { agent: { session: { header: { cwd: '/ws/hdr', id: 'sess-hdr' } } } }
const EXEC_HEADER_WORKSPACE = { agent: { session: { header: { workspaceRoot: '/ws/hdr-root', id: 'sess-hdr2' } } } }
const SPEC_DESCRIPTION = '在回复末尾推荐 2~4 条下一步提示词，界面会显示成气泡；只在有明确下一步时调用。'

function makeLog() {
  const fired = []
  return {
    fired: fired,
    log: { fire: function (level, event, fields) { fired.push({ level: level, event: event, fields: fields }) } },
  }
}
/** 假时钟：每次读都前进 5 毫秒，回执里的耗时因此可预期（不依赖真实时间）。 */
function fakeClock(start) {
  let t = start
  return function () { const value = t; t += 5; return value }
}
function keysWithin(fields, allowed) {
  return Object.keys(fields || {}).every((k) => allowed.indexOf(k) >= 0)
}

// 九工具冻结判据：本门禁自己的实现，也被负向自检用来证明「塞进去就会红」。
function orderGateHolds(order, factories, files) {
  if (!Object.isFrozen(order) || !Object.isFrozen(factories) || !Object.isFrozen(files)) return false
  if (!Array.isArray(order) || order.length !== 9) return false
  if (!Array.isArray(factories) || factories.length !== 9) return false
  if (!Array.isArray(files) || files.length !== 9) return false
  if (order.join(',') !== ORDER.join(',')) return false
  if (order.indexOf('suggest_next_steps') >= 0) return false
  if (files.some((f) => String(f).indexOf('suggest') >= 0)) return false
  return true
}

async function main() {
  const tool = await imp('src/deck/tools/suggest-next-steps.ts')
  const def = tool.definition

  // ── 1. 工具定义：名字、一句话介绍、参数形状（本票冻结，界面票照它读） ──
  check(def && def.name === 'suggest_next_steps', '工具名精确为 suggest_next_steps（不带 deck_ 前缀）')
  check(def.description === SPEC_DESCRIPTION, '一句话介绍与规格原句一致')
  check(def.parameters && def.parameters.type === 'object', '参数顶层是对象模式')
  check(Array.isArray(def.parameters.required) && def.parameters.required.indexOf('items') >= 0, 'items 是必填参数')
  check(def.parameters.additionalProperties === false, '参数顶层不收未知字段')
  const itemsSpec = def.parameters.properties && def.parameters.properties.items
  check(itemsSpec && itemsSpec.type === 'array', 'items 是数组')
  check(String(itemsSpec.description || '').indexOf('2~4') >= 0, 'items 的说明写明 2~4 条')
  check(itemsSpec.items && itemsSpec.items.type === 'object', 'items 的每一项是对象')
  const promptSpec = itemsSpec.items.properties && itemsSpec.items.properties.prompt
  const reasonSpec = itemsSpec.items.properties && itemsSpec.items.properties.reason
  check(promptSpec && promptSpec.type === 'string' && String(promptSpec.description || '').indexOf('/to-tickets') >= 0, 'prompt 是可执行提示词（说明里带例子）')
  check(reasonSpec && reasonSpec.type === 'string' && String(reasonSpec.description || '').indexOf('为什么') >= 0, 'reason 是一句话理由')
  check(Array.isArray(itemsSpec.items.required) && itemsSpec.items.required.join(',') === 'prompt,reason', '每条必须同时给 prompt 与 reason')
  check(itemsSpec.items.additionalProperties === false, '每条不收未知字段')
  // 注册表只接受受支持的 JSON Schema 子集（没有 minItems / maxItems），2~4 的约束由代码钳制，
  // 所以这里反过来钉住：参数模式里不许出现这两个关键字，否则真机注册会被拒。
  check(JSON.stringify(def.parameters).indexOf('minItems') < 0 && JSON.stringify(def.parameters).indexOf('maxItems') < 0,
    '参数模式不带 minItems / maxItems（注册表子集不支持，约束由代码钳制）')
  check(tool.MIN_ITEMS === 2 && tool.MAX_ITEMS === 4, '上下限常量是 2 与 4')
  check(tool.PROMPT_MAX_CHARS === 500 && tool.REASON_MAX_CHARS === 200, '单项文本上限是 500 与 200 个码点')

  // ── 2. 参数校验与钳制：纯函数结论（不经过回执壳，先把规矩钉死） ──
  const resolve = tool.resolveSuggestItems
  const two = [{ prompt: '/to-tickets', reason: '把规格拆成实施票' }, { prompt: '继续实现', reason: '接着做下一票' }]
  const r2 = resolve({ items: two })
  check(r2.accepted === true && r2.reason === '', '两条合法建议被接受')
  check(r2.items.length === 2 && r2.items[0].prompt === '/to-tickets' && r2.items[1].reason === '接着做下一票', '条目内容原样保留')
  check(r2.counts.received === 2 && r2.counts.returned === 2 && r2.counts.clipped === 0, '两条的计数如实')
  const r3 = resolve({ items: two.concat([{ prompt: '第三条', reason: '理由三' }]) })
  check(r3.accepted === true && r3.counts.returned === 3, '三条合法建议被接受')
  const r4 = resolve({ items: two.concat([{ prompt: '第三条', reason: '理由三' }, { prompt: '第四条', reason: '理由四' }]) })
  check(r4.accepted === true && r4.counts.returned === 4, '四条合法建议被接受')
  const r0 = resolve({ items: [] })
  check(r0.accepted === false && r0.reason === 'bad-args' && r0.counts.received === 0, '零条建议整次拒绝')
  check(r0.items.length === 0 && r0.notes.indexOf('too-few:0') >= 0, '零条拒绝时不补编建议、并记下条数')
  const r1 = resolve({ items: [two[0]] })
  check(r1.accepted === false && r1.reason === 'bad-args' && r1.notes.indexOf('too-few:1') >= 0, '一条建议整次拒绝（不补编第二条）')
  const rNoArray = resolve({ items: 'nope' })
  check(rNoArray.accepted === false && rNoArray.notes.indexOf('bad-items:not-array') >= 0, 'items 不是数组时拒绝')
  const rNoArg = resolve(null)
  check(rNoArg.accepted === false && rNoArg.reason === 'bad-args', '参数整个为空时拒绝')
  const rMissingPrompt = resolve({ items: [{ prompt: '', reason: '理由' }, two[1]] })
  check(rMissingPrompt.accepted === false && rMissingPrompt.notes.indexOf('bad-item:1') >= 0, '第一条缺提示词时整次拒绝')
  const rMissingReason = resolve({ items: [two[0], { prompt: '下一步', reason: '   ' }] })
  check(rMissingReason.accepted === false && rMissingReason.notes.indexOf('bad-item:2') >= 0, '第二条理由为空时整次拒绝')
  const rFlatEntry = resolve({ items: [two[0], 'not-an-object'] })
  check(rFlatEntry.accepted === false && rFlatEntry.notes.indexOf('bad-item:2') >= 0, '条目不是对象时整次拒绝')
  const five = two.concat([{ prompt: '第三条', reason: '理由三' }, { prompt: '第四条', reason: '理由四' }, { prompt: '第五条', reason: '理由五' }])
  const r5 = resolve({ items: five })
  check(r5.accepted === true && r5.items.length === 4, '多于四条截到四条')
  check(r5.items[0].prompt === '/to-tickets' && r5.items[3].prompt === '第四条', '截断保留前四条且保序')
  check(r5.counts.received === 5 && r5.counts.returned === 4 && r5.notes.indexOf('trimmed:5→4') >= 0, '截断的条数如实记下')
  const r9 = resolve({ items: Array.from({ length: 9 }, (_, i) => ({ prompt: '提示' + i, reason: '理由' + i })) })
  check(r9.accepted === true && r9.items.length === 4 && r9.items[0].prompt === '提示0', '九条也只留前四条')
  const longPrompt = '长'.repeat(600)
  const longReason = '理由'.repeat(200)
  const rLong = resolve({ items: [{ prompt: longPrompt, reason: longReason }, two[1]] })
  check(rLong.accepted === true, '单项超长不报错、仍然接受')
  check(Array.from(rLong.items[0].prompt).length === 500 && rLong.items[0].prompt.slice(-1) === '…', '超长提示词截到 500 个码点并补省略号')
  check(Array.from(rLong.items[0].reason).length === 200 && rLong.items[0].reason.slice(-1) === '…', '超长理由截到 200 个码点并补省略号')
  check(rLong.counts.clipped === 1 && rLong.notes.indexOf('clipped:1') >= 0, '被截断的条数如实记下')
  const emoji = '😀'.repeat(600)
  const rEmoji = resolve({ items: [{ prompt: emoji, reason: '表情' }, two[1]] })
  check(rEmoji.accepted === true && Array.from(rEmoji.items[0].prompt).length === 500 && rEmoji.items[0].prompt.slice(-1) === '…',
    '按码点截断，不切坏 emoji（代理对完整）')
  const boundary = resolve({ items: [{ prompt: 'a'.repeat(500), reason: 'b'.repeat(200) }, two[1]] })
  check(boundary.accepted === true && boundary.counts.clipped === 0, '正好卡在上限的文本不截断')
  const trimmed = resolve({ items: [{ prompt: '  /to-tickets  ', reason: '  理由  ' }, two[1]] })
  check(trimmed.items[0].prompt === '/to-tickets' && trimmed.items[0].reason === '理由', '首尾空白被去掉')

  // ── 3. run 的成功回执：统一回执壳、会话、耗时、结论 ──
  const okLog = makeLog()
  const okRunner = tool.createSuggestNextSteps({ log: okLog.log, now: fakeClock(1000) })
  const okEnv = await okRunner.run(EXEC, { items: two })
  check(okEnv.ok === true && okEnv.status === 'ok' && okEnv.tool === 'suggest_next_steps' && okEnv.reason === '',
    '成功回执：ok/status/tool/reason 四格照统一回执壳')
  check(typeof okEnv.text === 'string' && okEnv.text.indexOf('已记下 2 条') >= 0, '成功回执给一句结论')
  check(okEnv.workspace && okEnv.workspace.root === '/ws/proj' && okEnv.workspace.sessionId === 'sess-7',
    '成功回执带会话的目录与会话号')
  check(typeof okEnv.workspace.key === 'string' && okEnv.workspace.key.indexOf('ws-') === 0 && typeof okEnv.workspace.source === 'string',
    '成功回执带工作区键与目录来源')
  check(okEnv.data && Array.isArray(okEnv.data.items) && okEnv.data.items.length === 2 && okEnv.data.items[0].prompt === '/to-tickets',
    '成功回执带建议清单本身（界面按参数读，回执里也如实带一份）')
  check(okEnv.data.counts.received === 2 && okEnv.data.counts.returned === 2 && okEnv.data.counts.clipped === 0, '成功回执带计数')
  check(Array.isArray(okEnv.notes) && okEnv.notes.length === 0, '没有钳制时 notes 为空')
  check(okEnv.tookMs === 5, '成功回执带耗时（假时钟下可预期）')
  check(okEnv.ok === true && okEnv.status === 'ok' && !!okEnv.text && !!okEnv.tool, '回执五格底座齐全')

  // ── 4. 日志口径：只用既有事件与字段白名单，不记原文与会话号 ──
  check(okLog.fired.length === 1, '成功调用只落一行日志')
  const okLine = okLog.fired[0] || {}
  check(okLine.level === 'info' && okLine.event === 'host.call', '成功日志是既有事件 host.call（info）')
  check(okLine.fields && okLine.fields.method === 'suggest_next_steps' && okLine.fields.kind === 'deck-tool' && okLine.fields.ok === true,
    '成功日志带工具名、种类与成功标记')
  check(okLine.fields && okLine.fields.latencyMs === 5, '成功日志带耗时')
  check(okLine.fields && okLine.fields.reason === 'items=2;returned=2;clipped=0', '成功日志的 reason 记清条数与截断数')
  check(okLine.fields && /^[0-9a-f]{8}$/.test(String(okLine.fields.cwdHash || '')), '成功日志记工作区散列（不记原文路径）')
  check(keysWithin(okLine.fields, ALLOWED_HOST_CALL), '成功日志字段都在白名单内')
  check(JSON.stringify(okLine.fields).indexOf('sess-7') < 0, '日志里不出现会话号原文')

  const trimLog = makeLog()
  const trimRunner = tool.createSuggestNextSteps({ log: trimLog.log, now: fakeClock(0) })
  const trimEnv = await trimRunner.run(EXEC, { items: five })
  check(trimEnv.ok === true && trimEnv.data.items.length === 4 && trimEnv.notes.indexOf('trimmed:5→4') >= 0, 'run 也把多于四条的截断如实带回执')
  check(trimLog.fired[0] && trimLog.fired[0].fields.reason === 'items=5;returned=4;clipped=0', '截断的条数进日志 reason')

  const clipLog = makeLog()
  const clipRunner = tool.createSuggestNextSteps({ log: clipLog.log, now: fakeClock(0) })
  const clipEnv = await clipRunner.run(EXEC, { items: [{ prompt: longPrompt, reason: longReason }, two[1]] })
  check(clipEnv.ok === true && clipEnv.notes.indexOf('clipped:1') >= 0, '截断信息也带回执的 notes')
  check(clipLog.fired[0] && clipLog.fired[0].fields.reason === 'items=2;returned=2;clipped=1', '截断的条数进日志 reason')

  // ── 5. run 的拒绝回执：稳定标记，不靠 items 长度 ──
  const badLog = makeLog()
  const badRunner = tool.createSuggestNextSteps({ log: badLog.log, now: fakeClock(0) })
  const badEnv = await badRunner.run(EXEC, { items: [two[0]] })
  check(badEnv.ok === false && badEnv.status === 'unsupported' && badEnv.reason === 'bad-args', '少于两条：拒绝回执带稳定的 unsupported 与 bad-args')
  check(typeof badEnv.text === 'string' && badEnv.text.indexOf('少于 2 条') >= 0, '拒绝回执说明为什么没记下')
  check(badEnv.data === undefined, '拒绝回执不带建议清单')
  check(badEnv.workspace && badEnv.workspace.sessionId === 'sess-7', '拒绝回执仍带会话（界面与日志能对上）')
  check(badLog.fired.length === 1 && badLog.fired[0].fields.ok === false && badLog.fired[0].fields.reason === 'bad-args:1', '拒绝也落既有事件，ok 为假、条数在 reason')
  const badMissing = await badRunner.run(EXEC, { items: [two[0], { prompt: '下一步', reason: '' }] })
  check(badMissing.ok === false && String(badMissing.text).indexOf('第 2 条') >= 0, '条目缺理由时拒绝并指出第几条')
  const noSessionLog = makeLog()
  const noSessionRunner = tool.createSuggestNextSteps({ log: noSessionLog.log, now: fakeClock(0) })
  const noSession = await noSessionRunner.run({}, { items: two })
  check(noSession.ok === false && noSession.reason === 'no-session-context' && typeof noSession.text === 'string', '没有会话目录时如实拒绝（no-session-context）')
  check(noSessionLog.fired[0] && noSessionLog.fired[0].fields.reason === 'no-session-context', '没有会话目录也落一行日志')
  const aborted = await noSessionRunner.run({ signal: { aborted: true } }, { items: two })
  check(aborted.ok === false && aborted.reason === 'aborted', '已中止的调用立刻如实回（aborted）')
  const nonObject = await badRunner.run(EXEC, 'not-an-object')
  check(nonObject.ok === false && nonObject.reason === 'bad-args' && nonObject.data === undefined, '参数不是对象时拒绝')
  const plainRunner = tool.createSuggestNextSteps()
  const plainEnv = await plainRunner.run(EXEC, { items: two })
  check(plainEnv.ok === true && plainEnv.status === 'ok', '没有日志口也能正常回执')
  const brokenLogRunner = tool.createSuggestNextSteps({ log: { fire: function () { throw new Error('日志坏了') } } })
  let brokenCrashed = false
  let brokenEnv = null
  try { brokenEnv = await brokenLogRunner.run(EXEC, { items: two }) } catch (e) { brokenCrashed = true }
  check(!brokenCrashed && brokenEnv && brokenEnv.ok === true, '日志口抛错也不影响工具回执（不向对话冒泡）')

  // ── 5b. 真机会话目录在 header 里：本工具自己的回退（#1406 真机缺口回归） ──
  // 九颗追踪器工具由宿主代执行，代执行那层会先造一个带 cwd 的 exec；本工具在行里本地执行，
  // exec 是平台原生形状——桌面真机上会话顶层没有目录，目录住在 exec.agent.session.header 里。
  // 这里按真机形状复现：只有 header.cwd 时必须成功，且回执与日志都能对上目录与会话号。
  const keyMod = await imp('src/refresh/contract/workspace-keys.ts')
  const hdrLog = makeLog()
  const hdrRunner = tool.createSuggestNextSteps({ log: hdrLog.log, now: fakeClock(0) })
  const hdrEnv = await hdrRunner.run(EXEC_HEADER_CWD, { items: two })
  check(hdrEnv.ok === true && hdrEnv.status === 'ok', '只有 header.cwd 时也能拿到会话、正常回执')
  check(hdrEnv.workspace && hdrEnv.workspace.root === '/ws/hdr', '工作区根取自 header.cwd')
  check(hdrEnv.workspace && hdrEnv.workspace.sessionId === 'sess-hdr', '会话号取自 header.id')
  check(hdrEnv.workspace && hdrEnv.workspace.source === 'exec.agent.session.header.cwd', '回执如实记下目录来自 header.cwd 这一格')
  check(hdrEnv.workspace && hdrEnv.workspace.key === 'ws-' + keyMod.hash8('/ws/hdr'), '工作区键按 header 目录的短散列兜底')
  check(hdrEnv.data && Array.isArray(hdrEnv.data.items) && hdrEnv.data.items.length === 2 && hdrEnv.data.items[0].prompt === '/to-tickets',
    'header 回退下建议清单照常回执')
  check(hdrLog.fired.length === 1 && hdrLog.fired[0].event === 'host.call' && hdrLog.fired[0].fields.ok === true,
    'header 回退下成功日志仍是 host.call 且 ok 为真')
  check(hdrLog.fired[0] && hdrLog.fired[0].fields.cwdHash === keyMod.hash8('/ws/hdr'), 'header 回退下日志记工作区散列')
  check(hdrLog.fired[0] && hdrLog.fired[0].fields.reason === 'items=2;returned=2;clipped=0', 'header 回退下日志 reason 照旧记条数')
  check(hdrLog.fired[0] && keysWithin(hdrLog.fired[0].fields, ALLOWED_HOST_CALL), 'header 回退下日志字段都在白名单内')
  const hdrWsLog = makeLog()
  const hdrWsRunner = tool.createSuggestNextSteps({ log: hdrWsLog.log, now: fakeClock(0) })
  const hdrWsEnv = await hdrWsRunner.run(EXEC_HEADER_WORKSPACE, { items: two })
  check(hdrWsEnv.ok === true && hdrWsEnv.workspace && hdrWsEnv.workspace.root === '/ws/hdr-root', 'header.workspaceRoot 也能取到目录')
  check(hdrWsEnv.workspace && hdrWsEnv.workspace.source === 'exec.agent.session.header.workspaceRoot',
    '回执如实记下目录来自 header.workspaceRoot 这一格')
  check(hdrWsEnv.workspace && hdrWsEnv.workspace.sessionId === 'sess-hdr2', 'header 回退下会话号仍能取到')
  // 顶层有目录时以共享壳为准（补回退不能改既有优先级）。
  check(okEnv.workspace && okEnv.workspace.source === 'exec.agent.session.cwd', '顶层有目录时仍走共享壳，目录来源不变')
  // 两处都没有才拒绝，且正文用本工具自己的说法（建议工具不写票，别搬追踪器那句「不动任何票」）。
  const noCtxLog = makeLog()
  const noCtxRunner = tool.createSuggestNextSteps({ log: noCtxLog.log, now: fakeClock(0) })
  const noCtx = await noCtxRunner.run({ agent: { session: { header: {} } } }, { items: two })
  check(noCtx.ok === false && noCtx.reason === 'no-session-context', 'header 里也没有目录时仍如实拒绝')
  check(String(noCtx.text || '').indexOf('没法记录建议') >= 0 && String(noCtx.text || '').indexOf('不动任何票') < 0,
    '拒绝正文用本工具的口径（不写票）')
  check(noCtxLog.fired[0] && noCtxLog.fired[0].fields.reason === 'no-session-context', 'header 也取不到时仍落一行日志')

  // ── 6. 独立登记：agent 工具列表里有它，九工具顺序表里没有它 ──
  const row = await imp('src/deck/registration/agent-row.ts')
  const registered = []
  const rowSvc = {
    register: function (entry) {
      if (registered.some((t) => t.name === entry.name)) throw new Error('重复注册：' + String(entry.name))
      registered.push(entry)
      return function () {}
    },
  }
  let rowCrashed = null
  try { row.apply({ tools: rowSvc }) } catch (e) { rowCrashed = e }
  check(!rowCrashed, '行模块应用不抛')
  const rowNames = registered.map((t) => t.name)
  check(rowNames.length === 11, '行模块交出十一个工具（九个追踪器 + 探针 + 建议）')
  check(rowNames.slice(0, 9).join(',') === ORDER.join(','), '前九个工具的名字与顺序仍是冻结的 DECK_TOOL_ORDER')
  check(rowNames[9] === 'deck_probe' && rowNames[10] === 'suggest_next_steps', '探针与建议工具排在九工具之后，各自独立登记')
  const suggestReg = registered.filter((t) => t.name === 'suggest_next_steps')[0]
  check(!!suggestReg && typeof suggestReg.execute === 'function', '建议工具交出了可执行的注册数据')
  check(!!suggestReg && suggestReg.timeoutMs === 300000, '建议工具的调用上限沿用工具超时（300000 毫秒）')
  check(!!suggestReg && suggestReg.output && suggestReg.output.schema && typeof suggestReg.output.render === 'function', '建议工具的输出模式与渲染齐全')
  check(!!suggestReg && suggestReg.parameters === def.parameters, '注册交出的参数模式就是工具定义那一份（不另抄）')
  const regEnv = suggestReg ? await suggestReg.execute({ items: two }, EXEC) : null
  check(!!regEnv && regEnv.ok === true && regEnv.status === 'ok' && regEnv.data && regEnv.data.items.length === 2,
    '注册数据里的执行函数直接给回统一回执壳')
  const regBad = suggestReg ? await suggestReg.execute({ items: [] }, EXEC) : null
  check(!!regBad && regBad.ok === false && regBad.reason === 'bad-args', '注册数据的执行函数对坏参数也回拒绝回执（不抛）')

  // ── 7. 登记入口：服务不在、重复注册都只回结果，不抛 ──
  const registerMod = await imp('src/deck/registration/suggest-steps-register.ts')
  const missingService = registerMod.registerSuggestNextSteps(null)
  check(missingService.registered === false && missingService.reason === 'no-tools-service', '工具服务不在时如实回 no-tools-service')
  const onceSvc = {
    count: 0,
    register: function (entry) {
      this.count += 1
      if (this.count > 1) throw new Error('注册表已经有 ' + String(entry.name))
      return function () {}
    },
  }
  const firstReg = registerMod.registerSuggestNextSteps(onceSvc)
  const secondReg = registerMod.registerSuggestNextSteps(onceSvc)
  check(firstReg.registered === true, '第一次登记成功')
  check(secondReg.registered === false && secondReg.reason.indexOf('register-failed:') === 0, '重复登记只回失败原因，不抛')

  // ── 8. 宿主接线用的钩子：等到服务再登记，成败都落既有日志 ──
  const hookLog = makeLog()
  const hookSvc = { register: function () { return function () {} } }
  const hookRes = await registerMod.hookSuggestNextSteps({ tools: hookSvc }, { log: hookLog.log, now: fakeClock(0) }, { retries: 0 })
  check(hookRes.registered === true, '钩子拿到服务就登记')
  check(hookLog.fired.length === 1 && hookLog.fired[0].event === 'host.call' && hookLog.fired[0].fields.ok === true,
    '钩子成功落一行 host.call')
  check(hookLog.fired[0] && hookLog.fired[0].fields.method === 'suggest_next_steps.register' && hookLog.fired[0].fields.kind === 'deck-tool',
    '钩子日志方法名与种类固定')
  check(hookLog.fired[0] && keysWithin(hookLog.fired[0].fields, ALLOWED_HOST_CALL), '钩子成功日志字段都在白名单内')
  const hookFailLog = makeLog()
  const hookFail = await registerMod.hookSuggestNextSteps({}, { log: hookFailLog.log, now: fakeClock(0) }, { retries: 0, waitMs: 0 })
  check(hookFail.registered === false && hookFail.reason === 'no-tools-service', '钩子等不到服务时如实回 no-tools-service')
  check(hookFailLog.fired.length === 1 && hookFailLog.fired[0].event === 'host.call.fail' && hookFailLog.fired[0].fields.errorKind === 'missing-dep',
    '钩子失败落 host.call.fail 并标缺失依赖')
  check(hookFailLog.fired[0] && keysWithin(hookFailLog.fired[0].fields, ALLOWED_HOST_CALL_FAIL), '钩子失败日志字段都在白名单内')
  let hookCrashed = false
  try { await registerMod.hookSuggestNextSteps(null, null, { retries: 0, waitMs: 0 }) } catch (e) { hookCrashed = true }
  check(!hookCrashed, '钩子对空上下文也不抛（行起不来不连累整行）')

  // ── 8b. Cordis 风格上下文：读没 inject 的服务属性会抛，钩子必须 resolve 而不是 reject ──
  // 真机启动崩溃（#1406 补的回归用例）：dsh 的 ctx 是 Proxy，读 ctx.tools 会抛
  // 「cannot get property "tools" without inject」。async 钩子把这一抛漏出去，就是未处理的
  // rejected Promise，宿主加载期判致命、退出码 1。这里用 Proxy 复现那一下，钉住两层兜底：
  // 取服务本身不抛（回 no-tools-service），以及 tools 抛了还能走 ctx.get('tools') 的回退分支。
  const guardedLog = makeLog()
  const guardedCtx = new Proxy({}, {
    get: function (target, prop) {
      if (prop === 'tools') throw new Error('cannot get property "tools" without inject')
      return Reflect.get(target, prop)
    },
  })
  let guardedRejected = false
  let guardedRes = null
  try {
    guardedRes = await registerMod.hookSuggestNextSteps(guardedCtx, { log: guardedLog.log, now: fakeClock(0) }, { retries: 0, waitMs: 0 })
  } catch (e) { guardedRejected = true }
  check(!guardedRejected, 'Cordis 风格上下文（读 tools 即抛）下钩子不 reject')
  check(guardedRes && guardedRes.registered === false && guardedRes.reason === 'no-tools-service', 'Cordis 风格上下文下如实回 no-tools-service')
  check(guardedLog.fired.length === 1 && guardedLog.fired[0].event === 'host.call.fail' && guardedLog.fired[0].fields.errorKind === 'missing-dep',
    'Cordis 风格上下文下登记失败仍落 host.call.fail')

  const fallbackSvc = { register: function () { return function () {} } }
  const fallbackCtx = new Proxy({}, {
    get: function (target, prop) {
      if (prop === 'tools') throw new Error('cannot get property "tools" without inject')
      if (prop === 'get') return function (name) { return name === 'tools' ? fallbackSvc : undefined }
      return Reflect.get(target, prop)
    },
  })
  const fallbackRes = await registerMod.hookSuggestNextSteps(fallbackCtx, { log: makeLog().log, now: fakeClock(0) }, { retries: 0, waitMs: 0 })
  check(fallbackRes.registered === true, '读 tools 抛错但 ctx.get("tools") 有服务时仍能登记（回退分支有效）')

  // ── 8c. 宿主接线源码守卫：登记 Promise 必须挂 .catch ──
  // 同步 try/catch 抓不到 async 函数返回的 rejected Promise，所以接线处必须另有 .catch。
  // 这条守卫看的是接线源码本身：只改回同步 try/catch 时，门禁立刻红。
  const wiringSource = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/refresh-runtime.ts'), 'utf8')
  const wiringCallAt = wiringSource.indexOf('hookSuggestNextSteps(')
  const wiringTail = wiringCallAt >= 0 ? wiringSource.slice(wiringCallAt, wiringCallAt + 240) : ''
  check(wiringCallAt >= 0, '宿主接线里仍在调用建议工具登记钩子')
  check(wiringTail.indexOf('.catch(') >= 0, '宿主接线给登记钩子的 Promise 挂了 .catch 兜底（异步异常不会逃逸）')

  // ── 9. 锁九：DECK_TOOL_ORDER / 工厂表 / 文件清单仍是冻结的九条 ──
  const orderMod = await imp('src/deck/rules/tool-order.ts')
  const assembleMod = await imp('src/deck/registration/host-assemble.ts')
  check(orderMod.DECK_TOOL_ORDER.length === 9 && orderMod.DECK_TOOL_ORDER.join(',') === ORDER.join(','), 'DECK_TOOL_ORDER 仍是冻结的九条顺序')
  check(orderMod.DECK_TOOL_ORDER.indexOf('suggest_next_steps') < 0, '建议工具没有被塞进 DECK_TOOL_ORDER')
  check(orderMod.DECK_TOOL_ORDER.indexOf('deck_probe') < 0, '探针也不在 DECK_TOOL_ORDER（单独登记的先例没变）')
  check(Object.isFrozen(orderMod.DECK_TOOL_ORDER), 'DECK_TOOL_ORDER 仍是冻结数组')
  check(assembleMod.DECK_TOOL_FACTORIES.length === 9 && Object.isFrozen(assembleMod.DECK_TOOL_FACTORIES), 'DECK_TOOL_FACTORIES 仍是九个冻结工厂')
  check(assembleMod.DECK_TOOL_FILES.length === 9 && Object.isFrozen(assembleMod.DECK_TOOL_FILES), 'DECK_TOOL_FILES 仍是九个冻结文件')
  check(assembleMod.DECK_TOOL_FILES.every((f) => String(f).indexOf('suggest') < 0), '文件清单里没有建议工具（不进九工具装配）')
  check(orderGateHolds(orderMod.DECK_TOOL_ORDER, assembleMod.DECK_TOOL_FACTORIES, assembleMod.DECK_TOOL_FILES), '锁九判据对真实数据成立')

  // ── 10. 负向自检：把建议工具塞进装配顺序 / 打乱顺序 / 少一个工厂时，判据必须红 ──
  const fakeOrderAppended = Object.freeze(ORDER.concat(['suggest_next_steps']))
  check(!orderGateHolds(fakeOrderAppended, assembleMod.DECK_TOOL_FACTORIES, assembleMod.DECK_TOOL_FILES),
    '负向自检：建议工具被塞进装配顺序时判据必须红')
  const fakeOrderSwapped = Object.freeze(['deck_issue_get', 'deck_context'].concat(ORDER.slice(2)))
  check(!orderGateHolds(fakeOrderSwapped, assembleMod.DECK_TOOL_FACTORIES, assembleMod.DECK_TOOL_FILES),
    '负向自检：九工具顺序被打乱时判据必须红')
  check(!orderGateHolds(orderMod.DECK_TOOL_ORDER, Object.freeze(assembleMod.DECK_TOOL_FACTORIES.slice(0, 8)), assembleMod.DECK_TOOL_FILES),
    '负向自检：工厂少一个时判据必须红')
  check(!orderGateHolds(orderMod.DECK_TOOL_ORDER, assembleMod.DECK_TOOL_FACTORIES, Object.freeze(assembleMod.DECK_TOOL_FILES.concat(['src/deck/tools/suggest-next-steps.js']))),
    '负向自检：建议工具混进文件清单时判据必须红')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  printGateResult('verify-suggest-next-steps', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
