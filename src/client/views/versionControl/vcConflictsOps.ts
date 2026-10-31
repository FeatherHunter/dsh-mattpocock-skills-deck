// views/versionControl/vcConflictsOps.ts —— 冲突向导 15 条能力的动作模型（#1747 T12）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 把能力 6.1–6.15 逐条登记成动作（动作名、能力号、读写、危险与确认、要哪些输入）；
//   2. 由输入值拼出预检/执行电话的参数，字段名与宿主叶子读的完全一致（target/path/side/text）；
//   3. 状态机口径与共享层 conflict-ops.ts 一致：四种进行中操作、继续/跳过/中止在哪种状态下出现；
//   4. 只回标识符与词条键，不写任何中文字面量——可见文字全走 t(词条)，词条真源 config/copy/vcconflicts.yaml。
// 为什么客户端另有一份动作名单：界面闭包不能运行时 import 共享层（conflict-ops 依赖 git 参数拼装那一族）。
//   这份名单由 tests/verify-1586-conflicts.ts 与 conflict-ops.ts 的 CONFLICT_OPS 逐条对账，任何一格不一致就判红。

export const VC_CONFLICTS_PHONES: Record<string, string> = {
  read: 'wf.gitConflicts',
  check: 'wf.gitConflictCheck',
  write: 'wf.gitConflictWrite',
}

// 视图名单：按能力编号排；needs 说明要哪些输入（none/target/path/path-side/path-text）。
export const VC_CONFLICTS_OPS: any[] = [
  { op: 'merge', capId: '6.1', write: true, dangerous: false, confirm: false, needs: 'target' },
  { op: 'merge-ff-only', capId: '6.2', write: true, dangerous: false, confirm: false, needs: 'target' },
  { op: 'merge-no-ff', capId: '6.3', write: true, dangerous: false, confirm: false, needs: 'target' },
  { op: 'merge-squash', capId: '6.4', write: true, dangerous: false, confirm: false, needs: 'target' },
  { op: 'conflict-list', capId: '6.5', write: false, dangerous: false, confirm: false, needs: 'none' },
  { op: 'take-side', capId: '6.6', write: true, dangerous: false, confirm: false, needs: 'path-side' },
  { op: 'save-file', capId: '6.7', write: true, dangerous: false, confirm: false, needs: 'path-text' },
  { op: 'mark-resolved', capId: '6.8', write: true, dangerous: false, confirm: false, needs: 'path' },
  { op: 'conflict-view', capId: '6.9', write: false, dangerous: false, confirm: false, needs: 'path' },
  { op: 'merge-preview', capId: '6.10', write: false, dangerous: false, confirm: false, needs: 'target' },
  { op: 'op-continue', capId: '6.11', write: true, dangerous: false, confirm: false, needs: 'none' },
  { op: 'op-skip', capId: '6.12', write: true, dangerous: true, confirm: true, needs: 'none' },
  { op: 'op-abort', capId: '6.13', write: true, dangerous: true, confirm: true, needs: 'none' },
  { op: 'rerere-view', capId: '6.14', write: false, dangerous: false, confirm: false, needs: 'none' },
  { op: 'marker-check', capId: '6.15', write: false, dangerous: false, confirm: false, needs: 'none' },
]

// 进行中操作的四种状态，顺序与共享层 CONFLICT_STATES 一致。
export const VC_CONFLICTS_STATES: string[] = ['merge', 'rebase', 'cherry-pick', 'revert']

// 冲突文件的八种分类（后四种只许整份处理，不显示逐块）。
export const VC_CONFLICTS_KINDS: string[] = ['both-changed', 'deleted-by-theirs', 'deleted-by-ours', 'both-deleted', 'renamed', 'binary', 'submodule', 'mode']

const vcConflictsCamelOf = function (name: any) {
  return String(name === undefined || name === null ? '' : name).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() })
}

export const vcConflictsOpMetaOf = function (op: any) {
  const s: string = String(op === undefined || op === null ? '' : op)
  for (let i = 0; i < VC_CONFLICTS_OPS.length; i += 1) if (VC_CONFLICTS_OPS[i].op === s) return VC_CONFLICTS_OPS[i]
  return null
}

export const vcConflictsOpLabelKeyOf = function (op: any) { return 'vc.conflicts.op.' + vcConflictsCamelOf(op) }
export const vcConflictsOpVerbKeyOf = function (op: any) { return 'vc.conflicts.op.verb.' + vcConflictsCamelOf(op) }
// 状态文案键：cherry-pick 走驼峰 cherryPick（与共享层 conflictStateLabelKeyOf 同一条规矩）。
export const vcConflictsStateLabelKeyOf = function (state: any) { return 'vc.conflicts.state.' + vcConflictsCamelOf(state) }
export const vcConflictsKindLabelKeyOf = function (kind: any) { return 'vc.conflicts.kind.' + vcConflictsCamelOf(kind) }
export const vcConflictsSideLabelKeyOf = function (side: any) { return 'vc.conflicts.side.' + vcConflictsCamelOf(side) }

// 请求号：重放靠它换回上一次结果；界面只拼形状，形状不合会被宿主拒（bad-target）。
export const vcConflictsRequestIdOf = function (nowMs: any, salt: any) {
  const ms: number = typeof nowMs === 'number' && isFinite(nowMs) ? Math.floor(nowMs) : Date.now()
  const tail: string = String(salt === undefined || salt === null ? '' : salt).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return 'f' + ms.toString(36) + (tail === '' ? '' : '-' + tail)
}

// 也能被界面拼起来：动作名与能力号一一对应（跳步/中止只在进行中操作时出现，没有就不画，不是灰着）。
export const vcConflictsVisibleOf = function (state: any) {
  const s: string = (state === undefined || state === null) ? '' : String(state)
  const visible: string[] = []
  for (let i = 0; i < VC_CONFLICTS_OPS.length; i += 1) {
    const op: string = VC_CONFLICTS_OPS[i].op
    const ongoing: boolean = s !== ''
    if (op === 'op-continue' || op === 'op-abort') { if (ongoing) visible.push(op); continue }
    if (op === 'op-skip') { if (ongoing && s !== 'merge') visible.push(op); continue }
    visible.push(op)
  }
  return visible
}

// 由当前输入值拼出载荷：字段名与宿主的预检读取一致（target/path/side/text），不拼命令。
export const vcConflictsPayloadOf = function (op: any, values: any) {
  const meta: any = vcConflictsOpMetaOf(op)
  const v: any = values || {}
  const str = function (x: any) { return String(x === undefined || x === null ? '' : x) }
  if (!meta) return {}
  if (meta.needs === 'target') return { target: str(v.target) }
  if (meta.needs === 'path') return { path: str(v.path) }
  if (meta.needs === 'path-side') return { path: str(v.path), side: str(v.side || 'ours') }
  if (meta.needs === 'path-text') return { path: str(v.path), text: str(v.text) }
  return {}
}

// 预检电话的参数：动作与载荷；只读动作直接打读数电话，但参数形状相同。
export const vcConflictsCheckArgsOf = function (cwd: any, op: any, values: any) {
  const args: any = { cwd: String(cwd === undefined || cwd === null ? '' : cwd), op: String(op === undefined || op === null ? '' : op) }
  const payload: any = vcConflictsPayloadOf(op, values)
  Object.keys(payload).forEach(function (k: string) { args[k] = payload[k] })
  return args
}

// 执行电话的参数：票号、请求号、确认一律带上；载荷原样展开（宿主按 op 读同一个字段名）。
export const vcConflictsWriteArgsOf = function (cwd: any, op: any, values: any, ticketId: any, requestId: any) {
  const args: any = vcConflictsCheckArgsOf(cwd, op, values)
  args.ticketId = String(ticketId === undefined || ticketId === null ? '' : ticketId)
  args.requestId = String(requestId === undefined || requestId === null ? '' : requestId)
  args.confirmed = true
  return args
}

// 确认卡「会动什么」那一段的读数：合并给目标，路径类给路径，选边给「路径 · 边」，整份保存给路径。
export const vcConflictsTargetOf = function (op: any, values: any, t: any) {
  const payload: any = vcConflictsPayloadOf(op, values)
  if (payload.target !== undefined && payload.target !== '') return String(payload.target)
  if (payload.path !== undefined && payload.path !== '') {
    if (payload.side !== undefined) {
      const sideText: string = (typeof t === 'function') ? t(vcConflictsSideLabelKeyOf(payload.side)) : String(payload.side)
      return String(payload.path) + ' · ' + sideText
    }
    return String(payload.path)
  }
  return ''
}

// 读数结果的目录：冲突清单只取界面关心的几格，别的字段原样留给调用方。
export const vcConflictsListOf = function (read: any) {
  const r: any = read || {}
  const list: any[] = Array.isArray(r.conflicts) ? r.conflicts : []
  return list.map(function (c: any) {
    return {
      path: String(c && c.path !== undefined ? c.path : ''),
      kind: String(c && c.kind !== undefined ? c.kind : 'both-changed'),
      textKind: String(c && c.textKind !== undefined ? c.textKind : 'text'),
      sides: (c && c.sides) || { ours: false, theirs: false, delete: true },
    }
  })
}

// 一块冲突在界面上的可选边：模板让每个块给「当前边 / 对方边 / 两边都要」三选一；
// 选择回标回 choices 数组，由页面层的「拼成整份」按钮调 applyConflictChoices 拼出文本。
export const vcConflictsChoicesOf = function (hunkCount: any, choices: any) {
  const n: number = (typeof hunkCount === 'number' && isFinite(hunkCount) && hunkCount > 0) ? Math.floor(hunkCount) : 0
  const src: any[] = Array.isArray(choices) ? choices : []
  const out: any[] = []
  for (let i = 0; i < n; i += 1) out.push(typeof src[i] === 'string' ? src[i] : '')
  return out
}

export const VC_CONFLICTS_OPS_SOURCE = 'src/client/views/versionControl/vcConflictsOps.ts'
