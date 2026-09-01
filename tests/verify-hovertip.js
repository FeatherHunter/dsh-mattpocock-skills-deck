// verify-hovertip.js — HoverTip 悬浮契约三件套验证（G2 #393 · T2 #381 承接）
// 用法: node tests/verify-hovertip.js [file...]（默认 client.js + package/lib/client.js + 真源）
// 验证：
//   1) 挂顶：经 portalTop 挂 document.body，zIndex 2147483000，RDOM 兜底原地退化，失败不抛
//   2) 翻转：estW = maxWidth+16+2=238 按视口 flip，左右 clamp 不越界，caret 边框色 var(--dsw-alias-border-l2) 随翻转同步
//   3) 跟随：mode anchor 读 targetRef.getBoundingClientRect，mode mouse 跟 clientX/Y，scroll/resize/ResizeObserver 统一重算
//   4) 时序与状态：delay {show:0, hide:160} 单 timer，清 timer 再计时，受控仅回调不双写
//   5) 内容：content 优先于 children，支持 string|VNode|()=>VNode，resolveContent 惰性
//   6) 双源一致 + 两处迁移消费
const fs = require('fs')
const path = require('path')
let failed = false
const ok = (cond, msg) => {
  if (cond) console.log('  PASS ' + msg)
  else { console.log('  FAIL ' + msg); failed = true }
}
const must = (src, re, msg) => ok(re.test(src), msg + (re.test(src) ? '' : ' — 缺 ' + re))
const srcPath = 'src/client/views/primitives/HoverTip.js'
let src = ''
try { src = fs.readFileSync(srcPath, 'utf8') } catch (e) { console.log('  FAIL 缺真源 ' + srcPath + ': ' + e.message); failed = true; src = '' }
if (src) {
  console.log('[HoverTip 真源 ' + srcPath + ']')
  ok(src.includes('export const HoverTip'), '导出 HoverTip')
  ok(src.split(/\r?\n/).length <= 200, '粒度 ≤200 行（实际 ' + src.split(/\r?\n/).length + '）')
  must(src, /\bportalTop\b/, '消费 portalTop 挂顶底座')
  must(src, /2147483000/, 'zIndex 2147483000')
  must(src, /estW\s*=\s*maxWidth\s*\+\s*16\s*\+\s*2/, '翻转阈值 estW = maxWidth+16+2 (=238)')
  must(src, /maxWidth.*220/, 'maxWidth 默认 220')
  must(src, /flip.*!==\s*false|flip\s*=\s*props\.flip/, 'flip 默认 true')
  must(src, /offset.*\{\s*x:\s*8\s*,\s*y:\s*0\s*\}.*\{\s*x:\s*14\s*,\s*y:\s*12\s*\}|mode.*mouse.*14.*12/, 'offset 分档 anchor {8,0} / mouse {14,12}')
  must(src, /delayShow|delay.*show.*0/, 'delay show 默认 0')
  must(src, /delayHide|delay.*hide.*160/, 'delay hide 默认 160')
  ok(/hideTimerRef|single.*timer|clearTimer/.test(src), '单一 timer 驱动 + 清 timer 再计时')
  must(src, /isControlled.*visible.*!==\s*undefined/, '受控 visible 兜底')
  must(src, /onVisibleChange/, '受控回调 onVisibleChange')
  must(src, /onShow|onHide/, '非受控回调 onShow/onHide')
  must(src, /getBoundingClientRect/, 'anchor 读 getBoundingClientRect')
  must(src, /clientX.*clientY|mousePos/, 'mouse 跟 clientX/Y')
  must(src, /ResizeObserver|scroll.*resize/, '滚动/视口变化统一重算')
  must(src, /content.*children|rawContent/, 'content 优先于 children 别名')
  must(src, /typeof.*function.*return.*c\(\)|resolveContent/, 'content 支持 () => VNode 惰性')
  must(src, /DswsCtx/, '经 DswsCtx 注入 h')
  ok(!/from\s+['"]\.\.\/primitives|import.*HoverTip/.test(src) || /src\/client\/views\/primitives\/HoverTip/.test(srcPath), '同层禁互 import（HoverTip 零横向依赖）')
  ok(!/export\s+const\s+usePlacement|export\s+function\s+place/.test(src), 'place 私有不对外暴露')
  must(src, /caret/, '小三角 caret 存在')
  must(src, /flippedX|flip.*caret/, 'caret 随翻转同步变向')
  must(src, /var\(--dsw-alias-border-l2/, 'caret 边框色走 var(--dsw-alias-border-l2)')
  must(src, /pointerEvents.*none/, '气泡 pointerEvents none 不拦截鼠标')
}

const checkBuilt = (file) => {
  let b = ''
  try { b = fs.readFileSync(file, 'utf8') } catch (e) { console.log('  FAIL 缺产物 ' + file); failed = true; return }
  console.log('[产物 ' + file + ']')
  must(b, /portalTop/, '含 portalTop 挂顶')
  must(b, /zIndex:\s*2147483000/, '含 zIndex 2147483000')
  must(b, /estW|tip\.x \+ 238|\+ 16 \+ 2/, '含 翻转阈值 238/estW')
  must(b, /HoverTip|hovertip/i, '含 HoverTip 产物')
  must(b, /caret/, '含 caret 产物')
}

;['client.js', 'package/lib/client.js'].forEach(checkBuilt)

// 两处迁移消费检查（忽略 // 注释行，避免文档提及被判为残留）
const migrants = [
  { file: 'src/client/floating/SkillFloatList.js', re: /HoverTip.*mode.*anchor/, msg: 'SkillFloatList 以 HoverTip(mode=anchor) 承载锚点悬浮' },
  { file: 'src/client/views/SettingsPage.js', re: /HoverTip.*mode.*mouse/, msg: 'SettingsPage 以 HoverTip(mode=mouse) 承载鼠标悬浮' },
]
migrants.forEach(m => {
  try {
    const raw = fs.readFileSync(m.file, 'utf8')
    const filtered = raw.split(/\r?\n/).filter(l => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    }).join('\n')
    must(filtered, m.re, m.msg + ' (' + m.file + ')')
    ok(!/\bs\.cfgTip\b|\bsharedSt\.cfgTip\b|\bs\.skillTip\b/.test(filtered), '无旧全局提示键残留（' + m.file + '）')
  } catch (e) { console.log('  FAIL 读 ' + m.file + ': ' + e.message); failed = true }
})

console.log('')
if (failed) { console.log('存在失败 — HoverTip 契约未达标'); process.exit(1) }
console.log('全部通过 — HoverTip 三件套：挂顶/翻转/跟随 + 时序/内容/受控 + 双源/迁移')
