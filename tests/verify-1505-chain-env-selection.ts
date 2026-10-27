#!/usr/bin/env node
// tests/verify-1505-chain-env-selection.ts —— 门禁：#1505 环境探针开会话必须沿用链求值已定下的后端
//
// 病根（#1505 / #1555 同族）：检查链先跑统一判定定下这次用哪个后端（显式 / 声明 / 自动识别都算），
// 但环境预检探针（登录态、仓库可达、当前登录名）开只读会话时只把目录交了下去。会话入口在目录里
// 没有 .git、也没有远端可认领时，注册表各家都举不了手，于是会话回 no-backend；探针把这一档收成
// stage='none'，界面上「已登录 GitHub」永远显示「读会话还没接上，暂时无法确认登录状态」。
//
// 修法（维护者拍板的方案）：在知道这次决定的这一层（check-chain-evaluation.ts 的 createChainEnvProbe）
// 把 openSession 能力包一层——链定下非空后端时，以 resolveSelection 把归一后的 { backendId } 交给会话；
// 判定层没有结论、调用方也没给后端时维持原样（不许伪造一个 github 会话）。
//
// 本门禁钉住（用真的 createDetectChain 与真探针，假的只是外部世界）：
//   ① 报告现场：判定层已选 github、目录里没有 .git（会话不能靠注册表认领）→ 探针必须拿到 github 会话，
//      「已登录」行判 pass（已登录（仓库可达性由下一项判断）），「仓库可访问」保持红；
//   ② 判定层没有结论、调用方给了 backendId 兜底 → 同样必须用这个后端；
//   ③ 目录里补上 .git 与 github 远端后行为不比今天差（登录行照样 pass，旧路也仍能认出 github）；
//   ④ 判定层没结论、调用方也没给后端时，一次会话都不开（不许伪造 github 会话）；
//   ⑤ 交给会话的选择只有归一后的 { backendId }：判定带着 multiHit / pending 时也不把整份结论递下去；
//   ⑥ 对照：换回「只给 cwd」的旧接线时，同样的场景会落回 stage='none' 与「读会话还没接上」。
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-1505-chain-env-selection.ts
//
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts
// 门禁归属: src/refresh/rooms/host/chain-env-map.ts
import path from 'node:path'

import { createDetectChain } from '../src/refresh/rooms/host/check-chain-evaluation.ts'
import { probeChainEnv, ghAuthVerdict } from '../src/refresh/rooms/host/chain-env-map.ts'
import * as githubMod from '../src/tracker/rooms/github/index.ts'

let total = 0
let failed = false
function check(ok: boolean, invariant: string, detail?: any) {
  total += 1
  if (ok) { console.log('  PASS ' + invariant); return }
  failed = true
  console.log('  FAIL 不变式破了 —— ' + invariant + (detail === undefined ? '' : '【实测：' + String(detail) + '】'))
}
function title(t: string) { console.log('\n' + t) }

/** 本次求值的目录（假的即可：链求值不要求目录真的存在；「有没有 .git」由假会话按场景表达）。 */
const DEMO_CWD = 'D:/workspace-1505'

/** 假平台：通用环境行与「gh 已安装」那一行读它。 */
function makePlatform() {
  return {
    marker: 'session-platform',
    os: 'win32',
    path: path,
    async getHome() { return 'C:/Users/fake' },
    async resolveExecutable(name: string) { return name === 'gh' ? 'C:/fake/gh' : null },
  }
}

/**
 * 造一次链求值的现场。
 *
 * 假会话忠实复刻生产 session-opener 的选择语义：调用方给了 resolveSelection 就用它的结论；
 * 没给时退回「按目录里能不能认领」——hasGit=false 表示目录里只有 docs/agents/workspace.yaml、
 * 没有 .git 也没有远端，注册表各家都举不了手，会话只能回 no-backend（#1505 的现场）。
 */
function makeFixture(opts: any) {
  const o = opts || {}
  const calls: any[] = []
  const selections: any[] = []
  const handles: any[] = []
  const stats = { preflight: 0, getCurrentUser: 0, opened: 0 }
  const detectReply = o.detect === undefined ? { selection: { backendId: 'github', source: 'explicit' } } : o.detect

  async function openSession(cwd: string, openOpts?: any) {
    calls.push({ cwd: cwd, opts: openOpts })
    const resolver = (openOpts && typeof openOpts.resolveSelection === 'function') ? openOpts.resolveSelection : null
    let backendId = ''
    if (resolver) {
      const selected = await resolver({ cwd: cwd }, { cwd: cwd })
      selections.push(selected)
      backendId = (selected && selected.backendId) ? String(selected.backendId) : ''
    } else {
      backendId = o.hasGit ? 'github' : ''
    }
    if (!backendId) return { ok: false, reason: 'no-backend' }
    stats.opened += 1
    const session = {
      async preflight(handle: any) {
        stats.preflight += 1
        handles.push(handle)
        // 假 gh 已登录（第二关过），但目录里没有仓库可核对：房间按仓库定位失败收场。
        return { ok: false, error: { kind: 'not-found', message: 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)' } }
      },
      async getCurrentUser() {
        stats.getCurrentUser += 1
        return { ok: true, data: { login: 'tester' } }
      },
      async getRepoKey() { return null },
    }
    return { ok: true, backendId: backendId, budget: {}, call: function (fn: any) { return fn(session, { cwd: cwd }) } }
  }

  const chain = createDetectChain({
    canonicalKey: async (raw: string) => String(raw || ''),
    DEFAULT_CWD: DEMO_CWD,
    resetGhCache: function () {},
    getDetectionService: async function () { return { detect: async function () { return detectReply } } },
    getPlatform: async function () { return makePlatform() },
    getTrackerRegistry: async function () {
      return { modules: function () { return [{ id: 'github', fixes: githubMod.fixes, prompts: githubMod.prompts }] } }
    },
    getRepoKey: async function () { return null },
    timer: { timeout: function (ms: number) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) } },
    probeSkill: async function () { return { ok: true, level: 'ok', detail: 'fake' } },
    mdPredicate: async function () { return { status: 'pass', detail: 'fake' } },
    getChainCache: function () { return null },
    setChainCache: function () {},
    getChainBackoff: async function () {
      return {
        verdict: async function () { return { needed: true, reason: 'test-always-due', waitMs: 0, cached: null } },
        note: async function () { return {} },
      }
    },
    logCtx: null,
    gate: null,
    openSession: openSession,
  })
  return { chain: chain, calls: calls, selections: selections, handles: handles, stats: stats, openSession: openSession }
}

/** 跑一次链求值。 */
async function runScenario(opts: any) {
  const fx = makeFixture(opts)
  const args: any = { cwd: DEMO_CWD, lang: 'zh', force: true }
  if (opts && opts.argsBackendId !== undefined) args.backendId = opts.argsBackendId
  return { out: await fx.chain.handleChain(args), fx: fx }
}

/** 取后端链上某一项的判定（行 id 就是检查目录里的 id）。 */
function resolvedOf(out: any, id: string) {
  const pack = out && out.backendChain
  return (pack && pack.resolved && pack.resolved[id]) || null
}
/** 取后端链上某一步的界面视图。 */
function stepOf(out: any, id: string) {
  const steps = (out && out.backendChain && out.backendChain.snapshot && out.backendChain.snapshot.steps) || []
  return steps.find(function (s: any) { return s.id === id }) || null
}

async function main() {
  title('① 报告现场：判定层已选 github、目录里没有 .git —— 探针沿用 github 会话，「已登录」行判 pass')
  {
    const r = await runScenario({ hasGit: false, detect: { selection: { backendId: 'github', source: 'explicit' } } })
    const out = r.out
    check(!!out && out.ok === true, '链求值成功', JSON.stringify(out && out.error))
    check(!!out && out.backendId === 'github', '这次求值用的后端是 github', String(out && out.backendId))
    check(r.fx.calls.length === 1, '一次求值只开一次只读会话', '开了 ' + r.fx.calls.length + ' 次')
    const openOpts = r.fx.calls[0] && r.fx.calls[0].opts
    check(!!(openOpts && typeof openOpts.resolveSelection === 'function'), '交给探针的会话带着 resolveSelection（沿用这次决定）', JSON.stringify(openOpts))
    check(JSON.stringify(r.fx.selections[0]) === '{"backendId":"github"}', '只交出归一后的 { backendId }，不带判定轨迹', JSON.stringify(r.fx.selections[0]))
    check(!!(r.fx.handles[0] && r.fx.handles[0].backend === 'github'), '环境预检问的是 github 后端', JSON.stringify(r.fx.handles[0]))
    check(r.fx.stats.preflight === 1, '两行共问一次 preflight', 'preflight=' + r.fx.stats.preflight)
    const auth = resolvedOf(out, 'gh:authed')
    check(!!auth && auth.status === 'pass', '「已登录 GitHub」判 pass（不再落兜底 pending）', JSON.stringify(auth))
    check(!!auth && String(auth.detail || '').indexOf('已登录（仓库可达性由下一项判断）') >= 0, '登录行的说明是「已登录（仓库可达性由下一项判断）」', String(auth && auth.detail))
    check(!!(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status === 'done'), '「已登录 GitHub」步骤是绿的（done）', JSON.stringify(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status))
    const access = resolvedOf(out, 'gh:repoAccess')
    check(!!access && access.status === 'fail', '目录里没有仓库时「仓库可访问」保持红（fail）', JSON.stringify(access))
    const remote = resolvedOf(out, 'gh:remote')
    check(!!remote && remote.status === 'fail', '「已关联 GitHub 仓库」保持红（fail）', JSON.stringify(remote))
  }

  title('② 判定层没有结论、调用方给了兜底后端 —— 探针同样必须用这个后端')
  {
    const r = await runScenario({ hasGit: false, detect: { selection: null }, argsBackendId: 'github' })
    const out = r.out
    check(!!out && out.ok === true, '链求值成功', JSON.stringify(out && out.error))
    check(!!out && out.backendId === 'github', '调用方给的 backendId 成为这次求值的后端', String(out && out.backendId))
    const openOpts = r.fx.calls[0] && r.fx.calls[0].opts
    check(!!(openOpts && typeof openOpts.resolveSelection === 'function'), '交给探针的会话带着 resolveSelection', JSON.stringify(openOpts))
    check(JSON.stringify(r.fx.selections[0]) === '{"backendId":"github"}', '交出的选择只有归一后的 backendId', JSON.stringify(r.fx.selections[0]))
    const auth = resolvedOf(out, 'gh:authed')
    check(!!auth && auth.status === 'pass', '「已登录 GitHub」判 pass（判定层无结论时也不落兜底 pending）', JSON.stringify(auth))
    check(!!(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status === 'done'), '「已登录 GitHub」步骤是绿的（done）', JSON.stringify(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status))
  }

  title('③ 目录里补上 .git 与 github 远端后，登录行照样 pass（不比今天差）')
  {
    const r = await runScenario({ hasGit: true, detect: { selection: { backendId: 'github', source: 'auto' } } })
    const out = r.out
    check(!!out && out.ok === true, '链求值成功', JSON.stringify(out && out.error))
    check(r.fx.calls.length === 1, '一次求值只开一次只读会话', '开了 ' + r.fx.calls.length + ' 次')
    check(JSON.stringify(r.fx.selections[0]) === '{"backendId":"github"}', '交给探针的选择仍是归一后的 backendId', JSON.stringify(r.fx.selections[0]))
    const auth = resolvedOf(out, 'gh:authed')
    check(!!auth && auth.status === 'pass', '「已登录 GitHub」仍然 pass（修法不改变已有 .git 工作区的行为）', JSON.stringify(auth))
    check(!!(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status === 'done'), '「已登录 GitHub」步骤是绿的（done）', JSON.stringify(stepOf(out, 'gh:authed') && stepOf(out, 'gh:authed').status))
    // 旧路（不带选择、只给目录）在这个目录里也能靠注册表认出 github —— 证明修法没有依赖「目录里没有 .git」。
    const fallback = await r.fx.openSession(DEMO_CWD)
    check(!!(fallback && fallback.ok === true && fallback.backendId === 'github'), '同一目录只靠注册表也能认出 github（旧路行为未被改坏）', JSON.stringify(fallback))
  }

  title('④ 判定层没结论、调用方也没给后端 —— 一次会话都不开（不许伪造 github 会话）')
  {
    const r = await runScenario({ hasGit: false, detect: { selection: null } })
    const out = r.out
    check(!!out && out.ok === true, '链求值成功（保持改动前的行为）', JSON.stringify(out && out.error))
    check(!!out && out.backendId === null, '这次求值没有后端', String(out && out.backendId))
    check(r.fx.calls.length === 0, '没有开任何只读会话', '开了 ' + r.fx.calls.length + ' 次')
    check(r.fx.stats.opened === 0, '也没有问过 preflight / 登录名', JSON.stringify(r.fx.stats))
    check(!out || !out.backendChain, '没有按 github 拼出后端链', JSON.stringify(out && out.backendChain && out.backendChain.chain && out.backendChain.chain.length))
  }

  title('⑤ 交给会话的选择只有归一后的 { backendId }：判定带着 multiHit / pending 也不整份递下去')
  {
    const r = await runScenario({
      hasGit: false,
      detect: { selection: { backendId: 'github', source: 'auto', multiHit: ['github', 'markdown'], pending: true } },
    })
    const out = r.out
    check(JSON.stringify(r.fx.selections[0]) === '{"backendId":"github"}', 'multiHit / pending 不随选择递给会话（整份结论会让会话入口按有歧义处理，开不出会话）', JSON.stringify(r.fx.selections[0]))
    const auth = resolvedOf(out, 'gh:authed')
    check(!!auth && auth.status === 'pass', '「已登录 GitHub」判 pass', JSON.stringify(auth))
  }

  title('⑥ 对照：换回「只给 cwd」的旧接线时，同样的场景落回 stage=none 与兜底 pending')
  {
    // 这条是对照：它不走生产接线，只演示「只给 cwd」在同一现场会落回兜底 pending；
    // 生产接线是否真的把选择交下去，由 ① 的 resolveSelection / selections 断言钉住。
    const fx = makeFixture({ hasGit: false })
    const oldOpenOnlyCwd = function (cwd: string) { return fx.openSession(cwd) }
    const probe = probeChainEnv({ getRepoKey: async function () { return null }, openSession: oldOpenOnlyCwd }, DEMO_CWD, { backendId: 'github' })
    const reply = await probe.preflightOnce()
    check(reply.stage === 'none', '只给 cwd 时探针拿不到会话（stage=none）', JSON.stringify(reply))
    const verdict = ghAuthVerdict(reply, true)
    check(verdict.status === 'pending' && String(verdict.detail || '').indexOf('读会话还没接上') >= 0, '登录行落回「读会话还没接上」兜底 pending', JSON.stringify(verdict))
  }

  title('⑦ 低置信线索（正文提及）不再是「明确选定」：链上按已选的后端求值，通过说明写 backend:github')
  {
    // 方案 A（#1572 收尾）：说明文件里只有正文提及、没有标题行时，判定层不再把它当结论，
    // 所以探测结果里 selection 为空、只留 parsed 的低置信证据；链按调用方给的 backendId 求值，
    // 「已选后端」这一项通过，但通过说明写 backend:github —— 它不是显式声明。
    const r = await runScenario({
      hasGit: false,
      argsBackendId: 'github',
      detect: {
        selection: null,
        explicit: { parsed: { explicitBackendId: 'github', confidence: 'low', reason: 'keyword-github' } },
      },
    })
    const out = r.out
    check(!!out && out.ok === true, '链求值成功', JSON.stringify(out && out.error))
    check(!!out && out.backendId === 'github', '按调用方给的后端求值（低置信线索不产结论）', String(out && out.backendId))
    const gate = (out && out.resolved && out.resolved['selection:backendSelected']) || null
    check(!!gate && gate.status === 'pass', '「已选后端」这一项照常通过', JSON.stringify(gate))
    check(!!gate && String(gate.detail || '') === 'backend:github', '通过说明写 backend:github（后端存在，不是显式声明）', String(gate && gate.detail))
    check(!!gate && String(gate.detail || '').indexOf('explicit:') < 0, '通过说明不带 explicit: 前缀（不把正文提及说成明确选定）', String(gate && gate.detail))
  }

  console.log('\nverify-1505-chain-env-selection: ' + (failed ? '有失败项' : '全部通过') + '（共 ' + total + ' 条断言）')
  if (failed) process.exit(1)
  console.log('CHAIN ENV SELECTION OK')
}

main().catch(function (e) {
  console.log('  FAIL 门禁抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
