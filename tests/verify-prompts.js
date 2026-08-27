// verify-prompts.js — dsh-waystation v1.5 方案 A：prompt 注册表契约校验（T13 扩展 · #461）
// 用法: node tests/verify-prompts.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) 注册表条目结构（version/placeholders/use/zh/en 齐全）
//   2) 文本内 {x} 占位符 与 placeholders 声明一致（未知占位符 = 违规）
//   3) 代码中 promptText('id') 引用全部存在
//   4) 双源注册表键集合一致
//   5) T13 阶段闸门契约：stageGate 条目 + 版本号 bump（tpl.diagnose/execute/mapExecute）
//      + 诊断/修复/执行（renderTemplate 末尾追加）与 map 推进接线
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const unescapeStr = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { out += s[i + 1] === 'n' ? '\n' : s[i + 1]; i++ }
    else out += c
  }
  return out
}
const parseRegistry = function (src) {
  const reg = {}
  const entryRe = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \},?$/gm
  let m
  while ((m = entryRe.exec(src)) !== null) {
    const ph = m[3] ? m[3].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean) : []
    reg[m[1]] = { version: Number(m[2]), placeholders: ph, use: m[4], zh: unescapeStr(m[5]), en: unescapeStr(m[6]) }
  }
  return reg
}
const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const reg = parseRegistry(src)
  const problems = []
  if (Object.keys(reg).length < 15) problems.push('注册表条目数异常 ' + Object.keys(reg).length + '（期望 15）')
  Object.keys(reg).forEach(function (id) {
    const p = reg[id]
    if (!(p.version >= 1)) problems.push(id + ' 缺 version')
    if (!p.zh || !p.en) problems.push(id + ' 缺 zh/en')
    if (!p.use) problems.push(id + ' 缺 use')
    const found = []
    const re = /\{(\w+)\}/g
    let mm
    while ((mm = re.exec(p.zh)) !== null) if (found.indexOf(mm[1]) < 0) found.push(mm[1])
    found.forEach(function (x) { if (p.placeholders.indexOf(x) < 0) problems.push(id + ' 文本含未声明占位符 {' + x + '}') })
    p.placeholders.forEach(function (x) { if (found.indexOf(x) < 0) problems.push(id + ' 声明占位符 {' + x + '} 但文本未使用') })
  })
  const useRe = /promptText\('([a-zA-Z0-9.]+)'/g
  let mu
  while ((mu = useRe.exec(src)) !== null) { if (!reg[mu[1]]) problems.push('引用不存在的 prompt id: ' + mu[1]) }
  // 旧形式残留
  ;["tr('prompt.", "'prompt.\'" ].forEach(function (bad) { if (src.includes(bad)) problems.push('旧字典引用残留 ' + bad) })
  // #77（G16）：版本号 bump —— 契约变更的条目必须升版（防回退）；五片段删除后注册表 15 条
  const V_MIN = { 'tpl.diagnose': 5, 'tpl.execute': 5, 'mapExecute': 5, 'complete': 5, 'newWayfinder': 10, 'setupRun': 9, 'fixate': 2, 'progress': 3, 'bodyFormat': 3 }
  Object.keys(V_MIN).forEach(function (id) {
    const p = reg[id]
    if (!p) problems.push('契约缺条目 ' + id)
    else if (p.version < V_MIN[id]) problems.push('版本号未 bump ' + id + ' v' + p.version + '（期望 ≥ v' + V_MIN[id] + '）')
  })
  // #77（G16）定版：五片段入口全部删除 —— 不得复活（guide/grill/newMap/mapHead/stageGate）
  ;['guide', 'grill', 'newMap', 'mapHead', 'stageGate'].forEach(function (id) {
    if (reg[id]) problems.push('#77 已删条目复活 ' + id)
  })
  // #77（G16）：stageGate 兜底删除 —— STAGE_GATED_IDS / promptText('stageGate') / 去重守卫 不得残留
  if (/STAGE_GATED_IDS\s*=/.test(src)) problems.push('#77 残留 STAGE_GATED_IDS 声明（应随 stageGate 入口一并删除）')
  if (src.includes("promptText('stageGate')")) problems.push("#77 残留 promptText('stageGate') 调用")
  if (src.includes('STAGE_GATED_IDS.indexOf(id) >= 0')) problems.push('#77 残留 renderTemplate 闸门追加逻辑')
  if (src.includes("text.indexOf('阶段闸门')") || src.includes("text.indexOf('Stage gate')")) problems.push('#77 残留 renderTemplate 去重守卫（闸门已内联，无外挂可去重）')
  // T13：map 推进（mapExecute 新会话）同样挂闸门 —— v5（#68）：闸门一句引用内嵌于模板，外挂 gateText 已删；
  //   校验 mapExecute 文本含「阶段闸门」引用 + router 单行前缀（/wayfinder + 空格 + url）
  const me = reg['mapExecute']
  if (me) {
    if (me.zh.indexOf('阶段闸门') < 0 || me.en.indexOf('stage-gate') < 0) problems.push('T13 mapExecute 未含阶段闸门引用（needs-triage 先诊断）')
    if (me.zh.indexOf('needs-triage') < 0) problems.push('mapExecute zh 缺 needs-triage 标记')
  }
  if (src.indexOf("'/wayfinder '") < 0) problems.push('T13 map 推进缺单行前缀（/wayfinder + 空格 + url）')
  // #68 mapExecute 清单式（A★ · 全勾选框 · 无表格 · map 标识头自包含）：mapExecute 必须为清单骨架
  if (me) {
    if (me.zh.indexOf('- [ ]') < 0) problems.push('mapExecute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (me.zh.indexOf('## 目标 map') < 0 || me.zh.indexOf('## 分析') < 0 || me.zh.indexOf('## 选票') < 0 || me.zh.indexOf('## 执行') < 0 || me.zh.indexOf('## 收尾') < 0 || me.zh.indexOf('## 正文格式') < 0) problems.push('mapExecute zh 缺清单段标题（目标 map/分析/选票/执行/收尾/正文格式）')
    if (me.zh.indexOf('|') >= 0) problems.push('mapExecute zh 含表格 |（已约定无表格，全勾选框）')
    if (me.zh.indexOf('编号：') < 0 || me.zh.indexOf('标题：') < 0 || me.zh.indexOf('链接：') < 0) problems.push('mapExecute zh 缺 map 标识头三字段（编号/标题/链接）')
    if (me.placeholders.indexOf('n') < 0 || me.placeholders.indexOf('title') < 0 || me.placeholders.indexOf('url') < 0) problems.push('mapExecute 占位符缺 n/title/url（自包含 map 标识）')
    if (me.en.indexOf('- [ ]') < 0) problems.push('mapExecute en 缺清单标记 - [ ]')
    if (me.en.indexOf('## Target map') < 0 || me.en.indexOf('## Analyze') < 0 || me.en.indexOf('## Pick the ticket') < 0 || me.en.indexOf('## Execute') < 0 || me.en.indexOf('## Wrap-up') < 0) problems.push('mapExecute en 缺清单段标题（Target map/Analyze/Pick the ticket/Execute/Wrap-up）')
  }
  // #64 执行清单式（A★ · 全勾选框 · 无表格）：tpl.execute 必须为清单骨架
  const ex = reg['tpl.execute']
  if (ex) {
    if (ex.zh.indexOf('- [ ]') < 0) problems.push('tpl.execute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (ex.zh.indexOf('## 读现状') < 0 || ex.zh.indexOf('## 阶段闸门') < 0 || ex.zh.indexOf('## 收尾') < 0 || ex.zh.indexOf('## 正文格式') < 0) problems.push('tpl.execute zh 缺清单四段标题（读现状/阶段闸门/收尾/正文格式）')
    if (ex.zh.indexOf('|') >= 0) problems.push('tpl.execute zh 含表格 |（已约定无表格，全勾选框）')
    if (ex.en.indexOf('- [ ]') < 0) problems.push('tpl.execute en 缺清单标记 - [ ]')
  }
  // #65 诊断清单式（A★ · 全勾选框 · 无表格 · 诊断≠修复）：tpl.diagnose 必须为清单骨架
  const di = reg['tpl.diagnose']
  if (di) {
    if (di.zh.indexOf('- [ ]') < 0) problems.push('tpl.diagnose zh 缺清单标记 - [ ]（A★ 清单式）')
    if (di.zh.indexOf('## 弄清现象') < 0 || di.zh.indexOf('## 根因候选') < 0 || di.zh.indexOf('## 分流建议') < 0 || di.zh.indexOf('## 阶段闸门') < 0 || di.zh.indexOf('## 正文格式') < 0) problems.push('tpl.diagnose zh 缺清单段标题（弄清现象/根因候选/分流建议/阶段闸门/正文格式）')
    if (di.zh.indexOf('|') >= 0) problems.push('tpl.diagnose zh 含表格 |（已约定无表格，全勾选框）')
    if (di.zh.indexOf('诊断≠修复') < 0) problems.push('tpl.diagnose zh 缺诊断≠修复显式（第一性原理）')
    if (di.zh.indexOf('grilling') < 0) problems.push('tpl.diagnose zh 缺 grill 澄清句')
    if (di.zh.indexOf('与 grill 片段同义') >= 0) problems.push('tpl.diagnose zh 残留悬空括注「与 grill 片段同义」（#77 grill 入口已删）')
    if (di.en.indexOf('- [ ]') < 0) problems.push('tpl.diagnose en 缺清单标记 - [ ]')
    if (di.en.indexOf('diagnosis') < 0 || di.en.indexOf('Stage gate') < 0) problems.push('tpl.diagnose en 缺关键段（diagnosis/Stage gate）')
    if (di.en.indexOf('What are the symptoms') < 0 || di.en.indexOf('What is the impact') < 0) problems.push('tpl.diagnose en 缺 Symptoms 三行拆分（What are the symptoms / What is the impact）')
    if (di.en.indexOf('grill snippet') >= 0) problems.push('tpl.diagnose en 残留 grill snippet 引用（#77 grill 入口已删）')
  }
  // #77（G16）：newWayfinder v8 —— 建图规划契约名称引用已删（改直述「新建 map」）
  const nw = reg['newWayfinder']
  if (nw) {
    if (nw.zh.indexOf('按建图规划契约') >= 0) problems.push('newWayfinder zh 残留「按建图规划契约」名称引用（#77 契约已删，改直述新建 map）')
    if (nw.en.indexOf('per the planning contract') >= 0) problems.push('newWayfinder en 残留 planning contract 名称引用（#77 契约已删，改直述新建 map）')
    // newWayfinder v10（清单式 A★ · 全勾选框 · 无表格 · 新增分支展开子清单 + 自查清单）：澄清/判断分类/自查
    if (nw.zh.indexOf('- [ ]') < 0) problems.push('newWayfinder zh 缺清单标记 - [ ]（A★ 清单式）')
    if (nw.zh.indexOf('## 澄清') < 0 || nw.zh.indexOf('## 判断分类') < 0 || nw.zh.indexOf('## 自查') < 0) problems.push('newWayfinder zh 缺清单段标题（澄清/判断分类/自查）')
    if (nw.zh.indexOf('|') >= 0) problems.push('newWayfinder zh 含表格 |（已约定无表格，全勾选框）')
    if (nw.zh.indexOf('写出 map：Destination + Notes + plan') < 0) problems.push('newWayfinder zh 缺新增子清单（写出 map：Destination + Notes + plan）')
    if (nw.zh.indexOf('以 sub-issue 关联到') < 0) problems.push('newWayfinder zh 缺新增子清单（sub-issue 关联）')
    if (nw.zh.indexOf('Blocked by: #<n>') < 0) problems.push('newWayfinder zh 缺新增子清单（Blocked by: #<n>）')
    if (nw.zh.indexOf('逐项核对上面') < 0) problems.push('newWayfinder zh 缺自查指令（逐项核对清单）')
    if (nw.en.indexOf('- [ ]') < 0) problems.push('newWayfinder en 缺清单标记 - [ ]')
    if (nw.en.indexOf('## Clarify') < 0 || nw.en.indexOf('## Decide the case') < 0 || nw.en.indexOf('## Self-check') < 0) problems.push('newWayfinder en 缺清单段标题（Clarify/Decide the case/Self-check）')
    if (nw.en.indexOf('## Self-check') >= 0 && nw.en.indexOf('verify the checklist') < 0) problems.push('newWayfinder en 缺自查指令（verify the checklist）')
  }
  // #69 完成调查清单式（A★ · 全勾选框 · 无表格 · 调查器 · 人来定夺）：complete 必须为清单骨架 + 专业术语英文
  const co = reg['complete']
  if (co) {
    if (co.version < 5) problems.push('complete 版本号未 bump（期望 ≥ v5）')
    if (co.zh.indexOf('- [ ]') < 0) problems.push('complete zh 缺清单标记 - [ ]（A★ 清单式）')
    if (co.zh.indexOf('## MAP完成确认') < 0 || co.zh.indexOf('## 调查') < 0 || co.zh.indexOf('## 报告你来定夺') < 0 || co.zh.indexOf('## 收尾') < 0 || co.zh.indexOf('## 正文格式') < 0) problems.push('complete zh 缺清单段标题（MAP完成确认/调查/报告你来定夺/收尾/正文格式）')
    if (co.zh.indexOf('|') >= 0) problems.push('complete zh 含表格 |（已约定无表格，全勾选框）')
    if (co.zh.indexOf('子票') >= 0 || co.zh.indexOf('票') >= 0) problems.push('complete zh 专业术语未用英文（子票/票 → sub-issue/ticket）')
    if (co.zh.indexOf('## 目标 map') < 0 || co.zh.indexOf('编号：') < 0 || co.zh.indexOf('标题：') < 0 || co.zh.indexOf('链接：') < 0) problems.push('complete zh 缺 map 标识头三字段（编号/标题/链接 · #77 mapHead 自包含化）')
    if (co.placeholders.indexOf('closed') < 0 || co.placeholders.indexOf('total') < 0) problems.push('complete 占位符缺 closed/total')
    if (co.placeholders.indexOf('n') < 0 || co.placeholders.indexOf('title') < 0 || co.placeholders.indexOf('url') < 0) problems.push('complete 占位符缺 n/title/url（#77 自包含 map 标识）')
    if (co.zh.indexOf('从第一性原理出发完成任务') >= 0) problems.push('complete zh 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('Approach tasks from first principles') >= 0) problems.push('complete en 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('- [ ]') < 0) problems.push('complete en 缺清单标记 - [ ]')
    if (co.en.indexOf('## MAP completion check') < 0 || co.en.indexOf('## Investigate') < 0 || co.en.indexOf('## Report to you') < 0 || co.en.indexOf('## Wrap-up') < 0) problems.push('complete en 缺清单段标题（MAP completion check/Investigate/Report to you/Wrap-up）')
  } else {
    problems.push('缺条目 complete')
  }
  // #71 交接第一击短标题文件名 + 第二击绝对路径（A★ · 全勾选框 · 无表格 · 单模板 · 去 /read 命令化）：handoff1 v3 短标题；handoff2 v3 用 {path}；handoffRead 已塌缩删除
  const h1 = reg['tpl.handoff1']
  if (h1) {
    if (h1.version < 3) problems.push('tpl.handoff1 版本号未 bump（期望 ≥ v3）')
    if (h1.zh.indexOf('短标题') < 0) problems.push('tpl.handoff1 zh 缺短标题指令（{ts}-<短标题>.md）')
    if (h1.en.indexOf('<short>') < 0) problems.push('tpl.handoff1 en 缺短标题指令（{ts}-<short>.md）')
  } else {
    problems.push('缺条目 tpl.handoff1')
  }
  const h2 = reg['tpl.handoff2']
  if (h2) {
    if (h2.version < 3) problems.push('tpl.handoff2 版本号未 bump（期望 ≥ v3）')
    if (h2.zh.indexOf('- [ ]') < 0) problems.push('tpl.handoff2 zh 缺清单标记 - [ ]（A★ 清单式）')
    if (h2.zh.indexOf('## 复述理解') < 0 || h2.zh.indexOf('## 继续推进') < 0) problems.push('tpl.handoff2 zh 缺清单段标题（复述理解/继续推进）')
    if (h2.zh.indexOf('|') >= 0) problems.push('tpl.handoff2 zh 含表格 |（已约定无表格，全勾选框）')
    if (h2.zh.indexOf('/read') >= 0) problems.push('tpl.handoff2 zh 仍含 /read 命令（DSH 无此命令，需通用语句）')
    if (h2.zh.indexOf('{path}') < 0) problems.push('tpl.handoff2 zh 未用 {path} 绝对路径占位符')
    if (h2.en.indexOf('- [ ]') < 0) problems.push('tpl.handoff2 en 缺清单标记 - [ ]')
    if (h2.en.indexOf('{path}') < 0) problems.push('tpl.handoff2 en 未用 {path} 绝对路径占位符')
  } else {
    problems.push('缺条目 tpl.handoff2')
  }
  if (reg['handoffRead']) problems.push('handoffRead 未塌缩删除（应只剩 tpl.handoff2 单模板）')
  // #72 沉淀 v2（A★ · 思维对齐 · 成果沉淀 · 防"问100记70"）：fixate 清单式 + 新命名 + 落盘分支契约
  const fx = reg['fixate']
  if (fx) {
    if (fx.version < 2) problems.push('fixate 版本号未 bump（期望 ≥ v2）')
    if (fx.zh.indexOf('- [ ]') < 0) problems.push('fixate zh 缺清单标记 - [ ]（A★ 清单式）')
    if (fx.zh.indexOf('## 沉淀') < 0 || fx.zh.indexOf('## 可疑遗漏') < 0 || fx.zh.indexOf('## 核对') < 0 || fx.zh.indexOf('## 落盘') < 0 || fx.zh.indexOf('## 正文格式') < 0) problems.push('fixate zh 缺清单段标题（沉淀/可疑遗漏/核对/落盘/正文格式）')
    if (fx.zh.indexOf('|') >= 0) problems.push('fixate zh 含表格 |（已约定无表格，全勾选框）')
    if (fx.zh.indexOf('思维对齐 · 成果沉淀') < 0) problems.push('fixate zh 缺新命名（思维对齐 · 成果沉淀，旧名「零丢失快照」已退役）')
    if (fx.zh.indexOf('零丢失') >= 0) problems.push('fixate zh 残留旧命名「零丢失」')
    if (fx.zh.indexOf('对齐成果') < 0 || fx.zh.indexOf('.scratch/alignment/') < 0) problems.push('fixate zh 缺落盘分支契约（对齐成果 / .scratch/alignment/）')
    if (fx.zh.indexOf('ticket') < 0 || fx.zh.indexOf('map') < 0) problems.push('fixate zh 缺术语（ticket/map，专业术语英文）')
    if (fx.en.indexOf('- [ ]') < 0) problems.push('fixate en 缺清单标记 - [ ]')
    if (fx.en.indexOf('## Consolidate') < 0 || fx.en.indexOf('## Suspected omissions') < 0 || fx.en.indexOf('## Review') < 0 || fx.en.indexOf('## Persist') < 0) problems.push('fixate en 缺清单段标题（Consolidate/Suspected omissions/Review/Persist）')
    if (fx.en.indexOf('alignment & consolidation') < 0) problems.push('fixate en 缺新命名（alignment & consolidation）')
  } else {
    problems.push('缺条目 fixate')
  }
  // #74 技能安装引导 v2（双轨安装 + 幂等守卫 + 10 哨兵清单）：installSkills 必须 ≥ v2，
  //   zh/en 必含安装目录 ~/.agents/skills 与全部 10 个 deck 所需技能名（安装套件后所需技能应全部就位 → 锁死清单覆盖防漂移）
  const is = reg['installSkills']
  const SKILL_NAMES_10 = ['wayfinder', 'triage', 'grilling', 'grill-me', 'implement', 'ask-matt', 'research', 'prototype', 'handoff', 'setup-matt-pocock-skills']
  if (is) {
    if (is.version < 2) problems.push('installSkills 版本号未 bump（期望 ≥ v2）')
    if (is.zh.indexOf('~/.agents/skills') < 0) problems.push('installSkills zh 缺安装目录 ~/.agents/skills')
    if (is.en.indexOf('~/.agents/skills') < 0) problems.push('installSkills en 缺安装目录 ~/.agents/skills')
    SKILL_NAMES_10.forEach(function (n) {
      if (is.zh.indexOf(n) < 0) problems.push('installSkills zh 缺所需技能 ' + n)
      if (is.en.indexOf(n) < 0) problems.push('installSkills en 缺所需技能 ' + n)
    })
  } else {
    problems.push('缺条目 installSkills')
  }
  // #75 进度契约 v3（压缩 3 条 + 格式正例 + 未确认不得 close）：progress 必须 ≥ v3 且含关键标记
  //   契约要点：1) 格式与写法（固定区 + N 0-100 整数 + 正例 + 先读现状可上调下调） 2) 语义阶梯（0/1-94/95/100，
  //   95% 必须写明待确认什么 + 未确认不得 close） 3) 兜底（100% 保留历史 + 首触补写）
  const pr = reg['progress']
  if (pr) {
    if (pr.version < 3) problems.push('progress 版本号未 bump（期望 ≥ v3）')
    if (pr.placeholders.length !== 0) problems.push('progress 不应有占位符')
    // zh 关键标记
    if (pr.zh.indexOf('## 进度：N%') < 0) problems.push('progress zh 缺固定进度区格式（## 进度：N%）')
    if (pr.zh.indexOf('## 进度：90%') < 0) problems.push('progress zh 缺格式正例（如 ## 进度：90%）')
    if (pr.zh.indexOf('可上调也可下调') < 0) problems.push('progress zh 缺可上调可下调（真实当前值）')
    if (pr.zh.indexOf('0% = 未动工') < 0 || pr.zh.indexOf('1-94% = 进行中') < 0) problems.push('progress zh 缺阶梯 0%/1-94% 定义')
    if (pr.zh.indexOf('未确认不得 close') < 0) problems.push('progress zh 缺未确认不得 close（防 close@95% 违规）')
    if (pr.zh.indexOf('确认后立即写 100% 并 close') < 0) problems.push('progress zh 缺确认后 100% + close')
    if (pr.zh.indexOf('close 后进度区保留为历史') < 0) problems.push('progress zh 缺 close 后保留为历史')
    if (pr.zh.indexOf('首次接触') < 0 || pr.zh.indexOf('实施记录相符') < 0) problems.push('progress zh 缺首触补写兜底（首次接触 / 实施记录相符）')
    // en 关键标记（同构直译）
    if (pr.en.indexOf('## Progress: N%') < 0) problems.push('progress en 缺固定进度区格式（## Progress: N%）')
    if (pr.en.indexOf('## Progress: 90%') < 0) problems.push('progress en 缺格式正例（e.g. ## Progress: 90%）')
    if (pr.en.indexOf('may go up or down') < 0) problems.push('progress en 缺 may go up or down')
    if (pr.en.indexOf('do not close before confirmation') < 0) problems.push('progress en 缺 do not close before confirmation')
    if (pr.en.indexOf('stays as history after close') < 0) problems.push('progress en 缺 stays as history after close')
    if (pr.en.indexOf('first contact') < 0 || pr.en.indexOf('implementation record') < 0) problems.push('progress en 缺首触补写兜底（first contact / implementation record）')
  } else {
    problems.push('缺条目 progress')
  }
  // #76 bodyFormat v3（契约唯一 + 工具无关 + 去 AI 黑话 + 正例）：bodyFormat 必须 ≥ v3 且含关键标记
  //   契约要点：1) 每个 ## 章节 独占一行 + 段落空行 2) 禁字面 \n / 禁 BOM 3) 以文件方式提交（工具无关，不点名 gh）
  //   4) 正例（## 进度：90% 独占一行 + 空行 + 下一步；反例不写成字面 \n）—— 内嵌 7 处清单版与注册表编号版同文
  const bf = reg['bodyFormat']
  if (bf) {
    if (bf.version < 3) problems.push('bodyFormat 版本号未 bump（期望 ≥ v3）')
    if (bf.placeholders.length !== 0) problems.push('bodyFormat 不应有占位符')
    // zh 关键标记
    if (bf.zh.indexOf('每个 `## 章节` 独占一行') < 0) problems.push('bodyFormat zh 缺「每个 ## 章节 独占一行」（结构规则）')
    if (bf.zh.indexOf('段落间留空行') < 0) problems.push('bodyFormat zh 缺段落间留空行')
    if (bf.zh.indexOf('禁止字面 \\n 转义') < 0) problems.push('bodyFormat zh 缺禁字面 \\n 转义')
    if (bf.zh.indexOf('BOM（\\ufeff）') < 0) problems.push('bodyFormat zh 缺禁 BOM 标记（BOM（\\ufeff））')
    if (bf.zh.indexOf('以文件方式提交') < 0) problems.push('bodyFormat zh 缺「以文件方式提交」（工具无关，不得点名 gh）')
    if (bf.zh.indexOf('不要内联转义字符串') < 0) problems.push('bodyFormat zh 缺「不要内联转义字符串」（去 JSON 黑话）')
    if (bf.zh.indexOf('gh issue edit') >= 0) problems.push('bodyFormat zh 不得点名 gh issue edit（工具无关契约）')
    if (bf.zh.indexOf('正例') < 0 || bf.zh.indexOf('## 进度：90%') < 0) problems.push('bodyFormat zh 缺格式正例（正例 / ## 进度：90%）')
    // en 关键标记（同构直译）
    if (bf.en.indexOf('each `## section` on its own line') < 0) problems.push('bodyFormat en 缺 each ## section on its own line')
    if (bf.en.indexOf('blank line between paragraphs') < 0) problems.push('bodyFormat en 缺 blank line between paragraphs')
    if (bf.en.indexOf('No literal \\n escapes') < 0) problems.push('bodyFormat en 缺 No literal \\n escapes')
    if (bf.en.indexOf('BOM (\\ufeff)') < 0) problems.push('bodyFormat en 缺 BOM (\\ufeff) 标记')
    if (bf.en.indexOf('via a file') < 0) problems.push('bodyFormat en 缺 via a file（工具无关）')
    if (bf.en.indexOf('inline escaped string') < 0) problems.push('bodyFormat en 缺 inline escaped string')
    if (bf.en.indexOf('gh issue edit') >= 0) problems.push('bodyFormat en 不得点名 gh issue edit（工具无关契约）')
    if (bf.en.indexOf('Example') < 0 || bf.en.indexOf('## Progress: 90%') < 0) problems.push('bodyFormat en 缺格式正例（Example / ## Progress: 90%）')
  } else {
    problems.push('缺条目 bodyFormat')
  }
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '(' + Object.keys(reg).length + ' 条注册表，' + (src.match(/promptText\(/g) || []).length + ' 处引用)')
}
console.log('P1: prompt 注册表契约')
targets.forEach(check)
// 双源键一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留单产物注册表校验（P1）；P2 双源接线一致性由 src↔产物 + 冒烟覆盖
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
