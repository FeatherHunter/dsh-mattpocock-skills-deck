/**
 * src/shared/version-control/src/stash-rules.ts —— 贮藏十条（域 7）的唯一规则层（#1751 T16）
 *
 * 为什么集中在这里：十条能力对应十条 git 命令，命令怎么拼、选择器与分支名怎么校验、
 * 哪两条是毁数据的危险动作、哪一条要 2.35 版本门，只有这一份。宿主执行层
 * （src/host/versionControlStash.ts）按普通相对 import 读它；界面侧由构建拼进闭包
 * （scripts/build.mts 的 shared:vcStashRules 标记）。界面与宿主各写一份，就会各说各话
 * ——那正是本票要避免的「入口做了另一套动作」。
 *
 * 本文件不 import 任何文件：共享层禁层内互引（same-layer-import-shared 只许减不许增），
 * 贮藏列表命令原文由 commands.ts 的 stashListArgs() 提供，本文件的 list 编排保持同一形状，
 * tests/verify-1586-stash-page.ts 会逐字节对账两份拼出来的 argv 是否一致。
 */

/** 一条贮藏动作的登记：能力编号（账本）、动作短名（电话与界面共用）、词条键与版本门。 */
export interface StashOpDef {
  /** 能力账本编号（7.1–7.10）；界面与门禁都按它认人。 */
  id: string
  /** 动作短名：宿主电话的 op 参数与界面 data-vc-stash-op 共用同一个词。 */
  op: string
  /** 动作名词条键（中英两份都在 config/copy/vcstash.yaml）。 */
  nameKey: string
  /** 账本里的等级：写 / 读 / 毁；毁档一律要确认卡。 */
  level: string
  /** 危险动作（会删记录）要确认卡，默认焦点在取消键。 */
  danger: boolean
  /** 要不要一条贮藏选择器（stash@{n}）。 */
  needsSelector: boolean
  /** 要不要一条贮藏说明（写进 reflog 主题）。 */
  needsMessage: boolean
  /** 要不要一个新分支名。 */
  needsBranch: boolean
  /** 账本登记的最低 git 版本（2.11 是硬底线）。 */
  minVersion: string
  /** 低于 minVersion 时的策略：hide = 藏起来并写替代做法；null = 按隐藏处理。 */
  versionPolicy: 'degrade' | 'hide' | null
  /** 低版本替代做法在词表里的键；完整可用时为 null。 */
  versionAlternativeKey: string | null
}

/** 十条能力的唯一名单；次序就是账本 7.1–7.10 的次序，界面按它排动作。 */
export const STASH_OPS: StashOpDef[] = [
  { id: '7.1', op: 'push', nameKey: 'vc.stash.op.push', level: '写', danger: false, needsSelector: false, needsMessage: true, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.2', op: 'push-untracked', nameKey: 'vc.stash.op.pushUntracked', level: '写', danger: false, needsSelector: false, needsMessage: true, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.3', op: 'push-staged', nameKey: 'vc.stash.op.pushStaged', level: '写', danger: false, needsSelector: false, needsMessage: true, needsBranch: false, minVersion: '2.35', versionPolicy: 'hide', versionAlternativeKey: 'vc.stash.gate.alternative' },
  { id: '7.4', op: 'list', nameKey: 'vc.stash.op.list', level: '读', danger: false, needsSelector: false, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.5', op: 'show', nameKey: 'vc.stash.op.show', level: '读', danger: false, needsSelector: true, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.6', op: 'apply', nameKey: 'vc.stash.op.apply', level: '写', danger: false, needsSelector: true, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.7', op: 'pop', nameKey: 'vc.stash.op.pop', level: '写', danger: false, needsSelector: true, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.8', op: 'branch', nameKey: 'vc.stash.op.branch', level: '写', danger: false, needsSelector: true, needsMessage: false, needsBranch: true, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.9', op: 'drop', nameKey: 'vc.stash.op.drop', level: '毁', danger: true, needsSelector: true, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
  { id: '7.10', op: 'clear', nameKey: 'vc.stash.op.clear', level: '毁', danger: true, needsSelector: false, needsMessage: false, needsBranch: false, minVersion: '2.11', versionPolicy: null, versionAlternativeKey: null },
]

/**
 * 十条动作里哪些是写（要预检凭票）、哪些是读（直接跑）：#841/#1742 的先例是「任何写命令之前
 * 必须先过票据门」，贮藏这十条同样适用；restore（最近丢弃的恢复）不在十条里，但它也往
 * refs/stash 里写，所以同样凭票走，不享受读动作的直通。
 */
export const STASH_WRITE_OPS: string[] = ['push', 'push-untracked', 'push-staged', 'apply', 'pop', 'branch', 'drop', 'clear', 'restore']
/** 读动作（列表与查看内容）：不签票、不改仓库，直接跑。 */
export const STASH_READ_OPS: string[] = ['list', 'show']

/** 这条动作要不要凭票：写动作全部要，读动作全部不要；认不出按写处理（宁严不松）。 */
export const stashNeedsTicketOf = function (op: any): boolean {
  const name = String(op || '')
  for (let i = 0; i < STASH_READ_OPS.length; i += 1) if (STASH_READ_OPS[i] === name) return false
  return true
}

/** 账本里 7.3 的替代做法原文（规格 #1586 第 6 节），低版本界面上照着说，不自己编。 */
export const STASH_STAGED_ALTERNATIVE = '先做一次全量贮藏，再恢复未暂存的部分'
/** git 硬底线：低于它所有贮藏能力都藏起来（与 capabilities.ts 的 VERSION_FLOOR 同一条线）。 */
export const STASH_VERSION_FLOOR = '2.11.0'
/** 只贮藏已暂存的文件（--staged）要求的最低版本（规格第 6 节）。 */
export const STASH_STAGED_MIN_VERSION = '2.35.0'
/** 贮藏说明上限：写进 reflog 主题，太长会让列表没法读。 */
export const STASH_MESSAGE_MAX = 200
/** 分支名上限（git 自己按字节限制到 255 左右；这里按字符数收在 200，避免宽字符越界）。 */
export const STASH_BRANCH_MAX = 200
/** 「最近丢弃」最多留几条：git 垃圾回收之前够找回就行。 */
export const STASH_RECENT_MAX = 20
/** 选择器的唯一形状：stash@{n}（与 parse-stash.ts 的解析器同一份口径）。 */
export const STASH_SELECTOR_PATTERN = /^stash@\{[0-9]+\}$/

/** 按动作短名取登记；认不出回 null（调用方要说「不认识这个动作」，不猜）。 */
export const stashOpOf = function (op: any): StashOpDef | null {
  const name = String(op || '')
  for (let i = 0; i < STASH_OPS.length; i += 1) if (STASH_OPS[i].op === name) return STASH_OPS[i]
  return null
}

/** 按能力编号取登记；认不出回 null。账本与本表对不上时门禁会当场红。 */
export const stashOpById = function (capId: any): StashOpDef | null {
  const id = String(capId || '')
  for (let i = 0; i < STASH_OPS.length; i += 1) if (STASH_OPS[i].id === id) return STASH_OPS[i]
  return null
}

/** 认不出动作时给的词条键（词表兜底，界面不印裸动作名）。 */
export const STASH_UNKNOWN_OP_KEY = 'vc.stash.op.unknown'

/** 动作名的词条键：认得出用登记里的键，认不出给兜底键。 */
export const stashOpNameKeyOf = function (op: any): string {
  const def: StashOpDef | null = stashOpOf(op)
  return def ? def.nameKey : STASH_UNKNOWN_OP_KEY
}

/** 危险动作名单（drop / clear）：界面据此要求确认，宿主据此在回包里回显 confirm 字段。 */
export const stashDangerOpsOf = function (): string[] {
  return STASH_OPS.filter(function (d: StashOpDef) { return d.danger }).map(function (d: StashOpDef) { return d.op })
}

/** 选择器校验：必须正好是 stash@{n}。 */
export const vcStashSelectorOk = function (selector: any): boolean {
  return STASH_SELECTOR_PATTERN.test(String(selector || ''))
}

/** 贮藏说明的校验结果；空串表示合格，否则是稳定原因码（界面按原因码查词条）。 */
export const vcStashMessageError = function (message: any): string {
  const text = String(message === undefined || message === null ? '' : message)
  if (text.trim() === '') return 'empty'
  if (text.length > STASH_MESSAGE_MAX) return 'too-long'
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return 'control'
  return ''
}

/**
 * 分支名校验（本地这一层先挡住明显不合法的，省一次进程）：
 * git check-ref-format --branch 的规则里与用户输入有关的几条都在这里；长度按字符数收。
 * 空串表示合格，否则是稳定原因码：empty / too-long / invalid。
 */
export const vcStashBranchError = function (branch: any): string {
  const name = String(branch === undefined || branch === null ? '' : branch)
  if (name === '') return 'empty'
  if (name.length > STASH_BRANCH_MAX) return 'too-long'
  if (name === '@') return 'invalid'
  if (name.charAt(0) === '-' || name.charAt(0) === '/') return 'invalid'
  if (name.charAt(name.length - 1) === '/' || name.charAt(name.length - 1) === '.') return 'invalid'
  if (/[\u0000-\u0020\u007f~^:?*\[\\]/.test(name)) return 'invalid'
  if (name.indexOf('..') >= 0 || name.indexOf('@{') >= 0 || name.indexOf('//') >= 0) return 'invalid'
  if (name === '.lock' || name.indexOf('.lock/') >= 0 || /\.lock$/.test(name)) return 'invalid'
  return ''
}

/** 一次命令拼装的结果：成功给 args，失败给稳定原因码与一句说明（说明不进界面可见正文）。 */
export interface StashArgsResult {
  ok: boolean
  args?: string[]
  error?: { kind: string; message: string }
}

/** 失败结果的小工厂：命令层两个入口共用同一形状。 */
const argsFail = function (kind: string, message: string): StashArgsResult {
  return { ok: false, error: { kind: kind, message: message } }
}

/**
 * 把一条贮藏动作拼成 git 子命令（不含程序名、-C 与固定前缀；那一段由宿主进程出口统一加）。
 * payload 只认 message（说明）、selector（选择器）、branch（新分支名），其余一概不看。
 * 危险动作不在这里要 confirm：确认卡是界面与电话前端的职责，命令拼装只认动作本身。
 */
export const stashOperationArgs = function (op: any, payload: any): StashArgsResult {
  const def: StashOpDef | null = stashOpOf(op)
  if (!def) return argsFail('usage', '不认识的贮藏动作：' + String(op || ''))
  const p = payload || {}
  const message = String(p.message === undefined || p.message === null ? '' : p.message)
  const selector = String(p.selector || '')
  const branch = String(p.branch || '')
  if (def.needsMessage) {
    const why: string = vcStashMessageError(message)
    if (why !== '') return argsFail('message', '贮藏说明不合格（' + why + '）')
  }
  if (def.needsSelector && !vcStashSelectorOk(selector)) return argsFail('selector', '贮藏选择器不合法：' + selector)
  if (def.needsBranch) {
    const why: string = vcStashBranchError(branch)
    if (why !== '') return argsFail('branch', '分支名不合法（' + why + '）：' + branch)
  }
  if (def.op === 'push') return { ok: true, args: ['stash', 'push', '-m', message] }
  // 7.2 前面多带一个全局开关 --no-literal-pathspecs：宿主统一前缀里有 --literal-pathspecs（见 commands.fixedPrefix），
  // 而 git 2.49 在 --literal-pathspecs 生效时执行 stash push -u 会**静默地不收未跟踪文件**（退出码 0、命令照常打印
  // Saved working directory，文件却留在原地）。实测复现：-u 与 --include-untracked 都受影响；把开关在子命令前关掉即恢复。
  // 这条只影响 7.2 一个动作，其余动作不需要路径魔法。
  if (def.op === 'push-untracked') return { ok: true, args: ['--no-literal-pathspecs', 'stash', 'push', '-u', '-m', message] }
  if (def.op === 'push-staged') return { ok: true, args: ['stash', 'push', '--staged', '-m', message] }
  // 列表格式与 commands.ts 的 stashListArgs 是同一份形状（四条 NUL 字段）。这里不导出常量：共享层内部自用的导出常量
  // 会被「死了的常量」门禁判红（那道门禁只认生产树与测试里的读者）。两边同一份形状由 tests/verify-1586-stash-page.ts 逐字节对账。
  if (def.op === 'list') return { ok: true, args: ['stash', 'list', '--format=%gd%x00%H%x00%ct%x00%gs'] }
  if (def.op === 'show') return { ok: true, args: ['stash', 'show', '-p', selector] }
  if (def.op === 'apply') return { ok: true, args: ['stash', 'apply', selector] }
  if (def.op === 'pop') return { ok: true, args: ['stash', 'pop', selector] }
  if (def.op === 'branch') return { ok: true, args: ['stash', 'branch', branch, selector] }
  if (def.op === 'drop') return { ok: true, args: ['stash', 'drop', selector] }
  if (def.op === 'clear') return { ok: true, args: ['stash', 'clear'] }
  return argsFail('usage', '贮藏动作没有对应的命令：' + def.op)
}

/**
 * 「最近丢弃」的恢复命令：spec 第 3.6 节要求丢弃后能把 git 打印的提交号还回去，
 * 且**不额外造本地引用**——git 自带的办法就是 stash store（把那个提交重新挂回 refs/stash）。
 * 这不是十条能力里的一条，是丢弃动作的撤销路径，所以不登记进 STASH_OPS。
 */
export const stashRestoreArgs = function (subject: any, oid: any): StashArgsResult {
  const hash = String(oid || '')
  if (!/^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(hash)) return argsFail('oid', '提交号不是 40 或 64 位十六进制：' + hash)
  const text = String(subject === undefined || subject === null ? '' : subject)
  const message = text.trim() === '' ? 'stash ' + hash.slice(0, 12) : text.slice(0, STASH_MESSAGE_MAX)
  return { ok: true, args: ['stash', 'store', '-m', message, hash] }
}

/** 解析版本串里的前三个数字（只认数字，不猜）；解析不出回 null。 */
export const stashParseVersion = function (text: any): { major: number; minor: number; patch: number } | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''))
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? 0 : Number(m[3]) }
}

const versionAtLeast = function (have: { major: number; minor: number; patch: number }, need: { major: number; minor: number; patch: number }): boolean {
  if (have.major !== need.major) return have.major > need.major
  if (have.minor !== need.minor) return have.minor > need.minor
  return have.patch >= need.patch
}

/** 版本串是否达到 minVersion；版本缺失或解析不出按「不到」处理（宁可藏起来也不给点了就报错的按钮）。 */
export const stashVersionAtLeast = function (versionText: any, minVersion: any): boolean {
  const have = stashParseVersion(versionText)
  const need = stashParseVersion(minVersion)
  if (!have || !need) return false
  return versionAtLeast(have, need)
}

/** 一条动作在某版 git 上的可用状态：full 完整可用；degraded 可用但写替代做法；hidden 藏起来。 */
export const vcStashOpVersionStateOf = function (op: any, versionText: any): string {
  const def: StashOpDef | null = stashOpOf(op)
  if (!def) return 'hidden'
  if (!stashVersionAtLeast(versionText, STASH_VERSION_FLOOR)) return 'hidden'
  if (stashVersionAtLeast(versionText, def.minVersion)) return 'full'
  return def.versionPolicy === 'degrade' ? 'degraded' : 'hidden'
}

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const STASH_RULES_SOURCE = 'src/shared/version-control/src/stash-rules.ts'
