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

  // 期望 3：分级折叠 CSS（L1 动作图标 / L2 tab 图标 / 版本号隐藏）
  ok('CSS · L1+L2 隐藏动作按钮文字 span:last-child', /\.dsws-tabs\.dsws-tabs-l1 \.dsws-btn > span:last-child,\.dsws-tabs\.dsws-tabs-l2 \.dsws-btn > span:last-child\{display:none\}/.test(src))
  ok('CSS · L2 隐藏 tab 文字 span:last-child', /\.dsws-tabs\.dsws-tabs-l2 \.dsws-tab > span:last-child\{display:none\}/.test(src))
  ok('CSS · L1+L2 隐藏版本号 > span:last-child', /\.dsws-tabs\.dsws-tabs-l1 > span:last-child,\.dsws-tabs\.dsws-tabs-l2 > span:last-child\{display:none\}/.test(src))
  ok('CSS · 无残留旧 dsws-tabs-fold 规则', !src.includes('.dsws-tabs-fold'))

  // 期望 4：等级决策函数
  ok('逻辑 · TABS_FOLD_HYST = 4 存在', /const TABS_FOLD_HYST = 4/.test(src))
  ok('逻辑 · TABS_LEVELS = 3 存在', /const TABS_LEVELS = 3/.test(src))
  ok('逻辑 · tabsLevelDecide 存在', /const tabsLevelDecide = function/.test(src))

  // 期望 5：装配（tabsRef × 2 + 度量 + dataset）
  const tabsRefN = (src.match(/const tabsRef = React\.useRef\(null\)/g) || []).length
  ok('逻辑 · tabsRef 出现 2 次（dock + overlay）', tabsRefN === 2)
  ok('逻辑 · ref: tabsRef 挂到 2 个 tabs 容器', (src.match(/className: 'dsws-tabs', ref: tabsRef/g) || []).length === 2)
  ok('逻辑 · 各级自然宽逐级测量（setLv + measureContentWidth）', /for \(let k = 0; k < TABS_LEVELS; k\+\+\) \{ setLv\(k\); nats\[k\] = measureContentWidth\(t\) \}/.test(src))
  ok('逻辑 · measureContentWidth 定义存在（内容真实宽，防 scrollWidth 容器钳制死锁）', /const measureContentWidth = function/.test(src))
  ok('逻辑 · 不再使用 scrollWidth 测自然宽（死锁根因）', !/nats\[k\] = t\.scrollWidth/.test(src))
  ok('逻辑 · 折叠结果写 dataset.tabsLevel', /t\.dataset\.tabsLevel = String\(next\)/.test(src))
  ok('逻辑 · ResizeObserver + resize + fonts.ready 重算', /new ResizeObserver\(function \(\) \{ apply\(\) \}\)/.test(src) && /window\.addEventListener\('resize', apply\)/.test(src) && /document\.fonts\.ready\.then\(apply\)/.test(src))
  ok('逻辑 · RO 观察到元素被替换时重观察（observed !== t → unobserve+observe）', /ro && observed !== t/.test(src) && /ro\.observe\(t\)/.test(src))

  // 期望 5b：悬浮提示（portal Tooltip 替代 title）
  ok('提示 · tabTip 状态存在', /const \[tabTip, setTabTip\] = React\.useState\(null\)/.test(src))
  ok('提示 · portalTooltip 渲染（zIndex 2147483000）', /tabTip && portalTop\) \? portalTop\(/.test(src) && /zIndex: 2147483000/.test(src))
  ok('提示 · tabsTip 带 minLevel 门控', /const tabsTip = function \(e, text, minLevel\)/.test(src))
  ok('提示 · 动作按钮 minLevel=1、tab 三键 minLevel=2', /tabsTip\(e, tr\('panel\.newWayfinderTitle'\), 1\)/.test(src) && /tabsTip\(e, label, 2\)/.test(src))
  ok('提示 · onMouseLeave 清除', (src.match(/onMouseLeave: tabsTipOff/g) || []).length >= 5)
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

// ---- Part C：双源镜像同步 ----
const extractTabsCss = function (src) {
  const re = /'((?:\.dsws-tabs|\.dsws-tab)[^']*\{[^}]*\})'/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out.sort().join('\n')
}
const extractTabsJsx = function (src) {
  const out = []
  let i = -1
  const all = []
  while ((i = src.indexOf("className: 'dsws-tabs'", i + 1)) >= 0) all.push(i)
  for (const pos of all) {
    const open = src.lastIndexOf('h(\'div\'', pos)
    if (open < 0) continue
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      const ch = src[j]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) { j++; break } }
    }
    const block = src.slice(open, j)
    out.push(block.split(/\r?\n/).filter(function (l) { return !/^\s*\/\//.test(l) }).join('\n').replace(/^[ \t]+/gm, ''))
  }
  return out.sort().join('\n=====\n')
}
const extractFoldEffects = function (src) {
  const out = []
  let idx = 0
  while ((idx = src.indexOf('React.useEffect(function () {', idx)) >= 0) {
    const endM = src.indexOf('}, [', idx)
    if (endM < 0) break
    const close = src.indexOf('])', endM)
    if (close < 0) break
    const block = src.slice(idx, close + 2)
    if (block.includes('tabsLevelDecide')) out.push(block.replace(/^[ \t]+/gm, '').replace(/\r\n/g, '\n'))
    idx = close + 2
  }
  return out.sort().join('\n=====\n')
}

const mirrorCheck = function (srcA, srcB) {
  const aCss = extractTabsCss(srcA), bCss = extractTabsCss(srcB)
  if (aCss !== bCss) throw new Error('双源 tabs CSS 块不一致（client.js ↔ package/lib/client.js）')
  console.log('  PASS mirror · tabs CSS 块双源等价（共 ' + aCss.split('\n').length + ' 条规则）')
  const aJsx = extractTabsJsx(srcA), bJsx = extractTabsJsx(srcB)
  if (aJsx === '' || bJsx === '') throw new Error('双源 tabs 容器 JSX 提取失败')
  if (aJsx !== bJsx) throw new Error('双源 tabs 容器 JSX 块不一致（去缩进/去注释后）')
  console.log('  PASS mirror · tabs 容器 JSX 双源等价（各 ' + ((aJsx.match(/=====/g) || []).length + 1) + ' 段）')
  const aFx = extractFoldEffects(srcA), bFx = extractFoldEffects(srcB)
  if (aFx === '' || bFx === '') throw new Error('双源折叠 effect 块提取失败')
  if (aFx !== bFx) throw new Error('双源折叠 effect 块不一致')
  console.log('  PASS mirror · 折叠 effect 块双源等价（各 ' + ((aFx.match(/=====/g) || []).length + 1) + ' 段）')
}

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
  console.log('-- Part C 双源镜像同步 --')
  if (sources.dyn && sources.npm) {
    try { mirrorCheck(sources.dyn, sources.npm) }
    catch (e) { failed = true; console.log('  FAIL mirror — ' + e.message) }
  } else console.log('  SKIP mirror')
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
