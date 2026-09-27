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

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
