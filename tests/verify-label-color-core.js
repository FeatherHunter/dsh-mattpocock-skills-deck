// verify-label-color-core.js — 配色核心的纯函数门禁（#629 落地）
// 查的是「外面看得见的行为」，不是实现细节：色值怎么归一、什么算合法、两个颜色算不算变了、
// 哪些行该发给后端、调色盘表格长什么样。断言一律打在产物上（src/shared/label-color/*.js），
// 因为宿主与客户端拿到的就是这三份产物，门禁跟着它们的实际行为走。
// 空值语义那几条（空串与空串算没变、空串换成真颜色算变了、大小写不同算没变）是总工裁决，
// 写在 docs/adr/20260913-builtin-ts-shape.md 第 2.8 节，本门禁负责把它们钉死：
// 少一条，「每一条还没配色的标签都被算成改过了、一保存就白发一批请求」这种错就会溜过去。
// 用法：node tests/verify-label-color-core.js（在仓库根目录）
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('配色核心纯函数门禁（#629：色值口径与空值语义、挑改动、提示词表格）')

  const colors = await import(pathToFileURL(path.join(ROOT, 'src/shared/label-color/colors.js')).href)
  const prompt = await import(pathToFileURL(path.join(ROOT, 'src/shared/label-color/prompt.js')).href)
  const ports = await import(pathToFileURL(path.join(ROOT, 'src/shared/label-color/ports.js')).href)

  // ---- 0) 导出名清单（照 #616 的清单逐个点名，少一个当场红）----
  for (const name of ['normalizeColor', 'isColor', 'colorsDiffer', 'pickChangedRows']) {
    check(typeof colors[name] === 'function', 'colors.js 导出函数 ' + name)
  }
  for (const name of ['buildPaletteTable', 'buildPalettePrompt']) {
    check(typeof prompt[name] === 'function', 'prompt.js 导出函数 ' + name)
  }
  check(ports.PORTS_SOURCE === 'label-color-core/src/ports.ts',
    '插口产物带模块标识 PORTS_SOURCE（实得 ' + String(ports.PORTS_SOURCE) + '）')

  // 失败条目的形状钉死成与 tracker 契约层逐字一致（总工裁决：核心是后来者，向已定版的契约对齐，
  // 同一个概念只允许一种写法）。类型在产物里已被擦掉，所以这条只能读 TypeScript 源码来断言。
  {
    const portsTs = fs.readFileSync(path.join(ROOT, 'label-color-core/src/ports.ts'), 'utf8')
    const decl = /export interface ColorChangeFailure \{([\s\S]*?)\n\}/.exec(portsTs)
    check(!!decl, 'ports.ts 里能读到 ColorChangeFailure 的形状声明')
    const body = decl ? decl[1] : ''
    check(/name:\s*string/.test(body), 'ColorChangeFailure 带 name 字段')
    check(/reason:\s*\{\s*kind:\s*string;\s*message:\s*string\s*\}/.test(body),
      'ColorChangeFailure 的 reason 是 { kind, message }（与契约层的失败条目逐字一致）')
    check(!/\bcode\s*:/.test(body), 'ColorChangeFailure 里不再出现 code 这个字段名（同一个概念只有一种写法）')
  }

  // ---- 1) 归一化：不带井号的小写六位 ----
  const normalized = [
    ['#8B5CF6', '8b5cf6'],
    ['8b5cf6', '8b5cf6'],
    ['  #8B5CF6  ', '8b5cf6'],
    [' 8B5CF6 ', '8b5cf6'],
    ['#8b5cf6', '8b5cf6'],
    ['#8b5cf6 ', '8b5cf6'],
  ]
  for (const [input, want] of normalized) {
    check(colors.normalizeColor(input) === want,
      `归一化「${input}」→ ${String(colors.normalizeColor(input))}（期望 ${want}）`)
  }

  // 不合法的输入一律 null，不做纠正、不猜
  const invalidInputs = ['8b5cf', '8b5cf6ff', 'gggggg', 'red', '', '   ', '#', 12345, null, undefined, {}]
  for (const input of invalidInputs) {
    const got = colors.normalizeColor(input)
    check(got === null, `不合法输入 ${JSON.stringify(input)} 归一化得 null（实得 ${JSON.stringify(got)}）`)
  }

  // ---- 2) 合法性判断与归一化同一口径 ----
  check(colors.isColor('#8B5CF6') === true, 'isColor 收带井号大写写法（#8B5CF6 为真）')
  check(colors.isColor('8b5cf6') === true, 'isColor 收不带井号小写写法（8b5cf6 为真）')
  check(colors.isColor('') === false, "isColor('') 为假（空串表示还没配颜色，不是合法颜色）")
  check(colors.isColor(null) === false && colors.isColor(undefined) === false, 'isColor(null / undefined) 为假')
  check(colors.isColor('8b5cf') === false && colors.isColor('zzzzzz') === false, '位数不对或含非十六进制字符为假')

  // ---- 3) 空值语义（总工裁决，三条必须写死的断言 + 相邻情形）----
  check(colors.colorsDiffer('', '') === false, "colorsDiffer('', '') 为假（两边都没配色，不算改过）")
  check(colors.colorsDiffer('', '8b5cf6') === true, "colorsDiffer('', '8b5cf6') 为真（从没配色到有颜色，算改过）")
  check(colors.colorsDiffer('8B5CF6', '8b5cf6') === false, "colorsDiffer('8B5CF6', '8b5cf6') 为假（只差大小写，不算改过）")
  check(colors.colorsDiffer('8b5cf6', '') === true, "colorsDiffer('8b5cf6', '') 为真（把颜色清掉，算改过）")
  check(colors.colorsDiffer('#8b5cf6', '8b5cf6') === false, '只差一个井号不算改过')
  check(colors.colorsDiffer(null, '') === false && colors.colorsDiffer(null, undefined) === false, '空值与空串互相比较都不算改过')
  check(colors.colorsDiffer('zzzzzz', 'zzzzzz') === false, '两边是同一个非法值不算改过（合法性与相等比较分开判）')
  check(colors.colorsDiffer('zzzzzz', 'yyyyyy') === true, '两个不同的非法值算改过（照常发给后端，由后端按解析档报错）')
  check(colors.colorsDiffer('', 'zzzzzz') === true, "非法值换掉空串算改过（colorsDiffer('', 'zzzzzz') 为真）")

  // ---- 4) 只挑出真正变了的行 ----
  const baseline = [
    { name: 'bug', color: 'd73a4a' },
    { name: 'needs-triage', color: '' },
    { name: 'wayfinder:grilling', color: '9d7cd8' },
    { name: 'wontfix', color: 'ffffff' },
  ]
  {
    const draft = {
      bug: '#D73A4A',            // 只差大小写与井号：不算改过
      'needs-triage': '',        // 本来就没配色、现在还是空：不算改过（反例的正面样本）
      'wayfinder:grilling': 'f97316', // 真的换了颜色：要发
      'wayfinder:map': '8b5cf6', // 清单里没有这个标签：也算一项改动，交给后端裁决
    }
    const changed = colors.pickChangedRows(baseline, draft)
    const names = changed.map((c) => c.name)
    check(JSON.stringify(names) === JSON.stringify(['wayfinder:grilling', 'wayfinder:map']),
      '只挑出真正变了的行（实得 [' + names.join(', ') + ']）')
    check(JSON.stringify(changed) === JSON.stringify([
      { name: 'wayfinder:grilling', color: 'f97316' },
      { name: 'wayfinder:map', color: '8b5cf6' },
    ]), '送出去的每一项只有标签名与不带井号的小写六位颜色（实得 ' + JSON.stringify(changed) + '）')
  }
  {
    // 清单里没被用户碰过的名字（草稿表里没有这个键）不算改动：原型的草稿表只装被改过的行
    const changed = colors.pickChangedRows(baseline, { bug: 'd73a4a' })
    check(changed.length === 0, '没被碰过的行不算改动（实得 ' + JSON.stringify(changed) + '）')
  }
  {
    // 两个不同的非法值也照常发出去，值本身先做归一化，合法性不在这一步拦
    const changed = colors.pickChangedRows([{ name: 'bug', color: 'zzzzzz' }], { bug: '#YYYYYY' })
    check(JSON.stringify(changed) === JSON.stringify([{ name: 'bug', color: 'yyyyyy' }]),
      '不同的非法值照常发出去且值先归一化（实得 ' + JSON.stringify(changed) + '）')
  }
  {
    // 清单是空的一份（后端一个标签也没有）时，草稿里的每一项都算改动
    const changed = colors.pickChangedRows([], { bug: 'd73a4a', wontfix: '' })
    check(JSON.stringify(changed) === JSON.stringify([{ name: 'bug', color: 'd73a4a' }]),
      '空清单时草稿里非空的那项算改动（实得 ' + JSON.stringify(changed) + '）')
  }

  // ---- 5) 调色盘表格与整段提示词 ----
  const columnNames = { name: '标签', color: '颜色' }
  {
    const table = prompt.buildPaletteTable(
      [{ name: 'wayfinder:map', color: '8B5CF6' }, { name: 'needs-triage', color: '' }],
      columnNames,
    )
    const lines = table.split('\n')
    check(lines[0] === '| 标签 | 颜色 |', '表格第一行是两个表头（由词条给）：' + lines[0])
    check(lines[1] === '| --- | --- |', '表格第二行是分隔行：' + lines[1])
    check(lines[2] === '| wayfinder:map | 8b5cf6 |', '色值写成不带井号的小写六位：' + lines[2])
    check(lines[3] === '| needs-triage |  |', '还没配颜色的标签留一个空单元格：' + lines[3])
    check(lines.length === 4, '两行数据就出两行（实得 ' + lines.length + ' 行）')
  }
  {
    const table = prompt.buildPaletteTable([], columnNames)
    check(table.split('\n').length === 2, '空清单出来的是只有表头与分隔行的空表')
  }
  {
    const full = prompt.buildPalettePrompt({
      rows: [{ name: 'bug', color: 'd73a4a' }],
      texts: { opening: '下面是当前配色。', columnNames, closing: '想改就改右边那一列。' },
    })
    check(full.startsWith('下面是当前配色。\n\n| 标签 | 颜色 |'), '整段提示词以开头一句 + 空行 + 表格起头')
    check(full.endsWith('| bug | d73a4a |\n\n想改就改右边那一列。'), '整段提示词以表格 + 空行 + 结尾一句收尾')
  }
  {
    const withoutClosing = prompt.buildPalettePrompt({
      rows: [{ name: 'bug', color: 'd73a4a' }],
      texts: { opening: '开头。', columnNames, closing: '   ' },
    })
    check(!withoutClosing.endsWith('\n') && !withoutClosing.includes('\n\n\n'), '结尾那句是空白时不留下多余空行')
  }

  // ---- 8) #622：客户端「复制推荐配色 prompt」那一侧的纯函数行为 ----
  // 为什么放在这份门禁里：这一段行为的实现落在客户端叶 labelColorErrors.js（它用拼接期注入的自由变量，
  // 不是可 import 的模块），而本门禁就是这整套配色功能「外面看得见的行为」的检查处；
  // 客户端的结构门禁（verify-leaves / verify-kernel）只管文件与导出，管不了行为。
  // 钉的是两条最要紧的：① 后端那一档没读到开仓方式时**不许写剪贴板**（连文字都不许拼出来）；
  // ② 剪贴板没写成时返回的必须是失败反馈（原型票栽过的坑：写不进去还显示「已复制」）。
  {
    const leafSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/labelColorErrors.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') +
      '\nreturn { lcCopyPlanOf: lcCopyPlanOf, lcCopyAttemptOf: lcCopyAttemptOf, lcCopyFeedbackOf: lcCopyFeedbackOf, lcCopyRowsOf: lcCopyRowsOf, lcRowIncomplete: lcRowIncomplete }\n'
    // 叶子里引用的自由变量在真产物里由 index.js 的拼接闭包提供（后端模块单源 moduleMetaOf、
    // 配色核心的两个拼装函数、合法性判断 isColor）。这里把它们当参数传进去，跑的是叶子里的**真函数**。
    const metaOf = function (store, bid) { return (store && store.metas && store.metas[bid]) || null }
    const leaf = new Function(
      'moduleMetaOf', 'buildPalettePrompt', 'buildPaletteTable', 'isColor', 'normalizeColor', 'pickChangedRows', 'navigator', 'console',
      leafSrc,
    )(metaOf, prompt.buildPalettePrompt, prompt.buildPaletteTable, colors.isColor, colors.normalizeColor, colors.pickChangedRows, undefined, { warn: function () {} })
    // 词条桩：把键名与参数都摊进结果里，好断言「该填的真实值有没有填进去」（真 tr 就是做参数替换的）。
    const texts = function (key, params) { return params ? ('[' + key + ']' + JSON.stringify(params)) : ('[' + key + ']') }
    const attemptOf = function (declared, hasModule, repo) {
      const metas = {}
      if (hasModule !== false) metas.mystery = declared === undefined ? { id: 'mystery' } : { id: 'mystery', openRepository: declared }
      return leaf.lcCopyAttemptOf({
        store: { metas: metas, repository: repo ? { refId: repo } : null },
        backendId: 'mystery',
        cwd: 'C:\\work\\my-workspace',
        rows: [{ name: 'bug', color: 'd73a4a' }],
        textOf: function () { return '#d73a4a' },
        t: texts,
      })
    }

    // ① 显式声明 'url' → 拼出「到远程仓库里改」那一套（含真实仓库名），允许写剪贴板
    {
      const att = attemptOf('url', true, 'owner/name')
      check(att.write === true && att.text.includes('[lc.copyOpenRemote]') && att.text.includes('[lc.copyCloseRemote]') && att.text.includes('owner/name'),
        '后端声明 url 时拼出远程那一套并允许写剪贴板（实得 kind=' + att.kind + '）')
    }
    // ①b 同一档但读不到仓库名 → 换成不含仓库名的结尾，且不许出现占位符
    {
      const att = attemptOf('url')
      check(att.write === true && att.text.includes('[lc.copyCloseRemoteNoRepo]') && !att.text.includes('[lc.copyCloseRemote]'),
        '读不到仓库名时用不含仓库名的结尾（实得 kind=' + att.kind + '）')
    }
    // ② 显式声明 'folder' → 拼出「改工作区里的文件」那一套
    {
      const att = attemptOf('folder')
      check(att.write === true && att.text.includes('[lc.copyOpenFile]') && att.text.includes('[lc.copyCloseFile]'),
        '后端声明 folder 时拼出工作区文件那一套（实得 kind=' + att.kind + '）')
    }
    // ③ 快照里没有这个后端模块 → 不写剪贴板，也不拼文字
    {
      const att = attemptOf(undefined, false)
      check(att.write === false && att.kind === 'blocked' && att.key === 'lc.copyNoBackend' && att.text === '',
        '没读到后端模块时不写剪贴板、也不拼文字（实得 ' + JSON.stringify(att) + '）')
    }
    // ④ 模块在、却没显式声明开仓动作（缺失 / 空串 / 空值 / 没见过的值）→ 同样不写剪贴板（裁而不决：不许猜默认）
    for (const declared of [undefined, '', null, 'magic', 'URL']) {
      const att = attemptOf(declared)
      check(att.write === false && att.kind === 'blocked' && att.key === 'lc.copyNoOpenMode' && att.text === '',
        '开仓动作 ' + JSON.stringify(declared) + ' 不是两个已声明值之一时不写剪贴板（实得 ' + JSON.stringify(att) + '）')
    }
    // ⑤ 剪贴板没写成 → 反馈必须是失败那一支，并把那段文字带上（界面摊出来让用户手动选）
    {
      const fb = leaf.lcCopyFeedbackOf(false, '一段文字')
      check(fb.kind === 'fail' && fb.key === 'lc.copyFailed' && fb.text === '一段文字',
        '写剪贴板失败时反馈是失败并把文字留着手动选（实得 ' + JSON.stringify(fb) + '）')
      check(leaf.lcCopyFeedbackOf(undefined, '一段文字').kind === 'fail', '结果不是布尔真（抛异常 / 环境里没有剪贴板）也算失败')
      const fbOk = leaf.lcCopyFeedbackOf(true, '一段文字')
      check(fbOk.kind === 'ok' && fbOk.key === 'lc.copied' && fbOk.text === '',
        '只有真的写成了才是成功那一支（实得 ' + JSON.stringify(fbOk) + '）')
    }
    // ⑥ 复制侧与保存侧用同一条「填完了没有」的规则：没填完的行退回后端返回的真实当前值
    {
      const rows = [
        { name: 'bug', color: 'd73a4a' },
        { name: 'needs-info', color: 'fbca04' },
        { name: 'wontfix', color: '' },
      ]
      const picked = leaf.lcCopyRowsOf(rows, function (r) {
        if (r.name === 'bug') return '#112233'
        if (r.name === 'needs-info') return ''
        return 'ZZZ123'
      })
      check(picked[0].color === '#112233', '填完了的草稿照原样进方案（实得 ' + picked[0].color + '）')
      check(picked[1].color === 'fbca04', '被清空的行退回后端真实值，不写成空（实得 ' + JSON.stringify(picked[1].color) + '）')
      check(picked[2].color === '', '写错字、后端本来也没颜色的行仍然是空（实得 ' + JSON.stringify(picked[2].color) + '）')
    }
  }

  // ---- 9) #631：引导句不许替后端猜原因，也不许把用户推向无效动作 ----
  // 这一节钉的是「没选定后端」这一情形（#623 真机验收时发现的那一处）：后端返回的说明是「这个工作区使用哪个
  // 后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试」，而界面那一句当时写的是「和后端上另一处改动撞上了：稍等片刻再重试」——
  // 用户照做会一直失败。断言打在**真词条**上（真词条在 src/client/kernel/locale-labels.js，界面取哪一条
  // 由下面第一行 lcKindKey 决定），所以改回旧文案这一节就红。
  {
    const leafSrc2 = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/labelColorErrors.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') +
      '\nreturn { lcKindKey: lcKindKey, lcPanelBackendOf: lcPanelBackendOf }\n'
    const leaf2 = new Function(
      'moduleMetaOf', 'buildPalettePrompt', 'buildPaletteTable', 'isColor', 'normalizeColor', 'pickChangedRows',
      leafSrc2,
    )(null, null, null, colors.isColor, colors.normalizeColor, colors.pickChangedRows)
    const locSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/locale-labels.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') + '\nreturn { L_LABELS: L_LABELS }\n'
    const L = new Function(locSrc)().L_LABELS

    // 「没选定后端」这一情形：档位是 conflict，后端返回的说明就是宿主 src/host/workspaceCwd.js 里 UNDECIDED 那一句
    // （这里照它的格式写下来，只为说明这一情形长什么样；断言不看这句话，只看界面取到的那条词条）。
    const backendSaid = '这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试（当前有 2 个后端同时对应这个工作区：github、markdown）'
    const key = leaf2.lcKindKey('conflict')
    check(key === 'lc.err.conflict', '没选定后端这一情形归 conflict 档，界面取的就是 ' + key + '（后端返回的说明：' + backendSaid.slice(0, 12) + '…）')
    // 无效指引的写法：叫用户「等一会儿再试」。后端这次说的是「先去选定后端」，等下去永远不会好。
    const WAIT_ZH = /稍等片刻再(重)?试|稍后再(重)?试|等一会儿再(重)?试|过一会儿再(重)?试/
    const WAIT_EN = /(try|trying) again (in a moment|later|shortly)|wait a moment|try (it )?later/i
    check(!WAIT_ZH.test(L.zh[key]), '没选定后端时界面引导里不出现「稍等片刻再重试」这类无效指引（实得：' + L.zh[key] + '）')
    check(!WAIT_EN.test(L.en[key]), '英文那一句同样不出现无效指引（实得：' + L.en[key] + '）')
    check(!/另一处改动|撞上/.test(L.zh[key]) && !/collided with another change/i.test(L.en[key]),
      '界面引导不替后端断言成因（后端说「这个工作区使用哪个后端尚未确定」，界面不许说成「和另一处改动撞上了」）')
    check(L.zh['lc.backendSaid'].indexOf('后端返回的说明') >= 0 && /Message from the backend/i.test(L.en['lc.backendSaid']),
      '框里的那段后端说明中英两份都点名了它自己（中文「后端返回的说明」，英文 Message from the backend）')
    // #633：这一条原来要「中文引导句点名那个框 **且** 英文引导句点名那个框」两句一起要；上次改文案时
    // 英文那一半被挪去查第 281 行的框名（另一个词条），于是英文引导句写什么都行——实测把它的英文换成
    // 「See the log for details.」门禁照样全绿。这里把英文那一半补回到引导句自己身上，中英两份都要点名
    // 那个框：中文叫「后端返回的说明」，英文那一份现在是「the message the backend returned」（框自己在
    // 英文里叫 Message from the backend，见上面第 281 行）。指向写成「详情见日志」这类说法就红。
    const BOX_EN = /(message from the backend|message the backend returned)/i
    check(L.zh[key].indexOf('后端返回的说明') >= 0 && BOX_EN.test(L.en[key]),
      '界面引导把「怎么做」交给框里的后端返回的说明（中英两份都点名了那个框；实得英文：' + L.en[key] + '）')
    // 第三件（#631）：这一档还要写明去哪儿选后端，并且给一个可点入口。
    check(/面板头部/.test(L.zh['lc.errWherePick'] || '') && /切换后端/.test(L.zh['lc.errWherePick'] || ''),
      '「去哪儿选定后端」写明了是面板头部那颗「切换后端」按钮（实得：' + (L.zh['lc.errWherePick'] || '') + '）')
    check(/panel header/i.test(L.en['lc.errWherePick'] || '') && /switch backend/i.test(L.en['lc.errWherePick'] || ''),
      '英文那一句同样写明位置（实得：' + (L.en['lc.errWherePick'] || '') + '）')
    check(!!L.zh['lc.actGoPick'] && !!L.en['lc.actGoPick'], '可点入口中英两份文字都在')
    // 另外七档逐档核对（#631 第二件）：同样的毛病（界面替后端猜一个具体成因、或引导与后端返回的说明打脸）
    // 在 env / not-found / parse 三档也各有一处，已按下一条规矩修；这里各钉一条防回退。
    check(!/这一步没能写成/.test(L.zh['lc.err.env']) && /后端返回的说明/.test(L.zh['lc.err.env']),
      'env 档不再说「这一步没能写成」（读清单那一步并没有在写），改把「卡在哪一步、为什么」交给后端返回的说明')
    check(!/如果是/.test(L.zh['lc.err.notFound']) && /后端返回的说明/.test(L.zh['lc.err.notFound']),
      '#633：not-found 档不再替后端列举成因（列举等于替后端猜，且「去配色文件里补一行」在文件还没生成时会让人去找一份不存在的文件），把「怎么做」交给「后端返回的说明」')
    check(!/如果是/.test(L.zh['lc.err.parse']) && /后端返回的说明/.test(L.zh['lc.err.parse']),
      '#633：parse 档同样不再替后端列举成因（颜色写法不合法 / 后端读不出它自己的配色文件），把「怎么改」交给「后端返回的说明」')

    // #631 追加的 P0：面板当前用的是哪个后端就读出哪个；没有选中项时**不编一个**（空串 = 如实不带）。
    const storeSel = (id) => ({ selection: { backendId: id, source: 'matches' } })
    check(leaf2.lcPanelBackendOf(storeSel('github')) === 'github', '读得出面板当前选定的后端')
    check(leaf2.lcPanelBackendOf({ snapshot: { selection: { backendId: 'markdown' } } }) === 'markdown', 'selection 不在顶层时退回快照里那一份')
    check(leaf2.lcPanelBackendOf(storeSel('')) === '' && leaf2.lcPanelBackendOf(storeSel(null)) === '' && leaf2.lcPanelBackendOf(null) === '' && leaf2.lcPanelBackendOf({}) === '',
      '面板没选定后端时给空串——不编一个后端 id 出来')
  }

  // ---- 10) #631 追加的 P0：客户端那两条电话真的把「面板现在用的是哪个后端」带出去了 ----
  // 这一节跑的是**真钩子**（src/client/views/labels/useLabelColors.js），只把 React 与宿主换成最小替身：
  // 跑完看「宿主收到了什么参数」，所以它验的是接线（客户端到底有没有把那个字段发出去），不是实现细节。
  // 为什么值得单列一节：宿主那侧由 verify-tracker-contract 与 verify-github-label-colors 两处真断言守着，
  // 但「客户端发了没有」那半边只有真机点一遍才能看见——这一节把那一半也钉住。
  {
    const hookSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/useLabelColors.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') +
      '\nreturn { useLabelColors: useLabelColors }\n'
    const leafSrc3 = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/labelColorErrors.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') +
      '\nreturn { lcPanelBackendOf: lcPanelBackendOf, lcLabelsOf: lcLabelsOf, lcErrorOf: lcErrorOf, lcSaveOutcome: lcSaveOutcome }\n'
    const leaf3 = new Function(
      'moduleMetaOf', 'buildPalettePrompt', 'buildPaletteTable', 'isColor', 'normalizeColor', 'pickChangedRows',
      leafSrc3,
    )(null, null, null, colors.isColor, colors.normalizeColor, colors.pickChangedRows)

    /** 最小 React：状态存进一排格子里，不自动重渲染——每次要看新状态就再调一次 run()。 */
    const makeReact = function () {
      const cells = []
      let n = 0
      return {
        React: {
          useState: function (init) {
            const i = n++
            if (!(i in cells)) cells[i] = (typeof init === 'function') ? init() : init
            return [cells[i], function (v) { cells[i] = (typeof v === 'function') ? v(cells[i]) : v }]
          },
          useRef: function (v) { const i = n++; if (!(i in cells)) cells[i] = { current: v }; return cells[i] },
          useEffect: function () {},
        },
        run: function (fn) { n = 0; return fn() },
        cells: cells,
      }
    }
    /** 跑一次真钩子，返回 { 钩子实例, 宿主收到的那一串调用 }。 */
    const driveHook = async function (panelSelection) {
      const sent = []
      const mini = makeReact()
      const hookFn = new Function(
        'React', 'host', 'log', 'dswsLogHash', 'dswsLogTrunc', 'storeOf',
        'pickChangedRows', 'lcLabelsOf', 'lcErrorOf', 'lcSaveOutcome', 'lcPanelBackendOf',
        hookSrc,
      )(
        mini.React,
        { call: function (method, args) { sent.push({ method: method, args: args }); return Promise.resolve({ ok: true, backendId: 'github', labels: [{ name: 'bug', color: 'd73a4a' }] }) } },
        function () {}, function () { return 'h' }, function (s) { return String(s) },
        function () { return { selection: panelSelection, snapshot: null } },
        colors.pickChangedRows, leaf3.lcLabelsOf, leaf3.lcErrorOf, leaf3.lcSaveOutcome, leaf3.lcPanelBackendOf,
      ).useLabelColors
      const render = function () { return mini.run(function () { return hookFn('/ws/x', null, 'sid-1') }) }
      const first = render()
      await first.reload({})
      return { sent: sent, render: render }
    }
    const argOf = function (sent, method) { const hit = sent.filter((s) => s.method === method); return hit.length ? hit[hit.length - 1].args : null }

    {
      const d = await driveHook({ backendId: 'github', source: 'matches' })
      const a = argOf(d.sent, 'wf.listLabels')
      check(!!a && a.backendId === 'github', '面板选定了 github → 列标签那条电话带上了 backendId: github（实得 ' + JSON.stringify(a) + '）')
      const h = d.render()
      h.setRowText('bug', '#112233')
      await d.render().save()
      const a2 = argOf(d.sent, 'wf.setLabelColors')
      check(!!a2 && a2.backendId === 'github' && Array.isArray(a2.changes) && a2.changes.length === 1,
        '面板选定了 github → 改色那条电话同样带上（实得 ' + JSON.stringify(a2) + '）')
    }
    {
      // 面板没选定后端：不许编一个出来 —— 参数里**连这个键都不该有**
      const d = await driveHook(null)
      const a = argOf(d.sent, 'wf.listLabels')
      check(!!a && !Object.prototype.hasOwnProperty.call(a, 'backendId'),
        '面板没选定后端 → 这个字段干脆不带（不编一个 id 出来）（实得 ' + JSON.stringify(a) + '）')
    }
    {
      // 面板当前是「无后端」（用户自己选的逃生舱）：同样不带
      const d = await driveHook({ backendId: null, source: 'explicit' })
      const a = argOf(d.sent, 'wf.listLabels')
      check(!!a && !Object.prototype.hasOwnProperty.call(a, 'backendId'),
        '面板当前是「无后端」→ 同样不带这个字段（实得 ' + JSON.stringify(a) + '）')
    }
  }

  // ---- 11) 真 DOM 里点真组件：（a）#632 三条关闭路径的确认纪律；（b）#631 的 D1 那颗入口按钮 ----
  // 为什么要有这一节：#632 修的毛病是「有未保存的改动时，右上角的 × 与点弹窗外的空白处会把改动直接丢掉」。
  // 这件事只有真点才验得出来——静态检查看不出「点第一次到底关没关」；#631 的 D1 同理：待定态下摆没摆那颗
  // 「去选定后端」的入口按钮，只有把真弹窗渲染出来才看得见。做法沿用 #630 那份 jsdom 自查脚本
  // （.scratch/map610/selfcheck/exit-guard.test.mjs；那份脚本已随 #632 删掉，它的覆盖就落在这一节里）：
  // jsdom 起一个真 DOM，挂**真源组件**，对一个会记账的 onClose 桩点按钮、点遮罩，看它到底调没调。
  // 状态机（草稿/改动）在这一节是替身：本节只问弹窗组件对「有草稿 / 没草稿」的反应，不问草稿怎么算出来的
  // （那由上面第 10 节与 verify-label-color-freshness 管）。
  {
    const { JSDOM } = await import('jsdom')

    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
    // Node 自带的 navigator 只有 getter，直接赋值会报「只有 getter」，所以用 defineProperty 覆盖。
    const put = function (k, v) { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) }
    put('window', dom.window)
    put('document', dom.window.document)
    put('navigator', dom.window.navigator)
    put('HTMLElement', dom.window.HTMLElement)
    put('Event', dom.window.Event)
    put('MouseEvent', dom.window.MouseEvent)
    put('IS_REACT_ACT_ENVIRONMENT', true)

    // react 与 react-dom 一定要在这个真 DOM 就位**之后**才加载：react-dom 在模块加载那一刻就会判定
    // 「本环境的输入框支不支持 input 事件」，当时没有 document 的话它退回老写法（只认 change 事件），
    // 于是「在输入框里打字」不会触发 onChange——而这一节赌的正是打字这条路（见情形五）。
    const ReactMod = (await import('react')).default
    const { createRoot } = await import('react-dom/client')
    const act = ReactMod.act

    // 叶子文件用的是「构建期拼接进来的自由变量」，不是 import，所以这里按仓库既有的办法加载：
    // 去掉行首 export，再用 new Function 把这些自由变量当参数传进去，跑的是**文件里的真代码**。
    const strip = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^(\s*)export\s+/gm, '$1') }
    const errLeaf = new Function(
      'moduleMetaOf', 'buildPalettePrompt', 'buildPaletteTable', 'isColor', 'normalizeColor', 'pickChangedRows', 'navigator', 'console',
      strip('src/client/views/labels/labelColorErrors.js') +
      '\nreturn { lcToDisplay: lcToDisplay, lcRowIncomplete: lcRowIncomplete, lcKindKey: lcKindKey, lcOutcomeRowOf: lcOutcomeRowOf, lcCopyAttemptOf: lcCopyAttemptOf, lcCopyFeedbackOf: lcCopyFeedbackOf, lcLabelsOf: lcLabelsOf, lcSaveOutcome: lcSaveOutcome, lcPanelBackendOf: lcPanelBackendOf, LC_PLACEHOLDER_COLOR: LC_PLACEHOLDER_COLOR }\n',
    )(null, prompt.buildPalettePrompt, prompt.buildPaletteTable, colors.isColor, colors.normalizeColor, colors.pickChangedRows, undefined, { warn: function () {} })

    // 词条用真源那一份（src/client/kernel/locale-labels.js）：断言盯的是用户真正读到的那句话。
    const L = new Function(strip('src/client/kernel/locale-labels.js') + '\nreturn { L_LABELS: L_LABELS }\n')().L_LABELS
    const tr = function (key, vars) {
      const raw = L.zh[key]
      const s = raw === undefined ? key : raw
      if (!vars) return s
      return s.replace(/\{(\w+)\}/g, function (m, name) { return vars[name] === undefined ? m : String(vars[name]) })
    }

    const DswsCtx = ReactMod.createContext(null)
    const Tip = function (props) { return (props && props.children) || null }
    const Ic = function () { return ReactMod.createElement('svg', { width: 14, height: 14 }) }
    const timer = { timeout: function (fn, ms) { return setTimeout(fn, ms) } }
    // 面板 store 的替身：一节里要能随时换，所以经这个可变变量转一道（#631 的 D1 那几条靠换它来造待定态；
    // 其余情形一律是 null）。
    let storeNow = null
    const storeOf = function () { return storeNow }

    const RowComp = new Function(
      'React', 'DswsCtx', 'tr', 'Tip', 'isColor', 'lcToDisplay', 'lcRowIncomplete', 'lcKindKey', 'LC_PLACEHOLDER_COLOR',
      strip('src/client/views/labels/LabelColorRow.js') + '\nreturn { LabelColorRow: LabelColorRow }\n',
    )(ReactMod, DswsCtx, tr, Tip, colors.isColor, errLeaf.lcToDisplay, errLeaf.lcRowIncomplete, errLeaf.lcKindKey, errLeaf.LC_PLACEHOLDER_COLOR).LabelColorRow

    // #637：弹窗标题那只图标的颜色走新叶子 labelColorPalette.js（真函数，与第 13 节同一份）。
    const palLeaf = new Function(
      'normalizeColor',
      strip('src/client/views/labels/labelColorPalette.js') +
      '\nreturn { lcEntryPaletteOf: lcEntryPaletteOf, LC_ENTRY_PALETTE_BODY: LC_ENTRY_PALETTE_BODY }\n',
    )(colors.normalizeColor)

    // 状态机替身每次挂载换一份，所以经这一层转一下（组件拿到的 useLabelColors 始终是同一个函数）。
    let hookNow = null
    const DialogComp = new Function(
      'React', 'DswsCtx', 'useLabelColors', 'tr', 'Tip', 'Ic', 'timer', 'storeOf', 'lcToDisplay', 'lcRowIncomplete',
      'lcKindKey', 'lcOutcomeRowOf', 'lcCopyAttemptOf', 'lcCopyFeedbackOf', 'lcWriteClipboard', 'LabelColorRow',
      'lcEntryPaletteOf', 'LC_ENTRY_PALETTE_BODY',
      strip('src/client/views/labels/LabelColorDialog.js') + '\nreturn { LabelColorDialog: LabelColorDialog }\n',
    )(
      ReactMod, DswsCtx, function () { return hookNow() }, tr, Tip, Ic, timer, storeOf, errLeaf.lcToDisplay,
      errLeaf.lcRowIncomplete, errLeaf.lcKindKey, errLeaf.lcOutcomeRowOf, errLeaf.lcCopyAttemptOf,
      errLeaf.lcCopyFeedbackOf, function () { return Promise.resolve(false) }, RowComp,
      palLeaf.lcEntryPaletteOf, palLeaf.LC_ENTRY_PALETTE_BODY,
    ).LabelColorDialog

    const ROWS = [
      { name: 'accessibility', color: '5c0783', description: '' },
      { name: 'bug', color: 'd73a4a', description: '' },
    ]
    const mount = function (initialDraft, failure, outcomeAfterSave) {
      hookNow = function () {
        const [draft, setDraft] = ReactMod.useState(initialDraft)
        // 保存结果是**点保存之后才出现**的（#635 的自动关窗就是靠它出现的那一刻触发的），
        // 所以这里把它做成一份状态：第三个参数给的那一段在点保存时被摆上去，一开始是空。
        const [outcome, setOutcome] = ReactMod.useState(null)
        const changes = Object.keys(draft).map(function (n) { return { name: n, color: draft[n] } })
        const st = {
          phase: 'ready', rows: ROWS, backendId: 'markdown', loadError: null, draft: draft, changes: changes,
          saving: false, outcome: outcome, reload: function () {}, save: function () { setOutcome(outcomeAfterSave || null) },
          setRowText: function (name, text) {
            setDraft(function (prev) { const next = Object.assign({}, prev); next[name] = text; return next })
          },
        }
        // 第二个参数给一段失败（{kind, message}）时改挂失败形态：正文换成失败那一段（#631 的 D1 那几条要的
        // 就是这一形态），这时没有标签行、也没有底部按钮区。
        if (failure) { st.phase = 'failed'; st.rows = []; st.loadError = failure }
        return st
      }
      const calls = { onClose: 0 }
      const holder = dom.window.document.createElement('div')
      dom.window.document.body.appendChild(holder)
      const root = createRoot(holder)
      act(function () {
        root.render(ReactMod.createElement(DswsCtx.Provider, { value: { h: ReactMod.createElement } },
          ReactMod.createElement(DialogComp, { cwd: '/ws', sessionId: 'selfcheck', narrow: false, onClose: function () { calls.onClose++ }, onSaved: function () {} })))
      })
      return { holder: holder, root: root, calls: calls }
    }
    const unmount = function (m) { act(function () { m.root.unmount() }); m.holder.remove() }
    const click = function (el) { act(function () { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
    const xBtn = function (h) { return h.querySelector('[data-lc-close-x]') }
    const exitBtn = function (h) { return h.querySelector('[data-lc-exit]') }
    const backdrop = function (h) { return h.querySelector('[data-role="label-colors-dialog"]') }
    const warnNote = function (h) { return h.querySelector('[data-lc-close-warn]') }
    const amberOf = function (el) { return !!el && (el.style.borderColor.indexOf('245') >= 0 || el.style.borderColor.indexOf('f59e0b') >= 0) }
    const warnText = function (m) { const n = warnNote(m.holder); return n ? n.textContent : '（没有提示）' }
    const DRAFT = { accessibility: '#5c0783' }
    const HINT = L.zh['lc.closeUnsaved']

    check(!!HINT, '三条关闭路径共用的那句提示词条在（lc.closeUnsaved）')
    check(!('lc.exitUnsaved' in L.zh) && !('lc.exitUnsaved' in L.en),
      '提示只有一套说法：只点名「退出」的旧词条 lc.exitUnsaved 已随这次统一去掉（中英都没有）')

    console.log('  #632 情形一：有草稿时点右上角的 ×')
    {
      const m = mount(DRAFT)
      const x = xBtn(m.holder)
      check(!!x, '右上角那颗 × 找得到（data-lc-close-x）')
      click(x)
      check(m.calls.onClose === 0, '第一次点 ×：没有关掉弹窗（onClose 0 次）')
      check(!!warnNote(m.holder) && warnNote(m.holder).textContent === HINT, '第一次点 ×：摆出的提示就是共用的那一句（实得：' + warnText(m) + '）')
      check(amberOf(xBtn(m.holder)), '第一次点 × 之后：× 自己变成琥珀色（' + xBtn(m.holder).style.borderColor + '）')
      check(amberOf(exitBtn(m.holder)), '同一份确认状态让底部「退出」一起变琥珀色（两处同一套颜色）')
      click(xBtn(m.holder))
      check(m.calls.onClose === 1, '第二次点 ×：真的关了（onClose 1 次）')
      unmount(m)
    }

    console.log('  #632 情形二：有草稿时点弹窗外的空白处')
    {
      const m = mount(DRAFT)
      const bd = backdrop(m.holder)
      const box = m.holder.querySelector('[data-role="label-colors-box"]')
      check(!!bd && !!box, '遮罩那一层与卡片都找得到')
      click(bd)
      check(m.calls.onClose === 0, '第一次点遮罩空白处：没有关掉弹窗（onClose 0 次）')
      check(!!warnNote(m.holder) && warnNote(m.holder).textContent === HINT, '第一次点遮罩空白处：摆出的提示与点 × 时逐字相同（实得：' + warnText(m) + '）')
      click(box)
      check(m.calls.onClose === 0 && !!warnNote(m.holder), '点卡片里面不算关：既不关也不把已经摆出来的提示收回去')
      click(bd)
      check(m.calls.onClose === 1, '第二次点遮罩空白处：真的关了（onClose 1 次）')
      unmount(m)
    }

    console.log('  #632 情形三：有草稿时点底部「退出」（#630 的现状保持）')
    {
      const m = mount(DRAFT)
      click(exitBtn(m.holder))
      check(m.calls.onClose === 0 && !!warnNote(m.holder), '第一次点「退出」：不关、摆提示')
      click(exitBtn(m.holder))
      check(m.calls.onClose === 1, '第二次点「退出」：关')
      unmount(m)
    }

    console.log('  #632 情形四：三条路共用同一份确认状态')
    {
      const m = mount(DRAFT)
      click(xBtn(m.holder))
      check(m.calls.onClose === 0 && !!warnNote(m.holder), '先用 × 摆出确认：还没关')
      click(exitBtn(m.holder))
      check(m.calls.onClose === 1, '确认摆着的时候，第二下点另一处（「退出」）也照关——共用一份状态，与提示里写的「这三处点哪一处都算」一致')
      unmount(m)
    }

    console.log('  #632 情形五：确认摆出来以后又动了草稿，上次的确认作废')
    {
      const m = mount(DRAFT)
      click(xBtn(m.holder))
      check(!!warnNote(m.holder) && m.calls.onClose === 0, '先点一次 ×：已摆提示、还没关')
      const input = m.holder.querySelector('input[type="text"][aria-label^="' + L.zh['lc.colorValue'] + '"]')
      check(!!input, '找得到那一行的颜色值输入框（真行控件渲染出来的）')
      act(function () {
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
        setter.call(input, '#5c0784')
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
      check(!warnNote(m.holder), '动过草稿之后：上次的确认作废，提示自己收起来了')
      click(xBtn(m.holder))
      check(m.calls.onClose === 0, '这时再点一次 ×：仍然不关（要重新点两次）')
      click(xBtn(m.holder))
      check(m.calls.onClose === 1, '再点一次 ×：才关')
      unmount(m)
    }

    console.log('  #632 情形六：没有未保存的改动时，三条路都一点就关')
    {
      const viaX = mount({})
      click(xBtn(viaX.holder))
      check(viaX.calls.onClose === 1 && !warnNote(viaX.holder), '没有草稿时点 ×：一次就关，不摆提示')
      unmount(viaX)

      const viaBackdrop = mount({})
      click(backdrop(viaBackdrop.holder))
      check(viaBackdrop.calls.onClose === 1 && !warnNote(viaBackdrop.holder), '没有草稿时点遮罩空白处：一次就关，不摆提示')
      unmount(viaBackdrop)

      const viaExit = mount({})
      click(exitBtn(viaExit.holder))
      check(viaExit.calls.onClose === 1 && !warnNote(viaExit.holder), '没有草稿时点「退出」：一次就关，不摆提示')
      unmount(viaExit)
    }

    console.log('  #635 情形七：全部改成功时弹窗自己关掉；只要有一条没成功就留着')
    {
      const saveButton = function (h) { return h.querySelector('button[aria-label="' + L.zh['lc.save'] + '"]') }
      const rowOf = function (name, ok, color) {
        return ok
          ? { name: name, ok: true, kind: '', message: '', color: color || '5c0783', missing: false }
          : { name: name, ok: false, kind: 'parse', message: '这一行的色值不是六位十六进制', missing: false }
      }
      const FULL = { appliedCount: 1, failedCount: 0, rows: [rowOf('accessibility', true)] }
      const SOME = { appliedCount: 1, failedCount: 1, rows: [rowOf('accessibility', true), rowOf('bug', false)] }
      const NONE = { appliedCount: 0, failedCount: 1, rows: [rowOf('accessibility', false)] }

      const mFull = mount(DRAFT, null, FULL)
      const btn = saveButton(mFull.holder)
      check(!!btn, '找得到底部那颗「保存」按钮')
      check(mFull.calls.onClose === 0, '刚打开还没点保存：不关（这一段赌的是保存成功那一刻才关）')
      click(btn)
      check(mFull.calls.onClose === 1, '点了保存、一条一条全部成功：弹窗自己关（onClose 一次）')
      unmount(mFull)

      const mSome = mount(DRAFT, null, SOME)
      click(saveButton(mSome.holder))
      check(mSome.calls.onClose === 0, '部分成功：不关（弹窗里「哪几条没成、为什么」那几行得留给用户看）')
      unmount(mSome)

      const mNone = mount(DRAFT, null, NONE)
      click(saveButton(mNone.holder))
      check(mNone.calls.onClose === 0, '一条都没成：不关（同样的理由，这时最不能把弹窗收掉）')
      unmount(mNone)

      // 保存这一步整体失败（连逐条结果都没有）：outcome 的 appliedCount 是 0，按上面同一条判据不关。
      const mWholeFail = mount(DRAFT, null, { appliedCount: 0, failedCount: 1, rows: [rowOf('accessibility', false)], wholeError: { kind: 'env', message: '宿主回话说这一步没能做完' } })
      click(saveButton(mWholeFail.holder))
      check(mWholeFail.calls.onClose === 0, '整体失败：不关')
      unmount(mWholeFail)
    }

    console.log('  #635 情形八：真的状态机报给面板的是什么（这一节其余地方都是替身，这一段挂真钩子）')
    {
      // 为什么要有这一段：报给面板的东西决定面板当场显示什么颜色，而这一层只有真跑一遍才看得出
      // 「用的是后端回包里的色值，还是用户填进格子的原文」。做法：把真 useLabelColors 挂进一个什么都不
      // 渲染的探针组件（钩子要有 React 才跑得起来），宿主那两条电话用替身回话。
      const HOOK_ROWS = [
        { name: 'accessibility', color: '5c0783', description: '' },
        { name: 'bug', color: 'd73a4a', description: '' },
      ]
      let hostReplies = {}
      const hostNow = {
        call: function (method) {
          return Promise.resolve(hostReplies[method] || { ok: false, error: { kind: '', message: '替身没准备这个电话：' + method } })
        },
      }
      const hookLeaf = new Function(
        'React', 'host', 'log', 'dswsLogHash', 'dswsLogTrunc', 'storeOf', 'lcPanelBackendOf', 'lcLabelsOf', 'lcSaveOutcome', 'pickChangedRows',
        strip('src/client/views/labels/useLabelColors.js') + '\nreturn { useLabelColors: useLabelColors }\n',
      )(ReactMod, hostNow, function () {}, function () { return 'hash8' }, function (s) { return s }, storeOf,
        errLeaf.lcPanelBackendOf, errLeaf.lcLabelsOf, errLeaf.lcSaveOutcome, colors.pickChangedRows).useLabelColors

      let hookApi = null
      let reports = []
      const Probe = function (props) {
        hookApi = hookLeaf(props.cwd, props.onSaved, props.sessionId)
        return null
      }
      const mountProbe = async function () {
        reports = []
        const holderH = dom.window.document.createElement('div')
        dom.window.document.body.appendChild(holderH)
        const rootH = createRoot(holderH)
        await act(async function () {
          rootH.render(ReactMod.createElement(Probe, { cwd: '/ws', sessionId: 'selfcheck', onSaved: function (rows) { reports.push(rows) } }))
        })
        return { holder: holderH, root: rootH }
      }
      const unmountProbe = function (m) { act(function () { m.root.unmount() }); m.holder.remove() }

      // 甲：一条改动、后端说改成功，回包里的色值是它自己的写法（大写、不带井号）
      hostReplies = {
        'wf.listLabels': { ok: true, backendId: 'markdown', labels: HOOK_ROWS },
        'wf.setLabelColors': { ok: true, data: { applied: [{ name: 'bug', color: '0B7285' }], failed: [] } },
      }
      const mProbe = await mountProbe()
      check(!!hookApi && hookApi.phase === 'ready' && hookApi.rows.length === 2, '真钩子把替身回的清单读成 ready（两行）')
      await act(async function () { hookApi.setRowText('bug', '#0b7285') })
      check(hookApi.changes.length === 1 && hookApi.changes[0].name === 'bug', '在那一行填了新色：待提交的改动正好一条')
      await act(async function () { await hookApi.save() })
      check(reports.length === 1, '保存成功后报给面板一次（实得 ' + reports.length + ' 次）')
      check(reports.length === 1 && reports[0].length === 1 && reports[0][0].name === 'bug' && reports[0][0].color === '0B7285',
        '报上去的是后端回包里的那条（用它自己的写法 0B7285，而不是用户填的 #0b7285）：' + JSON.stringify(reports[0]))

      // 乙：两行都改、一行成功一行失败 → 只报成功的那一条
      hostReplies = {
        'wf.listLabels': { ok: true, backendId: 'markdown', labels: HOOK_ROWS },
        'wf.setLabelColors': { ok: true, data: { applied: [{ name: 'bug', color: '0b7285' }], failed: [{ name: 'accessibility', reason: { kind: 'not-found', message: '配色文件里没有这一行' } }] } },
      }
      await act(async function () { hookApi.reload({}) })
      // 两行各写一次、各等一次渲染：setRowText 是按「这一轮渲染时的那份草稿」改的，
      // 同一个 tick 里连写两行只有最后一次算数（真实界面里两行是两次独立的输入事件，不会撞在一起）。
      await act(async function () { hookApi.setRowText('bug', '#0b7285') })
      await act(async function () { hookApi.setRowText('accessibility', '#5c0784') })
      check(hookApi.changes.length === 2, '两行都填了新色：待提交的改动两条（实得 ' + hookApi.changes.length + '）')
      const beforePartial = reports.length
      await act(async function () { await hookApi.save() })
      check(reports.length === beforePartial + 1, '部分成功也报一次（成功的那几条照样要当场显示）')
      check(reports[reports.length - 1].length === 1 && reports[reports.length - 1][0].name === 'bug',
        '报上去的只有真改成功的那一条（实得 ' + JSON.stringify(reports[reports.length - 1]) + '）')

      // 丙：整体失败（连逐条结果都没有）→ 一条都不报
      hostReplies = {
        'wf.listLabels': { ok: true, backendId: 'markdown', labels: HOOK_ROWS },
        'wf.setLabelColors': { ok: false, error: { kind: 'env', message: '这一步没能做完' } },
      }
      await act(async function () { hookApi.reload({}) })
      await act(async function () { hookApi.setRowText('bug', '#0b7285') })
      const beforeFail = reports.length
      await act(async function () { await hookApi.save() })
      check(reports.length === beforeFail, '一条都没成功：一条都不报（一条都没改，面板没有可改的颜色）')
      unmountProbe(mProbe)
    }

    console.log('  #631 的 D1：面板还在识别后端（待定）时，不摆那颗「去选定后端」的入口按钮')
    {
      // 这一段的形态：列表这一步以 conflict 档失败（后端返回的说明就是宿主 src/host/workspaceCwd.js 里那句
      // 「这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试」），而面板那条会话状态正停在「还在识别」上。
      // 待定时面板头部那颗「切换后端」按钮是禁用的（panel/Dock.js 的 _pend 分支），所以弹窗这时不能摆
      // 那颗「关掉弹窗，去面板头部选定后端」的入口按钮——点了没反应，正是 #631 要消灭的无效动作。
      const CONFLICT = { kind: 'conflict', message: '这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试（后端识别尚未完成，请稍后重试）' }
      const whereNote = function (h) { return h.querySelector('[data-lc-where]') }
      const waitNote = function (h) { return h.querySelector('[data-lc-wait]') }
      const goPickBtn = function (h) { return h.querySelector('[data-lc-gopick]') }
      const textOf = function (n) { return n ? n.textContent : '（没有这一句）' }

      storeNow = { selection: { backendId: 'github', pending: true, source: 'matches' } }
      const mPending = mount({}, CONFLICT)
      check(!goPickBtn(mPending.holder),
        '待定时不摆那颗入口按钮（面板头部那颗「切换后端」按钮此刻是禁用的，点了没反应）')
      check(!!waitNote(mPending.holder) && waitNote(mPending.holder).textContent === L.zh['lc.errWaitBackend'],
        '待定时改摆那句诚实的话（正在识别，等它出结果再点「重试」）（实得：' + textOf(waitNote(mPending.holder)) + '）')
      check(!whereNote(mPending.holder),
        '待定时连「去哪儿选定后端」那一句也收起——它指的正是那颗点不动的按钮')
      unmount(mPending)

      // 不是待定的 conflict（真机上两个后端同时认领那种）：照旧摆那颗入口按钮与那句「去哪儿选」
      storeNow = { selection: { backendId: 'github', pending: false, source: 'matches' } }
      const mReady = mount({}, CONFLICT)
      check(!!goPickBtn(mReady.holder), '不是待定的 conflict 仍然摆那颗入口按钮（这次补修没有把它一起拿掉）')
      check(!!whereNote(mReady.holder) && whereNote(mReady.holder).textContent === L.zh['lc.errWherePick'],
        '不是待定时摆的仍然是「去哪儿选定后端」那一句（实得：' + textOf(whereNote(mReady.holder)) + '）')
      check(!waitNote(mReady.holder), '不是待定时不摆「正在识别」那句话')
      unmount(mReady)

      // 读不到面板状态（这里 storeOf 给 null）：当作「不是待定」，与这次补修之前的行为一样，不编一个待定出来
      storeNow = null
      const mUnknown = mount({}, CONFLICT)
      check(!!goPickBtn(mUnknown.holder), '读不到面板状态时当作「不是待定」，照旧摆那颗入口按钮（不编一个待定出来）')
      unmount(mUnknown)
    }
  }

  // ---- 12) #635：保存成功后写进面板那份快照的颜色（纯函数；面板当场按新色显示靠的就是它）----
  {
    console.log('  #635 A：保存成功后写进面板快照的颜色，以及那一笔记录')
    const stripLeaf = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^(\s*)export\s+/gm, '$1') }
    const patch = new Function(
      'normalizeColor',
      stripLeaf('src/client/views/labels/labelColorPatch.js') +
      '\nreturn { lcSavedColorMapOf: lcSavedColorMapOf, lcPatchSnapshotColors: lcPatchSnapshotColors, lcRememberSavedColors: lcRememberSavedColors, lcPanelSavedColors: lcPanelSavedColors, lcApplySavedColorsOnInstall: lcApplySavedColorsOnInstall }\n',
    )(colors.normalizeColor)

    // 拿来的一律归一成不带井号的小写六位；认不出的丢掉
    const map = patch.lcSavedColorMapOf([
      { name: 'bug', color: '#0B7285' },
      { name: 'accessibility', color: '  #5C0783  ' },
      { name: 'oops', color: '12345' },
      { name: '', color: 'ffffff' },
      null,
    ])
    check(map.bug === '0b7285' && map.accessibility === '5c0783', '带井号、大写、前后空格都归一成不带井号的小写六位（实得 ' + JSON.stringify(map) + '）')
    check(!('oops' in map) && !('' in map), '六位以外的色值与没有名字的条目一律不认（写进面板的必须是后端确认过的好色值）')

    // 同一个标签在快照里的每个落脚点都要写到，否则面板上一半新色一半旧色
    const makeSnap = function () {
      return {
        generatedMs: 1000,
        labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'accessibility', color: '5c0783' }],
        deck: { labels: [{ name: 'bug', color: 'd73a4a' }] },
        maps: [{ key: '610', labels: [{ name: 'bug', color: 'd73a4a' }], tickets: [{ key: '1', labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'needs-triage', color: 'fbca04' }] }] }],
        issues: [{ key: '9', labels: [{ name: 'bug', color: 'd73a4a' }] }],
      }
    }
    const snap = makeSnap()
    const places = patch.lcPatchSnapshotColors(snap, { bug: '0b7285' })
    check(places === 5, '同一个标签在快照里的五个落脚点全写到了（标签表 / 派生色板 / 地图容器 / 地图下的票 / 没挂图的票）：实得 ' + places)
    check(snap.labels[0].color === '0b7285' && snap.deck.labels[0].color === '0b7285' &&
      snap.maps[0].labels[0].color === '0b7285' && snap.maps[0].tickets[0].labels[0].color === '0b7285' && snap.issues[0].labels[0].color === '0b7285',
      '五个落脚点拿到的都是新色')
    check(snap.labels[1].color === '5c0783' && snap.maps[0].tickets[0].labels[1].color === 'fbca04',
      '没在这次改动里的标签，颜色一处都没动')
    check(patch.lcPatchSnapshotColors(snap, { bug: '0b7285' }) === 0, '同样的颜色再写一遍：一处都不算改动（幂等，不会让面板白重画）')

    // 那一笔记录：比它旧的快照要补，比它新的快照让它作废
    const st = { snapshot: makeSnap() }
    check(patch.lcPanelSavedColors(st, [{ name: 'bug', color: '#0B7285' }], 2000) === true,
      '面板收到「保存成功」：记一笔并当场改当前那份快照（返回真 = 要重画）')
    check(st.lcSavedColors && st.lcSavedColors.colors.bug === '0b7285' && st.lcSavedColors.at === 2000,
      '记录里存的是后端确认的色值与那一刻（实得 ' + JSON.stringify(st.lcSavedColors) + '）')
    check(st.snapshot.labels[0].color === '0b7285', '当前那份快照当场就是新色（面板不必等那次二十多秒的全量重拉）')

    const stale = { generatedMs: 1000, labels: [{ name: 'bug', color: 'd73a4a' }], maps: [], issues: [] }
    check(patch.lcApplySavedColorsOnInstall(st, stale) === true, '保存前发出去、保存后才回来的那份旧快照：装进面板时按记录补色')
    check(stale.labels[0].color === '0b7285', '补的就是后端确认的那个色（不让面板倒回旧色）')
    check(!!st.lcSavedColors, '补完记录还留着（后面可能还有更旧的快照回来）')

    const fresh = { generatedMs: 3000, labels: [{ name: 'bug', color: '0b7285' }], maps: [], issues: [] }
    check(patch.lcApplySavedColorsOnInstall(st, fresh) === false, '保存之后生成的那份快照：不补色（它自己就知道真相）')
    check(!st.lcSavedColors, '记录当场作废，不再往后盖（免得盖掉后来别人又改过的颜色）')
  }

  // ---- 13) #637：入口图标的颜色（四个 wayfinder 标签的真实颜色，缺哪个哪个回默认色）----
  // 负责人定的三件事：① 盘身也要上色（暖木色）；② 按钮尺寸形状一个字不动，只上色；
  // ③ 四颗颜料点取 wayfinder:map / research / prototype / task 四个标签的真实颜色，
  // 异常、不存在等任何特殊情况用默认色兜底。钉三处：纯函数给的颜色对不对、图标用不用传进来的颜色、
  // 两处调用点（入口按钮与弹窗标题）传没传同一套颜色。
  {
    console.log('  #637：入口图标的颜色（真实颜色加默认兜底）')
    const palSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/labelColorPalette.js'), 'utf8')
      .replace(/^(\s*)export\s+/gm, '$1') +
      '\nreturn { LC_ENTRY_PALETTE_SLOTS: LC_ENTRY_PALETTE_SLOTS, LC_ENTRY_PALETTE_DEFAULTS: LC_ENTRY_PALETTE_DEFAULTS, LC_ENTRY_PALETTE_BODY: LC_ENTRY_PALETTE_BODY, lcEntryPaletteOf: lcEntryPaletteOf }\n'
    const pal = new Function('normalizeColor', palSrc)(colors.normalizeColor)

    // 槽位与默认值逐字钉死：顺序即图标上四个圆点的次序（左下、左上、右上、右下），改一个字图标就变样
    check(JSON.stringify(pal.LC_ENTRY_PALETTE_SLOTS) === JSON.stringify(['wayfinder:map', 'wayfinder:research', 'wayfinder:prototype', 'wayfinder:task']),
      '四个槽位就是负责人点的四个标签，顺序即圆点次序（实得 ' + JSON.stringify(pal.LC_ENTRY_PALETTE_SLOTS) + '）')
    check(JSON.stringify(pal.LC_ENTRY_PALETTE_DEFAULTS) === JSON.stringify(['light-dark(#d73a4a,#f87171)', 'light-dark(#bf8700,#e3b341)', 'light-dark(#1a7f37,#3fb950)', 'light-dark(#0969da,#58a6ff)']),
      '四个默认色是深浅两档（实得 ' + JSON.stringify(pal.LC_ENTRY_PALETTE_DEFAULTS) + '）')
    check(pal.LC_ENTRY_PALETTE_BODY.fill === 'light-dark(#e8c98f,#c9a063)' && pal.LC_ENTRY_PALETTE_BODY.stroke === 'light-dark(#a8763c,#e0bd86)',
      '盘身是暖木色填充加深一档描边（实得 ' + JSON.stringify(pal.LC_ENTRY_PALETTE_BODY) + '）')

    // 四个标签都在：原样显示，归一成带井号的小写六位；清单里多余的标签不理
    const full = pal.lcEntryPaletteOf([
      { name: 'wayfinder:map', color: '8b5cf6' },
      { name: 'wayfinder:research', color: '#0EA5E9' },
      { name: 'wayfinder:prototype', color: '  f59e0b  ' },
      { name: 'wayfinder:task', color: '10b981' },
      { name: 'bug', color: 'd73a4a' },
    ])
    check(JSON.stringify(full) === JSON.stringify(['#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981']),
      '四个标签都在时取真实颜色（带井号大写、前后空格都归一；多余的标签不理；实得 ' + JSON.stringify(full) + '）')

    // 缺席、空色、错色：只那个槽位回默认，其余不动
    const partial = pal.lcEntryPaletteOf([
      { name: 'wayfinder:map', color: '' },
      { name: 'wayfinder:research', color: 'zzzzzz' },
      { name: 'wayfinder:task', color: '10b981' },
    ])
    check(partial[0] === pal.LC_ENTRY_PALETTE_DEFAULTS[0] && partial[1] === pal.LC_ENTRY_PALETTE_DEFAULTS[1] &&
      partial[2] === pal.LC_ENTRY_PALETTE_DEFAULTS[2] && partial[3] === '#10b981',
      '空色、错色与整个标签缺席都只让那个槽位回默认（实得 ' + JSON.stringify(partial) + '）')

    // 清单本身拿不到：四个全是默认色（入口按钮挂载时、取失败时就是这个样子）
    for (const bad of [null, undefined, 'nope', {}, 42]) {
      const got = pal.lcEntryPaletteOf(bad)
      check(JSON.stringify(got) === JSON.stringify(pal.LC_ENTRY_PALETTE_DEFAULTS),
        '清单是 ' + JSON.stringify(bad) + ' 时四个全是默认色（实得 ' + JSON.stringify(got) + '）')
    }
    // 同名出现两次：以第一次为准（标签名在后端是唯一的，真给了重复的不值得再定一条规则）
    const dup = pal.lcEntryPaletteOf([
      { name: 'wayfinder:map', color: '8b5cf6' },
      { name: 'wayfinder:map', color: 'ff0000' },
    ])
    check(dup[0] === '#8b5cf6', '同名标签出现两次以第一次为准（实得 ' + JSON.stringify(dup) + '）')
    // 形状不对的颜色一律回默认：三位、八位、非字符串
    const odd = pal.lcEntryPaletteOf([
      { name: 'wayfinder:map', color: 'f00' },
      { name: 'wayfinder:research', color: '8b5cf6ff' },
      { name: 'wayfinder:prototype', color: 123456 },
      { name: 'wayfinder:task', color: null },
    ])
    check(odd[0] === pal.LC_ENTRY_PALETTE_DEFAULTS[0] && odd[1] === pal.LC_ENTRY_PALETTE_DEFAULTS[1] &&
      odd[2] === pal.LC_ENTRY_PALETTE_DEFAULTS[2] && odd[3] === pal.LC_ENTRY_PALETTE_DEFAULTS[3],
      '三位、八位、非字符串颜色一律回默认（实得 ' + JSON.stringify(odd) + '）')

    // 图标用传进来的颜色，不自己定：盘身取 bodyFill / bodyStroke，四点取 colors[0..3]；
    // 没传时退回以前的样子（盘身不填、四点取当前文字色），图标在任何调用下都画得出来。
    const iconsSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/icons.js'), 'utf8')
    const palBranch = iconsSrc.slice(iconsSrc.indexOf("case 'palette'"), iconsSrc.indexOf('default:'))
    check(/fill:\s*pDot\(0\)/.test(palBranch) && /fill:\s*pDot\(1\)/.test(palBranch) &&
      /fill:\s*pDot\(2\)/.test(palBranch) && /fill:\s*pDot\(3\)/.test(palBranch),
      '调色盘四个圆点的填充色取传进来的 colors[0..3]')
    check(!/fill:\s*'currentColor'/.test(palBranch), '调色盘分支里不再有写死的灰色圆点（整只上色，不留灰）')
    check(/fill:\s*pFill/.test(palBranch) && /stroke:\s*pStroke/.test(palBranch), '盘身取传进来的 bodyFill / bodyStroke')
    check(/r:\s*1\.1/.test(palBranch), '圆点半径没动（按钮什么都不改，只是上色）')

    // 两处调用点都把颜色传进去：入口按钮传取回来的清单，弹窗标题传它这次取回来的行
    const entrySrc = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/LabelColorEntry.js'), 'utf8')
    check(/Ic\(\{\s*n:\s*'palette',\s*size:\s*10,\s*colors:\s*dots,\s*bodyFill:\s*LC_ENTRY_PALETTE_BODY\.fill,\s*bodyStroke:\s*LC_ENTRY_PALETTE_BODY\.stroke\s*\}\)/.test(entrySrc),
      '入口按钮把取到的四色与盘身两色传进图标（尺寸仍是 10）')
    check(entrySrc.includes("host.call('wf.listLabels'") && entrySrc.includes('lcEntryPaletteOf(null)') && entrySrc.includes('lcEntryPaletteOf(list)'),
      '入口按钮挂载就取一次清单：先摆默认色，取回来换真实颜色，取失败保持默认色不报错')
    check(/border:\s*'1px solid '\s*\+\s*edgeTint/.test(entrySrc) && /edgeTint\s*=\s*LC_ENTRY_PALETTE_BODY\.stroke/.test(entrySrc),
      '按钮那圈描边与调色盘盘身边框是同一个木色（尺寸圆角不动，只换描边色，不再是灰的）')
    const dialogSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/labels/LabelColorDialog.js'), 'utf8')
    check(/Ic\(\{\s*n:\s*'palette',\s*size:\s*14,\s*colors:\s*lcEntryPaletteOf\(lc\.rows\)/.test(dialogSrc),
      '弹窗标题用同一只图标、同一套颜色（取它这次取回来的行）')
  }

  console.log(failed ? `\n存在失败（共 ${total} 项）` : `\n全部通过 — 配色核心纯函数门禁生效（${total} 项）`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
