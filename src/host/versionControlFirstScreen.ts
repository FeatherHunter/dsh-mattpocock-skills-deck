/**
 * src/host/versionControlFirstScreen.ts —— 首屏一次取全的聚合电话体（#1739 T04）
 *
 * 规格 #1586 第 9 节：首屏一次聚合调用返回七片（工作区状态、改动、提交历史首页、工作树、贮藏、
 * 同步带、版本与能力开关），各自失败互不影响，失败项单独显示失败态；不做「先给半份再慢慢补」。
 *
 * 为什么搬成自包含叶子：src/host/versionControl.ts 贴着 350 有效行上限（只剩个位数余量），
 * 聚合读数体量又大，照 ./versionControlFiles.js、./versionControlBasis.js 同一先例搬出来；
 * 依赖全部显式传入，叶子不引用父文件，单向依赖。
 *
 * 复用与新建（票面验收③逐项写清）：
 *   - 复用已有只读方法：第 0 步与仓库根 resolveRepoRoot、钉死目录的 collect（状态/分支/历史/逐文件行数）、
 *     worktree -z 与老版本退回、标记探测 markers、换行配置 readAutocrlf、依据时间 basisReader、assemble 组装。
 *   - 本票新建：贮藏列表读音（git stash list，命令原文在共享层 commands.ts 的 stashListArgs、解析在
 *     parse-stash.ts，给 T16 的 7.4 供同一份数据）；同步带读数（把 status 的上游/领先/落后/依据时间
 *     单独投影成一片，供顶部同步带直接读，不必再解析整份工作区）。
 *
 * 每片内部自己 try/catch：一条 git 命令失败只把该片标 err，绝不整体失败；返回的聚合回包永远是
 * {ok:true, firstScreen:版本化快照}，传输成功与数据成败分开（客户端按片画成败）。
 */
import { commandFor, stashListArgs } from '../shared/version-control/src/commands.js'
import { parseVersion, tierFor, capabilityAvailability } from '../shared/version-control/src/capabilities.js'
import { parseStatus } from '../shared/version-control/src/parse-status.js'
import { parseWorktrees } from '../shared/version-control/src/parse-worktrees.js'
import { parseRefs } from '../shared/version-control/src/parse-refs.js'
import { parseLog } from '../shared/version-control/src/parse-log.js'
import { parseDiffFiles } from '../shared/version-control/src/parse-diff-files.js'
import { parseStashList } from '../shared/version-control/src/parse-stash.js'
import { assemble } from '../shared/version-control/src/state.js'
import { CAPABILITIES } from '../shared/version-control/src/capability-ledger.js'
import { FIRST_SCREEN_CONTRACT, FIRST_SCREEN_VERSION, FIRST_SCREEN_SLICES, firstScreenSliceErrorOf } from '../shared/version-control/src/first-screen.js'

const FLOOR_TEXT: string = '2.11'

function okSlice(data: any): any { return { state: 'ok', data: data, error: null } }
function errSlice(kind: any, message: any): any { return { state: 'err', data: null, error: firstScreenSliceErrorOf(kind, message) } }

/** 失败信封（failPhone 的形状）转一片失败态；拿不到规范字段时按 unknown 归一，绝不把 undefined 画出去。 */
function errOfEnvelope(env: any, fallback: string): any {
  const e: any = env && env.error
  if (e && typeof e.kind === 'string') return errSlice(e.kind, e.message)
  if (env && typeof env.kind === 'string') return errSlice(env.kind, env.message || fallback)
  return errSlice('unknown', fallback)
}

/** 单个只读步骤的选题器：把「抛异常」也收成失败值，聚合体任何一处都不许让整份快照炸掉。 */
async function readPart(what: string, run: any): Promise<any> {
  try {
    const r: any = await run()
    if (r && r.ok === true) return { ok: true, value: r.parsed !== undefined ? r.parsed : r }
    if (r && r.envelope) return { ok: false, error: r.envelope }
    if (r && r.ok === false) return { ok: false, error: r }
    return { ok: false, error: { ok: false, error: { kind: 'parse', message: what + '没有给出可用的读数' } } }
  } catch (e) {
    return { ok: false, error: { ok: false, error: { kind: 'env', message: what + '抛出异常：' + String(((e as any) && (e as any).message) || (e as any)) } } }
  }
}

/** 从 readPart 的返回值取失败信封里的 error 对象。 */
function errorDetailOf(part: any, fallback: string): any {
  const e: any = part && part.error
  if (e && e.error && typeof e.error.kind === 'string') return e.error
  if (e && typeof e.kind === 'string') return e
  return { kind: 'unknown', message: fallback }
}

export function createFirstScreenPhone(deps: any): any {
  const failPhone: any = deps.failPhone
  const firstLine: any = deps.firstLine
  const failureFromExec: any = deps.failureFromExec
  const runPinned: any = deps.runPinned
  const resolveGitExecutable: any = deps.resolveGitExecutable
  const resolveRepoRoot: any = deps.resolveRepoRoot
  const cwdOf: any = deps.cwdOf
  const collect: any = deps.collect
  const readHasHead: any = deps.readHasHead
  const readAutocrlf: any = deps.readAutocrlf
  const basisReader: any = deps.basisReader
  const readMarkers: any = deps.readMarkers
  const logCount: number = deps.logCount

  /** 版本与能力开关这一片：git 版本、能力档、当前版本下被隐藏或降级的能力清单。 */
  function versionSliceOf(gitVersion: string): any {
    const tier: any = tierFor(parseVersion(gitVersion))
    const switches: any[] = []
    let fullCount: number = 0
    for (let i = 0; i < CAPABILITIES.length; i += 1) {
      const cap: any = CAPABILITIES[i]
      const av: any = capabilityAvailability(cap, gitVersion)
      if (av.state === 'full') fullCount += 1
      else switches.push({ id: cap.id, name: cap.name, command: cap.command, state: av.state, needed: av.needed, alternative: av.alternative })
    }
    return okSlice({
      gitVersion: gitVersion, tier: tier, floor: FLOOR_TEXT,
      fullCount: fullCount, hiddenCount: switches.filter(function (s: any): boolean { return s.state === 'hidden' }).length,
      degradedCount: switches.filter(function (s: any): boolean { return s.state === 'degraded' }).length,
      switches: switches,
    })
  }

  /** 聚合一次七片。返回永远是 ok 快照；单片失败只体现在该片 state==='err'。 */
  async function handleGitFirstScreen(args: any): Promise<any> {
    const cwd: any = cwdOf(args)
    const readAtMs: number = Date.now()
    const slices: any = {}
    const put = function (id: string, slice: any): void { slices[id] = slice }
    const allErr = function (kind: any, message: any): any {
      for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) { if (!slices[FIRST_SCREEN_SLICES[i]]) put(FIRST_SCREEN_SLICES[i], errSlice(kind, message)) }
      return { ok: true, firstScreen: { contract: FIRST_SCREEN_CONTRACT, version: FIRST_SCREEN_VERSION, readAtMs: readAtMs, slices: slices } }
    }
    const exe: any = await resolveGitExecutable()
    if (!exe) return allErr('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const base: any = await resolveRepoRoot(exe, cwd)
    if (base.ok !== true) return allErr((base.error && base.error.kind) || 'parse', (base.error && base.error.message) || '确认仓库这一步失败')

    // 版本片先读：其余各片都要知道能力档；版本太旧（<2.11）时其余片统一标「请先升级」，不假装读到了空数据。
    let tier: string = 'unsupported'
    let gitVersion: string = ''
    try {
      const vres: any = await runPinned(exe, base.root, ['--version'], { stdoutLimit: 4096 })
      const badVer: any = failureFromExec(vres, '读 git 版本这一步')
      if (badVer) put('version', errOfEnvelope(badVer, '读 git 版本这一步失败'))
      else {
        gitVersion = firstLine(vres.stdout)
        put('version', versionSliceOf(gitVersion))
        tier = tierFor(parseVersion(gitVersion))
      }
    } catch (e) { put('version', errSlice('env', '读 git 版本这一步抛出异常：' + String(((e as any) && (e as any).message) || (e as any)))) }

    if (tier === 'unsupported') {
      const why: string = '这台机器上的 git 版本太旧' + (gitVersion ? '（' + gitVersion + '）' : '') + '，第一版硬底线是 ' + FLOOR_TEXT + '，其余各项先不读，升级后再来'
      for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) { const id: string = FIRST_SCREEN_SLICES[i]; if (id !== 'version' && !slices[id]) put(id, errSlice('unsupported', why)) }
      return { ok: true, firstScreen: { contract: FIRST_SCREEN_CONTRACT, version: FIRST_SCREEN_VERSION, readAtMs: readAtMs, slices: slices } }
    }

    // 裸仓库：没有工作区、没有改动、没有工作树；身份、历史、贮藏、版本仍如实读。
    if (base.kind === 'bare') {
      let commits: any[] = []
      const bareLog: any = await readPart('读提交历史这一步', function (): any { return collect(exe, base.root, '读提交历史这一步', (commandFor('log', { logCount: logCount }) as any).args, parseLog) })
      if (bareLog.ok === true) commits = bareLog.value.commits
      put('history', bareLog.ok === true ? okSlice({ commits: commits, hasMore: commits.length >= logCount }) : errOfEnvelope(bareLog.error, '读提交历史这一步失败'))
      const asmBare: any = assemble({
        repoRoot: base.root, bare: true, statusHead: '', statusDetached: false, statusOid: null, statusUpstream: null,
        statusAhead: 0, statusBehind: 0, statusEntries: [], worktrees: [], refs: [], commits: commits, diffFiles: [],
        merging: false, rebasing: false, cherryPicking: false, reverting: false, tier: tier, autocrlf: null, nowMs: readAtMs, basisMs: null,
      })
      put('workspace', asmBare.ok === true ? okSlice({ identity: asmBare.screen.identity, repo: asmBare.screen.repo, branches: asmBare.screen.branches }) : errSlice('parse', '首屏组装失败：' + String(asmBare.detail)))
      put('changes', okSlice({ staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0 }))
      put('worktrees', okSlice({ others: [], bare: true }))
      put('sync', okSlice({ sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null, upstream: null, remote: null, branch: null }))
      const bareStash: any = await readPart('读贮藏列表这一步', function (): any { return collect(exe, base.root, '读贮藏列表这一步', stashListArgs(), parseStashList) })
      put('stashes', bareStash.ok === true ? okSlice({ entries: bareStash.value.entries }) : errOfEnvelope(bareStash.error, '读贮藏列表这一步失败'))
      return { ok: true, firstScreen: { contract: FIRST_SCREEN_CONTRACT, version: FIRST_SCREEN_VERSION, readAtMs: readAtMs, slices: slices } }
    }

    const st: any = await readPart('读工作区改动这一步', function (): any { return collect(exe, base.root, '读工作区改动这一步', (commandFor('status', {}) as any).args, parseStatus) })
    const status: any = st.ok === true ? st.value : null
    const hasHead: any = status ? status.branch.oid !== null : await readHasHead(exe, base.root)

    let worktreesNul: boolean = true
    const wt: any = await readPart('读工作树清单这一步', async function (): Promise<any> {
      let wr: any = await runPinned(exe, base.root, (commandFor('worktrees', {}) as any).args)
      if (wr.kind === 'non-zero') { worktreesNul = false; wr = await runPinned(exe, base.root, (commandFor('worktrees', { useNulWorktrees: false }) as any).args) }
      const bad: any = failureFromExec(wr, '读工作树清单这一步')
      if (bad) return { ok: false, envelope: bad }
      if (wr.truncated) return { ok: false, envelope: failPhone('truncated', '工作树清单读不全，不给半份列表') }
      const parsed: any = parseWorktrees(wr.stdout, worktreesNul)
      if (parsed.ok !== true) return { ok: false, envelope: failPhone('parse', '工作树清单解析失败：' + parsed.detail) }
      return { ok: true, parsed: parsed }
    })
    const rf: any = await readPart('读本地分支这一步', function (): any { return collect(exe, base.root, '读本地分支这一步', (commandFor('refs', {}) as any).args, parseRefs) })
    const lg: any = hasHead === false
      ? { ok: true, value: { commits: [], hasMore: false } }
      : await readPart('读提交历史这一步', function (): any { return collect(exe, base.root, '读提交历史这一步', (commandFor('log', { logCount: logCount }) as any).args, parseLog) })
    const df: any = hasHead === true
      ? await readPart('读每个文件改了行数这一步', function (): any { return collect(exe, base.root, '读每个文件改了行数这一步', (commandFor('diffFiles', {}) as any).args, parseDiffFiles) })
      : { ok: true, value: { files: [] } }
    const mk: any = await readPart('判断是不是正在合并或变基这一步', function (): any { return readMarkers(base.gitDir, { exe: exe, root: base.root }) })
    const stash: any = await readPart('读贮藏列表这一步', function (): any { return collect(exe, base.root, '读贮藏列表这一步', stashListArgs(), parseStashList) })
    let autocrlf: any = null
    try { autocrlf = await readAutocrlf(exe, base.root) } catch (e) { autocrlf = null }
    let basisMs: any = null
    try { basisMs = await (await basisReader()).readBasisMs(exe, base.root, base.gitDir, status ? status.branch.upstream : null) } catch (e) { basisMs = null }

    const markers: any = mk.ok === true && mk.value && mk.value.ok !== false ? mk.value.markers : null
    const makeScreen = function (statusIn: any, worktreesIn: any, refsIn: any, commitsIn: any, diffFilesIn: any, markersIn: any, basisIn: any): any {
      return assemble({
        repoRoot: base.root, bare: false,
        statusHead: statusIn ? statusIn.branch.head : '', statusDetached: statusIn ? statusIn.branch.detached : false, statusOid: statusIn ? statusIn.branch.oid : null,
        statusUpstream: statusIn ? statusIn.branch.upstream : null, statusAhead: statusIn ? statusIn.branch.ahead : 0, statusBehind: statusIn ? statusIn.branch.behind : 0,
        statusEntries: statusIn ? statusIn.entries : [], worktrees: worktreesIn, refs: refsIn, commits: commitsIn, diffFiles: diffFilesIn,
        merging: !!(markersIn && markersIn.merging), rebasing: !!(markersIn && markersIn.rebasing), cherryPicking: !!(markersIn && markersIn.cherryPicking), reverting: !!(markersIn && markersIn.reverting),
        tier: tier, autocrlf: autocrlf, nowMs: readAtMs, basisMs: basisIn,
      })
    }

    // 工作区状态片：身份 + 仓库级状态 + 分支表。要状态、工作树清单、分支、运行标记四样；缺一样就只标这一片失败。
    const wzBad: any = st.ok !== true ? errorDetailOf(st, '读工作区改动这一步失败') : (wt.ok !== true ? errorDetailOf(wt, '读工作树清单这一步失败') : (rf.ok !== true ? errorDetailOf(rf, '读本地分支这一步失败') : (mk.ok !== true ? errorDetailOf(mk, '判断是不是正在合并或变基这一步失败') : null)))
    if (wzBad) put('workspace', errSlice(wzBad.kind, wzBad.message))
    else {
      try {
        const asm: any = makeScreen(status, wt.value.worktrees, rf.value.refs, lg.ok === true ? lg.value.commits : [], df.ok === true ? df.value.files : [], markers, basisMs)
        put('workspace', asm.ok === true ? okSlice({ identity: asm.screen.identity, repo: asm.screen.repo, branches: asm.screen.branches }) : errSlice('parse', '首屏组装失败：' + String(asm.detail)))
      } catch (e) { put('workspace', errSlice('env', '首屏组装抛出异常：' + String(((e as any) && (e as any).message) || (e as any)))) }
    }

    // 改动片：两组文件与三个计数。要状态与逐文件行数；行数读不到时仍给文件清单（行数如实为 null）。
    if (st.ok !== true) put('changes', errSlice(errorDetailOf(st, '读工作区改动这一步失败').kind, errorDetailOf(st, '读工作区改动这一步失败').message))
    else {
      try {
        const asm: any = makeScreen(status, [], [], [], df.ok === true ? df.value.files : [], null, null)
        put('changes', asm.ok === true ? okSlice({ staged: asm.screen.staged, unstaged: asm.screen.unstaged, stagedCount: asm.screen.stagedCount, unstagedCount: asm.screen.unstagedCount, conflictCount: asm.screen.conflictCount, lineCountsKnown: df.ok === true }) : errSlice('parse', '首屏组装失败：' + String(asm.detail)))
      } catch (e) { put('changes', errSlice('env', '首屏组装抛出异常：' + String(((e as any) && (e as any).message) || (e as any)))) }
    }

    // 提交历史首页片：只读历史一条命令，与其它片无关。
    put('history', lg.ok === true ? okSlice({ commits: lg.value.commits, hasMore: lg.value.hasMore === true }) : errSlice(errorDetailOf(lg, '读提交历史这一步失败').kind, errorDetailOf(lg, '读提交历史这一步失败').message))

    // 工作树片：其他工作树清单（当前那棵由工作区片负责，这里不重复）。
    if (st.ok !== true) put('worktrees', errSlice(errorDetailOf(st, '读工作区改动这一步失败').kind, errorDetailOf(st, '读工作区改动这一步失败').message))
    else if (wt.ok !== true) put('worktrees', errSlice(errorDetailOf(wt, '读工作树清单这一步失败').kind, errorDetailOf(wt, '读工作树清单这一步失败').message))
    else {
      try {
        const asm: any = makeScreen(status, wt.value.worktrees, [], [], [], null, null)
        put('worktrees', asm.ok === true ? okSlice({ others: asm.screen.otherWorktrees, bare: false, nul: worktreesNul }) : errSlice('parse', '首屏组装失败：' + String(asm.detail)))
      } catch (e) { put('worktrees', errSlice('env', '首屏组装抛出异常：' + String(((e as any) && (e as any).message) || (e as any)))) }
    }

    // 贮藏片：本票新建的读数（git stash list）；解析失败即显式失败，不给半份列表。
    put('stashes', stash.ok === true ? okSlice({ entries: stash.value.entries }) : errSlice(errorDetailOf(stash, '读贮藏列表这一步失败').kind, errorDetailOf(stash, '读贮藏列表这一步失败').message))

    // 同步带片：本票新建的读数投影——上游、领先/落后、依据时间、同步档；分支表与工作区片解耦。
    if (st.ok !== true) put('sync', errSlice(errorDetailOf(st, '读工作区改动这一步失败').kind, errorDetailOf(st, '读工作区改动这一步失败').message))
    else if (rf.ok !== true) put('sync', errSlice(errorDetailOf(rf, '读本地分支这一步失败').kind, errorDetailOf(rf, '读本地分支这一步失败').message))
    else {
      try {
        const asm: any = makeScreen(status, [], rf.value.refs, [], [], null, basisMs)
        if (asm.ok !== true) put('sync', errSlice('parse', '首屏组装失败：' + String(asm.detail)))
        else {
          const up: any = status.branch.upstream
          const slashAt: number = typeof up === 'string' ? up.indexOf('/') : -1
          put('sync', okSlice({
            sync: asm.screen.identity.sync, ahead: asm.screen.identity.ahead, behind: asm.screen.identity.behind,
            basisMs: asm.screen.identity.basisMs, upstream: up,
            remote: slashAt > 0 ? up.slice(0, slashAt) : null, branch: status.branch.head,
          }))
        }
      } catch (e) { put('sync', errSlice('env', '首屏组装抛出异常：' + String(((e as any) && (e as any).message) || (e as any)))) }
    }

    // 缺片兜底（正常不会发生：每条路径都写过上面七片）。
    for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) { const id: string = FIRST_SCREEN_SLICES[i]; if (!slices[id]) put(id, errSlice('unknown', '这一片没有读数')) }
    return { ok: true, firstScreen: { contract: FIRST_SCREEN_CONTRACT, version: FIRST_SCREEN_VERSION, readAtMs: readAtMs, slices: slices } }
  }

  return handleGitFirstScreen
}

export const FIRST_SCREEN_PHONE_SOURCE = 'src/host/versionControlFirstScreen.ts'
