import { aggregateByDay, mergeHistory } from '../scripts/star-history.mjs';
import { buildSvg } from '../scripts/generate-star-history-svg.mjs';
import assert from 'node:assert/strict';

// —— 聚合与合并 ——
assert.deepEqual(aggregateByDay([]), [], 'empty');
assert.deepEqual(aggregateByDay(['2026-08-17T03:19:47Z','2026-08-17T10:00:00Z']), [{date:'2026-08-17',total:2,daily:2}]);
const sample=['2026-08-17T03:19:47Z','2026-08-19T07:53:02Z','2026-08-19T09:11:17Z','2026-08-20T05:24:04Z','2026-08-20T15:21:41Z','2026-08-22T07:53:52Z','2026-08-22T09:58:44Z'];
assert.deepEqual(aggregateByDay(sample), [{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2},{date:'2026-08-22',total:7,daily:2}]);
const existing=[{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2}];
const next=[{date:'2026-08-20',total:5,daily:2}];
assert.deepEqual(mergeHistory(existing,next), [{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2}]);
const full=[{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2}];
assert.deepEqual(mergeHistory(existing,full), full);

// —— SVG 生成：确定性、单标题、双主题、完整坐标 ——
const days=[
  {date:'2026-08-17',total:1,daily:1},
  {date:'2026-08-19',total:3,daily:2},
  {date:'2026-08-20',total:5,daily:2},
];
const dark1=buildSvg(days,'dark');
const dark2=buildSvg(days,'dark');
const light=buildSvg(days,'light');
assert.equal(dark1,dark2,'same data must produce byte-identical SVG (no noisy Action commits)');
assert.notEqual(dark1,light,'dark and light themes must differ');
assert.equal((dark1.match(/Star History/g)||[]).length,1,'exactly one title in the chart');
assert.ok(dark1.includes('08/20'),'x axis carries date tick labels');
assert.ok(dark1.includes('5 stars · 2026-08-20'),'caption shows latest total and date');
assert.ok(dark1.includes('stroke-dasharray="6 4"'),'daily curve present');
assert.ok(dark1.includes('viewBox="0 0 840 480"'),'fixed self-contained viewport');

console.log('verify-star-history: all passed');
