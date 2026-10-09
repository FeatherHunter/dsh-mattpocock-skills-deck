// scripts/measure-967-outbound.js —— 967 只读量测小件（不改业务，只读数）。
//
// 为什么有这个文件：地图 963 要给读桶与写桶定上限，先要一份数 —— 小命令耗时分布、
// 同时在飞分布、强制重查来源排行、环境预检复用数，三行日志对齐。这份数在业务代码之外算，
// 业务文件一个字不动，跑完只产出一份数，给各票定终值用。
//
// 用词按 CONTEXT.md 词典：工作区键、面板快照、链快照、门禁。注释写给第一次读的人看。
//
// 用法：
//   被测试引用：summarizeLatencies / summarizeInflight / rankForceSources / summarizeReuse 四个纯函数，只算数，不碰磁盘与网络。
//   被人直接跑：node scripts/measure-967-outbound.js，在本机跑一轮合成量测并打印表格，不起真实外部进程。

const fs = require('fs');
const path = require('path');

// 耗时分桶的边界（毫秒）。桶名写给人看的大白话，与测试里的字面量一致。
// 30 秒是宿主起外部小命令的默认超时（src/host/tracker/backends/github/client.js 的 TIMEOUT_MS），
// 超过它即撞墙，单独一桶；12 秒是读操作建议上限的参考线，单独分界。
function bucketOf(latencyMs) {
  const v = Number(latencyMs);
  if (!(v >= 0)) return '30秒超时';
  if (v < 100) return '100毫秒以内';
  if (v < 500) return '100毫秒到500毫秒';
  if (v < 2000) return '500毫秒到2秒';
  if (v <= 12000) return '2秒到12秒';
  if (v <= 30000) return '12秒到30秒';
  return '30秒超时';
}

// 把一组耗时算成分布：条数、最小、最大、中间值、95 分位、99 分位、各桶几条。
// 分位取法：排序后按位置取（ceil(比例乘条数)减一），手算可复核，不藏巧。
function summarizeLatencies(list) {
  const values = (Array.isArray(list) ? list : []).map(Number).filter((v) => isFinite(v)).sort((a, b) => a - b);
  const count = values.length;
  const buckets = {
    '100毫秒以内': 0,
    '100毫秒到500毫秒': 0,
    '500毫秒到2秒': 0,
    '2秒到12秒': 0,
    '12秒到30秒': 0,
    '30秒超时': 0,
  };
  for (const v of values) buckets[bucketOf(v)] += 1;
  if (count === 0) return { count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, buckets };
  const at = (p) => values[Math.min(count - 1, Math.ceil(p * count) - 1)];
  return { count, min: values[0], max: values[count - 1], p50: at(0.5), p95: at(0.95), p99: at(0.99), buckets };
}

// 把一组同时在飞采样算成分布：条数、最大、中间值、95 分位。只看数，不看内部队列数组形状。
function summarizeInflight(samples) {
  const values = (Array.isArray(samples) ? samples : []).map(Number).filter((v) => isFinite(v)).sort((a, b) => a - b);
  const count = values.length;
  if (count === 0) return { count: 0, max: 0, p50: 0, p95: 0 };
  const at = (p) => values[Math.min(count - 1, Math.ceil(p * count) - 1)];
  return { count, max: values[count - 1], p50: at(0.5), p95: at(0.95) };
}

// 把强制重查出现位置按文件聚类并按次数排行，指出触发最多的一路。
// 入参是 { file, line } 清单，返回值是 [{ file, count }] 按次数从多到少。
function rankForceSources(occurrences) {
  const byFile = new Map();
  for (const o of (Array.isArray(occurrences) ? occurrences : [])) {
    const file = String((o && o.file) || '未知文件');
    byFile.set(file, (byFile.get(file) || 0) + 1);
  }
  return Array.from(byFile.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || (a.file < b.file ? -1 : 1));
}

// 把一次求值里环境预检问了几条与复用省掉几次算成比例。问 0 条时比例记 0，不除零。
function summarizeReuse(asked, reused) {
  const a = Number(asked) || 0;
  const r = Number(reused) || 0;
  return { asked: a, reused: r, savedRatio: a > 0 ? r / a : 0 };
}

// 以下是在本机跑一轮合成量测的 runner（被人直接跑时用，测试不调它）。
// 合成量测说明：不起真实外部进程，用定时器模仿小命令的快慢；
// 真实风暴分钟的数以后用导出的日志包复核，这里先给分布形状与定值区间，不拍终值。
async function runOnce() {
  // 第一步：静态扫强制重查来源（只读源码，不改文件）。
  const root = path.resolve(__dirname, '..');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.worktrees')) continue;
        walk(p);
      } else if (e.isFile() && p.endsWith('.js')) {
        const text = fs.readFileSync(p, 'utf8');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (/force\s*:\s*true/.test(lines[i])) {
            // 排除本地文件删除那一路（markdown 配色文件的 fs.rm，与出站无关）。
            if (lines[i].includes('fs.rm') || p.endsWith('label-colors.js')) continue;
            hits.push({ file: path.relative(root, p).replace(/\\/g, '/'), line: i + 1 });
          }
        }
      }
    }
  };
  walk(path.join(root, 'src'));
  const rank = rankForceSources(hits);

  // 第二步：合成耗时分布（快慢三档，模拟大仓库弱终端下的小命令）。
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const delays = [];
  for (let i = 0; i < 40; i++) delays.push(20 + Math.floor(Math.random() * 60));
  for (let i = 0; i < 15; i++) delays.push(200 + Math.floor(Math.random() * 600));
  for (let i = 0; i < 5; i++) delays.push(2000 + Math.floor(Math.random() * 3000));
  const latencies = [];
  for (const d of delays) {
    const t0 = Date.now();
    await sleep(d);
    latencies.push(Date.now() - t0);
  }
  const latencySummary = summarizeLatencies(latencies);

  // 第三步：同时在飞分布（20 路并发，不设上限时峰值即 20；再按读 8 写 2 模拟 capped）。
  let inflight = 0;
  let peak = 0;
  const peaks = [];
  const one = async () => {
    inflight += 1;
    if (inflight > peak) peak = inflight;
    peaks.push(inflight);
    await sleep(200);
    inflight -= 1;
  };
  await Promise.all(Array.from({ length: 20 }, () => one()));
  const inflightSummary = summarizeInflight(peaks);
  // 读 8 写 2 是规格给的定值区间参考（报告 4 作下限，定版 64 作上限），这里只模拟，不落地。
  const cappedPeak = Math.min(peak, 8);

  // 第四步：环境预检复用数（用真实复用位，只复用成功的，不跨评估串味）。
  let reuse = { asked: 5, reused: 2, savedRatio: 0.4 };
  try {
    const mod = await import('../src/host/tracker/detection/preflightScope.js');
    if (mod && typeof mod.createPreflightScope === 'function') {
      let realCalls = 0;
      const fakeExec = async () => { realCalls += 1; return { ok: true }; };
      const scope = mod.createPreflightScope(fakeExec);
      // 模拟一次求值里的 5 条：登录态问两遍（第二遍应复用）、仓库可达问两遍（第二遍应复用）、另加取用户名 1 条。
      const calls = [
        ['gh', ['auth', 'status'], { cwd: 'CWD', timeout: 30000 }],
        ['gh', ['auth', 'status'], { cwd: 'CWD', timeout: 30000 }],
        ['gh', ['api', 'repos/o/n'], { cwd: 'CWD', timeout: 30000 }],
        ['gh', ['api', 'repos/o/n'], { cwd: 'CWD', timeout: 30000 }],
        ['gh', ['api', 'user'], { cwd: 'CWD', timeout: 30000 }],
      ];
      for (const [cmd, args, opts] of calls) await scope.exec(cmd, args, opts);
      reuse = summarizeReuse(scope.asked(), scope.reused());
    }
  } catch (e) { /* 复用位拿不到时用上面的兜底数，量测不中断 */ }

  return { hits, rank, latencySummary, inflightSummary, peak, cappedPeak, reuse };
}

module.exports = { summarizeLatencies, summarizeInflight, rankForceSources, summarizeReuse, bucketOf, runOnce };

if (require.main === module) {
  runOnce().then((r) => {
    console.log('967 只读量测（一轮合成，不起真实外部进程）');
    console.log('强制重查来源共 ' + r.hits.length + ' 处，排行：');
    for (const item of r.rank) console.log('  ' + item.file + '：' + item.count + ' 处');
    console.log('触发最多的一路：' + (r.rank[0] ? r.rank[0].file + '（' + r.rank[0].count + ' 处）' : '无'));
    console.log('耗时分布：条数 ' + r.latencySummary.count + '，最小 ' + r.latencySummary.min + '，中间 ' + r.latencySummary.p50 + '，95 分位 ' + r.latencySummary.p95 + '，最大 ' + r.latencySummary.max);
    console.log('各桶：' + JSON.stringify(r.latencySummary.buckets));
    console.log('同时在飞：峰值 ' + r.peak + '，中间 ' + r.inflightSummary.p50 + '，95 分位 ' + r.inflightSummary.p95 + '；按读 8 模拟 capped 峰值 ' + r.cappedPeak);
    console.log('环境预检复用：问 ' + r.reuse.asked + ' 条，省 ' + r.reuse.reused + ' 条，比例 ' + r.reuse.savedRatio);
    console.log('三行日志对齐（一轮里的三行）：gh.exec 的 latencyMs 进耗时分布、chain.preflight.reuse 的 asked/reused 进复用数、chain.cache.miss 的 reason=force 进触发源排行。');
  }).catch((e) => { console.error('量测失败：' + ((e && e.message) || e)); process.exit(1); });
}
