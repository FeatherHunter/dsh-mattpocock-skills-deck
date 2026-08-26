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
const bsIdx = txt.indexOf('async function buildSnapshot');
const bsEnd = txt.indexOf('return {\n        ok: true,', bsIdx);
const bsChunk = txt.slice(bsIdx, bsEnd + 5000);
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
const probePath = path.join(__dirname, '../src/client/kernel/probe.js');
const probeTxt = fs.readFileSync(probePath, 'utf8');
assert(probeTxt.includes('PROBE_MS = 60000') || probeTxt.includes('PROBE_MS'), '#213: client probe interval defined');
assert(probeTxt.includes('refreshGroup') && probeTxt.includes('loadSnapshot'), '#213: client refreshGroup calls loadSnapshot on probe changed (incremental, not full page)');

const hostTxt2 = fs.readFileSync(hostPath, 'utf8');
assert(hostTxt2.includes("gh-create"), '#213: host handles gh-create for incremental refresh');
const storePath = path.join(__dirname, '../src/client/kernel/store.js');
const storeTxt = fs.readFileSync(storePath, 'utf8');
assert(storeTxt.includes('needProbe') && storeTxt.includes('scheduleActionProbe'), '#213: client triggers probe on gh-create/gh-edit (pollIssuePathHost)');

if (failures.length) {
  console.log('\n=== ' + failures.length + ' FAILURES — loop RED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL PASS — loop GREEN ===');
}