// verify-prompts.js — prompt 注册表契约校验（#573 收敛：五面扫描 + 外部豁免登记 + 归一化 + R1–R7）
// 用法:
//   node tests/verify-prompts.js                          默认：五面全扫（S1 真源 + S2 双产物 + S3 三后端 + S4 host 常量 + S5 渲染面）
//   node tests/verify-prompts.js <注册表文件>              单文件模式：只扫该文件的 S1（L2 机械注入用；S2/S3/S4 跳过）
//   node tests/verify-prompts.js --backend-probe=<文件>    用该文件替代 github 后端做 S3（L2 机械注入用）
//
// 判定分两层：
//   ① 结构契约（沿用 #461/#68/#69/#71/#72/#74/#75/#76/#77 的既有断言，陈旧的两组已按现状修正）
//   ② 提示词只许写脚本名加参数（#573 新增）：扫描五面 → 归一化 → 剥白名单脚本调用 → 跑 R1–R7
//
// 五面（缺一处即漏，见 .scratch/573-gate-design-v2.md §1.1）：
//   S1 src/client/kernel/prompts.js（求值解析，语法错误直接判红，不静默少扫）
//   S2 client.js / package/lib/client.js（正则解析 + id 集合与逐字段等于 S1）
//   S3 src/host/tracker/backends/{github,gitlab,markdown}/index.js 的 prompts 块（逐字符词法扫描，含拼接续段）
//   S4 src/host/**/*.js 的 *_PROMPT 常量
//   S5 S1 里含 {占位符} 的条目：占位符先求值（真实值 / 空串 / 哨兵三种展开）再判，另加「值形态」与「拆占位符拼装」两道
//
// 不扫（有意为之，见 §1.1）：docs/**（本来就该写具体命令）、tests/**、scripts/*.mjs、src/host 的代码注释与正则字面量。
//
// 豁免只有一张表，登记在 tests/prompt-gate-exempt.json（门禁只读它，代码里不留第二份）：
//   kind=rule  该条确实还写着具体跟踪器命令、属第二批范围 → 跳过判定（登记在案的债）
//   kind=scope 该条不属首批范围 → 门禁仍然判它，只是登记「不属首批」，所以 scope 不是放行口子
// 受保护清单 PROTECTED 里的条目（本票收敛过的）绝不许进豁免表 —— 这是防「换一条豁免整体放行」的变异自检。
const fs = require('fs')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')

const ROOT = path.join(__dirname, '..')
const SELF = path.join(__dirname, 'verify-prompts.js')
const EXEMPT_FILE = path.join(__dirname, 'prompt-gate-exempt.json')
const PAYLOAD_FILE = path.join(__dirname, 'prompt-gate-payloads.json')
const IS_CHILD = process.env.DSH_VERIFY_PROMPTS_CHILD === '1'

let failed = false
const problems = []
const fail = function (msg) { failed = true; problems.push(msg); return false }
const check = function (cond, msg) { if (!cond) { failed = true; problems.push(msg) } return !!cond }

// ==================== 0. 契约常量（硬编码，改动要走评审） ====================
const EXPECT_REGISTRY_ENTRIES = 20 // 注册表条目数（2026-09 现状；拆行/换引号不会让它少，因为 S1 用求值解析）
// S3 各后端 prompts 块顶层键数。v2 §1.1 写的是 7/9/6，实测不成立（gitlab 只有 4 键、markdown 只有 2 键），
// 这里按实测值硬编码并在失败信息里报出真实值，避免「按错值写断言导致永久红」。
const EXPECT_BACKEND_KEYS = { github: 7, gitlab: 4, markdown: 2 }
// S3 各后端 prompts 块内的字符串字面量总数（含字符串拼接的续段，如 ensureLabels 的命令就藏在续段里）。
// 这个数字是「词法扫描不许静默少扫」的硬保证：少扫一段就会对不上。
const EXPECT_BACKEND_LITERALS = { github: 42, gitlab: 8, markdown: 4 }
const EXPECT_HOST_PROMPT_CONSTS = 1 // src/host 全树 *_PROMPT 常量数（今天只有 GH_INSTALL_PROMPT）
const EXPECT_EXEMPT = 12 // 豁免登记条数硬编码（防偷偷加豁免）

// 受保护清单：本票（#573）收敛过的条目，绝不许出现在豁免表里
const PROTECTED = [
  'registry#mapExecute', 'registry#complete', 'registry#fixate', 'registry#bodyFormat',
  'registry#tpl.diagnose', 'registry#tpl.fix', 'registry#tpl.discuss', 'registry#tpl.research',
  'registry#tpl.prototype', 'registry#tpl.execute', 'registry#mapInspect', 'registry#newWayfinder',
  'backend:github#subIssue', 'S4#GH_INSTALL_PROMPT',
]

// ==================== 1. 归一化 + 判定式（.scratch/573-gate-design-v2.md §1.3 / §1.4） ====================
const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g
const QUOTES = /["'`´’‘“”]/g
// 零宽字符两种还原（删除 / 变空格）都要判：删掉会把 gh 与 issue 粘成 ghissue 反而放行，所以要两种都跑
const normVariants = function (s) {
  const base = String(s == null ? '' : s).normalize('NFKC')
  const out = []
  for (const zw of ['', ' ']) {
    let t = base.replace(ZW, zw).replace(QUOTES, '')
    t = t.replace(/\\\s*\n/g, ' ')
    t = t.replace(/\\[nrt]/g, ' ')
    t = t.replace(/\s+/g, ' ').trim().toLowerCase()
    if (out.indexOf(t) < 0) out.push(t)
  }
  return out
}

// 白名单：唯一允许出现的「命令」形态 = 两个脚本名加参数（占位符写法不锁死；接受 ./ 与反斜杠路径）
// 值 token 不得以 - 或 = 开头，也不得是另一个命令词，避免白名单吞掉后面的命令
const RE_ALLOWED_CALL = /(?:node|npx)\s+(?:\.\/|\.\\)?scripts[\/\\](?:fix-issue-body|wire-subissues)\.mjs(?:\s+--(?:issue|map|children|body-file|repo|dry-run)(?:\s*(?:=\s*)?(?![-=])(?!(?:gh|glab|npm|npx|node|curl|wget|cat|sh|bash)\b)\S+)?)*/g
const RE_TRACKER = /(?<![a-z0-9_\-])(?:gh|glab)(?![a-z0-9_])(?:[^a-z0-9_]{0,4})(?:issue|api|label|repo|pr|mr|milestone|project|sub_issues)(?![a-z0-9_])/
const RE_PKG = /(?:npm|npx|pnpm|yarn|corepack)\s+(?:exec|x|run|dlx)?[^\n]{0,24}?(?<![a-z0-9_\-])(?:gh|glab)(?![a-z0-9_])/
const RE_BARE_API = /(?:^|[^a-z0-9_])(?:https?:\/\/)?api\.(?:github|gitlab)\.com\b/
const RE_HEREDOC = /(?<![a-z0-9_])(?:cat|sh|bash|zsh|pwsh|powershell|node|python3?|ruby|perl)(?![a-z0-9_])[^\n]{0,60}<<[-~]?[a-z_][a-z0-9_]*/
const RE_SCRIPT = /(?<![a-z0-9_])(?:node|npx|npm\s+exec)\s+([a-z0-9_./\\-]+\.(?:mjs|js))(?![a-z0-9_])/g
const SCRIPT_WHITELIST = ['fix-issue-body.mjs', 'wire-subissues.mjs']
const RE_BODY_FLAG = /(?<![-\w])--body(?!-file)(?![a-z0-9_-])|(?<![-\w])-b(?![a-z0-9_-])/
const RE_CMD_CTX = /(?<![a-z0-9_])(?:gh|glab|curl|wget|node|npm|npx|pnpm|yarn|sh|bash|zsh|pwsh|powershell|cmd|python3?|ruby|perl|php)(?![a-z0-9_])/
// R7 混淆执行：红队报告 §3.2 E13 要求必抓（base64 -d 管道 / \xNN 转义 / eval 引号）。
// v2 §1.4 只写了 R1–R6，漏了这条；这里照红队建议正则补齐，实测 24 条误报仍全绿。
const RE_OBFUSCATED = /(?:base64\s+(?:-d|--decode))|(?:\\x[0-9a-f]{2})|(?:\beval\s+["'`$])/i
// 「拆占位符拼装」探测器：命令词由占位符值提供、子命令与动作词由模板字面量提供时才算命中。
// 只用来判「把命令词塞进占位符后能否拼出一条真的命令调用」，不参与常规判定（避免「个 issue 已关闭」这类同形词误红）。
const RE_ASSEMBLED = /(?<![a-z0-9_])(?:gh|glab)(?![a-z0-9_])(?:[^a-z0-9_]{0,4})(?:issue|api|label|repo|pr|mr|milestone|project|sub_issues)(?![a-z0-9_])(?:[^a-z0-9_]{0,4})(?:edit|create|view|list|close|comment|update|delete|add|set|reopen)\b/

const RULE_FIX = {
  R1: '模板里只许出现脚本名加参数：把具体跟踪器命令改写成「调 node scripts/fix-issue-body.mjs / wire-subissues.mjs」',
  R2: '不要经包管理器转发跟踪器命令（npm exec gh / npx gh）',
  R3: '不要直接打跟踪器 API 地址（api.github.com / api.gitlab.com）',
  R4: '正文一律走 --body-file 先写成文件，不把正文内联进命令行',
  R5: '不要用 heredoc 传正文，正文先写成文件再调脚本',
  R6: '只许调 fix-issue-body.mjs / wire-subissues.mjs 这两个脚本，别的脚本名不认',
  R7: '不要写混淆执行（base64 -d / \\x 转义 / eval 加引号）',
}

// 判定一个字符串：返回 [{rule, snippet}]，空数组 = 通过
const judge = function (text) {
  const raw = String(text == null ? '' : text)
  const hits = []
  const push = function (rule, hay, idx) {
    const from = Math.max(0, (idx || 0) - 30)
    hits.push({ rule: rule, snippet: String(hay).slice(from, from + 60).replace(/\s+/g, ' ') })
  }
  normVariants(raw).forEach(function (t) {
    const stripped = t.replace(RE_ALLOWED_CALL, '')
    let m
    if ((m = RE_TRACKER.exec(stripped)) !== null) push('R1', stripped, m.index)
    if ((m = RE_PKG.exec(stripped)) !== null) push('R2', stripped, m.index)
    if ((m = RE_BARE_API.exec(stripped)) !== null) push('R3', stripped, m.index)
    if ((m = RE_HEREDOC.exec(stripped)) !== null) push('R5', stripped, m.index)
    RE_SCRIPT.lastIndex = 0
    while ((m = RE_SCRIPT.exec(stripped)) !== null) {
      if (SCRIPT_WHITELIST.indexOf(m[1].split(/[\\/]/).pop()) < 0) push('R6', stripped, m.index)
    }
  })
  // R4 逐行判：归一化会把换行压成空格，所以按「原行」分别归一化后再判，保住行边界
  //   （否则一段说明文字里的 --body 会和下一行的 npx 被压成同一行，误判成内联正文）
  raw.split(/\r?\n/).forEach(function (line) {
    normVariants(line).forEach(function (nl) {
      if (RE_BODY_FLAG.test(nl) && /\s=?\s*\S/.test(nl) && RE_CMD_CTX.test(nl)) {
        const mm = RE_BODY_FLAG.exec(nl)
        push('R4', nl, mm ? mm.index : 0)
      }
    })
  })
  // R7 在原文上也判一次：归一化会剥引号，eval " 只在原文里看得见
  const seen = {}
  ;[raw].concat(normVariants(raw)).forEach(function (t) {
    if (seen[t]) return
    seen[t] = 1
    const m = RE_OBFUSCATED.exec(t)
    if (m) push('R7', t, m.index)
  })
  const uniq = []
  hits.forEach(function (h) { if (!uniq.some(function (u) { return u.rule === h.rule && u.snippet === h.snippet })) uniq.push(h) })
  return uniq
}

// 渲染：把文本里所有 {名字} 换成给定值（未给的名字按 fallback 处理）
const renderWith = function (text, values, fallback) {
  return String(text).replace(/\{(\w+)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : String(fallback)
  })
}
// S5：三种展开都判（真实值 / 空串 / 哨兵），任一份红即红
const judgeRendered = function (text, values) {
  const out = []
  out.push.apply(out, judge(renderWith(text, values, '')))
  out.push.apply(out, judge(renderWith(text, {}, '')))
  out.push.apply(out, judge(renderWith(text, {}, '\u0000')))
  return out
}
// S5 附加：「拆占位符拼装」探测用的探针值 —— 把命令词塞进单个占位符，看渲染后会不会拼出命令
const PLACEHOLDER_PROBES = ['gh', 'glab', 'node', 'curl', 'cat', 'npm', '--body']
// 取出文本里所有占位符名字（去重，保持出现顺序）
const placeholderNames = function (text) {
  const names = []
  String(text).replace(/\{(\w+)\}/g, function (m, n) { if (names.indexOf(n) < 0) names.push(n); return m })
  return names
}

// ==================== 2. 豁免登记表（外部文件 + 受保护清单 + 六条自检） ====================
const loadExempt = function () {
  const raw = JSON.parse(fs.readFileSync(EXEMPT_FILE, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw.entries || [])
  return list.map(function (e) { return Object.freeze(Object.assign({}, e)) })
}
const EXEMPT = loadExempt()
const exemptKey = function (surface, id) { return surface + '#' + id }
const ruleExemptIds = function (list, surface) {
  return list.filter(function (e) { return e.surface === surface && e.kind === 'rule' }).map(function (e) { return e.id })
}
const isRuleExempt = function (list, surface, id) { return ruleExemptIds(list, surface).indexOf(id) >= 0 }

// 纯函数：给定豁免表与各面 id 集，返回问题列表（主跑与变异自检都走它）
const auditExemptTable = function (list, surfaceIds, opts) {
  const out = []
  const o = opts || {}
  if (list.length !== EXPECT_EXEMPT) out.push('EXEMPT 条数 ' + list.length + '（期望硬编码 ' + EXPECT_EXEMPT + '；改豁免必须走评审）')
  // ① 形状：每条必须有 surface / id / kind / rule / reason
  list.forEach(function (e, i) {
    ;['surface', 'id', 'kind', 'rule', 'reason'].forEach(function (f) {
      if (!e || typeof e[f] !== 'string' || !e[f]) out.push('EXEMPT[' + i + '] 缺字段 ' + f + '（每条必须写清面、条目、类型、规则与理由）')
    })
    if (e && ['rule', 'scope'].indexOf(e.kind) < 0) out.push('EXEMPT[' + i + '] kind 只能是 rule 或 scope（实得 ' + String(e && e.kind) + '）')
  })
  // ② 存在性：豁免项必须真实存在
  list.forEach(function (e) {
    if (!e || !e.surface) return
    if (!surfaceIds[e.surface]) { out.push('EXEMPT 引用了不存在的扫描面：' + e.surface + '（' + e.id + '）'); return }
    if (surfaceIds[e.surface].indexOf(e.id) < 0) out.push('EXEMPT 引用了不存在的条目：' + e.surface + ' / ' + e.id)
  })
  // ③ 完备性：每个面「被扫 ∪ rule 豁免 == 全部」
  Object.keys(surfaceIds).forEach(function (surface) {
    const all = surfaceIds[surface]
    const exempt = ruleExemptIds(list, surface)
    const scanned = all.filter(function (id) { return exempt.indexOf(id) < 0 })
    const union = scanned.concat(exempt).filter(function (v, i, a) { return a.indexOf(v) === i })
    const missing = all.filter(function (id) { return union.indexOf(id) < 0 })
    const extra = union.filter(function (id) { return all.indexOf(id) < 0 })
    if (missing.length || extra.length || union.length !== all.length) {
      out.push('EXEMPT 完备性失败 ' + surface + '：全部 ' + all.length + '、被扫 ' + scanned.length + '、豁免 ' + exempt.length +
        (missing.length ? '、漏 ' + missing.join(',') : '') + (extra.length ? '、多 ' + extra.join(',') : ''))
    }
  })
  // ④ 受保护清单：本票收敛过的条目不许进豁免表（防「换一条豁免整体放行」）
  list.forEach(function (e) {
    if (!e || !e.surface) return
    if (PROTECTED.indexOf(exemptKey(e.surface, e.id)) >= 0) {
      out.push('EXEMPT 放行了本票收敛过的条目：' + e.surface + ' / ' + e.id + '（受保护清单里的条目绝不许豁免）')
    }
  })
  // ⑤ 与登记文件逐条相等（防止门禁里另留一份、或加载后被改写）
  if (o.fileEntries) {
    const a = JSON.stringify(list)
    const b = JSON.stringify(o.fileEntries)
    if (a !== b) out.push('EXEMPT 与 tests/prompt-gate-exempt.json 逐条不相等（门禁只许读登记文件，不许在代码里改）')
  }
  return out
}

// ==================== 3. 解析层 ====================
// S1 求值解析：去掉行首 export 后整段求值 —— 不受拆行 / 换引号 / 转义影响；语法错误直接抛（判红，不静默少扫）
const evalRegistrySource = function (src) {
  const body = String(src).replace(/^[ \t]*export[ \t]+/gm, '')
  const got = new Function(body + '\n;return { PROMPTS: PROMPTS };')()
  if (!got || !got.PROMPTS || typeof got.PROMPTS !== 'object') throw new Error('未取到 PROMPTS 对象')
  return got.PROMPTS
}
// 反隐藏：条目不许用不可枚举属性藏起来（Object.defineProperty / getter 都能绕过 Object.keys）
const auditRegistryShape = function (src, reg) {
  const out = []
  if (/\bdefinePropert(?:y|ies)\s*\(/.test(src)) out.push('S1 求值体含 defineProperty（可以用不可枚举属性藏条目，禁止）')
  if (/^\s*(?:get|set)\s+[A-Za-z_$]/m.test(src)) out.push('S1 求值体含对象 getter/setter（可以绕过求值，禁止）')
  const allKeys = Reflect.ownKeys(reg)
  if (allKeys.length !== Object.keys(reg).length) out.push('S1 注册表有不可枚举属性：Reflect.ownKeys ' + allKeys.length + ' ≠ Object.keys ' + Object.keys(reg).length)
  allKeys.forEach(function (k) {
    const e = reg[k]
    if (!e || typeof e !== 'object' || Array.isArray(e)) { out.push('S1 条目 ' + String(k) + ' 不是普通对象'); return }
    const proto = Object.getPrototypeOf(e)
    if (proto !== Object.prototype && proto !== null) out.push('S1 条目 ' + String(k) + ' 的原型不是 Object.prototype（可能被藏了东西）')
    if (Reflect.ownKeys(e).length !== Object.keys(e).length) out.push('S1 条目 ' + String(k) + ' 有不可枚举属性')
  })
  return out
}
// S2 正则解析（产物是整包，求值不现实）：忠实还原源码字符串字面量（与 tests/verify-prompt-newlines.js 同口径）
const unescapeLiteral = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === undefined) { out += c; continue }
    i++
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === '\\') out += '\\'
    else if (n === "'") out += "'"
    else if (n === '"') out += '"'
    else if (n === 'u') { const hex = s.slice(i + 1, i + 5); i += 4; out += String.fromCharCode(parseInt(hex, 16)) }
    else out += n
  }
  return out
}
// tests/verify-prompt-newlines.js:65 用的同一条单行正则（跨门禁一致性断言用）
const ENTRY_RE = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \},?$/gm
const parseRegistryByRegex = function (src) {
  const reg = {}
  const re = new RegExp(ENTRY_RE.source, 'gm')
  let m
  while ((m = re.exec(src)) !== null) {
    const ph = m[3] ? m[3].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean) : []
    reg[m[1]] = { version: Number(m[2]), placeholders: ph, use: m[4], zh: unescapeLiteral(m[5]), en: unescapeLiteral(m[6]) }
  }
  return reg
}

// ==================== 4. 词法扫描（S3 / S4 用；不用 [^']* 这类会被引号骗到的正则） ====================
// 取一段对象字面量：从 marker 后的第一个 { 到配对的 }，跳过字符串与注释
const extractObjectLiteral = function (src, marker) {
  const s = String(src)
  const at = s.indexOf(marker)
  if (at < 0) return null
  let i = s.indexOf('{', at)
  if (i < 0) return null
  let depth = 0
  let inS = null
  while (i < s.length) {
    const c = s[i]
    if (inS) {
      if (c === '\\') { i += 2; continue }
      if (c === inS) inS = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inS = c; i++; continue }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 2; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(at + marker.length, i + 1) }
    i++
  }
  return null
}
// 顶层键位置（2 或 4 空格缩进 + 名字 + : {）；用于把每个字面量归到它所属的键
const topLevelKeyPositions = function (block) {
  const out = []
  const re = /(?:^|\n) {2,4}([A-Za-z0-9_'\-]+):\s*\{/g
  let m
  while ((m = re.exec(block)) !== null) out.push({ name: m[1].replace(/['"]/g, ''), at: m.index })
  return out
}
const countTopLevelKeys = function (block) {
  return topLevelKeyPositions(block).map(function (k) { return k.name })
}
// 取某后端 prompts.subIssue 的 zh/en 声明值（S5 渲染面与注入链断言用）
const backendSubIssueValues = function (src) {
  const block = extractObjectLiteral(src, 'export const prompts')
  if (!block) return {}
  const sub = extractObjectLiteral(block, 'subIssue')
  if (!sub) return {}
  const out = {}
  const zh = /(?:^|[\s{,])zh:\s*'((?:[^'\\]|\\.)*)'/.exec(sub)
  const en = /(?:^|[\s{,])en:\s*'((?:[^'\\]|\\.)*)'/.exec(sub)
  if (zh) out.zh = unescapeLiteral(zh[1])
  if (en) out.en = unescapeLiteral(en[1])
  return out
}
// 扫描块内**全部**字符串字面量（含拼接续段）：注释跳过，字符串转义按 JS 语义还原。
// 注意：不能只认 `zh: '...'` 前缀 —— ensureLabels 的命令写在 `'a' + x + 'b'` 的第二段里，
// 按前缀归类会把续段整段漏掉（这正是「词法扫描静默少扫」）。
const scanAllLiterals = function (block) {
  const s = String(block)
  const keys = topLevelKeyPositions(s)
  const out = []
  let i = 0
  const ownerOf = function (idx) {
    let name = ''
    keys.forEach(function (k) { if (k.at < idx) name = k.name })
    return name
  }
  while (i < s.length) {
    const c = s[i]
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      let val = ''
      let j = i + 1
      while (j < s.length) {
        const d = s[j]
        if (d === '\\') { val += d + (s[j + 1] === undefined ? '' : s[j + 1]); j += 2; continue }
        if (d === quote) break
        val += d
        j++
      }
      out.push({ key: ownerOf(i), text: unescapeLiteral(val) })
      i = j + 1
      continue
    }
    i++
  }
  return out
}

// ==================== 5. 五面扫描（返回问题数组，主跑与变异自检共用） ====================
const surfaceReport = { S1: 0, S2: [0, 0], S3: [], S4: 0, S5: 0, exempt: EXEMPT.length }
const BACKENDS = ['github', 'gitlab', 'markdown']
const backendPath = function (id, probe) {
  if (id === 'github' && probe) return probe
  return path.join(ROOT, 'src/host/tracker/backends', id, 'index.js')
}
const backendLabel = function (id, probe) {
  return (id === 'github' && probe) ? probe : 'src/host/tracker/backends/' + id + '/index.js'
}
const failLine = function (where, rule, snippet, raw) {
  return 'FAIL ' + where + ' [' + rule + '] 命中「' + snippet + '」' +
    (raw ? '\n     原文本（运行时）：' + String(raw).slice(0, 120) : '') +
    '\n     修法：' + RULE_FIX[rule] + '；如需放行，只能进 tests/prompt-gate-exempt.json 并写明理由'
}

// —— S1 + S5 ——
const collectRegistry = function (reg, label, ctx, exemptList) {
  const out = []
  const ids = Object.keys(reg)
  const idsScanned = []
  let rendered = 0
  ids.forEach(function (id) {
    if (isRuleExempt(exemptList, 'registry', id)) return
    idsScanned.push(id)
    const e = reg[id] || {}
    ;['zh', 'en', 'use'].forEach(function (field) {
      judge(e[field]).forEach(function (h) { out.push(failLine(label + ' ' + id + '.' + field, h.rule, h.snippet, e[field])) })
    })
    ;(Array.isArray(e.placeholders) ? e.placeholders : []).forEach(function (ph) {
      judge(ph).forEach(function (h) { out.push(failLine(label + ' ' + id + '.placeholders[' + ph + ']', h.rule, h.snippet, ph)) })
    })
    const names = placeholderNames(String(e.zh || '') + String(e.en || ''))
    if (names.length) {
      rendered++
      // ① 占位符名字本身
      names.forEach(function (n) {
        judge(n).forEach(function (h) { out.push(failLine(label + ' ' + id + '.placeholders 名字 ' + n, h.rule, h.snippet, n)) })
      })
      // ② 每个声明值单独判 + 值不许含换行（含换行就能把一条命令拆成两行注入）
      Object.keys(ctx.subIssueValues).forEach(function (k) {
        const v = String(ctx.subIssueValues[k])
        judge(v).forEach(function (h) { out.push(failLine(label + ' ' + id + ' 的占位符值(' + k + ')', h.rule, h.snippet, v)) })
        if (/[\r\n]/.test(v)) out.push('FAIL ' + label + ' ' + id + ' 的占位符值(' + k + ')含换行：值不许把模板拆行\n     修法：声明值必须是单行')
      })
      judge('owner/name').forEach(function (h) { out.push(failLine(label + ' ' + id + ' 的占位符值(repo)', h.rule, h.snippet, 'owner/name')) })
      // ③ 拆占位符拼装探测：把命令词塞进单个占位符，若渲染后拼出一条真的命令调用即红
      names.forEach(function (n) {
        PLACEHOLDER_PROBES.forEach(function (probe) {
          const one = {}
          one[n] = probe
          ;['zh', 'en'].forEach(function (lang) {
            const rendered = renderWith(e[lang], one, '')
            const m = RE_ASSEMBLED.exec(rendered)
            if (m) {
              out.push('FAIL ' + label + ' ' + id + '.' + lang + ' 占位符 {' + n + '} 代入「' + probe + '」后 [ASSEMBLE] 拼出命令「' +
                rendered.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ') + '」\n' +
                '     修法：模板不许把命令词交给占位符，也不许让占位符紧邻子命令词；改成调 node scripts/fix-issue-body.mjs / wire-subissues.mjs')
            }
          })
        })
      })
      // ④ 三种展开：真实值 / 空串 / 哨兵
      Object.keys(ctx.subIssueValues).forEach(function (k) {
        const vals = { repo: 'owner/name', subIssue: ctx.subIssueValues[k] }
        ;['zh', 'en'].forEach(function (lang) {
          judgeRendered(e[lang], vals).forEach(function (h) {
            out.push(failLine(label + ' ' + id + '.' + lang + '(渲染 ' + k + ')', h.rule, h.snippet, ''))
          })
        })
      })
    }
  })
  return { problems: out, scanned: idsScanned.length, idsScanned: idsScanned, rendered: rendered }
}

// —— S3 ——
const collectBackend = function (backendId, src, label, exemptList) {
  const block = extractObjectLiteral(src, 'export const prompts')
  if (!block) return { problems: ['FAIL S3 ' + label + ' 找不到 export const prompts 块（扫描面缺失）'], keys: [], literals: 0, found: false }
  const literals = scanAllLiterals(block)
  const keys = countTopLevelKeys(block)
  const out = []
  literals.forEach(function (lit) {
    if (!lit.key || isRuleExempt(exemptList, 'backend:' + backendId, lit.key)) return
    judge(lit.text).forEach(function (h) { out.push(failLine('S3 ' + label + ' ' + lit.key, h.rule, h.snippet, lit.text)) })
  })
  return { problems: out, keys: keys, literals: literals.length, found: true }
}

// —— S4 ——
const walkJs = function (dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walkJs(p, acc)
    else if (d.name.endsWith('.js')) acc.push(p)
  })
  return acc
}
const collectHost = function (exemptList) {
  const out = []
  const found = []
  walkJs(path.join(ROOT, 'src/host'), []).forEach(function (file) {
    const src = fs.readFileSync(file, 'utf8')
    const re = /const\s+([A-Za-z0-9_$]*PROMPT[A-Za-z0-9_$]*)\s*=\s*'((?:[^'\\]|\\.)*)'/g
    let m
    while ((m = re.exec(src)) !== null) found.push({ file: path.relative(ROOT, file), name: m[1], text: unescapeLiteral(m[2]) })
  })
  found.forEach(function (c) {
    if (isRuleExempt(exemptList, 'S4', c.name)) return
    judge(c.text).forEach(function (h) { out.push(failLine('S4 ' + c.file + ' ' + c.name, h.rule, h.snippet, c.text)) })
  })
  return { problems: out, consts: found }
}

// ==================== 6. 结构契约断言（沿用既有，陈旧两组已修正） ====================
const contractChecks = function (reg, src) {
  const before = problems.length
  const P = function (cond, msg) { if (!cond) fail(msg) }

  Object.keys(reg).forEach(function (id) {
    const p = reg[id]
    P(p.version >= 1, id + ' 缺 version')
    P(!!p.zh && !!p.en, id + ' 缺 zh/en')
    P(!!p.use, id + ' 缺 use')
    const found = []
    const re = /\{(\w+)\}/g
    let mm
    while ((mm = re.exec(String(p.zh))) !== null) if (found.indexOf(mm[1]) < 0) found.push(mm[1])
    found.forEach(function (x) { if (p.placeholders.indexOf(x) < 0) fail(id + ' 文本含未声明占位符 {' + x + '}') })
    p.placeholders.forEach(function (x) { if (found.indexOf(x) < 0) fail(id + ' 声明占位符 {' + x + '} 但文本未使用') })
  })
  const useRe = /promptText\('([a-zA-Z0-9.]+)'/g
  let mu
  while ((mu = useRe.exec(src)) !== null) { if (!reg[mu[1]]) fail('引用不存在的 prompt id: ' + mu[1]) }
  ;["tr('prompt.", "'prompt.'"].forEach(function (bad) { if (src.includes(bad)) fail('旧字典引用残留 ' + bad) })

  // 版本号 bump（#573 §2.7 逐条清单；只许升不许降）
  const V_MIN = {
    mapExecute: 6, complete: 6, fixate: 3, 'tpl.diagnose': 7, 'tpl.fix': 4, 'tpl.discuss': 4,
    'tpl.research': 2, 'tpl.prototype': 2, 'tpl.execute': 6, mapInspect: 3, newWayfinder: 14,
    bodyFormat: 4, setupRun: 9, progress: 3,
  }
  Object.keys(V_MIN).forEach(function (id) {
    const p = reg[id]
    if (!p) fail('契约缺条目 ' + id)
    else if (p.version < V_MIN[id]) fail('版本号未 bump ' + id + ' v' + p.version + '（期望 ≥ v' + V_MIN[id] + '）')
  })
  ;['guide', 'grill', 'newMap', 'mapHead', 'stageGate'].forEach(function (id) {
    if (reg[id]) fail('#77 已删条目复活 ' + id)
  })
  if (/STAGE_GATED_IDS\s*=/.test(src)) fail('#77 残留 STAGE_GATED_IDS 声明（应随 stageGate 入口一并删除）')
  if (src.includes("promptText('stageGate')")) fail("#77 残留 promptText('stageGate') 调用")
  if (src.includes('STAGE_GATED_IDS.indexOf(id) >= 0')) fail('#77 残留 renderTemplate 闸门追加逻辑')
  if (src.includes("text.indexOf('阶段闸门')") || src.includes("text.indexOf('Stage gate')")) fail('#77 残留 renderTemplate 去重守卫（闸门已内联，无外挂可去重）')

  // mapExecute（#68 清单式）
  const me = reg['mapExecute']
  if (me) {
    if (me.zh.indexOf('阶段闸门') < 0 || me.en.indexOf('stage-gate') < 0) fail('T13 mapExecute 未含阶段闸门引用（needs-triage 先诊断）')
    if (me.zh.indexOf('needs-triage') < 0) fail('mapExecute zh 缺 needs-triage 标记')
    if (me.zh.indexOf('- [ ]') < 0) fail('mapExecute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (me.zh.indexOf('## 目标 map') < 0 || me.zh.indexOf('## 分析') < 0 || me.zh.indexOf('## 选票') < 0 || me.zh.indexOf('## 执行') < 0 || me.zh.indexOf('## 收尾') < 0 || me.zh.indexOf('## 正文格式') < 0) fail('mapExecute zh 缺清单段标题（目标 map/分析/选票/执行/收尾/正文格式）')
    if (me.zh.indexOf('|') >= 0) fail('mapExecute zh 含表格 |（已约定无表格，全勾选框）')
    if (me.zh.indexOf('编号：') < 0 || me.zh.indexOf('标题：') < 0 || me.zh.indexOf('链接：') < 0) fail('mapExecute zh 缺 map 标识头三字段（编号/标题/链接）')
    if (me.placeholders.indexOf('n') < 0 || me.placeholders.indexOf('title') < 0 || me.placeholders.indexOf('url') < 0) fail('mapExecute 占位符缺 n/title/url（自包含 map 标识）')
    if (me.en.indexOf('- [ ]') < 0) fail('mapExecute en 缺清单标记 - [ ]')
    if (me.en.indexOf('## Target map') < 0 || me.en.indexOf('## Analyze') < 0 || me.en.indexOf('## Pick the ticket') < 0 || me.en.indexOf('## Execute') < 0 || me.en.indexOf('## Wrap-up') < 0) fail('mapExecute en 缺清单段标题（Target map/Analyze/Pick the ticket/Execute/Wrap-up）')
  }
  // tpl.execute（#64 清单式）
  const ex = reg['tpl.execute']
  if (ex) {
    if (ex.zh.indexOf('- [ ]') < 0) fail('tpl.execute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (ex.zh.indexOf('## 读现状') < 0 || ex.zh.indexOf('## 阶段闸门') < 0 || ex.zh.indexOf('## 收尾') < 0 || ex.zh.indexOf('## 正文格式') < 0) fail('tpl.execute zh 缺清单四段标题（读现状/阶段闸门/收尾/正文格式）')
    if (ex.zh.indexOf('|') >= 0) fail('tpl.execute zh 含表格 |（已约定无表格，全勾选框）')
    if (ex.en.indexOf('- [ ]') < 0) fail('tpl.execute en 缺清单标记 - [ ]')
  }
  // tpl.diagnose（#65 清单式 · 诊断≠修复）
  const di = reg['tpl.diagnose']
  if (di) {
    if (di.zh.indexOf('- [ ]') < 0) fail('tpl.diagnose zh 缺清单标记 - [ ]（A★ 清单式）')
    if (di.zh.indexOf('## 弄清现象') < 0 || di.zh.indexOf('## 根因候选') < 0 || di.zh.indexOf('## 分流建议') < 0 || di.zh.indexOf('## 阶段闸门') < 0 || di.zh.indexOf('## 正文格式') < 0) fail('tpl.diagnose zh 缺清单段标题（弄清现象/根因候选/分流建议/阶段闸门/正文格式）')
    if (di.zh.indexOf('|') >= 0) fail('tpl.diagnose zh 含表格 |（已约定无表格，全勾选框）')
    if (di.zh.indexOf('诊断≠修复') < 0) fail('tpl.diagnose zh 缺诊断≠修复显式（第一性原理）')
    if (di.zh.indexOf('grilling') < 0) fail('tpl.diagnose zh 缺 grill 澄清句')
    if (di.zh.indexOf('与 grill 片段同义') >= 0) fail('tpl.diagnose zh 残留悬空括注「与 grill 片段同义」（#77 grill 入口已删）')
    if (di.en.indexOf('- [ ]') < 0) fail('tpl.diagnose en 缺清单标记 - [ ]')
    if (di.en.indexOf('diagnosis') < 0 || di.en.indexOf('Stage gate') < 0) fail('tpl.diagnose en 缺关键段（diagnosis/Stage gate）')
    if (di.en.indexOf('What are the symptoms') < 0 || di.en.indexOf('What is the impact') < 0) fail('tpl.diagnose en 缺 Symptoms 三行拆分')
    if (di.en.indexOf('grill snippet') >= 0) fail('tpl.diagnose en 残留 grill snippet 引用（#77 grill 入口已删）')
  }
  // newWayfinder（#77 v8 + #573 v14 子议题关联收敛）
  const nw = reg['newWayfinder']
  if (nw) {
    if (nw.zh.indexOf('按建图规划契约') >= 0) fail('newWayfinder zh 残留「按建图规划契约」名称引用（#77 契约已删，改直述新建 map）')
    if (nw.en.indexOf('per the planning contract') >= 0) fail('newWayfinder en 残留 planning contract 名称引用（#77 契约已删，改直述新建 map）')
    if (nw.zh.indexOf('- [ ]') < 0) fail('newWayfinder zh 缺清单标记 - [ ]（A★ 清单式）')
    if (nw.zh.indexOf('## 澄清') < 0 || nw.zh.indexOf('## 判断分类') < 0 || nw.zh.indexOf('## 自查') < 0) fail('newWayfinder zh 缺清单段标题（澄清/判断分类/自查）')
    if (nw.zh.indexOf('|') >= 0) fail('newWayfinder zh 含表格 |（已约定无表格，全勾选框）')
    if (nw.zh.indexOf('写出 map：Destination + Notes + plan') < 0) fail('newWayfinder zh 缺新增子清单（写出 map：Destination + Notes + plan）')
    // #573 修正（原断言「以 sub-issue 关联到」已随文本收敛失效）：
    //   --children 只活在后端 prompts.subIssue 里、运行期经 {subIssue} 注入，模板里断言不到（事实核对报告 E6）。
    if (nw.zh.indexOf('{subIssue}') < 0) fail('newWayfinder zh 缺占位符 {subIssue}（子议题关联脚本由后端声明注入）')
    if (nw.en.indexOf('{subIssue}') < 0) fail('newWayfinder en 缺占位符 {subIssue}')
    if (nw.zh.indexOf('Blocked by: #<n>') < 0) fail('newWayfinder zh 缺新增子清单（Blocked by: #<n> 降级兜底写法）')
    if (nw.zh.indexOf('降级兜底') < 0) fail('newWayfinder zh 未写明 Blocked by 行只是降级兜底（原生依赖边为准）')
    if (nw.zh.indexOf('## Destination') < 0) fail('newWayfinder zh 缺「先取 map 现有正文（保留 ## Destination）」这一步（wire-subissues 脚本 exit 2 前置条件）')
    if (nw.zh.indexOf('逐项核对上面') < 0) fail('newWayfinder zh 缺自查指令（逐项核对清单）')
    if (nw.en.indexOf('- [ ]') < 0) fail('newWayfinder en 缺清单标记 - [ ]')
    if (nw.en.indexOf('## Clarify') < 0 || nw.en.indexOf('## Decide the case') < 0 || nw.en.indexOf('## Self-check') < 0) fail('newWayfinder en 缺清单段标题（Clarify/Decide the case/Self-check）')
    if (nw.en.indexOf('## Self-check') >= 0 && nw.en.indexOf('verify the checklist') < 0) fail('newWayfinder en 缺自查指令（verify the checklist）')
    if (nw.en.indexOf('## Destination') < 0) fail('newWayfinder en 缺 keep the ## Destination section（脚本前置条件）')
  }
  // complete（#69 清单式）
  const co = reg['complete']
  if (co) {
    if (co.version < 5) fail('complete 版本号未 bump（期望 ≥ v5）')
    if (co.zh.indexOf('- [ ]') < 0) fail('complete zh 缺清单标记 - [ ]（A★ 清单式）')
    if (co.zh.indexOf('## MAP完成确认') < 0 || co.zh.indexOf('## 调查') < 0 || co.zh.indexOf('## 报告你来定夺') < 0 || co.zh.indexOf('## 收尾') < 0 || co.zh.indexOf('## 正文格式') < 0) fail('complete zh 缺清单段标题（MAP完成确认/调查/报告你来定夺/收尾/正文格式）')
    if (co.zh.indexOf('|') >= 0) fail('complete zh 含表格 |（已约定无表格，全勾选框）')
    if (co.zh.indexOf('子票') >= 0 || co.zh.indexOf('票') >= 0) fail('complete zh 专业术语未用英文（子票/票 → sub-issue/ticket）')
    if (co.zh.indexOf('## 目标 map') < 0 || co.zh.indexOf('编号：') < 0 || co.zh.indexOf('标题：') < 0 || co.zh.indexOf('链接：') < 0) fail('complete zh 缺 map 标识头三字段')
    if (co.placeholders.indexOf('closed') < 0 || co.placeholders.indexOf('total') < 0) fail('complete 占位符缺 closed/total')
    if (co.placeholders.indexOf('n') < 0 || co.placeholders.indexOf('title') < 0 || co.placeholders.indexOf('url') < 0) fail('complete 占位符缺 n/title/url')
    if (co.zh.indexOf('从第一性原理出发完成任务') >= 0) fail('complete zh 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('Approach tasks from first principles') >= 0) fail('complete en 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('- [ ]') < 0) fail('complete en 缺清单标记 - [ ]')
    if (co.en.indexOf('## MAP completion check') < 0 || co.en.indexOf('## Investigate') < 0 || co.en.indexOf('## Report to you') < 0 || co.en.indexOf('## Wrap-up') < 0) fail('complete en 缺清单段标题')
  } else fail('缺条目 complete')
  // handoff1/handoff2（#71）
  const h1 = reg['tpl.handoff1']
  if (h1) {
    if (h1.version < 3) fail('tpl.handoff1 版本号未 bump（期望 ≥ v3）')
    if (h1.zh.indexOf('短标题') < 0) fail('tpl.handoff1 zh 缺短标题指令（{ts}-<短标题>.md）')
    if (h1.en.indexOf('<short>') < 0) fail('tpl.handoff1 en 缺短标题指令（{ts}-<short>.md）')
  } else fail('缺条目 tpl.handoff1')
  const h2 = reg['tpl.handoff2']
  if (h2) {
    if (h2.version < 3) fail('tpl.handoff2 版本号未 bump（期望 ≥ v3）')
    if (h2.zh.indexOf('- [ ]') < 0) fail('tpl.handoff2 zh 缺清单标记 - [ ]（A★ 清单式）')
    if (h2.zh.indexOf('## 复述理解') < 0 || h2.zh.indexOf('## 继续推进') < 0) fail('tpl.handoff2 zh 缺清单段标题（复述理解/继续推进）')
    if (h2.zh.indexOf('|') >= 0) fail('tpl.handoff2 zh 含表格 |（已约定无表格，全勾选框）')
    if (h2.zh.indexOf('/read') >= 0) fail('tpl.handoff2 zh 仍含 /read 命令（DSH 无此命令，需通用语句）')
    if (h2.zh.indexOf('{path}') < 0) fail('tpl.handoff2 zh 未用 {path} 绝对路径占位符')
    if (h2.en.indexOf('- [ ]') < 0) fail('tpl.handoff2 en 缺清单标记 - [ ]')
    if (h2.en.indexOf('{path}') < 0) fail('tpl.handoff2 en 未用 {path} 绝对路径占位符')
  } else fail('缺条目 tpl.handoff2')
  if (reg['handoffRead']) fail('handoffRead 未塌缩删除（应只剩 tpl.handoff2 单模板）')
  // fixate（#72）
  const fx = reg['fixate']
  if (fx) {
    if (fx.version < 2) fail('fixate 版本号未 bump（期望 ≥ v2）')
    if (fx.zh.indexOf('- [ ]') < 0) fail('fixate zh 缺清单标记 - [ ]（A★ 清单式）')
    if (fx.zh.indexOf('## 沉淀') < 0 || fx.zh.indexOf('## 可疑遗漏') < 0 || fx.zh.indexOf('## 核对') < 0 || fx.zh.indexOf('## 落盘') < 0 || fx.zh.indexOf('## 正文格式') < 0) fail('fixate zh 缺清单段标题（沉淀/可疑遗漏/核对/落盘/正文格式）')
    if (fx.zh.indexOf('|') >= 0) fail('fixate zh 含表格 |（已约定无表格，全勾选框）')
    if (fx.zh.indexOf('思维对齐 · 成果沉淀') < 0) fail('fixate zh 缺新命名（思维对齐 · 成果沉淀，旧名「零丢失快照」已退役）')
    if (fx.zh.indexOf('零丢失') >= 0) fail('fixate zh 残留旧命名「零丢失」')
    if (fx.zh.indexOf('对齐成果') < 0 || fx.zh.indexOf('.scratch/alignment/') < 0) fail('fixate zh 缺落盘分支契约（对齐成果 / .scratch/alignment/）')
    if (fx.zh.indexOf('ticket') < 0 || fx.zh.indexOf('map') < 0) fail('fixate zh 缺术语（ticket/map，专业术语英文）')
    if (fx.en.indexOf('- [ ]') < 0) fail('fixate en 缺清单标记 - [ ]')
    if (fx.en.indexOf('## Consolidate') < 0 || fx.en.indexOf('## Suspected omissions') < 0 || fx.en.indexOf('## Review') < 0 || fx.en.indexOf('## Persist') < 0) fail('fixate en 缺清单段标题（Consolidate/Suspected omissions/Review/Persist）')
    if (fx.en.indexOf('alignment & consolidation') < 0) fail('fixate en 缺新命名（alignment & consolidation）')
  } else fail('缺条目 fixate')
  // installSkills（#74 + #fix-banner 修正）
  //   #573 修正（原 SKILL_NAMES_10 清单已过时）：技能名真源是 src/shared/matt-skills.js（25 项），
  //   由已在 verify 链里的 tests/verify-matt-skills-sync.js 第 4 条卡住「installSkills prompt 用 {probeList} + {probeCount} 占位符」；
  //   本门禁只断言模板侧的两个占位符与安装目录，不重复维护技能名清单（避免第二份名单漂移）。
  const is = reg['installSkills']
  if (is) {
    if (is.version < 2) fail('installSkills 版本号未 bump（期望 ≥ v2）')
    if (is.zh.indexOf('~/.agents/skills') < 0) fail('installSkills zh 缺安装目录 ~/.agents/skills')
    if (is.en.indexOf('~/.agents/skills') < 0) fail('installSkills en 缺安装目录 ~/.agents/skills')
    if (is.zh.indexOf('{probeList}') < 0 || is.zh.indexOf('{probeCount}') < 0) fail('installSkills zh 缺动态注入占位符（{probeList} / {probeCount}，技能名清单由 shared/matt-skills.js 单源注入）')
    if (is.en.indexOf('{probeList}') < 0 || is.en.indexOf('{probeCount}') < 0) fail('installSkills en 缺动态注入占位符（{probeList} / {probeCount}）')
  } else fail('缺条目 installSkills')
  // progress（#75）
  const pr = reg['progress']
  if (pr) {
    if (pr.version < 3) fail('progress 版本号未 bump（期望 ≥ v3）')
    if (pr.placeholders.length !== 0) fail('progress 不应有占位符')
    if (pr.zh.indexOf('## 进度：N%') < 0) fail('progress zh 缺固定进度区格式（## 进度：N%）')
    if (pr.zh.indexOf('## 进度：90%') < 0) fail('progress zh 缺格式正例（如 ## 进度：90%）')
    if (pr.zh.indexOf('可上调也可下调') < 0) fail('progress zh 缺可上调可下调（真实当前值）')
    if (pr.zh.indexOf('0% = 未动工') < 0 || pr.zh.indexOf('1-94% = 进行中') < 0) fail('progress zh 缺阶梯 0%/1-94% 定义')
    if (pr.zh.indexOf('未确认不得 close') < 0) fail('progress zh 缺未确认不得 close（防 close@95% 违规）')
    if (pr.zh.indexOf('确认后立即写 100% 并 close') < 0) fail('progress zh 缺确认后 100% + close')
    if (pr.zh.indexOf('close 后进度区保留为历史') < 0) fail('progress zh 缺 close 后保留为历史')
    if (pr.zh.indexOf('首次接触') < 0 || pr.zh.indexOf('实施记录相符') < 0) fail('progress zh 缺首触补写兜底（首次接触 / 实施记录相符）')
    if (pr.en.indexOf('## Progress: N%') < 0) fail('progress en 缺固定进度区格式（## Progress: N%）')
    if (pr.en.indexOf('## Progress: 90%') < 0) fail('progress en 缺格式正例')
    if (pr.en.indexOf('may go up or down') < 0) fail('progress en 缺 may go up or down')
    if (pr.en.indexOf('do not close before confirmation') < 0) fail('progress en 缺 do not close before confirmation')
    if (pr.en.indexOf('stays as history after close') < 0) fail('progress en 缺 stays as history after close')
    if (pr.en.indexOf('first contact') < 0 || pr.en.indexOf('implementation record') < 0) fail('progress en 缺首触补写兜底')
  } else fail('缺条目 progress')
  // bodyFormat v4（#76 契约 + #573 收敛：不再卡「正例/反例/字面 \n」，改卡「脚本名 + 三个参数名 + 不点名具体命令」）
  const bf = reg['bodyFormat']
  if (bf) {
    if (bf.version < 4) fail('bodyFormat 版本号未 bump（期望 ≥ v4）')
    if (bf.placeholders.length !== 0) fail('bodyFormat 不应有占位符')
    if (bf.zh.indexOf('每个 `## 章节` 独占一行') < 0) fail('bodyFormat zh 缺「每个 ## 章节 独占一行」（结构规则）')
    if (bf.zh.indexOf('段落间留空行') < 0) fail('bodyFormat zh 缺段落间留空行')
    if (bf.zh.indexOf('先写成文件') < 0) fail('bodyFormat zh 缺「正文先写成文件」')
    if (bf.zh.indexOf('node scripts/fix-issue-body.mjs') < 0) fail('bodyFormat zh 缺写回脚本名（node scripts/fix-issue-body.mjs）')
    if (bf.zh.indexOf('--issue') < 0 || bf.zh.indexOf('--body-file') < 0) fail('bodyFormat zh 缺脚本参数名（--issue / --body-file）')
    if (bf.zh.indexOf('不要把正文拼进命令行') < 0) fail('bodyFormat zh 缺「不要把正文拼进命令行」')
    if (bf.zh.indexOf('格式只告警不改写') < 0) fail('bodyFormat zh 缺「格式只告警不改写」（脚本职责边界）')
    if (bf.zh.indexOf('反斜杠加 n 两个字符') < 0) fail('bodyFormat zh 缺「换行不要写成反斜杠加 n 两个字符」')
    if (bf.en.indexOf('each `## section` on its own line') < 0) fail('bodyFormat en 缺 each ## section on its own line')
    if (bf.en.indexOf('blank line between paragraphs') < 0) fail('bodyFormat en 缺 blank line between paragraphs')
    if (bf.en.indexOf('node scripts/fix-issue-body.mjs') < 0) fail('bodyFormat en 缺写回脚本名')
    if (bf.en.indexOf('--issue') < 0 || bf.en.indexOf('--body-file') < 0) fail('bodyFormat en 缺脚本参数名（--issue / --body-file）')
    if (bf.en.indexOf('never inline the body into the command line') < 0) fail('bodyFormat en 缺 never inline the body into the command line')
    if (bf.en.indexOf('only warns about formatting') < 0) fail('bodyFormat en 缺 only warns about formatting')
    if (bf.en.indexOf('two characters backslash-n') < 0) fail('bodyFormat en 缺 two characters backslash-n')
    // 工具无关：不得点名任何具体跟踪器命令（含「为说明不许写」而引用命令的说明文字）
    if (/gh\s+issue|gh\s+api|glab\s+issue/.test(bf.zh + bf.en)) fail('bodyFormat 点名了具体跟踪器命令（工具无关契约：改写成「具体跟踪器命令」这种泛指）')
  } else fail('缺条目 bodyFormat')

  // 统一模板不得点名具体跟踪器命令（S1 判定已覆盖，这里补一条「说明文字里也不许引用」的正面检查）
  const zhBlockCount = (reg['mapExecute'] && reg['mapExecute'].zh.split('## 正文格式').length) || 0
  if (zhBlockCount !== 2) fail('mapExecute zh 应恰含 1 处「## 正文格式」段')
  // 写回脚本调用次数（E1 纠正值：10 条模板 × zh/en + bodyFormat zh/en = 22）
  const fixCount = (src.match(/node scripts\/fix-issue-body\.mjs/g) || []).length
  if (fixCount !== 22) fail('fix-issue-body 脚本名出现 ' + fixCount + ' 次（期望 22 = 10 条模板 × zh/en + bodyFormat zh/en）')
  const wireCount = (src.match(/node scripts\/wire-subissues\.mjs/g) || []).length
  if (wireCount !== 2) fail('wire-subissues 脚本名出现 ' + wireCount + ' 次（期望 2 = mapInspect zh/en）')
  const segCount = (src.match(/## 正文格式/g) || []).length
  if (segCount !== 10) fail('「## 正文格式」段数 ' + segCount + '（期望 10：10 条模板各 1 处内嵌）')
  return problems.length - before
}

// ==================== 7. L1 内存夹具（34 条绕过 + 24 条误报；逐条断言） ====================
// 三类必须覆盖：范围绕过（新增条目）、解析绕过（单引号/拆行/引号拼接）、渲染绕过（占位符）
const FIXTURE_BYPASS = [
  ['T01 TAB 分隔', '写回用 gh\tissue edit 573 --body-file x.md'],
  ['T02 多空格', '写回用 gh   issue edit 573 --body-file x.md'],
  ['T03 全角空格 U+3000', '写回用 gh\u3000issue edit 573 --body-file x.md'],
  ['T04 全角字母', '写回用 ｇｈ issue edit 573 --body-file x.md'],
  ['T05 大写 GH', '写回用 GH issue edit 573 --body-file x.md'],
  ['T06 源码字面 \\n 拼接', '写回用 gh\\nissue edit 573 --body-file x.md'],
  ['T07 零宽字符 U+200B', '写回用 gh\u200bissue edit 573 --body-file x.md'],
  ['T08 引号拼接 gh" "issue', '写回用 gh" "issue edit 573 --body-file x.md'],
  ['T09 引号拼出 g\'\'h', "写回用 g''h issue edit 573 --body-file x.md"],
  ['T10 中文紧贴 用gh api', '建边用gh api repos/o/r/issues/1/sub_issues -X POST'],
  ['T11 中文顿号分隔', '写回用 gh、issue edit 573 --body-file x.md'],
  ['T12 反斜杠续行', 'gh \\\n  issue edit 573 --body-file x.md'],
  ['T13 glab issue update', '写回用 glab issue update 573 --description-file x.md'],
  ['T14 heredoc 单字母 <<E', 'cat <<E\n正文\nE'],
  ['T15 heredoc <<-BODY', 'cat <<-BODY\n\t正文\nBODY'],
  ['T16 curl 直打 API', 'curl -s -X PATCH https://api.github.com/repos/o/r/issues/573 -d @x.json'],
  ['T17 npm exec gh', 'npm exec gh -- issue edit 573 --body-file x.md'],
  ['T18 npx gh', 'npx gh issue edit 573 --body-file x.md'],
  ['T19 node -e 里塞 gh', "node -e \"require('child_process').execSync('gh issue edit 573 --body-file x.md')\""],
  ['T20 变量间接 eval', 'CMD="gh issue edit 573"; eval "$CMD"'],
  ['T21 内联 --body', '写回用 gh issue edit 573 --body 正文'],
  ['T22 内联 --body=', '写回用 gh issue edit 573 --body=正文'],
  ['T23 短选项 -b', '写回用 gh issue edit 573 -b 正文'],
  ['T24 脚本改名伪装', 'node scripts/set-issue-body.mjs --issue 1 --body-file x.md'],
  ['T25 白名单值 token 防吞', 'node scripts/fix-issue-body.mjs --issue 1 --body-file x.md gh issue edit 573'],
  ['T26 base64 解码执行', 'echo Z2ggaXNzdWUgZWRpdCA1NzM= | base64 -d | sh'],
  ['T27 use 字段里写命令', '把正文写回：gh issue edit <号> --body-file <文件>'],
  ['T28 条目内联命令', '- [ ] 写回用 gh issue edit 573 --body-file x.md'],
  ['T29 每个词各自加引号', '写回用 "gh" "issue" edit 573 --body-file x.md'],
  ['T30 heredoc 多字母 <<EOF', 'cat <<EOF\n正文\nEOF'],
  ['T31 curl 直打 GitLab API', 'curl -s https://api.gitlab.com/projects/1/issues'],
  ['T32 合法脚本调用后接跟踪器命令', 'node scripts/wire-subissues.mjs --map 1 --children 2 --body-file x.md && gh issue edit 1 --body-file y.md'],
  ['T33 后端命令藏在字符串拼接续段里', "const a = '先检查（' + x + 'gh api repos/o/r/labels）'"],
  ['T34 占位符值本身含命令', 'gh issue edit 573 --body-file x.md（这是某个占位符的值）'],
]
const FIXTURE_FALSE_POS = [
  ['F01 GitHub issue URL', '参考 https://github.com/owner/repo/issues/573 的讨论'],
  ['F02 gh auth login（豁免条目内的文本）', '先跑 gh auth login，再 gh auth status 确认登录态'],
  ['F03 npx skills 安装器', 'npx -y skills@latest add wayfinder triage grilling'],
  ['F04 gh config get', '需要时用 gh config get editor 查配置'],
  ['F05 --body-file 参数名', '写回一律用 --body-file <文件>，不要内联'],
  ['F06 --body 说明句（无值）', '参数 --body 会把正文内联进命令行，禁止'],
  ['F07 --body 说明句（ASCII 空格）', '禁止把正文放进 --body ，必须 --body-file'],
  ['F08 --body-file=x.md', '参数写法 --body-file=x.md 也可以'],
  ['F09 合法脚本调用', '- [ ] 调 node scripts/fix-issue-body.mjs --issue <号> --body-file <文件> 写回'],
  ['F10 全角括号里的脚本调用', '（调 node scripts/fix-issue-body.mjs --issue <号> --body-file <文件>）'],
  ['F11 node ./scripts 路径写法', '调 node ./scripts/fix-issue-body.mjs --issue 1 --body-file x.md'],
  ['F12 node scripts\\ 反斜杠写法', '调 node scripts\\fix-issue-body.mjs --issue 1 --body-file x.md'],
  ['F13 引号包住脚本路径', '"node scripts/fix-issue-body.mjs" --issue 1 --body-file x.md'],
  ['F14 脚本调用带 --dry-run', '先跑 node scripts/wire-subissues.mjs --map 573 --children 1,2 --dry-run 看回包'],
  ['F15 脚本调用带 --repo', 'node scripts/wire-subissues.mjs --map 573 --children 1 --body-file x.md --repo owner/repo'],
  ['F16 脚本名后跟中文标点', '调 node scripts/fix-issue-body.mjs，参数 --issue 与 --body-file'],
  ['F17 两个脚本调用同段', '先 node scripts/fix-issue-body.mjs --issue 1 --body-file x.md，再 node scripts/wire-subissues.mjs --map 1 --children 2 --body-file x.md'],
  ['F18 a <<b>> c', '条件 a <<b>> c 表示位移'],
  ['F19 <<< 箭头', '输入 <<< 表示从这里开始'],
  ['F20 heredoc 这个词', 'Do not use heredoc; write the body to a file'],
  ['F21 glab 当后端名', 'GitLab 后端用 glab 命令，GitHub 后端用 gh 命令'],
  ['F22 进度格式示例', '## 进度：90% 独占一行，空行后接 下一步：xxx'],
  ['F23 目标 zh 正文格式块', '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落间留空行），再调 `node scripts/fix-issue-body.mjs --issue <号> --body-file <文件>` 写回；脚本回包 ok 为真才算写完（剥开头不可见字符、按阈值还原字面转义、格式只告警不改写，都由脚本负责）'],
  ['F24 目标 en 正文格式块', '## Body format (mandatory when writing/editing an issue body)\n- [ ] Write the body to a file first (real newlines in the file: each `## section` on its own line, a blank line between paragraphs), then write it back with `node scripts/fix-issue-body.mjs --issue <issue> --body-file <file>`; only when the script returns ok true is the write done (the script strips the leading invisible character, restores literal escapes within the threshold, and only warns about formatting)'],
]
const runFixtureSelfCheck = function (reg, backendSrc) {
  const before = problems.length
  check(FIXTURE_BYPASS.length >= 34, 'L1 夹具条数不足：绕过样例 ' + FIXTURE_BYPASS.length + ' 条（期望 ≥ 34，不许删夹具）')
  check(FIXTURE_FALSE_POS.length >= 24, 'L1 夹具条数不足：误报样例 ' + FIXTURE_FALSE_POS.length + ' 条（期望 ≥ 24，不许删夹具）')
  let leak = 0
  FIXTURE_BYPASS.forEach(function (c) {
    if (judge(c[1]).length === 0) { leak++; fail('L1 绕过样例未被判红：' + c[0]) }
  })
  let fp = 0
  FIXTURE_FALSE_POS.forEach(function (c) {
    const hits = judge(c[1])
    if (hits.length) { fp++; fail('L1 正常内容被误判红：' + c[0] + ' [' + hits.map(function (h) { return h.rule }).join('+') + ']') }
  })
  // 范围绕过：把一条假条目塞进内存注册表，走「范围过滤 → 判定」同一条链路（整改①）
  const fakeId = 'tpl.brandNew'
  const fakeReg = Object.assign({}, reg)
  fakeReg[fakeId] = { version: 1, placeholders: [], use: 'x', zh: '写回用 gh issue edit 573 --body-file x.md', en: 'same' }
  let fakeCaught = 0
  ;['zh', 'en', 'use'].forEach(function (f) { fakeCaught += judge(fakeReg[fakeId][f]).length })
  if (fakeCaught === 0) fail('L1 范围绕过未被判红：新增注册表条目 ' + fakeId + ' 内含具体命令（整改①：新条目不许天然豁免）')
  // 后端面绕过：保留 gh api 原文 + 注释里补脚本名（整改②）
  const injected = String(backendSrc).replace('subIssue: {', 'subIssue: {\n      // 用 node scripts/wire-subissues.mjs\n     ')
  const subLits = scanAllLiterals(extractObjectLiteral(injected, 'export const prompts') || '')
  let subCaught = 0
  subLits.forEach(function (lit) { if (lit.text.indexOf('gh api') >= 0) subCaught += judge(lit.text).length })
  if (subCaught === 0) fail('L1 后端面绕过未被判红：prompts.subIssue 保留具体命令 + 注释补脚本名（整改②）')
  // 渲染绕过：模板只写占位符，命令在后端声明值里（整改③）
  if (judgeRendered('先 {subIssue} 建边', { subIssue: '先 gh api repos/o/r/issues/1 --jq .id 取 id，再 gh api repos/o/r/issues/1/sub_issues -X POST' }).length === 0) {
    fail('L1 渲染绕过未被判红：命令藏在占位符里（整改③）')
  }
  // 渲染绕过之二：命令被拆成「占位符 + 字面量」（红队新口子）
  const asm = judge(renderWith('{x} {y} issue edit 1', { x: 'gh' }, ''))
  if (asm.length === 0) fail('L1 渲染绕过未被判红：占位符值 + 字面量拼出命令（{x} {y} issue edit 1）')
  // 渲染绕过之三：占位符值本身含命令或换行
  if (judge('gh issue edit 1 --body-file x.md').length === 0) fail('L1 渲染绕过未被判红：占位符值本身含命令')
  if (!/[\r\n]/.test('a\ngh issue edit 1')) fail('L1 夹具自检异常：换行样例本身有问题')
  // 解析绕过：单引号截断必须让求值抛错（判红，不静默少扫）
  let parseCaught = false
  try {
    evalRegistrySource('export const PROMPTS = { "x": { version: 1, placeholders: [], use: \'u\', zh: \'写回用 gh issue edit 573 --body \'x\' 正文\', en: \'e\' } }')
  } catch (e) { parseCaught = true }
  if (!parseCaught) fail('L1 解析绕过未被判红：单引号截断没有让求值抛错（解析层会静默漏条目）')
  // 反隐藏：不可枚举属性藏条目必须被审计抓出来
  const hiddenSrc = 'export const PROMPTS = {}; Object.defineProperty(PROMPTS, "tpl.hidden", { value: { version: 1, placeholders: [], use: "u", zh: "gh issue edit 1", en: "e" }, enumerable: false })'
  const hiddenReg = evalRegistrySource(hiddenSrc)
  if (auditRegistryShape(hiddenSrc, hiddenReg).length === 0) fail('L1 反隐藏审计失效：Object.defineProperty 藏起来的条目没被查出来')
  if (problems.length > before) return { leak: leak, fp: fp, ok: false }
  return { leak: leak, fp: fp, ok: true }
}

// ==================== 8. L2 机械注入（payload 从 JSON 夹具读；逐条断言 exit 1 且点名 id 与规则） ====================
// 锚点用「执行这个 issue」（全文唯一，落在 tpl.execute；用「## 收尾」会落到 mapExecute）
const L2_ANCHOR = '执行这个 issue'
const L2_PAYLOADS = JSON.parse(fs.readFileSync(PAYLOAD_FILE, 'utf8')).payloads || []
const injectNewEntry = function (src) {
  const anchor = /\r?\n {4}\}\r?\n/
  const from = src.indexOf('const PROMPTS = {')
  const m = anchor.exec(src.slice(from))
  if (!m) throw new Error('找不到注册表收尾')
  const at = from + m.index
  return src.slice(0, at) + '\n      "tpl.brandNew": { version: 1, placeholders: [], use: \'x\', zh: \'写回用 gh issue edit 573 --body-file x.md\', en: \'same\' },' + src.slice(at)
}
const injectUseField = function (src, text) {
  const at = src.indexOf("use: '")
  if (at < 0) throw new Error('找不到 use 字段')
  return src.slice(0, at + 6) + text + src.slice(at + 6)
}
const runL2Injection = function () {
  const before = problems.length
  check(L2_PAYLOADS.length >= 14, 'L2 夹具条数不足：' + L2_PAYLOADS.length + ' 条（期望 ≥ 14，不许删夹具）')
  let tmp = null
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-prompts-'))
    const regSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/prompts.js'), 'utf8')
    const backendSrc = fs.readFileSync(path.join(ROOT, 'src/host/tracker/backends/github/index.js'), 'utf8')
    L2_PAYLOADS.forEach(function (p) {
      let mutated = null
      let extraArgs = []
      if (p.kind === 'before-anchor') {
        const at = regSrc.indexOf(L2_ANCHOR)
        if (at < 0) { fail('L2 锚点「' + L2_ANCHOR + '」在 prompts.js 中找不到（注入点失效）'); return }
        // 锚点落在模板字符串内部，注入文本必须把真实换行写成源码转义 \n，否则字符串被截断成语法错误，
        // 就分不清「被规则抓住」和「被解析错误抓住」了
        mutated = regSrc.slice(0, at) + String(p.text).split('\n').join('\\n') + '\\n' + regSrc.slice(at)
      } else if (p.kind === 'new-entry') {
        mutated = injectNewEntry(regSrc)
      } else if (p.kind === 'use-field') {
        mutated = injectUseField(regSrc, p.text)
      } else if (p.kind === 'backend') {
        const bpath = path.join(tmp, 'github-index-probe.js')
        fs.writeFileSync(bpath, backendSrc.replace("zh: 'node scripts/wire-subissues.mjs", "zh: 'gh api repos/{owner}/{repo}/issues/{child} --jq .id 取 id；node scripts/wire-subissues.mjs"))
        extraArgs = ['--backend-probe=' + bpath]
      }
      const args = (mutated != null) ? [path.join(tmp, 'prompts-probe-' + p.n + '.js')] : extraArgs
      if (mutated != null) fs.writeFileSync(args[0], mutated)
      let out = ''
      let code = 0
      try {
        out = childProcess.execFileSync(process.execPath, [SELF].concat(args), {
          cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { DSH_VERIFY_PROMPTS_CHILD: '1' }), stdio: ['ignore', 'pipe', 'pipe'],
        })
        code = 0
      } catch (e) {
        code = (e && typeof e.status === 'number') ? e.status : 1
        out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
      }
      if (code !== 1) fail('L2 payload「' + p.n + '」注入后退出码 ' + code + '（期望 1）：' + out.split('\n').filter(function (l) { return l.indexOf('FAIL') === 0 }).slice(0, 2).join(' | '))
      else if (out.indexOf('FAIL') < 0) fail('L2 payload「' + p.n + '」退出 1 但输出无 FAIL 行')
      else {
        const missing = (p.expect || []).filter(function (tok) { return out.indexOf(tok) < 0 })
        if (missing.length) fail('L2 payload「' + p.n + '」失败信息未点名 ' + missing.join(' / ') + '（红得不对）')
      }
      if (process.env.DSH_VERIFY_PROMPTS_VERBOSE === '1') {
        const first = (out.split('\n').filter(function (l) { return l.indexOf('FAIL') >= 0 })[0] || '').trim()
        console.log('    L2 ' + (code === 1 ? 'RED ' : 'LEAK') + ' ' + p.n + '（期望点名 ' + (p.expect || []).join('+') + '）' + (first ? '  ' + first.replace(/^FAIL \S+ /, 'FAIL ').slice(0, 130) : ''))
      }
    })
  } finally {
    try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
  }
  return problems.length - before
}

// ==================== 9. 跑 ====================
const argv = process.argv.slice(2)
const backendProbe = (argv.filter(function (a) { return a.indexOf('--backend-probe=') === 0 })[0] || '').slice('--backend-probe='.length)
const fileArgs = argv.filter(function (a) { return a.indexOf('--') !== 0 })
const singleFileMode = fileArgs.length > 0
const stepOk = function (before) { return problems.length === before }

console.log('P1: prompt 注册表契约（#573 五面扫描 + 外部豁免登记 + 归一化 + R1–R7）')

// —— S1 + S5 ——
const s1Path = singleFileMode ? fileArgs[0] : path.join(ROOT, 'src/client/kernel/prompts.js')
const s1Label = singleFileMode ? fileArgs[0] : 'src/client/kernel/prompts.js'
let reg = null
let s1Ids = []
try {
  const s1Src = fs.readFileSync(s1Path, 'utf8')
  reg = evalRegistrySource(s1Src)
  s1Ids = Object.keys(reg)
  auditRegistryShape(s1Src, reg).forEach(function (m) { fail(m) })
} catch (e) {
  fail('FAIL S1 ' + s1Label + ' 求值失败（模板语法错误或写法被改坏）：' + e.message + '\n' +
    '     修法：模板条目必须是一行一条、单引号包裹的合法 JS；求值失败即判红，不许静默少扫')
}
if (reg) {
  const pS1 = problems.length
  check(s1Ids.length === EXPECT_REGISTRY_ENTRIES, 'S1 注册表条目数 ' + s1Ids.length + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '）——解析层不许静默少扫')
  // 跨门禁一致性：tests/verify-prompt-newlines.js 的单行正则必须解析到同样多的条目（拆行/换引号会让它静默少 1 条）
  const byRegex = parseRegistryByRegex(fs.readFileSync(s1Path, 'utf8'))
  const regexIds = Object.keys(byRegex)
  check(regexIds.length === s1Ids.length, '跨门禁不一致：单行正则解析到 ' + regexIds.length + ' 条，S1 求值解析到 ' + s1Ids.length +
    ' 条（条目被拆行或换了引号；tests/verify-prompt-newlines.js 会静默少扫）')
  const idDiff = s1Ids.filter(function (x) { return !byRegex[x] })
  if (idDiff.length) fail('跨门禁不一致：单行正则漏了 ' + idDiff.join(', '))
  // 后端 subIssue 声明值（S5 渲染面用）
  const subIssueValues = {}
  BACKENDS.forEach(function (b) {
    const v = backendSubIssueValues(fs.readFileSync(backendPath(b, backendProbe), 'utf8'))
    if (v.zh != null) subIssueValues[b + '.zh'] = v.zh
    if (v.en != null) subIssueValues[b + '.en'] = v.en
  })
  subIssueValues['default.zh'] = '通过 Tracker 原生的父子关系关联（create 时带 parentKey 或创后 setParent）'
  subIssueValues['default.en'] = 'via Tracker native parent relation (create with parentKey or setParent after creation)'
  const s1 = collectRegistry(reg, 'S1 ' + s1Label, { subIssueValues: subIssueValues }, EXEMPT)
  s1.problems.forEach(function (m) { fail(m) })
  surfaceReport.S1 = s1Ids.length
  surfaceReport.S5 = s1.rendered
  // 结构契约（沿用既有断言，陈旧两组已按现状修正）
  contractChecks(reg, fs.readFileSync(s1Path, 'utf8'))
  // 后端注入链的另一半（E6：模板里断言不到 --children，它只活在后端声明里）
  const ghSub = subIssueValues['github.zh'] || ''
  check(ghSub.indexOf('scripts/wire-subissues.mjs') >= 0, 'github 后端 prompts.subIssue 未含脚本名 scripts/wire-subissues.mjs（注入链的另一半）')
  check(ghSub.indexOf('--map') >= 0 && ghSub.indexOf('--children') >= 0 && ghSub.indexOf('--body-file') >= 0, 'github 后端 prompts.subIssue 未含 --map/--children/--body-file 三个参数名')
  check(ghSub.indexOf('## Destination') >= 0, 'github 后端 prompts.subIssue 未写明正文文件要保留 ## Destination（wire-subissues 脚本 exit 2 前置条件）')
  if (stepOk(pS1)) console.log('  PASS 面 S1 ' + s1Label + '（' + s1Ids.length + ' 条注册表，扫描 ' + s1.scanned + ' 条；含占位符 ' + s1.rendered + ' 条走渲染面）+ 契约断言 + 跨门禁一致性 + 注入链另一半')
}

// —— S2 / S3 / S4（单文件模式跳过：L2 注入只针对 S1） ——
if (!singleFileMode) {
  ;['client.js', 'package/lib/client.js'].forEach(function (rel, idx) {
    const pS2 = problems.length
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail('S2 ' + rel + ' 不存在（改 src 后必须重建产物）'); return }
    const got = parseRegistryByRegex(fs.readFileSync(p, 'utf8'))
    const ids = Object.keys(got)
    surfaceReport.S2[idx] = ids.length
    if (reg) {
      const missing = s1Ids.filter(function (x) { return !got[x] })
      const extra = ids.filter(function (x) { return !reg[x] })
      if (missing.length) fail('S2 ' + rel + ' 缺条目：' + missing.join(', '))
      if (extra.length) fail('S2 ' + rel + ' 多出条目：' + extra.join(', '))
      s1Ids.forEach(function (id) {
        if (!got[id]) return
        ;['version', 'use', 'zh', 'en'].forEach(function (f) {
          if (String(got[id][f]) !== String(reg[id][f])) fail('S2 ' + rel + ' ' + id + '.' + f + ' 与 S1 不一致（改 src 后必须重建产物）')
        })
        if (JSON.stringify(got[id].placeholders) !== JSON.stringify(reg[id].placeholders)) fail('S2 ' + rel + ' ' + id + '.placeholders 与 S1 不一致')
      })
    }
    if (stepOk(pS2)) console.log('  PASS 面 S2 ' + rel + '（' + ids.length + ' 条，与 S1 逐字段一致）')
  })

  BACKENDS.forEach(function (b) {
    const pS3 = problems.length
    const p = backendPath(b, backendProbe)
    if (!fs.existsSync(p)) { fail('S3 缺后端文件 ' + p); return }
    const got = collectBackend(b, fs.readFileSync(p, 'utf8'), backendLabel(b, backendProbe), EXEMPT)
    got.problems.forEach(function (m) { fail(m) })
    if (!got.found) return
    surfaceReport.S3.push(got.keys.length)
    check(got.keys.length === EXPECT_BACKEND_KEYS[b], 'S3 ' + b + ' prompts 键数 ' + got.keys.length + '（期望 ' + EXPECT_BACKEND_KEYS[b] + '，实测值；v2 写的 7/9/6 不成立）')
    check(got.literals === EXPECT_BACKEND_LITERALS[b], 'S3 ' + b + ' prompts 内字符串字面量数 ' + got.literals + '（期望 ' + EXPECT_BACKEND_LITERALS[b] + '）——词法扫描不许静默少扫')
    if (stepOk(pS3)) console.log('  PASS 面 S3 ' + backendLabel(b, backendProbe) + '（' + got.keys.length + ' 键 / ' + got.literals + ' 个字面量，含拼接续段）')
  })

  const pS4 = problems.length
  const host = collectHost(EXEMPT)
  host.problems.forEach(function (m) { fail(m) })
  surfaceReport.S4 = host.consts.length
  check(host.consts.length === EXPECT_HOST_PROMPT_CONSTS, 'S4 host *_PROMPT 常量数 ' + host.consts.length + '（期望 ' + EXPECT_HOST_PROMPT_CONSTS + '）')
  if (stepOk(pS4)) host.consts.forEach(function (c) { console.log('  PASS 面 S4 ' + c.file + ' ' + c.name) })
}

// —— 豁免登记表六条自检 + 变异自检 ——
if (reg) {
  const pEX = problems.length
  const surfaceIds = { registry: s1Ids }
  if (!singleFileMode) {
    BACKENDS.forEach(function (b) {
      const p = backendPath(b, backendProbe)
      if (!fs.existsSync(p)) return
      surfaceIds['backend:' + b] = countTopLevelKeys(extractObjectLiteral(fs.readFileSync(p, 'utf8'), 'export const prompts') || '')
    })
    surfaceIds.S4 = collectHost(EXEMPT).consts.map(function (c) { return c.name })
  }
  auditExemptTable(EXEMPT, surfaceIds, { fileEntries: loadExempt() }).forEach(function (m) { fail(m) })
  // 变异自检：把任意一条豁免换成「受保护条目」，审计必须红。
  // 逐条受保护 id 都试一遍（不是只试一个），证明「换一条豁免整体放行」这条路被堵住。
  let mutationMissed = 0
  PROTECTED.forEach(function (pk) {
    const parts = pk.split('#')
    const mutated = EXEMPT.map(function (e, i) {
      return i === 0 ? Object.freeze(Object.assign({}, e, { surface: parts[0], id: parts[1] })) : e
    })
    if (auditExemptTable(mutated, surfaceIds, {}).length === 0) mutationMissed++
  })
  if (mutationMissed > 0) {
    fail('变异自检失效：把豁免换成受保护条目后审计仍然全绿（' + mutationMissed + '/' + PROTECTED.length + ' 条没被拦住）——豁免表可以被用来整体放行')
  }
  if (stepOk(pEX)) console.log('  PASS 豁免登记表（存在性 / 完备性 / 数量 / 受保护清单 ' + PROTECTED.length + ' 条 / 与登记文件相等 / 变异自检逐条）')
}

// —— L1 / L2 / L3 / 自注册 ——
if (!IS_CHILD) {
  const backendSrc = fs.readFileSync(path.join(ROOT, 'src/host/tracker/backends/github/index.js'), 'utf8')
  const l1 = reg ? runFixtureSelfCheck(reg, backendSrc) : { ok: false }
  if (l1.ok) console.log('  PASS L1 夹具自证（绕过 ' + FIXTURE_BYPASS.length + ' 条全红 / 误报 ' + FIXTURE_FALSE_POS.length + ' 条全绿 / 范围·解析·渲染·反隐藏四类各 1 条）')
  const l2 = runL2Injection()
  if (l2 === 0) console.log('  PASS L2 机械注入（' + L2_PAYLOADS.length + ' 条 payload 从 tests/prompt-gate-payloads.json 读，逐条注入临时副本 → 退出码 1 且点名 id 与规则）')
  // L3 扫描面完整性
  const l3Before = problems.length
  if (!singleFileMode) {
    check(surfaceReport.S1 === EXPECT_REGISTRY_ENTRIES, 'L3 S1=' + surfaceReport.S1 + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '）')
    check(surfaceReport.S2[0] === EXPECT_REGISTRY_ENTRIES && surfaceReport.S2[1] === EXPECT_REGISTRY_ENTRIES, 'L3 S2=' + surfaceReport.S2.join('/') + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '/' + EXPECT_REGISTRY_ENTRIES + '）')
    BACKENDS.forEach(function (b, i) { check(surfaceReport.S3[i] === EXPECT_BACKEND_KEYS[b], 'L3 S3.' + b + '=' + surfaceReport.S3[i] + '（期望 ' + EXPECT_BACKEND_KEYS[b] + '）') })
    check(surfaceReport.S4 === EXPECT_HOST_PROMPT_CONSTS, 'L3 S4=' + surfaceReport.S4 + '（期望 ' + EXPECT_HOST_PROMPT_CONSTS + '）')
  }
  check(EXEMPT.length === EXPECT_EXEMPT, 'L3 EXEMPT=' + EXEMPT.length + '（期望 ' + EXPECT_EXEMPT + '）')
  if (problems.length === l3Before) console.log('  PASS L3 扫描面完整性')
  // 自注册（#573 总指挥 Q1：本门禁与 verify-progress.js 都要在链里）
  const pReg = problems.length
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    check((pkg.scripts.verify || '').includes('verify-prompts.js'), 'npm run verify 链未纳入本门禁（tests/verify-prompts.js）')
    check((pkg.scripts.verify || '').includes('verify-progress.js'), 'npm run verify 链未纳入 tests/verify-progress.js（#573 总指挥 Q1 裁定）')
    if (problems.length === pReg) console.log('  PASS 自注册（verify 链含 verify-prompts.js + verify-progress.js）')
  } catch (e) { fail('读 package.json 失败：' + e.message) }
}

console.log('S1=' + surfaceReport.S1 + ' S2=' + surfaceReport.S2.join('/') + ' S3=' + surfaceReport.S3.join('/') + ' S4=' + surfaceReport.S4 + ' EXEMPT=' + surfaceReport.exempt + (singleFileMode ? '（单文件模式：' + s1Label + '）' : ''))

if (problems.length) {
  console.log('\n存在失败（' + problems.length + ' 条）')
  problems.forEach(function (p) { console.log('  ' + p) })
  process.exit(1)
}
console.log('\n全部通过')
