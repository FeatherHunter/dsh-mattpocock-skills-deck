/**
 * src/tracker/contract/contexts.ts —— 契约的调用上下文：这台机器能干什么、这一次调用是谁
 *
 * ── 这一件在五件里的位置 ────────────────────────────────────────────────────────
 * 按「谁读它」拆五件（见同目录 README.md）：本件放**调用上下文**，读者是每个房间的实现
 * 与装配那一层（`BackendModule.create()` 收的就是这里的 `BackendContext`）。
 * 本文件只引用地基层（identity.ts）之外什么都不引 —— 它不引用实体、不引用返回值：
 * 上下文回答「怎么干活」，不回答「票长什么样」。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 三、调用上下文：进程级能力与单次调用上下文
//
// 这两层的分工是本契约最容易搞混的地方：`BackendContext` 是「这台机器能干什么」，
// 房间 create 的时候注入一次；`OpContext` 是「这一次调用是谁、在哪个目录、
// 能不能中途取消」，每次操作都新给一份。房间实现里凡是碰目录、碰信号的，
// 都必须读 `OpContext`，不许把 create 时的上下文当成这一次的。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 沙箱文件服务：受栅栏约束，房间不许绕过它直连 `node:fs`。
 * 下面这些方法是从两个房间的真实调用点逐条归纳出来的（GitHub 房与本地 Markdown 房合计）：
 * 用得最多的三个（resolve / readText / writeText）必填，其余按房间实际用到、各实现未必都给全的情况标可选。
 */
export interface SandboxFs {
  /** 把相对路径解析成绝对路径（相对谁由 opts.cwd 给）。 */
  resolve(rel: string, opts?: { cwd?: string }): Promise<string>
  /** 读文本（文件不在或读不出来时抛错，由调用方按「没有这份文件」处理）。 */
  readText(path: string): Promise<string>
  /**
   * 写文本。
   * 后面允许跟任意多个位置参数：本地 Markdown 房的真实调用是
   * `fs.writeText(目标, 内容, undefined, undefined, 沙箱政策)`（五个位置参数），
   * 把签名收成两个参数会让房间照原样实现当场编译不过（TS2554）。
   * 多出来的位置参数含义由实现自己解释，契约只保证「前两个是目标与内容」。
   */
  writeText(path: string, text: string, ...rest: unknown[]): Promise<void>
  readFile?(path: string, opts?: unknown): Promise<unknown>
  writeFile?(path: string, data: unknown, opts?: unknown): Promise<void>
  read?(path: string): Promise<unknown>
  write?(path: string, data: unknown): Promise<void>
  lstat?(path: string): Promise<unknown>
  stat?(path: string): Promise<unknown>
  listDir?(path: string): Promise<unknown[]>
  readdir?(path: string): Promise<unknown[]>
  mkdir?(path: string, opts?: unknown): Promise<void>
  rm?(path: string, opts?: unknown): Promise<void>
  unlink?(path: string): Promise<void>
  rename?(from: string, to: string): Promise<void>
  access?(path: string): Promise<void>
}

/**
 * 起一个进程的回包。字段按各实现的真实产出声明，不强行凑成一种：
 * 走宿主执行器的实现给 stdout / stderr / code；包过后端命令的实现另给合并输出 text、
 * 失败原因 error 与原始回包 data（例如 gh 的 JSON 结果放在 data.stdout）。
 */
export interface ExecResult {
  stdout?: string
  stderr?: string
  code?: number
  /** 合并后的输出（有的实现只给这一个，读 stdout 拿不到东西时读它）。 */
  text?: string
  /** 失败原因（非零退出或进程起不来时由实现填；真实兜底给的是字符串）。 */
  error?: string
  /**
   * 原始回包。**只有包过后端命令的实现才给**（例如房内 gh 客户端的回执信封把 JSON 结果放在 `data.stdout`）；
   * 只产出三件套的实现可以不给这一格。写在这里是因为房间真实读它，不是为了要求每个实现都产出。
   */
  data?: { stdout?: string; [key: string]: unknown }
}

/**
 * 平台抽象实例（房间 create 时注入一次；宿主构建单例）。
 * 下面五样是从两个房间的真实读取点逐条归纳出来的，不照抄更宽的形状，
 * 免得房间实现里每一次读取都要先写断言才能编译。
 */
export interface BackendPlatform {
  /** 路径运算（按当前操作系统解析好的那一套）。 */
  path: {
    join(...parts: string[]): string
    sep: string
    /**
     * 这个路径是不是绝对路径。**必填**，依据是本地 Markdown 房的真实读法：
     * `markdown/index.js:16` 写 `plat.isAbsolute(p)`、`markdown/path.js:3` 同一处，
     * 且 `markdown/index.js:24` 拿它决定「当绝对路径用」还是「拼到工作区目录下」。
     * 缺这一格时那几处照原样迁移会报 TS2741（平台那个对象上缺 isAbsolute）。
     */
    isAbsolute(p: string): boolean
    /**
     * 取所在目录。**必填**，依据是 `markdown/write.js:23` 与 `:33`：两处都是拿到 plat 就直接调
     * `await ensureDir(ctx, plat.dirname(fullPath))`，中间没有判空。写成可选成员的话，
     * 那两处照原样迁移会报 TS2722（不能调用可能是 undefined 的东西）。
     */
    dirname(p: string): string
    resolve?(...parts: string[]): string
    basename?(p: string): string
  }
  /** 沙箱文件服务（受栅栏约束，不能绕过它直连 node:fs）。 */
  fs: SandboxFs
  /** 把命令名解析成可执行文件的绝对路径；解析不出来回 null。房间直接调它，所以是必填。 */
  resolveExecutable(name: string): Promise<string | null> | string | null
  /**
   * 起进程（宿主侧实现会把每一笔出站报给闸记账）。
   * **可选**：真实平台对象上今天没有这一格，房间起命令走的是上下文自己的 `exec`（`OpContext.exec`，
   * 见 `github/backend.js:48` 与 `github/client.js:47`）。写成必填是「话说得比实情满」，
   * 会让照契约实现的人多背一个从不存在的成员。
   */
  exec?(
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeout?: number; signal?: AbortSignal },
  ): Promise<ExecResult>
  /** 用户主目录（本机设置文件住在那下面）。 */
  getHome?(): Promise<string>
  /** 环境变量读取口（不许直接摸 process.env）。房间直接调它，所以是必填。 */
  env: { get(name: string): string | undefined; has(name: string): boolean }
}

/**
 * 进程级能力（房间 create 时注入一次；宿主构建单例）。
 * 房间**不许**直接 `import node:fs` 或直接用全局 `fetch`：文件读写走 `fs`（受沙箱约束）、
 * 起进程走 `exec`（受闸记账）、定时器走 `timers`（测试要能替换假时钟）。
 */
export interface BackendContext {
  /** 平台抽象实例（已按当前操作系统解析好的那一个，不是工厂）。 */
  platform: BackendPlatform
  /** 沙箱文件服务（受栅栏约束，不能绕过它直连 node:fs）。 */
  fs: SandboxFs
  /**
   * 起一个进程并等它结束。
   * 真实实现在宿主侧，会把每一笔出站报给闸记账；返回回包而不是抛异常。
   */
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeout?: number; signal?: AbortSignal },
  ) => Promise<ExecResult>
  /** 定时器（测试注入假时钟用；房间不许直接摸全局 setTimeout）。 */
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  /**
   * 房内结构化日志（防火即发：只把这一行放进内存队列就返回，不等写盘）。
   * 事件名与字段按日志白名单，高频行必须先问 `isEnabled` 再组装字段。
   * @deprecated 旧字段 `log` 已退役（#494 O1），新埋点只走这里。
   */
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  /** 日志开关的同步判断（信息与调试级要不要记）；权威判断仍在日志库体内兜底。 */
  isEnabled: (level: string) => boolean
}

/**
 * 单次操作/匹配/选择用的上下文：进程级能力 + 这一次调用的现场。
 * 注意这是**交叉类型**而不是另起一个对象：运行时它就是 `BackendContext` 的超集
 * （注册表构造匹配上下文时把两者合并成一份）。
 */
export type OpContext = BackendContext & {
  /** 这一次调用针对的工作区目录。 */
  cwd: string
  /** 中止信号：调用方放弃（超时、用户取消）时房间应当尽快停下。 */
  signal: AbortSignal
  /** 已经解析出来的仓库标识；给不出就省略。 */
  refId?: string
  /**
   * 路径运算。本地 Markdown 房里有多处直接读 `ctx.path`（与 `platform.path` 是同一套），
   * 所以这里必须有这一格，否则那些读取全部编译不过。
   */
  path?: BackendPlatform['path']
  /**
   * 从宿主上下文里取一件东西。房间里取沙箱文件服务的写法是
   * `typeof ctx.get === 'function' ? ctx.get('fs') : null`，所以这一格按「取文件服务」定形状：
   * 参数只认 `'fs'`（今天真实用到的只有这一个名字），返回文件服务或 null（取不到就说取不到）。
   */
  get?(name: 'fs'): SandboxFs | null
}

/**
 * 已补全的单次调用上下文：`OpContext` 加上「谁触发的」。
 * 为什么要另起一个形状，而不是给 `OpContext` 加一个可选的 `caller`：
 * 调用链里有两个补全点（探测服务的自动识别钩子、统一判定出口），它们在往下传之前
 * 一定会把 `caller` 写死（调用方给了就用调用方的，没给就填自己的名字）。补全点之后
 * `caller` 一定有，下游只许读不许改；补全点之前它可能还没有。前后是两种形状，
 * 写成两种类型，非法的样子（补全之后还没有 `caller`）就写不出来。
 */
export interface EnrichedOpContext extends OpContext {
  /**
   * 谁触发的这次调用（比如 `detection-service`、`comment-threads`）。
   * 只读：补全点写死之后，下游任何人不许再改——改了日志里的「由谁触发」就对不上真凶了。
   */
  readonly caller: string
}

/**
 * 探测输入（识别后端时给的那一点点线索）。
 * 界面**从不**手拼 `refId`：`refId` 由注册表的 describe 产出。
 */
export interface RepoHandle {
  /** 工作区目录；`matches` 只许读它（以及文件服务）。 */
  cwd?: string
  /** 已经解析好的仓库标识；给了就直接用。 */
  refId?: string
  /**
   * 本地 Markdown 后端里票所在的工作单元目录名；两个真实读者会读它并如实转发
   * （注册表视图与 Markdown 房）。今天没有生产者，是迁移这两处时必须补上的一格。
   */
  effortId?: string
  /**
   * 后端 id；Markdown 房读它来决定本地票仓在哪。
   * 同样是「有读者、今天没有生产者」的一格。
   */
  backend?: string
}
