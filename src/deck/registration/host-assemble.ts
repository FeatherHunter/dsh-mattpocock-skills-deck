// src/deck/registration/host-assemble.ts —— 九个 deck_* 工具在宿主里的装配点（#723 T19c · 第 D 件）
// （旧 src/host/platform/deckToolsAssembly.js，#1019 机械搬家只挪位置不改行为。）
//
// 这个文件只做一件事：把 src/host/tools/ 下九个工具文件里的工厂函数读进来，交给共享层的装配口
// createDeckTools（src/shared/deck-tools/plan.js）装成一张表 { 名字 → { definition, run } }。
// 它自己不判断任何业务：闸、后端注册表、额度常量、会话→句柄、后端 ctx、写后失效缓存这些依赖
// 都由宿主接线方现取现传（见 src/host/refresh/wiring.js 的 deckToolsForHost）。
//
// 为什么这个文件住在 src/host/platform/，而不是 src/host/tools/ 或 src/host/refresh/：
//   同层互引门禁（tests/verify-dependency-rules.ts）把 src/host/ 整棵树算作「宿主层」，
//   宿主层里的文件之间不许互相引用。九个工具文件都在宿主层里，所以「谁把这九个文件读进来」这件事
//   只要落在宿主层的文件上，就要新增 9 条同层引用边（本票的纪律是不许新增这 9 条）。
//   同一份门禁把 src/host/platform/ 从宿主层里排除，并在文件头把它称作「平台装配扇出」——
//   也就是说，需要一个「宿主内部的装配扇入点」时，它是 src/host 下唯一空着的位置
//   （另一个被排除的位置是后端三个房间所在的 src/host/tracker/backends/，那里归老门禁
//   tests/verify-dependency-rules.ts 管，不适合放工具接线）。
//   换句话说：本文件住在这里是为了守住门票那条「不给宿主层新增 9 条同层边」的形状，
//   不是因为它与操作系统有关。备选做法与代价写在 #723 交付报告第 6 节，请统筹者定夺。
//
// 日志：本文件自己不记日志。九个工具每一次调用都经共享壳（src/shared/deck-tools/shell.js）
// 在自己的成功/失败出口各落一行 host.call / host.call.fail（kind = deck-tool），
// 沿用既有事件名，不新增事件名、不新增字段（#1030 Q6）。
import { createDeckTools } from '../shell/tool-table.js'
import { stringifyWorkspaceFile, WORKSPACE_FILE_REL } from '../shell/workspace-anchor.js'
// #1003 单出口：判定函数由平台层递进九个工具共用的依赖（平台→探测跨层，门禁不计数；壳内部零新增引用边）。
//   没递到时壳走老路；老路删除时本行与壳里的 fallback 一起删。
import { decideBackend } from '../../tracker/detection/backendDecision.js'
import { createDeckContext } from '../tools/context.js'
import { createDeckIssueGet } from '../tools/issue-get.js'
import { createDeckMapSnapshot } from '../tools/map-snapshot.js'
import { createDeckIssueList } from '../tools/issue-list.js'
import { createDeckIssueCreate } from '../tools/issue-create.js'
import { createDeckMapPlanCreate } from '../tools/map-plan-create.js'
import { createDeckMapLink } from '../tools/map-link.js'
import { createDeckIssuePatch } from '../tools/issue-patch.js'
import { createDeckIssueReport } from '../tools/issue-report.js'

/** 未知形状的对象（接线递进来的依赖包先按这形接住，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>;
/** 装配依赖包：九个工具工厂要的全部依赖，由宿主接线方现取现传（与门禁里直接喂给工厂的那一份同形）。 */
export interface HostToolDeps { gate?: unknown; registry?: unknown; budget?: unknown; estimate?: unknown; costInputFrom?: unknown; handleFor?: unknown; backendCtx?: unknown; invalidate?: unknown }

/** 九个工厂（顺序与 plan.js 的 DECK_TOOL_ORDER 一致；装配口按名字收口，这里只负责传全）。 */
export const DECK_TOOL_FACTORIES = Object.freeze([
  createDeckContext,
  createDeckIssueGet,
  createDeckMapSnapshot,
  createDeckIssueList,
  createDeckIssueCreate,
  createDeckMapPlanCreate,
  createDeckMapLink,
  createDeckIssuePatch,
  createDeckIssueReport,
] as const)
/** 编译期锁死九个：多数少一个这里就报错，不等跑起来才发现（#1030 Q1 按九个验收）。 */
const _assertNineFactories: 9 = DECK_TOOL_FACTORIES.length;

/** 这九个文件就是本文件存在的理由：门禁与排查要能一眼看见这 9 条边被收在哪一个点上。 */
export const DECK_TOOL_FILES = Object.freeze([
  'src/host/tools/deckContext.js',
  'src/host/tools/deckIssueGet.js',
  'src/host/tools/deckMapSnapshot.js',
  'src/host/tools/deckIssueList.js',
  'src/host/tools/deckIssueCreate.js',
  'src/host/tools/deckMapPlanCreate.js',
  'src/host/tools/deckMapLink.js',
  'src/host/tools/deckIssuePatch.js',
  'src/host/tools/deckIssueReport.js',
] as const)
/** 编译期锁死九个：文件清单与工厂数必须同为九，差一个这里就报错。 */
const _assertNineFiles: 9 = DECK_TOOL_FILES.length;

/**
 * 装一次，回 createDeckTools 的原话：{ tools, names, definitions, missing }。
 * toolDeps 就是九个工具工厂的依赖（闸、注册表、额度、算账、会话→句柄、后端 ctx、planStore、
 * invalidate）—— 与 tests/verify-deck-tools.js 里直接喂给工厂的那一份同形，
 * 所以「门禁里跑得通」与「宿主里跑得通」是同一件事，而不是两份各自能跑的实现。
 */
/** #957 双命中保护写口的工厂（导出只为门禁直验逻辑，生产经 createDeckToolsForHost 装进九个工具共用的那一份）。 */
// 等待竞速共用（装配层自带：挂住的文件服务不能卡住选后端；超时按缺席跳过，调用方诚实报错）。
// 接线层（wiring.js 的保读数/记忆/文件三处）与下面的保护写口共用同一份；单测直验它。
export function withCap(promise: unknown, ms: number): Promise<{ ok: boolean; value?: unknown; timedOut?: boolean }> {
  return Promise.race([
    Promise.resolve(promise).then(function (v: unknown) { return { ok: true, value: v } }, function () { return { ok: false } }),
    new Promise<{ ok: boolean; timedOut: boolean }>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
/** 声明文件读取的等待上限（毫秒）：挂住的文件服务不能卡住选后端，超时按缺席跳过。数值与位置全冻（#1030 Q4）。 */
export const DECK_ASSEMBLY_TIMEOUT_MS = 8000
export function createDoubleHitProtector(baseDeps: unknown): (cwd: unknown, sessionId: unknown, picked: unknown) => Promise<null> {
  // #1003 退役自动写：多命中或身份待定时不许猜，直接返回空，由调用方如实拒绝并引导去面板选一次。
  //   旧的“自动存一份 GitHub 默认值”会把机器的猜测写进人可手改的配置文件，与唯一真源冲突，已删。
  const protectDoubleHit = async function (cwd: unknown, sessionId: unknown, picked: unknown): Promise<null> {
    return null;
  }
  return protectDoubleHit
}

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
  return createTools(DECK_TOOL_FACTORIES, { toolDeps: Object.assign({}, base, { readDeclarationId, protectDoubleHit: createDoubleHitProtector(base), decideBackend: decideBackendFn }) })
}
