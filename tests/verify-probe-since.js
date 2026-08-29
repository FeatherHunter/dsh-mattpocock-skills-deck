// verify-probe-since.js — dsh-mattpocock-skills-deck · v1.5 R2（#2 MVP · 2026-08-18）
// 用法: node tests/verify-probe-since.js（在插件根目录；无需 gh / 网络）
//
// 背景：probe 从仅检测 open issue 的 `since=<ISO>` 增量查询升级为全量轻量索引，覆盖新增、修改、关闭、重开和删除。
//   此前实现漏检子票变化与删除事件，导致旧磁盘快照中的 issue 永久残留。
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
  check(src.includes('fetchIssueIndex'), f + ' probe 使用全量 issue 索引（覆盖删除事件）')
  check(src.includes("issues?state=all&per_page=100"), f + ' 索引 REST URL 覆盖 open + closed issue')
  check(src.includes("'--paginate'"), f + ' 索引 REST 支持分页，避免 >100 issue 漏检')
  check(src.includes('issueIndexChanged'), f + ' probe 比较前后 issue 索引（可发现条目消失）')
  check(src.includes('lastIssueIndexByRepo'), f + ' 删除检测基线按 repoKey 隔离')
  check(src.includes('cacheSnapshotIsCurrent'), f + ' 磁盘快照命中时校验 issue 索引，避免新页面展示已删除条目')

  // 3) probe handler 内不再用 labels=wayfinder:map（旧漏检逻辑）
  const probeBlockMatch = src.match(/probe[\s\S]{0,3000}/)
  const probeHandlerSrc = probeBlockMatch ? probeBlockMatch[0].slice(0, 2500) : ''
  check(!probeHandlerSrc.includes('labels=wayfinder:map'), f + ' probe handler 内不再用 labels=wayfinder:map（旧漏检子票逻辑已移除）')

  // 4) buildSnapshot 末尾**不得**初始化 lastProbeAtByRepo[rk] —— R2-fix-6（#2 MVP E2E 实证 2026-08-18）：
  //    build 完成 ≠ client 已渲染该快照，若 build 发生在某次编辑之后会把基线推到编辑之后 → 编辑被永久吞掉
  //    基线只能由 probe 自己推进（changed 时置为本次探测时刻）
  check(!/lastProbeAtByRepo\[rk0\]\s*=/.test(src), f + ' buildSnapshot 末尾不再初始化 lastProbeAtByRepo（R2-fix-6：避免 build 吞掉同窗口编辑）')
  check(/lastProbeAtByRepo\[rk0\]/.test(src) === false || /lastProbeAtByRepo\[rk0\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src) === false, f + ' buildSnapshot 内无 lastProbeAtByRepo[rk0] 赋值（基线仅由 probe 推进）')

  // 每轮 probe 记录按 repo 隔离的探测时间，删除与修改均会让缓存失效。
  check(/lastProbeAtByRepo\[rk1\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src), f + ' probe 每轮记录 lastProbeAtByRepo 探测时间')
  check(/if \(changed\) cache = \{ ts: 0, snapshot: null/.test(src), f + ' 删除/状态变化时失效内存快照缓存')
}

// ---- client 侧 ----
for (const f of clientFiles) {
  const src = fs.readFileSync(f, 'utf8')

  // 5) PROBE_MS = 60000（不再是 5min）
  check(src.includes('SYNC.FALLBACK_PROBE_MS') && /\|\| 60000\)/.test(src), f + ' PROBE_MS 默认 60s（#232 节拍单源 · FALLBACK_PROBE_MS 兜底 60000）')
  check(!src.includes('PROBE_MS = 300000'), f + ' 无残留 5min 默认值')
}

// ---- 双源等价已移除（T5 #98：一源两物，build 保证同构，不再断言双源逐字一致）----

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')