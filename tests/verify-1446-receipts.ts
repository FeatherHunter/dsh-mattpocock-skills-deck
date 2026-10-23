// tests/verify-1446-receipts.ts —— #1446（A3 账本换轨后端模型）：回执与日志按预算模型显示。
//
// 为什么有这扇门禁：旧回执用 remaining=-1 / tier='off-network' / tier='unknown' 这类哨兵值占位，
// 人从回执上看不出「这个后端到底有没有额度、读数是不是真的量到了」。本票把回执改成四格事实
// （backendId / budgetKind / readKnown / offNetwork），remaining 与 tier 只在读数真的已知时出现，
// 不知道或离网时用 cost.note 写一句人话。日志只加字段，不改旧字段含义（规格 §7）。
//
// 本文件经 planGates 目录约定自动进链，不用在 gate-map 登记。
import { createLedger } from '../src/refresh/rooms/host/quota-ledger.ts';
import { createGate } from '../src/refresh/rooms/host/refresh-gate.ts';
import { backendBudgetModel } from '../src/refresh/kernel/backend-quota-model.ts';
import { callDeckSession } from '../src/deck/tools/tracker-session.ts';
import { tierFor } from '../src/refresh/kernel/host-budget.ts';

let total = 0;
let failed = 0;
function check(ok: unknown, label: string): void {
  total += 1;
  if (!ok) { failed += 1; console.error('FAIL ' + label); }
  else { console.log('ok ' + total + ' ' + label); }
}

const CLOCK = 1700000000000;
const ESTIMATE = { points: 5, requests: 3, withinCallCap: true, shards: 1, perShard: 1, text: '预计花 5 点、3 条请求。' };

/** 造一次会话调用的入参：会话自带预算口径，读数由 getCachedReading 交回（与生产接线同形）。 */
function callReq(backendId: string, reading: unknown, opts?: { throwWork?: boolean }) {
  const session = {
    backendId: backendId,
    budget: backendBudgetModel(backendId),
    cwd: '/ws/1446',
    workspaceKey: 'ws-1446',
    call: async (fn: unknown) => (fn as (s: unknown, c: unknown) => unknown)({ id: backendId }, { cwd: '/ws/1446', caller: 'refresh' }),
  };
  return callDeckSession({
    tool: 'deck_context',
    deps: { getCachedReading: async () => reading },
    session: session,
    opened: { backendId: backendId, source: 'explicit', ref: '.scratch/demo', session: session },
    estimate: ESTIMATE,
    repo: { backend: backendId, refId: '.scratch/demo', name: 'demo', url: '' },
    sandbox: { policy: null, sessionId: 's-1446' },
  } as never, async (ctx: unknown) => {
    void ctx;
    if (opts && opts.throwWork) throw new Error('后端实现抛错（1446 失败分支夹具）');
    return { value: { status: 'ok', data: {}, notes: [] }, claimed: { requests: 2, points: 4 } };
  });
}

async function main() {
  console.log('#1446 回执与日志按预算模型显示');

  // ── 一、两桶已知：回执带水位与档位，且没有未知/离网说明 ──
  {
    const reading = { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 4000, limit: 5000 }, graphql: { remaining: 3000, limit: 5000 } } };
    const r = await callReq('github', reading) as any;
    const a = r && r.cost && r.cost.actual;
    check(r && r.status === 'ok', '两桶已知：工具照常做成（status=' + (r && r.status) + '）');
    check(!!a && a.backendId === 'github', '两桶已知：回执带 backendId（实得 ' + (a && a.backendId) + '）');
    check(!!a && a.budgetKind === 'two-buckets', '两桶已知：回执带 budgetKind=two-buckets（实得 ' + (a && a.budgetKind) + '）');
    check(!!a && a.readKnown === true && a.offNetwork === false, '两桶已知：readKnown=true、offNetwork=false（实得 ' + JSON.stringify({ readKnown: a && a.readKnown, offNetwork: a && a.offNetwork }) + '）');
    check(!!a && a.remaining === 3000, '两桶已知：remaining 取 GraphQL 桶的剩余（实得 ' + (a && a.remaining) + '）');
    check(!!a && typeof a.tier === 'string' && a.tier === tierFor(0.4), '两桶已知：tier 按已用比例算出来（实得 ' + (a && a.tier) + ' / 应为 ' + tierFor(0.4) + '）');
    check(r && r.cost && r.cost.note === undefined, '两桶已知：没有 cost.note（实得 ' + JSON.stringify(r && r.cost && r.cost.note) + '）');
    check(!!a && a.requests === 2 && a.points === 4, '旧字段 requests/points 照留（实得 ' + JSON.stringify({ requests: a && a.requests, points: a && a.points }) + '）');
  }

  // ── 二、未知读数：四格说「没量到」，不出现 remaining/tier，人话在 cost.note ──
  {
    const r = await callReq('github', { known: false, reason: 'not-measured' }) as any;
    const a = r && r.cost && r.cost.actual;
    check(!!a && a.backendId === 'github' && a.budgetKind === 'two-buckets', '未知：仍如实带后端与口径（实得 ' + JSON.stringify(a) + '）');
    check(!!a && a.readKnown === false && a.offNetwork === false, '未知：readKnown=false、offNetwork=false（实得 ' + JSON.stringify({ readKnown: a && a.readKnown, offNetwork: a && a.offNetwork }) + '）');
    check(!!a && a.remaining === undefined, '未知：remaining 不出现（实得 ' + (a && a.remaining) + '）');
    check(!!a && a.tier === undefined, '未知：tier 不出现（实得 ' + (a && a.tier) + '）');
    check(!!r && r.cost && String(r.cost.note || '').indexOf('额度读数还没同步上来') >= 0, '未知：cost.note 写「读数还没同步上来」（实得 ' + JSON.stringify(r && r.cost && r.cost.note) + '）');
    check(!!r && Array.isArray(r.notes) && r.notes.join('').indexOf('额度读数') < 0, '未知：那句人话不再塞进 notes 数组（实得 ' + JSON.stringify(r && r.notes) + '）');
  }

  // ── 三、离网后端：readKnown=true（量过了，本后端没有额度），不回水位，人话说明 ──
  {
    const r = await callReq('markdown', { known: true, kind: 'off-network', buckets: {} }) as any;
    const a = r && r.cost && r.cost.actual;
    check(!!a && a.backendId === 'markdown' && a.budgetKind === 'off-network', '离网：回执带后端与口径（实得 ' + JSON.stringify(a) + '）');
    check(!!a && a.readKnown === true && a.offNetwork === true, '离网：readKnown=true、offNetwork=true（实得 ' + JSON.stringify({ readKnown: a && a.readKnown, offNetwork: a && a.offNetwork }) + '）');
    check(!!a && a.remaining === undefined && a.tier === undefined, '离网：remaining/tier 都不出现（实得 ' + JSON.stringify({ remaining: a && a.remaining, tier: a && a.tier }) + '）');
    check(!!r && r.cost && String(r.cost.note || '').indexOf('本后端不需要额度') >= 0, '离网：cost.note 写「本后端不需要额度」（实得 ' + JSON.stringify(r && r.cost && r.cost.note) + '）');
    check(!!r && Array.isArray(r.notes) && r.notes.join('').indexOf('不需要额度') < 0, '离网：那句人话不再塞进 notes 数组');
  }

  // ── 四、只计请求：读请求那一格，带剩余与档位 ──
  {
    const r = await callReq('gitlab', { known: true, kind: 'requests-only', requests: { remaining: 120, limit: 600 } }) as any;
    const a = r && r.cost && r.cost.actual;
    check(!!a && a.backendId === 'gitlab' && a.budgetKind === 'requests-only', '只计请求：回执带后端与口径（实得 ' + JSON.stringify(a) + '）');
    check(!!a && a.readKnown === true && a.offNetwork === false, '只计请求：readKnown=true、offNetwork=false');
    check(!!a && a.remaining === 120, '只计请求：remaining 取请求那一格（实得 ' + (a && a.remaining) + '）');
    check(!!a && typeof a.tier === 'string' && a.tier === tierFor(0.8), '只计请求：tier 按请求用量算（实得 ' + (a && a.tier) + '）');
    check(!!r && r.cost && r.cost.note === undefined, '只计请求：没有 cost.note');
  }

  // ── 五、失败分支：只带 estimated，不出现新四格（现状不动） ──
  {
    const r = await callReq('github', { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 4000, limit: 5000 }, graphql: { remaining: 3000, limit: 5000 } } }, { throwWork: true }) as any;
    check(!!r && r.status === 'unsupported', '失败分支：按三态回 unsupported（实得 ' + (r && r.status) + '）');
    check(!!r && r.cost && !!r.cost.estimated, '失败分支：带 estimated（实得 ' + JSON.stringify(r && r.cost && r.cost.estimated) + '）');
    check(!!r && r.cost && r.cost.actual === undefined, '失败分支：没有 cost.actual');
    check(!!r && r.cost && r.cost.note === undefined, '失败分支：没有 cost.note');
  }

  // ── 六、闸回执：推迟与成功都带四格；水位只在已知时加 ──
  {
    const events: any[] = [];
    const logCtx = { isEnabled: () => true, fire: (level: string, event: string, fields: unknown) => { events.push({ level: level, event: event, fields: typeof fields === 'function' ? (fields as () => unknown)() : fields }); } };
    const ledger = createLedger({ now: () => CLOCK, logCtx: logCtx });
    ledger.ensureBackend('github', { kind: 'two-buckets' });
    ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 0, reset: CLOCK + 3600000 } }, CLOCK);
    const gate = createGate({ ledger: ledger, now: () => CLOCK, logCtx: logCtx });
    gate.setWorkspace('ws-1446', { active: true });

    const deferred = await gate.send({ source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: 'ws-1446', backendId: 'github' }, async () => ({ requests: 1, points: 0 })) as any;
    check(!!deferred && deferred.sent === false && deferred.verdict === 'defer', '闸推迟：如实回 defer（实得 ' + JSON.stringify({ sent: deferred && deferred.sent, verdict: deferred && deferred.verdict }) + '）');
    check(!!deferred && deferred.backendId === 'github' && deferred.budgetKind === 'two-buckets' && deferred.readKnown === true && deferred.offNetwork === false,
      '闸推迟：回执带四格事实（实得 ' + JSON.stringify(deferred && { backendId: deferred.backendId, budgetKind: deferred.budgetKind, readKnown: deferred.readKnown, offNetwork: deferred.offNetwork }) + '）');
    check(!!deferred && deferred.remaining === undefined && deferred.tier === undefined, '闸推迟：不带 remaining/tier 两格（实得 ' + JSON.stringify({ remaining: deferred && deferred.remaining, tier: deferred && deferred.tier }) + '）');
    const decide = events.filter((e) => e.event === 'refresh.decide').pop();
    check(!!decide, '日志：推迟这一笔记了 refresh.decide');
    const df = (decide && decide.fields) || {};
    check(df.backendId === 'github' && df.budgetKind === 'two-buckets' && df.readKnown === true && df.offNetwork === false,
      '日志 refresh.decide：带四格新字段（实得 ' + JSON.stringify({ backendId: df.backendId, budgetKind: df.budgetKind, readKnown: df.readKnown, offNetwork: df.offNetwork }) + '）');
    check(df.category === 'ai-tool' && df.kind === 'tool-batch' && df.verdict === 'defer' && df.reason === 'ai-tool-below-remaining',
      '日志 refresh.decide：旧字段语义不变（实得 ' + JSON.stringify({ category: df.category, kind: df.kind, verdict: df.verdict, reason: df.reason }) + '）');
    check(df.tier === 'red' && typeof df.cycle === 'string' && typeof df.keyHash === 'string' && df.keyHash.length === 8, '日志 refresh.decide：旧 tier/cycle/keyHash 仍在（tier=' + df.tier + '）');

    const okLedger = createLedger({ now: () => CLOCK, logCtx: logCtx });
    okLedger.ensureBackend('github', { kind: 'two-buckets' });
    okLedger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 3000, reset: CLOCK + 3600000 } }, CLOCK);
    const okGate = createGate({ ledger: okLedger, now: () => CLOCK });
    okGate.setWorkspace('ws-1446', { active: true });
    const sent = await okGate.send({ source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: 'ws-1446', backendId: 'github' }, async () => ({ requests: 1, points: 2 })) as any;
    check(!!sent && sent.sent === true, '闸成功：真的发出去（实得 ' + JSON.stringify({ sent: sent && sent.sent, verdict: sent && sent.verdict }) + '）');
    check(!!sent && sent.backendId === 'github' && sent.budgetKind === 'two-buckets' && sent.readKnown === true && sent.offNetwork === false, '闸成功：回执带四格事实');
    check(!!sent && typeof sent.remaining === 'number' && sent.remaining > 0 && sent.remaining <= 3000 && typeof sent.tier === 'string', '闸成功：带剩余量与档位（实得 ' + JSON.stringify({ remaining: sent && sent.remaining, tier: sent && sent.tier }) + '）');
    // requests/points 记的是传输层真正报上来的条数（这一笔夹具没有报出站，所以是 0）；这里只钉旧字段还在、类型没变。
    check(!!sent && typeof sent.requests === 'number' && typeof sent.points === 'number', '闸成功：旧花费字段照留（实得 ' + JSON.stringify({ requests: sent && sent.requests, points: sent && sent.points }) + '）');

    const spendEvent = events.filter((e) => e.event === 'quota.spend').pop();
    check(!!spendEvent, '日志：记账记了既有 quota.spend 事件');
    const sf = (spendEvent && spendEvent.fields) || {};
    check(sf.account === 'ai-tool' && sf.backendId === 'github' && sf.bucket === 'graphql' && typeof sf.requests === 'number' && typeof sf.points === 'number' && typeof sf.remaining === 'number',
      '日志 quota.spend：旧字段照旧、backendId 如实（实得 ' + JSON.stringify(sf) + '）');
  }

  // ── 七、未知后端（不带 backendId）：只记请求数，回执不带水位 ──
  {
    const ledger = createLedger({ now: () => CLOCK });
    const gate = createGate({ ledger: ledger, now: () => CLOCK });
    gate.setWorkspace('ws-unknown', { active: true });
    const r = await gate.send({ source: 'probe.tick', kind: 'probe', workspaceKey: 'ws-unknown' }, async () => ({ requests: 1, points: 0 })) as any;
    check(!!r && r.sent === true, '未知后端：照常发（实得 ' + (r && r.sent) + '）');
    check(!!r && r.backendId === '' && r.budgetKind === 'unknown' && r.readKnown === false && r.offNetwork === false, '未知后端：四格如实空着（实得 ' + JSON.stringify({ backendId: r && r.backendId, budgetKind: r && r.budgetKind, readKnown: r && r.readKnown, offNetwork: r && r.offNetwork }) + '）');
    check(!!r && r.remaining === undefined && r.tier === undefined, '未知后端：回执不带水位（实得 ' + JSON.stringify({ remaining: r && r.remaining, tier: r && r.tier }) + '）');
    check(!!r && typeof r.requests === 'number', '未知后端：请求数照记（实得 ' + (r && r.requests) + '）');
  }

  console.log('\n' + (failed ? '存在失败（' + total + ' 项断言）' : '全部通过 — 四模型回执、失败分支与日志新字段都在真装配路径上走通（' + total + ' 项断言）'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1); });
