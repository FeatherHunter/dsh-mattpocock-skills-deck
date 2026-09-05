// verify-log-truncate.js —— #494 第三件事：日志门禁之截断（#489 附录第 4 节断言三）。
// 用法：在插件根目录执行 node tests/verify-log-truncate.js，可独立运行。
// 断言文字：标题必经留前 80 字、错误必经留前 120 字（详情 160 字）并标注已截断；
// 直接拼接或直接转整行对象即红；渲染函数体内出现日志用对象转文本即红。
// 做法：锁死截断小函数的形状与全部调用点的字数；标题只许散列；
// 渲染目录的日志调用点名白名单，白名单外的日志调用与调用行上的对象转文本都算失败。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志截断门禁（#494：标题与错误先截断再记，渲染路径不转文本）')

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 一、截断小函数存在：超长留前一段，计数加一，超 50 次记一条掩码事件。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  check(src.includes('dswsLogTrunc'), '截断小函数存在（客户端内核共用）')
  check(/dswsLogTrunc\s*=\s*function\s*\(\s*s\s*,\s*n\s*,\s*field\s*\)/.test(src), '截断小函数三参（文本、字数、字段名）')
  check(src.includes('.slice(0, n)'), '截断只留前一段（超长截断）')
  check(src.includes('dswsScrubN'), '截断命中累加计数（自身即计数）')
  check(/log\s*\(\s*['"]debug['"]\s*,\s*['"]privacy\.scrub['"]/.test(src), '截断计数每满 50 次记一条掩码事件')
}

// 二、全部调用点的字数只许 80、120、160 三档；错误散列走 120 字档。
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
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/dswsLogTrunc\s*\(\s*[^,]+?,\s*(\d+)/g)) hits.push({ file: path.relative(ROOT, f), n: Number(m[1]) })
  }
  check(hits.length > 0, '截断有调用点（实得 ' + hits.length + ' 处）')
  const badN = hits.filter((h) => h.n !== 80 && h.n !== 120 && h.n !== 160)
  check(badN.length === 0, '截断字数只许 80、120、160 三档' + (badN.length ? ' —— 越界：' + badN.map((h) => h.file + ' 用 ' + h.n).join('；') : '（实得字数 ' + Array.from(new Set(hits.map((h) => h.n))).sort().join('、') + '）'))
  // 错误散列行：先截断 120 字再散列，或纯散列；不许记错误原文。
  let errHashBad = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!/errorHash\s*:/.test(line)) return
      if (!/dswsLogTrunc\s*\(\s*[^,]+?,\s*120|hash8\s*\(/.test(line)) errHashBad.push(rel + ' 第 ' + (i + 1) + ' 行')
    })
  }
  check(errHashBad.length === 0, '错误只记散列（先 120 字截断再散列，或纯散列）' + (errHashBad.length ? ' —— 越界：' + errHashBad.join('；') : ''))
}

// 三、标题只许散列：字段键里没有标题，线索散列行必经散列函数。
{
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) files.push(p)
    }
  }
  walk(path.join(ROOT, 'src', 'host'))
  walk(path.join(ROOT, 'src', 'client'))
  const titleKeys = []
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:log|fire|rlog|logEvent|roomLogEvent)\s*\(\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?['"](?:error|warn|info|debug)['"]\s*,\s*['"][a-z][a-zA-Z0-9.]*?['"]\s*,\s*\{/g)) {
      const seg = text.slice(m.index + m[0].length - 1, m.index + m[0].length + 600)
      let depth = 0
      let end = seg.length
      for (let i = 0; i < seg.length; i++) {
        if (seg[i] === '{') depth += 1
        if (seg[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
      }
      const keys = seg.slice(0, end).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g) || []
      for (const k of keys) {
        const name = k.replace(/\s*:\s*$/, '')
        if (/^title$/i.test(name)) titleKeys.push(path.relative(ROOT, f) + ' 有标题键')
      }
    }
  }
  check(titleKeys.length === 0, '日志字段无标题原文键（标题只记散列）' + (titleKeys.length ? ' —— 命中：' + titleKeys.join('；') : ''))
  const naming = readSrc(path.join('src', 'client', 'kernel', 'api-naming.js'))
  const hintLines = naming.split('\n').filter((l) => /hintHash\s*:/.test(l))
  check(hintLines.length > 0 && hintLines.every((l) => l.includes('dswsLogHash')), '改名线索只记散列（' + hintLines.length + ' 处线索散列行都经散列函数）')
}

// 四、渲染目录日志调用点名白名单；调用行上不许对象转文本。
{
  const renderDirs = ['views', 'panel', 'statusbar', 'floating'].map((d) => path.join(ROOT, 'src', 'client', d))
  const allowFiles = ['SettingsPage.js', 'BackendSelector.js', 'DockSync.js', 'StatusBar.js']
  const seen = {}
  for (const d of renderDirs) {
    if (!fs.existsSync(d)) continue
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile() && e.name.endsWith('.js')) {
          const lines = fs.readFileSync(p, 'utf8').split('\n')
          lines.forEach((line, i) => {
            const isLogCall = /(?:^|[^A-Za-z0-9_$])(?:log|fire)\s*\(\s*['"](?:error|warn|info|debug)['"]/.test(line)
            if (!isLogCall) return
            seen[e.name] = seen[e.name] || []
            seen[e.name].push({ line: i + 1, stringify: line.includes('JSON.stringify') })
          })
        }
      }
    }
    walk(d)
  }
  const extra = Object.keys(seen).filter((f) => !allowFiles.includes(f))
  check(extra.length === 0, '渲染目录日志调用只在点名文件里' + (extra.length ? ' —— 越界文件：' + extra.join('、') : '（' + allowFiles.join('、') + '）'))
  const stringifyHits = []
  for (const f of Object.keys(seen)) for (const s of seen[f]) if (s.stringify) stringifyHits.push(f + ' 第 ' + s.line + ' 行')
  check(stringifyHits.length === 0, '渲染目录日志调用行无对象转文本' + (stringifyHits.length ? ' —— 命中：' + stringifyHits.join('；') : ''))
}

console.log(failed ? '\n存在失败 — verify-log-truncate 未通过' : '\n全部通过 — 截断门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
