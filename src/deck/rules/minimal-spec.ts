// src/deck/rules/minimal-spec.ts —— 强制最小规范：必备标签、进度区、整份判据（纯规则侧）
//
// 本文件由 src/deck/shell/minimal-spec.ts 拆出（#1039 按 #1038 定版：纯侧收最低标准全份）。
// 前半段（必备标签、进度区、整份判据）行为与拆分前逐字相同；幂等锚那一半搬去了同目录的
// anchor.ts（时钟改传参），本件不再有任何读钟的地方。
//
// 这个文件回答两个问题，都只有一处答案：
//   一、工具写票时「最少要保证什么」：必备标签、进度区（地图是五个区块）。
//       AI 记不住这些，由代码保证，并且把「我替你加了什么」原话写回返回值里。
//   二、写回来的正文是「整份票文件」还是「一小段片段」：两条写路径（建票与改正文）
//       必须用同一条判据认出它，否则读回原样写回会写坏。
//
// 纯在哪：只做字符串与数组的计算，不取会话、不起进程、不读写文件、不读钟；进来的值
// 一律当「形状不可信」先收口（收口函数与类型都在本文件里，不引别的目录）。
// 例外是 src/shared/ 下的纯计算包：规格 / 实施票的判定与共享标记包共用一份，不在两侧各写一遍（#1277）。
import { labelsToEnsure, ruleFor, type PositionKind } from './object-kind.js'

/** 票的种类（deck_issue_create 的 kind 参数与各工具的写路径共用这一套词）。
 *
 *  #1403 起六个位置值：地图 / 地图工单 / 规格 / 实施票 / 缺陷 / 普通票。取值与「这个位置在三种后端
 *  各是什么」的唯一答案在 object-kind.ts；这里只沿用旧名字 DeckKind，免得调用方跟着改名。
 *  旧值 task / ticket 不再被认：调用点已全部改用新值（#1403 不保留兼容期）。 */
export type DeckKind = PositionKind

/** 拿不准是不是字符串时统一收口成字符串：不是字符串就当空串（调用方各自判空）。 */
function str(v: unknown): string {
  return (typeof v === 'string') ? v : ''
}

/** 地图那张票必带的五个区块（与共享层 parser.js 的 parseMapBody 认的五个标题逐字一致）。 */
export const MAP_BLOCK_TITLES: readonly string[] = Object.freeze([
  'Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope',
])

/**
 * 把各种形态的标签清单（字符串、`{name}` 对象、两种混着来）归一成去空后的名字数组。
 * 与 anchor.ts 里的同名函数各有一份：两处的用途不同（这里要按顺序比对，
 * 那里要拼进哈希），合起来要跨文件传值，反而多一层耦合。
 */
function labelNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map((l) => (typeof l === 'string' ? l : (l && (l as { name?: unknown }).name) || ''))
    .map((s) => String(s).trim())
    .filter(Boolean)
}

/**
 * 补必备标签：返回补完的清单与「我替你补了哪些」（原话写进返回值，让人看得见）。
 *
 * 该补哪几枚完全由 object-kind.ts 的位置表回答（地图工单是 label 那一枚，规格与实施票是
 * ready-for-agent，缺陷是 bug + needs-triage，普通票一枚都不补）。#1403 起不再有「认不出的种类
 * 就按 task 补 wayfinder:task」这条兜底：那张位置表里没有的名字，标签一枚都不猜，交给调用方拒绝。
 */
export function ensureLabels(labels: unknown, kind: string, label?: unknown): { labels: string[]; added: string[] } {
  const have = labelNames(labels)
  const want = labelsToEnsure(kind, label)
  const added: string[] = []
  for (const name of want) {
    // 大小写不敏感地比：GitHub 的标签名不分大小写，`Wayfinder:Map` 算已经有了。
    if (have.map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) < 0) {
      have.push(name)
      added.push(name)
    }
  }
  return { labels: have, added: added }
}

/** 把一段文本里的正则元字符转义掉：区块标题要按原文匹配，标题里出现 `.` 之类的符号时不许当成通配。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 地图正文缺哪几个区块（按 `## 标题` 这一行的原文判，大小写敏感，与共享层的解析口径一致）。 */
function missingMapBlocks(text: string): string[] {
  return MAP_BLOCK_TITLES.filter((t) => !new RegExp('^##\\s*' + escapeRegExp(t) + '\\s*$', 'm').test(text))
}

/**
 * 正文里有没有认得出的进度标题。
 * 口径：`## 进度` 与 `## 进度：80%`、`## Progress: 40%` 都算有 —— 不这么宽的话，
 * 已经带了百分比的票会被再插一段重复的进度区（#908 的实测）。
 * `[\uFF1A:]` 是一个字符类里的两个字符：全角冒号与半角冒号，两种写法都算。
 * 写成转义是为了让后来人一眼看出这里**同时**认两种冒号，不必去猜那一格的宽度。
 */
function hasProgressHeading(text: string): boolean {
  return /^##\s*(?:进度|Progress)(?:\s*[\uFF1A:]\s*\d{1,3}\s*%?)?\s*$/m.test(text)
}

/**
 * 补正文：地图先补五个区块，然后所有位置值都补一个进度区；进度区永远放在最后。
 *
 * #1403 起规格与实施票也补「## 进度」：位置表说所有 kind 建票统一补，地图五节在前、进度在五节之后。
 * （#1277 当时不补，理由是规格与实施票的正文由技能模板写；现在统一到一条口径，模板里已有进度标题的
 * 不会重复补 —— 判据仍是同一行标题，不是「有没有非空正文」。）
 * 判据是「正文里有没有认得出的那一行」，所以空正文照样要补。
 */
export function ensureBody(body: unknown, kind: string): { body: string; added: string[] } {
  const text = typeof body === 'string' ? body : ''
  const added: string[] = []
  let out = text
  const rule = ruleFor(kind)
  if (rule && rule.mapBlocks) {
    const missing = missingMapBlocks(text)
    if (missing.length) {
      // #1507：不再给空地图正文塞那句「这张地图的正文由 deck_map_plan_create 建骨架时补上」。
      // 维护者拍板这句没有实际价值：它没登记进原文模板，写在正文最前面，读原始正文的人会把它
      // 当成地图内容；空正文直接以补出来的第一个区块标题开头就够了，下面循环会把缺的段补齐。
      out = out.replace(/\s*$/, '') + '\n' + missing.map((t) => '\n## ' + t + '\n').join('')
      for (const t of missing) added.push('## ' + t)
    }
  }
  // 进度区所有位置值都补（含规格与实施票）；已有同一判据的标题不重复补。
  // 2026-10-22 维护者决定：进度区不再带「做到哪一步了，在这里一行一行记」这行占位注释。
  // 它在页面上看不见，用工具写完进度后还会留在正文里，读原始正文的人会分不清哪句是格式、哪句是原话；
  // 票面只需要「## 进度」这一行标题，写进度的规则看 docs/agents/issue-tracker.md。
  if (!hasProgressHeading(text)) {
    out = (out.replace(/\s*$/, '') + '\n\n## 进度\n').replace(/^\n+/, '')
    added.push('## 进度')
  }
  return { body: out, added: added }
}

/**
 * 整份还是片段：自带一级标题、幂等锚、字段行或骨架标题 = 整份，建票与改正文共用同一条判据（#1002）。
 *
 * 为什么四条都算整份：读回给的是整份票文件文本，写路径必须用同一条判据认出它，否则读回原样写回会写坏。
 * 只认一级标题或锚不够：改正文的实测里出现过无一级标题但带字段行的整份（C5），建票的实测里出现过
 * 只带骨架的正文（C2），它们按片段走都会翻倍或丢东西。片段里正常不会出现这四种写法，误伤的可能很小。
 *
 * 这四条正则与后端 Markdown 房里 parse.js 的写法逐字一致（房规不许后端引用纯规则目录，
 * 所以两份各自手写）；改一处必须改另一处。
 */
export function isWholeIssueBody(body: unknown): boolean {
  const t = str(body)
  if (/^\s*#\s+\S/m.test(t)) return true
  if (/^\s*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/m.test(t)) return true
  if (/^\s*(Status|Type|Blocked\s+by|Labels)\s*[\uFF1A:]/im.test(t)) return true
  if (/^\s*##\s*(Comments|Answer)\s*$/im.test(t)) return true
  return false
}
