// tests/verify-naming-host-suppression.ts — #315 宿主侧「同仓有带线索草稿单时抑制裸档单」的门禁
//
// 门禁归属: src/host/namingGuardian.ts
//
// 为什么要它（#1243）：#315 的根因是渲染钩子每个窗口都全量执行计划单，而各窗口能看到的会话面没有隔离，
// 结果自动改名会改到别的会话标题上。宿主侧的修法是：同一个仓库里只要有一张「带线索的草稿单」，
// 就把同仓「不带线索的裸档单」从计划单里去掉 —— 只改真正有目标的那一个会话
// （src/host/namingGuardian.ts 里「#315：同仓有带线索草稿单时抑制裸档单」那一段；
//  这段逻辑内联在 namingPlanOnce 里、没有导出，所以只能从外部调工厂来守）。
//
// 这段行为此前没有任何门禁守：#1243 的来历是地图票 #1239 删除手抄门禁时查实的两处真空白之一。
// tests/verify-naming-e2e.ts 驱动的是客户端执行器；两个冒烟（smoke-host-dispatch、smoke-naming-persistence）
// 虽然真调宿主 namingPlan，但登记的会话里没有「同一个仓库、一张带线索 + 一张裸档」的组合，抑制分支从未被走到。
//
// 断言打在真实实现上：直接调用 src/host/namingGuardian.ts 导出的 createNamingGuardian，
// 用内存文件桩喂缓存目录，再走真实的 namingRegisterHandler 登记会话、真实的 handleNamingPlan 读计划单。
// 不手抄过滤逻辑，也不把期望结果硬编码成 oracle —— 期望来自 #315 的行为描述：同仓有线索时抑制同仓裸档，
// 跨仓库不抑制，编号档不受影响，没有线索的仓库照常出裸档单。
//
// 反证（改坏必须红，证据记在票 #1243）：把 src/host/namingGuardian.ts 里
// `if (rk && byRepoHasHint[rk]) continue` 这一行删掉（或改成 `if (false && rk && byRepoHasHint[rk])`），
// 本门禁的「同仓裸档单被抑制」那一组立刻判红；改回即全绿。另外三组（跨仓库/编号档/无线索仓库）
// 是反向对照：抑制生效时它们仍必须出单，否则说明抑制范围被放大成了「所有裸档单都杀」。

import { createNamingGuardian } from '../src/host/namingGuardian.ts'

let failed = false
let total = 0
function check(ok: boolean, msg: string, detail?: any) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail))) }
}

// ---- 内存文件桩：宿主只把缓存目录当普通文件读写，这里不碰真磁盘 ----
function makeStubs(cacheDir: string) {
  const files: any = {}
  const fs = {
    resolve: async function (p: any) { return String(p) },
    readText: async function (p: any) {
      const key = String(p)
      if (Object.prototype.hasOwnProperty.call(files, key)) return files[key]
      throw new Error('ENOENT: ' + key)
    },
    writeText: async function (p: any, text: any) { files[String(p)] = String(text); return true },
  }
  const platform = {
    fs: { resolve: async function (p: any) { return String(p) } },
    path: { join: function (a: any, b: any) { return String(a) + '/' + String(b) } },
  }
  // timer 桩只排队、不触发：本门禁只验计划单过滤，不验定时推进（推进由别的门禁与真机负责）。
  const timer = {
    timeout: function () { return { cancel: function () {} } },
    interval: function () { return { cancel: function () {} } },
  }
  return { files: files, deps: { fs: fs, timer: timer, DEFAULT_CWD: 'C:/ws', getCacheDir: async function () { return cacheDir }, getPlatform: async function () { return platform } } }
}

// ---- 真实现：登记会话只走命名守护自己的入口，不直接改状态文件 ----
const HINT = '修复登录闪退'
const REPO_A = 'acme/demo'
const REPO_B = 'other/repo'
const REPO_SOLO = 'solo/repo'

async function register(guard: any, args: any) {
  const res = await guard.namingRegisterHandler(args)
  return res
}

async function plan(guard: any) { return guard.handleNamingPlan() }

function sessionIds(orders: any[]) { return (orders || []).map(function (o: any) { return o && o.sessionId }).sort() }
function report(orders: any[]) { return JSON.stringify((orders || []).map(function (o: any) { return { sessionId: o && o.sessionId, kind: o && o.kind, hint: o && o.hint } })) }

console.log('\n— #315 宿主抑制：计划单只改有线索的目标会话 —')

// 第一组：同仓两张草稿单 —— 带线索的留下，裸档的被抑制；跨仓库裸档与同仓编号档不受影响。
{
  const stubs = makeStubs('C:/cache-315-a')
  const guard = createNamingGuardian(stubs.deps)
  for (const reg of [
    { sessionId: 's-hint', baselineTitle: '[New] 新建需求', repoKey: REPO_A, hint: HINT },
    { sessionId: 's-bare', baselineTitle: '[New] 新建需求', repoKey: REPO_A },
    { sessionId: 's-other', baselineTitle: '[New] 新建需求', repoKey: REPO_B },
    { sessionId: 's-num', baselineTitle: '[#42] 修复登录闪退', repoKey: REPO_A },
  ]) {
    const r = await register(guard, reg)
    check(!!(r && r.ok), '登记会话 ' + reg.sessionId + '（真入口返回 ok）', JSON.stringify(r))
  }
  const p = await plan(guard)
  const orders = (p && p.orders) || []
  const ids = sessionIds(orders)
  check(ids.indexOf('s-hint') !== -1, '同仓带线索草稿单：留在计划单里（要改的就是它）', report(orders))
  check(ids.indexOf('s-bare') === -1, '同仓裸档单被抑制（#315：只改有线索的目标会话）', report(orders))
  check(ids.indexOf('s-other') !== -1, '跨仓库裸档单不被抑制（抑制按仓库分组，不是一刀切）', report(orders))
  check(ids.indexOf('s-num') !== -1, '同仓编号档不受抑制影响（#315 只针对裸档单）', report(orders))
  const hintOrder = orders.filter(function (o: any) { return o && o.sessionId === 's-hint' })[0]
  check(!!hintOrder && hintOrder.kind === 'draft' && hintOrder.hint === HINT, '带线索的单必须原样带着线索出门（不是只留个空壳）', JSON.stringify(hintOrder))

  // 反向对照：抑制生效后，裸档单并没有从账号里消失 —— 下一轮没有线索单时它应当重新出现。
  // 这里直接把带线索那张会话删掉（走守护自己的取消入口），再拉一次计划单。
  const cancel = await guard.handleCancelNewSessionWatcher({ sessionId: 's-hint' })
  check(!!(cancel && cancel.ok && cancel.cancelled === true), '撤销带线索会话（真入口返回 cancelled）', JSON.stringify(cancel))
  const p2 = await plan(guard)
  const ids2 = sessionIds((p2 && p2.orders) || [])
  check(ids2.indexOf('s-bare') !== -1, '抑制是这一轮的过滤、不是永久删单：线索会话消失后裸档单回来', report((p2 && p2.orders) || []))
}

// 第二组：仓库里没有任何带线索的草稿单 —— 裸档单照常出，抑制不能凭空生效。
{
  const stubs = makeStubs('C:/cache-315-b')
  const guard = createNamingGuardian(stubs.deps)
  const r = await register(guard, { sessionId: 's-solo', baselineTitle: '[New] 新建需求', repoKey: REPO_SOLO })
  check(!!(r && r.ok), '登记无线索仓库的裸档会话', JSON.stringify(r))
  const p = await plan(guard)
  const ids = sessionIds((p && p.orders) || [])
  check(ids.indexOf('s-solo') !== -1, '无线索仓库：裸档单照常出（没有线索就没有抑制）', report((p && p.orders) || []))
}

// 第三组：带线索的会话没有仓库键 —— 抑制按 repoKey 生效，没有仓库键就无从判断「同仓」，不能误杀别家裸档单。
{
  const stubs = makeStubs('C:/cache-315-c')
  const guard = createNamingGuardian(stubs.deps)
  const r1 = await register(guard, { sessionId: 's-hint-norepo', baselineTitle: '[New] 新建需求', hint: HINT })
  check(!!(r1 && r1.ok), '登记带线索但无仓库键的会话（repoKey 解析不到时注册仍成立）', JSON.stringify(r1))
  const r2 = await register(guard, { sessionId: 's-bare2', baselineTitle: '[New] 新建需求', repoKey: REPO_A })
  check(!!(r2 && r2.ok), '登记同仓判断所需的裸档会话', JSON.stringify(r2))
  const p = await plan(guard)
  const ids = sessionIds((p && p.orders) || [])
  check(ids.indexOf('s-bare2') !== -1, '线索会话没有仓库键时：不去抑制仓库里的裸档单（按 repoKey 判断同仓，不猜）', report((p && p.orders) || []))
}

if (failed) { console.log('\n宿主抑制门禁存在失败'); process.exit(1) }
console.log('\n全部通过（' + total + ' 项）')
