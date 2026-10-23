// 门禁归属: src/client/views/cards
/**
 * tests/verify-cards-dir.ts —— src/client/views/cards 这一层的专属门禁。
 *
 * 为什么要有这一条：这个目录是像素风三张卡（地图卡 PixelMapCard / 票卡 PixelIssueCard / 地图子票卡
 *   PixelIssueMapCard）与它们共用的小件的真源，一共 18 个文件（16 份 .ts 叶子 + 2 份 .d.ts 契约）。此前没有任何门禁碰过它，
 *   改坏了不会有人拦。这里按「把组件真挂起来、量看得见的结果」的口径守住它。
 *
 * 被测对象是谁（先分清真源与产物，别搞错）：
 *   *.ts 是手写真源，也是唯一落盘的东西；早期 `node scripts/build.mts` 的 pixel-ts 步骤会在旁边
 *   生成同名 .js（带 AUTO-GENERATED 横幅），2026-10-19 起那一步连同 166 份产物一起删掉了 ——
 *   拼接缝（scripts/lib/transpile-domains.mts 的 readSpliceFragmentSource）直接读 .ts、当场转译，
 *   产物只留在 client.js 里。这些组件没有 import 进别处，靠 src/client/index.ts 里的
 *   `// ==== leaf:xxx ====` 标记被拼进客户端闭包。
 *   所以本门禁装载的是「按构建口径从真源转译出来的那段文本」（tests/lib/source-text.ts 的
 *   spliceableJs），第 6 节改守「源码树里不再有同名 .js 产物」。
 *
 * 怎么把它跑起来（与闭包里的跑法一致）：
 *   把 16 份真源按拼接次序（= scripts/build.mts 的 LEAF_MODULES 登记次序）拼成一段函数体、
 *   去掉行首 export，用 tests/lib/eval-probe.js 的 compileFn 造函数。这些组件在闭包里的自由变量
 *   只有三个：React、DswsCtx、tr。React 与 DswsCtx 用真的；tr 用 src/client/kernel/locale-cards.ts
 *   那份真字典 + src/client/index.ts 里「locale 服务缺失」时的同一套退化实现（读 zh 字典、替换 {n}），
 *   所以按钮上、封条上的字是真的词条，不是替身。然后用 jsdom + 真 React 挂载，量渲染出来的 DOM
 *   与浏览器算出来的计算样式。
 *
 * 断的六件事：
 *   1. 三张卡都能挂起来，关键结构（编号 / 标题 / 按钮区 / 标签区 / 脚注 / 点阵 / 统计条）真的出现。
 *   2. 按钮行按动作出按钮：九种动作取值下的按钮条数、主按钮的话术与配色、图标、点了回调谁。
 *   3. 标题截断：两行 / 三行在计算样式上真的生效（display / -webkit-line-clamp / overflow / min-height）。
 *   4. 小件的行为：编号徽章（实心与描边）、点阵与统计条、标签 chips（按真标签色 + 字色对比）、
 *      被阻塞与挡路两种形态（含「点亮时红条才出现」与「点亮挡路卡那张卡」）。
 *   5. 源码树里只剩真源：16 份叶子旁边没有同名 .js（产物搬进 client.js 之后不该再落回来）。
 *   6. props 契约：cardBits.d.ts / cardProps.d.ts 里声明的字段，逐个用「带上它 / 去掉它，观察点必须变」
 *      证明真的被用上；反方向再断言组件读的字段名全都在契约里声明过。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-cards-dir.ts（在插件根目录，不需要先构建；2026-10-17 从 .js 转成 TypeScript，只改名与加类型标注，判据一条没动；2026-10-19 起改读真源，pixel-ts 产物已删）
 */
'use strict'

const fs = require('fs')
const path = require('path')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
// 从 .ts 真源取「按构建口径转译后的可拼接文本」：同名 .js 产物已不再落盘，凡是需要那份文本的地方
// 都走这里，保证本门禁装载的与 client.js 里拼进去的是同一套转译口径。用法见 tests/lib/source-text.ts。
const { spliceableJs, sourceText } = require('./lib/source-text.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = React

let passed = 0
let failed = 0
function check (ok: unknown, msg: string): void {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed += 1; console.log('  FAIL ' + msg) }
}
function section (title: string): void { console.log(''); console.log('== ' + title + ' ==') }
/** 打印实得值时用：红了能直接看出差在哪。 */
const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v))

const ROOT = path.resolve(__dirname, '..')
const CARDS_REL = 'src/client/views/cards'
const CARDS = path.join(ROOT, CARDS_REL)

// 拼接次序：与 scripts/build.mts 的 LEAF_MODULES 登记次序、src/client/index.js 里
// `// ==== leaf:xxx ====` 标记的次序三处一致（先主题与皮肤，再共享小件，最后三张大卡）。
const LEAF_ORDER = [
  'PixelCardTheme', 'PixelCardsStyles', 'PixelCardPin', 'PixelCardTitle', 'PixelCardNo',
  'PixelCardTags', 'PixelCardNote', 'PixelCardFoot', 'PixelCardStamp', 'PixelBlockedChrome',
  'PixelCardBtns', 'PixelMapDots', 'PixelCardHead', 'PixelIssueCard', 'PixelIssueMapCard', 'PixelMapCard',
]
// 装载后要从这段闭包里取出来的名字。
const LEAF_EXPORTS = [
  'PIXEL_CARDS_STYLE_TEXT', 'CARD_ACTION_COLORS', 'CARD_ACTION_STYLE', 'cardColorOf', 'cardLum', 'cardInkOn',
  'PixelCardPin', 'PixelCardTitle', 'PixelCardNo', 'PixelCardTags', 'PixelCardNote', 'PixelCardFoot',
  'PixelCornerMark', 'PixelInlineSign', 'PixelClosedSeal', 'PixelBlockedSeal', 'PixelBlockerChip', 'PixelDimVeil',
  'PixelCardIcon', 'PixelCardBtns', 'PixelMapDots', 'PixelMapStats', 'PixelMapCorner', 'PixelCardHead',
  'PixelIssueCard', 'PixelIssueMapCard', 'PixelMapCard',
]
// 两份 props 契约（只有类型，不会被转译，也不进闭包）。
const CONTRACTS = ['cardBits.d.ts', 'cardProps.d.ts']

// 本仓真实标签配色（与 tests/verify-958-label-name-visible.ts 里那份 GitHub 标签表同源）：
// 卡片拿到的 colorOf 就是「标签名 → 颜色」这张表，配色断言用它才代表真机。
const LABEL_COLORS = {
  'bug': 'd73a4a', 'needs-triage': 'fbca04', 'ready-for-agent': '0e8a16', 'ready-for-human': 'b60205',
  'needs-info': '5319e7', 'wayfinder:map': '8b5cf6', 'wayfinder:task': '10b981', 'wayfinder:research': '0ea5e9',
  'wayfinder:prototype': 'f59e0b', 'wayfinder:grilling': '9d7cd8',
}

// 地图卡夹具：故意按 b、c、w、f 的乱序传进去，好让「按状态排序后落格」这条断言有意义。
const MAP_DOTS = [
  { no: 'b1', cls: 'b', stateText: '被挡住', title: '乙票' },
  { no: 'c1', cls: 'c', stateText: '已结案', title: '甲票' },
  { no: 'w1', cls: 'w', stateText: '已认领', title: '丙票' },
  { no: 'f1', cls: 'f', stateText: '可接', title: '丁票' },
]

/**
 * 读一份叶子真源，换成「构建拼进闭包时的那段文本」：走共用入口的 spliceableJs，
 * 它按唯一转译口径（scripts/lib/transpile-unit.mts）把 .ts 转成可拼接的 JavaScript 并去掉行首 export。
 * 换行统一成 LF（本仓声明 LF 检出，统一一下免得平台差异把比对弄红）。
 */
function readJs (name: string): string { return spliceableJs(CARDS_REL + '/' + name + '.js').replace(/\r\n/g, '\n') }
/** 读一份叶子的原文（按文本形状扫描用：props 契约比对要看到类型标注，不能看转译后的形态）。 */
function readTs (name: string): string { return fs.readFileSync(path.join(CARDS, name + '.ts'), 'utf8').replace(/\r\n/g, '\n') }
/** 去掉行首 export：闭包拼接就是这么拼的（build.mts 拼叶子前也只剥这个）。 */
function stripExports (text: string): string { return text.replace(/^export\s+/gm, '') }

/** 把 16 份真源拼成一段函数体，自由变量只有 React / DswsCtx / tr 三个。 */
function loadCardsLeaves (React_: unknown, DswsCtx_: unknown, tr_: unknown): Record<string, unknown> {
  const body = LEAF_ORDER.map((name) => stripExports(readJs(name))).join('\n')
  const factory = compileFn(['React', 'DswsCtx', 'tr'], body + '\nreturn { ' + LEAF_EXPORTS.join(', ') + ' };')
  return factory(React_, DswsCtx_, tr_)
}

/** 真字典 + src/client/index.ts 里 locale 服务缺失时的同一套退化实现（zh 字典 + {n} 参数替换）。 */
function loadTr (): { L: { zh: Record<string, string> }, tr: (key: string, params?: Record<string, unknown>) => string } {
  const src = spliceableJs('src/client/kernel/locale-cards.js').replace(/\r\n/g, '\n') + '\nreturn L_CARDS;'
  const L = compileFn([], src)()
  const tr = function (key, params) {
    let s = L.zh[key] !== undefined ? L.zh[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m })
    return s
  }
  return { L, tr }
}

// ==== 浅色皮肤（#1380）：票卡、地图卡与技能列表共用同一套浅色纸面 ====
// 判据只看两份样式文本本身，不看渲染：色值写错、深色值被挪进浅色选择器、纸色与技能列表分叉、
// 该走令牌的装饰色又写回裸值，都会报红。抽成纯函数只为一件事：下面要在内存里把同一段文本变坏三次，
// 再用同一套判据跑一遍，证明这扇门能红也能绿（反例只改文本，不落盘）。
// 深色（也就是今天的外观）逐条原值：改这里等于改了深色外观，所以钉死。
const CARD_LIGHT_DARK_TOKENS = [
  ['--cd-frame', '#3a2c14'], ['--cd-card', '#f2e4c0'], ['--cd-ink', '#2b2113'],
  ['--cd-gold', '#e3a92f'], ['--cd-warn', '#f59e0b'], ['--cd-stripe', '#ddcda1'],
  // 深色投影 2026-10-23 由 #241a0c 改纯黑：原来的颜色与页面炭灰底 #1e2023 明度几乎相同，6px 硬投影等于没画。
  // 浅色那一组仍是 #241a0c（纸面上够用），两套皮肤各管各的主题。
  ['--cd-shadow', '#000000'],
]
// 浅色（浅色纸面便签）定版值：与 #1378 的技能列表同一套纸，跨文件那四条在下面单独对。
const CARD_LIGHT_TOKENS = [
  ['--cd-frame', '#3a2c14'], ['--cd-card', '#f6f1e6'], ['--cd-paper', '#fffdf8'],
  ['--cd-old', '#efe8d9'], ['--cd-ink', '#221d15'], ['--cd-ink2', '#6f6252'],
  ['--cd-shadow', '#241a0c'], ['--cd-gold', '#15803d'], ['--cd-ok', '#15803d'],
  ['--cd-sel', '#1e40af'], ['--cd-warn', '#b45309'], ['--cd-bad', '#b91c1c'],
  ['--cd-dim', '#7d7061'], ['--cd-take', '#2456c9'], ['--cd-map', '#6d28d9'],
  ['--cd-stripe', '#e7ddc8'], ['--cd-card2', '#efe8d9'], ['--cd-lit', '#b45309'],
  ['--cd-note', '#b91c1c'], ['--cd-mark-bug', '#b91c1c'], ['--cd-mark-ready', '#15803d'],
  ['--cd-mark-doing', '#1e40af'],
]
// 这些是深色原值里浅色绝不会用到的：出现在浅色覆盖里，就说明有人把深色令牌挪了过去。
const CARD_DARK_ONLY = [
  '#f2e4c0', '#fffdf4', '#e4d5b0', '#2b2113', '#6b5b3e', '#8b5cf6', '#0e8a16',
  '#0ea5e9', '#a3231a', '#9a8f78', '#4a86c8', '#e3a92f', '#ddcda1', '#ffd97a',
  '#8b241a', '#d73a4a', '#10b981', '#2b62b0',
]
// 已经收进 --cd-* 令牌的装饰色：令牌定义那几行剥掉之后，规则体里不该再有这些裸值。
const CARD_BARE_DECOR = ['#ddcda1', '#fffdf4', '#ffd97a', '#8b241a', '#d73a4a', '#10b981', '#2b62b0']

const CARD_LIGHT_RE = /body:not\(\[data-ds-dark-theme\]\) \.cd-card\s*\{([^}]*)\}/
const PIXEL_LIGHT_RE = /body:not\(\[data-ds-dark-theme\]\) \.pixel-tab\s*\{([^}]*)\}/

/** 从一段声明里只取 --*: #rrggbb 的令牌对，别的写法（rgba、普通属性）不进来。 */
function cardTokensOf (decl: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const one of String(decl).split(';')) {
    const m = one.trim().match(/^(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*$/)
    if (m) out[m[1]] = m[2].toLowerCase()
  }
  return out
}

/** 把一段票卡样式文本与技能列表样式文本按浅深两套的判据过一遍，返回不通过的原因（空数组＝全过）。 */
function cardLightProblems (cardsCss: string, pixelCss: string): string[] {
  const out: string[] = []
  // 1) 基础 :root 令牌仍是今天的深色原值（深色零变化的底线）。
  const rootText = (cardsCss.match(/:root\{[^}]*\}/g) || []).join('')
  if (!rootText) out.push('找不到基础 :root 令牌')
  for (const pair of CARD_LIGHT_DARK_TOKENS) {
    if (rootText.indexOf(pair[0] + ':' + pair[1]) < 0) out.push('深色令牌 ' + pair[0] + ' 不再是 ' + pair[1])
  }
  // 2) 浅色令牌覆盖有且只有一组，且只挂在宿主的深色标记上（面板里不许自造开关）。
  //    浅色下允许另有行为规则（#1401 起是键盘焦点环），但必须逐个列出来；多一条就意味着
  //    「浅色另起一套结构」，而浅色只该换令牌。
  const lightBlocks = cardsCss.match(/body:not\(\[data-ds-dark-theme\]\)[^{]*\{/g) || []
  const tokenBlocks = lightBlocks.filter((one) => /\.cd-card\s*\{$/.test(one))
  const allowedExtra = /^body:not\(\[data-ds-dark-theme\]\) \.(?:cd-card|cd-abtn):focus-visible\{$/
  const unexpected = lightBlocks.filter((one) => !/\.cd-card\s*\{$/.test(one) && !allowedExtra.test(one))
  if (tokenBlocks.length !== 1) out.push('浅色令牌覆盖只该有一组（实得 ' + tokenBlocks.length + ' 组）')
  if (unexpected.length > 0) out.push('浅色下多出了令牌覆盖以外的规则：' + unexpected.join('、'))
  const light = cardsCss.match(CARD_LIGHT_RE)
  const lightDecl = light ? light[1] : ''
  if (!light) {
    out.push('缺少 body:not([data-ds-dark-theme]) .cd-card 这一组浅色覆盖')
  } else {
    // 浅色那一组只许写 --cd-* 令牌，值只能是六位十六进制：多写一条普通属性，就是在浅色下另起一套结构。
    for (const one of lightDecl.split(';')) {
      const chip = one.trim()
      if (chip !== '' && !/^--cd-[a-z0-9-]+:\s*#[0-9a-fA-F]{6}$/.test(chip)) out.push('浅色覆盖里混进了不是令牌的写法：' + chip)
    }
    const tokens = cardTokensOf(lightDecl)
    for (const pair of CARD_LIGHT_TOKENS) {
      if (tokens[pair[0]] !== pair[1]) out.push('浅色令牌 ' + pair[0] + ' 该是定版值 ' + pair[1] + '（实得 ' + (tokens[pair[0]] || '没写') + '）')
    }
    for (const val of CARD_DARK_ONLY) {
      if (lightDecl.toLowerCase().indexOf(val) >= 0) out.push('深色原值 ' + val + ' 被挪进了浅色覆盖（浅色该是一套新值）')
    }
  }
  if (/data-(?!ds-dark-theme)[a-z-]*theme/.test(cardsCss)) out.push('出现了宿主深色标记以外的主题标记（面板不许自造开关）')
  if (cardsCss.indexOf('prefers-color-scheme') >= 0) out.push('出现 prefers-color-scheme：深浅只认宿主标记，不猜系统主题')
  // 3) 规则体里的装饰色都走令牌：令牌定义那几行剥掉之后，不该再看到这些裸值。
  const rulesOnly = cardsCss.replace(/:root\{[^}]*\}/g, '').replace(CARD_LIGHT_RE, '')
  for (const raw of CARD_BARE_DECOR) {
    if (rulesOnly.toLowerCase().indexOf(raw) >= 0) out.push('规则体里还有裸装饰色 ' + raw + '（浅色该走 --cd-* 令牌）')
  }
  // 4) 浅色下必须真的看得到：棋盘、纸底、点亮的墙格、红字都得走令牌，不能再写死深色纸色。
  if (!/\.cd-grid2\{[^}]*background:var\(--cd-stripe\)/.test(cardsCss)) out.push('.cd-grid2 的棋盘底没用 --cd-stripe')
  if (!/\.cd-readout\{[^}]*background:var\(--cd-paper\)/.test(cardsCss)) out.push('.cd-readout 的纸底没用 --cd-paper')
  if (!/\.cd-wall i\.lit\{[^}]*outline:3px solid var\(--cd-lit\)/.test(cardsCss)) out.push('.cd-wall i.lit 的外圈没用 --cd-lit（浅色纸上会看不见）')
  if (!/\.cd-note\{[^}]*color:var\(--cd-note\)/.test(cardsCss)) out.push('.cd-note 的红字没用 --cd-note')
  // 5) 跨文件：票卡与技能列表必须是同一套纸（#1377 的硬要求：纸色不分叉）。
  const pixelLight = pixelCss.match(PIXEL_LIGHT_RE)
  if (!pixelLight) {
    out.push('技能列表（PixelStyles.ts）里找不到 body:not([data-ds-dark-theme]) .pixel-tab 浅色块')
  } else {
    const pixelTokens = cardTokensOf(pixelLight[1])
    const cardTokens = cardTokensOf(lightDecl)
    const pairs = [
      ['--cd-card', '--pixel-paper'], ['--cd-paper', '--pixel-card'],
      ['--cd-frame', '--pixel-frame'], ['--cd-gold', '--pixel-acc'],
    ]
    for (const pair of pairs) {
      const a = cardTokens[pair[0]]
      const b = pixelTokens[pair[1]]
      if (!a || !b || a !== b) out.push('纸色分叉了：' + pair[0] + '（' + (a || '没写') + '）与 ' + pair[1] + '（' + (b || '没写') + '）该同值')
    }
  }
  // 6) 两条硬线：容器颜色门禁锁着的那一处警告色只能有一份；容器身份色一处都不许碰。
  if (cardsCss.split('--cd-warn:#f59e0b').length - 1 !== 1) out.push('--cd-warn:#f59e0b 该有且只有一处（verify-container-colors 的白名单锁着它）')
  if (/#1d4ed8/i.test(cardsCss)) out.push('出现了容器身份蓝 #1d4ed8（全仓零容忍）')
  if (/#c084fc/i.test(cardsCss)) out.push('出现了探索地图身份紫 #c084fc（全仓零容忍）')
  return out
}

/** WCAG 相对亮度与对比度：浅色纸面上的字要真算一遍，不凭眼睛。算法与技能详情栈门禁共用 tests/lib/contrast.ts。 */
const { relativeLuminance: cardLightLum, contrastRatio: cardLightContrast } = require('./lib/contrast.ts')

let WIN = null
let DOC = null

/** 建一个 jsdom 页面，并把这一层的皮肤（PixelCardsStyles 导出的真样式文本）注入进去。 */
function setupDom (styleText: string) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:19387/' })
  const style = dom.window.document.createElement('style')
  style.textContent = styleText
  dom.window.document.head.appendChild(style)
  global.window = dom.window
  global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  WIN = dom.window
  DOC = dom.window.document
  return dom
}

/**
 * 挂一个元素，返回一把「量结果」的尺子。
 * 每次挂载都新开一个容器，量完 unmount（不 unmount 的话下一次挂载会量到上一次的残留）。
 */
async function mountElement (element: unknown) {
  const host = DOC.createElement('div')
  DOC.body.appendChild(host)
  const reactRoot = ReactDOMClient.createRoot(host)
  await act(async () => { reactRoot.render(element) })
  const pick = (target) => (typeof target === 'string' ? host.querySelector(target) : target)
  return {
    host,
    doc: DOC,
    win: WIN,
    q: (sel) => host.querySelector(sel),
    qa: (sel) => Array.from(host.querySelectorAll(sel)),
    text: (sel) => { const el = host.querySelector(sel); return el ? String(el.textContent || '') : null },
    texts: (sel) => Array.from(host.querySelectorAll(sel)).map((el) => String(el.textContent || '')),
    cs: (target) => {
      const el = pick(target)
      // 组件没画出这个节点时给一个空壳，让 check 记一条 FAIL（实得 undefined），
      // 而不是当场抛异常把整趟跑断——门禁要能一次报全所有问题。
      if (!el) { check(false, '量不到元素的计算样式：' + String(target) + '（组件没画出它）'); return {} }
      return WIN.getComputedStyle(el)
    },
    async click (target) {
      const el = pick(target)
      if (!el) { check(false, '点不到元素：' + String(target) + '（组件没画出它）'); return }
      await act(async () => { el.dispatchEvent(new WIN.MouseEvent('click', { bubbles: true })) })
    },
    async hover (target) {
      const el = pick(target)
      if (!el) { check(false, '悬停不到元素：' + String(target) + '（组件没画出它）'); return }
      await act(async () => { el.dispatchEvent(new WIN.MouseEvent('mouseover', { bubbles: true })) })
    },
    async unmount () {
      await act(async () => { reactRoot.unmount() })
      host.remove()
    },
  }
}
const mountCard = (Component, props) => mountElement(React.createElement(Component, props))

/** 标题节点自己那一段文本（不含后面挂的「已认领」小字）；没给标题时返回 null。 */
const titleOwnText = (h) => {
  const el = h.q('.cd-tt') || h.q('h3')
  if (!el || !el.firstChild) return null
  return el.firstChild.nodeType === 3 ? String(el.firstChild.nodeValue) : null
}
const countOf = (sel) => (h) => h.qa(sel).length
const nthText = (sel, i) => (h) => { const el = h.qa(sel)[i]; return el ? String(el.textContent || '') : null }
// 下面几个「取第 i 个节点上的内联样式 / 属性」的尺子，节点不在时给 null：
// 组件少画了一个节点时，断言要记一条 FAIL 报出来，而不是当场抛异常把整趟跑断。
const cssOf = (sel, i, prop) => (h) => { const el = h.qa(sel)[i]; return el ? el.style[prop] : null }
const attrOf = (sel, i, name) => (h) => { const el = h.qa(sel)[i]; return el ? el.getAttribute(name) : null }
const cssOne = (sel, prop) => (h) => { const el = h.q(sel); return el ? el.style[prop] : null }

/**
 * 「这个 props 字段真的被用上」的检查：同一份 props，去掉这个字段量一次、带上它再量一次，
 * 观察点必须从「不是期望值」变成「就是期望值」。只量带上字段的那一次，证明不了它没被忽略。
 */
async function checkPropUsed (label: string, Component: unknown, base: Record<string, unknown>, field: string, value: unknown, observe: unknown, expected: unknown): Promise<void> {
  const off = Object.assign({}, base)
  delete off[field]
  const offHandle = await mountCard(Component, off)
  const offGot = await observe(offHandle)
  await offHandle.unmount()
  const onHandle = await mountCard(Component, Object.assign({}, base, { [field]: value }))
  const onGot = await observe(onHandle)
  await onHandle.unmount()
  check(onGot === expected && offGot !== expected,
    label + ' 的 ' + field + ' 真的被用上：带上它是 ' + show(onGot) + '，去掉它是 ' + show(offGot) + '（期望 ' + show(expected) + '）')
}

// ===========================================================================
// 0. 前置检查：真源与契约都在，源码树里没有落回来的同名 .js 产物
// ===========================================================================
section('0. 前置检查：真源、契约都在，叶子旁边没有同名 .js 产物')
check(fs.existsSync(CARDS), CARDS_REL + ' 目录存在')
{
  const missingTs = LEAF_ORDER.filter((name) => !fs.existsSync(path.join(CARDS, name + '.ts')))
  check(missingTs.length === 0,
    'cards 目录里 16 份叶子的 .ts 真源都齐（缺的：' + (missingTs.length ? missingTs.join('、') : '无') + '）')
  const missingContracts = CONTRACTS.filter((f) => !fs.existsSync(path.join(CARDS, f)))
  check(missingContracts.length === 0,
    '两份 props 契约 ' + CONTRACTS.join('、') + ' 都在（缺的：' + (missingContracts.length ? missingContracts.join('、') : '无') + '）')
  // 2026-10-19 起 pixel-ts 那一步删掉了：拼接缝直接读 .ts，产物只该留在 client.js 里。
  // 这一条守「没有人把同名 .js 又生成回来」——落回来就说明构建里还有第二条写源码树的流水线。
  const strayJs = LEAF_ORDER.filter((name) => fs.existsSync(path.join(CARDS, name + '.js')))
  check(strayJs.length === 0,
    '叶子旁边没有同名 .js 产物（多出来的：' + (strayJs.length ? strayJs.join('、') : '无') + '）')
}

// ===========================================================================
// 1. 按闭包拼接次序装载真产物，并用真字典搭出 tr
// ===========================================================================
section('1. 按闭包拼接次序装载真源，tr 用 src/client/kernel/locale-cards.ts 的真字典')
const DswsCtx = React.createContext(null)
const { L, tr } = loadTr()
check(L && L.zh && Object.keys(L.zh).length > 0,
  '真字典读到了（locale-cards.js 的 zh 词条 ' + (L && L.zh ? Object.keys(L.zh).length : 0) + ' 条）')
check(tr('card.newSession') === '新会话' && tr('card.updated', { n: '刚刚' }) === '更新 刚刚',
  'tr 按 index.js 的退化口径工作：card.newSession = ' + show(tr('card.newSession')) +
  '，card.updated{n=刚刚} = ' + show(tr('card.updated', { n: '刚刚' })))
let M = null
try { M = loadCardsLeaves(React, DswsCtx, tr) } catch (e) { check(false, '装载 cards 产物：' + ((e && e.message) || e)) }
{
  const missing = M ? LEAF_EXPORTS.filter((n) => M[n] === undefined) : LEAF_EXPORTS
  check(M && missing.length === 0,
    '16 份 .js 拼起来后，' + LEAF_EXPORTS.length + ' 个导出名全都取得到（缺的：' + (missing.length ? missing.join('、') : '无') + '）')
}
setupDom(M.PIXEL_CARDS_STYLE_TEXT.join('\n'))

// ===========================================================================
// 2 起：真渲染断言（jsdom + 真 React），全部走 async，所以收在一个 main 里
// ===========================================================================
async function main (): Promise<void> {
  // 卡片拿到的颜色表 = 标签色 + 实施身份色。实施身份色来自中央色表（CONTAINER_ACCENT），
  // 页面层就是这么把 CONTAINER_ACCENT.spec 放进 colorOf 交给卡片的（见 MapDetailV2Page.ts）；
  // 卡片层不写第二份身份色，所以这里也按页面那张表取色，而不是从卡片主题表里找 implement。
  const CONTAINER_ACCENT = (await import('../src/client/kernel/container-view.js')).CONTAINER_ACCENT
  const PAGE_COLOR_OF = Object.assign({}, LABEL_COLORS, {
    implement: String(CONTAINER_ACCENT.spec).replace(/^#/, '').toLowerCase(),
  })
  // =========================================================================
  // 2. 三张卡能挂起来，关键结构真的出现
  // =========================================================================
  section('2. 三张卡挂起来：编号 / 标题 / 按钮区 / 标签区 / 脚注 都在')

  // ---- 2.1 地图卡 PixelMapCard ----
  {
    const hovered = []
    const h = await mountCard(M.PixelMapCard, {
      mapNo: '841', title: '像素风卡片这一层', open: true,
      updatedText: '今天 07:40', dateText: '2026-10-12', dots: MAP_DOTS, onHover: (no) => hovered.push(no),
    })
    check(h.qa('.cd-card.mapcard').length === 1, '地图卡挂起来了，卡片容器出现 1 个（实得 ' + h.qa('.cd-card.mapcard').length + ' 个）')
    check(h.text('.cd-hd b') === '#841', '地图卡编号看得见：#841（实得 ' + show(h.text('.cd-hd b')) + '）')
    check(h.text('.cd-hd span') === tr('card.mapSign') && h.text('.cd-st') === tr('card.openState'),
      '地图卡的「map」标记与在办状态戳都是真词条（实得 ' + show(h.text('.cd-hd span')) + ' / ' + show(h.text('.cd-st')) + '）')
    check(h.text('h3') === '像素风卡片这一层', '地图卡标题文本看得见（实得 ' + show(h.text('h3')) + '）')
    check(h.qa('.cd-wall i').length === MAP_DOTS.length,
      '点阵墙按 dots 出格子，4 张票 4 个点（实得 ' + h.qa('.cd-wall i').length + ' 个）')
    check(h.qa('.cd-legend span').length === 4 && h.texts('.cd-legend span').join('|') ===
      [tr('card.legendReady'), tr('card.legendBlocked'), tr('card.legendClaimed'), tr('card.legendClosed')].join('|'),
      '图例四格是「可接 / 被挡住 / 已认领 / 已结案」四条真词条（实得 ' + show(h.texts('.cd-legend span').join('|')) + '）')
    check(h.text('.cd-readout') === tr('card.readoutIdle'),
      '没人悬停时读数框是待机话术（实得 ' + show(h.text('.cd-readout')) + '）')
    check(h.text('.cd-ft') === tr('card.lastUpdate', { n: '今天 07:40', d: '2026-10-12' }),
      '脚注把更新时间与日期都写进去了（实得 ' + show(h.text('.cd-ft')) + '）')
    check(h.qa('.cd-wall i').map((el) => el.className).join(',') === 'c,f,w,b',
      '点阵墙按状态排序后落格：传进来 b,c,w,f，画出来是 c,f,w,b（实得 ' + show(h.qa('.cd-wall i').map((el) => el.className).join(',')) + '）')
    // 悬停一个点：读数框换成那张票，回调报出票号，被指到的点带上 lit。
    const second = h.qa('.cd-wall i')[1]
    await h.hover(second)
    check(h.q('.cd-readout').className === 'cd-readout f' && h.text('.cd-readout') === '#f1可接丁票',
      '悬停第 2 个点（f1）后读数框换成那张票：' + show(h.text('.cd-readout')) + '（实得类名 ' + show(h.q('.cd-readout').className) + '）')
    check(hovered.join(',') === 'f1' && second.className === 'f lit',
      '悬停时报出票号 f1 并给这个点加上 lit（实得回调 ' + show(hovered.join(',')) + '，点类名 ' + show(second.className) + '）')
    await h.unmount()
  }

  // ---- 2.2 票卡 PixelIssueCard ----
  {
    const h = await mountCard(M.PixelIssueCard, {
      action: 'fix', noText: '#841', title: '像素风卡片这一层要有自己的门禁',
      tags: [{ text: 'bug', color: 'd73a4a' }, { text: 'wayfinder:task', color: '10b981' }],
      note: '这一行是红字脚注', updatedText: '今天 07:40', footActionText: '看详情',
      claimedBy: '张三', pickCorner: 'doing', colorOf: LABEL_COLORS,
    })
    check(h.qa('.cd-card').length === 1, '票卡挂起来了，卡片容器出现 1 个（实得 ' + h.qa('.cd-card').length + ' 个）')
    check(h.text('.cd-nonum') === '#841', '票卡编号看得见：#841（实得 ' + show(h.text('.cd-nonum')) + '）')
    check(cssOne('.cd-nonum', 'background')(h) === 'rgb(215, 58, 74)',
      '编号徽章的底色跟着 fix 动作走，取的是真标签色 bug=d73a4a（实得 ' + show(cssOne('.cd-nonum', 'background')(h)) + '）')
    check(h.text('h3') === '像素风卡片这一层要有自己的门禁' + tr('card.claimedBy', { n: '张三' }),
      '标题文本与「已认领」小字都在标题节点里（实得 ' + show(h.text('h3')) + '）')
    check(h.qa('.cd-lbrow .cd-chip').length === 2 && h.texts('.cd-chip').join('|') === 'bug|wayfinder:task',
      '标签区按 tags 出两个 chip：bug、wayfinder:task（实得 ' + show(h.texts('.cd-chip').join('|')) + '）')
    check(h.qa('.cd-note').length === 1 && h.text('.cd-note') === '这一行是红字脚注',
      '红字脚注出现且文本正确（实得 ' + show(h.text('.cd-note')) + '）')
    check(h.qa('.cd-actions .cd-abtn').length === 4, '按钮区出现 4 颗按钮（实得 ' + h.qa('.cd-actions .cd-abtn').length + ' 颗）')
    check(h.texts('.cd-ft span').join('|') === tr('card.updated', { n: '今天 07:40' }) + '|看详情',
      '脚注左边是更新时间、右边是 footActionText（实得 ' + show(h.texts('.cd-ft span').join('|')) + '）')
    check(h.qa('.cd-ckb').length === 1 && h.text('.cd-ckb') === tr('card.doing'),
      'pickCorner=doing 时右上角出现「在办」角标（实得 ' + show(h.text('.cd-ckb')) + '）')
    check(h.qa('.cd-pin').length === 1, '未结案的票卡顶上是一颗图钉（实得 ' + h.qa('.cd-pin').length + ' 个）')
    await h.unmount()
  }

  // ---- 2.3 地图子票卡 PixelIssueMapCard ----
  {
    const h = await mountCard(M.PixelIssueMapCard, {
      mapNo: '841', title: '地图子票', open: false, kids: 7, ready: 2, blocked: 1,
      updatedText: '昨天 18:00', claimedBy: '李四', sign: 'doing',
      dots: [{ color: '#0e8a16', n: 3 }, { color: '#a3231a', n: 2 }],
    })
    check(h.qa('.cd-card.wide').length === 1, '地图子票卡挂起来了，宽卡容器出现 1 个（实得 ' + h.qa('.cd-card.wide').length + ' 个）')
    check(h.text('.cd-nonum') === '#841', '子票卡编号看得见：#841（实得 ' + show(h.text('.cd-nonum')) + '）')
    check(cssOne('.cd-nonum', 'background')(h) === 'rgb(139, 92, 246)',
      '子票卡编号用地图紫 #8b5cf6（实得 ' + show(cssOne('.cd-nonum', 'background')(h)) + '）')
    check(h.text('.cd-tt') === '地图子票' + tr('card.claimedBy', { n: '李四' }),
      '子票卡标题与「已认领」小字都在（实得 ' + show(h.text('.cd-tt')) + '）')
    check(h.qa('.cd-grid2 i').length === 5, '小点阵按 dots 展开：3 + 2 = 5 个点（实得 ' + h.qa('.cd-grid2 i').length + ' 个）')
    check(h.texts('.cd-mstats span').join('|') === tr('card.sub') + ' 7|' + tr('card.pickReady') + ' 2|' + tr('card.blockedCount') + ' 1',
      '统计条三格是「子票 7 / 可接 2 / 被挡 1」（实得 ' + show(h.texts('.cd-mstats span').join('|')) + '）')
    check(h.qa('.cd-actions .cd-abtn').length === 4 && h.text('.cd-abtn.label') === tr('card.execute'),
      '子票卡按钮区 4 颗，主按钮话术是「执行」（实得 ' + show(h.text('.cd-abtn.label')) + '）')
    check(h.qa('.cd-sealcn').length === 1 && h.text('.cd-sealcn') === tr('card.closedSeal'),
      'open=false 时页头挂出结案章（实得 ' + show(h.text('.cd-sealcn')) + '）')
    check(h.qa('.cd-mstate').length === 1 && h.text('.cd-mstate') === tr('card.doing'),
      'sign=doing 时页头出现「在办」小签（实得 ' + show(h.text('.cd-mstate')) + '）')
    check(h.text('.cd-ft') === tr('card.updated', { n: '昨天 18:00' }) && h.text('.cd-mapcorner') === tr('card.map'),
      '脚注是更新时间，右上角是 MAP 角标（实得 ' + show(h.text('.cd-ft')) + ' / ' + show(h.text('.cd-mapcorner')) + '）')
    await h.unmount()
  }

  // =========================================================================
  // 3. 按钮行按动作出按钮（四种按钮恒定，主按钮的话术 / 配色 / 图标跟着动作走）
  // =========================================================================
  section('3. 按钮行按动作出按钮：条数恒定，话术 / 配色 / 图标 / 回调跟着动作走')
  {
    const actions = Object.keys(M.CARD_ACTION_STYLE)
    check(actions.length === 9, '动作表里 9 种动作都在（实得 ' + actions.length + ' 种：' + actions.join('、') + '）')
    const iconMarkup = {}
    for (const action of actions) {
      const style = M.CARD_ACTION_STYLE[action]
      // 大多数动作的 colorKey 指向 GitHub 标签表；implement 不在标签表里，它的底色是实施地图的
      // 身份色（CONTAINER_ACCENT.spec），由页面层放进 colorOf 交给卡片。两条路都查不到才算错。
      const hex = LABEL_COLORS[style.colorKey] || PAGE_COLOR_OF[style.colorKey]
      check(!!hex, action + ' 动作的 colorKey=' + style.colorKey + ' 在真标签表或页面给的实施色表里查得到')
      if (!hex) continue
      const expectedColor = 'rgb(' + [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((x) => parseInt(x, 16)).join(', ') + ')'
      const h = await mountCard(M.PixelIssueCard, { action, noText: '#1', title: 't', colorOf: PAGE_COLOR_OF })
      const btns = h.qa('.cd-actions .cd-abtn')
      check(btns.length === 4, action + ' 动作下按钮还是 4 颗（实得 ' + btns.length + ' 颗）')
      const expectedLabel = L.zh['card.act.' + action]
      check(btns[0].textContent === expectedLabel,
        action + ' 动作的主按钮话术取真词条 card.act.' + action + ' = ' + show(expectedLabel) + '（实得 ' + show(btns[0].textContent) + '）')
      check(btns[0].style.background === expectedColor,
        action + ' 动作的主按钮底色取 colorKey=' + style.colorKey + ' 的真标签色（期望 ' + expectedColor + '，实得 ' + show(btns[0].style.background) + '）')
      // 图标：主按钮里那颗 svg 必须与「按动作声明取名的图标」画出来的一模一样。
      const iconHandle = await mountElement(React.createElement(M.PixelCardIcon, { n: style.icon }))
      const expectedIcon = iconHandle.q('svg').outerHTML
      await iconHandle.unmount()
      iconMarkup[action] = btns[0].querySelector('svg').outerHTML
      check(iconMarkup[action] === expectedIcon,
        action + ' 动作的主按钮图标就是 CARD_ACTION_STYLE 里声明的 ' + style.icon + '（实得 ' + (iconMarkup[action] === expectedIcon ? '一致' : '不一致') + '）')
      // 徽章形态：hollow 的动作画描边徽章，其余画实心徽章。
      const badge = h.q('.cd-nonum')
      const hollowDrawn = badge.className.indexOf('line') >= 0
      check(hollowDrawn === !!style.hollow && (style.hollow ? badge.style.borderColor === expectedColor : badge.style.background === expectedColor),
        action + ' 动作的编号徽章形态跟着 hollow=' + String(!!style.hollow) + ' 走（实得类名 ' + show(badge.className) +
        '，边框 ' + show(badge.style.borderColor) + '，底色 ' + show(badge.style.background) + '）')
      await h.unmount()
    }
    const distinctIcons = new Set(Object.keys(iconMarkup).map((k) => iconMarkup[k])).size
    check(distinctIcons === 5, '9 种动作画出的主按钮图标有 5 种不同图形（chat/hammer/play/search/proto，实得 ' + distinctIcons + ' 种）')
  }

  // ---- 3.1 四种按钮各自的回调与不冒泡 ----
  {
    const calls = []
    const bubbled = []
    const h = await mountElement(React.createElement('div', { onClick: () => bubbled.push('card') },
      React.createElement(M.PixelIssueCard, {
        action: 'execute', title: 't', colorOf: LABEL_COLORS,
        onMain: () => calls.push('main'), onNew: () => calls.push('new'),
        onCopy: () => calls.push('copy'), onOpen: () => calls.push('open'),
      })))
    const btns = h.qa('.cd-abtn')
    await h.click(btns[0]); await h.click(btns[1]); await h.click(btns[2]); await h.click(btns[3])
    check(calls.join(',') === 'main,new,copy,open',
      '四颗按钮分别打到 onMain / onNew / onCopy / onOpen（实得 ' + show(calls.join(',')) + '）')
    check(bubbled.length === 0, '按钮点击不冒泡到卡片外面（外面那层 onClick 被调用 ' + bubbled.length + ' 次）')
    check(attrOf('.cd-abtn', 2, 'title')(h) === tr('card.copyLink') && attrOf('.cd-abtn', 3, 'title')(h) === tr('card.openLink'),
      '两颗图标按钮的悬停提示是真词条「复制链接 / 打开链接」（实得 ' + show(attrOf('.cd-abtn', 2, 'title')(h)) + ' / ' + show(attrOf('.cd-abtn', 3, 'title')(h)) + '）')
    check(h.texts('.cd-abtn').join('|') === tr('card.act.execute') + '|' + tr('card.newSession') + '||',
      '第二颗按钮写死是「新会话」，后两颗只有图标没有字（实得 ' + show(h.texts('.cd-abtn').join('|')) + '）')
    await h.unmount()
  }

  // ---- 3.2 不传回调时照样画得出按钮，点了也不炸 ----
  {
    const h = await mountCard(M.PixelCardBtns, { mainLabel: '干', icon: 'play', mainColor: 'd73a4a' })
    const btns = h.qa('.cd-abtn')
    check(btns.length === 4 && nthText('.cd-abtn', 0)(h) === '干',
      '直接挂 PixelCardBtns、不给任何回调：4 颗按钮照画（实得 ' + btns.length + ' 颗，首颗 ' + show(nthText('.cd-abtn', 0)(h)) + '）')
    let threw = null
    try { await h.click(btns[0]); await h.click(btns[1]); await h.click(btns[2]); await h.click(btns[3]) } catch (e) { threw = (e && e.message) || String(e) }
    check(threw === null, '没有回调时四颗按钮点了都不抛错（抛错：' + show(threw) + '）')
    check(cssOf('.cd-abtn', 0, 'background')(h) === 'rgb(215, 58, 74)' && cssOf('.cd-abtn', 0, 'color')(h) === 'rgb(28, 16, 4)',
      '主按钮底色用 mainColor，字色用 cardInkOn 算出来的深墨（实得 ' + show(cssOf('.cd-abtn', 0, 'background')(h)) + ' / ' + show(cssOf('.cd-abtn', 0, 'color')(h)) + '）')
    await h.unmount()
  }

  // ---- 3.3 没给 colorOf 时退回默认紫 ----
  {
    const h = await mountCard(M.PixelIssueCard, { action: 'fix', title: 't' })
    check(cssOne('.cd-nonum', 'background')(h) === 'rgb(139, 92, 246)' && cssOne('.cd-abtn.label', 'background')(h) === 'rgb(139, 92, 246)',
      '没有 colorOf 表时，徽章与主按钮都退回默认紫 #8b5cf6（实得 ' + show(cssOne('.cd-nonum', 'background')(h)) + ' / ' + show(cssOne('.cd-abtn.label', 'background')(h)) + '）')
    await h.unmount()
  }

  // =========================================================================
  // 4. 标题截断：两行 / 三行在计算样式上真的生效
  // =========================================================================
  section('4. 标题截断：两行与三行的 clamp 真的落到计算样式上')
  {
    const issue = await mountCard(M.PixelIssueCard, { title: '很长的标题'.repeat(6), claimedBy: '张三' })
    const tt = issue.q('.cd-tt')
    const cs = issue.cs(tt)
    check(cs.display === '-webkit-box', '票卡标题的 display 是 -webkit-box（clamp 生效的前提，实得 ' + show(cs.display) + '）')
    check(cs.webkitLineClamp === '2', '票卡标题限制在两行（-webkit-line-clamp 实得 ' + show(cs.webkitLineClamp) + '）')
    check(cs.overflow === 'hidden', '票卡标题溢出裁掉（overflow 实得 ' + show(cs.overflow) + '）')
    check(cs.minHeight === '38px', '票卡标题给两行留出 38px 最小高度（实得 ' + show(cs.minHeight) + '）')
    check(cs.webkitBoxOrient === 'vertical', '标题盒子是纵向排的（-webkit-box-orient 实得 ' + show(cs.webkitBoxOrient) + '）')
    check(!!tt && !!tt.querySelector('.cd-take'), '「已认领」小字在截断盒子里（附加元素与标题同一个 clamp 盒子）')
    await issue.unmount()

    const map = await mountCard(M.PixelIssueMapCard, { mapNo: '841', title: '很长的标题'.repeat(6), open: true })
    const tall = map.q('.cd-tt')
    const tcs = map.cs(tall)
    check(!!tall && tall.className === 'cd-tt tall' && tcs.webkitLineClamp === '3',
      '子票卡标题走三行档：类名 cd-tt tall，-webkit-line-clamp 实得 ' + show(tcs.webkitLineClamp) + '（类名 ' + show(tall ? tall.className : null) + '）')
    check(tcs.minHeight === '0px' && tcs.display === '-webkit-box',
      '三行档把两行那份最小高度让掉（min-height 实得 ' + show(tcs.minHeight) + '），仍是 -webkit-box 盒子')
    await map.unmount()

    // 同一份组件、只差 tall 一个开关：两行与三行必须是两条不同的计算值。
    const pair = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelCardTitle, { text: '普通' }),
      React.createElement(M.PixelCardTitle, { text: '高', tall: true })))
    const [two = null, three = null] = pair.qa('.cd-tt')
    check(pair.cs(two).webkitLineClamp === '2' && pair.cs(three).webkitLineClamp === '3',
      '同一个组件只差 tall 开关：两行档量到 ' + show(pair.cs(two).webkitLineClamp) + '，三行档量到 ' + show(pair.cs(three).webkitLineClamp) + '（不是恒真）')
    // 反证：这把尺子量的是元素自己的计算样式 —— 就地改掉声明，量到的值必须跟着变。
    if (three) {
      three.style.setProperty('-webkit-line-clamp', 'unset')
      check(pair.cs(three).webkitLineClamp !== '3',
        '反证：把三行档那条 -webkit-line-clamp 就地改成 unset 后量不到 3（实得 ' + show(pair.cs(three).webkitLineClamp) + '）')
      three.style.setProperty('display', 'block')
      check(pair.cs(three).display !== '-webkit-box' && pair.cs(three).webkitLineClamp !== '3',
        '反证：把标题就地改成 display:block 后它不再是 -webkit-box 盒子（实得 display ' + show(pair.cs(three).display) + '）')
    }
    await pair.unmount()
  }

  // =========================================================================
  // 5. 小件的行为
  // =========================================================================
  section('5. 小件的行为：编号徽章 / 点阵与统计条 / 标签 chips / 被阻塞与挡路两种形态')

  // ---- 5.1 编号徽章 PixelCardNo ----
  {
    const h = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelCardNo, { text: '#5', action: 'research', colorOf: LABEL_COLORS }),
      React.createElement(M.PixelCardNo, { text: '#6', action: 'fix', colorOf: LABEL_COLORS }),
      React.createElement(M.PixelCardNo, { text: '#7', action: 'research', hollow: false, colorOf: LABEL_COLORS }),
      React.createElement(M.PixelCardNo, { text: '#8' })))
    const [hollow = {}, solid = {}, forced = {}, fallback = {}] = h.qa('.cd-nonum')
    check(hollow.className === 'cd-nonum line' && hollow.style.borderColor === 'rgb(14, 165, 233)' && !hollow.style.background,
      'research 动作画描边徽章：borderColor 取真标签色 0ea5e9、不填底色（实得 ' + show(hollow.className) + ' / ' + show(hollow.style.borderColor) + '）')
    check(solid.className === 'cd-nonum' && solid.style.background === 'rgb(215, 58, 74)' && solid.style.color === 'rgb(28, 16, 4)',
      'fix 动作画实心徽章：底色 d73a4a、字色用深墨（实得 ' + show(solid.style.background) + ' / ' + show(solid.style.color) + '）')
    check(forced.className === 'cd-nonum' && forced.style.background === 'rgb(14, 165, 233)',
      '显式给 hollow=false 能压过动作表里的描边档（实得 ' + show(forced.className) + ' / ' + show(forced.style.background) + '）')
    check(fallback.style.background === 'rgb(139, 92, 246)',
      '没有 colorOf 表时退回默认紫（实得 ' + show(fallback.style.background) + '）')
    check(h.qa('.cd-nonum').map((el) => el.textContent).join('|') === '#5|#6|#7|#8',
      '徽章上的编号原样画出来（实得 ' + show(h.qa('.cd-nonum').map((el) => el.textContent).join('|')) + '）')
    await h.unmount()
  }

  // ---- 5.2 点阵与统计条 PixelMapDots / PixelMapStats ----
  {
    const h = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelMapDots, { cells: [{ color: '#0e8a16', n: 2 }, { color: '#a3231a', n: 3 }] }),
      React.createElement(M.PixelMapDots, { cells: [] }),
      React.createElement(M.PixelMapStats, { kids: 7, ready: 2, blocked: 1 }),
      React.createElement(M.PixelMapStats, {})))
    const walls = h.qa('.cd-grid2')
    const cells = Array.from(walls[0] ? walls[0].querySelectorAll('i') : [])
    check(cells.length === 5, '点阵把 cells 展开成格子：2 + 3 = 5 个（实得 ' + cells.length + ' 个）')
    check(cells.map((el) => el.style.background).join('|') === 'rgb(14, 138, 22)|rgb(14, 138, 22)|rgb(163, 35, 26)|rgb(163, 35, 26)|rgb(163, 35, 26)',
      '每个格子用自己那一组的颜色，按组依次铺开（实得 ' + show(cells.map((el) => el.style.background).join('|')) + '）')
    const emptyCells = walls[1] ? walls[1].querySelectorAll('i').length : null
    check(emptyCells === 0, 'cells 为空时一个格子都不画（实得 ' + show(emptyCells) + ' 个）')
    const stats = h.qa('.cd-mstats')
    check(nthText('.cd-mstats', 0)(h) === tr('card.sub') + ' 7' + tr('card.pickReady') + ' 2' + tr('card.blockedCount') + ' 1',
      '统计条把三个数写进三格（实得 ' + show(nthText('.cd-mstats', 0)(h)) + '）')
    check(nthText('.cd-mstats', 1)(h) === tr('card.sub') + ' 0' + tr('card.pickReady') + ' 0' + tr('card.blockedCount') + ' 0',
      '没给数字时三格都写 0，不是空白（实得 ' + show(nthText('.cd-mstats', 1)(h)) + '）')
    await h.unmount()
  }

  // ---- 5.3 标签 chips PixelCardTags ----
  {
    const h = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelCardTags, { tags: [{ text: 'bug', color: 'd73a4a' }, { text: '白底', color: '#ffffff' }, { text: '黑底', color: '#000000' }] }),
      React.createElement(M.PixelCardTags, { tags: [] }),
      React.createElement(M.PixelCardTags, {})))
    const chips = h.qa('.cd-chip')
    check(chips.length === 3, '三个标签出三个 chip（实得 ' + chips.length + ' 个）')
    check(chips.map((el) => el.textContent).join('|') === 'bug|白底|黑底', 'chip 上的字就是标签名（实得 ' + show(chips.map((el) => el.textContent).join('|')) + '）')
    check(chips.map((el) => el.style.background).join('|') === 'rgb(215, 58, 74)|rgb(255, 255, 255)|rgb(0, 0, 0)',
      'chip 底色用标签自己的颜色，带不带 # 都认（实得 ' + show(chips.map((el) => el.style.background).join('|')) + '）')
    check(chips[1].style.color === 'rgb(28, 16, 4)' && chips[2].style.color === 'rgb(255, 249, 236)',
      '字色按底色亮度翻转：白底用深墨、黑底用米白（实得 ' + show(chips[1].style.color) + ' / ' + show(chips[2].style.color) + '）')
    check(h.qa('.cd-lbrow').length === 3 && h.qa('.cd-lbrow')[1].children.length === 0,
      '标签区容器照画，没有标签时里面是空的（第二个容器子节点 ' + h.qa('.cd-lbrow')[1].children.length + ' 个）')
    await h.unmount()
  }

  // ---- 5.4 被阻塞与挡路两种形态 PixelBlockedChrome（含点亮时才出现的红条）----
  {
    const h = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelIssueCard, {
        cardId: 'card-a', noText: '#1', title: '被挡住的那张',
        blockedBy: { no: '12', title: '上游票', cardId: 'card-b' }, blocksChip: { no: '3', title: '下游票' },
      }),
      React.createElement(M.PixelIssueCard, { cardId: 'card-c', noText: '#2', title: '只知道被哪张挡', blockedBy: { no: '13' } }),
      React.createElement('div', { id: 'card-b', className: 'cd-card' }, '挡路的那张')))
    const seal = h.q('.cd-bseal')
    const sealNo = seal ? seal.querySelector('.cd-bseal-l1') : null
    const sealTitle = seal ? seal.querySelector('.cd-bseal-t') : null
    const veils = h.qa('.cd-dimveil')
    const veil = veils[0] || null
    const veilNoTitle = veils[1] || null
    const chip = h.q('.cd-bchip')
    check(!!seal && !!sealNo && sealNo.textContent === tr('card.blockedSeal', { n: '#12' }),
      '被阻塞的卡挂出斜封条，第一行写着「被 #12 阻塞」（实得 ' + show(sealNo && sealNo.textContent) + '）')
    check(!!seal && !!sealTitle && sealTitle.textContent === '上游票' && seal.getAttribute('title') === tr('card.blockedSeal', { n: '#12' }) + ' 上游票',
      '封条第二行画出挡路票标题，完整标题也进 title 属性方便悬停看全（实得 ' + show(sealTitle && sealTitle.textContent) + ' / ' + show(seal && seal.getAttribute('title')) + '）')
    check(h.cs(veil).display === 'flex', '被阻塞的卡盖着暗层（display 实得 ' + show(h.cs(veil).display) + '）')
    check(!!veil && veil.className.indexOf('quiet') >= 0 && veil.textContent === '',
      '封条画出挡路票标题时，暗层只压暗、不写居中提示字（两行封条会正好压住它；实得类名 ' + show(veil && veil.className) + '、文本 ' + show(veil && veil.textContent) + '）')
    check(!!veilNoTitle && veilNoTitle.textContent === tr('card.blockedDim'),
      '只有挡路编号、没有标题的旧数据，居中提示字照旧给出来（实得 ' + show(veilNoTitle && veilNoTitle.textContent) + '）')
    const chipB = chip ? chip.querySelector('b') : null
    const chipI = chip ? chip.querySelector('i') : null
    check(!!chipB && !!chipI && chipB.textContent === tr('card.blockerIs') && chipI.textContent === '#3 下游票',
      '挡路红条两行：「阻塞的就是这张」+ 它挡住的票「#3 下游票」（实得 ' + show(chip && chip.textContent) + '）')
    check(h.cs(chip).display === 'none',
      '没点亮时红条在 DOM 里但被 CSS 藏起来（display 实得 ' + show(h.cs(chip).display) + '）')
    const cardA = h.q('#card-a')
    check(!!cardA && cardA.className.indexOf('dim') >= 0 && cardA.getAttribute('tabindex') === '0',
      '被阻塞的卡带着 dim 且可聚焦（类名 ' + show(cardA && cardA.className) + '，tabindex ' + show(cardA && cardA.getAttribute('tabindex')) + '）')
    await h.click(cardA)
    const blocker = h.q('#card-b')
    check(!!cardA && !!blocker && cardA.className.indexOf('lit') >= 0 && blocker.className.indexOf('lit') >= 0,
      '点亮被阻塞的卡时，它自己与它指的挡路卡一起亮（实得 ' + show(cardA && cardA.className) + ' / ' + show(blocker && blocker.className) + '）')
    check(h.cs(chip).display === 'block' && h.cs(veil).display === 'none',
      '点亮之后红条才出现、暗层让开（红条 display ' + show(h.cs(chip).display) + '，暗层 ' + show(h.cs(veil).display) + '）')
    await h.unmount()
  }

  // ---- 5.5 页头 / 图钉 / 角标 / 结案章 / 脚注 / 图标 ----
  {
    const h = await mountElement(React.createElement('div', null,
      React.createElement(M.PixelCardHead, { no: React.createElement('span', { className: 'cd-nonum' }, '#9'), sign: 'doing', closed: true }),
      React.createElement(M.PixelCardHead, {}),
      React.createElement(M.PixelCardPin, {}), React.createElement(M.PixelCardPin, { kind: 'big' }),
      React.createElement(M.PixelCardPin, { kind: 'tape' }), React.createElement(M.PixelCardPin, { kind: 'sealtop' }),
      React.createElement(M.PixelCornerMark, { kind: 'bug' }), React.createElement(M.PixelCornerMark, { kind: 'ready' }),
      React.createElement(M.PixelCornerMark, { kind: 'doing' }), React.createElement(M.PixelCornerMark, {}),
      React.createElement(M.PixelInlineSign, { kind: 'ready' }), React.createElement(M.PixelInlineSign, {}),
      React.createElement(M.PixelClosedSeal, {}), React.createElement(M.PixelMapCorner, {}),
      React.createElement(M.PixelCardNote, {}), React.createElement(M.PixelCardNote, { text: '红字' }),
      React.createElement(M.PixelCardFoot, { left: '左', right: '右' }),
      React.createElement(M.PixelCardIcon, { n: 'hammer' }), React.createElement(M.PixelCardIcon, { n: '不存在的图标' })))
    const heads = h.qa('.cd-hd')
    const head0 = heads[0] || null
    check(heads.length === 2 && !!head0 && !!head0.querySelector('.cd-nonum') &&
      !!head0.querySelector('.cd-mstate') && !!head0.querySelector('.cd-sealcn') &&
      head0.querySelector('.cd-nonum').textContent === '#9' &&
      head0.querySelector('.cd-mstate').textContent === tr('card.doing') &&
      head0.querySelector('.cd-sealcn').textContent === tr('card.closedSeal'),
      '页头把编号、在办小签、结案章都挂上（实得 ' + show(head0 && head0.textContent) + '）')
    const head1Kids = heads[1] ? heads[1].children.length : null
    check(head1Kids === 0, '页头什么都不给时是空的，不画小签也不画章（实得 ' + show(head1Kids) + ' 个子节点）')
    check(h.qa('.cd-pin').map((el) => el.className).join('|') === 'cd-pin|cd-pin big' &&
      h.qa('.cd-tape').length === 1 && h.qa('.cd-sealtop').length === 1,
      '图钉四种形态各画各的：普通 / 大圆 / 胶带 / 封顶（实得 ' + show(h.qa('.cd-pin,.cd-tape,.cd-sealtop').map((el) => el.className).join('|')) + '）')
    check(h.qa('.cd-corner').length === 1 && h.text('.cd-corner') === tr('card.bug') &&
      h.text('.cd-ckj') === tr('card.pickReady') && h.text('.cd-ckb') === tr('card.doing'),
      '角标三种：BUG / 可接 / 在办，都是真词条（实得 ' + show(h.text('.cd-corner')) + ' / ' + show(h.text('.cd-ckj')) + ' / ' + show(h.text('.cd-ckb')) + '）')
    check(h.qa('.cd-corner,.cd-ckj,.cd-ckb').length === 3, '不认识的角标种类什么都不画（四种里只画出三种，实得 ' + h.qa('.cd-corner,.cd-ckj,.cd-ckb').length + ' 种）')
    const signs = h.qa('.cd-mstate')
    check(signs.length === 2 && signs.map((el) => el.style.background).join('|') === 'rgb(43, 98, 176)|rgb(16, 185, 129)',
      '页内小签两种形态各按自己的底色画：在办是蓝的、可接是翠绿的，第三种（不给 kind）什么都不画（实得 ' + signs.length + ' 个，底色 ' + show(signs.map((el) => el.style.background).join('|')) + '）')
    check(h.text('.cd-mapcorner') === tr('card.map'), 'MAP 角标写着真词条（实得 ' + show(h.text('.cd-mapcorner')) + '）')
    check(h.qa('.cd-note').length === 1 && h.text('.cd-note') === '红字', '没有文本时红字脚注整块不画，有文本才画（实得 ' + h.qa('.cd-note').length + ' 块）')
    check(h.texts('.cd-ft span').join('|') === '左|右', '脚注左右两格照给（实得 ' + show(h.texts('.cd-ft span').join('|')) + '）')
    const icons = h.qa('svg')
    const iconHtml = icons.map((el) => { const g = el.querySelector('g'); return g ? g.innerHTML.length : null })
    check(iconHtml.length === 2 && iconHtml[0] > 0 && iconHtml[1] === 0,
      '图标：认识的图标名画出图形，不认识的名字画空（实得 ' + show(iconHtml.join(' / ')) + ' 字符）')
    check(attrOf('svg', 0, 'viewBox')(h) === '0 0 24 24' && attrOf('svg', 0, 'width')(h) === '12',
      '图标 svg 是 24 视窗、画 12 像素（实得 ' + show(attrOf('svg', 0, 'viewBox')(h)) + ' / ' + show(attrOf('svg', 0, 'width')(h)) + '）')
    await h.unmount()
  }

  // ---- 5.6 皮肤真源：每一条规则都真的能解析 ----
  {
    const rules = M.PIXEL_CARDS_STYLE_TEXT
    check(Array.isArray(rules) && rules.length > 50, '皮肤真源是一串规则，共 ' + (Array.isArray(rules) ? rules.length : 0) + ' 条')
    const scratch = DOC.createElement('style')
    DOC.head.appendChild(scratch)
    const badRules = []
    let parsedRules = 0
    for (const rule of rules) {
      scratch.textContent = rule
      const n = scratch.sheet ? scratch.sheet.cssRules.length : 0
      parsedRules += n
      if (n === 0) badRules.push(String(rule).slice(0, 40))
    }
    scratch.remove()
    const blocks = rules.join('').split('{').length - 1
    check(badRules.length === 0, '每一条皮肤规则都被浏览器解析（解析不出来的：' + (badRules.length ? badRules.join('、') : '无') + '）')
    check(parsedRules === blocks, '解析出来的规则条数 ' + parsedRules + ' 与规则文本里的 ' + blocks + ' 个声明块对得上（没有静默丢规则）')
  }

  // ---- 5.7 浅色皮肤（#1380）：票卡与地图卡换成和技能列表同一套浅色纸面 ----
  // 判据只看两份样式文本，不看渲染：深色原值仍在、浅色覆盖只挂在宿主标记上、纸色与技能列表不分叉、
  // 该走令牌的装饰色不再写死。先跑真文本（必须全过），再在内存里把文本变坏三次，同一套判据必须报红。
  {
    const cardsSrc = sourceText('src/client/views/cards/PixelCardsStyles.ts')
    const pixelSrc = sourceText('src/client/views/skillDetail/PixelStyles.ts')
    const problems = cardLightProblems(cardsSrc, pixelSrc)
    check(problems.length === 0, '浅色皮肤：深色令牌原样、浅色是定版纸面、纸色与技能列表不分叉' + (problems.length ? '\n    不过 ' + problems.length + ' 条：\n      ' + problems.join('\n      ') : ''))

    // 反例 a：把浅色覆盖整段删掉 —— 同一套判据必须报红（只在内存里改文本，不落盘）
    const noLightCards = cardsSrc.replace(CARD_LIGHT_RE, '')
    const noLightProblems = cardLightProblems(noLightCards, pixelSrc)
    check(noLightCards !== cardsSrc && noLightProblems.length > 0, '反例 a：删掉浅色覆盖 → 判据报红（' + noLightProblems.length + ' 条：' + noLightProblems.slice(0, 2).join('；') + '）')

    // 反例 b：把一个浅色令牌值改回深色原值 —— 同一套判据必须报红
    const wrongToneCards = cardsSrc.replace('--cd-card:#f6f1e6', '--cd-card:#f2e4c0')
    const wrongToneProblems = cardLightProblems(wrongToneCards, pixelSrc)
    check(wrongToneCards !== cardsSrc && wrongToneProblems.length > 0, '反例 b：把一个浅色令牌值改回深色值 → 判据报红（' + wrongToneProblems.length + ' 条：' + wrongToneProblems.slice(0, 2).join('；') + '）')

    // 反例 c：让技能列表先改纸色、票卡不跟 —— 跨文件一致性必须报红
    const forkedPixel = pixelSrc.replace(/--pixel-card:\s*#fffdf8/, '--pixel-card:#ffffff')
    const forkProblems = cardLightProblems(cardsSrc, forkedPixel)
    check(forkedPixel !== pixelSrc && forkProblems.some((m) => m.indexOf('纸色分叉') >= 0), '反例 c：技能列表的纸色与票卡分叉 → 判据报红（' + forkProblems.filter((m) => m.indexOf('纸色分叉') >= 0).join('；') + '）')

    // 浅色纸面上的对比度：真算一遍。正文与次要字走 4.5:1；强调色、地图色、次要灰只当图形元素或大字，按 3:1。
    const lightDecl = (cardsSrc.match(CARD_LIGHT_RE) || ['', ''])[1]
    const tokens = cardTokensOf(lightDecl)
    const groups: Array<{ line: number, pairs: string[][] }> = [
      { line: 4.5, pairs: [['ink/paper', '--cd-ink', '--cd-paper'], ['ink/card', '--cd-ink', '--cd-card'], ['ink2/card', '--cd-ink2', '--cd-card'], ['take/card', '--cd-take', '--cd-card'], ['bad/card', '--cd-bad', '--cd-card'], ['note/card', '--cd-note', '--cd-card']] },
      { line: 3, pairs: [['gold/card', '--cd-gold', '--cd-card'], ['map/card', '--cd-map', '--cd-card'], ['dim/card', '--cd-dim', '--cd-card']] },
      { line: 4.5, pairs: [['white/mark-bug', '#ffffff', '--cd-mark-bug'], ['white/mark-ready', '#ffffff', '--cd-mark-ready'], ['white/mark-doing', '#ffffff', '--cd-mark-doing']] },
    ]
    const shown: string[] = []
    const low: string[] = []
    for (const group of groups) {
      for (const p of group.pairs) {
        const fg = p[1].charAt(0) === '#' ? p[1] : tokens[p[1]]
        const bg = p[2].charAt(0) === '#' ? p[2] : tokens[p[2]]
        if (!fg || !bg) { low.push(p[0] + ' 的令牌没写（' + p[1] + ' / ' + p[2] + '）'); continue }
        const ratio = cardLightContrast(fg, bg)
        shown.push(p[0] + ' ' + ratio.toFixed(2))
        if (!(ratio >= group.line)) low.push(p[0] + ' ' + fg + ' on ' + bg + ' = ' + ratio.toFixed(2) + '（该 ≥ ' + group.line + '）')
      }
    }
    check(low.length === 0, '浅色纸面上的字与图形都过线：正文 4.5:1、图形与角标 3:1 起（' + shown.join('、') + '）' + (low.length ? ' —— 不达标：' + low.join('；') : ''))

    // #1401：浅色主题的键盘焦点环。深色那两条只认 data-ds-dark-theme，浅色下原来落回宿主默认环，
    // 被挡卡整卡可点时键盘聚焦看不出是哪张卡。这里要求补出同一套像素风虚线，但颜色必须取宿主
    // 焦点环令牌（--dsw-focus-ring-color，缺省回落主题主色）：卡片皮肤只决定形状，颜色跟着宿主换肤走。
    const hostRing = 'var\\(--dsw-focus-ring-color,var\\(--dsw-alias-state-business-primary,#58a6ff\\)\\)'
    const lightCardRing = new RegExp('body:not\\(\\[data-ds-dark-theme\\]\\) \\.cd-card:focus-visible\\{outline:2px dashed ' + hostRing + ';outline-offset:4px\\}')
    const lightBtnRing = new RegExp('body:not\\(\\[data-ds-dark-theme\\]\\) \\.cd-abtn:focus-visible\\{outline:2px dashed ' + hostRing + ';outline-offset:2px\\}')
    check(lightCardRing.test(cardsSrc) && lightBtnRing.test(cardsSrc),
      '浅色主题下卡片与按钮都有可见的键盘焦点环，环色取宿主焦点令牌 --dsw-focus-ring-color（#1401）')
    check(cardsSrc.indexOf('body:not([data-ds-dark-theme]) .cd-card:focus-visible{outline:2px dashed var(--cd-frame)') < 0,
      '浅色焦点环不再用卡片自己的墨色（那样换肤时颜色不跟宿主走）')
  }

  // =========================================================================
  // 6. 拼接登记与真源对得上：16 份叶子各登记一次，index.ts 里各有一处 leaf 标记
  // =========================================================================
  section('6. 拼接登记与真源对得上：16 份叶子各登记一次，index.ts 里各有一处 leaf 标记')
  {
    // 为什么守这条：叶子不在 LEAF_MODULES 里登记，构建不会报错，只是悄悄不拼进闭包，
    // 界面上表现为「这个组件不存在」；index.ts 少了标记，拼接缝就找不到落点。两处都只有
    // 构建期才暴露，单独跑本门禁时提前喊出来。
    const buildText = sourceText('scripts/build.mts')
    const indexText = sourceText('src/client/index.ts')
    const notRegistered = LEAF_ORDER.filter((name) =>
      buildText.indexOf("file: 'src/client/views/cards/" + name + ".ts'") < 0)
    check(notRegistered.length === 0,
      '16 份叶子都在 build.mts 的 LEAF_MODULES 里登记了 .ts 真源（漏登的：' + (notRegistered.length ? notRegistered.join('、') : '无') + '）')
    // 登记行同时给出 id 与文件，按这两样对出「文件 → id」，再用 id 去 index.ts 里找标记。
    const markerRe = /id: '([^']+)', file: 'src\/client\/views\/cards\/([^']+)\.ts'/g
    const idOf: Record<string, string> = {}
    let mm: RegExpExecArray | null
    while ((mm = markerRe.exec(buildText))) idOf[mm[2]] = mm[1]
    const notMarked = LEAF_ORDER.filter((name) =>
      idOf[name] === undefined || indexText.indexOf('// ==== leaf:' + idOf[name] + ' (spliced by build) ====') < 0)
    check(notMarked.length === 0,
      '16 份叶子在 src/client/index.ts 里各有一处 leaf 标记（缺标记的：' + (notMarked.length ? notMarked.join('、') : '无') + '）')
    const dupRegistered = LEAF_ORDER.filter((name) =>
      buildText.split("file: 'src/client/views/cards/" + name + ".ts'").length - 1 > 1)
    check(dupRegistered.length === 0,
      '没有哪份叶子被重复登记（重复的：' + (dupRegistered.length ? dupRegistered.join('、') : '无') + '）')
    check(LEAF_ORDER.length === 16, '这一节覆盖了 cards 目录里全部 16 份叶子（实得 ' + LEAF_ORDER.length + ' 份）')
  }

  // =========================================================================
  // 7. props 契约：声明的字段真的被用上，用到的字段都在契约里
  // =========================================================================
  section('7. props 契约：cardBits.d.ts / cardProps.d.ts 里的字段与组件实际读的字段对得上')
  const ISSUE_BASE = {
    action: 'fix', noText: '#841', title: '票卡标题',
    tags: [{ text: 'bug', color: 'd73a4a' }, { text: 'wayfinder:task', color: '10b981' }],
    note: '红字脚注', updatedText: '今天 07:40', footActionText: '看详情',
    closed: false, claimedBy: '张三', bugCorner: false, pickCorner: 'doing',
    blockedBy: { no: '12', title: '上游票' }, blocksChip: { no: '3', title: '下游票' },
    cardId: 'card-a', lit: false, colorOf: LABEL_COLORS,
  }
  for (const [field, value, observe, expected] of [
    ['action', 'fix', (h) => h.text('.cd-abtn.label'), tr('card.act.fix')],
    ['noText', '#841', (h) => h.text('.cd-nonum'), '#841'],
    ['title', '票卡标题', titleOwnText, '票卡标题'],
    ['tags', [{ text: 'bug', color: 'd73a4a' }, { text: 'wayfinder:task', color: '10b981' }], countOf('.cd-chip'), 2],
    ['note', '红字脚注', countOf('.cd-note'), 1],
    ['updatedText', '今天 07:40', nthText('.cd-ft span', 0), tr('card.updated', { n: '今天 07:40' })],
    ['footActionText', '看详情', nthText('.cd-ft span', 1), '看详情'],
    ['closed', true, countOf('.cd-sealcn'), 1],
    ['claimedBy', '张三', (h) => h.text('.cd-take'), tr('card.claimedBy', { n: '张三' })],
    ['bugCorner', true, countOf('.cd-corner'), 1],
    ['pickCorner', 'doing', countOf('.cd-ckb'), 1],
    ['blockedBy', { no: '12', title: '上游票' }, countOf('.cd-bseal'), 1],
    ['blocksChip', { no: '3', title: '下游票' }, countOf('.cd-bchip'), 1],
    ['cardId', 'card-a', (h) => !!h.q('#card-a'), true],
    ['lit', true, (h) => h.cs('.cd-dimveil').display, 'none'],
    ['colorOf', LABEL_COLORS, (h) => h.q('.cd-nonum').style.background, 'rgb(215, 58, 74)'],
  ]) await checkPropUsed('IssueCardProps', M.PixelIssueCard, ISSUE_BASE, field, value, observe, expected)

  {
    const calls = []
    const h = await mountCard(M.PixelIssueCard, Object.assign({}, ISSUE_BASE, { onLitChange: (lit) => calls.push(lit) }))
    await h.click('#card-a')
    check(calls.join(',') === 'true', 'IssueCardProps 的 onLitChange 真的被用上：点亮被阻塞的卡时报出 true（实得 ' + show(calls.join(',')) + '）')
    await h.unmount()
    const noCb = await mountCard(M.PixelIssueCard, ISSUE_BASE)
    let threw = null
    try { await noCb.click('#card-a') } catch (e) { threw = (e && e.message) || String(e) }
    check(threw === null, '没传 onLitChange 时点亮也不抛错（抛错：' + show(threw) + '）')
    await noCb.unmount()
  }

  const ISSUEMAP_BASE = {
    mapNo: '841', title: '子票卡标题', open: true, kids: 7, ready: 2, blocked: 1,
    updatedText: '昨天 18:00', claimedBy: '李四', dots: [{ color: '#0e8a16', n: 3 }], sign: 'doing',
    blockedBy: { no: '12', title: '上游票' }, blocksChip: { no: '3', title: '下游票' },
    cardId: 'card-m', lit: false,
  }
  for (const [field, value, observe, expected] of [
    ['mapNo', '841', (h) => h.text('.cd-nonum'), '#841'],
    ['title', '子票卡标题', titleOwnText, '子票卡标题'],
    ['open', true, countOf('.cd-sealcn'), 0],
    ['kids', 7, nthText('.cd-mstats span', 0), tr('card.sub') + ' 7'],
    ['ready', 2, nthText('.cd-mstats span', 1), tr('card.pickReady') + ' 2'],
    ['blocked', 1, nthText('.cd-mstats span', 2), tr('card.blockedCount') + ' 1'],
    ['updatedText', '昨天 18:00', (h) => h.text('.cd-ft'), tr('card.updated', { n: '昨天 18:00' })],
    ['claimedBy', '李四', (h) => h.text('.cd-take'), tr('card.claimedBy', { n: '李四' })],
    ['dots', [{ color: '#0e8a16', n: 3 }], countOf('.cd-grid2 i'), 3],
    ['sign', 'doing', (h) => h.text('.cd-mstate'), tr('card.doing')],
    ['blockedBy', { no: '12', title: '上游票' }, countOf('.cd-bseal'), 1],
    ['blocksChip', { no: '3', title: '下游票' }, countOf('.cd-bchip'), 1],
    ['cardId', 'card-m', (h) => !!h.q('#card-m'), true],
    ['lit', true, (h) => h.cs('.cd-dimveil').display, 'none'],
  ]) await checkPropUsed('IssueMapCardProps', M.PixelIssueMapCard, ISSUEMAP_BASE, field, value, observe, expected)

  {
    const calls = []
    const h = await mountCard(M.PixelIssueMapCard, Object.assign({}, ISSUEMAP_BASE, { onLitChange: (lit) => calls.push(lit) }))
    await h.click('#card-m')
    check(calls.join(',') === 'true', 'IssueMapCardProps 的 onLitChange 真的被用上（实得 ' + show(calls.join(',')) + '）')
    await h.unmount()
  }

  const MAP_BASE = {
    mapNo: '841', title: '地图卡标题', open: true, updatedText: '今天 07:40', dateText: '2026-10-12',
    dots: MAP_DOTS, hoverNo: 'f1',
  }
  for (const [field, value, observe, expected] of [
    ['mapNo', '841', (h) => h.text('.cd-hd b'), '#841'],
    ['title', '地图卡标题', (h) => h.text('h3'), '地图卡标题'],
    ['open', true, (h) => h.text('.cd-st'), tr('card.openState')],
    ['updatedText', '今天 07:40', (h) => h.text('.cd-ft'), tr('card.lastUpdate', { n: '今天 07:40', d: '2026-10-12' })],
    ['dateText', '2026-10-12', (h) => h.text('.cd-ft'), tr('card.lastUpdate', { n: '今天 07:40', d: '2026-10-12' })],
    ['dots', MAP_DOTS, countOf('.cd-wall i'), 4],
    ['hoverNo', 'f1', (h) => h.text('.cd-readout'), '#f1可接丁票'],
  ]) await checkPropUsed('MapCardProps', M.PixelMapCard, MAP_BASE, field, value, observe, expected)

  {
    const hovered = []
    const h = await mountCard(M.PixelMapCard, { mapNo: '841', title: 't', dots: MAP_DOTS, onHover: (no) => hovered.push(no) })
    await h.hover(h.qa('.cd-wall i')[0])
    check(hovered.join(',') === 'c1', 'MapCardProps 的 onHover 真的被用上：悬停第一个点报出 c1（实得 ' + show(hovered.join(',')) + '）')
    check(h.text('.cd-readout') === '#c1已结案甲票', '受控之外的那条路：自己记悬停状态并换读数框（实得 ' + show(h.text('.cd-readout')) + '）')
    await h.unmount()
  }

  // ---- 7.1 反方向：组件读的字段名必须都在两份契约里声明过 ----
  {
    /** 从两份 .d.ts 里把每个 interface 的字段名收成一个集合。 */
    function contractFields (): Record<string, string[]> {
      const fields = new Set()
      const byInterface = {}
      for (const file of CONTRACTS) {
        const text = fs.readFileSync(path.join(CARDS, file), 'utf8').replace(/\r\n/g, '\n')
        const re = /export interface (\w+)\s*\{([^}]*)\}/g
        let m
        while ((m = re.exec(text))) {
          const names = []
          // 字段名后面必须紧跟 `?:` 或 `:`；要求它前面是 `{`、`;` 或换行，才不会把
          // 类型里函数签名的形参（例如 onLitChange?: ((lit: boolean) => void) 里的 lit）当成字段。
          const fieldRe = /(?:^|[;{\n])\s*([A-Za-z_$][\w$]*)\??\s*:/g
          let fm
          while ((fm = fieldRe.exec(m[2]))) { names.push(fm[1]); fields.add(fm[1]) }
          byInterface[m[1]] = names
        }
      }
      return { fields, byInterface }
    }
    const { fields: declared, byInterface } = contractFields()
    check(Object.keys(byInterface).length >= 10,
      '两份契约里解析出 ' + Object.keys(byInterface).length + ' 个 props 接口（' + Object.keys(byInterface).join('、') + '）')
    check(byInterface.IssueCardProps && byInterface.IssueMapCardProps && byInterface.MapCardProps && byInterface.CardBtnsProps,
      '三张卡与按钮行的接口都在契约里（IssueCardProps / IssueMapCardProps / MapCardProps / CardBtnsProps）')

    // 组件实际读的字段名（p.xxx / props.xxx），必须都在契约里声明过。
    const undeclared = []
    const readNames = new Set()
    for (const name of LEAF_ORDER) {
      const code = readJs(name)
      const re = /\b(?:p|props)\.([A-Za-z_$][\w$]*)/g
      let m
      while ((m = re.exec(code))) {
        readNames.add(m[1])
        if (!declared.has(m[1])) undeclared.push(name + '.' + m[1])
      }
    }
    check(readNames.size >= 25, '组件实际读到的 props 字段共 ' + readNames.size + ' 个（作为下面那条断言的分母）')
    check(undeclared.length === 0,
      '组件读的字段全都在两份契约里声明过，没有偷偷用没声明的字段（没声明的：' + (undeclared.length ? undeclared.join('、') : '无') + '）')

    // 关键组件的 props 类型名必须指向契约里那个接口（真源里写的类型名）。
    const wanted = {
      PixelIssueCard: 'IssueCardProps', PixelIssueMapCard: 'IssueMapCardProps', PixelMapCard: 'MapCardProps',
      PixelCardBtns: 'CardBtnsProps', PixelBlockedChrome: 'BlockedInfo',
    }
    const wrong = []
    for (const name of Object.keys(wanted)) {
      const iface = wanted[name]
      if (!new RegExp('props\\??:\\s*' + iface + '\\b').test(readTs(name)) || !byInterface[iface]) wrong.push(name + '→' + iface)
    }
    check(wrong.length === 0,
      '三张卡、按钮行、被阻塞三件套的 props 类型名都指向契约里的接口（' + Object.keys(wanted).length +
      ' 个组件：' + Object.keys(wanted).map((n) => n + '→' + wanted[n]).join('、') + '；对不上的：' + (wrong.length ? wrong.join('、') : '无') + '）')

    // 剩下的小件把 props 就地写成内联对象类型，没有引用接口名，那就换个方向对：
    // 内联类型里写的字段名，必须都在两份契约里声明过（反过来，契约里多出来的字段不算问题）。
    const inlineFiles = []
    const inlineFields = []
    const inlineStray = []
    for (const name of LEAF_ORDER) {
      const re = /props\??:\s*\{([^}]*)\}/g
      let m
      while ((m = re.exec(readTs(name)))) {
        inlineFiles.push(name)
        // 先把内层对象（例如 dots 的 { color: string; n: number }）摘掉，
        // 免得把内层类型的字段名当成 props 字段。
        const flat = m[1].replace(/\{[^{}]*\}/g, ' ')
        const fieldRe = /(?:^|[;{\n])\s*([A-Za-z_$][\w$]*)\??\s*:/g
        let fm
        while ((fm = fieldRe.exec(flat))) {
          inlineFields.push(name + '.' + fm[1])
          if (!declared.has(fm[1])) inlineStray.push(name + '.' + fm[1])
        }
      }
    }
    check(inlineFiles.length >= 5 && inlineFields.length >= 10,
      '另有 ' + inlineFiles.length + ' 份小件把 props 写成内联对象类型（' + inlineFiles.join('、') + '），共 ' + inlineFields.length + ' 个字段要对照契约')
    check(inlineStray.length === 0,
      '内联类型里写的字段名也都在契约里声明过（没声明的：' + (inlineStray.length ? inlineStray.join('、') : '无') + '）')
  }

  // =========================================================================
  // 收尾：覆盖报告 + 通过条数
  // =========================================================================
  section('覆盖报告')
  {
    const all = fs.readdirSync(CARDS).filter((f) => fs.statSync(path.join(CARDS, f)).isFile())
    const rendered = [
      'PixelIssueCard', 'PixelIssueMapCard', 'PixelMapCard', 'PixelCardBtns', 'PixelCardIcon', 'PixelCardTitle',
      'PixelCardNo', 'PixelCardTags', 'PixelCardNote', 'PixelCardFoot', 'PixelCardPin', 'PixelCardStamp',
      'PixelBlockedChrome', 'PixelCardHead', 'PixelMapDots',
    ]
    const notRendered = LEAF_ORDER.filter((n) => rendered.indexOf(n) < 0)
    console.log('  本门禁覆盖 ' + all.length + ' 个文件：')
    console.log('   · 16 份 .ts：全部按闭包拼接次序装载执行（' + rendered.length + ' 份组件被真渲染断言，' + notRendered.join('、') + ' 按导出值断言）；')
    console.log('     PixelCardsStyles.ts 没有组件可挂，按第 5.6 节「每条规则都能被浏览器解析」+ 各节的皮肤生效断言。')
    console.log('   · 第 6 节另外核对：这 16 份都在 build.mts 的 LEAF_MODULES 与 index.ts 的 leaf 标记里各出现一次。')
    console.log('   · 2 份 .d.ts：第 7 节按契约解析，与组件实际读的字段逐个对照。')
    check(all.length === 18, 'cards 目录里 18 个文件都在这份覆盖清单的口径里（实得 ' + all.length + ' 个）')
    check(notRendered.join('、') === 'PixelCardTheme、PixelCardsStyles',
      '没有组件可挂的只有主题与皮肤两份（实得 ' + (notRendered.join('、') || '无') + '），其余都是真渲染')
  }
}

main().then(() => {
  console.log('')
  console.log(failed ? '存在失败：' + passed + ' 条通过 / ' + failed + ' 条未过' : 'cards 目录门禁全部通过（' + passed + ' 条断言）')
  // 这里设 exitCode 而不是调 process.exit()：process.exit() 会掐掉还没刷出去的 stdout，
  // 一旦有人用管道跑（node tests/verify-cards-dir.ts | tee），末尾那行「通过条数」会随机丢。
  process.exitCode = failed ? 1 : 0
}).catch((e) => {
  // 跑到一半抛异常也要把条数报出来：不然人只看到 exit 1，不知道跑到哪、过了多少条。
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  console.log('')
  console.log('门禁中途异常退出：' + passed + ' 条通过 / ' + (failed + 1) + ' 条未过（含这条异常）')
  process.exitCode = 1
})
