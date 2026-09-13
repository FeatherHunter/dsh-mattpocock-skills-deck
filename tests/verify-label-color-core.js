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

  console.log(failed ? `\n存在失败（共 ${total} 项）` : `\n全部通过 — 配色核心纯函数门禁生效（${total} 项）`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
