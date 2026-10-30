/**
 * src/tracker/rooms/github/write/issues.ts — issue 写路径。
 * #1687 阶段 1：从房间根迁入 write/，旧路径 src/tracker/rooms/github/issues-write.ts 保留纯转发，行为零变化。
 *
 * 由 #440 从 issues.js 纯结构移出（create / close / reopen / update / setAssignees），行为零变化。
 * 读路径（list / get + REST 降级）留在 issues.js。
 * 以后改写操作命令语义的人改它。预估约 285 行。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { Issue, RepositoryRef } from '../../../contract/entities.js';
import type { Actor } from '../../../contract/identity.js';
import type { AssigneeInput, CloseOpts, CreateInput, SetOpts, UpdatePatch } from '../../../contract/inputs.js';
import type { OpResult } from '../../../contract/results.js';
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { normalizeIssue } from '../model/normalize.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { planCloseReason } from './close-reason.js'
import { rosterUpsert } from '../model/roster.js'
import type { MemoContext } from '../model/roster.js';
import { getIssue } from '../issues.js'
import { parseRepo, repoId } from '../model/issue-key.js'
// #711：创建幂等锚。锚那一行怎么拼、命中判据是什么，在刷新核心的产物里（唯一一处判据）；
// 本间房专属的「建后按锚回查」在 ./idempotency.js（两条路：搜索接口 + 最近更新列表逐张读正文）。
import { checkIdempotencyKey } from '../../../../refresh/contract/idempotency-keys.js'
import { withAnchor, lookupByAnchor } from '../routing/idempotency.js'
// #104 `issue.write`：票写入的常驻结论线。轨迹形状与发射口在 ./write-log.js ——
// 建票、改票、评论、改标签这几处要说的是同一件事，放一处免得各写各的。
import { beginWriteTrail, emitIssueWrite } from '../support/write-log.js'
import type { WriteTrail } from '../support/write-log.js';

/**
 * 建票过程中组装的那张票：归一后的票 + 没挂上的标签/父边记账（工具层读回时据此说清部分成功）。
 * 记账两格是本文件自己添的，契约 Issue 里没有；读它们的只有工具层（运行时照读），类型上标成可选。
 */
type IssueWithNotes = Issue & { labelError?: { kind: string; message: string }; parentError?: { kind: string; message: string } };

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，直接读 message 报缺成员；
// 转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown, len: number): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}

/**
 * create(repo, input, ctx) -> OpResult<Issue>
 * input: {title, body?, type?, parentKey?, labels?, assignees?, idempotencyKey?}
 *
 * #711：`idempotencyKey` 是可选输入。带上它时，票面正文的第一行是锚（渲染后看不见的 HTML 注释），
 * 建票之前先按锚回查一次：命中就把那张票交回去（返回同一个 key、不再建），没命中才照常建。
 * 回查拿不准时如实失败、绝不建票。不带这个字段时行为与加字段之前完全一样。
 *
 * 失败时的第三段原文（`fail` 的 `raw`）按三种情况交：
 * 一是入参形状不合格——这时还没跑过任何外部命令，手里确实没有更早的原文，就交那个不合格的入参本身；
 * 二是上游交回过结果（`gh` 的执行结果、别处 op 的返回）——交那份结果，原话就在它里面；
 * 三是回包解析失败——交那份没能解析的回包文本本身。
 */
/**
 * create 的对外入口：建一趟轨迹、交给内层干、出口处按 #104 `issue.write` 记一行结论（成功与失败都记）。
 * 为什么套一层而不是在内层每个 return 前各记一行：内层出口有七八个（校验、回查、建票、解析各一处），
 * 套一层只有一个出口，失败那一路（抛异常）也不会漏。
 */
export async function createIssue(repo: RepositoryRef, input: CreateInput, ctx: MemoContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await createIssueInner(repo, input, ctx, trail)
  emitIssueWrite(ctx, 'create', trail, r, t0)
  return r
}

async function createIssueInner(repo: RepositoryRef, input: CreateInput, ctx: MemoContext, trail: WriteTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `create: repo.refId missing: ${repoId(repo)}`, repo)
    if (!input || typeof input.title !== 'string' || !input.title.trim()) return fail(ERROR_KIND.PARSE, 'create: title required', input)
    // 幂等键当场检查：不合规（空、超长、带换行或注释收尾符）绝不落到正文上，
    // 而且必须比「回查」更早失败 —— 键不合法时连回查都无从做起。
    const wantKey = input.idempotencyKey === undefined || input.idempotencyKey === null ? null : checkIdempotencyKey(input.idempotencyKey)
    // 键本身不合规时，原文就交那个不合规的键值（为什么不合规已经写在给人看的那句话里）。
    if (wantKey && !wantKey.ok) return fail(ERROR_KIND.PARSE, `create: idempotencyKey 不能用：${wantKey.reason}`, input.idempotencyKey)
    const idemKey = wantKey ? wantKey.key : ''
    if (idemKey) {
      const found = await lookupByAnchor(repo, idemKey, ctx, normalizeIssue)
      if (!found.ok) return { ok: false, error: found.error }
      // 幂等命中：这一趟一张票都没建，把已有一张交回去 —— 结论线由出口按「一条写命令都没发」算成「复用」。
      if (found.hit) return { ok: true, data: found.issue }
    }
    const c = ghClient(ctx)
    const body = withAnchor(typeof input.body === 'string' ? input.body : '', idemKey)
    // 主路用 REST 建票：gh api 不支持经 stdin 传整包（执行层没有 stdin 口），改用 -f 逐字段传；
    // gh issue create 不认 --json，所以不走它。标签与认领建后另补（已有现成函数）。
    const createArgs = ['api', `repos/${parsed.owner}/${parsed.name}/issues`, '--method', 'POST', '-f', `title=${input.title.trim()}`, '-f', `body=${body}`, '--jq', '.']
    // 到这一步才真会发出写命令：route 记下走的是 gh api（REST），written 记下真发出去一条 ——
    // 发出去了就算一条，成没成由结论线的 ok 那一格说。
    trail.route = 'rest'
    trail.written += 1
    const r = await c.execGh(createArgs, { cwd: ctx && ctx.cwd })
    // 为什么标成键值袋：建票回包是 gh 回的任意形状，只读 number/state/url/时间/labels/assignees 几格；
    // 有值时袋与原值是同一份引用，读法与原来一致。
    let createdRaw: Record<string, unknown> | null = null
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    try {
      const j: unknown = JSON.parse(text)
      createdRaw = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | null;
    } catch (e) {
      // 原文交那份没能解析成 JSON 的回包文本。
      return fail(ERROR_KIND.PARSE, `create: invalid json ${caughtMessage(e, 200)}`, text)
    }
    if (!createdRaw) return fail(ERROR_KIND.PARSE, 'create: empty response', r.data)
    // REST 返回 number → 需补充 parentKey 等字段，再 normalize
    const rawForNormalize = Object.assign({}, createdRaw, {
      number: createdRaw.number ?? createdRaw.id,
      state: createdRaw.state || 'open',
      url: createdRaw.url || createdRaw.html_url || '',
      createdAt: createdRaw.createdAt || createdRaw.created_at || '',
      updatedAt: createdRaw.updatedAt || createdRaw.updated_at || '',
      closedAt: createdRaw.closedAt || createdRaw.closed_at || null,
      labels: createdRaw.labels ? { nodes: (Array.isArray(createdRaw.labels) ? createdRaw.labels.map((l) => typeof l === 'string' ? { name: l, color: '' } : l) : []) } : { nodes: [] },
      assignees: createdRaw.assignees ? { nodes: (Array.isArray(createdRaw.assignees) ? createdRaw.assignees.map((a) => typeof a === 'string' ? { login: a } : a) : []) } : { nodes: [] },
    })
    let issue: IssueWithNotes = normalizeIssue(rawForNormalize)
    // 标签与认领建后另补（建票一步只带标题正文；已有现成函数走正常接口）
    try {
      // 为什么显式标成串数组：条件分支里才往里装，编译器判成隐式 any；装的本来就是标签名串，运行时还是原来那几个值。
      const wantLabels: string[] = [];
      if (Array.isArray(input.labels) && input.labels.length) {
        for (const l of input.labels) {
          const n = (typeof l === 'string' ? l.trim() : (l && typeof l.name === 'string' ? l.name.trim() : ''));
          if (n && !wantLabels.includes(n)) wantLabels.push(n);
        }
      }
      const wantType = input.type === 'map' ? 'map' : 'issue';
      // 为什么敢断言 labels 非空：归一后的票 labels 恒为数组（normalize.ts 取不到也给 []，契约叫恒 EMPTY），成功建票后不可能缺这一格。
      if (wantType === 'map' && !issue.labels!.some((l) => l.name === 'wayfinder:map') && !wantLabels.includes('wayfinder:map')) wantLabels.push('wayfinder:map');
      if (wantLabels.length) {
        const { setLabels } = await import('./labels.js');
        const merged = [...issue.labels!.map((l) => l.name)];
        for (const n of wantLabels) if (!merged.includes(n)) merged.push(n);
        const lr = await setLabels(repo, issue.key, merged.map((n) => ({ name: n })), {}, ctx);
        if (lr && lr.ok === true && lr.data) issue = lr.data;
        else {
          // 补挂没成：票照样建成（#992，如实记在票上让工具层读回时说清），但结论线要如实说成 partial。
          trail.failed += 1
          // #992：标签没挂上不再吞错，记在票上让工具层读回时能说清（照 parentError 先例，票照样建成 ok:true）。
          // 为什么先收窄：setLabels 的返回是可辨识联合，失败分支才有 error；直接读 error 编译器不认，收窄后读的还是原来那一格。
          const lrError = (lr && !lr.ok) ? lr.error : null;
          const kind = String((lrError && lrError.kind) || '');
          const message = String((lrError && lrError.message) || '后端没给出原因').slice(0, 300);
          issue.labelError = { kind: kind, message: message };
          if (wantType === 'map') issue.type = 'map';
          // Q6：正文“待补标签（只读未落盘）”区 —— 把没确认挂上的标签名写进正文，区名必带“未落盘”。
          //   话术按双入口拆：工作区绑在只读库上（板子站错地方）与给只读库的票打标（这张票要的权限不够）
          //   是同一根因的两面，区里两句都说到，用户无论从哪一面撞上都看得懂。尽力写：改正文本身也可能
          //   没权限，写不上也不影响建票（没挂上的事实已经记在 labelError 里，工具层按部分成功回报）。
          //   正文为空时不敢写（会把建票锚与原有内容冲掉），只留 labelError。
          try {
            if (typeof issue.body === 'string' && issue.body) {
              const spec = (parsed.owner + '/' + parsed.name);
              const section = '## 待补标签（只读未落盘）\n\n以下标签这次没确认挂上（'
                + wantLabels.join('、')
                + '）：你在「' + spec + '」上只有读权限时，标签建不上、打不上——这不是网络问题。'
                + '在只读仓库上建票能成、读票能看，但补标签要 triage 及以上权限（新建标签要 push）。'
                + '有权限后请把这些标签补打上；要在只读库上长期协作，建议先 fork 到自己名下，再把工作区 origin 指向 fork（插件只认 origin，不代改配置）。\n';
              const hasSection = /^##\s*待补标签.+未落盘.+$/m.test(issue.body);
              const newBody = hasSection
                ? issue.body.replace(/^##\s*待补标签.+未落盘.+$\s*[\s\S]*?(?=^##\s|$(?![\s\S]))/m, section)
                : (issue.body.replace(/\s*$/, '') + '\n\n' + section);
              const ur = await updateIssue(repo, issue.key, { body: newBody }, ctx);
              if (ur && ur.ok === true && ur.data && typeof ur.data.body === 'string') issue.body = ur.data.body;
            }
          } catch {}
        }
      } else if (wantType === 'map' && issue.type !== 'map') issue.type = 'map';
    } catch {}
    try {
      if (Array.isArray(input.assignees) && input.assignees.length) {
        const want = input.assignees.map((a) => (typeof a === 'string' ? { login: a.trim() } : a)).filter((a) => a && a.login);
        if (want.length) {
          const ar = await setAssignees(repo, issue.key, want, {}, ctx);
          if (ar && ar.ok === true && ar.data) issue = ar.data;
          // 认领没挂上：这一处照旧不吞错改返回（票照样建成 ok:true），但补挂这一步没成要记进结论线。
          else trail.failed += 1;
        }
      }
    } catch {}
    // parentKey 有则创后 setParent：挂不上不吞错，记在票上让工具层读回时能说清。
    if (input.parentKey != null && input.parentKey !== '') {
      try {
        const { setParent } = await import('./graph.js')
        const pr = await setParent(repo, issue.key, String(input.parentKey), {}, ctx)
        // 为什么断言：setParent 成功时一定带回那张票（失败走 else 记账）；graph.ts 定型后这里再复核，断言只为过编译、交的还是原来那个值。
        if (pr.ok) issue = pr.data as Issue
        else {
          issue.parentError = { kind: String((pr.error && pr.error.kind) || ''), message: String((pr.error && pr.error.message) || '后端没给出原因').slice(0, 300) }
          trail.failed += 1
        }
      } catch (e) {
        issue.parentError = { kind: 'unknown', message: caughtMessage(e, 300) }
        trail.failed += 1
      }
    }
    try { if (ctx && ctx.memo) rosterUpsert(ctx.memo, issue) } catch (eU) {}
    return { ok: true, data: issue }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文。`ctx` 一定要传下去，`error.normalize` 那条轨迹才不断。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

export async function closeIssue(repo: RepositoryRef, key: string, opts: CloseOpts | undefined, ctx: OpContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await closeIssueInner(repo, key, opts, ctx, trail)
  emitIssueWrite(ctx, 'close', trail, r, t0)
  return r
}

async function closeIssueInner(repo: RepositoryRef, key: string, opts: CloseOpts | undefined, ctx: OpContext, trail: WriteTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `close: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'close: key required', key)
    const c = ghClient(ctx)
    // gh issue close 不认 --json：先关，再用 view 取回
    const args = ['issue', 'close', k, '--repo', `${parsed.owner}/${parsed.name}`]
    // #1532：关闭原因怎么落到 GitHub 后端（固定值直通、自由文本先评论再关），在 ./close-reason.js 里决定。
    const reasonPlan = await planCloseReason(repo, k, opts, ctx)
    if (!reasonPlan.ok) return reasonPlan
    args.push(...reasonPlan.data.args)
    const rawReason = reasonPlan.data.raw
    // 从这一步起真会发出写命令：走的是 gh issue 子命令（cli）。
    trail.route = 'cli'
    trail.written += 1
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) {
      // 写命令已回成功、写后读回失败：不许乐观拼一张「已经关上了」的票回 ok（#790 同一类：
      // 写动作的回包不算证据）。读不回来就如实报失败，让上层说「没确认」而不是「已改好」。
      const readMsg = String((vr.error && vr.error.message) || '').slice(0, 300)
      return fail((vr.error && vr.error.kind) || ERROR_KIND.NETWORK, 'close: 写命令已回成功，但写后读回失败：' + (readMsg || '没给出原因') + '；这张票现在是不是 closed 没确认', vr)
    }
    const text = vr.data.stdout || ''
    let raw: unknown
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `close: invalid json ${caughtMessage(e, 200)}`, text) }
    // 为什么断言：回包是 gh 回的任意形状，只读 number/url/closedAt 几格；断言只为过编译，读的还是原来那几格，运行时不变。
    const rawb = raw as Record<string, unknown>;
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: rawb.number ?? Number(k),
      url: rawb.url || rawb.html_url || '',
      closedAt: rawb.closedAt || rawb.closed_at || new Date().toISOString(),
    }))
    // reason 回填：回填调用方原话（去首尾空格），而不是实际发给 --reason 的固定值，
    // 免得自由文本被固定值覆盖、读回时找不到原话。
    if (rawReason) normalized.reason = rawReason
    return { ok: true, data: normalized }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文。`ctx` 一定要传下去，`error.normalize` 那条轨迹才不断。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

export async function reopenIssue(repo: RepositoryRef, key: string, ctx: OpContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await reopenIssueInner(repo, key, ctx, trail)
  emitIssueWrite(ctx, 'reopen', trail, r, t0)
  return r
}

async function reopenIssueInner(repo: RepositoryRef, key: string, ctx: OpContext, trail: WriteTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `reopen: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'reopen: key required', key)
    const c = ghClient(ctx)
    const args = ['issue', 'reopen', k, '--repo', `${parsed.owner}/${parsed.name}`]
    // 从这一步起真会发出写命令：走的是 gh issue 子命令（cli）。
    trail.route = 'cli'
    trail.written += 1
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    // 重开这条真成了：这一趟改的是已有一张票（结论由出口按事实算，这里不再自己写一遍）。
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) {
      // 同上：读不回来不许拼「已经重开了」的票（#790 同一类）。
      const readMsg = String((vr.error && vr.error.message) || '').slice(0, 300)
      return fail((vr.error && vr.error.kind) || ERROR_KIND.NETWORK, 'reopen: 写命令已回成功，但写后读回失败：' + (readMsg || '没给出原因') + '；这张票现在是不是 open 没确认', vr)
    }
    const text = vr.data.stdout || ''
    let raw: unknown
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `reopen: invalid json ${caughtMessage(e, 200)}`, text) }
    // 为什么断言：同上，回包是 gh 回的任意形状，只读 number/url 几格；断言只为过编译，运行时不变。
    const rawb = raw as Record<string, unknown>;
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: rawb.number ?? Number(k),
      state: 'open',
      url: rawb.url || rawb.html_url || '',
      closedAt: null,
    }))
    return { ok: true, data: normalized }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文。`ctx` 一定要传下去，`error.normalize` 那条轨迹才不断。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

export async function updateIssue(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await updateIssueInner(repo, key, patch, ctx, trail)
  emitIssueWrite(ctx, 'update', trail, r, t0)
  return r
}

async function updateIssueInner(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext, trail: WriteTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `update: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'update: key required', key)
    if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE, 'update: patch required', patch)
    // 能力分支：milestone/customFields 不支持 → unsupported（不假装）
    if (patch.milestone !== undefined || patch.customFields !== undefined) {
      // milestone 若需支持可走 REST，但当前按 GH API 简化：milestone 需 number，此处诚实返回 unsupported
      // 为保持最小可用，若调用方传 milestone 但 GitHub 实际支持，可在此透传；现按 unsupported
      const hasMilestone = patch.milestone !== undefined
      const hasCustom = patch.customFields !== undefined
      // 不支持的字段值原样交出去当原文：调用方自己传了什么，一眼能对上。
      if (hasCustom) return fail(ERROR_KIND.UNSUPPORTED, 'update: customFields unsupported for github', patch.customFields)
      // milestone 若为 null（清除）或对象，尝试支持：若有标题则尝试查找 milestone number（需额外 API），暂 unsupported
      if (hasMilestone) return fail(ERROR_KIND.UNSUPPORTED, 'update: milestone unsupported (requires milestone number lookup)', patch.milestone)
    }
    const c = ghClient(ctx)
    // gh issue edit 不认 --json：先改，再用 view 取回
    const args = ['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`]
    if (typeof patch.title === 'string') args.push('--title', patch.title)
    if (typeof patch.body === 'string') args.push('--body', patch.body)
    if (args.length <= 4) return fail(ERROR_KIND.PARSE, 'update: empty patch (no title/body)', patch)
    // 从这一步起真会发出写命令：走的是 gh issue 子命令（cli）。
    trail.route = 'cli'
    trail.written += 1
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    // 改票这条真成了：这一趟改的是已有一张票（结论由出口按事实算，这里不再自己写一遍）。
    const vr = await c.execGh(['issue', 'view', k, '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees'], { cwd: ctx && ctx.cwd })
    if (!vr.ok) {
      // 同上：读不回来不许拼一张「已经改好了」的票（#790 同一类）。
      const readMsg = String((vr.error && vr.error.message) || '').slice(0, 300)
      return fail((vr.error && vr.error.kind) || ERROR_KIND.NETWORK, 'update: 写命令已回成功，但写后读回失败：' + (readMsg || '没给出原因') + '；这次改的字段落上没落上没确认', vr)
    }
    const text = vr.data.stdout || ''
    let raw: unknown
    try { raw = JSON.parse(text); if (Array.isArray(raw)) raw = raw[0] } catch (e) { return fail(ERROR_KIND.PARSE, `update: invalid json ${caughtMessage(e, 200)}`, text) }
    // 为什么断言：同上，回包是 gh 回的任意形状，只读 number/url 两格；断言只为过编译，运行时不变。
    const rawb = raw as Record<string, unknown>;
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: rawb.number ?? Number(k),
      url: rawb.url || rawb.html_url || '',
    }))
    return { ok: true, data: normalized }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文。`ctx` 一定要传下去，`error.normalize` 那条轨迹才不断。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

function normalizeAssigneeInput(ai: unknown): Actor | null {
  if (typeof ai === 'string') {
    const login = ai.trim()
    if (!login) return null
    return { login }
  }
  if (!ai || typeof ai !== 'object') return null
  // 为什么转成袋再读：输入可能是任意形状，直接读 login/name/avatarUrl/kind 报缺成员；对象检查通过后袋与原值是同一份引用，读法与原来一致。
  const bag = ai as { login?: unknown; name?: unknown; avatarUrl?: unknown; kind?: unknown };
  const login = typeof bag.login === 'string' ? bag.login.trim() : ''
  if (!login) return null
  // 为什么先定死契约再补可选键：字面量起手类型里没有 name/avatarUrl/kind，后面再补会报缺成员；先标成认领形状，可选键自然有位置。
  const out: Actor = { login }
  if (typeof bag.name === 'string' && bag.name.trim() !== '') out.name = bag.name
  if (typeof bag.avatarUrl === 'string' && bag.avatarUrl !== '') out.avatarUrl = bag.avatarUrl
  if (typeof bag.kind === 'string' && bag.kind) out.kind = bag.kind
  return out
}

export async function setAssignees(repo: RepositoryRef, key: string, assignees: AssigneeInput[] | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
  const t0 = Date.now()
  const trail = beginWriteTrail()
  const r = await setAssigneesInner(repo, key, assignees, opts, ctx, trail)
  emitIssueWrite(ctx, 'setAssignees', trail, r, t0)
  return r
}

async function setAssigneesInner(repo: RepositoryRef, key: string, assignees: AssigneeInput[] | undefined, opts: SetOpts | undefined, ctx: MemoContext, trail: WriteTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setAssignees: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setAssignees: key required', key)
    // 为什么显式标：循环里才往里装，编译器判成隐式 any；装的本来就是归一后的认领，运行时还是原来那几个值。
    const wanted: Actor[] = []
    const seen = new Set<string>()
    if (Array.isArray(assignees)) {
      for (const ai of assignees) {
        const a = normalizeAssigneeInput(ai)
        if (!a) continue
        if (seen.has(a.login)) continue
        seen.add(a.login)
        wanted.push(a)
      }
    }
    // If-Match 前置：expectedUpdatedAt
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`, cur.data.updatedAt)
    }
    const c = ghClient(ctx)
    // 认领走 gh issue edit 的 --add-assignee / --remove-assignee（#1418 复核：这条子命令内部发 /graphql，
    // 不是 REST 整集替换）；它是增量接口，所以先用下面这次 getIssue 读当前认领、算差集再逐条发。
    const logins = wanted.map((a) => a.login)
    // 先读当前 assignees 做 diff（读走 getIssue 的 GraphQL 查询，与写同族）
    const curRes = await getIssue(repo, k, {}, ctx)
    // 为什么敢断言 assignees 非空：同上，归一后的票 assignees 恒为数组（取不到也给 []），读到缺这一格就抛、与原来一致。
    const curLogins = curRes.ok ? curRes.data.assignees!.map((a) => a.login) : []
    const toAdd = logins.filter((l) => !curLogins.includes(l))
    const toRemove = curLogins.filter((l) => !logins.includes(l))
    // 差集算出来了：从这一步起每一次加或撤都是一条写命令，走的是 gh issue 子命令（cli）。
    // route 在真发出命令那一刻才改口：一条都没发（差集为空）时它保持 none —— 结论线说的是
    // 「真走到哪一层」，不是「本来打算走哪一层」。
    for (const l of toRemove) {
      trail.route = 'cli'
      trail.written += 1
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--remove-assignee', l], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    for (const l of toAdd) {
      trail.route = 'cli'
      trail.written += 1
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--add-assignee', l], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    // 读回最新：回包里那份必须是读回来的，不能是刚提交的那份（#790 同一类：写动作的回包不算证据）。
    // 读不回来就如实报失败，不再乐观拼一张「认领人已就位」的票回 ok —— 那会让上层把
    // 「写命令成功、盘上没记上」报成完成（setAssignees 的调用方正是按这个回包判 ok 的）。
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (!finalRes.ok) {
      const readMsg = String((finalRes.error && finalRes.error.message) || '').slice(0, 300)
      return fail((finalRes.error && finalRes.error.kind) || ERROR_KIND.NETWORK, 'setAssignees: 写命令已回成功，但写后读回失败：' + (readMsg || '没给出原因') + '；认领人记上没记上没确认', finalRes)
    }
    return finalRes
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑；
    // 第三段把出错的那个值原样交出去当原文。`ctx` 一定要传下去，`error.normalize` 那条轨迹才不断。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}
