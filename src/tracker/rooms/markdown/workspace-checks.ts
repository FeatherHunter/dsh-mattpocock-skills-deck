// src/tracker/rooms/markdown/workspace-checks.ts —— 本地 Markdown 检查链三项判据的唯一实现（#1513）。
//
// 为什么单开一份、而且放在房间层：这三项既要在宿主的检查链里逐项求值（src/host/remotePredicates.ts 经
//   src/tracker/registry/builtins.ts 的装配口取用），又要在本房自己的 preflight 里汇总成「这个工作区能不能
//   当本地 Markdown 票仓」的一句话（src/tracker/rooms/markdown/index.ts）。票面硬条件是两边共用同一套判据，
//   所以实现只能有一份：宿主不许深引房间内部，只能经装配口拿；房间 preflight 直接调本文件，不经过宿主。
//
// 三项判据与档位（#1512 的 D0 判定表，验收口径）：
//   1. md:workspace          通过 = 有工作单元，或工作区确实是空的；失败 = .scratch 读不出来。
//   2. md:scratchWritable    当前无法安全验证可写性，始终返回 pending。
//   3. md:containersReadable 通过 = 没有容器文件，或全部读得动且文件头格式是 md-v1；
//                            失败 = 某个容器文件读不出，或声明了不认识的版本。
//
// 未验证的可写性返回 pending，不创建或删除任何文件；新工作区没有 .scratch 仍是正常状态。
import type { OpContext, SandboxFs, BackendPlatform } from '../../contract/contexts.js'
import { listWorkUnits, getCwd, getPlat } from './issues-locate.js'
import { listDir, readTextFile, exists, statFile, visibleNamesOf } from './read.js'
import { SUPPORTED_DSH_FORMATS, dshFormatOf, isSupportedDshFormat } from './original-fields.js'
// 取出工作单元清单里的类型只用于给人看的文案，不参与运行时。
import type { WorkUnit } from './issues-locate.js'
// 一趟检查里两项判据共用同一份 `.scratch` 根目录列举结果（#1528）；为什么要按文件服务对象与一秒窗口
//   共用、以及哪些做法是反例，都写在这一份里。
import { scratchRootListingOf } from './scratch-listing.js'
import type { ScratchListingRound } from './scratch-listing.js'

/** 三项判据在检查链里的 id（与 src/shared/tracker/check-catalog-dirs.ts 的 MARKDOWN_CATALOG 逐字对齐）。 */
export type WorkspaceCheckId = 'md:workspace' | 'md:scratchWritable' | 'md:containersReadable'

export type WorkspaceCheckStatus = 'pass' | 'fail' | 'pending'

/**
 * 一项判据的结论：status 三档，detail 是给人看的证据（什么路径、看到了什么、为什么这么判）。
 *
 * evidence 是给日志用的短机器证据（#1514）：detail 里带绝对路径与完整错误原文，适合进界面，
 *   不适合一行行写进诊断日志；evidence 只留「看结论就知道该去查什么」的一小截（例如 units=3、
 *   probe=.scratch、sbx-deny、containers=0、error=ENOENT），绝不放路径原文。没给就是这一项没有
 *   适合记的短证据，日志里记空串。
 */
export interface WorkspaceCheckResult {
  status: WorkspaceCheckStatus
  detail: string
  evidence?: string
}

/**
 * 三项判据的输入：宿主侧 PredicateContext 与房间侧 OpContext 都能直接喂的形状。
 *
 * 为什么用「deps 形态」而不是直接收 OpContext：宿主谓词手里只有 platform（Platform）与 cwd、lang，
 *   OpContext 还要求 signal、exec 等一整套房间上下文；为了共用判据去宿主编一套假的 OpContext，
 *   会让「哪些格是真的」变成一笔糊涂账。这里只收判据真正用到的四格，内部再拼一个最小的房间上下文。
 */
export interface WorkspaceCheckDeps {
  /** 宿主 Platform（或任何带 fs/path 的对象）；房间侧通常给 ctx 本身。 */
  platform?: unknown
  /** 仓库根目录（宿主把工作区挂在 cwd 上）。必须是字符串；不是时抛错，由调用方按「环境没准备好」处理。 */
  cwd?: unknown
  /** 语言：'en' 时出英文文案，其余出中文。 */
  lang?: string
  /** 本次调用的沙箱写许可；当前可写性检查不会写入。 */
  sandboxPolicy?: unknown
  /**
   * 同一趟房间预检的标记：runWorkspaceChecks 每趟新建一个对象并交给三项判据，让 `.scratch` 根目录的列举
   *   在这一趟里只做一次（#1528）。宿主链逐项调用时不带这个标记，判据退到按文件服务对象的短时共用。
   */
  listingRound?: ScratchListingRound
}

export type WorkspaceCheckFn = (deps: WorkspaceCheckDeps) => Promise<WorkspaceCheckResult>

/** 判据用到的文件服务成员（宿主 Platform 的 fs 与房间 SandboxFs 都长这样，多出来的能力不管）。 */
type LooseFs = {
  resolve?: (path: string, opts?: unknown) => Promise<unknown>
  readText?: (path: unknown) => Promise<unknown>
  writeText?: (path: unknown, text: string, ...rest: unknown[]) => Promise<unknown>
  unlink?: (path: unknown) => Promise<unknown>
  rm?: (path: unknown, opts?: unknown) => Promise<unknown>
  delete?: (path: unknown) => Promise<unknown>
  stat?: (path: unknown) => Promise<unknown>
  lstat?: (path: unknown) => Promise<unknown>
  access?: (path: unknown) => Promise<unknown>
}

function isEn(deps: WorkspaceCheckDeps): boolean {
  return !!deps && deps.lang === 'en'
}
function pick(deps: WorkspaceCheckDeps, zh: string, en: string): string {
  return isEn(deps) ? en : zh
}

/** 错误码：优先取错误自身的 code，再取 cause 的 code（房间读路径会把原始错误挂在 cause 上）。 */
function errorCodeOf(e: unknown): string {
  const root = e as Record<string, unknown> | null | undefined
  const cause = root && (root.cause as Record<string, unknown> | null | undefined)
  const codes: unknown[] = [root && root.code, cause && cause.code]
  for (const c of codes) { if (c) return String(c) }
  return ''
}
/** 错误原文：code + message；取不到 code 时只留 message，别把整个对象倒进界面。 */
function errorTextOf(e: unknown): string {
  const root = e as Record<string, unknown> | null | undefined
  const msg = String((root && (root.message || root.stderr || root.stdout)) || e || '')
  const code = errorCodeOf(e)
  return code && msg.indexOf(code) < 0 ? code + ': ' + msg : msg
}
/**
 * 拼一个最小的房间上下文：只填判据真正会读的那几格（cwd、platform.fs、platform.path）。
 *
 * 为什么不直接要求调用方传 OpContext：宿主侧没有 signal/exec 这些房间成员；判据也用不到。
 * 为什么 cwd 不是字符串时要抛错：房间的路径拼接在非字符串上会抛 TypeError，preflight 靠这个异常
 *   落到「预检中途出错」那一档（历史夹具 tests/verify-1058-markdown-read-log.ts 第六节就是拿非字符串 cwd
 *   钉这条行为）；如果这里把它悄悄换成 process.cwd()，就会拿插件进程自己的目录冒充用户工作区。
 */
function roomCtxOf(deps: WorkspaceCheckDeps): OpContext {
  const cwd = deps && deps.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new TypeError('workspace cwd is not a usable directory path: ' + String(cwd))
  }
  const p = deps.platform as Record<string, unknown> | null | undefined
  const fsObj = p && (p.fs as SandboxFs | undefined)
  const pathObj = p && (p.path as BackendPlatform['path'] | undefined)
  const out: Record<string, unknown> = { cwd: cwd, lang: deps.lang, sandboxPolicy: deps.sandboxPolicy }
  if (fsObj) { out.fs = fsObj; out.platform = { fs: fsObj, path: pathObj } }
  if (pathObj) out.path = pathObj
  return out as unknown as OpContext
}
function fsOf(ctx: OpContext): LooseFs | null {
  const c = ctx as unknown as Record<string, unknown>
  const platform = c && (c.platform as Record<string, unknown> | null | undefined)
  if (platform && platform.fs) return platform.fs as LooseFs
  if (c && c.fs) return c.fs as LooseFs
  if (c && typeof c.get === 'function') { try { const f = (c.get as (n: string) => unknown)('fs'); if (f) return f as LooseFs } catch (e) {} }
  return null
}
/** 一个工作单元给人看的名字：目录名不足以说明它是地图、规格还是票目录，所以两样都写。 */
function unitLabel(u: WorkUnit): string {
  if (u && u.legacy) return '工作区根 issues/（旧版布局）'
  const kind = u && u.kind === 'map' ? '探索地图' : (u && u.kind === 'spec' ? '规格' : '票目录')
  const where = u && u.effortId ? String(u.effortId) : '根级'
  return where + '（' + kind + '）'
}

/**
 * md:workspace —— 问「有没有能用的票/地图/规格？」。
 *
 * 为什么空工作区也算通过：全新工作区还没有任何工作单元是正常起点，不是故障；要让人从这里开始建票、
 *   建图，预检就不该把「还没开始」判成「这个工作区不能用本地 Markdown」。
 * 为什么读不出来要判失败：.scratch 在、却列不出来，那是权限或设备故障，绝不是「一个工作单元都没有」；
 *   把读失败说成空工作区，会让界面回一个看起来正常、实际错误的空清单（#1174 要根治的那类谎话）。
 */
export async function checkWorkspace(deps: WorkspaceCheckDeps): Promise<WorkspaceCheckResult> {
  const ctx = roomCtxOf(deps)
  const plat = getPlat(ctx)
  const cwd = getCwd(ctx)
  const root = plat.join(cwd, '.scratch')
  try {
    // 先把 `.scratch` 根目录列一次，交给 listWorkUnits；md:containersReadable 再用同一份。
    //   为什么这样只列一次盘、什么时候会重列，见 './scratch-listing.js' 的说明（#1528）。
    const rootListing = await scratchRootListingOf(fsOf(ctx), ctx, root, (deps && deps.listingRound) || null)
    const units = await listWorkUnits(ctx, rootListing)
    if (!units || units.length === 0) {
      return {
        status: 'pass',
        evidence: 'units=0',
        detail: pick(deps,
          '空工作区：' + root + ' 里还没有任何工作单元（没有 map.md / spec.md / issues/），可以从这里开始建票、建图',
          'empty workspace: no work units under ' + root + ' yet (no map.md / spec.md / issues/); tickets and maps can start from here'),
      }
    }
    const shown = units.slice(0, 8).map(unitLabel).join('、')
    const more = units.length > 8 ? pick(deps, ' 等 ' + units.length + ' 个', ' and ' + (units.length - 8) + ' more') : ''
    return {
      status: 'pass',
      evidence: 'units=' + units.length,
      detail: pick(deps,
        '找到 ' + units.length + ' 个工作单元：' + shown + more,
        'found ' + units.length + ' work unit(s): ' + shown + more),
    }
  } catch (e) {
    const evidence = errorTextOf(e)
    return {
      status: 'fail',
      evidence: 'error=' + (errorCodeOf(e) || 'unknown'),
      detail: pick(deps,
        '读不出工作区目录 ' + root + '：' + evidence,
        'cannot read the workspace dir ' + root + ': ' + evidence),
    }
  }
}

/** 不写探针：文件服务没有经核验的带版本条件删除，无法安全清理。 */
export async function checkScratchWritable(deps: WorkspaceCheckDeps): Promise<WorkspaceCheckResult> {
  // .scratch 尚不存在是新工作区的正常状态；仓库根的可写性同样无法安全验证。
  return {
    status: 'pending',
    evidence: 'writability-unverified',
    detail: pick(deps,
      '未进行写入探测，无法验证本地数据目录 .scratch 或工作区根目录是否可写；操作不受阻断，但实际写入可能失败',
      'no write probe was attempted; writability of the local data directory .scratch or workspace root is unverified; operations are not blocked, but actual writes may fail'),
  }
}

/** stat 结果里有没有「这是一个目录」的明说；问不出就回 null（不拿它当证据）。 */
function statIsDir(st: unknown): boolean | null {
  const obj = st as { isDirectory?: unknown } | null | undefined
  if (obj && typeof obj.isDirectory === 'function') {
    try { return !!(obj.isDirectory as () => boolean)() } catch (e) { return null }
  }
  return null
}

/** collectContainers 的两种结果：拿到候选文件，或列目录这一步就读不出来（带两份语言的证据）。 */
type ContainerCollect = { ok: true; files: string[] } | { ok: false; detailZh: string; detailEn: string }

/**
 * 收集容器文件：.scratch 根级的 map.md / spec.md，以及 .scratch/<目录>/ 里的 map.md / spec.md。
 *
 * 为什么先列目录再决定读哪些、而不是对每个可能名字问 exists：exists 会把「读不出来」吞成 false，
 *   于是权限坏掉的容器文件会被当成「没有」；列目录失败或单文件读失败都能留下可指认的证据。
 * 为什么列出的名字还要再列一层：容器按「工作单元目录」摆放（.scratch/<目录>/map.md），目录名本身
 *   没有约定，只能逐个目录看里面有没有容器文件。
 */
async function collectContainers(ctx: OpContext, round: ScratchListingRound | null): Promise<ContainerCollect> {
  const plat = getPlat(ctx)
  const cwd = getCwd(ctx)
  const root = plat.join(cwd, '.scratch')
  // 与 md:workspace 共用同一份根目录列举结果（#1528）：两项判据要的是同一份名字表，一趟检查里只列一次盘。
  const rootListing = (await scratchRootListingOf(fsOf(ctx), ctx, root, round)).listing
  if (!rootListing.ok) {
    if (rootListing.missing) return { ok: true, files: [] }
    const evidence = errorTextOf(rootListing.error)
    return {
      ok: false,
      detailZh: '列不出本地数据目录 ' + root + '：' + evidence,
      detailEn: 'cannot list the local data dir ' + root + ': ' + evidence,
    }
  }
  const names = visibleNamesOf(rootListing.names).sort()
  const files: string[] = []
  for (const f of ['map.md', 'spec.md']) {
    if (names.indexOf(f) >= 0) files.push(plat.join(root, f))
  }
  for (const name of names) {
    // 根级那两个容器文件上面看过了，不再当目录去列。
    if (name === 'map.md' || name === 'spec.md') continue
    const dir = plat.join(root, name)
    const listing = await listDir(ctx, dir)
    if (!listing.ok) {
      if (listing.missing) continue
      // 这一层不是目录（或列不出来）：先问 stat 是不是文件；明说是文件就跳过，问不出来才判失败。
      const isDir = statIsDir(await statFile(ctx, dir))
      if (isDir === false) continue
      if (isDir === true) {
        const evidence = errorTextOf(listing.error)
        return {
          ok: false,
          detailZh: '列不出工作单元目录 ' + dir + '：' + evidence,
          detailEn: 'cannot list the work-unit dir ' + dir + ': ' + evidence,
        }
      }
      continue
    }
    for (const f of ['map.md', 'spec.md']) {
      if (listing.names.indexOf(f) >= 0) files.push(plat.join(dir, f))
    }
  }
  return { ok: true, files: files }
}

/**
 * md:containersReadable —— 问「工作区里的容器文件读得动吗？版本字头认识吗？」。
 *
 * 通过条件：没有容器文件（全新工作区），或每个容器文件都读得动、且文件头 DSH-FORMAT 是支持的版本。
 * 版本判断只认 ./original-fields.ts 的三个既有常量/函数（SUPPORTED_DSH_FORMATS / dshFormatOf /
 *   isSupportedDshFormat），不在这里另造一套格式识别：手写的旧文件没有 DSH-FORMAT 行，按 v1 可读。
 * 为什么读失败要 fail 而不是 pass：容器就是地图与规格，读不动它们，后面「从地图取票」每一步都会失败；
 *   预检提前点名哪个文件读不出，比让用户在一张空清单里猜要好。
 */
export async function checkContainersReadable(deps: WorkspaceCheckDeps): Promise<WorkspaceCheckResult> {
  const ctx = roomCtxOf(deps)
  const en = isEn(deps)
  let collected: ContainerCollect
  try {
    collected = await collectContainers(ctx, (deps && deps.listingRound) || null)
  } catch (e) {
    const evidence = errorTextOf(e)
    return { status: 'fail', evidence: 'error=' + (errorCodeOf(e) || 'unknown'), detail: pick(deps, '列容器文件时出错：' + evidence, 'failed while listing container files: ' + evidence) }
  }
  if (!collected.ok) {
    return { status: 'fail', evidence: 'list-fail', detail: en ? collected.detailEn : collected.detailZh }
  }
  const files = collected.files
  if (!files.length) {
    const plat = getPlat(ctx)
    const root = plat.join(getCwd(ctx), '.scratch')
    return {
      status: 'pass',
      evidence: 'containers=0',
      detail: pick(deps, '没有容器文件（' + root + ' 里还没有 map.md / spec.md）', 'no container files yet (no map.md / spec.md under ' + root + ')'),
    }
  }
  for (const filePath of files) {
    let text = ''
    try {
      text = String(await readTextFile(ctx, filePath))
    } catch (e) {
      const evidence = errorTextOf(e)
      return {
        status: 'fail',
        evidence: 'read-fail',
        detail: pick(deps, '读不出容器文件 ' + filePath + '：' + evidence, 'cannot read the container file ' + filePath + ': ' + evidence),
      }
    }
    if (!isSupportedDshFormat(text)) {
      const fmt = dshFormatOf(text) || '（空）'
      const supported = SUPPORTED_DSH_FORMATS.join(' / ')
      return {
        status: 'fail',
        evidence: 'bad-format',
        detail: pick(deps,
          '容器文件 ' + filePath + ' 声明了不支持的格式 ' + fmt + '（这台插件只支持 ' + supported + '）',
          'the container file ' + filePath + ' declares an unsupported format ' + fmt + ' (this plugin supports ' + supported + ' only)'),
      }
    }
  }
  const shown = files.slice(0, 8).join('、')
  return {
    status: 'pass',
    evidence: 'containers=' + files.length,
    detail: pick(deps,
      '读到 ' + files.length + ' 个容器文件，都读得动、格式版本是 md-v1：' + shown,
      files.length + ' container file(s) are readable and all are md-v1: ' + shown),
  }
}

/** 三项判据的固定顺序：宿主注册、preflight 汇总、门禁断言都照这一份走，不各写一套顺序。 */
const CHECK_ORDER: ReadonlyArray<WorkspaceCheckId> = Object.freeze(['md:workspace', 'md:scratchWritable', 'md:containersReadable'])

/**
 * 三项判据给人看的名字（中英各一份，只在这一处定义）。
 *
 * 为什么判据模块自己带名字：房间 preflight 失败时要用人话说清「哪一项没过」，
 *   而检查目录里那套 label 属于宿主检查链的展示层，房间不该去 import 它；两处各写一份又会走样。
 * 与检查目录行标题（`config/copy/word.yaml` 的 `check.md:*`，例如「本地工作区可读取」）不是同一句话：
 *   那边是状态中性的行标题（pass 与 fail 同一句，全仓既有约定），这里是接在「预检没过：」后面的一句问句；
 *   两种句子各自读得通，不能互换——把行标题塞进失败句会读成「预检没过：本地工作区可读取」。
 */
const CHECK_LABELS: Readonly<Record<WorkspaceCheckId, { zh: string; en: string }>> = Object.freeze({
  'md:workspace': { zh: '本地工作区能不能读', en: 'whether the local workspace can be read' },
  'md:scratchWritable': { zh: '本地数据目录能不能写', en: 'whether the local data directory can be written' },
  'md:containersReadable': { zh: '本地地图与规格文件能不能读', en: 'whether the local map and spec files can be read' },
})

/** 取一项判据给人看的名字；未知 id 原样交回，便于排查是谁传错了。 */
export function workspaceCheckLabel(id: string, lang?: string): string {
  const row = (CHECK_LABELS as Record<string, { zh: string; en: string } | undefined>)[id]
  if (!row) return id
  return lang === 'en' ? row.en : row.zh
}

/** 按 id 取一项判据（宿主谓词按检查项 id 分派时用）。收不带 md: 前缀的短 id，省调用方再拼一次。 */
export function workspaceCheckOf(id: string): WorkspaceCheckFn | null {
  if (id === 'md:workspace' || id === 'workspace') return checkWorkspace
  if (id === 'md:scratchWritable' || id === 'scratchWritable') return checkScratchWritable
  if (id === 'md:containersReadable' || id === 'containersReadable') return checkContainersReadable
  return null
}

/** 一项判据跑完交回的形状：id、结论，以及这一项自己花了多久（毫秒，给日志用）。 */
export interface WorkspaceCheckRow {
  id: WorkspaceCheckId
  result: WorkspaceCheckResult
  latencyMs: number
}

/**
 * 房间 preflight 用的汇总：按固定顺序跑完三项，把每项结论原样交回，并各带一项自己的耗时。
 *
 * 只做「跑」和「交回」，怎么把结论收成 preflight 的一句话由房间决定（#1513 起房间不再自己找 map.md）。
 * 为什么在这里记耗时（#1514）：三项各有自己的边界日志，日志要回答「这一项慢在哪」；耗时只能在这一层量，
 *   再往下传到具体判据里，判据本身反倒要为日志背一笔不相关的账。
 * #1528：这一层还给三项判据发同一个「趟标记」——三项仍逐个独立求值、各出各的结论，只是共用这一趟里
 *   `.scratch` 根目录的同一份列举结果。
 */
export async function runWorkspaceChecks(deps: WorkspaceCheckDeps): Promise<WorkspaceCheckRow[]> {
  const out: WorkspaceCheckRow[] = []
  // 一趟预检共用一个趟标记：三项判据仍各自独立求值，但 `.scratch` 根目录的列举在这一趟里只做一次（#1528）。
  const round: ScratchListingRound = {}
  const scopedDeps: WorkspaceCheckDeps = Object.assign({}, deps, { listingRound: round })
  for (const id of CHECK_ORDER) {
    const fn = workspaceCheckOf(id) as WorkspaceCheckFn
    const startedAt = Date.now()
    const result = await fn(scopedDeps)
    out.push({ id: id, result: result, latencyMs: Date.now() - startedAt })
  }
  return out
}
