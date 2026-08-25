// verify-issue195.js — BUG #195 修复契约（第二轮：分层多态正确架构）
// 用法: node tests/verify-issue195.js [file...]
// 验证第二轮架构：
//   - 契约层 PreflightResult 有 prompt 字段
//   - 后端层 ghPreflight 提供完整 prompt（winget/brew/apt/gh --version）
//   - 派生层 host 透传 backend prompt 到 c4.hint（非 prompt:installGh key）
//   - UI 协议层 actBtn 直接 inject(hint)（非 prompt: 协议）
//   - UI 层 PROMPTS 无 installGh（后端持有文案）
//   - UI 层 5处接线改为 inject(hint) 且无 openUrl 副按钮
//   - i18n 无 banner.ghcliFallback
//   - 探测层 ghLastError + resetGhCache + checksums warn 修复保留

const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js', 'host.js', 'package/lib/index.js', 'src/host/tracker/contract.js', 'src/host/tracker/backends/github/preflight.js']
let failed = false

function check(file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  const isClient = /client\.js$/.test(file)
  const isHost = /index\.js$/.test(file) || /host\.js$/.test(file)
  const isContract = /contract\.js$/.test(file)
  const isPreflight = /preflight\.js$/.test(file)

  if (isContract) {
    if (!/prompt.*string.*\]/.test(src) && !/\*\*.*prompt/.test(src)) {
      // loose check for prompt field
      if (!src.includes("prompt")) problems.push("Contract: PreflightResult 缺 prompt 字段")
    }
    if (!src.includes("prompt")) problems.push("Contract: 缺 prompt")
  }

  if (isPreflight) {
    if (!src.includes("GH_INSTALL_PROMPT")) problems.push("Backend: 缺 GH_INSTALL_PROMPT 常量")
    if (!src.includes("prompt: GH_INSTALL_PROMPT")) problems.push("Backend: ghPreflight 未返回 prompt: GH_INSTALL_PROMPT")
    if (!src.includes("winget") || !src.includes("brew")) problems.push("Backend: prompt 缺 winget/brew")
    if (!src.includes("gh --version")) problems.push("Backend: prompt 缺 gh --version")
  }

  if (isHost) {
    if (/let ghPathError/.test(src)) problems.push("Host: 仍有 ghPathError 永久缓存")
    if (!/let ghLastError/.test(src)) problems.push("Host: 缺 ghLastError")
    if (!/resetGhCache/.test(src)) problems.push("Host: 缺 resetGhCache")
    if (src.includes("hint: 'prompt:installGh'")) problems.push("Host: 仍有 hint: 'prompt:installGh' key 硬编码（应为后端 prompt 直传）")
    if (!src.includes("det.preflight") || !src.includes("prompt")) {
      // check for hint = promptFromBackend
      if (!src.includes("promptFromBackend") && !src.includes("det.preflight.prompt")) problems.push("Host: 未透传 det.preflight.prompt 到 c4.hint")
    }
  }

  if (isClient) {
    if (src.includes('"installGh"') || src.includes("'installGh'")) problems.push("UI: PROMPTS 仍有 installGh（应由后端提供）")
    if (src.includes("ghcliFallback")) problems.push("UI: 仍有 banner.ghcliFallback（副按钮已移除）")
    // ChecksTab should not have promptText('installGh')
    if (src.includes("promptText('installGh')") || src.includes('promptText("installGh")')) problems.push("UI: 仍有 promptText('installGh')（应为 inject(hint)）")
    // Should have inject with hint
    if (!src.includes("ghCli2 && ghCli2.hint") && !src.includes("ghCli2.hint")) {
      // only check ChecksTab
      if (file.includes("client.js") && !src.includes("ghCli2")) {
        // not all client files have ghCli2
      } else if (file.includes("client.js")) {
        // Check for hint usage
        const hasHintInject = src.includes("inject(st, h)") || src.includes("inject(s, h)") || src.includes("inject(st, hint)")
        if (!hasHintInject) problems.push("UI: ChecksTab/StatusBar 未改为 inject(hint)（后端透传）")
      }
    }
    // Should NOT have openUrl fallback for gh install (ChecksTab top banner)
    // We check that openUrl('https://cli.github.com/') for gh install is gone, but ghauth still has it (allowed)
    // Count occurrences - gh install openUrl should be 0, ghauth openUrl remains
    const ghInstallOpenUrl = (src.match(/openUrl\('https:\/\/cli\.github\.com\/'\)/g) || []).length
    const ghauthOpenUrl = (src.match(/openUrl\('https:\/\/cli\.github\.com\/manual\/gh_auth_login'\)/g) || []).length
    // gh install openUrl should be 0 (removed), ghauth may remain (out of scope for this ticket)
    // But we allow 0 or 1? Actually after fix, gh install openUrl should be 0
    if (ghInstallOpenUrl > 0) problems.push("UI: 仍有 openUrl('https://cli.github.com/') 副按钮（应移除） - found " + ghInstallOpenUrl)
    // checksums fix should remain
    if (!/ghCliBad = .*level === 'bad'/.test(src)) problems.push("UI: ghCliBad 未改为 level === 'bad'")
  }

  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file)
}

console.log('P1: #195 第二轮修复契约（分层多态正确架构）')
targets.forEach(check)
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
