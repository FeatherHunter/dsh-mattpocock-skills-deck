/**
 * src/tracker/contract/capability-answer.ts —— 一条能力在一个后端上的归宿（只有类型，没有值）
 *
 * 这份文件回答的问题：「GitHub 后端对 `ensureLabelColorsFile` 这条能力，给的是哪一个答案？」
 * 答案只有四类（见下面 `CapabilityStanding`）。**答案本身不住在这里**——每个后端各自的答案
 * 住在自己房间里：`src/tracker/rooms/<后端编号>/capability-register.ts`；给人读的那张表
 * （`docs/tracker/capability-*.md`）由门禁 `tests/verify-capability-register.ts` 逐条比对，
 * 三处不许各说各的。
 *
 * ── 四类的判据只有一条，别造第二把尺子 ──────────────────────────────────────────
 * 问的永远是「这条能力在这个后端上的**形态存不存在**」，不是「今天做没做」：
 *
 *   - `provided`    —— 这个后端真会做这件事：成员在、调得动、真干活，且**每一种合法输入都对得上承诺**。
 *   - `partial`     —— 形态成立、也确实有实现，但**有某几种输入与承诺对不上**：要么当场如实回
 *     「这个后端不认它」，要么行为另有出入。区别于 `provided` 的地方是「不是每种输入都对得上」，
 *     区别于 `unsupported-by-design` 的地方是「这件事本身在这个后端上成立、主要路径真在做」。
 *     为什么要单开这一档（#1174）：在此之前只有三档，判据是「有没有实现」，于是「实现了但没做到位」
 *     只能记成 `provided` —— 登记表于是替这些缺口说了「一切正常」，账本是假的。这一档必须写清差在哪
 *     （`gap`），写不出差在哪，就说明还没审过。
 *   - `unsupported-by-design` —— 形态根本不存在，永远不会有，**不是欠账**。名字里的 by-design 就是这句
 *     「不是欠账」：它在本地房不成立，不是「还没做」。
 *     例：GitHub 的标签颜色真源是仓库标签，工作区里那份配色文件没有任何读者，
 *     「放一份手改了就生效的文件」这件事在这个后端上不成立。硬做出来只会误导人。取名不叫 `unsupported`
 *     是 #1180 定的：那个词是**错误档位**（`ERROR_KIND` 八档之一）的词，两套词表必须互不重叠。
 *   - `planned`     —— 形态成立、说得通，只是今天没做（欠账）。必须带承接它的票号或地图票号，
 *     没有承接人的「未来会开发」等于没人管的欠账。
 *
 * 判据写在这里，是因为 2026-10-14 之前同一件事在仓库里写过两句互相矛盾的话：
 * `docs/tracker/capability-github.md` 写「当前不支持、未来会开发」，而
 * `src/tracker/contract/operations.ts` 里同名注释写「没有本地文件可放」。两句各说了一半。
 * 现在分类只有一份真源（各房的登记数据），文档是它的视图，门禁保证两边不会打架。
 *
 * ── 为什么写成可辨识联合，而不是一个布尔加几个可选字段 ──────────────────────────
 * 四类各自要带的东西不同：`unsupported-by-design` 要说清**桩由谁补**（这决定后端实例上有没有这个成员，
 * 成员集合由它推出来）；`planned` 必须带票号。写成联合，缺字段编译期当场红；写成
 * `{ supported: boolean; note?: string }`，缺票号只有人眼看得出来——那正是这次要消掉的毛病。
 * 与 #1147 决策 5 那三条编译期断言同一个路子：把规矩写成类型，别写成注释。
 *
 * ── 运行时不读它（G5 红线）──────────────────────────────────────────────────────
 * 不读。`Tracker` 的能力永远是「调用即知」：注册表给缺的成员补一个诚实说「不支持」的桩
 * （`src/tracker/registry/shape.ts` 的 `unsupportedStub`），数据路径不许查一张表来决定
 * 发不发请求、显不显示按钮（G5：无能力表、无能力分支）。本文件与各房的登记数据是**构建期的账**：
 * 门禁拿它比对给人读的表与实例成员，运行时代码一行都不许 import 它。
 *
 * 注册表那句自动桩说的是**内部话**（`backend X does not implement op Y`）：给人看的话由面对人的那一层
 * 自己写——先例是 `src/host/mapTickets.js:124-126`，那里把同一句内部英文当场换成了一句中文，并在
 * 注释里写明理由。所以别把「失败提示更好读」这件事落到注册表头上：#1172 验收里那条「桩消息从登记取
 * 一句人话」因此撤销，理由是要做到它，注册表就得揣一份每后端的能力表（撞 G5）或 import 房间
 * （撞装配规则）。真需要某个后端自己开口时，让它把这条能力实现成一条如实回 `unsupported` 的成员即可
 * （Markdown 后端那 4 条就是这个做法，宿主 `src/host/workspaceCwd.js:58` 也按跳过处理）。
 *
 * 改法：先改各房的登记数据，再改实现，最后让门禁把文档对齐（次序写在登记文件头上）。
 */

// 两份名录是按 `as const` 存的字符串数组（契约层的数据），这里只取它们的元素类型：
// 能力的名字只有一个真源（`operations-catalog.ts`），本文件不另抄一份名字。
import type { OPERATIONS, LOCATORS } from './operations-catalog.js'

/** 23 条操作的名字（异步、会失败，「我不支持」是一个合法答案）。 */
export type OperationCapability = (typeof OPERATIONS)[number]

/** 3 条定位口的名字（把目录 / 仓库 / 票号翻成身份与地址，「没有」就是空值，不是失败）。 */
export type LocatorCapability = (typeof LOCATORS)[number]

/** 26 条能力的名字（两段合起来）——契约的上限，也是登记表要有多少行。 */
export type CapabilityName = OperationCapability | LocatorCapability

/**
 * 一个后端给一条能力的答案。四档，判据见文件头。
 *
 * 字段为什么叫 `tier`（能力档位）而不叫 `kind`：`kind` 是**错误档位**那一轴的字段名
 * （`TrackerError.kind`，八档，真源 `src/tracker/contract/vocabulary.ts` 的 `ERROR_KIND`）。
 * 两轴各分各的，字段同名、取值还撞了 `unsupported` 一个词，于是逐字扫源码的门禁
 * `tests/verify-error-single-source.ts` 分不清某一处写的是哪一轴（#1180）。
 *
 * `stubBy` 只有两条值，含义是「这个后端今天回给调用方的那个『不支持』桩，是谁补的」：
 *   - `'backend'`  —— 后端自己在实例上放了显式桩（今天本地 Markdown 房那 4 条就是这种）。
 *   - `'registry'` —— 实例上根本没有这个成员，注册表按名录补桩（今天 GitHub 房的配色文件那条）。
 * 这一格是给成员集合用的：`provided` 与 `stubBy: 'backend'` 合起来，就是这个后端实例上应当
 * 出现的成员（另加 `id`）；缺一个、多一个，编译期与门禁都会说话。
 */
export type CapabilityStanding =
  | { readonly tier: 'provided' }
  | { readonly tier: 'partial'; readonly gap: string; readonly ticket: string }
  | { readonly tier: 'unsupported-by-design'; readonly stubBy: 'backend' | 'registry' }
  | { readonly tier: 'planned'; readonly ticket: string }

/** 四档档位的名字（从上面那份联合里取出来，不另抄一份词）。门禁比对人读表时用它标类型。 */
export type CapabilityTier = CapabilityStanding['tier']

/**
 * 一个后端对 26 条能力的完整回答。
 *
 * 用 `Record` 而不是 `Partial<Record>`：少写一条编译期报「缺少属性」，多写一个名录之外的名字
 * 报「对象字面量只能指定已知属性」。各房的数据文件都写成 `as const satisfies CapabilityRegister`。
 */
export type CapabilityRegister = Record<CapabilityName, CapabilityStanding>

/**
 * 从一份登记里取出「明确提供功能」的那些名字（各房的成员集合由它推出来）。
 *
 * 写法是映射类型 + 索引取值：把每个键映射成「它的 tier 是不是 provided，是就留名字，不是就换 never」，
 * 再按联合取出来。tier 必须是字面量类型，所以数据文件里那句 `as const` 不能省。
 */
export type ProvidedCapability<R extends CapabilityRegister> = {
  [K in keyof R]: R[K] extends { tier: 'provided' } ? K : never
}[keyof R]

/** 从一份登记里取出「后端自己补了显式桩」的那些名字（同样是成员集合的一半）。 */
export type StubbedByBackend<R extends CapabilityRegister> = {
  [K in keyof R]: R[K] extends { tier: 'unsupported-by-design'; stubBy: 'backend' } ? K : never
}[keyof R]

/** 从一份登记里取出「做了但没做到位」的那些名字（#1174 加的第四档）。
 *
 *  为什么它也要算进成员集合：这一档的能力**实现是有的**，实例上叫得到这个方法，只是某些输入对不上承诺。
 *  漏掉它，成员的完整性断言就会反过来要求把这些实现删掉。 */
export type PartiallyProvidedCapability<R extends CapabilityRegister> = {
  [K in keyof R]: R[K] extends { tier: 'partial' } ? K : never
}[keyof R]
