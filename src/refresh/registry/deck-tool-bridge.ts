// src/refresh/registry/deck-tool-bridge.ts —— deck 工具桥的装配机（#1427 F3 · 桥部分）
//
// 这是 deck 工具桥的唯一落点：把九个工具工厂（读点仍在 src/deck/registration/host-assemble.ts，
// 平台豁免的读入位置不动）装成一张表，依赖全部由调用方现取现传。自己不判断业务，不记日志。
//
// 会合说明（目标地图 B12 与 F3）：宿主运行时的桥段（refresh-runtime.ts 里的 D 段 deckToolsForHost 闭包，
// 绑着闸、账本与后端上下文那一份）#1429 才从运行时里拆出来并到这里；本票只落 F3 的工厂侧装配。
// 在那之前，本文件只含工厂侧，不含运行时绑定。
//
// 本文件住登记层（registry/）：只被宿主房与门禁引用，不被房外深引（refresh-outside-only-contract 管着）。
import { createDeckTools } from '../../deck/shell/tool-table.js'
import { DECK_TOOL_FACTORIES, withCap } from '../../deck/registration/host-assemble.js'
// #1003 单出口：判定函数由平台层递进九个工具共用的依赖（平台→探测跨层，门禁不计数；壳内部零新增引用边）。
//   没递到时壳走老路；老路删除时本行与壳里的 fallback 一起删。
import { decideBackend } from '../../tracker/detection/backendDecision.js'
// 声明文件读取的等待上限住中央 YAML（config/timeouts.yaml 的 deckAssemblyMs 键）：这里只留别名，
// 名字与位置不动（#1030 Q4 冻的是数值与位置，别名不断），调时间改 YAML。
// 值由 tests/verify-time-config.ts 看守一致。
import { DECK_ASSEMBLY_TIMEOUT_MS as CENTRAL_DECK_ASSEMBLY_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

/** 未知形状的对象（接线递进来的依赖包先按这形接住，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>;
/** 装配依赖包：九个工具工厂要的全部依赖，由宿主接线方现取现传（与门禁里直接喂给工厂的那一份同形）。 */
export interface HostToolDeps { gate?: unknown; registry?: unknown; budget?: unknown; estimate?: unknown; costInputFrom?: unknown; handleFor?: unknown; backendCtx?: unknown; invalidate?: unknown }

/** 声明文件读取的等待上限（毫秒）：挂住的文件服务不能卡住选后端，超时按缺席跳过。数值与位置全冻（#1030 Q4），真源见中央 YAML。 */
export const DECK_ASSEMBLY_TIMEOUT_MS = CENTRAL_DECK_ASSEMBLY_TIMEOUT_MS

/**
 * 装一次，回 createDeckTools 的原话：{ tools, names, definitions, missing }。
 * toolDeps 就是九个工具工厂的依赖（闸、注册表、额度、算账、会话→句柄、后端 ctx、planStore、
 * invalidate）—— 与 tests/verify-deck-tools.js 里直接喂给工厂的那一份同形，
 * 所以「门禁里跑得通」与「宿主里跑得通」是同一件事，而不是两份各自能跑的实现。
 */
export function createDeckToolsForHost(toolDeps: unknown): unknown {
  const base = ((toolDeps as UnknownRecord | null | undefined) || {}) as UnknownRecord;
  // #1003 补声明文件这一层：工具壳新增的 readDeclarationId 缺席时，由装配层按现有文件服务现拼一个。
  //   读与解析与探测器同路径同口径（docs/agents/issue-tracker.md + parseIssueTracker），不另起第二套。
  let readDeclarationId = base.readDeclarationId as ((rootCwd: unknown) => Promise<string | null>) | undefined;
  if (typeof readDeclarationId !== 'function') {
    readDeclarationId = async function (rootCwd: unknown): Promise<string | null> {
      try {
        const backendHolder = base as { backendCtx?: () => unknown };
        const backendObj = (typeof backendHolder.backendCtx === 'function' ? backendHolder.backendCtx() : (base.backendCtx || {})) as UnknownRecord | null;
        const fsSvc = (backendObj && (backendObj.fs as UnknownRecord | null)) || (backendObj && backendObj.platform && ((backendObj.platform as UnknownRecord).fs as UnknownRecord | null)) || null;
        const fsOps = fsSvc as { resolve?: (target: string, opts: { cwd: unknown }) => Promise<unknown>; readText?: (target: unknown) => Promise<unknown> } | null;
        if (!fsOps || typeof fsOps.resolve !== 'function' || typeof fsOps.readText !== 'function') return null;
        const raced = await withCap(
          Promise.resolve(fsOps.resolve('docs/agents/issue-tracker.md', { cwd: rootCwd })).then(function (t: unknown) { return (fsOps as { readText: (target: unknown) => Promise<unknown> }).readText(t); }, function () { return null; }),
          DECK_ASSEMBLY_TIMEOUT_MS
        );
        const raw = (raced && raced.ok === true) ? raced.value : null;
        if (!raw) return null;
        const { parseIssueTracker, normalizeTrackerText } = await import('../../tracker/detection/parseIssueTracker.js');
        const parseFn = parseIssueTracker as (text: string) => { explicitBackendId?: unknown } | null;
        const normalizeFn = normalizeTrackerText as (text: string) => string;
        const parsed = parseFn(normalizeFn(raw as string));
        if (parsed && parsed.explicitBackendId) {
          // 未注册的 id 由调用方按“未知层跳过”处理，这里只透传文本结论。
          return parsed.explicitBackendId as string;
        }
        return null;
      } catch {
        return null;
      }
    };
  }
  const createTools = createDeckTools as (factories: unknown, deps: unknown) => unknown;
  const decideBackendFn = (decideBackend as unknown) || null;
  return createTools(DECK_TOOL_FACTORIES, { toolDeps: Object.assign({}, base, { readDeclarationId, decideBackend: decideBackendFn }) })
}
