// verify/scenarios/1831-read-timeout.ts —— 真机验证 #1831：读操作要有自己的总时限，到点回部分结果、用读口径。
//
// 验证路线：用 base 的真机验证能力开一个隔离的 web profile 实例，把候选包装进去，然后从页面里走宿主
// 代执行通道（POST /api/dsws，method = deckExec）直接调运行中宿主里的 deck 读工具。验证的是「装进
// profile 之后真实运行的插件」，不是门禁用桩后端拼出来的那套。
//
// 这份场景有三个模式，同一个文件跑三遍：
//   - 正常模式（默认）：用真的 gh 读这个仓库的真实票，#1831 的事故现场就是 deck_issue_get body=full
//     挂了 173 秒。这里要求：读调用都在 30 秒内回来、回执是读口径、日志里 gh.exec 行带非空 opId。
//   - 挂住模式（VERIFY_1831_HANG=1）：父进程 PATH 最前面放一个会挂住的假 gh，让读票/读列表的后端
//     永不回话。这一档先在房间里被单条命令 30 秒的分档上限掐断（#1799 会把它映射成 backend-threw），
//     所以这里只要求：总耗时明显早于宿主 120 秒、正文是读口径（不含「不要直接重放写操作」）、日志里
//     工具自己发出的 gh.timeout 行带得上这次工具调用的 opId。
//   - 慢后端模式（VERIFY_1831_SLOW=1）：假 gh 只把「工具读列表」那条按更新时间倒序的查询放慢（先睡
//     18 秒再转给真的 gh），界面轮询与后台刷新走的按创建时间、计数查询都照常。于是每条分页命令都成功、都比
//     房内 30 秒上限短，但一趟读列表要串行翻十几页，合计超过工具级 60 秒钳制。这一档验证的才是 #1831
//     要的那条硬截止：到点不再等，回 status=partial、data.partial=true、data.incomplete='timeout'，
//     文案只说读；同时日志里能按 opId 看到那笔还在飞的 gh 调用被取消（gh.exec kind=cancelled 或
//     exec.run endReason=aborted），证明取消一路传到了后端进程。
//
// 手动跑法（工作根与批次 home 换成你自己的）：
//   $env:DSH_HOME='<批次 home>'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js `
//     run verify/scenarios/1831-read-timeout.ts --profile web `
//     --work-root <工作根> --json --collect-all
//   挂住模式：先把挂住版假 gh 目录插到 $env:PATH 最前面，设 $env:VERIFY_1831_HANG='1' 重跑同一条命令。
//   慢后端模式：PATH 换成「只慢工具读列表查询」的假 gh 目录，设 $env:VERIFY_1831_SLOW='1' 重跑同一条命令。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
/** 事故票本体：正常模式下读它，验证真实网络下读票能快速回。 */
const SELF_KEY = '1831'
/** 挂住模式用的票号：正文很长（票面 173 秒事故就是读它 body=full），多评论，最接近现场。 */
const HANG_KEY = '1232'
/** 宿主 run_code 的工具调用上限 120 秒；读工具必须明显早于它收手。 */
const HOST_LIMIT_MS = 120000
/** 正常模式下一次读调用的宽限：真实网络抖动也不该超过 30 秒（事故是 173 秒）。 */
const HEALTHY_LIMIT_MS = 30000
/** 慢后端模式最少要等这么久，才能证明「真的等到工具级钳制到点才收手」，不是快速失败。 */
const SLOW_MIN_MS = 30000

const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length'
const CLOSE_BUTTON = 'button[aria-label="关闭"]'
const WORKSPACE_BUTTON = 'button[aria-label="选择工作区"]'
const PASSWORD_INPUT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('input[type="password"]') + ').length'
const BODY_TEXT_SCRIPT = 'document.body.innerText || ""'

interface RawBrowserPage {
  readonly goto?: (url: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  readonly click?: (selector: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  readonly press?: (key: string) => Promise<{ ok: boolean; error?: { message?: string } }>
}

/** 宿主回的 deck 工具回执；失败时也可能只有 status/reason/text。 */
interface HostReceipt {
  readonly status?: string
  readonly text?: string
  readonly data?: Record<string, unknown>
  readonly notes?: readonly unknown[]
  readonly reason?: string
}

interface ToolProbe {
  readonly http: number
  readonly envelopeText: string
  readonly envelope: unknown
  readonly receipt: HostReceipt | null
  readonly problem: string | null
  /** 从发起页面调用到回执落地的毫秒数：这次读到底等了多久。 */
  readonly elapsedMs: number
}

interface InstalledProbe {
  readonly version: string | null
  readonly readCallTimeoutMs: number | null
  readonly valuesPath: string | null
  readonly getHasFix: boolean
  readonly listHasFix: boolean
  readonly problem: string | null
}

interface LogFields {
  readonly [key: string]: unknown
}

interface LogEntry {
  readonly event: string
  readonly ts: number | null
  readonly fields: LogFields
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 在页面里走客户端的 RPC 协议调宿主代执行通道：POST /api/dsws，信封是 client-request，
 * payload.method 是 'deckExec'。evaluate 只收字符串，所以把整段写成自调用表达式。
 */
function deckExecScript(tool: string, args: Record<string, unknown>): string {
  const call = { tool, args, session: { cwd: REPO_ROOT, sessionId: 'verify-1831-read-timeout' } }
  const body = {
    type: 'client-request',
    rpcId: 'verify-1831-' + Math.random().toString(36).slice(2, 12),
    payload: { method: 'deckExec', payload: call },
  }
  return [
    '(async function () {',
    '  var body = ' + JSON.stringify(body) + ';',
    '  var response = await fetch("/api/dsws", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { http: response.status, envelopeText: text.slice(0, 2000), envelope: parsed };',
    '})()',
  ].join('\n')
}

/** 宿主回包 { type, rpcId, result: { ok, value } }；也兼容直接把回执摊在最外层的老形状。 */
function pickReceipt(envelope: unknown): HostReceipt | null {
  const top = asRecord(envelope)
  if (top === null) return null
  const result = asRecord(top.result) !== null ? asRecord(top.result) : top
  if (result === null) return null
  if (result.ok === true) {
    const value = asRecord(result.value)
    if (value !== null && typeof value.status === 'string' && typeof value.text === 'string') return value as unknown as HostReceipt
  }
  if (typeof result.status === 'string' && typeof result.text === 'string') return result as unknown as HostReceipt
  return null
}

/** 调一次 deck 工具，并把「这次调用等了多久」量出来——本票的核心指标就是它。 */
async function runDeckToolTimed(page: PageHandle, tool: string, args: Record<string, unknown>): Promise<ToolProbe> {
  const startedAt = Date.now()
  const probe = await page.evaluate<{ http: number; envelopeText: string; envelope: unknown }>(deckExecScript(tool, args))
  const elapsedMs = Date.now() - startedAt
  if (!probe.ok) {
    return { http: 0, envelopeText: '', envelope: null, receipt: null, problem: '页面里发不出这次调用：' + probe.error.message, elapsedMs }
  }
  const receipt = pickReceipt(probe.value.envelope)
  return {
    http: probe.value.http,
    envelopeText: probe.value.envelopeText,
    envelope: probe.value.envelope,
    receipt,
    problem: receipt === null ? '宿主回包里没有工具回执（HTTP ' + String(probe.value.http) + '）：' + probe.value.envelopeText.slice(0, 300) : null,
    elapsedMs,
  }
}

async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<{ path: string | null; problem: string | null }> {
  const saved = await context.evidence.recordJson(name, value, { note })
  if (!saved.ok) return { path: null, problem: '证据没写下来（' + name + '）：' + saved.error.message }
  return { path: saved.value.path, problem: null }
}

/**
 * 读运行实例里装着的插件包：版本、中央读时限，以及读票/读列表实现里有没有这次修复留下的标记。
 * 候选身份由批次记录绑定；这里回答的是「跑起来的那份代码里到底有没有这次修复」。
 */
function inspectInstalledPlugin(home: string, profile: string): InstalledProbe {
  const pkgDir = path.join(home, 'profiles', profile, 'node_modules', 'dsh-mattpocock-skills-deck')
  const empty: InstalledProbe = { version: null, readCallTimeoutMs: null, valuesPath: null, getHasFix: false, listHasFix: false, problem: null }
  let version: string | null = null
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>
    version = typeof parsed.version === 'string' ? parsed.version : null
  } catch (error) {
    return Object.assign({}, empty, { problem: '读不到实例里的插件 package.json：' + messageOf(error) })
  }
  // 中央时间参数：读调用总时限必须是 90000，且必须小于宿主 120 秒。
  const valuesPath = path.join(pkgDir, 'shared', 'time-config', 'values.js')
  let readCallTimeoutMs: number | null = null
  try {
    const source = fs.readFileSync(valuesPath, 'utf8')
    const matched = /READ_CALL_TIMEOUT_MS\s*=\s*([0-9]+(?:\.[0-9]+)?(?:e[0-9]+)?)/i.exec(source)
    readCallTimeoutMs = matched === null ? null : Number(matched[1])
    if (readCallTimeoutMs !== null && !Number.isFinite(readCallTimeoutMs)) readCallTimeoutMs = null
  } catch (error) {
    return Object.assign({}, empty, { version, problem: '读不到实例里的 time-config/values.js：' + messageOf(error) })
  }
  // 读票/读列表实现：超时分支要回部分结果（partial / incomplete）。
  const readMark = (file: string): boolean => {
    const candidates = [path.join(pkgDir, 'deck', 'tools', file), path.join(pkgDir, 'lib', 'deck', 'tools', file)]
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        const source = fs.readFileSync(candidate, 'utf8')
        return source.indexOf('incomplete') >= 0 && source.indexOf('partial') >= 0
      } catch (error) {
        return false
      }
    }
    return false
  }
  return {
    version,
    readCallTimeoutMs,
    valuesPath,
    getHasFix: readMark('issue-get.js'),
    listHasFix: readMark('issue-list.js'),
    problem: null,
  }
}

/** 找实例的插件日志文件（<插件日志目录>/<日期>.log），读出 JSON 行。 */
function readPluginLogs(pluginLogDir: string): { file: string | null; entries: LogEntry[]; problem: string | null } {
  if (!pluginLogDir) return { file: null, entries: [], problem: '实例记录里没有插件日志目录' }
  let names: string[] = []
  try {
    names = fs.readdirSync(pluginLogDir).filter((name: string) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort()
  } catch (error) {
    return { file: null, entries: [], problem: '读不到插件日志目录：' + messageOf(error) }
  }
  if (names.length === 0) return { file: null, entries: [], problem: '插件日志目录里还没有日期命名的日志文件' }
  const file = path.join(pluginLogDir, names[names.length - 1])
  const entries: LogEntry[] = []
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = raw.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed) as Record<string, unknown>
        entries.push({
          event: String(json.event || ''),
          ts: typeof json.ts === 'number' ? json.ts : null,
          fields: asRecord(json.fields) || {},
        })
      } catch (error) {
        continue
      }
    }
  } catch (error) {
    return { file, entries: [], problem: '读不了插件日志文件：' + messageOf(error) }
  }
  return { file, entries, problem: null }
}

function opIdOf(entry: LogEntry): string {
  const raw = entry.fields.opId
  return typeof raw === 'string' ? raw : ''
}

interface ObservationInput {
  readonly checkId: string
  readonly title: string
  readonly ok: boolean
  readonly detail: string
  readonly expected?: string
  readonly actual?: string
  readonly hint?: string
  readonly evidence?: readonly string[]
  readonly status?: 'pass' | 'fail' | 'skip' | 'blocked'
  readonly hard?: boolean
}

function observe(input: ObservationInput): ScenarioObservation {
  return {
    checkId: input.checkId,
    title: input.title,
    ok: input.ok,
    detail: input.detail,
    ...(input.expected === undefined ? {} : { expected: input.expected }),
    ...(input.actual === undefined ? {} : { actual: input.actual }),
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.hard === undefined ? {} : { hard: input.hard }),
  }
}

/** 页面就绪：首开引导弹窗关掉、工作区按钮在、没有密码输入框。与 1830 场景同一套判据。 */
async function preparePage(context: ScenarioContext): Promise<{ page: PageHandle | null; observations: ScenarioObservation[] }> {
  const observations: ScenarioObservation[] = []
  const pageResult = await context.primitives.page()
  if (!pageResult.ok) {
    observations.push(observe({
      checkId: 'page-open',
      title: '页面能为这个实例打开',
      ok: false,
      status: 'blocked',
      detail: '拿不到页面句柄：' + pageResult.error.message,
      expected: '浏览器适配器为运行中的实例打开一个页面',
      actual: pageResult.error.message,
      hint: pageResult.error.hint || '先确认 verify/browser.mjs 与 profile 里的 browser 声明',
    }))
    return { page: null, observations }
  }
  const page = pageResult.value
  const instance = context.instance
  if (instance === null) {
    observations.push(observe({
      checkId: 'instance-alive',
      title: 'launch 步留下了一个活着的实例',
      ok: false,
      status: 'blocked',
      detail: '页面拿到了，但 context.instance 是空的',
      expected: 'launch 步跑完后有一个可用的实例句柄',
      actual: 'context.instance === null',
    }))
    return { page: null, observations }
  }
  const raw = page.page as unknown as RawBrowserPage
  if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
  await sleep(1500)
  let maskCount: number | null = null
  let workspaceButtonText: string | null = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const masks = await page.evaluate<number>(MASK_COUNT_SCRIPT)
    maskCount = masks.ok ? masks.value : null
    if (maskCount !== null && maskCount > 0) {
      if (raw.press !== undefined) await raw.press('Escape')
      if (raw.click !== undefined) await raw.click(CLOSE_BUTTON)
      await sleep(300)
      continue
    }
    const text = await page.text(WORKSPACE_BUTTON)
    if (text.ok && text.value !== null) {
      workspaceButtonText = text.value
      break
    }
    await sleep(250)
  }
  const bodyText = await page.evaluate<string>(BODY_TEXT_SCRIPT)
  const passwordInputs = await page.evaluate<number>(PASSWORD_INPUT_SCRIPT)
  const pageUrl = page.url()
  const bodyLength = bodyText.ok ? bodyText.value.trim().length : -1
  const pageState = {
    url: pageUrl,
    origin: instance.record.originUrl,
    maskCount,
    workspaceButtonText,
    passwordInputs: passwordInputs.ok ? passwordInputs.value : null,
    bodyTextLength: bodyLength,
    bodyTextHead: bodyText.ok ? bodyText.value.trim().slice(0, 200) : null,
  }
  const pageEvidence = await recordEvidence(context, 'page-state.json', pageState, '页面就绪检查的原始读数：遮罩数、工作区按钮、密码输入框、URL 与可见文本开头')
  const pageIsHostUi =
    maskCount === 0 &&
    workspaceButtonText !== null &&
    passwordInputs.ok && passwordInputs.value === 0 &&
    pageUrl.indexOf(instance.record.originUrl) === 0 &&
    bodyLength > 20 &&
    bodyText.ok && bodyText.value.indexOf('登录 DeepSeek 账号') < 0
  observations.push(observe({
    checkId: 'page-ready',
    title: '首开引导弹窗已关掉，页面是宿主工作台界面（不是登录页）',
    ok: pageIsHostUi,
    detail: '遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') + '，密码输入框 ' + String(passwordInputs.ok ? passwordInputs.value : '读不到') + ' 个，可见文本 ' + String(bodyLength) + ' 字',
    expected: '遮罩 0 个、工作区按钮存在、没有密码输入框、URL 在实例源上、可见文本超过 20 字',
    actual: '遮罩=' + String(maskCount) + '，工作区按钮=' + String(workspaceButtonText) + '，密码输入框=' + String(passwordInputs.ok ? passwordInputs.value : '读不到') + '，URL=' + pageUrl,
    evidence: pageEvidence.path === null ? [] : [pageEvidence.path],
  }))
  return { page, observations }
}

export default defineScenario<ScenarioContext>({
  id: 'read-timeout-1831',
  title: '读操作有自己的总时限，到点回部分结果、只说读口径，取消能传到后端',
  description: '在隔离的 web profile 实例里，经宿主代执行通道调用运行中的 deck_issue_get / deck_issue_list，验证 #1831：读调用有 90 秒总时限、明显早于宿主 120 秒；后端挂住时 60 秒内回 status=partial 的部分结果并标 incomplete=timeout；超时文案只说读（可重试、无副作用），不出现写口径「不要直接重放写操作」；日志 gh.exec / gh.timeout 行带 opId。',
  hooks: {
    // 隔离实例的用户主目录是 <实例目录>/userprofile：启动时 USERPROFILE 与 HOME 都被指到这里（见 base 的
    // buildLaunchEnv）。插件唯一的日志开关是 <用户主目录>/.dsh/mattskillsdeck/settings.yaml 的 debug.enabled
    // （#1432）：默认关着的时候 info 级事件（gh.exec 就在这一档）不落盘，本次要按 opId 追出站调用就必须先把它
    // 打开。prepareHome 是宿主进程启动前、隔离主目录已建好之后的那一拍，正好写这份文件，且只改这个隔离实例。
    prepareHome: (_context, info) => {
      const settingsDir = path.join(info.dir, 'userprofile', '.dsh', 'mattskillsdeck')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.writeFileSync(path.join(settingsDir, 'settings.yaml'), 'version: 1\ndebug:\n  enabled: true\n  sampleRate: 1\n', 'utf8')
    },
  },
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例',
    },
    {
      id: 'read-timeout',
      kind: 'custom',
      // 挂住模式要连着两次 60 秒超时，再加页面就绪与收尾，留足余量。
      timeoutMs: 900000,
      title: '从页面调读工具，核对耗时、部分结果、文案口径与 opId',
      run: async (context) => {
        const hangMode = process.env.VERIFY_1831_HANG === '1'
        const slowMode = process.env.VERIFY_1831_SLOW === '1'
        const prepared = await preparePage(context)
        const observations = prepared.observations
        const page = prepared.page
        if (page === null) return observations

        const instance = context.instance!
        const startedAt = Date.now()
        const modeKey = hangMode ? 'hang' : (slowMode ? 'slow' : 'normal')
        const modeName = hangMode
          ? '挂住模式（假 gh 让后端不回话）'
          : (slowMode ? '慢后端模式（只把读列表的 gh 查询放慢，其余照常）' : '正常模式（真 gh 读这个仓库）')
        const modeEvidence = await recordEvidence(context, 'mode.json', { mode: modeKey, startedAt, nodePath: process.env.PATH || '' }, '这次跑的是哪个模式；PATH 里有没有假 gh 目录')
        observations.push(observe({
          checkId: 'mode',
          title: '这次跑的是「' + modeName + '」',
          ok: true,
          status: 'skip',
          detail: 'VERIFY_1831_HANG=' + (hangMode ? '1' : '（未设）') + '，VERIFY_1831_SLOW=' + (slowMode ? '1' : '（未设）'),
          evidence: modeEvidence.path === null ? [] : [modeEvidence.path],
        }))

        // 1) 跑起来的实例里装着的插件带这次修复：中央读时限 90 秒，读票/读列表有 partial 标记。
        const installed = inspectInstalledPlugin(instance.record.home, instance.record.profile)
        const installedEvidence = await recordEvidence(context, 'installed-plugin.json', installed, '运行实例里装着的插件版本、READ_CALL_TIMEOUT_MS、读票/读列表实现里的修复标记')
        observations.push(observe({
          checkId: 'installed-plugin-has-fix',
          title: '跑起来的实例里装着的插件代码带这次修复',
          ok: installed.problem === null &&
            installed.version !== null &&
            installed.readCallTimeoutMs === 90000 &&
            installed.readCallTimeoutMs < HOST_LIMIT_MS &&
            installed.getHasFix &&
            installed.listHasFix,
          status: installed.problem === null ? undefined : 'blocked',
          detail: installed.problem === null
            ? '版本 ' + String(installed.version) + '，READ_CALL_TIMEOUT_MS=' + String(installed.readCallTimeoutMs) + '，issue-get 带修复标记=' + String(installed.getHasFix) + '，issue-list 带修复标记=' + String(installed.listHasFix)
            : installed.problem,
          expected: '实例里插件版本读得到，READ_CALL_TIMEOUT_MS=90000 且小于 120000，读票与读列表实现里都有 incomplete/partial 标记',
          actual: installed.problem === null ? String(installed.version) + ' / ' + String(installed.readCallTimeoutMs) : installed.problem,
          hint: '实例里的插件副本与候选包对不上时，后面的行为断言不能算在候选身上；先查 install 与批次 home',
          evidence: installedEvidence.path === null ? [] : [installedEvidence.path],
        }))

        // 2) 读票：正常模式要快、读口径；挂住模式要 60 秒左右收手、回部分结果。
        const getArgs = hangMode ? { key: HANG_KEY, body: 'full', comments: { first: 200 } } : { key: SELF_KEY, body: 'full', comments: { first: 5 } }
        const getProbe = await runDeckToolTimed(page, 'deck_issue_get', getArgs)
        const getEvidence = await recordEvidence(context, 'issue-get.json', {
          mode: modeKey,
          args: getArgs,
          elapsedMs: getProbe.elapsedMs,
          http: getProbe.http,
          receipt: getProbe.receipt,
          envelopeText: getProbe.envelopeText,
        }, 'deck_issue_get 的原始回执与这次调用的耗时')
        const getReceipt = getProbe.receipt
        const getText = String((getReceipt && getReceipt.text) || '')
        const getData = asRecord(getReceipt && getReceipt.data)
        const getStatus = getReceipt === null ? null : String(getReceipt.status || '')
        const getReason = getReceipt === null ? null : String(getReceipt.reason || '')
        const getWritesWording = getText.indexOf('不要直接重放写操作') >= 0
        if (slowMode) {
          const slowTicket = asRecord(getData === null ? null : getData.ticket)
          const getSlowOk = getProbe.problem === null &&
            getProbe.elapsedMs < HOST_LIMIT_MS &&
            !getWritesWording &&
            (getStatus === 'ok'
              ? (slowTicket !== null && String(slowTicket.key) === SELF_KEY)
              : (getStatus === 'partial' && getData !== null && getData.partial === true && getData.incomplete === 'timeout'))
          observations.push(observe({
            checkId: 'slow-get-within-host-limit',
            title: '读票这条路径不慢时，慢后端模式下读票仍在宿主 120 秒之前读完',
            ok: getSlowOk,
            detail: '耗时 ' + String(getProbe.elapsedMs) + ' 毫秒；status=' + String(getStatus) + '，reason=' + String(getReason) + '，票号=' + String(slowTicket === null ? null : slowTicket.key) + '；回执正文：' + getText.slice(0, 200),
            expected: '耗时 < ' + String(HOST_LIMIT_MS) + ' 毫秒；要么 status=ok 且票号 ' + SELF_KEY + '，要么 status=partial 且 data.partial=true、data.incomplete=timeout；正文不含「不要直接重放写操作」',
            actual: '耗时=' + String(getProbe.elapsedMs) + '，status=' + String(getStatus) + '，reason=' + String(getReason) + '，正文=' + getText.slice(0, 200),
            hint: getProbe.problem !== null ? getProbe.problem : '新假 gh 只慢读列表的分页查询，读票（get.gql + deps.gql 并发）应当照常几秒读完；这里超时就说明连正常读票都被慢环境拖住了',
            evidence: getEvidence.path === null ? [] : [getEvidence.path],
            hard: true,
          }))
        } else if (hangMode) {
          const getHangOk = getProbe.problem === null &&
            getProbe.elapsedMs < HOST_LIMIT_MS &&
            !getWritesWording &&
            (getStatus === 'partial' || getStatus === 'unsupported') &&
            (getText.indexOf('读') >= 0 || getText.indexOf('重调') >= 0 || getText.indexOf('重试') >= 0)
          observations.push(observe({
            checkId: 'hang-get-stays-under-host-limit',
            title: '后端挂住时，读票明显早于宿主 120 秒收手，正文只说读口径',
            ok: getHangOk,
            detail: '耗时 ' + String(getProbe.elapsedMs) + ' 毫秒；status=' + String(getStatus) + '，reason=' + String(getReason) + '；回执正文：' + getText.slice(0, 200),
            expected: '耗时 < ' + String(HOST_LIMIT_MS) + ' 毫秒；status 是 partial 或 unsupported；正文是读口径（含「读/重调/重试」，不含「不要直接重放写操作」）',
            actual: '耗时=' + String(getProbe.elapsedMs) + '，status=' + String(getStatus) + '，reason=' + String(getReason) + '，正文=' + getText.slice(0, 200),
            hint: getProbe.problem !== null ? getProbe.problem : '这一档单条 gh 命令会被房内 30 秒分档上限先掐断（#1799 映射成 backend-threw）；关键是总耗时别靠近 120 秒、文案别读写打架。要验读层的硬截止与取消，看慢后端模式',
            evidence: getEvidence.path === null ? [] : [getEvidence.path],
            hard: true,
          }))
        } else {
          const getBody = asRecord(getData && getData.body)
          const getTicket = asRecord(getData && getData.ticket)
          const getOk = getProbe.problem === null &&
            getProbe.elapsedMs < HEALTHY_LIMIT_MS &&
            getStatus === 'ok' &&
            getBody !== null && getBody.mode === 'full' &&
            getTicket !== null && String(getTicket.key) === SELF_KEY &&
            !getWritesWording
          observations.push(observe({
            checkId: 'healthy-get-under-30s',
            title: '真实网络下读票 body=full 在 30 秒内回来，回的是全文分块',
            ok: getOk,
            detail: '耗时 ' + String(getProbe.elapsedMs) + ' 毫秒；status=' + String(getStatus) + '；data.body.mode=' + String(getBody === null ? null : getBody.mode) + '；票号=' + String(getTicket === null ? null : getTicket.key),
            expected: '耗时 < ' + String(HEALTHY_LIMIT_MS) + ' 毫秒，status=ok，data.body.mode=full，票号 ' + SELF_KEY,
            actual: '耗时=' + String(getProbe.elapsedMs) + '，status=' + String(getStatus) + '，正文=' + getText.slice(0, 160),
            hint: getProbe.problem !== null ? getProbe.problem : '事故现场同一个参数挂了 173 秒；若这里超 30 秒，先看日志里的 gh.exec 耗时',
            evidence: getEvidence.path === null ? [] : [getEvidence.path],
            hard: true,
          }))
        }

        // 3) 读列表：正常模式要快；挂住模式同样要在 120 秒内回部分结果，且不能出现写口径文案。
        // 慢后端模式要读 state=all：这个仓库关着的票有上千张，一趟会翻十几页，串行叠加必然超过 60 秒工具级钳制；
        // 正常/挂住模式仍只读 open，别让真网络下翻上千张把正常场景拖慢。
        const listArgs = slowMode ? { state: 'all', limit: 5 } : { state: 'open', limit: 5 }
        const listProbe = await runDeckToolTimed(page, 'deck_issue_list', listArgs)
        const listEvidence = await recordEvidence(context, 'issue-list.json', {
          mode: modeKey,
          args: listArgs,
          elapsedMs: listProbe.elapsedMs,
          http: listProbe.http,
          receipt: listProbe.receipt,
          envelopeText: listProbe.envelopeText,
        }, 'deck_issue_list 的原始回执与这次调用的耗时')
        const listReceipt = listProbe.receipt
        const listText = String((listReceipt && listReceipt.text) || '')
        const listData = asRecord(listReceipt && listReceipt.data)
        const listStatus = listReceipt === null ? null : String(listReceipt.status || '')
        const listWritesWording = listText.indexOf('不要直接重放写操作') >= 0
        if (slowMode) {
          const listSlowOk = listProbe.problem === null &&
            listProbe.elapsedMs < HOST_LIMIT_MS &&
            listProbe.elapsedMs >= SLOW_MIN_MS &&
            listStatus === 'partial' &&
            listData !== null && listData.partial === true && listData.incomplete === 'timeout' &&
            !listWritesWording &&
            (listText.indexOf('读') >= 0 || listText.indexOf('清单') >= 0)
          observations.push(observe({
            checkId: 'slow-list-hard-deadline-partial',
            title: '读列表的分页查询每条都慢但都成功时，到工具级钳制就收手、回部分结果并只说读口径',
            ok: listSlowOk,
            detail: '耗时 ' + String(listProbe.elapsedMs) + ' 毫秒；status=' + String(listStatus) + '；reason=' + String(listReceipt === null ? null : listReceipt.reason) + '；data.partial=' + String(listData === null ? null : listData.partial) + '，data.incomplete=' + String(listData === null ? null : listData.incomplete) + '；回执正文：' + listText.slice(0, 240),
            expected: '耗时在 ' + String(SLOW_MIN_MS) + '–' + String(HOST_LIMIT_MS) + ' 毫秒之间，status=partial，data.partial=true，data.incomplete=timeout，正文是读口径且不含「不要直接重放写操作」',
            actual: '耗时=' + String(listProbe.elapsedMs) + '，status=' + String(listStatus) + '，正文=' + listText.slice(0, 240),
            hint: listProbe.problem !== null ? listProbe.problem : '一趟 state=all 的读列表要串行翻十几页、每页约 20 秒；这里应等满工具级 60 秒钳制后立刻收手，而不是继续等每一条慢命令（旧实现会一直等到它们全部结束）',
            evidence: listEvidence.path === null ? [] : [listEvidence.path],
            hard: true,
          }))
        } else if (hangMode) {
          const listHangOk = listProbe.problem === null &&
            listProbe.elapsedMs < HOST_LIMIT_MS &&
            !listWritesWording &&
            (listStatus === 'partial' || listStatus === 'unsupported')
          observations.push(observe({
            checkId: 'hang-list-stays-under-host-limit',
            title: '后端挂住时，读列表明显早于宿主 120 秒收手，正文不再读写打架',
            ok: listHangOk,
            detail: '耗时 ' + String(listProbe.elapsedMs) + ' 毫秒；status=' + String(listStatus) + '；回执正文：' + listText.slice(0, 200),
            expected: '耗时 < ' + String(HOST_LIMIT_MS) + ' 毫秒；status 是 partial 或 unsupported；正文不含「不要直接重放写操作」',
            actual: '耗时=' + String(listProbe.elapsedMs) + '，status=' + String(listStatus) + '，正文=' + listText.slice(0, 200),
            hint: listProbe.problem !== null ? listProbe.problem : '读列表超时只能给读口径（可重试、无副作用），写口径那句是这块要消失的矛盾文案',
            evidence: listEvidence.path === null ? [] : [listEvidence.path],
            hard: true,
          }))
        } else {
          const listOk = listProbe.problem === null &&
            listProbe.elapsedMs < HEALTHY_LIMIT_MS &&
            listStatus === 'ok' &&
            listData !== null && Array.isArray(listData.issues) && (listData.issues as unknown[]).length <= 5 &&
            listText.indexOf('ISSUE 列表') >= 0 &&
            !listWritesWording
          observations.push(observe({
            checkId: 'healthy-list-under-30s',
            title: '真实网络下读列表在 30 秒内回来，回的是读口径',
            ok: listOk,
            detail: '耗时 ' + String(listProbe.elapsedMs) + ' 毫秒；status=' + String(listStatus) + '；返回行数=' + String(listData === null || !Array.isArray(listData.issues) ? null : (listData.issues as unknown[]).length),
            expected: '耗时 < ' + String(HEALTHY_LIMIT_MS) + ' 毫秒，status=ok，行数不超过 5，正文开头是「ISSUE 列表」',
            actual: '耗时=' + String(listProbe.elapsedMs) + '，status=' + String(listStatus) + '，正文=' + listText.slice(0, 160),
            hint: listProbe.problem !== null ? listProbe.problem : '读列表也要走读时限；超 30 秒说明总时限没生效',
            evidence: listEvidence.path === null ? [] : [listEvidence.path],
            hard: true,
          }))
        }

        // 4) 日志：按 opId 把「工具这趟操作」和它发出的 gh 调用对上。gh.exec / gh.timeout 是常驻级别；
        //    后台检测与预检自己发的 gh 调用没有工具 op，opId 本来就是空的，所以这里只看工具 op 名下的行。
        //    超时那笔取消是后台落地的，先等它把 cancelled / aborted 行写完再读日志。
        if (slowMode || hangMode) await sleep(2500)
        const logs = readPluginLogs(String(instance.record.pluginLogDir || ''))
        const since = startedAt
        const relevant = logs.entries.filter((entry) => entry.ts === null || entry.ts >= since)
        const toolOpIds = new Set(relevant.filter((entry) => entry.event === 'tool.receipt').map(opIdOf).filter((value) => value.length > 0))
        const ghExec = relevant.filter((entry) => entry.event === 'gh.exec')
        const ghTimeout = relevant.filter((entry) => entry.event === 'gh.timeout')
        const execRun = relevant.filter((entry) => entry.event === 'exec.run')
        const ghExecWithToolOp = ghExec.filter((entry) => toolOpIds.has(opIdOf(entry)))
        const ghTimeoutWithToolOp = ghTimeout.filter((entry) => toolOpIds.has(opIdOf(entry)))
        const cancelledRows = relevant.filter((entry) =>
          (entry.event === 'gh.exec' && entry.fields.kind === 'cancelled') ||
          (entry.event === 'exec.run' && entry.fields.endReason === 'aborted'))
        const cancelledWithToolOp = cancelledRows.filter((entry) => toolOpIds.has(opIdOf(entry)))
        const logEvidence = await recordEvidence(context, 'plugin-log.json', {
          file: logs.file,
          problem: logs.problem,
          since,
          toolOpIds: Array.from(toolOpIds),
          ghExecCount: ghExec.length,
          ghTimeoutCount: ghTimeout.length,
          execRunCount: execRun.length,
          ghExecWithToolOp: ghExecWithToolOp.map((entry) => entry.fields),
          ghTimeoutWithToolOp: ghTimeoutWithToolOp.map((entry) => entry.fields),
          cancelledRows: cancelledRows.map((entry) => Object.assign({ event: entry.event }, entry.fields)),
          backgroundGhExecWithoutOpId: ghExec.filter((entry) => opIdOf(entry).length === 0).map((entry) => entry.fields),
        }, '本次调用期间插件日志里工具 opId 名下的 gh.exec / gh.timeout / exec.run / 取消行')
        const logOk = logs.problem === null &&
          toolOpIds.size > 0 &&
          ghExecWithToolOp.length > 0 &&
          (hangMode ? ghTimeoutWithToolOp.length > 0 : true) &&
          (slowMode ? cancelledWithToolOp.length > 0 : true)
        observations.push(observe({
          checkId: 'log-opid-traceable',
          title: '日志能按 opId 找到这次出站调用（含超时与取消）',
          ok: logOk,
          status: logs.problem === null ? undefined : 'blocked',
          detail: logs.problem === null
            ? '日志文件 ' + String(logs.file) + '；工具 opId ' + String(toolOpIds.size) + ' 个（' + Array.from(toolOpIds).slice(0, 3).join(', ') + '）；其名下 gh.exec ' + String(ghExecWithToolOp.length) + ' 行、gh.timeout ' + String(ghTimeoutWithToolOp.length) + ' 行、取消行 ' + String(cancelledWithToolOp.length) + ' 行；另有 ' + String(ghExec.length - ghExecWithToolOp.length) + ' 行后台检测调用（opId 为空属正常）'
            : logs.problem,
          expected: '日志里至少有本次工具调用的 tool.receipt opId；其名下至少有 gh.exec 行；挂住模式下其名下至少有一行 gh.timeout；慢后端模式下其名下至少有一行取消证据（gh.exec kind=cancelled 或 exec.run endReason=aborted）',
          actual: logs.problem === null ? '工具 opId=' + String(toolOpIds.size) + '，工具 op 名下 gh.exec=' + String(ghExecWithToolOp.length) + '，gh.timeout=' + String(ghTimeoutWithToolOp.length) + '，取消行=' + String(cancelledWithToolOp.length) : logs.problem,
          hint: 'opId 由宿主为每趟 deck 工具调用生成（<毫秒时间戳>-<序号>），房间与宿主出站执行都原样带上；缺它就没法把一次工具的起止、超时与取消串起来',
          evidence: logEvidence.path === null ? [] : [logEvidence.path],
        }))

        // 5) 硬指标：两次读都没有超过宿主 120 秒（本票要消灭的就是 173 秒这种挂死）。
        const maxElapsed = Math.max(getProbe.elapsedMs, listProbe.elapsedMs)
        observations.push(observe({
          checkId: 'reads-stay-under-host-limit',
          title: '这次跑里最慢的一次读也明显早于宿主 120 秒上限',
          ok: maxElapsed < HOST_LIMIT_MS,
          detail: '读票 ' + String(getProbe.elapsedMs) + ' 毫秒，读列表 ' + String(listProbe.elapsedMs) + ' 毫秒，最慢 ' + String(maxElapsed) + ' 毫秒',
          expected: '最慢的一次读 < ' + String(HOST_LIMIT_MS) + ' 毫秒',
          actual: String(maxElapsed) + ' 毫秒',
          hint: '超过 120 秒就说明宿主会先判死整步，插件侧的硬截止没有生效',
          hard: true,
        }))

        return observations
      },
    },
    {
      id: 'stop',
      kind: 'stop',
      title: '停掉实例',
    },
  ],
})
export {};
