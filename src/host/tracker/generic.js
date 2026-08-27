/**
 * tracker/generic.js — 宿主侧通用检查目录实现（#226）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 目标：host 侧通用检查目录（规约 D6 通用部分 + D7 c7-c9 技能探测等）：谓词原语注册表 + 通用目录实现。
 * 范围：
 *  - 谓词原语注册表（fs/exec/gh/技能探测等宿主可知的原语，供检查项 check 引用，全部只读探测）—— 复用 predicateRegistry 的 primitive 执行器；
 *  - 通用目录：技能套件探测（c7-c9 迁移）、setup 已执行等后端无关检查项迁入（c2 所在开门链步骤）；目录产物进入检查链视图；无 na 承载字段（2026-08-27 已删）。
 * 验收：
 *  - 通用目录在任意后端下输出一致；
 *  - 谓词只读、失败返回而非抛；注册表验形状不验内容（与 tracker registry 哲学一致）。
 * 边界：不做 github/glab 专属项（后端目录另票 #227）。
 */

import { GENERIC_CATALOG, GENERIC_CHECK_ITEMS, GENERIC_GATE_CHAIN, GENERIC_ENV_CHAIN, GENERIC_CHAIN, catalogFor, catalogItemToCheckItem } from '../../shared/tracker/check-catalog.js'
import { validateCheckItem, validateChain, evaluateChain, CHECK_STATE } from '../../shared/tracker/chain.js'
import { createPredicateRegistry, toPredicateResults } from './predicateRegistry.js'

// 版本标识（供日志/审计；与 CATALOG_VERSION / CHAIN_VERSION 同步）
export const GENERIC_VERSION = 1

/**
 * 通用目录谓词注册（#226）。
 * 在给定 predicateRegistry 上注册通用目录所需的 backend 类谓词（selection:backendSelected）。
 * 全部只读：仅读 ctx.backendId / ctx.selection，不写任何文件/环境。
 * @param {ReturnType<typeof createPredicateRegistry>} registry
 */
export function registerGenericPredicates(registry) {
  if (!registry || typeof registry.register !== 'function') throw new Error('registry must be createPredicateRegistry() instance')
  // selection:backendSelected — 通用开门链首步（是否已选后端），真值不随 backendId 改变？实际随 selection 改变但属于通用脱离后端门槛
  // 判据：ctx.backendId != null 或 ctx.selection.backendId != null 或 ctx.cwd 已有 explicitBackendId
  // 只读：仅读取 ctx 状态，不执行副作用。
  const selKey = 'backendSelected'
  const keys = ['backend:*:' + selKey, selKey, 'backend:generic:' + selKey]
  for (const k of keys) {
    if (registry.has && registry.has(k)) continue
    try {
      registry.register(k, async (check, ctx) => {
        try {
          const bid = (ctx && (ctx.backendId || (ctx.selection && ctx.selection.backendId))) || null
          const explicit = ctx && ctx.explicitBackendId
          // 优先 explicit 声明，其次 backendId 存在性
          if (explicit && typeof explicit === 'string' && explicit) return { status: 'pass', detail: 'explicit:' + explicit }
          if (bid && typeof bid === 'string' && bid) return { status: 'pass', detail: 'backend:' + bid }
          // 回退：检查 cwd 下 docs/agents/issue-tracker.md 是否声明后端（仅读，不抛）
          // 交由 tracker:initialized 覆盖，此处仅判 backendSelected
          return { status: 'fail', detail: 'no backend selected' }
        } catch (e) {
          // 失败返回而非抛（#226 验收）
          return { status: 'pending', detail: String((e && e.message) || e).slice(0, 400) }
        }
      })
      break // 注册首个 key 成功即可
    } catch (e) {
      // duplicate 已有则忽略，保形状校验哲学
      if (String(e && e.message).includes('duplicate')) break
      throw e
    }
  }
}

/**
 * 获取通用目录（任意后端下输出一致，#226 验收）。
 * @param {'github'|'markdown'|'gitlab'|null} _backendId 忽略，仅为接口一致；通用目录不随它改变
 * @returns {import('../../shared/tracker/check-catalog.js').CatalogItem[]}
 */
export function getGenericCatalog(_backendId = null) {
  return [...GENERIC_CATALOG]
}

/**
 * 获取通用链（门/环境分段已就绪，可直接喂 evaluateChain）。
 * @param {'gate'|'env'|'all'} kind
 * @returns {import('../../shared/tracker/chain.js').CheckItem[]}
 */
export function getGenericChain(kind = 'all') {
  if (kind === 'gate') return [...GENERIC_GATE_CHAIN]
  if (kind === 'env') return [...GENERIC_ENV_CHAIN]
  return [...GENERIC_CHAIN]
}

/**
 * 通用检查形状校验（验形状不验内容，与 registry 同哲学）。
 * @param {import('../../shared/tracker/chain.js').CheckItem[]} chain
 * @returns {string[]} errors
 */
export function validateGenericChain(chain) {
  return validateChain(chain)
}

/**
 * 解析通用链（只读探测 + 超时按 pending，#226）。
 * @param {ReturnType<typeof createPredicateRegistry>} registry 已注册通用谓词的 registry
 * @param {import('./predicateRegistry.js').PredicateContext} ctx
 * @param {'gate'|'env'|'all'} kind
 * @returns {Promise<{chain: import('../../shared/tracker/chain.js').CheckItem[], resolved: Record<string, import('./predicateRegistry.js').PredicateResult>, snapshot: import('../../shared/tracker/chain.js').ChainSnapshot}>}
 */
export async function resolveGenericChain(registry, ctx, kind = 'all') {
  const chain = getGenericChain(kind)
  const resolved = await registry.resolveAll(chain, ctx)
  const predicateResults = toPredicateResults(resolved)
  const snapshot = evaluateChain(chain, predicateResults)
  return { chain, resolved, snapshot }
}

/**
 * 断言通用目录在任意后端下输出一致（供测试/门禁调用）。
 * @returns {{ok: boolean, detail: string}}
 */
export function assertGenericConsistent() {
  const a = catalogFor(null).filter(c => c.scope === 'generic').map(c => c.id).sort().join(',')
  const b = catalogFor('github').filter(c => c.scope === 'generic').map(c => c.id).sort().join(',')
  const c = catalogFor('markdown').filter(c => c.scope === 'generic').map(c => c.id).sort().join(',')
  const d = catalogFor('gitlab').filter(c => c.scope === 'generic').map(c => c.id).sort().join(',')
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
