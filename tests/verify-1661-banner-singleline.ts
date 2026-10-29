// verify-1661-banner-singleline.ts — #1661 黄条短句单行自适应：文案压短、不换行、宽度自适应
// 只做形状断言，不跑界面：读 panel.yaml 中英两份真源、StatusBar 那段 bann 源码、guide-steps 键名，
// 断言短句成立、占位符两边一致、容器与文字 кнопки都按单行自适应写。新增文件一律 .ts，只写可剥离类型。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1661-banner-singleline.ts
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
let failed = false
let total = 0
const ok = (cond: unknown, msg: string) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
const lineOf = (text: string, key: string): string => {
  const lines = text.split(/\r?\n/)
  for (const l of lines) { if (l.includes(key)) return l }
  return ''
}
// —— 1. 文案真源：中英一起压短，占位符同步清掉 ——
const panel = read('config/copy/panel.yaml')
const zh = lineOf(panel, 'banner.skills:')
const zhEn: string[] = []
{
  const lines = panel.split(/\r?\n/)
  let inEn = false
  for (const l of lines) {
    if (/^en:\s*$/.test(l)) { inEn = true; continue }
    if (/^\S/.test(l) && !/^\s/.test(l) && inEn && !/^en:/.test(l)) break
    if (inEn && l.includes('banner.skills:')) zhEn.push(l)
  }
}
const en = zhEn[0] || ''
ok(zh.includes('未检测到核心技能套件。安装后才能使用全流程功能。'), '中文压成短句：未检测到核心技能套件。安装后才能使用全流程功能。')
ok(!zh.includes('{list}'), '中文不再带 {list} 占位符')
ok(!zh.includes('wayfinder / triage'), '中文不再列技能名单括号段')
ok(en.includes('Core skill suite missing. Install them to use the full workflow.'), '英文同步压短')
ok(!en.includes('{list}'), '英文也不再带 {list}（中英占位符一致，都是无）')
// —— 2. 渲染：单行不换行、宽度自适应 ——
const bar = read('src/client/statusbar/StatusBar.ts')
ok(bar.includes("maxWidth: '100%'") && bar.includes("width: 'max-content'"), '容器去560上限：maxWidth 100% + width max-content，自适应变宽')
{
  const at = bar.indexOf('#1661')
  const sect = at >= 0 ? bar.slice(at, at + 1200) : ''
  ok(sect !== '' && !sect.includes('maxWidth: 560'), '黄条那一段不再写死 maxWidth 560（别的蓝条不动）')
}
ok(bar.includes("whiteSpace: 'nowrap'") && bar.includes("textOverflow: 'ellipsis'"), '文字单行不换行、窄屏尾巴省略')
ok(bar.includes("flex: 'none'") && bar.includes("whiteSpace: 'nowrap'"), '按钮固定不压缩、不换行')
ok(bar.includes('#1661'), '改动留了 #1661 注释，方便回查')
// —— 3. 行为未变：键名仍是 banner.skills，判定链不动 ——
const guide = read('src/shared/tracker/guide-steps.ts')
ok(guide.includes("text: 'banner.skills'"), 'guide-steps 仍引用 banner.skills 键名，判定链没动')
const locale = read('src/client/kernel/locale-data.ts')
ok(locale.includes('未检测到核心技能套件。安装后才能使用全流程功能。'), '生成物 locale-data 已跟上短句')
console.log('1661 SINGLELINE ' + total + ' assertions, ' + (failed ? 'FAILED' : 'PASSED'))
process.exit(failed ? 1 : 0)
