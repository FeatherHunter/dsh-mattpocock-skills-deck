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
 *   R2 每份文件都得留有那条只给类型的调用 —— 防止有人把调用整段删掉，只剩注释也能过 R1。
 *
 * 覆盖四份文件：src/client/kernel/router.js、src/client/hostShim.js，
 * 以及两份构建产物 client.js 与 package/lib/client.js（产物由 scripts/build.mjs 从 src 重生成）。
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

function stripComments(buf) {
  return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const FILES = [
  path.join('src', 'client', 'kernel', 'router.js'),
  path.join('src', 'client', 'hostShim.js'),
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
  if (RE_TYPE_ONLY.test(text)) ok(rel + ' R2 留着那条只给类型的打开调用')
  else bad(rel + ' R2 找不到只给类型的打开调用')
})

// ---- 先验自证：样例坏写法必须能被规则抓红 ----
{
  const probe = "bs.openTab({ type: 'deck:map', path: 'deck:map' }, scope)"
  if (RE_WITH_PATH.test(probe)) ok('先验：插入带 path 的打开可被识别（变红能力成立）')
  else bad('先验失败：R1 抓不住样例坏写法')
  if (RE_TYPE_ONLY.test("bs.openTab({ type: 'deck:map' }, scope)")) ok('先验：只给类型的写法可被识别（绿灯能力成立）')
  else bad('先验失败：R2 认不出只给类型的写法')
}

console.log(failed
  ? '\n[verify-594] FAIL (' + passed + ' passed)'
  : '\n全部通过 · deck 面板打开不再传假 path (' + passed + ')')
process.exit(failed ? 1 : 0)
