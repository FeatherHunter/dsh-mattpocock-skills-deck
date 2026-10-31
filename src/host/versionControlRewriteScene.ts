/**
 * src/host/versionControlRewriteScene.ts —— 全库重写的现场读数、影响预览与备份决策（#1750 T15，规格 #1586 域 5.11）
 *
 * 为什么单独一叶：维护页的五张 filter-repo 表单要的是「这个仓库现在是什么样、重写会影响多少东西、
 * 备份该放哪」三份读数。预检签票与执行前重验必须读同一份现场（同一个 readScreen、同一条进程出口），
 * 所以读数、预览、备份决策集中在这里；本文件不签票、不执行写命令（那在 RewriteCheck/Write 两片）。
 *
 * 约定（改这里之前先读）：
 *   1. 一条只读命令走 runPinned（父文件注入），本文件不自己 spawn。
 *   2. 读数读不全（被截断、解析失败）时，影响计数明确标 truncated 或回失败信封，绝不拿半份数字当真。
 *   3. 五张表单的校验、参数与命令原文住共享层 rewrite-ops.ts，本文件不复制第二份。
 *   4. 备份只是决策（镜像克隆或整仓打包），真正执行在 RewriteWrite；本文件给路径与估算大小。
 */
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
import { makeBindings, worktreeBindingInput } from '../shared/version-control/src/write-ticket.js'
import { rewritePlanInput, rewriteFormProblem, rewriteDisplayCommandOf, rewriteBackupPlanOf, rewriteThresholdBytesOf, rewriteFormOf } from '../shared/version-control/src/rewrite-ops.js'
import { VC_REWRITE_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这两个内建模块必然存在。
// @ts-expect-error
import { statfs } from 'node:fs/promises'
// @ts-expect-error
import { createHash } from 'node:crypto'

/** 只读命令的输出上限：对象计数、提交清单与作者清单都按这一个上限读。 */
const READ_LIMIT: number = 8 * 1024 * 1024
/** 预览里最多逐条数多少条替换字面量：再多就只给前十条，免得预览自己跑成一次全库扫描。 */
const PREVIEW_REPLACE_MAX: number = 10

/** 造现场读取层；依赖全部由装配壳显式传入，本文件不引别的宿主文件（同层单向）。 */
export function createRewriteScene(deps: any): any {
  const readTimeoutMs: number = Number(deps.readTimeoutMs) || VC_REWRITE_READ_TIMEOUT_MS
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }
  const mkDigest = function (text: any): string { return createHash('sha256').update(String(text)).digest('hex').slice(0, 16) }

  /** 失败信封：沿用宿主既有形状，另带稳定 reason 供界面与门禁对账（与分支、冲突两族同一口径）。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 跑一条只读命令并翻成 {ok:true,stdout,truncated} 或失败信封；非零退出不当作成功。 */
  async function readOut(exe: string, root: string, args: string[], opts?: any): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, root, args, { timeoutMs: readTimeoutMs, stdoutLimit: (opts && opts.stdoutLimit) || READ_LIMIT }) } catch (e) { return fail('env', 'unknown', '只读命令没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
    if (res && res.kind === 'ok') return { ok: true, stdout: String(res.stdout || ''), truncated: res.truncated === true }
    if (res && res.kind === 'non-zero') return fail('read', 'unknown', firstLine(res.stderr) || '只读命令以非零退出码结束了')
    return fail('read', 'unknown', firstLine(res && res.message) || '只读命令没有正常结束')
  }

  /** 允许非零的读：例如老版本 git 不认某个开关时按「没有这个事实」处理。 */
  async function readMaybe(exe: string, root: string, args: string[]): Promise<any> {
    try { return await deps.runPinned(exe, root, args, { timeoutMs: readTimeoutMs, stdoutLimit: READ_LIMIT }) } catch (e) { return { kind: 'spawn-failed', message: String((e && (e as any).message) || e) } }
  }

  /** 解析仓库：找不到 git 或不是仓库都回明确失败信封。 */
  async function repoOf(cwd: string): Promise<any> {
    let exe: any = null
    try { exe = await deps.resolveGitExecutable() } catch (e) { exe = null }
    if (!exe) return fail('env', 'unknown', '找不到 git 命令，读不了仓库现场。')
    const repo: any = await deps.resolveRepoRoot(exe, cwd)
    if (!repo || repo.ok !== true) return repo && repo.error ? repo : fail('not-repo', 'unknown', '当前目录不是 git 仓库：' + cwd)
    // 裸仓库没有工作区，filter-repo 也不能在裸仓库里按维护页的方式跑：明确拒，不让人等一条注定失败的任务。
    if (repo.kind === 'bare') return fail('blocked', 'repo-bare', '这是一个裸仓库：维护页的整仓重写要在有工作区的仓库里做，请换一个普通仓库。')
    return { ok: true, exe: String(exe), root: String(repo.root) }
  }

  /** 数仓库对象库大小（KiB 两段相加）：备份估算与确认卡用它。 */
  async function repoSizeOf(exe: string, root: string): Promise<any> {
    const res: any = await readOut(exe, root, ['count-objects', '-v'], { stdoutLimit: 256 * 1024 })
    if (res.ok !== true) return res
    let loose: number = 0
    let packed: number = 0
    const lines: string[] = String(res.stdout || '').replace(/\r/g, '').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const m: any = /^size(?:-pack)?:\s*(\d+)/.exec(lines[i])
      if (!m) continue
      if (lines[i].indexOf('size-pack:') === 0) packed = Number(m[1]); else loose = Number(m[1])
    }
    return { ok: true, bytes: (loose + packed) * 1024 }
  }

  /** 读父目录剩余空间：读不出来按 0 处理，备份决策会因此降级成整仓打包（更保守）。 */
  async function freeBytesOf(target: string): Promise<number> {
    try {
      const fn: any = (deps && deps.fs && typeof deps.fs.statfs === 'function') ? deps.fs.statfs : statfs
      const st: any = await fn(target)
      return Math.max(0, Math.floor(Number(st.bsize) * Number(st.bavail)))
    } catch (e) { return 0 }
  }

  /** 工作区是否脏：已暂存、未暂存、冲突任一非空即脏；重写前必须先把改动提交或贮藏。 */
  function dirtyOf(screen: any): boolean {
    const count = function (v: any): number { if (Array.isArray(v)) return v.length; const n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0 }
    return count(screen && screen.staged) + count(screen && screen.unstaged) + count(screen && screen.conflictCount) > 0
  }

  /** 进行中的操作：合并、变基、拣选、还原任一为真都算；重写会打乱这些状态，先让人处理完。 */
  function operationOf(screen: any): string | null {
    const r: any = (screen && screen.repo) || {}
    if (r.merging === true) return 'merge'
    if (r.rebasing === true) return 'rebase'
    if (r.cherryPicking === true) return 'cherry-pick'
    if (r.reverting === true) return 'revert'
    return null
  }

  /**
   * 读一次现场：仓库根、HEAD、分支、提交数、是否浅克隆、filter-repo 是否可用、仓库大小、磁盘余量、
   * 进行中操作与工作区脏不脏。预检与执行前重验都走这一个函数，两次口径完全一样才能比出「变没变」。
   */
  async function sceneOf(cwd: string): Promise<any> {
    const repo: any = await repoOf(cwd)
    if (repo.ok !== true) return repo
    const exe: string = repo.exe
    const root: string = repo.root
    let sc: any = null
    try { sc = await deps.readScreenOf(cwd) } catch (e) { sc = null }
    if (!sc || sc.ok !== true) return fail('read', 'unknown', '读不到仓库首屏，判断不了现场（' + firstLine(String((sc && sc.error && sc.error.message) || sc)) + '）')
    const screen: any = sc.screen
    const headOid: string = String((screen && screen.identity && screen.identity.oid) || '')
    if (headOid === '') return fail('blocked', 'nothing-to-do', '这个仓库还没有任何提交：没有历史可重写。')

    const countRes: any = await readOut(exe, root, ['rev-list', '--count', '--all'], { stdoutLimit: 64 * 1024 })
    if (countRes.ok !== true) return countRes
    const commitCount: number = Number(String(countRes.stdout || '').trim())
    if (!isFinite(commitCount)) return fail('read', 'unknown', '提交数读不出来：' + firstLine(countRes.stdout))
    const branchRes: any = await readOut(exe, root, ['rev-parse', '--abbrev-ref', 'HEAD'], { stdoutLimit: 4096 })
    if (branchRes.ok !== true) return branchRes
    const branch: string = String(branchRes.stdout || '').trim()
    const sizeRes: any = await repoSizeOf(exe, root)
    if (sizeRes.ok !== true) return sizeRes
    const shallowRes: any = await readMaybe(exe, root, ['rev-parse', '--is-shallow-repository'])
    const shallow: boolean = shallowRes && shallowRes.kind === 'ok' && /true/i.test(String(shallowRes.stdout || ''))
    const frRes: any = await readMaybe(exe, root, ['filter-repo', '--version'])
    const filterRepoAvailable: boolean = !!(frRes && frRes.kind === 'ok')
    const filterRepoVersion: string = filterRepoAvailable ? firstLine(frRes.stdout) : ''
    const parent: string = root.replace(/[\\/][^\\/]+$/, '') || root
    const freeBytes: number = await freeBytesOf(parent)
    const scene: any = {
      repoRoot: root,
      repoName: root.replace(/^.*[\\/]/, ''),
      headOid: headOid,
      branch: branch,
      commitCount: commitCount,
      shallow: shallow,
      filterRepoAvailable: filterRepoAvailable,
      filterRepoVersion: filterRepoVersion,
      repoSizeBytes: sizeRes.bytes,
      freeBytes: freeBytes,
      operation: operationOf(screen),
      dirty: dirtyOf(screen),
      readAtMs: now(),
    }
    return { ok: true, exe: exe, screen: screen, scene: scene }
  }

  /** 计划与现场的绑定值：计划摘要 + 工作区形状；执行前重验不一致就零命令拒绝。 */
  function bindingsOf(screen: any, plan: any): any {
    return makeBindings({
      preconditions: {
        planDigest: mkDigest(rewritePlanInput(plan)),
        worktreeDigest: mkDigest(worktreeBindingInput(screen)),
        configOldValue: null,
        remoteOid: null,
        pathAbsent: [],
      },
      counters: { indexEntries: null },
    })
  }

  /** 界面/票据用的一句话现场摘要：不把整个 screen 塞进回包。 */
  function sceneSummaryOf(scene: any): any {
    return {
      repoRoot: scene.repoRoot,
      headOid: scene.headOid,
      branch: scene.branch,
      commitCount: scene.commitCount,
      shallow: scene.shallow,
      filterRepoAvailable: scene.filterRepoAvailable,
      filterRepoVersion: scene.filterRepoVersion,
      repoSizeBytes: scene.repoSizeBytes,
      freeBytes: scene.freeBytes,
      operation: scene.operation,
      dirty: scene.dirty,
      readAtMs: scene.readAtMs,
    }
  }

  /** 把 ls-files 的路径清单按前缀数匹配条数：删路径与重命名用（filter-repo 的 --path 是前缀语义）。 */
  function matchedPathCount(text: string, prefixes: string[]): number {
    const items: string[] = String(text || '').split('\u0000')
    let n: number = 0
    for (let i = 0; i < items.length; i += 1) {
      const p: string = items[i]
      if (p === '') continue
      for (let k = 0; k < prefixes.length; k += 1) {
        const want: string = String(prefixes[k])
        if (p === want || p.indexOf(want + '/') === 0) { n += 1; break }
      }
    }
    return n
  }

  /** 数「会被重写触及的提交」：一条 rev-list --count --all -- <paths> 就够，不需要逐提交遍历。 */
  async function matchedCommitCountOf(exe: string, root: string, paths: string[]): Promise<any> {
    if (paths.length === 0) return { ok: true, count: 0, truncated: false }
    const res: any = await readOut(exe, root, ['rev-list', '--count', '--all', '--'].concat(paths))
    if (res.ok !== true) return res
    if (res.truncated === true) return { ok: true, count: null, truncated: true }
    const count: number = Number(String(res.stdout || '').trim())
    return { ok: true, count: isFinite(count) ? count : null, truncated: false }
  }

  /** 按作者邮箱数触及的提交：读全量作者邮箱再逐行对；读数被截断就不给数字（标记 truncated）。 */
  async function matchedAuthorCountOf(exe: string, root: string, emails: string[]): Promise<any> {
    const res: any = await readOut(exe, root, ['log', '--all', '--format=%ae'])
    if (res.ok !== true) return res
    if (res.truncated === true) return { ok: true, count: null, truncated: true }
    const want: any = {}
    for (let i = 0; i < emails.length; i += 1) want[String(emails[i]).toLowerCase()] = true
    const lines: string[] = String(res.stdout || '').replace(/\r/g, '').split('\n')
    let n: number = 0
    for (let i = 0; i < lines.length; i += 1) if (lines[i] !== '' && want[lines[i].trim().toLowerCase()]) n += 1
    return { ok: true, count: n, truncated: false }
  }

  /** 逐条数替换字面量命中的提交：最多数前十条，多出来的只提示「还有几条没逐条数」。 */
  async function replacementHitsOf(exe: string, root: string, replacements: any[]): Promise<any> {
    const hits: any[] = []
    let truncated: boolean = false
    const limit: number = Math.min(replacements.length, PREVIEW_REPLACE_MAX)
    for (let i = 0; i < limit; i += 1) {
      const item: any = replacements[i] || {}
      const res: any = await readOut(exe, root, ['rev-list', '--count', '--all', '-S' + String(item.from || '')])
      if (res.ok !== true) return res
      const count: any = res.truncated === true ? null : Number(String(res.stdout || '').trim())
      if (res.truncated === true) truncated = true
      hits.push({ from: String(item.from || ''), commits: isFinite(Number(count)) ? count : null })
    }
    if (replacements.length > limit) truncated = true
    return { ok: true, hits: hits, truncated: truncated }
  }

  /**
   * 预览这次重写会影响多少东西：每条表单都给「全库提交数、被触及的提交数、被触及的路径数、
   * 阈值字节或替换命中明细」；任何一项读不全就标 truncated，绝不给一个看着像真的假数字。
   */
  async function previewOf(scene: any, plan: any): Promise<any> {
    const exe: string = scene.exe
    const root: string = scene.scene.repoRoot
    const form: string = String((plan || {}).form || '')
    const meta: any = rewriteFormOf(form)
    if (!meta) return fail('args', 'bad-form', '不认识的重写表单：' + form)
    const counts: any = {
      commits: scene.scene.commitCount,
      matchedCommits: null,
      matchedPaths: null,
      thresholdBytes: null,
      repoSizeBytes: scene.scene.repoSizeBytes,
      replacementHits: null,
      truncated: false,
    }
    if (form === 'remove-paths' || form === 'rename-paths') {
      const prefixes: string[] = form === 'remove-paths' ? plan.paths.slice() : plan.renames.map(function (r: any): string { return String(r.from) })
      const filesRes: any = await readOut(exe, root, ['ls-files', '-z'])
      if (filesRes.ok !== true) return filesRes
      counts.matchedPaths = filesRes.truncated === true ? null : matchedPathCount(filesRes.stdout, prefixes)
      if (filesRes.truncated === true) counts.truncated = true
      const commitRes: any = await matchedCommitCountOf(exe, root, prefixes)
      if (commitRes.ok !== true) return commitRes
      counts.matchedCommits = commitRes.count
      if (commitRes.truncated === true) counts.truncated = true
    } else if (form === 'rewrite-authors') {
      const emails: string[] = plan.authors.map(function (a: any): string { return String(a.oldEmail || a.email) })
      const authorRes: any = await matchedAuthorCountOf(exe, root, emails)
      if (authorRes.ok !== true) return authorRes
      counts.matchedCommits = authorRes.count
      counts.matchedPaths = 0
      if (authorRes.truncated === true) counts.truncated = true
    } else if (form === 'remove-large') {
      counts.thresholdBytes = rewriteThresholdBytesOf(plan.threshold)
      counts.matchedCommits = null
      counts.matchedPaths = null
    } else if (form === 'replace-text') {
      const hitRes: any = await replacementHitsOf(exe, root, plan.replacements)
      if (hitRes.ok !== true) return hitRes
      counts.replacementHits = hitRes.hits
      let best: number = 0
      for (let i = 0; i < hitRes.hits.length; i += 1) if (Number(hitRes.hits[i].commits) > best) best = Number(hitRes.hits[i].commits)
      counts.matchedCommits = best
      counts.matchedPaths = 0
      if (hitRes.truncated === true) counts.truncated = true
    }
    return {
      ok: true,
      form: form,
      plan: plan,
      counts: counts,
      command: rewriteDisplayCommandOf(form, plan),
      truncated: counts.truncated === true,
      readAtMs: now(),
    }
  }

  /** 执行前重验：与预检同一个 sceneOf；任何一格变化都由执行层拿 bindingsVerdict 比出来。 */
  async function measure(cwd: string, plan: any): Promise<any> {
    const fresh: any = await sceneOf(cwd)
    if (fresh.ok !== true) return fresh
    return {
      ok: true,
      exe: fresh.exe,
      screen: fresh.screen,
      scene: fresh.scene,
      repoRoot: fresh.scene.repoRoot,
      headOid: fresh.scene.headOid,
      bindings: bindingsOf(fresh.screen, plan),
    }
  }

  /** 备份决策：磁盘够用镜像克隆，不够降级整仓打包；路径与估算大小随回包给确认卡。 */
  function backupPlanOf(scene: any): any {
    return rewriteBackupPlanOf({ repoRoot: scene.repoRoot, freeBytes: scene.freeBytes, repoSizeBytes: scene.repoSizeBytes, nowMs: scene.readAtMs })
  }

  return {
    fail: fail,
    readOut: readOut,
    repoOf: repoOf,
    sceneOf: sceneOf,
    sceneSummaryOf: sceneSummaryOf,
    bindingsOf: bindingsOf,
    previewOf: previewOf,
    measure: measure,
    backupPlanOf: backupPlanOf,
    digest16: mkDigest,
  }
}
