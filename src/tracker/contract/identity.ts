/**
 * src/tracker/contract/identity.ts —— 契约的身份与枚举：谁是谁、状态怎么取值
 *
 * ── 这一件在五件里的位置 ────────────────────────────────────────────────────────
 * 契约的形状层按「谁读它」拆成五件（五件各自装什么见同目录 README.md）：本件放**身份与枚举**，
 * 是其余四件的地基 —— 实体、上下文、返回值、入参都要引用这里的名字，所以本文件
 * 不引用任何别的契约文件。引用方向永远单向：地基在下，读者在上，不允许反过来。
 *
 * 读者：契约层其余四件、两个房间的实现、注册表、deck 九个工具、面板。
 *
 * ── 契约这一层是干什么的（整层的说明在 README.md，这里只放本件要用的那几句） ────
 * 九个 deck 工具调 `tracker.preflight`、`tracker.list` 的时候，从不问「你是 GitHub 还是
 * 本地 Markdown」。它们敢这么写，唯一的原因是有一份承诺摆在这里：不管哪个房间接手，
 * 都回答同样的方法、收同样的参数、回同样的形状。这份承诺就是本目录。
 *
 * 今天运行时的真源仍是 `src/host/tracker/contract.js` 与它的三份续篇（JSDoc 版）；
 * 本目录是它的 TypeScript 版本，两者暂时并存：**改一处必须改另一处**，直到 contract.js 退休。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、身份与枚举：一律写成开放 string 或字面量联合，不写 enum
//
// 为什么不用 TypeScript 的 enum：enum 会产出运行时代码（多一个对象、多一层查找），
// 而本目录要守住「零运行时实现」——真源仍是 constants.js 里的 Object.freeze 常量。
// 用字面量联合的好处是编译期能查错，运行时一个字节都不多。
// 为什么 BackendId 是开放 string 而不是 'github'|'markdown'|'gitlab'：第三方后端要能注册，
// 写死三个就把门焊死了（'other' 这个保留串已弃用，不注册）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 后端 id：开放字符串，仓库内唯一。
 * 一等内置是 `'github'`、`'markdown'`、`'gitlab'`；`'other'` 已弃用、不再注册。
 * 表达「没有后端」只能用 `Selection.backendId: null`，**不许**造一个假 id。
 */
export type BackendId = string

/** 归一化后的票状态：只有两态。GitHub 原值是大写 OPEN/CLOSED，由各房在 normalize 阶段转小写。 */
export type State = 'open' | 'closed'

/** 票的种类：普通票或地图（wayfinder 语义）。 */
export type IssueType = 'issue' | 'map'

/**
 * 关闭原因：开放字符串，原样透传不分支。
 * 插件自己认得并收进保留表的只有 `completed` 与 `duplicate` 两个；GitHub 那边还会出现
 * `not_planned` 等取值，照原样展示即可，不要在这里加分支。
 * 只在 `state === 'closed'` 时有意义；开放着的票依后端支持给 `''`（EMPTY）或省略（MISSING）。
 */
export type ClosedReason = string

/** 参与人种类：开放字符串，保留值 `user` / `bot` / `organization`（识别机器人代理对 deck 认领有意义）。 */
export type ActorKind = string

/**
 * 操作失败的分类，取值与 `src/shared/tracker/constants.js` 的 `ERROR_KIND` 逐字一致：
 * - `env` 本机环境缺东西（工具没装、路径不存在）
 * - `auth` 没登录、凭据失效、没有权限
 * - `rate-limit` 被限流（注意是小写短横线，旧写法 `rateLimit` 已废弃）
 * - `conflict` 写前置失败或图不变量被违反（If-Match 不匹配、阻塞边成环、自环）
 * - `unsupported` 这个后端不实现这个操作（注册表自动补的桩返回的就是它）
 * - `not-found` 资源不存在（对应 GitHub 404）
 * - `network` 连不通、超时、请求半路断掉
 * - `parse` 拿回来的东西解析不了
 *
 * 分类决定界面怎么说话（引导登录 / 提示稍后 / 说明做不到），所以**不许新增取值**；
 * 真要加，先改 constants.js 与这份联合类型，两处一起。
 */
export type ErrorKind =
  | 'env'
  | 'auth'
  | 'rate-limit'
  | 'conflict'
  | 'unsupported'
  | 'not-found'
  | 'network'
  | 'parse'

/**
 * 参与人（票的作者、指派人、评论作者都用它）。
 *
 * 为什么归在「身份」这一件而不是「实体」那一件：它是**别的实体引用的人**，
 * 自身不引用任何实体（不指向票、不指向仓库），放在地基这一层不会造成循环引用；
 * 而它被实体那一件的 `Comment` 与 `Issue` 引用，方向正好是「读者在上」。
 */
export interface Actor {
  /** 登录名；本地 Markdown 是本地用户名或 `''`。 */
  login: string
  /** 机器人/组织标记，见 `ActorKind`；认不出来就省略。 */
  kind?: ActorKind
  /** 显示名，没有就省略。 */
  name?: string
  /** 头像地址；本地后端没有就省略。 */
  avatarUrl?: string
}
