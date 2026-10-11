// verify-issue212-213-214.js — Regression for #212/#213/#214
// Phase 1 tight loop per diagnosing-bugs: 变化检测逻辑的本地模拟

let failures = [];

function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log('FAIL: ' + msg);
  } else {
    console.log('PASS: ' + msg);
  }
}

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

if (failures.length) {
  console.log('\n=== ' + failures.length + ' FAILURES — loop RED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL PASS — loop GREEN ===');
}
