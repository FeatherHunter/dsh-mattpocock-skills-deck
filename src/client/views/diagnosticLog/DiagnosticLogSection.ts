/**
 * DiagnosticLogSection.ts —— 调试 / 诊断日志分组（原来 SettingsPage.js 沉底那一组，原样搬运）。
 *
 * 这一份只管两件事：抱住原来那五个 useState（开关过渡、忙互斥、清空确认、行内闪光、导出回执），
 * 把世界接好递给跑腿（diagnosticLogActions.ts 的 createDiagnosticLogOps），再把原来那一组
 * JSX 原样画出来。判据一条不留在这里，全在模型与跑腿里；这里只有接线。
 *
 * 跨叶子的值引用按仓里规矩写模块级 declare（实现只在闭包里有一份，类型检查各看各的）：
 * 全局已声明的（React、DswsCtx、tr、host、log、dswsLogHash、dswsLogTrunc）直接用；
 * 下面这几行是本文件自己声明的。
 */
import type {
  DiagnosticLocaleKey,
  LogBusy,
} from './diagnosticLogModel.js';
import type {
  DiagnosticLogDeps,
  DiagnosticLogLastExport,
  DiagnosticLogOps,
} from './diagnosticLogActions.js';

// 跑腿的建构函数是同闭包里另一片叶子（diagnosticLogActions.ts）定义的：这里只声明形状供类型检查，
// 运行时走闭包作用域，不写值 import（转译后残留的值 import 会被拼接检查判红）。

declare function useStore(sessionId?: unknown): unknown;
declare function settingsDebugRetryHost(): void;
declare function readLocalDebugSwitch(): { enabled?: unknown };
declare const logSwitch: { enabled?: unknown } | null | undefined;
declare function settingsDebugToggle(on: boolean, level: number): Promise<unknown>;
declare function setLogSwitch(on: boolean, level: number): Promise<unknown>;
declare function flash(store: unknown, message: string, kind: 'ok' | 'warn'): void;
declare function copyText(store: unknown, text: string, doneMessage: string): void;
declare function logExportFail(op: string, reason: string, err: unknown): void;
declare const Ic: (props: { n: string; size: number }) => unknown;
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function dbgSwitchFailKey(res: unknown): DiagnosticLocaleKey;
declare function switchToastKey(res: unknown): DiagnosticLocaleKey;
declare function switchToastKind(res: unknown): 'ok' | 'warn';
declare function todayName(now: Date): string;
declare function isTodayName(name: unknown): boolean;
declare function canStartOp(busy: LogBusy): boolean;
declare function exportDirOf(res: unknown): string;
declare function createDiagnosticLogOps(deps: DiagnosticLogDeps): DiagnosticLogOps;

/**
 * 调试分组（props 只有一个：sessionId，给订阅 store 用）。
 * 状态、重试口子、开关初值、世界接线、分组 JSX，全是原来设置页里那一份，行为一字不差。
 */
export const DiagnosticLogSection = (props: { sessionId?: unknown }): unknown => {
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
  const sessionId = props ? props.sessionId : undefined;
  const sharedSt = cx ? cx.storeSvc.useStore(sessionId) : useStore(sessionId);
  // #492调试分组：开关秒显读内存这一份（构建产物里的 logSwitch），拨动走 settingsDebugToggle 写进
  //   本机设置文件的 debug 节（#1012 第 8 条：#1432 起这是唯一一处真源，宿主开机直接读它，不再另存一份开关），底座广播刷新；
  //   导出日志那四键仍走宿主电话。
  const [dbgPending, setDbgPending] = React.useState(false);
  const [dbgBusy, setDbgBusy] = React.useState(null);
  const [clearAsked, setClearAsked] = React.useState(false);
  // #951：开关落定后行内闪光（成功绿跟提示 ok 同色，失败琥珀跟提示 warn 同色，半秒自退）
  const [dbgFlash, setDbgFlash] = React.useState('');
  const [lastExport, setLastExport] = React.useState(null);
  // 宿主没收到开关改动时的自愈口子（#1012 第 8 条）：这一页每次重新画一遍就跑一次 —— 故意不写依赖数组。
  //   为什么不写：DSH 宿主那侧的设置对话框不在本仓，「设置分组每次打开都会重新挂载这一页」只是本仓的推断、
  //   核不了；若它其实是一直挂着，只挂载跑一次的口子在同一次挂载里就没有第二次机会，文案里那句
  //   「下一次机会会自动重推」会变成做不到的承诺。改成每次渲染都跑，页面重画一遍就够。
  //   为什么不会打转：这个口子只在确实没接上时才推，推完不改任何 state（失败只记一行日志），它自己引不出
  //   下一次渲染；渲染次数由用户操作与既有状态更新决定，所以推的次数与渲染次数同阶，不会自续。
  //   为什么「下一次机会」一定来得到：拨开关那三个分支（成功 then 里、失败 catch 里、同步 catch 里）都无条件
  //   调 setDbgPending(false)，而进 toggleDbg 时 dbgPending 必为真 —— 所以失败之后必有一次渲染，口子也就必跑一次。
  //   三条分支门禁各量到哪几条（2026-10-12 复核第四轮逐条实测，别当成三条都有人看着）：
  //   ① 成功 then 那条量得到（删掉它门禁会红一片）；② 失败 catch 那条这次补上了（第十九件事第八段把「等宿主
  //   回话」那颗 5000 毫秒定时器换成抛错，逼出「整趟被拒」，这时成功分支一个字都没跑、只有 .catch 能收场；
  //   把它短路第八段会红 —— 第七段量不到这一行，它自己的注释里写着）；③ 同步 catch 那条量不到 —— 现行产物里走不到那一行
  //   （settingsDebugToggle 自己吞掉全部异常，包里 setLogSwitch 也只回 { ok: false } 不 reject，内部每一步
  //   都包了 catch），门禁没有能把语句抛进那行 catch 的入口，要覆盖得给产品加一个注入口，属另一件事。
  //   谁删掉或短路了其中某条，自愈会跟着失效，改这一段务必连门禁一起看。
  React.useEffect(function () {
    try { if (typeof settingsDebugRetryHost === 'function') settingsDebugRetryHost(); } catch (eRetry) { /* 重试口子自己会记账，这里不挡渲染 */ }
  });
  const dbgChecked = (function () {
    try { if (typeof logSwitch !== 'undefined' && logSwitch) return logSwitch.enabled === true; } catch (eDbg) { /* 读内存失败就走文件 */ }
    try { return !!readLocalDebugSwitch().enabled; } catch (eDbg2) { return false; }
  })();

  // 世界接线：七组里每一格都包一层闭包里的原调用，跑腿只认这七组，不直接碰闭包。
  const deps: DiagnosticLogDeps = {
    host: {
      ready: function () { try { return !!(typeof host !== 'undefined' && host && host.call); } catch (eDbg) { return false; } },
      call: function (method: string, args: Record<string, unknown>) { return host.call(method, args); },
    },
    tell: {
      tr: function (key: string, params?: Record<string, string | number>) { return tr(key, params); },
      flash: function (message: string, kind: 'ok' | 'warn') { flash(sharedSt, message, kind); },
      info: function (method: string, latencyMs: number, ok: boolean, kind: string) {
        try { log('info', 'host.call', { method: method, latencyMs: latencyMs, ok: ok, kind: kind }); } catch (eL) { /* 记账失败不挡主流程 */ }
      },
      warn: function (method: string, kind: string, errorHash: string) {
        try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: errorHash }); } catch (eL) { /* 同上 */ }
      },
      exportFail: function (op: string, reason: string, err: unknown) {
        try { if (typeof logExportFail === 'function') logExportFail(op, reason, err); } catch (eDbg2) { /* 老产物没有这个上报口，不挡主流程 */ }
      },
      hash: function (text: string) { return dswsLogHash(text); },
      trunc: function (text: string, n: number, kind: string) { return dswsLogTrunc(text, n, kind); },
    },
    board: {
      copy: function (text: string, doneMessage: string) { copyText(sharedSt, text, doneMessage); },
    },
    clock: {
      now: function () { return new Date(); },
      after: function (ms: number, fn: () => void) { setTimeout(fn, ms); },
    },
    ui: {
      get: function () {
        return {
          busy: (dbgBusy as LogBusy | null) as LogBusy,
          pending: !!dbgPending,
          flash: (dbgFlash as '' | 'ok' | 'warn'),
          clearAsked: !!clearAsked,
          lastExport: (lastExport as DiagnosticLogLastExport | null),
        };
      },
      set: function (patch) {
        if (patch.busy !== undefined) setDbgBusy(patch.busy);
        if (patch.pending !== undefined) setDbgPending(patch.pending);
        if (patch.flash !== undefined) setDbgFlash(patch.flash);
        if (patch.clearAsked !== undefined) setClearAsked(patch.clearAsked);
        if (patch.lastExport !== undefined) setLastExport(patch.lastExport);
      },
    },
    rules: {
      failKey: function (res: unknown) { return dbgSwitchFailKey(res); },
      toastKey: function (res: unknown) { return switchToastKey(res); },
      toastKind: function (res: unknown) { return switchToastKind(res); },
      todayName: function (now: Date) { return todayName(now); },
      isTodayName: function (name: unknown) { return isTodayName(name); },
      canStart: function (busy: LogBusy) { return canStartOp(busy); },
      dirOf: function (res: unknown) { return exportDirOf(res); },
    },
    switchWriter: {
      write: function (on: boolean) {
        // 拨开关走 kernel/settings-debug.js 的 settingsDebugToggle（#1012 第 8 条）：真源是本机设置文件的
        //   debug 节，它先把这一笔写进文件，文件这条路接不下才原样退回包里的 setLogSwitch（老路）。
        //   两个名字都认：老产物里没有新名字，新产物里那个才是主路，返回形状两者一致。
        const dbgSwitch = (typeof settingsDebugToggle === 'function')
          ? settingsDebugToggle
          : ((typeof setLogSwitch === 'function') ? setLogSwitch : null);
        if (typeof dbgSwitch !== 'function') throw new Error('no-switch');
        return dbgSwitch(on, 1);
      },
    },
  };
  const ops: DiagnosticLogOps = createDiagnosticLogOps(deps);

  // #492 沉底调试分组（布局文案沿 #334 原型：主开关默认关，写经 settingsDebugToggle（真源是本机设置文件的
  //   debug 节，宿主开机直接读它，见 #1012 第 8 条与 #1432），保存即广播；四键调宿主三电话加复用目录电话）
  return h('div', { className: 'dsws-cfg-group' }, [
    h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'gear', size: 13 }), h('span', null, tr('cfg.dbgTitle'))]),
    h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.dbgDesc')),
    h('div', { className: 'dsws-cfg-row' + (dbgFlash === 'ok' ? ' dsws-fb-okflash' : '') + (dbgFlash === 'warn' ? ' dsws-fb-warnflash' : '') }, [
      h('label', { className: 'dsws-cfg-sw dsws-hov', 'data-press': 'switch' }, [
        // 点击日志挂在真实的 input 上，不挂在 label 上：点 label 文字时浏览器会先补发一次 label 的 click、再补发一次 input 的 click，
        //   挂在 label 会把一次点击记成两条；挂在 input 上正好只命中一次（label 自身的 click 里没有 data-log 可找）。
        h('input', { type: 'checkbox', 'data-log': 'settings.debug.toggle', checked: dbgChecked, disabled: !!(dbgPending || dbgBusy), onChange: ops.toggle }),
        h('span', { className: 'tr' }), h('span', null, tr(dbgChecked ? 'cfg.dbgSwitchOn' : 'cfg.dbgSwitchOff')),
      ]),
    ]),
    h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6, marginTop: 8 } }, [
      h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.export', disabled: !!dbgBusy, onClick: ops.exportToday }, tr('cfg.dbgExport')),
      h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.open', disabled: !!dbgBusy, onClick: ops.openDir }, tr('cfg.dbgOpen')),
      h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.copy', disabled: !!dbgBusy, onClick: ops.copyPath }, tr('cfg.dbgCopy')),
      h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.clear', disabled: !!dbgBusy, onClick: ops.askClear }, tr('cfg.dbgClear')),
    ]),
    h('div', { className: 'dsws-cfg-gdesc', style: { marginTop: 6 } }, tr('cfg.dbgPackageHint')),
    clearAsked ? h('div', { className: 'dsws-cfg-err', style: { marginTop: 8 } }, [
      h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.dbgClearTitle'))]),
      h('div', null, tr('cfg.dbgClearDesc')),
      h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } }, [
        // 清空确认里的「取消 / 确认清空」也是设置页上的可点控件：按同一套补按压与点击日志，
        //   日志名接在「清空今日日志」这颗按钮下面，点了哪一步在日志里分得清。
        h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.clear.cancel', onClick: ops.cancelClear }, tr('switch.cancel')),
        h('button', { className: 'dsws-cfg-btn', 'data-press': 'button', 'data-log': 'settings.log.clear.confirm', disabled: !!dbgBusy, onClick: ops.confirmClear }, tr('cfg.dbgConfirmClear')),
      ]),
    ]) : null,
  ]);
};
