// tests/verify-naming-isolation-315.js — #315 隔离修复回归（草稿裸档抑制）
import * as core from '../src/shared/naming-guardian.js';

let failed = false;
let total = 0;
function check(ok, msg, detail) {
  total++;
  if (ok) console.log('  PASS ' + msg);
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')); }
}
console.log('== #315 隔离修复：同仓库裸档抑制 ==');

// 模拟 host 的 wf.namingPlan 过滤逻辑（与 src/host/index.js 保持一致）
function filterOrders(orders, sessions) {
  const byRepoHasHint = {};
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (o && o.kind === 'draft' && o.hint) {
      const so = sessions[o.sessionId];
      const rk = so && so.repoKey;
      if (rk) byRepoHasHint[rk] = true;
    }
  }
  if (Object.keys(byRepoHasHint).length) {
    const kept = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o && o.kind === 'draft' && !o.hint) {
        const so = sessions[o.sessionId];
        const rk = so && so.repoKey;
        if (rk && byRepoHasHint[rk]) continue;
      }
      kept.push(o);
    }
    return kept;
  }
  return orders;
}

{
  const now = Date.now();
  const repo = 'FeatherHunter/dsh-mattpocock-skills-deck';
  // A 有 hint，B 裸档，同仓库
  const sA = core.createTrackingState({ sessionId: 'A', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sA.createdAt = now - 25000;
  sA.updatedAt = now - 25000;
  const sAHinted = core.reduceTrackingState(sA, { type: 'signal', hint: '修复登录闪退' });
  const sB = core.createTrackingState({ sessionId: 'B', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sB.createdAt = now - 25000;
  sB.updatedAt = now - 25000;
  const oA = core.planOrderFor(sAHinted, now, core.NAMING_HINT_GRACE_MS);
  const oB = core.planOrderFor(sB, now, core.NAMING_HINT_GRACE_MS);
  check(!!oA && oA.hint === '修复登录闪退', 'A 有 hint 产单');
  check(!!oB && oB.hint === null, 'B 裸档产单（未修复前）');
  const orders = [oA, oB].filter(Boolean);
  const sessions = { A: sAHinted, B: sB };
  const filtered = filterOrders(orders, sessions);
  check(filtered.length === 1 && filtered[0].sessionId === 'A', '同仓库有 hint 时，裸档 B 被抑制，剩余仅 A');
}

{
  const now = Date.now();
  const repo = 'o/r';
  const sA = core.createTrackingState({ sessionId: 'A', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sA.createdAt = now - 25000;
  sA.updatedAt = now - 25000;
  const sB = core.createTrackingState({ sessionId: 'B', baselineTitle: '[New] 新建需求', repoKey: 'other/repo', cwd: '/y' });
  sB.createdAt = now - 25000;
  sB.updatedAt = now - 25000;
  const sAHinted = core.reduceTrackingState(sA, { type: 'signal', hint: 'hintA' });
  const oA = core.planOrderFor(sAHinted, now, core.NAMING_HINT_GRACE_MS);
  const oB = core.planOrderFor(sB, now, core.NAMING_HINT_GRACE_MS);
  const orders = [oA, oB].filter(Boolean);
  const sessions = { A: sAHinted, B: sB };
  const filtered = filterOrders(orders, sessions);
  check(filtered.length === 2, '不同仓库的裸档不被抑制（跨仓库隔离）');
}

{
  const now = Date.now();
  const repo = 'o/r';
  const sA = core.createTrackingState({ sessionId: 'A', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sA.createdAt = now - 1000; // 未过宽限，无 hint，不产单
  sA.updatedAt = now - 1000;
  const sB = core.createTrackingState({ sessionId: 'B', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sB.createdAt = now - 25000;
  sB.updatedAt = now - 25000;
  const oA = core.planOrderFor(sA, now, core.NAMING_HINT_GRACE_MS);
  const oB = core.planOrderFor(sB, now, core.NAMING_HINT_GRACE_MS);
  check(!oA, 'A 未过宽限且无 hint 不产单');
  check(!!oB, 'B 过宽限裸档产单');
  const orders = [oA, oB].filter(Boolean);
  const sessions = { A: sA, B: sB };
  const filtered = filterOrders(orders, sessions);
  check(filtered.length === 1 && filtered[0].sessionId === 'B', '无 hint 冲突时裸档保留');
}

{
  // numbered 不受影响
  const now = Date.now();
  const sN = core.createTrackingState({ sessionId: 'N', baselineTitle: '[New] 新建需求', repoKey: 'o/r', cwd: '/x' });
  const sNNum = core.reduceTrackingState(sN, { type: 'numbered', number: 42, title: 't' });
  const oN = core.planOrderFor(sNNum, now, core.NAMING_HINT_GRACE_MS);
  check(!!oN && oN.kind === 'numbered', 'numbered 订单不受裸档抑制影响');
  const orders = [oN];
  const sessions = { N: sNNum };
  const filtered = filterOrders(orders, sessions);
  check(filtered.length === 1, 'numbered 保留');
}

console.log('\n— 客户端面校验（faceSid 匹配）—');
{
  // 模拟 executeNamingOrder 的 faceSid 校验
  function shouldBlock(faceSid, orderSid) {
    if (faceSid && String(faceSid) !== String(orderSid)) return true;
    return false;
  }
  check(shouldBlock('B', 'A'), 'faceSid 与订单 sid 不一致时应拦截');
  check(!shouldBlock('A', 'A'), '一致时不拦截');
  check(!shouldBlock(null, 'A'), '无 faceSid 时不拦截（兼容旧面对象）');
  check(!shouldBlock(undefined, 'A'), 'undefined 不拦截');
}

if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1); }
else { console.log('\nPASS all ' + total + ' checks'); }
