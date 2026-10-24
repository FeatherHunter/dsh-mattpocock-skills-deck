// tests/verify-1412-ask-matt-next-steps.ts —— #1412 阶段 A 门禁：/ask-matt 末尾的「推荐下一步」规则节
// 门禁归属: src/shared/ask-matt-next-steps.ts
// 门禁归属: src/host/bootstrap.ts
// 门禁归属: package/bundled-skills/ask-matt/SKILL.md
// 门禁归属: src/deck/tools/suggest-next-steps.ts
// 门禁归属: config/prompts/ticket-action-templates.yaml
// 门禁归属: config/prompts/ticket-creation.yaml
// 门禁归属: config/prompts/map-advancement.yaml
//
// 为什么要有这一扇（#1412 票面）：/ask-matt 要补一节「推荐下一步」规则，告诉模型什么时候调用
// suggest_next_steps、怎么挑 2~4 条、理由怎么写、什么时候不要调用。这一节不能写进上游
// package/bundled-skills/ask-matt/SKILL.md（上游原文有哈希门禁逐字冻结，同步脚本还会整目录重建），
// 所以住在 src/shared/ask-matt-next-steps.ts，由宿主启动技底 bootstrap.ts 的 provider.get() 在返回
// 正文时拼到末尾。这条链路任何一段断了，模型就看不到规则：
//   ① 规则节本身四段齐全、数字与 #1406 冻结常量一致、不再提已退役的 /retro；
//   ② 上游 SKILL.md 一个字节都没变（哈希对基线），且文件里没有规则文字；
//   ③ provider.get('ask-matt') 的正文以规则节结尾、只拼一次、反复读结果一致；其它技能正文不动；
//   ④ 20 个注入模板里的提醒行还在，且提醒口径与本规则节一致；
//   ⑤ 安装态与开发态两条产物都接到规则文件上（package/shared 与 .build/shared）；
//   ⑥ 负向自检：把规则节改坏、或把「追加」去掉时，本门禁的判据必须跟着红。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1412-ask-matt-next-steps.ts
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1412-ask-matt-next-steps'
const RULE_FILE = 'src/shared/ask-matt-next-steps.ts'
const BOOTSTRAP_FILE = 'src/host/bootstrap.ts'
const ASK_MATT_SKILL_FILE = 'package/bundled-skills/ask-matt/SKILL.md'
const HASH_MANIFEST = 'tests/bundled-skills-upstream-hashes.json'

// 规则节应有什么：标题与四段小标题按 #1412 票面写死在这里，与规则文件互相当独立来源；
// 数字（2~4 / 500 / 200 / 少于 2 条 / 超过 4 条）另外与 #1406 的导出常量对。
const HEADING = '## 推荐下一步（本插件追加，不属于上游原文）'
const FOUR_LABELS = ['什么时候调用', '怎么挑 2~4 条', '理由怎么写', '什么时候不要调用']
const TOOL_NAME = 'suggest_next_steps'
// 提醒行（#1407）的核心句：模板说「回复前最后一步」，规则节开头必须能接住这句话。
const REMINDER_CORE = '回复前最后一步，结合当下实际场景 按 /ask-matt 的规则，判断是否可以推荐当前最适合的技能，并且调用 suggest_next_steps 工具 进行推荐'
const REMINDER_ZH = '- [ ] ' + REMINDER_CORE + '。'
const REMINDER_FILES = ['config/prompts/ticket-action-templates.yaml', 'config/prompts/ticket-creation.yaml', 'config/prompts/map-advancement.yaml']
const REMINDER_TOTAL = 20

let total = 0
let failed = 0
function check(ok, message) {
  total += 1
  if (ok) console.log('  PASS ' + message)
  else { failed += 1; console.log('  FAIL ' + message) }
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function sha256OfLf(text) {
  return crypto.createHash('sha256').update(String(text || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

// 与 bootstrap.ts 的 parseSkillRaw 同一口径：去掉 BOM 与 frontmatter，取正文并 trim。
function bodyOf(raw) {
  const s = String(raw || '').replace(/^\uFEFF/, '')
  const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  return m ? s.slice(m[0].length).trim() : s.trim()
}

// 规则节判据：返回空数组表示合格，否则每一条说明差在哪。负向自检就靠它证明「改坏会红」。
function sectionProblems(section) {
  const text = String(section || '')
  const problems = []
  if (text.indexOf(HEADING) !== 0) problems.push('标题不在开头')
  for (const label of FOUR_LABELS) { if (text.indexOf(label) < 0) problems.push('缺一段：' + label) }
  if (text.indexOf(TOOL_NAME) < 0) problems.push('没提工具名')
  if (text.indexOf('回复前最后一步') < 0) problems.push('没写「回复前最后一步」')
  if (text.indexOf('2~4') < 0) problems.push('没写 2~4 条')
  if (text.indexOf('intro 不超过 10 个字') < 0) problems.push('没写简介上限 10 个字')
  if (text.indexOf('500') < 0) problems.push('没写提示词上限 500')
  if (text.indexOf('200') < 0) problems.push('没写理由上限 200')
  if (text.indexOf('少于 2 条') < 0) problems.push('没写少于 2 条会拒绝')
  if (text.indexOf('超过 4 条') < 0) problems.push('没写超过 4 条会截断')
  if (text.indexOf('priority') < 0) problems.push('没写推荐优先级 priority')
  if (text.indexOf('0 到 10') < 0) problems.push('没写优先级的 0 到 10 分')
  if (text.indexOf('/xxxx') < 0) problems.push('没写提示词开头要写 /xxxx 技能指令')
  if (text.indexOf('技能角度') < 0) problems.push('没写这颗工具优先从技能角度推荐')
  if (text.indexOf('/retro') >= 0) problems.push('不该再提已退役的 /retro')
  return problems
}

// 追加判据：正文必须恰好等于「上游正文 + 空行 + 规则节」，多一个字少一个字都算没接对。
function appendedExactly(body, section, content) {
  return String(content || '') === String(body || '').replace(/\s+$/, '') + '\n\n' + String(section || '')
}

// 用最小的 mock 宿主上下文把 bundled provider 拿到手（照 tests/verify-bundled-discovery.ts 的做法）。
// 为什么不用真宿主：真宿主会连带装配一大片服务；这里只验「get() 返回的正文」，mock 足够且稳定。
async function loadProvider() {
  let captured = null
  const mockSkills = {
    registerProvider(factory) { captured = factory; return function () {} },
  }
  const mockCtx = {
    get(key) {
      if (key === 'skills') return mockSkills
      if (key === 'logger') return { info() {}, warn() {} }
      return undefined
    },
    effect(fn) { try { const r = fn(); return typeof r === 'function' ? r : function () {} } catch { return function () {} } },
  }
  const mod = await imp(BOOTSTRAP_FILE)
  mod.createBootstrap({ ctx: mockCtx })
  const deadline = Date.now() + 10000
  while (!captured && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
  if (!captured) throw new Error('没等到 bundled provider 注册（' + BOOTSTRAP_FILE + ' 的探测流程没跑起来）')
  const control = { signal: new AbortController().signal, invalidate() {} }
  return captured(control)
}

function candidateFor(name, filePath) {
  return { name: name, locator: { path: filePath, directory: path.dirname(filePath) } }
}

async function main() {
  // 门禁可能在别的工作目录被拉起：先回到仓库根，bundled 目录的候选探测才找得到 package/。
  process.chdir(ROOT)
  const rule = await imp(RULE_FILE)
  const tool = await imp('src/deck/tools/suggest-next-steps.ts')
  const section = String(rule.ASK_MATT_NEXT_STEPS_SECTION || '')

  console.log('\n-- 1) 规则节内容 --')
  check(rule.ASK_MATT_SKILL_NAME === 'ask-matt', '规则节归属技能名精确为 ask-matt')
  check(rule.ASK_MATT_NEXT_STEPS_HEADING === HEADING, '导出的标题与票面要求一致')
  check(section.length > 0, '规则节非空')
  check(section.indexOf(HEADING) === 0, '规则节以标题开头')
  check(FOUR_LABELS.every((label) => section.indexOf(label) >= 0), '四段规则齐全：什么时候调用、怎么挑 2~4 条、理由怎么写、什么时候不要调用')
  check(section.indexOf(TOOL_NAME) >= 0, '规则节点名 suggest_next_steps')
  check(section.indexOf('回复前最后一步') >= 0, '规则节写了「回复前最后一步」（与模板提醒行同一口径）')
  check(section.indexOf(REMINDER_CORE) >= 0, '规则节开头接住模板提醒行的核心句')
  check(section.indexOf('/retro') < 0, '规则节不再提已退役的 /retro')
  check(sectionProblems(section).length === 0, '规则节判据对真实规则全过（' + (sectionProblems(section).join('；') || '无问题') + '）')

  console.log('\n-- 2) 数字与 #1406 冻结常量一致 --')
  check(tool.MIN_ITEMS === 2 && tool.MAX_ITEMS === 4, '#1406 的条数常量仍是 2~4')
  check(tool.INTRO_MAX_CHARS === 10 && tool.PROMPT_MAX_CHARS === 500 && tool.REASON_MAX_CHARS === 200, '#1406 的长度常量仍是 intro 10、prompt 500、reason 200')
  check(section.indexOf(tool.MIN_ITEMS + '~' + tool.MAX_ITEMS) >= 0, '规则节写的是 ' + tool.MIN_ITEMS + '~' + tool.MAX_ITEMS + ' 条（与工具常量同源）')
  check(section.indexOf('intro 不超过 ' + tool.INTRO_MAX_CHARS + ' 个字') >= 0 && section.indexOf('简介') >= 0, '规则节写的是简介（intro）不超过 ' + tool.INTRO_MAX_CHARS + ' 个字')
  check(section.indexOf('prompt 不超过 ' + tool.PROMPT_MAX_CHARS + ' 字符') >= 0, '规则节写的是 prompt 不超过 ' + tool.PROMPT_MAX_CHARS + ' 字符')
  check(section.indexOf('reason 不超过 ' + tool.REASON_MAX_CHARS + ' 字符') >= 0, '规则节写的是 reason 不超过 ' + tool.REASON_MAX_CHARS + ' 字符')
  check(section.indexOf('少于 ' + tool.MIN_ITEMS + ' 条') >= 0, '规则节写的是少于 ' + tool.MIN_ITEMS + ' 条会整次拒绝')
  check(section.indexOf('超过 ' + tool.MAX_ITEMS + ' 条') >= 0, '规则节写的是超过 ' + tool.MAX_ITEMS + ' 条只留前 ' + tool.MAX_ITEMS + ' 条')
  check(tool.PRIORITY_MIN === 0 && tool.PRIORITY_MAX === 10, '#1406 的优先级常量是 0~10')
  check(section.indexOf('priority') >= 0 && section.indexOf(tool.PRIORITY_MIN + ' 到 ' + tool.PRIORITY_MAX) >= 0,
    '规则节写的是 priority（' + tool.PRIORITY_MIN + ' 到 ' + tool.PRIORITY_MAX + ' 分，与工具常量同源）')
  check(section.indexOf('没打分') >= 0 && section.indexOf('最后') >= 0, '规则节写清没打分的排在最后（拿不准就别硬打分）')
  check(section.indexOf('/xxxx') >= 0 && section.indexOf('技能角度') >= 0,
    '规则节写清技能优先：这个工具优先从技能角度推荐，每条提示词开头写 /xxxx 技能指令')

  console.log('\n-- 3) 上游 SKILL.md 一个字节都没变 --')
  const rawAsk = fs.readFileSync(path.join(ROOT, ASK_MATT_SKILL_FILE), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, HASH_MANIFEST), 'utf8'))
  const pinnedHash = manifest && manifest.files && manifest.files['ask-matt/SKILL.md']
  check(typeof pinnedHash === 'string' && pinnedHash.length === 64, '基线里记着 ask-matt/SKILL.md 的哈希')
  check(sha256OfLf(rawAsk) === pinnedHash, '上游 ask-matt/SKILL.md 与基线哈希一字不差（规则没被塞进原文）')
  check(rawAsk.indexOf('推荐下一步') < 0 && rawAsk.indexOf(HEADING) < 0, '上游原文里没有本插件追加的规则文字')
  check(rawAsk.indexOf('# Ask Matt') >= 0, '读到的确实是 ask-matt 原文（不是空文件或别的技能）')

  console.log('\n-- 4) provider.get(ask-matt)：正文末尾只拼一次规则节 --')
  const provider = await loadProvider()
  const opts = {}
  const askContent = (await provider.get(candidateFor('ask-matt', path.join(ROOT, ASK_MATT_SKILL_FILE)), opts)).content
  const askBody = bodyOf(rawAsk)
  check(typeof askContent === 'string' && askContent.indexOf(HEADING) >= 0, 'get(ask-matt) 的正文里能看到规则节')
  check(String(askContent).endsWith(section), 'get(ask-matt) 的正文以规则节结尾')
  check(String(askContent).split(HEADING).length - 1 === 1, '规则节在正文里恰好出现一次（不会叠加）')
  check(appendedExactly(askBody, section, askContent), '正文恰好等于「上游正文 + 空行 + 规则节」')
  const askAgain = (await provider.get(candidateFor('ask-matt', path.join(ROOT, ASK_MATT_SKILL_FILE)), opts)).content
  check(askAgain === askContent, '连续两次 get(ask-matt) 结果一致（幂等）')

  console.log('\n-- 5) 其它技能与名字不匹配的候选不受影响 --')
  const tddPath = path.join(ROOT, 'package/bundled-skills/tdd/SKILL.md')
  const rawTdd = fs.readFileSync(tddPath, 'utf8')
  const tddContent = (await provider.get(candidateFor('tdd', tddPath), opts)).content
  check(String(tddContent).indexOf(HEADING) < 0, 'get(tdd) 的正文里没有规则节')
  check(String(tddContent) === bodyOf(rawTdd), 'get(tdd) 的正文就是上游原文，一个字没动')
  const mismatch = await provider.get(candidateFor('wayfinder', path.join(ROOT, ASK_MATT_SKILL_FILE)), opts)
  check(mismatch === undefined, '候选名与文件里的 name 对不上时返回 undefined（规则节不会拼到别的技能上）')
  const aborted = await provider.get(candidateFor('ask-matt', path.join(ROOT, ASK_MATT_SKILL_FILE)), { signal: { aborted: true, reason: new Error('测试中止') } })
  check(aborted === undefined, '调用已被中止时返回 undefined（不追加、不抛错）')
  const listed = await provider.list({})
  const askListed = Array.isArray(listed) ? listed.find((c) => c && c.name === 'ask-matt') : null
  check(!!askListed, 'list() 里仍有 ask-matt 条目')
  check(askListed && askListed.content === undefined, 'list() 不读正文、也不带规则节（规则只在 get() 时拼接）')

  console.log('\n-- 6) 20 个注入模板的提醒行与规则节口径一致 --')
  let reminderCount = 0
  for (const rel of REMINDER_FILES) {
    const yamlPath = path.join(ROOT, rel)
    check(fs.existsSync(yamlPath), '提醒模板还在：' + rel)
    const text = fs.readFileSync(yamlPath, 'utf8')
    reminderCount += text.split(REMINDER_ZH).length - 1
  }
  check(reminderCount === REMINDER_TOTAL, '三份模板族里中英提醒的中文行共 ' + REMINDER_TOTAL + ' 条（实测 ' + reminderCount + '）')

  console.log('\n-- 7) 安装态与开发态两条路都接到规则文件上（需要先跑构建） --')
  // 安装态：package/lib/bootstrap.js 与 package/shared/ 是发布包里的兄弟目录，说明符写 ../shared/…。
  // 开发态：宿主源码住在 src/host/，同一个说明符按「src/host/ 为基准」解析到 src/shared/；
  // 测试挂的 ts-hook 会把 .js 说明符换到同名的 .ts 源码，所以本文件第 4、5 节用真源码跑通了开发态。
  // 仓库根 host.js 是 cordis_define 的函数体、只含 src/host/index.ts 自己那几处动态引用，
  // 不含 bootstrap.ts 的内部说明符，所以这里不拿它当开发态判据（拿它判会永远红）。
  const pkgRule = path.join(ROOT, 'package/shared/ask-matt-next-steps.js')
  const pkgBootstrap = path.join(ROOT, 'package/lib/bootstrap.js')
  check(fs.existsSync(pkgRule), '构建产出 package/shared/ask-matt-next-steps.js（安装态规则文件）')
  const pkgRuleText = fs.existsSync(pkgRule) ? fs.readFileSync(pkgRule, 'utf8') : ''
  check(pkgRuleText.indexOf('ASK_MATT_NEXT_STEPS_SECTION') >= 0 && pkgRuleText.indexOf('ask-matt') >= 0, '安装态规则文件导出规则节与技能名')
  check(fs.existsSync(pkgBootstrap), '构建产出 package/lib/bootstrap.js（安装态启动技底）')
  const pkgBootstrapText = fs.existsSync(pkgBootstrap) ? fs.readFileSync(pkgBootstrap, 'utf8') : ''
  check(pkgBootstrapText.indexOf('../shared/ask-matt-next-steps.js') >= 0, '安装态 bootstrap 按兄弟目录写法引到规则文件（../shared/…）')
  const bootstrapSource = fs.readFileSync(path.join(ROOT, BOOTSTRAP_FILE), 'utf8')
  check(bootstrapSource.indexOf("'../shared/ask-matt-next-steps.js'") >= 0, '开发态源码按 src/host 基准引到规则文件（../shared/…，ts-hook 会换到 .ts）')
  check(fs.existsSync(path.join(ROOT, '.build/shared/ask-matt-next-steps.js')), '开发态配套产物 .build/shared/ask-matt-next-steps.js 已生成（共享层直读用）')

  console.log('\n-- 8) 负向自检：规则节被改坏 / 追加被去掉时，判据必须红 --')
  check(sectionProblems(section.replace('什么时候不要调用', '收尾语')).length > 0, '负向自检：删掉「什么时候不要调用」一段时判据必须红')
  check(sectionProblems(section.split('2~4').join('1~5')).length > 0, '负向自检：条数写错成 1~5 条时判据必须红')
  check(sectionProblems(section.replace('500', '800')).length > 0, '负向自检：提示词上限写错时判据必须红')
  check(sectionProblems(section.replace('intro 不超过 10 个字', 'intro 不超过 20 个字')).length > 0, '负向自检：简介上限写错时判据必须红')
  check(sectionProblems(section + '\n/retro').length > 0, '负向自检：规则节又提 /retro 时判据必须红')
check(sectionProblems(section.split('priority').join('优先级')).length > 0, '负向自检：规则节里不写 priority 这个名字时判据必须红')
check(sectionProblems(section.split('0 到 10').join('随便几分')).length > 0, '负向自检：优先级区间写错时判据必须红')
  check(sectionProblems(section.split('/xxxx').join('技能')).length > 0, '负向自检：规则节不写 /xxxx 技能指令时判据必须红')
  check(!appendedExactly(askBody, section, askBody), '负向自检：正文没拼规则节时追加判据必须红')
  check(!appendedExactly(askBody, section, askBody + '\n\n' + section + section), '负向自检：规则节拼了两遍时追加判据必须红')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
