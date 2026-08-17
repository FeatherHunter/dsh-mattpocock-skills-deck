// verify-blocked-filter.js — v1.3.3 bug #6 阻塞筛选逻辑验证
// 复刻 client.js ListTab 的 blocked 过滤分支：
//   stateFilter==='blocked' → 仅保留 open 且 blockOf 命中的 issue
const assert = require('assert')

// ---- 复刻 blockOf 构建（与 client.js 同构）----
function buildBlockOf(snapshot) {
  const blockOf = {}
  ;(snapshot && snapshot.maps || []).forEach(function (m) {
    const byNum = {}
    m.tickets.forEach(function (t) { byNum[t.number] = t })
    m.tickets.forEach(function (t) {
      if (!t.blockedBy || !t.blockedBy.length) return
      const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
      if (openBlockers.length) blockOf[t.number] = { map: m.number, mapTitle: m.title, by: openBlockers }
    })
  })
  return blockOf
}

// ---- 复刻过滤逻辑 ----
function filterRows(snapshot, stateFilter) {
  const issues = (snapshot && Array.isArray(snapshot.issues)) ? snapshot.issues : []
  const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
  const blockOf = buildBlockOf(snapshot)
  const showOpen = stateFilter !== 'closed'
  const openRows = openIssues
  const filteredOpen = showOpen ? (stateFilter === 'blocked' ? openRows.filter(function (x) { return blockOf[x.number] }) : openRows) : []
  return filteredOpen.map(function (x) { return x.number })
}

// ---- 测试数据 ----
const snapshot = {
  issues: [
    { number: 1, state: 'OPEN' },    // 无阻塞
    { number: 2, state: 'OPEN' },    // 被 #3 阻塞（#3 open）
    { number: 3, state: 'OPEN' },    // 阻塞者本身
    { number: 4, state: 'OPEN' },    // 被 #5 阻塞（#5 已关 → 不算阻塞）
    { number: 5, state: 'CLOSED' },  // 已关闭
    { number: 6, state: 'CLOSED' },  // 已关闭
  ],
  maps: [{
    number: 100, title: '测试 map',
    tickets: [
      { number: 2, state: 'OPEN', blockedBy: [3] },
      { number: 4, state: 'OPEN', blockedBy: [5] },
      { number: 3, state: 'OPEN', blockedBy: [] },
      { number: 1, state: 'OPEN', blockedBy: [] },
    ],
  }],
}

let passed = 0
const ok = (name) => { passed++; console.log('  PASS', name) }

console.log('T1: blocked 过滤只保留 open 且被 open 阻塞的 issue')
{
  const got = filterRows(snapshot, 'blocked')
  assert.deepStrictEqual(got, [2], '仅 #2 被 open 阻塞者 #3 阻塞；#4 的阻塞者 #5 已关闭不算')
  ok('blocked 过滤命中 #{' + got.join(',') + '}')
}

console.log('T2: open 过滤不受影响')
{
  const got = filterRows(snapshot, 'open')
  assert.deepStrictEqual(got, [1, 2, 3, 4], 'open = 全部 open issue')
  ok('open 过滤正常')
}

console.log('T3: 空阻塞场景 → blocked 为空')
{
  const empty = { issues: [{ number: 9, state: 'OPEN' }], maps: [] }
  assert.deepStrictEqual(filterRows(empty, 'blocked'), [], '无 maps 数据时 blocked 为空')
  ok('无阻塞数据 blocked 空')
}

console.log(`\n全部通过：${passed}/3 组`)
