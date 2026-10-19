// src/shared/naming-attribution.ts —— S2（#452）从 naming-guardian.js 拆出之编号归属四个函数，纯结构、行为零变化。
// 以后谁改它：改建号感知、编号归属、语义相关性判定的人。预估约150行，超 350 打回。
// 接线：不引用标题与跟踪文件（墙要求）；语义相关性判定要用的清洗小函数与等待状态判定要用的档位常量在文件内各放一份
//   （attribution 前缀），分别与 naming-titles.js、naming-tracking.js 同源，改动时一起改；拼接标记见 scripts/build.mts 与 src/client/index.ts。

/**
 * src/shared/naming-attribution.ts — 命名守护编号归属半（#266 建号感知 · 从 naming-guardian.js 拆出，S2 #452）。
 *
 * 契约：本文件是编号归属的真源 —— 当前索引相对上一快照的新增编号、等待编号状态判定、语义相关性判定、
 * 编号归属（纯函数，每仓库一次调用）。宿主半调用；界面半无编号来源，仅消费编号订单。标题合成见 naming-titles.js，
 * 跟踪推进见 naming-tracking.js；三文件之间不互相引用（墙要求）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #264 规约 + #260 五决议 + ADR 20260827 为基线；与更早方案冲突以
 *           本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 本模块为纯函数：无输入输出，可被 Node 校验测试直接引用复跑（与另两文件合并）。
 */

// ---- 与 naming-titles.js 同源（墙要求不互相引用；改动时两处同改）----
// 语义相关性判定要用的标题清洗小函数，改名前缀 attribution，避免三文件拼回同一个界面闭包时与标题文件重名。
// 逻辑与 naming-titles.js 内 cleanTitleText 逐行一致。
function attributionCleanTitleText(s: unknown): string {
  let t = String(s || '')
  t = t.replace(/\x1B\][^\x07]*\x07/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B[^\x5B\x5D\x07]/g, '')
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

// ---- 与 naming-tracking.js 同源（墙要求不互相引用；改动时两处同改）----
// 等待编号状态判定要用的档位常量。值与 naming-tracking.js 内 NAMING_STAGES 逐项一致。
const ATTRIBUTION_NAMING_STAGES = { PLACEHOLDER: 'placeholder', DRAFT: 'draft', NUMBERED: 'numbered', REFINED: 'refined' }

// ============ 编号归属（#266 · 建号感知 · issue 索引差值纯函数）============
// 底座（#264 F1/F2 修复义务）：宿主周期性快照仓库 issue 列表，新出现的编号归属给同仓库
// 最早仍处占位/草稿档的受踪会话（多候选歧义取最早；无可归者不入计划单）。判定的唯一
// 真源 = 本模块（host 半调用；client 半无编号来源，仅消费 numbered 订单）。

// prev 为空视为基线：第一次快照只记账不归属，否则历史编号会一次性全部分出去。
/** 当前索引相对上一快照新增的编号（升序；prev 为空视为基线，无新增）。 */
export function newNumbersSince(prevIndex: Record<string, unknown> | null | undefined, currIndex: Record<string, unknown> | null | undefined): number[] {
  const out: number[] = []
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
export function isNumberAwaitStage(state: { locked?: unknown; number?: unknown; stage?: unknown } | null | undefined): boolean {
  return !!(state && !state.locked && state.number == null &&
    (state.stage === ATTRIBUTION_NAMING_STAGES.PLACEHOLDER || state.stage === ATTRIBUTION_NAMING_STAGES.DRAFT))
}

export type AttributeNewNumbersInput = {
  prevIndex: Record<string, unknown> | null | undefined;
  currIndex: Record<string, unknown> | null | undefined;
  sessions: Array<{ sessionId?: unknown; hint?: unknown; createdAt?: unknown; updatedAt?: unknown; locked?: unknown; number?: unknown; stage?: unknown }> | null | undefined;
}
export type AttributedNumber = { sessionId: string; number: number; title: string }
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
// 相关性宁严勿宽：错配一次（会话名张冠李戴）比漏配一次代价大，所以短串只认精确相等。
export function isHintRelatedToTitle(hint: unknown, title: unknown): boolean {
  const hRaw = attributionCleanTitleText(hint || '');
  const tRaw = attributionCleanTitleText(title || '');
  if (!hRaw || !tRaw) return false;
  const stripPrefix = function(s: string): string { return String(s).replace(/^[^:：]{1,12}[:：]\s*/, '').trim(); };
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

// 两种编号两种配法：有标题的按语义配（对不上宁可空着），没标题的按先来后到，互不抢道。
export function attributeNewNumbers({ prevIndex, currIndex, sessions }: AttributeNewNumbersInput): AttributedNumber[] {
  const nums = newNumbersSince(prevIndex, currIndex)
  if (!nums.length) return []
  // 先找出所有“查旧票”的会话：hint 与已有工单标题相关且该工单不是本次新号
  const existingTitles: string[] = []
  try {
    const allIdx = currIndex || {}
    for (const k of Object.keys(allIdx)) {
      if (nums.includes(Number(k))) continue
      const v = allIdx[k] as { title?: unknown } | string | null | undefined
      const t = v && typeof v === 'object' ? String(v.title || '') : String(v || '')
      if (t) existingTitles.push(t)
    }
    if (prevIndex) {
      for (const k of Object.keys(prevIndex)) {
        if (nums.includes(Number(k))) continue
        const v = prevIndex[k] as { title?: unknown } | string | null | undefined
        const t = v && typeof v === 'object' ? String(v.title || '') : String(v || '')
        if (t && !existingTitles.includes(t)) existingTitles.push(t)
      }
    }
  } catch (e) {}
  const isInvestigating = function (hint: unknown): boolean {
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
  const out: AttributedNumber[] = []
  const used = new Set<string>()
  for (let i = 0; i < nums.length; i++) {
    const num = nums[i]
    const info = (currIndex && (currIndex[String(num)] as { title?: unknown; state?: unknown } | null)) || null
    const title = info ? String(info.title || (info as { state?: unknown }).state || '') : ''
    const hasTitle = !!(info && typeof info === 'object' && (info as { title?: unknown }).title)
    let picked: (typeof candidates)[number] | null = null
    if (hasTitle) {
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j]
        if (used.has(c.sessionId as string)) continue
        const hint = c.hint
        if (!hint) continue
        try { if (isHintRelatedToTitle(hint, title)) { picked = c; break; } } catch (e) {}
      }
      if (!picked) continue
    } else {
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j]
        if (!used.has(c.sessionId as string)) { picked = c; break; }
      }
      if (!picked) break
    }
    used.add(picked.sessionId as string)
    out.push({ sessionId: picked.sessionId as string, number: num, title: title })
  }
  return out
}
