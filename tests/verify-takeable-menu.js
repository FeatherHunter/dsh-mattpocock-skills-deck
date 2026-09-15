// verify-takeable-menu.js — 状态栏可接悬停需求入口契约（issue #638）
// 用法: node tests/verify-takeable-menu.js [file...]（默认 src 真源 + client.js + package/lib/client.js）
// 验证（与 BUG 悬停菜单同形，只是配色与文案换成紫色需求）：
//   1) 中英文文案 nav.takeableNew（中文需求 / 英文 Requirement）与标题 nav.takeableNewTitle 双语成对
//   2) 状态栏可接段包进悬停容器（takeAnchorRef + showTakeMenu + scheduleClose + closeTakeMenu），菜单类名 dsws-takemenu
//   3) 选项行是地图图标加需求（Ic map + tr nav.takeableNew），紫色三件套（字 #c084fc / 亮图标 #d8b4fe / 淡紫底 rgba(192,132,252,.15)）
//   4) 点选项走与面板加需求同一条链路（openTextInNewSession + newWayfinderText + newSessionTitleNew requirement），点数字本身仍是筛可接
//   5) 互斥：打开可接关 BUG 与技能，打开 BUG 与技能关可接；store 有 takeMenuOpen/Hover/Pos 默认关闭；StatusMenus 有定位打开关闭三件并被重定位监听
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const files = process.argv.slice(2)
const srcTargets = ['src/client/statusbar/StatusBar.js', 'src/client/statusbar/StatusMenus.js', 'src/client/kernel/store-snapshot.js', 'src/client/kernel/locale-panel.js', 'src/client/floating/SkillFloatList.js']
const prodTargets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const bad = function (where, msg) { failed = true; console.log('  FAIL', where, msg) }
const ok = function (where, msg) { console.log('  PASS', where, msg) }
const read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8') }

// ---------- P1：真源 ----------
try {
  const loc = read('src/client/kernel/locale-panel.js')
  if (loc.indexOf("'nav.takeableNew': '需求'") < 0) bad('locale-panel zh', '缺中文需求文案')
  else if (loc.indexOf("'nav.takeableNew': 'Requirement'") < 0) bad('locale-panel en', '缺英文 Requirement 文案')
  else if (loc.indexOf('新增需求 prompt') < 0) bad('locale-panel title', '缺新增需求提示标题')
  else ok('locale-panel', '中英文需求文案成对')
} catch (e) { bad('locale-panel', '读取失败 ' + e.message) }
try {
  const bar = read('src/client/statusbar/StatusBar.js')
  const need = ['takeAnchorRef', 'takeCloseRef', 'showTakeMenu', 'closeTakeMenu', 's.takeMenuOpen', 'dsws-takemenu', "tr('nav.takeableNew')", 'newWayfinderText(s)', "newSessionTitleNew('requirement')", "'#c084fc'", 'rgba(192,132,252,.15)', "'#d8b4fe'"]
  const miss = need.filter(function (k) { return bar.indexOf(k) < 0 })
  if (miss.length) bad('StatusBar', '缺 ' + miss.join(' / '))
  else ok('StatusBar', '悬停容器加紫色需求选项加同链路新会话')
  if (bar.indexOf("Ic({ n: 'map'") < 0) bad('StatusBar icon', '选项图标不是地图图标')
  else ok('StatusBar icon', '选项用地图图标')
  if (/需求/.test(bar.replace(/takeableNew/g, ''))) bad('StatusBar hardcode', '状态栏主文件含中文硬编码，应走文案键')
  else ok('StatusBar hardcode', '无中文硬编码')
} catch (e) { bad('StatusBar', '读取失败 ' + e.message) }
try {
  const menus = read('src/client/statusbar/StatusMenus.js')
  const need = ['placeStatusTakeMenu', 'closeStatusTakeMenu', 'showStatusTakeMenu', 's.takeMenuOpen', 'takeAnchorRef']
  const miss = need.filter(function (k) { return menus.indexOf(k) < 0 })
  if (miss.length) bad('StatusMenus', '缺 ' + miss.join(' / '))
  else ok('StatusMenus', '可接定位打开关闭三件齐备')
  if (menus.indexOf('s.takeMenuOpen, s.backendMenuOpen') < 0 && menus.indexOf('s.backendMenuOpen, s.takeMenuOpen') < 0 && menus.indexOf('[s.bugMenuOpen, s.backendMenuOpen, s.takeMenuOpen]') < 0) bad('StatusMenus watch', '重定位监听未含可接菜单')
  else ok('StatusMenus watch', '重定位监听含可接菜单')
} catch (e) { bad('StatusMenus', '读取失败 ' + e.message) }
try {
  const store = read('src/client/kernel/store-snapshot.js')
  if (store.indexOf('takeMenuOpen: false') < 0 || store.indexOf('takeMenuHover: false') < 0 || store.indexOf('takeMenuPos: null') < 0) bad('store', '缺可接菜单三字段默认关闭')
  else ok('store', '可接菜单三字段默认关闭')
} catch (e) { bad('store', '读取失败 ' + e.message) }
try {
  const skill = read('src/client/floating/SkillFloatList.js')
  if (skill.indexOf('s.takeMenuOpen') < 0) bad('SkillFloatList', '打开技能列表时未关可接菜单')
  else ok('SkillFloatList', '与可接菜单互斥')
} catch (e) { bad('SkillFloatList', '读取失败 ' + e.message) }

// ---------- P2：产物 ----------
for (const f of prodTargets) {
  try {
    const src = read(f)
    const need = ['takeMenuOpen', 'nav.takeableNew', 'dsws-takemenu', 'newWayfinderText']
    const miss = need.filter(function (k) { return src.indexOf(k) < 0 })
    if (miss.length) bad(f, '产物缺 ' + miss.join(' / '))
    else ok(f, '产物含可接悬停入口')
  } catch (e) { bad(f, '读取失败 ' + e.message) }
}
if (failed) { console.log('\n存在失败 — verify-takeable-menu 未通过'); process.exit(1) }
console.log('\n全部通过 — 可接悬停需求入口契约生效')
