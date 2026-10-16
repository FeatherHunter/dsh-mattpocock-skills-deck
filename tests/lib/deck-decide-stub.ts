/**
 * tests/lib/deck-decide-stub.ts —— deck 工具门禁专用的「判定出口」桩，外加门禁夹具的「工作区文件」账本
 *
 * 为什么门禁必须给这个依赖
 *   2026-10-11 起（提交 24a4bf33，#1003 单出口），工具壳把「这个工作区用哪个后端」整段交给装配方
 *   递进来的判定出口（`src/deck/shell/call-shell.ts:250-270`）：拿不到它就直接回三态 unsupported
 *   （原因码 backend-threw、散列 missing-decideBackend），一句话都不往后做。
 *   生产装配总是给（`src/deck/registration/host-assemble.ts` 的 `decideBackend`），
 *   而门禁夹具各有各的依赖对象、当初没给，于是十几条夹具里工具全回「判定出口这次没装上」——
 *   夹具红着，红的却不是它要守的那件事。这个文件把桩收在一处，供各夹具共用。
 *
 * #1138（2026-10-14）之后，这个文件要答的问题变了
 *   以前夹具想说「这个工作区选过了」，只有一个办法：`registry.bind(handle, 'markdown')`，
 *   桩再把这句话翻成判定出口的答案。人选的记录现在只有一份 —— 工作区文件
 *   `docs/agents/workspace.yaml`；注册表里的 `bind`/`bound`/`allBindings` 已经整段删掉
 *   （见 `src/tracker/registry/core.ts` 文件头）。所以夹具也只剩一种造法：**给这个工作区一份
 *   工作区文件，文件里写着选了谁**。本文件把那件事收在两处，各夹具共用：
 *     - `chooseWorkspace(cwd, 'markdown')`   虚拟目录：把这份文件记在内存账本里（不碰盘）
 *     - `writeWorkspaceFile(root, 'markdown')` 真临时目录：把这份文件真写到盘上
 *   然后 `makeDecideStub(registry)` **直接调生产那一个判定出口**在这份文件上作答 ——
 *   桩里不再有第二套判定规则，夹具看到的结论与生产逐字同源（连 canWrite 也同源：
 *   写用途只有「文件里有人选」才放行，这正是 #1003 契约的期望行为第 4 条）。
 *
 * 为什么兜底那一步要问 registry.select
 *   工作区文件缺席时，生产判定落到「自动识别」那一层（各房自己的 matches）。夹具的桩注册表
 *   多半在这一层直接给答案，所以照旧让它答；这一层按生产规矩回 `canWrite:false`。
 *
 * 为什么有的夹具注册表会被补一个 has
 *   判定出口要靠 `registry.has(id)` 判「认不认得这个名字」，而门禁里有些桩注册表是石头做的
 *   （只有 select）。那些桩表达的是「这个工作区已经选好了」，不是「认不得后端怎么办」，
 *   所以对没有 has 的桩按「认得」算 —— 认不得后端那条路另有门禁在守。
 *
 * 用法（本文件是 ESM 具名导出；CJS 夹具 require 也行，走 require(esm)，无顶层 await，不断链）
 *   CJS 夹具：const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')
 *   ESM 夹具：import { makeDecideStub, chooseWorkspace } from './lib/deck-decide-stub.js'
 *   接法：chooseWorkspace(cwd, 'markdown')
 *         const deps = { ... , decideBackend: makeDecideStub(registry) }
 *   注意：不要用默认导入（import decideStub from ...）—— ESM 只有具名导出，没有 default。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 与 `src/deck/shell/workspace-anchor.ts` 的 WORKSPACE_FILE_REL 同一处口径（生产读写的就是这条）。 */
export const WORKSPACE_FILE_REL = 'docs/agents/workspace.yaml'
/** 老路径：切核前的 JSON 位置，只做兼容读；夹具写文件一律走上面那条新路径。 */
export const WORKSPACE_FILE_LEGACY_REL = 'docs/agents/workspace.json'

/** 同一个工作区在账本里只许有一把钥匙（与生产对目录的洗法同构：斜杠统一、去掉末尾斜杠）。 */
function keyOf(cwd: unknown): string {
  return String(cwd == null ? '' : cwd).replace(/\\/g, '/').replace(/\/+$/, '')
}

export interface WorkspaceFileOpts {
  pickedAt?: number
  source?: string
  layout?: string
}

/**
 * 一份工作区文件的文本。形状与生产写出来的那份同构：版本 2、来源 user、带上选择时刻，
 * 所以夹具造出来的就是「用户亲手选过」那一条路，而不是另一套只有夹具认得的写法。
 * （字段与校验见 `src/shared/config-store/src/workspace.ts` 的 parseWorkspace。）
 */
export function workspaceFileText(backendId: unknown, opts?: WorkspaceFileOpts): string {
  const id = String(backendId == null ? '' : backendId).trim()
  if (!id) throw new Error('夹具要造一份工作区文件，但没给后端名')
  const o = (opts && typeof opts === 'object') ? opts : {}
  const pickedAt = (typeof o.pickedAt === 'number') ? o.pickedAt : 1700000000000
  const source = o.source ? String(o.source) : 'user'
  const lines = ['version: 2', 'backendId: ' + id, 'pickedAt: ' + pickedAt, 'source: ' + source]
  if (o.layout) lines.push('layout: ' + String(o.layout))
  return lines.join('\n') + '\n'
}

// ── 账本：工作区目录 → 那份工作区文件的文本（夹具用它当「这台机器上的工作区磁盘」）──
const book = new Map<string, string>()

/** 说「这个工作区里有一份写着 backendId 的工作区文件」。返回写进去的文本，方便夹具自己再看一眼。 */
export function chooseWorkspace(cwd: unknown, backendId: unknown, opts?: WorkspaceFileOpts): string {
  const k = keyOf(cwd)
  if (!k) throw new Error('夹具要说「这个工作区选过了」，但没给工作区目录')
  const text = workspaceFileText(backendId, opts)
  book.set(k, text)
  return text
}

/** 账本里这个工作区那份文件的文本；没记过就回 null（＝这个工作区里没有那份文件）。 */
export function workspaceFileOf(cwd: unknown): string | null {
  const k = keyOf(cwd)
  return (k && book.has(k)) ? (book.get(k) as string) : null
}

/** 忘掉所有账目：一个夹具里要反复从「没有这份文件」开头时用它。 */
export function resetWorkspaceChoices(): void {
  book.clear()
}

/**
 * 真盘那一份：在真实的工作区目录里写下这份文件（真临时目录 + 真文件服务的夹具用这个）。
 * 真写下去的意义是「门禁能看见盘上确实有这份文件」，不只是内存里说过一句。
 */
export function writeWorkspaceFile(root: unknown, backendId: unknown, opts?: WorkspaceFileOpts): string {
  const dir = path.join(String(root), 'docs', 'agents')
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, 'workspace.yaml')
  fs.writeFileSync(target, workspaceFileText(backendId, opts))
  return target
}

type DecideFn = (cwd: string, deps: Record<string, unknown>) => Promise<Record<string, unknown>>

/** 判定出口这一份只装一次：它是个纯核加读文件的函数，夹具反复调不必反复装载。 */
let outletPromise: Promise<{ decideBackend?: DecideFn } | null> | null = null
function loadOutlet(): Promise<{ decideBackend?: DecideFn } | null> {
  if (!outletPromise) {
    outletPromise = import('../../src/tracker/detection/backendDecision.ts').catch(function () { return null })
  }
  return outletPromise
}

/** 判定出口这一份还要「一段文本 → 人选后端」的解析器：与生产同源，不另写一份解析。 */
let parserPromise: Promise<{ parseWorkspaceFile?: (text: string) => unknown } | null> | null = null
function loadParser(): Promise<{ parseWorkspaceFile?: (text: string) => unknown } | null> {
  if (!parserPromise) {
    parserPromise = import('../../src/deck/shell/workspace-anchor.ts').catch(function () { return null })
  }
  return parserPromise
}

/**
 * 没有 has 的桩注册表补一个「认得」：判定出口要靠它判「这个名字我认不认得」。
 * 有 has 的原样交回去（那种夹具要测的正是认不认得）。
 */
function fixtureRegistry(registry: unknown): unknown {
  if (!registry || typeof registry !== 'object') return registry
  if (typeof (registry as { has?: unknown }).has === 'function') return registry
  return Object.assign({}, registry, { has: function () { return true } })
}

/**
 * 造一个判定出口桩。registry 是夹具自己那份注册表（真的或桩的都要有 select）。
 * 返回的函数形状与生产一致：`(cwd, opts) => { backendId, source, origin, canWrite, reason }`，
 * 壳怎么调生产那一个，就怎么调这一个（第二个参数是壳递进来的依赖袋，原样往下传）。
 */
export function makeDecideStub(registry: unknown): DecideFn {
  return async function decideBackendStub(cwd: unknown, opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const mod = await loadOutlet()
    if (!mod || typeof mod.decideBackend !== 'function') {
      // 判定出口这一份装载失败：按「没有后端」回，让门禁自己红在该红的那条断言上（不在这里编一个后端）。
      return { backendId: null, source: 'fallback', canWrite: false, reason: 'outlet-unavailable' }
    }
    const o: Record<string, unknown> = (opts && typeof opts === 'object') ? opts : {}
    const deps: Record<string, unknown> = Object.assign({}, o, {
      registry: fixtureRegistry(o.registry || registry),
      caller: o.caller || 'gate-decide-stub',
    })
    // 读文件那一条：壳给的读口（若有）先问，问不到再问夹具账本——账本正是夹具说
    // 「这个工作区选过了」的地方。生产那一条走的是真文件通道，这里替它的是同一件事的账本。
    const origRead = (typeof o.readWorkspaceFileText === 'function') ? o.readWorkspaceFileText as (cwd2: unknown) => Promise<string | null> : null
    deps.readWorkspaceFileText = async function (cwd2: unknown): Promise<string | null> {
      let text: string | null = null
      if (origRead) { try { text = await origRead(cwd2) } catch (e) { text = null } }
      if (!text) text = workspaceFileOf(cwd2)
      return text
    }
    if (typeof deps.parseWorkspaceFile !== 'function') {
      const anchor = await loadParser()
      if (anchor && typeof anchor.parseWorkspaceFile === 'function') deps.parseWorkspaceFile = anchor.parseWorkspaceFile
    }
    return await mod.decideBackend(String(cwd || ''), deps)
  }
}
