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

// ---------- #709（T5）：命名守护改事件驱动之后，这一票的隔离修复仍在 ----------
// 本节是加断言，不是删测试：上面 12 条功能断言一条不少。本节做两件事——
// ① 钉住上面那份 filterOrders 本地副本没有与宿主实现走岔（宿主里那段抑制逻辑必须还在）；
// ② 钉住改事件驱动时没有把隔离修复顺手动掉，也没有把自续定时器抄回来。
console.log('\n— #709 事件驱动改造后的隔离修复守卫 —');
{
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const urlMod = await import('node:url');
  const root = pathMod.join(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '..');
  const read = (p) => fsMod.readFileSync(pathMod.join(root, p), 'utf8');
  const hostNaming = read('src/host/namingGuardian.js');
  check(hostNaming.includes('byRepoHasHint'), '宿主 wf.namingPlan 里的同仓库裸档抑制逻辑仍在（上面本地副本的对照物）');
  check(hostNaming.includes("o.kind === 'draft' && !o.hint"), '抑制的是「同仓库的裸档草稿单」本身，判定条件没被改写');
  check(hostNaming.includes('function keepRelatedAssigned('), '「无关新号不硬配」仍在（#315 追加修复）');
  // 事件驱动改造不许顺手删掉任何一条对外电话
  for (const op of ['wf.registerNewSessionWatcher', 'wf.cancelNewSessionWatcher', 'wf.awaitCreatedIssue', 'wf.namingPlan']) {
    check(hostNaming.includes("'" + op + "'"), '宿主电话仍在：' + op);
  }
  // 再也不许有自己给自己排下一跳的定时器（含旧名字）
  const hostNoComment = hostNaming.replace(/\/\/[^\n]*/g, '');
  check(!/NAMING_TICK_MS|NAMING_SWEEP_MS|namingLoopTick|startNamingGuardianLoop|setInterval/.test(hostNoComment), '宿主命名守护里没有自续定时器');
  const apiNaming = read('src/client/kernel/api-naming.js').replace(/\/\/[^\n]*/g, '');
  check(!/NAMING_POLL_MS|startNamingGuardianPoll|_namingPollTimer|setInterval/.test(apiNaming), '客户端命名轮询已退役，且没有换成另一种自续定时器');
  check(apiNaming.includes('function namingGuardianEvent('), '客户端改为事件驱动入口 namingGuardianEvent');
}

if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1); }
else { console.log('\nPASS all ' + total + ' checks'); }
