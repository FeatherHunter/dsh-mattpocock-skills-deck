/**
 * src/tracker/capability-assertions.ts —— 契约能力的三条编译期断言（#1147 决策 5）。
 *
 * 这个文件回答的问题：「三个后端交出来的东西，形状对不对。」
 * 生效方式是“写错就编译不过”——本文件没有任何运行时语句（连一个 const 值都没有），
 * 三条断言全是类型约束，违反时 tsc 直接红。跑测试跑不出来它们，只能靠编译。
 *
 * 为什么断言要住在这里，而不是各工厂自己标返回类型：
 * 工厂返回类型标的是 `RoomOperations`，而它是 `Partial<Tracker>`（成员全可选）——
 * 标了它，少写一条编译不说话（可选的本来就可以缺），多带一条也分情况说话
 * （多余属性检查只对直接写在返回位置的字面量生效，先存变量再返回就静默通过）。
 * 所以三个工厂的返回标注已摘掉（见各工厂文件），形状的判定只收在这一个文件里：
 * 全仓唯一判定「能力齐不齐」的地方就是这里（规格 #1147 测试决策章）。
 *
 * 各房自己交哪些成员、字面量形状长什么样，定义在三个房间文件里（形状跟着工厂走）。
 * 为什么不把这些定义放在本文件：本文件的判定必须 import 三个工厂的类型，工厂又要用形状，
 * 两边同住一处就成了 type-only 的环 —— #1136 把 src/tracker 收进门禁扫描域时当场抓到，
 * 所以形状跟着工厂走、判定留在这里，方向单向：判定文件 → 房间。
 *
 * 三条断言各管一个方向：
 * 1. 完整：工厂交出来的成员，一个不少地等于登记表里给它记的那一套（少写→红）。
 * 2. 同集：操作名录 + 定位口名录合起来，恰好等于 `Tracker` 的全部键（两边对不上→红）。
 * 3. 不多：工厂交出来的成员，不许超出契约（多带一个契约之外的对外方法→红）。
 *
 * 改成员的规矩：先改对应后端的登记表（docs/tracker/capability-*.md），再改下面
 * 对应的成员集合，两处同一次提交。只改实现不改这里，编译会说话；只改这里不改表，
 * 对抗审查会说话。
 */

import type { RoomOperations, Tracker } from './contract/operations.js'
import type { OPERATIONS, LOCATORS } from './contract/operations-catalog.js'
import type { GithubBackendMembers, createGithubBackend } from './rooms/github/backend.js'
import type { GitlabBackendMembers, createGitlabBackend } from './rooms/gitlab/index.js'
import type { MarkdownBackendMembers, createMarkdownBackend } from './rooms/markdown/index.js'

/** 名录两段合起来的全部名字（25 个）。 */
type _CapabilityName = (typeof OPERATIONS)[number] | (typeof LOCATORS)[number]

/** 只能用 never 实例化的约束：传进来的不是 never，编译当场红。 */
type _RequireNever<T extends never> = T

// —— 断言 2（名录与 Tracker 同集，两个方向都验） ——
/** Tracker 里有、名录里没有的键：必须没有。 */
// `id` 是身份不是能力（三个后端人人都有，不进名录），先摘掉再比。
type _TrackerKeyMissingFromCatalog = _RequireNever<Exclude<Exclude<keyof Tracker, 'id'>, _CapabilityName>>
/** 名录里有、Tracker 里没有的键：必须没有。 */
type _CatalogNameMissingFromTracker = _RequireNever<Exclude<_CapabilityName, keyof Tracker>>

// —— 各后端登记的成员集合与字面量形状住在各自的房间文件里（形状跟着工厂走，理由见文件头） ——
// 改成员的规矩不变：先改对应后端的登记表（docs/tracker/capability-*.md），再改房间文件里的集合，
// 两处同一次提交。集合里带 `id`：它是身份不是能力（名录里没有它），但实例上三个后端人人都有，
// 形状里必须给它留位置。

// —— 断言 1（完整）：工厂交出来的成员，一个不少地含登记的那一套 ——
// 写法是约束：缺任何一个成员，`Record<登记集合, unknown>` 约束就不满足，编译红，且点名缺谁。
// 注意约束只能查出“少”，查不出“多”（多出来的键不影响 extends 成立）——“多”由下面的断言 3 管。
type _GithubComplete<T extends Record<GithubBackendMembers, unknown>> = T
type _GithubIsComplete = _GithubComplete<ReturnType<typeof createGithubBackend>>
type _GitlabComplete<T extends Record<GitlabBackendMembers, unknown>> = T
type _GitlabIsComplete = _GitlabComplete<ReturnType<typeof createGitlabBackend>>
type _MarkdownComplete<T extends Record<MarkdownBackendMembers, unknown>> = T
type _MarkdownIsComplete = _MarkdownComplete<ReturnType<typeof createMarkdownBackend>>

/**
 * 断言 3（不多）：工厂交出来的成员键，必须全在契约里（`RoomOperations` 的键）。
 * 写法是约束：多出来的键会导致 `Record<多出来的键, never>` 约束不满足，编译红。
 * 这条专治“先存变量再返回”——多余属性检查管不到那种写法，这条管得到。
 */
type _NoExcessMembers<T extends Record<Exclude<keyof T, keyof RoomOperations>, never>> = T
type _GithubNoExcess = _NoExcessMembers<ReturnType<typeof createGithubBackend>>
type _GitlabNoExcess = _NoExcessMembers<ReturnType<typeof createGitlabBackend>>
type _MarkdownNoExcess = _NoExcessMembers<ReturnType<typeof createMarkdownBackend>>
