/**
 * src/tracker/rooms/github/model/repo.ts — 仓库身份与链接供给。
 *
 * #1686 阶段 1：从房间根迁入 model/，房间根的同名转发文件已在 #1687 末批删除，行为零变化。
 *
 * 文件头原写 `backends/github/repo.js`，是 #1019 目录归位前的旧路径；#1052 把读路径这一片
 * 的文件头逐个改成今天的真名（本文件也在这一片里，仓库身份的四个定位口都在这里）。
 *
 * 由 #440 从 index.js 纯结构移出（parseGithubRepo / describe / links / capabilities /
 * openRepository / getRepoKey），行为零变化。链接三件（issueAddress / repoSearchAddress /
 * issueRefPattern）原先叫网址口吻的名字，改名与删旧名是 #1110/#1133/#1141 一条线的事。
 * 以后改仓库识别规则或链接形态的人改它。预估约 150 行。
 */

import { ghClient } from '../transport/client.js'
// 记日志那层壳在内核一份（#1182 第 3 件）。
import { guardEmit } from '../../../kernel/log-emit.js'
import type { OpContext } from '../../../contract/contexts.js';
import type { OpUsage } from '../../../contract/results.js';
import type { RepositoryRef } from '../../../contract/entities.js';
import type { BackendId } from '../../../contract/identity.js';
import type { RepoHandle } from '../../../contract/contexts.js';
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GIT_PROBE_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/** 解析出的仓库坐标：拥有者与仓库名，解析不出就回 null 而不是抛。
 *  `usage` 只在真的起过 gh 的那一级出现（#1453）：定位口没有成功信封，用量就挂在裸值上，
 *  交给会话管线按后端预算模型记账；只读本地证据的两级不带这一格（它们没有出站）。 */
export interface RepoKey {
  owner: string;
  name: string;
  usage?: OpUsage;
}

// ============ 仓库定位：parseGithubRepo（从 host 迁移，语义不变） ============
/**
 * 解析 git 远程 URL → GitHub owner/repo；非 GitHub 返回 null（与 host/index.js parseGithubRepo 同构）。
 * 支持 SSH (git@github.com:owner/repo.git) 与 HTTPS (https://github.com/owner/repo.git)
 */
export function parseGithubRepo(url: unknown): RepoKey | null {
  const s = String(url || '').trim()
  const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
  if (!m) return null
  return { owner: m[1], name: m[2] }
}

// ============ RepositoryRef 供给：describe（契约成员，registry 只转发） ============
/**
 * 出 RepositoryRef：owner/name → url=github.com；handle.refId 优先，其次 cwd basename。
 * 同步纯函数（registry 期望同步），远端解析（getRepoKey）为独立 async 助手，host 按需调用。
 */
export function describe(handle: RepoHandle, backendId: BackendId): RepositoryRef {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  const cwd = handle && typeof handle.cwd === 'string' ? String(handle.cwd) : ''
  // refId 若为 owner/name 形态，直接作为 url 源
  let refId = rawRef
  // 若 refId 为空且 cwd 形如 owner/name（极少数显式传入），也接受
  if (!refId && cwd && cwd.includes('/') && !cwd.includes('\\') && cwd.split('/').length === 2) {
    // 启发式：cwd 看起来像 owner/name（非路径），直接用
    const maybe = cwd.trim()
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(maybe)) refId = maybe
  }
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? 'https://github.com/' + refId : ''
  return { backend: backendId, refId: refId || '', name: name || refId || backendId, url }
}

// ============ 链接供给：issueAddress / repoSearchAddress / issueRefPattern（契约只读 view） ============
// 三个名字讲的是「地址」而不是「网址」（#1110 实现决定第 14 条）：GitHub 这家回的是网址，
// 本地 Markdown 那家回的是票文件路径（#1144 起那条算不出票文件名，改回空串），用同一个说法才不用替谁开例外。老名字已按 #1141 删净。
export function issueAddress(ref: RepositoryRef, key: string): string {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId) return ''
  return 'https://github.com/' + refId + '/issues/' + String(key)
}

export function repoSearchAddress(name: unknown): string {
  return 'https://github.com/search?q=' + encodeURIComponent(String(name || ''))
}

export const issueRefPattern = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g

// ============ UI-lane 描述数据（#231 类别7核销 · 宿主沙箱外只读）：链接模板/能力位/注入文案 后端单源 ============
/** #231：client 渲染与链接识别的模板数据；null 字段=诚实缺该形态。 */
export const links = {
  issueUrlTemplate: 'https://github.com/{refId}/issues/{key}',
  repoUrlTemplate: 'https://github.com/{refId}',
  searchUrlTemplate: 'https://github.com/search?q={q}',
  linkPatternSource: 'github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/issues\\/(\\d+)',
}
/** 界面能力位（D8 末段）：仅驱动界面显示，永不被数据路径读取。
 * 前两键 labelsGuide 与 repoCreateChain 仍与 contract.js 里后端模块类型声明的两键一致，
 * 第三键 pullRequests 是本房在 #504 加的界面扩展：只告诉界面可以显示拉取请求页签，
 * 数据有没有拉取请求能力不看这一键，看每张票归一后有没有 isPullRequest 等三个字段（见 capability.js 的事后推导）。
 * 第三键的唯一消费者是 #506 前端房（页签门控），一次一房纪律下本房只注释不改界面，契约类型声明不动。
 * R3 要求的前端门控五字段空态属于 #506 工作，已明确拒绝并留给 #506，本房不碰。 */
export const capabilities = { labelsGuide: true, repoCreateChain: true, pullRequests: true }
/** #231：开仓契约动作——url 型由 UI 以浏览器新窗打开 describe().url。
 *
 * 类型必须写成契约那个二选一（#1053）：只写 `= 'url'` 时，这个常量的类型虽然是字面量
 * `'url'`，但 index.ts 的模块对象是「可变位置的属性引用」，TypeScript 会把字面量放宽成
 * `string`——于是契约里的 `'url' | 'folder'` 对不上，注册表读到的是一句宽字符串。
 * 写成显式联合类型（联合本身不是「新鲜字面量」）才不会被放宽。 */
export const openRepository: 'url' | 'folder' = 'url'

// ============ 仓库定位（async）：getRepoKey 迁移（原 host/index.js 三级 Tier 语义不变） ============
/**
 * 解析 cwd 对应的 GitHub owner/name（git remote → .git/config → gh repo view）。
 * 供 host snapshot / describe 异步补全使用；语义与 host 原 getRepoKey 等价。
 * @param {string} cwd
 * @param {import('../../../contract/index.js').OpContext} ctx （含 platform/fs/exec/platform.resolveExecutable）
 * @returns {Promise<{owner:string,name:string}|null>}
 */
// 房内埋点：repo.resolve.tier（#4 常驻，1/1）：三层兜底每层只记成功一行，全挂记 tier3 失败一行；只记层号与耗时，不记地址原文。
function emitRepoTier(ctx: OpContext, tier: number, ok: boolean, t0: number): void {
  guardEmit(ctx, (c) => {
    c.logEvent('info', 'repo.resolve.tier', { tier, ok: ok === true, latencyMs: Date.now() - t0 })
  })
}

export async function getRepoKey(cwd: string, ctx: OpContext): Promise<RepoKey | null> {
  const t0 = Date.now()
  const execCwd = cwd || ''
  const platform = ctx && ctx.platform ? ctx.platform : null
  const fs = platform && platform.fs ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)

  // Tier 1：git remote get-url origin + parseGithubRepo
  try {
    if (platform && typeof platform.resolveExecutable === 'function') {
      const git = await platform.resolveExecutable('git')
      if (git && ctx && typeof ctx.exec === 'function') {
        try {
          const r = await ctx.exec('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: GIT_PROBE_TIMEOUT_MS })
          const out = (r && (r.stdout || r.text || r.stdout === '' ? (r.stdout || r.text) : '')) || ''
          const k = parseGithubRepo(String(out))
          if (k) { emitRepoTier(ctx, 1, true, t0); return k }
        } catch (e) {}
      } else if (git) {
        // 回退：若 ctx.exec 不可用，尝试 platform.exec
        try {
          const execFn = ctx.exec || (platform && platform.exec)
          if (typeof execFn === 'function') {
            const r2 = await execFn('git', ['-C', execCwd, 'remote', 'get-url', 'origin'], { cwd: execCwd, timeout: GIT_PROBE_TIMEOUT_MS })
            const out2 = (r2 && (r2.stdout || r2.text)) || ''
            const k2 = parseGithubRepo(String(out2))
            if (k2) { emitRepoTier(ctx, 1, true, t0); return k2 }
          }
        } catch (e2) {}
      }
    }
  } catch (e) {}

  // Tier 2：.git/config 直读 origin
  if (fs && typeof fs.resolve === 'function' && typeof fs.readText === 'function') {
    try {
      const t = await fs.resolve('.git/config', { cwd: execCwd })
      const txt = await fs.readText(t)
      const um = String(txt || '').match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
      if (um) {
        const k = parseGithubRepo(um[1])
        if (k) { emitRepoTier(ctx, 2, true, t0); return k }
      }
      // 兼容行级 url=
      const um2 = String(txt || '').match(/url\s*=\s*(.+)/)
      if (um2 && !um) {
        const k2 = parseGithubRepo(um2[1])
        if (k2) { emitRepoTier(ctx, 2, true, t0); return k2 }
      }
    } catch (e) {}
  }

  // Tier 3：gh repo view 兜底
  try {
    const c = ghClient(ctx)
    const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: execCwd, via: 'repo.tier3' })
    if (rr && rr.ok) {
      const s = (rr.data.stdout || '').trim()
      const idx = s.indexOf('/')
      if (idx > 0) {
        emitRepoTier(ctx, 3, true, t0)
        // #1453：这一级真的起了一次 gh，用量必须随回包交给记账侧；客户端自己数着每一次出站
        // （client.ts 的 reportOutbound），这里原样读走，不另做前后相减。
        return {
          owner: s.slice(0, idx),
          name: s.slice(idx + 1),
          usage: { requests: c.usage.requests, points: c.usage.points },
        }
      }
    }
  } catch (e) {}
  emitRepoTier(ctx, 3, false, t0)
  return null
}
