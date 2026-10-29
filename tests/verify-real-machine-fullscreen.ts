#!/usr/bin/env node
/**
 * verify-real-machine-fullscreen.ts —— 真机验证工具台「有头窗口必须真全屏」的门禁。
 *
 * 背景：2026-10-29 验 1655-01 时，Playwright 的 --start-fullscreen 被忽略，真实窗口只有 1083 像素宽；
 * 又用 setViewportSize 把页面视口强设成 2195，截图看起来铺满屏幕，据此判「关闭整个 deck 的跟随浮层
 * 被右侧面板盖住、确认键鼠标点不到」。后来用 CDP 把窗口切成真全屏复核，遮挡并不存在——错的是验证方法，
 * 不是产品。这一份门禁守三件事：
 *   1. judgeFullscreen 只承认「页面视口与浏览器外框都等于屏幕尺寸」的测量，差一点都不放过，并说清差在哪。
 *   2. browser.mts 真的导出 enterFullscreen 与 judgeFullscreen，openInstance 在有头（headless:false）时
 *      默认切全屏，全屏测量会写进 page-diagnostics.json。
 *   3. 工具台 README 与真机验证规则文档都写明「有头必须真全屏、固定视口不算」，下次照着文档做也不会再错。
 *
 * 为什么用构造出来的测量数：真开全屏窗口需要图形会话，门禁链不能依赖显示器。CDP 切换那一段的正确性由
 * 2026-10-29 的真机复测（#1637 批次评论与 s1655 证据）作证，这里守的是判定逻辑与调用约定不退化。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-real-machine-fullscreen.ts
 *
 * 门禁归属: scripts/real-machine/lib/browser.mts
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0
const check = (ok, msg, detail) => {
  if (ok) {
    console.log('  PASS ' + msg)
    passed += 1
  } else {
    console.log('  FAIL ' + msg + (detail ? ' —— ' + String(detail).slice(0, 300) : ''))
    failed += 1
  }
}
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

async function main() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts', 'real-machine', 'lib', 'browser.mts')).href)

  console.log('第一组：judgeFullscreen 的判定口径')
  check(typeof lib.judgeFullscreen === 'function', 'browser.mts 导出 judgeFullscreen 纯函数，门禁可以直接拿测量数喂它')
  check(typeof lib.enterFullscreen === 'function', 'browser.mts 导出 enterFullscreen，有头验证统一走它切全屏并核对')

  const fullscreen = lib.judgeFullscreen({
    innerWidth: 2195,
    innerHeight: 1235,
    outerWidth: 2195,
    outerHeight: 1235,
    screenWidth: 2195,
    screenHeight: 1235,
    devicePixelRatio: 1.75,
  })
  check(fullscreen.ok === true, '页面视口与外框都等于屏幕尺寸时判为真全屏', fullscreen.reason)
  check(String(fullscreen.reason).includes('真全屏'), '判定通过时 reason 明确写「真全屏」，读证据的人不用再猜', fullscreen.reason)

  const incident = lib.judgeFullscreen({
    innerWidth: 2195,
    innerHeight: 1235,
    outerWidth: 1083,
    outerHeight: 1168,
    screenWidth: 2195,
    screenHeight: 1235,
    devicePixelRatio: 1.75,
  })
  check(incident.ok === false, '2026-10-29 的真实错法（窗口 1083 宽、页面视口被强设成 2195）必须判为不是全屏', incident.reason)
  check(String(incident.reason).includes('1083') && String(incident.reason).includes('2195'), '判为不是全屏时 reason 写出外框宽 1083 与屏幕宽 2195 的差，能直接看出错在哪', incident.reason)

  const windowed = lib.judgeFullscreen({
    innerWidth: 1600,
    innerHeight: 940,
    outerWidth: 1600,
    outerHeight: 1000,
    screenWidth: 2195,
    screenHeight: 1235,
    devicePixelRatio: 1,
  })
  check(windowed.ok === false, '固定视口的普通窗口（1600x1000，页面可见区 1600x940）判为不是全屏', windowed.reason)

  const near = { innerWidth: 2195, innerHeight: 1235, outerWidth: 2195, outerHeight: 1235, screenWidth: 2196, screenHeight: 1236 }
  check(lib.judgeFullscreen(near).ok === true, '默认允许 2 像素误差：屏幕尺寸少报 1 像素仍算真全屏')
  const far = { innerWidth: 2195, innerHeight: 1235, outerWidth: 2195, outerHeight: 1235, screenWidth: 2200, screenHeight: 1240 }
  check(lib.judgeFullscreen(far).ok === false, '差 5 像素超过默认容差时判为不是全屏，避免把「差不多」当成全屏')

  check(lib.judgeFullscreen({ innerWidth: 2195, innerHeight: 1235, outerWidth: 2195, outerHeight: 1235, screenWidth: 2195 }).ok === false, '测量缺 screenHeight 时判为不是全屏，不让残缺数据过关')
  check(lib.judgeFullscreen({ innerWidth: NaN, innerHeight: 1235, outerWidth: 2195, outerHeight: 1235, screenWidth: 2195, screenHeight: 1235 }).ok === false, '测量里出现 NaN 时判为不是全屏')
  check(lib.judgeFullscreen(null).ok === false && String(lib.judgeFullscreen(null).reason).includes('无法判断'), '完全没测量数据时判为不是全屏，并说清无法判断')

  console.log('第二组：browser.mts 的实现约定')
  const browserSource = readText('scripts/real-machine/lib/browser.mts')
  check(browserSource.includes("Browser.setWindowBounds") && browserSource.includes("windowState: 'fullscreen'"), '切全屏走 Chrome DevTools Protocol 的 Browser.setWindowBounds(windowState: fullscreen)，不依赖 --start-fullscreen 参数')
  check(browserSource.includes('viewport: fullscreen ? null :'), '要求全屏时上下文不锁视口（viewport: null），页面按真实窗口尺寸排版')
  check(browserSource.includes('pageOptions.fullscreen === undefined') && browserSource.includes('pageOptions.fullscreen = true'), 'openInstance({ headless: false }) 在有头时默认打开全屏，调用方忘了写 fullscreen 也不会退化成固定视口')
  check(browserSource.includes('fullscreen: opened.fullscreen ?? null'), 'writePageDiagnostics 把全屏测量写进 page-diagnostics.json，证据里能看出结论是不是全屏下得到的')
  check(browserSource.includes('页面窗口没有进入真全屏'), '切不成全屏时抛中文错误，绝不静默放过一个不够大的窗口')
  check(browserSource.includes('options.channel') && browserSource.includes('channel: options.channel'), '有头窗口起不来时可以用 channel 指定系统 Chrome，不会卡在「本机没装 Playwright 有头浏览器」')
  check(readText('scripts/real-machine/README.md').includes("channel: 'chrome'"), '工具台 README 写明有头起不来时用 channel: chrome')

  console.log('第三组：文档里写清了规则')
  const readme = readText('scripts/real-machine/README.md')
  check(readme.includes('真全屏') && readme.includes('固定视口'), '工具台 README 写明有头验证必须真全屏、固定视口不能用来判遮挡类问题')
  const rules = readText('docs/agents/real-machine-verification.md')
  check(rules.includes('真全屏') && rules.includes('innerWidth'), '真机验证规则文档写明必须核对 innerWidth/outerWidth 等于 screen 尺寸')

  console.log('')
  console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
  printGateResult('verify-real-machine-fullscreen', passed + failed, failed)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error('门禁自己崩了：' + (error && error.stack ? error.stack : error))
  printGateResult('verify-real-machine-fullscreen', passed + failed, failed + 1)
  process.exitCode = 1
})
