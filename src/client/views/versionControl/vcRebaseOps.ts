// views/versionControl/vcRebaseOps.ts —— 变基待办页 9 条动作的界面动作模型（#1749 T14）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
// 职责四条：
//   1. 把能力 5.6/5.7/5.8/5.10 的四条写动作，与五条只读读数登记成动作（动作名、能力号、读写、确认、要哪些输入）；
//   2. 由界面输入拼出三条电话的参数，字段名与宿主叶子读的完全一致（base / rows / oldBase / newBase）；
//   3. 待办行的六个动作（保留、改说明、压缩、丢弃、上移、下移）在这里只做数据变换，不碰 DOM；
//   4. 只回标识符与词条键，不写任何中文字面量——可见文字全走 t(词条)，词条真源 config/copy/vcrebase.yaml。
// 为什么客户端另有动作名单：界面闭包不能运行时 import 共享层（rebase-ops 依赖 git 参数拼装那一族）。
//   这份名单由 tests/verify-1586-rebase.ts 与共享层 rebase-ops.ts 的 REBASE_OPS 逐条对账。

export const VC_REBASE_PHONES: Record<string, string> = {
  read: 'wf.gitRebaseRead',
  check: 'wf.gitRebaseCheck',
  write: 'wf.gitRebaseWrite',
}

// 动作名单：四条写动作按能力号排，再接五条只读动作；needs 说明要哪些输入（todo/onto/base/none）。
export const VC_REBASE_OPS: any[] = [
  { op: 'rebase-todo', capId: '5.6', write: true, dangerous: true, confirm: true, needs: 'todo' },
  { op: 'rebase-onto', capId: '5.7', write: true, dangerous: true, confirm: true, needs: 'onto' },
  { op: 'rebase-autosquash', capId: '5.8', write: true, dangerous: true, confirm: true, needs: 'base' },
  { op: 'rebase-merges', capId: '5.10', write: true, dangerous: true, confirm: true, needs: 'base' },
  { op: 'rebase-state', capId: '', write: false, dangerous: false, confirm: false, needs: 'none' },
  { op: 'rebase-window', capId: '', write: false, dangerous: false, confirm: false, needs: 'base' },
  { op: 'rebase-onto-range', capId: '', write: false, dangerous: false, confirm: false, needs: 'onto' },
  { op: 'rebase-autosquash-pairs', capId: '', write: false, dangerous: false, confirm: false, needs: 'base' },
  { op: 'rebase-merges-cost', capId: '', write: false, dangerous: false, confirm: false, needs: 'base' },
]

// 待办行允许的五个改写动词（顺序固定：保留、改说明、压缩、丢弃、修正）。
export const VC_REBASE_TODO_ACTIONS: string[] = ['pick', 'reword', 'squash', 'fixup', 'drop']
// 两个纯重排动作：只改行的顺序，不改变提交内容，所以不进待办文件的动词。
export const VC_REBASE_TODO_MOVES: string[] = ['move-up', 'move-down']

const vcRebaseCamelOf = function (name: any) {
  return String(name === undefined || name === null ? '' : name).replace(/-([a-z])/g, function (m: string, c: string) { return c.toUpperCase() })
}
const vcRebaseStrOf = function (x: any) { return String(x === undefined || x === null ? '' : x) }

export const vcRebaseOpMetaOf = function (op: any) {
  const s: string = vcRebaseStrOf(op)
  for (let i = 0; i < VC_REBASE_OPS.length; i += 1) if (VC_REBASE_OPS[i].op === s) return VC_REBASE_OPS[i]
  return null
}

export const vcRebaseOpLabelKeyOf = function (op: any) { return 'vc.rebase.op.' + vcRebaseCamelOf(op) }
export const vcRebaseOpVerbKeyOf = function (op: any) { return 'vc.rebase.op.verb.' + vcRebaseCamelOf(op) }
export const vcRebaseActionLabelKeyOf = function (action: any) { return 'vc.rebase.action.' + vcRebaseCamelOf(action) }
export const vcRebaseStateLabelKeyOf = function (state: any) { return 'vc.rebase.state.' + vcRebaseCamelOf(state) }

// 请求号：重放靠它换回上一次结果；界面只拼形状，形状不合会被宿主拒（bad-target）。
export const vcRebaseRequestIdOf = function (nowMs: any, salt: any) {
  const ms: number = typeof nowMs === 'number' && isFinite(nowMs) ? Math.floor(nowMs) : Date.now()
  const tail: string = vcRebaseStrOf(salt).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return 'r' + ms.toString(36) + (tail === '' ? '' : '-' + tail)
}

// 四条写动作在什么状态下可见：没有进行中的操作、且仓库没开 rebase.updateRefs 时才出现（否则先处理）。
export const vcRebaseVisibleOf = function (state: any, updateRefs: any) {
  const s: string = vcRebaseStrOf(state)
  const writeOps: string[] = []
  for (let i = 0; i < VC_REBASE_OPS.length; i += 1) if (VC_REBASE_OPS[i].write === true) writeOps.push(VC_REBASE_OPS[i].op)
  if (updateRefs === true) return []
  if (s !== '' && s !== 'clean' && s !== 'none') return []
  return writeOps
}

// 把待办窗口里的提交整理成界面行：默认全是 pick，正文清空；顺序就是待办的初始顺序。
export const vcRebaseRowsOf = function (commits: any) {
  const list: any[] = Array.isArray(commits) ? commits : []
  return list.map(function (c: any) {
    return {
      oid: vcRebaseStrOf(c && c.oid),
      subject: vcRebaseStrOf(c && c.subject),
      action: 'pick',
      message: '',
    }
  })
}

// 上移/下移：返回新数组（原数组不动）；到头或到尾就原样返回，界面不画按钮时也安全。
export const vcRebaseMoveOf = function (rows: any, index: any, dir: any) {
  const src: any[] = Array.isArray(rows) ? rows.slice() : []
  const i: number = typeof index === 'number' && isFinite(index) ? Math.floor(index) : -1
  if (i < 0 || i >= src.length) return src
  const j: number = vcRebaseStrOf(dir) === 'move-up' ? i - 1 : i + 1
  if (j < 0 || j >= src.length) return src
  const tmp: any = src[i]
  src[i] = src[j]
  src[j] = tmp
  return src
}

// 改一行的动作或说明：返回新数组，字段原样保留（改动作不清说明，改说明不动动作）。
export const vcRebaseRowPatchOf = function (rows: any, index: any, patch: any) {
  const src: any[] = Array.isArray(rows) ? rows.map(function (r: any) { return Object.assign({}, r) }) : []
  const i: number = typeof index === 'number' && isFinite(index) ? Math.floor(index) : -1
  if (i < 0 || i >= src.length) return src
  const keys: string[] = Object.keys(patch || {})
  for (let k = 0; k < keys.length; k += 1) src[i][keys[k]] = patch[keys[k]]
  return src
}

// 由当前输入值拼出载荷：字段名与宿主预检读取一致（base / rows / oldBase / newBase），不拼命令。
export const vcRebasePayloadOf = function (op: any, values: any) {
  const meta: any = vcRebaseOpMetaOf(op)
  const v: any = values || {}
  if (!meta) return {}
  if (meta.needs === 'todo') {
    const rows: any[] = Array.isArray(v.rows) ? v.rows : []
    return { base: vcRebaseStrOf(v.base), rows: rows.map(function (r: any) {
      const row: any = { oid: vcRebaseStrOf(r && r.oid), action: vcRebaseStrOf(r && r.action) }
      if (row.action === 'reword') row.message = vcRebaseStrOf(r && r.message)
      return row
    }) }
  }
  if (meta.needs === 'onto') return { oldBase: vcRebaseStrOf(v.oldBase), newBase: vcRebaseStrOf(v.newBase) }
  if (meta.needs === 'base') return { base: vcRebaseStrOf(v.base) }
  return {}
}

// 预检电话的参数：动作与载荷；只读动作可以走同一条预检电话，也可以走读数电话，参数形状相同。
export const vcRebaseCheckArgsOf = function (cwd: any, op: any, values: any) {
  const args: any = { cwd: vcRebaseStrOf(cwd), op: vcRebaseStrOf(op) }
  const payload: any = vcRebasePayloadOf(op, values)
  Object.keys(payload).forEach(function (k: string) { args[k] = payload[k] })
  return args
}

// 读数电话的参数：与预检同一个形状；只读动作不打 ticketId。
export const vcRebaseReadArgsOf = function (cwd: any, op: any, values: any) {
  return vcRebaseCheckArgsOf(cwd, op, values)
}

// 执行电话的参数：票号、请求号、确认一律带上；载荷原样展开（宿主按 op 读同一个字段名）。
export const vcRebaseWriteArgsOf = function (cwd: any, op: any, values: any, ticketId: any, requestId: any) {
  const args: any = vcRebaseCheckArgsOf(cwd, op, values)
  args.ticketId = vcRebaseStrOf(ticketId)
  args.requestId = vcRebaseStrOf(requestId)
  args.confirmed = true
  return args
}

// 确认卡「会动什么」那一段：待办给基座与行数，换基座给新旧基座，另外两条给基座。
export const vcRebaseTargetOf = function (op: any, values: any, t: any) {
  const payload: any = vcRebasePayloadOf(op, values)
  if (payload.oldBase !== undefined || payload.newBase !== undefined) {
    return vcRebaseStrOf(payload.oldBase) + ' → ' + vcRebaseStrOf(payload.newBase)
  }
  const base: string = vcRebaseStrOf(payload.base)
  if (base === '') return ''
  if (Array.isArray(payload.rows)) {
    const count: number = payload.rows.length
    return (typeof t === 'function') ? t('vc.rebase.target.todo', { base: base, n: count }) : base + ' (' + String(count) + ')'
  }
  return base
}

// 待办行的行文本：oid 短写 + 说明；界面拿它画清单，门禁拿它对账。
export const vcRebaseRowTextOf = function (row: any) {
  const oid: string = vcRebaseStrOf(row && row.oid)
  const subject: string = vcRebaseStrOf(row && row.subject)
  return oid.slice(0, 10) + (subject === '' ? '' : ' ' + subject)
}

export const VC_REBASE_OPS_SOURCE = 'src/client/views/versionControl/vcRebaseOps.ts'
