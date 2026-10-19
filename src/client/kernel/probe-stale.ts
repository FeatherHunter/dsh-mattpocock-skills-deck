/**
 * src/client/kernel/probe-stale.ts —— 面板快照那一路的「这一次还算不算数」判断（#669 第 5 件）
 *
 * 契约：模块真源；构建时剥行首 export，把声明体文本拼回
 * src/client/index.ts 里那条 probeStale 拼接标记处，源码树里只有这一份真源。
 * 接口清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 以后谁改它：改「面板拿回来的这份快照还算不算数」「在途的那一次还能不能复用」的人。
 *
 * 为什么要有这个文件（真机现场，2026-09-21「选 Markdown → 点确认切换 → 没有任何反应」）：
 * 面板上飞着一次强制重取时，用户点了确认切换、宿主也真换了后端，
 * 可绑定成功之后那次重取，被原先按工作区去重的规则当成同一次请求复用掉了，
 * 面板于是拿回切换前那份快照，仓库标、引导链看着全没动。
 *
 * 两处一起治：
 * ① 在途复用与去重键：键从「工作区键」升级成「工作区键 + 后端 id」—— 换过后端
 * 就不是同一次请求了，换后端之后那次重取一定真发一次。同一个后端上的并发重取
 * 照旧复用（那是 #366 要的省流量），而且 force 的那一次仍然不复用非 force 的
 * 在途请求（#366 原判据，一个字没动）。
 * ② 回包时判两问，任一不过就丢弃、不写进会话状态：问一是后来又发过更新的一次，
 * 问二是这次问的后端还是用户现在选的那个后端。只有带了后端而用户已换到别的
 * 后端这一种会被判过期，自动识别那一路不受影响。判据落在回包这一侧，
 * 发请求时就把结论冻成布尔值那种写法（链那一侧 2026-09-20 那版踩过）正好判反，
 * 不要再写回去。
 *
 * 反例：不要把去重键退回纯工作区键；不要在发请求时冻结 stale 结论。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const wsKeyOf: any;
declare const pendingSnapshotByCwd: any;
declare const isEnabled: any;
declare const log: any;
declare const dswsLogHash: any;
declare const dswsDedupWin: any;
declare const hydrateFromCache: any;
declare const emit: any;
/**
 * 快照请求的自增序号：每发起一次就加一，回包时凭它判断是不是最新的一次。
 * 按工作区键分开记，A 工作区的重取不会顶掉 B 工作区正在飞的那次。
 */
export const _snapSeqN: { n: number } = { n: 0 };
/**
 * 每个工作区键上最新一次请求的序号：发出去就记，跑完就摘掉，不留常驻条目。
 * 比它早发的那几次回来时比不到自己的序号，照样判成过期。
 */
export const _snapLatestByWs: Map<string, number> = new Map(); // Map<工作区键, 这把键上最新一次请求的序号>
// 去重键：工作区键 + 后端 id（同一把键的算法只此一处，读写两侧都从这里取）。
export const _snapPendKey = function (cwd: any, backendId: any): string {
  try { return wsKeyOf(cwd || '') + '|' + String(backendId || ''); } catch (e) { return String(cwd || '') + '|' + String(backendId || ''); }
};
// 发起这一次请求之前登记一笔：序号（回包时凭它比）、这次问的后端、以及去重键（写/删在途登记都用它）。
export const _snapMarkRequest = function (st: any): { seq: number; reqBackend: string; pendKey: string } {
  const reqBackend: string = (st && st.selection && st.selection.backendId) || '';
  const seq: number = (_snapSeqN.n += 1);
  try { _snapLatestByWs.set(wsKeyOf((st && st.cwd) || ''), seq); } catch (eSeq) {}
  return { seq: seq, reqBackend: reqBackend, pendKey: _snapPendKey(st && st.cwd, reqBackend) };
};
// 回包时判这一份还算不算数（两问见文件头注释）。
export const _snapRespStale = function (wsKey: any, seq: number, reqBackend: any, st: any): boolean {
  try { if (_snapLatestByWs.get(wsKey) !== seq) return true; } catch (eA) { return true; }
  try {
    const nowBackend: string = (st && st.selection && st.selection.backendId) || '';
    if (reqBackend && nowBackend && String(nowBackend) !== String(reqBackend)) return true;
  } catch (eB) { return true; }
  return false;
};
// 同后端已有一份在途请求时：按 #366 的判据决定复不复用；复用就把它那次的结果挂上身（不再发第二份）。
//   返回 null = 不复用，调用方照旧发新请求。
export const _snapReuseInFlight = function (st: any, force: any): any {
  try {
    const reqBackend: string = (st && st.selection && st.selection.backendId) || '';
    const pend: any = pendingSnapshotByCwd.get(_snapPendKey(st && st.cwd, reqBackend));
    if (!pend || !pend.promise) return null;
    if (force && pend.force !== true) return null; // #366：force 不复用非 force 的在途请求——手动刷新必须走到 wf.refresh
    try { dswsDedupWin.n += 1; if (isEnabled('debug') && dswsDedupWin.n % 10 === 0) log('debug', 'dedup.hit', { scope: 'snapshot', keyHash: dswsLogHash(_snapPendKey(st && st.cwd, reqBackend)) }); } catch (eL) {}
    // 同 cwd 在途复用：新调用方挂载后从共享缓存水合，不再发第二份请求
    return pend.promise.then(function (snap: any): any {
      try { if (isEnabled('debug')) log('debug', 'snapshot.fanout', { sessionIdHash: dswsLogHash(String((st && (st.sessionId || st.cwd)) || '')), stale: false, force: !!pend.force, count: (pend.n = ((pend.n || 0) + 1)) }); } catch (eL) {}
      // 在途结果已落 per-cwd 缓存（首发方 then 中 setCachedSnapshot），此处仅水合当前 store
      try { hydrateFromCache(st); emit(st); } catch (eHyd) {}
      return snap;
    });
  } catch (eReuse) { return null; }
};
