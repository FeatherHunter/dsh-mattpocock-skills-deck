/**
 * tests/verify-tracker-contract.ts — 契约测试入口（对齐仓库 verify-* 约定）。
 *
 * 多段（#132 Q2=B 定决 + #139 落地）：
 *   1. normalize harness（合规桩全 PASS / 违规桩被逮 + 真实 github 适配器合规过 G4）
 *   2. contract 段：OpName 形状（无 detect、含 getDependencies、snapshot 非 op）+ ERROR_KIND 新枚举
 *   3. registry 段：Proxy 桩 / duplicate-id / replace / 'other' 禁注册 / select 三级联三态 /
 *      multiHit / AbortSignal / Disposable / on / describe / MIGRATE_KEY；
 *      链接三件事只转发不代造（#1112：后端没给、抛错、或没注册这个 id 时，拼票地址与按名搜仓库回空、
 *      认票写法回 null；后端自己给了就原样转出，模块静态属性与实例旁路两条来源都验）。
 *   4. preflight 段：classifyError 顺序（auth>rate-limit>env>not-found>unsupported>parse>network，
 *      兜底 NETWORK；conflict 透传非 regex）
 *   5. deck 段：progressOf / levelOf（环 visited 守卫 + NFD 按 0 计）/ stats / blockedByKeys / labels 并集
 *   6. snapshot 段：composeSnapshot（非 op）/ 双缓存 / invalidate·clear / 快路径（完整才用）/ unsupported 不缓存
 *   7. chain 段：检查项形状校验 + 纯函数求值（done/current/fail/pending/na + na 不阻塞 + 进度口径）+ 动作词汇表五种 + form 完整（非 op）/ 双缓存 / invalidate·clear / 快路径（完整才用）/ unsupported 不缓存
 *   8. labels 段（#627）：标签配色两条操作（listLabels / setLabelColors）—— 同一段断言跑三个假身
 *      （做不到的、GitHub、本地 Markdown）＋ 真实 gitlab 后端（自动落「做不到」）：
 *      列表项字段形状、颜色六位小写、描述缺省合法、「全部标签」的语义（含取不全必须整体失败）、
 *      批量改色逐条记账、每类失败落在哪一档、沙箱拒绝能单独辨认；
 *      另有对着真实 GitHub 与本地 Markdown 后端模块的探针（诚实说做不到 或 检查器全过）与
 *      宿主两条电话的信封与分档断言；每段自带反例。
 *   9. counts 段（#689）：后端计数这条操作 —— 做不到的后端诚实说做不到、能计数的三个数形状与自洽、
 *      数不全时整体失败、真实 GitHub 模块「要么诚实失败要么数字给对」（含带 errors 与缺 totalCount
 *      两次必须失败的验真）；另有编排层把 counts 写进 deck 的那一段，见 sections/snapshot.js。
 *  10. idempotency 段（#711）：创建幂等锚 —— 同一个锚提交两次只多出一张票、返回同一个 key（两次提交
 *      之间把全部进程内状态丢掉，换一个全新后端实例），不带锚时仍是每次新建；真实本地 Markdown
 *      后端上把票文件读出来看锚在不在、第二次盘上文件数与修改时间都没变；真实 GitHub / GitLab 模块
 *      上验锚进了远端请求正文、以及搜索没命中时靠「列出来逐张读票面」照样复用；回查拿不准时如实
 *      失败、一张票都不建。见 sections/idempotency.js。
 *  11. object-kind 段（#1403 T1 / #1408）：同一份「首行幂等锚、第二行规格标记」的正文，
 *      GitHub 房、GitLab 房、本地 Markdown 房归一化后的对象类型一致判成 spec；标记落在
 *      首个标题之后或与别的字挤在同一行，三家都判 issue。见 sections/object-kind.ts。
 *  12. list-state 段（#1796）：列表的状态筛下推到查询 —— list({state:'open'}) 两类票都只查 OPEN、
 *      list({state:'closed'}) 拉取请求要 CLOSED+MERGED、不带 state 时状态齐全；
 *      GraphQL 失败走 REST 时请求地址带 state 与按更新时间倒序。见 sections/list-state.ts。
 *
 * 每段含「✗ probe」违规样例自证测试会逮。
 * 运行：node tests/verify-tracker-contract.ts
 * 期望：合规桩全 PASS；违规桩被逮住那 4 条预期失败（见文件末尾 VIOLATING_EXPECTED_FAILURES，按名字点名）；
 *      真实 github 适配器合规 PASS；各段全 PASS。退出码 0 = 契约骨架自洽。
 */
import runContractTests from './tracker-contract/harness.js'
import compliant from './tracker-contract/fixtures/compliant.js'
import violating from './tracker-contract/fixtures/violating.js'
import { gitlabFreeFixture, gitlabPremiumFixture } from './tracker-contract/fixtures/gitlab.js'
import { demoFixture } from './tracker-contract/fixtures/demo.js'
import { giteaMinimalFixture, giteaMinimalHiddenFixture, giteaMinimalVisibleFixture } from './tracker-contract/fixtures/gitea.js'
import { runPlayback } from './tracker-contract/runner/index.js'
import contractSection from './tracker-contract/sections/contract.js'
import registrySection from './tracker-contract/sections/registry.js'
import preflightSection from './tracker-contract/sections/preflight.js'
import deckSection from './tracker-contract/sections/deck.js'
import snapshotSection from './tracker-contract/sections/snapshot.js'
import chainSection from './tracker-contract/sections/chain.js'
import labelsSection from './tracker-contract/sections/labels.js'
import countsSection from './tracker-contract/sections/counts.js'
import listPageSection from './tracker-contract/sections/listPage.js'
import idempotencySection from './tracker-contract/sections/idempotency.js'
import roomGitlabExtrasSection from './tracker-contract/sections/room-gitlab-extras.js'
import objectKindSection from './tracker-contract/sections/object-kind.js'
import listStateSection from './tracker-contract/sections/list-state.js'

const results = [
  ...runContractTests(compliant), // 合规 → 应全 PASS
  ...runContractTests(violating), // 违规 → 应至少一 FAIL
  ...runContractTests(demoFixture), // demo-mini 合规 → 应全 PASS（外部实现合规证据）
]

// #139：以真实 github 适配器执行 G4（来源有→映射；来源无→空值；违规桩被逮已由 violating 覆盖）
try {
  const { normalizeIssue } = await import('../src/tracker/rooms/github/model/normalize.ts')
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
    // #1688 起 comments/blockedBy 走字段三态：emptyData 没表达这两组时票上省略字段（不再编空值），
    // 所以它们不再算「无数据也必在」的能力位；有数据时字段照常在（withData 已覆盖）。
    implementedFields: ['labels', 'assignees', 'reason'],
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
  const { normalizeIssue: norm } = await import('../src/tracker/rooms/gitlab/model/normalize.js')
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
  // parentKey 归一（#1599 起）：文件头隐藏标记 `<!-- DSH-PARENT: <地图> -->` 是第一判据，
  // 旧 `Part of #<地图>` 可见行过渡期回退认；links 表一次都不认
  // （GitLab 原生层级挂不上 issue 到 issue，relates_to 又是对称平级关联分不出谁是父）。
  const parentIssue = norm({ iid: 10, title: 't', state: 'opened', description: '<!-- DSH-PARENT: 7 -->\n\n正文', links: [{ iid: 3, link_type: 'relates_to', created_at: '2024-01-02' }, { iid: 2, link_type: 'relates_to', created_at: '2024-01-01' }] })
  const parentOk = parentIssue.parentKey === '7'
  results.push({ name: 'gitlab · parentKey from hidden marker', ok: parentOk, detail: parentOk ? '' : 'got=' + parentIssue.parentKey })
  // 过渡期：只有旧声明行、没有隐藏标记 → 回退认（存量票双读可用）。
  const legacyIssue = norm({ iid: 12, title: 't', state: 'opened', description: 'Part of #7\n\n正文', links: [] })
  const legacyOk = legacyIssue.parentKey === '7'
  results.push({ name: 'gitlab · parentKey legacy Part-of fallback', ok: legacyOk, detail: legacyOk ? '' : 'got=' + legacyIssue.parentKey })
  // 反例：只有 links、没有归属标记 → 归属不明，不许猜（回 null）。
  const orphanIssue = norm({ iid: 11, title: 't', state: 'opened', description: '普通正文', links: [{ iid: 2, link_type: 'relates_to', created_at: '2024-01-01' }] })
  const orphanOk = orphanIssue.parentKey === null
  results.push({ name: 'gitlab · parentKey null without marker', ok: orphanOk, detail: orphanOk ? '' : 'got=' + orphanIssue.parentKey })
} catch (e) {
  results.push({ name: 'gitlab-adapter · import-failed', ok: false, detail: String(e && e.message || e) })
}

// #3：gitea 适配器走同一套 G4 契约（完整化口径：EMPTY/MISSING 分流、阻塞双路径、错误三档见 fixture 注释）
try {
  results.push(...runContractTests(giteaMinimalFixture))
  results.push(...runContractTests(giteaMinimalHiddenFixture))
  results.push(...runContractTests(giteaMinimalVisibleFixture))
  const { normalizeIssue: normGitea } = await import('../src/tracker/rooms/gitea/model/normalize.js')
  // 额外：单 key 必须来自 index 且永不产 number 字段（tea 回包口径，harness 已含，此处二次显式）
  const gi = normGitea({ index: 7, title: 't', state: 'closed', closed_at: '2024-02-01T00:00:00Z' })
  const giteaKeyOk = gi.key === '7' && !('number' in gi) && gi.state === 'closed' && gi.closedAt === '2024-02-01T00:00:00Z'
  results.push({ name: 'gitea-minimal · key from index + no legacy fields', ok: giteaKeyOk, detail: giteaKeyOk ? '' : 'key=' + gi.key + ' number=' + ('number' in gi) + ' state=' + gi.state })
  // parentKey 双路径：隐藏标记是第一判据，旧 `Part of #n` 可见行过渡期回退认；都没有时归 null。
  const gParent = normGitea({ index: 10, title: 't', state: 'open', body: '<!-- DSH-PARENT: 7 -->\n\n正文' })
  const gParentOk = gParent.parentKey === '7'
  results.push({ name: 'gitea-minimal · parentKey from hidden marker', ok: gParentOk, detail: gParentOk ? '' : 'got=' + String(gParent.parentKey) })
  const gLegacy = normGitea({ index: 12, title: 't', state: 'open', body: 'Part of #7\n\n正文' })
  const gLegacyOk = gLegacy.parentKey === '7'
  results.push({ name: 'gitea-minimal · parentKey legacy Part-of fallback', ok: gLegacyOk, detail: gLegacyOk ? '' : 'got=' + String(gLegacy.parentKey) })
  const gOrphan = normGitea({ index: 11, title: 't', state: 'open', body: '普通正文' })
  const gOrphanOk = gOrphan.parentKey === null
  results.push({ name: 'gitea-minimal · parentKey null without marker', ok: gOrphanOk, detail: gOrphanOk ? '' : 'got=' + String(gOrphan.parentKey) })
  // blockedBy 双写时隐藏机器表优先：正文同时有隐藏表与可见行，读到的是隐藏表那两条（title 带井号前缀）。
  const gBoth = normGitea({ index: 13, title: 't', state: 'open', body: '<!-- DSH-BLOCKED-BY: 1, 2 -->\n\nBlocked by: #8, #9\n\n正文' })
  const gBothOk = Array.isArray(gBoth.blockedBy) && gBoth.blockedBy.length === 2 && gBoth.blockedBy[0].key === '1' && gBoth.blockedBy[1].key === '2' && gBoth.blockedBy[0].title === '#1'
  results.push({ name: 'gitea-minimal · blockedBy hidden preferred over visible', ok: gBothOk, detail: gBothOk ? '' : 'got=' + JSON.stringify(gBoth.blockedBy) })
  // 可见行兜底：没有隐藏表时读可见行，title 保原文（不带井号前缀）。
  const gVis = normGitea(giteaMinimalVisibleFixture.withData)
  const gVisOk = Array.isArray(gVis.blockedBy) && gVis.blockedBy.length === 2 && gVis.blockedBy[0].key === '1' && gVis.blockedBy[0].title === '#1'
  results.push({ name: 'gitea-minimal-visible · blockedBy visible fallback kept title', ok: gVisOk, detail: gVisOk ? '' : 'got=' + JSON.stringify(gVis.blockedBy) })
  // 隐藏表夹具整票读回：parentKey 与 blockedBy 都来自文件头标记。
  const gHid = normGitea(giteaMinimalHiddenFixture.withData)
  const gHidOk = gHid.parentKey === '7' && Array.isArray(gHid.blockedBy) && gHid.blockedBy.length === 2
  results.push({ name: 'gitea-minimal-hidden · parent and blocked-by from markers', ok: gHidOk, detail: gHidOk ? '' : 'parent=' + String(gHid.parentKey) + ' blockedBy=' + JSON.stringify(gHid.blockedBy) })
  // milestone / author 分流：有→对象，无→省略（与 gitlab 房同一口径）。
  const gMile = normGitea({ index: 5, title: 't', state: 'open', body: '', milestone: { title: 'M1', description: 'desc', state: 'active', due_on: '2024-02-01' } })
  const gNoMile = normGitea({ index: 6, title: 't', state: 'open', body: '', milestone: null })
  const gMileOk = !!gMile.milestone && gMile.milestone.name === 'M1' && gMile.milestone.dueOn === '2024-02-01' && gMile.milestone.state === 'open' && !('milestone' in gNoMile)
  results.push({ name: 'gitea-minimal · milestone split (with vs omitted)', ok: gMileOk, detail: gMileOk ? '' : 'with=' + JSON.stringify(gMile.milestone) + ' empty has=' + ('milestone' in gNoMile) })
  const gAuthor = normGitea({ index: 5, title: 't', state: 'open', body: '', author: { login: 'alice', full_name: 'Alice' } })
  const gNoAuthor = normGitea({ index: 6, title: 't', state: 'open', body: '', author: null })
  const gAuthorOk = !!gAuthor.author && gAuthor.author.login === 'alice' && gAuthor.author.name === 'Alice' && !('author' in gNoAuthor)
  results.push({ name: 'gitea-minimal · author split (with vs omitted)', ok: gAuthorOk, detail: gAuthorOk ? '' : 'with=' + JSON.stringify(gAuthor.author) + ' empty has=' + ('author' in gNoAuthor) })
  // 评论映射（notes 数组 → Comment）与评论总数（comments 数字段 → commentCount，不拿数组长度冒充）。
  const gNotes = normGitea({ index: 5, title: 't', state: 'open', body: '', notes: [{ id: 3, author: { login: 'bob' }, body: 'n1', created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-03T00:00:00Z' }] })
  const gNotesOk = Array.isArray(gNotes.comments) && gNotes.comments.length === 1 && gNotes.comments[0].body === 'n1' && gNotes.comments[0].author.login === 'bob'
  results.push({ name: 'gitea-minimal · comments mapped from notes', ok: gNotesOk, detail: gNotesOk ? '' : 'got=' + JSON.stringify(gNotes.comments) })
  const gCount = normGitea({ index: 5, title: 't', state: 'open', body: '', comments: 4 })
  const gCountOk = gCount.commentCount === 4 && Array.isArray(gCount.comments) && gCount.comments.length === 0
  results.push({ name: 'gitea-minimal · commentCount from numeric comments field', ok: gCountOk, detail: gCountOk ? '' : 'count=' + String(gCount.commentCount) })
  // 错误三档：未登录（AUTH）、无仓库（NOT-FOUND）、网络失败（NETWORK 兜底）各断一次判档。
  const { classifyGiteaError } = await import('../src/tracker/rooms/gitea/errors.js')
  const errAuth = classifyGiteaError({ text: 'tea: no token found for gitea.example.com; run tea login add' })
  const errAuthOk = errAuth.kind === 'auth' && !errAuth.fallback
  results.push({ name: 'gitea-minimal · error not-logged-in classified auth', ok: errAuthOk, detail: errAuthOk ? '' : 'got=' + errAuth.kind + ' fallback=' + String(errAuth.fallback) })
  const errRepo = classifyGiteaError({ text: '404 repository does not exist [see: https://gitea.example/api/swagger]' })
  const errRepoOk = errRepo.kind === 'not-found' && !errRepo.fallback
  results.push({ name: 'gitea-minimal · error repo-missing classified not-found', ok: errRepoOk, detail: errRepoOk ? '' : 'got=' + errRepo.kind + ' fallback=' + String(errRepo.fallback) })
  const errNet = classifyGiteaError({ text: 'Get "https://gitea.example/api/v1/repos/o/r": dial tcp: lookup gitea.example: no such host' })
  const errNetOk = errNet.kind === 'network'
  results.push({ name: 'gitea-minimal · error network-failure classified network', ok: errNetOk, detail: errNetOk ? '' : 'got=' + errNet.kind + ' fallback=' + String(errNet.fallback) })

  // ── 票 #11：读路径真实现（假 tea exec 注入，钉解析与行为，不依赖活服务）──
  // 假 tea：按命令词汇表（support/tea-run.ts）识别三组读命令，回 JSON。state/labels 筛在假端模拟，
  // 页大小与页码按请求原样切片——门禁钉的是「我们怎么解析、怎么收窄」，不是 tea 本身。
  const { createGiteaBackend } = await import('../src/tracker/rooms/gitea/index.js')
  const baseIssues = [
    { index: 1, title: 'map root', state: 'open', body: '<!-- DSH-BLOCKED-BY: 3 -->\n\n正文', labels: [{ name: 'wayfinder:map', color: '8b5cf6' }], created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z', comments: 2, html_url: 'https://gitea.example/o/r/issues/1' },
    { index: 2, title: 'sub of 1', state: 'open', body: '<!-- DSH-PARENT: 1 -->\n\n正文', labels: [], created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-04T00:00:00Z', html_url: 'https://gitea.example/o/r/issues/2' },
    { index: 3, title: 'closed one', state: 'closed', closed_at: '2024-02-01T00:00:00Z', labels: [], created_at: '2024-01-05T00:00:00Z', updated_at: '2024-01-05T00:00:00Z', html_url: 'https://gitea.example/o/r/issues/3' },
  ]
  const commentsOfIssue1 = [
    { id: 9, author: { login: 'bob' }, body: 'c1', created_at: '2024-01-02T01:00:00Z', updated_at: '2024-01-02T01:00:00Z' },
    { id: 10, author: { login: 'carol' }, body: 'c2', created_at: '2024-01-02T02:00:00Z', updated_at: '2024-01-02T02:00:00Z' },
  ]
  const labelsStore = [
    { name: 'bug', color: '#d73a4a', description: 'bug label' },
    { name: 'wayfinder:map', color: '8b5cf6' },
  ]
  function argFlag(args, flag) {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  function makeFakeTea(overrides) {
    const calls = []
    return {
      calls,
      exec: async (cmd, args) => {
        calls.push({ cmd, args })
        const ov = overrides && overrides.reply ? overrides.reply({ cmd, args }) : null
        if (ov) return Object.assign({ stdout: '', stderr: '', code: 0 }, ov)
        if (cmd !== 'tea') return { stdout: '', stderr: 'unexpected cmd ' + cmd, code: 127 }
        if (args[0] === 'issues' && args[1] === 'ls') {
          const state = argFlag(args, '--state') || 'open'
          const labels = (argFlag(args, '--labels') || '').split(',').filter(Boolean)
          const limit = Number(argFlag(args, '--limit') || 50)
          const page = Number(argFlag(args, '--page') || 1)
          const refId = argFlag(args, '--repo') || ''
          let pool = refId === 'o/full' ? Array.from({ length: 100 }, (_, i) => ({ index: i + 1, title: 'filler ' + (i + 1), state: 'open', labels: [], created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z', html_url: 'https://gitea.example/o/full/issues/' + (i + 1) })) : baseIssues
          if (state !== 'all') pool = pool.filter((x) => x.state === state)
          for (const l of labels) pool = pool.filter((x) => (x.labels || []).some((y) => y.name === l))
          const start = (page - 1) * limit
          return { stdout: JSON.stringify(pool.slice(start, start + limit)), stderr: '', code: 0 }
        }
        if (args[0] === 'issues' && args[2] === 'comments') {
          return { stdout: JSON.stringify(commentsOfIssue1), stderr: '', code: 0 }
        }
        if (args[0] === 'issues') {
          const n = Number(args[1])
          const hit = baseIssues.find((x) => x.index === n)
          if (!hit) return { stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }
          return { stdout: JSON.stringify(hit), stderr: '', code: 0 }
        }
        if (args[0] === 'labels' && args[1] === 'ls') {
          const limit = Number(argFlag(args, '--limit') || 50)
          const page = Number(argFlag(args, '--page') || 1)
          const start = (page - 1) * limit
          return { stdout: JSON.stringify(labelsStore.slice(start, start + limit)), stderr: '', code: 0 }
        }
        return { stdout: '', stderr: 'unexpected args ' + args.join(' '), code: 127 }
      },
    }
  }
  const repo = { backend: 'gitea', refId: 'o/r', name: 'r', url: 'https://gitea.example/o/r' }
  // list：不带 state 显式要 all，三张都回；行按归一口径出 key/state。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.list(repo, undefined, fake)
    const ok = res.ok && res.data.length === 3 && res.data[0].key === '1' && !res.truncated
    results.push({ name: 'gitea-minimal · read list returns all rows without state filter', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
    const askedAll = fake.calls.length === 1 && fake.calls[0].args.includes('--state') && fake.calls[0].args[fake.calls[0].args.indexOf('--state') + 1] === 'all'
    results.push({ name: 'gitea-minimal · read list asks --state all explicitly', ok: askedAll, detail: askedAll ? '' : JSON.stringify(fake.calls) })
  }
  // list state 筛交远端：closed 只回第 3 张。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.list(repo, { state: 'closed' }, fake)
    const ok = res.ok && res.data.length === 1 && res.data[0].key === '3'
    results.push({ name: 'gitea-minimal · read list filters state closed', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // list 满页置 truncated（假仓 100 张满页）。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.list({ backend: 'gitea', refId: 'o/full', name: 'full', url: '' }, undefined, fake)
    const ok = res.ok && res.truncated === true && res.data.length === 100
    results.push({ name: 'gitea-minimal · read list marks truncated on full page', ok, detail: ok ? '' : 'truncated=' + String(res.ok && res.truncated) + ' n=' + String(res.ok && res.data.length) })
  }
  // get：票面归一（parentKey 来自正文标记）+ 评论总数来自数字字段。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.get(repo, '2', undefined, fake)
    const ok = res.ok && res.data.key === '2' && res.data.parentKey === '1' && res.data.commentCount === undefined
    results.push({ name: 'gitea-minimal · read get normalizes parent marker', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // get 带评论：first=1 只要一条正文，票1 的评论取 2 条回 1 条截断。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.get(repo, '1', { comments: { first: 1 } }, fake)
    const ok = res.ok && Array.isArray(res.data.comments) && res.data.comments.length === 1 && res.data.comments[0].body === 'c1' && res.data.commentCount === 2
    results.push({ name: 'gitea-minimal · read get fetches first-N comments', ok, detail: ok ? '' : JSON.stringify(res.data && res.data.comments).slice(0, 300) })
  }
  // counts：全仓 2 开 1 关；state 收窄 closed → {0,1,1}。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const all = await backend.counts(repo, undefined, fake)
    const allOk = all.ok && all.data.open === 2 && all.data.closed === 1 && all.data.total === 3
    results.push({ name: 'gitea-minimal · read counts totals 2/1/3', ok: allOk, detail: allOk ? '' : JSON.stringify(all).slice(0, 300) })
    const closed = await backend.counts(repo, { state: 'closed' }, fake)
    const closedOk = closed.ok && closed.data.open === 0 && closed.data.closed === 1 && closed.data.total === 1
    results.push({ name: 'gitea-minimal · read counts narrows state closed', ok: closedOk, detail: closedOk ? '' : JSON.stringify(closed).slice(0, 300) })
  }
  // listPage：limit=2 第一页两条 + nextCursor='2' + total=3；第二页一条 + nextCursor=null。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const p1 = await backend.listPage(repo, undefined, { limit: 2 }, fake)
    const p1Ok = p1.ok && p1.data.items.length === 2 && p1.data.nextCursor === '2' && p1.data.total === 3
    results.push({ name: 'gitea-minimal · read listPage first page cursor and total', ok: p1Ok, detail: p1Ok ? '' : JSON.stringify(p1).slice(0, 300) })
    const p2 = await backend.listPage(repo, undefined, { limit: 2, cursor: p1.ok ? p1.data.nextCursor : undefined }, fake)
    const p2Ok = p2.ok && p2.data.items.length === 1 && p2.data.nextCursor === null
    results.push({ name: 'gitea-minimal · read listPage last page null cursor', ok: p2Ok, detail: p2Ok ? '' : JSON.stringify(p2).slice(0, 300) })
  }
  // listLabels：颜色规整去井号、描述非空才带。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.listLabels(repo, fake)
    const ok = res.ok && res.data.length === 2 && res.data[0].name === 'bug' && res.data[0].color === 'd73a4a' && res.data[0].description === 'bug label' && !('description' in res.data[1])
    results.push({ name: 'gitea-minimal · read listLabels maps colors and optional description', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // listSubIssues：扫仓按 parentKey 挑出第 2 张；total/fetched 按扫描口径交。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.listSubIssues(repo, '1', undefined, fake)
    const ok = res.ok && res.data.items.length === 1 && res.data.items[0].key === '2' && res.data.fetched === 3 && res.data.total === 3 && res.data.capped === false && res.data.missing === 0 && res.data.dropped === 0
    results.push({ name: 'gitea-minimal · read listSubIssues picks by parent marker', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // listMaps：标签 wayfinder:map 那张回四格行。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.listMaps(repo, fake)
    const ok = res.ok && res.data.rows.length === 1 && res.data.rows[0].key === '1' && res.data.rows[0].title === 'map root' && res.data.rows[0].state === 'open' && res.data.total === 1 && res.data.truncated === false
    results.push({ name: 'gitea-minimal · read listMaps returns map rows', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // getDependencies：正文隐藏机器表解出 blockedBy=[3]，对端状态落实 closed；blocking 恒空。
  {
    const fake = makeFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.getDependencies(repo, '1', undefined, fake)
    const ok = res.ok && res.data.blockedBy.length === 1 && res.data.blockedBy[0].key === '3' && res.data.blockedBy[0].state === 'closed' && res.data.blockedBy[0].title === 'closed one' && Array.isArray(res.data.blocking) && res.data.blocking.length === 0
    results.push({ name: 'gitea-minimal · read getDependencies resolves blocker from marker', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
  }
  // 错误归档：远端 404 → not-found；假端断线 → network 兜底。
  {
    const fake = makeFakeTea({ reply: () => ({ stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }) })
    const backend = createGiteaBackend(fake)
    const res = await backend.list(repo, undefined, fake)
    const ok = !res.ok && res.error.kind === 'not-found'
    results.push({ name: 'gitea-minimal · read list repo-missing classified not-found', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeFakeTea({ reply: () => ({ stdout: '', stderr: 'Get "https://gitea.example/api/v1": dial tcp: no such host', code: 1 }) })
    const backend = createGiteaBackend(fake)
    const res = await backend.get(repo, '1', undefined, fake)
    const ok = !res.ok && res.error.kind === 'network'
    results.push({ name: 'gitea-minimal · read get network-failure classified network', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }

  // ── 票 #12：写路径真实现（可变内存店的假 tea，写命令真的改店，读回校验写的结果）──
  // 与读路径同一个判思路：门禁钉的是「我们怎么拼命令、怎么判档、写完怎么交契约形状」，
  // 不是 tea 本身；本机没有活 Gitea，全部行为用假 exec 层钉住。
  function makeWriteFakeTea() {
    const issues = baseIssues.map((x) => ({ ...x, labels: (x.labels || []).map((y) => ({ ...y })), notes: [] }))
    let nextIndex = 100
    const commentsAdded = []
    const calls = []
    return {
      calls,
      issues,
      commentsAdded,
      exec: async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd !== 'tea') return { stdout: '', stderr: 'unexpected cmd ' + cmd, code: 127 }
        const flags = (flag) => {
          const i = args.indexOf(flag)
          return i >= 0 ? args[i + 1] : undefined
        }
        // 读：列表与单票（与 makeFakeTea 同一套，但读的是可变店）。
        if (args[0] === 'issues' && args[1] === 'ls') {
          const state = flags('--state') || 'open'
          let pool = issues
          if (state !== 'all') pool = pool.filter((x) => x.state === state)
          const limit = Number(flags('--limit') || 50)
          const page = Number(flags('--page') || 1)
          return { stdout: JSON.stringify(pool.slice((page - 1) * limit, page * limit)), stderr: '', code: 0 }
        }
        if (args[0] === 'issues' && args[2] === 'comments') {
          const hit = issues.find((x) => x.index === Number(args[1]))
          return { stdout: JSON.stringify(hit && hit.notes ? hit.notes : []), stderr: '', code: 0 }
        }
        if (args[0] === 'issues' && args[1] === 'create') {
          const title = flags('--title') || ''
          if (!title) return { stdout: '', stderr: 'title is required', code: 1 }
          const idx = nextIndex++
          const labels = (flags('--labels') || '').split(',').filter(Boolean).map((n) => ({ name: n, color: '' }))
          const row = { index: idx, title, state: 'open', body: flags('--description') || '', labels, assignees: (flags('--assignees') || '').split(',').filter(Boolean).map((l) => ({ login: l })), created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z', html_url: 'https://gitea.example/o/r/issues/' + idx, comments: 0 }
          issues.push(row)
          // create 不认 --output：回包是含井号编号的一行文本（真机口径）。
          return { stdout: '已创建工单 #' + idx + ' ' + row.html_url, stderr: '', code: 0 }
        }
        if ((args[0] === 'issues' && (args[1] === 'close' || args[1] === 'reopen')) || (args[0] === 'issues' && args[1] === 'edit')) {
          const n = Number(args[2])
          const hit = issues.find((x) => x.index === n)
          if (!hit) return { stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }
          if (args[1] === 'close') { hit.state = 'closed'; hit.closed_at = '2026-11-11T01:00:00Z' }
          else if (args[1] === 'reopen') { hit.state = 'open'; delete hit.closed_at }
          else {
            // edit：只落实命令里给了的字段（add/remove/set 语义按 tea 实测）。
            const add = (flags('--add-labels') || '').split(',').filter(Boolean)
            const rm = (flags('--remove-labels') || '').split(',').filter(Boolean)
            hit.labels = (hit.labels || []).filter((y) => !rm.includes(y.name))
            for (const n2 of add) if (!hit.labels.some((y) => y.name === n2)) hit.labels.push({ name: n2, color: '' })
            if (typeof flags('--set-assignees') === 'string') hit.assignees = flags('--set-assignees').split(',').filter(Boolean).map((l) => ({ login: l }))
            if (typeof flags('--title') === 'string') hit.title = flags('--title')
            if (typeof flags('--description') === 'string') hit.body = flags('--description')
            if (typeof flags('--milestone') === 'string') hit.milestone = flags('--milestone') ? { title: flags('--milestone'), description: '', state: 'open' } : null
          }
          hit.updated_at = '2026-11-11T01:00:00Z'
          return { stdout: JSON.stringify(hit), stderr: '', code: 0 }
        }
        if (args[0] === 'comments' && args[1] === 'add') {
          const n = Number(args[2])
          const hit = issues.find((x) => x.index === n)
          if (!hit) return { stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }
          const c = { id: commentsAdded.length + 1, author: { login: 'tester' }, body: flags('--description') || '', created_at: '2026-11-11T02:00:00Z', updated_at: '2026-11-11T02:00:00Z' }
          commentsAdded.push(c)
          ;(hit.notes = hit.notes || []).push(c)
          hit.comments = (hit.comments || 0) + 1
          return { stdout: JSON.stringify(c), stderr: '', code: 0 }
        }
        if (args[0] === 'issues' && !Number.isNaN(Number(args[1]))) {
          const n = Number(args[1])
          const hit = issues.find((x) => x.index === n)
          if (!hit) return { stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }
          return { stdout: JSON.stringify(hit), stderr: '', code: 0 }
        }
        if (args[0] === 'labels' && args[1] === 'create') {
          const nm = flags('--name') || ''
          if (!nm) return { stdout: '', stderr: 'name is required', code: 1 }
          const color = (flags('--color') || '').replace('#', '')
          if (!labelsStore.some((l) => l.name === nm)) labelsStore.push({ name: nm, color })
          return { stdout: JSON.stringify({ name: nm, color }), stderr: '', code: 0 }
        }
        if (args[0] === 'labels' && args[1] === 'ls') return { stdout: JSON.stringify(labelsStore), stderr: '', code: 0 }
        return { stdout: '', stderr: 'unexpected args ' + args.join(' '), code: 127 }
      },
    }
  }
  // create：假店真的落了一张票，回查交契约形状；labels / assignees 逗号串交给命令。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.create(repo, { title: 'new one', body: 'hello', labels: ['bug'], assignees: ['alice'] }, fake)
    const ok = res.ok && res.data.key === '100' && res.data.title === 'new one' && res.data.body === 'hello'
    results.push({ name: 'gitea-minimal · write create lands issue and refetches', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
    const c = fake.calls.find((x) => x.args[1] === 'create')
    const argsOk = !!c && c.args.includes('--labels') && c.args[c.args.indexOf('--labels') + 1] === 'bug' && c.args.includes('--assignees') && c.args[c.args.indexOf('--assignees') + 1] === 'alice'
    results.push({ name: 'gitea-minimal · write create passes labels and assignees comma list', ok: argsOk, detail: argsOk ? '' : JSON.stringify(fake.calls) })
  }
  // create 带 parentKey：正文头写进隐藏归属标记（读回来 parentKey 就是它）。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.create(repo, { title: 'child', parentKey: '1' }, fake)
    const ok = res.ok && res.data.parentKey === '1'
    results.push({ name: 'gitea-minimal · write create writes hidden parent marker', ok, detail: ok ? '' : JSON.stringify({ ok: res.ok, parentKey: res.ok && res.data.parentKey }).slice(0, 300) })
  }
  // create 幂等键不合规：parse 拒绝、不发任何命令；合规键放行。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const bad = await backend.create(repo, { title: 'x', idempotencyKey: '坏 键!' }, fake)
    const badOk = !bad.ok && bad.error.kind === 'parse' && fake.calls.length === 0
    results.push({ name: 'gitea-minimal · write create rejects invalid idempotency key before any call', ok: badOk, detail: badOk ? '' : JSON.stringify({ bad: bad.ok ? null : bad.error, calls: fake.calls.length }).slice(0, 300) })
    const good = await backend.create(repo, { title: 'y', idempotencyKey: 'deck-12-anchor' }, fake)
    const goodOk = good.ok && fake.calls.some((x) => x.args[1] === 'create')
    results.push({ name: 'gitea-minimal · write create accepts valid idempotency key', ok: goodOk, detail: goodOk ? '' : JSON.stringify(good).slice(0, 300) })
  }
  // create 错误三档自证：未登录 → auth；无仓库 → not-found；断线 → network。
  {
    const fake = makeWriteFakeTea()
    fake.exec = (async (cmd, args) => ({ stdout: '', stderr: 'tea: no token found for gitea.example.com; run tea login add', code: 1 }))
    const backend = createGiteaBackend(fake)
    const res = await backend.create(repo, { title: 'x' }, fake)
    const ok = !res.ok && res.error.kind === 'auth'
    results.push({ name: 'gitea-minimal · write create not-logged-in classified auth', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    fake.exec = (async (cmd, args) => {
      if (args[1] === 'create') return { stdout: '', stderr: '404 repository does not exist [see: docs]', code: 1 }
      const hit = fake.issues.find((x) => x.index === 1)
      return { stdout: JSON.stringify(hit), stderr: '', code: 0 }
    })
    const backend = createGiteaBackend(fake)
    const res = await backend.create(repo, { title: 'x' }, fake)
    const ok = !res.ok && res.error.kind === 'not-found'
    results.push({ name: 'gitea-minimal · write create repo-missing classified not-found', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    fake.exec = (async () => ({ stdout: '', stderr: 'Get "https://gitea.example/api/v1": dial tcp: no such host', code: 1 }))
    const backend = createGiteaBackend(fake)
    const res = await backend.create(repo, { title: 'x' }, fake)
    const ok = !res.ok && res.error.kind === 'network'
    results.push({ name: 'gitea-minimal · write create network-failure classified network', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  // close / reopen：写命令真的改店，回包交归一票面（state 对得上）。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const closed = await backend.close(repo, '1', undefined, fake)
    const closedOk = closed.ok && closed.data.key === '1' && closed.data.state === 'closed'
    results.push({ name: 'gitea-minimal · write close flips state to closed', ok: closedOk, detail: closedOk ? '' : JSON.stringify(closed).slice(0, 300) })
    const reopened = await backend.reopen(repo, '3', fake)
    const reopenedOk = reopened.ok && reopened.data.key === '3' && reopened.data.state === 'open'
    results.push({ name: 'gitea-minimal · write reopen flips state to open', ok: reopenedOk, detail: reopenedOk ? '' : JSON.stringify(reopened).slice(0, 300) })
    const closeCall = fake.calls.find((x) => x.args[1] === 'close')
    const reopenCall = fake.calls.find((x) => x.args[1] === 'reopen')
    const wordsOk = !!closeCall && closeCall.args[0] === 'issues' && !!reopenCall && reopenCall.args[0] === 'issues'
    results.push({ name: 'gitea-minimal · write close/reopen use issues subcommand', ok: wordsOk, detail: wordsOk ? '' : JSON.stringify(fake.calls) })
  }
  // update：title+body 走一条 issues edit；空补丁不发写命令只回读。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.update(repo, '1', { title: 'renamed', body: 'new body' }, fake)
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const ok = res.ok && res.data.title === 'renamed' && res.data.body === 'new body' && !!editCall && editCall.args.includes('--title') && editCall.args.includes('--description')
    results.push({ name: 'gitea-minimal · write update edits title and body', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) + ' calls=' + JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.update(repo, '1', {}, fake)
    const ok = res.ok && res.data.key === '1' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write update empty patch reads back without write', ok, detail: ok ? '' : JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.update(repo, '1', { customFields: [{ name: 'f', value: '1' }] }, fake)
    const ok = !res.ok && res.error.kind === 'unsupported' && fake.calls.length === 0
    results.push({ name: 'gitea-minimal · write update customFields unsupported without any call', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  // setLabels：差集写（现有 bug，目标 bug+p1 → 只 add p1）；目标一致不发写；expectedUpdatedAt 对不上回 conflict 不写。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabels(repo, '1', ['wayfinder:map', 'p1'], undefined, fake)
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const ok = res.ok && !!editCall && editCall.args.includes('--add-labels') && editCall.args[editCall.args.indexOf('--add-labels') + 1] === 'p1' && !editCall.args.includes('--remove-labels')
    results.push({ name: 'gitea-minimal · write setLabels diffs add only', ok, detail: ok ? '' : JSON.stringify({ res: res.ok ? res.data.labels : res, calls: fake.calls.map((x) => x.args.slice(0, 4)) }).slice(0, 400) })
  }
  // setLabels：仓库里还没有的标签先建再挂（tea 对不存在的标签静默跳过，真机 2026-11-11 口径）。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabels(repo, '1', ['brand-new'], undefined, fake)
    const createCall = fake.calls.find((x) => x.args[0] === 'labels' && x.args[1] === 'create')
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const ok = res.ok && !!createCall && createCall.args.includes('brand-new') && !!editCall && editCall.args.includes('--add-labels') && res.data.labels.some((l) => l.name === 'brand-new')
    results.push({ name: 'gitea-minimal · write setLabels auto-creates missing label then attaches', ok, detail: ok ? '' : JSON.stringify({ res: res.ok ? res.data.labels : res, calls: fake.calls.map((x) => x.args.slice(0, 4)) }).slice(0, 400) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabels(repo, '1', ['wayfinder:map'], undefined, fake)
    const ok = res.ok && !fake.calls.some((x) => x.args[1] === 'edit') && res.data.labels.length === 1 && res.data.labels[0].name === 'wayfinder:map'
    results.push({ name: 'gitea-minimal · write setLabels no-op when target matches', ok, detail: ok ? '' : JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabels(repo, '1', ['bug'], { expectedUpdatedAt: '1999-01-01T00:00:00Z' }, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setLabels conflict on stale expectedUpdatedAt without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) + ' calls=' + JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  // setAssignees：--set-assignees 整集替换一步到位；空集清空。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setAssignees(repo, '1', ['alice', { login: 'bob' }], undefined, fake)
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const ok = res.ok && !!editCall && editCall.args.includes('--set-assignees') && editCall.args[editCall.args.indexOf('--set-assignees') + 1] === 'alice,bob'
    results.push({ name: 'gitea-minimal · write setAssignees replaces whole set', ok, detail: ok ? '' : JSON.stringify(fake.calls.map((x) => x.args.slice(0, 5))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setAssignees(repo, '1', [], undefined, fake)
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const ok = res.ok && !!editCall && editCall.args[editCall.args.indexOf('--set-assignees') + 1] === ''
    results.push({ name: 'gitea-minimal · write setAssignees empty set clears', ok, detail: ok ? '' : JSON.stringify(fake.calls.map((x) => x.args.slice(0, 5))) })
  }
  // comment：comments add 落店，契约 Comment 形状回（作者关联恒空串、正文以调用方入参为准）。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.comment(repo, '1', 'looks good', fake)
    const ok = res.ok && res.data.body === 'looks good' && res.data.authorAssociation === '' && res.data.author.login === 'tester' && !!res.data.createdAt
    results.push({ name: 'gitea-minimal · write comment returns contract Comment', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 300) })
    const addCall = fake.calls.find((x) => x.args[0] === 'comments' && x.args[1] === 'add')
    const ok2 = !!addCall && addCall.args[2] === '1'
    results.push({ name: 'gitea-minimal · write comment targets issue via comments add', ok: ok2, detail: ok2 ? '' : JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  // deck_issue_patch 写回链路端到端：update 正文 → comment → close → reopen，每一步后按步序读回校验
  // （deck_issue_patch 的 t.update / t.comment / t.close / t.reopen 落在本房工厂的这四个成员上）。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    const u = await backend.update(repo, '1', { body: 'patched body' }, fake)
    const uOk = u.ok && u.data.body === 'patched body'
    const cm = await backend.comment(repo, '1', '已按规格改完', fake)
    const cmOk = cm.ok && cm.data.body === '已按规格改完'
    const cl = await backend.close(repo, '1', { reason: 'completed' }, fake)
    const clOk = cl.ok && cl.data.state === 'closed'
    const ro = await backend.reopen(repo, '1', fake)
    const roOk = ro.ok && ro.data.state === 'open'
    const back = await backend.get(repo, '1', { comments: { first: 5 } }, fake)
    const backOk = back.ok && back.data.body === 'patched body' && back.data.state === 'open' && Array.isArray(back.data.comments) && back.data.comments.some((c) => c.body === '已按规格改完')
    const ok = uOk && cmOk && clOk && roOk && backOk
    results.push({ name: 'gitea-minimal · deck_issue_patch write-back chain update comment close reopen end-to-end', ok, detail: ok ? '' : JSON.stringify({ u: u.ok ? u.data.body : u, cm: cm.ok ? cm.data.body : cm, cl: cl.ok ? cl.data.state : cl, ro: ro.ok ? ro.data.state : ro, back: back.ok ? { body: back.data.body, state: back.data.state, comments: back.data.comments && back.data.comments.map((c) => c.body) } : back }).slice(0, 500) })
  }
  // ── 票 #13：结构写（setParent / setBlockedBy）——写侧隐藏标记 + 可见行兜底，写后读回闭环 ──
  // 与票 #12 同一个判思路：门禁钉「我们怎么拼命令、怎么判档、写完读回能不能还原 parent 与 blockedBy」。
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setParent：给 #3（正文为空）挂父 #1，edit --description 写进隐藏标记，读回闭环 get 能还原 parentKey。
    const res = await backend.setParent(repo, '3', '1', undefined, fake)
    const editCall = fake.calls.find((x) => x.args[1] === 'edit')
    const bodyIn = editCall ? editCall.args[editCall.args.indexOf('--description') + 1] : ''
    const wrote = res.ok && res.data.parentKey === '1' && !!editCall && editCall.args.includes('--description') && typeof bodyIn === 'string' && bodyIn.includes('<!-- DSH-PARENT: 1 -->')
    results.push({ name: 'gitea-minimal · write setParent writes hidden parent marker', ok: wrote, detail: wrote ? '' : JSON.stringify({ res: res.ok ? res.data.parentKey : res, bodyIn }).slice(0, 300) })
    const back = await backend.get(repo, '3', undefined, fake)
    const loop = back.ok && back.data.parentKey === '1'
    results.push({ name: 'gitea-minimal · write setParent read-back loop restores parentKey', ok: loop, detail: loop ? '' : JSON.stringify(back.ok ? back.data.parentKey : back).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setParent(null)：把 #2 的归属拆掉，正文里不再有隐藏标记，读回 parentKey 归无。
    const res = await backend.setParent(repo, '2', null, undefined, fake)
    const row = fake.issues.find((x) => x.index === 2)
    const ok = res.ok && res.data.parentKey === null && typeof row.body === 'string' && !row.body.includes('DSH-PARENT')
    results.push({ name: 'gitea-minimal · write setParent null detaches marker', ok, detail: ok ? '' : JSON.stringify({ res: res.ok ? res.data.parentKey : res, body: row && row.body }).slice(0, 300) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setParent：自挂回 conflict，不发任何写命令。
    const res = await backend.setParent(repo, '2', '2', undefined, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setParent self-parent conflict without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) + ' calls=' + JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setParent：expectedUpdatedAt 对不上回 conflict，不写。
    const res = await backend.setParent(repo, '2', '1', { expectedUpdatedAt: '1999-01-01T00:00:00Z' }, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setParent conflict on stale expectedUpdatedAt without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setParent：父票不存在按 not-found 如实回，不写（写一个不存在的父编号会把读侧指向空票）。
    const res = await backend.setParent(repo, '2', '999', undefined, fake)
    const ok = !res.ok && res.error.kind === 'not-found' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setParent missing parent classified not-found without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setBlockedBy：给 #3 写一条阻塞（#3 被 #2 阻塞）——可见行与隐藏机器表成对落正文，
    // 读回闭环 getDependencies 能还原 blockedBy。
    const res = await backend.setBlockedBy(repo, '3', ['2'], undefined, fake)
    const row = fake.issues.find((x) => x.index === 3)
    const bodyIn = typeof row.body === 'string' ? row.body : ''
    const wrote = res.ok && Array.isArray(res.data.blockedBy) && res.data.blockedBy.length === 1 && res.data.blockedBy[0].key === '2' && bodyIn.includes('<!-- DSH-BLOCKED-BY: 2 -->') && bodyIn.includes('Blocked by:')
    results.push({ name: 'gitea-minimal · write setBlockedBy writes visible line and hidden table pair', ok: wrote, detail: wrote ? '' : JSON.stringify({ res: res.ok ? res.data.blockedBy : res, bodyIn }).slice(0, 400) })
    const deps = await backend.getDependencies(repo, '3', undefined, fake)
    const loop = deps.ok && Array.isArray(deps.data.blockedBy) && deps.data.blockedBy.length === 1 && deps.data.blockedBy[0].key === '2' && deps.data.blockedBy[0].title === 'sub of 1'
    results.push({ name: 'gitea-minimal · write setBlockedBy read-back loop restores blockedBy', ok: loop, detail: loop ? '' : JSON.stringify(deps.ok ? deps.data.blockedBy : deps).slice(0, 300) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setBlockedBy([])：把 #1 的阻塞清空——可见行与隐藏机器表两处一起拆干净，读回闭环为空。
    const res = await backend.setBlockedBy(repo, '1', [], undefined, fake)
    const row = fake.issues.find((x) => x.index === 1)
    const bodyIn = typeof row.body === 'string' ? row.body : ''
    const deps = await backend.getDependencies(repo, '1', undefined, fake)
    const ok = res.ok && Array.isArray(res.data.blockedBy) && res.data.blockedBy.length === 0 && !bodyIn.includes('DSH-BLOCKED-BY') && !bodyIn.includes('Blocked by:') && deps.ok && deps.data.blockedBy.length === 0
    results.push({ name: 'gitea-minimal · write setBlockedBy empty set clears both places and read-back is empty', ok, detail: ok ? '' : JSON.stringify({ res: res.ok ? res.data.blockedBy : res, bodyIn, deps: deps.ok ? deps.data.blockedBy : deps }).slice(0, 400) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setBlockedBy：自阻塞回 conflict，不落盘。
    const res = await backend.setBlockedBy(repo, '1', ['1'], undefined, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setBlockedBy self-block conflict without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setBlockedBy：写完成环回 conflict 且不落盘——#1 现在已被 #3 阻塞，再让 #3 被 #1 阻塞就成环。
    const res = await backend.setBlockedBy(repo, '3', ['1'], undefined, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setBlockedBy cycle conflict without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 300) + ' calls=' + JSON.stringify(fake.calls.map((x) => x.args.slice(0, 3))) })
  }
  {
    const fake = makeWriteFakeTea()
    const backend = createGiteaBackend(fake)
    // setBlockedBy：expectedUpdatedAt 对不上回 conflict，不写。
    const res = await backend.setBlockedBy(repo, '3', ['2'], { expectedUpdatedAt: '1999-01-01T00:00:00Z' }, fake)
    const ok = !res.ok && res.error.kind === 'conflict' && !fake.calls.some((x) => x.args[1] === 'edit')
    results.push({ name: 'gitea-minimal · write setBlockedBy conflict on stale expectedUpdatedAt without write', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  // ── 票 #14 的六条管理类操作：setLabelColors / getCurrentUser / getRepoPermissions / readBudget /
  // initProject / ensureLabelColorsFile ──
  // 管理类的假 tea：标签带 id（tea labels update 只认 id）、logins ls、repos ls 的参数形状按本机 tea 0.16.0 实测。
  function makeAdminFakeTea(opts) {
    const calls = []
    const labels = (opts && opts.labels ? opts.labels : [
      { name: 'bug', color: 'd73a4a' },
      { name: 'wayfinder:map', color: '8b5cf6' },
    ]).map((x, i) => Object.assign({ id: i + 1 }, x))
    const repos = (opts && opts.repos) || []
    const logins = (opts && opts.logins) || []
    const updated = []
    return {
      calls,
      labels,
      updated,
      exec: async (cmd, args) => {
        calls.push({ cmd, args })
        const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
        if (cmd !== 'tea') return { stdout: '', stderr: 'unexpected cmd ' + cmd, code: 127 }
        if (args[0] === 'labels' && args[1] === 'ls') {
          if (opts && opts.labelsLsFails) return { stdout: '', stderr: '500 server error', code: 1 }
          const limit = Number(flag('--limit') || 50)
          const page = Number(flag('--page') || 1)
          return { stdout: JSON.stringify(labels.slice((page - 1) * limit, page * limit)), stderr: '', code: 0 }
        }
        if (args[0] === 'labels' && args[1] === 'update') {
          const id = Number(flag('--id'))
          const color = flag('--color') || ''
          const hit = labels.find((x) => x.id === id)
          if (!hit) return { stdout: '', stderr: 'label does not exist', code: 1 }
          hit.color = color
          updated.push({ name: hit.name, color })
          return { stdout: JSON.stringify(hit), stderr: '', code: 0 }
        }
        if (args[0] === 'logins' && args[1] === 'ls') {
          if (opts && opts.loginsRaw !== undefined) return { stdout: opts.loginsRaw, stderr: '', code: 0 }
          return { stdout: JSON.stringify(logins), stderr: '', code: 0 }
        }
        if (args[0] === 'repos' && args[1] === 'ls') {
          const limit = Number(flag('--limit') || 50)
          const page = Number(flag('--page') || 1)
          return { stdout: JSON.stringify(repos.slice((page - 1) * limit, page * limit)), stderr: '', code: 0 }
        }
        return { stdout: '', stderr: 'unexpected args ' + args.join(' '), code: 127 }
      },
    }
  }
  // setLabelColors：合法颜色逐条发 tea labels update（颜色归一后发），非法颜色与不存在的标签各落一条 failed，逐条恰好二选一。
  {
    const fake = makeAdminFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabelColors(repo, [
      { name: 'bug', color: '#D73A4A' },
      { name: 'wayfinder:map', color: '8b5cf6' },
      { name: 'badcolor', color: 'zzzzzz' },
      { name: 'ghost', color: '00ff00' },
    ], fake)
    const applied = res.ok ? res.data.applied : []
    const failed = res.ok ? res.data.failed : []
    const ok = res.ok
      && applied.length === 2
      && applied.some((x) => x.name === 'bug' && x.color === 'd73a4a')
      && applied.every((x) => !x.color.startsWith('#'))
      && failed.length === 2
      && failed.some((x) => x.name === 'badcolor' && x.reason.kind === 'parse')
      && failed.some((x) => x.name === 'ghost' && x.reason.kind === 'not-found')
      && fake.updated.length === 2
      && fake.updated.every((x) => !x.color.startsWith('#'))
    results.push({ name: 'gitea-minimal · admin setLabelColors applies valid entries and rejects invalid per entry', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 400) })
  }
  // setLabelColors：前置读标签失败整条失败，不发任何写命令。
  {
    const fake = makeAdminFakeTea({ labelsLsFails: true })
    const backend = createGiteaBackend(fake)
    const res = await backend.setLabelColors(repo, [{ name: 'bug', color: '00ff00' }], fake)
    const ok = !res.ok && res.error.kind === 'network' && fake.updated.length === 0
    results.push({ name: 'gitea-minimal · admin setLabelColors fails whole op when label prefetch fails', ok, detail: ok ? '' : JSON.stringify(res && res.error).slice(0, 200) })
  }
  // getCurrentUser：取标了 default 的登录项的 user 字段（tea whoami 不出 JSON，走 logins ls）。
  {
    const fake = makeAdminFakeTea({ logins: [
      { name: 'work', url: 'https://g1.example', user: 'alice', default: 'false' },
      { name: 'home', url: 'https://g2.example', user: 'bob', default: 'true' },
    ] })
    const backend = createGiteaBackend(fake)
    const res = await backend.getCurrentUser(repo, fake)
    const ok = res.ok && res.data.login === 'bob'
    results.push({ name: 'gitea-minimal · admin getCurrentUser reads default login user', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 200) })
  }
  // getCurrentUser：没有 default 标记但恰一条登录时取它；回包不成形状时如实失败。
  {
    const fake = makeAdminFakeTea({ logins: [{ name: 'solo', url: 'https://g.example', user: 'carol' }] })
    const backend = createGiteaBackend(fake)
    const res = await backend.getCurrentUser(repo, fake)
    const bad = makeAdminFakeTea({ loginsRaw: 'not json' })
    const res2 = await backend.getCurrentUser(repo, bad)
    const ok = res.ok && res.data.login === 'carol' && !res2.ok && res2.error.kind === 'parse'
    results.push({ name: 'gitea-minimal · admin getCurrentUser single login fallback and parse failure', ok, detail: ok ? '' : JSON.stringify({ res, res2: res2 && res2.error }).slice(0, 300) })
  }
  // getRepoPermissions：翻页扫仓找到当前仓库，write 档 push 与 triage 都是 true（命中在第 2 页，钉翻页行为）。
  {
    const repos = Array.from({ length: 60 }, (_, i) => ({ owner: 'x' + i, name: 'p' + i, permission: 'read' }))
    repos[55] = { owner: 'o', name: 'r', permission: 'write' }
    const fake = makeAdminFakeTea({ repos })
    const backend = createGiteaBackend(fake)
    const res = await backend.getRepoPermissions(repo, fake)
    const pagedTo2 = fake.calls.some((c) => c.args.includes('--page') && c.args[c.args.indexOf('--page') + 1] === '2')
    const ok = res.ok && res.data.push === true && res.data.triage === true && pagedTo2
    results.push({ name: 'gitea-minimal · admin getRepoPermissions scans pages and maps write to push+triage', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 200) })
  }
  // getRepoPermissions：read 档都是 false；未知档位与清单里找不到各自如实失败，不捏造。
  {
    const ro = makeAdminFakeTea({ repos: [{ owner: 'o', name: 'r', permission: 'read' }] })
    const backendRo = createGiteaBackend(ro)
    const resRo = await backendRo.getRepoPermissions(repo, ro)
    const unknown = makeAdminFakeTea({ repos: [{ owner: 'o', name: 'r', permission: 'maintainer' }] })
    const backendUnknown = createGiteaBackend(unknown)
    const resUnknown = await backendUnknown.getRepoPermissions(repo, unknown)
    const missing = makeAdminFakeTea({ repos: [{ owner: 'a', name: 'b', permission: 'read' }] })
    const backendMissing = createGiteaBackend(missing)
    const resMissing = await backendMissing.getRepoPermissions(repo, missing)
    const ok = resRo.ok && resRo.data.push === false && resRo.data.triage === false
      && !resUnknown.ok && resUnknown.error.kind === 'parse'
      && !resMissing.ok && resMissing.error.kind === 'not-found'
    results.push({ name: 'gitea-minimal · admin getRepoPermissions read maps false and unknown/missing fail honestly', ok, detail: ok ? '' : JSON.stringify({ resRo, u: resUnknown && resUnknown.error, m: resMissing && resMissing.error }).slice(0, 300) })
  }
  // readBudget：Gitea 无配额端点、tea 不透出速率头，恒回「没量出来」的 unsupported 档，永不抛。
  {
    const fake = makeAdminFakeTea()
    const backend = createGiteaBackend(fake)
    const res = await backend.readBudget(fake)
    const ok = res.ok && res.data && res.data.known === false && res.data.reason === 'unsupported'
    results.push({ name: 'gitea-minimal · admin readBudget returns honest unsupported reading', ok, detail: ok ? '' : JSON.stringify(res).slice(0, 200) })
  }
  // initProject / ensureLabelColorsFile：后端实例上的诚实桩（不再是注册表补桩），如实回 unsupported。
  {
    const fake = makeAdminFakeTea()
    const backend = createGiteaBackend(fake)
    const a = await backend.initProject(repo, { name: 'fresh' }, fake)
    const b = await backend.ensureLabelColorsFile(repo, fake)
    const ok = !a.ok && a.error.kind === 'unsupported' && !b.ok && b.error.kind === 'unsupported'
    results.push({ name: 'gitea-minimal · admin initProject and ensureLabelColorsFile honest unsupported stubs', ok, detail: ok ? '' : JSON.stringify({ a: a && a.error, b: b && b.error }).slice(0, 300) })
  }
} catch (e) {
  results.push({ name: 'gitea-minimal · import-failed', ok: false, detail: String(e && e.message || e) })
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
    const { createRegistry } = await import('../src/tracker/registry/core.ts') // V1 #461：registry.js 已拆为三块
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

// #508：拉取请求三个可选扩展字段三探针（门禁主体在 harness 2b/2c；这里只证明三件事）：
// 有拉取请求能力的后端给值能过；无能力后端省略能过；写错类型或另起独立实体会被逮住。
try {
  const prCapable = {
    name: 'pr-shape-capable',
    normalize: (raw) => Object.assign({}, compliant.normalize(raw), {
      // 有来源就逐项映射，没有来源就给空值（无内容但有能力），与现有能力字段同一口径
      isPullRequest: raw.isPullRequest === true,
      mergedAt: typeof raw.mergedAt === 'string' ? raw.mergedAt : null,
      reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    }),
    withData: {
      key: '7', title: 'pr', state: 'open',
      isPullRequest: true,
      mergedAt: '2024-02-01T00:00:00Z',
      reviews: [{ state: 'approved', reviewer: { login: 'alice' }, submittedAt: '2024-01-31T00:00:00Z' }],
    },
    emptyData: {},
    mappings: [
      { from: 'title', to: 'title' },
      { from: 'isPullRequest', to: 'isPullRequest' },
      { from: 'mergedAt', to: 'mergedAt' },
      { from: 'reviews', to: 'reviews' },
    ],
    // 是否为拉取请求是非值，没有“空值”口径，不进 implementedFields，改由下面逐项断言守住类型
    implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason', 'mergedAt', 'reviews'],
    missingFields: ['author', 'milestone', 'customFields'],
  }
  results.push(...runContractTests(prCapable))
  const prEmpty = prCapable.normalize({})
  results.push({ name: 'pr-shape-capable · empty keeps boolean flag', ok: prEmpty.isPullRequest === false, detail: 'got=' + JSON.stringify(prEmpty.isPullRequest) })
  // 无能力后端省略三字段：直接复用合规桩（harness 2c 缺席即合法，应全过）
  const prOmitting = Object.assign({}, compliant, { name: 'pr-shape-omitting' })
  results.push(...runContractTests(prOmitting))
  // 写错的必须被逮住：每组故意犯一个错，harness 至少报一个 FAIL 才算门禁有效
  const malformedGroups = [
    {
      label: 'malformed isPullRequest caught',
      fixture: Object.assign({}, prCapable, { name: 'pr-shape-violating-flag', normalize: (raw) => Object.assign({}, prCapable.normalize(raw), { isPullRequest: 'yes' }) }),
    },
    {
      label: 'malformed reviews caught',
      fixture: Object.assign({}, prCapable, { name: 'pr-shape-violating-reviews', normalize: (raw) => Object.assign({}, prCapable.normalize(raw), { reviews: [{ reviewer: { login: 'alice' } }] }) }),
    },
    {
      label: 'malformed mergedAt caught',
      fixture: Object.assign({}, prCapable, { name: 'pr-shape-violating-mergedAt', normalize: (raw) => Object.assign({}, prCapable.normalize(raw), { mergedAt: 12345 }) }),
    },
    {
      label: 'standalone entity caught',
      fixture: Object.assign({}, prCapable, { name: 'pr-shape-violating-entity', normalize: (raw) => Object.assign({}, prCapable.normalize(raw), { pullRequests: [] }) }),
    },
  ]
  for (const g of malformedGroups) {
    const probe = runContractTests(g.fixture)
    const caught = probe.filter((r) => !r.ok).length > 0
    results.push({ name: 'pr-shape · ' + g.label, ok: caught, detail: caught ? '' : 'gate missed the planted violation' })
  }
} catch (e) {
  results.push({ name: 'pr-shape · probe-crash', ok: false, detail: String(e && e.stack || e) })
}

for (const s of [contractSection, registrySection, preflightSection, deckSection, snapshotSection, chainSection, labelsSection, countsSection, listPageSection, idempotencySection, roomGitlabExtrasSection, objectKindSection, listStateSection]) {
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

// 校验契约骨架自洽：合规桩全过、违规桩把**预期的 4 条**都逮住、github/gitlab/demo 适配器合规全过、行为段全 PASS（含 probe 自证）
const compliantOk = results.filter((r) => r.name.startsWith(compliant.name) && !r.ok).length === 0
// #627 二次整改 P8：判据不许只要求「至少逮住一条」——那样子段里删掉 EMPTY/MISSING 那几条检查，门禁照样绿，
//   而文档里写的「4 条」会静默过期。这里按名字点名要求这 4 条预期失败都在（名字与 harness 的输出一致）。
const VIOLATING_EXPECTED_FAILURES = [
  'violating-stub · map title->title',
  'violating-stub · empty.labels present(EMPTY)',
  'violating-stub · log.labels EMPTY',
  'violating-stub · EMPTY≠MISSING labels',
]
const violationFails = new Set(results.filter((r) => r.name.startsWith(violating.name) && !r.ok).map((r) => r.name))
const missingExpectedFailures = VIOLATING_EXPECTED_FAILURES.filter((n) => !violationFails.has(n))
const caughtViolation = missingExpectedFailures.length === 0
const githubOk = results.filter((r) => r.name.startsWith('github-adapter') && !r.ok).length === 0
const gitlabOk = results.filter((r) => r.name.startsWith('gitlab-') && !r.ok).length === 0
const giteaOk = results.filter((r) => r.name.startsWith('gitea-minimal') && !r.ok).length === 0
const demoOk = results.filter((r) => r.name.startsWith('demo-mini') && !r.ok).length === 0
const demoPlaybackOk = results.filter((r) => r.name.startsWith('demo-playback') && !r.ok).length === 0
const sectionsOk = results.filter((r) => !r.name.startsWith(compliant.name) && !r.name.startsWith(violating.name) && !r.name.startsWith('github-adapter') && !r.name.startsWith('gitlab-') && !r.name.startsWith('gitea-minimal') && !r.name.startsWith('demo-mini') && !r.name.startsWith('demo-playback') && !r.ok).length === 0
const prShapeOk = results.filter((r) => (r.name.startsWith('pr-shape-capable') || r.name.startsWith('pr-shape-omitting')) && !r.ok).length === 0
  && results.filter((r) => r.name.startsWith('pr-shape · ') && !r.ok).length === 0
if (!(compliantOk && caughtViolation && githubOk && gitlabOk && giteaOk && demoOk && demoPlaybackOk && sectionsOk && prShapeOk)) {
  console.error('CONTRACT SKELETON NOT SELF-CONSISTENT')
  if (!caughtViolation) console.error('VIOLATING STUB DID NOT FAIL THE 4 EXPECTED CHECKS: ' + missingExpectedFailures.join('、'))
  if (!githubOk) console.error('GITHUB ADAPTER FAILED G4')
  if (!gitlabOk) console.error('GITLAB ADAPTER FAILED G4')
  if (!giteaOk) console.error('GITEA ADAPTER FAILED G4 (#2)')
  if (!demoOk) console.error('DEMO-MINI ADAPTER FAILED G4')
  if (!demoPlaybackOk) console.error('DEMO PLAYBACK FAILED')
  if (!prShapeOk) console.error('PR SHAPE EXTENSION FAILED (#508)')
  process.exit(1)
}
console.log('CONTRACT SKELETON OK')
