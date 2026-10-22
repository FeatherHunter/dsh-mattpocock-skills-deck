// 门禁归属: src/client/mapDetailV2
/**
 * tests/verify-map-detail-v2.ts —— V2 地图详情页「纯逻辑层」的专属门禁。
 *
 * 为什么要有这一条：V2 页面还在长，第一批落地的是四个不依赖界面的判断模块
 *   （行 → 卡片的刻画、未完成/已完成的排法、三条取数来路的合成、数据契约）。它们
 *   决定了页面上一张卡片画成什么样、摆在哪里、数据不全时怎么说——这些判断一旦错了，
 *   页面写得多好看都是错的。这一层今天没有任何门禁碰过，改坏了不会有第二处拦住。
 *
 * 被测对象是谁：src/client/mapDetailV2/ 下的 .ts 真源（不是产物）。这一批代码按
 *   「先不接入」的约定没有登记进客户端闭包、不进构建产物，所以门禁直接 require 真源
 *   （经 scripts/ts-hook.mts 做类型剥离）。等接入时它们会搬进 views/ 并登记为叶子，
 *   那时这套判据仍然成立：断言的是行为，不是文件位置。
 *
 * 断的七件事：
 *   1. 动作与状态词表：生产侧九种动作全有映射（implement 明确按执行画），四种状态各用哪个词条键。
 *   2. 状态判定与宿主 groupTickets 同口径：已关闭 > 在办 > 被挡 > 可接；阻塞者不在本图就不算被挡。
 *   3. 一张卡的刻画：编号文本、标题、类型小签（文字与真实标签色）、BUG 三角、认领人、更新日、
 *      页脚词条键、角标，以及三条不变量（结案卡不表现阻塞关系、只有被挡卡才有 blockedBy、
 *      卡片 id 一定带调用方给的前缀）。
 *   4. 阻塞关系双向：被挡卡指向编号最小的开着阻塞者；挡路卡指向「确实被挡、编号最小」的那张。
 *   5. 看板排序三条性质：每张票恰好出现一次（含成环、自阻塞的脏数据）、输入顺序不影响结果、
 *      被挡卡紧挨挡它的那张且排在其后；已完成段按结案时间倒序。
 *   6. 取数五态：取回那份 / 正在取 / 不支持 / 取失败 / 还没有桶，各自画哪份数据、怎么说原因，
 *      以及 capped / missing 只属于「取回那份」。
 *   7. 纯函数：三份逻辑模块没有任何运行时 import（动作与词条都从参数进），同目录没有落回来的 .js 产物。
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
const REL = 'src/client/mapDetailV2'
const DIR = path.join(ROOT, REL)

const facts = require('../src/client/mapDetailV2/ticketCardFacts.ts')
const board = require('../src/client/mapDetailV2/ticketBoard.ts')
const feed = require('../src/client/mapDetailV2/ticketFeed.ts')

// ===========================================================================
// 0. 前置：真源都在，旁边没有同名 .js 产物，三个模块都没有运行时 import
// ===========================================================================
section('0. 前置：四份真源都在、没有同名 .js、三份逻辑模块没有运行时 import')
{
  const wanted = ['mapDetailTypes.d.ts', 'ticketCardFacts.ts', 'ticketBoard.ts', 'ticketFeed.ts']
  const missing = wanted.filter((name) => !fs.existsSync(path.join(DIR, name)))
  check(missing.length === 0, '四份真源都在（缺的：' + (missing.length ? missing.join('、') : '无') + '）')

  const strayJs = wanted.filter((name) => name.endsWith('.ts') && fs.existsSync(path.join(DIR, name.slice(0, -3) + '.js')))
  check(strayJs.length === 0, '真源旁边没有同名 .js 产物（多出来的：' + (strayJs.length ? strayJs.join('、') : '无') + '）')

  const runtimeImporters = ['ticketCardFacts.ts', 'ticketBoard.ts', 'ticketFeed.ts'].filter((name) => {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    return /^import\s+(?!type\b)/m.test(src)
  })
  check(runtimeImporters.length === 0,
    '三份逻辑模块没有运行时 import（只允许 import type；违反的：' + (runtimeImporters.length ? runtimeImporters.join('、') : '无') + '）')

  const typeExports = ['MapTicketRow', 'MapTicketsBucket', 'TicketCardFacts', 'TicketFactsEnv', 'TicketFeed', 'TicketBoard', 'TicketBoardCounts']
  const typesSrc = fs.readFileSync(path.join(DIR, 'mapDetailTypes.d.ts'), 'utf8')
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
    discuss: 'grill', research: 'research', prototype: 'proto', execute: 'execute', implement: 'execute',
  }
  const gotKeys = Object.keys(facts.CARD_ACTION_BY_SOURCE).sort().join(',')
  const wantKeys = Object.keys(expectActions).sort().join(',')
  check(gotKeys === wantKeys, '动作表九个键齐（期望 ' + show(wantKeys) + '，实得 ' + show(gotKeys) + '）')

  const wrong = Object.keys(expectActions).filter((k) => facts.CARD_ACTION_BY_SOURCE[k] !== expectActions[k])
  check(wrong.length === 0, '九个动作各自映到确定的样张键（错的：' + (wrong.length ? wrong.map((k) => k + '→' + facts.CARD_ACTION_BY_SOURCE[k]).join('、') : '无') + '）')
  check(facts.CARD_ACTION_BY_SOURCE.implement === 'execute',
    'implement（实施，只属于规格地图）今天明确按「执行」画，而不是悄悄掉进兜底（实得 ' + show(facts.CARD_ACTION_BY_SOURCE.implement) + '）')
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
}

// ===========================================================================
// 3. 一张卡的刻画：夹具是十张票，覆盖四种状态与全部附加形态
// ===========================================================================
// 夹具：票号、状态、阻塞关系、标签形状都按真后端的几种写法来。
const ROWS = [
  { number: 1332, rowKey: 'i-1332', title: '订阅源切成八段', state: 'OPEN', labels: ['wayfinder:task', 'bug'], updatedAt: '2026-10-20T10:00:00Z' },
  { number: 1374, rowKey: 'i-1374', title: '一个进程只建一个日志实例', state: 'OPEN', labels: ['wayfinder:task'], blockedBy: [1332], updatedAt: '2026-10-21T08:00:00Z' },
  { number: 1316, rowKey: 'i-1316', title: '决定读回失败的处置策略', state: 'OPEN', labels: ['wayfinder:grilling'], updatedAt: '2026-10-19' },
  { number: 1348, rowKey: 'i-1348', title: '宿主启动次数在一千到四千之间', state: 'OPEN', labels: ['wayfinder:research'], claimedBy: 'FeatherHunter', updatedAt: '2026-10-21' },
  { number: 1350, rowKey: 'i-1350', title: '被挡但有人在办的票', state: 'OPEN', labels: ['wayfinder:research'], claimedBy: 'someone', blockedBy: [1332] },
  { number: 1315, rowKey: 'i-1315', title: '定位读回失败在哪一层', state: 'CLOSED', labels: [{ name: 'wayfinder:research', color: '#0ea5e9' }], closedAt: '2026-10-18T09:00:00Z', updatedAt: '2026-10-18' },
  { number: 1317, rowKey: 'i-1317', title: '把真重启与重复写分开', state: 'CLOSED', labels: ['wayfinder:research'], closedAt: '2026-10-18T11:00:00Z' },
  { number: 1331, rowKey: 'i-1331', title: '一个进程只建一个日志实例（方案）', state: 'CLOSED', labels: ['wayfinder:task'], closedAt: '2026-10-17' },
  { number: 1400, rowKey: 'i-1400', title: '行自带类型兜底的原型票', state: 'OPEN', labels: ['needs-triage'], type: 'prototype' },
  { number: 1401, rowKey: 'i-1401', title: '普通票没有类型小签', state: 'OPEN', labels: ['needs-triage'] },
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
  check(ready.cardId === 'm1314-1332', '卡片 id 带调用方给的前缀（实得 ' + show(ready.cardId) + '）')

  const doing = factOf(1348)
  check(doing.status === 'doing' && doing.action === 'research' && doing.claimedBy === 'FeatherHunter',
    '#1348：在办、研究样张、认领人取到（实得 ' + show(doing.status) + ' / ' + show(doing.action) + ' / ' + show(doing.claimedBy) + '）')
  check(doing.footText === 'card.doing' && doing.pickCorner === 'doing' &&
    show(doing.tags) === show([{ text: 'type.research', color: '0ea5e9' }]),
    '在办卡的页脚键、角标、小签（实得 ' + show(doing.footText) + ' / ' + show(doing.pickCorner) + ' / ' + show(doing.tags) + '）')

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
  check(plain.action === 'execute', 'implement 动作按执行样张画（实得 ' + show(plain.action) + '）')

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
  check(blocked.status === 'blocked' && show(blocked.blockedBy) === show({ no: '1332', title: '订阅源切成八段', cardId: 'm1314-1332' }),
    '#1374 被 #1332 挡住：编号、标题、对方卡片 id 三样都指向它（实得 ' + show(blocked.blockedBy) + '）')
  check(blocked.footText === 'card.blockedCount' && blocked.pickCorner === null,
    '被挡卡的页脚键与「没有角标」（实得 ' + show(blocked.footText) + ' / ' + show(blocked.pickCorner) + '）')

  const blocker = factOf(1332)
  check(show(blocker.blocks) === show({ no: '1374', title: '一个进程只建一个日志实例', cardId: 'm1314-1374' }),
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
}

// ===========================================================================
// 5. 卡片 id 的作用域
// ===========================================================================
section('5. 卡片 id：前缀由调用方给，同屏两张地图不会撞同一个 DOM id')
{
  const ctxB = facts.ticketFactsContextOf(ROWS, Object.assign({}, ENV, { cardIdPrefix: 'other' }))
  const a = FACTS[0]
  const b = facts.ticketCardFactsOf(ROWS[0], ctxB)
  check(a.cardId === 'm1314-1332' && b.cardId === 'other-1332',
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
  check(numbers(open) === '1316,1332,1374,1400,1401,1348,1350',
    '未完成段顺序：可接按编号在前，被挡的 #1374 紧挨 #1332，在办最后（实得 ' + show(numbers(open)) + '）')
  check(open.indexOf(factOf(1374)) === open.indexOf(factOf(1332)) + 1,
    '#1374 紧挨在挡它的 #1332 之后（实得 #1332 在第 ' + open.indexOf(factOf(1332)) + ' 位、#1374 在第 ' + open.indexOf(factOf(1374)) + ' 位）')
  check(numbers(closed) === '1317,1315,1331',
    '已完成段按结案时间倒序、同刻按编号（实得 ' + show(numbers(closed)) + '）')
  check(closed.every((one) => one.status === 'closed') && open.every((one) => one.status !== 'closed'),
    '两段按状态分开，没有一张混进去')

  const emitted = open.concat(closed).map((one) => one.number)
  check(emitted.length === ROWS.length && new Set(emitted).size === ROWS.length,
    '十张票每张恰好出现一次（出现 ' + emitted.length + ' 次，去重后 ' + new Set(emitted).size + ' 张）')

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
  check(keys.join(',') === 'k:,2003,2001,2002',
    '脏数据排序确定：可接的无编号票按状态排最前，自阻塞的票当根、排在成环的两张之前（实得 ' + show(keys.join(',')) + '）')
  check(keys.indexOf('2001') >= 0 && keys.indexOf('2002') >= 0,
    '互相挡住的两张也画出来了（实得 ' + show(keys.join(',')) + '）')
  const noNumber = order.filter((one) => one.number === null)
  check(noNumber.length === 1 && noNumber[0].rowKey === '', '缺编号的票按行 key 兜底（number=null、rowKey=' + show(noNumber.length ? noNumber[0].rowKey : null) + '）')
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
  check(realFallback.empty === true && realFallback.total === null,
    '取回 0 张：empty=true、total=null（没给总数时不许拿行数冒充，实得 ' + show(realFallback.total) + '）')

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
  check(emptyFailed.state === 'failed' && emptyFailed.failedMessage === 'parse' && emptyFailed.empty === true,
    '没有 message 时退回 kind 当原因；一行都没有时 empty=true（实得 ' + show(emptyFailed.failedMessage) + ' / ' + show(emptyFailed.empty) + '）')

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

console.log('')
console.log('通过 ' + passed + ' 条，失败 ' + failed + ' 条')
process.exitCode = failed === 0 ? 0 : 1
if (failed > 0) console.log('判据没全过：先看上面每条 FAIL 的实得值，再改代码或改判据（改判据要说明理由）。')
