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
  check(hostSrc.includes('.dsh-mattskillsdeck-cache') && hostSrc.includes("naming-guardian.json"), '跟踪态落盘既有缓存目录')
  check(hostSrc.includes('startNamingGuardianLoop()'), 'host 常驻轻量任务随 apply 启动')

  const buildSrc = readFileSync(join(ROOT, 'scripts/build.mjs'), 'utf8')
  check(buildSrc.includes("'src/shared/naming-guardian.js'"), '构建登记 shared splice（client 半同源注入）')
  const clientIdx = readFileSync(join(ROOT, 'src/client/index.js'), 'utf8')
  check(clientIdx.includes('// ==== shared:namingGuardian (spliced by build) ===='), 'client 闭包挂共享核心拼接标记')
  check(clientIdx.includes('startNamingGuardianPoll()'), 'client apply 启动常驻渲染钩子拉询')

  const apiSrc = readFileSync(join(ROOT, 'src/client/kernel/api.js'), 'utf8')
  // （namingSignal 的 client 发送点在 store.js recordIssuePath，下一节单独断言）
  for (const needle of ["host.call('wf.namingPlan'", "host.call('wf.namingRegister'", "host.call('wf.namingResult'", 'executeNamingOrder(', 'evaluateRenameLock(', 'composeDraftTitle(']) {
    check(apiSrc.includes(needle), '界面渲染钩子链存在：' + needle.replace(/^\s+/, ''))
  }

  const routerSrc = readFileSync(join(ROOT, 'src/client/kernel/router.js'), 'utf8')
  check(!/(export\s+)?(const|function)\s+(SESSION_TITLE_MAX_BYTES|SESSION_TITLE_RE_ALLOW_BARE|SESSION_TITLE_PREFIX|cleanTitleText|utf8Bytes|truncateTitleUtf8|newSessionTitle|isNewPlaceholderTitle|newSessionTitleNew|composeDraftTitle)\b/.test(routerSrc), 'router.js 无第二处命名真源声明')

  const storeSrc = readFileSync(join(ROOT, 'src/client/kernel/store.js'), 'utf8')
  check(storeSrc.includes("host.call('wf.namingSignal'"), '面包屑线索信号接入（recordIssuePath）')
  const allClient = routerSrc + apiSrc + storeSrc + clientIdx
  check(!allClient.includes('userRenamed'), 'userRenamed 死代码全库清除（client 半）')
  const hostClean = !hostSrc.includes('userRenamed')
  check(hostClean, 'userRenamed 死代码全库清除（host 半）')
  const dupInClientKernel = (apiSrc.match(/function\s+(composeDraftTitle|evaluateRenameLock|isPlaceholderTitle)\s*\(/g) || []).length
  eq(dupInClientKernel, 0, 'client 内核无第二份核心实现（由共享核心 splice 注入）')
}

console.log(failed ? '\n存在失败' : '\n全部通过 (' + total + ' checks)')
process.exit(failed ? 1 : 0)
