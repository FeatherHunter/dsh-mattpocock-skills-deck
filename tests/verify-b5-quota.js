// verify-b5-quota.js — dsh-waystation B5（配额止血 · 第一性原理）+ R2（#2 MVP · since 探测）
// 用法: node tests/verify-b5-quota.js（在插件根目录；无需 gh / 网络）
//
// B5 背景（实测 2026-08-16）：多仓库会话并发 + lastMapsUpdatedAt 模块级单例 →
//   probe 拿别仓库的表对比 → 键数恒不同 → changed 永远 true → 全 store 疯狂刷新 →
//   60s 烧 160 GraphQL 点（≈9600 点/h >> 5000 限额）→ 面板空白。
//
// R2 背景（#2 · 2026-08-18）：probe `labels=wayfinder:map` 仅匹配地图，漏检子票变化；
//   改为 since 时间戳探测全 issue 增量（1 次 REST 覆盖）。PROBE_MS 5min → 60s。
//
// 验证五件事：
//   1) lastProbeAtByRepo 按 repoKey 隔离（双源）：probe 跨 repo 不互串
//   2) wf.probe 走 since REST 通道（不占 GraphQL 配额）+ 返回 repo 字段（client 按 repo 刷新）
//   3) fetchMapsDetail 的 GraphQL RATE_LIMIT → 自动降级 REST（fetchMapsDetailREST 存在 + 同构组装）
//   4) client startAutoProbe：probe 60s + focus 限流 60s + changed 后 await shared force 刷新 → 全 store 内存广播（R2-fix-5，双源）
//   5) buildSnapshot **不**推进 lastProbeAtByRepo 基线（R2-fix-6：build 无权动基线，防吞同窗口编辑）；基线仅由 probe changed 滑动
const fs = require('fs')
const files = ['host.js', 'package/lib/index.js', 'client.js', 'package/lib/client.js']
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }
const norm = function (s) { return s.replace(/\s+/g, '') }

console.log('B5 + R2: GraphQL 配额止血（跨 repo 隔离 + REST 降级）+ since 探测（#2 MVP）')

// ---- host 侧（host.js + package/lib/index.js）----
for (const f of ['host.js', 'package/lib/index.js']) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'

  // 1) since 时间戳按 repoKey 隔离（双源）：probe 跨 repo 不互串
  check(src.includes('lastProbeAtByRepo'), f + ' 存在 lastProbeAtByRepo（since 时间戳按 repoKey 隔离）')
  check(!/let lastProbeAt\s*=\s*null/.test(src), f + ' 无裸 lastProbeAt 单例')

  // 2) probe 走 REST 全量索引 + 返回 repo
  check(src.includes('issues?state=all&per_page=100'), f + ' probe 走 REST 全量 issue 索引（不占 GraphQL）')
  check(src.includes('fetchIssueIndex'), f + ' probe 使用轻量 issue 索引（覆盖删除事件）')
  check(/return \{ ok: true, changed: changed, repo: repo/.test(src), f + ' probe 返回 repo 字段（client 按 repo 刷新）')
  check(src.includes('lastIssueIndexByRepo'), f + ' probe 用按 repo 隔离的 issue 索引表')

  // 3) REST 降级
  check(src.includes('async function fetchMapsDetailREST'), f + ' 存在 REST 降级函数 fetchMapsDetailREST')
  check(src.includes('fetchMapsDetailREST(numbers, cwd)'), f + ' GraphQL RATE_LIMIT → 自动降级 REST')
  check(src.includes('sub_issues?per_page=100'), f + ' REST 降级用 sub_issues 端点')
  check(src.includes('dependencies/blocked_by'), f + ' REST 降级用 dependencies/blocked_by（fog 数据源）')
  check(src.includes("blockedBy: { nodes:"), f + ' REST 降级组装 blockedBy.nodes（与 GraphQL 同构）')
  check(src.includes("fallback: 'rest'"), f + ' 降级返回 fallback 标记')
  check(src.includes('fallback: d.fallback'), f + ' buildSnapshot 透传 fallback 标记')

  // 5) R2-fix-6：buildSnapshot 末尾**不再**初始化 lastProbeAtByRepo（避免 build 吞掉同窗口编辑）；
  //    基线只由 probe 检测到 change 时滑动
  check(!/lastProbeAtByRepo\[rk0\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src), f + ' buildSnapshot 末尾不再初始化 lastProbeAtByRepo（R2-fix-6：build 无权动基线）')
  check(/lastProbeAtByRepo\[rk1\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src), f + ' probe changed 时滑动 lastProbeAtByRepo 基线（since 基准线仅由 probe 推进）')
}

// ---- client 侧（client.js + package/lib/client.js）----
for (const f of ['client.js', 'package/lib/client.js']) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'

  // R2（#2 MVP）：probe 默认 60s（不再是 5min）
  check(src.includes('SYNC.FALLBACK_PROBE_MS') && /\|\| 60000\)/.test(src), f + ' probe 默认 60s（#232 节拍单源 · FALLBACK_PROBE_MS 兜底 60000）')
  check(!src.includes('PROBE_MS = 300000'), f + ' 无残留 5min 默认值（PROBE_MS 全部为 60000）')
  check(src.includes('SYNC.FOCUS_PROBE_MIN_MS') && /\|\| 60000\)/.test(src), f + ' focus 触发限流 ≥60s（#232 节拍单源 · FOCUS_PROBE_MIN_MS 兜底 60000）')
  // T10 R9 重构后 probe 逻辑位于 probeNow（startAutoProbe 仅剩定时器装配）——切片锚点随之更新
  // R2-fix-5（#2 MVP E2E）：changed 后 await primary（组内首个） 的 loadSnapshot 完成 → 组内快照复制 + emit（#45 按 cwd 隔离，组间不互串）
  const probeBlock = src.slice(src.indexOf('const probeNow'), src.indexOf('const startAutoProbe'))
  check(probeBlock.includes('loadSnapshot(') && probeBlock.includes('true, true).then'), f + ' changed 后 await primary/shared force 刷新（R2-fix-5 + #45 按组隔离）')
  check(probeBlock.includes('Object.keys(stores).forEach') || probeBlock.includes('group.slice'), f + ' changed 后把新快照复制到组内 store（R2-fix-5：组内广播，#45 隔离）')
  check(probeBlock.includes('st2.snapshot = newSnap'), f + ' 其他 store 直接赋值新快照（内存复制 · 零额外 GraphQL）')
  check(probeBlock.includes('emit(st2)'), f + ' 复制后 emit 每个 store（触发 React 重渲染）')
  check(!/sr\s*===\s*rep/.test(probeBlock), f + ' 无子集刷新残留（sr===rep 旧逻辑已随 R2-fix-5 移除）')
  check(!probeBlock.includes('loadSnapshot(st2, false, true)'), f + ' 无 per-store 非 force 重拉残留（R2-fix-5 已改内存复制）')
  check(!/Object\.keys\(stores\)\.forEach\(function \(k\) \{ loadSnapshot\(stores\[k\], true, true\) \}\)/.test(src), f + ' 无全 store 暴力刷新（原放大因子已移除）')
  check(!src.includes('setTimeout(function () { st._bgRefresh'), f + ' 无磁盘缓存秒开后的 400ms 强制全量刷新（每次开面板白烧 18 点已移除）')
}

// ---- 双源等价已移除（T5 #98：一源两物，src 为真源，产物由构建生成；双源一致性由 build.mjs 文本组合保证，不再断言）----
// 保留上方对单产物（_dev/_pkg 各自）的行为特征校验；B5/R2 契约现由 src↔产物 + 冒烟覆盖

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')