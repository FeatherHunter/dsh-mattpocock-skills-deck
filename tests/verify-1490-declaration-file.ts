// tests/verify-1490-declaration-file.ts —— #1490 验收①：初始化声明文件必须回到随包 Matt 技能原文（规格 #1480）。
//
// 背景：T1–T6 已经把 Markdown 后端写出的文件格式与位置纠正回随包技能原文（当时 pin 是 v1.3.1；
// 2026-10-31 起随包 pin 已升到 v1.3.2，当前 pin 以 tests/bundled-skills-upstream-hashes.json 为准），
// 但初始化时注入给 AI 的那段后端说明（setup.markdown.backendNote）还停在旧口径：
// 让 AI「先以 issue-tracker-local.md 为起点，再把模板里三段旧做法改成 deck 工具口径」——
// 这等于授权它继续改写原文，和 #1480「随包原文是格式与位置的唯一真源」正面冲突。
// 本门禁守三件事：
//   ① 随包模板 issue-tracker-local.md 与上游原文逐字一致（哈希比对，复用既有基线，pin 取哈希清单，
//      不把模板正文抄进门禁——否则就成了第二份真源）；
//   ② 中英两份 backendNote 都要求「把模板逐字复制过去、以它为唯一依据」，
//      并且旧的三段改写指令（规格不是 spec.md、不要手写 issues/、不要手改 Status）一个字都不许再出现；
//   ③ 活的配置与源码里不再教旧布局（历史 docs/、research/ 与旧 ADR 是历史记录，不在扫描范围）。
//
// 门禁归属: config/copy/panel.yaml
// 门禁归属: package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md
// 门禁归属: src/tracker/rooms/markdown/index.ts
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1490-declaration-file.ts

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { readCopyConfig } = require('../scripts/lib/copy-config.mts')
const { markdownModule } = require('../src/tracker/rooms/markdown/index.ts')

const ROOT: string = path.resolve(__dirname, '..')
const MANIFEST: string = path.join(ROOT, 'tests/bundled-skills-upstream-hashes.json')
const BUNDLED: string = path.join(ROOT, 'package/bundled-skills')
const VERSION_FILE: string = path.join(BUNDLED, 'VERSION')
// 声明里点名的那份本地模板；同时在随包清单里按下述相对路径查哈希。
const TEMPLATE_REL: string = 'setup-matt-pocock-skills/issue-tracker-local.md'
const TEMPLATE_ABS: string = path.join(BUNDLED, TEMPLATE_REL)

let failed = false
let total = 0
let passed = 0
function check(ok: unknown, msg: string): void {
  total++
  if (ok) { passed++; console.log('  PASS ' + msg) }
  else { failed = true; console.log('  FAIL ' + msg) }
}
function foundIn(text: string, fragment: string): boolean { return text.indexOf(fragment) >= 0 }
/** 把片段所在行号找出来，报错时能直接定位；找不到返回 0。 */
function lineOf(text: string, fragment: string): number {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) { if (lines[i].indexOf(fragment) >= 0) return i + 1 }
  return 0
}

/** 与 tests/verify-bundled-skills-upstream.ts 同口径：抹掉 Windows 检出的 CRLF，再算 SHA256。
 *  基线文件（tests/bundled-skills-upstream-hashes.json）是上游同步时生成的同一份，
 *  这里只复用，不另造第二套真源、也不把模板正文抄进门禁。 */
function norm(s: string): string { return s.replace(/\r\n/g, '\n') }
function sha(s: string): string { return createHash('sha256').update(norm(s), 'utf8').digest('hex') }

// 旧口径的特征片段。只收「教旧做法」的原话，不收泛词：
//   「三段」单独出现会误伤 config/copy/skilldesc.yaml 的「固定三段形状写 PR 正文」，
//   「spec is not」会误伤 cards.yaml 的「only the spec is not written」，所以都写全整句特征。
const LEGACY_NOTE_FRAGMENTS: string[] = [
  '三段旧做法',
  'three legacy passages',
  '规格不是 .scratch',
  'spec is not a .scratch',
  '不要手写 .scratch',
  'do not hand-write files under .scratch',
  '不要手改 Status',
  'do not hand-edit the Status',
  'kind=spec',
  'kind=spec-ticket',
  'deck_issue_create',
  'deck_issue_patch',
]
// 扫活配置与源码时只查「文件布局」「认领/状态怎么改」这两类旧教法；
//   kind=spec-ticket / deck_issue_create 是 deck 工具自己的入参说法（map-advancement.yaml 里还在用），
//   它们不教旧文件布局，不能一刀切判红——#1480 只纠正「格式与位置」。
const LEGACY_LAYOUT_FRAGMENTS: string[] = [
  '三段旧做法',
  'three legacy passages',
  '规格不是 .scratch',
  'spec is not a .scratch',
  '不要手写 .scratch',
  'do not hand-write files under .scratch',
  '不要手改 Status',
  'do not hand-edit the Status',
]

// 新说明必须说清的三层意思（逐条查关键词，不比对全文——全文金样由 verify-setup-describe.ts 钉死）：
//   1) 生成 docs/agents/issue-tracker.md 时把随包模板逐字复制；
//   2) 文件格式与位置以模板为唯一依据；
//   3) 建票、认领、改状态仍走 deck 工具，但落盘必须与模板一致。
const NOTE_REQUIRED: Record<string, string[]> = {
  zh: ['docs/agents/issue-tracker.md', 'issue-tracker-local.md', '逐字复制', '唯一依据', 'deck 工具', '不改写', '逐字相同'],
  en: ['docs/agents/issue-tracker.md', 'issue-tracker-local.md', 'verbatim', 'single source of truth', 'deck tools', 'without rewriting', 'word for word'],
}

/** 递归收 src/ 下的 .ts：跳过 node_modules/.git 与构建目录；生成的 locale-data.ts 存在也要扫，
 *  因为它就是这份 backendNote 的运行时副本，旧口径若从生成物里漏出来同样是事故。 */
function walkSrc(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === '.git' || name.name === 'dist' || name.name === 'build') continue
      walkSrc(path.join(dir, name.name), out)
      continue
    }
    if (name.isFile() && name.name.endsWith('.ts')) out.push(path.join(dir, name.name))
  }
}

function main(): void {
  // ══ 第一段：随包模板与上游 pin 逐字一致 ══
  console.log('\n=== 第一段：随包模板 issue-tracker-local.md 与上游基线逐字一致 ===')
  let manifest: any = null
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch (err) {
    check(false, '读得到基线 tests/bundled-skills-upstream-hashes.json：' + (err instanceof Error ? err.message : String(err)))
    return
  }
  check(!!(manifest && typeof manifest === 'object'), '基线文件是合法 JSON 对象')
  check(manifest.algo === 'sha256-of-LF-normalized-utf8',
    '基线算法是 CRLF→LF 归一化后的 SHA256（与 verify-bundled-skills-upstream.ts 同一套）：' + JSON.stringify(manifest.algo))
  const version: string = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').trim() : ''
  check(version !== '' && manifest.pin === version,
    'VERSION 与基线 pin 一致（声明所依据的原文版本只有这一处）：VERSION=' + JSON.stringify(version) + ' 基线=' + JSON.stringify(manifest.pin))
  const expected: string = manifest.files ? manifest.files[TEMPLATE_REL] : ''
  check(typeof expected === 'string' && expected.length === 64,
    '基线里有随包模板 ' + TEMPLATE_REL + ' 的哈希（缺了说明本门禁没有可比对的原文）')
  check(fs.existsSync(TEMPLATE_ABS), '随包模板文件真实存在：package/bundled-skills/' + TEMPLATE_REL)
  if (fs.existsSync(TEMPLATE_ABS) && typeof expected === 'string') {
    const raw: string = fs.readFileSync(TEMPLATE_ABS, 'utf8')
    check(sha(raw) === expected, '随包模板与上游 pin ' + JSON.stringify(manifest.pin) + ' 原文逐字一致（哈希 ' + sha(raw).slice(0, 12) + '…）')
  }
  // 声明里写的是文件名；对一下基线里这份文件的文件名，防止哪天声明指向一份不存在的模板。
  const templateName: string = path.posix.basename(TEMPLATE_REL)
  check(templateName === 'issue-tracker-local.md', '基线里的模板文件名就是声明点名的 issue-tracker-local.md：' + templateName)

  // ══ 第二段：中英 backendNote 都回到「逐字复制随包模板」 ══
  console.log('\n=== 第二段：中英 backendNote 要求逐字复制随包模板、不再改写模板里的做法 ===')
  const copyConfig: any = readCopyConfig(ROOT)
  const panel: any = (copyConfig.families || []).filter((f: any) => f.family === 'panel')[0]
  check(!!panel, '读得到 config/copy/panel.yaml 这一词族（setup 后端说明的真源）')
  const noteKey: string = markdownModule.setupPrompt.backendNote
  check(noteKey === 'setup.markdown.backendNote', 'Markdown 后端的说明键名仍取自后端模块自身（不在这里手写第二份）：' + noteKey)
  const notes: Record<string, string> = {}
  for (const lang of ['zh', 'en']) {
    const text: string = panel && panel.texts[lang] ? panel.texts[lang][noteKey] : ''
    notes[lang] = text || ''
    check(!!text, '[' + lang + '] 取得到 ' + noteKey + ' 的文案')
    const required: string[] = NOTE_REQUIRED[lang] || []
    const missing: string[] = required.filter((frag) => !foundIn(text, frag))
    check(missing.length === 0, '[' + lang + '] 说明要求「逐字复制随包模板 + 以它为唯一依据 + 用 deck 工具执行」，缺：' + JSON.stringify(missing))
    const old: string[] = LEGACY_NOTE_FRAGMENTS.filter((frag) => foundIn(text, frag))
    check(old.length === 0, '[' + lang + '] 说明里不再出现旧的三段改写指令，残留：' + JSON.stringify(old))
  }
  // 说明里点名的模板名，就是第一段核对过哈希的那份模板（同一个事实只在基线里定义一次，这里只对照名字）。
  for (const lang of ['zh', 'en']) {
    check(foundIn(notes[lang], templateName), '[' + lang + '] 说明点名的模板文件与随包基线里的那份是同一个：' + templateName)
  }

  // ══ 第三段：活的配置与源码不再教旧布局 ══
  console.log('\n=== 第三段：活配置与源码里不再出现旧布局教法 ===')
  const liveFiles: string[] = [path.join(ROOT, 'config/copy/panel.yaml')]
  const promptDir: string = path.join(ROOT, 'config/prompts')
  if (fs.existsSync(promptDir)) {
    for (const name of fs.readdirSync(promptDir)) {
      if (name.endsWith('.yaml')) liveFiles.push(path.join(promptDir, name))
    }
  }
  const srcFiles: string[] = []
  walkSrc(path.join(ROOT, 'src'), srcFiles)
  for (const file of srcFiles) liveFiles.push(file)
  let hits: string[] = []
  for (const file of liveFiles) {
    let text = ''
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    for (const frag of LEGACY_LAYOUT_FRAGMENTS) {
      const line = lineOf(text, frag)
      if (line > 0) hits.push(path.relative(ROOT, file).split(path.sep).join('/') + ':' + line + ' 含「' + frag + '」')
    }
  }
  check(hits.length === 0, 'config/ 活配置与 src/ 源码里没有旧文件布局教法（扫描 ' + liveFiles.length + ' 个文件）；命中：' + JSON.stringify(hits))

  console.log('\n=== verify-1490-declaration-file ===')
  if (failed) {
    console.log('FAILED（' + (total - passed) + '/' + total + ' 条断言失败）')
    process.exitCode = 1
  } else {
    console.log('ALL PASS（' + passed + '/' + total + ' 条断言）')
  }
}

main()
