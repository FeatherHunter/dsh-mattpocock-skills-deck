// verify-hovertip.ts — HoverTip 悬浮契约验证（规格 1651，#1653 起只锚定在触发控件上方）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-hovertip.ts（默认真源 + 双产物 + 调用点扫描）
// 验证（#1653 定版，取代 #1652 的翻转/跟随两档口径）：
//   1) 挂顶：经 portalTop 挂 document.body，zIndex 2147483000，失败不抛
//   2) 锚定上方：无 mouse 分支、无 clientX/Y，方位统一交给方位纯函数，按触发控件矩形、量出的提示尺寸、屏幕尺寸、宽度上限的顺序传入
//   3) 先量后算：按宽度上限（渲染外框宽）渲染后读 getBoundingClientRect() 的外框宽高得到真实尺寸再算落点，旧的字数估宽（length*7、maxWidth+16+2、estW）已删除；
//      #1660 起宽度上限就是渲染外框宽（box-sizing: border-box），不再拿整数化的偏移宽高当实际宽度
//   4) 不越屏不盖控件：生效宽度取调用方上限与屏幕可用宽度的较小值（函数内夹），落点按左上角直画
//   5) 时序与状态：delay 隐藏默认 160，单一 timer，清 timer 再计时，受控仅回调不双写，同时只显示一条
//   6) 内容：content 优先于 children，支持 string|VNode|()=>VNode，resolveContent 惰性，缺字符串触发件自动补 aria-label
//   7) 调用点干净：全仓 Tip/HoverTip 调用处不再传 mode/placement/offset/flip/caret（tipPlace 自身的 placement 返回字段不算调用点）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceText } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const ok = (cond: boolean, msg: string) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg)
  if (!cond) failed = true
}
const must = (src: string, re: RegExp, msg: string) => ok(re.test(src), msg + (re.test(src) ? '' : ' — 缺 ' + re))
const mustNot = (src: string, re: RegExp, msg: string) => ok(!re.test(src), msg + (re.test(src) ? ' — 不该有 ' + re : ''))

// 第一节 HoverTip 真源：只锚定在触发控件上方，方位计算只进不出（调用纯函数，不自算落点）。
const hoverSrc = sourceText('src/client/views/primitives/HoverTip.ts')
console.log('[HoverTip 真源 src/client/views/primitives/HoverTip.ts]')
ok(hoverSrc.includes('export const HoverTip'), '导出 HoverTip')
ok(hoverSrc.split(/\r?\n/).length <= 200, '粒度 ≤200 行（实际 ' + hoverSrc.split(/\r?\n/).length + '）')
must(hoverSrc, /\bportalTop\b/, '消费 portalTop 挂顶底座')
must(hoverSrc, /2147483000/, 'zIndex 2147483000')
must(hoverSrc, /maxWidth.*320/, 'maxWidth 默认 320')
mustNot(hoverSrc, /\b220\b/, '默认宽度不再是 220')
must(hoverSrc, /hide.*160|delayHide/, 'delay 隐藏默认 160')
must(hoverSrc, /delayShow|delay.*show.*0/, 'delay 显示默认 0（出现不等待，消失才等）')
ok(/hideTimerRef|clearTimer/.test(hoverSrc), '单一 timer 驱动 + 清 timer 再计时')
must(hoverSrc, /isControlled.*visible.*!==\s*undefined/, '受控 visible 兜底')
must(hoverSrc, /onVisibleChange/, '受控回调 onVisibleChange')
must(hoverSrc, /onShow|onHide/, '非受控回调 onShow/onHide')
must(hoverSrc, /getBoundingClientRect/, '读触发控件矩形（事件真实元素优先，引用只做兜底）')
must(hoverSrc, /currentTarget/, '自定义触发节点取鼠标进入事件的真实元素（currentTarget/target），克隆引用拿不到真实位置时才兜底')
must(hoverSrc, /tipRef\.current\.getBoundingClientRect\(\)/, '先按宽度上限渲染再读外框宽高（getBoundingClientRect 带小数，不用整数化的偏移宽高）')
must(hoverSrc, /boxSizing:\s*['"]border-box['"]/, '提示按 border-box 渲染：宽度上限就是渲染外框宽（#1660）')
mustNot(hoverSrc, /offsetWidth|offsetHeight/, '不再拿整数化的偏移宽高当实际尺寸（外框宽可能带小数）')
// 方位纯函数调用顺序：触发控件矩形、量出的提示尺寸、屏幕尺寸、宽度上限，少一位、多一位、换一位都判红。
must(hoverSrc, /computeTipPlace\s*\(\s*rect\s*,\s*\{\s*width\s*:\s*tipW\s*,\s*height\s*:\s*tipH\s*\}\s*,\s*\{\s*width\s*:\s*vpW\s*,\s*height\s*:\s*vpH\s*\}\s*,\s*maxWidth\s*\)/, '按矩形、提示尺寸、屏幕尺寸、宽度上限的顺序调 computeTipPlace')
must(hoverSrc, /effectiveMaxWidth/, '拿回生效宽度上限并按它渲染（窄屏自动收窄，不横向溢出）')
must(hoverSrc, /Math\.min\s*\(\s*maxWidth/, '生效宽度取调用方上限与屏幕可用宽度的较小值')
must(hoverSrc, /上方/, '注释写清提示锚定在触发控件上方')
mustNot(hoverSrc, /translateY\(-50%\)/, 'tooltip 不再带 translateY(-50%) 中心位移（左上角坐标直画）')
must(hoverSrc, /content.*children|rawContent/, 'content 优先于 children 别名')
must(hoverSrc, /resolveContent/, 'content 支持 () => VNode 惰性')
must(hoverSrc, /DswsCtx/, '经 DswsCtx 注入 h')
must(hoverSrc, /pointerEvents.*none/, '气泡 pointerEvents none 不拦截鼠标')
must(hoverSrc, /aria-label/, '字符串提示自动补 aria-label（不覆盖显式值）')
must(hoverSrc, /ResizeObserver/, '视口变化经 ResizeObserver 重算')
ok(/scroll/.test(hoverSrc) && /resize/.test(hoverSrc), '滚动与视口变化统一重算（scroll capture + resize）')
ok(/GlobalActive|GlobalPending/.test(hoverSrc), '同时只显示一条（全局互斥 + 待显示槽）')
mustNot(hoverSrc, /from\s+['"]\.\.\/primitives/, '同层禁横向 import（HoverTip 零横向依赖）')
mustNot(hoverSrc, /export\s+(const|function)\s+(usePlacement|place)\b/, '方位计算只进不出（不对外暴露 place）')
// 旧口径残留就是红：mouse 分支、字数估宽、翻转阈值、小三角、调用方可传的定位参数全部删干净。
mustNot(hoverSrc, /clientX/, '无 mouse 分支（不跟 clientX）')
mustNot(hoverSrc, /mousePos/, '无 mouse 位置状态')
mustNot(hoverSrc, /length\s*\*\s*7/, '无字数估宽（length*7 已删除，先量后算）')
mustNot(hoverSrc, /maxWidth\s*\+\s*16/, '无翻转阈值 maxWidth+16+2（estW 已删除）')
mustNot(hoverSrc, /\bestW\b/, '无 estW 中间变量')
mustNot(hoverSrc, /\bmode\s*:/, '调用方不再传 mode')
mustNot(hoverSrc, /\bplacement\s*:/, '调用方不再传 placement')
mustNot(hoverSrc, /\boffset\s*:\s*\{/, '调用方不再传 offset（offsetWidth 量度不算传参）')
mustNot(hoverSrc, /\bflip\s*:/, '调用方不再传 flip')
mustNot(hoverSrc, /caret/i, '无小三角 caret（锚定上方不需要翻转指示）')

// 第二节 Tip 薄预设真源：只定内容与默认宽度时序，方位收回控件内部。
const tipSrc = sourceText('src/client/views/primitives/Tip.ts')
console.log('[Tip 真源 src/client/views/primitives/Tip.ts]')
ok(tipSrc.includes('export const Tip'), '导出 Tip')
must(tipSrc, /maxWidth.*320/, '预设默认 maxWidth 320（调用方可覆盖）')
mustNot(tipSrc, /\b220\b/, '预设默认不再是 220')
must(tipSrc, /TIP_SHOW_DELAY_MS/, '显示延时引用中央时间真源（不写数字）')
must(tipSrc, /TIP_HIDE_DELAY_MS/, '隐藏延时引用中央时间真源（不写数字）')
must(tipSrc, /shared\/time-config\/values\.js/, '时间真源经 values.js 导入（构建剥行首拼闭包）')
must(tipSrc, /HoverTip\s*\(\s*merged\s*\)/, '预设拼好 merged 后直调 HoverTip（不自算方位）')
must(tipSrc, /aria-label/, '字符串提示自动补 aria-label')
mustNot(tipSrc, /\bmode\b/, '预设不再收 mode')
mustNot(tipSrc, /placement/i, '预设不再收 placement')
mustNot(tipSrc, /offset/i, '预设不再收 offset')
mustNot(tipSrc, /flip/i, '预设不再收 flip')
mustNot(tipSrc, /caret/i, '预设不再收 caret')

// 第三节双产物一致：构建把真源拼进闭包，产物里同一份行为。
const checkBuilt = (file: string) => {
  let b = ''
  try { b = fs.readFileSync(path.join(ROOT, file), 'utf8') } catch (e: any) { console.log('  FAIL 缺产物 ' + file); failed = true; return }
  console.log('[产物 ' + file + ']')
  must(b, /portalTop/, '含 portalTop 挂顶')
  // #1253：转译后 2147483000 被印成等值的短写 2147483e3（esbuild 0.28.2 的数字口径），两种写法都认。
  must(b, /zIndex:\s*(2147483000|2147483e3)/, '含 zIndex 2147483000')
  must(b, /computeTipPlace/, '含方位纯函数 computeTipPlace（锚定上方走同一份几何）')
  must(b, /HoverTip|hovertip/i, '含 HoverTip 产物')
  // 产物全文件里 boxSizing 出现 17 次（配额、弹窗等各有主人），只查关键词会漏；这里锁 HoverTip 自己 tooltipStyle 的完整形状。
  must(b, /position:\s*["']fixed["'],\s*left:\s*pos\.left,\s*top:\s*pos\.top,\s*boxSizing:\s*["']border-box["'],\s*maxWidth:\s*effWidth/, '产物里提示按 border-box 限宽（maxWidth 就是渲染外框宽）')
  must(b, /currentTarget/, '含真实元素取位（currentTarget）')
  must(b, /maxWidth:\s*320/, '含预设默认宽度 320')
  // 产物里 estW/caret/clientX 另有主人（配额、弹窗三角、标签页自画提示），不断言产物无这些词，只断言真源干净。
}
;['client.js', 'package/lib/client.js'].forEach(checkBuilt)

// 第四节调用点干净：全仓 Tip/HoverTip 调用处不再传定位参数（注释剥掉后看代码）。
// tipPlace 自身的 placement 是几何返回字段，不是调用点传参，扫描时跳过它；
// HoverTip/Tip 真源的默认 maxWidth/zIndex 是定义不是传参，同样跳过。
const skipFiles = new Set([
  'src/client/views/primitives/tipPlace.ts',
  'src/client/views/primitives/HoverTip.ts',
  'src/client/views/primitives/Tip.ts',
])
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\r\n]*/g, '$1 ')
const walkClient = (dir: string, out: string[]) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { walkClient(p, out); continue }
    if (!/\.(ts|js)$/.test(name)) continue
    if (/\.d\.ts$/.test(name)) continue
    out.push(p)
  }
}
const clientDir = path.join(ROOT, 'src', 'client')
const allFiles: string[] = []
walkClient(clientDir, allFiles)
const forbidden = [
  { re: /\bmode\s*:/, name: 'mode' },
  { re: /\bplacement\s*:/, name: 'placement' },
  { re: /\boffset\s*:\s*\{/, name: 'offset' },
  { re: /\bflip\s*:/, name: 'flip' },
  { re: /caret/i, name: 'caret' },
]
const isQuoteChar = (c: string) => c === '"' || c === "'" || c.charCodeAt(0) === 96
const balancedFrom = (s: string, openIdx: number): string | null => {
  let depth = 0
  let strQ = ''
  let esc = false
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (strQ) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === strQ) strQ = ''
      continue
    }
    if (isQuoteChar(c)) { strQ = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(openIdx, i + 1) }
  }
  return null
}
const propsOfCall = (code: string, nameIdx: number, nameLen: number): string | null => {
  let i = nameIdx + nameLen
  while (i < code.length && /\s/.test(code[i])) i++
  if (code[i] === ',') { i++; while (i < code.length && /\s/.test(code[i])) i++ }
  else if (code[i] !== '(') return null
  else { i++; while (i < code.length && /\s/.test(code[i])) i++ }
  if (code[i] === '{') return balancedFrom(code, i)
  const idm = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(i))
  if (!idm) return null
  const id = idm[0]
  if (id === 'null' || id === 'undefined' || id === 'this') return null
  const isW = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$]/.test(c)
  let dpos = -1
  for (const h of ['const ' + id, 'let ' + id, 'var ' + id]) {
    let p = code.indexOf(h)
    while (p >= 0) {
      if (!isW(code[p + h.length])) { dpos = p; break }
      p = code.indexOf(h, p + 1)
    }
    if (dpos >= 0) break
  }
  if (dpos < 0) return null
  const ob = code.indexOf('{', dpos)
  if (ob < 0) return null
  return balancedFrom(code, ob)
}
let callSites = 0
for (const abs of allFiles) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
  if (skipFiles.has(rel)) continue
  let raw = ''
  try { raw = fs.readFileSync(abs, 'utf8') } catch { continue }
  const code = stripComments(raw)
  if (!/(\bHoverTip\b|\bTip\b)/.test(code)) continue
  // 只在调用点的 props 对象里找定位参数：h(Tip, {...}) 取花括号那一段，h(Tip, tipProps) 顺藤摸到同一文件里的对象字面量；declare 行与类型引用取不到对象，自然落选。
  const useRe = /\b(HoverTip|Tip)\b/g
  let m: RegExpExecArray | null
  while ((m = useRe.exec(code)) !== null) {
    const props = propsOfCall(code, m.index, m[0].length)
    if (!props) continue
    callSites++
    for (const f of forbidden) {
      // hoverTipSrc 这类变量名不算传参：只认带冒号的键形状；offsetWidth 量度不带冒号花括号，自然落选。
      ok(!f.re.test(props), '调用点无 ' + f.name + '（' + rel + '）')
    }
  }
}
ok(callSites > 0, '调用点扫描确实跑到了（命中 ' + callSites + ' 处 Tip/HoverTip 引用）')
// 在办表那一行保留 520 覆盖（默认 320 放不下完整标题与会话名，调用方可覆盖的证据）。
const routeSrc = sourceText('src/client/views/shared/workRouteTable.ts')
must(routeSrc, /maxWidth:\s*520/, '在办表提示保留 maxWidth 520 覆盖')

console.log('')
if (failed) { console.log('存在失败 — HoverTip 锚定上方契约未达标'); process.exit(1) }
console.log('全部通过 — HoverTip 锚定上方：挂顶/先量后算/纯函数方位 + 时序/内容/受控 + 双产物/调用点干净')
