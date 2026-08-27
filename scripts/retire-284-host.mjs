import fs from 'node:fs'

const p = 'src/host/index.js'
let lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)

function del(from, to) {
  if (from > to) { const t = from; from = to; to = t }
  lines = lines.slice(0, from - 1).concat(lines.slice(to))
}

del(2750, 2750)
del(1940, 1940)
del(1789, 1822)
del(1574, 1787)
del(1505, 1555)
del(1323, 1323)
del(58, 58)
del(12, 13)

const out = lines.join('\r\n')
let txt = out

// 头注释行 11
const m = txt.match(/^ \*   5\. 前置检查绿点（#344）：wf\.status[\s\S]*?。$/m)
if (!m) throw new Error('head comment not found')
txt = txt.replace(m[0], ' *   5. 检查链快照（#228/#284）：wf.chain —— 通用链 + 当前后端链求值快照，替代九格目录视图。')

// STATUS_CACHE_MS 注释
txt = txt.replace('    const STATUS_CACHE_MS = 30000  // 前置检查结果缓存（#344）', '    const STATUS_CACHE_MS = 30000  // workspaceStore 探测级联 TTL（#344 沿革 · #284 保留）')

// resetGhCache 行
txt = txt.replace("    function resetGhCache() { ghPath = null; ghLastError = null; statusCache = { ts: 0, status: null, error: null, cwd: null, lang: null, backendId: null }; try { if (_workspaceStore && typeof _workspaceStore.clear === 'function') _workspaceStore.clear(); } catch {} try { getWorkspaceStore().then(function(ws){ try{ ws.clear(); }catch(e){} }).catch(function(){}); } catch {} }", "    function resetGhCache() { ghPath = null; ghLastError = null; try { if (_workspaceStore && typeof _workspaceStore.clear === 'function') _workspaceStore.clear(); } catch {} try { getWorkspaceStore().then(function(ws){ try{ ws.clear(); }catch(e){} }).catch(function(){}); } catch {} }")

// 小节标题
txt = txt.replace('    // ============ 前置检查（#344 · wf.status）============', '    // ============ git 远程解析（getRepoKey 与后端谓词复用，#284）============')

// 失效收口注释（注意保持 CRLF）
txt = txt.replace('    // 失效广播的统一收口：探针计数 + statusCache + 检测级联缓存（workspaceStore）一并失效，\r\n    // 保证事件到达后下一次 wf.status（无需 force）即全量重判——否则 detect 的 store 快照会冻住旧 skillProbes。', '    // 失效广播的统一收口：探针计数 + 检测级联缓存（workspaceStore）一并失效，\r\n    // 保证事件到达后下一步 wf.chain/wf.detect（无需 force）即全量重判——否则 detect 的 store 快照会冻住旧 skillProbes。')

// RPC 注释
txt = txt.replace('    // ============ RPC（#152 · 探测编排：wf.detect 新 RPC + wf.status 薄兼容派生）============', '    // ============ RPC（#152 · 探测编排：wf.detect 新 RPC + wf.chain 检查链快照）============')
txt = txt.replace('    // 第一性原理：前端只调 wf.detect/wf.status 拿 DetectionResult（#150 Q1）；探测零 OS 直碰经 platform；', '    // 第一性原理：前端只调 wf.detect/wf.chain 拿 DetectionResult（#150 Q1）；探测零 OS 直碰经 platform；')

// 插入 helpers
const anchor = '      return { owner: m[1], name: m[2] }\r\n    }'
if (!txt.includes(anchor)) throw new Error('parseGithubRepo anchor not found')
const helpers = anchor + '\r\n\r\n' + '    // #284：markdown 后端谓词：本地图谱可解析（复用 backends/markdown/parse.js parseMd）\r\n' + '    async function mdParseOkPredicate(platform, cwd) {\r\n      try {\r\n        const hasMap = await fileExistsChainRel(platform, cwd, ".scratch/map.md")\r\n        if (hasMap !== true) return { status: "fail", detail: ".scratch/map.md missing — created by initialization" }\r\n        const abs = await platform.fs.resolve(".scratch/map.md", { cwd: cwd })\r\n        const text = await platform.fs.readText(abs)\r\n        const mod = await import("./backends/markdown/parse.js")\r\n        const parseMd = mod.parseMd || mod.default\r\n        if (typeof parseMd === "function") { parseMd(String(text || ""), {}); return { status: "pass", detail: "local map parses OK" } }\r\n        return { status: "pending", detail: "parseMd not exported" }\r\n      } catch (e) { return { status: "fail", detail: "local map parse failed: " + String((e && e.message) || e) } }\r\n    }\r\n' + '    async function fileExistsChainRel(platform, cwd, rel) {\r\n      try {\r\n        if (!platform || !platform.fs || typeof platform.fs.resolve !== "function") return null\r\n        const abs = await platform.fs.resolve(rel, { cwd: cwd })\r\n        if (typeof platform.fs.exists === "function") return (await platform.fs.exists(abs)) === true\r\n        if (typeof platform.fs.readText === "function") { try { await platform.fs.readText(abs); return true } catch { return false } }\r\n        if (typeof platform.fs.lstat === "function") { try { const info = await platform.fs.lstat(abs); return !!info } catch { return false } }\r\n        return null\r\n      } catch (e) { return false }\r\n    }'
txt = txt.replace(anchor, helpers)

fs.writeFileSync(p, txt, 'utf8')
console.log('done, total lines =', txt.split(/\r?\n/).length)
