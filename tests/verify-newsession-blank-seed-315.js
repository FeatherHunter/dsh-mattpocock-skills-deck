// tests/verify-newsession-blank-seed-315.js — #315 草稿体验守护（2026-08-30 回滚版）
// 用法: node tests/verify-newsession-blank-seed-315.js [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 背景：#315 曾因 openTextInNewSession 创建空白会话（pendingDraft-only）被壳复用为 provisional New Session row
//   导致“新会话被自动改名”。2026-08-29 曾改为 face.prompt 自动发送使会话出生即非空白，但违背用户约束：
//   “右侧面板‘新增需求/新增BUG’必须保留‘先填草稿、让用户自己输入再发送’，不允许点击就自动发出去”。
//   故 2026-08-30 回滚为草稿-only：任何情况下都不自动调 face.prompt，只挂 pendingDraft/targetSid.
//
// 验收标准（本回归·回滚后）：
//   a) 无论 face 是否具备 prompt 能力，都不调用 face.prompt（保留草稿体验）；
//   b) 创建/改名后写入 pendingDraft = 提示词 且 pendingDraftTargetSid = 新会话 sid；
//   c) 双源一致（src 与构建产物逐字 splice 保留）；
//   d) 源码中不含 seedNewSession / face.prompt 自动发送逻辑（防回退）。
//
// 本测试不复制 openTextInNewSession 逻辑：从目标文件提取真实函数源码并在沙箱以忠实替身执行
// （与 verify-b2-map-newsession.js 同范式），能抓住“逻辑改坏 / 双源漂移”两类回归。
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['src/client/kernel/api.js', 'package/lib/client.js']

// ---- 提取真实函数源码 ----
function extractOpenFn(src) {
  const marker = 'const openTextInNewSession = function (st, text, title) {'
  const src2 = src.indexOf(marker) >= 0 ? src : src.replace(/export const openTextInNewSession/, 'const openTextInNewSession')
  const i = src2.indexOf(marker)
  if (i < 0) throw new Error('起始锚点缺失: openTextInNewSession')
  const j = src2.indexOf('// #361 原入口：行级「在新会话打开」保留', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src2.slice(i, j)
}

// ---- 沙箱执行（b 分支用 faceNoPrompt 变体）----
// pendingDraft / pendingDraftTargetSid 是模块级 let：观察侧把源码中的裸标识符重写为
// __dbg.*（可变对象字段），赋值可观测且行为与原型一致。
function runSandbox(fnSrc, faceVariant) {
  let replaced = fnSrc
  replaced = replaced.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
  replaced = replaced.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
  const rec = { created: null, opened: null, promptCalls: [] }
  const dbg = { pendingDraft: null, pendingDraftTargetSid: null }
  const face = faceVariant === 'no-prompt'
    ? { rename: async (t) => ({ ok: true, value: { title: t } }) }
    : { rename: async (t) => ({ ok: true, value: { title: t } }), prompt: async (content, mode) => { rec.promptCalls.push({ content: JSON.parse(JSON.stringify(content)), mode }); return { ok: true } } }
  const sessionsStub = {
    create: async (opts) => { rec.created = JSON.parse(JSON.stringify(opts || {})); return 'sid-1' },
    scope: (sid) => ({ sessionId: sid }),
    sessionOf: () => face,
    open: (sid) => { rec.opened = sid },
  }
  const workspacesStub = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws9', path: 'D:/repo' }] }) } }
  const st = { sessionId: 'src-sess', cwd: 'D:/repo', snapshot: null }
  const fn = new Function(
    'st', 'text', 'title', 'ctx', 'host', '__dbg',
    'inject', 'flash', 'tr', 'getCwdSync', 'keyOf', 'storeOf', 'hydrateFromCache',
    'getCachedSnapshot', 'issueRefNumbersFrom', 'recordIssuePath', 'namingHintOf',
    'isNewPlaceholderTitle', 'namingGuardianKick',
    replaced + '; return openTextInNewSession'
  )
  const openFn = fn(
    st, '', '', { get: (k) => (k === 'sessions' ? sessionsStub : k === 'workspaces' ? workspacesStub : null) },
    { call: async () => ({ ok: true }) }, dbg,
    () => {}, () => {}, (k) => k, () => null, (s) => String(s),
    (sid) => ({ cwd: 'D:/repo', snapshot: null }), () => false, () => null,
    () => [315], () => {}, () => null,
    (t) => /^\[New\] /.test(String(t)), () => {}
  )
  openFn(st, '/wayfinder 调查 #315 的提示词', '[#315] BUG：自动改名错误地改写了其他会话的标题')
  return { rec, dbg }
}

// ---- 测试 ----
let failed = false
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const sleep = (ms) => new Promise(function (res) { setTimeout(res, ms) })

console.log('== #315 新会话草稿体验守护（2026-08-30 回滚）==')

async function main() {
for (const file of files) {
  console.log('--- ' + file + ' ---')
  if (!fs.existsSync(file)) { check(false, file + ' 存在'); continue }
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch (e) { check(false, file + ' 可读 — ' + e.message); continue }
  let fnSrc
  try { fnSrc = extractOpenFn(src) } catch (e) { check(false, file + ' 源码锚点可提取 — ' + e.message); continue }
  check(true, file + ' openTextInNewSession 源码可提取（锚点保留）')
  // 文本级守护：不含自动发送逻辑
  check(fnSrc.indexOf('seedNewSession') < 0, file + ' 源码不含 seedNewSession（已回滚）')
  check(fnSrc.indexOf('face.prompt(') < 0 && fnSrc.indexOf('seedNewSession') < 0, file + ' 源码不含 face.prompt 自动发送（草稿-only）')
  check(fnSrc.indexOf('pendingDraft = text') >= 0, file + ' 源码含 pendingDraft = text（草稿挂载）')
  check(fnSrc.indexOf('pendingDraftTargetSid = sid') >= 0, file + ' 源码含 pendingDraftTargetSid = sid（sid 锚定）')
  check(fnSrc.indexOf('#315 回滚') >= 0 || fnSrc.indexOf('先填草稿') >= 0, file + ' 源码含回滚注释（可追溯）')

  // a) 有 prompt 能力的面对象：也不应调用 prompt（草稿-only）
  const env = runSandbox(fnSrc, 'with-prompt')
  await sleep(40)
  check(env.rec.created && env.rec.created.workspaceId === 'ws9', file + ' 创建调用携带 workspaceId（同工作区）')
  check(env.rec.opened === 'sid-1', file + ' 创建后 open 切换到新会话')
  check(env.rec.promptCalls.length === 0, file + ' 有 prompt 能力时也不调用 face.prompt（草稿-only 约束）')
  check(env.dbg.pendingDraft === '/wayfinder 调查 #315 的提示词' && env.dbg.pendingDraftTargetSid === 'sid-1', file + ' 有 prompt 能力时仍挂草稿（pendingDraft + target sid）')

  // b) 无 prompt 能力 → 同样挂草稿
  const env2 = runSandbox(fnSrc, 'no-prompt')
  await sleep(40)
  check(env2.rec.promptCalls.length === 0, file + ' 无 prompt 能力时不调用 prompt')
  check(env2.dbg.pendingDraft === '/wayfinder 调查 #315 的提示词' && env2.dbg.pendingDraftTargetSid === 'sid-1', file + ' 回退原预填草稿路径（pendingDraft + target sid）')
}

if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1) }
else { console.log('\nPASS all ' + total + ' checks') }
}
main()
