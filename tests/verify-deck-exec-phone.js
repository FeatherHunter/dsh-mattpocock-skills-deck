// verify-deck-exec-phone.js —— 门禁：宿主代执行电话 wf.deckExec（#758）
// 用法：在插件根目录执行 node tests/verify-deck-exec-phone.js，可独立运行。
//
// 这条电话只做一件事：替 agent 行把七个工具真正跑一次，
// 跑的还是宿主那同一张表、同一份闸、同一个账，不另起一本账。
// 本门禁盯住：入参不对不抛、表不在诚实说、执行只回三态那一份、
// 记账数不外露、日志只落既有事件、入口只增这一处动态接线。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const SEVEN = ['deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch']

function stubTable(runFn) {
  const tools = {}
  for (const n of SEVEN) tools[n] = { run: runFn }
  return { tools: tools, names: SEVEN.slice(), definitions: SEVEN.map((n) => ({ name: n })) }
}

async function main() {
  console.log('宿主代执行电话 wf.deckExec 门禁（#758：只加新路、不碰老路）')

  let mod = null
  try { mod = await imp('src/host/platform/deckExec.js') } catch (e) {
    check(false, '代执行模块可加载（src/host/platform/deckExec.js）：' + String((e && e.message) || e))
    console.log('\n' + total + ' 条断言，失败')
    process.exit(1)
  }
  check(mod && typeof mod.createDeckExec === 'function', '交出 createDeckExec（工厂）')

  const fired = []
  const fakeLog = { fire: function (level, event, fields) { fired.push({ level: level, event: event, fields: fields }) } }
  const okTable = stubTable(async function () { return { status: 'ok', text: '真结果', data: { a: 1 } } })
  const phone = mod.createDeckExec({ getTable: async function () { return okTable }, logCtx: fakeLog })

  // ── 1. 入参三档不对，一律回做不到，不抛 ──
  const badTool = await phone.handleDeckExec({ tool: 'deck_nope', args: {}, session: { cwd: '/ws' } })
  check(badTool && badTool.status === 'unsupported' && typeof badTool.text === 'string', '工具名不对回做不到，不抛')
  const badArgs = await phone.handleDeckExec({ tool: 'deck_context', args: '不是对象', session: { cwd: '/ws' } })
  check(badArgs && badArgs.status === 'unsupported', '参数不是对象回做不到，不进表')
  const noSession = await phone.handleDeckExec({ tool: 'deck_context', args: {}, session: {} })
  check(noSession && noSession.status === 'unsupported' && String(noSession.reason).indexOf('no-session') >= 0, '会话目录拿不到回做不到，不猜目录')
  const nullCall = await phone.handleDeckExec(null)
  check(nullCall && nullCall.status === 'unsupported', '空入参回做不到，不抛')

  // ── 2. 表不在、表里没这条，各回诚实占位 ──
  const noTablePhone = mod.createDeckExec({ getTable: async function () { return null }, logCtx: fakeLog })
  const noTable = await noTablePhone.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws' } })
  check(noTable && noTable.status === 'unsupported' && String(noTable.text).indexOf('面板') >= 0, '表不在回诚实占位并指去面板')
  const emptyPhone = mod.createDeckExec({ getTable: async function () { return { tools: {} } }, logCtx: fakeLog })
  const emptyRun = await emptyPhone.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws' } })
  check(emptyRun && emptyRun.status === 'unsupported', '表里没这条回做不到')

  // ── 3. 真执行只回三态那一份，记账数不外露 ──
  const ok = await phone.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws', sessionId: 's1' } })
  check(ok && ok.status === 'ok' && ok.text === '真结果', '真结果原样交回')
  check(ok && !Object.hasOwn(ok, 'claimed'), '记账数不外露（闸里已经记过）')
  // 包一层 {value} 的形状也认（桩与旧钩子是这种形状）。
  const wrappedPhone = mod.createDeckExec({ getTable: async function () { return stubTable(async function () { return { value: { status: 'partial', text: '半成', items: [] }, claimed: { requests: 1 } } }) }, logCtx: fakeLog })
  const wrapped = await wrappedPhone.handleDeckExec({ tool: 'deck_issue_get', args: { key: '01' }, session: { cwd: '/ws' } })
  check(wrapped && wrapped.status === 'partial' && wrapped.text === '半成' && !Object.hasOwn(wrapped, 'claimed'), '包一层的回包也只回 value 那一份')

  // ── 4. 后端炸了、回包不合形状，都包成做不到，不抛 ──
  const throwingPhone = mod.createDeckExec({ getTable: async function () { return stubTable(async function () { throw new Error('后端炸了') }) }, logCtx: fakeLog })
  const threw = await throwingPhone.handleDeckExec({ tool: 'deck_map_link', args: { key: '01' }, session: { cwd: '/ws' } })
  check(threw && threw.status === 'unsupported' && typeof threw.text === 'string', '后端抛错包成做不到，不抛')
  const garbagePhone = mod.createDeckExec({ getTable: async function () { return stubTable(async function () { return { nope: 1 } }) }, logCtx: fakeLog })
  const garbage = await garbagePhone.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws' } })
  check(garbage && garbage.status === 'unsupported', '回包不合形状包成做不到')
  const getTableThrow = mod.createDeckExec({ getTable: async function () { throw new Error('取表炸了') }, logCtx: fakeLog })
  const getTableFail = await getTableThrow.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws' } })
  check(getTableFail && getTableFail.status === 'unsupported', '取表抛错也回做不到')

  // ── 5. 日志只落既有事件，键都在白名单里；日志口不在也不崩 ──
  const okLine = fired.filter((f) => f.event === 'host.call' && f.fields.method === 'wf.deckExec')[0]
  check(!!okLine && okLine.level === 'info' && okLine.fields.kind === 'deck-tool' && okLine.fields.ok === true && typeof okLine.fields.latencyMs === 'number',
    '成功行记既有 host.call（电话名、耗时、成功标记、种类）')
  const failLines = fired.filter((f) => f.event === 'host.call.fail' && f.fields.method === 'wf.deckExec')
  check(failLines.length >= 1 && failLines.every((f) => f.level === 'warn' && f.fields.kind === 'deck-tool' && typeof f.fields.errorHash === 'string'),
    '失败行记既有 host.call.fail（电话名、种类、错误指纹）')
  check(fired.every((f) => f.event === 'host.call' || f.event === 'host.call.fail'),
    '只落既有事件，不新增事件名')
  let noLogCrashed = false
  try {
    const noLog = mod.createDeckExec({ getTable: async function () { return okTable }, logCtx: null })
    await noLog.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws' } })
    await noLog.handleDeckExec({ tool: 'deck_nope', args: {}, session: {} })
  } catch (e) { noLogCrashed = true }
  check(!noLogCrashed, '日志口不在，电话照常跑')

  // ── 6. 会话只取目录与编号，不信任调用方传的工作区键 ──
  let seenExec = null
  const spyPhone = mod.createDeckExec({ getTable: async function () {
    return stubTable(async function (execLike) { seenExec = execLike; return { status: 'ok', text: '好' } })
  }, logCtx: fakeLog })
  await spyPhone.handleDeckExec({ tool: 'deck_context', args: {}, session: { cwd: '/ws', sessionId: 's9', workspaceKey: '伪造的键' } })
  check(seenExec && seenExec.agent && seenExec.agent.session && seenExec.agent.session.cwd === '/ws' && !('workspaceKey' in seenExec.agent.session),
    '只把目录与编号交下去，不把调用方传的工作区键当真（键由宿主侧重算）')

  // ── 7. 接线形状：入口只增这一处动态接线，老电话不动 ──
  const indexSrc = readText('src/host/index.js')
  check(indexSrc.indexOf("harness.handle('wf.deckExec'") >= 0, '宿主入口注册 wf.deckExec（只增这一处）')
  check(indexSrc.indexOf("import('./platform/deckExec.js')") >= 0, '新电话走动态引入（D7），不静态引用')
  check(indexSrc.indexOf('deckToolsForHost') >= 0, '取的还是接线那同一张表（不另起一本账）')
  const execSrc = readText('src/host/platform/deckExec.js')
  check(!/from\s+['"]@deepseek-ai\/dsh-tools['"]/.test(execSrc), '代执行模块不直引工具包（零框架引用不断）')
  check(execSrc.split('\n').length < 350, '单文件行数在上限内（350 行）')

  // ── 8. 探针扩展（只加键名诊断，不报值；旧 14 个有无不动）──
  const row = await imp('src/host/platform/deckToolsRow.js')
  const rowSvc = { registered: [], register: function (t) { this.registered.push(t); return function () {} } }
  row.apply({ tools: rowSvc })
  const probe = rowSvc.registered.filter((t) => t.name === 'deck_probe')[0]
  check(!!probe, '行仍交出探针（扩展不丢旧口）')
  const listed = JSON.parse(await probe.execute({}, { tools: { a: 1 }, agent: { session: { cwd: '/ws', id: 's1' } } }))
  check(listed && listed.tools === true, '扩展后旧服务有无还在（tools 照样报有）')
  check(listed && Array.isArray(listed.ctxKeys) && Array.isArray(listed.profileContextKeys) && Array.isArray(listed.sessionKeys) && listed.globalCaps && typeof listed.globalCaps === 'object' && Array.isArray(listed.envKeys),
    '新诊断只增五组（上下文键、档案键、会话键、全局能力、环境键名）')
  check(listed.sessionKeys.indexOf('cwd') >= 0, '会话键里认得出目录那一格（只报键名）')
  // 值一律不碰：往上下文里放一个假秘密与一个数字，探针回包里不许出现它们。
  const secretCtx = { tools: { a: 1 }, profileContext: { secret: 'SHOULD-NOT-APPEAR', port: 12345 } }
  const secretOut = JSON.parse(await probe.execute({}, { agent: { session: { cwd: '/ws' } } }).catch(function () { return '{}' }))
  void secretCtx
  const leakCtx = { tools: {}, profileContext: { marker: 'LEAK-ME-999', num: 987654 } }
  const rowSvc2 = { registered: [], register: function (t) { this.registered.push(t); return function () {} } }
  row.apply({ tools: rowSvc2, profileContext: leakCtx.profileContext })
  const probe2 = rowSvc2.registered.filter((t) => t.name === 'deck_probe')[0]
  const leakOut = await probe2.execute({}, { agent: { session: { cwd: '/ws' } } })
  check(leakOut.indexOf('LEAK-ME-999') < 0 && leakOut.indexOf('987654') < 0, '探针只报键名不报值（假秘密与数字都不许进回包）')
  check(secretOut && typeof secretOut === 'object', '探针回包仍是 JSON 对象（旧调用方照常解析）')

  // ── 9. 行执行接代执行（有路走路，没路仍诚实；会话只认上下文）──
  const rowSvc3 = { registered: [], register: function (t) { this.registered.push(t); return function () {} } }
  const rowCtx3 = { tools: rowSvc3 }
  row.apply({ tools: rowSvc3, get: function () { return undefined } })
  void rowCtx3
  const ctxTool = rowSvc3.registered.filter((t) => t.name === 'deck_context')[0]
  check(!!ctxTool && typeof ctxTool.execute === 'function', '行交出的工具有可调的执行入口（代执行形状）')
  // 直连调用面通：回宿主的真结果，不回占位。
  const liveCtx = { tools: { registered: [], register: function (t) { this.registered.push(t); return function () {} } } }
  let seenPayload = null
  liveCtx.connection = { rpc: { call: async function (ch, ep, body) {
    seenPayload = body
    if (ch === '/api' && ep === 'dsws' && body && body.method === 'deckExec') {
      return { ok: true, value: { status: 'ok', text: '宿主真结果', data: { n: 1 } } }
    }
    return { ok: false, error: { message: 'no' } }
  } } }
  row.apply(liveCtx)
  const liveTool = liveCtx.tools.registered.filter((t) => t.name === 'deck_context')[0]
  const liveOut = await liveTool.execute({}, { agent: { session: { cwd: '/ws', id: 's1' } } })
  check(liveOut && liveOut.status === 'ok' && liveOut.text === '宿主真结果', '直连调用面通就拿真结果（不回占位）')
  check(seenPayload && seenPayload.payload && seenPayload.payload.tool === 'deck_context', '递过去的工具名对得上')
  check(seenPayload && seenPayload.payload && seenPayload.payload.session && seenPayload.payload.session.cwd === '/ws', '会话目录只从上下文取（模型参数里塞目录也到不了宿主）')
  // 模型参数里伪造会话：递过去的仍是上下文那一份。
  seenPayload = null
  await liveTool.execute({ cwd: '/evil', session: { cwd: '/evil' } }, { agent: { session: { cwd: '/ws', id: 's1' } } })
  check(seenPayload && seenPayload.payload && seenPayload.payload.session && seenPayload.payload.session.cwd === '/ws', '伪造的目录进不了递话（只认上下文）')
  // 没路：回诚实占位，不抛。
  const quietCtx = { tools: { registered: [], register: function (t) { this.registered.push(t); return function () {} } } }
  row.apply(quietCtx)
  const quietTool = quietCtx.tools.registered.filter((t) => t.name === 'deck_context')[0]
  const quietOut = await quietTool.execute({}, { agent: { session: { cwd: '/ws' } } })
  check(quietOut && quietOut.status === 'unsupported' && String(quietOut.text).indexOf('面板') >= 0, '没路就回诚实占位（不谎报成功）')
  // 参数不是对象、中止、会话缺失：三档各回各的，不碰网络。
  const badOut = await quietTool.execute('不是对象', { agent: { session: { cwd: '/ws' } } })
  check(badOut && badOut.status === 'unsupported', '参数不是对象直接回做不到')
  const abortOut = await quietTool.execute({}, { agent: { session: { cwd: '/ws' } }, signal: { aborted: true } })
  check(abortOut && abortOut.status === 'unsupported' && String(abortOut.text).indexOf('中止') >= 0, '已中止直接回做不到')
  const noSessOut = await quietTool.execute({}, { agent: {} })
  check(noSessOut && noSessOut.status === 'unsupported', '会话目录拿不到回做不到')
  // 同源请求通：直连不在、同源在，也拿真结果。
  const fetchCtx = { tools: { registered: [], register: function (t) { this.registered.push(t); return function () {} } } }
  row.apply(fetchCtx)
  const fetchTool = fetchCtx.tools.registered.filter((t) => t.name === 'deck_issue_get')[0]
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async function (url, opts) {
      if (String(url).indexOf('/api/dsws') < 0) throw new Error('走错路')
      const body = JSON.parse(opts.body)
      if (body.type !== 'client-request' || !body.payload || body.payload.method !== 'deckExec') throw new Error('信封不对')
      return { json: async function () { return { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { status: 'ok', text: '同源真结果' } } } } }
    }
    const fetchOut = await fetchTool.execute({ key: '01' }, { agent: { session: { cwd: '/ws' } } })
    check(fetchOut && fetchOut.status === 'ok' && fetchOut.text === '同源真结果', '同源请求通也拿真结果')
  } finally {
    try { if (realFetch === undefined) delete globalThis.fetch; else globalThis.fetch = realFetch } catch (e) {}
  }

  // ── 10. 同进程共享格（定案第一路）：宿主放表，行直接取，不经调用面 ──
  const cell = await imp('src/shared/deck-tools/exec-cell.js')
  check(cell && typeof cell.publishDeckTable === 'function' && typeof cell.awaitDeckTable === 'function' && typeof cell.peekDeckTable === 'function',
    '共享格交出发布、等表、看一眼三个口')
  const agentHelp = await imp('src/shared/deck-tools/agent-register.js')
  // 宿主钩子那条执行入口认裸信封（工具壳原文）与包一层两种形状。
  const bothSvc = { registered: [], register: function (t) { this.registered.push(t); return function () {} } }
  const bothTable = {
    tools: {
      deck_context: { run: async function () { return { status: 'ok', text: '裸信封真结果' } } },
      deck_issue_get: { run: async function () { return { value: { status: 'ok', text: '包一层真结果' } } } },
    },
    names: ['deck_context', 'deck_issue_get'],
    definitions: [{ name: 'deck_context', description: '看工作区', parameters: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'deck_issue_get', description: '读票', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
  }
  const bothRes = await agentHelp.registerDeckAgentTools(bothSvc, bothTable, null)
  check(bothRes && bothRes.registered.length === 2, '两种回包形状的工具都交得出去')
  const bareOut = await bothSvc.registered.filter((t) => t.name === 'deck_context')[0].execute({}, {})
  check(bareOut && bareOut.status === 'ok' && bareOut.text === '裸信封真结果', '裸信封（壳原文）照样认，不再判没做成')
  const wrappedOut2 = await bothSvc.registered.filter((t) => t.name === 'deck_issue_get')[0].execute({}, {})
  check(wrappedOut2 && wrappedOut2.status === 'ok' && wrappedOut2.text === '包一层真结果', '包一层（桩形状）照样认')
  // 行经共享格拿真结果（裸信封形状，真工具就是这么回的）。
  cell.publishDeckTable(Promise.resolve({
    tools: { deck_context: { run: async function (execLike, toolArgs) {
      if (!execLike || !execLike.agent || !execLike.agent.session || !execLike.agent.session.cwd) throw new Error('会话没递过来')
      return { status: 'ok', text: '格子真结果', data: { echo: toolArgs } }
    } } },
    names: ['deck_context'],
    definitions: [{ name: 'deck_context' }],
  }))
  const cellCtx = { tools: { registered: [], register: function (t) { this.registered.push(t); return function () {} } } }
  row.apply(cellCtx)
  const cellTool = cellCtx.tools.registered.filter((t) => t.name === 'deck_context')[0]
  const cellOut = await cellTool.execute({}, { agent: { session: { cwd: '/ws', id: 's1' } } })
  check(cellOut && cellOut.status === 'ok' && cellOut.text === '格子真结果', '格子里有表，行直接拿真结果（不经直连与同源）')
  // 真机形状：会话顶层没有目录，目录住在 header 里，照样取得到。
  const headerOut = await cellTool.execute({}, { agent: { session: { header: { cwd: '/ws-h', id: 'h1' } } } })
  check(headerOut && headerOut.status === 'ok' && headerOut.text === '格子真结果', 'header 形状的会话照样取出目录（与壳同口径）')
  // 探针如实说格子在、同一进程（布尔值，不含进程号原文）。
  const cellProbe = cellCtx.tools.registered.filter((t) => t.name === 'deck_probe')[0]
  const cellListed = JSON.parse(await cellProbe.execute({}, { agent: { session: { cwd: '/ws' } } }))
  check(cellListed && cellListed.bridgeTableReady === true && cellListed.bridgeSameProcess === true,
    '探针说格子在且同一进程（只报布尔，不报进程号）')
  check(JSON.stringify(cellListed).indexOf(String(process.pid)) < 0, '探针回包不带进程号原文')
  // 干跑码：探针用自己的上下文走一遍格子里的看工作区工具，只报阶段码。
  check(cellListed && cellListed.bridgeDryHint === true && cellListed.bridgeDryRun === 'ok' && cellListed.bridgeDryStatus === 'ok',
    '干跑码说会话取得到、表跑得通（阶段码都是真）')
  check(cellListed && Array.isArray(cellListed.bridgeTools) && cellListed.bridgeTools.indexOf('deck_context') >= 0,
    '干跑带回表里的工具名（自家名字，不涉密）')
  check(JSON.stringify(cellListed).indexOf('/ws') < 0, '干跑不报目录原文（正文一律不进探针）')
  check(cellListed && Array.isArray(cellListed.bridgeGateNotes) && JSON.stringify(cellListed.bridgeGateNotes).indexOf('/ws') < 0,
    '口径迹是数组且不带目录原文（只含机器码）')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
