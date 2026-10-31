/**
 * src/shared/version-control/src/conflict-text.ts —— 冲突文本的纯解析与拼装（#1747 T12，零依赖）
 *
 * 为什么单独一个文件：面板里的冲突视图与整份编辑（能力 6.7）要在界面闭包里算「这一块当前边是什么、
 * 对方边是什么、拼起来是什么」，而宿主预检与执行（保存前查残留标记、拦截带标记的提交）也要算同一件事。
 * 两处必须是同一套行号与同一套行尾口径，否则界面说第 3 行有标记、宿主说第 5 行，人就没法办。
 *
 * 本文件没有 import：它要被构建拼进界面闭包（scripts/build.mts 的 SHARED_SPLICE），也要被宿主直接 import。
 * 约定：
 *   1. 行号按 1 起数，与 git diff --check 的输出一致；
 *   2. 拼装保留每一行原有的行尾（CRLF 不会被改成 LF，文件不该因「在面板里点一下」就整份换行尾）；
 *   3. 残留标记的判据是「某一行以四种标记之一开头」——与 git diff --check 同口径，宁可多拦一次，
 *      也不让带冲突标记的内容进索引（能力 6.15 的拦截就靠这条判据）。
 */

/** 四种冲突标记：当前边开始、基准段（diff3 才有）、分隔线、对方边结束。 */
export const CONFLICT_MARKERS: string[] = ['<<<<<<<', '|||||||', '=======', '>>>>>>>']

/** 把整份文本切成「带行尾的行」：每行保留自己的换行符，最后一行可以没有换行符。 */
function conflictLinesOf(text: any): string[] {
  const s = String(text === undefined || text === null ? '' : text)
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\n', i)
    if (nl < 0) { out.push(s.slice(i)); break }
    out.push(s.slice(i, nl + 1))
    i = nl + 1
  }
  return out
}

/** 一行的内容（去掉行尾换行符），标记判断只看内容。 */
function conflictLineContentOf(line: string): string {
  let t = line
  if (t.length > 0 && t.charAt(t.length - 1) === '\n') t = t.slice(0, -1)
  if (t.length > 0 && t.charAt(t.length - 1) === '\r') t = t.slice(0, -1)
  return t
}

/** 这一行以哪个标记开头；不是标记行回 null。 */
function conflictMarkerOf(line: string): string | null {
  const c = conflictLineContentOf(line)
  for (let i = 0; i < CONFLICT_MARKERS.length; i += 1) {
    if (c.indexOf(CONFLICT_MARKERS[i]) === 0) return CONFLICT_MARKERS[i]
  }
  return null
}

/** 第一处残留标记（行号 + 标记种类）；没有回 null。保存前挡带标记的文本就靠它。 */
export function conflictMarkerLineOf(text: any): any {
  const lines = conflictLinesOf(text)
  for (let i = 0; i < lines.length; i += 1) {
    const m = conflictMarkerOf(lines[i])
    if (m !== null) return { line: i + 1, marker: m }
  }
  return null
}

/** 全部残留标记行（能力 6.15 的结果列表要用逐行清单，不只第一处）。 */
export function conflictMarkerLinesOf(text: any): any[] {
  const lines = conflictLinesOf(text)
  const out: any[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = conflictMarkerOf(lines[i])
    if (m !== null) out.push({ line: i + 1, marker: m })
  }
  return out
}

/** 冲突文件按文本处理还是按二进制处理：含 NUL 就当二进制（不显示逐块，只给整份选边）。 */
export function conflictTextKindOf(text: any): string {
  return String(text === undefined || text === null ? '' : text).indexOf('\u0000') >= 0 ? 'binary' : 'text'
}

/**
 * 把整份文本切成顺序片段：普通文本段与冲突块。
 * 冲突块解析失败一律回 {ok:false, reason}，不抛异常也不猜：残缺的标记行如果被当成普通文本，
 * 拼装出来就会丢内容，比直接拒绝更糟。
 */
export function conflictSegmentsOf(text: any): any {
  const lines = conflictLinesOf(text)
  const segments: any[] = []
  let pending: string[] = []
  let hunkCount = 0
  const flushText = function () {
    if (pending.length > 0) { segments.push({ kind: 'text', lines: pending }); pending = [] }
  }
  let i = 0
  while (i < lines.length) {
    const marker = conflictMarkerOf(lines[i])
    if (marker === '<<<<<<<') {
      flushText()
      const startLine = i + 1
      const ours: string[] = []
      const base: string[] = []
      const theirs: string[] = []
      let phase = 'ours'
      let ended = false
      i += 1
      while (i < lines.length) {
        const m = conflictMarkerOf(lines[i])
        if (m === '|||||||' && phase === 'ours') { phase = 'base'; i += 1; continue }
        if (m === '=======' && (phase === 'ours' || phase === 'base')) { phase = 'theirs'; i += 1; continue }
        if (m === '>>>>>>>' && phase === 'theirs') { ended = true; i += 1; break }
        if (m !== null) return { ok: false, reason: 'bad-markers' }
        if (phase === 'ours') ours.push(lines[i])
        else if (phase === 'base') base.push(lines[i])
        else theirs.push(lines[i])
        i += 1
      }
      if (!ended) return { ok: false, reason: 'unterminated-hunk' }
      segments.push({ kind: 'hunk', hunk: { index: hunkCount, startLine: startLine, oursLines: ours, baseLines: base.length > 0 ? base : null, theirsLines: theirs } })
      hunkCount += 1
    } else if (marker !== null) {
      return { ok: false, reason: 'bad-markers' }
    } else {
      pending.push(lines[i])
      i += 1
    }
  }
  flushText()
  return { ok: true, segments: segments, hunkCount: hunkCount }
}

/** 只要冲突块清单（界面逐块选择、预检统计块数用它）。 */
export function splitConflictHunks(text: any): any {
  const parsed = conflictSegmentsOf(text)
  if (parsed.ok !== true) return parsed
  const hunks: any[] = []
  for (let i = 0; i < parsed.segments.length; i += 1) {
    const seg = parsed.segments[i]
    if (seg.kind === 'hunk') hunks.push(seg.hunk)
  }
  if (hunks.length === 0) return { ok: false, reason: 'no-markers' }
  return { ok: true, hunks: hunks }
}

/**
 * 逐块选边拼出整份文本。choices 与块号一一对应，取值：
 *   'ours'（当前边）/ 'theirs'（对方边）/ 'both'（两边都要，当前在前）/ 'base'（基准段，diff3 才有）。
 * 有块没给选择就整份不拼（reason: 'missing-choice'）—— 悄悄用默认边等于替用户做决定。
 */
export function applyConflictChoices(text: any, choices: any): any {
  const parsed = conflictSegmentsOf(text)
  if (parsed.ok !== true) return parsed
  const list: any[] = Array.isArray(choices) ? choices : []
  if (list.length !== parsed.hunkCount) return { ok: false, reason: 'missing-choice' }
  const parts: string[] = []
  let hunkIndex = 0
  for (let i = 0; i < parsed.segments.length; i += 1) {
    const seg = parsed.segments[i]
    if (seg.kind === 'text') { parts.push(seg.lines.join('')); continue }
    const choice = String(list[hunkIndex] === undefined || list[hunkIndex] === null ? '' : list[hunkIndex])
    hunkIndex += 1
    if (choice === 'ours') parts.push(seg.hunk.oursLines.join(''))
    else if (choice === 'theirs') parts.push(seg.hunk.theirsLines.join(''))
    else if (choice === 'both') parts.push(seg.hunk.oursLines.join('') + seg.hunk.theirsLines.join(''))
    else if (choice === 'base') parts.push(seg.hunk.baseLines === null ? '' : seg.hunk.baseLines.join(''))
    else return { ok: false, reason: 'bad-choice' }
  }
  return { ok: true, text: parts.join('') }
}

/**
 * 整份编辑保存前的检查（能力 6.7）：先扫残留标记再谈大小。
 * 回 null 表示可以保存；否则回 {reason, line?, marker?}：conflict-markers 带行号，text-too-large 不带。
 */
export function conflictTextProblem(text: any, maxLen: any): any {
  if (typeof text !== 'string') return { reason: 'bad-text' }
  const limit = (typeof maxLen === 'number' && isFinite(maxLen) && maxLen > 0) ? maxLen : 1048576
  if (text.length > limit) return { reason: 'text-too-large', length: text.length, limit: limit }
  const marker = conflictMarkerLineOf(text)
  if (marker !== null) return { reason: 'conflict-markers', line: marker.line, marker: marker.marker }
  return null
}

export const CONFLICT_TEXT_SOURCE = 'src/shared/version-control/src/conflict-text.ts'
