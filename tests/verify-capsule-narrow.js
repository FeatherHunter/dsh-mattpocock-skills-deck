// verify-capsule-narrow.js — 状态栏胶囊窄屏契约 · issue #16（V2：内容自适应渐进收缩）
// 用法: node tests/verify-capsule-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// V2 契约（2026-08-18 复现后重设计，替代 R1-R13 的 data-narrow 阈值体系）：
//   1) 任何宽度下胶囊禁止换行：.dsws-capsule CSS 含 flex-wrap:nowrap 且不含 flex-wrap:wrap
//   2) 留 gap，center 居中；children flex:none 不被挤压
//   3) 内容自适应渐进收缩（仿 #15）：每个可收缩文字 span 打 data-fold-priority（1=最先收…9=最后收），
//      applyFold 全展开后按 priority 升序逐个加 .dsws-folded，直到 scrollWidth ≤ clientWidth
//      - 优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)
//      - 图标+数字永不收缩；最窄态 = 图标+数字紧凑条
//   4) 点击事件契约：capsule→openPanel / capsule-word→togglePanel / seg/split/timebtn→各自 handler
//   5) EN locale：i18n 键齐备（panel.title 中英同字 "MattSkills"）
//   6) 双源同步：client.js ↔ package/lib/client.js 的 capsule CSS 块 + JSX 块一致
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：CSS / JS 静态契约（双源同步） ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：胶囊禁止换行 + 跟随输入区宽
  ok('胶囊 .dsws-capsule CSS 含 flex-wrap:nowrap', /\.dsws-capsule\s*\{[^}]*flex-wrap:nowrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 不含 flex-wrap:wrap', !/\.dsws-capsule\s*\{[^}]*flex-wrap:wrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 含 white-space:nowrap（防御性单行）', /\.dsws-capsule\s*\{[^}]*white-space:nowrap/.test(src))
  ok('胶囊 .dsws-capsule CSS max-width 用 100%（跟随输入区宽，非 96vw）', /\.dsws-capsule\s*\{[^}]*max-width:\s*min\(100%,\s*1400px\)/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 max-width:min(96vw, ...) （旧 R1 行为已弃）', !/\.dsws-capsule\s*\{[^}]*max-width:\s*min\(96vw/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 margin:0 auto（外层 wrapper 负责居中）', !/\.dsws-capsule\s*\{[^}]*margin:\s*0\s+auto/.test(src))
  ok('外层 wrapper display:flex + flex:\'none\' + justify-content:center 居中胶囊', /display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center'/.test(src))
  ok('外层 wrapper width:100% 跟输入区容器宽', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,80}width:\s*'100%'/.test(src))
  ok('外层 wrapper boxSizing:border-box 防 padding 撑破', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,200}boxSizing:\s*'border-box'/.test(src))
  ok('外层 wrapper 正常路径 overflow:hidden 截 capsule 溢出，缺 ReactDOM 时 visible 降级保留浮层可用性', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,250}overflow:\s*RDOM\s*\?\s*'hidden'\s*:\s*'visible'/.test(src))
  ok('胶囊 CSS 不再加 overflow:hidden（让 capsule 圆角背景完整，圆角处不漏白）', !/\.dsws-capsule\s*\{[^}]*overflow:\s*hidden/.test(src))
  // 期望 2：children 保持 flex:none + gap 居中
  ok('children 仍 flex:none（capsule-word / seg / timebtn）', /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-seg\{flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-timebtn\{flex:none/.test(src))
  ok('胶囊 gap 保留 2px 6px（行间距 / 列间距）', /\.dsws-capsule\s*\{[^}]*gap:\s*2px\s+6px/.test(src))
  ok('胶囊 justify-content:center 保留', /\.dsws-capsule\s*\{[^}]*justify-content:\s*center/.test(src))

  // 期望 3（V2）：内容自适应渐进收缩
  // 3a. CSS 折叠规则：一条规则命中所有带 data-fold-priority 且被加 .dsws-folded 的文字 span
  ok('V2 · CSS 折叠规则 [data-fold-priority].dsws-folded{display:none}', /'\.dsws-capsule \[data-fold-priority\]\.dsws-folded\{display:none\}'/.test(src))
  // 3b. 9 个文字 span 的 priority 绑定（信息价值 1→9）：
  //     品牌(1) 沉淀(2) 交接(3) 刷新字(4) 可接(5) BUG(6) 诊断(7) 环境(8) 时间(9)
  const prio = function (n, re) { return ok('V2 · priority=' + n + ' 绑定 ' + (re.source || re), re.test(src)) }
  prio(1, /'data-fold-priority':\s*1[\s\S]{0,40}tr\('panel\.title'\)/)
  prio(2, /'data-fold-priority':\s*2[\s\S]{0,40}tr\('nav\.word'\)/)
  prio(3, /'data-fold-priority':\s*3[\s\S]{0,40}tr\('nav\.handoff'\)/)
  prio(4, /'data-fold-priority':\s*4[\s\S]{0,40}tr\('nav\.refresh'\)/)
  prio(5, /'data-fold-priority':\s*5[\s\S]{0,40}tr\('nav\.takeable'\)/)
  prio(6, /'data-fold-priority':\s*6[\s\S]{0,40}tr\('nav\.bug'\)/)
  prio(7, /'data-fold-priority':\s*7[\s\S]{0,40}tr\('nav\.triage'\)/)
  prio(8, /'data-fold-priority':\s*8[\s\S]{0,40}tr\('nav\.env'\)/)
  prio(9, /'data-fold-priority':\s*9[\s\S]{0,40}timeStr/)
  // 3c. applyFold 核心模式：全展开重算 + scrollWidth 溢出判定 + priority 升序逐个收
  ok('V2 · applyFold 函数存在（全展开 → 逐个收）', /const applyFold = function\s*\(\)\s*\{/.test(src))
  ok('V2 · applyFold 先全展开（remove dsws-folded + reflow）', /classList\.remove\(['"]dsws-folded['"]\)[\s\S]{0,120}void cap\.offsetWidth/.test(src))
  ok('V2 · applyFold 按 priority 升序排序（小=先收）', /sort\(function \(a, b\) \{ return a\.p - b\.p \}\)/.test(src))
  ok('V2 · applyFold 溢出判定 scrollWidth ≤ clientWidth+1 停止', /scrollWidth\s*<=\s*cap\.clientWidth\s*\+\s*1/.test(src))
  ok('V2 · applyFold 加 .dsws-folded 后强制 reflow', /classList\.add\(['"]dsws-folded['"]\)[\s\S]{0,80}void cap\.offsetWidth/.test(src))
  ok('V2 · applyFold 记录 dataset.fold 折叠数（调试/测试锚点）', /cap\.dataset\.fold\s*=\s*String\(/.test(src))
  // 3d. foldRef 挂 capsule + ResizeObserver 监听
  ok('V2 · capsule 根挂 ref: foldRef', /className:\s*['"]dsws-capsule['"][^}]*ref:\s*foldRef/.test(src))
  ok('V2 · foldRef = React.useRef(null)', /foldRef\s*=\s*React\.useRef\(null\)/.test(src))
  ok('V2 · ResizeObserver 监听 foldRef.current 触发 applyFold', /new ResizeObserver\(function\s*\(\)\s*\{\s*applyFold\(\)\s*\}\)[\s\S]{0,200}roFold\.observe\(foldRef\.current\)/.test(src))
  ok('V2 · window resize 触发 applyFold（实时响应）', /window\.addEventListener\(['"]resize['"],\s*applyAll\)/.test(src))
  ok('V2 · fonts.ready 后重测（防字体宽差误判）', /document\.fonts\.ready\.then\(applyFold\)/.test(src))

  // 3e. 旧 data-narrow 阈值体系清除（防双体系并存误导）
  ok('V2 · 旧 [data-narrow-N] CSS 选择器已删', !/\[data-narrow-[1-4]\]/.test(src))
  ok('V2 · JSX 不再写 data-narrow 属性', !/['"]data-narrow['"]?\s*:\s*dn/.test(src))
  ok('V2 · 不再有 let dn 阈值计算', !/let dn = 0/.test(src))
  // 注：DetailsDock（#15 面板列宽）自有 [dw,setDw]，不在此处断言（非 StatusBar 胶囊体系）

  // 期望（R13 对齐 - 第一性原理 B）：胶囊与输入卡同源，不再 JS 量像素
  // 旧 R13 iw 已退休，改为 CSS 变量驱动：width:100% + max-width:var(--dsh-composer-card-max-width)
  ok('R13 · 胶囊 CSS 默认 width:100%（撑满 wrapper=输入区）', /\.dsws-capsule\{[^}]*width:100%/.test(src))
  ok('R13 · 胶囊 CSS box-sizing:border-box', /\.dsws-capsule\{[^}]*box-sizing:border-box/.test(src))
  ok('R13 · 胶囊 CSS max-width 复用宿主变量 --dsh-composer-card-max-width（与输入卡同源）', /--dsh-composer-card-max-width/.test(src))
  ok('R13 · inline 胶囊 width:100%（不再用 iw 像素）', /className:\s*['"]dsws-capsule['"][\s\S]{0,120}width:\s*'100%'/.test(src))
  ok('R13 · inline 不再含 iw 像素（旧方案已退休）', !/width:\s*iw\s*\+\s*'px'/.test(src))
  ok('R13 · 旧 fit-content 弃用', !/\.dsws-capsule\{[^}]*width:fit-content/.test(src) && !/style:\s*\{[^}]*width:\s*'fit-content'/.test(src))
  ok('R9 · 第一性原理：不再查询特定 textarea 类名（已去耦）', !/textarea\.uV2eYG_input/.test(src))
  ok('R9 · ResizeObserver 监听 foldRef 及其 parent（可用宽变化即折叠）', /new ResizeObserver\(function\s*\(\)\s*\{\s*applyFold\(\)\s*\}\)[\s\S]{0,300}roFold\.observe\(foldRef\.current\)/.test(src) && /roParent\.observe/.test(src))
  ok('R9 · useEffect 清理断开 roFold/roParent（防泄漏）', /roFold\.disconnect\(\)[\s\S]{0,120}roParent\.disconnect\(\)/.test(src))
  ok('R9 · 轮询兜底保留（字体/宿主重排）', /setInterval\(applyAll, 2000\)/.test(src))
  ok('R12 · !firstBlock 分支 wrapper 含 flex:\'none\'（防 flex-shrink 压矮）', /display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center'/.test(src))
  ok('R12 · firstBlock 分支 wrapper 含 flex:\'none\'（横幅 + 胶囊列布局同样防压缩）', /display:\s*'flex',\s*flex:\s*'none',\s*flexDirection:\s*'column'/.test(src))
  ok('R6b · !firstBlock 分支 wrapper 不再含 alignItems:\'stretch\'', !/display:\s*'flex',\s*justifyContent:\s*'center'[\s\S]{0,200}alignItems:\s*'stretch'/.test(src))

  // 期望 4：点击事件契约
  ok('capsule onClick → openPanel(s)', /className:\s*['"]dsws-capsule['"][^}]*onClick:\s*function\s*\(\)\s*\{\s*openPanel\(s\)/.test(src))
  ok('capsule-word onClick → togglePanel(s) + stopPropagation', /className:\s*['"]dsws-capsule-word['"][^}]*onClick:[^}]*togglePanel\(s\)/.test(src) && /className:\s*['"]dsws-capsule-word['"][^}]*e\.stopPropagation/.test(src))
  ok('seg onClick → e.stopPropagation + onGo()', /className:\s*['"]dsws-seg['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-seg['"][^}]*onGo\(\)/.test(src))
  ok('timebtn onClick → e.stopPropagation + refreshAll(s)', /className:\s*['"]dsws-timebtn['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-timebtn['"][^}]*refreshAll\(s\)/.test(src))

  // 期望 5：EN locale i18n 键齐备
  const extractLocaleBlock = function (s, lang) {
    const re = new RegExp("\\b" + lang + ":\\s*\\{[\\s\\S]*?\\n\\s*\\}", 'm')
    return (s.match(re) || [''])[0]
  }
  const zhBlock = extractLocaleBlock(src, 'zh')
  const enBlock = extractLocaleBlock(src, 'en')
  ok('i18n 字典存在 zh 块（zh: { ... }）', !!zhBlock)
  ok('i18n 字典存在 en 块（en: { ... }）', !!enBlock)
  ok('panel.title zh = "MattSkills"', /'panel\.title':\s*'MattSkills'/.test(zhBlock))
  ok('panel.title en = "MattSkills"（中英同字）', /'panel\.title':\s*'MattSkills'/.test(enBlock))
  ok('nav.triage zh = "诊断"（与诊断段一致，非 "待分诊"）', /'nav\.triage':\s*'诊断'/.test(zhBlock))
  ok('nav.triage en = "Triage"', /'nav\.triage':\s*'Triage'/.test(enBlock))
  ok('nav.word zh = "沉淀"', /'nav\.word':\s*'沉淀'/.test(zhBlock))
  ok('nav.refresh zh = "更新"', /'nav\.refresh':\s*'更新'/.test(zhBlock))
  ok('nav.takeable / nav.bug / nav.triage / nav.env / nav.refresh / nav.handoff 键齐',
    /'nav\.takeable'/.test(src) && /'nav\.bug'/.test(src) && /'nav\.triage'/.test(src) &&
    /'nav\.env'/.test(src) && /'nav\.refresh'/.test(src) && /'nav\.handoff'/.test(src))
}

// ---- Part B（T5 #98 已移除）：双源镜像同步由一源两物构建保证，不再断言双源 byte-for-byte 一致 ----
// 保留 Part A/C/D 对单产物的契约校验，足以覆盖胶囊视图契约

// ---- Part C：行为契约 —— priority 映射表语义（纯静态重算，与代码同表） ----
const behaviorCheck = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  // 信息价值顺序（1=最先收）：品牌 → 无数字操作段（沉淀/交接/刷新字）→ 有数字监控段（可接/BUG/诊断/环境）→ 时间
  // 断言：priority 升序 = 上述顺序；且 1..9 全部出现且唯一
  const prios = []
  for (let p = 1; p <= 9; p++) {
    const re = new RegExp("'data-fold-priority':\\s*" + p + "\\b")
    const m = src.match(new RegExp("'data-fold-priority':\\s*" + p + "\\b", 'g'))
    if (!m) throw new Error('priority=' + p + ' 缺失')
    if (m.length !== 1) throw new Error('priority=' + p + ' 出现 ' + m.length + ' 次（应唯一）')
    prios.push(p)
  }
  ok('V2 · 9 个 data-fold-priority 全部存在且唯一（1..9）', prios.length === 9)
  // 语义表：每个 priority 对应的文案来源（tr 键 / 时间戳），确保顺序与「信息价值」一致
  const sem = [
    { p: 1, re: /'data-fold-priority':\s*1[\s\S]{0,50}panel\.title/, d: '品牌 MattSkills（纯装饰，最先收）' },
    { p: 2, re: /'data-fold-priority':\s*2[\s\S]{0,50}nav\.word/, d: '沉淀（无数字操作段）' },
    { p: 3, re: /'data-fold-priority':\s*3[\s\S]{0,50}nav\.handoff/, d: '交接（无数字操作段）' },
    { p: 4, re: /'data-fold-priority':\s*4[\s\S]{0,60}nav\.refresh/, d: '刷新字（无数字操作段）' },
    { p: 5, re: /'data-fold-priority':\s*5[\s\S]{0,50}nav\.takeable/, d: '可接（监控标签，数字保留）' },
    { p: 6, re: /'data-fold-priority':\s*6[\s\S]{0,50}nav\.bug/, d: 'BUG（监控标签，数字保留）' },
    { p: 7, re: /'data-fold-priority':\s*7[\s\S]{0,50}nav\.triage/, d: '诊断（监控标签，数字保留）' },
    { p: 8, re: /'data-fold-priority':\s*8[\s\S]{0,50}nav\.env/, d: '环境（监控标签，数字保留）' },
    { p: 9, re: /'data-fold-priority':\s*9[\s\S]{0,60}timeStr/, d: '刷新时间（纯参考，最后收）' },
  ]
  for (const s of sem) {
    if (!s.re.test(src)) throw new Error('priority=' + s.p + ' 语义不符（' + s.d + '）')
    console.log('  PASS ' + tag + ' · V2 · priority=' + s.p + ' → ' + s.d)
  }
}

// ---- Part D：DOM 模拟点击（期望行为 4：实际跑 handler 函数体，验证 stopPropagation + 路由） ----
const domSimCheck = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const findHandler = function (re) {
    const m = src.match(re)
    return m ? m[1] : null
  }
  const capBody = findHandler(/onClick:\s*function\s*\(\)\s*\{\s*(openPanel\(s\))\s*\}/)
  const cwBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*togglePanel\(s\))\s*\}/)
  const segBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*onGo\(\))\s*\}/)
  const tbBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*refreshAll\(s\))\s*\}/)
  if (!capBody) throw new Error('capsule onClick handler 提取失败')
  if (!cwBody) throw new Error('capsule-word onClick handler 提取失败')
  if (!segBody) throw new Error('seg onClick handler 提取失败')
  if (!tbBody) throw new Error('timebtn onClick handler 提取失败')

  const runHandler = function (body, ctx) {
    const fn = new Function('s', 'e', 'openPanel', 'togglePanel', 'onGo', 'refreshAll', body)
    return fn(ctx.s, ctx.e, ctx.openPanel, ctx.togglePanel, ctx.onGo, ctx.refreshAll)
  }
  const makeEvent = () => ({ stopped: false, stopPropagation: function () { this.stopped = true } })
  const calls = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
  const st = { tag: 'fixture' }

  const r1 = runHandler(capBody, { s: st, openPanel: function (s) { calls.openPanel++; if (s !== st) throw new Error('openPanel 收到的 s 不一致') } })
  ok('点击胶囊空白 → openPanel(s) 触发 1 次', calls.openPanel === 1 && calls.togglePanel === 0 && calls.onGo === 0 && calls.refreshAll === 0)

  calls.openPanel = 0
  const e2 = makeEvent()
  const r2 = runHandler(cwBody, { s: st, e: e2, togglePanel: function (s) { calls.togglePanel++; if (s !== st) throw new Error('togglePanel 收到的 s 不一致') } })
  ok('点击 capsule-word → togglePanel(s) 触发 1 次 + stopPropagation 已调用',
    calls.togglePanel === 1 && e2.stopped === true)
  ok('点击 capsule-word → 没有冒泡到 openPanel', calls.openPanel === 0)

  calls.togglePanel = 0
  const e3 = makeEvent()
  const r3 = runHandler(segBody, { s: st, e: e3, onGo: function () { calls.onGo++ } })
  ok('点击 seg → onGo() 触发 1 次 + stopPropagation 已调用',
    calls.onGo === 1 && e3.stopped === true)

  calls.onGo = 0
  const e4 = makeEvent()
  const r4 = runHandler(tbBody, { s: st, e: e4, refreshAll: function (s) { calls.refreshAll++; if (s !== st) throw new Error('refreshAll 收到的 s 不一致') } })
  ok('点击 timebtn → refreshAll(s) 触发 1 次 + stopPropagation 已调用',
    calls.refreshAll === 1 && e4.stopped === true)

  const verifyIsolation = function (handlerName, body, expectedStub) {
    const calls2 = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
    const stubs = {
      openPanel: function () { calls2.openPanel++ },
      togglePanel: function () { calls2.togglePanel++ },
      onGo: function () { calls2.onGo++ },
      refreshAll: function () { calls2.refreshAll++ }
    }
    runHandler(body, { s: st, e: makeEvent(), openPanel: stubs.openPanel, togglePanel: stubs.togglePanel, onGo: stubs.onGo, refreshAll: stubs.refreshAll })
    for (const k of ['openPanel', 'togglePanel', 'onGo', 'refreshAll']) {
      const shouldBe = (k === expectedStub) ? 1 : 0
      if (calls2[k] !== shouldBe) {
        throw new Error(handlerName + ' handler 路由泄漏：' + k + ' 被调用 ' + calls2[k] + ' 次，应为 ' + shouldBe)
      }
    }
  }
  verifyIsolation('capsule', capBody, 'openPanel')
  ok('handler 路由隔离：capsule 只调 openPanel（其他函数 0 次）', true)
  verifyIsolation('capsule-word', cwBody, 'togglePanel')
  ok('handler 路由隔离：capsule-word 只调 togglePanel（其他函数 0 次）', true)
  verifyIsolation('seg', segBody, 'onGo')
  ok('handler 路由隔离：seg 只调 onGo（其他函数 0 次）', true)
  verifyIsolation('timebtn', tbBody, 'refreshAll')
  ok('handler 路由隔离：timebtn 只调 refreshAll（其他函数 0 次）', true)
}

const main = async function () {
  let failed = false
  const sources = {}
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    sources[tag] = src
    console.log('-- Part A 静态契约 --')
    try { statChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part A — ' + e.message); continue }
    console.log('-- Part C 行为契约（priority 语义表）--')
    try { behaviorCheck(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part C — ' + e.message); continue }
    console.log('-- Part D DOM 模拟点击（期望行为 4）--')
    try { domSimCheck(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part D — ' + e.message); continue }
  }
  // Part B 已移除（T5 #98）—— 双源镜像由构建保证
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()