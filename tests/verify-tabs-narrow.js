// verify-tabs-narrow.js — 面板 tabs 行窄屏单行 + 折叠为纯图标 · issue #15
// 用法: node tests/verify-tabs-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #15 + grilling 收口）：
//   1) 任何宽度下 tabs 行保持单行：.dsws-tabs 含 flex-wrap:nowrap（无 wrap）+ overflow:hidden + white-space:nowrap；
//      .dsws-tab 含 white-space:nowrap + flex:none（不被挤压）。
//   2) 内容放不下（自然宽 > 可用宽）→ 折叠为纯图标：折叠态隐藏 tab 文字 span / 动作按钮文字 span / 版本号。
//   3) 折叠判定用内容自适应 + 滞回防抖（tabsFoldDecide + TABS_FOLD_HYST=4），避免临界抖动。
//   4) 两处渲染（dock + overlay）都装配：tabsRef 2 处、ref: tabsRef 2 处、classList.toggle 驱动。
//   5) hook 合法性：OverlayPanel 的 tabsRef/effect 在 `if (!s.open) return null` 之前（hooks 顺序稳定），effect 依赖 [s.open]。
//   6) 行为契约：tabsFoldDecide 真值表（含 +1 模糊与 +4 滞回边界）。
//   7) 双源镜像同步：.dsws-tab CSS 块 + tabs 容器 JSX 块 byte-for-byte 等价。
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：CSS / JS 静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：单行基础
  const tabsCss = (src.match(/\.dsws-tabs\{[^}]*\}/) || ['' ])[0]
  ok('CSS · .dsws-tabs 含 flex-wrap:nowrap', /flex-wrap:nowrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 不含 flex-wrap:wrap', !/flex-wrap:wrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 overflow:hidden（溢出守卫）', /overflow:hidden/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 white-space:nowrap（防御性单行）', /white-space:nowrap/.test(tabsCss))
  const tabCss = (src.match(/\.dsws-tab\{[^}]*\}/) || [''])[0]
  ok('CSS · .dsws-tab 含 white-space:nowrap', /white-space:nowrap/.test(tabCss))
  ok('CSS · .dsws-tab 含 flex:none（不被挤压）', /flex:none/.test(tabCss))

  // 期望 2：折叠态隐藏文字（保留图标）
  ok('CSS · 折叠隐藏 tab 文字 .dsws-tab > span:last-child', /\.dsws-tabs\.dsws-tabs-fold \.dsws-tab > span:last-child\{display:none\}/.test(src))
  ok('CSS · 折叠隐藏动作按钮 .dsws-btn > span:last-child', /\.dsws-tabs\.dsws-tabs-fold \.dsws-btn > span:last-child\{display:none\}/.test(src))
  ok('CSS · 折叠隐藏版本号 > span:last-child', /\.dsws-tabs\.dsws-tabs-fold > span:last-child\{display:none\}/.test(src))

  // 期望 3：决策函数 + 滞回
  ok('逻辑 · TABS_FOLD_HYST = 4 存在', /const TABS_FOLD_HYST = 4/.test(src))
  ok('逻辑 · tabsFoldDecide 存在', /const tabsFoldDecide = function/.test(src))

  // 期望 4：两处渲染装配
  const tabsRefN = (src.match(/const tabsRef = React\.useRef\(null\)/g) || []).length
  ok('逻辑 · tabsRef 出现 2 次（dock + overlay）', tabsRefN === 2)
  ok('逻辑 · ref: tabsRef 挂到 2 个 tabs 容器', (src.match(/className: 'dsws-tabs', ref: tabsRef/g) || []).length === 2)
  ok('逻辑 · tabBtn 带 title: label（折叠纯图标时可发现性）', (src.match(/\btitle: label,\s*className: 'dsws-tab'/g) || []).length === 2)
  ok('逻辑 · 折叠由 tabsFoldDecide 驱动 classList.toggle', /classList\.toggle\('dsws-tabs-fold', tabsFoldDecide\(/.test(src))
  ok('逻辑 · 度量用 scrollWidth / clientWidth（自然宽 vs 可用宽）', /if \(!folded\) naturalW = t\.scrollWidth/.test(src) && /t\.clientWidth/.test(src))
  ok('逻辑 · ResizeObserver + window.resize + fonts.ready 重算', /new ResizeObserver\(apply\)/.test(src) && /window\.addEventListener\('resize', apply\)/.test(src) && /document\.fonts\.ready\.then\(apply\)/.test(src))

  // 期望 5：hook 顺序合法性（OverlayPanel）
  const oi = src.indexOf('const panelRef = React.useRef(null)')
  const ti1 = src.indexOf('const tabsRef = React.useRef(null)')
  const ti2 = src.indexOf('const tabsRef = React.useRef(null)', ti1 + 1)
  const ret = src.indexOf('if (!s.open) return null')
  ok('hook 顺序 · overlay tabsRef 声明在 early-return 之前', oi >= 0 && ret > 0 && ti2 > 0 && oi < ti2 && ti2 < ret)
  ok('hook 顺序 · overlay effect 依赖 [s.open]（打开时重算）', /React\.useEffect\(function \(\) \{[\s\S]*?\}, \[s\.open\]\)/.test(src))
}

// ---- Part B：行为契约 —— tabsFoldDecide 真值表 ----
const behaviorChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const m = src.match(/const tabsFoldDecide = function[\s\S]*?\n\s*\}/)
  if (!m) throw new Error(tag + ' · tabsFoldDecide 提取失败')
  // 源文本是 `const NAME = function(...) {...}`：剥掉 `const NAME = ` 前缀即可得纯函数表达式
  const fnSrc = m[0].replace(/^const tabsFoldDecide\s*=\s*/, '')
  const fn = new Function('TABS_FOLD_HYST', 'return (' + fnSrc + ')')(4)
  const cases = [
    // [fold, avail, natural, expect, desc]
    [false, 500, 470, false, '宽裕 → 不折叠（文本显示）'],
    [false, 471, 470, false, '仅 1px 超（+1 模糊内）→ 不折叠'],
    [false, 470, 470, false, '恰好相等 → 不折叠'],
    [false, 469, 470, false, '1px 溢出容忍 → 不折叠'],
    [false, 468, 470, true, '≥2px 溢出 → 折叠'],
    [false, 460, 470, true, '明显放不下 → 折叠'],
    [true, 200, 470, true, '折叠态窄宽 → 保持折叠'],
    [true, 473, 470, true, '滞回内（< +4）→ 保持折叠'],
    [true, 474, 470, false, '滞回达到 +4 → 展开'],
    [false, 500, 0, false, 'natural<=0 保护 → 不折叠'],
    [true, 0, 0, false, 'natural<=0 保护（折叠态）→ 展开'],
  ]
  for (const [fold, avail, natural, expect, desc] of cases) {
    const r = fn(fold, avail, natural)
    ok('行为 · tabsFoldDecide(' + [fold, avail, natural].join(',') + ') = ' + r + '（' + desc + '）', r === expect)
  }
}

// ---- Part C：双源镜像同步 ----
const extractTabsCss = function (src) {
  const re = /'(\.[^']*dsws-tab[^']*\{[^}]*\})'/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out.sort().join('\n')
}
// 抽取 tabs 容器 JSX：从 h('div', { className: 'dsws-tabs' 起，括号平衡到 0 收尾
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
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--
        if (depth === 0) { j++; break }
      }
    }
    const block = src.slice(open, j)
    // 注释逐行剔除（两源注释存在既有漂移，契约只约束代码结构）
    out.push(block.split(/\r?\n/).filter(function (l) { return !/^\s*\/\//.test(l) }).join('\n').replace(/^[ \t]+/gm, ''))
  }
  return out.sort().join('\n=====\n')
}
// 抽取折叠驱动 effect 块（含 dsws-tabs-fold 的 React.useEffect）—— 双源镜像
const extractFoldEffects = function (src) {
  const out = []
  let idx = 0
  while ((idx = src.indexOf('React.useEffect(function () {', idx)) >= 0) {
    // 定位该 effect 的结束 `}, [..])`
    const endM = src.indexOf('}, [', idx)
    if (endM < 0) break
    const close = src.indexOf('])', endM)
    if (close < 0) break
    const block = src.slice(idx, close + 2)
    if (block.includes('dsws-tabs-fold')) out.push(block.replace(/^[ \t]+/gm, '').replace(/\r\n/g, '\n'))
    idx = close + 2
  }
  return out.sort().join('\n=====\n')
}

const mirrorCheck = function (srcA, srcB) {
  const aCss = extractTabsCss(srcA)
  const bCss = extractTabsCss(srcB)
  if (aCss !== bCss) throw new Error('双源 .dsws-tab CSS 块不一致（client.js ↔ package/lib/client.js）\n--- 源 ---\n' + aCss + '\n--- 镜像 ---\n' + bCss)
  console.log('  PASS mirror · .dsws-tab CSS 块双源等价（共 ' + aCss.split('\n').length + ' 条规则）')
  const aJsx = extractTabsJsx(srcA)
  const bJsx = extractTabsJsx(srcB)
  if (aJsx === '' || bJsx === '') throw new Error('双源 tabs 容器 JSX 提取失败')
  if (aJsx !== bJsx) throw new Error('双源 tabs 容器 JSX 块不一致（去缩进后）\n--- 源 ---\n' + aJsx + '\n--- 镜像 ---\n' + bJsx)
  console.log('  PASS mirror · tabs 容器 JSX 双源去缩进等价（各 ' + ((aJsx.match(/=====/g) || []).length + 1) + ' 段）')
  const aFx = extractFoldEffects(srcA)
  const bFx = extractFoldEffects(srcB)
  if (aFx === '' || bFx === '') throw new Error('双源折叠 effect 块提取失败')
  if (aFx !== bFx) throw new Error('双源折叠 effect 块不一致（去缩进后）\n--- 源 ---\n' + aFx + '\n--- 镜像 ---\n' + bFx)
  console.log('  PASS mirror · 折叠 effect 块双源去缩进等价（各 ' + ((aFx.match(/=====/g) || []).length + 1) + ' 段）')
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
  } else {
    console.log('  SKIP mirror（双源未都加载）')
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
