// tests/verify-1409-suggest-stream.ts —— 门禁：界面借会话事件流的取数通路（#1409）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1409-suggest-stream.ts（可独立运行）。
//
// 为什么要有这一扇：这条通路要做的事很小，但每一格都容易在后续改动里被顺手破坏 ——
//   ① 只借官方界面已经保持着的订阅（sessions.binding(sid).eventSource），绝不 retain 保活；
//   ② 只认 durable 的调用事件（原生预设 tool/call、PTC 预设 tool/ptc-dispatch-start），别把历史
//      重放（replace）或流式增量当成新调用；
//   ③ 等同一轮的 turn/end 再交付，不靠计时器；同一编号只交付一次；同一轮两次以后来的为准；
//   ④ 参数解析失败、形状不对、条数不够时不出结果、只记日志；拿不到事件流安静不做；
//   ⑤ 日志只落散列与计数，绝不落提示词与理由原文。
// 所以这里用假事件流逐条断言外部行为（交付了什么、记了什么日志），再用源码守卫钉住
// 「不许 retain」「不许新增定时器」「挂载点在状态栏里」「界面与工具两侧的上下限一致」。
const fs = require('fs')
const path = require('path')
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

const SID = 'sess-1409-probe'
const GOOD_ARGS = JSON.stringify({ items: [
  { prompt: '/to-tickets', reason: '把计划拆成票' },
  { prompt: '/grill', reason: '先拷问一下方案' },
] })
// PTC 预设的事件形态：参数必须是结构化对象（平台在派发前已解析过），不是 JSON 文本。
const PTC_ITEMS = { items: [
  { prompt: '/ptc-one', reason: 'PTC 里的第一条' },
  { prompt: '/ptc-two', reason: 'PTC 里的第二条' },
] }

function callEvent(callId, turn, args, name) {
  return { type: 'tool/call', data: { turn: turn, step: 1, callId: callId, name: name || 'suggest_next_steps', arguments: args } }
}
function ptcCallEvent(subCallId, args, name) {
  return { type: 'tool/ptc-dispatch-start', data: {
    rootCallId: 'call_root', parentCallId: 'call_root', subCallId: subCallId,
    name: name || 'suggest_next_steps', arguments: args,
  } }
}
function startEvent(turn) {
  return { type: 'turn/start', data: { turn: turn, step: 1 } }
}
function endEvent(turn) {
  return { type: 'turn/end', data: { turn: turn, reason: { kind: 'completed' } } }
}

/** 抓日志：把内核的 isEnabled / log 换成测试替身，跑完必须 restore（否则后面的场景互相串味）。 */
function captureLog() {
  const records = []
  const prevEnabled = globalThis.isEnabled
  const prevLog = globalThis.log
  let enabled = true
  globalThis.isEnabled = function () { return enabled }
  globalThis.log = function (level, event, fields) { records.push({ level: level, event: event, fields: fields || {} }) }
  return {
    records: records,
    setEnabled: function (value) { enabled = value },
    restore: function () {
      if (prevEnabled === undefined) delete globalThis.isEnabled
      else globalThis.isEnabled = prevEnabled
      if (prevLog === undefined) delete globalThis.log
      else globalThis.log = prevLog
    },
  }
}
function rowsOf(records, event) { return records.filter(function (r) { return r.event === event }) }
function lastOutcome(records, event) {
  const rows = rowsOf(records, event)
  return rows.length ? rows[rows.length - 1].fields.outcome : ''
}
function hasOutcome(records, event, outcome) {
  return rowsOf(records, event).some(function (r) { return r.fields.outcome === outcome })
}

/** 假环境：sessions 服务 + binding + 事件流（可配置各种坏形状），append 后手动通知监听者。 */
function makeEnv(config) {
  const cfg = config || {}
  const env = {
    listeners: [],
    unsubscribed: 0,
    ready: [],
    bindingCalls: [],
    snapshot: { revision: 0, entries: [], change: { kind: 'replace', entries: [] } },
    source: null,
    binding: null,
    sessions: null,
  }
  env.source = {
    subscribe: function (fn) {
      if (cfg.subscribeThrows) throw new Error('subscribe failed')
      env.listeners.push(fn)
      if (cfg.subscribeReturnsUndefined) return undefined
      return function () {
        env.unsubscribed += 1
        const at = env.listeners.indexOf(fn)
        if (at >= 0) env.listeners.splice(at, 1)
      }
    },
    getSnapshot: function () {
      if (cfg.snapshotThrows) throw new Error('snapshot failed')
      return env.snapshot
    },
  }
  if (cfg.noGetSnapshot) delete env.source.getSnapshot
  env.binding = { sessionId: SID, session: {}, eventSource: cfg.noEventSource ? null : env.source, ctx: {} }
  env.sessions = {
    binding: function (id) {
      env.bindingCalls.push(id)
      if (cfg.bindingThrows) throw new Error('binding failed')
      if (cfg.noBinding) return undefined
      return env.binding
    },
  }
  env.notify = function (events, kind) {
    const entries = (events || []).map(function (event) { return { event: event } })
    env.snapshot = { revision: env.snapshot.revision + 1, entries: entries, change: { kind: kind || 'append', entries: entries } }
    const copy = env.listeners.slice()
    for (let i = 0; i < copy.length; i++) copy[i]()
  }
  env.onReady = function (items) { env.ready.push(items) }
  return env
}

function flatItemTexts(records) {
  const parts = []
  for (let i = 0; i < records.length; i++) parts.push(JSON.stringify(records[i].fields || {}))
  return parts.join('\n')
}
function walkFiles(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walkFiles(full, out)
    else if (name.endsWith('.ts') || name.endsWith('.js')) out.push(full)
  }
  return out
}

async function main() {
  const facts = await imp('src/client/statusbar/suggestFacts.ts')
  const streamMod = await imp('src/client/statusbar/suggestStream.ts')
  const tool = await imp('src/deck/tools/suggest-next-steps.ts')

  // 订阅层里的跨叶子名字在构建产物里由同一个闭包提供；单独加载这个 .ts 时把同一份纯函数挂到
  // globalThis（浏览器里也是这同一批实现），测试不伪造任何一份逻辑。
  globalThis.suggestHash = facts.suggestHash
  globalThis.suggestItemsOf = facts.suggestItemsOf
  globalThis.suggestEventOf = facts.suggestEventOf

  // ── 1. 模块外壳：两个叶子都导出了该有的东西（构建拼闭包前这里是真源） ──
  check(typeof facts.suggestItemsOf === 'function' && typeof facts.suggestEventOf === 'function', '纯函数叶子导出识别与解析两个函数')
  check(typeof streamMod.createSuggestStream === 'function', '订阅层导出 createSuggestStream')
  check(typeof streamMod.SuggestStreamMount === 'function', '订阅层导出不渲染东西的挂载组件 SuggestStreamMount（状态栏只挂这一行）')
  check(typeof tool.resolveSuggestItems === 'function', '工具侧契约模块可加载（比对上下限用）')

  // ── 2. 界面侧常量必须与工具侧同一组数（票面：界面各自再钳一次，但用的数不能分叉） ──
  check(facts.SUGGEST_TOOL_NAME === 'suggest_next_steps', '界面侧认的工具名是 suggest_next_steps')
  check(facts.SUGGEST_TOOL_NAME === tool.SUGGEST_TOOL_NAME, '工具名两侧一致')
  check(facts.SUGGEST_MIN_ITEMS === tool.MIN_ITEMS && facts.SUGGEST_MIN_ITEMS === 2, '最少条数两侧一致且为 2')
  check(facts.SUGGEST_MAX_ITEMS === tool.MAX_ITEMS && facts.SUGGEST_MAX_ITEMS === 4, '最多条数两侧一致且为 4')
  check(facts.SUGGEST_INTRO_MAX_WIDTH === tool.INTRO_MAX_WIDTH && facts.SUGGEST_INTRO_MAX_WIDTH === 30, '简介上限两侧一致且为 30 格（15 个汉字宽）')
  check(facts.SUGGEST_PROMPT_MAX_CHARS === tool.PROMPT_MAX_CHARS && facts.SUGGEST_PROMPT_MAX_CHARS === 500, '提示词上限两侧一致且为 500')
  check(facts.SUGGEST_REASON_MAX_CHARS === tool.REASON_MAX_CHARS && facts.SUGGEST_REASON_MAX_CHARS === 30, '理由上限两侧一致且为 30')
  check(facts.SUGGEST_GAIN_MAX_CHARS === tool.GAIN_MAX_CHARS && facts.SUGGEST_GAIN_MAX_CHARS === 30, '优点上限两侧一致且为 30')
  check(facts.SUGGEST_COST_MAX_CHARS === tool.COST_MAX_CHARS && facts.SUGGEST_COST_MAX_CHARS === 30, '缺点上限两侧一致且为 30')
  check(facts.SUGGEST_PRIORITY_MIN === tool.PRIORITY_MIN && facts.SUGGEST_PRIORITY_MIN === 0, '优先级下限两侧一致且为 0')
  check(facts.SUGGEST_PRIORITY_MAX === tool.PRIORITY_MAX && facts.SUGGEST_PRIORITY_MAX === 10, '优先级上限两侧一致且为 10')
  // 气泡叶子在本地再钳一次条数（构建时是同一闭包里的常量，不能跨文件 import），所以读源码把第四个 4
  // 与工具上限连起来：以后谁只改一处，这条就红，不用靠人记得同步。
  const bubbleSource = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestBubble.ts'), 'utf8')
  const viewMaxMatch = /const SUGGEST_VIEW_MAX_ITEMS\s*=\s*(\d+)/.exec(bubbleSource)
  check(!!viewMaxMatch && Number(viewMaxMatch[1]) === tool.MAX_ITEMS,
    '气泡叶子的 SUGGEST_VIEW_MAX_ITEMS 与工具上限一致（都是 ' + tool.MAX_ITEMS + '）')

  // ── 3. 短散列：日志里只出现这种形状的会话号与调用编号 ──
  const hash = facts.suggestHash(SID)
  check(/^[0-9a-f]{8}$/.test(hash), '短散列是 8 位小写十六进制')
  check(hash === facts.suggestHash(SID), '同一输入散列稳定')
  check(hash !== facts.suggestHash(SID + 'x'), '不同输入散列不同（不会把两个会话记成一行）')

  // ── 4. 按码点截断：与工具侧 clipText 同形，不能切坏 emoji ──
  const clipShort = facts.suggestClipText('abc', 5)
  check(clipShort.text === 'abc' && clipShort.clipped === false, '没超长原样返回、不算截断')
  const clipExact = facts.suggestClipText('abc', 3)
  check(clipExact.text === 'abc' && clipExact.clipped === false, '正好等于上限不算截断')
  const clipLong = facts.suggestClipText('abcdef', 3)
  check(clipLong.text === 'abc…' && clipLong.clipped === true, '超长保留前 3 个码点并另加省略号（#1540）')
  const clipEmoji = facts.suggestClipText('😀😀😀', 2)
  check(clipEmoji.text === '😀😀…' && clipEmoji.clipped === true, '按 Unicode 码点截断，不切坏代理对（#1540 保留前 2 个码点并另加省略号）')
  check(facts.suggestClipText(123, 5).text === '', '不是字符串按空串收（不抛）')

  // ── 4b. 按显示宽度截断简介：15 个汉字与 30 个英文字母的宽度都正好是 30 格，多一格才算超宽 ──
  const clipWidthHanExact = facts.suggestClipWidth('简'.repeat(15), facts.SUGGEST_INTRO_MAX_WIDTH)
  check(clipWidthHanExact.text === '简'.repeat(15) && clipWidthHanExact.clipped === false, '15 个汉字正好放得下，不算截断')
  const clipWidthHanLong = facts.suggestClipWidth('简'.repeat(16), facts.SUGGEST_INTRO_MAX_WIDTH)
  check(clipWidthHanLong.text === '简'.repeat(15) + '…' && clipWidthHanLong.clipped === true, '16 个汉字保留前 15 个并另加省略号')
  const clipWidthEnExact = facts.suggestClipWidth('a'.repeat(30), facts.SUGGEST_INTRO_MAX_WIDTH)
  check(clipWidthEnExact.text === 'a'.repeat(30) && clipWidthEnExact.clipped === false, '30 个英文字母正好放得下（等效 15 个汉字宽）')
  const clipWidthEnLong = facts.suggestClipWidth('a'.repeat(31), facts.SUGGEST_INTRO_MAX_WIDTH)
  check(clipWidthEnLong.text === 'a'.repeat(30) + '…' && clipWidthEnLong.clipped === true, '31 个英文字母保留前 30 个并另加省略号')
  check(facts.suggestClipWidth(123, 30).text === '', '宽度截断也不接受非字符串（不抛）')

  // ── 5. 参数解析与钳制：能救的救，救不了整次不出结果 ──
  const parsed = facts.suggestItemsOf(GOOD_ARGS)
  check(parsed.ok === true && parsed.items.length === 2 && parsed.items[0].prompt === '/to-tickets', '两条合法建议解析成功且顺序保留')
  check(parsed.items[0].reason === '把计划拆成票' && parsed.clipped === 0, '理由原文保留、没有被算成截断')
  const parsedExtra = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: ' /a ', reason: ' r1 ', extra: 'ignored' },
    { prompt: '/b', reason: 'r2' },
  ] }))
  check(parsedExtra.ok === true && parsedExtra.items[0].prompt === '/a' && parsedExtra.items[0].reason === 'r1', '两侧空白 trim 掉、多余键不往下传')
  check(Object.keys(parsedExtra.items[0]).join(',') === 'intro,prompt,reason,gain,cost,priority', '每个条目只留简介、提示词、理由、优点、缺点与推荐分六格')
  check(facts.suggestItemsOf(null).ok === false && facts.suggestItemsOf(null).reason === 'bad-json', '参数既不是字符串也不是对象时判 bad-json')
  check(facts.suggestItemsOf(42).reason === 'bad-json', '参数是数字等其它类型时判 bad-json')
  check(facts.suggestItemsOf({}).reason === 'bad-shape', '参数是对象但没有 items 时判 bad-shape（PTC 坏形状走这条路）')
  const parsedObject = facts.suggestItemsOf({ items: [
    { prompt: '/obj-one', reason: '对象参数第一条' },
    { prompt: '/obj-two', reason: '对象参数第二条' },
  ] })
  check(parsedObject.ok === true && parsedObject.items.length === 2 && parsedObject.items[0].prompt === '/obj-one', '参数已是结构化对象时直接解析（PTC 派发事件的形态）')
  check(facts.suggestItemsOf([1, 2]).reason === 'bad-shape', '参数本身就是数组时判 bad-shape')
  check(facts.suggestItemsOf('{oops').reason === 'bad-json', 'JSON 解析失败判 bad-json')
  check(facts.suggestItemsOf('[1,2]').reason === 'bad-shape', '顶层不是对象判 bad-shape')
  check(facts.suggestItemsOf(JSON.stringify({ items: 'nope' })).reason === 'bad-shape', 'items 不是数组判 bad-shape')
  check(facts.suggestItemsOf(JSON.stringify({ items: [{ prompt: '/only', reason: 'r' }] })).reason === 'too-few', '只剩一条时整次不出结果')
  const parsedSalvage = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '', reason: 'r0' },
    { prompt: '/a', reason: 'r1' },
    null,
    { prompt: '/b', reason: 'r2' },
  ] }))
  check(parsedSalvage.ok === true && parsedSalvage.items.length === 2 && parsedSalvage.dropped === 2, '坏条目丢掉、够数的留下（空提示词与非对象都算坏条目）')
  const parsedFive = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '/1', reason: 'r1' }, { prompt: '/2', reason: 'r2' }, { prompt: '/3', reason: 'r3' },
    { prompt: '/4', reason: 'r4' }, { prompt: '/5', reason: 'r5' },
  ] }))
  check(parsedFive.ok === true && parsedFive.items.length === 4 && parsedFive.items[0].prompt === '/1' && parsedFive.items[3].prompt === '/4', '多于四条时从头留前四条、顺序不变')
  const parsedClipped = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: 'x'.repeat(600), reason: 'r'.repeat(60), gain: 'g'.repeat(60), cost: 'c'.repeat(60) },
    { prompt: '/ok', reason: 'fine' },
  ] }))
  check(parsedClipped.ok === true && parsedClipped.clipped === 1, '一条里提示词与三格理由文本都超长只算「被截断一条」')
  check(parsedClipped.items[0].prompt.length === 501 && parsedClipped.items[0].prompt.slice(-1) === '…', '提示词保留前 500 个码点并另加省略号（#1540）')
  check(parsedClipped.items[0].reason.length === 31 && parsedClipped.items[0].reason.slice(-1) === '…', '理由保留前 30 个码点并另加省略号（2026-10-31 统一上限 30）')
  check(parsedClipped.items[0].gain.length === 31 && parsedClipped.items[0].cost.length === 31, '优点与缺点同样截到 30 个码点并加省略号')
  const parsedNoReason = facts.suggestItemsOf(JSON.stringify({ items: [{ prompt: '/a' }, { prompt: '/b' }] }))
  check(parsedNoReason.ok === true && parsedNoReason.items[0].reason === '', '缺理由的条目按空理由收（不因少一句解释丢掉整条提示词）')
  // #1451 起每条多带一句十五个字以内的简介；旧事件里没有这一格，按空串收，界面只显示提示词。
  const parsedIntro = facts.suggestItemsOf(JSON.stringify({ items: [
    { intro: ' 拆票 ', prompt: '/to-tickets', reason: 'r' },
    { prompt: '/no-intro', reason: 'r2' },
  ] }))
  check(parsedIntro.ok === true && parsedIntro.items[0].intro === '拆票' && parsedIntro.items[1].intro === '', '简介 trim 后保留；缺简介的旧事件按空串收')
  // #1451 后续：每条可以带一个 0~10 的推荐优先级，界面按分从高到低往左排；没打分的排最后。
  const parsedScore = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '/low', reason: 'r1', priority: 3 },
    { prompt: '/high', reason: 'r2', priority: 9.5 },
    { prompt: '/zero', reason: 'r3', priority: 0 },
  ] }))
  check(parsedScore.ok === true && parsedScore.items.map(function (it: any) { return it.prompt }).join(',') === '/high,/low,/zero',
    '打了分的按分从高到低排（9.5 在 3 与 0 前面）')
  const parsedNullLast = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '/nope', reason: 'r1' },
    { prompt: '/scored', reason: 'r2', priority: 2 },
  ] }))
  check(parsedNullLast.ok === true && parsedNullLast.items[0].prompt === '/scored' && parsedNullLast.items[0].priority === 2,
    '没打分的排在打了分的后面')
  check(parsedNullLast.items[1].priority === null, '没打分记成 null（与 0 分区分：0 是最后再做，null 是不知道）')
  const parsedClamp = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '/over', reason: 'r1', priority: 15 },
    { prompt: '/under', reason: 'r2', priority: -5 },
    { prompt: '/nan', reason: 'r3', priority: 'nine' },
    { prompt: '/mid', reason: 'r4', priority: 4.26 },
  ] }))
  check(parsedClamp.ok === true, '优先级超范围或不是数字都不拒绝整次建议')
  const clampByPrompt = function (prompt: string) {
    const found = parsedClamp.items.filter(function (it: any) { return it.prompt === prompt })[0]
    return found ? found.priority : 'missing'
  }
  check(clampByPrompt('/over') === 10 && clampByPrompt('/under') === 0, '优先级钳到 0~10')
  check(clampByPrompt('/nan') === null, '不是数字的优先级当没打分')
  check(clampByPrompt('/mid') === 4.3, '优先级留一位小数（4.26 记成 4.3）')
  const parsedScoreTrim = facts.suggestItemsOf(JSON.stringify({ items: [
    { prompt: '/a', reason: 'r', priority: 1 },
    { prompt: '/b', reason: 'r', priority: 9 },
    { prompt: '/c', reason: 'r', priority: 5 },
    { prompt: '/d', reason: 'r' },
    { prompt: '/e', reason: 'r', priority: 8 },
  ] }))
  check(parsedScoreTrim.items.length === 4 && parsedScoreTrim.items.map(function (it: any) { return it.prompt }).join(',') === '/b,/e,/c,/a',
    '多于四条时按分从高到低留前四条（截掉的是没打分的那条）')
  const parsedIntroLong = facts.suggestItemsOf(JSON.stringify({ items: [
    { intro: '简'.repeat(30), prompt: '/a', reason: 'r' },
    { prompt: '/b', reason: 'r2' },
  ] }))
  check(parsedIntroLong.ok === true && parsedIntroLong.clipped === 1 && parsedIntroLong.items[0].intro.length === 16 && parsedIntroLong.items[0].intro.slice(-1) === '…' && parsedIntroLong.items[0].intro.slice(0, 15) === '简'.repeat(15),
    '超长简介保留前 15 个汉字（30 格宽）并另加省略号，只算「被截断一条」（#1540）')

  // ── 6. 事件识别：只认 durable 的调用事件（tool/call 与 tool/ptc-dispatch-start）与 turn/start、turn/end ──
  const foundCall = facts.suggestEventOf(callEvent('call_A', 3, GOOD_ARGS))
  check(foundCall && foundCall.kind === 'call' && foundCall.callId === 'call_A' && foundCall.turn === 3 && foundCall.argumentsValue === GOOD_ARGS, '认出建议工具的 tool/call（turn、callId、参数原文都带出）')
  check(facts.suggestEventOf(callEvent('call_B', 3, GOOD_ARGS, 'pwsh')) === null, '别的工具不认')
  const foundEnd = facts.suggestEventOf(endEvent(7))
  check(foundEnd && foundEnd.kind === 'turn-end' && foundEnd.turn === 7, '认出 turn/end 并带出轮次')
  check(facts.suggestEventOf({ type: 'turn/end', data: { turn: 'x' } }) === null, '轮次不是数字的 turn/end 不认')
  check(facts.suggestEventOf(callEvent('', 1, GOOD_ARGS)) === null, '没有调用编号的 tool/call 不认')
  const foundTurnStart = facts.suggestEventOf(startEvent(4))
  check(foundTurnStart && foundTurnStart.kind === 'turn-start' && foundTurnStart.turn === 4, '认出 turn/start 并带出轮次（给 PTC 调用补轮次用）')
  check(facts.suggestEventOf({ type: 'turn/start', data: { turn: 'x' } }) === null, '轮次不是数字的 turn/start 不认')
  const ptcEvent = ptcCallEvent('call_ptc:1', PTC_ITEMS)
  const foundPtc = facts.suggestEventOf(ptcEvent)
  check(foundPtc && foundPtc.kind === 'call' && foundPtc.callId === 'call_ptc:1' && foundPtc.turn === null, '认出 PTC 派发里的建议工具调用（callId 用 subCallId、事件本身没有轮次）')
  check(foundPtc && foundPtc.argumentsValue === ptcEvent.data.arguments, 'PTC 调用把事件里的结构化参数原样带出（不需要再解析一次）')
  check(facts.suggestEventOf(ptcCallEvent('call_ptc:2', PTC_ITEMS, 'pwsh')) === null, 'PTC 派发里别的工具不认')
  check(facts.suggestEventOf({ type: 'tool/ptc-dispatch-start', data: { name: 'suggest_next_steps', subCallId: '', arguments: PTC_ITEMS } }) === null, 'PTC 派发没有调用编号时不认')
  check(facts.suggestEventOf({ type: 'tool/ptc-dispatch', data: { subCallId: 'call_ptc:1', name: 'suggest_next_steps', arguments: PTC_ITEMS } }) === null, 'PTC 结果事件不认（一次调用只认派发那一下）')
  check(facts.suggestEventOf(null) === null && facts.suggestEventOf({}) === null, '空事件不认、不抛')
  check(facts.suggestEventOf({ type: 'assistant/live-chunk', data: { chunk: { id: 'call_A', type: 'tool-call-delta' } } }) === null, '流式增量不认（完整参数只信 durable 的调用事件）')
  check(facts.suggestEventOf({ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'call_A', name: 'suggest_next_steps', arguments: GOOD_ARGS }] } } }) === null, 'assistant/message 里的工具调用块也不认（同一次调用只交付一次）')

  // ── 7. 借不到事件流：安静不做，只留一条能指路的日志 ──
  {
    const cap = captureLog()
    try {
      const noSvc = streamMod.createSuggestStream({ sessions: null, sid: SID, onReady: function () {} })
      check(typeof noSvc.dispose === 'function', '没有 sessions 服务时也返回可卸载的句柄')
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-service', '没有 sessions 服务时记 no-service（安静不做）')
      noSvc.dispose()
      const noMethod = streamMod.createSuggestStream({ sessions: {}, sid: SID, onReady: function () {} })
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-service', '服务里没有 binding 方法时同样记 no-service')
      noMethod.dispose()
      const noSid = streamMod.createSuggestStream({ sessions: makeEnv().sessions, sid: '', onReady: function () {} })
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-session', '没有会话号时记 no-session，不去借别人的订阅')
      noSid.dispose()
      check(cap.records.every(function (r) { return r.event === 'suggest.bind' }), '这条降级路上只落 suggest.bind 一种事件（不刷垃圾日志）')
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      const env = makeEnv({ bindingThrows: true })
      const thrown = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'error', 'binding 自己抛错时记 error、不往上抛')
      thrown.dispose()
      const env2 = makeEnv({ noBinding: true })
      const noBinding = streamMod.createSuggestStream({ sessions: env2.sessions, sid: SID, onReady: env2.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-binding', '界面没保持这个会话时 binding 返回空，记 no-binding 后安静退出')
      check(env2.bindingCalls.length === 1 && env2.bindingCalls[0] === SID, '借订阅时问的正是当前会话号')
      noBinding.dispose()
      const env3 = makeEnv({ noEventSource: true })
      const noSource = streamMod.createSuggestStream({ sessions: env3.sessions, sid: SID, onReady: env3.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-event-source', 'binding 里没有事件流时记 no-event-source')
      noSource.dispose()
      const env4 = makeEnv({ noGetSnapshot: true })
      const noSnap = streamMod.createSuggestStream({ sessions: env4.sessions, sid: SID, onReady: env4.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'no-event-source', '事件流不会读快照时也按没事件流处理（不硬用）')
      noSnap.dispose()
      const env5 = makeEnv({ subscribeThrows: true })
      const subThrow = streamMod.createSuggestStream({ sessions: env5.sessions, sid: SID, onReady: env5.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'error', 'subscribe 抛错时记 error、不往上抛')
      subThrow.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      check(lastOutcome(cap.records, 'suggest.bind') === 'bound', '借到事件流时记 bound')
      check(rowsOf(cap.records, 'suggest.bind')[0].fields.sidHash === facts.suggestHash(SID), '会话号以短散列入日志，不落原文')
      stream.dispose()
      check(env.unsubscribed === 1, 'dispose 叫声退订函数')
    } finally { cap.restore() }
  }

  // ── 8. 时序：收到调用先等这一轮跑完，turn/end 之后交付一次 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_A', 1, GOOD_ARGS)])
      check(env.ready.length === 0, '收到建议调用后不立刻交付（等这一轮跑完再说）')
      check(lastOutcome(cap.records, 'suggest.call') === 'seen', '收到调用记 suggest.call seen')
      check(lastOutcome(cap.records, 'suggest.ready') === 'queued', '收下后记 suggest.ready queued（日志能看出「已收到、在等整轮结束」）')
      env.notify([endEvent(1)])
      check(env.ready.length === 1, '同一轮 turn/end 之后交付一次')
      check(env.ready[0].length === 2 && env.ready[0][0].prompt === '/to-tickets' && env.ready[0][1].prompt === '/grill', '交付的是解析好的完整清单，顺序保留')
      check(lastOutcome(cap.records, 'suggest.ready') === 'delivered', '交付这一趟记 delivered')
      const callRow = rowsOf(cap.records, 'suggest.call')[0]
      check(callRow.fields.callIdHash === facts.suggestHash('call_A') && callRow.fields.turn === 1 && callRow.fields.items === 2, '调用日志只记编号短散列、轮次与条数')
      check(callRow.fields.clipped === 0 && 'clipped' in callRow.fields, '调用日志带上截断计数（0 也如实记）')
      stream.dispose()
      env.notify([callEvent('call_B', 2, GOOD_ARGS), endEvent(2)])
      check(env.ready.length === 1, 'dispose 之后事件不再交付（卸载就退订）')
    } finally { cap.restore() }
  }

  // ── 8b. PTC 预设：调用记在 tool/ptc-dispatch-start，轮次靠 turn/start 补齐 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([startEvent(5)])
      check(env.ready.length === 0, 'turn/start 本身不交付任何东西（只用来记当前轮次）')
      env.notify([ptcCallEvent('call_00_ptc:2', PTC_ITEMS)])
      check(env.ready.length === 0, 'PTC 调用先排队等整轮结束')
      check(lastOutcome(cap.records, 'suggest.call') === 'seen', 'PTC 调用同样记 suggest.call seen')
      const ptcRow = rowsOf(cap.records, 'suggest.call')[0]
      check(ptcRow.fields.turn === 5 && ptcRow.fields.items === 2, 'PTC 调用的轮次从 turn/start 补齐、条数照常记')
      env.notify([endEvent(5)])
      check(env.ready.length === 1, 'PTC 调用在同一轮 turn/end 之后交付一次')
      check(env.ready[0][0].prompt === '/ptc-one' && env.ready[0][1].prompt === '/ptc-two', '交付的是 PTC 事件里的结构化参数解析出的清单（顺序保留）')
      check(lastOutcome(cap.records, 'suggest.ready') === 'delivered', 'PTC 交付这一趟也记 delivered')
      stream.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      // 界面在一轮中途才挂上：没看到 turn/start，只能等 turn/end 收尾（轮次补不出来，照常交付）。
      env.notify([ptcCallEvent('call_mid:1', PTC_ITEMS)])
      check(env.ready.length === 0, '中途挂载时 PTC 调用也先排队')
      check(lastOutcome(cap.records, 'suggest.call') === 'seen', '中途挂载的 PTC 调用照常收下')
      env.notify([endEvent(6)])
      check(env.ready.length === 1, '中途挂载时 turn/end 照样交付（之前没看到 turn/start 不影响交付）')
      check(rowsOf(cap.records, 'suggest.call')[0].fields.turn === null, '补不出轮次时日志里 turn 记 null（不编造轮次）')
      stream.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([startEvent(2), ptcCallEvent('call_dup:1', PTC_ITEMS), ptcCallEvent('call_dup:1', PTC_ITEMS), endEvent(2)])
      check(env.ready.length === 1 && env.ready[0][0].prompt === '/ptc-one', 'PTC 同一编号出现两次只交付一次')
      check(hasOutcome(cap.records, 'suggest.call', 'dup'), 'PTC 重复的那次记 dup 后丢掉')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 9. 去重与「同一轮以后来的为准」 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_A', 1, GOOD_ARGS)])
      env.notify([callEvent('call_A', 1, GOOD_ARGS)])
      env.notify([endEvent(1)])
      check(env.ready.length === 1, '同一调用编号出现两次只交付一次')
      check(hasOutcome(cap.records, 'suggest.call', 'dup'), '重复的那次记 suggest.call dup 后丢掉')
      const newArgs = JSON.stringify({ items: [{ prompt: '/new-one', reason: 'r1' }, { prompt: '/new-two', reason: 'r2' }] })
      env.notify([callEvent('call_C', 2, GOOD_ARGS), callEvent('call_D', 2, newArgs), endEvent(2)])
      check(env.ready.length === 2, '下一轮照常交付一次')
      check(env.ready[1][0].prompt === '/new-one', '同一轮两次调用以后来的那条为准（前一条被覆盖）')
      stream.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)])
      check(env.ready.length === 1, '第一轮交付正常')
      env.notify([callEvent('call_A', 2, GOOD_ARGS)])
      check(env.ready.length === 1, '跨轮重复的编号也去重（同一编号只交付一次）')
      check(hasOutcome(cap.records, 'suggest.call', 'dup'), '跨轮重复同样记 dup')
      env.notify([callEvent('call_E', 2, GOOD_ARGS), endEvent(2)])
      check(env.ready.length === 2, '同轮新编号照常交付')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 10. 轮早就结束（历史里翻到的调用）：当场交付，不进 pending ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([endEvent(3)])
      check(env.ready.length === 0, '只收到 turn/end 不交付任何东西')
      env.notify([callEvent('call_A', 3, GOOD_ARGS)])
      check(env.ready.length === 1, '轮已经结束时收到的调用当场交付')
      check(lastOutcome(cap.records, 'suggest.ready') === 'already-ended', '这种交付记 already-ended（日志里分得清当场交还是等来的）')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 11. 历史重放与流式增量：都不能冒泡 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_hist', 1, GOOD_ARGS), endEvent(1)], 'replace')
      check(env.ready.length === 0, 'replace（打开旧会话时的历史重放）不冒泡')
      env.notify([callEvent('call_pre', 2, GOOD_ARGS)], 'prepend')
      env.notify([endEvent(2)], 'settle-assistant')
      check(env.ready.length === 0, 'prepend / settle-assistant 这些非增量变化也都不冒泡')
      env.notify([{ type: 'assistant/live-chunk', data: { chunk: { id: 'call_A', type: 'tool-call-delta' } } }, { type: 'assistant/message', data: {} }])
      check(env.ready.length === 0, '流式增量与助手消息块不交付（完整参数只认 durable 的调用事件）')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 12. 坏参数 / 坏形状：不出结果、只记日志、不抛 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      let crashed = false
      try {
        env.notify([callEvent('call_bad', 1, '{not json'), callEvent('call_shape', 1, '[1,2]'), callEvent('call_few', 1, JSON.stringify({ items: [{ prompt: '/only', reason: 'r' }] })), endEvent(1)])
      } catch (e) { crashed = true }
      check(!crashed, '坏参数一路都不抛')
      check(env.ready.length === 0, '参数解析失败 / 形状不对 / 条数不够时整次不出结果')
      check(lastOutcome(cap.records, 'suggest.call') === 'bad-args', '坏 JSON 记 bad-args')
      check(hasOutcome(cap.records, 'suggest.call', 'bad-shape'), '形状不对记 bad-shape')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 13. 日志纪律：只落散列与计数，绝不落提示词与理由原文 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      const secretPrompt = 'SECRET-PROMPT-1409-abc'
      const secretReason = 'SECRET-REASON-1409-xyz'
      const secretArgs = JSON.stringify({ items: [{ prompt: secretPrompt, reason: secretReason }, { prompt: '/ok-two', reason: 'r2' }] })
      env.notify([callEvent('call_secret', 1, secretArgs), endEvent(1)])
      check(env.ready[0][0].prompt === secretPrompt, '提示词原文只交给上层接缝（界面用），不进日志')
      const blob = flatItemTexts(cap.records)
      check(blob.indexOf(secretPrompt) < 0 && blob.indexOf(secretReason) < 0, '日志里找不到提示词与理由原文')
      const allowed = ['outcome', 'sidHash', 'callIdHash', 'turn', 'items', 'clipped', 'reason']
      const keys = {}
      for (const row of cap.records) for (const key of Object.keys(row.fields)) keys[key] = true
      check(Object.keys(keys).every(function (k) { return allowed.indexOf(k) >= 0 }), '三条事件的字段键都在白名单内（' + Object.keys(keys).sort().join('、') + '）')
      check(cap.records.every(function (r) { return r.level === 'debug' }), '只在调试档落日志（按需档，不刷常驻日志）')
      stream.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      cap.setEnabled(false)
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)])
      check(env.ready.length === 1, '调试开关关着时取数照常工作')
      check(cap.records.length === 0, '调试开关关着时一条日志都不落')
      stream.dispose()
    } finally { cap.restore() }
  }
  {
    const cap = captureLog()
    try {
      delete globalThis.isEnabled
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      env.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)])
      check(env.ready.length === 1, '环境里根本没有 isEnabled 时取数照常工作（日志口缺失不连累功能）')
      check(cap.records.length === 0, '没有 isEnabled 时不落日志')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 14. 其它健壮性：回调抛错、缺回调、快照读失败、退订函数不是函数 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      let called = 0
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: function () { called += 1; throw new Error('上层画气泡炸了') } })
      let crashed = false
      try { env.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)]) } catch (e) { crashed = true }
      check(!crashed && called === 1, '上层回调抛错被吞掉，不把整条事件通道带崩')
      stream.dispose()
      const env2 = makeEnv()
      let crashed2 = false
      const noCallback = streamMod.createSuggestStream({ sessions: env2.sessions, sid: SID })
      try { env2.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)]) } catch (e) { crashed2 = true }
      check(!crashed2, '没有给 onReady 时不抛（本票先留空接缝）')
      noCallback.dispose()
      const env3 = makeEnv({ snapshotThrows: true })
      const env3Stream = streamMod.createSuggestStream({ sessions: env3.sessions, sid: SID, onReady: env3.onReady })
      let crashed3 = false
      try { env3.notify([callEvent('call_A', 1, GOOD_ARGS)]) } catch (e) { crashed3 = true }
      check(!crashed3 && env3.ready.length === 0, '读快照抛错时安静丢掉这次通知，不抛')
      env3Stream.dispose()
      const env4 = makeEnv({ subscribeReturnsUndefined: true })
      const noStop = streamMod.createSuggestStream({ sessions: env4.sessions, sid: SID, onReady: env4.onReady })
      let crashed4 = false
      try { noStop.dispose() } catch (e) { crashed4 = true }
      check(!crashed4, '退订函数不是函数时 dispose 也不抛')
      env4.notify([callEvent('call_A', 1, GOOD_ARGS), endEvent(1)])
      check(env4.ready.length === 0, '没有退订函数时 dispose 之后同样不再交付（监听者自己先判 disposed）')
    } finally { cap.restore() }
  }

  // ── 15. 去重集合无界防线：极长对话里也不会越记越多 ──
  {
    const cap = captureLog()
    try {
      const env = makeEnv()
      const stream = streamMod.createSuggestStream({ sessions: env.sessions, sid: SID, onReady: env.onReady })
      const many = []
      for (let i = 0; i < 505; i++) many.push(callEvent('call_many_' + i, 1, GOOD_ARGS))
      let crashed = false
      try { env.notify(many) } catch (e) { crashed = true }
      check(!crashed, '一轮里冒出几百条调用也不抛')
      env.notify([endEvent(1)])
      check(env.ready.length === 1 && env.ready[0].length === 2, '去重集合满过之后仍只交付这一轮最后一条')
      stream.dispose()
    } finally { cap.restore() }
  }

  // ── 16. 源码守卫：只借不保、不新增定时器、不订阅会话列表 ──
  const clientFiles = walkFiles(path.join(ROOT, 'src/client'), [])
  check(clientFiles.length > 100, 'src/client 全树扫到 ' + clientFiles.length + ' 份源码（守卫覆盖整棵树）')
  const clientText = clientFiles.map(function (file) { return fs.readFileSync(file, 'utf8') }).join('\n')
  check(clientText.indexOf('.retain(') < 0, 'src/client 全树不调用 sessions.retain（借订阅不保活）')
  check(clientText.indexOf('retainScope') < 0, 'src/client 全树不出现 retainScope')
  check(clientText.indexOf('.using(') < 0, 'src/client 全树不调用 using 保活')
  const streamSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStream.ts'), 'utf8')
  check(streamSrc.indexOf('.binding(') >= 0, '订阅层确实经 sessions.binding 借事件流')
  check(streamSrc.indexOf('getSnapshot') >= 0 && streamSrc.indexOf('subscribe(') >= 0, '订阅层按事件流契约读快照并订阅')
  check(streamSrc.indexOf("'append'") >= 0, '订阅层只认 append 增量（replace 历史重放不冒泡）')
  check(streamSrc.indexOf('setInterval') < 0, '订阅层没有常驻定时器（不用计时器猜「整轮结束」）')
  check(streamSrc.indexOf('setTimeout') < 0, '订阅层没有 setTimeout')
  check(streamSrc.indexOf('list.subscribe') < 0 && streamSrc.indexOf('.list(') < 0, '订阅层不订阅会话列表')
  const statusBarSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/StatusBar.ts'), 'utf8')
  check(statusBarSrc.indexOf('SuggestStreamMount') >= 0, '状态栏挂上了取数流的挂载组件（切会话时 React 负责退订重建）')
  const indexSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
  check(indexSrc.indexOf('leaf:suggestFacts') >= 0 && indexSrc.indexOf('leaf:suggestStream') >= 0, '入口真源登记了两个新叶子的拼接标记')
  const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
  check(buildSrc.indexOf("id: 'suggestFacts'") >= 0 && buildSrc.indexOf("id: 'suggestStream'") >= 0, '构建清单登记了两个新叶子')
  const factsSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestFacts.ts'), 'utf8')
  check(factsSrc.indexOf("'suggest_next_steps'") >= 0, '界面侧工具名是字面量（不靠运行时拼）')
  check(factsSrc.indexOf("'tool/ptc-dispatch-start'") >= 0 && factsSrc.indexOf("'turn-start'") >= 0, '事件识别里显式包含 PTC 派发与 turn/start（两种预设都要认）')
  check(streamSrc.indexOf("'turn-start'") >= 0, '订阅层处理 turn/start（PTC 调用靠它补轮次）')
  check(/SUGGEST_MIN_ITEMS = 2/.test(factsSrc) && /SUGGEST_MAX_ITEMS = 4/.test(factsSrc) && /SUGGEST_INTRO_MAX_WIDTH = 30/.test(factsSrc) && /SUGGEST_PROMPT_MAX_CHARS = 500/.test(factsSrc) && /SUGGEST_REASON_MAX_CHARS = 30/.test(factsSrc) && /SUGGEST_GAIN_MAX_CHARS = 30/.test(factsSrc) && /SUGGEST_COST_MAX_CHARS = 30/.test(factsSrc), '界面侧七个上下限常量是字面量')
  const toolSrc = fs.readFileSync(path.join(ROOT, 'src/deck/tools/suggest-next-steps.ts'), 'utf8')
  check(/MIN_ITEMS = 2/.test(toolSrc) && /MAX_ITEMS = 4/.test(toolSrc) && /INTRO_MAX_WIDTH = 30/.test(toolSrc) && /PROMPT_MAX_CHARS = 500/.test(toolSrc) && /REASON_MAX_CHARS = 30/.test(toolSrc) && /GAIN_MAX_CHARS = 30/.test(toolSrc) && /COST_MAX_CHARS = 30/.test(toolSrc), '工具侧七个上下限常量是字面量（两边数字由上面的导入比对钉住）')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  printGateResult('verify-1409-suggest-stream', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
