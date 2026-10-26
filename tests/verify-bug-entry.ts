// verify-bug-entry.ts — 新增BUG入口契约（issue #4 · v2 修 #1 BUG3：7 字段挪到末尾 · v3 UX：宽度自适应 + 按钮 hover 反馈 · #14 契约 v3.4：4 项 + 例行紧贴 · v4 #63 grilling 定版：去内部规则+实际→期望+括号单行 · v5 #475：补标签要求 bug 必带+未诊断带 needs-triage，分远端原生/本地标签行 · v7 #882：压薄终稿四节清单 + 尾部四选填通用版）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-bug-entry.ts [file...]（不给文件时读下面列出的真源；给了文件就只查那些文件）
// 验证：
//   1) 注册表条目 newBugWayfinder（version≥5/placeholders/use/zh/en），注册表本体为极简（按 wayfinder 技能规则处理）+ v5 标签要求（bug 必带+未诊断带 needs-triage，分远端原生/本地标签行），不含内部规则展开，4 字段括号单行在「四项引导语」那一段（末尾），无 gh 硬编码
//   2) i18n 键 nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 双语平衡
//   3) StatusBar BUG 段悬停菜单接线（s.bugMenuOpen + tr('nav.bugNew') + 点「新增」开新会话预填 newBugWayfinderText）
//   4) 面板「+ 新增BUG单」按钮接线（panel.newBugTitle + openTextInNewSession(newBugWayfinderText) 两处渲染）
//   5) Ic bug 图标注册（case 'bug'）
//   6) 文本拼接：newBugWayfinderText = promptText + BODY_FORMAT + locale 切换（promptLang()==='en' ? EN : ZH）——字段真正落在末尾
//   7) 双源接线与注册表键一致（含 NEW_BUG_FIELDS_BODY_EN）
//   8) 死区回归守护：BUG 悬停菜单弹层 marginBottom=0
//   9) 宽度自适应（v3 UX）：弹层无 minWidth
//  10) hover 反馈（v3 UX）：bugMenuHover 状态 + onMouseEnter/Leave + 条件红染色
//  11) v4 #63：字段集 = 实际→期望→复现步骤→环境信息（4 项括号单行），顺序实际→期望，无悬行例行，zh/en 分离
//  12) v5 #475：标签要求 = bug 必带+未诊断带 needs-triage，分远端原生/本地标签行，中英文一致
//  13) v15 #1461：删「## 查历史」，插「## 查重」（两次全扫 state=open/closed + labels=['bug'] + limit=200、
//      一次取全、不用关键词代替、命中最多 3 张候选交报告人确认、四类出口、前置条件与工具报错例外）与
//      「## 查重记录」（扫描 / 命中 / 报告人确认 / 结论四行，没命中写「无」，清单可能不全要写下来），
//      中英文对应；版本锁 v15。
// 2026-10-19（#1301 批C）：默认目标里混着 .js 说明符（router.js、StatusBar.js……），它们今天住在同名 .ts 里，
//   旁边那份 .js 构建产物这一阶段已经删掉，按 .js 路径直接 fs.readFileSync 会 ENOENT。取源改走共用入口
//   sourceText：问 .js 时同名 .ts 优先，问到哪份读哪份的原文；.ts 说明符原样透传。
// 2026-10-20（#1292）：提示词真源搬进了 config/prompts/ 下的 YAML —— 注册表条目 newBugWayfinder 与
//   「四项引导语」片段 newBugFields 都住在 config/prompts/ticket-creation.yaml 里；
//   src/client/kernel/prompts.ts 里的 NEW_BUG_FIELDS_BODY / NEW_BUG_FIELDS_BODY_EN 现在只是
//   「按语言从片段取这一段」的取用口，源码里不再有那段字面量。
//   所以这一扇门禁改走共享读取核 scripts/lib/prompt-config.mts 读 YAML（不再从源码里用正则抠字面量），
//   同时仍要查 prompts.ts 那个取用口确实在用这个片段 —— 正文与接线两头都查，判据一条不减。
const { sourceText } = require('./lib/source-text.ts')
const path = require('path')
// 读提示词 YAML 走共享读取核（scripts/lib/prompt-config.mts）：与生成器、另两扇提示词门禁读的是同一份实现，
//   本门禁里不再自己写一份 YAML 解析（那样两边的口径迟早分家）。
const { readPromptConfig } = require('../scripts/lib/prompt-config.mts')
// #1294：界面词条真源搬到 config/copy/*.yaml，读它走同一套共享读取核（不自己写第二份 YAML 解析）。
const { readCopyConfig } = require('../scripts/lib/copy-config.mts')
const files = process.argv.slice(2)
// 仓库根：共享读取核按仓库相对路径去找 config/prompts/ 下的 YAML，根算错就读不到（报错也难懂，先算准）。
const ROOT = path.resolve(__dirname, '..')
// 2026-10-17 先修：默认目标原来是两个构建产物（client.js / package/lib/client.js）。产物里的注册表条目与 i18n
// 键都被 esbuild 统一改成双引号了，而门禁按单引号 + 「函数体里一段引号字符串」的老形状写，于是七条判据
// 全部恒假——门禁红着，产品其实是好的。改成默认读真源（下面七份），产物那边由各自的构建新鲜度门禁守。
const DEFAULT_SOURCES = [
  'src/client/kernel/prompts.ts',        // NEW_BUG_FIELDS_BODY 的取用口（正文真身在 config/prompts/ticket-creation.yaml）
  'src/client/kernel/router.js',         // newBugWayfinderText 拼接（按语言链取正文）
  // #1294：nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 这四条词条随界面词表搬到
  //   config/copy/panel.yaml，源码里不再有；下面第 2 组改从共享读取核 readCopyConfig 按语言逐门查（判据更严）。
  'src/client/statusbar/StatusBar.js',   // BUG 悬停菜单弹层与开新会话接线（其一）
  'src/client/views/shared/Tabs.js',     // 面板「+ 新增BUG单」按钮接线（其二）
  'src/refresh/rooms/client/snapshot-cache-store.js', // bugMenuHover 默认状态
  'src/client/kernel/icons.js',          // Ic bug 图标
]
const targets = files.length ? [files] : [DEFAULT_SOURCES]
let failed = false
// v7 #882：4 字段引导语（顺序：实际 → 期望 → 复现 → 环境），括号单行形态，历史调查归 AI 不进填空，环境通用不点名产品。
// 括号内的话只是提示，不是必填项——文案改成「知道多少写多少、答不全照常建单」，判据跟着换。
const FIELDS_ZH = ['实际（看到了什么现象；知道影响范围就一并写上）：', '期望（原本预期是什么样；和实际看到的差异写清楚）：', '复现步骤（能说清前置条件和场景就先写，再按编号步骤写；只是偶发的话写下大概频率）：', '环境信息（知道的话写上 OS 版本、软件版本、运行环境）：']
const FIELDS_EN = ['Actual (the symptom; add the impact if you know it):', 'Expected (your expectation, plus the diff from actual):', 'Reproduction (preconditions and scenario if you can, then numbered steps; if it is flaky, note how often):', 'Environment (OS version, software version and runtime, as much as you know):']
// v4：括号内说明即指引，无独立例行；仍需校验说明关键字在场（防文案丢失）
const DESC_ZH = ['现象', '影响范围', '预期', '差异', '前置条件', '编号步骤', '偶发', 'OS 版本', '软件版本', '运行环境']
const DESC_EN = ['symptom', 'impact', 'expectation', 'diff from actual', 'preconditions and scenario', 'numbered steps', 'flaky', 'OS version', 'software version', 'runtime']
// v4 形态守护：括号单行，每字段为 “字段名（说明）：” 单行，字段间用 \n 分隔，无 “\n  例：” 悬行
const BRACKET_LINE_ZH = ['实际（看到了什么现象；知道影响范围就一并写上）：', '期望（原本预期是什么样；和实际看到的差异写清楚）：', '复现步骤（能说清前置条件和场景就先写，再按编号步骤写；只是偶发的话写下大概频率）：', '环境信息（知道的话写上 OS 版本、软件版本、运行环境）：']
const BRACKET_LINE_EN = ['Actual (the symptom; add the impact if you know it):', 'Expected (your expectation, plus the diff from actual):', 'Reproduction (preconditions and scenario if you can, then numbered steps; if it is flaky, note how often):', 'Environment (OS version, software version and runtime, as much as you know):']
// 头一句必须明确「这四项是提示、不是必答」，并交代「答不全也照常建单、缺的标 needs-info」；
//   旧口径「均为必填 / 先回问报告人补齐」不许回潮，否则会话又会逼报告人逐项填满。
const HINT_HEAD_ZH = '不是四道必答题'
const HINT_RULE_ZH = '只答出一部分时照常建单，缺的地方标 needs-info'
const HINT_HEAD_EN = 'they are not four questions that must be answered'
const HINT_RULE_EN = 'still file the ticket and label the missing parts needs-info'
// #1292：原来那条「从源码里抠注册表条目」的正则（RE_ENTRY，2026-10-17 改的引号无关形状）已经删掉 ——
//   注册表的真源搬进了 config/prompts/ 下的 YAML，源码里不再有那段字面量，正则一条也抠不到（那样会静默漏判）。
//   现在改从共享读取核读 YAML，拿到的是解码好的正文（也不用再处理源码里的转义）。
/**
 * 短语清单检查：每组是「必须出现的原文 / 少了报什么」。
 * 表驱动是为了新增判据只加一行，不用复制同形的 if；诊断话仍逐条不同，红的时候一眼能看出缺哪句。
 */
const containsAll = function (problems, text, pairs) {
  pairs.forEach(function (pair) { if (text.indexOf(pair[0]) < 0) problems.push(pair[1]) })
}
const check = function (list) {
  const names = Array.isArray(list) ? list : [list]
  const src = names.map(function (f) { return sourceText(f) }).join('\n')
  const label = names.length === 1 ? names[0] : '真源 ' + names.length + ' 份'
  const problems = []
  // 1) 注册表条目
  // #1292：真源搬进了 config/prompts/ticket-creation.yaml，这里改从共享读取核读它（读回来的正文已解码，
  //   不用再像从前那样从源码字面量里抠文本、也不用处理源码里的转义）。
  let cfg = null
  try {
    cfg = readPromptConfig(ROOT)
  } catch (e) {
    problems.push('读 config/prompts/ 下的 YAML 失败：' + (e && e.message ? e.message : String(e)))
  }
  const templates = cfg && cfg.templates ? cfg.templates : {}
  const fragments = cfg && cfg.fragments ? cfg.fragments : {}
  // 模板按族分层，newBugWayfinder 住在 ticket-creation 族；这里按 id 找，不写死族名（族名以后可能挪）。
  let entry = null
  for (const family of Object.keys(templates)) {
    const group = templates[family]
    if (group && group.newBugWayfinder) { entry = group.newBugWayfinder; break }
  }
  if (!entry) { problems.push('缺 newBugWayfinder 注册表条目（config/prompts/ 下的 YAML 里没有这一条）') }
  else {
    const ver = Number(entry.version)
    const use = entry.use
    const zh = entry.zh
    const en = entry.en
    // v15 #1461：版本底线抬到 15，与 verify-prompts 的 V_MIN、verify-1407-next-steps-reminders 的下限同一口径
    //   （那边写的是「不低于 min」）。注入面靠 version 判断该劝哪些步骤；版本落后说明跑的是旧提示词，
    //   门禁必须红，否则「查重没生效」会被误当成产品行为。提示词文本另有自摘要锁（verify-prompts 的 LOCK），
    //   真正改文案时几处版本断言会一起被逼着抬，不需要在这里再单独锁死一个精确版本号。
    if (ver < 15) problems.push('newBugWayfinder 版本应不低于 v15（#1461 建单前查重；实际 v' + ver + '，低于 15 说明注入的还是旧提示词）')
    if (!use) problems.push('newBugWayfinder 缺 use')
    const ph = entry.placeholders || []
    if (ph.join(',') !== 'repo') problems.push('newBugWayfinder 占位符应为 ["repo"]，实际 ' + JSON.stringify(ph))
    // v4：注册表本体为极简（按 wayfinder 技能规则处理），不含内部规则展开
    if (zh.indexOf('请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。') < 0) problems.push('newBugWayfinder zh 缺极简句“请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。”')
    if (en.indexOf('Please help me file a new BUG ticket (follow the wayfinder skill rules).') < 0) problems.push('newBugWayfinder en 缺极简句 "Please help me file a new BUG ticket (follow the wayfinder skill rules)."')
    if (zh.indexOf('仓库：{repo}') < 0) problems.push('newBugWayfinder zh 缺“仓库：{repo}”')
    if (en.indexOf('Repo: {repo}') < 0) problems.push('newBugWayfinder en 缺 "Repo: {repo}"')
    // v5 #475：标签要求（bug 必带+未诊断带 needs-triage，分远端原生/本地标签行，中英文一致）
    if (zh.indexOf('必须带上 bug 标签') < 0) problems.push('newBugWayfinder zh 缺标签要求“必须带上 bug 标签”（v5 #475）')
    if (zh.indexOf('needs-triage') < 0) problems.push('newBugWayfinder zh 缺 needs-triage 标签要求（v5 #475）')
    if (zh.indexOf('原生标签') < 0) problems.push('newBugWayfinder zh 缺远端原生标签写法（v5 #475）')
    if (zh.indexOf('本地 Markdown 后端在正文加标签行') < 0) problems.push('newBugWayfinder zh 缺本地标签行写法（v5 #475）')
    if (zh.indexOf('Labels: bug, needs-triage') < 0) problems.push('newBugWayfinder zh 缺标签行示例 Labels: bug, needs-triage（v5 #475）')
    if (en.indexOf('must carry the bug label') < 0) problems.push('newBugWayfinder en 缺 "must carry the bug label"（v5 #475）')
    if (en.indexOf('needs-triage') < 0) problems.push('newBugWayfinder en 缺 needs-triage 标签要求（v5 #475）')
    if (en.indexOf('native labels') < 0) problems.push('newBugWayfinder en 缺 native labels 写法（v5 #475）')
    if (en.indexOf('add a Labels line') < 0) problems.push('newBugWayfinder en 缺 Labels line 写法（v5 #475）')
    if (en.indexOf('Labels: bug, needs-triage') < 0) problems.push('newBugWayfinder en 缺标签行示例 Labels: bug, needs-triage（v5 #475）')
    // v15 #1461：旧的「## 查历史」整节删掉，换成「## 查重」（步骤）与「## 查重记录」（票面写法）两节。
    //   为什么逐句锁：这一扇是提示词注入面的唯一自动防线，模板被改薄、两节顺序放错或参数漏写，会话就少做一步查重，
    //   而两次全扫与查重记录是建单的前置条件（规格 #1460 实现决策 3/4）。下面按「会话实际会读到的话术」分五组锁：
    //   ① 章节结构与顺序；② 两次全扫的参数；③ 命中交报告人确认；④ 四类出口；⑤ 查重记录写法与前置条件。
    // ① 章节结构与顺序：六节（澄清 / 调查 / 查重 / 查重记录 / 自查 / 工具），查重两节夹在调查与自查之间。
    containsAll(problems, zh, [
      ['## 澄清', 'newBugWayfinder zh 缺“## 澄清”（v15 #1461 保留澄清节）'],
      ['## 调查', 'newBugWayfinder zh 缺“## 调查”（v15 #1461 保留调查节）'],
      ['## 查重', 'newBugWayfinder zh 缺“## 查重”一节（v15 #1461：建单前扫全可见 BUG 单）'],
      ['## 查重记录', 'newBugWayfinder zh 缺“## 查重记录”一节（v15 #1461：新单正文固定留痕）'],
      ['## 自查', 'newBugWayfinder zh 缺“## 自查”（v15 #1461 保留自查节）'],
      ['## 工具', 'newBugWayfinder zh 缺“## 工具”（v15 #1461 保留工具节）'],
      ['/research', 'newBugWayfinder zh 缺 /research 深查（调查节原样保留）'],
    ])
    const orderZhOk = zh.indexOf('## 调查') < zh.indexOf('## 查重') && zh.indexOf('## 查重') < zh.indexOf('## 查重记录') && zh.indexOf('## 查重记录') < zh.indexOf('## 自查')
    if (!orderZhOk) problems.push('newBugWayfinder zh 章节顺序应为 调查 → 查重 → 查重记录 → 自查（v15 #1461：查重在调查之后、自查之前）')
    // 旧一节必须彻底退场：留着「查历史」会让会话按旧办法抽关键词搜前 20 条，正好是这次要修掉的漏检来源。
    if (zh.indexOf('## 查历史') >= 0) problems.push('newBugWayfinder zh 仍含已删除的“## 查历史”（v15 #1461 换成查重两节）')
    if (zh.indexOf('前 20 条标题') >= 0) problems.push('newBugWayfinder zh 仍含旧初筛定量“前 20 条标题”（v15 #1461 改为两次全扫一次取全）')
    // ② 两次全扫的参数：状态、标签、上限、一次取全，一个都不许省；并明确不许用关键词搜索代替。
    containsAll(problems, zh, [
      ["state=open、labels=['bug']、limit=200", 'newBugWayfinder zh 缺 open 全扫参数 state=open、labels=[\'bug\']、limit=200（v15 #1461）'],
      ["state=closed、labels=['bug']、limit=200", 'newBugWayfinder zh 缺 closed 全扫参数 state=closed、labels=[\'bug\']、limit=200（v15 #1461）'],
      ['不要用关键词搜索代替', 'newBugWayfinder zh 缺“不要用关键词搜索代替”（v15 #1461：换说法描述的问题关键词会漏）'],
      ['标题像的再调 deck_issue_get 看正文', 'newBugWayfinder zh 缺“标题像的再调 deck_issue_get 看正文”（v15 #1461）'],
      ['清单可能不全', 'newBugWayfinder zh 缺清单可能不全时要记下来的说法（v15 #1461：limit 上限与抽样误差）'],
      // ③ 命中时交报告人确认：最多 3 张候选、问一句、等到回答再决定（不许自己先判同源不同症）。
      ['最多 3 张候选', 'newBugWayfinder zh 缺“最多 3 张候选”（v15 #1461：注意力预算）'],
      ['这些是不是同一个问题', 'newBugWayfinder zh 缺要问报告人的那句“这些是不是同一个问题”（v15 #1461）'],
      ['等到回答再决定', 'newBugWayfinder zh 缺“等到回答再决定”（v15 #1461：不许自己先下结论）'],
    ])
    const takeAllZh = (zh.match(/一次取全/g) || []).length
    if (takeAllZh < 2) problems.push('newBugWayfinder zh 两次扫描都要写明“一次取全”（实际出现 ' + takeAllZh + ' 次；v15 #1461）')
    // ④ 四类出口：旧单还开着不建新单、旧单已关闭按回归、不是或没命中照常建、不确定标 needs-info；工具报错是唯一例外。
    if (zh.indexOf('不建新单') < 0 || zh.indexOf('在旧单下评论') < 0 || zh.indexOf('旧单不关闭') < 0) problems.push('newBugWayfinder zh 缺“旧单还开着→不建新单、在旧单下评论、旧单不关闭”出口（v15 #1461）')
    if (zh.indexOf('按回归处理') < 0 || zh.indexOf('「回归：原单 #编号」') < 0 || zh.indexOf('关联旧单') < 0) problems.push('newBugWayfinder zh 缺“旧单已关闭→按回归建单、写明「回归：原单 #编号」、关联旧单”出口（v15 #1461）')
    if (zh.indexOf('报告人确认不是，或没有命中') < 0) problems.push('newBugWayfinder zh 缺“报告人确认不是，或没有命中”出口（v15 #1461）')
    if (zh.indexOf('看过的候选和报告人的回答') < 0) problems.push('newBugWayfinder zh 缺“正文写明看过的候选和报告人的回答”（v15 #1461）')
    if (zh.indexOf('报告人不确定') < 0 || zh.indexOf('标 needs-info') < 0) problems.push('newBugWayfinder zh 缺“报告人不确定→再给对方看一眼、仍不能判断按新建处理并标 needs-info”出口（v15 #1461）')
    // ⑤ 查重记录：固定四行（扫描 / 命中 / 报告人确认 / 结论），没命中写「无」，不许编造；写完才能建单。
    containsAll(problems, zh, [
      ['没有命中也要写', 'newBugWayfinder zh 缺“没有命中也要写”查重记录（v15 #1461）'],
      ['没有就写「无」', 'newBugWayfinder zh 查重记录缺“没有就写「无」”（v15 #1461：留空会被当成没查）'],
      ['两次扫描与查重记录是建单的前置条件', 'newBugWayfinder zh 缺“两次扫描与查重记录是建单的前置条件”（v15 #1461）'],
      ['工具本身报错时，把错误写进查重记录再建单', 'newBugWayfinder zh 缺工具报错例外（v15 #1461：后端一挂也要能报 BUG，错误写进记录再建单）'],
    ])
    ;['扫描：', '命中：', '报告人确认：', '结论：'].forEach(function (k) { if (zh.indexOf(k) < 0) problems.push('newBugWayfinder zh 查重记录缺第 ' + k + ' 行（v15 #1461 固定四行）') })
    // 英文版与中文一一对应：同样的六节顺序、同样参数与四类出口，英文短语也要锁（注入按当前语言只出一份）。
    containsAll(problems, en, [
      ['## Clarify', 'newBugWayfinder en 缺 "## Clarify"'],
      ['## Investigate', 'newBugWayfinder en 缺 "## Investigate"（调查节原样保留）'],
      ['## Check for duplicates', 'newBugWayfinder en 缺 "## Check for duplicates"（v15 #1461）'],
      ['## Duplicate check record', 'newBugWayfinder en 缺 "## Duplicate check record"（v15 #1461）'],
      ['## Self-check', 'newBugWayfinder en 缺 "## Self-check"'],
      ['## Tools', 'newBugWayfinder en 缺 "## Tools"'],
      ['/research', 'newBugWayfinder en 缺 "/research"'],
    ])
    const orderEnOk = en.indexOf('## Investigate') < en.indexOf('## Check for duplicates') && en.indexOf('## Check for duplicates') < en.indexOf('## Duplicate check record') && en.indexOf('## Duplicate check record') < en.indexOf('## Self-check')
    if (!orderEnOk) problems.push('newBugWayfinder en 章节顺序应为 Investigate → Check for duplicates → Duplicate check record → Self-check（v15 #1461）')
    if (en.indexOf('## Check history') >= 0) problems.push('newBugWayfinder en 仍含已删除的 "## Check history"（v15 #1461）')
    if (en.indexOf('top 20 titles') >= 0) problems.push('newBugWayfinder en 仍含旧初筛定量 "top 20 titles"（v15 #1461 改为两次全扫）')
    containsAll(problems, en, [
      ["state=open, labels=['bug'], limit=200", 'newBugWayfinder en 缺 open 全扫参数 state=open, labels=[\'bug\'], limit=200（v15 #1461）'],
      ["state=closed, labels=['bug'], limit=200", 'newBugWayfinder en 缺 closed 全扫参数 state=closed, labels=[\'bug\'], limit=200（v15 #1461）'],
      ['do not replace them with keyword search', 'newBugWayfinder en 缺 "do not replace them with keyword search"（v15 #1461）'],
      ['deck_issue_get only when a title looks similar', 'newBugWayfinder en 缺 "deck_issue_get only when a title looks similar"（v15 #1461）'],
      ['may be incomplete', 'newBugWayfinder en 缺清单可能不全时记下来的说法（v15 #1461）'],
      ['up to 3 candidates', 'newBugWayfinder en 缺 "up to 3 candidates"（v15 #1461）'],
      ['are these the same problem', 'newBugWayfinder en 缺 "are these the same problem"（v15 #1461）'],
    ])
    const takeAllEn = (en.match(/take them all/g) || []).length
    if (takeAllEn < 2) problems.push('newBugWayfinder en 两次扫描都要写明 "take them all"（实际出现 ' + takeAllEn + ' 次；v15 #1461）')
    if (en.indexOf('do NOT file a new ticket') < 0 || en.indexOf('comment on the old ticket') < 0 || en.indexOf('do not close the old ticket') < 0) problems.push('newBugWayfinder en 缺“旧单还开着→不建新单、在旧单下评论、旧单不关闭”出口（v15 #1461）')
    if (en.indexOf('treat it as a regression') < 0 || en.indexOf('Regression of #key') < 0 || en.indexOf('link the old ticket') < 0) problems.push('newBugWayfinder en 缺“旧单已关闭→按回归建单、写明 Regression of #key、关联旧单”出口（v15 #1461）')
    if (en.indexOf('not the same, or nothing matched') < 0) problems.push('newBugWayfinder en 缺 "not the same, or nothing matched" 出口（v15 #1461）')
    if (en.indexOf("reporter's answer") < 0) problems.push('newBugWayfinder en 缺“正文写明候选与报告人回答”的表达（v15 #1461）')
    if (en.indexOf('The reporter is unsure') < 0 || en.indexOf('label needs-info') < 0) problems.push('newBugWayfinder en 缺“报告人不确定→标 needs-info”出口（v15 #1461）')
    containsAll(problems, en, [
      ['even when nothing matched', 'newBugWayfinder en 缺 "even when nothing matched" 也要写查重记录（v15 #1461）'],
      ['write "none" when nothing matched', 'newBugWayfinder en 查重记录缺 "write \"none\" when nothing matched"（v15 #1461）'],
      ['prerequisites for filing', 'newBugWayfinder en 缺 "prerequisites for filing"（v15 #1461：两次扫描与查重记录是建单前置条件）'],
      ['if the tool itself errors, write the error into the duplicate-check record', 'newBugWayfinder en 缺工具报错例外（v15 #1461）'],
    ])
    ;['Scanned:', 'Hits:', 'Reporter confirmed:', 'Conclusion:'].forEach(function (k) { if (en.indexOf(k) < 0) problems.push('newBugWayfinder en 查重记录缺第 ' + k + ' 行（v15 #1461 固定四行）') })
    if (en.indexOf('default link, never close') >= 0) problems.push('newBugWayfinder en 仍含旧默认动作 "default link, never close"（v15 #1461 改为四类出口）')
    // v4 去内部规则：不应含旧的展开式流程说明
    if (zh.indexOf('先澄清') >= 0) problems.push('newBugWayfinder zh 不应含内部规则“先澄清”（v4 已去）')
    if (zh.indexOf('判断分类') >= 0) problems.push('newBugWayfinder zh 不应含内部规则“判断分类”（v4 已去）')
    if (zh.indexOf('进度：0%') >= 0) problems.push('newBugWayfinder zh 不应含“进度：0%”（v4 已去，wayfinder 技能自带）')
    if (en.indexOf('Clarify first') >= 0) problems.push('newBugWayfinder en 不应含内部规则 "Clarify first"（v4 已去）')
    if (en.indexOf('Decide the case') >= 0) problems.push('newBugWayfinder en 不应含内部规则 "Decide the case"（v4 已去）')
    // v4 去模板末尾自指：不应再出现
    if (zh.indexOf('模板末尾') >= 0) problems.push('newBugWayfinder zh 不应含“模板末尾”自指（v4 已去）')
    if (en.indexOf('end of the prompt template') >= 0) problems.push('newBugWayfinder en 不应含 "end of the prompt template" 自指（v4 已去）')
    // v2 延续：注册表本体不再含字段（已挪到 NEW_BUG_FIELDS_BODY 末尾）—— 用新括号形态检测
    const inRegZh = FIELDS_ZH.filter(function (f) { return zh.indexOf(f) >= 0 })
    if (inRegZh.length) problems.push('newBugWayfinder zh 注册表本体含中途输入位：' + inRegZh.join(' / ') + '（必须挪到末尾）')
    const inRegEn = FIELDS_EN.filter(function (f) { return en.indexOf(f) >= 0 })
    if (inRegEn.length) problems.push('newBugWayfinder en 注册表本体含中途输入位：' + inRegEn.join(' / ') + '（must move to end）')
    // 不应再宣称“7 字段”
    if (zh.indexOf('7 字段清单') >= 0) problems.push('newBugWayfinder zh 提示语仍称「7 字段清单」')
    if (en.indexOf('7-field checklist') >= 0) problems.push('newBugWayfinder en 提示语仍称 "7-field checklist"')
    if (/\bgh\b/i.test(zh) || /gh issue/i.test(en)) problems.push('newBugWayfinder 不应硬编码平台工具 gh')
    // #107：入口表单不得再引导「先建单」——四项全空先追问、不建单
    if (zh.indexOf('先建单') >= 0) problems.push('newBugWayfinder zh 仍含「先建单」引导（#107 已改：空表单先追问、不建单）')
    if (en.indexOf('file first') >= 0) problems.push('newBugWayfinder en 仍含 "file first" 引导（#107 已改：空表单先追问、不建单）')
  }
  // 1.5) 四项引导语：newBugFields 片段的 zh / en 两份正文（zh 4 字段括号单行，头一句说清「是提示、不是必答」；
  //   en 对称）—— v7 #882 起括号单行，v15 #1461 起与查重记录分家，这次又从「必填」改成「提示」。
  // #1292：正文真身搬进了 config/prompts/ticket-creation.yaml 的 newBugFields 片段（zh / en 两份）；
  //   src/client/kernel/prompts.ts 里那个常量现在只是「按语言链从片段取这一段」的取用口，源码里不再有那段字面量。
  //   判据拆成两半，两半都查（比从前多查一样，条数不减）：一半查片段数据在不在、正文齐不齐；
  //   一半查 prompts.ts 那个取用口确实在用这个片段（接线断了，片段再对也没人把它送进会话）。
  const frag = fragments['newBugFields']
  const fieldsBody = frag && typeof frag.zh === 'string' ? frag.zh : ''
  const fieldsBodyEn = frag && typeof frag.en === 'string' ? frag.en : ''
  if (!frag) {
    problems.push('缺 newBugFields 片段（config/prompts/ticket-creation.yaml 里没有这一段）')
  } else {
    if (!fieldsBody) problems.push('newBugFields 片段缺中文正文')
    if (!fieldsBodyEn) problems.push('newBugFields 片段缺英文正文')
    // #1294：newBugWayfinderText 现在是「promptText(...) + NEW_BUG_FIELDS_BODY()」直拼，那一个空白行
    //   由片段正文开头的两个换行提供（从前是拼接处写死的 '\n\n'）。这条判据守住那个空白行不丢。
    if (!fieldsBody.startsWith('\n\n')) problems.push('newBugFields 片段中文正文缺开头两个换行（拼在 newBugWayfinder 后面要隔一个空白行）')
    if (!fieldsBodyEn.startsWith('\n\n')) problems.push('newBugFields 片段英文正文缺开头两个换行（拼在 newBugWayfinder 后面要隔一个空白行）')
  }
  if (fieldsBody) {
    // 顺序与完整性（v4 顺序实际→期望→复现→环境）
    const orderOk = fieldsBody.indexOf(FIELDS_ZH[0]) < fieldsBody.indexOf(FIELDS_ZH[1]) && fieldsBody.indexOf(FIELDS_ZH[1]) < fieldsBody.indexOf(FIELDS_ZH[2]) && fieldsBody.indexOf(FIELDS_ZH[2]) < fieldsBody.indexOf(FIELDS_ZH[3])
    if (!orderOk) problems.push('NEW_BUG_FIELDS_BODY 顺序非实际→期望→复现→环境')
    const missingZh = FIELDS_ZH.filter(function (f) { return fieldsBody.indexOf(f) < 0 })
    if (missingZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺中文字段：' + missingZh.join(' / '))
    // 不再允许 v2 旧字段残留 + 旧形态“期望：\n  例：”；另禁 DSH 专用环境写法回潮（浏览器 + 插件版本）
    const LEGACY_ZH = ['背景：', '场景：', '现象：', '期望行为：', '实际行为：', '影响范围：']
    const legacyIn = LEGACY_ZH.filter(function (f) { return fieldsBody.indexOf(f) >= 0 })
    if (legacyIn.length) problems.push('NEW_BUG_FIELDS_BODY 残留 v2 旧字段：' + legacyIn.join(' / '))
    // v15 #1461：查重记录不是报告人填的字段，不许混进四项片段——片段只放「实际 / 期望 / 复现 / 环境」，
    //   留痕由会话按「## 查重记录」写进正文；混进来会变成让报告人填「扫描了哪些状态」。
    if (fieldsBody.indexOf('查重记录') >= 0) problems.push('newBugFields 片段不应含「查重记录」（v15 #1461：留痕由会话写正文，不是报告人填的四项字段）')
    // #1292：从前那行正文是源码里的转义字符串字面量（\n 是反斜杠加 n 两个字符），YAML 块标量解码后是真换行，
    //   所以这条「旧形态悬行」判据改成按真换行找（源码里写出来就是换行符加两个空格加“例：”）。
    if (fieldsBody.indexOf('\n  例：') >= 0) problems.push('NEW_BUG_FIELDS_BODY 仍含旧形态悬行（换行 + 两空格 + “例：”，v4 已改为括号单行）')
    const missingInline = DESC_ZH.filter(function (k) { return fieldsBody.indexOf(k) < 0 })
    if (missingInline.length) problems.push('NEW_BUG_FIELDS_BODY 缺 zh 说明关键字：' + missingInline.join(' / '))
    // v4 分离守护：zh 不应混入英文短语（防止中英混排回潮）
    if (fieldsBody.indexOf('What should happen') >= 0 || fieldsBody.indexOf('What actually happened') >= 0) problems.push('NEW_BUG_FIELDS_BODY 混入英文 inline（v4 zh 只中文说明）')
    // v7 形态守护：括号单行，末尾以环境行收尾（这次环境行也改成「知道的话写上 …」的提示语气）
    if (!fieldsBody.endsWith(FIELDS_ZH[3])) problems.push('NEW_BUG_FIELDS_BODY 末尾非通用环境收尾（v7 #882）')
    // 头一句要读作提示而不是强制；答不全照常建单（缺的标 needs-info），不许再要求报告人「补齐」。
    if (fieldsBody.indexOf(HINT_HEAD_ZH) < 0) problems.push('NEW_BUG_FIELDS_BODY 缺「四项是提示、不是必答」的头一句')
    if (fieldsBody.indexOf(HINT_RULE_ZH) < 0) problems.push('NEW_BUG_FIELDS_BODY 缺「答不全照常建单、缺项标 needs-info」的说明')
    if (fieldsBody.indexOf('均为必填') >= 0) problems.push('NEW_BUG_FIELDS_BODY 又写成「均为必填」（四项是提示，写了会把报告人逼成逐项填表）')
    if (fieldsBody.indexOf('先回问报告人补齐') >= 0) problems.push('NEW_BUG_FIELDS_BODY 仍要求报告人「补齐」四项（现在改成答多少算多少）')
    if (fieldsBody.indexOf('以下选填。') >= 0) problems.push('NEW_BUG_FIELDS_BODY 仍含旧选填头“以下选填。”（现在的文案是提示语气，这条只禁旧的选填头）')
    if (fieldsBody.indexOf('浏览器 + 插件版本') >= 0) problems.push('NEW_BUG_FIELDS_BODY 残留 DSH 专用环境写法（v7 已通用化）')
    // 括号单行完整性
    const missingBrZh = BRACKET_LINE_ZH.filter(function (g) { return fieldsBody.indexOf(g) < 0 })
    if (missingBrZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺括号单行：' + missingBrZh.join(' / '))
  }
  if (fieldsBodyEn) {
    const orderOkEn = fieldsBodyEn.indexOf(FIELDS_EN[0]) < fieldsBodyEn.indexOf(FIELDS_EN[1]) && fieldsBodyEn.indexOf(FIELDS_EN[1]) < fieldsBodyEn.indexOf(FIELDS_EN[2]) && fieldsBodyEn.indexOf(FIELDS_EN[2]) < fieldsBodyEn.indexOf(FIELDS_EN[3])
    if (!orderOkEn) problems.push('NEW_BUG_FIELDS_BODY_EN 顺序非 Actual→Expected→Reproduction→Environment')
    const missingEn = FIELDS_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) < 0 })
    if (missingEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺英文字段：' + missingEn.join(' / '))
    const missingInlineEn = DESC_EN.filter(function (k) { return fieldsBodyEn.indexOf(k) < 0 })
    if (missingInlineEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺 en 说明关键字：' + missingInlineEn.join(' / '))
    // v4 分离守护：en 不应混入中文（跟随 DSH 语言一次只出一种）
    if (fieldsBodyEn.indexOf('应发生什么') >= 0 || fieldsBodyEn.indexOf('实际看到了什么') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 混入中文说明（v4 en 只英文说明）')
    // en 侧旧字段残留守护
    const LEGACY_EN = ['Background:', 'Scenario:', 'Phenomenon:', 'Expected Behavior:', 'Actual Behavior:', 'Impact:']
    const legacyEnIn = LEGACY_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) >= 0 })
    if (legacyEnIn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 残留 v2 旧字段：' + legacyEnIn.join(' / '))
    // v15 #1461：同 zh 一侧，英文片段也不许混入查重记录。
    if (fieldsBodyEn.indexOf('Duplicate check record') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 不应含 "Duplicate check record"（v15 #1461）')
    // #1292：同 zh 那一侧，YAML 解码后是真换行，所以这条「旧形态悬行」判据按真换行找。
    if (fieldsBodyEn.indexOf('\n  e.g.') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 仍含旧形态悬行（换行 + 两空格 + “e.g.”，v4 已改为括号单行）')
    const missingBrEn = BRACKET_LINE_EN.filter(function (g) { return fieldsBodyEn.indexOf(g) < 0 })
    if (missingBrEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺括号单行：' + missingBrEn.join(' / '))
    if (!fieldsBodyEn.endsWith(FIELDS_EN[3])) problems.push('NEW_BUG_FIELDS_BODY_EN 末尾非通用环境收尾（v7 #882）')
    // 与中文一侧对称，头一句要读作提示而不是强制；答不全照常建单，缺的标 needs-info。
    if (fieldsBodyEn.indexOf(HINT_HEAD_EN) < 0) problems.push('NEW_BUG_FIELDS_BODY_EN 缺「四项是提示、不是必答」的头一句')
    if (fieldsBodyEn.indexOf(HINT_RULE_EN) < 0) problems.push('NEW_BUG_FIELDS_BODY_EN 缺「答不全照常建单、缺项标 needs-info」的说明')
    if (fieldsBodyEn.indexOf('four fields below are required') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 又写成 "four fields below are required"（四项是提示，不是必答）')
    if (fieldsBodyEn.indexOf('Optional below.') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 仍含旧选填头 "Optional below."（现在的文案是提示语气，这条只禁旧的选填头）')
    if (fieldsBodyEn.indexOf('browser + plugin version') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 残留 DSH 专用环境写法（v7 已通用化）')
  }
  // 取用口：prompts.ts 里的 NEW_BUG_FIELDS_BODY 必须从片段取正文（不是自己又抄一份）。
  //   #1294 起中英两份正文由语言链在片段里挑（pickLangText），源码里不再有 NEW_BUG_FIELDS_BODY_EN，
  //   所以取用口只剩一个；那条「EN 取用口」判据改成正向断言：EN 那份不许再写回源码。
  const promptsSrc = sourceText('src/client/kernel/prompts.ts')
  if (!/NEW_BUG_FIELDS_BODY\s*=\s*function[^{]*\{\s*return\s+promptFragment\(\s*['"]newBugFields['"]\s*\)/.test(promptsSrc)) {
    problems.push('prompts.ts 里 NEW_BUG_FIELDS_BODY 没从 newBugFields 片段取正文（取用口缺失）')
  }
  if (/NEW_BUG_FIELDS_BODY_EN/.test(promptsSrc)) {
    problems.push('prompts.ts 里又出现 NEW_BUG_FIELDS_BODY_EN（#1294 已按语言链归并，中英正文由片段按当前语言挑）')
  }
  // 2) i18n 键（#1294：真源搬到 config/copy/panel.yaml；按语言逐门查，比原来只在源码里找单引号键更严）
  let copyCfg = null
  try {
    copyCfg = readCopyConfig(ROOT)
  } catch (e) {
    problems.push('读 config/copy/ 下的 YAML 失败：' + (e && e.message ? e.message : String(e)))
  }
  const panelFamily = copyCfg ? copyCfg.families.filter(function (f) { return f.family === 'panel' })[0] : null
  const uiLangs = copyCfg ? Object.keys(copyCfg.languages.languages) : []
  if (!panelFamily) problems.push('缺 panel 词族（config/copy/panel.yaml 里没有）')
  ;['nav.bugNew', 'nav.bugNewTitle', 'panel.newBug', 'panel.newBugTitle'].forEach(function (k) {
    for (const lang of uiLangs) {
      const dict = panelFamily && panelFamily.texts[lang]
      if (!dict || typeof dict[k] !== 'string' || !dict[k]) problems.push('缺 i18n 词条 ' + k + '（语言 ' + lang + '）')
    }
    // 源码侧仍不许把这四条字面量写回去（真源只有 YAML 一处）。
    if (new RegExp('["\\\']' + k.replace(/\./g, '\\.') + '["\\\']\\s*:').test(src)) problems.push('源码里又出现 i18n 键 ' + k + '（真源只在 config/copy/panel.yaml）')
  })
  // 3) StatusBar 悬停菜单接线
  if (!src.includes('s.bugMenuOpen')) problems.push('缺 s.bugMenuOpen 状态')
  if (!/tr\(["']nav\.bugNew["']\)/.test(src)) problems.push('状态栏菜单缺 nav.bugNew 引用')
  // 4) 面板按钮接线：newBugWayfinder 开新会话 ≥ 2 处（状态栏 1 + 共享 Tabs 行 1；#97 T4 去重后 Dock/Overlay tabs 行合成一处）
  const opens = (src.match(/openTextInNewSession\(s, newBugWayfinderText\(s\)/g) || []).length
  if (opens < 2) problems.push('newBugWayfinder 开新会话接线 < 2（实际 ' + opens + '）')
  // #211 占位：会话标题改用 newSessionTitleNew('bug')（双语 [New] 占位），按钮文字仍用 panel.newBug（≥1），标题不再强求 tr('panel.newBug')
  if ((src.match(/tr\(["']panel\.newBug["']\)/g) || []).length < 1) problems.push('panel.newBug 引用 < 1（按钮文字）')
  if (!src.includes('newSessionTitleNew')) problems.push('缺 newSessionTitleNew 占位构造（#211）')
  // 5) Ic bug 图标（引号无关）
  if (!/case\s+["']bug["']\s*:/.test(src)) problems.push('缺 Ic bug 图标')
  // 6) 死区回归守护：BUG 悬停菜单弹层 marginBottom 必须为 0/未设置
  // 2026-10-17：弹层早就从 `h('div', {...})` 改成 PortalOverlay({ className: 'dsws-bugmenu', ... })，老锚点匹配
  // 不上，于是第 6 与第 9 两条判据一直在静默跳过。锚点跟着今天的写法走。
  const bugMenuMatch = src.match(/s\.bugMenuOpen \? PortalOverlay\(\{[\s\S]*?\}, \[/)
  if (bugMenuMatch) {
    const styleStr = bugMenuMatch[0]
    const marginBottomMatches = styleStr.match(/marginBottom:\s*(\d+)/g)
    if (marginBottomMatches) {
      const values = marginBottomMatches.map(function (m) { return Number(m.match(/(\d+)/)[1]) })
      const maxVal = Math.max.apply(null, values)
      if (maxVal > 0) problems.push('BUG 悬停菜单弹层 marginBottom=' + values.join(',') + '（死区回归）')
    }
  } else {
    problems.push('找不到 BUG 悬停菜单弹层（锚点失效：s.bugMenuOpen ? PortalOverlay({ className: \'dsws-bugmenu\' …）')
  }
  // 7) 文本拼接：#1294 起 newBugWayfinderText = promptText('newBugWayfinder', {...}) + NEW_BUG_FIELDS_BODY()，
  //   语言不再靠 promptLang() 三元切换（那 9 处硬写已清零），正文由语言链在 newBugFields 片段里挑；
  //   「提示词正文 + 四项引导语」两段必须拼在一起，且 newBugFields 自带开头两个换行（隔一个空白行）的契约不变。
  // 2026-10-19（#1301 批C）：取源换成 .ts 真源后函数签名带类型标注，锚点容忍类型标注，判据本身没变。
  const builderMatch = /newBugWayfinderText\s*=\s*\(st(?::[^)]*)?\)\s*(?::\s*[^=]+)?=>\s*promptText\(\s*['"]newBugWayfinder['"]\s*,\s*\{[^}]*\}\s*\)\s*\+\s*NEW_BUG_FIELDS_BODY\(\)/.test(src)
  if (!builderMatch) problems.push('newBugWayfinderText 拼接未含 promptText(\'newBugWayfinder\', …) + NEW_BUG_FIELDS_BODY()')
  if (/NEW_BUG_FIELDS_BODY_EN|promptLang\(\)\s*===\s*['"]en['"]/.test(src)) {
    problems.push('newBugWayfinderText 仍按 promptLang() 三选双份正文（#1294 已改由语言链在片段里挑）')
  }
  // 9) 宽度自适应（v3 UX）：不应有 minWidth
  if (bugMenuMatch && /minWidth\s*:\s*\d+/.test(bugMenuMatch[0])) problems.push('BUG 悬停菜单弹层含 minWidth（应按内容自适应）')
  // 10) hover 反馈
  if (!/\bbugMenuHover:\s*false\b/.test(src)) problems.push('store 缺 bugMenuHover 默认状态（false）')
  const hoverChecks = [
    { re: /s\.bugMenuHover\s*=\s*true[\s\S]*?emit\(s\)/, name: '按钮 onMouseEnter 置 bugMenuHover=true' },
    { re: /s\.bugMenuHover\s*=\s*false[\s\S]*?emit\(s\)/, name: '按钮/菜单 mouseleave 重置 bugMenuHover=false' },
    { re: /s\.bugMenuHover\s*\?\s*['"]#f87171['"]/, name: '按钮 hover 红染色（#f87171）' },
  ]
  hoverChecks.forEach(function (c) { if (!c.re.test(src)) problems.push('hover 反馈缺：' + c.name) })
  if (problems.length) { console.log('  FAIL', label, problems.join('；')); failed = true }
  else console.log('  PASS', label, '（newBugWayfinder v' + (entry ? entry.version : '?') + ' · 实际→期望括号单行 · v5 标签要求 · v15 建单前查重 · locale 切换 · 开新会话接线 ' + opens + ' 处 · i18n 4 键）')
}
console.log('P1: 新增BUG入口契约（issue #4/#63 v4 · 实际→期望括号单行 + locale 切换 · v5 #475 标签要求）')
targets.forEach(check)
// P2 已移除（T5 #98 阶段 3 收尾：产物 = f(src) 一源两物，src 为真源，产物由构建生成；
// 双源文本镜像断言已由运行时冒烟 + src↔产物逐字断言取代）
// 保留 P1 对单产物（含默认两产物各自）的行为特征校验；不再校验 client.js ↔ package/lib/client.js 双源一致性
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
