// verify-log-statusbar.js — #492 状态栏常驻入口门禁（红队阶段二 (1)(2)(4)(5) 的静态对应项）。
// 用法：在插件根目录执行 node tests/verify-log-statusbar.js，可独立运行。
// 断言：
//   一、常驻小灰点：关灰（#6b6b75）开绿（#4ade80）两色字面都在，直径 10，不过显；
//   二、四键接线点名（字面一字不差）：导出调 wf.logExport、清空调 wf.logClear、
//      跳转目录复用 wf.openPath、复制路径走本地剪贴板（copyText）；
//   三、回退形态：宿主导出恒 fallback:true 且带原文件字段（text、summary），
//      客户端分支处理 fallback:true 并给出原文件形态提示；
//   四、反馈闭环：清空确认框（标题＋说明＋取消＋确认清空）与导出成功 toast 含路径展示、
//      导出／打开／清空三路失败各有错误态；
//   五、无新增日志事件名：本票两处客户端改动不引入新的点分事件名（计数门禁不被扰动）。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('状态栏导出门禁（#492：常驻小灰点＋四键菜单＋确认框＋反馈＋回退）')

let menu = ''
let bar = ''
let store = ''
let locale = ''
try { menu = read('src/client/statusbar/StatusLogMenu.js'); check(true, '菜单组件存在') } catch (e) { check(false, '菜单组件存在') }
try { bar = read('src/client/statusbar/StatusBar.js'); check(true, '状态栏主文件可读') } catch (e) { check(false, '状态栏主文件可读') }
try { store = read('src/host/logStore.js'); check(true, '宿主日志库可读') } catch (e) { check(false, '宿主日志库可读') }
try { locale = read('src/client/kernel/locale-word.js'); check(true, '文案文件可读') } catch (e) { check(false, '文案文件可读') }

// 一、常驻小灰点：两色＋10px＋常驻挂载
check(menu.includes('#6b6b75') && menu.includes('#4ade80'), '一、关灰开绿两色字面都在')
check(/width:\s*10[^0-9].*height:\s*10/s.test(menu), '一、灰点直径 10（不过显）')
check(bar.includes('h(StatusLogDot'), '一、小灰点挂载进胶囊（常驻）')
check(menu.includes('stopPropagation'), '一、点灰点不冒泡（不误开面板）')

// 二、四键接线点名
check(menu.includes("host.call('wf.logExport'"), '二、导出键调 wf.logExport')
check(menu.includes("host.call('wf.logClear'"), '二、清空键调 wf.logClear')
check(menu.includes("host.call('wf.openPath'"), '二、跳转键复用 wf.openPath（未新增电话）')
check(menu.includes('copyText(') || menu.includes('navigator.clipboard'), '二、复制键走本地剪贴板能力')
check(!/wf\.logOpenDir|wf\.logDir|wf\.logPath/.test(menu + bar), '二、未新增目录电话（复用纪律）')

// 三、回退形态
check(/fallback:\s*true/.test(store), '三、宿主导出恒 fallback:true（暂无 zip 能力，走回退）')
check(store.includes('text:') && store.includes('summary:'), '三、回退为多文件形态（原文件 text＋摘要 summary）')
check(/dir:\s*dirOut/.test(store) && /path:\s*pathOut/.test(store), '三、导出回参带绝对 dir 与 path（供跳转与复制）')
check(menu.includes('fallback === true') && menu.includes('logtoast.exportFallback'), '三、客户端分支处理 fallback 并提示原文件形态')

// 四、反馈闭环
check(menu.includes('logmenu.clearTitle') && menu.includes('logmenu.clearDesc'), '四、清空确认框有标题与说明')
check(menu.includes('logmenu.cancel') && menu.includes('logmenu.confirmClear'), '四、确认框有取消与确认清空')
check(menu.includes('path: shown'), '四、导出成功 toast 把解析出的路径透传给文案')
check(locale.includes('logtoast.exportFallback') && locale.includes('{path}'), '四、导出成功 toast 含路径展示（文案键带 {path}）')
check(menu.includes('logtoast.exportFailed') && menu.includes('logtoast.openFailed') && menu.includes('logtoast.clearFailed'), '四、导出／打开／清空三路失败各有错误态')
check(menu.includes('logtoast.cleared') && menu.includes('logtoast.clearEmpty'), '四、清空成功与空日志各有反馈')
check(menu.includes('Escape'), '四、Esc 可关闭菜单与确认框')

// 五、无新增点分事件名（本票不动 43 计数）
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
}
function dottedNames(text) {
  const out = []
  for (const m of stripComments(text).matchAll(/['"]([A-Za-z]+(?:\.[A-Za-z][A-Za-z0-9]*)+)['"]/g)) out.push(m[1])
  return out
}
const fresh = dottedNames(menu).filter((n) => !n.startsWith('wf.') && ['logmenu', 'logtoast'].indexOf(n.split('.')[0]) < 0)
check(fresh.length === 0, '五、菜单组件无新增日志事件名（计数门禁不被扰动）' + (fresh.length ? ' —— ' + fresh.join('、') : ''))

// 六、构建接线
const buildSrc = read('scripts/build.mjs')
const indexSrc = read('src/client/index.js')
check(buildSrc.includes("file: 'src/client/statusbar/StatusLogMenu.js'") && indexSrc.includes('leaf:StatusLogMenu'), '六、构建拼接已登记（LEAF_MODULES＋index 标记）')

// 七、文案键双语配对（每键恰出现两次：中＋英）
const KEYS = ['logmenu.title', 'logmenu.titleOn', 'logmenu.export', 'logmenu.openDir', 'logmenu.copyPath', 'logmenu.clear', 'logmenu.note', 'logmenu.clearTitle', 'logmenu.clearDesc', 'logmenu.cancel', 'logmenu.confirmClear', 'logmenu.clearing', 'logmenu.exporting', 'logtoast.exported', 'logtoast.exportFallback', 'logtoast.exportFailed', 'logtoast.openFailed', 'logtoast.pathCopied', 'logtoast.cleared', 'logtoast.clearEmpty', 'logtoast.clearFailed', 'logtoast.hostUnavailable']
const unpaired = KEYS.filter((k) => locale.split("'" + k + "':").length - 1 !== 2)
check(unpaired.length === 0, '七、22 个文案键中英配对' + (unpaired.length ? ' —— 缺：' + unpaired.join('、') : ''))

console.log(failed ? '\n存在失败 — verify-log-statusbar 未通过' : '\n全部通过 — 状态栏门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
