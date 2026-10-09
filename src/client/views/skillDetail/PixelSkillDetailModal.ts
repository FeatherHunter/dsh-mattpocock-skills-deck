/**
 * views/skills/SkillDetailModal.ts — 技能详情弹窗的 TS 真源（887 TS 化，变体 A 定版）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:skillDetailModal (spliced by build) ====` 标记处。
 * 用法：SkillDetailModal({st, onRetry})，读 st.pxDetail，关着就画 null。
 * st.pxDetail = {open, name, titleEn, titleZh, mdEn, mdZh, shortDesc, bodyLang,
 *   phase, phaseText, isMissing, dshLang, copyText}，全由外层（888 取数通道）写。
 * 约定：①弹窗就地盖在父容器上（SwitchConfirmModal 同模式），父容器要 position:relative；
 * ②翻译按钮只在 dshLang 中文且有 mdZh 时出现（英文 DSH 下没有这个按钮，正文恒英文）；
 * ③复制按钮只在给了 copyText 时出现（复制什么链接由 888 定）；④回到顶部常驻底栏小按钮，
 * 不监听滚动（原型里按滚动显隐的版本有性能代价，生产里简化）；⑤取数计时与重试装载是 888 的活，
 * 本文件只管摆样子：onRetry(name) 由外层传进来，没有就不画重试按钮。
 */
import type {
  SkillDetailModalProps, PxStore, PxHeading, PxBtnProps, PxStateIconProps,
  PxStatusLineProps, PxBannerProps, PxTocProps, PxDocProps, PxSkelProps,
} from '../px-props';
declare const PxSeal: () => any;
declare const PxStateIcon: (props?: PxStateIconProps) => any;
declare const PxBtn: (props?: PxBtnProps) => any;
declare const PxStatusLine: (props?: PxStatusLineProps) => any;
declare const PxBanner: (props?: PxBannerProps) => any;
declare const PxToc: (props?: PxTocProps) => any;
declare const PxDoc: (props?: PxDocProps) => any;
declare const PxSkel: (props?: PxSkelProps) => any;
declare function pxDocHeadings(md?: string): PxHeading[];
export const pxCloseDetail = function (s: PxStore | null | undefined): void {
  if (!s) return
  s.pxDetail = null
  try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
}
export const pxToggleDetailLang = function (s: PxStore | null | undefined): void {
  const d = s && s.pxDetail
  if (!d) return
  d.bodyLang = d.bodyLang === 'zh' ? 'en' : 'zh'
  try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
}
export const pxCopyDetailLink = function (s: PxStore | null | undefined, text?: string): void {
  const d = s && s.pxDetail
  const done = function (): void {
    if (!d) return
    d.copied = true
    try { if (typeof emit === 'function') emit(s) } catch (e) { /* 画布外自测时没有 emit */ }
    setTimeout(function () {
      if (!s || s.pxDetail !== d) return
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
export const SkillDetailModal = function (props?: SkillDetailModalProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = p.st
  const d = s && s.pxDetail
  const bodyRef: any = React.useRef(null)
  if (!d || !d.open) return null
  const lang = d.bodyLang === 'zh' && d.mdZh ? 'zh' : 'en'
  const md = lang === 'zh' ? d.mdZh : d.mdEn
  const title = (lang === 'zh' ? d.titleZh : d.titleEn) || d.titleEn || ('/' + (d.name || ''))
  const heads = pxDocHeadings(md).filter(function (x: PxHeading) { return x.level >= 2 }).map(function (x: PxHeading) { return x.text })
  const canTranslate = d.dshLang !== 'en' && !!d.mdZh
  const toTop = function (): void { try { if (bodyRef.current) bodyRef.current.scrollTop = 0 } catch (e) { /* 忽略 */ } }
  const jump = function (i: number): void {
    try {
      const hs = bodyRef.current ? bodyRef.current.querySelectorAll('h2,h3') : []
      if (hs[i]) bodyRef.current.scrollTop = hs[i].offsetTop - 8
    } catch (e) { /* 忽略 */ }
  }
  const icon = d.phase === 'loading' ? 'loading' : d.phase === 'ready' ? 'ok' : d.phase === 'error' ? (d.isMissing ? 'warn' : 'err') : 'idle'
  const frame = d.phase === 'ready' ? 'px-f-ok' : d.phase === 'error' && !d.isMissing ? 'px-f-err px-shake' : ''
  let body: any = null
  if (d.phase === 'loading' && d.showSkel) body = h(PxSkel, { key: 'b', lines: 3 })
  else if (d.phase === 'ready') body = h(PxDoc, { key: 'b', md: md, lang: lang, st: s })
  else if (d.phase === 'error' && d.isMissing) {
    body = h('div', { key: 'b', className: 'px-doc', 'data-lang': lang }, [
      h('p', { key: 't' }, [h(PxStateIcon, { key: 'i', kind: 'warn' }), h('b', { key: 'x' }, tr('sd.miss'))]),
      h('p', { key: 'm' }, tr('sd.missBody')),
      h('p', { key: 's' }, d.shortDesc || ''),
    ])
  }
  else if (d.phase === 'error') body = h('p', { key: 'b' }, tr('sd.noBody'))
  else body = h('p', { key: 'b' }, tr('sd.none'))
  return h('div', {
    className: 'px-overlay',
    onClick: function (e: any) { try { if (e.target === e.currentTarget) pxCloseDetail(s) } catch (err) { /* 忽略 */ } },
  }, h('div', { className: 'px-modal ' + frame, role: 'dialog', 'aria-label': title }, [
    h(PxSeal, { key: 'seal' }),
    h('div', { key: 'top', className: 'px-top' }, [
      h('span', { key: 't' }, title),
      h('span', { key: 'f', style: { flex: 1 } }),
      canTranslate ? h(PxBtn, { key: 'l', hot: true, onClick: function () { pxToggleDetailLang(s) } }, lang === 'en' ? tr('sd.toZh') : tr('sd.toEn')) : null,
      h(PxBtn, { key: 'x', onClick: function () { pxCloseDetail(s) } }, tr('sd.close')),
    ]),
    h(PxStatusLine, { key: 'st', icon: icon, text: d.phaseText || tr('sd.idle') }),
    h('div', {
      key: 'body',
      ref: bodyRef,
      className: 'px-body',
    }, [
      d.phase === 'error' ? h(PxBanner, {
        key: 'bn',
        kind: d.isMissing ? 'warn' : 'error',
        text: d.phaseText,
        onRetry: (!d.isMissing && typeof p.onRetry === 'function') ? function () { (p.onRetry as (name: string) => void)(d.name as string) } : null,
        onClose: function () { pxCloseDetail(s) },
      }) : null,
      (d.phase === 'ready' && heads.length) ? h(PxToc, { key: 'toc', items: heads, onJump: jump }) : null,
      body,
    ]),
    h('div', { key: 'bot', className: 'px-bot' }, [
      d.copyText ? h(PxBtn, { key: 'c', onClick: function () { pxCopyDetailLink(s, d.copyText) } }, d.copied ? tr('sd.copied') : tr('sd.copy')) : null,
      (!d.isMissing && d.phase === 'error' && typeof p.onRetry === 'function') ? h(PxBtn, { key: 'r', onClick: function () { (p.onRetry as (name: string) => void)(d.name as string) } }, tr('sd.retry')) : null,
      h('span', { key: 'f', style: { flex: 1 } }),
      h(PxBtn, { key: 't', mini: true, onClick: toTop }, tr('sd.top')),
    ]),
  ]))
}
