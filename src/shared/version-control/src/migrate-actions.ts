// shared/version-control/src/migrate-actions.ts —— 迁移、离线包与历史搬运的共享口径
// （#1759 T23，域 11 的 11.1 / 11.12 / 11.13、域 5 的 5.13，加上 svn 补充块）。
//
// 这个文件故意不 import 任何兄弟文件：共享层同层互相 import 会被依赖门禁拦下（见 branch-ticket.ts 开头的说明）。
// 参数校验、动作清单、给人看的命令原文与票据摘要都写在这里；宿主只负责读现场、签票与起进程。
//
// 约定（改之前先读）：
// - migratePlanOf 成功回 { ok: true, plan }，失败回 { ok: false, reason, message }；reason 是稳定的机器可读短名，
//   message 是给人看的一句中文，宿主把两者都透传给界面，界面不许自己再拼一遍。
// - plan.taskArgs 原样交给长任务通道的 taskArgsFor（archive / bundle / fast-export / fast-import / svn-fetch）；
//   plan.commandText 是给人看的命令原文（与能力账本口径一致）。
// - init 的初始分支名有两条产线：git 2.28 及以上用 --initial-branch；更旧的版本用「建后改名」，
//   即先 git init 再 git -C <目录> symbolic-ref HEAD refs/heads/<名字>。哪条产线由宿主按本机 git 版本决定，
//   写进 plan.initMode，执行层不自己再判一次。
// - fast-import 只允许导入新的空目录：目标路径必须不存在（票据用 pathAbsent 绑定），
//   面板新建目录并初始化仓库后再导入；输入文件走 T06 的 stdinFile 窄例外，票据绑定路径、大小与 sha256。
// - 11.14 refs migrate 与 11.15 scalar 只读，归「管理 › 维护」页：这里不列动作，界面也不给触发按钮。

export const MIGRATE_CHECK_CONTRACT = 'version-control.migrate-check'
export const MIGRATE_CHECK_VERSION = 1
export const MIGRATE_ACTIONS_SOURCE = 'src/shared/version-control/src/migrate-actions.ts'

// 九个动作的登记表。id 与能力账本一致（11.1 / 11.12 / 11.13 / 5.13）；svn 是迁移页补充块，
// 规格与票面都写明它不进 162 条能力计数，所以 id 为 null，界面按 extra 标记单独画。
export const MIGRATE_ACTIONS: any[] = [
  { action: 'init', id: '11.1', op: 'init', level: '写', commandText: 'git init [--bare]', task: false, readOnly: false, needsConfirm: false, extra: false },
  { action: 'archive', id: '11.12', op: 'archive', level: '写', commandText: 'git archive', task: true, readOnly: false, needsConfirm: false, extra: false },
  { action: 'bundle-create', id: '11.13', op: 'bundle', mode: 'create', level: '写', commandText: 'git bundle create / verify / unbundle', task: true, readOnly: false, needsConfirm: false, extra: false },
  // verify 与 unbundle 也走同一个长任务 op（bundle），靠 taskArgs.mode 区分产线：verify 只读校验，unbundle 装回引用。
  { action: 'bundle-verify', id: '11.13', op: 'bundle', mode: 'verify', level: '写', commandText: 'git bundle create / verify / unbundle', task: false, readOnly: true, needsConfirm: false, extra: false },
  { action: 'bundle-unbundle', id: '11.13', op: 'bundle', mode: 'unbundle', level: '写', commandText: 'git bundle create / verify / unbundle', task: true, readOnly: false, needsConfirm: false, extra: false },
  { action: 'fast-export', id: '5.13', op: 'fast-export', level: '毁', commandText: 'git fast-export', task: true, readOnly: false, needsConfirm: false, extra: false },
  { action: 'fast-import', id: '5.13', op: 'fast-import', level: '毁', commandText: 'git fast-import', task: true, readOnly: false, needsConfirm: true, stdinFile: true, extra: false },
  { action: 'svn-probe', id: null, op: 'svn-probe', level: '读', commandText: 'git svn info（只读探测）', task: false, readOnly: true, needsConfirm: false, extra: true },
  { action: 'svn-fetch', id: null, op: 'svn-fetch', level: '写', commandText: 'git svn fetch', task: true, readOnly: false, needsConfirm: true, extra: true }
]

export function migrateActionOf(action: any): any {
  const id = String(action === undefined || action === null ? '' : action)
  for (let i = 0; i < MIGRATE_ACTIONS.length; i = i + 1) {
    if (MIGRATE_ACTIONS[i].action === id) return MIGRATE_ACTIONS[i]
  }
  return null
}

export function migrateActionIds(): string[] {
  const out: string[] = []
  for (let i = 0; i < MIGRATE_ACTIONS.length; i = i + 1) out.push(String(MIGRATE_ACTIONS[i].action))
  return out
}

function mgTextOf(value: any): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mgBad(reason: string, message: string): any {
  return { ok: false, reason: reason, message: message }
}

// 路径守卫：拒空、NUL、上跳段与短横线开头；目标必须是绝对路径，免得执行层再猜相对谁。
// 允许 Windows 盘符（C:/…、C:\…）、UNC（\\server\share）与 POSIX 的 / 开头。
export function migratePathProblem(value: any): string {
  const text = mgTextOf(value)
  if (text === '') return '路径不能为空'
  if (text.length > 2048) return '路径超过 2048 个字符'
  if (text.indexOf('\u0000') >= 0) return '路径里不许有 NUL 字符'
  if (/^[-+]/.test(text) === true) return '路径不许以短横线或加号开头'
  const segments = text.split(/[\\/]/)
  for (let i = 0; i < segments.length; i = i + 1) {
    if (segments[i] === '..') return '路径里不许有上跳段（..）'
  }
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(text) === false) return '路径必须是绝对路径（例如 D:/备份/repo.bundle）'
  return ''
}

// 引用名（bundle 的 ref、archive 的 ref）：拒绝空白、控制字符、减号开头与顶替选项的写法。
export function migrateRefProblem(value: any): string {
  const text = mgTextOf(value)
  if (text === '') return '引用不能为空'
  if (text.length > 300) return '引用超过 300 个字符'
  if (text.charAt(0) === '-' || text.charAt(0) === '+') return '引用不许以短横线或加号开头'
  if (/[\s\u0000-\u001f]/.test(text) === true) return '引用里不许有空白或控制字符'
  return ''
}

// 分支名守卫：与 git check-ref-format 的主要拒绝面一致（空白、控制字符、..、@{、~^:?*[\\ 与结尾斜杠）。
export function migrateBranchProblem(value: any): string {
  const text = mgTextOf(value)
  if (text === '') return '初始分支名不能为空'
  if (text.length > 200) return '初始分支名超过 200 个字符'
  if (text.charAt(0) === '-' || text.charAt(0) === '/') return '初始分支名不许以短横线或斜杠开头'
  if (/[\s\u0000-\u001f]/.test(text) === true) return '初始分支名里不许有空白或控制字符'
  if (text.indexOf('..') >= 0) return '初始分支名里不许有连续两个点'
  if (text.indexOf('@{') >= 0) return '初始分支名里不许有 @{'
  if (/[~^:?*\[\\]/.test(text) === true) return '初始分支名里不许有 git 的保留符号'
  if (text.charAt(text.length - 1) === '/') return '初始分支名不许以斜杠结尾'
  return ''
}

// svn 地址守卫：只认常见协议；拒绝空白、NUL 与减号开头，避免落进 git 的选项位置。
export function migrateUrlProblem(value: any): string {
  const text = mgTextOf(value)
  if (text === '') return 'svn 地址不能为空'
  if (text.length > 2048) return 'svn 地址超过 2048 个字符'
  if (/[\s\u0000-\u001f]/.test(text) === true) return 'svn 地址里不许有空白或控制字符'
  if (text.charAt(0) === '-') return 'svn 地址不许以短横线开头'
  if (/^(?:https?|svn|svn\+ssh|file|ssh|git):\/\//.test(text) === false) return 'svn 地址必须以 http(s)://、svn://、svn+ssh:// 或 file:// 开头'
  return ''
}

// init 的两条产线判断：2.28 及以上才有 --initial-branch；解析失败按旧版本处理（宁可用改名产线，也不假装支持）。
export function migrateVersionAtLeast(version: any, major: number, minor: number): boolean {
  const text = mgTextOf(version)
  const found = /([0-9]+)\.([0-9]+)/.exec(text)
  if (found === null) return false
  const gotMajor = parseInt(found[1], 10)
  const gotMinor = parseInt(found[2], 10)
  if (gotMajor !== major) return gotMajor > major
  return gotMinor >= minor
}

function mgBasePlan(entry: any, plan: any): any {
  return Object.assign({
    action: entry.action,
    id: entry.id,
    op: entry.op,
    level: entry.level,
    mode: entry.mode || '',
    commandText: entry.commandText,
    needsConfirm: entry.needsConfirm === true,
    readOnly: entry.readOnly === true,
    extra: entry.extra === true,
    path: '',
    outputPath: '',
    inputPath: '',
    targetPath: '',
    ref: '',
    branch: '',
    bare: false,
    initMode: '',
    versionNeed: '',
    versionNote: '',
    pathAbsent: [],
    input: null,
    targetText: '',
    taskArgs: {}
  }, plan || {})
}

// 把动作参数归一成 plan；plan.taskArgs 直接进长任务通道，plan.targetText 进确认卡点名对象。
export function migratePlanOf(action: any, input: any): any {
  const entry = migrateActionOf(action)
  if (entry === null) return mgBad('unknown-action', '不认识的迁移动作：' + String(action))
  const a = input === undefined || input === null ? {} : input
  if (entry.action === 'init') {
    const pathProblem = migratePathProblem(a.path)
    if (pathProblem !== '') return mgBad('bad-path', pathProblem)
    const branch = mgTextOf(a.branch) === '' ? 'main' : mgTextOf(a.branch)
    const branchProblem = migrateBranchProblem(branch)
    if (branchProblem !== '') return mgBad('bad-branch', branchProblem)
    const initMode = mgTextOf(a.initMode) === 'rename' ? 'rename' : 'initial-branch'
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        path: mgTextOf(a.path),
        branch: branch,
        bare: a.bare === true,
        initMode: initMode,
        versionNeed: initMode === 'initial-branch' ? '2.28' : '2.11',
        versionNote: initMode === 'initial-branch' ? '' : '本机 git 低于 2.28，初始分支名在建库之后用 symbolic-ref 改名，效果相同。',
        targetText: (a.bare === true ? '裸仓库 ' : '仓库 ') + mgTextOf(a.path) + '（初始分支 ' + branch + '）'
      })
    }
  }
  if (entry.action === 'archive') {
    const pathProblem = migratePathProblem(a.outputPath)
    if (pathProblem !== '') return mgBad('bad-path', pathProblem)
    const ref = mgTextOf(a.ref) === '' ? 'HEAD' : mgTextOf(a.ref)
    const refProblem = migrateRefProblem(ref)
    if (refProblem !== '') return mgBad('bad-ref', refProblem)
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        outputPath: mgTextOf(a.outputPath),
        ref: ref,
        pathAbsent: [mgTextOf(a.outputPath)],
        taskArgs: { outputPath: mgTextOf(a.outputPath), ref: ref },
        targetText: '归档文件 ' + mgTextOf(a.outputPath) + '（来源 ' + ref + '）'
      })
    }
  }
  if (entry.action === 'bundle-create') {
    const pathProblem = migratePathProblem(a.outputPath)
    if (pathProblem !== '') return mgBad('bad-path', pathProblem)
    const ref = mgTextOf(a.ref)
    if (ref !== '') {
      const refProblem = migrateRefProblem(ref)
      if (refProblem !== '') return mgBad('bad-ref', refProblem)
    }
    const taskArgs: any = { outputPath: mgTextOf(a.outputPath) }
    if (ref !== '') taskArgs.ref = ref
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        outputPath: mgTextOf(a.outputPath),
        ref: ref,
        pathAbsent: [mgTextOf(a.outputPath)],
        taskArgs: taskArgs,
        targetText: '离线包 ' + mgTextOf(a.outputPath) + (ref === '' ? '（包含全部引用）' : '（包含 ' + ref + '）')
      })
    }
  }
  if (entry.action === 'bundle-verify' || entry.action === 'bundle-unbundle') {
    const pathProblem = migratePathProblem(a.filePath)
    if (pathProblem !== '') return mgBad('bad-path', pathProblem)
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        inputPath: mgTextOf(a.filePath),
        // 长任务通道只认 op='bundle' 加 mode：verify 只校验，unbundle 把包里的引用装回。
        taskArgs: { mode: entry.mode, filePath: mgTextOf(a.filePath) },
        targetText: '离线包 ' + mgTextOf(a.filePath)
      })
    }
  }
  if (entry.action === 'fast-export') {
    const pathProblem = migratePathProblem(a.outputPath)
    if (pathProblem !== '') return mgBad('bad-path', pathProblem)
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        outputPath: mgTextOf(a.outputPath),
        pathAbsent: [mgTextOf(a.outputPath)],
        taskArgs: { outputPath: mgTextOf(a.outputPath) },
        targetText: '导出文件 ' + mgTextOf(a.outputPath)
      })
    }
  }
  if (entry.action === 'fast-import') {
    const targetProblem = migratePathProblem(a.targetPath)
    if (targetProblem !== '') return mgBad('bad-target', targetProblem)
    const fileProblem = migratePathProblem(a.filePath)
    if (fileProblem !== '') return mgBad('bad-path', fileProblem)
    const branch = mgTextOf(a.branch) === '' ? 'main' : mgTextOf(a.branch)
    const branchProblem = migrateBranchProblem(branch)
    if (branchProblem !== '') return mgBad('bad-branch', branchProblem)
    return {
      ok: true,
      plan: mgBasePlan(entry, {
        targetPath: mgTextOf(a.targetPath),
        inputPath: mgTextOf(a.filePath),
        branch: branch,
        pathAbsent: [mgTextOf(a.targetPath)],
        targetText: '新仓库 ' + mgTextOf(a.targetPath) + '（导入 ' + mgTextOf(a.filePath) + '）'
      })
    }
  }
  if (entry.action === 'svn-probe') return { ok: true, plan: mgBasePlan(entry, { targetText: 'svn 桥探测' }) }
  // svn-fetch
  const urlProblem = migrateUrlProblem(a.url)
  if (urlProblem !== '') return mgBad('bad-url', urlProblem)
  return {
    ok: true,
    plan: mgBasePlan(entry, {
      taskArgs: { url: mgTextOf(a.url) },
      targetText: 'svn 仓库 ' + mgTextOf(a.url) + '（抓取一次）'
    })
  }
}

function mgStableOf(value: any): string {
  if (value === null || value === undefined) return 'null'
  const kind = typeof value
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'number' || kind === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i = i + 1) parts.push(mgStableOf(value[i]))
    return '[' + parts.join(',') + ']'
  }
  if (kind === 'object') {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (let i = 0; i < keys.length; i = i + 1) parts.push(JSON.stringify(keys[i]) + ':' + mgStableOf(value[keys[i]]))
    return '{' + parts.join(',') + '}'
  }
  return JSON.stringify(String(value))
}

// 票据里记的计划摘要：同一个 plan 永远得到同一个字符串，键序不影响结果。
export function migratePlanDigestInput(plan: any): string {
  return mgStableOf(plan === undefined || plan === null ? null : plan)
}
