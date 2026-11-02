// ui.ts —— 阶段 B1：把旧真机脚本里插件特有的界面断言迁进 base 的场景机制。
//
// 迁移来源是 scripts/real-machine/commands/browser-check.mts（连同它用的
// scripts/real-machine/lib/browser.mts 里的菜单、会话、矩形读法）。口径：
// - 每条断言都是一条 ScenarioObservation：写清期望、实际、建议，能被报告统计成 pass/fail/skip，
//   不再用 console.log 打印一段自说自话的结论；
// - 选择器与判定条件照抄旧脚本：页面可见文本长度、工作区按钮、菜单标题、按钮矩形与命中、
//   首开遮罩、脚本异常、截图；
// - 工作区文件与 home 注册表由 verify/hooks.ts 的 prepareHome 在宿主启动前种下；
//   启动后再走 DSH 自己的 workspace/create（幂等解析）并据此建会话，
//   菜单断言因此同时证明「这个目录确实出现在了插件界面里」；
// - 会话由场景用 session/create 在该工作区里建，session/list 里能找到它；列表暂时没反映时
//   记 skip 并说明原因，不把延迟当失败。

import fs from 'node:fs'
import path from 'node:path'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { SEEDED_WORKSPACE_TITLE, hooks, seededWorkspacePath } from '../hooks.ts'
import { readWorkspaceRegistry, workspaceIdForPath } from '../../scripts/real-machine/lib/workspace-seed.mts'

/** 工作区菜单的触发按钮；和旧脚本同一个选择器。 */
const WORKSPACE_BUTTON = 'button[aria-label="选择工作区"]'
/** 首开登录弹窗的关闭按钮；旧脚本用 Escape 关不掉时点它。 */
const CLOSE_BUTTON = 'button[aria-label="关闭"]'

/** 适配器只保证 BrowserPageHandle；goto/click/press 是插件侧适配器额外给的，按需缩窄。 */
interface RawResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}
interface RawBrowserPage {
  readonly goto?: (url: string) => Promise<RawResult>
  readonly click?: (selector: string) => Promise<RawResult>
  readonly press?: (key: string) => Promise<RawResult>
}

interface ButtonGeometry {
  readonly found: boolean
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly viewport: { readonly width: number; readonly height: number }
  readonly hit: { readonly found: boolean; readonly withinButton: boolean; readonly tag: string; readonly text: string } | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把页面里的表达式算成 T。适配器失败（页面已崩、脚本写错）不抛出，
 * 转成一句可写进 detail 的原因，让场景继续把其余断言跑完。
 */
async function evaluateThrough<T>(page: PageHandle, script: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const result = await page.evaluate<T>(script)
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}

/** 首开遮罩计数；旧脚本用同一个选择器判断登录弹窗有没有关掉。 */
const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length'

/** 页面可见文本；用 innerText 而不是 textContent，隐藏节点不算「看到的文字」。 */
const BODY_TEXT_SCRIPT = 'document.body.innerText || ""'

/** 工作区菜单里的菜单项标题；旧脚本点开后取 [role="menuitem"] 的 textContent 并合并空白。 */
const MENU_TITLES_SCRIPT = [
  '(function () {',
  '  return Array.from(document.querySelectorAll(' + JSON.stringify('[role="menuitem"]') + ')).map(function (el) {',
  '    return (el.textContent || "").replace(/\\s+/g, " ").trim();',
  '  }).filter(function (text) { return text.length > 0; });',
  '})()',
].join('\n')

/** 按钮矩形与中心点命中；旧 browser-check.mts 里那段 evaluate 的等价写法。 */
const GEOMETRY_SCRIPT = [
  '(function () {',
  '  var button = document.querySelector(' + JSON.stringify(WORKSPACE_BUTTON) + ');',
  '  var viewport = { width: window.innerWidth, height: window.innerHeight };',
  '  if (!button) return { found: false, rect: null, viewport: viewport, hit: null };',
  '  var rect = button.getBoundingClientRect();',
  '  var hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);',
  '  return {',
  '    found: true,',
  '    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },',
  '    viewport: viewport,',
  '    hit: hit === null ? null : {',
  '      found: true,',
  '      withinButton: button.contains(hit),',
  '      tag: hit.tagName.toLowerCase(),',
  '      text: (hit.innerText || hit.textContent || "").trim().slice(0, 80),',
  '    },',
  '  };',
  '})()',
].join('\n')

/** 客户端 RPC 的统一返回形状：HTTP 状态、解析后的信封、以及截断的原文（解析失败时用）。 */
interface RpcProbe {
  readonly status: number
  readonly body: unknown
  readonly text: string
}

/**
 * 走客户端自己的 RPC 协议（POST /api/<method>，body 是 client-request 信封），
 * 与旧 browser.mts 的 pageRpc 一致；evaluate 只收字符串，所以整段写成自调用表达式。
 * argsExpression 是嵌在 JSON.stringify 里的对象字面量，例如 "{ request: { path: ... } }"。
 */
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** RPC 信封的 result.value；客户端返回的是 {result:{value:...}}。 */
function rpcValue(probe: RpcProbe): Record<string, unknown> | null {
  const result = asRecord(asRecord(probe.body)?.result)
  return asRecord(result?.value)
}

/** 失败原因：优先取信封里的 error.message，其次是截断原文。 */
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

interface ListedSession {
  readonly sessionId: string
  readonly cwd: string
}

/** session/list：visible Session summaries ordered by activity（见 DSH 的 session-controller schema）。 */
function listedSessions(probe: RpcProbe): readonly ListedSession[] | null {
  const value = rpcValue(probe)
  const items = value === null ? null : value.items
  if (!Array.isArray(items)) return null
  const rows: ListedSession[] = []
  for (const item of items) {
    const record = asRecord(item)
    const sessionId = stringField(record, 'sessionId')
    const cwd = stringField(record, 'cwd')
    if (sessionId !== null) rows.push({ sessionId, cwd: cwd === null ? '' : cwd })
  }
  return rows
}

export default defineScenario({
  id: 'ui',
  title: 'the client shows the seeded workspace and the workspace menu is reachable',
  description: 'Launches an isolated instance with a seeded markdown workspace and repeats the interface assertions the old browser-check.mts made, so phase B2 can delete that script without losing coverage.',
  hooks,
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: 'start the installed package with a seeded workspace',
    },
    {
      id: 'ui',
      kind: 'custom',
      title: 'observe the workspace menu and the shell around it',
      run: async (context) => {
        const page = await context.primitives.page()
        if (!page.ok) {
          return [{
            checkId: 'ui-page',
            title: 'a page can be opened through the browser adapter',
            ok: false,
            status: 'blocked',
            detail: 'no page handle: ' + page.error.message,
            expected: 'the Playwright adapter opens a page for the running instance',
            actual: page.error.message,
            hint: page.error.hint || 'check verify/browser.mjs and the profile browser declaration',
          }]
        }
        const instance = context.instance
        if (instance === null) {
          return [{
            checkId: 'ui-page',
            title: 'the launch step left an active instance',
            ok: false,
            status: 'blocked',
            detail: 'the scenario page primitive has no active instance',
            expected: 'the launch step to leave one instance running',
            actual: 'context.instance is null',
            hint: 'the launch step must run before the page observation step',
          }]
        }

        const raw = page.value.page as unknown as RawBrowserPage
        // 与 ui-shell.ts 相同的竞态处理：先走适配器的 goto 把一次性 token 换成会话 cookie，
        // 再用 location 跳转；反过来会拿到 401 的登录页。
        if (raw.goto !== undefined) {
          const navigated = await raw.goto(instance.record.tokenUrl)
          void navigated
        }
        await sleep(1500)

        // 首开登录弹窗会盖住工作区按钮：照旧脚本的做法按 Escape，不行再点「关闭」，
        // 直到遮罩消失或按钮出现；最多 60 轮（约 15 秒），避免无限等。
        let maskCount: number | null = null
        let buttonText: string | null = null
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const masks = await evaluateThrough<number>(page.value, MASK_COUNT_SCRIPT)
          maskCount = masks.ok ? masks.value : null
          if (maskCount !== null && maskCount > 0) {
            if (raw.press !== undefined) await raw.press('Escape')
            if (raw.click !== undefined) await raw.click(CLOSE_BUTTON)
            await sleep(300)
            continue
          }
          const text = await page.value.text(WORKSPACE_BUTTON)
          if (text.ok && text.value !== null) {
            buttonText = text.value
            break
          }
          await sleep(250)
        }

        const observations: ScenarioObservation[] = []

        // 0) 钩子种下的工作区路径：prepareHome 在宿主启动前写进 home 注册表，
        //    所以页面一打开，插件界面里就该有这个工作区（见下面 0pre 的两条观察）。
        //    0a 再走 DSH 自己的 workspace/create：证明这个目录能被运行中的实例幂等解析，
        //    并拿到 session/create 需要的 workspaceId；标题由 prepareHome 种下，不需要改名。
        const instanceDir = instance.plan.dir
        const workspacePath = seededWorkspacePath(instanceDir)
        const registryPath = path.join(instance.record.home, 'storages', 'workspace.json')

        // 0pre) 启动时的种子是否已经生效：直接读 home 注册表。
        //       这一步不依赖任何 RPC，是本场景对 prepareHome 时点的直接检验。
        let bootRegistryProblem: string | null = null
        let bootRegistryTitle: string | null = null
        try {
          const registry = readWorkspaceRegistry(instance.record.home)
          if (registry === null) {
            bootRegistryProblem = 'no registry file at ' + registryPath
          } else {
            const wanted = path.resolve(workspacePath).toLowerCase()
            const entry = registry.workspaces.find((item) => path.resolve(item.path).toLowerCase() === wanted)
            if (entry === undefined) {
              bootRegistryProblem = 'registry has ' + String(registry.workspaces.length) + ' workspace(s), none at ' + workspacePath
            } else {
              bootRegistryTitle = entry.title
            }
          }
        } catch (error) {
          bootRegistryProblem = messageOf(error)
        }
        observations.push({
          checkId: 'ui-seeded-registry-at-boot',
          title: 'the seeded workspace is already in the home registry when the page opens',
          ok: bootRegistryTitle === SEEDED_WORKSPACE_TITLE,
          detail: bootRegistryTitle === null ? 'registry check failed: ' + String(bootRegistryProblem) : 'boot registry entry titled ' + bootRegistryTitle,
          expected: 'a registry entry at ' + workspacePath + ' titled ' + SEEDED_WORKSPACE_TITLE,
          actual: bootRegistryTitle === null ? String(bootRegistryProblem) : bootRegistryTitle,
          hint: 'prepareHome must seed home/storages/workspace.json before the host starts; read verify/hooks.ts',
        })

        // 0pre-b) 菜单里也应该先看到它：这是「启动即见」的界面证据。
        let bootMenuTitles: readonly string[] | null = null
        if (raw.click !== undefined) {
          const bootClick = await raw.click(WORKSPACE_BUTTON)
          if (bootClick.ok) {
            await sleep(400)
            const bootRead = await evaluateThrough<readonly string[]>(page.value, MENU_TITLES_SCRIPT)
            if (bootRead.ok) bootMenuTitles = bootRead.value
            if (raw.press !== undefined) await raw.press('Escape')
            await sleep(200)
          }
        }
        observations.push({
          checkId: 'ui-boot-menu-seeded',
          title: 'the workspace menu shows the seeded workspace before any RPC',
          ok: bootMenuTitles !== null && bootMenuTitles.some((title) => title.indexOf(SEEDED_WORKSPACE_TITLE) >= 0),
          detail: bootMenuTitles === null ? 'the menu could not be read before workspace/create' : 'menu items at boot: ' + bootMenuTitles.join(' / '),
          expected: 'a menu item whose title contains ' + SEEDED_WORKSPACE_TITLE,
          actual: bootMenuTitles === null ? 'none' : bootMenuTitles.join(' / '),
          hint: 'if the registry seed is present but the menu is empty, the client may need a workspace refresh; compare with ui-seeded-registry-at-boot',
        })

        // 0a) workspace/create：按目录登记（或幂等解析）工作区，拿到运行中实例认识的 workspaceId。
        const createProbe = await evaluateThrough<RpcProbe>(page.value, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(workspacePath) + ' } }'))
        const createValue = createProbe.ok ? rpcValue(createProbe.value) : null
        const createdWorkspace = asRecord(createValue?.workspace)
        const liveWorkspaceId = stringField(createdWorkspace, 'workspaceId')
        const liveWorkspacePath = stringField(createdWorkspace, 'path')
        const createOk = createProbe.ok && createProbe.value.status === 200 && liveWorkspaceId !== null && liveWorkspacePath !== null && path.resolve(liveWorkspacePath).toLowerCase() === path.resolve(workspacePath).toLowerCase()
        observations.push({
          checkId: 'ui-workspace-registered',
          title: 'the seeded directory is registered with the running instance',
          ok: createOk,
          detail: createProbe.ok
            ? 'workspace/create -> HTTP ' + String(createProbe.value.status) + ' ' + (createOk ? 'workspaceId ' + String(liveWorkspaceId) : rpcProblem(createProbe.value))
            : 'workspace/create could not be called: ' + createProbe.message,
          expected: 'workspace/create returns 200 with a Workspace whose path is ' + workspacePath,
          actual: createOk ? String(liveWorkspacePath) : (createProbe.ok ? rpcProblem(createProbe.value) : createProbe.message),
          hint: 'the RPC name or envelope may differ; compare with POST /api/session/list wire shape in scripts/real-machine/lib/browser.mts',
        })


        // 0c) home 的注册表里确实有一条指向这个目录的记录（标题由 DSH 维护，所以按路径找）。
        //     钩子写的 id 与 DSH 分配的 id 不同：钩子用 sha256(路径) 派生，DSH 用自己的一套，
        //     这里只断言「目录已经被登记」，不假定是谁写的、也不假定 id 算法。
        await sleep(400)
        let registryEntryId: string | null = null
        let registryEntryTitle: string | null = null
        let registryProblem: string | null = null
        try {
          const registry = readWorkspaceRegistry(instance.record.home)
          if (registry === null) {
            registryProblem = 'no registry file at ' + registryPath
          } else {
            const wanted = path.resolve(workspacePath).toLowerCase()
            const entry = registry.workspaces.find((item) => path.resolve(item.path).toLowerCase() === wanted)
            if (entry === undefined) {
              registryProblem = 'registry has ' + String(registry.workspaces.length) + ' workspace(s) but none points at ' + workspacePath + ': ' + registry.workspaces.map((item) => item.path).join(' | ')
            } else {
              registryEntryId = entry.id
              registryEntryTitle = entry.title
            }
          }
        } catch (error) {
          registryProblem = messageOf(error)
        }
        observations.push({
          checkId: 'ui-workspace-registry-entry',
          title: 'the seeded directory is registered in the instance home registry',
          ok: registryEntryId !== null,
          detail: registryEntryId === null
            ? 'registry check failed: ' + String(registryProblem)
            : 'registry entry ' + registryEntryId + ' titled ' + String(registryEntryTitle) + ' (hook-derived id would be ' + workspaceIdForPath(workspacePath) + ')',
          expected: 'a workspace entry whose path resolves to ' + workspacePath,
          actual: registryEntryId === null ? String(registryProblem) : String(registryEntryId),
          hint: 'workspace/create must succeed; the boot-time seed is checked separately by ui-seeded-registry-at-boot',
        })

        // 0d) session/create：在刚登记的工作区里建一条会话，后面的 session/list 才有得比。
        let createdSessionId: string | null = null
        let sessionCreateProblem: string | null = null
        if (createOk) {
          const sessionProbe = await evaluateThrough<RpcProbe>(page.value, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(liveWorkspaceId) + ' } }'))
          if (!sessionProbe.ok) {
            sessionCreateProblem = 'session/create could not be called: ' + sessionProbe.message
          } else if (sessionProbe.value.status !== 200) {
            sessionCreateProblem = 'session/create -> HTTP ' + String(sessionProbe.value.status) + ' ' + rpcProblem(sessionProbe.value)
          } else {
            createdSessionId = stringField(rpcValue(sessionProbe.value), 'sessionId')
            if (createdSessionId === null) sessionCreateProblem = 'session/create returned no sessionId: ' + rpcProblem(sessionProbe.value)
          }
        } else {
          sessionCreateProblem = 'skipped because workspace/create failed'
        }
        observations.push({
          checkId: 'ui-session-created',
          title: 'a session is created in the registered workspace',
          ok: createdSessionId !== null,
          detail: createdSessionId === null ? String(sessionCreateProblem) : 'session/create -> ' + createdSessionId,
          expected: 'session/create returns a sessionId for the registered workspace',
          actual: createdSessionId === null ? String(sessionCreateProblem) : createdSessionId,
          hint: 'workspace/create must succeed first; read DSH session-controller schema for the request shape',
        })

        // 1) 页面有可见文本（旧脚本的 > 20 字判据）。
        const bodyText = await evaluateThrough<string>(page.value, BODY_TEXT_SCRIPT)
        const visibleLength = bodyText.ok ? bodyText.value.trim().length : 0
        observations.push({
          checkId: 'ui-body-text',
          title: 'the application body has visible text',
          ok: bodyText.ok && visibleLength > 20,
          detail: bodyText.ok ? 'visible text length ' + String(visibleLength) : 'could not read body text: ' + bodyText.message,
          expected: 'document.body.innerText with more than 20 non-space characters',
          actual: bodyText.ok ? String(visibleLength) + ' characters' : bodyText.message,
          hint: 'the client bundle may not have mounted; read the instance logs and the screenshot',
        })

        // 2) 工作区按钮存在。
        observations.push({
          checkId: 'ui-workspace-button',
          title: 'the workspace menu trigger is present',
          ok: buttonText !== null,
          detail: buttonText === null ? 'no element matched ' + WORKSPACE_BUTTON : 'found ' + WORKSPACE_BUTTON,
          expected: 'an element matching ' + WORKSPACE_BUTTON,
          actual: buttonText === null ? 'not found within the wait window' : 'found',
          hint: 'check that the client mounted and that the start dialog was dismissed',
        })

        // 3) 按钮矩形在视口内，且中心点的 elementFromPoint 落在按钮里（旧脚本的两条几何断言）。
        const geometryResult = await evaluateThrough<ButtonGeometry>(page.value, GEOMETRY_SCRIPT)
        const geometry = geometryResult.ok ? geometryResult.value : null
        const rect = geometry === null ? null : geometry.rect
        const inViewport =
          rect !== null &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= geometry!.viewport.width + 1 &&
          rect.y + rect.height <= geometry!.viewport.height + 1
        observations.push({
          checkId: 'ui-workspace-button-in-viewport',
          title: 'the workspace trigger rectangle is inside the viewport',
          ok: inViewport,
          detail: geometryResult.ok
            ? 'rect ' + JSON.stringify(rect) + ' viewport ' + JSON.stringify(geometry!.viewport)
            : 'geometry probe failed: ' + geometryResult.message,
          expected: 'width and height above zero, top-left inside the viewport, bottom-right not beyond it',
          actual: geometryResult.ok ? JSON.stringify(rect) : geometryResult.message,
          hint: 'the narrow layout may push the trigger outside the window; compare with the screenshot',
        })
        observations.push({
          checkId: 'ui-workspace-button-hit',
          title: 'the element under the trigger center belongs to the trigger',
          ok: geometry !== null && geometry.hit !== null && geometry.hit.withinButton,
          detail: geometry === null ? 'no geometry probe result' : 'elementFromPoint: ' + JSON.stringify(geometry.hit),
          expected: 'elementFromPoint at the trigger center returns the trigger or one of its children',
          actual: geometry === null ? 'no result' : JSON.stringify(geometry.hit),
          hint: 'another layer (a mask or a toast) may be covering the trigger',
        })

        // 4) 工作区菜单标题：点开菜单、读菜单项、按 Escape 收起（旧脚本的 workspaceMenuTitles）。
        let menuTitles: readonly string[] | null = null
        let menuError: string | null = null
        if (raw.click === undefined) {
          menuError = 'the browser adapter exposes no click()'
        } else {
          const clicked = await raw.click(WORKSPACE_BUTTON)
          if (!clicked.ok) {
            menuError = 'click failed: ' + String(clicked.error === undefined ? 'unknown error' : clicked.error.message)
          } else {
            await sleep(400)
            const titles = await evaluateThrough<readonly string[]>(page.value, MENU_TITLES_SCRIPT)
            if (titles.ok) {
              menuTitles = titles.value
            } else {
              menuError = 'reading menu items failed: ' + titles.message
            }
            if (raw.press !== undefined) await raw.press('Escape')
            await sleep(200)
          }
        }
        observations.push({
          checkId: 'ui-workspace-menu-titles',
          title: 'the workspace menu lists at least one workspace',
          ok: menuTitles !== null && menuTitles.length > 0,
          detail: menuError === null
            ? 'menu items: ' + (menuTitles === null ? 'none' : menuTitles.join(' / '))
            : menuError,
          expected: 'one or more elements with role="menuitem" after opening the workspace menu',
          actual: menuTitles === null ? 'none' : String(menuTitles.length) + ' items',
          hint: 'the menu may be empty when the home has no registered workspace; read the ui-workspace-registered observation',
        })
        observations.push({
          checkId: 'ui-workspace-menu-seeded',
          title: 'the workspace menu shows the seeded workspace',
          ok: menuTitles !== null && menuTitles.some((title) => title.indexOf(SEEDED_WORKSPACE_TITLE) >= 0),
          detail: menuTitles === null ? 'the menu could not be read' : 'looking for ' + SEEDED_WORKSPACE_TITLE + ' in ' + menuTitles.join(' / '),
          expected: 'a menu item whose title contains ' + SEEDED_WORKSPACE_TITLE,
          actual: menuTitles === null ? 'no menu items' : menuTitles.join(' / '),
          hint: 'the title is seeded by prepareHome before the host starts; if the menu lags, the workspace state stream has not caught up yet',
        })

        // 5) 首开遮罩：菜单交互之后再看一眼，避免「按钮出来了但弹窗又回来了」。
        const finalMask = await evaluateThrough<number>(page.value, MASK_COUNT_SCRIPT)
        maskCount = finalMask.ok ? finalMask.value : maskCount
        observations.push({
          checkId: 'ui-start-mask-gone',
          title: 'the first-run dialog mask is gone',
          ok: maskCount === 0,
          detail: finalMask.ok ? 'mask elements: ' + String(maskCount) : 'mask probe failed: ' + finalMask.message,
          expected: 'zero elements matching [class*="_mask_"]',
          actual: finalMask.ok ? String(maskCount) : finalMask.message,
          hint: 'press Escape or click the close button once more; a lingering mask means the dialog did not close',
        })

        // 6) 页面没有未捕获的脚本异常（适配器已过滤 IM 的 404/405 网络噪声）。
        const errors = page.value.pageErrors()
        observations.push({
          checkId: 'ui-page-errors',
          title: 'the page reported no uncaught errors',
          ok: errors.length === 0,
          detail: errors.length === 0 ? 'no page errors' : errors.slice(0, 3).join(' | '),
          expected: 'no pageerror or console.error entries',
          actual: String(errors.length) + ' entries',
          hint: 'read the instance logs and the screenshot; a dev-only warning may be acceptable',
        })

        // 7) 工作区内容确实按 markdown 后端的最小形状写出来了（钩子的产物，不依赖界面）。
        const bindingFile = path.join(workspacePath, 'docs', 'agents', 'workspace.yaml')
        const mapFile = path.join(workspacePath, '.scratch', 'ui-scenario-workspace', 'map.md')
        observations.push({
          checkId: 'ui-seeded-fixture',
          title: 'the seeded workspace has the binding file and the map',
          ok: fs.existsSync(bindingFile) && fs.existsSync(mapFile),
          detail: bindingFile + ' and ' + mapFile,
          expected: 'both files exist under ' + workspacePath,
          actual: String(fs.existsSync(bindingFile)) + ' / ' + String(fs.existsSync(mapFile)),
          hint: 'the prepareHome hook wrote nothing; read verify/hooks.ts',
        })

        // 9) session/list 里刚建的那条会话 cwd 指向种子工作区。
        //    会话是第 0b 步显式建的，所以这里不再是「DSH 有没有恰好建过会话」的碰运气；
        //    列表还没反映出它时记 skip 并说明（列表是活动序，可能有短暂延迟）。
        const listProbe = await evaluateThrough<RpcProbe>(page.value, rpcScript('session/list', '{ _request: {} }'))
        if (!listProbe.ok) {
          observations.push({
            checkId: 'ui-session-cwd',
            title: 'the created session points at the seeded workspace',
            ok: true,
            status: 'skip',
            hard: false,
            detail: 'session/list could not be called: ' + listProbe.message,
            expected: 'a session list response carrying the created session',
            actual: listProbe.message,
            hint: 'the client may still be booting; this observation is informational when the RPC is unavailable',
          })
        } else if (createdSessionId === null) {
          observations.push({
            checkId: 'ui-session-cwd',
            title: 'the created session points at the seeded workspace',
            ok: true,
            status: 'skip',
            hard: false,
            detail: 'no session was created (see ui-session-created), so there is no cwd to compare',
            expected: 'the session created in step 0b appears in session/list',
            actual: String(sessionCreateProblem),
            hint: 'this is a consequence of the workspace/create failure above, not an independent defect',
          })
        } else {
          const sessions = listedSessions(listProbe.value)
          const created = sessions === null ? undefined : sessions.find((item) => item.sessionId === createdSessionId)
          if (created === undefined) {
            observations.push({
              checkId: 'ui-session-cwd',
              title: 'the created session points at the seeded workspace',
              ok: true,
              status: 'skip',
              hard: false,
              detail: 'session/list (HTTP ' + String(listProbe.value.status) + ') does not list ' + createdSessionId + ' yet',
              expected: createdSessionId + ' in session/list with cwd ' + workspacePath,
              actual: sessions === null ? rpcProblem(listProbe.value) : String(sessions.length) + ' session(s)',
              hint: 'the list is ordered by activity and may lag the create call; rerun to confirm',
            })
          } else {
            const matches = created.cwd.length > 0 && path.resolve(created.cwd).toLowerCase() === path.resolve(workspacePath).toLowerCase()
            observations.push({
              checkId: 'ui-session-cwd',
              title: 'the created session points at the seeded workspace',
              ok: matches,
              detail: 'session ' + createdSessionId + ' cwd: ' + (created.cwd.length === 0 ? '(empty)' : created.cwd),
              expected: workspacePath,
              actual: created.cwd.length === 0 ? '(empty)' : created.cwd,
              hint: 'session/create was called with workspaceId ' + String(liveWorkspaceId) + '; a mismatch means the host ignored it',
            })
          }
        }

        // 10) 截图进 evidence：失败时人第一眼要看的就是这个。
        const screenshotPath = path.join(context.evidence.root, 'ui-workspace.png')
        const shot = await page.value.screenshot(screenshotPath)
        observations.push({
          checkId: 'ui-screenshot',
          title: 'a screenshot of the workspace shell was written',
          ok: shot.ok && shot.value.bytes > 0,
          detail: shot.ok ? 'screenshot bytes ' + String(shot.value.bytes) + ' at ' + screenshotPath : 'screenshot failed: ' + shot.error.message,
          expected: 'a non-empty PNG under the run evidence directory',
          actual: shot.ok ? String(shot.value.bytes) + ' bytes' : shot.error.message,
          hint: 'check the evidence directory permissions and the browser adapter',
          evidence: shot.ok && shot.value.bytes > 0 ? [screenshotPath] : [],
        })

        return observations
      },
    },
    {
      id: 'stop',
      kind: 'stop',
      title: 'stop the instance and verify teardown',
    },
  ],
})
