#!/usr/bin/env node
/**
 * verify-598-legacy-tab-alias.js — 不再注册旧名面板类型，也不留调不存在方法的死迁移（#598 验收）。
 *
 * 事故形状：插件为了兼容更名前的旧标签，往 better-sidebar 注册了第二个面板类型（waystation:map），
 * 并标了 hidden: true，以为这样它就不会在界面上单独出现。但 hidden 只管「+」菜单 —— better-sidebar
 * 设置页的「侧边卡」清单是按「已注册的面板类型」逐张画卡片的（隐藏的也画，只排到最后，见
 * SideCardSection.tsx 的 tabOrder），于是同一个面板在设置里出现两张卡片、两个开关。
 * #598 拍板（改法 A）：不再保留旧名兼容 —— 删掉那行别名注册；连带删掉 hostShim 里那段调不存在方法、
 * 从落地起就没执行过的死迁移代码。
 *
 * 三条规则：
 *   R1 全树不得再出现旧名面板类型 waystation:map（四份文件都查）。
 *   R3 不得再调用 better-sidebar 里不存在的方法 migrateLegacyTabIds / listOpenTabs（四份文件都查）。
 *   R2 ensureSidebarTab 仍须注册 deck:map，且只注册这一个 —— 防止有人为了过 R1 把注册整段删掉。
 *      R2 只对「承载注册的那几份文件」查（router.js 与两份构建产物）；hostShim.js 本来就不注册面板类型。
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
const RE_REAL_TAB = /registerTab\(\{[\s\S]{0,80}?id:\s*'deck:map'/
/** 取 ensureSidebarTab 一段足够长的上下文，用来数里面的 registerTab 调用。 */
const RE_ENSURE_BLOCK = /ensureSidebarTab[\s\S]{0,2500}/

function stripComments(buf) {
  return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
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

  const block = text.match(RE_ENSURE_BLOCK)
  if (!block) {
    bad(rel + ' R2 定位不到 ensureSidebarTab')
  } else {
    const tabCalls = (block[0].match(/registerTab\s*\(/g) || []).length
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
}

console.log(failed
  ? '\n[verify-598] FAIL (' + passed + ' passed)'
  : '\n全部通过 · 不再注册旧名面板类型、不留死迁移 (' + passed + ')')
process.exit(failed ? 1 : 0)
