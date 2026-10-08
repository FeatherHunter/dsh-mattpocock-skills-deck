// tests/verify-934-935-invariants.js —— 两条不变式回归门禁（933 图收敛验收 · 934 钥匙 / 935 许可）
// 用法：在插件根目录执行 node tests/verify-934-935-invariants.js，可独立运行。
//
// 这一条盯四件事，都是 930 缺陷 A/B 的不变式形态：
//   I1 两写法同键同绑定：同一条目录用大小写与斜杠不同的两种写法，各查一次，归一后同根、同闸钥匙、命中同一份显式绑定，显式选 markdown 即回 markdown。
//   I2 双斜杠同仓：连续斜杠与尾斜杠不同的写法归一后同仓（注册表只做系统无关洗，宿主出口做全量归一）。
//   I3 缺席归一即失败：归一出口在场却算不出规范根时，工具如实失败，不拿原始目录凑一把钥匙。
//   I4 无许可写工作区必拒且文案诚实：缺许可与真不可写分两档，前者说清没有拿到写许可，后者说清带上了许可仍被拒；探针无许可时判灰说量不出。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 500) : ''))); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function makeFs() {
  return {
    async resolve(p) { return String(p).replace(/\\/g, '/') },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
    async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
    async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
  }
}

async function main() {
  console.log('两条不变式回归门禁（934 钥匙单源与显式优先 / 935 许可透传）')

  const shellMod = await imp('src/shared/deck-tools/shell.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const shapeMod = await imp('src/host/tracker/registryShape.js')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule

  // —— I2 先行：注册表只做系统无关洗（斜杠与尾斜杠归一，大小写不动） ——
  {
    const a = shapeMod.washHandleKey('D:\\Temp\\demo\\')
    const b = shapeMod.washHandleKey('D:/Temp/demo')
    check(a === b, 'I2 双斜杠与尾斜杠同仓（系统无关洗）：' + a + ' === ' + b, a + ' vs ' + b)
    const c = shapeMod.washHandleKey('D:/Temp//demo//sub//')
    const d = shapeMod.washHandleKey('D:/Temp/demo/sub')
    check(c === d, 'I2 连续斜杠同仓：' + c + ' === ' + d, c + ' vs ' + d)
    const lower = shapeMod.washHandleKey('d:/temp/demo')
    const upper = shapeMod.washHandleKey('D:/Temp/Demo')
    check(lower !== upper, 'I2 大小写不由注册表洗（留给宿主出口）：' + lower + ' !== ' + upper, lower + ' vs ' + upper)
  }

  // —— 宿主归一出口（测试替身：小写折叠加斜杠归一加锚根直通；与生产同形，大小写必须归一） ——
  const canonicalKey = async (raw) => {
    let s = String(raw == null ? '' : raw).trim()
    if (!s) return ''
    s = s.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
    while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
    return s
  }
  const workspaceKeyOf = (root) => {
    let h = 5381
    const t = String(root || '')
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  }

  // —— I1：两写法同键同绑定，显式选 markdown 即回 markdown ——
  {
    const rawA = 'D:\\Temp\\demo-ws'
    const rawB = 'd:/temp/demo-ws/'
    const execA = { agent: { session: { id: 's-i1', cwd: rawA } } }
    const execB = { agent: { session: { id: 's-i1', cwd: rawB } } }
    const sessMod = await imp('src/shared/deck-tools/session-resolve.js')
    const sA = await sessMod.sessionContextOfAsync(execA, { canonicalKey, workspaceKeyOf })
    const sB = await sessMod.sessionContextOfAsync(execB, { canonicalKey, workspaceKeyOf })
    check(sA.ok && sB.ok, 'I1 两种写法都归一成功', JSON.stringify({ sA, sB }).slice(0, 300))
    check(sA.cwd === sB.cwd, 'I1 两写法同根：' + sA.cwd + ' === ' + sB.cwd, sA.cwd + ' vs ' + sB.cwd)
    check(sA.workspaceKey === sB.workspaceKey, 'I1 两写法同闸钥匙：' + sA.workspaceKey, sA.workspaceKey + ' vs ' + sB.workspaceKey)

    const fss = makeFs()
    const plat = { path: path.posix, fs: fss }
    const fakeCtx = { platform: plat, fs: fss, get(name) { return name === 'fs' ? fss : undefined } }
    const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, fakeCtx), { matchesTimeout: 200 })
    registry.register(markdownModule)
    registry.bind({ cwd: sA.cwd }, 'markdown')
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    const gate = gateMod.createGate({ ledger, now: () => 1700000000000 })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
    const shellA = shellMod.createDeckShell({ gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: fakeCtx, canonicalKey, workspaceKeyOf })
    const shellB = shellMod.createDeckShell({ gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: fakeCtx, canonicalKey, workspaceKeyOf })
    const pickA = await shellA.pickBackend(execA, sA)
    // 第二路用原始写法进，但上下文已归一，显式必须命中
    const pickB = await shellB.pickBackend(execB, sB)
    check(pickA.ok && pickA.backendId === 'markdown' && pickA.source === 'explicit', 'I1 写法 A 命中显式 markdown', JSON.stringify(pickA).slice(0, 300))
    check(pickB.ok && pickB.backendId === 'markdown' && pickB.source === 'explicit', 'I1 写法 B 同样命中显式 markdown（显式优先硬要求）', JSON.stringify(pickB).slice(0, 300))
  }

  // —— I1b：多命中无显式即冲突，不静默挑注册序第一个 ——
  {
    const fakeCtx = { platform: { path: path.posix, fs: makeFs() }, fs: makeFs(), get(name) { return undefined } }
    const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, fakeCtx), { matchesTimeout: 200 })
    registry.register({ id: 'b1', label: 'B1', create: () => ({}), matches: async () => true })
    registry.register({ id: 'b2', label: 'B2', create: () => ({}), matches: async () => true })
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    const gate = gateMod.createGate({ ledger, now: () => 1700000000000 })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
    const shell = shellMod.createDeckShell({ gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: fakeCtx, canonicalKey: async (x) => String(x), workspaceKeyOf })
    const s = { cwd: '/ws-multi', workspaceKey: 'deadbeef', sessionId: 's-m' }
    const pick = await shell.pickBackend({}, s)
    check(!pick.ok, 'I1b 多命中无显式即冲突（不回注册序第一个）', JSON.stringify(pick).slice(0, 300))
  }

  // —— I3：缺席归一即失败 ——
  {
    const badCanonical = async () => ''
    const exec = { agent: { session: { id: 's-i3', cwd: 'D:\\Temp\\demo-ws' } } }
    const sessMod2 = await imp('src/shared/deck-tools/session-resolve.js')
    const s = await sessMod2.sessionContextOfAsync(exec, { canonicalKey: badCanonical, workspaceKeyOf })
    check(!s.ok, 'I3 归一出口算不出规范根时如实失败（不凑钥匙）', JSON.stringify(s).slice(0, 300))
    const throwing = async () => { throw new Error('no-fs') }
    const s2 = await sessMod2.sessionContextOfAsync(exec, { canonicalKey: throwing, workspaceKeyOf })
    check(!s2.ok, 'I3 归一抛错同样如实失败', JSON.stringify(s2).slice(0, 300))
  }

  // —— I4：无许可写工作区必拒且文案诚实（两档） ——
  {
    const writeMod = await imp('src/host/tracker/backends/markdown/write.js')
    const denyFs = {
      async resolve(p) { return String(p) },
      async writeText() { throw new Error('cannot write \"/ws/x\": file access denied under workspace-write mode') },
    }
    const ctxNoPolicy = { platform: { path: path.posix }, fs: denyFs }
    let errNoPolicy = null
    try { await writeMod.writeTextFile(ctxNoPolicy, '/ws/x.md', 'hi', undefined) } catch (e) { errNoPolicy = e }
    check(!!errNoPolicy && errNoPolicy.kind === 'env', 'I4 缺许可写被拒（env 档）', String((errNoPolicy && errNoPolicy.message) || errNoPolicy).slice(0, 200))
    check(/没有拿到.*写许可/.test(String((errNoPolicy && errNoPolicy.message) || '')), 'I4 缺许可文案说清没有拿到写许可', String((errNoPolicy && errNoPolicy.message) || '').slice(0, 300))
    const ctxWithPolicy = { platform: { path: path.posix }, fs: denyFs, sandboxPolicy: { test: 1 } }
    let errWithPolicy = null
    try { await writeMod.writeTextFile(ctxWithPolicy, '/ws/x.md', 'hi', { test: 1 }) } catch (e) { errWithPolicy = e }
    check(!!errWithPolicy && errWithPolicy.kind === 'env', 'I4 有许可仍被拒同样 env 档', String((errWithPolicy && errWithPolicy.message) || '').slice(0, 200))
    check(/带上了.*仍然拒绝/.test(String((errWithPolicy && errWithPolicy.message) || '')), 'I4 有许可文案说清带上了许可仍被拒（与缺许可不同档）', String((errWithPolicy && errWithPolicy.message) || '').slice(0, 300))
  }

  // —— I4b：探针透传许可（有许可按许可量，无许可判灰说量不出） ——
  {
    const { createPredicateRegistry } = await imp('src/host/tracker/predicateCore.js')
    let seenPolicy = 'unset'
    const okFs = {
      async resolve(p, o) { return (o && o.cwd ? o.cwd + '/' + p : p) },
      async writeText(t, c, a3, a4, policy) { seenPolicy = policy; },
      async unlink() {},
    }
    const okPlat = { path: { join: (...a) => a.join('/') }, env: { get: () => undefined }, fs: okFs }
    const reg = createPredicateRegistry({ timeout: 2000 })
    const chain = [{ id: 'md:scratchWritable', check: { kind: 'primitive', primitive: 'dirWritable', path: '.scratch' } }]
    await reg.resolveAll(chain, { platform: okPlat, backendId: 'markdown', cwd: '/ws', sandboxPolicy: { p: 1 } })
    check(seenPolicy && seenPolicy.p === 1, 'I4b 写探测把本次调用的许可透传给文件服务', JSON.stringify(seenPolicy).slice(0, 200))
    // 无许可时沙箱拒因诚实判灰
    const denyFs2 = {
      async resolve(p, o) { return (o && o.cwd ? o.cwd + '/' + p : p) },
      async writeText() { throw new Error('file access denied under workspace-write mode') },
      async exists() { return true },
      async listDir() { return [] },
    }
    const denyPlat = { path: { join: (...a) => a.join('/') }, env: { get: () => undefined }, fs: denyFs2 }
    const reg2 = createPredicateRegistry({ timeout: 2000 })
    const r = await reg2.resolveAll(chain, { platform: denyPlat, backendId: 'markdown', cwd: '/ws', lang: 'zh' })
    const one = r['md:scratchWritable']
    check(one && one.status === 'pending', 'I4b 无许可量不出时判灰（不谎报目录不可写）', one && one.detail)
    check(/沙箱/.test((one && one.detail) || '') && !/目录不可写/.test((one && one.detail) || ''), 'I4b 灰文案讲清沙箱、不写目录不可写', one && one.detail)
  }

  console.log('\n' + (failed ? '有失败 — 两条不变式门禁未通过（' + total + ' 条）' : '全部通过 — 两条不变式成立（' + total + ' 条）'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.message) || e)); process.exitCode = 1 })
