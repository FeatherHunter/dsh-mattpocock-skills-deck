#!/usr/bin/env node
/**
 * verify-map-detail-top.js — 地图详情页顶栏对齐门禁（#807）
 * 口径：向 IssueDetail.js #763 看齐 —— 单行不换行、五串字逐字折叠、
 * 新会话与主动作同色实心、补齐复制与外链两颗图标。
 */
const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const TOP = 'src/client/views/MapDetailTop.js'
const DETAIL = 'src/client/views/MapDetail.js'

console.log('=== #807 地图详情页顶栏：不换行＋逐字折叠＋新会话实心＋补图标 ===')

check(existsSync(resolve(TOP)), '顶栏文件存在（MapDetailTop.js）')
const src = existsSync(resolve(TOP)) ? read(TOP) : ''
if (src) {
  check(/export\s+const\s+MapDetailTop\b/.test(src), '导出 MapDetailTop')
  check(src.includes('React.useContext(DswsCtx)'), '组件消费 useContext(DswsCtx)')
  check(src.includes('cx ? cx.h : React.createElement'), '含 cx 兜底回退（h）')
  check(src.includes('useIssueDetailFold(st, m.number'), '折叠机 hook 接线在（与 IssueDetail 同一台）')
  check(src.includes("flexWrap: 'nowrap'") && src.includes("overflow: 'hidden'"), '顶栏单行不换行（nowrap＋overflow hidden）')
  check(src.includes('dsws-stickybar'), '粘性固定顶栏保留')
  const markers = ['data-detail-back-text', 'data-detail-crumb', 'data-detail-snapshot', 'data-detail-primary-text', 'data-detail-new-text']
  for (const mk of markers) check(src.includes(mk), '五串字折叠标记在：' + mk)
  check(src.includes("'data-full': 'wayfinder:map'") || src.includes('"data-full": "wayfinder:map"') || /data-full.*wayfinder:map/.test(src), '地图片参加折叠（snapshot 槽，full=wayfinder:map）')
  check(!/data-detail-(back-text|crumb|snapshot|primary-text|new-text)[\s\S]{0,200}textOverflow/.test(src), '折叠字不走省略号')
  check(!/data-detail-(back-text|crumb|snapshot|primary-text|new-text)[\s\S]{0,220}flex:\s*'(0 1 auto|1 1 auto)'/.test(src), '折叠字不靠 CSS 并行收缩（除空隙外全 flex:none）')
  // 新会话实心：同一文件里 openInNewSession(st, m) 那颗按钮是 primary，不是 ghost
  const newIdx = src.indexOf('openInNewSession(st, m)')
  const newWindow = newIdx >= 0 ? src.slice(Math.max(0, newIdx - 400), newIdx) : ''
  check(newIdx >= 0 && newWindow.includes('dsws-btn primary'), '新会话按钮是实心 primary（与执行同色）')
  check(!/dsws-btn ghost[^]*openInNewSession\(st, m\)/.test(src.slice(0, newIdx + 30)) || newWindow.includes('dsws-btn primary'), '新会话不再是 ghost 弱化样式')
  check(src.includes('#f59e0b') && src.includes('#3fb950'), '新会话配色跟随主动作（检查橙/完成绿）')
  check(src.includes("n: 'clipboard'") && src.includes('copyText(st,'), '补齐复制链接图标（clipboard＋copyText）')
  check(src.includes("n: 'link'") && src.includes('issueUrlFor(st, m.number'), '补齐远端打开图标（link＋issueUrlFor）')
  check(src.includes('tip.copyLink') && src.includes('tip.openInTracker'), '复制与外链悬停文案走词条')
  check(src.includes('data-detail-primary-text') && (src.includes("tr('act.inspect')") && src.includes("tr('act.done')") && src.includes("tr('act.execute')")), '主动作三态（检查/完成/执行）都挂折叠标记')
  // 中文不写死：顶栏文字走 tr 或英文常量（先去注释再查引号内，不含注释里的中文）
  const noComments = src.split('\n').filter(function (ln) { return ln.indexOf('// ====') !== 0 && ln.trim().indexOf('//') !== 0 }).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const strLits = noComments.match(/'[^'\n]*[一-鿿][^'\n]*'|"[^"\n]*[一-鿿][^"\n]*"/g) || []
  check(strLits.length === 0, '无中文字符串字面量（文案走词条，实得 ' + strLits.length + ' 处）')
  const lines = src.split(/\r?\n/).length
  check(lines <= 350, 'MapDetailTop.js ≤350 行（实际 ' + lines + '）')
}

if (existsSync(resolve(DETAIL))) {
  const detail = read(DETAIL)
  check(detail.includes('h(MapDetailTop'), 'MapDetail 改用 MapDetailTop 渲染顶栏')
  check(!detail.includes('openInNewSession(st, m)'), 'MapDetail 不再直写顶栏新会话按钮（已搬进 MapDetailTop）')
  check(detail.split(/\r?\n/).length <= 350, 'MapDetail.js ≤350 行（实际 ' + detail.split(/\r?\n/).length + '）')
} else {
  bad('MapDetail.js 缺失')
}

const buildSrc = read('scripts/build.mjs')
check(buildSrc.includes("id: 'mapDetailTop'") && buildSrc.includes('src/client/views/MapDetailTop.js'), '构建清单登记 mapDetailTop')
const indexSrc = read('src/client/index.js')
check(indexSrc.includes('// ==== leaf:mapDetailTop (spliced by build) ===='), 'index.js 拼接标记在')

console.log('')
console.log(`共 ${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
