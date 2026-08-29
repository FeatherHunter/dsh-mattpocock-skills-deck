/**
 * tests/verify-markdown-backend.js — Markdown 后端对齐契约的 G4 + 回环验证（#142 验收①②④）。
 *
 * 验收：
 *  ① harness 以真实适配器运行 + 合规断言全 PASS（G4）
 *  ② 回环：deck 创建票 → 技能集可读（同一文件集）；技能集写的文件 → 后端可归一（用 .scratch/__fixtures__ 夹具）
 *  ④ 无旧字段（number/subIssues/blocking/布尔 capabilities/detect）
 *
 * 运行：node tests/verify-markdown-backend.js
 */

import runContractTests from './tracker-contract/harness.js'
import { markdownFixture, markdownExtraAssertions } from './tracker-contract/fixtures/markdown.js'
import { parseMd } from '../src/host/tracker/backends/markdown/parse.js'
import { normalizeIssue } from '../src/host/tracker/backends/markdown/normalize.js'
import { createMarkdownBackend, matches, describe } from '../src/host/tracker/backends/markdown/index.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

let failed = false
const check = (ok, msg) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

console.log('== ① G4 契约测试（真实适配器） ==')
const harnessResults = runContractTests(markdownFixture)
let extra = markdownExtraAssertions()
let all = [...harnessResults, ...extra]

// G4 核心：合规桩全 PASS（harness 本身已断言 implemented/missing/骨架/state/diagnose）
// 但 markdownFixture 的 mappings 在 harness 中为空（因 text/meta 不是直接字段），需靠 extra 补充
for (const r of all) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
}
let hPassed = all.filter((r) => r.ok).length
let hFailed = all.filter((r) => !r.ok).length
console.log(`\nG4 harness: ${hPassed} passed, ${hFailed} failed`)
// 额外：旧字段检查（④）
console.log('\n== ④ 无旧字段检查 ==')
{
  const srcFiles = [
    'src/host/tracker/backends/markdown/index.js',
    'src/host/tracker/backends/markdown/parse.js',
    'src/host/tracker/backends/markdown/normalize.js',
    'src/host/tracker/backends/markdown/path.js',
    'src/host/tracker/backends/markdown/read.js',
    'src/host/tracker/backends/markdown/write.js',
    'src/host/tracker/backends/markdown/issues.js',
    'src/host/tracker/backends/markdown/graph.js',
    'src/host/tracker/backends/markdown/comments.js',
  ]
  for (const f of srcFiles) {
    const txt = fs.readFileSync(f, 'utf8')
    check(!/EMPTY_CAPS/.test(txt), `${f} 无 EMPTY_CAPS 布尔能力表`)
    check(!/\bdetect\s*:/.test(txt) || f.includes('matches'), `${f} 无旧 detect 字段（允许 matches）`)
    check(!/\bnumber\s*:\s*null/.test(txt) && !/Issue\.number/.test(txt), `${f} 无 number 旧字段`)
    // 允许防御性 delete 'subIssues' 检查，不视为旧字段
    check(!/subIssues\s*:\s*\[/.test(txt) && !/subIssues\s*=\s*\[/.test(txt), `${f} 无 subIssues 旧字段`)
    // blocking 作为 Issue 字段禁止，但 getDependencies 返回的 blocking 是允许的（仅检查 Issue 形状）
    if (f.endsWith('parse.js') || f.endsWith('normalize.js')) {
      check(!/['"]blocking['"]\s*:/.test(txt) && !/blocking:\s*\[/.test(txt), `${f} 无 blocking 字段（Issue 形状）`)
    }
    check(!/capabilities\s*:\s*\{/.test(txt) || /diagnoseCapabilities/.test(txt), `${f} 无布尔 capabilities 声明`)
  }
  // 平台化：路径拼接必须经 platform.path（通过 plat.join 亦可，plat 来自 platform.path）
  const pathTxt = fs.readFileSync('src/host/tracker/backends/markdown/path.js', 'utf8')
  check(pathTxt.includes('platform.path') || pathTxt.includes('plat.join'), 'path.js 经 platform.path/plat.join')
  check(!/\+ *['"]\/\.scratch/.test(pathTxt), 'path.js 无硬编码 "/.scratch" 拼接')
  check(pathTxt.includes('getRoot'), 'path.js 含 getRoot 抽象')
}

console.log('\n== ② 回环测试（同一文件集镜像） ==')
{
  // 创建临时目录模拟 deck 写 → 技能集读
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-backend-'))
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  // 模拟 BackendContext + OpContext
  const mkCtx = (cwd) => ({
    platform: plat,
    fs: plat.fs,
    cwd,
    get(name) { if (name === 'fs') return plat.fs; return undefined },
  })

  const { listIssues, createIssue } = await import('../src/host/tracker/backends/markdown/issues.js')
  const { readTextFile } = await import('../src/host/tracker/backends/markdown/read.js')
  const repo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  const ctx = mkCtx(tmp)
  // 确保 .scratch/demo 存在
  fs.mkdirSync(path.join(tmp, '.scratch', 'demo', 'issues'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  // deck 创建票
  const created = await createIssue(ctx, repo, { title: 'Deck Created Ticket', body: 'Body from deck', status: 'ready-for-agent', type: 'task' })
  check(created.ok && created.data.title === 'Deck Created Ticket', '回环① deck create → file exists')
  if (created.ok) {
    const fileList = fs.readdirSync(path.join(tmp, '.scratch', 'demo', 'issues'))
    check(fileList.some((f) => f.startsWith('02-') || f.startsWith('01-')), `回环① fileList ${fileList.join(',')}`)
    // 技能集可读：原文保留 Status/Type/Blocked by 格式
    const createdFile = fileList.find((f) => f.includes('deck-created'))
    if (createdFile) {
      const txt = fs.readFileSync(path.join(tmp, '.scratch', 'demo', 'issues', createdFile), 'utf8')
      check(txt.includes('Status: ready-for-agent'), '回环① 技能集可读：含 Status 行')
      check(txt.includes('Type: task'), '回环① 技能集可读：含 Type 行')
      check(txt.includes('## Comments'), '回环① 含 ## Comments 段')
    }
  }

  // 技能集写的文件 → 后端可归一（用 .scratch/__fixtures__ 真实样例）
  const fixtureTxt = fs.readFileSync('.scratch/__fixtures__/markdown-sample/demo-full/issues/01-hello-world.md', 'utf8')
  const parsed = parseMd(fixtureTxt, { key: '01', parentKey: '00', isMap: false })
  check(parsed.title === 'Hello World', '回环② fixture 归一 title')
  check(parsed.state === 'open', '回环② fixture state open (claimed→open)')
  check(Array.isArray(parsed.blockedBy) && parsed.blockedBy[0]?.key === '02', '回环② fixture blockedBy')
  check(Array.isArray(parsed.comments) && parsed.comments.length >= 1, '回环② fixture comments')
  check('labels' in parsed && Array.isArray(parsed.labels), '回环② fixture labels EMPTY(已实现)')
  check(parsed.labels.length===0, '回环② fixture labels empty because fixture has no Labels line')
  const norm = normalizeIssue(fixtureTxt, { key: '01', parentKey: '00', isMap: false })
  check('labels' in norm && Array.isArray(norm.labels) && norm.labels.length===0 && !('number' in norm), '回环② normalize labels EMPTY 且无旧字段')
  // 清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('  回环临时目录已清理')
}

console.log('\n== ③ 既有 verify 回归（抽样） ==')
{
  // 抽样检查 platform 契约仍通过（与 npm run verify 一致的零手拼断言）
  const platIdx = fs.readFileSync('src/host/platform/index.js', 'utf8')
  check(platIdx.includes("import win32 from './win32/index.js'"), '回归抽样 platform 静态 import 仍存在')
  const deckDerive = fs.readFileSync('src/shared/tracker/deck-derive.js', 'utf8')
  check(deckDerive.includes('parseProgress'), '回归抽样 deck-derive 仍存在')
}

if (failed || hFailed > 0) {
  console.log('\n存在失败 — verify-markdown-backend 未通过')
  process.exit(1)
}
console.log('\n全部通过 — Markdown 后端对齐契约（G4+回环+无旧字段）')