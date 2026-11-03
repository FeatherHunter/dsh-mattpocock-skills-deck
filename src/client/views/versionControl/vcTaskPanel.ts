// views/versionControl/vcTaskPanel.ts —— 长任务区（#1740；#1845 按定稿原型重排成三段）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处
// （源码树里只有这一份真源）。叶子登记由集成分支统一接线，本文件只写能力本身。
//
// 职责只有四件：
//   1. 把三条任务电话打成一个固定形状（开始、查询、取消），界面不自己拼电话名；
//   2. 把任务记录翻成进度模型：git 报出真实百分比就照着说，报不出就如实说不确定，不瞎编；
//   3. 把任务记录翻成结论模型：成功 / 失败 / 已取消 / 已中断四类，各自带自己的说明；
//   4. 把上面两个模型画成节点：在途的行有取消按钮，结束的行给结论、失败原因与残留说明。
//
// #1845 起任务页正文分四段；页头（返回、标题、导语）由外壳统一画，这里不再画页级标题：
//   一、选一种长任务：三种长任务各一行，只说明用途与等宽 git 命令。现有组件没有三种任务各自的
//       发起入口，所以只作说明、不造按钮也不接新回调——票面明确禁止顺手加能力；
//   二、进度：运行中任务给真实读数与四阶段行；git 还没报出百分比就四段全灰、补一句说明，
//       绝不放假动画。阶段点位只用来判断「走到哪一段」，真实读数永远来自任务的 percent；
//   三、任务清单：计数、空态与任务行。行内既有 data-vc-* 属性与取消入口一条不动，既有门禁按它们认能力；
//   四、取消之后：静态说明取消留下什么、由谁清理、怎么重来。只有文案，不画按钮，也不改取消与重试语义。
// 重排只改渲染结构：开始/查询/取消的载荷、确认流程与结论判定都不动。
//
// 界面一个中文字面量都没有：可见文字全走 t(词条)，词条真源在 config/copy/vctask.yaml。
// 节点构造函数 h 与取词函数 t 都从参数传入；页壳原语（分区、对象行、芯片、进度条、提示）由同一
// 闭包里的 vcPageHead.ts / vcFlowParts.ts 提供，本文件只声明、不实现，门禁求值时把两份源码一起拼进来。

/** 三条任务电话的名字：与宿主注册（src/host/index.ts）和任务运行器一一对应。 */
export const VC_TASK_PHONES: Record<string, string> = {
  start: 'wf.gitTaskStart',
  query: 'wf.gitTaskQuery',
  cancel: 'wf.gitTaskCancel',
}

/** 页壳原语由同一闭包里的其它叶子定义；这里只声明，构建转译时整行被剥掉，不会重复实现。 */
declare function vcPageSectionNode(h: any, t: any, o: any): any
declare function vcPageObjRowNode(h: any, t: any, o: any): any
declare function vcFlowChipNode(h: any, t: any, o: any): any
declare function vcFlowMeterNode(h: any, t: any, o: any): any
declare function vcFlowHintNode(h: any, t: any, o: any): any

/** 动作名到文案键：动作名是短横线串（submodule-init），词条键是驼峰（submoduleInit）。 */
const VC_TASK_OP_CAMEL = function (op: any) {
  return String(op || '').replace(/-([a-z])/g, function (_m: any, c: string) { return c.toUpperCase() })
}

/** 二十种动作共用一族词条：vc.task.op.<驼峰动作名>。认不出的动作名也给一个键，由词表兜底。 */
export const vcTaskOpLabelKeyOf = function (op: any) {
  return 'vc.task.op.' + VC_TASK_OP_CAMEL(op)
}

/** 一条任务的动作词条键：任务自带 labelKey 时优先用它（诊断页会传），否则按动作名拼。 */
const vcTaskOpKeyOf = function (task: any) {
  const tk = task || {}
  return tk.labelKey ? String(tk.labelKey) : vcTaskOpLabelKeyOf(tk.op)
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

/** 三种长任务的说明行：动作名 → 用途说明与 git 命令的词条键。只用于本页说明，不发起任何任务。 */
const VC_TASK_MODE_ROWS = [
  { op: 'clone', noteKey: 'vc.task.mode.cloneNote', commandKey: 'vc.task.mode.cloneCommand' },
  { op: 'archive', noteKey: 'vc.task.mode.archiveNote', commandKey: 'vc.task.mode.archiveCommand' },
  { op: 'bundle', noteKey: 'vc.task.mode.bundleNote', commandKey: 'vc.task.mode.bundleCommand' },
]

/**
 * 四个阶段与它们的点位（0 / 20 / 85 / 100），与定稿原型 pages-flow.ts 的 TASK_STAGES 是同一组。
 * 点位只用来判断「走到哪一段、哪些段已完成」；真实读数永远来自任务的 percent，点位本身不是进度。
 */
const VC_TASK_STAGES = [
  { at: 0, key: 'vc.task.stage.prepare', detailKey: 'vc.task.stage.prepareDetail' },
  { at: 20, key: 'vc.task.stage.receive', detailKey: 'vc.task.stage.receiveDetail' },
  { at: 85, key: 'vc.task.stage.checkout', detailKey: 'vc.task.stage.checkoutDetail' },
  { at: 100, key: 'vc.task.stage.verify', detailKey: 'vc.task.stage.verifyDetail' },
]

/** 结论状态 → 芯片色调：中断用琥珀而不是红——它是不确定，不等于失败，红色留给真的失败。 */
const VC_TASK_CONCLUSION_TONES: Record<string, string> = { succeeded: 'ok', failed: 'danger', cancelled: 'muted', interrupted: 'warn' }

/**
 * 画四阶段行：四个点位（0 / 20 / 85 / 100）是各阶段的**起点**——percent 到达哪个点位，就说明已经进了
 * 哪一段；最后到达的那一段是「进行中」（琥珀），它之前的段已完成（绿），之后的段待处理（灰）。
 * percent 正好到 100 时四段全部已完成（完成校验在 100 这一点一次性收尾，与原型 50 的完成态一致）。
 * 反例：旧写法拿「第一个 percent < at」当当前段，62% 会跳到还没开始的「检出文件」并把它标成进行中，
 * 而真实情况是仍在「接收对象」区间 [20, 85)；所以这里按「最后一个 at <= percent 的段」取当前段。
 * percent 为 null（git 还没报出读数）时四段全部灰——点位只是分段依据，绝不拿点位冒充真实进度。
 */
const vcTaskStageRowsOf = function (h: any, t: any, percent: any) {
  const real = typeof percent === 'number' && isFinite(percent)
  const allDone = real && percent >= 100
  // 没有真实读数时 activeIndex 留在 -1，四段全部落到「等待」；100 时也不需要当前段。
  let activeIndex = -1
  if (real && !allDone) {
    activeIndex = 0
    for (let i = 0; i < VC_TASK_STAGES.length; i++) {
      if (percent >= VC_TASK_STAGES[i].at) activeIndex = i
    }
  }
  return VC_TASK_STAGES.map(function (stage: any, index: number) {
    const done = allDone || (real && index < activeIndex)
    const current = real && !allDone && index === activeIndex
    const chipKey = done ? 'vc.task.stage.done' : (current ? 'vc.task.stage.active' : 'vc.task.stage.waiting')
    const tone = done ? 'ok' : (current ? 'warn' : 'muted')
    return vcPageObjRowNode(h, t, {
      main: [
        h('div', { key: 'name', className: 'vcs-task-phase' }, t(stage.key)),
        h('div', { key: 'detail' }, t(stage.detailKey)),
      ],
      side: [vcFlowChipNode(h, t, { key: chipKey, tone: tone })],
    })
  })
}

/** 画三种长任务的说明行：标题、一句用途、等宽 git 命令。只作说明，不画按钮也不接回调。 */
const vcTaskModeRowsOf = function (h: any, t: any) {
  return VC_TASK_MODE_ROWS.map(function (mode: any) {
    return vcPageObjRowNode(h, t, {
      main: [
        h('div', { key: 'name', className: 'vcs-task-op' }, t(vcTaskOpLabelKeyOf(mode.op))),
        h('div', { key: 'note' }, t(mode.noteKey)),
        h('div', { key: 'command', className: 'vcs-flow-cmd' }, t(mode.commandKey)),
      ],
      side: [],
    })
  })
}

/**
 * 画运行中任务在进度段里的一份：动作名 + 「正在运行」芯片；有真实读数才画进度条，然后固定四阶段行。
 * 读数缺失时补一句说明——宁可直说不知道，也不放一个占位百分比或假动画。
 */
const vcTaskProgressBlockOf = function (h: any, t: any, task: any) {
  const model = vcTaskProgressOf(task)
  const kids: any[] = []
  kids.push(vcPageObjRowNode(h, t, {
    main: [h('span', { key: 'op', className: 'vcs-task-op' }, t(vcTaskOpKeyOf(task)))],
    side: [vcFlowChipNode(h, t, { key: 'vc.task.running', tone: 'warn' })],
  }))
  if (model.percent !== null) {
    kids.push(vcFlowMeterNode(h, t, { percent: model.percent, labelKey: 'vc.task.percent' }))
  }
  kids.push(vcTaskStageRowsOf(h, t, model.percent))
  if (model.percent === null) {
    kids.push(vcFlowHintNode(h, t, { key: 'vc.task.percentUncertainNote' }))
  }
  return kids
}

/**
 * 画一条任务：正文（标题行、进度行、阶段行、字节与耗时行、截断标记、结束后的说明）放 obj-row 左侧，
 * 右侧永远是「这条任务此刻的状态入口」——运行中是取消按钮，已结束是结论芯片。
 * handlers.onCancel(taskId) 由页面传入；没传就不画按钮，不让节点引用未定义的闭包函数。
 * data-vc-task-* 属性与取消按钮的 data-press / data-log / onClick 一律保持原样，既有门禁按它们认能力。
 */
export const vcTaskRowNode = function (h: any, t: any, task: any, handlers: any) {
  const tk = task || {}
  const hs = handlers || {}
  const id = String(tk.taskId || '')
  const state = String(tk.state || 'running')
  const running = state === 'running'
  const model = vcTaskProgressOf(tk)
  const main: any[] = []

  const headKids: any[] = [h('span', { key: 'op', className: 'vcs-task-op' }, t(vcTaskOpKeyOf(tk)))]
  if (running) headKids.push(h('span', { key: 'state', className: 'vcs-task-state', 'data-vc-task-running': '1' }, t('vc.task.running')))
  main.push(h('div', { key: 'head', className: 'vcs-task-head' }, headKids))

  if (model.percent !== null) {
    main.push(h('div', { key: 'percent', className: 'vcs-task-percent', 'data-vc-task-percent': String(model.percent) }, t('vc.task.percent', { percent: String(model.percent) })))
  } else if (running) {
    main.push(h('div', { key: 'percent', className: 'vcs-task-percent', 'data-vc-task-uncertain': '1' }, t('vc.task.percentUnknown')))
  }

  if (model.phase !== null) {
    main.push(h('div', { key: 'phase', className: 'vcs-task-phase', 'data-vc-task-phase': model.phase }, t('vc.task.phase', { phase: model.phase })))
  } else if (running) {
    main.push(h('div', { key: 'phase', className: 'vcs-task-phase' }, t('vc.task.phaseUnknown')))
  }

  if (model.receivedBytes !== null) {
    main.push(h('div', { key: 'bytes', className: 'vcs-task-bytes', 'data-vc-task-bytes': String(model.receivedBytes) }, t('vc.task.bytes', { bytes: String(model.receivedBytes) })))
  }
  if (model.elapsedMs !== null) {
    main.push(h('div', { key: 'elapsed', className: 'vcs-task-elapsed', 'data-vc-task-elapsed': String(model.elapsedMs) }, t('vc.task.elapsed', { ms: String(model.elapsedMs) })))
  }
  if (model.truncated) {
    main.push(h('div', { key: 'truncated', className: 'vcs-task-truncated', 'data-vc-task-truncated': '1' }, t('vc.task.truncated')))
  }

  const side: any[] = []
  const concl = vcTaskConclusionOf(tk)
  if (!running && concl) {
    side.push(h('div', { key: 'conclusion', className: 'vcs-task-conclusion', 'data-vc-task-conclusion': concl.state }, [
      vcFlowChipNode(h, t, { key: concl.key, tone: VC_TASK_CONCLUSION_TONES[concl.state] || 'muted' }),
    ]))
    if (concl.noteKey) {
      main.push(h('div', { key: 'conclusion-note', className: 'vcs-task-conclusion-note', 'data-vc-task-note': concl.noteKey }, t(concl.noteKey, concl.noteParams)))
    }
  }
  if (running && typeof hs.onCancel === 'function') {
    side.push(h('button', {
      key: 'cancel',
      className: 'vcs-flow-btn vcs-flow-btn-danger',
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

  return h('li', { key: id || 'task', className: 'vcs-task-row', 'data-vc-task-row': '1', 'data-vc-task-id': id, 'data-vc-task-state': state }, [
    vcPageObjRowNode(h, t, { main: main, side: side }),
  ])
}

/**
 * 画任务区：根 section 保留 data-vc-task-area=1，正文按原型分成四段（说明、进度、清单、取消之后）。
 * 页面把任务清单与 onCancel 一起交进来；段内的计数、空态与列表结构沿用旧口径，只有摆放位置变了。
 */
export const vcTaskPanelNode = function (h: any, t: any, opts: any) {
  const o = opts || {}
  const tasks: any[] = Array.isArray(o.tasks) ? o.tasks : []
  const running = typeof o.running === 'number' ? o.running : tasks.filter(function (task: any) { return task && String(task.state || '') === 'running' }).length
  const runningTasks = tasks.filter(function (task: any) { return task && String(task.state || '') === 'running' })
  const kids: any[] = []

  kids.push(vcPageSectionNode(h, t, {
    title: 'vc.task.modesTitle',
    count: 3,
    note: 'vc.task.modesNote',
    children: vcTaskModeRowsOf(h, t),
  }))

  const progressKids: any[] = []
  if (runningTasks.length > 0) {
    runningTasks.forEach(function (task: any, index: number) {
      progressKids.push(h('div', { key: 'progress-' + index }, vcTaskProgressBlockOf(h, t, task)))
    })
  } else {
    // 空闲时把四个阶段画成灰色：让读者先知道长任务会经过哪几步，但一个字都不冒充当前进度。
    progressKids.push(vcTaskStageRowsOf(h, t, null))
    progressKids.push(vcFlowHintNode(h, t, { key: 'vc.task.idleNote' }))
  }
  kids.push(vcPageSectionNode(h, t, {
    title: 'vc.task.progressTitle',
    note: 'vc.task.progressNote',
    children: progressKids,
  }))

  const listKids: any[] = [h('p', { key: 'count', className: 'vcs-task-count', 'data-vc-task-running': String(running) }, t('vc.task.count', { n: String(running) }))]
  if (tasks.length === 0) {
    listKids.push(h('p', { key: 'empty', className: 'vcs-task-empty', 'data-vc-task-empty': '1' }, t('vc.task.empty')))
  } else {
    listKids.push(h('ul', { key: 'list', className: 'vcs-task-list' }, tasks.map(function (task: any) {
      return vcTaskRowNode(h, t, task, o)
    })))
  }
  kids.push(vcPageSectionNode(h, t, { title: 'vc.task.listTitle', children: listKids }))

  // 「取消之后」是原型 50 的静态说明段：只讲取消留下什么、由谁清理、怎么重来。取消与重试的语义
  // 完全由任务行右侧的取消入口和宿主写在结论里的残留说明负责，这里不画按钮、不接回调、不改任何行为。
  kids.push(vcPageSectionNode(h, t, {
    title: 'vc.task.cancelAfterTitle',
    note: 'vc.task.cancelAfterNote',
    children: [h('p', { key: 'retry', className: 'section-note' }, t('vc.task.cancelAfterRetry'))],
  }))

  return h('section', { key: 'tasks', className: 'vcs-tasks', 'data-vc-task-area': '1' }, kids)
}
