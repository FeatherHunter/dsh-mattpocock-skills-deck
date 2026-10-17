// src/shared/naming-tracking.ts —— S2（#452）从 naming-guardian.js 拆出之值比对锁、跟踪态与状态机、失败重试、计划单。
// 接线：不引用标题与归属文件（墙要求）；编号分支要用的标题合成小函数在文件内放一份（tracking 前缀），与 naming-titles.js 同源，改动两处同改。

/**
 * src/shared/naming-tracking.ts — 命名守护跟踪推进半（#264/#267 · 从 naming-guardian.js 拆出，S2 #452）。
 * 契约（#264 · 单缝原则）：本文件是跟踪推进的真源 —— 值比对锁、分歧归因、跟踪态与分档状态机、计划单、失败重试。
 * 标题合成见 naming-titles.js，编号归属见 naming-attribution.js；三文件互不引用，宿主半运行时引用本文件，界面半由
 * scripts/build.mjs 拼回 src/client/index.js 闭包（一源两物）。纯函数，Node 可直跑。
 * 生效 2026-08-28，以 #264 规约 + #260 五决议 + ADR 20260827 为基线，未来定版以未来为准。
 */

// 下面两行把运行环境里可能缺席的全局量照实声明出来：Node 下有 Buffer 而浏览器闭包里没有，
// TextEncoder 在浏览器里有而老 Node 里没有。真正用之前一律沿用原文的 typeof 守卫写法，
// 所以声明成「可能缺席」才是实话，写成必在反而是撒谎。
declare const Buffer: { byteLength(s: string, encoding?: string): number } | undefined;
type TextEncoderCtor = new () => { encode(s: string): Uint8Array };
declare const TextEncoder: TextEncoderCtor | undefined;

/** 值比对真检测（#264 D3/F5）：@returns 'unlocked' | 'locked' | 'unknown' —— 机器写过就与 lastMachineTitle 比，
 * 没写过就与注册基准比，两条都不等即判手改；当前标题不可读（null/空串）→ unknown（调用方跳过本轮，不盲写）。 */
export type RenameLock = 'unlocked' | 'locked' | 'unknown'
// 三态缺一不可：unknown 表示“没信息”，调用方遇到它必须跳过本轮，绝不能当成 unlocked 去改名。
export function evaluateRenameLock({ currentTitle, lastMachineTitle, baselineTitle }: { currentTitle: unknown; lastMachineTitle: unknown; baselineTitle: unknown }): RenameLock {
  const cur = currentTitle == null ? null : String(currentTitle)
  if (cur === null || cur === '') return 'unknown'
  const last = lastMachineTitle == null ? null : String(lastMachineTitle)
  const base = baselineTitle == null ? null : String(baselineTitle)
  if (last !== null) return cur === last ? 'unlocked' : 'locked'
  if (base !== null) return cur === base ? 'unlocked' : 'locked'
  // 无基准（防御异常态）：无信息可判，放行由调用方决定
  return 'unlocked'
}

// ============ 原生首句标题免锁（#746 · 0.1.7 底座行为）============
// 底座在首条用户消息发出后会把首句裁剪成会话标题（与机器、用户都无关）；旧判据把它当手改永久
// 锁定。免锁只认派生关系：现名等于首句，或以首句开头且不短于下限（归一空白后比）。真手改仍锁定。
function normTitleLine(s: unknown): string { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
// 首句截断那条路的最小长度（见 isNativeAutoTitle 里的理由）。
export const NATIVE_TITLE_MIN_CHARS = 20
// 下限卡的是长度不是内容：用户手改的短名再像首句也不认，宁可多出一单也不盖掉用户的命名。
export function isNativeAutoTitle({ currentTitle, firstUserText }: { currentTitle: unknown; firstUserText: unknown }): boolean {
  const cur = normTitleLine(currentTitle), first = normTitleLine(firstUserText)
  if (!cur || !first) return false
  if (cur === first) return true
  // 截断那一路要有下限：底座写的是首句的截断，长度跟首句同量级；不加下限的话「1」这种短串
  // 也算首句派生，用户手改成一个短名就会被我们盖掉（对抗审查 B）。20 只是下限，可随真机观察再调。
  if (cur.length < NATIVE_TITLE_MIN_CHARS) return false
  return first.indexOf(cur) === 0
}

// ============ 分歧归因（唯一判据 · #746 与后续对抗审查、2026-10-03 标题来源事实的合并）============
// 执行点只问这一个函数「现在这个名字为什么不是我们要的」，六种答案各带去处：in-place 已在位不动；
// never-wrote 我们那次改名没落地（直接写）；auto-title 底座自动取的（可盖回）；first-sentence 底座首句名
// （无事实时的旧判据，可盖回）；hand-edit 别人写的（永久让位，理由进日志）；unknown-title 读不到（不动）。
export const DIVERGENCE = {
  IN_PLACE: 'in-place',
  NEVER_WROTE: 'never-wrote',
  AUTO_TITLE: 'auto-title',
  FIRST_SENTENCE: 'first-sentence',
  HAND_EDIT: 'hand-edit',
  UNKNOWN_TITLE: 'unknown-title',
}
export type DivergenceKind = typeof DIVERGENCE[keyof typeof DIVERGENCE]

// 第一问必须是「这条名是不是我们自己写的」：少了这一问，宿主改完名后客户端会把正确名判成手改。
export function classifyDivergence({ currentTitle, lastMachineTitle, baselineTitle, baselineIsOurs, firstUserText, targetTitle, titleSource }: {
  currentTitle: unknown; lastMachineTitle: unknown; baselineTitle: unknown; baselineIsOurs: unknown;
  firstUserText: unknown; targetTitle: unknown; titleSource: unknown;
}): DivergenceKind {
  try {
    const cur = normTitleLine(currentTitle)
    if (!cur) return DIVERGENCE.UNKNOWN_TITLE
    // 第一问必须是「这条名是不是我们自己写的」：我们写过的（目标名 / 机器最后写入值 / 基准名）就没有分歧。
    // 少了这一问，宿主刚改完、客户端拿同一张单再跑一遍时会把正确的名字判成手改 —— 每成功一次就锁死一次。
    const ours = (lastMachineTitle != null && cur === normTitleLine(lastMachineTitle)) ||
      (baselineIsOurs !== false && baselineTitle != null && cur === normTitleLine(baselineTitle)) ||
      (targetTitle != null && cur === normTitleLine(targetTitle))
    if (ours) return DIVERGENCE.IN_PLACE
    if (baselineIsOurs === false && lastMachineTitle == null) return DIVERGENCE.NEVER_WROTE
    // 事实优先：宿主随单下发的「这条名是谁写的」；与现名逐字对上才采信，对不上（标题已变）当没有。
    const ts = titleSource as { title?: unknown; kind?: unknown } | null | undefined
    if (ts && typeof ts === 'object' && normTitleLine(ts.title) === cur) {
      const k = String(ts.kind || '')
      return (k === 'fallback' || k === 'provider') ? DIVERGENCE.AUTO_TITLE : DIVERGENCE.HAND_EDIT
    }
    if (isNativeAutoTitle({ currentTitle: currentTitle, firstUserText: firstUserText })) return DIVERGENCE.FIRST_SENTENCE
    return DIVERGENCE.HAND_EDIT
  } catch (e) { return DIVERGENCE.UNKNOWN_TITLE }
}

// ============ 跟踪态结构 + 分档状态机 ============
// #264：结构 { sessionId, stage, lastMachineTitle, locked, repoKey, createdAt, updatedAt }；本实现追加
// baselineTitle/baselineIsOurs（注册那一次写下的名、以及它是不是我们写的）、hint（语义线索）。
export const NAMING_STAGES = {
  PLACEHOLDER: 'placeholder',
  DRAFT: 'draft',
  NUMBERED: 'numbered',
  REFINED: 'refined',   // P3 精修档（一期仅占位 · #264 Out of Scope · #260 决议「实现分期」）
}
export type NamingStage = typeof NAMING_STAGES[keyof typeof NAMING_STAGES]

// ---- P3 精修二期预留（#267）----
// 本期不含存量回填（#261 否决）也不含 LLM 精修；REFINED 零消费，planOrderFor 对它恒不出单。二期接缝：① reducer 增 'refined' 入账；② planOrderFor 出 kind:'refined' 单；③ 界面半按 kind 分派。

// 线索宽限：先裸档后升级语义，注册后即出裸档单；后到线索可再升级一次（用完即记 lastDraftHint）。
export const NAMING_HINT_GRACE_MS = 0

export type TrackingState = {
  sessionId: string; stage: NamingStage; lastMachineTitle: string | null;
  baselineTitle: string; baselineIsOurs: boolean; locked: boolean; hint: string | null;
  repoKey: string | null; cwd: string | null; number: number | null; numberText?: string;
  numberTitle: string | null; numberedDone: boolean; lastDraftHint: string | null;
  failCount: number; lastFailAt: number | null; lastError: string | null;
  summaryOnce: boolean; summaryFailed: boolean; createdAt: number; updatedAt: number;
  [k: string]: unknown;
}
// 旧账没 baselineIsOurs 字段时按 true 容错：加字段之前行为就是放行，缺字段不能反过来变严格。
export function createTrackingState({ sessionId, baselineTitle, repoKey, cwd, baselineIsOurs }: {
  sessionId: unknown; baselineTitle: unknown; repoKey?: unknown; cwd?: unknown; baselineIsOurs?: unknown;
}): TrackingState {
  const now = Date.now()
  return {
    sessionId: String(sessionId || ''),
    stage: NAMING_STAGES.PLACEHOLDER,
    lastMachineTitle: null,
    baselineTitle: String(baselineTitle || ''),
    // 基线这条名是不是我们自己写的（注册那次改名成功即 true）。旧账没有这个字段按 true 容错，行为与加它之前一致。
    baselineIsOurs: baselineIsOurs === false ? false : true,
    locked: false,
    hint: null,
    repoKey: (repoKey as string | null) || null,
    // #266 追加：cwd（索引快照执行上下文）、number/numberTitle（获号信息）、numberedDone（编号档 rename 已落定，防重复出单/循环）——盘上旧账兼容。
    cwd: (cwd as string | null) || null,
    number: null,
    numberTitle: null,
    numberedDone: false,
    // #746：上次草稿升级用掉的线索（后到不同线索可再升级一次；无/相同则不出单）
    lastDraftHint: null,
    // #267 追加：界面执行失败的有限重试入账（failCount=连败次数 / lastFailAt=末次失败时刻 / lastError=末次错误摘要；成功改名与全新编号跃迁清零重来）。
    failCount: 0,
    lastFailAt: null,
    lastError: null,
    // #746 追加：首轮摘要只调一次（summaryOnce=好线索已入账 / summaryFailed=调模型失败永不补调；读不到两段、没路由等未遂不记旗，可再试）。
    summaryOnce: false,
    summaryFailed: false,
    createdAt: now,
    updatedAt: now,
  }
}

export type TrackingEvent = { type: string; [k: string]: unknown }
/**
 * 分档状态机（纯 reducer）：所有信号（注册/认领推送线索/机器改名单回报/手改锁定/编号预留）
 * 都汇入同一入口 —— #264 US14「所有信号汇入同一个分档状态机」。
 */
// reducer 收到不认识的事件只回原态：调用方发错事件名时静默无事，比抛错更不容易把跟踪账写坏。
export function reduceTrackingState(state: TrackingState | null | undefined, event: TrackingEvent | null | undefined): TrackingState | null | undefined {
  if (!state) return state
  const ev = event || ({} as TrackingEvent)
  const next = Object.assign({}, state)
  if (ev.type === 'signal') {
    if (ev.hint && !next.locked) {
      next.hint = String(ev.hint).slice(0, 80)
      next.updatedAt = Date.now()
    }
  } else if (ev.type === 'renamed') {
    // 界面半回报：机器成功改名（title = DSH 归一化后实际接受的标题）
    if (!next.locked && ev.title) {
      if (next.stage === NAMING_STAGES.PLACEHOLDER) next.stage = NAMING_STAGES.DRAFT
      // #746：草稿档落定时记下用掉的线索，后到不同线索才能再升级（防重复/循环）
      if (next.stage === NAMING_STAGES.DRAFT) next.lastDraftHint = next.hint || null
      next.lastMachineTitle = String(ev.title)
      // #267：任何成功改名即清账重来（有限重试预算只针对连续失败的同一目标）
      next.failCount = 0; next.lastFailAt = null; next.lastError = null
      // #266：编号档 rename 落定判定 —— 接受标题携带同一 [#n] 前缀即视为编号档完成
      // （防止非编号名（如草稿档）的 renamed 抢占 numberedDone，杜绝重复出单/循环）
      // 对抗 K2：前缀按编号原文算（00 号是 [#00] 不是 [#0]），否则原文号永不落定。
      if (next.stage === NAMING_STAGES.NUMBERED && next.number != null) {
        const pfxNum = (next.numberText != null && String(next.numberText).trim() !== '') ? String(next.numberText).trim() : String(next.number)
        const pfx = '[' + '#' + pfxNum + ']'
        if (String(ev.title).indexOf(pfx) === 0) next.numberedDone = true
      }
      next.updatedAt = Date.now()
    }
  } else if (ev.type === 'locked') {
    next.locked = true
    next.updatedAt = Date.now()
  } else if (ev.type === 'numbered') {
    // #266 编号信号（host 索引差值/即时信号消费）。守卫：#264 手改锁定永不触碰；
    // 已有编号且不同 → 防串名（AC5）；相同编号 → 允许幂等重放携带标题。
    if (next.locked || ev.number == null) return state
    const evNum = Number(ev.number)
    if (!isFinite(evNum) || evNum < 0) return state   // 0 是合法编号（本地 Markdown 后端的地图就是 00）；编号原文随事件带走
    next.numberText = (ev.numberText != null ? String(ev.numberText) : String(next.number == null ? evNum : next.number)).slice(0, 20)
    if (next.number != null && Number(next.number) !== evNum) return state
    const freshNumbered = next.number == null   // 全新获号（非幂等重放）：换目标即重新开预算（#267）
    next.stage = NAMING_STAGES.NUMBERED
    next.number = evNum
    if (ev.title != null) next.numberTitle = String(ev.title).slice(0, 500)
    if (freshNumbered) { next.failCount = 0; next.lastFailAt = null; next.lastError = null }
    next.updatedAt = Date.now()
  } else if (ev.type === 'renameFailed') {
    // #267：界面半执行改名的失败回报入账（host wf.namingResult 消费；错误摘要限长防膨胀）。
    // 锁定会话不再出单，理论收不到本事件 —— 防御性忽略。
    if (!next.locked) {
      next.failCount = ((next.failCount || 0) + 1)
      next.lastFailAt = Date.now()
      next.lastError = String(ev.error || 'rename failed').slice(0, 200)
      next.updatedAt = Date.now()
    }
  } else if (ev.type === 'summaryDone') {
    // #746：首轮摘要好线索入账（hint 由摘要任务随事件带来，一并记 summaryOnce；只调一次）。
    if (!next.locked) {
      if (ev.hint) next.hint = String(ev.hint).slice(0, 80)
      next.summaryOnce = true
      next.updatedAt = Date.now()
    }
  } else if (ev.type === 'summaryFailed') {
    // #746：调模型失败永不补调（与改名重试预算无关，互不拖累）。
    if (!next.locked) { next.summaryFailed = true; next.updatedAt = Date.now() }
  }
  return next
}

// ============ 失败可见性与有限重试（#267 · F4）============
/**
 * 执行失败由本模块统一裁定（#264 F4：失败进入有限重试，放弃则升级为面板级可见提醒）。
 * reducer 入账 'renameFailed' + 下列纯函数：连败计数与末次失败时刻入态；冷却窗内不重复出单
 * （给瞬时故障自愈窗口）；同一目标连败达 NAMING_RETRY_MAX → 定败，planOrderFor 不再出单，
 * namingFailureInfo 出画像供宿主塞进 wf.namingPlan 的 failures，界面落 store 画常驻横幅；
 * 化解两条（手改 → locked；值一致收敛 → renamed）都会自动撤下横幅。
 */
export const NAMING_RETRY_MAX = 3

/** 改名失败后的冷却窗：这段时间内不重复出单，给瞬时故障留自愈余地（配合上面的 NAMING_RETRY_MAX 连败计数使用）。
 *  真源住 config/intervals.yaml 的 namingRetryCooldownMs。
 *  #1215 起真引中央时间参数：单行 import 提供本地绑定（planOrderFor 沿用此名）；
 *  对外不再转出（要这个值请直接从 time-config 引：二传会让 esbuild 起别名，域转译过不去）。
 *  拼进界面闭包时构建剥掉 import 这一行，名字由闭包里另一片 timeConfig 提供。 */
import { NAMING_RETRY_COOLDOWN_MS } from './time-config/values.js'

export type NamingFailureInfo = {
  sessionId: string; stage: NamingStage; kind: 'numbered' | 'draft'; hint: string | null;
  number: number | null; numberTitle: string; error: string; count: number; lastFailAt: number | null;
  lock: { lastMachineTitle: string | null; baselineTitle: string; locked: boolean };
}
// 未达预算就回 null：面板只在定败后才挂横幅，连败中途不打扰用户。
/** 定败画像（供面板呈现 + 协商化解判定）；未达预算上限 / 已锁 → null。 */
export function namingFailureInfo(state: TrackingState | null | undefined): NamingFailureInfo | null {
  if (!state || state.locked) return null
  if ((state.failCount || 0) < NAMING_RETRY_MAX) return null
  return {
    sessionId: state.sessionId,
    stage: state.stage,
    kind: state.stage === NAMING_STAGES.NUMBERED ? 'numbered' : 'draft',
    hint: state.hint || null,
    number: state.number == null ? null : Number(state.number),
    numberTitle: state.numberTitle || '',
    error: state.lastError || 'rename failed',
    count: state.failCount || 0,
    lastFailAt: state.lastFailAt == null ? null : state.lastFailAt,
    lock: {
      lastMachineTitle: state.lastMachineTitle,
      baselineTitle: state.baselineTitle,
      locked: state.locked,
    },
  }
}

// 订单里那份锁信息（值比对锁 + 归因要用的基准事实）。三处出单共用一份，免得各写各的漏字段。
function orderLockOf(state: TrackingState): { lastMachineTitle: string | null; baselineTitle: string; baselineIsOurs: boolean; locked: boolean } {
  return {
    lastMachineTitle: state.lastMachineTitle,
    baselineTitle: state.baselineTitle,
    baselineIsOurs: state.baselineIsOurs !== false,
    locked: state.locked,
  }
}

export type PlanOrder = {
  sessionId: string; kind: 'numbered' | 'draft'; number?: number; numberText?: string;
  title?: string; hint?: string | null; lock: { lastMachineTitle?: unknown; baselineTitle?: unknown; baselineIsOurs?: boolean; locked?: unknown };
  [k: string]: unknown;
}
/**
 * 待办改名计划单（纯函数产出）：locked / 非占位档 → 无单（草稿档后到不同线索除外）；
 * 有线索 → 携线索；无线索但过线索宽限 → 裸档；未过宽限 → 等待；
 * 草稿档落定后后到不同线索 → 再升级一次（#746）。
 * 订单只携带会话标识与目标语义段信息，不含语言相关字面量（#264 D2）。
 */
// 出单前先过三道门：锁了不出、连败到顶不出、冷却窗内不出，剩下的才是真要改的名。
export function planOrderFor(state: TrackingState | null | undefined, now: unknown, hintGraceMs: unknown, currentTitle: unknown): PlanOrder | null {
  if (!state) return null
  if (state.locked) return null
  // #267：有限重试门控 —— 连败达预算上限 → 定败不再出单（面板呈现接管）；
  // 冷却窗内不重复出单，瞬时故障等下一窗口自愈。
  if ((state.failCount || 0) >= NAMING_RETRY_MAX) return null
  {
    const tsGate = typeof now === 'number' ? now : Date.now()
    if (state.lastFailAt != null && (tsGate - state.lastFailAt) < NAMING_RETRY_COOLDOWN_MS) return null
  }
  // #266：编号档订单（编号 + issue 标题，语言无关，[#n] 前缀由合成函数保证）；给了 currentTitle 就按实际标题判
  // ——实际标题与目标不符即出单（宿主首句名盖掉 [#n] 名的那种靠它盖回）；没给则沿落定标记与机器最后写入值收敛。
  if (state.stage === NAMING_STAGES.NUMBERED) {
    if (state.number == null) return null
    const title = state.numberTitle || ''
    let target: string | null = null
    try { target = trackingNewSessionTitle({ number: state.number, numberText: state.numberText, title: title }) } catch (e) { return null }
    const cur = (typeof currentTitle === 'string' && currentTitle) ? currentTitle : null
    if (cur === target) return null
    if (!cur && (state.numberedDone || (state.lastMachineTitle != null && state.lastMachineTitle === target))) return null
    return {
      sessionId: state.sessionId,
      kind: 'numbered',
      number: state.number,
      numberText: state.numberText || String(state.number),
      title: title,
      lock: orderLockOf(state),
    }
  }
  if (state.stage !== NAMING_STAGES.PLACEHOLDER) {
    // #746：草稿档落定后，后到不同线索可再升级一次（无线索或与上次已用一致 → 不出单，防循环）；被盖回那种也走这里
    if (state.stage !== NAMING_STAGES.DRAFT) return null
    // 实际标题已不是机器最后写下的那个（多半是底座首句名又盖了一次）→ 补一单盖回去；
    // 真手改由执行点的归因函数拦下并记账锁定，不会反复改名。
    const curDraft = (typeof currentTitle === 'string') ? currentTitle : null
    const clobbered = !!(curDraft && state.lastMachineTitle != null && curDraft !== state.lastMachineTitle)
    if (!clobbered && (!state.hint || state.hint === (state.lastDraftHint || null))) return null
    return {
      sessionId: state.sessionId,
      kind: 'draft',
      hint: state.hint,
      lock: orderLockOf(state),
    }
  }
  const ts = typeof now === 'number' ? now : Date.now()
  const grace = typeof hintGraceMs === 'number' ? hintGraceMs : NAMING_HINT_GRACE_MS
  if (!state.hint && (ts - (state.createdAt || ts)) < grace) return null
  return {
    sessionId: state.sessionId,
    kind: 'draft',
    hint: state.hint || null,
    lock: {
      lastMachineTitle: state.lastMachineTitle,
      baselineTitle: state.baselineTitle,
      locked: state.locked,
    },
  }
}

// ---- 与 naming-titles.js 同源（墙要求不互相引用；改动时两处同改）----
// 计划单编号分支要用的标题合成小函数（清洗、字节预算、截断、合成），改名前缀 tracking，避免三文件拼回
// 同一个界面闭包时与标题文件重名。逻辑与 naming-titles.js 内同名函数逐行一致。
const TRACKING_SESSION_TITLE_MAX_BYTES = 120

function trackingCleanTitleText(s: unknown): string {
  let t = String(s || '')
  t = t.replace(/\x1B\][^\x07]*\x07/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B[^\x5B\x5D\x07]/g, '')
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

function trackingUtf8Bytes(str: string): number {
  if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(str, 'utf8')
  try { return new (TextEncoder as TextEncoderCtor)().encode(str).length } catch (e) { return str.length }
}

function trackingTruncateTitleUtf8(prefix: string, title: string, maxBytes: number): string {
  const sep = ' '
  const base = prefix + sep
  const baseBytes = trackingUtf8Bytes(base)
  if (trackingUtf8Bytes(title) + baseBytes <= maxBytes) return title
  const ellipsis = '…'
  const ellipsisBytes = trackingUtf8Bytes(ellipsis)
  let acc = 0; let out = ''
  for (const ch of title) {
    const b = trackingUtf8Bytes(ch)
    if (baseBytes + acc + b + ellipsisBytes > maxBytes) break
    acc += b; out += ch
  }
  return out.trimEnd() + ellipsis
}

function trackingNewSessionTitle(t: { number?: unknown; numberText?: unknown; title?: unknown }): string {
  const n = ((t && t.numberText != null && String(t.numberText).trim()) ? String(t.numberText).trim() : String(t && t.number != null ? t.number : '')).trim()
  if (!/^\d+$/.test(n)) throw new Error('newSessionTitle: invalid number ' + n)
  const prefix = '[' + '#' + n + ']'
  let title = trackingCleanTitleText(t && t.title != null ? t.title : '')
  if (!title) return prefix
  title = trackingTruncateTitleUtf8(prefix, title, TRACKING_SESSION_TITLE_MAX_BYTES)
  return prefix + ' ' + title
}
