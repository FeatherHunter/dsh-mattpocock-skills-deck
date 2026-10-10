/**
 * views/skillDetail/PixelSkillOps.ts — 技能详情取数的 TS 真源（888 落地：开合、阶段、缓存、重试）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSkillOps (spliced by build) ====` 标记处。
 * 用法：pixelOpenDetail(st, name, item) 打开并取原文（压一层详情）；pixelRetryDetail(st) 在**当前这一层**上重试。
 * 详情栈（2026-10-10 人拍板）：从详情里点开另一篇就再压一层，关一层回到上一层；最多三层，
 * 超过三层时把最深的那层挤掉。st.pixelDetail 恒等于栈顶，外面原来的读法一个字不用改。
 * 成功时把原文的绝对路径写进 st.pixelDetail.copyText：弹窗底栏那颗按钮复制的就是它。
 * 取数走宿主电话 skill.readDoc（src/host/skillDoc.js），只读随包原文目录。
 * 三条诚实约定：①加载中按顺序 1 秒一句（正在取文件／正在解析／正在排版，纯 CSS 轮播），
 * 内容一到状态行整行就不出现（人拍板：那一行没价值）。②超过 2 秒才铺占位块
 * （886 v3 定版），2 秒内到货不铺，避免闪一下。③宿主回 ok:false 一律按「包里没有这一篇」处理，
 * 弹窗给诚实说明并保留短描述；电话本身拿不到（宿主缺席、抛异常）才算「读失败」，给横幅与重试。
 * 每条取数落一行既有事件 host.call / host.call.fail（不新增事件、不写原文与路径）。
 */
import type { PixelStore, PixelSkillItem } from '../pixelProps';
declare function pixelCloseDetail(s?: PixelStore | null): void;
/** 取回来的原文与它的绝对路径按技能名留一份（本会话内存，不落盘）：再点同一篇直接出内容，不闪阶段话。 */
export const pixelDetailCache: Record<string, { md: string; path: string; mdZh: string | null; pathZh: string | null }> = {}
let pixelSkelTimer: any = null
const pixelClearSkel = function (): void {
  try { if (pixelSkelTimer) { clearTimeout(pixelSkelTimer); pixelSkelTimer = null } } catch (e) { /* 忽略 */ }
}
const pixelLangOf = function (): string {
  try { if (typeof promptLang === 'function') return promptLang() === 'en' ? 'en' : 'zh' } catch (e) { /* 无语言服务时回落中文 */ }
  return 'zh'
}
/** 详情栈最多三层（2026-10-10 人拍板）：再开一层就把最深的那层挤掉，人总能看到最近三层。 */
const PIXEL_STACK_MAX = 3
const pixelStackOf = function (st: PixelStore): any[] {
  if (!Array.isArray(st.pixelDetailStack)) st.pixelDetailStack = []
  return st.pixelDetailStack as any[]
}
/** 栈顶就是当前看的那一层：st.pixelDetail 恒等于栈顶，外面原来的读法一个字都不用改。 */
const pixelSyncTop = function (st: PixelStore): void {
  const s = pixelStackOf(st)
  st.pixelDetail = s.length ? s[s.length - 1] : null
}
/** 这一层还在栈里吗：被挤掉（超过三层）或已被关掉的那层，回来的读数一律不许再动界面。 */
const pixelAlive = function (st: PixelStore, created: any): boolean {
  const s = Array.isArray(st.pixelDetailStack) ? st.pixelDetailStack : []
  return s.indexOf(created) >= 0
}
/** 进失败态：isMissing 为真走缺文说明（不画重试），为假走横幅加重试。 */
const pixelFail = function (st: PixelStore, created: any, isMissing: boolean): void {
  const d = created
  if (!d || !pixelAlive(st, d)) return
  pixelClearSkel()
  d.phase = 'error'
  d.isMissing = !!isMissing
  d.phaseText = isMissing ? tr('sd.miss') : tr('sd.fail')
  d.showSkel = false
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
}
/** 取这一层的原文（打开与重试走同一条）：成功后写进这一层，被挤掉或关掉的那层回来的读数直接丢。 */
const pixelLoad = function (st: PixelStore, created: any, name: string): void {
  pixelClearSkel()
  pixelSkelTimer = setTimeout(function () {
    const d = created
    if (!d || !pixelAlive(st, d) || d.phase !== 'loading') return
    d.showSkel = true
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  }, 2000)
  const t0 = Date.now()
  let pending: any = null
  try {
    pending = (typeof host !== 'undefined' && host && typeof host.call === 'function') ? host.call('skill.readDoc', { name: name }) : null
  } catch (e) { pending = null }
  if (!pending || typeof pending.then !== 'function') { pixelFail(st, created, false); return }
  pending.then(function (res: any) {
    try {
      if (res && res.ok === true) log('info', 'host.call', { method: 'skill.readDoc', latencyMs: Date.now() - t0, ok: true, kind: 'skill-doc' })
      else log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String('skill-doc-not-ok'), 120, 'error')) })
    } catch (eL) { /* 日志失败不影响界面 */ }
    // 被挤掉（超过三层）或已经关掉的那一层：读数回来也不许再动界面。
    const d = created
    if (!d || !pixelAlive(st, d)) return
    pixelClearSkel()
    if (res && res.ok === true && res.md) {
      const docPath = String((res && res.path) || '')
      const zh = (res && res.mdZh) ? String(res.mdZh) : ''
      const zhPath = zh ? String((res && res.pathZh) || '') : ''
      pixelDetailCache[name] = { md: String(res.md), path: docPath, mdZh: zh || null, pathZh: zhPath || null }
      d.mdEn = String(res.md)
      d.mdZh = zh || null
      d.pathZh = zhPath || null
      // 弹窗底栏那颗按钮复制的是这份原文在用户电脑上的绝对路径（人拍板 2026-10-10）
      d.copyText = docPath || null
      d.docPath = docPath || null
      d.phase = 'ready'
      d.phaseText = tr('sd.ready')
      d.showSkel = false
      try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
      return
    }
    pixelFail(st, created, true)
  }, function (e: any) {
    try { log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) { /* 忽略 */ }
    pixelFail(st, created, false)
  })
}

export const pixelOpenDetail = function (st: PixelStore | null | undefined, name?: string, item?: PixelSkillItem | null): void {
  if (!st || !name) return
  const use = (item && item.use) || ''
  const stack = pixelStackOf(st)
  const top = stack[stack.length - 1]
  // 已经在看这一篇（还在最上层）：不重复压一层。出错态除外 —— 那时候人点它多半是想再要一次。
  if (top && top.name === name && top.phase !== 'error') return
  const created: any = {
    open: true,
    name: name,
    titleEn: '/' + name,
    titleZh: '/' + name,
    mdEn: null,
    mdZh: null,
    shortDesc: use,
    // 正文默认英文原文；随包若带中文译文（SKILL.zh.md），弹窗上那颗「中文」按钮就能切过去。
    bodyLang: 'en',
    phase: 'loading',
    phaseText: tr('sd.fetch'),
    isMissing: false,
    dshLang: pixelLangOf(),
    showSkel: false,
  }
  stack.push(created)
  // 超过三层：把最深的那层挤掉（人拍板：超过三个就关掉最深的那个详情页）。
  while (stack.length > PIXEL_STACK_MAX) stack.shift()
  pixelSyncTop(st)
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  const cached = pixelDetailCache[name]
  if (cached) {
    created.mdEn = cached.md
    created.docPath = cached.path
    created.copyText = cached.path
    created.mdZh = cached.mdZh
    created.pathZh = cached.pathZh
    created.phase = 'ready'
    created.phaseText = tr('sd.readyHit')
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
    return
  }
  pixelLoad(st, created, name)
}
export const pixelRetryDetail = function (st: PixelStore | null | undefined): void {
  const d: any = st && st.pixelDetail
  if (!d || !d.name) return
  const name = d.name
  try { delete pixelDetailCache[name] } catch (e) { /* 忽略 */ }
  // 重试是在**这一层**上重来，不新压一层：把这一层擦回加载态，再走一遍同一条取数。
  d.mdEn = null
  d.mdZh = null
  d.docPath = null
  d.pathZh = null
  d.copyText = null
  d.copied = false
  d.phase = 'loading'
  d.phaseText = tr('sd.fetch')
  d.isMissing = false
  d.showSkel = false
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  pixelLoad(st as PixelStore, d, name)
}
export const pixelCloseDetailAndClean = function (st: PixelStore | null | undefined): void {
  pixelClearSkel()
  pixelCloseDetail(st)
}
