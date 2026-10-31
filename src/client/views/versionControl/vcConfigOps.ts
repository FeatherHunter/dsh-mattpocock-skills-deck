/**
 * src/client/views/versionControl/vcConfigOps.ts —— 配置页与钩子页的数据与动作层（#1760 T24，规格 #1586 域 12）
 *
 * 职责只三件：把读配置电话的回包读成页面能用的分组与身份旧值；把「改身份两键 / 删键 / 手动跑钩子」
 * 翻译成预检签票与凭票执行两次电话调用；把回包落成页面状态。画法在 vcConfigPage.ts 与 vcHooksPage.ts，
 * 校验规则（哪些键可写、2.36 版本门、钩子名字形状）在共享层 config-rules.ts，不在这里重复说一遍。
 *
 * 界面绝不自己拼 git 命令、也绝不自己判断 git 版本：能不能手动跑钩子由宿主按 git 版本算好的
 * hookRunVersion 决定，读不到就按「藏起来」处理——宁可少一个按钮，也不给点了就报错的按钮。
 */

// 共享层 config-rules.ts 由构建拼进同一个闭包（shared:vcConfigRules 标记）；这里只声明形状。
// 类型检查按单文件跑，跨叶子的名字一律先声明，不 import（客户端半边没有运行时 import）。
declare const CONFIG_GROUPS: any[]
declare const CONFIG_IDENTITY_KEYS: string[]
declare function configGroupOf(key: any): string
declare function configNeedsConfirmOf(plan: any): boolean
declare function configHookRunStateOf(versionText: any): any

/** 配置页与钩子页的三条宿主电话：读一次取全、写前预检签票、凭票执行。 */
export const VC_CONFIG_READ_PHONE = 'wf.gitConfigRead'
export const VC_CONFIG_CHECK_PHONE = 'wf.gitConfigCheck'
export const VC_CONFIG_WRITE_PHONE = 'wf.gitConfigWrite'
/** 读配置电话的契约名（回包里带着；页面不认别的形状）。 */
export const VC_CONFIG_READ_CONTRACT = 'version-control.config-read'
/** 可写的两个键（与能力账本 12.2/12.3/12.4 的落点同一份）。 */
export const VC_CONFIG_WRITE_KEYS = ['user.name', 'user.email']

/** 配置页的初始状态：读数未到，编辑框空着，等电话回包或用户输入填。 */
export const vcConfigStateNew = function (): any {
  return {
    readState: 'idle',
    readAtMs: 0,
    repoRoot: '',
    gitVersion: '',
    hookRunVersion: null,
    configPath: '',
    groups: [],
    identity: { name: { local: null, global: null }, email: { local: null, global: null } },
    hooks: { dir: '', configured: null, readable: false, entries: [], known: [] },
    attr: { state: 'idle' },
    mailmap: { state: 'idle' },
    entries: [],
    edit: { key: '', scope: 'local', value: '', path: '', address: '' },
    check: null,
    pending: null,
    result: null,
  }
}

/** 读配置电话的落状态：成功把读数摊进状态；失败只改读状态与错误，不清掉已经读到的旧值。 */
export const vcConfigApplyRead = function (state: any, reply: any): any {
  const next = Object.assign({}, state || vcConfigStateNew())
  const r = reply || {}
  if (r.ok !== true) {
    next.readState = 'err'
    next.readError = r.error ? String(r.error.kind || 'other') : 'other'
    return next
  }
  next.readState = 'ok'
  next.readError = null
  next.readAtMs = Number(r.readAtMs) || 0
  next.repoRoot = String(r.repoRoot || '')
  next.gitVersion = String(r.gitVersion || '')
  next.hookRunVersion = r.hookRunVersion || null
  next.configPath = String(r.configPath || '')
  next.groups = Array.isArray(r.groups) ? r.groups : []
  next.identity = r.identity || next.identity
  next.hooks = r.hooks || next.hooks
  next.attr = r.attr || { state: 'idle' }
  next.mailmap = r.mailmap || { state: 'idle' }
  next.entries = Array.isArray(r.entries) ? r.entries : []
  return next
}

/** 配置页读状态：ok / err / idle，页面按它决定画读数还是画「先刷新」。 */
export const vcConfigReadStateOf = function (state: any): string {
  const s = state || {}
  return s.readState === 'ok' ? 'ok' : (s.readState === 'err' ? 'err' : 'idle')
}

/** 身份两键的旧值行：本仓库与这台机器各一格，读不到就是「未配置」。 */
export const vcConfigIdentityRowsOf = function (state: any): any[] {
  const ident = (state && state.identity) || {}
  const name = ident.name || {}
  const email = ident.email || {}
  return [
    { key: 'user.name', labelKey: 'vc.config.identity.name', local: name.local, global: name.global },
    { key: 'user.email', labelKey: 'vc.config.identity.email', local: email.local, global: email.global },
  ]
}

/** 配置按四组画：身份可编辑，其余三组只读；每组标题键由组 id 拼出来。 */
export const vcConfigGroupsOf = function (state: any): any[] {
  const rows = (state && Array.isArray(state.groups)) ? state.groups : []
  return CONFIG_GROUPS.map(function (group: any) {
    const mine = rows.filter(function (row: any) { return configGroupOf((row && row.key) || '') === group.id })
    return { id: String(group.id || ''), editable: group.editable === true, titleKey: 'vc.config.group.' + String(group.id || ''), rows: mine }
  })
}

/** 一组里的行数：只读组没有行时画「未配置」，不画空表。 */
export const vcConfigGroupRowsOf = function (group: any): any[] {
  return group && Array.isArray(group.rows) ? group.rows : []
}

/** 编辑框状态：一次只改一个键，换键时把值清空（不把上一个键的值带过去）。 */
export const vcConfigEditOf = function (state: any, patch: any): any {
  const next = Object.assign({}, state || vcConfigStateNew())
  const old = (state && state.edit) || {}
  const p = patch || {}
  const merged: any = Object.assign({}, old)
  if (p.key !== undefined && String(p.key) !== String(old.key || '')) merged.value = ''
  if (p.key !== undefined) merged.key = String(p.key)
  if (p.scope !== undefined) merged.scope = String(p.scope)
  if (p.value !== undefined) merged.value = String(p.value)
  if (p.path !== undefined) merged.path = String(p.path)
  if (p.address !== undefined) merged.address = String(p.address)
  next.edit = merged
  return next
}

/** 改配置的一次动作：键、值、作用域按当前编辑框原样交给预检（校验在共享层，不在界面）。 */
export const vcConfigSetInputOf = function (state: any): any {
  const edit = (state && state.edit) || {}
  return { op: 'config-set', key: String(edit.key || ''), scope: String(edit.scope || 'local'), value: String(edit.value || '') }
}

/** 删配置的一次动作：只带键与作用域，不要值。 */
export const vcConfigUnsetInputOf = function (state: any, key: any): any {
  const edit = (state && state.edit) || {}
  return { op: 'config-unset', key: String(key || edit.key || ''), scope: String(edit.scope || 'local') }
}

/** 手动跑钩子的一次动作：只带钩子名字。 */
export const vcHookRunInputOf = function (name: any): any {
  return { op: 'hook-run', name: String(name || '') }
}

/** 预检电话调用：call(wf.gitConfigCheck, {cwd, ...})，参数拼装只在本文件。 */
export const vcConfigCheckCallOf = function (call: any, cwd: any, input: any): any {
  const i = input || {}
  const payload: any = { cwd: String(cwd || ''), op: String(i.op || '') }
  if (i.key !== undefined) payload.key = String(i.key)
  if (i.scope !== undefined) payload.scope = String(i.scope)
  if (i.value !== undefined) payload.value = String(i.value)
  if (i.name !== undefined) payload.name = String(i.name)
  return call(VC_CONFIG_CHECK_PHONE, payload)
}

/** 凭票执行电话调用：票号、动作、确认标记与 requestId 一起送（requestId 用来重放去重）。 */
export const vcConfigWriteCallOf = function (call: any, cwd: any, input: any): any {
  const i = input || {}
  const payload: any = { cwd: String(cwd || ''), op: String(i.op || ''), ticketId: String(i.ticketId || '') }
  if (i.requestId !== undefined) payload.requestId = String(i.requestId)
  if (i.confirmed === true) payload.confirmed = true
  return call(VC_CONFIG_WRITE_PHONE, payload)
}

/** 预检回包要不要确认卡：宿主按动作给 confirm，给了就要（删键与手动跑钩子）。 */
export const vcConfigConfirmOf = function (check: any): any {
  const c = check || {}
  return c.ok === true && c.confirmRequired === true && c.confirm ? c.confirm : null
}

/** 确认卡对象文案用的目标：配置键或钩子名。 */
export const vcConfigConfirmTargetOf = function (confirm: any): string {
  const c = confirm || {}
  return String(c.target || '')
}

/** 预检块住/失败原因到词条键的白名单：认不出落其他，不印裸原因码。 */
export const vcConfigFailKeyOf = function (kind: any): string {
  const table: any = {
    args: 'vc.config.fail.args',
    env: 'vc.config.fail.env',
    'not-repo': 'vc.config.fail.notRepo',
    read: 'vc.config.fail.read',
    parse: 'vc.config.fail.parse',
    blocked: 'vc.config.fail.blocked',
    'git-failed': 'vc.config.fail.gitFailed',
    truncated: 'vc.config.fail.truncated',
    timeout: 'vc.config.fail.timeout',
    'spawn-failed': 'vc.config.fail.spawn',
    cancelled: 'vc.config.fail.cancelled',
    'need-confirm': 'vc.config.fail.needConfirm',
  }
  return table[String(kind || '')] || 'vc.config.fail.other'
}

/** 一步结果摘要：动作、失败原因与版本门需要值都收成页面能印的形状。 */
export const vcConfigResultOf = function (reply: any): any {
  const r = reply || {}
  const error = r.error || null
  return {
    ok: r.ok === true,
    op: String(r.op || ''),
    kind: error ? String(error.kind || 'other') : '',
    reason: String(r.reason || (error && error.reason) || ''),
    message: error ? String(error.message || '') : '',
    needed: r.needed ? String(r.needed) : '',
    hookFailed: r.hookFailed === true,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    output: typeof r.output === 'string' ? r.output : '',
    truncated: r.truncated === true,
  }
}

/** 执行回包落状态：成功清 pending/check，失败只留结果；钩子输出无论成败都留下给页面印。 */
export const vcConfigApplyReply = function (state: any, reply: any): any {
  const next = Object.assign({}, state || vcConfigStateNew())
  next.pending = null
  next.result = vcConfigResultOf(reply)
  if (reply && reply.ok === true) next.check = null
  return next
}

/** 预检回包落状态：签了票就存起来等确认或直接执行；块住时照回现场与理由。 */
export const vcConfigApplyCheck = function (state: any, reply: any): any {
  const next = Object.assign({}, state || vcConfigStateNew())
  const r = reply || {}
  next.pending = null
  if (r.ok === true && r.ticket) {
    next.check = { ticket: r.ticket, op: String(r.op || ''), confirm: vcConfigConfirmOf(r), confirmRequired: r.confirmRequired === true, scene: r.scene || null }
    if (r.scene && typeof r.scene === 'object') {
      const id = next.identity || {}
      const name = id.name || {}
      const email = id.email || {}
      next.identity = {
        name: { local: r.scene.nameLocal === undefined ? name.local : r.scene.nameLocal, global: name.global },
        email: { local: r.scene.emailLocal === undefined ? email.local : r.scene.emailLocal, global: email.global },
      }
    }
  } else {
    next.check = null
    next.result = vcConfigResultOf(r)
  }
  return next
}

/** 钩子清单的读状态：与配置页共用同一份读回包（钩子页不另外发一条读电话）。 */
export const vcHooksReadStateOf = function (state: any): string {
  return vcConfigReadStateOf(state)
}

/** 钩子清单：认得出真钩子、示例文件与可执行位，页面按这三样画徽标。 */
export const vcHookRowsOf = function (state: any): any[] {
  const hooks = (state && state.hooks) || {}
  const entries = Array.isArray(hooks.entries) ? hooks.entries : []
  return entries.map(function (entry: any) {
    const e = entry || {}
    const name = String(e.name || '')
    return {
      name: name,
      sample: e.sample === true,
      executable: e.executable === true,
      size: Number(e.size) || 0,
      runnable: e.sample !== true && String(name).indexOf('.') < 0,
    }
  })
}

/** 钩子目录那一段：默认目录或 core.hooksPath 指到的位置，读不到就说读不到。 */
export const vcHooksDirOf = function (state: any): any {
  const hooks = (state && state.hooks) || {}
  return { dir: String(hooks.dir || ''), configured: hooks.configured, readable: hooks.readable === true }
}

/** 手动跑钩子的版本门：full 可点；hidden 不画按钮，换成规格给的替代做法（隐藏不等于沉默）。 */
export const vcHookRunStateOf = function (state: any): any {
  const s = state || {}
  if (s.hookRunVersion && s.hookRunVersion.state) return s.hookRunVersion
  return configHookRunStateOf(s.gitVersion)
}

/** 钩子能不能在这个版本上跑：隐藏档一个按钮都不留。 */
export const vcHookRunVisibleOf = function (state: any): boolean {
  return vcHookRunStateOf(state).state !== 'hidden'
}

/** 手动跑钩子的确认对象：钩子是仓库里的脚本，执行前要说清是哪个钩子。 */
export const vcHookConfirmOf = function (name: any): any {
  return { op: 'hook-run', name: String(name || ''), confirm: true }
}

/** 钩子执行回包：输出、退出码与「钩子自己失败」三样都照实带回。 */
export const vcHookResultOf = function (reply: any): any {
  const r = reply || {}
  return {
    ok: r.ok === true,
    hookFailed: r.hookFailed === true,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    output: typeof r.output === 'string' ? r.output : '',
    truncated: r.truncated === true,
    kind: r.error ? String(r.error.kind || 'other') : '',
    message: r.error ? String(r.error.message || '') : '',
  }
}

/** 钩子执行回包落状态：清 pending 与确认卡，结果留给页面画输出块。 */
export const vcHooksApplyReply = function (state: any, reply: any): any {
  const next = Object.assign({}, state || vcConfigStateNew())
  next.pending = null
  next.check = null
  next.result = vcConfigResultOf(reply)
  next.hookResult = vcHookResultOf(reply)
  return next
}

/** 钩子结果块要印的正文：没有输出时给空串，页面不画空块。 */
export const vcHookOutputOf = function (state: any): string {
  const result = state && state.hookResult ? state.hookResult : null
  return result && typeof result.output === 'string' ? result.output : ''
}

/** 配置页/钩子页共用的电话名清单（门禁据此确认页面没有第二套电话）。 */
export const VC_CONFIG_PHONES = [VC_CONFIG_READ_PHONE, VC_CONFIG_CHECK_PHONE, VC_CONFIG_WRITE_PHONE]
