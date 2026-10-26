// src/deck/registration/host-assemble.ts —— 九个 deck_* 工具在宿主里的装配点（#723 T19c · 第 D 件）
// （旧 src/host/platform/deckToolsAssembly.js，#1019 机械搬家只挪位置不改行为。）
//
// 这个文件只做一件事：把 src/host/tools/ 下九个工具文件里的工厂函数读进来，交给桥
//（src/refresh/registry/deck-tool-bridge.ts 的 createDeckToolsForHost）装成一张表。
// 它自己不判断任何业务：装表要的依赖（闸、注册表、额度、后端 ctx 等）都由宿主接线方现取现传。
// #1427 F3：装表机（createDeckToolsForHost、超时别名）已搬进桥里；这里只剩九个工厂的读入点与竞速 helper。
//
// 为什么九个工厂的读入点留在这里，而不是跟着桥走：
//   九个工具文件都在宿主层里（src/host/tools/），谁把它们读进来、读的位置就要落在宿主层之外，
//   否则落进宿主层的文件要新增 9 条同层引用边（tests/verify-dependency-rules.ts 的宿主层纪律）。
//   本文件在 deck 树里，读这 9 条边不触任何同层规则；桥（登记层）从这里把整张表取走，
//   门禁（tests/verify-suggest-next-steps.ts ⑨锁九）也从这里读工厂与清单。落点与 #723 交付报告第 6 节一致。

// 日志：本文件自己不记日志。九个工具每一次调用都经共享壳（src/shared/deck-tools/shell.js）
// 在自己的成功/失败出口各落一行 host.call / host.call.fail（kind = deck-tool），
// 沿用既有事件名，不新增事件名、不新增字段（#1030 Q6）。
import { stringifyWorkspaceFile, WORKSPACE_FILE_REL } from '../shell/workspace-anchor.js'
import { createDeckContext } from '../tools/context.js'
import { createDeckIssueGet } from '../tools/issue-get.js'
import { createDeckMapSnapshot } from '../tools/map-snapshot.js'
import { createDeckIssueList } from '../tools/issue-list.js'
import { createDeckIssueCreate } from '../tools/issue-create.js'
import { createDeckMapPlanCreate } from '../tools/map-plan-create.js'
import { createDeckMapLink } from '../tools/map-link.js'
import { createDeckIssuePatch } from '../tools/issue-patch.js'
import { createDeckIssueReport } from '../tools/issue-report.js'

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

/** 等待竞速共用（deck 侧自带：挂住的文件服务不能卡住选后端；超时按缺席跳过，调用方诚实报错）。
 * 用它的有两处运行时代码：桥里的声明文件读取（src/refresh/registry/deck-tool-bridge.ts）、
 * 宿主运行时的保读数与文件读（src/refresh/rooms/host/refresh-runtime.ts）；单测直验它
 * （tests/verify-deck-no-hang.ts ⑧）。
 * 实现搬进 src/deck/shell/capped-wait.ts（#1114 第二批）：到点就清等待定时器，不再把进程留在事件循环里。 */
export { withCap } from '../shell/capped-wait.js'
