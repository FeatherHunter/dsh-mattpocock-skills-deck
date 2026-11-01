// shared/version-control/src/diagnostics-commands.ts —— 域 13（诊断与底层命令）与 5.12（替换对象）的口径（#1761 T25）
//
// 这一片回答两件事，界面与宿主都只认这一份：
//   ① 十三条只读查询各自用哪条 git 命令、参数怎么校验、输出上限多少（13.2–13.13）；
//   ② 七个写动作（二分五步 + 替换对象两条）各自的 argv、参数白名单，以及判定三档与理由标识符。
//
// 为什么单独成一片、且零 import 自包含：shared 同层互相 import 会被依赖门禁拦下；这一片只放纯逻辑，
//   起进程、读文件、算哈希都在宿主（-C 钉仓库、固定前缀、字节上限、超时、报闸仍由宿主执行层统一给）。
//
// 为什么二分与替换对象要走「先预检拿票、再凭票执行」：它们会改仓库状态（.git/BISECT_* 与 refs/replace/*），
//   预检与用户点确认之间隔着几秒，这几秒仓库可能被终端改过；票据绑定现场摘要，执行前重算比对，
//   不一致就零进程拒绝。票据的通用形状与比对函数在 write-ticket.ts，本片只出「取哪一份字节」。
//
// 只读这一侧的纪律：参数一律白名单校验（空白、NUL、以 - 开头的值当场拒），绝不让客户端送来的字符串
//   变成 git 的选项；标准输入一律不用（宿主口径），patch-id / interpret-trailers 这类只吃标准输入的命令
//   因此不在这张表里 —— 补丁等价改用 git cherry，尾部行解析改用纯函数。

/** 十三条只读查询的 kind 名（与能力账本 13.2–13.13 一一对应；replace-list 是 5.12 的读侧）。 */
export const DIAGNOSTICS_READ_KINDS: string[] = ['bisect-status', 'grep', 'ls-files', 'cat-file', 'ls-tree', 'rev-parse', 'for-each-ref', 'is-ancestor', 'cherry', 'rev-list', 'apply-check', 'trailers', 'replace-list']

/** 七个写动作（13.1 二分五步、5.12 替换对象两条）。这是自包含的字面量清单，不进 WriteOp 联合类型：
 *  那些类型的判定分支与登记点属于另一个域的票据语义，硬塞进来会让七处登记各错一次。 */
export const DIAGNOSTICS_WRITE_OPS: string[] = ['bisect-start', 'bisect-bad', 'bisect-good', 'bisect-skip', 'bisect-reset', 'replace-create', 'replace-delete']

/** 预检回包契约名与版本：界面与门禁据此认「这是新的预检票据协议」，不是旧的 dryRun 回包。 */
export const DIAGNOSTICS_CHECK_CONTRACT = 'version-control.diagnostics-check'
export const DIAGNOSTICS_CHECK_VERSION = 1

/** 版本名白名单：不以 - 开头（防选项注入）、不含空白与 NUL、长度不超过 120。 */
const REV_PATTERN = /^(?!-)[^\s\u0000]{1,120}$/
/** 路径白名单：不以 - 开头、不含换行与 NUL、长度不超过 300。路径只作为 -- 之后的普通元素。 */
const PATH_PATTERN = /^(?!-)[^\u0000\r\n]{1,300}$/
/** 搜索关键词：允许任意可打印字符（用 -e 传入，不会被当成选项），但不许换行与 NUL。 */
const SEARCH_PATTERN = /^[^\u0000\r\n]{1,200}$/

/** 输出上限：大清单 8 MB、普通查询 2 MB、小结果与对象内容按需收紧。 */
const LIMIT_BIG = 8 * 1024 * 1024
const LIMIT_MID = 2 * 1024 * 1024
const LIMIT_SMALL = 1024 * 1024
const LIMIT_TINY = 4096
const LIMIT_MESSAGE = 256 * 1024
/** 13.12 的补丁文本上限：一次预演的补丁不该比一块改动大太多。 */
const PATCH_MAX = 256 * 1024

function bad(reason: string, message: string): { ok: false; reason: string; message: string } {
  return { ok: false, reason: reason, message: message }
}
function okPlan(plan: any): { ok: true; plan: any } { return { ok: true, plan: plan } }
function text(v: any): string { return v === undefined || v === null ? '' : String(v) }
function isRev(v: string): boolean { return REV_PATTERN.test(v) }
function isPath(v: string): boolean { return PATH_PATTERN.test(v) }
function pathList(v: any): { ok: true; paths: string[] } | { ok: false; reason: string; message: string } {
  if (v === undefined || v === null || v === '') return { ok: true, paths: [] }
  if (!Array.isArray(v)) return bad('bad-target', '路径清单必须是数组')
  const out: string[] = []
  for (let i: number = 0; i < v.length; i += 1) {
    const p: string = text(v[i])
    if (!isPath(p)) return bad('bad-target', '路径里含有空白、换行或以 - 开头的段，不能交给 git：' + p.slice(0, 80))
    out.push(p)
  }
  return { ok: true, paths: out }
}
function revField(params: any, key: string, fallback: string): { ok: true; value: string } | { ok: false; reason: string; message: string } {
  const v: string = text(params[key]).trim() === '' ? fallback : text(params[key]).trim()
  if (!isRev(v)) return bad('bad-target', '版本名不合法（不能以 - 开头，不能含空白）：' + v.slice(0, 80))
  return { ok: true, value: v }
}

/** 只读查询计划：返回 {kind, args, limit}（13.12 额外带回补丁原文，由宿主落临时文件预演）。
 *  args 里每个元素都是独立的字符串，拼命令时直接展开，绝不拼 shell 字符串。 */
export function diagnosticsReadPlanOf(kind: any, params: any): { ok: true; plan: any } | { ok: false; reason: string; message: string } {
  const k: string = text(kind)
  const p: any = params || {}
  if (DIAGNOSTICS_READ_KINDS.indexOf(k) < 0) return bad('bad-target', '不认识只读查询：' + k + '（允许：' + DIAGNOSTICS_READ_KINDS.join(' / ') + '）')
  if (k === 'bisect-status') return okPlan({ kind: k, args: ['bisect', 'log'], limit: LIMIT_MID })
  if (k === 'grep') {
    const pattern: string = text(p.pattern)
    if (!SEARCH_PATTERN.test(pattern)) return bad('bad-target', '搜索关键词是空的或含有换行/NUL，不能交给 git grep')
    const paths: any = pathList(p.paths)
    if (paths.ok !== true) return paths
    const args: string[] = ['grep', '-n', '-I', '--no-color', '-e', pattern]
    if (paths.paths.length > 0) args.push('--')
    for (let i: number = 0; i < paths.paths.length; i += 1) args.push(paths.paths[i])
    return okPlan({ kind: k, args: args, limit: LIMIT_MID })
  }
  if (k === 'ls-files') {
    const paths: any = pathList(p.paths)
    if (paths.ok !== true) return paths
    const args: string[] = ['ls-files', '-z']
    if (paths.paths.length > 0) args.push('--')
    for (let i: number = 0; i < paths.paths.length; i += 1) args.push(paths.paths[i])
    return okPlan({ kind: k, args: args, limit: LIMIT_BIG })
  }
  if (k === 'cat-file') {
    const object: any = revField(p, 'object', '')
    if (object.ok !== true) return object
    const mode: string = text(p.mode) === 'type' ? 'type' : 'pretty'
    return okPlan({ kind: k, mode: mode, object: object.value, args: ['cat-file', mode === 'type' ? '-t' : '-p', object.value], limit: LIMIT_MID })
  }
  if (k === 'ls-tree') {
    const rev: any = revField(p, 'rev', 'HEAD')
    if (rev.ok !== true) return rev
    return okPlan({ kind: k, rev: rev.value, args: ['ls-tree', '-l', rev.value], limit: LIMIT_MID })
  }
  if (k === 'rev-parse') {
    const rev: any = revField(p, 'rev', '')
    if (rev.ok !== true) return rev
    return okPlan({ kind: k, rev: rev.value, args: ['rev-parse', '--verify', rev.value], limit: LIMIT_TINY })
  }
  if (k === 'for-each-ref') {
    const prefix: string = text(p.prefix).trim()
    if (prefix !== '' && !isPath(prefix)) return bad('bad-target', '引用的命名空间不合法：' + prefix.slice(0, 80))
    const args: string[] = ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(subject)']
    if (prefix !== '') args.push(prefix)
    return okPlan({ kind: k, prefix: prefix, args: args, limit: LIMIT_MID })
  }
  if (k === 'is-ancestor') {
    const ancestor: any = revField(p, 'ancestor', '')
    if (ancestor.ok !== true) return ancestor
    const descendant: any = revField(p, 'descendant', '')
    if (descendant.ok !== true) return descendant
    return okPlan({ kind: k, ancestor: ancestor.value, descendant: descendant.value, args: ['merge-base', '--is-ancestor', ancestor.value, descendant.value], limit: LIMIT_TINY })
  }
  if (k === 'cherry') {
    const upstream: any = revField(p, 'upstream', '')
    if (upstream.ok !== true) return upstream
    const head: any = revField(p, 'head', '')
    if (head.ok !== true) return head
    return okPlan({ kind: k, upstream: upstream.value, head: head.value, args: ['cherry', '-v', upstream.value, head.value], limit: LIMIT_MID })
  }
  if (k === 'rev-list') {
    const mode: string = text(p.mode) === 'left-right' ? 'left-right' : 'count'
    const left: any = revField(p, 'left', '')
    if (left.ok !== true) return left
    const right: any = revField(p, 'right', '')
    if (right.ok !== true) return right
    const range: string = mode === 'left-right' ? left.value + '...' + right.value : left.value + '..' + right.value
    const args: string[] = mode === 'left-right' ? ['rev-list', '--left-right', '--count', range] : ['rev-list', '--count', range]
    return okPlan({ kind: k, mode: mode, left: left.value, right: right.value, args: args, limit: LIMIT_TINY })
  }
  if (k === 'apply-check') {
    const patch: string = text(p.patch)
    if (patch.trim() === '') return bad('bad-target', '补丁是空的：先把要预演的 diff 贴进来')
    if (patch.length > PATCH_MAX) return bad('bad-target', '补丁太大（超过 ' + PATCH_MAX + ' 字节）：只预演一次改动，不要整库搬')
    return okPlan({ kind: k, patch: patch, limit: LIMIT_MID })
  }
  if (k === 'trailers') {
    const object: any = revField(p, 'object', 'HEAD')
    if (object.ok !== true) return object
    return okPlan({ kind: k, object: object.value, args: ['log', '-1', '--format=%B', object.value], limit: LIMIT_MESSAGE })
  }
  return okPlan({ kind: k, args: ['replace', '-l'], limit: LIMIT_SMALL })
}

/** 写动作计划：只留下这个动作真正会用到的字段，并统一成字符串（空值就是空串）。
 *  执行层只按这张计划拼 argv，客户端再送一遍参数也不采信。 */
export function diagnosticsWritePlanOf(op: any, args: any): { ok: true; plan: any } | { ok: false; reason: string; message: string } {
  const a: any = args || {}
  const want: string = text(op)
  if (DIAGNOSTICS_WRITE_OPS.indexOf(want) < 0) return bad('bad-target', '不认识诊断写动作：' + want + '（允许：' + DIAGNOSTICS_WRITE_OPS.join(' / ') + '）')
  if (want === 'bisect-start') {
    const b: string = text(a.bad).trim()
    const g: string = text(a.good).trim()
    if (!isRev(b) || !isRev(g)) return bad('bad-target', '开始二分必须同时给坏提交与好提交，且两个值都要是合法的版本名')
    return okPlan({ op: want, bad: b, good: g })
  }
  if (want === 'bisect-bad' || want === 'bisect-good' || want === 'bisect-skip' || want === 'bisect-reset') return okPlan({ op: want })
  if (want === 'replace-create') {
    const from: string = text(a.from).trim()
    const to: string = text(a.to).trim()
    if (!isRev(from) || !isRev(to)) return bad('bad-target', '替换对象必须同时给被替换对象与被指向对象，两个值都要是合法的版本名')
    return okPlan({ op: want, from: from, to: to })
  }
  const object: string = text(a.object).trim()
  if (!isRev(object)) return bad('bad-target', '撤销替换要说清撤销哪个对象的替换')
  return okPlan({ op: want, object: object })
}

/** 按计划拼 argv：这里不判断业务语义，只把规范化过的字段逐个放进数组元素（每个元素独立，不经 shell）。 */
export function diagnosticsWriteArgvOf(plan: any): string[] {
  const p: any = plan || {}
  const op: string = text(p.op)
  if (op === 'bisect-start') return ['bisect', 'start', text(p.bad), text(p.good)]
  if (op === 'bisect-bad') return ['bisect', 'bad']
  if (op === 'bisect-good') return ['bisect', 'good']
  if (op === 'bisect-skip') return ['bisect', 'skip']
  if (op === 'bisect-reset') return ['bisect', 'reset']
  if (op === 'replace-create') return ['replace', text(p.from), text(p.to)]
  return ['replace', '-d', text(p.object)]
}

/** 把任意值写成稳定字符串：对象键排序、数组保序。预检与执行各算一遍再比相等，键顺序不同不算变。 */
export function diagnosticsStableValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t: string = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(diagnosticsStableValue).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + diagnosticsStableValue(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 计划这一格要哈希的字节：规范化后的计划整份。换了目标提交，摘要自然变，执行前比对判 target-changed。 */
export function diagnosticsPlanDigestInput(plan: any): string {
  return diagnosticsStableValue(plan || null)
}

/** 现场这一格要哈希的字节：二分是不是在进行、二分日志的重放记录、现有替换清单。
 *  这三样决定「凭这张票还能不能动」：有人先重置了二分、先撤了替换，再执行就会踩空。 */
export function diagnosticsSceneDigestInput(scene: any): string {
  const s: any = scene || {}
  return diagnosticsStableValue({
    active: s.active === true,
    log: text(s.log),
    replaces: Array.isArray(s.replaces) ? s.replaces.map(text) : [],
  })
}

/** 判定：allow / block 两档（warn 留给界面「说了也能做」的动作，本域没有）。
 *  facts 由宿主在预检时读出来：四个 oid 与当前二分状态、现有替换清单。 */
export function diagnosticsDecisionOf(op: any, plan: any, facts: any): { verdict: string; reasons: string[] } {
  const o: string = text(op)
  const f: any = facts || {}
  const allow: any = { verdict: 'allow', reasons: ['ok'] }
  const block: any = function (reason: string): any { return { verdict: 'block', reasons: [reason] } }
  if (o === 'bisect-start') {
    if (f.active === true) return block('already-bisecting')
    if (!f.badOid || !f.goodOid) return block('not-a-commit')
    if (String(f.badOid) === String(f.goodOid)) return block('same-object')
    return allow
  }
  if (o === 'bisect-bad' || o === 'bisect-good' || o === 'bisect-skip' || o === 'bisect-reset') {
    if (f.active !== true) return block('not-bisecting')
    return allow
  }
  if (o === 'replace-create') {
    if (!f.fromOid || !f.toOid) return block('not-a-commit')
    if (String(f.fromOid) === String(f.toOid)) return block('same-object')
    if (Array.isArray(f.replaces) && f.replaces.map(String).indexOf(String(f.fromOid)) >= 0) return block('already-replaced')
    return allow
  }
  if (o === 'replace-delete') {
    if (!f.objectOid) return block('not-a-commit')
    if (!Array.isArray(f.replaces) || f.replaces.map(String).indexOf(String(f.objectOid)) < 0) return block('no-replace')
    return allow
  }
  void plan
  return block('bad-target')
}

/** 哪些动作要弹确认卡：真正改仓库状态的四个；标坏 / 标好 / 跳过只是随手标记，工具就该一步一下。 */
export function diagnosticsConfirmRequiredOf(op: any): boolean {
  const o: string = text(op)
  return o === 'bisect-start' || o === 'bisect-reset' || o === 'replace-create' || o === 'replace-delete'
}

/** 确认卡要说清的动作与对象：界面按这个画四段（会动什么、不会动什么、可逆性与恢复路径、动词后果）。 */
export function diagnosticsConfirmOf(op: any, plan: any, facts: any): any {
  const o: string = text(op)
  const p: any = plan || {}
  const f: any = facts || {}
  if (o === 'bisect-start') return { kind: o, target: text(p.bad) + ' → ' + text(p.good), verb: '开始二分查找：把最近的好提交与坏提交记下来，之后每次标记都会换一个待验提交' }
  if (o === 'bisect-reset') return { kind: o, target: 'BISECT_HEAD', verb: '结束这趟二分：回到开始二分之前的分支与提交，二分记录没删' }
  if (o === 'replace-create') return { kind: o, target: text(p.from) + ' → ' + text(p.to), verb: '建立替换：之后所有命令看到 ' + text(p.from) + ' 时，读到的其实是被指向对象 ' + text(p.to) }
  return { kind: o, target: text(p.object), verb: '撤销替换：把 ' + text(p.object) + ' 的替换记录删掉，之后再看它回到它自己' }
}

/** 尾部行解析（13.13）：只认「最后一段连续的 键: 值 行」，每行一个 token。
 *  为什么不用 git interpret-trailers：它只吃标准输入或文件，宿主标准输入一律 ignore；
 *  这里做纯解析，读的是 git log -1 --format=%B 拿到的提交说明原文。 */
export function diagnosticsTrailersOf(message: any): any {
  const textLines: string[] = text(message).replace(/\r\n/g, '\n').split('\n')
  const trailers: any[] = []
  for (let i: number = textLines.length - 1; i >= 0; i -= 1) {
    const line: string = textLines[i]
    if (line.trim() === '' && trailers.length === 0) continue
    const m: any = /^([A-Za-z0-9-]+):[ \t]?(.*)$/.exec(line)
    if (!m) break
    trailers.unshift({ token: m[1], value: m[2] })
  }
  return { lines: textLines, trailers: trailers }
}

/** 二分日志解析（13.2）：把 git bisect log 的重放记录拆成好提交、坏提交与已标记的提交。
 *  不在二分中时 git 的原文是 error: We are not bisecting.，调用方按 active:false 处理，不当失败。 */
export function diagnosticsBisectStateOf(logText: any): any {
  const lines: string[] = text(logText).replace(/\r\n/g, '\n').split('\n')
  const bad: string[] = []
  const good: string[] = []
  let firstBad: string | null = null
  for (let i: number = 0; i < lines.length; i += 1) {
    const line: string = lines[i].trim()
    const mb: any = /^# bad: \[([0-9a-fA-F]+)\]/.exec(line)
    if (mb) { bad.push(mb[1]); continue }
    const mg: any = /^# good: \[([0-9a-fA-F]+)\]/.exec(line)
    if (mg) { good.push(mg[1]); continue }
    const mf: any = /^# first bad commit: \[([0-9a-fA-F]+)\]/.exec(line)
    if (mf) { firstBad = mf[1]; continue }
    const m0: any = /^git bisect (?:start '(?:[0-9a-fA-F]+)' )?'([0-9a-fA-F]+)'/.exec(line)
    if (m0) { bad.push(m0[1]) }
  }
  return { active: text(logText).trim() !== '', bad: bad, good: good, firstBad: firstBad, lines: lines }
}

/** 替换清单解析（5.12 读侧）：git replace -l 一行一个被替换对象的名字。 */
export function diagnosticsReplaceListOf(output: any): string[] {
  return text(output).split(/\r?\n/).map(function (s: string) { return s.trim() }).filter(function (s: string) { return s !== '' })
}

export const DIAGNOSTICS_COMMANDS_SOURCE = 'src/shared/version-control/src/diagnostics-commands.ts'
