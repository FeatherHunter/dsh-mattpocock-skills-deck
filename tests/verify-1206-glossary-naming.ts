#!/usr/bin/env node
/**
 * tests/verify-1206-glossary-naming.ts — 领域文档文件名一致门禁（#1206）
 *
 * 为什么要有它：插件有两条独立演化的真源——
 *   一、随包技能正文：技能读、写用户仓库的领域文档时认哪些文件名（上游说什么就是什么）；
 *   二、插件自己渲染给人看、注入会话的词条：初始化小卡的两个选项与两句布局结论。
 * 上游在 v1.3.0 把领域文档从 CONTEXT.md / CONTEXT-MAP.md 改名成 GLOSSARY.md / GLOSSARY-MAP.md，
 * 技能那一半跟上了、插件这一半没跟上，于是人照界面建的文件技能翻不到。这次能漏过去，正是因为
 * 没有任何门禁把这两条真源摆在一起看。本门禁做这件事。
 *
 * 两个集合（都从随包技能里现取，不写死）：
 *   · 领域文档名 domainNames —— 取自技能的《去哪读领域文档》模板，是「技能真正的读写对象」；
 *   · 技能提到过的文件名 skillNames —— 取自整棵随包技能树，是「技能世界里合法存在的名字」，
 *     所以 AGENTS.md 这类被点名要改的文件不算越界。
 *
 * 四条判据：
 *   1. domainNames 非空，且含两份领域文档（保证提取本身没坏）；
 *   2. 两个选项词条（setup.layoutSingle / setup.layoutMulti，中英各一份）里出现的文件名必须在
 *      domainNames 内——这一对说的是「它是什么」，不许出现别的名字，更不许出现旧名；
 *   3. 两条布局结论句（setup.layout.single / .multi，中英各一份）必须把 domainNames 说全；
 *      凡是 skillNames 之外的（也就是技能已经不认的）名字，只允许出现一次，且整句必须带「旧名」
 *      记号——旧名只能以「要改掉的名字」的身份出现，不许被当成正经名字写回去；
 *   4. switchLayout 注入模板里出现的文件名必须都在 skillNames 内（它是禁令清单与服务对象清单，
 *      不许点名一个技能已经不认的名字）。
 *
 * 已知的边界：假如上游哪天又把某个名字放回技能正文里，第 3、4 条就不再拦它了；但第 2 条（选项
 * 词条只许用技能《去哪读》模板里的名字）仍然会红，所以改名这件事不会被整体放过去。
 *
 * 能红也能绿：把任一词条里的 GLOSSARY.md 改回旧名，第 2 或第 3 条当场红；全部正确时绿。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
const { readFileSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
// #1209 起这两份的真源是 .ts：按 .js 路径直接读会读到 pixel-ts 产物（值虽然一样，但本门禁要钉的是真源）。
//   共用取源入口按「同名 .ts 优先」解到真源（规则与装载钩子同一条），读产物还是读真源不再碰运气。
const { sourcePath, sourceText } = require('./lib/source-text.ts')

const ROOT = path.resolve(__dirname, '..')
const SKILLS_DIR = path.join(ROOT, 'package/bundled-skills')
const SKILL_DOMAIN_DOC = path.join(SKILLS_DIR, 'setup-matt-pocock-skills/domain.md')
const LOCALE_JSSPEC = path.join('src', 'client', 'kernel', 'locale-pages.js')
const PROMPTS_JSSPEC = path.join('src', 'client', 'kernel', 'prompts.js')
const LOCALE_SRC = sourcePath(LOCALE_JSSPEC)
const PROMPTS_SRC = sourcePath(PROMPTS_JSSPEC)

let failures = 0
function ok(cond, msg) {
  if (cond) console.log('[PASS]', msg)
  else { console.log('[FAIL]', msg); failures++ }
}

/** 一份文本里出现的所有「全大写 .md 文件名」，去重后按字典序返回。 */
function mdNamesIn(text) {
  const found = new Set()
  const re = /\b[A-Z][A-Z0-9-]*\.md\b/g
  let m
  while ((m = re.exec(text)) !== null) found.add(m[0])
  return Array.from(found).sort()
}

/** 某份技能树里提到的所有文件名（走 .md 就够了：技能想让代理读写的都是 markdown）。 */
function namesAcrossSkills(dir) {
  const out = new Set()
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name)
      if (ent.isDirectory()) { walk(abs); continue }
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue
      for (const n of mdNamesIn(readFileSync(abs, 'utf8'))) out.add(n)
    }
  }
  walk(dir)
  return Array.from(out).sort()
}

async function main() {
  // ---- 1. 真源 ----
  const domainNames = mdNamesIn(readFileSync(SKILL_DOMAIN_DOC, 'utf8'))
  const skillNamesArr = namesAcrossSkills(SKILLS_DIR)
  const skillNames = new Set(skillNamesArr)
  console.log('随包技能《去哪读领域文档》模板 = ' + path.relative(ROOT, SKILL_DOMAIN_DOC).replace(/\\/g, '/'))
  console.log('领域文档名（技能真正的读写对象）= ' + JSON.stringify(domainNames))
  console.log('技能提到过的文件名共 ' + skillNamesArr.length + ' 个：' + JSON.stringify(skillNamesArr))
  ok(domainNames.length >= 1, '从随包技能里取到了领域文档名（不是空集合）')
  ok(domainNames.indexOf('GLOSSARY.md') >= 0 && domainNames.indexOf('GLOSSARY-MAP.md') >= 0,
    '领域文档名里有 GLOSSARY.md 与 GLOSSARY-MAP.md（上游 v1.3.0 起的新名）')
  ok(!skillNames.has('CONTEXT.md') && !skillNames.has('CONTEXT-MAP.md'),
    '随包技能里已经没有任何一处提旧名（技能侧确实跟上了）')
  const domainSet = new Set(domainNames)

  // ---- 2 + 3. 插件给人看的四条词条（中英各一份） ----
  const mod = await import(pathToFileURL(LOCALE_SRC).href)
  const L = mod.L_PAGES
  ok(!!L && !!L.zh && !!L.en, 'locale 词条表读到了中英两份')

  const OPTION_KEYS = ['setup.layoutSingle', 'setup.layoutMulti']
  const CONCLUSION_KEYS = ['setup.layout.single', 'setup.layout.multi']

  for (const lang of ['zh', 'en']) {
    const dict = (L && L[lang]) || {}
    for (const key of OPTION_KEYS) {
      const text = String(dict[key] || '')
      ok(text.length > 0, lang + ' · ' + key + ' 有词条')
      const names = mdNamesIn(text)
      const strays = names.filter((n) => !domainSet.has(n))
      ok(names.length > 0 && strays.length === 0,
        lang + ' · ' + key + ' 只提领域文档名（出现：' + JSON.stringify(names)
        + (strays.length ? '，越界：' + JSON.stringify(strays) : '') + '）')
    }
    for (const key of CONCLUSION_KEYS) {
      const text = String(dict[key] || '')
      ok(text.length > 0, lang + ' · ' + key + ' 有词条')
      const missing = domainNames.filter((n) => text.indexOf(n) < 0)
      ok(missing.length === 0, lang + ' · ' + key + ' 把领域文档名说全（缺：' + JSON.stringify(missing) + '）')
      const retired = mdNamesIn(text).filter((n) => !skillNames.has(n))
      const marker = lang === 'zh' ? '旧名' : 'old '
      ok(retired.every((n) => text.split(n).length - 1 === 1) && (retired.length === 0 || text.indexOf(marker) >= 0),
        lang + ' · ' + key + ' 技能已不认的名字只以「要改掉的名字」出现一次且带记号'
        + '（这类名字：' + JSON.stringify(retired) + '，记号「' + marker + '」' + (text.indexOf(marker) >= 0 ? '在' : '不在') + '）')
    }
  }

  // ---- 4. switchLayout 注入模板 ----
  const promptsText = readFileSync(PROMPTS_SRC, 'utf8')
  const start = promptsText.indexOf('"switchLayout": {')
  const end = start < 0 ? -1 : promptsText.indexOf('\n', promptsText.indexOf('en:', start))
  const block = start < 0 ? '' : promptsText.slice(start, end > 0 ? end : promptsText.length)
  ok(block.length > 0, 'prompts.js 里找得到 switchLayout 这一条')
  const blockNames = mdNamesIn(block)
  const blockStrays = blockNames.filter((n) => !skillNames.has(n))
  ok(blockNames.length > 0 && blockStrays.length === 0,
    'switchLayout 注入模板里的文件名都在技能世界内（出现：' + JSON.stringify(blockNames)
    + (blockStrays.length ? '，已经没人认的：' + JSON.stringify(blockStrays) : '') + '）')

  console.log('')
  if (failures) { console.log('存在失败：' + failures + ' 条'); process.exitCode = 1 }
  else console.log('全部通过 — 插件给人看的领域文档文件名与随包技能认的一致')
}

main().catch((e) => { console.error('[FAIL] 门禁自己出错：' + (e && e.stack ? e.stack : e)); process.exitCode = 1 })
