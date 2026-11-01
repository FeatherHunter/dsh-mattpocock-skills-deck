/**
 * src/shared/version-control/src/remote.ts —— 域 8「远端与同步」的纯函数（#1754 T18）
 *
 * 这里只有解析、argv 拼装、输入校验与联网失败分类，不读盘、不起进程、不联网；
 * 真正跑 git 与限频（同一远端同一时刻只飞一个请求）在宿主叶子 src/host/versionControlRemote.ts。
 *
 * 三条硬约定：
 *   1. 远端名与地址都是用户输入，一律做形状校验，并作为独立 argv 元素排在 -- 之后；
 *      argv 里永远拼不出 --upload-pack / --exec / --server-option / --depth 这类能改行为的选项
 *      （ADR 20261031 第 6 节）。
 *   2. 地址里可能带着用户口令（https://user:token@host/...）：展示值一律抹成 //***@，
 *      解析结果与失败原话都不许把口令原文带出去。
 *   3. 读不全就整体失败，不给半份：远端列表缺 fetch/push、分支记录字段数不对、
 *      ls-remote 的提交号不是十六进制，都返回 ok:false，由界面显式说「这次没读全」。
 */

/** 远端列表里的一条：名字 + fetch/push 地址（展示值，口令已抹）+ 这条地址带不带凭据。 */
export interface RemoteEntry {
  name: string
  fetchUrl: string
  pushUrl: string
  hasCredential: boolean
}

/** 远端跟踪分支的一条：短名（main）、完整跟踪名（origin/main）、提交号。 */
export interface RemoteBranch {
  short: string
  name: string
  oid: string
  ref: string
}

/** ls-remote 的一条引用：分支、标签（含 ^{} 解引用行）、或其他。 */
export interface LsRemoteRef {
  oid: string
  ref: string
  kind: 'branch' | 'tag' | 'other'
}

/** 引用选择器/地址校验的稳定标识符（中文话术在客户端词表）。 */
const MAX_NAME_LENGTH = 200
const MAX_URL_LENGTH = 2048
const OID_RE = /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/

/** 抹掉 URL 里的 userinfo 口令：https://user:token@host/x -> https://***@host/x。
 *  scp 风格（git@host:path）里的 git 是用户名不是口令，不动；只有 //...@ 这一段才抹。 */
export function scrubCredentialText(text: unknown): string {
  return String(text === undefined || text === null ? '' : text).replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\/\s@]+@/g, '$1***@')
}

/** 地址的展示值：口令抹掉；是否带凭据单独标出来（界面据此说「这条地址里带登录信息」）。 */
export function remoteUrlDisplayOf(url: unknown): { display: string; hasCredential: boolean } {
  const raw = String(url === undefined || url === null ? '' : url)
  return { display: scrubCredentialText(raw), hasCredential: /\/\/[^\/\s@]+@/.test(raw) }
}

/** 解析 git remote -v：每个名字必须正好一条 fetch 与一条 push；缺一条或重复都算整体读不全。 */
export function parseRemoteList(stdout: unknown): { ok: true; remotes: RemoteEntry[] } | { ok: false; error: string } {
  const text = String(stdout === undefined || stdout === null ? '' : stdout).replace(/\r/g, '')
  const lines = text.split('\n')
  const order: string[] = []
  const table: Record<string, { fetch?: string; push?: string }> = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') continue
    const parts = line.split('\t')
    if (parts.length !== 2) return { ok: false, error: 'remote-list-malformed' }
    const m = /^(.*) \((fetch|push)\)$/.exec(parts[1])
    if (!m) return { ok: false, error: 'remote-list-malformed' }
    const name = parts[0]
    if (name === '') return { ok: false, error: 'remote-list-malformed' }
    const kind: 'fetch' | 'push' = (m[2] === 'push') ? 'push' : 'fetch'
    const url = m[1]
    if (!table[name]) { table[name] = {}; order.push(name) }
    if (table[name][kind] !== undefined) return { ok: false, error: 'remote-list-malformed' }
    table[name][kind] = url
  }
  const remotes: RemoteEntry[] = []
  for (const name of order) {
    const row = table[name]
    if (!row.fetch || !row.push) return { ok: false, error: 'remote-list-malformed' }
    const fetchDisplay = remoteUrlDisplayOf(row.fetch)
    const pushDisplay = remoteUrlDisplayOf(row.push)
    remotes.push({
      name: name,
      fetchUrl: fetchDisplay.display,
      pushUrl: pushDisplay.display,
      hasCredential: fetchDisplay.hasCredential || pushDisplay.hasCredential,
    })
  }
  return { ok: true, remotes: remotes }
}

/** 解析 for-each-ref（%00 分隔 refname 与 objectname）里的远端跟踪分支；HEAD 别名不算一条分支。 */
export function parseRemoteBranches(stdout: unknown, remoteName: unknown): { ok: true; branches: RemoteBranch[] } | { ok: false; error: string } {
  const prefix = 'refs/remotes/' + String(remoteName || '') + '/'
  const text = String(stdout === undefined || stdout === null ? '' : stdout).replace(/\r/g, '')
  const branches: RemoteBranch[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const parts = line.split('\u0000')
    if (parts.length !== 2) return { ok: false, error: 'remote-branches-malformed' }
    const ref = parts[0]
    const oid = parts[1]
    if (ref.indexOf(prefix) !== 0 || ref.length <= prefix.length) return { ok: false, error: 'remote-branches-malformed' }
    if (!OID_RE.test(oid)) return { ok: false, error: 'remote-branches-malformed' }
    const short = ref.slice(prefix.length)
    if (short === 'HEAD') continue
    branches.push({ short: short, name: String(remoteName || '') + '/' + short, oid: oid, ref: ref })
  }
  return { ok: true, branches: branches }
}

/** 解析 git ls-remote：每行「提交号\t完整引用名」；提交号不是十六进制就整体失败。 */
export function parseLsRemote(stdout: unknown): { ok: true; refs: LsRemoteRef[] } | { ok: false; error: string } {
  const text = String(stdout === undefined || stdout === null ? '' : stdout).replace(/\r/g, '')
  const refs: LsRemoteRef[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const i = line.indexOf('\t')
    if (i <= 0) return { ok: false, error: 'ls-remote-malformed' }
    const oid = line.slice(0, i)
    const ref = line.slice(i + 1)
    if (!OID_RE.test(oid) || ref === '') return { ok: false, error: 'ls-remote-malformed' }
    const kind: LsRemoteRef['kind'] = ref.indexOf('refs/heads/') === 0 ? 'branch' : (ref.indexOf('refs/tags/') === 0 ? 'tag' : 'other')
    refs.push({ oid: oid, ref: ref, kind: kind })
  }
  return { ok: true, refs: refs }
}

/** 读远端列表的命令：固定 git remote -v。 */
export function remoteListArgs(): string[] { return ['remote', '-v'] }

/** 读某个远端的本地跟踪分支：refs 参数放在第 2 位，后面才是格式；不给任何改行为的选项。 */
export function remoteBranchesArgs(remoteName: string): string[] {
  return ['for-each-ref', 'refs/remotes/' + String(remoteName) + '/', '--format=%(refname)%00%(objectname)']
}

/** 登记远端：名字与地址都是独立元素，排在 -- 之后（-- 防止被当成选项）。 */
export function remoteAddArgs(name: string, url: string): string[] { return ['remote', 'add', '--', String(name), String(url)] }

/** 改名远端。 */
export function remoteRenameArgs(from: string, to: string): string[] { return ['remote', 'rename', '--', String(from), String(to)] }

/** 删除远端。 */
export function remoteRemoveArgs(name: string): string[] { return ['remote', 'remove', '--', String(name)] }

/** 改远端地址。 */
export function remoteSetUrlArgs(name: string, url: string): string[] { return ['remote', 'set-url', '--', String(name), String(url)] }

/** 联网查看：git ls-remote <远端名> [<引用名>...]，远端名与引用名都按独立元素直传。 */
export function lsRemoteArgs(remoteName: string, refs: unknown): string[] {
  const out: string[] = ['ls-remote', String(remoteName)]
  const list = Array.isArray(refs) ? refs : []
  for (const r of list) out.push(String(r))
  return out
}

/** 远端名的形状校验：返回 null 表示可用，否则给稳定标识符。git 允许非 ASCII 名字，这里不误杀。 */
export function remoteNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return 'empty'
  if (name.length > MAX_NAME_LENGTH) return 'too-long'
  if (name.charAt(0) === '-') return 'leading-dash'
  if (/\s/.test(name)) return 'whitespace'
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'control'
  if (/[\\:*?"<>|]/.test(name)) return 'shape'
  return null
}

/** 地址的形状校验：认 https/http/ssh/git/file、scp 风格与本机绝对路径，拒绝前导减号/空白/控制字符/未知协议。 */
export function remoteUrlProblem(url: unknown): string | null {
  if (typeof url !== 'string' || url === '') return 'empty'
  if (url.length > MAX_URL_LENGTH) return 'too-long'
  if (url.charAt(0) === '-') return 'leading-dash'
  if (/[\u0000-\u001f\u007f]/.test(url)) return 'control'
  if (/\s/.test(url)) return 'whitespace'
  // 本机绝对路径（Windows 盘符或 POSIX 路径）是合法地址：离线仓库、U 盘上的裸仓库都走这一路。
  if (/^[A-Za-z]:[\\/]/.test(url) || url.charAt(0) === '/' || url.indexOf('\\\\') === 0) return null
  // scp 风格：user@host:path（冒号前不含斜杠）。
  if (/^[^\/:@\s]+@[^\/:@\s]+:/.test(url)) return null
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url)
  if (!scheme) return 'scheme'
  const name = scheme[1].toLowerCase()
  if (['https', 'http', 'ssh', 'git', 'file'].indexOf(name) < 0) return 'scheme'
  return null
}

/** 联网查看的引用选择器：分支短名或完整引用名；空、前导减号、空白、非法形状都拒绝。 */
export function remoteRefSelectorProblem(ref: unknown): string | null {
  if (typeof ref !== 'string' || ref === '') return 'empty'
  if (ref.length > MAX_NAME_LENGTH) return 'too-long'
  if (ref.charAt(0) === '-') return 'leading-dash'
  if (/\s/.test(ref)) return 'whitespace'
  if (/[\u0000-\u001f\u007f]/.test(ref)) return 'control'
  if (ref.indexOf('..') >= 0 || ref.indexOf('//') >= 0 || ref.charAt(ref.length - 1) === '/' || ref.charAt(ref.length - 1) === '.' || ref.charAt(0) === '/') return 'shape'
  return null
}

/**
 * 远端四条写动作的登记表：动作名、git 子命令、执行电话与预检电话一次写清。
 * 宿主预检用它做白名单（不认识的动作直接拒绝，不猜），界面按动作名取电话，两边都不另写名单。
 * checkPhone 四条相同是故意的：预检只签一种票，票里带着动作与目标。
 */
export const REMOTE_WRITE_ACTIONS: Array<{ action: string; command: string; execPhone: string; checkPhone: string }> = [
  { action: 'add', command: 'git remote add', execPhone: 'wf.gitRemoteAdd', checkPhone: 'wf.gitRemoteCheck' },
  { action: 'rename', command: 'git remote rename', execPhone: 'wf.gitRemoteRename', checkPhone: 'wf.gitRemoteCheck' },
  { action: 'remove', command: 'git remote remove', execPhone: 'wf.gitRemoteRemove', checkPhone: 'wf.gitRemoteCheck' },
  { action: 'setUrl', command: 'git remote set-url', execPhone: 'wf.gitRemoteSetUrl', checkPhone: 'wf.gitRemoteCheck' },
]

/** 按动作名查写动作登记表；不在表里一律回 null（预检与执行都据此拒绝）。 */
export function remoteWriteActionOf(action: unknown): { action: string; command: string; execPhone: string; checkPhone: string } | null {
  const want = String(action || '')
  for (let i = 0; i < REMOTE_WRITE_ACTIONS.length; i += 1) if (REMOTE_WRITE_ACTIONS[i].action === want) return REMOTE_WRITE_ACTIONS[i]
  return null
}

/** 联网读取的失败分类：ADR 第 6 节要求至少分开 没网络 / 要凭据 / 远端不在或没权限 / 超时 / 输出截断 / 其他。 */
export interface LsRemoteFailure {
  kind: 'timeout' | 'needs-credential' | 'no-network' | 'remote-missing' | 'truncated' | 'other'
  reason: string
  message: string
  hint: string
}

const FAILURE_HINTS: Record<string, string> = {
  timeout: '这次联网读取等太久没有回音，已经停下。可以在网络好一点的时候再点一次「联网查看」。',
  'needs-credential': '远端要登录才能看。面板不弹密码框，也不保存令牌：请到右侧栏终端里登录一次（或者先登好凭据助手），再回来点一次「联网查看」。',
  'no-network': '这台机器现在连不上那个远端（域名没解析出来、网络不通或被挡了）。检查网络或代理后再试一次。',
  'remote-missing': '远端说没有这个仓库，或者这台机器没有访问权限。确认地址与仓库名，需要的话到终端里核实一次。',
  truncated: '这次输出被截断了，读不全就不给你半份引用清单。请缩小引用范围（只看某个分支或标签）再试一次。',
  other: '联网读取没有成功，git 的原话在上面。可以稍后再点一次；一直不行就去终端里手动跑一次看完整输出。',
}

/** 把一次 ls-remote 的执行结果翻成失败的分类与话术；成功（kind 为 ok 且未截断）时返回 null。 */
export function classifyLsRemoteFailure(input: unknown): LsRemoteFailure | null {
  const r: any = input || {}
  if (r.truncated === true) return failureOf('truncated', '这次联网输出被截断了，读不全。')
  if (r.kind === 'timeout') return failureOf('timeout', '这次联网读取超时了。')
  if (r.kind === 'cancelled') return failureOf('other', '这次联网读取被取消了。')
  if (r.kind === 'spawn-failed') return failureOf('other', '起不了 git 进程：' + String(r.message || ''))
  if (r.kind !== 'non-zero') return null
  const stderr = scrubCredentialText(r.stderr)
  const low = stderr.toLowerCase()
  const line = firstLineOf(stderr)
  const says = line ? '；git 说：' + line : ''
  if (/could not read username|could not read password|terminal prompts disabled|authentication failed|permission denied \(publickey|invalid username or password|support for password authentication|access denied/.test(low)) {
    return failureOf('needs-credential', '远端要凭据才能读取，面板这边不弹登录框。' + says)
  }
  if (/could not resolve host|could not resolve hostname|network is unreachable|connection timed out|connection refused|failed to connect|connection reset|no route to host|temporary failure in name resolution/.test(low)) {
    return failureOf('no-network', '这台机器连不上那个远端。' + says)
  }
  if (/repository not found|not found|does not appear to be a git repository|no such remote|remote repository not found|project not found/.test(low)) {
    return failureOf('remote-missing', '远端说没有这个仓库或没有访问权限。' + says)
  }
  return failureOf('other', '联网读取没有成功。' + says)
}
function failureOf(kind: LsRemoteFailure['kind'], message: string): LsRemoteFailure {
  return { kind: kind, reason: kind, message: message, hint: FAILURE_HINTS[kind] }
}
function firstLineOf(text: string): string {
  const t = String(text || '').replace(/\r/g, '').trim()
  if (!t) return ''
  const i = t.indexOf('\n')
  return (i >= 0 ? t.slice(0, i) : t).slice(0, 300)
}
