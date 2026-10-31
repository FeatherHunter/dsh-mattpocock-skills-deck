// shared/version-control/src/config-rules.ts —— 域 12（配置与钩子）的规则层（#1760 T24）
//
// 这一片放三类纯逻辑，宿主与界面共用同一份，谁也不另写第二套：
//   ① 读法：git config --list --show-origin -z 的输出怎么切（成对字段），文件来源怎么反推作用域
//      （本仓库 / 这台机器 / 系统级 / 其它）。规格第 3.10 节点名要求用 --show-origin 反推，不解析配置文件文本；
//   ② 边界：配置页只改提交身份的两个键（user.name / user.email）且只写本仓库或全局，其余键一律只读。
//      这是规格第 5 节的永久限定：config 是命令执行面（core.fsmonitor、core.hooksPath、alias.* 都能执行代码），
//      做通用键值编辑器等于给面板开一个任意代码执行入口，所以「只读」不是偷懒，是安全边界；
//   ③ 版本门：git hook run 要 2.36（能力账本 12.6 的 minVersion），低版本只给只读说明与替代做法。
//
// 零 import 自包含——shared 同层互相 import 会被依赖门禁拦下（branch-ticket.ts 同一口径）。
// 哈希、起进程、读文件都在宿主做；这里只决定「取哪一份字节、判哪一个名字合法」。

/** 硬底线：2.11 以下整个版本管理面板都不可用（与能力账本一致）。 */
export const CONFIG_VERSION_FLOOR = '2.11.0'

/** 12.6 git hook run 的最低版本（能力账本 minVersion 原文）。 */
export const CONFIG_HOOK_RUN_MIN_VERSION = '2.36.0'

/** 12.6 低版本时的替代做法：与能力账本 versionAlternative 字字一致，界面照抄这一句。 */
export const CONFIG_HOOK_RUN_ALTERNATIVE = '2.36 以下在终端直接执行钩子文件'

/** 预检回包契约名与版本：界面与门禁据此判断「这是新协议的票」而不是旧回包。 */
export const CONFIG_CHECK_CONTRACT = 'version-control.config-check'
export const CONFIG_CHECK_VERSION = 1

/** 唯一允许写的两个键：提交身份。其余键只读（规格第 5 节永久限定）。 */
export const CONFIG_IDENTITY_KEYS: string[] = ['user.name', 'user.email']

/** 允许写的作用域：本仓库与这台机器。系统级配置一律只读。 */
export const CONFIG_SCOPES: string[] = ['local', 'global']

/** 本域三个写动作：改配置、删配置、手动跑钩子。自包含字面量联合，不扩 ports.ts 的 WriteOp（那张表是票据门的形状）。 */
export const CONFIG_WRITE_OPS: string[] = ['config-set', 'config-unset', 'hook-run']

/** 配置值上限：git 本身不限长，但面板的输入框与显示不该吞下无限长的值。 */
export const CONFIG_VALUE_MAX = 200

/** 配置页四组：身份可编辑，其余三组只读。titleKey 是词表键，界面按它取标题。 */
export const CONFIG_GROUPS: any[] = [
  { id: 'identity', titleKey: 'vc.config.group.identity', editable: true, keys: ['user.name', 'user.email'] },
  { id: 'eol', titleKey: 'vc.config.group.eol', editable: false, keys: ['core.autocrlf', 'core.eol', 'core.safecrlf', 'core.ignorecase'] },
  { id: 'hooksPath', titleKey: 'vc.config.group.hooksPath', editable: false, keys: ['core.hooksPath'] },
  { id: 'credential', titleKey: 'vc.config.group.credential', editable: false, keys: ['credential.helper'] },
]

/**
 * git 文档里列出的钩子名字：界面用它把「本仓库钩子清单」分成「git 认得的」「本仓库自己的」两拨。
 * 它不参与写校验——手动跑钩子只要求名字形状合法、文件在仓库里存在（git hook run 自己按文件找）。
 */
export const HOOK_NAMES: string[] = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit',
  'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge',
  'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update',
  'reference-transaction', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate',
  'fsmonitor-watchman', 'post-index-change',
]

/** 八条能力在页面上的入口定义：id 与能力账本一致，page 决定它落在配置页还是钩子页。 */
export const CONFIG_ENTRY_DEFS: any[] = [
  { capId: '12.1', op: 'config-read', page: 'config' },
  { capId: '12.2', op: 'config-set', page: 'config' },
  { capId: '12.3', op: 'config-unset', page: 'config' },
  { capId: '12.4', op: 'identity', page: 'config' },
  { capId: '12.5', op: 'hook-list', page: 'hooks' },
  { capId: '12.6', op: 'hook-run', page: 'hooks' },
  { capId: '12.7', op: 'attr-query', page: 'config' },
  { capId: '12.8', op: 'mailmap-query', page: 'config' },
]

/** 一个键归哪一组；不认识的键回空串（不硬塞进任何组，界面按「其它只读键」处理）。 */
export function configGroupOf(key: string): string {
  const k: string = String(key === undefined || key === null ? '' : key)
  for (let i: number = 0; i < CONFIG_GROUPS.length; i += 1) {
    if (CONFIG_GROUPS[i].keys.indexOf(k) >= 0) return String(CONFIG_GROUPS[i].id)
  }
  return ''
}

/** 这个键能不能写：只有身份两个键。 */
export function configKeyEditable(key: string): boolean {
  return CONFIG_IDENTITY_KEYS.indexOf(String(key || '')) >= 0
}

/** 作用域是否可写。 */
export function configScopeWritable(scope: string): boolean {
  return CONFIG_SCOPES.indexOf(String(scope || '')) >= 0
}

/** 身份值的轻校验：空、超长、含换行与控制字符、邮箱形状。返回 null 表示没问题。
 *  邮箱判据不追求 RFC 全文（那不可能写对），只挡「明显不是邮箱」的形状：有 @、有域名点号、无空白。 */
export function identityValueError(key: string, value: any): string | null {
  const k: string = String(key || '')
  const s: string = String(value === undefined || value === null ? '' : value)
  if (s.trim() === '') return 'value-empty'
  if (s.length > CONFIG_VALUE_MAX) return 'value-too-long'
  if (/[\u0000-\u001f\u007f]/.test(s)) return 'value-invalid'
  if (k === 'user.email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email-invalid'
  return null
}

/** 钩子名字的形状：小写字母、数字、连字符，不能以短横线开头。git hook run 只按文件找，名字由仓库里那份文件决定。 */
export function hookNameProblem(name: any): string | null {
  const s: string = String(name === undefined || name === null ? '' : name)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s) || s.length > 64) return 'hook-name'
  return null
}

/** 本地版本比较（不 import capabilities.ts，避免同层互引）。 */
export function configVersionOf(text: any): any {
  const m: any = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text === undefined || text === null ? '' : text))
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? 0 : Number(m[3]) }
}
function atLeast(v: any, major: number, minor: number, patch: number): boolean {
  if (!v) return false
  if (v.major !== major) return v.major > major
  if (v.minor !== minor) return v.minor > minor
  return v.patch >= patch
}

/** 12.6 手动跑钩子的版本门：低于 2.11 或低于 2.36 都 hidden（界面只画说明与替代做法，不画按钮）。 */
export function configHookRunStateOf(versionText: any): any {
  const v: any = configVersionOf(versionText)
  if (!atLeast(v, 2, 36, 0)) return { state: 'hidden', needed: CONFIG_HOOK_RUN_MIN_VERSION, alternative: CONFIG_HOOK_RUN_ALTERNATIVE }
  return { state: 'full', needed: CONFIG_HOOK_RUN_MIN_VERSION, alternative: null }
}

/** 路径归一：反斜杠转正斜杠、去掉重复斜杠；比较时再单独转小写（Windows 盘符与目录大小写不敏感）。 */
function normPath(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  return s.split('\\').join('/').replace(/\/{2,}/g, '/')
}

/**
 * 由 --show-origin 的 origin 反推作用域。
 * 判据（按 git 的真实输出形状）：
 *   · 相对路径的 file: origin（例如 file:.git/config）只可能是仓库自己的配置 → local；
 *   · 绝对路径与本地 config 路径相等 → local；
 *   · 用户主目录的 .gitconfig 或 XDG 的 .config/git/config → global；
 *   · 安装目录的 etc/gitconfig → system（只读展示）；
 *   · 其余（自定义 GIT_CONFIG_* 指到的文件）→ other，按「只读、来源文件照实显示」处理，不冒充任何作用域。
 */
export function configScopeOf(origin: any, localConfigPath: any): string {
  const o: string = String(origin === undefined || origin === null ? '' : origin)
  if (o.indexOf('file:') !== 0) return 'other'
  const p: string = normPath(o.slice(5))
  if (p === '') return 'local'
  const absolute: boolean = p.charAt(0) === '/' || /^[a-z]:\//i.test(p)
  if (!absolute) return 'local'
  const local: string = normPath(localConfigPath)
  if (local !== '' && p.toLowerCase() === local.toLowerCase()) return 'local'
  if (/\/\.gitconfig$/i.test(p) || /\/\.config\/git\/config$/i.test(p)) return 'global'
  if (/\/etc\/gitconfig$/i.test(p)) return 'system'
  return 'other'
}

/**
 * 解析 git config --list --show-origin -z：字段按 NUL 切，两个一组（origin、然后「键换行值」）。
 * 判据来自真 git 2.49 的字节：origin 形如 file:C:/Program Files/Git/etc/gitconfig；
 * 键与值之间是一个换行（值里还可以有换行，所以只在第一个换行处切）。
 * 任何一条切不出键名、或字段总数是奇数，整份失败——不给半份配置。
 */
export function parseConfigList(stdout: any): any {
  const text: string = String(stdout === undefined || stdout === null ? '' : stdout)
  if (text === '') return { ok: true, entries: [] }
  const parts: string[] = text.split('\u0000')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  if (parts.length % 2 !== 0) return { ok: false, detail: '字段数不成对（' + parts.length + ' 段）' }
  const entries: any[] = []
  for (let i: number = 0; i < parts.length; i += 2) {
    const origin: string = parts[i]
    const pair: string = parts[i + 1]
    const at: number = pair.indexOf('\n')
    const key: string = at < 0 ? pair : pair.slice(0, at)
    if (key === '') return { ok: false, detail: '第 ' + (i / 2 + 1) + ' 条没有键名' }
    entries.push({ origin: origin, key: key, value: at < 0 ? '' : pair.slice(at + 1) })
  }
  return { ok: true, entries: entries }
}

/** 按作用域取某个键的旧值；同作用域出现多次时取最后一条（后面的配置文件会覆盖前面的）。没有回 null。 */
export function configOldValueOf(entries: any[], key: any, scope: any, localConfigPath?: any): string | null {
  const k: string = String(key || '')
  const s: string = String(scope || '')
  const list: any[] = Array.isArray(entries) ? entries : []
  let out: string | null = null
  for (let i: number = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].key) === k && configScopeOf(list[i].origin, localConfigPath) === s) out = String(list[i].value)
  }
  return out
}

/** 每个键在当前仓库里的三个作用域旧值 + 生效值（local > global > system）。界面按这张表画四组。 */
export function configRowsOf(entries: any[], localConfigPath: any): any[] {
  const list: any[] = Array.isArray(entries) ? entries : []
  const rows: any[] = []
  for (let g: number = 0; g < CONFIG_GROUPS.length; g += 1) {
    const group: any = CONFIG_GROUPS[g]
    for (let i: number = 0; i < group.keys.length; i += 1) {
      const key: string = String(group.keys[i])
      const values: any = { local: null, global: null, system: null, other: null }
      for (let j: number = 0; j < list.length; j += 1) {
        if (!list[j] || String(list[j].key) !== key) continue
        const scope: string = configScopeOf(list[j].origin, localConfigPath)
        values[scope] = String(list[j].value)
      }
      let effectiveScope: string | null = null
      let effectiveValue: string | null = null
      const order: string[] = ['local', 'global', 'system', 'other']
      for (let k: number = 0; k < order.length; k += 1) {
        if (values[order[k]] !== null) { effectiveScope = order[k]; effectiveValue = values[order[k]]; break }
      }
      rows.push({ group: String(group.id), key: key, editable: group.editable === true && configKeyEditable(key), values: values, scope: effectiveScope, value: effectiveValue })
    }
  }
  return rows
}

/** 属性规则（12.7）的只读读数：git check-attr -a -z -- <路径> 的输出是 path / attr / value 三段一组。
 *  value 为 'unspecified' 表示这个属性没被任何规则设置，界面照实写「未设置」而不是空着。 */
export function parseCheckAttr(stdout: any): any {
  const text: string = String(stdout === undefined || stdout === null ? '' : stdout)
  if (text === '') return { ok: true, entries: [] }
  const parts: string[] = text.split('\u0000')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  if (parts.length % 3 !== 0) return { ok: false, detail: '字段数不是三的倍数（' + parts.length + ' 段）' }
  const entries: any[] = []
  for (let i: number = 0; i < parts.length; i += 3) entries.push({ path: parts[i], attr: parts[i + 1], value: parts[i + 2] })
  return { ok: true, entries: entries }
}

/** 邮件映射（12.8）的只读读数：git check-mailmap -- <地址> 回一行 <映射后地址>，多行也照实保留。 */
export function parseCheckMailmap(stdout: any): string {
  return String(stdout === undefined || stdout === null ? '' : stdout).trim()
}

/** 规范化 JSON：键排序、数组保序。计划摘要用同一口径算，直接 JSON.stringify 会因键顺序不同误判。 */
export function configCanonicalJson(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t: string = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(configCanonicalJson).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string): boolean { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string): string { return JSON.stringify(k) + ':' + configCanonicalJson(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 计划摘要要哈希的字节：规范化后的计划整份。改了值、键或作用域都会让摘要变，执行前比对自然判 target-changed。 */
export function configPlanDigestInput(plan: any): string {
  return configCanonicalJson(plan || null)
}

/** 身份旧值这一格要哈希的字节：作用域 + NUL + 旧值（没有旧值也算一个确定值，不能让「从无到有」漏过去）。 */
export function configOldValueInput(scope: any, value: any): string {
  return String(scope === undefined || scope === null ? '' : scope) + '\u0000' + String(value === undefined || value === null ? '' : value)
}

/** 手动跑钩子绑定的那一格：钩子文件的内容摘要（预检后钩子被改过就必须重来）。 */
export function configHookDigestInput(digest: any): string {
  return 'hook\u0000' + String(digest === undefined || digest === null ? '' : digest)
}

/**
 * 写动作的规范化计划：只留这个动作会用到的字段，并把等价写法收敛掉（未给作用域就是 local）。
 * 校验顺序：动作 → 键是不是身份键 → 作用域 → 值 / 名字。任何一步不过都回固定理由，宿主据此当场拒（不起进程）。
 */
export function configCheckPlanOf(op: any, args: any): any {
  const a: any = args || {}
  const s = function (v: any): string { return v === undefined || v === null ? '' : String(v) }
  const want: string = s(op)
  if (CONFIG_WRITE_OPS.indexOf(want) < 0) return { ok: false, reason: 'bad-target', message: '不认识的配置写动作：' + want + '（允许：' + CONFIG_WRITE_OPS.join(' / ') + '）' }
  // 动作在参数里又写了一遍时，两处必须一致：外面按 A 判、里面按 B 执行的分裂是写层最怕的错位。
  const declared: string = s(a.op)
  if (declared !== '' && declared !== want) return { ok: false, reason: 'bad-target', message: '动作字段对不上：外层是 ' + want + '，参数里写的是 ' + declared }
  if (want === 'hook-run') {
    const problem: string | null = hookNameProblem(a.name)
    if (problem) return { ok: false, reason: problem, message: '钩子名字只能用小写字母、数字与连字符，且不能以短横线开头' }
    return { ok: true, plan: { op: want, name: s(a.name) } }
  }
  const key: string = s(a.key)
  if (!configKeyEditable(key)) return { ok: false, reason: 'key-readonly', message: '配置页只改提交身份的两个键（user.name / user.email）；其余键只读，不做通用键值编辑器' }
  const scope: string = s(a.scope) === '' ? 'local' : s(a.scope)
  if (!configScopeWritable(scope)) return { ok: false, reason: 'scope-invalid', message: '作用域只能选本仓库（--local）或这台机器（--global），系统级配置不给写' }
  if (want === 'config-set') {
    const value: string = s(a.value)
    const problem: string | null = identityValueError(key, value)
    if (problem) {
      const text: string = problem === 'email-invalid' ? '邮箱形状不对：要有 @ 与域名点号，且不含空白' : (problem === 'value-too-long' ? '新值太长了（最多 ' + CONFIG_VALUE_MAX + ' 个字符）' : (problem === 'value-empty' ? '新值不能为空' : '新值里有换行或控制字符，配置值写不下这些'))
      return { ok: false, reason: problem, message: text }
    }
    return { ok: true, plan: { op: want, key: key, scope: scope, value: value } }
  }
  return { ok: true, plan: { op: want, key: key, scope: scope } }
}

/** 这个计划要不要先弹确认卡：删配置与手动跑钩子都要（删了要恢复得重配，钩子是仓库里的脚本）。 */
export function configNeedsConfirmOf(plan: any): boolean {
  const op: string = String((plan && plan.op) || '')
  return op === 'config-unset' || op === 'hook-run'
}

/** 确认卡的对象：动作 + 对象（键或钩子名）。措辞由界面按词表拼，宿主不自造话术。 */
export function configConfirmOf(plan: any): any {
  if (!plan) return null
  if (plan.op === 'config-unset') return { kind: 'config-unset', target: String(plan.key || ''), scope: String(plan.scope || 'local') }
  if (plan.op === 'hook-run') return { kind: 'hook-run', target: String(plan.name || '') }
  return null
}

/** 预检结果里给界面看的现场摘要：身份两条各作用域的旧值 + 钩子路径。block 时也要回现场。 */
export function configSceneSummary(scene: any): any {
  const s: any = scene || {}
  const ident: any = s.identity || {}
  return {
    nameLocal: ident.nameLocal === undefined ? null : ident.nameLocal,
    nameGlobal: ident.nameGlobal === undefined ? null : ident.nameGlobal,
    emailLocal: ident.emailLocal === undefined ? null : ident.emailLocal,
    emailGlobal: ident.emailGlobal === undefined ? null : ident.emailGlobal,
    hooksPath: s.hooksPath === undefined ? null : s.hooksPath,
    hookExists: s.hookExists === undefined ? null : s.hookExists,
    headOid: s.headOid === undefined ? null : s.headOid,
  }
}

export const CONFIG_RULES_SOURCE = 'src/shared/version-control/src/config-rules.ts'
