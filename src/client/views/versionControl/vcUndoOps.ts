/**
 * src/client/views/versionControl/vcUndoOps.ts —— 变基待办页历史改写五条动作的数据层（#1748 T13）
 *
 * 这一层只做「把界面上填的东西整理成能打电话的参数」与「把宿主回包翻成界面状态」：
 * 不画界面、不拼中文文案（文案全在 config/copy/vcundo.yaml 的词表里）、也不猜结果。
 * 客户端不许 import src/shared，所以上限常量与拒绝理由标识符在这里照写一份，由门禁与共享层逐条比对。
 *
 * 约定（改了会坏的地方）：
 *   1) 五条动作的页面归属不在这里抄第二份：page / name / command / 主入口一律运行期从能力账本读
 *      （vcCapabilityOf），账本才是唯一数据源；本文件只记「这条动作要哪些输入、哪条危险」。
 *   2) 预检与执行的入参形状必须与宿主 versionControlUndoCheck.ts / versionControlUndoWrite.ts 逐字对上：
 *      多一个字段、少一个字段都会让宿主拒票，门禁 C 组逐条比对。
 *   3) 本地校验只挡「明显填错」，不替代宿主判定：填对但仓库做不了（没提交、中途操作、目标不存在）
 *      由宿主回稳定 reason，界面照 reason 显示，不在这里提前编理由。
 */

declare const vcCapabilityOf: any

/** 宿主两条电话的方法名（与 versionControlUndoMount.ts 注册的名字一致）。 */
export const VC_UNDO_PHONE_CHECK: string = 'wf.gitUndoCheck'
export const VC_UNDO_PHONE_WRITE: string = 'wf.gitUndoWrite'
/** 与共享层 undo-ops.ts 同值：一条拣选最多 50 个提交、说明最长 200、引用最长 200。 */
export const VC_UNDO_COMMIT_MAX: number = 50
export const VC_UNDO_MESSAGE_MAX: number = 200
export const VC_UNDO_REV_MAX: number = 200

/** 五条动作的输入需求表：capId 与账本 5.1–5.5 一一对应，其余字段是界面提示与本地预检用的。 */
export const VC_UNDO_CATALOG: any[] = [
  { kind: 'reset-soft', capId: '5.1', needsTarget: true, needsMessage: false, needsCommits: false, targetDefault: 'HEAD~1', danger: false, recovery: false, nameKey: 'vc.undo.op.resetSoft' },
  { kind: 'reset-mixed', capId: '5.2', needsTarget: true, needsMessage: false, needsCommits: false, targetDefault: 'HEAD~1', danger: false, recovery: false, nameKey: 'vc.undo.op.resetMixed' },
  { kind: 'reset-hard', capId: '5.3', needsTarget: true, needsMessage: false, needsCommits: false, targetDefault: '', danger: true, recovery: true, nameKey: 'vc.undo.op.resetHard' },
  { kind: 'revert', capId: '5.4', needsTarget: true, needsMessage: true, needsCommits: false, targetDefault: '', danger: false, recovery: false, nameKey: 'vc.undo.op.revert' },
  { kind: 'cherry-pick', capId: '5.5', needsTarget: false, needsMessage: false, needsCommits: true, targetDefault: '', danger: false, recovery: false, nameKey: 'vc.undo.op.cherryPick' },
]

/** 界面要能显示「这条动作在哪一页、账本原文怎么写」，所以每条都补上账本字段。 */
export function vcUndoCatalogOf(): any[] {
  const out: any[] = []
  for (let i = 0; i < VC_UNDO_CATALOG.length; i += 1) {
    const def: any = VC_UNDO_CATALOG[i]
    const cap: any = typeof vcCapabilityOf === 'function' ? vcCapabilityOf(def.capId) : null
    out.push({
      kind: def.kind, capId: def.capId, nameKey: def.nameKey,
      needsTarget: def.needsTarget === true, needsMessage: def.needsMessage === true, needsCommits: def.needsCommits === true,
      targetDefault: String(def.targetDefault || ''), danger: def.danger === true, recovery: def.recovery === true,
      page: cap ? String(cap.page || '') : '', name: cap ? String(cap.name || '') : '',
      command: cap ? String(cap.command || '') : '', primaryEntry: cap ? String(cap.primaryEntry || '') : '',
      onThisPage: !!cap && String(cap.page || '') === 'rebase',
    })
  }
  return out
}

/** 按动作名取目录项；找不到回 null（界面不许猜一条动作出来）。 */
export function vcUndoEntryOf(kind: string): any {
  const all: any[] = vcUndoCatalogOf()
  for (let i = 0; i < all.length; i += 1) if (all[i].kind === String(kind)) return all[i]
  return null
}

/** 界面输入初值：默认停在 5.1（撤销上一条提交、改动回到已暂存），目标按它的既定默认值预填。 */
export function vcUndoInputsOf(): any {
  return { op: 'reset-soft', target: 'HEAD~1', message: '', commits: '' }
}

/** 改一个输入字段（只认 string；界面传什么就存什么，校验留给 vcUndoParamsOf）。 */
export function vcUndoSetInputOf(inputs: any, field: string, value: any): any {
  const next: any = {}
  const src: any = inputs || vcUndoInputsOf()
  const keys: string[] = ['op', 'target', 'message', 'commits']
  for (let i = 0; i < keys.length; i += 1) next[keys[i]] = String(src[keys[i]] === undefined || src[keys[i]] === null ? '' : src[keys[i]])
  next[String(field)] = String(value === undefined || value === null ? '' : value)
  return next
}

/** 切换动作时把目标预填成该动作的既定默认值（用户在目标里填过东西就不覆盖，免得白填）。 */
export function vcUndoPickOpOf(inputs: any, kind: string): any {
  const entry: any = vcUndoEntryOf(kind)
  if (!entry) return Object.assign({}, vcUndoInputsOf(), { op: String(kind) })
  const src: any = inputs || vcUndoInputsOf()
  const next: any = vcUndoSetInputOf(src, 'op', entry.kind)
  if (String(src.target || '') === '' || String(src.target) === String(VC_UNDO_CATALOG_TARGET_DEFAULT_OF(src.op))) next.target = entry.targetDefault
  return next
}

/** 上一条动作的默认目标值（切动作时用来判断「目标里是不是还留着默认值、可以换掉」）。 */
function VC_UNDO_CATALOG_TARGET_DEFAULT_OF(kind: string): string {
  const entry: any = vcUndoEntryOf(kind)
  return entry ? String(entry.targetDefault || '') : ''
}

/** 引用形状：与共享层 undoRevProblem 同一条口径（禁空白/NUL、禁前导减号、禁双点、禁冒号与反斜杠）。 */
export function vcUndoRevProblem(rev: any): string | null {
  const text: string = String(rev === undefined || rev === null ? '' : rev).trim()
  if (text === '') return 'required'
  if (text.length > VC_UNDO_REV_MAX) return 'too-long'
  if (/[\s\u0000]/.test(text)) return 'bad-shape'
  if (text.charAt(0) === '-') return 'bad-shape'
  if (text.indexOf('..') >= 0) return 'bad-shape'
  if (text.indexOf(':') >= 0) return 'bad-shape'
  if (text.indexOf('\\') >= 0) return 'bad-shape'
  return null
}

/** 拣选清单解析：换行文本或数组都收，trim 去空行，保序（git 按给出次序逐个拣选，排序会改结果）。 */
export function vcUndoCommitsOf(input: any): any {
  let raw: string[] = []
  if (Object.prototype.toString.call(input) === '[object Array]') {
    const arr: any[] = input as any[]
    for (let i = 0; i < arr.length; i += 1) raw.push(String(arr[i] === undefined || arr[i] === null ? '' : arr[i]))
  } else {
    const text: string = String(input === undefined || input === null ? '' : input).replace(/\r/g, '')
    raw = text.split('\n')
  }
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const one: string = raw[i].trim()
    if (one !== '') out.push(one)
  }
  if (out.length === 0) return { ok: false, reason: 'commits-empty', index: 0, field: 'commits' }
  if (out.length > VC_UNDO_COMMIT_MAX) return { ok: false, reason: 'commits-too-many', index: 0, field: 'commits' }
  for (let i = 0; i < out.length; i += 1) {
    if (vcUndoRevProblem(out[i]) !== null) return { ok: false, reason: 'commits-invalid', index: i + 1, field: 'commits' }
    for (let j = 0; j < i; j += 1) if (out[j] === out[i]) return { ok: false, reason: 'commits-duplicate', index: i + 1, field: 'commits' }
  }
  return { ok: true, commits: out }
}

/**
 * 把界面输入整理成预检/执行共用的参数。成功回 {ok:true,params}；失败回 {ok:false,reason,field,index}，
 * reason 与共享层 undoPlanOf 的拒绝理由同名，界面照它查词表。
 */
export function vcUndoParamsOf(inputs: any): any {
  const src: any = inputs || vcUndoInputsOf()
  const entry: any = vcUndoEntryOf(String(src.op === undefined || src.op === null ? '' : src.op))
  if (!entry) return { ok: false, reason: 'unknown-op', field: 'op', index: 0 }
  const params: any = { op: entry.kind, target: '', message: '', commits: [] }
  if (entry.needsTarget === true) {
    const target: string = String(src.target === undefined || src.target === null ? '' : src.target).trim()
    if (target === '') return { ok: false, reason: 'required-target', field: 'target', index: 0 }
    const problem: string | null = vcUndoRevProblem(target)
    if (problem === 'too-long') return { ok: false, reason: 'bad-target', field: 'target', index: 0 }
    if (problem !== null) return { ok: false, reason: problem === 'required' ? 'required-target' : 'bad-target', field: 'target', index: 0 }
    params.target = target
  }
  if (entry.needsMessage === true) {
    const message: string = String(src.message === undefined || src.message === null ? '' : src.message)
    if (message.length > VC_UNDO_MESSAGE_MAX) return { ok: false, reason: 'message-too-long', field: 'message', index: 0 }
    params.message = message
  }
  if (entry.needsCommits === true) {
    const picked: any = vcUndoCommitsOf(src.commits)
    if (picked.ok !== true) return { ok: false, reason: picked.reason, field: 'commits', index: picked.index }
    params.commits = picked.commits
  }
  return { ok: true, params: params }
}

/** 预检电话的入参：{cwd,op,target,message,commits}（commit 清单在预检里是引用原文）。 */
export function vcUndoCheckArgsOf(inputs: any, cwd: string): any {
  const built: any = vcUndoParamsOf(inputs)
  if (built.ok !== true) return built
  const p: any = built.params
  const args: any = { cwd: String(cwd || ''), op: p.op, target: p.target, message: p.message, commits: p.commits }
  return { ok: true, args: args }
}

/** 执行电话的入参：多带票号与 requestId（重放靠它去重，界面每次确认新生成一个）。 */
export function vcUndoWriteArgsOf(inputs: any, cwd: string, ticketId: string, requestId: string): any {
  const built: any = vcUndoCheckArgsOf(inputs, cwd)
  if (built.ok !== true) return built
  const args: any = built.args
  args.ticketId = String(ticketId || '')
  args.requestId = String(requestId || '')
  return { ok: true, args: args }
}

/** 预检回包形状：票据、场景、计划、步骤缺一不可（缺了就当形状不对，不猜）。 */
export function vcUndoCheckShapeOk(reply: any): boolean {
  if (!reply || reply.ok !== true) return false
  if (String(reply.contract || '') !== 'version-control.undo-check') return false
  if (Number(reply.version) !== 1) return false
  if (!reply.ticket || typeof reply.ticket.id !== 'string' || reply.ticket.id === '') return false
  if (!reply.plan || typeof reply.plan !== 'object') return false
  if (!reply.scene || typeof reply.scene !== 'object') return false
  if (typeof reply.danger !== 'boolean') return false
  if (Object.prototype.toString.call(reply.steps) !== '[object Array]') return false
  return true
}

/** 执行回包形状：动作、前后 HEAD、执行了几步必须都在。 */
export function vcUndoWriteShapeOk(reply: any): boolean {
  if (!reply || reply.ok !== true) return false
  if (String(reply.op || '') === '') return false
  if (!reply.after || typeof reply.after.headOid !== 'string') return false
  if (!reply.before || typeof reply.before.headOid !== 'string') return false
  if (typeof reply.stepsDone !== 'number') return false
  return true
}

/** 界面状态新值：一次预检一张票；预检成功进「待确认」，执行成功进「完成」。 */
export function vcUndoStateNew(): any {
  return { phase: 'idle', seq: 0, inputs: vcUndoInputsOf(), check: null, result: null, error: null, requestId: '' }
}

/** 发起一次调用：序号加一，记下在做什么；旧回包靠序号丢掉（迟到不许改写新状态）。 */
export function vcUndoMark(state: any, phase: string): any {
  const src: any = state || vcUndoStateNew()
  return { phase: String(phase), seq: Number(src.seq || 0) + 1, inputs: src.inputs || vcUndoInputsOf(), check: src.check || null, result: src.result || null, error: null, requestId: String(src.requestId || '') }
}

/** 失败归一：{key,reason,detail,field}。key 直接是词表键的后半段（vc.undo.fail.<key>）。 */
export function vcUndoErrorOf(reply: any, fallback: string): any {
  const r: any = reply || {}
  const err: any = r.error || {}
  const detail: string = String(err.message || r.message || '')
  const reason: string = String(err.reason || '')
  if (reason !== '') return { key: reason, reason: reason, detail: detail, field: String(r.field || '') }
  const kind: string = String(err.kind || '')
  if (kind === 'env' || kind === 'parse' || kind === 'exit' || kind === 'not-repo') return { key: 'git', reason: kind, detail: detail, field: String(r.field || '') }
  return { key: String(fallback || 'git'), reason: kind, detail: detail, field: String(r.field || '') }
}

/** 预检回包落到状态里：成功进 ready 并留下票据与计划；失败进 failed 并保住旧结果（不静默清空）。 */
export function vcUndoApplyCheck(state: any, seq: number, reply: any): any {
  const src: any = state || vcUndoStateNew()
  if (Number(seq) < Number(src.seq || 0)) return src
  if (vcUndoCheckShapeOk(reply)) {
    return { phase: 'ready', seq: Number(seq), inputs: src.inputs, check: reply, result: src.result || null, error: null, requestId: String(src.requestId || '') }
  }
  return { phase: 'failed', seq: Number(seq), inputs: src.inputs, check: null, result: src.result || null, error: vcUndoErrorOf(reply, 'check'), requestId: String(src.requestId || '') }
}

/** 执行回包落到状态里：成功清票进 done；失败保住票与现场读数，让用户看清为什么没成。 */
export function vcUndoApplyWrite(state: any, seq: number, reply: any): any {
  const src: any = state || vcUndoStateNew()
  if (Number(seq) < Number(src.seq || 0)) return src
  if (vcUndoWriteShapeOk(reply)) {
    return { phase: 'done', seq: Number(seq), inputs: src.inputs, check: null, result: reply, error: null, requestId: String(src.requestId || '') }
  }
  return { phase: 'failed', seq: Number(seq), inputs: src.inputs, check: src.check || null, result: src.result || null, error: vcUndoErrorOf(reply, 'write'), requestId: String(src.requestId || '') }
}

/** 忙碌判定：预检或执行在途时按钮一律禁用，免得连点两次真执行两次。 */
export function vcUndoBusyOf(state: any): boolean {
  const phase: string = String((state && state.phase) || '')
  return phase === 'checking' || phase === 'writing'
}

/** 恢复路径的两条命令（硬重置用）：把旧提交写回 HEAD，或在 reflog 里按选择器找回。 */
export function vcUndoRecoveryStepsOf(recovery: any): string[] {
  if (!recovery || !recovery.restore) return []
  const restore: any = recovery.restore
  const headOid: string = String(restore.headOid || '')
  if (headOid === '') return []
  const steps: string[] = ['git reset --hard ' + headOid]
  if (String(restore.reflogBefore || '') !== '') steps.push('git reflog show -n 1 ' + String(restore.reflogBefore))
  return steps
}

/** 短提交号：页面里一律 10 位，避免长短不一造成横向跳。 */
export function vcUndoShortOidOf(oid: any): string {
  const text: string = String(oid === undefined || oid === null ? '' : oid)
  return text.slice(0, 10)
}

/** 本地时间（结果区显示「什么时候做的」）：与其它页面同一写法，不引第三方。 */
export function vcUndoWhenOf(atMs: number): string {
  const ms: number = Number(atMs)
  if (!isFinite(ms) || ms <= 0) return ''
  const d: Date = new Date(ms)
  const pad = function (n: number): string { return (n < 10 ? '0' : '') + String(n) }
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 生成一个 requestId：同一次确认重放靠它去重；形状必须过宿主 requestIdProblem（字母数字下划线短横线，≤64）。 */
export function vcUndoRequestIdOf(): string {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 界面认识的失败标识符：宿主回包里的 reason 落在这张表里就照它查词表，否则退回通用一句。 */
export const VC_UNDO_FAIL_KEYS: string[] = [
  'unknown-op', 'required-target', 'bad-target', 'message-too-long', 'bad-message',
  'commits-empty', 'commits-too-many', 'commits-invalid', 'commits-duplicate',
  'target-missing', 'no-head', 'mid-operation', 'nothing-to-do', 'commit-already-present',
  'recovery-unreadable', 'ticket-missing', 'ticket-expired', 'ticket-op-mismatch',
  'stale-repo', 'stale-head', 'stale-index', 'target-changed',
  'cherry-pick-conflict', 'revert-conflict', 'revert-partial',
  'git', 'shape', 'no-cwd', 'check', 'write',
]

/** 这个失败标识符有没有专有文案（没有就用通用一句加原文）。 */
export function vcUndoFailKnownOf(key: any): boolean {
  const text: string = String(key === undefined || key === null ? '' : key)
  for (let i = 0; i < VC_UNDO_FAIL_KEYS.length; i += 1) if (VC_UNDO_FAIL_KEYS[i] === text) return true
  return false
}

export const VC_UNDO_OPS_SOURCE: string = 'src/client/views/versionControl/vcUndoOps.ts'
