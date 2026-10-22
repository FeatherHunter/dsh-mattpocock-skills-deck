/**
 * src/client/mapDetailV2/mapDetailTypes.d.ts —— V2 地图详情页的数据契约（纯类型，永不转译）。
 *
 * 为什么单独立一份：这一页从宿主拿数据的路有三条（首屏快照 / wf.mapTickets 按需取全量 / 取失败），
 * 三条路的行形状不完全一样。把三条路收成一份最小并集，后面的推导函数就只认这一份形状，
 * 不必在每个函数里各写一遍「这个字段可能叫什么」。
 *
 * 目录约定：本目录的代码先不接入生产（老详情页 views/MapDetail.ts 仍是唯一挂载点），
 * 所以它不登记进客户端闭包、不进构建产物；接入时才搬进 views/ 并按叶子登记。
 * 那一件事单独做，免得「先不接入」这句话在代码上变成空话。
 */

import type { IssueCardProps } from '../views/cards/cardProps'

/** 子票行的最小并集：只列 V2 真正读到的字段；其余字段即使有，也不在这里承诺。 */
export interface MapTicketRow {
  /** 行自己的 key（快照与按需取数两边都有）；没有编号时靠它给卡片 id 起名字。 */
  key?: string | number | null
  /** 票号。宿主算好分层用的是数字编号；解析不出时按 key 兜底。 */
  number?: number | null
  title?: string | null
  /** 宿主保证是 'OPEN' / 'CLOSED'（大写）；其它取值一律按「不是已关闭」处理。 */
  state?: string | null
  /** 标签两种形状都可能在：名字字符串，或 {name,color} 对象。颜色优先取标签自己带的。 */
  labels?: Array<string | { name?: string | null; color?: string | null }> | null
  /** 阻塞者编号；数字与字符串两种后端形状都收。 */
  blockedBy?: Array<number | string> | null
  /** 认领人（有的后端给 assignees，改从那里取第一个）。 */
  claimedBy?: string | null
  assignees?: Array<{ login?: string | null }> | null
  updatedAt?: string | null
  closedAt?: string | null
  /** 行自带的类型名；只在标签里找不到 wayfinder 类型时兜底。 */
  type?: string | null
}

/** 宿主算好的计数（groupTickets 的产物）；页面只在「按需取数已成功」时用它。 */
export interface MapTicketStats {
  total?: number
  open?: number
  closed?: number
  frontier?: number
  claimed?: number
  blocked?: number
}

/** 按需取数桶（src/client/kernel/api-io.ts 里 fetchMapTickets 写的形状）。 */
export interface MapTicketsBucket {
  mode?: string
  items?: MapTicketRow[] | null
  stats?: MapTicketStats | null
  total?: number | null
  capped?: boolean
  missing?: number | null
  error?: { kind?: string | null; message?: string | null } | null
}

/** 快照里的地图行：V2 只读「子票」与「计数」两格，其余字段不承诺。 */
export interface MapRowLike {
  tickets?: MapTicketRow[] | null
  stats?: MapTicketStats | null
}

/** 生产侧的行级动作名（与 src/client/kernel/row-actions.ts 的 rowActionKind 同集，九种）。 */
export type SourceActionKind = 'diagnose' | 'takeover' | 'supplement' | 'fix' | 'discuss' | 'research' | 'prototype' | 'execute' | 'implement'

/** 卡片样张的八种动作键（与 views/cards/PixelCardTheme.ts 的 CARD_ACTION_STYLE 同集）。 */
export type CardActionKey = 'diagnose' | 'fix' | 'execute' | 'claim' | 'supplement' | 'research' | 'grill' | 'proto'

/** 卡片在页面里的四种状态：与宿主 groupTickets 的四个桶一一对应，不另立口径。 */
export type TicketCardStatus = 'ready' | 'doing' | 'blocked' | 'closed'

/** 一张卡指向的另一张票（阻塞关系两个方向共用这个形状）。 */
export interface CardTicketRef {
  no: string
  title: string
  cardId?: string | null
}

/**
 * 一张 ISSUE 卡片要画的东西。
 *
 * 不能原样摊进 views/cards 的 IssueCardProps：页面适配层还要做三处改名——bug 要给
 * bugCorner、footText 要给 footActionText、blocks 要给 blocksChip；closed 则由
 * status === 'closed' 得到。少了这三步，卡上会丢 BUG 三角、结案封条、页脚词和挡路条。
 */
export interface TicketCardFacts {
  /** 票号；解析不出时为 null。排序与卡片 id 都以它为准。 */
  number: number | null
  /** 行自己的 key（没有编号时它是卡片 id 的唯一来源）。 */
  rowKey: string
  /** 编号牌文本，形如 '#1332'。 */
  noText: string
  title: string
  status: TicketCardStatus
  /** 卡片八种动作键：由生产侧九种动作映射而来，页面不自己映射。 */
  action: CardActionKey
  /** 类型小签（最多一枚）；普通票（issue）没有类型小签。 */
  tags: Array<{ text: string; color?: string }>
  /**
   * 有 bug 标签 → 卡片左上角红三角（已结案的票也保留，与 p101 定版一致）。
   * 在办的票例外：p101 定版先画「在办」角标，所以 status==='doing' 时这里是 false。
   */
  bug: boolean
  /** 已在办 → 标题后的「X 已认领」；已结案或没人在办时是空串。 */
  claimedBy: string
  /** 更新日 MM-DD；取不到或认不出时是空串，不拿一段乱码当日期。 */
  updatedText: string
  /** 结案时间原样（给排序用；解析不出时是空串）。 */
  closedAt: string
  /** 页脚右侧的状态词（可接 / 在办 / 被挡 / 已结案），由 textOf 取。 */
  footText: string
  /** 左下角状态角标：可接 / 在办 / 无。 */
  pickCorner: 'ready' | 'doing' | null
  /** 本卡的 DOM id；同屏唯一（前缀由调用方按工作单元与地图编号给）。 */
  cardId: string | null
  /**
   * 被挡时指向挡它的那张；只有 status==='blocked' 时才非空（与「在办优先」一致）。
   * 取的是主阻塞者（页面上仍开着、编号最小），与 blocks 那一侧用同一判定，两侧说法不会矛盾。
   * 注意：现有的 PixelBlockedSeal 只读 no，title 还画不出来——接页面时要扩展那个组件，
   * 或者先只显示编号；这条字段已经备好，不是缺数据。
   */
  blockedBy: CardTicketRef | null
  /**
   * 本票挡住的那张（页面上第一张被挡的票，按编号升序）；没有挡住谁时为 null。
   * 只指向「主阻塞者正是本票」的票，所以被挡卡的 blockedBy 和挡路卡的 blocks 一定互相对得上。
   */
  blocks: CardTicketRef | null
}

/** 造一张卡要的外部依赖：动作与词条都从外面进，模型自己不认识后端也不认识中文。 */
export interface TicketFactsEnv {
  /** 卡片 DOM id 前缀：调用方按「工作单元 + 地图编号」给，同屏两张地图的票不会撞 id。 */
  cardIdPrefix: string
  /** 标签名 → 十六进制色（带不带 # 都收）；取不到时卡片按自己的兜底色画。 */
  colorOf?: Record<string, string> | null
  /** 这张票的生产侧动作。真页传 rowActionKind，门禁传桩，保证只有一处判定。 */
  actionOf: (row: MapTicketRow) => SourceActionKind
  /** 词条取字。真页传 tr，门禁传「只回键名」的桩，于是门禁断言的是键而不是中文。 */
  textOf: (key: string) => string
}

/** 全图索引：判状态、取阻塞者标题、算卡片 id 都从这里查，不每张票各扫一遍全表。 */
export interface TicketFactsContext extends TicketFactsEnv {
  /** 编号（规范键，补零的 '01' 已折成 '1'）→ 那张票是否还开着（'OPEN' 及任何非 'CLOSED' 都算开着）。 */
  openByNumber: Record<string, boolean>
  titleByNumber: Record<string, string>
  cardIdByNumber: Record<string, string | null>
  /** 阻塞者编号 → 它作为主阻塞者挡住的第一张（编号最小、且确实处于被挡状态）票的编号。 */
  firstBlockedByBlocker: Record<string, string>
}

/** 取数这一层的五种状态：画卡之前先画「现在处在哪一种」。 */
export type FeedState = 'ready' | 'loading' | 'failed' | 'unsupported'

/** 取数结果：一张地图的子票行 + 该怎么说「这份数据有多全」。 */
export interface TicketFeed {
  rows: MapTicketRow[]
  stats: MapTicketStats | null
  state: FeedState
  /** 'requested' = 按需取数已成功的那一份（最全）；'snapshot' = 首屏快照那一份。 */
  source: 'snapshot' | 'requested'
  /** 后端报的总数；快照来路或后端没给时为 null，页面不得拿行数冒充。 */
  total: number | null
  /** 撞到后端硬上限被截断。 */
  capped: boolean
  /** 后端总数与取回张数对不上的差额。 */
  missing: number
  /** 取失败时给人看的原因（截断到 120 字）；其余状态为空串。 */
  failedMessage: string
  /**
   * 真的一张都没有：只有 state==='ready'、取回 0 行、且 stats 也没说本图还有票时才为 true。
   * 「正在取」「取失败」时一律 false——那一刻画面里没有卡是因为还没拿到，不是因为没有。
   */
  empty: boolean
}

/** 看板：未完成的一段、已完成的一段。卡片在页面上的全部顺序都由这一份决定。 */
export interface TicketBoard {
  open: TicketCardFacts[]
  closed: TicketCardFacts[]
}

/** 看板计数：档案头的「子票 / 已完成 / 可接 / 在办 / 被挡」直接取这里，不再各数一遍。 */
export interface TicketBoardCounts {
  total: number
  closed: number
  ready: number
  doing: number
  blocked: number
}

/**
 * 地图正文「Decisions so far」里的一条决策：标题、链接与那句话。
 * 形状与 src/tracker/body-parse.ts 的 MapDecision 一字不差——解析在宿主做，客户端只读结果，
 * 不在页面里另解析一遍正文（两份解析器迟早对不上）。
 */
export interface MapDecision {
  /** 决策标题。 */
  title: string
  /** 决策的链接；那行没写链接时是空串。 */
  url: string
  /** 去掉标题之后剩下的那句话。 */
  gist: string
}

/**
 * 快照里的地图行：比 MapRowLike 多读「地图自身内容」几格。
 * 这几格由宿主 tracker/body-parse.ts 从正文五区解析后放进快照，客户端不做解析。
 */
export interface MapRowContent extends MapRowLike {
  /** 地图编号（或行 key）。身份文本「MAP #编号」靠它。 */
  key?: string | number | null
  number?: number | null
  title?: string | null
  /** ## Destination：目的地那一句。 */
  destination?: string | null
  /** ## Notes：备注（可能带 markdown）。 */
  notes?: string | null
  /** ## Decisions so far：已定的决策清单。 */
  decisions?: MapDecision[] | null
  /** ## Not yet specified：还没定的事（战雾）。 */
  fog?: string[] | null
  /** ## Out of scope：明确不做的。 */
  outOfScope?: string[] | null
  /** 快照组装失败时宿主写在行上的错误。 */
  error?: { error?: string | null } | null
}

/** 档案区四节的标识：顺序即页面上的顺序，由 MAP_PROFILE_SECTIONS 给定。 */
export type MapProfileSectionId = 'notes' | 'decisions' | 'fog' | 'outOfScope'

/** 档案区的一条：文字必填，决策条目另带链接与那句话。 */
export interface MapProfileItem {
  text: string
  url?: string
}

/** 档案区一节：标识、词条键、条目、条数。页面按 labelKey 取字、按 items 画。 */
export interface MapProfileSection {
  id: MapProfileSectionId
  /** 节标题词条键；词条里可能带 {n}（沿用老页 map.decisions 等键）。 */
  labelKey: string
  count: number
  items: MapProfileItem[]
}

/** 子票那句的组成段：键 + 占位参数，由页面按词条拼。为什么不直接给整句：中文是词条的事，模型不认语言。 */
export interface MapProfileFeedSegment {
  key: string
  params?: Record<string, string | number>
}

/** MAP 自身内容的刻画：档案区与头部要用到的全部东西，页面不再自己判。 */
export interface MapProfile {
  /** 身份文本，形如 '#1314'；编号与 key 都取不到时是空串。 */
  noText: string
  /** 地图标题。 */
  title: string
  /** ## Destination 原文。 */
  destination: string
  /** 有目的地一句（空地图要画补全入口，不能把它画成一句空话）。 */
  hasDestination: boolean
  /** 看板计数（子票 / 已完成 / 可接 / 在办 / 被挡）。 */
  counts: TicketBoardCounts
  /** 完成度百分比（0..100，按已完成张数算）；一张子票都没有时是 0。 */
  progressPercent: number
  /** 子票那句由哪几段拼成（取数状态、是否被截断、差额）；后端明确不支持时是空数组（老页一个字都不加）。 */
  feedSegments: MapProfileFeedSegment[]
  /** 档案区四节。 */
  sections: MapProfileSection[]
  /** 四节里至少有一条内容（空地图时全部为空，页面据此收起档案区或画空态）。 */
  hasSections: boolean
  /** 快照错误（截到 160 字）；没有错误时是空串。 */
  errorText: string
}

/**
 * 一张卡片的四个按钮被点按后要做什么。
 *
 * 为什么由页面传进来而不是模型自己决定：模型不认识导航栈、宿主电话与注入渠道；
 * 它只负责把「这张票的刻画」一并交给回调，页面据此做注入提示词、开新会话、复制链接、打开外链。
 */
export interface TicketCardHandlers {
  /** 主按钮（按这张票的动作而定：诊断 / 执行 / 修复 / 接手 / 补充 / 研究 / 讨论 / 原型）。 */
  onMain?: (facts: TicketCardFacts) => void
  /** 「新会话」按钮。 */
  onNew?: (facts: TicketCardFacts) => void
  /** 「复制链接」按钮。 */
  onCopy?: (facts: TicketCardFacts) => void
  /** 「打开外链」按钮（或本机路径）。 */
  onOpen?: (facts: TicketCardFacts) => void
}

/** 合成一整页模型要的外部输入：地图行、取数桶、页面给的动作与词条来源、四个按钮的页面回调。 */
export interface MapDetailPageInputs {
  /** 快照里的地图行（含正文五区解析结果）。 */
  map: MapRowContent
  /** 按需取数桶；首屏还没有时传 null，模型按快照画并标 loading。 */
  bucket?: MapTicketsBucket | null
  /** 卡片 DOM id 前缀：调用方按「工作单元 + 地图编号」给。 */
  cardIdPrefix: string
  /** 标签名 → 十六进制色；页面传 buildColorOf(st)。 */
  colorOf?: Record<string, string> | null
  /** 这张票的生产侧动作（真页传 rowActionKind）。 */
  actionOf: (row: MapTicketRow) => SourceActionKind
  /** 词条取字（真页传 tr）。 */
  textOf: (key: string) => string
  /** 四个按钮的页面回调。 */
  handlers?: TicketCardHandlers | null
}

/** 一整页的卡片：未完成一段、已完成一段，顺序与看板一致。 */
export interface MapDetailCards {
  open: IssueCardProps[]
  closed: IssueCardProps[]
}

/**
 * 一整页要画的东西：地图档案、取数状态、看板、计数、两段卡片 props。
 *
 * 页面容器只负责发取数请求、把宿主电话与导航接进 handlers，然后把这份模型交给画法层。
 * 这样「怎么判断」全在纯函数里，画法层只认这一份形状；换皮肤、换布局都不动判断。
 */
export interface MapDetailPageModel {
  /** MAP 自身内容（档案区 + 头部 + 完成度 + 子票那句）。 */
  profile: MapProfile
  /** 取数状态（页面据 state 决定画「正在取」「取不到」还是两段卡片）。 */
  feed: TicketFeed
  /** 看板的刻画（画法层偶尔要读某张票的 fact，例如给卡加 note 之外的信息）。 */
  board: TicketBoard
  /** 看板计数（与 profile.counts 同一份，留一份给画法层少读一层）。 */
  counts: TicketBoardCounts
  /** 两段卡片的 props（已按看板顺序排好，直接摊给卡片组件）。 */
  cards: MapDetailCards
}

