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

/** 一张 ISSUE 卡片要画的东西：够直接摊进 views/cards 的 IssueCardProps，不多不少。 */
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
  /** 有 bug 标签 → 卡片左上角红三角（已结案的票也保留，与 p101 定版一致）。 */
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
  /** 被挡时指向挡它的那张；只有 status==='blocked' 时才非空（与「在办优先」一致）。 */
  blockedBy: CardTicketRef | null
  /** 本票挡住的那张（页面上第一张被挡的票，按编号升序）；没有挡住谁时为 null。 */
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
  /** 编号 → 那张票是否还开着（'OPEN' 及任何非 'CLOSED' 都算开着）。 */
  openByNumber: Record<string, boolean>
  titleByNumber: Record<string, string>
  cardIdByNumber: Record<string, string | null>
  /** 阻塞者编号 → 它挡住的第一张（编号最小、且确实处于被挡状态）票的编号。 */
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
  /** 一行都没有。注意「没有」与「正在取」是两回事，别把两者画成同一句。 */
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
