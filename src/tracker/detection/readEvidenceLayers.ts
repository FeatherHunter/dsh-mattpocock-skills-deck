/**
 * tracker/detection/readEvidenceLayers.ts —— 判定要看的前两层证据怎么读：工作区文件、声明文件
 *
 * 人的话：判定后端的第一、二层证据（工作区文件、声明文件）原本长在 backendDecision.ts 里。
 * 那份文件已经超过文件粒度门禁的上限（tests/verify-file-granularity.ts：单文件 350 有效行，
 * 已在基线里的只许减不许增，而 backendDecision.ts 的基线是 740）；#1572 又往里加了声明置信度
 * 那一段，涨到 759 有效行，把冻结基线顶破了。读数这块与纯判断规则之间没有依赖——
 * 「按什么顺序试哪些路径、读失败与文件不在怎么分开、读到的东西怎么变成一层证据的结论」——
 * 所以整块搬到这里，backendDecision.ts 只留调用。
 *
 * 搬动时行为一字未改，几条不能丢的约定：
 *  - 「文件不在」与「读不成」必须分开：前者够格参与「确实没有后端」的结论，后者不够；
 *    分不出来时一律当作读不成（宁可说没查清，也不说查清了没有）。
 *  - 工作区文件层新文件优先、老 json 只作兼容读，顺序与核的读口一致。
 *  - 声明文件层与探测器、工具壳装配层共用 parseIssueTracker 一套解析器：一次读取、一份结论（#1048）。
 *  - #1572 收尾（方案 A）：声明读法可以交回一个带 confidence 的提示；低置信（正文里提了一句）只当证据，
 *    这一步记成 abstain（reason 带 declaration-low- 前缀），不给判定层当结论。
 */
import * as workspaceFileNS from '../../deck/shell/workspace-anchor.js'
// 解析器直接引内核里的实现（detection/parseIssueTracker.ts 只是同层的转出口）：
// 自己再引转出口会在检测层里多出一条同层互引的边，而追踪器层的同层规则只许减不许增；
// 内核本来就对房间与宿主开放，引它不算越层，解析口径也仍然只有内核那一份（#1555 / #1048）。
import { parseIssueTracker } from '../kernel/issue-tracker-declaration.js'
import type { SandboxFs } from '../contract/contexts.js'

const parseWorkspaceFile = workspaceFileNS.parseWorkspaceFile
const WORKSPACE_FILE_REL = workspaceFileNS.WORKSPACE_FILE_REL

/**
 * 工作区文件那一层的解析结果：后端 id 加来源档位。
 * 格子按真源（workspace-file.ts 的 WorkspaceChoice）逐个声明，不用索引签名——
 * 接口没有隐式索引签名，带索引签名的目标会让真源的形状传不进来（TS2322）。
 */
export interface WorkspaceFileParsed {
  backendId: string
  source?: unknown
  pickedAt?: number
  layout?: string
}

/**
 * 读文件层要用的外部能力：沙箱文件服务优先，兼容老调用方交的两个函数。
 */
export interface FileLayerDeps {
  fs?: Pick<SandboxFs, 'resolve' | 'readText'> | null
  platform?: { fs?: Pick<SandboxFs, 'resolve' | 'readText'> } | null
  readWorkspaceFileText?: (cwd: string) => Promise<string | null>
  parseWorkspaceFile?: (text: string) => WorkspaceFileParsed | null
}

/**
 * 声明读法交回的结论（#1572）：只给 id 时按高置信处理（老钩子的形状，行为一字不变）；
 * 带上 confidence 时把解析器的置信度原样交回；低置信的线索只进证据、不产生结论（方案 A）。
 * reason 可选，是解析器原因用词的后半段（如 keyword-gitlab / title-github）；缺省按 hit 写。
 */
export interface DeclarationIdHint {
  id?: string | null
  confidence?: 'high' | 'low'
  reason?: string
}

/**
 * 读声明层要用的外部能力：调用方给了整套解析器就用它的，没给就走本文件自带的 parseIssueTracker
 *（与探测器、工具壳装配层同一套解析器，一次读取一份结论）。
 */
export interface DeclarationLayerDeps {
  fs?: Pick<SandboxFs, 'resolve' | 'readText'> | null
  platform?: { fs?: Pick<SandboxFs, 'resolve' | 'readText'> } | null
  readDeclarationId?: (cwd: string) => Promise<string | DeclarationIdHint | null>
  parseDeclaration?: (raw: string) => Promise<string | null> | string | null
}

/**
 * 这个错误是不是「文件不在」（而不是「读的时候出了别的问题」）。
 * 为什么要分：把「读不成」记成「没有这份文件」，会让判定层得出「查清了，确实没有后端」——
 * 那是句假话。分不出来时一律当作「读不成」（宁可说没查清）。
 */
export function isMissingFileError(e: unknown): boolean {
  const asRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : null;
  const code = asRecord ? String(asRecord['code'] || '') : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return true;
  const msg = asRecord && asRecord['message'] != null ? String(asRecord['message']) : String(e == null ? '' : e);
  return /ENOENT|ENOTDIR|no such file|not found|找不到|不存在/i.test(msg);
}

/**
 * 工作区文件那一层的读法：新文件优先、老文件兼容（与核的读口同顺序；老 json 只作兼容读）。
 * 回的是「读到了什么 + 这一步的结论」，不是光秃秃的解析结果——判不出来时要说得出缺什么（#1048）。
 * 「文件不在」与「读不成」在这里就分开：前者够格参与「确实没有」的结论，后者不够（见 isMissingFileError）。
 */
interface FileLayerRead { parsed: WorkspaceFileParsed | null; outcome: string; reason: string }

export async function readFileLayer(cwd: string, deps: FileLayerDeps): Promise<FileLayerRead> {
  const rels: string[] = [String(WORKSPACE_FILE_REL)];
  const legacyRel = (workspaceFileNS.WORKSPACE_FILE_LEGACY_REL || 'docs/agents/workspace.json');
  // 两个常量在类型层面是互不相交的字面量（yaml 与 json），直接比会报 TS2367；
  // 运行时它们都是字符串，这里按字符串比，行为与原来完全一致。
  if (legacyRel && (legacyRel as string) !== (WORKSPACE_FILE_REL as string)) rels.push(String(legacyRel));
  let sawFile = false;
  let sawBroken = false;
  let readFailed = false;
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      for (const rel of rels) {
        let txt = '';
        try {
          const target = await fsSvc.resolve(rel, { cwd });
          txt = await fsSvc.readText(target);
        } catch (eOne) {
          // 这一条路径没读成：文件不在是「没有这份记录」，别的错是「这次没看成」。
          if (!isMissingFileError(eOne)) readFailed = true;
          continue;
        }
        sawFile = true;
        const parsed = parseWorkspaceFile(txt);
        if (parsed && parsed.backendId) return { parsed, outcome: 'hit', reason: 'file-hit' };
        // 文件在，但里面没有可用的后端名：继续试下一个路径（老文件可能才是那份），都试完再说“读不出”。
        sawBroken = true;
      }
      if (sawBroken) return { parsed: null, outcome: 'unreadable', reason: 'file-unreadable' };
      if (readFailed) return { parsed: null, outcome: 'error', reason: 'file-read-failed' };
      return { parsed: null, outcome: 'miss', reason: sawFile ? 'file-no-backend' : 'file-missing' };
    }
    if (typeof deps.readWorkspaceFileText === 'function' && typeof deps.parseWorkspaceFile === 'function') {
      const txt = await deps.readWorkspaceFileText(cwd);
      if (!txt) return { parsed: null, outcome: 'miss', reason: 'file-missing' };
      const parsed = deps.parseWorkspaceFile(txt);
      if (parsed && parsed.backendId) return { parsed, outcome: 'hit', reason: 'file-hit' };
      return { parsed: null, outcome: 'unreadable', reason: 'file-no-backend' };
    }
  } catch (eFile) {
    return { parsed: null, outcome: 'error', reason: 'file-error' };
  }
  return { parsed: null, outcome: 'miss', reason: 'file-layer-unavailable' };
}

/**
 * 声明文件那一层的读法：调用方给了读法就用它的，没给就自己经沙箱文件服务读原文，
 * 用 parseIssueTracker 解析（与探测器、工具壳装配层同一套解析器 —— 一次读取、一份结论，#1048）。
 * 读失败同样与「文件不存在」分开。
 */
interface DeclarationLayerRead { id: string; outcome: string; reason: string; confidence?: 'high' | 'low' }

/**
 * 步骤原因：低置信声明带 declaration-low- 前缀，高置信照旧 declaration-（#1572）。
 * 两处读法共用这一处拼法，避免一个改前缀、另一个忘改，日志里出现两种来路。
 */
function declarationReason(confidence: 'high' | 'low' | undefined, suffix: string): string {
  return (confidence === 'low' ? 'declaration-low-' : 'declaration-') + suffix
}

export async function readDeclarationLayer(cwd: string, deps: DeclarationLayerDeps): Promise<DeclarationLayerRead> {
  try {
    if (typeof deps.readDeclarationId === 'function') {
      const did = await deps.readDeclarationId(cwd);
      // 老形状是直接回 id 字符串：按高置信处理，步骤行与从前一字不差。
      // 新形状可带 confidence（#1572 收尾方案 A）：低置信的正文提及只进证据（outcome=abstain），
      // 不冒充标题声明；reason 仍带 declaration-low- 前缀，读日志的人一眼能分开两种来路。
      const hint: DeclarationIdHint | null = (typeof did === 'string') ? (did ? { id: did } : null) : (did && typeof did === 'object' ? did : null);
      if (hint && hint.id) {
        const hintId = String(hint.id);
        const low = hint.confidence === 'low';
        const suffix = (typeof hint.reason === 'string' && hint.reason) ? hint.reason : 'hit';
        return { id: hintId, outcome: low ? 'abstain' : 'hit', confidence: low ? 'low' : 'high', reason: declarationReason(hint.confidence, suffix) };
      }
      return { id: '', outcome: 'miss', reason: 'declaration-missing' };
    }
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      let raw: unknown = null;
      try {
        const target = await fsSvc.resolve('docs/agents/issue-tracker.md', { cwd });
        raw = await fsSvc.readText(target);
      } catch (eRead) {
        if (isMissingFileError(eRead)) return { id: '', outcome: 'miss', reason: 'declaration-missing' };
        return { id: '', outcome: 'error', reason: 'declaration-read-failed' };
      }
      if (typeof deps.parseDeclaration === 'function') {
        const did2 = await deps.parseDeclaration(raw as string);
        if (typeof did2 === 'string' && did2) return { id: did2, outcome: 'hit', reason: 'declaration-hit' };
        return { id: '', outcome: 'miss', reason: 'declaration-no-backend' };
      }
      const parsed = parseIssueTracker(raw);
      if (parsed && parsed.explicitBackendId) {
        // #1572 收尾（方案 A）：低置信（正文关键词）只作证据 —— id 仍留下便于排查，但 outcome 记 abstain，
        // 不给判定层当结论；高置信标题照旧是 hit。
        const low = parsed.confidence === 'low';
        return { id: parsed.explicitBackendId, outcome: low ? 'abstain' : 'hit', confidence: low ? 'low' : 'high', reason: declarationReason(low ? 'low' : 'high', parsed.reason) };
      }
      return { id: '', outcome: 'miss', reason: 'declaration-no-backend' };
    }
  } catch (eDecl) {
    return { id: '', outcome: 'error', reason: 'declaration-error' };
  }
  return { id: '', outcome: 'miss', reason: 'declaration-layer-unavailable' };
}
