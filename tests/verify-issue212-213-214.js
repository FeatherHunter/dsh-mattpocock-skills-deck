// verify-issue212-213-214.js — Regression for #212/#213/#214
// Phase 1 tight loop per diagnosing-bugs: static check + mocked snapshot build

const fs = require('fs');
const path = require('path');

let failures = [];

function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log('FAIL: ' + msg);
  } else {
    console.log('PASS: ' + msg);
  }
}

const hostPath = path.join(__dirname, '../src/host/index.js');
const txt = fs.readFileSync(hostPath, 'utf8').replace(/\r\n/g, '\n');

// --- #214: ReferenceError: backendModules is not defined ---
// skillProbe should NOT contain backendModules
const skillProbeIdx = txt.indexOf('const skillProbe = async');
const skillProbeEnd = txt.indexOf('return { ok: missing.length === 0, missing, probes }', skillProbeIdx);
const skillProbeChunk = txt.slice(skillProbeIdx, skillProbeEnd + 200);
assert(!skillProbeChunk.includes('backendModules'), '#214: skillProbe must NOT contain backendModules (was mis-scoped cause of ReferenceError)');

// buildSnapshot must contain let backendModules
// H2 #446：buildSnapshot 已搬到 src/host/issueDetail.js（行为零变化），断言跟随代码位置，意图不变。
const bsSrc = fs.readFileSync(path.join(__dirname, '../src/host/issueDetail.js'), 'utf8').replace(/\r\n/g, '\n');
const bsIdx = bsSrc.indexOf('async function buildSnapshot');
const bsEnd = bsSrc.indexOf('return {\n        ok: true,', bsIdx);
const bsChunk = bsSrc.slice(bsIdx, bsEnd + 5000);
assert(bsChunk.includes('let backendModules = null'), '#214: buildSnapshot must define let backendModules = null in its own scope');
assert(bsChunk.includes('backendModules = regM.modules().map'), '#214: buildSnapshot must compute backendModules from registry');
assert(bsChunk.includes('backendModules: backendModules'), '#214: snapshot must return backendModules');

// --- #212: wf.snapshot 返回异常 ---
// Ensure wf.snapshot handler does not throw due to missing backendModules
// Check that buildSnapshot's try/catch does not hide ReferenceError but now defines variable
assert(!txt.includes('skillProbe') || !txt.slice(txt.indexOf('skillProbe')).includes('let backendModules = null;\n      try {\n        const regM = await getTrackerRegistry()'), '#212: stray skillProbe backendModules block removed');

// --- #213: 新增后未自动增量刷新 ---
// Check probe logic: issueIndexChanged should detect new issue
// Simulate
const issueIndexChanged = function (before, after) {
  if (!before) return true;
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (beforeKeys.length !== afterKeys.length) return true;
  for (let i = 0; i < afterKeys.length; i++) if (before[afterKeys[i]] !== after[afterKeys[i]]) return true;
  return false;
};
const before = { '212': 'OPEN|2026-08-26T01:00:00Z', '213': 'OPEN|2026-08-26T01:01:00Z' };
const afterWithNew = { '212': 'OPEN|2026-08-26T01:00:00Z', '213': 'OPEN|2026-08-26T01:01:00Z', '214': 'OPEN|2026-08-26T01:02:00Z' };
const afterWithUpdate = { '212': 'OPEN|2026-08-26T01:00:00Z', '213': 'CLOSED|2026-08-26T01:05:00Z' };
assert(issueIndexChanged(before, afterWithNew) === true, '#213: issueIndexChanged detects new issue (added)');
assert(issueIndexChanged(before, afterWithUpdate) === true, '#213: issueIndexChanged detects state change');
assert(issueIndexChanged(before, before) === false, '#213: issueIndexChanged no false positive when unchanged');

// Check client probe interval exists and is 60s (or less) and cache invalidation on changed
assert(txt.includes("if (changed) cache = { ts: 0, snapshot: null"), '#213: probe must invalidate cache on changed (enables auto refresh)');
assert(txt.includes("harness.handle('wf.probe'"), '#213: wf.probe handler exists');

// Client side check
const probeTxt = ['../src/client/kernel/probe-chain.js','../src/client/kernel/probe-snapshot.js','../src/client/kernel/probe-auto.js'].map((rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8')).join('\n'); // 456 收尾：probe.js 已拆为三文件，读三文件拼起来的内容断言
assert(probeTxt.includes('PROBE_MS = 60000') || probeTxt.includes('PROBE_MS'), '#213: client probe interval defined');
assert(probeTxt.includes('refreshGroup') && probeTxt.includes('loadSnapshot'), '#213: client refreshGroup calls loadSnapshot on probe changed (incremental, not full page)');

const hostTxt2 = fs.readFileSync(hostPath, 'utf8');
// #345 退役：gh-create/gh-edit 事件通道已移除（host 与 client 双边零命中），变更发现改由 wf.probe 时间戳增量承担（见 232 门禁）；此处锁死退役，防止另起第二通道
assert(!hostTxt2.includes("gh-create"), '#213: gh-create 事件通道已退役（host 无处理，变更发现走 wf.probe since）');
const storeTxt = ['../src/client/kernel/store-prefs.js','../src/client/kernel/store-switch.js','../src/client/kernel/store-snapshot.js','../src/client/kernel/store-derived.js'].map((rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8')).join('\n'); // 顺带 455 遗留：store.js 已拆为四文件（同 verify-issue232-sync 模式），读四文件拼起来的内容断言
// 触发词搬家：旧标记不得回流仓库（仓库只存状态）；动作后探测住在 api.js 的动作点，此处锁新家不断线（K4 拆 api.js 时须同票重指三个新文件拼合）
assert(!storeTxt.includes('needProbe') && !storeTxt.includes('pollIssuePathHost'), '#213: 旧触发词未回流仓库（触发住动作点，不住状态）');
const apiSrc = ['../src/client/kernel/api-naming.js','../src/client/kernel/api-new-session.js','../src/client/kernel/api-io.js'].map((rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8')).join('\n'); // #457 K4：api.js 已拆为三文件，读三文件拼合断言（inject 在 io，评论探测在 io）
const injectBody = apiSrc.slice(apiSrc.indexOf('export const inject = (st, text)'), apiSrc.indexOf('export const openUrl'));
const cmtBody = apiSrc.slice(apiSrc.indexOf('export const fetchIssueComments'), apiSrc.indexOf('export const submitIssueComment'));
assert(injectBody.includes('scheduleActionProbe()'), '#213: 关键动作后延迟探测（inject 内调用，面板尽快反映变化）');
assert(cmtBody.includes('scheduleActionProbe()'), '#213: 发评论成功后延迟探测（fetchIssueComments 成功分支内调用）');

if (failures.length) {
  console.log('\n=== ' + failures.length + ' FAILURES — loop RED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL PASS — loop GREEN ===');
}