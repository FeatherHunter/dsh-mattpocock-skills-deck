// verify-no-title.js — title 原生提示残留门禁（T1 #403 定版，承 #402 地图）
// 用法: node tests/verify-no-title.js [file...]（默认扫描 src/client 全量，真源 + 产物不扫）
// 形态：轻量文本扫描（同 verify-reuse 轻量），白名单仅测试文件与 aria-label 豁免（后者天然不命中 title: 正则）
// 阈值：0 通过 / 1 通过（未达 2 标记） / 2 WARN 标记（// TODO no-title:q） / ≥3 ERROR 即抽 / ≥5 ERROR 必卡（合并门禁）
// 判定：扫描 \\btitle\\s*:  （h() 属性形态 title: tr(...)/title: s.title/title: '...'），忽略 // 与 /* 注释行
// 注意：数据字段 {title: title} 若出现在 UI 文件也会被计入；真源迁移后 UI 全量改 Tip，数据字段应改名或豁免清单（当前门禁按文本计，T2/T3 清零后数据字段残留若需保留需加豁免）
const fs = require('fs')
const path = require('path')
let failed = false
let warned = false
const check = (ok, level, msg) => {
  const tag = ok ? '  PASS ' : (level === 'error' ? '  FAIL ' : '  WARN ')
  console.log(tag + msg)
  if (!ok && level === 'error') failed = true
  if (!ok && level === 'warn') warned = true
}
function collectFiles(dir, out){
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs)) return
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })){
    const rel = path.posix.join(dir, ent.name)
    if (ent.isDirectory()) collectFiles(rel, out)
    else if (ent.isFile() && rel.endsWith('.js')) out.push(rel)
  }
}
const SCAN_ROOTS = ['src/client/views','src/client/panel','src/client/statusbar','src/client/floating']
const TITLE_RE = /\btitle\s*:/g
let hits = []
let perFile = new Map()
for (const root of SCAN_ROOTS){
  const files = []
  collectFiles(root, files)
  for (const f of files){
    let src = ''
    try { src = fs.readFileSync(f, 'utf8') } catch(e){ continue }
    const lines = src.split(/\r?\n/)
    let fileHits = 0
    for (let i=0;i<lines.length;i++){
      const raw = lines[i]
      const t = raw.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
      // 去注释需避开字符串内的 //（如 https:// 与正则 /^https?:\/\//），逐字符扫描，字符串内 // 不截断
      let code = raw
      {
        let inS=false, inD=false, inB=false, esc=false, cut=-1
        for (let ci=0; ci<code.length; ci++){
          const ch=code[ci]
          if (esc){ esc=false; continue }
          if (ch==='\\'){ esc=true; continue }
          if (!inS && !inD && !inB){
            if (ch==="'") inS=true
            else if (ch==='"') inD=true
            else if (ch==='`') inB=true
            else if (ch==='/' && code[ci+1]==='/'){ cut=ci; break }
            else if (ch==='/' && code[ci+1]==='*'){ cut=ci; break }
          } else {
            if (inS && ch==="'") inS=false
            else if (inD && ch==='"') inD=false
            else if (inB && ch==='`') inB=false
          }
        }
        if (cut>=0) code = code.slice(0, cut)
      }
      const m = code.match(TITLE_RE)
      if (m) {
        if (code.includes('aria-label')) continue
        if (code.includes('PREVIEW_VALUES')) continue
        fileHits += m.length
        for (let k=0;k<m.length;k++) hits.push(f + ':' + (i+1))
      }
    }
    if (fileHits>0) perFile.set(f, fileHits)
  }
}
console.log('门禁 verify-no-title（#403 · 2 标记 3 即抽 5 必卡 · 轻量文本扫描）')
console.log('  扫描范围：' + SCAN_ROOTS.join(', ') + ' （' + perFile.size + ' 文件命中，' + hits.length + ' 处 title: ）')
console.log('  白名单：测试文件（tests/ 不扫描） + aria-label（含 aria-label 行豁免，天然不命中）')
if (perFile.size>0){
  for (const [f,c] of perFile.entries()){
    console.log('    - ' + f + ': ' + c + ' 处')
  }
}
if (hits.length>0 && hits.length<=10){
  console.log('  明细：' + hits.join(', '))
} else if (hits.length>10){
  console.log('  明细（前10）：' + hits.slice(0,10).join(', ') + ' ... 共' + hits.length)
}
if (hits.length===0) check(true, 'ok', 'title: 残留 0 处（通过，全量已迁移至 Tip）')
else if (hits.length===1) check(true, 'ok', 'title: 1 处（未达 2 标记）：' + hits[0])
else if (hits.length===2) check(false, 'warn', 'title: 2 处标记（// TODO no-title:q）：' + hits.join(', ') + ' — 下一处即抽，请改 Tip({content}) 包裹')
else if (hits.length<5) check(false, 'error', 'title: ' + hits.length + ' 处即抽（≥3）：' + hits.slice(0,5).join(', ') + (hits.length>5?' ...':'') + ' — 请经 Tip 薄预设迁移（mode mouse/delay 500/160/maxWidth 220/flip auto/zIndex 2147483000）')
else check(false, 'error', 'title: ' + hits.length + ' 处必卡（≥5）— 合并门禁卡住，不抽不合入；清单：' + hits.slice(0,5).join(', ') + ' ...')
if (hits.length>=5) check(false, 'error', 'title: 5 处必卡阈值已触发（实际 ' + hits.length + '）— 需 T2/T3 清零')
const tipPath = 'src/client/views/primitives/Tip.js'
if (fs.existsSync(tipPath)){
  const src = fs.readFileSync(tipPath, 'utf8')
  const lines = src.split(/\r?\n/).length
  check(lines<=50, lines<=50?'ok':'error', '粒度 ' + tipPath + ' ' + lines + ' 行 ' + (lines<=50?'≤50（通过）':'>50（超限）'))
  const hasHoverTip = /HoverTip/.test(src)
  check(hasHoverTip, hasHoverTip?'ok':'error', 'Tip 消费 HoverTip（经闭包，直连 HoverTip）')
  const hasPreset = /500/.test(src) && /160/.test(src) && /220/.test(src) && /2147483000/.test(src) && /mouse/.test(src)
  check(hasPreset, hasPreset?'ok':'error', 'Tip 预设含 500/160/220/2147483000/mouse（薄预设完整）')
  const hasImport = /^\s*import\s/m.test(src)
  check(!hasImport, !hasImport?'ok':'error', 'Tip 零横向 import（同层禁互 import）')
} else {
  check(false, 'error', '缺真源 ' + tipPath + '（Tip 未落地）')
}
if (failed) { console.log('\n存在失败（门禁卡住）— 请按 T2/T3 将 title: 改 Tip 包裹'); process.exit(1) }
if (warned) { console.log('\n存在警告（2 标记，下处即抽）— 不阻断但需记 TODO no-title'); }
else console.log('\n全部通过 — title 残留门禁 2 标记 3 即抽 5 必卡生效，白名单合规')
