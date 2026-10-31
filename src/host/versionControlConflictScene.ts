// host/versionControlConflictScene.ts —— 冲突向导（#1747 T12，规格域 6）的现场读数叶子
//
// 为什么单独一层：冲突向导要读的东西比别的页多一块——除了首屏那份读数，还要读「未合并条目的索引阶段」
//   （谁改了、谁删了、谁改名、是不是子模组/文件模式差异），要读工作区里那份带冲突标记的文本，
//   还要读 merge-tree 预演、rerere 与残留标记检查。这些读法如果散在预检与执行两处，两边口径迟早分叉。
//   本叶子只读不写（唯一例外：整份编辑要覆写工作区文件，它必须与执行层共用同一份路径拼法与编码），
//   判定与签票归 versionControlConflictCheck.ts，凭票执行归 versionControlConflictWrite.ts。
//
// 三条口径（改了会坏）：
//   1. 所有 git 调用都走装配处注入的 runPinned：-C 钉仓库、固定前缀、字节上限、超时、报闸、git.exec 日志，
//      本文件不自己起进程、不自己拼可执行文件路径。
//   2. 读不全（截断、起进程失败、超时）一律显式失败，不给半份现场；非零退出只在对应用途上被接受
//      （例如 merge-tree 的退出码 1 表示「有冲突」，diff --check 的 2 表示「查到残留标记」）。
//   3. 票据绑定表用 16 位摘要，不把文件内容或计划原文带进票据。
import { canonicalJson, makeBindings, pathAbsentFromScreen } from '../shared/version-control/src/write-ticket.js'
import { conflictStateOfScreen, conflictKindOf, conflictSidesOf } from '../shared/version-control/src/conflict-ops.js'
import { conflictTextKindOf, splitConflictHunks } from '../shared/version-control/src/conflict-text.js'
import { VC_CONFLICT_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，内建模块必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'

/** 读命令的输出上限：冲突清单与补丁都不大，但统一给一个上限，超了显式失败而不是悄悄截断。 */
const READ_LIMIT = 8 * 1024 * 1024
/** 判二进制时只看文件前 1MB：超过上限按大文件处理并且算二进制（大文件多半不是能逐块编辑的文本）。 */
const CAT_LIMIT = 1024 * 1024
/** git diff --check 的残留标记行：`path:line: leftover conflict marker`。 */
const MARKER_LINE = /^(.+?):(\d+): leftover conflict marker/

/** 拼仓库内相对路径：统一正斜杠，Windows 上 git 也认。 */
function joinRepo(root: any, rel: any): string { return String(root || '').replace(/[\\/]+$/, '') + '/' + String(rel || '') }

/** 票据绑定用的 16 位摘要。 */
function digest16Of(text: any): string { try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' } }

/** 造冲突向导的现场读数器：返回一组只读能力与绑定表算法，供预检、执行与只读电话共用。 */
export function createConflictScene(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const readScreenOf: any = d.readScreenOf
  const fs: any = d.fs
  const fsAbsence: any = d.fsAbsence
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  /** 失败信封：kind 是环节、reason 是固定理由标识符，附加字段平铺在顶层。 */
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  function gitSays(res: any): string {
    const text: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return String(text || '').slice(0, 400)
  }
  /** 读一条只读命令；allowNonZero 表示「非零退出本身是读数结论」，交给调用方解释。 */
  async function readOut(exe: any, root: any, what: string, args: string[], opts?: any): Promise<any> {
    const o: any = opts || {}
    const res: any = await runPinned(exe, root, args, { stdoutLimit: o.stdoutLimit || READ_LIMIT, timeoutMs: o.timeoutMs || VC_CONFLICT_READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || (o.allowNonZero === true && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), exitCode: typeof res.exitCode === 'number' ? res.exitCode : (res.kind === 'ok' ? 0 : -1) }
  }
  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, String(cwd || ''))
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: String(base.root) }
  }

  /**
   * 读未合并条目的索引阶段：`git ls-files --stage -z` 每条 `<mode> <oid> <stage>\t<path>`。
   * 同一路径可能有阶段 1/2/3 多行，按路径合并成 {path, stages, modes}。
   * 只留阶段非 0 的行——阶段 0 是普通已跟踪文件，不是冲突。
   */
  async function unmergedOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读冲突文件清单这一步', ['ls-files', '--stage', '-z'])
    if (r.ok !== true) return r
    const records: string[] = r.stdout.split('\u0000')
    const byPath: any = {}
    for (let i = 0; i < records.length; i += 1) {
      const rec: string = records[i]
      if (rec === '') continue
      const tab: number = rec.indexOf('\t')
      if (tab < 0) continue
      const meta: string[] = rec.slice(0, tab).split(' ')
      const stage: number = parseInt(meta[2], 10)
      if (!(stage === 1 || stage === 2 || stage === 3)) continue
      const path: string = rec.slice(tab + 1)
      if (!byPath[path]) byPath[path] = { path: path, stages: [], modes: [], oids: {} }
      byPath[path].stages.push(stage)
      byPath[path].modes.push(String(meta[0] || ''))
      byPath[path].oids[stage] = String(meta[1] || '')
    }
    const paths: string[] = Object.keys(byPath).sort()
    const list: any[] = []
    for (let i = 0; i < paths.length; i += 1) list.push(byPath[paths[i]])
    return { ok: true, entries: list }
  }

  /**
   * 这个冲突文件按文本还是按二进制处理：取阶段 2/3 的内容扫 NUL 字节。
   * 二进制冲突不显示逐块（规格 §3.5），只能整份选边；内容读不到或超上限按二进制处理（宁可不给逐块）。
   */
  async function textOrBinaryOf(exe: any, root: any, entry: any): Promise<string> {
    const oids: any = entry.oids || {}
    const tryOid: string[] = [oids[2], oids[3]]
    for (let i = 0; i < tryOid.length; i += 1) {
      const oid: string = String(tryOid[i] || '')
      if (oid === '') continue
      const r: any = await readOut(exe, root, '读冲突文件内容这一步', ['cat-file', '-p', oid], { stdoutLimit: CAT_LIMIT, allowNonZero: true })
      if (r.ok !== true) return 'binary'
      if (r.truncated) return 'binary'
      if (r.stdout.indexOf('\u0000') >= 0) return 'binary'
    }
    return 'text'
  }

  /** 读一次完整现场：仓库根、HEAD、首屏读数、进行中操作、未合并条目（含分类与可选边）。 */
  async function sceneOf(cwd: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const screen: any = sr.screen || {}
    const headOid: string = String((screen.identity && screen.identity.oid) || '')
    const state: any = conflictStateOfScreen(screen)
    const un: any = await unmergedOf(b.exe, b.root)
    if (un.ok !== true) return un
    const conflicts: any[] = []
    for (let i = 0; i < un.entries.length; i += 1) {
      const entry: any = un.entries[i]
      const kind: string = conflictKindOf({ stages: entry.stages, modes: entry.modes })
      const textKind: string = kind === 'both-changed' ? await textOrBinaryOf(b.exe, b.root, entry) : 'text'
      conflicts.push({ path: entry.path, stages: entry.stages, modes: entry.modes, kind: kind, textKind: textKind, sides: conflictSidesOf(entry.stages) })
    }
    return { ok: true, exe: b.exe, repoRoot: b.root, headOid: headOid, screen: screen, state: state, gitVersion: String(sr.gitVersion || ''), conflicts: conflicts, conflictCount: conflicts.length, readAtMs: nowFn() }
  }

  /** 票据绑定：计划摘要、现场摘要（工作区条目与冲突清单）、进行中操作锚、当时不存在的标记。 */
  function bindingsOf(scene: any, plan: any): any {
    const pairs: any[] = []
    for (let i = 0; i < scene.conflicts.length; i += 1) pairs.push({ path: scene.conflicts[i].path, stages: scene.conflicts[i].stages, kind: scene.conflicts[i].kind })
    const sc: any = scene.screen || {}
    const worktreeDigest: string = digest16Of(canonicalJson({ staged: sc.staged || [], unstaged: sc.unstaged || [], conflicts: pairs }))
    return makeBindings({
      preconditions: {
        planDigest: digest16Of(canonicalJson(plan)),
        worktreeDigest: worktreeDigest,
        configOldValue: scene.state === null ? null : String(scene.state),
        remoteOid: null,
        pathAbsent: pathAbsentFromScreen(scene.screen),
      },
      counters: { indexEntries: null },
    })
  }
  async function measure(cwd: any, plan: any): Promise<any> {
    const scene: any = await sceneOf(cwd)
    if (scene.ok !== true) return { ok: false, envelope: scene.envelope }
    return { ok: true, repoRoot: scene.repoRoot, headOid: scene.headOid, state: scene.state, conflictCount: scene.conflictCount, bindings: bindingsOf(scene, plan), scene: scene }
  }

  /** 读仓库内一个相对路径的文本文件：缺失与读不了分开回报（整份编辑要先拿旧内容算摘要）。 */
  async function readTextFile(root: any, rel: any): Promise<any> {
    if (!fs || typeof fs.readText !== 'function' || typeof fs.resolve !== 'function') return { ok: false, reason: 'unreadable', message: '文件服务不可用，读不了这个文件' }
    let target: any
    try { target = await fs.resolve(joinRepo(root, rel)) } catch (e) {
      try { if ((await fsAbsence()).isAbsenceError(e)) return { ok: false, reason: 'missing' } } catch (eA) { /* 灭失判定本身失败时按读不了处理 */ }
      return { ok: false, reason: 'unreadable', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
    try { const txt: any = await fs.readText(target); return { ok: true, text: String(txt === undefined || txt === null ? '' : txt) } } catch (e) {
      try { if ((await fsAbsence()).isAbsenceError(e)) return { ok: false, reason: 'missing' } } catch (eA) { /* 同上 */ }
      return { ok: false, reason: 'unreadable', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
  }
  /** 覆写仓库内一个相对路径的文本文件（整份编辑保存用）；失败如实回，不假装写成功。 */
  async function writeTextFile(root: any, rel: any, text: any): Promise<any> {
    if (!fs || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return { ok: false, message: '文件服务不可用，写不了这个文件' }
    try { const target: any = await fs.resolve(joinRepo(root, rel)); await fs.writeText(target, String(text)); return { ok: true } } catch (e) { return { ok: false, message: String(((e as any) && (e as any).message) || (e as any)) } }
  }

  /** 冲突视图（能力 6.9 的面板实现）：读工作区那份文件，按冲突块切开；二进制不切块只回普通文本。 */
  async function fileViewOf(root: any, rel: any): Promise<any> {
    const txt: any = await readTextFile(root, rel)
    if (txt.ok !== true) return { ok: false, envelope: fail('read', txt.reason === 'missing' ? 'path-not-conflicted' : 'unreadable', txt.reason === 'missing' ? '这个文件已经不在工作区了：刷新冲突清单再看' : '读不了这个文件：' + String(txt.message || '')) }
    const kind: string = conflictTextKindOf(txt.text)
    const hunks: any = kind === 'text' ? splitConflictHunks(txt.text) : { ok: false, reason: 'binary' }
    return { ok: true, path: String(rel), kind: kind, text: txt.text, hunks: hunks.ok === true ? hunks.hunks : null, hunkCount: hunks.ok === true ? hunks.hunks.length : 0, hunksReason: hunks.ok === true ? null : String(hunks.reason) }
  }

  /** 解析 git diff --check 的残留标记行；同一条输出里其它告警（尾随空格）不算残留标记。 */
  function markerLinesOf(text: any): any[] {
    const lines: string[] = String(text || '').split(/\r?\n/)
    const out: any[] = []
    for (let i = 0; i < lines.length; i += 1) {
      const hit: any = MARKER_LINE.exec(lines[i])
      if (hit) out.push({ path: hit[1], line: parseInt(hit[2], 10) })
    }
    return out
  }
  /** 只查一个路径（标记已解决与整份保存前的拦截都用它）：`git diff --check -- <path>`。 */
  async function markerCheckPathOf(cwd: any, rel: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const r: any = await readOut(b.exe, b.root, '查这个文件的残留冲突标记这一步', ['diff', '--check', '--', String(rel)], { allowNonZero: true })
    if (r.ok !== true) return r
    const markers: any[] = markerLinesOf(r.stdout)
    return { ok: true, clean: markers.length === 0, markers: markers, exitCode: r.exitCode }
  }
  /** 全仓残留标记检查（能力 6.15）：工作区与已暂存内容各查一遍——先 add 再查工作区会漏掉已暂存的标记。 */
  async function markerCheckOf(cwd: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const work: any = await readOut(b.exe, b.root, '查工作区残留冲突标记这一步', ['diff', '--check'], { allowNonZero: true })
    if (work.ok !== true) return work
    const cached: any = await readOut(b.exe, b.root, '查已暂存内容残留冲突标记这一步', ['diff', '--cached', '--check'], { allowNonZero: true })
    if (cached.ok !== true) return cached
    const workMarkers: any[] = markerLinesOf(work.stdout)
    const cachedMarkers: any[] = markerLinesOf(cached.stdout)
    return { ok: true, worktree: workMarkers, staged: cachedMarkers, clean: workMarkers.length === 0 && cachedMarkers.length === 0, readAtMs: nowFn() }
  }

  /** 预演合并（能力 6.10，git 2.38 起）：只读，不动工作区；退出码 1 表示「会冲突」，不是命令失败。 */
  async function mergePreviewOf(cwd: any, target: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const ver: string = String(sr.gitVersion || '')
    const m: any = /git version (\d+)\.(\d+)/.exec(ver)
    if (m) {
      const major: number = parseInt(m[1], 10)
      const minor: number = parseInt(m[2], 10)
      if (major < 2 || (major === 2 && minor < 38)) return { ok: false, envelope: fail('unsupported', 'version-unsupported', '预演合并要 git 2.38 及以上（merge-tree --write-tree）；当前是 ' + (ver || '未知版本') + '，升级后再来', { needed: '2.38', gitVersion: ver }) }
    } else {
      return { ok: false, envelope: fail('unsupported', 'version-unsupported', '读不出 git 版本，预演合并这一步先不做（它需要 2.38 及以上）', { needed: '2.38', gitVersion: ver }) }
    }
    const argv: string[] = ['merge-tree', '--write-tree', '--name-only', String(target)]
    const res: any = await runPinned(b.exe, b.root, argv, { stdoutLimit: READ_LIMIT, timeoutMs: VC_CONFLICT_READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || res.kind === 'non-zero' ? null : failureFromExec(res, '预演合并这一步')
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', '预演合并的输出超过了字节上限，读不全就不给半份数据') }
    const exitCode: number = typeof res.exitCode === 'number' ? res.exitCode : -1
    const lines: string[] = String(res.stdout || '').split(/\r?\n/)
    const treeOid: string = String(lines[0] || '').trim()
    if (exitCode === 0) return { ok: true, clean: true, treeOid: treeOid, paths: [], command: argv.join(' '), readAtMs: nowFn() }
    if (exitCode === 1) {
      const paths: string[] = []
      const messages: string[] = []
      let inMessages: boolean = false
      for (let i = 1; i < lines.length; i += 1) {
        const line: string = lines[i]
        if (!inMessages && line.trim() === '') { inMessages = true; continue }
        if (inMessages) { if (line.trim() !== '') messages.push(line) } else paths.push(line)
      }
      return { ok: true, clean: false, treeOid: treeOid, paths: paths, messages: messages, command: argv.join(' '), readAtMs: nowFn() }
    }
    return { ok: false, envelope: fail('git-failed', 'unknown-write-failure', '预演合并这一步失败：git 原话「' + gitSays(res) + '」', { git: gitSays(res), step: '预演合并这一步', actual: '退出码 ' + exitCode }) }
  }

  /** rerere 读数（能力 6.14，只读）：开没开、有没有记着的解法路径；不替用户应用也不改配置。 */
  async function rerereOf(cwd: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const cfg: any = await readOut(b.exe, b.root, '读 rerere 开关这一步', ['config', '--get', 'rerere.enabled'], { allowNonZero: true })
    if (cfg.ok !== true) return cfg
    const enabled: boolean = cfg.exitCode === 0 && /^(true|1|yes|on)$/i.test(String(cfg.stdout || '').trim())
    let paths: string[] = []
    if (enabled) {
      const st: any = await readOut(b.exe, b.root, '读 rerere 解法清单这一步', ['rerere', 'status'], { allowNonZero: true })
      if (st.ok !== true) return st
      paths = String(st.stdout || '').split(/\r?\n/).filter(function (s: string): boolean { return s.trim() !== '' })
    }
    return { ok: true, enabled: enabled, paths: paths, autoUpdate: null, readAtMs: nowFn() }
  }

  return { fail: fail, readOut: readOut, baseOf: baseOf, sceneOf: sceneOf, bindingsOf: bindingsOf, measure: measure, digest16: digest16Of, readTextFile: readTextFile, writeTextFile: writeTextFile, fileViewOf: fileViewOf, markerLinesOf: markerLinesOf, markerCheckPathOf: markerCheckPathOf, markerCheckOf: markerCheckOf, mergePreviewOf: mergePreviewOf, rerereOf: rerereOf }
}

export const CONFLICT_SCENE_SOURCE = 'src/host/versionControlConflictScene.ts'
