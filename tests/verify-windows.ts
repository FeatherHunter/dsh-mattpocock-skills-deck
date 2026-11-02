// verify-windows —— 三款窗口预设的换算与「真全屏」判据的门禁（票 13 阶段 B1b）。
//
// 覆盖来源：tests/verify-real-machine-fullscreen.ts（21 条）与
// tests/verify-real-machine-size-presets.ts（32 条）。旧文件在阶段 B2 删除，本门禁把其中
// 仍然有证伪力的部分平移到新的 verify/presets.mjs 与 verify/windows.mjs：
//   - 真全屏判据：普通窗 / 真全屏 / 2px 容差 / 窗口视口小于外框 / NaN / 缺字段 / null；
//   - 三款预设的数据与换算：wide / narrow / short、2195×1235 与 1600×900 两组屏幕；
//   - 非法输入：未知预设 id、屏幕宽高为 0 / NaN / null / undefined、预设换算结果为 0；
//   - 源码约定：改窗口必须走 CDP Browser.setWindowBounds，真全屏用 windowState:"fullscreen"，
//     不许用固定视口冒充全屏；执行函数真的把这几步发出去（用假 CDP 记录调用顺序）。
//
// 这里不跑有头浏览器：headless 下没有真实窗口，开窗量尺寸没有意义，只会变成假绿。
// 有头部分（真的开 800×1235 的窄窗、量 .dsws-body 面板宽度与 .dsws-narrow 分支）留给
// 人在真机上按 verify/windows.mjs 的 applyWindowPreset 跑，或由阶段 B1a 的场景门禁覆盖。
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-windows.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const GATE = 'verify-windows'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

let assertions = 0
let failed = 0

function check(ok: boolean, message: string, detail?: string): void {
  assertions++
  if (ok) {
    console.log('PASS ' + message)
    return
  }
  failed++
  console.log('FAIL ' + message + (detail ? '：' + detail : ''))
}

function errorMessage(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return String((error as Error).message ?? error)
  }
}

function show(value: unknown): string {
  return JSON.stringify(value)
}

type Measurement = {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  screenWidth: number
  screenHeight: number
}

function measurement(overrides: Partial<Measurement>): Measurement {
  return {
    innerWidth: 2195,
    innerHeight: 1235,
    outerWidth: 2195,
    outerHeight: 1235,
    screenWidth: 2195,
    screenHeight: 1235,
    ...overrides,
  }
}

// 假窗口：CDP 调用记进 calls，measure 从 state 读外框。这样不用开浏览器也能证明
// 执行函数确实发了 Browser.setWindowBounds，并且先退全屏再给宽高。
function makeFakeWindow(screen: { width: number; height: number }, startFullscreen: boolean) {
  const calls: Array<{ method: string; params: any }> = []
  const state = {
    fullscreen: startFullscreen,
    frameWidth: startFullscreen ? screen.width : 1600,
    frameHeight: startFullscreen ? screen.height : 900,
  }
  const applyBounds = (bounds: any): void => {
    if (bounds === null || typeof bounds !== 'object') return
    if (bounds.windowState === 'fullscreen') {
      state.fullscreen = true
      state.frameWidth = screen.width
      state.frameHeight = screen.height
      return
    }
    if (bounds.windowState === 'normal') {
      state.fullscreen = false
      // 只给 windowState 时保留当前外框；带了宽高才改，和 Chromium 的两步行为一致。
      if (typeof bounds.width === 'number') state.frameWidth = bounds.width
      if (typeof bounds.height === 'number') state.frameHeight = bounds.height
    }
  }
  const cdp = {
    send: async (method: string, params: any) => {
      calls.push({ method, params })
      if (method === 'Browser.getWindowForTarget') return { windowId: 42 }
      if (method === 'Browser.setWindowBounds') applyBounds(params && params.bounds)
      return {}
    },
  }
  const measure = async (): Promise<Measurement> => ({
    innerWidth: state.frameWidth,
    innerHeight: state.frameHeight,
    outerWidth: state.frameWidth,
    outerHeight: state.frameHeight,
    screenWidth: screen.width,
    screenHeight: screen.height,
  })
  return { calls, state, cdp, measure }
}

async function main(): Promise<void> {
  const presets: any = await import(new URL('../verify/presets.mjs', import.meta.url).href)
  const windows: any = await import(new URL('../verify/windows.mjs', import.meta.url).href)
  const windowsSource = readFileSync(path.join(ROOT, 'verify', 'windows.mjs'), 'utf8')
  const presetsSource = readFileSync(path.join(ROOT, 'verify', 'presets.mjs'), 'utf8')

  // ---- A. 三款预设的数据 ----
  const list = presets.VIEWPORT_PRESETS
  check(Array.isArray(list) && list.length === 3, 'A1 三款窗口预设都在', show(list && list.map((item: any) => item.id)))
  check(
    Array.isArray(list) && list.map((item: any) => item.id).join(',') === 'wide,narrow,short',
    'A2 预设 id 与顺序是 wide / narrow / short',
    Array.isArray(list) ? list.map((item: any) => item.id).join(',') : 'not an array',
  )
  const wide = Array.isArray(list) ? list.find((item: any) => item.id === 'wide') : undefined
  const narrow = Array.isArray(list) ? list.find((item: any) => item.id === 'narrow') : undefined
  const short = Array.isArray(list) ? list.find((item: any) => item.id === 'short') : undefined
  check(wide !== undefined && wide.window === null, 'A3 全屏宽是 window:null（真全屏，不是固定视口）', show(wide))
  check(wide !== undefined && wide.expectDockNarrow === false, 'A4 全屏宽不期待窄档', show(wide))
  check(narrow !== undefined && narrow.window.width === 800, 'A5 窄窗外框宽固定 800', show(narrow && narrow.window))
  check(narrow !== undefined && narrow.window.height === 'screen', 'A6 窄窗外框高取屏幕高度', show(narrow && narrow.window))
  check(narrow !== undefined && narrow.expectDockNarrow === true, 'A7 窄窗期待面板落进窄档', show(narrow))
  check(short !== undefined && short.window.width === 'screen', 'A8 宽矮窗外框宽取屏幕宽度', show(short && short.window))
  check(short !== undefined && short.window.height === 600, 'A9 宽矮窗外框高固定 600', show(short && short.window))
  check(short !== undefined && short.expectDockNarrow === false, 'A10 宽矮窗不期待窄档', show(short))
  check(
    Array.isArray(list) && list.every((item: any) => typeof item.label === 'string' && item.label.trim() !== ''),
    'A11 每款预设都有非空标签',
    show(list && list.map((item: any) => item.label)),
  )
  check(
    Array.isArray(list) && new Set(list.map((item: any) => item.label)).size === list.length,
    'A12 三款预设的标签互不相同',
    show(list && list.map((item: any) => item.label)),
  )
  check(presets.presetById('narrow') === narrow, 'A13 presetById 按 id 取回同一款预设（不是复制品）')
  check(
    errorMessage(() => presets.presetById('tall')).includes('可选') &&
      errorMessage(() => presets.presetById('tall')).includes('wide'),
    'A14 未知预设 id 抛错并列出可选项',
    errorMessage(() => presets.presetById('tall')),
  )

  // ---- B. 2195×1235 的换算口径（2026-10-29 真机事故那台机器） ----
  const screen2195 = { width: 2195, height: 1235 }
  const wideResolved = presets.resolveViewportPreset('wide', screen2195)
  check(wideResolved.windowState === 'fullscreen', 'B1 全屏宽换算成 windowState=fullscreen', show(wideResolved))
  check(wideResolved.width === undefined && wideResolved.height === undefined, 'B2 全屏宽不带外框宽高（由 CDP 全屏决定）', show(wideResolved))
  const narrowResolved = presets.resolveViewportPreset('narrow', screen2195)
  check(
    narrowResolved.windowState === 'normal' && narrowResolved.width === 800 && narrowResolved.height === 1235,
    'B3 窄窗在 2195×1235 上换算成 800×1235',
    show(narrowResolved),
  )
  const shortResolved = presets.resolveViewportPreset('short', screen2195)
  check(
    shortResolved.windowState === 'normal' && shortResolved.width === 2195 && shortResolved.height === 600,
    'B4 宽矮窗在 2195×1235 上换算成 2195×600',
    show(shortResolved),
  )
  const narrowOn1600 = presets.resolveViewportPreset('narrow', { width: 1600, height: 900 })
  check(narrowOn1600.width === 800 && narrowOn1600.height === 900, 'B5 窄窗在 1600×900 上换算成 800×900', show(narrowOn1600))
  check(
    typeof presets.resolvePresetWindow === 'function' &&
      presets.resolvePresetWindow(narrow, screen2195).width === 800,
    'B6 保留 resolvePresetWindow(preset, screen) 的旧入口',
  )

  // ---- C. 非法屏幕尺寸 / 非法预设 ----
  for (const [name, screen] of [
    ['宽为 0', { width: 0, height: 1235 }],
    ['高为 NaN', { width: 2195, height: Number.NaN }],
    ['null', null],
    ['undefined', undefined],
  ] as Array<[string, unknown]>) {
    const message = errorMessage(() => presets.resolveViewportPreset('narrow', screen))
    check(message.includes('屏幕尺寸'), 'C 屏幕尺寸' + name + '时抛错并点明屏幕尺寸', message)
  }
  check(
    errorMessage(() => presets.resolvePresetWindow({ id: 'bad', window: { width: 0, height: 600 } }, screen2195)).includes(
      '窗口尺寸',
    ),
    'C5 预设换算出 0 宽时抛错并点明窗口尺寸',
    errorMessage(() => presets.resolvePresetWindow({ id: 'bad', window: { width: 0, height: 600 } }, screen2195)),
  )

  // ---- D. 真全屏判据（2026-10-29 事故：1083 vs 2195） ----
  const fullscreen = windows.judgeFullscreen(measurement({}))
  check(fullscreen.ok === true, 'D1 视口与外框都等于屏幕尺寸时判真全屏', show(fullscreen))
  check(String(fullscreen.reason).includes('真全屏'), 'D2 真全屏的说明里点明结论', String(fullscreen.reason))
  const incident = windows.judgeFullscreen(measurement({ outerWidth: 1083, outerHeight: 1168 }))
  check(incident.ok === false, 'D3 外框 1083×1168 而屏幕 2195×1235 时判红（2026-10-29 事故）', show(incident))
  check(
    String(incident.reason).includes('1083') && String(incident.reason).includes('2195'),
    'D4 事故判红的说明带实际外框与屏幕数值',
    String(incident.reason),
  )
  const windowed = windows.judgeFullscreen(measurement({ outerWidth: 1600, outerHeight: 1000, innerWidth: 1600, innerHeight: 940 }))
  check(windowed.ok === false, 'D5 普通窗（外框小于屏幕）判红', show(windowed))
  const near = windows.judgeFullscreen(measurement({ outerWidth: 2196, outerHeight: 1236, innerWidth: 2196, innerHeight: 1236 }))
  check(near.ok === true, 'D6 外框与屏幕差 1px 时仍在 2px 容差内', show(near))
  const far = windows.judgeFullscreen(measurement({ outerWidth: 2200, outerHeight: 1240, innerWidth: 2200, innerHeight: 1240 }))
  check(far.ok === false, 'D7 外框与屏幕差 5px 时超出默认 2px 容差', show(far))
  const farLoose = windows.judgeFullscreen(
    measurement({ outerWidth: 2200, outerHeight: 1240, innerWidth: 2200, innerHeight: 1240 }),
    10,
  )
  check(farLoose.ok === true, 'D8 容差放到 10px 时同样 5px 的偏差判通过（容差真的生效）', show(farLoose))
  const chrome = windows.judgeFullscreen(measurement({ innerWidth: 1600, innerHeight: 900 }))
  check(chrome.ok === false, 'D9 外框贴屏幕但视口更小（有浏览器边框）判红', show(chrome))
  check(
    String(chrome.reason).includes('视口'),
    'D10 视口与外框不一致时说明点明视口',
    String(chrome.reason),
  )
  check(
    windows.judgeFullscreen(measurement({ screenHeight: undefined as unknown as number })).ok === false,
    'D11 缺 screenHeight 时拒绝判断',
    show(windows.judgeFullscreen(measurement({ screenHeight: undefined as unknown as number }))),
  )
  check(
    windows.judgeFullscreen(measurement({ innerWidth: Number.NaN })).ok === false,
    'D12 innerWidth 为 NaN 时拒绝判断',
    show(windows.judgeFullscreen(measurement({ innerWidth: Number.NaN }))),
  )
  check(
    windows.judgeFullscreen(measurement({ outerWidth: 0 })).ok === false,
    'D13 外框宽为 0（畸形输入）时拒绝判断',
    show(windows.judgeFullscreen(measurement({ outerWidth: 0 }))),
  )
  const nothing = windows.judgeFullscreen(null)
  check(nothing.ok === false, 'D14 没有测量值时判红', show(nothing))
  check(String(nothing.reason).includes('无法判断'), 'D15 没有测量值时说明为什么不能判断', String(nothing.reason))

  // ---- E. CDP 执行函数：真的发 Browser.setWindowBounds ----
  check(
    ['judgeFullscreen', 'measureWindow', 'enterFullscreen', 'applyWindowPreset', 'setWindowBounds', 'windowIdOf'].every(
      (name) => typeof windows[name] === 'function',
    ),
    'E1 verify/windows.mjs 导出判据、测量与执行函数',
    show(['judgeFullscreen', 'measureWindow', 'enterFullscreen', 'applyWindowPreset', 'setWindowBounds', 'windowIdOf'].map((name) => typeof windows[name])),
  )
  const direct = makeFakeWindow(screen2195, false)
  await windows.setWindowBounds(direct.cdp, 7, { windowState: 'fullscreen' })
  check(
    direct.calls.length === 1 &&
      direct.calls[0].method === 'Browser.setWindowBounds' &&
      direct.calls[0].params.windowId === 7 &&
      direct.calls[0].params.bounds.windowState === 'fullscreen',
    'E2 setWindowBounds 发出 Browser.setWindowBounds 且带 windowId 与 fullscreen 边界',
    show(direct.calls),
  )
  const idSource = makeFakeWindow(screen2195, false)
  const returnedId = await windows.windowIdOf(idSource.cdp)
  check(
    returnedId === 42 && idSource.calls[0].method === 'Browser.getWindowForTarget',
    'E3 windowIdOf 先取 Browser.getWindowForTarget 的 windowId',
    show({ returnedId, calls: idSource.calls }),
  )

  const entering = makeFakeWindow(screen2195, false)
  const entered = await windows.enterFullscreen(null, {
    cdp: entering.cdp,
    measure: entering.measure,
    timeoutMs: 500,
    pollMs: 5,
  })
  check(
    entering.calls.length === 2 &&
      entering.calls[0].method === 'Browser.getWindowForTarget' &&
      entering.calls[1].method === 'Browser.setWindowBounds' &&
      entering.calls[1].params.bounds.windowState === 'fullscreen',
    'E4 enterFullscreen 先取窗口再发 fullscreen 边界',
    show(entering.calls),
  )
  check(entered.measurement.outerWidth === 2195 && entered.judge.ok === true, 'E5 enterFullscreen 等到判据通过才返回', show(entered))

  const stuck = makeFakeWindow(screen2195, false)
  // 这个假 CDP 收到 fullscreen 边界但什么都不做，模拟浏览器拒绝/忽略这次改窗。
  const stuckCalls: string[] = []
  const stuckCdp = {
    send: async (method: string) => {
      stuckCalls.push(method)
      return method === 'Browser.getWindowForTarget' ? { windowId: 42 } : {}
    },
  }
  const stuckMessage = await errorMessageAsync(() =>
    windows.enterFullscreen(null, { cdp: stuckCdp, measure: stuck.measure, timeoutMs: 20, pollMs: 5 }),
  )
  check(
    stuckMessage.includes('没有进入真全屏') && stuckMessage.includes('这条结论不能当作全屏证据'),
    'E6 窗口一直没进全屏时超时抛错，并说明这条结论不能当证据',
    stuckMessage,
  )

  const narrowFake = makeFakeWindow(screen2195, true)
  const appliedNarrow = await windows.applyWindowPreset(null, 'narrow', {
    cdp: narrowFake.cdp,
    measure: narrowFake.measure,
    timeoutMs: 500,
    pollMs: 5,
    restoreDelayMs: 0,
  })
  const boundsCalls = narrowFake.calls.filter((call: any) => call.method === 'Browser.setWindowBounds')
  check(
    boundsCalls.length === 2 &&
      boundsCalls[0].params.bounds.windowState === 'normal' &&
      boundsCalls[0].params.bounds.width === undefined &&
      boundsCalls[1].params.bounds.width === 800 &&
      boundsCalls[1].params.bounds.height === 1235,
    'E7 从全屏回窄窗分两步：先单独退全屏，再给 800×1235',
    show(boundsCalls),
  )
  check(
    appliedNarrow.bounds.width === 800 &&
      appliedNarrow.bounds.height === 1235 &&
      appliedNarrow.measurement.outerWidth === 800,
    'E8 窄窗执行完返回的边界与实测外框一致',
    show(appliedNarrow),
  )
  check(narrowFake.state.fullscreen === false, 'E9 窄窗执行后窗口确实离开了全屏状态', show(narrowFake.state))

  const wideFake = makeFakeWindow(screen2195, false)
  const appliedWide = await windows.applyWindowPreset(null, 'wide', {
    cdp: wideFake.cdp,
    measure: wideFake.measure,
    timeoutMs: 500,
    pollMs: 5,
  })
  const wideBoundsCalls = wideFake.calls.filter((call: any) => call.method === 'Browser.setWindowBounds')
  check(
    wideBoundsCalls.length === 1 && wideBoundsCalls[0].params.bounds.windowState === 'fullscreen',
    'E10 全屏预设只发一条 fullscreen 边界，不把视口设成屏幕大小',
    show(wideBoundsCalls),
  )
  check(
    appliedWide.presetId === 'wide' &&
      appliedWide.bounds.windowState === 'fullscreen' &&
      appliedWide.measurement.outerWidth === 2195 &&
      appliedWide.measurement.outerHeight === 1235,
    'E11 全屏预设返回 presetId=wide，且实测外框已是屏幕尺寸',
    show(appliedWide),
  )
  const unknownPresetMessage = await errorMessageAsync(() => windows.applyWindowPreset(null, 'tall', {}))
  check(
    unknownPresetMessage.includes('可选') && unknownPresetMessage.includes('wide'),
    'E12 applyWindowPreset 遇到未知预设 id 时抛错并列出可选项',
    unknownPresetMessage,
  )

  const wrongSize = makeFakeWindow(screen2195, false)
  const wrongMessage = await errorMessageAsync(() =>
    windows.applyWindowPreset(null, 'narrow', {
      cdp: {
        send: async (method: string) => {
          wrongSize.calls.push({ method, params: {} })
          return method === 'Browser.getWindowForTarget' ? { windowId: 42 } : {}
        },
      },
      measure: wrongSize.measure,
      timeoutMs: 20,
      pollMs: 5,
      restoreDelayMs: 0,
    }),
  )
  check(
    wrongMessage.includes('窗口没有变成预设 narrow') && wrongMessage.includes('这条结论不能当作该预设下的界面证据'),
    'E13 外框压不到预设尺寸时超时抛错，并说明不能当该预设证据',
    wrongMessage,
  )

  // ---- F. 源码约定：CDP 是真全屏的唯一路径 ----
  check(windowsSource.includes('Browser.setWindowBounds'), 'F1 verify/windows.mjs 出现 Browser.setWindowBounds', '')
  check(windowsSource.includes('windowState: "fullscreen"'), 'F2 verify/windows.mjs 用 windowState:"fullscreen" 进真全屏', '')
  check(!windowsSource.includes('setViewportSize('), 'F3 verify/windows.mjs 没有用固定视口冒充全屏', '')
  check(!windowsSource.includes("from 'playwright'") && !windowsSource.includes('from "playwright"') && !windowsSource.includes('dsh-featherhunter-plugin-base'), 'F4 verify/windows.mjs 不 import playwright 或 base', '')
  check(windowsSource.includes('R4') && windowsSource.includes('窗口尺寸'), 'F5 文件头写清为什么这一层留在插件仓（风险 R4）', '')
  check(presetsSource.includes('Math.round') && presetsSource.includes('screen'), 'F6 presets.mjs 保留屏幕尺寸换算的口径（screen 取整）', '')
  check(!presetsSource.includes("from 'playwright'") && !presetsSource.includes('from "playwright"') && !presetsSource.includes('dsh-featherhunter-plugin-base'), 'F7 verify/presets.mjs 零依赖（不 import 浏览器或 base）', '')

  const record = printGateResult(GATE, assertions, failed)
  console.log('GATE-SUMMARY ' + JSON.stringify(record))
  process.exitCode = failed > 0 ? 1 : 0
}

async function errorMessageAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return ''
  } catch (error) {
    return String((error as Error).message ?? error)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  printGateResult(GATE, assertions, failed + 1)
  process.exitCode = 1
})
