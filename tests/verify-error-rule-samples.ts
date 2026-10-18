#!/usr/bin/env node
/**
 * tests/verify-error-rule-samples.js —— #1111：规则表逐条自证 + 真实原文夹具回归
 *
 * 守着的源码路径（按改动挑门禁时照这份清单）：
 *   src/tracker/kernel/error-rules.ts            COMMON_RULES / RULE_LAYERS / matchRule / judgeFactsDetailed
 *   src/tracker/rooms/github/errors.ts    本家前置扩展表 + classifyGhError
 *   src/tracker/rooms/gitlab/errors.ts    本家前置扩展表 + classifyGlabError
 *   src/tracker/rooms/markdown/**         本后端有无可比的扩展表（今天没有，门禁会说明）
 *   docs/adr/20261014-error-classification-single-source.md  第 2 节第 3 条：层序的真源
 *   tests/fixtures/error-samples.js       真实原文夹具（本门禁的证据表）
 *
 * 五段断言（A–E）：
 *   A 规则表自证：每条规则拿**它自带的样本**跑 matchRule，命中的必须正好是它自己
 *     （不是更靠前或更靠后的另一条）；新规则不配样本、样本被前面的规则抢走，都算红。
 *   B 顺序即文档：代码里的层序等于 RULE_LAYERS，也等于 ADR 第 2 节第 3 条写下的顺序；
 *     兜底项只能是最后一条，且只有一条。文档与代码对不上时**不改任何一边**，原样报出来。
 *   C 扩展项不许复制通用项：各后端前置扩展表逐条与 COMMON_RULES 比，同档位 + 同匹配写法
 *     （pattern 源一字不差，或两个纯事实判断在整张探针矩阵上结论完全一致）就判失败。
 *   D 真实原文夹具：tests/fixtures/error-samples.js 逐条断言档位，并核对每条都标了来源、
 *     规则样本类来源能在盘上逐字找到出处（不许编造"真实"原文）。
 *   E 自证：拿「坏词表 / 倒序 / 删兜底 / 改错期望档位 / 空样本」五种反例试这道门禁会不会红 ——
 *     不会红的门禁等于没写。E1、E2 复现的正是本门禁第一次跑时抓出来的两条真实缺陷。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-error-rule-samples.ts
 * 接线：由 Lead 统一挂进 scripts 里的门禁链（本次交付不动 scripts/**）。
 * 期望：全 PASS 退出码 0；SKIP 行表示读不到/尚未接线的部分，不算通过，会在末尾汇总。
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
let skips = 0
let notes = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const skip = (msg) => { skips += 1; console.log('  SKIP ' + msg) }
const note = (msg) => { notes += 1; console.log('  NOTE ' + msg) }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 文档写明的层序（ADR 第 2 节第 3 条），也是 RULE_LAYERS 必须等于的那一份。 */
const LAYER_ORDER = ['fact', 'errcode', 'phrase', 'vague', 'fallback']
const ADR_PATH = 'docs/adr/20261014-error-classification-single-source.md'

/**
 * 这份样本能不能拿来「自证」：必须有 example，且至少给了一个能当判据的事实字段。
 * 空文本本身可以当判据（有的规则正是靠「没有任何输出」成立），但一个字段都不给不行——
 * 那种样本对任何宽规则都"命中"，证明不了什么。
 */
function hasUsableExample(example) {
  if (!example || typeof example !== 'object') return false
  if (typeof example.text === 'string' && example.text.length > 0) return true
  return ['status', 'exitCode', 'errCode'].some((k) => example[k] !== undefined && example[k] !== null && example[k] !== '')
}

/** 一条规则自身的形状问题（返回空数组表示形状合格）。 */
function shapeProblems(rule, where) {  const bad = []
  if (!rule || typeof rule !== 'object') return [where + '：不是对象']
  if (!rule.kind) bad.push(where + '：没写 kind')
  if (!LAYER_ORDER.includes(rule.layer)) bad.push(where + '：layer=' + String(rule.layer) + ' 不在层序里')
  if (typeof rule.when !== 'function' && !(rule.pattern instanceof RegExp)) {
    bad.push(where + '：when 与 pattern 至少要给一个，现在两个都没有')
  }
  // 样本只要「这份事实输入」，不一定是带字的原文：有的规则本来就靠「没有输出」成立
  // （例：github 扩展表里 exitCode === -1 && !f.text 那条，样本的 text 天然是空的）。
  // 所以这里只挡两种真正的空样本：整个 example 缺失、或一个事实字段都没给（example: {}）。
  if (!hasUsableExample(rule.example)) {
    bad.push(where + '：没配 example，或 example 里一个事实字段都没有（text/status/exitCode/errCode 至少给一个非空值）'
      + '——「必须命中我」的样本不能缺')
  }
  if (typeof rule.note !== 'string' || rule.note.length < 10) {
    bad.push(where + '：note 太短或缺失（要说清这条挡的是哪种故障、为什么排在这个位置）')
  }
  return bad
}

/** 纯事实判断（只有 when，没有 pattern）才算「同一种匹配写法」，两条这样的规则才比条件等价。 */
function whenOnly(rule) { return typeof rule.when === 'function' && !rule.pattern }

/** 探针矩阵：覆盖结构化事实的取值组合与几种典型原文，用来比较两个纯事实判断是否等价。 */
const PROBE_STATUSES = [undefined, 200, 401, 403, 404, 429, 500]
const PROBE_ERRCODES = [undefined, 'ENOTFOUND', 'ENOENT', 'EACCES', 'EAI_AGAIN']
const PROBE_TEXTS = [
  '',
  'API rate limit exceeded for user ID 1.',
  'HTTP 403: Resource not accessible by integration',
  'Issue not found',
  'sh: 1: glab: command not found',
  'getaddrinfo ENOTFOUND api.github.com',
  'network error: connection lost',
  'EACCES: permission denied',
  'This backend does not support the requested field',
  'Unexpected token < in JSON at position 0',
  'zsh: segmentation fault (core dumped)',
]
const PROBES = []
for (const status of PROBE_STATUSES) {
  for (const errCode of PROBE_ERRCODES) {
    for (const text of PROBE_TEXTS) PROBES.push({ status, errCode, text })
  }
}

/** 整张探针矩阵上两个判断的结论是否处处一致（判断抛错按「不一致」处理）。 */
function verdictEquivalent(a, b) {
  for (const facts of PROBES) {
    let va
    let vb
    try { va = Boolean(a.when(facts)) } catch { return false }
    try { vb = Boolean(b.when(facts)) } catch { return false }
    if (va !== vb) return false
  }
  return true
}

/** 找出两个规则是不是「同档位 + 同匹配写法」的复制品（返回 null 表示不是）。 */
function copyReason(ext, common) {
  if (ext.kind !== common.kind) return null
  if (ext.pattern instanceof RegExp && common.pattern instanceof RegExp) {
    if (ext.pattern.source === common.pattern.source) {
      return 'pattern 源一字不差（/' + ext.pattern.source + '/，扩展标志 ' + ext.pattern.flags + '、通用标志 ' + common.pattern.flags + '）'
    }
    return null
  }
  if (whenOnly(ext) && whenOnly(common) && verdictEquivalent(ext, common)) {
    return '两个纯事实判断在 ' + PROBES.length + ' 组探针事实上的结论完全一致'
  }
  return null
}

/** 逐条自证：每条规则拿自带的样本跑判档，命中的必须是它自己。返回问题清单（空数组 = 通过）。 */
function selfProofProblems(rules, extensions, expectVia, where, api) {
  const bad = []
  rules.forEach((rule, i) => {
    const label = where + '[' + i + ']（' + rule.kind + '/' + rule.layer + '）'
    const hit = api.matchRule(rule.example, extensions)
    if (hit.rule !== rule) {
      const owner = hit.via === 'extension'
        ? '同一张扩展表的第 ' + extensions.indexOf(hit.rule) + ' 条'
        : '通用表里的另一条'
      bad.push(label + ' 的样本被判给了' + owner + '（' + hit.rule.kind + '/' + hit.rule.layer + '），不是它自己')
      return
    }
    if (hit.via !== expectVia) bad.push(label + ' 的样本走的是 ' + hit.via + '，期望 ' + expectVia)
    const judged = api.judgeFactsDetailed(rule.example, extensions)
    if (judged.kind !== rule.kind) bad.push(label + ' 判出的档位是 ' + judged.kind)
    if (judged.layer !== rule.layer) bad.push(label + ' 判出的层是 ' + judged.layer)
    if (judged.fallback !== (rule.layer === 'fallback')) bad.push(label + ' 的 fallback 标记是 ' + judged.fallback)
  })
  return bad
}

/** 顺序问题：层次不许倒退；兜底项只能一条，且必须是最后一条。返回问题清单。 */
function orderProblems(rules, layers) {
  const bad = []
  const posOf = (l) => layers.indexOf(l)
  for (let i = 1; i < rules.length; i++) {
    if (posOf(rules[i].layer) < posOf(rules[i - 1].layer)) {
      bad.push('第 ' + i + ' 条（' + rules[i].layer + '）排在第 ' + (i - 1) + ' 条（' + rules[i - 1].layer + '）之后，层次倒退了')
      break
    }
  }
  const fallbacks = rules.map((r, i) => (r.layer === 'fallback' ? i : -1)).filter((i) => i >= 0)
  if (fallbacks.length !== 1) bad.push('兜底项应当只有一条，实得 ' + fallbacks.length + ' 条')
  else if (fallbacks[0] !== rules.length - 1) bad.push('兜底项应当排在最后，实际在位置 ' + fallbacks[0] + '（表长 ' + rules.length + '）')
  return bad
}

/** 一条夹具应当报出的问题清单（空数组 = 这条夹具的档位、层、兜底标记都对）。 */
function sampleProblems(s, api) {
  const bad = []
  if (typeof s.text !== 'string' || !s.text) return [s.id + '：text 不是非空字符串']
  if (s.status !== undefined && typeof s.status !== 'number') return [s.id + '：status 给了却不是数字']
  if (!api.kindValues.has(s.expectKind)) return [s.id + '：期望档位 ' + s.expectKind + ' 不是八档之一']
  if (!LAYER_ORDER.includes(s.expectLayer)) return [s.id + '：期望层 ' + s.expectLayer + ' 不在层序里']
  const facts = { text: s.text }
  if (s.status !== undefined) facts.status = s.status
  if (s.errCode !== undefined) facts.errCode = s.errCode
  // 后端自带的样本要挂上那家的扩展表再判 —— 否则它本来就该掉进兜底层，断言等于白写
  const extRules = (s.via && api.extRulesByBackend[s.via]) || []
  const tableName = extRules.length ? (s.via + ' 扩展表 + 通用表') : '通用表'
  const hit = api.matchRule(facts, extRules)
  const hitWhere = hit.via === 'extension'
    ? '扩展表第 ' + extRules.indexOf(hit.rule) + ' 条'
    : '通用表第 ' + api.commonRules.indexOf(hit.rule) + ' 条'
  if (hit.rule.kind !== s.expectKind) bad.push(s.id + '：' + tableName + '判成 ' + hit.rule.kind + '（' + hitWhere + '），期望 ' + s.expectKind)
  if (s.expectVia && hit.via !== s.expectVia) {
    bad.push(s.id + '：应当由' + (s.expectVia === 'extension' ? '本家扩展表' : '通用表') + '认走，实际走的是 ' + hit.via + '（' + hitWhere + '）')
  }
  const judged = api.judgeFactsDetailed(facts, extRules)
  if (judged.kind !== s.expectKind) bad.push(s.id + '：judgeFactsDetailed 判成 ' + judged.kind + '，期望 ' + s.expectKind)
  if (judged.layer !== s.expectLayer) bad.push(s.id + '：判出的层是 ' + judged.layer + '，期望 ' + s.expectLayer)
  if (judged.fallback !== (s.expectLayer === 'fallback')) bad.push(s.id + '：fallback 标记为 ' + judged.fallback)
  return bad
}

/** 扫一个后端目录，找出它导出的扩展表（`export const XXX_RULES`），名字随各家改也不怕。 */
function discoverExtensionTables(dirRel) {
  const dir = path.join(ROOT, dirRel)
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(ts|js)$/.test(name) || /\.d\.ts$/.test(name)) continue
    const file = path.posix.join(dirRel, name)
    const src = readRel(file)
    const re = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*RULES)\b/g
    let m
    while ((m = re.exec(src))) out.push({ file, exportName: m[1] })
  }
  return out
}

async function main() {
  const rulesMod = await imp('src/tracker/kernel/error-rules.ts')
  const { COMMON_RULES, RULE_LAYERS, matchRule, judgeFactsDetailed } = rulesMod
  const samples = require('./fixtures/error-samples.js')

  // ── A 规则表自证 ──────────────────────────────────────────────────────────
  console.log('\nA 规则表自证（每条规则拿自带的样本跑判档，命中的必须是它自己）')
  check(Array.isArray(COMMON_RULES) && COMMON_RULES.length > 0, 'COMMON_RULES 存在且非空（共 ' + COMMON_RULES.length + ' 条）')
  const shapeBad = []
  COMMON_RULES.forEach((rule, i) => { shapeBad.push(...shapeProblems(rule, 'COMMON_RULES[' + i + ']')) })
  check(shapeBad.length === 0, '每条通用规则都配齐 kind/layer/when|pattern/example/note' + (shapeBad.length ? ' —— ' + shapeBad.join('；') : ''))

  let selfProofBad = selfProofProblems(COMMON_RULES, [], 'common', 'COMMON_RULES', { matchRule, judgeFactsDetailed })
  check(selfProofBad.length === 0, '逐条自证：每条规则的样本都命中它自己，且档位/层/兜底标记一致' + (selfProofBad.length ? ' —— ' + selfProofBad.join('；') : '（' + COMMON_RULES.length + ' 条）'))

  // ── B 顺序即文档 ──────────────────────────────────────────────────────────
  console.log('\nB 顺序与文档一致（顺序本身就是判据）')
  check(JSON.stringify(RULE_LAYERS) === JSON.stringify(LAYER_ORDER), 'RULE_LAYERS 等于写明的层序 ' + LAYER_ORDER.join(' → ') + '（实得 ' + RULE_LAYERS.join(' → ') + '）')

  const orderBad = orderProblems(COMMON_RULES, RULE_LAYERS)
  check(orderBad.length === 0, '表里的层次不倒退、兜底项是最后一条且只有一条' + (orderBad.length ? ' —— ' + orderBad.join('；') : ''))

  const adrText = readRel(ADR_PATH)
  const sec2 = adrText.slice(adrText.indexOf('## 2.'), adrText.indexOf('## 3.'))
  const item3 = sec2.split('\n').find((l) => /^3\.\s/.test(l)) || ''
  const docKeywords = [['fact', '结构化事实'], ['errcode', '错误码名'], ['phrase', '专有句式'], ['vague', '含糊短语'], ['fallback', '兜底']]
  let docOk = item3.length > 0
  let lastPos = -1
  const docSeen = []
  for (const [layer, keyword] of docKeywords) {
    const pos = item3.indexOf(keyword)
    if (pos < 0 || pos <= lastPos) { docOk = false; break }
    lastPos = pos
    docSeen.push(layer)
  }
  check(docOk && JSON.stringify(docSeen) === JSON.stringify(LAYER_ORDER),
    'ADR 第 2 节第 3 条写下的层序与代码一致（读到：' + (docSeen.join(' → ') || '读不出') + '）' + (docOk ? '' : ' —— 原文：' + JSON.stringify(item3.slice(0, 200))))

  // 表内也不许出现「同档位 + 同 pattern 源」的两条规则（第五份判据往往就从这里长出来）
  const dupInTable = []
  for (let i = 0; i < COMMON_RULES.length; i++) {
    for (let j = i + 1; j < COMMON_RULES.length; j++) {
      const reason = copyReason(COMMON_RULES[i], COMMON_RULES[j])
      if (reason) dupInTable.push('COMMON_RULES[' + i + '] 与 [' + j + ']：' + reason)
    }
  }
  check(dupInTable.length === 0, '通用表内部没有同档位同写法的重复项' + (dupInTable.length ? ' —— ' + dupInTable.join('；') : ''))

  // ── C 扩展项不许复制通用项 ────────────────────────────────────────────────
  console.log('\nC 扩展项不许复制通用项（防第五份判据）')
  // 后端名 → 它那张扩展表（D 段判后端自带样本时要挂上，否则样本会掉进兜底层）
  const extRulesByBackend = {}
  const roomDirs = fs.readdirSync(path.join(ROOT, 'src/tracker/rooms'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => 'src/tracker/rooms/' + e.name)
  for (const dirRel of roomDirs) {
    const backend = path.basename(dirRel)
    const tables = discoverExtensionTables(dirRel)
    if (tables.length === 0) {
      skip(backend + '：本后端没有自己的规则表（目录里没有 `export const …RULES` 形状的扩展项），这条就是「不适用」；'
        + '它判档时直接调跟踪器的 classifyError，所以没有可比的扩展项。这不是漏检：哪天它长出这样一张表，这里会自动认出并逐条自证')
      continue
    }
    for (const t of tables) {
      let extRules
      try {
        const mod = await imp(t.file)
        extRules = mod[t.exportName]
      } catch (e) {
        skip(backend + '：扩展表 ' + t.exportName + '（' + t.file + '）暂时读不进来 —— ' + String((e && e.message) || e))
        continue
      }
      if (!Array.isArray(extRules)) {
        skip(backend + '：' + t.file + ' 导出的 ' + t.exportName + ' 不是数组，没法逐条比')
        continue
      }
      const where = backend + ' 的 ' + t.exportName
      extRulesByBackend[backend] = extRules
      const problems = []
      extRules.forEach((rule, i) => { problems.push(...shapeProblems(rule, where + '[' + i + ']')) })
      check(problems.length === 0, where + ' 每条扩展项都配齐 kind/layer/when|pattern/example/note' + (problems.length ? ' —— ' + problems.join('；') : '（' + extRules.length + ' 条）'))

      const selfBad = selfProofProblems(extRules, extRules, 'extension', where, { matchRule, judgeFactsDetailed })
      check(selfBad.length === 0, where + ' 逐条自证：样本都命中自己且档位一致' + (selfBad.length ? ' —— ' + selfBad.join('；') : ''))

      const copies = []
      extRules.forEach((ext, i) => {
        COMMON_RULES.forEach((common, j) => {
          const reason = copyReason(ext, common)
          if (reason) copies.push(where + '[' + i + '] 与 COMMON_RULES[' + j + '] 同档位（' + ext.kind + '）' + reason)
        })
      })
      check(copies.length === 0, where + ' 里没有与通用项同档位同写法的条目' + (copies.length ? ' —— ' + copies.join('；') : ''))
    }
  }

  // ── D 真实原文夹具 ────────────────────────────────────────────────────────
  console.log('\nD 真实原文夹具（回归主证据，逐条断言档位）')
  const { ERROR_SAMPLES, SAMPLE_SOURCES, REQUIRED_REGRESSIONS } = samples
  const allowedSources = Object.values(SAMPLE_SOURCES)
  check(Array.isArray(ERROR_SAMPLES) && ERROR_SAMPLES.length > 0, '夹具表非空（共 ' + ERROR_SAMPLES.length + ' 条）')
  const vocabulary = await imp('src/tracker/contract/vocabulary.js')
  const kindValues = new Set(Object.values(vocabulary.ERROR_KIND || {}))

  const ids = ERROR_SAMPLES.map((s) => s.id)
  check(new Set(ids).size === ids.length, '夹具 id 不重复')
  const missingRegression = REQUIRED_REGRESSIONS.filter((id) => ids.indexOf(id) < 0)
  check(missingRegression.length === 0, '票面点名的实测错例都还在表里' + (missingRegression.length ? ' —— 缺：' + missingRegression.join('、') : '（' + REQUIRED_REGRESSIONS.join('、') + '）'))

  const provenanceBad = []
  const unsourced = []
  for (const s of ERROR_SAMPLES) {
    if (allowedSources.indexOf(s.source) < 0) provenanceBad.push(s.id + '：来源「' + String(s.source) + '」不在允许清单里')
    if (!s.trace) {
      if (!s.provenanceNote || s.provenanceNote.length < 10) provenanceBad.push(s.id + '：没有仓内出处（trace 为 null）却没写 provenanceNote')
      else unsourced.push(s.id)
      continue
    }
    if (!s.traceFile) { provenanceBad.push(s.id + '：给了 trace 却没给 traceFile'); continue }
    let src
    try { src = readRel(s.traceFile) } catch (e) { provenanceBad.push(s.id + '：出处的文件读不到 ' + s.traceFile); continue }
    if (src.indexOf(s.trace) < 0) provenanceBad.push(s.id + '：在 ' + s.traceFile + ' 里找不到它声称的原文片段')
  }
  check(provenanceBad.length === 0, '每条夹具都标了合法来源，规则样本类来源能在盘上逐字找到出处' + (provenanceBad.length ? ' —— ' + provenanceBad.join('；') : ''))
  if (unsourced.length) note('这几条夹具的来源是票面摘录、仓内没有第二处出处（已写 provenanceNote）：' + unsourced.join('、'))

  const sampleBad = []
  const sampleApi = { matchRule, judgeFactsDetailed, kindValues, extRulesByBackend, commonRules: COMMON_RULES }
  for (const s of ERROR_SAMPLES) sampleBad.push(...sampleProblems(s, sampleApi))
  check(sampleBad.length === 0, '每条真实原文夹具的档位与层都对得上' + (sampleBad.length ? ' —— ' + sampleBad.join('；') : '（' + ERROR_SAMPLES.length + ' 条）'))

  // 有后端归属的夹具，同时从后端自己的判档入口跑一遍（走「扩展 → 通用」那一趟）
  const backendBad = []
  const backendCache = {}
  for (const s of ERROR_SAMPLES) {
    if (!s.via) continue
    const file = s.via === 'github' ? 'src/tracker/rooms/github/errors.ts'
      : s.via === 'gitlab' ? 'src/tracker/rooms/gitlab/errors.ts' : null
    if (!file) { backendBad.push(s.id + '：via=' + s.via + ' 没有对应的判档入口'); continue }
    try {
      if (!backendCache[file]) {
        const mod = await imp(file)
        const fn = s.via === 'github' ? mod.classifyGhError : mod.classifyGlabError
        if (typeof fn !== 'function') throw new Error('模块里找不到判档入口函数')
        backendCache[file] = fn
      }
      const raw = { text: s.text }
      if (s.status !== undefined) raw.status = s.status
      if (s.errCode !== undefined) raw.code = s.errCode
      const out = backendCache[file](raw)
      const kind = typeof out === 'string' ? out : (out && out.kind)
      if (kind !== s.expectKind) backendBad.push(s.id + '：' + s.via + ' 入口判成 ' + String(kind) + '，期望 ' + s.expectKind)
    } catch (e) {
      backendBad.push(s.id + '：' + s.via + ' 入口跑不起来 —— ' + String((e && e.message) || e))
    }
  }
  check(backendBad.length === 0, '带后端归属的夹具从该后端判档入口跑，档位一致' + (backendBad.length ? ' —— ' + backendBad.join('；') : ''))

  // ── E 自证：这几条门禁本身有牙 ────────────────────────────────────────────
  console.log('\nE 自证：拿反例试这几条断言会不会红（不会红的门禁等于没写）')
  const api = { matchRule, judgeFactsDetailed }
  const commonUnsupported = COMMON_RULES.find((r) => r.kind === 'unsupported')
  const commonParse = COMMON_RULES.find((r) => r.kind === 'parse')
  if (commonUnsupported && commonParse) {
    // 这两条就是规则表自证门禁第一次跑时抓出来的真实缺陷：词表漏了真实写法，大意是
    // 「样本自己命中不了自己」。下面把当时的坏词表复原成一条扩展项，自证器必须当场报出来。
    const badUnsupported = Object.assign({}, commonUnsupported, { pattern: /not supported/i })
    const badParse = Object.assign({}, commonParse, { pattern: /parse|invalid json|syntax/i })
    const caughtUnsupported = selfProofProblems([badUnsupported], [badUnsupported], 'extension', '反例·unsupported', api)
    check(caughtUnsupported.length > 0, 'E1 反例：unsupported 词表收窄成只有 not supported 时，自证会红'
      + (caughtUnsupported.length ? '（' + caughtUnsupported[0] + '）' : ''))

    const caughtParse = selfProofProblems([badParse], [badParse], 'extension', '反例·parse', api)
    check(caughtParse.length > 0, 'E2 反例：parse 词表漏掉 unexpected token 时，自证会红'
      + (caughtParse.length ? '（' + caughtParse[0] + '）' : ''))
  } else {
    note('规则表里没有 unsupported / parse 这两档的规则，跳过这两条反例（它们本来是这张表的常驻档位）')
  }

  const orderReversed = orderProblems([COMMON_RULES[6], COMMON_RULES[0]], RULE_LAYERS)
  check(orderReversed.length > 0, 'E3 反例：把层序倒过来排，顺序断言会红' + (orderReversed.length ? '（' + orderReversed[0] + '）' : ''))
  const orderNoFallback = orderProblems(COMMON_RULES.slice(0, -1), RULE_LAYERS)
  check(orderNoFallback.length > 0, 'E4 反例：删掉兜底项，兜底断言会红' + (orderNoFallback.length ? '（' + orderNoFallback[0] + '）' : ''))

  const firstSample = ERROR_SAMPLES.find((s) => s.regression) || ERROR_SAMPLES[0]
  const wrongExpectation = Object.assign({}, firstSample, { expectKind: 'auth' })
  const caughtSample = sampleProblems(wrongExpectation, sampleApi)
  check(caughtSample.length > 0, 'E5 反例：把夹具的期望档位改错，夹具断言会红'
    + (caughtSample.length ? '（' + caughtSample[0] + '）' : ''))

  const emptySample = Object.assign({}, COMMON_RULES[0], { example: {} })
  const caughtEmpty = shapeProblems(emptySample, '反例·空样本')
  check(caughtEmpty.length > 0, 'E6 反例：把一条规则的样本换成空对象（对任何宽规则都"命中"），形状断言会红'
    + (caughtEmpty.length ? '（' + caughtEmpty[0] + '）' : ''))

  console.log('\n' + (failed
    ? '存在失败 — #1111 规则表自证门禁未通过'
    : '全部通过 — #1111 规则表自证 + 真实原文夹具（' + total + ' 项断言，' + skips + ' 项 SKIP，' + notes + ' 条 NOTE）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
