#!/usr/bin/env node
/**
 * verify-696-shared-cache.ts — 同一工作区根共用一份面板数据门禁（票 #696，#1893 改口径）
 *
 * 治的是什么：同一个工作区根的两个会话（根目录开的、子目录开的）各打开一次面板，
 * 不该各取一遍数；在两个工作区之间来回切，切回去的那个不该重取；并发同时开时后端
 * 只该被取一次。
 *
 * #1893（规格 #1885 S5）改的是「共用哪一份」：宿主内存里的快照表已删，共用的来源换成
 * 工作区快照库的回放。判据因此从「内存命中不重建」换成「库里有回放就不取数、两份数据
 * 是同一份投影」；「写操作只清自己根那条」随内存副本一起退役（写回执先落库，库版本驱动
 * 下一次首屏），这一档改为钉住会话电话依赖里不再有内存副本的读写口。
 *
 * 覆盖：
 *   A. 钥匙：子目录与根同钥匙，兄弟不同（真跑 canonicalWorkspaceKey）。
 *   B. 面板数据：先后读同一份库回放、并发只取数一次、A/B 互不干扰、强制只重建自己那份。
 *   C. 链快照表：先后命中（直接表行为）、A/B 隔离、并发共用同一份（这一段仍是宿主内存表，未受本票影响）。
 *
 * 测法：A 真夹具 + 真判定函数；B 真跑 sessionSnapshot + 假库（计数取数次数，不起外部命令）；
 * C 表行为直接跑 Map 语义 + 并发跑真 handleChain（计数探测次数）。
 *
 * 用法：node tests/verify-696-shared-cache.ts
 */
const fsx = require('fs')
const fsp = fsx.promises
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel: string): string => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken: string[] = []
function must (cond: unknown, invariant: string, detail?: unknown): void {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title (t: string): void { console.log('\n' + t) }

const OS = process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux')
const PLATFORM = { os: OS, path: nodePath, async getHome (): Promise<string> { return nodeOs.homedir() } }
const target = (t: any): string => (t && typeof t === 'object') ? String(t.path || t.targetKey || '') : String(t)
function makeFsSvc (counter: { probes: number } | null): any {
  return {
    async resolve (p: string, opts?: { cwd?: string }): Promise<{ path: string, targetKey: string }> {
      const abs = nodePath.isAbsolute(String(p)) ? String(p) : nodePath.resolve((opts && opts.cwd) || process.cwd(), String(p))
      return { path: abs, targetKey: abs }
    },
    async lstat (p: any): Promise<any> { if (counter) counter.probes++; return fsp.lstat(target(p)) },
    async stat (t: any): Promise<any> { if (counter) counter.probes++; return fsp.stat(target(t)) },
    async listDir (t: any): Promise<string[]> { if (counter) counter.probes++; return fsp.readdir(target(t)) },
    async readText (t: any): Promise<string> { return fsp.readFile(target(t), 'utf8') },
  }
}

/** 表里的条目：两套表共用的三件（时刻戳、内容、键）。 */
interface TableEntry { ts: number; snapshot?: unknown; error?: unknown; value?: unknown; cwd?: unknown; key?: unknown }

function makeChainTable (): { map: Map<string, TableEntry>, getChainCache: (key: unknown) => TableEntry, setChainCache: (v: any) => void } {
  const m = new Map<string, TableEntry>()
  function touch (k: string, v: TableEntry): void { if (m.has(k)) m.delete(k); m.set(k, v); if (m.size > 20) m.delete(m.keys().next().value as string) }
  return {
    map: m,
    getChainCache (key: unknown): TableEntry { if (!key) return { ts: 0, key: null, value: null }; const k = String(key); const e = m.get(k); if (e) { m.delete(k); m.set(k, e); return e } return { ts: 0, key: k, value: null } },
    setChainCache (v: any): void { if (!v || !v.key) { m.clear(); return } touch(String(v.key), { ts: v.ts, key: String(v.key), value: v.value }) },
  }
}

let BASE: string | null = null
function cleanup (): void { try { if (BASE) fsx.rmSync(BASE, { recursive: true, force: true }) } catch (e) {} }

async function main (): Promise<void> {
  const wm = await import(url('src/host/workspaceKey.js'))
  const normPath = (p: string): string => wm.normalizeWorkspacePath(p, PLATFORM)

  BASE = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'shared696-'))
  const at = (rel: string): string => nodePath.join(BASE as string, rel)
  const put = (rel: string, content: string): string => { const abs = at(rel); fsx.mkdirSync(nodePath.dirname(abs), { recursive: true }); fsx.writeFileSync(abs, content); return abs }
  const mkdir = (rel: string): string => { const abs = at(rel); fsx.mkdirSync(abs, { recursive: true }); return abs }
  put('repo/.git/config', '[core]\n')
  // 2026-11-03 起工作区根只认 docs/agents/workspace.yaml（.git 不再参与认根），
  // 所以夹具必须在 repo 根放这份文件，子目录往上找才停得下来。
  put('repo/docs/agents/workspace.yaml', 'version: 2\nbackendId: github\npickedAt: 1\nsource: explicit\n')
  put('repo/docs/agents/issue-tracker.md', '# Issue tracker: GitHub\n')
  mkdir('repo/packages/a')
  mkdir('repo/packages/b/deep')
  mkdir('sibling')
  const RAW = { repo: at('repo'), sub: at('repo/packages/a'), subDeep: at('repo/packages/b/deep'), sibling: at('sibling') }
  const counter = { probes: 0 }
  const fixtureFs = makeFsSvc(counter)
  const canon = (raw: string): Promise<string> => wm.canonicalWorkspaceKey(raw, { getPlatform: async () => PLATFORM, getFs: () => fixtureFs, getDefaultCwd: () => BASE })
  const K = { repo: await canon(RAW.repo), sub: await canon(RAW.sub), subDeep: await canon(RAW.subDeep), sibling: await canon(RAW.sibling) }

  title('A) 钥匙：子目录与根同钥匙，兄弟不同（真判定）')
  must(K.sub === K.repo && K.subDeep === K.repo && K.sibling !== K.repo,
    '同一个工作区根的子目录与根算同一把钥匙，兄弟工作区算另一把',
    'repo=' + K.repo + ' sub=' + K.sub + ' sibling=' + K.sibling)

  // #1893：宿主内存快照表已退役，面板数据的共享来源换成工作区快照库。这一节守的契约不变：
  // 同一工作区根的根目录会话与子目录会话看的是同一份数据，第二个人打开不再取数；兄弟工作区各是各的；
  // 强制刷新只重建自己那一份；并发同时打开只取一次。
  title('B) 面板数据：同一工作区根共用一份库回放（先后、并发、A/B、强制）')
  {
    const librarySnaps = new Map<string, any>()
    let builds = 0
    const snapFires: Array<{ level: unknown, event: unknown, fields: any }> = []
    const { createSessionSnapshot } = await import(url('src/refresh/rooms/host/session-snapshot-cache.js'))
    const library = {
      // 门禁里的假库：上一趟采纳的快照就是「库里的回放」。
      readSnapshotReplay: async (input: any) => {
        const snap = librarySnaps.get(String(input && input.workspaceRoot))
        return snap ? { snapshot: snap, lastKnownAtMs: Date.now() } : null
      },
      readSnapshotDiagnostics: async () => [],
      recordIssueRows: async () => ({ ok: true, rows: 0, mergeVersion: null }),
    }
    const h = createSessionSnapshot({
      canonicalKey: async (raw: string) => { if (raw === RAW.sub || raw === RAW.subDeep || raw === RAW.repo) return K.repo; if (raw === RAW.sibling) return K.sibling; return String(raw) },
      selectEarly: async ({ cwd, backendId }: any) => ({ backendId: backendId || 'github', source: 'auto', rev: 0 }),
      isComposerSelection: () => false,
      getTrackerRegistry: async () => ({
        modules: () => [],
        describe: ({ cwd }: any, backendId: string) => ({ backend: backendId, refId: 'acme/demo', name: 'acme/demo', url: '' }),
        get: () => ({ list: async () => { builds++; await new Promise((r) => setTimeout(r, 80)); return { ok: true, data: [{ type: 'issue', key: '1', title: 'A', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }] } } }),
      }),
      getPlatform: async () => PLATFORM,
      ctx: { get: () => undefined },
      upcaseSnapStates: (s: any) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }), groupTickets: (t: any[]) => ({ total: t.length, open: t.length, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async (cwd: string) => cwd, getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
      // 采纳快照 = 这一份已经进了库：下一次首屏就能从库里回放。
      adoptSnapshot: (snap: any, cwd: string) => { librarySnaps.set(String(cwd), snap); return snap },
      detectionExec: async () => ({ ok: false }), getGhPath: () => '', getGhLastError: () => '', errText: (e: any) => String((e && e.message) || e),
      DEFAULT_CWD: RAW.repo, logCtx: { fire: (level: unknown, event: unknown, fields: any) => { snapFires.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields }) }, isEnabled: () => true },
      getSnapshotLibrary: async () => library,
    } as any)
    const first = await h.handleSnapshot({ cwd: RAW.repo })
    must(first && first.ok !== false && builds === 1, '根目录会话首次打开面板重建一次（后端只调一次）', 'builds=' + builds)
    const second: any = await h.handleSnapshot({ cwd: RAW.sub })
    must(builds === 1 && second && second.maps === first.maps, '子目录会话先后打开读同一份库回放，不起新的外部命令', 'builds=' + builds + ' sameMaps=' + !!(second && second.maps === first.maps))
    must(second && second.fromCache === true, '子目录会话这一份标了 fromCache（来自库回放，不是又取了一遍）')
    // 并发：库清空后同时开两个同根请求，只取数一次且拿到同一份
    librarySnaps.clear()
    builds = 0
    const [c1, c2]: any[] = await Promise.all([h.handleSnapshot({ cwd: RAW.repo }), h.handleSnapshot({ cwd: RAW.subDeep })])
    must(builds === 1 && c1 === c2, '同根并发同时打开只取数一次，两边拿到同一份', 'builds=' + builds + ' same=' + (c1 === c2))
    must(snapFires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'snapshot'), '同根并发的后来者在途命中记 dedup.hit（作用域为快照）', JSON.stringify(snapFires.filter((f) => f.event === 'dedup.hit')))
    // A/B 隔离：B 重建不影响 A，切回 A 走自己的库回放
    const buildsBeforeB = builds
    const bFirst: any = await h.handleSnapshot({ cwd: RAW.sibling })
    must(builds === buildsBeforeB + 1 && bFirst && bFirst.maps !== c1.maps, '另一个工作区（B）首次打开取自己那一份，不复用 A', 'builds=' + builds)
    const aAgain: any = await h.handleSnapshot({ cwd: RAW.repo })
    must(aAgain && aAgain.maps === c1.maps && builds === buildsBeforeB + 1, '切回 A 读自己的库回放，不重建', 'builds=' + builds)
    // 强制只重建自己根：A 强制取数，B 不动
    const bAgainBefore: any = await h.handleSnapshot({ cwd: RAW.sibling })
    must(bAgainBefore && bAgainBefore.maps === bFirst.maps, 'B 在强制前仍读自己那份', 'sameMaps=' + !!(bAgainBefore && bAgainBefore.maps === bFirst.maps))
    const aForce: any = await h.handleSnapshot({ cwd: RAW.repo, force: true })
    must(aForce && aForce.maps !== c1.maps && builds === buildsBeforeB + 2, 'A 强制刷新重建自己那条', 'builds=' + builds)
    const bAfterForce: any = await h.handleSnapshot({ cwd: RAW.sibling })
    must(bAfterForce && bAfterForce.maps === bFirst.maps, 'A 强制刷新不碰 B 那条', 'sameMaps=' + !!(bAfterForce && bAfterForce.maps === bFirst.maps))
    // 旧「写操作只清自己根」那一档随内存副本一起退役：写回执现在先落库，库版本驱动下一次首屏；
    // 这里反过来钉住「没有任何 per-根 的内存清脏口可调」——会话电话的依赖里不再有 setCache/getCache。
    const sessionSrc = fsx.readFileSync(nodePath.join(ROOT, 'src/refresh/rooms/host/session-snapshot-cache.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    must(sessionSrc.indexOf('getCache') < 0 && sessionSrc.indexOf('createWorkingCopyFallback') < 0 && sessionSrc.indexOf('CACHE_MS') < 0,
      '会话电话不再有内存副本的读写口（写失效那一档随副本退役）')
  }

  title('C) 链快照表：先后、隔离、并发')
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
    // 这张假表只按键存取、读的时候不判过期（真判定现在住退避模块里）：这里验的是它把 ts 原样留着。
    table.setChainCache({ ts: Date.now() - 31000, key: kA, value: vA })
    const old = table.getChainCache(kA)
    must(Date.now() - old.ts >= 30000, '假表按键存着旧条目、读时不判过期', 'age=' + (Date.now() - old.ts))
    // 20 条上限
    for (let i = 0; i < 21; i++) table.setChainCache({ ts: Date.now(), key: 'k' + i, value: { marker: i } })
    must(table.map.size === 20, '链表最多留 20 条，超出丢最久没用的', 'size=' + table.map.size)
    // 并发共用同一份：真跑 handleChain，计数探测次数
    let detects = 0
    const chainFires: Array<{ level: unknown, event: unknown, fields: any }> = []
    const { createDetectChain } = await import(url('src/refresh/rooms/host/check-chain-evaluation.js'))
    const chainTable = makeChainTable()
    const dh = createDetectChain({
      canonicalKey: async (raw: string) => { if (raw === RAW.sub || raw === RAW.repo) return K.repo; return String(raw) },
      DEFAULT_CWD: RAW.repo, resetGhCache: () => {},
      getDetectionService: async () => ({ detect: async () => { detects++; await new Promise((r) => setTimeout(r, 80)); return { selection: { backendId: 'github', source: 'auto' } } } }),
      getPlatform: async () => PLATFORM,
      getTrackerRegistry: async () => ({ modules: () => [] }),
      getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
      runGh: async () => ({ ok: false, kind: 'network', error: 'net' }),
      timer: { timeout: (ms: number) => new Promise((r) => setTimeout(r, ms)) },
      probeSkill: async () => { await new Promise((r) => setTimeout(r, 60)); return { ok: false, level: 'bad', detail: 'x', hint: '', repo: null } },
      mdPredicate: async () => ({ status: 'pending', detail: 'x' }),
      getChainCache: chainTable.getChainCache, setChainCache: chainTable.setChainCache,
      logCtx: { fire: (level: unknown, event: unknown, fields: any) => { chainFires.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields }) }, isEnabled: () => true },
    })
    const [r1, r2] = await Promise.all([dh.handleChain({ cwd: RAW.repo, backendId: 'github', lang: 'zh' }), dh.handleChain({ cwd: RAW.sub, backendId: 'github', lang: 'zh' })])
    must(r1 === r2, '同根并发同时求链拿到同一份（在途合并）', 'same=' + (r1 === r2))
    must(detects === 1, '同根并发只求值一次（后端只算一次）', 'detects=' + detects)
    must(chainFires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'chain'), '同根并发的后来者在途命中记 dedup.hit（作用域为链）', JSON.stringify(chainFires.filter((f) => f.event === 'dedup.hit')))
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); cleanup(); process.exit(1) }
  console.log('全部通过 ✅ — 同一工作区根共用同一份库回放')
  cleanup()
}

main().catch(function (e) { console.error('RUNNER ERROR:', e && e.stack || e); cleanup(); process.exit(2) })