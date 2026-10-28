/**
 * tests/verify-1612-deck-state.ts —— 两个按工作区开关（状态栏胶囊 / deck 工具箱）的读写口径。
 *
 * 票面（#1612）拍板的语义：
 *   · deckTools：'on' 开（缺省）、'off' 关 —— 关的是整个 deck（工具、胶囊、右侧面板三处一起关）；
 *   · statusBar：'show' 显示胶囊、'hide' 折叠（缺省）；
 *   · 胶囊实际折没折 = deck 关了**或者** statusBar 是 hide；
 *   · 旧字段 bannerFolded 与旧 localStorage 键已退役（维护者 2026-10-29 拍板删掉迁移）：读口不看它们。
 *
 * 本文件钉的是 src/client/kernel/deck-state.ts 这一片：读口把各种残缺输入按上述缺省口径解释，
 * 写口把两个值写回设置文件那一条路、并把同一个工作区的各会话 emit 一次。
 * 真源不 import 整棵客户端闭包（它靠 declare 拿闭包里的同名实现），所以这里先往 globalThis 挂替身，
 * 再动态 import 这一片 —— ESM 裸标识符会回落到全局，替身就是真实现的观察窗。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1612-deck-state.ts
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireHere = createRequire(import.meta.url)
let failed = false
let total = 0
const check = (ok: unknown, msg: string) => {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg) }
}

// —— 替身：reads / writes / emits 三本账，被测片只通过全局名字碰它们 ——
type FlagCall = { cwd: string; name: string }
const reads: FlagCall[] = []
const writes: Array<FlagCall & { value: unknown }> = []
const emitted: any[] = []
// 读口替身：按 (cwd, name) 查表，表里没有就回 undefined（缺格）。
let flagTable: Record<string, unknown> = {}
let writeResult: unknown = true
let readThrows = false
let writeThrows = false
;(globalThis as any).viewFlagOf = (cwd: any, name: any) => {
  reads.push({ cwd: String(cwd), name: String(name) })
  if (readThrows) throw new Error('读设置失败（夹具）')
  const v = flagTable[String(cwd) + '|' + String(name)]
  return v
}
;(globalThis as any).setViewFlagValue = (cwd: any, name: any, value: any) => {
  writes.push({ cwd: String(cwd), name: String(name), value })
  if (writeThrows) throw new Error('写设置失败（夹具）')
  return writeResult
}
// 工作区键：夹具里把两个路径当成同一个工作区（一个带结尾斜杠），第三个是别的工作区。
;(globalThis as any).keyOf = (cwd: any) => String(cwd || '').replace(/[\\/]+$/, '').toLowerCase()
;(globalThis as any).emit = (st: any) => { emitted.push(st) }
;(globalThis as any).shared = { cwd: 'D:/ws-a' }
;(globalThis as any).stores = { s1: { cwd: 'D:/ws-a/' }, s2: { cwd: 'D:/ws-b' } }

const root = path.resolve(import.meta.dirname, '..')
const mod = await import(pathToFileURL(path.join(root, 'src/client/kernel/deck-state.ts')).href)
const { deckToolsOf, deckStatusBarOf, isDeckClosed, isDeckCapsuleFolded, setDeckTools, setDeckStatusBar } = mod

const reset = () => { reads.length = 0; writes.length = 0; emitted.length = 0; flagTable = {} }

console.log('== ① deck 工具箱开关：只认文件里的 off，其余一律按开 ==')
{
  reset(); flagTable['D:/ws-a|deckTools'] = 'off'
  check(deckToolsOf('D:/ws-a') === 'off' && isDeckClosed('D:/ws-a') === true, '① 写成 off → 工具箱关、isDeckClosed 为真')
  reset(); flagTable['D:/ws-a|deckTools'] = 'on'
  check(deckToolsOf('D:/ws-a') === 'on' && isDeckClosed('D:/ws-a') === false, '① 写成 on → 工具箱开')
  reset()
  check(deckToolsOf('D:/ws-a') === 'on' && isDeckClosed('D:/ws-a') === false, '① 文件里没有这一格 → 缺省开（不是关）')
  reset(); flagTable['D:/ws-a|deckTools'] = false
  check(deckToolsOf('D:/ws-a') === 'on', '① 旧布尔 false 不算关（本格只认字面量 off）')
  reset(); readThrows = true
  check(deckToolsOf('D:/ws-a') === 'on' && isDeckClosed('D:/ws-a') === false, '① 读设置抛错时按开算，不把用户的工具悄悄关掉')
  readThrows = false
}

console.log('\n== ② 胶囊状态栏开关：只认 show/hide，旧 bannerFolded 已退役不参与 ==')
{
  reset(); flagTable['D:/ws-a|statusBar'] = 'show'
  check(deckStatusBarOf('D:/ws-a') === 'show', '② 写成 show → 显示胶囊')
  reset(); flagTable['D:/ws-a|statusBar'] = 'hide'
  check(deckStatusBarOf('D:/ws-a') === 'hide', '② 写成 hide → 折叠胶囊')
  reset()
  check(deckStatusBarOf('D:/ws-a') === 'hide', '② 文件里没有这一格也没旧字段 → 缺省折叠')
  reset(); flagTable['D:/ws-a|bannerFolded'] = false
  check(deckStatusBarOf('D:/ws-a') === 'hide', '② 旧字段 bannerFolded=false 已退役：不迁移、仍按缺省折叠')
  reset(); flagTable['D:/ws-a|bannerFolded'] = true
  check(deckStatusBarOf('D:/ws-a') === 'hide', '② 旧字段 bannerFolded=true 同样被忽略，按缺省折叠')
  reset(); flagTable['D:/ws-a|statusBar'] = 'show'; flagTable['D:/ws-a|bannerFolded'] = true
  check(deckStatusBarOf('D:/ws-a') === 'show', '② 只有 statusBar 说了算')
  reset(); readThrows = true
  check(deckStatusBarOf('D:/ws-a') === 'hide', '② 读设置抛错时按折叠算（缺省）')
  readThrows = false
}

console.log('\n== ③ 胶囊此刻折没折：deck 关 或 胶囊开关为 hide，两条任一成立 ==')
{
  reset(); flagTable['D:/ws-a|deckTools'] = 'off'; flagTable['D:/ws-a|statusBar'] = 'show'
  check(isDeckCapsuleFolded('D:/ws-a') === true, '③ deck 关了：哪怕胶囊开关是 show，也没有地方显示胶囊 → 折叠')
  reset(); flagTable['D:/ws-a|statusBar'] = 'hide'
  check(isDeckCapsuleFolded('D:/ws-a') === true, '③ 只关胶囊（deck 开着）→ 折叠')
  reset(); flagTable['D:/ws-a|deckTools'] = 'on'; flagTable['D:/ws-a|statusBar'] = 'show'
  check(isDeckCapsuleFolded('D:/ws-a') === false, '③ deck 开、胶囊开关为 show → 不折叠')
}

console.log('\n== ④ 写口：按字面量写回，并把同一个工作区的各会话 emit 一次 ==')
{
  reset()
  const ok = setDeckTools('D:/ws-a', false)
  check(ok === true && writes.length === 1 && writes[0].name === 'deckTools' && writes[0].value === 'off', '④ setDeckTools(false) → 写 deckTools=off，返回文件那条路的结果')
  check(emitted.length === 2 && emitted.indexOf((globalThis as any).shared) >= 0 && emitted.indexOf((globalThis as any).stores.s1) >= 0 && emitted.indexOf((globalThis as any).stores.s2) < 0, '④ 同一个工作区的 shared 与 s1 各 emit 一次、别的工作区 s2 不碰')

  reset()
  const ok2 = setDeckStatusBar('D:/ws-a', true)
  check(ok2 === true && writes.length === 1 && writes[0].name === 'statusBar' && writes[0].value === 'show', '④ setDeckStatusBar(true) → 写 statusBar=show')

  reset(); writeResult = false
  check(setDeckTools('D:/ws-a', true) === false && writes[0].value === 'on', '④ 文件那条路说没写进去时如实返回 false（不假装落盘）')
  writeResult = true

  reset(); writeThrows = true
  check(setDeckStatusBar('D:/ws-a', false) === false, '④ 写设置抛错时不向外抛，只返回 false')
  writeThrows = false

  reset(); writes.length = 0
  ;(globalThis as any).setViewFlagValue = undefined
  check(setDeckTools('D:/ws-a', false) === false && writes.length === 0, '④ 老产物里没有写这一趟（setViewFlagValue 不存在）→ 返回 false、不抛')
  ;(globalThis as any).setViewFlagValue = (cwd: any, name: any, value: any) => { writes.push({ cwd: String(cwd), name: String(name), value }); return true }
}

console.log('\n== ⑤ 接线：这一片已登记进构建清单与客户端入口的拼接标记 ==')
{
  const { sourceText } = requireHere('./lib/source-text.ts')
  const idx = sourceText('src/client/index.ts')
  const build = sourceText('scripts/build.mts')
  check(idx.indexOf('kernel:deckState') >= 0 && idx.indexOf('kernel:deckPromptFilter') >= 0, '⑤ 客户端入口有两条新内核片的拼接标记')
  check(build.indexOf("src/client/kernel/deck-state.ts") >= 0 && build.indexOf("src/client/kernel/deck-prompt-filter.ts") >= 0, '⑤ 构建清单登记了两份新内核片')
}

if (failed) {
  console.log('\n存在失败 — verify-1612-deck-state 未通过（失败项见上）')
  process.exit(1)
}
console.log('\n' + total + ' 条断言全部通过 — 两个按工作区开关的读口与写口符合 #1612 拍板的语义')
