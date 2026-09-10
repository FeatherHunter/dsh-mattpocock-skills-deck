// verify-544-standalone-blocked.js — #544 独立票原生依赖阻塞边在列表与计数中展示
// 验收：541/542/543 出现阻塞徽章（与地图子票同样式）；顶部“阻塞”计数为 3、“可接”相应减少；
// “阻塞”筛选能筛出这三张；原有地图的分层与计数一字不差；异常输入不崩。
// 用法: node tests/verify-544-standalone-blocked.js
const assert = require('assert')
const fs = require('fs')
const path = require('path')

async function loadDerived() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'kernel', 'store-derived.js'), 'utf8')
  const tmp = path.join(__dirname, 'tmp-544-verify-derived.mjs')
  // effort 维度：store-derived 在面板闭包里用共享的身份函数（idOf / idOfParts / effortOf），
  // 单独取出求值时要把同一份原文显式导入，否则 ReferenceError（跑的是真函数，不改行为）。
  const constantsHref = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'shared', 'tracker', 'constants.js')).href
  const identityImport = "import { idOf, idOfParts, effortOf, refKeyOf } from " + JSON.stringify(constantsHref) + "\n"
  fs.writeFileSync(tmp, identityImport + src, 'utf8')
  try {
    return await import('file:///' + tmp.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

async function main() {
  const derived = await loadDerived()
  assert(typeof derived.isOccupied === 'function', 'store-derived 导出 isOccupied')
  assert(typeof derived.applyStandaloneBlocks === 'function', 'store-derived 导出 applyStandaloneBlocks')
  let passed = 0
  const ok = (name) => { passed++; console.log('  PASS', name) }

  // —— 场景 1：#544 现场（540→541→542→543 链，无地图） ——
  const st = {
    snapshot: {
      maps: [],
      issues: [
        { key: '540', number: 540, title: '只读核心', state: 'OPEN', assignees: [], labels: [], blockedBy: [] },
        { key: '541', number: 541, title: '标题行入口', state: 'OPEN', assignees: [], labels: [], blockedBy: [{ key: '540', title: '只读核心', state: 'open' }] },
        { key: '542', number: 542, title: '第三票', state: 'OPEN', assignees: [], labels: [], blockedBy: [{ key: '541', title: '标题行入口', state: 'open' }] },
        { key: '543', number: 543, title: '第四票', state: 'OPEN', assignees: [], labels: [], blockedBy: [{ key: '542', title: '第三票', state: 'open' }] },
      ],
    },
  }
  const blockOf = derived.applyStandaloneBlocks(st, derived.mapBlockOf(st.snapshot))
  assert.deepStrictEqual(Object.keys(blockOf).map(Number).sort((a, b) => a - b), [541, 542, 543], '541/542/543 进入 blockOf')
  ok('独立票阻塞徽章数据齐备（541/542/543）')
  assert.strictEqual(blockOf[541].map, null, '独立票徽章不挂地图（map 为空）')
  assert.deepStrictEqual(blockOf[541].by, ['540'], '541 的阻塞来源为 540')
  assert.deepStrictEqual(blockOf[542].by, ['541'], '542 的阻塞来源为 541')
  assert.deepStrictEqual(blockOf[543].by, ['542'], '543 的阻塞来源为 542')
  ok('独立票徽章只挂自己身上，阻塞来源正确')

  assert.strictEqual(derived.isOccupied(st, st.snapshot.issues[0]), false, '540 未被阻塞')
  assert.strictEqual(derived.isOccupied(st, st.snapshot.issues[1]), true, '541 被阻塞')
  assert.strictEqual(derived.isOccupied(st, st.snapshot.issues[2]), true, '542 被阻塞')
  assert.strictEqual(derived.isOccupied(st, st.snapshot.issues[3]), true, '543 被阻塞')
  ok('占用判定命中三张被阻塞独立票')
  assert.strictEqual(derived.occCount(st), 3, '顶部“阻塞”计数为 3')
  assert.strictEqual(derived.frontierCount(st), 1, '“可接”相应减少为 1（仅 540）')
  ok('顶部计数：阻塞 3、可接 1')
  const openIssues = st.snapshot.issues.filter((x) => x.state !== 'CLOSED')
  assert.deepStrictEqual(openIssues.filter((x) => derived.isOccupied(st, x)).map((x) => x.number), [541, 542, 543], '阻塞筛选筛出三张')
  assert.deepStrictEqual(openIssues.filter((x) => !derived.isOccupied(st, x)).map((x) => x.number), [540], '可接筛选仅剩 540')
  ok('阻塞/可接筛选正确')

  // —— 场景 2：地图回归（分层与计数一字不差） ——
  const mapSnap = {
    maps: [{
      number: 100, title: '测试地图',
      tickets: [
        { key: '1', number: 1, state: 'OPEN', claimedBy: '', blockedBy: [] },
        { key: '2', number: 2, state: 'OPEN', claimedBy: '', blockedBy: [3] },
        { key: '3', number: 3, state: 'OPEN', claimedBy: '', blockedBy: [] },
        { key: '4', number: 4, state: 'OPEN', claimedBy: '', blockedBy: [5] },
        { key: '5', number: 5, state: 'CLOSED', claimedBy: '', blockedBy: [] },
      ],
    }],
    issues: [],
  }
  const mst = { snapshot: mapSnap }
  const mBlockOf = derived.applyStandaloneBlocks(mst, derived.mapBlockOf(mapSnap))
  assert.deepStrictEqual(Object.keys(mBlockOf).map(Number), [2], '地图场景 blockOf 仍仅含 #2（#4 的阻塞者已关闭不算）')
  assert.strictEqual(derived.isOccupied(mst, { key: '2', number: 2, assignees: [] }), true, '地图内被阻塞票仍被占用')
  assert.strictEqual(derived.isOccupied(mst, { key: '1', number: 1, assignees: [] }), false, '地图内可接票仍可接')
  ok('地图分层与计数一字不差')

  // —— 场景 3：地图票跨地图阻塞者不计入（独立票边不流进地图层级） ——
  const crossSnap = {
    maps: [{
      number: 100, title: '测试地图',
      tickets: [{ key: '11', number: 11, state: 'OPEN', claimedBy: '', blockedBy: [99] }],
    }],
    issues: [
      { key: '11', number: 11, title: '地图票', state: 'OPEN', assignees: [], labels: [], blockedBy: [99] },
      { key: '99', number: 99, title: '图外阻塞者', state: 'OPEN', assignees: [], labels: [], blockedBy: [] },
    ],
  }
  const cst = { snapshot: crossSnap }
  const cBlockOf = derived.applyStandaloneBlocks(cst, derived.mapBlockOf(crossSnap))
  assert.strictEqual(cBlockOf[11], undefined, '地图票的图外阻塞者不挂徽章（地图口径不变）')
  assert.strictEqual(derived.isOccupied(cst, crossSnap.issues[0]), false, '地图票的图外阻塞者不计占用（地图口径不变）')
  assert.strictEqual(derived.isOccupied(cst, crossSnap.issues[1]), false, '无阻塞独立票仍可接')
  ok('独立票边不流进地图票层级计算')

  // —— 场景 4：边界与异常（已关闭/认领/坏形状不崩） ——
  const edgeSt = {
    snapshot: {
      maps: [],
      issues: [
        { key: '60', number: 60, title: '已关闭', state: 'CLOSED', assignees: [], labels: [], blockedBy: [{ key: '61', title: '', state: 'open' }] },
        { key: '61', number: 61, title: '阻塞者', state: 'OPEN', assignees: [], labels: [], blockedBy: [] },
        { key: '62', number: 62, title: '无边字段', state: 'OPEN', assignees: [], labels: [] },
        { key: '63', number: 63, title: '坏边', state: 'OPEN', assignees: [], labels: [], blockedBy: [null, {}, ''] },
        { key: '67', number: 67, title: '已关闭的阻塞者', state: 'CLOSED', assignees: [], labels: [], blockedBy: [] },
        { key: '68', number: 68, title: '被已关闭者阻塞', state: 'OPEN', assignees: [], labels: [], blockedBy: [{ key: '67', title: '', state: 'closed' }] },
        { key: '64', number: 64, title: '数字边', state: 'OPEN', assignees: [], labels: [], blockedBy: [61] },
        { key: '65', number: 65, title: '地图节点', type: 'map', state: 'OPEN', assignees: [], labels: [{ name: 'wayfinder:map', color: '' }], blockedBy: [{ key: '61', title: '', state: 'open' }] },
        { key: '66', number: 66, title: '已认领', state: 'OPEN', assignees: [{ login: 'someone' }], labels: [], blockedBy: [] },
      ],
    },
  }
  const eBlockOf = derived.applyStandaloneBlocks(edgeSt, derived.mapBlockOf(edgeSt.snapshot))
  assert.strictEqual(eBlockOf[60], undefined, '已关闭票不挂徽章')
  assert.strictEqual(eBlockOf[65], undefined, '地图节点本身不挂徽章')
  assert.strictEqual(eBlockOf[62], undefined, '无边字段不挂徽章')
  assert.strictEqual(eBlockOf[63], undefined, '坏边不挂徽章')
  assert.strictEqual(eBlockOf[68], undefined, '阻塞者已关闭不挂徽章')
  assert.deepStrictEqual(eBlockOf[64].by, ['61'], '数字形阻塞边同样识别')
  assert.strictEqual(derived.isOccupied(edgeSt, edgeSt.snapshot.issues[3]), false, '坏边不崩且不算占用')
  assert.strictEqual(derived.isOccupied(edgeSt, edgeSt.snapshot.issues[0]), false, '已关闭票不算占用（与徽章口径一致）')
  assert.strictEqual(derived.isOccupied(edgeSt, edgeSt.snapshot.issues[6]), true, '数字形阻塞边计占用')
  assert.strictEqual(derived.isOccupied(edgeSt, edgeSt.snapshot.issues[8]), true, '已认领仍算占用（原口径）')
  ok('边界与异常分支全部通过')

  // —— 场景 5：源码接线（列表与行渲染已接入） ——
  const listTab = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'views', 'ListTab.js'), 'utf8')
  assert(listTab.includes('applyStandaloneBlocks(st, blockOf)'), 'ListTab 合并独立票阻塞标记')
  const row = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'views', 'ListTabRow.js'), 'utf8')
  assert(row.includes('blk.map === null'), '行渲染区分独立票徽章（无所属地图不跳转）')
  assert(row.includes("tr('map.subBlocked'"), '独立票徽章提示文案不承诺跳转地图')
  ok('源码接线正确')

  // —— 场景 6：门禁已接入 npm run verify 链（仓库惯例） ——
  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert((pkgJson.scripts.verify || '').includes('verify-544-standalone-blocked.js'), 'npm run verify 链已纳入本门禁')
  ok('门禁已接入 verify 链')

  console.log(`\n全部通过：${passed} 组检查，6 组场景`)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
