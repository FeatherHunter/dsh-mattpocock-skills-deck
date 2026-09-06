// verify-496b-inject-guard.js — #496 第二票（A 方案门控式）：无远端不发初始化全文，建成后补发一次
// 用法: node tests/verify-496b-inject-guard.js
// 约束：UI 零品牌分支（能力位判据）、日志只记分支不记隐私、标记按工作区键隔离仅补一次
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const prompts = fs.readFileSync('src/client/kernel/prompts.js', 'utf8')
const sb = fs.readFileSync('src/client/statusbar/StatusBackend.js', 'utf8')
const dock = fs.readFileSync('src/client/panel/Dock.js', 'utf8')
const og = fs.readFileSync('src/client/panel/OverlayGate.js', 'utf8')
const sw = fs.readFileSync('src/client/kernel/store-switch.js', 'utf8')
const nr = fs.readFileSync('src/client/views/NoRepoCard.js', 'utf8')
const mv = fs.readFileSync('src/client/kernel/slotRenderer-modal-view.js', 'utf8')
// 1) 决策器存在：数据驱动读能力位，不做品牌分支
check(/export\s+(const|function)\s+setupOrRepoPrompt\b/.test(prompts), 'prompts.js 导出 setupOrRepoPrompt')
check(/export\s+(const|function)\s+injectSetupDecision\b/.test(prompts), 'prompts.js 导出 injectSetupDecision')
check(/export\s+(const|function)\s+consumePendingSetup\b/.test(prompts), 'prompts.js 导出 consumePendingSetup')
check(prompts.includes('capabilities.repoCreateChain'), '判据读能力位 repoCreateChain（非 id 判据）')
check(prompts.includes('repoRemoteFix'), '缺仓改发后端声明的缺仓指引')
check(!/(===|==)\s*['"](github|gitlab|markdown)['"]|['"](github|gitlab|markdown)['"]\s*(===|==)/.test(prompts), 'prompts.js 无品牌等值分支')
// 2) 待补标记按工作区键隔离
check(prompts.includes('pendingSetupAfterPublish') && prompts.includes('pendingSetupCwd'), '待补标记按工作区键隔离')
// 3) 六处注入点统一走决策器
const sites = (sb.match(/injectSetupDecision\(s,id\)/g) || []).length
check(sites === 3, 'StatusBackend 三处走决策器（得 3，实 ' + sites + '）')
check(dock.includes('injectSetupDecision(s,id)'), 'Dock 走决策器')
check(og.includes('injectSetupDecision(s, id)'), 'OverlayGate 走决策器')
check(sw.includes('injectSetupDecision(st, targetId)'), 'store-switch 走决策器')
// 4) 两处建仓成功消费标记，仅补一次
check(nr.includes('consumePendingSetup(st)'), '旧红卡建成后消费标记')
check(mv.includes('consumePendingSetup(st)'), '向导建成后消费标记')
// 5) 日志：只记分支不记隐私，永不抛
const logs = (prompts.match(/\[MattSkillsDeck\] setup-inject/g) || []).length
check(logs >= 3, '决策/执行/补发三处日志（实 ' + logs + '）')
check(!prompts.includes('st.cwd +') && !prompts.includes('+ st.cwd'), '日志不记工作区路径等隐私')
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过 · #496 第二票门控在位')
