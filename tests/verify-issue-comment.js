// verify-issue-comment.js — #255 四缝验证：契约缝 + 集成差异冒烟（宿主透传冒烟见 smoke-comment-passthrough）
// - 契约缝：canComment 显隐谓词对三形状（MISSING / EMPTY 数组 / EMPTY nodes）的行为断言（从构建产物提取真源表达式求值）
// - 集成差异冒烟：diffSnapshots 对「纯评论变化（updatedAt bump）」产出行闪烁——根票（孤儿票）补口 + 子票元组扩展
// 用法: node tests/verify-issue-comment.js
const fs = require('fs')
// 本文件按文本求值统一走共用入口 compileFn：从构建产物里切出谓词与函数体再造成真函数（理由与用法见 tests/lib/eval-probe.js 文件头）。
const { compileFn } = require('./lib/eval-probe.js')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const pcli = fs.readFileSync('package/lib/client.js', 'utf8')

// —— 契约缝 A：显隐谓词行为（从构建产物提取真源比较式直接求值，杜绝测试私有副本漂移）
const predM = pcli.match(/canComment = !!rawComments && \((.+?)\)\s*\r?\n/)
let predOk = false
if (predM) {
  try {
    // 内部表达式原样求值（含 typeof / Array.isArray），不做任何改写
    // 产物里那截比较式原样求值（含 typeof / Array.isArray），改走共用入口 compileFn，不做任何改写。
    const evaluator = compileFn(['rawComments'], '"use strict"; return !!rawComments && (' + predM[1] + ')')
    const hidden = evaluator(undefined) === false                       // MISSING：字段省略 → 不渲染
    const emptyArr = evaluator([]) === true                             // EMPTY：契约 Comment[] 空 → 渲染
    const emptyNodes = evaluator({ nodes: [], pageInfo: {} }) === true  // EMPTY：GraphQL 形状空 → 渲染
    const notArrNodes = evaluator({ nodes: null }) === false            // 异形（nodes 非数组）→ 不渲染
    predOk = hidden && emptyArr && emptyNodes && notArrNodes
  } catch (e) { predOk = false }
}
check(predOk, '谓词行为：MISSING 隐 / EMPTY([]) 显 / EMPTY(nodes) 显 / 异形隐')

// ============ 集成差异冒烟：从产物提取 diffSnapshots 真源求值 ============
const dStart = pcli.indexOf('const diffSnapshots = function')
const dEnd = pcli.indexOf('// R5', dStart)
let diffBehavior = false, orphans = false, ticketUpd = false, shortCircuit = false
if (dStart > 0 && dEnd > dStart) {
  try {
    const fnText = pcli.slice(dStart, dEnd).replace('export ', '').replace('const diffSnapshots', 'diffSnapshots')
    // 从产物里切出的整段 diffSnapshots 求值：改走共用入口 compileFn，这段源码不需要外部变量，参数表传空数组。
    const sandboxFn = compileFn([], fnText + '\nreturn diffSnapshots;')
    const diffSnapshots = sandboxFn()
    const base = { ok: true, version: 'v1', generatedMs: 1,
      maps: [{ number: 248, title: 'Map', state: 'OPEN', labels: ['wayfinder:map'], tickets: [{ number: 253, state: 'CLOSED', progress: '100%', claimedBy: 'me', labels: [], updatedAt: 't1' }] }],
      issues: [{ number: 255, title: 'Spec', state: 'OPEN', labels: ['ready-for-agent'], updatedAt: 'u1' }] }
    // 真实快照的 version 为内容哈希：任何字段变化 ⇒ 版本必变，否则短路合法吞掉差异。
    // ① 子票纯评论变化（updatedAt bump + 版本推进）→ issueFlash.changed
    const tick = JSON.parse(JSON.stringify(base))
    tick.generatedMs = 2
    tick.version = 'v2'
    tick.maps[0].tickets[0].updatedAt = 't2'
    const r1 = diffSnapshots(base, tick)
    ticketUpd = !!(r1.issueFlash && r1.issueFlash[253] === 'changed')
    // ② 根票（孤儿票）updatedAt bump → changed 含 255（右侧主列表行闪烁的数据源）
    const r2base = JSON.parse(JSON.stringify(base)); const r2new = JSON.parse(JSON.stringify(base))
    r2new.generatedMs = 3; r2new.version = 'v3'; r2new.issues[0].updatedAt = 'u9'
    const r2 = diffSnapshots(r2base, r2new)
    orphans = Array.isArray(r2.changed) && r2.changed.indexOf(255) >= 0
    // ③ 内容全同但版本推进 → 空差异（不误闪）
    const r3base = JSON.parse(JSON.stringify(base)); const r3new = JSON.parse(JSON.stringify(base))
    r3new.generatedMs = 4; r3new.version = 'v4'
    const r3 = diffSnapshots(r3base, r3new)
    diffBehavior = r3.added.length === 0 && r3.changed.length === 0 && r3.removed.length === 0
    // ④ 同版本短路
    const r4 = diffSnapshots(base, JSON.parse(JSON.stringify(base)))
    shortCircuit = r4.skipped === true
  } catch (e) {
    console.log('  (diff 求值异常: ' + e.message.slice(0, 120) + ')')
  }
}
check(ticketUpd, '子票 updatedAt bump → issueFlash changed')
check(orphans, '根票（孤儿票）updatedAt bump → 行闪烁数据源产出')
check(diffBehavior !== false, '内容同版本异 → 空差异（不误闪）')
check(shortCircuit, '同版本短路 skipped=true（304 零扰动语义保留）')

console.log(failed ? '\n#255 四缝验证失败' : '\n#255 四缝验证全部通过')
process.exit(failed ? 1 : 0)
