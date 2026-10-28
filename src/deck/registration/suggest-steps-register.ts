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
import { sleepOnce } from '../shell/capped-wait.js'
import { withInFlightLease } from '../shell/in-flight-lease.js'
import { hash8 } from '../../refresh/contract/workspace-keys.js'

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

// ── 宿主日志兜底口（#1420 第四项） ──
//
// 为什么需要：agent-row 直接登记这颗工具时不传依赖袋，工具侧的 log 就是 null，真机上模型每次
// 调用 suggest_next_steps 一条 host.call 都不落。日志里于是分不清「模型根本没调」与「调了但
// 界面没拿到事件流」—— 这正是 #1412 关闭评论里记为「预期」、#1420 要求补上的区分能力。
//
// 兜底口不 import 宿主模块：宿主启动时已经把日志库挂在 globalThis 上（src/host/index.ts 的
// _log()，键见 HOST_LOG_SLOT），这里只按约定读那个格子。登记发生在启动早期，格子可能还没填、
// p 也可能没解析完，拿不到就安静丢弃：日志可缺，登记与工具执行不能受影响。

const HOST_LOG_SLOT = '__dsh_mattskillsdeck_host_log__'

/** 兜底口：每次 fire 时懒读全局格，解析出日志库后按它的开关决定记不记。 */
function hostLogBridge(): SuggestRegisterLogLike {
  return {
    fire: function (level: string, event: string, fields: UnknownRecord): void {
      try {
        const g = globalThis as unknown as UnknownRecord
        const slot = g[HOST_LOG_SLOT] as UnknownRecord | null | undefined
        const pending = slot && slot.p
        if (!pending || typeof (pending as Promise<unknown>).then !== 'function') return
        ;(pending as Promise<unknown>).then(function (store: unknown) {
          try {
            const s = (store || {}) as UnknownRecord
            if (typeof s.isEnabled !== 'function' || typeof s.log !== 'function') return
            if (!(s.isEnabled as (l: string, e: string) => boolean)(level, event)) return
            ;(s.log as (l: string, e: string, x: UnknownRecord) => void)(level, event, fields)
          } catch (eStore) { /* 记录失败只丢这一行 */ }
        }).catch(function () { /* 解析失败只丢这一行 */ })
      } catch (eBridge) { /* 全局格读不了就只丢这一行 */ }
    },
  }
}
const hostLogBridgeOnce = hostLogBridge()

/**
 * 依赖袋归一：显式给了 log（包括显式 null —— 测试靠它保持安静）就照用，没给 log 才接宿主
 * 兜底口。这样 refresh-runtime 那条显式传日志的路一行不变，agent-row 那条不传的路才多出轨迹。
 */
function resolveRegisterDeps(deps?: SuggestRegisterDeps): SuggestRegisterDeps {
  const d = (deps && typeof deps === 'object') ? deps : {}
  if (Object.prototype.hasOwnProperty.call(d, 'log')) return d
  return { log: hostLogBridgeOnce, now: d.now }
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
  // 读服务属性本身也要包住：Cordis 的上下文是代理，读一个没有 inject 的服务属性会直接抛
  // 「cannot get property "tools" without inject」，而不是回 undefined。取服务抛错与取不到同义，
  // 一律当缺席处理——这里不包住，异常会从 async 钩子的第一段逃出去，宿主加载期会把未处理的
  // rejected Promise 判成致命错误，真机启动直接退出码 1（#1406 补的启动期崩溃就出在这）。
  let direct: ToolsServiceLike | null | undefined
  try { direct = bag.tools as ToolsServiceLike | null | undefined } catch (e) { direct = null }
  if (direct && typeof direct.register === 'function') return direct
  let getter: unknown
  try { getter = bag.get } catch (e) { getter = null }
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
  const d = resolveRegisterDeps(deps)
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

/** 注册一次的附加开关：silent 只表示「调用方自己会记这一趟」，不改变注册结果。 */
export interface SuggestRegisterOptions {
  silent?: boolean
}

/**
 * 注册一次：服务不在、注册表拒绝、重名都折成 { registered:false, reason }，绝不抛。
 * 没传 log 时走宿主兜底口记一行登记结论 —— agent-row 那条路就是不传，真机上要能看出工具
 * 到底登记上没有。钩子那条路自己记「等了多久才登记上」，传 { silent: true } 免得同一趟记两行。
 */
export function registerSuggestNextSteps(toolsSvc: unknown, deps?: SuggestRegisterDeps, opts?: SuggestRegisterOptions): SuggestRegisterResult {
  const d = resolveRegisterDeps(deps)
  const silent = !!(opts && opts.silent === true)
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now
  const t0 = now()
  const service = toolsServiceOf({ tools: toolsSvc })
  if (!service) {
    if (!silent) fireRegisterLog(d.log || null, now() - t0, false, 'no-tools-service')
    return { registered: false, reason: 'no-tools-service' }
  }
  try {
    service.register(makeSuggestRegistration(d))
    if (!silent) fireRegisterLog(d.log || null, now() - t0, true, '')
    return { registered: true, reason: '' }
  } catch (e) {
    const message = String((e as Error && (e as Error).message) || e || '')
    if (!silent) fireRegisterLog(d.log || null, now() - t0, false, 'register-failed')
    return { registered: false, reason: 'register-failed:' + message }
  }
}

/** 等一会儿：只给登记重试用。定时器由 capped-wait 统一 unref 并在到点后清掉（#1114 第二批）。 */
function sleep(ms: number): Promise<void> {
  return sleepOnce(ms)
}

/**
 * 宿主接线用的登记钩子：先把工具服务等出来（行顺序不保证），再注册建议工具。
 * 成功与失败都落一行轨迹（传了日志才落）；绝不抛，也不阻塞调用方。
 * 整条「等工具服务再注册」的链扣着存活租约（#1534 复核结论）：中间几次等待都走 unref 的
 * sleepOnce，不拿租约时事件循环里只剩这笔等待，进程会在第一次等待里带着退出码 0 静默收摊，
 * 建议工具就永远不会登记 —— 等待定时器不拥有进程存活，有活在跑时显式拿租约（ADR 20261014）。
 */
export function hookSuggestNextSteps(ctx: unknown, deps?: SuggestRegisterDeps, opts?: { retries?: number; waitMs?: number }): Promise<SuggestRegisterResult> {
  const d = resolveRegisterDeps(deps)
  const o = (opts || {}) as UnknownRecord
  const retries = typeof o.retries === 'number' ? o.retries : SUGGEST_REGISTER_RETRIES
  const waitMs = typeof o.waitMs === 'number' ? o.waitMs : SUGGEST_REGISTER_WAIT_MS
  const t0 = typeof d.now === 'function' ? d.now() : Date.now()
  return withInFlightLease(async function (): Promise<SuggestRegisterResult> {
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
    const result = registerSuggestNextSteps(service, d, { silent: true })
    fireRegisterLog(d.log || null, now() - t0, result.registered, result.reason)
    return result
  })
}
