// tests/verify-naming-guardian.js — #265 命名守护核心纯函数校验 + 单一真源守卫
// 规约：#264（分档状态机 / 草稿标题合成 / 值比对锁 / 跟踪态 / 计划单）
// 用法：node tests/verify-naming-guardian.js

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}
const eq = (a, b, msg) => check(a === b, msg, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a))

console.log('== 命名守护核心 naming-guardian.js（#265）==')

let m
try {
  m = await import('../src/shared/naming-guardian.js')
} catch (e) {
  console.log('  FAIL import src/shared/naming-guardian.js — ' + String((e && e.message) || e))
  process.exit(1)
}

// ---------- 1) 占位四式 ----------
console.log('\n— 占位识别（P0）—')
check(m.isPlaceholderTitle('[New] 新建需求'), '占位 zh 需求')
check(m.isPlaceholderTitle('  [New] 新建 Bug '), '占位 zh bug（容忍首尾空白）')
check(m.isPlaceholderTitle('[New] New Requirement'), '占位 en requirement')
check(m.isPlaceholderTitle('[New] New Bug'), '占位 en bug')
check(!m.isPlaceholderTitle('[New] 新建需求x'), '非占位：尾缀突变')
check(!m.isPlaceholderTitle('[草稿] 新建需求'), '非占位：草稿档不算占位')
check(!m.isPlaceholderTitle(''), '非占位：空串')
eq(m.placeholderTitleFor({ type: 'requirement', lang: 'zh' }), '[New] 新建需求', '生成占位 zh requirement')
eq(m.placeholderTitleFor({ type: 'bug', lang: 'en' }), '[New] New Bug', '生成占位 en bug')
eq(m.newSessionTitleNew('bug'), '[New] 新建 Bug', '兼容签名 (type) 默认 zh（Node 无 promptLang）')
eq(m.newSessionTitleNew('requirement', 'en'), '[New] New Requirement', '兼容签名 (type, lang=en)')

// ---------- 2) 草稿合成：双语 / 线索有无 / 清洗 ----------
console.log('\n— 草稿标题合成（P1）—')
eq(m.composeDraftTitle({ hint: '', lang: 'zh' }), '[草稿]', '无线索裸档 zh')
eq(m.composeDraftTitle({ hint: null, lang: 'en' }), '[Draft]', '无线索裸档 en')
eq(m.composeDraftTitle({ hint: '修复登录闪退', lang: 'zh' }), '[草稿] 修复登录闪退', '有线索 zh')
eq(m.composeDraftTitle({ hint: 'Fix login flicker', lang: 'en' }), '[Draft] Fix login flicker', '有线索 en')
eq(m.composeDraftTitle({ hint: 'a\n\tb  \n c', lang: 'zh' }), '[草稿] a b c', '清洗归一（换行/Tab/多空格）')
eq(m.composeDraftTitle({ hint: 'emoji 🚀\x00控制\u200B隐形\x1B[31m红字', lang: 'zh' }), '[草稿] emoji 🚀 控制 隐形红字', '清洗剥控制/隐形/ANSI 且 emoji 保留（#205 规则：ESC 序列整体剥除不留空）')

// ---------- 3) 字节边界（120 bytes 总预算，前缀永不截断）----------
console.log('\n— 字节边界 —')
{
  const out = m.composeDraftTitle({ hint: 'A'.repeat(500), lang: 'zh' })
  check(m.utf8Bytes(out) <= m.SESSION_TITLE_MAX_BYTES, '超长 ASCII ≤120 bytes（got ' + m.utf8Bytes(out) + '）')
  check(out.endsWith('…'), '超长以 … 结尾')
  check(out.startsWith('[草稿] ') && !out.slice(0, 6).includes('…'), '前缀永不截断')
}
{
  const out = m.composeDraftTitle({ hint: '中'.repeat(200), lang: 'zh' })
  check(m.utf8Bytes(out) <= m.SESSION_TITLE_MAX_BYTES, '多字节 UTF-8 ≤120 bytes（got ' + m.utf8Bytes(out) + '）')
  check(!out.includes('\uFFFD'), '不拆 code point（无 replacement char）')
  check(m.DRAFT_TITLE_RE.test(out), '产出匹配草稿标题形状正则')
}
{
  // 边界命中：预算恰好容纳到 hint 尾字节时不应截
  const prefix = '[草稿] '
  const budget = m.SESSION_TITLE_MAX_BYTES - m.utf8Bytes(prefix)
  const exact = 'A'.repeat(budget)
  eq(m.composeDraftTitle({ hint: exact, lang: 'zh' }), prefix + exact, '恰好满预算不截断不加省略号')
}

// ---------- 4) 编号档合成回归（#205 契约实现迁移后的行为不变）----------
console.log('\n— 编号档合成（P2 · 共享迁移回归）—')
{
  const out = m.newSessionTitle({ number: 123, title: '修复登录闪退' })
  eq(out, '[#123] 修复登录闪退', '#n 标题合成')
  check(m.SESSION_TITLE_RE.test(out), '#n 正则匹配')
  let threw = false
  try { m.newSessionTitle({ number: 'abc', title: 'x' }) } catch (e) { threw = true }
  check(threw, '非法 number 抛错')
  eq(m.utf8Bytes(m.newSessionTitle({ number: 99999, title: 'A'.repeat(500) })) <= m.SESSION_TITLE_MAX_BYTES, true, '#n 超长仍 ≤120 bytes 且前缀完整')
}

// ---------- 5) 值比对锁 ----------
console.log('\n— 值比对锁 —')
eq(m.evaluateRenameLock({ currentTitle: '[草稿] A', lastMachineTitle: '[草稿] A', baselineTitle: '[New] x' }), 'unlocked', '机器写入后未动 → unlocked')
eq(m.evaluateRenameLock({ currentTitle: '用户手改名', lastMachineTitle: '[草稿] A', baselineTitle: '[New] x' }), 'locked', '机器写入后被改 → locked')
eq(m.evaluateRenameLock({ currentTitle: '[New] x', lastMachineTitle: null, baselineTitle: '[New] x' }), 'unlocked', '机器从未写过仍占位 → unlocked')
eq(m.evaluateRenameLock({ currentTitle: '用户改的', lastMachineTitle: null, baselineTitle: '[New] x' }), 'locked', '首次执行前已被手改 → locked')
eq(m.evaluateRenameLock({ currentTitle: null, lastMachineTitle: null, baselineTitle: '[New] x' }), 'unknown', '当前标题不可读 → unknown')
eq(m.evaluateRenameLock({ currentTitle: '', lastMachineTitle: '', baselineTitle: '' }), 'unknown', '空串标题 → unknown')
eq(m.evaluateRenameLock({ currentTitle: 'x', lastMachineTitle: null, baselineTitle: null }), 'unlocked', '无基准防御态 → unlocked')

// ---------- 6) 跟踪态结构 + 分档状态机 + 计划单 ----------
console.log('\n— 跟踪态 / 状态机 / 计划单 —')
{
  const st0 = m.createTrackingState({ sessionId: 's1', baselineTitle: '[New] 新建需求', repoKey: null })
  eq(st0.stage, m.NAMING_STAGES.PLACEHOLDER, '初态 = 占位档')
  for (const k of ['sessionId', 'stage', 'lastMachineTitle', 'baselineTitle', 'locked', 'repoKey', 'createdAt', 'updatedAt']) {
    check(Object.prototype.hasOwnProperty.call(st0, k), '跟踪态含字段 ' + k)
  }
  const st1 = m.reduceTrackingState(st0, { type: 'signal', hint: '修复登录闪退' })
  eq(st1.hint, '修复登录闪退', '线索信号入账')
  check(st0.hint === null, 'reducer 返回新对象不改入参（纯函数）')
  const orderNow = m.planOrderFor(st1, Date.now(), 20000)
  check(!!orderNow && orderNow.kind === 'draft' && orderNow.sessionId === 's1' && orderNow.hint === '修复登录闪退', '有线索立即产单')
  check(!!orderNow && !!orderNow.lock && orderNow.lock.baselineTitle === '[New] 新建需求' && orderNow.lock.lastMachineTitle === null && orderNow.lock.locked === false, '订单附值比对锁信息（基准=注册占位）')
  check(typeof orderNow.hint === 'string' && !/\[草稿\]|[Dd]raft/.test(orderNow.hint), '计划单不含语言相关字面量（只有语义段）')

  const stNoHint = m.createTrackingState({ sessionId: 's2', baselineTitle: '[New] 新建需求', repoKey: null })
  eq(m.planOrderFor(stNoHint, Date.now(), 20000), null, '无线索未过宽限 → 不出单')
  const late = m.planOrderFor(stNoHint, Date.now() + 21000, 20000)
  check(!!late && late.kind === 'draft' && late.hint === null, '过线索宽限 → 裸档出单')
  const stLateHint = m.reduceTrackingState(stNoHint, { type: 'signal', hint: '晚到的线索' })
  const lateOrder2 = m.planOrderFor(stLateHint, Date.now() + 21000, 20000)
  check(!!lateOrder2 && lateOrder2.hint === '晚到的线索', '未执行前晚到线索被并入订单')

  const stRenamed = m.reduceTrackingState(st1, { type: 'renamed', title: '[草稿] 修复登录闪退' })
  eq(stRenamed.stage, m.NAMING_STAGES.DRAFT, 'renamed → 升入草稿档')
  eq(stRenamed.lastMachineTitle, '[草稿] 修复登录闪退', '记录机器最后写入值（值比对锚）')
  eq(m.planOrderFor(stRenamed, Date.now() + 99999, 20000), null, '草稿档后不再出 P1 单（每会话 P1 至多一次）')

  const stLocked = m.reduceTrackingState(st1, { type: 'locked' })
  check(stLocked.locked === true, '锁定信号生效')
  eq(m.planOrderFor(stLocked, Date.now(), 20000), null, '锁定会话永不出单（永不触碰）')

  const stNum = m.reduceTrackingState(stRenamed, { type: 'numbered', number: 265 })
  eq(stNum.stage, m.NAMING_STAGES.NUMBERED, '编号跃迁为预留位（#266 消费）')
  eq(stNum.number, 265, '编号信息随跃迁携带')
}

// ---------- 7) 单一真源守卫（防 e98f636 式静默删除 / 第二处实现回流）----------
console.log('\n— 单一真源守卫 —')
{
  const hostSrc = readFileSync(join(ROOT, 'src/host/index.js'), 'utf8')
  check(hostSrc.includes("import('../shared/naming-guardian.js')"), 'host 半运行时引用共享核心')
  for (const op of ['wf.namingRegister', 'wf.namingSignal', 'wf.namingPlan', 'wf.namingResult']) {
    check(hostSrc.includes("'" + op + "'"), 'host 注册操作 ' + op)
  }
  // #266：建号感知三操作复原 —— e98f636 曾整块静默删除（#258 F1），此断言令再删必红（AC3）
  for (const op of ['wf.registerNewSessionWatcher', 'wf.cancelNewSessionWatcher', 'wf.awaitCreatedIssue']) {
    check(hostSrc.includes("'" + op + "'"), 'host 注册操作（#211 复原 · 建号感知） ' + op)
  }
  check(hostSrc.includes('core.attributeNewNumbers') && hostSrc.includes('core.isNumberAwaitStage'), 'host 索引差值/候选取样走共享核心纯函数')
  check(hostSrc.includes('function namingSweepNow()') && hostSrc.includes('function namingSweepSoon('), 'host 索引差值结算 + 即时推进存在')
  check(!hostSrc.includes('newSessionWatchers'), '旧 #211 内存轮询结构（newSessionWatchers Map）已退役（职责并入持久化守护）')
  check(hostSrc.includes('.dsh-mattskillsdeck-cache') && hostSrc.includes("naming-guardian.json"), '跟踪态落盘既有缓存目录')
  check(hostSrc.includes('startNamingGuardianLoop()'), 'host 常驻轻量任务随 apply 启动')

  const buildSrc = readFileSync(join(ROOT, 'scripts/build.mjs'), 'utf8')
  check(buildSrc.includes("'src/shared/naming-guardian.js'"), '构建登记 shared splice（client 半同源注入）')
  const clientIdx = readFileSync(join(ROOT, 'src/client/index.js'), 'utf8')
  check(clientIdx.includes('// ==== shared:namingGuardian (spliced by build) ===='), 'client 闭包挂共享核心拼接标记')
  check(clientIdx.includes('startNamingGuardianPoll()'), 'client apply 启动常驻渲染钩子拉询')

  const apiSrc = readFileSync(join(ROOT, 'src/client/kernel/api.js'), 'utf8')
  // （namingSignal 的 client 发送点在 store.js recordIssuePath，下一节单独断言）
  for (const needle of ["host.call('wf.namingPlan'", "host.call('wf.registerNewSessionWatcher'", "host.call('wf.cancelNewSessionWatcher'", "host.call('wf.namingResult'", 'executeNamingOrder(', 'evaluateRenameLock(', 'composeDraftTitle(', 'newSessionTitle(', "o.kind === 'numbered'"]) {
    check(apiSrc.includes(needle), '界面渲染钩子链存在：' + needle.replace(/^\s+/, ''))
  }
  const storeSrc0 = readFileSync(join(ROOT, 'src/client/kernel/store.js'), 'utf8')
  check(!storeSrc0.includes("host.call('wf.awaitCreatedIssue'") && !storeSrc0.includes('pollIssuePathHost'), '认领/推送 nudge 的面包屑通道已随 issuePath 彻底移除（#345）；host 侧 wf.awaitCreatedIssue 仍由索引差值驱动')
  check(!apiSrc.includes('pendingNewSessions') && !apiSrc.includes('startNewSessionRenamePoll') && !apiSrc.includes('tryAutoRename'), '旧 #211 内存双通道簿记（pending map/轮询/自动改名）全库清除')

  const routerSrc = readFileSync(join(ROOT, 'src/client/kernel/router.js'), 'utf8')
  check(!/(export\s+)?(const|function)\s+(SESSION_TITLE_MAX_BYTES|SESSION_TITLE_RE_ALLOW_BARE|SESSION_TITLE_PREFIX|cleanTitleText|utf8Bytes|truncateTitleUtf8|newSessionTitle|isNewPlaceholderTitle|newSessionTitleNew|composeDraftTitle)\b/.test(routerSrc), 'router.js 无第二处命名真源声明')

  const storeSrc = readFileSync(join(ROOT, 'src/client/kernel/store.js'), 'utf8')
  check(!storeSrc.includes("host.call('wf.namingSignal'") && !storeSrc.includes('recordIssuePath'), '面包屑线索信号已随 issuePath 彻底移除（#345）；host 侧 wf.namingSignal 仍保留供其余线索源使用')
  const allClient = routerSrc + apiSrc + storeSrc + clientIdx
  check(!allClient.includes('userRenamed'), 'userRenamed 死代码全库清除（client 半）')
  const hostClean = !hostSrc.includes('userRenamed')
  check(hostClean, 'userRenamed 死代码全库清除（host 半）')
  const dupInClientKernel = (apiSrc.match(/function\s+(composeDraftTitle|evaluateRenameLock|isPlaceholderTitle)\s*\(/g) || []).length
  eq(dupInClientKernel, 0, 'client 内核无第二份核心实现（由共享核心 splice 注入）')
}

// ---------- 8) 编号跃迁消费（P2 · #266）----------
console.log('\n— 编号跃迁（P2 · 建号感知消费）—')
{
  const base = m.createTrackingState({ sessionId: 'n1', baselineTitle: '[New] 新建需求', repoKey: 'o/r', cwd: 'C:/x' })
  // 占位 → 编号（跳过草稿档）：编号优先于草稿（D1 分档层级）
  const stNum = m.reduceTrackingState(base, { type: 'numbered', number: 42, title: '修复闪退' })
  eq(stNum.stage, m.NAMING_STAGES.NUMBERED, '编号信号 → 升入编号档')
  eq(stNum.number, 42, '编号随信号入账')
  eq(stNum.numberTitle, '修复闪退', 'issue 标题随信号入账')
  const o = m.planOrderFor(stNum, Date.now(), 20000)
  check(!!o && o.kind === 'numbered' && o.sessionId === 'n1' && o.number === 42 && o.title === '修复闪退', '编号档出 numbered 订单（携编号+标题，无语言字面量）')
  check(!!o && !!o.lock && o.lock.baselineTitle === '[New] 新建需求' && o.lock.lastMachineTitle === null, 'numbered 订单附值比对锁信息')
  // 落定收敛：renamed 接受 [#n] 标题 → numberedDone → 不再出单
  const stDone = m.reduceTrackingState(stNum, { type: 'renamed', title: '[#42] 修复闪退' })
  eq(stDone.numberedDone, true, '编号档 rename 落定标记（matched [#n] 前缀）')
  eq(m.planOrderFor(stDone, Date.now(), 20000), null, '落定后不再出 numbered 单（防重复）')
  // 草稿档名（非 [#n] 前缀）的 renamed 不得抢占 numberedDone
  const stDraftFirst = m.reduceTrackingState(stNum, { type: 'renamed', title: '[草稿] 修复闪退' })
  eq(stDraftFirst.numberedDone, false, '非编号名 renamed 不误标 numberedDone')
  const oRetry = m.planOrderFor(stDraftFirst, Date.now(), 20000)
  check(!!oRetry && oRetry.kind === 'numbered', '仍在等 numbered 单（重试语义）')
  // 守卫：锁定后编号信号忽略；已有不同编号忽略（防串名 AC5）；同编号允许幂等重放标题
  const stLockedN = m.reduceTrackingState(base, { type: 'locked' })
  const stLockedAfter = m.reduceTrackingState(stLockedN, { type: 'numbered', number: 7, title: 'x' })
  eq(stLockedAfter.stage, m.NAMING_STAGES.PLACEHOLDER, '锁定会话编号信号忽略（永不触碰）')
  const stConflict = m.reduceTrackingState(stNum, { type: 'numbered', number: 99, title: 'y' })
  eq(stConflict.number, 42, '已有不同编号 → 防串名不覆盖')
  const stSame = m.reduceTrackingState(stNum, { type: 'numbered', number: 42, title: '修复闪退（改名后）' })
  eq(stSame.numberTitle, '修复闪退（改名后）', '同编号幂等重放携带最新标题')
  // 草稿 → 编号桥接：draft 阶段停发 P1 单、发 numbered 单
  const stDraft = m.reduceTrackingState(base, { type: 'signal', hint: '线索A' })
  const stDraftRenamed = m.reduceTrackingState(stDraft, { type: 'renamed', title: '[草稿] 线索A' })
  eq(stDraftRenamed.stage, m.NAMING_STAGES.DRAFT, 'P1 落地（基线规约不变）')
  const stDraftNum = m.reduceTrackingState(stDraftRenamed, { type: 'numbered', number: 3, title: 'c3' })
  eq(stDraftNum.stage, m.NAMING_STAGES.NUMBERED, '草稿档升编号档')
  const oDraftNum = m.planOrderFor(stDraftNum, Date.now(), 20000)
  check(!!oDraftNum && oDraftNum.kind === 'numbered' && oDraftNum.number === 3, '草稿→编号只发 numbered 单')
}

// ---------- 9) 编号归属纯函数（#266 · issue 索引差值底座）----------
console.log('\n— 编号归属（索引差值 · 纯函数）—')
{
  const idx1 = { '1': { title: 'a1' }, '2': { title: 'b2', state: 'OPEN', updatedAt: 'u2' } }
  const idx2 = { '1': { title: 'a1' }, '2': { title: 'b2', state: 'OPEN', updatedAt: 'u2' }, '5': { title: 'e5' }, '3': { title: 'c3' } }
  eq(JSON.stringify(m.newNumbersSince(idx1, idx2)), '[3,5]', '差值取新增编号且升序')
  eq(JSON.stringify(m.newNumbersSince(idx1, idx1)), '[]', '无变化 → 无新增')
  eq(JSON.stringify(m.newNumbersSince(null, idx1)), '[1,2]', '无前置基线 → 全量（host 侧首轮仅建档不归属）')
  eq(JSON.stringify(m.newNumbersSince(idx1, null)), '[]', '当前快照缺失 → 无新增')
  const awake = { sessionId: 'a', createdAt: 100, stage: m.NAMING_STAGES.PLACEHOLDER, locked: false, number: null }
  check(m.isNumberAwaitStage(awake), '占位未锁未获号 → 等待中')
  check(!m.isNumberAwaitStage(Object.assign({}, awake, { stage: m.NAMING_STAGES.NUMBERED, number: 1 })), '已获号 → 不再等待')
  check(!m.isNumberAwaitStage(Object.assign({}, awake, { locked: true })), '锁定 → 不再等待')
  check(!m.isNumberAwaitStage(Object.assign({}, awake, { stage: m.NAMING_STAGES.REFINED })), '精修档 → 不再等待')
  const sessions = [
    { sessionId: 'b', createdAt: 200, updatedAt: 200, stage: m.NAMING_STAGES.PLACEHOLDER, locked: false },
    { sessionId: 'a', createdAt: 100, updatedAt: 100, stage: m.NAMING_STAGES.PLACEHOLDER, locked: false, hint: 'c3' },
    { sessionId: 'c', createdAt: 150, updatedAt: 150, stage: m.NAMING_STAGES.DRAFT, locked: false, hint: 'e5' },
    { sessionId: 'd', createdAt: 50, updatedAt: 50, stage: m.NAMING_STAGES.PLACEHOLDER, locked: true },
    { sessionId: 'e', createdAt: 60, updatedAt: 60, stage: m.NAMING_STAGES.NUMBERED, locked: false, number: 1 },
  ]
  const assigned = m.attributeNewNumbers({ prevIndex: idx1, currIndex: idx2, sessions: sessions })
  eq(assigned.length, 2, '两新号两候选（锁/已获号排除）')
  eq(assigned[0].sessionId, 'a', '歧义取最早（createdAt 100）')
  eq(assigned[0].number, 3, '编号升序分配')
  eq(assigned[0].title, 'c3', '标题随号携带')
  eq(assigned[1].sessionId, 'c', '次早（draft 档可被归属）')
  eq(assigned[1].number, 5, '次号给次早候选')
  const few = m.attributeNewNumbers({ prevIndex: idx1, currIndex: idx2, sessions: sessions.slice(0, 1) })
  eq(few.length, 0, '候选耗尽即止（裸会话不配号，无可归者不入计划单）')
  const none = m.attributeNewNumbers({ prevIndex: idx1, currIndex: idx1, sessions: sessions })
  eq(none.length, 0, '无新编号 → 无归属')
  const sameTs = m.attributeNewNumbers({ prevIndex: idx1, currIndex: idx2, sessions: [
    { sessionId: 'z', createdAt: 100, updatedAt: 100, stage: m.NAMING_STAGES.PLACEHOLDER, locked: false, hint: 'c3' },
    { sessionId: 'a', createdAt: 100, updatedAt: 100, stage: m.NAMING_STAGES.PLACEHOLDER, locked: false, hint: 'c3' },
  ] })
  eq(sameTs[0].sessionId, 'a', '同时间戳以 sessionId 决胜（确定性）')
}

// ---------- 10) 失败可见性与有限重试（#267 · F4）----------
console.log('\n— 失败可见性与有限重试（#267）—')
{
  const st0 = m.createTrackingState({ sessionId: 'f1', baselineTitle: '[New] 新建需求', repoKey: null })
  const st1 = m.reduceTrackingState(st0, { type: 'signal', hint: '登录闪退' })
  // 第一次失败：入账（计数/时刻/摘要），冷却窗内静默、窗外自愈
  const fa = m.reduceTrackingState(st1, { type: 'renameFailed', error: 'boom-1' })
  eq(fa.failCount, 1, 'renameFailed 入账计数')
  check(typeof fa.lastFailAt === 'number' && fa.lastFailAt > 0, '失败时刻入账')
  eq(fa.lastError, 'boom-1', '错误摘要入账')
  eq(m.planOrderFor(fa, fa.lastFailAt + 1000, 20000), null, '冷却窗内不重复出单（自愈窗口）')
  check(!!m.planOrderFor(fa, fa.lastFailAt + 46000, 20000), '冷却窗外重新出单（瞬时故障可自愈）')
  eq(m.namingFailureInfo(fa), null, '未达预算上限 → 无定败画像')
  // 连败达上限：定败 —— 永不再出单，失败画像携完整字段供面板呈现
  let stx = st1
  for (let i = 0; i < m.NAMING_RETRY_MAX; i++) stx = m.reduceTrackingState(stx, { type: 'renameFailed', error: 'boom-' + (i + 1) })
  eq(stx.failCount, m.NAMING_RETRY_MAX, '连败累计达预算上限')
  eq(m.planOrderFor(stx, stx.lastFailAt + 99999999, 20000), null, '定败后永不再出单')
  const fi = m.namingFailureInfo(stx)
  check(!!fi && fi.sessionId === 'f1' && fi.stage === m.NAMING_STAGES.PLACEHOLDER && fi.kind === 'draft', '定败画像：身份 + 档位 + 形态')
  check(fi && fi.hint === '登录闪退' && fi.count === m.NAMING_RETRY_MAX && fi.error === 'boom-3', '定败画像：线索 / 次数 / 末次错误')
  check(fi && fi.lock && fi.lock.baselineTitle === '[New] 新建需求' && fi.lock.lastMachineTitle === null && fi.lock.locked === false, '定败画像附值比对锁信息（协商化解依据）')
  // 化解路 A：手改 → locked 终局 → 提醒撤下
  const stMan = m.reduceTrackingState(stx, { type: 'locked' })
  eq(m.planOrderFor(stMan, Date.now(), 20000), null, '手改锁定后不出单（永不触碰）')
  eq(m.namingFailureInfo(stMan), null, '锁定即化解：定败画像清零')
  // 化解路 B：值一致收敛（上次实际落定但回报丢失）→ renamed 记账清账
  const rec = m.reduceTrackingState(stx, { type: 'renamed', title: '[草稿] 登录闪退' })
  eq(rec.failCount, 0, '成功改名清账（预算重开）')
  eq(rec.lastError, null, '成功改名清错误摘要')
  eq(rec.stage, m.NAMING_STAGES.DRAFT, '值一致收敛仍完成档位跃迁')
  eq(m.namingFailureInfo(rec), null, '收敛后定败画像消失')
  // 编号跃迁 = 换目标重开预算（草稿期连败不得拖累编号档命名义务）
  const base2 = m.createTrackingState({ sessionId: 'f2', baselineTitle: '[New] 新建需求', repoKey: 'o/r' })
  let stD2 = base2
  for (let i = 0; i < m.NAMING_RETRY_MAX; i++) stD2 = m.reduceTrackingState(stD2, { type: 'renameFailed', error: 'e' })
  const stN2 = m.reduceTrackingState(stD2, { type: 'numbered', number: 9, title: 't9' })
  eq(stN2.failCount, 0, '全新获号重开预算（防跨档拖累）')
  check(!!m.planOrderFor(stN2, Date.now(), 20000) && m.planOrderFor(stN2, Date.now(), 20000).kind === 'numbered', '编号档新预算立即可出单')
  // 防御：锁定会话收不到也记不了失败入账
  const stL2 = m.reduceTrackingState(base2, { type: 'locked' })
  const stLF = m.reduceTrackingState(stL2, { type: 'renameFailed', error: 'nope' })
  eq(stLF.failCount, 0, '锁定会话失败入账忽略')
}

// ---------- 11) 守卫断言随迁（#267 · F4 · 防 e98f636 式静默删除）----------
console.log('\n— #267 守卫断言 —')
{
  const hostG = readFileSync(join(ROOT, 'src/host/index.js'), 'utf8')
  check(hostG.includes("outcome === 'failed'"), 'host namingResult 收 failed 回报')
  check(hostG.includes("{ type: 'renameFailed', error: args.error }"), 'host failed 走共享核心 renameFailed 入账（单一真源）')
  check(hostG.includes('core.namingFailureInfo(s)'), 'host 定败画像取自共享核心纯函数')
  check(hostG.includes('failures: failures'), 'wf.namingPlan 回包携带 failures 清单')
  check(hostG.includes('exhausted: !!core.namingFailureInfo(next)'), 'failed 回报回执携带定败标记')
  // 预算常量只活在共享核心（两半均不得私藏第二份预算实现）
  check(!hostG.includes('NAMING_RETRY_MAX') && !hostG.includes('NAMING_RETRY_COOLDOWN_MS'), 'host 半无私藏重试预算常量')

  const apiG = readFileSync(join(ROOT, 'src/client/kernel/api.js'), 'utf8')
  check(apiG.includes('function reconcileNamingFailure'), '界面半协商化解函数存在（只读探测绝不盲写）')
  check(apiG.includes('function applyNamingFailurePanel'), '面板级同步函数存在（共享 store 落账）')
  check(apiG.includes('Array.isArray(res.failures)') && apiG.includes('reconcileNamingFailure(fails[i])') && apiG.includes('applyNamingFailurePanel(fails)'), '渲染钩子拉询链消费 failures 清单')
  check(apiG.includes("evaluateRenameLock({ currentTitle: cur, lastMachineTitle: lock.lastMachineTitle, baselineTitle: lock.baselineTitle })"), '协商化解走同一值比对锁真源')
  check(!apiG.includes('NAMING_RETRY_MAX') && !apiG.includes('NAMING_RETRY_COOLDOWN_MS'), 'client 内核无私藏重试预算常量')

  const dockG = readFileSync(join(ROOT, 'src/client/panel/Dock.js'), 'utf8')
  check(dockG.includes('h(NamingFailBanner)'), 'DetailsDock 挂载面板级定败横幅（NamingFailBanner 叶子组件）')
  const bannerG = readFileSync(join(ROOT, 'src/client/panel/NamingFailBanner.js'), 'utf8')
  check(bannerG.includes('cx.storeSvc.useStore(null)'), '横幅自订阅共享 store（面板级而非会话级）')
  check(bannerG.includes('shS.namingFailures'), '横幅消费共享 store 定败清单（渲染钩子落账）')
  check(bannerG.includes("'data-naming-fail-banner': '1'"), '面板级定败横幅节点存在（非目标会话内 toast）')
  check(bannerG.includes("tr('naming.failTitle')") && bannerG.includes("tr('naming.failHint')") && bannerG.includes("tr('naming.stageDraft')"), '横幅文案经 locale（双语跟随）')

  const locG = readFileSync(join(ROOT, 'src/client/kernel/locale.js'), 'utf8')
  for (const k of ['naming.failTitle', 'naming.failHint', 'naming.stageDraft']) {
    check(locG.split("'" + k + "':").length - 1 === 2, 'locale 双语配对键：' + k)
  }

  const coreG = readFileSync(join(ROOT, 'src/shared/naming-guardian.js'), 'utf8')
  check(coreG.includes('export const NAMING_RETRY_MAX') && coreG.includes('export const NAMING_RETRY_COOLDOWN_MS'), '重试预算常量单一真源在共享核心')
  check(coreG.includes("kind: state.stage === NAMING_STAGES.NUMBERED ? 'numbered' : 'draft'"), '定败画像档位形态判定在核心')
}

console.log(failed ? '\n存在失败' : '\n全部通过 (' + total + ' checks)')
process.exit(failed ? 1 : 0)