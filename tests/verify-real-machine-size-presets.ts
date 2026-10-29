#!/usr/bin/env node
/**
 * verify-real-machine-size-presets.ts —— 真机验证「三款窗口尺寸」预置的门禁。
 *
 * 背景：2026-10-29 维护者定版「真机验证只跑全屏宽、窄窗、宽矮窗这三款窗口形态」，其它分辨率不再单测。
 * 如果每个批次脚本各自写窗口尺寸，迟早有人写 720 宽（那是直觉数字）然后声称「测了窄态」——实测宿主在
 * 720 宽会把右侧面板切成整宽覆盖，插件根本没进 .dsws-narrow；也可能有人用 setViewportSize 强设页面视口
 * 假装换了窗口（1655-01 就因此误判过）。这一份门禁守四件事：
 *   1. presets.mts 里就是这三款，编号、窗口尺寸、期望窄态固定，换算成 CDP 窗口外框的结果可验。
 *   2. 屏幕尺寸拿不到时换算必须抛中文错误，不能返回 0 宽窗口。
 *   3. browser.mts 真的导出 applyViewportPreset：走 CDP 改真实窗口、两步从全屏退回普通窗口、
 *      核对 .dsws-narrow 与 .dsws-body 面板宽，对不上抛错，并且不用 setViewportSize。
 *   4. 工具台 README 与真机验证规则文档写明三款尺寸、800 而不是 720 的理由，以及 viewport 证据字段。
 *
 * 为什么不起浏览器：真开窗口需要图形会话，门禁链不能依赖显示器。窗口设置的正确性由
 * 2026-10-29 的真机探针（s1653 evidence-mapping 与 applyViewportPreset 实跑）作证，这里守的是数据与调用约定不退化。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-real-machine-size-presets.ts
 *
 * 门禁归属: scripts/real-machine/lib/presets.mts
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
const SPEC = { width: 2195, height: 1235 }

async function main() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts', 'real-machine', 'lib', 'presets.mts')).href)

  console.log('第一组：三款预设的数据')
  check(Array.isArray(lib.VIEWPORT_PRESETS) && lib.VIEWPORT_PRESETS.length === 3, 'VIEWPORT_PRESETS 恰好三款：全屏宽、窄窗、宽矮窗')
  check(lib.VIEWPORT_PRESETS.map((p) => p.id).join(',') === 'wide,narrow,short', '三款编号固定为 wide、narrow、short，顺序不变', lib.VIEWPORT_PRESETS.map((p) => p.id).join(','))
  const wide = lib.VIEWPORT_PRESETS[0]
  check(wide.window === null && wide.expectDockNarrow === false, 'wide 是「真全屏」（window 为 null）且期望不进入窄态')
  const narrow = lib.VIEWPORT_PRESETS[1]
  check(narrow.window && narrow.window.width === 800 && narrow.window.height === 'screen', 'narrow 的窗口外框宽是 800、高取屏幕高（不是直觉上的 720 宽）', JSON.stringify(narrow.window))
  check(narrow.expectDockNarrow === true, 'narrow 期望插件进入窄态（.dsws-narrow 在场）')
  const short = lib.VIEWPORT_PRESETS[2]
  check(short.window && short.window.width === 'screen' && short.window.height === 600, 'short 的窗口外框宽取屏幕宽、高固定 600', JSON.stringify(short.window))
  check(short.expectDockNarrow === false, 'short 期望仍走宽布局（不进入窄态），它压的是垂直方向')
  check(
    lib.VIEWPORT_PRESETS.every((p) => typeof p.label === 'string' && p.label.length > 0 && typeof p.description === 'string' && p.description.length >= 10),
    '每款都写了中文短名与足够长的说明，读证据的人不用回来翻脚本',
  )

  console.log('第二组：预设换算成窗口外框（纯函数）')
  check(typeof lib.resolvePresetWindow === 'function', 'presets.mts 导出 resolvePresetWindow 纯函数，门禁不用起浏览器就能验算')
  const wideResolved = lib.resolvePresetWindow(wide, SPEC)
  check(wideResolved.windowState === 'fullscreen', 'wide 换算成 windowState=fullscreen，不带宽高', JSON.stringify(wideResolved))
  const narrowResolved = lib.resolvePresetWindow(narrow, SPEC)
  check(narrowResolved.windowState === 'normal' && narrowResolved.width === 800 && narrowResolved.height === 1235, 'narrow 在本机 2195x1235 屏幕上换算成普通窗口 800x1235', JSON.stringify(narrowResolved))
  const shortResolved = lib.resolvePresetWindow(short, SPEC)
  check(shortResolved.windowState === 'normal' && shortResolved.width === 2195 && shortResolved.height === 600, 'short 在本机 2195x1235 屏幕上换算成普通窗口 2195x600', JSON.stringify(shortResolved))
  const otherScreen = lib.resolvePresetWindow(narrow, { width: 1600, height: 900 })
  check(otherScreen.height === 900 && otherScreen.width === 800, '换一块屏幕时 narrow 仍保持 800 宽、高度跟着屏幕走', JSON.stringify(otherScreen))
  for (const bad of [{ width: 0, height: 1235 }, { width: NaN, height: 1235 }, null, undefined]) {
    const label = bad === null ? 'null' : String(bad && (bad.width + 'x' + bad.height))
    let threw = null
    try {
      lib.resolvePresetWindow(narrow, bad)
    } catch (error) {
      threw = error
    }
    check(Boolean(threw) && /屏幕尺寸/.test(String(threw && threw.message)), '屏幕尺寸非法（' + label + '）时抛中文错误，不拿 0 宽窗口去量结论', threw && threw.message)
  }

  console.log('第三组：按编号取预设')
  check(lib.presetById('narrow') === lib.VIEWPORT_PRESETS[1], "presetById('narrow') 返回同一份 narrow 预设")
  let unknownThrew = null
  try {
    lib.presetById('medium')
  } catch (error) {
    unknownThrew = error
  }
  check(
    Boolean(unknownThrew) && /可选/.test(String(unknownThrew && unknownThrew.message)) && /wide/.test(String(unknownThrew && unknownThrew.message)),
    '不认识的编号抛错并列出可选三款，避免脚本猜一个「差不多」的尺寸',
    unknownThrew && unknownThrew.message,
  )

  console.log('第四组：browser.mts 的实现约定')
  const browser = await import(pathToFileURL(path.join(ROOT, 'scripts', 'real-machine', 'lib', 'browser.mts')).href)
  check(typeof browser.applyViewportPreset === 'function', 'browser.mts 导出 applyViewportPreset，批次脚本只 import 一个文件就能设窗口')
  check(Array.isArray(browser.VIEWPORT_PRESETS) && browser.VIEWPORT_PRESETS.length === 3 && typeof browser.presetById === 'function', 'browser.mts 再导出三款预设与 presetById，调用方不用记第二个 import 路径')
  const source = readText('scripts/real-machine/lib/browser.mts')
  check(source.includes('Browser.setWindowBounds') && source.includes("windowState: 'fullscreen'"), '设窗口走 CDP Browser.setWindowBounds，不依赖浏览器启动参数')
  check(source.includes("bounds: { windowState: 'normal' }") && source.includes('width: requested.width'), '从全屏退普通窗口分两步：先只切状态、再设宽高（实测直接带宽高会被忽略）')
  check(source.includes("document.querySelector('.dsws-narrow') !== null"), '设置完核对 .dsws-narrow 是否在场，不只看窗口尺寸就宣布「测了窄态」')
  check(source.includes("document.querySelector('.dsws-body')") && source.includes('panelWidth'), '同时量 .dsws-body 的面板宽写进快照，证据里能看出面板宽度')
  check(source.includes('没压到预期分支') && source.includes('先核对 docs/agents/real-machine-verification.md'), '分支对不上时用中文错误说清期望与实际，并指回去核对映射文档，不静默继续')
  check(source.includes('viewport: opened.viewport ?? null'), 'writePageDiagnostics 把 viewport 快照写进 page-diagnostics.json')
  check(!/setViewportSize\s*\(/.test(source), 'browser.mts 不调用 setViewportSize 假装窗口尺寸（固定视口骗过截图的老错法；注释里提这个名字不算）')

  console.log('第五组：文档写清了用法与理由')
  const readme = readText('scripts/real-machine/README.md')
  check(readme.includes('三款窗口尺寸') && readme.includes('applyViewportPreset') && readme.includes('VIEWPORT_PRESETS'), '工具台 README 有「三款窗口尺寸」一节，写明数据位置与 applyViewportPreset 用法')
  check(readme.includes('800') && readme.includes('720') && readme.includes('整宽覆盖'), 'README 写明窄窗用 800 而不是 720 的理由（宿主把右侧面板切成整宽覆盖）')
  check(readme.includes('setViewportSize') && readme.includes('viewport'), 'README 把「不要用 setViewportSize」与 viewport 证据字段写成硬规矩')
  const rules = readText('docs/agents/real-machine-verification.md')
  check(rules.includes('三款窗口尺寸') && rules.includes('applyViewportPreset') && rules.includes('.dsws-narrow'), '真机验证规则文档登记了三款尺寸、applyViewportPreset 与窄态判据')

  console.log('')
  console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
  printGateResult('verify-real-machine-size-presets', passed + failed, failed)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error('门禁自己崩了：' + (error && error.stack ? error.stack : error))
  printGateResult('verify-real-machine-size-presets', passed + failed, failed + 1)
  process.exitCode = 1
})
