/**
 * src/tracker/rooms/github/labels.ts — 「票身上带哪些标签」的实现（#133 定版 + #138 落地）。
 *
 * 文件头原写 `backends/github/labels.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * 契约：`setLabels(repo, key, labels: LabelInput[], opts?: SetOpts, ctx: OpContext): Promise<OpResult<Issue>>`
 *  - `LabelInput = string | {name: string, color?: string, description?: string}`
 *  - `SetOpts = { expectedUpdatedAt?: string }` → 不匹配 → `kind:'conflict'`（显式产生，非 regex）
 *  - Last-write-wins 且整集替换（尽力单次/近原子；GitHub 用 diff → gh issue edit --add-label/--remove-label）
 *  - GitHub 原生支持 labels → `Issue.labels` 恒存在，空→ `[]` EMPTY（#126），颜色无则 ''（string 非 number）
 *
 * 2026-09-13（#620）：仓库级的「列全部标签 / 批量改标签颜色」两条契约操作搬进同目录的
 * label-colors-ops.js（它们跟这里的 setLabels 不是一件事：这里是给一张票贴标签，那两条是改仓库的标签本身）。
 * 本文件只保留了它们要用的仓库名拆解（parseRepo / repoId），不再自己列标签。
 */

import { fail, rawText } from '../../preflight.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, Label, RepositoryRef } from '../../contract/entities.js';
import type { LabelInput, SetOpts } from '../../contract/inputs.js';
import type { OpResult, TrackerError } from '../../contract/results.js';
// #104 `issue.write`：票写入的常驻结论线（轨迹形状与发射口在 ./write-log.js）。
import { newIssueWriteTrail, emitIssueWrite } from './write-log.js'
import type { IssueWriteTrail } from './write-log.js';
import { normalizeIssue } from './normalize.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { readRepoPermissions, readonlyMessage } from './repo-permissions.js'
import { getIssue } from './issues.js'
import type { MemoContext } from './roster.js';

/** 仓库坐标：拥有者与仓库名，refId 形不对就回 null 而不是抛。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

function normalizeLabelInput(li: unknown): Label | null {
  if (typeof li === 'string') {
    const name = li.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!li || typeof li !== 'object') return null
  // 为什么转成袋再读：输入可能是任意形状，直接读 name 会报缺成员；对象检查通过后袋与原值是同一份引用，读法与原来一致。
  const bag = li as { name?: unknown; color?: unknown; description?: unknown };
  const name = typeof bag.name === 'string' ? bag.name.trim() : ''
  if (!name) return null
  const color = typeof bag.color === 'string' ? bag.color : ''
  // 为什么先定死契约再补可选键：字面量起手类型里没有 description，后面再补会报缺成员；先标成标签形状，可选键自然有位置。
  const out: Label = { name, color }
  if (typeof bag.description === 'string' && bag.description.trim() !== '') out.description = bag.description
  return out
}

function normalizeLabelInputs(labels: unknown): Label[] {
  if (!Array.isArray(labels)) return []
  const out: Label[] = []
  const seen = new Set<string>()
  for (const li of labels) {
    const l = normalizeLabelInput(li)
    if (!l) continue
    if (seen.has(l.name)) continue
    seen.add(l.name)
    out.push(l)
  }
  return out
}

export function parseRepo(repo: RepositoryRef | null | undefined): ParsedRepo | null {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

export function repoId(repo: RepositoryRef | null | undefined): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * 给票贴标签失败时的归因（#992）。
 * 只读仓库上建标签定义（要 push）与给票打标（要 triage 起）撞到的都是 404，
 * 光看错误文本分不清「标签不存在」还是「你没有写权限」。撞到疑似权限的失败
 * （404 或 GraphQL 那句复数权限句）就多问一次仓库权限：只有读权限（triage 为假）
 * 才改判成鉴权档并说清仓库与原因；问不出来或本就有写权限，原样返回、不瞎猜。
 */
async function attributeLabelFailure(c: ReturnType<typeof ghClient>, spec: string, wantNames: string[], err: TrackerError & { stderr?: unknown }, ctx: OpContext): Promise<TrackerError> {
  const text = String((err && (err.message || err.stderr)) || '')
  const suspicious = /HTTP 404|\b404\b|does not have the correct permissions|addlabelstolabelable/i.test(text)
    || (err && err.kind === ERROR_KIND.AUTH)
  if (!suspicious) return err
  const perms = await readRepoPermissions(c, spec, ctx)
  if (perms && perms.triage === false) {
    // 这一段是「改判」：gh 的原文本来就在手里（err），只是先前判成了别的原因，改判不能把原文丢掉。
    return { kind: ERROR_KIND.AUTH, message: readonlyMessage(spec, wantNames), raw: rawText(err) }
  }
  return err
}

/**
 * 整集替换 labels（GitHub 对齐）。
 * 若提供 expectedUpdatedAt，先取当前 Issue.updatedAt 比对，不匹配 → conflict 不落盘。
 */
/**
 * setLabels 的对外入口：建一趟轨迹、交给内层干、出口处按 #104 `issue.write` 记一行结论。
 * 贴标签是「读当前 → 算差集 → 逐条加/撤」：差集为空时一条写命令都不发，结论线记成 noop，
 * 「这次到底动没动标签」由 written 与 reason 两格一起回答。
 */
export async function setLabels(repo: RepositoryRef, key: string, labels: LabelInput[] | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = newIssueWriteTrail()
  const r = await setLabelsInner(repo, key, labels, opts, ctx, trail)
  emitIssueWrite(ctx, 'setLabels', trail, r, t0)
  return r
}

async function setLabelsInner(repo: RepositoryRef, key: string, labels: LabelInput[] | undefined, opts: SetOpts | undefined, ctx: MemoContext, trail: IssueWriteTrail): Promise<OpResult<Issue>> {
  const wanted = normalizeLabelInputs(labels)
  const k = String(key || '').trim()
  if (!k) return fail(ERROR_KIND.PARSE, 'setLabels: key required (string)', key)

  try {
    const parsed = parseRepo(repo)
    // 形状不对的入参本身就是这一处的原文（这之前还没跑过任何外部命令）；它取出来可能是空串，那是如实交代。
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setLabels: repo.refId missing: ${repoId(repo)}`, repo)

    // If-Match 前置：expectedUpdatedAt 强一致
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        // 原文交的是 GitHub 这一刻给出的 updatedAt（期望值那一半已经在 message 里说清了）。
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`, cur.data.updatedAt)
      }
    }

    const c = ghClient(ctx)
    // 读当前 labels 做 diff（需知 toAdd/toRemove）
    const curRes = await getIssue(repo, k, {}, ctx)
    // 为什么敢断言 labels 非空：getIssue 回的票都经过 normalizeIssue 归一，归一里 labels 恒为数组（normalize.ts 取不到也给 []，契约叫恒 EMPTY），成功时不可能缺这一格。
    const curLabels = curRes.ok ? curRes.data.labels!.map((l) => l.name) : []
    const wantNames = wanted.map((l) => l.name)
    const toAdd = wantNames.filter((n) => !curLabels.includes(n))
    const toRemove = curLabels.filter((n) => !wantNames.includes(n))
    const spec = `${parsed.owner}/${parsed.name}`

    // 差集算出来了：从这一步起每一次加或撤都是一条写命令，走的是 gh issue 子命令（cli）。
    trail.route = 'cli'
    for (const n of toRemove) {
      trail.written += 1
      const r = await c.execGh(['issue', 'edit', k, '--repo', spec, '--remove-label', n], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: await attributeLabelFailure(c, spec, wantNames, r.error, ctx) }
    }
    for (const n of toAdd) {
      trail.written += 1
      const r = await c.execGh(['issue', 'edit', k, '--repo', spec, '--add-label', n], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: await attributeLabelFailure(c, spec, wantNames, r.error, ctx) }
    }
    // 一条写命令都没发（差集为空）就是「一处没改」；发了至少一条就是改过。
    trail.reason = trail.written > 0 ? 'edited' : 'noop'

    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (!finalRes.ok) {
      // optimistic 回落（测试桩或离线时）
      const optimisticRaw = { number: Number(k) || k, title: '', state: 'open', body: '', url: '', labels: { nodes: wanted.map((l) => ({ name: l.name, color: l.color || '', description: l.description || '' })) }, updatedAt: new Date().toISOString() }
      const issue = normalizeIssue(optimisticRaw)
      issue.labels = wanted
      return { ok: true, data: issue }
    }
    // 确保 labels 为归一后的 wanted（带 color '' 兜底、description 可选）
    finalRes.data.labels = wanted
    return finalRes
  } catch (err) {
    const verdict = ghVerdictOf(err, ctx)
    // 为什么转成袋再读：catch 出来的是未知值，直接读 message 报缺成员；有值时袋与原值是同一份引用，真值判断与原来一致。
    const eb = (err && typeof err === 'object' ? err : {}) as { message?: unknown };
    const own = eb.message ? String(eb.message) : String(err)
    // conflict 由后端显式产生、不是从文本猜出来的：这里原样透传那一档，话术照旧走统一那一份。
    if (verdict.kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, ghFailureMessage(verdict, own), err)
    return fail(verdict.kind, ghFailureMessage(verdict, own), err)
  }
}

// 旧名兼容：addLabel → setLabels（#124：label→setLabels）—— 保留别名但标记弃用
// 为什么标成同签名：别名只是转发，参数形状与原函数完全一致，标成同签名后调用方传错会在编译时露出来，运行时还是同一份转发。
export const addLabel: typeof setLabels = (...args) => setLabels(...args)

export default { setLabels, addLabel }
