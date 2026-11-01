// scripts/real-machine/lib/deck-write.mts —— 在隔离环境里直调 deck 写工具（#1709，规格 #1703 阶段 0 第 4 项）。
//
// 为什么单开这一层：规格要求在隔离实例里按固定入参调用 deck 写工具、拿回无损 JSON 回执、
// 再用 glab 独立读回。首选路线是在已开实例的页面上下文里走宿主代执行通道（wf.deckExec），
// 但提交门禁里没有实例，也不能从进程外直接 POST /api/dsws（实测 401）。研究笔记
// research/1677-execution-orchestration.md 的 3.2 节给了备选路线：照
// tests/verify-1559-deck-output-lossless.ts 的办法把 gate / registry / budget / handleFor /
// decideBackend 装成一份能跑的命令，后端固定 GitLab（真机上用真 glab，门禁里用夹具里的假 glab）。
//
// 三条不能改的约定：
//   1. 外部世界只从进程边界进来：glab 可执行文件由 GLAB_BIN 给，工作区与仓库标识由命令行参数给。
//      这一层不读真实 DSH 配置、不碰真实凭据、不访问真实 gitlab.com；缺 GLAB_BIN 就去 PATH 上找
//      是禁止的（那会把「没装」错判成「装好了」），所以 checkWriteEnvironment 先把它挡住。
//   2. 回执必须是无损 JSON：JSON 表达不了的值（NaN、Infinity、函数、Symbol）一律报错，不悄悄变成
//      null；对象里值为 undefined 的键显式剥掉（JSON 本来就不表达它），剥掉之后必须能往返等值。
//   3. 退出码要区分得开：0 成功、1 工具自己回了失败、2 参数或入口错、3 环境缺失、4 内部装配错。
//      门禁的拒绝路径靠 2/3 两个码判断，不靠读人话文案.contains。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureDir, repoRoot } from './util.mts'

/** 本命令允许直调的 deck 工具清单。多一个少一个都会让门禁的清单断言变红，改这里要同步改票面。 */
export const DECK_WRITE_TOOLS = ['deck_issue_create', 'deck_issue_patch', 'deck_map_link']

/** 退出码：0 成功；1 工具回失败；2 参数/入口错；3 环境缺失；4 内部装配错。 */
export const EXIT_OK = 0
export const EXIT_TOOL_FAILED = 1
export const EXIT_BAD_INPUT = 2
export const EXIT_ENV_MISSING = 3
export const EXIT_INTERNAL = 4

/** 起一次 glab 的结果（与 src/tracker/rooms/gitlab/client.ts 的 exec 约定同形）。 */
export interface GlabProcessResult {
  stdout: string
  stderr: string
  code: number
}

/** 一次 deck 写调用的全部入参（都是命令行给的值，函数内部不再读别的环境变量）。 */
export interface DeckWriteCall {
  tool: string
  args: Record<string, unknown>
  refId: string
  workspace: string
  glabBin: string
  timeoutMs?: number
}

/** 环境检查结果：ok 时 problems 为空；不 ok 时每条都是能直接贴给人看的中文句子。 */
export interface WriteEnvironmentCheck {
  ok: boolean
  problems: string[]
}

type JsonRecord = Record<string, unknown>

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

/** 只有普通对象才算记录（数组、null、class 实例都不算；回执形状要求是普通对象）。 */
export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 把回执整理成 JSON 能无损表达的形状：对象里值为 undefined 的键显式剥掉，数组里的 undefined
 * 记成 null（与 JSON.stringify 的结果一致，但这里是显式的），其它值原样保留。
 * 为什么要显式剥：JSON.stringify 会悄悄丢掉 undefined 键，读的人以为「写了」，实际没有；
 * 剥掉之后再由 losslessProblems 检查一遍，确认没有别的值会在写出去之后变样。
 * 函数与 Symbol 这里直接报错（不是「剥掉」）：它们出现在回执里说明上游拼错了，静默丢掉会让人
 * 以为那一格真的没有值。路径参数只为把报错指到具体位置（例如 data.bad）。
 */
export function normalizeForJson(value: unknown, base: string = ''): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('回执里有' + (typeof value === 'function' ? '函数值' : ' Symbol 值') + '（' + (base || '<根>') + '），JSON 写不出来，这次结果没法无损交出去。')
  }
  if (Array.isArray(value)) return value.map(function (item: unknown, index: number): unknown { return item === undefined ? null : normalizeForJson(item, joinPath(base, index)) })
  if (isRecord(value)) {
    const out: JsonRecord = {}
    for (const key of Object.keys(value)) {
      const item = value[key]
      if (item === undefined) continue
      out[key] = normalizeForJson(item, joinPath(base, key))
    }
    return out
  }
  return value
}

/** 路径写法：对象键用点，数组下标用方括号，例如 data.args.嵌套[0]。 */
function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return base + '[' + key + ']'
  return base === '' ? key : base + '.' + key
}

/**
 * 找出一份值经 JSON 往返之后会变样的位置。空数组 = 无损。
 * 只关心真会变样的：NaN/Infinity 会变成 null，函数与 Symbol 会整个消失，对象/数组里的键值会丢。
 * null 与 undefined 在顶层比较时前者是合法 JSON、后者不会出现在 normalizeForJson 之后，所以不报。
 */
export function losslessProblems(original: unknown, roundTrip: unknown, base: string = ''): string[] {
  if (typeof original === 'number' && !isFinite(original)) return [(base || '<根>') + ' 是 ' + String(original) + '，写进 JSON 会变成 null']
  if (typeof original === 'function' || typeof original === 'symbol') return [(base || '<根>') + ' 是 ' + typeof original + '，JSON 里没有这种东西，写出去就整个消失']
  if (Array.isArray(original)) {
    if (!Array.isArray(roundTrip)) return [(base || '<根>') + ' 在 JSON 里不是数组了']
    const problems: string[] = []
    if (original.length !== roundTrip.length) problems.push((base || '<根>') + ' 的长度从 ' + original.length + ' 变成了 ' + roundTrip.length)
    const shared = Math.min(original.length, roundTrip.length)
    for (let index = 0; index < shared; index += 1) problems.push(...losslessProblems(original[index], roundTrip[index], joinPath(base, index)))
    return problems
  }
  if (isRecord(original)) {
    if (!isRecord(roundTrip)) return [(base || '<根>') + ' 在 JSON 里不是对象了']
    const problems: string[] = []
    for (const key of Object.keys(original)) {
      const where = joinPath(base, key)
      if (!Object.prototype.hasOwnProperty.call(roundTrip, key)) {
        problems.push(where + ' 在 JSON 回执里不见了')
        continue
      }
      problems.push(...losslessProblems(original[key], roundTrip[key], where))
    }
    for (const key of Object.keys(roundTrip)) {
      if (!Object.prototype.hasOwnProperty.call(original, key)) problems.push(joinPath(base, key) + ' 在 JSON 回执里是多的（原值里没有这个键）')
    }
    return problems
  }
  if (original !== roundTrip) return [(base || '<根>') + ' 从 ' + JSON.stringify(original) + ' 变成了 ' + JSON.stringify(roundTrip)]
  return []
}

/** 序列化回执：末尾带一个换行，方便人打印与逐行 diff；写不出来时给一句中文原因。 */
export function serializeReceipt(receipt: unknown): string {
  let text: string
  try {
    text = JSON.stringify(receipt, null, 2)
  } catch (error) {
    throw new Error('回执里出现了 JSON 写不出来的值（例如循环引用），这次结果没法无损交出去：' + messageOf(error))
  }
  if (typeof text !== 'string') throw new Error('回执不是 JSON 能表达的值（拿到的是 ' + typeof receipt + '），这次结果没法无损交出去。')
  return text + '\n'
}

/**
 * 由工具返回值和工具名拼一份无损回执：先整理成 JSON 形状，再验证往返等值，任何会在写出去之后
 * 变样的值都直接报错（不假装成功）。工具没回对象时也报错——回执的五个基本格拿不到。
 */
export function buildReceipt(tool: string, result: unknown): JsonRecord {
  if (!isRecord(result)) throw new Error('工具没有返回对象回执（拿到的是 ' + (result === null ? 'null' : typeof result) + '），这次结果没法当成回执交出去。')
  const normalized = normalizeForJson(result) as JsonRecord
  const text = serializeReceipt(normalized)
  const roundTrip = JSON.parse(text) as unknown
  const problems = losslessProblems(normalized, roundTrip)
  if (problems.length > 0) throw new Error('工具回执不是无损 JSON，这些位置写出去之后会变样：' + problems.slice(0, 5).join('；'))
  const receipt = roundTrip as JsonRecord
  if (typeof receipt.status !== 'string' || receipt.status === '') throw new Error('工具回执缺少 status 这一格（工具名 ' + tool + '），没法判断这次成功还是失败。')
  return receipt
}

/** 回执状态到退出码：只有 ok 算成功，其余（failed/partial/unsupported/deferred）都是 1。 */
export function exitCodeForReceipt(receipt: unknown): number {
  const record = isRecord(receipt) ? receipt : {}
  return record.status === 'ok' ? EXIT_OK : EXIT_TOOL_FAILED
}

/** 退出码对应的中文说明（写 stderr 用，也是门禁读得懂的人话）。 */
export function exitCodeText(code: number): string {
  if (code === EXIT_OK) return '成功'
  if (code === EXIT_TOOL_FAILED) return '工具回了失败'
  if (code === EXIT_BAD_INPUT) return '参数或入口不对'
  if (code === EXIT_ENV_MISSING) return '环境缺失'
  if (code === EXIT_INTERNAL) return '内部装配出错'
  return '未知退出码'
}

/** 写回执文件（自动建父目录）；写不进去时抛中文错误，不留下半截文件。 */
export function writeReceiptFile(file: string, receipt: unknown): string {
  const resolved = path.resolve(file)
  const text = serializeReceipt(isRecord(receipt) ? normalizeForJson(receipt) : receipt)
  ensureDir(path.dirname(resolved))
  fs.writeFileSync(resolved, text, 'utf8')
  return resolved
}

/**
 * 检查这一趟的外部世界是否齐备。缺什么都写成人话；命令据此退出 3，门禁据此判拒绝路径。
 * 这里只碰文件系统，不调 glab、不联网。
 */
export function checkWriteEnvironment(input: { glabBin?: string; workspace?: string; refId?: string }): WriteEnvironmentCheck {
  const problems: string[] = []
  const glabBin = String(input.glabBin || '').trim()
  if (glabBin === '') {
    problems.push('没有收到 glab 可执行文件路径（环境变量 GLAB_BIN）：这一趟不会去 PATH 上找 glab，缺它就没法调用后端。')
  } else if (!fs.existsSync(glabBin)) {
    problems.push('GLAB_BIN 指向的文件不存在：' + glabBin + '（不会退回去用 PATH 上的 glab，免得把「没装」错判成「装好了」）。')
  } else {
    try {
      if (!fs.statSync(glabBin).isFile()) problems.push('GLAB_BIN 指向的不是文件（可能是目录）：' + glabBin)
    } catch (error) {
      problems.push('看不了 GLAB_BIN 指向的文件：' + glabBin + '（' + messageOf(error) + '）')
    }
  }
  const workspace = String(input.workspace || '').trim()
  if (workspace === '') {
    problems.push('没有收到工作区目录（--workspace）：deck 工具要绑到一个本地工作区上才知道把票写进哪个仓库。')
  } else if (!fs.existsSync(workspace)) {
    problems.push('工作区目录不存在：' + workspace)
  } else {
    try {
      if (!fs.statSync(workspace).isDirectory()) problems.push('--workspace 指向的不是目录：' + workspace)
    } catch (error) {
      problems.push('看不了工作区目录：' + workspace + '（' + messageOf(error) + '）')
    }
  }
  const refId = String(input.refId || '').trim()
  if (refId === '') {
    problems.push('没有收到仓库标识（--ref）：要写成 <group>/<project>，例如 FixtureGroup/dsh-deck-demo。')
  } else if (!/^[^/\s]+\/[^/\s]+$/.test(refId)) {
    problems.push('仓库标识要写成 <group>/<project> 两段（收到「' + refId + '」）：只写项目名没法拼出 GitLab 的项目路径。')
  }
  return { ok: problems.length === 0, problems: problems }
}

/** 读入参 JSON 文件；读不懂或不是对象时回 ok:false 与一句中文原因（命令据此退出 2）。 */
export function readToolArgsFile(file: string): { ok: boolean; args: JsonRecord; problem: string } {
  const target = String(file || '').trim()
  if (target === '') return { ok: false, args: {}, problem: '没有收到入参文件（--args）：要给它一个 JSON 文件，里面是这次工具调用的参数对象。' }
  const resolved = path.resolve(target)
  if (!fs.existsSync(resolved)) return { ok: false, args: {}, problem: '入参文件不存在：' + resolved }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    return { ok: false, args: {}, problem: '入参文件读不懂（不是合法 JSON）：' + resolved + '（' + messageOf(error) + '）' }
  }
  if (!isRecord(parsed)) return { ok: false, args: {}, problem: '入参文件的 JSON 必须是对象（收到的是 ' + (Array.isArray(parsed) ? '数组' : typeof parsed) + '）：' + resolved }
  return { ok: true, args: parsed as JsonRecord, problem: '' }
}

/**
 * 起一次 glab 子进程。Windows 上 .cmd/.bat 必须经 ComSpec 起（与 tests/lib/real-machine-process.ts
 * 里 runExternal 同一套办法），否则 Node 会 EINVAL；其它平台直接 spawn。
 * 返回 {stdout,stderr,code}，不起进程的失败给 127（与 shell 的「命令找不到」同码）。
 *
 * 另有一条只管测试的支路：GLAB_BIN 指向 .mts/.mjs/.js/.cjs 脚本时用当前 node 起它。
 * 为什么必须有这条：门禁里的假 glab 是 .mts 脚本，而 Windows 经 cmd.exe 传带换行的参数会被截断
 * ——实测「退出码 0、假 glab 一次都没跑」，整条建票写路径就断在这里（票面正文本来就带换行）。
 * 真机阶段 GLAB_BIN 是可执行的 glab 程序（.exe 或 .cmd 启动器），不会走这条支路。
 */
export function runGlabProcess(glabBin: string, argv: string[], options: { cwd?: string; timeoutMs?: number } = {}): GlabProcessResult {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const timeout = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 120000
  const lower = glabBin.toLowerCase()
  const viaComSpec = process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))
  const viaNode = !viaComSpec && (lower.endsWith('.mts') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js'))
  const command = viaComSpec ? String(process.env.ComSpec || 'cmd.exe') : (viaNode ? process.execPath : glabBin)
  const args = viaComSpec
    ? ['/d', '/c', glabBin].concat(argv)
    : (viaNode ? ['--no-warnings', glabBin].concat(argv) : argv)
  let result
  try {
    result = spawnSync(command, args, {
      cwd: cwd,
      env: Object.assign({}, process.env),
      timeout: timeout,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    })
  } catch (error) {
    return { stdout: '', stderr: '起 glab 进程失败：' + messageOf(error), code: 127 }
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  if (typeof result.status === 'number') return { stdout: stdout, stderr: stderr, code: result.status }
  if (result.error) return { stdout: stdout, stderr: stderr || ('glab 进程没跑起来：' + messageOf(result.error)), code: 127 }
  return { stdout: stdout, stderr: stderr, code: 1 }
}

/** 动态加载仓库源码（与 tests/verify-1559-deck-output-lossless.ts 同一个办法：file URL + 绝对路径）。 */
async function importSource(repoDir: string, relative: string): Promise<Record<string, any>> {
  return (await import(pathToFileURL(path.join(repoDir, relative)).href)) as Record<string, any>
}

/** 每个可直调工具对应哪个工厂函数（与 DECK_WRITE_TOOLS 一一对应，多一条少一条门禁会红）。 */
const TOOL_FACTORIES: Record<string, { file: string; factory: string }> = {
  deck_issue_create: { file: 'src/deck/tools/issue-create.ts', factory: 'createDeckIssueCreate' },
  deck_issue_patch: { file: 'src/deck/tools/issue-patch.ts', factory: 'createDeckIssuePatch' },
  deck_map_link: { file: 'src/deck/tools/map-link.ts', factory: 'createDeckMapLink' },
}

/** 把 GitLab 房间要的文件系统接口包成本地 Node 版（工具只读工作区里的锚文件，这里给最小的一套）。 */
function makeLocalFs(): Record<string, unknown> {
  return {
    resolve: function (target: string): string { return path.resolve(target) },
    readText: function (target: string): string { return fs.readFileSync(target, 'utf8') },
    writeText: function (target: string, text: string): void {
      ensureDir(path.dirname(path.resolve(target)))
      fs.writeFileSync(target, text, 'utf8')
    },
    exists: function (target: string): boolean { return fs.existsSync(target) },
    lstat: function (target: string): unknown { return fs.lstatSync(target) },
    stat: function (target: string): unknown { return fs.statSync(target) },
    listDir: function (target: string): unknown[] { return fs.readdirSync(target, { withFileTypes: true }) },
  }
}

/**
 * 装配一次 deck 写调用并跑工具。返回工具自己的回执（已过无损检查），不打印、不写盘——
 * 打印与写盘是命令层的事，这样纯函数与装配逻辑都能被实现层单测直接调。
 */
export async function callDeckWriteTool(call: DeckWriteCall): Promise<JsonRecord> {
  const entry = TOOL_FACTORIES[call.tool]
  if (!entry) throw new Error('这个工具不在可直调清单里：' + call.tool + '（只有 ' + DECK_WRITE_TOOLS.join('、') + '）')
  const repoDir = repoRoot()
  const workspace = path.resolve(call.workspace)
  const glabBin = call.glabBin
  const now = function (): number { return Date.now() }

  const gitlab = await importSource(repoDir, 'src/tracker/rooms/gitlab/index.ts')
  const gitlabBackend = gitlab.gitlabBackend
  const budget = await importSource(repoDir, 'src/refresh/kernel/host-budget.ts')
  const toolCost = await importSource(repoDir, 'src/refresh/kernel/tool-call-budget.ts')
  const ledgerMod = await importSource(repoDir, 'src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await importSource(repoDir, 'src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await importSource(repoDir, 'src/tracker/registry/core.ts')

  const localFs = makeLocalFs()
  const backendCtx: JsonRecord = {
    platform: {
      path: path.posix,
      fs: localFs,
      resolveExecutable: async function (name: string): Promise<string> { return name === 'glab' ? glabBin : '' },
    },
    fs: localFs,
    cwd: workspace,
    exec: async function (_name: string, argv: string[], options?: unknown): Promise<GlabProcessResult> {
      const opts = isRecord(options) ? options : {}
      const cwd = typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : workspace
      const timeoutMs = typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : call.timeoutMs
      return runGlabProcess(glabBin, argv, { cwd: cwd, timeoutMs: timeoutMs })
    },
    get: function (name: string): unknown { return name === 'fs' ? localFs : undefined },
  }

  // 账本与闸：GitLab 是「只计请求」的后端，先把这个后端的 requests 桶建出来再同步一份读数。
  // 不建桶直接同步会抛（读数不许跨后端落账），不读额度则探针会按未知处理——两条路都不该靠猜。
  const clock = now()
  const ledger = ledgerMod.createLedger({ now: now })
  ledger.ensureBackend('gitlab', gitlabBackend.budget)
  ledger.syncServer('gitlab', { requests: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const gate = gateMod.createGate({
    ledger: ledger,
    now: now,
    budgetModelOf: function (backendId: string): unknown { return backendId === 'gitlab' ? gitlabBackend.budget : { kind: 'unknown' } },
  })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: function (): void {}, isEnabled: function (): boolean { return false } }, backendCtx), { matchesTimeout: 200 })
  registry.register(gitlabBackend)

  const parts = /^([^/\s]+)\/([^/\s]+)$/.exec(call.refId)
  const ref = {
    backend: 'gitlab',
    refId: call.refId,
    name: parts ? parts[2] : call.refId,
    url: 'https://gitlab.com/' + call.refId,
  }
  const deps: JsonRecord = {
    gate: gate,
    registry: registry,
    budget: budget,
    estimate: toolCost.estimateToolCost,
    costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: backendCtx,
    handleFor: function (): unknown { return { cwd: workspace, refId: call.refId } },
    decideBackend: async function (): Promise<unknown> { return { backendId: 'gitlab', source: 'explicit', ref: ref } },
    log: { fire: function (): void {} },
    now: now,
  }
  const toolModule = await importSource(repoDir, entry.file)
  const tool = toolModule[entry.factory](deps)
  const exec = { agent: { session: { id: 'deck-write-' + call.tool, cwd: workspace } } }
  const result = await tool.run(exec, call.args || {})
  return buildReceipt(call.tool, result)
}
