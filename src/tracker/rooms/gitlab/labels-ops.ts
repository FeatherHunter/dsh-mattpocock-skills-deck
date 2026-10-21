/**
 * src/tracker/rooms/gitlab/labels-ops.ts —— 标签配色契约里那两条操作在 GitLab 房间的实现。
 *
 * 契约（正文见 `src/tracker/contract/operations.ts:216-232`，返回形状见 `contract/results.ts`）：
 *   listLabels(repo, ctx)                → {ok:true, data: LabelColor[]}，每条只有 name / color / 可选 description
 *   setLabelColors(repo, changes, ctx)   → {ok:true, data: {applied, failed}}，逐条记账
 * 两条的共同规矩：颜色统一是不带井号的六位小写十六进制；入参里每一条改动必须恰好出现在
 * applied 或 failed 之一；列标签取不全时必须整体失败，不许把残缺清单当全量发出去。
 *
 * ── 这一房为什么不实现 ensureLabelColorsFile ──────────────────────────────────
 * 契约里第三条 `ensureLabelColorsFile`（`operations.ts:261-276`）承诺的不只是「工作区里有一份文件」，
 * 还有「那份文件改了算数」。GitLab 的标签颜色真源是仓库标签本身（存在 GitLab 服务端），
 * 工作区里那份文件没有任何读者 —— 读颜色走 `listLabels`、改颜色走 `setLabelColors`，
 * 界面入口是仓库标签页。放一份改了不计数的文件只会误导人，所以这一条按「形态不合」处理：
 * 本文件不实现它，GitLab 后端对它回 `unsupported`，登记表由 Lead 那边统一改
 * （GitHub 房出于同一个理由也是这么定的，逐条理由见 `docs/tracker/capability-github.md`）。
 *
 * ── 颜色约束：2026-10-14 查 GitLab 官方文档核实过（不要凭印象改）─────────────
 * 出处：官方 API 文档「Project labels API」（https://docs.gitlab.com/api/labels/）与
 * 它的源文件 doc/api/labels.md（https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/labels.md）。
 * 一、**颜色不是任意字符串，也不是只能从预定义色板里挑**：`color` 取「带前导井号的六位十六进制」
 *     （文档原话是 6-digit hex notation with leading '#' sign，例如 `#FFAABB`），
 *     或者一个 CSS 颜色名（文档指向 MDN 的 Color keywords）。也就是说十六进制值本身不受限，
 *     任意的六位十六进制都收，但要带井号。**CSS 颜色名这一路本文件不产出也不接受**：
 *     契约的 `LabelColor.color` 只认不带井号的六位小写十六进制（`contract/entities.ts:187-200`），
 *     没有地方放「一个颜色名」，所以读侧遇到名字时按契约给空串（＝这个标签的颜色读不出来），
 *     写侧只发十六进制 —— 用户要的是「把颜色改掉」，发十六进制一样能改掉，不受影响。
 *     `/labels` 列表与更新接口的回包把颜色写成带井号的形式（文档示例里是 `"color" : "#d9534f"`），
 *     所以读侧必须先去井号再判合法性，不能拿回包原文当契约色值直接交出去。
 * 二、**`text_color` 写不了，只能读**：`POST /projects/:id/labels`、`PUT /projects/:id/labels/:label_id`
 *     与 `PUT /projects/:id/labels` 三张参数表里都**没有** `text_color` 这一项
 *     （能写的是 color / new_name / description / priority / archived），
 *     而列表回包里它存在（示例里是 `"text_color" : "#FFFFFF"`）。所以「不能自己指定」这一半是
 *     文档支持的结论。**另一半如实写「未核实」**：文档没有用文字说明它按什么规则算出来，
 *     所以**未核实**「按颜色亮度自动取深色或浅色」那条常说的规则，也**未核实**它有没有别的影响因素。
 *     落到实现上：契约的 `LabelColor` 只有 name / color / description 三格，`text_color` 无处可放，
 *     本文件原样丢弃它，不做任何映射 —— 这是形状定死的，不是欠账。
 *     另一个同族的未核实点：文档没写「同一个十六进制值在各 GitLab 版本上算出的 text_color 是否恒定」，
 *     所以本文件不许回读颜色当成功证据（见下面 applied 的口径）。
 * 三、**更新的路径**：`PUT /projects/:id/labels/:label_id` 是现行接口；`PUT /projects/:id/labels`
 *     带 `name` 或 `label_id` 参数的是文档明写的旧接口（deprecated，但今天仍可用）。本文件只用现行接口，
 *     因为旧接口是文档挂了牌的弃用路径（旧接口被删时这里会跟着坏），而项目路径里放编码过的标签名
 *     不需要额外处理 —— GitLab 的路径参数本来就按「URL 编码后的那一整个值」去匹配标签名。
 *     标签名里的冒号与空格都算在标签名里，编码交给 URL 那一层，本文件不自己做字符串拼接。
 * 四、`description` 与 `priority` 是另两个可写参数：本文件**只改颜色**，一个都不碰
 *     （契约的入参只有 name 与 color 两格，别处没有地方放它们）。
 * 五、**列表只列项目自己的标签，不列上层分组的标签**（2026-10-15 照官方文档核实）：
 *     官方文档「List all project labels」的属性表原文是
 *     「| `include_ancestor_groups` | boolean | no  | Include ancestor groups. Defaults to `true`. |」
 *     （https://docs.gitlab.com/api/labels/）—— 也就是说**默认就会把上层分组的标签一起列出来**。
 *     而改色走的 `PUT /projects/:id/labels/:label_id` 只认项目自己的标签，分组标签在这条路径上改不了色
 *     （远端回 404）。契约对 listLabels 的定义是「这个后端**能改色**的全部标签」
 *     （`contract/contract-label-colors.ts:60`），所以列表请求上必须显式写 `include_ancestor_groups=false`，
 *     否则界面上会多出一批「看着能改、一按保存就失败」的假标签（详见 listLabels 里那段注释）。
 *
 * ── 与任务单上那份「GitLab 侧的实情」不一致的三处（照文档写，不照印象写）─────────
 *   · 任务单写「每项有 color，形如 "d9534f"，**不带 #**」：官方文档的列表示例是带井号的
 *     （`"color" : "#d9534f"`）。读侧照「带不带井号都收」实现，两种回包都能吃下。
 *   · 任务单写「color（不带 #）」：官方文档的写入参数要求**带**前导井号，所以本文件发出去的是
 *     `#` + 归一色，而不是裸六位。这一条要是按任务单那样发裸色，远端会拒。
 *   · 任务单写「REST `PUT /projects/:id/labels`，参数 name + new_name」：那条接口文档已经挂了
 *     deprecated 的牌子，本文件改走 `PUT /projects/:id/labels/:label_id`（见上面第三条），
 *     参数只有 `color`，不发 `new_name`。
 * 还有一处是任务单**没有**说、但落地时必须定的：翻页判据。任务单给的是「某一页返回条数 < per_page
 * 就是最后一页」，本文件照它实现（官方文档确认 `per_page` 上限 100、按请求值截断当前页）。
 *
 * ── 本房的几条硬规矩（照 GitHub 房同族实现的口径）─────────────────────────────
 *  · 失败一律经 `fail(...)` / `failGlab(...)` 构造，携带原文（raw 必填），不抛给调用方。
 *  · 读路径每一条「没读成」的分支，在失败或「拿不全」之前必须落一行 `read.degraded`
 *    （出口是 ./read-log.ts 的 emitReadDegraded），reason 只取那文件里已登记的值。
 *  · 房间内不用 ctx.logEvent 直接记日志（read-log.ts 那一处出口除外）。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { LabelColor, LabelColorChange, RepositoryRef } from '../../contract/entities.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { OpResult, TrackerError, LabelColorBatchResult } from '../../contract/results.js'
import { normalizeColor } from '../../../shared/label-color/src/colors.js'
import { fail } from '../../kernel/preflight.js'
import { execGlab } from './client.js'
import { classifyGlabError, failGlab } from './errors.js'
import { emitReadDegraded } from './read-log.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
import { PAGINATION } from '../pagination.js'

// ── 常量：本文件与门禁都读它们，改一处就能一起变 ──────────────────────────────

/** 一次向 GitLab 要多少条标签。官方文档：`per_page` 默认 20、**上限 100**。 */
export const LABEL_LIST_PER_PAGE = PAGINATION.gitlab.labelListPerPage

/**
 * 列标签最多翻多少页。
 *
 * 为什么要有这道闸：翻页循环靠回包判下一跳，回包异常（远端一直回满页、或链接头一直说有下一页）
 * 时循环会停不下来，把一趟只读的界面请求变成对远端的持续轰击。到顶就如实失败，
 * 而不是把手上这一批当全量交出去 —— 后者正是契约点名不许做的「静默返回残缺列表」。
 * 100 页 × 每页 100 条 = 10000 条，比真实仓库的标签数高三个数量级，正常仓库碰不到它。
 */
export const LABEL_LIST_MAX_PAGES = PAGINATION.gitlab.labelListMaxPages

/** 同时最多发几个改色请求。GitLab 没有单请求限速建议，默认与 GitHub 房同档。 */
export const WRITE_CONCURRENCY_MAX = PAGINATION.gitlab.labelWriteConcurrencyMax
export const WRITE_CONCURRENCY_DEFAULT = PAGINATION.gitlab.labelWriteConcurrencyDefault

/** 单次 glab 调用的超时（毫秒）。与同房其余读路径一致。 */

// ── 入参把关 ──────────────────────────────────────────────────────────────────

/**
 * 从仓库引用里取「项目全路径」（形如 `group/sub/project`）。
 *
 * 为什么只认 refId：契约的 `RepositoryRef`（`contract/entities.ts:163-177`）里，
 * GitLab 那一家的稳定标识就是这份全路径，`name` 只是给人看的显示名 —— 拿显示名去问接口
 * 会在仓库改名后指向别的东西，那比失败更糟。形状不对（空串、含空白、不是字符串）一律
 * 当作「没有可用目标」，连进程都不起。
 *
 * 这里**不**像 GitHub 房那样做三层兜底自己解析一次 owner/name：GitLab 的仓库身份是从
 * 「用户选定后端」那一步来的，本房没有那种兜底的既有实现，凭空造一个会把失败说成成功。
 */
function repoRefOf(repo: RepositoryRef | null | undefined): string {
  const raw = repo && typeof repo.refId === 'string' ? repo.refId.trim() : ''
  if (!raw) return ''
  // 含空白的全路径不可能是 GitLab 的项目路径：这一条判的是「形状不对」，不是「可能对但这次没试成」。
  if (/\s/.test(raw)) return ''
  return raw
}

/**
 * 改色入参的形状把关：不是一批改动就整条失败（落解析档）。
 * 单条的颜色写错不算入参坏掉：那一条落解析档，其余照改。
 *
 * 重名判定按**原样名字**（去首尾空白后逐字比较），不折叠大小写 —— 这一处**与 GitHub 房不同**。
 * GitHub 那一家写这条时给出的理由是「GitHub 认名字时不区分大小写、首尾空格也不算数」；
 * 本房**没有核实过 GitLab 是同一套规则**（官方 API 文档那一页不提标签名的大小写语义），
 * 所以不照抄那个折叠：折叠错了会把「两个只差大小写的标签」误判成「同一个标签写了两次」，
 * 整条拒掉一次本来能做成的改动；而不折叠错了只是多发一条请求，结果由远端逐条裁决 ——
 * 两边的代价不对称，选错得轻的那一边。名字两边只有空白差别的那一类（`"bug"` 与 `" bug "`）
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
    // 交给远端的那一份仍然是用户写的那串原文（见 applyOne：路径用 encodeURIComponent(ch.name)）。
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
 * 任意错误值 → 可读的一小段文字（给「人家说了什么」那一格用，不当作判档依据）。
 *
 * 按顺序认三种输入：① 直接就是字符串；② 带 message 的对象（Error 与本仓 `fail()` 的返回）；
 * ③ 本房客户端 `execGlab` 的进程结果 `{stdout, stderr, code}` —— 它没有 message 字段，
 * 真正有用的原文在 stderr（glab 的报错都写在那儿），stderr 空时退回 stdout。
 * 其余对象一律转成 JSON。
 *
 * **绝不用 `String()` 兜底**：对象过 `String()` 得到的是 `[object Object]`，而这段话会被拼进
 * 直接显示给用户的提示语里 —— 「（glab 返回的说明：[object Object]）」等于开了口却什么都没说，
 * 排查的人拿不到任何线索。这是本条注释存在的原因，改回 `String()` 就等于把这个坑重新挖开。
 */
function errText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err !== null && typeof err === 'object') {
    const bag = err as Record<string, unknown>
    if (typeof bag.message === 'string' && bag.message) return bag.message
    if (typeof bag.stderr === 'string' && bag.stderr.trim()) return bag.stderr
    if (typeof bag.stdout === 'string' && bag.stdout.trim()) return bag.stdout
    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json
    } catch (e) {
      // 循环引用的对象 JSON 化会抛。这里只是想把原文打出来，不该因为「打不出来」让整条操作崩掉，
      // 所以吞掉异常、落到下面那句如实的兜底。
    }
    return '（原始输出无法转成文字）'
  }
  return String(err)
}

/**
 * 列标签/改色失败时的对外一句话：`nativeMessage + 一段原文摘要`。
 *
 * 为什么原文摘要只截一小段：`fail()` 的第三段（raw）里放的是完整原文，界面上人展开就能看全；
 * 这一句是直接显示在提示语里的，太长的进程输出会把正文淹掉。
 */
function withRawHint(nativeMessage: string, err: unknown): string {
  const text = errText(err).trim().replace(/\s+/g, ' ')
  if (!text) return nativeMessage
  const hint = text.length > 160 ? text.slice(0, 160) + '…（已截断）' : text
  return nativeMessage + '（glab 返回的说明：' + hint + '）'
}

/**
 * 逐条失败的理由（契约里 applied/failed 的 reason 就是失败形状 TrackerError）。
 *
 * 为什么走 `fail()` 而不是自己拼对象：失败形状只有一处构造，原文的合并、遮蔽、头尾截断都归它；
 * 这里只把契约要的那三段取出来。**第三段一定交「出了错的那个东西」本身**（这一次调用的进程结果），
 * 不要先 String() 成一句话再交 —— 那样原文会变成 `[object Object]`，界面上展开看不到任何证据。
 * 为什么不是 `failGlab()`：逐条失败要的是一句按档位写清「这一条改没改成」的话，
 * 而 `failGlab` 会把兜底档与 unsupported 档换成全仓统一的那两句提示、丢掉这一条的上下文；
 * 判档那一步仍然只走 `classifyGlabError` 一个出口（见 kindOf），这里不自己判第二遍。
 */
function reason(kind: ErrorKind, message: string, raw: unknown): TrackerError {
  return fail(kind, message, raw).error
}

/** 一次 glab 调用没跑成时的档位：一律走本房唯一的判档出口，本文件不自己写正则判第二遍。 */
function kindOf(err: unknown, ctx: OpContext): ErrorKind {
  return classifyGlabError(err, ctx).kind
}

// ── 列标签 ───────────────────────────────────────────────────────────────────

/**
 * 列出这个仓库的全部标签与颜色（契约操作 listLabels）。
 * 「全部」＝仓库标签全量（含还没被任何票用到的）；取不全就整体失败，不返回残缺清单。
 */
export async function listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>> {
  const t0 = Date.now()
  const refId = repoRefOf(repo)
  if (!refId) {
    // 原文段交的是调用方给进来的那个仓库标识：这是当场能证明「没有可用目标」的那个值。
    // 连进程都没起，这一步就是这一趟读没读成的原因。
    const raw = String((repo && repo.refId) || '')
    emitReadDegraded(ctx, 'labels', 'labels:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND, '未能获取全部标签：这个工作区没有可用的 GitLab 项目标识（形如 group/sub/project），因此无法向 GitLab 查询标签。请先在面板中选定这个工作区对应的 GitLab 仓库，然后重试。', raw)
  }
  const all: LabelColor[] = []
  let page = 1
  // 合同要求「翻页拉到底，中途任何一页失败就整体失败」，所以循环体里任何一条失败分支都是直接 return，
  // 手上已经拿到的那些页在失败时全部丢掉 —— 它们就是「残缺清单」，交出去就是契约点名的那个错误。
  for (;;) {
    // 页码从 1 起（官方文档：`page` 默认 1）；per_page 顶到官方上限 100，少翻几趟。
    // 为什么要写 include_ancestor_groups=false：官方文档「List all project labels」的属性表原文是
    //   「| `include_ancestor_groups` | boolean | no  | Include ancestor groups. Defaults to `true`. |」
    //   （https://docs.gitlab.com/api/labels/，2026-10-15 照官方文档核实），即**不写它就默认带上上层分组的标签**。
    // 而改色走 `PUT /projects/:id/labels/:label_id`，那个接口只认项目自己的标签 —— 分组标签改不了色（远端回 404）。
    // 契约对 listLabels 的定义是「这个后端**能改色**的全部标签」（`contract/contract-label-colors.ts:60`），
    // 带上分组标签就是一份**超集**：界面会把这些标签当成可编辑的，用户一按保存就失败，而本房给出的提示是
    // 「请核对标签名与项目全路径」—— 名字与路径其实都是对的，人照着这句话核对只会白费劲。
    // 显式关掉继承之后，列表里的每一条都能经由 setLabelColors 改色，两条操作才对得上。
    const res = await execGlab(ctx, [
      'api',
      'projects/' + encodeURIComponent(refId) + '/labels?per_page=' + String(LABEL_LIST_PER_PAGE) + '&page=' + String(page) + '&include_ancestor_groups=false',
    ], { timeout: GITLAB_READ_TIMEOUT_MS })
    if (res.code !== 0) {
      // 这一档是「房间这层没拿到任何回包」，原文是这一次 glab 调用的完整进程结果。
      emitReadDegraded(ctx, 'labels', 'labels:transport', Date.now() - t0)
      return failGlab(res, '未能获取全部标签：' + withRawHint('向 GitLab 查询标签时命令没有跑成。这是插件运行环境的问题，不是你的操作有误。这次没有拿到任何标签，请稍后重试。', res.stderr || res.stdout || errText(res)), res, ctx)
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    // 为什么标成 unknown：回包是 glab 回的任意形状，数组检查通过前不敢当数组用；检查通过后 Array.isArray 会收窄。
    let arr: unknown = null
    try { arr = JSON.parse(text) } catch {
      // 原文交的是这一趟 glab 的完整产出（不是解析失败那句话）：人自己就能看出回包里到底是什么。
      emitReadDegraded(ctx, 'labels', 'labels:json', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：插件没有读懂 GitLab 助手（glab）返回的内容。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
    }
    if (!Array.isArray(arr)) {
      emitReadDegraded(ctx, 'labels', 'labels:shape', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：GitLab 返回的标签清单不是插件预期的形状。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
    }
    // 为什么断言：上面刚验过它是数组；断言只为让 TS 认这件事实，交出去还是原来那个数组，运行时不变。
    const rows = arr as unknown[]
    for (const row of rows) {
      // 单条形状不合格就当这一趟没读成：列表项只有 name/color/description 三个键，
      // 没有位置能表示「这一条被丢掉了」，静默跳过就会变成用户眼里的「标签凭空少了一个」。
      const item = toLabelColor(row)
      if (!item) {
        emitReadDegraded(ctx, 'labels', 'labels:shape', Date.now() - t0)
        return fail(ERROR_KIND.ENV, '未能获取全部标签：GitLab 返回的标签清单里有一条缺少标签名，插件无法确认这份清单是否完整。这是插件运行环境的问题，不是你的操作有误。请稍后重试。', text)
      }
      all.push(item)
    }
    // 下一页的判据：**这一页的条数 < per_page 就是最后一页**（官方文档按请求的 per_page 截断当前页，
    // 所以只有最后一页会短）。这是任务单点名的口径，也是这家的常规读法。
    //   为什么不用「某页回空表」当唯一哨兵：那样标签总数正好是 per_page 的整数倍时会白翻一页
    //   （多一次出站请求）。两个判据在真实数据上等价，取少花一次请求的那个。
    //   为什么不判响应头里的 rel="next"：官方「Pagination response headers」一节写明，结果超过
    //   10000 条时远端不再返回 x-total、x-total-pages 与 rel="last" 这几个格子；那份清单里并没有
    //   rel="next"，本机也没有真机可核它在那种情况下的行为，所以不拿它当依据。真正决定性的理由是
    //   契约的 `ExecResult`（`contract/contexts.ts:58-71`）里根本没有 headers 这一格，
    //   本房读不到它，也就无从判起。
    if (rows.length < LABEL_LIST_PER_PAGE) break
    // 每多翻一页都要有上限兜底，见 LABEL_LIST_MAX_PAGES 的说明。
    if (page >= LABEL_LIST_MAX_PAGES) {
      emitReadDegraded(ctx, 'labels', 'labels:partial', Date.now() - t0)
      return fail(ERROR_KIND.ENV, '未能获取全部标签：这个仓库的标签数量超过了插件一次能读取的上限（' + String(LABEL_LIST_MAX_PAGES * LABEL_LIST_PER_PAGE) + ' 条），无法确认是否读全。请先在 GitLab 的仓库页面里整理不再需要的标签，然后重试。', text)
    }
    page += 1
  }
  return { ok: true, data: all }
}

/**
 * 一条 GitLab 回的标签 → 契约的列表项。只保留三个键，描述给不了就整个键省掉（给空串也一样算「给不了」）。
 *
 * 颜色这一格必须过 `normalizeColor`：GitLab 回包里是带井号的（文档示例 `"color" : "#d9534f"`），
 * 而契约要求不带井号的六位小写十六进制。归一化正好做「去井号、转小写」两件事，
 * 所以写不出「用户看到大写色值」这种不一致。给不出颜色（空、缺字段、不是合法六位）时写空串 ——
 * 契约说空串是「这个标签还没配颜色」，那是**空值**，不是失败：整条操作仍然成功。
 */
function toLabelColor(raw: unknown): LabelColor | null {
  const bag = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!bag || typeof bag.name !== 'string' || !bag.name) return null
  // 为什么先定死契约再补可选键：字面量起手类型里没有 description，后面再补会报缺成员。
  const item: LabelColor = { name: bag.name, color: normalizeColor(bag.color) || '' }
  if (typeof bag.description === 'string' && bag.description.trim() !== '') item.description = bag.description
  return item
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
 * 发出去的是 `PUT /projects/:id/labels/:label_id`，参数只有 `color` 一个：
 * 不带 `new_name`（改名不是这件事）、不带 `description`（会覆盖用户写的说明）、不建标签、不删标签。
 * 颜色按官方文档要求补上井号（见文件头「颜色约束」第一条）。
 */
async function applyOne(ctx: OpContext, refId: string, ch: LabelColorChange, labelId: string): Promise<{ ok: boolean; entry: { name: string; color?: string; reason?: TrackerError } }> {
  const want = normalizeColor(ch.color)
  if (!want) {
    // 这条是本插件自己先拦下来的：颜色还没送到 GitLab 就被判为不合格，所以没有任何后端原文可交，
    // 第三段如实给空串（不能把用户自己填的颜色当成「原始说明」回显，那是假的出处）。
    return { ok: false, entry: { name: ch.name, reason: reason(ERROR_KIND.PARSE, '「' + ch.name + '」的新颜色不正确：请改为不带井号的六位十六进制，例如 9d7cd8。', '') } }
  }
  const res = await execGlab(ctx, [
    'api',
    'projects/' + encodeURIComponent(refId) + '/labels/' + labelId,
    '--method', 'PUT',
    '-f', 'color=#' + want,
  ], { timeout: GITLAB_READ_TIMEOUT_MS })
  if (res.code === 0) {
    // applied 里放的是**这次写下去的目标颜色**，不是回读值（契约 results.ts:150-151 明写）。
    // 所以这里不解析回包 —— 回包解码失败也不该把一条已经成功的写入记成失败（那是漏记账）。
    return { ok: true, entry: { name: ch.name, color: want } }
  }
  return { ok: false, entry: { name: ch.name, reason: explainWriteFailure(res, ch, ctx) } }
}

/**
 * 一条改动没改成时，它该落契约八档里的哪一档、对用户说什么。
 *
 * 判档只走本房唯一的出口（`classifyGlabError`），这里只负责把同一档换成一句有上下文的话。
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
 * 入参里每一条改动必须恰好落在 applied 或 failed 之一 —— 这靠两件事保证：
 *   ① 每条都返回一个结果（applyOne 的两个分支都带 entry）；
 *   ② 每条外面还包一层兜底 catch：某一条上冒出意外异常时只把这一条记成失败，其余照跑。
 *      不这么写的话，异常会冒到外面那个整批 catch，已经改好的标签一条都不记账。
 */
export async function setLabelColors(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext): Promise<OpResult<LabelColorBatchResult>> {
  const t0 = Date.now()
  try {
    const bad = changesProblem(changes)
    // 入参不合格时手里还没有任何外部原文，原文就交那份不合格的改动清单本身。
    if (bad) return fail(ERROR_KIND.PARSE, bad, changes)
    const refId = repoRefOf(repo)
    if (!refId) {
      const raw = String((repo && repo.refId) || '')
      emitReadDegraded(ctx, 'labels', 'labels:repo-ref', Date.now() - t0)
      return fail(ERROR_KIND.NOTFOUND, '修改标签颜色时未能确定这个工作区属于哪个 GitLab 项目（项目全路径形如 group/sub/project）。请先在面板中选定这个工作区对应的 GitLab 仓库，然后重试。', raw)
    }
    // 空的一批是合法的成功：什么都没要求改，就什么都没改。
    if (changes.length === 0) return { ok: true, data: { applied: [], failed: [] } }
    // 为什么把标签名编码放在这里、逐条共用：改色要按名字寻址，名字里的冒号与空格都算在名字里，
    // 不编码就拼进路径会被当成路径分隔符或查询串起点，请求会打到别的端点上去。
    const labelId = (name: string): string => encodeURIComponent(name)
    const results = await runWithLimit(changes, writeConcurrency(ctx), async (ch) => {
      try {
        return await applyOne(ctx, refId, ch, labelId(ch.name))
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

export default { listLabels, setLabelColors }
