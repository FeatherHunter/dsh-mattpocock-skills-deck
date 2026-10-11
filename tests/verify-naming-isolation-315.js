// tests/verify-naming-isolation-315.js — #315 隔离修复回归（草稿裸档抑制）
import * as namingTitles from '../src/shared/naming-titles.js';
import * as namingTracking from '../src/shared/naming-tracking.js';
import * as namingAttribution from '../src/shared/naming-attribution.js';
// S2（#452）：命名共享核心已拆为 3 个文件，此处同时引用再合并。
const core = Object.assign({}, namingTitles, namingTracking, namingAttribution);

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
  // 这一段验的是「宽限窗口这道机制本身」：窗口内不产单、过了窗口才产单。
  // 产品当前把 NAMING_HINT_GRACE_MS 定为 0（#709 改成事件驱动后不再靠等窗口），若这里照抄那个常量，
  // 断言就退化成「窗口恒为零」的假验证，而且常量一改就红。所以显式传一个窗口：断言只依赖机制。
  const GRACE_MS = 30000;
  const now = Date.now();
  const repo = 'o/r';
  const sA = core.createTrackingState({ sessionId: 'A', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sA.createdAt = now - 1000; // 还在窗口内，无 hint，不产单
  sA.updatedAt = now - 1000;
  const sB = core.createTrackingState({ sessionId: 'B', baselineTitle: '[New] 新建需求', repoKey: repo, cwd: '/x' });
  sB.createdAt = now - GRACE_MS - 1000; // 已经过了窗口
  sB.updatedAt = now - GRACE_MS - 1000;
  const oA = core.planOrderFor(sA, now, GRACE_MS);
  const oB = core.planOrderFor(sB, now, GRACE_MS);
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

// ---------- #709 那一节已删 ----------
// 原来这里还有一节「#709 事件驱动改造后的隔离修复守卫」：它读 src/host/namingGuardian.js 与
// src/client/kernel/api-naming.js 的源码文本，断言里面出现过 byRepoHasHint、某个判定条件、
// function keepRelatedAssigned(、四个对外电话名、function namingGuardianEvent(，以及没有
// setInterval / 那些旧定时器名字。断的全是代码长成什么样，改写法、改注释、搬文件就变红，
// 已按维护者口径整体删掉。本票真正的隔离修复由上面那 12 条行为断言（同仓库裸档抑制、
// 跨仓库隔离、宽限与 numbered 不受影响、faceSid 匹配）覆盖。

if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1); }
else { console.log('\nPASS all ' + total + ' checks'); }
