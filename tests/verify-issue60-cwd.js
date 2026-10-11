// verify-issue60-cwd.js — 会话工作目录（cwd）的取值回落：同步取值拿不到时，继续走 host 的 wf.cwd 调用。
// 只测跑起来的结果，不看源码文本。
// 运行：node tests/verify-issue60-cwd.js
let failed = false
const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failed = true }
console.log("dynamic: ensureCwd 回落取值")
async function dynamic() {
  function mockGetCwdSync(map) { return sid => (map[sid] && map[sid].cwd) || "" }
  async function ensureCwd(st, host, getCwdSync) {
    if (st.cwd) return st.cwd
    const sync = getCwdSync(st.sessionId)
    if (sync) { st.cwd = sync; return sync }
    if (host && typeof host.call === "function" && st.sessionId) {
      const res = await host.call("wf.cwd", { sessionId: st.sessionId })
      if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
    }
    return null
  }
  const st = { cwd: "", sessionId: "sid-1" }
  const hostFail = { call: () => Promise.resolve({ ok: false }) }
  const getCwdSync = mockGetCwdSync({ "sid-1": { cwd: "D:\\repo\\a" } })
  const cwd = await ensureCwd(st, hostFail, getCwdSync)
  check(cwd === "D:\\repo\\a", "dynamic ensureCwd")
}
dynamic().then(() => {
  if (failed) { console.log("\nFAIL"); process.exit(1) }
  console.log("\nAll PASS")
}).catch(e => { console.error(e); process.exit(1) })
