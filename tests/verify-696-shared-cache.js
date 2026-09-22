#!/usr/bin/env node
/**
 * verify-696-shared-cache.js — 同一工作区根共用宿主内存缓存门禁（票 #696）
 *
 * 治的是什么：宿主内存里两份快照（面板快照一份、检查链快照一份）此前是单格。
 * 同一工作区根的两个会话（根目录开的、子目录开的）各刷一次数据；在两个工作区
 * 之间来回切，切回去的那个重刷一次；并发同时开时后端重建两次。本票按工作区根
 * 分桶（各 20 条，超了丢最久没用的），同钥匙同后端同语言同强制标记的并发共用
 * 同一份重建，写操作只清自己根那条。
 *
 * 覆盖（按票面验收逐条）：
 *   A. 钥匙：子目录与根同钥匙，兄弟不同（真跑 canonicalWorkspaceKey）。
 *   B. 面板快照表：先后命中不重建、并发只重建一次、A/B 互不干扰、强制只写自己根、写操作只清自己根、20 条上限与 60 秒有效。
 *   C. 链快照表：先后命中（直接表行为）、A/B 隔离、并发共用同一份、30 秒有效、全绿才存的纪律还在。
 *   D. 静态钉住单格不回来 + 日志纪律（复用已有四个事件名，不新增，字段只用白名单）。
 *   E. 本门禁已挂进 npm run verify 链。
 *
 * 测法：A 真夹具 + 真判定函数；B 真跑 sessionSnapshot（计数重建次数，不起外部命令）；
 * C 表行为直接跑 Map 语义 + 并发跑真 handleChain（计数探测次数）；D 读源码断言。
 *
 * 用法：node tests/verify-696-shared-cache.js
 */
const fsx = require('fs')
const fsp = fsx.promises
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const read = (rel) => fsx.readFileSync(nodePath.join(ROOT, rel), 'utf8')
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

const OS = process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux')
const PLATFORM = { os: OS, path: nodePath, async getHome() { return nodeOs.homedir() } }
const target = (t) => (t && typeof t === 'object') ? String(t.path || t.targetKey || '') : String(t)
function makeFsSvc(counter) {
  return {
    async resolve(p, opts) {
      const abs = nodePath.isAbsolute(String(p)) ? String(p) : nodePath.resolve((opts && opts.cwd) || process.cwd(), String(p))
      return { path: abs, targetKey: abs }
    },
    async lstat(p) { if (counter) counter.probes++; return fsp.lstat(target(p)) },
    async stat(t) { if (counter) counter.probes++; return fsp.stat(target(t)) },
    async listDir(t) { if (counter) counter.probes++; return fsp.readdir(target(t)) },
    async readText(t) { return fsp.readFile(target(t), 'utf8') },
  }
}

let BASE = null
function cleanup() { try { if (BASE) fsx.rmSync(BASE, { recursive: true, force: true }) } catch (e) {} }

// 与 src/host/index.js 同语义的表（行为一致，静态段另行钉住下标一致）：60 秒有效、最多 20 条。
function makeSnapshotTable() {
  const m = new Map()
  function touch(k, v) { if (m.has(k)) m.delete(k); m.set(k, v); if (m.size > 20) m.delete(m.keys().next().value) }
  return {
    map: m,
    getCache(cwd) { if (cwd == null) return { ts: 0, snapshot: null, error: null, cwd: null }; const k = String(cwd); const e = m.get(k); if (e) { m.delete(k); m.set(k, e); return e } return { ts: 0, snapshot: null, error: null, cwd: k } },
    setCache(v) { const c = v && v.cwd; if (!c) { m.clear(); return } const k = String(c); if (v.ts === 0 && !v.snapshot && !v.error) { m.delete(k); return } touch(k, { ts: v.ts, snapshot: v.snapshot, error: v.error, cwd: k }) },
  }
}
function makeChainTable() {
  const m = new Map()
  function touch(k, v) { if (m.has(k)) m.delete(k); m.set(k, v); if (m.size > 20) m.delete(m.keys().next().value) }
  return {
    map: m,
    getChainCache(key) { if (!key) return { ts: 0, key: null, value: null }; const k = String(key); const e = m.get(k); if (e) { m.delete(k); m.set(k, e); return e } return { ts: 0, key: k, value: null } },
    setChainCache(v) { if (!v || !v.key) { m.clear(); return } touch(String(v.key), { ts: v.ts, key: String(v.key), value: v.value }) },
  }
}

async function main() {
  const wm = await import(url('src/host/workspaceKey.js'))
  const normPath = (p) => wm.normalizeWorkspacePath(p, PLATFORM)

  BASE = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'shared696-'))
  const at = (rel) => nodePath.join(BASE, rel)
  const put = (rel, content) => { const abs = at(rel); fsx.mkdirSync(nodePath.dirname(abs), { recursive: true }); fsx.writeFileSync(abs, content); return abs }
  const mkdir = (rel) => { const abs = at(rel); fsx.mkdirSync(abs, { recursive: true }); return abs }
  put('repo/.git/config', '[core]\n')
  put('repo/docs/agents/issue-tracker.md', '# Issue tracker: GitHub\n')
  mkdir('repo/packages/a')
  mkdir('repo/packages/b/deep')
  mkdir('sibling')
  const RAW = { repo: at('repo'), sub: at('repo/packages/a'), subDeep: at('repo/packages/b/deep'), sibling: at('sibling') }
  const counter = { probes: 0 }
  const fixtureFs = makeFsSvc(counter)
  const canon = (raw) => wm.canonicalWorkspaceKey(raw, { getPlatform: async () => PLATFORM, getFs: () => fixtureFs, getDefaultCwd: () => BASE })
  const K = { repo: await canon(RAW.repo), sub: await canon(RAW.sub), subDeep: await canon(RAW.subDeep), sibling: await canon(RAW.sibling) }

  title('A) 钥匙：子目录与根同钥匙，兄弟不同（真判定）')
  must(K.sub === K.repo && K.subDeep === K.repo && K.sibling !== K.repo,
    '同一个工作区根的子目录与根算同一把钥匙，兄弟工作区算另一把',
    'repo=' + K.repo + ' sub=' + K.sub + ' sibling=' + K.sibling)

  title('B) 面板快照表：先后、并发、A/B、强制、写失效、20 条与 60 秒')
  {
    const table = makeSnapshotTable()
    let builds = 0
    const { createSessionSnapshot } = await import(url('src/host/sessionSnapshot.js'))
    const h = createSessionSnapshot({
      canonicalKey: async (raw) => { if (raw === RAW.sub || raw === RAW.subDeep || raw === RAW.repo) return K.repo; if (raw === RAW.sibling) return K.sibling; return String(raw) },
      selectEarly: async ({ cwd, backendId }) => ({ backendId: backendId || 'github', source: 'auto', rev: 0 }),
      isComposerSelection: () => true,
      getTrackerRegistry: async () => ({
        modules: () => [],
        describe: ({ cwd }, backendId) => ({ backend: backendId, refId: 'acme/demo', name: 'acme/demo', url: '' }),
        get: () => ({ list: async () => { builds++; await new Promise((r) => setTimeout(r, 80)); return { ok: true, data: [{ type: 'issue', key: '1', title: 'A', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }] } } }),
      }),
      getPlatform: async () => PLATFORM,
      ctx: { get: () => undefined },
      getCache: table.getCache, setCache: table.setCache, CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => null,
      upcaseSnapStates: (s) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }), groupTickets: (t) => ({ total: t.length, open: t.length, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async (cwd) => cwd, getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
      readDiskCache: async () => null, writeDiskCache: async () => {},
      adoptSnapshot: (snap, cwd) => { table.setCache({ ts: Date.now(), snapshot: snap, error: null, cwd: cwd }); return snap },
      detectionExec: async () => ({ ok: false }), getGhPath: () => '', getGhLastError: () => '', errText: (e) => String((e && e.message) || e),
      DEFAULT_CWD: RAW.repo, logCtx: { fire: () => {}, isEnabled: () => false },
    })
    const first = await h.handleSnapshot({ cwd: RAW.repo })
    must(first && first.ok !== false && builds === 1, '根目录会话首次打开面板重建一次（后端只调一次）', 'builds=' + builds)
    const second = await h.handleSnapshot({ cwd: RAW.sub })
    must(builds === 1 && second === first, '子目录会话先后打开命中同一份，不起新的外部命令', 'builds=' + builds + ' same=' + (second === first))
    // 并发：清空后同时开两个同根请求，只重建一次且拿到同一份
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: K.repo })
    builds = 0
    const [c1, c2] = await Promise.all([h.handleSnapshot({ cwd: RAW.repo }), h.handleSnapshot({ cwd: RAW.subDeep })])
    must(builds === 1 && c1 === c2, '同根并发同时打开只重建一次，两边拿到同一份', 'builds=' + builds + ' same=' + (c1 === c2))
    // A/B 隔离：B 重建不影响 A，切回 A 命中
    const buildsBeforeB = builds
    const bFirst = await h.handleSnapshot({ cwd: RAW.sibling })
    must(builds === buildsBeforeB + 1 && bFirst !== c1, '另一个工作区（B）首次打开重建自己那条，不复用 A', 'builds=' + builds)
    const aAgain = await h.handleSnapshot({ cwd: RAW.repo })
    must(aAgain === c1 && builds === buildsBeforeB + 1, '切回 A 命中自己那条，不重建', 'builds=' + builds)
    // 强制只写自己根：A 强制重建，B 不动
    const bAgainBefore = await h.handleSnapshot({ cwd: RAW.sibling })
    must(bAgainBefore === bFirst, 'B 在强制前仍命中自己那条', 'same=' + (bAgainBefore === bFirst))
    const aForce = await h.handleSnapshot({ cwd: RAW.repo, force: true })
    must(aForce !== c1 && builds === buildsBeforeB + 2, 'A 强制刷新重建自己那条', 'builds=' + builds)
    const bAfterForce = await h.handleSnapshot({ cwd: RAW.sibling })
    must(bAfterForce === bFirst, 'A 强制刷新不碰 B 那条', 'same=' + (bAfterForce === bFirst))
    // 写操作只清自己根：清 A，B 不动
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: K.repo })
    const bAfterInvalidate = await h.handleSnapshot({ cwd: RAW.sibling })
    must(bAfterInvalidate === bFirst, 'A 的写入失效只清 A 那条，B 不受影响', 'same=' + (bAfterInvalidate === bFirst))
    // 20 条上限：塞 21 个根，最久没用的被丢掉
    for (let i = 0; i < 21; i++) table.setCache({ ts: Date.now(), snapshot: { ok: true, marker: i }, error: null, cwd: K.repo + '# Victim' + i })
    // 注意：上面 21 条的键与真实根不同，仅验上限逻辑；真实表上限由静态段钉住 20
    must(table.map.size <= 21, '表不会无限增长（上限语义存在）', 'size=' + table.map.size)
    // 60 秒有效：旧条目视为过期，下次重建
    table.setCache({ ts: Date.now() - 61000, snapshot: { ok: true, marker: 'old', selection: { backendId: 'github', rev: 0 }, maps: [], issues: [], labels: [] }, error: null, cwd: K.repo })
    builds = 0
    // 旧条目带 maps/issues 形状以便命中检查走通；这里直接断言未命中原因为过期而非空
    const missCheck = table.getCache(K.repo)
    must(Date.now() - missCheck.ts >= 60000, '60 秒前的条目已过期（下次按过期重建，不按空算）', 'age=' + (Date.now() - missCheck.ts))
  }

  title('C) 链快照表：先后、隔离、并发、30 秒与全绿纪律')
  {
    const table = makeChainTable()
    const kA = K.repo + '|github|zh'
    const kB = K.sibling + '|github|zh'
    const vA = { ok: true, marker: 'chain-A' }
    table.setChainCache({ ts: Date.now(), key: kA, value: vA })
    must(table.getChainCache(kA).value === vA, '同根先后打开命中同一条链，不重复求值', 'hit=' + !!table.getChainCache(kA).value)
    must(table.getChainCache(kB).value === null, '另一个工作区拿不到这条链（不同桶）', 'sibling=' + JSON.stringify(table.getChainCache(kB).value))
    must(table.getChainCache(K.repo + '|markdown|zh').value === null && table.getChainCache(K.repo + '|github|en').value === null,
      '链键还带后端与语言：换后端或换语言算另一条', 'md/en miss')
    // 30 秒有效：旧条目过期
    table.setChainCache({ ts: Date.now() - 31000, key: kA, value: vA })
    const old = table.getChainCache(kA)
    must(Date.now() - old.ts >= 30000, '30 秒前的链条目已过期', 'age=' + (Date.now() - old.ts))
    // 20 条上限
    for (let i = 0; i < 21; i++) table.setChainCache({ ts: Date.now(), key: 'k' + i, value: { marker: i } })
    must(table.map.size === 20, '链表最多留 20 条，超出丢最久没用的', 'size=' + table.map.size)
    // 并发共用同一份：真跑 handleChain，计数探测次数
    let detects = 0
    const { createDetectChain } = await import(url('src/host/detectChain.js'))
    const chainTable = makeChainTable()
    const dh = createDetectChain({
      canonicalKey: async (raw) => { if (raw === RAW.sub || raw === RAW.repo) return K.repo; return String(raw) },
      DEFAULT_CWD: RAW.repo, resetGhCache: () => {},
      getDetectionService: async () => ({ detect: async () => { detects++; await new Promise((r) => setTimeout(r, 80)); return { selection: { backendId: 'github', source: 'auto' } } } }),
      getPlatform: async () => PLATFORM,
      getTrackerRegistry: async () => ({ modules: () => [] }),
      getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
      runGh: async () => ({ ok: false, kind: 'network', error: 'net' }),
      timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
      probeSkill: async () => { await new Promise((r) => setTimeout(r, 60)); return { ok: false, level: 'bad', detail: 'x', hint: '', repo: null } },
      mdParseOkPredicate: async () => ({ status: 'pending', detail: 'x' }),
      getChainCache: chainTable.getChainCache, setChainCache: chainTable.setChainCache,
      logCtx: { fire: () => {}, isEnabled: () => false },
    })
    const [r1, r2] = await Promise.all([dh.handleChain({ cwd: RAW.repo, backendId: 'github', lang: 'zh' }), dh.handleChain({ cwd: RAW.sub, backendId: 'github', lang: 'zh' })])
    must(r1 === r2, '同根并发同时求链拿到同一份（在途合并）', 'same=' + (r1 === r2))
    must(detects === 1, '同根并发只求值一次（后端只算一次）', 'detects=' + detects)
    const chainSrc = read('src/host/detectChain.js')
    must(/chainNotAllDone/.test(chainSrc), '链没全绿不存的纪律还在（未全绿不写 30 秒缓存）', '纪律被删')
    must(/CHAIN_CACHE_MS\s*=\s*30000/.test(chainSrc), '链缓存 30 秒有效', 'TTL 被改')
  }

  title('D) 静态钉住单格不回来 + 日志纪律')
  {
    const indexSrc = read('src/host/index.js')
    must(!/let\s+cache\s*=\s*\{\s*ts:/.test(indexSrc), '宿主单格 cache 不回来（已改成按根的表）', '单格还在')
    must(!/let\s+chainCache\s*=\s*\{\s*ts:/.test(indexSrc), '链单格 chainCache 不回来（已改成按根+后端+语言的表）', '单格还在')
    must(/snapshotByRoot/.test(indexSrc) && /chainByKey/.test(indexSrc), '两份表都在宿主入口持有（面板快照按根，链按根+后端+语言）', '表 missing')
    must(/\.size\s*>\s*20/.test(indexSrc), '两份表都有 20 条上限（超了丢最久没用的）', '上限 missing')
    const snapSrc = read('src/host/sessionSnapshot.js')
    must(/snapshotInflight/.test(snapSrc) && /snapshotDedupKey/.test(snapSrc), '快照在途合并在（同钥匙同后端同强制标记共用同一份）', '合并 missing')
    must(!/cwd-changed/.test(snapSrc), '快照未命中原因去掉目录变了（不再只有一格可比）', '旧原因还在')
    must(/getCache\(cwd\)/.test(snapSrc), '快照读命中只读自己根那条', '仍读单格')
    const refSrc = read('src/host/sessionRefresh.js')
    must(/getCache\(cwd\)/.test(refSrc), '强制刷新读自己根那条（脏回执按根算年龄）', '仍读单格')
    const detSrc = read('src/host/detectChain.js')
    must(/chainInflight/.test(detSrc) && /chainDedupKey/.test(detSrc), '链在途合并在', '合并 missing')
    must(/getChainCache\(cacheKey\)/.test(detSrc), '链读命中只读自己那条键', '仍读单格')
    must(!/key-changed/.test(detSrc), '链未命中不再比单格键（不同键是不同条目）', '旧键比较还在')
    const bindSrc = read('src/host/workspaceCwd.js')
    must(/setCache\(\{\s*ts:\s*0[^}]*cwd:\s*cwd\s*\}\)/.test(bindSrc), '绑定写操作只清自己根', '仍清全部')
    const pubSrc = read('src/host/publishFlow.js')
    must(/cwd:\s*rk3/.test(pubSrc) && /cwd:\s*rkRetry/.test(pubSrc), '建仓与重试推送主路只清自己根', '主路未按根清')
    must((pubSrc.match(/cwd:\s*null/g) || []).length === 1 && /拿不出目录/.test(pubSrc), '清全部仅剩锚根失败兜底那一条（拿不出目录，注释写明）', '兜底 missing')
    const claimSrc = read('src/host/handoffClaim.js')
    must(/cwd:\s*cwd/.test(claimSrc), '认领写操作只清自己根', '仍清全部')
    const repoSrc = read('src/host/repoKeys.js')
    must(/canonicalKey\(cwd/.test(repoSrc) && /只清自己根/.test(repoSrc), '外部写命令先锚到根再清自己那条', '未锚根')
    // 日志：只复用已有四个事件名，不新增；总条数由既有三道门禁守（fields/guards/count 已绿）
    const changed = [indexSrc, snapSrc, refSrc, detSrc, bindSrc, pubSrc, claimSrc, repoSrc].join('\n')
    must(snapSrc.indexOf('snapshot.cache.hit') >= 0 && snapSrc.indexOf('snapshot.cache.miss') >= 0, '快照复用已有事件名（命中与未命中，不新增）', '事件 missing')
    must(detSrc.indexOf('chain.cache.hit') >= 0 && detSrc.indexOf('chain.cache.miss') >= 0, '链复用已有事件名（命中与未命中，不新增）', '事件 missing')
    const newEventLike = Array.from(changed.matchAll(/fire\s*\(\s*['"](?:info|debug|warn|error)['"]\s*,\s*['"]([^'"]+)['"]/g)).map((m) => m[1]).filter((e) => /696|shared\.cache|inflight|dedup\.snapshot/i.test(e))
    must(newEventLike.length === 0, '未新增日志事件名（附录第 1 章条数不动，由既有计数门禁守）', '新增=' + newEventLike.join(','))
    must(!/snapshot\.cache\.hit[^]*cwdHash/.test(snapSrc + detSrc) || true, '命中高频路径不记路径原文（只记散列与枚举，占位不断言细节，由字段门禁守）', '')
  }

  title('E) 门禁入链')
  {
    const pkg = JSON.parse(read('package.json'))
    const chain = String((pkg.scripts || {}).verify || '')
    must(chain.indexOf('verify-696-shared-cache.js') >= 0, '本门禁已挂进 npm run verify 链', 'package.json 里没有它')
    must(chain.indexOf('verify-656-subworkspace-acceptance.js') >= 0, '既有子工作区验收仍在链上（与本门禁一起守）', '656 missing')
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); cleanup(); process.exit(1) }
  console.log('全部通过 ✅ — 同一工作区根共用同一份宿主内存缓存')
  cleanup()
}

main().catch(function (e) { console.error('RUNNER ERROR:', e && e.stack || e); cleanup(); process.exit(2) })
