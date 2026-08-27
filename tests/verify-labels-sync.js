// verify-labels-sync.js — #188 单源标签名子集校验（仅比 name，上游 19 中含 10 即 ok）
// 用法: node tests/verify-labels-sync.js
const fs = require('fs')
const path = require('path')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }

const ROOT = path.resolve(__dirname, '..')
const sharedPath = path.join(ROOT, 'src/shared/labels.js')
const clientPath = path.join(ROOT, 'client.js')
const pkgClientPath = path.join(ROOT, 'package/lib/client.js')

// 1) 单源文件存在
check(fs.existsSync(sharedPath), 'src/shared/labels.js 存在')
let srcTxt=''
try{ srcTxt=fs.readFileSync(sharedPath,'utf8') }catch(e){ srcTxt='' }
check(srcTxt.includes('CANONICAL_LABELS'), 'src/shared/labels.js 含 CANONICAL_LABELS')
check(srcTxt.includes('CANONICAL_LABEL_NAMES'), 'src/shared/labels.js 含 CANONICAL_LABEL_NAMES')

// 2) 解析 CANONICAL_LABEL_NAMES（正则提取单引号/双引号包围的 name）
const nameRe = /name:\s*['"]([^'"]+)['"]/g
const found=[]
let m; while((m=nameRe.exec(srcTxt))!==null) found.push(m[1])
const expected = ['bug','needs-triage','needs-info','ready-for-agent','ready-for-human','wayfinder:grilling','wayfinder:map','wayfinder:prototype','wayfinder:research','wayfinder:task']
check(found.length===10, `CANONICAL_LABELS 数量 10（实 ${found.length}）`)
expected.forEach(n=>{
  const has = found.indexOf(n)>=0
  check(has, `CANONICAL 含 ${n}`)
})
// 唯一性
check(new Set(found).size===found.length, 'CANONICAL 名称唯一')
check(new Set(found.map(s=>s.toLowerCase())).size===found.length, 'CANONICAL 名称大小写不敏感唯一')

// 3) 仅比 name：上游 19 中含 10 即 ok（硬编码上游 19 名集合，来自 gh api 2026-08-26 实测）
const upstream19 = ['accessibility','bug','documentation','duplicate','enhancement','good first issue','help wanted','invalid','needs-info','needs-triage','question','ready-for-agent','ready-for-human','wayfinder:grilling','wayfinder:map','wayfinder:prototype','wayfinder:research','wayfinder:task','wontfix']
const upstreamSet = new Set(upstream19.map(s=>s.toLowerCase()))
const subOk = expected.every(n=> upstreamSet.has(n.toLowerCase()))
check(subOk, 'CANONICAL 10 为上游 19 的子集（名子集，不卡色）')

// 4) PROMPTS.ensureLabels 双语
function readClient(p){ try{ return fs.readFileSync(p,'utf8')}catch(e){ return ''} }
const cli = readClient(clientPath)
const pcli = readClient(pkgClientPath)
check(cli.includes('ensureLabels'), 'client.js 含 ensureLabels（#231 起真源为 github 后端模块 prompts 声明）')
check(pcli.includes('ensureLabels'), 'package/lib/client.js 含 ensureLabels（同上）')
const ghModPath = path.join(ROOT, 'src/host/tracker/backends/github/index.js')
let ghTxt=''; try{ ghTxt=fs.readFileSync(ghModPath,'utf8') }catch(e){}
check(ghTxt.includes('CANONICAL_LABELS.map'), 'github 后端模块从 shared 单源动态拼装名单')
check(ghTxt.includes('ensureLabels'), 'github 后端模块声明 ensureLabels 双语数据')
expected.forEach(n=>{
  check(cli.includes(n), `client ensureLabels 含 ${n}`)
  check(pcli.includes(n), `package ensureLabels 含 ${n}`)
})

// 5) NoRepoCard 标签步骤 Modal（无常驻黄条，GitHub 专属，Markdown 跳过）
check(cli.includes('CANONICAL_LABELS_188')||cli.includes('missingLabels188'), 'client 含标签步骤 helper（名子集计算）')
check(cli.includes('panel.labelsStepTitle'), 'client 含 labelsStepTitle i18n')
check(cli.includes('panel.labelsStepAction'), 'client 含 labelsStepAction i18n')
check(cli.includes('prompts.ensureLabels'), 'NoRepoCard 注入优先后端 ensureLabels 数据（#231 元数据直取）')
check(cli.includes("backendId === 'markdown'")||cli.includes('backendId==="markdown"')||cli.includes("markdown"), 'NoRepoCard 含 Markdown 跳过（GitHub 专属）')
check(!cli.includes('wf.status') || cli.includes('dsws-labels-modal'), 'client 标签步骤为 Modal（非 wf.status 常驻 warn 黄条）')
check(cli.includes('dsws-labels-modal') && cli.includes('dsws-labels-overlay'), 'client 含 labels Modal 样式（dsws-labels-modal/overlay）')
check(pcli.includes('dsws-labels-modal'), 'package 含 labels Modal 镜像')

// 6) package/shared 同步（build.mjs 原样复制）
const pkgSharedPath = path.join(ROOT, 'package/shared/labels.js')
check(fs.existsSync(pkgSharedPath), 'package/shared/labels.js 存在（build 原样复制）')
if(fs.existsSync(pkgSharedPath)){
  const pkgTxt = fs.readFileSync(pkgSharedPath,'utf8')
  check(pkgTxt.includes('CANONICAL_LABELS'), 'package/shared 含 CANONICAL_LABELS')
}

if(failed){ console.log('\n存在失败'); process.exit(1)}
console.log('\n全部通过 · #188 单源名子集')
