// verify-t14-detail-badge.js — dsh-waystation #462（v1.5 T14）：map 详情页标题前方紫色编号徽章
// 用法: node tests/verify-t14-detail-badge.js（在插件根目录；无需 gh / 网络）
//
// 验收（issue #462）：进入 map #445 详情，标题前方可见紫色 #445 徽章。
//
// 方法：从目标文件提取真实的 T14 渲染块（// T14：map 编号徽章 起到 flex 行收尾），
//   在沙箱中用忠实替身 h() 执行，断言产出的 vnode 结构：
//   a) 徽章 span.dsws-idnum 文本 = '#' + m.number（#445），颜色/边框 #c084fc，flex:none
//   b) 徽章位于标题 div.dsws-mtitle 之前（flex 行第一子节点）
//   c) 标题 div 保留 dsws-mtitle + dsws-tt-wrap、title 属性（tooltip）与 flex:1 minWidth:0
//   d) 徽章锚点仅 1 处（无重复写入漂移）+ 双源特征逐字等价
//   e) 上下文锚定：该块位于 map 详情渲染内（前置为新会话按钮行）
const fs = require('fs')
const files = ['client.js', 'package/lib/client.js']
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }

// 忠实替身 h()：记录 vnode 结构（type / props / children）
const hStub = function (type, props, children) {
  return { type: type, props: props || {}, children: children === undefined ? null : children }
}

// 提取真实 T14 渲染块（注释行 → flex 行 ']),' 收尾）
const ANCHOR = '// T14：map 编号徽章'
const extractT14 = function (src) {
  const anchor = ANCHOR
  const start = src.indexOf(anchor)
  if (start < 0) return ''
  const spanEnd = src.indexOf("'#' + m.number),", start)
  if (spanEnd < 0) return ''
  const titleEnd = src.indexOf('title: m.title }, m.title),', spanEnd)
  if (titleEnd < 0) return ''
  const blockEnd = src.indexOf(']),', titleEnd)
  if (blockEnd < 0) return ''
  return src.slice(start, blockEnd + 3)
}

// 渲染块 → 可执行表达式（去注释行与行尾逗号）
const toExpr = function (block) {
  const noComment = block.split('\n').filter(function (l) { return l.indexOf('// T14') < 0 }).join('\n').trim()
  return noComment.replace(/,\s*$/, '')
}

const norm = function (s) { return s.replace(/\s+/g, '') }

console.log('T14: #462 map 详情编号徽章（标题前方紫色）')

const blocks = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'
  const block = extractT14(src)
  blocks[tag] = block
  check(block.length > 0, f + ' 提取 T14 渲染块成功')
  if (!block.length) { failed = true; continue }

  // 上下文锚定：T14 块在 map 详情渲染内（其上方为顶部操作行含新会话按钮）
  const ctxBefore = src.slice(0, src.indexOf(ANCHOR) + ANCHOR.length)
  check(ctxBefore.includes('openInNewSession(st, m)'), f + ' 块位于 map 详情渲染（上方含新会话按钮）')
  check(ctxBefore.includes("tr('list.back')"), f + ' 块位于 map 详情渲染（上方含返回按钮）')

  // 静态特征
  check(block.includes("className: 'dsws-idnum'"), f + ' 徽章 className dsws-idnum')
  check(block.includes("color: '#c084fc', borderColor: '#c084fc', flex: 'none'"), f + ' 徽章紫色 #c084fc + flex:none')
  check(block.includes("'#' + m.number"), f + ' 徽章文本 = # + 编号')
  check(block.includes("className: 'dsws-mtitle dsws-tt-wrap'"), f + ' 标题保留 dsws-mtitle dsws-tt-wrap')
  check(block.includes('flex: 1, minWidth: 0'), f + ' 标题 flex:1 minWidth:0（徽章不被挤压）')
  check(block.includes('title: m.title'), f + ' 标题 title 属性（tooltip）保留')
  check(block.includes("display: 'flex', alignItems: 'center', gap: 6"), f + ' 外包 flex 行（垂直居中）')

  // 唯一性：锚点仅 1 处
  const anchors = src.split(ANCHOR).length - 1
  check(anchors === 1, f + ' T14 锚点仅 1 处（无重复写入漂移）')

  // 徽章外观依赖 CSS 类（等宽 + 边框 + 圆角）：类定义必须存在，否则「紫色徽章」退化成裸文字
  const idnumCss = src.indexOf('.dsws-idnum{')
  check(idnumCss >= 0, f + ' CSS 类 .dsws-idnum 已定义（徽章外观）')
  if (idnumCss >= 0) {
    const cssBlock = src.slice(idnumCss, idnumCss + 220)
    check(cssBlock.includes('font-family:Consolas,Menlo,monospace'), f + ' .dsws-idnum 等宽字体')
    check(cssBlock.includes('border:1px solid'), f + ' .dsws-idnum 边框徽章')
    check(cssBlock.includes('border-radius:6px'), f + ' .dsws-idnum 圆角')
  }

  // 行为：执行真实渲染块，断言 vnode 结构
  try {
    const render = new Function('h', 'm', 'return (' + toExpr(block) + ')')
    const m = { number: 445, title: '[dsh-waystation] map 详情缺编号显示（bug）' }
    const v = render(hStub, m)
    check(v && v.type === 'div', f + ' 渲染根节点为 flex 行 div')
    const kids = v && Array.isArray(v.children) ? v.children : []
    check(kids.length === 2, f + ' flex 行含 2 子节点（徽章 + 标题）')
    if (kids.length === 2) {
      const badge = kids[0]
      const title = kids[1]
      check(badge.type === 'span' && badge.props.className === 'dsws-idnum', f + ' 首子节点 = span.dsws-idnum 徽章')
      check(badge.children === '#445', f + ' 徽章文本 = #445（' + badge.children + '）')
      check(badge.props.style && badge.props.style.color === '#c084fc' && badge.props.style.borderColor === '#c084fc', f + ' 徽章紫色 #c084fc')
      check(badge.props.style && badge.props.style.flex === 'none', f + ' 徽章 flex:none')
      check(title.type === 'div' && title.props.className === 'dsws-mtitle dsws-tt-wrap', f + ' 次子节点 = div.dsws-mtitle 标题')
      check(title.children === m.title, f + ' 标题文本原样')
      check(title.props.title === m.title, f + ' 标题 tooltip 保留')
      check(title.props.style && title.props.style.flex === 1, f + ' 标题 flex:1')
      check(badge.children === '#' + m.number, f + ' 徽章文本 = # + 编号（数据驱动）')
    }
  } catch (e) {
    check(false, f + ' 渲染块执行异常: ' + e.message)
  }
}

// 双源等价已移除（T5 #98：一源两物，build 保证同构）
// 保留对单产物（_dev/_pkg 各自）的 T14 行为校验，足以覆盖 map 详情徽章契约

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')
