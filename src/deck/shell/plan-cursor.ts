// src/deck/shell/plan-cursor.ts —— 批量建图的续跑游标（#895；#1040 转 TypeScript）
//
// 为什么有这个文件：批量建图是多步写，任何一步之后都可能超时。游标记下
// “地图票号、已建子票、已建边”，同计划标识重跑时跳过已建。幂等锚（票正文
// 里那一行）永远是权威——游标只是加速器，对不上时以锚与读回为准。
// 落盘形态：一个工作区一个目录，一个计划一个小 JSON；成功即删、过期即清。
// 接口全异步（load/save/remove 皆回 Promise），内存与落盘同一套形状。
// 住共享层（src/deck/shell/）、零导入（同层禁互引）：读写文件的本事由调用方以 io 传进来。
// 日志：静默持久化，不新增事件名（成败 already 体现在工具回执里）。

// 有效期住中央 YAML，调时间改 config/ttl.yaml。
import { PLAN_CURSOR_TTL_MS } from '../../shared/time-config/values.js'

/** 未知形状的入参统一按这张表逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>;

/**
 * 游标状态：本文件只认一个字段——updatedAt（判过期用）；其余字段原样存取，
 * 里面究竟记了哪些票、哪些边，由建图那个调用方决定，本文件不替它定结构。
 */
export interface PlanCursorState {
  updatedAt?: number;
  [key: string]: unknown;
}

/**
 * 游标存储：三种能力全异步。durable 如实说明这份状态是不是真落盘了（内存形态为假）。
 * 状态那一格是类型参数：游标里装什么（地图票号、已建子票、已落的边……）由建图那个调用方定，
 * 本文件不替它建模。调用方要更精确的形状，就在建存储器时把自己的状态类型传进来
 * （createFilePlanStore<自己的状态类型>({…})）；不传就用本文件这份宽松形状。
 */
export interface PlanStore<T = PlanCursorState> {
  durable: boolean;
  load(planId: unknown): Promise<T | null>;
  save(planId: unknown, state: T): Promise<void>;
  remove(planId: unknown): Promise<void>;
}

/** 落盘本事由调用方给：本文件零导入，不碰 node:fs。读不到文件时 readText 抛错或回空都按“没有”处理。 */
export interface PlanStoreIo {
  readText?(path: string): Promise<unknown> | unknown;
  writeText?(path: string, text: string): Promise<unknown> | unknown;
  mkdir?(path: string): Promise<unknown> | unknown;
}

/** 落盘形态的入参：io 缺席或不成形就退化成内存形态，dir 缺席同理。 */
export interface PlanStoreOpts {
  io?: PlanStoreIo;
  dir?: unknown;
  /** 工作区键：只用来隔离文件名，不落原始路径。 */
  workspaceKey?: unknown;
  /** 取时间（毫秒）：缺席用 Date.now；测试可注入假时钟。 */
  now?: () => number;
  /** 过期毫秒数：缺席 7 天。 */
  ttlMs?: unknown;
}

function hash8(t: unknown): string {
  let h = 5381
  const s = String(t || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/** 文件名白名单：非字母数字与下划线连字符的字符一律换成下划线，最长 80 字符，空则回 'plan'。 */
function safeName(s: unknown): string { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'plan' }

/** 数字兜底：不是有限数就用缺省值（NaN、字符串、undefined 全走这一条）。 */
function num(v: unknown, d: number): number { const n = (typeof v === 'number' && isFinite(v)) ? v : NaN; return isNaN(n) ? d : n }

/** 进程内存形态（宿主没给落盘能力时的退路；返回值里如实说 durable:false）。 */
export function createMemoryPlanStore<T = PlanCursorState>(): PlanStore<T> {
  const table = new Map<string, T>()
  return {
    durable: false,
    load: async function (planId: unknown) { return table.get(String(planId)) || null },
    save: async function (planId: unknown, state: T) { table.set(String(planId), state) },
    remove: async function (planId: unknown) { table.delete(String(planId)) },
  }
}

/**
 * 计划游标的落盘目录：工作区根下的 .dsh-mattskillsdeck-cache/deck-plans。
 * 目录约定与文件名约定（下面 fileOf 里那一份）同住本文件：宿主接线（注入存储器的那一路）与工具自建 IO
 * 那一路都用它，免得同一个约定在两地各写一遍、以后改一处漏一处。
 * join 由调用方给（宿主平台的 path.join；不给就按 `/` 拼），宿主换平台分隔符也跟着走。
 * 注意：本目录不用谁去建，父目录由宿主文件服务的 writeText 递归创建（docs/cache-and-diagnostics.md 第 7.1 节）。
 */
export function planCursorDir(cwd: unknown, join?: unknown): string {
  const j = (typeof join === 'function') ? (join as (a: string, b: string) => string)
    : function (a: string, b: string) { return a + '/' + b }
  const base = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
  return j(j(base, '.dsh-mattskillsdeck-cache'), 'deck-plans')
}

/**
 * 落盘形态。io：{ readText(path), writeText(path, text), mkdir(path) }，
 * 读不到文件时 readText 应抛错或回空（都按“没有”处理）；缺任一即退化成内存形态。
 * dir：目录；workspaceKey：工作区键（隔离文件名）；now：取时间；ttlMs：过期毫秒数。
 * 读到坏 JSON 按没有处理（锚权威兜底）；写失败吞掉（内存里那份还在）。
 * 删游标用「写空文件」而不是删文件：跨平台的删文件在部分环境会抛，而空内容读回来就是“没有”。
 */
export function createFilePlanStore<T = PlanCursorState>(opt?: PlanStoreOpts): PlanStore<T> {
  const o = opt || {}
  const io = o.io || {}
  const dir = String(o.dir || '')
  const ws = String(o.workspaceKey || 'ws')
  const nowFn = (typeof o.now === 'function') ? o.now : Date.now
  const ttl = num(o.ttlMs, PLAN_CURSOR_TTL_MS)
  const mem = createMemoryPlanStore<T>()
  // 三样本事先取成局部常量：后面闭包里直接调，不用再对 io 做一遍存在性判断。
  const readText = io.readText
  const writeText = io.writeText
  const mkdir = io.mkdir
  const canDisk = !!dir && typeof readText === 'function' && typeof writeText === 'function'
  if (!canDisk) return mem
  function fileOf(planId: unknown): string { return dir + '/deck-plan-' + safeName(ws) + '-' + safeName(planId) + '.json' }
  async function mkdirBestEffort(): Promise<void> {
    try { if (typeof mkdir === 'function') await mkdir(dir) } catch (e) {}
  }
  /** 过期判定：没有 updatedAt（0）视为不过期（老版本写的游标不能被判死）；超龄回 null。 */
  function fresh(state: unknown): T | null {
    if (!state || typeof state !== 'object') return null
    const at = num((state as PlanCursorState).updatedAt, 0)
    if (at > 0 && (nowFn() - at) > ttl) return null
    return state as T
  }
  return {
    durable: true,
    load: async function (planId: unknown) {
      let text: unknown = null
      try { text = await readText!(fileOf(planId)) } catch (e) { return mem.load(planId) }
      if (text === null || text === undefined || text === '') return mem.load(planId)
      try { return fresh(JSON.parse(String(text))) } catch (e) { return mem.load(planId) }
    },
    save: async function (planId: unknown, state: T) {
      const stamped = Object.assign({}, state, { updatedAt: nowFn() })
      await mem.save(planId, stamped)
      try {
        await mkdirBestEffort()
        await writeText!(fileOf(planId), JSON.stringify(stamped))
      } catch (e) {}
    },
    remove: async function (planId: unknown) {
      await mem.remove(planId)
      try {
        await mkdirBestEffort()
        await writeText!(fileOf(planId), '')
      } catch (e) {}
    },
  }
}

/** 短指纹（工作区隔离文件名用，不记原始路径，脱敏口径与日志一致）。 */
export function workspaceFingerprint(s: unknown): string { return hash8(String(s || '')) }
