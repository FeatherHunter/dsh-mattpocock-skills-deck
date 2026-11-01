// views/versionControl/vcTaskPanel.ts —— 长任务区（#1740）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处
// （源码树里只有这一份真源）。叶子登记由集成分支统一接线，本文件只写能力本身。
//
// 职责只有四件：
//   1. 把三条任务电话打成一个固定形状（开始、查询、取消），界面不自己拼电话名；
//   2. 把任务记录翻成进度模型：git 报出真实百分比就照着说，报不出就如实说不确定，不瞎编；
//   3. 把任务记录翻成结论模型：成功 / 失败 / 已取消 / 已中断四类，各自带自己的说明；
//   4. 把上面两个模型画成节点：在途的行有取消按钮，结束的行给结论、失败原因与残留说明。
//
// 界面一个中文字面量都没有：可见文字全走 t(词条)，词条真源在 config/copy/vctask.yaml。
// 节点构造函数 h 与取词函数 t 都从参数传入，本文件不引用任何闭包全局，门禁可以直接求值。

/** 三条任务电话的名字：与宿主注册（src/host/index.ts）和任务运行器一一对应。 */
export const VC_TASK_PHONES: Record<string, string> = {
  start: 'wf.gitTaskStart',
  query: 'wf.gitTaskQuery',
  cancel: 'wf.gitTaskCancel',
}

/** 动作名到文案键：动作名是短横线串（submodule-init），词条键是驼峰（submoduleInit）。 */
const VC_TASK_OP_CAMEL = function (op: any) {
  return String(op || '').replace(/-([a-z])/g, function (_m: any, c: string) { return c.toUpperCase() })
}

/** 十七种动作共用一族词条：vc.task.op.<驼峰动作名>。认不出的动作名也给一个键，由词表兜底。 */
export const vcTaskOpLabelKeyOf = function (op: any) {
  return 'vc.task.op.' + VC_TASK_OP_CAMEL(op)
}

/** 一次开始请求的 requestId（宿主只要求 [A-Za-z0-9_-] 且不超过 64）。同一请求号重放回上次结果。 */
export const vcTaskRequestIdOf = function (nowMs: any, salt: any) {
  return 't' + Number(nowMs || 0).toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

/**
 * 开始一条长任务。只整形参数，不重复写守卫：动作清单、确认、输入文件形状的校验都在协议层，
 * 界面多写一份只会与那边慢慢分叉。stdinFile 只在 fast-import 这一档才会从界面带上来。
 */
export const vcTaskStart = function (call: any, cwd: any, op: any, payload: any) {
  const p = payload || {}
  const args: any = {
    cwd: String(cwd || ''),
    op: String(op || ''),
    args: (p.args && typeof p.args === 'object') ? p.args : {},
  }
  if (p.confirm === true) args.confirm = true
  if (p.requestId) args.requestId = String(p.requestId)
  if (p.stdinFile && typeof p.stdinFile === 'object') {
    // 只把路径、大小与摘要交给宿主；文件内容始终由宿主自己打开与校验，界面不读文件。
    args.stdinFile = {
      path: String(p.stdinFile.path || ''),
      sizeBytes: p.stdinFile.sizeBytes,
      sha256: String(p.stdinFile.sha256 || ''),
    }
  }
  return call(VC_TASK_PHONES.start, args)
}

/** 查询任务清单与运行中详情。没有参数：任务属于当前会话的工作区，由宿主自己认。 */
export const vcTaskQuery = function (call: any) {
  return call(VC_TASK_PHONES.query, {})
}

/** 取消一条在途任务。宿主先软取消（发终止信号），宽限期内没退再强杀，结论仍如实写「已取消」。 */
export const vcTaskCancel = function (call: any, taskId: any) {
  return call(VC_TASK_PHONES.cancel, { taskId: String(taskId || '') })
}

/**
 * 任务记录 → 进度模型：{ phase, percent, uncertain, receivedBytes, elapsedMs, truncated }。
 * percent 只有落在 0..100 的有限数字才算真实百分比；没有就回 null，在途任务标 uncertain，
 * 界面据此显示「进度暂时无法确定」而不是随便编一个数。
 */
export const vcTaskProgressOf = function (task: any) {
  const t = task || {}
  const raw = t.percent
  const percent = (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw <= 100) ? Math.round(raw) : null
  return {
    phase: (typeof t.phase === 'string' && t.phase.length > 0) ? t.phase : null,
    percent: percent,
    uncertain: String(t.state || '') === 'running' && percent === null,
    receivedBytes: (typeof t.receivedBytes === 'number') ? t.receivedBytes : null,
    elapsedMs: (typeof t.elapsedMs === 'number') ? t.elapsedMs : null,
    truncated: t.truncated === true,
  }
}

/** 四类结论的文案键。顺序即判据：中断优先于其它结论，避免把重启过的任务说成完成。 */
const VC_TASK_CONCLUSIONS = ['succeeded', 'failed', 'cancelled', 'interrupted']

/**
 * 任务记录 → 结论模型：{ state, key, params, noteKey, noteParams }。
 * 在途任务没有结论，回 null；不认识的结论按「已失败」兜底，绝不显示成已完成。
 */
export const vcTaskConclusionOf = function (task: any) {
  const t = task || {}
  const interrupted = t.interrupted === true || String(t.conclusion || '') === 'interrupted'
  if (interrupted) {
    return { state: 'interrupted', key: 'vc.task.doneInterrupted', params: {}, noteKey: 'vc.task.interruptedNote', noteParams: {} }
  }
  const raw = String(t.conclusion || '')
  if (!raw) return null
  const state = VC_TASK_CONCLUSIONS.indexOf(raw) >= 0 ? raw : 'failed'
  if (state === 'succeeded') {
    return { state: 'succeeded', key: 'vc.task.doneSucceeded', params: {}, noteKey: '', noteParams: {} }
  }
  if (state === 'cancelled') {
    const residual = String(t.residual || '')
    return { state: 'cancelled', key: 'vc.task.doneCancelled', params: {}, noteKey: residual ? 'vc.task.residual' : '', noteParams: residual ? { residual: residual } : {} }
  }
  const line = String(t.failureLine || '')
  const residual = String(t.residual || '')
  if (line) {
    return { state: 'failed', key: 'vc.task.doneFailed', params: {}, noteKey: 'vc.task.doneFailedLine', noteParams: { line: line } }
  }
  return { state: 'failed', key: 'vc.task.doneFailed', params: {}, noteKey: residual ? 'vc.task.residual' : '', noteParams: residual ? { residual: residual } : {} }
}

/**
 * 画一条任务：标题行（动作名 + 在途标记）、进度行（真实百分比或「无法确定」）、阶段行、
 * 字节与耗时行、截断标记、结论行与说明，最后是在途任务才有的取消按钮。
 * handlers.onCancel(taskId) 由页面传入；没有传就不画按钮，不让节点引用未定义的闭包函数。
 */
export const vcTaskRowNode = function (h: any, t: any, task: any, handlers: any) {
  const tk = task || {}
  const hs = handlers || {}
  const id = String(tk.taskId || '')
  const state = String(tk.state || 'running')
  const running = state === 'running'
  const model = vcTaskProgressOf(tk)
  const kids: any[] = []

  const headKids: any[] = [h('span', { key: 'op', className: 'vcs-task-op' }, t(tk.labelKey ? String(tk.labelKey) : vcTaskOpLabelKeyOf(tk.op)))]
  if (running) headKids.push(h('span', { key: 'state', className: 'vcs-task-state', 'data-vc-task-running': '1' }, t('vc.task.running')))
  kids.push(h('div', { key: 'head', className: 'vcs-task-head' }, headKids))

  if (model.percent !== null) {
    kids.push(h('div', { key: 'percent', className: 'vcs-task-percent', 'data-vc-task-percent': String(model.percent) }, t('vc.task.percent', { percent: String(model.percent) })))
  } else if (running) {
    kids.push(h('div', { key: 'percent', className: 'vcs-task-percent', 'data-vc-task-uncertain': '1' }, t('vc.task.percentUnknown')))
  }

  if (model.phase !== null) {
    kids.push(h('div', { key: 'phase', className: 'vcs-task-phase', 'data-vc-task-phase': model.phase }, t('vc.task.phase', { phase: model.phase })))
  } else if (running) {
    kids.push(h('div', { key: 'phase', className: 'vcs-task-phase' }, t('vc.task.phaseUnknown')))
  }

  if (model.receivedBytes !== null) {
    kids.push(h('div', { key: 'bytes', className: 'vcs-task-bytes', 'data-vc-task-bytes': String(model.receivedBytes) }, t('vc.task.bytes', { bytes: String(model.receivedBytes) })))
  }
  if (model.elapsedMs !== null) {
    kids.push(h('div', { key: 'elapsed', className: 'vcs-task-elapsed', 'data-vc-task-elapsed': String(model.elapsedMs) }, t('vc.task.elapsed', { ms: String(model.elapsedMs) })))
  }
  if (model.truncated) {
    kids.push(h('div', { key: 'truncated', className: 'vcs-task-truncated', 'data-vc-task-truncated': '1' }, t('vc.task.truncated')))
  }

  const concl = vcTaskConclusionOf(tk)
  if (!running && concl) {
    const conclKids: any[] = [h('span', { key: 'main', className: 'vcs-task-conclusion-main' }, t(concl.key))]
    if (concl.noteKey) {
      conclKids.push(h('span', { key: 'note', className: 'vcs-task-conclusion-note', 'data-vc-task-note': concl.noteKey }, t(concl.noteKey, concl.noteParams)))
    }
    kids.push(h('div', { key: 'conclusion', className: 'vcs-task-conclusion', 'data-vc-task-conclusion': concl.state }, conclKids))
  }

  if (running && typeof hs.onCancel === 'function') {
    kids.push(h('button', {
      key: 'cancel',
      className: 'dsws-btn dsws-hov',
      type: 'button',
      'data-press': 'button',
      'data-vc-task-cancel': '1',
      'data-log': 'vc.task.cancel',
      onClick: function (ev: any) {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation()
        hs.onCancel(id)
      },
    }, t('vc.task.cancel')))
  }

  return h('li', { key: id || 'task', className: 'vcs-task-row', 'data-vc-task-row': '1', 'data-vc-task-id': id, 'data-vc-task-state': state }, kids)
}

/**
 * 画任务区：标题、正在运行几项的计数、任务列表（空时给一句说明）。
 * 页面把任务清单与 onCancel 一起交进来；没有任务数据时整块不画由调用方决定。
 */
export const vcTaskPanelNode = function (h: any, t: any, opts: any) {
  const o = opts || {}
  const tasks: any[] = Array.isArray(o.tasks) ? o.tasks : []
  const running = typeof o.running === 'number' ? o.running : tasks.filter(function (task: any) { return task && String(task.state || '') === 'running' }).length
  const kids: any[] = []
  kids.push(h('h4', { key: 'title', className: 'vcs-task-title' }, t('vc.task.title')))
  kids.push(h('p', { key: 'count', className: 'vcs-task-count', 'data-vc-task-running': String(running) }, t('vc.task.count', { n: String(running) })))
  if (tasks.length === 0) {
    kids.push(h('p', { key: 'empty', className: 'vcs-task-empty', 'data-vc-task-empty': '1' }, t('vc.task.empty')))
  } else {
    kids.push(h('ul', { key: 'list', className: 'vcs-task-list' }, tasks.map(function (task: any) {
      return vcTaskRowNode(h, t, task, o)
    })))
  }
  return h('section', { key: 'tasks', className: 'vcs-tasks', 'data-vc-task-area': '1' }, kids)
}
