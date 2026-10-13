// src/deck/rules/tool-table.ts —— 把九个工具装成一张表 { name → { definition, run } }（纯规则侧）
//
// 本文件由 src/deck/shell/tool-table.ts 搬来并补上类型（#1039 按 #1038 定版：装表属纯侧）。
// 搬的时候行为一个字没改，只做两件事：把「工具工厂」与「工具」这两个形状写成接口，
// 以及把顺序常量的来路改为同目录的 tool-order.ts。
//
// 纯在哪：只调用传进来的工厂函数、把结果装进对象，不取会话、不起进程、不读写文件、不读钟。
// 工厂本身当然可以碰外面（它们是工具入口），但那是工厂的事 —— 这一件只负责装。
import { DECK_TOOL_ORDER } from './tool-order.js'

// 顺序常量跟着装表一起对外：调用方要的「表里的序」与「帮助里的序」是同一份，
// 从这里就能一起拿到，不必再去 import 另一个路径。
export { DECK_TOOL_ORDER }

/**
 * 一个工具的对外定义：名字、给模型看的那句话、以及参数表。
 * 参数表按对象收口，不细究里面每个字段（它本来就是 JSON Schema，形状很宽）；
 * 装表只需要 `name` 这一个字段来建索引，别的字段原样带给注册方。
 */
export interface DeckToolDefinition {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/** 一个装好的工具：定义 + 一次执行。 */
export interface DeckTool {
  definition: DeckToolDefinition
  run: (exec: unknown, args: Record<string, unknown>) => unknown
}

/**
 * 工具工厂：给依赖袋，回一个装好的工具。
 * 也可以直接给一个现成的工具对象（两种写法都认：`f(deps)` 的返回值与 `f` 自身都要判一次）。
 */
export type DeckToolFactory = ((deps: Record<string, unknown>) => unknown) | unknown

/** 装表的结果：索引、按顺序的名字、按顺序的定义，以及缺了哪几个。 */
export interface DeckToolTable {
  /** 名字 → 工具。没装起来的工具不在这里，也不给假的桩。 */
  tools: Record<string, DeckTool>
  /** 按装配顺序排的名字（只有真装起来的）。 */
  names: string[]
  /** 按装配顺序排的定义（注册行与帮助文本读它）。 */
  definitions: DeckToolDefinition[]
  /** 顺序里有、但这次没装起来的名字（如实报出来，不静默少一个）。 */
  missing: string[]
}

/**
 * 把九个工具装成一张表：{ name → { definition, run } }。
 * factories 是九个工具工厂的数组（由接线方 import 进来后传进去）；缺哪个就少哪个，
 * 缺的会被如实列在 returned.missing 里，不补一个假的桩 —— 工具要么真能用，要么不在表里。
 *
 * 一个工厂抛错不影响其它八个：装不起来的进 missing，剩下八个别跟着一起废掉。
 * 判定「装起来了」的判据是**形状**（有 definition.name 且 run 是函数），不是「没抛错」——
 * 工厂回了半个对象时，宁可少一个工具并如实报缺，也不要让交出去的 run 在调用时炸。
 */
export function createDeckTools(factories: readonly DeckToolFactory[], deps?: unknown): DeckToolTable {
  const d = (deps && typeof deps === 'object') ? deps as Record<string, unknown> : {}
  const built: Record<string, DeckTool> = {}
  const missing: string[] = []
  for (const f of (Array.isArray(factories) ? factories : [])) {
    try {
      const tool = (typeof f === 'function') ? f(d.toolDeps as Record<string, unknown> || {}) : f
      const t = (tool && typeof tool === 'object') ? tool as { definition?: DeckToolDefinition; run?: unknown } : null
      if (t && t.definition && typeof t.definition.name === 'string' && typeof t.run === 'function') {
        built[t.definition.name] = t as DeckTool
      }
    } catch (e) {
      // 一个工具装不起来不影响其它八个；缺谁由下面的 missing 说出来。
    }
  }
  const names = DECK_TOOL_ORDER.filter((n) => built[n])
  for (const n of DECK_TOOL_ORDER) if (!built[n]) missing.push(n)
  return { tools: built, names: names, definitions: names.map((n) => built[n].definition), missing: missing }
}
