// verify-1472-write-event-fetch.ts —— 门禁：#1472 写事件之后 5 秒内界面能看见新状态（写事件真取数 + 探针短路）
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1472-write-event-fetch.ts
//
// 这一条盯的是「写完之后界面怎么拿到新数据」这条路，不是显示结果本身：
//   ① 生产形状（**不传** d.openSession）下，写事件 deck_issue_patch 触发的那一趟取数真的发生：
//      快照里那一行变成新状态、版本号必变、世代号前进、只发 1 条薄查询；没有整份重建（setCache 没有收过空快照）。
//   ② 取回来的补丁被交给下一次 wf.probe：探针即使取数口坏掉（fetchIssueIndexWindowed 抛错、一次都没被调），
//      也直接回 mode=patch + snapshot，客户端据此立刻 applySnap，不必等整份快照。
//   ③ 补丁遇到快照里没有的票（点名票号的那条路）也追加进列表，deck.partial 置真，水印不动。
//   ④ deltaRefresh 的守卫不再要求调用方注入 d.openSession（生产本来就没有这一格）：
//      生产形状下它真的跑行级增量（mode=patch），不再恒回 no-transport。
//   ⑤ 失败不静默（直接测取数那一格）：没有根映射记 write-no-root、取数抛错记 write-patch-threw（带 err 原文）、
//      暂存补丁过期丢弃记 write-patch-expired；三种情况都不发请求、回值仍是 0 条 0 点。
//   ⑥ 新建票（写事件 payload 里没有票号）走 probe-now：先问一次窗口索引、只补新增的那一条，
//      不重启 DSH 就能在快照里看见，且没有整份重建。
//
// 门禁归属（归属表只认这几行，别删）：
// 门禁归属: src/refresh/rooms/host/write-event-fetch.ts
// 门禁归属: src/refresh/rooms/host/patch-wiring.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts
// 门禁归属: src/refresh/rooms/host/refresh-runtime.ts
// 门禁归属: src/refresh/rooms/host/probe-handler.ts
//
// 为什么必须单独有这一条：verify-723 只守「写事件交出去了」，verify-delta-wiring 只守「探测说变了怎么补行」；
// 两者之间那句「写完之后谁把新状态送到客户端」此前是空实现（refresh-runtime 的 fetchForWriteEvent 恒回 0）——
// 于是界面上票关了、胶囊还亮着。本门禁补上这一段，并守住「探针坏了也不影响这一条」。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

const CWD = 'C:/ws/1472-write-event'

async function main() {
  console.log('#1472 门禁：写事件之后 5 秒内界面能看见新状态（真取数 + 探针短路）')
  const delta = await imp('src/refresh/kernel/snapshot-diff.js')
  const win = await imp('src/refresh/kernel/index-window-rules.js')
  const wiringMod = await imp('src/refresh/rooms/host/refresh-runtime.js')
  const attentionMod = await imp('src/refresh/rooms/host/host-attention.js')
  const probeMod = await imp('src/refresh/rooms/host/probe-handler.js')
  const wefMod = await imp('src/refresh/rooms/host/write-event-fetch.js')

  function row(n: number, state: string, updatedAt: string) {
    return { number: n, key: String(n), title: '票 ' + n, state: state, updatedAt: updatedAt, labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z' }
  }

  // ---- 一个可摆布的假世界：内存快照 + 会话（薄查询记账）+ 可变的窗口索引 + 日志 ----
  function buildWorld() {
    const NOW0 = Date.now()
    const WM0 = NOW0 - 3600000
    const FIX_AT = new Date(NOW0 + 3600000).toISOString()
    const seeded: any = {
      ok: true, repo: { owner: 'o', name: 'r' }, workspaceRoot: CWD, version: 'v0', generatedMs: NOW0 - 60000,
      maps: [{ number: 100, key: '100', state: 'OPEN', updatedAt: FIX_AT, tickets: [row(101, 'OPEN', FIX_AT)] }],
      issues: [row(101, 'OPEN', FIX_AT), row(102, 'OPEN', FIX_AT), row(103, 'OPEN', FIX_AT)],
      labels: [], deck: { counts: { open: 3, closed: 0, total: 3 }, partial: false, levels: [] },
      delta: { structureVersion: delta.DELTA_STRUCTURE_VERSION, watermarkMs: WM0, generation: 3, pending: [], pendingAt: 0, pendingReason: '' },
    }
    const cacheBox: any = { ts: NOW0 - 60000, snapshot: seeded, error: null, cwd: CWD }
    const disk: any = { snap: seeded }
    const windowIndex: any = { '101': 'OPEN|' + FIX_AT, '102': 'OPEN|' + FIX_AT, '103': 'OPEN|' + FIX_AT }
    const sessionGets: string[] = []
    const probeCalls: string[] = []
    const logLines: any[] = []
    const nullWrites: any[] = []
    const logCtx = { isEnabled: (l: string) => l === 'debug', fire: (level: string, name: string, fields: any) => logLines.push({ level, name, fields }) }
    const fakeTracker: any = {
      list: async () => ({ ok: true, data: [] }),
      listPage: async () => ({ ok: true, data: { items: [], nextCursor: null, total: 0 } }),
      get: async (ref: any, key: any) => {
        sessionGets.push(String(key))
        const parts = String(windowIndex[key] || 'OPEN|').split('|')
        return { ok: true, data: { key: String(key), title: '票 ' + key, state: String(parts[0]).toLowerCase(), updatedAt: parts[1], createdAt: '2026-09-01T00:00:00Z', labels: [], assignees: [], isPullRequest: false, mergedAt: null } }
      },
      getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
      listSubIssues: async () => ({ ok: true, data: { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } }),
      readBudget: async () => ({ ok: true, data: { known: false, reason: 'test' } }),
    }
    const fakeRegistry: any = {
      select: async () => ({ backendId: 'markdown' }),
      get: () => fakeTracker,
      modules: () => [{ id: 'markdown', budget: {} }],
      describe: () => ({ backend: 'markdown', refId: 'o/r', name: 'o/r', url: '' }),
    }
    // 生产形状：**没有 d.openSession**（生产入口从来不传这一格）。开会话那一侧由 wiring 内部装配。
    const wiring: any = wiringMod.createRefreshWiring({
      ctx: { on: () => () => {}, get: () => undefined },
      logCtx: logCtx,
      canonicalKey: async (p: any) => String(p),
      getCacheDir: async () => CWD,
      getTrackerRegistry: async () => fakeRegistry,
      getPlatform: async () => ({ path: path.posix }),
      detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
      getCache: () => cacheBox,
      setCache: (v: any) => {
        if (!v || !v.snapshot) { nullWrites.push(v); return }
        cacheBox.snapshot = v.snapshot
        cacheBox.ts = v.ts
      },
      readDiskCache: async () => disk.snap,
      writeDiskCache: async (repo: any, snap: any) => { disk.snap = snap },
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      fetchIssueIndex: (cwd: any, sinceIso: any) => {
        probeCalls.push(String(sinceIso || ''))
        return Promise.resolve({ ok: true, index: Object.assign({}, windowIndex), nextWatermarkMs: Date.now(), repo: { owner: 'o', name: 'r' }, count: Object.keys(windowIndex).length })
      },
      issueIndexFromSnapshot: (snap: any) => win.indexFromSnapshot(snap),
    })
    // 活跃集合那一格：走生产那条 wf.focus → syncAttention，白名单与写事件接线才会真的记住这个根。
    const focus = attentionMod.createFocusHandler({ attention: wiring.attention, afterReport: () => wiring.syncAttention() })
    // 账本读数：与 verify-delta-wiring 同款，免得闸把探测判成「额度未知」而推迟。
    try { wiring.ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: NOW0 + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: NOW0 + 3600000 } }, NOW0) } catch (e: any) {}
    return { wiring, cacheBox, disk, windowIndex, sessionGets, probeCalls, logLines, nullWrites, focus, seeded, NOW0, FIX_AT }
  }

  function takeOf(w: any) {
    return (typeof w.wiring.takeWritePatch === 'function') ? w.wiring.takeWritePatch : () => null
  }

  function rowIn(snap: any, n: number) {
    return ((snap && snap.issues) || []).filter((x: any) => Number(x.number) === n)[0] || null
  }

  // 写一次 deck 工具（payload 原样给：改票带 key，新建票只有 title）。
  async function writeDeck(w: any, sid: string, tool: string, payload: any) {
    return await w.wiring.writeEvents.handle({ id: sid, header: { cwd: CWD } }, 'tools/result', tool, JSON.stringify(payload), true)
  }

  // ---- ① 写了就补：生产形状下写事件真的去取数，并只动那一行 ----
  {
    const w = buildWorld()
    await w.focus({ windowId: 'win-1472-a', workspaceRoot: CWD, kind: 'focus', visible: true })
    w.windowIndex['101'] = 'CLOSED|' + w.FIX_AT
    const out = await writeDeck(w, 'sess-1472-a', 'deck_issue_patch', { key: '101' })
    check(out && out.verdictOfGate === 'in-pipeline', '① 写事件这一趟真的交给了管线（' + JSON.stringify(out) + '）')
    const snap = w.cacheBox.snapshot
    const r101 = rowIn(snap, 101)
    check(!!r101 && r101.state === 'CLOSED', '① 快照里那一行就是取回来的新状态（101 → ' + (r101 && r101.state) + '）')
    check(snap.version !== w.seeded.version, '① 版本号必变（' + w.seeded.version + ' → ' + snap.version + '）——否则客户端的「内容没变」捷径会把新数据当旧的丢掉')
    check(snap.delta && snap.delta.generation === w.seeded.delta.generation + 1, '① 世代号前进一格（' + w.seeded.delta.generation + ' → ' + (snap.delta && snap.delta.generation) + '）')
    check(w.sessionGets.length === 1 && w.sessionGets[0] === '101', '① 只发 1 条薄查询（实发 ' + JSON.stringify(w.sessionGets) + '）')
    check(w.probeCalls.length === 0, '① 写事件这一趟没有去问窗口索引（实问 ' + w.probeCalls.length + ' 次）')
    check(w.nullWrites.length === 0, '① 没有整份重建（setCache 没收到过空快照，实收 ' + w.nullWrites.length + ' 次）')
    check(snap.issues.length === 3, '① 列表条数没变（位置不动，' + snap.issues.length + ' 行）')
    const mapRow = ((snap.maps && snap.maps[0] && snap.maps[0].tickets) || []).filter((x: any) => Number(x.number) === 101)[0]
    check(!!mapRow && mapRow.state === 'CLOSED', '① 地图下面那一份也一起更新（maps[0].tickets[101] → ' + (mapRow && mapRow.state) + '）')
    check(w.logLines.some((l: any) => l.name === 'refresh.patch' && l.fields && l.fields.reason === 'write-patch' && l.fields.mode === 'patch'),
      '① 落了一行既有事件 refresh.patch（reason=write-patch，没有新造事件名）')
    const take = takeOf(w)
    const wp = take(CWD)
    check(!!wp && wp.mode === 'patch' && !!wp.snapshot && rowIn(wp.snapshot, 101).state === 'CLOSED',
      '① 补好的那一份被交给下一次探针（takeWritePatch 有值）')
    check(!!wp && take(CWD) === null, '① 这一份只交一次（第二次拿不到，避免每次探测都重放同一补丁）')
  }

  // ---- ② 探针取数口坏了也不影响这一条：短路先回补丁 ----
  {
    const w = buildWorld()
    await w.focus({ windowId: 'win-1472-b', workspaceRoot: CWD, kind: 'focus', visible: true })
    w.windowIndex['102'] = 'CLOSED|' + w.FIX_AT
    await writeDeck(w, 'sess-1472-b', 'deck_issue_patch', { key: '102' })
    let windowedCalls = 0
    const probe: any = probeMod.createProbeHandler({
      canonicalKey: async (p: any) => String(p),
      selectEarly: async () => null,
      isComposerSelection: () => false,
      getTrackerRegistry: async () => null,
      getPlatform: async () => ({ path: path.posix }),
      ctx: { get: () => undefined },
      errText: (e: any) => String((e && e.message) || e),
      fetchIssueIndexWindowed: () => { windowedCalls += 1; return Promise.reject(new Error('探针取数坏了')) },
      commitIssueIndex: () => null,
      deltaRefresh: () => Promise.resolve({ mode: 'failed', reason: 'should-not-run' }),
      issueIndexChanged: () => true,
      rememberIssueIndex: () => {},
      getCache: () => w.cacheBox,
      setCache: () => null,
      lastIssueIndexByRepo: {},
      lastProbeAtByRepo: {},
      takeWritePatch: (cwd: any) => takeOf(w)(cwd),
    })
    const res = await probe.handleProbe({ cwd: CWD })
    check(res && res.ok === true && res.changed === true && res.mode === 'patch', '② 探针直接回补好的那一份（' + JSON.stringify(res && { ok: res.ok, changed: res.changed, mode: res.mode, reason: res.reason }) + '）')
    check(windowedCalls === 0, '② 这一次根本没去问窗口索引（取数口坏着也不影响，实问 ' + windowedCalls + ' 次）')
    check(!!res && !!res.snapshot && rowIn(res.snapshot, 102).state === 'CLOSED', '② 回包里那一行就是新状态（102）')
  }

  // ---- ③ 点名票号的那条路：列表里还没有的票也追加进去 ----
  {
    const w = buildWorld()
    await w.focus({ windowId: 'win-1472-c', workspaceRoot: CWD, kind: 'focus', visible: true })
    w.windowIndex['105'] = 'OPEN|' + w.FIX_AT
    await writeDeck(w, 'sess-1472-c', 'deck_issue_patch', { key: '105' })
    const snap = w.cacheBox.snapshot
    const r105 = rowIn(snap, 105)
    check(!!r105, '③ 列表里还没有的票也补进来了（105）')
    check(snap.issues.length === 4, '③ 列表多了一行（3 → ' + snap.issues.length + '）')
    check(snap.deck && snap.deck.partial === true, '③ deck.partial 置真（整仓计数保持旧值，不当场编一个）')
    check(snap.delta.watermarkMs === w.seeded.delta.watermarkMs, '③ 水印一个字节都没动（写事件这一条不是窗口探测）')
    let windowedCalls = 0
    const probe: any = probeMod.createProbeHandler({
      canonicalKey: async (p: any) => String(p),
      selectEarly: async () => null,
      isComposerSelection: () => false,
      getTrackerRegistry: async () => null,
      getPlatform: async () => ({ path: path.posix }),
      ctx: { get: () => undefined },
      errText: (e: any) => String((e && e.message) || e),
      fetchIssueIndexWindowed: () => { windowedCalls += 1; return Promise.resolve({ ok: false, error: 'should-not-run' }) },
      commitIssueIndex: () => null,
      deltaRefresh: () => Promise.resolve({ mode: 'failed', reason: 'should-not-run' }),
      issueIndexChanged: () => true,
      rememberIssueIndex: () => {},
      getCache: () => w.cacheBox,
      setCache: () => null,
      lastIssueIndexByRepo: {},
      lastProbeAtByRepo: {},
      takeWritePatch: (cwd: any) => takeOf(w)(cwd),
    })
    const res = await probe.handleProbe({ cwd: CWD })
    check(windowedCalls === 0 && !!res && res.mode === 'patch' && !!rowIn(res.snapshot, 105), '③ 下一次探针就把新票交给客户端（不整份重建）')
  }

  // ---- ④ 生产形状下 deltaRefresh 真的跑（不再恒回 no-transport） ----
  {
    const w = buildWorld()
    await w.focus({ windowId: 'win-1472-d', workspaceRoot: CWD, kind: 'focus', visible: true })
    w.windowIndex['102'] = 'CLOSED|' + w.FIX_AT
    const r = await w.wiring.deltaRefresh(CWD, {})
    check(r && r.mode === 'patch', '④ 生产形状下探测那条路走通行级增量（mode=' + (r && r.mode) + ' / reason=' + (r && r.reason) + '）')
    check(w.sessionGets.indexOf('102') >= 0, '④ 变的那一张票真的取回来了（会话 get：' + JSON.stringify(w.sessionGets) + '）')
    check(rowIn(w.cacheBox.snapshot, 102).state === 'CLOSED', '④ 快照里 102 是新状态')
    check(w.probeCalls.length === 1, '④ 窗口索引问了 1 次（实问 ' + w.probeCalls.length + ' 次）')
  }

  // ---- ⑤ 失败不静默：直接测取数那一格的三条失败路（生产里白名单挡在门前，这里才够得着） ----
  {
    let clock = 1000
    const logs: any[] = []
    const calls: any[] = []
    const fakePatch: any = {
      log: (mode: string, reason: string, extra: any) => logs.push({ mode: mode, reason: reason, extra: extra || {} }),
      patchTickets: async (cwd: string, keys: string[]) => { calls.push({ kind: 'tickets', cwd: cwd, keys: keys }); return { mode: 'patch', reason: 'write-patch', rows: keys, snapshot: { issues: [] }, queries: 1 } },
      patchChanged: async (cwd: string) => { calls.push({ kind: 'changed', cwd: cwd }); return { mode: 'patch', reason: 'write-patch', rows: ['106'], snapshot: { issues: [] }, queries: 2 } },
    }
    const fetcher: any = wefMod.createWriteEventFetch({
      patchOf: () => fakePatch, hash8: (s: any) => 'h:' + String(s),
      canonicalKey: async (p: any) => String(p), now: () => clock,
    })
    const zero = await fetcher.fetch({ action: 'patch-now', ticket: '101' }, { workspaceKey: 'nope' })
    check(zero.requests === 0 && zero.points === 0, '⑤ 回值仍恒为 0 条 0 点（#1444 裁决）')
    check(calls.length === 0, '⑤ 没有根映射：一条请求都不发（实发 ' + calls.length + ' 次）')
    check(logs.some((l: any) => l.reason === 'write-no-root'), '⑤ 没有根映射如实记 reason=write-no-root')

    await fetcher.remember(CWD)
    const keyHash = 'h:' + CWD
    fakePatch.patchTickets = async () => { throw new Error('取数爆了') }
    await fetcher.fetch({ action: 'patch-now', ticket: '101' }, { workspaceKey: keyHash })
    const threw = logs.filter((l: any) => l.reason === 'write-patch-threw')[0]
    check(!!threw, '⑤ 取数抛错记 reason=write-patch-threw')
    check(!!threw && String(threw.extra.err || '').indexOf('取数爆了') >= 0, '⑤ 抛错那一行带着上游原话（err 截断 120 字符）')

    fakePatch.patchTickets = async (cwd: string, keys: string[]) => { calls.push({ kind: 'tickets', cwd: cwd, keys: keys }); return { mode: 'patch', reason: 'write-patch', rows: keys, snapshot: { issues: [] }, queries: 1 } }
    const ok1 = await fetcher.fetch({ action: 'patch-now', ticket: '101' }, { workspaceKey: keyHash })
    check(ok1.requests === 0 && ok1.points === 0, '⑤ 成功那一趟回值也仍是 0 条 0 点（真实用量归 #1446）')
    const wp1 = fetcher.takeWritePatch(CWD)
    check(!!wp1 && typeof wp1.at === 'number' && wp1.at === clock, '⑤ 补好的那一份带着自己记下的时刻（探针的 since 用它）')
    await fetcher.fetch({ action: 'patch-now', ticket: '101' }, { workspaceKey: keyHash })
    clock += 16000
    check(fetcher.takeWritePatch(CWD) === null, '⑤ 超过 15 秒的暂存补丁直接丢掉（不重放旧版本）')
    check(logs.some((l: any) => l.reason === 'write-patch-expired'), '⑤ 过期丢弃记 reason=write-patch-expired')
    await fetcher.fetch({ action: 'probe-now' }, { workspaceKey: keyHash })
    check(calls.some((c: any) => c.kind === 'changed'), '⑤ 没有票号的写事件走 probe-now：交给 patchChanged 去问窗口索引')
  }

  // ---- ⑥ 新建票（payload 里没有票号）不重启也能看见：probe-now → 只补新增的那一条 ----
  {
    const w = buildWorld()
    await w.focus({ windowId: 'win-1472-f', workspaceRoot: CWD, kind: 'focus', visible: true })
    w.windowIndex['106'] = 'OPEN|' + w.FIX_AT
    const out = await writeDeck(w, 'sess-1472-f', 'deck_issue_create', { title: '票 106', body: '一条新票' })
    check(out && out.verdictOfGate === 'in-pipeline', '⑥ 新建票这一趟真的交给了管线（' + JSON.stringify(out) + '）')
    check(w.probeCalls.length === 1, '⑥ 没有票号可点名：先问了一次窗口索引（实问 ' + w.probeCalls.length + ' 次）')
    check(w.sessionGets.indexOf('106') >= 0, '⑥ 新增的那一张真的取回来了（会话 get：' + JSON.stringify(w.sessionGets) + '）')
    const snap = w.cacheBox.snapshot
    check(!!rowIn(snap, 106) && snap.issues.length === 4, '⑥ 新票进了快照（列表 ' + snap.issues.length + ' 行，不用重启 DSH）')
    check(w.nullWrites.length === 0, '⑥ 没有整份重建（setCache 没收到过空快照，实收 ' + w.nullWrites.length + ' 次）')
    const wp = takeOf(w)(CWD)
    check(!!wp && !!wp.snapshot && !!rowIn(wp.snapshot, 106), '⑥ 下一次探针把含新票的那一份交给客户端')
  }

  console.log('\n' + (failed ? '存在失败 — #1472 门禁未通过' : '全部通过 — 写事件真取数 + 探针短路（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
