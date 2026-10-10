/**
 * views/skillDetail/PixelSkillDetailModal.ts — 技能详情弹窗的 TS 真源（887 TS 化，变体 A 定版）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSkillDetailModal (spliced by build) ====` 标记处。
 * 用法：PixelSkillDetailModal({st, onRetry})，读 st.pixelDetail，关着就画 null。
 * st.pixelDetail = {open, name, titleEn, titleZh, mdEn, mdZh, shortDesc, bodyLang,
 *   phase, phaseText, isMissing, dshLang, copyText}，全由外层（888 取数通道）写。
 * 约定：①弹窗就地盖在父容器上（SwitchConfirmModal 同模式），父容器要 position:relative；
 * ②翻译按钮只要有中文译文（mdZh）就出现，DSH 开英文时也给（2026-10-10 人拍板）；正文默认英文原文；
 * ③复制按钮只在给了 copyText 时出现（复制什么链接由 888 定）；④回到顶部常驻底栏小按钮，
 * 不监听滚动（原型里按滚动显隐的版本有性能代价，生产里简化）；⑤取数计时与重试装载是 888 的活，
 * 本文件只管摆样子：onRetry(name) 由外层传进来，没有就不画重试按钮。
 */
import type {
  PixelSkillDetailModalProps, PixelStore, PixelHeading, PixelBtnProps, PixelStateIconProps,
  PixelStatusLineProps, PixelBannerProps, PixelContentsProps, PixelMarkdownProps, PixelSkeletonProps,
} from '../pixelProps';
declare const PixelSeal: () => any;
declare const PixelStateIcon: (props?: PixelStateIconProps) => any;
declare const PixelBtn: (props?: PixelBtnProps) => any;
declare const PixelStatusLine: (props?: PixelStatusLineProps) => any;
declare const PixelBanner: (props?: PixelBannerProps) => any;
declare const PixelContents: (props?: PixelContentsProps) => any;
declare const PixelMarkdown: (props?: PixelMarkdownProps) => any;
declare const PixelSkeleton: (props?: PixelSkeletonProps) => any;
declare function pixelDocHeadings(md?: string): PixelHeading[];
export const pixelCloseDetail = function (s: PixelStore | null | undefined): void {
  if (!s) return
  s.pixelDetail = null
  try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
}
export const pixelToggleDetailLang = function (s: PixelStore | null | undefined): void {
  const d = s && s.pixelDetail
  if (!d) return
  d.bodyLang = d.bodyLang === 'zh' ? 'en' : 'zh'
  try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
}
export const pixelCopyDetailLink = function (s: PixelStore | null | undefined, text?: string | null): void {
  const d = s && s.pixelDetail
  const done = function (): void {
    if (!d) return
    d.copied = true
    try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
    setTimeout(function () {
      if (!s || s.pixelDetail !== d) return
      d.copied = false
      try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
    }, 1500)
  }
  try {
    if (text && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done)
      return
    }
  } catch (e) { /* 剪贴板不可用也给反馈 */ }
  done()
}
export const PixelSkillDetailModal = function (props?: PixelSkillDetailModalProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = p.st
  const d = s && s.pixelDetail
  const bodyRef: any = React.useRef(null)
  const fitRef: any = React.useRef(null)
  const useFit = React.useLayoutEffect || React.useEffect
  // 详情本体按**用户可见区域**定高：不再猜"面板外框有多高"，而是量最近的滚动/裁剪祖先的可见高，
  // 再把详情撑到它剩下的部分——底栏那两颗按钮因此停在可见底部，正文在盒子里自己滚。
  // 量不到（画布外自测、祖先高度不定）就不设内联高度，交给 CSS 的 height:100% 与一屏兜底。
  useFit(function () {
    if (!p.full) return undefined
    const el = fitRef.current
    if (!el || typeof window === 'undefined') return undefined
    const fit = function (): void {
      try {
        let host: any = el.parentElement
        let limit = 0
        while (host && host !== document.body) {
          const cs = window.getComputedStyle(host)
          if (/(auto|scroll|hidden)/.test(cs.overflowY) && host.clientHeight >= 200) {
            const pbd = parseFloat(cs.paddingBottom) || 0
            const r = host.getBoundingClientRect()
            limit = r.top + host.clientTop + host.clientHeight - Math.max(pbd, 8)
            break
          }
          host = host.parentElement
        }
        const top = el.getBoundingClientRect().top
        let h = limit ? limit - top : window.innerHeight - top - 12
        h = Math.max(240, Math.min(h, window.innerHeight - top - 6))
        el.style.height = Math.round(h) + 'px'
        el.style.maxHeight = 'none'
      } catch (e) { /* 忽略：走 CSS 兜底 */ }
    }
    fit()
    window.addEventListener('resize', fit)
    let ro: any = null
    try { if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(fit); ro.observe(el.parentElement || el) } } catch (e) { /* 忽略 */ }
    return function () {
      window.removeEventListener('resize', fit)
      try { if (ro) ro.disconnect() } catch (e) { /* 忽略 */ }
    }
  }, [p.full, d && d.open, d && d.name])
  // 状态行只在「还在读」和「出错了」两种时候出现（2026-10-10 人拍板，同日第三轮）：
  // 加载中按顺序 1 秒一句（三句轮播在 CSS 里）；内容一到，这一行**立刻不出现** ——
  // 人看过一阵子，说「内容已到」那一行没什么价值。出错时留着，不撤，人得看见原因。
  const showStatus = d && d.open && (d.phase === 'loading' || d.phase === 'error')
  if (!d || !d.open) return null
  const lang = d.bodyLang === 'zh' && d.mdZh ? 'zh' : 'en'
  const md = lang === 'zh' ? d.mdZh : d.mdEn
  // 复制按钮复制的是当前正在看的那一份：切到中文就复制译文包的路径。
  const copyPath = (lang === 'zh' && d.pathZh) ? d.pathZh : d.docPath
  const title = (lang === 'zh' ? d.titleZh : d.titleEn) || d.titleEn || ('/' + (d.name || ''))
  const heads = pixelDocHeadings(md || '').filter(function (x: PixelHeading) { return x.level >= 2 }).map(function (x: PixelHeading) { return x.text })
  // 只要随包带中文译文就出这颗按钮（2026-10-10 人拍板）：DSH 开英文时人照样想对照中文版。
  const canTranslate = !!d.mdZh
  const toTop = function (): void { try { if (bodyRef.current) bodyRef.current.scrollTop = 0 } catch (e) { /* 忽略 */ } }
  const jump = function (i: number): void {
    try {
      const hs = bodyRef.current ? bodyRef.current.querySelectorAll('h2,h3') : []
      if (hs[i]) bodyRef.current.scrollTop = hs[i].offsetTop - 8
    } catch (e) { /* 忽略 */ }
  }
  const icon = d.phase === 'loading' ? 'loading' : d.phase === 'ready' ? 'ok' : d.phase === 'error' ? (d.isMissing ? 'warn' : 'err') : 'idle'
  const frame = d.phase === 'ready' ? 'pixel-f-ok' : d.phase === 'error' && !d.isMissing ? 'pixel-f-err pixel-shake' : ''
  let body: any = null
  if (d.phase === 'loading' && d.showSkel) body = h(PixelSkeleton, { key: 'b', lines: 3 })
  else if (d.phase === 'ready') body = h(PixelMarkdown, { key: 'b', md: md, lang: lang, st: s })
  else if (d.phase === 'error' && d.isMissing) {
    body = h('div', { key: 'b', className: 'pixel-doc', 'data-lang': lang }, [
      h('p', { key: 't' }, [h(PixelStateIcon, { key: 'i', kind: 'warn' }), h('b', { key: 'x' }, tr('sd.miss'))]),
      h('p', { key: 'm' }, tr('sd.missBody')),
      h('p', { key: 's' }, d.shortDesc || ''),
    ])
  }
  else if (d.phase === 'error') body = h('p', { key: 'b' }, tr('sd.noBody'))
  else body = h('p', { key: 'b' }, tr('sd.none'))
  // full：详情占满页签中间区域（列表那时已经让位），不铺遮罩、不套小窗；否则仍是盖在页面上的居中弹窗。
  const box = h('div', {
    className: 'pixel-modal ' + frame + (p.full ? ' pixel-modal-full' : ''),
    role: 'dialog',
    'aria-label': title,
  }, [
    h(PixelSeal, { key: 'seal' }),
    h('div', { key: 'top', className: 'pixel-top' }, [
      h('span', { key: 't' }, title),
      h('span', { key: 'f', style: { flex: 1 } }),
      canTranslate ? h(PixelBtn, { key: 'l', hot: true, onClick: function () { pixelToggleDetailLang(s) } }, lang === 'en' ? tr('sd.toZh') : tr('sd.toEn')) : null,
      h(PixelBtn, { key: 'x', onClick: function () { pixelCloseDetail(s) } }, tr('sd.close')),
    ]),
    showStatus ? h(PixelStatusLine, {
      key: 'st',
      icon: icon,
      texts: d.phase === 'loading' ? [tr('sd.fetch'), tr('sd.parse'), tr('sd.layout')] : null,
      text: d.phaseText || tr('sd.idle'),
    }) : null,
    h('div', {
      key: 'body',
      ref: bodyRef,
      className: 'pixel-body',
    }, [
      d.phase === 'error' ? h(PixelBanner, {
        key: 'bn',
        kind: d.isMissing ? 'warn' : 'error',
        text: d.phaseText,
        onRetry: (!d.isMissing && typeof p.onRetry === 'function') ? function () { (p.onRetry as (name: string) => void)(d.name as string) } : null,
        onClose: function () { pixelCloseDetail(s) },
      }) : null,
      (d.phase === 'ready' && heads.length) ? h(PixelContents, { key: 'toc', items: heads, onJump: jump }) : null,
      body,
    ]),
    h('div', { key: 'bot', className: 'pixel-bot' }, [
      d.copyText ? h(PixelBtn, { key: 'c', onClick: function () { pixelCopyDetailLink(s, copyPath) } }, d.copied ? tr('sd.copied') : (copyPath ? tr('sd.copyPath') : tr('sd.copy'))) : null,
      (!d.isMissing && d.phase === 'error' && typeof p.onRetry === 'function') ? h(PixelBtn, { key: 'r', onClick: function () { (p.onRetry as (name: string) => void)(d.name as string) } }, tr('sd.retry')) : null,
      h('span', { key: 'f', style: { flex: 1 } }),
      h(PixelBtn, { key: 't', mini: true, onClick: toTop }, tr('sd.top')),
    ]),
  ])
  if (p.full) return h('div', { className: 'pixel-detail-full', ref: fitRef, 'data-fit': 'on' }, box)
  return h('div', {
    className: 'pixel-overlay',
    onClick: function (e: any) { try { if (e.target === e.currentTarget) pixelCloseDetail(s) } catch (err) { /* 忽略 */ } },
  }, box)
}
