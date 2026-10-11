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
 * 进程级能力（房间 create 时注入一次；宿主构建单例）。
 * 房间**不许**直接 `import node:fs` 或直接用全局 `fetch`：文件读写走 `fs`（受沙箱约束）、
 * 起进程走 `exec`（受闸记账）、定时器走 `timers`（测试要能替换假时钟）。
 */
export interface BackendContext {
  /** 平台抽象实例（已按当前操作系统解析好的那一个，不是工厂）。 */
  platform: unknown
  /** 沙箱文件服务（受栅栏约束，不能绕过它直连 node:fs）。 */
  fs: unknown
  /**
   * 起一个进程并等它结束。
   * 真实实现在宿主侧，会把每一笔出站报给闸记账；返回三件套而不是抛异常。
   */
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeout?: number; signal?: AbortSignal },
  ) => Promise<{ stdout: string; stderr: string; code: number }>
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
}
