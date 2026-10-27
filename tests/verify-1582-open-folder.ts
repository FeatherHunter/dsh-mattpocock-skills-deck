/**
 * tests/verify-1582-open-folder.ts —— 「打开文件夹」共用函数的单元门禁（#1582）。
 *
 * 为什么要有它：这张票把四处「直接调宿主打开文件夹」的入口收敛成一个共用函数，要求它们
 * ① 目录为空时不再发宿主调用；② 只发一次；③ 读回包（宿主失败不是抛错，而是回 {ok:false}）；
 * ④ 把失败原因交回调用方提示。这份门禁直接跑那份真实函数，逐条量它的分支；再用源码扫描钉住
 * 四处调用点不再直接调 wf.openFolder（避免以后有人手滑又加回一处）。
 *
 * 为什么直接 import 叶子源码：这份叶子是纯函数（宿主调用对象从参数进，不碰闭包里的任何名字），
 * 所以可以像普通模块一样单测；需要闭包环境的视图叶子才必须走 compileFn 注入替身。
 *
 * 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1582-open-folder.ts。
 * 退出码 0 = 全部通过；1 = 有断言不成立（会卡住 verify 链）。
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
// 读拼接源走仓里唯一入口（#1207）：直接 readFileSync 会绕过转译口径，门禁看到的形态会和构建分家。
const { sourceText } = require('./lib/source-text.ts')

/** 共用函数今天住在哪里（叶子只能在这里实现，别处不许再写第二份）。 */
const HELPER_REL = 'src/client/views/shared/openFolder.ts'
/** 四处入口：票面点名的四个调用点，一个都不能再自己直接调宿主。 */
const SITES_REL = [
  'src/client/panel/Dock.ts',
  'src/client/views/SubworkspaceMark.ts',
  'src/client/statusbar/StatusLogMenu.ts',
  'src/client/views/diagnosticLog/diagnosticLogActions.ts',
]

let failed = false
let total = 0
function check(ok: unknown, msg: string): void {
  total += 1
  console.log(((ok ? '  PASS ' : '  FAIL ') + msg) as string)
  if (!ok) failed = true
}

/** 异步分支落定要等几拍（共用函数内部把回包翻成回调，最长要等两拍）。 */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise<void>((r) => setTimeout(r, 0))
}

interface ReportCall { outcome: string; detail: unknown }

/** 一份可编程的宿主替身：记录每次调用，回包由 case 自己定。 */
function fakeHost() {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  const box = {
    reply: (): Promise<unknown> => Promise.resolve({ ok: true }),
    throwSync: false,
  }
  const host = {
    call(method: string, args: Record<string, unknown>): Promise<unknown> {
      calls.push({ method, args })
      if (box.throwSync) throw new Error('call-down')
      return box.reply()
    },
  }
  return { host, box, calls }
}

async function main(): Promise<void> {
  const mod = await import(pathToFileURL(path.join(ROOT, HELPER_REL)).href) as { openFolderAt?: unknown }
  const openFolderAt = mod.openFolderAt as (
    host: unknown,
    dir: unknown,
    report: (outcome: string, detail?: unknown) => void
  ) => boolean
  check(typeof openFolderAt === 'function', '共用函数 openFolderAt 存在且是函数')

  // ---- 分支 1：目录为空/空白/缺失 —— 报 missing，不发宿主调用，返回 false ----
  for (const empty of ['', '   ', null, undefined] as unknown[]) {
    const world = fakeHost()
    const reports: ReportCall[] = []
    const sent = openFolderAt(world.host, empty, (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === false, '目录为空（' + JSON.stringify(empty) + '）：返回未发出调用')
    check(world.calls.length === 0, '目录为空（' + JSON.stringify(empty) + '）：宿主一次都没打')
    check(reports.length === 1 && reports[0].outcome === 'missing', '目录为空（' + JSON.stringify(empty) + '）：报 missing')
  }

  // ---- 分支 2：宿主不可用 —— 报 open-failed(host-unavailable)，不炸 ----
  {
    const reports: ReportCall[] = []
    const sent = openFolderAt(null, 'D:/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === false && reports.length === 1 && reports[0].outcome === 'open-failed' && reports[0].detail === 'host-unavailable',
      '没有宿主：报 open-failed(host-unavailable)，返回未发出')
  }
  {
    const reports: ReportCall[] = []
    const sent = openFolderAt({}, 'D:/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === false && reports.length === 1 && reports[0].outcome === 'open-failed',
      '宿主没有 call 方法：同样报 open-failed，不当成已发出')
  }

  // ---- 分支 3：正常回包 —— 只发一次，报 opened ----
  {
    const world = fakeHost()
    const reports: ReportCall[] = []
    const sent = openFolderAt(world.host, 'D:/work/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === true, '目录可用：返回已发出调用')
    check(world.calls.length === 1, '目录可用：宿主只打一次（不重复发）')
    check(world.calls[0] && world.calls[0].method === 'wf.openFolder' && (world.calls[0].args as Record<string, unknown>)['cwd'] === 'D:/work/x',
      '目录可用：调用名与参数形状保持 wf.openFolder({cwd})')
    check(reports.length === 1 && reports[0].outcome === 'opened', '目录可用：报 opened（诊断日志页靠它弹成功提示）')
  }

  // ---- 分支 4：宿主回 {ok:false} —— 报 open-failed 并带上宿主给的原因 ----
  {
    const world = fakeHost()
    world.box.reply = () => Promise.resolve({ ok: false, error: '目录被占用' })
    const reports: ReportCall[] = []
    openFolderAt(world.host, 'D:/work/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(reports.length === 1 && reports[0].outcome === 'open-failed' && reports[0].detail === '目录被占用',
      '宿主回 ok:false：报 open-failed，原因原样带回给调用方')
  }
  {
    const world = fakeHost()
    world.box.reply = () => Promise.resolve({ ok: false })
    const reports: ReportCall[] = []
    openFolderAt(world.host, 'D:/work/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(reports.length === 1 && reports[0].outcome === 'open-failed' && reports[0].detail === '打开失败',
      '宿主回 ok:false 且没给原因：仍报 open-failed，兜底一句「打开失败」')
  }

  // ---- 分支 5：异步拒绝与同步抛错 —— 同走 open-failed ----
  {
    const world = fakeHost()
    world.box.reply = () => Promise.reject(new Error('宿主一对多失败'))
    const reports: ReportCall[] = []
    const sent = openFolderAt(world.host, 'D:/work/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === true, '异步拒绝：调用已经发出，返回 true')
    check(reports.length === 1 && reports[0].outcome === 'open-failed' && reports[0].detail === '宿主一对多失败',
      '异步拒绝：报 open-failed，异常文字带回给调用方')
  }
  {
    const world = fakeHost()
    world.box.throwSync = true
    const reports: ReportCall[] = []
    const sent = openFolderAt(world.host, 'D:/work/x', (outcome, detail) => reports.push({ outcome, detail }))
    await flush()
    check(sent === false, '同步抛错：调用没发出去，返回 false')
    check(reports.length === 1 && reports[0].outcome === 'open-failed' && reports[0].detail === 'call-down',
      '同步抛错：报 open-failed，不把异常漏给界面')
  }

  // ---- 源码扫描：四处入口不再自己直调宿主，共用函数是唯一实现 ----
  const helperSrc = sourceText(HELPER_REL)
  check(/export function openFolderAt/.test(helperSrc), '共用函数叶子导出 openFolderAt')
  check(!/^\s*import\b/m.test(helperSrc), '共用函数叶子没有运行时 import（拼接闭包只收声明，不收模块导入）')
  check(/\.call\(\s*'wf\.openFolder'/.test(helperSrc), '共用函数叶子是唯一直接发 wf.openFolder 的地方')
  for (const rel of SITES_REL) {
    const src = sourceText(rel)
    check(!/host\.call\(\s*'wf\.openFolder'/.test(src), rel + ' 不再自己直接调 wf.openFolder')
  }
  check(/openFolderAt\(/.test(sourceText(SITES_REL[0])), SITES_REL[0] + ' 接上了共用函数')
  check(/openFolderAt\(/.test(sourceText(SITES_REL[1])), SITES_REL[1] + ' 接上了共用函数')
  check(/openFolderAt\(/.test(sourceText(SITES_REL[2])), SITES_REL[2] + ' 接上了共用函数')
  check(/deps\.openFolder\(/.test(sourceText(SITES_REL[3])), SITES_REL[3] + ' 经 deps.openFolder 注入共用函数（跑腿层不碰闭包）')

  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exit(1)
}

main().catch((e: unknown) => {
  console.error('  FAIL 异常：' + ((e as Error)?.stack || String(e)))
  process.exit(1)
})
