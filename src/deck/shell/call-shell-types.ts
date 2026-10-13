// src/deck/shell/call-shell-types.ts —— 工具壳的契约形状（#1040 拆出来）
//
// 为什么单独一个文件：call-shell.ts 补完类型标注之后有效行数冲到 461，越过了「单文件 350 行」
// 那条上限（tests/verify-file-granularity.js）。壳里「外面递进来的东西长什么样」与「壳发出去的东西
// 长什么样」是一件事，收在这份文件里；机制（取会话、选后端、过闸、拼信封）留在 call-shell.ts。
// 拆开的唯一原因就是那条行数上限，不是为了分层 —— 与同目录 rules/ 那几份文件头的口径一致。
//
// 谁用它：只有 call-shell.ts，而且是 `import type`（只借形状，运行时不留一条边）。
// 九个工具不引这里：它们各自声明自己那份 deps，只按 createDeckShell 的入参形状对上就行。
//
// 口径（#1040 转 TypeScript 时定下）：外面递进来的东西（exec、会话、闸、注册表、估算函数）形状
// 不由壳决定，所以入参按 unknown 收、用之前逐格验；壳发出去的两样东西给明确契约 —— 三态信封
// DeckEnvelope 与选后端结论 PickResult，九个工具与测试都按这两张形状读。
// 改这里的字段名要连带看的门禁：tests/verify-deck-tools.js 一族按信封形状断言。

/** 未知形状的入参统一按这张表逐格验，不猜。 */
export type UnknownRecord = Record<string, unknown>;

/**
 * 会话那份（session-workdir 交出来的 ok 支）：本文件只读目录、工作区键与会话号。
 * 这里不写索引签名：接口不会自动长出索引签名，目标带一条就要求递进来那份也自带一条，
 * 于是 session-workdir 交出的 SessionContextSuccess 当场赋不进来（九个工具一起红）。
 * 多出来的格子（source、text、rawCwd 等）不声明也不挡赋值，本文件本来也不读它们。
 */
export interface ShellSession {
  cwd: string;
  workspaceKey: string;
  sessionId?: unknown;
}

/** 额度常量表：字段名与 refresh-core/src/budget.ts 的导出同名。 */
export interface DeckLimits {
  maxPointsPerCall: number;
  maxRequestsPerCall: number;
  maxChildTicketsPerCall: number;
  maxPointsPerHour: number;
  maxRequestsPerHour: number;
}

/** 算账函数吃的第二格：额度常量 + 本小时已用量（两个已用量的名字与 budget.js 那份算账函数约定同名）。 */
export interface HourUsageView extends DeckLimits {
  usedPointsThisHour: number;
  usedRequestsThisHour: number;
}

/** 算账结论（账本那份算出来的）：工具拿它填 cost.estimated，壳拿它过闸。 */
export interface CostEstimate {
  points: number;
  requests: number;
  /** 这次要建几张子票（只有批量建图用得上）。 */
  tickets?: unknown;
  /** 建议每次分片建几张。 */
  perShard: number;
  /** 建议分几片。 */
  shards?: unknown;
  withinCallCap?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

/** 仓库身份：后端 id、仓库标识、名字、地址，外加 _cwd（后端房间内部用来定位工作区）。 */
export interface DeckRepo {
  backend: string;
  refId: string;
  name: string;
  url: string;
  effortId?: unknown;
  _cwd: string;
  [key: string]: unknown;
}

/** 选出来那份 ref（注册表 describe 的产物）：字段可能缺，缺了就用后端 id 顶上，不造假名字。 */
export interface DeckRepoRef {
  backend?: unknown;
  refId?: unknown;
  name?: unknown;
  url?: unknown;
  effortId?: unknown;
  [key: string]: unknown;
}

/** 选后端没成：给 AI 的那句话在 text 里，机器可读的原因在 reason 里。 */
export interface PickFailure {
  ok: false;
  reason: string;
  text: string;
  errorHash?: string;
}

/** 选后端成了：后端 id、来源、那份 ref，以及这次探测的记账（请求数与点数）。 */
export interface PickSuccess {
  ok: true;
  backendId: string;
  source: string;
  ref: DeckRepoRef | null;
  pending: boolean;
  requests: number;
  points: number;
}

/** 选后端的两种结论：成了给后端 id 与那份 ref，没成给机器码原因与给 AI 的那句话。 */
export type PickResult = PickSuccess | PickFailure;

/** 宿主闸的裁决：admitted 为假时 reason/text 说明顶在哪、用了多少。 */
export interface AdmitResult {
  admitted?: unknown;
  reason?: unknown;
  points?: unknown;
  requests?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

/** 宿主闸记账那一笔的结论：sent 为假表示这次被推迟，reason/detail 说明为什么。 */
export interface GateSendResult {
  sent?: boolean;
  reason?: unknown;
  detail?: unknown;
  requests?: unknown;
  points?: unknown;
  remaining?: unknown;
  tier?: unknown;
  [key: string]: unknown;
}

/** 宿主闸（src/host/refresh/gate.js 的产物）：先判硬顶，再记账。 */
export interface GateLike {
  admitAiTool(usage: UnknownRecord, meta: UnknownRecord): AdmitResult;
  send(meta: UnknownRecord, fn: () => Promise<unknown>): Promise<GateSendResult>;
  [key: string]: unknown;
}

/** 后端注册表（src/tracker/registry/core.ts 的产物）：按既有优先级选后端、取实现、描述 ref。 */
export interface RegistryLike {
  select(handle: unknown, ctx: UnknownRecord): unknown;
  get(backendId: unknown): unknown;
  describe(handle: unknown, backendId: unknown): unknown;
  [key: string]: unknown;
}

/** 日志出口：只认 fire 一个方法（写 host.call / host.call.fail 两行，不新增事件名）。 */
export interface DeckLogLike {
  fire(level: string, event: string, fields: UnknownRecord): unknown;
}

/**
 * 可中止的等待信号：只声明壳真正用到的那两点（看有没有中止、挂一个中止回调）。
 * 不写成 AbortSignal 是为了不依赖 DOM 或 Node 的类型定义——壳与工具之间只按这个形状对接。
 */
export interface WaitSignal {
  aborted?: boolean;
  addEventListener?: (type: string, listener: () => void) => unknown;
  removeEventListener?: (type: string, listener: () => void) => unknown;
}

/** 建壳要的那些依赖：必填的三个（闸、注册表、算账）由装配方保证，其余缺席就跳过对应那一步。 */
export interface DeckShellDeps {
  gate?: GateLike;
  registry?: RegistryLike;
  budget?: UnknownRecord;
  /**
   * 算账函数（三个必填项之一）：工具与装配方递进来的是各自依赖袋里的值，形状不由壳定，
   * 所以按 unknown 收；壳在用到的那一刻按函数用（缺了当场报错，与转 TypeScript 之前一致）。
   */
  estimate?: unknown;
  /**
   * 后端能力袋（platform / fs / exec 那一套）：可以给对象，也可以给一个现取的函数。
   * 按 unknown 收：工具那份依赖袋把它声明成 `() => 自己那个具名接口`，而具名接口不带索引签名，
   * 声明成 `UnknownRecord | (() => UnknownRecord)` 就赋不进来（九个工具一起红）。
   */
  backendCtx?: unknown;
  log?: DeckLogLike | null;
  now?: () => number;
  /**
   * 等待口：(毫秒) => Promise，第二个参数是可选中止信号。
   * 缺省是真定时器；测试注入假时钟就不必真等（仓库标识补全的 8 秒、单次调用的钳制都走它）。
   */
  sleep?: (ms: number, signal?: WaitSignal | null) => Promise<unknown>;
  /** 写后失效缓存：按仓库与票号把宿主那份快照作废（workspace 一并交出去，宿主按目录分桶）。 */
  invalidate?: (arg: { repo: unknown; backendId: unknown; keys: string[]; workspace: unknown }) => unknown;
  /** 动手前保一次剩余额度读数：ensureReading(cwd, workspaceKey)，缺席时跳过。 */
  ensureReading?: (cwd: string, workspaceKey: unknown) => unknown;
  /** 仓库标识补全的等待上限（毫秒）：缺席 8000，测试可调小。 */
  resolveTimeoutMs?: number;
  handleFor?: (s: ShellSession) => UnknownRecord;
  decideBackend?: (cwd: string, opts: UnknownRecord) => unknown;
  readChoice?: unknown;
  readWorkspaceFileText?: unknown;
  parseWorkspaceFile?: unknown;
  readDeclarationId?: unknown;
  hourUsage?: () => UnknownRecord;
  /** 算账函数的输入拼装（可选）：同样按 unknown 收，壳用之前验是不是函数，不是就退自带那份默认。 */
  costInputFrom?: unknown;
  noteGate?: (info: { phase: string; verdict: string; reason: string }) => unknown;
  [key: string]: unknown;
}

/** 三态信封：五个必备字段 + 工具按需添的格子（cost / workspace / items / touched 等）。 */
export interface DeckEnvelope {
  ok: boolean;
  status: string;
  tool: string;
  reason: string;
  text: string;
  /**
   * 后端回执那一格：故意留 any。九个工具按后端原样读它（先 `r.data || {}` 再取字段，共 46 处），
   * 而契约层还没给这些回执建模（#1108 记着这笔账）。收紧成 unknown 会让那 46 处当场红，
   * 那些改动属九个工具那一批（#1035 已收口），不属本票边界。
   */
  data?: any;
  items?: unknown[];
  notes?: unknown[];
  readBack?: unknown;
  touched?: string[];
  workspace?: unknown;
  backend?: { id: unknown; source: unknown; [key: string]: unknown };
  repo?: unknown;
  cost?: unknown;
  errorHash?: string;
  [key: string]: unknown;
}

/** 工具交给壳的那些上下文（meta）：壳只认这几个格子。 */
export interface CallMeta {
  tool: string;
  session: ShellSession;
  estimate: CostEstimate;
  pick: PickSuccess;
  repo: DeckRepo;
  kind?: string;
  /**
   * 沙箱许可策略快照：九个工具里有的直接给 null、有的给一次探测的结论（那边声明成 unknown），
   * 所以按 unknown 收；壳用之前先验是不是对象，不是就当没有。
   */
  sandbox?: unknown;
  [key: string]: unknown;
}

/** 交给工具那段活儿的那格上下文：会话、选出来的后端、仓库、闸、时间、后端实现与取消信号都在里面。 */
export interface CallCtx {
  session: ShellSession;
  pick: PickSuccess;
  repo: DeckRepo;
  gate: GateLike;
  now: () => number;
  /**
   * 等待口也放进这格：工具侧算单次预算钳制时（call-budget.ts 的 sleepFn）先看自己那层 opts，
   * 再看这里。壳不把它放进来，注入的假时钟就够不到钳制那一处，只能真等。
   */
  sleep: (ms: number, signal?: WaitSignal | null) => Promise<unknown>;
  tracker: unknown;
  opCtx: Record<string, unknown>;
  admit: AdmitResult;
  [key: string]: unknown;
}

/** 壳对外交出的能力：九个工具只用这些。 */
export interface DeckShell {
  limits: DeckLimits;
  estimateFor(tool: string, args?: unknown): CostEstimate;
  pickBackend(exec: unknown, s: unknown): Promise<PickResult>;
  repoOf(pick: PickSuccess, s: unknown): DeckRepo;
  call(meta: CallMeta, work: (ctx: CallCtx) => unknown): Promise<DeckEnvelope>;
  unsupported(tool: string, reason: string, text: string, extra?: UnknownRecord): DeckEnvelope;
  envelope(tool: string, status: string, extra?: UnknownRecord): DeckEnvelope;
  hash8(text: unknown): string;
  fire(method: string, ms: number, ok: boolean, errorHash?: string): void;
}
