// tests/verify-967-measure.js —— 967 量测小件的门禁（只读量测，不改业务）。
// 用法：在插件根目录执行 node tests/verify-967-measure.js，可独立运行。
// 量测的接缝是三个纯函数（耗时分布、在飞分布、触发源排行、复用数），只看算出来的数，不看内部队列数组长什么样。
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = false;
let total = 0;
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };

console.log('967 量测小件门禁（耗时分布与同时在飞分布有据、触发源排行指明最多一路、只读数不改业务）');

let mod = null;
try {
  mod = require('../scripts/measure-967-outbound.js');
  check(!!mod, '量测脚本可以被测试引用到');
} catch (e) {
  check(false, '量测脚本可以被测试引用到（缺文件或引出失败：' + ((e && e.message) || e) + '）');
}
if (mod) {
  // 耗时分布：用事先算好的一组数，期望值是手算的字面量，不是代码重算一遍。
  try {
    const r = mod.summarizeLatencies([10, 20, 30, 40, 50]);
    check(r.count === 5, '耗时分布报得出条数（5 条）');
    check(r.min === 10 && r.max === 50, '耗时分布报得出最小与最大（10 与 50）');
    check(r.p50 === 30, '耗时分布中间值是 30（手算中间）');
    check(r.buckets['100毫秒以内'] === 5, '耗时分布 5 条全落在 100 毫秒以内那一桶');
  } catch (e) { check(false, '耗时分布小例子能算（' + ((e && e.message) || e) + '）'); }
  // 超时边界：31 秒那条必须落在超时那一桶，12 秒那条落在慢桶。
  try {
    const r2 = mod.summarizeLatencies([50, 12000, 31000]);
    check(r2.buckets['30秒超时'] === 1, '耗时分布 31 秒那条落在超时桶');
    check(r2.buckets['2秒到12秒'] === 1, '耗时分布 12 秒那条落在慢桶');
    check(r2.p95 === 31000, '耗时分布 95 分位是 31000（三个数里最大）');
  } catch (e) { check(false, '耗时分布超时边界能算（' + ((e && e.message) || e) + '）'); }
  // 同时在飞分布：给一组同时在飞采样，期望最大值与中间值是手算的。
  try {
    const f = mod.summarizeInflight([1, 2, 3, 20, 4]);
    check(f.max === 20, '同时在飞最大值是 20（采样里最大）');
    check(f.p50 === 3, '同时在飞中间值是 3（排序后中间）');
    check(f.count === 5, '同时在飞采样条数是 5');
  } catch (e) { check(false, '同时在飞分布能算（' + ((e && e.message) || e) + '）'); }
  // 触发源排行：给三处字面出现次数，期望指明最多的一路是检查页。
  try {
    const rank = mod.rankForceSources([
      { file: 'src/client/views/ChecksTab.js', line: 91 },
      { file: 'src/client/views/ChecksTab.js', line: 92 },
      { file: 'src/client/views/ChecksTab.js', line: 93 },
      { file: 'src/client/statusbar/bannerChain.js', line: 165 },
      { file: 'src/client/statusbar/bannerChain.js', line: 217 },
      { file: 'src/client/views/NoRepoCard.js', line: 91 },
    ]);
    check(rank.length === 3, '触发源排行按文件聚出 3 路');
    check(rank[0].file === 'src/client/views/ChecksTab.js' && rank[0].count === 3, '触发源最多的一路是检查页那一路（3 次）');
  } catch (e) { check(false, '触发源排行能算（' + ((e && e.message) || e) + '）'); }
  // 复用数：问 5 条复用 2 条，省掉 4 成。
  try {
    const u = mod.summarizeReuse(5, 2);
    check(u.asked === 5 && u.reused === 2, '复用数报得出问了几条与省掉几条（5 问 2 省）');
    check(u.savedRatio === 0.4, '复用数省掉比例是 4 成（手算 2 除以 5）');
  } catch (e) { check(false, '复用数能算（' + ((e && e.message) || e) + '）'); }
}
console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'));
process.exit(failed ? 1 : 0);
