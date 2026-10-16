// tests/lib/browser-pool.ts —— 门禁取浏览器实例的唯一入口：自己起一个，或者连共享的那一个。
//
// 两种模式，只由环境变量 DSH_TEST_BROWSER_WS 决定：
//   没设（门禁的默认用法，单跑一道门禁就是这一种）：自己 chromium.launch(...)，
//     传进来的 launchOptions 原样用，与门禁原来写死的 chromium.launch({ headless: true }) 等价。
//   设了：连到 scripts/browser-host.mjs 起的共享实例上；这一趟跑完只断开连接，
//     不把浏览器关掉 —— 后面接着跑的门禁还要用同一只。
//
// 这一层只管「浏览器从哪来、什么时候还」，门禁量什么、判什么，一个字都不掺和。
//
// 连不上就抛错，绝不偷偷降级成「自己起一个」：环境变量是上层明确给的，连不上说明要么共享实例
// 没起来、要么地址写错了，这时候悄悄改用本地浏览器，只会把这件事藏起来，还让「共用浏览器到底
// 省了多少」这个数失真（半路混进一次真的 launch）。要改回自己起，清掉环境变量再跑就是了。
//
// ESM 具名导出：语言级保证，比原来靠 cjs-module-lexer 静态识别 exports.x 更结实；
// 引用侧 14 处写法一个字都不用改，scripts/ts-hook.mjs 会把 './lib/browser-pool.js' 改指到本文件。
import type { Browser, Chromium, LaunchOptions, Page } from 'playwright'

export const SHARED_WS_ENV = 'DSH_TEST_BROWSER_WS'
// 连共享实例的最长等待。默认值是 30 秒，太长了：地址写错这种常见故障应该当场报出来。
const CONNECT_TIMEOUT_MS = 15_000

let browser: Browser | null = null
// 非空 = 这一只是连来的共享实例（收尾时只断开、不关掉）；null = 自己起的。
let sharedEndpoint: string | null = null

/** 取 playwright 的 chromium。走动态 import：保持懒加载，单测进程加载本文件时不解析 playwright。 */
async function loadChromium(): Promise<Chromium> {
  const mod = await import('playwright') as unknown as { chromium?: Chromium; default?: { chromium?: Chromium } }
  const chromium: Chromium | undefined = mod.chromium ?? mod.default?.chromium
  if (!chromium) throw new Error('playwright 里找不到 chromium：' + Object.keys(mod).join(','))
  return chromium
}

/**
 * 拿到这一趟要用的浏览器。同一进程里重复调用返回同一只（不会重复 launch）。
 * @param launchOptions 自己起的时候交给 chromium.launch 的选项，例如 { headless: true }。
 *   连共享实例时这个参数用不上（共享那一只是宿主的选项起的），传了会被忽略。
 */
export async function getBrowser(launchOptions?: LaunchOptions): Promise<Browser> {
  if (browser) return browser
  const chromium = await loadChromium()
  const ws = String(process.env[SHARED_WS_ENV] || '').trim()
  if (!ws) {
    browser = await chromium.launch(launchOptions || { headless: true })
    return browser
  }
  try {
    browser = await chromium.connect(ws, { timeout: CONNECT_TIMEOUT_MS })
  } catch (err) {
    throw new Error(
      '连不上共享浏览器：' + SHARED_WS_ENV + '=' + ws + '，' + CONNECT_TIMEOUT_MS + ' 毫秒内没连上。' +
        '共享实例这样起：node scripts/browser-host.mjs（它会把地址打在一行 WS=... 上）。' +
        '要改回这道门禁自己起浏览器：清掉 ' + SHARED_WS_ENV + ' 再跑。' +
        '底层原因：' + String((err && (err as Error).message) || err)
    )
  }
  sharedEndpoint = ws
  return browser
}

/**
 * 收摊：自己起的那只关掉；连来的那只只断开连接（playwright 的约定：连来的浏览器 close() 只断
 * 开并清掉本连接建的上下文，不会关掉宿主那只浏览器）。收尾失败不抛错 —— 门禁马上就要退出，
 * 不该因为收尾这一步把一趟本来绿的门禁染红。重复调用安全。
 */
export async function closeBrowser(): Promise<void> {
  const current = browser
  browser = null
  sharedEndpoint = null
  if (!current) return
  try {
    await current.close()
  } catch (err) {
    // 已经断开或已经被关：忽略。
  }
}

/** 这一趟用的是共享实例吗（排查用）。 */
export function isShared(): boolean {
  return !!sharedEndpoint
}

/**
 * 便捷包装：开一页、交给 fn 用、无论成败都把这一页关掉。
 * 页面级的清理（关页）与浏览器级的清理（closeBrowser）是两回事：门禁自己起浏览器时，
 * 原来靠 browser.close() 一并收掉页面；共用实例时那只浏览器还活着，页面要自己关。
 * @param options newPage 的选项；直接给函数时按 fn 用。
 * @param fn 收 page 的回调，返回值原样返回。
 */
export async function withPage<T>(options?: object, fn?: (page: Page) => Promise<T> | T): Promise<T> {
  if (typeof options === 'function') { fn = options as (page: Page) => Promise<T> | T; options = undefined }
  const b = await getBrowser()
  const page = await b.newPage(options)
  try {
    return await (fn as (page: Page) => Promise<T> | T)(page)
  } finally {
    try { await page.close() } catch (err) { /* 页面可能已经自己关了 */ }
  }
}
