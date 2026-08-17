// verify-b5-quota.js — dsh-waystation B5（配额止血 · 第一性原理）：GraphQL 配额烧尽根因与 REST 降级通道
// 用法: node tests/verify-b5-quota.js（在插件根目录；无需 gh / 网络）
//
// 背景（实测 2026-08-16）：多仓库会话并发 + lastMapsUpdatedAt 模块级单例 →
//   probe 拿别仓库的表对比 → 键数恒不同 → changed 永远 true → 全 store 疯狂刷新 →
//   60s 烧 160 GraphQL 点（≈9600 点/h >> 5000 限额）→ 面板空白。
//
// 验证四件事：
//   1) lastMapsUpdatedAt 按 repoKey 隔离（双源）：不再有裸 lastMapsUpdatedAt 单例
//   2) wf.probe 走 REST 通道（不占 GraphQL 配额）+ 返回 repo 字段（client 按 repo 刷新）
//   3) fetchMapsDetail 的 GraphQL RATE_LIMIT → 自动降级 REST（fetchMapsDetailREST 存在 + 同构组装）
//   4) client startAutoProbe：probe 5min + focus 限流 60s + changed 只刷新匹配 repo 的 store（双源）
const fs = require('fs')
const files = ['host.js', 'package/lib/index.js', 'client.js', 'package/lib/client.js']
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }
const norm = function (s) { return s.replace(/\s+/g, '') }

console.log('B5: GraphQL 配额止血（跨 repo 隔离 + REST 降级 + probe 降频）')

// ---- host 侧（host.js + package/lib/index.js）----
for (const f of ['host.js', 'package/lib/index.js']) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'

  // 1) 单例已改名为按 repo 隔离的表
  check(!/let lastMapsUpdatedAt\s*=\s*null/.test(src), f + ' 无裸 lastMapsUpdatedAt 单例（已改 lastMapsUpdatedAtByRepo）')
  check(src.includes('lastMapsUpdatedAtByRepo'), f + ' 存在按 repo 隔离表')

  // 2) probe 走 REST + 返回 repo
  check(src.includes('issues?state=open'), f + ' probe 走 REST issue list（不占 GraphQL）')
  check(/repo: repo[ ,} ]/.test(src) && src.indexOf('return { ok: true, changed: changed, repo: repo }') >= 0, f + ' probe 返回 repo 字段（client 按 repo 刷新）')
  check(src.includes('lastMapsUpdatedAtByRepo'), f + ' probe 用按 repo 隔离的表')

  // 3) REST 降级
  check(src.includes('async function fetchMapsDetailREST'), f + ' 存在 REST 降级函数 fetchMapsDetailREST')
  check(src.includes('fetchMapsDetailREST(numbers, cwd)'), f + ' GraphQL RATE_LIMIT → 自动降级 REST')
  check(src.includes('sub_issues?per_page=100'), f + ' REST 降级用 sub_issues 端点')
  check(src.includes('dependencies/blocked_by'), f + ' REST 降级用 dependencies/blocked_by（fog 数据源）')
  check(src.includes("blockedBy: { nodes:"), f + ' REST 降级组装 blockedBy.nodes（与 GraphQL 同构）')
  check(src.includes("fallback: 'rest'"), f + ' 降级返回 fallback 标记')
  check(src.includes('fallback: d.fallback'), f + ' buildSnapshot 透传 fallback 标记')
}

// ---- client 侧（client.js + package/lib/client.js）----
for (const f of ['client.js', 'package/lib/client.js']) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'

  check(src.includes('PROBE_MS = 300000'), f + ' probe 轮询降到 5min（#348 拍板纯手动 + 低频兜底）')
  check(src.includes('FOCUS_PROBE_MIN_MS = 60000'), f + ' focus 触发限流 ≥60s（防窗口来回切换疯狂烧）')
  // T10 R9 重构后 probe 逻辑位于 probeNow（startAutoProbe 仅剩定时器装配）——切片锚点随之更新
  const probeBlock = src.slice(src.indexOf('const probeNow'), src.indexOf('const startAutoProbe'))
  check(probeBlock.includes('sr === rep'), f + ' changed 只刷新与探测 repo 匹配的 store（不再全 store 刷新）')
  check(probeBlock.includes('loadSnapshot(shared, true, true)'), f + ' shared 用 force 刷新（1 次全量）')
  check(probeBlock.includes('loadSnapshot(st2, false, true)'), f + ' 其他匹配 store 用非 force（命中 host 60s 缓存 · 零额外 GraphQL）')
  check(!/Object\.keys\(stores\)\.forEach\(function \(k\) \{ loadSnapshot\(stores\[k\], true, true\) \}\)/.test(src), f + ' 无全 store 暴力刷新（原放大因子已移除）')
  check(!src.includes('setTimeout(function () { st._bgRefresh'), f + ' 无磁盘缓存秒开后的 400ms 强制全量刷新（每次开面板白烧 18 点已移除）')
}

// ---- 双源等价：关键特征逐字一致 ----
const h1 = fs.readFileSync('host.js', 'utf8')
const h2 = fs.readFileSync('package/lib/index.js', 'utf8')
const c1 = fs.readFileSync('client.js', 'utf8')
const c2 = fs.readFileSync('package/lib/client.js', 'utf8')
const feat = function (src) {
  return [
    'lastMapsUpdatedAtByRepo', 'fetchMapsDetailREST', "issues?state=open", 'dependencies/blocked_by',
    'FOCUS_PROBE_MIN_MS', 'sr === rep', "fallback: 'rest'",
  ].map(function (k) { return src.includes(k) ? 1 : 0 }).join('')
}
check(feat(h1) === feat(h2), 'host 双源 B5 特征一致（host.js ↔ package/lib/index.js）')
check(feat(c1) === feat(c2), 'client 双源 B5 特征一致（client.js ↔ package/lib/client.js）')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')
