/**
 * views/skillDetail/PixelSkillOps.ts — 技能详情取数的 TS 真源（888 落地：开合、阶段、缓存、重试）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelSkillOps (spliced by build) ====` 标记处。
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
/** 取原文超过这么久还没回来就先摆骨架屏（拼进闭包的中央常量，值在 config/intervals.yaml 的 skillSkeletonDelayMs）。 */
declare const SKILL_SKELETON_DELAY_MS: number;
/** 取回来的原文与它的绝对路径按技能名留一份（本会话内存，不落盘）：再点同一篇直接出内容，不闪阶段话。
 *  #1522 起连可点 md 文件名名单也一起留：换回缓存的技能时名单跟着这一篇走，不会挂着上一篇的。 */
export const pixelDetailCache: Record<string, { md: string; path: string; mdZh: string | null; pathZh: string | null; refs: string[] | null }> = {}
/** 宿主随正文给回的可点 md 文件名名单（#1522）：只认字符串；名单坏了就当没有，不影响正文渲染。 */
const pixelRefsOf = function (res: any): string[] | null {
  try {
    if (res && Array.isArray(res.refs)) return res.refs.map(function (n: any) { return String(n) })
  } catch (e) { /* 名单坏了不影响正文 */ }
  return null
}
let pixelSkelTimer: any = null
const pixelClearSkel = function (): void {
  try { if (pixelSkelTimer) { clearTimeout(pixelSkelTimer); pixelSkelTimer = null } } catch (e) { /* 忽略 */ }
}
// #1294：当前界面语言 id 由语言链给出（uiLang 是拼进闭包的取词助手）。
//   以前这里判「是不是 en，否则 zh」—— 清单加第三门语言时会把第三门错落回中文，现在直接报当前语言；
//   Node/单测里没有 uiLang 时退生成物里的缺省语言（LANG_CONFIG.default，不写死 zh）。
declare const LANG_CONFIG: any;
const pixelLangOf = function (): string {
  try { if (typeof uiLang === 'function') return String(uiLang() || '') } catch (e) { /* 无语言服务时往下退 */ }
  try { if (typeof LANG_CONFIG === 'object' && LANG_CONFIG && LANG_CONFIG.default) return String(LANG_CONFIG.default) } catch (e) {}
  return ''
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
/** 起一次取数（技能正文、重试、点开随包 md 共用；三处只差参数与成功后的落字段）：
 *  骨架定时器、宿主电话、两条日志都在这里；成功把读数交给 onOk，失败按缺文/读失败进失败态。
 *  failCode 只进日志（区分「技能正文没读到」与「随包文件没读到」），不写原文与路径。 */
const pixelFetch = function (st: PixelStore, created: any, args: any, failCode: string, onOk: (res: any) => void): void {
  pixelClearSkel()
  pixelSkelTimer = setTimeout(function () {
    const d = created
    if (!d || !pixelAlive(st, d) || d.phase !== 'loading') return
    d.showSkel = true
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  }, SKILL_SKELETON_DELAY_MS)
  const t0 = Date.now()
  let pending: any = null
  try {
    pending = (typeof host !== 'undefined' && host && typeof host.call === 'function') ? host.call('skill.readDoc', args) : null
  } catch (e) { pending = null }
  if (!pending || typeof pending.then !== 'function') { pixelFail(st, created, false); return }
  pending.then(function (res: any) {
    try {
      if (res && res.ok === true) log('info', 'host.call', { method: 'skill.readDoc', latencyMs: Date.now() - t0, ok: true, kind: 'skill-doc' })
      else log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String(failCode), 120, 'error')) })
    } catch (eL) { /* 日志失败不影响界面 */ }
    // 被挤掉（超过三层）或已经关掉的那一层：读数回来也不许再动界面。
    const d = created
    if (!d || !pixelAlive(st, d)) return
    pixelClearSkel()
    if (res && res.ok === true) { onOk(res); return }
    pixelFail(st, created, true)
  }, function (e: any) {
    try { log('warn', 'host.call.fail', { method: 'skill.readDoc', kind: 'skill-doc', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) { /* 忽略 */ }
    pixelFail(st, created, false)
  })
}
/** 取这一层的技能正文（打开与重试走同一条）：成功后写进这一层，被挤掉或关掉的那层回来的读数直接丢。 */
const pixelLoad = function (st: PixelStore, created: any, name: string): void {
  pixelFetch(st, created, { name: name }, 'skill-doc-not-ok', function (res: any) {
    if (!res.md) { pixelFail(st, created, true); return }
    const docPath = String((res && res.path) || '')
    const zh = (res && res.mdZh) ? String(res.mdZh) : ''
    const zhPath = zh ? String((res && res.pathZh) || '') : ''
    // #1522：正文里写到的随包 md 文件名也要能点开，名单跟正文一起回来，存进这一层给渲染器用。
    created.skill = name
    created.refs = pixelRefsOf(res)
    created.mdEn = String(res.md)
    created.mdZh = zh || null
    created.pathZh = zhPath || null
    // 弹窗底栏那颗按钮复制的是这份原文在用户电脑上的绝对路径（人拍板 2026-10-10）
    created.copyText = docPath || null
    created.docPath = docPath || null
    created.phase = 'ready'
    created.phaseText = tr('sd.ready')
    created.showSkel = false
    pixelDetailCache[name] = { md: String(res.md), path: docPath, mdZh: zh || null, pathZh: zhPath || null, refs: created.refs }
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  })
}

/** 把这一层的正文内容清空（四种结果落字段前、重试与换模板共用）：不动阶段与说明文字。 */
const pixelClearDoc = function (d: any): void {
  d.mdEn = null
  d.mdZh = null
  d.docPath = null
  d.pathZh = null
  d.copyText = null
  d.options = null
}
/** 把这一层擦回加载态（重试与换一份模板共用）：清掉上一份原文与失败说明，界面回到正在取数。 */
const pixelResetLayer = function (d: any): void {
  pixelClearDoc(d)
  d.copied = false
  d.phase = 'loading'
  d.phaseText = tr('sd.fetch')
  d.isMissing = false
  d.showSkel = false
}
/** 读一份正文里点开的随包 md（#1522）：跟正文取数走同一条宿主电话（pixelFetch），多带一个 file 参数。
 *  宿主回四种之一：project＝技能在项目里维护的文件（只给一句说明，不伪造原文）；
 *  choose＝随包有多份模板，先把候选交给弹窗列按钮；format＝点开的是格式模板，界面要注明；
 *  file＝普通随包原文。中文译文按宿主给的 mdZh 走与正文同一套中英切换。 */
const pixelLoadFile = function (st: PixelStore, created: any, skillName: string | null | undefined, ref: string): void {
  pixelFetch(st, created, { name: skillName || '', file: ref }, 'skill-file-not-ok', function (res: any) {
    const d = created
    d.refs = pixelRefsOf(res)
    d.showSkel = false
    d.copied = false
    if (res.kind === 'project') {
      d.kind = 'project'
      d.format = false
      pixelClearDoc(d)
    } else if (res.kind === 'choose') {
      d.kind = 'choose'
      // 别名文件先给候选时，宿主用 format 说明「选的是格式模板」：这一层的说明与标题要靠它留住。
      d.format = res.format === true
      pixelClearDoc(d)
      d.options = Array.isArray(res.options) ? res.options : []
    } else {
      if (!res.md) { pixelFail(st, created, true); return }
      const docPath = String((res && res.path) || '')
      const zh = (res && res.mdZh) ? String(res.mdZh) : ''
      const zhPath = zh ? String((res && res.pathZh) || '') : ''
      // 从候选里选定的模板换回来的是普通 file，但这一层仍是格式说明：靠这里的标记区分。
      if (res.kind === 'format') d.format = true
      d.kind = d.format === true ? 'format' : 'file'
      d.file = String((res && res.file) || ref)
      d.skill = res.skill ? String(res.skill) : (skillName ? String(skillName) : null)
      d.mdEn = String(res.md)
      d.mdZh = zh || null
      d.pathZh = zhPath || null
      d.docPath = docPath || null
      d.copyText = docPath || null
      d.options = null
    }
    d.phase = 'ready'
    d.phaseText = tr('sd.ready')
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
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
    // kind：空/缺省是技能正文层；文件层另有 file/format/project/choose 四种（#1522）。
    kind: 'skill',
    // format：这一层打开的是不是格式模板（#1522 方案 C）；技能正文层永远不是。
    format: false,
    name: name,
    titleEn: '/' + name,
    titleZh: '/' + name,
    skill: name,
    // 名单要等这一篇的取数回来才有；先空着，取回后按这一篇自己的名单填（不挂上一篇的）。
    refs: null,
    mdEn: null,
    mdZh: null,
    shortDesc: use,
    // 正文默认英文原文；随包若带中文译文（兄弟目录 bundled-skills-zh 下的同名文件），弹窗上那颗「中文」按钮就能切过去。
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
    created.skill = name
    created.refs = cached.refs || null
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
/** 从正文里点开一个随包 md 文件名（#1522）：压一层新的详情，取数时带上这一层归属的技能目录，
 *  同名文件优先在当前技能目录里找；技能目录里没有就按唯一性去别处找，分不清时弹窗让人选。
 *  当前这一层已经是同一个文件、并且没出错：不重复压层（跟技能详情同一套手感）。 */
export const pixelOpenFileRef = function (st: PixelStore | null | undefined, ref?: string): void {
  if (!st || !ref) return
  const stack = pixelStackOf(st)
  const top = stack[stack.length - 1]
  const baseSkill: string | null = top
    ? ((top.kind && top.kind !== 'skill') ? (top.skill || null) : (top.name || null))
    : null
  if (top && top.kind && top.kind !== 'skill' && top.name === ref && top.phase !== 'error') return
  const created: any = {
    open: true,
    kind: 'file',
    // 点进来的是正文里写的名字；它是不是格式模板要等宿主回话（kind=format 或 choose+format）。
    format: false,
    name: ref,
    titleEn: ref,
    titleZh: ref,
    file: ref,
    skill: baseSkill,
    refs: null,
    mdEn: null,
    mdZh: null,
    shortDesc: '',
    bodyLang: 'en',
    phase: 'loading',
    phaseText: tr('sd.fetch'),
    isMissing: false,
    dshLang: pixelLangOf(),
    showSkel: false,
  }
  stack.push(created)
  while (stack.length > PIXEL_STACK_MAX) stack.shift()
  pixelSyncTop(st)
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  pixelLoadFile(st, created, baseSkill, ref)
}
/** 多份模板里选一份（#1522）：不压新层，直接把当前这层换成选中的那份原文（选完还能照常中英切换）。 */
export const pixelPickFileOption = function (st: PixelStore | null | undefined, opt?: { file?: string; skill?: string } | null): void {
  const d: any = st && st.pixelDetail
  if (!d || !opt || !opt.file) return
  // 格式模板的候选（#1522）：标题与「这是格式说明」保留点进来的那个名字（如 GLOSSARY.md），
  // 只把内容换成选中的模板；其余候选（issue-tracker.md 的三份）换名成选中的那份。
  const keepName = d.format === true
  d.kind = keepName ? 'format' : 'file'
  if (!keepName) {
    d.name = String(opt.file)
    d.titleEn = String(opt.file)
    d.titleZh = String(opt.file)
  }
  d.file = String(opt.file)
  d.skill = opt.skill ? String(opt.skill) : null
  d.options = null
  pixelResetLayer(d)
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  pixelLoadFile(st as PixelStore, d, d.skill, d.file)
}
export const pixelRetryDetail = function (st: PixelStore | null | undefined): void {
  const d: any = st && st.pixelDetail
  if (!d || !d.name) return
  // #1522：随包 md 的详情层（原文 / 格式模板 / 多份模板待选）按这一层自己的文件重新取，
  // 不能拿文件名字去当技能名取 SKILL.md；待选层重取的是这个名字对应的候选清单。
  if (d.kind === 'file' || d.kind === 'format' || d.kind === 'choose') {
    const ref = d.kind === 'choose' ? d.name : (d.file || d.name)
    pixelResetLayer(d)
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
    pixelLoadFile(st as PixelStore, d, d.skill || '', ref)
    return
  }
  const name = d.name
  try { delete pixelDetailCache[name] } catch (e) { /* 忽略 */ }
  // 重试是在**这一层**上重来，不新压一层：把这一层擦回加载态，再走一遍同一条取数。
  pixelResetLayer(d)
  try { if (typeof emit === 'function') emit(st) } catch (e) { /* 忽略 */ }
  pixelLoad(st as PixelStore, d, name)
}
export const pixelCloseDetailAndClean = function (st: PixelStore | null | undefined): void {
  pixelClearSkel()
  pixelCloseDetail(st)
}
