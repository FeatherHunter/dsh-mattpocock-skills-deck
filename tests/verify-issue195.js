// verify-issue195.js — BUG #195 修复契约（原「第二轮：分层多态正确架构」）
// 用法: node tests/verify-issue195.js [file...]
//
// #663 改写说明（这张票把这门禁收回了 npm run verify 链上，之前它因为几条与代码脱节的断言一直是红的）：
//   #195 当初要的是「缺 gh cli 时点一下按钮，要给出能照着做的安装指引」。这条要求在首开引导链定版（#661）
//   之后换了承担者 —— 注入的文案收成维护者给的那句原话（逐字固定，住在 src/shared/tracker/guide-steps.js
//   的 gh:installed 那一步），界面那颗按钮从清单里取它注入，不再读链上这一项的 show.hint
//   （那句话在一次改写里已被降成一句陈述句，点一下等于什么都没给 —— 这正是本票按缺陷修的那一处）。
//   行为金样在 tests/verify-663-gh-install-inject.js；本文件钉的是跨文件的这几条老契约不许回退。
// 保留的：#195 当年修的 gh 探测缓存与 checksums 那几个读数口径里仍然成立的部分（`let ghPathError` 永久缓存
//   不许回来、ghLastError 与 resetGhCache 要在、没有「安装副按钮」外链、没有 installGh 提示词键）。
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js', 'host.js', 'package/lib/index.js', 'src/host/tracker/contract.js', 'src/host/tracker/backends/github/preflight.js']
let failed = false

// 缺 gh cli 时注入的那句原话（与清单里逐字一致；金样比对在 verify-663-gh-install-inject.js）。
const GH_INSTALL_ORIGINAL = '/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/'

function check(file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  const isClient = /client\.js$/.test(file)
  const isHost = /index\.js$/.test(file) || /host\.js$/.test(file)
  const isContract = /contract\.js$/.test(file)
  const isPreflight = /preflight\.js$/.test(file)

  if (isContract) {
    if (!src.includes("prompt")) problems.push("Contract: PreflightResult 缺 prompt 字段")
  }

  if (isPreflight) {
    // 这段预检长文（GH_INSTALL_PROMPT）只要还留着，就必须仍是能照着做的那一份；它整体退役（连同 noGhPrompt）
    // 由 #664 办 —— 退役之后这一个分支自然不生效，不必再改本文件。
    if (src.includes("GH_INSTALL_PROMPT")) {
      if (!src.includes("prompt: GH_INSTALL_PROMPT")) problems.push("Backend: 带着 GH_INSTALL_PROMPT 却没把它放进预检结果（半截状态）")
      if (!src.includes("winget") || !src.includes("brew")) problems.push("Backend: GH_INSTALL_PROMPT 缺 winget/brew（既留着就得是能照着做的那一份）")
      if (!src.includes("gh --version")) problems.push("Backend: GH_INSTALL_PROMPT 缺 gh --version")
    }
  }

  if (isHost) {
    if (/let ghPathError/.test(src)) problems.push("Host: 仍有 ghPathError 永久缓存")
    if (!/let ghLastError/.test(src)) problems.push("Host: 缺 ghLastError")
    if (!/resetGhCache/.test(src)) problems.push("Host: 缺 resetGhCache")
    if (src.includes("hint: 'prompt:installGh'")) problems.push("Host: 仍有 hint: 'prompt:installGh' key 硬编码")
    // #663 改写（原「宿主把预检的 prompt 透传进链」那一条）：新流程里缺 gh 的注入文案由界面从清单取，
    //   宿主不再需要往链上塞一份提示词。这里反过来钉住旧链路不许回来 —— 回来就等于同一个缺失状态又有两份说明。
    if (src.includes("det.preflight.prompt") || src.includes("promptFromBackend")) problems.push("Host: 又出现「把预检提示词透传进链」的旧链路（缺 gh 的文案应由清单里那句原话承担）")
  }

  if (isClient) {
    if (src.includes('"installGh"') || src.includes("'installGh'")) problems.push("UI: PROMPTS 仍有 installGh（应由后端提供）")
    if (src.includes("ghcliFallback")) problems.push("UI: 仍有 banner.ghcliFallback（副按钮已移除）")
    if (src.includes("promptText('installGh')") || src.includes('promptText("installGh")')) problems.push("UI: 仍有 promptText('installGh')")
    // gh 安装那颗按钮不许变成「只外跳官网」的副按钮（原来那条外链已移除，登录那条有它自己的链接）
    const ghInstallOpenUrl = (src.match(/openUrl\('https:\/\/cli\.github\.com\/'\)/g) || []).length
    if (ghInstallOpenUrl > 0) problems.push("UI: 仍有 openUrl('https://cli.github.com/') 副按钮（应移除） - found " + ghInstallOpenUrl)
    // #663 改写（原「ghCliBad 未改为 level === 'bad'」那一条，那条断言的是链快照之前的老口径）：
    //   状态栏那条横幅改由首开引导链清单派生，手写优先级读数 ghCliBad 已经删除。
    if (!src.includes("guideBannerStep")) problems.push("UI: 状态栏横幅没按首开引导链清单取（缺 guideBannerStep）")
    if (src.includes("ghCliBad")) problems.push("UI: 又出现手写优先级读数 ghCliBad（横幅应读共享清单）")
    // 缺 gh 时那颗按钮必须真的给得出东西：那句原话要随构建进到客户端产物里。
    if (src.indexOf(GH_INSTALL_ORIGINAL) < 0) problems.push("UI: 缺 gh 时注入的那句原话不在客户端产物里（点一下又等于什么都没给）")
  }

  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file)
}

console.log('#195 修复契约（#663 改写后：缺 gh 的文案收成清单里那句原话 + 老契约里仍成立的部分）')
targets.forEach(check)
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
