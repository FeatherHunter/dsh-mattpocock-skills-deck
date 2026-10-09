// tests/verify-955-alignment.js —— #955 对齐补欠账门禁（948 图第七批）
// 用法：在插件根目录执行 node tests/verify-955-alignment.js，可独立运行。
//
// 盯住 #955 验收 5 条（原文见票正文）：
//   1. 叉号三角与对勾同尺寸，生产代码里不再用字符画。
//   2. 横幅与浮层调用已有座位，盖在内容上不顶开列表。
//   3. 失败红按路径逐处对齐，不设一个全局硬值。
//   4. 演示秒数来自真实耗时分布表，不编数字。
//   5. 四处待验全部有结论（结论在票正文；本门禁让四条结论可机器复核）。
//
// 三张对账表住在共享层 src/shared/feedback-map.js（FB_ICON_SIZES / FB_DURATIONS /
// FB_FAIL_RED_PATHS）——门禁与票面都从那三个常量取，避免两处各写一份、改一处忘一处。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 剥掉注释再查字符画与色值：注释里说明「原来用的是字符画 ✕」这类追述不算生产代码在用字符画。
const readCode = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/[^\n]*$/gm, '$1')

// 反馈路径的四份界面文件（三图标与字符画只在这四处查）
const FB_SITES = [
  'src/client/views/IssueDetailComments.js',
  'src/client/views/ListTabRow.js',
  'src/client/views/labels/LabelColorDialog.js',
  'src/client/statusbar/LogDangerConfirm.js',
]
const LEAF = 'src/client/views/feedback/feedback-styles.js'

async function main() {
  console.log('948 第七批门禁：对齐补欠账（#955）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)
  const leaf = read(LEAF)

  // ============ 1. 三图标同尺寸 + 字符画退役 ============
  const sizes = mod.FB_ICON_SIZES
  check(Array.isArray(sizes) && sizes.length >= 4, '结果三图标尺寸表存在（至少四处落点）', String(sizes && sizes.length))
  sizes.forEach((row) => {
    const src = read(row.file)
    // 同一条里的三个名字必须全部以同一个 size 出现（动态取名的写法见下面的专门断言）
    const missing = row.trio.filter((n) => src.indexOf("Ic({ n: '" + n + "', size: " + row.size + " })") === -1)
    const dynamicOk = src.indexOf('Ic({ n: saveResult, size: ' + row.size + ' })') !== -1
    check(missing.length === 0 || (row.trio.length === 3 && dynamicOk), row.site + '：' + row.trio.join('/') + ' 同为 ' + row.size + ' 像素', missing.join(','))
  })
  // 标签弹窗那条是动态取名（check/x/alert 三选一），名字来源要能被读到
  const lc = read('src/client/views/labels/LabelColorDialog.js')
  check(/saveResult = [^\n]*'alert'[^\n]*'x'/.test(lc) && lc.indexOf("Ic({ n: 'check', size: 12 })") !== -1, '标签弹窗三选一（alert/x/check）走同一个 12 像素出口')

  // 字符画退役：四份反馈文件里不许再出现字符兜底（✓ ✕ ！ 这些）；注释里的追述不算。
  const ART = ['✓', '✕', '✖', '⚠']
  FB_SITES.forEach((f) => {
    const src = readCode(f)
    const hit = ART.filter((ch) => src.indexOf(ch) !== -1)
    check(hit.length === 0, f.split('/').pop() + ' 里没有字符画兜底', hit.join(''))
  })
  // 三图标一律走图形库（Ic），不拼字符
  FB_SITES.forEach((f) => {
    const src = read(f)
    if (src.indexOf("n: 'check'") === -1 && src.indexOf('n: saveResult') === -1) return
    check(src.indexOf('Ic(') !== -1, f.split('/').pop() + ' 的结果图标走 Ic 图形库')
  })

  // ============ 2. 横幅与浮层调用已有座位 ============
  const notice = read('src/client/statusbar/LogDangerConfirm.js')
  check(notice.indexOf("className: 'dsws-banner '") !== -1 && notice.indexOf("'ok dsws-fb-okflash'") !== -1 && notice.indexOf("'bad dsws-fb-errflash'") !== -1, '留痕横幅用既有横幅视觉（dsws-banner 的 ok/bad 两档）')
  check(notice.indexOf("role: 'status'") !== -1 && notice.indexOf("'aria-live': 'polite'") !== -1, '留痕横幅带状态语义（可被读到）')
  check(notice.indexOf('setTimeout') === -1, '留痕横幅不排自动消失定时器（人工关掉才消失）')
  check(notice.indexOf('onRetry') !== -1, '留痕横幅失败带重试')
  const confirm = notice.slice(0, notice.indexOf('export const LogDangerNotice'))
  check(confirm.indexOf('role: \'dialog\'') !== -1 && confirm.indexOf('autoFocus: true') !== -1, '就近确认框有对话框语义且焦点先落确认键')
  check(confirm.indexOf('dsws-fb-busy') !== -1 && confirm.indexOf('dsws-spinner') !== -1, '动手时确认键转圈加禁用')

  // 覆盖层：横幅与确认框都走既有 PortalOverlay（fixed 定位），盖在内容上不顶开列表
  const logMenu = read('src/client/statusbar/StatusLogMenu.js')
  check(logMenu.indexOf('PortalOverlay') !== -1 && logMenu.indexOf('position: \'fixed\'') !== -1, '确认框与留痕横幅走既有覆盖层（fixed，不顶开列表）')
  check(logMenu.indexOf('LogDangerNotice') !== -1 && logMenu.indexOf('LogDangerConfirmBox') !== -1, '状态栏菜单只留状态与调用（两件形态都在新叶子里）')

  // 为什么留痕横幅保持在触发点旁边、不搬去面板顶部那条横幅带：座位是治理声明，实体横幅由各组件就地画，
  //   而状态栏那份文件被零增长基线钉住（只许减不许增），把状态提上去渲染会当场顶破粒度门禁。
  //   这一条把「结论」变成可复核的证据：基线里确实钉着状态栏文件，且客户端没有任何 BANNER_SEAT 消费者。
  const baseline = JSON.parse(read('tests/file-granularity-baseline.json'))
  check(!!baseline.files['src/client/statusbar/StatusBar.js'], '零增长基线里钉着状态栏文件（搬去顶部横幅带会顶破粒度门禁，结论可复核）')
  let bannerSeatConsumers = 0
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + ent.name
      if (ent.isDirectory()) walk(rel)
      else if (ent.name.endsWith('.js') && read(rel).indexOf('BANNER_SEAT') !== -1) bannerSeatConsumers += 1
    }
  }
  walk('src/client')
  check(bannerSeatConsumers === 0, '客户端没有可挂载的横幅座位消费者（座位是治理声明，实体横幅就地画）', String(bannerSeatConsumers))

  // 浮层小提示走既有浮层：复制成功经 flash 走既有提示（toast 视觉 .dsws-note 在样式真源里）
  const styles = read('src/client/kernel/styles.js')
  check(styles.indexOf('.dsws-note') !== -1, '浮层小提示用既有浮层视觉（.dsws-note）')
  const apiIo = read('src/client/kernel/api-io.js')
  check(apiIo.indexOf('flash(st, okMsg') !== -1, '复制结果经既有 flash 出口（不另造浮层）')

  // ============ 3. 失败红按路径逐处对齐，不设全局硬值 ============
  const reds = mod.FB_FAIL_RED_PATHS
  check(Array.isArray(reds) && reds.length >= 8, '失败红路径清单存在（至少八条）', String(reds && reds.length))
  reds.forEach((row) => {
    const src = read(row.file)
    const missing = row.colors.filter((c) => src.indexOf(c) === -1)
    check(missing.length === 0, row.path + '：清单里的色值都在文件里', missing.join(','))
  })
  // 反馈路径一处都不用原型占位红，也不把它提成全局值
  const feedbackFiles = FB_SITES.concat([LEAF, 'src/client/kernel/styles.js', 'src/client/kernel/slotRenderer-modal-view.js', 'src/client/views/SettingsPage.js'])
  const placeholder = feedbackFiles.filter((f) => read(f).indexOf('#f85149') !== -1)
  check(placeholder.length === 0, '反馈路径一处都不用原型占位红 #f85149', placeholder.join(','))
  check(read('src/client/views/SubworkspaceMark.js').indexOf('#f85149') !== -1, '占位红仍只在子工作区角标那一处（既有界面，不是反馈路径）')
  // 没有全局硬值：共享层不导出「一个红值」的常量（红按路径取），清单是逐条带文件名与说明的。
  check(typeof mod.FB_FAIL_RED === 'undefined' && typeof mod.FAIL_RED === 'undefined', '共享层不导出失败红全局常量（红按路径取，不设一个全局硬值）')
  const shaped = reds.filter((r) => typeof r.file === 'string' && Array.isArray(r.colors) && r.colors.length > 0 && typeof r.note === 'string' && r.note.length > 5)
  check(shaped.length === reds.length, '清单每一条都写明文件、色值与取舍理由（逐处对齐，不是一张色卡）', reds.filter((r) => shaped.indexOf(r) === -1).map((r) => r.path).join(','))
  const leafRules = readCode(LEAF)
  const leafRedHex = (leafRules.match(/#(?:f|e)[0-9a-fA-F]{5}\b/g) || []).filter((h) => h.toLowerCase() !== '#fca5a5')
  check(leafRedHex.length === 0, '样式叶子里的规则不写红色字面量（红闪用既有红的透明版）', leafRedHex.slice(0, 4).join(','))

  // ============ 4. 演示秒数来自真实耗时分布表（双向核对） ============
  const durs = mod.FB_DURATIONS
  check(Array.isArray(durs) && durs.length >= 12, '演示秒数表存在（至少十二条）', String(durs && durs.length))
  const TIERS = ['instant', 'short', 'medium', 'long']
  const badTier = durs.filter((d) => TIERS.indexOf(d.tier) === -1)
  check(badTier.length === 0, '每条都归到四档之一（瞬间/短/中长/长）', badTier.map((d) => d.fx).join(','))
  const tiersUsed = {}
  durs.forEach((d) => { tiersUsed[d.tier] = true })
  check(TIERS.every((t) => tiersUsed[t] === true), '四档都有条目（表覆盖全档，不挑着写）', TIERS.filter((t) => !tiersUsed[t]).join(','))
  // 表里每个写死的秒数都要在样式叶子里真实存在（css 列）
  const cssRows = durs.filter((d) => typeof d.css === 'string')
  const cssMissing = cssRows.filter((d) => leaf.indexOf(' ' + d.css) === -1)
  check(cssMissing.length === 0, '表里的动画时长与样式叶子逐条一致（css 列）', cssMissing.map((d) => d.fx).join(','))
  // 反向：叶子里出现的每个动画时长都要在表里（不许有表外的野生时长）。
  //   只扫 animation / transition 这两条声明里的时长，且不扫它们的 -delay 兄弟（错峰延迟不是时长）。
  const leafRulesForTimes = leaf.split('\n').filter((ln) => ln.trim().indexOf('//') !== 0).join('\n')
  const declaredTimes = []
  const declRe = /(?:^|[;{])(animation|transition):([^;}]*)/g
  let dm = declRe.exec(leafRulesForTimes)
  while (dm !== null) {
    const times = dm[2].match(/(?<![A-Za-z0-9_])(?:\.\d+|\d+(?:\.\d+)?)s\b/g) || []
    times.forEach((t) => declaredTimes.push(t.trim()))
    dm = declRe.exec(leafRulesForTimes)
  }
  // 时长写法有两种：`.45s`（省略整数零）与 `1.6s`，两种都要认，别只认带整数的那种。
  const leafTimes = Array.from(new Set(declaredTimes))
  const tableCss = new Set(cssRows.map((d) => d.css))
  const strayTimes = leafTimes.filter((t) => !tableCss.has(t))
  check(strayTimes.length === 0, '叶子里没有表外的野生时长（反向核对）', strayTimes.join(','))
  check(leafTimes.length >= 8 && cssRows.length >= 8, '这条双向核对不是空跑（叶子与表各至少八条时长）', 'leaf=' + leafTimes.length + ' table=' + cssRows.length)
  // 调用点自排的自退时间（js 列）也要与真实代码一致
  const jsRows = durs.filter((d) => typeof d.js === 'number')
  const JS_SITES = {
    justSent: 'src/client/kernel/slotRenderer-modal-view.js',
    copyRetire: 'src/client/views/ListTabRow.js',
    commentRetire: 'src/client/views/IssueDetailComments.js',
  }
  const jsMissing = jsRows.filter((d) => {
    const f = JS_SITES[d.fx]
    if (!f) return true
    return read(f).indexOf(String(d.js)) === -1
  })
  check(jsMissing.length === 0, '表里的自退时间与调用点代码一致（js 列）', jsMissing.map((d) => d.fx).join(','))
  // 「不编数字」：没有真实数的那几条必须显式写 null 并说明原因
  const nullRows = durs.filter((d) => d.css === undefined && d.js === null)
  check(nullRows.length >= 3 && nullRows.every((d) => typeof d.why === 'string' && d.why.length > 10), '没有写死秒数的效果都写明原因（不编数字）', nullRows.map((d) => d.fx).join(','))

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第七批门禁（#955，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
