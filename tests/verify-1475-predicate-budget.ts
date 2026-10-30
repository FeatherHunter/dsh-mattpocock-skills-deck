#!/usr/bin/env node
// tests/verify-1475-predicate-budget.ts —— 门禁：检测链外层等待预算要盖住内层串行最坏并留余量（票 #1475）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1475-predicate-budget.ts
//
// 这一票修的是「超时预算倒挂」：外层等待比内层那几条真实网络命令的串行最坏还短，
// 慢网下就会出现「外层先到点、内层命令还在跑、这次求值的结论被丢掉」。门禁盯五件事：
//   ① 算术：外层等待 ≥ 内层串行最坏 + 余量；三个数字全部从中央配置与出站档位现算，
//      测试里不写第二份毫秒数；再把外层故意压低 1 毫秒，判断必须变红并指出改哪个配置；
//   ② 漂移：preflight 里真实发出的命令与预算表登记的命令必须一一对上
//      （顺序地漏一条，预算就会少算一档，这类漂移只能靠对源码才看得出来）；
//   ③ 比例缩小竞速：把内层各档与外层按同一比例缩小后真跑一遍 —— 预算够时两个谓词都拿到真实结论；
//      预算不够时按 pending 收场、文案仍是「暂时确认不了」，不冒充登录失效、不冒充缺 gh，
//      而且迟到的那份真实结论还能被回调记下来（日志能说清哪一层先到点、丢掉了什么）；
//   ④ 端到端：真链求值 + 真 preflight，假执行器把每条命令拖慢 200 毫秒 —— 一次求值仍是一条命令只问一次，
//      两项都拿到真实结论，日志里看得到各条命令耗时与本次求值总耗时；
//   ⑤ 源码接线：告警级轨迹（外层先到点 / 内层迟到回话）确实接在链求值这一侧的注册表上。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pathMod from 'node:path'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import { ghPreflight, ghPreflightWorstCaseMs, GH_PREFLIGHT_SERIAL_STEPS, GH_PREFLIGHT_SERIAL_PATHS } from '../src/tracker/rooms/github/read/preflight.ts'
import { probeChainEnv, ghAuthVerdict, repoAccessVerdict } from '../src/refresh/rooms/host/chain-env-map.ts'
import { timeoutForGhArgs } from '../src/tracker/kernel/outbound-tiers.ts'
import { createPredicateRegistry } from '../src/host/tracker/predicateCore.ts'
import { createDetectChain } from '../src/refresh/rooms/host/check-chain-evaluation.ts'
import { PREDICATE_TIMEOUT_MS, PREDICATE_MARGIN_MS } from '../src/shared/time-config/values.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
function must(ok, label, detail) {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' —— ' + String(detail)))
  if (!ok) failed = true
}
function title(t) { console.log('\n' + t) }

// 一条指令的真实等待上限（毫秒）：从中央出站档位取，测试里不写数字。
function scaledStepMs(args, scale) { return Math.max(20, Math.ceil(timeoutForGhArgs(args) / scale)) }

// 一条路径串行跑完的等待上限之和（毫秒）：全部从预算表登记的命令现算，不在测试里写第二份数字。
function pathSum(vias) {
  let sum = 0
  for (const via of vias) {
    const step = GH_PREFLIGHT_SERIAL_STEPS.find((s) => s.via === via)
    sum += timeoutForGhArgs(step.argv)
  }
  return sum
}

// 按同一比例缩小后的「内层串行最坏」：真实算式见 preflight.ts 的 ghPreflightWorstCaseMs()。
function scaledWorstCaseMs(scale) {
  let worst = 0
  for (const p of GH_PREFLIGHT_SERIAL_PATHS) {
    let sum = 0
    for (const via of p) {
      const step = GH_PREFLIGHT_SERIAL_STEPS.find((s) => s.via === via)
      sum += scaledStepMs(step.argv, scale)
    }
    if (sum > worst) worst = sum
  }
  return worst
}

// 预算够不够：这条判断就是门禁的核心算式。报错话术必须直接说清「外层多少、内层多少、差在哪、改哪个配置」，
// 让下一个看到红灯的人不用翻代码就知道该改哪一行。
function assessBudget(outerMs, innerMs, marginMs) {
  const need = innerMs + marginMs
  const ok = outerMs >= need
  const message = '外层等待 ' + outerMs + 'ms 必须 ≥ 内层串行最坏 ' + innerMs + 'ms + 余量 ' + marginMs +
    'ms（合计至少 ' + need + 'ms）；改 config/timeouts.yaml 的 predicateTimeoutMs（外层那一档）与 predicateMarginMs（余量），' +
    '内层最坏由 src/tracker/rooms/github/read/preflight.ts 的 ghPreflightWorstCaseMs() 按出站档位现算'
  return { ok: ok, need: need, message: message }
}

// 假执行器：按参数回一段让房间判「通过」的样本；delayOfIn 决定这条命令拖多久（毫秒）。
function makeGhFixture(delayOfIn, repoKeyOverride) {
  const calls = []
  const roomEvents = []
  const outbound = createOutboundControl()
  const exec = async (_cmd, args) => {
    calls.push([...args])
    const ms = delayOfIn(args)
    if (ms > 0) await new Promise((r) => setTimeout(r, ms))
    if (args[0] === 'auth' && args[1] === 'status') return { stdout: 'github.com\n  ✓ Logged in to github.com account FeatherHunter (keyring)\n', stderr: '', code: 0 }
    if (args[0] === 'api' && args[1] === 'user') return { stdout: '{"login":"FeatherHunter"}', stderr: '', code: 0 }
    if (args[0] === 'api') return { stdout: '{}', stderr: '', code: 0 }
    if (args[0] === 'repo' && args[1] === 'view') return { stdout: 'FeatherHunter/dsh-mattpocock-skills-deck', stderr: '', code: 0 }
    throw new Error('unexpected gh command: ' + args.join(' '))
  }
  const ctx = {
    outbound: outbound,
    platform: { resolveExecutable: async () => 'gh' },
    exec: exec,
    cwd: '.',
    logEvent: function (level, event, fields) { roomEvents.push({ level: level, event: event, fields: fields }) },
    isEnabled: () => true,
  }
  const session = {
    preflight: function (handle, opCtx) { return ghPreflight(handle, opCtx) },
    getCurrentUser: async () => ({ ok: false }),
  }
  const deps = {
    getRepoKey: async () => (repoKeyOverride || { owner: '', name: '' }),
    openSession: async () => ({ ok: true, call: async (fn) => fn(session, ctx) }),
  }
  return { calls: calls, roomEvents: roomEvents, ctx: ctx, probe: probeChainEnv(deps, '.') }
}

// 按生产同形把两个谓词挂上注册表，再整链求值（口径与 check-chain-evaluation.ts 一致）。
async function resolveBoth(probe, timeoutMs, hooks) {
  const registry = createPredicateRegistry(Object.assign({ timeout: timeoutMs }, hooks || {}))
  registry.register('preflight:ghAuth', async () => ghAuthVerdict(await probe.preflightOnce(), true))
  registry.register('backend:github:repoAccess', async () => repoAccessVerdict(await probe.preflightOnce(), true))
  return registry.resolveAll([
    { id: 'gh:authed', check: { kind: 'preflight', id: 'ghAuth' } },
    { id: 'gh:repoAccess', check: { kind: 'backend', backendId: 'github', id: 'repoAccess' } },
  ], { backendId: 'github', lang: 'zh' })
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return predicate()
}

async function main() {
  title('① 算术：外层等待 ≥ 内层串行最坏 + 余量（数字全部现算）')
  {
    const inner = ghPreflightWorstCaseMs()
    const outer = PREDICATE_TIMEOUT_MS
    const margin = PREDICATE_MARGIN_MS
    console.log('  内层串行最坏 ' + inner + 'ms = 一次环境预检各条命令按出站档位的和（互斥路径取最宽一条）')
    console.log('  外层等待 ' + outer + 'ms，余量 ' + margin + 'ms（config/timeouts.yaml 的 predicateTimeoutMs / predicateMarginMs）')
    must(inner > 0, '内层串行最坏是正数（预算表真的按出站档位算出了东西，不是空表）', String(inner))
    must(margin > 0, '余量是正数（没有把余量写成 0 去凑算式）', String(margin))
    const live = assessBudget(outer, inner, margin)
    must(live.ok, '当前配置：外层等待盖得住内层串行最坏并留出余量', live.message)
    must(assessBudget(inner + margin, inner, margin).ok === true, '恰好等于「内层最坏 + 余量」也算通过（边界是 ≥，不是 >）', live.message)
    const red = assessBudget(inner + margin - 1, inner, margin)
    must(red.ok === false, '把外层压低 1 毫秒（' + (inner + margin - 1) + 'ms < ' + inner + '+' + margin + 'ms）时必须判红', '还是绿的')
    must(red.message.indexOf('config/timeouts.yaml') >= 0 && red.message.indexOf('predicateTimeoutMs') >= 0,
      '红灯话术直接指出改哪个配置（config/timeouts.yaml 的 predicateTimeoutMs）', red.message)
  }

  title('② 漂移：preflight 真实发出的命令与预算表一一对上')
  {
    // #1686 阶段 1：preflight 随 read 层搬进 read/，这里读真身而不是旧路径的转发壳。
    const src = readFileSync(join(ROOT, 'src/tracker/rooms/github/read/preflight.ts'), 'utf8')
    const callCount = (src.match(/\.execGh\(/g) || []).length
    must(callCount === GH_PREFLIGHT_SERIAL_STEPS.length,
      '预检文件里真实调用 execGh 的次数（' + callCount + '）等于预算表登记的步数（' + GH_PREFLIGHT_SERIAL_STEPS.length + '）',
      '多一条或少一条都要同步改预算表，否则内层最坏会算小')
    const vias = []
    // 跨行再找 via：真实调用可能先在括号里现拼参数（如 ghRepoApiArgv(...)），[^)]* 会在这里断掉。
    const re = /\.execGh\([\s\S]{0,300}?via:\s*'([^']+)'/g
    let hit
    while ((hit = re.exec(src)) !== null) vias.push(hit[1])
    const registered = GH_PREFLIGHT_SERIAL_STEPS.map((s) => s.via).sort()
    must(vias.slice().sort().join(',') === registered.join(','),
      '真实调用上的 via 标签与预算表登记的一一对应', JSON.stringify({ real: vias.slice().sort(), table: registered }))
    const pathVias = []
    for (const p of GH_PREFLIGHT_SERIAL_PATHS) for (const v of p) pathVias.push(v)
    must(pathVias.every((v) => registered.indexOf(v) >= 0), '每条互斥路径引用的步骤都登记过', JSON.stringify(pathVias))
    must(GH_PREFLIGHT_SERIAL_PATHS.every((p) => p.length > 0 && p[0] === 'preflight.auth'),
      '每条互斥路径都从「查登录」开始（登录态那一条命令每次都要问）', JSON.stringify(GH_PREFLIGHT_SERIAL_PATHS))
    const pathKeys = GH_PREFLIGHT_SERIAL_PATHS.map((p) => p.join('>'))
    must(new Set(pathKeys).size === GH_PREFLIGHT_SERIAL_PATHS.length,
      '互斥路径没有重复登记（重复会让「最宽」虚高）', JSON.stringify(pathKeys))
    must(GH_PREFLIGHT_SERIAL_PATHS.some((p) => p[p.length - 1] === 'preflight.auth-crosscheck'),
      '登记了「核对也不通过、带着失败结论返回」那条：查登录 → 核对登录即止', JSON.stringify(GH_PREFLIGHT_SERIAL_PATHS))
    // 核对通过只说明登录可用，仓库可达还没查：跨过第 3 关继续走，不许把核对当成终点。
    // 此处漏登记过一次（评审查出）：内层最坏少算 15 秒，外层预算因此假绿——这条断言专门守它。
    must(GH_PREFLIGHT_SERIAL_PATHS.every((p) => {
      const at = p.indexOf('preflight.auth-crosscheck')
      return at < 0 || at === p.length - 1 || p.indexOf('preflight.api') > at
    }), '核对登录通过之后必须继续查仓库可达（不许把核对当成终点）', JSON.stringify(GH_PREFLIGHT_SERIAL_PATHS))
    must(GH_PREFLIGHT_SERIAL_STEPS.every((s) => timeoutForGhArgs(s.argv) > 0), '预算表每条命令都能从出站档位取到正数等待上限')
    const worstPath = GH_PREFLIGHT_SERIAL_PATHS.reduce((a, b) => (pathSum(b) > pathSum(a) ? b : a), [])
    must(GH_PREFLIGHT_SERIAL_STEPS.every((s) => worstPath.indexOf(s.via) >= 0),
      '四条命令都出现在最宽那条路径里（漏任何一条，内层最坏都会算小）', JSON.stringify(worstPath))
    must(pathSum(worstPath) === ghPreflightWorstCaseMs(),
      'ghPreflightWorstCaseMs() 取到的就是结构上最宽那条路径的和', pathSum(worstPath) + ' vs ' + ghPreflightWorstCaseMs())
  }

  title('③ 比例缩小竞速：同一个夹具跑「预算够」与「预算不够」两次')
  {
    // 按 SCALE 等比缩小后真跑：内层各档、外层预算、迟到观察窗都缩，只有先后关系保真。
    // 这一节真跑「登录通过、缺仓库短名」那条（查登录 → 读仓库短名 → 读仓库可达）；
    // 内层最宽的「核对通过 + 缺仓库短名」那条要 auth status 先失败才走，端到端行为本票没动，
    // 由 ① 的算术与 ② 的结构断言覆盖，不在这里真跑。
    const SCALE = 25
    const scaledOuter = Math.floor(PREDICATE_TIMEOUT_MS / SCALE)
    const scaledWorst = scaledWorstCaseMs(SCALE)
    const scaledFirst = scaledStepMs(['auth', 'status'], SCALE)
    must(scaledOuter >= scaledWorst, '按比例缩小后外层预算仍然盖得住内层最坏（比例缩放没有把关系改掉）', scaledOuter + ' vs ' + scaledWorst)

    const good = makeGhFixture((args) => scaledStepMs(args, SCALE), null)
    const goodHits = []
    const goodLate = []
    const goodResults = await resolveBoth(good.probe, scaledOuter, {
      onBudgetHit: (id, info) => goodHits.push({ id: id, budgetMs: info.budgetMs }),
      onLateSettle: (id, info) => goodLate.push({ id: id, status: info.status }),
    })
    must(goodResults['gh:authed'] && goodResults['gh:authed'].status === 'pass',
      '预算够：登录态那一项拿到真实结论 pass（不是 pending）', JSON.stringify(goodResults['gh:authed']))
    must(goodResults['gh:repoAccess'] && goodResults['gh:repoAccess'].status === 'pass',
      '预算够：仓库可达那一项拿到真实结论 pass（不是 pending）', JSON.stringify(goodResults['gh:repoAccess']))
    must(goodHits.length === 0, '预算够：外层一次都没先到点（没有假超时）', JSON.stringify(goodHits))
    must(good.probe.asked() === 1, '预算够：两个谓词共用一次环境预检（asked=1，不多问一遍）', String(good.probe.asked()))
    const goodVias = good.roomEvents.filter((e) => e.event === 'gh.exec').map((e) => String(e.fields.via || ''))
    must(goodVias.join(',') === 'preflight.auth,preflight.repo-view,preflight.api',
      '预算够：走的是「登录通过、缺仓库短名」那条路（查登录 → 读仓库短名 → 读仓库可达），每条命令各一次', JSON.stringify(goodVias))
    must(good.roomEvents.some((e) => e.event === 'gh.exec' && typeof e.fields.latencyMs === 'number' && e.fields.latencyMs >= 0),
      '预算够：每条命令的耗时（gh.exec 的 latencyMs）照常落日志')

    const bad = makeGhFixture((args) => scaledStepMs(args, SCALE), null)
    const badBudget = Math.max(5, Math.floor(scaledFirst / 4))
    const badHits = []
    const badLate = []
    const badResults = await resolveBoth(bad.probe, badBudget, {
      onBudgetHit: (id, info) => badHits.push({ id: id, budgetMs: info.budgetMs }),
      onLateSettle: (id, info) => badLate.push({ id: id, status: info.status }),
    })
    must(badBudget < scaledFirst, '反证用的预算比第一条命令还短（必然先到点）', badBudget + ' < ' + scaledFirst)
    must(badResults['gh:authed'] && badResults['gh:authed'].status === 'pending',
      '预算不够：到点仍判「暂时确认不了」（pending），不冒充登录失效', JSON.stringify(badResults['gh:authed']))
    must(badResults['gh:repoAccess'] && badResults['gh:repoAccess'].status === 'pending',
      '预算不够：仓库可达那一项也是 pending，不冒充缺 gh 或仓库不存在', JSON.stringify(badResults['gh:repoAccess']))
    const badDetail = String(badResults['gh:authed'] && badResults['gh:authed'].detail || '')
    must(/timeout after/.test(badDetail), '待定文案仍是「超时后重新检查」那一句（不会串成登录失效或缺 gh）', badDetail)
    must(badDetail.indexOf('登录失效') < 0 && badDetail.indexOf('缺 gh') < 0 && badDetail.indexOf('gh not found') < 0,
      '待定文案里没有冒充登录失效、也没有冒充缺 gh', badDetail)
    must(badHits.length === 2 && badHits.every((h) => h.budgetMs === badBudget),
      '外层先到点：两个谓词各记一次，赔进去的预算就是配置值', JSON.stringify(badHits))
    const lateArrived = await waitFor(() => badLate.length === 2, Math.max(2000, scaledWorst * 3))
    must(lateArrived, '内层后来还是跑完了：迟到结论被如实记下来（日志能说清丢掉了什么）', JSON.stringify(badLate))
    must(badLate.every((l) => l.status === 'pass'), '迟到结论记的是真实状态 pass（不因超时而改写成 pending）', JSON.stringify(badLate))
  }

  title('④ 端到端：真链求值 + 真 preflight，假执行器把每条命令拖慢 200 毫秒')
  {
    const SLOW_MS = 200
    const fixture = makeGhFixture(() => SLOW_MS, { owner: 'acme', name: 'demo' })
    const hostEvents = []
    const logCtx = {
      isEnabled: () => true,
      fire: (level, event, fields) => { hostEvents.push({ level: level, event: event, fields: typeof fields === 'function' ? fields() : fields }) },
    }
    const chain = createDetectChain({
      canonicalKey: async (raw) => String(raw || ''),
      DEFAULT_CWD: 'D:/demo',
      resetGhCache: () => {},
      getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'github', source: 'auto' } }) }),
      getPlatform: async () => ({ os: 'win32', path: pathMod, async getHome() { return 'C:/Users/fake' } }),
      getTrackerRegistry: async () => ({ modules: () => [] }),
      getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
      timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
      probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
      mdPredicate: async () => ({ status: 'pass', detail: 'fake' }),
      getChainCache: () => null,
      setChainCache: () => {},
      getChainBackoff: async () => ({ verdict: async () => ({ needed: true, reason: 'test-always-due', waitMs: 0, cached: null }), note: async () => ({}) }),
      logCtx: logCtx,
      gate: null,
      // 会话 ctx 与 916 夹具同形：平台解析、起进程口、出站闸、日志口全在里面，房间才找得到 gh。
      openSession: async () => ({ ok: true, backendId: 'github', budget: {}, call: (fn) => fn({ preflight: (h, c) => ghPreflight(h, c), getCurrentUser: async () => ({ ok: false }) }, fixture.ctx) }),
    })
    const out = await chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
    const resolved = out && out.backendChain && out.backendChain.resolved || {}
    must(!!out && out.ok === true, '慢网下一次求值拿到结论本身（没有在链这一层报错）', JSON.stringify(out && out.error))
    must(resolved['gh:authed'] && resolved['gh:authed'].status === 'pass', '端到端：登录态拿到真实结论 pass', JSON.stringify(resolved['gh:authed']))
    must(resolved['gh:repoAccess'] && resolved['gh:repoAccess'].status === 'pass', '端到端：仓库可达拿到真实结论 pass', JSON.stringify(resolved['gh:repoAccess']))
    must(fixture.calls.length === 2, '端到端：一次求值正好问两条命令（一条命令一次、不多起进程）', JSON.stringify(fixture.calls))
    const reuse = hostEvents.find((e) => e.event === 'chain.preflight.reuse')
    must(!!reuse, '端到端：一次求值的总耗时落进日志（chain.preflight.reuse）', JSON.stringify(hostEvents.map((e) => e.event)))
    const reuseLatency = reuse && reuse.fields && reuse.fields.latencyMs
    must(typeof reuseLatency === 'number' && reuseLatency >= SLOW_MS + SLOW_MS, '端到端：总耗时 ≥ 两条慢命令之和（' + reuseLatency + 'ms），不是 0 也不是缺字段', JSON.stringify(reuse && reuse.fields))
    const ghRows = fixture.roomEvents.filter((e) => e.event === 'gh.exec')
    must(ghRows.length === 2 && ghRows.every((e) => typeof e.fields.latencyMs === 'number' && e.fields.latencyMs > 0),
      '端到端：两条命令各自的耗时都进了日志（gh.exec 的 latencyMs）', JSON.stringify(ghRows.map((e) => e.fields.latencyMs)))
    must(!hostEvents.some((e) => e.event === 'chain.predicate.timeout'), '端到端：正常路径没有预算先到点的告警行（不误报）')
  }

  title('⑤ 源码接线：告警级轨迹接在链求值这一侧')
  {
    const src = readFileSync(join(ROOT, 'src/refresh/rooms/host/check-chain-evaluation.ts'), 'utf8')
    must(src.indexOf("'chain.predicate.timeout'") >= 0, '链求值这一侧确实发射「预算先到 / 迟到回话」告警行')
    must(src.indexOf('onBudgetHit') >= 0 && src.indexOf('onLateSettle') >= 0, '两个回调都挂在 createPredicateRegistry 的选项上')
    must(src.indexOf("phase: 'budget'") >= 0 && src.indexOf("phase: 'late'") >= 0, '两个阶段分得开（budget 外层先到点 / late 内层迟到回话）')
    must(src.indexOf('latencyMs: Date.now() - evalT0') >= 0, '记的是本次求值总耗时（同一个求值起点，不是各条命令自己的钟）')
    const coreSrc = readFileSync(join(ROOT, 'src/host/tracker/predicateCore.ts'), 'utf8')
    must(coreSrc.indexOf('onLateSettle') >= 0 && coreSrc.indexOf('predicateStatusOf') >= 0,
      '注册表这一侧确实把迟到结论归一后交给回调（没有把结果改写成 pending）')
    must(coreSrc.indexOf('budgetMs: ms') >= 0, '迟到回话那一行自带当时赔进去的预算（不靠调用方另存一张表回带）')
  }

  title('⑥ 真等慢网（可选）：把每条命令真拖十来秒，确认外层 60 秒不会先掐断')
  {
    // 默认不跑：这一段真要等三十多秒，会把全链节奏拖长一大截；但验收里「每条命令拖满 12 秒」
    // 那一条只有真等才最接近现场，所以留一个开关，动这一票的人至少手动跑过一遍：
    //   VERIFY_1475_SLOW=1 node --import ./scripts/ts-hook.mts tests/verify-1475-predicate-budget.ts
    // 每条命令的延迟取「自己的出站档位 − 1 秒」，最多 12 秒：读档等待上限就是 12 秒，
    // 真拖满 12 秒会被房内分档超时先断 —— 那是内层档位到点，不是本票的外层预算问题，
    // 而且会落进「谁先到点」的竞态里。留 1 秒余量后三条串行约 34 秒，仍远大于改前的外层 15 秒，
    // 足以证明「旧预算会先掐断、新预算能等到结论」。
    if (process.env.VERIFY_1475_SLOW !== '1') {
      console.log('  跳过：默认不真等三十多秒；要跑这一段就加环境变量 VERIFY_1475_SLOW=1 再执行本文件。')
    } else {
      const slowDelay = (args) => Math.min(12000, timeoutForGhArgs(args) - 1000)
      const fixture = makeGhFixture(slowDelay, null)
      const hits = []
      const slowT0 = Date.now()
      const results = await resolveBoth(fixture.probe, PREDICATE_TIMEOUT_MS, {
        onBudgetHit: (id, info) => hits.push({ id: id, budgetMs: info.budgetMs }),
      })
      const elapsed = Date.now() - slowT0
      must(results['gh:authed'] && results['gh:authed'].status === 'pass',
        '真等慢网：登录态拿到真实结论 pass（外层没有先掐断）', JSON.stringify(results['gh:authed']))
      must(results['gh:repoAccess'] && results['gh:repoAccess'].status === 'pass',
        '真等慢网：仓库可达拿到真实结论 pass（外层没有先掐断）', JSON.stringify(results['gh:repoAccess']))
      must(fixture.calls.length === 3, '真等慢网：一次求值正好问三条命令（缺仓库短名那条路，每条命令各一次）',
        JSON.stringify(fixture.calls))
      must(hits.length === 0, '真等慢网：外层一次都没先到点（预算真的够）', JSON.stringify(hits))
      const perDelay = fixture.calls.map(slowDelay)
      let waited = 0
      for (const ms of perDelay) waited += ms
      must(elapsed >= Math.floor(waited * 0.95),
        '真等慢网：整趟确实等满了各条命令的延迟（' + elapsed + 'ms ≥ 约 ' + waited + 'ms），不是提前返回',
        elapsed + ' vs ' + waited)
      const rows = fixture.roomEvents.filter((e) => e.event === 'gh.exec')
      const minPerCommand = Math.min.apply(null, perDelay) - 500
      must(rows.length === 3 && rows.every((e) => typeof e.fields.latencyMs === 'number' && e.fields.latencyMs >= minPerCommand),
        '真等慢网：三条命令各自的真实耗时都进了日志（每条都接近它自己的慢延迟）',
        JSON.stringify(rows.map((e) => e.fields.latencyMs)))
      console.log('  这一段真等了 ' + elapsed + 'ms；改前外层预算只有 15 秒，这里会先到点、两个谓词都变 pending。')
    }
  }

  if (failed) {
    console.log('\n1475 PREDICATE BUDGET TESTS FAILED（共 ' + total + ' 条断言）')
    process.exit(1)
  }
  console.log('\n1475 PREDICATE BUDGET TESTS PASSED（共 ' + total + ' 条断言）')
}

main().catch((e) => { console.log('FAIL 预算门禁跑不起来：' + String((e && e.stack) || e)); process.exit(1) })
