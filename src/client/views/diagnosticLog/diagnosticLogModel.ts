/**
 * views/diagnosticLog/diagnosticLogModel.ts —— 诊断日志的纯推演层（由 SettingsPage.js 与 views/shared/DebugSwitchFailHint.js 搬出）。
 *
 * 为什么这件事要收在一处：设置页的调试分组与状态栏的小灰点菜单是同一功能的两个挂载点，
 * 它们今天各写了一套「失败码翻文案、今天日期怎么算、开关结果弹哪一句」的判定。两处各写一份，
 * 改一句文案要改两处，迟早漂移成两处各说各话，所以判定只写一遍，两处都调同一份。
 *
 * 纯的意思是这一份不碰任何环境：不读宿主电话、不读剪贴板、不读当前时间、不调界面提示。
 * 当前时刻由调用方传进来（见 todayName 的参数），宿主回包以 unknown 进来、内部先收窄再用。
 * 做到这一点，测试不需要造会话、不需要起宿主，只喂值、看返回值（见 tests/verify-diagnostic-log-model.ts）。
 *
 * 拼进闭包的规矩（#1207）：这一份是文本拼接进 client.js 的片段，不是模块加载，所以不许出现
 * 运行时的 import（类型层面的 `import type` 会被转译抹掉，可以用）；行首只能写 `export <声明>`
 * 这种形式，`export {…}` / `export default` 在这里拼出来是语法错的文本，构建会当场拦住。
 */

/** 写开关失败时底座回的机器码（与 npm 包 dsh-log 里那份分类同形，见 kernel/log.js 的 setLogSwitch）。 */
export type LogFailureCode =
  | 'host-unavailable'
  | 'throw-connection'
  | 'switch-timeout'
  | 'host-rejected'
  | 'stale'
  | 'throw-unknown-endpoint';

/** 诊断日志这一件事用到的界面词条键（设置页 `cfg.dbg*` 与状态栏 `logmenu.*` 两族，共用同一套失败翻译）。 */
export type DiagnosticLocaleKey = string;

/** 四个日志动作的规范名（设置页四个按钮与状态栏四个菜单行是同一组意图，只是挂载点不同）。 */
export type LogOp = 'export' | 'openDir' | 'copyPath' | 'clear';

/** 四个动作的固定顺序（按钮与菜单都按这个顺序画，加动作只加这一行，不改两处画法）。 */
export const LOG_OPS: readonly LogOp[] = ['export', 'openDir', 'copyPath', 'clear'];

/** 哪个动作正在跑（null 表示空闲；一次只跑一个，后来的必须等，这就是 guardOp 与 busy 的那条互斥）。 */
export type LogBusy = LogOp | null;

/**
 * 失败码翻词条的对照表（#597 由 SettingsPage.js 拆出时的原表，原样搬过来，一个键都不增减）。
 * 底座回的只是机器码，不回面向用户的话；界面靠这张表把「哪一类失败」说清楚，
 * 而不是每次都一句笼统的「开关保存失败，请重试」。
 */
export const DBG_SWITCH_FAIL_KEY: Record<LogFailureCode, DiagnosticLocaleKey> = {
  'host-unavailable': 'cfg.dbgSwitchFailNoHost',
  'throw-connection': 'cfg.dbgSwitchFailNoHost',
  'switch-timeout': 'cfg.dbgSwitchFailTimeout',
  'host-rejected': 'cfg.dbgSwitchFailRejected',
  'stale': 'cfg.dbgSwitchFailStale',
  'throw-unknown-endpoint': 'cfg.dbgSwitchFailUnknownEndpoint',
};

/** 认不出的码（含通用抛错）一律回落的通用句（与拆出前一致，界面行为零变化）。 */
export const DBG_SWITCH_FAIL_FALLBACK: DiagnosticLocaleKey = 'cfg.dbgSwitchFail';

/** 判断一个值是不是「可以读字段的对象」（宿主回包进来第一步先过这一关，不直接当对象用）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 拨开关失败时挑哪条提示（原 DebugSwitchFailHint.js 的 dbgSwitchFailKey，原样搬运）。
 * 输入是底座回的那一包（成功时 `{ ok: true, … }`，失败时 `{ ok: false, error: '<机器码>' }`），
 * 认得的码翻成那一类的词条，认不出的码回落通用句，不抛错。
 */
export function dbgSwitchFailKey(res: unknown): DiagnosticLocaleKey {
  if (!isRecord(res)) return DBG_SWITCH_FAIL_FALLBACK;
  const code = String(res['error'] || '');
  if (
    code === 'host-unavailable' ||
    code === 'throw-connection' ||
    code === 'switch-timeout' ||
    code === 'host-rejected' ||
    code === 'stale' ||
    code === 'throw-unknown-endpoint'
  ) {
    return DBG_SWITCH_FAIL_KEY[code];
  }
  return DBG_SWITCH_FAIL_FALLBACK;
}

/**
 * 当天日志的文件名（`yyyy-MM-dd`，与宿主落盘的那一份同形，见 StatusLogMenu.js 的 dswsLogToday）。
 * 当前时刻由调用方传进来，模块自己不读钟：同一时刻传进来永远得到同一串，测试才测得住；
 * 调用方传 `new Date()`，行为与原来在函数里自己 `new Date()` 一字不差。
 */
export function todayName(now: Date): string {
  const pad = function (n: number): string {
    return String(n).padStart(2, '0');
  };
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

/**
 * 是不是合法的当天文件名（清空动作动手前先过这一关：名字不合形就不调电话，直接报清空失败）。
 * 判据与原来两处（SettingsPage.js 的 doClearConfirm、StatusLogMenu.js 的 doConfirmClear 经 wf.logClear 的那条路）
 * 用的同一条正则，原样搬过来。
 */
export function isTodayName(name: unknown): name is string {
  return typeof name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(name);
}

/**
 * 拨开关落定后弹哪一句（原 SettingsPage.js 里 toggleDbg 成功分支那条嵌套三元，原样搬成具名函数）。
 * 三个分支各说各的，不许互相借用文案：成功且宿主副本跟上了，弹不带限定语的那句；
 * 成功但副本没跟上，弹带限定语的那句（开、关两个方向各一句，方向写反会把话说反）；
 * 失败了走上面的失败翻译，不弹成功句。
 */
export function switchToastKey(res: unknown): DiagnosticLocaleKey {
  if (!isRecord(res) || res['ok'] !== true) return dbgSwitchFailKey(res);
  if (res['hostPushed'] === false) {
    return res['enabled'] === true ? 'cfg.dbgSwitchOnNoHost' : 'cfg.dbgSwitchOffNoHost';
  }
  return res['enabled'] === true ? 'cfg.dbgSwitchOnToast' : 'cfg.dbgSwitchOffToast';
}

/**
 * 拨开关落定后提示条的颜色档（原 SettingsPage.js 里 flash 那一句：成功且副本跟上才走 ok，其余走 warn）。
 * 成功但副本没跟上时走 warn 是有意的：那不是一次完全的成功，绿色会骗人。
 * 注意它与行内那一闪不是同一个东西：行内那一闪只看写进真源成功没有（成功就绿），
 * 提示条这一档还要看宿主副本跟上没有。两处判据不同，不要合并成一个。
 */
export function switchToastKind(res: unknown): 'ok' | 'warn' {
  if (!isRecord(res) || res['ok'] !== true) return 'warn';
  return res['hostPushed'] === false ? 'warn' : 'ok';
}

/**
 * 这个动作现在能不能动手（原来 guardOp 里 `if (dbgBusy) return false` 那一句，加上清空问与确认的两处）。
 * 一次只跑一个日志动作：导出跑着的时候点清空必须没反应，而不是排队，保证一次只记一行账。
 */
export function canStartOp(busy: LogBusy): boolean {
  return busy === null;
}

/**
 * 从导出回包里取出日志目录（原 SettingsPage.js 的 dirOfExport，原样搬运）。
 * 宿主回包里目录藏在三层里面（summary.header.dir），外面拼上 `/logs` 才是打开与复制要用的那一级；
 * 尾巴上的斜杠先清干净再拼，不然会拼出双斜杠。取不到就给空串，调用方按「目录未知」处理，不抛错。
 */
export function exportDirOf(res: unknown): string {
  try {
    if (!isRecord(res)) return '';
    const summary = res['summary'];
    if (!isRecord(summary)) return '';
    const header = summary['header'];
    if (!isRecord(header)) return '';
    const dir = header['dir'];
    if (typeof dir !== 'string' || dir === '') return '';
    return dir.replace(/\/+$/, '') + '/logs';
  } catch (ignored) {
    return '';
  }
}
