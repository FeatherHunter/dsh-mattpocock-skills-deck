// verify-1431-snapshot-refresh-parity.ts — #1431 建完规格与其子票后列表三次看到的不一样
// 现场：本地 Markdown 房，规格 #01 下挂 02/03/04/05（键补零 '02'），03 被 02 阻塞、04 被 02 阻塞、05 被 03/04 阻塞。
// 断言（与 tests/verify-544-standalone-blocked.ts 同一装载方式，跑的是真函数）：
//  1. 宿主归一成数字的阻塞边（blockedBy [2]）在列表派生里仍能命中补零键的票（mapBlockOf 3 项、compute blocked 3 张）。
//  2. 首屏快照那条路（src/refresh/rooms/host/session-snapshot-cache.ts 的 composer 分支）给每张地图算分组计数（m.stats），与刷新那条路同口径。
//  3. 两条路的阻塞边归一同形（都压成数字），首屏与刷新不再各说各话。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1431-snapshot-refresh-parity.ts
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { transpiledSourceText } = require('./lib/source-text.ts')

async function loadDerived(): Promise<any> {
  const src: string = transpiledSourceText('src/client/kernel/store-derived.js')
  const tmp = path.join(__dirname, 'tmp-1431-verify-derived.mjs')
  const constantsHref = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'tracker', 'kernel', 'identity-keys.ts')).href
  const identityImport = 'import { idOf, idOfParts, effortOf, refKeyOf } from ' + JSON.stringify(constantsHref) + '\n'
  fs.writeFileSync(tmp, identityImport + src, 'utf8')
  try {
    return await import('file:///' + tmp.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

async function main(): Promise<void> {
  const derived: any = await loadDerived()
  let passed = 0
  const ok = (name: string) => { passed++; console.log('  PASS', name) }

  // —— 场景：#1431 现场（宿主已把阻塞边压成数字，票键保持补零字符串） ——
  const snap = {
    maps: [{
      key: '01', number: 1, title: '三群联系区块统一', state: 'OPEN', type: 'spec',
      tickets: [
        { key: '02', number: 2, title: '源头定稿', state: 'OPEN', claimedBy: '', blockedBy: [] },
        { key: '03', number: 3, title: '中文5处', state: 'OPEN', claimedBy: '', blockedBy: [2] },
        { key: '04', number: 4, title: '英文4处', state: 'OPEN', claimedBy: '', blockedBy: [2] },
        { key: '05', number: 5, title: '对账加微信', state: 'OPEN', claimedBy: '', blockedBy: [3, 4] },
      ],
    }],
    issues: [],
  }
  const st = { snapshot: snap }
  const blockOf = derived.mapBlockOf(snap)
  assert.strictEqual(Object.keys(blockOf).length, 3, '被阻塞三张（03/04/05）都进 blockOf，数字边也要命中补零键')
  ok('mapBlockOf：数字阻塞边命中补零键的票（3 项）')
  const groups = derived.compute(st)
  assert.strictEqual(groups.length, 1, '一张地图一组')
  assert.strictEqual(groups[0].blocked.length, 3, 'compute blocked 为 3（03/04/05）')
  assert.strictEqual(groups[0].frontier.length, 1, 'frontier 仅剩 02')
  ok('compute：blocked 3 张、frontier 1 张')

  // —— 静态：首屏快照的 composer 分支也要算分组计数（与刷新同口径），两条路阻塞边同形 ——
  const snapSrc: string = fs.readFileSync(path.join(__dirname, '..', 'src', 'refresh', 'rooms', 'host', 'session-snapshot-cache.ts'), 'utf8')
  const refSrc: string = fs.readFileSync(path.join(__dirname, '..', 'src', 'refresh', 'rooms', 'host', 'session-refresh-schedule.ts'), 'utf8')
  const snapComposer: string = snapSrc.slice(snapSrc.indexOf('if (useComposer)'), snapSrc.indexOf('// 统一契约'))
  assert.ok(/m\.stats\s*=/.test(snapComposer), '首屏 composer 分支给地图算 m.stats（首屏即有 0/4，不必等刷新）')
  ok('sessionSnapshot composer 分支算 m.stats')
  assert.ok(/parseInt/.test(snapComposer), '首屏 composer 分支阻塞边压成数字（与刷新同形）')
  assert.ok(/parseInt/.test(refSrc), '刷新 composer 分支阻塞边压成数字')
  ok('两条路阻塞边归一同形（数字）')

  console.log(`verify-1431-snapshot-refresh-parity: ${passed} passed`)
}

main().catch((e) => { console.error('FAIL verify-1431-snapshot-refresh-parity:', e && e.message); process.exit(1) })
