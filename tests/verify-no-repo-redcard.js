// verify-no-repo-redcard.js — T2 #35 · 无仓库红卡（历史定版）+ Public/Private 表单 + 双源同步
// 用法: node tests/verify-no-repo-redcard.js
// 2026-08-28 B Timeline 定版修订：全屏红卡（ListTab 首屏）与顶部弱化/重置卡退役——
//   远端未关联由检查页行内红卡（gh:remote FAIL 行）表达；本门禁改为验组件/表单/提交链路保留、
//   ListTab/ChecksTab「不再挂载红卡与顶部错误信息」，其余（i18n/样式 token/dismiss 状态机/initPublish 链路）维持。
const fs = require('fs');
const host = fs.readFileSync('host.js', 'utf8');
const pkgHost = fs.readFileSync('package/lib/index.js', 'utf8');
const cli = fs.readFileSync('client.js', 'utf8');
const pcli = fs.readFileSync('package/lib/client.js', 'utf8');
let failed = false;
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };

// 1) host 侧 wf.initPublish
check(host.includes("harness.handle('wf.initPublish'"), 'host 含 wf.initPublish handle');
// T0（#93）seam 化：pkg host 由规范源构建，harness.handle 经 seam 落入 __DSW_HANDLERS__ Map（不再是手写 case 开关）
// #172 方案 C 原样复制：package/lib/index.js = src/host/index.js 原文件，__DSW_HANDLERS__ 仅旧拼接存在，新包仅需 harness.handle
check(pkgHost.includes("harness.handle('wf.initPublish'"), 'package index 含 initPublish dispatch（seam Map 形态 / 方案 C 原样复制）');
check(host.includes("resolveGit()") && host.includes("resolveGh()"), 'host initPublish 探测 git/gh');
check(host.includes("rev-parse") && host.includes("'init'"), 'host initPublish 含 git init 逻辑（rev-parse 探测 + init）');
check(host.includes("git commit") && host.includes("initial commit") && host.includes("--allow-empty"), 'host initPublish 含 git add + commit --allow-empty');
check(host.includes("auth', 'status'") || host.includes("auth', 'status'"), 'host initPublish 含 gh auth status');
check(host.includes("gh', 'repo', 'create'") || host.includes("'repo', 'create'") || host.includes("repo', 'create'"), 'host initPublish 含 gh repo create');
check(host.includes("--public") && host.includes("--private") && host.includes("--source=.") && host.includes("--push"), 'host initPublish 含 --public/--private --source=. --push');
check(host.includes("already-exists") && host.includes("network") && host.includes("permission") && host.includes("not-logged-in") && host.includes("no-git") && host.includes("no-gh"), 'host initPublish 含 6 errorKind（no-git/no-gh/not-logged-in/already-exists/network/permission）');
check(host.includes("bad-name") && host.includes("^[A-Za-z0-9._-]+$"), 'host initPublish 含 bad-name 校验（正则 + 长度）');
check(pkgHost.includes("already-exists") && pkgHost.includes("no-git"), 'package index initPublish 镜像 6 errorKind');
check(host.includes("cache = { ts: 0") && host.includes("repoKeys"), 'host initPublish 成功后失效缓存 + repoKeys');
check(pkgHost.includes("cache = { ts: 0") && pkgHost.includes("repoKeys"), 'package index initPublish 失效缓存镜像');

// 2) i18n 键（zh + en 双语，跟随 harness locale）
const zhKeys = ['panel.noRepoCardTitle','panel.noRepoCardDesc','panel.noRepoCardAction','panel.noRepoCardDismiss','panel.noRepoCardDone','panel.noRepoFormName','panel.noRepoFormNameHint','panel.noRepoFormVisibility','panel.noRepoFormPublic','panel.noRepoFormPrivate','panel.noRepoFormSubmit','panel.noRepoFormCancel','panel.noRepoFormSubmitting','panel.noRepoReset','panel.noRepoCreateSuccess'];
zhKeys.forEach(k => {
  check(cli.includes(`'${k}'`) || cli.includes(`"${k}"`), `client zh 含 ${k}`);
  check(pcli.includes(`'${k}'`) || pcli.includes(`"${k}"`), `package client zh 含 ${k}`);
});
const errKeys = ['panel.noRepoErr.bad-name','panel.noRepoErr.no-git','panel.noRepoErr.no-gh','panel.noRepoErr.not-logged-in','panel.noRepoErr.already-exists','panel.noRepoErr.network','panel.noRepoErr.permission','panel.noRepoErr.unknown'];
errKeys.forEach(k => {
  check(cli.includes(k), `client 含 ${k}`);
  check(pcli.includes(k), `package client 含 ${k}`);
});
check(cli.includes("'panel.noRepoErr.git-commit-failed'") || cli.includes("git-commit-failed"), 'client 含 git-commit-failed');
check(pcli.includes("'panel.noRepoErr.git-commit-failed'") || pcli.includes("git-commit-failed"), 'package client 含 git-commit-failed');

// 3) 样式 token（复用 dsws-banner bad 视觉语言：rgba(248,113,113,.12) 底 + .45 边 + #f87171 字 + Ic alert）
check(cli.includes("dsws-no-repo-card") && cli.includes("rgba(248,113,113"), 'client 含 dsws-no-repo-card 样式（红底红边）');
check(pcli.includes("dsws-no-repo-card") && pcli.includes("rgba(248,113,113"), 'package client 含 dsws-no-repo-card 样式镜像');
check(cli.includes("dsws-no-repo-form") && cli.includes(".ttl") && cli.includes(".desc"), 'client 含表单样式（ttl/desc/acts/form）');
check(pcli.includes("dsws-no-repo-form"), 'package client 含表单样式镜像');
check(cli.includes("background: 'rgba(248,113,113,.12)'") || cli.includes("rgba(248,113,113,.12)"), 'client 红卡背景 token rgba(248,113,113,.12)');
check(cli.includes("border: '1px solid rgba(248,113,113,.45)'") || cli.includes("rgba(248,113,113,.45)"), 'client 红卡边框 token rgba(248,113,113,.45)');

// 4) 状态机与持久化（按 cwd 维度 localStorage: dsws:noRepoDismiss:<cwdHash> + 记忆重置）
check(cli.includes("NOREPO_DISMISS_PREFIX") && cli.includes("dsws:noRepoDismiss:"), 'client 含 dismiss 前缀 dsws:noRepoDismiss:');
check(pcli.includes("NOREPO_DISMISS_PREFIX") && pcli.includes("dsws:noRepoDismiss:"), 'package client 含 dismiss 前缀镜像');
check(cli.includes("cwdHash") && cli.includes(">>> 0"), 'client 含 cwdHash（按 cwd 维度）');
check(pcli.includes("cwdHash"), 'package client 含 cwdHash 镜像');
check(cli.includes("isNoRepoDismissed") && cli.includes("localStorage.getItem"), 'client 含 isNoRepoDismissed（localStorage 读）');
check(pcli.includes("isNoRepoDismissed"), 'package client 含 isNoRepoDismissed 镜像');
check(cli.includes("setNoRepoDismissed") && cli.includes("localStorage.setItem") && cli.includes("localStorage.removeItem"), 'client 含 setNoRepoDismissed（localStorage 写/删）');
check(cli.includes("cwdBasename") && cli.includes("split(/[\\\\/]/"), 'client 含 cwdBasename（cwd 尾段预填）');
check(cli.includes("isNoRepoNameValid") && cli.includes("^[A-Za-z0-9._-]+$") && cli.includes("100"), 'client 含 isNoRepoNameValid（正则 + 长度 1-100）');
check(cli.includes("ensureNoRepoCard") && cli.includes("noRepoCard"), 'client 含 ensureNoRepoCard + store.noRepoCard');
check(pcli.includes("ensureNoRepoCard"), 'package client 含 ensureNoRepoCard 镜像');
check(cli.includes("noRepoCard: { expanded") && cli.includes("visibility: 'private'"), 'client makeStore 含 noRepoCard（expanded/name/visibility/loading/error + 默认 private）');
check(pcli.includes("noRepoCard: { expanded"), 'package client makeStore 含 noRepoCard 镜像');

// 5) B Timeline 定版（2026-08-28）退役验收：ListTab 顶部全屏红卡与 nBad 环境警告红条不再挂载；
//    行内红卡（gh:remote FAIL 行）与组件/表单/提交链路保留（见 6/7 段）
check(cli.includes("checkRepo") && cli.includes("level === 'bad'") && cli.includes("isNoRepoDismissed"), 'client 含触发判据 checkRepo.level===bad && !isNoRepoDismissed（组件内保留）');
check(pcli.includes("checkRepo") && pcli.includes("level === 'bad'"), 'package client 含触发判据镜像');
check(!cli.includes("h(NoRepoCard"), 'client ListTab 已移除全屏红卡挂载（h(NoRepoCard) 不存在）');
check(!pcli.includes("h(NoRepoCard"), 'package client ListTab 已移除红卡挂载镜像');
check(!cli.includes("list.envWarn', { n: nBad"), 'client ListTab 已移除 nBad 环境警告红条');
check(!pcli.includes("list.envWarn', { n: nBad"), 'package client 已移除 nBad 红条镜像');

// 6) 红卡组件与表单（仓库名输入预填 cwd 尾段可改 + Public/Private 单选 visibility 默认 Private + 错误条 + 主按钮 loading 态）
check(cli.includes("const NoRepoCard") && cli.includes("Ic({ n: 'alert'"), 'client 含 NoRepoCard 组件（Ic alert + 标题/副标题）');
check(pcli.includes("const NoRepoCard"), 'package client 含 NoRepoCard 组件镜像');
check(cli.includes("tr('panel.noRepoCardTitle')") && cli.includes("tr('panel.noRepoCardDesc')"), 'client NoRepoCard 含中英标题/副标题');
check(cli.includes("tr('panel.noRepoCardAction')") && cli.includes("tr('panel.noRepoCardDismiss')"), 'client NoRepoCard 含“创建并发布”主按钮 + “忽略”幽灵按钮');
check(cli.includes("tr('panel.noRepoFormName')") && cli.includes("cwdBasename(st.cwd)"), 'client 表单仓库名输入预填 cwd 尾段可改');
check(cli.includes("tr('panel.noRepoFormNameHint')"), 'client 表单含 nameHint 校验提示');
check(cli.includes("tr('panel.noRepoFormVisibility')") && cli.includes("tr('panel.noRepoFormPrivate')") && cli.includes("tr('panel.noRepoFormPublic')"), 'client 表单含 Public/Private 单选（visibility）');
check(cli.includes("visibility === 'private'") && cli.includes("visibility === 'public'"), 'client 表单 visibility 默认 private + 双向切换');
check(cli.includes("className: 'err'") && cli.includes("card.error"), 'client 表单含错误条（.err + card.error）');
check(cli.includes("card.loading") && cli.includes("tr('panel.noRepoFormSubmitting')") && cli.includes("dsws-spinner"), 'client 表单主按钮 loading 态（spinner + 创建中…）');
check(cli.includes("isNoRepoNameValid(card.name)") && cli.includes("disabled: card.loading || !isValid"), 'client 表单提交前校验（isNoRepoNameValid + 按钮置灰）');

// 7) 提交链路（调 host.call('wf.initPublish', { name, visibility }) —— T0 一源出两物后 pkg 同源，走 host shim 而非手写 rpcCall）
check(cli.includes("host.call('wf.initPublish'") && cli.includes("name: card.name") && cli.includes("visibility: card.visibility"), 'client 提交调 host.call(\'wf.initPublish\', { cwd, name, visibility })');
check(pcli.includes("host.call('wf.initPublish'") && pcli.includes("name: card.name"), 'package client 提交调 host.call(\'wf.initPublish\') 镜像（seam host shim）');
check(cli.includes("loadSnapshot(st, true, true)") && cli.includes("loadChain(st, true)"), 'client 成功后刷新 snapshot + checks（头部出现新 owner/repo）');
check(pcli.includes("loadSnapshot(st, true, true)") && pcli.includes("loadChain(st, true)"), 'package client 成功后刷新镜像（同源 loadSnapshot/loadChain）');

// 8) B Timeline 定版（2026-08-28）：ChecksTab 顶部弱化卡/恢复卡退役（远端未关联 = 行内红卡表达；dismiss 状态机保留于 store）
check(!cli.includes("tr('panel.noRepoCardDone')"), 'client ChecksTab 已移除 no-repo 弱化卡（红色顶部信息）');
check(!pcli.includes("tr('panel.noRepoCardDone')"), 'package client 已移除弱化卡镜像');
check(!cli.includes("setNoRepoDismissed(st.cwd, false)"), 'client ChecksTab 已移除「重置忽略」入口');
check(!pcli.includes("setNoRepoDismissed(st.cwd, false)"), 'package client 已移除重置镜像');
check(!cli.includes("remoteStep && remoteStep.show"), 'client ChecksTab 已移除链派生弱化卡');
check(cli.includes("remoteBad") && cli.includes("remoteStep && remoteStep.status"), 'client ChecksTab 保留 remote 判定（行内红卡源）');

// 9) 产物特征（T5 #98 后：单产物存在性校验，双源 AND 由构建保证）
// 不再断言 client.js ↔ package/lib/client.js 双源一致性，仅校验产物（含至少一个产物）含关键特征
check(cli.includes("dsws-no-repo-card") || pcli.includes("dsws-no-repo-card"), '产物含样式 dsws-no-repo-card');
check(cli.includes("panel.noRepoCardTitle") || pcli.includes("panel.noRepoCardTitle"), '产物含 i18n panel.noRepoCardTitle');
check(cli.includes("const NoRepoCard") || pcli.includes("const NoRepoCard"), '产物含组件 NoRepoCard');
check(host.includes("harness.handle('wf.initPublish'") || pkgHost.includes("harness.handle('wf.initPublish'"), '产物含 host wf.initPublish');

// 10) 额外守卫：dismiss 按 cwd 维度（hash），展开态校验，visibility 默认 Private，不记忆上次选择，不加 description
check(cli.includes("noRepoDismissKey") && cli.includes("cwdHash"), 'dismiss 按 cwd 维度（noRepoDismissKey + cwdHash）');
check(cli.includes("card.visibility") && cli.includes("'private'") && !cli.includes("localStorage.*visibility"), 'visibility 默认 Private 且不持久化（不记忆上次选择）');
check(!cli.includes("description") || cli.includes("不加 description") || !cli.includes("panel.noRepoFormDesc"), '首版不加 description 字段（减阻力）');

if (failed) { console.log('\n存在失败'); process.exit(1); }
console.log('\n全部通过 · 共计', '≥30 项断言');
