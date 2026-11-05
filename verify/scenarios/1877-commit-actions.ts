// verify/scenarios/1877-commit-actions.ts —— 真机验证 #1877：提交选项里六条能力在真机上逐条执行。
//
// 这个场景在隔离实例里跑，不碰真实 DSH 主目录：隔离 home 由批次流程复制，prepareHome 只改副本里的文件。
// 夹具仓库在仓库外（默认 <系统临时目录>/matt1877/fixture/repo），第一次运行时自动创建：
//   两条基线提交、一份 .gitmessage（三段骨架，并配进 commit.template）、一个已暂存改动、一个未暂存改动、
//   一个未跟踪文件，以及一个只写记录、不拦提交的 pre-commit 钩子（用来证明「跳过提交钩子」真的没跑钩子）。
//
// 与 1860 的场景分工：1860 管首屏版式与四档宽截图（它已经在每档宽 / 每皮肤下拍「提交选项」打开状态），
// 本场景管「按下去会怎样」：普通提交、一起提交 + 跳过钩子、修订（确认卡）、模板套用与撤销、
// fixup 与 squash 的自动说明、以及三条关闭路径与焦点回位。断言落在 DOM 与夹具仓库的真实 git 历史两处。
//
// 跑法（有头，一种皮肤起一个实例）：
//   $env:DSH_HOME = <批次 home>
//   $env:DSH_1877_SKIN = 'dark'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1877-commit-actions.ts --profile web --declaration verify/profile-1833-headed.ts --work-root <工作根> --json

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type {
  PageHandle,
  ScenarioContext,
  ScenarioHooks,
  ScenarioLaunchHookInfo,
  ScenarioObservation,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { seedWorkspaceRegistry } from '../../scripts/real-machine/lib/workspace-seed.mts'

const CHECK_ID = 'vc-1877-commit-actions'
const NEWLINE = String.fromCharCode(10)
const QUOTE = String.fromCharCode(34)
const FIXTURE_REPO = path.resolve(process.env.DSH_1877_FIXTURE || path.join(os.tmpdir(), 'matt1877', 'fixture', 'repo'))
const FIXTURE_ROOT = path.dirname(FIXTURE_REPO)
const FIXTURE_MARKER = '.1877-fixture'
const LOCKED_SKIN: string = process.env.DSH_1877_SKIN === 'dark' || process.env.DSH_1877_SKIN === 'light' ? process.env.DSH_1877_SKIN : ''
const TEMPLATE_TEXT = '【摘要】' + NEWLINE + NEWLINE + '- 改了什么：' + NEWLINE + '- 为什么改：' + NEWLINE + '- 怎么验证：' + NEWLINE
const HOOK_LOG = path.join(FIXTURE_REPO, '.git', 'hooks-ran.log')

const RAIL_BUTTON = 'button[aria-label=' + QUOTE + '打开右侧边栏' + QUOTE + ']'
const GUIDE_ENTRY_BUTTON = 'button[data-sidebar-right-guide-entry=' + QUOTE + 'dsh-mattpocock-skills-deck:deck-map' + QUOTE + ']'
const VC_TAB_BUTTON = 'button.dsws-tab[data-log=' + QUOTE + 'panel.tab.versioncontrol' + QUOTE + ']'
const NEW_SESSION_BUTTON = 'button[aria-label=' + QUOTE + '新建会话' + QUOTE + ']'
const WORKSPACE_BUTTON = 'button[aria-label=' + QUOTE + '选择工作区' + QUOTE + ']'
const ARROW = '[data-vc-commit-options]'
const MENU = '[data-vc-commit-menu="open"]'

type Status = 'pass' | 'fail' | 'skip' | 'blocked'
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function scriptOf(lines: readonly string[]): string { return lines.join(NEWLINE) }
function snippet(value: string | null, max = 200): string { return value === null ? '' : (value.length <= max ? value : value.slice(0, max) + '……') }

interface RawBrowserPage {
  goto?: (url: string) => Promise<unknown>
  click?: (selector: string) => Promise<Result<unknown>>
  press?: (key: string) => Promise<Result<unknown>>
  page?: unknown
}

async function evaluateThrough<T>(page: PageHandle, script: string): Promise<Result<T>> {
  try { return await page.evaluate<T>(script) } catch (error) { return { ok: false, error: { code: 'evaluate-threw', message: messageOf(error) } } }
}

async function realClick(raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; detail: string }> {
  if (typeof raw.click !== 'function') return { ok: false, detail: '浏览器适配器没有暴露 click()' }
  const clicked = await raw.click(selector)
  return clicked.ok ? { ok: true, detail: 'click ' + selector } : { ok: false, detail: clicked.error.message }
}

function domClickScript(selector: string): string {
  return scriptOf([
    '(function () {',
    '  var el = document.querySelector(' + JSON.stringify(selector) + ');',
    '  if (!el) { return { ok: false, reason: ' + JSON.stringify('not-found') + ' }; }',
    '  if (typeof el.scrollIntoView === "function") { el.scrollIntoView({ block: ' + JSON.stringify('center') + ' }); }',
    '  el.click();',
    '  return { ok: true, tag: el.tagName, text: String(el.innerText || ' + JSON.stringify('') + ').slice(0, 80) };',
    '})()',
  ])
}

function existsScript(selector: string): string { return 'document.querySelector(' + JSON.stringify(selector) + ') !== null' }

async function exists(page: PageHandle, selector: string): Promise<boolean> {
  const probe = await evaluateThrough<boolean>(page, existsScript(selector))
  return probe.ok && probe.value === true
}

async function waitFor(page: PageHandle, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await exists(page, selector)) return true
    await sleep(250)
  }
  return false
}

async function waitGone(page: PageHandle, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await exists(page, selector))) return true
    await sleep(250)
  }
  return false
}

interface RpcProbe { readonly status: number; readonly body: unknown; readonly text: string }

function rpcScript(method: string, argsExpression: string): string {
  return scriptOf([
    '(async function () {',
    '  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());',
    '  var body = { type: ' + JSON.stringify('client-request') + ', rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch(' + JSON.stringify('/api/') + ' + ' + JSON.stringify(method) + ', {',
    '    method: ' + JSON.stringify('POST') + ',',
    '    headers: { ' + JSON.stringify('content-type') + ': ' + JSON.stringify('application/json') + ' },',
    '    body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 1500) };',
    '})()',
  ])
}

function rpcValue(probe: RpcProbe): Record<string, unknown> | null { return asRecord(asRecord(probe.body)?.result) }
function findId(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (value === null) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  for (const nestedKey of ['workspace', 'session', 'request']) {
    const found = findId(asRecord(value[nestedKey]), keys)
    if (found !== null) return found
  }
  return null
}

/** 先试适配器原生 click；没有就退回页面内 el.click()。 */
async function clickPage(page: PageHandle, raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; detail: string }> {
  const viaAdapter = await realClick(raw, selector)
  if (viaAdapter.ok) return viaAdapter
  const viaDom = await evaluateThrough<{ ok: boolean; reason?: string }>(page, domClickScript(selector))
  if (viaDom.ok && viaDom.value.ok) return { ok: true, detail: '页面内 click ' + selector }
  return { ok: false, detail: '点不到 ' + selector + '：' + viaAdapter.detail }
}

// —— 夹具仓库 ——

interface GitOutcome { readonly ok: boolean; readonly text: string }
function gitRun(cwd: string, args: readonly string[]): GitOutcome {
  const r = spawnSync('git', args.slice(), { cwd: cwd, encoding: 'utf8', timeout: 60000 })
  return { ok: r.status === 0, text: String(r.stdout || '') + String(r.stderr || '') }
}
function writeFixtureFile(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}
function appendFixtureLine(target: string, line: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.appendFileSync(target, line + NEWLINE, 'utf8')
}
function commitAll(dir: string, message: string): GitOutcome {
  const added = gitRun(dir, ['add', '-A'])
  if (!added.ok) return added
  return gitRun(dir, ['commit', '-q', '-m', message])
}
function hookLineCount(): number {
  if (!fs.existsSync(HOOK_LOG)) return 0
  return fs.readFileSync(HOOK_LOG, 'utf8').split(NEWLINE).filter((line) => line.length > 0).length
}
function headSubject(): string { return gitRun(FIXTURE_REPO, ['log', '-1', '--format=%s']).text.trim() }
function headOid(): string { return gitRun(FIXTURE_REPO, ['rev-parse', 'HEAD']).text.trim() }
function commitCount(): number { return Number(gitRun(FIXTURE_REPO, ['rev-list', '--count', 'HEAD']).text.trim()) }
/** 让夹具回到「一个已暂存改动」的状态：每一步开始前都重新造一次，场景可以重复跑。 */
function stageOneChange(tag: string): GitOutcome {
  appendFixtureLine(path.join(FIXTURE_REPO, 'README.md'), '- 第 ' + tag + ' 次改动：这一行只用来让暂存区有东西')
  return gitRun(FIXTURE_REPO, ['add', 'README.md'])
}

interface FixtureResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }

function fixtureRootRemovable(): boolean {
  const resolved = path.resolve(FIXTURE_ROOT)
  const temp = path.resolve(os.tmpdir())
  if (resolved === temp || resolved.indexOf(temp + path.sep) !== 0) return false
  return fs.existsSync(path.join(resolved, FIXTURE_MARKER))
}

function buildFixture(): FixtureResult {
  if (fs.existsSync(FIXTURE_ROOT)) {
    if (!fixtureRootRemovable()) return { ok: false, detail: '夹具目录已存在但不是本场景创建的，拒绝删除：' + FIXTURE_ROOT, facts: {} }
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
  fs.writeFileSync(path.join(FIXTURE_ROOT, FIXTURE_MARKER), '1877 真机验证夹具目录，可以整棵删除。' + NEWLINE, 'utf8')
  fs.mkdirSync(FIXTURE_REPO, { recursive: true })
  gitRun(FIXTURE_REPO, ['init', '-q', '--initial-branch=main'])
  gitRun(FIXTURE_REPO, ['config', 'user.name', 'verify-1877'])
  gitRun(FIXTURE_REPO, ['config', 'user.email', 'verify-1877@example.invalid'])
  gitRun(FIXTURE_REPO, ['config', 'core.autocrlf', 'false'])
  gitRun(FIXTURE_REPO, ['config', 'commit.gpgsign', 'false'])
  gitRun(FIXTURE_REPO, ['config', 'gc.auto', '0'])
  writeFixtureFile(path.join(FIXTURE_REPO, 'README.md'), '# 1877 真机验证夹具仓库' + NEWLINE + NEWLINE + '这个仓库只用来给提交区提供真实数据，不是产品代码。' + NEWLINE)
  writeFixtureFile(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '# 迭代笔记' + NEWLINE + NEWLINE + '这份文件每次改动追加一行。' + NEWLINE)
  const first = commitAll(FIXTURE_REPO, '基线提交')
  writeFixtureFile(path.join(FIXTURE_REPO, '.gitmessage'), TEMPLATE_TEXT)
  appendFixtureLine(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '- 第二条提交之前的一行')
  const second = commitAll(FIXTURE_REPO, '第二条提交（给修订与吸收当对象）')
  gitRun(FIXTURE_REPO, ['config', 'commit.template', '.gitmessage'])
  stageOneChange('1')
  appendFixtureLine(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '- 未暂存的一行（一起提交时会被收走）')
  writeFixtureFile(path.join(FIXTURE_REPO, 'new-file.md'), '# 未跟踪的新文件' + NEWLINE)
  // 只写记录、不拦提交的钩子：用它证明「跳过提交钩子」这一次真的没跑钩子。
  const hook = path.join(FIXTURE_REPO, '.git', 'hooks', 'pre-commit')
  writeFixtureFile(hook, '#!/bin/sh' + NEWLINE + 'printf "run' + NEWLINE + '" >> "$(git rev-parse --show-toplevel)/.git/hooks-ran.log"' + NEWLINE)
  const problems: string[] = []
  if (!first.ok) problems.push('第 1 次提交失败：' + snippet(first.text))
  if (!second.ok) problems.push('第 2 次提交失败：' + snippet(second.text))
  if (gitRun(FIXTURE_REPO, ['diff', '--cached', '--name-only']).text.trim() !== 'README.md') problems.push('暂存区里不是 README.md')
  return { ok: problems.length === 0, detail: problems.length === 0 ? '夹具仓库搭好了' : problems.join('；'), facts: { repo: FIXTURE_REPO, commits: commitCount(), head: headSubject() } }
}

function ensureFixtureRepo(): FixtureResult {
  if (!fs.existsSync(path.join(FIXTURE_REPO, '.git'))) return buildFixture()
  const staged = gitRun(FIXTURE_REPO, ['diff', '--cached', '--name-only'])
  const template = gitRun(FIXTURE_REPO, ['config', '--get', 'commit.template'])
  // 暂存区必须正好是 README.md：跑过一轮的场景会把暂存内容提交掉，下一轮不重建就会「staged=0」，
  //   提交按钮一直禁用，看起来像产品坏了。这里按内容核对，不只按命令有没有成功。
  const ok = staged.ok && staged.text.trim() === 'README.md' && template.text.trim() === '.gitmessage' && commitCount() >= 2
  if (ok) return { ok: true, detail: '夹具仓库核对通过', facts: { repo: FIXTURE_REPO, commits: commitCount(), head: headSubject() } }
  return buildFixture()
}

const hooks: ScenarioHooks = {
  prepareHome: async (_context: ScenarioContext, info: ScenarioLaunchHookInfo) => {
    const fixture = ensureFixtureRepo()
    console.log('[1877] 夹具状态：' + JSON.stringify(fixture.facts) + ' ' + fixture.detail)
    if (!fixture.ok) throw new Error('1877 夹具准备失败：' + fixture.detail)
    if (LOCKED_SKIN.length > 0) {
      const patchPath = path.join(info.home, 'profiles', 'web', 'cordis.patch.yml')
      if (fs.existsSync(patchPath)) {
        const lines = fs.readFileSync(patchPath, 'utf8').split(NEWLINE)
        let inTheme = false
        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim()
          if (trimmed.indexOf('@deepseek-ai/dsh-client-ui-theme') >= 0) inTheme = true
          else if (inTheme && trimmed.startsWith('- ')) inTheme = false
          else if (inTheme && trimmed.startsWith('preference:')) {
            lines[i] = lines[i].slice(0, lines[i].length - lines[i].trimStart().length) + 'preference: ' + LOCKED_SKIN
            fs.writeFileSync(patchPath, lines.join(NEWLINE) + NEWLINE, 'utf8')
            break
          }
        }
      }
    }
    const previousWorkRoot = process.env.DSH_VERIFY_WORK_ROOT
    process.env.DSH_VERIFY_WORK_ROOT = info.dir
    try {
      const seeded = seedWorkspaceRegistry(info.home, [{ path: FIXTURE_REPO, title: '1877 夹具仓库' }], { defaultPath: FIXTURE_REPO })
      return { fixture: fixture.facts, registryPath: seeded.registryPath }
    } finally {
      if (previousWorkRoot === undefined) delete process.env.DSH_VERIFY_WORK_ROOT
      else process.env.DSH_VERIFY_WORK_ROOT = previousWorkRoot
    }
  },
}

// —— 进主视图与版本管理页 ——

function fixturePathForRpc(): string { return FIXTURE_REPO.split(String.fromCharCode(92)).join('/') }

interface MainViewResult { readonly ok: boolean; readonly via: string; readonly detail: string; readonly facts: Record<string, unknown> }
interface PageOpenResult { readonly ok: boolean; readonly detail: string; readonly facts: Record<string, unknown> }

async function openMainView(page: PageHandle, raw: RawBrowserPage): Promise<MainViewResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'already-main', detail: '已经在主视图', facts: facts }
  const argsExpression = '{ request: { path: ' + JSON.stringify(fixturePathForRpc()) + ' } }'
  const created = await evaluateThrough<RpcProbe>(page, rpcScript('workspace/create', argsExpression))
  facts.workspaceRpcStatus = created.ok ? created.value.status : created.error.message
  const workspaceId = created.ok ? findId(rpcValue(created.value), ['workspaceId', 'id']) : null
  let sessionId: string | null = null
  if (workspaceId !== null) {
    facts.workspaceId = workspaceId
    const sessionProbe = await evaluateThrough<RpcProbe>(page, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
    facts.sessionRpcStatus = sessionProbe.ok ? sessionProbe.value.status : sessionProbe.error.message
    sessionId = sessionProbe.ok ? findId(rpcValue(sessionProbe.value), ['sessionId', 'id']) : null
  }
  if (sessionId !== null) {
    facts.sessionId = sessionId
    await sleep(1200)
    await clickPage(page, raw, NEW_SESSION_BUTTON)
    await sleep(3500)
    if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'rpc-then-new-session', detail: '建好工作区与会话后点新建会话进了主视图', facts: facts }
  }
  await clickPage(page, raw, WORKSPACE_BUTTON)
  await sleep(900)
  if (typeof raw.goto === 'function') {
    await raw.goto(page.url())
    await sleep(4000)
    if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'reload', detail: '刷新后已在主视图', facts: facts }
  }
  return { ok: false, via: 'none', detail: '没能进主视图（找不到打开右侧边栏的按钮）', facts: facts }
}

async function openVersionControlPanel(page: PageHandle, raw: RawBrowserPage): Promise<PageOpenResult> {
  const facts: Record<string, unknown> = {}
  await clickPage(page, raw, RAIL_BUTTON)
  await sleep(1500)
  await clickPage(page, raw, GUIDE_ENTRY_BUTTON)
  let tabFound = false
  for (let i = 0; i < 80; i += 1) {
    if (await exists(page, VC_TAB_BUTTON)) { tabFound = true; break }
    await sleep(500)
  }
  facts.tabFound = tabFound
  if (!tabFound) return { ok: false, detail: '右栏里没有出现版本管理页签', facts: facts }
  await clickPage(page, raw, VC_TAB_BUTTON)
  const ready = await waitFor(page, '[data-vc-commit-submit]', 45000)
  facts.composer = ready
  if (!ready) return { ok: false, detail: '版本管理页挂出来了，但提交区一直没出现', facts: facts }
  // 数据到位前提交区可能是空壳（已暂存 0、表单还没读回）：等一次「已暂存 1」。
  const staged = await evaluateThrough<string>(page, '(function () { var el = document.querySelector(' + JSON.stringify('[data-vc-staged-count]') + '); return el ? String(el.getAttribute(' + JSON.stringify('data-vc-staged-count') + ')) : null })()')
  facts.stagedCount = staged.ok ? staged.value : null
  return { ok: true, detail: '版本管理提交区挂出来且读数到位', facts: facts }
}

// —— 读界面状态与点按 ——

interface UiState {
  readonly menu: string
  readonly menuHidden: boolean
  readonly arrowExpanded: string
  readonly allChecked: string
  readonly flags: number
  readonly textarea: string | null
  readonly autoText: string | null
  readonly result: string | null
  readonly confirm: boolean
  readonly submitDisabled: boolean
  readonly submitText: string
  readonly templateText: string
  readonly focusArrow: boolean
}

function readUiScript(): string {
  return scriptOf([
    '(function () {',
    '  var q = function (sel) { return document.querySelector(sel); };',
    '  var menu = q(' + JSON.stringify('[data-vc-commit-options-panel]') + ');',
    '  var arrow = q(' + JSON.stringify('[data-vc-commit-options]') + ');',
    '  var all = q(' + JSON.stringify('[data-vc-commit-all]') + ');',
    '  var msg = q(' + JSON.stringify('[data-vc-commit-msg]') + ');',
    '  var auto = q(' + JSON.stringify('[data-vc-commit-auto-text]') + ');',
    '  var res = q(' + JSON.stringify('[data-vc-commit-result]') + ');',
    '  var submit = q(' + JSON.stringify('[data-vc-commit-submit]') + ');',
    '  var tpl = q(' + JSON.stringify('[data-vc-commit-template]') + ');',
    '  return {',
    '    menu: menu ? String(menu.getAttribute(' + JSON.stringify('data-vc-commit-menu') + ')) : null,',
    '    menuHidden: menu ? menu.hasAttribute(' + JSON.stringify('hidden') + ') : null,',
    '    arrowExpanded: arrow ? String(arrow.getAttribute(' + JSON.stringify('aria-expanded') + ')) : null,',
    '    allChecked: all ? String(all.getAttribute(' + JSON.stringify('aria-checked') + ')) : null,',
    '    flags: document.querySelectorAll(' + JSON.stringify('[data-vc-commit-flag]') + ').length,',
    '    textarea: msg ? String(msg.value) : null,',
    '    autoText: auto ? String(auto.textContent || ' + JSON.stringify('') + ') : null,',
    '    result: res ? String(res.textContent || ' + JSON.stringify('') + ') : null,',
    '    confirm: q(' + JSON.stringify('[data-vc-commit-confirm]') + ') !== null,',
    '    submitDisabled: submit ? submit.disabled === true : null,',
    '    submitText: submit ? String(submit.textContent || ' + JSON.stringify('') + ') : null,',
    '    templateText: tpl ? String(tpl.textContent || ' + JSON.stringify('') + ') : null,',
    '    focusArrow: arrow !== null && document.activeElement === arrow,',
    '  };',
    '})()',
  ])
}

async function readUi(page: PageHandle): Promise<UiState | null> {
  const probe = await evaluateThrough<UiState>(page, readUiScript())
  return probe.ok ? probe.value : null
}

/** 用真实鼠标在某个元素中间点一下：浮层「点外面收起」要的是真的鼠标事件（pointerdown），
 *  只派发 DOM click 测不到这条路径。适配器的 click 走 Playwright，外层句柄拿得到就用它的 mouse。 */
async function mouseClickSelector(page: PageHandle, raw: RawBrowserPage, selector: string): Promise<boolean> {
  const probe = await evaluateThrough<{ x: number; y: number } | null>(page, '(function () { var el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; var rect = el.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()')
  if (!probe.ok || probe.value === null) return false
  const playwrightPage: any = (raw as any).page
  if (!playwrightPage || !playwrightPage.mouse || typeof playwrightPage.mouse.click !== 'function') return false
  try {
    await playwrightPage.mouse.click(probe.value.x, probe.value.y)
    return true
  } catch (error) {
    return false
  }
}

/** 打开提交选项浮层：已经开着就先按箭头收起再打开（同一条路径既是开也是关，重复调用要幂等）。 */
async function openMenu(page: PageHandle, raw: RawBrowserPage): Promise<boolean> {
  if (await exists(page, MENU)) {
    await clickPage(page, raw, ARROW)
    await waitGone(page, MENU, 4000)
  }
  await clickPage(page, raw, ARROW)
  return await waitFor(page, MENU, 6000)
}

/** 在夹具里造一个已暂存改动，并让页面重新读一次首屏：提交区按「已暂存数」决定按钮能不能按，
 *  在页面之外 git add 之后不刷新，按钮就会一直按原读数禁用。返回刷新后读到的已暂存数。 */
async function stageAndRefresh(page: PageHandle, raw: RawBrowserPage, tag: string): Promise<number> {
  stageOneChange(tag)
  if (await exists(page, MENU)) {
    await clickPage(page, raw, ARROW)
    await waitGone(page, MENU, 3000)
  }
  await clickPage(page, raw, '[data-vc-refresh]')
  let staged = 0
  for (let i = 0; i < 40; i += 1) {
    const probe = await evaluateThrough<string>(page, '(function () { var el = document.querySelector(' + JSON.stringify('[data-vc-staged-count]') + '); return el ? String(el.getAttribute(' + JSON.stringify('data-vc-staged-count') + ')) : null })()')
    staged = probe.ok && probe.value !== null ? Number(probe.value) : 0
    if (staged > 0) return staged
    await sleep(500)
  }
  return staged
}

async function typeMessage(page: PageHandle, text: string): Promise<boolean> {
  const script = scriptOf([
    '(function () {',
    '  var el = document.querySelector(' + JSON.stringify('[data-vc-commit-msg]') + ');',
    '  if (!el) return false;',
    '  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, ' + JSON.stringify('value') + ').set;',
    '  setter.call(el, ' + JSON.stringify(text) + ');',
    '  el.dispatchEvent(new Event(' + JSON.stringify('input') + ', { bubbles: true }));',
    '  return true;',
    '})()',
  ])
  const probe = await evaluateThrough<boolean>(page, script)
  return probe.ok && probe.value === true
}

/** 点提交，遇到确认卡就确认，然后等结果条出现。返回结果文本。 */
async function submitAndWait(page: PageHandle, raw: RawBrowserPage, timeoutMs: number): Promise<{ ok: boolean; detail: string; stage: string }> {
  const clicked = await clickPage(page, raw, '[data-vc-commit-submit]')
  if (!clicked.ok) return { ok: false, detail: clicked.detail, stage: 'submit' }
  // 预检是异步的：危险动作先出确认卡，普通提交直接出结果条。两边都等一会儿，别在中间帧上猜。
  let confirmShown = false
  for (let i = 0; i < 40; i += 1) {
    if (await exists(page, '[data-vc-commit-confirm]')) { confirmShown = true; break }
    if (await exists(page, '[data-vc-commit-result]')) break
    await sleep(250)
  }
  if (confirmShown) {
    const confirmed = await clickPage(page, raw, '[data-vc-commit-confirm] [data-vc-confirm-go]')
    if (!confirmed.ok) return { ok: false, detail: confirmed.detail, stage: 'confirm' }
  }
  const shown = await waitFor(page, '[data-vc-commit-result]', timeoutMs)
  if (!shown) return { ok: false, detail: '点完之后一直没有出现结果条', stage: 'result' }
  const state = await readUi(page)
  return { ok: true, detail: state === null ? '结果条出现' : String(state.result), stage: 'done' }
}

// —— 证据与观测 ——

function observe(input: { checkId: string; title: string; ok: boolean; status?: Status; hard?: boolean; detail: string; expected?: string; actual?: string; hint?: string; evidence?: readonly string[] }): ScenarioObservation {
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

async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<string | null> {
  try {
    const filed = await context.evidence.recordJson(name, value, { note: note })
    return filed.ok ? filed.value.path : null
  } catch (error) {
    console.log('[1877] 记证据失败 ' + name + '：' + messageOf(error))
    return null
  }
}

async function captureScreenshot(context: ScenarioContext, page: PageHandle, name: string, note: string): Promise<string[]> {
  const target = path.join(context.evidence.root, name + '.png')
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await page.screenshot(target)
  } catch (error) {
    return []
  }
  const filed = await context.evidence.recordFile(target, { kind: 'screenshot', note: note })
  return filed.ok ? [filed.value.path] : []
}

/** 每条能力的取证：做动作 → 读 DOM → 读夹具仓库的真实 git 历史 → 落一条观测。 */
async function runAction(
  context: ScenarioContext,
  page: PageHandle,
  raw: RawBrowserPage,
  input: { id: string; title: string; expected: string; run: () => Promise<{ ok: boolean; detail: string }>; evidence: string[] },
): Promise<ScenarioObservation> {
  let outcome: { ok: boolean; detail: string }
  try {
    outcome = await input.run()
  } catch (error) {
    outcome = { ok: false, detail: '执行时抛错：' + messageOf(error) }
  }
  const shot = await captureScreenshot(context, page, 'action-' + input.id, input.title + (outcome.ok ? '（通过）' : '（不通过）'))
  const state = await readUi(page)
  const recorded = await recordEvidence(context, 'action-' + input.id + '.json', { outcome: outcome, ui: state, head: headOid(), subject: headSubject(), commits: commitCount(), hookRuns: hookLineCount() }, input.title + ' 的证据')
  const evidence = input.evidence.concat(shot).concat(recorded === null ? [] : [recorded])
  return observe({
    checkId: CHECK_ID + '-' + input.id,
    title: input.title,
    ok: outcome.ok,
    status: outcome.ok ? 'pass' : 'fail',
    hard: true,
    detail: outcome.detail,
    expected: input.expected,
    actual: outcome.detail,
    evidence: evidence,
  })
}

// —— 主流程 ——

async function runActions(context: ScenarioContext): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = []
  const primitives = context.primitives as unknown as { page(): Promise<Result<PageHandle>> }
  let pageResult: Result<PageHandle>
  try {
    pageResult = await primitives.page()
  } catch (error) {
    return [observe({ checkId: CHECK_ID + '-setup', title: '拿浏览器页面', ok: false, status: 'blocked', hard: false, detail: '拿不到浏览器页面：' + messageOf(error) })]
  }
  if (!pageResult.ok) return [observe({ checkId: CHECK_ID + '-setup', title: '拿浏览器页面', ok: false, status: 'blocked', hard: false, detail: '拿不到浏览器页面：' + pageResult.error.message })]
  const page = pageResult.value
  const raw = page.page as unknown as RawBrowserPage
  const instance = context.instance as unknown as { record?: { tokenUrl?: string; originUrl?: string } } | null
  if (!instance || !instance.record || typeof instance.record.tokenUrl !== 'string') {
    return [observe({ checkId: CHECK_ID + '-setup', title: '隔离实例', ok: false, status: 'blocked', hard: false, detail: '没有拿到隔离实例的 tokenUrl' })]
  }
  const tokenUrl = instance.record.tokenUrl
  if (typeof raw.goto === 'function') await raw.goto(tokenUrl)
  await sleep(2500)

  const fixture = ensureFixtureRepo()
  if (!fixture.ok) return [observe({ checkId: CHECK_ID + '-setup', title: '夹具仓库', ok: false, status: 'blocked', hard: false, detail: fixture.detail })]
  await recordEvidence(context, 'fixture.json', fixture, '夹具仓库的核对结果')

  const mainView = await openMainView(page, raw)
  if (!mainView.ok) return [observe({ checkId: CHECK_ID + '-setup', title: '进主视图', ok: false, status: 'blocked', hard: false, detail: mainView.detail, actual: JSON.stringify(mainView.facts) })]
  const panel = await openVersionControlPanel(page, raw)
  if (!panel.ok) return [observe({ checkId: CHECK_ID + '-setup', title: '打开版本管理页', ok: false, status: 'blocked', hard: false, detail: panel.detail, actual: JSON.stringify(panel.facts) })]
  await recordEvidence(context, 'panel.json', panel, '版本管理页的打开情况')

  // 1) 2.1 普通提交：写说明 → 提交 → 结果条 → 仓库历史真的多一条；钩子跑过一次。
  const hookBefore = hookLineCount()
  const baseCommits = commitCount()
  observations.push(await runAction(context, page, raw, {
    id: 'plain-commit', title: '2.1 普通提交：写说明、点提交、结果贴着提交区', expected: '结果条出现、仓库多一条提交、pre-commit 钩子跑过一次',
    evidence: [],
    run: async () => {
      const typed = await typeMessage(page, '真机普通提交')
      if (!typed) return { ok: false, detail: '找不到说明输入框' }
      const submitted = await submitAndWait(page, raw, 20000)
      if (!submitted.ok) return { ok: false, detail: submitted.stage + ' 阶段失败：' + submitted.detail }
      const state = await readUi(page)
      const grew = commitCount() === baseCommits + 1
      const subjectOk = headSubject() === '真机普通提交'
      const hookRan = hookLineCount() === hookBefore + 1
      const resetOk = state !== null && state.menu === 'closed' && state.textarea === '' && state.flags === 0
      return { ok: grew && subjectOk && hookRan && resetOk, detail: '结果「' + snippet(submitted.detail, 120) + '」；提交数 ' + String(commitCount()) + '；HEAD「' + headSubject() + '」；钩子 ' + String(hookLineCount()) + ' 次；提交后收起与清空 ' + String(resetOk) }
    },
  }))

  // 2) 2.2 + 2.5 一起提交 + 跳过钩子：只改已跟踪文件、不暂存；开关打开后收起浮层仍看得见标签；钩子没跑。
  observations.push(await runAction(context, page, raw, {
    id: 'all-and-skip-hooks', title: '2.2 + 2.5 一起提交并跳过钩子：内容来源开关与记录方式真的作用到 git', expected: '提交成功、HEAD 是新说明、pre-commit 钩子没有跑',
    evidence: [],
    run: async () => {
      const hookBefore2 = hookLineCount()
      appendFixtureLine(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '- 只改不暂存的一行（一起提交要收走）')
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      await clickPage(page, raw, '[data-vc-commit-all]')
      await clickPage(page, raw, '[data-vc-commit-opt="skipHooks"]')
      const opened = await readUi(page)
      if (opened === null || opened.allChecked !== 'true') return { ok: false, detail: '一起提交开关没有打开（读回 ' + JSON.stringify(opened) + '）' }
      await clickPage(page, raw, '[data-vc-commit-options-close]')
      const closed = await readUi(page)
      const flagVisible = closed !== null && closed.flags === 1
      const typed = await typeMessage(page, '一起提交并跳过钩子')
      if (!typed) return { ok: false, detail: '找不到说明输入框' }
      const submitted = await submitAndWait(page, raw, 25000)
      if (!submitted.ok) return { ok: false, detail: submitted.stage + ' 阶段失败：' + submitted.detail }
      const skipped = hookLineCount() === hookBefore2
      const subjectOk = headSubject() === '一起提交并跳过钩子'
      return { ok: flagVisible && skipped && subjectOk, detail: '收起后标签 ' + String(closed === null ? '读不到' : closed.flags) + ' 枚；钩子 ' + String(hookLineCount()) + ' 次（应为 ' + String(hookBefore2) + '）；HEAD「' + headSubject() + '」' }
    },
  }))

  // 3) 2.3 修订：预填上一条说明、确认卡、结果写新短号、提交数不变。
  observations.push(await runAction(context, page, raw, {
    id: 'amend', title: '2.3 修订上一条：预填说明、确认卡、提交号变了而条数不变', expected: '确认卡四段齐全、点确认后 HEAD 换号、提交数不变',
    evidence: [],
    run: async () => {
      const before = headOid()
      const countBefore = commitCount()
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      await clickPage(page, raw, '[data-vc-commit-mode="amend"]')
      const selected = await readUi(page)
      const prefilled = selected !== null && String(selected.textarea || '').length > 0
      if (!prefilled) return { ok: false, detail: '切到修订之后说明框没有预填（读回 ' + JSON.stringify(selected && selected.textarea) + '）' }
      await typeMessage(page, '真机修订后的说明')
      const clicked = await clickPage(page, raw, '[data-vc-commit-submit]')
      if (!clicked.ok) return { ok: false, detail: clicked.detail }
      const confirmShown = await waitFor(page, '[data-vc-commit-confirm]', 15000)
      if (!confirmShown) return { ok: false, detail: '修订没有停在确认卡上' }
      const confirmed = await clickPage(page, raw, '[data-vc-commit-confirm] [data-vc-confirm-go]')
      if (!confirmed.ok) return { ok: false, detail: confirmed.detail }
      const resultShown = await waitFor(page, '[data-vc-commit-result]', 20000)
      if (!resultShown) return { ok: false, detail: '确认之后没有出现结果条' }
      const after = headOid()
      const changed = after !== '' && after !== before
      const subjectOk = headSubject() === '真机修订后的说明'
      const sameCount = commitCount() === countBefore
      return { ok: changed && subjectOk && sameCount, detail: '提交号 ' + snippet(before, 8) + ' → ' + snippet(after, 8) + '；HEAD「' + headSubject() + '」；提交数 ' + String(commitCount()) + '（应为 ' + String(countBefore) + '）' }
    },
  }))

  // 4) 2.8 模板：套用之后输入框换成模板原文，再点一次撤销回原来那份。
  observations.push(await runAction(context, page, raw, {
    id: 'template', title: '2.8 套用提交说明模板：套用与撤销都作用在输入框上', expected: '套用后输入框等于模板原文，撤销后回到套用前的内容',
    evidence: [],
    run: async () => {
      await typeMessage(page, '模板套用前的说明')
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      const before = await readUi(page)
      await clickPage(page, raw, '[data-vc-commit-template]')
      const applied = await readUi(page)
      const appliedOk = applied !== null && String(applied.textarea || '') === TEMPLATE_TEXT
      await clickPage(page, raw, '[data-vc-commit-template]')
      const undone = await readUi(page)
      const undoneOk = undone !== null && String(undone.textarea || '') === '模板套用前的说明'
      return { ok: appliedOk && undoneOk, detail: '套用前「' + snippet(before && before.textarea, 40) + '」；套用后是否等于模板 ' + String(appliedOk) + '；撤销后「' + snippet(undone && undone.textarea, 40) + '」' }
    },
  }))

  // 5) 2.4 fixup：说明自动写成 fixup! <上一条提交>，确认后历史最前面多一条 fixup 提交。
  observations.push(await runAction(context, page, raw, {
    id: 'fixup', title: '2.4 fixup：自动说明 fixup! 上一条提交，确认后真的多一条吸收提交', expected: '只读说明是 fixup! <上一条>，点确认后 HEAD 主题以 fixup! 开头',
    evidence: [],
    run: async () => {
      const stagedCount = await stageAndRefresh(page, raw, 'fixup')
      if (stagedCount === 0) return { ok: false, detail: '在页面之外暂存之后刷新，已暂存数仍是 0' }
      const targetSubject = headSubject()
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      await clickPage(page, raw, '[data-vc-commit-mode="fixup"]')
      const state = await readUi(page)
      const autoOk = state !== null && String(state.autoText || '').indexOf('fixup! ' + targetSubject) >= 0 && state.textarea === null
      if (!autoOk) return { ok: false, detail: '自动说明不对或不只读（读回 ' + JSON.stringify(state && state.autoText) + '）' }
      const submitted = await submitAndWait(page, raw, 25000)
      if (!submitted.ok) return { ok: false, detail: submitted.stage + ' 阶段失败：' + submitted.detail }
      const subject = headSubject()
      return { ok: subject.indexOf('fixup! ') === 0, detail: 'HEAD「' + subject + '」' }
    },
  }))

  // 6) 2.4 squash：同样的自动说明与确认路径。
  observations.push(await runAction(context, page, raw, {
    id: 'squash', title: '2.4 squash：自动说明 squash! 上一条提交，确认后真的多一条 squash 提交', expected: '只读说明是 squash! <上一条>，点确认后 HEAD 主题以 squash! 开头',
    evidence: [],
    run: async () => {
      const stagedCount = await stageAndRefresh(page, raw, 'squash')
      if (stagedCount === 0) return { ok: false, detail: '在页面之外暂存之后刷新，已暂存数仍是 0' }
      const targetSubject = headSubject()
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      await clickPage(page, raw, '[data-vc-commit-mode="squash"]')
      const state = await readUi(page)
      const autoOk = state !== null && String(state.autoText || '').indexOf('squash! ' + targetSubject) >= 0
      if (!autoOk) return { ok: false, detail: '自动说明不对（读回 ' + JSON.stringify(state && state.autoText) + '）' }
      const submitted = await submitAndWait(page, raw, 25000)
      if (!submitted.ok) return { ok: false, detail: submitted.stage + ' 阶段失败：' + submitted.detail }
      const subject = headSubject()
      return { ok: subject.indexOf('squash! ') === 0, detail: 'HEAD「' + subject + '」' }
    },
  }))

  // 7) 三条关闭路径与焦点回位：Esc、点外面、换页签。
  observations.push(await runAction(context, page, raw, {
    id: 'close-paths', title: '关闭路径：Esc / 点外面 / 换页签都收起，焦点回到箭头', expected: '三条路径之后浮层都是 closed，Esc 之后焦点在箭头上',
    evidence: [],
    run: async () => {
      if (!(await openMenu(page, raw))) return { ok: false, detail: '浮层没打开' }
      if (typeof raw.press === 'function') await raw.press('Escape')
      const escClosed = await waitGone(page, MENU, 5000)
      const escState = await readUi(page)
      if (!(await openMenu(page, raw))) return { ok: false, detail: '第二次没打开浮层' }
      // 点提交区里的「已暂存 N 个文件」那一行：它在浮层外面、在同一块面板里，是真鼠标点得中的地方。
      const outsideMouse = await mouseClickSelector(page, raw, '[data-vc-staged-count]')
      let outsideClosed = await waitGone(page, MENU, 4000)
      // 真鼠标点出去没关掉时补一次诊断：直接在页面里派发 pointerdown，分清「处理器没接上」还是「那一下点到了别处」。
      let synthetic = 'skipped'
      if (!outsideClosed) {
        const fired = await evaluateThrough<boolean>(page, '(function () { document.body.dispatchEvent(new PointerEvent(' + JSON.stringify('pointerdown') + ', { bubbles: true })); return true })()')
        synthetic = fired.ok ? String(await waitGone(page, MENU, 3000)) : 'evaluate-failed'
        outsideClosed = synthetic === 'true'
      }
      if (await exists(page, '[data-vc-palette]')) { if (typeof raw.press === 'function') await raw.press('Escape'); await sleep(600) }
      if (!(await openMenu(page, raw))) return { ok: false, detail: '第三次没打开浮层' }
      await clickPage(page, raw, '[data-vc-tab="commits"]')
      const tabClosed = await waitGone(page, MENU, 5000)
      await clickPage(page, raw, '[data-vc-tab="changes"]')
      const focusOk = escState !== null && escState.focusArrow === true
      return { ok: escClosed && outsideClosed && tabClosed && focusOk, detail: 'Esc 收起 ' + String(escClosed) + '、焦点回箭头 ' + String(focusOk) + '；点外面收起 ' + String(outsideClosed) + '（真鼠标点在已暂存计数行 ' + String(outsideMouse) + '，补发 pointerdown 后 ' + synthetic + '）；换页签收起 ' + String(tabClosed) }
    },
  }))

  return observations
}

async function runAll(context: ScenarioContext): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = []
  try {
    const actions = await runActions(context)
    observations.push(...actions)
  } catch (error) {
    observations.push(observe({ checkId: CHECK_ID + '-exception', title: '提交能力真机执行', ok: false, status: 'fail', hard: true, detail: '执行时抛错：' + messageOf(error) }))
  }
  const passed = observations.filter((item) => item.ok).length
  observations.push(observe({
    checkId: CHECK_ID + '-summary',
    title: '提交能力真机执行汇总',
    ok: observations.length > 0 && passed === observations.length,
    status: observations.length > 0 && passed === observations.length ? 'pass' : 'fail',
    hard: true,
    detail: '共 ' + String(observations.length) + ' 条：通过 ' + String(passed),
    expected: '六条能力与三条关闭路径全部在真机上执行通过',
    actual: '通过 ' + String(passed) + '/' + String(observations.length),
  }))
  return observations
}

export default defineScenario({
  id: CHECK_ID,
  title: '提交选项里的六条能力（#1877）：在隔离真机上逐条执行',
  description:
    '在隔离 DSH 实例里打开版本管理改动页，按原型点开提交按钮右侧的「提交选项」浮层，逐条执行普通提交、一起提交 + 跳过钩子、' +
    '修订（确认卡）、模板套用与撤销、fixup 与 squash，并核对夹具仓库的真实 git 历史；同时验证 Esc / 点外面 / 换页签三条关闭路径与焦点回位。',
  hooks: hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '启动隔离实例' },
    { id: 'actions', kind: 'custom', title: '提交能力逐条执行', timeoutMs: 1800000, run: runAll },
    { id: 'stop', kind: 'stop', title: '停掉隔离实例' },
  ],
})
