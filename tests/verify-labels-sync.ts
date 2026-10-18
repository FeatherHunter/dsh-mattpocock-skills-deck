// verify-labels-sync.ts — #188 单源标签名子集校验（仅比 name，上游 19 中含 10 即 ok）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-labels-sync.ts
const fs = require('fs')
const path = require('path')
// #1253：NoRepoCard 已转 TypeScript，判据里有「注释写着 Markdown 跳过」这类只存在于源码的形状，
// 所以真源一律经 sourceText 取（同名 .js 是 esbuild 产物，注释会被剥掉）。
const { sourceText } = require('./lib/source-text.ts')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }

const ROOT = path.resolve(__dirname, '..')
const sharedPath = path.join(ROOT, 'src/tracker/contract/canonical-labels.ts')
const clientPath = path.join(ROOT, 'client.js')
const pkgClientPath = path.join(ROOT, 'package/lib/client.js')

// 1) 单源文件存在
check(fs.existsSync(sharedPath), 'src/tracker/contract/canonical-labels.ts 存在')
let srcTxt=''
try{ srcTxt=fs.readFileSync(sharedPath,'utf8') }catch(e){ srcTxt='' }
check(srcTxt.includes('CANONICAL_LABELS'), 'src/tracker/contract/canonical-labels.ts 含 CANONICAL_LABELS')
// 派生查询（名单/集合/子集函数）已按 #1026 搬出契约目录：名单断言改读新落点，数组本身仍在原文件。
const namesPath = path.join(ROOT, 'src/tracker/label-names.ts')
let namesTxt=''
try{ namesTxt=fs.readFileSync(namesPath,'utf8') }catch(e){ namesTxt='' }
check(namesTxt.includes('CANONICAL_LABEL_NAMES'), 'src/tracker/label-names.ts 含 CANONICAL_LABEL_NAMES（派生查询的新家）')

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
const ghModPath = path.join(ROOT, 'src/tracker/rooms/github/index.ts')
let ghTxt=''; try{ ghTxt=fs.readFileSync(ghModPath,'utf8') }catch(e){}
check(ghTxt.includes('CANONICAL_LABELS.map'), 'github 后端模块从 shared 单源动态拼装名单')
check(ghTxt.includes('ensureLabels'), 'github 后端模块声明 ensureLabels 双语数据')
// 2026-10-17 先修：原来只查模块里出现过 'ensureLabels' 这个词，双语只写在注释里、正文到底是不是双语没查。
// 现在按真源形状查三样：两个语言字段都在、名字由单源拼出来、句子确实带上了拼出来的名单。
const ensureBlock = (function(){ const i = ghTxt.indexOf('ensureLabels:'); return i<0 ? '' : ghTxt.slice(i, i + 3000) })()
check(/zh:\s*'/.test(ensureBlock) && /en:\s*'/.test(ensureBlock), 'ensureLabels 声明 zh/en 两个语言字段')
check(ensureBlock.includes('names.length') && ensureBlock.includes('zhNames') && ensureBlock.includes('enNames'), '双侧文案都用单源名单（长度与名字都来自 CANONICAL_LABELS）')
// 名字断言改成「带引号的完整名字字面量」：原来用 includes(n)，名字尾巴多几个字符（wayfinder:taskZZ）也会被
// includes('wayfinder:task') 蒙过去——那种情况下单源已经被改坏，门禁却说没事。
const quoted = (n) => new RegExp('["\']' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']')
expected.forEach(n=>{
  check(quoted(n).test(cli), `client 含名字字面量 ${n}`)
  check(quoted(n).test(pcli), `package 含名字字面量 ${n}`)
})

// 5) NoRepoCard 标签步骤 Modal（无常驻黄条，GitHub 专属，Markdown 跳过）
// 2026-10-17 先修：这一段原来两条断言形同虚设——一条是 `A || B`（两者有其一即过），另一条第三个选项
// 写成 cli.includes('markdown')（整个包都含这个词，永远为真）。改成：产品侧要求两项标记同时在；
// 真源侧按今天的实现查「注入走能力声明而不是写死后端」与「这一步不是常驻通知条」。
const noRepoPath = path.join(ROOT, 'src/client/views/NoRepoCard.js')
let noRepoTxt=''; try{ noRepoTxt=sourceText('src/client/views/NoRepoCard.js')}catch(e){}
check(noRepoTxt.includes('CANONICAL_LABELS_188') && noRepoTxt.includes('missingLabels188('), '真源声明 #188 单源名集合与 missingLabels188 帮手')
check(/\(Array\.isArray\(existing\)\?existing:\[\]\)\.forEach/.test(noRepoTxt) && /CANONICAL_LABELS_188\.forEach/.test(noRepoTxt), 'missingLabels188 按小写归一后对单源名单求差（真源形状）')
check(cli.includes('CANONICAL_LABELS_188') && cli.includes('missingLabels188('), 'client 产物里单源名集合与帮手两项都在')
check(cli.includes('panel.labelsStepTitle'), 'client 含 labelsStepTitle i18n')
check(cli.includes('panel.labelsStepAction'), 'client 含 labelsStepAction i18n')
check(cli.includes('prompts.ensureLabels'), 'NoRepoCard 注入优先后端 ensureLabels 数据（#231 元数据直取）')
check(noRepoTxt.includes('Markdown 跳过'), '真源契约写明 Markdown 跳过（GitHub 专属步骤）')
check(/mmI\.prompts\.ensureLabels/.test(noRepoTxt), '注入文案走能力声明（moduleMetaOf(...).prompts.ensureLabels），没有写死后端分支')
check(!noRepoTxt.includes('wf.status'), '标签步骤不是常驻 warn 黄条（这一步的真源里不出现 wf.status）')
check(cli.includes('dsws-labels-modal') && cli.includes('dsws-labels-overlay'), 'client 含 labels Modal 样式（dsws-labels-modal/overlay）')
check(pcli.includes('dsws-labels-modal'), 'package 含 labels Modal 镜像')

// 6) package 同步（build.mts 按新树投放）
const pkgSharedPath = path.join(ROOT, 'package/tracker/contract/canonical-labels.js')
check(fs.existsSync(pkgSharedPath), 'package/tracker/contract/canonical-labels.js 存在（build 按新树投放）')
if(fs.existsSync(pkgSharedPath)){
  const pkgTxt = fs.readFileSync(pkgSharedPath,'utf8')
  check(pkgTxt.includes('CANONICAL_LABELS'), 'package 投放含 CANONICAL_LABELS')
  // 2026-10-17 先修：原来只查「出现过 CANONICAL_LABELS 这个词」，投放漏掉几个名字照样过。
  // 现在把投放件里的名字逐个对出来，与单源那 10 个名字做集合相等比较。
  const pkgNames=[]; const re2=/name:\s*['"]([^'"]+)['"]/g; let m2
  while((m2=re2.exec(pkgTxt))!==null) pkgNames.push(m2[1])
  check(pkgNames.length === expected.length && expected.every(n=>pkgNames.indexOf(n)>=0), `package 投放的名字与单源一一对应（实得 ${pkgNames.length} 个）`)
}

if(failed){ console.log('\n存在失败'); process.exit(1)}
console.log('\n全部通过 · #188 单源名子集')
