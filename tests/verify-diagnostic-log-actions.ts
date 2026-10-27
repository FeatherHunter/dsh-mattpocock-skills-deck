/**
 * tests/verify-diagnostic-log-actions.ts —— 诊断日志跑腿层的单测（对应 src/client/views/diagnosticLog/diagnosticLogActions.ts）。
 *
 * 为什么要有它：跑腿把原来设置页里 toggleDbg 与 do 开头那一串分支原样搬了出来（拨开关三条落定路、
 * 导出成功与回退、打开目录未知、复制抛错、清空三句不同的话、忙时互斥）。这里任何一条红了，
 * 说明搬运改了行为，必须先修再往下走。
 *
 * 测法：直接 import 跑腿（它没有任何跨文件的值依赖，七组世界全从参数进），判据那一组喂真的模型函数，
 * 其余六组喂假的（宿主可编程、提示只记录、钟固定在 2026-10-15、剪贴板可抛错、界面状态用真的小仓库）。
 * 异步动作要等几拍才落定（打开那条链最长），每组断言前先 flush。
 *
 * 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-diagnostic-log-actions.ts。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_REL = 'src/client/views/diagnosticLog/diagnosticLogModel.ts';
const ACTIONS_REL = 'src/client/views/diagnosticLog/diagnosticLogActions.ts';
// #1582：跑腿层把「发宿主打开文件夹」交给注入的共用函数；这份门禁直接 import 真叶子喂进去（不手抄替身）。
const OPEN_FOLDER_REL = 'src/client/views/shared/openFolder.ts';
let realOpenFolderAt: any = null;

let failed = false;
let total = 0;
function check(ok: unknown, msg: string): void {
  total += 1;
  console.log(((ok ? '  PASS ' : '  FAIL ') + msg) as string);
  if (!ok) failed = true;
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
}

interface FakeUiState {
  busy: string | null;
  pending: boolean;
  flash: '' | 'ok' | 'warn';
  clearAsked: boolean;
  lastExport: { dir: string; fileName: string; fallback: boolean } | null;
}

function buildWorld(model: Record<string, (...args: never[]) => unknown>) {
  const flashes: Array<{ message: string; kind: string }> = [];
  const infos: Array<{ method: string; kind: string }> = [];
  const warns: Array<{ method: string; kind: string }> = [];
  const fails: Array<{ op: string; reason: string }> = [];
  const copies: Array<string> = [];
  const afters: Array<{ ms: number; fn: () => void }> = [];
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const uiState: FakeUiState = { busy: null, pending: false, flash: '', clearAsked: false, lastExport: null };
  // 每一场的宿主表现不同，开场前由用例亲手设定（readyResult / handler / copyThrow / switchBehavior）。
  const box: {
    readyResult: boolean;
    handler: (method: string, args: Record<string, unknown>) => Promise<unknown>;
    copyThrow: boolean;
    switchBehavior: 'ok' | 'reject' | 'throw' | 'stale';
  } = {
    readyResult: true,
    handler: async () => ({ ok: true }),
    copyThrow: false,
    switchBehavior: 'ok',
  };
  // #1582：共用打开函数的替身也要真发宿主电话，所以把「记一笔 + 交 box.handler」抽成一个名字，
  //   host.call 与下面 openFolder 替身共用它（既有断言量 w.calls[0] 仍然是那一发）。
  const callHost = (method: string, args: Record<string, unknown>) => {
    calls.push({ method, args });
    return box.handler(method, args);
  };
  const deps = {
    host: {
      ready: () => box.readyResult,
      call: callHost,
    },
    tell: {
      tr: (key: string, params?: Record<string, string | number>) =>
        params && params['file'] !== undefined ? key + ':' + String(params['file']) : key,
      flash: (message: string, kind: 'ok' | 'warn') => { flashes.push({ message, kind }); },
      info: (method: string, _lat: number, _ok: boolean, kind: string) => { infos.push({ method, kind }); },
      warn: (method: string, kind: string, _h: string) => { warns.push({ method, kind }); },
      exportFail: (op: string, reason: string, _e: unknown) => { fails.push({ op, reason }); },
      hash: (s: string) => 'h:' + s,
      trunc: (s: string) => s,
    },
    board: {
      copy: (text: string, _done: string) => {
        if (box.copyThrow) throw new Error('clipboard-down');
        copies.push(text);
      },
    },
    clock: {
      now: () => new Date(2026, 9, 15),
      after: (ms: number, fn: () => void) => { afters.push({ ms, fn }); },
    },
    ui: {
      get: () => ({ ...uiState }),
      set: (patch: Partial<FakeUiState>) => { Object.assign(uiState, patch); },
    },
    rules: {
      failKey: model['dbgSwitchFailKey'],
      toastKey: model['switchToastKey'],
      toastKind: model['switchToastKind'],
      todayName: model['todayName'],
      isTodayName: model['isTodayName'],
      canStart: model['canStartOp'],
      dirOf: model['exportDirOf'],
    },
    switchWriter: {
      write: (on: boolean) => {
        if (box.switchBehavior === 'throw') throw new Error('no-switch');
        if (box.switchBehavior === 'reject') return Promise.reject(new Error('switch-down'));
        if (box.switchBehavior === 'stale') return Promise.resolve({ ok: true, hostPushed: false, enabled: on });
        return Promise.resolve({ ok: true, hostPushed: true, enabled: on });
      },
    },
    // #1582：共用打开函数不手抄替身 —— 直接喂真叶子（main 里 import 进来），宿主替身用 callHost，
    //   这样「成功打开」那组既有断言（calls[0] 是 wf.openFolder）照旧成立，失败路径量的也是真实现。
    openFolder: (dir: string, report: (outcome: string, detail?: string) => void) => {
      if (typeof realOpenFolderAt !== 'function') throw new Error('共用函数没加载');
      return realOpenFolderAt({ call: callHost }, dir, report);
    },
  };
  return { deps, box, flashes, infos, warns, fails, copies, afters, calls, uiState };
}

async function main(): Promise<void> {
  const model = await import(pathToFileURL(path.join(ROOT, MODEL_REL)).href) as unknown as Record<string, (...args: never[]) => unknown>;
  const actions = await import(pathToFileURL(path.join(ROOT, ACTIONS_REL)).href) as unknown as {
    createDiagnosticLogOps: (deps: unknown) => {
      toggle(e: unknown): void; exportToday(): void; openDir(): void; copyPath(): void;
      askClear(): void; cancelClear(): void; confirmClear(): void;
    };
  };
  const leaf = await import(pathToFileURL(path.join(ROOT, OPEN_FOLDER_REL)).href) as { openFolderAt?: unknown };
  realOpenFolderAt = leaf.openFolderAt;
  const opsOf = (w: ReturnType<typeof buildWorld>) =>
    actions.createDiagnosticLogOps(w.deps as unknown);

  console.log('— 拨开关：三条落定路与两道门');
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.readyResult = false;
    ops.toggle({ target: { checked: true } });
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message === 'err.hostUnavailable', '宿主不在：弹那一句，不动手（写一笔都没发）');
    check(w.calls.length === 0, '宿主不在：宿主电话零次');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.uiState.pending = true;
    ops.toggle({ target: { checked: true } });
    await flush();
    check(w.calls.length === 0 && w.flashes.length === 0, '过渡锁还拿着：后来这次拨动没反应');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    ops.toggle({ target: { checked: true } });
    await flush();
    check(w.uiState.pending === false, '成功落定：过渡锁松开');
    check(w.uiState.flash === 'ok', '成功落定：行内闪绿（只看写进真源）');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgSwitchOnToast' && w.flashes[0].kind === 'ok', '成功且副本跟上：弹不带限定语那句，走绿');
    check(w.afters.length === 1 && w.afters[0].ms === 600, '闪光半秒自退：600 毫秒定时挂上');
    w.afters[0].fn();
    check(w.uiState.flash === '', '定时到：闪光熄灭');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.switchBehavior = 'stale';
    ops.toggle({ target: { checked: false } });
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgSwitchOffNoHost', '副本没跟上：关方向弹带限定语那句，方向不写反');
    check(w.flashes[0].kind === 'warn', '副本没跟上：提示条走琥珀');
    check(w.uiState.flash === 'ok', '副本没跟上：行内照样闪绿（真源落地了，判据与提示条不同）');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.switchBehavior = 'reject';
    ops.toggle({ target: { checked: true } });
    await flush();
    check(w.uiState.pending === false, '写失败：过渡锁照样松开（不松开下一次拨不动）');
    check(w.uiState.flash === 'warn', '写失败：行内闪琥珀');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgSwitchFail', '写失败：弹通用失败那一句');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.switchBehavior = 'throw';
    ops.toggle({ target: { checked: true } });
    await flush();
    check(w.uiState.pending === false, '连写都没发出去：过渡锁照样松开');
    check(w.uiState.flash === '', '连写都没发出去：行内那一闪不动（原来就没动它）');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgSwitchFail', '连写都没发出去：照样弹通用失败');
  }

  console.log('— 导出：成功拼文件名、回退追加、失败记账');
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, fileName: 'dsh-2026-10-15.zip', fallback: false, summary: { header: { dir: 'C:/logs' } } });
    ops.exportToday();
    await flush();
    check(w.uiState.busy === null, '导出成功：忙让出来');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgExportOk:dsh-2026-10-15.zip' && w.flashes[0].kind === 'ok', '导出成功：弹那一句，文件名拼进去');
    check(w.uiState.lastExport !== null && w.uiState.lastExport.dir === 'C:/logs', '导出成功：回执记下来，供打开与复制复用');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, fileName: 'dsh-2026-10-15.log', fallback: true, summary: { header: { dir: 'C:/logs' } } });
    ops.exportToday();
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message.indexOf('cfg.dbgExportFallback') >= 0, '宿主不支持压缩：回退那一句追加在后面');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: false, error: 'export-not-ok' });
    ops.exportToday();
    await flush();
    check(w.uiState.busy === null, '导出失败：忙照样让出来');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgExportFail', '导出失败：弹失败那一句');
    check(w.fails.length === 1 && w.fails[0].op === 'export', '导出失败：失败上报记一笔');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.uiState.busy = 'openDir';
    ops.exportToday();
    await flush();
    check(w.calls.length === 0, '有动作在跑：后来者静默退，不排队');
  }

  console.log('— 打开与复制：目录复用、目录未知、复制抛错');
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.uiState.lastExport = { dir: 'C:/cached', fileName: 'a.zip', fallback: false };
    w.box.handler = async (method: string) => {
      if (method === 'wf.openFolder') return { ok: true };
      return { ok: true, summary: { header: { dir: 'C:/fresh' } } };
    };
    ops.openDir();
    await flush(8);
    check(w.calls.length === 1 && w.calls[0].method === 'wf.openFolder' && (w.calls[0].args as Record<string, unknown>)['cwd'] === 'C:/cached', '有缓存：直接用缓存目录，不再调导出');
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgOpenedDir', '打开成功：弹那一句');
    check(w.infos.length === 1 && w.infos[0].kind === 'log-resolve-cache', '缓存命中：记一条缓存的账');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: false });
    ops.openDir();
    await flush(8);
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgExportFail', '目录解析不出来：弹失败，不碰宿主打开');
    check(w.fails.length >= 1 && w.fails[w.fails.length - 1].op === 'openDir', '目录未知：失败上报记在打开名下');
    check(w.uiState.busy === null, '目录未知：忙照样让出来');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, summary: { header: { dir: 'D:/data/' } } });
    ops.copyPath();
    await flush(8);
    check(w.copies.length === 1 && w.copies[0] === 'D:/data/logs', '复制：尾巴斜杠清干净再拼，抄走的是拼好的那一级');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, summary: { header: { dir: 'D:/data' } } });
    w.box.copyThrow = true;
    ops.copyPath();
    await flush(8);
    check(w.flashes.length === 1 && w.flashes[0].message === 'toast.copyFailed', '剪贴板抛错：弹复制失败，不弹目录失败');
    check(w.fails.length === 1 && w.fails[0].op === 'copyPath' && w.fails[0].reason === 'copy-fail', '剪贴板抛错：失败上报记在复制名下');
  }

  console.log('— 清空：问、取消、确认三句话');
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.uiState.busy = 'export';
    ops.askClear();
    check(w.uiState.clearAsked === false, '有动作在跑：点清空没反应');
    w.uiState.busy = null;
    ops.askClear();
    check(w.uiState.clearAsked === true, '空闲：点清空弹出二次确认');
    ops.cancelClear();
    check(w.uiState.clearAsked === false, '取消：确认收回去');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.readyResult = false;
    ops.confirmClear();
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message === 'err.hostUnavailable', '宿主不在：弹那一句，确认收回去');
    check(w.uiState.clearAsked === false, '宿主不在：确认收回去，不悬着');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, removed: 0 });
    ops.askClear();
    ops.confirmClear();
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgClearEmpty', '当天没东西：弹「没东西可清」那一句，不是成功那一句');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.box.handler = async () => ({ ok: true, removed: 2 });
    ops.askClear();
    ops.confirmClear();
    await flush();
    check(w.flashes.length === 1 && w.flashes[0].message === 'cfg.dbgClearOk', '清掉两份：弹成功那一句');
    check((w.calls[0].args as Record<string, unknown>)['date'] === '2026-10-15', '清空带当天文件名（钟固定在 2026-10-15）');
  }
  {
    const w = buildWorld(model);
    const ops = opsOf(w);
    w.uiState.busy = 'export';
    ops.confirmClear();
    await flush();
    check(w.calls.length === 0, '有动作在跑：确认清空没反应');
  }

  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'));
  if (failed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('  FAIL 异常：' + ((e as Error)?.stack || String(e)));
  process.exit(1);
});
