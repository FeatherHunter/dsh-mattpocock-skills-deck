// tests/verify-naming-title-fact.js — 宿主读取「这条标题是谁写的」那条路（2026-10-03 加固）
//
// 为什么单开这一条：命名守护现在优先用**事实**判断现名是谁写的（底座自动取名可盖回、人写的名一律让位），
// 事实由宿主的 titleFactOf 从 DSH 两个原生服务读出来：ctx.get('sessions').get(sid) 拿活会话，
// ctx.get('sessionTitle').get(session) 拿最新标题快照（含 source.kind）。这条读法错了，判据就会拿不到事实、
// 悄悄退回旧启发式——功能看着还在，但加固等于没生效，所以这段读法要单独钉住。
//
// 测法：从 src/host/refresh/wiring.js 里把 titleFactOf 这个表达式原样抽出来编译（仓库既有先例：
// tests/lib/render-subws-mark.js 用 new Function 抽真产物里的函数），再按 DSH 两个服务的形状喂假服务。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// 本文件按文本求值统一走共用入口 compileFn：把宿主里 titleFactOf 那个函数表达式原样抽出来造成函数（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

const src = readFileSync(join(ROOT, 'src/host/refresh/wiring.js'), 'utf8')
const line = src.split('\n').map(function (l) { return l.trim() }).find(function (l) { return l.indexOf('titleFactOf: function') === 0 })
check(!!line, '断言读法仍在：wiring.js 里有 titleFactOf（被改名的化本测试会红，不会静默放过）')
if (!line) { console.log('\n宿主标题来源读法不存在'); process.exit(1) }

const fragment = line.slice(0, line.lastIndexOf('},') + 1)
let titleFactOf = null
try {
  // 抽出来的函数表达式求值：改走共用入口 compileFn，一个参数 d 照原样列出。
  titleFactOf = compileFn(['d'], 'return ({' + fragment + '}).titleFactOf')({ ctx: null })
} catch (err) {
  check(false, '源码可编译（抽出来的是完整的函数表达式）', String(err && err.message))
}
check(typeof titleFactOf === 'function', '抽出的 titleFactOf 可调用')
if (typeof titleFactOf !== 'function') { console.log('\n宿主标题来源读法不可用'); process.exit(1) }

const d = { ctx: null }
// 同一手法：用带 ctx 的假 d 再求值一次，走共用入口 compileFn。
const withCtx = compileFn(['d'], 'return ({' + fragment + '}).titleFactOf')(d)
const ctxOf = function (opts) {
  return { get: function (k) { return k === 'sessions' ? opts.sessions : (k === 'sessionTitle' ? opts.sessionTitle : undefined) } }
}
const SESSION = { id: 's1' }
const cases = [
  ['正常：底座模型取名（provider）', ctxOf({ sessions: { get: function (id) { return id === 's1' ? SESSION : undefined } }, sessionTitle: { get: function (s) { return s === SESSION ? { title: '模型取的名', source: { kind: 'provider', provider: 'p' } } : undefined } } }), { kind: 'provider', title: '模型取的名' }],
  ['正常：底座首句兜底（fallback）', ctxOf({ sessions: { get: function () { return SESSION } }, sessionTitle: { get: function () { return { title: '首句名', source: { kind: 'fallback' } } } } }), { kind: 'fallback', title: '首句名' }],
  ['正常：人写的（user）', ctxOf({ sessions: { get: function () { return SESSION } }, sessionTitle: { get: function () { return { title: '人写的', source: { kind: 'user' } } } } }), { kind: 'user', title: '人写的' }],
  ['会话不在（get 给 undefined）', ctxOf({ sessions: { get: function () { return undefined } }, sessionTitle: { get: function () { return { title: 'x', source: { kind: 'user' } } } } }), null],
  ['标题服务没挂载', ctxOf({ sessions: { get: function () { return SESSION } } }), null],
  ['会话服务没挂载', ctxOf({ sessionTitle: { get: function () { return null } } }), null],
  ['还没有标题快照', ctxOf({ sessions: { get: function () { return SESSION } }, sessionTitle: { get: function () { return undefined } } }), null],
  ['快照没带 source', ctxOf({ sessions: { get: function () { return SESSION } }, sessionTitle: { get: function () { return { title: 'x' } } } }), null],
  ['快照 source 不是对象', ctxOf({ sessions: { get: function () { return SESSION } }, sessionTitle: { get: function () { return { title: 'x', source: 'user' } } } }), null],
  ['会话服务抛错（不许把异常带出去）', ctxOf({ sessions: { get: function () { throw new Error('boom') } }, sessionTitle: { get: function () { return null } } }), null],
  ['ctx 都没有', null, null],
]
for (let i = 0; i < cases.length; i++) {
  d.ctx = cases[i][1]
  let got = null
  try { got = withCtx('s1') } catch (err) { got = 'THREW:' + String(err && err.message) }
  check(JSON.stringify(got) === JSON.stringify(cases[i][2]), cases[i][0], 'got ' + JSON.stringify(got))
}

if (failed) { console.log('\n宿主标题来源读法存在失败'); process.exit(1) }
console.log('\n全部通过（' + total + ' 项）')
