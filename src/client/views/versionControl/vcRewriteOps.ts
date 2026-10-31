// views/versionControl/vcRewriteOps.ts —— 管理 › 维护页整仓重写的操作方法层（#1750 T15，规格 #1586 能力 5.11）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一层只做三件事，不画界面、不发电话：
//   ① 五张 filter-repo 表单的标识与「这张表单要填哪个字段」；
//   ② 把界面上的多行文本翻成宿主预检能收的计划（路径、重命名、作者身份、阈值、字面量替换）；
//   ③ 把回包分类成界面状态（预览成功 / 已签票 / 不放行 / 票据过期 / 需要确认 / 执行结果）。
// 真正的校验规则在共享层 rewrite-ops.ts（宿主与界面读同一份），这里不复制一套判定。
//
// 为什么不在这里写任何中文字符串：可见文字全部走 t(词条)，词条真源 config/copy/vcrewrite.yaml；
// 这一层可以被门禁直接求值，混进界面文案就分不清「逻辑」与「文案」的边界了。

// 下面三个名字由构建拼进同一闭包的共享片段提供（共享层 rewrite-ops.ts 与 recovery-point.ts）。
// 单文件 tsc 看不到拼接后的兄弟片段，所以这里只声明形状；运行时它们一定存在，门禁求值时也要把两份片段拼进来。
declare function rewritePlanOf(values: any): any
declare function backupSummaryOf(point: any): string
declare function backupRestoreStepsOf(point: any): string[]

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_REWRITE_PAGE_SOURCE = 'src/client/views/versionControl/vcRewriteOps.ts'

/** 本页要用的五条电话：只读预览、预检签票、备份后执行、长任务查询、长任务取消。 */
export const VC_REWRITE_PHONES: Record<string, string> = {
  preview: 'wf.gitRewritePreview',
  check: 'wf.gitRewriteCheck',
  run: 'wf.gitRewriteRun',
  query: 'wf.gitTaskQuery',
  cancel: 'wf.gitTaskCancel',
}

/** 五张表单的固定顺序（与共享层 rewrite-ops.ts 的 REWRITE_FORMS 逐条对账）。 */
export const VC_REWRITE_FORM_IDS: string[] = ['remove-paths', 'rename-paths', 'rewrite-authors', 'remove-large', 'replace-text']

/** 表单字段名（每张表单只显示自己的那一格）。 */
export const VC_REWRITE_FIELDS: Record<string, string> = {
  'remove-paths': 'paths',
  'rename-paths': 'renames',
  'rewrite-authors': 'authors',
  'remove-large': 'threshold',
  'replace-text': 'replacements',
}

/** 表单初值：默认第一张表单，所有输入框为空。 */
export const VC_REWRITE_FORM_DEFAULT: Record<string, any> = {
  form: 'remove-paths',
  pathsText: '', renamesText: '', authorsText: '', threshold: '', replacementsText: '',
}

const vcRewriteTextOf = function (t: any, key: string, vars: any): string {
  if (typeof t !== 'function') return key
  return vars ? t(key, vars) : t(key)
}

/** 当前表单要显示的字段名。 */
export const vcRewriteFieldOf = function (form: any): string {
  return VC_REWRITE_FIELDS[String(form || '')] || 'paths'
}

/** 字段的标签词条键。 */
export const vcRewriteFieldLabelKeyOf = function (field: any): string {
  return 'vc.rewrite.field.' + String(field || 'paths')
}

/** 字段的填写提示词条键。 */
export const vcRewriteFieldHintKeyOf = function (field: any): string {
  return 'vc.rewrite.field.' + String(field || 'paths') + 'Hint'
}

/** 多行文本 → 去掉空行与两端空白的行数组（保留顺序，不排序）。 */
export const vcRewriteLinesOf = function (text: any): string[] {
  const raw = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i].trim()
    if (line !== '') out.push(line)
  }
  return out
}

/** 一行重命名写成「旧路径 => 新路径」；缺箭头或某一边为空的行算坏行，整张表单不提交。 */
export const vcRewriteRenamesOf = function (text: any): any[] | null {
  const lines = vcRewriteLinesOf(text)
  const out: any[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const cut = lines[i].indexOf('=>')
    if (cut < 0) return null
    const from = lines[i].slice(0, cut).trim()
    const to = lines[i].slice(cut + 2).trim()
    if (from === '' || to === '') return null
    out.push({ from: from, to: to })
  }
  return out
}

/** 一行字面量替换写成「原文 => 替换成」；替换成可以是空串（删掉这段字面量）。 */
export const vcRewriteReplacementsOf = function (text: any): any[] | null {
  const lines = vcRewriteLinesOf(text)
  const out: any[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const cut = lines[i].indexOf('=>')
    if (cut < 0) return null
    const from = lines[i].slice(0, cut).trim()
    const to = lines[i].slice(cut + 2).trim()
    if (from === '') return null
    out.push({ from: from, to: to })
  }
  return out
}

/** 一行作者身份写成「新姓名 <新邮箱>」，后面可跟「| 旧姓名 <旧邮箱>」限定只改这一位作者。 */
export const vcRewriteAuthorsOf = function (text: any): any[] | null {
  const lines = vcRewriteLinesOf(text)
  const out: any[] = []
  const pattern = /^(.*?)\s*<([^<>]*)>\s*(?:\|\s*(.*?)\s*<([^<>]*)>\s*)?$/
  for (let i = 0; i < lines.length; i += 1) {
    const m = pattern.exec(lines[i])
    if (!m) return null
    const name = String(m[1] || '').trim()
    const email = String(m[2] || '').trim()
    if (name === '' || email === '') return null
    const item: any = { name: name, email: email }
    if (m[3] !== undefined && m[4] !== undefined) {
      const oldName = String(m[3] || '').trim()
      const oldEmail = String(m[4] || '').trim()
      if (oldName === '' || oldEmail === '') return null
      item.oldName = oldName
      item.oldEmail = oldEmail
    }
    out.push(item)
  }
  return out
}

/** 表单原值 → 共享层认识的计划形状；多行文本解析不出来时回 null（由调用方在界面提示，不发电话）。 */
export const vcRewritePlanOf = function (values: any): any {
  const v = values || {}
  const form = String(v.form || VC_REWRITE_FORM_DEFAULT.form)
  const raw: any = { op: 'rewrite', form: form, paths: [], renames: [], authors: [], threshold: '', replacements: [] }
  if (form === 'remove-paths') raw.paths = vcRewriteLinesOf(v.pathsText)
  else if (form === 'rename-paths') { const renames = vcRewriteRenamesOf(v.renamesText); if (renames === null) return null; raw.renames = renames }
  else if (form === 'rewrite-authors') { const authors = vcRewriteAuthorsOf(v.authorsText); if (authors === null) return null; raw.authors = authors }
  else if (form === 'remove-large') raw.threshold = String(v.threshold || '').trim()
  else if (form === 'replace-text') { const items = vcRewriteReplacementsOf(v.replacementsText); if (items === null) return null; raw.replacements = items }
  return rewritePlanOf(raw)
}

/** 预览电话参数：工作区与计划（计划形状由共享层再校验一遍）。 */
export const vcRewritePreviewArgsOf = function (cwd: any, values: any): any {
  return { cwd: String(cwd || ''), plan: vcRewritePlanOf(values) }
}

/** 预检电话参数：与预览同一份计划，宿主签票时把它记在票上。 */
export const vcRewriteCheckArgsOf = function (cwd: any, values: any): any {
  return { cwd: String(cwd || ''), plan: vcRewritePlanOf(values) }
}

/** 执行电话参数：票里已经有计划，这里只带工作区、票号、请求号与显式确认。 */
export const vcRewriteRunArgsOf = function (cwd: any, ticketId: any, requestId: any): any {
  return { cwd: String(cwd || ''), ticketId: String(ticketId || ''), requestId: String(requestId || ''), confirmed: true }
}

/** 一个请求号（宿主只收 [A-Za-z0-9_-]，不超过 64）；同一动作重放时界面用同一个号，宿主回上次结果。 */
export const vcRewriteRequestIdOf = function (nowMs: any, salt: any): string {
  const a = Number(nowMs || 0).toString(36)
  const b = String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
  return 'w' + a + b
}

/** 宿主失败理由标识符 → 词条键；认不出的走 other，绝不把英文标识符印到界面上。 */
export const VC_REWRITE_REASON_KEYS: Record<string, string> = {
  'tool-missing': 'vc.rewrite.reason.toolMissing',
  'shallow-repo': 'vc.rewrite.reason.shallowRepo',
  'dirty-worktree': 'vc.rewrite.reason.dirtyWorktree',
  'operation-in-progress': 'vc.rewrite.reason.operationInProgress',
  'nothing-to-do': 'vc.rewrite.reason.nothingToDo',
  'repo-bare': 'vc.rewrite.reason.repoBare',
  'bad-form': 'vc.rewrite.reason.badForm',
  'bad-path': 'vc.rewrite.reason.badPath',
  'bad-rename': 'vc.rewrite.reason.badRename',
  'bad-identity': 'vc.rewrite.reason.badIdentity',
  'bad-threshold': 'vc.rewrite.reason.badThreshold',
  'bad-replacement': 'vc.rewrite.reason.badReplacement',
  'too-many-items': 'vc.rewrite.reason.tooManyItems',
  'temp-unavailable': 'vc.rewrite.reason.tempUnavailable',
  'ticket-missing': 'vc.rewrite.reason.ticketMissing',
  'ticket-expired': 'vc.rewrite.reason.ticketExpired',
  'ticket-op-mismatch': 'vc.rewrite.reason.ticketMismatch',
  'need-confirm': 'vc.rewrite.reason.needConfirm',
  'stale-repo': 'vc.rewrite.reason.staleRepo',
  'target-changed': 'vc.rewrite.reason.targetChanged',
  'stale-index': 'vc.rewrite.reason.staleIndex',
  'backup-failed': 'vc.rewrite.reason.backupFailed',
  'backup-unreadable': 'vc.rewrite.reason.backupUnreadable',
  'task-start-failed': 'vc.rewrite.reason.taskStartFailed',
  'unknown-write-failure': 'vc.rewrite.reason.unknown',
}

/** 回包失败理由（兼容两种信封：error.reason 与顶层 reason，另加 error.kind）。 */
export const vcRewriteReasonOf = function (reply: any): string {
  const r = reply || {}
  if (r.reason) return String(r.reason)
  if (r.error && r.error.reason) return String(r.error.reason)
  return String((r.error && r.error.kind) || '')
}

/** 回包分类：预览成功 / 已签票 / 需要确认 / 不放行 / 票据过期 / 执行成功 / 失败。 */
export const vcRewriteReplyKindOf = function (reply: any): string {
  const r = reply || {}
  if (r.reused === true) return 'done'
  if (r.ok === true && r.task) return 'running'
  if (r.ok === true && r.confirm && r.ticket) return 'checked'
  if (r.ok === true && r.preview) return 'previewed'
  if (r.ok === true && r.backup) return 'done'
  const reason = vcRewriteReasonOf(r)
  if (reason === 'ticket-missing' || reason === 'ticket-expired' || reason === 'ticket-op-mismatch' || reason === 'target-changed' || reason === 'stale-repo' || reason === 'stale-index') return 'stale'
  if (reason === 'need-confirm') return 'need-confirm'
  if (r.ok === false && ((r.error && r.error.kind === 'blocked') || r.decision)) return 'blocked'
  return 'fail'
}

/** 票对象（预览回包没有票；预检回包把票放在 ticket 里）。 */
export const vcRewriteTicketOf = function (reply: any): any {
  const r = reply || {}
  return r.ticket || null
}

/** 预览计数的展示行：数值为空的不画（不编 0），顺序固定。 */
export const vcRewriteCountRowsOf = function (counts: any): any[] {
  const c = counts || {}
  const rows: any[] = []
  const pairs = [['commits', c.commits], ['matchedCommits', c.matchedCommits], ['matchedPaths', c.matchedPaths], ['thresholdBytes', c.thresholdBytes]]
  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i][1] === null || pairs[i][1] === undefined) continue
    rows.push({ key: 'vc.rewrite.counts.' + pairs[i][0], value: String(pairs[i][1]) })
  }
  if (Array.isArray(c.replacementHits)) {
    for (let i = 0; i < c.replacementHits.length; i += 1) {
      const hit = c.replacementHits[i] || {}
      rows.push({ key: 'vc.rewrite.counts.replacementHit', value: String(hit.commits), from: String(hit.from || '') })
    }
  }
  return rows
}

/** 备份点（预检回包与执行回包都有）。 */
export const vcRewriteBackupOf = function (reply: any): any {
  const r = reply || {}
  return r.backup || (r.backupPoint || null)
}

/** 备份摘要一句话（人读的大小与路径，来自共享层 recovery-point）。 */
export const vcRewriteBackupSummaryOf = function (reply: any): string {
  const point = vcRewriteBackupOf(reply)
  if (!point) return ''
  return backupSummaryOf(point)
}

/** 还原步骤：只给步骤，面板不提供自动恢复。 */
export const vcRewriteRestoreStepsOf = function (reply: any): string[] {
  const point = vcRewriteBackupOf(reply)
  if (!point) return []
  return backupRestoreStepsOf(point)
}

/** 长任务里 taskId 对应的记录；查询回包可能带很多条，按 id 找。 */
export const vcRewriteTaskOf = function (reply: any, taskId: any): any {
  const tasks = reply && Array.isArray(reply.tasks) ? reply.tasks : []
  const id = String(taskId || '')
  for (let i = 0; i < tasks.length; i += 1) {
    if (tasks[i] && String(tasks[i].taskId || '') === id) return tasks[i]
  }
  return null
}

/** 任务是否已经结束（四种结论之一）：结束了就不再轮询。 */
export const vcRewriteTaskEndedOf = function (task: any): boolean {
  const t0 = task || {}
  return t0.state !== 'running' && !!t0.conclusion
}

/** 进度模型：真实百分比只在 0..100 才算数；在途但报不出百分比时标 uncertain。 */
export const vcRewriteProgressOf = function (task: any): any {
  const t0 = task || {}
  const raw = t0.percent
  const percent = (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw <= 100) ? Math.round(raw) : null
  return { phase: (typeof t0.phase === 'string' && t0.phase) ? t0.phase : '', percent: percent, uncertain: String(t0.state || '') === 'running' && percent === null }
}

/** 结果的失败原因词条（优先固定理由表，其次用宿主原话兜底）。 */
export const vcRewriteFailTextOf = function (t: any, reply: any): string {
  const reason = vcRewriteReasonOf(reply)
  const key = VC_REWRITE_REASON_KEYS[reason]
  if (key) return vcRewriteTextOf(t, key, null)
  return String((reply && reply.error && reply.error.message) || vcRewriteTextOf(t, 'vc.rewrite.reason.unknown', null))
}

/** 真源标识（页面壳与门禁按它找本文件的挂载段）。 */
export const VC_REWRITE_PAGE_HINT = 'maintenance'
