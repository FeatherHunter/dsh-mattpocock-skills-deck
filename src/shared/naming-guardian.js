/**
 * src/shared/naming-guardian.js — 命名守护核心纯函数（#265/#266 · 分级命名守护一期）
 *
 * 契约（#264 规约 · 单缝原则）：本模块是命名判定的唯一真源 —— 占位识别、分档状态机、
 * 标题合成（草稿档 + 编号档，清洗截断沿用 #205 既有规则与 UTF-8 120 字节预算）、
 * 值比对锁判定、跟踪态结构、计划单产出与编号归属（#266 建号感知：issue 索引差值纯函数）。
 * host 半运行时 import() 本模块；client 半由 scripts/build.mjs 以 SHARED_SPLICE 方式将
 * 本文件声明体拼回 src/client/index.js 闭包（一源两物，与 kernel/leaf splice 同模式），
 * 两半均不另写第二处命名实现。
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
 * 草稿标题合成：面包屑语义线索优先（[草稿][新增需求/BUG] <线索>），无线索则仅类型标签；
 * 清洗截断沿用 #205 规则与 UTF-8 120 字节总预算（含前缀，前缀永不截断）。
 * baselineTitle 用于区分“新增需求”与“新增BUG”（取自注册占位），为用户要求“[草稿][新增需求]xxx”而加。
 */
export function composeDraftTitle({ hint, lang, baselineTitle }) {
  const prefix = '[' + draftWordFor(lang) + ']'
  let typeTag = ''
  if (baselineTitle) {
    const bt = String(baselineTitle)
    const isBug = /Bug/i.test(bt)
    if (isBug) typeTag = (String(lang).toLowerCase().indexOf('en') === 0 ? '[New Bug]' : '[新增BUG]')
    else typeTag = (String(lang).toLowerCase().indexOf('en') === 0 ? '[New Requirement]' : '[新增需求]')
  }
  const fullPrefix = typeTag ? prefix + typeTag : prefix
  const rawHint = cleanTitleText(hint || '')
  if (!rawHint) return fullPrefix
  return fullPrefix + ' ' + truncateTitleUtf8(fullPrefix, rawHint, SESSION_TITLE_MAX_BYTES)
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
  REFINED: 'refined',   // P3 精修档：一期仅占位（#264 Out of Scope · #260 决议「实现分期」）
}

// ---- P3 精修二期预留说明（接口注释级 · 一期收官清点 #267）----
// 两期边界：本期不含存量回填（#261 裁决否决 · map Out of scope 维持现状）也不含 LLM 精修；
// 精修档 RENAMED/REFINED 目前零消费：reducer 对未知事件类型
// 静默忽略（天然预留），planOrderFor 对 REFINED 档恒不出单。二期精修立票（承接 map
// #257「Not yet specified」）时的接缝约定：① reduceTrackingState 增 'refined' 入账事件
// （携 LLM 语义段，先过值比对锁 + [#n] 前缀不可破坏）；② planOrderFor 为 REFINED 档
// 产出 kind:'refined' 计划单（语言无关载荷）；③ 界面半 executeNamingOrder 按 kind 分派
// 合成。三处皆在本文件与本批注所指签名内扩展，无需新增通道。

// 线索宽限：注册后等待面包屑线索的窗口；到时无线索 → 裸档 P1 升级（每会话 P1 至多一次）
export const NAMING_HINT_GRACE_MS = 20000

export function createTrackingState({ sessionId, baselineTitle, repoKey, cwd }) {
  const now = Date.now()
  return {
    sessionId: String(sessionId || ''),
    stage: NAMING_STAGES.PLACEHOLDER,
    lastMachineTitle: null,
    baselineTitle: String(baselineTitle || ''),
    locked: false,
    hint: null,
    repoKey: repoKey || null,
    // #266 追加：cwd（索引快照执行上下文）、number/numberTitle（获号信息）、
    // numberedDone（编号档 rename 已落定，防重复出单/循环）——均为增量字段，盘上旧账兼容。
    cwd: cwd || null,
    number: null,
    numberTitle: null,
    numberedDone: false,
    // #267 追加：界面执行失败的有限重试入账（failCount=连败次数 / lastFailAt=末次失败时刻 /
    // lastError=末次错误摘要；成功改名与全新编号跃迁均清零重来）——盘上旧账缺失按 0/null 容错。
    failCount: 0,
    lastFailAt: null,
    lastError: null,
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
      // #267：任何成功改名即清账重来（有限重试预算只针对连续失败的同一目标）
      next.failCount = 0; next.lastFailAt = null; next.lastError = null
      // #266：编号档 rename 落定判定 —— 接受标题携带同一 [#n] 前缀即视为编号档完成
      // （防止非编号名（如草稿档）的 renamed 抢占 numberedDone，杜绝重复出单/循环）
      if (next.stage === NAMING_STAGES.NUMBERED && next.number != null) {
        const pfx = '[' + '#' + String(next.number) + ']'
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
    if (!isFinite(evNum) || evNum <= 0) return state
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
  }
  return next
}

// ============ 失败可见性与有限重试（#267 · F4）============
/**
 * 界面半执行改名的失败收敛由本模块统一裁定（#264 F4：「界面执行失败回报后进入有限
 * 重试」+「放弃/失败升级为面板级可见提醒，不再只在目标会话内闪现」）。
 *
 * 语义（reducer 入账事件 'renameFailed' + 下列纯函数）：
 * - 连败计数与末次失败时刻入跟踪态；冷却窗 NAMING_RETRY_COOLDOWN_MS 内不重复出单，
 *   给瞬时故障自愈窗口（DSH 会话列表快照迟到、会话门面短暂拒绝等）；
 * - 同一目标连败达 NAMING_RETRY_MAX 次 → 定败：planOrderFor 永不再为此目标出单，
 *   namingFailureInfo 携失败画像供 host 注入 wf.namingPlan 回包 failures 清单，
 *   由界面半落共享 store 渲染面板级常驻提醒；化解途径 = 值比对锁（手改 → locked，
 *   「手改永不被覆盖」闭环收尾）或值一致收敛（上次实际改名已落定但回报丢失 → renamed
 *   记账），二者皆自动撤下横幅。P3 精修二期预留见 NAMING_STAGES.REFINED 注释。
 */
export const NAMING_RETRY_MAX = 3

export const NAMING_RETRY_COOLDOWN_MS = 45000

/** 定败画像（供面板呈现 + 协商化解判定）；未达预算上限 / 已锁 → null。 */
export function namingFailureInfo(state) {
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

/**
 * 待办改名计划单（纯函数产出）：locked / 非占位档 → 无单；
 * 有线索 → 携线索；无线索但过线索宽限 → 裸档；未过宽限 → 等待。
 * 订单只携带会话标识与目标语义段信息，不含语言相关字面量（#264 D2）。
 */
export function planOrderFor(state, now, hintGraceMs) {
  if (!state) return null
  if (state.locked) return null
  // #267：有限重试门控 —— 连败达预算上限 → 定败不再出单（面板呈现接管）；
  // 冷却窗内不重复出单，瞬时故障等下一窗口自愈。
  if ((state.failCount || 0) >= NAMING_RETRY_MAX) return null
  {
    const tsGate = typeof now === 'number' ? now : Date.now()
    if (state.lastFailAt != null && (tsGate - state.lastFailAt) < NAMING_RETRY_COOLDOWN_MS) return null
  }
  // #266：编号档（P2）—— 获号会话产出 numbered 订单（携编号+issue 标题，语言无关，
  // 合成经 newSessionTitle 在界面半执行，[#n] 前缀契约 #205 永不破坏）；
  // 已落定（numberedDone / 机器最后写入值 == 目标名）→ 收敛不出单（防重复/循环）。
  if (state.stage === NAMING_STAGES.NUMBERED) {
    if (state.number == null || state.numberedDone) return null
    const title = state.numberTitle || ''
    let target = null
    try { target = newSessionTitle({ number: state.number, title: title }) } catch (e) { return null }
    if (state.lastMachineTitle != null && state.lastMachineTitle === target) return null
    return {
      sessionId: state.sessionId,
      kind: 'numbered',
      number: state.number,
      title: title,
      lock: {
        lastMachineTitle: state.lastMachineTitle,
        baselineTitle: state.baselineTitle,
        locked: state.locked,
      },
    }
  }
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

// ============ 编号归属（#266 · 建号感知 · issue 索引差值纯函数）============
// 底座（#264 F1/F2 修复义务）：宿主周期性快照仓库 issue 列表，新出现的编号归属给同仓库
// 最早仍处占位/草稿档的受踪会话（多候选歧义取最早；无可归者不入计划单）。判定的唯一
// 真源 = 本模块（host 半调用；client 半无编号来源，仅消费 numbered 订单）。

/** 当前索引相对上一快照新增的编号（升序；prev 为空视为基线，无新增）。 */
export function newNumbersSince(prevIndex, currIndex) {
  const out = []
  if (!currIndex || typeof currIndex !== 'object') return out
  for (const k of Object.keys(currIndex)) {
    const n = Number(k)
    if (!isFinite(n) || n <= 0) continue
    if (!prevIndex || !Object.prototype.hasOwnProperty.call(prevIndex, k)) out.push(n)
  }
  out.sort(function (a, b) { return a - b })
  return out
}

/** 是否仍处于「等待编号」状态：未锁、尚未获号、仍处占位/草稿档。 */
export function isNumberAwaitStage(state) {
  return !!(state && !state.locked && state.number == null &&
    (state.stage === NAMING_STAGES.PLACEHOLDER || state.stage === NAMING_STAGES.DRAFT))
}

/**
 * 编号归属（纯函数 · 每仓库一次调用）：对新增编号（升序）逐一分配给候选受踪会话
 * （同仓库、最早者优先：createdAt → updatedAt → sessionId 三级排序保证确定性）；
 * 候选耗尽即止——剩余编号不入计划单，留待后续快照（无可归者不入计划单）。
 * @returns [{ sessionId, number, title }]
 */
/**
 * 语义相关性判定（#315 加固 · 高精度优先）
 * 目标：会话重命名必须贴合其真实任务，宁可不改名也不错配。
 * 当 hint 与新 issue 标题完全无关时，不应配号。
 * 规则（宁严勿宽）：
 * - 先经 cleanTitleText 与去前缀（“任务: ”等）清洗，排除通用前缀误判；
 * - 精确相等即相关；
 * - 长度≥4 的包含即相关（避免短词如“修复”2字误判）；
 * - 否则要求共享长度≥4 的连续子串（对中文/英文均有效）；
 * - 短串（<4）仅精确相等才算相关，避免 “111” 误配。
 */
export function isHintRelatedToTitle(hint, title) {
  const hRaw = cleanTitleText(hint || '');
  const tRaw = cleanTitleText(title || '');
  if (!hRaw || !tRaw) return false;
  const stripPrefix = function(s) { return String(s).replace(/^[^:：]{1,12}[:：]\s*/, '').trim(); };
  const hStripped = stripPrefix(hRaw);
  const tStripped = stripPrefix(tRaw);
  const h = hStripped.toLowerCase();
  const t = tStripped.toLowerCase();
  if (!h || !t) return false;
  if (h === t) return true;
  if (h.length >= 4 && t.includes(h)) return true;
  if (t.length >= 4 && h.includes(t)) return true;
  const short = h.length < t.length ? h : t;
  const long = h.length < t.length ? t : h;
  if (short.length >= 4) {
    for (let i = 0; i <= short.length - 4; i++) {
      const sub = short.slice(i, i + 4);
      if (!sub.trim() || /^[\s:：,，。.]+$/.test(sub)) continue;
      if (long.includes(sub)) return true;
    }
  }
  return false;
}

export function attributeNewNumbers({ prevIndex, currIndex, sessions }) {
  const nums = newNumbersSince(prevIndex, currIndex)
  if (!nums.length) return []
  // 先找出所有“查旧票”的会话：hint 与已有工单标题相关且该工单不是本次新号
  const existingTitles = []
  try {
    const allIdx = currIndex || {}
    for (const k of Object.keys(allIdx)) {
      if (nums.includes(Number(k))) continue
      const v = allIdx[k]
      const t = v && typeof v === 'object' ? String(v.title || '') : String(v || '')
      if (t) existingTitles.push(t)
    }
    if (prevIndex) {
      for (const k of Object.keys(prevIndex)) {
        if (nums.includes(Number(k))) continue
        const v = prevIndex[k]
        const t = v && typeof v === 'object' ? String(v.title || '') : String(v || '')
        if (t && !existingTitles.includes(t)) existingTitles.push(t)
      }
    }
  } catch (e) {}
  const isInvestigating = function (hint) {
    if (!hint) return false
    for (let i = 0; i < existingTitles.length; i++) {
      try { if (isHintRelatedToTitle(hint, existingTitles[i])) return true } catch (e) {}
    }
    return false
  }
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .filter(function (s) {
      if (!isNumberAwaitStage(s)) return false
      if (s.hint && isInvestigating(s.hint)) return false
      return true
    })
    .sort(function (a, b) {
      const ca = Number(a.createdAt || 0); const cb = Number(b.createdAt || 0)
      if (ca !== cb) return ca - cb
      const ua = Number(a.updatedAt || 0); const ub = Number(b.updatedAt || 0)
      if (ua !== ub) return ua - ub
      return String(a.sessionId || '').localeCompare(String(b.sessionId || ''))
    })
  const out = []
  const used = new Set()
  for (let i = 0; i < nums.length; i++) {
    const num = nums[i]
    const info = (currIndex && currIndex[String(num)]) || null
    const title = info ? String(info.title || info.state || '') : ''
    const hasTitle = !!(info && typeof info === 'object' && info.title)
    let picked = null
    if (hasTitle) {
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j]
        if (used.has(c.sessionId)) continue
        const hint = c.hint
        if (!hint) continue
        try { if (isHintRelatedToTitle(hint, title)) { picked = c; break; } } catch (e) {}
      }
      if (!picked) continue
    } else {
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j]
        if (!used.has(c.sessionId)) { picked = c; break; }
      }
      if (!picked) break
    }
    used.add(picked.sessionId)
    out.push({ sessionId: picked.sessionId, number: num, title: title })
  }
  return out
}