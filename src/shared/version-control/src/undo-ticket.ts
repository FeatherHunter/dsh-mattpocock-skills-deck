/**
 * src/shared/version-control/src/undo-ticket.ts —— 历史改写凭票的契约常量与绑定摘要（#1748 T13，规格 #1586 域 5）
 *
 * 为什么单独一叶：预检签票与执行前重验分住在宿主的两个不同叶子里（versionControlUndoCheck 与
 * versionControlUndoWrite），两边必须用同一套「计划摘要 / 工作区摘要」算法；算法复制两份必然漂移，
 * 所以放在共享层，两边 import 同一份。漂移的后果不是样式问题，而是执行前那句「现场没变」会假成立。
 *
 * 约定（改这里之前先读）：
 *   1. 摘要只用来判「两次读数一样不一样」，不参与任何安全判断；它是本文件自带的 64 位 FNV 变体
 *      短哈希，不引 node:crypto——客户端构建不该为了一个比对摘要把 crypto 拉进闭包。
 *   2. 键排序是稳定序列化的一部分：同一份计划无论对象字面量怎么写、字段顺序怎么排，摘要必须一样。
 *      否则「预检时的计划」与「执行前重算的计划」会被判成两个东西，写动作全部误报 target-changed。
 *   3. 场景摘要只写界面与日志需要的几个事实（头、分支、脏不脏、是否停在中途操作），不把整个屏幕
 *      倒进回包：屏幕里有文件清单与提交列表，越大越容易把「现场变了」的判据混进去。
 */

/** 电话契约名与版本：宿主回包与门禁按这两个值对账，改名等于换契约。 */
export const UNDO_CHECK_CONTRACT: string = 'version-control.undo-check'
export const UNDO_CHECK_VERSION: number = 1

/**
 * 稳定序列化：对象键排序、数组保序、undefined 与非有限数字一律归一成 null（与写层票表同一口径）。
 * 返回 JSON 文本（同一份值恒得同一串字符），供摘要使用。
 * 这份实现与另外四份由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须五份一起改。
 */
export function undoStableValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(undoStableValue).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + undoStableValue(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 64 位 FNV 变体短哈希：16 位十六进制，只用于比对，不用于任何密码学用途。
 *  两份 FNV 由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须两份一起改。 */
export function undoHash16(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  let h1: number = 0x811c9dc5
  let h2: number = 0x01000193
  for (let i = 0; i < s.length; i += 1) {
    const c: number = s.charCodeAt(i)
    h1 = ((h1 ^ c) * 16777619) >>> 0
    h2 = ((h2 + c * (i + 1)) * 2246822519) >>> 0
  }
  const a: string = ('00000000' + h1.toString(16)).slice(-8)
  const b: string = ('00000000' + h2.toString(16)).slice(-8)
  return a + b
}

/** 计划的绑定摘要：计划里决定「执行什么」的字段全进去（动作、目标提交号、说明、拣选清单与原次序）。 */
export function undoPlanDigestOf(plan: any): string {
  const p: any = plan || {}
  const commits: any[] = Array.isArray(p.commits) ? p.commits : []
  const picks: string[] = commits.map(function (one: any) {
    if (typeof one === 'string') return one
    return String((one && one.oid) || (one && one.rev) || '')
  })
  return undoHash16(undoStableValue({
    op: String(p.op || ''),
    target: String(p.target || ''),
    targetOid: String(p.targetOid || ''),
    message: String(p.message === undefined || p.message === null ? '' : p.message),
    resetMode: String(p.resetMode || ''),
    commits: picks,
  }))
}

/**
 * 工作区形状的绑定摘要：暂存区与未暂存区的文件清单（路径加状态位）压成一份摘要。
 * 头提交单独比（stale-head 有专属拒绝理由），这里只回答「文件层面动没动过」。
 */
export function undoWorktreeDigestOf(screen: any): string {
  const s: any = screen || {}
  const pairOf = function (one: any): any {
    const f: any = one || {}
    return [String(f.path || ''), String(f.status || ''), String(f.origPath || '')]
  }
  const staged: any[] = Array.isArray(s.staged) ? s.staged.map(pairOf) : []
  const unstaged: any[] = Array.isArray(s.unstaged) ? s.unstaged.map(pairOf) : []
  return undoHash16(undoStableValue({ staged: staged, unstaged: unstaged, conflicts: Number(s.conflictCount) || 0 }))
}

/**
 * 场景摘要：预检回包里给界面与门禁看的那几个事实。
 * 一律用「读不到就是读不到」的写法：头为空串就写空串，不编一个假提交号。
 */
export function undoSceneSummaryOf(screen: any): any {
  const s: any = screen || {}
  const identity: any = s.identity || {}
  const repo: any = s.repo || {}
  const head: string = String(identity.oid || '')
  const mid: boolean = repo.merging === true || repo.rebasing === true || repo.cherryPicking === true || repo.reverting === true
  const stagedN: number = Number(s.stagedCount) || 0
  const unstagedN: number = Number(s.unstagedCount) || 0
  return {
    head: head,
    headShort: head === '' ? '' : head.slice(0, 10),
    branch: String(identity.branch || ''),
    detached: identity.detached === true,
    dirty: stagedN > 0 || unstagedN > 0,
    stagedCount: stagedN,
    unstagedCount: unstagedN,
    conflictCount: Number(s.conflictCount) || 0,
    hasCommits: repo.hasCommits === true,
    midOperation: mid,
    midOperationWhich: repo.merging === true ? 'merge' : (repo.rebasing === true ? 'rebase' : (repo.cherryPicking === true ? 'cherry-pick' : (repo.reverting === true ? 'revert' : ''))),
  }
}

export const UNDO_TICKET_SOURCE = 'src/shared/version-control/src/undo-ticket.ts'
