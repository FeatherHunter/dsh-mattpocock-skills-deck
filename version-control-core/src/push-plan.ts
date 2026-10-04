/**
 * version-control-core/src/push-plan.ts —— 推送目标解析（#841，纯函数）
 *
 * 三档（D3 + 总工订正）：
 *   1. 有上游且还在 → 推上游：remote 从远端清单里**最长前缀匹配**解析出来（远端名本身可以含斜杠，
 *      绝不能按第一个斜杠切），目标分支就是上游里那一段；
 *   2. 上游被删 / 没设上游 → set-upstream 档：显式 -u 建立上游；目标必须**具名远端**，多远端时
 *      不替用户挑（回 need-remote-choice 把候选列出去，界面让用户选）；
 *   3. 任何一档都要回一个完整目标（remote/branch/localBranch），界面确认框照它逐字显示。
 * 「这个分支没有上游」这件事在执行前还要由宿主再核一次（实测：已存在上游时再带 -u 会静默覆盖）。
 */
import type { WritePlan } from './ports.js'

const REMOTE_PATTERN = /^(?!-)[A-Za-z0-9._/-]+$/ // git 允许远端名含斜杠（git remote add foo/bar）；仍禁 : 空白 NUL 与前导 -
const BRANCH_PATTERN = /^(?![-+])[^\s\u0000:\\]+$/ // 前导 - 是选项、前导 + 是强推标记（#841 第三批·安全级）

export interface PushPlanInput {
  branch: string
  upstream: string | null
  upstreamGone: boolean
  remotes: string[]
  requestedRemote?: string | null
}

export type PushPlanResult =
  | { ok: true; plan: WritePlan }
  | { ok: false; reason: 'need-remote-choice'; candidates: string[] }
  | { ok: false; reason: 'no-remote' | 'bad-target' }

export function pushPlanOf(input: PushPlanInput): PushPlanResult {
  const branch = String(input.branch || '')
  const remotes = (Array.isArray(input.remotes) ? input.remotes : []).map((x) => String(x)).filter((x) => x !== '')
  const upstream = input.upstream ? String(input.upstream) : ''
  if (branch === '' || !BRANCH_PATTERN.test(branch)) return { ok: false, reason: 'bad-target' }
  if (remotes.length === 0) return { ok: false, reason: 'no-remote' }
  // 有上游且没被删：从远端清单里找最长前缀（origin/main、my/fork/main 都能正确拆开）。
  if (upstream !== '' && input.upstreamGone !== true) {
    let best = ''
    for (const r of remotes) {
      if (upstream.length > r.length + 1 && upstream.slice(0, r.length) === r && upstream.charAt(r.length) === '/') {
        if (r.length > best.length) best = r
      }
    }
    if (best !== '') {
      const targetBranch = upstream.slice(best.length + 1)
      if (!BRANCH_PATTERN.test(targetBranch)) return { ok: false, reason: 'bad-target' }
      return { ok: true, plan: { mode: 'existing', setUpstream: false, remote: best, branch: targetBranch, localBranch: branch } }
    }
    // 上游指向的不是任何已登记远端（例如本地分支）：当成「没有可用上游」，走选定档。
  }
  const wanted = input.requestedRemote ? String(input.requestedRemote) : ''
  if (wanted !== '') {
    if (!REMOTE_PATTERN.test(wanted) || remotes.indexOf(wanted) < 0) return { ok: false, reason: 'bad-target' }
    return { ok: true, plan: { mode: 'set-upstream', setUpstream: true, remote: wanted, branch: branch, localBranch: branch } }
  }
  if (remotes.length === 1) return { ok: true, plan: { mode: 'set-upstream', setUpstream: true, remote: remotes[0], branch: branch, localBranch: branch } }
  return { ok: false, reason: 'need-remote-choice', candidates: remotes.slice() }
}

export const PUSH_PLAN_SOURCE = 'version-control-core/src/push-plan.ts'
