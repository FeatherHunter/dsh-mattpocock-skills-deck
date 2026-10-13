// src/deck/registration/sandbox-guard.ts —— deck 工具与检查链共用的按调用现算许可（935）
// （旧 src/host/platform/deckSandbox.js，#1019 机械搬家只挪位置不改行为。）
//
// 这一文件在链路的注册与装配一段：回答“这次调用按哪份许可跑”。
// 调用方有两处：工具接线递给装配口的 sandboxPolicyFor（refresh/wiring.js），
// 与宿主入口检查链的内联实现（host/index.js）。两处逻辑同源但分开存——
// 本次只转语言不合结构（讨论 #1030 Q2 定案）：合一是改依赖方向，超出零变化边界，另立结构票；口径以本文件这份为准。
//
// 什么约定不能改：显式会话号优先，否则按工作区根找唯一归属会话；
// 归一先统一斜杠、去尾斜杠、转小写；同目录精确命中恰好一个才认，
// 无精确命中时子目录包含恰好一个才认；无归属、多选一不清、服务缺席、抛错，
// 一律回空策略（policy 为空），绝不自己拼宽松放行。
// 真实反例：某工作区下有两个会话、调用又没带会话号时，若按“第一个”猜一个放行，
// 工具就会跑在错会话的许可下——所以多选一不清时必须回空，由调用方如实拒绝。
//
// 日志：本文件自己不记日志。判定是纯读口，无状态变化可记；
// 调用方在自己的成功与失败出口落既有事件，不新增事件名（#1030 Q6）。

/** 宿主上下文里按名取服务的能力：取不到即服务缺席，调用方回空策略，不抛。 */
interface ServiceReader { get: (name: string) => unknown }
/** 沙箱策略服务：按会话解出许可；不在或无 resolve 即缺席。 */
interface SandboxPolicyService { resolve?: (input: { session: unknown }) => unknown }
/** 会话服务：按号取会话、列出会话；不在即缺席。 */
interface SessionService { get?: (id: string) => unknown; list?: () => unknown }
/** 判定入参：调用方给的工作区目录与会话号，两格缺一即按无归属回空。 */
export interface SandboxQuery { cwd?: unknown; sessionId?: unknown }
/** 沙箱判定的出参：认不出人时 policy 为空，调用方不得放行，只能如实拒绝。 */
export interface SandboxDecision { policy: unknown; sessionId: string }

/**
 * 造一份按调用现算的沙箱判定（供宿主层两处复用）。
 * ctx 是宿主上下文（沙箱服务与会话服务都从它身上取，取不到即缺席）。
 * 回来的函数收一次调用信息、回一次判定：任何缺件与抛错都收成空策略，永不抛。
 */
export function createSandboxPolicyFor(ctx: unknown): (info: unknown) => Promise<SandboxDecision> {
  return function (info: unknown): Promise<SandboxDecision> {
    try {
      const query = info as SandboxQuery | null | undefined;
      const cwd = String((query && query.cwd) || ''); const sid = String((query && query.sessionId) || '')
      let svc: SandboxPolicyService | null = null; try { svc = (ctx as ServiceReader).get('sandboxPolicy') as SandboxPolicyService | null } catch (eG) { svc = null }
      if (!svc || typeof svc.resolve !== 'function') return Promise.resolve({ policy: undefined, sessionId: sid })
      let sessionsSvc: SessionService | null = null; try { sessionsSvc = (ctx as ServiceReader).get('sessions') as SessionService | null } catch (eS) { sessionsSvc = null }
      let session: unknown = null; try { if (sid && sessionsSvc && typeof sessionsSvc.get === 'function') session = sessionsSvc.get(sid) || null } catch (eG2) { session = null }
      if (!session && sessionsSvc && typeof sessionsSvc.list === 'function' && cwd) {
        const keyOf = (p: unknown): string => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const want = keyOf(cwd); const prefix = want + '/'; let all: unknown[] = []
        try { all = ((sessionsSvc.list() || []) as unknown[]) } catch (eL) { all = [] }
        const cwdOf = (s: unknown): string => { try { if (!s || typeof s !== 'object') return ''; const o = s as Record<string, unknown>; if (typeof o.cwd === 'string' && o.cwd) return o.cwd; const header = o.header as Record<string, unknown> | null | undefined; if (header && typeof header.cwd === 'string' && header.cwd) return header.cwd; const workspace = o.workspace as Record<string, unknown> | null | undefined; if (workspace && typeof workspace.cwd === 'string' && workspace.cwd) return workspace.cwd; if (typeof o.workspaceRoot === 'string' && o.workspaceRoot) return o.workspaceRoot } catch (eC) {} return '' }
        const exact: unknown[] = []; const inside: unknown[] = []
        for (const item of all) { const c = cwdOf(item); if (!c) continue; const k = keyOf(c); if (!k) continue; if (k === want) exact.push(item); else if (k.indexOf(prefix) === 0) inside.push(item) }
        if (exact.length === 1) session = exact[0]; else if (exact.length === 0 && inside.length === 1) session = inside[0]
      }
      if (!session) return Promise.resolve({ policy: undefined, sessionId: sid })
      let policy: unknown = undefined; try { policy = svc.resolve({ session }) } catch (eR) { policy = undefined }
      let realId = sid; try { const found = session as { id?: unknown } | null; if (session && found && found.id) realId = String(found.id) } catch (eI) {}
      return Promise.resolve({ policy, sessionId: realId })
    } catch (e) { return Promise.resolve({ policy: undefined, sessionId: String(((info as SandboxQuery | null) && (info as SandboxQuery).sessionId) || '') }) }
  }
}
