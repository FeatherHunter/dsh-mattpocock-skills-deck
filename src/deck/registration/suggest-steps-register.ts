// src/deck/registration/suggest-steps-register.ts —— suggest_next_steps 的独立登记（#1406）
//
// 为什么单独一份：九颗 deck_* 追踪器工具的登记走 register-options.ts 的批量注册，
// 那条批量入口只认宿主装配表里的九个名字（表按 DECK_TOOL_ORDER 过滤）。建议工具不属于追踪器，
// 不进那张表，所以在这里单独造一份注册数据、单独注册 —— 写法照 deck_probe 的先例
// （agent-row.ts 在九个之外单独注册探针）。区别是建议工具的执行在本进程里完成，不经过
// deckExec 代执行通道：那条通道按 DECK_TOOL_ORDER 认名字，不在表里的名字会被直接拒掉。
//
// 登记失败不抛：工具服务可能比行模块晚就绪（行顺序不保证），调用方传了日志就落一行失败轨迹，
// 不传就安静放过 —— 这颗工具是锦上添花，登记不上不能拖垮整行。

import { AGENT_TOOL_TIMEOUT_MS, deckAgentOutputSchemaRaw } from './register-options.js'
import { createSuggestNextSteps, definition } from '../tools/suggest-next-steps.js'
import { REGISTER_RETRY_WAIT_MS } from '../../shared/time-config/src/values.js'
import { hash8 } from '../../shared/refresh-workspace-key.js'

/** 外层递进来的东西（工具服务、上下文、日志）形状都不由本文件定，逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>

/** 日志口：只要求 fire 一格（与宿主日志上下文同形）。 */
export interface SuggestRegisterLogLike {
  fire?: (level: string, event: string, fields: UnknownRecord) => void
}
/** 登记入口的依赖袋：log 可选（宿主接线会传），now 只给测试换假时钟。 */
export interface SuggestRegisterDeps {
  log?: SuggestRegisterLogLike | null
  now?: () => number
}

/** 工具服务的窄形状：只需要 register 一格（返回注销函数，本文件不关心）。 */
interface ToolsServiceLike {
  register: (tool: UnknownRecord) => unknown
}
/** 登记结果：registered 为假时 reason 是机器码，不抛错、不编故事。 */
export interface SuggestRegisterResult {
  registered: boolean
  reason: string
}

/** 注册重试的缺省节奏：与九工具登记钩子同一份（中央 YAML 是唯一真源）。 */
export const SUGGEST_REGISTER_RETRIES = 5
export const SUGGEST_REGISTER_WAIT_MS = REGISTER_RETRY_WAIT_MS

/** 工具服务从上下文里取：行模块与宿主接线两处上下文形状不同，两个格子都认。 */
function toolsServiceOf(ctx: unknown): ToolsServiceLike | null {
  const bag = (ctx && typeof ctx === 'object') ? ctx as UnknownRecord : {}
  const direct = bag.tools as ToolsServiceLike | null | undefined
  if (direct && typeof direct.register === 'function') return direct
  const getter = bag.get
  if (typeof getter === 'function') {
    try {
      const viaGet = (getter as (name: string) => unknown)('tools') as ToolsServiceLike | null | undefined
      if (viaGet && typeof viaGet.register === 'function') return viaGet
    } catch (e) { /* 取服务抛错与取不到同义：当缺席处理 */ }
  }
  return null
}

/** 落一行登记轨迹：成功 info host.call，失败 warn host.call.fail，字段全在既有白名单里。 */
function fireRegisterLog(log: SuggestRegisterLogLike | null, latencyMs: number, ok: boolean, reason: string): void {
  try {
    if (!log || typeof log.fire !== 'function') return
    const method = definition.name + '.register'
    if (ok) {
      log.fire('info', 'host.call', { method: method, latencyMs: latencyMs, ok: true, kind: 'deck-tool' })
      return
    }
    log.fire('warn', 'host.call.fail', {
      method: method,
      kind: 'deck-tool',
      errorHash: hash8(reason || 'unknown'),
      errorKind: /no-tools-service|no-context/.test(reason) ? 'missing-dep' : 'throw',
    })
  } catch (e) { /* 日志坏了不影响登记 */ }
}

/**
 * 造一份可交给工具服务注册的数据：名字、描述、参数模式直接取工具定义，输出模式用九工具
 * 同一份退路形状（原生模式受支持子集），执行函数调本进程里的 run 并兜底永不抛。
 */
export function makeSuggestRegistration(deps?: SuggestRegisterDeps): UnknownRecord {
  const d = (deps || {}) as SuggestRegisterDeps
  const runner = createSuggestNextSteps({ log: d.log || null, now: d.now })
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    timeoutMs: AGENT_TOOL_TIMEOUT_MS,
    output: deckAgentOutputSchemaRaw(),
    execute: async function (args: unknown, exec: unknown): Promise<UnknownRecord> {
      try {
        return await runner.run(exec, args)
      } catch (e) {
        return {
          ok: false,
          status: 'unsupported',
          tool: definition.name,
          reason: 'bad-args',
          text: '这颗工具没给出回执，本回合的建议记不下来：请重调一次。',
        }
      }
    },
  }
}

/** 注册一次：服务不在、注册表拒绝、重名都折成 { registered:false, reason }，绝不抛。 */
export function registerSuggestNextSteps(toolsSvc: unknown, deps?: SuggestRegisterDeps): SuggestRegisterResult {
  const service = toolsServiceOf({ tools: toolsSvc })
  if (!service) return { registered: false, reason: 'no-tools-service' }
  try {
    service.register(makeSuggestRegistration(deps))
    return { registered: true, reason: '' }
  } catch (e) {
    const message = String((e as Error && (e as Error).message) || e || '')
    return { registered: false, reason: 'register-failed:' + message }
  }
}

/** 等一会儿：只给登记重试用，缺省真定时器。 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>(function (resolve) { setTimeout(resolve, ms) })
}

/**
 * 宿主接线用的登记钩子：先把工具服务等出来（行顺序不保证），再注册建议工具。
 * 成功与失败都落一行轨迹（传了日志才落）；绝不抛，也不阻塞调用方。
 */
export async function hookSuggestNextSteps(ctx: unknown, deps?: SuggestRegisterDeps, opts?: { retries?: number; waitMs?: number }): Promise<SuggestRegisterResult> {
  const d = (deps || {}) as SuggestRegisterDeps
  const o = (opts || {}) as UnknownRecord
  const retries = typeof o.retries === 'number' ? o.retries : SUGGEST_REGISTER_RETRIES
  const waitMs = typeof o.waitMs === 'number' ? o.waitMs : SUGGEST_REGISTER_WAIT_MS
  const t0 = typeof d.now === 'function' ? d.now() : Date.now()
  let service: ToolsServiceLike | null = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    service = toolsServiceOf(ctx)
    if (service) break
    if (attempt < retries) await sleep(waitMs)
  }
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now
  if (!service) {
    fireRegisterLog(d.log || null, now() - t0, false, 'no-tools-service')
    return { registered: false, reason: 'no-tools-service' }
  }
  const result = registerSuggestNextSteps(service, d)
  fireRegisterLog(d.log || null, now() - t0, result.registered, result.reason)
  return result
}
