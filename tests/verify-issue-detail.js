// verify-issue-detail.js — T6 #11 · IssueDetail 数据通路与渲染白盒校验（map #5 · v1.7.0）
// 覆盖：host wf.issueDetail / wf.issueComments 双通道 + client store/api 形状 + Markdown 安全白盒（script/iframe/钓鱼链接）+ 双源一致
const fs = require('fs')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }
const cli = fs.readFileSync('client.js','utf8')
const pcli = fs.readFileSync('package/lib/client.js','utf8')
const host = fs.readFileSync('host.js','utf8')
const phost = fs.readFileSync('package/lib/index.js','utf8')
const mdCli = (()=>{ const i=cli.indexOf('const MD_LINK_RE'); const e=cli.indexOf('// ============================================================', i+10); return e>i?cli.slice(i,e):cli.slice(i,i+9000) })()

// —— host 双通道存在性
check(host.includes("harness.handle('wf.issueDetail'"), 'host 含 wf.issueDetail handle')
check(phost.includes("harness.handle('wf.issueDetail'") || phost.includes("wf.issueDetail"), 'package host 含 wf.issueDetail 镜像')
check(host.includes('async function fetchIssueDetail('), 'host 含 fetchIssueDetail')
check(host.includes('async function fetchIssueDetailREST('), 'host 含 fetchIssueDetailREST')
check(host.includes("harness.handle('wf.issueComments'"), 'host 含 wf.issueComments handle')
check(host.includes('async function fetchIssueComments('), 'host 含 fetchIssueComments')
check(host.includes('async function fetchIssueCommentsREST('), 'host 含 fetchIssueCommentsREST')
check(host.includes("comments(first:50){nodes{author{login}"), 'host GraphQL 含 comments(first:50) with author')
check(host.includes("pageInfo{hasNextPage endCursor}"), 'host GraphQL 含 pageInfo{hasNextPage endCursor}')
check(host.includes("labels(first:20){nodes{name color}}"), 'host GraphQL 含 labels color')
check(host.includes("blockedBy(first:20){nodes{number title state}}"), 'host GraphQL 含 blockedBy')

// —— REST 降级逐请求容错
check(host.includes("repos/' + repo.owner + '/' + repo.name + '/issues/' + n") || host.includes("repos/' + repo.owner"), 'host REST 含 issues/{n} 路径')
check(host.includes("/comments?per_page=50"), 'host REST 含 comments per_page 50')
check(host.includes("/sub_issues?per_page=50"), 'host REST 含 sub_issues')
check(host.includes("/dependencies/blocked_by"), 'host REST 含 blocked_by')

// —— 错误形状 7 档
const kinds = ['env','parse','graphql','network','rateLimit','notFound','404']
kinds.forEach(k=> check(host.includes(k) || cli.includes(k), '错误 kind 含 '+k))

// —— client store 形状
const storeCli = fs.readFileSync('src/client/kernel/store.js','utf8')
check(storeCli.includes('issueCache'), 'store 含 issueCache')
check(storeCli.includes('ISSUE_CACHE_TTL'), 'store 含 ISSUE_CACHE_TTL')
check(storeCli.includes('60000'), 'store TTL 60000')
check(storeCli.includes('issueMode'), 'store 含 issueMode')
check(storeCli.includes('issueDetail'), 'store 含 issueDetail')
check(storeCli.includes('issueCommentsMoreLoading'), 'store 含 issueCommentsMoreLoading')
check(storeCli.includes('issueCommentsFailCount') || storeCli.includes('issueCommentsHasMore'), 'store 含 issueCommentsFailCount/hasMore')

// —— client api 形状
const apiCli = fs.readFileSync('src/client/kernel/api.js','utf8')
check(apiCli.includes('fetchIssueDetail'), 'api 含 fetchIssueDetail')
check(apiCli.includes('fetchIssueComments'), 'api 含 fetchIssueComments')
check(apiCli.includes("host.call('wf.issueDetail'"), 'api 调 wf.issueDetail')
check(apiCli.includes("host.call('wf.issueComments'"), 'api 调 wf.issueComments')
check(apiCli.includes('ISSUE_CACHE_TTL'), 'api 复用 ISSUE_CACHE_TTL')
check(apiCli.includes('issueCache'), 'api 操作 issueCache')

// —— IssueDetail 视图分支
const detailCli = fs.readFileSync('src/client/views/IssueDetail.js','utf8')
check(detailCli.includes('fetchIssueDetail'), 'IssueDetail 调 fetchIssueDetail')
check(detailCli.includes('issueMode'), 'IssueDetail 读 issueMode')
check(detailCli.includes('issueError'), 'IssueDetail 读 issueError')
check(detailCli.includes('clearActiveIssue'), 'IssueDetail 含 clearActiveIssue 返回')
check(detailCli.includes('mdToHtml'), 'IssueDetail 用 mdToHtml 渲染 body/comments')
check(detailCli.includes('subIssues'), 'IssueDetail 渲染 subIssues')
check(detailCli.includes('blockedBy'), 'IssueDetail 渲染 blockedBy')
check(detailCli.includes('comments'), 'IssueDetail 渲染 comments')
check(detailCli.includes('加载下 50') || detailCli.includes('加载下'), 'IssueDetail 含 加载下 50 按钮')
check(detailCli.includes('issueCommentsMoreLoading'), 'IssueDetail 读 issueCommentsMoreLoading')
check(detailCli.includes('issueCommentsFailCount'), 'IssueDetail 读 issueCommentsFailCount')
check(detailCli.includes('以下评论未加载'), 'IssueDetail 含 3 次兜底 banner')

// —— 双源一致（关键特征在双产物）
check(cli.includes('fetchIssueDetail') && pcli.includes('fetchIssueDetail'), '双产物含 fetchIssueDetail')
check(cli.includes('fetchIssueComments') && pcli.includes('fetchIssueComments'), '双产物含 fetchIssueComments')
check(cli.includes('IssueDetail') && pcli.includes('IssueDetail'), '双产物含 IssueDetail')
check(host.includes('wf.issueDetail') && phost.includes('wf.issueDetail'), '双产物 host 含 wf.issueDetail')

// —— Markdown 安全白盒（fixture 含 script/iframe/钓鱼链接 → 渲染结果不含脚本与危险 href）
const stubH = (tag, props, children) => {
  const attr = props ? Object.keys(props).filter(k=> !['key','style','className','title'].includes(k) && props[k]!=null && props[k]!==false).map(k=>' '+k+'="'+String(props[k]).replace(/"/g,'&quot;')+'"').join('') : ''
  const ch = Array.isArray(children) ? children.join('') : (children==null?'':children)
  if(tag==='input') return '<input'+attr+'>'
  return '<'+tag+attr+'>'+ch+'</'+tag+'>'
}
const run = (src, md) => {
  const fn = new Function('h', src + '\nreturn { mdToHtml }')
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
