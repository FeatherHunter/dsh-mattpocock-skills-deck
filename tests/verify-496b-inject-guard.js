// verify-496b-inject-guard.js — #496 第二票（A 方案门控式）：注入只有一个漏斗、判据不认品牌、门控确认不注入
// 用法: node tests/verify-496b-inject-guard.js
// 约束：UI 零品牌分支、日志只记分支不记隐私、标记按工作区键隔离
//
// #664 改写说明（按规格 #662 把这张门禁收回 npm run verify 链上）：
//   1. 「缺仓库时改发后端声明的 repoRemoteFix 长文」那一档按新流程退役了（缺仓库由界面上那一段负责），
//      所以原先卡它存在的那条断言删掉；判据也跟着换 —— 现在读共享清单里标着 blocksSetup 的那一步过没过
//      （见 prompts.js 的 setupBlockedByGuide），不再读后端的能力位 capabilities.repoCreateChain。
//   2. 门控确认（开门链两个窗与切换后端确认）不再往会话里注入任何文字，所以原先「这几处都走决策器」
//      那几条断言反过来钉：那三处的源码里不许再出现注入调用；状态栏黄条那条路照旧走决策器（它要弹布局小卡）。
//   3. 「建仓成功后补发一次」那对标记与它的两个消费方留着（置真它的那一档已退役，今天走不到），照旧钉住。
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const prompts = fs.readFileSync('src/client/kernel/prompts.js', 'utf8')
// #698：那一段注入决策（setupBlockedByGuide / injectSetupDecision / 待补标记的置位）搬去了 kernel/prompts-setup.js ——
//   本文件后面凡是要在「决策那一段」里找东西的，都改看这一份（prompts.js 只留模板表与取值函数）。
const setupDec = fs.readFileSync('src/client/kernel/prompts-setup.js', 'utf8')
const sb = fs.readFileSync('src/client/statusbar/StatusBackend.js', 'utf8')
const dock = fs.readFileSync('src/client/panel/Dock.js', 'utf8')
const og = fs.readFileSync('src/client/panel/OverlayGate.js', 'utf8')
const sw = fs.readFileSync('src/client/kernel/store-switch.js', 'utf8')
const nr = fs.readFileSync('src/client/views/NoRepoCard.js', 'utf8')
const mv = fs.readFileSync('src/client/kernel/slotRenderer-modal-view.js', 'utf8')
// 1) 决策器存在：判据读共享清单里那一步，不做品牌分支
check(/export\s+(const|function)\s+setupOrRepoPrompt\b/.test(prompts), 'prompts.js 导出 setupOrRepoPrompt')
check(/export\s+(const|function)\s+injectSetupDecision\b/.test(setupDec), 'injectSetupDecision 仍在（#698 起住在 kernel/prompts-setup.js）')
check(/export\s+(const|function)\s+consumePendingSetup\b/.test(prompts), 'prompts.js 导出 consumePendingSetup')
check(setupDec.includes('setupBlockedByGuide') && prompts.includes('blocksSetup'), '判据读共享清单里标着 blocksSetup 的那一步（非后端能力位）')
check(!prompts.includes('repoRemoteFix'), '缺仓长文那一档已退役（决策器里不再去找这段文案）')
check(!/(===|==)\s*['"](github|gitlab|markdown)['"]|['"](github|gitlab|markdown)['"]\s*(===|==)/.test(prompts + setupDec), '决策那一段与模板表都无品牌等值分支')
// 2) 待补标记按工作区键隔离
check(setupDec.includes('pendingSetupAfterPublish') && setupDec.includes('pendingSetupCwd'), '待补标记按工作区键隔离（字段仍在；置真它的那一档已退役，见 kernel/prompts-setup.js 里的说明）')
// 3) 注入入口：状态栏黄条仍走决策器；门控确认那两条路不许再注入；切换后端按场景注入（#669 第 6 件 / ADR 20260921）
check(/injectSetupDecision\(s,id,\{allowCard:true,\s*askLayout:true\}\)/.test(sb), '状态栏黄条那条路仍走决策器，且每次都先弹那张布局小卡（askLayout:true，2026-09-21 维护者拍板 A）')
check(!/injectSetupDecision\s*\(/.test(dock), 'Dock 的门控确认不再注入（#664）')
check(!/injectSetupDecision\s*\(/.test(og), 'OverlayGate 的门控确认不再注入（#664）')
// 切换后端那条路 2026-09-21 按场景分了两支：未初始化走决策器（与黄条同一条，允许开卡），
// 已初始化注入的是另一条「切换后对齐」的 prompt。这里只钉「不许自己拼初始化全文」这条 #664 的本意。
check(!/setupRunPrompt\(st,\s*targetId\)/.test(sw), 'store-switch 不自己拼初始化全文（#664 的本意不动）')
check(/injectSetupDecision\(st,\s*targetId,\s*\{\s*allowCard:\s*true,\s*askLayout:\s*true,\s*source:\s*'switch'\s*\}\)/.test(sw), '未初始化那一支走决策器 + 允许开那张布局小卡 + 每次都问（#669 第 6 件 / #698）')
check(/injectSetupDecision\(st,\s*targetId,\s*\{\s*allowCard:\s*true,\s*askLayout:\s*true,\s*source:\s*'switch'\s*\}\)/.test(sw), '已初始化那一支也走**同一份判据**（同样是每次都问；#698 维护者 2026-09-22 拍板）')
check(/promptText\('switchAlign'/.test(sw), '已初始化那一支注入的是 switchAlign（对齐仓库里的后端记录）')
// 4) 两处建仓成功消费标记，仅补一次
check(nr.includes('consumePendingSetup(st)'), '旧红卡建成后消费标记')
check(mv.includes('consumePendingSetup(st)'), '向导建成后消费标记')
// 5) 日志：只记分支不记隐私，永不抛（#698：决策那两句留在 prompts.js，执行那一句跟着决策器搬去了 prompts-setup.js）
const logAll = setupDec + '\n' + prompts
const logs = (logAll.match(/\[MattSkillsDeck\] setup-inject/g) || []).length
check(logs >= 3, '决策/执行/补发三处日志（实 ' + logs + '）')
check(!setupDec.includes('st.cwd +') && !setupDec.includes('+ st.cwd'), '日志不记工作区路径等隐私')
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过 · #496 第二票漏斗与门控纪律在位（#664 改写）')
