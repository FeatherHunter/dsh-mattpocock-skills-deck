// verify-496-github-wizard-first.js — #496 第一票：全新工作区选 GitHub 先见建仓向导（GitHub 房 + 初始化模板文案，不动通用链与 Markdown）
// 用法: node tests/verify-496-github-wizard-first.js
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const gh = fs.readFileSync('src/host/tracker/backends/github/index.js', 'utf8')
const loc = fs.readFileSync('src/client/kernel/locale-panel.js', 'utf8')
const md = fs.readFileSync('src/host/tracker/backends/markdown/index.js', 'utf8')
// 1) 缺远端主动作仍是创建并发布向导 + 刷新，不自造第七种动作
check(gh.includes("'gh:remote'"), 'GitHub 房含 gh:remote 失败知识')
check(gh.includes("label: { zh: '创建并发布'") && gh.includes("submitAction: { type: 'rpc', method: 'wf.initPublish'"), 'gh:remote 主动作为创建并发布向导并提交到建仓发布')
check(gh.includes("{ type: 'refresh', target: 'chain' }"), '失败知识含重查动作，推进靠重求值')
// 2) 顺序前置：无远端先建仓再初始化（中英同步）
check(gh.includes('先点「创建并发布」完成建仓推送，再执行初始化'), 'gh:remote 中文给先建仓再初始化的顺序')
check(gh.includes('First click "Create & publish" to finish creating and pushing the repo, then run initialization'), 'gh:remote 英文同步顺序')
check(gh.includes('顺序要求：无远端时先建仓并推送成功，再按初始化全文生成文件与补标签'), 'repoRemoteFix 中文给顺序要求')
check(gh.includes('Ordering rule: without a remote, create and push the repo first'), 'repoRemoteFix 英文同步顺序要求')
check(gh.includes('若仓库尚未创建，先走「创建并发布」完成建仓推送，再重查'), 'repoAccessFix 中文覆盖尚未创建分支')
check(loc.includes('向用户确认仓库名与可见性'), '初始化模板中文让 AI 先确认再建仓（话说给能动手的人）')
check(loc.includes('建仓成功并重查变绿后'), '初始化模板中文要求建成重查变绿后再继续')
check(loc.includes('confirm the repo name and visibility'), '初始化模板英文同步 AI 可执行说法')
// 3) 未污染：Markdown 模板与通用链无 GitHub 行
check(!loc.includes('setup.markdown') || !/setup\.markdown[^\n]*创建并发布/.test(loc), 'Markdown 模板未混入建仓向导')
check(!md.includes('创建并发布') || md.includes('Markdown'), 'Markdown 房未出现 GitHub 建仓文案污染')
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过 · #496 第一票顺序前置在位')
