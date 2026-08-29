// verify-setup-describe.js — #230（D10 · 键入 locale）验收门禁：setup 提示词后端描述数据化
// 验证：
//   1) 三后端（github/markdown/gitlab）在 client locale 的描述数据 == #230 前三函数的金样值（占位符值逐字节相同）
//   2) setupRun 注入产物与旧行为等价：github/gitlab 全文逐字节等值；markdown 仅少「标签齐全」条款（本票行为变更点）
//   3) 占位符解析与工作区状态无关（全新 / 已 init 同值——等价判据）
//   4) 后端确有声明（BackendModule.setupPrompt 四键）+ host wf.registry 转发 setupPrompt
//   5) client 零残留门禁：无 setupTrackerLine/Choice/BackendNote 代码引用；UI 手工拼装 promptText('setupRun',{ 残留 =
//      （唯一豁免：kernel/prompts.js 及其拼进产物中的 setupRunParamsFrom 同行真源调用）
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
const G = {
  zh: {
    github: { trackerLine: '本仓库为 GitHub ' + ARROW + ' 提议 GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\n本次已选后端：GitHub ' + EMDASH + ' 请按 GitHub 模板生成 docs/agents/issue-tracker.md' },
    markdown: { trackerLine: '本仓库为本地文件 ' + ARROW + ' 提议 Local markdown', trackerChoice: 'Local markdown', backendNote: '\n\n本次已选后端：Markdown ' + EMDASH + ' 请按本地 Markdown 模板生成 docs/agents/issue-tracker.md（.scratch 结构）' },
    gitlab: { trackerLine: '本仓库为 GitLab ' + ARROW + ' 提议 GitLab Issues', trackerChoice: 'GitLab Issues', backendNote: '\n\n本次已选后端：GitLab ' + EMDASH + ' 请按 GitLab 模板生成 docs/agents/issue-tracker.md' },
    default: { trackerLine: '本仓库为 GitHub ' + ARROW + ' 提议 GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\n本次未指定后端，已按默认 GitHub 初始化；可在设置页随时切换' },
  },
  en: {
    github: { trackerLine: 'this repo is on GitHub ' + ARROW + ' propose GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\nSelected backend: GitHub ' + EMDASH + ' please generate docs/agents/issue-tracker.md from the GitHub template.' },
    markdown: { trackerLine: 'this repo uses local files ' + ARROW + ' propose Local markdown', trackerChoice: 'Local markdown', backendNote: '\n\nSelected backend: Markdown ' + EMDASH + ' please generate docs/agents/issue-tracker.md from the local Markdown template (.scratch structure).' },
    gitlab: { trackerLine: 'this repo is on GitLab ' + ARROW + ' propose GitLab Issues', trackerChoice: 'GitLab Issues', backendNote: '\n\nSelected backend: GitLab ' + EMDASH + ' please generate docs/agents/issue-tracker.md from the GitLab template.' },
    default: { trackerLine: 'this repo is on GitHub ' + ARROW + ' propose GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\nNo backend explicitly selected, defaulting to GitHub; you can switch anytime in Settings ' + ARROW + ' Backend.' },
  },
}
const LABEL_REQS = {
  zh: '，并确保仓库中技能所需标签齐全（triage 五角色 + wayfinder 标签 wayfinder:map / research / prototype / grilling / task），不要只建少数几个',
  en: ', and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) ' + EMDASH + ' not just a few',
}
// #323（2026-08-29 第三轮修正 · 用户澄清）：注入文案负责构造工作区调色盘表——表形状 + 预填色值 + 落位指令 + 改色入口；渲染机制不属 AI 知识
const PALETTE_NOTE = {
  zh: '\n\n## 标签调色盘（本地 Markdown 支持 · MattSkillsDeck）\n\n为支持 MattSkillsDeck 在本地 Markdown 后端为标签提供色值（颜色）功能，需要在本仓库的 docs/agents/triage-labels.md 中增加一张「标签调色盘」表。按下表样式建表（颜色一个一行，回车确认前可自行修改）：\n\n| Label | Color | Meaning |\n| --- | --- | --- |\n| wayfinder:map | #8b5cf6 | The map issue of a wayfinder effort |\n| wayfinder:research | #0ea5e9 | Research ticket (AFK) |\n| wayfinder:prototype | #f59e0b | Prototype ticket (HITL) |\n| wayfinder:grilling | #9d7cd8 | Grilling / discussion ticket (HITL) |\n| wayfinder:task | #10b981 | Task ticket (HITL or AFK) |\n| bug | #d73a4a | Something is broken (fix action / BUG filter) |\n| needs-triage | #fbca04 | Unexamined issue awaiting diagnosis |\n| needs-info | #5319e7 | Waiting on reporter for more information |\n| ready-for-agent | #0e8a16 | Fully specified, ready for an AFK agent |\n| ready-for-human | #b60205 | Requires human implementation |\n| wontfix | #ffffff | Will not be actioned |\n\n自定义标签在本表加一行；若已有此表则核对补缺；想改颜色就改表中对应行的 Color 值。\n\n⚠️ 请勿删除本表或其中的行——删除会导致标签色值功能损毁（未收录的标签将无法显示颜色）。',
  en: "\n\n## Label palette (Local Markdown · MattSkillsDeck)\n\nTo let MattSkillsDeck give labels colors in the local Markdown backend, add a label palette table to docs/agents/triage-labels.md in this repo. Build it following this sample table (one color per row — editable before you confirm):\n\n| Label | Color | Meaning |\n| --- | --- | --- |\n| wayfinder:map | #8b5cf6 | The map issue of a wayfinder effort |\n| wayfinder:research | #0ea5e9 | Research ticket (AFK) |\n| wayfinder:prototype | #f59e0b | Prototype ticket (HITL) |\n| wayfinder:grilling | #9d7cd8 | Grilling / discussion ticket (HITL) |\n| wayfinder:task | #10b981 | Task ticket (HITL or AFK) |\n| bug | #d73a4a | Something is broken (fix action / BUG filter) |\n| needs-triage | #fbca04 | Unexamined issue awaiting diagnosis |\n| needs-info | #5319e7 | Waiting on reporter for more information |\n| ready-for-agent | #0e8a16 | Fully specified, ready for an AFK agent |\n| ready-for-human | #b60205 | Requires human implementation |\n| wontfix | #ffffff | Will not be actioned |\n\nCustom labels get a new row here; if the table already exists, verify and fill gaps; to change a color, edit the Color value of the matching row.\n\n⚠️ Do not delete this table or any of its rows — that would break the label color feature (labels not listed would lose their colors).",
}

// setupRun 全文期望：帧 = v10 模板静态文本（除五占位符）；值来自金样 / PALETTE_NOTE
function expectSetupRun(lang, tl, tc, lr, bn, pn) {
  if (lang === 'zh') return '/setup-matt-pocock-skills\n\n初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：\n1. 按技能流程选择 issue tracker：' + tl + '，由用户确认；\n2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 ' + tc + '；triage 标签保留默认五角色）' + lr + '；后续打标签严格遵循技能规则，不额外强制任何标签；\n3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。' + bn + pn
  return '/setup-matt-pocock-skills\n\nBootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths ' + EMDASH + ' it does not install or clone any skills):\n1. Follow the skill flow to pick the issue tracker: ' + tl + ', confirm with the user;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose ' + tc + ' as the tracker; keep the default triage-role labels)' + lr + '; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green).' + bn + pn
}
const stripComments = (src) => src.split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) }).join('\n')
// 生产替换算法复刻（与 promptText 一致）；standalone 环境下 promptLang 恒 zh，门禁按语言直取模板帧
const fill = (frame, prm) => String(frame).replace(/\{(\w+)\}/g, function (mm, name) { return Object.prototype.hasOwnProperty.call(prm, name) ? String(prm[name]) : mm })

async function main() {
  const root = process.cwd()
  console.log('== #230 · setup 提示词后端描述数据化（键入 locale）==')
  const localeSrc = fs.readFileSync(path.join(root, 'src/client/kernel/locale.js'), 'utf8')

  const P = await import(pathToFileURL(path.join(root, 'src/client/kernel/prompts.js')).href)
  const LOCALE = await import(pathToFileURL(path.join(root, 'src/client/kernel/locale.js')).href)
  const L = LOCALE.L

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
    // #323：paletteNote 仅本地 Markdown 声明（其余后端不声明 → 按空串解析，零影响）
    if (b === 'markdown') {
      check(!!keys['paletteNote'], 'backend markdown setupPrompt.paletteNote 已声明（#323 调色盘注入）')
      // #323（定版复核）：本地后端自持默认调色盘（结构/label/颜色经契约层供给面板；工作区表为覆盖层）
      check(src.includes('export const defaultLabelPalette') && src.includes('labelPalette: defaultLabelPalette'), 'markdown 模块声明默认调色盘 labelPalette（#323 定版复核）')
      const paletteEntries = (src.match(/\{ name: '[^']+', color: '[0-9a-fA-F]{3,8}' \}/g) || [])
      check(paletteEntries.length >= 11, 'markdown defaultLabelPalette 含 11 行默认标签（实得 ' + paletteEntries.length + '）')
    }
    stubs.push({ id: b, setupPrompt: keys })
  }
  // host wf.registry 转发
  const hostSrc = fs.readFileSync(path.join(root, 'src/host/index.js'), 'utf8')
  check(hostSrc.indexOf('m.setupPrompt ? { setupPrompt: m.setupPrompt }') >= 0, 'host wf.registry 转发 setupPrompt')
  // 快照镜像：locale 双语键一一成对存在（防单一语言漂移）
  const keyList = []
  for (const ns of ['github', 'markdown', 'gitlab', 'default']) for (const f of ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs']) keyList.push('setup.' + ns + '.' + f)
  for (const k of keyList) check(L.zh[k] !== undefined && L.en[k] !== undefined, 'locale 双语键齐全 ' + k)
  // #323：调色盘规则键（仅 markdown 命名空间）
  check(L.zh['setup.markdown.paletteNote'] !== undefined && L.en['setup.markdown.paletteNote'] !== undefined, 'locale 双语键齐全 setup.markdown.paletteNote（#323）')

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
  // #323：调色盘规则值 == 金样（双语）
  check(L.zh['setup.markdown.paletteNote'] === PALETTE_NOTE.zh, 'zh setup.markdown.paletteNote == 金样')
  check(L.en['setup.markdown.paletteNote'] === PALETTE_NOTE.en, 'en setup.markdown.paletteNote == 金样')

  // 缺省键组：未选择 / 未知第三方 id —— 与旧「缺省 GitHub」行为等价
  const dZh = P.setupRunParamsFrom([], undefined, L.zh)
  check(dZh.trackerLine === G.zh.default.trackerLine && dZh.trackerChoice === G.zh.default.trackerChoice && dZh.backendNote === G.zh.default.backendNote && dZh.labelReqs === LABEL_REQS.zh && dZh.paletteNote === '', '未选择后端 → 缺省键组（=旧缺省行为；paletteNote 空）')
  const dEn = P.setupRunParamsFrom(undefined, 'third-party-x', L.en)
  check(dEn.backendNote === G.en.default.backendNote && dEn.trackerLine === G.en.default.trackerLine && dEn.paletteNote === '', '未知第三方后端 id → 缺省键组（=旧行为；paletteNote 空）')

  // ---- 验收 2+3：注入全文等价 & 状态无关 ----
  for (const lang of ['zh', 'en']) {
    const dict = L[lang]
    for (const b of BACKENDS) {
      const params = P.setupRunParamsFrom(stubs, b, dict)
      const got = fill(P.PROMPTS.setupRun[lang], params)
      const wantLR = b === 'markdown' ? '' : LABEL_REQS[lang]
      const wantPN = b === 'markdown' ? PALETTE_NOTE[lang] : ''
      const want = expectSetupRun(lang, G[lang][b].trackerLine, G[lang][b].trackerChoice, wantLR, G[lang][b].backendNote, wantPN)
      check(got === want, lang + ' · ' + b + ' setupRun 全文与现行为等价' + (got !== want ? '（长度 ' + got.length + ' vs 期望 ' + want.length + '）' : ''))
      const fresh = JSON.stringify(P.setupRunParamsFrom(stubs, b, dict))
      const init = JSON.stringify(P.setupRunParamsFrom(stubs.slice(), b + '', dict))
      check(fresh === init, lang + ' · ' + b + ' 占位符与工作区初始化状态无关（同值）')
    }
  }
  // 集成锚点：生产 promptText 路径（其内部替换算法必须与本门禁的 fill 完全一致 —— zh 腿全等即证明）
  check(P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh)) === fill(P.PROMPTS.setupRun.zh, P.setupRunParamsFrom(stubs, 'github', L.zh)), 'promptText 替换算法与门禁 fill 一致（zh 全等）')
  const mdTxt = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'markdown', L.zh))
  check(mdTxt.indexOf('确保仓库中技能所需标签齐全') < 0, 'markdown 注入文本不再要求「标签齐全」')
  // #323：markdown 注入文本含调色盘规则；github 不含（非本地后端口径）
  check(mdTxt.indexOf('调色盘') >= 0 && mdTxt.indexOf('docs/agents/triage-labels.md') >= 0 && mdTxt.indexOf('Color') >= 0, 'markdown 注入文本含「增加调色盘表」指令（#323 · 第四轮：票格式规则归 setup 技能，不重复）')
  const ghTxt = P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh))
  check(ghTxt.indexOf('确保仓库中技能所需标签齐全') >= 0, 'github 注入文本保留标签齐全要求')
  check(ghTxt.indexOf('调色盘') < 0, 'github 注入文本不含调色盘规则（非本地后端口径）')
  check(ghTxt.indexOf('/setup-matt-pocock-skills') === 0, '注入文本以手动命令 /setup-matt-pocock-skills 开头（手动输入与按钮两路共用同一模板）')
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
      if (/promptText\(\s*'setupRun'\s*,/.test(line) && !line.includes('setupRunParamsFrom')) badRefs.push(rel + ':' + (idx + 1) + ' :: 手工拼装 promptText(setupRun,{ 残留（应走 setupRunPrompt）')
    })
  }
  check(badRefs.length === 0, 'client + 双产物零残留：' + (badRefs.length ? '\n    - ' + badRefs.join('\n    - ') : 'clean'))

  console.log(failed ? 'FAIL ' + passed + '/' + total : 'PASS ' + passed + '/' + total)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1) })
