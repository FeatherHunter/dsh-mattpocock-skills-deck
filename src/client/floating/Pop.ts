/**
 * floating/Pop.ts — +N 标签弹窗（showPop，v1.3.3）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
  * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 颜色工具（标签底色加透明、边框加深），由别的叶子提供。
declare function hexA(...args: any[]): any;
declare function darken(...args: any[]): any;

    // v1.3.3 UI：+N 弹窗 —— fixed 定位，基准 = 面板容器 rect（左右 clamp 不越界，上下自动翻转避让）
export     const showPop = function (trig: any, host: any, labels: any, title: any) {
      if (typeof document === 'undefined') return
      const old = document.getElementById('dsws-pop')
      if (old && old.parentNode) old.parentNode.removeChild(old)
      const pop = document.createElement('div')
      pop.id = 'dsws-pop'
      pop.className = 'dsws-pop'
      const pt = document.createElement('div'); pt.className = 'pt'
      pt.textContent = tr('list.tagsCount', { n: labels.length })
      const pl = document.createElement('div'); pl.className = 'pl'
      labels.forEach(function (l: any) {
        const s = document.createElement('span')
        s.className = 'dsws-chip'
        s.style.background = hexA(l.color, 0.18) || 'rgba(188,140,255,.16)'
        s.style.color = l.color ? '#' + l.color : '#bc8cff'
        s.style.border = '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)')
        s.textContent = l.name
        pl.appendChild(s)
      })
      const ptitle = document.createElement('div'); ptitle.className = 'ptitle'
      ptitle.innerHTML = '<b>' + tr('list.popTitle') + '：</b>' + String(title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      pop.appendChild(pt); pop.appendChild(pl); pop.appendChild(ptitle)
      document.body.appendChild(pop)
      const pr = host ? host.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 }
      const pad = 8
      const maxW = Math.max(120, pr.right - pr.left - pad * 2)
      pop.style.maxWidth = maxW + 'px'
      pop.style.display = 'block'
      const r = trig.getBoundingClientRect()
      const pw = pop.offsetWidth, ph = pop.offsetHeight
      let left = Math.max(pr.left + pad, Math.min(r.left, pr.right - pw - pad))
      let top = r.bottom + 10, flip = false
      if (top + ph > window.innerHeight - 8) { top = r.top - ph - 10; flip = true }
      if (top < 8) { top = r.bottom + 10; flip = false }
      if (top < pr.top + pad && !flip) { top = pr.top + pad }
      pop.style.left = left + 'px'
      pop.style.top = top + 'px'
      const caret = document.createElement('div'); caret.className = 'caret'
      const cx = r.left + r.width / 2 - left
      caret.style.left = Math.max(6, Math.min(cx - 5, pw - 16)) + 'px'
      caret.style.top = flip ? 'auto' : '-6px'
      caret.style.bottom = flip ? '-6px' : 'auto'
      if (flip) {
        caret.style.borderLeft = 'none'; caret.style.borderTop = 'none'
        caret.style.borderRight = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderBottom = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.transform = 'rotate(225deg)'
      } else {
        caret.style.borderLeft = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderTop = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.borderRight = 'none'; caret.style.borderBottom = 'none'
        caret.style.transform = 'rotate(45deg)'
      }
      pop.appendChild(caret)
      const close = function () { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true) }
      const onDoc = function (ev: any) { if (pop.contains(ev.target)) return; close() }
      const onScroll = function () { close() }
      document.addEventListener('mousedown', onDoc, true)
      document.addEventListener('scroll', onScroll, true);
      (pop as any)._close = close
    }
