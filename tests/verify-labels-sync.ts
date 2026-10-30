// verify-labels-sync.ts — #188 / #1342 单源标签清单门禁：
//   ①真源与约定表逐字相等（名字、颜色、描述三项都比，不只比名字）；
//   ②名单派生与补全判定同源同序；
//   ③客户端（NoRepoCard）只许消费拼进闭包的单源，不许再手抄第二份。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-labels-sync.ts
//
// 为什么改成取真源来比：#1342 之前这里的期望名单是手写十行、只比名字不卡颜色与描述，
// 真源里把某个颜色改错也照样全绿。现在期望表仍留在门禁里（门禁就是约定本身），但比对对象不再是
// 从源码文本里抠出来的名字，而是 require 进来、客户端真会消费的那份数据。
const fs = require('fs')
const path = require('path')
// #1253：NoRepoCard 已转 TypeScript，判据里有「注释写着 Markdown 跳过」这类只存在于源码的形状，
// 所以真源一律经 sourceText 取（同名 .js 是 esbuild 产物，注释会被剥掉）。
const { sourceText } = require('./lib/source-text.ts')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }

const ROOT = path.resolve(__dirname, '..')
const sharedPath = path.join(ROOT, 'src/tracker/contract/canonical-labels.ts')
const namesPath = path.join(ROOT, 'src/tracker/label-names.ts')

// 0) 两份真源都在，并且能按普通模块取到值（测试钩子把 .js 指到同名 .ts，取到的就是源码本身）。
check(fs.existsSync(sharedPath), 'src/tracker/contract/canonical-labels.ts 存在（标签清单真源）')
check(fs.existsSync(namesPath), 'src/tracker/label-names.ts 存在（名单与补全判定的实现）')
let CANONICAL_LABELS: any[] = []
let CANONICAL_LABEL_NAMES: any[] = []
let missingCanonicalLabels: any = null
try { CANONICAL_LABELS = require('../src/tracker/contract/canonical-labels.js').CANONICAL_LABELS } catch (e: any) { console.log('        取真源失败：' + e.message) }
try {
  const namesMod: any = require('../src/tracker/label-names.js')
  CANONICAL_LABEL_NAMES = namesMod.CANONICAL_LABEL_NAMES
  missingCanonicalLabels = namesMod.missingCanonicalLabels
} catch (e: any) { console.log('        取派生实现失败：' + e.message) }
check(Array.isArray(CANONICAL_LABELS) && CANONICAL_LABELS.length === 10, `真源清单 10 条（实 ${Array.isArray(CANONICAL_LABELS) ? CANONICAL_LABELS.length : '取不到'}）`)
check(Array.isArray(CANONICAL_LABEL_NAMES) && CANONICAL_LABEL_NAMES.length === 10, `派生名单 10 条（实 ${Array.isArray(CANONICAL_LABEL_NAMES) ? CANONICAL_LABEL_NAMES.length : '取不到'}）`)
check(typeof missingCanonicalLabels === 'function', '补全判定 missingCanonicalLabels 可取到')

// 1) 真源逐字比对：名字、颜色、描述三项与约定完全一致。约定是给上游 GitHub 用的公开数据
//    （来源：gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/labels 19 条中 10 核心，2026-08-26 实测）。
//    门禁里这份是约定本身，真源是它的唯一实现：任何一项写错都要这里变红。
const EXPECTED = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'needs-triage', color: 'fbca04', description: 'Maintainer needs to evaluate this issue (unexamined, awaiting diagnosis)' },
  { name: 'needs-info', color: '5319e7', description: 'Waiting on reporter for more information' },
  { name: 'ready-for-agent', color: '0e8a16', description: 'Fully specified, ready for an AFK agent to implement' },
  { name: 'ready-for-human', color: 'b60205', description: 'Requires human implementation' },
  { name: 'wayfinder:grilling', color: '9D7CD8', description: "Open decision/discussion ticket (wayfinder grilling type) — drives the deck's discuss action" },
  { name: 'wayfinder:map', color: '8b5cf6', description: 'The map issue (wayfinder) — owns Notes/Decisions so far/Fog' },
  { name: 'wayfinder:prototype', color: 'f59e0b', description: 'Prototype ticket (wayfinder)' },
  { name: 'wayfinder:research', color: '0ea5e9', description: 'Research ticket (wayfinder)' },
  { name: 'wayfinder:task', color: '10b981', description: 'Task ticket (wayfinder)' },
]
check(CANONICAL_LABELS.length === EXPECTED.length, `真源条目数与约定一致（约定 ${EXPECTED.length}，实 ${CANONICAL_LABELS.length}）`)
EXPECTED.forEach((want, i) => {
  const got = CANONICAL_LABELS[i] || {}
  const same = got.name === want.name && got.color === want.color && got.description === want.description
  check(same, `第 ${i + 1} 条名/色/描述逐字相等：${want.name}`)
  if (!same) console.log(`        约定 ${JSON.stringify(want)}\n        真源 ${JSON.stringify({ name: got.name, color: got.color, description: got.description })}`)
  check(Object.keys(got).sort().join(',') === 'color,description,name', `第 ${i + 1} 条只带 name/color/description 三个字段`)
})
const truthNames: string[] = CANONICAL_LABELS.map((l: any) => l.name)
check(new Set(truthNames).size === truthNames.length, '真源名称唯一')
check(new Set(truthNames.map((s: string) => s.toLowerCase())).size === truthNames.length, '真源名称大小写不敏感唯一')

// 2) 派生查询同源同序：客户端拼进闭包的就是这两份，不许各自维护一套名字。
check(CANONICAL_LABEL_NAMES.length === truthNames.length && truthNames.every((n: string, i: number) => CANONICAL_LABEL_NAMES[i] === n),
  'CANONICAL_LABEL_NAMES 与 CANONICAL_LABELS 的名字同源同序')
if (typeof missingCanonicalLabels === 'function') {
  check(JSON.stringify(missingCanonicalLabels([])) === JSON.stringify(truthNames), 'missingCanonicalLabels([]) 返回全部名字（与真源同序）')
  check(JSON.stringify(missingCanonicalLabels(['BUG', ' needs-triage '])) === JSON.stringify(truthNames.filter((n: string) => n !== 'bug' && n !== 'needs-triage')),
    'missingCanonicalLabels 大小写不敏感、去首尾空白后求差')
}

// 3) 上游 19 名（同一来源的上游事实）：这份与真源是两份独立数据，故意各写一份。
//    它是「上游有哪些标签」的实测记录，真源是「我们把这 10 个当核心」的约定；抄成同一份就没有比对意义。
const upstream19 = ['accessibility','bug','documentation','duplicate','enhancement','good first issue','help wanted','invalid','needs-info','needs-triage','question','ready-for-agent','ready-for-human','wayfinder:grilling','wayfinder:map','wayfinder:prototype','wayfinder:research','wayfinder:task','wontfix']
const upstreamSet = new Set(upstream19.map((s: string) => s.toLowerCase()))
const notSubset: string[] = truthNames.filter((n: string) => !upstreamSet.has(n.toLowerCase()))
check(notSubset.length === 0, `真源的 ${truthNames.length} 个名字都是上游 19 的子集（不是的：${notSubset.join(', ') || '无'}）`)

// 4) 客户端消费侧（NoRepoCard 源码）：只许用拼进闭包的单源，不许再手抄第二份。
const noRepoTxt = (function () { try { return sourceText('src/client/views/NoRepoCard.js') } catch (e) { return '' } })()
check(noRepoTxt.length > 0, 'NoRepoCard 真源可取到（sourceText）')
check(/declare const CANONICAL_LABEL_NAMES\s*:\s*string\[\]/.test(noRepoTxt), '真源按契约声明拼进来的名单形状（declare const CANONICAL_LABEL_NAMES）')
check(/declare function missingCanonicalLabels\(/.test(noRepoTxt), '真源按契约声明拼进来的补全判定（declare function missingCanonicalLabels）')
check(/CANONICAL_LABEL_NAMES\.length/.test(noRepoTxt), '缺少数与总数从单源名单长度现算（不再写死 10）')
check(/missingCanonicalLabels\(/.test(noRepoTxt), '补全判定直接调单源帮手')
check(!noRepoTxt.includes('CANONICAL_LABELS_188') && !noRepoTxt.includes('missingLabels188'),
  '旧的第二份名单与帮手已删（CANONICAL_LABELS_188 / missingLabels188 不再出现）')
const quoted = (n: string) => new RegExp('["\']' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']')
const literalCopy: string[] = truthNames.filter((n: string) => quoted(n).test(noRepoTxt))
check(literalCopy.length === 0, `NoRepoCard 源码不再出现任何单源标签名字字面量（实得：${literalCopy.join(', ') || '无'}）`)
check(!/total\s*:\s*10\b/.test(noRepoTxt), '标签总数不再写死 10（改为从真源长度现算）')

// 5) PROMPTS.ensureLabels 双语 + 客户端产物里的名字字面量（产物只是补充证据，判据的真身在第一段源码比对）。
function readClient(p){ try{ return fs.readFileSync(p,'utf8')}catch(e){ return ''} }
const cli = readClient(path.join(ROOT, 'client.js'))
const pcli = readClient(path.join(ROOT, 'package/lib/client.js'))
check(cli.includes('ensureLabels'), 'client.js 含 ensureLabels（#231 起真源为 github 后端模块 prompts 声明）')
check(pcli.includes('ensureLabels'), 'package/lib/client.js 含 ensureLabels（同上）')
check(cli.includes('CANONICAL_LABEL_NAMES') && cli.includes('missingCanonicalLabels('), 'client 产物里拼进了单源名单与补全判定（拼接输入到了位）')
check(pcli.includes('CANONICAL_LABEL_NAMES') && pcli.includes('missingCanonicalLabels('), 'package 产物里同样拼进了单源名单与补全判定')
// #1687 阶段 1 收口：房间入口整份搬进 room/，这条断言跟着看真身而不是旧路径的转发壳。
const ghModPath = path.join(ROOT, 'src/tracker/rooms/github/room/index.ts')
let ghTxt=''; try{ ghTxt=fs.readFileSync(ghModPath,'utf8') }catch(e){}
check(ghTxt.includes('CANONICAL_LABELS.map'), 'github 后端模块从 shared 单源动态拼装名单')
check(ghTxt.includes('ensureLabels'), 'github 后端模块声明 ensureLabels 双语数据')
// 2026-10-17 先修：原来只查模块里出现过 'ensureLabels' 这个词，双语只写在注释里、正文到底是不是双语没查。
// 现在按真源形状查三样：两个语言字段都在、名字由单源拼出来、句子确实带上了拼出来的名单。
const ensureBlock = (function(){ const i = ghTxt.indexOf('ensureLabels:'); return i<0 ? '' : ghTxt.slice(i, i + 3000) })()
check(/zh:\s*'/.test(ensureBlock) && /en:\s*'/.test(ensureBlock), 'ensureLabels 声明 zh/en 两个语言字段')
check(ensureBlock.includes('names.length') && ensureBlock.includes('zhNames') && ensureBlock.includes('enNames'), '双侧文案都用单源名单（长度与名字都来自 CANONICAL_LABELS）')
// 名字断言用「带引号的完整名字字面量」：调用 includes(n) 时，名字尾巴多几个字符也会被蒙过去。
truthNames.forEach((n: string) => {
  check(quoted(n).test(cli), `client 含名字字面量 ${n}`)
  check(quoted(n).test(pcli), `package 含名字字面量 ${n}`)
})

// 6) NoRepoCard 标签步骤 Modal（无常驻黄条，GitHub 专属，Markdown 跳过）
// 2026-10-17 先修：这一段原来两条断言形同虚设——一条是 `A || B`（两者有其一即过），另一条第三个选项
// 写成 cli.includes('markdown')（整个包都含这个词，永远为真）。改成：产品侧要求两项标记同时在；
// 真源侧按今天的实现查「注入走能力声明而不是写死后端」与「这一步不是常驻通知条」。
check(cli.includes('panel.labelsStepTitle'), 'client 含 labelsStepTitle i18n')
check(cli.includes('panel.labelsStepAction'), 'client 含 labelsStepAction i18n')
check(cli.includes('prompts.ensureLabels'), 'NoRepoCard 注入优先后端 ensureLabels 数据（#231 元数据直取）')
check(noRepoTxt.includes('Markdown 跳过'), '真源契约写明 Markdown 跳过（GitHub 专属步骤）')
check(/mmI\.prompts\.ensureLabels/.test(noRepoTxt), '注入文案走能力声明（moduleMetaOf(...).prompts.ensureLabels），没有写死后端分支')
check(!noRepoTxt.includes('wf.status'), '标签步骤不是常驻 warn 黄条（这一步的真源里不出现 wf.status）')
check(cli.includes('dsws-labels-modal') && cli.includes('dsws-labels-overlay'), 'client 含 labels Modal 样式（dsws-labels-modal/overlay）')
check(pcli.includes('dsws-labels-modal'), 'package 含 labels Modal 镜像')

// 7) package 同步（build.mts 按新树投放）
const pkgSharedPath = path.join(ROOT, 'package/tracker/contract/canonical-labels.js')
check(fs.existsSync(pkgSharedPath), 'package/tracker/contract/canonical-labels.js 存在（build 按新树投放）')
if(fs.existsSync(pkgSharedPath)){
  const pkgTxt = fs.readFileSync(pkgSharedPath,'utf8')
  check(pkgTxt.includes('CANONICAL_LABELS'), 'package 投放含 CANONICAL_LABELS')
  // 2026-10-17 先修：原来只查「出现过 CANONICAL_LABELS 这个词」，投放漏掉几个名字照样过。
  // 现在把投放件里的名字逐个对出来，与真源那 10 个名字做集合相等比较。
  const pkgNames: string[]=[]; const re2=/name:\s*['"]([^'"]+)['"]/g; let m2
  while((m2=re2.exec(pkgTxt))!==null) pkgNames.push(m2[1])
  check(pkgNames.length === truthNames.length && truthNames.every((n: string)=>pkgNames.indexOf(n)>=0), `package 投放的名字与真源一一对应（实得 ${pkgNames.length} 个）`)
}

if(failed){ console.log('\n存在失败'); process.exit(1)}
console.log('\n全部通过 · #188/#1342 单源标签清单')
