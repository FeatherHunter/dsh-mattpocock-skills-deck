/**
 * src/tracker/rooms/github/model/issue-key.ts —— 「仓库坐标」的解析助手（#1687 从房间根抽出来）。
 *
 * 为什么住 model：这里只做纯字符串解析，不发请求、不读上下文，属于可被读写两侧共用的数据形状。
 * 为什么抽出来：parseRepo / repoId 原先在 issues.ts、labels.ts、graph.ts、comments.ts 里各抄了一份，
 * 四份函数体逐字相同。分层之后写侧要解析仓库坐标、读侧也要（read/labels.ts），可读侧不能反过来引用
 * 写侧文件，于是把这段纯解析放到双方都能引用的 model 层，谁都不必再抄第五份。
 * 行为零变化：函数体与原四份一字不差，返回值语义完全照旧（refId 形不对回 null / 空串，不抛）。
 */

import type { RepositoryRef } from '../../../contract/entities.js';

/** 仓库坐标：拥有者与仓库名，refId 形不对就回 null 而不是抛。 */
export interface ParsedRepo {
  owner: string;
  name: string;
}

/** 把 `{refId: "owner/name"}` 拆成拥有者与仓库名；refId 缺失或形状不对回 null。 */
export function parseRepo(repo: RepositoryRef | null | undefined): ParsedRepo | null {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

/** 仓库口径的标识串：优先 refId，其次 name，都没有回空串（调用方按「缺仓库标识」处理）。 */
export function repoId(repo: RepositoryRef | null | undefined): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

export default { parseRepo, repoId }
