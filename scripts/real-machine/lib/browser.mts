// browser.mts —— Playwright 浏览器工具：独立上下文、截图、读 DOM 文本、点位置与矩形断言。
//
// 一个 batch 里可以同时开多个 BrowserContext，每个实例一个，互不共享 cookie 与存储。
// 页面里的登录弹窗（全新 home 首次打开会出现「开始使用」）由 openApp 统一关掉，
// 之后的命令不用各自处理。
//
// 有头验证（options.fullscreen / openInstance({ headless: false })）会走 enterFullscreen：
// 用 CDP 把窗口切成真全屏，并核对 inner/outer 尺寸等于 screen，做不到直接抛错。
// 2026-10-29 的 1655-01 就吃过亏：窗口只有 1083 像素宽、页面视口被强设成 2195，
// 截图看起来铺满，据此判「浮层被右侧面板盖住」，后来真全屏复核并不存在遮挡。

import path from 'node:path'
import { ensureDir, exists, sleep, writeJson } from './util.mts'

export interface PageOptions {
  width?: number
  height?: number
  locale?: string
  timezoneId?: string
  /**
   * 有头验证必须设 true：这时不锁视口，并把真实浏览器窗口切成真全屏，再核对
   * innerWidth/innerHeight/outerWidth/outerHeight 是否都等于 screen 尺寸。2026-10-29 就踩过一次：
   * Playwright 的 --start-fullscreen 被忽略、用 setViewportSize 强设
   * 页面视口时真实窗口仍只有 1083 宽，截图看起来「铺满」，据此判断浮层有没有被面板盖住就会误判。
   * 无头断言用固定视口（width/height）没问题，但凡结论涉及「会不会被别的界面元素盖住」，必须全屏。
   */
  fullscreen?: boolean
}

/** 一次全屏测量：页面视口、浏览器外框、屏幕、设备像素比。 */
export interface FullscreenMeasurement {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  screenWidth: number
  screenHeight: number
  devicePixelRatio: number
}

/** 全屏测量加判定结论；ok 为 false 时 reason 用完整中文句说清差在哪里。 */
export interface FullscreenSnapshot extends FullscreenMeasurement {
  ok: boolean
  reason: string
  windowId: number | null
  measuredAt: string
}

export interface OpenedApp {
  browser: any
  context: any
  page: any
  tokenUrl: string
  consoleLines: string[]
  pageErrors: string[]
  /** 开了有头全屏时记下当时的测量与判定，没要求全屏时为 null。 */
  fullscreen: FullscreenSnapshot | null
  close: () => Promise<void>
}

/**
 * 判定一次测量算不算真全屏：页面视口与浏览器外框的宽、高都要等于屏幕尺寸（默认允许 2 像素误差），
 * 并且视口不能比外框小（外框大于视口说明还留着浏览器标题栏/地址栏）。
 * 这是纯函数，门禁可以直接拿构造出来的测量数喂它，不用真开浏览器窗口。
 */
export function judgeFullscreen(measurement: Partial<FullscreenMeasurement> | null | undefined, tolerance = 2): { ok: boolean; reason: string } {
  if (!measurement) return { ok: false, reason: '没有拿到窗口与屏幕尺寸，无法判断是不是真全屏' }
  const required: Array<keyof FullscreenMeasurement> = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenWidth', 'screenHeight']
  for (const key of required) {
    const value = measurement[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: '测量里缺少有效的 ' + key + '，无法判断是不是真全屏' }
    }
  }
  const tol = Math.max(0, Number(tolerance) || 0)
  const innerWidth = measurement.innerWidth as number
  const innerHeight = measurement.innerHeight as number
  const outerWidth = measurement.outerWidth as number
  const outerHeight = measurement.outerHeight as number
  const screenWidth = measurement.screenWidth as number
  const screenHeight = measurement.screenHeight as number
  const problems: string[] = []
  if (Math.abs(outerWidth - screenWidth) > tol) {
    problems.push('浏览器外框宽 ' + outerWidth + ' 与屏幕宽 ' + screenWidth + ' 差 ' + Math.abs(outerWidth - screenWidth).toFixed(1) + ' 像素，窗口没有铺满屏幕宽度')
  }
  if (Math.abs(outerHeight - screenHeight) > tol) {
    problems.push('浏览器外框高 ' + outerHeight + ' 与屏幕高 ' + screenHeight + ' 差 ' + Math.abs(outerHeight - screenHeight).toFixed(1) + ' 像素，窗口没有铺满屏幕高度')
  }
  if (outerWidth - innerWidth > tol) {
    problems.push('页面视口宽 ' + innerWidth + ' 比浏览器外框宽 ' + outerWidth + ' 小 ' + (outerWidth - innerWidth).toFixed(1) + ' 像素，说明窗口边框/滚动条还占着地方')
  }
  if (outerHeight - innerHeight > tol) {
    problems.push('页面视口高 ' + innerHeight + ' 比浏览器外框高 ' + outerHeight + ' 小 ' + (outerHeight - innerHeight).toFixed(1) + ' 像素，说明浏览器标题栏/地址栏还占着地方')
  }
  if (problems.length > 0) return { ok: false, reason: '窗口不是真全屏：' + problems.join('；') }
  return { ok: true, reason: '真全屏：页面视口与外框都是 ' + innerWidth + 'x' + innerHeight + '，等于屏幕尺寸 ' + screenWidth + 'x' + screenHeight }
}

/**
 * 起一个 Chromium；同一批命令共用一个即可，页面之间用独立上下文隔离。默认无头。
 *
 * options.channel 传给 Playwright 的 launch：本机只下载了 chromium_headless_shell 时，
 * 有头窗口会报「Executable doesn't exist」，这时传 'chrome' 用系统装的 Chrome 起窗口。
 */
export async function launchBrowser(options: { headless?: boolean; channel?: string } = {}): Promise<any> {
  const playwright: any = await import('playwright')
  const launchOptions: Record<string, any> = { headless: options.headless !== false }
  if (options.channel) launchOptions.channel = options.channel
  return playwright.chromium.launch(launchOptions)
}

/**
 * 读一次全屏相关的尺寸，并给出判定。窗口刚切全屏时布局可能还没稳，
 * 所以 enterFullscreen 会反复调用它，直到判定通过或超时。
 */
async function measureFullscreen(page: any, windowId: number | null, tolerance: number): Promise<FullscreenSnapshot> {
  const measurement: FullscreenMeasurement = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
  }))
  const verdict = judgeFullscreen(measurement, tolerance)
  return {
    ...measurement,
    ok: verdict.ok,
    reason: verdict.reason,
    windowId,
    measuredAt: new Date().toISOString(),
  }
}

/**
 * 把真实浏览器窗口切成真全屏，并核对页面视口与外框都等于屏幕尺寸；做不到就抛错，绝不静默放行。
 *
 * 为什么不用 Playwright 的 --start-fullscreen：2026-10-29 实测它被忽略，窗口仍只有 1083 像素宽；
 * 再用 setViewportSize 强设页面视口，截图看起来铺满了，实际窗口没全屏，据此判断「浮层有没有被
 * 右侧面板盖住」就会得出错误结论。可靠的做法只有 Chrome DevTools Protocol 的
 * Browser.setWindowBounds({ windowState: 'fullscreen' })，切完再拿 innerWidth/outerWidth 与
 * screen 尺寸对账。
 */
export async function enterFullscreen(page: any, options: { timeoutMs?: number; tolerance?: number; settleMs?: number } = {}): Promise<FullscreenSnapshot> {
  const timeoutMs = options.timeoutMs ?? 8000
  const tolerance = options.tolerance ?? 2
  let windowId: number | null = null
  try {
    const cdp = await page.context().newCDPSession(page)
    const info = await cdp.send('Browser.getWindowForTarget')
    windowId = Number(info.windowId)
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } })
  } catch (error) {
    throw new Error(
      '切换浏览器真全屏失败：' + (error instanceof Error ? error.message : String(error)) +
        '。有头验证必须让窗口真的全屏，固定视口（width/height）不等于全屏。',
    )
  }
  const started = Date.now()
  let snapshot = await measureFullscreen(page, windowId, tolerance)
  while (!snapshot.ok && Date.now() - started < timeoutMs) {
    await sleep(150)
    snapshot = await measureFullscreen(page, windowId, tolerance)
  }
  if (!snapshot.ok) {
    throw new Error('页面窗口没有进入真全屏（等了 ' + timeoutMs + ' 毫秒）：' + snapshot.reason + '。这条结论不能当作全屏证据。')
  }
  // 字号、折行与面板宽度会随真实视口重排，等布局稳定后再交给调用方量尺寸。
  await sleep(options.settleMs ?? 300)
  return measureFullscreen(page, windowId, tolerance)
}

/**
 * 开一个新的隔离上下文与页面，不做页面跳转。
 * options.fullscreen 为 true 时不锁视口（viewport: null），并在开页后立刻切真全屏、核对尺寸；
 * 切不成会抛错，不会留下一个「看起来很大、其实没全屏」的窗口。
 */
export async function newPage(
  browser: any,
  options: PageOptions = {},
): Promise<{ context: any; page: any; consoleLines: string[]; pageErrors: string[]; fullscreen: FullscreenSnapshot | null }> {
  const fullscreen = options.fullscreen === true
  const context = await browser.newContext({
    viewport: fullscreen ? null : { width: options.width ?? 1600, height: options.height ?? 1000 },
    locale: options.locale || 'zh-CN',
    ...(options.timezoneId ? { timezoneId: options.timezoneId } : {}),
  })
  const page = await context.newPage()
  const consoleLines: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message: any) => {
    const type = String(message.type())
    if (type === 'error' || type === 'warning') consoleLines.push(type + ': ' + message.text())
  })
  page.on('pageerror', (error: any) => pageErrors.push(String(error && error.stack ? error.stack : error)))
  if (!fullscreen) return { context, page, consoleLines, pageErrors, fullscreen: null }
  try {
    const snapshot = await enterFullscreen(page)
    return { context, page, consoleLines, pageErrors, fullscreen: snapshot }
  } catch (error) {
    // 全屏失败时把上下文收掉，避免留下一个不可信的窗口让调用方误用。
    await context.close().catch(() => undefined)
    throw error
  }
}

/**
 * 打开实例的访问地址并等到界面可用：工作区按钮出现、首开登录弹窗被关掉。
 * 关弹窗的办法是按 Escape（实测有效），关不掉时点右上角 aria-label="关闭" 的按钮。
 */
export async function openApp(opened: OpenedApp, timeoutMs = 60000): Promise<void> {
  const { page, tokenUrl } = opened
  await page.goto(tokenUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  // 首屏渲染比 domcontentloaded 慢：先等一小会，再关登录弹窗；按钮出现后再补关一次，
  // 否则弹窗可能在第一次检查之后才盖上，后面的点击会被遮罩拦截而超时。
  await page.waitForTimeout(1500)
  await dismissStartDialog(page, timeoutMs)
  await page.locator('button[aria-label="选择工作区"]').first().waitFor({ state: 'visible', timeout: timeoutMs })
  await dismissStartDialog(page, timeoutMs)
  await page.waitForTimeout(300)
}

async function dismissStartDialog(page: any, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const blocker = await page.evaluate(() => {
      const mask = document.querySelector('[class*="_mask_"]')
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,div')).find((node) =>
        (node.textContent || '').trim().startsWith('开始使用'),
      )
      return Boolean(mask || heading)
    })
    if (!blocker) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const close = page.locator('button[aria-label="关闭"]').first()
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined)
    await page.waitForTimeout(300)
  }
}

/**
 * 一步到位：起浏览器、开上下文、打开实例。返回的 close 会一起收掉上下文与浏览器。
 *
 * 有头验证请传 headless: false：这时会自动把窗口切成真全屏并核对尺寸（除非显式写
 * page.fullscreen: false）。这样「固定视口当成全屏」的老问题不会再从调用方溜进来；
 * 全屏测量记在返回值的 fullscreen 字段里，writePageDiagnostics 也会一起写进证据。
 * 有头起不来（本机只装了 chromium_headless_shell）时传 channel: 'chrome' 用系统 Chrome。
 */
export async function openInstance(
  tokenUrl: string,
  options: { browser?: any; page?: PageOptions; headless?: boolean; channel?: string } = {},
): Promise<OpenedApp> {
  const browser = options.browser || (await launchBrowser({ headless: options.headless, channel: options.channel }))
  const pageOptions: PageOptions = { ...(options.page || {}) }
  const headed = options.headless === false
  if (headed && pageOptions.fullscreen === undefined) pageOptions.fullscreen = true
  const created = await newPage(browser, pageOptions)
  const opened: OpenedApp = {
    browser,
    context: created.context,
    page: created.page,
    tokenUrl,
    consoleLines: created.consoleLines,
    pageErrors: created.pageErrors,
    fullscreen: created.fullscreen,
    close: async () => {
      await created.context.close().catch(() => undefined)
      if (!options.browser) await browser.close().catch(() => undefined)
    },
  }
  try {
    await openApp(opened)
    return opened
  } catch (error) {
    // 打开失败也要把浏览器收掉，否则 Playwright 的子进程会让命令一直不退出。
    await opened.close()
    throw error
  }
}

/** 截图；目录不存在会自动建。返回绝对路径。 */
export async function screenshot(page: any, filePath: string, options: { fullPage?: boolean } = {}): Promise<string> {
  const target = path.resolve(filePath)
  ensureDir(path.dirname(target))
  await page.screenshot({ path: target, fullPage: options.fullPage === true })
  return target
}

/** 读页面可见文本（innerText），保留换行。 */
export async function readDomText(page: any): Promise<string> {
  return page.evaluate(() => document.body.innerText || '')
}

export interface PointHit {
  found: boolean
  tag: string
  id: string
  className: string
  ariaLabel: string
  text: string
  rect: { x: number; y: number; width: number; height: number } | null
}

/** 用 document.elementFromPoint 看某个坐标上实际是谁：点是哪个元素、它是否带某个标记。 */
export async function elementFromPoint(page: any, x: number, y: number): Promise<PointHit> {
  return page.evaluate(
    ({ px, py }: { px: number; py: number }) => {
      const element = document.elementFromPoint(px, py) as HTMLElement | null
      if (!element) {
        return { found: false, tag: '', id: '', className: '', ariaLabel: '', text: '', rect: null }
      }
      const rect = element.getBoundingClientRect()
      return {
        found: true,
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : String((element as any).className || ''),
        ariaLabel: element.getAttribute('aria-label') || '',
        text: (element.innerText || element.textContent || '').trim().slice(0, 200),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    },
    { px: x, py: y },
  )
}

/** 按选择器取矩形（boundingClientRect），拿不到元素时返回 null。 */
export async function boundingClientRect(page: any, selector: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((css: string) => {
    const element = document.querySelector(css) as HTMLElement | null
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, selector)
}

/** 读一个元素的关键属性（文本、aria-label、是否可见、矩形）。 */
export async function describeElement(page: any, selector: string): Promise<Record<string, any> | null> {
  return page.evaluate((css: string) => {
    const element = document.querySelector(css) as HTMLElement | null
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.textContent || '').trim().slice(0, 500),
      ariaLabel: element.getAttribute('aria-label') || '',
      className: typeof element.className === 'string' ? element.className : '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: rect.width > 0 && rect.height > 0,
    }
  }, selector)
}

/** 按 aria-label 点一个按钮；点不到就返回 false，不抛异常。 */
export async function clickByAriaLabel(page: any, label: string): Promise<boolean> {
  const locator = page.locator('button[aria-label="' + label.replace(/"/g, '\\"') + '"]').first()
  if (!(await locator.isVisible().catch(() => false))) return false
  await locator.click()
  return true
}

/** 页面里发一次 DSH 的 RPC：必须带完整的 client-request 包装，否则服务端判非法请求。 */
export async function pageRpc(page: any, method: string, args: Record<string, any> = {}): Promise<any> {
  return page.evaluate(
    async ({ rpcMethod, rpcArgs }: { rpcMethod: string; rpcArgs: Record<string, any> }) => {
      const body = {
        type: 'client-request',
        rpcId: (globalThis as any).crypto.randomUUID(),
        method: rpcMethod,
        payload: { args: rpcArgs },
      }
      const response = await fetch('/api/' + rpcMethod, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      try {
        return { status: response.status, body: JSON.parse(text) }
      } catch {
        return { status: response.status, body: text.slice(0, 2000) }
      }
    },
    { rpcMethod: method, rpcArgs: args },
  )
}

/** 会话列表：用来确认实例当前指向哪个工作目录（cwd）。 */
export async function sessionList(page: any): Promise<any> {
  const response = await pageRpc(page, 'session/list', { _request: {} })
  return response
}

/** 工作区菜单里显示的名字，用来确认实例看到的是自己的批次工作区。 */
export async function workspaceMenuTitles(page: any): Promise<string[]> {
  const button = page.locator('button[aria-label="选择工作区"]').first()
  await button.click()
  await page.waitForTimeout(250)
  const titles = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    return items.map((item) => (item.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  })
  await page.keyboard.press('Escape')
  return titles
}

/** 打开插件面板并返回面板文本（含工作区名与统计），用来做设置隔离的证据。 */
export async function readPluginPanel(page: any): Promise<string> {
  const button = page.locator('button[aria-label="展开MattSkillsDeck"]').first()
  await button.click()
  await page.waitForTimeout(800)
  const text = await page.evaluate(() => {
    const panel = document.querySelector('[class*="panel"], [class*="deck"]')
    return (panel ? (panel as HTMLElement).innerText : document.body.innerText || '').trim().slice(0, 4000)
  })
  return text
}

/**
 * 把页面的控制台错误、页面异常与全屏测量写成一个文件，便于进证据包。
 * fullscreen 字段是判定「这份界面结论是不是在真全屏下得到的」的凭据：没开全屏时为 null。
 */
export function writePageDiagnostics(
  opened: { consoleLines: string[]; pageErrors: string[]; fullscreen?: FullscreenSnapshot | null },
  dir: string,
): string {
  const target = path.join(path.resolve(dir), 'page-diagnostics.json')
  ensureDir(path.dirname(target))
  writeJson(target, {
    consoleLines: opened.consoleLines,
    pageErrors: opened.pageErrors,
    fullscreen: opened.fullscreen ?? null,
    capturedAt: new Date().toISOString(),
  })
  return target
}

export { sleep, exists }