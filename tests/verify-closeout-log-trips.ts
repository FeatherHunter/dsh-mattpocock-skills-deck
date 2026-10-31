// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshotEnvelope.ts
//
// 规格 #1681 收口（票 #1700）的五类输入日志五段门禁。
//
// 它守的是「只看本地诊断日志能不能说清这一趟走到哪一步」：降级、截断、部分失败、并发、重启
// 五类输入各真跑一趟（真的房间读代码、真的快照缓存），每趟必须找齐五段——
//   ① 起点输入摘要：这一趟从哪来、参数是什么（snapshot.request / graphql.fallback 的 scope）
//   ② 分支原因：为什么走这条分支（graphql.fallback.reason / snapshot.cache.miss.reason）
//   ③ 外部调用结果加耗时：等外部等了多久（fallback.chain.latencyMs / snapshot.built.latencyMs）
//   ④ 状态变化：进去前后变了什么（issues.fallback.from→to / dedup.hit / 回执 fromCache）
//   ⑤ 终点结论：这一趟最后得到什么（read.degraded 的 op+reason / 回执 ok 与 truncated）
// 每段都写成一条断言：少一段就红，少一类输入也红。状态段允许由回执字段承载（截断是成功回包，
// 按日志纪律不记错误行），这一点在本文件与收口文档第 5 节都写明。
//
// 负例：test-the-test 时临时拆掉 issues.ts 的 list:partial 行 → 截断趟判红；拆掉降级事件 → 降级趟判红。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { printGateResult } from './lib/gate-result.ts';

const GATE = 'verify-closeout-log-trips';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let total = 0;
let failed = 0;
function check(cond: any, message: string, detail?: any): boolean {
  total += 1;
  if (cond) { console.log('PASS ' + message); return true; }
  failed += 1;
  console.log('FAIL ' + message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  return false;
}
function finite(n: any): boolean { return typeof n === 'number' && isFinite(n); }
function findLog(logs: any[], event: string, pred?: (l: any) => boolean): any {
  return logs.filter((l) => l.event === event && (!pred || pred(l)))[0] || null;
}
// 五段核对：每段一条断言。名字里带段名，红了能直接看出缺哪一段。
function fiveSegments(trip: string, segs: { input: any; reason: any; external: any; state: any; conclusion: any }) {
  check(!!segs.input, trip + ' / ①起点输入摘要段', segs.input === false ? '没有起点输入日志' : undefined);
  check(!!segs.reason, trip + ' / ②分支原因段', segs.reason === false ? '没有分支原因日志' : undefined);
  check(!!segs.external, trip + ' / ③外部调用结果加耗时段', segs.external === false ? '没有外部调用耗时' : undefined);
  check(!!segs.state, trip + ' / ④状态变化段', segs.state === false ? '没有状态变化载体' : undefined);
  check(!!segs.conclusion, trip + ' / ⑤终点结论段', segs.conclusion === false ? '没有终点结论载体' : undefined);
}

async function main() {
  const { createOutboundControl } = await imp('src/refresh/rooms/host/outbound-control.ts');
  const { listIssues, getIssue } = await imp('src/tracker/rooms/github/read/issues.ts');
  const repo = { refId: 'example/repo', name: 'example/repo' };

  // ---------- T1 降级：GraphQL 挂、REST 全量 ----------
  {
    const rows: any[] = [];
    for (let n = 1; n <= 150; n += 1) rows.push({ number: n, title: 'issue ' + n, state: 'open', labels: [{ name: 'bug' }], user: { login: 'tester' }, html_url: 'https://github.com/example/repo/issues/' + n });
    const logs: any[] = [];
    const ctx: any = {
      cwd: ROOT,
      outbound: createOutboundControl(),
      platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) },
      logEvent: (level: string, event: string, fields: any) => logs.push({ level, event, fields }),
      exec: async (cmd: string, args: any[]) => {
        const joined = (args || []).join(' ');
        if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' };
        if (joined.includes('/issues?state=all')) {
          const p = Number((/[?&]page=(\d+)/.exec(joined) || [])[1] || 1);
          const slice = rows.slice((p - 1) * 100, p * 100);
          return { code: 0, stdout: JSON.stringify(slice), stderr: '' };
        }
        if (joined.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' };
        return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined };
      },
    };
    const out: any = await listIssues(repo, {}, ctx);
    check(out && out.ok === true && out.fallback === 'rest', 'T1 降级趟：GraphQL 挂后 REST 降级成功并如实标 fallback=rest', out && out.error ? out.error : out && out.fallback);
    check(out && Array.isArray(out.data) && out.data.length === 150, 'T1 降级趟：150 条一行不少（' + (out && out.data ? out.data.length : -1) + '）');
    const fb = findLog(logs, 'graphql.fallback');
    const chain = findLog(logs, 'fallback.chain');
    const fall = findLog(logs, 'issues.fallback');
    const degraded = findLog(logs, 'read.degraded', (l) => l.fields && l.fields.op === 'list');
    fiveSegments('T1 降级', {
      input: !!fb && fb.fields && fb.fields.scope === '地图',
      reason: !!fb && !!fb.fields && typeof fb.fields.reason === 'string' && fb.fields.reason.length > 0,
      external: !!chain && !!chain.fields && finite(chain.fields.latencyMs),
      state: !!fall && fall.fields && fall.fields.from === 'graphql' && fall.fields.to === 'rest',
      conclusion: !!degraded && degraded.fields.reason === 'list:gql-err',
    });
  }

  // ---------- T2 部分失败：单票降级后依赖明细补不到 ----------
  {
    const logs: any[] = [];
    const ctx: any = {
      cwd: ROOT,
      outbound: createOutboundControl(),
      platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) },
      logEvent: (level: string, event: string, fields: any) => logs.push({ level, event, fields }),
      exec: async (cmd: string, args: any[]) => {
        const joined = (args || []).join(' ');
        if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' };
        if (joined.includes('/dependencies/blocked_by')) return { code: 1, stdout: '', stderr: 'HTTP 500' };
        if (/repos\/[^/]+\/[^/]+\/issues\/414$/.test(joined)) {
          return {
            code: 0,
            stdout: JSON.stringify({
              number: 414, title: 'issue 414', state: 'open', labels: [], user: { login: 'tester' },
              html_url: 'https://github.com/example/repo/issues/414',
              issue_dependencies_summary: { blocked_by: 1, blocking: 0, total_blocked_by: 1, total_blocking: 0 },
            }),
            stderr: '',
          };
        }
        return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined };
      },
    };
    const out: any = await getIssue(repo, '414', {}, ctx);
    check(out && out.ok === true && out.data && String(out.data.key) === '414', 'T2 部分失败趟：单票降级取回行本身', out && out.error ? out.error : out && out.data && out.data.key);
    const depsState = out && out.data && out.data.fieldStates && out.data.fieldStates.dependencies;
    check(!!depsState && depsState.known === false && depsState.reason === 'unreadable', 'T2 部分失败趟：依赖边补不到记未知（known:false/unreadable），不当成没有依赖', depsState);
    const fb = findLog(logs, 'graphql.fallback');
    const chain = findLog(logs, 'fallback.chain');
    const degraded = findLog(logs, 'read.degraded', (l) => l.fields && l.fields.op === 'get' && l.fields.reason === 'get:degraded');
    const gap = findLog(logs, 'read.degraded', (l) => l.fields && l.fields.reason === 'get:rest-deps');
    fiveSegments('T2 部分失败', {
      input: !!fb && fb.fields && fb.fields.scope === '单票',
      reason: !!fb && !!fb.fields && typeof fb.fields.reason === 'string' && fb.fields.reason.length > 0,
      external: !!chain && !!chain.fields && finite(chain.fields.latencyMs),
      state: !!degraded,
      conclusion: !!gap && !!out.provenance && out.provenance.fieldGroups && out.provenance.fieldGroups.dependencies === 'unexpressed',
    });
  }

  // ---------- T3 截断：GraphQL 列表到 500 条上限 ----------
  {
    const logs: any[] = [];
    let gqlCalls = 0;
    const ctx: any = {
      cwd: ROOT,
      outbound: createOutboundControl(),
      platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) },
      logEvent: (level: string, event: string, fields: any) => logs.push({ level, event, fields }),
      exec: async (cmd: string, args: any[]) => {
        const joined = (args || []).join(' ');
        if (!joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined };
        gqlCalls += 1;
        if (gqlCalls > 10) {
          return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }), stderr: '' };
        }
        const base = (gqlCalls - 1) * 50;
        const nodes: any[] = [];
        for (let i = 1; i <= 50; i += 1) {
          const n = base + i;
          nodes.push({ number: n, title: 'issue ' + n, state: 'open', labels: { nodes: [{ name: 'bug' }] }, user: { login: 'tester' }, url: 'https://github.com/example/repo/issues/' + n });
        }
        return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes, pageInfo: { hasNextPage: true, endCursor: 'c' + gqlCalls } } } } }), stderr: '' };
      },
    };
    const out: any = await listIssues(repo, {}, ctx);
    check(out && out.ok === true, 'T3 截断趟：回包成功（截断不是失败）');
    check(!!out && out.truncated === true && Array.isArray(out.data) && out.data.length === 500, 'T3 截断趟：截断标记为真且恰好 500 条（' + (out && out.data ? out.data.length : -1) + '）');
    const partial = findLog(logs, 'read.degraded', (l) => l.fields && l.fields.reason === 'list:partial');
    const anyList = findLog(logs, 'read.degraded', (l) => l.fields && l.fields.op === 'list');
    fiveSegments('T3 截断', {
      input: !!anyList && anyList.fields.op === 'list',
      reason: !!partial && partial.fields.reason === 'list:partial',
      external: !!partial && finite(partial.fields.latencyMs),
      state: !!out && out.truncated === true && out.data.length === 500,
      conclusion: !!out && out.ok === true && !!partial,
    });
  }

  // ---------- T4 并发：同一工作区两趟强制快照只重建一次 ----------
  {
    const fires: any[] = [];
    const table = new Map<string, any>();
    const counter = { n: 0 };
    const adopt = (s: any, c: string) => { table.set(c, { ts: Date.now(), snapshot: s, error: null, cwd: c }); return s; };
    const deps: any = {
      canonicalKey: async () => 'K729',
      selectEarly: async () => ({ backendId: 'github', source: 'auto', rev: 0 }),
      isComposerSelection: () => true,
      getTrackerRegistry: async () => ({
        modules: () => [],
        describe: () => ({ backend: 'github', refId: 'a/b', name: 'a/b', url: '' }),
        get: () => ({ list: async () => { counter.n += 1; await delay(80); return { ok: true, data: [] } } }),
      }),
      getPlatform: async () => ({ os: 'win32', path, getHome: async () => ROOT }),
      ctx: { get: () => undefined },
      getCache: (c: string) => table.get(c) || { ts: 0, snapshot: null, error: null, cwd: c },
      setCache: (v: any) => { if (v && v.cwd) table.set(v.cwd, v); },
      CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => null,
      upcaseSnapStates: (s: any) => s,
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async (c: string) => c,
      getRepoKey: async () => ({ owner: 'a', name: 'b' }),
      readDiskCache: async () => null,
      writeDiskCache: async () => {},
      adoptSnapshot: adopt,
      detectionExec: async () => ({ ok: false }),
      getGhPath: () => '',
      getGhLastError: () => '',
      errText: (e: any) => String((e && e.message) || e),
      DEFAULT_CWD: 'K729',
      logCtx: { fire: (l: string, e: string, f: any) => fires.push({ level: l, event: e, fields: (typeof f === 'function') ? f() : f }), isEnabled: () => true },
    };
    const { createSessionSnapshot } = await imp('src/refresh/rooms/host/session-snapshot-cache.ts');
    const h = createSessionSnapshot(deps);
    const p1 = h.handleSnapshot({ cwd: 'K729', force: true });
    await delay(10);
    const p2 = h.handleSnapshot({ cwd: 'K729', force: true });
    const [r1, r2]: any[] = await Promise.all([p1, p2]);
    check(counter.n === 1, 'T4 并发趟：两趟强制并发只重建一次（builds=' + counter.n + '）');
    check(r1 && r2 && r1 === r2, 'T4 并发趟：两趟回包是同一份（搭车不另起一趟）');
    const req = fires.filter((f) => f.event === 'snapshot.request');
    const miss = findLog(fires, 'snapshot.cache.miss', (l) => l.fields && l.fields.reason === 'force');
    const built = fires.filter((f) => f.event === 'snapshot.built');
    const dedup = findLog(fires, 'dedup.hit', (l) => l.fields && l.fields.scope === 'snapshot');
    fiveSegments('T4 并发', {
      input: req.length === 2 && !!req[0].fields && typeof req[0].fields.cwdHash === 'string' && req[0].fields.force === true,
      reason: !!miss,
      external: built.length === 1 && finite(built[0].fields.latencyMs),
      state: !!dedup,
      conclusion: built.length === 1 && counter.n === 1 && !!r1,
    });
  }

  // ---------- T5 重启：磁盘回放不联网 ----------
  {
    const fires: any[] = [];
    let detections = 0;
    const disk = {
      selection: { backendId: 'github', rev: 0 },
      generatedMs: Date.now() - 5000,
      diskReplay: { schema: 4, source: 'disk', completeness: 'last-known', legacy: false },
    };
    const deps: any = {
      canonicalKey: async (c: string) => c,
      selectEarly: async () => ({ backendId: 'github', rev: 0 }),
      isComposerSelection: () => false,
      getTrackerRegistry: async () => ({ get: () => ({}), describe: () => null, modules: () => [] }),
      getPlatform: async () => ({ fs: {}, path }),
      ctx: { get: () => undefined },
      getCache: () => ({ ts: 0, snapshot: null, error: null, cwd: 'K729' }),
      setCache: () => {},
      CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => true,
      upcaseSnapStates: (s: any) => s,
      computeLevels: () => ({}),
      groupTickets: () => ({}),
      getRepoRoot: async (c: string) => c,
      getRepoKey: async () => ({ owner: 'o', name: 'n' }),
      readDiskCache: async () => disk,
      writeDiskCache: async () => {},
      adoptSnapshot: (s: any) => s,
      detectionExec: async () => { detections += 1; return { ok: false }; },
      getGhPath: () => null,
      getGhLastError: () => null,
      errText: (e: any) => String((e && e.message) || e),
      DEFAULT_CWD: 'K729',
      logCtx: { fire: (l: string, e: string, f: any) => fires.push({ level: l, event: e, fields: (typeof f === 'function') ? f() : f }), isEnabled: () => true },
    };
    const { createSessionSnapshot } = await imp('src/refresh/rooms/host/session-snapshot-cache.ts');
    const out: any = await createSessionSnapshot(deps).handleSnapshot({ cwd: 'K729' });
    const req = findLog(fires, 'snapshot.request');
    const miss = findLog(fires, 'snapshot.cache.miss');
    const rv = out && out.diskReplay;
    fiveSegments('T5 重启', {
      input: !!req && !!req.fields && typeof req.fields.cwdHash === 'string',
      reason: !!miss && !!miss.fields && miss.fields.reason === 'empty',
      external: detections === 0 && !!rv && finite(out.generatedMs),
      state: !!out && out.fromCache === true && !!rv && rv.schema === 4 && rv.source === 'disk' && rv.completeness === 'last-known' && rv.legacy === false,
      conclusion: !!out && out.fromCache === true && detections === 0,
    });
    check(detections === 0, 'T5 重启趟：回放不联网（外部调用 0 次，实得 ' + detections + '）');
  }

  console.log('');
  printGateResult(GATE, total, failed ? 1 : 0);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.log('门禁执行异常：' + (e && e.stack ? e.stack : String(e)));
  printGateResult(GATE, total, 1);
  process.exit(1);
});
