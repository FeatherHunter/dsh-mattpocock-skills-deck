/**
 * views/skillDetail/PixelSkillDetailModal.ts — 技能详情弹窗的 TS 真源（887 TS 化，变体 A 定版）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSkillDetailModal (spliced by build) ====` 标记处。
 * 用法：PixelSkillDetailModal({st, onRetry})，读 st.pixelDetail，关着就画 null。
 * st.pixelDetail = {open, name, titleEn, titleZh, mdEn, mdZh, shortDesc, bodyLang,
 *   phase, phaseText, isMissing, dshLang, copyText}，全由外层（888 取数通道）写。
 * 约定：①弹窗就地盖在父容器上（SwitchConfirmModal 同模式），父容器要 position:relative；
 * ②翻译按钮只在 dshLang 中文且有 mdZh 时出现（英文 DSH 下没有这个按钮，正文恒英文）；
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
export const pixelCopyDetailLink = function (s: PixelStore | null | undefined, text?: string): void {
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
  if (!d || !d.open) return null
  const lang = d.bodyLang === 'zh' && d.mdZh ? 'zh' : 'en'
  const md = lang === 'zh' ? d.mdZh : d.mdEn
  const title = (lang === 'zh' ? d.titleZh : d.titleEn) || d.titleEn || ('/' + (d.name || ''))
  const heads = pixelDocHeadings(md || '').filter(function (x: PixelHeading) { return x.level >= 2 }).map(function (x: PixelHeading) { return x.text })
  const canTranslate = d.dshLang !== 'en' && !!d.mdZh
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
  return h('div', {
    className: 'pixel-overlay',
    onClick: function (e: any) { try { if (e.target === e.currentTarget) pixelCloseDetail(s) } catch (err) { /* 忽略 */ } },
  }, h('div', { className: 'pixel-modal ' + frame, role: 'dialog', 'aria-label': title }, [
    h(PixelSeal, { key: 'seal' }),
    h('div', { key: 'top', className: 'pixel-top' }, [
      h('span', { key: 't' }, title),
      h('span', { key: 'f', style: { flex: 1 } }),
      canTranslate ? h(PixelBtn, { key: 'l', hot: true, onClick: function () { pixelToggleDetailLang(s) } }, lang === 'en' ? tr('sd.toZh') : tr('sd.toEn')) : null,
      h(PixelBtn, { key: 'x', onClick: function () { pixelCloseDetail(s) } }, tr('sd.close')),
    ]),
    h(PixelStatusLine, { key: 'st', icon: icon, text: d.phaseText || tr('sd.idle') }),
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
      d.copyText ? h(PixelBtn, { key: 'c', onClick: function () { pixelCopyDetailLink(s, d.copyText) } }, d.copied ? tr('sd.copied') : tr('sd.copy')) : null,
      (!d.isMissing && d.phase === 'error' && typeof p.onRetry === 'function') ? h(PixelBtn, { key: 'r', onClick: function () { (p.onRetry as (name: string) => void)(d.name as string) } }, tr('sd.retry')) : null,
      h('span', { key: 'f', style: { flex: 1 } }),
      h(PixelBtn, { key: 't', mini: true, onClick: toTop }, tr('sd.top')),
    ]),
  ]))
}
