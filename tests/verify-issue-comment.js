// verify-issue-comment.js — #255 四缝验证：契约缝 + 集成差异冒烟（宿主透传冒烟见 smoke-comment-passthrough）
// - 契约缝：canComment 显隐谓词对三形状（MISSING / EMPTY 数组 / EMPTY nodes）的行为断言（从构建产物提取真源表达式求值）
// - 集成差异冒烟：diffSnapshots 对「纯评论变化（updatedAt bump）」产出行闪烁——根票（孤儿票）补口 + 子票元组扩展
// 用法: node tests/verify-issue-comment.js
// 2026-10-17 先修（三处，判据一条没放宽）：
//   ① 谓词锚原来要求那行以「)」加换行结尾，而产物今天以「);」结尾（构建把整句收成一行加一个分号），
//      锚于是匹配不上、谓词那一条恒假。改成容忍行尾分号。
//   ② 从产物里切出来的 diffSnapshots 用 idOf() 算票的身份，而 idOf 在真源里是独立函数
//      （src/tracker/kernel/identity-keys.ts），单独求值那段函数体时它是未定义的（今天报 idOf is not
//      defined）。改成把真源那份身份算法一起求值进来，别在门禁里另抄一份。
//   ③ 夹具与断言原来用裸编号当身份键（255/253），而身份算法读的是 key 这一格。夹具补上 key，
//      断言改成用注入的真 idOf 现算出来的键——这样「身份算法变了」时门禁跟着变，不会自己骗自己。
const fs = require('fs')
// 本文件按文本求值统一走共用入口 compileFn：从构建产物里切出谓词与函数体再造成真函数（理由与用法见 tests/lib/eval-probe.js 文件头）。
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口（#1207）：身份算法住在真源里，产物里只有它的内联副本。
const { spliceableJs } = require('./lib/source-text.ts')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const pcli = fs.readFileSync('package/lib/client.js', 'utf8')

// —— 契约缝 A：显隐谓词行为（从构建产物提取真源比较式直接求值，杜绝测试私有副本漂移）
const predM = pcli.match(/canComment = !!rawComments && \(([\s\S]+?)\);?\s*\r?\n/)
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
    // 从产物里切出的整段 diffSnapshots 求值：改走共用入口 compileFn。它用 idOf() 算票的身份，所以把真源
    // 那份身份算法（src/tracker/kernel/identity-keys.ts，无 import、可剥离）一起求值进来，再取出两样东西。
    const identityJs = spliceableJs('src/tracker/kernel/identity-keys.ts')
    const sandboxFn = compileFn([], identityJs + '\n' + fnText + '\nreturn { diffSnapshots: diffSnapshots, idOf: idOf };')
    const sandbox = sandboxFn()
    const diffSnapshots = sandbox.diffSnapshots
    const idOf = sandbox.idOf
    // 身份键由真算法现算（fixtures 的 key 就是它的输入）：断言里不再写裸编号。
    const keyMap248 = idOf({ key: '248' })
    const keyTicket253 = idOf({ key: '253' })
    const keyIssue255 = idOf({ key: '255' })
    const base = { ok: true, version: 'v1', generatedMs: 1,
      maps: [{ number: 248, key: '248', title: 'Map', state: 'OPEN', labels: ['wayfinder:map'], tickets: [{ number: 253, key: '253', state: 'CLOSED', progress: '100%', claimedBy: 'me', labels: [], updatedAt: 't1' }] }],
      issues: [{ number: 255, key: '255', title: 'Spec', state: 'OPEN', labels: ['ready-for-agent'], updatedAt: 'u1' }] }
    // 真实快照的 version 为内容哈希：任何字段变化 ⇒ 版本必变，否则短路合法吞掉差异。
    // ① 子票纯评论变化（updatedAt bump + 版本推进）→ issueFlash.changed
    const tick = JSON.parse(JSON.stringify(base))
    tick.generatedMs = 2
    tick.version = 'v2'
    tick.maps[0].tickets[0].updatedAt = 't2'
    const r1 = diffSnapshots(base, tick)
    ticketUpd = !!(r1.issueFlash && r1.issueFlash[keyTicket253] === 'changed')
    // ② 根票（孤儿票）updatedAt bump → changed 含它（右侧主列表行闪烁的数据源）
    const r2base = JSON.parse(JSON.stringify(base)); const r2new = JSON.parse(JSON.stringify(base))
    r2new.generatedMs = 3; r2new.version = 'v3'; r2new.issues[0].updatedAt = 'u9'
    const r2 = diffSnapshots(r2base, r2new)
    orphans = Array.isArray(r2.changed) && r2.changed.indexOf(keyIssue255) >= 0
    // ②b 同一套判据也守「地图身份键」：地图标题变 → changed 里是地图的身份键（不是裸编号）
    const r2bBase = JSON.parse(JSON.stringify(base)); const r2bNew = JSON.parse(JSON.stringify(base))
    r2bNew.generatedMs = 5; r2bNew.version = 'v5'; r2bNew.maps[0].title = 'Map2'
    const r2b = diffSnapshots(r2bBase, r2bNew)
    const mapKeyHit = Array.isArray(r2b.changed) && r2b.changed.indexOf(keyMap248) >= 0
    check(mapKeyHit, '地图标题变 → changed 用的是真身份键（' + keyMap248 + '）')
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
