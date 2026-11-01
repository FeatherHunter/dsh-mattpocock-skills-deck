// host/versionControlConfig.ts —— 域 12（配置与钩子）的读取电话 wf.gitConfigRead 与预检电话 wf.gitConfigCheck（#1760 T24）
//
// 为什么要分预检与执行（规格第 8 节的三段式）：配置页能改的只有提交身份两个键（user.name / user.email），
//   但「改身份」也可能与终端里同时进行的操作撞车——预检读到旧值，用户在确认卡上读了半分钟，这半分钟里
//   终端改了这个键或把仓库切走了。没有票据的话，用户确认的是「刚才那个旧值」，执行的却是「现在的仓库」。
//   办法照 #1746 分支域、#1742 改动页的既有先例：预检把要动的键、作用域、旧值量成绑定值写进 120 秒的票里，
//   执行层（versionControlConfigWrite.ts）重读同一批事实逐格比对，任何一格变了就零命令拒绝。
//
// 读法口径（规格第 3.10 节）：配置用 git config --list --show-origin -z 一次读全，再按文件来源反推作用域
//   （见 shared/version-control/src/config-rules.ts）；不解析配置文件文本，不读 .git/config 的字节。
//   身份两条的旧值按作用域分开记（local/global），界面才能在确认卡上写清「原来是什么、要改成什么」。
//
// 版本门（能力账本 12.6）：git hook run 要 2.36。低版本在预检阶段就按 blocked/hook-version 拒，并回替代做法；
//   界面据此画「当前 git 版本不支持」的只读说明，而不是给一个点了报错的按钮。
//
// 起进程纪律：本文件只跑只读命令（读配置、读版本、读钩子路径与钩子目录），绝不起写命令；
//   所有 git 调用经装配处注入的 runPinned（-C 钉仓库、固定前缀、字节上限、超时、报闸）。
import { configListArgs, gitPathArgs, versionArgs, checkAttrArgs, checkMailmapArgs } from '../shared/version-control/src/commands.js'
import { makeTicket, makeBindings } from '../shared/version-control/src/write-ticket.js'
import {
  CONFIG_CHECK_CONTRACT,
  CONFIG_CHECK_VERSION,
  CONFIG_WRITE_OPS,
  CONFIG_ENTRY_DEFS,
  HOOK_NAMES,
  configCheckPlanOf,
  configNeedsConfirmOf,
  configConfirmOf,
  configSceneSummary,
  configOldValueOf,
  configRowsOf,
  configHookRunStateOf,
  configHookDigestInput,
  configOldValueInput,
  configPlanDigestInput,
  parseConfigList,
  parseCheckAttr,
  parseCheckMailmap,
} from '../shared/version-control/src/config-rules.js'
import { VC_CONFIG_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，内建模块必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'
// @ts-expect-error 同一原因：宿主运行时一定有 node:fs。
import { existsSync as fsExists, readFileSync as fsReadFile, readdirSync as fsReaddir, statSync as fsStat } from 'node:fs'
// @ts-expect-error 同一原因：宿主运行时一定有 node:path。
import { isAbsolute as pathIsAbsolute, resolve as pathResolve, join as pathJoin } from 'node:path'

/** 摘要：票据绑定表只用 16 位十六进制，够判「两次读数一样不一样」且不把原文带进票据。
 *  这八份的算法体由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须八处一起改。 */
function digest16Of(text: any): string {
  try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' }
}

/**
 * 造配置域的读取电话与预检电话：返回 { handleGitConfigRead, handleConfigCheck, tickets, results, measure }。
 * tickets / results 是宿主进程内存里的两张表，执行叶子共用同一份（预检签的票执行必须能在同一张表里找到）；
 * measure 供执行叶子在动手前按同一口径重算现场（不另写第二套读法）。
 */
export function createConfigPhones(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  /** 失败信封：kind 是环节，reason 给固定理由标识符（票据门用），附加字段平铺在顶层。 */
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  function gitSays(res: any): string {
    const text: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return text.slice(0, 400)
  }
  /** 读一条只读命令：起进程失败/超时走 failureFromExec；读不全显式失败；非零退出交给调用方决定。 */
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero?: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, { stdoutLimit: 8 * 1024 * 1024, timeoutMs: READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || (allowNonZero && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }
  }
  async function baseOf(cwd: string): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: String(base.root) }
  }
  /** 相对路径按仓库根解析成绝对路径：git rev-parse --git-path 回的是相对仓库根的位置。 */
  function resolveAt(root: any, rel: any): string {
    const s: string = String(rel === undefined || rel === null ? '' : rel).trim()
    if (s === '') return ''
    return pathIsAbsolute(s) ? s : pathResolve(String(root), s)
  }
  /** 读配置清单：--show-origin -z 一次读全，解析失败整份失败，不给半份配置。 */
  async function entriesOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读配置清单这一步', configListArgs())
    if (r.ok !== true) return r
    const parsed: any = parseConfigList(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '配置清单解析失败：' + parsed.detail) }
    return { ok: true, entries: parsed.entries }
  }
  async function textOf(exe: any, root: any, what: string, args: string[]): Promise<any> {
    const r: any = await readOut(exe, root, what, args, true)
    if (r.ok !== true) return r
    return { ok: true, text: String(r.stdout || '').replace(/\r?\n$/, '').trim(), exitCode: r.exitCode }
  }
  /** 读钩子目录：core.hooksPath 指到哪就去哪；目录读不到按「没有钩子」处理但照实说读不到。 */
  function hooksOf(root: any, relPath: any): any {
    const dir: string = resolveAt(root, relPath)
    let names: string[] = []
    let readable: boolean = false
    try { names = fsReaddir(dir); readable = true } catch (e) { readable = false }
    const entries: any[] = []
    for (let i: number = 0; i < names.length; i += 1) {
      const name: string = String(names[i])
      const file: string = pathJoin(dir, name)
      let size: number = 0
      let executable: boolean = false
      try { const st: any = fsStat(file); size = Number(st.size || 0); executable = (Number(st.mode) & 73) !== 0 } catch (e) { size = 0 }
      entries.push({ name: name, sample: /[.]sample$/.test(name), executable: executable, size: size })
    }
    entries.sort(function (a: any, b: any): number { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0) })
    return { dir: dir, readable: readable, entries: entries }
  }
  /** 读一次现场：配置清单、版本、HEAD、钩子目录，外加 12.7/12.8 两条按需的只读读数。 */
  async function sceneOf(exe: any, root: any, args: any): Promise<any> {
    const list: any = await entriesOf(exe, root)
    if (list.ok !== true) return list
    const ver: any = await textOf(exe, root, '读 git 版本这一步', versionArgs())
    if (ver.ok !== true) return ver
    const head: any = await textOf(exe, root, '读 HEAD 这一步', ['rev-parse', '--verify', 'HEAD'])
    if (head.ok !== true) return head
    const cfgPath: any = await textOf(exe, root, '读本地配置文件位置这一步', gitPathArgs('config'))
    if (cfgPath.ok !== true) return cfgPath
    const hooksRel: any = await textOf(exe, root, '读钩子目录位置这一步', gitPathArgs('hooks'))
    if (hooksRel.ok !== true) return hooksRel
    const localConfigPath: string = resolveAt(root, cfgPath.text)
    const rows: any[] = configRowsOf(list.entries, localConfigPath)
    const hooks: any = hooksOf(root, hooksRel.text)
    let hooksConfigured: string | null = null
    for (let i: number = 0; i < rows.length; i += 1) if (rows[i].key === 'core.hooksPath') hooksConfigured = rows[i].value === undefined ? null : rows[i].value
    const a: any = args || {}
    let attr: any = { state: 'idle' }
    const pathArg: string = String(a.path === undefined || a.path === null ? '' : a.path)
    if (pathArg !== '') {
      const r: any = await readOut(exe, root, '查属性规则这一步', checkAttrArgs(pathArg), true)
      if (r.ok !== true) attr = { state: 'err', message: '属性规则读不出来：这次先不给读数' }
      else {
        const parsed: any = parseCheckAttr(r.stdout)
        attr = parsed.ok === true ? { state: 'ok', path: pathArg, entries: parsed.entries } : { state: 'err', message: '属性规则解析失败：' + parsed.detail }
      }
    }
    let mailmap: any = { state: 'idle' }
    const address: string = String(a.address === undefined || a.address === null ? '' : a.address)
    if (address !== '') {
      const r2: any = await readOut(exe, root, '查邮件映射这一步', checkMailmapArgs(address), true)
      if (r2.ok !== true) mailmap = { state: 'err', message: '邮件映射读不出来：这次先不给读数' }
      else mailmap = { state: 'ok', address: address, mapped: parseCheckMailmap(r2.stdout), exitCode: r2.exitCode }
    }
    const known: string[] = []
    const hookNames: string[] = hooks.entries.map(function (x: any): string { return String(x.name) })
    for (let i: number = 0; i < HOOK_NAMES.length; i += 1) if (hookNames.indexOf(HOOK_NAMES[i]) >= 0) known.push(HOOK_NAMES[i])
    return { ok: true, entries: list.entries, localConfigPath: localConfigPath, gitVersion: ver.text, headOid: head.text, rows: rows, hooks: { dir: hooks.dir, configured: hooksConfigured, readable: hooks.readable, entries: hooks.entries, known: known }, attr: attr, mailmap: mailmap }
  }
  function findRow(rows: any[], key: string): any {
    for (let i: number = 0; i < rows.length; i += 1) if (rows[i] && rows[i].key === key) return rows[i]
    return null
  }
  function identOf(scene: any): any {
    const name: any = findRow(scene.rows, 'user.name') || { values: {} }
    const email: any = findRow(scene.rows, 'user.email') || { values: {} }
    return {
      nameLocal: name.values.local === undefined ? null : name.values.local,
      nameGlobal: name.values.global === undefined ? null : name.values.global,
      emailLocal: email.values.local === undefined ? null : email.values.local,
      emailGlobal: email.values.global === undefined ? null : email.values.global,
    }
  }
  function hookFileOf(scene: any, name: string): any {
    for (let i: number = 0; i < scene.hooks.entries.length; i += 1) if (scene.hooks.entries[i].name === name) return scene.hooks.entries[i]
    return null
  }
  /** 这次要动的那几个观测量：身份旧值（按作用域）或钩子文件内容摘要。 */
  function factsOf(scene: any, plan: any): any {
    const op: string = String(plan.op || '')
    if (op === 'hook-run') {
      const name: string = String(plan.name || '')
      const file: string = pathJoin(String(scene.hooks.dir || ''), name)
      let digest: string = ''
      try { digest = digest16Of(fsReadFile(file)) } catch (e) { digest = '' }
      return { ok: true, hookFile: file, hookDigest: digest, hookExists: scene.hooks.readable && fsExists(file) }
    }
    const key: string = String(plan.key || '')
    const scope: string = String(plan.scope || 'local')
    const oldValue: string | null = configOldValueOf(scene.entries, key, scope, scene.localConfigPath)
    return { ok: true, oldValue: oldValue }
  }
  function bindingsOf(plan: any, facts: any): any {
    const op: string = String(plan.op || '')
    const oldInput: string | null = op === 'hook-run' ? configHookDigestInput(facts.hookDigest) : configOldValueInput(plan.scope, facts.oldValue)
    return makeBindings({ preconditions: { planDigest: digest16Of(configPlanDigestInput(plan)), configOldValue: oldInput, pathAbsent: [] }, counters: { indexEntries: null } })
  }
  /** 现场摘要：block 时也要回，界面才能画「为什么不能点」。 */
  function sceneSummaryOf(scene: any, plan: any): any {
    const ident: any = identOf(scene)
    const name: string = String(plan.name || '')
    return configSceneSummary({
      identity: ident,
      hooksPath: scene.hooks.configured,
      hookExists: name === '' ? null : (scene.hooks.readable && fsExists(pathJoin(String(scene.hooks.dir || ''), name))),
      headOid: scene.headOid,
    })
  }
  function sign(plan: any, root: any, scene: any, facts: any, confirm: any, confirmRequired: boolean): any {
    const ticket: any = makeTicket({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      op: plan.op as any,
      nowMs: nowFn(),
      headOid: scene.headOid,
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: String(root),
      changes: null,
      bindings: bindingsOf(plan, facts),
    })
    // 计划与确认对象随票保存：执行层只按这张票里的计划拼 argv，客户端再送一遍参数也不采信。
    ticket.plan = plan
    ticket.confirm = confirm
    ticket.confirmRequired = confirmRequired
    ticket.sceneSummary = sceneSummaryOf(scene, plan)
    tickets.set(ticket.id, ticket)
    // 票表只活内存；超过 200 张按插入顺序删最旧的，避免长会话里无限长。
    while (tickets.size > 200) { const k: any = tickets.keys().next().value; tickets.delete(k) }
    return ticket
  }
  /** 12.1 读配置（含 12.7 属性规则、12.8 邮件映射的按需读数）：一次取回配置页与钩子页要画的所有读数。 */
  async function handleGitConfigRead(args: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = typeof a.cwd === 'string' ? a.cwd : ''
    const b: any = await baseOf(cwd)
    if (b.fail) return b.fail
    const scene: any = await sceneOf(b.exe, b.root, a)
    if (scene.ok !== true) return scene.envelope
    const ident: any = identOf(scene)
    const hooks: any = Object.assign({}, scene.hooks, { configured: scene.hooks.configured === undefined ? null : scene.hooks.configured })
    return {
      ok: true,
      contract: 'version-control.config-read',
      version: 1,
      readAtMs: nowFn(),
      repoRoot: b.root,
      gitVersion: scene.gitVersion,
      hookRunVersion: configHookRunStateOf(scene.gitVersion),
      configPath: scene.localConfigPath,
      groups: scene.rows,
      identity: { name: { local: ident.nameLocal, global: ident.nameGlobal }, email: { local: ident.emailLocal, global: ident.emailGlobal } },
      hooks: hooks,
      attr: scene.attr,
      mailmap: scene.mailmap,
      entries: CONFIG_ENTRY_DEFS,
    }
  }
  /**
   * 12.2/12.3/12.4/12.6 的预检：校验计划 → 读现场 → 边界/版本/存在性判定 → 签票。
   * block 时不签票，但照样回现场与理由：界面画「为什么不能点」，玩家不必点一下才知道。
   */
  async function handleConfigCheck(args: any): Promise<any> {
    const a: any = args || {}
    if (typeof a.cwd !== 'string' || a.cwd.trim() === '') return fail('args', 'bad-target', '缺少工作目录：预检必须先说清在哪个仓库做')
    const op: string = String(a.op || '')
    if (CONFIG_WRITE_OPS.indexOf(op) < 0) return fail('args', 'bad-target', '这个动作不走预检：' + op)
    const planRes: any = configCheckPlanOf(op, a)
    if (!planRes.ok) return fail('args', planRes.reason, planRes.message, { reasons: [planRes.reason] })
    const plan: any = planRes.plan
    const b: any = await baseOf(a.cwd)
    if (b.fail) return b.fail
    const scene: any = await sceneOf(b.exe, b.root, a)
    if (scene.ok !== true) return scene.envelope
    const blocked = function (reason: string, message: string): any {
      return fail('blocked', reason, message, { contract: CONFIG_CHECK_CONTRACT, version: CONFIG_CHECK_VERSION, op: op, decision: { verdict: 'block', reasons: [reason] }, reasons: [reason], confirm: configConfirmOf(plan), scene: sceneSummaryOf(scene, plan), readAtMs: nowFn() })
    }
    if (op === 'hook-run') {
      const gate: any = configHookRunStateOf(scene.gitVersion)
      if (gate.state !== 'full') return blocked('hook-version', '当前 git 版本不支持 git hook run（需要 ' + gate.needed + '）：' + String(gate.alternative || ''))
      const file: any = hookFileOf(scene, String(plan.name || ''))
      if (!file) return blocked('hook-not-found', '这个钩子在当前钩子目录里没有对应文件（钩子目录：' + String(scene.hooks.dir || '') + '）')
    } else {
      const facts: any = factsOf(scene, plan)
      if (op === 'config-unset' && (facts.oldValue === null || facts.oldValue === undefined)) return blocked('config-missing', '这个键在当前作用域里本来就没有值，没有可删的')
    }
    const facts: any = factsOf(scene, plan)
    const confirmRequired: boolean = configNeedsConfirmOf(plan)
    const confirm: any = configConfirmOf(plan)
    const ticket: any = sign(plan, b.root, scene, facts, confirm, confirmRequired)
    return {
      ok: true,
      contract: CONFIG_CHECK_CONTRACT,
      version: CONFIG_CHECK_VERSION,
      op: op,
      decision: { verdict: 'allow', reasons: ['ok'] },
      reasons: ['ok'],
      confirmRequired: confirmRequired,
      confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      scene: sceneSummaryOf(scene, plan),
      readAtMs: nowFn(),
    }
  }
  /** 执行前的现场重量：与预检同一套读法与同一套摘要口径；执行层只拿它算出来的绑定表去比对。 */
  async function measure(cwd: string, plan: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const scene: any = await sceneOf(b.exe, b.root, {})
    if (scene.ok !== true) return { ok: false, envelope: scene.envelope }
    const facts: any = factsOf(scene, plan)
    return { ok: true, repoRoot: String(b.root), headOid: scene.headOid, bindings: bindingsOf(plan, facts), facts: facts, scene: scene }
  }

  return { handleGitConfigRead: handleGitConfigRead, handleConfigCheck: handleConfigCheck, tickets: tickets, results: results, measure: measure }
}

export const CONFIG_PHONES_SOURCE = 'src/host/versionControlConfig.ts'
