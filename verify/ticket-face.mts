// verify/ticket-face.mts —— 发布门禁的票面适配器（GitHub，经 gh CLI）。
//
// 为什么适配器留在插件仓、而不是写进 base：票面协议（gh 的参数、issue 字段、登录 token 放哪）
// 是「这一仓怎么和工单系统说话」，不是发布规则。base 只认 TicketFaceAdapter 的五个成员（kind、
// listChecklistIssues、listComments、resolveReleaseCommit、isAncestor），规则本身由
// runReleaseGate 执行。五个仓各自的票面不同，但六条规则只有一份实现。
//
// 三个实现约定：
//   1. 方法里才做 IO，模块加载时什么都不做——base 的加载器明确要求「适配器定义时不许联网/读盘」，
//      否则加载失败会被误报成必然后果。
//   2. 环境问题（gh 没登录、git 不可用）抛 ReleaseEnvError，由 base 归成 blocked（exit 2）；
//      票面内容问题（缺票、没关闭、身份行不齐）不在这里判断，由规则层变成 fail（exit 1）。
//   3. isAncestor 是三态：答不了就说 "unknown"，绝不返回 false 冒充「不是祖先」——
//      false 会让发布被一条「其实没查成」的红色结论挡住。
import { spawnSync } from 'node:child_process'

import type {
  ChecklistIssue as TicketFaceIssue,
  TicketComment as TicketFaceComment,
  TicketFaceAdapter,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'

import { REPO_ROOT, ReleaseEnvError, listChecklistIssues, listIssueComments } from '../scripts/lib/release-checklist.mts'

/** 跑一次 git 并回读 stdout；失败归环境问题（发布路径上停下并说明原因）。 */
function gitText(args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) {
    throw new ReleaseEnvError('调不起 git：' + result.error.message + '。发布门禁要读提交关系，git 必须可用。', 2)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim()
    throw new ReleaseEnvError(
      'git ' + args.join(' ') + ' 失败（exit=' + String(result.status) + '）' + (detail ? '：' + detail : '') + '。',
      2,
    )
  }
  return String(result.stdout || '').trim()
}

/** gh 的 state 只有 OPEN / CLOSED；其余值如实报 UNKNOWN（把「不知道」当「开着」会误判未关闭）。 */
function normalizeState(state: string): 'OPEN' | 'CLOSED' | 'UNKNOWN' {
  const upper = String(state || '').toUpperCase()
  if (upper === 'OPEN') return 'OPEN'
  if (upper === 'CLOSED') return 'CLOSED'
  return 'UNKNOWN'
}

const adapter: TicketFaceAdapter = {
  kind: 'github-gh-cli',

  /** 列所有「[真机验证] …」票（含已关闭），正文与 URL 原样交给规则层。 */
  async listChecklistIssues(): Promise<readonly TicketFaceIssue[]> {
    return listChecklistIssues().map((issue) => {
      const mapped: TicketFaceIssue = {
        number: issue.number,
        title: issue.title,
        state: normalizeState(issue.state),
        body: issue.body,
        ...(issue.url ? { url: issue.url } : {}),
      }
      return mapped
    })
  },

  /** 读一张票的全部评论；顺序由 gh 返回顺序决定（规则层用 createdAt 做兜底排序）。 */
  async listComments(issueNumber: number): Promise<readonly TicketFaceComment[]> {
    return listIssueComments(issueNumber).map((comment) => {
      const mapped: TicketFaceComment = {
        body: comment.body,
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
      }
      return mapped
    })
  },

  /** 发布提交就是当前检出的 HEAD；与命令行层的 releaseCommit 必须一致，否则门禁会报 prerequisite-missing。 */
  async resolveReleaseCommit(): Promise<string> {
    return gitText(['rev-parse', 'HEAD'])
  },

  /** 三态祖先判断：0=是祖先，1=不是祖先，其余（浅克隆、对象缺失、git 失败）=unknown。 */
  async isAncestor(commit: string, descendant: string): Promise<boolean | 'unknown'> {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, descendant], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    if (result.status === 0) return true
    if (result.status === 1) return false
    return 'unknown'
  },
}

export default adapter
