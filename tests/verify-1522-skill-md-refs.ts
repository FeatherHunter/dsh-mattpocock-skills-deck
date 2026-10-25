// tests/verify-1522-skill-md-refs.ts —— #1522 详情页正文里的随包 md 文件名可点开
//
// 守两件事：
//   1) 宿主读原文的电话 skill.readDoc 多认一个文件参数：正文里写到的随包 md（以及别名、项目文件规则）
//      能按「当前技能目录优先」找到真文件；越界路径与不存在的文件名一律拒绝。
//   2) 详情页正文把这些文件名画成可点入口（行内代码、普通正文、代码块、相对链接都算），
//      点开压一层显示原文；格式模板、项目文件、多份候选各有各的说明。
//
// 为什么要它：这张票的验收判据是「正文里出现的都能点、点开对得上」，只靠人眼看不可靠；
//   宿主找不到文件与界面没画成入口，是两个地方各自会坏的事，所以分两段守。
import { createSkillDoc } from '../src/host/skillDoc.ts'
import { JSDOM } from 'jsdom'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
import vm from 'node:vm'
import { spliceableJs } from './lib/source-text.ts'

let pass = 0
let fail = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) { pass += 1; console.log('  PASS ' + msg) } else { fail += 1; console.log('  FAIL ' + msg) }
}
const norm = (v: any): string => String(v == null ? '' : v).replace(/\\/g, '/')
const base = (v: any): string => norm(v).split('/').pop() || ''

const doc = createSkillDoc({})
const call = async (args: any): Promise<any> => {
  try { return await doc.readDoc(args) } catch (e) { return { ok: false, thrown: String((e && (e as any).message) || e) } }
}
const isBundledPath = (v: any): boolean => norm(v).indexOf('/package/bundled-skills/') >= 0

// ---- 第一段：技能正文 + 可点名单 ----
const skill = await call({ name: 'domain-modeling' })
check(skill.ok === true && typeof skill.md === 'string' && skill.md.length > 0, '读技能正文：成功且带回原文')
check(isBundledPath(skill.path) && /domain-modeling\/SKILL\.md$/.test(norm(skill.path)), '正文路径来自随包目录（' + norm(skill.path) + '）')
const refs: string[] = Array.isArray(skill.refs) ? skill.refs : []
check(refs.length > 0, '正文成功时一并带回可点名单（' + refs.length + ' 个）')
for (const name of ['SKILL.md', 'GLOSSARY.md', 'GLOSSARY-FORMAT.md', 'ADR-FORMAT.md', 'AGENTS.md', 'CLAUDE.md', 'NOTES.md', 'issue-tracker.md', 'GLOSSARY-MAP.md', 'MISSION.md', 'RESOURCES.md', '0001-event-sourced-orders.md'])
  check(refs.indexOf(name) >= 0, '可点名单里包含正文会写到的 ' + name)
check(refs.indexOf('MISSION-FORMAT.md') >= 0 && refs.indexOf('SKILL-MECHANICS.md') >= 0, '可点名单里包含只以链接形式出现的模板名')
check(refs.indexOf('README.md') < 0, '随包根上的 README.md 不算技能正文里的名字（只认技能目录里的文件）')

// ---- 第二段：别名 → 格式模板（方案 C：先显示模板原文并注明这是格式说明） ----
const glossary = await call({ name: 'domain-modeling', file: 'GLOSSARY.md' })
check(glossary.ok === true && glossary.kind === 'format', 'GLOSSARY.md：按格式模板打开（kind=' + glossary.kind + '）')
check(glossary.file === 'GLOSSARY-FORMAT.md', 'GLOSSARY.md 对应到 GLOSSARY-FORMAT.md（实得 ' + glossary.file + '）')
check(glossary.skill === 'domain-modeling', '当前技能目录里有模板时优先用它（实得 ' + glossary.skill + '）')
check(isBundledPath(glossary.path) && base(glossary.path) === 'GLOSSARY-FORMAT.md', '打开的是随包真实文件（' + norm(glossary.path) + '）')
check(typeof glossary.md === 'string' && glossary.md.length > 100, '格式模板原文真的读出来了')
check(glossary.mdZh == null && glossary.pathZh == null, '今天还没有中文译文包：译文为空，界面只出「中文」以外的东西')

for (const [alias, target, curSkill] of [
  ['GLOSSARY-MAP.md', 'GLOSSARY-FORMAT.md', 'domain-modeling'],
  ['MISSION.md', 'MISSION-FORMAT.md', 'tdd'],
  ['RESOURCES.md', 'RESOURCES-FORMAT.md', 'tdd'],
  ['0001-event-sourced-orders.md', 'ADR-FORMAT.md', 'tdd'],
  ['0002-postgres-for-write-model.md', 'ADR-FORMAT.md', 'tdd'],
]) {
  const r = await call({ name: curSkill, file: alias })
  check(r.ok === true && r.kind === 'format' && r.file === target, alias + ' → ' + target + '（实得 ' + r.kind + '/' + r.file + '）')
}
const adr = await call({ name: 'tdd', file: '0001-event-sourced-orders.md' })
check(adr.skill === 'domain-modeling' && base(adr.path) === 'ADR-FORMAT.md', '示例文件名打开的是 ADR-FORMAT.md（实得 ' + norm(adr.path) + '）')

// ---- 第三段：同一个名字在多份技能目录里 → 当前技能优先，分不清给选择 ----
const ambiguous = await call({ name: 'tdd', file: 'GLOSSARY.md' })
check(ambiguous.ok === true && ambiguous.kind === 'choose', '当前技能里没有 GLOSSARY-FORMAT.md 时给选择（kind=' + ambiguous.kind + '）')
const opts = Array.isArray(ambiguous.options) ? ambiguous.options : []
const optSkills = opts.map((o: any) => String(o.skill)).sort()
check(optSkills.join(',') === 'domain-modeling,teach', '选择项就是两份技能目录（实得 ' + optSkills.join(',') + '）')
check(opts.every((o: any) => typeof o.file === 'string' && o.file === 'GLOSSARY-FORMAT.md'), '选择项里给的是真实文件名 GLOSSARY-FORMAT.md')
check(ambiguous.format === true, '别名经候选打开时标出「这是格式模板」：选完仍要注明格式说明（实得 ' + ambiguous.format + '）')

const cur = await call({ name: 'domain-modeling', file: 'GLOSSARY-FORMAT.md' })
check(cur.ok === true && cur.kind === 'file' && cur.skill === 'domain-modeling', '同名文件：当前技能目录优先（实得 ' + cur.skill + '）')
const other = await call({ name: 'tdd', file: 'GLOSSARY-FORMAT.md' })
check(other.ok === true && other.kind === 'choose', '不是当前技能里的同名文件：给选择，不擅自猜')

const skillSelf = await call({ name: 'prototype', file: 'SKILL.md' })
check(skillSelf.ok === true && skillSelf.kind === 'file' && skillSelf.skill === 'prototype', '正文里的 SKILL.md：打开当前技能自己的那一份')
const skillSelfLegacyZh = await call({ name: 'prototype', file: 'SKILL.md' })
check(skillSelfLegacyZh.mdZh == null || typeof skillSelfLegacyZh.mdZh === 'string', 'SKILL.md 的中文译文按既有规则处理（有就回，没有就空）')

const unique = await call({ name: 'tdd', file: 'AGENT-BRIEF.md' })
check(unique.ok === true && unique.kind === 'file' && unique.skill === 'triage' && base(unique.path) === 'AGENT-BRIEF.md', '整包只有一份的同名文件：直接打开（' + norm(unique.path) + '）')
const mechanics = await call({ name: 'writing-for-agents', file: 'SKILL-MECHANICS.md' })
check(mechanics.ok === true && mechanics.skill === 'writing-for-agents', 'SKILL-MECHANICS.md 打开当前技能目录里的那一份')

// ---- 第四段：issue-tracker.md → 三份模板先选一份 ----
const tracker = await call({ name: 'setup-matt-pocock-skills', file: 'issue-tracker.md' })
check(tracker.ok === true && tracker.kind === 'choose', 'issue-tracker.md：给三选一（kind=' + tracker.kind + '）')
const trackerFiles = (Array.isArray(tracker.options) ? tracker.options : []).map((o: any) => String(o.file)).sort()
check(trackerFiles.join(',') === 'issue-tracker-github.md,issue-tracker-gitlab.md,issue-tracker-local.md', '三份模板名字对得上（实得 ' + trackerFiles.join(',') + '）')
check((tracker.options || []).every((o: any) => typeof o.skill === 'string' && o.skill.length > 0), '每个选择项都带它所在的技能目录')
check(tracker.format !== true, 'issue-tracker.md 的三份候选不是格式模板，不硬套格式说明')

// ---- 第五段：五个项目文件只给一句说明，不伪造原文 ----
for (const name of ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CODING_STANDARDS.md', 'NOTES.md']) {
  const r = await call({ name: 'tdd', file: name })
  check(r.ok === true && r.kind === 'project', name + '：按「技能在你的项目里维护的文件」处理（kind=' + r.kind + '）')
  check(r.md == null && r.path == null, name + '：不伪造原文、不给路径')
  check(Array.isArray(r.refs) && r.refs.indexOf(name) >= 0, name + '：说明页也带回可点名单')
}

// ---- 第六段：白名单与越界拒绝 ----
const badRefs = ['../SKILL.md', '..\\SKILL.md', '/etc/passwd', 'C:/Windows/win.ini', 'a/b.md', 'nested/DEEPENING.md', 'SKILL.txt', '', '.md', 'GLOSSARY.MD', 'GLOSSARY.md ', ' GLOSSARY.md', 'GLOSSARY.md\u0000']
for (const bad of badRefs) {
  const r = await call({ name: 'domain-modeling', file: bad })
  check(r.ok === false && r.missing === true, '越界或不是随包 md 的文件名一律拒绝：' + JSON.stringify(bad))
}
const unknown = await call({ name: 'domain-modeling', file: 'dark-mode.md' })
check(unknown.ok === false && unknown.missing === true, '随包里没有的文件名：回「没有这一篇」')
const noName = await call({ file: 'AGENT-BRIEF.md' })
check(noName.ok === true && noName.skill === 'triage', '文件参数不依赖技能名也能找到唯一一份')
const badNameGoodFile = await call({ name: '../evil', file: 'AGENT-BRIEF.md' })
check(badNameGoodFile.ok === true && isBundledPath(badNameGoodFile.path), '故意传坏技能名：文件定位仍只从白名单里找，不被拼进路径')


// ---- 第六段半：中文译文 —— 宿主从随包目录旁边的 bundled-skills-zh 读（#1521 定下的位置） ----
// 真树里 bundled-skills-zh 还没落地（#1521 在做），所以这里在临时目录里搭一份最小随包，
// 再把工作目录挪进去调同一个 createSkillDoc：测的是宿主那条分支真的会去读译文，不是界面自塞假数据。
const fs = await import('node:fs/promises')
const os = await import('node:os')
const pathMod = await import('node:path')
const tmp = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'dsh-1522-'))
const oldCwd = process.cwd()
try {
  const dir = pathMod.join(tmp, 'package', 'bundled-skills', 'demo')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(pathMod.join(dir, 'SKILL.md'), '# Demo\n\nEnglish skill body.')
  await fs.writeFile(pathMod.join(dir, 'SKILL.zh.md'), '# 示例\n\n中文技能正文。')
  await fs.writeFile(pathMod.join(dir, 'EXTRA.md'), '# Extra\n\nEnglish extra body.')
  const zhDir = pathMod.join(tmp, 'package', 'bundled-skills-zh', 'demo')
  await fs.mkdir(zhDir, { recursive: true })
  await fs.writeFile(pathMod.join(zhDir, 'EXTRA.md'), '# 附加\n\n中文附加正文。')
  const sub = pathMod.join(tmp, 'sub')
  await fs.mkdir(sub)
  process.chdir(sub)
  const tmpDoc = createSkillDoc({})
  const zhSkill = await tmpDoc.readDoc({ name: 'demo' })
  check(zhSkill.ok === true && zhSkill.mdZh === '# 示例\n\n中文技能正文。', 'SKILL.md 的中文译文从同目录 SKILL.zh.md 读')
  check(typeof zhSkill.pathZh === 'string' && /SKILL\.zh\.md$/.test(norm(zhSkill.pathZh)), '技能正文的译文路径也一并带回')
  const zhFile = await tmpDoc.readDoc({ name: 'demo', file: 'EXTRA.md' })
  check(zhFile.ok === true && zhFile.kind === 'file' && zhFile.mdZh === '# 附加\n\n中文附加正文。', '非 SKILL.md 的随包文件从 bundled-skills-zh 读中文译文')
  check(typeof zhFile.pathZh === 'string' && norm(zhFile.pathZh).indexOf('/package/bundled-skills-zh/demo/EXTRA.md') >= 0, '译文路径落在 bundled-skills-zh 里')
} finally {
  process.chdir(oldCwd)
  await fs.rm(tmp, { recursive: true, force: true })
}

// ---- 第七段：详情页正文把文件名画成可点入口（jsdom + 真实 React，拼的是同一份 TS 真源）----
// 拼法与 tests/verify-skill-detail-stack.ts 一致：按构建口径把叶子转成可直接求值的脚本，
// 放进 vm 里跑；宿主电话用 pending 表模拟，按 args.file/args.name 分开回各自的读数。
const centralTime = await import('./../src/shared/time-config/values.js')
const SKILL_SKELETON_DELAY_MS = centralTime.SKILL_SKELETON_DELAY_MS
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:59519/' })
;(global as any).window = dom.window
;(global as any).document = dom.window.document
try { (global as any).navigator = dom.window.navigator } catch (e) { /* 忽略 */ }
;(global as any).IS_REACT_ACT_ENVIRONMENT = true
;(global as any).ResizeObserver = (dom.window as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
const ctx: any = {
  React, DswsCtx: React.createContext(null), console, setTimeout, clearTimeout, setInterval, clearInterval,
  emit: () => {}, tr: (k: any) => k, host: null, log: () => {}, dswsLogHash: (s: any) => 'h', dswsLogTrunc: (s: any) => s,
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  ResizeObserver: (global as any).ResizeObserver, Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error,
}
ctx.globalThis = ctx
vm.createContext(ctx)
const leafFiles = [
  'src/client/views/pixel/PixelStateIcon.js', 'src/client/views/pixel/PixelBtn.js', 'src/client/views/pixel/PixelSeal.js',
  'src/client/views/pixel/PixelSkeleton.js', 'src/client/views/pixel/PixelBanner.js', 'src/client/views/pixel/PixelStatusLine.js',
  // 目录（第一次出现 h2 才画）里还会用到 PixelNum：不拼进来就会在「点开格式模板」那一步崩。
  'src/client/views/pixel/PixelNum.js',
  'src/client/views/skillDetail/PixelContents.js', 'src/client/views/skillDetail/PixelMarkdown.js',
  'src/client/views/skillDetail/PixelSkillOps.js', 'src/client/views/skillDetail/PixelSkillDetailModal.js',
]
let clientLib = 'const SKILL_SKELETON_DELAY_MS = ' + JSON.stringify(SKILL_SKELETON_DELAY_MS) + ';\n'
for (const f of leafFiles) clientLib += spliceableJs(f) + '\n'
clientLib += ';globalThis.__o = { PixelSkillDetailModal, pixelOpenDetail, pixelCloseDetail, pixelRetryDetail, pixelOpenFileRef, pixelPickFileOption };'
vm.runInContext(clientLib, ctx)
const Comp = ctx.__o.PixelSkillDetailModal
const { pixelOpenDetail, pixelCloseDetail, pixelOpenFileRef } = ctx.__o
const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = ReactDOMClient.createRoot(container)
const pending: any = {}
const calls: any[] = []
ctx.host = {
  call: function (method: string, args: any) {
    calls.push({ method: method, args: args })
    const key = (args && args.file) ? ('file:' + args.file) : ('skill:' + ((args && args.name) || ''))
    return new Promise(function (resolve) { pending[key] = resolve })
  },
}
const REFS = ['SKILL.md', 'GLOSSARY.md', 'GLOSSARY-FORMAT.md', 'AGENTS.md', 'MISSION.md', 'SKILL-MECHANICS.md', 'issue-tracker.md', 'domain.md']
const store: any = { pixelDetailStack: [] }
const renderModal = async (): Promise<void> => {
  await act(async () => {
    root.render(React.createElement(Comp, {
      st: store,
      full: true,
      onRetry: () => {},
      onOpenSkill: (n: string) => pixelOpenDetail(store, n, null),
      skillNames: ['tdd', 'domain-modeling'],
    }))
    await new Promise((r) => setTimeout(r, 20))
  })
}
const html = (): string => container.innerHTML
const stack = (): any[] => store.pixelDetailStack
const top = (): any => stack()[stack().length - 1]
const resolvePending = async (key: string, res: any): Promise<void> => {
  await act(async () => {
    const r = pending[key]
    delete pending[key]
    if (r) r(res)
    await new Promise((rr) => setTimeout(rr, 20))
  })
  await renderModal()
}
const clickEl = async (el: any): Promise<void> => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  await renderModal()
}
const mdRefEls = (): any[] => Array.from(container.querySelectorAll('code.pixel-skillref')) as any[]
const mdRefByText = (text: string): any => mdRefEls().find((el: any) => el.textContent === text)
const bodyMd = [
  '# Domain modeling',
  '',
  '正文里写到的 \`GLOSSARY.md\` 要点得开；不存在的 \`dark-mode.md\` 不该点。',
  '',
  '项目文档惯例写 \`docs/agents/domain.md\`；占位符 \`package/bundled-skills/demo/SKILL.md\` 与示例 \`./src/billing/GLOSSARY.md\` 不该点。',
  '',
  '普通正文里写 AGENTS.md 也算名字，MISSION.md 同理。',
  '',
  '[格式模板](./GLOSSARY-FORMAT.md)',
  '',
  '[\`SKILL-MECHANICS.md\`](./SKILL-MECHANICS.md)',
  '',
  '\`\`\`text',
  'tree',
  '├── CLAUDE.md',
  '└── AGENTS.md',
  '\`\`\`',
].join('\n')
pixelOpenDetail(store, 'domain-modeling', null)
await renderModal()
await resolvePending('skill:domain-modeling', { ok: true, md: bodyMd, path: 'C:/x/domain-modeling/SKILL.md', refs: REFS })
check(stack().length === 1 && top().kind === 'skill', '打开技能正文：一层，kind=skill')
const refTexts = mdRefEls().map((el: any) => el.textContent)
check(refTexts.indexOf('GLOSSARY.md') >= 0, '行内代码里的 GLOSSARY.md 做成可点入口（实得 ' + JSON.stringify(refTexts) + '）')
check(refTexts.filter((x: any) => x === 'AGENTS.md').length >= 2, '普通正文与代码块里的 AGENTS.md 都做成入口')
check(refTexts.indexOf('格式模板') >= 0, '相对链接 [格式模板](./GLOSSARY-FORMAT.md) 做成入口（标签原样）')
check(refTexts.indexOf('SKILL-MECHANICS.md') >= 0, '相对链接里带反引号的标签去掉反引号后仍可点')
check(refTexts.indexOf('dark-mode.md') < 0, '名单里没有的 dark-mode.md 不做假入口')
const fileLogs = mdRefEls().map((el: any) => el.getAttribute('data-log'))
check(fileLogs.every((x: any) => /^sd\.md\.file\.\d+$/.test(String(x))), '每颗文件名入口都有各自的定位名（' + JSON.stringify(fileLogs) + '）')
check(new Set(fileLogs).size === fileLogs.length, '同一屏里文件名入口的定位名不重复')
check(!!mdRefByText('docs/agents/domain.md'), '带项目文档目录的行内代码（docs/agents/domain.md）也做成入口')
check(!mdRefByText('package/bundled-skills/demo/SKILL.md') && !mdRefByText('./src/billing/GLOSSARY.md'), '示例路径与占位符不做假入口（票面边界）')

// 点 docs/agents/domain.md：按名单里的 domain.md 打开（宿主白名单只认文件名，不带目录）
await clickEl(mdRefByText('docs/agents/domain.md'))
const domainCall = calls[calls.length - 1]
check(domainCall.args.file === 'domain.md' && domainCall.args.name === 'domain-modeling', '点 docs/agents/domain.md：电话带的是文件名 domain.md（实得 ' + JSON.stringify(domainCall.args) + '）')
await resolvePending('file:domain.md', { ok: true, kind: 'file', name: 'domain.md', file: 'domain.md', skill: 'domain-modeling', md: '# Domain\n\n项目文档原文。', path: 'C:/x/docs/agents/domain.md', refs: REFS })
check(top().kind === 'file' && html().indexOf('项目文档原文') >= 0, 'docs/agents/domain.md 打开的是它的随包原文')
await act(async () => { pixelCloseDetail(store); await new Promise((rr) => setTimeout(rr, 20)) })
await renderModal()

// 点行内代码里的 GLOSSARY.md：压一层，宿主电话带上「当前技能目录」与文件名
await clickEl(mdRefByText('GLOSSARY.md'))
const glossaryCall = calls[calls.length - 1]
check(glossaryCall.method === 'skill.readDoc' && glossaryCall.args.file === 'GLOSSARY.md', '点开 GLOSSARY.md：宿主电话带文件参数（实得 ' + JSON.stringify(glossaryCall.args) + '）')
check(glossaryCall.args.name === 'domain-modeling', '当前技能目录跟着一起带上（同名文件优先在这一份里找）')
check(stack().length === 2 && top().name === 'GLOSSARY.md', '点开时压一层新的详情（' + stack().map((d: any) => d.name).join('>') + '）')
await resolvePending('file:GLOSSARY.md', { ok: true, kind: 'format', name: 'GLOSSARY.md', file: 'GLOSSARY-FORMAT.md', skill: 'domain-modeling', md: '# 格式模板\n\n这是 GLOSSARY-FORMAT 的原文。\n\n## 小节', path: 'C:/x/domain-modeling/GLOSSARY-FORMAT.md', refs: REFS })
check(top().kind === 'format' && top().file === 'GLOSSARY-FORMAT.md', '点开的是格式模板那一份（kind=' + top().kind + '，file=' + top().file + '）')
check(html().indexOf('sd.fileFormat') >= 0, '格式模板先注明这是格式说明')
check(html().indexOf('这是 GLOSSARY-FORMAT 的原文') >= 0, '模板原文画进正文')

// 中英切换：模板带中文译文时，顶部「中文」按钮能切
await act(async () => { pixelCloseDetail(store); await new Promise((r) => setTimeout(r, 20)) })
await renderModal()
await clickEl(mdRefByText('格式模板'))
await resolvePending('file:GLOSSARY-FORMAT.md', { ok: true, kind: 'file', name: 'GLOSSARY-FORMAT.md', file: 'GLOSSARY-FORMAT.md', skill: 'domain-modeling', md: '# Format\n\nEnglish template body.', mdZh: '# 格式\n\n中文模板正文。', path: 'C:/x/GLOSSARY-FORMAT.md', pathZh: 'C:/x/zh/GLOSSARY-FORMAT.md', refs: REFS })
check(html().indexOf('English template body') >= 0, '默认出英文原文')
// 按钮组件会在调用点给的定位名前面统一补 pixel.btn.，这里按渲染后的属性找。
const langBtn = Array.from(container.querySelectorAll('[data-log="pixel.btn.sd.detail.lang"]'))[0] as any
check(!!langBtn, '有中文译文时出现中英切换按钮')
await clickEl(langBtn)
check(html().indexOf('中文模板正文') >= 0, '点「中文」切到译文正文')

// 关回技能正文，点普通正文里的 AGENTS.md：只给一句说明，不伪造原文
await act(async () => { pixelCloseDetail(store); await new Promise((r) => setTimeout(r, 20)) })
await renderModal()
await clickEl(mdRefByText('AGENTS.md'))
await resolvePending('file:AGENTS.md', { ok: true, kind: 'project', name: 'AGENTS.md', refs: REFS })
check(top().kind === 'project' && top().phase === 'ready', '项目文件打开成说明层（kind=' + top().kind + '）')
check(html().indexOf('sd.fileProject') >= 0 && top().name === 'AGENTS.md', '说明句里点名是哪个文件')
check(top().mdEn == null && top().docPath == null, '说明层不伪造原文、不给路径')

// 多份模板：先列按钮，选一份后换成那份原文
await act(async () => { pixelCloseDetail(store); await new Promise((r) => setTimeout(r, 20)) })
await renderModal()
pixelOpenFileRef(store, 'issue-tracker.md')
await renderModal()
await resolvePending('file:issue-tracker.md', { ok: true, kind: 'choose', name: 'issue-tracker.md', options: [
  { file: 'issue-tracker-github.md', skill: 'setup-matt-pocock-skills' },
  { file: 'issue-tracker-gitlab.md', skill: 'setup-matt-pocock-skills' },
  { file: 'issue-tracker-local.md', skill: 'setup-matt-pocock-skills' },
], refs: REFS })
check(top().kind === 'choose' && html().indexOf('sd.fileChoose') >= 0, '多份模板：先给选择说明')
const pickBtns = Array.from(container.querySelectorAll('[data-log^="pixel.btn.sd.detail.pick."]')) as any[]
check(pickBtns.length === 3, '三份模板各一颗按钮（实得 ' + pickBtns.length + ' 颗）')
await clickEl(pickBtns[0])
const pickCall = calls[calls.length - 1]
check(pickCall.args.file === 'issue-tracker-github.md' && pickCall.args.name === 'setup-matt-pocock-skills', '选第一份：按它自己的技能目录取原文（实得 ' + JSON.stringify(pickCall.args) + '）')
await resolvePending('file:issue-tracker-github.md', { ok: true, kind: 'file', name: 'issue-tracker-github.md', file: 'issue-tracker-github.md', skill: 'setup-matt-pocock-skills', md: '# GitHub 模板\n\n用 gh 管 issue。', path: 'C:/x/issue-tracker-github.md', refs: REFS })
check(top().kind === 'file' && html().indexOf('用 gh 管 issue') >= 0, '选完换成选中的那份原文')

// 别名文件（GLOSSARY.md）在当前技能目录里没有模板：先给候选，选完后仍要注明「这是格式说明」，
// 标题保留点进来的那个名字（票面：点开后弹窗标题是文件名）。
await act(async () => { pixelCloseDetail(store); await new Promise((rr) => setTimeout(rr, 20)) })
await renderModal()
await clickEl(mdRefByText('GLOSSARY.md'))
await resolvePending('file:GLOSSARY.md', { ok: true, kind: 'choose', name: 'GLOSSARY.md', format: true, options: [
  { file: 'GLOSSARY-FORMAT.md', skill: 'domain-modeling' },
  { file: 'GLOSSARY-FORMAT.md', skill: 'teach' },
], refs: REFS })
check(top().kind === 'choose' && top().format === true, '别名先给候选时记住它是格式模板（kind=' + top().kind + '，format=' + top().format + '）')
const fmtPicks = Array.from(container.querySelectorAll('[data-log^="pixel.btn.sd.detail.pick."]')) as any[]
check(fmtPicks.length === 2, '两份模板各一颗按钮（实得 ' + fmtPicks.length + ' 颗）')
await clickEl(fmtPicks[0])
const fmtCall = calls[calls.length - 1]
check(fmtCall.args.file === 'GLOSSARY-FORMAT.md' && fmtCall.args.name === 'domain-modeling', '选模板：按候选自己的技能目录取原文（实得 ' + JSON.stringify(fmtCall.args) + '）')
await resolvePending('file:GLOSSARY-FORMAT.md', { ok: true, kind: 'file', name: 'GLOSSARY-FORMAT.md', file: 'GLOSSARY-FORMAT.md', skill: 'domain-modeling', md: '# GLOSSARY-FORMAT\n\n模板原文。', path: 'C:/x/GLOSSARY-FORMAT.md', refs: REFS })
check(top().kind === 'format' && top().name === 'GLOSSARY.md' && top().titleEn === 'GLOSSARY.md', '选完仍是格式说明层，标题保留 GLOSSARY.md（实得 kind=' + top().kind + '，title=' + top().titleEn + '）')
check(html().indexOf('sd.fileFormat') >= 0, '选完仍注明这是格式说明')
check(html().indexOf('模板原文') >= 0, '选完画出模板原文')

// 关一层回到上一层
await act(async () => { pixelCloseDetail(store); await new Promise((r) => setTimeout(r, 20)) })
await renderModal()
check(stack().length === 1 && top().name === 'domain-modeling', '关一层回到技能正文（' + stack().map((d: any) => d.name).join('>') + '）')

console.log('\n#1522 详情页随包 md 引用：' + pass + ' 通过，' + fail + ' 失败')
if (fail > 0) process.exit(1)
