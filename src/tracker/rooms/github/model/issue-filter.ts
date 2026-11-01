/**
 * src/tracker/rooms/github/model/issue-filter.ts —— list 两路共用的内存过滤（#1778 从 read/issues.ts 抽出）
 *
 * 为什么要单独放一份：list 的 GraphQL 主路与 REST 降级路都要在返回前按同一个 ListFilter 收窄，
 * 两处口径必须一致；留在一个贴着 350 有效行上限的编排文件里，额度闸（#1765）一改就会顶破
 * 文件粒度门禁。这里只收纯函数与契约类型，不碰网络、不记日志、不读上下文。
 *
 * 约定（改这里之前先读）：
 * - filter.state 只做小写化后全等比较，没有「其它状态一律当 open」这类兜底，与旧实现一字不差；
 * - filter.parentKey 的三态是三种意思：null = 只要没有父票的，undefined = 不限，字符串 = 指定父票；
 * - filter.isPullRequest 只认严格 true / false，缺失即两类都要。
 */
import type { Issue } from '../../../contract/entities.js';
import type { ListFilter } from '../../../contract/inputs.js';

/** 按契约给的筛选条件收窄一批票；不认识的字段不参与判断，返回的仍是原来那批对象。 */
export function applyIssueFilter(all: Issue[], filter: ListFilter | null | undefined): Issue[] {
  let filtered = all
  if (filter && typeof filter === 'object') {
    if (filter.state) {
      const want = String(filter.state).toLowerCase()
      filtered = filtered.filter((i) => i.state === want)
    }
    if (filter.type) {
      filtered = filtered.filter((i) => i.type === filter.type)
    }
    if (filter.parentKey !== undefined) {
      if (filter.parentKey === null) filtered = filtered.filter((i) => i.parentKey === null)
      else filtered = filtered.filter((i) => i.parentKey === String(filter.parentKey))
    }
    if (Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map((k) => String(k)))
      filtered = filtered.filter((i) => set.has(i.key))
    }
    if (filter.isPullRequest !== undefined) {
      const want = filter.isPullRequest === true
      filtered = filtered.filter((i) => i.isPullRequest === want)
    }
  }
  return filtered
}
