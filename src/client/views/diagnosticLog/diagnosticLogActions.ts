/**
 * diagnosticLogActions.ts —— 诊断日志五个动作的跑法（不纯的那一半：调宿主、弹提示、写剪贴板、读写界面状态）。
 *
 * 它与同目录的 diagnosticLogModel.ts 是刻意拆开的两半：模型只做推演（给值、回值，不碰世界），
 * 这一份只做跑腿（按模型的判据去调宿主、弹提示）。跑腿需要世界，所以世界从参数里递进来，
 * 一共八组，各管一摊，换一摊只动它自己的那几个小函数：
 * - host：宿主在不在、替我喊宿主的方法；
 * - tell：文案与提示（翻译、弹条、记账、失败上报、脱敏两件套）；
 * - board：剪贴板；
 * - clock：现在几点、几百毫秒后叫我；
 * - ui：界面状态的读写（忙碌、开关中的过渡、行内闪光、清空确认、最近一次导出的回执）；
 * - rules：纯判据（调用方把模型那份函数递进来，不在这里 import）；
 * - switchWriter：拨开关真正写进去的那一笔（调用方把闭包里的 settingsDebugToggle 递进来）；
 * - openFolder：打开文件夹的共用函数（#1582 收敛出来的 openFolderAt，调用方包一层递进来）。
 *
 * 为什么纯判据也要递进来、而不直接 import 模型：产物是把各文件逐个转译后按序拼进同一个闭包，
 * 跨文件的「值引用」只能走拼完后的闭包作用域，文件里出现 `import {函数} from './模型'`
 * 转译后会原样留下一句 import，拼接检查直接判红。所以类型走 `import type`（转译时整句抹掉，
 * 只给类型检查看），值一律走参数（运行时闭包里本来就有）。本文件因此没有任何跨文件的值依赖，
 * 单测可以直接 import 它，喂假的七组、真的模型函数，断它的分支走得对不对。
 */
import type {
  DiagnosticLocaleKey,
  LogBusy,
} from './diagnosticLogModel.js';

/** 宿主：探活与远程调用。args 只传纯数据，不传函数（宿主边界只走可序列化的数据）。 */
export interface DiagnosticLogHost {
  ready(): boolean;
  call(method: string, args: Record<string, unknown>): Promise<unknown>;
}

/** 文案与提示：翻译、弹条、记账、失败上报、错误脱敏（截断与哈希）都收在这里。 */
export interface DiagnosticLogTell {
  tr(key: string, params?: Record<string, string | number>): string;
  flash(message: string, kind: 'ok' | 'warn'): void;
  info(method: string, latencyMs: number, ok: boolean, kind: string): void;
  warn(method: string, kind: string, errorHash: string): void;
  exportFail(op: string, reason: string, err: unknown): void;
  hash(text: string): string;
  trunc(text: string, n: number, kind: string): string;
}

/** 剪贴板：把目录抄走，抄完弹哪一句由调用方定好传进来。 */
export interface DiagnosticLogBoard {
  copy(text: string, doneMessage: string): void;
}

/** 钟：现在几点（清空动作要当天文件名）、几百毫秒后叫我（行内闪光熄灭用）。 */
export interface DiagnosticLogClock {
  now(): Date;
  after(ms: number, fn: () => void): void;
}

/** 最近一次导出的回执：目录给打开与复制复用，文件名与回退标记给导出成功那一句拼文案。 */
export interface DiagnosticLogLastExport {
  dir: string;
  fileName: string;
  fallback: boolean;
}

/** 界面状态一共五格：四个动作的忙碌互斥、开关写一半的过渡、行内闪光、清空二次确认、导出回执。 */
export interface DiagnosticLogUiState {
  busy: LogBusy;
  pending: boolean;
  flash: '' | 'ok' | 'warn';
  clearAsked: boolean;
  lastExport: DiagnosticLogLastExport | null;
}

/** 界面状态读写：整份读出一份快照，改哪几格就递哪几格（异步回调里永远读最新的，不拿陈旧的闭包值）。 */
export interface DiagnosticLogUi {
  get(): DiagnosticLogUiState;
  set(patch: Partial<DiagnosticLogUiState>): void;
}

/** 纯判据：调用方把模型那份函数原样递进来（failKey/toastKey/toastKind/todayName/isTodayName/canStart/dirOf）。 */
export interface DiagnosticLogRules {
  failKey(res: unknown): DiagnosticLocaleKey;
  toastKey(res: unknown): DiagnosticLocaleKey;
  toastKind(res: unknown): 'ok' | 'warn';
  todayName(now: Date): string;
  isTodayName(name: unknown): boolean;
  canStart(busy: LogBusy): boolean;
  dirOf(res: unknown): string;
}

/** 拨开关写进去的那一笔：调用方把闭包里的开关写入函数包一层递进来，返回宿主的回包。 */
export interface DiagnosticLogSwitchWriter {
  write(on: boolean): Promise<unknown>;
}

/**
 * 打开文件夹的共用函数（#1582）：真实现是闭包里的 openFolderAt（views/shared/openFolder.ts），
 * 由调用方（DiagnosticLogSection.ts）包一层递进来；单测喂替身。回调收 'missing' 或 'open-failed'，
 * 成功的 'opened' 只为保住本页打开成功时那一句提示（cfg.dbgOpenedDir）。
 */
export interface DiagnosticLogOpenFolder {
  (dir: string, report: (outcome: 'opened' | 'missing' | 'open-failed', detail?: string) => void): boolean;
}

/** 跑腿要的世界，一共八组（各组含义见上面各自的注释）。 */
export interface DiagnosticLogDeps {
  host: DiagnosticLogHost;
  tell: DiagnosticLogTell;
  board: DiagnosticLogBoard;
  clock: DiagnosticLogClock;
  ui: DiagnosticLogUi;
  rules: DiagnosticLogRules;
  switchWriter: DiagnosticLogSwitchWriter;
  openFolder: DiagnosticLogOpenFolder;
}

/** 开关拨动事件：只读 target.checked，其余一概不碰。 */
export interface DiagnosticLogToggleEvent {
  target?: { checked?: unknown } | null;
}

/** 五个动作（加清空的问与取消一共七个入口），名字与原来设置页里的 do 开头函数一一对应。 */
export interface DiagnosticLogOps {
  toggle(e: DiagnosticLogToggleEvent | null | undefined): void;
  exportToday(): void;
  openDir(): void;
  copyPath(): void;
  askClear(): void;
  cancelClear(): void;
  confirmClear(): void;
}

/** 宿主回包先收成记录再读格：不是记录就当空包处理，不抛错（调用方按失败分支走）。 */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null) return null;
  return v as Record<string, unknown>;
}

/** 「写进去了」只认 ok 格为 true，其余一律按失败走（含空包与字符串包）。 */
function writeOk(res: unknown): boolean {
  const r = asRecord(res);
  return !!r && r['ok'] === true;
}

/** 失败上报带的第三个参数：回包里有 error 格就带它，没有就带 'not-ok'（与原来 `(res && res.error) || 'not-ok'` 同义）。 */
function resErr(res: unknown): unknown {
  const r = asRecord(res);
  return (r && r['error']) || 'not-ok';
}

/** 异常转一句可记账的文字：有 message 拿 message，没有拿整个值（与原来 `String((e && e.message) || e)` 同义）。 */
function errText(e: unknown): string {
  const r = asRecord(e);
  const m = r ? r['message'] : undefined;
  return String(m || (e as unknown));
}

function exportFileName(res: unknown): string {
  const r = asRecord(res);
  const f = r ? r['fileName'] : undefined;
  return typeof f === 'string' ? f : '';
}

function exportFallback(res: unknown): boolean {
  const r = asRecord(res);
  return !!r && r['fallback'] === true;
}

function clearRemoved(res: unknown): number {
  const r = asRecord(res);
  const n = r ? r['removed'] : undefined;
  return typeof n === 'number' ? n : 0;
}

/**
 * 把五个动作绑到递进来的世界上（原来设置页里 guardOp、toggleDbg 与 do 开头那一串，原样搬运，行为一字不差）。
 * 互斥口径原样保留：拨开关、导出、打开、复制动手前都先过 guardOp（忙就静默退，宿主不在就弹一句）；
 * 清空的问与确认另有自己的忙检查（与原来 `if (dbgBusy)` 的两处一一对应，不要顺手加到别处，也不要删）。
 */
export function createDiagnosticLogOps(deps: DiagnosticLogDeps): DiagnosticLogOps {
  /**
   * 宿主不在先弹一句，人话，不动手（原来 guardOp 那两句：先看忙不忙，忙就静默退；再看宿主在不在）。
   * 忙时静默退是有意的：一次只跑一个动作，后来者没反应，而不是排队。
   */
  const guardOp = (): boolean => {
    if (!deps.rules.canStart(deps.ui.get().busy)) return false;
    if (!deps.host.ready()) {
      deps.tell.flash(deps.tell.tr('err.hostUnavailable'), 'warn');
      return false;
    }
    return true;
  };

  /** 把导出回执记下来：目录、文件名、回退标记（原来 rememberExport 那一句）。 */
  const rememberExport = (res: unknown): void => {
    const r = asRecord(res);
    if (!r) return;
    const summary = asRecord(r['summary']);
    const header = summary ? asRecord(summary['header']) : null;
    const dir = header && typeof header['dir'] === 'string' ? (header['dir'] as string) : '';
    deps.ui.set({
      lastExport: {
        dir,
        fileName: exportFileName(res),
        fallback: exportFallback(res),
      },
    });
  };

  /**
   * 静默取导出结果解析目录位置并缓存，不刷提示，供打开与复制复用（原来 resolveLogDir 那一段）。
   * 有缓存直接用（记一条缓存命中的账）；宿主不在、回包不 ok、目录取不到，都给空串，
   * 调用方按「目录未知」弹失败，不在这里弹。
   */
  const resolveLogDir = (): Promise<string> => {
    const cached = deps.ui.get().lastExport;
    if (cached && cached.dir) {
      deps.tell.info('wf.logExport', 0, true, 'log-resolve-cache');
      return Promise.resolve(cached.dir);
    }
    const t0 = deps.clock.now().getTime();
    if (!deps.host.ready()) {
      deps.tell.warn('wf.logExport', 'log-resolve', deps.tell.hash(deps.tell.trunc('host-unavailable', 120, 'error')));
      return Promise.resolve('');
    }
    try {
      return deps.host.call('wf.logExport', { format: 'zip' }).then((res) => {
        if (!writeOk(res)) {
          deps.tell.warn('wf.logExport', 'log-resolve', deps.tell.hash(deps.tell.trunc('export-not-ok', 120, 'error')));
          deps.tell.exportFail('resolve', 'export-not-ok', resErr(res));
          return '';
        }
        rememberExport(res);
        const dir = deps.rules.dirOf(res);
        deps.tell.info('wf.logExport', deps.clock.now().getTime() - t0, !!dir, 'log-resolve');
        if (!dir) {
          deps.tell.warn('wf.logExport', 'log-resolve', deps.tell.hash(deps.tell.trunc('path-missing', 120, 'error')));
          deps.tell.exportFail('resolve', 'path-missing', 'path-missing');
        }
        return dir;
      }).catch((e: unknown) => {
        deps.tell.warn('wf.logExport', 'log-resolve', deps.tell.hash(deps.tell.trunc(errText(e), 120, 'error')));
        deps.tell.exportFail('resolve', 'export-not-ok', e);
        return '';
      });
    } catch (eSync) {
      deps.tell.warn('wf.logExport', 'log-resolve', deps.tell.hash(deps.tell.trunc(errText(eSync), 120, 'error')));
      return Promise.resolve('');
    }
  };

  /** 拨开关（原来 toggleDbg 那一段：过渡锁、写、落定三句话，一个不少）。 */
  const toggle = (e: DiagnosticLogToggleEvent | null | undefined): void => {
    if (deps.ui.get().pending || !guardOp()) return;
    const next = !!(e && e.target && e.target.checked);
    deps.ui.set({ pending: true });
    try {
      deps.switchWriter.write(next).then((res) => {
        deps.ui.set({ pending: false });
        const ok = writeOk(res);
        // 行内那一闪只看写进真源成功没有（成功就绿）：判据与提示条那一档不同，不要合并。
        deps.ui.set({ flash: ok ? 'ok' : 'warn' });
        try {
          deps.clock.after(600, () => deps.ui.set({ flash: '' }));
        } catch (ignored) { /* 定时器挂不上，闪光多留一会儿，不挡主流程 */ }
        deps.tell.flash(deps.tell.tr(deps.rules.toastKey(res)), deps.rules.toastKind(res));
      }).catch(() => {
        deps.ui.set({ pending: false });
        deps.ui.set({ flash: 'warn' });
        try {
          deps.clock.after(600, () => deps.ui.set({ flash: '' }));
        } catch (ignored2) { /* 同上 */ }
        deps.tell.flash(deps.tell.tr('cfg.dbgSwitchFail'), 'warn');
      });
    } catch (errSync) {
      // 同步抛错（连写都没发出去）：过渡锁必须松开，弹通用失败；行内那一闪不动（原来就没动它）。
      deps.ui.set({ pending: false });
      deps.tell.flash(deps.tell.tr('cfg.dbgSwitchFail'), 'warn');
    }
  };

  /** 导出今日日志（原来 doExport 那一段）。 */
  const exportToday = (): void => {
    if (!guardOp()) return;
    deps.ui.set({ busy: 'export' });
    try {
      deps.host.call('wf.logExport', { format: 'zip' }).then((res) => {
        deps.ui.set({ busy: null });
        if (!writeOk(res)) {
          deps.tell.warn('wf.logExport', 'export', deps.tell.hash(deps.tell.trunc('export-not-ok', 120, 'error')));
          deps.tell.exportFail('export', 'export-not-ok', resErr(res));
          deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
          return;
        }
        rememberExport(res);
        let msg = deps.tell.tr('cfg.dbgExportOk', { file: exportFileName(res) });
        if (exportFallback(res)) msg = msg + ' ' + deps.tell.tr('cfg.dbgExportFallback');
        deps.tell.flash(msg, 'ok');
      }).catch((e: unknown) => {
        deps.tell.warn('wf.logExport', 'export', deps.tell.hash(deps.tell.trunc(errText(e), 120, 'error')));
        deps.ui.set({ busy: null });
        deps.tell.exportFail('export', 'export-not-ok', e);
        deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
      });
    } catch (eSync) {
      deps.ui.set({ busy: null });
      deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
    }
  };

  /** 打开日志目录（原来 doOpen 那一段：先静默解析目录，目录未知弹失败，不碰宿主打开）。 */
  const openDir = (): void => {
    if (!guardOp()) return;
    deps.ui.set({ busy: 'openDir' });
    resolveLogDir().then((dir) => {
      if (!dir) {
        deps.ui.set({ busy: null });
        deps.tell.exportFail('openDir', 'path-missing', 'path-missing');
        deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
        return;
      }
      // #1582：发宿主调用这一步交给共用函数（判空、只发一次、读回包都在它那里）。
      //   以前这里自己写 .then/.catch：宿主回 {ok:false} 那条路写得对，但四处入口里只有这一处对；
      //   收敛之后「读回包」这条规矩只维护一份，这一页的提示文案与记账口径保持不变。
      deps.openFolder(dir, (outcome, detail) => {
        deps.ui.set({ busy: null });
        if (outcome === 'opened') {
          deps.tell.flash(deps.tell.tr('cfg.dbgOpenedDir'), 'ok');
          return;
        }
        if (outcome === 'missing') {
          deps.tell.exportFail('openDir', 'path-missing', 'path-missing');
          deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
          return;
        }
        deps.tell.warn('wf.openFolder', 'open-path', deps.tell.hash(deps.tell.trunc(String(detail || 'not-ok'), 120, 'error')));
        deps.tell.exportFail('openDir', 'open-fail', detail);
        deps.tell.flash(deps.tell.tr('cfg.dbgOpenDirFail'), 'warn');
      });
    });
  };

  /** 复制日志路径（原来 doCopy 那一段：目录未知弹失败，抄剪贴板抛错弹复制失败）。 */
  const copyPath = (): void => {
    if (!guardOp()) return;
    deps.ui.set({ busy: 'copyPath' });
    resolveLogDir().then((dir) => {
      deps.ui.set({ busy: null });
      if (!dir) {
        deps.tell.exportFail('copyPath', 'path-missing', 'path-missing');
        deps.tell.flash(deps.tell.tr('cfg.dbgExportFail'), 'warn');
        return;
      }
      try {
        deps.board.copy(dir, deps.tell.tr('cfg.dbgCopied'));
      } catch (eSync) {
        deps.tell.exportFail('copyPath', 'copy-fail', eSync);
        deps.tell.flash(deps.tell.tr('toast.copyFailed'), 'warn');
      }
    });
  };

  /** 问清空（原来 doClearAsk：有动作在跑时点它没反应，而不是排队）。 */
  const askClear = (): void => {
    if (deps.rules.canStart(deps.ui.get().busy)) deps.ui.set({ clearAsked: true });
  };

  /** 取消清空（原来 doClearCancel）。 */
  const cancelClear = (): void => {
    deps.ui.set({ clearAsked: false });
  };

  /** 确认清空（原来 doClearConfirm：宿主不在、文件名不合形、当天没东西，三句不同的话）。 */
  const confirmClear = (): void => {
    if (!deps.rules.canStart(deps.ui.get().busy)) return;
    if (!deps.host.ready()) {
      deps.ui.set({ clearAsked: false });
      deps.tell.flash(deps.tell.tr('err.hostUnavailable'), 'warn');
      return;
    }
    const name = deps.rules.todayName(deps.clock.now());
    if (!deps.rules.isTodayName(name)) {
      deps.ui.set({ clearAsked: false });
      deps.tell.flash(deps.tell.tr('cfg.dbgClearFail'), 'warn');
      return;
    }
    deps.ui.set({ busy: 'clear' });
    try {
      deps.host.call('wf.logClear', { date: name }).then((res) => {
        deps.ui.set({ busy: null, clearAsked: false });
        if (!writeOk(res)) {
          deps.tell.warn('wf.logClear', 'clear', deps.tell.hash(deps.tell.trunc('clear-not-ok', 120, 'error')));
          deps.tell.flash(deps.tell.tr('cfg.dbgClearFail'), 'warn');
          return;
        }
        deps.tell.flash(deps.tell.tr(clearRemoved(res) > 0 ? 'cfg.dbgClearOk' : 'cfg.dbgClearEmpty'), 'ok');
      }).catch((e: unknown) => {
        deps.tell.warn('wf.logClear', 'clear', deps.tell.hash(deps.tell.trunc(errText(e), 120, 'error')));
        deps.ui.set({ busy: null, clearAsked: false });
        deps.tell.flash(deps.tell.tr('cfg.dbgClearFail'), 'warn');
      });
    } catch (eSync) {
      deps.ui.set({ busy: null, clearAsked: false });
      deps.tell.flash(deps.tell.tr('cfg.dbgClearFail'), 'warn');
    }
  };

  return { toggle, exportToday, openDir, copyPath, askClear, cancelClear, confirmClear };
}
