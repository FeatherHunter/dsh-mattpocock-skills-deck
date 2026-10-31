/**
 * src/tracker/rooms/github/routing/runtime-capability.ts —— 企业版主机上的运行时能力回答（#1698）
 *
 * 为什么要有这一层：企业版（GHES）与 github.com 的读接口不一样，而且差别随版本走——
 * 子票接口（父票/子票树）只在 github.com 提供；依赖边端点从企业版 3.19 才有。
 * 只凭主机名猜「支持/不支持」会猜错（老版本 3.19 前没有依赖端点），所以先探测服务端版本
 * （`gh api meta` 的 installed_version），再按版本与接口事实回答。
 *
 * 三条纪律：
 * 1. github.com 零探测：它没有版本差异，不为回答多打一次请求；
 * 2. 探测失败就不回答（返回 null），绝不回答「支持」——不知道就说不知道；
 * 3. 调用成功时不挂「不支持」：调用即知优先，成功了自己说「不支持」会自相矛盾（见 attachRuntimeAnswer）。
 *
 * 本文件不 import 任何构建期的能力登记数据：那张表是给人看的账，
 * 拿它冒充运行时事实正是这张票要消掉的毛病（门禁 verify-ghes-runtime-capability 的 G1 守这一条）。
 */

import type { OpContext } from '../../../contract/contexts.js'
import type {
  RuntimeCapabilityAnswer,
  RuntimeCapabilityOperation,
  RuntimeServerProbe,
} from '../../../contract/runtime-capability.js'
import { ghClient } from '../transport/client.js'
// 探测走 REST 读档（30 秒），与其它 REST 读同一档，慢网下不被房内 12 秒读档砍断。
import { GITHUB_REST_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import { isGheHostName, pickFallbackReason, readGhHost } from './fallback-reason.js'

/** 企业版从 3.19 起才有依赖边 REST 端点（调研 research/rest-graphql-read-parity-2026-10-30.md）。 */
const GHES_DEPENDENCIES_SINCE_MAJOR = 3
const GHES_DEPENDENCIES_SINCE_MINOR = 19
/** 这两条能力缺口都记在规格 #1681 下（票面「已知缺口」一节）。 */
const CAPABILITY_TICKET = '#1681'

/** 从上下文读一个环境变量：平台环境口优先，再退回历史遗留的顶层 env 口（与 fallback-reason.ts 同一套读法）。 */
function envOf (ctx: any, name: string): string {
  try {
    const env = ctx && ctx.platform && ctx.platform.env && typeof ctx.platform.env.get === 'function' ? ctx.platform.env : null
    const v = env ? String(env.get(name) || '') : ''
    if (v) return v
  } catch {}
  try {
    if (ctx && ctx.env && typeof ctx.env.get === 'function') {
      const v2 = String(ctx.env.get(name) || '')
      if (v2) return v2
    }
  } catch {}
  return ''
}

/**
 * 这次读操作是不是在企业版主机上（决定要不要探测）。
 *
 * 三条证据任一条成立就算：GH_HOST 指向非 github.com 的主机；配了 GH_ENTERPRISE_TOKEN（环境本身就是企业版口径）；
 * 失败原文里认出企业版（GH_HOST 没设、但服务端自己说了它是企业版）。
 */
export function looksEnterprise (ctx: OpContext, failureText?: string): boolean {
  try {
    if (isGheHostName(readGhHost(ctx))) return true
    if (envOf(ctx, 'GH_ENTERPRISE_TOKEN')) return true
    const text = String(failureText || '')
    if (text && pickFallbackReason({ message: text }, ctx) === 'ghe-host') return true
  } catch {}
  return false
}

/** 把版本原文（如 '3.18.4'）读成主次版本号；读不出就回 null（读不出按未知处理，不猜）。 */
function versionOf (raw: unknown): { major: number; minor: number } | null {
  const m = String(raw == null ? '' : raw).match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

/** 这个企业版版本有没有依赖边端点：3.19 起有。版本读不出时回 null（未知）。 */
function hasDependencyEndpoint (serverVersion: string | null): boolean | null {
  const v = versionOf(serverVersion)
  if (!v) return null
  if (v.major !== GHES_DEPENDENCIES_SINCE_MAJOR) return v.major > GHES_DEPENDENCIES_SINCE_MAJOR
  return v.minor >= GHES_DEPENDENCIES_SINCE_MINOR
}

/**
 * 探测眼前这台服务端：`gh api meta` 回包里有 installed_version 就是企业版（并带回版本原文），
 * 没有这一格就是 github.com；请求失败或回包读不懂就是「没认出来」，如实带原因。
 */
export async function probeRuntimeServer (ctx: OpContext): Promise<RuntimeServerProbe> {
  const probedAtMs = Date.now()
  const failed = (reason: string): RuntimeServerProbe => ({ ok: false, hostKind: 'unknown', serverVersion: null, probedAtMs: probedAtMs, reason: reason })
  try {
    const r: any = await ghClient(ctx).execGh(['api', 'meta'], { cwd: ctx && ctx.cwd, via: 'repo.meta', timeout: GITHUB_REST_READ_TIMEOUT_MS })
    if (!r || r.ok !== true) {
      const msg = r && r.error && (r.error.message || r.error.raw) ? String(r.error.message || r.error.raw) : '没有回包'
      return failed('探测服务端版本失败：' + msg.slice(0, 300))
    }
    let j: any = null
    try { j = JSON.parse((r.data && r.data.stdout) || '') } catch {}
    if (!j || typeof j !== 'object') return failed('探测服务端版本失败：回包不是能读的 JSON 对象')
    const version = (j as any).installed_version
    if (typeof version === 'string' && version.trim()) {
      return { ok: true, hostKind: 'ghes', serverVersion: version.trim(), probedAtMs: probedAtMs, reason: '' }
    }
    return { ok: true, hostKind: 'github.com', serverVersion: null, probedAtMs: probedAtMs, reason: '' }
  } catch (e) {
    return failed('探测服务端版本时出错：' + String((e && (e as any).message) || e).slice(0, 300))
  }
}

/**
 * 按探测事实回答一条读操作的支持程度。
 *
 * 判据只用这次探测的结果（主机种类 + 版本原文），不查任何静态表；探测没成（probe.ok 为假）就回 null：
 * 不知道就不回答，绝不默认「支持」。版本读不出的企业版按「部分支持」回答（不知道版本，不冒充不支持）。
 */
export function runtimeCapabilityAnswerFor (operation: RuntimeCapabilityOperation, probe: RuntimeServerProbe): RuntimeCapabilityAnswer | null {
  if (!probe || probe.ok !== true) return null
  const base: any = { operation: operation, ticket: CAPABILITY_TICKET, hostKind: probe.hostKind, serverVersion: probe.serverVersion, probedAtMs: probe.probedAtMs, source: 'runtime-probe' }
  if (probe.hostKind === 'github.com') {
    return Object.assign(base, { support: 'supported', reason: '服务端是 github.com：这条读接口全量可用' })
  }
  if (probe.hostKind !== 'ghes') return null
  if (operation === 'listSubIssues') {
    return Object.assign(base, { support: 'unsupported', reason: '企业版没有子票接口：父票与子票树只在 github.com 提供（GraphQL 与 REST 都没有），所以这里按「不支持」回答，不当成空列表' })
  }
  const has = hasDependencyEndpoint(probe.serverVersion)
  if (has === false) {
    return Object.assign(base, { support: 'unsupported', reason: '企业版的依赖边端点从 3.19 才有：这台服务端是 ' + String(probe.serverVersion) + '，依赖读不到，按「不支持」回答，不当成没有依赖' })
  }
  if (has === true) {
    return Object.assign(base, { support: 'partial', reason: '企业版 3.19 起才有依赖边端点：这台服务端是 ' + String(probe.serverVersion) + '，能补一部分；GraphQL 主路在部分版本上不可用，降级时以 REST 为准' })
  }
  return Object.assign(base, { support: 'partial', reason: '认出是企业版但读不出服务端版本：依赖边按「部分支持」回答，不当成不支持也不冒充支持' })
}

/**
 * 一条读操作该不该探测、探测后回答什么：不在企业版主机上直接回 null（github.com 零请求）。
 * 失败原文传进来是为了「GH_HOST 没设、但服务端自己说它是企业版」这一种情形也能认出来。
 */
export async function runtimeCapabilityFor (operation: RuntimeCapabilityOperation, ctx: OpContext, failureText?: string): Promise<RuntimeCapabilityAnswer | null> {
  if (!looksEnterprise(ctx, failureText)) return null
  const probe = await probeRuntimeServer(ctx)
  return runtimeCapabilityAnswerFor(operation, probe)
}

/**
 * 把回答挂到读结果信封上：没有回答就原样返回（同一引用）；调用成功且回答是「不支持」时不挂
 * （调用即知优先——成功了自己说「不支持」会自相矛盾）；其余情况挂一份新信封，原信封不动。
 */
export function attachRuntimeAnswer (envelope: any, answer: RuntimeCapabilityAnswer | null): any {
  if (!answer) return envelope
  if (envelope && envelope.ok === true && answer.support === 'unsupported') return envelope
  return Object.assign({}, envelope, { runtimeCapability: answer })
}

export default { looksEnterprise, probeRuntimeServer, runtimeCapabilityAnswerFor, runtimeCapabilityFor, attachRuntimeAnswer }
