#!/usr/bin/env node
/**
 * verify-594-deckmap-tab.js — 打开 deck 面板时不许给 openTab 传假 path（#594 验收）。
 *
 * 事故形状：为了让折叠着的侧边栏自动展开，插件给 better-sidebar 的 openTab 传了一个假的
 * path（'deck:map'）。better-sidebar 0.19 起，带 path 的打开会被当成「打开一个真实文件」，
 * 转发给 DSH 原生右侧栏并按文件地址解析；宿主于是拿 deck:map 这个字符串去文件系统里
 * realpath，找不到就抛 cannot resolve target "...\deck:map"，面板打不开，用户只看到这条报错。
 * 不带 path 才是正确用法：better-sidebar 会把 deck:map 当成插件注册的面板类型，
 * 落到 DSH 原生右侧栏，并按描述符自己决定要不要展开（本面板没有 createTab，恒展开）。
 *
 * 两条规则（src 真源与双产物同规则）：
 *   R1 打开 deck 标签页的调用里不得出现 path —— 全树零容忍。
 *   R2 打开 deck 标签页的那几份文件都得留着那条只给类型的调用 —— 防止有人把调用整段删掉，只剩注释也能过 R1。
 *      R2 只查「真会去打开面板」的三份文件（router.js 与两份产物）：这份防回归要落在真有调用的地方才成立。
 *      hostShim.js 只在 R1 里查，它现在已经一次都不打开面板了 —— #598 删掉了它里面那段「旧标签迁移」兜底代码
 *      （前提条件调的是 better-sidebar 里不存在的方法，从落地起就没执行过），连带删掉的就是那里的 openTab 调用。
 *      #598 同时删了旧名面板类型的注册，所以那段旧名迁移已经没有存在意义，不会再补回来。
 *
 * 覆盖四份文件：src/client/kernel/router.js、src/client/hostShim.js，
 * 以及两份构建产物 client.js 与 package/lib/client.js（产物由 scripts/build.mjs 从 src 重生成）。
 * 其中 R1 四份都查，R2 只查 router.js 与两份产物，另有一条只盯 hostShim.js 的提醒（见上）。
 * 扫描前剥离块注释与整行注释，注释里讲这条规则的文字不会误报。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

/** 带 path 的 deck:map 打开：openTab({ type: 'deck:map', … path … })。 */
const RE_WITH_PATH = /openTab\(\{[^}]*type:\s*'deck:map'[^}]*path/
/** 只给类型的 deck:map 打开：openTab({ type: 'deck:map' })。 */
const RE_TYPE_ONLY = /openTab\(\{\s*type:\s*'deck:map'\s*\}/
/** 任意一次打开面板的调用（不带 type 条件）：用来确认 hostShim.js 里已经一次都不打开了。 */
const RE_ANY_OPEN = /openTab\s*\(/

function stripComments(buf) {
  return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const FILES = [
  path.join('src', 'client', 'kernel', 'router.js'),
  path.join('src', 'client', 'hostShim.js'),
  'client.js',
  path.join('package', 'lib', 'client.js'),
]

/** 真会去打开面板、因此额外查 R2 的三份文件（hostShim.js 不在此列，理由见文件头注释）。 */
const OPENER_FILES = [
  path.join('src', 'client', 'kernel', 'router.js'),
  'client.js',
  path.join('package', 'lib', 'client.js'),
]

FILES.forEach(function (rel) {
  let buf
  try {
    buf = fs.readFileSync(path.join(root, rel), 'utf8')
  } catch (e) {
    bad(rel + ' 读不到（文件缺失？）')
    return
  }
  const text = stripComments(buf)
  if (RE_WITH_PATH.test(text)) bad(rel + ' R1 打开 deck 标签页时传了 path（会被当成真实文件去解析）')
  else ok(rel + ' R1 打开 deck 标签页时没有传 path')
})

OPENER_FILES.forEach(function (rel) {
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'))
  if (RE_TYPE_ONLY.test(text)) ok(rel + ' R2 留着那条只给类型的打开调用')
  else bad(rel + ' R2 找不到只给类型的打开调用')
})

// hostShim.js 已经不再打开面板（#598 删掉了那段旧标签迁移）：这条是给「它又被写回去」留的提醒。
{
  const rel = path.join('src', 'client', 'hostShim.js')
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'))
  if (RE_ANY_OPEN.test(text)) bad(rel + ' 又出现了打开面板的调用 —— 对不上 #598 删掉旧标签迁移后的形状')
  else ok(rel + ' 已不再打开面板（#598 删掉旧标签迁移后就是这个形状）')
}

// ---- 先验自证：样例坏写法必须能被规则抓红 ----
{
  const probe = "bs.openTab({ type: 'deck:map', path: 'deck:map' }, scope)"
  if (RE_WITH_PATH.test(probe)) ok('先验：插入带 path 的打开可被识别（变红能力成立）')
  else bad('先验失败：R1 抓不住样例坏写法')
  if (RE_TYPE_ONLY.test("bs.openTab({ type: 'deck:map' }, scope)")) ok('先验：只给类型的写法可被识别（绿灯能力成立）')
  else bad('先验失败：R2 认不出只给类型的写法')
  if (RE_ANY_OPEN.test('bs.openTab({ type: \'deck:map\' }, scope)')) ok('先验：打开面板的调用可被识别（hostShim 那条提醒抓得住）')
  else bad('先验失败：抓不住打开面板的调用')
}

console.log(failed
  ? '\n[verify-594] FAIL (' + passed + ' passed)'
  : '\n全部通过 · deck 面板打开不再传假 path (' + passed + ')')
process.exit(failed ? 1 : 0)
