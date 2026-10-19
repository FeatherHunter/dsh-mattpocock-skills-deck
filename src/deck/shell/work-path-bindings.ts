// work-path-bindings.ts —— 工作路线两支依赖的装配工厂（#1261）。
//
// 为什么单列一份：宿主接线（wiring.ts）有效行已到 328，离 350 上限只剩 22 行，
// 存储创建 + 读出口拼装 + 两支容错包边展开要三十多行，直接写过去会顶超标。
// 本文件只做一件事：把存储（work-path-store.ts）与读出口（work-path-readout.ts）
// 合成工具壳要的那两支（workRouteNote / workRouteRead），输入输出形状见
// call-shell-types.ts 里那两处注释。文件读写与家目录仍由调用方注入，
// 本文件不直接碰 Node（生产由宿主接线给真实现，门禁给临时目录 + 固定时钟）。

import { createWorkPathStore } from './work-path-store.js';
import { buildWorkPathReadout, buildWorkPathSummary } from './work-path-readout.js';

export interface WorkRouteBindingIo {
  homeDir?: string;
  now?: () => number;
  readFile?: (path: string) => Promise<string | null>;
  writeFile?: (path: string, text: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
}

/** 合成壳要的两支：note 原样交存储（存储自己永不抛，这里不再包第二层）；read 拼快照 + 读出口 + 摘要。 */
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
    read: function (input: any): unknown {
      try {
        const sid = input ? String(input.sessionId || '') : '';
        const rkey = input ? String(input.rootKey || '') : '';
        const at = input && typeof input.at === 'number' ? input.at : Date.now();
        const readout = buildWorkPathReadout(store.snapshot(rkey), { sessionId: sid, at: at });
        return { ok: true, readout: readout, summary: buildWorkPathSummary(readout) };
      } catch {
        return { ok: false, reason: 'read-failed' };
      }
    },
  };
}
