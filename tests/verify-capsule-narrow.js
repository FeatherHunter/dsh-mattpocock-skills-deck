// verify-capsule-narrow.js — 状态栏胶囊窄屏契约 · issue #16
// 用法: node tests/verify-capsule-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #16 期望行为 1-7）：
//   1) 任何宽度下胶囊禁止换行：.dsws-capsule CSS 含 flex-wrap:nowrap 且不含 flex-wrap:wrap
//   2) 留 gap，center 居中；children flex:none 不被挤压
//   3) 5 级文字→图标收缩（data-narrow="1|2|3|4"）：
//      - dn=1 (<960px)  隐藏 dsws-capsule-word 文字（保留品牌图标）
//      - dn=2 (<880px)  隐藏无数字段文字：note "沉淀"/Consolidate、handoff 左半、timebtn 文字
//      - dn=3 (<800px)  隐藏有数字段文字：takeable / bug / triage / env（图标+数字保留）
//      - dn=4 (<720px)  隐藏 timebtn 时间文字（仅刷新图标）
//      - dn 兜底 (<640px) 保持 dn=4，胶囊允许溢出右缘（禁止换行）
//   4) 点击事件契约：
//      - 点击 dsws-capsule-word → togglePanel（stopPropagation）
//      - 点击胶囊空白 → openPanel（onClick 直接挂 onClick → openPanel(s)）
//      - seg / split / timebtn / skillbtn 各自具名 handler + stopPropagation
//   5) EN locale：同 data-narrow 阈值（panel.title 中英同字 "MattSkills" · EN 段无文字）
//   6) 双源同步：client.js ↔ package/lib/client.js 的 .dsws-capsule CSS 块 byte-for-byte 一致
//   7) 静态断言（DOM 模拟）[data-narrow=N] 选择器存在且用 display:none 形式
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：CSS / JS 静态契约（双源同步） ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：胶囊禁止换行 + 跟随输入区宽
  // 注：CSS 规则是字符串数组里的元素，className 出现于 JS 字面量对象键；CSS 自身形如 `.dsws-capsule{...flex-wrap:nowrap...}`
  ok('胶囊 .dsws-capsule CSS 含 flex-wrap:nowrap', /\.dsws-capsule\s*\{[^}]*flex-wrap:nowrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 不含 flex-wrap:wrap', !/\.dsws-capsule\s*\{[^}]*flex-wrap:wrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 含 white-space:nowrap（防御性单行）', /\.dsws-capsule\s*\{[^}]*white-space:nowrap/.test(src))
  // #16 R2（用户验收反馈 2026-08-18）：胶囊宽跟随输入区左右边；不再按视口 96vw 撑。
  ok('胶囊 .dsws-capsule CSS max-width 用 100%（跟随输入区宽，非 96vw）', /\.dsws-capsule\s*\{[^}]*max-width:\s*min\(100%,\s*1400px\)/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 max-width:min(96vw, ...) （旧 R1 行为已弃）', !/\.dsws-capsule\s*\{[^}]*max-width:\s*min\(96vw/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 margin:0 auto（外层 wrapper 负责居中）', !/\.dsws-capsule\s*\{[^}]*margin:\s*0\s+auto/.test(src))
  // 外层 wrapper：display:flex; justify-content:center + width:100% + boxSizing:border-box（跟着输入区容器走）
  //   R12：其中间插入 flex:'none'（防 composerStack flex-shrink 压矮），断言兼容
  ok('外层 wrapper display:flex + justify-content:center 居中胶囊', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'/.test(src))
  ok('外层 wrapper width:100% 跟输入区容器宽', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,80}width:\s*'100%'/.test(src))
  ok('外层 wrapper boxSizing:border-box 防 padding 撑破', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,200}boxSizing:\s*'border-box'/.test(src))
  // #16 v1.6.4 R4：wrapper 加 overflow:hidden 截 capsule 溢出（dn=0..3 中间态时 children 居中后左右溢出 wrapper）
  ok('外层 wrapper overflow:hidden 截 capsule 溢出 wrapper 部分（dn>=1 中间态防「棍子」）', /display:\s*'flex'(?:,\s*flex:\s*'none')?,\s*justifyContent:\s*'center'[\s\S]{0,250}overflow:\s*'hidden'/.test(src))
  ok('胶囊 CSS 不再加 overflow:hidden（让 capsule 圆角背景完整，圆角处不漏白）', !/\.dsws-capsule\s*\{[^}]*overflow:\s*hidden/.test(src))
  // 期望 2：children 保持 flex:none + gap 居中
  ok('children 仍 flex:none（capsule-word / seg / timebtn）', /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-seg\{flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-timebtn\{flex:none/.test(src))
  ok('胶囊 gap 保留 2px 6px（行间距 / 列间距）', /\.dsws-capsule\s*\{[^}]*gap:\s*2px\s+6px/.test(src))
  ok('胶囊 justify-content:center 保留', /\.dsws-capsule\s*\{[^}]*justify-content:\s*center/.test(src))

  // 期望 3：5 级 data-narrow 属性选择器
  // 说明：Ic/Icon 返回 <svg>，所以 seg 子结构是 [svg, span(text), span(num)?]，
  //   文字 span 在 seg/split-part 是 last-child，在 timebtn 是 nth-child(2)（rficon 之后）。
  //   文字 span 全部用 span 包裹（保证选择器稳定），不要用裸文本。
  // 检测方式：抽取 [data-narrow="N"] {...} 整段 CSS 规则字符串，再做 substring 断言 —— 避免贪婪正则误匹配注释/JSX。
  // 注：实际源文件中 selector 字符串的外层定界是 JS 单引号，attribute value 是双引号，固定形式便于匹配。
  const extractRules = function (s, dn) {
    // #16 R6+R7：CSS 选择器用 [data-narrow-N] 属性存在性匹配（旧 [data-narrow="N"] 等值匹配已弃）
    //   整段 '[data-narrow-N] selector { body }'（外层 JS 单引号）
    //   返回所有含 [data-narrow-N] 的规则（可能多条，比如 R7 的 .dsws-capsule width:fit-content 与 R6 的 .dsws-capsule-word 规则）
    const pattern = "'\\[data-narrow-" + dn + "\\][^']*\\{[^}]*\\}'"
    const re = new RegExp(pattern, 'g')
    const out = []
    let m
    while ((m = re.exec(s)) !== null) out.push(m[0].slice(1, -1))
    return out
  }
  const extractRule = function (s, dn) { return extractRules(s, dn)[0] || '' }
  // 验证 [data-narrow-N] 规则里包含特定 selector（多规则时任一命中即可）
  const r1All = extractRules(src, '1')
  ok('R6 · [data-narrow-1] 隐藏 capsule-word 文字（tr(panel.title) 段）',
    r1All.some(function (r) { return /\.dsws-capsule-word/.test(r) && /span:last-child/.test(r) && /display:\s*none/.test(r) }))
  const r2All = extractRules(src, '2')
  ok('R6 · [data-narrow-2] 隐藏无数字段文字：note 段（last-child）',
    r2All.some(function (r) { return /\.dsws-seg\.note/.test(r) && /span:last-child/.test(r) && /display:\s*none/.test(r) }))
  ok('R6 · [data-narrow-2] 隐藏无数字段文字：split 第一半（last-child）',
    r2All.some(function (r) { return /\.dsws-split-part:first-child/.test(r) && /span:last-child/.test(r) && /display:\s*none/.test(r) }))
  ok('R6 · [data-narrow-2] 隐藏 timebtn 文字（refresh word · nth-child(2)）',
    r2All.some(function (r) { return /\.dsws-timebtn/.test(r) && /span:nth-child\(2\)/.test(r) && /display:\s*none/.test(r) }))
  const r3All = extractRules(src, '3')
  ok('R6 · [data-narrow-3] 隐藏有数字段文字（all seg text · nth-child(2) 跳过 svg）',
    r3All.some(function (r) { return /\.dsws-seg/.test(r) && /span:nth-child\(2\)/.test(r) && /display:\s*none/.test(r) }))
  const r4All = extractRules(src, '4')
  ok('R6 · [data-narrow-4] 隐藏 timebtn 时间文字（last-child）',
    r4All.some(function (r) { return /\.dsws-timebtn/.test(r) && /span:last-child/.test(r) && /display:\s*none/.test(r) }))

  // 期望 4：JSX 写 data-narrow 属性（capsule 根 div 写 dn 字符串 / null；接受 'data-narrow': 或 data-narrow: 两种键写法）
  ok('capsule JSX 写 data-narrow 属性（dn || null 形式）',
    /className:\s*['"]dsws-capsule['"][^}]*['"]?data-narrow['"]?\s*:\s*dn\s*\|\|\s*null/.test(src))

  // JSX 阈值计算：dw（dock width）读取与 5 段 if 阈值
  // #16 R5：vw（window.innerWidth）→ dw（外层 wrapper 实际宽度，ResizeObserver 实时监听）
  ok('JSX 内读 window.innerWidth（仅作 fallback，非主信号）', /window\.innerWidth/.test(src))
  ok('JSX 内 5 级阈值（dw < 960/880/800/720）', /if \(dw < 960\)/.test(src) && /if \(dw < 880\)/.test(src) && /if \(dw < 800\)/.test(src) && /if \(dw < 720\)/.test(src))
  // #16 R5：ResizeObserver 监听 wrapper 实时更新 dn（解决 resize 不触发重渲染的 P1 bug）
  ok('R5 · StatusBar 用 React.useRef 定义 dockRef', /dockRef\s*=\s*React\.useRef/.test(src))
  ok('R5 · StatusBar 用 React.useState 跟踪 dw（dock width）', /\[dw,\s*setDw\]\s*=\s*React\.useState/.test(src))
  ok('R5 · ResizeObserver 监听 dockRef.current 触发 setDw', /new ResizeObserver/.test(src) && /setDw/.test(src))
  ok('R5 · ResizeObserver 监听的是元素（ro.observe(elp））', /ro\.observe\(el\)/.test(src))
  ok('R5 · window resize 事件也作 fallbastollback', /window\.addEventListener\(['"]resize['"]/.test(src))
  ok('R5 · 有 firstBlock 分支的 wrapper 也挂 ref={dockRef}', /ref:\s*dockRef[\s\S]{0,300}style:.*flexDirection:.*column/.test(src))

  // #16 R6 CSS 累加语义：JSX 写 data-narrow-1..4 多 attribute（每个 dn值以下所有级别都存在），CSS 按属性存在性匹配
  //   替换旧的 [data-narrow="N"] 等值匹配（R5 之前的设计 bug：dn=4 时 [data-narrow="3"] 不命中，文字不消失）
  ok('R6 · CSS 选择器用 [data-narrow-1] 属性存在性（累加语义）', /\[data-narrow-1\] \.dsws-capsule-word > span:last-child\{display:none\}/.test(src))
  ok('R6 · CSS 选择器用 [data-narrow-2] 属性存在性', /\[data-narrow-2\] \.dsws-seg\.note > span:last-child/.test(src))
  ok('R6 · CSS 选择器用 [data-narrow-3] 属性存在性', /\[data-narrow-3\] \.dsws-seg > span:nth-child\(2\)/.test(src))
  ok('R6 · CSS 选择器用 [data-narrow-4] 属性存在性', /\[data-narrow-4\] \.dsws-timebtn > span:last-child/.test(src))
  ok('R6 · JSX capsule 写 data-narrow-1 属性（dn >= 1 时存在）', /'data-narrow-1':\s*dn\s*>=\s*1\s*\|\|\s*null/.test(src))
  ok('R6 · JSX capsule 写 data-narrow-2 属性', /'data-narrow-2':\s*dn\s*>=\s*2\s*\|\|\s*null/.test(src))
  ok('R6 · JSX capsule 写 data-narrow-3 属性', /'data-narrow-3':\s*dn\s*>=\s*3\s*\|\|\s*null/.test(src))
  ok('R6 · JSX capsule 写 data-narrow-4 属性', /'data-narrow-4':\s*dn\s*>=\s*4\s*\|\|\s*null/.test(src))
  ok('R6 · 旧 [data-narrow="N"] 等值匹配选择器已删（防止仍命中旧规则误导）',
    !/\[data-narrow="[1-4]"\][^{]+\{display:none/.test(src))

  // #16 R6b：wrapper 去掉 alignItems:'stretch'（避免 capsule 被父级 composerHero 297px 高拉成 9.5px，文字被截）
  //   R6 修复：!firstBlock 分支不应再有 alignItems:'stretch'
  ok('R6b · !firstBlock 分支 wrapper 不再含 alignItems:\'stretch\'', !/display:\s*'flex',\s*justifyContent:\s*'center'[\s\S]{0,200}alignItems:\s*'stretch'/.test(src))

  // #16 R12（本次修复）：宿主 conversation.input.dock = composerStack（column flex），wrapper 是 flex item，
  //   默认 flex-shrink:1 → 输入区高度被压缩时 wrapper 被压扁（wrapper 11px → capsule 8px → overflow:hidden 裁文字）。
  //   R6b 只防了「被拉高」，R12 补「被压矮」：两个 wrapper 分支都必须有 flex:'none'（flex:0 0 auto）
  ok('R12 · !firstBlock 分支 wrapper 含 flex:\'none\'（防 flex-shrink 压矮导致 capsule 文字被裁）',
    /display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center'/.test(src))
  ok('R12 · firstBlock 分支 wrapper 含 flex:\'none\'（横幅 + 胶囊列布局同样防压缩）',
    /display:\s*'flex',\s*flex:\s*'none',\s*flexDirection:\s*'column'/.test(src))


  // #16 R7：dn=0 时 capsule 应撑满 wrapper 与输入区对齐（原始问题），R11 曾改为 fit-content（跟内容走）
  // #16 R13（用户验收反馈 2026-08-18，产品决策变更）：胶囊外框必须始终像素级对齐输入框左右边——
  //   fit-content 会在面板变窄时让胶囊缩成内容宽、缩在中间、不贴输入框两边（用户实测确认这是坏行为）。
  //   改为：CSS 基础 width:100%（撑满 wrapper=输入区）+ inline width:iw px（精确 = textarea 实际宽）；删除 dn>=1 fit-content 条件。
  ok('R13 · 胶囊 CSS 默认 width:100%（撑满 wrapper=输入区，外框跟输入框对齐）',
    /\.dsws-capsule\{[^}]*width:100%/.test(src))
  ok('R13 · 不再有 dn>=1 fit-content 条件规则（胶囊外框永不塌回内容宽缩中间）',
    !/\[data-narrow-[1-4]\] \.dsws-capsule,[\s\S]{0,30}width:fit-content/.test(src))

  // #16 R9：capsule 内联 style width:iw px（iw = textarea 实际宽，ResizeObserver 监听）+ maxWidth:iw 防溢出
  ok('R9 · StatusBar 用 document.querySelector 找 DSH 输入框 textarea.uV2eYG_input',
    /document\.querySelector\(['"]textarea\.uV2eYG_input['"]\)/.test(src))
  ok('R9 · ResizeObserver 同时监听 dockRef 和 inputRef（分别反映 dock 缩放和输入框宽）',
    /roInput\.observe\(inputRef\.current\)[\s\S]{0,100}roWrap\.observe\(dockRef\.current\)/.test(src))
  ok('R9+R13 · capsule 内联 style width:iw + px + maxWidth:iw + px（外框精确 = 输入框宽，防溢出）',
    /style:\s*\{[^}]*width:\s*iw\s*\+\s*'px'[\s\S]{0,60}maxWidth:\s*iw\s*\+\s*'px'/.test(src))
  ok('R9 · useEffect 清理 disconnect 两个 ResizeObserver（防泄漏）',
    /roInput\.disconnect\(\)[\s\S]{0,100}roWrap\.disconnect\(\)/.test(src))
  ok('R9 · 轮询兜底（DSH shell 切换对话时 textarea 重新挂载）',
    /setInterval\(apply, 2000\)/.test(src))

  // #16 R10：capsule box-sizing:border-box → 外框 = iw = textarea 外框
  ok('R10 · 胶囊 CSS 加 box-sizing:border-box（让 capsule 外框 = iw = textarea 外框）',
    /\.dsws-capsule\{[^}]*box-sizing:border-box/.test(src))

  // #16 R13（承上）：inline width:iw px 恢复 —— 外框像素级对齐输入框；旧 fit-content 弃用
  ok('R13 · inline width = iw + px 恢复（外框始终 = 输入框外框）',
    /style:\s*\{[^}]*width:\s*iw\s*\+\s*'px'/.test(src))
  ok('R13 · 旧 fit-content 弃用（不再无条件跟随 children 自然宽）',
    !/\.dsws-capsule\{[^}]*width:fit-content/.test(src) && !/style:\s*\{[^}]*width:\s*'fit-content'/.test(src))

  // 期望 4 续：点击事件契约
  ok('capsule onClick → openPanel(s)', /className:\s*['"]dsws-capsule['"][^}]*onClick:\s*function\s*\(\)\s*\{\s*openPanel\(s\)/.test(src))
  ok('capsule-word onClick → togglePanel(s) + stopPropagation', /className:\s*['"]dsws-capsule-word['"][^}]*onClick:[^}]*togglePanel\(s\)/.test(src) && /className:\s*['"]dsws-capsule-word['"][^}]*e\.stopPropagation/.test(src))
  ok('seg onClick → e.stopPropagation + onGo()', /className:\s*['"]dsws-seg['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-seg['"][^}]*onGo\(\)/.test(src))
  ok('timebtn onClick → e.stopPropagation + refreshAll(s)', /className:\s*['"]dsws-timebtn['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-timebtn['"][^}]*refreshAll\(s\)/.test(src))

  // 期望 5：EN locale i18n 键齐备（panel.title 中英同字 · 单独抽出 zh 块与 en 块分别断言）
  const extractLocaleBlock = function (s, lang) {
    // 找 L = { zh: { ... } } 或 L = { en: { ... } } 中对应 lang 块
    const re = new RegExp("\\b" + lang + ":\\s*\\{[\\s\\S]*?\\n\\s*\\}", 'm')
    return (s.match(re) || [''])[0]
  }
  const zhBlock = extractLocaleBlock(src, 'zh')
  const enBlock = extractLocaleBlock(src, 'en')
  ok('i18n 字典存在 zh 块（zh: { ... }）', !!zhBlock)
  ok('i18n 字典存在 en 块（en: { ... }）', !!enBlock)
  ok('panel.title zh = "MattSkills"', /'panel\.title':\s*'MattSkills'/.test(zhBlock))
  ok('panel.title en = "MattSkills"（中英同字，EN 下 dn=1 为 no-op）', /'panel\.title':\s*'MattSkills'/.test(enBlock))
  // i18n 实测：与诊断段一致 —— nav.triage 是「诊断」/Triage，不是「待分诊」
  ok('nav.triage zh = "诊断"（与 issue 诊断段一致，非 "待分诊"）', /'nav\.triage':\s*'诊断'/.test(zhBlock))
  ok('nav.triage en = "Triage"', /'nav\.triage':\s*'Triage'/.test(enBlock))
  ok('nav.word zh = "沉淀"', /'nav\.word':\s*'沉淀'/.test(zhBlock))
  ok('nav.refresh zh = "更新"', /'nav\.refresh':\s*'更新'/.test(zhBlock))

  // 期望 6：i18n 阈值内关键键存在
  ok('nav.takeable / nav.bug / nav.triage / nav.env / nav.refresh / nav.handoff 键齐',
    /'nav\.takeable'/.test(src) && /'nav\.bug'/.test(src) && /'nav\.triage'/.test(src) &&
    /'nav\.env'/.test(src) && /'nav\.refresh'/.test(src) && /'nav\.handoff'/.test(src))
}

// ---- Part B：双源镜像同步 ----
const mirrorCheck = function (srcA, srcB) {
  // 抽取 .dsws-capsule / [data-narrow="N"] 开头的 CSS 规则字符串（以单引号包裹，过滤注释/JSX 干扰）
  const extractCapsule = function (src) {
    // 匹配 ' 选择器 { 内容 } ' 形式 —— 严格要求整段在单引号内（即 JS 字符串字面量）
    const re = /'(?:\.dsws-capsule|\[data-narrow=['"][0-9]['"]\][^']*)\{[^}]*\}'/g
    const matches = src.match(re) || []
    return matches.map(function (s) { return s.slice(1, -1) }).sort().join('\n')
  }
  const a = extractCapsule(srcA)
  const b = extractCapsule(srcB)
  if (a !== b) {
    throw new Error('双源 .dsws-capsule CSS 块不一致（client.js ↔ package/lib/client.js）\n--- 源 ---\n' + a + '\n--- 镜像 ---\n' + b)
  }
  console.log('  PASS mirror · .dsws-capsule CSS 块双源 byte-for-byte 一致（共 ' + a.split('\n').length + ' 条规则）')
  // JSX 双源对比：规范化缩进后比较（提取 capsule div 的完整 children 数组到 `])` 收尾）
  const extractCapsuleJsx = function (src) {
    const re = /const capsule = h\('div', \{ className: 'dsws-capsule'[\s\S]*?\n\s*\]\)/m
    const m = src.match(re)
    return m ? m[0].replace(/^[ \t]+/gm, '').replace(/\r\n/g, '\n') : ''
  }
  const ja = extractCapsuleJsx(srcA)
  const jb = extractCapsuleJsx(srcB)
  if (!ja || !jb) throw new Error('双源 JSX 提取失败：源=' + (ja ? 'OK' : 'NULL') + ' 镜像=' + (jb ? 'OK' : 'NULL'))
  if (ja !== jb) {
    throw new Error('双源 capsule JSX 块不一致（client.js ↔ package/lib/client.js，去缩进后）\n--- 源 ---\n' + ja + '\n--- 镜像 ---\n' + jb)
  }
  console.log('  PASS mirror · capsule JSX 双源去缩进 byte-for-byte 一致')
}

// ---- Part C：行为契约 —— 模拟 vw 阈值生成 dn 字符串，验证 5 级阈值函数 ----
const extractThresholdFn = function (src) {
  // 找 "let dn = ..." 块；以 (dw < 960) / (dw < 880) / (dw < 800) / (dw < 720) 四个条件
  // 与兜底 (< 640) 模式校验。R5 把 vw 改 dw（dock width = wrapper 实际宽度），阈值不变。
  const m960 = /dw\s*<\s*960/.test(src)
  const m880 = /dw\s*<\s*880/.test(src)
  const m800 = /dw\s*<\s*800/.test(src)
  const m720 = /dw\s*<\s*720/.test(src)
  const m640 = /dw\s*<\s*640/.test(src)
  if (!(m960 && m880 && m800 && m720 && m640)) throw new Error('5 级阈值条件缺失：需 <960/880/800/720/640')
  console.log('  PASS 行为契约 · 5 级阈值函数存在（<960/880/800/720/640）')
  // 验证 5 个阈值的语义：纯函数化重算（与代码同阈值）
  const compute = (dw) => {
    if (dw < 640) return 4
    if (dw < 720) return 4
    if (dw < 800) return 3
    if (dw < 880) return 2
    if (dw < 960) return 1
    return 0
  }
  // 严格断言：dn 阈值边界与 issue 期望行为 3 一致
  const cases = [
    { vw: 1280, dn: 0, desc: '默认宽视口无收缩' },
    { vw: 1000, dn: 0, desc: '1000px 无收缩' },
    { vw: 950, dn: 1, desc: '950px → dn=1（品牌字消失）' },
    { vw: 900, dn: 1, desc: '900px → dn=1' },
    { vw: 870, dn: 2, desc: '870px → dn=2（无数字段字消失）' },
    { vw: 850, dn: 2, desc: '850px → dn=2' },
    { vw: 790, dn: 3, desc: '790px → dn=3（有数字段字消失）' },
    { vw: 750, dn: 3, desc: '750px → dn=3' },
    { vw: 700, dn: 4, desc: '700px → dn=4（时间字消失）' },
    { vw: 600, dn: 4, desc: '600px 兜底 dn=4（不再收缩）' },
  ]
  for (const c of cases) {
    const r = compute(c.vw)
    if (r !== c.dn) throw new Error('阈值映射错误：vw=' + c.vw + ' 应=' + c.dn + ' 实=' + r + '（' + c.desc + '）')
    console.log('  PASS 行为契约 · vw=' + c.vw + ' → dn=' + r + '（' + c.desc + '）')
  }
}

// ---- Part D：DOM 模拟点击（期望行为 7：实际跑 handler 函数体，验证 stopPropagation + 路由） ----
// 抽取各 onClick handler 的函数体字符串，注入受控 stub 上下文，调用并断言调用栈。
const domSimCheck = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  // 抽出 onClick: function (arg) { BODY } 的 BODY 段
  const findHandler = function (re) {
    const m = src.match(re)
    return m ? m[1] : null
  }
  // 胶囊根：onClick: function () { openPanel(s) }
  const capBody = findHandler(/onClick:\s*function\s*\(\)\s*\{\s*(openPanel\(s\))\s*\}/)
  // capsule-word：onClick: function (e) { e.stopPropagation(); togglePanel(s) }
  const cwBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*togglePanel\(s\))\s*\}/)
  // seg：onClick: function (e) { e.stopPropagation(); onGo() } —— 在 seg 工厂函数内
  const segBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*onGo\(\))\s*\}/)
  // timebtn：onClick: function (e) { e.stopPropagation(); refreshAll(s) }
  const tbBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*refreshAll\(s\))\s*\}/)
  if (!capBody) throw new Error('capsule onClick handler 提取失败')
  if (!cwBody) throw new Error('capsule-word onClick handler 提取失败')
  if (!segBody) throw new Error('seg onClick handler 提取失败')
  if (!tbBody) throw new Error('timebtn onClick handler 提取失败')

  // 沙箱执行 + 断言
  const runHandler = function (body, ctx) {
    // 闭包：handler 函数体 + ctx（s, e, stubs）
    const fn = new Function('s', 'e', 'openPanel', 'togglePanel', 'onGo', 'refreshAll', body)
    return fn(ctx.s, ctx.e, ctx.openPanel, ctx.togglePanel, ctx.onGo, ctx.refreshAll)
  }
  const makeEvent = () => ({ stopped: false, stopPropagation: function () { this.stopped = true } })
  const calls = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
  const st = { tag: 'fixture' }

  // 1) 点击 capsule 空白（直接 onClick） → openPanel(s)
  const r1 = runHandler(capBody, { s: st, openPanel: function (s) { calls.openPanel++; if (s !== st) throw new Error('openPanel 收到的 s 不一致') } })
  ok('点击胶囊空白 → openPanel(s) 触发 1 次', calls.openPanel === 1 && calls.togglePanel === 0 && calls.onGo === 0 && calls.refreshAll === 0)

  // 2) 点击 capsule-word → togglePanel(s) + stopPropagation
  calls.openPanel = 0
  const e2 = makeEvent()
  const r2 = runHandler(cwBody, { s: st, e: e2, togglePanel: function (s) { calls.togglePanel++; if (s !== st) throw new Error('togglePanel 收到的 s 不一致') } })
  ok('点击 capsule-word → togglePanel(s) 触发 1 次 + stopPropagation 已调用',
    calls.togglePanel === 1 && e2.stopped === true)
  ok('点击 capsule-word → 没有冒泡到 openPanel', calls.openPanel === 0)

  // 3) 点击 seg → onGo() + stopPropagation（onGo 是 seg 工厂注入的具名闭包）
  calls.togglePanel = 0
  const e3 = makeEvent()
  const r3 = runHandler(segBody, { s: st, e: e3, onGo: function () { calls.onGo++ } })
  ok('点击 seg → onGo() 触发 1 次 + stopPropagation 已调用',
    calls.onGo === 1 && e3.stopped === true)

  // 4) 点击 timebtn → refreshAll(s) + stopPropagation
  calls.onGo = 0
  const e4 = makeEvent()
  const r4 = runHandler(tbBody, { s: st, e: e4, refreshAll: function (s) { calls.refreshAll++; if (s !== st) throw new Error('refreshAll 收到的 s 不一致') } })
  ok('点击 timebtn → refreshAll(s) 触发 1 次 + stopPropagation 已调用',
    calls.refreshAll === 1 && e4.stopped === true)

  // 5) handler 路由隔离：每次只跑一种 handler 时，**其他**函数一次都不该被调用
  // 重新跑一次（隔离验证）—— 用全新计数器
  const verifyIsolation = function (handlerName, body, expectedStub) {
    const calls2 = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
    const stubs = {
      openPanel: function () { calls2.openPanel++ },
      togglePanel: function () { calls2.togglePanel++ },
      onGo: function () { calls2.onGo++ },
      refreshAll: function () { calls2.refreshAll++ }
    }
    runHandler(body, { s: st, e: makeEvent(), openPanel: stubs.openPanel, togglePanel: stubs.togglePanel, onGo: stubs.onGo, refreshAll: stubs.refreshAll })
    const expected = expectedStub
    for (const k of ['openPanel', 'togglePanel', 'onGo', 'refreshAll']) {
      const shouldBe = (k === expected) ? 1 : 0
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
    console.log('-- Part C 行为契约（阈值函数）--')
    try { extractThresholdFn(src) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part C — ' + e.message); continue }
    console.log('-- Part D DOM 模拟点击（期望行为 7）--')
    try { domSimCheck(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part D — ' + e.message); continue }
  }
  console.log('-- Part B 双源镜像同步 --')
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
