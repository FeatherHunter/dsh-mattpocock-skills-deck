// src/host/platform/deckToolsAssembly.js —— 九个 deck_* 工具在宿主里的装配点（#723 T19c · 第 D 件）
//
// 这个文件只做一件事：把 src/host/tools/ 下九个工具文件里的工厂函数读进来，交给共享层的装配口
// createDeckTools（src/shared/deck-tools/plan.js）装成一张表 { 名字 → { definition, run } }。
// 它自己不判断任何业务：闸、后端注册表、额度常量、会话→句柄、后端 ctx、写后失效缓存这些依赖
// 都由宿主接线方现取现传（见 src/host/refresh/wiring.js 的 deckToolsForHost）。
//
// 为什么这个文件住在 src/host/platform/，而不是 src/host/tools/ 或 src/host/refresh/：
//   同层互引门禁（tests/verify-no-same-layer-import.js）把 src/host/ 整棵树算作「宿主层」，
//   宿主层里的文件之间不许互相引用。七个工具文件都在宿主层里，所以「谁把这七个文件读进来」这件事
//   只要落在宿主层的文件上，就要新增 7 条同层引用边（本票的纪律是不许新增这 7 条）。
//   同一份门禁把 src/host/platform/ 从宿主层里排除，并在文件头把它称作「平台装配扇出」——
//   也就是说，需要一个「宿主内部的装配扇入点」时，它是 src/host 下唯一空着的位置
//   （另一个被排除的位置是后端三个房间所在的 src/host/tracker/backends/，那里归老门禁
//   tests/verify-no-cross-import.js 管，不适合放工具接线）。
//   换句话说：本文件住在这里是为了守住门票那条「不给宿主层新增 7 条同层边」的形状，
//   不是因为它与操作系统有关。备选做法与代价写在 #723 交付报告第 6 节，请统筹者定夺。
//
// 日志：本文件自己不记日志。九个工具每一次调用都经共享壳（src/shared/deck-tools/shell.js）
// 在自己的成功/失败出口各落一行 host.call / host.call.fail（kind = deck-tool），
// 沿用既有事件名，不新增事件名、不新增字段。
import { createDeckTools } from '../../shared/deck-tools/plan.js'
import { stringifyWorkspaceFile, WORKSPACE_FILE_REL } from '../../shared/deck-tools/workspace-file.js'
import { createDeckContext } from '../tools/deckContext.js'
import { createDeckIssueGet } from '../tools/deckIssueGet.js'
import { createDeckMapSnapshot } from '../tools/deckMapSnapshot.js'
import { createDeckIssueList } from '../tools/deckIssueList.js'
import { createDeckIssueCreate } from '../tools/deckIssueCreate.js'
import { createDeckMapPlanCreate } from '../tools/deckMapPlanCreate.js'
import { createDeckMapLink } from '../tools/deckMapLink.js'
import { createDeckIssuePatch } from '../tools/deckIssuePatch.js'
import { createDeckIssueReport } from '../tools/deckIssueReport.js'

/** 九个工厂（顺序与 plan.js 的 DECK_TOOL_ORDER 一致；装配口按名字收口，这里只负责传全）。 */export const DECK_TOOL_FACTORIES = Object.freeze([
  createDeckContext,
  createDeckIssueGet,
  createDeckMapSnapshot,
  createDeckIssueList,
  createDeckIssueCreate,
  createDeckMapPlanCreate,
  createDeckMapLink,
  createDeckIssuePatch,
  createDeckIssueReport,
])

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
])

/**
 * 装一次，回 createDeckTools 的原话：{ tools, names, definitions, missing }。
 * toolDeps 就是九个工具工厂的依赖（闸、注册表、额度、算账、会话→句柄、后端 ctx、planStore、
 * invalidate）—— 与 tests/verify-deck-tools.js 里直接喂给工厂的那一份同形，
 * 所以「门禁里跑得通」与「宿主里跑得通」是同一件事，而不是两份各自能跑的实现。
 */
/** #957 双命中保护写口的工厂（导出只为门禁直验逻辑，生产经 createDeckToolsForHost 装进九个工具共用的那一份）。 */
// 等待竞速共用（装配层自带：挂住的文件服务不能卡住选后端；超时按缺席跳过，调用方诚实报错）。
// 接线层（wiring.js 的保读数/记忆/文件三处）与下面的保护写口共用同一份；单测直验它。
export function withCap(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).then(function (v) { return { ok: true, value: v } }, function () { return { ok: false } }),
    new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
export const DECK_ASSEMBLY_TIMEOUT_MS = 8000
export function createDoubleHitProtector(baseDeps) {
  // #1003 退役自动写：多命中或身份待定时不许猜，直接返回空，由调用方如实拒绝并引导去面板选一次。
  //   旧的“自动存一份 GitHub 默认值”会把机器的猜测写进人可手改的配置文件，与唯一真源冲突，已删。
  const protectDoubleHit = async function (cwd, sessionId, picked) {
    return null;
  }
  return protectDoubleHit
}

export function createDeckToolsForHost(toolDeps) {
  const base = toolDeps || {}
  // #1003 补声明文件这一层：工具壳新增的 readDeclarationId 缺席时，由装配层按现有文件服务现拼一个。
  //   读与解析与探测器同路径同口径（docs/agents/issue-tracker.md + parseIssueTracker），不另起第二套。
  let readDeclarationId = base.readDeclarationId;
  if (typeof readDeclarationId !== 'function') {
    readDeclarationId = async function (rootCwd) {
      try {
        const backendObj = (typeof base.backendCtx === 'function') ? base.backendCtx() : (base.backendCtx || {});
        const fsSvc = (backendObj && backendObj.fs) || (backendObj && backendObj.platform && backendObj.platform.fs) || null;
        if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function') return null;
        const raced = await withCap(
          Promise.resolve(fsSvc.resolve('docs/agents/issue-tracker.md', { cwd: rootCwd })).then(function (t) { return fsSvc.readText(t); }, function () { return null; }),
          DECK_ASSEMBLY_TIMEOUT_MS
        );
        const raw = (raced && raced.ok === true) ? raced.value : null;
        if (!raw) return null;
        const { parseIssueTracker, normalizeTrackerText } = await import('../tracker/detection/parseIssueTracker.js');
        const parsed = parseIssueTracker(normalizeTrackerText(raw));
        if (parsed && parsed.explicitBackendId) {
          // 未注册的 id 由调用方按“未知层跳过”处理，这里只透传文本结论。
          return parsed.explicitBackendId;
        }
        return null;
      } catch {
        return null;
      }
    };
  }
  return createDeckTools(DECK_TOOL_FACTORIES, { toolDeps: Object.assign({}, base, { readDeclarationId, protectDoubleHit: createDoubleHitProtector(base) }) })
}
