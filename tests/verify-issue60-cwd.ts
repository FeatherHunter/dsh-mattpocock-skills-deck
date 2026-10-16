// verify-issue60-cwd.ts — 会话工作目录（cwd）的取值次序：先同步读 sessions.list，拿到就回写 st.cwd；
// 同步取不到才继续走 host 的 wf.cwd 调用兜底。次序反过来会让缓存键用上过期目录（#60）。
// 手法：compileFn——从产品源码 src/client/kernel/api-new-session.js 里切出真的 ensureCwd，放进沙箱跑，
//   断言的是真源码跑出来的结果，不是这段算法的手抄副本。
// 运行：node --import ./scripts/ts-hook.mjs tests/verify-issue60-cwd.ts
let failed: boolean = false
const check = (ok: boolean, msg: string) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failed = true }

const fs = require('fs')
const { compileFn } = require('./lib/eval-probe.js')

const API_SRC = 'src/client/kernel/api-new-session.js'

// 从真源码里切出 ensureCwd（起点是它的声明，终点是它在同文件里被调用的那一行）。
function extractEnsureCwd(src: string): string {
  const start = src.indexOf('const ensureCwd = function () {')
  if (start < 0) throw new Error('起始锚点缺失: ensureCwd')
  const end = src.indexOf('      ensureCwd().then', start)
  if (end < 0) throw new Error('终止锚点缺失: ensureCwd().then')
  return src.slice(start, end)
}

console.log("dynamic: ensureCwd 取值次序")
async function dynamic() {
  const src = fs.readFileSync(API_SRC, 'utf8')
  const make = compileFn(['st', 'host', 'getCwdSync'], extractEnsureCwd(src) + '\nreturn ensureCwd')

  // 断言 1：同步读到权威 cwd 就立刻回写 st.cwd（缓存键靠这次回写），且不再打扰 host。
  {
    const st = { cwd: "", sessionId: "sid-1" }
    let hostCalls = 0
    const host = { call: () => { hostCalls++; return Promise.resolve({ ok: false }) } }
    const getCwdSync = (sid: string) => (sid === "sid-1" ? "D:\\repo\\a" : "")
    const cwd = await make(st, host, getCwdSync)()
    check(cwd === "D:\\repo\\a" && st.cwd === "D:\\repo\\a" && hostCalls === 0, "同步命中权威 cwd，回写 st.cwd 且不问 host")
  }

  // 断言 2：同步取不到时走 host 的 wf.cwd 调用兜底，并把结果回写 st.cwd。
  {
    const st = { cwd: "", sessionId: "sid-2" }
    let asked: { method: string; args: { sessionId: string } } | null = null
    const host = { call: (method: string, args: { sessionId: string }) => { asked = { method, args }; return Promise.resolve({ ok: true, cwd: "D:\\repo\\b" }) } }
    const cwd = await make(st, host, () => "")()
    check(cwd === "D:\\repo\\b" && st.cwd === "D:\\repo\\b" && !!asked && asked.method === "wf.cwd" && asked.args.sessionId === "sid-2", "同步取不到时走 host 兜底并回写")
  }
}
dynamic().then(() => {
  if (failed) { console.log("\nFAIL"); process.exit(1) }
  console.log("\nAll PASS")
}).catch((e: unknown) => { console.error('RUNNER ERROR:', e); process.exit(2) })
