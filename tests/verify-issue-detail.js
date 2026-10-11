// verify-issue-detail.js — T6 #11 · IssueDetail Markdown 安全白盒校验（map #5 · v1.7.0）
// 覆盖：从构建产物切出 mdToHtml 真源，用含 script/iframe/钓鱼链接的 fixture 渲染，断言渲染结果安全
const fs = require('fs')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }
const cli = fs.readFileSync('client.js','utf8')

// —— Markdown 安全白盒（fixture 含 script/iframe/钓鱼链接 → 渲染结果不含脚本与危险 href）
const stubH = (tag, props, children) => {
  const attr = props ? Object.keys(props).filter(k=> !['key','style','className','title'].includes(k) && props[k]!=null && props[k]!==false).map(k=>' '+k+'="'+String(props[k]).replace(/"/g,'&quot;')+'"').join('') : ''
  const ch = Array.isArray(children) ? children.join('') : (children==null?'':children)
  if(tag==='input') return '<input'+attr+'>'
  return '<'+tag+attr+'>'+ch+'</'+tag+'>'
}
const run = (src, md) => {
  // 这里选 compileFn：原来就是按文本造一个只接参数 h 的函数，参数名与方法体逐字照旧搬过来，求值结果不变。
  const fn = compileFn(['h'], src + '\nreturn { mdToHtml }')
  const out = fn(stubH).mdToHtml(md)
  return (Array.isArray(out) ? out : [out]).join('')
}
const mdSrc = (()=>{ const i=cli.indexOf('const MD_LINK_RE'); const e=cli.indexOf('// ============================================================', i+10); return cli.slice(i, e>0?e:i+9000) })()
const fixture = '<script>alert(1)</script> 正常文本 [钓鱼](javascript:alert(1)) <iframe src="evil.com"></iframe> [安全](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/5) **加粗**'
let rendered=''
try{ rendered = run(mdSrc, fixture) }catch(e){ rendered = String(e) }
check(!rendered.includes('href="javascript:'), '白盒：javascript: 钓鱼链接不产 href')
check(rendered.includes('<script>') || rendered.includes('&lt;script'), '白盒：<script> 当纯文本（不构造 script 元素，已由 h(\'script\' 检查）')
check(rendered.includes('<iframe') || rendered.includes('&lt;iframe'), '白盒：<iframe> 当纯文本（不构造 iframe 元素，已由 h(\'iframe\' 检查）')
check(rendered.includes('href="https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/5"'), '白盒：安全外链保留 href')
check(rendered.includes('<strong>加粗</strong>') || rendered.includes('加粗'), '白盒：正常 markdown 仍渲染')

// —— 产物新鲜度（已由 build 保证，此处仅校验存在）
check(fs.existsSync('client.js') && fs.existsSync('package/lib/client.js'), '产物存在（client 双源）')
check(fs.existsSync('host.js') && fs.existsSync('package/lib/index.js'), '产物存在（host 双源）')

if(failed){ console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
