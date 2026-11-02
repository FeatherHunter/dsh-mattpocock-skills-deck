// verify/scenarios/1830-list-honesty.ts —— 真机验证 #1830：标签筛选要下推，回执要分得清两种「没取全」。
//
// 验证路线：用 base 的真机验证能力开一个隔离的 web profile 实例，把候选包装进去，然后从页面里
// 走宿主代执行通道（POST /api/dsws，method = deckExec）直接调用运行中宿主里的 deck 工具。
// 这样验证的是「装进 web profile 之后真实运行的插件」，不是门禁里用桩后端拼出来的那套。
//
// 断言分两层：
//   1) 数据层：state=closed、labels=['bug'] 时，后端真的按标签取数 —— 工具数出来的总数与 gh
//      独立数出来的一致，且远大于旧实现「在窗口里筛」得到的 172；本地 limit 截断（truncated）
//      与后端上限截断（backendTruncated）两个旗标各说各的。
//   2) 文案层：notes 与正文（text）对「这份清单有没有可能不全」说同一件事。
// 证据：每次工具回执与 gh 的独立结果都写进 evidence，报告里带 sha256，可复核。
//
// 手动跑法（工作根与批次 home 换成你自己的）：
//   $env:DSH_HOME='<批次 home>'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js `
//     run verify/scenarios/1830-list-honesty.ts --profile web `
//     --work-root <工作根> --json --collect-all

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'

/** 场景文件在 verify/scenarios/ 下，仓库根在它上面两层；被列的就是这个仓库的票。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const OWNER = 'FeatherHunter'
const REPO_NAME = 'dsh-mattpocock-skills-deck'
/** 票面点名的例子：一张早就关闭、带 bug 标签的老票，必须落在「已关闭且带 bug」的全集里。 */
const EXAMPLE_KEY = '1303'
/** 允许 gh 与工具两次独立读数之间的漂移：两次调用之间如果有人刚关了或开了票，数字会差几条。 */
const TOTAL_TOLERANCE = 3

interface RawBrowserPage {
  readonly goto?: (url: string) => Promise<{ ok: boolean; error?: { message?: string } }>
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
}

interface ListRow {
  readonly key?: unknown
  readonly state?: unknown
  readonly labels?: unknown
}

interface GroundTruth {
  readonly ok: boolean
  readonly closedBugIssues: number | null
  readonly exampleState: string | null
  readonly exampleUpdatedAt: string | null
  readonly exampleLabels: readonly string[]
  readonly problem: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * 在页面里走客户端的 RPC 协议调宿主代执行通道：POST /api/dsws，信封是 client-request，
 * payload.method 是 'deckExec'。和 src/deck/registration/agent-row.ts 的 callViaFetch 同一个形状。
 * evaluate 只收字符串，所以把整段写成自调用表达式，参数用 JSON 字面量嵌进去。
 */
function deckExecScript(tool: string, args: Record<string, unknown>): string {
  const call = { tool, args, session: { cwd: REPO_ROOT, sessionId: 'verify-1830-list-honesty' } }
  const body = {
    type: 'client-request',
    rpcId: 'verify-1830-' + Math.random().toString(36).slice(2, 12),
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

async function runDeckTool(page: PageHandle, tool: string, args: Record<string, unknown>): Promise<ToolProbe> {
  const probe = await page.evaluate<{ http: number; envelopeText: string; envelope: unknown }>(deckExecScript(tool, args))
  if (!probe.ok) {
    return { http: 0, envelopeText: '', envelope: null, receipt: null, problem: '页面里发不出这次调用：' + probe.error.message }
  }
  const receipt = pickReceipt(probe.value.envelope)
  return {
    http: probe.value.http,
    envelopeText: probe.value.envelopeText,
    envelope: probe.value.envelope,
    receipt,
    problem: receipt === null ? '宿主回包里没有工具回执（HTTP ' + String(probe.value.http) + '）：' + probe.value.envelopeText.slice(0, 300) : null,
  }
}

async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<{ path: string | null; problem: string | null }> {
  const saved = await context.evidence.recordJson(name, value, { note })
  if (!saved.ok) return { path: null, problem: '证据没写下来（' + name + '）：' + saved.error.message }
  return { path: saved.value.path, problem: null }
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

function rowsOf(data: Record<string, unknown> | undefined): readonly ListRow[] {
  const rows = data !== undefined && Array.isArray(data.issues) ? data.issues : []
  return rows.filter((row): row is ListRow => typeof row === 'object' && row !== null)
}

/** 标签名：列表行是字符串数组，读单票时也是字符串数组；两种都收，取不到就跳过。 */
function labelNames(value: unknown): string[] {
  const labels = Array.isArray(value) ? value : []
  const names: string[] = []
  for (const label of labels) {
    if (typeof label === 'string' && label.trim().length > 0) names.push(label.trim())
    else {
      const record = asRecord(label)
      if (record !== null && typeof record.name === 'string' && record.name.trim().length > 0) names.push(record.name.trim())
    }
  }
  return names
}

/**
 * 独立真值：直接用 gh 数「已关闭且带 bug」的工单，并读一眼 #1303 的状态与标签。
 * gh 失败不是产品问题，记 blocked 并说明原因；数字只在取到时参与断言。
 */
function measureGroundTruth(): GroundTruth {
  const query = [
    'query($owner:String!,$name:String!){',
    '  repository(owner:$owner,name:$name){',
    '    issues(states:[CLOSED],filterBy:{labels:["bug"]}){totalCount}',
    '    ticket: issue(number:' + String(Number(EXAMPLE_KEY)) + '){number state updatedAt labels(first:20){nodes{name}}}',
    '  }',
    '}',
  ].join('\n')
  let proc
  try {
    proc = spawnSync('gh', ['api', 'graphql', '-f', 'query=' + query, '-f', 'owner=' + OWNER, '-f', 'name=' + REPO_NAME], { encoding: 'utf8', timeout: 60000 })
  } catch (error) {
    return { ok: false, closedBugIssues: null, exampleState: null, exampleUpdatedAt: null, exampleLabels: [], problem: '起不来 gh：' + (error instanceof Error ? error.message : String(error)) }
  }
  if (proc.error !== undefined) {
    return { ok: false, closedBugIssues: null, exampleState: null, exampleUpdatedAt: null, exampleLabels: [], problem: 'gh 调用失败：' + String(proc.error.message) }
  }
  if (proc.status !== 0) {
    return { ok: false, closedBugIssues: null, exampleState: null, exampleUpdatedAt: null, exampleLabels: [], problem: 'gh 退出码 ' + String(proc.status) + '：' + String(proc.stderr || '').trim().slice(0, 300) }
  }
  let parsed: unknown = null
  try {
    parsed = JSON.parse(String(proc.stdout || ''))
  } catch (error) {
    return { ok: false, closedBugIssues: null, exampleState: null, exampleUpdatedAt: null, exampleLabels: [], problem: 'gh 输出不是 JSON：' + String(proc.stdout || '').slice(0, 200) }
  }
  const repo = asRecord(asRecord(asRecord(parsed)?.data)?.repository)
  const totalCount = asRecord(repo?.issues)?.totalCount
  const ticket = asRecord(repo?.ticket)
  return {
    ok: typeof totalCount === 'number',
    closedBugIssues: typeof totalCount === 'number' ? totalCount : null,
    exampleState: typeof ticket?.state === 'string' ? ticket.state : null,
    exampleUpdatedAt: typeof ticket?.updatedAt === 'string' ? ticket.updatedAt : null,
    exampleLabels: labelNames(asRecord(ticket?.labels)?.nodes),
    problem: typeof totalCount === 'number' ? null : 'gh 回包里没有 issues.totalCount',
  }
}

export default defineScenario<ScenarioContext>({
  id: 'list-honesty-1830',
  title: '标签筛选真的下推给 GitHub，列表回执把两种「没取全」分开说',
  description: '在隔离的 web profile 实例里，经宿主代执行通道调用运行中的 deck_issue_list：用这个仓库的真实票验证 #1830——标签筛选不再在窗口里静默漏票，本地 limit 截断与后端取数上限截断分别可见，notes 与正文对「可能不全」说同一件事。',
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个装好候选包的隔离 web 实例',
    },
    {
      id: 'list-honesty',
      kind: 'custom',
      // 这一跑要读几百张票、还要把 state=all 那条上限跑满（约 20 次 GraphQL），默认 120 秒不够。
      timeoutMs: 900000,
      title: '从页面调 deck_issue_list，核对数据与文案两层',
      run: async (context) => {
        const observations: ScenarioObservation[] = []

        const pageResult = await context.primitives.page()
        if (!pageResult.ok) {
          return [observe({
            checkId: 'page-open',
            title: '页面能为这个实例打开',
            ok: false,
            status: 'blocked',
            detail: '拿不到页面句柄：' + pageResult.error.message,
            expected: '浏览器适配器为运行中的实例打开一个页面',
            actual: pageResult.error.message,
            hint: pageResult.error.hint || '先确认 verify/browser.mjs 与 profile 里的 browser 声明',
          })]
        }
        const page = pageResult.value

        const instance = context.instance
        if (instance === null) {
          return [observe({
            checkId: 'instance-alive',
            title: 'launch 步留下了一个活着的实例',
            ok: false,
            status: 'blocked',
            detail: '页面拿到了，但 context.instance 是空的',
            expected: 'launch 步跑完后有一个可用的实例句柄',
            actual: 'context.instance === null',
            hint: 'launch 步必须在这次自定义步之前',
          })]
        }

        // 一次性 token 换成会话 cookie 再操作；顺序反了会落到 401 登录页。
        const raw = page.page as unknown as RawBrowserPage
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(1500)

        const bodyText = await page.evaluate<string>('document.body.innerText || ""')
        observations.push(observe({
          checkId: 'page-ready',
          title: '页面加载的是插件宿主界面，不是登录页',
          ok: bodyText.ok && bodyText.value.trim().length > 20,
          detail: bodyText.ok ? '页面可见文本 ' + String(bodyText.value.trim().length) + ' 字' : '读不到页面文本：' + bodyText.error.message,
          expected: 'document.body.innerText 有超过 20 字的可见文本',
          actual: bodyText.ok ? String(bodyText.value.trim().length) + ' 字' : bodyText.error.message,
          hint: '实例可能没起来或卡在启动弹窗；看实例日志与截图',
        }))

        // 0) 先确认后端判定：隔离 home 没记过这个工作区的选择，只能靠声明文件与自动识别。
        const contextProbe = await runDeckTool(page, 'deck_context', {})
        const contextEvidence = await recordEvidence(context, 'deck-context.json', contextProbe.envelope, 'deck_context 的原始回执：确认这个工作区被判成哪个后端')
        const contextText = String(contextProbe.receipt?.text || '')
        const backendIsGithub = contextProbe.receipt !== null && contextProbe.receipt.status === 'ok' && contextText.indexOf('后端 github') >= 0
        observations.push(observe({
          checkId: 'backend-github',
          title: '这个工作区被判成 GitHub 后端',
          ok: backendIsGithub,
          status: backendIsGithub ? undefined : 'blocked',
          detail: contextProbe.problem === null ? contextText.slice(0, 300) : contextProbe.problem,
          expected: 'deck_context 回执里有「后端 github」',
          actual: contextProbe.receipt === null ? '没有工具回执' : String(contextProbe.receipt.status) + '：' + contextText.slice(0, 200),
          hint: '隔离实例没有后端选择记忆，靠 docs/agents/issue-tracker.md 与 .git/config 自动识别；识别失败就先把这两个文件检查一遍',
          evidence: contextEvidence.path === null ? [] : [contextEvidence.path],
        }))
        if (contextEvidence.problem !== null) {
          observations.push(observe({ checkId: 'context-evidence', title: '调用回执写进了证据', ok: false, status: 'blocked', detail: contextEvidence.problem }))
        }
        if (!backendIsGithub) {
          observations.push(observe({
            checkId: 'list-not-run',
            title: '后面的列表断言没有跑',
            ok: false,
            status: 'blocked',
            detail: '后端没判成 GitHub，列表会去读别的后端，结论不能算在 #1830 头上',
            expected: '后端先判成 github',
            actual: contextText.slice(0, 200),
            hint: '这是环境问题，不是产品失败；把 deck_context 的回执贴进报告',
          }))
          return observations
        }

        // 1) 独立真值：gh 直接数「已关闭且带 bug」的工单。
        const truth = measureGroundTruth()
        const truthEvidence = await recordEvidence(context, 'ground-truth-gh.json', truth, '用 gh 独立数出来的真值：已关闭且带 bug 的工单数，以及 #1303 的状态与标签')
        observations.push(observe({
          checkId: 'ground-truth',
          title: 'gh 能独立数出「已关闭且带 bug」的工单',
          ok: truth.ok,
          status: truth.ok ? undefined : 'blocked',
          hard: truth.ok,
          detail: truth.ok ? 'gh 数出来 ' + String(truth.closedBugIssues) + ' 张' : String(truth.problem),
          expected: '一次 gh GraphQL 查询拿到 issues.totalCount',
          actual: truth.ok ? String(truth.closedBugIssues) : String(truth.problem),
          hint: 'gh 没登录或没网时这条会 blocked，不影响其它断言，但总数核对会少一个独立参照',
          evidence: truthEvidence.path === null ? [] : [truthEvidence.path],
        }))

        // 2) 核心调用：已关闭 + 带 bug，limit 200。修复后后端按标签取全（这个仓库约 390 张）。
        const closedProbe = await runDeckTool(page, 'deck_issue_list', { state: 'closed', labels: ['bug'], limit: 200 })
        const closedEvidence = await recordEvidence(context, 'list-closed-bug.json', closedProbe.envelope, 'deck_issue_list{state:closed, labels:[bug], limit:200} 的原始回执')
        const closedReceipt = closedProbe.receipt
        const closedData = closedReceipt === null ? null : asRecord(closedReceipt.data)
        if (closedReceipt === null || closedReceipt.status !== 'ok' || closedData === null) {
          observations.push(observe({
            checkId: 'closed-bug-ok',
            title: '第一通列表调用成功返回',
            ok: false,
            detail: closedProbe.problem === null ? '工具回执不是 ok：' + String(closedReceipt?.status) + '，' + String(closedReceipt?.text || '').slice(0, 200) : closedProbe.problem,
            expected: 'status=ok 且 data 里有 total/returned/truncated/backendTruncated/issues',
            actual: closedReceipt === null ? '没有回执' : String(closedReceipt.status) + '：' + String(closedReceipt.text || '').slice(0, 200),
            hint: '先看 deck_context 那条有没有过，再看证据里的原始回包',
            evidence: closedEvidence.path === null ? [] : [closedEvidence.path],
          }))
          return observations
        }

        const closedRows = rowsOf(closedData)
        const total = typeof closedData.total === 'number' ? closedData.total : -1
        const returned = typeof closedData.returned === 'number' ? closedData.returned : -1
        const localTruncated = closedData.truncated === true
        const backendTruncated = closedData.backendTruncated === true
        const closedText = String(closedReceipt.text || '')
        const closedNotes = Array.isArray(closedReceipt.notes) ? closedReceipt.notes.map((n) => String(n)).join(' / ') : ''

        observations.push(observe({
          checkId: 'closed-bug-ok',
          title: '第一通列表调用成功返回',
          ok: true,
          detail: 'status=ok，共 ' + String(total) + ' 行符合，回 ' + String(returned) + ' 行',
          expected: 'status=ok 且 data 齐全',
          actual: 'status=' + String(closedReceipt.status),
          evidence: closedEvidence.path === null ? [] : [closedEvidence.path],
        }))

        // 2a) 回执行数：本地 limit 200 应该真的截到 200 行，而总数远大于 200（旧实现是窗口内筛出的 172）。
        observations.push(observe({
          checkId: 'closed-bug-local-limit',
          title: '本地 limit 截断到 200 行，总数比这多',
          ok: returned === 200 && closedRows.length === 200 && total > 200,
          detail: 'returned=' + String(returned) + '，total=' + String(total) + '，rows=' + String(closedRows.length),
          expected: 'returned=200 且 total 大于 200（这个仓库已关闭且带 bug 的票有几百张）',
          actual: 'returned=' + String(returned) + '，total=' + String(total),
          hint: '旧实现在 500 行窗口里筛标签，只数到 172；total 还是 172 左右说明标签没下推',
        }))

        // 2b) 两个旗标各说各的：本地 limit 截断为真，后端上限截断应为假（几百张，没到 GitHub 的 500 张上限）。
        observations.push(observe({
          checkId: 'closed-bug-flags-split',
          title: '本地 limit 截断与后端上限截断分开报告',
          ok: localTruncated && !backendTruncated,
          detail: 'data.truncated=' + String(localTruncated) + '，data.backendTruncated=' + String(backendTruncated),
          expected: 'truncated=true（本地只回前 200 行）且 backendTruncated=false（后端没到取数上限）',
          actual: 'truncated=' + String(localTruncated) + '，backendTruncated=' + String(backendTruncated),
          hint: '两个旗标说反或缺一，说明回执没把两层截断分开（#1830 的现象）',
        }))

        // 2c) 返回的行必须都真的已关闭、都真的带 bug：标签筛选用的是后端结果，不是只改了数字。
        const badRows: string[] = []
        for (const row of closedRows) {
          const rowLabels = labelNames(row.labels).map((name) => name.toLowerCase())
          const stateOk = row.state === 'closed'
          const labelOk = rowLabels.indexOf('bug') >= 0
          if (!stateOk || !labelOk) badRows.push(String(row.key) + '（state=' + String(row.state) + '，labels=' + rowLabels.join(',') + '）')
        }
        observations.push(observe({
          checkId: 'closed-bug-rows-honest',
          title: '返回的每一行都真的已关闭、真的带 bug',
          ok: badRows.length === 0,
          detail: badRows.length === 0 ? '200 行逐条核对通过' : '有 ' + String(badRows.length) + ' 行不符：' + badRows.slice(0, 5).join('；'),
          expected: '每一行 state=closed 且 labels 里含 bug',
          actual: badRows.length === 0 ? '全部符合' : badRows.slice(0, 5).join('；'),
          hint: '标签下推后还要在内存里按 AND 收窄；这里不符说明收窄口径和报告口径不一致',
        }))

        // 2d) 关键证据：工具数出来的总数与 gh 独立数出来的一致 —— 标签筛选真的下推了，没在窗口里漏票。
        const totalMatchesTruth = truth.ok && truth.closedBugIssues !== null && Math.abs(total - truth.closedBugIssues) <= TOTAL_TOLERANCE
        observations.push(observe({
          checkId: 'closed-bug-total-vs-truth',
          title: '工具数出来的总数与 gh 独立数出来的真值一致',
          ok: totalMatchesTruth,
          status: truth.ok ? undefined : 'blocked',
          hard: truth.ok,
          detail: truth.ok
            ? '工具 data.total=' + String(total) + '，gh 独立数出来 ' + String(truth.closedBugIssues) + '，允许 ' + String(TOTAL_TOLERANCE) + ' 张的漂移'
            : 'gh 真值没取到（' + String(truth.problem) + '），这条只能 blocked',
          expected: 'data.total 与 gh 的 issues.totalCount 相差不超过 ' + String(TOTAL_TOLERANCE),
          actual: truth.ok ? '工具 ' + String(total) + ' / gh ' + String(truth.closedBugIssues) : String(truth.problem),
          hint: '数字对不上说明后端没按标签取，或者内存收窄又丢了行；看证据里的两份原始回包',
          evidence: truthEvidence.path === null ? [] : [truthEvidence.path],
        }))

        // 2e) 文案同源：total 与「只回前 200 行」都在；后端没到上限时不许说「可能不全」。
        const textHasCount = closedText.indexOf('共 ' + String(total) + ' 行符合') >= 0
        const textHasLabelCond = closedText.indexOf('label=bug') >= 0
        const textClaimsIncomplete = closedText.indexOf('可能不全') >= 0
        const notesClaimIncomplete = closedNotes.indexOf('可能不全') >= 0
        const notesHasLocalLimit = closedNotes.indexOf('只回前 ' + String(returned) + ' 行') >= 0
        observations.push(observe({
          checkId: 'closed-bug-wording',
          title: '正文与 notes 说同一件事：只是本地 limit 截断，不是后端没取全',
          ok: textHasCount && textHasLabelCond && notesHasLocalLimit && !textClaimsIncomplete && !notesClaimIncomplete,
          detail: '正文含总数=' + String(textHasCount) + '，含 label=bug=' + String(textHasLabelCond) + '，notes 含本地截断句=' + String(notesHasLocalLimit) + '，正文说可能不全=' + String(textClaimsIncomplete) + '，notes 说可能不全=' + String(notesClaimIncomplete),
          expected: '正文有「共 ' + String(total) + ' 行符合」与 label=bug，notes 有「只回前 ' + String(returned) + ' 行」，两者都不说「可能不全」',
          actual: '正文：' + closedText.slice(0, 200) + '；notes：' + closedNotes.slice(0, 200),
          hint: 'notes 与 data 同源是这次修复的要求；哪边多一句少一句都要改',
        }))

        // 3) 票面点名的老票：#1303 是已关闭且带 bug 的票，得证明它没被清单漏掉。第一次真机跑时它正好落在
        //    前 200 行里（它 updatedAt 是 2026-10-20，但已关闭带 bug 的票里比它更新的不足 200 张），所以判据
        //    不能写成「它一定不在返回行里」，只能写「它被数进全集」：total 与 gh 独立真值一致，且它确实是已关闭带 bug。
        const exampleProbe = await runDeckTool(page, 'deck_issue_get', { key: EXAMPLE_KEY })
        const exampleEvidence = await recordEvidence(context, 'issue-1303.json', exampleProbe.envelope, 'deck_issue_get #1303 的原始回执：确认它是已关闭且带 bug 的票')
        const exampleTicket = asRecord(asRecord(exampleProbe.receipt?.data)?.ticket)
        const exampleState = typeof exampleTicket?.state === 'string' ? exampleTicket.state : null
        const exampleLabels = labelNames(exampleTicket?.labels).map((name) => name.toLowerCase())
        const exampleIsClosedBug = exampleProbe.receipt?.status === 'ok' && exampleState === 'closed' && exampleLabels.indexOf('bug') >= 0
        const exampleInReturnedRows = closedRows.some((row) => String(row.key) === EXAMPLE_KEY)
        observations.push(observe({
          checkId: 'example-ticket-closed-bug',
          title: '#' + EXAMPLE_KEY + ' 确实是已关闭且带 bug 的票（它必须落在清单的全集里）',
          ok: exampleIsClosedBug,
          detail: exampleProbe.receipt?.status === 'ok'
            ? '#' + EXAMPLE_KEY + ' state=' + String(exampleState) + '，labels=' + exampleLabels.join(',') + '；这次前 200 行里' + (exampleInReturnedRows ? '有' : '没有') + '它'
            : String(exampleProbe.problem),
          expected: 'deck_issue_get #' + EXAMPLE_KEY + ' 回 status=ok、state=closed、labels 含 bug',
          actual: exampleProbe.receipt === null ? '没有回执' : 'state=' + String(exampleState) + '，labels=' + exampleLabels.join(','),
          hint: '这张票是票面举的例子；它状态不对说明拿它做参照的前提变了，换一张老票再核',
          evidence: exampleEvidence.path === null ? [] : [exampleEvidence.path],
        }))
        observations.push(observe({
          checkId: 'example-ticket-accounted',
          title: '#' + EXAMPLE_KEY + ' 没有被清单漏掉：它被数进了清单全集',
          ok: exampleIsClosedBug && totalMatchesTruth,
          status: truth.ok ? undefined : 'blocked',
          hard: truth.ok,
          detail: '#' + EXAMPLE_KEY + ' updatedAt=' + String(truth.exampleUpdatedAt) + '，' + (exampleInReturnedRows ? '落在本次返回的前 200 行里' : '不在本次返回的前 200 行里，但已计入 total') + '；total=' + String(total) + '，gh 真值=' + String(truth.closedBugIssues),
          expected: '#' + EXAMPLE_KEY + ' 是已关闭且带 bug 的票，且清单 total 与 gh 独立数出来的真值一致（它因此被数进全集）',
          actual: '在返回行里=' + String(exampleInReturnedRows) + '，total=' + String(total) + '，gh 真值=' + String(truth.closedBugIssues),
          hint: '旧实现只数窗口里筛出来的行，total 会明显小于真值；这里比的是总数，不是它有没有出现在前 200 行',
        }))

        // 4) 第二层截断：state=all 会把 GitHub 工单 500 张的取数上限跑满。这条路必须让 data 明说可能不全。
        const allProbe = await runDeckTool(page, 'deck_issue_list', { state: 'all', limit: 5 })
        const allEvidence = await recordEvidence(context, 'list-all-limit-5.json', allProbe.envelope, 'deck_issue_list{state:all, limit:5} 的原始回执：后端取数上限必须能被 data 看出来')
        const allReceipt = allProbe.receipt
        const allData = allReceipt === null ? null : asRecord(allReceipt.data)
        if (allReceipt === null || allReceipt.status !== 'ok' || allData === null) {
          observations.push(observe({
            checkId: 'all-backend-truncated',
            title: '第二通列表调用成功返回',
            ok: false,
            detail: allProbe.problem === null ? '工具回执不是 ok：' + String(allReceipt?.status) + '，' + String(allReceipt?.text || '').slice(0, 200) : allProbe.problem,
            expected: 'status=ok 且 data 里有 backendTruncated',
            actual: allReceipt === null ? '没有回执' : String(allReceipt.status),
            hint: '看证据里的原始回包',
            evidence: allEvidence.path === null ? [] : [allEvidence.path],
          }))
          return observations
        }
        const allTotal = typeof allData.total === 'number' ? allData.total : -1
        const allReturned = typeof allData.returned === 'number' ? allData.returned : -1
        const allBackendTruncated = allData.backendTruncated === true
        const allLocalTruncated = allData.truncated === true
        observations.push(observe({
          checkId: 'all-backend-truncated',
          title: 'state=all 时后端取数上限被 data 标出来，且本地 limit 也标出来',
          ok: allBackendTruncated && allLocalTruncated && allReturned === 5 && allTotal >= 500,
          detail: 'total=' + String(allTotal) + '，returned=' + String(allReturned) + '，truncated=' + String(allLocalTruncated) + '，backendTruncated=' + String(allBackendTruncated),
          expected: 'backendTruncated=true（工单上限 500 张到了）且 truncated=true（只回前 5 行），total 至少 500',
          actual: 'backendTruncated=' + String(allBackendTruncated) + '，truncated=' + String(allLocalTruncated) + '，total=' + String(allTotal),
          hint: '旧回执里这两个信息只混在 notes 里，data 看不出来；这里必须能在 data 上直接读到',
          evidence: allEvidence.path === null ? [] : [allEvidence.path],
        }))

        const allText = String(allReceipt.text || '')
        const allNotes = Array.isArray(allReceipt.notes) ? allReceipt.notes.map((n) => String(n)).join(' / ') : ''
        const allTextClaimsIncomplete = allText.indexOf('可能不全') >= 0
        const allNotesClaimsIncomplete = allNotes.indexOf('可能不全') >= 0
        const allNotesNamesBackend = allNotes.indexOf('后端') >= 0
        observations.push(observe({
          checkId: 'all-text-notes-agree',
          title: 'state=all 时正文与 notes 一起说「可能不全」，note 里点明后端上限',
          ok: allTextClaimsIncomplete && allNotesClaimsIncomplete && allNotesNamesBackend,
          detail: '正文说可能不全=' + String(allTextClaimsIncomplete) + '，notes 说可能不全=' + String(allNotesClaimsIncomplete) + '，notes 点明后端=' + String(allNotesNamesBackend),
          expected: '正文含「可能不全」，notes 也含「可能不全」并点明是后端取到上限',
          actual: '正文：' + allText.slice(0, 200) + '；notes：' + allNotes.slice(0, 300),
          hint: 'notes 与正文必须由同一个布尔驱动；只改一边就会出现「一处说不全、一处像是全量」',
        }))

        // 5) 截图进证据：失败时人第一眼要看的就是界面当时的样子。
        const screenshotPath = path.join(context.evidence.root, 'web-profile-1830.png')
        const shot = await page.screenshot(screenshotPath)
        observations.push(observe({
          checkId: 'page-screenshot',
          title: '实例页面截图写进了证据',
          ok: shot.ok && shot.value.bytes > 0,
          hard: false,
          detail: shot.ok ? String(shot.value.bytes) + ' 字节，' + screenshotPath : '截图失败：' + shot.error.message,
          expected: '证据目录里有一张非空的 PNG',
          actual: shot.ok ? String(shot.value.bytes) + ' 字节' : shot.error.message,
          evidence: shot.ok && shot.value.bytes > 0 ? [screenshotPath] : [],
        }))

        return observations
      },
    },
    {
      id: 'stop',
      kind: 'stop',
      title: '停实例并确认清理干净',
    },
  ],
})
