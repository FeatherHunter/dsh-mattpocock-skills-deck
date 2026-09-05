// verify-log-scrub.js —— #494 第三件事：日志门禁之正则名（#489 附录第 4 节断言五）。
// 用法：在插件根目录执行 node tests/verify-log-scrub.js，可独立运行。
// 断言文字：命中只记具名正则名；出现未知规则名、命中记原文、未命中扩写表达式即红。
// 做法：规则名只许截断三档（留前多少字）；掩码事件只带字段名、规则名、是否命中，
// 不带原文；截断小函数里不写 pattern 匹配（只计数）；全仓不许自造规则名字面量。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志掩码规则名门禁（#494：命中只记规则名，不记原文）')

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 一、规则名只有截断三档：规则值由字数拼出来，不写死字面量。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  check(/rule\s*:\s*['"]T['"]\s*\+\s*n/.test(src), "规则名由字数拼出（'T' 加字数，如 T120）")
  check(/hit\s*:\s*true/.test(src), '是否命中记布尔真（不记命中文本）')
}

// 二、掩码事件三键齐且无原文键。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  const at = src.indexOf("'privacy.scrub'")
  const tail = at >= 0 ? src.slice(at) : ''
  const openAt = tail.search(/\{/)
  let segKeys = []
  if (openAt >= 0) {
    const seg = tail.slice(openAt)
    let depth = 0
    let end = seg.length
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] === '{') depth += 1
      if (seg[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    segKeys = Array.from(seg.slice(0, end).matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)).map((m) => m[1])
  }
  check(segKeys.includes('field') && segKeys.includes('rule') && segKeys.includes('hit'), '掩码事件带字段名、规则名、是否命中三键')
  const extraKeys = segKeys.filter((k) => k !== 'field' && k !== 'rule' && k !== 'hit')
  check(extraKeys.length === 0, '掩码事件只带三键（不带原文键）' + (extraKeys.length ? ' —— 多出：' + extraKeys.join('、') : ''))
}

// 三、截断小函数只计数不匹配：函数体内无正则字面量，无自造规则名。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  const lines = src.split('\n')
  const helperLines = lines.filter((l) => /dswsLogHash|dswsScrubHits|dswsScrubN|dswsLogTrunc|dswsDedupWin/.test(l) && !/^\s*\/\//.test(l))
  check(helperLines.length >= 5, '脱敏小函数五件套齐（散列、命中表、计数、截断、去重窗）')
  const withRegex = helperLines.filter((l) => /\/[^\s\/]+\/[gimsuy]*\.(test|exec)\s*\(|\.match\s*\(\s*\//.test(l))
  check(withRegex.length === 0, '脱敏小函数内无 pattern 匹配（只计数，不扩写表达式）' + (withRegex.length ? ' —— 命中：' + withRegex.join('；') : ''))
}

// 四、全仓规则名字面量检查：不许出现未知规则名。
{
  const hits = []
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) files.push(p)
    }
  }
  walk(path.join(ROOT, 'src'))
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // 自造的 R_ 开头规则名一律不许出现。
      if (/['"]R_[A-Z_]+['"]/.test(line)) hits.push(rel + ' 第 ' + (i + 1) + ' 行：未知规则名')
      // 写死的 rule 字符串只许在别处，日志调用里不许出现。
      const ruleLit = line.match(/rule\s*:\s*['"]([^'"]+)['"]/)
      const isDynamicT = ruleLit && ruleLit[1] === 'T' && /['"]T['"]\s*\+\s*n/.test(line)
      if (ruleLit && !isDynamicT) hits.push(rel + ' 第 ' + (i + 1) + ' 行：写死规则名 ' + ruleLit[1])
    })
  }
  check(hits.length === 0, '无未知规则名、无写死规则名' + (hits.length ? ' —— 命中：' + hits.join('；') : ''))
}

// 五、采样纪律：掩码事件每满 50 次才记一次，且只在调试开关打开时记。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  const line = src.split('\n').find((l) => l.includes('privacy.scrub'))
  check(!!line && line.includes('% 50 === 0'), '掩码事件 50 次记一次（不逐条记）')
  check(!!line && line.includes("isEnabled('debug')"), '掩码事件只在调试开关打开时记')
}

console.log(failed ? '\n存在失败 — verify-log-scrub 未通过' : '\n全部通过 — 掩码规则名门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
