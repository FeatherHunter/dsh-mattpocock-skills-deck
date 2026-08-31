// verify-issue232-sync.js — #232 回归门禁：AI 改 Issue 后右侧面板未自动增量更新（五层重构回归）
// 三段式：
//   A) 契约层纯函数单元（src/shared/tracker/sync.js 直接 import）
//   B) 五层接线静态断言（源文件特征；防有人悄悄拆掉接线）
//   C) 宿主分发端到端（stub gh 索引差值：建档不判脏 → gap 内静默 → 差值命中回执 dirtyCwds）
//   #232 追加：视线门控（R1–R4）节拍单源断言 + 脏信号回执持久性端到端
// 用法: node tests/verify-issue232-sync.js（C 段需要先 node scripts/build.mjs 生成 package/lib）

const fs = require('fs')
const path = require('path')

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const ROOT = path.join(__dirname, '..')
const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

async function main() {
  // ===================== A · 契约层纯函数 =====================
  const S = await import('../src/shared/tracker/sync.js')
  const SYNC = S.SYNC

  const BASE = {
    '1': 'OPEN|2026-08-26T01:00:00Z',
    '2': 'CLOSED|2026-08-26T02:00:00Z',
    '3': 'OPEN|2026-08-27T09:30:00Z',
  }
  const jline = (num, state, upd) => JSON.stringify({ number: num, state: state, updatedAt: upd })

  // parseIndexEntries
  const entries = S.parseIndexEntries([jline(1, 'open', '2026-08-26T01:00:00Z'), '', '{bad json', jline(2, 'closed', '2026-08-26T02:00:00Z')].join('\n'))
  check(entries['1'] === 'OPEN|2026-08-26T01:00:00Z', 'parseIndexEntries 归一 state 大写与比较串形状')
  check(entries['2'] === 'CLOSED|2026-08-26T02:00:00Z' && Object.keys(entries).length === 2, 'parseIndexEntries 跳过空行/坏行（宁可漏报不误报）')
  check(Object.keys(S.parseIndexEntries('')).length === 0 && Object.keys(S.parseIndexEntries(null)).length === 0, 'parseIndexEntries 空输入 → 空索引')

  // deriveDirty：首看建档 / 无变化 / 状态变化 / 更新时刻变化 / 新增票（增量集禁条目数对比）
  check(S.deriveDirty(null, { '9': 'OPEN|x' }) === false, 'deriveDirty 首看建档不判脏（#266 同原则）')
  check(S.deriveDirty(BASE, { '3': 'OPEN|2026-08-27T09:30:00Z' }) === false, 'deriveDirty 增量集为基线子集且值一致 → 不脏')
  check(S.deriveDirty(BASE, { '1': 'CLOSED|2026-08-26T01:00:00Z' }) === true, 'deriveDirty state 变化判脏')
  check(S.deriveDirty(BASE, { '3': 'OPEN|2026-08-27T10:00:00Z' }) === true, 'deriveDirty updatedAt 变化判脏（评论数变化可见）')
  check(S.deriveDirty(BASE, { '42': 'OPEN|2026-08-27T11:00:00Z' }) === true, 'deriveDirty 新增票判脏（since 增量集语义）')
  check(S.deriveDirty(BASE, {}) === false, 'deriveDirty 空增量集 → 静默')
  // 有意取舍：删除票在 since 视图不可见 → 交由 60s 全量探针兜底，此处仅固化行为防误改
  check(SYNC.EVAL_GAP_MS >= 4000, 'SYNC.EVAL_GAP_MS 配额闸 ≥4s')

  // #232 视线门控追加：同步链路节拍真源（client 内核只许派生引用，杜绝第二份字面量真相）
  for (const nm of ['POLL_GRID_MS', 'ACTION_PROBE_WINDOW_MS', 'FALLBACK_PROBE_MS', 'FOCUS_PROBE_MIN_MS', 'SNAP_FRESH_MS', 'ISSUE_CACHE_TTL']) {
    check(typeof SYNC[nm] === 'number' && SYNC[nm] > 0 && Object.isFrozen(SYNC), 'SYNC.' + nm + ' 契约层在场且冻结')
  }

  // advanceBaseline：不改入参、覆盖推进
  const b0 = Object.assign({}, BASE)
  const b1 = S.advanceBaseline(BASE, { '42': 'OPEN|2026-08-27T11:00:00Z', '3': 'OPEN|2026-08-27T10:00:00Z' })
  check(b1['42'] === 'OPEN|2026-08-27T11:00:00Z' && b1['3'] === 'OPEN|2026-08-27T10:00:00Z', 'advanceBaseline 合并新增与覆盖')
  check(JSON.stringify(b0) === JSON.stringify(BASE), 'advanceBaseline 不改入参（纯）')

  // sinceFloor：重叠回看 / 空水位 / 坏水位
  const fl = S.sinceFloor('2026-08-27T09:30:00Z')
  check(fl !== '' && Date.parse(fl) < Date.parse('2026-08-27T09:30:00Z'), 'sinceFloor 回看重叠窗口（边界漏检消除）')
  check(Date.parse('2026-08-27T09:30:00Z') - Date.parse(fl) === SYNC.OVERLAP_SKEW_MS, 'sinceFloor 默认偏移 = OVERLAP_SKEW_MS')
  check(S.sinceFloor('') === '' && S.sinceFloor('not-a-date') === '', 'sinceFloor 空/坏水位 → 全量建档路径')

  // bumpMaxUpdated：水位单调 + 管道串解析
  check(S.bumpMaxUpdated('2026-08-27T09:30:00Z', { '5': 'OPEN|2026-08-28T00:00:00Z', '6': 'OPEN|bad' }) === '2026-08-28T00:00:00Z', 'bumpMaxUpdated 取最大 updatedAt 并容忍坏值')
  check(S.bumpMaxUpdated('', {}) === '', 'bumpMaxUpdated 空集保持水位')

  // needProbeSource：词汇表单源（#213 三源保留 + index-dirty；mention/未知源不触发探针）
  check(S.needProbeSource('gh-create') && S.needProbeSource('gh-edit') && S.needProbeSource('claim') && S.needProbeSource('index-dirty'), 'needProbeSource 四源触发')
  check(!S.needProbeSource('mention') && !S.needProbeSource('') && !S.needProbeSource(undefined), 'needProbeSource 其他源不触发探针')

  // pickSyncCandidates：首看优先 / gap 闸 / resolving / 熔断 / cap / 去重保序
  const now = 10000000
  const items = [{ cwd: 'C:/a', id: 'o/a' }, { cwd: 'C:/b', id: 'o/b' }, { cwd: 'C:/a', id: 'o/a' }, { cwd: 'C:/c', id: 'o/c' }]
  check(JSON.stringify(S.pickSyncCandidates(items, {}, now)) === JSON.stringify(['C:/a', 'C:/b']), 'pickSyncCandidates 首看候选优先 + cap=EVALS_PER_TICK + 去重保序')
  const stGap = { lastEvalAt: now - SYNC.EVAL_GAP_MS + 1, failures: 0 }
  check(S.pickSyncCandidates([{ cwd: 'C:/a', id: 'o/a' }], { 'o/a': stGap }, now).length === 0, 'pickSyncCandidates gap 闸内静默（配额保护）')
  const stOk = { lastEvalAt: now - SYNC.EVAL_GAP_MS - 1, failures: 0 }
  check(JSON.stringify(S.pickSyncCandidates([{ cwd: 'C:/a', id: 'o/a' }], { 'o/a': stOk }, now)) === JSON.stringify(['C:/a']), 'pickSyncCandidates gap 过后放行')
  check(S.pickSyncCandidates([{ cwd: 'C:/a', id: 'o/a' }], { 'o/a': { resolving: true, lastEvalAt: 0 } }, now).length === 0, 'pickSyncCandidates 建档在途跳过（无重复全量）')
  check(S.pickSyncCandidates([{ cwd: 'C:/a', id: 'o/a' }], { 'o/a': { suspendedUntil: now + 999, lastEvalAt: 0 } }, now).length === 0, 'pickSyncCandidates 失败熔断期跳过')

  // 失败/成功记账转移
  const f1 = S.noteEvalFailure({ failures: 0 }, now)
  const f2 = S.noteEvalFailure(f1, now)
  const f3 = S.noteEvalFailure(f2, now)
  check(f1.failures === 1 && f2.suspendedUntil === 0 && f3.failures === SYNC.FAILURE_SUSPEND_AT && f3.suspendedUntil > now, 'noteEvalFailure 连败达阈进熔断窗（阈值前不熔断）')
  const okSt = S.noteEvalSuccess(f3, now)
  check(okSt.failures === 0 && okSt.suspendedUntil === 0 && okSt.lastEvalAt === now, 'noteEvalSuccess 清零计数并解除熔断')

  // ===================== B · 五层接线静态断言 =====================
  const hostSrc = readSrc('src/host/index.js').replace(/\r\n/g, '\n')
  const hostStart = hostSrc.indexOf('#232 · 面板增量同步')
  const syncEnd = hostSrc.indexOf('============ v1.5 T9：git 根检测', hostStart)
  const pollAt = hostSrc.indexOf("harness.handle('wf.issuePathPoll'")
  check(hostStart === -1 && pollAt === -1, '#232 面包屑通道与面板同步搭车位已随 #345 整块移除（hostStart/pollAt 均 -1）；变更检测由 wf.probe 的 since 语义原生承担')
  if (hostStart > 0 && syncEnd > hostStart) {
    const syncBlock = hostSrc.slice(hostStart, syncEnd)
    check(syncBlock.includes('getPanelSyncCore') && syncBlock.includes('../shared/tracker/sync.js'), '宿主经运行时 import 使用契约层单一真源')
    check(syncBlock.includes('core.pickSyncCandidates') && syncBlock.includes('core.deriveDirty') && syncBlock.includes('core.advanceBaseline'), '求值决策全部收敛于契约层纯函数（宿主零分支逻辑）')
    check(syncBlock.includes("cache = { ts: 0, snapshot: null, error: null, cwd: cwd }"), '差值命中失效快照缓存（#213 白名单同语义）')
    check(/\blastIssueIndexByRepo\s*\[/.test(syncBlock) === false, '不变量①：同步块绝不写 lastIssueIndexByRepo（防吞 wf.probe 判定）')
    check(/\bpushIssuePathEvent\s*\(/.test(syncBlock) === false, '不变量②：同步块不推 issuePath 事件（面包屑零污染）')
    check(syncBlock.includes('panelDirtySince'), '脏信号走独立回执通道 panelDirtySince（确认式消费）')
  }
  if (pollAt > 0) {
    const pollChunk = hostSrc.slice(pollAt, pollAt + 3000)
    check(pollChunk.includes('args.cwds') && pollChunk.includes('panelSyncEvaluate(cwdsIn)'), 'poll handler 接受 cwds 并触达重求值（旧客户端不带 cwds 行为不变）')
    check(pollChunk.includes('Promise.race') && pollChunk.includes('3500'), '重求值带 3.5s 竞速护栏（面包屑轮询不被拖死）')
    check(pollChunk.includes('dirtyCwds: dirtyCwds'), '响应回执 dirtyCwds 字段')
  }
  const storeSrc = readSrc('src/client/kernel/store.js').replace(/\r\n/g, '\n')
  check(!storeSrc.includes("host.call('wf.issuePathPoll'"), 'client poll 通道已随 #345 彻底移除（不再上报可见 cwd 列表）')
  check(!storeSrc.includes('pollIssuePathHost'), 'client 轮询函数 pollIssuePathHost 已随 #345 移除（视线门控随通道一并退役）')
  check(!storeSrc.includes('needProbeSource(ev.source)'), '探针触发源判定已随面包屑通道移除（#345）；needProbeSource 纯函数保留于契约层供单测')
  check(!storeSrc.includes("ev.source === 'gh-create'"), '旧三源字面量判定已移除（第二真源清零）')
  check(!storeSrc.includes('scheduleDirtyProbe') && !storeSrc.includes('dirtyCwds'), 'dirtyCwds 回执消费已随 #345 移除（宿主侧缓存失效由 runGh 白名单与 wf.probe 承担）')
  const probeSrc = readSrc('src/client/kernel/probe.js').replace(/\r\n/g, '\n')
  check(!probeSrc.includes('scheduleDirtyProbe') && !probeSrc.includes('DIRTY_PROBE_DEBOUNCE_MS'), '内核短窗探针 scheduleDirtyProbe 已随 #345 移除（唯一触发源 dirtyCwds 回执不复存在）')
  check(probeSrc.includes('export const scheduleActionProbe'), '#213 动作长窗原样保留（零回归）')

  // #232 视线门控（R1–R4）· client 内核接线断言
  check(!storeSrc.includes('SYNC.POLL_GRID_MS'), '面包屑轮询栅格已随 #345 移除（POLL_GRID_MS 契约常量保留于契约层）')
  check(!/setTimeout\(tick,/.test(storeSrc), 'store 无轮询 tick 残留（栅格表达式随通道一并清除）')
  for (const nm of ['FALLBACK_PROBE_MS', 'FOCUS_PROBE_MIN_MS', 'ACTION_PROBE_WINDOW_MS']) {
    check(probeSrc.includes('SYNC.' + nm), 'probe 节拍单源：SYNC.' + nm + ' 派生在场')
  }
  check(/setInterval\(function \(\) \{[\s\S]{0,400}?visibilityState[\s\S]{0,200}?\}, PROBE_MS\)/.test(probeSrc), 'R3 · 兜底探针 interval 内含视线门控（页签隐藏不发起新扫描）')
  check(!probeSrc.includes("host.call('wf.refresh', { cwd: cwd })"), 'R3 · 空组 wf.refresh 大查询兜底已移除（无人观看 cwd 零重建请求）')
  check(/fix H2 stale discard[\s\S]{0,700}setCachedSnapshot\(_reqNorm, snap\)/.test(probeSrc), 'R4 · H2 stale-discard 分支将结果落 per-cwd LRU（在途响应到达即落地）')

  // 对抗评审收尾断言（5e7f219 后 fixup）：
  check(storeSrc.includes('SYNC.ISSUE_CACHE_TTL') && probeSrc.includes('SYNC.SNAP_FRESH_MS'), '详情 TTL 与面板新鲜阈值升格契约层（同值双源清零）')
  check(((probeSrc.match(/visibilityState !== 'visible'/g) || []).length) >= 2, 'R3 闸覆盖两处发起入口：兜底 interval + 动作长窗回调（短窗回调已随 #345 移除；发起时刻资格复检保留）')
  check(probeSrc.includes("addEventListener('visibilitychange'"), '切页签恢复通道二在场（visibilitychange，与 focus 共用限流）')
  check(storeSrc.includes('delete s2.status'), '落缓存前剥除 notModified/status/cached 传输态标记')
  const bSrc = readSrc('scripts/build.mjs')
  check(bSrc.includes("file: 'src/shared/tracker/sync.js'"), 'build SHARED_SPLICE 已登记 trackerSync（一源两物）')
  const ciSrc = readSrc('src/client/index.js')
  check(ciSrc.includes('// ==== shared:trackerSync (spliced by build) ===='), 'client bundle 源含拼接标记')
  const pkgJson = JSON.parse(readSrc('package.json'))
  check((pkgJson.scripts.verify || '').includes('verify-issue232-sync.js'), 'npm run verify 链已纳入本门禁')

  // ===================== C · 宿主分发端到端（需先构建）=====================
  const pkgIndex = path.join(ROOT, 'package/lib/index.js')
  if (pollAt === -1) {
    console.log('  SKIP  C 段（#345 彻底移除后 issuePathPoll 分发通道不复存在，端到端断言随之退役；变更检测回归 wf.probe 原生 since 语义）')
  } else if (!fs.existsSync(pkgIndex)) {
    console.log('  SKIP  C 段（先运行 node scripts/build.mjs 生成 package/lib）')
  } else {
    const TCWD = 'D:/0fake-ws/sync-demo'
    let ghApiText = [
      jline(1, 'open', '2026-08-26T01:00:00Z'),
      jline(2, 'closed', '2026-08-26T02:00:00Z'),
      jline(3, 'open', '2026-08-27T09:30:00Z'),
    ].join('\n')
    const subprocess = {
      async resolveExecutable(name) { return name === 'git' ? 'git' : 'gh' },
      // 宿主真实服务签名：spawn({argv, cwd, stdio, graceMs})
      spawn(opts) {
        const a = (opts && Array.isArray(opts.argv) ? opts.argv : []).map(String)
        const joined = a.join(' ')
        let text = ''
        // 分支顺序敏感：remote get-url 也是 git 前缀，必须先于「git 根探测」匹配
        if (joined.includes('remote get-url origin')) text = 'https://github.com/acme/sync-demo.git'
        else if (a[0] === 'git') text = 'D:/0fake-ws/sync-demo'
        else if (joined.includes('repos/acme/sync-demo/issues')) text = ghApiText
        return {
          stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {},
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: { readFrom: () => ({ text: text }) }, stderr: { readFrom: () => ({ text: '' }) } },
        }
      },
    }
    const timerSvc = { timeout: (a2, b2) => (typeof a2 === 'function' ? setTimeout(a2, b2 || 0) : new Promise(function (res) { setTimeout(res, a2) })) }
    const platformSvc = {
      getHome: async () => '', path: { join: (...a2) => a2.join('/'), isAbsolute: (x) => /^[A-Za-z]:|\//.test(String(x)), normalize: (x) => x },
      fs: { mkdir: async () => {}, resolve: async (k) => String(k) },
      resolveExecutable: async (n) => n,
      env: { get: () => undefined },
    }
    const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }), readText: async () => '', writeText: async () => {}, resolve: async (k) => String(k), lstat: async () => null, stat: async () => null, listDir: async () => [] }
    let registered = null
    const services = {
      subprocess, timer: timerSvc, fs: fsSvc, platform: platformSvc,
      sessions: { get: () => ({ header: {} }) },
      connection: { rpc: { handle: (p2, fn) => { registered = fn } } },
    }
    const ctxObj = { get: (k) => services[k], set: () => {}, effect: (fn) => { const r2 = fn(); return typeof r2 === 'function' ? r2 : () => {} } }
    const modRaw = await import('../package/lib/index.js')
    ;(modRaw.default.apply ?? modRaw.apply)(ctxObj)

    const callHandler = async function (endpoint, args) {
      const env = await registered(endpoint, args)
      return (env && typeof env.value === 'object' && env.value !== null && ('ok' in env.value)) ? env.value : env
    }
    try {
      const p0 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(!!p0 && p0.ok === true && Array.isArray(p0.dirtyCwds) && p0.dirtyCwds.length === 0, '首轮：新建档不判脏（存量不当变更），dirtyCwds 空')
      check(Array.isArray(p0.events) && p0.events.length === 0, '面包屑事件通道不受影响（零污染实证）')

      ghApiText += '\n' + jline(42, 'open', '2026-08-27T12:00:00Z')
      const p1 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(!!p1 && p1.ok === true && Array.isArray(p1.dirtyCwds) && p1.dirtyCwds.length === 0, 'gap 闸内第二轮静默（配额账成立）')

      await new Promise(function (res) { setTimeout(res, SYNC.EVAL_GAP_MS + 600) })
      const p2 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(!!p2 && p2.ok === true && Array.isArray(p2.dirtyCwds) && p2.dirtyCwds.indexOf(TCWD) >= 0, 'gap 过后：真实索引差值命中 → dirtyCwds 回执本工作区 cwd')

      const p3 = await callHandler('issuePathPoll', { cwds: [], visible: true })
      check(!!p3 && p3.ok === true && Array.isArray(p3.events), '不带 cwds 的旧客户端形状不变（向后兼容）')

      const p4 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: false })
      check(!!p4 && p4.ok === true, 'visible=false 仅跳过评估，响应结构完好')

      // #232 · 视线门控下的消费语义与重复发现回归：
      //   宿主在同一调用内原子完成「求值→标脏→回执→覆盖者消费」；跨轮持久的未取走条目
      //   只来自竞速超时余波（>3.5s 求值）与多客户端窗口场景，TTL 对这类孤儿自愈。
      const p7a = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(p7a.ok === true && Array.isArray(p7a.dirtyCwds) && p7a.dirtyCwds.indexOf(TCWD) < 0, '发现轮已同轮送达并摘除（确认式消费：发现即交付，切走前在途结果由客户端 R4 缓存落地兜住）')
      const p7b = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(Array.isArray(p7b.dirtyCwds) && p7b.dirtyCwds.indexOf(TCWD) < 0, '摘除后不再回执（防重复触发探针风暴）')
      // 长会话第二次真实变更走同一闭环（多轮修改均可达）
      ghApiText += '\n' + jline(43, 'open', '2026-08-27T13:00:00Z')
      const p8 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(!!p8 && p8.ok === true, '二次变更 gap 内静默复测（配额账持续成立）')
      await new Promise(function (res) { setTimeout(res, SYNC.EVAL_GAP_MS + 600) })
      const p9 = await callHandler('issuePathPoll', { cwds: [TCWD], visible: true })
      check(p9.ok === true && Array.isArray(p9.dirtyCwds) && p9.dirtyCwds.indexOf(TCWD) >= 0, '二次差值命中 → 再次回执（长会话多轮变更链路稳定）')
    } catch (eRun) {
      check(false, '分发端到端异常: ' + String((eRun && eRun.message) || eRun))
    }
  }

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('FAIL: 未捕获异常 ' + String(e && e.stack || e)); process.exit(1) })