/**
 * src/host/choiceStore.ts —— 用户选的后端按工作区多存一份在宿主侧（#683 F1；2026-10-16 #1208 转成 TypeScript，只加类型标注与注释，逻辑一行未动）
 *
 * 为什么要有它（一句话）：用户选的后端只写在浏览器 localStorage 里，而 localStorage 按访问地址隔离 —— 换端口、换壳、换机器就整份失忆；宿主侧那条绑定只是进程内存，重启即丢，于是「既没有 .git 也没有锚文件」的目录每次都重新问一遍。这里存的就是那份跨重启、跨访问地址的记录（下面叫 H；规则全文与每条的理由见 docs/adr/20260921-persist-user-choice-host-side.md，这里不重复）。
 *
 * #1449 起布局答案不再存这里：布局的唯一真源是工作区里的配置文件（docs/agents/workspace.yaml），
 * 这里不再提供布局的读写口。文件里遗留的 layouts 栏只为把老数据原样带过去，不删、不再当答案读。
 *
 * 三条硬约束（改这个文件之前先看这三条）：
 *  1. 文件的家是 <用户主目录>/.dsh/mattskillsdeck/choices.json。**不许**改用 repoKeys.js 的 getCacheDir() ——
 *     那是 <DSH 进程启动目录>/.dsh-mattskillsdeck-cache，跟着进程启动目录跑（等于一半的记忆留在原地）。
 *  2. 写入必须原子：先写临时文件、再改名成正式文件；中途崩掉时正式文件仍是上一份完整可解析的内容。
 *  3. 文件里只存工作区键的散列，不落路径原文；散列只吃宿主规整后的那把键（客户端只送 cwd，不许参与算键）。
 *
 * 用的是 node:fs 而不是平台那套文件服务：这里的家在工作区之外，而平台的文件服务是 DSH 的文件沙箱
 *   （工作区之外写不进去 —— 磁盘缓存当初正是因为「~/.dsh 被拒」才搬到进程启动目录下的）；同层的
 *   updateStore.js 出于同一个原因也是直连 node:fs。fs 可以从外面换掉（门禁就是这么指到临时目录、制造改名失败的）。
 */
// 本域 tsconfig 有意不加载任何类型包（types 为空），node:crypto / node:fs/promises / node:path 的类型声明
// 随 @types/node 一起被挡在门外；运行时一定是 Node，这三个模块必然存在。所以只忽略导入这一行的类型错误
// （纯类型层面，不影响 esbuild 的运行时转译）——与 src/host/platform/index.ts 同一写法。
// @ts-expect-error
import { createHash, randomUUID } from 'node:crypto'
// @ts-expect-error
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
// @ts-expect-error
import { join } from 'node:path'
// 布局取值的唯一真源（#1342）：文件里遗留的布局记录仍按这份名单校验，但布局读写（#1449）已经搬走，不再对外提供。
import { DOC_LAYOUT_VALUES } from '../shared/doc-layout/src/layouts.js'
// 布局取值的类型也从真源取（#1342）：本文件不再手写 'single' | 'multi' 这份联合。
import type { DocLayoutValue } from '../shared/doc-layout/src/layouts.js'

// ---------------------------------------------------------------------------
// 类型（#1208 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：
//   1. 落盘文档（ChoicesDoc）是这份文件的契约 —— version 只认 CHOICES_VERSION 写下的那一个数字，
//      写错版本的文件整份不认（见 cleanChoices）。类型直接写成 typeof CHOICES_VERSION，以后改版本号
//      时类型跟着走，不会出现「类型说 1、常量说 2」的第二真相。
//   2. 文件里遗留的布局记录（老版本写下的）仍要用同一份取值名单校验：名单的唯一真源是
//      src/shared/doc-layout（#1342），本文件只消费；布局读写本身在 #1449 搬去了工作区文件，不再对外提供。
//   3. 从外面进来的东西（工作区键、后端名、布局取值、文件里读出的 JSON）一律按 unknown 收，收窄发生在
//      typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断（缺了判断就写进文件才是真正的错）。
// ---------------------------------------------------------------------------

/** 布局答案的取值：单上下文（根目录一份总表），还是多上下文（子项目各一份加一份总表）。 */
export type LayoutValue = DocLayoutValue

/** 单条后端记录：用户亲手选的后端、宿主发的修订号、记住的时间；来源恒为 user（探测结论不许写进来）。 */
export interface WorkspaceEntry { backendId: string; rev: number; pickedAt: number; source: 'user' }

/** 单条布局记录：布局答案加记住的时间（与后端记录同一套形状，只是没有修订号）。 */
export interface LayoutEntry { layout: LayoutValue; pickedAt: number }

/** 落盘文档 choices.json 整份的形状：版本号加两栏按散列键存放的记录。 */
export interface ChoicesDoc { version: typeof CHOICES_VERSION; workspaces: Record<string, WorkspaceEntry>; layouts: Record<string, LayoutEntry> }

/** 文件系统入口：生产走 node:fs，门禁从外面换成指到临时目录的那份（只用到这六个动作）。 */
export interface FsPort {
  mkdir(dir: string, opts?: unknown): Promise<unknown>
  readFile(path: string, encoding?: unknown): Promise<unknown>
  rename(oldPath: string, newPath: string): Promise<unknown>
  stat(path: string): Promise<{ size?: unknown }>
  unlink(path: string): Promise<unknown>
  writeFile(path: string, data: string, opts?: unknown): Promise<unknown>
}

/** 日志出口：R11 那五条轨迹就靠它；没给就一条都不记，不许抛错（见 createChoiceStore 入口）。 */
export interface LogCtx {
  fire(level: string, event: string, fields?: unknown): void
  isEnabled(level: string): boolean
}

/** 建 store 的全部依赖：文件系统与时间可换（门禁用它指临时目录、定时间），其余缺席时按安全方向默认。 */
export interface ChoiceStoreDeps {
  fs?: FsPort
  now?: () => number
  isKnownBackend?: (backendId: string) => boolean | Promise<boolean>
  maxWorkspaces?: number
  maxFileBytes?: number
  homeDir?: string
  getHome?: () => string | null | Promise<string | null>
  logCtx?: LogCtx | null
}

/** 读文件的三种结局（R5c）：missing 是没有文件（允许写第一笔），unreadable 是这次读不到（不采纳也不写）。 */
export interface DiskRead {
  ok: boolean
  missing: boolean
  unreadable: boolean
  reason: string
  data: ChoicesDoc
  dropped: number
}

/** 读后端记录的结果：没记过就是 found=false（调用方按没有处理，不当成有）；命中那条不带 reason。 */
export interface WorkspaceRead {
  ok: boolean
  found: boolean
  reason?: string
  backendId?: string
  rev?: number
  pickedAt?: number
}

/** 写后端记录的结果：ok 时 rev 是宿主新发的修订号，evicted 是这次淘汰掉的条数。 */
export interface RememberWorkspaceResult {
  ok: boolean
  reason: string
  rev: number
  pickedAt?: number
  evicted?: number
}

/** store 的四口加文件位置：读它的是两处（绑定写入与判定读取），实例全进程只有一份（见 platformChannel）。 */
export interface ChoiceStore {
  read(): Promise<DiskRead>
  getWorkspace(canonicalKey: unknown): Promise<WorkspaceRead>
  rememberWorkspace(canonicalKey: unknown, backendId: unknown): Promise<RememberWorkspaceResult>
  filePath(): Promise<string>
}

/** 宿主接线用的建库参数：主目录从哪来、注册表认不认这个后端（见 createChoiceStoreForHost）。 */
export interface HostChoiceDeps {
  getHome?: () => string | null | Promise<string | null>
  getTrackerRegistry?: () => unknown | Promise<unknown>
  logCtx?: LogCtx | null
}

// 文件位置（家目录下的三段）：<主目录>/.dsh/mattskillsdeck/choices.json
export const CHOICES_HOME_SEGMENT = '.dsh'
export const CHOICES_DIR_NAME = 'mattskillsdeck'
export const CHOICES_FILE_NAME = 'choices.json'
// 文件形状的版本号。写在文件里的这一位不认的（更高的、或根本没有的）当「这次读不到」处理： 宁可这一轮不用记忆，也不拿一份来路不明的文件去猜（降级方向是安全的，见 ADR 的 R5c）。
export const CHOICES_VERSION = 1
// 布局答案的取值只有这两种（根目录一份 GLOSSARY.md / 子项目各一份加一份 GLOSSARY-MAP.md）。
// 名单本身不在这里写：唯一真源是 src/shared/doc-layout/src/layouts.ts（#1342），本文件只拿它校验老数据。
// 上限（ADR 的 R8）：条数与文件体积。超过就按 pickedAt 从最旧的开始丢，只影响最旧的那些工作区。
export const DEFAULT_MAX_WORKSPACES = 200
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024

// 键的散列形态：sha256 取前 24 位十六进制（与 updateStore.js 的短指纹同一个取法）。
const HASH_RE = /^[0-9a-f]{24}$/
const FS_DEFAULT: FsPort = { mkdir: mkdir, readFile: readFile, rename: rename, stat: stat, unlink: unlink, writeFile: writeFile }

/** 这份状态文件的家目录（主目录下的 .dsh/mattskillsdeck）。 */
export function choicesDirectory(homeDir: unknown): string {
  return join(String(homeDir || ''), CHOICES_HOME_SEGMENT, CHOICES_DIR_NAME)
}

/** 这份状态文件的完整路径。主目录为空时返回空串（调用方按「拿不到主目录」处理）。 */
export function choicesFilePath(homeDir: unknown): string {
  if (!homeDir) return ''
  return join(choicesDirectory(homeDir), CHOICES_FILE_NAME)
}

/** 工作区键 → 散列。只散列给它的那一整串，不做任何规整、不读盘。 */
export function hashWorkspaceKey(canonicalKey: unknown): string {
  try {
    return createHash('sha256').update(String(canonicalKey == null ? '' : canonicalKey)).digest('hex').slice(0, 24)
  } catch (e) {
    return '000000000000000000000000'
  }
}

/** 空文件的内容形状。 */
export function emptyChoices(): ChoicesDoc {
  return { version: CHOICES_VERSION, workspaces: {}, layouts: {} }
}

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// 单条后端记录的形状校验（ADR 的 R5c：坏的单独丢掉，不让它把整份文件拖成「读不到」）。
function cleanWorkspaceEntry(raw: unknown): WorkspaceEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { backendId?: unknown; rev?: unknown; pickedAt?: unknown; source?: unknown }
  if (typeof r.backendId !== 'string' || !r.backendId) return null
  if (!Number.isInteger(r.rev) || (r.rev as number) < 1) return null
  if (!finiteNumber(r.pickedAt)) return null
  if (r.source !== 'user') return null
  return { backendId: r.backendId, rev: r.rev as number, pickedAt: r.pickedAt, source: 'user' }
}

// 单条布局记录的形状校验（与后端记录同一种形状，值只认单上下文 / 多上下文那两种）。
function cleanLayoutEntry(raw: unknown): LayoutEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { layout?: unknown; pickedAt?: unknown }
  if (typeof r.layout !== 'string' || DOC_LAYOUT_VALUES.indexOf(r.layout as LayoutValue) < 0) return null
  if (!finiteNumber(r.pickedAt)) return null
  return { layout: r.layout as LayoutValue, pickedAt: r.pickedAt }
}

/**
 * 把文件里读出来的东西洗成可用形状。
 * 返回 { ok:false, reason } 表示「这一次读不到」（根不是对象、版本号不认、某栏不是对象）；
 * 返回 { ok:true, data, dropped } 表示可用，dropped 是逐条丢掉的那些（形状不对的、键不是散列的）。
 */
export function cleanChoices(parsed: unknown): { ok: boolean; reason: string; data: ChoicesDoc; dropped: number } {
  const bad = function (reason: string): { ok: boolean; reason: string; data: ChoicesDoc; dropped: number } { return { ok: false, reason: reason, data: emptyChoices(), dropped: 0 } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('not-object')
  const p = parsed as { version?: unknown; workspaces?: unknown; layouts?: unknown }
  if (p.version !== CHOICES_VERSION) return bad('bad-version')
  if (p.workspaces !== undefined && (typeof p.workspaces !== 'object' || p.workspaces === null || Array.isArray(p.workspaces))) return bad('bad-workspaces')
  if (p.layouts !== undefined && (typeof p.layouts !== 'object' || p.layouts === null || Array.isArray(p.layouts))) return bad('bad-layouts')
  const data = emptyChoices()
  let dropped = 0
  Object.keys((p.workspaces || {}) as Record<string, unknown>).forEach(function (k) {
    const entry = cleanWorkspaceEntry((p.workspaces as Record<string, unknown>)[k])
    // 键也逐条校验：我们自己写进去的一定是散列，明文键只可能是别人手工放进去的（那种永远配不上任何工作区）。
    if (entry && HASH_RE.test(k)) data.workspaces[k] = entry
    else dropped += 1
  })
  Object.keys((p.layouts || {}) as Record<string, unknown>).forEach(function (k) {
    const entry = cleanLayoutEntry((p.layouts as Record<string, unknown>)[k])
    if (entry && HASH_RE.test(k)) data.layouts[k] = entry
    else dropped += 1
  })
  return { ok: true, reason: '', data: data, dropped: dropped }
}

function safeUuid(): string {
  try { return randomUUID() } catch (e) { return String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000000)) }
}

export function createChoiceStore(deps?: ChoiceStoreDeps): ChoiceStore {
  const input = deps || {}
  const fsPort = input.fs || FS_DEFAULT
  const nowFn: () => number = typeof input.now === 'function' ? input.now : Date.now
  // 注册表守卫（ADR 的 R5b）：只有注册表认得的后端才许写进来。没给守卫时按「谁都不认得」处理 —— 宁可写不进去（面板会如实说不成），也不许在最关键的那道判据缺失时默认放行。
  const isKnownBackend = input.isKnownBackend
  const maxWorkspaces = Number.isInteger(input.maxWorkspaces) && (input.maxWorkspaces as number) > 0 ? (input.maxWorkspaces as number) : DEFAULT_MAX_WORKSPACES
  const maxFileBytes = Number.isInteger(input.maxFileBytes) && (input.maxFileBytes as number) > 0 ? (input.maxFileBytes as number) : DEFAULT_MAX_FILE_BYTES
  const homeDirFixed = input.homeDir ? String(input.homeDir) : null
  const getHome = typeof input.getHome === 'function' ? input.getHome : null
  // #683 补线：日志出口（R11 那五条轨迹就靠它）。没给就一条都不记，不许抛错。
  const logCtx = input.logCtx || null

  // 工作区键的散列只在这里算：调用方给的是宿主规整后的那把键。
  function storeKeyOf(canonicalKey: unknown): string {
    return hashWorkspaceKey(canonicalKey)
  }

  // 进程内排队（ADR 的 R9）：两个窗口同时对同一个工作区写时，读-改-写必须一件一件来， 否则两边都读到同一份旧状态、各自算出一个 rev，先写的那次更新就被悄悄丢了。
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    queue = next.then(function () {}, function () {})
    return next
  }

  async function resolvePaths(): Promise<{ dir: string; file: string } | null> {
    let home = homeDirFixed
    if (!home && getHome) { try { home = await getHome() } catch (e) { home = null } }
    if (!home) return null
    const dir = choicesDirectory(home)
    return { dir: dir, file: join(dir, CHOICES_FILE_NAME) }
  }

  // 读这一份文件。三种结局分得很清楚（ADR 的 R5c）： 没有这个文件（missing）→ 当空，允许按 R1 的迁移分支写第一笔；
  //   这次读不到（unreadable）→ 这一轮既不采纳任何记忆、也不写（半截文件不许把旧状态重新灌进来）； 读到了（ok，data 已被逐条校验过）。
  async function readFromDisk(): Promise<DiskRead> {
    const paths = await resolvePaths()
    // #683（F1 · ADR 的 R11）：文件坏与「文件没有」是两件事，坏的那一档要留痕（R5c 要求一条 warn）—— 它以后查「为什么这个工作区每次都重新问一遍」时是唯一的线索。同一种原因每个进程只记第一条：
    //   一个长期坏掉的文件（例如被更高版本写过）会让每一次探测都走到这里，不节流就是刷屏。
    const bad = function (reason: string): DiskRead {
      try { if (logCtx && typeof logCtx.fire === 'function' && lastBadReason !== reason) { lastBadReason = reason; logCtx.fire('warn', 'choiceStore.file.bad', { reason: reason }) } } catch (eL) {}
      return { ok: false, missing: false, unreadable: true, reason: reason, data: emptyChoices(), dropped: 0 }
    }
    if (!paths) return bad('no-home')
    let text: unknown = null
    try {
      const st = await fsPort.stat(paths.file)
      if (st && finiteNumber(st.size) && st.size > maxFileBytes) return bad('too-large')
      text = await fsPort.readFile(paths.file, 'utf8')
    } catch (e) {
      if (e && ((e as { code?: unknown }).code === 'ENOENT' || (e as { code?: unknown }).code === 'ENOTDIR' || (e as { code?: unknown }).code === 'FS_NOT_FOUND')) return { ok: true, missing: true, unreadable: false, reason: 'missing', data: emptyChoices(), dropped: 0 }
      return bad('read-fail')
    }
    let parsed: unknown = null
    try { parsed = JSON.parse(String(text == null ? '' : text)) } catch (e) { return bad('not-json') }
    const cleaned = cleanChoices(parsed)
    if (!cleaned.ok) return bad(cleaned.reason)
    return { ok: true, missing: false, unreadable: false, reason: '', data: cleaned.data, dropped: cleaned.dropped }
  }

  // 落盘：临时文件 + 改名（ADR 的 R7）。改名之前崩掉时，正式文件仍是上一份完整内容。
  async function writeToDisk(data: ChoicesDoc): Promise<{ ok: boolean; reason: string }> {
    const paths = await resolvePaths()
    if (!paths) return { ok: false, reason: 'no-home' }
    const body = JSON.stringify(data, null, 2) + '\n'
    const tmp = paths.file + '.' + safeUuid() + '.tmp'
    try {
      await fsPort.mkdir(paths.dir, { recursive: true, mode: 0o700 })
      await fsPort.writeFile(tmp, body, { mode: 0o600, flag: 'wx' })
      await fsPort.rename(tmp, paths.file)
    } catch (e) {
      // 收拾自己留下的临时文件；收拾不掉也不影响「正式文件没被动过」这个结论。
      try { await fsPort.unlink(tmp) } catch (e2) {}
      return { ok: false, reason: 'write-fail' }
    }
    return { ok: true, reason: '' }
  }

  // 上限三条（ADR 的 R8）：先按条数丢最旧的，再按文件体积继续丢，直到装得下。 protectKey 是这一次刚写下去的那一条 —— 用户刚点的那一下不许被体积上限挤掉。
  function oldestKey(map: Record<string, { pickedAt: number }>, protectKey: string | null): string | null {
    let best: string | null = null
    Object.keys(map).forEach(function (k) {
      if (k === protectKey) return
      const r = map[k]
      if (!best) { best = k; return }
      const br = map[best]
      if (r.pickedAt < br.pickedAt) best = k
      else if (r.pickedAt === br.pickedAt && k < best) best = k
    })
    return best
  }
  function boundCount(map: Record<string, { pickedAt: number }>, maxCount: number, protectKey: string | null): number {
    let dropped = 0
    let guard = 0
    while (Object.keys(map).length > maxCount && guard < 100000) {
      guard += 1
      const victim = oldestKey(map, protectKey)
      if (!victim) break
      delete map[victim]
      dropped += 1
    }
    return dropped
  }
  function boundBytes(data: ChoicesDoc, protectKey: string): number {
    let dropped = 0
    let guard = 0
    while (JSON.stringify(data, null, 2).length + 1 > maxFileBytes && guard < 100000) {
      guard += 1
      const victim = oldestKey(data.workspaces, protectKey)
      if (!victim) break
      delete data.workspaces[victim]
      dropped += 1
    }
    return dropped
  }
  function boundAll(data: ChoicesDoc, protectKey: string): number {
    // 只淘汰后端记录：布局那栏是历史数据，不删（#1449）。
    let dropped = 0
    dropped += boundCount(data.workspaces, maxWorkspaces, protectKey)
    dropped += boundBytes(data, protectKey)
    return dropped
  }

  // 读一份记录时记一行（ADR 的 R11：H 命中 / 未命中）。这是高频路径（每次探测都经过）， 按需级、同一行先判开关，关着连字段对象都不组装。
  let lastBadReason = ''
  function fireRead(keyHash: string, outcome: 'hit' | 'miss'): void { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'choiceStore.read', { keyHash: keyHash, outcome: outcome }) } catch (eL) {} }

  /** 这一次到底读到了什么（给排查与门禁用；正常读取走下面的 getWorkspace）。 */
  async function read(): Promise<DiskRead> {
    return readFromDisk()
  }

  /** 按工作区键读一条后端记录。没记过就是 found=false。 */
  async function getWorkspace(canonicalKey: unknown): Promise<WorkspaceRead> {
    const key = storeKeyOf(canonicalKey)
    if (!key) return { ok: false, found: false, reason: 'no-key' }
    const cur = await readFromDisk()
    if (cur.unreadable) return { ok: false, found: false, reason: cur.reason }
    const rec = cur.data.workspaces[key]
    if (!rec) { fireRead(key, 'miss'); return { ok: true, found: false, reason: 'miss' } }
    fireRead(key, 'hit')
    return { ok: true, found: true, backendId: rec.backendId, rev: rec.rev, pickedAt: rec.pickedAt }
  }

  /**
   * 记住「用户亲手选的这个后端」并回一个新的修订号。
   * 「用户亲手选的」只有两条路会走到这里（ADR 的 R1）：用户点确认的那通电话，和客户端报上来一条
   * 宿主还没记过的选择时的一次性迁移。探测结论（锚文件、自动识别、兜底）一律不许写进来。
   */
  async function rememberWorkspace(canonicalKey: unknown, backendId: unknown): Promise<RememberWorkspaceResult> {
    return serial(async function () {
      const key = storeKeyOf(canonicalKey)
      if (!key || !canonicalKey) return { ok: false, reason: 'no-key', rev: 0 }
      if (backendId === null || backendId === undefined || String(backendId) === '') return { ok: false, reason: 'reject-null', rev: 0 }
      if (typeof isKnownBackend !== 'function') return { ok: false, reason: 'no-registry-guard', rev: 0 }
      let known = false
      try { known = !!(await isKnownBackend(String(backendId))) } catch (e) { known = false }
      if (!known) return { ok: false, reason: 'reject-unknown-backend', rev: 0 }
      const cur = await readFromDisk()
      // 文件坏的那一轮不写（R5c）：否则会把「暂时读不到」变成一个只剩这一条的新文件。
      if (cur.unreadable) return { ok: false, reason: cur.reason, rev: 0 }
      const data = cur.data
      const prev = data.workspaces[key]
      const rev = ((prev && Number.isInteger(prev.rev)) ? prev.rev : 0) + 1
      const pickedAt = nowFn()
      data.workspaces[key] = { backendId: String(backendId), rev: rev, pickedAt: pickedAt, source: 'user' }
      const dropped = boundAll(data, key)
      // ADR 的 R11：淘汰（超过条数或体积上限时丢了最旧的几条）。低频、按需级。
      try { if (dropped > 0 && logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'choiceStore.evict', { count: dropped, max: maxWorkspaces }) } catch (eL) {}
      const w = await writeToDisk(data)
      if (!w.ok) {
        // ADR 的 R7c/R11：写失败要看得见（界面那边靠回包的 persisted:false 说一句，这里留一行可回看的轨迹）。
        try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'choiceStore.write.fail', { keyHash: key, reason: w.reason }) } catch (eL) {}
        return { ok: false, reason: w.reason, rev: 0 }
      }
      return { ok: true, reason: '', rev: rev, pickedAt: pickedAt, evicted: dropped }
    })
  }

  return {
    read: read,
    getWorkspace: getWorkspace,
    rememberWorkspace: rememberWorkspace,
    filePath: async function (): Promise<string> { const p = await resolvePaths(); return p ? p.file : '' },
  }
}

export default createChoiceStore

/**
 * 宿主接线用的构造口：把「主目录从哪来」与「注册表认不认得这个后端」这两件事包成 store 的依赖，免得这两句判断散在接线处（接线文件都已贴着行数上限）。全进程只建一份（那条读-改-写队列必须只有一条），实例由 platformChannel 单点持有、两处调用方共用。
 */
export function createChoiceStoreForHost(input?: HostChoiceDeps): ChoiceStore {
  const o = input || {}
  const isKnownBackend = async function (id: string): Promise<boolean> { try { const reg = (o.getTrackerRegistry ? await o.getTrackerRegistry() : null) as { has?: unknown } | null; return !!(reg && typeof reg.has === 'function' && (reg.has as (backendId: string) => unknown)(id)) } catch (e) { return false } }
  return createChoiceStore({ getHome: o.getHome, isKnownBackend: isKnownBackend, logCtx: o.logCtx })
}
