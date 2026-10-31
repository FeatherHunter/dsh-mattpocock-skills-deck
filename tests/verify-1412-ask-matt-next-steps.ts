// tests/verify-1412-ask-matt-next-steps.ts —— #1412 反向门禁：读技能时正文原样返回，不追加任何插件文字
// 门禁归属: src/host/bootstrap.ts
// 门禁归属: package/bundled-skills/ask-matt/SKILL.md
// 门禁归属: tests/bundled-skills-upstream-hashes.json
// 门禁归属: config/prompts/ticket-action-templates.yaml
// 门禁归属: config/prompts/ticket-creation.yaml
// 门禁归属: config/prompts/map-advancement.yaml
//
// 为什么要有这一扇（#1412 反向；维护者 2026-10-24 决定）：#1412 阶段 A 曾在 src/host/bootstrap.ts 的
// 技能 provider.get() 里，把一节「推荐下一步」规则拼到 /ask-matt 的返回正文末尾。维护者认为「读技能时
// 悄悄改返回内容」风险太高，要求撤掉这套机制；规则内容改放进 suggest_next_steps 的工具说明（#1464 后续）。
// 从此这一扇守的是「不追加」：模型读任何技能，拿到的正文都必须与盘上原文一字不差。任何一段断了都算红：
//   ① 上游 ask-matt/SKILL.md 一个字节没变，文件里没有任何插件追加的规则文字；
//   ② provider.get(ask-matt) 的正文 === 盘上原文正文（逐字节相等），反复读结果一致；
//   ③ 其它技能同样原样返回；候选名对不上、调用已中止时照旧返回 undefined；
//   ④ 源码里没有追加逻辑，规则文件与它在 package/.build 的产物都不存在；
//   ⑤ 20 条注入模板的中文提醒行还在（新口径：模板里的「## 工具」节已收进公共小节
//      config/prompts/shared-sections.yaml，这里经共享读取核展开后再数，防止撤机制时顺手删提醒）；
//   ⑥ 负向自检：正文尾部多一个字、脚本里又出现旧引用时，判据必须红。
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
// 已撤掉的规则节标题与工具名：正文里再出现它们，就说明「不追加」又被破坏了。
const OLD_HEADING = '## 推荐下一步（本插件追加，不属于上游原文）'
const TOOL_NAME = 'suggest_next_steps'

// 提醒行（#1407）：模板中英文提醒行已换成「回复前最后一步」新口径，只确认 20 条中文提醒行还在，
// 防止撤机制时顺手把模板里的提醒也删了。模板里的「## 工具」节住在公共小节
// config/prompts/shared-sections.yaml（{{shared:sharedTools}} 在读取时展开），所以这里经共享读取核
// 拿到展开后的正文再数，不能直接扫 YAML 原文（原文里只剩标记）。
const REMINDER_ZH = '- [ ] 每轮回复收尾时先判断一次：用户接下来几乎一定会做什么？想得到就调用 suggest_next_steps 给出 2~4 条最可能被他选中的做法；这一轮在等用户拍板时，其中一条把每题的推荐答案列好；想不到就不调用。'
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

// 「正文原样」判据：返回空数组表示合格，否则每一条说明差在哪。负向自检靠它证明「改坏会红」。
function verbatimProblems(content, raw) {
  const problems = []
  if (typeof content !== 'string') return ['正文不是字符串']
  const want = bodyOf(raw)
  if (content !== want) problems.push('正文与盘上原文不相等')
  if (content.indexOf(OLD_HEADING) >= 0) problems.push('正文里还有已撤掉的规则节标题')
  if (content.indexOf(TOOL_NAME) >= 0 && want.indexOf(TOOL_NAME) < 0) problems.push('正文里出现原文没有的工具名')
  return problems
}

// 「源码不再引用追加逻辑」判据：返回问题清单，负向自检直接喂一段带有旧引用的源码。
function appendCodeProblems(source) {
  const text = String(source || '')
  const problems = []
  for (const needle of ['ask-matt-next-steps', 'ASK_MATT_NEXT_STEPS_SECTION', 'ASK_MATT_EXTRA', 'loadAskMattExtra']) {
    if (text.indexOf(needle) >= 0) problems.push('源码里还留着 ' + needle)
  }
  return problems
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

// 候选形状照上游 skills 服务的约定：name 加 locator（path 与 directory 都写全）。
function candidateFor(name, filePath) {
  return { name: name, locator: { path: filePath, directory: path.dirname(filePath) } }
}

async function main() {
  // 门禁可能在别的工作目录被拉起：先回到仓库根，bundled 目录的候选探测才找得到 package/。
  process.chdir(ROOT)

  console.log('\n-- 1) 上游 ask-matt/SKILL.md 一个字节都没变 --')
  const rawAsk = fs.readFileSync(path.join(ROOT, ASK_MATT_SKILL_FILE), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, HASH_MANIFEST), 'utf8'))
  const pinnedHash = manifest && manifest.files && manifest.files['ask-matt/SKILL.md']
  check(typeof pinnedHash === 'string' && pinnedHash.length === 64, '基线里记着 ask-matt/SKILL.md 的哈希')
  check(sha256OfLf(rawAsk) === pinnedHash, '上游 ask-matt/SKILL.md 与基线哈希一字不差')
  check(rawAsk.indexOf('# Ask Matt') >= 0, '读到的确实是 ask-matt 原文（不是空文件或别的技能）')
  check(rawAsk.indexOf('推荐下一步') < 0 && rawAsk.indexOf(OLD_HEADING) < 0, '上游原文里没有任何插件追加的规则文字')

  console.log('\n-- 2) provider.get(ask-matt)：正文与盘上原文逐字节相等 --')
  const provider = await loadProvider()
  const opts = {}
  const askPath = path.join(ROOT, ASK_MATT_SKILL_FILE)
  const askContent = (await provider.get(candidateFor('ask-matt', askPath), opts)).content
  check(typeof askContent === 'string', 'get(ask-matt) 返回了正文')
  check(verbatimProblems(askContent, rawAsk).length === 0, '正文原样判据全过（' + (verbatimProblems(askContent, rawAsk).join('；') || '无问题') + '）')
  check(String(askContent) === bodyOf(rawAsk), '正文逐字节等于盘上原文正文（一个字没多、一个字没少）')
  check(String(askContent).indexOf(OLD_HEADING) < 0, '正文里没有已撤掉的规则节标题')
  const askAgain = (await provider.get(candidateFor('ask-matt', askPath), opts)).content
  check(askAgain === askContent, '连续两次 get(ask-matt) 结果一致（幂等，不叠加）')

  console.log('\n-- 3) 其它技能同样原样返回；命名不匹配与中止照旧返回 undefined --')
  for (const name of ['tdd', 'wayfinder']) {
    const skillPath = path.join(ROOT, 'package/bundled-skills', name, 'SKILL.md')
    const raw = fs.readFileSync(skillPath, 'utf8')
    const content = (await provider.get(candidateFor(name, skillPath), opts)).content
    check(verbatimProblems(content, raw).length === 0, 'get(' + name + ') 的正文就是盘上原文，一个字没动')
  }
  const mismatch = await provider.get(candidateFor('wayfinder', askPath), opts)
  check(mismatch === undefined, '候选名与文件里的 name 对不上时返回 undefined')
  const aborted = await provider.get(candidateFor('ask-matt', askPath), { signal: { aborted: true, reason: new Error('测试中止') } })
  check(aborted === undefined, '调用已被中止时返回 undefined（不追加、不抛错）')
  const listed = await provider.list({})
  const askListed = Array.isArray(listed) ? listed.find((c) => c && c.name === 'ask-matt') : null
  check(!!askListed, 'list() 里仍有 ask-matt 条目')
  check(Array.isArray(listed) && listed.every((c) => c && c.content === undefined), 'list() 不读正文（每条都不带 content）')

  console.log('\n-- 4) 源码里没有追加逻辑，旧规则文件与两条产物都不存在 --')
  const bootstrapSource = fs.readFileSync(path.join(ROOT, BOOTSTRAP_FILE), 'utf8')
  check(appendCodeProblems(bootstrapSource).length === 0, 'bootstrap 源码不再引用追加逻辑（' + (appendCodeProblems(bootstrapSource).join('；') || '无问题') + '）')
  check(!fs.existsSync(path.join(ROOT, RULE_FILE)), '旧规则文件 ' + RULE_FILE + ' 已删除')
  const pkgRule = path.join(ROOT, 'package/shared/ask-matt-next-steps.js')
  check(!fs.existsSync(pkgRule), '构建产出里没有 package/shared/ask-matt-next-steps.js（安装包不再带规则文件）')
  const pkgBootstrap = path.join(ROOT, 'package/lib/bootstrap.js')
  check(fs.existsSync(pkgBootstrap), '构建产出 package/lib/bootstrap.js（安装态启动技底）')
  const pkgBootstrapText = fs.existsSync(pkgBootstrap) ? fs.readFileSync(pkgBootstrap, 'utf8') : ''
  check(appendCodeProblems(pkgBootstrapText).length === 0, '安装态 bootstrap 也不引用追加逻辑')
  check(!fs.existsSync(path.join(ROOT, '.build/shared/ask-matt-next-steps.js')), '开发态产物 .build/shared/ask-matt-next-steps.js 不存在')

  console.log('\n-- 5) 20 个注入模板的提醒行还在（新口径：经共享读取核展开公共小节后逐条数） --')
  const promptConfig = require('../scripts/lib/prompt-config.mts')
  const promptConfigData = promptConfig.readPromptConfig(ROOT)
  const flatTemplates = {}
  for (const fam of Object.keys(promptConfigData.templates)) {
    const entries = promptConfigData.templates[fam] || {}
    for (const id of Object.keys(entries)) flatTemplates[id] = entries[id]
  }
  const templateIds = Object.keys(flatTemplates)
  check(templateIds.length === 27, '共享读取核读出 27 条模板（实测 ' + templateIds.length + '）')
  let reminderCount = 0
  for (const id of templateIds) reminderCount += String(flatTemplates[id].zh || '').split(REMINDER_ZH).length - 1
  check(reminderCount === REMINDER_TOTAL, '展开后的 27 条模板里中文提醒行共 ' + REMINDER_TOTAL + ' 条（实测 ' + reminderCount + '）')

  console.log('\n-- 6) 负向自检：正文被追加、源码又出现旧引用时，判据必须红 --')
  check(verbatimProblems(bodyOf(rawAsk) + '\n\n' + OLD_HEADING, rawAsk).length > 0, '负向自检：正文尾部追加规则节时原样判据必须红')
  check(verbatimProblems(bodyOf(rawAsk) + ' ', rawAsk).length > 0, '负向自检：正文尾部多一个空格时原样判据必须红')
  check(verbatimProblems('', rawAsk).length > 0, '负向自检：正文为空时原样判据必须红')
  check(verbatimProblems(askContent, rawAsk).length === 0 && verbatimProblems(askContent + 'x', rawAsk).length > 0, '判据对真实正文放行、对改过一个字的正文判红')
  check(appendCodeProblems(bootstrapSource + '\nawait import("../shared/ask-matt-next-steps.js")').length > 0, '负向自检：源码里再出现旧规则文件引用时判据必须红')
  check(appendCodeProblems(bootstrapSource + '\nlet ASK_MATT_EXTRA = null').length > 0, '负向自检：源码里再出现旧追加常量时判据必须红')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
