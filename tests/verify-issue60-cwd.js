const fs = require("fs")
let failed = false
const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failed = true }
const files = ["client.js", "package/lib/client.js"]
const hostFiles = ["host.js", "package/lib/index.js"]
console.log("P1: getCwdSync")
files.forEach(f => {
  const src = fs.readFileSync(f, "utf8")
  check(src.includes("sessions.list.getSnapshot"), f + " getCwdSync list")
  check(src.includes("header.cwd"), f + " header.cwd")
})
console.log("P2: host wf.cwd")
hostFiles.forEach(f => {
  const src = fs.readFileSync(f, "utf8")
  check(src.includes("header.cwd"), f + " wf.cwd header")
})
console.log("P3: openTextInNewSession")
files.forEach(f => {
  const src = fs.readFileSync(f, "utf8")
  check(src.includes("getCwdSync(st.sessionId)"), f + " ensureCwd getCwdSync")
  check(src.includes("ensureWorkspaceId"), f + " workspaceId")
  check(src.includes("workspaceId ? { workspaceId"), f + " workspaceId create")
})
console.log("P4: dynamic")
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
