// views/versionControl/vcRealManageReads.ts —— 管理分区与侧页的进入读数（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 九个管理分区与两个侧页各自有一份读数：进页面时按页发对应的只读电话，结果落进这份管理状态。
// 同一个工作区对同一页只读一次（记在 m.readsDone），手动刷新或写动作成功后带 force 再读一次。
// 这一层只发「读」，不判断能不能写；三段式的预检与凭票执行在 vcRealManageActions*.ts。
// 失败绝不清空上一份读数：页面照常画旧数据，同时由错误字段说明这一次没读到。

declare const tr: any
declare function vcReadBranches(reads: any, call: any, cwd: any): any
declare function vcReadRemoteList(reads: any, call: any, cwd: any): any
declare function vcReadPlatform(reads: any, call: any, cwd: any): any
declare function vcConfigApplyRead(state: any, reply: any): any
declare function vcConfigReadStateOf(state: any): string
declare function vcFailureOf(reply: any): any
declare function vcSubmoduleBoardShapeOk(board: any): boolean
declare function vcSubmoduleFailureOf(reply: any): any
declare const VC_SUBMODULES_PHONES: any
declare const VC_CONFIG_READ_PHONE: any
declare const VC_DIAG_PHONES: any

/** 管理页读数分发器的依赖：管理状态读写（setManage 收函数式更新）、宿主电话、当前工作区。 */
export const VC_REAL_MANAGE_READS_SOURCE = 'src/client/views/versionControl/vcRealManageReads.ts'

/**
 * 造「按页读数」的一件东西：readPage(page, force) 会按页发一条只读电话并把结果落进管理状态。
 * 认得的页：branch-tags / remote / submodules / config / hooks / diagnostics / platform；
 * 其余页（改动静止在首屏、维护页自给自足、搜索页无读数）原样跳过，不发任何电话。
 */
export const vcRealReadsDispatchOf = function (deps: any): any {
  const d: any = deps || {}
  const getManage: any = typeof d.getManage === 'function' ? d.getManage : function () { return null }
  const setManage: any = typeof d.setManage === 'function' ? d.setManage : function () { return undefined }
  const callHost: any = typeof d.callHost === 'function' ? d.callHost : function () { return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } }) }
  const cwd: string = String(d.cwd || '')
  const diagOf: any = typeof d.diagOf === 'function' ? d.diagOf : function () { return null }
  const finish = function (key: string, next: any): any {
    setManage(function (cur: any) {
      const done: any = Object.assign({}, (cur && cur.readsDone) || {})
      done[key] = true
      return Object.assign({}, cur, next, { readsDone: done })
    })
    return next
  }
  const already = function (key: string, force: any): boolean {
    const m: any = getManage() || {}
    return force !== true && !!(m.readsDone && m.readsDone[key])
  }
  const readBranch = function (force: any): any {
    if (already('branch', force)) return Promise.resolve(null)
    const m: any = getManage() || {}
    return Promise.resolve(vcReadBranches({ branch: m.branch }, callHost, cwd)).then(function (next: any) {
      return finish('branch', { branch: next && next.branch })
    })
  }
  const readRemote = function (force: any): any {
    if (already('remote', force)) return Promise.resolve(null)
    const m: any = getManage() || {}
    return Promise.resolve(vcReadRemoteList(m.remote || {}, callHost, cwd)).then(function (next: any) {
      return finish('remote', { remote: next })
    })
  }
  const readPlatform = function (force: any): any {
    if (already('platform', force)) return Promise.resolve(null)
    const m: any = getManage() || {}
    return Promise.resolve(vcReadPlatform(m.platform || {}, callHost, cwd)).then(function (next: any) {
      return finish('platform', { platform: next })
    })
  }
  // 子模块读数面板：一条电话取整块（分支、状态、路径），失败把原因留在 board.error 里给页面画。
  const readSubmodules = function (force: any): any {
    if (already('submodules', force)) return Promise.resolve(null)
    return Promise.resolve()
      .then(function () { return callHost(VC_SUBMODULES_PHONES.read, { cwd: cwd }) })
      .then(function (reply: any) {
        if (reply && reply.ok === true && vcSubmoduleBoardShapeOk(reply)) {
          const m0: any = getManage() || {}
          const sub: any = Object.assign({}, m0.submodules || {}, { board: { state: 'ok', board: reply, error: null } })
          return finish('submodules', { submodules: sub })
        }
        const fail: any = vcSubmoduleFailureOf(reply)
        const m1: any = getManage() || {}
        const sub2: any = Object.assign({}, m1.submodules || {}, { board: { state: 'error', board: null, error: fail } })
        return finish('submodules', { submodules: sub2 })
      })
  }
  // 配置页与钩子页共用一份读数：身份、钩子目录、属性规则与邮件映射都在同一个回包里。
  const readConfig = function (force: any): any {
    if (already('config', force)) return Promise.resolve(null)
    const m: any = getManage() || {}
    return Promise.resolve()
      .then(function () { return callHost(VC_CONFIG_READ_PHONE, { cwd: cwd }) })
      .then(function (reply: any) {
        return finish('config', { config: vcConfigApplyRead(m.config, reply) })
      })
  }
  // 诊断页的进入读：13.4 是只读的整表列出，用它把页面点亮；后续每条按钮各读各的。
  const readDiagnostics = function (force: any): any {
    if (already('diagnostics', force)) return Promise.resolve(null)
    // 诊断动作层对外只暴露页面回调名（onRead），读数分发这一层要兼容两种叫法，
    //   否则进入诊断页时「读一次点亮页面」会静默跳过，页面停在初值上。
    const actions: any = diagOf()
    const run: any = actions ? (typeof actions.read === 'function' ? actions.read : actions.onRead) : null
    if (typeof run !== 'function') return Promise.resolve(null)
    return Promise.resolve(run.call(actions, '13.4')).then(function () { return finish('diagnostics', {}) })
  }
  const readers: any = {
    'branch-tags': readBranch,
    remote: readRemote,
    submodules: readSubmodules,
    config: readConfig,
    hooks: readConfig,
    diagnostics: readDiagnostics,
    platform: readPlatform,
  }
  const readPage = function (page: any, force: any): any {
    const key: string = String(page || '')
    const fn: any = readers[key]
    if (typeof fn !== 'function') return Promise.resolve(null)
    return Promise.resolve(fn(force)).catch(function () { return null })
  }
  return { readPage: readPage, readConfig: readConfig, readBranch: readBranch, readRemote: readRemote, readPlatform: readPlatform, readSubmodules: readSubmodules }
}
