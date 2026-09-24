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
  // #640 改写：胶囊的宽度上限不再自编一个像素数，改为与输入卡同源的那个变量
  //   （宿主 .p_FcLG_card 用的就是 --dsh-composer-card-max-width；外层容器已按同一条算式收窄，
  //    所以胶囊外框与输入卡外框等宽）。自编 min(100%,1400px) 的毛病：它比输入卡宽，
  //   于是「对齐」形同虚设 —— 实测胶囊 1377、输入卡 1231，被 100% 撑满。
  //   真正的像素级对齐由 tests/verify-640-dock-width-browser.js 在浏览器里量，不在本文件里断言字符串。
  ok('胶囊 .dsws-capsule CSS max-width 取宿主卡宽变量（不再自编 1400px）',
    /\.dsws-capsule\s*\{[^}]*max-width:\s*var\(--dsh-composer-card-max-width,\s*100%\)\s*\}/.test(src))
  // 旧的自编兜底（第一条规则里那个 min(100%,1400px)）必须在改造后消失，否则两条规则里还留着老上限
  ok('胶囊 .dsws-capsule CSS 不再自编像素上限（1400px 已弃）', !/max-width:\s*min\(100%,\s*1400px\)/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 max-width:min(96vw, ...) （旧 R1 行为已弃）', !/\.dsws-capsule\s*\{[^}]*max-width:\s*min\(96vw/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 margin:0 auto（外层 wrapper 负责居中）', !/\.dsws-capsule\s*\{[^}]*margin:\s*0\s+auto/.test(src))
  // #640 改写：外层容器的几何收敛到 StatusBar.js 的 dswsStatusDockGeom 一处，三支容器都调它。
  //   原来这里断言的是「wrapper 内联 width:100% + boxSizing + overflow」这串属性，那是改造前的形状；
  //   那条断言在改造前就已经失效（主干上一直红着，且没挂进门禁链），所以这里改成断言真源关系。
  ok('外层容器几何收敛到 dswsStatusDockGeom 一处（三支容器共用）', /const dswsStatusDockGeom = function \(\)/.test(src))
  ok('外层容器宽度取宿主「侧距」变量（不是内联 100%）',
    /width:\s*'calc\(100%\s*-\s*2\s*\*\s*var\(--dsh-composer-side-clearance/.test(src))
  ok('外层容器 max-width 取宿主卡宽变量（不再无约束铺满整列）',
    /maxWidth:\s*'var\(--dsh-composer-card-max-width,\s*100%\)'/.test(src))
  ok('外层容器不带横向内边距（否则胶囊会被再挤进来一层，与输入卡又对不上）',
    /padding:\s*'3px 0 0'/.test(src))
  // 外层容器三支都必须**亲自**调用几何：原来这里只数「dswsStatusDockGeom() 出现次数 >= 3」，
  //   数次数会漏掉「某一支停止调用、别处多一次字符串」（独立复核的变异实验 c 就是这样漏过去的），
  //   所以改成每一支各断言一次结构（branchHits 由上面按三种锚点文本分别扫出来）。
  const helperCalls = (src.match(/dswsStatusDockGeom\(\)/g) || []).length
  ok('外层容器几何被调用（至少 3 次：收起态 / 无横幅 / 有横幅各一次）', helperCalls >= 3)
  const branchHits = [
    ['收起态（justifyContent:center 那一支）', /Object\.assign\(\{ display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center' \},\s*dswsStatusDockGeom\(\)\)/],
    ['无横幅那一支（gap: 2）', /Object\.assign\(\{ display:\s*'flex',\s*flex:\s*'none',\s*flexDirection:\s*'column',\s*alignItems:\s*'center',\s*gap:\s*2,[^}]*\},\s*dswsStatusDockGeom\(\)\)/],
    // 这一支的属性顺序与另两支不同（flexDirection 排在 flex 前面），所以断言只钉住它独有的两个词
    // （gap: 4 + position: relative）与末尾的 helper 调用，不钉属性顺序。
    ['有横幅那一支（gap: 4 + position:relative）', /Object\.assign\([\s\S]{0,240}gap:\s*4[\s\S]{0,120}position:\s*'relative'\s*\},\s*dswsStatusDockGeom\(\)\)/],
  ]
  for (const [label, re] of branchHits) ok('几何套在这一支上：' + label, re.test(src))
  // 三支的横向内边距只由几何那一处给：断言几何的 padding 就是 '3px 0 0'，且三支都不再自己拼字面量。
  //   注意不要把范围放宽成「整个文件里不许出现 padding:'0 8px'」——那个写法在状态栏别处还有正当用途
  //   （折叠按钮等），一并禁掉会误伤。
  ok('几何自带的 padding 就是不带横向内边距的 \'3px 0 0\'', /padding:\s*'3px 0 0'/.test(src))
  ok('三支都不再各自硬写外层容器的横向内边距', !/gap:\s*2\s*,[^}]*padding:/.test(src) && !/gap:\s*4\s*,\s*position:\s*'relative'\s*,\s*padding:/.test(src))
  ok('外层容器正常路径仍保留 overflow:hidden 截胶囊溢出、缺 ReactDOM 时 visible 降级',
    /overflow:\s*RDOM\s*\?\s*'hidden'\s*:\s*'visible'/.test(src))
  ok('胶囊 CSS 不再加 overflow:hidden（让 capsule 圆角背景完整，圆角处不漏白）', !/\.dsws-capsule\s*\{[^}]*overflow:\s*hidden/.test(src))
  // 期望 2：children 保持不被挤压（2026-09-24 #725 起：品牌那一段与另两段的挤压规则各自写明）
  //   维护者这一轮定「内容平铺在这一条里」：胶囊两端分布，多出来的空间均分在**各项之间**。
  //   2026-09-24 晚按真机测量改了一处：品牌那一段原来写 `flex:1 1 auto`，它一个元素把余量全吃了
  //   （实测宽条上被撑到 230 像素、里面只装 79 像素的东西），其余各项被顶成一簇 —— 维护者看到的就是
  //   「按钮过于集中在右侧」。现在它写 `flex:0 1 auto` + `max-width:max-content`：只占自己的内容宽、
  //   仍可收缩（min-width:0 保留），余量交给 space-between 在各项之间平分（真机量与阈值见
  //   tests/verify-capsule-layout.js）。seg 与 timebtn 仍 flex:none。
  ok('children 的挤压规则照平铺来（品牌段只占内容宽 flex:0 1 auto + max-width:max-content + min-width:0 / seg 与 timebtn 仍 flex:none）',
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:0 1 auto/.test(src) && /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*max-width:max-content/.test(src) && /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*min-width:0/.test(src) && /\.dsws-capsule\s+\.dsws-seg\{flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-timebtn\{flex:none/.test(src))
  // 图标与它自己那串字是一个不可分的整体：那一段自己的列间距写死 5px（原来那条随视口放大的 clamp
  //   把它也撑开了，真机实测宽条 28px —— 维护者截图上「图标与文字之间的间隙太大」就是它）。
  ok('图标↔自己的文字间隙写死不随视口变（那一段的 column-gap:5px；随宽度变化的那条只留给各项之间）',
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:5px/.test(src) && !/\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:clamp\(/.test(src))
  ok('胶囊 gap 保留 2px 6px（行间距 / 列间距）', /\.dsws-capsule\s*\{[^}]*gap:\s*2px\s+6px/.test(src))
  ok('胶囊 justify-content 是平铺的 space-between（#725 维护者定，替掉旧的 center）', /\.dsws-capsule\s*\{[^}]*justify-content:\s*space-between/.test(src))

  // 期望 3（V2）：内容自适应渐进收缩
  // 3a. CSS 折叠规则：一条规则命中所有带 data-fold-priority 且被加 .dsws-folded 的文字 span
  //   2026-09-22 起这条规则也管面板头部第一行里那几颗单字形小图标（标记 data-head-fold + data-head-icon，
  //   见 panel/Dock.js）：图标本身就是单个字形，一步撤一颗，做法与胶囊同一套（全展开 → 按优先序逐个加
  //   .dsws-folded → 收到放得下为止）。同一行里那些「一串字」的元素（仓库名 / 刷新按钮的字 / 时间标签）
  //   不走这一条 —— 它们按 panel/headFold.js 那条阶梯逐字变短，永远不整块 display:none。
  ok('V2 · CSS 折叠规则同时管胶囊与面板头部那几颗单字形小图标',
    /'\.dsws-capsule \[data-fold-priority\]\.dsws-folded,\[data-head-fold\]\.dsws-folded\{display:none\}'/.test(src))
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
  // 3c. 那台阶梯机的核心形状（2026-09-24 #725：机器搬进 statusbar/capFoldMachine.js —— 判据是
  //   statusbar/capFold.js 的纯函数，StatusBar.js 只留接线。这些断言量的是**产物里的代码**，
  //   搬了住处照样量得到；下面几句的判据一条没放松，只是把「谁在实现」写清楚了。）
  ok('V2 · applyFold 函数存在（接线：把胶囊与两张跨调用带着走的表交给阶梯机）', /const applyFold = function\s*\(\)\s*\{/.test(src))
  ok('V2 · 推到某一档时先去掉全部折叠类、再强制重排一次（拿到这一档放不下时的基准）', /classList\.remove\(['"]dsws-folded['"]\)[\s\S]{0,120}void cap\.offsetWidth/.test(src))
  ok('V2 · 阶梯按 priority 升序（小号先让位）', /sort\(function \(a, b\) \{ return a\.p - b\.p \}\)/.test(src))
  ok('V2 · 溢出判定 scrollWidth ≤ clientWidth+1（放得下就停在这一档）', /scrollWidth\s*<=\s*cap\.clientWidth\s*\+\s*1/.test(src))
  ok('V2 · 收成空串的那几段加 .dsws-folded 之后强制重排', /classList\.add\(['"]dsws-folded['"]\)[\s\S]{0,80}void cap\.offsetWidth/.test(src))
  ok('V2 · 记下 dataset.fold 折叠段数与 dataset.foldTier 档号（调试与门禁的锚点）',
    /cap\.dataset\.fold\s*=\s*String\(/.test(src) && /cap\.dataset\.foldTier\s*=\s*String\(/.test(src))
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
  // 2026-09-24（#725）：这条 2 秒轮询退役（维护者定：这一条横向随宽度一格一格变短，但不许挂自续定时器）。
  //   它原先兜的是「字被换掉了、尺寸没变，观察器不会响」那一种（React 重渲染会把收短的那串换回完整的一串），
  //   现在由「每次提交之后重算一次」那条副作用接管；真实表现由 tests/verify-cap-fold.js 的宽度扫描门禁钉住
  //   （含「改完宽度等 2200 毫秒再量一次，仍然正确」那条证据）。
  ok('R9 · 2 秒轮询已退役（#725），改由 ResizeObserver + 提交后重算 + fonts.ready 三条路接管',
    !/setInterval\(applyAll, 2000\)/.test(src) && /React\.useEffect\(function \(\) \{ applyFold\(\) \}\)/.test(src))
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