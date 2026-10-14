/**
 * tracker/detection/backendDecision.js —— 后端判定的唯一真源（#1003 契约落地一期）
 *
 * 人的话：工作区现在用哪个后端，只许这一处说了算。调用方（面板快照、九个 deck 工具、
 * 改色两条电话、状态栏）都问它，不许各自再写一份短清单。
 *
 * 一期只做读收敛（不写文件、不迁移、不碰缓存）：
 *  - 空目录（还不知道工作区是哪条）如实按未知处理：不读文件、不起外部命令，
 *    不产出“没有后端”的结论，只说工作区还没就绪。
 *  - 顺序统一为：工作区文件 → 声明文件 → 自动识别。
 *    这一顺序把三条旧链（探测级联、工具壳、改色电话）里“看不看声明文件”的分叉收掉：
 *    只放声明文件的工作区，三处从此给出同一个答案。
 *  - 来源保持旧枚举（explicit / matches / fallback / unknown），另加 origin 一格
 *    区分“人选的 / 搬来的 / 声明文件来的 / 自动识别来的”，旧界面按 source 照读，
 *    新界面按 origin 区分。下一期（#1012 核落地后）再把 source 也换成新枚举。
 *
 * #1138（2026-10-14 落地）：这里原来还有第一层「注册表里的进程内绑定」，它与工作区文件记的是同一件事，
 *   却是两份记录（宿主重启即消失），人选的记录因此有两个家。整层删掉了：人选只从工作区文件读，
 *   注册表那边负责写这份副本的 bind/bound/allBindings 也一起删了（见 src/tracker/registry/core.ts）。
 */

import * as workspaceFileNS from '../../deck/shell/workspace-anchor.js';
const parseWorkspaceFile = workspaceFileNS.parseWorkspaceFile;
const WORKSPACE_FILE_REL = workspaceFileNS.WORKSPACE_FILE_REL;
// 老路径兜底：切核前常量不存在（只有 yaml），切核后是 json。读永远双路径（新优先、老兼容），与核的读写口同顺序。

// 声明文件解析不另起第二套口径：调用方把完整解析器经 deps.parseDeclaration 交进来；
// 没交时用标题行最小判定（覆盖高置信标题，旧文档无标题的低兜底仍走探测器那条路）。
function titleOnlyDeclarationId(raw) {
  const text = String(raw || '').replace(/^﻿/, '').trim();
  if (!text) return null;
  if (/^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text)) return 'gitlab';
  if (/^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text)) return 'markdown';
  if (/^#\s*issue\s*tracker\s*:\s*github/im.test(text)) return 'github';
  return null;
}

/**
 * 文件来源 → 判定来源：调用方凭它分辨“人选的 / 搬来的 / 生成的 / 机器猜的”。
 * 核认 user/migrated/detected 三档，老 auto 只在读历史文件时出现（新文件不再产出）。
 */
function fileOriginOf(fileSource) {
  if (fileSource === 'migrated') return 'file-migrated';
  if (fileSource === 'detected') return 'file-detected';
  if (fileSource === 'auto') return 'file-auto';
  return 'user-file';
}

/**
 * 出口答案 → 调用方选择形状（三处共用一处：探测服务、改色电话、工具壳）。
 * 有后端给 id 加引用（引用缺席现算）；无后端给 fallback；待定与多命中原样带出，由调用方拒绝。
 * 未注册的 id 由调用方先判（hasId），这里只做形状；o 为空（出口抛错）回空，由调用方走老路或诚实失败。
 */
export function selectionFromOutlet(o, describeFn) {
  if (!o) return null;
  if (o.backendId) {
    let ref = o.ref || null;
    if (!ref && typeof describeFn === 'function') {
      try { ref = describeFn(o.backendId); } catch (e) { ref = null; }
    }
    const out = { backendId: o.backendId, source: o.source || 'explicit', ref: ref };
    if (o.multiHit) out.multiHit = o.multiHit;
    if (o.pending) out.pending = o.pending;
    return out;
  }
  if (o.pending) return { backendId: null, source: 'fallback', pending: true, multiHit: o.multiHit };
  return { backendId: null, source: 'fallback' };
}

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
 * #1003 契约（2026-10-12 维护者拍板）：本机记忆只用来把工作区配置文件生成出来一次，
 *   此后不再参与任何判定，所以纯核里没有记忆这一层。
 * #1138（2026-10-14）：注册表里那份进程内绑定同样不再参与判定，纯核里也没有它那一层——
 *   判定顺序是「工作区文件 → 声明文件 → 自动识别」。
 */
export function decidePure({ fileParsed, declarationId, autodetect, registry }) {
  if (fileParsed && fileParsed.backendId && isKnown(registry, fileParsed.backendId)) {
    const origin = fileOriginOf(fileParsed.source);
    return { backendId: fileParsed.backendId, source: 'explicit', origin };
  }
  if (declarationId && isKnown(registry, declarationId)) {
    return { backendId: declarationId, source: 'explicit', origin: 'declaration' };
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
  // 新优先、老兼容：两个路径都试，先读到的有效记录赢（与核的读口同顺序；老 json 只作兼容读）。
  const rels = [WORKSPACE_FILE_REL];
  const legacyRel = (workspaceFileNS.WORKSPACE_FILE_LEGACY_REL || 'docs/agents/workspace.json');
  if (legacyRel && legacyRel !== WORKSPACE_FILE_REL) rels.push(legacyRel);
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      for (const rel of rels) {
        try {
          const target = await fsSvc.resolve(rel, { cwd });
          const txt = await fsSvc.readText(target);
          const parsed = parseWorkspaceFile(txt);
          if (parsed && parsed.backendId) return parsed;
        } catch (eOne) { /* 这条路径没有或读坏就试下一条 */ }
      }
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
    if (typeof deps.readDeclarationId === 'function') {
      const did = await deps.readDeclarationId(cwd);
      if (typeof did === 'string' && did) return did;
    }
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      const target = await fsSvc.resolve('docs/agents/issue-tracker.md', { cwd });
      const raw = await fsSvc.readText(target);
      if (typeof deps.parseDeclaration === 'function') {
        const did2 = await deps.parseDeclaration(raw);
        if (typeof did2 === 'string' && did2) return did2;
        return null;
      }
      return titleOnlyDeclarationId(raw);
    }
  } catch {
    return null;
  }
  return null;
}

// #1003 契约（2026-10-12 维护者拍板）：原来这里有一层「读本机记忆当判定依据」（readChoiceLayer），
//   已整段删除——记忆只用来把工作区配置文件生成出来一次（那条路在工作区入口的迁移里，直接读记忆库），
//   此后不再参与任何判定。记录本身留在机器上不删（先只停用），文件万一被删还能再生成一次。


/**
 * 唯一判定出口：输入工作区根，输出 { backendId, source, origin, canWrite, reason }。
 * 空根直接按未知返回，不读文件、不问注册表、不起外部命令。
 *
 * 下面这三层只有两类（2026-10-12 维护者拍板，全文见 docs/adr/20261012-backend-decision-two-classes.md；
 * #1138 之后「人选」那一类只剩一份记录）：
 *
 * 一、**人选**（第 1 层）——只有一份记录：工作区配置文件 docs/agents/workspace.yaml。
 *   它是人选的唯一真源：跨宿主重启、跨机器、以及从别人那儿克隆过来的仓库，都靠它。
 *   #1138 之前这里还有一层「注册表里的进程内绑定」，与这份文件记的是同一件事的两份记录（宿主重启即消失）。
 *   整层删掉了：一次动作只写一份，写成功才算这次选择生效（写入口见 src/host/workspaceCwd.js 的 handleBind）。
 *
 * 二、**程序自己认**（第 2、3 层）——都不是人选：
 *   第 2 层读工作区里的声明文件 docs/agents/issue-tracker.md（仓库里写明用哪个后端，由初始化那一步的
 *   AI 写下，插件自己不写）；
 *   第 3 层是后端自己的 matches 命中（看 .git/config、看目录里有没有 .scratch/map.md 之类）。
 *   声明文件同时也是第 3 层里 matches 的输入（见 src/host/tracker/backends/gitlab/index.js 的 matches
 *   注释），所以它是「程序自己认」的一条规则，不是人选。
 *
 * 写权限今天只给人选：第 1 层 canWrite: true；第 2、3 层 canWrite: false（reason: 'needs-generate'）。
 * 读用途不受这条限制；写用途的拦截在 src/shared/deck-tools/shell.js 与 src/host/workspaceLabelColors.js。
 */
export async function decideBackend(root, deps = {}) {
  const cwd = String(root || '');
  if (!cwd) {
    return { backendId: null, source: 'unknown', origin: 'unknown-workspace', canWrite: false, reason: 'workspace-not-ready' };
  }
  const registry = deps.registry || null;
  const handle = { cwd };
  const fileParsed = await readFileLayer(cwd, deps);
  if (fileParsed && isKnown(registry, fileParsed.backendId)) {
    const origin = fileOriginOf(fileParsed.source);
    return { backendId: fileParsed.backendId, source: 'explicit', origin, canWrite: true, reason: '' };
  }
  const declarationId = await readDeclarationLayer(cwd, deps);
  if (declarationId && isKnown(registry, declarationId)) {
    return { backendId: declarationId, source: 'explicit', origin: 'declaration', canWrite: false, reason: 'needs-generate' };
  }
  // #1003 契约（2026-10-12 维护者拍板）：本机记忆这一层从判定里去掉——它只用来把工作区配置文件
  //   生成出来一次（那条路在工作区入口的迁移里，不经这里），此后不再拿它回答判定。
  //   记录本身留在机器上不删（先只停用），文件万一被删还能再生成一次。
  let autodetect = null;
  // 补全点之二：下面两处交出去的 ctx 都一定带 `caller`（调用方给了就用调用方的，
  // 没给就填 `backend-decision`），形状见契约里的 `EnrichedOpContext`。下游只许读，不许再改。
  try {
    if (typeof deps.autodetect === 'function') {
      // 可选钩子：调用方把自己的自动识别包一层再交进来（例如工具壳把配额闸包在外面，
      // 行为与直接调注册表一致，只多记账）。不传钩子时直调注册表，其余三路走这一条。
      const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
      autodetect = await deps.autodetect(handle, ctx);
    } else if (registry && typeof registry.select === 'function' && deps.skipAutodetect !== true) {
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
    return { backendId: null, source: 'fallback', origin: 'pending', pending: true, canWrite: false, reason: 'pending' };
  }
  return { backendId: null, source: 'fallback', origin: 'none', canWrite: false, reason: 'no-backend' };
}

export default { decideBackend, decidePure, selectionFromOutlet };
