// tests/verify-prompt-command-inventory.js —— 门禁：提示词与文档里的跟踪器命令按清单归零（票 #716）
// 用法：在插件根目录执行 node tests/verify-prompt-command-inventory.js，可独立运行。
//
// 这条门禁管四件事，都是票面点名要的：
//   ① 按清单逐条断言归零：tests/prompt-command-manifest.json 的 zeroed[] 每一类命令，在提示词面与
//      文档面上必须一处都不剩（命中就报出文件、行号与原文）。清单本身的内容也卡死（条数、面数硬编码）。
//   ② 允许留下的三类（登录 / 建仓 / 阻塞降级写法）不许扩散：它们只能出现在清单登记的面上，
//      漏回客户端提示词模板即判红；同时断言它们真的还在（否则「只剩三类」这句话是空话）。
//   ③ 「该搬进工具实现的那些真的搬了」：清单里每条 zeroed 记着它搬去了哪个工具，这一条去把那些工具
//      真装起来（调用工厂拿 definition.name），并断言提示词/文档里确实改成了指向那个工具的说法。
//   ④ 换后端跑一遍：同一批提示词模板，分别用 GitHub / GitLab / 本地 Markdown / 一个探针后端渲染，
//      断言 GitHub 那边不再出现 GitLab 的词、其余三边不再出现 gh 与 GitHub 的词；探针后端的词表
//      （probecli / ProbeLand）必须真的出现在渲染结果里 —— 这一条是「后端注入」不是「把字删掉」的证据。
//
// 反规避：判定前先做归一化（同形字母、零宽字符、去掉反斜杠），挡住 gh[零宽]issue / g\u0068 issue
//   这类拆字写法；门禁自己还带两条探针（注入一处漏网的命令、把模板占位符写死），跑给看的人看。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const MANIFEST_FILE = path.join(__dirname, 'prompt-command-manifest.json')

// 硬编码期望值：清单被删条目 / 删面 / 清空允许项，都会在这里先红。
// 改动这张表要走评审（与 verify-prompts.js 的 EXPECT_* 同一种做法）。
const EXPECT_SURFACES = 10
const EXPECT_ZEROED = 14
const EXPECT_ALLOWED = 3
const EXPECT_MOVED_TOOLS = ['deck_issue_create', 'deck_issue_get', 'deck_issue_patch', 'deck_map_link', 'deck_context']

let failed = false
let total = 0
const problems = []
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) { failed = true; problems.push(msg) } return !!ok }
const note = (msg) => console.log('  ---- ' + msg)

// ── 归一化：同形字母、零宽字符、反斜杠拆字 ──
const HOMOGLYPH = /[\u0261\u0262\u1D26\u1D33\u1D4D]/g
const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g
const normVariants = function (s) {
  const base = String(s == null ? '' : s).normalize('NFKC').replace(HOMOGLYPH, 'g')
  return [base, base.replace(ZW, ''), base.replace(ZW, ' '), base.replace(/\\/g, '')]
}

/** 在一段文本里找一条清单规则命中的位置；返回 [{line, text}]（同一行只报一次）。 */
const hitsOf = function (text, patternSource) {
  const out = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    let hit = false
    for (const v of normVariants(lines[i])) {
      let re = null
      try { re = new RegExp(patternSource, 'i') } catch (e) { return [{ line: 0, text: '清单里的正则写坏了：' + patternSource + '（' + e.message + '）' }] }
      if (re.test(v)) { hit = true; break }
    }
    if (hit) out.push({ line: i + 1, text: lines[i].trim().slice(0, 160) })
  }
  return out
}

// ── 读清单 + 读扫描面 ──
const readManifest = function () {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) } catch (e) { return null }
}

// ── 渲染面：把客户端提示词注册表整段求值出来（与 tests/verify-prompts.js 同一套做法） ──
// 为什么要真的求值而不是正则扫源码：这一面要断言的是「渲染出来的文字长什么样」，不是「源码里有没有字符串」。
const REGISTRY_REL = 'src/client/kernel/prompts.js'
const evalRenderer = function (lang) {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf8')
  const body = String(src).replace(/^[ \t]*export[ \t]+/gm, '')
  const factory = new Function('localeSvc', 'issueUrlFor', body +
    '\n;return { PROMPTS: PROMPTS, promptTextFor: promptTextFor, VOCABULARY_DEFAULT: VOCABULARY_DEFAULT };')
  return factory({ getSnapshot: function () { return { active: lang } } }, function (st, num) { return 'https://example.invalid/' + String(num) })
}

// 四个后端（三个真的 + 一个探针）：探针后端只声明词表与一小段中性文案，用来证明「换名字就换词」。
const buildBackends = async function () {
  const out = []
  for (const id of ['github', 'gitlab', 'markdown']) {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/tracker/backends', id, 'index.js')).href)
    out.push({ id: id, label: id, prompts: mod.prompts })
  }
  out.push({
    id: 'probe-neutral', label: '探针后端（换一个后端名字跑一遍用）',
    prompts: {
      commandVocabulary: { cli: 'probecli', cliBrand: 'ProbeLand' },
      bodyFormat: { zh: '## 正文格式（探针）\n- [ ] 正文先写成文件，再交给工具写回，写完读回来核对', en: '## Body format (probe)\n- [ ] Write the body to a file, hand it to the tool, then read it back' },
      subIssue: { zh: '用建边工具落边并读回核对', en: 'wire the edge with the edge tool and read it back' },
      healthCheck: { zh: '**探针后端自己的科目**：查数与动手都走工具。', en: '**The probe backend owns this part**: counting and acting go through the tools.' },
    },
  })
  return out
}

// 别的后端的词：断言「用 A 后端渲染时，不出现 B 后端专有的 CLI 名与站点名」。
const OTHER_WORDS = {
  github: [[/\bglab\b/i, 'glab'], [/GitLab/, 'GitLab']],
  gitlab: [[/(?<![a-z0-9_\/-])gh(?![a-z0-9_])/i, 'gh'], [/GitHub/, 'GitHub']],
  markdown: [[/(?<![a-z0-9_\/-])gh(?![a-z0-9_])/i, 'gh'], [/\bglab\b/i, 'glab'], [/GitHub/, 'GitHub'], [/GitLab/, 'GitLab']],
  'probe-neutral': [[/(?<![a-z0-9_\/-])gh(?![a-z0-9_])/i, 'gh'], [/\bglab\b/i, 'glab'], [/GitHub/, 'GitHub'], [/GitLab/, 'GitLab']],
}

const main = async function () {
  console.log('提示词与文档里的跟踪器命令按清单归零（#716）')

  const mf = readManifest()
  if (!check(!!mf, '读得到清单 ' + path.relative(ROOT, MANIFEST_FILE))) { return finish() }

  // ── ① 清单自身的形状（防「删几条就全绿」） ──
  const surfaces = Array.isArray(mf.surfaces) ? mf.surfaces : []
  const zeroed = Array.isArray(mf.zeroed) ? mf.zeroed : []
  const allowed = Array.isArray(mf.allowed) ? mf.allowed : []
  check(surfaces.length === EXPECT_SURFACES, '清单登记了 ' + EXPECT_SURFACES + ' 个扫描面（实得 ' + surfaces.length + '）')
  check(zeroed.length === EXPECT_ZEROED, '清单登记了 ' + EXPECT_ZEROED + ' 类要归零的命令（实得 ' + zeroed.length + '）')
  check(allowed.length === EXPECT_ALLOWED, '清单登记了 ' + EXPECT_ALLOWED + ' 类允许留下的命令（实得 ' + allowed.length + '）')
  const shapeOk = surfaces.every((s) => s && s.id && s.path && s.kind && s.what) &&
    zeroed.every((z) => z && z.id && z.what && z.pattern && z.why) &&
    allowed.every((a) => a && a.id && a.what && a.pattern && a.why && Array.isArray(a.mayAppearIn))
  check(shapeOk, '清单每个面都有 id / path / kind / what，每条命令都有 id / what / pattern / why，允许项还带 mayAppearIn')

  const texts = {}
  const missing = []
  for (const s of surfaces) {
    const p = path.join(ROOT, s.path)
    if (!fs.existsSync(p)) { missing.push(s.id + ' → ' + s.path); continue }
    texts[s.id] = fs.readFileSync(p, 'utf8')
  }
  check(missing.length === 0, '清单登记的 ' + surfaces.length + ' 个面都能读到文件（' + (missing.length ? '缺：' + missing.join('；') : '一个不缺') + '）')

  // ── ② 逐条归零 ──
  let zeroHits = 0
  for (const z of zeroed) {
    const found = []
    for (const s of surfaces) {
      if (!texts[s.id]) continue
      for (const h of hitsOf(texts[s.id], z.pattern)) found.push(s.path + ':' + h.line + '  ' + h.text)
    }
    zeroHits += found.length
    check(found.length === 0, '归零[' + z.id + '] ' + z.what + '：一处都不剩（' + (found.length ? '还剩 ' + found.length + ' 处 → ' + found[0] : '零命中') + '）')
  }
  note('归零类命中共 ' + zeroHits + ' 处（期望 0）')

  // ── ③ 允许留下的三类：不许扩散 + 不许凭空消失 ──
  for (const a of allowed) {
    const where = []
    for (const s of surfaces) {
      if (!texts[s.id]) continue
      const n = hitsOf(texts[s.id], a.pattern).length
      if (n) where.push({ id: s.id, path: s.path, n: n })
    }
    const leaked = where.filter((w) => a.mayAppearIn.indexOf(w.id) < 0)
    check(leaked.length === 0, '允许类[' + a.id + '] ' + a.what + '：没有漏到清单没登记的面上（' + (leaked.length ? '漏到 ' + leaked.map((x) => x.path).join('、') : '未扩散') + '）')
    check(where.length > 0, '允许类[' + a.id + '] ' + a.what + '：确实还留着（出现在 ' + where.map((x) => x.id).join('、') + '）')
  }

  // ── ④ 「该搬进工具实现的那些真的搬了」 ──
  const toolNames = {}
  const toolDir = path.join(ROOT, 'src/host/tools')
  const toolFiles = fs.readdirSync(toolDir).filter((f) => f.endsWith('.js'))
  for (const f of toolFiles) {
    const mod = await import(pathToFileURL(path.join(toolDir, f)).href)
    const key = Object.keys(mod).find((k) => k.indexOf('create') === 0)
    if (!key) continue
    try {
      const built = mod[key]({})
      const name = built && built.definition && String(built.definition.name || '')
      if (name) toolNames[name] = path.relative(ROOT, path.join(toolDir, f))
    } catch (e) { /* 工厂要 deps 才能装起来时跳过：下面按名字断言会出现问题 */ }
  }
  const movedNeeded = []
  for (const z of zeroed) if (z.movedTo && movedNeeded.indexOf(z.movedTo) < 0) movedNeeded.push(z.movedTo)
  for (const want of EXPECT_MOVED_TOOLS) check(movedNeeded.indexOf(want) >= 0, '清单里点名要用工具 ' + want + ' 顶替的命令（清单缺了它）')
  for (const tn of movedNeeded) {
    check(!!toolNames[tn], '工具 ' + tn + ' 真的装起来了（' + (toolNames[tn] || '没找到 definition.name') + '）')
    let inText = false
    const where = []
    for (const s of surfaces) {
      if (!texts[s.id]) continue
      if (texts[s.id].indexOf(tn) >= 0) { inText = true; where.push(s.id) }
    }
    check(inText, '提示词/文档里确实改成了指向 ' + tn + '（出现在 ' + where.join('、') + '）')
  }
  for (const z of zeroed) {
    if (!z.evidence) continue
    let ok = false
    for (const s of surfaces) { if (texts[s.id] && texts[s.id].indexOf(z.evidence) >= 0) { ok = true; break } }
    check(ok, '归零[' + z.id + '] 的替代说法真的写进去了：「' + z.evidence + '」')
  }

  // ── ⑤ 换一个后端名字跑一遍 ──
  const backends = await buildBackends()
  const renderers = { zh: evalRenderer('zh'), en: evalRenderer('en') }
  const idList = Object.keys(renderers.zh.PROMPTS)
  check(idList.length >= 20, '渲染面拿到注册表条目（' + idList.length + ' 条）')
  const exemptIds = (Array.isArray(mf.renderExempt) ? mf.renderExempt : []).map((e) => e.id)
  const expectedExempt = Array.isArray(mf.renderExemptExpected) ? mf.renderExemptExpected : []
  check(JSON.stringify(exemptIds.slice().sort()) === JSON.stringify(expectedExempt.slice().sort()),
    '渲染面的豁免名单与硬编码期望逐条相等（实得 [' + exemptIds.join(',') + ']，期望 [' + expectedExempt.join(',') + ']）')

  const rendered = {}
  for (const b of backends) {
    for (const lang of ['zh', 'en']) {
      const r = renderers[lang]
      const st = { selection: { backendId: b.id }, backendModules: [b], cwd: '/probe' }
      for (const id of idList) {
        let text = ''
        try { text = String(r.promptTextFor(st, id, {}) || '') } catch (e) { text = '' }
        rendered[b.id + '|' + lang + '|' + id] = text
      }
    }
  }
  check(Object.keys(rendered).length === backends.length * 2 * idList.length, '每个后端 × 每种语言 × 每条模板都真的渲染了一遍')

  let wordHits = 0
  for (const b of backends) {
    const rules = OTHER_WORDS[b.id] || []
    const found = []
    for (const lang of ['zh', 'en']) {
      for (const id of idList) {
        if (exemptIds.indexOf(id) >= 0) continue
        const text = rendered[b.id + '|' + lang + '|' + id]
        for (const [re, label] of rules) {
          if (re.test(text)) found.push(id + '.' + lang + ' 里出现「' + label + '」：' + text.slice(Math.max(0, text.search(re) - 20), text.search(re) + 30).replace(/\s+/g, ' '))
        }
      }
    }
    wordHits += found.length
    check(found.length === 0, '换后端[' + b.id + '] 渲染：不出现别的后端专有的词（' + (found.length ? found.length + ' 处，第一处 → ' + found[0] : '零命中') + '）')
  }
  note('换后端渲染命中共 ' + wordHits + ' 处（期望 0）')

  // 正向对照：后端注入真的在起作用 —— 探针后端的词必须出现在渲染结果里，
  //   GitHub 后端的登录提示必须出现它自己的命令行名。没有这两条，「零命中」可能是把字删光而不是换词。
  const probeText = Object.keys(rendered).filter((k) => k.indexOf('probe-neutral|') === 0).map((k) => rendered[k]).join('\n')
  check(probeText.indexOf('probecli') >= 0 && probeText.indexOf('ProbeLand') >= 0, '探针后端的词表（probecli / ProbeLand）真的出现在渲染结果里 —— 是后端注入，不是把字删掉')
  const ghLogin = rendered['github|zh|ghAuthLogin'] || ''
  check(/gh\s+auth\s+login/.test(ghLogin), 'GitHub 后端的登录提示渲染出来仍是它自己的命令行写法（gh auth login）')
  const mdLogin = rendered['markdown|zh|ghAuthLogin'] || ''
  check(mdLogin.indexOf('{cli}') < 0 && mdLogin.length > 0, '本地 Markdown 后端渲染同一条提示词时，占位符 {cli} 被填成了中性说法（不是原样漏出去）')
  note('markdown 渲染登录提示的开头：' + mdLogin.slice(0, 60).replace(/\s+/g, ' '))

  // ── ⑥ 两条探针：门禁自己先被证明能红 ──
  const probeText2 = (texts['backend:github'] || '') + '\n- **建子议题边**：先用 gh api repos/o/r/issues/1 --jq .id 取编号。\n'
  const probeHits = []
  for (const z of zeroed) probeHits.push.apply(probeHits, hitsOf(probeText2, z.pattern))
  check(probeHits.length > 0, '✗ probe：往文本里塞一处漏网的建边命令 → 扫描器逮住了（' + probeHits.length + ' 条规则命中）')
  // 第二条探针：把「后端注入」改成「模板里写死」
  const hardcoded = (renderers.zh.PROMPTS['ghAuthLogin'] || {}).zh || ''
  const hardcodedRender = String(hardcoded).split('{cli}').join('gh').split('{cliBrand}').join('GitHub')
  check(OTHER_WORDS.markdown.some(([re]) => re.test(hardcodedRender)), '✗ probe：把登录提示里的 {cli} 写死成 gh → 「换后端渲染」这一条会红（写死后的文本确实命中了别的后端的词）')

  return finish()
}

const finish = function () {
  console.log('\n' + (failed ? '存在失败（' + problems.length + ' 条）' : '全部通过 — 提示词与文档里只剩三类裸命令：登录、建仓、阻塞降级写法（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
