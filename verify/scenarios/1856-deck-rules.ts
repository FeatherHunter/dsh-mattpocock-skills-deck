// verify/scenarios/1856-deck-rules.ts —— 真机验证 #1856：deck 工具的共用用法说明与会话在跑标记。
//
// 验证路线：用 base 的真机验证能力开一个隔离的 web profile 实例，把候选包装进去，然后从页面里走宿主
// 代执行通道（POST /api/dsws，method = deckExec）直接调运行中宿主里的 deck 工具。验的是「装进 profile
// 之后真实运行的插件」，不是门禁用桩后端拼出来的那套。
//
// 这一趟要回答四件事：
//   1. 实例里跑的是不是候选代码：版本号对得上，且新增的 running-sessions.js 真在里面。
//   2. B4：deck_context 回执里的共用用法说明真带两条规矩（原话每句都值得记、原话是最高要求、冲突以原话
//      为准；要看在办与撞车就调 deck_work_route、running:true 的含义）。第二条观测直接读实例里装着的那份
//      context.js，证明回执里的字确实来自装进去的代码，而不是宿主别处拼的。
//   3. B3 负向：在办表在「没有任何会话在跑」时不能凭空标 running、notes 不能谎称有人在跑；先写一张票
//      再读，组要照常出现、但仍不带 running。
//   4. B3 正向：装进实例里的 running-sessions.js 能对「宿主现报 running」的 agent 算出标签（直接调用装进
//      实例的那份代码）；而宿主里真有一轮开着的会话这一刻造不出来，因为隔离实例按 verify/profile.ts 的
//      model:false 不接模型——这一条在批次结果里标「未测」，不拿负向观察顶替。
//
// 手动跑法（工作根与批次 home 换成你自己的）：
//   $env:DSH_HOME='<批次 home>'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js `
//     run verify/scenarios/1856-deck-rules.ts --profile web --work-root <工作根> --json --collect-all

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks, seededWorkspacePath } from '../hooks.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
/** 代执行通道里报的会话身份：只作参数，不产生活 agent（见 host-delegate 的 execLike）。 */
const PROBE_SESSION = 'verify-1856-deck-rules'
/** 共用用法说明里必须出现的四条规矩（B4 的判据）。 */
const HOWTO_MUST_HAVE = [
  '用户本人打的话都值得记进那张票的原话区',
  '原话是这张票的最高要求',
  '判不清就告诉用户有明显冲突',
  'running:true',
  'deck_work_route',
]
/** 在办表说明里必须出现的半句（running 的读法）。 */
const WORK_ROUTE_MUST_HAVE = '组上带 running:true'

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
  readonly receipt: HostReceipt | null
  readonly problem: string | null
}

interface RpcProbe {
  readonly status: number
  readonly body: unknown
  readonly text: string
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

async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<string[]> {
  const saved = await context.evidence.recordJson(name, value, { note })
  return saved.ok ? [saved.value.path] : []
}

function notesOf(receipt: HostReceipt | null): string {
  if (receipt === null || !Array.isArray(receipt.notes)) return ''
  return receipt.notes.map((item) => (typeof item === 'string' ? item : String((asRecord(item) || {}).text || ''))).join('\n')
}

/** 页面里走宿主代执行通道调 deck 工具；evaluate 只收字符串，所以整段写成自调用表达式。 */
function deckExecScript(tool: string, args: Record<string, unknown>, sessionId: string, cwd: string): string {
  const call = { tool, args, session: { cwd, sessionId } }
  const body = {
    type: 'client-request',
    rpcId: 'verify-1856-' + Math.random().toString(36).slice(2, 12),
    payload: { method: 'deckExec', payload: call },
  }
  return [
    '(async function () {',
    '  var body = ' + JSON.stringify(body) + ';',
    '  var response = await fetch("/api/dsws", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { http: response.status, envelopeText: text.slice(0, 4000), envelope: parsed };',
    '})()',
  ].join('\n')
}

/** 客户端 RPC：POST /api/<method>，body 是 client-request 信封（与 ui.ts 同一套协议）。 */
function rpcScript(method: string, argsExpression: string): string {
  return [
    '(async function () {',
    '  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());',
    '  var body = { type: "client-request", rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch("/api/" + ' + JSON.stringify(method) + ', {',
    '    method: "POST",',
    '    headers: { "content-type": "application/json" },',
    '    body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 2000) };',
    '})()',
  ].join('\n')
}

/** 宿主回包 { type, rpcId, result: { ok, value } }；也兼容把回执摊在最外层的老形状。 */
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

async function runDeckTool(page: PageHandle, tool: string, args: Record<string, unknown>, workspacePath: string): Promise<ToolProbe> {
  const probe = await page.evaluate<{ http: number; envelopeText: string; envelope: unknown }>(
    deckExecScript(tool, args, PROBE_SESSION, workspacePath),
  )
  if (!probe.ok) {
    return { http: 0, envelopeText: '', receipt: null, problem: '页面里发不出这次调用：' + probe.error.message }
  }
  const receipt = pickReceipt(probe.value.envelope)
  return {
    http: probe.value.http,
    envelopeText: probe.value.envelopeText,
    receipt,
    problem: receipt === null ? '宿主回包里没有工具回执（HTTP ' + String(probe.value.http) + '）：' + probe.value.envelopeText.slice(0, 300) : null,
  }
}

/** RPC 信封的 result.value；失败原因优先取信封里的 error.message。 */
function rpcValue(probe: RpcProbe): Record<string, unknown> | null {
  const result = asRecord(asRecord(probe.body)?.result)
  return asRecord(result?.value)
}

function rpcProblem(probe: RpcProbe): string {
  const error = asRecord(asRecord(probe.body)?.error)
  const message = error?.message
  return typeof message === 'string' && message.length > 0 ? message : probe.text.slice(0, 300)
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) return null
  const value = record[key]
  return typeof value === 'string' ? value : null
}

/** 在实例里装着的插件包里找第一个存在的相对路径（构建产物可能是 lib/ 前缀，也可能没有）。 */
function installedFile(pkgDir: string, relatives: string[]): string | null {
  for (const relative of relatives) {
    const candidate = path.join(pkgDir, relative)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readTextIfExists(file: string | null): string {
  if (file === null) return ''
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    return ''
  }
}

/** 页面就绪：首开引导弹窗关掉、工作区按钮在、没有密码输入框（与 1830/1831 同一套判据）。 */
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
  const bodyLength = bodyText.ok ? bodyText.value.trim().length : -1
  const pageState = {
    url: page.url(),
    maskCount,
    workspaceButtonText,
    passwordInputs: passwordInputs.ok ? passwordInputs.value : null,
    bodyTextLength: bodyLength,
  }
  const evidence = await recordEvidence(context, 'page-state.json', pageState, '页面就绪检查的原始读数：遮罩数、工作区按钮、密码输入框、URL 与可见文本长度')
  const ready = maskCount === 0 && workspaceButtonText !== null && passwordInputs.ok && passwordInputs.value === 0 && bodyLength > 20
  observations.push(observe({
    checkId: 'page-ready',
    title: '首开引导弹窗已关掉，页面是宿主工作台界面',
    ok: ready,
    detail: '遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') + '，密码输入框 ' + String(passwordInputs.ok ? passwordInputs.value : '读不到') + ' 个，可见文本 ' + String(bodyLength) + ' 字',
    expected: '遮罩 0 个、工作区按钮存在、没有密码输入框、可见文本超过 20 字',
    actual: JSON.stringify(pageState),
    hint: ready ? undefined : '页面没就绪时后面的调用会读到宿主自己的错误页，先看实例日志',
    evidence,
  }))
  return { page: ready ? page : null, observations }
}

export default defineScenario<ScenarioContext>({
  id: 'deck-rules-1856',
  title: '共用用法说明带原话区规矩，在办表不谎报 running',
  description: '在隔离的 web profile 实例里经宿主代执行通道调用运行中的 deck_context / deck_work_route：验证 #1856 合入的共用用法说明两条规矩（原话每句都值得记、原话是最高要求、冲突以原话为准；在办与撞车查 deck_work_route、running:true 含义）真的装进了候选包；再验证在办表在没有会话在跑时不标 running、notes 不谎称有人在跑，写票后组照常出现但仍不标 running；并直接调用实例里那份 running-sessions.js 验证「宿主现报 running」能算出标签。宿主里真有一轮开着的会话这一条需要模型回合，本批次标未测。',
  hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例，并种下本地 markdown 工作区',
    },
    {
      id: 'deck-rules',
      kind: 'custom',
      timeoutMs: 600000,
      title: '从页面调 deck_context / deck_work_route，核对共用说明与 running 标记',
      run: async (context) => {
        const prepared = await preparePage(context)
        const observations = prepared.observations
        const page = prepared.page
        if (page === null) return observations

        const instance = context.instance!
        const pkgDir = path.join(instance.record.home, 'profiles', instance.record.profile, 'node_modules', 'dsh-mattpocock-skills-deck')
        const instanceDir = instance.record.dir === undefined ? '' : instance.record.dir
        const workspacePath = instanceDir === '' ? '' : seededWorkspacePath(instanceDir)

        // 1) 跑起来的实例里装着的插件是不是候选：版本对得上，且新增的 running-sessions.js 真在里面。
        const expectedVersion = (() => {
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
            return typeof parsed.version === 'string' ? parsed.version : null
          } catch (error) {
            return null
          }
        })()
        const installedVersion = (() => {
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>
            return typeof parsed.version === 'string' ? parsed.version : null
          } catch (error) {
            return null
          }
        })()
        const runningSessionsFile = installedFile(pkgDir, ['lib/deck/shell/running-sessions.js', 'deck/shell/running-sessions.js'])
        const contextFile = installedFile(pkgDir, ['lib/deck/tools/context.js', 'deck/tools/context.js'])
        const workRouteFile = installedFile(pkgDir, ['lib/deck/tools/work-route.js', 'deck/tools/work-route.js'])
        const contextSource = readTextIfExists(contextFile)
        const workRouteSource = readTextIfExists(workRouteFile)
        const installedEvidence = await recordEvidence(context, 'installed-plugin.json', {
          pkgDir,
          expectedVersion,
          installedVersion,
          runningSessionsFile,
          contextFile,
          workRouteFile,
          contextBytes: contextSource.length,
          workRouteBytes: workRouteSource.length,
        }, '实例里装着的插件版本与#1856 相关的几个产物文件')
        const installedOk = expectedVersion !== null && installedVersion === expectedVersion && runningSessionsFile !== null && contextFile !== null
        observations.push(observe({
          checkId: 'installed-plugin-is-candidate',
          title: '跑起来的实例里装着的插件就是候选版本，且带 #1856 新增的在跑筛法',
          ok: installedOk,
          status: installedOk ? undefined : 'blocked',
          detail: '仓库版本 ' + String(expectedVersion) + '，实例版本 ' + String(installedVersion) + '，running-sessions.js=' + (runningSessionsFile === null ? '没找到' : '在') + '，context.js=' + (contextFile === null ? '没找到' : '在'),
          expected: '实例里插件版本等于仓库 package.json 的版本，且 lib/deck/shell/running-sessions.js 与 lib/deck/tools/context.js 都在',
          actual: String(installedVersion) + ' / ' + String(runningSessionsFile),
          hint: '实例里的插件副本与候选包对不上时，后面的行为断言不能算在候选身上；先查 install 与批次 home',
          evidence: installedEvidence,
        }))

        // 2) B4：deck_context 的共用用法说明带两条规矩；独立读装在实例里的 context.js 对上同样的字。
        const contextProbe = await runDeckTool(page, 'deck_context', {}, workspacePath)
        const contextReceipt = contextProbe.receipt
        const contextData = asRecord(contextReceipt === null ? null : contextReceipt.data)
        const howto = contextData !== null && typeof contextData.howto === 'string' ? contextData.howto : ''
        const missingHowto = HOWTO_MUST_HAVE.filter((needle) => howto.indexOf(needle) < 0)
        const contextEvidence = await recordEvidence(context, 'deck-context.json', {
          args: {},
          http: contextProbe.http,
          receipt: contextReceipt,
          envelopeText: contextProbe.envelopeText,
          howtoLength: howto.length,
          missingHowto,
        }, 'deck_context 的原始回执与共用用法说明里缺了哪些规矩')
        const sourceMissing = HOWTO_MUST_HAVE.filter((needle) => contextSource.indexOf(needle) < 0)
        const sourceHasRules = contextSource !== '' && sourceMissing.length === 0
        observations.push(observe({
          checkId: 'howto-carries-original-words-rules',
          title: '共用用法说明真的带原话区两条规矩（原话每句都值得记、原话是最高要求、冲突以原话为准）',
          ok: contextProbe.problem === null && contextReceipt !== null && String(contextReceipt.status) === 'ok' && missingHowto.length === 0,
          status: contextProbe.problem === null ? undefined : 'blocked',
          detail: '回执 status=' + String(contextReceipt === null ? null : contextReceipt.status) + '，howto ' + String(howto.length) + ' 字，缺 ' + (missingHowto.length === 0 ? '无' : '「' + missingHowto.join('」「') + '」'),
          expected: 'deck_context 回 ok，data.howto 含「' + HOWTO_MUST_HAVE.join('」「') + '」',
          actual: missingHowto.length === 0 ? '全部命中' : '缺「' + missingHowto.join('」「') + '」',
          hint: contextProbe.problem === null ? '说明候选包里的 BASE_HOWTO 没带上这次合入的两段' : contextProbe.problem,
          evidence: contextEvidence,
        }))
        observations.push(observe({
          checkId: 'howto-in-installed-code',
          title: '回执里的规矩确实来自装在实例里的 context.js（第二条独立观测）',
          ok: sourceHasRules,
          status: contextSource === '' ? 'blocked' : undefined,
          detail: 'context.js ' + String(contextSource.length) + ' 字，缺 ' + (sourceMissing.length === 0 ? '无' : '「' + sourceMissing.join('」「') + '」'),
          expected: '实例里的 context.js 源码含同样的几条规矩',
          actual: sourceMissing.length === 0 ? '全部命中' : '缺「' + sourceMissing.join('」「') + '」',
          hint: '两条观测对上，才能说回执里的字是装进去的代码给的；只对上一条时要查构建产物是不是旧的',
        }))

        // 3) B3 负向之一：一个写记录都没有时，在办表要老老实实回空，不能标 running、不能谎称有人在跑。
        const emptyRouteProbe = await runDeckTool(page, 'deck_work_route', {}, workspacePath)
        const emptyRoute = emptyRouteProbe.receipt
        const emptyRouteData = asRecord(emptyRoute === null ? null : emptyRoute.data)
        const emptyGroups = emptyRouteData !== null && Array.isArray(emptyRouteData.groups) ? (emptyRouteData.groups as unknown[]) : null
        const emptyNotes = notesOf(emptyRoute)
        const emptyText = String(emptyRoute === null ? '' : emptyRoute.text || '')
        const emptyRouteEvidence = await recordEvidence(context, 'work-route-empty.json', {
          http: emptyRouteProbe.http,
          receipt: emptyRoute,
          envelopeText: emptyRouteProbe.envelopeText,
        }, '一个写记录都没有时 deck_work_route 的原始回执')
        observations.push(observe({
          checkId: 'work-route-empty-has-no-running',
          title: '没有任何写记录时，在办表回空、不标 running、不谎称有人在跑',
          ok: emptyRouteProbe.problem === null && emptyRoute !== null && String(emptyRoute.status) === 'ok' && emptyGroups !== null && emptyGroups.length === 0 && emptyNotes.indexOf('正在跑一轮') < 0,
          status: emptyRouteProbe.problem === null ? undefined : 'blocked',
          detail: 'status=' + String(emptyRoute === null ? null : emptyRoute.status) + '，groups=' + String(emptyGroups === null ? null : emptyGroups.length) + '，notes=' + (emptyNotes === '' ? '（空）' : emptyNotes.slice(0, 200)) + '，正文=' + emptyText.slice(0, 160),
          expected: 'status=ok、data.groups 是空数组、notes 不含「正在跑一轮」',
          actual: emptyGroups === null ? 'data.groups 读不到' : 'groups=' + String(emptyGroups.length) + '，notes=' + emptyNotes.slice(0, 160),
          hint: emptyRouteProbe.problem === null ? '实例是全新的，本工作区不该有在办记录；有记录说明工作区键串了' : emptyRouteProbe.problem,
          evidence: emptyRouteEvidence,
          hard: true,
        }))

        // 4) B3 负向之二：在本地 markdown 工作区里建一张票并上报，组要照常出现；但那个会话不是活 agent，
        //    所以仍不能带 running。
        const createProbe = await runDeckTool(page, 'deck_issue_create', {
          kind: 'issue',
          title: '真机验证 #1856 的占位票',
          body: '这张票只用来在办表里留下一行写记录，验证完随实例一起清掉。',
        }, workspacePath)
        const createReceipt = createProbe.receipt
        const createData = asRecord(createReceipt === null ? null : createReceipt.data)
        const createTicket = asRecord(createData === null ? null : createData.ticket)
        const ticketKey = createTicket === null ? null : stringField(createTicket, 'key')
        const createEvidence = await recordEvidence(context, 'create-ticket.json', {
          http: createProbe.http,
          receipt: createReceipt,
          envelopeText: createProbe.envelopeText,
        }, '在隔离实例的本地 markdown 工作区里建占位票的原始回执')
        observations.push(observe({
          checkId: 'seed-ticket-created',
          title: '在隔离实例的本地工作区里建得出一张占位票（后面读在办表要用）',
          ok: createProbe.problem === null && createReceipt !== null && String(createReceipt.status) === 'ok' && ticketKey !== null,
          status: createProbe.problem === null ? undefined : 'blocked',
          detail: 'status=' + String(createReceipt === null ? null : createReceipt.status) + '，票号=' + String(ticketKey) + '，正文=' + String(createReceipt === null ? '' : createReceipt.text || '').slice(0, 160),
          expected: 'status=ok 且回执里带票号',
          actual: ticketKey === null ? String(createReceipt === null ? createProbe.problem : createReceipt.text || '').slice(0, 200) : '票号 ' + ticketKey,
          hint: createProbe.problem === null ? '本地 markdown 工作区由 verify/hooks.ts 种下；建不出票说明实例里的后端选择没落到 markdown' : createProbe.problem,
          evidence: createEvidence,
        }))

        let routeAfterCreateProbe: ToolProbe | null = null
        let routeAfterCreateData: Record<string, unknown> | null = null
        let routeAfterCreateGroups: unknown[] | null = null
        if (ticketKey !== null) {
          await runDeckTool(page, 'deck_issue_report', { key: ticketKey, note: '真机验证 #1856：留一条写记录给在办表。' }, workspacePath)
          routeAfterCreateProbe = await runDeckTool(page, 'deck_work_route', {}, workspacePath)
          routeAfterCreateData = asRecord(routeAfterCreateProbe.receipt === null ? null : routeAfterCreateProbe.receipt.data)
          routeAfterCreateGroups = routeAfterCreateData !== null && Array.isArray(routeAfterCreateData.groups) ? (routeAfterCreateData.groups as unknown[]) : null
        }
        const routeReceipt = routeAfterCreateProbe === null ? null : routeAfterCreateProbe.receipt
        const routeNotes = notesOf(routeReceipt)
        const groups = routeAfterCreateGroups === null ? [] : routeAfterCreateGroups
        const groupRows = groups.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
        // 本地 markdown 后端把票号按数字存（建票回执写「01」，在办表存档里是「1」），比对前统一去掉前导零与 #。
        const ticketKeyDigits = (value: string | null): string => String(value === null ? '' : value).replace(/^#/, '').replace(/^0+(?=\d)/, '')
        const groupWithTicket = groupRows.find((group) => {
          const items = Array.isArray(group.items) ? (group.items as unknown[]) : []
          return items.some((row) => {
            const record = asRecord(row)
            return record !== null && ticketKeyDigits(stringField(record, 'ticketKey')) === ticketKeyDigits(ticketKey)
          })
        })
        const groupLabels = groupRows.map((group) => String(group.sessionLabel || ''))
        const anyRunningKey = groupRows.some((group) => Object.prototype.hasOwnProperty.call(group, 'running'))
        const routeEvidence = await recordEvidence(context, 'work-route-after-write.json', {
          http: routeAfterCreateProbe === null ? 0 : routeAfterCreateProbe.http,
          receipt: routeReceipt,
          groups: groupRows,
        }, '写票之后 deck_work_route 的原始回执与会话组')
        observations.push(observe({
          checkId: 'work-route-shows-group-without-running',
          title: '写票之后在办表列出这个会话组，但它不是在跑的会话、不标 running',
          ok: routeAfterCreateProbe !== null && routeAfterCreateProbe.problem === null && routeReceipt !== null && String(routeReceipt.status) === 'ok' && groupWithTicket !== undefined && !Object.prototype.hasOwnProperty.call(groupWithTicket, 'running') && !anyRunningKey && routeNotes.indexOf('正在跑一轮') < 0,
          status: routeAfterCreateProbe === null ? 'blocked' : (routeAfterCreateProbe.problem === null ? undefined : 'blocked'),
          detail: 'status=' + String(routeReceipt === null ? null : routeReceipt.status) + '，组=' + JSON.stringify(groupLabels) + '，含占位票的组=' + (groupWithTicket === undefined ? '没有' : String(groupWithTicket.sessionLabel)) + '，任何组带 running 键=' + String(anyRunningKey) + '，notes=' + (routeNotes === '' ? '（空）' : routeNotes.slice(0, 200)),
          expected: 'status=ok；含票 ' + String(ticketKey) + ' 的组存在；该组与其他组都不带 running 键；notes 不含「正在跑一轮」',
          actual: groupRows.length === 0 ? '一个组都没有' : JSON.stringify(groupRows.map((group) => ({ label: group.sessionLabel, running: Object.prototype.hasOwnProperty.call(group, 'running') }))),
          hint: 'deckExec 报的会话身份只是参数，不会让任何会话真的跑起来；这里若出现 running:true，说明筛法把「有记录」当成了「在跑」',
          evidence: routeEvidence,
          hard: true,
        }))

        // 5) B3 正向（装进实例的那份代码）：直接调 running-sessions.js，喂一个宿主现报 running 的假注册表，
        //    验证它只认 running、跳过自己与子代理、按同根折算标签。这不是宿主集成，真宿主里的 running 会话
        //    需要模型回合，见最后一条 blocked。
        if (runningSessionsFile === null) {
          observations.push(observe({
            checkId: 'installed-filter-marks-running',
            title: '装进实例的 running-sessions.js 能给「宿主现报 running」的会话算出标签',
            ok: false,
            status: 'blocked',
            detail: '实例里找不到 running-sessions.js，没法直接调用',
            expected: '实例里 lib/deck/shell/running-sessions.js 存在',
            actual: '文件缺失',
            hint: '先看 installed-plugin-is-candidate 那条',
          }))
        } else {
          const filterRun = await (async (): Promise<{ labels: string[]; problem: string | null }> => {
            try {
              const mod = await import(pathToFileURL(runningSessionsFile).href) as { runningSessionLabels?: (input: unknown) => Promise<string[]> }
              if (typeof mod.runningSessionLabels !== 'function') return { labels: [], problem: '装进实例的模块没导出 runningSessionLabels' }
              const sessions: Record<string, unknown> = {
                live: { header: { cwd: workspacePath + '/sub', origin: 'user' } },
                other: { header: { cwd: path.resolve(workspacePath, '..', 'elsewhere'), origin: 'user' } },
                self: { header: { cwd: workspacePath, origin: 'user' } },
                sub: { header: { cwd: workspacePath, origin: 'subagent' } },
                idle: { header: { cwd: workspacePath, origin: 'user' } },
              }
              const labels = await mod.runningSessionLabels({
                services: {
                  agents: {
                    list: () => [
                      { id: 'live', status: 'running' },
                      { id: 'idle', status: 'idle' },
                      { id: 'self', status: 'running' },
                      { id: 'sub', status: 'running' },
                      { id: 'other', status: 'running' },
                    ],
                  },
                  sessions: { get: (id: string) => sessions[id] || null },
                },
                deps: {
                  workspaceKeyOf: (root: unknown) => String(root),
                  canonicalKey: (cwd: string) => path.resolve(cwd, '..'),
                  sessionTitleSnapshotOf: (id: string) => '标题-' + id,
                  labelOf: (title: string, id: string) => (title || '会话 ' + id.slice(0, 6)),
                  canonicalTimeoutMs: 2000,
                },
                selfSessionId: 'self',
                workspaceKey: workspacePath,
                cwd: workspacePath,
              })
              return { labels, problem: null }
            } catch (error) {
              return { labels: [], problem: '调用实例里的 running-sessions.js 出错：' + messageOf(error) }
            }
          })()
          const filterEvidence = await recordEvidence(context, 'installed-filter-probe.json', {
            file: runningSessionsFile,
            labels: filterRun.labels,
            problem: filterRun.problem,
          }, '直接调用实例里那份 running-sessions.js：喂宿主现报 running 的假注册表，看它算出哪些标签')
          observations.push(observe({
            checkId: 'installed-filter-marks-running',
            title: '装进实例的 running-sessions.js 只给「宿主现报 running、同工作区、不是自己、不是子代理」的会话标签',
            ok: filterRun.problem === null && filterRun.labels.length === 1 && filterRun.labels[0] === '标题-live',
            status: filterRun.problem === null ? undefined : 'blocked',
            detail: filterRun.problem === null ? '算出标签 ' + JSON.stringify(filterRun.labels) : filterRun.problem,
            expected: '只算出 ["标题-live"]：idle 没在跑、self 是自己、sub 是子代理、other 不在这个工作区',
            actual: filterRun.problem === null ? JSON.stringify(filterRun.labels) : filterRun.problem,
            hint: filterRun.problem === null ? '这条只证明装进实例的那份筛法逻辑对；宿主里真有 running 会话的整链还差一条记录，见下一条' : filterRun.problem,
            evidence: filterEvidence,
          }))
        }

        // 6) 宿主里真有一轮开着的会话：隔离实例 model:false，造不出模型回合，如实标未测。
        observations.push(observe({
          checkId: 'host-live-running-session',
          title: '宿主里真有一轮开着的会话时，它的组带 running:true',
          ok: false,
          status: 'blocked',
          detail: '隔离验证实例按 verify/profile.ts 的 model:false 不接模型，这一轮造不出「真有一轮开着」的会话；不能拿负向观察顶替',
          expected: '另起一批接上模型的实例，发一条真要模型回合的消息，在回执里读到该组 running:true 与 notes 的在跑句',
          actual: '本批次未测',
          hint: '要验这一条需要模型凭证与一轮真实对话；本批次只用直接调用装进实例的筛法证明正向逻辑',
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
export {}
