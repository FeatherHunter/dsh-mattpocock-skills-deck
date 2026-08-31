// verify-bug-366-refresh.js — Regression guard for #366 (refreshAll visual not updating)
// Run: node tests/verify-bug-366-refresh.js
const fs = require('fs');
let failed = false;
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };
const probe = fs.readFileSync('src/client/kernel/probe.js', 'utf8');
check(probe.includes('_shouldReuse = !force || _pend.force === true'), 'probe dedup distinguishes force');
check(probe.includes('force: !!force'), 'pending entry stores force flag');
check(probe.includes('cur && cur.promise===p'), 'pending delete is safe');
check(probe.includes('#366'), 'probe contains #366 marker');
check(probe.includes('强制刷新后扇出到同工作区全组'), 'refreshAll contains fan-out');
check(probe.includes('diffSnapshots(st2.snapshot, newSnap)'), 'fan-out computes diff');
check(probe.includes('st2.snapshot = newSnap') && probe.includes('emit(st2)'), 'fan-out copies snapshot');
const host = fs.readFileSync('src/host/index.js', 'utf8');
const pattern = 'const diskb = await readDiskCache(repo0b)';
const count = (host.match(new RegExp(pattern.replace(/[.*+?^$\{|}()[\]]/g, '\\$&'), 'g')) || []).length;
check(count === 1, 'host disk cache check appears once, found ' + count);
check(host.includes('#366 fix: wf.refresh must bypass disk cache'), 'host contains #366 bypass');
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
