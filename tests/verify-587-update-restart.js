// verify-587-update-restart.js —— 待重启提示与更新弹窗门禁（落地票 #587）
// 规则（与票面验收一一对应）：
//   1) 判据只看宿主当场算的那条：回包原因码 pending-restart（读快照的纯函数负责翻译）；
//      面板不自己比版本号、不读会过期的任务记录，宿主侧一行代码不改（这条是接缝，动了就红）。
//   2) 待重启常驻：横幅组件按「缺一次重启」渲染，装完出现、重启后随判据消失。
//   3) 弹窗是浮层（dsws-modal），不是页内分组；只在真有新版可装或安装失败时开，检查中不开。
//   4) 装完待重启这件事一次会话只主动说一次（单次配合）；自动读状态本身不弹提示。
//   5) 文案全部走词条、中英成对，新文件不写死中文；埋点不新增事件名。
//   6) 新拆出的三份文件都在 350 行以内。
// 用法：node tests/verify-587-update-restart.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
const lines = (rel) => read(rel).split(/\r?\n/).length

const HOOK = 'src/client/views/useUpdatePanel.js'
const DIALOG = 'src/client/views/UpdateDialog.js'
const BANNER = 'src/client/views/UpdateRestartBanner.js'
const PAGE = 'src/client/views/SettingsPage.js'
const LOCALE = 'src/client/kernel/locale-word.js'
const HOST_READER = 'src/host/updatePkg/reader.js'
const NEW_FILES = [HOOK, DIALOG, BANNER]

function fakeH() {
  return function h(type, props, children) {
    return { type: typeof type === 'string' ? type : (type && type.name) || 'fn', props: props || {}, children: children === undefined ? [] : [].concat(children) }
  }
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const head = ''
  const kids = node.children && node.children.length ? node.children : (node.props && node.props.children !== undefined ? [].concat(node.props.children) : [])
  return head + ' ' + kids.map(textOf).join(' ')
}

async function main() {
  console.log('待重启提示与更新弹窗门禁（#587：判据 + 常驻 + 浮层 + 单次 + 词条 + 粒度）')

  // ---- 1) 判据：只看宿主当场算的那条，宿主侧不动 ----
  const reader = read(HOST_READER)
  check(reader.includes("result.installedVersion !== runningVersion") && reader.includes("result.blockedReason = \"pending-restart\""),
    '宿主判据不变：磁盘已装版本与运行版本不一致时报缺一次重启')
  const hookSrc = strip(read(HOOK))
  check(hookSrc.includes("snap.blockedReason === 'pending-restart'"), '面板待重启只认这条原因码（pending-restart）')
  check(!/installedVersion\s*!==\s*runningVersion|installed\s*!==\s*running|semver|localeCompare/.test(hookSrc),
    '面板不自己比版本号（判据单源在宿主）')
  check(!hookSrc.includes('job.state === \'restart-required\''), '面板不拿任务记录的状态当待重启判据')
  const hook = await import(pathToFileURL(path.join(ROOT, HOOK)).href)
  check(typeof hook.updReadSnapshot === 'function' && typeof hook.updDialogShouldOpen === 'function', '读快照与弹窗判据都导出为纯函数')

  // 读快照：正常 / 待重启 / 无新版三种回包
  {
    const norm = hook.updReadSnapshot({ ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.20', latestVersion: '1.7.21', canInstall: true, blockedReason: null, job: null } })
    check(norm.pending === false && norm.canInstall === true && norm.latest === '1.7.21', '常态回包：不待重启、可装、带上最新版号')
    const pend = hook.updReadSnapshot({ ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.21', latestVersion: '1.7.21', canInstall: false, blockedReason: 'pending-restart', job: null }, manual: 'dsh plugin add --profile web foo@1.7.21' })
    check(pend.pending === true && pend.canInstall === false, '待重启回包：认出来待重启、且不给装（装不了）')
    check(pend.running === '1.7.20' && pend.installed === '1.7.21', '待重启回包：带上「跑的是哪版、磁盘是哪版」（提示要显示的两个号）')
    check(pend.manual === 'dsh plugin add --profile web foo@1.7.21', '手工兜底命令原样带出（失败时要能一键复制）')
    const empty = hook.updReadSnapshot({ ok: true, snapshot: null })
    check(empty.pending === false && empty.latest === null && empty.running === '' && empty.installed === '', '空回包不炸也不误报待重启')
    const failed = hook.updReadSnapshot({ ok: true, snapshot: { runningVersion: '1.7.20', installedVersion: '1.7.20', canInstall: false, blockedReason: null, job: { state: 'failed', message: 'install-failed' } } })
    check(failed.jobState === 'failed' && failed.jobMessage === 'install-failed', '失败任务读出状态与原因码（界面要翻译成人话）')
  }

  // 弹窗判据：有新版可装 / 安装失败要说话 / 其余不开
  {
    const open = hook.updDialogShouldOpen
    check(open(false, { canInstall: true, jobState: null, jobMessage: null }) === false, '用户没点过：不开')
    check(open(true, { canInstall: true, jobState: null, jobMessage: null }) === true, '确认有新版可装：开')
    check(open(true, { canInstall: false, jobState: 'failed', jobMessage: 'install-failed' }) === true, '安装失败：照开（要把原因和手工命令说清楚）')
    check(open(true, { canInstall: false, jobState: 'restart-required', jobMessage: null }) === false, '待重启本身不再弹窗（常驻提示负责说这件事）')
    check(open(true, { canInstall: false, jobState: null, jobMessage: null }) === false, '无新版：不开（不打扰）')
  }

  // ---- 2) 待重启常驻：横幅组件按判据渲染 ----
  {
    const bannerSrc = strip(read(BANNER))
    check(bannerSrc.includes("export const UpdateRestartBanner"), '待重启横幅组件存在')
    check(bannerSrc.includes("'data-role': 'update-restart-banner'"), '横幅带稳定的识别标记（验收与截图都指它）')
    const { UpdateRestartBanner } = await import(pathToFileURL(path.join(ROOT, BANNER)).href)
    const localeSrc = read(LOCALE)
    const keyZh = (k) => { const m = localeSrc.match(new RegExp("'" + k + "':\\s*'([^']*)'")) ; return m ? m[1] : '' }
    const titleZh = keyZh('cfg.updateRestart')
    const doneZh = keyZh('cfg.restartDoneWith')
    const node = UpdateRestartBanner({ h: fakeH(), tr: (k, p) => { let s = keyZh(k); if (p) Object.keys(p).forEach((n) => { s = s.replace(new RegExp('\\{' + n + '\\}', 'g'), String(p[n])) }); return s }, running: '1.7.20', installed: '1.7.21' })
    const text = textOf(node)
    check(node.type === 'div' && node.props['data-role'] === 'update-restart-banner', '横幅渲染成一个带标记的整行容器')
    check(!!titleZh && text.includes(titleZh), '横幅正文含「待手动重启」那句（走词条，不写死）')
    check(!!doneZh && text.includes('1.7.20') && text.includes('1.7.21'), '横幅把「跑的版本 → 装好的版本」两个号显示出来')
    const noVer = textOf(UpdateRestartBanner({ h: fakeH(), tr: (k) => keyZh(k), running: '', installed: '' }))
    check(!!keyZh('cfg.restartDone') && noVer.includes(keyZh('cfg.restartDone')), '缺版本号时退化成不带号的通用那句')
    check(!/[\u4e00-\u9fff]/.test(bannerSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n').replace(/\/\/.*$/gm, '')), '横幅源码里没有写死的中文字符串')
  }

  // ---- 3) 弹窗形态：浮层，不是页内分组 ----
  {
    const dlgSrc = strip(read(DIALOG))
    check(dlgSrc.includes("className: 'dsws-modal'") && dlgSrc.includes("className: 'dsws-modalbox'"), '弹窗走仓库现成的浮层样式（遮罩加居中卡片）')
    check(dlgSrc.includes("'data-role': 'update-dialog'") && dlgSrc.includes("'data-role': 'update-dialog-box'"), '浮层与卡片各有稳定的识别标记（验收指它）')
    check(dlgSrc.includes('if (!open) return null'), '没开的时候不渲染任何东西（页面上不留空壳）')
    check(dlgSrc.includes('e.target === e.currentTarget'), '点遮罩空白处可关（与切换后端的确认框同一行为）')
    const pageSrc = strip(read(PAGE))
    check(!pageSrc.includes("className: 'dsws-cfg-group' }, [\n        // 更新") && pageSrc.includes('upd.dialog'), '主文件只留一行渲染调用（弹窗本体不再堆在配置页里）')
    check(pageSrc.includes('upd.banner') && pageSrc.includes('upd.label') && pageSrc.includes('upd.disabled'), '主文件用钩子给的三件：常驻横幅、按钮文字、按钮是否可点')
    check(!/updJobState|setUpdDialog|updReadStatus/.test(pageSrc), '主文件不再自带更新状态机（全部收进钩子）')
  }

  // ---- 4) 单次配合：一次会话只主动说一次；自动读状态不弹提示 ----
  {
    const hookRaw = read(HOOK)
    check(/let updRestartToldOnce = false/.test(hookRaw), '单次说出去了才置位的标记存在（模块级，跨挂载不重复）')
    check(/if \(info\.pending && !updRestartToldOnce\)/.test(hookRaw) && hookRaw.includes('updRestartToldOnce = true'), '只有第一次认到待重启才提示')
    check(hookRaw.includes("tr('cfg.updateRestartToast'") && hookRaw.includes('{ v: info.installed }'), '单次提示走词条并带上装好的版本号')
    const readFnAt = hookSrc.indexOf('const updReadStatus = function () {')
    const clickFnAt = hookSrc.indexOf('const updClickCheck = function () {')
    check(readFnAt >= 0 && clickFnAt > readFnAt, '自动读状态与手动点检查各是一个函数（可分别核对）')
    const readFn = hookSrc.slice(readFnAt, clickFnAt)
    check(!readFn.includes("tr('cfg.updateLatest'") && !readFn.includes("tr('cfg.updateCheckFail'"), '自动读状态本身不弹提示（无新版与失败提示只在手动点的那条路）')
  }

  // ---- 5) 文案与埋点纪律 ----
  {
    const localeSrc = read(LOCALE)
    for (const k of ['cfg.updateVersions', 'cfg.updateRestartNote', 'cfg.restartDone', 'cfg.restartDoneWith', 'cfg.updateRestartToast']) {
      const times = localeSrc.split(`'${k}':`).length - 1
      check(times === 2, `词条中英成对 ${k}（实际 ${times} 处）`)
    }
    for (const rel of NEW_FILES) {
      const body = strip(read(rel)).split('\n').filter((l) => !/^\s*\*/.test(l)).join('\n')
      const cjk = (body.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter((s) => /[\u4e00-\u9fff]/.test(s))
      check(cjk.length === 0, rel + ' 没有写死的中文字符串（实际 ' + cjk.length + ' 处）')
    }
    const hookEvents = [...hookSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
    const known = new Set(['host.call', 'host.call.fail', 'panel.render'])
    const fresh = [...new Set(hookEvents)].filter((e) => !known.has(e))
    check(fresh.length === 0, '埋点只复用已有事件名（实得 ' + [...new Set(hookEvents)].join('、') + '）')
    check(hookSrc.includes("isEnabled('debug')"), '调试级记录同行判开关（关着不组装字符串）')
  }

  // ---- 6) 文件粒度 ----
  for (const rel of [HOOK, DIALOG, BANNER, PAGE, LOCALE]) {
    check(lines(rel) <= 350, rel + ' ' + lines(rel) + ' 行（上限 350）')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 待重启提示与更新弹窗门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
