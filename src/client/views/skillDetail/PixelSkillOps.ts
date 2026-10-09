/**
 * views/skillDetail/PixelSkillOps.ts — 技能详情取数的 TS 真源（888 落地：开合、阶段、缓存、重试）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSkillOps (spliced by build) ====` 标记处。
 * 用法：pixelOpenDetail(st, name, item) 打开并取原文；pixelRetryDetail(st) 重试当前这篇。
 * 取数走宿主电话 skill.readDoc（src/host/skillDoc.js），只读随包原文目录。
 * 三条诚实约定：①阶段话只有两句——发出请求前「正在取文件」，内容到了「内容已到」；
 * 中间没有第三句假阶段（那一跳是宿主读盘，客户端没有真实回调可用，不编）。②超过 2 秒才铺占位块
 * （886 v3 定版），2 秒内到货不铺，避免闪一下。③宿主回 ok:false 一律按「包里没有这一篇」处理，
 * 弹窗给诚实说明并保留短描述；电话本身拿不到（宿主缺席、抛异常）才算「读失败」，给横幅与重试。
 * 每条取数落一行既有事件 host.call / host.call.fail（不新增事件、不写原文与路径）。
 */
import type { PixelStore, PixelSkillItem } from '../pixelProps';
declare function pixelCloseDetail(s?: PixelStore | null): void;
/** 取回来的原文按技能名留一份（本会话内存，不落盘）：再点同一篇直接出内容，不闪阶段话。 */
export const pixelDetailCache: Record<string, string> = {}
let pixelSkelTimer: any = null
const pixelClearSkel = function (): void {
  try { if (pixelSkelTimer) { clearTimeout(pixelSkelTimer); pixelSkelTimer = null } } catch (e) { /* 忽略 */ }
}
const pixelLangOf = function (): string {
  try { if (typeof promptLang === 'function') return promptLang() === 'en' ? 'en' : 'zh' } catch (e) { /* 无语言服务时回落中文 */ }
  return 'zh'
}
/** 进失败态：isMissing 为真走缺文说明（不画重试），为假走横幅加重试。 */
const pixelFail = function (st: PixelStore, name: string, isMissing: boolean): void {
  const d = st && st.pixelDetail
  if (!d || d.name !== name) return
  pixelClearSkel()
  d.phase = 'error'
  d.isMissing = !!isMissing
  d.phaseText = isMissing ? tr('sd.miss') : tr('sd.fail')
  d.showSkel = false
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
}
export const pixelOpenDetail = function (st: PixelStore | null | undefined, name?: string, item?: PixelSkillItem | null): void {
  if (!st || !name) return
  const use = (item && item.use) || ''
  st.pixelDetail = {
    open: true,
    name: name,
    titleEn: '/' + name,
    titleZh: '/' + name,
    mdEn: null,
    mdZh: null,
    shortDesc: use,
    // 正文恒英文：随包原文只有英文一份，中文译文包不在本票范围（888 的另一笔）。
    bodyLang: 'en',
    phase: 'loading',
    phaseText: tr('sd.fetch'),
    isMissing: false,
    dshLang: pixelLangOf(),
    showSkel: false,
  }
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  const created = st.pixelDetail as any
  const cached = pixelDetailCache[name]
  if (cached) {
    created.mdEn = cached
    created.phase = 'ready'
    created.phaseText = tr('sd.readyHit')
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
    return
  }
  pixelClearSkel()
  pixelSkelTimer = setTimeout(function () {
    const d = st.pixelDetail as any
    if (!d || d.name !== name || d.phase !== 'loading') return
    d.showSkel = true
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  }, 2000)
  const t0 = Date.now()
  let pending: any = null
  try {
    pending = (typeof host !== 'undefined' && host && typeof host.call === 'function') ? host.call('skill.readDoc', { name: name }) : null
  } catch (e) { pending = null }
  if (!pending || typeof pending.then !== 'function') { pixelFail(st, name, false); return }
  pending.then(function (res: any) {
    try {
      if (res && res.ok === true) log('info', 'host.call', { method: 'skill.readDoc', latencyMs: Date.now() - t0, ok: true, kind: 'skill-doc' })
      else log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String('skill-doc-not-ok'), 120, 'error')) })
    } catch (eL) { /* 日志失败不影响界面 */ }
    const d = st.pixelDetail
    if (!d || d.name !== name) return
    pixelClearSkel()
    if (res && res.ok === true && res.md) {
      pixelDetailCache[name] = String(res.md)
      d.mdEn = String(res.md)
      d.phase = 'ready'
      d.phaseText = tr('sd.ready')
      d.showSkel = false
      try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
      return
    }
    pixelFail(st, name, true)
  }, function (e: any) {
    try { log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) { /* 忽略 */ }
    pixelFail(st, name, false)
  })
}
export const pixelRetryDetail = function (st: PixelStore | null | undefined): void {
  const d = st && st.pixelDetail
  if (!d || !d.name) return
  const name = d.name
  const use = d.shortDesc
  try { delete pixelDetailCache[name] } catch (e) { /* 忽略 */ }
  pixelOpenDetail(st, name, { name: name, use: use })
}
export const pixelCloseDetailAndClean = function (st: PixelStore | null | undefined): void {
  pixelClearSkel()
  pixelCloseDetail(st)
}
