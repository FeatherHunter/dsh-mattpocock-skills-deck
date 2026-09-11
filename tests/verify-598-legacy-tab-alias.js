#!/usr/bin/env node
/**
 * verify-598-legacy-tab-alias.js — 不再注册旧名面板类型，也不留调不存在方法的死迁移（#598 验收）。
 *
 * 事故形状：插件为了兼容更名前的旧标签，往 better-sidebar 注册了第二个面板类型（waystation:map），
 * 并标了 hidden: true，以为这样它就不会在界面上单独出现。但 hidden 只管「+」菜单 —— better-sidebar
 * 自己的设置页那一页（本机 node_modules/dsh-better-sidebar 的 src/client/SideCardSection.tsx）是按
 * 「已注册的面板类型」逐张画卡片的（标了隐藏的也画，只按同文件的 tabOrder 排到最后），于是同一个面板
 * 在设置里出现两张卡片、两个开关。
 * #598 的处置：不再保留旧名兼容，直接删掉那行别名注册、不做任何迁移；连带删掉 hostShim 里那段调不
 * 存在方法、从落地起就没执行过的死迁移代码。
 *
 * 三条规则：
 *   R1 全树不得再出现旧名面板类型 waystation:map（四份文件都查）。
 *   R3 不得再调用 better-sidebar 里不存在的方法 migrateLegacyTabIds / listOpenTabs（四份文件都查）。
 *   R2 ensureSidebarTab 仍须注册 deck:map，且只注册这一个 —— 防止有人为了过 R1 把注册整段删掉。
 *      R2 只对「承载注册的那几份文件」查（router.js 与两份构建产物）；hostShim.js 只查 R1 与 R3，
 *      它不注册面板类型，也（#598 删掉那段旧标签迁移后）不再打开面板。
 *
 * 覆盖四份文件：src/client/kernel/router.js、src/client/hostShim.js，
 * 以及两份构建产物 client.js 与 package/lib/client.js（产物由 scripts/build.mjs 从 src 重生成）。
 * 扫描前剥离块注释与整行注释，注释里讲这段历史的文字不会误报。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

/** 旧名面板类型（当年叫 dsh-waystation，v1.6.17 起改名 MattSkillsDeck）—— 界面上不该再有它。 */
const RE_LEGACY_ID = /waystation:map/
/** better-sidebar 里不存在的方法：hostShim 曾按「有就用」的写法调它们，实际两处 typeof 判断恒为假。 */
const RE_MISSING_API = /migrateLegacyTabIds|listOpenTabs/
/** 真正该注册的那个面板类型（唯一 tab id）。 */
const RE_REAL_TAB = /registerTab\(\{[\s\S]{0,200}?id:\s*'deck:map'/
/** ensureSidebarTab 的声明头（本仓库写的是 `const ensureSidebarTab = function () {`）。 */
const RE_ENSURE_DECL = /ensureSidebarTab\s*=\s*function\s*\([^)]*\)\s*\{/
/** 文件里任意一处 registerTab 调用。 */
const RE_REGISTER_CALL = /registerTab\s*\(/g

function stripComments(buf) {
  return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * 取 ensureSidebarTab 的函数体（含函数头），按花括号配对找结尾。
 * 原先这里用的是「从函数名往后截 2500 个字符」的固定窗口 —— 窗口一旦被新增注释顶穿，
 * 第二个注册就会落到窗口外，门禁会静默放行（打印 PASS 却什么都没查）。改成配对取块，
 * 以后再往这个函数里加多少行都不会失效。
 * 返回 null 表示找不到声明头，调用方按失败处理。
 */
function functionBodyOf(text, declRe, key) {
  const m = text.match(declRe)
  if (!m) return null
  const start = m.index
  let i = text.indexOf('{', start + m[0].length - 1)
  if (i < 0) return null
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 四份文件都查的两条规则。 */
const ALL_FILES = [
  path.join('src', 'client', 'kernel', 'router.js'),
  path.join('src', 'client', 'hostShim.js'),
  'client.js',
  path.join('package', 'lib', 'client.js'),
]

/** 承载 deck:map 注册、因此额外查 R2 的三份文件。 */
const REGISTER_FILES = [
  path.join('src', 'client', 'kernel', 'router.js'),
  'client.js',
  path.join('package', 'lib', 'client.js'),
]

ALL_FILES.forEach(function (rel) {
  let buf
  try {
    buf = fs.readFileSync(path.join(root, rel), 'utf8')
  } catch (e) {
    bad(rel + ' 读不到（文件缺失？）')
    return
  }
  const text = stripComments(buf)

  if (RE_LEGACY_ID.test(text)) bad(rel + ' R1 又出现了旧名面板类型 waystation:map')
  else ok(rel + ' R1 没有旧名面板类型 waystation:map')

  if (RE_MISSING_API.test(text)) bad(rel + ' R3 又出现了调不存在的方法（migrateLegacyTabIds / listOpenTabs）')
  else ok(rel + ' R3 没有调 better-sidebar 里不存在的方法')
})

REGISTER_FILES.forEach(function (rel) {
  let buf
  try {
    buf = fs.readFileSync(path.join(root, rel), 'utf8')
  } catch (e) {
    bad(rel + ' 读不到（文件缺失？）')
    return
  }
  const text = stripComments(buf)

  if (RE_REAL_TAB.test(text)) ok(rel + ' R2 仍注册 deck:map')
  else bad(rel + ' R2 找不到 deck:map 的注册（别把注册整段删掉）')

  const body = functionBodyOf(text, RE_ENSURE_DECL)
  if (!body) {
    bad(rel + ' R2 定位不到 ensureSidebarTab 的函数体（写法变了就同步改 RE_ENSURE_DECL）')
  } else {
    const tabCalls = (body.match(RE_REGISTER_CALL) || []).length
    if (tabCalls === 1) ok(rel + ' R2 ensureSidebarTab 只注册 1 个面板类型（当前 ' + tabCalls + '）')
    else bad(rel + ' R2 ensureSidebarTab 注册了 ' + tabCalls + ' 个面板类型（应恰好 1 个）')
  }
})

// ---- 先验自证：样例坏写法必须能被规则抓红 ----
{
  if (RE_LEGACY_ID.test("registerTab({ id: 'waystation:map' })")) ok('先验：旧名面板类型可被 R1 抓红')
  else bad('先验失败：R1 抓不住旧名面板类型')
  if (RE_MISSING_API.test('bs.listOpenTabs()')) ok('先验：调不存在的方法可被 R3 抓红')
  else bad('先验失败：R3 抓不住不存在的方法')
  if (RE_REAL_TAB.test("sidebarTabDisposer = bs.registerTab({\n  id: 'deck:map',")) ok('先验：真身注册可被 R2 识别（绿灯能力成立）')
  else bad('先验失败：R2 认不出 deck:map 的注册')
  // 括号配对取块必须真的按块取：函数体里塞一大段注释后，第二个注册仍要被数到
  const padded = 'const ensureSidebarTab = function () {\n  try {\n' +
    '    // ' + 'x'.repeat(4000) + '\n' +
    "    bs.registerTab({ id: 'deck:map' })\n" +
    "    bs.registerTab({ id: 'another:one' })\n" +
    '  } catch (e) { return false }\n}'
  const paddedBody = functionBodyOf(padded, RE_ENSURE_DECL)
  const paddedCalls = paddedBody ? (paddedBody.match(RE_REGISTER_CALL) || []).length : -1
  if (paddedCalls === 2) ok('先验：加长 4000 字的函数体里，两次注册都被数到（旧版固定窗口会漏）')
  else bad('先验失败：括号配对取块数不到两次注册（实际 ' + paddedCalls + '）')
  if (functionBodyOf('const ensureSidebarTab = function () {', RE_ENSURE_DECL) === null) ok('先验：括号不闭合时不硬认成功（宁可报错）')
  else bad('先验失败：括号不闭合也返回了函数体')
}

console.log(failed
  ? '\n[verify-598] FAIL (' + passed + ' passed)'
  : '\n全部通过 · 不再注册旧名面板类型、不留死迁移 (' + passed + ')')
process.exit(failed ? 1 : 0)
