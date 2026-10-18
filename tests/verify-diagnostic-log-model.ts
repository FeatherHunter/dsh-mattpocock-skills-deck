/**
 * tests/verify-diagnostic-log-model.ts —— 诊断日志纯推演层的单测（对应 src/client/views/diagnosticLog/diagnosticLogModel.ts）。
 *
 * 为什么要有它：设置页调试分组与状态栏日志菜单的判定（失败码翻文案、当天文件名、开关结果弹哪一句）
 * 在重构中被收进同一份纯模块。纯的意思是它不碰宿主、不碰界面、不读钟，所以测试不需要造会话、
 * 不需要起宿主，只喂值、看返回值；这里任何一条红了，说明搬运改了行为，必须先修再往下走。
 *
 * 判据分六组：失败翻译对照表（含回落）、当天文件名与合法性、开关结果选句、提示条颜色档、
 * 导出回包取目录、动作互斥。
 * 另有一条静态扫描：纯侧源码里不许出现读钟、调宿主、碰界面的写法，出现即红（纯度丢了，单测就测不住了）。
 *
 * 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-diagnostic-log-model.ts。
 * 挂进 npm test / verify:parallel / verify-all / test:smoke 四个入口时钩子由那几处自动加上，不用自己写。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceText } from './lib/source-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_REL = 'src/client/views/diagnosticLog/diagnosticLogModel.ts';

let failed = false;
let total = 0;
function check(ok: unknown, msg: string): void {
  total += 1;
  console.log(((ok ? '  PASS ' : '  FAIL ') + msg) as string);
  if (!ok) failed = true;
}

async function main(): Promise<void> {
  const model = await import(pathToFileURL(path.join(ROOT, MODEL_REL)).href) as Record<string, (...args: never[]) => unknown>;

  const failKey = model['dbgSwitchFailKey'] as (res: unknown) => string;
  const toastKey = model['switchToastKey'] as (res: unknown) => string;
  const toastKind = model['switchToastKind'] as (res: unknown) => 'ok' | 'warn';
  const todayName = model['todayName'] as (now: Date) => string;
  const isTodayName = model['isTodayName'] as (name: unknown) => boolean;
  const canStartOp = model['canStartOp'] as (busy: unknown) => boolean;
  const exportDirOf = model['exportDirOf'] as (res: unknown) => string;
  const ops = model['LOG_OPS'] as readonly unknown[];
  const table = model['DBG_SWITCH_FAIL_KEY'] as Record<string, string>;
  const fallback = model['DBG_SWITCH_FAIL_FALLBACK'] as string;

  console.log('— 失败翻译对照表（与 #597 拆出时的原表一字不差）');
  check(table['host-unavailable'] === 'cfg.dbgSwitchFailNoHost', '没接上宿主翻成 NoHost 那一句');
  check(table['throw-connection'] === 'cfg.dbgSwitchFailNoHost', '连接抛错同样翻成 NoHost 那一句（与原表一致）');
  check(table['switch-timeout'] === 'cfg.dbgSwitchFailTimeout', '超时翻成 5 秒没回应那一句');
  check(table['host-rejected'] === 'cfg.dbgSwitchFailRejected', '拒收翻成宿主拒收那一句');
  check(table['stale'] === 'cfg.dbgSwitchFailStale', '被后来点击取代翻成那一句');
  check(table['throw-unknown-endpoint'] === 'cfg.dbgSwitchFailUnknownEndpoint', '未知端点翻成版本对不上的那一句');
  check(fallback === 'cfg.dbgSwitchFail', '回落句是通用的那一句');

  console.log('— 失败翻译函数（含回落，不抛错）');
  check(failKey({ ok: false, error: 'switch-timeout' }) === 'cfg.dbgSwitchFailTimeout', '按码翻句：超时');
  check(failKey({ ok: false, error: 'stale' }) === 'cfg.dbgSwitchFailStale', '按码翻句：取代');
  check(failKey({ ok: false, error: 'not-a-code' }) === 'cfg.dbgSwitchFail', '认不出的码回落通用句');
  check(failKey({ ok: false }) === 'cfg.dbgSwitchFail', '没有 error 格回落通用句');
  check(failKey(null) === 'cfg.dbgSwitchFail', '空包回落通用句，不抛错');
  check(failKey('switch-timeout') === 'cfg.dbgSwitchFail', '字符串包回落通用句，不抛错');

  console.log('— 当天文件名（时刻传参，同一时刻永远同一串）');
  check(todayName(new Date(2026, 0, 5)) === '2026-01-05', '月份与日期补零');
  check(todayName(new Date(2026, 11, 31)) === '2026-12-31', '年末那一天');
  check(todayName(new Date(2024, 1, 29)) === '2024-02-29', '闰年二月末');

  console.log('— 文件名合法性（与原来两处用的同一条正则）');
  check(isTodayName('2026-10-15') === true, '合形通过');
  check(isTodayName('2026-1-5') === false, '缺零不通过');
  check(isTodayName('今天') === false, '中文不通过');
  check(isTodayName('') === false, '空串不通过');
  check(isTodayName(null) === false, '空值不通过');
  check(isTodayName(20261015) === false, '数字不通过');

  console.log('— 开关结果选句（四个方向各说各的，不许借用）');
  check(toastKey({ ok: true, hostPushed: true, enabled: true }) === 'cfg.dbgSwitchOnToast', '成功且副本跟上：开，不带限定语');
  check(toastKey({ ok: true, hostPushed: true, enabled: false }) === 'cfg.dbgSwitchOffToast', '成功且副本跟上：关，不带限定语');
  check(toastKey({ ok: true, enabled: true }) === 'cfg.dbgSwitchOnToast', '老包没有 hostPushed 格：按跟上处理（向后兼容）');
  check(toastKey({ ok: true, hostPushed: false, enabled: true }) === 'cfg.dbgSwitchOnNoHost', '副本没跟上：开，带限定语');
  check(toastKey({ ok: true, hostPushed: false, enabled: false }) === 'cfg.dbgSwitchOffNoHost', '副本没跟上：关，带限定语，方向不写反');
  check(toastKey({ ok: false, error: 'host-rejected' }) === 'cfg.dbgSwitchFailRejected', '失败走翻译，不弹成功句');
  check(toastKey(null) === 'cfg.dbgSwitchFail', '空包走回落');

  console.log('— 提示条颜色档（成功且跟上才绿，其余琥珀；与行内那一闪判据不同，不要合并）');
  check(toastKind({ ok: true, hostPushed: true, enabled: true }) === 'ok', '完全成功走绿');
  check(toastKind({ ok: true, hostPushed: false, enabled: true }) === 'warn', '副本没跟上走琥珀（不是完全成功，绿色会骗人）');
  check(toastKind({ ok: false, error: 'stale' }) === 'warn', '失败走琥珀');

  console.log('— 导出回包取目录（三层里取，拼 /logs，尾巴斜杠先清）');
  check(exportDirOf({ ok: true, summary: { header: { dir: 'C:/x' } } }) === 'C:/x/logs', '正常三层拼出目录');
  check(exportDirOf({ ok: true, summary: { header: { dir: 'C:/x///' } } }) === 'C:/x/logs', '尾巴斜杠清干净再拼，不出双斜杠');
  check(exportDirOf({ ok: true, summary: { header: {} } }) === '', '缺 dir 格给空串，不抛错');
  check(exportDirOf({ ok: true }) === '', '缺整层给空串，不抛错');
  check(exportDirOf(null) === '', '空包给空串，不抛错');

  console.log('— 动作互斥与动作表');
  check(canStartOp(null) === true, '空闲时能动手');
  check(canStartOp('export') === false, '有动作在跑时后来者没反应');
  check(JSON.stringify(ops) === JSON.stringify(['export', 'openDir', 'copyPath', 'clear']), '四个动作固定顺序');

  console.log('— 纯度扫描（纯侧不许碰世界）');
  // 先撕掉注释再扫：注释里写一句「调用方传当前时刻」是解释，不是读钟；连注释都算，门禁会逼人把话说一半。
  // 撕法只认块注释与行注释，不管字符串里的 `//` —— 这一份纯侧没有字符串里带 `//` 的写法，够用了。
  const code = sourceText(MODEL_REL);
  const bare = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  const hits: Array<string> = [];
  if (/new\s+Date\s*\(/.test(bare)) hits.push('读钟 new Date');
  if (/host\s*\.\s*call/.test(bare)) hits.push('调宿主 host.call');
  if (/React/.test(bare)) hits.push('碰界面 React');
  if (/require\s*\(/.test(bare)) hits.push('模块加载 require');
  check(hits.length === 0, hits.length > 0 ? '纯侧碰了世界：' + hits.join('、') : '纯侧没有读钟、调宿主、碰界面、加载模块的写法');

  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'));
  if (failed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('  FAIL 异常：' + ((e as Error)?.stack || String(e)));
  process.exit(1);
});
