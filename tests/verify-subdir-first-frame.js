#!/usr/bin/env node
/**
 * verify-subdir-first-frame.js — 子目录会话第一帧门禁（#727 验收）
 *
 * 治的是什么（真机现场 2026-09-24，skill-calorie 会话目录 D:\ilife\packages\skill-calorie，工作区根 D:\ilife）：
 *   刚进会话时横幅写「该工作区还没有设置 — 点击选择后端」，而旁边「环境 10/10」是绿的、更新时间也是真实时刻；
 *   打开一次右侧面板、或切到别的会话再切回来，就正常了。两条原因：
 *   ①「用哪个后端」这条几十字节的事实，原先只能搭最重的那趟车（wf.snapshot / wf.refresh 那份完整快照）
 *     才回得来，而客户端对它有一条固定的 30 秒死线（client loadSnapshot timeout 30s）。冷启动的大工作区
 *     （这个现场 52 张地图 / 950 张票 / 741 子票 / 磁盘快照 9.7 MB）首次重建要几分钟，死线一到客户端就
 *     放弃、什么都不装；同期的「环境」（走 wf.chain）与「时间」（走 wf.probe）都没有这条死线。
 *   ② 那份回包后来还是到了（真机 12:16:21 落盘，客户端最后一次放弃是 12:16:19），可它一到就被原先那道
 *      守卫整份丢掉：守卫拿「回包自己带回来的工作区根」去比「请求发出时那条子目录键」，而正是这次自己
 *      先教会了客户端那个根 —— 比出来必然不等。超时之后又没有任何重试，那份结果于是永久作废。
 *
 * 本门禁喂的是**真** loadSnapshot：那几片内核按 scripts/build.mjs 拼进同一个闭包的顺序（shared/workspaceKey.js
 *   → kernel/store-prefs.js → kernel/store-snapshot.js → kernel/probe-stale.js → kernel/probe-snapshot.js
 *   → kernel/probe-select.js）去掉行首 export 后求值，拼法照 .tmp/repro-665-subdir-first-frame.js。
 *   假宿主按真机的样子回话：wf.cwd 失败（真机 errorHash 记的就是「会话无 cwd 信息」）、那份完整快照 1.4 秒后
 *   才到（客户端那条死线在本门禁里缩成 0.9 秒 —— 门禁量的是「超时之后那份回包还能不能落地」，不是「等多久
 *   算超时」；快慢只影响等待时长）、而那条专用电话 wf.selection 二十毫秒就有答案。
 *
 * 断言按三条不变量分三组，另加一组反证：
 *   I1 便宜且专用 —— 那条专用电话回来后 selection 必须装上，且横幅不再说「还没有设置」（判据层断言）；
 *   I2 未知 ≠ 否   —— 选择为空、取数在途时，横幅不得取 banner.gate 那一档（不得说「还没有设置」）；
 *   I3 迟到能落地 —— 超时之后迟到的成功回包到达时，selection（至少）必须装上；
 *   反向 —— 拆掉三条修法里的任意一条，上面某一式必须当场变红；会话真换走了（A → B）仍须判过期。
 *
 * 用法: node tests/verify-subdir-first-frame.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let total = 0
const ok = (cond, msg) => { total += 1; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const noExport = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')

// 真机现场的两个目录（会话目录是工作区里的子目录；客户端算不出根，只能等宿主回话才知道）
const SUB_DIR = 'D:\\ilife\\packages\\skill-calorie'
const ROOT_DIR = 'D:/ilife'
const OTHER_DIR = 'D:\\other-repo'
const GATE_TIMEOUT_MS = 900   // 客户端那条 30 秒死线在本门禁里的替身（源里那个常量由下面 moduleText 的断言钉着）
const SNAP_LATE_MS = 1400     // 那份完整快照到得比死线晚 —— 正是真机那个「客户端放弃了、宿主才拿出来」的次序
const SEL_MS = 20             // 那条专用电话很快（几十字节的事实，宿主侧本来也是现成的）
const CWD_FAIL_MS = 5         // wf.cwd 真机上一直失败，只是失败得很快

const FILES = [
  'src/shared/workspaceKey.js',
  'src/client/kernel/store-prefs.js',
  'src/client/kernel/store-snapshot.js',
  'src/client/kernel/probe-stale.js',
  'src/client/kernel/probe-snapshot.js',
  'src/client/kernel/probe-select.js',
]

// 把这几片按构建顺序拼成同一个闭包（与 scripts/build.mjs 的拼接口径一致：去掉行首 export 后求值）。
function moduleText(patch) {
  const body = FILES.map((f) => noExport((patch && patch.file === f) ? patch.text : read(f))).join('\n')
  // 那条 30 秒死线只在本门禁里缩短；源里的常量必须还在（不在就说明有人把这条死线改了，门禁当场红）。
  if (body.indexOf('},30000)') < 0) throw new Error('源里找不到那条 30 秒死线（client loadSnapshot timeout）—— 本门禁的替换不成立')
  return body.replace('},30000)', '},' + GATE_TIMEOUT_MS + ')')
}

// 按真机样子回话的假宿主 + 真内核。
function makeEnv(opts) {
  const o = opts || {}
  const seen = { calls: [], logs: [] }
  const storage = Object.assign({}, o.seedLocal || {})
  const sandbox = {
    window: { innerHeight: 900 },                       // 没有 indexDB → 磁盘那一级天然关掉
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v) },
      removeItem: (k) => { delete storage[k] },
    },
    navigator: { platform: 'Win32' },
    ctx: { get: () => undefined },                      // 宿主 sessions 服务拿不到 → getCwdSync 空
    host: {
      call: function (method, args) {
        seen.calls.push({ method: method, args: args })
        if (method === 'wf.cwd') return new Promise((r) => setTimeout(() => r({ ok: false, error: '会话无 cwd 信息' }), CWD_FAIL_MS))
        if (method === 'wf.selection') return new Promise((r) => setTimeout(() => r(o.selectionReply || { ok: true, selection: { backendId: 'markdown', source: 'explicit', ref: null, rev: 3 } }), SEL_MS))
        if (method === 'wf.registry') return new Promise((r) => setTimeout(() => r({ ok: false }), SEL_MS))
        // wf.snapshot / wf.refresh：那份完整快照很晚才到（比客户端那条死线晚）
        return new Promise((r) => setTimeout(() => r(o.snapshotReply || snapshotReply()), SNAP_LATE_MS))
      },
    },
    log: (level, event, fields) => seen.logs.push({ level: level, event: event, fields: fields }),
    isEnabled: () => true,
    tr: (k) => String(k),
    timer: { timeout: (f, ms) => setTimeout(f, ms) },
    SYNC: {},
    // 同一个闭包里别处的自由变量，本门禁不关心它们的内部实现
    setPresentationMap: () => {},
    promptLang: () => 'zh',
    diffSnapshots: () => ({ added: [], changed: [], removed: [], issueFlash: {} }),
    scheduleFlashClear: () => {},
    lcApplySavedColorsOnInstall: () => {},
    startAutoProbe: () => {},
    reportWorkspaceAttention: () => Promise.resolve(null),
    React: { useState: () => [0, () => {}], useEffect: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }
  const names = Object.keys(sandbox)
  const tail = '\n;return { makeStore, loadSnapshot, hydrateFromCache, getCachedSnapshot, getCachedSelection,'
    + ' workspaceRootByCwd, rememberWorkspaceRoot, keyOf, wsKeyOf, emit, mergeSelection, askSelectionOnce,'
    + ' _snapRequestKeyWas, _snapInstallState }'
  const factory = new Function(...names, moduleText(o.patch) + tail)
  const mod = factory.apply(null, names.map((n) => sandbox[n]))
  return { mod, seen, storage }
}

// 宿主对 wf.snapshot 的答复：带着权威 selection、也带着「这个会话的工作区根」。
// 这份回包在门禁里故意晚到（真机上它 12:16:21 才落盘，客户端 12:16:19 就已经放弃了）。
function snapshotReply() {
  return {
    ok: true,
    maps: [],
    issues: [{ number: 1, state: 'OPEN', labels: [] }],
    repository: { backend: 'markdown', refId: SUB_DIR, name: 'ilife' },
    selection: { backendId: 'markdown', source: 'explicit', ref: null, rev: 3 },
    workspaceRoot: ROOT_DIR,
    deck: { counts: { open: 1, closed: 0, total: 1 } },
    generatedMs: Date.now(),
    version: 'v1',
  }
}

// 本地那张表按工作区根存着（真机现场就是这样 —— 根没认出来之前，这份本地镜像读不到）。
function rootKeyedSeed() {
  const src = noExport(read('src/shared/workspaceKey.js'))
  const keyOf = new Function(src + '\nreturn keyOf')()
  const k = keyOf(ROOT_DIR, 'win32')
  return { 'dsws.selectionByCwd': JSON.stringify({ [k]: { backendId: 'markdown', source: 'explicit', ref: null, userPicked: true, pickedAt: 1, rev: 3 } }) }
}

// 一次「进工作区」：cwd 是那条子目录，本地只按工作区根存了一条选择。
// 顺手把「这一次请求的落地状态」清零：那一格是每个闭包一份的（同一个工作区上两次就绪会碰上的那条界线），
// 而本门禁在同一个进程里开了好几个闭包，不在这里清零就会互相串（生产里每个页面只有一份，不存在这件事）。
function freshStore(env) {
  try { if (env.mod._snapInstallState) env.mod._snapInstallState.handedOff = false } catch (eReset) {}
  const st = env.mod.makeStore()
  st.sessionId = 's1'
  st.cwd = SUB_DIR
  st.subs = []
  return st
}

// ── 真状态栏的判据（把 statusbar/bannerChain.js 与真的顺序清单取出来跑）──────────
// 为什么非得走真函数：横幅出哪一条、那一档说什么，就是「界面第一次画出来是什么样」这件事本身；
// 只断言 st.selection 装没装上，等于把「字段装上了、可用户看到的还是那句话」这种结果放过去。
const bannerApi = (function () {
  const guide = require(path.join(root, 'src/shared/tracker/guide-steps.js'))
  const src = noExport(read('src/client/statusbar/bannerChain.js'))
  return {
    step: new Function('guideStepsFor', 'guideStepDone', 'chainSteps', 'chainStep', 'checkShowTitle',
      src + '\nreturn { guideBannerStep: guideBannerStep }')(guide.guideStepsFor, guide.guideStepDone,
      (s) => (s && s.chainSnapshot && s.chainSnapshot.steps) || [], () => null,
      (show, fb) => String((show && show.title) || fb || '')).guideBannerStep,
  }
})()
// 横幅第一帧是什么样（与 StatusBar.js 里那几条判据同一个口径；那处的真身由下面「反向 4」的真源断言钉着）。
function bannerVariant(st) {
  const decision = bannerApi.step(st, true) // 后端还没定 → 门控那一步是开着的
  const undecided = !(st.selection && st.selection.backendId)
  const reading = !!(st.cwd && undecided && (st.snapLoading === true || st.selPending === true))
  const tone = decision && decision.banner ? decision.banner.tone : ''
  const textKey = (decision && tone === 'info') ? (reading ? 'banner.gateReading' : decision.banner.text) : ''
  return { undecided: undecided, reading: reading, textKey: textKey, saysNotSet: textKey === 'banner.gate' }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 真源里的几条接线（反证要能按字面把它们拆掉 / 改回原样；名字一改就红在这）。
// 注意这几条正则都带 \r?\n：这几个内核文件在仓库里是 CRLF 换行的（门禁按原文读，不整篇改写行尾）。
const NEW_GUARD_RE = /if \(_curNorm !== _reqNorm \&\& !_snapRequestKeyWas\(_reqNorm, st\)\) \{/
const ASK_LINE_RE = /^[ \t]*try \{ if \(typeof askSelectionOnce === 'function'\) askSelectionOnce\(st\) \} catch \(eSelAsk\) \{\}\r?\n/m
const LATE_LINE_RE = /^[ \t]*_rawP\.then\(function \(lateSnap\) \{ try \{ _installLateSnapshotSelection\(st, lateSnap, _reqNorm, _mine\) \} catch \(eLate\) \{\} \}, function \(\) \{\}\);\r?\n/m
function cut(src, re, label) {
  const out = src.replace(re, '')
  ok(out !== src, '（前提）能在真源里拆掉 ' + label)
  return out
}

async function main() {
  // 内核里 p.finally(...) 那几处派生链在超时那一刻会先被标记成「没有人接的拒绝」，同一个 tick 里随后被下一位
  //   接住 —— 这是改动前就有的形状（本门禁只是第一次把它逼到超时那条路上）。这里收下这件事，只断言「原因就是
  //   那条超时」，免得它变成满屏噪声盖住真正的失败。
  const strayRejections = []
  process.on('unhandledRejection', (e) => { strayRejections.push(String((e && e.message) || e)) })

  console.log('=== #727 子目录会话第一帧门禁（I1 便宜且专用 / I2 未知≠否 / I3 迟到能落地）===')

  const probeSnapshotSrc = read('src/client/kernel/probe-snapshot.js')
  ok(NEW_GUARD_RE.test(probeSnapshotSrc), '（前提）真源里那条守卫就是换过尺子的样子（按请求时那条目录比）')
  const noAskSrc = ASK_LINE_RE.test(probeSnapshotSrc)
    ? cut(probeSnapshotSrc, ASK_LINE_RE, '「进工作区补问一次」那一步（第 1 条修法）') : probeSnapshotSrc
  const noLateSrc = LATE_LINE_RE.test(noAskSrc)
    ? cut(noAskSrc, LATE_LINE_RE, '「迟到回包的落地」那一行（第 2 条修法）') : noAskSrc
  const oldGuardSrc = noAskSrc.replace(NEW_GUARD_RE, 'if (_curNorm !== _reqNorm) {')
  ok(oldGuardSrc !== noAskSrc, '（前提）能把那条守卫改回改动前的写法（第 3 条修法的反证）')
  const withSnapPatch = (text) => ({ file: 'src/client/kernel/probe-snapshot.js', text: text })

  // ── 主现场：一次完整的「进工作区」 ──────────────────────────────────────────
  const f = { env: makeEnv({ seedLocal: rootKeyedSeed() }) }
  f.st = freshStore(f.env)
  ok(f.st.selection === null, '进会话时 selection 是空的（本地那份按工作区根存着，根没认出来之前读不到）')
  const loadP = f.env.mod.loadSnapshot(f.st, false, true)
  await wait(60) // 取数在途、那条专用电话还没回话：这一刻就是「后端还说不准」那一帧

  console.log('\nI1) 便宜且专用：一条事实由一条代价相称的专用通道投递')
  await wait(200) // 那条专用电话（20 毫秒）早就回来了 —— 这条路上它从来不等那份重快照
  ok(!!(f.st.selection && f.st.selection.backendId === 'markdown'),
    '那条专用电话回来之后 selection 装上了（实得 ' + (f.st.selection ? String(f.st.selection.backendId) : '空') + '）')
  ok(f.env.seen.calls.some((c) => c.method === 'wf.selection'), '这一帧确实问了那条专用电话 wf.selection')
  ok(f.env.seen.calls.every((c) => c.method !== 'wf.selection' || c.args.cwd === SUB_DIR),
    '问它时带的是这个会话的目录（不拿宿主的默认目录去问另一个工作区）')
  const asked = f.env.seen.calls.filter((c) => c.method === 'wf.selection').length
  ok(asked === 1, '每个工作区只问一次（限次；实得 ' + asked + ' 次）')

  console.log('\nI2) 未知 ≠ 否：选择为空且取数在途时，横幅不得说「还没有设置」')
  // 真机上「刚进会话」那几十秒就是这一帧：取数在飞、后端那条答案还没到、selection 是空的。
  const midVariant = bannerVariant({ cwd: SUB_DIR, selection: null, snapLoading: true, selPending: false })
  ok(midVariant.reading === true, '取数在途时这一格判成「正在读取」（实得 reading=' + midVariant.reading + '）')
  ok(midVariant.saysNotSet === false, '这一帧的横幅不是说「还没有设置」（判据层：实得正文键 ' + JSON.stringify(midVariant.textKey) + '）')
  ok(midVariant.textKey === 'banner.gateReading', '这一帧取的是「正在读取」那一档词条（实得 ' + JSON.stringify(midVariant.textKey) + '）')
  // 那条专用电话在途时同样算「还没读到」（第二帧：取数那条路已经放了手，可专用电话还在飞）
  const midVariant2 = bannerVariant({ cwd: SUB_DIR, selection: null, snapLoading: false, selPending: true })
  ok(midVariant2.textKey === 'banner.gateReading', '专用电话在途时也算「正在读取」（实得 ' + JSON.stringify(midVariant2.textKey) + '）')
  // 后端那条答案到了之后：同一处判据让位（不许一直停在「正在读取」）。那之后这一格由别的判据接着管
  //   （后端认出来了 → 门控那一步自己就关了），所以这里量的是「这一支不再说话」。
  const settled = bannerVariant({ cwd: SUB_DIR, selection: f.st.selection, snapLoading: false, selPending: false })
  ok(settled.reading === false, '后端那条答案到了之后：这一格不再说「正在读取」（实得 reading=' + settled.reading + '）')
  ok(settled.textKey !== 'banner.gateReading', '那一档词条已经让位（实得 ' + JSON.stringify(settled.textKey) + '）')
  // 确实没设置（答案到了、就是没有）：这一档照旧说「还没有设置」—— 表达面只加「还没读到」，没有把这一档吞掉。
  const none = bannerVariant({ cwd: SUB_DIR, selection: { backendId: null, source: 'explicit' }, snapLoading: false, selPending: false })
  ok(none.reading === false && none.saysNotSet === true, '确实没有设置时照旧说「还没有设置」（这一档没有被吞掉）')

  console.log('\nI3) 迟到的正确结果必须能落地：超时之后那份成功回包到达时，selection 至少装上')
  await loadP // 客户端这边 0.9 秒就超时放手了
  ok(f.st.snapLoading === false, '客户端已经放手（等待结束、加载态收回）')
  ok(f.st.selection && f.st.selection.backendId === 'markdown', '放手的那一刻手上那条答案还在（那条专用电话给的）')
  await wait(SNAP_LATE_MS + 300) // 宿主那份完整快照这时才到
  ok(!!(f.st.selection && f.st.selection.backendId === 'markdown'),
    '迟到的回包到达后 selection 仍然是生效的那一条（实得 ' + (f.st.selection ? String(f.st.selection.backendId) : '空') + '）')
  ok(f.st.selPending === false, '迟到落地之后那个「在途」的理由收回了')
  ok(f.env.seen.logs.some((l) => l.event === 'host.call.fail'), '客户端放弃那一次如实记了一行失败日志（host.call.fail）')

  // ── I3 单独成立：把补问那一步拆掉，只剩「迟到回包」这一条路 ─────────────────
  console.log('\nI3-b) 单独走「迟到回包」这一条路：没有那条专用电话时，迟到的回包自己也要落地')
  {
    const env2 = makeEnv({ seedLocal: rootKeyedSeed(), patch: withSnapPatch(noAskSrc) })
    const st2 = freshStore(env2)
    const p2 = env2.mod.loadSnapshot(st2, false, true)
    await p2
    ok(st2.selection === null, '专用电话不问了：放手那一刻 selection 还是空的（这一格正是真机第一帧的样子）')
    await wait(SNAP_LATE_MS + 300)
    ok(!!(st2.selection && st2.selection.backendId === 'markdown'),
      '迟到的回包到达后 selection 装上了（实得 ' + (st2.selection ? String(st2.selection.backendId) : '空') + '）')
  }

  // ── 反向 1：拆掉第 1 条修法（补问一次）→ I1 必须红 ─────────────────────────
  // I1 的红分两帧量：① 取数还在途时横幅停在「正在读取」（那一支没问题，问题在真正的那条事实没人去问）；
  //   ② 客户端 0.9 秒放手之后，横幅就落回「还没有设置」那一句了 —— 真机 12:16:19 那一屏就是它。
  console.log('\n反向 1) 拆掉「进工作区补问一次」（第 1 条修法）→ I1 必须红')
  {
    const envR = makeEnv({ seedLocal: rootKeyedSeed(), patch: withSnapPatch(noAskSrc) })
    const stR = freshStore(envR)
    const pR = envR.mod.loadSnapshot(stR, false, true)
    await wait(400)
    ok(!(stR.selection && stR.selection.backendId), '🔴 反证成立：没有那条专用电话时，这一帧 selection 装不上（实得 ' + (stR.selection ? String(stR.selection.backendId) : '空') + '）')
    ok(bannerVariant(stR).textKey === 'banner.gateReading', '（在途那一帧）横幅还在「正在读取」上（实得 ' + JSON.stringify(bannerVariant(stR).textKey) + '）')
    await pR                              // 客户端 0.9 秒那条死线到了：放手
    const v = bannerVariant(stR)
    ok(v.reading === false && v.saysNotSet === true,
      '🔴 反证成立：放手之后这一帧的横幅就落回「还没有设置」（实得 reading=' + v.reading + '，正文键 ' + JSON.stringify(v.textKey) + '）')
    await wait(SNAP_LATE_MS + 300)
    ok(!!(stR.selection && stR.selection.backendId), '（对照）等到那份完整快照到了才补上 —— 那正是真机上「过一会儿自己好了」的那条路')
  }

  // ── 反向 2：拆掉第 2 条修法（迟到的落地）→ I3 必须红 ───────────────────────
  console.log('\n反向 2) 拆掉「迟到回包的落地」（第 2 条修法）→ I3 必须红')
  {
    const envR = makeEnv({ seedLocal: rootKeyedSeed(), patch: withSnapPatch(noLateSrc) })
    const stR = freshStore(envR)
    const pR = envR.mod.loadSnapshot(stR, false, true)
    await pR
    await wait(SNAP_LATE_MS + 300)
    ok(!(stR.selection && stR.selection.backendId),
      '🔴 反证成立：那一行拆掉之后，迟到的正确结果装不上（实得 ' + (stR.selection ? String(stR.selection.backendId) : '空') + '）')
    ok(stR.snapshot === null, '🔴 反证成立：会话状态里也没有那份快照（超时之后客户端就什么都没收下）')
  }

  // ── 反向 3：把第 3 条的守卫改回原样 → 子目录那一式必须红 ────────────────────
  // 原样 = 拿「回包自己带回来的根」（学到根之后它已经变粗）去比「请求时那条子目录键」。那一式量的是
  //   「第一份回包有没有落地」：改动前它会带着 #232 R4 那条缓存写进「请求时那把键」就整份 return，
  //   于是会话状态里一个字节都没有（真机上就是面板空着、横幅说没设置，直到有人打开面板/切回来再水合一次）。
  console.log('\n反向 3) 把「按请求时那条目录比」的守卫改回原样 → 子目录那一式必须红')
  {
    // 一次性把两件事量清楚（不依赖两份闭包各自跑一遍的时序）：请求时那条键 = 子目录键；
    // 学到根之后，现在这条键是根 —— 改动前那句（`_reqNorm !== _curNorm`）拿子目录键去比根，必然判过期。
    const mod = makeEnv({ seedLocal: rootKeyedSeed() }).mod
    const reqKey = mod.keyOf(SUB_DIR)
    ok(reqKey === mod.wsKeyOf(SUB_DIR), '（前提）请求发出时，这条目录还没有根可折算 —— 请求键就是它自己')
    const srcA = noExport(probeSnapshotSrc).replace(/\r?\n/g, '\n')
    const srcB = noExport(oldGuardSrc).replace(/\r?\n/g, '\n')
    ok(srcA.indexOf('if (_curNorm !== _reqNorm && !_snapRequestKeyWas(_reqNorm, st)) {') >= 0
      && srcB.indexOf('if (_curNorm !== _reqNorm) {') >= 0
      && srcB.indexOf('_snapRequestKeyWas(_reqNorm, st)') < 0,
      '（前提）改动后那句与改动前那句各自都在真源文本里（这就是本式的两版：换过尺子 / 原样）')
    mod.rememberWorkspaceRoot(SUB_DIR, ROOT_DIR) // 这份回包顺路把根教给了客户端（改动前后都这样）
    const curKey = mod.wsKeyOf(SUB_DIR)
    ok(curKey !== reqKey, '学到根之后，同一把请求键折算出来的值变了（子目录键 → 根键）—— 改动前那句正是在这里误判')
    ok(mod._snapRequestKeyWas(reqKey, { cwd: SUB_DIR }) === true,
      '🔴 反证成立：改动后那句按请求时那条目录比，判「还是这条目录」—— 回包收下（改动前判成「工作区换过了」、整份丢掉，真机 12:16:19 那一屏就是它）')
    ok(curKey !== reqKey && reqKey !== mod.wsKeyOf(SUB_DIR), '（对照）改动前那句拿这两把键直接比，必然不等（子目录键 ' + JSON.stringify(reqKey) + ' vs 根键 ' + JSON.stringify(curKey) + '）')
  }

  // 会话真换走了（请求时目录 A、现在目录 B）：那条守卫的**原意**仍在 —— 这一式两种尺子下都必须判过期，
  //   否则修法 3 就把 #232 R4 / #45 的原意拆掉了（那才是真正要防的事）。
  console.log('\n反向 3-b) 保住原意：请求时目录 A、现在目录 B —— 新旧两种尺子都必须判过期')
  for (const pair of [['换过尺子（本次修法）', noAskSrc], ['原样（改动前）', oldGuardSrc]]) {
    const envX = makeEnv({ seedLocal: rootKeyedSeed(), patch: withSnapPatch(pair[1]) })
    const stX = freshStore(envX)
    const pX = envX.mod.loadSnapshot(stX, false, true)
    await wait(120)
    stX.cwd = OTHER_DIR // 用户切到另一个工作区去了（A → B）
    await pX
    await wait(SNAP_LATE_MS + 300)
    ok(stX.snapshot === null && !(stX.selection && stX.selection.backendId),
      pair[0] + '：切走之后那份回包没有落进新视图（#45 串台防线仍在；实得快照 ' + (stX.snapshot ? '有' : '空') + '）')
  }
  // 判据本身单独量一次（两种尺子在这一式上的差别就写在这里）：请求时那条键还是现在这条时不许误判过期。
  {
    const mod = makeEnv({ seedLocal: rootKeyedSeed() }).mod
    mod.rememberWorkspaceRoot(SUB_DIR, ROOT_DIR)
    ok(mod._snapRequestKeyWas(mod.wsKeyOf(SUB_DIR), { cwd: SUB_DIR }) === true, '请求时那条目录就是现在这条：不收过期（不许误伤）')
    ok(mod._snapRequestKeyWas(mod.wsKeyOf(SUB_DIR), { cwd: OTHER_DIR }) === false, '请求时目录 A、现在目录 B：判过期')
  }

  // ── 反向 4：把第 4 条（表达面）改回原样 → I2 必须红 ────────────────────────
  console.log('\n反向 4) 把状态栏那处表达面改回原样 → I2 必须红')
  const sbSrc = read('src/client/statusbar/StatusBar.js')
  ok(sbSrc.indexOf('const _selReading = !!(s.cwd && _backendUndecided && (s.snapLoading === true || s.selPending === true))') >= 0,
    '（前提）状态栏里那条判据就是「在途时算正在读取」')
  // 改回原样 = 这一支不存在（改动前根本没有这条判据），于是同一帧必然取回 banner.gate 那一档。
  const decisionOld = bannerApi.step({ cwd: SUB_DIR, selection: null, snapLoading: true }, true)
  ok(decisionOld && decisionOld.banner && decisionOld.banner.text === 'banner.gate',
    '🔴 反证成立：没有那条判据时这一帧取的就是 banner.gate 那一档（实得 ' + JSON.stringify(decisionOld && decisionOld.banner && decisionOld.banner.text) + '）')

  // ── 纪律：失败不许弹提示、不许无限重试 ─────────────────────────────────────
  console.log('\n纪律）专用电话失败时：只记一行日志，不弹提示、不重试')
  {
    const envF = makeEnv({ seedLocal: rootKeyedSeed(), selectionReply: { ok: false, error: 'registry unavailable' } })
    const stF = freshStore(envF)
    const pF = envF.mod.loadSnapshot(stF, false, true)
    await wait(300)
    ok(stF.notice == null, '没有弹出任何提示（不打扰用户）')
    ok(envF.seen.calls.filter((c) => c.method === 'wf.selection').length === 1, '失败也不重问（每个工作区一次就是一次）')
    ok(stF.selPending === false, '失败之后「在途」这个理由收回（界面上不会永远停在「正在读取」）')
    await pF
    await wait(SNAP_LATE_MS + 300)
  }

  // ── 这次超时路上那几条「先无人接、随后被接住」的派生链：只许是那条超时 ────────
  const stray = strayRejections.filter((m) => m.indexOf('client loadSnapshot timeout') < 0)
  ok(stray.length === 0, '超时路上那几条派生链的临时拒绝只有「那条死线」一种原因' + (stray.length ? ' —— 另见：' + stray.join('、') : ''))

  // ── 接线：双产物里真的带着这一批（改完没重新构建就会红在这）────────────────
  console.log('\n接线）双产物里带着这几处')
  for (const product of ['client.js', path.join('package', 'lib', 'client.js')]) {
    const buf = read(product)
    ok(buf.indexOf('askSelectionOnce') >= 0, product + ' 里带着那条专用电话的补问')
    ok(buf.indexOf('_installLateSnapshotSelection') >= 0, product + ' 里带着迟到回包的落地')
    ok(buf.indexOf('_snapRequestKeyWas') >= 0, product + ' 里带着换过尺子的那条守卫')
    ok(buf.indexOf("'banner.gateReading'") >= 0, product + ' 里带着「正在读取」那一档词条')
  }

  console.log(failed ? '\n存在失败 — verify-subdir-first-frame 未通过' : '\n全部通过 — ' + total + ' 项断言（子目录会话第一帧的三条不变量）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(2) })
