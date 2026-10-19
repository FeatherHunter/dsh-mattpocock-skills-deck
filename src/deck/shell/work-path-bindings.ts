// work-path-bindings.ts —— 工作路线三支依赖的装配工厂（#1261 建；#1083 补落盘加固要的零件；#1086 补释放）。
//
// 为什么单列一份：宿主接线（wiring.ts）有效行已到 328，离 350 上限只剩 22 行，
// 存储创建 + 读出口拼装 + 三支容错包边展开要三十多行，直接写过去会顶超标。
// 本文件只做一件事：把存储（work-path-store.ts）与读出口（work-path-readout.ts）
// 合成工具壳要的那三支（workRouteNote / workRouteRead / workRouteRelease），输入输出形状见
// call-shell-types.ts 里那三处注释。文件读写、改名、日志与家目录仍由调用方注入，
// 本文件不直接碰 Node（生产由宿主接线给真实现，门禁给临时目录 + 固定时钟）。
//
// #1083 起多两个零件：rename（写临时文件再改名覆盖、换后端改旧文件留档）与
// log（workRoute.write / workRoute.read 两个事件的出口）。两者缺省时不报错：
// 没有 rename 就退化成直接写正式文件，没有 log 就一条不记。
// 读出口要读盘（存储不再有内存真源），所以 read 本身是异步的。

import { createWorkPathStore } from './work-path-store.js';
import { buildWorkPathCollisionNote, buildWorkPathReadout, buildWorkPathSummary } from './work-path-readout.js';

export interface WorkRouteBindingIo {
  homeDir?: string;
  now?: () => number;
  readFile?: (path: string) => Promise<string | null> | string | null;
  writeFile?: (path: string, text: string) => Promise<void> | void;
  mkdir?: (dir: string) => Promise<void> | void;
  /** 改名覆盖：临时文件 → 正式文件；换后端时旧文件 → 留档名。 */
  rename?: (from: string, to: string) => Promise<void> | void;
  /** 宿主日志出口（workRoute.write / workRoute.read 两个事件从这里出去）。 */
  log?: { fire?: (level: string, event: string, fields: Record<string, unknown>) => void };
}

/** 合成壳要的三支：note 与 release 原样交存储（存储自己永不抛，这里不再包第二层）；read 读盘快照 + 读出口 + 摘要。 */
export function createWorkRouteBindings(io?: WorkRouteBindingIo) {
  const store = createWorkPathStore(io || {});
  return {
    note: function (input: any): Promise<unknown> {
      try {
        return store.note(input || {}) as Promise<unknown>;
      } catch {
        return Promise.resolve({ ok: false, reason: 'threw' });
      }
    },
    release: function (input: any): Promise<unknown> {
      try {
        return store.release(input || {}) as Promise<unknown>;
      } catch {
        return Promise.resolve({ ok: false, reason: 'threw' });
      }
    },
    read: async function (input: any): Promise<unknown> {
      try {
        const sid = input ? String(input.sessionId || '') : '';
        const rkey = input ? String(input.rootKey || '') : '';
        const at = input && typeof input.at === 'number' ? input.at : Date.now();
        const info: any = await (store as any).readSnapshotInfo({ rootKey: rkey, sessionId: sid });
        // 读不出来（读盘失败或盘上文件形状不认识）要如实回 ok:false：给空表会让人以为「这个工作区
        // 没在办票」，而其实是这次没读成。文件不存在仍是正常情况，回空表。
        if (info && info.failed === true) return { ok: false, reason: 'read-failed' };
        const readout = buildWorkPathReadout(info ? info.ledger : null, { sessionId: sid, at: at });
        return { ok: true, readout: readout, summary: buildWorkPathSummary(readout), collisionNote: buildWorkPathCollisionNote(readout) };
      } catch {
        return { ok: false, reason: 'read-failed' };
      }
    },
  };
}
