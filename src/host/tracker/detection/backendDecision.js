/**
 * tracker/detection/backendDecision.js —— 后端判定的唯一真源（#1003 契约落地一期）
 *
 * 人的话：工作区现在用哪个后端，只许这一处说了算。调用方（面板快照、九个 deck 工具、
 * 改色两条电话、状态栏）都问它，不许各自再写一份短清单。
 *
 * 一期只做读收敛（不写文件、不迁移、不碰缓存）：
 *  - 空目录（还不知道工作区是哪条）如实按未知处理：不读文件、不起外部命令，
 *    不产出“没有后端”的结论，只说工作区还没就绪。
 *  - 顺序统一为：内存绑定 → 工作区文件 → 声明文件 → 本机记忆 → 自动识别。
 *    这一顺序把三条旧链（探测级联、工具壳、改色电话）里“看不看声明文件”的分叉收掉：
 *    只放声明文件的工作区，三处从此给出同一个答案。
 *  - 来源保持旧枚举（explicit / matches / fallback / unknown），另加 origin 一格
 *    区分“人选的 / 记忆搬来的 / 声明文件来的 / 自动识别来的”，旧界面按 source 照读，
 *    新界面按 origin 区分。下一期（#1012 核落地后）再把 source 也换成新枚举。
 */

import { parseIssueTracker, normalizeTrackerText } from './parseIssueTracker.js';
import { parseWorkspaceFile, WORKSPACE_FILE_REL } from '../../../shared/deck-tools/workspace-file.js';

function isKnown(registry, id) {
  try {
    return !!(id && registry && typeof registry.has === 'function' && registry.has(id));
  } catch {
    return false;
  }
}

/**
 * 统一判定的纯核：输入已经读到的各层候选，输出唯一答案。
 * 不碰文件系统与注册表，只做排序，方便单测与三处共用。
 */
export function decidePure({ boundId, fileParsed, declarationId, choiceRecord, autodetect, registry }) {
  if (boundId !== undefined && boundId !== null && boundId !== '') {
    if (isKnown(registry, boundId)) return { backendId: boundId, source: 'explicit', origin: 'user-memory-bind' };
  }
  if (fileParsed && fileParsed.backendId && isKnown(registry, fileParsed.backendId)) {
    const origin = fileParsed.source === 'auto' ? 'file-auto' : 'user-file';
    return { backendId: fileParsed.backendId, source: 'explicit', origin };
  }
  if (declarationId && isKnown(registry, declarationId)) {
    return { backendId: declarationId, source: 'explicit', origin: 'declaration' };
  }
  if (choiceRecord && choiceRecord.backendId && isKnown(registry, choiceRecord.backendId)) {
    return { backendId: choiceRecord.backendId, source: 'explicit', origin: 'migrated-memory' };
  }
  if (autodetect && autodetect.backendId && isKnown(registry, autodetect.backendId)) {
    return { backendId: autodetect.backendId, source: autodetect.source || 'matches', origin: 'autodetect', ref: autodetect.ref || null, multiHit: autodetect.multiHit, pending: autodetect.pending };
  }
  if (autodetect && autodetect.pending) {
    return { backendId: null, source: 'fallback', origin: 'pending', pending: true };
  }
  return { backendId: null, source: 'fallback', origin: 'none' };
}

async function readFileLayer(cwd, deps) {
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      const target = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd });
      const txt = await fsSvc.readText(target);
      const parsed = parseWorkspaceFile(txt);
      if (parsed && parsed.backendId) return parsed;
      return null;
    }
    if (typeof deps.readWorkspaceFileText === 'function' && typeof deps.parseWorkspaceFile === 'function') {
      const txt = await deps.readWorkspaceFileText(cwd);
      if (!txt) return null;
      const parsed = deps.parseWorkspaceFile(txt);
      if (parsed && parsed.backendId) return parsed;
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function readDeclarationLayer(cwd, deps) {
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      const target = await fsSvc.resolve('docs/agents/issue-tracker.md', { cwd });
      const raw = await fsSvc.readText(target);
      const parsed = parseIssueTracker(normalizeTrackerText(raw));
      if (parsed && parsed.explicitBackendId) return parsed.explicitBackendId;
      return null;
    }
    if (typeof deps.readDeclarationId === 'function') {
      const did = await deps.readDeclarationId(cwd);
      if (typeof did === 'string' && did) return did;
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function readChoiceLayer(cwd, deps) {
  try {
    if (typeof deps.readChoice === 'function') {
      const got = await deps.readChoice(cwd);
      if (got && got.backendId) return got;
      return null;
    }
    if (typeof deps.getChoiceStore === 'function') {
      const cs = await deps.getChoiceStore();
      const got = cs && typeof cs.getWorkspace === 'function' ? await cs.getWorkspace(cwd) : null;
      if (got && got.found === true && got.backendId) return { backendId: got.backendId };
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 唯一判定出口：输入工作区根，输出 { backendId, source, origin, canWrite, reason }。
 * 空根直接按未知返回，不读文件、不问注册表、不起外部命令。
 */
export async function decideBackend(root, deps = {}) {
  const cwd = String(root || '');
  if (!cwd) {
    return { backendId: null, source: 'unknown', origin: 'unknown-workspace', canWrite: false, reason: 'workspace-not-ready' };
  }
  const registry = deps.registry || null;
  const handle = { cwd };
  let boundId;
  try {
    boundId = registry && typeof registry.bound === 'function' ? registry.bound(handle) : undefined;
  } catch {
    boundId = undefined;
  }
  if (boundId !== undefined && boundId !== null && boundId !== '' && isKnown(registry, boundId)) {
    return { backendId: boundId, source: 'explicit', origin: 'user-memory-bind', canWrite: true, reason: '' };
  }
  const fileParsed = await readFileLayer(cwd, deps);
  if (fileParsed && isKnown(registry, fileParsed.backendId)) {
    const origin = fileParsed.source === 'auto' ? 'file-auto' : 'user-file';
    return { backendId: fileParsed.backendId, source: 'explicit', origin, canWrite: true, reason: '' };
  }
  const declarationId = await readDeclarationLayer(cwd, deps);
  if (declarationId && isKnown(registry, declarationId)) {
    return { backendId: declarationId, source: 'explicit', origin: 'declaration', canWrite: false, reason: 'needs-generate' };
  }
  const choiceRecord = await readChoiceLayer(cwd, deps);
  if (choiceRecord && choiceRecord.backendId && isKnown(registry, choiceRecord.backendId)) {
    return { backendId: choiceRecord.backendId, source: 'explicit', origin: 'migrated-memory', canWrite: true, reason: 'needs-migrate' };
  }
  let autodetect = null;
  try {
    if (registry && typeof registry.select === 'function' && deps.skipAutodetect !== true) {
      const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
      autodetect = await registry.select(handle, ctx);
    }
  } catch {
    autodetect = null;
  }
  if (autodetect && autodetect.backendId && isKnown(registry, autodetect.backendId)) {
    return { backendId: autodetect.backendId, source: autodetect.source || 'matches', origin: 'autodetect', canWrite: false, reason: 'needs-generate', ref: autodetect.ref || null, multiHit: autodetect.multiHit, pending: autodetect.pending };
  }
  if (autodetect && autodetect.pending) {
    return { backendId: null, source: 'fallback', origin: 'pending', canWrite: false, reason: 'pending' };
  }
  return { backendId: null, source: 'fallback', origin: 'none', canWrite: false, reason: 'no-backend' };
}

export default { decideBackend, decidePure };
