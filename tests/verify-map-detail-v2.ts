// 门禁归属: src/client/views/mapDetailV2
/**
 * tests/verify-map-detail-v2.ts —— V2 地图详情页「纯逻辑层」的专属门禁。
 *
 * 为什么要有这一条：V2 页面还在长，先落地的是不依赖界面的判断层与适配层
 *   （行 → 卡片的刻画、未完成/已完成的排法、三条取数来路的合成、MAP 自身内容的刻画、
 *   刻画 → 卡片 props 的适配、一整页模型的合成、数据契约）。它们决定了页面上一张卡片画成什么样、
 *   摆在哪里、数据不全时怎么说——这些判断一旦错了，页面写得多好看都是错的。
 *   这一层今天没有任何门禁碰过，改坏了不会有第二处拦住。
 *
 * 被测对象是谁：src/client/views/mapDetailV2/model/ 下的 .ts 真源（不是产物）。这一批代码已经按叶子
 *   登记进客户端闭包（scripts/build.mts 的 LEAF_MODULES），但页面还没有任何入口调用它（「已入库、未接入」），
 *   所以门禁直接读真源（经 scripts/ts-hook.mts 做类型剥离）。六份纯函数模块只 import 类型、可以像普通模块
 *   一样 require；组合函数那一份拼进闭包后只能靠作用域里的名字调它们，所以门禁按构建同一口径转译后注入
 *   那六个函数再求值——这样门禁验的就是闭包里会跑的那份文本，不是 paraphrase。
 *   页面外壳（view/、wiring/）不在这条门禁的断言范围里：它要 React 与宿主电话，由可评审演示页
 *   （.scratch/v2-map-detail/page/）与真机验收覆盖；#1402 切入口之后，第 11 条只对「接线那一行」做源码断言，
 *   防止有人把入口改回老页而没有任何门禁出声。
 *
 * 断的十四件事：
 *   1. 动作与状态词表：生产侧九种动作全有映射（implement 有自己的「实施」样张，不再借执行画），四种状态各用哪个词条键。
 *   2. 状态判定与宿主 groupTickets 同口径：已关闭 > 在办 > 被挡 > 可接；阻塞者不在本图就不算被挡。
 *   3. 一张卡的刻画：编号文本、标题、类型小签（文字与真实标签色）、BUG 三角、认领人、更新日、
 *      页脚词条键、角标，以及三条不变量（结案卡不表现阻塞关系、只有被挡卡才有 blockedBy、
 *      卡片 id 一定带调用方给的前缀）。
 *   4. 阻塞关系双向：被挡卡指向编号最小的开着阻塞者；挡路卡指向「确实被挡、编号最小」的那张。
 *   5. 看板排序三条性质：每张票恰好出现一次（含成环、自阻塞、撞编号的脏数据）、输入顺序不影响结果、
 *      被挡卡紧跟在挡它的那张之后；已完成段按结案时间倒序。很长的阻塞链用显式栈走完，
 *      不依赖调用栈深度。
 *   6. 取数五态：取回那份 / 正在取 / 不支持 / 取失败 / 还没有桶，各自画哪份数据、怎么说原因，
 *      以及 capped / missing 只属于「取回那份」。
 *   7. MAP 自身内容：标题 / 目的地 / 计数 / 完成度 / 「子票那句」的段，空地图、取数中
 *      （同一句话、数字用短横占位，不额外写「正在取子票」）、后端不支持、取失败、capped / missing 各画成什么。
 *      档案正文不进入这一层：地图页不展示它，点标题进 issue 详情页看原文。
 *   8. 纯函数：判断层不 import 界面库、不读后端（动作与词条都从参数进），同目录没有落回来的 .js 产物。
 *   9. 适配层：一张票的刻画摊成卡片 props 时四处理名不漏（bug→bugCorner、footText→footActionText、
 *      blocks→blocksChip、closed 由 status 得出），四个按钮把「是哪张票」交回页面。
 *   10. 一整页模型：一次算好档案、取数状态、看板、计数与两段卡片 props，且计数与卡片张数一致。
 *   11. 入口接线：Dock 的列表页签在选中一张图时画的是 V2 页（不是老页），V2 页面调到了取数、整页模型、
 *      四个按钮的回调与皮肤，且图纸铺满 Dock 内容区的那条样式还在。第 11 条只读源码文本，不渲染 React。
 *   12. 卡片流自适应：卡片有最小宽度与自然宽度两档（208 / 300），按钮文字包在 .cd-lbl 里按整字收窄，
 *      卡片标题用纸面墨色（深色主题下卡片仍是浅纸，标题继承浅色字会看不清）。
 *   12b. 整卡点按进详情：适配层把 onCard 一并交给卡片，接线层用 enterSubDetail 按标签分流到票详情
 *      或子地图详情，卡片组件只有收到 onCard 才把整张卡做成可点（否则保持「点一下点亮挡路关系」）。
 *   12c. 卡片层四处缺口（#1401）：实施有自己的样张与词条；被挡封条第二行画挡路票标题；浅色主题
 *      也有键盘焦点环；摘要没有真实来源就明确不画（断言 props 里没有 note，不拿假话占位）。
 *   13. 档案区高度稳定：计数 / 完成度固定成一块，子票那句挂在进度条同一行、不再单独占一行
 *      （不额外写「正在取子票」，也不空出一行），取数中计数写占位、那句的数字也写占位；
 *      「正在取数」只用进度条轨道上的流动斜纹表达；没有子票时整块隐藏但留位置。
 *      进入页面时不会因为取数状态增删行让卡片上下抖。同样只读源码文本。
 *   14. 紧凑档案：页内不再重复「地图 / 规格 + 编号」那一行（顶栏已经写着同一个编号），
 *      整块档案都是进「地图档案」的入口（点它压入这张地图的 issue 详情页）；页面源码里没有抽屉组件。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-map-detail-v2.ts（在插件根目录，不需要先构建）
 */
'use strict'

const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
function check (ok, msg) {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed += 1; console.log('  FAIL ' + msg) }
}
function section (title) { console.log(''); console.log('== ' + title + ' ==') }
/** 打印实得值时用：红了能直接看出差在哪。 */
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v))

const ROOT = path.resolve(__dirname, '..')
const REL = 'src/client/views/mapDetailV2'
const MODEL_REL = REL + '/model'
const DIR = path.join(ROOT, MODEL_REL)

// 前五份只 import 类型，可以像普通模块一样直接 require（走 ts-hook 剥类型）。
const facts = require('../src/client/views/mapDetailV2/model/tickets/ticketCardFacts.ts')
const board = require('../src/client/views/mapDetailV2/model/tickets/ticketBoard.ts')
const feed = require('../src/client/views/mapDetailV2/model/tickets/ticketFeed.ts')
const profile = require('../src/client/views/mapDetailV2/model/container/mapProfile.ts')
const cardProps = require('../src/client/views/mapDetailV2/model/assembly/cardPropsOf.ts')

// 最后一份是「把上面几个按次序串起来」的组合函数。它将来要当界面闭包里的叶子拼进 client.js，
// 所以只能 import 类型、靠作用域里的名字调那六个函数（见该文件开头的说明）。门禁按同一种方式求值：
// 读真源文本 → 按构建同一口径转译 → 把六个函数当参数注入，得到与闭包里一字不差的那份代码。
const { spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')
const ASSEMBLY_FNS = ['ticketFeedOf', 'ticketFactsContextOf', 'ticketCardFactsOf', 'orderTicketBoard', 'boardCountsOf', 'mapProfileOf', 'cardPropsListOf']
const ASSEMBLY_VALUES = [feed.ticketFeedOf, facts.ticketFactsContextOf, facts.ticketCardFactsOf, board.orderTicketBoard, board.boardCountsOf, profile.mapProfileOf, cardProps.cardPropsListOf]
function loadPageModel () {
  const body = spliceableJs(MODEL_REL + '/assembly/mapDetailPageModel.ts') + '\nreturn { mapDetailPageModelOf: mapDetailPageModelOf }'
  const factory = compileFn(ASSEMBLY_FNS, body)
  return factory.apply(null, ASSEMBLY_VALUES)
}
const pageModel = loadPageModel()

// ===========================================================================
// 0. 前置：真源都在，旁边没有同名 .js 产物，判断层不 import 界面库与后端
// ===========================================================================
section('0. 前置：七份真源都在、没有同名 .js、逻辑模块不 import 界面库与后端')
{
  const wanted = [
    'contracts/mapDetailTypes.d.ts',
    'tickets/ticketCardFacts.ts',
    'tickets/ticketBoard.ts',
    'tickets/ticketFeed.ts',
    'container/mapProfile.ts',
    'assembly/cardPropsOf.ts',
    'assembly/mapDetailPageModel.ts',
  ]
  const missing = wanted.filter((name) => !fs.existsSync(path.join(DIR, name)))
  check(missing.length === 0, '七份真源都在（缺的：' + (missing.length ? missing.join('、') : '无') + '）')

  const strayJs = wanted.filter((name) => name.endsWith('.ts') && fs.existsSync(path.join(DIR, name.slice(0, -3) + '.js')))
  check(strayJs.length === 0, '真源旁边没有同名 .js 产物（多出来的：' + (strayJs.length ? strayJs.join('、') : '无') + '）')

  // 判断层与适配层可以互相 import（同一目录内的纯函数），但不许 import 界面库、不许摸后端。
  // 动作与词条仍从参数进，所以这里的 import 只会指向同目录的兄弟模块。
  const offenders = wanted.filter((name) => {
    if (!name.endsWith('.ts')) return false
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    const specs = []
    const re = /^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm
    let m
    while ((m = re.exec(src)) !== null) specs.push(m[1])
    return specs.some((spec) => spec.indexOf('./') !== 0)
  })
  check(offenders.length === 0,
    '判断层只 import 同目录的兄弟模块，不 import 界面库与后端（违反的：' + (offenders.length ? offenders.join('、') : '无') + '）')

  const typeExports = ['MapTicketRow', 'MapTicketsBucket', 'TicketCardFacts', 'TicketFactsEnv', 'TicketFeed', 'TicketBoard', 'TicketBoardCounts', 'MapRowContent', 'MapProfile', 'TicketCardHandlers', 'MapDetailPageInputs', 'MapDetailPageModel', 'ContainerKind']
  const typesSrc = fs.readFileSync(path.join(DIR, 'contracts/mapDetailTypes.d.ts'), 'utf8')
  const missingTypes = typeExports.filter((name) => typesSrc.indexOf('export interface ' + name) < 0 && typesSrc.indexOf('export type ' + name) < 0)
  check(missingTypes.length === 0, '数据契约里的关键类型都声明了（缺的：' + (missingTypes.length ? missingTypes.join('、') : '无') + '）')
}

// ===========================================================================
// 1. 动作与状态词表
// ===========================================================================
section('1. 动作映射与状态词条键：九个生产动作全有去处，四个状态各有一个键')
{
  const expectActions = {
    diagnose: 'diagnose', takeover: 'claim', supplement: 'supplement', fix: 'fix',
    discuss: 'grill', research: 'research', prototype: 'proto', execute: 'execute', implement: 'implement',
  }
  const gotKeys = Object.keys(facts.CARD_ACTION_BY_SOURCE).sort().join(',')
  const wantKeys = Object.keys(expectActions).sort().join(',')
  check(gotKeys === wantKeys, '动作表九个键齐（期望 ' + show(wantKeys) + '，实得 ' + show(gotKeys) + '）')

  const wrong = Object.keys(expectActions).filter((k) => facts.CARD_ACTION_BY_SOURCE[k] !== expectActions[k])
  check(wrong.length === 0, '九个动作各自映到确定的样张键（错的：' + (wrong.length ? wrong.map((k) => k + '→' + facts.CARD_ACTION_BY_SOURCE[k]).join('、') : '无') + '）')
  check(facts.CARD_ACTION_BY_SOURCE.implement === 'implement',
    'implement（实施）有自己的样张，卡面按钮字与注入的 /implement 同源，不再借「执行」的画法（实得 ' + show(facts.CARD_ACTION_BY_SOURCE.implement) + '）')
  check(facts.cardActionOf('不存在的动作') === 'execute' && facts.cardActionOf(undefined) === 'execute',
    '认不出的动作与 undefined 都退回 execute（实得 ' + show(facts.cardActionOf('不存在的动作')) + ' / ' + show(facts.cardActionOf(undefined)) + '）')

  const expectCopy = { ready: 'card.pickReady', doing: 'card.doing', blocked: 'card.blockedCount', closed: 'card.closedState' }
  const copyOk = Object.keys(expectCopy).every((k) => facts.CARD_STATUS_COPY_KEY[k] === expectCopy[k])
  check(copyOk, '四种状态各绑一个词条键（实得 ' + show(JSON.stringify(facts.CARD_STATUS_COPY_KEY)) + '）')
  check(Object.keys(facts.CARD_STATUS_COPY_KEY).length === 4, '状态词表只收四种，不多不少（实得 ' + Object.keys(facts.CARD_STATUS_COPY_KEY).length + ' 种）')
}

// ===========================================================================
// 2. 状态判定：与宿主 groupTickets 同口径
// ===========================================================================
section('2. 状态判定：已关闭 > 在办 > 被挡 > 可接，阻塞者不在本图不算被挡')
{
  const openByNumber = { '1332': true, '1316': true }
  check(facts.ticketCardStatusOf({ state: 'CLOSED', claimedBy: 'x', blockedBy: [1332] }, openByNumber) === 'closed',
    '已关闭最优先：同时有人认领、有阻塞者，仍判 closed')
  check(facts.ticketCardStatusOf({ state: 'closed', claimedBy: 'x' }, openByNumber) === 'closed',
    '小写 closed 也认（比较统一按大写，不赌后端的大小写习惯）')
  check(facts.ticketCardStatusOf({ state: 'OPEN', claimedBy: 'x', blockedBy: [1332] }, openByNumber) === 'doing',
    '在办优先于被挡：认领了就不再判 blocked')
  check(facts.ticketCardStatusOf({ state: 'OPEN', assignees: [{ login: 'y' }], blockedBy: [1332] }, openByNumber) === 'doing',
    '没有 claimedBy 时从 assignees 第一个登录名认出在办')
  check(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: [1332] }, openByNumber) === 'blocked',
    '没人认领 + 有仍在开的阻塞者 → blocked')
  check(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: [9999] }, openByNumber) === 'ready',
    '阻塞者不在本图（9999 没在 openByNumber 里）→ 可接，与宿主 frontier 同口径')
  check(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: ['1332'] }, openByNumber) === 'blocked',
    '字符串形式的阻塞者编号同样认')
  // 本地 / effort 后端的票号补零：行 key '01' 被 parseInt 成 1，阻塞者却原样写 '01'。
  // 不归一的话整张地图的阻塞关系会静默失效（被挡票全画成可接），这条判据钉住归一。
  check(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: ['01'] }, { '1': true }) === 'blocked',
    '补零编号 01 与 1 当成同一张票（实得 ' + show(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: ['01'] }, { '1': true })) + '）')
  check(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: [' 01 '] }, { '1': true }) === 'blocked',
    '编号两端的空白也去掉再比（实得 ' + show(facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: [' 01 '] }, { '1': true })) + '）')
  // 有意的放宽（与宿主 groupTickets 只认 OPEN 不同）：状态缺失或写法不认识时按「开着」判。
  // 若照着宿主只认 OPEN，脏行会被当成已关闭，悄悄从看板上消失；宁可让它显眼地排进可接。
  check(facts.ticketCardStatusOf({ title: '状态缺失' }, openByNumber) === 'ready',
    '状态缺失的脏行按开着判、排在可接里（与宿主 groupTickets 的有意差异）')
  check(facts.ticketCardStatusOf({ state: 'REOPENED' }, openByNumber) === 'ready',
    '不认识的状态写法同样按开着判')
}

// ===========================================================================
// 3. 一张卡的刻画：夹具是十张票，覆盖四种状态与全部附加形态
// ===========================================================================
// 夹具：票号、状态、阻塞关系、标签形状都按真后端的几种写法来。
const ROWS = [
  { key: 'i-1332', number: 1332, title: '订阅源切成八段', state: 'OPEN', labels: ['wayfinder:task', 'bug'], updatedAt: '2026-10-20T10:00:00Z' },
  { key: 'i-1374', number: 1374, title: '一个进程只建一个日志实例', state: 'OPEN', labels: ['wayfinder:task'], blockedBy: [1332], updatedAt: '2026-10-21T08:00:00Z' },
  { key: 'i-1316', number: 1316, title: '决定读回失败的处置策略', state: 'OPEN', labels: ['wayfinder:grilling'], updatedAt: '2026-10-19' },
  { key: 'i-1348', number: 1348, title: '宿主启动次数在一千到四千之间', state: 'OPEN', labels: ['wayfinder:research'], claimedBy: 'FeatherHunter', updatedAt: '2026-10-21' },
  { key: 'i-1350', number: 1350, title: '被挡但有人在办的票', state: 'OPEN', labels: ['wayfinder:research'], claimedBy: 'someone', blockedBy: [1332] },
  { key: 'i-1315', number: 1315, title: '定位读回失败在哪一层', state: 'CLOSED', labels: [{ name: 'wayfinder:research', color: '#0ea5e9' }], closedAt: '2026-10-18T09:00:00Z', updatedAt: '2026-10-18' },
  { key: 'i-1317', number: 1317, title: '把真重启与重复写分开', state: 'CLOSED', labels: ['wayfinder:research'], closedAt: '2026-10-18T11:00:00Z' },
  { key: 'i-1331', number: 1331, title: '一个进程只建一个日志实例（方案）', state: 'CLOSED', labels: ['wayfinder:task'], closedAt: '2026-10-17' },
  { key: 'i-1400', number: 1400, title: '行自带类型兜底的原型票', state: 'OPEN', labels: ['needs-triage'], type: 'prototype' },
  { key: 'i-1401', number: 1401, title: '普通票没有类型小签', state: 'OPEN', labels: ['needs-triage'] },
]
const ACTIONS = { 1316: 'discuss', 1348: 'research', 1317: 'takeover', 1400: 'prototype', 1401: 'implement' }
const COLOR_OF = {
  'wayfinder:task': '10b981', 'wayfinder:research': '0ea5e9', 'wayfinder:grilling': '9d7cd8',
  'wayfinder:prototype': 'f59e0b', 'wayfinder:map': '8b5cf6', bug: 'd73a4a',
}
const ENV = {
  cardIdPrefix: 'm1314',
  colorOf: COLOR_OF,
  actionOf: (row) => ACTIONS[row.number] || 'execute',
  textOf: (key) => key,
}
const CTX = facts.ticketFactsContextOf(ROWS, ENV)
const FACTS = ROWS.map((row) => facts.ticketCardFactsOf(row, CTX))

/** 按票号取一张卡的刻画；取不到时返回空对象，让断言记 FAIL 而不是当场抛错。 */
function factOf (number) {
  const found = FACTS.filter((one) => one.number === number)
  return found.length === 1 ? found[0] : {}
}

section('3. 卡片刻画：编号 / 标题 / 小签 / BUG / 认领 / 更新日 / 页脚 / 角标')
{
  check(FACTS.length === ROWS.length, '十张票各出一份刻画（实得 ' + FACTS.length + ' 份）')

  const ready = factOf(1332)
  check(ready.status === 'ready' && ready.action === 'execute' && ready.noText === '#1332' && ready.title === '订阅源切成八段',
    '#1332：可接、执行样张、编号文本与标题都对（实得 ' + show(ready.status) + ' / ' + show(ready.action) + ' / ' + show(ready.noText) + '）')
  check(ready.bug === true, '带 bug 标签的票挂 BUG 三角（实得 ' + show(ready.bug) + '）')
  check(show(ready.tags) === show([{ text: 'type.task', color: '10b981' }]),
    '类型小签从 wayfinder 标签取，文字走词条键、颜色取标签真实色（实得 ' + show(ready.tags) + '）')
  check(ready.updatedText === '10-20', '更新日截成 MM-DD（实得 ' + show(ready.updatedText) + '）')
  check(ready.footText === 'card.pickReady' && ready.pickCorner === 'ready',
    '可接卡的页脚键与左下角角标（实得 ' + show(ready.footText) + ' / ' + show(ready.pickCorner) + '）')
  check(ready.cardId === 'm1314-1332-i-1332', '卡片 id 是前缀+编号+行 key：撞号时两张卡也不会共用同一个 DOM id（实得 ' + show(ready.cardId) + '）')
  check(ready.rowKey === 'i-1332', '行自己的 key 原样保留（实得 ' + show(ready.rowKey) + '）')

  const doing = factOf(1348)
  check(doing.status === 'doing' && doing.action === 'research' && doing.claimedBy === 'FeatherHunter',
    '#1348：在办、研究样张、认领人取到（实得 ' + show(doing.status) + ' / ' + show(doing.action) + ' / ' + show(doing.claimedBy) + '）')
  check(doing.footText === 'card.doing' && doing.pickCorner === 'doing' &&
    show(doing.tags) === show([{ text: 'type.research', color: '0ea5e9' }]),
    '在办卡的页脚键、角标、小签（实得 ' + show(doing.footText) + ' / ' + show(doing.pickCorner) + ' / ' + show(doing.tags) + '）')

  // p101 定版：认领优先，在办票画「在办」角标而不是 BUG 三角；结案票才保留 BUG。
  const doingBug = facts.ticketCardFactsOf({ number: 1601, title: '在办的 bug 票', state: 'OPEN', labels: ['bug'], claimedBy: 'someone' },
    facts.ticketFactsContextOf([{ number: 1601, title: '在办的 bug 票', state: 'OPEN', claimedBy: 'someone' }], ENV))
  check(doingBug.status === 'doing' && doingBug.bug === false && doingBug.pickCorner === 'doing',
    '在办 + bug：画在办角标，不给 BUG 三角（实得 status=' + show(doingBug.status) + '、bug=' + show(doingBug.bug) + '、角标=' + show(doingBug.pickCorner) + '）')
  const closedBug = facts.ticketCardFactsOf({ number: 1602, title: '结案的 bug 票', state: 'CLOSED', labels: ['bug'] },
    facts.ticketFactsContextOf([{ number: 1602, title: '结案的 bug 票', state: 'CLOSED' }], ENV))
  check(closedBug.status === 'closed' && closedBug.bug === true,
    '结案 + bug：BUG 三角保留（实得 status=' + show(closedBug.status) + '、bug=' + show(closedBug.bug) + '）')

  const grill = factOf(1316)
  check(grill.action === 'grill' && show(grill.tags) === show([{ text: 'type.grilling', color: '9d7cd8' }]),
    '#1316：discuss 动作映到 grill 样张、讨论小签取 9d7cd8（实得 ' + show(grill.action) + ' / ' + show(grill.tags) + '）')

  const closed = factOf(1315)
  check(closed.status === 'closed' && closed.footText === 'card.closedState' && closed.pickCorner === null,
    '结案卡：页脚是「已结案」键，不再给角标（实得 ' + show(closed.status) + ' / ' + show(closed.footText) + ' / ' + show(closed.pickCorner) + '）')
  check(show(closed.tags) === show([{ text: 'type.research', color: '#0ea5e9' }]),
    '标签对象自带的颜色优先于色表（实得 ' + show(closed.tags) + '）')
  check(closed.claimedBy === '' && closed.blockedBy === null && closed.blocks === null,
    '结案卡不表现认领人与阻塞关系（实得 ' + show(closed.claimedBy) + ' / ' + show(closed.blockedBy) + ' / ' + show(closed.blocks) + '）')

  const typed = factOf(1400)
  check(typed.action === 'proto' && show(typed.tags) === show([{ text: 'type.prototype', color: 'f59e0b' }]),
    '行自带 type=prototype 时兜底认出原型样张与小签（实得 ' + show(typed.action) + ' / ' + show(typed.tags) + '）')

  const plain = factOf(1401)
  check(show(plain.tags) === show([]), '普通票（issue）不给类型小签（实得 ' + show(plain.tags) + '）')
  check(plain.action === 'implement', 'implement 动作画实施样张（实得 ' + show(plain.action) + '）')

  check(facts.updatedTextOf({ updatedAt: 'not-a-date' }) === '' && facts.updatedTextOf({}) === '',
    '更新日认不出时是空串，不拿乱码当日期（实得 ' + show(facts.updatedTextOf({ updatedAt: 'not-a-date' })) + ' / ' + show(facts.updatedTextOf({})) + '）')

  // 编号解析：number 优先，其次 key。
  const numberCases = [
    [facts.ticketNumberOf({ number: 7 }), 7, 'number=7'],
    [facts.ticketNumberOf({ key: '0042' }), 42, 'key="0042"'],
    [facts.ticketNumberOf({ key: 9 }), 9, 'key=9'],
    [facts.ticketNumberOf({}), null, '都没有'],
  ]
  const numberBad = numberCases.filter((one) => one[0] !== one[1]).map((one) => one[2] + '→' + show(one[0]))
  check(numberBad.length === 0, '票号解析：数字优先、其次 key、都没有给 null（错的：' + (numberBad.length ? numberBad.join('、') : '无') + '）')

  // 标签名：字符串与对象两种形状、去重保序。
  const names = facts.ticketLabelNamesOf({ labels: ['a', { name: 'b' }, 'a', { name: 'a' }, { color: 'x' }] })
  check(show(names) === show(['a', 'b']), '标签名列表：对象形状认 name、去重保序（实得 ' + show(names) + '）')
}

// ===========================================================================
// 4. 阻塞关系双向
// ===========================================================================
section('4. 阻塞关系：被挡卡指向编号最小的开着阻塞者，挡路卡指向确实被挡的第一张')
{
  const blocked = factOf(1374)
  check(blocked.status === 'blocked' && show(blocked.blockedBy) === show({ no: '1332', title: '订阅源切成八段', cardId: 'm1314-1332-i-1332' }),
    '#1374 被 #1332 挡住：编号、标题、对方卡片 id 三样都指向它（实得 ' + show(blocked.blockedBy) + '）')
  check(blocked.footText === 'card.blockedCount' && blocked.pickCorner === null,
    '被挡卡的页脚键与「没有角标」（实得 ' + show(blocked.footText) + ' / ' + show(blocked.pickCorner) + '）')

  const blocker = factOf(1332)
  check(show(blocker.blocks) === show({ no: '1374', title: '一个进程只建一个日志实例', cardId: 'm1314-1374-i-1374' }),
    '挡路卡 #1332 指向它挡住的第一张 #1374（实得 ' + show(blocker.blocks) + '）')

  const claimedButBlocked = factOf(1350)
  check(claimedButBlocked.status === 'doing' && claimedButBlocked.blockedBy === null && claimedButBlocked.blocks === null,
    '既被挡又有人在办的 #1350 按在办画：不挂 blockedBy 与挡路条（实得 ' + show(claimedButBlocked.status) + ' / ' + show(claimedButBlocked.blockedBy) + ' / ' + show(claimedButBlocked.blocks) + '）')

  const closed = factOf(1315)
  check(closed.blockedBy === null && closed.blocks === null, '结案卡的阻塞关系两个方向都是 null（实得 ' + show(closed.blockedBy) + ' / ' + show(closed.blocks) + '）')

  // 挡路卡只指向「确实处于被挡状态」的那张：在办票不算。
  const onlyClaimedChild = facts.ticketCardFactsOf({ number: 1500, title: '挡路者', state: 'OPEN', labels: ['wayfinder:task'] },
    facts.ticketFactsContextOf([
      { number: 1500, title: '挡路者', state: 'OPEN' },
      { number: 1501, title: '被挡的', state: 'OPEN', blockedBy: [1500] },
      { number: 1502, title: '在办的', state: 'OPEN', blockedBy: [1500], claimedBy: 'x' },
    ], ENV))
  check(show(onlyClaimedChild.blocks) === show({ no: '1501', title: '被挡的', cardId: 'm1314-1501' }),
    '挡路卡的挡路条指向真正被挡的那张，认领了的不算（实得 ' + show(onlyClaimedChild.blocks) + '）')

  // 一张票被两张挡住时，两侧必须指向同一对：被挡卡说被主阻塞者（编号最小）挡，
  // 只有主阻塞者才画「阻塞的就是这张」，另一张不能也说自己挡住它。
  const multiRows = [
    { key: 'm-10', number: 10, title: '次阻塞者', state: 'OPEN' },
    { key: 'm-1', number: 1, title: '主阻塞者', state: 'OPEN' },
    { key: 'm-5', number: 5, title: '被两张挡的', state: 'OPEN', blockedBy: [10, 1] },
  ]
  const multiCtx = facts.ticketFactsContextOf(multiRows, ENV)
  const multiFacts = multiRows.map((row) => facts.ticketCardFactsOf(row, multiCtx))
  const multiOf = (no) => multiFacts.filter((one) => one.number === no)[0]
  check(show(multiOf(5).blockedBy) === show({ no: '1', title: '主阻塞者', cardId: 'm1314-1-m-1' }),
    '被两张挡的票只指主阻塞者（编号最小的 #1，实得 ' + show(multiOf(5).blockedBy) + '）')
  check(show(multiOf(1).blocks) === show({ no: '5', title: '被两张挡的', cardId: 'm1314-5-m-5' }),
    '主阻塞者 #1 的挡路条指向那张被挡票（实得 ' + show(multiOf(1).blocks) + '）')
  check(multiOf(10).blocks === null,
    '次阻塞者 #10 不说自己挡住它，两侧说法一致（实得 ' + show(multiOf(10).blocks) + '）')
  // 补零编号进阻塞关系：行 key '01' 解析成 1，阻塞者写 '01' 也要挂得上去。
  const paddedRows = [
    { key: '01', number: 1, title: '补零挡路者', state: 'OPEN' },
    { key: '02', number: 2, title: '被挡住', state: 'OPEN', blockedBy: ['01'] },
  ]
  const paddedFacts = paddedRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(paddedRows, ENV)))
  check(paddedFacts[1].status === 'blocked' && show(paddedFacts[1].blockedBy) === show({ no: '1', title: '补零挡路者', cardId: 'm1314-1-01' }),
    '补零编号的阻塞关系建得起来（实得 status=' + show(paddedFacts[1].status) + '、blockedBy=' + show(paddedFacts[1].blockedBy) + '）')
}

// ===========================================================================
// 5. 卡片 id 的作用域
// ===========================================================================
section('5. 卡片 id：前缀由调用方给，同屏两张地图不会撞同一个 DOM id')
{
  const ctxB = facts.ticketFactsContextOf(ROWS, Object.assign({}, ENV, { cardIdPrefix: 'other' }))
  const a = FACTS[0]
  const b = facts.ticketCardFactsOf(ROWS[0], ctxB)
  check(a.cardId === 'm1314-1332-i-1332' && b.cardId === 'other-1332-i-1332',
    '同一张票在两个前缀下拿到不同的卡片 id（实得 ' + show(a.cardId) + ' / ' + show(b.cardId) + '）')
  const noPrefix = facts.ticketFactsContextOf(ROWS, Object.assign({}, ENV, { cardIdPrefix: '' }))
  check(facts.ticketCardFactsOf(ROWS[0], noPrefix).cardId === null,
    '没给前缀时 cardId 是 null，不拿裸编号冒充唯一 id（实得 ' + show(facts.ticketCardFactsOf(ROWS[0], noPrefix).cardId) + '）')
}

// ===========================================================================
// 6. 看板：未完成段、已完成段、计数
// ===========================================================================
section('6. 看板排序：三条性质 + 已完成段')
{
  const open = board.orderOpenTickets(FACTS)
  const closed = board.orderClosedTickets(FACTS)
  const numbers = (list) => list.map((one) => one.number).join(',')
  check(numbers(open) === '1348,1350,1316,1332,1400,1401,1374',
    '未完成段顺序：在办 → 可接 → 被挡，段内按编号（实得 ' + show(numbers(open)) + '）')
  const statusesInOrder = open.map(function (one) { return one.status })
  check(show(statusesInOrder) === show(['doing', 'doing', 'ready', 'ready', 'ready', 'ready', 'blocked']),
    '三段的分界与维护者口径一致：在办两张、可接四张、被挡一张（实得 ' + show(statusesInOrder.join(',')) + '）')
  check(open[open.length - 1].number === 1374,
    '被挡的票排在这一段的最后，不再插到挡它的那张旁边（实得最后一张是 #' + show(open[open.length - 1].number) + '）')

  // 一张挡路者挡住两张、其中一张自己还有下游：这几张必须连在该段里，但不保证两张被挡票相邻。
  const fanRows = [
    { key: 'f-100', number: 100, title: '挡路者', state: 'OPEN' },
    { key: 'f-101', number: 101, title: '被挡之一', state: 'OPEN', blockedBy: [100] },
    { key: 'f-102', number: 102, title: '被挡之二', state: 'OPEN', blockedBy: [100] },
    { key: 'f-103', number: 103, title: '下游', state: 'OPEN', blockedBy: [101] },
  ]
  const fanFacts = fanRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(fanRows, ENV)))
  const fanOrder = board.orderOpenTickets(fanFacts).map((one) => one.number).join(',')
  check(fanOrder === '100,101,102,103',
    '被挡段按挡路者编号聚拢：同一挡路者挡住的两张连在一起（实得 ' + show(fanOrder) + '）')
  const fanNo = fanOrder.split(',').map((one) => Number(one))
  check(fanNo.indexOf(103) > fanNo.indexOf(101) && fanNo.indexOf(102) > fanNo.indexOf(100),
    '下游排在挡它的那张之后，第二张被挡票也排在挡路者之后')
  check(numbers(closed) === '1317,1315,1331',
    '已完成段按结案时间倒序、同刻按编号（实得 ' + show(numbers(closed)) + '）')
  const oddStamp = board.orderClosedTickets([
    { number: null, rowKey: 'bad', status: 'closed', closedAt: '不是日期' },
    { number: 7, rowKey: '7', status: 'closed', closedAt: '2026-10-18' },
  ]).map((one) => one.rowKey).join(',')
  check(oddStamp === '7,bad', '结案时间认不出的票排在最后，不丢也不乱序（实得 ' + show(oddStamp) + '）')
  check(closed.every((one) => one.status === 'closed') && open.every((one) => one.status !== 'closed'),
    '两段按状态分开，没有一张混进去')

  const emitted = open.concat(closed).map((one) => one.number)
  check(emitted.length === ROWS.length && new Set(emitted).size === ROWS.length,
    '十张票每张恰好出现一次（出现 ' + emitted.length + ' 次，去重后 ' + new Set(emitted).size + ' 张）')

  // 没有编号的两张结案票、结案时间相同：只靠「时间 + 编号」分不出先后，排序必须自己可复现。
  const tiedClosed = [
    { number: null, rowKey: 'b', status: 'closed', closedAt: '2026-10-18' },
    { number: null, rowKey: 'a', status: 'closed', closedAt: '2026-10-18' },
  ]
  const tieForward = board.orderClosedTickets(tiedClosed).map((one) => one.rowKey).join(',')
  const tieBackward = board.orderClosedTickets(tiedClosed.slice().reverse()).map((one) => one.rowKey).join(',')
  check(tieForward === 'a,b' && tieBackward === 'a,b',
    '已完成段并列时用行 key 兜底，输入倒序也同序（实得 ' + show(tieForward) + ' / ' + show(tieBackward) + '）')

  const reversed = board.orderOpenTickets(FACTS.slice().reverse())
  const rotated = board.orderOpenTickets(FACTS.slice(3).concat(FACTS.slice(0, 3)))
  check(numbers(reversed) === numbers(open) && numbers(rotated) === numbers(open),
    '输入顺序不影响结果（倒序、循环移位后都同序：' + show(numbers(reversed)) + ' / ' + show(numbers(rotated)) + '）')

  const theBoard = board.orderTicketBoard(FACTS)
  check(numbers(theBoard.open) === numbers(open) && numbers(theBoard.closed) === numbers(closed),
    'orderTicketBoard 一次给出两段，与分别调用的结果一致')

  const counts = board.boardCountsOf(FACTS)
  check(show(counts) === show({ total: 10, closed: 3, ready: 4, doing: 2, blocked: 1 }),
    '看板计数与状态判定同口径（实得 ' + show(counts) + '）')
  check(counts.ready + counts.doing + counts.blocked + counts.closed === counts.total,
    '四个状态加起来等于总数（' + counts.ready + '+' + counts.doing + '+' + counts.blocked + '+' + counts.closed + '=' + counts.total + '）')
}

section('6.1 脏数据：成环、自阻塞、缺编号')
{
  const cycleRows = [
    { number: 2001, title: '环一号', state: 'OPEN', blockedBy: [2002] },
    { number: 2002, title: '环二号', state: 'OPEN', blockedBy: [2001] },
    { number: 2003, title: '自阻塞', state: 'OPEN', blockedBy: [2003] },
    { title: '没有编号', state: 'OPEN' },
  ]
  const cycleFacts = cycleRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(cycleRows, ENV)))
  const order = board.orderOpenTickets(cycleFacts)
  const keys = order.map((one) => one.number === null ? 'k:' + one.rowKey : String(one.number))
  check(order.length === cycleRows.length && new Set(keys).size === cycleRows.length,
    '成环、自阻塞、缺编号的票各出现一次，不丢不重（实得 ' + show(keys.join(',')) + '）')
  check(keys.join(',') === 'k:,2002,2001,2003',
    '脏数据排序确定：可接的无编号票排最前；被挡段按挡路者编号（2002 被 2001 挡，所以排在 2001 之前），自阻塞的最后（实得 ' + show(keys.join(',')) + '）')
  check(keys.indexOf('2001') >= 0 && keys.indexOf('2002') >= 0,
    '互相挡住的两张也画出来了（实得 ' + show(keys.join(',')) + '）')
  const noNumber = order.filter((one) => one.number === null)
  check(noNumber.length === 1 && noNumber[0].rowKey === '', '缺编号的票按行 key 兜底（number=null、rowKey=' + show(noNumber.length ? noNumber[0].rowKey : null) + '）')

  // 撞编号的脏数据：两张行写成同一个编号。只拿编号认名字会把第二张当成「已经画过」静默丢掉。
  const dupRows = [
    { key: 'dup-a', number: 3001, title: '撞号一', state: 'OPEN' },
    { key: 'dup-b', number: 3001, title: '撞号二', state: 'OPEN' },
  ]
  const dupFacts = dupRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(dupRows, ENV)))
  const dupOrder = board.orderOpenTickets(dupFacts)
  check(dupOrder.length === 2 && dupOrder.map((one) => one.rowKey).sort().join(',') === 'dup-a,dup-b',
    '两张票撞同一个编号时两张都画出来，不静默丢一张（实得 ' + show(dupOrder.map((one) => one.rowKey).join(',')) + '）')
  check(dupFacts[0].cardId !== dupFacts[1].cardId && dupFacts[0].cardId === 'm1314-3001-dup-a',
    '撞编号的两张卡拿到不同 DOM id，点被挡卡不会亮错（实得 ' + show(dupFacts.map((one) => one.cardId).join(' / ')) + '）')

  // 连编号带行 key 都一样的两张脏行：靠「输入里的第几张」区分，仍然各画一次。
  const sameRows = [
    { key: 'dup-same', number: 3002, title: '同号同 key 一', state: 'OPEN' },
    { key: 'dup-same', number: 3002, title: '同号同 key 二', state: 'OPEN' },
  ]
  const sameFacts = sameRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(sameRows, ENV)))
  const sameOrder = board.orderOpenTickets(sameFacts)
  check(sameOrder.length === 2 && sameOrder.map((one) => one.title).join(',') === '同号同 key 一,同号同 key 二',
    '编号和行 key 都相同的两张脏行也各画一次（实得 ' + show(sameOrder.map((one) => one.title).join(',')) + '）')

  // 两行都没有编号、也没有 key：内容完全一样，只靠「输入里的第几张」区分，仍要各画一次。
  const blankRows = [
    { title: '无编号一', state: 'OPEN' },
    { title: '无编号二', state: 'OPEN' },
  ]
  const blankFacts = blankRows.map((row) => facts.ticketCardFactsOf(row, facts.ticketFactsContextOf(blankRows, ENV)))
  const blankOrder = board.orderOpenTickets(blankFacts)
  const blankBackward = board.orderOpenTickets(blankFacts.slice().reverse())
  check(blankOrder.length === 2 && blankOrder.map((one) => one.title).sort().join(',') === '无编号一,无编号二',
    '两行都没有编号也没有 key 时也各画一次（实得 ' + show(blankOrder.map((one) => one.title).join(',')) + '）')
  check(blankOrder.map((one) => one.title).join(',') === blankBackward.map((one) => one.title).join(','),
    '这种空白行的次序不随输入顺序变（实得 ' + show(blankOrder.map((one) => one.title).join(',')) + ' / ' + show(blankBackward.map((one) => one.title).join(',')) + '）')

  // 很长的阻塞链：递归走图会在几千层时爆栈，显式队列必须能走完（这条判据替掉「靠人记住链不会太长」）。
  const CHAIN = 20000
  const chainRows = []
  for (let i = 1; i <= CHAIN; i += 1) {
    chainRows.push(i === 1 ? { key: 'c-1', number: 1, title: '链头', state: 'OPEN' } : { key: 'c-' + i, number: i, title: '链上第 ' + i + ' 张', state: 'OPEN', blockedBy: [i - 1] })
  }
  const chainCtx = facts.ticketFactsContextOf(chainRows, ENV)
  const chainFacts = chainRows.map((row) => facts.ticketCardFactsOf(row, chainCtx))
  const chainOrder = board.orderOpenTickets(chainFacts)
  check(chainOrder.length === CHAIN && chainOrder[0].number === 1 && chainOrder[CHAIN - 1].number === CHAIN,
    '两千层以上的阻塞链能走完且顺序沿链展开（实得 ' + chainOrder.length + ' 张，首尾 ' + show(chainOrder[0].number) + ' / ' + show(chainOrder[CHAIN - 1].number) + '）')
}

// ===========================================================================
// 7. 取数：五态合成
// ===========================================================================
section('7. 取数五态：取回那份 / 正在取 / 不支持 / 取失败 / 还没有桶')
{
  const snapshot = { tickets: [{ number: 1, title: '快照票', state: 'OPEN' }], stats: { total: 9, closed: 4 } }

  const real = feed.ticketFeedOf({
    mode: 'real', items: [{ number: 1, title: 'a' }, { number: 2, title: 'b' }],
    stats: { total: 3, closed: 1 }, total: 3, capped: true, missing: 2,
  }, null)
  check(real.state === 'ready' && real.source === 'requested' && real.rows.length === 2 && real.total === 3 &&
    real.capped === true && real.missing === 2 && real.empty === false && real.failedMessage === '',
    '取回那份：来源 requested、total/capped/missing 原样带出（实得 ' + show(JSON.stringify(real)) + '）')
  check(show(real.stats) === show({ total: 3, closed: 1 }), '取回那份用自己的 stats（实得 ' + show(real.stats) + '）')

  const realFallback = feed.ticketFeedOf({ mode: 'real', items: [] }, snapshot)
  check(realFallback.stats && realFallback.stats.total === 9, '取回那份没给 stats 时退回快照的 stats（实得 ' + show(realFallback.stats) + '）')
  check(realFallback.empty === false && realFallback.total === null,
    '取回 0 张但快照说本图共 9 张：不说「没有子票」、total 不拿行数冒充（实得 empty=' + show(realFallback.empty) + '、total=' + show(realFallback.total) + '）')

  const loading = feed.ticketFeedOf({ mode: 'loading' }, snapshot)
  check(loading.state === 'loading' && loading.source === 'snapshot' && loading.rows.length === 1 &&
    loading.capped === false && loading.missing === 0 && loading.total === null,
    '正在取：先画快照、把「正在取」说出来，capped/missing 不冒充（实得 ' + show(JSON.stringify(loading)) + '）')

  const unsupported = feed.ticketFeedOf({ mode: 'err', error: { kind: 'unsupported', message: '后端做不到' } }, snapshot)
  check(unsupported.state === 'unsupported' && unsupported.source === 'snapshot' &&
    unsupported.failedMessage === '' && unsupported.rows.length === 1,
    '后端明确回 unsupported：按快照画、不报错（实得 ' + show(JSON.stringify(unsupported)) + '）')

  const longMessage = '取数失败的原因'.repeat(40)
  const failedFeed = feed.ticketFeedOf({ mode: 'err', error: { kind: 'network', message: longMessage } }, snapshot)
  check(failedFeed.state === 'failed' && failedFeed.failedMessage.length === 120 &&
    failedFeed.failedMessage === longMessage.slice(0, 120),
    '其它取数失败：原因截到 120 字（实得 ' + failedFeed.failedMessage.length + ' 字）')

  const emptyFailed = feed.ticketFeedOf({ mode: 'err', error: { kind: 'parse' } }, null)
  check(emptyFailed.state === 'failed' && emptyFailed.failedMessage === '' && emptyFailed.empty === false,
    '取失败时不以内部档位词当原因（不画「子票没取到：parse」），也不说成「没有子票」（实得 ' + show(emptyFailed.failedMessage) + ' / ' + show(emptyFailed.empty) + '）')

  const badReal = feed.ticketFeedOf({ mode: 'real', items: '这不是数组' }, snapshot)
  check(badReal.state === 'failed' && badReal.source === 'snapshot' && badReal.rows.length === 1 &&
    badReal.total === null && badReal.empty === false,
    '桶说成功但 items 不是数组：按失败画，不静默拿快照冒充完整数据（实得 ' + show(badReal.state) + ' / ' + show(badReal.rows.length) + ' / ' + show(badReal.empty) + '）')

  const noBucket = feed.ticketFeedOf(null, snapshot)
  check(noBucket.state === 'ready' && noBucket.source === 'snapshot' && noBucket.rows.length === 1,
    '还没有桶：按快照画、不说成「正在取」（实得 ' + show(noBucket.state) + ' / ' + show(noBucket.source) + '）')

  const nothing = feed.ticketFeedOf(null, null)
  check(nothing.state === 'ready' && nothing.rows.length === 0 && nothing.empty === true && nothing.stats === null,
    '什么都没有时画空态，不抛错（实得 ' + show(JSON.stringify(nothing)) + '）')
}

// ===========================================================================
// 8. 交叉一致性：同一批行换顺序，刻画逐张不变
// ===========================================================================
section('8. 交叉一致性：行序打乱不影响每张卡的刻画')
{
  const shuffledRows = ROWS.slice().reverse()
  const ctxB = facts.ticketFactsContextOf(shuffledRows, ENV)
  const mapB = {}
  for (const row of shuffledRows) {
    const one = facts.ticketCardFactsOf(row, ctxB)
    mapB[one.number] = one
  }
  const diff = FACTS.filter((one) => show(one) !== show(mapB[one.number])).map((one) => one.number)
  check(diff.length === 0, '倒序输入时每张卡的刻画逐字段相同（不同的：' + (diff.length ? diff.join('、') : '无') + '）')

  const noLabels = facts.ticketLabelNamesOf({ labels: null })
  check(show(noLabels) === show([]), '没有标签时标签名列表是空数组（实得 ' + show(noLabels) + '）')
  const noBlockers = facts.ticketCardStatusOf({ state: 'OPEN', blockedBy: null }, {})
  check(noBlockers === 'ready', '没有阻塞者时判可接（实得 ' + show(noBlockers) + '）')
}

// ===========================================================================
// 9. MAP 自身内容：身份 / 目的地 / 档案四节 / 完成度 / 子票那句
// ===========================================================================
section('9. MAP 自身内容：标题、目的地、完成度、子票那句的段（档案正文不在这一层）')
{
  const COUNTS = { total: 8, closed: 4, ready: 2, doing: 1, blocked: 1 }
  const MAP_ROW = {
    number: 1314,
    key: '1314',
    title: '  插件日志持久化读回失败与宿主反复启动  ',
    destination: '查清插件日志里两类异常的真实成因',
    notes: ' 这里有一段备注 ',
  }

  // 维护者 2026-10-23：地图页不再展示正文档案（笔记 / 决策 / 战雾 / 范围外），
  // 点标题进 issue 详情页看原文；所以模型里也不该再有分节数据，免得页面两个来源各画一份。
  check(profile.MAP_PROFILE_SECTIONS === undefined && profile.SPEC_PROFILE_SECTIONS === undefined && profile.mapProfileSectionsOf === undefined,
    '档案分节不再由这一层提供（页面没有第二个正文来源）')


  check(profile.mapProgressPercentOf(COUNTS) === 50, '完成度 = 已完成 / 子票总数（4 / 8 → 50%，实得 ' + show(profile.mapProgressPercentOf(COUNTS)) + '）')
  check(profile.mapProgressPercentOf({ total: 0, closed: 0, ready: 0, doing: 0, blocked: 0 }) === 0,
    '一张子票都没有时完成度是 0（画满一条进度条会骗人）')
  check(profile.mapProgressPercentOf({ total: 3, closed: 5, ready: 0, doing: 0, blocked: 0 }) === 100 &&
    profile.mapProgressPercentOf(null) === 0, '脏数据不越界：超过 100% 截到 100，没有计数是 0')

  const realFeed = feed.ticketFeedOf({ mode: 'real', items: [{ number: 1 }], stats: { total: 8, closed: 4 } }, null)
  const full = profile.mapProfileOf(MAP_ROW, realFeed, COUNTS)
  check(full.kind === 'map', '没有 type 的容器行按探索地图画（实得 ' + show(full.kind) + '）')
  check(full.title === '插件日志持久化读回失败与宿主反复启动',
    '合成结果里的标题（实得 ' + show(full.title) + '）')
  check(full.destination === MAP_ROW.destination && full.hasDestination === true,
    '目的地原文带出，hasDestination 说有没有（实得 ' + show(full.hasDestination) + '）')
  check(show(full.counts) === show(COUNTS) && full.progressPercent === 50,
    '看板计数原样带出，完成度按同一份计数算（实得 ' + show(full.counts) + ' / ' + full.progressPercent + '）')
  check(Object.keys(full).sort().join(',') === 'counts,destination,errorText,feedSegments,hasDestination,kind,progressPercent,title',
    'MAP 自身内容只剩页面要画的七格：标题 / 目的地 / 计数 / 完成度 / 子票那句 / 错误 / 容器种类（没有档案与身份行）')
  check(full.errorText === '', '没有快照错误时 errorText 是空串（页面不画红字）')

  check(show(full.feedSegments) === show([{ key: 'map.subCount', params: { n: 8, c: 4 } }]),
    '取回那份：只说「本图 N 张子票（已关闭 C 张）」（实得 ' + show(full.feedSegments) + '）')

  const cappedFeed = feed.ticketFeedOf({ mode: 'real', items: [{ number: 1 }], stats: { total: 8, closed: 4 }, capped: true, missing: 2 }, null)
  const cappedSegs = profile.mapFeedSegmentsOf(cappedFeed)
  check(cappedSegs.map((one) => one.key).join(',') === 'map.subCount,map.subCountCapped,map.subCountShort',
    '被截断与差额各补一段，顺序在正句之后（实得 ' + show(cappedSegs.map((one) => one.key).join(',')) + '）')
  check(cappedSegs[1].params.n === 1000 && cappedSegs[2].params.n === 2,
    'capped 按宿主上限说「前 1000 张」，missing 说还剩几张（实得 ' + show(cappedSegs[1].params) + ' / ' + show(cappedSegs[2].params) + '）')

  const loadingSegs = profile.mapFeedSegmentsOf(feed.ticketFeedOf({ mode: 'loading' }, null))
  check(show(loadingSegs) === show([{ key: 'map.subCount', params: { n: '–', c: '–' } }]),
    '正在取：同一句话、数字换成短横占位（不写「正在取子票」，也不说成 0 张；实得 ' + show(loadingSegs) + '）')
  const loadingKnownSegs = profile.mapFeedSegmentsOf(feed.ticketFeedOf({ mode: 'loading' }, { stats: { total: 8, closed: 4 } }))
  check(show(loadingKnownSegs) === show([{ key: 'map.subCount', params: { n: 8, c: 4 } }]),
    '正在取但快照已经说了张数：直接说真数，取回来后不换字（实得 ' + show(loadingKnownSegs) + '）')
  const unsupportedSegs = profile.mapFeedSegmentsOf(feed.ticketFeedOf({ mode: 'err', error: { kind: 'unsupported' } }, null))
  check(show(unsupportedSegs) === show([]), '后端明确不支持：一个字都不加（实得 ' + show(unsupportedSegs) + '）')

  const longError = '取数失败的原因'.repeat(40)
  const failedSegs = profile.mapFeedSegmentsOf(feed.ticketFeedOf({ mode: 'err', error: { kind: 'network', message: longError } }, null))
  check(failedSegs.length === 1 && failedSegs[0].key === 'map.subCountFail' && failedSegs[0].params.msg.length === 120,
    '取失败：原因走词条并截到 120 字（实得 ' + failedSegs.length + ' 段 / ' + (failedSegs[0] && failedSegs[0].params.msg.length) + ' 字）')

  const snapshotSegs = profile.mapFeedSegmentsOf(feed.ticketFeedOf(null, { tickets: [], stats: { total: 5, closed: 2 } }))
  check(show(snapshotSegs) === show([{ key: 'map.subCount', params: { n: 5, c: 2 } }]),
    '还没有桶时按快照 stats 说（实得 ' + show(snapshotSegs) + '）')
  check(show(profile.mapFeedSegmentsOf(null)) === show([]) && show(profile.mapFeedSegmentsOf(undefined)) === show([]),
    '没有取数结果时没有那一段（实得 ' + show(profile.mapFeedSegmentsOf(null)) + '）')

  const errorRow = { error: { error: 'x'.repeat(200) } }
  check(profile.mapErrorTextOf(errorRow).length === 160, '快照错误截到 160 字（实得 ' + profile.mapErrorTextOf(errorRow).length + ' 字）')
  check(profile.mapErrorTextOf({ error: '  宿主说组装失败  ' }) === '宿主说组装失败',
    '错误直接是字符串时也读得懂，首尾空白去掉（实得 ' + show(profile.mapErrorTextOf({ error: '  宿主说组装失败  ' })) + '）')
  check(profile.mapErrorTextOf({}) === '', '没有错误时是空串（实得 ' + show(profile.mapErrorTextOf({})) + '）')

  const blankDestination = profile.mapProfileOf({ destination: '   ' }, null, null)
  check(blankDestination.hasDestination === false && blankDestination.destination === '',
    '只有空白的目的地等于没有（不把空白画成一句话，实得 ' + show(blankDestination.destination) + '）')
  check(blankDestination.progressPercent === 0 && blankDestination.title === '',
    '空行 + 空计数：一份不骗人的空档案（实得 ' + show(blankDestination) + '）')

  check(profile.containerKindOfRow({ type: 'spec' }) === 'spec' && profile.containerKindOfRow({}) === 'map' && profile.containerKindOfRow(null) === 'map',
    '容器种类只看快照行的 type：spec 才算规格，认不出的一律按探索地图画')

  const SPEC_ROW = {
    type: 'spec',
    number: 1380,
    title: '  实施规格：卡片层收口  ',
    destination: '规格没有目的地这一节',
  }

  const specFull = profile.mapProfileOf(SPEC_ROW, realFeed, null)
  check(specFull.kind === 'spec', '规格行的容器种类是 spec（实得 ' + show(specFull.kind) + '）')
  check(specFull.title === '实施规格：卡片层收口',
    '规格的标题也去空白后带出（实得 ' + show(specFull.title) + '）')
  check(show(specFull.feedSegments) === show([{ key: 'map.specSubCount', params: { n: 8, c: 4 } }]),
    '规格的「子票那句」用 map.specSubCount，不再说成探索地图（实得 ' + show(specFull.feedSegments) + '）')
  check(Object.keys(specFull).sort().join(',') === 'counts,destination,errorText,feedSegments,hasDestination,kind,progressPercent,title',
    '规格与探索地图用同一份 MAP 自身内容，没有另一套字段')
  const emptySpec = profile.mapProfileOf({ type: 'spec' }, null, null)
  check(show(emptySpec.feedSegments) === show([]) && emptySpec.kind === 'spec',
    '没有取数结果时那句不出，规格身份照旧（实得 ' + show(emptySpec.feedSegments) + '）')
}


// ===========================================================================
// 10. 适配层：一张票的刻画 → 卡片 props
// ===========================================================================
section('10. 适配层：四处理名不漏，四个按钮与整卡点按都把「是哪张票」交回页面')
{
  const ENV = { cardIdPrefix: 'm1314', colorOf: { 'wayfinder:task': '10b981' }, actionOf: function () { return 'execute' }, textOf: function (key) { return key } }
  const ROWS = [
    { key: 'i-1332', number: 1332, title: '挡路的那张', state: 'OPEN' },
    { key: 'i-1374', number: 1374, title: '被挡的那张', state: 'OPEN', blockedBy: [1332] },
    { key: 'i-1315', number: 1315, title: '结案的 bug 票', state: 'CLOSED', labels: ['bug'] },
  ]
  const CTX = facts.ticketFactsContextOf(ROWS, ENV)
  const FACT_LIST = ROWS.map(function (row) { return facts.ticketCardFactsOf(row, CTX) })
  const factOf = function (no) { return FACT_LIST.filter(function (one) { return one.number === no })[0] }

  const props = cardProps.cardPropsOf(factOf(1332), null, ENV.colorOf)
  check(props.action === 'execute' && props.closed === false && props.footActionText === 'card.pickReady',
    '动作、结案态与页脚词原样搬过去（实得 ' + show(props.action) + ' / ' + show(props.closed) + ' / ' + show(props.footActionText) + '）')
  check(show(props.blocksChip) === show({ no: '1374', title: '被挡的那张' }),
    'blocks 改名叫 blocksChip，挡路条画得出来（实得 ' + show(props.blocksChip) + '）')
  check(props.bugCorner === false, '没 bug 标签时不给 BUG 三角（实得 ' + show(props.bugCorner) + '）')
  check(show(props.tags) === show(factOf(1332).tags) && props.updatedText === factOf(1332).updatedText,
    '类型小签与更新日原样搬过去（实得 ' + show(props.tags) + ' / ' + show(props.updatedText) + '）')

  const blockedProps = cardProps.cardPropsOf(factOf(1374), null, null)
  check(show(blockedProps.blockedBy) === show({ no: '1332', title: '挡路的那张', cardId: 'm1314-1332-i-1332' }),
    'blockedBy 带上编号、标题与那张卡的 DOM id（实得 ' + show(blockedProps.blockedBy) + '）')
  check(blockedProps.blocksChip === null, '被挡卡没有挡路条（实得 ' + show(blockedProps.blocksChip) + '）')

  const closedProps = cardProps.cardPropsOf(factOf(1315), null, null)
  check(closedProps.closed === true && closedProps.bugCorner === true && closedProps.footActionText === 'card.closedState',
    '结案卡进结案态、保留 BUG 三角、页脚写已结案（实得 ' + show(closedProps.closed) + ' / ' + show(closedProps.bugCorner) + ' / ' + show(closedProps.footActionText) + '）')
  check(closedProps.blockedBy === null && closedProps.blocksChip === null,
    '结案卡不表现阻塞关系（实得 ' + show(closedProps.blockedBy) + ' / ' + show(closedProps.blocksChip) + '）')
  check(props.colorOf === ENV.colorOf, '页面给的标签色原样交给卡片（实得 ' + show(props.colorOf) + '）')
  check(props.note === undefined, '没有真实摘要时不画 note，不拿假话占位（实得 ' + show(props.note) + '）')

  const seen = []
  const withHandlers = cardProps.cardPropsOf(factOf(1332), {
    onMain: function (one) { seen.push(['main', one.number]) },
    onNew: function (one) { seen.push(['new', one.number]) },
    onCopy: function (one) { seen.push(['copy', one.number]) },
    onOpen: function (one) { seen.push(['open', one.number]) },
    onCard: function (one) { seen.push(['card', one.number]) },
  }, null)
  withHandlers.onMain()
  withHandlers.onNew()
  withHandlers.onCopy()
  withHandlers.onOpen()
  withHandlers.onCard()
  check(show(seen) === show([['main', 1332], ['new', 1332], ['copy', 1332], ['open', 1332], ['card', 1332]]),
    '四个按钮与整卡点按都只把「这张票」交回页面，页面不必自己记来源（实得 ' + show(seen) + '）')
  check(withHandlers.onLitChange === undefined && withHandlers.lit === undefined,
    '点亮状态交给卡片自己管，页面不硬塞（实得 ' + show(withHandlers.lit) + '）')

  const noHandlers = cardProps.cardPropsOf(factOf(1332), null, null)
  check(noHandlers.onMain === null && noHandlers.onNew === null && noHandlers.onCopy === null && noHandlers.onOpen === null && noHandlers.onCard === null,
    '没给回调时四个按钮与整卡点按都是 null（与卡片组件「可空回调」的约定一致）')

  const list = cardProps.cardPropsListOf(FACT_LIST, null, null)
  check(list.length === 3 && list[0].noText === '#1332' && list[2].noText === '#1315',
    '分段摊 props 保持传入顺序与张数（实得 ' + show(list.map(function (one) { return one.noText })) + '）')
}

// ===========================================================================
// 11. 一整页模型：档案、取数状态、看板、计数、两段卡片 props 一次算好
// ===========================================================================
section('11. 一整页模型：计数与卡片张数一致，取数五态都画得对')
{
  const ENV = { colorOf: { 'wayfinder:task': '10b981' }, actionOf: function () { return 'execute' }, textOf: function (key) { return key } }
  const MAP = { number: 1314, key: '1314', title: '插件日志持久化读回失败与宿主反复启动', destination: '让日志能如实落盘', tickets: [], stats: { total: 0 } }
  const ROWS = [
    { key: 'i-1332', number: 1332, title: '可接的那张', state: 'OPEN' },
    { key: 'i-1374', number: 1374, title: '被挡的那张', state: 'OPEN', blockedBy: [1332] },
    { key: 'i-1315', number: 1315, title: '结案的那张', state: 'CLOSED', closedAt: '2026-10-18T09:00:00Z' },
  ]
  const seen = []
  const model = pageModel.mapDetailPageModelOf({
    map: MAP,
    bucket: { mode: 'real', items: ROWS, stats: { total: 3, closed: 1 } },
    cardIdPrefix: 'm1314',
    colorOf: ENV.colorOf,
    actionOf: ENV.actionOf,
    textOf: ENV.textOf,
    handlers: { onMain: function (one) { seen.push(one.number) } },
  })
  check(model.profile.title === MAP.title,
    '档案的标题来自地图行（实得 ' + show(model.profile.title) + '）')
  check(show(model.counts) === show({ total: 3, closed: 1, ready: 1, doing: 0, blocked: 1 }),
    '计数与宿主 groupTickets 的五个桶同口径（实得 ' + show(model.counts) + '）')
  check(model.profile.progressPercent === 33, '完成度按已完成张数算（实得 ' + show(model.profile.progressPercent) + '%）')
  check(model.cards.open.length === 2 && model.cards.closed.length === 1,
    '两段卡片的张数与计数对得上：未完成 ' + model.cards.open.length + ' 张、已完成 ' + model.cards.closed.length + ' 张')
  check(model.cards.sequence.length === 3 && model.cards.sequence[0] === model.cards.open[0] && model.cards.sequence[1] === model.cards.open[1] && model.cards.sequence[2].closed === true,
    '页面照着画的一条序列接好：未完成在前（顺序与 open 段一致）、已完成接在最后（实得 ' + show(model.cards.sequence.map(function (one) { return one.noText })) + '）')
  check(model.feed.state === 'ready' && model.feed.source === 'requested',
    '取数成功时用取回那份（实得 ' + show(model.feed.state) + ' / ' + show(model.feed.source) + '）')
  check(model.profile.feedSegments[0] && model.profile.feedSegments[0].key === 'map.subCount',
    '子票那句按取回那份的 stats 说（实得 ' + show(model.profile.feedSegments) + '）')
  model.cards.open[0].onMain()
  check(show(seen) === show([1332]),
    '页面回调经整页模型仍然收到「这张票」，链路不断（实得 ' + show(seen) + '）')

  const loadingModel = pageModel.mapDetailPageModelOf({
    map: { number: 7, title: '快照里的地图', tickets: [{ number: 1, title: '快照票', state: 'OPEN' }], stats: { total: 1 } },
    bucket: { mode: 'loading' },
    cardIdPrefix: 'm7', actionOf: ENV.actionOf, textOf: ENV.textOf,
  })
  check(loadingModel.feed.state === 'loading' && loadingModel.cards.open.length === 1,
    '正在取时先按快照画，不把「还没拿到」画成「没有」（实得 ' + show(loadingModel.feed.state) + ' / ' + show(loadingModel.cards.open.length) + '）')

  const cappedModel = pageModel.mapDetailPageModelOf({
    map: MAP,
    bucket: { mode: 'real', items: ROWS, stats: { total: 1200, closed: 1 }, total: 1200, capped: true, missing: 3 },
    cardIdPrefix: 'm1314', actionOf: ENV.actionOf, textOf: ENV.textOf,
  })
  const cappedKeys = cappedModel.profile.feedSegments.map(function (seg) { return seg.key })
  check(show(cappedKeys) === show(['map.subCount', 'map.subCountCapped', 'map.subCountShort']),
    '被上限截断与差额都要明说（实得 ' + show(cappedKeys) + '）')
  check(cappedModel.cards.open.length + cappedModel.cards.closed.length === 3,
    '计数按画出来的行算，与卡片张数一致（实得 ' + (cappedModel.cards.open.length + cappedModel.cards.closed.length) + ' 张）')

  const emptyModel = pageModel.mapDetailPageModelOf({
    map: { number: 9, title: '空地图', tickets: [], stats: { total: 0 } },
    bucket: { mode: 'real', items: [], stats: { total: 0 } },
    cardIdPrefix: 'm9', actionOf: ENV.actionOf, textOf: ENV.textOf,
  })
  check(emptyModel.feed.empty === true && emptyModel.cards.open.length === 0 && emptyModel.cards.closed.length === 0,
    '真的一张都没有时空态成立、两段都为空（实得 ' + show(emptyModel.feed.empty) + ' / ' + show(emptyModel.cards.open.length) + ' / ' + show(emptyModel.cards.closed.length) + '）')
  check(emptyModel.profile.progressPercent === 0 && emptyModel.profile.hasDestination === false,
    '空地图的完成度是 0，目的地也不是一句空话（实得 ' + show(emptyModel.profile.progressPercent) + ' / ' + show(emptyModel.profile.hasDestination) + '）')

  const specModel = pageModel.mapDetailPageModelOf({
    map: { type: 'spec', number: 1380, title: '规格', tickets: [], stats: { total: 0 } },
    bucket: { mode: 'real', items: [], stats: { total: 0 } },
    cardIdPrefix: 'm1380', actionOf: ENV.actionOf, textOf: ENV.textOf,
  })
  check(specModel.profile.kind === 'spec' && specModel.profile.title === '规格',
    '规格行走完整页模型后仍然是规格容器、标题照旧（实得 ' + show(specModel.profile.kind) + ' / ' + show(specModel.profile.title) + '）')
  check(specModel.profile.feedSegments[0] && specModel.profile.feedSegments[0].key === 'map.specSubCount',
    '规格的整页模型里「子票那句」用规格自己的词条（实得 ' + show(specModel.profile.feedSegments) + '）')
}


// ---------------------------------------------------------------------------
// §12 入口接线（#1402）
// ---------------------------------------------------------------------------
// 为什么只读源码、不渲染：这一页要 React 与宿主的电话（st.g 那套分组对象、Dock 的页签状态），
// 在门禁里搭出整台宿主不值当；真正会坏的两处却一眼能看见——入口画的是哪一页、页面有没有调错名字。
// 所以这里断言三份文件的文本：Dock 的挂载点、V2 页面调到的四个名字、皮肤里让底色铺满 Dock 的那条规则。
section('§12 入口接线')
{
  const dockText = fs.readFileSync(path.join(ROOT, 'src/client/panel/Dock.ts'), 'utf8')
  check(dockText.indexOf('declare const MapDetailV2Page') >= 0,
    'Dock 声明了 V2 页面（不再是老页 MapDetail）')
  check(dockText.indexOf('h(MapDetailV2Page, { st: s, g: active })') >= 0,
    '列表页签选中一张图时，Dock 画的是 V2 页')
  check(dockText.indexOf('h(MapDetail, { st: s, g: active })') < 0,
    '老页 MapDetail 已经不在挂载点上（源码与门禁留着只为回滚）')

  const pageText = fs.readFileSync(path.join(ROOT, REL, 'view/MapDetailV2Page.ts'), 'utf8')
  const pageDeps = ['useMapTicketsFeed', 'mapDetailPageModelOf', 'pageActionHandlersOf', 'MapDetailTop']
  const pageMissing = pageDeps.filter(function (name) { return pageText.indexOf(name) < 0 })
  check(pageMissing.length === 0,
    'V2 页面调到了取数、整页模型、四个按钮的回调与老页顶栏（缺 ' + show(pageMissing) + '）')

  const stylesText = fs.readFileSync(path.join(ROOT, REL, 'view/skin/MapDetailV2Styles.ts'), 'utf8')
  check(stylesText.indexOf('.dsws-body>.m2v2-page') >= 0,
    '皮肤里保留了「铺满 Dock 内容区」的那条规则（否则底色会缩成面板中间一张色卡）')

  const cardsStyleText = fs.readFileSync(path.join(ROOT, 'src/client/views/cards/PixelCardsStyles.ts'), 'utf8')
  check(cardsStyleText.indexOf('.cd-lbl') >= 0 && cardsStyleText.indexOf('.cd-abtn.label{flex:1;min-width:0') >= 0,
    '卡片按钮里的文字包在 .cd-lbl 里、文字按钮可以被压低（否则窄卡里按钮会顶出去）')
  const titleRuleAt = cardsStyleText.indexOf('.cd-tt{')
  const titleInkAt = cardsStyleText.indexOf('color:var(--cd-ink)', titleRuleAt)
  check(titleRuleAt >= 0 && titleInkAt > titleRuleAt && titleInkAt - titleRuleAt < 160,
    '卡片标题用纸面墨色（深色主题下卡片仍是浅纸，继承浅色字只有 1.2:1）')

  check(stylesText.indexOf('.m2v2-flow .cd-card') >= 0 && stylesText.indexOf('--m2v2-card-min') >= 0,
    '卡片流按最小宽度排在页面皮肤里（208px 起排、最多 300px，一行尽量多放）')

  const flowText = fs.readFileSync(path.join(ROOT, REL, 'view/flow/TicketCardFlow.ts'), 'utf8')
  check(flowText.indexOf('fitFlowLabels') >= 0 && flowText.indexOf("querySelectorAll('.cd-abtn.label')") >= 0,
    '卡片流会按整字收窄按钮文字（fitFlowLabels 找 .cd-abtn.label 里的 .cd-lbl）')

  const headerText = fs.readFileSync(path.join(ROOT, REL, 'view/profile/MapProfileHeader.ts'), 'utf8')
  check(headerText.indexOf('m2v2-meta') >= 0 && headerText.indexOf("'data-empty'") >= 0,
    '档案区的计数 / 完成度固定成一块（取数中占位，没有子票时整块隐藏但留位置）')
  check(headerText.indexOf('PLACEHOLDER') >= 0 && headerText.indexOf('busy') >= 0,
    '档案区在取数中显示占位短横，不按状态增删行')
  check(headerText.indexOf('map.subCountLoading') < 0 && headerText.indexOf("'data-busy'") >= 0,
    '档案区不再写「正在取子票」那一行，取数中的样子交给进度条的 data-busy')
  check(stylesText.indexOf('.m2v2-prog[data-busy="1"] .m2v2-track') >= 0 &&
    stylesText.indexOf('@keyframes m2v2-stripes') >= 0 &&
    stylesText.indexOf('prefers-reduced-motion') >= 0,
    '取数中进度条轨道画流动斜纹，系统要求减少动效时停掉动画')
  check(headerText.indexOf('function feedLine') < 0 && headerText.indexOf('progressNode(h, profile, feed, busy)') >= 0,
    '子票那句画在进度条这一行里，不再有独立的 feed 行（维护者：不要这一行，直接接下面的内容）')
  check(stylesText.indexOf('.m2v2-meta[data-empty="1"]{visibility:hidden}') >= 0 &&
    stylesText.indexOf('.m2v2-prog{display:flex;flex-wrap:wrap') >= 0 &&
    stylesText.indexOf('.m2v2-feed{flex:0 1 auto') >= 0 &&
    stylesText.indexOf('min-height:17px') < 0,
    '没有子票时 meta 用 visibility 隐藏（位置保留）；子票那句挂在进度条同一行，不再单独占一行')
  const pageSourceText = fs.readFileSync(path.join(ROOT, REL, 'view/MapDetailV2Page.ts'), 'utf8')
  check(pageSourceText.indexOf("mode || '') === 'loading'") >= 0 && pageSourceText.indexOf('busy: busy') >= 0,
    '页面把「正在按需取子票」传给档案区（第一帧与取数中都是 busy）')

  // ---- 紧凑档案：整块档案是入口（m02892、m03176）----
  check(headerText.indexOf('onOpenArchive') >= 0 && headerText.indexOf('mapv2.archive.open') >= 0 &&
    headerText.indexOf('m2v2-id') < 0 && headerText.indexOf('MapProfileDrawers') < 0,
    '档案区不再有自己的身份行与抽屉；档案区带定位串、可键盘进入')
  check(pageSourceText.indexOf('pushNav') >= 0 && pageSourceText.indexOf("pushNav(st, 'issue', n, effortOf(m))") >= 0 &&
    pageSourceText.indexOf('onOpenArchive: openArchive') >= 0,
    '点档案区压入这张地图自己的 issue 详情页（地图就是一条 issue，正文与评论都在那里）')
  check(headerText.indexOf('m2v2-profile-link') >= 0 && headerText.indexOf('insideOwnControl') >= 0 &&
    headerText.indexOf('m2v2-title-link') < 0,
    '可点的是整块档案（不再只有标题一行）；档案区里的链接与图片仍然各管各的交互')
  check(stylesText.indexOf('.m2v2-profile-link:hover') >= 0 &&
    stylesText.indexOf('.m2v2-profile-link:focus-visible') >= 0 &&
    stylesText.indexOf('.m2v2-title-link') < 0 && stylesText.indexOf('.m2v2-drawer') < 0 &&
    stylesText.indexOf('.m2v2-id') < 0,
    '整块档案有自己的悬停 / 焦点样式；抽屉与身份行的样式已删干净')

  // ---- 整卡点按进详情（m02533）----
  const propsContractText = fs.readFileSync(path.join(ROOT, 'src/client/views/cards/cardProps.d.ts'), 'utf8')
  check(propsContractText.indexOf('onCard?:') >= 0,
    '卡片契约里有整卡点按回调 onCard（无此回调时卡片刻意不接整卡点击）')
  const cardText = fs.readFileSync(path.join(ROOT, 'src/client/views/cards/PixelIssueCard.ts'), 'utf8')
  check(cardText.indexOf('p.onCard') >= 0 && cardText.indexOf("'.card'") >= 0 && cardText.indexOf('onKeyDown') >= 0,
    '卡片只拿 onCard 把整张卡做成可点（带定位串，键盘回车 / 空格也能进）')
  const handlersText = fs.readFileSync(path.join(ROOT, REL, 'wiring/pageActionHandlers.ts'), 'utf8')
  check(handlersText.indexOf('enterSubDetail') >= 0 && handlersText.indexOf('onCard') >= 0,
    '整卡点按交给 enterSubDetail 分流（票详情或子地图详情，与 IssueDetail 的子票行同一入口）')
  const chromeText = fs.readFileSync(path.join(ROOT, 'src/client/views/cards/PixelBlockedChrome.ts'), 'utf8')
  check(chromeText.indexOf('onActivate') >= 0 && cardsStyleText.indexOf('.cd-bseal.act{pointer-events:auto') >= 0,
    '可跳转的被挡卡把「点亮挡路关系」挪到红封条上（封条自己接点按，不误开详情）')

  // ---- 卡片层四处缺口（#1401）----
  check(cardText.indexOf('p.blockedBy.title') >= 0 && chromeText.indexOf('cd-bseal-t') >= 0 &&
    cardsStyleText.indexOf('.cd-bseal-t{') >= 0,
    '被挡卡把挡路票标题交给封条，封条画成「编号一行 + 标题一行」（#1401）')
  check(cardText.indexOf('quiet: !!(p.blockedBy && p.blockedBy.title)') >= 0 &&
    chromeText.indexOf("'cd-dimveil' + (quiet ? ' quiet' : '')") >= 0 &&
    chromeText.indexOf('card.blockedDim') >= 0,
    '有挡路标题时暗层只压暗、不写居中提示字（两行封条会压住它）；只有编号的旧数据照旧给提示（#1401）')
  check(cardsStyleText.indexOf('body:not([data-ds-dark-theme]) .cd-card:focus-visible{outline:2px dashed var(--dsw-focus-ring-color') >= 0 &&
    cardsStyleText.indexOf('body:not([data-ds-dark-theme]) .cd-abtn:focus-visible{outline:2px dashed var(--dsw-focus-ring-color') >= 0 &&
    cardsStyleText.indexOf('body[data-ds-dark-theme] .cd-card:focus-visible') >= 0,
    '浅色主题下卡片与按钮都有键盘焦点环、颜色取宿主焦点令牌；深色那两条金虚线原值还在（#1401）')
  const themeText = fs.readFileSync(path.join(ROOT, 'src/client/views/cards/PixelCardTheme.ts'), 'utf8')
  check(themeText.indexOf("implement: { colorKey: 'implement'") >= 0 && themeText.indexOf('1d4ed8') < 0,
    '卡片主题表里有实施样张（锤子 + 实心），但不再写实施地图身份色的第二份字面量（#1401）')
  check(pageSourceText.indexOf('CONTAINER_ACCENT.spec') >= 0 && pageSourceText.indexOf('implement: CONTAINER_ACCENT.spec') >= 0,
    '实施动作的底色由页面从中央色表取一次（CONTAINER_ACCENT.spec），放进 colorOf 交给卡片（#1401）')
}


console.log('')
console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条')
process.exitCode = failed === 0 ? 0 : 1
if (failed > 0) console.log('判据没全过：先看上面每条 FAIL 的实得值，再改代码或改判据（改判据要说明理由）。')
