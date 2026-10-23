import { aggregateByDay, mergeHistory, withZeroStart } from '../scripts/star-history.mts';
import { buildSvg, monotonePath } from '../scripts/generate-star-history-svg.mts';
import assert from 'node:assert/strict';

// —— 聚合与合并 ——
assert.deepEqual(aggregateByDay([]), [], 'empty');
assert.deepEqual(aggregateByDay(['2026-08-17T03:19:47Z','2026-08-17T10:00:00Z']), [{date:'2026-08-17',total:2,daily:2}]);
const sample: string[]=['2026-08-17T03:19:47Z','2026-08-19T07:53:02Z','2026-08-19T09:11:17Z','2026-08-20T05:24:04Z','2026-08-20T15:21:41Z','2026-08-22T07:53:52Z','2026-08-22T09:58:44Z'];
assert.deepEqual(aggregateByDay(sample), [{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2},{date:'2026-08-22',total:7,daily:2}]);
const existing=[{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2}];
const next=[{date:'2026-08-20',total:5,daily:2}];
assert.deepEqual(mergeHistory(existing,next), [{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2}]);
const full=[{date:'2026-08-17',total:1,daily:1},{date:'2026-08-19',total:3,daily:2},{date:'2026-08-20',total:5,daily:2}];
assert.deepEqual(mergeHistory(existing,full), full);

// —— SVG 生成：确定性、单标题、双主题、双 Y 轴、完整坐标 ——
const days: Array<{date: string, total: number, daily: number}>=[
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
assert.ok(dark1.includes('>Total Stars<') && dark1.includes('>Daily New<'),'both axes must carry a horizontal title');
assert.ok(!dark1.includes('rotate('),'axis titles must stay horizontal; nobody should have to tilt their head to read them');
assert.ok(dark1.includes('data-axis="total"') && dark1.includes('data-axis="daily"'),'each axis spine must be drawn in its own series colour');
assert.ok(dark1.includes('fill="#38bdf8"'),'right-axis ticks must be drawn in the daily colour');
// —— 刻度数字的配色：两列各用系列色，并且每套主题里一个系列只有一个色值 ——
// 左列红字描述 Total、右列蓝字描述 Daily；曲线、轴线、轴名、刻度、峰值标注共用这个色值，
// 不再出现「曲线鲜红、文字深红」两套色板（浅色主题整体压深后，小字对比度才过 AA）。
assert.ok(dark1.includes('text-anchor="end" font-size="13" fill="#ff6b6b" data-axis="total"'),'left tick labels must be drawn in the total colour');
assert.ok(dark1.includes('text-anchor="start" font-size="13" fill="#38bdf8" data-axis="daily"'),'right tick labels must be drawn in the daily colour');
assert.ok(!dark1.includes('text-anchor="end" font-size="13" fill="#9aa3b2"'),'left tick labels must not fall back to the neutral grey');
assert.ok(light.includes('fill="#b93a34"') && light.includes('stroke="#b93a34"') && light.includes('fill="#1d4ed8"') && light.includes('stroke="#1d4ed8"'),'light theme: curve, axis and labels must share the darker palette (WCAG AA for 13px text)');
assert.ok(!light.includes('#d94f4f') && !light.includes('#2f81f7'),'old bright light-theme colours must be gone; one series must have exactly one colour per theme');
// 默认字色必须落在根 <svg> 的 fill 属性上、由子元素继承；写进 <style> 会盖掉所有
// 元素自己的 fill 属性（SVG 里 CSS 规则优先级高于 presentation attribute），
// 轴名染色、右轴蓝字、次要文字的灰都会悄悄失效——2026-10-21 排查「轴名染不上色」时踩过。
const styleBlock: string = (dark1.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
assert.ok(!styleBlock.includes('fill:'),'default text colour must not be set in <style>; it would override per-label fill attributes');
assert.ok(/<svg[^>]*fill="#e6edf3"/.test(dark1),'dark theme: root svg must carry the default text colour as an inherited fill attribute');
assert.ok(/<svg[^>]*fill="#24292f"/.test(light),'light theme: root svg must carry the default text colour as an inherited fill attribute');

// —— 峰值标注：两条曲线各自的最高点必须标出数字，读者一眼能读数 ——
// 用 data-peak 属性定位，避免把坐标轴刻度上的同一个数字误当成峰值标注。
assert.ok(dark1.includes('data-peak="total"'),'total curve must label its highest point');
assert.ok(dark1.includes('data-peak="daily"'),'daily curve must label its highest point');
const totalPeak: string = (dark1.match(/data-peak="total">(\d+)<\/text>/) || [])[1] || '';
const dailyPeak: string = (dark1.match(/data-peak="daily">(\d+)<\/text>/) || [])[1] || '';
assert.equal(totalPeak,'5','total peak label must show the max total (5), not an axis tick');
assert.equal(dailyPeak,'2','daily peak label must show the max daily count (2)');
assert.ok(light.includes('data-peak="total"') && light.includes('data-peak="daily"'),'both themes must carry the peak labels');

// —— 每日新增曲线：平滑、拐点无折角，但每段都不许越过两端取值 ——
// 平滑是为了手绘观感；不越界是为了不造假峰（Catmull-Rom 会在两个低点之间冲高）。
const dailyPath = (dark1.match(/d="([^"]+)" fill="none" stroke="#38bdf8"/) || [])[1] || '';
assert.ok(dailyPath.includes('C'),'daily curve must be a smooth path (C segments), not a polyline');
assert.ok(!dailyPath.includes(' L '),'daily curve must not fall back to sharp polyline corners');
const zig: number[][] = [[0,100],[40,60],[80,100],[120,20],[160,80]];
const mp: string = monotonePath(zig);
const segs: number[][] = mp.split('C').slice(1).map((s): number[] => s.trim().split(/[\s,]+/).map(Number));
assert.equal(segs.length, zig.length - 1,'one cubic segment between each pair of points');
segs.forEach((nums: number[], i: number) => {
  const lo: number = Math.min(zig[i][1], zig[i+1][1]), hi: number = Math.max(zig[i][1], zig[i+1][1]);
  for (let k = 1; k < nums.length; k += 2) assert.ok(nums[k] >= lo - 1e-6 && nums[k] <= hi + 1e-6,`segment ${i+1} control point leaves its two endpoints' value range, which would fake a peak`);
});
// 相邻两段在拐点处的切线要一致，否则拐点就是一个尖角。
for (let i = 0; i < segs.length - 1; i++) {
  const a: number[] = segs[i], b: number[] = segs[i+1];
  const slopeIn: number = (a[5] - a[3]) / (a[4] - a[2]);
  const slopeOut: number = (b[1] - a[5]) / (b[0] - a[4]);
  assert.ok(Math.abs(slopeIn - slopeOut) < 0.1,`knot ${i+1} is a sharp corner: incoming slope ${slopeIn} vs outgoing ${slopeOut}`);
}

assert.deepEqual(withZeroStart([]), [], 'empty stays empty');
assert.deepEqual(withZeroStart([{date:'2026-08-17',total:2,daily:2}]), [{date:'2026-08-16',total:0,daily:0},{date:'2026-08-17',total:2,daily:2}]);
assert.deepEqual(withZeroStart([{date:'2026-08-16',total:0,daily:0},{date:'2026-08-17',total:2,daily:2}]), [{date:'2026-08-16',total:0,daily:0},{date:'2026-08-17',total:2,daily:2}], 'idempotent');

console.log('verify-star-history: all passed');
