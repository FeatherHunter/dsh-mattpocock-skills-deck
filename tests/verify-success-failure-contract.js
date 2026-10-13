// verify-success-failure-contract.js — 后端声明的失败文案真源 + 界面词条键（文案门）
// 用法: node tests/verify-success-failure-contract.js
// 断言形态：词条源里那几档文案键是否齐全、中文文案是否非空（zh + en 双源跟界面语言）
const fs = require('fs');
const cli = fs.readFileSync('client.js', 'utf8');
const pcli = fs.readFileSync('package/lib/client.js', 'utf8');
const ghSrc = fs.readFileSync('src/tracker/rooms/github/index.ts', 'utf8');
let failed = false;
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };

// 6) 后端文案真源：9 档 + half-created（中文/English）
// #993/#994：新增 git-ownership（git 属主不符）与 unknown（认不出来的 git 错误）两档，档位表要跟着加，否则面板这两类失败没有可显示的中英文文案。
const kinds = ['bad-name', 'no-git', 'no-gh', 'not-logged-in', 'already-exists', 'network', 'permission', 'git-ownership', 'unknown', 'half-created'];
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
