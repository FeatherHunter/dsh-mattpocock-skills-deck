#!/usr/bin/env node
/**
 * verify-968-skill-ondemand.js —— 技能按需门禁（票 #968，地图 #963）。
 *
 * 治的是什么：此前每一次探测都把二十多项技能从头串行问一遍，没有短时记住问到的结果，
 * 技能变化广播一来就把整机缓存全清掉，同时问同一项的人各问各的。改完后：检查链条上
 * 只问链条目录里要的三项，二十多项全量只在人亲手重查时问；问到的结果短时记住半分钟，
 * 问不到与没问出来的不记；广播只清出事的那个工作区的桶；同时问同一项的人共用同一份回答。
 *
 * 覆盖（按票面验收逐条）：
 *   A. 平时只问 3 项：链目录里的技能检查恰为三项；探测按 force 分流，非重查只问三项。
 *   B. 全量只在重查时问 N 项：force 重查问全量（与技能名单单源一致），平时不问。
 *   C. 刚装好技能后重查立即可见：重查绕过短时缓存，问到的新结果立刻返回。
 *   D. 查到的短时缓存，查不到与没查出来不存：绿记、红与等待不记，过期后重问。
 *   E. 广播按工作区分桶清：带工作区只清那一桶，不带才全清。
 *   F. 并发同键复用同一份：同时问同一项只产生一次真实查询，并记一行复用日志。
 *   G. 日志纪律：不新增事件名，字段只用白名单（命中记已有 skill.probe，复用记已有 dedup.hit）。
 *
 * 测法：真跑 createSkillProbe（计数注册表查询次数）、真跑 detectionService 接真 platformChannel
 * 闭包（计数实际问了哪些技能名）；不断言内部 Map 形状，只看外部行为。
 *
 * 用法：node tests/verify-968-skill-ondemand.js（在插件根目录执行）
 */
const fsx = require('fs')
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

// 链条要的三项（字面期望，真源是 src/shared/tracker/check-catalog-views.js 的链目录）。
const CHAIN_THREE = ['wayfinder', 'setup-matt-pocock-skills', 'ask-matt']

function makePlatform(homeDir) {
  return {
    os: 'linux',
    path: nodePath,
    async getHome() { return homeDir },
    async resolveExecutable() { return null },
    env: { get: () => undefined, has: () => false },
    fs: null,
  }
}
function makeCtx(skillsMock, platform) {
  return {
    get(k) {
      if (k === 'skills') return skillsMock
      if (k === 'fs') return null
      if (k === 'platform') return platform
      return undefined
    },
    effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch { return () => {} } },
    set: () => {},
  }
}
function makeLogSpy(enabled = true) {
  const rows = []
  return {
    rows,
    ctx: {
      isEnabled: () => enabled === true,
      fire: (level, event, fieldsOrFn) => {
        let fields = fieldsOrFn
        try { if (typeof fieldsOrFn === 'function') fields = fieldsOrFn() } catch { fields = {} }
        rows.push({ level, event, fields: fields || {} })
      },
    },
  }
}

async function main() {
  const probeMod = await import(url('src/host/skillProbe.js'))
  const createSkillProbe = probeMod.createSkillProbe
  must(typeof createSkillProbe === 'function', '技能探测工厂可导入')

  title('— A. 链条要的三项钉住 —')
  {
    const views = await import(url('src/shared/tracker/check-catalog-views.js'))
    const items = (views && views.GENERIC_CHECK_ITEMS) || []
    const skillIds = items.filter((it) => it && it.check && typeof it.check.skill === 'string').map((it) => it.check.skill).sort()
    must(JSON.stringify(skillIds) === JSON.stringify([...CHAIN_THREE].sort()), '链目录里的技能检查恰为三项', skillIds.join(','))
  }

  title('— B/C. 重查问全量、平时问三项、重查绕过缓存 —')
  {
    // 注册表里始终有货：probeSkill 走注册表命中通道，不碰磁盘。
    let underlying = 0
    const home = nodeOs.tmpdir()
    const platform = makePlatform(home)
    const skillsMock = {
      async get(name) { underlying++; return { name, path: nodePath.join(home, '.agents', 'skills', name) } },
    }
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: null,
    })
    must(typeof probe.invalidateSkillProbeCaches === 'function', '失效广播收口对外可调用（含工作区分桶）')
    const r1 = await probe.probeSkill('wayfinder', 'zh', 'CWD-A')
    must(r1 && r1.level === 'ok', '首次探测命中为绿')
    must(underlying === 1, '首次探测真实问了一次', 'underlying=' + underlying)
    const r2 = await probe.probeSkill('wayfinder', 'zh', 'CWD-A')
    must(r2 && r2.level === 'ok', '第二次同键命中仍为绿（短时缓存）')
    must(underlying === 1, '第二次同键命中不再问注册表', 'underlying=' + underlying)
    const r3 = await probe.probeSkill('wayfinder', 'zh', 'CWD-A', { force: true })
    must(r3 && r3.level === 'ok', '重查绕过缓存仍为绿（新装技能立即可见）')
    must(underlying === 2, '重查真实再问了一次', 'underlying=' + underlying)
  }

  title('— D. 查不到与没查出来不记缓存 —')
  {
    // 查不到：注册表永远说没有，磁盘上也没有。
    let missCalls = 0
    const emptyHome = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), '968-miss-'))
    const platform = makePlatform(emptyHome)
    const skillsMock = { async get() { missCalls++; return null } }
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: null,
    })
    const b1 = await probe.probeSkill('wayfinder', 'zh', 'CWD-MISS')
    must(b1 && b1.level === 'bad', '缺失判红')
    const b2 = await probe.probeSkill('wayfinder', 'zh', 'CWD-MISS')
    must(b2 && b2.level === 'bad', '再次问仍为红')
    must(missCalls === 2, '查不到不记缓存，每次都真实再问', 'missCalls=' + missCalls)
    fsx.rmSync(emptyHome, { recursive: true, force: true })
  }
  {
    // 没查出来：技能服务直接报错（等待态），不记缓存。
    let pendingCalls = 0
    const platform = makePlatform(nodeOs.tmpdir())
    const skillsMock = { async get() { pendingCalls++; throw new Error('skills service down for test') } }
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: null,
    })
    const p1 = await probe.probeSkill('wayfinder', 'zh', 'CWD-P')
    const p2 = await probe.probeSkill('wayfinder', 'zh', 'CWD-P')
    must(p1 && p1.level === 'pending' && p2 && p2.level === 'pending', '服务不可用时两次均为等待')
    must(pendingCalls === 2, '没查出来不记缓存', 'pendingCalls=' + pendingCalls)
  }
  {
    // 过期后重问：短超时注入，只看行为。
    let ttlCalls = 0
    const home = nodeOs.tmpdir()
    const platform = makePlatform(home)
    const skillsMock = {
      async get(name) { ttlCalls++; return { name, path: nodePath.join(home, '.agents', 'skills', name) } },
    }
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: null,
      skillCacheTtlMs: 40,
    })
    await probe.probeSkill('tdd', 'zh', 'CWD-TTL')
    await probe.probeSkill('tdd', 'zh', 'CWD-TTL')
    must(ttlCalls === 1, '有效期内命中缓存', 'ttlCalls=' + ttlCalls)
    await new Promise((r) => setTimeout(r, 70))
    await probe.probeSkill('tdd', 'zh', 'CWD-TTL')
    must(ttlCalls === 2, '过期后重问', 'ttlCalls=' + ttlCalls)
  }

  title('— E. 广播按工作区分桶清 —')
  {
    let calls = 0
    const home = nodeOs.tmpdir()
    const platform = makePlatform(home)
    const skillsMock = {
      async get(name) { calls++; return { name, path: nodePath.join(home, '.agents', 'skills', name) } },
    }
    const cleared = []
    const scopedChains = []
    const storeCalls = []
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({
        clear() { storeCalls.push('clear-all') },
        invalidate(handle) { storeCalls.push('invalidate:' + ((handle && handle.cwd) || '')) },
        get: () => null,
        set() {},
      }),
      resetChainCache: () => { cleared.push('clear-all') },
      resetChainCacheForKey: (key) => { scopedChains.push(String(key)) },
      logCtx: null,
    })
    await probe.probeSkill('wayfinder', 'zh', 'CWD-A')
    await probe.probeSkill('wayfinder', 'zh', 'CWD-B')
    must(calls === 2, '两个工作区各问一次', 'calls=' + calls)
    probe.invalidateSkillProbeCaches('CWD-A')
    await probe.probeSkill('wayfinder', 'zh', 'CWD-A')
    const afterA = calls
    await probe.probeSkill('wayfinder', 'zh', 'CWD-B')
    must(calls === afterA, '带工作区的广播只清那一桶，另一桶仍命中', 'calls=' + calls)
    must(scopedChains.join(',') === 'CWD-A', '链快照只按工作区键清一桶', scopedChains.join(','))
    must(storeCalls.some((s) => s === 'invalidate:CWD-A'), '检测级联缓存只按工作区键失效一桶', storeCalls.join(','))
    must(!cleared.length, '带工作区的广播不动全清', cleared.join(','))
    probe.invalidateSkillProbeCaches()
    await probe.probeSkill('wayfinder', 'zh', 'CWD-B')
    must(calls === afterA + 1, '不带工作区的广播才全清兜底', 'calls=' + calls)
  }

  title('— F. 并发同键复用同一份 —')
  {
    let calls = 0
    let release = null
    const gate = new Promise((r) => { release = r })
    const home = nodeOs.tmpdir()
    const platform = makePlatform(home)
    const skillsMock = {
      async get(name) { calls++; await gate; return { name, path: nodePath.join(home, '.agents', 'skills', name) } },
    }
    const spy = makeLogSpy(true)
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: spy.ctx,
    })
    const p1 = probe.probeSkill('research', 'zh', 'CWD-F')
    const p2 = probe.probeSkill('research', 'zh', 'CWD-F')
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    must(calls === 1, '并发同键只产生一次真实查询', 'calls=' + calls)
    must(r1 && r2 && r1.level === 'ok' && r2.level === 'ok', '两份回答都是绿')
    must(JSON.stringify(r1) === JSON.stringify(r2), '两份回答内容同一份')
    const dedups = spy.rows.filter((r) => r.event === 'dedup.hit')
    must(dedups.length >= 1, '复用记一行已有复用日志', 'dedup.hit=' + dedups.length)
    must(dedups.every((r) => r.fields && r.fields.scope === 'skill'), '复用日志的作用域记技能', JSON.stringify(dedups.map((r) => r.fields)))
  }

  title('— G. 缓存命中记已有日志，不新增事件 —')
  {
    let calls = 0
    const home = nodeOs.tmpdir()
    const platform = makePlatform(home)
    const skillsMock = {
      async get(name) { calls++; return { name, path: nodePath.join(home, '.agents', 'skills', name) } },
    }
    const spy = makeLogSpy(true)
    const probe = probeMod.createSkillProbe({
      ctx: makeCtx(skillsMock, platform),
      getPlatform: async () => platform,
      getWorkspaceStore: async () => ({ clear() {}, invalidate() {}, get: () => null, set() {} }),
      resetChainCache: () => {},
      logCtx: spy.ctx,
    })
    await probe.probeSkill('tdd', 'zh', 'CWD-G')
    await probe.probeSkill('tdd', 'zh', 'CWD-G')
    const probes = spy.rows.filter((r) => r.event === 'skill.probe')
    must(probes.length === 2, '命中与首问都走已有的技能探测日志', 'skill.probe=' + probes.length)
    must(probes[1] && probes[1].fields && probes[1].fields.via === 'cache', '命中那一行记缓存通道', JSON.stringify(probes[1] && probes[1].fields))
    const knownEvents = new Set(['skill.probe', 'skill.pending.cap', 'dedup.hit'])
    const unknown = spy.rows.map((r) => r.event).filter((e) => !knownEvents.has(e))
    must(unknown.length === 0, '技能探测侧不新增事件名', unknown.join(','))
  }

  title('— H. 探测按重查分流（平时三项、重查全量，真跑完整接线） —')
  {
    // 真接线：通道装配出的探测服务 + 探针闭包，只把注册表查询换成计数桩。
    // 平时探测只问出三项技能名，重查问出全量二十多项——看外部问了谁，不看内部形状。
    const platModH = await import(url('src/host/platformChannel.js'))
    const bootMod = await import(url('src/host/bootstrap.js'))
    const askedNames = []
    const fakeProbeSkill = async (name) => { askedNames.push(String(name)); return { ok: true, level: 'ok', detail: '已安装', hint: '' } }
    const boot = bootMod.createBootstrap({ ctx: { get: () => undefined, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch { return () => {} } }, set: () => {} } })
    const plat = platModH.createPlatformChannel({
      ctx: { get: () => undefined, set: () => {}, effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch { return () => {} } } },
      subprocess: {},
      timer: { timeout: (a, b) => (typeof a === 'function' ? new Promise((r) => setTimeout(() => r(a()), b)) : new Promise((r) => setTimeout(r, a))) },
      fs: null,
      DEFAULT_CWD: nodeOs.tmpdir(),
      TIMEOUT_MS: 30000,
      getMattSkillProbeNames: (...a) => boot.getMattSkillProbeNames(...a),
      getChainSkillNames: (...a) => boot.getChainSkillNames(...a),
      probeSkill: fakeProbeSkill,
      logCtx: null,
      getGate: () => null,
    })
    const svc = await plat.getDetectionService()
    must(svc && typeof svc.detect === 'function', '探测服务可从通道装配出来')
    askedNames.length = 0
    const plainRes = await svc.detect({ cwd: 'CWD-SCOPE-PLAIN' }, {})
    must(askedNames.length === 3, '平时探测只问三项技能', '实问=' + askedNames.length + '：' + askedNames.join(','))
    must(JSON.stringify([...askedNames].sort()) === JSON.stringify([...CHAIN_THREE].sort()), '平时问的正是链条要的三项', askedNames.join(','))
    must(plainRes && plainRes.skillProbes && plainRes.skillProbes.ok === true, '三项全绿时探测结论为好')
    askedNames.length = 0
    await svc.detect({ cwd: 'CWD-SCOPE-FORCE' }, { force: true })
    const sharedH = await import(url('src/shared/matt-skills.js'))
    const allCount = ((sharedH && sharedH.MATT_SKILL_PROBE_NAMES) || []).length
    must(askedNames.length === allCount && allCount > 20, '重查问全量二十多项', '实问=' + askedNames.length + '/全量=' + allCount)
  }
  {
    const platMod = await import(url('src/host/platformChannel.js'))
    must(typeof platMod.selectSkillProbeNames === 'function', '按需选名单函数可导入')
    const shared = await import(url('src/shared/matt-skills.js'))
    const all = (shared && shared.MATT_SKILL_PROBE_NAMES) || []
    must(all.length > 20, '全量名单二十多项', 'N=' + all.length)
    const chainSel = platMod.selectSkillProbeNames(all, CHAIN_THREE, 'chain')
    must(JSON.stringify([...chainSel].sort()) === JSON.stringify([...CHAIN_THREE].sort()), '平时只问链条要的三项', chainSel.join(','))
    const fullSel = platMod.selectSkillProbeNames(all, CHAIN_THREE, 'full')
    must(JSON.stringify(fullSel) === JSON.stringify(all), '重查问全量', 'N=' + fullSel.length)
    const fallbackSel = platMod.selectSkillProbeNames(all, CHAIN_THREE, 'whatever-unknown')
    must(JSON.stringify(fallbackSel) === JSON.stringify(all), '未知范围回落全量（宁可多问，不漏判）', 'N=' + fallbackSel.length)
  }

  console.log('\n' + (broken.length ? ('968 门禁失败 ' + broken.length + '/' + total) : ('968 门禁全部通过 ' + total + '/' + total)))
  process.exit(broken.length ? 1 : 0)
}

main().catch((e) => { console.error('968 门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
