#!/usr/bin/env node
// verify-589-list-dedupe.js —— #589 面板列表数组按身份去重
// 验收：身兼两职的票（既是地图容器、又是别张地图的子票）在列表数组只留一行，
// 地图容器优先；子票归属不动；同号异类不互吞；指认不出的条目不吞；异常输入不崩。
// 用法: node tests/verify-589-list-dedupe.js
const assert = require('assert')
const fs = require('fs')
const path = require('path')

async function loadDedupe() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'tracker', 'list-dedupe.js'), 'utf8')
  const tmp = path.join(__dirname, 'tmp-589-verify-dedupe.mjs')
  fs.writeFileSync(tmp, src, 'utf8')
  try {
    return await import('file:///' + tmp.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

async function main() {
  const mod = await loadDedupe()
  assert(typeof mod.dedupeListByPool === 'function', 'list-dedupe 导出 dedupeListByPool')
  assert(typeof mod.poolIdOf === 'function', 'list-dedupe 导出 poolIdOf')
  let passed = 0
  const ok = (name) => { passed++; console.log('  PASS', name) }

  // —— 场景 1：#589 现场（地图容器 + 同身份子票 + 孤儿票） ——
  const container = { key: '131', number: 131, type: 'map', title: '地图', state: 'OPEN', labels: [{ name: 'wayfinder:map' }] }
  const asTicket = { key: '131', number: 131, type: 'map', title: '地图', state: 'OPEN', labels: [{ name: 'wayfinder:map' }] }
  const orphan = { key: '60', number: 60, type: 'issue', title: '孤儿', state: 'OPEN', labels: [] }
  const input = [container, asTicket, orphan]
  const out = mod.dedupeListByPool(input)
  assert.strictEqual(out.length, 2, '三段拼出的三行收成两行')
  assert.strictEqual(out.filter(function (x) { return String(x.key) === '131' }).length, 1, '#131 只留一行')
  assert.strictEqual(out[0], container, '留下的是地图容器那一份')
  assert.strictEqual(out[1], orphan, '孤儿票原样保留')
  assert.strictEqual(input.length, 3, '不改输入数组')
  ok('#589 现场：身兼两职的票只留一行，容器优先')

  // —— 场景 2：先到先留（调用方保持地图容器在前，即容器优先） ——
  const out2 = mod.dedupeListByPool([container, orphan, asTicket])
  assert.strictEqual(out2.filter(function (x) { return String(x.key) === '131' }).length, 1, '换位也只留一行')
  assert.strictEqual(out2[0], container, '容器在前时留下容器那一份')
  assert.deepStrictEqual(out2.map(function (x) { return String(x.key) }), ['131', '60'], '其余顺序不变')
  ok('先到先留：调用方保持容器在前即容器优先')

  // —— 场景 3：同号异类不互吞 ——
  const pr = { key: '131', number: 131, type: 'issue', isPullRequest: true }
  const issue = { key: '131', number: 131, type: 'issue', isPullRequest: false }
  assert.strictEqual(mod.dedupeListByPool([pr, issue]).length, 2, '同 key 的拉取请求与普通票各算各的')
  ok('同号异类不互吞')

  // —— 场景 4：无身份条目不吞 ——
  const naked = { title: '无 key 无 number' }
  const out4 = mod.dedupeListByPool([naked, { title: '另一条无身份' }])
  assert.strictEqual(out4.length, 2, '指认不出的条目原样保留')
  ok('无身份条目不吞')

  // —— 场景 5：异常输入不崩 ——
  assert.strictEqual(mod.dedupeListByPool([]).length, 0, '空数组返回空数组')
  assert.strictEqual(mod.dedupeListByPool(null), null, '非数组原样返回')
  assert.strictEqual(mod.dedupeListByPool(undefined), undefined, '非数组原样返回')
  assert.strictEqual(mod.poolIdOf(null), null, '空条目身份为空')
  ok('异常输入不崩')

  // —— 场景 6：多 effort 同号不互吞（#575 合入后补记） ——
  const mA = { key: '00', number: 0, type: 'map', title: 'MAP1', effortId: 'alpha' }
  const mB = { key: '00', number: 0, type: 'map', title: 'MAP2', effortId: 'beta' }
  const tA = { key: '01', number: 1, type: 'issue', title: 'T1', effortId: 'alpha' }
  const tB = { key: '01', number: 1, type: 'issue', title: 'T2', effortId: 'beta' }
  const out6 = mod.dedupeListByPool([mA, mB, tA, tB])
  assert.strictEqual(out6.length, 4, '两张同号地图与两张同号票各留各的')
  assert.deepStrictEqual(out6.map(function (x) { return x.title }), ['MAP1', 'MAP2', 'T1', 'T2'], '顺序不变')
  // 无 effortId 的老条目退化成老口径（与原来行为一字不差）
  assert.strictEqual(mod.poolIdOf({ key: '131' }), '131', '无 effortId 退化成裸 key')
  ok('多 effort 同号不互吞，老条目退化不变')

  console.log('\n全部通过（' + passed + ' 项）')
}

main().catch(function (e) { console.error('FAIL', e && e.message); process.exit(1) })
