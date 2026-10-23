/**
 * src/refresh/rooms/client/snapshot-sync-helpers.ts — 内核模块（#707 由 probe-snapshot.ts 按行数门禁拆出）
 *
 * 为什么拆：probe-snapshot.ts 拆到这里之前已经 349 行，而上限是 350 行，
 * #707 与后继改动还要改那个文件，已经没有下脚的地方。
 * 这里搬出来的是三类跟「下载快照」本身无关的小东西，就地不动、一行都没改行为：
 * ① 颜色两个小函数（hexA / darken）：标签配色渲染用；
 * ② 数据层增量差异 diffSnapshots：新旧两份快照对比，供多视图增量与行闪烁；
 * ③ 闪烁高亮的一次性清除 scheduleFlashClear：排一个定时器把高亮擦掉，防堆积。
 *
 * 契约：与其它内核文件一样，本文件为模块真源；构建时去掉行首 export 后拼回
 * src/client/index.ts 的拼接标记处，源码树里只有这一份真源。同名 .js 是构建产物。
 * 本文件里出现的 emit / timer / idOf 都是同一个闭包里的邻居，靠拼接顺序保证可见，
 * 所以一律用 declare 声明形状，不做运行时引入。
 *
 * 反例：不要在这里加运行时 import；不要把颜色比较与是否合法混成同一个判据；
 * 不要让清除高亮的定时器堆积，一次探测只排一个。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const emit: any;
declare const timer: any;
declare const idOf: any;
// 高亮停留时长住中央（config/ttl.yaml），由生成器变成常量随闭包进来，本文件只声明名字。
declare const SNAPSHOT_PROBE_MS: number;
// v11：label 用 GitHub 配置色渲染 —— hex → rgba（.18 背景），无效 hex 返回 null 走兜底
export const hexA = function (hex: any, a: any): string | null {
  try {
    const hh: string = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null;
    const r: number = parseInt(hh.slice(0, 2), 16), g: number = parseInt(hh.slice(2, 4), 16), b: number = parseInt(hh.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  } catch (e) { return null; }
};
// v14-18：hex → HSL 亮度下调 amt（0-1）→ hex（chips 边框比 label 色深一档）
export const darken = function (hex: any, amt: number): string | null {
  try {
    const hh: string = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null;
    const r: number = parseInt(hh.slice(0, 2), 16) / 255, g: number = parseInt(hh.slice(2, 4), 16) / 255, b: number = parseInt(hh.slice(4, 6), 16) / 255;
    const mx: number = Math.max(r, g, b), mn: number = Math.min(r, g, b);
    const l: number = (mx + mn) / 2;
    let hue: number = 0, sat: number = 0;
    if (mx !== mn) {
      const d: number = mx - mn;
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) hue = ((b - r) / d + 2);
      else hue = ((r - g) / d + 4);
      hue *= 60;
    }
    const l2: number = Math.max(0, l - amt);
    const hue2rgb = function (p: number, q: number, t: number): number { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q2: number = l2 < 0.5 ? l2 * (1 + sat) : l2 + sat - l2 * sat;
    const p2: number = 2 * l2 - q2;
    const rr: number = Math.round(hue2rgb(p2, q2, hue / 360 + 1 / 3) * 255);
    const gg: number = Math.round(hue2rgb(p2, q2, hue / 360) * 255);
    const bb: number = Math.round(hue2rgb(p2, q2, hue / 360 - 1 / 3) * 255);
    return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
  } catch (e) { return null; }
};
// v1.5 T10 R4（用户拍板）：数据层增量 diff —— 变更/新增/删除 按票号对比（含 map 子票级变化）， 多视图（列表/map详情/状态栏计数/过滤结果）数据驱动自动增量；diff 结果供 R5 视觉消费
export const diffSnapshots = function (oldS: any, newS: any): any {
  try { if (oldS && newS && oldS.version && newS.version && oldS.version === newS.version) return { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now(), skipped: true }; } catch (e) {}
  const out: any = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() };
  if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out;
  if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out;
  const lbl = function (x: any): string { return (x.labels || []).map(function (l: any): string { return typeof l === 'string' ? l : l.name; }).sort().join(','); };
  // effort 维度：差异索引按票身份 (effort, 编号) 键入，否则不同 effort 的同号地图互相顶掉、变更探测不到
  const idx = function (snap: any): Record<string, any> { const m: Record<string, any> = {}; snap.maps.forEach(function (x: any): void { m[idOf(x)] = x; }); return m; };
  const a: Record<string, any> = idx(oldS), b: Record<string, any> = idx(newS);
  // 子票级变化：逐票对比（新增/变更标 issueFlash；任一变化 → 该 map 计入 changed，map 详情视图增量）
  //   字段实证（#458 核验）：map 子票在快照里是 tickets（非 issues）；票级变化 = state/progress/claimedBy/labels
  Object.keys(b).forEach(function (n: string): void {
    if (!a[n]) { out.added.push(n); return; }
    var x: any = a[n], y: any = b[n];
    var sub: boolean = false;
    var ix: Record<string, any> = {}; (x.tickets || []).forEach(function (i: any): void { ix[idOf(i)] = i; });
    var iy: Record<string, any> = {}; (y.tickets || []).forEach(function (i: any): void { iy[idOf(i)] = i; });
    Object.keys(iy).forEach(function (k: string): void {
      if (!ix[k]) { sub = true; out.issueFlash[k] = 'added'; return; }
      var a2: any = ix[k], b2: any = iy[k];
      if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2) || String(a2.updatedAt || '') !== String(b2.updatedAt || '')) { sub = true; out.issueFlash[k] = 'changed'; }
    });
    if (Object.keys(ix).length !== Object.keys(iy).length) sub = true;
    if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(n);
  });
  // #255 · 孤儿票（根票）对比 —— 右侧主列表行闪烁的数据源补口：原实现只遍历 maps 子票，
  // 根票（parentKey=null）任何变化都不产 rowFlash；且把核心字段 updatedAt 纳入比较元组——
  // GitHub 加评论会 bump updated_at，probe 索引（STATE|updated_at）判 changed 触发静默重建后，
  // 闪烁由本差异真实产出（重求值推进，无乐观假设）。
  const ia: Record<string, any> = {}; if (oldS && Array.isArray(oldS.issues)) oldS.issues.forEach(function (i: any): void { if (i) ia[idOf(i)] = i; });
  const iy0: Record<string, any> = {}; if (newS && Array.isArray(newS.issues)) newS.issues.forEach(function (i: any): void { if (i) iy0[idOf(i)] = i; });
  Object.keys(iy0).forEach(function (k: string): void {
    if (!ia[k]) { out.added.push(k); return; }
    var xa: any = ia[k], ya: any = iy0[k];
    if (xa.state !== ya.state || xa.title !== ya.title || lbl(xa) !== lbl(ya) || String(xa.updatedAt || '') !== String(ya.updatedAt || '')) out.changed.push(k);
  });
  Object.keys(ia).forEach(function (k: string): void { if (!iy0[k]) out.removed.push(k); });
  return out;
};
// R5：高亮定时清除（防堆积；一次只排一个 timer）
export let _flashClearPending: boolean = false;
export const scheduleFlashClear = function (st: any): void {
  if (_flashClearPending) return;
  _flashClearPending = true;
  if (timer === undefined) { _flashClearPending = false; return; }
  // 这一次探测标出来的高亮留多久：亮这么久就自己淡掉（一次探测留下的痕迹不该一直挂在界面上），
  //   连着两次探测只排一个清除计时器、不堆积。
  // 数值写在 config/ttl.yaml 的 snapshotProbeMs（高亮停留那一档，2.6 秒），构建时由生成器变成常量、随界面闭包一起进来。
  timer.timeout(function (): void {
    _flashClearPending = false;
    st.rowFlash = {};
    st.issueFlash = {};
    emit(st);
  }, SNAPSHOT_PROBE_MS);
};
