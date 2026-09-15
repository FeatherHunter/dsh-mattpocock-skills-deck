// verify-workspace-id-tolerant.js — 工作区编号查找的 DSH 升级兼容（#638 回归：所有新会话入口丢工作区；#636 起查找逻辑住在 api-workspace.js）
// 用法: node tests/verify-workspace-id-tolerant.js
// 验证 src 真源含兼容点：路径读 handle 与别名、编号读 handle 嵌套与大小写变体、
// 快照收 rows/data/workspacesById/entries、创建按别名逐个试探且接受字符串返回。
// 查找类断言读 api-workspace.js，复用门与薄转发断言读 api-new-session.js。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
let failed = false
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const wsSrc = fs.readFileSync(path.join(root, 'src/client/kernel/api-workspace.js'), 'utf8')
const nsSrc = fs.readFileSync(path.join(root, 'src/client/kernel/api-new-session.js'), 'utf8')
check(wsSrc.indexOf('w.handle') >= 0, '路径与编号读 handle')
check(wsSrc.indexOf('workspaceID') >= 0, '编号含大小写变体 workspaceID')
check(wsSrc.indexOf('snap.rows') >= 0, '快照收 rows')
check(wsSrc.indexOf('snap.data') >= 0, '快照收 data 包裹')
check(wsSrc.indexOf('workspacesById') >= 0, '快照收 workspacesById')
check(wsSrc.indexOf('snap.entries') >= 0, '快照收 entries')
check(wsSrc.indexOf('{ workspacePath: cwd }') >= 0, '创建试探 workspacePath 别名')
check(wsSrc.indexOf('{ directory: cwd }') >= 0, '创建试探 directory 别名')
check(wsSrc.indexOf('runAt(i + 1)') >= 0, '创建别名按序试探')
check(wsSrc.indexOf('typeof ws ===') >= 0 && wsSrc.indexOf('string') >= 0, '接受字符串编号返回')
// 复用门（僵尸空白不再复活）：登记项带回整项，复用凭名单验归属，含当前会话自复用
check(wsSrc.indexOf('workspaceMatchEntry') >= 0, '按路径找登记项带回整项')
check(nsSrc.indexOf('resolveWorkspaceEntry') >= 0, '新会话经薄转发调工作区查找')
check(nsSrc.indexOf('allowReuse') >= 0, '复用凭归属放行')
check(nsSrc.indexOf('sessionIds') >= 0 && nsSrc.indexOf('indexOf(sid)') >= 0, '凭登记项名单验归属')
check(nsSrc.indexOf('allowReuse(curSid)') >= 0, '当前会话自复用同样验归属')
check(wsSrc.indexOf('wid: w') >= 0 || wsSrc.indexOf('wid:w') >= 0, '编号与登记项同路返回')
if (failed) { console.log('\n存在失败 — verify-workspace-id-tolerant 未通过'); process.exit(1) }
console.log('\n全部通过 — 工作区编号升级兼容生效')
