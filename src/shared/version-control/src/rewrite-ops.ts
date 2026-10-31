/**
 * src/shared/version-control/src/rewrite-ops.ts —— 全库重写的五张结构化表单（#1750 T15，规格 #1586 域 5.11）
 *
 * 为什么单独一叶、且做成纯函数：filter-branch 本体永久只读，整仓重写只走 filter-repo 的五张表单
 * （删路径、重命名路径、改写作者、删大文件、字面量替换）。这五张表单的校验、命令原文、计划摘要、
 * 备份决策必须由宿主预检、执行层、界面三处读同一份，否则「界面显示的命令」与「实际跑的命令」会分叉。
 * 本文件要拼进界面闭包，所以没有 import：路径与身份守卫在这里自写一份，理由只回标识符，文案在
 * config/copy/vcrewrite.yaml。
 *
 * 约定（改这里之前先读）：
 *   1. 五张表单都是「毁」级：不可逆、必须确认、必须前置整仓备份；reversible 恒为 false。
 *   2. 输入校验只回标识符（bad-path / bad-rename / bad-identity / bad-threshold / bad-replacement /
 *      nothing-to-do / too-many-items），不在这里写中文；界面按词条表翻译。
 *   3. 计划摘要输入用键排序后的 JSON（canonicalJson）：同一份输入换一个键序，票里绑的摘要必须一样。
 *   4. 临时说明文件（邮件映射、替换说明）由宿主执行层写，本文件只给「要哪些文件」与内容拼法。
 */

/** 单张表单一次最多处理多少项：超过就劝人拆成多次，免得一条命令跑几个小时。 */
export const REWRITE_LIMIT = 50

/** 预检契约名与版本：界面、宿主、门禁都按这两个值认包。 */
export const REWRITE_CHECK_CONTRACT = 'vc-rewrite-check'
export const REWRITE_CHECK_VERSION = 1

/** 维护页的三条电话：只读预览、预检签票、凭票执行（备份成功后把重写交给长任务通道）。 */
export const REWRITE_PHONES = {
  preview: 'wf.gitRewritePreview',
  check: 'wf.gitRewriteCheck',
  run: 'wf.gitRewriteRun',
}

/** 五张表单的元信息；needs 决定界面给哪种输入，command 是账本口径的命令原文。 */
export const REWRITE_FORMS = [
  { id: 'remove-paths', capId: '5.11', dangerous: true, confirm: true, reversible: false, needs: 'paths', labelKey: 'vc.rewrite.form.removePaths', command: 'git filter-repo --force --invert-paths --path <路径>' },
  { id: 'rename-paths', capId: '5.11', dangerous: true, confirm: true, reversible: false, needs: 'renames', labelKey: 'vc.rewrite.form.renamePaths', command: 'git filter-repo --force --path-rename <旧路径>:<新路径>' },
  { id: 'rewrite-authors', capId: '5.11', dangerous: true, confirm: true, reversible: false, needs: 'authors', labelKey: 'vc.rewrite.form.rewriteAuthors', command: 'git filter-repo --force --mailmap <面板生成的邮件映射文件>' },
  { id: 'remove-large', capId: '5.11', dangerous: true, confirm: true, reversible: false, needs: 'threshold', labelKey: 'vc.rewrite.form.removeLarge', command: 'git filter-repo --force --strip-blobs-bigger-than <阈值>' },
  { id: 'replace-text', capId: '5.11', dangerous: true, confirm: true, reversible: false, needs: 'replacements', labelKey: 'vc.rewrite.form.replaceText', command: 'git filter-repo --force --replace-text <面板生成的替换说明文件>' },
]

/** 按标识符取表单元信息；不认识回 null，调用方据此明确拒绝而不是落到某个默认表单。 */
export function rewriteFormOf(id: any): any {
  for (let i = 0; i < REWRITE_FORMS.length; i += 1) if (REWRITE_FORMS[i].id === id) return REWRITE_FORMS[i]
  return null
}

/** 短横线标识符转驼峰：rewrite-authors → rewriteAuthors，界面词条键按它拼。 */
export function rewriteCamelOf(id: any): string {
  const parts: string[] = String(id || '').split('-')
  let out: string = ''
  for (let i = 0; i < parts.length; i += 1) {
    const p: string = parts[i]
    if (p === '') continue
    out += i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
  }
  return out
}

/** 表单文案键：vc.rewrite.form.<驼峰>；不认识表单回 vc.rewrite.form.unknown。 */
export function rewriteFormLabelKeyOf(id: any): string {
  const meta: any = rewriteFormOf(id)
  return meta ? meta.labelKey : 'vc.rewrite.form.unknown'
}

/** 用键排序后的 JSON 串做摘要输入：对象键序不影响摘要，数组顺序照原样（顺序对命令有意义）。
  这份实现与另外四份稳定序列化由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须五份一起改。 */
function canonicalJson(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + canonicalJson(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/**
 * 路径守卫：filter-repo 的 --path 是「仓库根下的相对前缀」，所以拒绝绝对路径、盘符、反斜杠、
 * 上跳段、结尾斜杠与短横线开头（后者会被 git 当成选项）；长度也留上限。
 */
export function rewritePathProblem(value: any): string | null {
  if (typeof value !== 'string') return 'bad-path'
  if (value === '' || value.length > 1024) return 'bad-path'
  if (value.charAt(0) === '-' || value.charAt(0) === '/') return 'bad-path'
  if (value.indexOf('\\') >= 0 || value.indexOf('\u0000') >= 0) return 'bad-path'
  if (/[\u0001-\u001f\u007f]/.test(value)) return 'bad-path'
  if (/^[A-Za-z]:/.test(value)) return 'bad-path'
  if (value.charAt(value.length - 1) === '/') return 'bad-path'
  const segs: string[] = value.split('/')
  for (let i = 0; i < segs.length; i += 1) if (segs[i] === '' || segs[i] === '.' || segs[i] === '..') return 'bad-path'
  return null
}

/** 路径清单：非数组直接拒，空清单回 nothing-to-do，重复项算坏输入（同一个前缀写两遍没有意义）。 */
export function rewritePathsProblem(list: any): string | null {
  if (!Array.isArray(list)) return 'bad-form'
  if (list.length === 0) return 'nothing-to-do'
  if (list.length > REWRITE_LIMIT) return 'too-many-items'
  const seen: any = {}
  for (let i = 0; i < list.length; i += 1) {
    const problem: string | null = rewritePathProblem(list[i])
    if (problem) return problem
    if (seen[list[i]]) return 'bad-path'
    seen[list[i]] = true
  }
  return null
}

/** 重命名清单：两侧都过路径守卫，旧名字不能重复，改名不能原地打转。 */
export function rewriteRenamesProblem(list: any): string | null {
  if (!Array.isArray(list)) return 'bad-form'
  if (list.length === 0) return 'nothing-to-do'
  if (list.length > REWRITE_LIMIT) return 'too-many-items'
  const seen: any = {}
  for (let i = 0; i < list.length; i += 1) {
    const item: any = list[i]
    if (!item || typeof item !== 'object') return 'bad-rename'
    if (typeof item.from !== 'string' || typeof item.to !== 'string') return 'bad-rename'
    const fromProblem: string | null = rewritePathProblem(item.from)
    if (fromProblem) return fromProblem
    const toProblem: string | null = rewritePathProblem(item.to)
    if (toProblem) return toProblem
    if (item.from === item.to) return 'bad-rename'
    if (seen[item.from]) return 'bad-rename'
    seen[item.from] = true
  }
  return null
}

/** 一条身份（名字 + 邮箱）的形状校验：名字不许带尖括号与换行，邮箱要有本地部分与域名点。 */
export function identityProblem(name: any, email: any): string | null {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 120) return 'bad-identity'
  if (/[<>\r\n\u0000]/.test(name)) return 'bad-identity'
  if (typeof email !== 'string' || email === '' || email.length > 200) return 'bad-identity'
  if (/[<>\s\u0000]/.test(email)) return 'bad-identity'
  if (!/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email)) return 'bad-identity'
  return null
}

/** 一条身份写成邮件映射的一段：新名字 <新邮箱>。 */
export function rewriteIdentityTextOf(name: any, email: any): string | null {
  if (identityProblem(name, email)) return null
  return String(name).trim() + ' <' + String(email).trim() + '>'
}

/** 作者改写清单：每项给新身份；可选给旧身份（给了旧身份就按一对换，否则按新身份整体替换）。 */
export function rewriteAuthorsProblem(list: any): string | null {
  if (!Array.isArray(list)) return 'bad-form'
  if (list.length === 0) return 'nothing-to-do'
  if (list.length > REWRITE_LIMIT) return 'too-many-items'
  for (let i = 0; i < list.length; i += 1) {
    const item: any = list[i]
    if (!item || typeof item !== 'object') return 'bad-identity'
    const newProblem: string | null = identityProblem(item.name, item.email)
    if (newProblem) return newProblem
    const hasOldName: boolean = item.oldName !== undefined && item.oldName !== null && item.oldName !== ''
    const hasOldEmail: boolean = item.oldEmail !== undefined && item.oldEmail !== null && item.oldEmail !== ''
    if (hasOldName || hasOldEmail) {
      if (!hasOldName || !hasOldEmail) return 'bad-identity'
      const oldProblem: string | null = identityProblem(item.oldName, item.oldEmail)
      if (oldProblem) return oldProblem
    }
  }
  return null
}

/** 邮件映射文件的逐行内容：新身份在前、旧身份在后（只给新身份时为单独一行）。 */
export function rewriteMailmapTextOf(list: any): string {
  const lines: string[] = []
  const items: any[] = Array.isArray(list) ? list : []
  for (let i = 0; i < items.length; i += 1) {
    const item: any = items[i] || {}
    const fresh: string | null = rewriteIdentityTextOf(item.name, item.email)
    if (!fresh) continue
    const old: string | null = rewriteIdentityTextOf(item.oldName, item.oldEmail)
    lines.push(old ? fresh + ' ' + old : fresh)
  }
  return lines.join('\n')
}

/** 阈值守卫：人类可读的 10M / 1k / 2G；零与负数拒，别让人们「删大于零字节的全部文件」。 */
export function rewriteThresholdProblem(value: any): string | null {
  if (typeof value !== 'string') return 'bad-threshold'
  return /^[1-9][0-9]{0,6}[kKmMgG]?$/.test(value) ? null : 'bad-threshold'
}

/** 阈值换字节：K/M/G 按 1024 进制。调用方已保证形状合法。 */
export function rewriteThresholdBytesOf(value: any): number {
  const text: string = String(value || '')
  const unit: string = text.slice(-1).toLowerCase()
  const power: number = unit === 'g' ? 3 : unit === 'm' ? 2 : unit === 'k' ? 1 : 0
  const number: number = Number(power === 0 ? text : text.slice(0, -1))
  if (!isFinite(number) || number <= 0) return 0
  return Math.round(number * Math.pow(1024, power))
}

/** 字面量替换清单：from 非空且不许带换行/分隔符（说明文件按 literal:from==>to 一行一条），to 可以为空（删除）。 */
export function rewriteReplacementsProblem(list: any): string | null {
  if (!Array.isArray(list)) return 'bad-form'
  if (list.length === 0) return 'nothing-to-do'
  if (list.length > REWRITE_LIMIT) return 'too-many-items'
  for (let i = 0; i < list.length; i += 1) {
    const item: any = list[i]
    if (!item || typeof item !== 'object') return 'bad-replacement'
    if (typeof item.from !== 'string' || item.from === '' || item.from.length > 4096) return 'bad-replacement'
    if (/[\r\n\u0000]/.test(item.from) || item.from.indexOf('==>') >= 0) return 'bad-replacement'
    const to: any = item.to === undefined || item.to === null ? '' : item.to
    if (typeof to !== 'string' || to.length > 4096) return 'bad-replacement'
    if (/[\r\n\u0000]/.test(to)) return 'bad-replacement'
  }
  return null
}

/** 替换说明文件的逐行内容：literal:旧文本==>新文本。 */
export function rewriteReplaceTextOf(list: any): string {
  const lines: string[] = []
  const items: any[] = Array.isArray(list) ? list : []
  for (let i = 0; i < items.length; i += 1) {
    const item: any = items[i] || {}
    const to: any = item.to === undefined || item.to === null ? '' : item.to
    lines.push('literal:' + String(item.from || '') + '==>' + String(to))
  }
  return lines.join('\n')
}

/** 计划：键序固定，界面、票据、执行层都按同一个形状读写；只取当前表单真正要用的那一段。 */
export function rewritePlanOf(partial: any): any {
  const p: any = partial || {}
  const copy = function (value: any): any[] { return Array.isArray(value) ? value.slice() : [] }
  return {
    op: 'rewrite',
    form: typeof p.form === 'string' ? p.form : '',
    paths: copy(p.paths),
    renames: copy(p.renames),
    authors: copy(p.authors),
    threshold: typeof p.threshold === 'string' ? p.threshold : '',
    replacements: copy(p.replacements),
  }
}

/** 计划摘要输入：门票绑定的是这一串；换一个输入（哪怕同一表单改一个字母）摘要就变。 */
export function rewritePlanInput(plan: any): string {
  return canonicalJson(plan || {})
}

/** 按表单校验计划；空清单回 nothing-to-do，不认识的表单回 bad-form。 */
export function rewriteFormProblem(form: any, plan: any): string | null {
  const meta: any = rewriteFormOf(form)
  if (!meta) return 'bad-form'
  const p: any = plan || {}
  if (meta.needs === 'paths') return rewritePathsProblem(p.paths)
  if (meta.needs === 'renames') return rewriteRenamesProblem(p.renames)
  if (meta.needs === 'authors') return rewriteAuthorsProblem(p.authors)
  if (meta.needs === 'threshold') return rewriteThresholdProblem(p.threshold)
  if (meta.needs === 'replacements') return rewriteReplacementsProblem(p.replacements)
  return 'bad-form'
}

/**
 * 长任务通道的 filter-repo 参数：一个选项一个元素，带值的选项与其值分成两个 argv 元素。
 * 临时文件路径由执行层写好后传进来；没传就回 temp-unavailable，绝不猜一个路径。
 */
export function rewriteTaskTokensOf(form: any, plan: any, tempFiles?: any): any {
  const problem: string | null = rewriteFormProblem(form, plan)
  if (problem) return { ok: false, reason: problem }
  const p: any = plan || {}
  const t: any = tempFiles || {}
  const tokens: string[] = []
  if (form === 'remove-paths') {
    tokens.push('--invert-paths')
    for (let i = 0; i < p.paths.length; i += 1) tokens.push('--path', String(p.paths[i]))
    return { ok: true, tokens: tokens }
  }
  if (form === 'rename-paths') {
    for (let i = 0; i < p.renames.length; i += 1) tokens.push('--path-rename', String(p.renames[i].from) + ':' + String(p.renames[i].to))
    return { ok: true, tokens: tokens }
  }
  if (form === 'rewrite-authors') {
    if (typeof t.mailmapPath !== 'string' || t.mailmapPath === '') return { ok: false, reason: 'temp-unavailable' }
    return { ok: true, tokens: ['--mailmap', t.mailmapPath] }
  }
  if (form === 'remove-large') return { ok: true, tokens: ['--strip-blobs-bigger-than', String(p.threshold)] }
  if (form === 'replace-text') {
    if (typeof t.replacePath !== 'string' || t.replacePath === '') return { ok: false, reason: 'temp-unavailable' }
    return { ok: true, tokens: ['--replace-text', t.replacePath] }
  }
  return { ok: false, reason: 'bad-form' }
}

/** 界面上展示的命令原文：临时文件用可读占位符，不编一个看起来像真路径的假路径。 */
export function rewriteDisplayCommandOf(form: any, plan: any): string {
  const meta: any = rewriteFormOf(form)
  if (!meta) return ''
  const p: any = plan || {}
  const head: string = 'git filter-repo --force '
  if (form === 'remove-paths') {
    const parts: string[] = ['--invert-paths']
    const paths: any[] = Array.isArray(p.paths) ? p.paths : []
    for (let i = 0; i < paths.length; i += 1) parts.push('--path', String(paths[i]))
    return head + parts.join(' ')
  }
  if (form === 'rename-paths') {
    const parts: string[] = []
    const list: any[] = Array.isArray(p.renames) ? p.renames : []
    for (let i = 0; i < list.length; i += 1) parts.push('--path-rename', String(list[i].from) + ':' + String(list[i].to))
    return head + parts.join(' ')
  }
  if (form === 'rewrite-authors') return head + '--mailmap ' + '<面板生成的邮件映射文件>'
  if (form === 'remove-large') return head + '--strip-blobs-bigger-than ' + String(p.threshold || '')
  if (form === 'replace-text') return head + '--replace-text ' + '<面板生成的替换说明文件>'
  return ''
}

/**
 * 备份计划：磁盘够就 clone --mirror（本地硬链接，快且完整），不够就降级 bundle --all。
 * 备份是强制前置（required 恒为 true）；路径放在仓库同级目录，名字带时间戳，避免覆盖旧备份。
 */
export function rewriteBackupPlanOf(scene: any): any {
  const s: any = scene || {}
  const root: string = String(s.repoRoot || '').replace(/\/+$/, '')
  const cut: number = root.lastIndexOf('/')
  const parent: string = cut > 0 ? root.slice(0, cut) : root
  const name: string = cut >= 0 ? root.slice(cut + 1) : root
  const size: number = Number(s.repoSizeBytes) || 0
  const free: number = Number(s.freeBytes) || 0
  const nowMs: number = typeof s.nowMs === 'number' && isFinite(s.nowMs) ? s.nowMs : 0
  const stamp: string = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const enough: boolean = free >= size * 2 + 64 * 1024 * 1024
  const kind: string = enough ? 'mirror' : 'bundle'
  const path: string = parent + '/' + name + '-backup-' + stamp + (kind === 'bundle' ? '.bundle' : '')
  return { kind: kind, required: true, path: path, estimateBytes: size, freeBytes: free, repoSizeBytes: size, reason: enough ? 'mirror-fits' : 'bundle-fallback' }
}

/**
 * 现场闸：动手之前必须全部满足。顺序固定为「工具 → 浅克隆 → 进行中操作 → 工作区脏 → 空仓库 → 表单」，
 * 界面按第一个不满足的原因说明，不把五条原因一次倒给人。
 */
export function rewriteGuardProblem(scene: any, plan: any): string | null {
  const s: any = scene || {}
  if (s.filterRepoAvailable !== true) return 'tool-missing'
  if (s.shallow === true) return 'shallow-repo'
  if (s.operation) return 'operation-in-progress'
  if (s.dirty === true) return 'dirty-worktree'
  if (!(Number(s.commitCount) > 0)) return 'nothing-to-do'
  return rewriteFormProblem((plan || {}).form, plan)
}

/** 五张表单的真源常量：门禁按它确认本文件没有被别的批次悄悄改小。 */
export const REWRITE_OPS_SOURCE = 'src/shared/version-control/src/rewrite-ops.ts: remove-paths rename-paths rewrite-authors remove-large replace-text'
