#!/usr/bin/env node
/**
 * verify-1837-skill-importance.ts —— 技能行色点「重要程度」三档的源码门禁（#1837）
 *
 * 为什么需要这一扇：色点从「状态」改成「重要程度」之后，画对颜色只是表层；真正会悄悄坏掉的是
 *   三件事：数据表里写错一档（颜色与含义对不上）、行与图例各查一处颜色定义（图例说备用是空心、
 *   行里画的却还是绿的）、旧状态语义的残渣还在代码里（下一次改动又照着旧字段写）。
 *   这一扇把这三件事钉住，外加一条自检：判据把错档位改一下必须报出来，否则它没有证据力。
 *
 * 判据：
 *   A. shared 数据表：27 项、名字唯一、每项只带 name/importance 两键、档位只 core/common/rare、
 *      分档与 #1837 的 12/7/8 清单逐项一致；探测名单与数据表同名；与 package/bundled-skills 目录一一对应。
 *   B. 外观表：三档齐全；core=var(--pixel-warn) 实心、common=var(--pixel-ok) 实心、rare 底色透明且空心；
 *      外观表里不出现 # 十六进制色值（颜色一律引用皮肤令牌，深浅两套皮肤各自换色）。
 *   C. 旧语义清零：shared 不再有 ok/warn/alert 联合、「就绪/先看说明/有问题先处理」，PixelDot 不再认 level；
 *      src 与 config/copy 全仓不再出现 act.load（#1836 已把按钮改叫「注入对话」）。
 *   D. 同源：行与图例都查 shared 的 SKILL_IMPORTANCE_STYLES；图例八个 sd.imp.* 键中英齐全非空；
 *      PixelStyles 有标题行与图例的布局规则（.pixel-skillhead / .pixel-skilllegend）。
 *   E. 自检：把 ask-matt 故意改成 rare，判据必须报出问题。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1837-skill-importance.ts
 * 门禁归属: src/shared/matt-skills.ts
 * 门禁归属: src/client/views/pixel/PixelDot.ts
 * 门禁归属: src/client/views/skillDetail/PixelSkillRow.ts
 * 门禁归属: src/client/views/skillDetail/PixelSkillList.ts
 * 门禁归属: src/client/views/skillDetail/PixelStyles.ts
 * 门禁归属: src/client/views/SkillsTab.ts
 * 门禁归属: src/client/views/pixelProps.d.ts
 * 门禁归属: config/copy/skilldetail.yaml
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { parse: parseYaml } = require('yaml')
const ROOT = path.resolve(__dirname, '..')
const { sourcePath, sourceText } = require('./lib/source-text.ts')
const { printGateResult } = require('./lib/gate-result.ts')

const GATE = 'verify-1837-skill-importance'
let total = 0
let failed = 0
const check = (ok: any, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed += 1
}
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const has = (text: string, needle: string): boolean => text.indexOf(needle) !== -1

// 票里拍板的分档（#1837）：顺序为「核心 → 常用 → 备用」，与列表展示顺序无关。
const EXPECTED_TIERS: Record<string, string[]> = {
  core: ['ask-matt', 'setup-matt-pocock-skills', 'wayfinder', 'triage', 'grilling', 'grill-with-docs', 'grill-me', 'to-spec', 'to-tickets', 'implement', 'implement-spec', 'handoff'],
  common: ['domain-modeling', 'research', 'prototype', 'code-review', 'tdd', 'diagnosing-bugs', 'pr'],
  rare: ['codebase-design', 'improve-codebase-architecture', 'retro', 'teach', 'wait-what', 'wizard', 'to-questionnaire', 'writing-for-agents'],
}
const ALLOWED_IMPORTANCE = ['core', 'common', 'rare']
const ALLOWED_KEYS = ['importance', 'name']
// 只认「颜色样子的十六进制」：3 / 6 / 8 位。4 位的 #1837、#1342 这类票号不是颜色，别误伤。
const HEX_COLOR = /(?<![0-9a-fA-F])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}|[0-9a-fA-F]{8})\b/
const LEGEND_KEYS = ['sd.imp.core', 'sd.imp.common', 'sd.imp.rare', 'sd.imp.star', 'sd.imp.coreTip', 'sd.imp.commonTip', 'sd.imp.rareTip', 'sd.imp.starTip']

// 判据本体：返回「数据表与票里分档对不上」的全部问题。单独抽出来是为了能拿假数据自检。
function judgeTiers(skills: any[]): string[] {
  const problems: string[] = []
  const found: Record<string, string[]> = { core: [], common: [], rare: [] }
  skills.forEach(function (s: any): void {
    const importance = String(s && s.importance)
    if (ALLOWED_IMPORTANCE.indexOf(importance) === -1) {
      problems.push('未知档位：' + String(s && s.name) + ' → ' + importance)
      return
    }
    found[importance].push(String(s.name))
  })
  ALLOWED_IMPORTANCE.forEach(function (tier: string): void {
    const want = EXPECTED_TIERS[tier].slice().sort().join(',')
    const got = found[tier].slice().sort().join(',')
    if (want !== got) problems.push(tier + ' 档与票里的分档不一致：应为 [' + want + ']，实际 [' + got + ']')
  })
  return problems
}

// 递归读 src/ 下全部手写源码，扫旧键与旧词。config/copy 单独扫。
function walk(dir: string, out: string[]): string[] {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent: any): void {
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(abs, out)
    else if (/\.(ts|mts|d\.ts)$/.test(ent.name)) out.push(abs)
  })
  return out
}

async function main(): Promise<void> {
  const sharedUrl = pathToFileURL(path.join(ROOT, sourcePath('src/shared/matt-skills.js'))).href
  const shared = await import(sharedUrl)
  const skills: any[] = shared.SKILLS || []
  const styles: any = shared.SKILL_IMPORTANCE_STYLES || {}

  // ---------------- A. 数据表 ----------------
  check(skills.length === 27, '数据表有 27 项技能（实际 ' + skills.length + '）')
  const names = skills.map(function (s: any): string { return String(s.name) })
  check(new Set(names).size === names.length, '27 个技能名互不重复')
  const badKeys = skills.filter(function (s: any): boolean { return Object.keys(s).sort().join(',') !== ALLOWED_KEYS.join(',') })
  check(badKeys.length === 0, '每项只带 name / importance 两个键' + (badKeys.length ? '（违规：' + badKeys.map(function (s: any): string { return String(s.name) }).join('、') + '）' : ''))
  const problems = judgeTiers(skills)
  check(problems.length === 0, '三档与票里拍板的 12/7/8 清单逐项一致' + (problems.length ? '：' + problems.join('；') : ''))
  const probeNames: string[] = (shared.MATT_SKILL_PROBE_NAMES || []).map(function (n: any): string { return String(n) })
  check(probeNames.length === names.length && probeNames.every(function (n: string): boolean { return names.indexOf(n) !== -1 }),
    '探测名单由数据表派生、与 27 项同名')
  const bundledDir = path.join(ROOT, 'package/bundled-skills')
  const dirs = fs.readdirSync(bundledDir, { withFileTypes: true }).filter(function (e: any): boolean { return e.isDirectory() }).map(function (e: any): string { return e.name })
  const onlyTable = names.filter(function (n: string): boolean { return dirs.indexOf(n) === -1 })
  const onlyDisk = dirs.filter(function (n: string): boolean { return names.indexOf(n) === -1 })
  check(dirs.length === 27 && onlyTable.length === 0 && onlyDisk.length === 0,
    '27 项与 package/bundled-skills 目录一一对应（只有表：' + (onlyTable.join('、') || '无') + '；只有目录：' + (onlyDisk.join('、') || '无') + '）')

  // ---------------- B. 外观表 ----------------
  const styleKeys = Object.keys(styles).sort().join(',')
  check(styleKeys === 'common,core,rare', '外观表只定义 core / common / rare 三档（实际 ' + styleKeys + '）')
  const shaped = ALLOWED_IMPORTANCE.every(function (tier: string): boolean {
    const item = styles[tier]
    return !!item && typeof item.color === 'string' && typeof item.hollow === 'boolean'
  })
  check(shaped, '三档外观都是 { color: 字符串, hollow: 布尔 }')
  check(styles.core && styles.core.color === 'var(--pixel-warn)' && styles.core.hollow === false, '核心档＝皮肤警告色令牌、实心')
  check(styles.common && styles.common.color === 'var(--pixel-ok)' && styles.common.hollow === false, '常用档＝皮肤就绪色令牌、实心')
  check(styles.rare && styles.rare.color === 'transparent' && styles.rare.hollow === true, '备用档＝底色透明、空心')
  check(!HEX_COLOR.test(JSON.stringify(styles)), '外观表不写死十六进制色值（颜色一律引用皮肤令牌）')

  // ---------------- C. 旧状态语义清零 ----------------
  const sharedText = sourceText('src/shared/matt-skills.js')
  check(!/'ok'\s*\|\s*'warn'\s*\|\s*'alert'/.test(sharedText), 'shared 不再有 ok / warn / alert 档位联合')
  check(!/就绪|先看说明|有问题先处理/.test(sharedText), 'shared 不再有「就绪 / 先看说明 / 有问题先处理」旧说法')
  check(!/\blevel\b/.test(sharedText), 'shared 不再有 level 字段')
  const dotText = sourceText('src/client/views/pixel/PixelDot.js')
  check(!/\bp\.level\b/.test(dotText) && !/\blevel\b/.test(dotText), 'PixelDot 不再认 level（alert 画绿的坑随之消失）')
  check(!HEX_COLOR.test(dotText), 'PixelDot 不持有任何色值')
  const rowText = sourceText('src/client/views/skillDetail/PixelSkillRow.js')
  check(!/\bp\.level\b/.test(rowText) && has(rowText, 'importance'), '技能行改读 importance')
  check(!HEX_COLOR.test(rowText), '技能行不写死十六进制色值')
  const listText = sourceText('src/client/views/skillDetail/PixelSkillList.js')
  const stylesText = sourceText('src/client/views/skillDetail/PixelStyles.js')
  const tabText = sourceText('src/client/views/SkillsTab.js')
  check(has(tabText, 'sk.importance') && !has(tabText, 'sk.level'), '技能页把 importance 传进列表')
  // 旧按钮词条：src 与 config/copy 两处都不该再出现 act.load。
  const srcFiles = walk(path.join(ROOT, 'src'), [])
  const actOffenders: string[] = []
  srcFiles.forEach(function (abs: string): void {
    if (fs.readFileSync(abs, 'utf8').indexOf('act.load') !== -1) actOffenders.push(path.relative(ROOT, abs))
  })
  const copyOffenders = fs.readdirSync(path.join(ROOT, 'config/copy')).filter(function (n: string): boolean { return /\.ya?ml$/.test(n) })
    .filter(function (n: string): boolean { return read('config/copy/' + n).indexOf('act.load') !== -1 })
    .map(function (n: string): string { return 'config/copy/' + n })
  check(actOffenders.length === 0 && copyOffenders.length === 0,
    'src 与 config/copy 里不再有 act.load（违规：' + (actOffenders.concat(copyOffenders).join('、') || '无') + '）')
  check(has(read('config/copy/skilldetail.yaml'), 'sd.injectChat'), '注入按钮的词条 sd.injectChat 仍由词表真源提供')

  // ---------------- D. 同源与词表 ----------------
  check(has(rowText, 'SKILL_IMPORTANCE_STYLES') && has(listText, 'SKILL_IMPORTANCE_STYLES'),
    '行与图例都查同一张外观表 SKILL_IMPORTANCE_STYLES')
  check(has(listText, 'pixel-skillhead') && has(listText, 'pixel-skilllegend'), '列表标题行带图例容器（pixel-skillhead / pixel-skilllegend）')
  const missingLegendKeys = LEGEND_KEYS.filter(function (key: string): boolean { return !has(listText, key) })
  check(missingLegendKeys.length === 0, '图例用到全部八个 sd.imp.* 键（缺：' + (missingLegendKeys.join('、') || '无') + '）')
  check(has(stylesText, '.pixel-skilllegend') && has(stylesText, 'margin-left:auto') && has(stylesText, 'flex-wrap:wrap'),
    'PixelStyles 有图例右对齐与换行规则')
  const copy = parseYaml(read('config/copy/skilldetail.yaml'))
  const zh = copy.zh || {}
  const en = copy.en || {}
  const zhMissing = LEGEND_KEYS.filter(function (key: string): boolean { return typeof zh[key] !== 'string' || zh[key].trim() === '' })
  const enMissing = LEGEND_KEYS.filter(function (key: string): boolean { return typeof en[key] !== 'string' || en[key].trim() === '' })
  check(zhMissing.length === 0 && enMissing.length === 0,
    '八个 sd.imp.* 键中英都齐全非空（中文缺：' + (zhMissing.join('、') || '无') + '；英文缺：' + (enMissing.join('、') || '无') + '）')
  const impKey = function (dict: any): string {
    return Object.keys(dict).filter(function (k: string): boolean { return k.indexOf('sd.imp.') === 0 }).sort().join(',')
  }
  check(impKey(zh) === impKey(en), '中文与英文的 sd.imp.* 键集一致')
  const glossary = read('GLOSSARY.md')
  check(has(glossary, '**技能重要程度**') && has(glossary, '**技能图例**'), '词典里补了「技能重要程度」与「技能图例」两条词条')

  // ---------------- E. 判据自检 ----------------
  const fake = skills.map(function (s: any): any { return { name: s.name, importance: s.name === 'ask-matt' ? 'rare' : s.importance } })
  check(judgeTiers(fake).length > 0, '反证：把 ask-matt 故意改成备用档，分档判据必须报出来')
}

main().then(function (): void {
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}).catch(function (err: any): void {
  console.log('  FAIL 门禁自己抛错：' + String((err && err.stack) || err))
  printGateResult(GATE, total + 1, 1)
  process.exit(1)
})
