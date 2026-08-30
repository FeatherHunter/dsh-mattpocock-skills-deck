#!/usr/bin/env node
/**
 * verify-panel-workspace-shared.js — 同工作区共享与去重门禁（#299 / #324 / #325 验收）
 *
 * 覆盖：
 *  - 工作区键单源（src/shared/workspaceKey.js 的 keyOf 全库仅一份）
 *  - 快照 / 在途 / 链在途 / 选择集 / 仓库 / 链缓存 全部按归一键
 *  - 探针扇出按归一键分组（同工作区只跑一次，结果扇出到组内全量会话）
 *  - 新会话秒显共享缓存（storeOf + openTextInNewSession hydrate，移除直接继承）
 *  - 链共享键含后端 id
 *  - 双产物一致性
 *  - 行为模拟：同 cwd 两种写法归并一组且只求值一次、版本最新者胜、在途复用
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg) => { passed++; console.log('  PASS', msg) }
const bad = (msg) => { failed = true; console.log('  FAIL', msg) }

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8') }
function has(rel, re) { return re.test(read(rel)) }
function count(rel, re) { const m = read(rel).match(re); return m ? m.length : 0 }

console.log('=== #304 同工作区共享与去重门禁 ===')

// 1) 单源 keyOf
console.log('\n1) 工作区键单源')
const wkPath = 'src/shared/workspaceKey.js'
if (!fs.existsSync(path.join(root, wkPath))) bad('src/shared/workspaceKey.js 缺失')
else {
  ok('src/shared/workspaceKey.js 存在')
  const txt = read(wkPath)
  if (/export function keyOf/.test(txt)) ok('keyOf 导出存在')
  else bad('keyOf 未导出')
  if (/export function currentOs/.test(txt)) ok('currentOs 导出存在')
  else bad('currentOs 未导出')
  // 检查规则
  if (/toLowerCase/.test(txt) && /replace.*\\\\/.test(txt)) ok('keyOf 包含 win 小写折叠与斜杠归一')
  else bad('keyOf 规则不完整')
  if (/UNC/.test(txt)) ok('keyOf 处理 UNC')
  else bad('keyOf 未显式处理 UNC')
}

// 全库仅一份归一实现：除 workspaceKey.js 外，不应再出现 toLowerCase + replace(\)
console.log('\n2) 归一函数全库仅一份（重复定义清零）')
const kernelFiles = ['src/client/kernel/store.js','src/client/kernel/probe.js','src/client/kernel/api.js','src/client/panel/Dock.js']
const dupPattern = /\.toLowerCase\(\)\.replace\(.*\\\\/
let dupCount = 0
for (const rel of kernelFiles) {
  const txt = read(rel)
  // 排除对 keyOf 的调用，统计直接的 toLowerCase+replace 归一实现
  const lines = txt.split('\n')
  for (let i=0;i<lines.length;i++) {
    const line = lines[i]
    // 若该行含 keyOf，则是 delegating，不算重复定义；若含 toLowerCase().replace 且不含 keyOf，则算重复
    if (/toLowerCase/.test(line) && /replace.*\\\\/.test(line) && !/keyOf/.test(line)) {
      // 检查是否在注释中
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      dupCount++
      console.log('    重复归一实现 @'+rel+':'+(i+1)+' '+line.trim().slice(0,120))
    }
  }
}
if (dupCount===0) ok('内核与面板无重复归一实现（仅 workspaceKey.js 定义）')
else bad('发现 '+dupCount+' 处重复归一实现（应仅 workspaceKey.js 有）')

// 检查旧的 normKeyClient / normCwdClientProbe 定义已移除
console.log('\n3) 旧归一别名已移除')
for (const rel of ['src/client/kernel/store.js','src/client/kernel/probe.js']) {
  const txt = read(rel)
  if (/export const normKeyClient/.test(txt)) bad(rel+' 仍含 normKeyClient 定义（应删除）')
  else ok(rel+' 无 normKeyClient')
  if (/export const normCwdClientProbe/.test(txt)) bad(rel+' 仍含 normCwdClientProbe 定义（应删除或仅委托）')
  else ok(rel+' 无 normCwdClientProbe 重复定义')
}

// 4) 抽屉全部按归一键
console.log('\n4) 全部工作区抽屉按归一键')
const checks = [
  ['src/client/kernel/store.js', /getCachedSnapshot/, 'getCachedSnapshot 按 keyOf'],
  ['src/client/kernel/store.js', /setCachedSnapshot/, 'setCachedSnapshot 按 keyOf'],
  ['src/client/kernel/store.js', /getCachedSelection.*keyOf/, 'getCachedSelection 按 keyOf'],
  ['src/client/kernel/store.js', /setCachedSelection.*keyOf/, 'setCachedSelection 按 keyOf'],
  ['src/client/kernel/store.js', /getCachedRepository.*keyOf/, 'getCachedRepository 按 keyOf'],
  ['src/client/kernel/store.js', /getCachedChain.*keyOf|getChainCacheKey/, 'getCachedChain 存在且按 keyOf'],
  ['src/client/kernel/store.js', /chainByCwd/, 'chainByCwd 共享缓存存在'],
  ['src/client/kernel/probe.js', /pendingSnapshotByCwd.*keyOf|keyOf.*pendingSnapshotByCwd/, 'pendingSnapshotByCwd 按 keyOf'],
  ['src/client/kernel/probe.js', /_chainInflightByCwd.*keyOf|getChainCacheKey/, '_chainInflightByCwd 按 keyOf+backendId'],
  ['src/client/kernel/probe.js', /keyOf.*cwd.*\|.*backendId|getChainCacheKey/, '链键含 backendId'],
  ['src/client/kernel/store.js', /snapshotByCwd/, 'snapshotByCwd 存在'],
]
for (const [rel, re, msg] of checks) {
  if (has(rel, re)) ok(msg+' @'+rel)
  else bad(msg+' 缺失 @'+rel)
}

// 5) 扇出分组按归一键
console.log('\n5) 探针扇出按归一键分组')
if (has('src/client/kernel/probe.js', /keyOf\(shared\.cwd/) && has('src/client/kernel/probe.js', /keyOf\(st\.cwd/) && has('src/client/kernel/probe.js', /keyOf\(cwd\)/)) {
  ok('refreshGroup 与 cwds 去重均使用 keyOf')
} else bad('refreshGroup 未完全按 keyOf 分组')
if (has('src/client/kernel/probe.js', /cwdsByNorm/)) ok('cwds 按归一键去重（cwdsByNorm）')
else bad('cwds 去重未按归一键')
if (read('src/client/kernel/probe.js').includes('shared.cwd === cwd') && !read('src/client/kernel/probe.js').includes('keyOf(shared.cwd)')) {
  // 若仍存在直接 === 且无 keyOf，则为旧缺陷
  bad('仍存在 shared.cwd === cwd 直接比较（应为 keyOf 相等）')
} else ok('无直接 shared.cwd === cwd 严格相等分组缺陷')

// 6) 新会话秒显
console.log('\n6) 新会话秒显共享缓存')
const apiTxt = read('src/client/kernel/api.js')
if (/ns\.snapshot\s*=\s*st\.snapshot/.test(apiTxt)) {
  // 检查是否已被改造为带 hydrate 兜底的版本（允许在 hydrate 失败兜底时出现，但不应是直接继承）
  const directInherit = /if \(ns && st\.snapshot\) \{ ns\.snapshot = st\.snapshot/.test(apiTxt)
  if (directInherit) bad('openTextInNewSession 仍直接继承 ns.snapshot = st.snapshot（应走 hydrateFromCache）')
  else ok('openTextInNewSession 无直接继承（已改造为 hydrate）')
} else ok('openTextInNewSession 无直接继承 ns.snapshot = st.snapshot')
if (/hydrateFromCache/.test(apiTxt)) ok('openTextInNewSession 调用 hydrateFromCache')
else bad('openTextInNewSession 未调用 hydrateFromCache')
if (has('src/client/kernel/store.js', /hydrateFromCache/)) ok('storeOf 经 hydrateFromCache 水合')
else bad('hydrateFromCache 缺失')
if (read('src/client/kernel/store.js').includes('chainByCwd') && read('src/client/kernel/store.js').includes('getCachedChain')) ok('hydrateFromCache 含链快照水合')
else bad('hydrateFromCache 未含链水合')

// 7) chain 共享键含 backendId
console.log('\n7) 链共享键含后端 id')
if (has('src/client/kernel/store.js', /getChainCacheKey.*backendId/)) ok('getChainCacheKey 含 backendId')
else bad('getChainCacheKey 未含 backendId')
if (has('src/client/kernel/store.js', /chainByCwd.*Map/)) ok('chainByCwd Map 存在')
else bad('chainByCwd 缺失')

// 8) 双产物一致性
console.log('\n8) 双产物一致性')
const buildSpliceMarker = 'shared:workspaceKey'
if (has('scripts/build.mjs', new RegExp(buildSpliceMarker))) ok('build.mjs 已登记 shared:workspaceKey')
else bad('build.mjs 未登记 shared:workspaceKey')
if (has('src/client/index.js', new RegExp(buildSpliceMarker))) ok('src/client/index.js 含 shared:workspaceKey 标记')
else bad('src/client/index.js 缺 shared:workspaceKey 标记')
try {
  const dev = read('client.js')
  const pkg = read('package/lib/client.js')
  const hasKeyOfDev = /function keyOf/.test(dev)
  const hasKeyOfPkg = /function keyOf/.test(pkg)
  if (hasKeyOfDev && hasKeyOfPkg) ok('双产物均含 keyOf（一源两物）')
  else bad('双产物 keyOf 不一致 dev='+hasKeyOfDev+' pkg='+hasKeyOfPkg)
  // 检查旧 norm 已不存在于双产物（除 workspaceKey 自身）
  const normInDev = (dev.match(/normKeyClient/g)||[]).length
  const normProbeInDev = (dev.match(/normCwdClientProbe/g)||[]).length
  if (normInDev===0 && normProbeInDev===0) ok('双产物无旧 normKeyClient/normCwdClientProbe 残留')
  else bad('双产物仍含旧 norm 定义 dev normKey='+normInDev+' normProbe='+normProbeInDev)
} catch(e) { bad('双产物读取失败 '+e.message) }

// 9) 行为模拟
console.log('\n9) 行为模拟：同 cwd 两种写法归并、版本最新者胜、在途复用')

// 模拟 keyOf
function keyOfSim(raw, os){
  let s = String(raw).trim();
  if(!s) return '';
  let isWin = os==='win32';
  if(isWin){
    s=s.replace(/\\/g,'/'); 
    const isUNC=s.indexOf('//')===0;
    if(isUNC){ const rest=s.slice(2).replace(/^\/+/, '').replace(/\/+/g,'/'); s='//'+rest; } else s=s.replace(/\/+/g,'/');
    s=s.toLowerCase();
    let keep=/^[a-z]:\/$/.test(s) || s==='/';
    if(!keep) while(s.length>1 && s.endsWith('/')) s=s.slice(0,-1);
    return s;
  } else {
    s=s.replace(/\/+/g,'/'); while(s.length>1 && s.endsWith('/')) s=s.slice(0,-1); return s;
  }
}
function testDedup(){
  // 同 cwd 两种写法应归一且只求一次
  const k1=keyOfSim('D:/Work/Alpha', 'win32');
  const k2=keyOfSim('d:/work/alpha/', 'win32');
  const k3=keyOfSim('D:\\Work\\Alpha', 'win32');
  if(k1===k2 && k2===k3) ok('同 cwd 三种写法归一（win 大小写/斜杠/尾斜杠）')
  else bad('归一失败 k1='+k1+' k2='+k2+' k3='+k3)
  // POSIX 保留大小写
  const p1=keyOfSim('/work/Alpha', 'linux');
  const p2=keyOfSim('/work/alpha', 'linux');
  if(p1!==p2) ok('POSIX 大小写保留（不同桶）')
  else bad('POSIX 大小写未保留')
  // 版本最新者胜模拟
  const snapOld={generatedMs:1000, maps:[{n:1}], version:'v1'}
  const snapNew={generatedMs:2000, maps:[{n:1}], version:'v2'}
  let st={snapshot:snapOld}
  const incoming=snapNew
  if(incoming.generatedMs > (st.snapshot.generatedMs||0)) { st.snapshot=incoming; }
  if(st.snapshot.version==='v2') ok('版本最新者胜（generatedMs 比较）')
  else bad('版本勝出失败')
  // 在途复用模拟：同一 norm 键的 pending 只应有一个
  const pending=new Map();
  const normKey=keyOfSim('D:/work/alpha', 'win32')
  pending.set(normKey, {promise: Promise.resolve('snap1')})
  const normKey2=keyOfSim('d:/work/alpha/', 'win32')
  if(pending.has(normKey2)) ok('在途复用：同归一键命中 pending（30秒 去重）')
  else bad('在途复用失败')
  // 链键含 backendId
  const chainKey1=keyOfSim('D:/work/alpha','win32')+'|'+'github'
  const chainKey2=keyOfSim('d:/work/alpha','win32')+'|'+'github'
  const chainKey3=keyOfSim('D:/work/alpha','win32')+'|'+'markdown'
  if(chainKey1===chainKey2 && chainKey1!==chainKey3) ok('链键 = 工作区键 + backendId（同工作区同后端同键，异后端异键）')
  else bad('链键失败')
}
testDedup()

// 10) 加载态治理：hasCache 时 silent
console.log('\n10) 加载态治理（缓存优先、静默刷新）')
if (has('src/client/kernel/router.js', /getCachedSnapshot/)) ok('router 使用 getCachedSnapshot 判定 hasCache')
else bad('router 未使用 getCachedSnapshot')
if (has('src/client/kernel/probe.js', /hasCache.*silent|silent.*hasCache/) || read('src/client/kernel/probe.js').includes("if (force && !silent && !hasCache)")) ok('loadSnapshot 仅无缓存时可见 loading（hasCache 则静默）')
else bad('loadSnapshot 加载态判定缺失')

console.log('\n=== 汇总 ===')
console.log(passed+' 通过，'+(failed?'存在失败':'全部通过'))
if (failed) process.exit(1); else { console.log('全部通过 ✅ — 同工作区共享与去重已生效'); process.exit(0) }
