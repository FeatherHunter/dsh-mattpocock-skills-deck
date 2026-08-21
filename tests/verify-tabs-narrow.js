// verify-tabs-narrow.js — 面板 tabs 行窄屏分级折叠 + 悬浮提示 · issue #15（效果升级版）
// 用法: node tests/verify-tabs-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #15 + 效果升级 + grilling 收口）：
//   1) 单行基础：.dsws-tabs 含 flex-wrap:nowrap + overflow:hidden + white-space:nowrap；.dsws-tab 含 nowrap + flex:none。
//   2) 短文案起步：动作按钮不再显示「新建」（+ 号即新建语义）——面板.newWayfinder='+ 需求'、panel.newBug='+ bug'（EN 同理）。
//   3) 分级折叠（内容自适应）：
//      - L1：动作按钮（需求/bug/刷新）→ 纯图标（版本号隐藏）
//      - L2：tab 三键 → 也纯图标（版本号隐藏）
//   4) 折叠判定：tabsLevelDecide(level, avail, nats) —— 当前级放不下升级、回够空间(+滞回4)降级。
//   5) 悬浮提示：折叠图标态 hover 用 portal Tooltip（portalTop + zIndex 2147483000，跟随鼠标），替代原生 title
//      （动作按钮 minLevel=1、tab 三键 minLevel=2；原生 title 已移除，避免双提示）。
//   6) hook 合法性：Overlay 的 tabsRef/effect 在 `if (!s.open) return null` 之前，effect 依赖 [s.open]。
//   7) 双源镜像：CSS（dsws-tabs/l 规则）+ tabs 容器 JSX + 折叠 effect 块 byte-for-byte 等价。
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：CSS / JS 静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：单行基础
  const tabsCss = (src.match(/\.dsws-tabs\{[^}]*\}/) || [''])[0]
  ok('CSS · .dsws-tabs 含 flex-wrap:nowrap', /flex-wrap:nowrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 不含 flex-wrap:wrap', !/flex-wrap:wrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 overflow:hidden（溢出守卫）', /overflow:hidden/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 white-space:nowrap', /white-space:nowrap/.test(tabsCss))
  const tabCss = (src.match(/\.dsws-tab\{[^}]*\}/) || [''])[0]
  ok('CSS · .dsws-tab 含 white-space:nowrap', /white-space:nowrap/.test(tabCss))
  ok('CSS · .dsws-tab 含 flex:none', /flex:none/.test(tabCss))

  // 期望 2：短文案起步（无「新建」）
  ok('i18n · 不再出现「新建需求/新增BUG单」全称', !src.includes("'+ 新建需求'") && !src.includes("'+ 新增BUG单'") && !src.includes("'+ New requirement'"))
  const zhM = src.match(/'panel\.newWayfinder': '([^']*)'/)
  const zhB = src.match(/'panel\.newBug': '([^']*)'/)
  ok('i18n · zh 短文案 + 需求 / + bug', zhM && zhM[1] === '+ 需求' && zhB && zhB[1] === '+ bug')
  ok('i18n · en 短文案 + Requirement / + BUG', /'panel\.newWayfinder': '\+ Requirement'/.test(src) && /'panel\.newBug': '\+ BUG'/.test(src))

  // 期望 3：渐进式折叠 CSS（data-priority 按钮逐个折叠 + max-width 动画 + 版本号跟随）
  ok('CSS · 折叠用 max-width 动画（非 display:none）', /\.dsws-tabs \.dsws-tab\.collapsed > span:last-child,\.dsws-tabs \.dsws-btn\.collapsed > span:last-child\{max-width:0;opacity:0;margin-left:-4px;margin-right:-4px\}/.test(src))
  ok('CSS · 文字 span 有 max-width transition', /\.dsws-tabs \.dsws-tab > span:last-child,\.dsws-tabs \.dsws-btn > span:last-child\{max-width:120px;overflow:hidden;white-space:nowrap;transition:max-width \.25s ease,opacity \.2s ease,margin \.25s ease\}/.test(src))
  ok('CSS · collapsed 按钮 padding 收窄（保留 icon）', /\.dsws-tabs \.dsws-tab\.collapsed,\.dsws-tabs \.dsws-btn\.collapsed\{padding-left:6px;padding-right:6px;transition:padding \.25s ease\}/.test(src))
  ok('CSS · 无残留旧 dsws-tabs-l1/l2 display:none 规则', !/dsws-tabs-l1/.test(src) && !/dsws-tabs-l2/.test(src))
  ok('CSS · 无残留旧 dsws-tabs-fold 规则', !src.includes('.dsws-tabs-fold'))

  // 期望 4：等级决策函数
  ok('逻辑 · TABS_FOLD_HYST = 4 存在', /const TABS_FOLD_HYST = 4/.test(src))
  ok('逻辑 · TABS_LEVELS = 3 存在', /const TABS_LEVELS = 3/.test(src))
  ok('逻辑 · tabsLevelDecide 存在', /const tabsLevelDecide = function/.test(src))

  // 期望 5：装配（tabsRef × 2 + 渐进折叠 applyFold + dataset）
  const tabsRefN = (src.match(/const tabsRef = React\.useRef\(null\)/g) || []).length
  ok('逻辑 · tabsRef 出现 2 次（dock + overlay）', tabsRefN === 2)
  ok('逻辑 · ref: tabsRef 挂到 2 个 tabs 容器', (src.match(/className: 'dsws-tabs', ref: tabsRef/g) || []).length === 2)
  ok('逻辑 · applyFold 定义 ≥2 次（dock + overlay；#16 V2 胶囊另有 1 个）', (src.match(/const applyFold = function/g) || []).length >= 2)
  ok('逻辑 · 全展开 + 强制 reflow 起步', /classList\.remove\('collapsed'\)/.test(src) && /void t\.offsetWidth/.test(src))
  ok('逻辑 · 按 priority 降序逐个折叠（大者先折叠）', /\.sort\(function \(a, b\) \{ return b\.p - a\.p \}\)/.test(src))
  ok('逻辑 · 折叠到放得下为止（scrollWidth ≤ clientWidth）', /t\.scrollWidth <= t\.clientWidth \+ 1/.test(src))
  ok('逻辑 · 版本号跟随 priority=3 折叠', /ver\.classList\.toggle\('collapsed', !!refreshCollapsed\)/.test(src))
  ok('逻辑 · 折叠结果写 dataset.tabsLevel', /t\.dataset\.tabsLevel = String\(t\.querySelectorAll\('\[data-priority\]\.collapsed'\)\.length\)/.test(src))
  ok('逻辑 · ResizeObserver + resize + fonts.ready 重算', /new ResizeObserver\(function \(\) \{ applyFold\(\) \}\)/.test(src) && /window\.addEventListener\('resize', apply\)/.test(src) && /document\.fonts\.ready\.then\(apply\)/.test(src))
  ok('逻辑 · RO 观察到元素被替换时重观察（observed !== t → unobserve+observe）', /ro && observed !== t/.test(src) && /ro\.observe\(t\)/.test(src))
  ok('逻辑 · tabBtn 带 data-priority 参数', /const tabBtn = \(id, icon, label, priority\)/.test(src))
  ok('逻辑 · 6 个按钮均有 data-priority（列表4/技能5/环境6/需求2/bug1/刷新3）', (src.match(/data-priority/g) || []).length >= 12)

  // 期望 5b：悬浮提示（portal Tooltip 替代 title）
  ok('提示 · tabTip 状态存在', /const \[tabTip, setTabTip\] = React\.useState\(null\)/.test(src))
  ok('提示 · portalTooltip 渲染（zIndex 2147483000）', /tabTip && portalTop\) \? portalTop\(/.test(src) && /zIndex: 2147483000/.test(src))
  ok('提示 · tabsTip 带 priority 门控（自身折叠才显示）', /const tabsTip = function \(e, text, priority\)/.test(src) && /btn\.classList\.contains\('collapsed'\)/.test(src))
  ok('提示 · 动作按钮传各自 priority（bug=1/需求=2/刷新=3）', /tabsTip\(e, tr\('panel\.newWayfinderTitle'\), 2\)/.test(src) && /tabsTip\(e, tr\('panel\.newBugTitle'\), 1\)/.test(src) && /tabsTip\(e, tr\('list\.refresh'\), 3\)/.test(src))
  ok('提示 · tabBtn 传 priority 参数', /tabsTip\(e, label, priority\)/.test(src))
  ok('提示 · onMouseLeave 清除', (src.match(/onMouseLeave: tabsTipOff/g) || []).length >= 4)
  ok('提示 · 原生 title 已从动作按钮移除', !/title: tr\('panel\.(newWayfinderTitle|newBugTitle)'\)/.test(src))
  ok('提示 · 原生 title 已从 tabBtn 移除', !/title: label, className: 'dsws-tab'/.test(src))

  // 期望 6：hook 顺序合法（Overlay）
  const oi = src.indexOf('const panelRef = React.useRef(null)')
  const ti1 = src.indexOf('const tabsRef = React.useRef(null)')
  const ti2 = src.indexOf('const tabsRef = React.useRef(null)', ti1 + 1)
  const ret = src.indexOf('if (!s.open) return null')
  ok('hook 顺序 · overlay tabsRef 声明在 early-return 之前', oi >= 0 && ret > 0 && ti2 > 0 && oi < ti2 && ti2 < ret)
  ok('hook 顺序 · overlay effect 依赖 [s.open]', /React\.useEffect\(function \(\) \{[\s\S]*?\}, \[s\.open\]\)/.test(src))
}

// ---- Part B：行为契约 —— tabsLevelDecide 真值表 ----
const behaviorChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const m = src.match(/const tabsLevelDecide = function[\s\S]*?\n\s*\}/)
  if (!m) throw new Error(tag + ' · tabsLevelDecide 提取失败')
  const fnSrc = m[0].replace(/^const tabsLevelDecide\s*=\s*/, '')
  const fn = new Function('TABS_FOLD_HYST', 'return (' + fnSrc + ')')(4)
  const N = [440, 300, 220] // 模拟：L0 短文案自然宽 440 / L1 图标 300 / L2 tab 图标 220
  const cases = [
    // [level, avail, nats, expect, desc]
    [0, 500, N, 0, '宽裕 → 保持 L0（短文案全显）'],
    [0, 400, N, 1, 'L0 放不下 → L1（动作按钮转图标）'],
    [0, 350, N, 1, 'L1 放得下且 L0 不够 → L1'],
    [0, 280, N, 2, 'L1 也不够 → L2（tab 转图标）'],
    [0, 80, N, 2, '极窄 → 顶格 L2'],
    [1, 500, N, 0, 'L1 且空间回够（≥L0+4）→ 降回 L0'],
    [1, 430, N, 1, '滞回带内（<L0+4）→ 保持 L1 防抖'],
    [1, 444, N, 0, '恰好 L0+4 → 降回 L0'],
    [2, 350, N, 1, 'L2 且空间够 L1(+4) → 降回 L1（tab 文字恢复）'],
    [2, 500, N, 0, 'L2 且空间够 L0 → 回 L0'],
    [2, 280, N, 2, 'L2 依旧放不下 → 保持 L2'],
    [0, 400, [], 0, 'nats 空保护 → 0'],
  ]
  for (const [lv, avail, nats, expect, desc] of cases) {
    const r = fn(lv, avail, nats)
    ok('行为 · tabsLevelDecide(' + [lv, avail, 'nats'].join(',') + ') = ' + r + '（' + desc + '）', r === expect)
  }
}

// ---- Part C（T5 #98 已移除）：双源镜像同步由一源两物构建保证 ----
// 保留 Part A/B 静态与行为契约对单产物的校验

const main = function () {
  let failed = false
  const sources = {}
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    sources[tag] = src
    try { statChecks(src, tag); behaviorChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' — ' + e.message) }
  }
  // Part C 已移除（T5 #98）
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
