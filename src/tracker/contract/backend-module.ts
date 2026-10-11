/**
 * src/tracker/contract/backend-module.ts —— 房间「模块对象」的形状：注册表真正读的那一份
 *
 * ── 模块对象与 Tracker 的关系（最容易混的一点） ─────────────────────────────────
 * 一个后端在注册表里是**两层东西**：
 * 1. **模块对象**（本文件）：进程启动时注册的那一份静态描述 —— 我是谁（id、显示名、
 *    品牌色板）、怎么认出我（matches）、怎么把我造出来（create），外加一堆**只读的界面描述数据**
 *    （设置页文案键、检查项目录、修复指引、默认调色盘、链接模板）。
 * 2. **Tracker 实例**（`operations.ts`）：`create(ctx)` 造出来的那一份能干活的，
 *    有 19 条操作加本轮新升的 `getRepoPermissions`。
 *
 * 分两层的原因：模块对象在**没有工作区、没有登录、什么都不确定**的时候就要存在
 * （界面靠它画「有哪些后端可选」），而 Tracker 需要进程级能力（起进程、文件服务）才能造。
 *
 * ── 注册表只校验五件事（`registryShape.js` 的 `validateMod`） ───────────────────
 * 模块是对象、`id` 非空、`label` 是字符串、`create` 是函数、`matches` 是函数；
 * 外加 `id !== 'other'`（那个保留串已弃用）。
 * **其余字段全部可选** —— 本文件把两房真实用到的键取并集，可选的标 `?`。
 * 缺字段不是错误：缺 `describe` 时注册表回退一个骨架引用，缺 `presentation` 时界面用默认色。
 *
 * ── 这些字段里有一半永远不进数据路径（G5 红线） ─────────────────────────────────
 * `presentation`、`setupPrompt`、`prompts`、`checks`、`fixes`、`links`、`capabilities`、
 * `labelPalette` 都是**只读的界面描述数据**：界面拿它渲染与引导，数据路径一个字都不许读。
 * 反例（真出过）：拿 `capabilities` 去决定「要不要发这个请求」——那就变成了能力表，
 * 与「能力 = 运行时调用结果」直接冲突。
 */

import type { BackendId } from './identity.js'
import type { RepositoryRef } from './entities.js'
import type { BackendContext, OpContext, RepoHandle } from './contexts.js'
import type {
  GitHubRoomExtension,
  MarkdownRoomExtension,
  RoomAuxiliaries,
  RoomOperations,
} from './operations.js'

/**
 * 品牌色板（一个后端在界面上的四色）。
 * 后端是配色的单一真源，界面只消费不发明：GitHub 用蓝、本地 Markdown 用绿，
 * 两房的取值都能在各自 `index.js` 的 `presentation` 里逐字看到。
 * `bg` 与 `border` 用 `light-dark(...)` 写法表达深浅主题两套值（CSS 原生函数，界面直接塞进样式）。
 */
export interface RoomPresentation {
  /** 主色（浅色主题下用）。 */
  color: string
  /** 深色主题下的主色。 */
  darkColor: string
  /** 底色（胶囊背景）。 */
  bg: string
  /** 描边色。 */
  border: string
}

/**
 * 设置页那几行字挂哪个双语词条键。
 * 这里**只声明键名，不装文案**：文案住在界面词表里（中英各一份，单一真源），
 * 后端只负责说「我这一行该显示哪条」。
 */
export interface RoomSetupPrompt {
  trackerLine: string
  trackerChoice: string
  backendNote: string
  /** 标签齐全性要求那一句的键；给空串表示「这个后端的初始化不要求标签齐全」。 */
  labelReqs: string
}

/** 链接相关的只读模板（界面用它拼 URL、识别粘贴进来的链接）。 */
export interface RoomLinks {
  issueUrlTemplate?: string
  repoUrlTemplate?: string
  searchUrlTemplate?: string
  /** 「这个后端里票的链接长什么样」的正则源码（例：本地 Markdown 是 `#(\d+)`）。 */
  linkPatternSource?: string
}

/** 界面能力位：只用来决定「引导入口要不要显示」，**永不被数据路径读取**（G5）。 */
export interface RoomCapabilities {
  /** 要不要显示「标签怎么建」的引导。 */
  labelsGuide?: boolean
  /** 要不要显示「创建并发布仓库」那条链。 */
  repoCreateChain?: boolean
  /**
   * 要不要显示与拉取请求有关的界面扩展（GitHub 房真给了这一格，见 `backends/github/repo.js`）。
   * 同样只驱动界面，不进数据路径。
   */
  pullRequests?: boolean
}

/**
 * 环境检查目录里的一项。
 * 目录的**语义**（检查什么、通过之后显示什么、失败给什么修复动作）由检查目录与修复契约管，
 * 这里只定形状：`check` 是一个「怎么求值」的描述对象，具体字段随检查种类变，故写作 `unknown`。
 */
export interface RoomCheckEntry {
  /** 检查项 id（例：`gh:installed`）。 */
  id: string
  /** 界面上那一行字（中文原话；这一层不做双语，双语在 `fixes.hint` 里）。 */
  label: string
  /** 这条检查属于哪一层（通用链还是某个后端链）。 */
  scope: string
  /** 哪几个后端适用（后端物理隔离：Markdown 的卷子上不出现 GitHub 的行）。 */
  backends: string[]
  /** 怎么求值（描述对象，形状由检查目录自己管）。 */
  check: unknown
  /** 出处（这一项是从哪个文件的哪段逻辑搬来的，便于回溯）。 */
  origin: string
}

/**
 * 检查失败之后的修复动作（词汇表里的一条）。
 * ⚠️ 动作词汇表（`inject-prompt` / `open-url` / `rpc` / `form` / `refresh` / `wizard`）是
 * **跨层协议**，它的类型枚举与形状定义归共享层，本文件不复制那份定义 ——
 * 所以这里用一个宽松形状加索引签名：真正的取值以那份词汇表为准，这里只保证「有 type」。
 */
export interface RoomFixAction {
  /** 动作类型（取值见动作词汇表；本文件不复述枚举，避免两处定义漂移）。 */
  type: string
  /** 按钮上那两个字（双语）。 */
  label?: { zh: string; en: string }
  /** 注入提示词时用：词条键名。 */
  prompt?: string
  /** 刷新动作刷新哪一段（例：`chain`）。 */
  target?: string
  /** 向导动作的步骤（形状归动作词汇表）。 */
  steps?: unknown[]
  /** 其余字段随动作类型而定（打开链接的 url、远程调用的方法名等）。 */
  [extra: string]: unknown
}

/**
 * 一个检查项的失败修复知识：一句人读的指引 + 那一组动作。
 * 这里是**后端知识单源**：界面上「未登录 → 点这里去登录」那套话只在后端写一次，
 * 界面不识别后端、也不推导修复步骤。
 */
export interface RoomFixEntry {
  hint: { zh: string; en: string }
  actions: RoomFixAction[]
}

/**
 * 后端模块对象（第三方后端注册时写的东西）。
 *
 * 必填四件套：`id`、`label`、`create`、`matches`。其余可选，缺了也不会报错（见文件头）。
 */
export interface BackendModule {
  /**
   * 后端 id：开放字符串、仓库内唯一，推荐写成 `发行者.名字`。
   * 一等内置是 `github` / `markdown` / `gitlab`；`'other'` 已弃用且会被注册表当场拒绝。
   */
  id: BackendId

  /** 显示名（界面徽标上那两个字）。 */
  label: string

  /**
   * 造一个能干活的后端实例。
   * 只实现真会的那几条；缺的方法由注册表包一层代理自动补「做不到」的桩。
   * 返回类型里带上三样东西，各有各的理由：
   * - 两个房内扩展（`listSubIssues`、`ensureLabelColorsFile` 等）：它们确实会被房外的宿主电话调用，
   *   不是契约操作，但也不是私有的。
   * - `RoomAuxiliaries`：实例上的只读辅助口（`getRepoKey` / `describe` / `issueUrl`），
   *   注册表视图的回退链与共享壳会取用；不给类型位置的话，两房照原样实现会因多余属性当场报错。
   */
  create(
    ctx: BackendContext,
  ): RoomOperations & Partial<GitHubRoomExtension> & Partial<MarkdownRoomExtension> & RoomAuxiliaries

  /**
   * 启发式识别：这个工作区是不是我的地盘？
   * 读的线索是 `.scratch/map.md`、git remote、`docs/agents/issue-tracker.md` 这类**文件与配置**。
   * 两条纪律：**不确定一律回 `false`**（宁可不认，也不认错——认错会把票写进错的地方）；
   * 回 `false` 的判据要记一行诊断日志，否则用户看不出「为什么没认出我的仓库」。
   * 识别有超时：超时按「未决」处理，由注册表把这一点如实透出去（见 `Selection.pending`）。
   * 返回值的两种写法都合法：直接给布尔，或给一个布尔承诺（两个房间的真实实现都是异步的，
   * 注册表本来就 `await` 它，所以类型上必须允许承诺，否则房间照原样实现当场编译不过）。
   * `ctx` 是**这一次调用**的上下文（`OpContext`，带 `cwd`）：房间要读当前目录就从这个参数读，
   * 不许拿 `create` 时那份 `BackendContext` 顶替——那份里没有 `cwd`。
   */
  matches(handle: RepoHandle, ctx: OpContext): boolean | Promise<boolean>

  /**
   * 产出仓库身份（`refId` / `name` / `url`）。
   * 界面**从不**手拼 `refId`，一律经这里或注册表。省略这个方法时，注册表回退一个骨架
   * （本地给工作区目录，其余给空串）。
   */
  describe?(handle: RepoHandle, backendId: BackendId): RepositoryRef

  /**
   * 一张票在这个后端里的链接。
   * GitHub 是 `https://github.com/{refId}/issues/{key}`，GitLab 是 `.../-/issues/{key}`，
   * 本地 Markdown 没有远端链接，给 `''`（诚实空值，不是省略）。
   */
  issueUrl?(ref: RepositoryRef, key: string): string

  /** 「按仓库名搜索」的链接；本地后端给 `''`。 */
  searchUrl?(name: string): string

  /** 在这个后端的文本里认出票链接的正则（可以是源码串，也可以是 RegExp 对象）。 */
  linkPattern?: RegExp | string

  /** 品牌色板（见 `RoomPresentation`）。 */
  presentation?: RoomPresentation

  /** 设置页那几行字挂哪个词条键（见 `RoomSetupPrompt`）。 */
  setupPrompt?: RoomSetupPrompt

  /** 链接模板（见 `RoomLinks`）。 */
  links?: RoomLinks

  /** 界面能力位（见 `RoomCapabilities`；永不被数据路径读取）。 */
  capabilities?: RoomCapabilities

  /**
   * 这个后端「开仓库」是打开网址还是打开文件夹。
   * `'url'` = 界面用浏览器开 `describe().url`；`'folder'` = 让宿主打开那个目录。
   * 两个都没有（或没有 url 可开）= 诚实「没有这个动作」，界面不显示入口。
   */
  openRepository?: 'url' | 'folder'

  /**
   * 注入给会话的文案数据：词条键 → 该键的内容。
   * 两种真实形状并存，所以值写成联合而不是只认一种：
   * - 双语全文 `{ zh, en }`（多数词条是这种）；
   * - 命令词表 `{ cli, cliBrand }`（GitHub 房给 `cli: 'gh'`、本地 Markdown 房给 `cliBrand: '本地 Markdown'`，
   *   两个键都不是双语文案）。按只认 `{zh,en}` 写，两房照原样实现会因多余属性当场编译不过。
   */
  prompts?: Record<string, { zh: string; en: string } | { cli?: string; cliBrand?: string }>

  /** 这个后端自己的检查目录（见 `RoomCheckEntry`）。 */
  checks?: RoomCheckEntry[]

  /** 检查失败之后的修复知识（见 `RoomFixEntry`）。 */
  fixes?: Record<string, RoomFixEntry>

  /**
   * 这个后端自己的默认标签调色盘。
   * 本地 Markdown 提供（它是本地标签结构与内置默认色的真源）；GitHub/GitLab 不声明 ——
   * GitHub 的颜色在仓库标签上，不需要一份本地默认表。
   * 面板查色的顺序是「模块默认 → 工作区配置覆盖」，两处分工别搞反。
   */
  labelPalette?: { name: string; color: string }[]
}

// 类型再导出：`create` 的返回形状直接引用了这三个房内/旁路形状，调用方从本文件取用更顺手，
// 免得每次都去 operations.ts 再 import 一次。
export type { GitHubRoomExtension, MarkdownRoomExtension, RoomAuxiliaries }
