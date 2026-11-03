// verify/scenarios/1860-vc-shell.ts —— 真机验证 #1860：版本管理首屏（身份行 + 四页签 + 四页签正文）。
//
// 这个场景在隔离实例里跑，不碰真实 DSH 主目录：隔离 home 由批次流程复制，prepareHome 只改副本里的文件。
// 夹具仓库在仓库外（默认 <TEMP>/matt1860/fixture/dsh-mattpocock-skills-deck），第一次运行时自动创建，
// 形状对齐 docs/prototype/vc-redesign/src/data/ 的演示数据：
//   50 条提交（其中 1 个合并提交）、11 个未提交改动（2 个已跟踪修改：+2/−2 与 +23/−1，9 个未跟踪）、
//   1 条储藏、origin 领先 2 落后 0、当前工作区 + 59 棵其他工作树；
//   .git/logs/refs/remotes/origin/main 末条时间戳改成 now−720 秒，让身份行的「远端 origin」读成 12 分钟前。
//
// 跑法（有头）：
//   $env:DSH_HOME = <批次 home>
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js run verify/scenarios/1860-vc-shell.ts --profile web --declaration verify/profile-1833-headed.ts --work-root <工作根> --json
//
// 四档宽用两种办法按顺序试，命中判据都是壳根的 data-vc-width 恰好等于目标档：
//   1. 拖右栏把手：先把窗口拉到够宽，再按「实测档位 − 目标档」真实拖 div[data-side="rightbar"]，最多 8 轮；
//   2. 退回窗口反解：适配器的 raw.resize 改窗口内宽，面板宽随之分段线性变化，最多 16 轮。
// 两条都拿不到就记 blocked 并写实际面板宽，不伪造。无头适配器没有窗口 resize 也没有鼠标，宽度那部分一律记 blocked。
//
// 可调环境变量：
//   DSH_1860_FIXTURE        夹具仓库（默认 <系统临时目录>/matt1860/fixture/dsh-mattpocock-skills-deck）
//   DSH_1860_WIDTHS         宽度清单，默认 300,380,460,520
//   DSH_1860_SKIN           启动前把皮肤锁成 dark 或 light（改隔离 home 的 ui-theme 偏好）。锁了就只验这一种，
//                           皮肤清单自动跟着它走——一种皮肤一个实例是最可靠的口径
//   DSH_1860_SKINS          皮肤清单，默认跟着 DSH_1860_SKIN，没锁过就是 dark,light
//   DSH_1860_QUICK          1 = 只跑第一档宽与第一种皮肤，先给四页拍基线
//
// 为什么推荐一次只验一种皮肤：2026-11-04 实测，运行中改 ui-theme 偏好会让宿主重载客户端，重载后版本管理页签
// 回到「分离头指针 / 数字全是 —」的空壳；改成先重载再按启动路径重新进页面之后，light→dark 能成，dark→light
// 又会被回滚成 dark（设置写进去了，重载后读回来还是旧值）。所以整轮取证用 DSH_1860_SKIN 一种皮肤起一个实例，
// 运行中切皮肤只当兜底，切不过去就如实记 blocked。
//   DSH_1860_WINDOW_HEIGHT  有头窗口高度，默认 900
//   DSH_1860_WORKTREES      其他工作树数量，默认 59（建太慢可调小，场景照实数记）

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

const CHECK_ID = 'vc-1860-shell'
const NEWLINE = String.fromCharCode(10)
const QUOTE = String.fromCharCode(34)
const MINUS_SIGN = String.fromCharCode(8722)

/** 夹具仓库：默认放在系统临时目录下，绝不能落进仓库或真实 DSH 主目录。 */
const FIXTURE_REPO = path.resolve(process.env.DSH_1860_FIXTURE || path.join(os.tmpdir(), 'matt1860', 'fixture', 'dsh-mattpocock-skills-deck'))
/** 夹具根目录：仓库、裸远端与工作树都放在它下面，重建时整棵删掉。 */
const FIXTURE_ROOT = path.dirname(FIXTURE_REPO)
const ORIGIN_BARE = path.join(FIXTURE_ROOT, 'origin.git')
const WORKTREE_ROOT = path.join(FIXTURE_ROOT, 'worktrees')
const FIXTURE_MARKER = '.1860-fixture'

type ViewName = 'changes' | 'commits' | 'worktrees' | 'stash'
const VIEWS: ViewName[] = ['changes', 'commits', 'worktrees', 'stash']
const VIEW_TITLES: Record<ViewName, string> = {
  changes: '改动',
  commits: '提交历史',
  worktrees: '工作区',
  stash: '储藏',
}
const QUICK = process.env.DSH_1860_QUICK === '1'
const WIDTHS = String(process.env.DSH_1860_WIDTHS || '300,380,460,520')
  .split(',')
  .map((piece) => Number(piece.trim()))
  .filter((width): width is number => Number.isFinite(width) && width >= 260 && width <= 640)
type Skin = 'dark' | 'light'
/** 启动前锁定的皮肤；锁了就只验这一种，不再在运行中切。 */
const LOCKED_SKIN: string = process.env.DSH_1860_SKIN === 'dark' || process.env.DSH_1860_SKIN === 'light' ? process.env.DSH_1860_SKIN : ''
const SKINS = String(process.env.DSH_1860_SKINS || (LOCKED_SKIN.length > 0 ? LOCKED_SKIN : 'dark,light'))
  .split(',')
  .map((piece) => piece.trim())
  .filter((skin): skin is Skin => skin === 'dark' || skin === 'light')
const WINDOW_HEIGHT = Number(process.env.DSH_1860_WINDOW_HEIGHT || '900')
const WORKTREE_COUNT = Math.max(0, Math.min(80, Number(process.env.DSH_1860_WORKTREES || '59')))
const EXPECTED_CHANGES = 11
const EXPECTED_TRACKED = 2
const EXPECTED_UNTRACKED = 9
const EXPECTED_COMMITS = 50
const EXPECTED_MERGES = 1
const EXPECTED_STASH = 1
const AHEAD = 2
const BEHIND = 0
const BASIS_SECONDS_AGO = 720

/** 两个已跟踪修改的行数差：数据与 docs/prototype/vc-redesign/src/data/screen.ts 的 WORKING_CHANGES 对齐。 */
const TRACKED_DELTAS: { path: string; add: string; del: string }[] = [
  { path: 'src/client/views/shared/workRouteTable.ts', add: '+2', del: MINUS_SIGN + '2' },
  { path: 'src/refresh/rooms/host/outbound-admission.ts', add: '+23', del: MINUS_SIGN + '1' },
]
/** 未跟踪清单里最长的一条（46 个字符），用来验长路径的折行。 */
const LONGEST_UNTRACKED_PATH = 'docs/review/20261025-spec-complete-prompt-review.html'

type Status = 'pass' | 'fail' | 'skip' | 'blocked'
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const CLOSE_BUTTON = 'button[aria-label=' + QUOTE + '关闭' + QUOTE + ']'
const WORKSPACE_BUTTON = 'button[aria-label=' + QUOTE + '选择工作区' + QUOTE + ']'
const RAIL_BUTTON = 'button[aria-label=' + QUOTE + '打开右侧边栏' + QUOTE + ']'
const NEW_SESSION_BUTTON = 'button[aria-label=' + QUOTE + '新建会话' + QUOTE + ']'
const GUIDE_ENTRY_BUTTON = 'button[data-sidebar-right-guide-entry=' + QUOTE + 'dsh-mattpocock-skills-deck:deck-map' + QUOTE + ']'
const VC_TAB_BUTTON = 'button.dsws-tab[data-log=' + QUOTE + 'panel.tab.versioncontrol' + QUOTE + ']'
const LIST_TAB_BUTTON = 'button.dsws-tab[data-log=' + QUOTE + 'panel.tab.list' + QUOTE + ']'
const VC_ROOT_SELECTOR = '[data-vc-root]'
const BODY_DARK_SCRIPT = 'document.body.hasAttribute(' + QUOTE + 'data-ds-dark-theme' + QUOTE + ')'
const PASSWORD_INPUT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('input[type=password]') + ').length'
const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*=' + QUOTE + '_mask_' + QUOTE + ']') + ').length'

function tabButtonSelector(view: ViewName): string {
  return 'button[data-vc-tab=' + QUOTE + view + QUOTE + ']'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scriptOf(lines: readonly string[]): string {
  return lines.join(NEWLINE)
}

function snippet(value: string | null, max = 200): string {
  if (value === null) return ''
  return value.length <= max ? value : value.slice(0, max) + '……'
}

interface RawBrowserPage {
  goto?: (url: string) => Promise<unknown>
  click?: (selector: string) => Promise<Result<unknown>>
  press?: (key: string) => Promise<Result<unknown>>
  preset?: (id: string) => Promise<Result<unknown>>
  resize?: (width: number, height: number) => Promise<Result<unknown>>
  measureWindow?: () => Promise<Result<unknown>>
  page?: unknown
}

async function evaluateThrough<T>(page: PageHandle, script: string): Promise<Result<T>> {
  try {
    return await page.evaluate<T>(script)
  } catch (error) {
    return { ok: false, error: { code: 'evaluate-threw', message: messageOf(error) } }
  }
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

function existsScript(selector: string): string {
  return 'document.querySelector(' + JSON.stringify(selector) + ') !== null'
}

async function exists(page: PageHandle, selector: string): Promise<boolean> {
  const probe = await evaluateThrough<boolean>(page, existsScript(selector))
  return probe.ok && probe.value === true
}

async function waitFor(page: PageHandle, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await exists(page, selector)) return true
    await sleep(300)
  }
  return false
}

interface RpcProbe {
  readonly status: number
  readonly body: unknown
  readonly text: string
}

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

function rpcValue(probe: RpcProbe): Record<string, unknown> | null {
  const result = asRecord(asRecord(probe.body)?.result)
  return asRecord(result?.value)
}

function findId(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (value === null) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  for (const nestedKey of ['workspace', 'session', 'request']) {
    const nested = asRecord(value[nestedKey])
    const found = findId(nested, keys)
    if (found !== null) return found
  }
  return null
}

// —— 夹具仓库：50 次提交 / 11 个未提交改动 / 1 条储藏 / 59 棵工作树 / 远端领先 2 ——

interface GitOutcome { readonly ok: boolean; readonly text: string }

/** 只在这个场景自己的夹具仓库里跑 git；git 始终带 protocol.file.allow=always。 */
function gitRun(cwd: string, args: readonly string[]): GitOutcome {
  const result = spawnSync('git', ['-c', 'protocol.file.allow=always'].concat(args), { cwd: cwd, encoding: 'utf8', timeout: 120000 })
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  return { ok: result.status === 0, text: stdout + stderr }
}

function writeFixtureFile(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

function appendFixtureLine(target: string, line: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.appendFileSync(target, line + NEWLINE, 'utf8')
}

/** 把 dir 下的改动提交掉；没有改动就跳过，重复运行不会因为 nothing-to-commit 失败。 */
function commitAll(dir: string, message: string): GitOutcome {
  const added = gitRun(dir, ['add', '-A'])
  if (!added.ok) return added
  const status = gitRun(dir, ['status', '--porcelain'])
  if (!status.ok) return status
  if (status.text.trim().length === 0) return { ok: true, text: 'nothing-to-commit' }
  return gitRun(dir, ['commit', '-m', message])
}

/** 提交标题池：12 条中文标题循环用在 48 次线性提交上，像一份真实的产品历史。 */
const COMMIT_THEMES: string[] = [
  '补身份行与同步事实行的读屏脚本',
  '把四页签的数字与单位拆开画',
  '收紧改动页文件行的行数差',
  '补提交历史页的合并提交标记',
  '按下拉宽度把工作树清单折行',
  '修储藏页详情面只读一屏',
  '给页签补键盘左右切页',
  '收窄 rail 上图标按钮的间距',
  '统一深色皮肤的边框颜色',
  '补远端依据的相对时间写法',
  '去掉页体里多余的滚动盒',
  '清理改动页筛选与统计的文案',
]

function commitMessageOf(index: number): string {
  const theme = COMMIT_THEMES[(index - 1) % COMMIT_THEMES.length]
  return '第 ' + String(index) + ' 次提交：' + theme
}

/** 改动页里 +2/−2 的那个已跟踪文件：第 1 次提交时就有，最后改两行不提交。 */
function workRouteTableSource(edited: boolean): string {
  const lines: string[] = [
    '// workRouteTable.ts —— 夹具文件（不是产品代码）：只用来量改动页的 +2/−2 行数。',
    'export const WORK_ROUTE_TABLE = [',
  ]
  for (let i = 1; i <= 8; i += 1) {
    lines.push('  { id: ' + JSON.stringify('route-' + String(i)) + ', label: ' + JSON.stringify('路由 ' + String(i)) + ' },')
  }
  lines.push(']')
  if (edited) {
    lines[2] = '  { id: ' + JSON.stringify('route-1') + ', label: ' + JSON.stringify('路由 1（1860 已改）') + ', note: ' + JSON.stringify('第一处 +2/−2 替换') + ' },'
    lines[5] = '  { id: ' + JSON.stringify('route-4') + ', label: ' + JSON.stringify('路由 4（1860 已改）') + ', note: ' + JSON.stringify('第二处 +2/−2 替换') + ' },'
  }
  return lines.join(NEWLINE) + NEWLINE
}

/** 改动页里 +23/−1 的那个已跟踪文件：最后删一行、追加 23 行不提交。 */
function outboundAdmissionSource(edited: boolean): string {
  const lines: string[] = [
    '// outbound-admission.ts —— 夹具文件（不是产品代码）：只用来量改动页的 +23/−1 行数。',
    'export const OUTBOUND_DEFAULT_TIMEOUT_MS = 15000',
    'export function admit(room: string, token: string): boolean {',
    '  return room.length > 0 && token.length > 0',
    '}',
  ]
  if (!edited) return lines.join(NEWLINE) + NEWLINE
  const kept = lines.filter((line) => line.indexOf('OUTBOUND_DEFAULT_TIMEOUT_MS') < 0)
  for (let i = 1; i <= 23; i += 1) {
    kept.push('// #1860 追加的第 ' + String(i) + ' 行：这一行只用来量改动页的 +23 行数')
  }
  return kept.join(NEWLINE) + NEWLINE
}

/** 9 个未跟踪文件：路径照 docs/prototype/vc-redesign/src/data/screen.ts 的 WORKING_CHANGES 抄，内容都是中文占位。 */
const UNTRACKED_FILES: { path: string; content: string }[] = [
  { path: 'docs/review/20261025-spec-complete-prompt-review.html', content: '<!doctype html>' + NEWLINE + '<title>规格补全提示复盘（夹具占位）</title>' + NEWLINE + '<p>这份文件只出现在真机验证夹具里，用来给改动页撑出一条 46 个字符的长路径。</p>' + NEWLINE },
  { path: 'docs/design/md-env-check-chain.png', content: '夹具占位：这里本应是一张图片，真机验证只需要它作为未跟踪文件出现。' + NEWLINE },
  { path: 'docs/design/md-env-check-chain.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><text>夹具占位的检查链示意图</text></svg>' + NEWLINE },
  { path: 'tests/verify-1545-workroute-row-nav.ts', content: '// 夹具占位：工作路由行导航的验证文件。' + NEWLINE + 'export const placeholder = true' + NEWLINE },
  { path: '.scratch/issue1518-body.md', content: '# 票 1518 正文（夹具占位）' + NEWLINE + NEWLINE + '这是真机验证夹具里的中文占位内容，用来检查改动页对未跟踪文件的展示。' + NEWLINE },
  { path: '.scratch/issue1518-original-body.md', content: '# 票 1518 维护者原话（夹具占位）' + NEWLINE + NEWLINE + '这是真机验证夹具里的中文占位内容。' + NEWLINE },
  { path: '.scratch/probe-spec-capsule.mjs', content: '// 夹具占位：探针脚本不参与任何真实验证逻辑。' + NEWLINE + 'console.log(' + JSON.stringify('夹具占位') + ')' + NEWLINE },
  { path: '.scratch/probe2.mjs', content: '// 夹具占位：第二个探针脚本。' + NEWLINE + 'export const probe = ' + JSON.stringify('占位') + NEWLINE },
  { path: '.scratch/temp/pr-1475-body.md', content: '# PR 1475 正文（夹具占位）' + NEWLINE + NEWLINE + '这是真机验证夹具里的中文占位内容，用来检查未跟踪文件的目录层级。' + NEWLINE },
]
const STASH_MESSAGE = '贮藏：工作区页折叠状态的试验（1860 验证）'

interface FixtureResult {
  readonly ok: boolean
  readonly detail: string
  readonly facts: Record<string, unknown>
}

/** 重建前先确认目录是我们自己写的：只有带标记文件、且路径在系统临时目录下面才允许整棵删除。 */
function fixtureRootRemovable(): boolean {
  const resolved = path.resolve(FIXTURE_ROOT)
  const temp = path.resolve(os.tmpdir())
  if (resolved === temp || resolved.indexOf(temp + path.sep) !== 0) return false
  return fs.existsSync(path.join(resolved, FIXTURE_MARKER))
}

/** 把 .git/logs/refs/remotes/origin/main 末条 reflog 的时间戳改成 secondsAgo 秒前，并同步文件 mtime。 */
function rewriteOriginBasisTime(secondsAgo: number): { ok: boolean; detail: string; basisMs: number | null } {
  const reflog = path.join(FIXTURE_REPO, '.git', 'logs', 'refs', 'remotes', 'origin', 'main')
  if (!fs.existsSync(reflog)) return { ok: false, detail: '找不到远端 reflog 文件 ' + reflog, basisMs: null }
  const raw = fs.readFileSync(reflog, 'utf8')
  const lines = raw.split(NEWLINE).filter((line) => line.length > 0)
  if (lines.length === 0) return { ok: false, detail: '远端 reflog 是空的：' + reflog, basisMs: null }
  const last = lines[lines.length - 1]
  const tabIndex = last.indexOf(String.fromCharCode(9))
  const head = tabIndex >= 0 ? last.slice(0, tabIndex) : last
  const tail = tabIndex >= 0 ? last.slice(tabIndex) : ''
  const parts = head.split(' ')
  if (parts.length < 6) return { ok: false, detail: '远端 reflog 末行形状看不懂：' + snippet(last, 200), basisMs: null }
  const wantedSeconds = Math.floor(Date.now() / 1000) - secondsAgo
  parts[parts.length - 2] = String(wantedSeconds)
  lines[lines.length - 1] = parts.join(' ') + tail
  fs.writeFileSync(reflog, lines.join(NEWLINE) + NEWLINE, 'utf8')
  const wanted = new Date(wantedSeconds * 1000)
  fs.utimesSync(reflog, wanted, wanted)
  const loose = path.join(FIXTURE_REPO, '.git', 'refs', 'remotes', 'origin', 'main')
  if (fs.existsSync(loose)) fs.utimesSync(loose, wanted, wanted)
  return { ok: true, detail: '远端依据时间改成 ' + String(secondsAgo) + ' 秒前（unix ' + String(wantedSeconds) + '）', basisMs: wantedSeconds * 1000 }
}

/** 读远端 reflog 末条时间与现在的差，用来判断夹具的「远端依据」是否还在 12 分钟前附近。 */
function readOriginBasisAgeSeconds(): number | null {
  const reflog = path.join(FIXTURE_REPO, '.git', 'logs', 'refs', 'remotes', 'origin', 'main')
  if (!fs.existsSync(reflog)) return null
  const raw = fs.readFileSync(reflog, 'utf8')
  const lines = raw.split(NEWLINE).filter((line) => line.length > 0)
  if (lines.length === 0) return null
  const last = lines[lines.length - 1]
  const tabIndex = last.indexOf(String.fromCharCode(9))
  const head = tabIndex >= 0 ? last.slice(0, tabIndex) : last
  const parts = head.split(' ')
  const seconds = Number(parts[parts.length - 2])
  if (!Number.isFinite(seconds)) return null
  return Math.floor(Date.now() / 1000) - seconds
}

const STASH_BRANCH_NOTE = '夹具说明：main 在推送之后又走了两条提交（feature 一条 + 合并一条），所以领先远端 2 条。'

/** 从零搭出夹具仓库：50 次提交、11 个未提交改动、1 条储藏、远端领先 2、59 棵工作树。 */
function buildFixture(): FixtureResult {
  const problems: string[] = []
  if (fs.existsSync(FIXTURE_ROOT)) {
    if (!fixtureRootRemovable()) {
      return { ok: false, detail: '夹具目录已存在但不是本场景创建的，拒绝删除：' + FIXTURE_ROOT, facts: {} }
    }
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
  fs.writeFileSync(path.join(FIXTURE_ROOT, FIXTURE_MARKER), '1860 真机验证夹具目录，可以整棵删除。' + NEWLINE, 'utf8')

  const bareInit = gitRun(FIXTURE_ROOT, ['init', '--bare', '--initial-branch=main', ORIGIN_BARE])
  if (!bareInit.ok) problems.push('裸仓 init 失败：' + snippet(bareInit.text))
  fs.mkdirSync(FIXTURE_REPO, { recursive: true })
  const repoInit = gitRun(FIXTURE_REPO, ['init', '--initial-branch=main'])
  if (!repoInit.ok) problems.push('夹具仓库 init 失败：' + snippet(repoInit.text))
  gitRun(FIXTURE_REPO, ['config', 'user.name', 'verify-1860'])
  gitRun(FIXTURE_REPO, ['config', 'user.email', 'verify-1860@example.invalid'])
  gitRun(FIXTURE_REPO, ['config', 'core.autocrlf', 'false'])
  gitRun(FIXTURE_REPO, ['config', 'commit.gpgsign', 'false'])
  gitRun(FIXTURE_REPO, ['config', 'tag.gpgsign', 'false'])
  gitRun(FIXTURE_REPO, ['config', 'gc.auto', '0'])

  writeFixtureFile(path.join(FIXTURE_REPO, 'README.md'), '# 1860 真机验证夹具仓库' + NEWLINE + NEWLINE + '这个仓库只用来给版本管理首屏提供真实数据，不是产品代码。' + NEWLINE + NEWLINE + STASH_BRANCH_NOTE + NEWLINE)
  writeFixtureFile(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '# 迭代笔记' + NEWLINE + NEWLINE + '这份文件每次提交追加一行，储藏也拿它当素材。' + NEWLINE)
  writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'client', 'views', 'shared', 'workRouteTable.ts'), workRouteTableSource(false))
  writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'refresh', 'rooms', 'host', 'outbound-admission.ts'), outboundAdmissionSource(false))
  const first = commitAll(FIXTURE_REPO, commitMessageOf(1))
  if (!first.ok) problems.push('第 1 次提交失败：' + snippet(first.text))

  for (let index = 2; index <= 48; index += 1) {
    appendFixtureLine(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '- 第 ' + String(index) + ' 次提交：把改动页的边距再收一格')
    writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'app', 'step-' + String(index) + '.txt'), '第 ' + String(index) + ' 次提交生成的占位文件' + NEWLINE)
    const step = commitAll(FIXTURE_REPO, commitMessageOf(index))
    if (!step.ok) {
      problems.push('第 ' + String(index) + ' 次提交失败：' + snippet(step.text))
      break
    }
  }

  const remoteAdd = gitRun(FIXTURE_REPO, ['remote', 'add', 'origin', ORIGIN_BARE])
  if (!remoteAdd.ok) problems.push('加 origin 远端失败：' + snippet(remoteAdd.text))
  const firstPush = gitRun(FIXTURE_REPO, ['push', '-u', 'origin', 'main'])
  if (!firstPush.ok) problems.push('首次推送失败：' + snippet(firstPush.text))

  const featureBranch = gitRun(FIXTURE_REPO, ['checkout', '-b', 'feature/version-control-redesign'])
  if (!featureBranch.ok) problems.push('切 feature 分支失败：' + snippet(featureBranch.text))
  writeFixtureFile(path.join(FIXTURE_REPO, 'docs', 'feature.md'), '# 版本管理重做（夹具占位）' + NEWLINE + NEWLINE + '这一条提交只为了给合并提交当来源。' + NEWLINE)
  const featureCommit = commitAll(FIXTURE_REPO, commitMessageOf(49))
  if (!featureCommit.ok) problems.push('第 49 次提交失败：' + snippet(featureCommit.text))
  const backToMain = gitRun(FIXTURE_REPO, ['checkout', 'main'])
  if (!backToMain.ok) problems.push('切回 main 失败：' + snippet(backToMain.text))
  const merge = gitRun(FIXTURE_REPO, ['merge', '--no-ff', 'feature/version-control-redesign', '-m', '第 50 次提交：把 feature/version-control-redesign 合并回 main（真机夹具）'])
  if (!merge.ok) problems.push('合并提交失败：' + snippet(merge.text))

  writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'client', 'views', 'shared', 'workRouteTable.ts'), workRouteTableSource(true))
  writeFixtureFile(path.join(FIXTURE_REPO, 'src', 'refresh', 'rooms', 'host', 'outbound-admission.ts'), outboundAdmissionSource(true))
  for (const file of UNTRACKED_FILES) writeFixtureFile(path.join(FIXTURE_REPO, file.path), file.content)

  gitRun(FIXTURE_REPO, ['stash', 'clear'])
  appendFixtureLine(path.join(FIXTURE_REPO, 'docs', 'notes.md'), '- 这一行会被储藏收走：工作区页折叠状态的试验')
  const stash = gitRun(FIXTURE_REPO, ['stash', 'push', '-m', STASH_MESSAGE, '--', 'docs/notes.md'])
  if (!stash.ok) problems.push('创建储藏失败：' + snippet(stash.text))

  const head = gitRun(FIXTURE_REPO, ['rev-parse', 'HEAD'])
  const headOid = head.ok ? head.text.trim() : ''
  if (headOid.length === 0) problems.push('取 HEAD 提交号失败：' + snippet(head.text))

  fs.mkdirSync(WORKTREE_ROOT, { recursive: true })
  let addedWorktrees = 0
  for (let index = 1; index <= WORKTREE_COUNT; index += 1) {
    const name = 'wt-' + String(index).padStart(2, '0')
    const add = gitRun(FIXTURE_REPO, ['worktree', 'add', '--detach', '--no-checkout', path.join(WORKTREE_ROOT, name), headOid])
    if (add.ok) addedWorktrees += 1
    else problems.push('第 ' + String(index) + ' 棵工作树创建失败：' + snippet(add.text))
  }

  const basis = rewriteOriginBasisTime(BASIS_SECONDS_AGO)
  if (!basis.ok) problems.push(basis.detail)

  return {
    ok: problems.length === 0,
    detail: problems.length === 0 ? '夹具仓库搭好了' : '搭夹具时有问题：' + problems.slice(0, 6).join('；'),
    facts: { repo: FIXTURE_REPO, origin: ORIGIN_BARE, headOid: headOid, worktrees: addedWorktrees, basis: basis.detail },
  }
}

/** 逐条核对夹具的关键数字；任何一条不对就把问题列出来（不抛错，交给调用方决定重建）。 */
function validateFixture(): FixtureResult {
  const problems: string[] = []
  const facts: Record<string, unknown> = { repo: FIXTURE_REPO }
  if (!fs.existsSync(path.join(FIXTURE_REPO, '.git'))) {
    return { ok: false, detail: '夹具仓库不存在：' + FIXTURE_REPO, facts: facts }
  }
  const read = (label: string, args: readonly string[]): string => {
    const out = gitRun(FIXTURE_REPO, args)
    if (!out.ok) problems.push(label + ' 失败：' + snippet(out.text))
    return out.ok ? out.text : ''
  }
  const commits = Number(read('数提交', ['rev-list', '--count', 'HEAD']).trim())
  const merges = Number(read('数合并提交', ['rev-list', '--count', '--merges', 'HEAD']).trim())
  const branch = read('取当前分支', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const ahead = Number(read('数领先', ['rev-list', '--count', 'origin/main..HEAD']).trim())
  const behind = Number(read('数落后', ['rev-list', '--count', 'HEAD..origin/main']).trim())
  const statusText = read('读工作区状态', ['status', '--porcelain=v1', '-uall'])
  const statusLines = statusText.split(NEWLINE).filter((line) => line.trim().length > 0)
  let trackedModified = 0
  let untracked = 0
  for (const line of statusLines) {
    if (line.startsWith('??')) untracked += 1
    else if (line.charAt(1) === 'M' || line.charAt(0) === 'M') trackedModified += 1
  }
  const stashText = read('数储藏', ['stash', 'list'])
  const stashCount = stashText.split(NEWLINE).filter((line) => line.trim().length > 0).length
  const worktreeText = read('列工作树', ['worktree', 'list', '--porcelain'])
  const worktreeCount = worktreeText.split(NEWLINE).filter((line) => line.startsWith('worktree ')).length - 1
  const basisAge = readOriginBasisAgeSeconds()

  facts.commits = commits
  facts.merges = merges
  facts.branch = branch
  facts.ahead = ahead
  facts.behind = behind
  facts.statusLines = statusLines.length
  facts.trackedModified = trackedModified
  facts.untracked = untracked
  facts.stashCount = stashCount
  facts.worktreeCount = worktreeCount
  facts.basisAgeSeconds = basisAge

  if (commits !== EXPECTED_COMMITS) problems.push('提交数 ' + String(commits) + '，应为 ' + String(EXPECTED_COMMITS))
  if (merges !== EXPECTED_MERGES) problems.push('合并提交数 ' + String(merges) + '，应为 ' + String(EXPECTED_MERGES))
  if (branch !== 'main') problems.push('当前分支是 ' + branch + '，应为 main')
  if (ahead !== AHEAD) problems.push('领先远端 ' + String(ahead) + '，应为 ' + String(AHEAD))
  if (behind !== BEHIND) problems.push('落后远端 ' + String(behind) + '，应为 ' + String(BEHIND))
  if (statusLines.length !== EXPECTED_CHANGES) problems.push('未提交改动 ' + String(statusLines.length) + ' 条，应为 ' + String(EXPECTED_CHANGES))
  if (trackedModified !== EXPECTED_TRACKED) problems.push('已跟踪修改 ' + String(trackedModified) + ' 条，应为 ' + String(EXPECTED_TRACKED))
  if (untracked !== EXPECTED_UNTRACKED) problems.push('未跟踪文件 ' + String(untracked) + ' 条，应为 ' + String(EXPECTED_UNTRACKED))
  if (stashCount !== EXPECTED_STASH) problems.push('储藏 ' + String(stashCount) + ' 条，应为 ' + String(EXPECTED_STASH))
  if (worktreeCount !== WORKTREE_COUNT) problems.push('其他工作树 ' + String(worktreeCount) + ' 棵，应为 ' + String(WORKTREE_COUNT))
  if (basisAge === null || Math.abs(basisAge - BASIS_SECONDS_AGO) > 300) problems.push('远端依据时间差 ' + String(basisAge) + ' 秒，应在 ' + String(BASIS_SECONDS_AGO) + ' 秒附近')

  return {
    ok: problems.length === 0,
    detail: problems.length === 0 ? '夹具核对通过' : '夹具核对不通过：' + problems.join('；'),
    facts: facts,
  }
}

let fixtureSummary: FixtureResult | null = null

/** 每次启动先核对夹具；不对就整棵重建。重建只发生在系统临时目录里带标记的那一份。 */
function ensureFixtureRepo(): FixtureResult {
  if (fixtureSummary !== null) return fixtureSummary
  const first = validateFixture()
  if (first.ok) {
    fixtureSummary = first
    return first
  }
  console.log('[1860] 夹具需要重建：' + first.detail)
  const rebuilt = buildFixture()
  const checked = rebuilt.ok ? validateFixture() : rebuilt
  fixtureSummary = checked
  return checked
}

/** 把一份 JSON 记进批次证据目录；失败只打日志，不中断整轮取证。 */
async function recordEvidence(context: ScenarioContext, name: string, value: unknown, note: string): Promise<string | null> {
  try {
    const filed = await context.evidence.recordJson(name, value, { note: note })
    if (!filed.ok) {
      console.log('[1860] 记证据失败 ' + name + '：' + filed.error.message)
      return null
    }
    return filed.value.path
  } catch (error) {
    console.log('[1860] 记证据抛错 ' + name + '：' + messageOf(error))
    return null
  }
}

function summarizeResult(result: FixtureResult): string {
  const facts = result.facts
  const bits: string[] = []
  bits.push('ok=' + String(result.ok))
  bits.push('commits=' + String(facts.commits))
  bits.push('merges=' + String(facts.merges))
  bits.push('ahead=' + String(facts.ahead))
  bits.push('behind=' + String(facts.behind))
  bits.push('tracked=' + String(facts.trackedModified))
  bits.push('untracked=' + String(facts.untracked))
  bits.push('stash=' + String(facts.stashCount))
  bits.push('worktrees=' + String(facts.worktreeCount))
  return bits.join(' ')
}

/** 把隔离 home 里 ui-theme 的偏好改成指定皮肤；启动前的皮肤锁定靠它。 */
function setHomeThemePreference(homeDir: string, skin: string): { ok: boolean; detail: string } {
  const patchPath = path.join(homeDir, 'profiles', 'web', 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) return { ok: false, detail: '没有找到 ' + patchPath }
  const lines = fs.readFileSync(patchPath, 'utf8').split(NEWLINE)
  let markerIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].indexOf('@deepseek-ai/dsh-client-ui-theme') >= 0) {
      markerIndex = i
      break
    }
  }
  if (markerIndex < 0) return { ok: false, detail: 'cordis.patch.yml 里没有 @deepseek-ai/dsh-client-ui-theme 段' }
  for (let i = markerIndex; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (i > markerIndex && trimmed.startsWith('- ')) break
    if (trimmed.startsWith('preference:')) {
      const indent = lines[i].slice(0, lines[i].length - lines[i].trimStart().length)
      lines[i] = indent + 'preference: ' + skin
      fs.writeFileSync(patchPath, lines.join(NEWLINE) + NEWLINE, 'utf8')
      return { ok: true, detail: '已把隔离 home 的 ui-theme 偏好写成 ' + skin }
    }
  }
  return { ok: false, detail: 'ui-theme 段里没有 preference 行' }
}

/**
 * 真实 web profile 里带着 dsh-life-pack 0.3.87；它与当前宿主不兼容——启动时它要 import
 * base-entries 的 currentRenderLanguage，而宿主那份 base-entries 没这个导出，于是启动判据
 * 「所有启用项都激活」会失败，实例被判半加载后停掉。这里只改隔离 home 的副本：把它从
 * dsh.profile.bundles 清单里去掉；真实 home 一个字都不动。
 */
const INCOMPATIBLE_BUNDLES = ['dsh-life-pack']

function trimIncompatibleBundles(homeDir: string): { ok: boolean; removed: string[]; detail: string } {
  const packagePath = path.join(homeDir, 'profiles', 'web', 'package.json')
  if (!fs.existsSync(packagePath)) return { ok: false, removed: [], detail: '没有找到 ' + packagePath }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    return { ok: false, removed: [], detail: '读不了 ' + packagePath + '：' + messageOf(error) }
  }
  const dsh = asRecord(parsed.dsh)
  const profile = dsh === null ? null : asRecord(dsh.profile)
  const bundles = profile === null ? null : profile.bundles
  if (!Array.isArray(bundles)) return { ok: false, removed: [], detail: 'package.json 里没有 dsh.profile.bundles 数组' }
  const removed: string[] = []
  const kept: unknown[] = []
  for (const entry of bundles) {
    if (INCOMPATIBLE_BUNDLES.indexOf(String(entry)) >= 0) removed.push(String(entry))
    else kept.push(entry)
  }
  if (removed.length === 0) return { ok: true, removed: removed, detail: '没有需要去掉的 bundle' }
  profile!.bundles = kept
  fs.writeFileSync(packagePath, JSON.stringify(parsed, null, 2) + NEWLINE, 'utf8')
  return { ok: true, removed: removed, detail: '从隔离 home 的 bundles 去掉 ' + removed.join('、') }
}

/** 启动前把夹具仓库注册成隔离 home 的工作区，并把默认工作区指到它。 */
const hooks: ScenarioHooks = {
  prepareHome: async (_context: ScenarioContext, info: ScenarioLaunchHookInfo) => {
    const fixture = ensureFixtureRepo()
    console.log('[1860] 夹具状态：' + summarizeResult(fixture) + ' ' + fixture.detail)
    if (!fixture.ok) throw new Error('1860 夹具准备失败：' + fixture.detail)
    const trimmed = trimIncompatibleBundles(info.home)
    console.log('[1860] 隔离引导项裁剪：' + trimmed.detail)
    const lockedSkin = LOCKED_SKIN
    if (lockedSkin.length > 0) {
      const themed = setHomeThemePreference(info.home, lockedSkin)
      console.log('[1860] 启动前皮肤锁定 ' + lockedSkin + '：' + themed.detail)
    }
    const previousWorkRoot = process.env.DSH_VERIFY_WORK_ROOT
    process.env.DSH_VERIFY_WORK_ROOT = info.dir
    try {
      const seeded = seedWorkspaceRegistry(info.home, [{ path: FIXTURE_REPO, title: '1860 夹具仓库' }], { defaultPath: FIXTURE_REPO })
      console.log('[1860] 工作区注册表写好了：' + seeded.registryPath + '，默认工作区 ' + seeded.defaultWorkspaceId)
      return { fixture: fixture.facts, registryPath: seeded.registryPath, bundlesRemoved: trimmed.removed }
    } finally {
      if (previousWorkRoot === undefined) delete process.env.DSH_VERIFY_WORK_ROOT
      else process.env.DSH_VERIFY_WORK_ROOT = previousWorkRoot
    }
  },
}

// —— 界面导航：进主视图 → 开版本管理标签页 → 切页签 → 切皮肤 ——

const SIDEBAR_OPEN_BUTTON = 'button[aria-label=' + QUOTE + '打开侧边栏' + QUOTE + ']'
const GEAR_INDEX_SELECTOR = '[data-vc-gear-index]'

interface MainViewResult {
  readonly ok: boolean
  readonly via: string
  readonly detail: string
  readonly facts: Record<string, unknown>
}
interface SkinResult {
  readonly ok: boolean
  readonly blocked: boolean
  readonly detail: string
  readonly facts: Record<string, unknown>
}
interface PageOpenResult {
  readonly ok: boolean
  readonly detail: string
  readonly facts: Record<string, unknown>
}

/** 夹具路径在页面内 RPC 里要写成正斜杠形式，避免反斜杠被 JSON 转义。 */
function fixturePathForRpc(): string {
  return FIXTURE_REPO.split(String.fromCharCode(92)).join('/')
}

function menuClickScript(targets: readonly string[]): string {
  return scriptOf([
    '(function () {',
    '  var wanted = ' + JSON.stringify(targets) + ';',
    '  var candidates = Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify('[role=menuitem], button, a') + '));',
    '  for (var i = 0; i < wanted.length; i += 1) {',
    '    for (var j = 0; j < candidates.length; j += 1) {',
    '      var el = candidates[j];',
    '      var text = String(el.innerText || el.textContent || ' + JSON.stringify('') + ');',
    '      if (text.indexOf(wanted[i]) >= 0 && el.offsetParent !== null) {',
    '        if (typeof el.scrollIntoView === "function") { el.scrollIntoView({ block: ' + JSON.stringify('center') + ' }); }',
    '        el.click();',
    '        return { ok: true, target: wanted[i], tag: el.tagName, text: text.slice(0, 60) };',
    '      }',
    '    }',
    '  }',
    '  return { ok: false, reason: ' + JSON.stringify('menu-not-found') + ' };',
    '})()',
  ])
}

function sessionRowClickScript(): string {
  return scriptOf([
    '(function () {',
    '  var rows = Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify('[data-row-key^=' + QUOTE + 'session:' + QUOTE + ']') + '));',
    '  for (var i = 0; i < rows.length; i += 1) {',
    '    var row = rows[i];',
    '    if (row.offsetParent === null) { continue; }',
    '    var target = row.querySelector(' + JSON.stringify('button, [role=button]') + ') || row;',
    '    if (typeof target.scrollIntoView === "function") { target.scrollIntoView({ block: ' + JSON.stringify('center') + ' }); }',
    '    target.click();',
    '    return { ok: true, key: row.getAttribute(' + JSON.stringify('data-row-key') + ') };',
    '  }',
    '  return { ok: false, reason: ' + JSON.stringify('session-row-not-found') + ' };',
    '})()',
  ])
}

function workspaceRowNewSessionScript(title: string): string {
  return scriptOf([
    '(function () {',
    '  var rows = Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify('[data-row-key^=' + QUOTE + 'workspace:' + QUOTE + ']') + '));',
    '  for (var i = 0; i < rows.length; i += 1) {',
    '    var row = rows[i];',
    '    var text = String(row.innerText || row.textContent || ' + JSON.stringify('') + ');',
    '    if (text.indexOf(' + JSON.stringify(title) + ') < 0) { continue; }',
    '    var buttons = Array.prototype.slice.call(row.querySelectorAll(' + JSON.stringify('button') + '));',
    '    for (var j = 0; j < buttons.length; j += 1) {',
    '      var label = String(buttons[j].getAttribute(' + JSON.stringify('aria-label') + ') || buttons[j].innerText || ' + JSON.stringify('') + ');',
    '      if (label.indexOf(' + JSON.stringify('新建会话') + ') >= 0) {',
    '        buttons[j].click();',
    '        return { ok: true, key: row.getAttribute(' + JSON.stringify('data-row-key') + '), label: label };',
    '      }',
    '    }',
    '  }',
    '  return { ok: false, reason: ' + JSON.stringify('workspace-row-new-session-not-found') + ' };',
    '})()',
  ])
}

function rowKeysScript(): string {
  return scriptOf([
    '(function () {',
    '  var all = Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify('[data-row-key]') + '));',
    '  return all.slice(0, 40).map(function (el) { return el.getAttribute(' + JSON.stringify('data-row-key') + '); });',
    '})()',
  ])
}

/** 先试适配器原生 click；没有就退回页面内 el.click()。 */
async function clickPage(page: PageHandle, raw: RawBrowserPage, selector: string): Promise<{ ok: boolean; detail: string }> {
  const viaAdapter = await realClick(raw, selector)
  if (viaAdapter.ok) return viaAdapter
  const viaDom = await evaluateThrough<{ ok: boolean; reason?: string }>(page, domClickScript(selector))
  if (viaDom.ok && viaDom.value.ok) return { ok: true, detail: '页面内 click ' + selector }
  return { ok: false, detail: '点不到 ' + selector + '：' + viaAdapter.detail + '；页面内也失败 ' + (viaDom.ok ? String(viaDom.value.reason) : viaDom.error.message) }
}

async function bodyDarkOf(page: PageHandle): Promise<boolean | null> {
  const probe = await evaluateThrough<boolean>(page, BODY_DARK_SCRIPT)
  return probe.ok ? probe.value === true : null
}

/** 进主视图：优先直接建工作区/会话；不行再走欢迎屏菜单、刷新后点会话行这几条兜底。 */
async function openMainView(page: PageHandle, raw: RawBrowserPage, tokenUrl: string, originUrl: string): Promise<MainViewResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'already-main', detail: '已经在主视图', facts: facts }

  let workspaceId: string | null = null
  const argsExpression = '{ request: { path: ' + JSON.stringify(fixturePathForRpc()) + ' } }'
  const created = await evaluateThrough<RpcProbe>(page, rpcScript('workspace/create', argsExpression))
  if (created.ok) {
    facts.workspaceRpcStatus = created.value.status
    workspaceId = findId(rpcValue(created.value), ['workspaceId', 'id'])
  } else {
    facts.workspaceRpcError = created.error.message
  }
  let sessionId: string | null = null
  if (workspaceId !== null) {
    facts.workspaceId = workspaceId
    const sessionExpression = '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'
    const sessionProbe = await evaluateThrough<RpcProbe>(page, rpcScript('session/create', sessionExpression))
    if (sessionProbe.ok) {
      facts.sessionRpcStatus = sessionProbe.value.status
      sessionId = findId(rpcValue(sessionProbe.value), ['sessionId', 'id'])
    } else {
      facts.sessionRpcError = sessionProbe.error.message
    }
  }
  if (sessionId !== null) facts.sessionId = sessionId

  if (sessionId !== null) {
    await sleep(1200)
    await clickPage(page, raw, NEW_SESSION_BUTTON)
    await sleep(3500)
    if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'rpc-then-new-session', detail: '建好工作区与会话后点新建会话进了主视图', facts: facts }
  }

  await clickPage(page, raw, WORKSPACE_BUTTON)
  await sleep(900)
  const menu = await evaluateThrough<{ ok: boolean; reason?: string; target?: string }>(page, menuClickScript(['1860 夹具仓库', '验证工作区', FIXTURE_REPO]))
  facts.heroMenu = menu.ok ? menu.value : { error: menu.error.message }
  await sleep(3500)
  if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'hero-menu', detail: '在欢迎屏工作区菜单里点了夹具仓库', facts: facts }

  if (typeof raw.goto === 'function') {
    await raw.goto(tokenUrl)
    await sleep(4500)
    if (await exists(page, SIDEBAR_OPEN_BUTTON)) await clickPage(page, raw, SIDEBAR_OPEN_BUTTON)
    await sleep(800)
    const row = await evaluateThrough<{ ok: boolean; reason?: string; key?: string }>(page, sessionRowClickScript())
    facts.sessionRow = row.ok ? row.value : { error: row.error.message }
    await sleep(3000)
    if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'reload-session-row', detail: '刷新页面后点了左栏的会话行', facts: facts }
    const workspaceRow = await evaluateThrough<{ ok: boolean; reason?: string }>(page, workspaceRowNewSessionScript('1860 夹具仓库'))
    facts.workspaceRow = workspaceRow.ok ? workspaceRow.value : { error: workspaceRow.error.message }
    await sleep(3000)
    if (await exists(page, RAIL_BUTTON)) return { ok: true, via: 'sidebar-workspace-row', detail: '在左栏工作区行里点了新建会话', facts: facts }
  }

  const rows = await evaluateThrough<string[]>(page, rowKeysScript())
  facts.rowKeys = rows.ok ? rows.value : []
  facts.url = page.url()
  facts.originUrl = originUrl
  return { ok: false, via: 'none', detail: '三条兜底都没能进主视图（找不到打开右侧边栏的按钮）', facts: facts }
}

/** 打开版本管理标签页：点右栏把手 → 点指南入口 → 点版本管理页签 → 等壳根挂出来。 */
async function openVersionControlPanel(page: PageHandle, raw: RawBrowserPage): Promise<PageOpenResult> {
  const facts: Record<string, unknown> = {}
  const rail = await clickPage(page, raw, RAIL_BUTTON)
  facts.railClick = rail
  await sleep(1500)
  const guide = await clickPage(page, raw, GUIDE_ENTRY_BUTTON)
  facts.guideClick = guide
  let tabFound = false
  for (let i = 0; i < 60; i += 1) {
    if (await exists(page, VC_TAB_BUTTON)) {
      tabFound = true
      break
    }
    await sleep(500)
  }
  facts.tabFound = tabFound
  if (!tabFound) return { ok: false, detail: '右栏里没有出现版本管理页签', facts: facts }
  await clickPage(page, raw, VC_TAB_BUTTON)
  for (let i = 0; i < 60; i += 1) {
    const measured = await measureUi(page)
    if (measured.ok && measured.value.attrWidth !== null && measured.value.liveEmpty === null) {
      facts.shell = measured.value
      // 壳挂出来不等于数据到了：宿主侧要先把会话后端接到夹具工作区，身份行与页签计数才会换掉空壳。
      const data = await waitForVersionControlData(page, raw, 45000)
      facts.vcData = data.facts
      facts.vcDataDetail = data.detail
      if (!data.ok) return { ok: true, detail: '版本管理首屏挂出来了，但数据没到位：' + data.detail, facts: facts }
      return { ok: true, detail: '版本管理首屏挂出来且数据到位', facts: facts }
    }
    await sleep(500)
  }
  const last = await measureUi(page)
  facts.lastMeasure = last.ok ? last.value : { error: last.error.message }
  return { ok: false, detail: '点了版本管理页签，但 [data-vc-root] 没有带着 data-vc-width 挂出来', facts: facts }
}

/** 版本管理页的数据是在挂出来之后由宿主侧异步喂进来的：先显示「分离头指针 / 页签数字 —」的空壳，
 *  等会话后端挂上夹具工作区后才换成真正的仓库。首轮取证曾在这个空壳阶段就截图，四页签全红。
 *  这里按可证伪的判据等到数据确实到位再交回去：身份行有仓库名与分支、四页签计数都是 ok、正文存在。 */
function versionControlDataReady(base: BaseFacts): boolean {
  if (!base.found || base.root === null || base.identity === null || base.body === null) return false
  if (base.identity.repo === '' || base.identity.detached !== '') return false
  if (base.tabs.length !== 4) return false
  return base.tabs.every((tab) => tab.countState === 'ok')
}

let vcDataConfirmed = false

/** 等版本管理数据到位；超过一半时间还只有空壳就重挂一次页签，再等到超时。 */
async function waitForVersionControlData(page: PageHandle, raw: RawBrowserPage, timeoutMs: number): Promise<{ ok: boolean; detail: string; facts: Record<string, unknown> }> {
  const started = Date.now()
  const facts: Record<string, unknown> = { timeoutMs: timeoutMs }
  let remounted = false
  let last: BaseFacts | null = null
  while (Date.now() - started < timeoutMs) {
    const probe = await inspectBase(page)
    if (probe.ok) {
      last = probe.value
      if (versionControlDataReady(probe.value)) {
        facts.waitMs = Date.now() - started
        facts.remounted = remounted
        facts.identity = probe.value.identity
        vcDataConfirmed = true
        facts.tabs = probe.value.tabs.map((tab) => ({ id: tab.id, countState: tab.countState, count: tab.count }))
        return { ok: true, detail: '版本管理数据已到位（等 ' + String(facts.waitMs) + 'ms）', facts: facts }
      }
    }
    if (!remounted && Date.now() - started > timeoutMs / 3) {
      remounted = true
      facts.remountAtMs = Date.now() - started
      await remountVersionControlTab(page, raw)
      continue
    }
    await sleep(500)
  }
  facts.waitMs = Date.now() - started
  facts.remounted = remounted
  if (last !== null) {
    facts.identity = last.identity
    facts.tabs = last.tabs.map((tab) => ({ id: tab.id, label: tab.label, countState: tab.countState, countText: tab.countText }))
    facts.bodyText = last.body === null ? null : snippet(last.body.text, 200)
    facts.found = last.found
    facts.root = last.root
  } else {
    facts.lastProbe = '读不到 [data-vc-root]'
  }
  return { ok: false, detail: '等了 ' + String(facts.waitMs) + 'ms 版本管理仍是空壳（身份行/页签计数没到位）', facts: facts }
}

/** 改动页的提交区（composer）是异步挂载的：改动读数到位之后它才出现。截图与判据都要等它挂出来，
 *  否则会拍到「文件行有了、提交区还没有」的中间帧，把 [data-vc-commit-panel] 判成不存在。 */
async function waitForCommitPanel(page: PageHandle, timeoutMs: number): Promise<{ ok: boolean; waitMs: number; detail: string }> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await exists(page, COMMIT_PANEL_SELECTOR)) {
      const waitMs = Date.now() - started
      return { ok: true, waitMs: waitMs, detail: '提交区已挂出（等 ' + String(waitMs) + 'ms）' }
    }
    await sleep(300)
  }
  const waitMs = Date.now() - started
  return { ok: false, waitMs: waitMs, detail: '等了 ' + String(waitMs) + 'ms 提交区 ' + COMMIT_PANEL_SELECTOR + ' 仍未挂出' }
}

/** 先点列表页签再点回版本管理页签，让容器重新挂载一次（皮肤偏好是挂载时读的）。 */
async function remountVersionControlTab(page: PageHandle, raw: RawBrowserPage): Promise<void> {
  await clickPage(page, raw, LIST_TAB_BUTTON)
  await sleep(700)
  await clickPage(page, raw, VC_TAB_BUTTON)
  await sleep(1500)
}

/**
 * 把界面切到目标皮肤；启动前锁了别的皮肤时记 blocked，不硬改。
 *
 * 为什么切完要整页重来：改 ui-theme 偏好会让宿主的客户端重载，重载后版本管理页签又回到「分离头指针 / 页签数字 —」
 * 的空壳——会话后端没接上夹具工作区，而且它会一直空着，不像刚挂载时那样几秒后自己补数据。
 * 2026-11-04 的浅色批次就是只重挂页签，四张图全拍成空壳。这里重载之后按启动时同一套路径
 * （进主视图 → 打开版本管理首屏）重新接一遍，并把「数据已确认」的缓存清掉，让后面的取证重新等数据。
 */
async function ensureSkin(page: PageHandle, raw: RawBrowserPage, skin: Skin, tokenUrl: string, originUrl: string): Promise<SkinResult> {
  const facts: Record<string, unknown> = {}
  const desiredDark = skin === 'dark'
  const measured = await measureUi(page)
  const currentDark = await bodyDarkOf(page)
  facts.before = measured.ok ? measured.value : { error: measured.error.message }
  facts.bodyDark = currentDark
  if (measured.ok && measured.value.attrSkin === skin && currentDark === desiredDark) {
    return { ok: true, blocked: false, detail: '界面已经是 ' + skin + ' 皮肤', facts: facts }
  }
  const lockedSkin = LOCKED_SKIN
  if (lockedSkin.length > 0 && lockedSkin !== skin) {
    return { ok: false, blocked: true, detail: '启动前锁了 ' + lockedSkin + ' 皮肤，这一轮不切到 ' + skin, facts: facts }
  }
  // settings/mutate 的参数按名字传：args 必须是「恰好一个普通对象」，即 { ns, ops }。
  // 之前传数组被网关拒（gateway/internal「Remote payload must contain exactly one plain-object args field」），
  // 只能靠启动前改偏好；启动前改会被宿主启动时按设置库回写，运行时切皮肤必须走这条对象参数。
  const argsExpression = JSON.stringify({ ns: 'ui-theme', ops: [{ op: 'set', path: ['preference'], value: skin }] })
  const mutated = await evaluateThrough<RpcProbe>(page, rpcScript('settings/mutate', argsExpression))
  facts.settingsStatus = mutated.ok ? mutated.value.status : null
  facts.settingsText = mutated.ok ? snippet(mutated.value.text, 300) : mutated.error.message
  if (!mutated.ok || mutated.value.status >= 300) {
    return { ok: false, blocked: true, detail: '改皮肤偏好的设置通道不可用：' + snippet(facts.settingsText as string, 300), facts: facts }
  }
  let flipped = false
  for (let i = 0; i < 30; i += 1) {
    if ((await bodyDarkOf(page)) === desiredDark) {
      flipped = true
      break
    }
    await sleep(400)
  }
  facts.bodyFlipped = flipped
  if (!flipped) return { ok: false, blocked: false, detail: '改了偏好，但 body 皮肤没有翻转', facts: facts }
  // 客户端会按新偏好重载；重载后先回到起点，再按启动时的路径重新接上夹具工作区与版本管理首屏。
  // 不这么做就只能拿到空壳：页签还在，但身份行是「分离头指针」、四个数字都是「—」。
  vcDataConfirmed = false
  if (typeof raw.goto === 'function') {
    await raw.goto(tokenUrl)
    await sleep(3000)
  }
  const reentered = await openMainView(page, raw, tokenUrl, originUrl)
  facts.reenterMainView = { ok: reentered.ok, via: reentered.via, detail: reentered.detail }
  if (!reentered.ok) return { ok: false, blocked: false, detail: '换皮肤后回不到主视图：' + reentered.detail, facts: facts }
  const reopened = await openVersionControlPanel(page, raw)
  facts.reopenPanel = { ok: reopened.ok, detail: reopened.detail }
  vcDataConfirmed = reopened.ok
  if (!reopened.ok) return { ok: false, blocked: false, detail: '换皮肤后版本管理首屏没重新挂上：' + reopened.detail, facts: facts }
  for (let i = 0; i < 25; i += 1) {
    const probe = await measureUi(page)
    if (probe.ok && probe.value.attrSkin === skin) {
      facts.after = probe.value
      return { ok: true, blocked: false, detail: '切到了 ' + skin + ' 皮肤', facts: facts }
    }
    await sleep(400)
  }
  const last = await measureUi(page)
  facts.lastMeasure = last.ok ? last.value : { error: last.error.message }
  return { ok: false, blocked: false, detail: '重新挂载后 data-vc-skin 仍不是 ' + skin, facts: facts }
}

/** 切到四个一级页签之一，并等壳根与页体的 data-vc-page 都写对。 */
async function openTab(page: PageHandle, raw: RawBrowserPage, view: ViewName): Promise<PageOpenResult> {
  const facts: Record<string, unknown> = {}
  if (await exists(page, BACK_BUTTON)) {
    await clickPage(page, raw, BACK_BUTTON)
    await sleep(600)
  }
  const clicked = await clickPage(page, raw, tabButtonSelector(view))
  facts.click = clicked
  if (!clicked.ok) return { ok: false, detail: '点不到页签 ' + VIEW_TITLES[view] + '：' + clicked.detail, facts: facts }
  for (let i = 0; i < 40; i += 1) {
    const probe = await measureUi(page)
    if (probe.ok && probe.value.attrPage === view && probe.value.bodyPage === view) {
      facts.measure = probe.value
      return { ok: true, detail: '切到了页签 ' + VIEW_TITLES[view], facts: facts }
    }
    await sleep(300)
  }
  const last = await measureUi(page)
  facts.lastMeasure = last.ok ? last.value : { error: last.error.message }
  return { ok: false, detail: '点了页签 ' + VIEW_TITLES[view] + '，但 data-vc-page 没切过去', facts: facts }
}

// —— 壳根量取：每一轮都用它判断档位、皮肤、页签与是否已挂出 ——

const BACK_BUTTON = 'button[data-vc-back]'
const COMMIT_PANEL_SELECTOR = '[data-vc-commit-panel]'

const MEASURE_SCRIPT = scriptOf([
  '(() => {',
  '  const root = document.querySelector(' + JSON.stringify(VC_ROOT_SELECTOR) + ');',
  '  const live = document.querySelector(' + JSON.stringify('#vc-real-root') + ');',
  '  const panel = document.querySelector(' + JSON.stringify('.dsws-body') + ');',
  '  const bodyPage = document.querySelector(' + JSON.stringify('section[data-vc-page-body]') + ');',
  '  const boxOf = (el) => { if (el === null || el === undefined) { return null; } const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  const attr = (el, name) => (el === null || el === undefined ? null : el.getAttribute(name));',
  '  return {',
  '    url: location.href,',
  '    innerW: window.innerWidth,',
  '    innerH: window.innerHeight,',
  '    outerW: window.outerWidth,',
  '    outerH: window.outerHeight,',
  '    dpr: window.devicePixelRatio,',
  '    bodyDark: document.body.hasAttribute(' + JSON.stringify('data-ds-dark-theme') + '),',
  '    bodyBg: getComputedStyle(document.body).backgroundColor,',
  '    rootRect: boxOf(root),',
  '    liveRect: boxOf(live),',
  '    panelRect: boxOf(panel),',
  '    attrWidth: attr(root, ' + JSON.stringify('data-vc-width') + '),',
  '    attrSkin: attr(root, ' + JSON.stringify('data-vc-skin') + '),',
  '    attrPage: attr(root, ' + JSON.stringify('data-vc-page') + '),',
  '    attrDepth: attr(root, ' + JSON.stringify('data-vc-depth') + '),',
  '    bodyPage: attr(bodyPage, ' + JSON.stringify('data-vc-page-body') + '),',
  '    liveEmpty: attr(live, ' + JSON.stringify('data-vc-live-empty') + '),',
  '    identityExists: document.querySelector(' + JSON.stringify('header[data-vc-identity]') + ') !== null,',
  '    vcTabCount: document.querySelectorAll(' + JSON.stringify('button[data-vc-tab]') + ').length,',
  '  };',
  '})()',
])

interface UiFacts {
  readonly url: string
  readonly innerW: number
  readonly innerH: number
  readonly outerW: number
  readonly outerH: number
  readonly dpr: number
  readonly bodyDark: boolean
  readonly bodyBg: string
  readonly rootRect: { x: number; y: number; w: number; h: number } | null
  readonly liveRect: { x: number; y: number; w: number; h: number } | null
  readonly panelRect: { x: number; y: number; w: number; h: number } | null
  readonly attrWidth: string | null
  readonly attrSkin: string | null
  readonly attrPage: string | null
  readonly attrDepth: string | null
  readonly bodyPage: string | null
  readonly liveEmpty: string | null
  readonly identityExists: boolean
  readonly vcTabCount: number
}

async function measureUi(page: PageHandle): Promise<Result<UiFacts>> {
  return await evaluateThrough<UiFacts>(page, MEASURE_SCRIPT)
}

// —— 页内取数：壳根、身份行、四页签是公共的；四个页签正文各有一只取数脚本 ——

interface BoxFacts {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}
interface IdentityAct {
  readonly intent: string | null
  readonly text: string
  readonly primary: string | null
  readonly ariaLabel: string | null
}
interface IdentityReason {
  readonly id: string | null
  readonly k: string
  readonly v: string
  readonly className: string
}
interface IdentityFacts {
  readonly repo: string
  readonly worktreePath: string | null
  readonly branch: string
  readonly branchTitle: string | null
  readonly oid: string
  readonly detached: string
  readonly ahead: string | null
  readonly behind: string | null
  readonly readAt: string
  readonly basisText: string
  readonly basisK: string
  readonly basisRemote: string | null
  readonly acts: IdentityAct[]
  readonly reasons: IdentityReason[]
  readonly tools: IdentityTools
}

interface IdentityIcon {
  readonly w: string | null
  readonly h: string | null
  readonly viewBox: string | null
  readonly bw: number
  readonly bh: number
}

interface IdentityTools {
  readonly copyPath: string | null
  readonly handoff: string | null
  readonly search: string | null
  readonly gear: string | null
  readonly icons: IdentityIcon[]
}

/** 宿主面板内容区（.dsws-body）的几何：壳要铺满它，提交区要贴它的底边。 */
interface HostPanelFacts {
  readonly className: string
  readonly box: BoxFacts | null
  readonly clientH: number
  readonly clientW: number
  readonly scrollH: number
  readonly padTop: number
  readonly padBottom: number
  readonly overflowY: string
}

interface HostAncestor {
  readonly tag: string
  readonly cls: string
  readonly h: number
  readonly w: number
  readonly top: number
  readonly bottom: number
  readonly clientH: number
  readonly side: string | null
}
interface TabFacts {
  readonly id: string | null
  readonly label: string
  readonly countState: string | null
  readonly count: string | null
  readonly countText: string
  readonly title: string | null
  readonly selected: string | null
  readonly controls: string | null
  readonly role: string | null
}
interface PageBodyFacts {
  readonly pageAttr: string | null
  readonly id: string
  readonly className: string
  readonly box: BoxFacts | null
  readonly scrollW: number
  readonly clientW: number
  readonly clientH: number
  readonly scrollH: number
  readonly text: string
}
interface BaseFacts {
  readonly found: boolean
  readonly url: string
  readonly innerW: number
  readonly innerH: number
  readonly outerW: number
  readonly outerH: number
  readonly bodyDark: boolean
  readonly root: {
    readonly page: string | null
    readonly width: string | null
    readonly skin: string | null
    readonly depth: string | null
    readonly box: BoxFacts | null
    readonly scrollW: number
    readonly clientW: number
    readonly scrollH: number
    readonly clientH: number
  } | null
  readonly identity: IdentityFacts | null
  readonly tabs: TabFacts[]
  readonly activeTab: string | null
  readonly body: PageBodyFacts | null
  readonly rootCount: number
  readonly host: HostPanelFacts | null
  readonly hostAncestry: HostAncestor[]
}

const INSPECT_BASE_SCRIPT = scriptOf([
  '(() => {',
  '  const Q = (sel, root) => (root || document).querySelector(sel);',
  '  const QA = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));',
  '  const norm = (v) => String(v === null || v === undefined ? ' + JSON.stringify('') + ' : v).split(String.fromCharCode(10)).map((s) => s.trim()).filter((s) => s.length > 0).join(' + JSON.stringify(' ') + ');',
  '  const attr = (el, name) => (el === null || el === undefined ? null : el.getAttribute(name));',
  '  const textOf = (el) => (el === null || el === undefined ? ' + JSON.stringify('') + ' : norm(el.innerText || el.textContent || ' + JSON.stringify('') + '));',
  '  const boxOf = (el) => { if (el === null || el === undefined) { return null; } const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  const rootAll = QA(' + JSON.stringify(VC_ROOT_SELECTOR) + ');',
  '  const panelHost = Q(' + JSON.stringify('.dsws-body') + ');',
  '  const hostedRoot = panelHost === null ? null : Q(' + JSON.stringify(VC_ROOT_SELECTOR) + ', panelHost);',
  '  const root = hostedRoot !== null ? hostedRoot : (rootAll.length > 0 ? rootAll[0] : null);',
  '  if (root === null) { return { found: false, url: location.href, innerW: window.innerWidth, innerH: window.innerHeight, outerW: window.outerWidth, outerH: window.outerHeight, bodyDark: document.body.hasAttribute(' + JSON.stringify('data-ds-dark-theme') + '), rootCount: rootAll.length, host: null, hostAncestry: [], root: null, identity: null, tabs: [], activeTab: null, body: null }; }',
  '  const identityEl = Q(' + JSON.stringify('header[data-vc-identity]') + ');',
  '  let identity = null;',
  '  if (identityEl !== null) {',
  '    const tools = {};',
  '    tools.copyPath = attr(Q(' + JSON.stringify('[data-vc-copy-path]') + ', identityEl), ' + JSON.stringify('data-vc-copy-path') + ');',
  '    tools.handoff = attr(Q(' + JSON.stringify('[data-vc-identity-handoff]') + ', identityEl), ' + JSON.stringify('data-vc-identity-handoff') + ');',
  '    tools.search = Q(' + JSON.stringify('[data-vc-search-entry]') + ', identityEl) === null ? null : ' + JSON.stringify('present') + ';',
  '    tools.gear = attr(Q(' + JSON.stringify('[data-vc-gear-btn]') + ', identityEl), ' + JSON.stringify('aria-expanded') + ');',
  '    tools.icons = QA(' + JSON.stringify('.rail-tools svg') + ', identityEl).map((el) => { const r = el.getBoundingClientRect(); return { w: attr(el, ' + JSON.stringify('width') + '), h: attr(el, ' + JSON.stringify('height') + '), viewBox: attr(el, ' + JSON.stringify('viewBox') + '), bw: Math.round(r.width), bh: Math.round(r.height) }; });',
  '    const syncRow = Q(' + JSON.stringify('[data-vc-sync-facts]') + ', identityEl);',
  '    const basisBtn = Q(' + JSON.stringify('[data-vc-sync="1"][data-vc-sync-remote]') + ', identityEl);',
  '    const readEl = Q(' + JSON.stringify('[data-vc-read-at]') + ', identityEl);',
  '    const actsRow = Q(' + JSON.stringify('[data-vc-sync-acts]') + ', identityEl);',
  '    identity = {',
  '      repo: textOf(Q(' + JSON.stringify('.rail-repo') + ', identityEl)),',
  '      worktreePath: attr(Q(' + JSON.stringify('[data-vc-worktree-path]') + ', identityEl), ' + JSON.stringify('data-vc-worktree-path') + '),',
  '      branch: textOf(Q(' + JSON.stringify('.rail-branch') + ', identityEl)),',
  '      branchTitle: Q(' + JSON.stringify('[data-vc-branch-btn]') + ', identityEl) === null ? null : attr(Q(' + JSON.stringify('[data-vc-branch-btn]') + ', identityEl), ' + JSON.stringify('title') + '),',
  '      oid: textOf(Q(' + JSON.stringify('.rail-oid') + ', identityEl)),',
  '      detached: textOf(Q(' + JSON.stringify('.chip-warn') + ', identityEl)),',
  '      ahead: attr(Q(' + JSON.stringify('.is-ahead') + ', identityEl), ' + JSON.stringify('data-vc-ahead') + '),',
  '      behind: attr(Q(' + JSON.stringify('.is-behind') + ', identityEl), ' + JSON.stringify('data-vc-behind') + '),',
  '      readAt: readEl === null ? ' + JSON.stringify('') + ' : attr(readEl, ' + JSON.stringify('data-vc-read-at') + ') || ' + JSON.stringify('') + ',',
  '      basisText: basisBtn === null ? ' + JSON.stringify('') + ' : textOf(basisBtn),',
  '      basisK: basisBtn === null ? ' + JSON.stringify('') + ' : textOf(Q(' + JSON.stringify('.fact-k') + ', basisBtn)),',
  '      basisRemote: basisBtn === null ? null : attr(basisBtn, ' + JSON.stringify('data-vc-sync-remote') + '),',
  '      acts: actsRow === null ? [] : QA(' + JSON.stringify('button[data-vc-sync-intent]') + ', actsRow).map((el) => ({ intent: attr(el, ' + JSON.stringify('data-vc-sync-intent') + '), text: textOf(el), primary: attr(el, ' + JSON.stringify('data-vc-sync-primary') + '), ariaLabel: attr(el, ' + JSON.stringify('aria-label') + ') })),',
  '      reasons: QA(' + JSON.stringify('[data-vc-reason]') + ', identityEl).map((el) => ({ id: attr(el, ' + JSON.stringify('data-vc-reason') + '), k: textOf(Q(' + JSON.stringify('.reason-k') + ', el)), v: textOf(Q(' + JSON.stringify('.reason-v') + ', el)), className: String(el.className) })),',
  '      tools: tools,',
  '      syncRowExists: syncRow !== null,',
  '    };',
  '  }',
  '  const tabs = QA(' + JSON.stringify('button[data-vc-tab]') + ', root).map((el) => ({',
  '    id: attr(el, ' + JSON.stringify('data-vc-tab') + '),',
  '    label: textOf(Q(' + JSON.stringify('.tab-label') + ', el)),',
  '    countState: attr(Q(' + JSON.stringify('[data-vc-tab-count-state]') + ', el), ' + JSON.stringify('data-vc-tab-count-state') + '),',
  '    count: attr(Q(' + JSON.stringify('[data-vc-tab-count]') + ', el), ' + JSON.stringify('data-vc-tab-count') + '),',
  '    countText: textOf(Q(' + JSON.stringify('.tab-count') + ', el)),',
  '    title: attr(el, ' + JSON.stringify('title') + '),',
  '    selected: attr(el, ' + JSON.stringify('aria-selected') + '),',
  '    controls: attr(el, ' + JSON.stringify('aria-controls') + '),',
  '    role: attr(el, ' + JSON.stringify('role') + '),',
  '  }));',
  '  const active = Q(' + JSON.stringify('button[data-vc-tab].is-on') + ', root);',
  '  const bodyEl = Q(' + JSON.stringify('section[data-vc-page-body]') + ', root);',
  '  let body = null;',
  '  if (bodyEl !== null) {',
  '    body = {',
  '      pageAttr: attr(bodyEl, ' + JSON.stringify('data-vc-page-body') + '),',
  '      id: bodyEl.id,',
  '      className: String(bodyEl.className),',
  '      box: boxOf(bodyEl),',
  '      scrollW: bodyEl.scrollWidth,',
  '      clientW: bodyEl.clientWidth,',
  '      clientH: bodyEl.clientHeight,',
  '      scrollH: bodyEl.scrollHeight,',
  '      text: textOf(bodyEl).slice(0, 3000),',
  '    };',
  '  }',
  '  let hostEl = root.parentElement;',
  '  for (let i = 0; i < 8 && hostEl !== null; i += 1) {',
  '    if (String(hostEl.className).split(' + JSON.stringify(' ') + ').indexOf(' + JSON.stringify('dsws-body') + ') >= 0) { break; }',
  '    hostEl = hostEl.parentElement;',
  '  }',
  '  let host = null;',
  '  if (hostEl !== null) {',
  '    const hcs = getComputedStyle(hostEl);',
  '    host = { className: String(hostEl.className), box: boxOf(hostEl), clientH: hostEl.clientHeight, clientW: hostEl.clientWidth, scrollH: hostEl.scrollHeight, padTop: parseFloat(hcs.paddingTop) || 0, padBottom: parseFloat(hcs.paddingBottom) || 0, overflowY: hcs.overflowY };',
  '  }',
  '  const hostAncestry = [];',
  '  let walk = root.parentElement;',
  '  for (let i = 0; i < 6 && walk !== null; i += 1) {',
  '    const wr = walk.getBoundingClientRect();',
  '    hostAncestry.push({ tag: walk.tagName, cls: String(walk.className).slice(0, 120), h: Math.round(wr.height), w: Math.round(wr.width), top: Math.round(wr.top), bottom: Math.round(wr.bottom), clientH: walk.clientHeight, side: attr(walk, ' + JSON.stringify('data-side') + ') });',
  '    walk = walk.parentElement;',
  '  }',
  '  return {',
  '    found: true,',
  '    rootCount: rootAll.length,',
  '    host: host,',
  '    hostAncestry: hostAncestry,',
  '    url: location.href,',
  '    innerW: window.innerWidth,',
  '    innerH: window.innerHeight,',
  '    outerW: window.outerWidth,',
  '    outerH: window.outerHeight,',
  '    bodyDark: document.body.hasAttribute(' + JSON.stringify('data-ds-dark-theme') + '),',
  '    root: {',
  '      page: attr(root, ' + JSON.stringify('data-vc-page') + '),',
  '      width: attr(root, ' + JSON.stringify('data-vc-width') + '),',
  '      skin: attr(root, ' + JSON.stringify('data-vc-skin') + '),',
  '      depth: attr(root, ' + JSON.stringify('data-vc-depth') + '),',
  '      box: boxOf(root),',
  '      scrollW: root.scrollWidth,',
  '      clientW: root.clientWidth,',
  '      scrollH: root.scrollHeight,',
  '      clientH: root.clientHeight,',
  '    },',
  '    identity: identity,',
  '    tabs: tabs,',
  '    activeTab: active === null ? null : attr(active, ' + JSON.stringify('data-vc-tab') + '),',
  '    body: body,',
  '  };',
  '})()',
])

async function inspectBase(page: PageHandle): Promise<Result<BaseFacts>> {
  return await evaluateThrough<BaseFacts>(page, INSPECT_BASE_SCRIPT)
}

// —— 页签正文取数：四个页签各一只脚本，返回能直接进 JSON 的明文事实 ——

/** 页内取数脚本的公共小工具（不用正则与反斜杠，避开转义口径）。 */
function inspectPreludeLines(): string[] {
  return [
    '  const Q = (sel, root) => (root || document).querySelector(sel);',
    '  const QA = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));',
    '  const norm = (v) => String(v === null || v === undefined ? "" : v).split(String.fromCharCode(10)).map((s) => s.trim()).filter((s) => s.length > 0).join(" ");',
    '  const attr = (el, name) => (el === null || el === undefined ? null : el.getAttribute(name));',
    '  const textOf = (el) => (el === null || el === undefined ? "" : norm(el.innerText || el.textContent || ""));',
  ]
}

const CHANGES_SCRIPT = scriptOf([
  '(() => {',
  ...inspectPreludeLines(),
  '  const boxOf = (el) => { if (el === null || el === undefined) { return null; } const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };',
  '  const root = Q(' + JSON.stringify('[data-vc-changes-view]') + ');',
  '  if (root === null) { return { found: false }; }',
  '  const stats = QA(' + JSON.stringify('[data-vc-stat]') + ', root).map((el) => ({ value: attr(el, ' + JSON.stringify('data-vc-stat') + '), n: textOf(Q(' + JSON.stringify('.stat-n') + ', el)), label: textOf(Q(' + JSON.stringify('.stat-t') + ', el)), pressed: attr(el, ' + JSON.stringify('aria-pressed') + ') }));',
  '  const groups = QA(' + JSON.stringify('[data-vc-file-group]') + ', root).map((el) => ({ id: attr(el, ' + JSON.stringify('data-vc-file-group') + '), title: textOf(Q(' + JSON.stringify('.group-title') + ', el)), count: textOf(Q(' + JSON.stringify('.group-count') + ', el)), empty: Q(' + JSON.stringify('[data-vc-file-group-empty]') + ', el) !== null, all: attr(Q(' + JSON.stringify('[data-vc-file-group-all]') + ', el), ' + JSON.stringify('data-vc-file-group-all') + ') }));',
  '  const rows = QA(' + JSON.stringify('[data-vc-file-row]') + ', root).map((el) => ({',
  '    path: attr(el, ' + JSON.stringify('data-vc-file-row') + '),',
  '    change: attr(el, ' + JSON.stringify('data-vc-file-change') + '),',
  '    conflict: attr(el, ' + JSON.stringify('data-vc-file-conflict') + '),',
  '    deltaAdd: textOf(Q(' + JSON.stringify('[data-vc-file-delta] .dl-add') + ', el)),',
  '    deltaDel: textOf(Q(' + JSON.stringify('[data-vc-file-delta] .dl-del') + ', el)),',
  '    untracked: textOf(Q(' + JSON.stringify('.chip-untracked') + ', el)),',
  '    dir: textOf(Q(' + JSON.stringify('.file-dir') + ', el)),',
  '    name: textOf(Q(' + JSON.stringify('.file-name') + ', el)),',
  '    ops: QA(' + JSON.stringify('[data-vc-file-op]') + ', el).map((b) => attr(b, ' + JSON.stringify('data-vc-file-op') + ')),',
  '  }));',
  '  const panelEl = Q(' + JSON.stringify('[data-vc-commit-panel]') + ');',
  '  let commitPanel = null;',
  '  if (panelEl !== null) {',
  '    const submitEl = Q(' + JSON.stringify('[data-vc-commit-submit]') + ', panelEl);',
  '    commitPanel = {',
  '      exists: true,',
  '      stagedCount: textOf(Q(' + JSON.stringify('[data-vc-staged-count]') + ', panelEl)),',
  '      stagedCountAttr: attr(Q(' + JSON.stringify('[data-vc-staged-count]') + ', panelEl), ' + JSON.stringify('data-vc-staged-count') + '),',
  '      submitText: textOf(submitEl),',
  '      submitDisabled: submitEl === null ? null : attr(submitEl, ' + JSON.stringify('disabled') + '),',
  '      messagePlaceholder: attr(Q(' + JSON.stringify('[data-vc-commit-msg]') + ', panelEl), ' + JSON.stringify('placeholder') + '),',
  '      modes: QA(' + JSON.stringify('[data-vc-commit-mode]') + ', panelEl).map((el) => ({ mode: attr(el, ' + JSON.stringify('data-vc-commit-mode') + '), pressed: attr(el, ' + JSON.stringify('aria-pressed') + '), text: textOf(el) })),',
  '      target: textOf(Q(' + JSON.stringify('[data-vc-commit-target]') + ', panelEl)),',
  '      unstagedAll: Q(' + JSON.stringify('[data-vc-commit-unstage-all]') + ', panelEl) !== null,',
  '      rect: boxOf(panelEl),',
  '    };',
  '  }',
  '  const shellEl = Q(' + JSON.stringify('[data-vc-shell]') + ');',
  '  const bodyEl = Q(' + JSON.stringify('section[data-vc-page-body]') + ');',
  '  return { found: true, filter: attr(root, ' + JSON.stringify('data-vc-changes-filter') + '), stats: stats, groups: groups, rows: rows, statsCount: stats.length, rowCount: rows.length, commitPanel: commitPanel, geometry: { shell: boxOf(shellEl), body: boxOf(bodyEl), composer: commitPanel === null ? null : commitPanel.rect, viewportH: window.innerHeight } };',
  '})()',
])

const COMMITS_SCRIPT = scriptOf([
  '(() => {',
  ...inspectPreludeLines(),
  '  const head = Q(' + JSON.stringify('[data-vc-history]') + ');',
  '  const root = Q(' + JSON.stringify('[data-vc-history-root]') + ');',
  '  if (head === null && root === null) { return { found: false }; }',
  '  const rows = QA(' + JSON.stringify('[data-vc-history-row]') + ').map((el) => ({',
  '    oid: attr(el, ' + JSON.stringify('data-vc-history-row') + '),',
  '    short: textOf(Q(' + JSON.stringify('[data-vc-history-short]') + ', el)),',
  '    subject: textOf(Q(' + JSON.stringify('.commit-subject') + ', el)),',
  '    merge: Q(' + JSON.stringify('.commit-subject-merge') + ', el) !== null,',
  '    mergeLead: textOf(Q(' + JSON.stringify('.commit-merge-lead') + ', el)),',
  '    mergeRaw: textOf(Q(' + JSON.stringify('.commit-merge-raw') + ', el)),',
  '    author: textOf(Q(' + JSON.stringify('[data-vc-history-author]') + ', el)),',
  '    when: textOf(Q(' + JSON.stringify('[data-vc-history-when]') + ', el)),',
  '    more: Q(' + JSON.stringify('[data-vc-history-more]') + ', el) !== null,',
  '  }));',
  '  return {',
  '    found: true,',
  '    state: attr(head, ' + JSON.stringify('data-vc-history-state') + '),',
  '    count: attr(head, ' + JSON.stringify('data-vc-history-count') + '),',
  '    scope: textOf(Q(' + JSON.stringify('[data-vc-history-scope]') + ')),',
  '    queryPlaceholder: attr(Q(' + JSON.stringify('[data-vc-history-query]') + '), ' + JSON.stringify('placeholder') + '),',
  '    mergeOnly: attr(Q(' + JSON.stringify('[data-vc-history-merge-only]') + '), ' + JSON.stringify('aria-pressed') + '),',
  '    rows: rows,',
  '    rowCount: rows.length,',
  '    mergeCount: rows.filter((row) => row.merge).length,',
  '    loading: Q(' + JSON.stringify('[data-vc-history-loading]') + ') !== null,',
  '    error: Q(' + JSON.stringify('[data-vc-history-error]') + ') !== null,',
  '    empty: Q(' + JSON.stringify('[data-vc-history-empty]') + ') !== null,',
  '    filterEmpty: Q(' + JSON.stringify('[data-vc-history-filter-empty]') + ') !== null,',
  '    loadMore: Q(' + JSON.stringify('[data-vc-load-more]') + ') !== null,',
  '    moreState: attr(Q(' + JSON.stringify('[data-vc-history-more-state]') + '), ' + JSON.stringify('data-vc-history-more-state') + '),',
  '    graph: Q(' + JSON.stringify('[data-vc-graph]') + ') !== null,',
  '    detail: Q(' + JSON.stringify('[data-vc-history-detail]') + ') !== null,',
  '  };',
  '})()',
])

const WORKTREES_SCRIPT = scriptOf([
  '(() => {',
  ...inspectPreludeLines(),
  '  const root = Q(' + JSON.stringify('[data-vc-wt-page]') + ');',
  '  if (root === null) { return { found: false }; }',
  '  const rows = QA(' + JSON.stringify('[data-wt-row]') + ', root).map((el) => ({',
  '    path: attr(el, ' + JSON.stringify('data-wt-path') + '),',
  '    current: attr(el, ' + JSON.stringify('data-wt-current') + '),',
  '    locked: el.hasAttribute(' + JSON.stringify('data-wt-locked') + '),',
  '    prunable: el.hasAttribute(' + JSON.stringify('data-wt-prunable') + '),',
  '    name: textOf(Q(' + JSON.stringify('.wt-name') + ', el)),',
  '    branch: textOf(Q(' + JSON.stringify('.wt-branch') + ', el)),',
  '    oid: textOf(Q(' + JSON.stringify('[data-wt-row-oid]') + ', el)),',
  '    stateChip: attr(Q(' + JSON.stringify('[data-wt-state]') + ', el), ' + JSON.stringify('data-wt-state') + '),',
  '  }));',
  '  const entries = QA(' + JSON.stringify('[data-wt-entry]') + ', root).map((el) => ({ cap: attr(el, ' + JSON.stringify('data-wt-entry') + '), name: textOf(Q(' + JSON.stringify('.vc-wt-cap-name') + ', el)), cmd: textOf(Q(' + JSON.stringify('.vc-wt-cap-cmd') + ', el)), buttons: QA(' + JSON.stringify('[data-wt-action]') + ', el).map((b) => attr(b, ' + JSON.stringify('data-wt-action') + ')) }));',
  '  const currentCard = Q(' + JSON.stringify('[data-wt-current-card]') + ', root);',
  '  return {',
  '    found: true,',
  '    mode: attr(root, ' + JSON.stringify('data-vc-wt-mode') + '),',
  '    state: attr(root, ' + JSON.stringify('data-vc-wt-state') + '),',
  '    otherCount: textOf(Q(' + JSON.stringify('[data-wt-other-count]') + ', root)),',
  '    abnormalCount: textOf(Q(' + JSON.stringify('[data-wt-abnormal-count]') + ', root)),',
  '    rows: rows,',
  '    rowCount: rows.length,',
  '    entries: entries,',
  '    entryCount: entries.length,',
  '    currentCard: currentCard === null ? null : { text: textOf(currentCard), oid: attr(currentCard, ' + JSON.stringify('data-wt-current-oid') + ') },',
  '    list: Q(' + JSON.stringify('[data-wt-list]') + ', root) !== null,',
  '    empty: Q(' + JSON.stringify('[data-wt-empty]') + ', root) !== null,',
  '    filterEmpty: Q(' + JSON.stringify('[data-wt-filter-empty]') + ', root) !== null,',
  '    handoff: Q(' + JSON.stringify('[data-wt-handoff]') + ', root) !== null,',
  '    notice: textOf(Q(' + JSON.stringify('[data-wt-notice]') + ', root)),',
  '  };',
  '})()',
])

const STASH_SCRIPT = scriptOf([
  '(() => {',
  ...inspectPreludeLines(),
  '  const root = Q(' + JSON.stringify('[data-vc-stash-page]') + ');',
  '  if (root === null) { return { found: false }; }',
  '  const rows = QA(' + JSON.stringify('[data-vc-stash-entry]') + ', root).map((el) => ({',
  '    selector: attr(el, ' + JSON.stringify('data-vc-stash-entry') + '),',
  '    oidFull: attr(el, ' + JSON.stringify('data-vc-stash-oid-full') + '),',
  '    subject: textOf(Q(' + JSON.stringify('[data-vc-stash-subject]') + ', el)),',
  '    at: textOf(Q(' + JSON.stringify('[data-vc-stash-at]') + ', el)),',
  '    files: textOf(Q(' + JSON.stringify('[data-vc-stash-files]') + ', el)),',
  '    oid: textOf(Q(' + JSON.stringify('[data-vc-stash-oid]') + ', el)),',
  '    ops: QA(' + JSON.stringify('[data-vc-stash-op]') + ', el).map((b) => ({ op: attr(b, ' + JSON.stringify('data-vc-stash-op') + '), cap: attr(b, ' + JSON.stringify('data-vc-stash-cap') + '), text: textOf(b) })),',
  '  }));',
  '  return {',
  '    found: true,',
  '    count: attr(root, ' + JSON.stringify('data-vc-stash-count') + '),',
  '    version: attr(root, ' + JSON.stringify('data-vc-stash-version') + '),',
  '    pending: attr(root, ' + JSON.stringify('data-vc-stash-pending') + '),',
  '    list: attr(Q(' + JSON.stringify('[data-vc-stash-list]') + ', root), ' + JSON.stringify('data-vc-stash-list') + '),',
  '    rows: rows,',
  '    rowCount: rows.length,',
  '    opCount: QA(' + JSON.stringify('[data-vc-stash-op]') + ', root).length,',
  '    recent: attr(Q(' + JSON.stringify('[data-vc-stash-recent]') + ', root), ' + JSON.stringify('data-vc-stash-recent') + '),',
  '    messageInput: Q(' + JSON.stringify('[data-vc-stash-message-input]') + ', root) !== null,',
  '    boundary: Q(' + JSON.stringify('[data-vc-stash-boundary]') + ', root) !== null,',
  '  };',
  '})()',
])

function inspectViewScript(view: ViewName): string {
  if (view === 'changes') return CHANGES_SCRIPT
  if (view === 'commits') return COMMITS_SCRIPT
  if (view === 'worktrees') return WORKTREES_SCRIPT
  return STASH_SCRIPT
}

async function inspectView(page: PageHandle, view: ViewName): Promise<Result<Record<string, unknown>>> {
  const probe = await evaluateThrough<Record<string, unknown>>(page, inspectViewScript(view))
  return probe
}

/** 从页内取回来的 JSON 里安全地读字段：类型不对就回空串/空数组，判据自己再判。 */
function strOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function numOf(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

// —— 结构判据：壳（身份行 + 四页签）与四个页签正文各一组，全部落成可读的检查项 ——

interface CheckItem {
  readonly id: string
  readonly ok: boolean
  readonly expected: string
  readonly actual: string
  readonly soft: boolean
}
interface CheckReport {
  readonly ok: boolean
  readonly items: CheckItem[]
  readonly failed: string[]
  readonly softFailed: string[]
}

/** 提交号短哈希只认 7 位小写十六进制；不用正则，避开转义口径。 */
function isHexShort(value: string, wantedLength: number): boolean {
  if (value.length !== wantedLength) return false
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    const isDigit = code >= 48 && code <= 57
    const isLowerHex = code >= 97 && code <= 102
    if (!isDigit && !isLowerHex) return false
  }
  return true
}

function checkStructure(view: ViewName, width: number, skin: Skin, base: BaseFacts, detail: Record<string, unknown>): CheckReport {
  const items: CheckItem[] = []
  const add = (id: string, ok: boolean, expected: string, actual: string, soft = false): void => {
    items.push({ id: id, ok: ok, expected: expected, actual: actual, soft: soft })
  }
  const root = base.root
  if (root === null || base.found !== true) {
    add('shell-root', false, '壳根 [data-vc-root] 带 data-vc-width 挂出来', '没找到壳根')
    return { ok: false, items: items, failed: ['shell-root'], softFailed: [] }
  }
  add('shell-root-page', root.page === view, 'data-vc-page=' + view, 'data-vc-page=' + String(root.page))
  add('shell-width', root.width === String(width), 'data-vc-width=' + String(width), 'data-vc-width=' + String(root.width))
  add('shell-skin', root.skin === skin, 'data-vc-skin=' + skin, 'data-vc-skin=' + String(root.skin))
  add('shell-identity', base.identity !== null, '身份行 header[data-vc-identity] 存在', base.identity === null ? '没有身份行' : '身份行在')
  add('shell-body', base.body !== null, '页体 section[data-vc-page-body] 存在', base.body === null ? '没有页体' : '页体在 data-vc-page-body=' + String(base.body.pageAttr))
  const host = base.host
  const hostAvailable = host === null ? null : host.clientH - host.padTop - host.padBottom
  const shellH = root.box === null ? null : root.box.h
  add('shell-fill-height', hostAvailable !== null && shellH !== null && Math.abs(shellH - hostAvailable) <= 2, '壳高 = 宿主内容区可用高（.dsws-body clientH 减上下内边距，误差 ≤2px）', host === null ? '没找到 .dsws-body 宿主' : '壳 ' + String(shellH) + 'px / 可用 ' + String(hostAvailable) + 'px（宿主 clientH=' + String(host.clientH) + ' padding=' + String(host.padTop) + '/' + String(host.padBottom) + ' overflowY=' + host.overflowY + '）')

  const tabs = base.tabs
  const tabIds = tabs.map((tab) => String(tab.id))
  add('tabs-count', tabs.length === 4, '四个一级页签', '实际 ' + String(tabs.length) + ' 个：' + tabIds.join(','))
  const wantedIds = 'changes,commits,worktrees,stash'
  add('tabs-order', tabIds.join(',') === wantedIds, wantedIds, tabIds.join(','))
  const labelsOk = tabs.length === 4 && tabs.every((tab) => tab.label === VIEW_TITLES[tab.id as ViewName])
  add('tabs-labels', labelsOk, '改动 / 提交历史 / 工作区 / 储藏', tabs.map((tab) => tab.label).join(' / '))
  const countWanted: Record<ViewName, number> = { changes: EXPECTED_CHANGES, commits: EXPECTED_COMMITS, worktrees: WORKTREE_COUNT, stash: EXPECTED_STASH }
  for (const tab of tabs) {
    const tabId = String(tab.id) as ViewName
    const wanted = countWanted[tabId]
    if (wanted === undefined) continue
    add('tab-count-' + tabId, tab.countState === 'ok' && tab.count === String(wanted), String(wanted), String(tab.countState) + '/' + String(tab.count) + ' ' + tab.countText)
  }
  add('tab-active', base.activeTab === view && tabs.some((tab) => tab.id === view && tab.selected === 'true'), '当前页签 aria-selected=true 且 is-on', 'activeTab=' + String(base.activeTab))
  add('body-page', base.body !== null && base.body.pageAttr === view, '页体 data-vc-page-body=' + view, base.body === null ? '没有页体' : '页体 ' + String(base.body.pageAttr))
  add('body-text', base.body !== null && base.body.text.length > 20, '页体正文非空（>20 字）', base.body === null ? '没有页体' : String(base.body.text.length) + ' 字')
  add('body-overflow-x', base.body !== null && base.body.scrollW <= base.body.clientW + 2, '页体不出现横向溢出', base.body === null ? '没有页体' : 'scrollW=' + String(base.body.scrollW) + ' clientW=' + String(base.body.clientW), true)

  const identity = base.identity
  if (identity !== null) {
    add('identity-branch', identity.branch === 'main', 'main', identity.branch)
    add('identity-oid', isHexShort(identity.oid, 7), '7 位提交号', identity.oid)
    add('identity-ahead', identity.ahead === String(AHEAD), String(AHEAD), String(identity.ahead))
    add('identity-behind', identity.behind === String(BEHIND), String(BEHIND), String(identity.behind))
    add('identity-read-at', identity.readAt.length > 0, '读取于有相对时间', identity.readAt)
    add('identity-basis', identity.basisText.indexOf('分钟前') >= 0, '远端依据读成 12 分钟前', identity.basisText)
    add('identity-basis-remote', identity.basisRemote === 'origin', 'data-vc-sync-remote=origin', String(identity.basisRemote))
    const push = identity.acts.filter((act) => act.intent === 'push')
    add('identity-push-primary', push.length === 1 && push[0].primary === '1', 'ahead 2 时 push 是建议动作', push.length === 0 ? '没有 push' : String(push[0].primary))
    const pull = identity.acts.filter((act) => act.intent === 'pull')
    add('identity-pull', pull.length === 1, '同步带里有 pull', String(pull.length))
    add('identity-fetch', identity.acts.some((act) => act.intent === 'fetch'), '同步带里有 fetch', String(identity.acts.length) + ' 个动作')
    const icons = identity.tools.icons
    const iconSizeOk = icons.length === 4 && icons.every((icon) => (icon.w === '14' && icon.h === '14') || (icon.bw === 14 && icon.bh === 14))
    add('identity-icon-count', icons.length === 4, '身份行工具组四颗图标', String(icons.length) + ' 颗：' + icons.map((icon) => String(icon.w) + 'x' + String(icon.h) + '（渲染 ' + String(icon.bw) + 'x' + String(icon.bh) + '）').join(','))
    add('identity-icon-size-14', iconSizeOk, '四颗 svg 宽高为 14（属性或渲染尺寸其一）', icons.map((icon) => String(icon.w) + 'x' + String(icon.h) + ' / ' + String(icon.bw) + 'x' + String(icon.bh)).join('，'))
    const pullReason = identity.reasons.filter((reason) => reason.id === 'pull')[0]
    add('identity-reasons', pullReason !== undefined && pullReason.className.indexOf('is-warn') >= 0 && pullReason.v.length > 0, '原因行有一条 pull is-warn 且原因句非空', identity.reasons.length === 0 ? '没有原因行' : identity.reasons.map((reason) => String(reason.id) + ' / ' + reason.className + ' / ' + reason.v).join('；'))
  }

  if (view === 'changes') {
    const stats = listOf(detail.stats) as Record<string, unknown>[]
    add('changes-view', detail.found === true, '[data-vc-changes-view] 存在', detail.found === true ? '在' : '不在')
    add('changes-stats', stats.length === 3, '三颗统计（冲突/已暂存/未暂存）', '实际 ' + String(stats.length) + ' 颗：' + stats.map((stat) => strOf(stat.value)).join(','))
    const rows = listOf(detail.rows) as Record<string, unknown>[]
    add('changes-file-rows', rows.length === EXPECTED_CHANGES, String(EXPECTED_CHANGES) + ' 个文件行', String(rows.length) + ' 个')
    const untracked = rows.filter((row) => strOf(row.untracked).length > 0)
    add('changes-untracked', untracked.length === EXPECTED_UNTRACKED, String(EXPECTED_UNTRACKED) + ' 个未跟踪', String(untracked.length) + ' 个')
    for (const wanted of TRACKED_DELTAS) {
      const row = rows.filter((candidate) => strOf(candidate.path) === wanted.path)[0]
      const ok = row !== undefined && strOf(row.deltaAdd) === wanted.add && strOf(row.deltaDel) === wanted.del
      add('changes-delta-' + wanted.path.split('/').join('-'), ok, wanted.add + '/' + wanted.del, row === undefined ? '没有这一行' : strOf(row.deltaAdd) + '/' + strOf(row.deltaDel))
    }
    const longest = rows.filter((row) => strOf(row.path) === LONGEST_UNTRACKED_PATH)[0]
    add('changes-longest-path', longest !== undefined, '清单里有 ' + LONGEST_UNTRACKED_PATH, longest === undefined ? '没有这一行' : strOf(longest.dir) + ' + ' + strOf(longest.name))
    const panel = asRecord(detail.commitPanel)
    add('changes-commit-panel', panel !== null, '提交区 [data-vc-commit-panel] 存在', panel === null ? '不在' : '在，已暂存 ' + strOf(panel.stagedCount))
    add('changes-staged-zero', panel !== null && strOf(panel.stagedCount).indexOf('0') >= 0, '已暂存 0', panel === null ? '没有提交区' : strOf(panel.stagedCount))
    const geometry = asRecord(detail.geometry)
    const composerBox = geometry === null ? null : asRecord(geometry.composer)
    const composerBottom = composerBox === null ? Number.NaN : numOf(composerBox.bottom)
    const hostBottom = host === null ? Number.NaN : host.box.y + host.clientH - host.padBottom
    add('changes-composer-bottom', Number.isFinite(composerBottom) && Number.isFinite(hostBottom) && Math.abs(composerBottom - hostBottom) <= 2, '提交区底边贴面板可视区底边（宿主内容区底边 ±2px）', Number.isFinite(composerBottom) ? 'composer 底 ' + String(composerBottom) + ' / 可视区底 ' + String(hostBottom) + (host === null ? '（没找到宿主）' : '（宿主 y=' + String(host.box.y) + ' clientH=' + String(host.clientH) + ' padBottom=' + String(host.padBottom) + '）') : '没有提交区几何')
    const viewportH = geometry === null ? Number.NaN : numOf(geometry.viewportH)
    add('changes-composer-visible', Number.isFinite(composerBottom) && Number.isFinite(viewportH) && composerBottom <= viewportH + 2, '提交区底边不超出可视区（≤ innerHeight）', Number.isFinite(composerBottom) ? 'composer 底 ' + String(composerBottom) + ' / innerH ' + String(viewportH) : '没有提交区几何')
  }

  if (view === 'commits') {
    const rows = listOf(detail.rows) as Record<string, unknown>[]
    add('commits-view', detail.found === true, '[data-vc-history] 存在', detail.found === true ? '在' : '不在')
    add('commits-state', strOf(detail.state) === 'ok', '提交历史读数 state=ok', strOf(detail.state))
    add('commits-count', strOf(detail.count) === String(EXPECTED_COMMITS), '已加载 50', strOf(detail.count))
    add('commits-rows', rows.length === EXPECTED_COMMITS, String(EXPECTED_COMMITS) + ' 行', String(rows.length) + ' 行')
    const merges = rows.filter((row) => row.merge === true)
    add('commits-merge', merges.length === EXPECTED_MERGES, '1 个合并提交', String(merges.length) + ' 个')
    add('commits-scope', strOf(detail.scope).indexOf('50') >= 0, '范围行里写着 50', strOf(detail.scope))
    add('commits-graph', detail.graph === true, '历史图 [data-vc-graph] 存在', detail.graph === true ? '在' : '不在')
    const first = rows.length > 0 ? rows[0] : null
    add('commits-first-subject', first !== null && strOf(first.subject).indexOf('第 50 次提交') >= 0, '第一行是第 50 次提交（HEAD）', first === null ? '没有行' : strOf(first.subject))
    if (width >= 380) {
      const shorts = rows.filter((row) => isHexShort(strOf(row.short), 7))
      add('commits-short', shorts.length === rows.length && rows.length > 0, '每行都有 7 位短哈希', String(shorts.length) + '/' + String(rows.length))
    }
    const mergedRow = merges.length > 0 ? merges[0] : null
    add('commits-merge-lead', mergedRow !== null && strOf(mergedRow.mergeLead).length > 0, '合并行有「合并」标记', mergedRow === null ? '没有合并行' : strOf(mergedRow.mergeLead))
  }

  if (view === 'worktrees') {
    const rows = listOf(detail.rows) as Record<string, unknown>[]
    add('worktrees-view', detail.found === true, '[data-vc-wt-page] 存在', detail.found === true ? '在' : '不在')
    add('worktrees-mode', strOf(detail.mode) === 'idle', 'data-vc-wt-mode=idle', strOf(detail.mode))
    add('worktrees-state', strOf(detail.state) === 'ok', 'data-vc-wt-state=ok', strOf(detail.state))
    add('worktrees-other-count', strOf(detail.otherCount).indexOf(String(WORKTREE_COUNT)) >= 0, String(WORKTREE_COUNT) + ' 棵其他工作树', strOf(detail.otherCount))
    add('worktrees-rows', rows.length === WORKTREE_COUNT, String(WORKTREE_COUNT) + ' 行', String(rows.length) + ' 行')
    const card = asRecord(detail.currentCard)
    add('worktrees-current-card', card !== null, '当前工作区卡 [data-wt-current-card] 存在', card === null ? '不在' : '在：' + snippet(strOf(card.text), 120) + ' oid=' + strOf(card.oid))
    add('worktrees-current-card-text', card !== null && strOf(card.text).length > 0, '当前卡里有可读文本', card === null ? '没有卡' : snippet(strOf(card.text), 160))
    add('worktrees-list', detail.list === true, '工作树清单存在', detail.list === true ? '在' : '不在')
  }

  if (view === 'stash') {
    const rows = listOf(detail.rows) as Record<string, unknown>[]
    add('stash-view', detail.found === true, '[data-vc-stash-page] 存在', detail.found === true ? '在' : '不在')
    add('stash-count', strOf(detail.count) === String(EXPECTED_STASH), 'data-vc-stash-count=1', strOf(detail.count))
    add('stash-rows', rows.length === EXPECTED_STASH, '1 条储藏', String(rows.length) + ' 条')
    add('stash-list', strOf(detail.list) === 'ok', '储藏列表读数 ok', strOf(detail.list))
    const row = rows.length > 0 ? rows[0] : null
    add('stash-subject', row !== null && strOf(row.subject).indexOf('1860') >= 0, '标题里有 1860', row === null ? '没有储藏行' : strOf(row.subject))
    const at = row === null ? '' : strOf(row.at)
    const atRelative = at.indexOf('2026-') < 0 && ['刚刚', '秒前', '分钟前', '小时前', '天前', '周前'].some((word) => at.indexOf(word) >= 0)
    add('stash-at', at.length > 0 && atRelative, '贮藏时间是相对说法（不含 2026- 日期）', row === null ? '没有储藏行' : at)
    add('stash-ops', numOf(detail.opCount) > 0, '每行有操作按钮', String(detail.opCount))
    add('stash-boundary', detail.boundary === true, '页脚边界说明存在', detail.boundary === true ? '在' : '不在')
  }

  const failed = items.filter((item) => !item.ok && !item.soft).map((item) => item.id)
  const softFailed = items.filter((item) => !item.ok && item.soft).map((item) => item.id)
  return { ok: failed.length === 0, items: items, failed: failed, softFailed: softFailed }
}

// —— 宽度标定：先真实拖右栏把手，拖不动再退回改窗口内宽 ——

interface MouseLike {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>
  down(): Promise<void>
  up(): Promise<void>
}
interface PlaywrightPageLike {
  mouse: MouseLike
  evaluate<T>(script: string): Promise<T>
}
interface HandleRect {
  readonly x: number
  readonly y: number
  readonly innerW: number
  readonly innerH: number
  readonly source?: string
  readonly edgeX?: number
}

function playwrightPageOf(raw: RawBrowserPage): PlaywrightPageLike | null {
  const candidate = raw.page
  if (candidate === null || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  if (record.mouse === null || typeof record.mouse !== 'object') return null
  return candidate as PlaywrightPageLike
}

const HANDLE_RECT_SCRIPT = scriptOf([
  '(() => {',
  '  const handle = document.querySelector(' + JSON.stringify('div[data-side="rightbar"]') + ');',
  '  if (handle === null) { return null; }',
  '  const r = handle.getBoundingClientRect();',
  '  const y = Math.min(Math.max(80, Math.round(r.y + r.height / 2)), window.innerHeight - 80);',
  '  let x = Math.round(r.x + r.width / 2);',
  '  let source = "container-center";',
  '  let best = null;',
  '  let bestGap = 1e9;',
  '  const all = document.querySelectorAll("*");',
  '  for (let i = 0; i < all.length; i += 1) {',
  '    const node = all[i];',
  '    const cursor = getComputedStyle(node).cursor;',
  '    const isSplitter = cursor === "col-resize" || cursor === "ew-resize" || node.getAttribute("role") === "separator";',
  '    if (!isSplitter) { continue; }',
  '    const nr = node.getBoundingClientRect();',
  '    if (nr.height < 40) { continue; }',
  '    const gap = Math.abs(nr.left + nr.width / 2 - r.left);',
  '    if (gap < 24 && gap < bestGap) { best = nr; bestGap = gap; }',
  '  }',
  '  if (best !== null) { x = Math.round(best.left + best.width / 2); source = "splitter"; }',
  '  else { x = Math.round(r.left + 4); source = "container-left-edge"; }',
  '  return { x: x, y: y, innerW: window.innerWidth, innerH: window.innerHeight, source: source, edgeX: Math.round(r.left) };',
  '})()',
])

const RIGHTBAR_PROBE_SCRIPT = scriptOf([
  '(() => {',
  '  const el = document.querySelector(' + JSON.stringify('div[data-side="rightbar"]') + ');',
  '  if (el === null) { return { found: false }; }',
  '  const r = el.getBoundingClientRect();',
  '  const y = Math.round(r.top + r.height / 2);',
  '  const at = [];',
  '  for (let dx = -10; dx <= 10; dx += 2) {',
  '    const node = document.elementFromPoint(Math.round(r.left) + dx, y);',
  '    if (node === null) { at.push({ dx: dx, node: null }); continue; }',
  '    const nr = node.getBoundingClientRect();',
  '    at.push({ dx: dx, tag: node.tagName, cls: String(node.className).slice(0, 140), cursor: getComputedStyle(node).cursor, side: node.getAttribute("data-side"), w: Math.round(nr.width) });',
  '  }',
  '  const seps = [];',
  '  const all = document.querySelectorAll("*");',
  '  for (let i = 0; i < all.length && seps.length < 8; i += 1) {',
  '    const node = all[i];',
  '    const cursor = getComputedStyle(node).cursor;',
  '    if (cursor === "col-resize" || cursor === "ew-resize" || node.getAttribute("role") === "separator") {',
  '      const nr = node.getBoundingClientRect();',
  '      seps.push({ tag: node.tagName, cls: String(node.className).slice(0, 140), cursor: cursor, role: node.getAttribute("role"), x: Math.round(nr.left), y: Math.round(nr.top), w: Math.round(nr.width), h: Math.round(nr.height) });',
  '    }',
  '  }',
  '  return { found: true, rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, sample: String(el.outerHTML).slice(0, 1200), at: at, seps: seps, innerW: window.innerWidth };',
  '})()',
])

interface WidthCalibration {
  readonly ok: boolean
  readonly via: string
  readonly detail: string
  readonly rounds: number
  readonly trace: unknown[]
}

/** 真实拖 div[data-side="rightbar"]：面板宽与把手位移一一对应，按实测差一次拖到位。 */
async function calibrateByDrag(page: PageHandle, raw: RawBrowserPage, target: number): Promise<WidthCalibration> {
  const trace: unknown[] = []
  const pw = playwrightPageOf(raw)
  if (pw === null) return { ok: false, via: 'drag', detail: '浏览器适配器没有可拖拽的原始页面', rounds: 0, trace: trace }
  for (let round = 1; round <= 8; round += 1) {
    const measured = await measureUi(page)
    if (measured.ok && measured.value.attrWidth === String(target)) {
      return { ok: true, via: 'drag', detail: '拖把手拖到 ' + String(target) + ' 档', rounds: round - 1, trace: trace }
    }
    if (!measured.ok || measured.value.attrWidth === null) {
      trace.push({ round: round, problem: '读不到 data-vc-width' })
      return { ok: false, via: 'drag', detail: '读不到当前面板档位', rounds: round, trace: trace }
    }
    const current = Number(measured.value.attrWidth)
    const handle = await pw.evaluate<HandleRect | null>(HANDLE_RECT_SCRIPT)
    if (handle === null) {
      trace.push({ round: round, problem: '找不到右栏把手' })
      return { ok: false, via: 'drag', detail: '找不到 div[data-side="rightbar"] 把手', rounds: round, trace: trace }
    }
    const delta = current - target
    const maxStep = Math.max(40, Math.round(handle.innerW / 2))
    const step = Math.max(-maxStep, Math.min(maxStep, delta))
    const targetX = Math.max(8, Math.min(handle.innerW - 8, handle.x + step))
    trace.push({ round: round, current: current, target: target, delta: delta, fromX: handle.x, toX: targetX, source: handle.source, edgeX: handle.edgeX })
    await pw.mouse.move(handle.x, handle.y)
    await pw.mouse.down()
    await pw.mouse.move(targetX, handle.y, { steps: 14 })
    await pw.mouse.up()
    await sleep(500)
  }
  const last = await measureUi(page)
  return { ok: false, via: 'drag', detail: '拖了 8 轮仍未到 ' + String(target) + ' 档，最后 data-vc-width=' + String(last.ok ? last.value.attrWidth : null), rounds: 8, trace: trace }
}

/** 退回窗口反解：窗口内宽与面板档位分段线性，最多 16 轮。 */
async function calibrateToWidth(page: PageHandle, raw: RawBrowserPage, target: number, windowByWidth: Map<number, number>): Promise<WidthCalibration> {
  const dragged = await calibrateByDrag(page, raw, target)
  if (dragged.ok) return dragged
  if (typeof raw.resize !== 'function') {
    return { ok: false, via: 'resize', detail: '拖拽没成，适配器也没有 resize()，宽度这块只能记 blocked', rounds: dragged.rounds, trace: dragged.trace }
  }
  const trace: unknown[] = dragged.trace.slice()
  const innerResult = await page.innerSize()
  const outerResult = await page.outerSize()
  const innerW = innerResult.ok ? innerResult.value.width : 0
  const outerW = outerResult.ok ? outerResult.value.width : 0
  const chrome = Math.max(0, outerW - innerW)
  const seeds: number[] = []
  const cached = windowByWidth.get(target)
  if (cached !== undefined) seeds.push(cached)
  seeds.push(target + 705, target + 404, 800, 1005, 1100)
  let seedIndex = 0
  let guess = seeds[0]
  for (let round = 1; round <= 16; round += 1) {
    const windowWidth = Math.max(700, Math.round(guess + chrome))
    const resized = await raw.resize(windowWidth, WINDOW_HEIGHT)
    if (!resized.ok) {
      trace.push({ round: round, windowWidth: windowWidth, problem: resized.error.message })
      return { ok: false, via: 'resize', detail: '窗口 resize 失败：' + resized.error.message, rounds: round, trace: trace }
    }
    await sleep(650)
    const measured = await measureUi(page)
    if (!measured.ok || measured.value.attrWidth === null) {
      trace.push({ round: round, windowWidth: windowWidth, problem: '读不到 data-vc-width' })
      guess += 60
      continue
    }
    const attr = Number(measured.value.attrWidth)
    trace.push({ round: round, windowWidth: windowWidth, innerW: measured.value.innerW, attrWidth: attr, guess: Math.round(guess) })
    if (attr === target) {
      windowByWidth.set(target, measured.value.innerW)
      return { ok: true, via: 'resize', detail: '反解窗口内宽到 ' + String(target) + ' 档（内宽 ' + String(measured.value.innerW) + '）', rounds: round, trace: trace }
    }
    const nextGuess = measured.value.innerW + (target - attr)
    if (nextGuess < 500 || nextGuess > 2100) {
      seedIndex += 1
      if (seedIndex >= seeds.length) break
      guess = seeds[seedIndex]
    } else {
      guess = nextGuess
    }
  }
  const last = await measureUi(page)
  return { ok: false, via: 'resize', detail: '反解 16 轮仍未到 ' + String(target) + ' 档，最后 data-vc-width=' + String(last.ok ? last.value.attrWidth : null), rounds: 16, trace: trace }
}

interface WideWindowResult {
  readonly ok: boolean
  readonly detail: string
  readonly facts: Record<string, unknown>
}

/** 先把窗口拉够宽，给拖拽留出余量。 */
async function ensureWideWindow(page: PageHandle, raw: RawBrowserPage): Promise<WideWindowResult> {
  const facts: Record<string, unknown> = {}
  if (typeof raw.resize !== 'function') {
    return { ok: false, detail: '浏览器适配器没有 resize()，没法先拉宽窗口', facts: facts }
  }
  const innerResult = await page.innerSize()
  const outerResult = await page.outerSize()
  const innerW = innerResult.ok ? innerResult.value.width : 0
  const outerW = outerResult.ok ? outerResult.value.width : 0
  const chrome = Math.max(0, outerW - innerW)
  const wantedWidth = Math.max(1400, innerW) + chrome
  facts.before = { innerW: innerW, outerW: outerW, chrome: chrome, wantedWidth: wantedWidth }
  const probe = await evaluateThrough<unknown>(page, RIGHTBAR_PROBE_SCRIPT)
  facts.rightbarProbe = probe.ok ? probe.value : { error: probe.error.message }
  const resized = await raw.resize(wantedWidth, WINDOW_HEIGHT)
  if (!resized.ok) return { ok: false, detail: '拉宽窗口失败：' + resized.error.message, facts: facts }
  await sleep(900)
  const after = await page.innerSize()
  const afterW = after.ok ? after.value.width : 0
  facts.after = after.ok ? after.value : null
  return { ok: afterW >= 1300, detail: '窗口内宽 ' + String(afterW), facts: facts }
}

/** 把一次检查落成观测：证据路径一并带上，人只看报告也能复核。 */
interface ObservationInput {
  readonly checkId: string
  readonly title: string
  readonly ok: boolean
  readonly status: Status
  readonly hard: boolean
  readonly detail: string
  readonly expected?: string
  readonly actual?: string
  readonly hint?: string
  readonly evidence?: string[]
}

function observe(input: ObservationInput): ScenarioObservation {
  return {
    checkId: input.checkId,
    title: input.title,
    ok: input.ok,
    status: input.status,
    hard: input.hard,
    detail: input.detail,
    expected: input.expected,
    actual: input.actual,
    hint: input.hint,
    evidence: input.evidence === undefined ? [] : input.evidence,
  }
}

/** 截图同时落到批次证据目录与仓库 .scratch/1860-real 镜像目录，两处路径都进观测。 */
const EVIDENCE_MIRROR = path.resolve('.scratch', '1860-real')

async function captureScreenshot(context: ScenarioContext, page: PageHandle, subdir: string, name: string, note: string): Promise<{ ok: boolean; paths: string[]; detail: string }> {
  const paths: string[] = []
  const target = path.join(context.evidence.root, subdir, name + '.png')
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await page.screenshot(target)
    const filed = await context.evidence.recordFile(target, { kind: 'screenshot', note: note })
    if (filed.ok) paths.push(filed.value.path)
  } catch (error) {
    return { ok: false, paths: paths, detail: '截图失败：' + messageOf(error) }
  }
  let mirrorNote = ''
  try {
    const mirror = path.join(EVIDENCE_MIRROR, subdir, name + '.png')
    fs.mkdirSync(path.dirname(mirror), { recursive: true })
    fs.copyFileSync(target, mirror)
    mirrorNote = '（镜像 ' + mirror + '）'
  } catch (error) {
    mirrorNote = '（镜像复制失败：' + messageOf(error) + '）'
  }
  return { ok: true, paths: paths, detail: '截图 ' + target + mirrorNote }
}

/** 记 JSON 证据，同时复制一份到仓库 .scratch/1860-real 镜像目录。证据名只许是扁平的文件名（不能带子目录）。 */
async function recordBoth(context: ScenarioContext, subdir: string, name: string, value: unknown, note: string): Promise<string[]> {
  const paths: string[] = []
  const flat = (subdir === '.' || subdir.length === 0 ? '' : subdir + '-') + name.replace(/^\.\//, '')
  const filed = await recordEvidence(context, flat, value, note)
  if (filed === null) return paths
  paths.push(filed)
  try {
    const source = path.join(context.evidence.root, filed.split('/').join(path.sep))
    const mirror = path.join(EVIDENCE_MIRROR, subdir === '.' ? '.' : subdir, name)
    fs.mkdirSync(path.dirname(mirror), { recursive: true })
    fs.copyFileSync(source, mirror)
  } catch (error) {
    console.log('[1860] 镜像复制失败 ' + subdir + '/' + name + '：' + messageOf(error))
  }
  return paths
}

interface CaptureResult {
  readonly observation: ScenarioObservation
  readonly evidence: string[]
  readonly failed: string[]
  readonly softFailed: string[]
  readonly view: ViewName
  readonly width: number
  readonly skin: Skin
}

async function captureBlocked(
  context: ScenarioContext,
  page: PageHandle,
  view: ViewName,
  width: number,
  skin: Skin,
  stage: string,
  detail: string,
  facts: unknown,
): Promise<CaptureResult> {
  const subdir = String(width) + '-' + skin
  const checkId = CHECK_ID + '-' + view + '-w' + String(width) + '-' + skin
  const evidence: string[] = []
  const shot = await captureScreenshot(context, page, subdir, view + '-blocked-' + stage, view + ' 在 ' + stage + ' 阶段被挡住')
  evidence.push(...shot.paths)
  const recorded = await recordBoth(context, subdir, view + '-blocked-' + stage + '.json', { checkId: checkId, stage: stage, detail: detail, facts: facts }, view + ' 在 ' + stage + ' 阶段的诊断')
  evidence.push(...recorded)
  const observation = observe({
    checkId: checkId,
    title: VIEW_TITLES[view] + ' @ ' + String(width) + ' / ' + skin,
    ok: false,
    status: 'blocked',
    hard: false,
    detail: stage + ' 阶段被挡住：' + detail,
    hint: '先看同一轮的诊断 JSON 与截图，再按 1843 的批次流程复查适配器',
    evidence: evidence,
  })
  return { observation: observation, evidence: evidence, failed: [], softFailed: [], view: view, width: width, skin: skin }
}

/** 一条完整取证：切皮肤 → 切页签 → 标定宽度 → 取数 → 判据 → 截图 → 记 JSON → 落观测。 */
async function captureAt(
  context: ScenarioContext,
  page: PageHandle,
  raw: RawBrowserPage,
  view: ViewName,
  width: number,
  skin: Skin,
  windowByWidth: Map<number, number>,
  tokenUrl: string,
  originUrl: string,
): Promise<CaptureResult> {
  const subdir = String(width) + '-' + skin
  const checkId = CHECK_ID + '-' + view + '-w' + String(width) + '-' + skin
  const skinResult = await ensureSkin(page, raw, skin, tokenUrl, originUrl)
  if (!skinResult.ok) {
    const detail = (skinResult.blocked ? '皮肤通道被挡：' : '皮肤没切过去：') + skinResult.detail
    return await captureBlocked(context, page, view, width, skin, 'skin', detail, skinResult.facts)
  }
  const tabResult = await openTab(page, raw, view)
  if (!tabResult.ok) return await captureBlocked(context, page, view, width, skin, 'tab', tabResult.detail, tabResult.facts)
  const calibration = await calibrateToWidth(page, raw, width, windowByWidth)
  const widthOk = calibration.ok && calibration.via.length > 0
  // 换皮肤会重挂页签，空壳可能短暂回来；数据一旦确认过就不再逐张等（否则整轮取证会被拉长）。
  let dataWait: Record<string, unknown> | null = null
  if (!vcDataConfirmed) {
    const readyData = await waitForVersionControlData(page, raw, 15000)
    dataWait = { ok: readyData.ok, detail: readyData.detail, facts: readyData.facts }
  }
  let commitWait: Record<string, unknown> | null = null
  if (view === 'changes') {
    const composer = await waitForCommitPanel(page, 15000)
    commitWait = { ok: composer.ok, waitMs: composer.waitMs, detail: composer.detail }
  }
  const base = await inspectBase(page)
  const detail = await inspectView(page, view)
  const checks = base.ok && detail.ok ? checkStructure(view, width, skin, base.value, detail.value) : { ok: false, items: [], failed: ['inspect'], softFailed: [] }
  const shot = await captureScreenshot(context, page, subdir, view, VIEW_TITLES[view] + ' 在 ' + String(width) + ' 档 ' + skin + ' 皮肤下的首屏')
  const evidence: string[] = shot.paths.slice()
  const facts = {
    checkId: checkId,
    view: view,
    width: width,
    skin: skin,
    widthCalibration: calibration,
    dataWait: dataWait,
    commitWait: commitWait,
    shell: base.ok ? base.value : { error: base.error.message },
    viewDetail: detail.ok ? detail.value : { error: detail.error.message },
    checks: checks,
  }
  const recorded = await recordBoth(context, subdir, view + '.json', facts, VIEW_TITLES[view] + ' @ ' + String(width) + ' / ' + skin + ' 的取数与判据')
  evidence.push(...recorded)
  const bodyOk = base.ok && base.value.bodyDark === (skin === 'dark')
  const skinOk = base.ok && base.value.root !== null && base.value.root.skin === skin
  const ok = widthOk && skinOk && bodyOk && base.ok && detail.ok && checks.ok
  const status: Status = ok ? 'pass' : widthOk ? 'fail' : 'blocked'
  const hard = widthOk && skinOk
  const failed = checks.failed.slice()
  if (!base.ok) failed.push('inspect-base')
  if (!detail.ok) failed.push('inspect-view')
  if (!bodyOk) failed.push('skin-body')
  if (!widthOk) failed.push('width-calibration')
  const detailText = ok
    ? '壳与页签正文都符合判据'
    : '没过的检查：' + (failed.length > 0 ? failed.join('、') : '无') + (checks.softFailed.length > 0 ? '；软失败：' + checks.softFailed.join('、') : '')
  const observation = observe({
    checkId: checkId,
    title: VIEW_TITLES[view] + ' @ ' + String(width) + ' / ' + skin,
    ok: ok,
    status: status,
    hard: hard,
    detail: detailText,
    expected: '身份行 + 四页签 + ' + VIEW_TITLES[view] + '正文符合 #1860 定稿原型',
    actual: ok ? '符合（' + String(checks.items.filter((item) => item.ok).length) + '/' + String(checks.items.length) + ' 项）' : detailText,
    hint: widthOk ? '' : '宽度没标定到目标档位：' + calibration.detail,
    evidence: evidence,
  })
  return { observation: observation, evidence: evidence, failed: failed, softFailed: checks.softFailed, view: view, width: width, skin: skin }
}

/** 页面首次打开：清掉首开遮罩，确认停在同源登录后的欢迎屏。 */
async function waitForHostReady(page: PageHandle, raw: RawBrowserPage, tokenUrl: string, originUrl: string): Promise<{ ok: boolean; detail: string; facts: Record<string, unknown> }> {
  const facts: Record<string, unknown> = {}
  if (typeof raw.goto === 'function') await raw.goto(tokenUrl)
  await sleep(2500)
  let maskCount = -1
  let workspaceButtonText: string | null = null
  for (let i = 0; i < 60; i += 1) {
    const masks = await evaluateThrough<number>(page, MASK_COUNT_SCRIPT)
    maskCount = masks.ok ? masks.value : -1
    if (maskCount > 0) {
      if (typeof raw.press === 'function') await raw.press('Escape')
      await clickPage(page, raw, CLOSE_BUTTON)
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
  const passwords = await evaluateThrough<number>(page, PASSWORD_INPUT_SCRIPT)
  const pageUrl = page.url()
  facts.url = pageUrl
  facts.originUrl = originUrl
  facts.maskCount = maskCount
  facts.workspaceButtonText = workspaceButtonText
  facts.passwordInputs = passwords.ok ? passwords.value : -1
  const ready = maskCount === 0 && workspaceButtonText !== null && passwords.ok && passwords.value === 0 && pageUrl.indexOf(originUrl) === 0
  if (!ready) {
    return {
      ok: false,
      detail:
        '页面没就绪：遮罩 ' + String(maskCount) + ' 个，工作区按钮 ' + (workspaceButtonText === null ? '没找到' : '「' + workspaceButtonText + '」') +
        '，密码输入框 ' + String(passwords.ok ? passwords.value : '读不到') + '，URL ' + pageUrl,
      facts: facts,
    }
  }
  return { ok: true, detail: '欢迎屏就绪（工作区按钮「' + String(workspaceButtonText) + '」，遮罩 0 个）', facts: facts }
}

// —— 整轮取证：进隔离实例 → 主视图 → 版本管理 → 皮肤 × 宽度 × 四页签 ——

function setupObservation(detail: string, status: Status, facts: unknown): ScenarioObservation {
  return observe({
    checkId: CHECK_ID + '-setup',
    title: '隔离实例布置',
    ok: false,
    status: status,
    hard: true,
    detail: detail,
    hint: '看批次目录里的诊断 JSON 与 DSH 日志',
    evidence: [],
  })
}

async function runSweep(context: ScenarioContext): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = []
  const primitives = context.primitives as unknown as { page(): Promise<Result<PageHandle>> }
  let pageResult: Result<PageHandle>
  try {
    pageResult = await primitives.page()
  } catch (error) {
    return [setupObservation('拿不到浏览器页面：' + messageOf(error), 'blocked', {})]
  }
  if (!pageResult.ok) {
    return [setupObservation('拿不到浏览器页面：' + pageResult.error.message, 'blocked', { error: pageResult.error })]
  }
  const page = pageResult.value
  const raw = page.page as unknown as RawBrowserPage
  const instance = context.instance as unknown as { record?: { tokenUrl?: string; originUrl?: string } } | null
  if (instance === null || instance === undefined || instance.record === undefined) {
    return [setupObservation('没有拿到隔离实例（context.instance 为空）', 'blocked', {})]
  }
  const tokenUrl = instance.record.tokenUrl
  const originUrl = instance.record.originUrl
  if (typeof tokenUrl !== 'string' || typeof originUrl !== 'string') {
    return [setupObservation('隔离实例没给出 tokenUrl / originUrl', 'blocked', { record: instance.record })]
  }

  const fixture = ensureFixtureRepo()
  const fixtureEvidence: string[] = []
  const fixtureRecorded = await recordEvidence(context, '1860-fixture.json', { verified: fixture.ok, detail: fixture.detail, facts: fixture.facts }, '夹具仓库的核对结果')
  if (fixtureRecorded !== null) fixtureEvidence.push(fixtureRecorded)
  if (!fixture.ok) {
    const observation = setupObservation('夹具准备失败：' + fixture.detail, 'fail', fixture.facts)
    observations.push(observation)
    return observations
  }

  const ready = await waitForHostReady(page, raw, tokenUrl, originUrl)
  await recordEvidence(context, '1860-host-ready.json', ready, '隔离实例欢迎屏的就绪情况')
  if (!ready.ok) {
    observations.push(setupObservation(ready.detail, 'blocked', ready.facts))
    return observations
  }

  const mainView = await openMainView(page, raw, tokenUrl, originUrl)
  await recordEvidence(context, '1860-main-view.json', mainView, '进主视图的路径与事实')
  if (!mainView.ok) {
    observations.push(setupObservation('进不了主视图：' + mainView.detail, 'blocked', mainView.facts))
    return observations
  }

  const wide = await ensureWideWindow(page, raw)
  await recordEvidence(context, '1860-wide-window.json', wide, '拖拽前的窗口尺寸')

  const panel = await openVersionControlPanel(page, raw)
  await recordEvidence(context, '1860-panel-open.json', panel, '版本管理首屏挂载情况')
  if (!panel.ok) {
    observations.push(setupObservation('打开版本管理首屏失败：' + panel.detail, 'blocked', panel.facts))
    return observations
  }

  const widths = QUICK ? WIDTHS.slice(0, 1) : WIDTHS
  const skins = QUICK ? SKINS.slice(0, 1) : SKINS
  const windowByWidth = new Map<number, number>()
  const captures: CaptureResult[] = []
  for (const skin of skins) {
    for (const width of widths) {
      for (const view of VIEWS) {
        console.log('[1860] 取证 ' + VIEW_TITLES[view] + ' @ ' + String(width) + ' / ' + skin)
        try {
          const result = await captureAt(context, page, raw, view, width, skin, windowByWidth, tokenUrl, originUrl)
          captures.push(result)
        } catch (error) {
          const checkId = CHECK_ID + '-' + view + '-w' + String(width) + '-' + skin
          const observation = observe({
            checkId: checkId,
            title: VIEW_TITLES[view] + ' @ ' + String(width) + ' / ' + skin,
            ok: false,
            status: 'blocked',
            hard: false,
            detail: '取证时抛错：' + messageOf(error),
            evidence: [],
          })
          captures.push({ observation: observation, evidence: [], failed: ['exception'], softFailed: [], view: view, width: width, skin: skin })
        }
        observations.push(captures[captures.length - 1].observation)
      }
    }
  }

  const passed = captures.filter((capture) => capture.observation.status === 'pass').length
  const failed = captures.filter((capture) => capture.observation.status === 'fail').length
  const blocked = captures.filter((capture) => capture.observation.status === 'blocked').length
  const summary = {
    checkId: CHECK_ID,
    quick: QUICK,
    fixture: { ok: fixture.ok, facts: fixture.facts },
    widths: widths,
    skins: skins,
    hostReady: ready.facts,
    mainViewVia: mainView.via,
    wideWindow: wide,
    total: captures.length,
    passed: passed,
    failed: failed,
    blocked: blocked,
    captures: captures.map((capture) => ({
      checkId: capture.observation.checkId,
      view: capture.view,
      width: capture.width,
      skin: capture.skin,
      status: capture.observation.status,
      ok: capture.observation.ok,
      failed: capture.failed,
      softFailed: capture.softFailed,
      detail: capture.observation.detail,
      evidence: capture.evidence,
    })),
  }
  const summaryPaths = await recordBoth(context, '.', '1860-summary.json', summary, '整轮取证的汇总')
  const overall = captures.length > 0 && passed === captures.length
  const summaryObservation = observe({
    checkId: CHECK_ID + '-summary',
    title: '四页签取证汇总',
    ok: overall,
    status: overall ? 'pass' : 'fail',
    hard: true,
    detail: '共 ' + String(captures.length) + ' 张：通过 ' + String(passed) + '，失败 ' + String(failed) + '，被挡 ' + String(blocked),
    expected: '四档宽 × 两种皮肤 × 四个页签全部通过',
    actual: '通过 ' + String(passed) + '/' + String(captures.length),
    evidence: summaryPaths.concat(fixtureEvidence),
  })
  observations.push(summaryObservation)
  return observations
}

export default defineScenario({
  id: 'vc-1860-shell',
  title: '版本管理首屏（#1860）：身份行 + 四页签 + 四页签正文的隔离真机取证',
  description:
    '在隔离 DSH 实例里打开版本管理首屏，用临时夹具仓库（50 提交 / 11 改动 / 1 储藏 / 领先 2 / 同步事实 12 分钟前 / 59 棵工作树）' +
    '对改动、提交历史、工作区、储藏四个页签在 300/380/460/520 四档宽与深色/浅色两种皮肤下截图取证，并把每张图里可见的关键文本记进 JSON。',
  hooks: hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: '启动隔离实例' },
    { id: 'sweep', kind: 'custom', title: '四页签逐档取证', timeoutMs: 1800000, run: runSweep },
    { id: 'stop', kind: 'stop', title: '停掉隔离实例' },
  ],
})
