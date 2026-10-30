/**
 * src/tracker/rooms/gitlab/read-sources.ts —— GitLab 后端的读来源默认值（#1683）
 *
 * 规格 1681 第 3 节：读来源字段对三个后端都定义，但只强制 GitHub 返回真实来源；
 * GitLab 与 Markdown 给显式默认值——来源写本家通道，完整度写「完整」或「未表达」。
 * 这里就是那两份默认值，逐条写出来，不读操作百科的渠道声明（那两条是 GitHub 的通道，
 * 套到本家后端上会说错话）。
 *
 * 键的类型是 `ReadOperationName`：名录里被标成读的那些操作；少登记一条，编译期就报错。
 * 它今天只被门禁 `tests/verify-operation-catalog.ts` 读取；阶段 1 的读结果来源记录（票 1685）
 * 会拿它当声明面。这里不接运行时行为：本票不改后端行为。
 */
import type { OwnChannelReadSource, ReadOperationName } from '../../contract/operations-encyclopedia.js'

/**
 * GitLab 的显式默认值：来源是本家 API，完整度按「完整」（今天没有截断判据，不冒充）。
 * 一条操作一条，全部实际引用同一个常量——值只有一份，但每条都得显式写出自己的键，
 * 少写一条编译期就报错。
 */
const DEFAULT_READ_SOURCE: OwnChannelReadSource = { channel: 'gitlab-api', completeness: 'complete' }

export const GITLAB_READ_SOURCES = {
  preflight: DEFAULT_READ_SOURCE,
  list: DEFAULT_READ_SOURCE,
  get: DEFAULT_READ_SOURCE,
  getDependencies: DEFAULT_READ_SOURCE,
  getCurrentUser: DEFAULT_READ_SOURCE,
  listLabels: DEFAULT_READ_SOURCE,
  counts: DEFAULT_READ_SOURCE,
  listPage: DEFAULT_READ_SOURCE,
  getRepoPermissions: DEFAULT_READ_SOURCE,
  listSubIssues: DEFAULT_READ_SOURCE,
  listMaps: DEFAULT_READ_SOURCE,
  readBudget: DEFAULT_READ_SOURCE,
} as const satisfies Record<ReadOperationName, OwnChannelReadSource>