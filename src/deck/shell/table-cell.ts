// src/shared/deck-tools/exec-cell.js —— 宿主那张表在同一进程里的共享格（#758）
//
// 只讲一件事：行与宿主跑在同一个进程里（同一份组合、同一份工具注册表，
// 预设行经作用域读全局层，见上游 web-app 组合注释），所以宿主装好的那张表
// 不需要经任何调用面递过去——宿主把它放进这一格，行直接来取。
// 若两边真不在同一进程（旧桌面那种），这一格永远是空的，行按原路退回，
// 一行老行为都不变。
//
// 本文件零导入：共享层的文件之间不许互相引用，零导入是唯一的住法。
// 状态只有三种：empty（宿主还没放）、pending（放了还没装好）、ready（装好了）。
// pid 只在进程内比对，永不外发（探针只报比对结果的布尔值）。
// 另附一小段闸口径迹：壳把每次裁决的机器码（阶段、结论、原因枚举）记在这里，
// 探针读走，线上卡在哪一段一眼可见。正文与路径一律不记。

const cell = {
  state: 'empty',
  promise: null,
  hostPid: 0,
}

function pidNow() {
  try {
    if (typeof process !== 'undefined' && process !== null && typeof process.pid === 'number') return process.pid
  } catch (e) {}
  return 0
}

/** 宿主接线装表时调一次：把装表那份承诺放进来（重复调只留第一次）。 */
export function publishDeckTable(tableP) {
  try {
    if (cell.state !== 'empty') return
    if (!tableP || typeof tableP.then !== 'function') return
    cell.state = 'pending'
    cell.promise = tableP
    cell.hostPid = pidNow()
    tableP.then(
      function () { try { if (cell.state === 'pending') cell.state = 'ready' } catch (e) {} },
      function () { try { if (cell.state === 'pending') cell.state = 'ready' } catch (e2) {} },
    )
  } catch (e3) {}
}

/** 同步看一眼：空就别等（对方进程根本没放），有才值得等。 */
export function peekDeckTable() {
  try {
    if (cell.state === 'empty' || !cell.promise) return null
    return { state: cell.state, sameProcess: cell.hostPid !== 0 && cell.hostPid === pidNow() }
  } catch (e) { return null }
}

/** 等表装好：超时就回空，调用方按原路退回，不抛。 */
export function awaitDeckTable(timeoutMs) {
  try {
    const peek = peekDeckTable()
    if (!peek) return Promise.resolve(null)
    const cap = (typeof timeoutMs === 'number' && timeoutMs > 0) ? Math.floor(timeoutMs) : 25000
    return Promise.race([
      Promise.resolve(cell.promise).then(function (t) { return t || null }, function () { return null }),
      new Promise(function (resolve) { setTimeout(function () { resolve(null) }, cap) }),
    ])
  } catch (e) { return Promise.resolve(null) }
}

const gateNotes = []

function cleanGateWord(v) {
  try {
    const t = String(v || '')
    if (/^[a-z][a-z0-9-]{0,63}$/.test(t)) return t
    return ''
  } catch (e) { return '' }
}

/** 壳记一笔裁决口径：只收机器码（阶段、结论、原因枚举），正文路径一律不收。 */
export function noteDeckGate(info) {
  try {
    const at = info || {}
    gateNotes.push({
      phase: cleanGateWord(at.phase),
      verdict: cleanGateWord(at.verdict),
      reason: cleanGateWord(at.reason),
    })
    while (gateNotes.length > 8) gateNotes.shift()
  } catch (e) {}
}

/** 读走口径迹（探针用）：只含机器码的数组副本。 */
export function readDeckGate() {
  try { return gateNotes.map(function (n) { return { phase: n.phase, verdict: n.verdict, reason: n.reason } }) } catch (e) { return [] }
}

const lastPath = { tool: '', via: '' }

/** 行记一笔这次走的哪条路（探针用）：工具名是自家的，路是四选一枚举。 */
export function noteDeckPath(tool, via) {
  try {
    const t = (typeof tool === 'string' && tool) ? tool : ''
    const v = (via === 'cell' || via === 'connection' || via === 'fetch' || via === 'fallback') ? via : ''
    if (t && v) { lastPath.tool = t; lastPath.via = v }
  } catch (e) {}
}

/** 读走上次走的路（探针用）。 */
export function readDeckPath() {
  try { return { tool: lastPath.tool, via: lastPath.via } } catch (e) { return { tool: '', via: '' } }
}
