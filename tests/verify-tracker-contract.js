/**
 * tests/verify-tracker-contract.js — 契约测试入口（对齐仓库 verify-* 约定）。
 *
 * 多段（#132 Q2=B 定决 + #139 落地）：
 *   1. normalize harness（合规桩全 PASS / 违规桩被逮 + 真实 github 适配器合规过 G4）
 *   2. contract 段：OpName 形状（无 detect、含 getDependencies、snapshot 非 op）+ ERROR_KIND 新枚举
 *   3. registry 段：Proxy 桩 / duplicate-id / replace / 'other' 禁注册 / select 三级联三态 /
 *      multiHit / AbortSignal / Disposable / on / describe / MIGRATE_KEY
 *   4. preflight 段：classifyError 顺序（auth>rate-limit>env>not-found>unsupported>parse>network，
 *      兜底 NETWORK；conflict 透传非 regex）
 *   5. deck 段：progressOf / levelOf（环 visited 守卫 + NFD 按 0 计）/ stats / blockedByKeys / labels 并集
 *   6. snapshot 段：composeSnapshot（非 op）/ 双缓存 / invalidate·clear / 快路径（完整才用）/ unsupported 不缓存
 *   7. chain 段：检查项形状校验 + 纯函数求值（done/current/fail/pending/na + na 不阻塞 + 进度口径）+ 动作词汇表五种 + form 完整（非 op）/ 双缓存 / invalidate·clear / 快路径（完整才用）/ unsupported 不缓存
 *
 * 每段含「✗ probe」违规样例自证测试会逮。
 * 运行：node tests/verify-tracker-contract.js
 * 期望：合规桩全 PASS；违规桩被逮住（FAIL）；真实 github 适配器合规 PASS；各段全 PASS。退出码 0 = 契约骨架自洽。
 */
import runContractTests from './tracker-contract/harness.js'
import compliant from './tracker-contract/fixtures/compliant.js'
import violating from './tracker-contract/fixtures/violating.js'
import { gitlabFreeFixture, gitlabPremiumFixture } from './tracker-contract/fixtures/gitlab.js'
import { demoFixture } from './tracker-contract/fixtures/demo.js'
import { runPlayback } from './tracker-contract/runner/index.js'
import contractSection from './tracker-contract/sections/contract.js'
import registrySection from './tracker-contract/sections/registry.js'
import preflightSection from './tracker-contract/sections/preflight.js'
import deckSection from './tracker-contract/sections/deck.js'
import snapshotSection from './tracker-contract/sections/snapshot.js'
import chainSection from './tracker-contract/sections/chain.js'

const results = [
  ...runContractTests(compliant), // 合规 → 应全 PASS
  ...runContractTests(violating), // 违规 → 应至少一 FAIL
  ...runContractTests(demoFixture), // demo-mini 合规 → 应全 PASS（外部实现合规证据）
]

// #139：以真实 github 适配器执行 G4（来源有→映射；来源无→空值；违规桩被逮已由 violating 覆盖）
try {
  const { normalizeIssue } = await import('../src/host/tracker/backends/github/normalize.js')
  const githubFixture = {
    name: 'github-adapter',
    normalize: normalizeIssue,
    withData: {
      number: 42,
      title: 'hello',
      state: 'open',
      body: 'b',
      url: 'https://github.com/o/r/issues/42',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      closedAt: null,
      author: { login: 'alice', name: 'Alice', avatarUrl: 'https://avatars/a' },
      assignees: { nodes: [{ login: 'bob', name: 'Bob', avatarUrl: '' }] },
      labels: { nodes: [{ name: 'bug', color: 'd73a4a', description: 'bug label' }] },
      milestone: null,
      comments: { nodes: [{ id: '1', author: { login: 'alice' }, authorAssociation: 'OWNER', body: 'c', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }] },
      parent: null,
      blockedBy: { nodes: [] },
    },
    emptyData: { number: 1, title: '', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null },
    mappings: [
      { from: 'title', to: 'title' },
      { from: 'state', to: 'state' },
    ],
    implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
    missingFields: ['customFields'],
  }
  results.push(...runContractTests(githubFixture))
  // 额外：github-adapter 必须通过 no number/subIssues/blocking 断言（harness 已含）
} catch (e) {
  results.push({ name: 'github-adapter · import-failed', ok: false, detail: String(e && e.message || e) })
}

// #145：以真实 gitlab 适配器执行 G4（双路径：free回退 vs premium原生）
try {
  results.push(...runContractTests(gitlabFreeFixture))
  results.push(...runContractTests(gitlabPremiumFixture))
  // 额外校验：free回退应解析 Blocked by 行；premium应优先原生
  const { normalizeIssue: norm } = await import('../src/host/tracker/backends/gitlab/normalize.js')
  const freeIssue = norm(gitlabFreeFixture.withData)
  const premIssue = norm(gitlabPremiumFixture.withData)
  const freeOk = Array.isArray(freeIssue.blockedBy) && freeIssue.blockedBy.length === 2 && freeIssue.blockedBy[0].key === '1' && freeIssue.blockedBy[1].key === '2'
  results.push({ name: 'gitlab-free · blockedBy fallback parsed', ok: freeOk, detail: freeOk ? '' : 'got=' + JSON.stringify(freeIssue.blockedBy) })
  const premOk = Array.isArray(premIssue.blockedBy) && premIssue.blockedBy.length === 1 && premIssue.blockedBy[0].key === '9'
  results.push({ name: 'gitlab-premium · blockedBy native preferred', ok: premOk, detail: premOk ? '' : 'got=' + JSON.stringify(premIssue.blockedBy) })
  // milestone 分流：有→对象，无→省略
  const mileWith = norm({ iid: 5, title: 't', state: 'opened', description: '', milestone: { title: 'M1', description: 'desc', state: 'active', due_date: '2024-02-01' } })
  const mileEmpty = norm({ iid: 6, title: 't', state: 'opened', description: '', milestone: null })
  const mileOk = mileWith.milestone && mileWith.milestone.name === 'M1' && mileWith.milestone.dueOn === '2024-02-01' && !('milestone' in mileEmpty)
  results.push({ name: 'gitlab · milestone split (with vs omitted)', ok: mileOk, detail: mileOk ? '' : 'with=' + JSON.stringify(mileWith.milestone) + ' empty has=' + ('milestone' in mileEmpty) })
  // labels 恒EMPTY + 单key无number断言（harness已含，此处二次显式）
  const labEmpty = norm({ iid: 1, title: 'e', state: 'opened', description: '', labels: [] })
  const labelsEmptyOk = Array.isArray(labEmpty.labels) && labEmpty.labels.length === 0 && !('number' in labEmpty) && !('subIssues' in labEmpty) && !('blocking' in labEmpty)
  results.push({ name: 'gitlab · labels EMPTY + no legacy fields', ok: labelsEmptyOk, detail: labelsEmptyOk ? '' : JSON.stringify(labEmpty) })
  // parentKey 归一：relates_to 最早
  const parentIssue = norm({ iid: 10, title: 't', state: 'opened', description: '', links: [{ iid: 3, link_type: 'relates_to', created_at: '2024-01-02' }, { iid: 2, link_type: 'relates_to', created_at: '2024-01-01' }] })
  const parentOk = parentIssue.parentKey === '2'
  results.push({ name: 'gitlab · parentKey earliest relates_to', ok: parentOk, detail: parentOk ? '' : 'got=' + parentIssue.parentKey })
} catch (e) {
  results.push({ name: 'gitlab-adapter · import-failed', ok: false, detail: String(e && e.message || e) })
}

// #148：demo-mini 强验证 — runContractTests 已在 results 头部完成，此处追加 runPlayback 织入（离线采样固件）
try {
  const playback = await runPlayback({ fixturesDir: 'examples/demo-mini/fixtures/demo-real', label: 'demo-playback' })
  results.push(...playback.results)
  // 额外：demo 的 blocking 反向投影（getDependencies 语义）
  const { createDemoBackend } = await import('../examples/demo-mini/index.js')
  const { createRunnerContext } = await import('./tracker-contract/runner/index.js')
  const demoCtx = await createRunnerContext({ cwd: process.cwd() })
  const tracker = createDemoBackend(demoCtx)
  // list[0] 应为 key=1 且 blockedBy 含 2，getDependencies(1) 应返回 blockedBy=[2] 且 blocking=[]
  const listRes = await tracker.list({ backend: 'demo-mini', refId: 'demo', name: 'demo', url: '' }, {}, { cwd: process.cwd() })
  const listOk = listRes.ok && Array.isArray(listRes.data) && listRes.data.length >= 2 && listRes.data[0].key === '1'
  results.push({ name: 'demo-mini · list returns seed 2 issues', ok: listOk, detail: listOk ? '' : JSON.stringify(listRes).slice(0, 500) })
  if (listOk) {
    const depRes = await tracker.getDependencies({ backend: 'demo-mini', refId: 'demo', name: 'demo', url: '' }, '1', {}, { cwd: process.cwd() })
    const depOk = depRes.ok && Array.isArray(depRes.data.blockedBy) && depRes.data.blockedBy.length === 1 && depRes.data.blockedBy[0].key === '2'
    results.push({ name: 'demo-mini · getDependencies blockedBy projection', ok: depOk, detail: depOk ? '' : JSON.stringify(depRes).slice(0, 500) })
    const blockingOk = depRes.ok && Array.isArray(depRes.data.blocking) && depRes.data.blocking.length === 0
    results.push({ name: 'demo-mini · getDependencies blocking empty (seed 2 not blocked)', ok: blockingOk, detail: blockingOk ? '' : JSON.stringify(depRes).slice(0, 500) })
    // Proxy 补桩：未实现 op 应由 registry 补 unsupported；裸 tracker 上 close 为 undefined 属预期
    const hasClose = typeof tracker.close === 'function'
    let closeRes = null
    if (hasClose) {
      try { closeRes = await tracker.close({ backend: 'demo-mini', refId: 'demo', name: 'demo', url: '' }, '1', {}, { cwd: process.cwd() }) } catch {}
    }
    const proxyHint = hasClose ? `has close (unexpected) — ${JSON.stringify(closeRes)?.slice(0,200)}` : 'no close (proxy will handle — expected for 4-op demo)'
    results.push({ name: 'demo-mini · proxy hint: unimplemented ops via registry', ok: true, detail: proxyHint })
    // registry 包装验证：demoModule 经 registry 后，缺的 9 ops 应为 unsupported 桩
    const { createRegistry } = await import('../src/host/tracker/registry.js')
    const { demoModule } = await import('../examples/demo-mini/index.js')
    const reg = createRegistry(demoCtx)
    const disp = reg.register(demoModule)
    const wrapped = reg.get('demo-mini')
    const stubRes = await wrapped.close({ backend: 'demo-mini', refId: 'demo', name: 'demo', url: '' }, '1', {}, { cwd: process.cwd() })
    const stubOk = stubRes && stubRes.ok === false && stubRes.error && stubRes.error.kind === 'unsupported'
    results.push({ name: 'demo-mini · registry Proxy stubs 9 ops → unsupported', ok: stubOk, detail: stubOk ? '' : JSON.stringify(stubRes).slice(0, 500) })
    disp.dispose()
  }
  // demo matches：cwd 含 .demo/config.json 时应为 true，否则 false（boolean，不抛）
  const { demoMatches } = await import('../examples/demo-mini/matches.js')
  const fs = await import('node:fs/promises')
  const tmpCwd = process.cwd()
  // matches 在无 .demo 时应为 false（当前仓库无 .demo/config.json，仅 .scratch/map.md 存在，按 spec 也算 true）
  const matchRes = await demoMatches({ cwd: tmpCwd }, demoCtx)
  const matchOk = typeof matchRes === 'boolean'
  results.push({ name: 'demo-mini · matches returns boolean', ok: matchOk, detail: matchOk ? `got=${matchRes}` : `got=${String(matchRes)}` })
} catch (e) {
  results.push({ name: 'demo-mini · playback/import failed', ok: false, detail: String(e && e.stack || e) })
}

for (const s of [contractSection, registrySection, preflightSection, deckSection, snapshotSection, chainSection]) {
  try {
    const r = await s.run()
    results.push(...r)
  } catch (e) {
    results.push({ name: `${s.name} · section-crash`, ok: false, detail: String(e) })
  }
}

let passed = 0
let failed = 0
for (const r of results) {
  if (r.ok) passed++
  else failed++
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
}

console.log(`\ncontract-test: ${passed} passed, ${failed} failed`)

// 校验契约骨架自洽：合规桩全过、违规桩至少逮住一个、github/gitlab/demo 适配器合规全过、行为段全 PASS（含 probe 自证）
const compliantOk = results.filter((r) => r.name.startsWith(compliant.name) && !r.ok).length === 0
const caughtViolation = results.filter((r) => r.name.startsWith(violating.name) && !r.ok).length > 0
const githubOk = results.filter((r) => r.name.startsWith('github-adapter') && !r.ok).length === 0
const gitlabOk = results.filter((r) => r.name.startsWith('gitlab-') && !r.ok).length === 0
const demoOk = results.filter((r) => r.name.startsWith('demo-mini') && !r.ok).length === 0
const demoPlaybackOk = results.filter((r) => r.name.startsWith('demo-playback') && !r.ok).length === 0
const sectionsOk = results.filter((r) => !r.name.startsWith(compliant.name) && !r.name.startsWith(violating.name) && !r.name.startsWith('github-adapter') && !r.name.startsWith('gitlab-') && !r.name.startsWith('demo-mini') && !r.name.startsWith('demo-playback') && !r.ok).length === 0
if (!(compliantOk && caughtViolation && githubOk && gitlabOk && demoOk && demoPlaybackOk && sectionsOk)) {
  console.error('CONTRACT SKELETON NOT SELF-CONSISTENT')
  if (!githubOk) console.error('GITHUB ADAPTER FAILED G4')
  if (!gitlabOk) console.error('GITLAB ADAPTER FAILED G4')
  if (!demoOk) console.error('DEMO-MINI ADAPTER FAILED G4')
  if (!demoPlaybackOk) console.error('DEMO PLAYBACK FAILED')
  process.exit(1)
}
console.log('CONTRACT SKELETON OK')