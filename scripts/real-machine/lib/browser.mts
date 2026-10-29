// browser.mts —— Playwright 无头浏览器工具：独立上下文、截图、读 DOM 文本、点位置与矩形断言。
//
// 一个 batch 里可以同时开多个 BrowserContext，每个实例一个，互不共享 cookie 与存储。
// 页面里的登录弹窗（全新 home 首次打开会出现「开始使用」）由 openApp 统一关掉，
// 之后的命令不用各自处理。

import path from 'node:path'
import { ensureDir, exists, sleep, writeJson } from './util.mts'

export interface PageOptions {
  width?: number
  height?: number
  locale?: string
  timezoneId?: string
}

export interface OpenedApp {
  browser: any
  context: any
  page: any
  tokenUrl: string
  consoleLines: string[]
  pageErrors: string[]
  close: () => Promise<void>
}

/** 起一个无头 Chromium；同一批命令共用一个即可，页面之间用独立上下文隔离。 */
export async function launchBrowser(options: { headless?: boolean } = {}): Promise<any> {
  const playwright: any = await import('playwright')
  return playwright.chromium.launch({ headless: options.headless !== false })
}

/** 开一个新的隔离上下文与页面，不做页面跳转。 */
export async function newPage(browser: any, options: PageOptions = {}): Promise<{ context: any; page: any; consoleLines: string[]; pageErrors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1600, height: options.height ?? 1000 },
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
  return { context, page, consoleLines, pageErrors }
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

/** 一步到位：起浏览器、开上下文、打开实例。返回的 close 会一起收掉上下文与浏览器。 */
export async function openInstance(tokenUrl: string, options: { browser?: any; page?: PageOptions } = {}): Promise<OpenedApp> {
  const browser = options.browser || (await launchBrowser())
  const created = await newPage(browser, options.page || {})
  const opened: OpenedApp = {
    browser,
    context: created.context,
    page: created.page,
    tokenUrl,
    consoleLines: created.consoleLines,
    pageErrors: created.pageErrors,
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

/** 把页面的控制台错误与页面异常写成一个文件，便于进证据包。 */
export function writePageDiagnostics(opened: { consoleLines: string[]; pageErrors: string[] }, dir: string): string {
  const target = path.join(path.resolve(dir), 'page-diagnostics.json')
  ensureDir(path.dirname(target))
  writeJson(target, { consoleLines: opened.consoleLines, pageErrors: opened.pageErrors, capturedAt: new Date().toISOString() })
  return target
}

export { sleep, exists }