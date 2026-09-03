// verify-success-failure-contract.js — #419/#425 成功路径契约 + #420/#426 失败路径契约（一份契约门）
// 用法: node tests/verify-success-failure-contract.js
// 断言形态：用户可观察状态 / 宿主返回形状 / 关键交互能力（继承 verify-no-repo-redcard / verify-deck-slots 先例）
const fs = require('fs');
const host = fs.readFileSync('host.js', 'utf8');
const pkgHost = fs.readFileSync('package/lib/index.js', 'utf8');
const pubSrc = fs.readFileSync('src/host/publishFlow.js', 'utf8'); // #450 H6：发布/推送体已搬入 publishFlow.js（注册仍在 host），体断言跟随
const pkgPub = fs.readFileSync('package/lib/publishFlow.js', 'utf8'); // package 镜像跟随（构建原样复制）
const cli = fs.readFileSync('client.js', 'utf8');
const pcli = fs.readFileSync('package/lib/client.js', 'utf8');
const ghSrc = fs.readFileSync('src/host/tracker/backends/github/index.js', 'utf8');
let failed = false;
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };

// 1) 宿主：半成功数据契约（push 失败分支 + 原子分支 stdout 解析）+ 重试推送 RPC
check(host.includes("harness.handle('wf.retryPush'"), 'host 含 wf.retryPush handle（重试推送 RPC）');
check(pkgHost.includes("harness.handle('wf.retryPush'"), 'package index 含 wf.retryPush 镜像');
check(pubSrc.includes("halfCreated: !!repoUrl") || pubSrc.includes("(kind !== 'already-exists') && !!repoUrl"), 'host 半成功返回 halfCreated 标记（push 失败 + 原子分支）');
check(pubSrc.includes("(kind !== 'already-exists') && !!repoUrl"), 'host 半成功判定排除 already-exists（同名已存在不误标重试推送）');
check(pubSrc.includes("cr.text || ''"), 'host 原子分支失败时解析 stdout 仓库地址（runGh 保留输出）');
check(pubSrc.includes("repoUrl: repoUrl, repo: repoUrl"), 'host 半成功返回 repoUrl + repo（前端可拼真值链接）');
check(pubSrc.includes("'push', '-u', 'origin', 'HEAD'") && pubSrc.includes("'remote', 'get-url', 'origin'") && pubSrc.includes("'remote', 'add', 'origin'"), 'host retryPush 仅推送：origin 缺失补齐 → push -u origin HEAD');
check(pkgPub.includes("halfCreated"), 'package index 半成功契约镜像');

// 2) 前端分发层：RPC 成功结果透传 + 失败上下文保留（repo/repoUrl/halfCreated）
check(cli.includes("data: (res && typeof res === 'object' && res.ok === true)"), 'actions RPC 成功结果透传 data（成功弹窗可拼真值链接）');
check(pcli.includes("data: (res && typeof res === 'object' && res.ok === true)"), 'package actions 成功透传镜像');
check(cli.includes("if (res.error.halfCreated) err.halfCreated = true") || cli.includes("if (res.halfCreated) err.halfCreated = true"), 'actions 失败保留 halfCreated（半成功不静默）');
check(cli.includes("if (res.error.repo) err.repo = res.repo") || cli.includes("if (res.repo) err.repo = res.repo"), 'actions 失败保留 repo');

// 3) 向导成功分支：成功弹窗 + 同步过渡态 + 后台重查（#419/#425）
check(cli.includes("m.success = { owner:") && (cli.includes("panel.successModal.title") || cli.includes("仓库已创建")), 'slotRenderer 成功后进入成功弹窗态（m.success）');
check(cli.includes("startRepoSync(st)") && cli.includes("runRepoSyncRecheck(st)"), 'slotRenderer 成功即同步过渡态 + 后台重查（不等用户点完成）');
check(cli.includes("st._formModalQueue = []"), 'slotRenderer 成功后丢弃队列残留（向导单例）');
check(cli.includes("if (isWizard) return") && cli.includes("st._formModalQueue.push"), 'openFormModal 向导单例：打开期重触发忽略不入队（form 队列保留）');
check(cli.includes("host.call('wf.retryPush'"), 'slotRenderer 半成功重试推送走 wf.retryPush');

// 4) 失败分支：errorKind 精确回跳 + 内联错误条 + 自动注入（#420/#426）
check(cli.includes("code === 'bad-name' || code === 'already-exists'"), 'slotRenderer failure 按 errorKind 精确回跳（仅 bad-name/already-exists）');
check(!cli.includes('isNameErr'), 'slotRenderer 已删除九条件文本启发式（isNameErr 不存在）');
check(!pcli.includes('isNameErr'), 'package 镜像已删除 isNameErr');
check(cli.includes("role: 'alert'") && cli.includes('m.fail.text'), 'slotRenderer 内联错误条（role=alert + 常驻文案）');
check(cli.includes("code === 'no-gh' || code === 'not-logged-in'") && cli.includes("promptText(code === 'no-gh'"), 'slotRenderer no-gh/not-logged-in 自动注入指引');
check(cli.includes("m.lastVis = String"), 'slotRenderer 记录可见性（成功弹窗按提交选择显示公开/私有）');

// 5) 同步过渡态 UI（ChecksTab：#419 定版 同步中/超时/禁用创建按钮）
check(cli.includes("panel.repoSync.syncing") && cli.includes("panel.repoSync.timeout"), 'ChecksTab 同步态与超时态文案键');
check(cli.includes("disabled: !!repoSync") && cli.includes("st.repoSync || null"), 'ChecksTab 同步窗口内创建按钮禁用');
check(cli.includes("retryRepoSync(st)"), 'ChecksTab 超时态点此重新检查（retryRepoSync）');

// 6) 后端文案真源：7 档 + half-created（中文/English）
const kinds = ['bad-name', 'no-git', 'no-gh', 'not-logged-in', 'already-exists', 'network', 'permission', 'half-created'];
kinds.forEach(function (k) {
  check(ghSrc.includes("'" + k + "': { zh:"), 'github 后端 prompts.errorKinds 含 ' + k + '（zh）');
  check(ghSrc.includes("'" + k + "': { zh: '") && ghSrc.split("'" + k + "': { zh: '")[1] && /[\u4e00-\u9fa5]/.test(ghSrc.split("'" + k + "': { zh: '")[1]), 'github 后端 ' + k + ' 中文文案非空');
});

// 7) locale 键（zh + en 双源，跟随界面语言）
const keys = ['panel.successModal.title', 'panel.successModal.body', 'panel.successModal.bodyFallback', 'panel.successModal.openBtn', 'panel.successModal.doneBtn', 'panel.repoSync.syncing', 'panel.repoSync.timeout', 'panel.retryPushBtn', 'panel.noRepoErr.half-created'];
keys.forEach(function (k) {
  check(cli.includes("'" + k + "'"), 'client 含 ' + k);
  check(pcli.includes("'" + k + "'"), 'package client 含 ' + k + ' 镜像');
});

if (failed) { console.log('\n存在失败'); process.exit(1); }
console.log('\n全部通过 · 成功/失败契约门（#419/#425/#420/#426）');
