// 一次性实验脚本（审查用，不入库）：安静地把计时器插件从 app.asar 里抽出来。
// 输出只打短摘要；任何解析失败都只报字节形状，不把原文倒进日志。
import fs from 'node:fs'
import path from 'node:path'

const ASAR = 'D:/DeepseekHarness/resources/app.asar'
const OUT = 'D:/dsh-plugin/dsh-mattpocock-skills-deck/.r1115tmp/out'
const QUIET = []
function log(...a) { QUIET.push(a.join(' ')) }

try {
  const fd = fs.openSync(ASAR, 'r')
  const first = Buffer.alloc(16)
  fs.readSync(fd, first, 0, 16, 0)
  const u32 = (o) => first.readUInt32LE(o)
  const scan = Buffer.alloc(4 * 1024 * 1024)
  const got = fs.readSync(fd, scan, 0, scan.length, 0)
  const jsonStart = scan.indexOf('{"files":')
  log('pickle u32@0/4/8/12 =', u32(0), u32(4), u32(8), u32(12), '| jsonStart =', jsonStart, '| 扫描字节 =', got)
  if (jsonStart < 0) { log('没找到 {"files":，停手'); console.log(QUIET.join('\n')); process.exit(1) }

  // 从 {"files": 起按括号配平找 JSON 结尾（跳过字符串里的括号）。
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = jsonStart; i < got; i++) {
    const c = scan[i]
    if (inStr) { if (esc) esc = false; else if (c === 92) esc = true; else if (c === 34) inStr = false; continue }
    if (c === 34) { inStr = true; continue }
    if (c === 123) depth++
    else if (c === 125) { depth--; if (depth === 0) { end = i; break } }
  }
  log('JSON 结尾下标 =', end, '长度 =', end - jsonStart + 1)
  const header = JSON.parse(scan.subarray(jsonStart, end + 1).toString('utf8'))

  const candidates = [8 + u32(4), jsonStart, 8 + u32(4) + 4, end + 1, end + 1 + (4 - ((end + 1) % 4)) % 4]
  log('内容起点候选 =', candidates.join(', '))

  const walk = (node, prefix, out) => {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + '/' + name : name
      if (entry.files) walk(entry, p, out)
      else out.push({ p, entry })
    }
    return out
  }
  const all = walk(header, '', [])
  const probe = all.find((f) => f.p === 'node_modules/@deepseek-ai/cordis-plugin-timer/package.json')
  log('插件 package.json 条目：', probe ? probe.p + ' size=' + probe.entry.size + ' offset=' + probe.entry.offset : '没找到')

  let dataStart = -1
  if (probe) {
    for (const cand of candidates) {
      const off = cand + Number(probe.entry.offset)
      if (off + 4 > fs.fstatSync(fd).size) continue
      const buf = Buffer.alloc(Math.min(Number(probe.entry.size), 4096))
      fs.readSync(fd, buf, 0, buf.length, off)
      if (buf[0] !== 123) continue // '{'
      try {
        const j = JSON.parse(buf.subarray(0, Number(probe.entry.size)).toString('utf8'))
        if (j && j.name === '@deepseek-ai/cordis-plugin-timer') { dataStart = cand; log('内容起点确认 =', cand, '（抽出 package.json 校验通过，版本 ' + j.version + '）'); break }
      } catch (e) { /* 换下一个候选 */ }
    }
  }
  if (dataStart < 0) { log('没定出内容起点，停手'); fs.closeSync(fd); console.log(QUIET.join('\n')); process.exit(1) }

  const want = /^node_modules\/(@deepseek-ai\/cordis-plugin-timer|cordis)\//
  const picked = all.filter((f) => want.test(f.p))
  log('命中文件 ' + picked.length + ' 个')
  for (const f of picked) {
    const buf = Buffer.alloc(Number(f.entry.size))
    fs.readSync(fd, buf, 0, buf.length, dataStart + Number(f.entry.offset))
    const dest = path.join(OUT, f.p)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    if (/cordis-plugin-timer\/(package\.json|lib\/index\.js|src\/index\.ts|index\.js)$/.test(f.p)) log('  ' + f.p + '  ' + f.entry.size + 'B  首行: ' + buf.toString('utf8').split('\n')[0].slice(0, 70))
  }
  fs.closeSync(fd)
  log('已抽出到 ' + OUT)
} catch (e) {
  log('脚本异常：' + String((e && e.message) || e).slice(0, 160))
}
console.log(QUIET.join('\n'))
