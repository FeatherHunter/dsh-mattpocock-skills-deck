/**
 * src/tracker/rooms/gitea/model/normalize.ts — tea/Gitea 原始形状 → 契约形状（#3 契约完整化）。
 *
 * 写法逐格仿 GitLab 房的 `normalize.ts`，两份对照着读：
 *   - key 取 tea 回包的 `index`（Gitea 票号），缺了回退 `number` / `id`；永不产出 `number` 字段；
 *   - state 只归一成 open | closed（tea 用 open/closed 两态，与契约同构）；
 *   - labels 恒产出（能力字段 EMPTY 口径），每项 `{name, color}`，color 缺了写 `''`；
 *   - assignees / comments / blockedBy / reason 恒产出（字段在、值可为空）：Gitea 远端没有
 *     原生阻塞字段，blockedBy 的真相是票面正文的成对标记（机器表优先、可见 `Blocked by:` 行兜底）；
 *   - parentKey 的唯一真相是票面文件头的隐藏标记 `<!-- DSH-PARENT: <地图号> -->`，
 *     旧 `Part of #<地图号>` 可见行只在过渡期回退认（与 GitLab 房、本地房同一套标记）；
 *   - milestone / author 有→对象，无→省略（MISSING）；customFields 一律省略（Gitea 无此概念）；
 *   - 评论总数：Gitea 票面自带 `comments` 数字段（列表页评论一律不取，条数是 0），
 *     拿到非负整数才写，拿不到保持省略——不许拿 comments.length 冒充总数。
 */

import { STATE, ISSUE_TYPE } from '../../../contract/vocabulary.js'
import { markerKindInHeader } from '../../../../shared/issue-file/src/marker.js'
import type { Actor, IssueType, State } from '../../../contract/identity.js'
import type { Comment, Issue, IssueRef, Label, Milestone } from '../../../contract/entities.js'
// 票面正文标记的全部规则住在同目录的 description-markers.ts：本文件只消费，不再定义第二份认法。
// 标记写法与 GitLab 房、本地 Markdown 房是同一套（同一批票会在后端之间搬），两边读出同一个答案是红线。
import {
  parseHiddenBlockedBy,
  parseHiddenParent,
  parseLegacyPartOf,
  parseVisibleBlockedBy,
} from './description-markers.js'

// tea 回包是外部形状，先收成键值袋再逐格判是因为远端字段可缺可空，直接按定型读会把缺字段当成错。
type RawBag = Record<string, unknown>

function asBag(raw: unknown): RawBag | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as RawBag
}

function normalizeLabel(rawLabel: unknown): Label | null {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  const bag = asBag(rawLabel)
  if (!bag) return null
  const name = typeof bag['name'] === 'string' ? (bag['name'] as string).trim() : ''
  if (!name) return null
  const color = typeof bag['color'] === 'string' ? (bag['color'] as string) : ''
  return { name, color }
}

function normalizeLabels(raw: unknown): Label[] {
  const bag = asBag(raw)
  const nodes = bag && Array.isArray(bag['labels']) ? bag['labels'] : Array.isArray(raw) ? raw : []
  const out: Label[] = []
  for (const n of nodes as unknown[]) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function normalizeActor(rawActor: unknown): Actor | null {
  const bag = asBag(rawActor)
  if (!bag) return null
  const loginRaw = typeof bag['login'] === 'string' && bag['login'] !== '' ? bag['login'] : typeof bag['username'] === 'string' ? bag['username'] : ''
  const login = loginRaw.trim()
  if (!login) return null
  const out: Actor = { login }
  if (typeof bag['full_name'] === 'string' && (bag['full_name'] as string).trim() !== '') out.name = (bag['full_name'] as string).trim()
  else if (typeof bag['name'] === 'string' && (bag['name'] as string).trim() !== '') out.name = (bag['name'] as string).trim()
  return out
}

function normalizeAssignees(raw: unknown): Actor[] {
  const bag = asBag(raw)
  const arr = bag && Array.isArray(bag['assignees']) ? bag['assignees'] : []
  const out: Actor[] = []
  for (const a of arr as unknown[]) {
    const actor = normalizeActor(a)
    if (actor) out.push(actor)
  }
  return out
}

function deriveKey(raw: unknown): string {
  if (raw == null) return '0'
  const bag = asBag(raw)
  if (!bag) return '0'
  if (typeof bag['key'] === 'string' && (bag['key'] as string) !== '') return bag['key'] as string
  // Gitea 的票号叫 index（tea CLI 用它；REST 兼容层也叫 index），缺了回退 number / id。
  if (bag['index'] != null) return String(bag['index'])
  if (bag['number'] != null) return String(bag['number'])
  if (bag['id'] != null) return String(bag['id'])
  return '0'
}

/**
 * 票面正文：tea 的 REST 回包把正文放在 body，房内少数聚合形状用 description 这个名字。
 * 两处读同一格，取值规则收在这里一份，免得识别与父子关系读到不一样的正文。
 */
function bodyOf(raw: unknown): string {
  const bag = asBag(raw)
  if (!bag) return ''
  if (typeof bag['body'] === 'string') return bag['body'] as string
  if (typeof bag['description'] === 'string') return bag['description'] as string
  return ''
}

function deriveState(raw: unknown): State {
  const bag = asBag(raw)
  const s = bag && bag['state'] != null ? String(bag['state']).toLowerCase() : 'open'
  if (s === 'closed' || s === 'close') return STATE.CLOSED as State
  return STATE.OPEN as State
}

function deriveType(raw: unknown): IssueType {
  // 判定顺序与 GitLab 房、GitHub 房同一份红线：正文文件头标记最前（标记 → 标签 → 形状，
  // 依据是 GLOSSARY.md「对象类型」词条）。共享包 markerKindInHeader 只看第一个标题之前那一段，
  // 首行幂等锚不影响第二行的规格标记。
  if (markerKindInHeader(bodyOf(raw)) === 'spec') return ISSUE_TYPE.SPEC as IssueType
  if (normalizeLabels(raw).some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP as IssueType
  const bag = asBag(raw)
  if (bag && (bag['isMap'] === true || bag['type'] === 'map')) return ISSUE_TYPE.MAP as IssueType
  return ISSUE_TYPE.ISSUE as IssueType
}

function normalizeMilestone(rawMile: unknown): Milestone | undefined {
  const bag = asBag(rawMile)
  if (!bag) return undefined
  const title = typeof bag['title'] === 'string' ? (bag['title'] as string).trim() : ''
  if (!title) return undefined
  const out: Milestone = { name: title }
  if (typeof bag['description'] === 'string' && (bag['description'] as string).trim() !== '') {
    out.description = bag['description'] as string
  }
  const stateRaw = bag['state'] ? String(bag['state']).toLowerCase() : ''
  if (stateRaw === 'closed' || stateRaw === 'close') out.state = 'closed'
  else if (stateRaw === 'active' || stateRaw === 'open' || stateRaw === 'opened') out.state = 'open'
  // Gitea 里程碑的截止时间字段叫 due_on（REST），聚合形状兼容 due_date / dueOn 两个写法；
  // 有键无值时显式写 null（「确实没有」），完全没这个键才省略。
  const due = bag['due_on'] ?? bag['due_date'] ?? bag['dueOn'] ?? null
  if (due != null) out.dueOn = String(due)
  else if ('due_on' in bag || 'due_date' in bag) out.dueOn = null
  return out
}

function normalizeComments(raw: unknown): Comment[] {
  const bag = asBag(raw)
  const src: unknown = (bag && (bag['notes'] || bag['comments'])) || []
  // 注意：Gitea 票面自带的 comments 是**条数**（数字），只有数组才是聚合形状里的评论本体；
  // 数字走下面的 commentCount 分流，这里遇到非数组一律当「没取评论」。
  if (!Array.isArray(src)) return []
  const out: Comment[] = []
  for (const n of src as unknown[]) {
    const nb = asBag(n)
    if (!nb) continue
    const body =
      typeof nb['body'] === 'string'
        ? (nb['body'] as string)
        : typeof nb['note'] === 'string'
          ? (nb['note'] as string)
          : ''
    const author = normalizeActor(nb['author']) || { login: '' }
    out.push({
      id: nb['id'] != null ? String(nb['id']) : undefined,
      author,
      authorAssociation: typeof nb['authorAssociation'] === 'string' ? (nb['authorAssociation'] as string) : '',
      body,
      createdAt:
        typeof nb['created_at'] === 'string'
          ? (nb['created_at'] as string)
          : typeof nb['createdAt'] === 'string'
            ? (nb['createdAt'] as string)
            : '',
      updatedAt:
        typeof nb['updated_at'] === 'string'
          ? (nb['updated_at'] as string)
          : typeof nb['updatedAt'] === 'string'
            ? (nb['updatedAt'] as string)
            : '',
    })
  }
  return out
}

// 可见 `Blocked by:` 行的解析住在 model/description-markers.ts：本文件只负责
// 把原始引用补成契约形状（state 恒 open、type 恒 issue），不留自己的正则。
function blockedKeysToRefs(keys: string[]): IssueRef[] {
  const out: IssueRef[] = []
  for (const k of keys) {
    out.push({ key: String(k), title: '#' + String(k), state: STATE.OPEN as State, type: ISSUE_TYPE.ISSUE as IssueType })
  }
  return out
}

function deriveBlockedBy(raw: unknown): IssueRef[] {
  const bag = asBag(raw)
  // 聚合形状兼容层：个别形状会把阻塞条目直接放进 blocked_by / blockedBy / blockedByIssues 数组
  // （Gitea 远端票面没有这三个字段，真源永远是正文标记；这一层只服务聚合与测试形状）。
  let native: unknown = null
  if (bag && Array.isArray(bag['blocked_by'])) native = bag['blocked_by']
  else if (bag && Array.isArray(bag['blockedBy'])) native = bag['blockedBy']
  else if (bag && Array.isArray(bag['blockedByIssues'])) native = bag['blockedByIssues']
  if (Array.isArray(native) && (native as unknown[]).length > 0) {
    const out: IssueRef[] = []
    const seen = new Set<string>()
    for (const b of native as unknown[]) {
      const bb = asBag(b)
      const k =
        bb && bb['index'] != null
          ? String(bb['index'])
          : bb && bb['key'] != null
            ? String(bb['key'])
            : ''
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push({
        key: k,
        title: bb && typeof bb['title'] === 'string' ? (bb['title'] as string) : k,
        state: bb && bb['state'] === 'closed' ? (STATE.CLOSED as State) : (STATE.OPEN as State),
        type: ISSUE_TYPE.ISSUE as IssueType,
      })
    }
    return out
  }
  if (Array.isArray(native) && (native as unknown[]).length === 0) {
    // 聚合形状显式给了空数组：以它为准，忽略正文回退（避免双写漂移时两边各说各话）。
    if (bag && ('blocked_by' in bag || 'blockedBy' in bag)) return []
  }
  // 回退：先认文件头机器表，没有再认可见行（读侧隐藏优先；写侧成对维护，正常票面两者一致）。
  const body = bodyOf(raw)
  const hiddenTable = parseHiddenBlockedBy(body)
  if (hiddenTable !== null) return blockedKeysToRefs(hiddenTable)
  // 可见行回退保留原文片段（IssueRef.title 逐字照抄人写的那一段，可能是 #12、owner/repo#12 或网页地址）；
  // state 恒 open、type 恒 issue 是这一层补的契约形状，标记模块只回原始引用。
  const parsed = parseVisibleBlockedBy(body)
  if (parsed !== null) {
    return parsed.map((r) => ({
      key: String(r.key),
      title: r.title,
      state: STATE.OPEN as State,
      type: ISSUE_TYPE.ISSUE as IssueType,
    }))
  }
  return []
}

function deriveParentKey(raw: unknown): string | null {
  const bag = asBag(raw)
  const body = bodyOf(raw)
  // 隐藏标记优先；旧 `Part of` 行只在过渡期回退认（存量票还没被写过一次）；最后是聚合形状自带的格。
  const hidden = parseHiddenParent(body)
  if (hidden) return hidden
  const legacy = parseLegacyPartOf(body)
  if (legacy) return legacy
  if (bag && typeof bag['parentKey'] === 'string') return bag['parentKey'] as string
  if (bag && bag['parentKey'] === null) return null
  return null
}

/**
 * tea/Gitea 原始票面归一成契约 Issue：单 key 取 index、状态压成两态、缺的能力字段按 EMPTY/MISSING 分流。
 *
 * @param raw tea 回包的 issue 原始对象
 */
export function normalizeIssue(raw: unknown): Issue {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  const state = deriveState(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const comments = normalizeComments(raw)
  const blockedBy = deriveBlockedBy(raw)
  const parentKey = deriveParentKey(raw)
  const bag = asBag(raw)

  const title = bag && typeof bag['title'] === 'string' ? (bag['title'] as string) : ''
  const body = bodyOf(raw)
  // tea 的字段名是 `url`（GitHub API 才叫 html_url）：真机实测（tea 0.16，单票 get 与
  // `issues ls --fields …,url` 两条路）回的都是 `url`，值就是网页地址。两个名字都认，
  // html_url 优先——万一某个 tea 版本按 Gitea API 原生形状透传，html_url 才是网页地址
  // （原生 API 的 `url` 是 API 端点，不是给人点的页面）。
  const url =
    bag && typeof bag['html_url'] === 'string'
      ? (bag['html_url'] as string)
      : bag && typeof bag['url'] === 'string' && /^https?:\/\//i.test(bag['url'] as string)
        ? (bag['url'] as string)
        : ''
  const createdAt =
    bag && typeof bag['created_at'] === 'string'
      ? (bag['created_at'] as string)
      : bag && typeof bag['createdAt'] === 'string'
        ? (bag['createdAt'] as string)
        : ''
  const updatedAt =
    bag && typeof bag['updated_at'] === 'string'
      ? (bag['updated_at'] as string)
      : bag && typeof bag['updatedAt'] === 'string'
        ? (bag['updatedAt'] as string)
        : ''
  const closedAtRaw = bag ? (bag['closed_at'] != null ? bag['closed_at'] : bag['closedAt']) : undefined
  const closedAt = typeof closedAtRaw === 'string' ? closedAtRaw : null

  const issue: Issue = {
    key,
    // effortId：Gitea 一个仓库只有一个隐含 effort，核心字段填 ''（EMPTY，不是 MISSING）
    effortId: '',
    type,
    title,
    state,
    body,
    url,
    createdAt,
    updatedAt,
    closedAt,
    parentKey,
    labels,
    assignees,
    comments,
    blockedBy,
    reason: bag && typeof bag['reason'] === 'string' ? (bag['reason'] as string) : '',
  }

  // 评论总数：Gitea 票面自带 comments 数字段，比拿当前取到的评论条数估算可靠（列表页评论一律不取，
  // 条数是 0）。这是详情页说「评论 (2) · 共 20 条」的依据；只有拿到非负整数才写，拿不到就保持省略
  // ——调用方据此知道「总数未知」，不许拿 comments.length 冒充。数字之外的形状（数组、字符串以外的）不认。
  const totalRaw = bag ? (typeof bag['comments'] === 'number' ? bag['comments'] : bag['commentCount']) : undefined
  const totalNum = typeof totalRaw === 'number' ? totalRaw : typeof totalRaw === 'string' && totalRaw.trim() !== '' ? Number(totalRaw) : NaN
  if (isFinite(totalNum) && totalNum >= 0) issue.commentCount = Math.floor(totalNum)

  // milestone 独立能力字段：有→对象，无→省略(MISSING)
  const mileRaw = bag ? bag['milestone'] : undefined
  if (mileRaw && typeof mileRaw === 'object' && mileRaw !== null) {
    const m = normalizeMilestone(mileRaw)
    if (m) issue.milestone = m
  }

  // author 能力字段：有→对象，无→省略(MISSING)
  if (bag && bag['author'] && typeof bag['author'] === 'object') {
    const a = normalizeActor(bag['author'])
    if (a) issue.author = a
  }

  // customFields 恒省略（MISSING）：Gitea 无此概念
  return issue
}

export default normalizeIssue
