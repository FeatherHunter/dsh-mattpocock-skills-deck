/**
 * src/shared/naming-guardian.js — 命名守护核心纯函数（#265 · 分级命名守护一期）
 *
 * 契约（#264 规约 · 单缝原则）：本模块是命名判定的唯一真源 —— 占位识别、分档状态机、
 * 标题合成（草稿档 + 编号档，清洗截断沿用 #205 既有规则与 UTF-8 120 字节预算）、
 * 值比对锁判定、跟踪态结构与计划单产出。host 半运行时 import() 本模块；client 半由
 * scripts/build.mjs 以 SHARED_SPLICE 方式将本文件声明体拼回 src/client/index.js 闭包
 * （一源两物，与 kernel/leaf splice 同模式），两半均不另写第二处命名实现。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #264 规约 + #260 五决议 + ADR 20260827 为基线；与更早方案冲突以
 *           本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 本模块为纯函数：无 IO、无内核依赖（promptLang 为可选闭包自由变量，typeof 守卫），
 * 可被 Node verify 测试直接 import() 复跑。
 */

export const NAMING_CORE_VERSION = 1

// ============ 占位（P0）============
// 占位四式（#211 定版 · 跟随 harness 语言）：[New] 新建需求 / [New] 新建 Bug / New Requirement / New Bug
export const SESSION_TITLE_PREFIX = '[New]'

export const PLACEHOLDER_TITLES = {
  zh: { requirement: '新建需求', bug: '新建 Bug' },
  en: { requirement: 'New Requirement', bug: 'New Bug' },
}

export function isPlaceholderTitle(s) {
  const raw = String(s == null ? '' : s).trim()
  const zh = PLACEHOLDER_TITLES.zh
  const en = PLACEHOLDER_TITLES.en
  return raw === SESSION_TITLE_PREFIX + ' ' + zh.requirement ||
    raw === SESSION_TITLE_PREFIX + ' ' + zh.bug ||
    raw === SESSION_TITLE_PREFIX + ' ' + en.requirement ||
    raw === SESSION_TITLE_PREFIX + ' ' + en.bug
}

/** 生成占位标题（纯语言参数；lang 缺省 zh，'en' 开头即英文）。 */
export function placeholderTitleFor({ type, lang }) {
  const bug = String(type || '').toLowerCase().indexOf('bug') >= 0
  const en = typeof lang === 'string' && lang.indexOf('en') === 0
  const t = (en ? PLACEHOLDER_TITLES.en : PLACEHOLDER_TITLES.zh)[bug ? 'bug' : 'requirement']
  return SESSION_TITLE_PREFIX + ' ' + t
}

/**
 * 兼容签名 (type, lang?)：Tabs/StatusBar 沿用旧调用形态；lang 缺省按 harness 语言
 * （promptLang 为闭包自由变量，在宿主/Node 独立加载时 typeof 守卫安全降级 zh）。
 */
export function newSessionTitleNew(type, lang) {
  let en = false
  if (lang) {
    try { en = String(lang).toLowerCase().indexOf('en') === 0 } catch (e) {}
  } else {
    try { en = (typeof promptLang === 'function' ? promptLang() === 'en' : false) } catch (e) {}
  }
  return placeholderTitleFor({ type: type, lang: en ? 'en' : 'zh' })
}

// ============ 标题清洗/截断/编号档合成（#205 契约 · 迁移自 router.js）============
export const SESSION_TITLE_MAX_BYTES = 120

// 契约 #205：会话标题 = [#n] + 单空格 + 清洗后标题（120 bytes 预算，前缀永不截断）
export const SESSION_TITLE_RE = /^\[#\d+\] .+/

export const SESSION_TITLE_RE_ALLOW_BARE = /^\[#\d+\](?: .+)?$/

/** 清洗：剥控制/方向/隐形字符，空白归一为单空格并 trim，emoji 保留（沿用 #205 既有规则）。 */
export function cleanTitleText(s) {
  let t = String(s || '')
  t = t.replace(/\x1B\][^\x07]*\x07/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B[^\x5B\x5D\x07]/g, '')
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

export function utf8Bytes(str) {
  if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(str, 'utf8')
  try { return new TextEncoder().encode(str).length } catch (e) { return str.length }
}

/** UTF-8 字节预算截断：prefix + 单空格 + title（超长尾部截 + …），prefix 永不截断。 */
export function truncateTitleUtf8(prefix, title, maxBytes) {
  const sep = ' '
  const base = prefix + sep
  const baseBytes = utf8Bytes(base)
  if (utf8Bytes(title) + baseBytes <= maxBytes) return title
  const ellipsis = '…'
  const ellipsisBytes = utf8Bytes(ellipsis)
  let acc = 0; let out = ''
  for (const ch of title) {
    const b = utf8Bytes(ch)
    if (baseBytes + acc + b + ellipsisBytes > maxBytes) break
    acc += b; out += ch
  }
  return out.trimEnd() + ellipsis
}

/** 编号档（P2）标题合成：[#n] + 清洗/截断后标题（#205 契约）。 */
export function newSessionTitle(t) {
  const n = String(t && t.number != null ? t.number : '').trim()
  if (!/^\d+$/.test(n)) throw new Error('newSessionTitle: invalid number ' + n)
  const prefix = '[' + '#' + n + ']'
  let title = cleanTitleText(t && t.title != null ? t.title : '')
  if (!title) return prefix
  title = truncateTitleUtf8(prefix, title, SESSION_TITLE_MAX_BYTES)
  return prefix + ' ' + title
}

// ============ 草稿档（P1）============
// 档位词按本机语言落地（界面半按语言取词，计划单本身不含语言字面量 —— #264 D2）
export const DRAFT_WORDS = { zh: '草稿', en: 'Draft' }

export const DRAFT_TITLE_RE = /^\[(草稿|Draft)\](?: .+)?$/

export function draftWordFor(lang) {
  return typeof lang === 'string' && lang.indexOf('en') === 0 ? DRAFT_WORDS.en : DRAFT_WORDS.zh
}

/**
 * 草稿标题合成：面包屑语义线索优先（[草稿] <线索>），无线索裸档（[草稿]/[Draft]）；
 * 清洗截断沿用 #205 规则与 UTF-8 120 字节总预算（含前缀，前缀永不截断）。
 */
export function composeDraftTitle({ hint, lang }) {
  const prefix = '[' + draftWordFor(lang) + ']'
  const rawHint = cleanTitleText(hint || '')
  if (!rawHint) return prefix
  return prefix + ' ' + truncateTitleUtf8(prefix, rawHint, SESSION_TITLE_MAX_BYTES)
}

// ============ 值比对锁（#260 决议 · 取代 userRenamed 死代码）============
/**
 * 值比对真检测（#264 D3/F5）：机器每次成功改名都记录所写字符串（lastMachineTitle）；
 * 执行前发现当前标题与记录不符即判手改并永久锁定。
 *
 * @returns 'unlocked' | 'locked' | 'unknown'
 *  - lastMachineTitle 非空：当前标题 === 机器最后写入值 → unlocked，否则 locked；
 *  - 机器从未写过（last 为空）：与注册基准（占位）比对，相同 → unlocked，不同 → locked；
 *  - 当前标题不可读（null/空串）→ unknown（调用方跳过本轮，不盲写）。
 */
export function evaluateRenameLock({ currentTitle, lastMachineTitle, baselineTitle }) {
  const cur = currentTitle == null ? null : String(currentTitle)
  if (cur === null || cur === '') return 'unknown'
  const last = lastMachineTitle == null ? null : String(lastMachineTitle)
  const base = baselineTitle == null ? null : String(baselineTitle)
  if (last !== null) return cur === last ? 'unlocked' : 'locked'
  if (base !== null) return cur === base ? 'unlocked' : 'locked'
  // 无基准（防御异常态）：无信息可判，放行由调用方决定
  return 'unlocked'
}

// ============ 跟踪态结构 + 分档状态机 ============
// #264：结构 { sessionId, stage, lastMachineTitle, locked, repoKey, createdAt, updatedAt }
// 本实现追加 baselineTitle（注册基准占位，值比对锁在「机器首次写入前」仍需基准）与 hint
// （语义线索，取自面包屑节点标题；计划单只携带会话标识与目标语义段/编号信息）。
export const NAMING_STAGES = {
  PLACEHOLDER: 'placeholder',
  DRAFT: 'draft',
  NUMBERED: 'numbered',
  REFINED: 'refined',
}

// 线索宽限：注册后等待面包屑线索的窗口；到时无线索 → 裸档 P1 升级（每会话 P1 至多一次）
export const NAMING_HINT_GRACE_MS = 20000

export function createTrackingState({ sessionId, baselineTitle, repoKey }) {
  const now = Date.now()
  return {
    sessionId: String(sessionId || ''),
    stage: NAMING_STAGES.PLACEHOLDER,
    lastMachineTitle: null,
    baselineTitle: String(baselineTitle || ''),
    locked: false,
    hint: null,
    repoKey: repoKey || null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 分档状态机（纯 reducer）：所有信号（注册/认领推送线索/机器改名单回报/手改锁定/编号预留）
 * 都汇入同一入口 —— #264 US14「所有信号汇入同一个分档状态机」。
 */
export function reduceTrackingState(state, event) {
  if (!state) return state
  const ev = event || {}
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
      next.lastMachineTitle = String(ev.title)
      next.updatedAt = Date.now()
    }
  } else if (ev.type === 'locked') {
    next.locked = true
    next.updatedAt = Date.now()
  } else if (ev.type === 'numbered') {
    // 预留 #266：编号信号（建号感知恢复后消费；本期仅保留跃迁路径）
    next.stage = NAMING_STAGES.NUMBERED
    if (ev.number != null) next.number = Number(ev.number)
    next.updatedAt = Date.now()
  }
  return next
}

/**
 * 待办改名计划单（纯函数产出）：locked / 非占位档 → 无单；
 * 有线索 → 携线索；无线索但过线索宽限 → 裸档；未过宽限 → 等待。
 * 订单只携带会话标识与目标语义段信息，不含语言相关字面量（#264 D2）。
 */
export function planOrderFor(state, now, hintGraceMs) {
  if (!state) return null
  if (state.locked) return null
  if (state.stage !== NAMING_STAGES.PLACEHOLDER) return null
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
