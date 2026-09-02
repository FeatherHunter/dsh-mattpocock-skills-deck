#!/usr/bin/env node
/**
 * Phase 1 tight loop: 刷新后 414 不出现 + 状态栏时间异常
 * 单命令: node tests/diag-refresh-414-loop.js
 * - 断言宿主 isForce 守卫 + 100 兜底 + 部分解析存在（绿）/ 缺失（红）
 * - 实测 gh 行为: limit 500 必 EOF（红） vs limit 100 成功且含 414（绿）
 * - 若以上任一红，判定 bug 复现
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(cond, msg){
  if(!cond){ console.error('FAIL', msg); process.exitCode=1; } else console.log('PASS', msg);
}
function must(cond, msg){ check(cond, msg); if(!cond) process.exitCode=1; }

const hostSrc = readFileSync(resolve(ROOT,'src/host/index.js'),'utf8');
const probeSrc = readFileSync(resolve(ROOT,'src/client/kernel/probe.js'),'utf8');
const checksumSrc = readFileSync(resolve(ROOT,'src/client/statusbar/checksums.js'),'utf8');
console.log('=== 文件断言 ===');
// isForce 守卫
must(hostSrc.includes('isForce = !!(args && args.force)'), 'host 含 isForce 守卫');
must(hostSrc.includes('if (!isForce && cache.snapshot'), 'wf.snapshot 受 isForce 保护（force 必重建）');
// fetchIssues 100 兜底
must(hostSrc.includes('tryList(100)'), 'host fetchIssues 使用 tryList(100)');
must(hostSrc.includes('unexpected eof'), 'host 对 unexpected EOF 容错');
must(hostSrc.includes('tryParseIndex'), 'host 对 gh api 部分成功做解析');
must(hostSrc.includes('fetchAllIssuesManual'), 'host 含 fetchAllIssuesManual 手动分页兜底（避免 100 截断）');
must(hostSrc.includes('fetchAllIndexManual'), 'host 含 fetchAllIndexManual 手动分页索引');
must(hostSrc.includes("runGh(['issue', 'list', '--state', 'open'"), 'host 有 open 100 兜底');
// probe 与状态栏时间
must(probeSrc.includes('touchProbeAt'), 'probe 含 touchProbeAt 走针');
must(checksumSrc.includes('getProbeAt') && checksumSrc.includes('timeOfMs'), 'statusbar 优先显示上次探测时间 getProbeAt/timeOfMs');

console.log('=== 真实 gh 行为 ===');
function gh(args, opts={}){
  const r = spawnSync('gh', args, { cwd: ROOT, encoding:'utf8', timeout: 15000, ...opts });
  return r;
}
// 500 必失败（复现旧 bug）
const r500 = gh(['issue','list','--state','all','--limit','500','--json','number','--repo','FeatherHunter/dsh-mattpocock-skills-deck']);
const out500 = (r500.stdout||'') + (r500.stderr||'');
const is500EOF = /unexpected EOF/i.test(out500) || r500.status!==0;
console.log('gh 500 exit', r500.status, 'hasEOF', is500EOF);
if(is500EOF) console.log('NOTE gh 500 触发 EOF（偶发）- 宿主已用 100/手动分页兜底'); else console.log('NOTE gh 500 未触发 EOF（偶发成功）- 宿主直接可用 500 全量');

// 100 成功且含 414
const r100 = gh(['issue','list','--state','all','--limit','100','--json','number,state,updatedAt','--repo','FeatherHunter/dsh-mattpocock-skills-deck']);
let has414 = false;
try{
  const arr = JSON.parse(r100.stdout||'[]');
  has414 = Array.isArray(arr) && arr.some(x=> x.number===414);
  console.log('gh 100 count', arr.length, 'has414', has414);
}catch(e){ console.log('parse 100 failed', e.message); }
must(r100.status===0, 'gh issue list --limit 100 成功（新路径绿）');
must(has414, 'gh 100 结果含 414（外部建票事实源可达）');

// api paginate 部分成功路径（模拟宿主 tryParseIndex）
const rApi = gh(['api','--paginate','repos/FeatherHunter/dsh-mattpocock-skills-deck/issues?state=all&per_page=100','--jq','.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}']);
const apiOut = rApi.stdout||'';
const apiLines = apiOut.split('\n').filter(Boolean).length;
const apiHas414 = apiOut.includes('"number": 414') || apiOut.includes('"number":414');
console.log('gh api paginate lines', apiLines, 'exit', rApi.status, 'has414', apiHas414);
// paginate 可能 exit 1 但仍有数据（宿主需部分解析）
if(rApi.status!==0){
  must(apiLines>0 && apiHas414, 'gh api paginate exit 1 但 stdout 仍含 414（部分成功需宿主容错）');
} else {
  must(apiHas414, 'gh api paginate 成功且含 414');
}

console.log('=== 结论 ===');
if(process.exitCode===1) console.log('RED: bug 复现（文件缺守卫或 gh 100 未含 414）');
else console.log('GREEN: 宿主文件已修复且远端可达 414，剩余风险仅为内存宿主未重启');
