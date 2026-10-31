#!/usr/bin/env node
/**
 * 门禁：企业版（GHES）运行时能力回答（#1698 企业版部分）。
 *
 * 守的东西（票 #1698「企业版」与规格 #1681 第 24 条）：
 * ① 读操作遇到企业版主机（GH_HOST 指向非 github.com，或失败文案里认出企业版）时，先探测服务端版本
 *    （gh api meta 的 installed_version），再按运行时事实回答支持 / 部分支持 / 不支持，带原因与能力票号；
 * ② 不读静态能力表冒充运行时事实：回答来自这次探测，source 恒为 'runtime-probe'；
 * ③ github.com 不探测（零请求），也不挂能力回答；
 * ④ 探测失败就不回答（不许回答「支持」），调用成功时不挂「不支持」（调用即知优先）；
 * ⑤ 子票与依赖两条读操作的失败信封真的带上了回答（不是只写了函数没人调）。
 *
 * 负例（每条都有一条能红的断言）：
 * - 探测失败（meta 500）时不得回答 supported（C6）；
 * - 调用成功时不得挂 unsupported（E3）；
 * - github.com 不得为了回答去多发一次探测请求（D1）；
 * - 运行时代码不得 import 静态能力表（G1）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-ghes-runtime-capability.ts
 */
// 门禁归属: src/tracker/rooms/github/routing/runtime-capability.ts
// 门禁归属: src/tracker/rooms/github/read/sub-issues.ts
// 门禁归属: src/tracker/rooms/github/read/deps-read.ts

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import * as cap from '../src/tracker/rooms/github/routing/runtime-capability.ts'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'

const GATE = 'verify-ghes-runtime-capability'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = { refId: 'o/r', name: 'o/r' }
const GHE_STDERR = 'Post "https://ghe.corp.example/api/graphql": GitHub Enterprise Server 3.18 does not support this query'
const EOF_STDERR = 'Post "https://api.github.com/graphql": unexpected EOF'

let total = 0
let failed = 0
function check (cond: any, msg: string, detail?: any): void {
  total += 1
  if (cond) console.log('PASS ' + msg)
  else { failed += 1; console.log('FAIL ' + msg + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）')) }
}

/**
 * 造一个只够跑 gh 客户端与读操作的上下文：platform.resolveExecutable 给出 gh、
 * platform.env 当 GH_HOST 的读数口、exec 按参数分派（graphql / api meta / 其余失败）。
 * 每笔出站都记进 calls，断言据此数「有没有多打探测请求」。
 */
function makeCtx (opts: any): any {
  const o = opts || {}
  const calls: any[] = []
  const env: any = Object.assign({}, o.env)
  return {
    calls: calls,
    ctx: {
      cwd: 'C:\\ws\\demo',
      outbound: createOutboundControl(),
      platform: {
        resolveExecutable: async (name: string) => name === 'gh' ? 'gh' : null,
        env: { get: (n: string) => env[n] || '' },
      },
      exec: async function (cmd: any, args: any, eo: any) {
        const joined = (args || []).join(' ')
        calls.push({ joined: joined, via: eo && eo.via })
        if (joined === 'api meta') return typeof o.meta === 'function' ? o.meta() : { code: 1, stdout: '', stderr: 'meta 不可用' }
        if (joined.indexOf('graphql') >= 0) {
          const stderr = typeof o.graphqlStderr === 'string' ? o.graphqlStderr : GHE_STDERR
          return stderr ? { code: 1, stdout: '', stderr: stderr } : { code: 0, stdout: JSON.stringify({ data: {} }), stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined }
      },
    },
  }
}

function ghesMeta (version: string): any {
  return function (): any { return { code: 0, stdout: JSON.stringify({ installed_version: version, verifiable_password_authentication: true }), stderr: '' } }
}

// ────────────────────────────── A 识别企业版主机 ──────────────────────────────
{
  check(cap.looksEnterprise(makeCtx({ env: { GH_HOST: 'github.com' } }).ctx, '') === false, 'A1 GH_HOST=github.com 不算企业版（零探测）', cap.looksEnterprise(makeCtx({ env: { GH_HOST: 'github.com' } }).ctx, ''))
  check(cap.looksEnterprise(makeCtx({ env: { GH_HOST: 'ghe.corp.example' } }).ctx, '') === true, 'A2 GH_HOST 指向企业版主机算企业版')
  check(cap.looksEnterprise(makeCtx({}).ctx, 'GitHub Enterprise Server 3.18 does not support this query') === true, 'A3 失败文案里认出企业版也算（GH_HOST 没设时）')
  check(cap.looksEnterprise(makeCtx({}).ctx, EOF_STDERR) === false, 'A4 普通网络失败不算企业版（不误探测）')
  check(cap.looksEnterprise(makeCtx({ env: { GH_ENTERPRISE_TOKEN: 'x' } }).ctx, '') === true, 'A5 配了 GH_ENTERPRISE_TOKEN 也算企业版（环境本身就是企业版口径）')
}

// ────────────────────────────── B 探测服务端版本 ──────────────────────────────
{
  const g1 = makeCtx({ meta: ghesMeta('3.18.4') })
  const p1 = await cap.probeRuntimeServer(g1.ctx)
  check(p1 && p1.ok === true && p1.hostKind === 'ghes' && p1.serverVersion === '3.18.4', 'B1 meta 回 installed_version → 认出企业版并带回版本原文', p1)
  check(p1 && typeof p1.probedAtMs === 'number' && p1.probedAtMs > 0, 'B2 探测记下时刻（回答里带时间）', p1 && p1.probedAtMs)

  const g2 = makeCtx({ meta: () => ({ code: 0, stdout: JSON.stringify({ verifiable_password_authentication: true }), stderr: '' }) })
  const p2 = await cap.probeRuntimeServer(g2.ctx)
  check(p2 && p2.ok === true && p2.hostKind === 'github.com' && p2.serverVersion === null, 'B3 meta 没有 installed_version → 认出 github.com', p2)

  const g3 = makeCtx({ meta: () => ({ code: 0, stdout: 'not json', stderr: '' }) })
  const p3 = await cap.probeRuntimeServer(g3.ctx)
  check(p3 && p3.ok === false && p3.hostKind === 'unknown', 'B4 meta 回坏形状 → 探测失败、主机未知（不猜）', p3)

  const g4 = makeCtx({ meta: () => ({ code: 1, stdout: '', stderr: 'HTTP 500' }) })
  const p4 = await cap.probeRuntimeServer(g4.ctx)
  check(p4 && p4.ok === false && p4.hostKind === 'unknown' && !!p4.reason, 'B5 meta 请求失败 → 探测失败且带原因', p4)

  // 注：ghClient 把 via 只用于日志与静态登记（tests/verify-github-gh-via.ts 扫源码字面量），
  //   不把它交给 ctx.exec，所以这里只断言「探测请求就是 api meta 这一条」，via 由静态门禁守。
  const probeCall = g1.calls.filter((c: any) => c.joined === 'api meta')
  check(probeCall.length === 1, 'B6 探测请求是 api meta（不是别的命令，也不多发）', probeCall)
}

// ────────────────────────────── C 按探测事实回答支持程度 ──────────────────────────────
{
  const ghes318 = { ok: true, hostKind: 'ghes', serverVersion: '3.18.4', probedAtMs: 111, reason: '' }
  const ghes320 = { ok: true, hostKind: 'ghes', serverVersion: '3.20.1', probedAtMs: 222, reason: '' }
  const dotcom = { ok: true, hostKind: 'github.com', serverVersion: null, probedAtMs: 333, reason: '' }
  const failedProbe = { ok: false, hostKind: 'unknown', serverVersion: null, probedAtMs: 444, reason: 'meta 不可用' }

  const a1 = cap.runtimeCapabilityAnswerFor('listSubIssues', ghes318)
  check(a1 && a1.support === 'unsupported' && a1.operation === 'listSubIssues' && a1.ticket === '#1681', 'C1 企业版 3.18 上的子票回答「不支持」并带能力票号', a1)
  check(a1 && a1.hostKind === 'ghes' && a1.serverVersion === '3.18.4' && a1.source === 'runtime-probe', 'C2 回答带主机、版本与来源（运行时探测）', a1)
  check(a1 && typeof a1.reason === 'string' && a1.reason.indexOf('子票') >= 0, 'C3 不支持的理由说清是哪件事（子票接口）', a1 && a1.reason)

  const a2 = cap.runtimeCapabilityAnswerFor('getDependencies', ghes318)
  check(a2 && a2.support === 'unsupported', 'C4 企业版 3.18 上的依赖回答「不支持」（3.19 才有端点）', a2)
  const a3 = cap.runtimeCapabilityAnswerFor('getDependencies', ghes320)
  check(a3 && a3.support === 'partial', 'C5 企业版 3.20 上的依赖回答「部分支持」（版本够、GraphQL 主路不一定）', a3)
  check(cap.runtimeCapabilityAnswerFor('listSubIssues', ghes320).support === 'unsupported', 'C6 子票在企业版任何版本都不支持（3.20 也一样）', cap.runtimeCapabilityAnswerFor('listSubIssues', ghes320))
  check(cap.runtimeCapabilityAnswerFor('listSubIssues', dotcom).support === 'supported', 'C7 github.com 上回答「支持」', cap.runtimeCapabilityAnswerFor('listSubIssues', dotcom))
  check(cap.runtimeCapabilityAnswerFor('listSubIssues', failedProbe) === null, 'C8 探测失败就不回答（负例：不得回答支持）', cap.runtimeCapabilityAnswerFor('listSubIssues', failedProbe))
}

// ────────────────────────────── D 什么时候探测（github.com 零请求） ──────────────────────────────
{
  const dotcom = makeCtx({ env: { GH_HOST: 'github.com' }, meta: ghesMeta('3.18.4') })
  const d1 = await cap.runtimeCapabilityFor('listSubIssues', dotcom.ctx, EOF_STDERR)
  check(d1 === null, 'D1 github.com 上不回答能力（不需要知道企业版能力）', d1)
  check(dotcom.calls.length === 0, 'D2 github.com 上零探测请求（不为回答多打一次）', dotcom.calls)

  const ghe = makeCtx({ env: { GH_HOST: 'ghe.corp.example' }, meta: ghesMeta('3.18.4') })
  const d2 = await cap.runtimeCapabilityFor('listSubIssues', ghe.ctx, '')
  check(d2 && d2.support === 'unsupported' && d2.hostKind === 'ghes', 'D3 企业版主机上探测后回答', d2)
  check(ghe.calls.length === 1, 'D4 企业版上只多打一次探测请求（实得 ' + ghe.calls.length + ' 条）', ghe.calls)

  const noHost = makeCtx({ meta: ghesMeta('3.18.4') })
  const d3 = await cap.runtimeCapabilityFor('listSubIssues', noHost.ctx, GHE_STDERR)
  check(d3 && d3.support === 'unsupported', 'D5 GH_HOST 没设但失败文案认出企业版 → 照样探测并回答', d3)
}

// ────────────────────────────── E 回答怎么挂到信封上 ──────────────────────────────
{
  const failEnvelope = { ok: false, error: { kind: 'network', message: '子票取数失败', raw: '' } }
  const ans = { operation: 'listSubIssues', support: 'unsupported', reason: '企业版没有子票接口', ticket: '#1681', hostKind: 'ghes', serverVersion: '3.18.4', probedAtMs: 1, source: 'runtime-probe' }
  const e0 = cap.attachRuntimeAnswer(failEnvelope, null)
  check(e0 === failEnvelope, 'E1 没有回答时信封原样返回（同一引用）', e0)
  const e1 = cap.attachRuntimeAnswer(failEnvelope, ans)
  check(e1 && e1.runtimeCapability && e1.runtimeCapability.support === 'unsupported', 'E2 失败信封挂上运行时能力回答', e1 && e1.runtimeCapability)
  const okEnvelope = { ok: true, data: { items: [] } }
  check(cap.attachRuntimeAnswer(okEnvelope, ans) === okEnvelope, 'E3 调用成功时不挂「不支持」（负例：调用即知优先）', cap.attachRuntimeAnswer(okEnvelope, ans))
  const partialAns = Object.assign({}, ans, { support: 'partial' })
  const e3 = cap.attachRuntimeAnswer(okEnvelope, partialAns)
  check(e3 && e3.runtimeCapability && e3.runtimeCapability.support === 'partial', 'E4 调用成功但只能部分支持时如实挂上', e3 && e3.runtimeCapability)
}

// ────────────────────────────── F 真接线：子票与依赖两条读操作 ──────────────────────────────
{
  // F1 企业版 + GraphQL 失败 → 子票失败信封带上「不支持」回答。
  const g1 = makeCtx({ env: { GH_HOST: 'ghe.corp.example' }, meta: ghesMeta('3.18.4') })
  const { listSubIssues } = await import('../src/tracker/rooms/github/read/sub-issues.ts')
  const r1: any = await listSubIssues(REPO, '7', {}, g1.ctx)
  check(r1 && r1.ok === false, 'F1 企业版上子票读失败（GraphQL 不可用）', r1 && r1.error)
  check(r1 && r1.runtimeCapability && r1.runtimeCapability.support === 'unsupported' && r1.runtimeCapability.operation === 'listSubIssues', 'F2 失败信封真的带上了子票的运行时能力回答', r1 && r1.runtimeCapability)
  check(r1 && r1.runtimeCapability && r1.runtimeCapability.hostKind === 'ghes' && r1.runtimeCapability.serverVersion === '3.18.4', 'F3 回答里的主机与版本来自这次探测', r1 && r1.runtimeCapability)
  // 子票那一页失败会按既有规矩原样重试一次（via subIssues.retry），所以 GraphQL 那两条不算多；
  //   这里只数「多出来的探测请求」：有且只有一条 api meta。
  const f1meta = g1.calls.filter((c: any) => c.joined === 'api meta')
  check(f1meta.length === 1, 'F4 这一趟只多一次探测请求（实得 ' + f1meta.length + ' 条）', g1.calls.map((c: any) => c.joined.slice(0, 40)))

  // F5 github.com 上子票失败不探测、不挂回答。
  const g2 = makeCtx({ env: { GH_HOST: 'github.com' }, graphqlStderr: EOF_STDERR })
  const r2: any = await listSubIssues(REPO, '7', {}, g2.ctx)
  check(r2 && r2.ok === false && !r2.runtimeCapability, 'F5 github.com 上失败不挂能力回答', r2 && r2.runtimeCapability)
  check(g2.calls.filter((c: any) => c.joined === 'api meta').length === 0, 'F6 github.com 上零探测请求（实得 ' + g2.calls.length + ' 条其它请求）', g2.calls.map((c: any) => c.joined.slice(0, 40)))

  // F7 探测失败时子票失败信封不挂回答（负例：不得回答支持）。
  const g3 = makeCtx({ env: { GH_HOST: 'ghe.corp.example' }, meta: () => ({ code: 1, stdout: '', stderr: 'HTTP 500' }) })
  const r3: any = await listSubIssues(REPO, '7', {}, g3.ctx)
  check(r3 && r3.ok === false && !r3.runtimeCapability, 'F7 探测失败时不挂能力回答（负例：不得回答支持）', r3 && r3.runtimeCapability)

  // F8 依赖读操作同样接线：企业版上失败信封带上「不支持」。
  const g4 = makeCtx({ env: { GH_HOST: 'ghe.corp.example' }, meta: ghesMeta('3.18.4') })
  const { getDependencies } = await import('../src/tracker/rooms/github/read/deps-read.ts')
  const r4: any = await getDependencies(REPO, '7', {}, g4.ctx)
  check(r4 && r4.runtimeCapability && r4.runtimeCapability.operation === 'getDependencies', 'F8 依赖读失败信封也带上运行时能力回答', r4 && r4.runtimeCapability)
  check(r4 && r4.runtimeCapability && r4.runtimeCapability.support === 'unsupported', 'F9 企业版 3.18 上的依赖回答「不支持」', r4 && r4.runtimeCapability)
}

// ────────────────────────────── G 静态：不读静态能力表 ──────────────────────────────
{
  const runtime = readFileSync(resolve(ROOT, 'src/tracker/rooms/github/routing/runtime-capability.ts'), 'utf8')
  check(runtime.indexOf('capability-register') < 0 && runtime.indexOf('capability-answer') < 0, 'G1 运行时能力回答不 import 静态能力表（不拿构建期表冒充运行时事实）', 'capability-')
  const subIssues = readFileSync(resolve(ROOT, 'src/tracker/rooms/github/read/sub-issues.ts'), 'utf8')
  const depsRead = readFileSync(resolve(ROOT, 'src/tracker/rooms/github/read/deps-read.ts'), 'utf8')
  check(subIssues.indexOf('runtime-capability') >= 0 && depsRead.indexOf('runtime-capability') >= 0, 'G2 子票与依赖两条读操作都接上了运行时能力回答', [subIssues.indexOf('runtime-capability') >= 0, depsRead.indexOf('runtime-capability') >= 0])
}

console.log('')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
