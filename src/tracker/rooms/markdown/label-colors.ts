// label-colors.js —— 工作区里那份本地配色文件（docs/agents/label-colors.yaml）的读写与放置。
// 以后谁改它：改配色文件的位置、形状、默认内容、写入方式（原子写与串行化）、放置时机的人。
// 另外三半各自住一个文件：内置默认色表在 label-colors-palette.js，票面上色在 label-colors-paint.js，
// 文本与形状互转在 label-colors-codec.js（调核，#1012）；
// 契约那两条操作（列出标签 / 批量改色）在 label-colors-ops.js。
//
// 这份文件是「本地 Markdown 后端的标签颜色从哪来」的唯一真源（#618）：YAML 里的键值对就是标签与颜色，
// 用户可以直接手改它，插件只写这一个文件（新路径 .yaml；老 .json 只做兼容读，读到就迁走）。
// 旧的那张 docs/agents/triage-labels.md 调色盘表已经不再读
// （按「干净切断」的口径：不做迁移、也不回填）。
//
// 文件形状（#1012 起是 YAML，注释由程序生成；键是标签名原样，值是颜色）：
//   version: 1
//   wayfinder:map: 8b5cf6
//   bug: d73a4a
//   还没配色的: ''
//   值是颜色：不带井号的六位十六进制，大小写都收，读进来统一成小写；
//   空串表示「这个标签还没配颜色」（界面按灰显示）。想给某个标签写一句含义说明时，
//   把值写成 {"color": "8b5cf6", "description": "地图票"} 也可以，读的时候两种写法都认。
//
// 为什么写入要串行化、要有原子发布、读不出来就不许写（三条硬要求，出处见 src/host/tracker/contract.js
// 的 setLabelColors 注释）：
//   同一个工作区可能开着两个会话，两边同时保存时「读—改—写」会交错，后写的那份把先写的那份整轮改动
//   无声抹掉（保存成功、颜色却没变，最难查）；配色文件又是用户会手改、会提交进版本库的文件，
//   写一半崩掉就会留下半截内容；读不出来（被占用、写坏了）时若照常覆盖，用户手写的内容就被推平了。
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext, SandboxFs } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import { debugOn, guardEmit } from '../../kernel/log-emit.js'
import { decodeLabelsText, encodeLabelsTable } from './label-colors-codec.js'
import { readTextFile } from './read.js'
import { publishTextFile } from './write.js'
import { getPlat } from './issues-locate.js'
import { builtinColorObject } from './label-colors-palette.js'
// 单写者队列与工作区钥匙：与建票取号、写票文件共用同一份实现（#922），不在这里另写一份。
import { withWorkspaceWriter, workspaceDirOf, workspaceWriteKey } from './write-queue.js'

/** 配色文件在工作区里的相对位置（工作区根 = 本次调用上下文里的 cwd）。 */
export const LABEL_COLORS_REL_PATH = 'docs/agents/label-colors.yaml'
/** 老配色文件的位置：只做兼容读，读到就迁进新文件，写成功后删掉它。 */
export const LABEL_COLORS_LEGACY_REL_PATH = 'docs/agents/label-colors.json'

// ── 路径与文件服务 ─────────────────────────────────────────────────────────────

// 写路上要把宿主算好的本次会话政策往下传（publishAtomically 里读 ctx.sandboxPolicy）：
// OpContext 本没有这个键，用交叉类型收（键可选，不传也不影响）；只改类型视野，不改运行时。
type CtxWithPolicy = OpContext & { sandboxPolicy?: unknown }

// 读配色文件的结果：成功与失败用 ok 的字面量区分（不用 boolean），调用方 `if (!read.ok)`
// 窄化之后才能读 error 或 colors/raw——宽成 boolean 两边都读不到（ops 曾因此多处报错）。
export interface LabelColorsReadOk {
  ok: true
  colors: Record<string, string>
  raw: Record<string, unknown>
  present: boolean
  from: string
  readonly: boolean
}
export interface LabelColorsReadFail {
  ok: false
  error: { kind: string; message: string; raw: string }
}
export type LabelColorsRead = LabelColorsReadOk | LabelColorsReadFail

function getFs(ctx: OpContext): SandboxFs | null {
  if (ctx && ctx.platform && ctx.platform.fs) return ctx.platform.fs
  if (ctx && ctx.fs) return ctx.fs
  if (ctx && typeof ctx.get === 'function') { try { const f = ctx.get('fs'); if (f) return f } catch (e) {} }
  return null
}

// 工作区目录（workspaceDirOf）与工作区钥匙都住在 write-queue.js：
// 算文件路径与算队列钥匙必须得到同一个答案，不各写一份。

/** 配色文件的完整路径。 */
export function labelColorsPath(ctx: CtxWithPolicy, repo?: RepositoryRef | null): string {
  return getPlat(ctx).join(workspaceDirOf(ctx, repo), LABEL_COLORS_REL_PATH)
}

/** 老配色文件的完整路径（只做兼容读与迁移删除）。 */
export function legacyLabelColorsPath(ctx: CtxWithPolicy, repo?: RepositoryRef | null): string {
  return getPlat(ctx).join(workspaceDirOf(ctx, repo), LABEL_COLORS_LEGACY_REL_PATH)
}

/** 工作区键散列（日志只记散列，不记路径原文）。 */
function hash8(s: unknown): string {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/** 写入记常驻：用户点一次保存才发生一次，低频、轻量，始终落盘。
 *  这层壳与「调试开关开着吗」那一问都在 `kernel/log-emit.ts` 一份（#1182 第 3 件）。 */
function logWrite(ctx: CtxWithPolicy, fields: Record<string, unknown>): void {
  guardEmit(ctx, (c) => { c.logEvent('info', 'labelColors.write', fields) })
}

/** 读取记按需：界面渲染与列标签都会读它，属高频路径，只在调试开关打开时才记。
 *  按纪律必须在同一行先判开关：关着的时候连字段对象都不组装（build 函数根本不会被调用）。 */
function logRead(ctx: CtxWithPolicy, build: () => Record<string, unknown>): void {
  guardEmit(ctx, (c) => { c.logEvent('debug', 'labelColors.read', build()) }, () => debugOn(ctx))
}

// ── 读 ────────────────────────────────────────────────────────────────────────

/** 「读不出来」这一档：工作区里配色文件存在但读不出来。
 *  按契约归解析档（parse），文案要说清是读不出来、以及插件不会覆盖用户自己写的内容。
 *  句子骨架（四档共用）：先说读不出来（+原因），再说这个文件不会被覆盖，最后说用户要做什么；
 *  detail 是「这次到底读到了什么」的一句大白话，并进正文末尾的括号里，不单独成句。 */
function readFailure(why: string, action: string, detail: string, raw: unknown): LabelColorsReadFail {
  // 第四段是原文：读这个文件时抛上来的那个错误本身（或译码失败时的那份文件内容）。
  // 提示语里只放一句「错误原文 …」的摘要，完整原文放在 raw 里，人展开就能看到全貌。
  return failAs(ERROR_KIND.PARSE,
    '工作区里的标签配色文件（' + LABEL_COLORS_REL_PATH + '）没有读出标签颜色。原因：' + why +
      '。这个文件不会被覆盖，你写的内容还在。' + action + (detail ? '（' + detail + '）' : ''),
    raw === undefined ? '' : raw)
}

/** 写失败的统一出口：档位与话术来自 describeWriteFailure，原文是写过程抛上来的那个错误。
 *  提示语里照旧不许出现临时文件名（用户会照着去找一个并不存在的文件），原文只放在 raw 里。 */
function writeFailure(e: unknown): LabelColorsReadFail {
  const d = describeWriteFailure(e, LABEL_COLORS_REL_PATH)
  return failAs(d.kind, d.message, e)
}

/** 「文件确实不在」的判据：只有它才允许按「还没有这份文件」处理。
 *  为什么定得这么窄：其余任何读探测失败（权限、被占用、位置被换成目录、磁盘故障）都不能证明文件不存在，
 *  照「没有这份文件」处理的话，下一步的放置就会用默认 11 色把用户手写的内容整份覆盖掉——那是真实的数据丢失
 *  （审查实测：让 lstat/stat/readText 全失败而写成功，旧写法确实覆盖了用户原文）。
 *  两种环境各有一种「不在」的写法：DSH 文件服务给 `FS_NOT_FOUND`（消息里是 `not found`），
 *  Node 那套文件系统给 `ENOENT`。
 *  这一条判据对「文件」与「目录」是同一套：列标签时 `issues/` 目录不存在也按「这个地图还没有票」处理。 */
export function isMissingFile(e: unknown): boolean {
  // e 的形状不一（各文件服务抛的不一样）：经 Record 视图读码值；`e &&` 短路与原式逐字相同。
  const er = e as Record<string, unknown>
  const code = String((e && (er.code || (er.cause && (er.cause as Record<string, unknown>).code))) || '')
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return true
  const msg = String((e && er.message) || e || '')
  return /ENOENT|FS_NOT_FOUND/i.test(msg) || /cannot read .*: not found/i.test(msg)
}

/** 读配色文件。
 *  返回 {ok:true, colors, raw, present, from, readonly} 或 {ok:false, error}。
 *    colors —— 标签名 → 颜色（不带井号的小写六位；空串 = 文件里写了但还没配颜色，或写了个不合法的颜色）
 *    raw    —— 文件里原本的标签表（保存时按它合并：用户写的含义说明与写法都保留；版本号不进这里）
 *    present—— 文件确确实实不在（只有明确的「不在」才是 false；读不出来是另一档，见下）
 *    from   —— 这次读到的是新文件（yaml）还是老文件（json）；present 为 false 时是 'none'
 *    readonly —— 文件版本比核认识的新：可以展示，不许写（写入口据此拒绝，防止旧版本抹掉新字段）
 *  新老并存时以新为准；只有老文件时照读（由放置与保存迁走，见 ensureLabelColors）。
 *  不存在与读不出来是两件事：不存在不算错（新工作区还没建过这份文件，用内置默认色就够，也可以放置一份）；
 *  读不出来（权限、被占用、位置被换成目录、内容不合法）一律 {ok:false}，调用方据此拒绝写入。
 *  文本到形状的翻译在 label-colors-codec.js（调核），这里只管按路径拿文本、分新老、记日志。
 *  没有文件服务时按「文件确确实实不在」处理：这与本房间既有的读辅助件（readDir 返回空表、exists 返回 false）
 *  是同一套约定，契约测试也是在没有文件服务的上下文里调这个后端的。 */
export async function readLabelColors(ctx: CtxWithPolicy, repo?: RepositoryRef | null): Promise<LabelColorsRead> {
  const path = labelColorsPath(ctx, repo)
  const legacyPath = legacyLabelColorsPath(ctx, repo)
  const where = () => hash8(workspaceWriteKey(ctx, repo))
  if (!getFs(ctx)) {
    logRead(ctx, () => ({ cwdHash: where(), present: false, count: 0, ok: true }))
    return { ok: true, colors: {}, raw: {}, present: false, from: 'none', readonly: false }
  }
  // 先读新文件：只有「确实不在」才去读老文件；新文件在但读动作出错，不拿老文件顶（会掩盖这次的错）。
  let yamlText: string | null = null
  let yamlError: unknown = null
  try { yamlText = await readTextFile(ctx, path) } catch (e) {
    if (isMissingFile(e)) yamlText = null
    else yamlError = e
  }
  if (yamlError !== null) {
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: 'read-fail' }))
    // 这一档只接「读这个动作本身出错」（明确的「文件不在」在上一支就走开了），所以不列举「可能是文件不在」
    // 这类不成立的猜测；也不把责任写成用户的动作——只如实说插件没读到，再给出两条能查的方向。
    return readFailure(
      '插件按这个位置去读，读这个文件这一步出错了（不是文件里的内容不合法）。可能是当前账号读不到它，也可能是它正被别的程序占用；插件分不出是哪一种',
      '请检查这个文件当前账号能不能读取、有没有别的程序正打开着它，然后重新保存。',
      '错误原文 ' + String((yamlError && (yamlError as Record<string, unknown>).message) || yamlError).slice(0, 120), yamlError)
  }
  if (typeof yamlText === 'string') return finishLabelsRead(ctx, where, yamlText, 'yaml')
  // 新文件确实不在：读老文件（兼容；读到就由放置与保存迁走）。
  let jsonText: string | null = null
  try { jsonText = await readTextFile(ctx, legacyPath) } catch (e) {
    if (isMissingFile(e)) {
      logRead(ctx, () => ({ cwdHash: where(), present: false, count: 0, ok: true }))
      return { ok: true, colors: {}, raw: {}, present: false, from: 'none', readonly: false }
    }
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: 'read-fail' }))
    return readFailure(
      '插件按这个位置去读，读这个文件这一步出错了（不是文件里的内容不合法）。可能是当前账号读不到它，也可能是它正被别的程序占用；插件分不出是哪一种',
      '请检查这个文件当前账号能不能读取、有没有别的程序正打开着它，然后重新保存。',
      '错误原文 ' + String((e && (e as Record<string, unknown>).message) || e).slice(0, 120), e)
  }
  return finishLabelsRead(ctx, where, jsonText, 'json')
}

/** 文本读到之后：翻译、记日志、装成房间形状。from 告诉调用方这次读的是哪个文件。 */
function finishLabelsRead(ctx: CtxWithPolicy, where: () => string, text: string, from: string): LabelColorsRead {
  const decoded = decodeLabelsText(text)
  if (!decoded.ok) {
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: decoded.reason }))
    // 原文 = 这次读到的文件内容本身（译码判据是拿它判的，人复核也只能看它）。
    return readFailure(decoded.why, decoded.action, decoded.detail, rawJson({ reason: decoded.reason, text: text }))
  }
  logRead(ctx, () => ({ cwdHash: where(), present: true, count: Object.keys(decoded.colors).length, ok: true }))
  return { ok: true, colors: decoded.colors, raw: decoded.raw, present: true, from, readonly: decoded.readonly }
}

// ── 写 ────────────────────────────────────────────────────────────────────────

/** 默认文件内容（YAML 文本）：内置默认的那些标签，颜色按内置表预填。
 *  形状与用户手写的形状一致（键是标签名、值是颜色），方便人直接看懂、直接改。 */
export function defaultLabelColorsText(): string {
  const made = encodeLabelsTable(defaultLabelColors())
  return made.ok ? made.text : ''
}

// 单写者队列住在 write-queue.js（withWorkspaceWriter）：同一个工作区的读—改—写排成一条链，
// 后来的调用等前一条做完再做（写法照 src/host/logStore.js 的单写者刷盘）。
// 为什么必须有：两个会话同时保存时交错执行会丢整轮改动（见文件头）。

/** 原子发布：先把完整内容写进同目录的临时文件，再把它改名成目标文件。
 *  为什么要临时文件＋改名：这份文件是用户会手改、会提交进版本库、而且是「整份一次性覆盖」的文件，
 *  直接往目标上写，写一半崩掉就会把用户的内容留成半截。
 *  为什么还要有「没有改名原语」的那条退路：DSH 的文件服务只给了 writeText / editText 两个写方法，
 *  没有改名原语（读它的实现可以看到：它自己的 writeText 就是「同目录暂存文件 + 改名」发布的，
 *  见 dsh-fs-local 的 writeFileAtomic），所以真实宿主里走的是这条退路——一次调用写完整份内容，
 *  同样是整份替换、不会留下半截文件。两条路都写完整份内容，都不做「边算边往目标上写」。
 *  #1182 起这份实现搬到了 write.js 的 publishTextFile，票文件那一族与这里共用同一份：
 *  同一件事两处各写一遍，迟早只剩一处是对的（配色那份是门禁 `tests/verify-markdown-label-colors.ts`
 *  逐条走到的，票文件那份由 `tests/verify-1182-ticket-file-publish.ts` 走到）。 */
async function publishAtomically(ctx: CtxWithPolicy, targetPath: string, text: string): Promise<string> {
  // 本次调用的政策由宿主按当前会话算好放在上下文里（见 src/host/workspaceCwd.js 的 resolveSandboxPolicy）。
  // 这里原样往下传（publishTextFile 会读 ctx.sandboxPolicy），不自己填模式：会话是只读时就该被 DSH 拒掉。
  return publishTextFile(ctx, targetPath, text)
}

/** 写失败分档住 label-colors-errors.js（调用时把文件位置递进去，房间内部不转圈引用）。
 *  下面是原子发布、放置与写入口。 */
import { describeWriteFailure } from './label-colors-errors.js'
import { failAs, rawJson } from './error-fail.js'

/** 放置配色文件（幂等）。两条路都走它：① 用户为工作区选定后端时；② 首次打开改色弹窗时。
 *  硬要求：文件已经存在时一个字都不改——先读一次，能读到就原样返回，绝不覆盖用户改过的内容。
 *  读不出来（不是「确确实实不在」）时也不动它，并如实报错：那种情况下我们并不知道文件里有什么，
 *  照默认内容写一遍就等于把用户手写的东西整份抹掉。
 *  只有老文件时顺手迁进新文件（写法与说明都保留），写成功后删老文件——下次读到的就是新文件。
 *  返回 {ok:true, placed, reason} 或 {ok:false, error}。placed=true 表示这次真的新建或迁移了一份。 */
export async function ensureLabelColors(ctx: CtxWithPolicy, repo?: RepositoryRef | null): Promise<{ ok: true; placed: boolean; reason: string; from?: string } | LabelColorsReadOk | LabelColorsReadFail> {
  return await withWorkspaceWriter(ctx, repo, async () => {
    const read = await readLabelColors(ctx, repo)
    if (!read.ok) {
      // 读不出来就不动它（也不覆盖），并且留痕：调用方与日志都要能看见「这次放置没做成、原因是读不出来」。
      logWrite(ctx, { cwdHash: hash8(workspaceWriteKey(ctx, repo)), count: 0, ok: false, reason: 'refused-read-fail' })
      return read
    }
    if (read.present) {
      // 新版本只读文件不动它：版本号比核认识的新，迁移也不许抹字段，等用户升级插件。
      if (read.from === 'json' && read.readonly !== true) {
        try {
          await publishLabelColors(ctx, repo, read.raw, 'migrated')
        } catch (e) {
          // 原文 = 迁移这次写失败抛上来的错误；提示语里不许出现临时文件名。
          return writeFailure(e)
        }
        if (!(await removeLegacyLabelsFile(ctx, repo))) {
          logWrite(ctx, { cwdHash: hash8(workspaceWriteKey(ctx, repo)), count: Object.keys(read.colors).length, ok: true, reason: 'migrate-legacy-kept' })
        }
        return { ok: true, placed: true, reason: 'migrated', from: 'yaml' }
      }
      return { ok: true, placed: false, reason: 'exists', from: read.from || 'yaml' }
    }
    try {
      await publishLabelColors(ctx, repo, defaultLabelColors(), 'placed')
    } catch (e) {
      // 原文 = 放置这份默认文件时写失败抛上来的错误；提示语里不许出现临时文件名。
      return writeFailure(e)
    }
    // #1174：这一趟是**新建**，本来没有文件，所以不回 `from`。契约写着 `from` 是「它原先是什么格式，
    // 只在文件本来就在时有值」；以前这里无论新建还是迁移都回 `'yaml'`，读的人分不清
    // 「文件早就在那儿，是 yaml」与「这次刚建的」——排查时会以为工作区里原本就有一份配色文件。
    return { ok: true, placed: true, reason: 'created' }
  })
}

/** 删老文件（迁移成功后顺手做）：删不掉返回 false，调用方记一条日志，主流程不受影响。 */
async function removeLegacyLabelsFile(ctx: CtxWithPolicy, repo?: RepositoryRef | null): Promise<boolean> {
  try {
    const fs = getFs(ctx)
    if (!fs || typeof fs.rm !== 'function') return false
    await fs.rm(getPlat(ctx).join(workspaceDirOf(ctx, repo), LABEL_COLORS_LEGACY_REL_PATH), { force: true })
    return true
  } catch (e) {
    return isMissingFile(e)
  }
}

/** 默认文件内容里那份「标签 → 颜色」对象（表与颜色都来自 label-colors-palette.js 注入的那份表）。 */
function defaultLabelColors(): Record<string, string> {
  return builtinColorObject()
}

/** 把一份新的标签 → 颜色对象发布进文件（整份覆盖，原子写，YAML 格式），写成功后记一条常驻日志。
 *  保存成功后回读比对（研究 #614 §3.3 点名要做的事）：只写不校验的话，被别的进程覆盖或这次写其实
 *  没落盘时，用户会看到「保存成功、颜色却没变」而没有任何线索。回读不一致就如实报错，不静默当成功。
 *  写成功后顺手删老文件（删不掉只记一条日志，主流程不受影响）。
 *  返回 'rename' 或 'write-text'（走了哪条发布路径，给日志与门禁用）；失败抛错，由调用方分档。 */
export async function publishLabelColors(ctx: CtxWithPolicy, repo: RepositoryRef | null | undefined, next: Record<string, unknown>, reason: string): Promise<string> {
  const made = encodeLabelsTable(next)
  if (!made.ok) {
    // 拼装失败：挂一个标记让下面的 catch 认出来（已记过日志，不记第二次）；cast 只为挂标记，行为不变。
    const err = new Error(made.message) as Error & { encodeFailed?: boolean }
    err.encodeFailed = true
    logWrite(ctx, { cwdHash: hash8(workspaceWriteKey(ctx, repo)), count: 0, ok: false, reason: 'write-fail' })
    throw err
  }
  const text = made.text
  const key = workspaceWriteKey(ctx, repo)
  const count = Object.keys(next).length
  let via = ''
  try {
    via = await publishAtomically(ctx, labelColorsPath(ctx, repo), text)
    const back = await readTextFile(ctx, labelColorsPath(ctx, repo))
    if (String(back) !== text) {
      // 回读不一致：挂标记让 describeWriteFailure 走专属档位（见 label-colors-errors.js）；cast 只为挂标记。
      const err = new Error('label-colors read-back mismatch') as Error & { readBackMismatch?: boolean }
      err.readBackMismatch = true
      throw err
    }
    if (!(await removeLegacyLabelsFile(ctx, repo))) {
      logWrite(ctx, { cwdHash: hash8(key), count: count, ok: true, reason: 'migrate-legacy-kept' })
    }
  } catch (e) {
    // 拼装失败那支上面已经记过日志，直接透出去，不记第二次。
    if (e && (e as { encodeFailed?: unknown }).encodeFailed === true) throw e
    logWrite(ctx, { cwdHash: hash8(key), count: count, ok: false, reason: 'write-fail' })
    throw e
  }
  const loggedReason = reason === 'placed' ? 'placed' : (reason === 'migrated' ? 'migrated' : 'saved')
  logWrite(ctx, { cwdHash: hash8(key), count: count, ok: true, reason: loggedReason, via: via })
  return via
}

/** 同一个工作区的读—改—写排队执行（单写者队列）。导出给契约操作那两条用。
 *  钥匙按工作区归一（见 write-queue.js 的 workspaceWriteKey）：同一个工作区的不同写法必须排同一条队。 */
export function withLabelColorsWriter<T>(ctx: CtxWithPolicy, repo: RepositoryRef | null | undefined, work: () => Promise<T>): Promise<T> {
  return withWorkspaceWriter(ctx, repo, work)
}


export default { LABEL_COLORS_REL_PATH, LABEL_COLORS_LEGACY_REL_PATH, labelColorsPath, legacyLabelColorsPath, readLabelColors, ensureLabelColors, publishLabelColors, describeWriteFailure, isMissingFile, withLabelColorsWriter, defaultLabelColorsText }

