// verify-setup-describe.js — #230（D10 · 键入 locale）验收门禁：setup 提示词后端描述数据化
// 验证：
//   1) 三后端（github/markdown/gitlab）在 client locale 的描述数据 == #230 前三函数的金样值（占位符值逐字节相同）
//   2) setupRun 注入产物与旧行为等价：github/gitlab 全文逐字节等值；markdown 仅少「标签齐全」条款
//      与 #619 删掉的「标签调色盘」那一节（两处都是已定案的行为变更点）
//   3) 占位符解析与工作区状态无关（全新 / 已 init 同值——等价判据）
//   4) 后端确有声明（BackendModule.setupPrompt 四键）+ host wf.registry 转发 setupPrompt
//   5) client 零残留门禁：无 setupTrackerLine/Choice/BackendNote 代码引用；UI 手工拼装 promptText('setupRun',{ 残留 =
//      （唯一豁免：kernel/prompts.js 及其拼进产物中的 setupRunParamsFrom 同行真源调用）
//      另含 #619 的旧调色盘注入通道残留：paletteNote 键名，以及「标签调色盘 / Label palette」那段文案
//   6) 手动命令路径锚点：注入文本以 /setup-matt-pocock-skills 开头
// 用法: node tests/verify-setup-describe.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

let failed = false, total = 0, passed = 0
const check = (ok, msg) => { total++; if (ok) passed++; else { failed = true; console.log('  FAIL ' + msg) } }

const ARROW = String.fromCharCode(0x2192)   // →
const EMDASH = String.fromCharCode(0x2014)  // —

// ---- 金样：#230 前 prompts.js 三函数返回值求值后的字符串（行为契约历史定格；与源码侧 \u 转义写法无关）----
// #512 收敛注记：GitHub 后端说明金样已同步到 #496 落地的先建仓说法（中文向用户确认仓库名与可见性、英文 confirm the repo name and visibility），只改门禁期望值，不改生产文案与流程。
const G = {
  zh: {
    github: { trackerLine: '本仓库为 GitHub ' + ARROW + ' 提议 GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\n本次已选后端：GitHub ' + EMDASH + ' 若此目录还没有关联 GitHub 远端，先停下：向用户确认仓库名与可见性（公开还是私有），然后自己用建仓命令建好并推送（等价 gh repo create <name> --public/--private --source=. --push，非 Git 目录先 git init），或请用户在面板环境检查中点「创建并发布」向导完成；建仓成功并重查变绿后，再按 GitHub 模板生成 docs/agents/issue-tracker.md' },
    markdown: { trackerLine: '本仓库为本地文件 ' + ARROW + ' 提议 Local markdown', trackerChoice: 'Local markdown', backendNote: '\n\n本次已选后端：Markdown ' + EMDASH + ' 请按本地 Markdown 模板生成 docs/agents/issue-tracker.md（.scratch 结构）' },
    gitlab: { trackerLine: '本仓库为 GitLab ' + ARROW + ' 提议 GitLab Issues', trackerChoice: 'GitLab Issues', backendNote: '\n\n本次已选后端：GitLab ' + EMDASH + ' 请按 GitLab 模板生成 docs/agents/issue-tracker.md' },
    default: { trackerLine: '本仓库为 GitHub ' + ARROW + ' 提议 GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\n本次未指定后端，已按默认 GitHub 初始化；可在设置页随时切换' },
  },
  en: {
    github: { trackerLine: 'this repo is on GitHub ' + ARROW + ' propose GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\nSelected backend: GitHub ' + EMDASH + ' if this directory is not linked to a GitHub remote yet, stop: confirm the repo name and visibility (public/private) with the user, then create and push it yourself (equivalent to gh repo create <name> --public/--private --source=. --push; git init first outside a Git repo), or ask the user to finish the "Create & publish" wizard in the panel environment checks; only after the repo rows turn green on re-check, generate docs/agents/issue-tracker.md from the GitHub template.' },
    markdown: { trackerLine: 'this repo uses local files ' + ARROW + ' propose Local markdown', trackerChoice: 'Local markdown', backendNote: '\n\nSelected backend: Markdown ' + EMDASH + ' please generate docs/agents/issue-tracker.md from the local Markdown template (.scratch structure).' },
    gitlab: { trackerLine: 'this repo is on GitLab ' + ARROW + ' propose GitLab Issues', trackerChoice: 'GitLab Issues', backendNote: '\n\nSelected backend: GitLab ' + EMDASH + ' please generate docs/agents/issue-tracker.md from the GitLab template.' },
    default: { trackerLine: 'this repo is on GitHub ' + ARROW + ' propose GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\nNo backend explicitly selected, defaulting to GitHub; you can switch anytime in Settings ' + ARROW + ' Backend.' },
  },
}
const LABEL_REQS = {
  zh: '，并确保仓库中技能所需标签齐全（triage 五角色 + wayfinder 标签 wayfinder:map / research / prototype / grilling / task），不要只建少数几个',
  en: ', and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) ' + EMDASH + ' not just a few',
}
// #655（2026-09-19）：v12 新增 {contextLayout} —— 用户在初始化小卡上选的域文档布局（规格 #657）。
//   两句布局句与后端无关，来源是 kernel/locale-panel.js 里 setup.layout.single / setup.layout.multi 两条键；
//   main() 里按同一份真源取金样（不另抄一份字面，避免门禁与词条各说各话）。
const LAYOUT_KEY_OF = { single: 'setup.layout.single', multi: 'setup.layout.multi' }
// 卡片上那句问题与两个选项也各有中英两份（界面文案，不是注入文案）：键在则语言齐、值非空。
const LAYOUT_UI_KEYS = ['setup.layoutQuestion', 'setup.layoutSingle', 'setup.layoutMulti']
// #619（2026-09-13）：v10 在注入末尾追加的那节「标签调色盘」整段删除 —— 标签颜色改由插件自己放置的
//   配色文件（工作区里的 docs/agents/label-colors.json）与面板改色弹窗负责，初始化注入不再引导任何人
//   去建那张已经没人读的 md 表格。
// 判据升级（不许放水）：原来断言「注入文本 == 调色盘金样」，现在断言「注入文本里不许再出现这份旧文案的
//   任何特征片段」——下面每一条都是旧文案里独有的字符串，任一条复活即红。
const PALETTE_TEXT_FORBIDDEN = [
  '## 标签调色盘',
  '为支持 MattSkillsDeck 在本地 Markdown 后端为标签提供色值',
  '| Label | Color | Meaning |',
  '自定义标签在本表加一行',
  '请勿删除本表',
  '## Label palette',
  'add a label palette table to docs/agents/triage-labels.md',
  'Custom labels get a new row here',
  'Do not delete this table',
]
// 悬空标记守卫：占位符已从模板里删掉，任何一条注入文本都不该再印出 {paletteNote} 这串字。
const PALETTE_PLACEHOLDER_MARKER = '{paletteNote}'

// setupRun 全文期望：帧 = v12 模板静态文本（除五占位符）；值来自金样（#619 起不再有调色盘那一节；#655 起多一句布局结论）。
//   layoutLine 是用户这次选的布局对应的那一句（中文／英文各一份，由 main() 从真词表取）。
function expectSetupRun(lang, tl, tc, lr, bn, layoutLine) {
  if (lang === 'zh') return '/setup-matt-pocock-skills\n\n初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：\n1. 按技能流程选择 issue tracker：' + tl + '，由用户确认；\n2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 ' + tc + '；triage 标签保留默认五角色）' + lr + '；后续打标签严格遵循技能规则，不额外强制任何标签；\n3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。' + layoutLine + '。' + bn
  return '/setup-matt-pocock-skills\n\nBootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths ' + EMDASH + ' it does not install or clone any skills):\n1. Follow the skill flow to pick the issue tracker: ' + tl + ', confirm with the user;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose ' + tc + ' as the tracker; keep the default triage-role labels)' + lr + '; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green). ' + layoutLine + '.' + bn
}
const stripComments = (src) => src.split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) }).join('\n')
// 生产替换算法复刻（与 promptText 一致）；standalone 环境下 promptLang 恒 zh，门禁按语言直取模板帧
const fill = (frame, prm) => String(frame).replace(/\{(\w+)\}/g, function (mm, name) { return Object.prototype.hasOwnProperty.call(prm, name) ? String(prm[name]) : mm })

async function main() {
  const root = process.cwd()
  console.log('== #230 · setup 提示词后端描述数据化（键入 locale）==')
  const localeSrc = ['src/client/kernel/locale-panel.js', 'src/client/kernel/locale-flow.js', 'src/client/kernel/locale-word.js', 'src/client/kernel/locale.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') // #458 K5：locale.js 已拆为三片段加合并器，src 侧读四文件拼合（panel 含 setup 全家，合并器无键仅合并逻辑）

  const P = await import(pathToFileURL(path.join(root, 'src/client/kernel/prompts.js')).href)
  const LOCALE_PANEL = await import(pathToFileURL(path.join(root, 'src/client/kernel/locale-panel.js')).href) // #458 K5：合并器在构建闭包内才可见三片段，单文件 import 拿不到 L，故此处直引三片段按合并器同逻辑拼出 L
  const LOCALE_FLOW = await import(pathToFileURL(path.join(root, 'src/client/kernel/locale-flow.js')).href)
  const LOCALE_WORD = await import(pathToFileURL(path.join(root, 'src/client/kernel/locale-word.js')).href)
  const L = { zh: Object.assign({}, LOCALE_PANEL.L_PANEL.zh, LOCALE_FLOW.L_FLOW.zh, LOCALE_WORD.L_WORD.zh), en: Object.assign({}, LOCALE_PANEL.L_PANEL.en, LOCALE_FLOW.L_FLOW.en, LOCALE_WORD.L_WORD.en) }

  // ---- 后端声明提取 ----
  const BACKENDS = ['github', 'markdown', 'gitlab']
  const stubs = []
  for (const b of BACKENDS) {
    const src = fs.readFileSync(path.join(root, 'src/host/tracker/backends/' + b + '/index.js'), 'utf8')
    const i = src.indexOf('setupPrompt:')
    check(i >= 0, 'backend ' + b + ' 声明 setupPrompt')
    if (i < 0) continue
    const seg = src.slice(i, i + 700)
    const keys = {}
    const re = /(trackerLine|trackerChoice|backendNote|labelReqs|paletteNote)\s*:\s*'([^']+)'/g
    let m
    while ((m = re.exec(seg)) !== null) keys[m[1]] = m[2]
    ;['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].forEach((k) => check(!!keys[k], 'backend ' + b + ' setupPrompt.' + k + ' 已声明'))
    // #619：三个后端的 setupPrompt 一律只声明上面四键，谁都不许再声明 paletteNote（那条旧注入通道已拆）。
    //   非 Markdown 后端（github / gitlab）本来就没声明过它，这一条对它们是「口径零变化」的守卫。
    check(seg.indexOf('paletteNote') < 0 && !keys['paletteNote'], 'backend ' + b + ' setupPrompt 不再声明 paletteNote（#619 拆掉旧调色盘注入通道）')
    if (b === 'markdown') {
      // #323（定版复核）：本地后端自持默认调色盘（结构/label/颜色经契约层供给面板；工作区表为覆盖层）
      check(src.includes('export const defaultLabelPalette') && src.includes('labelPalette: defaultLabelPalette'), 'markdown 模块声明默认调色盘 labelPalette（#323 定版复核）')
      const paletteEntries = (src.match(/\{ name: '[^']+', color: '[0-9a-fA-F]{3,8}' \}/g) || [])
      check(paletteEntries.length >= 11, 'markdown defaultLabelPalette 含 11 行默认标签（实得 ' + paletteEntries.length + '）')
    }
    stubs.push({ id: b, setupPrompt: keys })
  }
  // host wf.registry 转发（H5 #449：转发体随 handleRegistry 搬入 workspaceCwd.js，断言跟随代码，意图不变）
  const hostSrc = fs.readFileSync(path.join(root, 'src/host/workspaceCwd.js'), 'utf8')
  check(hostSrc.indexOf('m.setupPrompt ? { setupPrompt: m.setupPrompt }') >= 0, 'host wf.registry 转发 setupPrompt')
  // 快照镜像：locale 双语键一一成对存在（防单一语言漂移）
  const keyList = []
  for (const ns of ['github', 'markdown', 'gitlab', 'default']) for (const f of ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs']) keyList.push('setup.' + ns + '.' + f)
  for (const k of keyList) check(L.zh[k] !== undefined && L.en[k] !== undefined, 'locale 双语键齐全 ' + k)
  // #619：v10 那条 paletteNote 键已从两份词表里删掉——这里反过来钉住「不许复活」：
  //   判据与原来「双语键齐全」同强，只是一个要求它在、一个要求它不在。
  check(L.zh['setup.markdown.paletteNote'] === undefined && L.en['setup.markdown.paletteNote'] === undefined, 'locale 中英两份词表都不再有 setup.markdown.paletteNote（#619 删掉的键不许复活）')
  // #655：布局这一组键的「中英两份都在、都不是空串」按同强判据钉住（卡片那句问题 + 两个选项 + 两句注入句）。
  for (const k of LAYOUT_UI_KEYS) check(!!L.zh[k] && !!L.en[k], 'locale 双语键齐全（非空）' + k)
  for (const lk of Object.keys(LAYOUT_KEY_OF)) {
    const key = LAYOUT_KEY_OF[lk]
    check(!!L.zh[key] && !!L.en[key], 'locale 双语键齐全（非空）' + key)
    check(String(L.zh[key]).length > 20 && String(L.en[key]).length > 20, key + ' 两句都是能读懂的整句，不是占位式短词')
    // 布局这一组键不再放进后端 setupPrompt 键表：布局是用户选的，与后端无关（规格「取值来源与后端无关」）
    for (const st of stubs) check(!Object.keys(st.setupPrompt).some((f) => st.setupPrompt[f] === key), '后端 ' + st.id + ' 不声明布局键 ' + key)
  }
  check(L.zh[LAYOUT_KEY_OF.single] !== L.zh[LAYOUT_KEY_OF.multi] && L.en[LAYOUT_KEY_OF.single] !== L.en[LAYOUT_KEY_OF.multi], '两种布局的中英两份金样各是各的（不会串台）')
  // 两种布局的注入全文（按语言取帧）逐字对照：除布局那一句外一字不差
  for (const lang of ['zh', 'en']) {
    const one = fill(P.PROMPTS.setupRun[lang], Object.assign({}, P.setupRunParamsFrom(stubs, 'github', L[lang], 'single'), { bodyFormat: '' }))
    const many = fill(P.PROMPTS.setupRun[lang], Object.assign({}, P.setupRunParamsFrom(stubs, 'github', L[lang], 'multi'), { bodyFormat: '' }))
    check(one.split(L[lang][LAYOUT_KEY_OF.single]).join('\u0000') === many.split(L[lang][LAYOUT_KEY_OF.multi]).join('\u0000'), lang + ' 两种布局的注入全文只差那一句布局结论')
    check(one !== many, lang + ' 两种布局的注入全文确实不同（金样不同）')
  }

  // ---- 验收 1：数据 == 金样 ----
  for (const lang of ['zh', 'en']) {
    const dict = L[lang] || {}
    for (const b of BACKENDS.concat(['default'])) {
      for (const f of ['trackerLine', 'trackerChoice', 'backendNote']) {
        const stub = b === 'default' ? null : stubs.find((s) => s.id === b)
        const resolvedKey = stub ? stub.setupPrompt[f] : ('setup.default.' + f)
        check(dict[resolvedKey] === G[lang][b][f], lang + '/' + b + '.' + f + ' == 金样（键 ' + resolvedKey + '）')
      }
    }
  }
  check((L.zh['setup.markdown.labelReqs'] || '') === '' && (L.en['setup.markdown.labelReqs'] || '') === '', 'markdown labelReqs 为空（Markdown 不要求标签齐全）')
  // #619：旧的调色盘文案整段删除，解析结果里也不该再产出这一项
  //   （原来这里是两条「键值 == 金样」的精确相等断言，现在换成「这一项不存在」）
  check(!('paletteNote' in P.setupRunParamsFrom(stubs, 'markdown', L.zh)) && !('paletteNote' in P.setupRunParamsFrom(stubs, 'markdown', L.en)), 'markdown 解析结果里不再产出 paletteNote 这一项（#619）')

  // 缺省键组：未选择 / 未知第三方 id —— 与旧「缺省 GitHub」行为等价
  const dZh = P.setupRunParamsFrom([], undefined, L.zh)
  check(dZh.trackerLine === G.zh.default.trackerLine && dZh.trackerChoice === G.zh.default.trackerChoice && dZh.backendNote === G.zh.default.backendNote && dZh.labelReqs === LABEL_REQS.zh && !('paletteNote' in dZh), '未选择后端 → 缺省键组（=旧缺省行为；不再有 paletteNote 项）')
  const dEn = P.setupRunParamsFrom(undefined, 'third-party-x', L.en)
  check(dEn.backendNote === G.en.default.backendNote && dEn.trackerLine === G.en.default.trackerLine && !('paletteNote' in dEn), '未知第三方后端 id → 缺省键组（=旧行为；不再有 paletteNote 项）')

  // ---- 验收 2+3：注入全文等价 & 状态无关 ----
  //   两腿都跑：不传布局（=旧调用形态，按缺省「一个仓库共用一份词表」填）与传了具体布局（#655 的新形态）。
  //   关键不变量：任何一腿都不许把这句留空——注入文案里永远有一句布局结论可选。
  for (const lang of ['zh', 'en']) {
    const dict = L[lang]
    for (const b of BACKENDS) {
      for (const layout of [undefined, 'single', 'multi']) {
        const params = P.setupRunParamsFrom(stubs, b, dict, layout)
        const got = fill(P.PROMPTS.setupRun[lang], params)
        const wantLR = b === 'markdown' ? '' : LABEL_REQS[lang]
        const wantLine = L[lang][LAYOUT_KEY_OF[layout || 'single']]
        const want = expectSetupRun(lang, G[lang][b].trackerLine, G[lang][b].trackerChoice, wantLR, G[lang][b].backendNote, wantLine)
        const tag = layout ? ('布局 ' + layout) : '未传布局（按缺省 single）'
        check(got === want, lang + ' · ' + b + ' · ' + tag + ' setupRun 全文与金样逐字相同' + (got !== want ? '（长度 ' + got.length + ' vs 期望 ' + want.length + '）' : ''))
        check(params.contextLayout.length > 0, lang + ' · ' + b + ' · ' + tag + ' 布局那句不为空（任何一腿都不许留空）')
      }
      const fresh = JSON.stringify(P.setupRunParamsFrom(stubs, b, dict))
      const init = JSON.stringify(P.setupRunParamsFrom(stubs.slice(), b + '', dict))
      check(fresh === init, lang + ' · ' + b + ' 占位符与工作区初始化状态无关（同值）')
    }
  }
  // 集成锚点：生产 promptText 路径（其内部替换算法必须与本门禁的 fill 完全一致 —— zh 腿全等即证明）
  check(P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh)) === fill(P.PROMPTS.setupRun.zh, P.setupRunParamsFrom(stubs, 'github', L.zh)), 'promptText 替换算法与门禁 fill 一致（zh 全等）')
  const mdTxt = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'markdown', L.zh))
  check(mdTxt.indexOf('确保仓库中技能所需标签齐全') < 0, 'markdown 注入文本不再要求「标签齐全」')
  // #619：三个后端（含 markdown）的注入文本里都不许再出现那份旧调色盘文案的任何特征片段，
  //   也不许印出 {paletteNote} 这种悬空标记 —— 原来这里是「markdown 含调色盘表指令」的正向断言，
  //   现在换成同强的反向断言；渲染用与上面全文比对同一套模板帧（promptText 内部按当前语言取模板，
  //   单测环境恒 zh，所以这里显式按语言取帧）。
  for (const lang of ['zh', 'en']) {
    for (const b of BACKENDS) {
      const txt = fill(P.PROMPTS.setupRun[lang], P.setupRunParamsFrom(stubs, b, L[lang]))
      const hits = PALETTE_TEXT_FORBIDDEN.filter((frag) => txt.indexOf(frag) >= 0)
      check(hits.length === 0, lang + ' · ' + b + ' 注入文本不含旧调色盘文案（命中：' + (hits.join(' / ') || '无') + '）')
      check(txt.indexOf(PALETTE_PLACEHOLDER_MARKER) < 0, lang + ' · ' + b + ' 注入文本不含悬空标记 ' + PALETTE_PLACEHOLDER_MARKER)
      check(txt.indexOf('调色盘') < 0, lang + ' · ' + b + ' 注入文本不再提「调色盘」')
    }
  }
  // 反向守卫（防删过头）：第 3 条里对 triage-labels.md 这个技能产物文件的提及必须留着 ——
  //   本票只拆「让 AI 去建颜色表」那一节，不拆「初始化后核对技能真实产物」这一句。
  check(mdTxt.indexOf('docs/agents/issue-tracker.md + triage-labels.md + domain.md') >= 0, 'markdown 注入文本仍保留技能产物核对句（triage-labels.md 是技能自己的文档，仍在；删的只是调色盘那一节）')
  const ghTxt = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh))
  check(ghTxt.indexOf('确保仓库中技能所需标签齐全') >= 0, 'github 注入文本保留标签齐全要求')
  check(ghTxt.indexOf('/setup-matt-pocock-skills') === 0, '注入文本以手动命令 /setup-matt-pocock-skills 开头（手动输入与按钮两路共用同一模板）')
  // #655：布局那句必须落在注入文本里、且不留悬空标记；没传布局时按缺省布局填（不印出 {contextLayout} 这串字）
  const ghLayoutTxt = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh, 'multi'))
  check(ghLayoutTxt.indexOf(L.zh[LAYOUT_KEY_OF.multi]) >= 0, 'github 注入文本里出现用户选的那一句布局结论')
  check(ghLayoutTxt.indexOf(LAYOUT_KEY_OF.multi) < 0, '注入文本里不许印出键名（正文只写人话）')
  for (const lang of ['zh', 'en']) {
    for (const b of BACKENDS) {
      for (const layout of [undefined, 'single', 'multi']) {
        const t = fill(P.PROMPTS.setupRun[lang], P.setupRunParamsFrom(stubs, b, L[lang], layout))
        check(t.indexOf('{contextLayout}') < 0, lang + ' · ' + b + ' · ' + (layout || '未传布局') + ' 注入文本不含悬空标记 {contextLayout}')
      }
    }
  }
  // UI 统一入口优先级（standalone import 无闭包字典 → 双方同走“缺省解析”，比较键路由而非最终文案）
  const selRoute = P.setupRunPrompt({ selection: { backendId: 'markdown' }, backendModules: stubs })
  const directRoute = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'markdown', null))
  check(selRoute === directRoute, 'setupRunPrompt 无显式 id 时取当前 selection 的声明键路由')

  // ---- 验收 5：client 零残留门禁（含双产物）----
  const scanDir = (dir) => {
    let out = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out = out.concat(scanDir(p))
      else if (e.name.endsWith('.js')) out.push(p)
    }
    return out
  }
  const files = scanDir(path.join(root, 'src/client')).concat([path.join(root, 'package/lib/client.js'), path.join(root, 'client.js')]).filter((p) => fs.existsSync(p))
  const badRefs = []
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/')
    const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n')
    lines.forEach((line, idx) => {
      if (/\b(setupTrackerLine|setupTrackerChoice|setupBackendNote)\b/.test(line)) badRefs.push(rel + ':' + (idx + 1) + ' :: trio 引用残留')
      // #619：旧调色盘注入通道（键名 paletteNote 与那段文案）不许在客户端源码或任何一个产物里留下来
      if (/\bpaletteNote\b/.test(line)) badRefs.push(rel + ':' + (idx + 1) + ' :: 旧调色盘注入通道残留（paletteNote）')
      if (line.indexOf('## 标签调色盘') >= 0 || line.indexOf('## Label palette') >= 0) badRefs.push(rel + ':' + (idx + 1) + ' :: 旧的标签调色盘注入文案残留（那一节的标题）')
      if (line.indexOf('triage-labels.md 中增加') >= 0 || line.indexOf('add a label palette table to docs/agents/triage-labels.md') >= 0) badRefs.push(rel + ':' + (idx + 1) + ' :: 旧的「去 triage-labels.md 建颜色表」指令残留')
      if (/promptText\(\s*'setupRun'\s*,/.test(line) && !line.includes('setupRunParamsFrom')) badRefs.push(rel + ':' + (idx + 1) + ' :: 手工拼装 promptText(setupRun,{ 残留（应走 setupRunPrompt）')
    })
  }
  check(badRefs.length === 0, 'client + 双产物零残留：' + (badRefs.length ? '\n    - ' + badRefs.join('\n    - ') : 'clean'))

  console.log(failed ? 'FAIL ' + passed + '/' + total : 'PASS ' + passed + '/' + total)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1) })
