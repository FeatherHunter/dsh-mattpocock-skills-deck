/**
 * tests/verify-field-tri-state.ts —— 字段三态门禁（#1688）：读结果要能分清「不知道」与「确实为空」。
 *
 * 守什么（票 #1688 的四条负例 + 四条正例）：
 *   一、缺边的票（来源没有给依赖边）：fieldStates.dependencies 是「未表达」，票上不许出现 blockedBy 空数组；
 *   二、缺计数的票（评论只有正文、没有总数）：评论总数保持未知，不许回落成已加载的正文条数；
 *   三、拉取请求缺边：父边与依赖边都标「未表达」，不再冒充空数组 / 没有父票；
 *   四、坏值（边是数字、评论是字符串）：标「读不懂」，且不往票上写假值；
 *   五、明确为空（parent:null、blockedBy 空连接、totalCount:0、reviews 空连接、mergedAt:null）：
 *      每一组都必须判成「已知的空」，与「不知道」分开；
 *   六、已知值必须与票上字段一致（parents↔parentKey、dependencies↔blockedBy、comments↔commentCount、
 *      review↔reviews、mergeInfo↔mergedAt），六组永远齐全；
 *   七、未表达组不动已知组：同一张票里依赖边读到了、评论总数没读到，只会缺评论那一组；
 *   八、非 GitHub 后端（GitLab、本地 Markdown）按契约的显式默认值走：不产 fieldStates，
 *      能力字段维持旧口径（blockedBy 给空数组）；这也证明「整块省略」在类型上编得过。
 *
 * 为什么用真模块跑而不是读源码文本：这一条守的是归一化之后读结果里的事实，
 * 换一种归一化写法而结论不变时，门禁不该误报。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-field-tri-state.ts
 */

import { printGateResult } from './lib/gate-result.ts'
import { normalizeIssue as normalizeGithub } from '../src/tracker/rooms/github/model/normalize.ts'
import { normalizeIssue as normalizeGitlab } from '../src/tracker/rooms/gitlab/normalize.ts'
import { normalizeIssue as normalizeMarkdown } from '../src/tracker/rooms/markdown/normalize.ts'
import type { Issue } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-field-tri-state'
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 读结果按任意形状读：门禁要能对「没有 fieldStates」这种旧结果判红，而不是抛错中断。 */
type AnyIssue = Record<string, unknown>

/** 六组的固定清单与顺序。顺序与契约 entities.ts 的 IssueFieldStates 一致，方便逐条核对。 */
const GROUPS = ['parents', 'dependencies', 'subIssues', 'comments', 'review', 'mergeInfo'] as const
/** 三态里「不知道」的三个词（与契约 FIELD_STATE_REASONS 同一份口径）。 */
const REASONS = ['not-expressed', 'not-applicable', 'unreadable'] as const

function statesOf(issue: AnyIssue): Record<string, unknown> {
  const s = issue.fieldStates
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
}

function groupOf(issue: AnyIssue, name: string): Record<string, unknown> | undefined {
  const g = statesOf(issue)[name]
  return g && typeof g === 'object' ? (g as Record<string, unknown>) : undefined
}

function own(issue: AnyIssue, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(issue, field)
}

/** 断言某一组是「已知」，返回该组的 value（调用方继续核对值）。 */
function expectKnown(issue: AnyIssue, name: string, tag: string): unknown {
  const g = groupOf(issue, name)
  check(!!g && g.known === true && g.reason === null && own(g, 'value'), tag + '：' + name + ' 应是已知（known:true、reason:null）', g)
  return g ? g.value : undefined
}

/** 断言某一组是「不知道」，原因词必须是三个词之一。 */
function expectUnknown(issue: AnyIssue, name: string, reason: string, tag: string): void {
  const g = groupOf(issue, name)
  const ok = !!g && g.known === false && g.value === null && g.reason === reason && REASONS.indexOf(g.reason as never) >= 0
  check(ok, tag + '：' + name + ' 应是「不知道」（' + reason + '）', g)
}

/** 一张票的 fieldStates 必须六组齐全，且每组就是三态的形状。 */
function expectSixGroups(issue: AnyIssue, tag: string): void {
  const sixOk = GROUPS.every((name) => {
    const g = groupOf(issue, name)
    if (!g) return false
    if (g.known === true) return g.reason === null
    return g.known === false && g.value === null && REASONS.indexOf(g.reason as never) >= 0
  })
  check(sixOk, tag + '：fieldStates 六组齐全且每组都是三态形状', statesOf(issue))
}

// =============================================================================================
// 一、未知：来源什么边、什么计数都没给
// =============================================================================================
{
  const issue = normalizeGithub({ number: 11, title: '只有行字段', state: 'open' }) as AnyIssue
  expectSixGroups(issue, '缺来源')
  expectUnknown(issue, 'parents', 'not-expressed', '缺来源')
  expectUnknown(issue, 'dependencies', 'not-expressed', '缺来源')
  expectUnknown(issue, 'subIssues', 'not-expressed', '缺来源')
  expectUnknown(issue, 'comments', 'not-expressed', '缺来源')
  expectUnknown(issue, 'review', 'not-expressed', '缺来源')
  expectUnknown(issue, 'mergeInfo', 'not-expressed', '缺来源')
  check(!own(issue, 'blockedBy'), '缺依赖边：票上不许出现 blockedBy（不许回落成空数组）', issue.blockedBy)
  check(!own(issue, 'commentCount'), '缺评论总数：票上不许出现 commentCount', issue.commentCount)
  check(!own(issue, 'comments'), '缺评论正文：票上不许出现 comments（不许回落成空数组）', issue.comments)
  check(!own(issue, 'reviews'), '缺评审：票上不许出现 reviews', issue.reviews)
  check(!own(issue, 'mergedAt'), '缺合并时间：票上不许出现 mergedAt', issue.mergedAt)
  check(own(issue, 'parentKey') && issue.parentKey === null, '父边未知：parentKey 是核心字段，仍写 null（由 fieldStates.parents 说明不知道）', issue.parentKey)
}

// =============================================================================================
// 二、缺计数：评论正文取到了，但总数没有来源 —— 不许拿正文条数当总数
// =============================================================================================
{
  const issue = normalizeGithub({ number: 12, title: '有正文没总数', state: 'open', comments: { nodes: [{ body: '一' }, { body: '二' }] } }) as AnyIssue
  expectUnknown(issue, 'comments', 'not-expressed', '缺计数')
  check(!own(issue, 'commentCount'), '缺计数：commentCount 必须保持未知（不回落成已加载条数 2）', issue.commentCount)
  check(Array.isArray(issue.comments) && (issue.comments as unknown[]).length === 2, '缺计数：评论正文本身表达了，照常给出两条', issue.comments)
}

// =============================================================================================
// 三、拉取请求缺边：父边与依赖边原生没有 —— 标未表达，不许冒充空数组 / 没有父票
// =============================================================================================
{
  const issue = normalizeGithub({ number: 13, title: 'pr', state: 'open', mergedAt: null, reviews: { nodes: [] }, pull_request: {} }) as AnyIssue
  check(issue.isPullRequest === true, '拉取请求缺边：先认得出这是拉取请求', issue.isPullRequest)
  expectUnknown(issue, 'parents', 'not-expressed', '拉取请求缺边')
  expectUnknown(issue, 'dependencies', 'not-expressed', '拉取请求缺边')
  check(!own(issue, 'blockedBy'), '拉取请求缺边：票上不许出现 blockedBy 空数组', issue.blockedBy)
  expectKnown(issue, 'mergeInfo', '拉取请求缺边')
  check(issue.mergedAt === null, '拉取请求缺边：明确未合并是已知的 null（与「不知道」分开）', issue.mergedAt)
  expectKnown(issue, 'review', '拉取请求缺边')
  check(Array.isArray(issue.reviews) && (issue.reviews as unknown[]).length === 0, '拉取请求缺边：明确没有评审是已知的空数组', issue.reviews)
}

// =============================================================================================
// 四、坏值：来源给了但读不懂 —— 标读不懂，不写假值
// =============================================================================================
{
  const issue = normalizeGithub({ number: 14, title: '坏值', state: 'open', blockedBy: 42, comments: 'nope', reviews: 'nope', mergedAt: 12345 }) as AnyIssue
  expectUnknown(issue, 'dependencies', 'unreadable', '坏值')
  expectUnknown(issue, 'comments', 'unreadable', '坏值')
  expectUnknown(issue, 'review', 'unreadable', '坏值')
  expectUnknown(issue, 'mergeInfo', 'unreadable', '坏值')
  check(!own(issue, 'blockedBy') && !own(issue, 'commentCount') && !own(issue, 'reviews') && !own(issue, 'mergedAt'),
    '坏值：票上不许出现任何由坏值编出来的假事实', { blockedBy: issue.blockedBy, commentCount: issue.commentCount, reviews: issue.reviews, mergedAt: issue.mergedAt })
}

// =============================================================================================
// 五、明确为空：每一组都判「已知的空」
// =============================================================================================
{
  const issue = normalizeGithub({
    number: 15,
    title: '明确为空',
    state: 'open',
    parentKey: null,
    blockedBy: { nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    reviews: { nodes: [] },
    mergedAt: null,
    sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
  }) as AnyIssue
  expectSixGroups(issue, '明确为空')
  check(expectKnown(issue, 'parents', '明确为空') === null, '明确没有父票：parents 是已知的 null', groupOf(issue, 'parents'))
  const deps = expectKnown(issue, 'dependencies', '明确为空')
  check(Array.isArray(deps) && (deps as unknown[]).length === 0, '明确没有依赖边：dependencies 是已知的空数组', deps)
  check(expectKnown(issue, 'comments', '明确为空') === 0, '明确没有评论：comments 是已知的 0', groupOf(issue, 'comments'))
  check(expectKnown(issue, 'mergeInfo', '明确为空') === null, '明确未合并：mergeInfo 是已知的 null', groupOf(issue, 'mergeInfo'))
  check(Array.isArray(expectKnown(issue, 'review', '明确为空')) , '明确没有评审：review 是已知的空数组', groupOf(issue, 'review'))
  const counts = expectKnown(issue, 'subIssues', '明确为空') as Record<string, unknown> | null
  check(!!counts && counts.total === 0 && counts.completed === 0 && counts.percentCompleted === 0, '明确没有子票：subIssues 是已知的 0/0/0', counts)
  check(Array.isArray(issue.blockedBy) && (issue.blockedBy as unknown[]).length === 0 && issue.commentCount === 0, '明确为空：票上的字段也照实写空（blockedBy 空数组、commentCount 0）', { blockedBy: issue.blockedBy, commentCount: issue.commentCount })
}

// =============================================================================================
// 六、已知值一致：三态里已知的值必须与票上对应字段相同，六组齐全
// =============================================================================================
{
  const issue = normalizeGithub({
    number: 16,
    title: '一致',
    state: 'open',
    parentKey: '7',
    blockedBy: { nodes: [{ number: 8, title: '阻塞者', state: 'OPEN' }] },
    comments: { totalCount: 5, nodes: [{ body: '只有一条正文' }] },
    reviews: { nodes: [{ state: 'APPROVED', author: { login: 'alice' } }] },
    mergedAt: '2024-02-01T00:00:00Z',
    sub_issues_summary: { total: 4, completed: 2, percent_completed: 50 },
  }) as AnyIssue
  expectSixGroups(issue, '已知一致')
  check(expectKnown(issue, 'parents', '已知一致') === issue.parentKey, 'parents 的已知值与票上 parentKey 相同', { parents: groupOf(issue, 'parents'), parentKey: issue.parentKey })
  const deps = expectKnown(issue, 'dependencies', '已知一致')
  check(JSON.stringify(deps) === JSON.stringify(issue.blockedBy), 'dependencies 的已知值与票上 blockedBy 相同', { deps, blockedBy: issue.blockedBy })
  check(expectKnown(issue, 'comments', '已知一致') === 5 && issue.commentCount === 5, 'comments 的已知值是总数 5（不是正文条数 1），且与票上 commentCount 相同', { comments: groupOf(issue, 'comments'), commentCount: issue.commentCount })
  const review = expectKnown(issue, 'review', '已知一致')
  check(JSON.stringify(review) === JSON.stringify(issue.reviews), 'review 的已知值与票上 reviews 相同', { review, reviews: issue.reviews })
  check(expectKnown(issue, 'mergeInfo', '已知一致') === issue.mergedAt, 'mergeInfo 的已知值与票上 mergedAt 相同', { mergeInfo: groupOf(issue, 'mergeInfo'), mergedAt: issue.mergedAt })
  const counts = expectKnown(issue, 'subIssues', '已知一致') as Record<string, unknown> | null
  check(!!counts && counts.total === 4 && counts.completed === 2 && counts.percentCompleted === 50, 'subIssues 的已知值照来源写：4 张、完成 2 张、50%', counts)
}

// =============================================================================================
// 七、未表达组只补空缺：同一张票里已知的那组照旧，未表达的那组不编
// =============================================================================================
{
  const issue = normalizeGithub({ number: 17, title: '一半已知', state: 'open', blockedBy: { nodes: [{ number: 8, title: '阻塞者', state: 'OPEN' }] } }) as AnyIssue
  expectKnown(issue, 'dependencies', '未表达组只补空缺')
  expectUnknown(issue, 'comments', 'not-expressed', '未表达组只补空缺')
  check(Array.isArray(issue.blockedBy) && (issue.blockedBy as unknown[]).length === 1, '依赖边读到了就照常给，不会被评论总数未知连带清掉', issue.blockedBy)
  check(!own(issue, 'commentCount'), '评论总数没读到就只缺它自己，不编 0', issue.commentCount)
}

// =============================================================================================
// 八、非 GitHub 后端：显式默认值（不产 fieldStates，旧口径能力字段照旧），且类型上编得过
// =============================================================================================
{
  const gitlabIssue = normalizeGitlab({ iid: 1, title: 't', state: 'opened', description: '' }) as AnyIssue
  check(!own(gitlabIssue, 'fieldStates'), 'GitLab 后端按显式默认值：不产 fieldStates（按旧口径读空值）', gitlabIssue.fieldStates)
  check(Array.isArray(gitlabIssue.blockedBy), 'GitLab 后端：能力字段维持旧口径（blockedBy 存在且为空数组）', gitlabIssue.blockedBy)
  const asContract: Issue = normalizeGitlab({ iid: 2, title: 't', state: 'opened', description: '' })
  check(asContract.key === '2', 'GitLab 归一结果在类型上是契约 Issue（fieldStates 可省略，编译期证据 seen here）', asContract.key)

  const markdownIssue = normalizeMarkdown('# 标题\n', { key: '01', parentKey: null, isMap: false }) as AnyIssue
  check(!own(markdownIssue, 'fieldStates'), '本地 Markdown 后端按显式默认值：不产 fieldStates', markdownIssue.fieldStates)
  check(Array.isArray(markdownIssue.blockedBy), '本地 Markdown 后端：能力字段维持旧口径（blockedBy 存在且为空数组）', markdownIssue.blockedBy)
}

// =============================================================================================
// 汇总
// =============================================================================================
console.log('')
console.log('verify-field-tri-state：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
