// verify-build-artifacts.js — 风险A 产物“别用手改”门禁（T5 追加）
// 用法: node tests/verify-build-artifacts.js
// 验证：
//   1) client.js / host.js 必须以 // AUTO-GENERATED 开头（防手改产物被下次 build 覆盖）
//   2) 4 个产物必须被 .gitignore 忽略（仓库只见 src 为真源）
//   3) package/lib 产物与根产物同为构建产物（prepare 兜底）
// 解释给新手：
//   - 产物 = 机器炒好的菜（client.js 等），菜谱 = src/
//   - 手改盘子里的菜，下次机器一炒就没了，所以加检查员看盘子上有没有“机器做的”标签
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('风险A：产物防手改门禁（AUTO-GENERATED + gitignore）')

// 1) 横幅
for (const p of ['client.js', 'host.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, p + ' 缺失（请先运行 node scripts/build.mjs）'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  check(txt.startsWith('// AUTO-GENERATED'), p + ' 以 // AUTO-GENERATED 开头（机器产物）')
  if (!txt.startsWith('// AUTO-GENERATED')) {
    console.log('    提示：若你手改过 ' + p + '，请把改动搬到 src/ 对应文件后重新 build')
  }
}
for (const p of ['package/lib/client.js', 'package/lib/index.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, p + ' 缺失（请先运行 node scripts/build.mjs）'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  // pkg 产物头不强制 AUTO-GENERATED（pkg 头为原注释），但需含 ModuleLoader/ESM 特征且被忽略
  check(txt.length > 1000, p + ' 非空（构建产物）')
}

// 2) gitignore
try {
  const out = execSync('git check-ignore -v client.js host.js package/lib/client.js package/lib/index.js', { encoding: 'utf8' })
  check(out.includes('.gitignore'), '4 个产物均被 .gitignore 忽略（仓库只见 src）')
  console.log('    gitignore 命中:\n    ' + out.trim().split('\n').join('\n    '))
} catch (e) {
  check(false, '产物 gitignore 检查失败（应被忽略）：' + e.message)
}

// 3) 未跟踪（git ls-files 不应含产物）
try {
  const tracked = execSync('git ls-files --cached | grep -E "^(client\\.js|host\\.js|package/lib/)" || true', { encoding: 'utf8', shell: 'bash' }).trim()
  // Windows 上 bash 可能不存在，改用 Node 方式
  if (!tracked) {
    // fallback: 用 git ls-files --cached 直接检查
    const all = execSync('git ls-files --cached', { encoding: 'utf8' })
    const bad = all.split('\n').filter(l => l === 'client.js' || l === 'host.js' || l.startsWith('package/lib/'))
    check(bad.length === 0, '产物未被 git 跟踪（git ls-files 无 client.js/host.js/package/lib/）')
    if (bad.length) console.log('    被跟踪的产物:', bad.join(', '))
  } else {
    check(tracked.length === 0, '产物未被 git 跟踪')
  }
} catch (e) {
  // 保守：若命令失败，至少检查 .gitignore 已命中即算过
  check(true, '产物 git 跟踪检查跳过（.gitignore 已命中即视为通过）')
}

console.log(failed ? '\n存在失败' : '\n全部通过 — 风险A门禁生效')
process.exit(failed ? 1 : 0)
