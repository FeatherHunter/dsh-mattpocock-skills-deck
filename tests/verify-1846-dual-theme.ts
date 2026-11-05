// tests/verify-1846-dual-theme.ts —— 门禁：#1846 三块表面（搜索页 / 命令面板 / 分支浮层）的深浅两套主题。
//
// 为什么单开一扇：#1846 的三块表面都长在版本管理页壳里，皮肤由宿主主题开关决定（body 上有
// data-ds-dark-theme 就是深色，没有就是浅色）。壳里那套 --vcs-* 令牌分两组：基规则是深色，
// [data-vc-shell][data-vc-skin="light"] 覆盖成浅色。只要有人新加一个颜色令牌却忘了补浅色值，
// 或者在哪条规则里写死一个色值，浅色下就会露出深色的那一半——静态看代码看不出来，真机也很难撞上。
//
// 这扇门禁锁四件事：
//   1) 浅色覆盖块存在，且只写令牌（浅色只换令牌，不另起一套结构）；
//   2) 深色块里的每一个颜色令牌都有浅色值；字体与圆角令牌允许只定义一次（两套主题共用）；
//   3) 三块表面用到、以及整份样式用到的每个令牌，都能在深色块里找到，颜色令牌还必须在浅色块里也有值；
//   4) 三块表面的规则里没有硬编码色值；画这三块表面的组件文件里也没有内联色值。
//
// 门禁归属: src/client/views/versionControl/vcShellStyles.ts
// 门禁归属: src/client/views/versionControl/vcPageStyles.ts
// 门禁归属: src/client/views/versionControl/vcBranchStyles.ts
// 门禁归属: src/client/views/versionControl/vcSearchPage.ts
// 门禁归属: src/client/views/versionControl/vcPalette.ts
// 门禁归属: src/client/views/versionControl/vcBranchPopover.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1846-dual-theme.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1846-dual-theme'

let total = 0
let failed = 0
function check(ok: any, msg: string) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

const SHELL_STYLES = 'src/client/views/versionControl/vcShellStyles.ts'
const PAGE_STYLES = 'src/client/views/versionControl/vcPageStyles.ts'
const BRANCH_STYLES = 'src/client/views/versionControl/vcBranchStyles.ts'
const COMPONENTS = [
  'src/client/views/versionControl/vcSearchPage.ts',
  'src/client/views/versionControl/vcPalette.ts',
  'src/client/views/versionControl/vcBranchPopover.ts',
]
// 字体与圆角在深浅两套主题里是同一组值，只定义一次不算缺浅色版本。
const SHARED_TOKENS = ['sans', 'mono', 'r-sm', 'r-md']
// 失败条住在页壳的父容器 .vcs-live 上，浅色覆盖块选不到它；它不属于本票的三块表面。
const OUTER_TOKENS = ['live-danger']

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function tokenNamesOf(block: string | null): string[] {
  if (block === null) return []
  return Array.from(block.matchAll(/--vcs-([a-z0-9-]+)\s*:/g)).map((m) => m[1])
}
function usedTokensOf(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/var\(--vcs-([a-z0-9-]+)/g)).map((m) => m[1])))
}
function styleRulesOf(text: string): string[] {
  // 一行一条规则是这套样式的写法；注释行与空行不参与判定。
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && line.indexOf('//') !== 0 && line.indexOf('/*') !== 0)
}

const shellText = read(SHELL_STYLES)
const darkBlock = /\[data-vc-shell\]\{([^}]*)\}/.exec(shellText)
const lightBlock = /\[data-vc-shell\]\[data-vc-skin="light"\]\{([^}]*)\}/.exec(shellText)
const darkTokens = tokenNamesOf(darkBlock === null ? null : darkBlock[1])
const lightTokens = tokenNamesOf(lightBlock === null ? null : lightBlock[1])

// ---- 1. 浅色覆盖块存在，且只写令牌 ----
check(lightBlock !== null, 'L1 壳样式里有 [data-vc-shell][data-vc-skin="light"] 这一组浅色覆盖')
check(darkBlock !== null, 'L2 壳样式的基规则里有一组深色令牌（[data-vc-shell]{--vcs-*…}）')
const lightDecls = lightBlock === null ? [] : lightBlock[1].split(';').map((s) => s.trim()).filter((s) => s !== '')
const lightNonToken = lightDecls.filter((decl) => decl.indexOf('--vcs-') !== 0)
check(lightDecls.length > 0 && lightNonToken.length === 0, 'L3 浅色覆盖块只写 --vcs-* 令牌，不改结构（多写的：' + (lightNonToken.join('、') || '无') + '）')

// ---- 2. 深色里的每个颜色令牌都有浅色值 ----
const missingLight = darkTokens.filter((name) => SHARED_TOKENS.indexOf(name) < 0 && lightTokens.indexOf(name) < 0)
check(missingLight.length === 0, 'L4 深色块里的每个颜色令牌都有浅色值（缺 ' + (missingLight.join('、') || '无') + '）')
const darkOnlyShared = SHARED_TOKENS.filter((name) => darkTokens.indexOf(name) < 0)
check(darkOnlyShared.length === 0, 'L5 共用令牌（字体 / 圆角）在深色块里定义一次（缺 ' + (darkOnlyShared.join('、') || '无') + '）')

// ---- 3. 用到的令牌都能在深色块里找到，颜色令牌两层都有值 ----
const allStyleText = [shellText, read(PAGE_STYLES), read(BRANCH_STYLES)].join('\n')
const used = usedTokensOf(allStyleText)
const undefinedUsed = used.filter((name) => darkTokens.indexOf(name) < 0 && lightTokens.indexOf(name) < 0 && OUTER_TOKENS.indexOf(name) < 0)
check(undefinedUsed.length === 0, 'L6 样式里用到的令牌都能在壳样式里找到定义（没有的：' + (undefinedUsed.join('、') || '无') + '）')
const usedWithoutLight = used.filter((name) => darkTokens.indexOf(name) >= 0 && lightTokens.indexOf(name) < 0 && SHARED_TOKENS.indexOf(name) < 0)
check(usedWithoutLight.length === 0, 'L7 用到的每个颜色令牌在浅色块里都有值（缺 ' + (usedWithoutLight.join('、') || '无') + '）')

// ---- 4. 三块表面的规则里没有硬编码色值 ----
// 表面选择器：搜索页 .vcs-search*、命令面板 .vcs-pal*、分支浮层 .vcs-branch*、共用的确认卡与结果块 .vcs-confirm* / .vcs-result*。
const SURFACE = /(\.vcs-search|\.vcs-pal|\.vcs-branch|\.vcs-confirm|\.vcs-result)/
const surfaceRules = styleRulesOf(allStyleText).filter((line) => SURFACE.test(line))
const surfaceLiterals = surfaceRules.filter((line) => {
  const values = line.slice(line.indexOf('{') + 1)
  return /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/.test(values)
})
check(surfaceRules.length >= 20, 'L8 三块表面确实有规则可查（实得 ' + String(surfaceRules.length) + ' 条）')
check(surfaceLiterals.length === 0, 'L9 三块表面的规则里没有硬编码色值（实得 ' + (surfaceLiterals.length === 0 ? '0 条' : surfaceLiterals.slice(0, 3).join(' | ')) + '）')

// 三块表面各自的样式入口都在位，免得上面那条因为「一条表面规则都没匹配到」而空转。
check(read(PAGE_STYLES).indexOf('.vcs-search') >= 0, 'L10 搜索页的样式在页面样式文件里')
check(shellText.indexOf('.vcs-pal') >= 0, 'L11 命令面板的样式在壳样式文件里')
check(read(BRANCH_STYLES).indexOf('.vcs-branch') >= 0, 'L12 分支浮层的样式在分支样式文件里')
check(shellText.indexOf('.vcs-confirm') >= 0 && shellText.indexOf('.vcs-result') >= 0, 'L13 共用的确认卡与结果块样式在壳样式文件里')

// ---- 5. 画这三块表面的组件文件里没有内联色值 ----
for (const rel of COMPONENTS) {
  const stripped = read(rel).split('\n').filter((line) => line.trim().indexOf('//') !== 0).join('\n')
  const inline = /style\s*:\s*\{[^}]*#[0-9a-fA-F]{3,8}|style\s*:\s*\{[^}]*rgba?\(\s*\d|backgroundColor\s*:\s*['"](#|rgb|hsl)/.test(stripped)
  check(!inline, 'L14 ' + rel + ' 里没有内联色值（颜色一律走 --vcs-* 令牌）')
}

console.log('')
console.log('1846 双主题门禁：' + String(total) + ' 条断言，失败 ' + String(failed) + ' 条')
console.log('  深色令牌 ' + String(darkTokens.length) + ' 个，浅色覆盖 ' + String(lightTokens.length) + ' 个；表面规则 ' + String(surfaceRules.length) + ' 条')
printGateResult(GATE, total, failed > 0 ? 1 : 0)
process.exit(failed > 0 ? 1 : 0)
