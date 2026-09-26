// verify-deck-tools-agent-register.js —— 门禁：七个 deck_* 工具真的交到 agent 手上（#741）
// 用法：在插件根目录执行 node tests/verify-deck-tools-agent-register.js，可独立运行。
//
// 为什么要这一段：七个工具的实现与宿主装配都在（verify-deck-tools.js 与
// verify-deck-tools-host-wiring.js 盯着那两半），但 agent 的工具列表里一个都看不见 ——
// 从来没有一处调用过工具注册。这一段盯最后那一步：
//   ① 注册入口只有一处（刷新接线装好表就调钩子，宿主入口零增长）；
//   ② 注册用的形状就是工具注册表认的那份（名字、描述、参数、输出模式、执行函数），
//      参数写法只含注册表允许的键，对象节点必带显式的 additionalProperties；
//   ③ 执行只是转发：调宿主已装好的那张表，回它的 value，不多不少，不抛异常；
//   ④ 注册失败（服务不在、注册表拒绝、依赖没装好）只进 reason，不掀翻宿主。
//
// 本文件不联网、不读 DSH 安装目录、不依赖档案里装没装包：
// 工具定义用桩，工具表用桩，defineTool 用桩；真定义只读“形状”（名字与参数），不执行。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(cond, what) {
  for (let i = 0; i < 100; i++) { try { if (cond()) return } catch (e) {} await sleep(20) }
  throw new Error('等不到：' + what)
}

const SEVEN_NAMES = [
  'deck_context',
  'deck_issue_get',
  'deck_map_snapshot',
  'deck_issue_create',
  'deck_map_plan_create',
  'deck_map_link',
  'deck_issue_patch',
]

// 注册表允许出现在参数写法里的键（与线上工具注册实现同一份白名单，逐字对齐）。
const LEGAL_PARAM_KEYS = ['type', 'properties', 'items', 'enum', 'const', 'additionalProperties', 'required', 'description', 'title', 'default', 'examples']

// 原生模式子集判定（退路交出去的形状必须过这一关）：与线上 assertSupportedJsonSchema
// 同一条规则——required 只许是挂在对象节点上的字符串数组，绝不许按属性标布尔；
// additionalProperties 出现就必须是布尔；键必须在子集里。2026-09-26 真机验证
// 就是栽在输出模式里按属性标了必填，门禁当时只查了官方写法的合法，没查退路。
const RAW_TYPES = ['string', 'number', 'integer', 'boolean', 'null', 'array', 'object']
const RAW_KEYS = ['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']
function rawSubsetLegal(node, where, problems) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) { problems.push(where + ' 不是对象'); return }
  for (const k of Object.keys(node)) if (RAW_KEYS.indexOf(k) < 0) { problems.push(where + ' 有子集外的键 ' + k); return }
  const t = node.type
  if (typeof t !== 'string' || RAW_TYPES.indexOf(t) < 0) { problems.push(where + ' 类型不在子集里'); return }
  if (Object.hasOwn(node, 'required')) {
    if (t !== 'object') { problems.push(where + '.required 不许出现在非对象节点上'); }
    else if (!Array.isArray(node.required) || node.required.some((x) => typeof x !== 'string')) { problems.push(where + '.required 必须是字符串数组'); }
  }
  if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') problems.push(where + '.additionalProperties 必须是布尔')
  if (node.properties !== undefined) {
    if (t !== 'object' || node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties)) { problems.push(where + '.properties 形状不对'); return }
    for (const p of Object.keys(node.properties)) rawSubsetLegal(node.properties[p], where + '.properties.' + p, problems)
  }
  if (node.items !== undefined) rawSubsetLegal(node.items, where + '.items', problems)
}

function paramsLegal(node, where, problems) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) { problems.push(where + ' 不是对象'); return }
  for (const k of Object.keys(node)) {
    if (LEGAL_PARAM_KEYS.indexOf(k) < 0) { problems.push(where + ' 有非法键 ' + k); continue }
    if (k === 'required' && typeof node[k] !== 'boolean') { problems.push(where + '.required 不是布尔（数组写法不许出现在这里）'); continue }
    if (k === 'properties') {
      if (node[k] === null || typeof node[k] !== 'object' || Array.isArray(node[k])) { problems.push(where + '.properties 不是对象'); continue }
      for (const p of Object.keys(node[k])) paramsLegal(node[k][p], where + '.properties.' + p, problems)
    }
    if (k === 'items') paramsLegal(node[k], where + '.items', problems)
  }
  if (node.type === 'object' && typeof node.additionalProperties !== 'boolean') problems.push(where + ' 对象节点缺显式 additionalProperties')
}

function topMapLegal(map, where, problems) {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) { problems.push(where + ' 不是属性清单对象'); return }
  for (const p of Object.keys(map)) paramsLegal(map[p], where + '.' + p, problems)
}

function stubDefineTool(option) {
  // 桩只做注册表会做的那两步形状检查：名字是字符串、输出带模式与渲染函数。
  if (!option || typeof option.name !== 'string' || !option.name) throw new Error('stub: name 缺失')
  if (!option.output || typeof option.output !== 'object' || typeof option.output.render !== 'function' || !option.output.schema) throw new Error('stub: output 形状不对')
  return Object.assign({ __stubbed: true }, option)
}

function stubToolsSvc() {
  const registered = []
  return {
    registered: registered,
    register: function (tool) {
      if (!tool || typeof tool.name !== 'string') throw new Error('stub: 注册形状不对')
      if (registered.some((t) => t.name === tool.name)) throw new Error('stub: 同一层重复注册 ' + tool.name)
      registered.push(tool)
      return function () {}
    },
  }
}

function stubTable(seven, failOn) {
  const tools = {}
  for (const d of seven) {
    tools[d.name] = {
      run: async function (exec, args) {
        if (failOn === d.name) throw new Error('桩后端炸了')
        return { value: { status: 'ok', text: '桩回包：' + d.name, data: { echo: args || {} } }, claimed: { requests: 1, points: 1 } }
      },
    }
  }
  return { tools: tools, names: seven.map((d) => d.name), definitions: seven }
}

async function main() {
  console.log('七个 deck_* 工具的 agent 注册门禁（#741：注册一处、形状合法、只转发、不掀宿主）')

  // ── 0. 注册帮助模块存在且只用纯函数 ──
  let agent = null
  try { agent = await imp('src/host/platform/deckAgentTools.js') } catch (e) {
    check(false, '注册帮助模块可加载（src/host/platform/deckAgentTools.js，现在：' + ((e && e.message) || e) + '）')
    console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
    process.exit(1)
  }
  check(agent && typeof agent.buildAgentToolOptions === 'function', '交出 buildAgentToolOptions（定义 → 注册选项）')
  check(agent && typeof agent.registerDeckAgentTools === 'function', '交出 registerDeckAgentTools（批量注册）')
  const agentSrc = readText('src/host/platform/deckAgentTools.js')
  check(!/from\s+['"]@deepseek-ai\/dsh-tools['"]/.test(agentSrc) && !/require\(['"]@deepseek-ai\/dsh-tools['"]\)/.test(agentSrc),
    '帮助模块不直引工具包（defineTool 由调用方传进来，门禁里才能用桩）')

  // ── 1. 用七个真定义跑转换：名字齐、形状合法、必填对上 ──
  const toolFiles = [
    'src/host/tools/deckContext.js',
    'src/host/tools/deckIssueGet.js',
    'src/host/tools/deckMapSnapshot.js',
    'src/host/tools/deckIssueCreate.js',
    'src/host/tools/deckMapPlanCreate.js',
    'src/host/tools/deckMapLink.js',
    'src/host/tools/deckIssuePatch.js',
  ]
  const seven = []
  for (const f of toolFiles) seven.push((await imp(f)).definition)
  check(seven.map((d) => d.name).join(',') === SEVEN_NAMES.join(','), '七个真定义名字齐且顺序与装配口一致')
  const requiredOf = { deck_issue_create: ['title'], deck_issue_get: ['key'], deck_map_snapshot: ['key'], deck_issue_patch: ['key'], deck_map_plan_create: ['title', 'children'] }
  for (const d of seven) {
    const opt = agent.buildAgentToolOptions(d)
    check(opt && opt.name === d.name && opt.description === d.description, d.name + ' 名字与一句话描述原样透出')
    const problems = []
    topMapLegal(opt.parameters, d.name + '.parameters', problems)
    check(problems.length === 0, d.name + ' 参数只含注册表允许的键' + (problems.length ? '（' + problems.join('；') + '）' : ''))
    const want = requiredOf[d.name] || []
    const got = Object.keys(opt.parameters).filter((k) => opt.parameters[k] && opt.parameters[k].required === true).sort()
    check(JSON.stringify(got) === JSON.stringify(want.slice().sort()), d.name + ' 必填项对上（要 ' + (want.join('、') || '无') + '）')
    check(opt.output && typeof opt.output.render === 'function' && opt.output.schema && opt.output.schema.type === 'object',
      d.name + ' 输出带模式与渲染函数')
    const rendered = opt.output.render({}, { status: 'ok', text: '你好' })
    check(Array.isArray(rendered) && rendered.length === 1 && rendered[0].type === 'text' && String(rendered[0].text).indexOf('你好') >= 0,
      d.name + ' 渲染回文本块且带着原话')
  }

  // ── 2. 注册行为（全桩）：七个都交出去、执行只转发、不抛 ──
  const svc = stubToolsSvc()
  const table = stubTable(seven, null)
  const res = await agent.registerDeckAgentTools(svc, table, stubDefineTool)
  check(res && res.registered && res.registered.join(',') === SEVEN_NAMES.join(','), '一次注册七个，一个不少')
  check(!res.missing || res.missing.length === 0, '缺件清单为空')
  const one = svc.registered.filter((t) => t.name === 'deck_issue_create')[0]
  const out = await one.execute({ title: '演示票' }, { agent: { session: { cwd: '/ws', id: 's1' } } })
  check(out && out.status === 'ok' && out.text === '桩回包：deck_issue_create', '执行转发到宿主那张表并只回它的 value')
  check(out && !Object.hasOwn(out, 'claimed'), '记账数不外露（闸里已经记过）')
  // 七个逐个真执行一遍：转发的路每条都通，回包都有状态与一句话。
  const demoArgs = { deck_context: {}, deck_issue_get: { key: '01' }, deck_map_snapshot: { key: '01' }, deck_issue_create: { title: 't' }, deck_map_plan_create: { title: 't', children: [] }, deck_map_link: { key: '01' }, deck_issue_patch: { key: '01' } }
  for (const t of svc.registered) {
    const got = await t.execute(demoArgs[t.name], { agent: { session: { cwd: '/ws' } } })
    check(got && typeof got.status === 'string' && typeof got.text === 'string' && got.text.length > 0, t.name + ' 执行通，回包带状态与一句话')
  }
  const throwing = stubTable(seven, 'deck_map_link')
  const svc2 = stubToolsSvc()
  await agent.registerDeckAgentTools(svc2, table, stubDefineTool)
  const link = svc2.registered.filter((t) => t.name === 'deck_map_link')[0]
  // 注意这里故意用会抛的表执行：工具永不抛，炸了也要包成信封。
  const svc3 = stubToolsSvc()
  await agent.registerDeckAgentTools(svc3, throwing, stubDefineTool)
  const link3 = svc3.registered.filter((t) => t.name === 'deck_map_link')[0]
  const out3 = await link3.execute({ key: '01' }, { agent: { session: { cwd: '/ws' } } })
  check(out3 && out3.status === 'unsupported' && typeof out3.text === 'string' && out3.text.length > 0,
    '后端炸了也不抛，包成没做成的信封如实说')

  // ── 3. 脏环境：调两次不炸、注册表拒绝不掀、没工具包走退路 ──
  const twice = await agent.registerDeckAgentTools(svc, table, stubDefineTool)
  check(twice && twice.registered.length === 0 && (twice.reason || '').length > 0, '同一服务调两次不重复注册（第二次给 reason）')
  const angrySvc = { register: function () { throw new Error('注册表拒绝') } }
  const angry = await agent.registerDeckAgentTools(angrySvc, table, stubDefineTool)
  check(angry && angry.registered.length === 0 && (angry.reason || '').length > 0, '注册表拒绝只进 reason，不抛')
  const noSvc = await agent.registerDeckAgentTools(null, table, stubDefineTool)
  check(noSvc && noSvc.registered.length === 0 && (noSvc.reason || '').length > 0, '服务不在只进 reason，不抛')
  // 退路（工具包没装好、defineTool 传不进来）：直接按注册表形状交，七个照样出去。
  const rawSvc = stubToolsSvc()
  const raw = await agent.registerDeckAgentTools(rawSvc, table, null)
  check(raw && raw.registered.join(',') === SEVEN_NAMES.join(',') && (!raw.missing || raw.missing.length === 0),
    '没 defineTool 走退路，七个照样注册')
  const rawOne = rawSvc.registered.filter((t) => t.name === 'deck_issue_get')[0]
  const rawDef = seven.filter((d) => d.name === 'deck_issue_get')[0]
  check(rawOne && rawOne.parameters === rawDef.parameters && typeof rawOne.execute === 'function',
    '退路参数用定义里编好的那份原样交（注册表不重编，直接当模式用）')
  // 退路七个的形状逐个过原生子集判定（官方写法走编译器，退路走这一关）。
  for (const t of rawSvc.registered) {
    const rProblems = []
    rawSubsetLegal(t.parameters, t.name + '.parameters', rProblems)
    rawSubsetLegal(t.output.schema, t.name + '.output.schema', rProblems)
    check(rProblems.length === 0, t.name + ' 退路形状过原生子集' + (rProblems.length ? '（' + rProblems.join('；') + '）' : ''))
  }
  const rawBad = await rawOne.execute('不是对象', { agent: { session: { cwd: '/ws' } } })
  check(rawBad && rawBad.status === 'unsupported' && typeof rawBad.text === 'string' && rawBad.text.length > 0,
    '参数不是对象直接回没做成，不进表')
  // 信封取值与共享壳同一份常量（改了壳，这里的字面量会先红）。
  const shell = await imp('src/shared/deck-tools/shell.js')
  check(rawBad.status === shell.DECK_STATUS.UNSUPPORTED, '没做成的状态取值与壳一致')
  check(out.status === 'ok' && out.status !== shell.DECK_STATUS.UNSUPPORTED, '做成的状态取值与壳一致')

  // ── 4. 接线形状：接线处只留两行（引钩子 + 调钩子），入口保持干净 ──
  const wiringSrc = readText('src/host/refresh/wiring.js')
  check(wiringSrc.indexOf('hookDeckAgentTools(d.ctx, deckToolsForHost') >= 0, '刷新接线装好表就调钩子（注册入口只有这一处）')
  const indexSrc = readText('src/host/index.js')
  check(indexSrc.indexOf('registerDeckAgentTools') < 0, '宿主入口不直接碰注册（钩子住在接线里，入口零增长）')
  check(/inject:\s*\[\s*['"]connection['"]\s*\]/.test(indexSrc), '宿主注入声明不变（不因注册加新服务）')

  // ── 5. 钩子行为（全桩）：有服务就交七个，没服务静默跳过 ──
  check(typeof agent.hookDeckAgentTools === 'function', '交出 hookDeckAgentTools（接线调的就是它）')
  const hookSvc = stubToolsSvc()
  agent.hookDeckAgentTools({ tools: hookSvc }, async function () { return table }, async function () { return { defineTool: stubDefineTool } })
  await waitFor(function () { return hookSvc.registered.length === 7 }, '钩子交出七个')
  check(hookSvc.registered.length === 7, '钩子交出七个（官方写法）')
  const hookRawSvc = stubToolsSvc()
  agent.hookDeckAgentTools({ tools: hookRawSvc }, async function () { return table }, async function () { return null })
  await waitFor(function () { return hookRawSvc.registered.length === 7 }, '退路钩子交出七个')
  check(hookRawSvc.registered.length === 7, '拿不到工具包时钩子走退路，七个照样交')
  let hookCrashed = false
  try { agent.hookDeckAgentTools({}, async function () { return table }, async function () { return null }) } catch (e) { hookCrashed = true }
  await sleep(50)
  check(!hookCrashed, '工具服务不在，钩子静默跳过（宿主照常起）')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
