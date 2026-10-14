// 继续：在 asar 头部里找出计时器插件的真实路径，并抽出它。
import fs from 'node:fs'
import path from 'node:path'

const ASAR = 'D:/DeepseekHarness/resources/app.asar'
const OUT = 'D:/dsh-plugin/dsh-mattpocock-skills-deck/.r1115tmp/out'
const out = []
const log = (...a) => out.push(a.join(' '))
const fd = fs.openSync(ASAR, 'r')
const scan = Buffer.alloc(4 * 1024 * 1024)
fs.readSync(fd, scan, 0, scan.length, 0)
const jsonStart = scan.indexOf('{"files":')
const header = JSON.parse(scan.subarray(jsonStart, 3392064).toString('utf8'))
const dataStart = 3392064

const all = []
;(function walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name
    if (entry.files) walk(entry, p)
    else all.push({ p, entry })
  }
})(header, '')
log('总条目 ' + all.length)

const timer = all.filter((f) => f.p.includes('cordis-plugin-timer'))
log('含 cordis-plugin-timer 的路径 ' + timer.length + ' 条：')
for (const f of timer.slice(0, 12)) log('  ' + f.p + '  ' + f.entry.size + 'B')

const cordis = all.filter((f) => /node_modules\/cordis\/(package\.json|lib\/index\.[cm]?js)$/.test(f.p))
log('cordis 核心 ' + cordis.length + ' 条：')
for (const f of cordis.slice(0, 6)) log('  ' + f.p + '  ' + f.entry.size + 'B')

const picked = timer.concat(cordis)
for (const f of picked) {
  const buf = Buffer.alloc(Number(f.entry.size))
  fs.readSync(fd, buf, 0, buf.length, dataStart + Number(f.entry.offset))
  const dest = path.join(OUT, f.p)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
}
fs.closeSync(fd)
log('已抽出 ' + picked.length + ' 个文件到 ' + OUT)
console.log(out.join('\n'))
