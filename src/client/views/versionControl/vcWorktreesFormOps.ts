// src/client/views/versionControl/vcWorktreesFormOps.ts —— 工作区页三张表单的处理动作（#1904 从 vcWorktreesOps 拆出）
//
// 为什么拆：处理层加上三张表单后超过 350 有效行上限；这里只放「表单里填了什么、提交后怎么落」，
//   预检 / 凭票执行 / 刷新 / 旧危险动作仍留在 vcWorktreesOps。
// 约定：
//   · 新建的三种错误（目录空、目录已被占用、本地没有这条分支）只写 form 自己的 error，不跳到页底结果条；
//   · 移动与稀疏检出的错误写在页底结果条（原型 93–97 同为页底一条）；
//   · 表单提交后直接走「预检 → 凭票执行」，不再多弹确认卡；危险动作（删除 / 锁定 / 清理）仍由旧路径确认。
// 本文件单独过 tsc 时看不到的东西（构建后同闭包里存在）：
declare function vcFirstScreenSliceStateOf(reads: any, id: any): string
declare function vcWorktreesModelOf(reads: any): any
declare function vcWorktreesPathTakenOf(model: any, path: any): boolean
declare function vcWorktreesPathSameOf(a: any, b: any): boolean
declare function vcWorktreeBaseNameOf(p: any): string

/** 本文件的短字符串归一：表单字段可能在假节点里是 undefined，统一成空串，别把 undefined 写进电话参数。 */
const vcWtFormStr = function (v: any): string {
  return String(v === undefined || v === null ? '' : v)
}

/** 清空后的输入形状：表单提交成功以后把上一件的 path/branch/dest/dirs 收掉，别让下一次行内动作顺手带上。 */
const vcWtFormBlankInput = function (): any {
  return { path: '', dest: '', branch: '', reason: '', dirs: [] }
}

/** 失败回包里的人话短句：优先 git 原话，其次宿主 message，最后兜一个错误种类。 */
const vcWtFormWhyTextOf = function (reply: any, result: any): string {
  const r: any = result || (reply && reply.result) || {}
  const e: any = (reply && reply.error) || {}
  const candidates: string[] = [vcWtFormStr(r.gitText), vcWtFormStr(e.gitText), vcWtFormStr(e.message), vcWtFormStr(r.actual), vcWtFormStr(e.kind || r.kind)]
  for (let i = 0; i < candidates.length; i += 1) if (candidates[i] !== '') return candidates[i]
  return ''
}

/** 失败细节：环节、git 原话、上游原因按有值的顺序拼起来，给结果条的第二行。 */
const vcWtFormDetailOf = function (reply: any, result: any): string {
  const r: any = result || (reply && reply.result) || {}
  const e: any = (reply && reply.error) || {}
  const parts: string[] = []
  const push = function (v: any): void { const s = vcWtFormStr(v); if (s !== '' && parts.indexOf(s) < 0) parts.push(s) }
  push(r.step || e.step)
  push(r.gitText || e.gitText)
  push(e.cause || r.cause)
  push(r.expected || e.expected)
  push(r.actual !== r.gitText ? r.actual : '')
  return parts.join(' · ')
}

/** 理由标识符 → 词条键；空理由回 ok 的说法，不把标识符原样印到界面上。 */
const vcWtFormWhyKeyOf = function (reason: any): string {
  const r = vcWtFormStr(reason)
  return r === '' ? 'vc.wt.why.ok' : 'vc.wt.why.' + r
}

/**
 * 表单处理层工厂。参数由 vcWorktreesOps 注入：begin（预检并可按 auto 直接执行）、setWt、uiNow、readsNow。
 * 返回值就是页面用的表单 handlers；它不直接发电话，电话都经过 begin。
 */
export const createWorktreesFormOpsOf = function (env: any): any {
  const e: any = env || {}
  const begin = e.begin
  const setWt = e.setWt
  const uiNow = e.uiNow
  const readsNow = e.readsNow
  const setLastResult = function (r: any): any { return setWt({ lastResult: r || null }) }
  /** 新建失败落在表单里（填错时要改的是这张表）；移动与稀疏检出落在页底结果条。 */
  const failCreate = function (reply: any, result: any, reason: string): any {
    const state: any = e.uiOf(uiNow())
    const key: string = reason ? vcWtFormWhyKeyOf(reason) : 'vc.wt.create.failed'
    setWt({
      mode: 'idle', op: '', decision: null, plan: null, ticket: null, result: null, error: null, requestId: '',
      create: Object.assign({}, state.create, { error: { key: key, params: reason ? {} : { why: vcWtFormWhyTextOf(reply, result) } } }),
    })
  }
  const failRowForm = function (kind: string, reply: any, result: any, reason: string): any {
    setWt({
      mode: kind === 'sparse' ? 'plan' : 'idle',
      op: kind === 'sparse' ? 'sparse-list' : '',
      decision: null, ticket: null, result: null, error: null, requestId: '',
      lastResult: {
        tone: 'error',
        textKey: reason ? vcWtFormWhyKeyOf(reason) : 'vc.wt.result.failed',
        textParams: reason ? {} : { why: vcWtFormWhyTextOf(reply, result) },
        detailText: reason ? '' : vcWtFormDetailOf(reply, result),
      },
    })
  }
  /** 新建成功：关表单、清输入、把新工作区记到清单最前，结果条写分支与新目录。 */
  const succeedCreate = function (op: string, input: any): any {
    const name: string = vcWorktreeBaseNameOf(input.path)
    const isNew: boolean = op === 'add'
    setWt({
      mode: 'idle', op: '', plan: null, ticket: null, result: null, error: null, requestId: '', input: vcWtFormBlankInput(),
      decision: null, lastCreated: vcWtFormStr(input.path),
      create: { open: false, path: '', branch: '', mode: e.uiOf(uiNow()).create.mode, error: null },
      lastResult: {
        tone: 'ok',
        textKey: 'vc.wt.result.created',
        textParams: { name: name, branch: vcWtFormStr(input.branch) },
        detailKey: isNew ? 'vc.wt.result.createdNewDetail' : 'vc.wt.result.createdExistingDetail',
        detailParams: { path: vcWtFormStr(input.path), branch: vcWtFormStr(input.branch) },
      },
    })
  }
  /** 移动成功：清单由刷新后的读数换新路径；旧路径下记过的稀疏规则跟着搬到新键上。 */
  const succeedMove = function (input: any): any {
    const from: string = vcWtFormStr(input.path)
    const to: string = vcWtFormStr(input.dest)
    const state: any = e.uiOf(uiNow())
    const rules: any = Object.assign({}, state.sparseRules)
    if (from !== '' && Object.prototype.hasOwnProperty.call(rules, from)) {
      rules[to] = rules[from]
      delete rules[from]
    }
    setWt({
      mode: 'idle', op: '', plan: null, ticket: null, result: null, error: null, requestId: '', decision: null, input: vcWtFormBlankInput(),
      move: { path: '', draft: '' }, sparseRules: rules,
      lastResult: {
        tone: 'ok', textKey: 'vc.wt.result.moved', textParams: { name: vcWorktreeBaseNameOf(to) },
        detailKey: 'vc.wt.result.movedDetail', detailParams: { from: from },
      },
    })
  }
  /** 稀疏检出成功：把这次勾选记进 sparseRules，展开行里从此常驻「当前规则」，面板收起。 */
  const succeedSparse = function (input: any, candidates: string[]): any {
    const path: string = vcWtFormStr(input.path)
    const dirs: string[] = Array.isArray(input.dirs) ? input.dirs.slice(0) : []
    const state: any = e.uiOf(uiNow())
    const rules: any = Object.assign({}, state.sparseRules)
    rules[path] = dirs
    const allKept: boolean = candidates.length > 0 && dirs.length === candidates.length &&
      candidates.every(function (c: string): boolean { return dirs.indexOf(c) >= 0 })
    setWt({
      mode: 'idle', op: '', plan: null, ticket: null, result: null, error: null, requestId: '', decision: null, input: vcWtFormBlankInput(),
      sparse: { path: '', rules: [], candidates: [], ruleFile: '' }, sparseRules: rules,
      lastResult: {
        tone: 'ok', textKey: allKept ? 'vc.wt.result.sparseAll' : 'vc.wt.result.sparseSaved', textParams: {}, dirs: dirs,
        detailKey: allKept ? 'vc.wt.result.sparseAllDetail' : 'vc.wt.result.sparseDetail',
        detailParams: { name: vcWorktreeBaseNameOf(path) },
      },
    })
  }
  // ---- 新建工作区：页脚入口 → 页底表单 → 直接预检执行 ----
  const createOpen = function (): any {
    const prev: any = e.uiOf(uiNow())
    return setWt({
      create: Object.assign({}, prev.create, { open: true, error: null }),
      move: { path: '', draft: '' }, sparse: { path: '', rules: [], candidates: [], ruleFile: '' },
      lastResult: null,
    })
  }
  const createClose = function (): any {
    const prev: any = e.uiOf(uiNow())
    return setWt({ create: Object.assign({}, prev.create, { open: false, error: null }) })
  }
  const createField = function (name: any, value: any): any {
    const key: string = vcWtFormStr(name)
    if (key !== 'path' && key !== 'branch') return e.uiOf(uiNow())
    const prev: any = e.uiOf(uiNow())
    const create: any = Object.assign({}, prev.create, { error: null })
    create[key] = vcWtFormStr(value)
    return setWt({ create: create })
  }
  const createMode = function (mode: any): any {
    const prev: any = e.uiOf(uiNow())
    // 切模式时清掉分支：新建分支与已有分支是两套候选，留着上一套的分支名会让人以为它已经选好了。
    return setWt({ create: Object.assign({}, prev.create, { mode: mode === 'existing' ? 'existing' : 'new', branch: '', error: null }) })
  }
  const createPickBranch = function (value: any): any {
    const prev: any = e.uiOf(uiNow())
    return setWt({ create: Object.assign({}, prev.create, { branch: vcWtFormStr(value), error: null }) })
  }
  const createSubmit = function (): any {
    const reads: any = readsNow() || {}
    const prev: any = e.uiOf(uiNow())
    const model: any = vcWorktreesModelOf(reads)
    const path: string = vcWtFormStr(prev.create.path).trim().replace(/\\/g, '/')
    const branch: string = vcWtFormStr(prev.create.branch).trim()
    const fail = function (key: string): any {
      const state: any = e.uiOf(uiNow())
      return setWt({ create: Object.assign({}, state.create, { path: vcWtFormStr(prev.create.path), branch: vcWtFormStr(prev.create.branch), error: { key: key, params: {} } }) })
    }
    if (path === '') return fail('vc.wt.create.emptyPath')
    if (branch === '') return fail(prev.create.mode === 'existing' ? 'vc.wt.create.noBranch' : 'vc.wt.create.emptyBranch')
    // 分支清单读得到时才断言「本地没有这条分支」；读不到就交给宿主预检，别把「还没读到」说成「没有」。
    if (prev.create.mode === 'existing' && vcFirstScreenSliceStateOf(reads, 'workspace') === 'ok' && model.branches.indexOf(branch) < 0) return fail('vc.wt.create.noBranch')
    if (vcWorktreesPathTakenOf(model, path)) return fail('vc.wt.create.taken')
    const clean: any = e.uiOf(uiNow())
    setWt({ create: Object.assign({}, clean.create, { error: null }), lastResult: null })
    const op: string = prev.create.mode === 'existing' ? 'add-branch' : 'add'
    return begin(op, { path: path, branch: branch }, {
      auto: true,
      onSuccess: function (): any { return succeedCreate(op, { path: path, branch: branch }) },
      onFailure: function (reply: any, result: any, reason: string): any { return failCreate(reply, result, reason) },
    })
  }
  // ---- 移动工作区：展开行里的表单，预填当前路径 ----
  const moveOpen = function (path: any): any {
    const target: string = vcWtFormStr(path)
    const prev: any = e.uiOf(uiNow())
    return setWt({
      create: Object.assign({}, prev.create, { open: false }),
      move: { path: target, draft: target }, sparse: { path: '', rules: [], candidates: [], ruleFile: '' },
      mode: 'idle', op: '', plan: null, ticket: null, decision: null, lastResult: null,
    })
  }
  const moveDraft = function (value: any): any {
    const prev: any = e.uiOf(uiNow())
    return setWt({ move: { path: prev.move.path, draft: vcWtFormStr(value) } })
  }
  const moveClose = function (): any {
    return setWt({ move: { path: '', draft: '' } })
  }
  const moveSave = function (): any {
    const prev: any = e.uiOf(uiNow())
    const from: string = prev.move.path
    if (from === '') return prev
    const dest: string = vcWtFormStr(prev.move.draft).trim().replace(/\\/g, '/')
    const model: any = vcWorktreesModelOf(readsNow() || {})
    if (dest === '') return setLastResult({ tone: 'error', textKey: 'vc.wt.move.empty', textParams: {} })
    // 同一个目录再保存一次不算错误，但也没有可改的：按提醒说清楚，不假装移动成功。
    if (vcWorktreesPathSameOf(from, dest)) return setLastResult({ tone: 'warn', textKey: 'vc.wt.move.same', textParams: {} })
    if (vcWorktreesPathTakenOf(model, dest)) return setLastResult({ tone: 'error', textKey: 'vc.wt.move.taken', textParams: {} })
    setLastResult(null)
    return begin('move', { path: from, dest: dest }, {
      auto: true,
      onSuccess: function (): any { return succeedMove({ path: from, dest: dest }) },
      onFailure: function (reply: any, result: any, reason: string): any { return failRowForm('move', reply, result, reason) },
    })
  }
  // ---- 稀疏检出：展开行里的勾选面板，保存后就地常驻当前规则 ----
  const sparseOpen = function (path: any): any {
    const target: string = vcWtFormStr(path)
    const prev: any = e.uiOf(uiNow())
    setWt({
      create: Object.assign({}, prev.create, { open: false }),
      move: { path: '', draft: '' }, sparse: { path: target, rules: [], candidates: [], ruleFile: '' },
      mode: 'checking', op: 'sparse-list', input: { path: target, dest: '', branch: '', reason: '', dirs: [] },
      decision: null, plan: null, ticket: null, result: null, error: null, requestId: '', lastResult: null,
    })
    return begin('sparse-list', { path: target }, {
      auto: false,
      onFailure: function (reply: any, result: any, reason: string): any { return failRowForm('sparse', reply, result, reason) },
    })
  }
  const sparseToggle = function (dir: any, on: any): any {
    return e.pickDir(dir, on)
  }
  const sparseClose = function (): any {
    return setWt({
      mode: 'idle', op: '', plan: null, ticket: null, decision: null,
      sparse: { path: '', rules: [], candidates: [], ruleFile: '' },
      input: { path: '', dest: '', branch: '', reason: '', dirs: [] },
    })
  }
  const sparseSave = function (): any {
    const prev: any = e.uiOf(uiNow())
    const path: string = prev.sparse.path
    if (path === '') return prev
    const dirs: string[] = prev.input.dirs.slice(0)
    if (dirs.length === 0) return setLastResult({ tone: 'error', textKey: 'vc.wt.sparse.empty', textParams: {} })
    setLastResult(null)
    return begin('sparse-set', { path: path, dirs: dirs }, {
      auto: true,
      onSuccess: function (): any {
        const planSparse: any = (prev.plan && prev.plan.sparse) || {}
        const candidates: string[] = Array.isArray(planSparse.candidates) && planSparse.candidates.length > 0
          ? planSparse.candidates.slice(0)
          : e.uiOf(uiNow()).sparse.candidates.slice(0)
        return succeedSparse({ path: path, dirs: dirs }, candidates)
      },
      onFailure: function (reply: any, result: any, reason: string): any { return failRowForm('sparse', reply, result, reason) },
    })
  }
  const resultDismiss = function (): any {
    return setWt({ lastResult: null })
  }
  return {
    createOpen: createOpen, createClose: createClose, createField: createField, createMode: createMode,
    createPickBranch: createPickBranch, createSubmit: createSubmit,
    moveOpen: moveOpen, moveDraft: moveDraft, moveClose: moveClose, moveSave: moveSave,
    sparseOpen: sparseOpen, sparseToggle: sparseToggle, sparseClose: sparseClose, sparseSave: sparseSave,
    resultDismiss: resultDismiss,
  }
}
