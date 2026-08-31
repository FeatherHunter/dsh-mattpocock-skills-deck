// tests/verify-chain.js — 契约层 chain.js 纯函数校验（#225 验收）
// 规约：D3 检查项/链条形状 + D5 动作词汇表 + 求值器（纯函数，无 IO，不启 DSH）
// 用法：node tests/verify-chain.js
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)

let failed = false
let total = 0
let passed = 0
function check(ok, msg, detail='') {
  total++
  if (ok) { passed++; console.log('  PASS ' + msg) }
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

console.log('== 契约层 chain.js（#225）==')

let mod
try {
  mod = await import('../src/shared/tracker/chain.js')
} catch (e) {
  console.log('  FAIL import chain.js — ' + String(e && e.message || e))
  console.log(e && e.stack)
  process.exit(1)
}

// ---------- 1. 枚举与常量 ----------
console.log('\n— 枚举 —')
{
  const types = mod.ACTION_TYPES || mod.ACTION_TYPE
  check(!!types, 'ACTION_TYPES/ACTION_TYPE 存在')
  if (types) {
    const vals = Object.values(types)
    check(vals.includes('inject-prompt'), '动作枚举含 inject-prompt')
    check(vals.includes('open-url'), '动作枚举含 open-url')
    check(vals.includes('rpc'), '动作枚举含 rpc')
    check(vals.includes('form'), '动作枚举含 form')
    check(vals.includes('refresh'), '动作枚举含 refresh')
    check(vals.includes('wizard'), '动作枚举含 wizard（2026-08-28 向导扩展）')
    check(vals.length === 6, '动作枚举恰 6 种 — got=' + vals.length)
  }
  const states = mod.CHECK_STATE || mod.STEP_STATUS
  check(!!states, 'CHECK_STATE/STEP_STATUS 存在')
  if (states) {
    const sv = Object.values(states)
    check(sv.includes('done'), '步骤状态含 done')
    check(sv.includes('current'), '步骤状态含 current')
    check(sv.includes('fail'), '步骤状态含 fail')
    check(sv.includes('pending'), '步骤状态含 pending')
    check(!sv.includes('na'), '步骤状态不含 na（2026-08-27 已删）')
  }
  const chainVer = mod.CHAIN_VERSION
  check(typeof chainVer === 'number' && chainVer >= 1, 'CHAIN_VERSION 存在 — got=' + chainVer)
  // SHOW_LEVELS
  if (mod.SHOW_LEVELS) {
    const lv = Object.values(mod.SHOW_LEVELS)
    check(lv.includes('info') || lv.includes('bad'), 'SHOW_LEVELS 含 info/bad — got=' + lv.join(','))
  }
  // G5 双名制注释：动作数据永不被数据路径读取 — 检查文件含该注释
  try {
    const fs = await import('node:fs')
    const txt = fs.readFileSync('src/shared/tracker/chain.js', 'utf8')
    check(txt.includes('永不被数据路径读取') || txt.includes('永不进入数据路径'), 'G5 双名制注释存在（动作/检查项不入数据路径）')
    check(txt.includes('2026-08-27'), '生效日期 2026-08-27 携带')
    check(txt.includes('推进只来自重求值') || txt.includes('重求值'), 'D5 推进原则注释存在（动作不承诺修复）')
  } catch {}
}

// ---------- 2. 形状校验 ----------
console.log('\n— 形状校验 —')
{
  const { validateCheckItem, validateChain, validateAction } = mod
  check(typeof validateCheckItem === 'function', 'validateCheckItem 为函数')
  check(typeof validateChain === 'function', 'validateChain 为函数')
  check(typeof validateAction === 'function', 'validateAction 为函数')

  // 合法检查项（票面简化形态）
  const simpleItem = {
    check: 'git.repo',
    onPass: { show: { title: '仓库就绪', desc: 'ok' }, actions: [] },
    onFail: { show: { title: '不是 git 仓库', desc: '需初始化', level: 'bad' }, actions: [{ type: 'form', form: { title: '建仓', fields: [{ name: 'name', label: '仓库名' }], submit: { endpoint: 'wf.initPublish' } } }] }
  }
  const e1 = validateCheckItem(simpleItem)
  check(Array.isArray(e1) && e1.length === 0, '简化形态 check string 合法 — ' + JSON.stringify(e1))

  // 对象形态（精细化）
  const richItem = {
    id: 'gh.cli',
    check: { kind: 'primitive', primitive: 'commandExists', command: 'gh' },
    onPass: { show: { title: 'gh 已安装', i18nKey: 'check.ghCli.done' }, actions: [] },
    onFail: { show: { title: '未安装 gh', level: 'bad', fallback: 'gh missing' }, actions: [{ type: 'open-url', url: 'https://cli.github.com' }] }
  }
  const e2 = validateCheckItem(richItem)
  check(Array.isArray(e2) && e2.length === 0, '对象形态 primitive 合法 — ' + JSON.stringify(e2))

  // 非法：缺 check
  const bad1 = { onPass: { show: { title: 'x' }, actions: [] }, onFail: { show: { title: 'y' }, actions: [] } }
  const eb1 = validateCheckItem(bad1)
  check(Array.isArray(eb1) && eb1.length > 0, '缺 check 应校验失败 — got=' + JSON.stringify(eb1).slice(0,200))

  // 非法：重复 id
  const dupChain = [
    { id: 'a', check: 'a', onPass: { show: { title: 'a' }, actions: [] }, onFail: { show: { title: 'a' }, actions: [] } },
    { id: 'a', check: 'b', onPass: { show: { title: 'b' }, actions: [] }, onFail: { show: { title: 'b' }, actions: [] } },
  ]
  const edup = validateChain(dupChain)
  check(Array.isArray(edup) && edup.length > 0, '重复 id 应链校验失败 — ' + JSON.stringify(edup).slice(0,200))

  // 动作：inject-prompt 合法
  const va1 = validateAction({ type: 'inject-prompt', prompt: 'setupRun', args: { trackerLine: 'x' } })
  check(va1.ok && !va1.unsupported, 'inject-prompt 合法 — ' + JSON.stringify(va1))
  const va1b = validateAction({ type: 'inject-prompt', promptId: 'ghAuthGuide' })
  check(va1b.ok, 'inject-prompt promptId 别名合法')

  // 动作：open-url 非法缺 url
  const va2 = validateAction({ type: 'open-url' })
  check(!va2.ok, 'open-url 缺 url 应失败')

  // 动作：rpc 合法
  const va3 = validateAction({ type: 'rpc', method: 'wf.snapshot' })
  check(va3.ok, 'rpc 合法')

  // 动作：form 合法（票面形态）
  const va4 = validateAction({ type: 'form', form: { title: '建仓', fields: [{ name: 'name', label: '仓库名' }, { name: 'visibility', label: '可见性', type: 'single', options: ['public','private'] }], submit: { endpoint: 'wf.initPublish' } } })
  check(va4.ok, 'form 票面形态合法 — ' + JSON.stringify(va4))

  // 动作：form 合法（精细形态 schema + submitAction）
  const va5 = validateAction({ type: 'form', schema: [{ name: 'repo', labelKey: 'field.repo' }], submitAction: { type: 'rpc', method: 'wf.createRepo' } })
  check(va5.ok, 'form 精细形态合法')

  // 动作：未知类型 = unsupported（诚实，不抛错）
  const va6 = validateAction({ type: 'unknown-type', foo: 'bar' })
  check(va6.ok && va6.unsupported, '未知类型应 unsupported 透传 — ' + JSON.stringify(va6))

  // 校验 isKnownActionType
  if (typeof mod.isKnownActionType === 'function') {
    check(mod.isKnownActionType('inject-prompt'), 'isKnownActionType(inject-prompt)=true')
    check(!mod.isKnownActionType('unknown'), 'isKnownActionType(unknown)=false')
  }
}

// ---------- 3. 求值器纯函数 ----------
console.log('\n— 求值器（纯函数） —')
{
  const { evaluateChain, chainProgress, capsuleSummary, isChainComplete, currentStepOf } = mod
  check(typeof evaluateChain === 'function', 'evaluateChain 为函数')

  // 辅助：构造最小链（3 步）
  const chain = [
    { id: 'git.repo', check: 'git.repo', onPass: { show: { title: 'git 仓库' }, actions: [] }, onFail: { show: { title: '非 git 仓库', level: 'bad' }, actions: [{ type: 'form', form: { fields: [{ name:'name', label:'名' }], submit: { endpoint:'wf.initPublish' } } }] } },
    { id: 'gh.cli', check: 'gh.cli', onPass: { show: { title: 'gh 已装' }, actions: [] }, onFail: { show: { title: 'gh 未装', level: 'bad' }, actions: [{ type: 'open-url', url: 'https://cli.github.com' }] } },
    { id: 'gh.auth', check: 'gh.auth', onPass: { show: { title: '已登录' }, actions: [] }, onFail: { show: { title: '未登录', level: 'warn' }, actions: [{ type: 'inject-prompt', prompt: 'ghAuthGuide' }] } },
  ]

  // 3.1 顺序推进：全 pass → allDone
  const snapAllPass = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'pass', 'gh.auth': 'pass' })
  check(snapAllPass.chainState === 'allDone', '全 pass → allDone — got=' + snapAllPass.chainState)
  check(snapAllPass.isComplete === true, '全 pass isComplete true')
  check(snapAllPass.doneCount === 3, '全 pass doneCount=3 — got=' + snapAllPass.doneCount)
  check(snapAllPass.steps.every(s => s.status === 'done'), '全 pass 每步 done')

  // 3.2 失败停步：首步 fail → 后续 pending
  const snapFailFirst = evaluateChain(chain, { 'git.repo': 'fail', 'gh.cli': 'pass', 'gh.auth': 'pass' })
  check(snapFailFirst.currentIndex === 0, '首步 fail currentIndex=0 — got=' + snapFailFirst.currentIndex)
  check(snapFailFirst.steps[0].status === 'fail' || snapFailFirst.steps[0].status === 'current', '首步 fail 状态为 fail/current — got=' + snapFailFirst.steps[0].status)
  check(snapFailFirst.steps[1].status === 'pending', '首步 fail 后第二步 pending — got=' + snapFailFirst.steps[1].status)
  check(snapFailFirst.steps[2].status === 'pending', '首步 fail 后第三步 pending')
  check(snapFailFirst.hasBlockingFailure === true, '首步 fail hasBlockingFailure true')

  // 3.3 第二步 fail：第一步 pass，第二步 fail，第三步 pending
  const snapFailSecond = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'fail', 'gh.auth': 'pass' })
  check(snapFailSecond.steps[0].status === 'done', '第二步 fail 时首步 done')
  check(snapFailSecond.currentIndex === 1, '第二步 fail currentIndex=1')
  check(snapFailSecond.steps[1].isCurrent === true, '第二步 fail isCurrent true')
  check(snapFailSecond.steps[2].status === 'pending', '第二步 fail 第三步 pending')

  // 3.4 删 na（2026-08-27）：旧 na 输入现归 pending 且计分母
  const snapNaLike = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'na', 'gh.auth': 'pass' })
  check(snapNaLike.steps[1].status === 'pending', '旧 na 输入现归 pending — got=' + snapNaLike.steps[1].status)
  check(snapNaLike.steps[1].status !== 'na', '无 na 状态')
  check(snapNaLike.applicableCount === 3, '删 na 后 applicableCount=total=3 — got=' + snapNaLike.applicableCount)
  check(snapNaLike.steps[1].isApplicable === true, '删 na 后 isApplicable 恒 true')
  // 校验就绪计数口径（无 na 分母污染）
  const prog = chainProgress(snapNaLike)
  check(prog.total === 3, '删 na 后 progress total=3 — got=' + JSON.stringify(prog))

  // 3.5 重求值覆盖：同一链，先 fail 后 pass，重跑即推进（无动作回调记忆）
  const snapBefore = evaluateChain(chain, { 'git.repo': 'fail', 'gh.cli': 'pass', 'gh.auth': 'pass' })
  const snapAfter = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'pass', 'gh.auth': 'pass' })
  check(snapBefore.chainState !== 'allDone' && snapAfter.chainState === 'allDone', '重求值覆盖：fail→pass 后链推进至 allDone')
  check(snapBefore.steps[0].status !== 'done' && snapAfter.steps[0].status === 'done', '重求值前后同一步状态变化')

  // 3.6 pending：null/undefined 视为探测中，链头 pending
  const snapPending = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': null, 'gh.auth': 'pass' })
  check(snapPending.steps[1].status === 'pending', 'null → pending — got=' + snapPending.steps[1].status)
  check(snapPending.chainState === 'pending', '链头 pending 时 chainState=pending — got=' + snapPending.chainState)

  // 3.7 纯函数：两次同输入结果深相等且不共享引用（无突变）
  const r1 = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'fail' })
  const r2 = evaluateChain(chain, { 'git.repo': 'pass', 'gh.cli': 'fail' })
  check(JSON.stringify(r1) === JSON.stringify(r2), '纯函数：同输入输出相等')
  check(r1 !== r2 && r1.steps !== r2.steps, '纯函数：返回新对象（无共享引用）')

  // 3.8 简化形态兼容：check 为 string 标识，results 用 check 串
  const simpleChain = [
    { check: 'setup.done', onPass: { show: { title: '已初始化' }, actions: [] }, onFail: { show: { title: '未初始化', level:'warn' }, actions: [{ type:'inject-prompt', prompt:'setupRun' }] } },
    { check: 'skills.wayfinder', onPass: { show: { title:'技能就绪' }, actions:[] }, onFail: { show: { title:'技能缺失', level:'bad' }, actions:[{ type:'inject-prompt', prompt:'installSkills' }] } },
  ]
  const snapSimple = evaluateChain(simpleChain, { 'setup.done': 'pass', 'skills.wayfinder': 'fail' })
  check(snapSimple.steps[0].status === 'done', 'string check 首步 pass')
  check(snapSimple.steps[1].isCurrent, 'string check 第二步 current')

  // 3.9 Map 形态输入
  const snapMap = evaluateChain(chain, new Map([['git.repo','pass'],['gh.cli','pass'],['gh.auth','pass']]))
  check(snapMap.chainState === 'allDone', 'Map 输入同样 allDone')

  // 3.10 函数形态输入
  const snapFn = evaluateChain(chain, (k) => k === 'git.repo' ? 'pass' : (k === 'gh.cli' ? 'fail' : 'pass'))
  check(snapFn.currentIndex === 1, '函数输入 currentIndex=1')

  // 3.11 isChainComplete / currentStepOf 便捷
  check(isChainComplete(snapAllPass) === true, 'isChainComplete allDone true')
  check(isChainComplete(snapFailFirst) === false, 'isChainComplete fail false')
  check(currentStepOf(snapFailFirst) && currentStepOf(snapFailFirst).id === 'git.repo', 'currentStepOf 取首个失败步')
  check(currentStepOf(snapAllPass) === null, 'currentStepOf allDone 为 null')

  // 3.12 胶囊汇总
  const capDone = capsuleSummary(snapAllPass)
  check(capDone.kind === 'done', 'capsule allDone kind=done')
  const capCurrent = capsuleSummary(snapFailSecond)
  check(capCurrent.kind === 'current' || capCurrent.kind === 'fail', 'capsule fail 时 kind=current/fail — got=' + capCurrent.kind)

  // 3.13 未知动作类型不影响求值（透传）
  const chainUnknown = [
    { id: 'x', check: 'x', onPass: { show:{title:'ok'}, actions:[] }, onFail: { show:{title:'bad', level:'bad'}, actions:[{ type:'future-type', foo:'bar' }] } }
  ]
  const snapUnknown = evaluateChain(chainUnknown, { x: 'fail' })
  check(snapUnknown.steps[0].actions.length === 1 && snapUnknown.steps[0].actions[0].type === 'future-type', '未知动作类型求值时透传')
  const vaUnknown = mod.validateAction({ type:'future-type', foo:'bar' })
  check(vaUnknown.unsupported, 'validateAction 对未知类型标记 unsupported')
}

console.log('\n— 汇总 —')
console.log('  total=' + total + ' passed=' + passed + ' failed=' + (total-passed))
if (failed) {
  console.log('\n  FAIL  verify-chain — 有失败')
  process.exit(1)
} else {
  console.log('\n  PASS  verify-chain — 全部通过')
}