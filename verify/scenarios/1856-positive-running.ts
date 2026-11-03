/**
 * 场景 1856-02：真有一轮开着时，在办表给那个会话的组标 running:true。
 *
 * 1856-01（verify/scenarios/1856-deck-rules.ts）在 model:false 的隔离实例里只能验负向：
 * 没有会话在跑时不标 running、装进实例的筛法只认宿主现报 running 的会话。
 * 这一条补正向：在同一个隔离实例里，用客户端自己的 RPC 建一条真会话（session/create），
 * 给它发一条真要模型回合的 prompt（session/prompt），趁那一轮开着的时候调 deck_work_route，
 * 看含自己占位票的会话组是不是带 running:true、notes 是不是说「正在跑一轮」；
 * 取消这一轮之后，同一个组上的 running 要消失。
 *
 * 跑法（在仓库根）：
 *   node --import ./scripts/ts-hook.mts <baseCli> run verify/scenarios/1856-positive-running.ts \
 *     --profile web --work-root <工作根> --json --collect-all
 * 前置：批次 home 里已经配好可用的模型（这一批用真实 home 拷来的 deepseek-account/deepseek-flash
 * 与凭证）；模型不可用或回合在观察窗口之外就如实记 blocked，不拿负向观察顶替。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks, seededWorkspacePath } from '../hooks.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

/** deck_exec 的会话身份只是参数；这一条用来给在办表留写记录、读在办表。 */
const PROBE_SESSION = 'verify-1856-positive-probe'
/** 观察窗口：模型回合可能只有几秒，轮询要密；上限给足，避免误判成「没在跑」。 */
const POLL_INTERVAL_MS = 150
const RUNNING_WINDOW_MS = 90000
/** 取消之后等 running 消失的窗口。 */
const CLEAR_WINDOW_MS = 30000

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
    rpcId: 'verify-1856-running-' + Math.random().toString(36).slice(2, 12),
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

async function runDeckTool(
  page: PageHandle,
  tool: string,
  args: Record<string, unknown>,
  workspacePath: string,
  sessionId: string = PROBE_SESSION,
): Promise<ToolProbe> {
  const probe = await page.evaluate<{ http: number; envelopeText: string; envelope: unknown }>(
    deckExecScript(tool, args, sessionId, workspacePath),
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

function numField(record: Record<string, unknown> | null, key: string): number | null {
  if (record === null) return null
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 本地 markdown 后端把票号按数字存（建票回执写「01」，在办表存档里是「1」），比对前统一去前导零与 #。 */
function ticketKeyDigits(value: string | null): string {
  return String(value === null ? '' : value).replace(/^#/, '').replace(/^0+(?=\d)/, '')
}

/** 在办表回执 → 组行与 notes；读不到时返回空数组，让断言自己报「读不到」。 */
function workRouteRows(receipt: HostReceipt | null): { groups: Record<string, unknown>[]; notes: string } {
  const data = asRecord(receipt === null ? null : receipt.data)
  const raw = data !== null && Array.isArray(data.groups) ? (data.groups as unknown[]) : []
  const groups = raw.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
  return { groups, notes: notesOf(receipt) }
}

/** 组里是否含指定票（ticketKey 归一后比较）。 */
function groupHasTicket(group: Record<string, unknown>, ticketKey: string | null): boolean {
  const items = Array.isArray(group.items) ? (group.items as unknown[]) : []
  return items.some((row) => {
    const record = asRecord(row)
    return record !== null && ticketKeyDigits(stringField(record, 'ticketKey')) === ticketKeyDigits(ticketKey)
  })
}

/** 挑出「含这张票、并带 running:true」的组。 */
function runningGroupForTicket(groups: readonly Record<string, unknown>[], ticketKey: string | null): Record<string, unknown> | null {
  for (const group of groups) {
    if (group.running !== true) continue
    if (groupHasTicket(group, ticketKey)) return group
  }
  return null
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

/** 一次在办表读数：回执、含票的组、running 组、notes。 */
interface RouteTick {
  readonly at: number
  readonly elapsedMs: number
  readonly ok: boolean
  readonly problem: string | null
  readonly receipt: HostReceipt | null
  readonly groups: readonly Record<string, unknown>[]
  readonly notes: string
  readonly hasRunningKey: boolean
}

async function readWorkRoute(
  page: PageHandle,
  workspacePath: string,
  ticketKey: string | null,
  startedAt: number,
): Promise<RouteTick> {
  const probe = await runDeckTool(page, 'deck_work_route', {}, workspacePath)
  const rows = workRouteRows(probe.receipt)
  return {
    at: Date.now(),
    elapsedMs: Date.now() - startedAt,
    ok: probe.problem === null && probe.receipt !== null && String(probe.receipt.status) === 'ok',
    problem: probe.problem,
    receipt: probe.receipt,
    groups: rows.groups,
    notes: rows.notes,
    hasRunningKey: rows.groups.some((group) => Object.prototype.hasOwnProperty.call(group, 'running')),
  }
}

export default defineScenario({
  id: 'deck-running-1856',
  title: '真有一轮开着时，在办表给那个会话的组标 running:true',
  description: '在装了候选包的隔离 web 实例里，用客户端 RPC 建一条真会话并给它发一条真要模型回合的 prompt；趁那一轮开着时反复调 deck_work_route，核对含自己占位票的会话组带 running:true、notes 说正在跑一轮、别的组不标；取消这一轮之后再核对 running 消失。这一条只覆盖「宿主真有活回合」这一面：实例必须能跑模型回合，模型不可用则如实记 blocked。',
  hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例，并种下本地 markdown 工作区',
    },
    {
      id: 'positive-running',
      kind: 'custom',
      timeoutMs: 600000,
      title: '建真会话、发一条模型 prompt，趁回合开着看在办表的 running 标记',
      run: async (context) => {
        const prepared = await preparePage(context)
        const observations = prepared.observations
        const page = prepared.page
        if (page === null) return observations

        const instance = context.instance!
        const instanceDir = instance.record.dir === undefined ? '' : instance.record.dir
        const workspacePath = instanceDir === '' ? '' : seededWorkspacePath(instanceDir)

        // 1) workspace/create：让运行中的实例认识种下的工作区，拿到 session/create 要的 workspaceId。
        const workspaceProbe = await page.evaluate<RpcProbe>(
          rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspacePath) + ' } }'),
        )
        const workspaceValue = workspaceProbe.ok ? rpcValue(workspaceProbe.value) : null
        const workspaceRecord = asRecord(workspaceValue?.workspace)
        const workspaceId = stringField(workspaceRecord, 'workspaceId')
        const workspaceRegistered = workspaceProbe.ok && workspaceProbe.value.status === 200 && workspaceId !== null
        const workspaceEvidence = await recordEvidence(context, 'workspace-create.json', {
          workspacePath,
          http: workspaceProbe.ok ? workspaceProbe.value.status : 0,
          value: workspaceValue,
          problem: workspaceProbe.ok ? (workspaceRegistered ? null : rpcProblem(workspaceProbe.value)) : workspaceProbe.message,
        }, 'workspace/create 的原始回包：把种下的 markdown 工作区登记给运行中的实例')
        observations.push(observe({
          checkId: 'workspace-registered',
          title: '种下的工作区能被运行中的实例登记（后面建会话要用 workspaceId）',
          ok: workspaceRegistered,
          status: workspaceRegistered ? undefined : 'blocked',
          detail: workspaceProbe.ok
            ? 'workspace/create -> HTTP ' + String(workspaceProbe.value.status) + '，workspaceId=' + String(workspaceId)
            : '发不出 workspace/create：' + workspaceProbe.message,
          expected: 'workspace/create 回 200 且带回 workspaceId',
          actual: workspaceRegistered ? String(workspaceId) : (workspaceProbe.ok ? rpcProblem(workspaceProbe.value) : workspaceProbe.message),
          hint: workspaceRegistered ? undefined : '工作区没登记上，session/create 就无从谈起；先看实例日志与 verify/hooks.ts 的种子',
          evidence: workspaceEvidence,
        }))
        if (!workspaceRegistered || workspaceId === null) return observations

        // 2) session/create：在实例里建一条真会话 B。它是宿主里活着的会话，running 只对它才有意义。
        const sessionProbe = await page.evaluate<RpcProbe>(
          rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'),
        )
        const sessionValue = sessionProbe.ok ? rpcValue(sessionProbe.value) : null
        const liveSessionId = stringField(sessionValue, 'sessionId')
        const sessionCreated = sessionProbe.ok && sessionProbe.value.status === 200 && liveSessionId !== null
        const sessionEvidence = await recordEvidence(context, 'session-create.json', {
          workspaceId,
          http: sessionProbe.ok ? sessionProbe.value.status : 0,
          value: sessionValue,
          problem: sessionProbe.ok ? (sessionCreated ? null : rpcProblem(sessionProbe.value)) : sessionProbe.message,
        }, 'session/create 的原始回包：在种下的工作区里建一条真会话 B')
        observations.push(observe({
          checkId: 'live-session-created',
          title: '实例里建得出一条真会话（宿主里活着的会话，不是 deckExec 的假身份）',
          ok: sessionCreated,
          status: sessionCreated ? undefined : 'blocked',
          detail: sessionProbe.ok
            ? 'session/create -> HTTP ' + String(sessionProbe.value.status) + '，sessionId=' + String(liveSessionId)
            : '发不出 session/create：' + sessionProbe.message,
          expected: 'session/create 回 200 且带回 sessionId',
          actual: sessionCreated ? String(liveSessionId) : (sessionProbe.ok ? rpcProblem(sessionProbe.value) : sessionProbe.message),
          hint: sessionCreated ? undefined : '先看 workspace-registered 那条；session/create 的 request 形状见 DSH session-controller schema',
          evidence: sessionEvidence,
        }))
        if (!sessionCreated || liveSessionId === null) return observations

        // 3) 在本地 markdown 工作区里建一张占位票，再以会话 B 的身份上报一次：在办表从此有 B 的组，
        //    但此时它还没在跑，所以也不该带 running。这张票是后面认组的锚点。
        const createProbe = await runDeckTool(page, 'deck_issue_create', {
          kind: 'issue',
          title: '真机验证 #1856 的正向占位票',
          body: '这张票只在验证批次里用：先以会话 B 的身份上报，再给 B 发一条模型 prompt，核对在办表会不会给 B 的组标 running。',
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
          title: '在隔离实例的本地工作区里建得出一张占位票（在办表认组要用）',
          ok: createProbe.problem === null && createReceipt !== null && String(createReceipt.status) === 'ok' && ticketKey !== null,
          status: createProbe.problem === null ? undefined : 'blocked',
          detail: 'status=' + String(createReceipt === null ? null : createReceipt.status) + '，票号=' + String(ticketKey),
          expected: 'status=ok 且回执里带票号',
          actual: ticketKey === null ? String(createReceipt === null ? createProbe.problem : createReceipt.text || '').slice(0, 200) : '票号 ' + ticketKey,
          hint: createProbe.problem === null ? '本地 markdown 工作区由 verify/hooks.ts 种下；建不出票说明实例里的后端选择没落到 markdown' : createProbe.problem,
          evidence: createEvidence,
        }))
        if (ticketKey === null) return observations

        const reportProbe = await runDeckTool(page, 'deck_issue_report', {
          key: ticketKey,
          note: '真机验证 #1856 正向：这条写记录属于会话 B，用来在在办表里认出它的组。',
        }, workspacePath, liveSessionId)
        const reportOk = reportProbe.problem === null && reportProbe.receipt !== null && String(reportProbe.receipt.status) === 'ok'
        const reportEvidence = await recordEvidence(context, 'report-as-session-b.json', {
          sessionId: liveSessionId,
          http: reportProbe.http,
          receipt: reportProbe.receipt,
          envelopeText: reportProbe.envelopeText,
        }, '以会话 B 的身份上报一次写记录；在办表据此给 B 建组')
        const beforePrompt = await readWorkRoute(page, workspacePath, ticketKey, Date.now())
        const beforeGroups = beforePrompt.groups.map((group) => ({
          sessionLabel: group.sessionLabel,
          running: group.running === true,
          hasTicket: groupHasTicket(group, ticketKey),
        }))
        observations.push(observe({
          checkId: 'work-route-before-prompt',
          title: '发 prompt 之前，会话 B 的组已经在在办表里，但不该带 running',
          ok: reportOk && beforePrompt.ok && beforeGroups.some((row) => row.hasTicket && row.running === false) && beforePrompt.notes.indexOf('正在跑一轮') < 0,
          status: beforePrompt.ok ? undefined : 'blocked',
          detail: '上报=' + String(reportOk) + '，在办表 status=' + String(beforePrompt.receipt === null ? null : beforePrompt.receipt.status) + '，组=' + JSON.stringify(beforeGroups) + '，notes=' + (beforePrompt.notes === '' ? '（空）' : beforePrompt.notes.slice(0, 200)),
          expected: '含占位票的组存在且不带 running；notes 不含「正在跑一轮」',
          actual: beforePrompt.problem === null ? '组=' + String(beforePrompt.groups.length) : beforePrompt.problem,
          hint: beforePrompt.problem === null ? '这时 B 还没在跑；若这里就标了 running，说明筛法把「有记录」当成了「在跑」' : beforePrompt.problem,
          evidence: reportEvidence,
          hard: true,
        }))

        // 4) 给会话 B 发一条真要模型回合的请求：轮次一开，宿主里 B 的状态就是 running。
        //    让它写一段较长的文字，把那一轮撑到足够我们在外面读到。
        const promptText = '请用大约四百字介绍一下江南的春天，分三段写，写完就停，不要调用任何工具。'
        const promptRequest = {
          requestId: 'verify-1856-prompt-' + Math.random().toString(36).slice(2, 10),
          sessionId: liveSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: promptText }],
        }
        const promptProbe = await page.evaluate<RpcProbe>(
          rpcScript('session/prompt', '{ request: ' + JSON.stringify(promptRequest) + ' }'),
        )
        const promptOk = promptProbe.ok && promptProbe.value.status === 200
        const promptProblem = promptProbe.ok ? (promptOk ? null : rpcProblem(promptProbe.value)) : promptProbe.message
        const promptEvidence = await recordEvidence(context, 'session-prompt.json', {
          http: promptProbe.ok ? promptProbe.value.status : 0,
          request: promptRequest,
          value: promptProbe.ok ? rpcValue(promptProbe.value) : null,
          problem: promptProblem,
          text: promptProbe.ok ? promptProbe.value.text : promptProbe.message,
        }, 'session/prompt 的原始回包：给会话 B 发一条真要模型回合的请求')
        observations.push(observe({
          checkId: 'prompt-admitted',
          title: '给会话 B 发的 prompt 被宿主接纳（后面才能等那一轮开着）',
          ok: promptOk,
          status: promptOk ? undefined : 'blocked',
          detail: promptProbe.ok ? 'session/prompt -> HTTP ' + String(promptProbe.value.status) : '发不出 session/prompt：' + promptProbe.message,
          expected: 'session/prompt 回 200，且会话开始跑这一轮',
          actual: promptOk ? 'HTTP 200' : String(promptProblem),
          hint: promptOk ? undefined : 'prompt 都发不进去时，本场景后面的观察无从谈起；先查实例的模型配置与凭证',
          evidence: promptEvidence,
        }))
        if (!promptOk) return observations

        // 5) 趁那一轮开着，密轮询在办表：含占位票的组要带 running:true、notes 要说到在跑；
        //    探针自己的组（假 sessionId，宿主里没有对应 agent）永远不该带 running。
        const startedAt = Date.now()
        const ticks: RouteTick[] = []
        let firstRunning: { tick: RouteTick; group: Record<string, unknown> } | null = null
        while (Date.now() - startedAt < RUNNING_WINDOW_MS) {
          const tick = await readWorkRoute(page, workspacePath, ticketKey, startedAt)
          ticks.push(tick)
          const group = runningGroupForTicket(tick.groups, ticketKey)
          if (group !== null) {
            firstRunning = { tick, group }
            break
          }
          await sleep(POLL_INTERVAL_MS)
        }
        const runningSeen = firstRunning !== null
        const probingTickSummary = ticks.slice(-1).map((tick) => ({
          elapsedMs: tick.elapsedMs,
          ok: tick.ok,
          notes: tick.notes.slice(0, 200),
          groups: tick.groups.map((group) => ({ label: group.sessionLabel, running: group.running === true, hasTicket: groupHasTicket(group, ticketKey) })),
        }))
        const runningEvidence = await recordEvidence(context, 'work-route-running-window.json', {
          windowMs: RUNNING_WINDOW_MS,
          pollIntervalMs: POLL_INTERVAL_MS,
          attempts: ticks.length,
          elapsedMs: Date.now() - startedAt,
          firstRunningAtMs: firstRunning === null ? null : firstRunning.tick.elapsedMs,
          firstRunningGroup: firstRunning === null ? null : {
            sessionLabel: firstRunning.group.sessionLabel,
            running: firstRunning.group.running,
            items: firstRunning.group.items,
          },
          notes: firstRunning === null ? null : firstRunning.tick.notes,
          lastTick: probingTickSummary,
        }, '在 prompt 回合开着期间轮询 deck_work_route：第几次读到 running:true、那一组与当时的 notes')
        observations.push(observe({
          checkId: 'running-group-observed',
          title: '真有一轮在跑时，含会话 B 占位票的组带 running:true，notes 说正在跑一轮',
          ok: runningSeen && firstRunning !== null && firstRunning.tick.notes.indexOf('正在跑一轮') >= 0,
          status: runningSeen ? undefined : 'blocked',
          detail: runningSeen && firstRunning !== null
            ? '第 ' + String(firstRunning.tick.elapsedMs) + 'ms 读到 running:true（组「' + String(firstRunning.group.sessionLabel) + '」），notes=' + (firstRunning.tick.notes === '' ? '（空）' : firstRunning.tick.notes.slice(0, 200))
            : '观察窗口 ' + String(RUNNING_WINDOW_MS) + 'ms 内没读到 running:true（轮询 ' + String(ticks.length) + ' 次）',
          expected: '某一刻含占位票的组带 running:true，且 notes 含「正在跑一轮」',
          actual: runningSeen ? '读到 running:true' : '窗口内没读到',
          hint: runningSeen ? undefined : '模型回合可能没起来（模型不可用、凭证不认）或回合已经结束；先看实例日志和 session-prompt 的证据',
          evidence: runningEvidence,
          hard: true,
        }))

        const probeGroupRan = ticks.some((tick) => tick.groups.some((group) => !groupHasTicket(group, ticketKey) && group.running === true))
        observations.push(observe({
          checkId: 'probe-group-not-marked-running',
          title: '只有活会话的组才标 running：探针的假会话组（宿主里没有对应 agent）从不带 running',
          ok: !probeGroupRan,
          detail: probeGroupRan ? '观察到不含占位票的组带 running:true' : '探针的组始终不带 running',
          expected: 'running 只出现在真有 agent 的会话组上',
          actual: probeGroupRan ? '有非活会话组被标了 running' : '未观察到误标',
          hint: '误标说明筛法把「有写记录」当成了「在跑」；见 src/deck/shell/running-sessions.ts 的判据',
        }))

        // 6) 取消这一轮：running 标记要跟着消失，notes 里的在跑句也要撤掉。
        const cancelProbe = await page.evaluate<RpcProbe>(
          rpcScript('session/cancel', '{ request: { sessionId: ' + JSON.stringify(liveSessionId) + ' } }'),
        )
        const cancelOk = cancelProbe.ok && cancelProbe.value.status === 200
        const cancelEvidence = await recordEvidence(context, 'session-cancel.json', {
          http: cancelProbe.ok ? cancelProbe.value.status : 0,
          value: cancelProbe.ok ? rpcValue(cancelProbe.value) : null,
          problem: cancelProbe.ok ? null : cancelProbe.message,
        }, 'session/cancel 的原始回包：取消会话 B 正在跑的那一轮')
        const clearedAt = Date.now()
        let clearedTick: RouteTick | null = null
        while (Date.now() - clearedAt < CLEAR_WINDOW_MS) {
          const tick = await readWorkRoute(page, workspacePath, ticketKey, clearedAt)
          if (!tick.groups.some((group) => groupHasTicket(group, ticketKey) && group.running === true)) {
            clearedTick = tick
            break
          }
          await sleep(POLL_INTERVAL_MS)
        }
        const clearedEvidence = await recordEvidence(context, 'work-route-after-cancel.json', {
          cancelled: cancelOk,
          elapsedMs: clearedTick === null ? null : clearedTick.elapsedMs,
          groups: clearedTick === null ? null : clearedTick.groups.map((group) => ({ label: group.sessionLabel, running: group.running === true, hasTicket: groupHasTicket(group, ticketKey) })),
          notes: clearedTick === null ? null : clearedTick.notes,
        }, '取消这一轮之后在办表的读数：running 是否撤掉')
        observations.push(observe({
          checkId: 'running-clears-after-cancel',
          title: '取消这一轮之后，同一个组上的 running 撤掉，notes 不再说在跑',
          ok: cancelOk && clearedTick !== null && clearedTick.notes.indexOf('正在跑一轮') < 0,
          status: cancelOk ? undefined : 'blocked',
          detail: cancelOk
            ? (clearedTick === null ? '取消后 ' + String(CLEAR_WINDOW_MS) + 'ms 内仍读到 running:true' : '第 ' + String(clearedTick.elapsedMs) + 'ms 读到 running 已撤掉，notes=' + (clearedTick.notes === '' ? '（空）' : clearedTick.notes.slice(0, 200)))
            : '取消没发出去：' + (cancelProbe.ok ? rpcProblem(cancelProbe.value) : cancelProbe.message),
          expected: '取消后 running 键撤掉，notes 不再含「正在跑一轮」',
          actual: clearedTick === null ? '仍读到 running:true' : 'running 已撤掉',
          hint: cancelOk ? '取消后标记没撤，说明 running 的读数没有跟着宿主状态走' : 'session/cancel 的名称或参数可能不同；先看证据里的回包',
          evidence: clearedEvidence,
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
