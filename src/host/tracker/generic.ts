// src/host/tracker/generic.ts —— 从同目录 generic.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：通用检查目录是宿主检查链的入口之一，转成 TypeScript 后调用方
//   （src/host/detectChain.ts 经动态导入取 registerGenericPredicates 与 resolveGenericChain）能按类型取用，
//   行为仍与原来逐行一致。
// 什么约定不能改：
//   1. 通用目录在任意后端下输出一致，谓词只读、失败返回而非抛出，注册表只验形状不验内容。
//   2. 注册键的优先顺序与“首个成功即停”保持原样，重复键直接跳过，不抛错。
//   3. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mjs 改指同名 .ts，本文件不改说明符。
//   4. 只写可剥离类型：类型一律经 import type 引入，运行时导入与原来完全相同，不新增任何运行时边。

import { GENERIC_CATALOG, catalogFor } from '../../shared/tracker/check-catalog-dirs.js'
import { GENERIC_CHECK_ITEMS, GENERIC_GATE_CHAIN, GENERIC_ENV_CHAIN, GENERIC_CHAIN, catalogItemToCheckItem } from '../../shared/tracker/check-catalog-views.js'
import { CHECK_STATE } from '../../shared/tracker/chain-types.js'
import { validateCheckItem, validateChain } from '../../shared/tracker/chain-validate.js'
import { evaluateChain } from '../../shared/tracker/chain-evaluate.js'
import { createPredicateRegistry, toPredicateResults } from './predicateCore.js' // V1 #461：predicateRegistry.js 已拆为两块，装配入口为 predicateCore.js

// 类型只做编译期约束，不产生运行时引用：目录与链的形状以共享层为准，谓词上下文以装配入口为准。
import type { Check, CheckItem } from '../../shared/tracker/chain-types.js'
// 谓词语境与结果经 predicateCore 中转（本文件本来就运行时依赖它），不直连 predicatePrimitives——
//   同层规则把 import type 也算一条边，直连会新增一条真源边；走装配入口则边数零增长。
import type { PredicateContext, PredicateResult } from './predicateCore.js'

// 目录项形状以运行时值的元素类型为准：check-catalog-dirs.ts 把 CatalogItem 记成文件内类型、没有导出，
// 这里不另起新边，直接从已导入的运行时值 GENERIC_CATALOG 取元素类型，运行时取值形状与原来完全一致。
type CatalogItem = typeof GENERIC_CATALOG[number]

// 版本标识（供日志/审计；与 CATALOG_VERSION / CHAIN_VERSION 同步）
export const GENERIC_VERSION = 1

// 注册表与谓词函数的类型：以装配入口的返回值为准，调用方按这一格读写，不另造形状。
type PredicateRegistry = ReturnType<typeof createPredicateRegistry>

// 通用谓词回调实际读到的上下文：在契约上下文之上多带三格可选字段。
// 为什么在这里另声明：真源 PredicateContext 只含平台、后端、工作区等契约字段，宿主在契约之外多喂了
//   选择结论、显式声明与语言三格；本文件只读这三格，缺省按没有处理，运行时取值形状与原来完全一致。
interface GenericPredicateContext extends PredicateContext {
  selection?: { backendId?: string | null } | null
  explicitBackendId?: string | null
  lang?: string
}

// 链分段口径：只认开门、环境与全部三档，不传按全部。
type GenericChainKind = 'gate' | 'env' | 'all'

// 通用目录谓词注册（#226）。
// 在给定 predicateRegistry 上注册通用目录所需的 backend 类谓词（selection:backendSelected）。
// 全部只读：仅读 ctx.backendId / ctx.selection，不写任何文件/环境。
export function registerGenericPredicates(registry: PredicateRegistry): void {
  if (!registry || typeof registry.register !== 'function') throw new Error('registry must be createPredicateRegistry() instance')
  // selection:backendSelected — 通用开门链首步（是否已选后端），真值不随 backendId 改变？实际随 selection 改变但属于通用脱离后端门槛
  // 判据：ctx.backendId != null 或 ctx.selection.backendId != null 或 ctx.cwd 已有 explicitBackendId
  // 只读：仅读取 ctx 状态，不执行副作用。
  const selKey = 'backendSelected'
  const keys: string[] = ['backend:*:' + selKey, selKey, 'backend:generic:' + selKey]
  for (const k of keys) {
    if (registry.has && registry.has(k)) continue
    try {
      registry.register(k, async (check: Check, ctx: PredicateContext): Promise<PredicateResult> => {
        try {
          // 回调签名按契约收，宿主多喂的三格经本地扩展接口读取，运行时仍按原样逐格取值。
          const ext = ctx as GenericPredicateContext
          const bid = (ctx && (ctx.backendId || (ext.selection && ext.selection.backendId))) || null
          const explicit = ext && ext.explicitBackendId
          // 优先 explicit 声明，其次 backendId 存在性
          if (explicit && typeof explicit === 'string' && explicit) return { status: 'pass', detail: 'explicit:' + explicit }
          if (bid && typeof bid === 'string' && bid) return { status: 'pass', detail: 'backend:' + bid }
          // 回退：检查 cwd 下 docs/agents/issue-tracker.md 是否声明后端（仅读，不抛）
          // 交由 tracker:initialized 覆盖，此处仅判 backendSelected
          return { status: 'fail', detail: 'no backend selected' }
        } catch (e) {
          // 失败返回而非抛（#226 验收）
          const caught = e as { message?: unknown } | null | undefined
          return { status: 'pending', detail: String((caught && caught.message) || e).slice(0, 400) }
        }
      })
      break // 注册首个 key 成功即可
    } catch (e) {
      // duplicate 已有则忽略，保形状校验哲学
      const caught = e as { message?: unknown } | null | undefined
      if (String(caught && caught.message).includes('duplicate')) break
      throw e
    }
  }
}

// 获取通用目录（任意后端下输出一致，#226 验收）。
// 入参忽略，仅为接口一致；通用目录不随它改变。
export function getGenericCatalog(_backendId: 'github' | 'markdown' | 'gitlab' | null = null): CatalogItem[] {
  return [...GENERIC_CATALOG]
}

// 获取通用链（门/环境分段已就绪，可直接喂 evaluateChain）。
export function getGenericChain(kind: GenericChainKind = 'all'): CheckItem[] {
  if (kind === 'gate') return [...GENERIC_GATE_CHAIN]
  if (kind === 'env') return [...GENERIC_ENV_CHAIN]
  return [...GENERIC_CHAIN]
}

// 通用检查形状校验（验形状不验内容，与 registry 同哲学）。
export function validateGenericChain(chain: CheckItem[]): string[] {
  return validateChain(chain)
}

// 解析通用链（只读探测 + 超时按 pending，#226）。
// V1 #461：类型定义随 predicatePrimitives.js 搬出，本文件经装配入口（predicateCore 中转）取用同一真源。
export async function resolveGenericChain(
  registry: PredicateRegistry,
  ctx: PredicateContext,
  kind: GenericChainKind = 'all',
): Promise<{ chain: CheckItem[]; resolved: Record<string, PredicateResult>; snapshot: ReturnType<typeof evaluateChain> }> {
  const chain = getGenericChain(kind)
  const resolved = await registry.resolveAll(chain, ctx)
  const predicateResults = toPredicateResults(resolved)
  const snapshot = evaluateChain(chain, predicateResults)
  return { chain, resolved, snapshot }
}

// 断言通用目录在任意后端下输出一致（供测试/门禁调用）。
export function assertGenericConsistent(): { ok: boolean; detail: string } {
  const a = catalogFor(null).filter((c) => c.scope === 'generic').map((c) => c.id).sort().join(',')
  const b = catalogFor('github').filter((c) => c.scope === 'generic').map((c) => c.id).sort().join(',')
  const c = catalogFor('markdown').filter((c) => c.scope === 'generic').map((c) => c.id).sort().join(',')
  const d = catalogFor('gitlab').filter((c) => c.scope === 'generic').map((c) => c.id).sort().join(',')
  const ok = a === b && b === c && c === d
  return {
    ok,
    detail: ok ? 'generic catalog consistent: ' + a : 'inconsistent: null=[' + a + '] github=[' + b + '] markdown=[' + c + '] gitlab=[' + d + ']',
  }
}

// 对外：目录产物进入检查链视图 — 导出 ChainSnapshot 相关工具
export { evaluateChain, CHECK_STATE, validateCheckItem, validateChain, toPredicateResults, catalogItemToCheckItem }

export const GENERIC_EXPORTS = Object.freeze({
  version: GENERIC_VERSION,
  catalog: GENERIC_CATALOG,
  gateChain: GENERIC_GATE_CHAIN,
  envChain: GENERIC_ENV_CHAIN,
  allChain: GENERIC_CHAIN,
})
