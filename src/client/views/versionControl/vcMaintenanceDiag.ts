// views/versionControl/vcMaintenanceDiag.ts —— 管理 › 诊断页正文（#1758 T22，规格 #1586 域 11 的 11.2–11.4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一页只画「管理·诊断」的三件事：
//   ① 11.2 / 11.3 完整性检查：两条 fsck 走长任务通道（开始 → 看进度、可取消 → 四类结论），
//      结果给出两个出口的说明（从这里建分支 / 把对象导出成离线包），面板只指路不代做；
//   ② 11.3 不可达对象清单：条数、最早时间、逐条对象号与类型；打包后的对象读不到时间就如实说不确定；
//   ③ 11.4 对象读数：松散对象、包、体积，与维护页常驻的是同一份读数。
// 这四条能力都是只读的：面板不在这里提供任何写动作，清理在维护页的危险区里做。
//
// 判定与命令拼装的真源在共享层 maintenance-ops.ts 与长任务协议 task-protocol.ts；
// 可见文字全部走 t(词条)，词条真源 config/copy/vcmaintenance.yaml，界面一个中文字面量都没有。

/** 跨叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。 */
declare const React: any
declare const Tip: any
declare const VC_TASK_POLL_INTERVAL_MS: number
declare function vcWriteErrFamilyOf(reason: any, kind: any): string
declare function vcTaskRowNode(h: any, t: any, task: any, handlers: any): any
declare function vcTaskConclusionOf(task: any): any
declare const VC_MAINTENANCE_PHONES: Record<string, string>
declare function vcMaintenanceOpLabelKeyOf(op: any): string
declare function vcMaintenanceOpVerbKeyOf(op: any): string
declare function vcMaintenanceRequestIdOf(nowMs: any, salt: any): string
declare function vcMaintenanceReadArgsOf(cwd: any, op: any): any
declare function vcMaintenanceTaskArgsOf(cwd: any, op: any, requestId: any): any
declare function vcMaintenanceFailTextOf(t: any, reply: any, familyOf: any): string
declare function vcMaintenanceObjectsOf(reply: any): any
declare function humanBytesOf(n: any): string

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_MAINTENANCE_DIAG_SOURCE = 'src/client/views/versionControl/vcMaintenanceDiag.ts'

/** 诊断页上走长任务通道的两条检查；顺序与能力编号 11.2、11.3 一致。 */
export const VC_MAINTENANCE_DIAG_TASKS: string[] = ['fsck-basic', 'fsck-unreachable']

/** 不可达对象清单的展示上限：再多也只多显示一行「还有更多」，不把页面撑爆。 */
export const VC_MAINTENANCE_DIAG_ITEM_LIMIT = 100

/** 两个出口的说明键：面板给出去处，真正的动作在别的入口里做，绝不在这里偷偷带副作用。 */
export const VC_MAINTENANCE_DIAG_EXITS: string[] = ['branch', 'offline']

const vcMaintDiagItemRowsOf = function (items: any): any[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, VC_MAINTENANCE_DIAG_ITEM_LIMIT).map(function (item: any, index: number) {
    return { key: 'item-' + index, oid: String((item && item.oid) || ''), type: String((item && item.type) || '') }
  })
}

const vcMaintDiagButtonOf = function (h: any, t: any, labelKey: any, logKey: any, disabled: any, onPress: any, tipKey: any) {
  const button = h('button', { type: 'button', className: 'dsws-btn dsws-hov', disabled: disabled === true, 'data-press': 'button', 'data-log': logKey, onClick: function () { if (disabled !== true && typeof onPress === 'function') onPress() } }, t(labelKey))
  if (!tipKey) return button
  return h(Tip, { content: t(tipKey) }, button)
}

/** 一条完整性检查的卡片：开始按钮 + 任务行（进度、取消、结论）+ 失败话术。 */
const vcMaintDiagTaskCardOf = function (h: any, t: any, op: any, state: any, task: any, handlers: any) {
  const kids: any[] = [
    h('h4', { key: 'title', 'data-vc-maint-diag-task-card': op }, t(vcMaintenanceOpLabelKeyOf(op))),
    h('p', { key: 'hint', className: 'vcs-muted' }, t('vc.maintenance.diag.taskHint.' + String(op || ''))),
  ]
  if (state.busy === true) kids.push(h('p', { key: 'busy', 'data-vc-maint-diag-busy': op }, t('vc.maintenance.busy')))
  else kids.push(Object.assign({}, vcMaintDiagButtonOf(h, t, vcMaintenanceOpVerbKeyOf(op), 'vc.maint.diag.start.' + op, false, function () { handlers.start(op) }, 'vc.maintenance.diag.taskTip.' + op), { key: 'start-' + op }))
  if (state.error) kids.push(h('p', { key: 'error', 'data-vc-maint-diag-error': op }, String(state.error)))
  if (task) kids.push(h('div', { key: 'task', 'data-vc-maint-diag-task': op }, vcTaskRowNode(h, t, task, { onCancel: function (taskId: any) { handlers.cancel(taskId) } })))
  return h('div', { key: op, className: 'vcs-card', 'data-vc-maint-diag-card': op }, kids)
}

/** 页面主体：两条完整性检查 + 不可达对象清单 + 对象读数。 */
export const vcMaintenanceDiagNode = function (props: any) {
  const t = props.t
  const cwd: string = String(props.cwd || '')
  const call: any = props.call
  const h = React.createElement
  const stateHook = React.useState({})
  const ops: any = stateHook[0]
  const setOps: any = stateHook[1]
  const taskHook = React.useState({ list: [], ids: {} })
  const taskState: any = taskHook[0]
  const setTaskState: any = taskHook[1]
  const readHook = React.useState({ unreachable: null, objects: null, at: '' })
  const readState: any = readHook[0]
  const setReadState: any = readHook[1]
  const alive = React.useRef(true)
  const timerRef = React.useRef(null)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false; if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } } }, [])

  const patchOp = function (op: string, patch: any) {
    setOps(function (prev: any) {
      const next: any = Object.assign({}, prev)
      next[op] = Object.assign({}, prev[op] || {}, patch, { id: op })
      return next
    })
  }
  const readOnce = function (op: string) {
    if (typeof call !== 'function') return Promise.resolve(null)
    return call(VC_MAINTENANCE_PHONES.read, vcMaintenanceReadArgsOf(cwd, op)).then(function (reply: any) {
      if (!alive.current) return null
      setReadState(function (prev: any) {
        const next: any = Object.assign({}, prev)
        if (op === 'unreachable') next.unreachable = reply
        else next.objects = vcMaintenanceObjectsOf(reply)
        next.at = String(reply && reply.readAtMs ? new Date(reply.readAtMs).toISOString() : prev.at)
        return next
      })
      return reply
    }).catch(function () { return null })
  }
  const poll = function () {
    if (typeof call !== 'function') return
    call(VC_MAINTENANCE_PHONES.taskQuery, {}).then(function (reply: any) {
      if (!alive.current) return
      const list: any[] = (reply && Array.isArray(reply.tasks)) ? reply.tasks : []
      setTaskState(function (prev: any) { return Object.assign({}, prev, { list: list }) })
      const running: boolean = list.some(function (task: any) { return String((task && task.state) || '') === 'running' })
      if (running && timerRef.current === null) {
        timerRef.current = setTimeout(function () { timerRef.current = null; poll() }, VC_TASK_POLL_INTERVAL_MS)
      }
    }).catch(function () {})
  }
  React.useEffect(function () { readOnce('unreachable'); readOnce('objects'); poll() }, [])

  const start = function (op: string) {
    if (typeof call !== 'function') return
    patchOp(op, { busy: true, error: '' })
    const requestId: string = vcMaintenanceRequestIdOf(Date.now(), op)
    call(VC_MAINTENANCE_PHONES.taskStart, vcMaintenanceTaskArgsOf(cwd, op, requestId)).then(function (reply: any) {
      if (!alive.current) return
      if (reply && reply.ok === true) {
        const task: any = reply.task || null
        setTaskState(function (prev: any) {
          const ids: any = Object.assign({}, prev.ids)
          if (task && task.taskId) ids[op] = String(task.taskId)
          return Object.assign({}, prev, { ids: ids })
        })
        patchOp(op, { busy: false })
        poll()
        return
      }
      patchOp(op, { busy: false, error: vcMaintenanceFailTextOf(t, reply, vcWriteErrFamilyOf) })
    }).catch(function () { if (alive.current) patchOp(op, { busy: false, error: t('vc.maintenance.fail.network') }) })
  }
  const cancel = function (taskId: any) {
    if (typeof call !== 'function' || !taskId) return
    call(VC_MAINTENANCE_PHONES.taskCancel, { taskId: String(taskId) }).then(function () { poll() }).catch(function () {})
  }
  const taskOf = function (op: string): any {
    const id: string = String((taskState.ids || {})[op] || '')
    if (!id) return null
    for (let i = 0; i < taskState.list.length; i += 1) {
      const task: any = taskState.list[i]
      if (task && String(task.taskId || '') === id) return task
    }
    return { taskId: id, state: 'running' }
  }

  const unreachable: any = readState.unreachable
  const unreachableRead: any = (unreachable && unreachable.ok === true) ? unreachable : null
  const objects: any = readState.objects
  const exitKids: any[] = VC_MAINTENANCE_DIAG_EXITS.map(function (id: string) {
    return h('p', { key: id, className: 'vcs-muted', 'data-vc-maint-exit': id }, t('vc.maintenance.diag.exit.' + id))
  })
  const itemRows: any[] = vcMaintDiagItemRowsOf(unreachableRead && unreachableRead.items)
  const kids: any[] = [
    h('h3', { key: 'title', 'data-vc-maint-diag-title': '1' }, t('vc.maintenance.diag.pageTitle')),
    h('p', { key: 'hint', className: 'vcs-muted' }, t('vc.maintenance.diag.pageHint')),
    h('section', { key: 'tasks', 'data-vc-maint-diag-tasks': '1' },
      VC_MAINTENANCE_DIAG_TASKS.map(function (op: string) { return vcMaintDiagTaskCardOf(h, t, op, ops[op] || {}, taskOf(op), { start: start, cancel: cancel }) })),
    h('section', { key: 'unreachable', className: 'vcs-card', 'data-vc-maint-unreachable': '1' },
      h('h4', null, t(vcMaintenanceOpLabelKeyOf('unreachable'))),
      h('p', { key: 'count', 'data-vc-maint-unreachable-count': String(unreachableRead && typeof unreachableRead.count === 'number' ? unreachableRead.count : '') },
        unreachableRead
          ? t('vc.maintenance.diag.unreachableLine', {
            count: String(unreachableRead.count || 0),
            earliest: unreachableRead.earliestAtMs ? new Date(unreachableRead.earliestAtMs).toISOString() : t('vc.maintenance.diag.earliestUnknown'),
          })
          : t('vc.maintenance.diag.unreachableUnknown')),
      h('p', { key: 'packed', className: 'vcs-muted', 'data-vc-maint-unreachable-note': '1' }, t('vc.maintenance.diag.unreachableNote')),
      itemRows.map(function (row: any) {
        return h('p', { key: row.key, 'data-vc-maint-unreachable-item': row.oid }, row.type + ' ' + row.oid)
      }),
      exitKids,
      vcMaintDiagButtonOf(h, t, 'vc.maintenance.diag.readAgain', 'vc.maint.diag.read.unreachable', false, function () { readOnce('unreachable') }, null)),
    h('section', { key: 'objects', className: 'vcs-card', 'data-vc-maint-diag-objects': '1' },
      h('h4', null, t(vcMaintenanceOpLabelKeyOf('objects'))),
      objects
        ? h('div', null,
          h('p', { key: 'loose', 'data-vc-maint-diag-object-row': 'loose' }, t('vc.maintenance.read.loose') + ': ' + String(objects.looseCount || 0)),
          h('p', { key: 'packs', 'data-vc-maint-diag-object-row': 'packs' }, t('vc.maintenance.read.packs') + ': ' + String(objects.packs || 0)),
          h('p', { key: 'size', 'data-vc-maint-diag-object-row': 'repoSize' }, t('vc.maintenance.read.repoSize') + ': ' + humanBytesOf(objects.repoSizeBytes || 0)))
        : h('p', { key: 'none', 'data-vc-maint-diag-object-empty': '1' }, t('vc.maintenance.read.empty')),
      vcMaintDiagButtonOf(h, t, 'vc.maintenance.diag.readAgain', 'vc.maint.diag.read.objects', false, function () { readOnce('objects') }, null)),
  ]
  return h('section', { id: 'vc-maintenance-diag', className: 'vcs-page', 'data-vc-maint-diag-page': '1', 'data-vc-maint-diag-count': String(VC_MAINTENANCE_DIAG_TASKS.length) }, kids)
}
