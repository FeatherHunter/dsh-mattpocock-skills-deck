/**
 * src/tracker/rooms/gitlab/labels/colors.ts —— 批量改标签颜色（契约操作 setLabelColors）。
 *
 * 为什么住在 labels/ 子树（#1916）：标签是一个概念，赋值、清单、配色三条操作都落在这个目录里。
 * 搬进子树之前这条路在房间根目录的 labels-ops.ts；搬完根目录不再留标签实现。
 *
 * 契约（正文见 src/tracker/contract/operations.ts，返回形状见 contract/results.ts）：
 *   setLabelColors(repo, changes, ctx) → {ok:true, data: {applied, failed}}，逐条记账。
 * 入参里每一条改动必须恰好出现在 applied 或 failed 之一；部分成功是合法结果，中途失败不回滚
 * （GitLab 没有一次改 N 个标签颜色的接口，改到一半失败必然留半成品）。
 *
 * 请求形状不在这里：每一条改动都走房间根目录 requests.ts 的 requestLabelColor，method、路径、
 * 编码与表单字段在那里只有一个出处；本文件只做请求前后属于操作上下文的事：入参把关、并发上限、
 * 逐条记账、失败判档与每一句按档位写清「这一条改没改成」的话术。
 *
 * ── 颜色约束：2026-10-14 查 GitLab 官方文档核实过（不要凭印象改）─────────────
 * 出处：官方 API 文档「Project labels API」（https://docs.gitlab.com/api/labels/）与
 * 它的源文件 doc/api/labels.md（https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/labels.md）。
 * 一、**颜色不是任意字符串，也不是只能从预定义色板里挑**：color 取「带前导井号的六位十六进制」
 *     （文档原话是 6-digit hex notation with leading '#' sign，例如 #FFAABB），或者一个 CSS 颜色名。
 *     本房只产出十六进制：契约的 LabelColor.color 只认不带井号的六位小写十六进制，没有地方放颜色名；
 *     写侧发十六进制一样能改掉颜色，用户要的是「把颜色改掉」，不受影响。
 * 二、**text_color 写不了，只能读**：POST/PUT 的参数表里都没有它（能写的是 color / new_name /
 *     description / priority / archived），列表回包里它存在。契约的 LabelColor 只有 name / color /
 *     description 三格，text_color 无处可放，本文件原样丢弃它，不做映射——这是形状定死的，不是欠账。
 * 三、**更新的路径**：只走现行接口 PUT /projects/:id/labels/:label_id；带 name 或 label_id 的
 *     PUT /projects/:id/labels 是文档明写 deprecated 的旧接口，不用。标签名里的冒号与空格都算在
 *     标签名里，编码交给请求边界那一层，本文件不自己拼路径。
 * 四、description 与 priority 是另两个可写参数：本文件**只改颜色**，一个都不碰。
 *
 * ── 本房为什么不实现 ensureLabelColorsFile ──────────────────────────────────
 * 契约里第三条 ensureLabelColorsFile 承诺的不只是「工作区里有一份文件」，还有「那份文件改了算数」。
 * GitLab 的标签颜色真源是仓库标签本身，工作区里那份文件没有任何读者——读颜色走 list.ts 的
 * listLabels、改颜色走本文件，界面入口是仓库标签页。放一份改了不计数的文件只会误导人，所以这一条
 * 按「形态不合」处理，登记为明确不支持（见 ./capability-register.ts 与 docs/tracker/capability-gitlab.md）。
 *
 * ── 本房的几条硬规矩（照 GitHub 房同族实现的口径）─────────────────────────────
 *  · 失败一律经 fail(...) / failGlab(...) 构造，携带原文（raw 必填），不抛给调用方。
 *  · 判档只走本房唯一的出口 classifyGlabError；这里不自己写正则判第二遍。
 *  · 读路径每一条「没读成」的分支，在失败或「拿不全」之前必须落一行 read.degraded
 *    （出口是 ../read-log.ts 的 emitReadDegraded），reason 只取那文件里已登记的值。
 *  · 房间内不用 ctx.logEvent 直接记日志（read-log.ts 那一处出口除外）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { LabelColorChange, RepositoryRef } from '../../../contract/entities.js'
import type { ErrorKind } from '../../../contract/identity.js'
import { type OpResult, type TrackerError, type LabelColorBatchResult } from '../../../contract/results.js'
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { fail } from '../../../kernel/preflight.js'
import { classifyGlabError, failGlab } from '../errors.js'
import { emitReadDegraded } from '../read-log.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefOf } from '../model/repo-identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1916）：改一个标签颜色的端点在那里收口。
import { requestLabelColor } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；请求函数收领域值 timeoutMs，档位由这里按操作选。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { errText, withRawHint } from './shared.js'

/** 同时最多发几个改色请求。GitLab 没有单请求限速建议，默认与 GitHub 房同档。 */
export const WRITE_CONCURRENCY_MAX = PAGINATION.gitlab.labelWriteConcurrencyMax
export const WRITE_CONCURRENCY_DEFAULT = PAGINATION.gitlab.labelWriteConcurrencyDefault

// ── 入参把关 ──────────────────────────────────────────────────────────────────

/**
 * 改色入参的形状把关：不是一批改动就整条失败（落解析档）。
 * 单条的颜色写错不算入参坏掉：那一条落解析档，其余照改。
 *
 * 重名判定按**原样名字**（去首尾空白后逐字比较），不折叠大小写——这一处**与 GitHub 房不同**。
 * GitHub 那一家写这条时给出的理由是「GitHub 认名字时不区分大小写、首尾空格也不算数」；
 * 本房**没有核实过 GitLab 是同一套规则**（官方 API 文档那一页不提标签名的大小写语义），
 * 所以不照抄那个折叠：折叠错了会把「两个只差大小写的标签」误判成「同一个标签写了两次」，
 * 整条拒掉一次本来能做成的改动；而不折叠错了只是多发一条请求，结果由远端逐条裁决——
 * 两边的代价不对称，选错得轻的那一边。名字两边只有空白差别的那一类（"bug" 与 " bug "）
 * 本判据照样按住，因为首尾空白在任何一家都不可能算标签名的一部分。
 */
function changesProblem(changes: unknown): string {
  if (!Array.isArray(changes)) return '修改标签颜色需要一批「标签 → 新颜色」的改动，本次收到的内容不是这种格式'
  const seen = new Set<string>()
  for (const ch of changes) {
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return '这一批改动中有一条不是「标签 → 新颜色」的格式'
    // 为什么断言：上面刚验过这一条是对象，名字颜色两格下面还要验；断言只为过编译，读的还是原来那几格。
    const bag = ch as { name?: unknown; color?: unknown }
    if (typeof bag.name !== 'string' || !bag.name.trim()) return '这一批改动中有一条未填写标签名'
    if (typeof bag.color !== 'string' || !bag.color.trim()) return '这一批改动中有一条未填写新颜色'
    // 重名判据两边都用去掉首尾空白之后的名字，所以「bug」与「 bug 」算同一条；
    // 交给远端的那一份仍然是用户写的那串原文（见 applyOne：请求边界按原始名字编码路径）。
    const key = bag.name.trim()
    if (seen.has(key)) return '同一批改动里「' + key + '」出现了两次，一个标签在一批中只允许出现一次。请只保留其中一条，然后重试。'
    seen.add(key)
  }
  return ''
}

/** 这次用几路并发。默认 4 路；调用方要保守可以调小，最多 4 路。 */
function writeConcurrency(ctx: OpContext): number {
  // 为什么断言：并发数是调用方塞在上下文里的调优旋钮，不在操作契约里；断言只为读到它，读法与原来一致。
  const bag = ctx as OpContext & { labelColorConcurrency?: unknown }
  const raw = ctx && typeof bag.labelColorConcurrency === 'number' ? bag.labelColorConcurrency : WRITE_CONCURRENCY_DEFAULT
  if (!Number.isFinite(raw) || raw < 1) return WRITE_CONCURRENCY_DEFAULT
  return Math.min(Math.floor(raw), WRITE_CONCURRENCY_MAX)
}

// ── 收尾：判断值与失败构造的小工具 ────────────────────────────────────────────

/**
 * 逐条失败的理由（契约里 applied/failed 的 reason 就是失败形状 TrackerError）。
 *
 * 为什么走 fail() 而不是自己拼对象：失败形状只有一处构造，原文的合并、遮蔽、头尾截断都归它；
 * 这里只把契约要的那三段取出来。**第三段一定交「出了错的那个东西」本身**（这一次调用的进程结果），
 * 不要先 String() 成一句话再交——那样原文会变成 [object Object]，界面上展开看不到任何证据。
 * 为什么不是 failGlab()：逐条失败要的是一句按档位写清「这一条改没改成」的话，
 * 而 failGlab 会把兜底档与 unsupported 档换成全仓统一的那两句提示、丢掉这一条的上下文；
 * 判档那一步仍然只走 classifyGlabError 一个出口（见 kindOf），这里不自己判第二遍。
 */
function reason(kind: ErrorKind, message: string, raw: unknown): TrackerError {
  return fail(kind, message, raw).error
}

/** 一次 glab 调用没跑成时的档位：一律走本房唯一的判档出口，本文件不自己写正则判第二遍。 */
function kindOf(err: unknown, ctx: OpContext): ErrorKind {
  return classifyGlabError(err, ctx).kind
}

// ── 批量改色 ─────────────────────────────────────────────────────────────────

/** 按并发上限跑一批活，结果按入参顺序放回。
 *  逐条记账的前提是「每条的结果都拿回来」：跑失败的那条自己也返回一个结果，这里不因为某条失败就停。 */
async function runWithLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  const runners: Promise<void>[] = []
  for (let i = 0; i < lanes; i++) {
    runners.push((async () => {
      for (;;) {
        const idx = next
        next += 1
        if (idx >= items.length) return
        results[idx] = await worker(items[idx], idx)
      }
    })())
  }
  await Promise.all(runners)
  return results
}

/**
 * 改一个标签的颜色：成功给 {ok:true, entry:{name,color}}，失败给 {ok:false, entry:{name,reason}}。
 *
 * 发出去的是 PUT /projects/:id/labels/:label_id，参数只有 color 一个：
 * 不带 new_name（改名不是这件事）、不带 description（会覆盖用户写的说明）、不建标签、不删标签。
 * 颜色按官方文档要求补上井号（见文件头「颜色约束」第一条）。
 * 标签名的路径编码在请求边界（requestLabelColor）里做，本文件交原始名字，不自己拼路径。
 */
async function applyOne(ctx: OpContext, refId: string, ch: LabelColorChange): Promise<{ ok: boolean; entry: { name: string; color?: string; reason?: TrackerError } }> {
  const want = normalizeColor(ch.color)
  if (!want) {
    // 这条是本插件自己先拦下来的：颜色还没送到 GitLab 就被判为不合格，所以没有任何后端原文可交，
    // 第三段如实给空串（不能把用户自己填的颜色当成「原始说明」回显，那是假的出处）。
    return { ok: false, entry: { name: ch.name, reason: reason(ERROR_KIND.PARSE, '「' + ch.name + '」的新颜色不正确：请改为不带井号的六位十六进制，例如 9d7cd8。', '') } }
  }
  const res = await requestLabelColor(ctx, refId, ch.name, '#' + want, GITLAB_READ_TIMEOUT_MS)
  if (res.code === 0) {
    // applied 里放的是**这次写下去的目标颜色**，不是回读值（契约 results.ts 明写）。
    // 所以这里不解析回包——回包解码失败也不该把一条已经成功的写入记成失败（那是漏记账）。
    return { ok: true, entry: { name: ch.name, color: want } }
  }
  return { ok: false, entry: { name: ch.name, reason: explainWriteFailure(res, ch, ctx) } }
}

/**
 * 一条改动没改成时，它该落契约八档里的哪一档、对用户说什么。
 *
 * 判档只走本房唯一的出口（classifyGlabError），这里只负责把同一档换成一句有上下文的话。
 * 每一句都写清「这一条到底改没改成」，因为部分成功是合法结果，用户要能逐条对上。
 */
function explainWriteFailure(err: unknown, ch: LabelColorChange, ctx: OpContext): TrackerError {
  const kind = kindOf(err, ctx)
  const hint = withRawHint('', err)
  if (kind === ERROR_KIND.AUTH) {
    return reason(kind, 'GitLab 未通过登录校验（没有登录，或登录已失效），因此无法修改「' + ch.name + '」的颜色：请先运行 glab auth login 完成登录，然后重新保存。本次「' + ch.name + '」的颜色未改动。' + hint, err)
  }
  if (kind === ERROR_KIND.RATELIMIT) {
    return reason(kind, 'GitLab 因请求过于频繁拒绝了这次请求。请稍后重新保存。本次「' + ch.name + '」的颜色未改动。' + hint, err)
  }
  if (kind === ERROR_KIND.NETWORK) {
    return reason(kind, '修改「' + ch.name + '」的颜色时无法连接 GitLab（网络不可用或请求超时），插件没有拿到答复，因此无法确认这一条的颜色是否已经改动。请确认网络可用后重新保存，并重新打开这个弹窗核对。' + hint, err)
  }
  if (kind === ERROR_KIND.PARSE) {
    return reason(kind, 'GitLab 拒绝了「' + ch.name + '」的新颜色。GitLab 要求颜色是带井号的六位十六进制（例如 #9d7cd8），插件已经按这个写法发出去，所以这一条多半是标签名或权限引起的。本次「' + ch.name + '」的颜色未改动。' + hint, err)
  }
  if (kind === ERROR_KIND.NOTFOUND) {
    // 同一个 404 在这家有三种来路（标签不在、项目名不对、没有写权限），文档没有给可分辨的返回体；
    // 三条都写进同一句里，让人自己按顺序核对，不假装能分开。
    return reason(kind, 'GitLab 报告找不到「' + ch.name + '」这个标签（或这个项目）。三种可能：标签不在这个项目里、项目全路径不正确、当前账号在这个项目上没有改标签的权限。请核对标签名与项目全路径、确认账号已登录且有权限，然后重新保存。本次「' + ch.name + '」的颜色未改动。' + hint, err)
  }
  if (kind === ERROR_KIND.ENV) {
    return reason(kind, '修改「' + ch.name + '」的颜色时，本机的 GitLab 助手（glab）没有给出答复，因此无法确认这一条的颜色是否已经改动。这是插件运行环境的问题，不是你的操作有误。请稍后重新保存，并重新打开这个弹窗核对。' + hint, err)
  }
  return reason(kind, '修改「' + ch.name + '」的颜色时发生插件未能识别的错误。插件无法确认这一条的颜色是否已经改动，请重新打开这个弹窗核对；若仍然失败，请把这一句原文报告给插件维护者。' + hint, err)
}

/**
 * 批量改标签颜色（契约操作 setLabelColors）。
 *
 * 逐条记账、中途失败不回滚（GitLab 没有一次改 N 个标签颜色的接口，改到一半失败必然留半成品）。
 * 入参里每一条改动必须恰好落在 applied 或 failed 之一——这靠两件事保证：
 *   ① 每条都返回一个结果（applyOne 的两个分支都带 entry）；
 *   ② 每条外面还包一层兜底 catch：某一条上冒出意外异常时只把这一条记成失败，其余照跑。
 *      不这么写的话，异常会冒到外面那个整批 catch，已经改好的标签一条都不记账。
 */
export async function setLabelColors(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext): Promise<OpResult<LabelColorBatchResult>> {
  const t0 = Date.now()
  try {
    const bad = changesProblem(changes)
    // 入参不合格时手里还没有任何外部原文，原文就交那份不合格的改动清单本身。
    // 改动清单形状不合契约：在写任何东西之前拒绝，改入参才能继续，标输入被拒。
    if (bad) return fail(ERROR_KIND.PARSE, bad, changes)
    const refId = repoRefOf(repo)
    if (!refId) {
      const raw = String((repo && repo.refId) || '')
      emitReadDegraded(ctx, 'labels', 'labels:repo-ref', Date.now() - t0)
      return fail(ERROR_KIND.NOTFOUND, '修改标签颜色时未能确定这个工作区属于哪个 GitLab 项目（项目全路径形如 group/sub/project）。请先在面板中选定这个工作区对应的 GitLab 仓库，然后重试。', raw)
    }
    // 空的一批是合法的成功：什么都没要求改，就什么都没改。
    if (changes.length === 0) return { ok: true, data: { applied: [], failed: [] } }
    const results = await runWithLimit(changes, writeConcurrency(ctx), async (ch) => {
      try {
        return await applyOne(ctx, refId, ch)
      } catch (e) {
        return {
          ok: false,
          entry: {
            name: ch.name,
            reason: reason(ERROR_KIND.ENV, '修改「' + ch.name + '」的颜色时插件运行出错。这是插件运行环境的问题，不是你的操作有误；同一批中的其它标签仍会继续修改。', e),
          },
        }
      }
    })
    // 契约的记账结果就是「改成的」与「没改成的」两摞（applied 只留名与色、failed 留名与三段式原因），
    // 与 LabelColorBatchResult 一一对应。
    const applied: { name: string; color: string }[] = []
    const failed: { name: string; reason: TrackerError }[] = []
    for (const r of results) {
      if (!r) continue
      // 为什么不断言：成功项只带颜色、失败项只带原因（两边键本来就不一样），各推各的那一摞；推的还是原来那一项。
      if (r.ok) applied.push(r.entry as { name: string; color: string })
      else failed.push(r.entry as { name: string; reason: TrackerError })
    }
    return { ok: true, data: { applied: applied, failed: failed } }
  } catch (err) {
    // 判档只走本房唯一的出口（classifyGlabError）。
    return failGlab(err, '修改标签颜色时发生插件未能识别的错误。这是插件运行环境的问题，不是你的操作有误，请稍后重试。', err, ctx)
  }
}

export default { setLabelColors }
