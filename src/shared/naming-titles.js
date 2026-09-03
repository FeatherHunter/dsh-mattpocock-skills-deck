// src/shared/naming-titles.js —— S2（#452）从 naming-guardian.js 拆出之占位识别、标题清洗截断、草稿档与编号档合成，纯结构、行为零变化。
// 以后谁改它：改占位四式、标题清洗截断规则、草稿档或编号档合成的人。预估约175行，超 350 打回。
// 接线：纯函数，无输入输出、无内核依赖（promptLang 为可选闭包自由变量，typeof 守卫）；不引用跟踪与归属文件（墙要求）；
//   宿主半运行时引用本文件（与另两文件合并），界面半由 scripts/build.mjs 以 SHARED_SPLICE 拼回闭包。

/**
 * src/shared/naming-titles.js — 命名守护标题合成半（#265/#205 · 从 naming-guardian.js 拆出，S2 #452）。
 *
 * 契约（#264 规约 · 单缝原则）：本文件是标题合成的真源 —— 占位识别、标题合成（草稿档 + 编号档，
 * 清洗截断沿用 #205 既有规则与 UTF-8 120 字节预算）。分档状态机、跟踪态、计划单见 naming-tracking.js，
 * 编号归属见 naming-attribution.js；三文件之间不互相引用（墙要求）。
 * 宿主半运行时引用本文件（与另两文件合并）；界面半由 scripts/build.mjs 以 SHARED_SPLICE 方式将
 * 三文件声明体拼回 src/client/index.js 闭包（一源两物，与 kernel/leaf 拼接同模式），
 * 两半均不另写第二处命名实现。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #264 规约 + #260 五决议 + ADR 20260827 为基线；与更早方案冲突以
 *           本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 本模块为纯函数：无输入输出、无内核依赖（promptLang 为可选闭包自由变量，typeof 守卫），
 * 可被 Node 校验测试直接引用复跑。
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
