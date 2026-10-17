// tests/verify-newsession-blank-seed-315.ts — #315 草稿体验守护（2026-08-30 回滚版）
// 用法: node tests/verify-newsession-blank-seed-315.ts [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 背景：#315 曾因 openTextInNewSession 创建空白会话（pendingDraft-only）被壳复用为 provisional New Session row
//   导致“新会话被自动改名”。2026-08-29 曾改为 face.prompt 自动发送使会话出生即非空白，但违背用户约束：
//   “右侧面板‘新增需求/新增BUG’必须保留‘先填草稿、让用户自己输入再发送’，不允许点击就自动发出去”。
//   故 2026-08-30 回滚为草稿-only：任何情况下都不自动调 face.prompt，只写目标会话自己的首条草稿.
//   #787 起草稿住目标会话自己的 store（storeOf(新编号).incomingDraft），单槽全局已删除，连续创建各归各。
//
// 验收标准（本回归·回滚后 + #787）:
//   a) 无论 face 是否具备 prompt 能力，都不调用 face.prompt（保留草稿体验）；
//   b) 创建/改名后把提示词写进目标会话自己的 store（incomingDraft），各目标互不可见；
//   c) 双源一致（src 与构建产物逐字 splice 保留）；
//   d) 源码中不含 seedNewSession / face.prompt 自动发送逻辑（防回退）。
//
// 本测试不复制 openTextInNewSession 逻辑：从目标文件提取真实函数源码并在沙箱以忠实替身执行
// （与 verify-b2-map-newsession.js 同范式），能抓住“逻辑改坏 / 双源漂移”两类回归。
const fs = require('fs')
const { compileFn: compileFnRaw } = require('./lib/eval-probe.js')

// #1215 之后的必修：api 源码里新加了模块级 import（api-new-session.js 的会话 tick / 交接延迟、
//   api-io.ts 的草稿重聚焦重试毫秒）。沙箱是 new Function 拼出来的，吃不下 import 语句，
//   以前会当场 SyntaxError、整条门禁红。修法不是删掉那些 import 了事，而是：拼给沙箱的文本里
//   先把模块级 import 行摘掉，再把 src/shared/time-config/values.js 里**真实导出**的数值按同名
//   常量注进沙箱体——数字仍然只有中央那一个来源，门禁不手抄。
const timeValues = require('../src/shared/time-config/values.js')
const SANDBOX_CONSTS = ['CLIENT_SESSION_TICK_MS', 'CLIENT_HANDOFF_DELAY_MS', 'DRAFT_REFOCUS_RETRY_MS']
  .map((name) => `const ${name} = ${timeValues[name]};`)
  .join('\n')
const stripModuleImports = (text) => String(text).replace(/^\s*import\s[^\n]*$/gm, '')
const compileFn = (paramNames, body) => compileFnRaw(paramNames, SANDBOX_CONSTS + '\n' + stripModuleImports(body))

const API_SRC_FILES = ['src/client/kernel/api-naming.js', 'src/client/kernel/api-workspace.js', 'src/client/kernel/api-new-session.js', 'src/client/kernel/api-io.ts'] // #457 K4 + #636：api 拆分文件 + 工作区查找模块，src 侧读四文件拼合（api-io 于 #1111 转成 .ts；产物 .js 被构建去掉注释，终止锚点只在源码里）
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['src/client/kernel/api-naming.js+api-workspace.js+api-new-session.js+api-io.js（拼合）', 'package/lib/client.js']
const readTestSrc = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n') : fs.readFileSync(file, 'utf8') // #457 K4：拼合含 openText/工厂/回退/工作区查找全量（跨 naming、workspace 与 new-session，单文件含不全）
const testExists = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.every((f) => fs.existsSync(f)) : fs.existsSync(file) // #457 K4：四文件全存在才算存在

// ---- 提取真实函数源码 ----
function extractOpenFn(src) {
  const marker = 'const openTextInNewSession = function (st, text, title'
  const src2 = src.indexOf(marker) >= 0 ? src : src.replace(/export const openTextInNewSession/, 'const openTextInNewSession')
  const i = src2.indexOf(marker)
  if (i < 0) throw new Error('起始锚点缺失: openTextInNewSession')
  // 终止锚点写成 `//!`（法律注释）：api-io 转成 TypeScript 之后由 esbuild 出产物，普通注释会被去掉，
  // 只有 `//!` 这一种能一路留到 package/lib/client.js，源与产物两条腿才能用同一个锚点（#1111）。
  const j = src2.indexOf('//! #361 原入口：行级「在新会话打开」保留', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src2.slice(i, j)
}

// #636 拆分：工作区查找住在 api-workspace.js；沙箱跑薄转发时要把它拼在前面（与真实闭包拼接次序一致）。
function extractWorkspaceBlock(src) {
  const startMarker = 'const workspacePathOf = function'
  const endMarker = 'const probeHandoffReady = function'
  const i = src.indexOf(startMarker)
  if (i < 0) throw new Error('工作区查找起始缺失: workspacePathOf')
  const j = src.indexOf(endMarker, i)
  if (j < 0) throw new Error('工作区查找终止缺失: probeHandoffReady')
  return src.slice(i, j).replace(/^\s*export\s+/gm, '')
}

// ---- 沙箱执行（b 分支用 faceNoPrompt 变体）----
// 首条草稿住目标会话自己的 store：storeOf 用按编号缓存的替身，写进哪个目标事后可查。
function runSandbox(fnSrc, faceVariant, wsLib) {
  const rec = { created: null, opened: null, promptCalls: [] }
  const storeMap = {}
  const storeOfStub = function (sid) {
    if (!storeMap[sid]) storeMap[sid] = { cwd: 'D:/repo', snapshot: null, incomingDraft: null }
    return storeMap[sid]
  }
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
  // 本文件选 compileFn：这一处原来就是把十八个环境名当参数、把从 api 源码里切出来的函数当函数体造函数，
  //   被造的代码只看这些参数（依赖全部显式注入），与共用入口用法一一对应。
  const fn = compileFn(
    ['st', 'text', 'title', 'ctx', 'host',
      'inject', 'flash', 'tr', 'getCwdSync', 'keyOf', 'storeOf', 'hydrateFromCache',
      'getCachedSnapshot', 'issueRefNumbersFrom', 'recordIssuePath', 'namingHintOf',
      'isNewPlaceholderTitle', 'namingGuardianKick'],
    (wsLib ? wsLib + ';\n' : '') + fnSrc + '; return openTextInNewSession'
  )
  const openFn = fn(
    st, '', '', { get: (k) => (k === 'sessions' ? sessionsStub : k === 'workspaces' ? workspacesStub : null) },
    { call: async () => ({ ok: true }) },
    () => {}, () => {}, (k) => k, () => null, (s) => String(s),
    storeOfStub, () => false, () => null,
    () => [315], () => {}, () => null,
    (t) => /^\[New\] /.test(String(t)), () => {}
  )
  openFn(st, '/wayfinder 调查 #315 的提示词', '[#315] BUG：自动改名错误地改写了其他会话的标题')
  return { rec, storeMap }
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
  if (!testExists(file)) { check(false, file + ' 存在'); continue }
  let src
  try { src = readTestSrc(file) } catch (e) { check(false, file + ' 可读 — ' + e.message); continue }
  let fnSrc
  try { fnSrc = extractOpenFn(src) } catch (e) { check(false, file + ' 源码锚点可提取 — ' + e.message); continue }
  check(true, file + ' openTextInNewSession 源码可提取（锚点保留）')
  let wsLib = ''
  try { wsLib = extractWorkspaceBlock(src) } catch (eWs) { check(false, file + ' 工作区查找块可提取 — ' + eWs.message); continue }
  check(wsLib.indexOf('resolveWorkspaceEntry') >= 0, file + ' 工作区查找块含 resolveWorkspaceEntry（#636 拆分）')
  // 原来这里还有六条「把切出来的那段源码当文本、断言里面有没有某段字」的检查
  //   （不含 seedNewSession、不含 face.prompt 自动发送、没有 pendingDraft 全局单槽写入、
  //     写了 incomingDraft、带 #315 回滚注释）。它们断的是代码长成什么样，改写法、改注释、
  //     换个变量名就变红，已按维护者口径删掉。真正的关切由下面的沙箱行为用例接管：
  //     face 即使在手也一次都不许调 prompt（a），草稿必须落在目标会话自己的 store 上（a、b）。

  // a) 有 prompt 能力的面对象：也不应调用 prompt（草稿-only）
  const env = runSandbox(fnSrc, 'with-prompt', wsLib)
  await sleep(40)
  check(env.rec.created && env.rec.created.workspaceId === 'ws9', file + ' 创建调用携带 workspaceId（同工作区）')
  check(env.rec.opened === 'sid-1', file + ' 创建后 open 切换到新会话')
  check(env.rec.promptCalls.length === 0, file + ' 有 prompt 能力时也不调用 face.prompt（草稿-only 约束）')
  check(env.storeMap['sid-1'] && env.storeMap['sid-1'].incomingDraft === '/wayfinder 调查 #315 的提示词', file + ' 有 prompt 能力时仍写目标会话自己的草稿（incomingDraft）')

  // b) 无 prompt 能力 → 同样挂草稿
  const env2 = runSandbox(fnSrc, 'no-prompt', wsLib)
  await sleep(40)
  check(env2.rec.promptCalls.length === 0, file + ' 无 prompt 能力时不调用 prompt')
  check(env2.storeMap['sid-1'] && env2.storeMap['sid-1'].incomingDraft === '/wayfinder 调查 #315 的提示词', file + ' 回退原预填草稿路径（目标会话 incomingDraft）')
}

if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1) }
else { console.log('\nPASS all ' + total + ' checks') }
}
main()
