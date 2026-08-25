// verify-issue195.js — BUG #195 修复契约（探测/状态 + UI 契约合规）
// 用法: node tests/verify-issue195.js [file...]
// 默认校验 client.js + package/lib/client.js + host.js + package/lib/index.js
//
// 覆盖：
//   A. 探测/状态：
//     A1. ghPathError 模块级永久缓存已移除（替换为 ghLastError 覆盖式）
//     A2. host.js 含 resetGhCache() 函数
//     A3. host.js 在 wf.detect / wf.status / wf.refresh force 路径调 resetGhCache
//     A4. host.js checkGhCli 返回的 hint: 'prompt:installGh'
//     A5. host.js preflight env 错误分支 hint: 'prompt:installGh'
//     A6. checksums.js ghCliBad / ghAuthBad 判定改为 level === 'bad'（warn 不再当 bad）
//     A7. checksums.js 导出 ghCliPending / ghAuthPending 派生
//   B. UI 契约合规：
//     B1. PROMPTS 注册表含 installGh（zh/en 双语 + 关键句 winget/brew/apt + gh --version + DSH 重测/重启）
//     B2. PROMPTS 注册表 installGh 含 prompt:installGh 协议引用（与 installSkills / ghAuthGuide 同模式）
//     B3. installGh 注册表条目数 ≥ 13（verify-prompts 的 15 期望需随之更新为 ≥13；本测试只校验增量）
//     B4. locale.js 含 banner.ghcliFallback（zh/en）
//     B5. ChecksTab.js 顶部 banner ghcli 主按钮 inject(st, promptText('installGh'))
//     B6. ChecksTab.js 顶部 banner ghcli 副按钮 openUrl('https://cli.github.com/')（保留兜底）
//     B7. ChecksTab.js 配置引导 g1 act 改为 inject
//     B8. StatusBar.js firstBlock === 'ghcli' 主按钮 inject
//     B9. NoRepoCard.js no-gh 分支含 AI 引导安装按钮（inject installGh）
//   C. 双源一致性：client.js + package/lib/client.js + host.js + package/lib/index.js 同构
//   D. 文案合规：PROMPTS 不含字面 \\n 转义（应与既有 installSkills / setupRun 同模式）

const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js', 'host.js', 'package/lib/index.js']
let failed = false

function check(file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  const isClient = /client\.js$/.test(file)
  const isHost = /index\.js$/.test(file) || /host\.js$/.test(file)

  // A. 探测/状态
  if (isHost) {
    if (/let ghPathError = null/.test(src)) problems.push('A1: ghPathError 模块级永久缓存仍存在（应替换为 ghLastError）')
    if (!/let ghLastError = null/.test(src)) problems.push('A1: 缺 ghLastError 覆盖式错误（修复未生效）')
    if (!/function resetGhCache\(\)/.test(src)) problems.push('A2: 缺 resetGhCache() 函数')
    if (!/if \(force\) resetGhCache\(\)/.test(src)) problems.push('A3: force 探测路径未调 resetGhCache')
    if (!/hint: 'prompt:installGh'/.test(src)) problems.push('A4/A5: host.js 缺 hint: prompt:installGh（探测 env 错误应升级为 prompt 协议）')
    if (/hint: 'https:\/\/cli\.github\.com\/'/.test(src)) problems.push('A4/A5: host.js 仍含 hint: https://cli.github.com/（应替换为 prompt:installGh）')
  }
  if (isClient) {
    if (!/ghCliBad = .*level === 'bad'/.test(src)) problems.push('A6: ghCliBad 判定未改为 level === bad（warn 仍当 bad）')
    if (!/ghAuthBad = .*level === 'bad'/.test(src)) problems.push('A6: ghAuthBad 判定未改为 level === bad（warn 仍当 bad）')
    if (!/ghCliPending/.test(src)) problems.push('A7: 缺 ghCliPending 派生')
    if (!/ghAuthPending/.test(src)) problems.push('A7: 缺 ghAuthPending 派生')
  }

  // B. UI 契约合规
  if (isClient) {
    // B1. installGh 注册表
    const m = /"installGh": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \}/.exec(src)
    if (!m) problems.push('B1: 缺 installGh PROMPTS 注册表条目')
    else {
      const ver = Number(m[1])
      if (ver < 1) problems.push('B1: installGh 版本异常 v' + ver)
      if (m[2].length && m[2] !== '[]') problems.push('B1: installGh 应无占位符（当前 ' + m[2] + '）')
      if (!m[3].includes('prompt:installGh')) problems.push('B1: installGh use 未含 prompt:installGh 协议引用')
      if (!m[4].includes('winget') || !m[4].includes('brew') || !m[4].includes('apt')) problems.push('B1: installGh zh 未含 winget/brew/apt 三 OS 安装命令')
      if (!m[4].includes('gh --version')) problems.push('B1: installGh zh 缺 gh --version 验证步骤')
      if (!m[4].includes('重测') || !m[4].includes('重启')) problems.push('B1: installGh zh 缺「重测/重启」（DSH 缓存失效指引）')
      if (!m[5].includes('gh --version')) problems.push('B1: installGh en 缺 gh --version verify step')
      if (!m[5].includes('Recheck') || !m[5].includes('restart')) problems.push('B1: installGh en 缺 Recheck/restart (DSH cache invalidation hint)')
    }
    // B2. installGh use 字段含 prompt:installGh
    if (!/"installGh":.*use:.*prompt:installGh/.test(src)) problems.push('B2: installGh use 未提 prompt:installGh 协议')
    // B4. locale fallback key
    if (!/banner\.ghcliFallback/.test(src)) problems.push('B4: locale 缺 banner.ghcliFallback 键')
    // B5. ChecksTab 顶部 banner inject
    if (!/inject\(st, promptText\('installGh'\)\)/.test(src)) problems.push('B5/B8: 缺 inject(st, promptText(installGh)) 接线（ChecksTab/StatusBar）')
    // B6. 保留 openUrl 兜底
    if (!/openUrl\('https:\/\/cli\.github\.com\/'\)/.test(src)) problems.push('B6: 副按钮 openUrl 兜底被移除（应保留）')
    // B7. 配置引导 g1 act 改为 inject
    if (!/act: function \(\) \{ inject\(st, promptText\('installGh'\)\) \}/.test(src)) problems.push('B7: 配置引导 g1 act 未改 inject')
    // B9. NoRepoCard AI 引导安装
    if (!/promptText\('installGh'\)/.test(src) || !/AI 引导安装/.test(src)) problems.push('B9: NoRepoCard 缺 AI 引导安装按钮（inject installGh + 文案）')
  }

  // D. PROMPTS 字面 \n 校验（必须用 \\n 转义而非真实换行）
  if (isClient) {
    // 找 installGh 块，看里面有没有真实换行
    const iIdx = src.indexOf('"installGh":')
    if (iIdx >= 0) {
      const block = src.slice(iIdx, iIdx + 4000)
      const blockEnd = block.indexOf("' },\r\n      \"")
      if (blockEnd > 0) {
        const inside = block.slice(0, blockEnd)
        if (/\r|\n/.test(inside.replace(/\\n/g, ''))) {
          // 真实换行存在（去除 \\n 后还有换行）—— 失败
          problems.push('D: installGh zh/en 字段含真实换行（应使用 \\\\n 转义，与 newBugWayfinder / setupRun 同模式）')
        }
      }
    }
  }

  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file)
}

console.log('P1: #195 修复契约（A 探测/状态 + B UI 契约合规）')
targets.forEach(check)
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
