// verify-probe-since.js — dsh-mattpocock-skills-deck · v1.5 R2（#2 MVP · 2026-08-18）
// 用法: node tests/verify-probe-since.js（在插件根目录；无需 gh / 网络）
//
// 背景：probe REST 查询从 `labels=wayfinder:map`（仅地图）改为 `since=<ISO>`（全 issue 增量）。
//   此前实现漏检子票（wayfinder:task / research / prototype / grilling）变化 —— 面板可接 / 阻塞 /
//   已认领 / 已关闭分组（DESIGN.md §5.2）都是子票，所以"列表不更新状态"。
//
// 验证五件事：
//   1) host 侧 `lastProbeAtByRepo` 模块级状态存在 + 按 repoKey 隔离（多仓库会话并发不互串）
//   2) host 侧 `case 'probe'` 用 since 参数（URL 含 `since=<encodeURIComponent(ISO)>`）
//   3) host 侧 `case 'probe'` 不再用 `labels=wayfinder:map`（旧漏检逻辑）
//   4) host 侧 `buildSnapshot` 末尾初始化 `lastProbeAtByRepo[rk] = new Date().toISOString()`
//   5) client 侧 `PROBE_MS = 60000`（不再 5min），双源逐字一致
const fs = require('fs')
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }

console.log('R2: probe since 时间戳探测（#2 MVP · 子票漏检修复）')

const hostFiles = ['host.js', 'package/lib/index.js']
const clientFiles = ['client.js', 'package/lib/client.js']

// ---- host 侧 ----
for (const f of hostFiles) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'

  // 1) lastProbeAtByRepo 存在 + 按 repoKey 隔离
  check(/let lastProbeAtByRepo\s*=\s*\{\}/.test(src), f + ' 模块级 lastProbeAtByRepo 存在（按 repoKey 隔离）')
  check(!/let lastProbeAt\s*=\s*null/.test(src), f + ' 无裸 lastProbeAt 单例（多仓库并发不互串）')

  // 2) probe handler 存在（双形态：package/lib 用 case 'probe'，host.js 用 harness.handle('wf.probe', ...)）
  const hasProbeCase = /case 'probe'/.test(src)
  const hasProbeHandle = /harness\.handle\('wf\.probe'/.test(src)
  check(hasProbeCase || hasProbeHandle, f + ' 存在 probe handler（case ' + "'probe'" + ' 或 harness.handle wf.probe）')
  check(src.includes('since = lastProbeAtByRepo'), f + ' probe 从 lastProbeAtByRepo 读 since 基准线')
  check(src.includes('encodeURIComponent(since)') || /since:\s*lastProbeAtByRepo/.test(src) || src.includes('\'&since=\''), f + ' probe 用 since 参数构造 REST URL')
  check(src.includes('issues?state=open&per_page=100'), f + ' probe REST URL 不带 labels 过滤（全 issue 增量）')

  // 3) probe handler 内不再用 labels=wayfinder:map（旧漏检逻辑）—— 注意注释里可能仍提到这段历史
  //   实际检查：probe handler 内（runGh 行内）不含 labels=wayfinder:map
  const probeBlockMatch = src.match(/probe[\s\S]{0,3000}/)
  const probeHandlerSrc = probeBlockMatch ? probeBlockMatch[0].slice(0, 2500) : ''
  check(!probeHandlerSrc.includes('labels=wayfinder:map'), f + ' probe handler 内不再用 labels=wayfinder:map（旧漏检子票逻辑已移除）')

  // 4) buildSnapshot 末尾初始化 lastProbeAtByRepo[rk]
  check(/lastProbeAtByRepo\[rk0\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src), f + ' buildSnapshot 末尾初始化 lastProbeAtByRepo[rk] = ISO（probe since 基准线）')

  // probe 返回 changed 时更新 lastProbeAtByRepo（基准线滑动）
  check(/if \(changed\) \{[\s\S]*?lastProbeAtByRepo\[rk1\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src), f + ' probe changed 时滑动 lastProbeAtByRepo 基准线')
}

// ---- client 侧 ----
for (const f of clientFiles) {
  const src = fs.readFileSync(f, 'utf8')

  // 5) PROBE_MS = 60000（不再是 5min）
  check(src.includes('PROBE_MS = 60000'), f + ' PROBE_MS 默认 60s（#2 MVP · 用户感知阈值）')
  check(!src.includes('PROBE_MS = 300000'), f + ' 无残留 5min 默认值')
}

// ---- 双源等价 ----
const h1 = fs.readFileSync('host.js', 'utf8')
const h2 = fs.readFileSync('package/lib/index.js', 'utf8')
const c1 = fs.readFileSync('client.js', 'utf8')
const c2 = fs.readFileSync('package/lib/client.js', 'utf8')
const probeSinceFeat = function (src) {
  return [
    'lastProbeAtByRepo',
    "issues?state=open&per_page=100",
    'since = lastProbeAtByRepo',
    "labels=wayfinder:map",
  ].map(function (k) { return src.includes(k) ? 1 : 0 }).join('')
}
check(probeSinceFeat(h1) === probeSinceFeat(h2), 'host 双源 since 探测特征一致（host.js ↔ package/lib/index.js）')
const probeMsFeat = function (src) {
  return ['PROBE_MS = 60000', 'FOCUS_PROBE_MIN_MS = 60000', 'PROBE_MS = 300000'].map(function (k) { return src.includes(k) ? 1 : 0 }).join('')
}
check(probeMsFeat(c1) === probeMsFeat(c2), 'client 双源 PROBE_MS 特征一致（client.js ↔ package/lib/client.js）')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')