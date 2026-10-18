#!/usr/bin/env node
// scripts/browser-host.mts —— 共享浏览器宿主：起一个 Chromium，供多道门禁复用同一只。
//
// 由 scripts/browser-host.mjs 转写（#1252）：只加类型注解，行为零变化。
// 入口仍是 `node scripts/browser-host.mts`（前台常驻，Ctrl+C 收摊）。
//
// 为什么要有它：链上那 12 扇用 playwright 的门禁，原本各自 chromium.launch() 一次，每次启动要
//   1-3 秒，串行跑一遍光起浏览器就花掉一百多秒。这个脚本起一个 playwright 的 browser server，
//   把它的 websocket 地址打在标准输出上（一行 WS=...），门禁那边连过来共用同一只
//   （门禁侧的入口是 tests/lib/browser-pool.js，它认 DSH_TEST_BROWSER_WS 这个环境变量）。
//
// 用法（前台常驻，Ctrl+C 收摊）：
//   node scripts/browser-host.mts
// 上层脚本抓地址：读它标准输出的第一行，取 WS= 后面那段。
//
// 退出约定（上层按这三条判断）：
//   0 = 收到 SIGTERM / SIGINT，已经把浏览器关掉再退出；
//   1 = 浏览器起不来（原因写在标准错误里）；
//   2 = 浏览器或 server 自己先没了（不是收到信号关的，这一趟共享实例已经不可信）。
//
// 注意：标准输出上只有 WS= 那一行，别的诊断一律走标准错误，免得抓地址的上层脚本读串。

import { chromium } from 'playwright'

// 纯兜底定时器：playwright 的传输层通常自己撑得住事件循环，这里再放一个空转的心跳，
// 免得宿主进程因为「没事可做」而退出、把浏览器留成没人管的孤儿进程。
const KEEPALIVE_MS = 60_000

function fail(code: number, message: string, err?: unknown): never {
  console.error('[browser-host] ' + message)
  if (err) console.error('[browser-host] 底层原因：' + String((err && (err as Error).stack) || err))
  process.exit(code)
}

// fail() 退出码非零直接结束进程，所以能走到下面的 server 一定已经起好了 ——
// 用明确赋值断言记下这条约定，免得每次使用时都要再判一次空。
let server!: Awaited<ReturnType<typeof chromium.launchServer>>
try {
  server = await chromium.launchServer({ headless: true })
} catch (err) {
  fail(
    1,
    'Chromium 起不来：playwright 的 chromium.launchServer 抛错了。' +
      '常见原因：playwright 的浏览器还没装（npx playwright install chromium）、' +
      '或者本机 Chromium 被别的进程占着/被杀软拦了。',
    err
  )
}

// 这一行是给上层脚本抓的，格式固定，别改。
console.log('WS=' + server.wsEndpoint())
console.error('[browser-host] 共享浏览器已就绪，pid=' + process.pid)

const keepalive = setInterval(() => {}, KEEPALIVE_MS)
let closing = false

async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  clearInterval(keepalive)
  console.error('[browser-host] 收到 ' + signal + '，关掉浏览器后退出')
  try {
    await server.close()
  } catch (err) {
    // 浏览器可能已经自己没了；收摊阶段不值得因为这个改写退出码。
    console.error('[browser-host] 关浏览器时报错（照常退出）：' + String((err && (err as Error).message) || err))
  }
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })

// server 自己没了 = 浏览器崩了或者被别的东西杀了。这时候还连着的门禁会莫名其妙地红，
// 所以这里明确报一条原因并用非零码退出，让上层知道是宿主先没的，而不是门禁量出来的红。
server.on('close', () => {
  if (closing) return
  clearInterval(keepalive)
  fail(2, '浏览器自己先退出了（不是收到信号关的）：这一趟共享实例已经不可用。')
})
