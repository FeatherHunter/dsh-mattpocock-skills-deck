// tests/verify-generic-catalog.js — #226 验收（通用检查目录与谓词原语注册表 host）
// 规约：D6 开门链通用部分 + D7 c7-c9 通用技能探测；#224 v2 2026-08-28
// 用法：node tests/verify-generic-catalog.js
// 覆盖：通用目录一致性 / 谓词只读不抛 / 验形状不验内容 / 目录产物进入链视图 / 无 na
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)

let failed = false
let total = 0
let passed = 0
function check(ok, msg, detail='') {
  total++
  if (ok) { passed++; console.log('  PASS ' + msg) }
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail.slice(0,600) : '')) }
}

console.log('== 通用检查目录与谓词原语注册表 (#226) ==')

let catalogMod, chainMod, predMod, genericMod
try {
  catalogMod = await import('../src/shared/tracker/check-catalog.js')
  chainMod = await import('../src/shared/tracker/chain.js')
  predMod = await import('../src/host/tracker/predicateRegistry.js')
  genericMod = await import('../src/host/tracker/generic.js')
} catch (e) {
  console.log('  FAIL import modules — ' + String(e && e.message || e))
  console.log(e && e.stack)
  process.exit(1)
}

// ---------- 1. 通用目录在任意后端下输出一致 ----------
console.log('\n— 验收1：通用目录在任意后端下输出一致 —')
{
  const { GENERIC_CATALOG, catalogFor, GENERIC_CHAIN, GENERIC_GATE_CHAIN, GENERIC_ENV_CHAIN } = catalogMod
  check(Array.isArray(GENERIC_CATALOG) && GENERIC_CATALOG.length >= 5, 'GENERIC_CATALOG 存在且 >=5 — got=' + (GENERIC_CATALOG && GENERIC_CATALOG.length))
  const idsNull = catalogFor(null).filter(c=>c.scope==='generic').map(c=>c.id).sort().join(',')
  const idsGh = catalogFor('github').filter(c=>c.scope==='generic').map(c=>c.id).sort().join(',')
  const idsMd = catalogFor('markdown').filter(c=>c.scope==='generic').map(c=>c.id).sort().join(',')
  const idsGl = catalogFor('gitlab').filter(c=>c.scope==='generic').map(c=>c.id).sort().join(',')
  check(idsNull === idsGh && idsGh === idsMd && idsMd === idsGl, 'catalogFor 任意后端通用子集一致 — ' + idsNull)
  check(!!GENERIC_CHAIN && GENERIC_CHAIN.length >= 5, 'GENERIC_CHAIN 存在且 >=5 — got=' + (GENERIC_CHAIN && GENERIC_CHAIN.length))
  check(!!GENERIC_GATE_CHAIN && GENERIC_GATE_CHAIN.length === 2, 'GENERIC_GATE_CHAIN 为 2（选后端→已初始化）— got=' + (GENERIC_GATE_CHAIN && GENERIC_GATE_CHAIN.length))
  check(!!GENERIC_ENV_CHAIN && GENERIC_ENV_CHAIN.length >= 3, 'GENERIC_ENV_CHAIN >=3（c7-c9 等）— got=' + (GENERIC_ENV_CHAIN && GENERIC_ENV_CHAIN.length))
  // 对抗式：ensure generic items 不含 na 字段
  const allGeneric = [...GENERIC_CHAIN]
  const hasNaField = allGeneric.some(c => JSON.stringify(c).includes('"na"') || (c.onPass && c.onPass.show && String(c.onPass.show.level).includes('na')) )
  check(!hasNaField, '通用链无 na 承载字段')
  // 对抗式：任意后端下 GENERIC_CHAIN 相同（不随 backendId 变）
  const { getGenericChain, assertGenericConsistent } = genericMod
  const gcAll = getGenericChain('all').map(c=>c.id).join(',')
  const gcGate = getGenericChain('gate').map(c=>c.id).join(',')
  check(gcAll.length>0 && gcGate.includes('backendSelected') && gcGate.includes('tracker:initialized'), 'getGenericChain 按 kind 正确 — all=' + gcAll + ' gate=' + gcGate)
  const cons = assertGenericConsistent()
  check(cons.ok, 'assertGenericConsistent() 通过 — ' + cons.detail)
  // adversarial: 篡改 backendId 不影响 getGenericCatalog
  const g1 = genericMod.getGenericCatalog('github').map(c=>c.id).join(',')
  const g2 = genericMod.getGenericCatalog('markdown').map(c=>c.id).join(',')
  const g3 = genericMod.getGenericCatalog(null).map(c=>c.id).join(',')
  check(g1===g2 && g2===g3, 'getGenericCatalog 在任意后端下一致 — ' + g1)
}

// ---------- 2. 谓词只读、失败返回而非抛 ----------
console.log('\n— 验收2：谓词只读、失败返回而非抛 —')
{
  const { createPredicateRegistry } = predMod
  const { registerGenericPredicates } = genericMod
  const { GENERIC_CHAIN } = catalogMod
  const registry = createPredicateRegistry({ timeout: 2000 })
  registerGenericPredicates(registry)
  // 注册验形状不验内容：重复注册同 key 应抛 duplicate，但不同内容同形状不应被拒
  let dupThrown = false
  try { registry.register('backend:*:backendSelected', async ()=>({status:'pass'})) } catch (e) { dupThrown = /duplicate/.test(String(e.message)) }
  check(dupThrown, '重复注册同 key 抛 duplicate（形状校验）')
  // 谓词只读：调用 resolveAll 后检查文件系统未被写（通过 mock fs 只读探测）
  // 使用真实 platform 的只读探测（commandExists/fileExists/env/skillProbe）不应抛
  const mockPlatform = {
    resolveExecutable: async () => null, // 模拟未安装
    fs: {
      resolve: async (p, opts) => (opts && opts.cwd ? opts.cwd + '/' + p : p),
      exists: async () => false,
      readText: async () => { throw new Error('not found') },
    },
    env: { get: () => undefined },
    getHome: async () => '/tmp/fake-home',
    path: { join: (...a) => a.join('/') },
  }
  const ctx = { platform: mockPlatform, backendId: null, cwd: '/tmp/test', selection: null }
  let resolved
  try {
    resolved = await registry.resolveAll(GENERIC_CHAIN, ctx)
    check(!!resolved && typeof resolved === 'object', 'resolveAll 返回对象而非抛 — keys=' + Object.keys(resolved).join(','))
    // 每个结果应为 {status: pass|fail|pending} 且不抛
    for (const [k,v] of Object.entries(resolved)) {
      check(v && (v.status==='pass'||v.status==='fail'||v.status==='pending'), '谓词结果 ' + k + ' 形状为 pass/fail/pending — got=' + JSON.stringify(v))
      check(!String(v.detail||'').includes('write') && !String(v.detail||'').includes('ENOENT write'), '谓词 detail 非写操作 — ' + k)
    }
    // 对抗式：ensure pending/fail 不抛，整体不阻塞
    check(Object.keys(resolved).length === GENERIC_CHAIN.length, 'resolveAll 覆盖全部通用项 — ' + Object.keys(resolved).length + '/' + GENERIC_CHAIN.length)
  } catch (e) {
    check(false, 'resolveAll 不应抛 — ' + String(e && e.message), e && e.stack)
  }

  // 对抗式：超时按 pending 不抛
  {
    const r2 = createPredicateRegistry({ timeout: 10 })
    r2.register('backend:*:slow', async () => { await new Promise(res=>setTimeout(res, 100)); return {status:'pass'} })
    const slowChain = [{ id:'slow', check:{kind:'backend', id:'slow'}, onPass:{show:{fallback:'ok'}, actions:[]}, onFail:{show:{fallback:'fail', level:'bad'}, actions:[]} }]
    const out = await r2.resolveAll(slowChain, ctx)
    check(out.slow && out.slow.status==='pending', '谓词超时按 pending — got=' + JSON.stringify(out.slow))
  }

  // 校验 predicateRegistry 导出验形状不验内容：空内容 skill 不应被拒
  try {
    const r3 = createPredicateRegistry()
    r3.register('test:shapeOnly', async ()=>({status:'pass', detail:'any content ok'}))
    const out = await r3.resolveAll([{ id:'test:shapeOnly', check:{kind:'backend', id:'test:shapeOnly'}, onPass:{show:null, actions:[]}, onFail:{show:null, actions:[]}}], ctx)
    check(out['test:shapeOnly'] && out['test:shapeOnly'].status==='pass', '验形状不验内容：任意内容通过形状')
  } catch (e) { check(false, '验形状不验内容不应抛 — ' + String(e.message)) }
}

// ---------- 3. 目录产物进入检查链视图 ----------
console.log('\n— 验收3：目录产物进入检查链视图 —')
{
  const { GENERIC_CHAIN, GENERIC_GATE_CHAIN, catalogItemToCheckItem } = catalogMod
  const { evaluateChain, CHECK_STATE } = chainMod
  const { createPredicateRegistry } = predMod
  const { registerGenericPredicates, resolveGenericChain } = genericMod

  // GENERIC_CHAIN 可直接喂 evaluateChain（纯函数，无 IO）
  const mockResults = {}
  for (const item of GENERIC_CHAIN) mockResults[item.id] = 'pass'
  const snapAllPass = evaluateChain(GENERIC_CHAIN, mockResults)
  check(snapAllPass.chainState==='allDone' && snapAllPass.doneCount===GENERIC_CHAIN.length, '通用链全 pass → allDone — done=' + snapAllPass.doneCount)

  const mockFail = { ...mockResults, 'selection:backendSelected': 'fail' }
  const snapGateFail = evaluateChain(GENERIC_GATE_CHAIN, mockFail)
  check(snapGateFail.currentIndex===0 && (snapGateFail.steps[0].status===CHECK_STATE.FAIL || snapGateFail.steps[0].status===CHECK_STATE.CURRENT), '门链首步 fail 阻塞')

  // catalogItemToCheckItem 转换
  const ghItem = { id:'gh:installed', label:'gh 已安装', scope:'backend', backends:['github'], check:{kind:'primitive', primitive:'commandExists', command:'gh'} }
  const conv = catalogItemToCheckItem(ghItem)
  check(conv && conv.id==='gh:installed' && conv.check && conv.onPass && conv.onFail, 'catalogItemToCheckItem 转换后端项')

  // 宿主 resolveGenericChain 端到端（只读探测）
  const registry = createPredicateRegistry({ timeout: 2000 })
  registerGenericPredicates(registry)
  const mockPlat = {
    resolveExecutable: async () => null,
    fs: { resolve: async (p, o) => (o && o.cwd ? o.cwd + '/' + p : p), exists: async () => false, readText: async()=>{ throw new Error('not found') } },
    env: { get: () => undefined },
    getHome: async () => '/tmp',
    path: { join: (...a)=>a.join('/') },
  }
  const res = await resolveGenericChain(registry, { platform: mockPlat, cwd:'/tmp', backendId: null }, 'all')
  check(res && res.chain && res.snapshot && Array.isArray(res.snapshot.steps), 'resolveGenericChain 产出 snapshot — steps=' + (res.snapshot && res.snapshot.steps.length))
  check(res.snapshot.steps.every(s => typeof s.isApplicable==='boolean'), 'snapshot 每步含 isApplicable')
  // 无 na
  check(!res.snapshot.steps.some(s=> s.status==='na'), '快照无 na 状态')
}

// ---------- 4. 注册表验形状不验内容（与 tracker registry 同哲学） ----------
console.log('\n— 验收4：注册表验形状不验内容 —')
{
  const { validateGenericShape } = catalogMod
  const { GENERIC_CHECK_ITEMS } = catalogMod
  for (const item of GENERIC_CHECK_ITEMS) {
    const e = validateGenericShape(item)
    check(e.length===0, 'GENERIC_CHECK_ITEMS 形状合法 — ' + item.id)
  }
  // 对抗式：缺 id 必错
  check(validateGenericShape({}).length>0, '空对象形状校验失败')
  // 对抗式：内容（skill 名任意）不影响形状
  const anySkill = { id:'skill:any', check:{kind:'primitive', primitive:'skillProbe', skill:'any-fake-skill-xyz'}, onPass:{show:{fallback:'ok'}, actions:[]}, onFail:{show:{fallback:'fail'}, actions:[]} }
  check(validateGenericShape(anySkill).length===0, '任意 skill 名形状仍合法（不验内容）')
}

// ---------- 5. 无 na 承载字段（2026-08-27 已删） ----------
console.log('\n— 验收5：无 na 承载字段 —')
{
  let hasNa = false
  try {
    const fs = await import('node:fs')
    const txt1 = fs.readFileSync('src/shared/tracker/check-catalog.js','utf8')
    const txt2 = fs.readFileSync('src/host/tracker/predicateRegistry.js','utf8')
    const txt3 = fs.readFileSync('src/host/tracker/generic.js','utf8')
    // 允许注释中提及 "删 na"，但不应有 '"na"' 字段或 CHECK_STATE.NA 引用
    const bad1 = /CHECK_STATE\.NA/.test(txt1) || /CHECK_STATE\.NA/.test(txt2) || /CHECK_STATE\.NA/.test(txt3)
    const bad2 = /'na'|"na"\s*:/.test(txt1) && !txt1.includes('删 na')
    // 更严格：检查 _chain.js 之外是否还有 na 枚举
    // 我们只判 CHECK_STATE.NA 存在即 fail
    check(!bad1, '源码无 CHECK_STATE.NA 引用')
    // 允许字符串 "na" 在注释里，但不应有 level: 'na'
    const badLevel = /level\s*:\s*['"]na['"]/.test(txt1+txt2+txt3)
    check(!badLevel, '无 level na')
    hasNa = bad1 || badLevel
  } catch (e) { check(false, '读取源码校验 na 失败 — ' + String(e.message)) }
}

console.log('\n— 汇总 —')
console.log('  total=' + total + ' passed=' + passed + ' failed=' + (total-passed))
if (failed) { console.log('\n  FAIL  verify-generic-catalog — 有失败'); process.exit(1) }
else { console.log('\n  PASS  verify-generic-catalog — 全部通过 (#226)') }
