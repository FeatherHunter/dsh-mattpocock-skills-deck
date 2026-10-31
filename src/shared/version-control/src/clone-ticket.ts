// shared/version-control/src/clone-ticket.ts —— 域 8 克隆向导的预检票据口径（#1756 T20，能力 8.16）
//
// 克隆与别的写动作一样走「先预检、拿一张 120 秒的票、凭票执行」三段式（规格第 8 节）：
//   预检那一刻确认「目标目录还不存在或为空」，用户点确认的那几秒里目标目录完全可能被别人建起来，
//   所以执行前必须拿着票再重算一遍现场。这一片只放纯逻辑：
//   · 动作清单（start 开始克隆 / cleanup 清理残留目录）；
//   · 参数规范化：界面送来的表单与宿主收到的东西收敛成同一份计划；
//   · 计划摘要输入：把「计划 + 目标现场」写成一段稳定字节，宿主哈希后放进票里，执行前重算比对。
// 零 import 自包含：依赖门禁不许 shared 同层互相 import，而且界面与宿主都要用同一套口径。
//
// 与 write-ticket.ts 的分工：通用票据形状（makeTicket / bindingsVerdict / ticketPureVerdict /
//   requestIdProblem）在那边；这一片补的是克隆域自己的动作表与「现场怎么摘要」。

/** 两个写动作：start = 开始克隆（走 T05 长任务通道）；cleanup = 删除取消后残留的目标目录。 */
export const CLONE_TICKET_OPS: string[] = ['start', 'cleanup']

/** 预检回包契约名与版本：界面与门禁据此判断「这是新协议的预检回包」，而不是执行回包或旧版。 */
export const CLONE_CHECK_CONTRACT = 'version-control.clone-check'
export const CLONE_CHECK_VERSION = 1

/** 目标路径的五种现场：不存在 / 存在且为空目录 / 存在且非空 / 存在但是文件 / 读不出来。
 *  只有前两种能开始克隆；cleanup 只处理「存在」的那几种。 */
export const CLONE_TARGET_STATES: string[] = ['absent', 'empty-dir', 'non-empty-dir', 'file', 'unreadable']

/** 把任意值写成稳定字符串：对象键排序、undefined 当 null、数组保序。
 *  预检与执行各算一遍再比相等，只有同一口径才能比；直接 JSON.stringify 会因键顺序不同误判。 */
export function cloneStableValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(cloneStableValue).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + cloneStableValue(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 现场形状是否合法：界面与执行层都先用它判一遍，免得拿一个缺字段的对象进摘要。 */
export function cloneTargetStateOk(target: any): boolean {
  const t: any = target || {}
  if (CLONE_TARGET_STATES.indexOf(String(t.state)) < 0) return false
  if (!isFinite(Number(t.entryCount))) return false
  return Array.isArray(t.entries)
}

/** 动作参数规范化：只留这个动作真正会用到的字段，空值统一成 null，布尔统一成真布尔。
 *  start 的每一项都会被写进计划摘要，所以这里不能漏项——漏掉的项改动不会触发 target-changed。 */
export function clonePlanOf(op: string, args: any): { ok: true; plan: any } | { ok: false; reason: string; message: string } {
  const a: any = args || {}
  const s = function (v: any): string { return v === undefined || v === null ? '' : String(v).trim() }
  const want = String(op || '')
  if (CLONE_TICKET_OPS.indexOf(want) < 0) return { ok: false, reason: 'bad-op', message: '不认识的克隆动作：' + want + '（允许：' + CLONE_TICKET_OPS.join(' / ') + '）' }
  if (want === 'start') {
    const depth = a.depth === undefined || a.depth === null || String(a.depth).trim() === '' ? null : Number(a.depth)
    return {
      ok: true,
      plan: {
        op: 'start',
        url: s(a.url),
        dir: s(a.dir),
        depth: depth,
        branch: s(a.branch) === '' ? null : s(a.branch),
        recurseSubmodules: a.recurseSubmodules === true,
        shallowSubmodules: a.shallowSubmodules === true && depth !== null,
        offline: a.offline === true,
      },
    }
  }
  return { ok: true, plan: { op: 'cleanup', dir: s(a.dir), confirm: a.confirm === true } }
}

/** 计划摘要只放人要认得出的那几样（地址掩码后的样子不放：掩码规则一改票就整体失效）。
 *  地址原文进摘要，执行前同一份表单重算；地址变了自然判成 target-changed。 */
export function clonePlanDigestInput(plan: any, target: any): string {
  const p: any = plan || {}
  const t: any = target || {}
  const state = String(t.state === undefined || t.state === null ? '' : t.state)
  const entries: any[] = Array.isArray(t.entries) ? t.entries : []
  const sorted = entries.map(function (v: any) { return String(v) }).sort()
  return cloneStableValue({ plan: p, target: { state: state, entryCount: Number(t.entryCount) || 0, entries: sorted } })
}

/** 给界面看的现场摘要：目标路径、状态、前几条占位文件名、大小。
 *  文件名最多给 8 条：一是界面只画得下那么多，二是目录里一千个文件也没有多说的价值。 */
export function cloneTargetSummaryOf(target: any): any {
  const t: any = target || {}
  const entries: any[] = Array.isArray(t.entries) ? t.entries : []
  const shown = entries.slice(0, 8).map(function (v: any) { return String(v) })
  return {
    path: t.path === undefined || t.path === null ? '' : String(t.path),
    state: t.state === undefined || t.state === null ? 'unreadable' : String(t.state),
    entryCount: Number(t.entryCount) || 0,
    entries: shown,
    truncated: entries.length > shown.length,
    sizeBytes: typeof t.sizeBytes === 'number' && isFinite(t.sizeBytes) ? t.sizeBytes : null,
    error: t.error === undefined || t.error === null ? null : String(t.error),
  }
}

/** 这一份现场能不能开始克隆：不存在或空目录才行；别的都给出原因标识符（界面据此翻词条）。 */
export function cloneTargetProblem(target: any): string | null {
  const state = String((target && target.state) || '')
  if (state === 'absent' || state === 'empty-dir') return null
  if (state === 'non-empty-dir') return 'target-not-empty'
  if (state === 'file') return 'target-not-directory'
  return 'target-unreadable'
}

/** 清理目标是否值得动手：目录不存在就没什么可清理；是文件也不删（那不是克隆残留）。
 *  返回 null 表示「可以清」，否则给原因标识符。非空与空目录都允许清理——残留目录可能是空的。 */
export function cloneCleanupProblem(target: any): string | null {
  const state = String((target && target.state) || '')
  if (state === 'non-empty-dir' || state === 'empty-dir') return null
  if (state === 'absent') return 'nothing-to-clean'
  if (state === 'file') return 'target-not-directory'
  return 'target-unreadable'
}

/** 克隆计划要交给长任务通道的参数（T05 的 taskArgsFor 收这一份形状）。
 *  只挑任务通道认识的键：目标目录、地址、深度、分支、两个子模块开关；离线与选项判断留在投票之前做。 */
export function cloneTaskArgsOf(plan: any): any {
  const p: any = plan || {}
  const out: any = { url: p.url === undefined || p.url === null ? '' : String(p.url), dir: p.dir === undefined || p.dir === null ? '' : String(p.dir) }
  if (typeof p.depth === 'number' && isFinite(p.depth)) out.depth = p.depth
  if (p.branch !== undefined && p.branch !== null && String(p.branch) !== '') out.branch = String(p.branch)
  if (p.recurseSubmodules === true) out.recurseSubmodules = true
  if (p.shallowSubmodules === true) out.shallowSubmodules = true
  return out
}

export const CLONE_TICKET_SOURCE = 'src/shared/version-control/src/clone-ticket.ts'
