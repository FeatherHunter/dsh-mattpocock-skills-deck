// verify-1789-create-preserve-sections.ts —— 建票时保留正文小节与代码围栏（#1789）。
// 门禁归属: src/tracker/rooms/markdown/create-render.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
//
// 这一扇门禁守 #1789 的验收：
//   ① 正文里的代码围栏（三个反引号或三个波浪号）原样落在票文件里，围栏里的 - [ ] 不被搬走；
//   ② 第一个二级标题之前的 - [ ] 进模板验收项位置，二级小节里的 - [ ] 留在原小节；
//   ③ 围栏里的 **Status:** 之类的示例行不被当成真字段读取。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1789-create-preserve-sections.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { renderTicket } from '../src/tracker/rooms/markdown/create-render.ts'

let checks = 0
const failures: string[] = []

function check(ok: boolean, message: string): void {
  checks += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
  if (!ok) failures.push(message)
}

/** 最小平台文件层：与 markdown 后端其它门禁用同一套形状（resolve/readText/writeText/lstat/listDir/stat）。 */
function platformStub() {
  return {
    path: path,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) {
        fs.mkdirSync(path.dirname(t), { recursive: true })
        fs.writeFileSync(t, c, 'utf8')
      },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
}

function mkctx(cwd: string) {
  const plat = platformStub()
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    get(name: string) { return name === 'fs' ? plat.fs : undefined },
  }
}

function repoOf(effortId?: string, scene?: string) {
  const repo: Record<string, unknown> = { backend: 'markdown', refId: '', name: '', url: '' }
  if (effortId) repo.effortId = effortId
  if (scene) repo.mdScene = scene
  return repo
}

async function create(ctx: unknown, repo: Record<string, unknown>, input: Record<string, unknown>) {
  return await createIssue(ctx as never, repo as never, input as never)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

/** 工作单元 issues/ 下唯一那份票文件的正文；目录或文件缺失时回空串。 */
function ticketTextOf(tmp: string, effortId: string): string {
  const dir = path.join(tmp, '.scratch', effortId, 'issues')
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return '' }
  return files.length ? readText(path.join(dir, files[0])) : ''
}

const FENCE = String.fromCharCode(96).repeat(3)

function checkboxLines(text: string): string[] {
  return text.split('\n').filter((line) => /^[ \t]*[-*][ \t]+\[[ xX]\]/.test(line)).map((line) => line.trim())
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1789-sections-'))
  const ctx = mkctx(tmp)

  // —— ① 端到端：正文自带 ## Acceptance 小节时，验收项留在原小节 ——
  const repoA = repoOf('保真小节', 'feature')
  const createdA = await create(ctx, repoA, {
    title: '小节保留',
    body: [
      '## 现象',
      '',
      '建票后原小节还在，但验收项被搬走。',
      '',
      '## Acceptance',
      '',
      '- [ ] 第一条验收',
      '- [ ] 第二条验收',
      '',
      '## 背景',
      '',
      '一些背景说明。',
    ].join('\n'),
    type: 'issue',
    parentKey: '00',
    status: 'ready-for-agent',
    labels: ['ready-for-agent'],
    idempotencyKey: 'v1789-a',
  })
  check(!!(createdA && createdA.ok), '① 建票返回 ok：' + (createdA && createdA.ok ? '' : JSON.stringify(createdA)))
  const textA = ticketTextOf(tmp, '保真小节')
  check(/^# 01: 小节保留$/m.test(textA), '① 票文件一级标题是 # 01: 小节保留')
  const statusA = textA.indexOf('**Status:**')
  const xianA = textA.indexOf('## 现象')
  check(statusA >= 0 && xianA > statusA, '① 字段行在正文之前')
  check(!/- \[ \]/.test(textA.slice(statusA, xianA)), '① 验收项没有被搬到 Status 行与正文之间')
  const acceptanceA = textA.indexOf('## Acceptance')
  const firstA = textA.indexOf('- [ ] 第一条验收')
  const secondA = textA.indexOf('- [ ] 第二条验收')
  const backgroundA = textA.indexOf('## 背景')
  check(acceptanceA >= 0 && firstA > acceptanceA && secondA > firstA && secondA < backgroundA, '① 两条验收项都留在 ## Acceptance 小节下')
  check(textA.indexOf('建票后原小节还在，但验收项被搬走。') > xianA, '① ## 现象 小节的正文保留')

  // —— ② 端到端：显式 What + 第一个二级标题前的验收项 + 小节验收项 + 围栏示例 ——
  const bodyB = [
    '**What to build:** 用户能看到第一步。',
    '',
    '- [ ] 模板验收项',
    '',
    '## 验收细节',
    '',
    '- [ ] 小节里的验收项甲',
    '- [ ] 小节里的验收项乙',
    '',
    '## 示例',
    '',
    FENCE + 'md',
    '- [ ] 代码块里的示例不该被搬走',
    FENCE,
  ].join('\n')
  const repoB = repoOf('保真围栏', 'feature')
  const createdB = await create(ctx, repoB, {
    title: '围栏保留',
    body: bodyB,
    type: 'issue',
    parentKey: '00',
    status: 'ready-for-agent',
    labels: ['ready-for-agent'],
    idempotencyKey: 'v1789-b',
  })
  check(!!(createdB && createdB.ok), '② 建票返回 ok：' + (createdB && createdB.ok ? '' : JSON.stringify(createdB)))
  const textB = ticketTextOf(tmp, '保真围栏')
  const statusB = textB.indexOf('**Status:**')
  const detailB = textB.indexOf('## 验收细节')
  const betweenB = textB.slice(statusB, detailB)
  check(!!(createdB && createdB.ok && statusB >= 0 && detailB > statusB), '② 票文件里有字段行与 ## 验收细节 小节')
  check(betweenB.includes('- [ ] 模板验收项'), '② 第一个二级标题之前的验收项进模板验收项位置')
  check(!betweenB.includes('甲') && !betweenB.includes('乙') && !betweenB.includes('代码块'), '② 小节与围栏里的验收项没有上移')
  check(checkboxLines(betweenB).length === 1, '② Status 与本段第一个小节之间只有模板验收项位置上的一条验收项：' + JSON.stringify(checkboxLines(betweenB)))
  const detailIndex = textB.indexOf('## 验收细节')
  const jia = textB.indexOf('小节里的验收项甲')
  const yi = textB.indexOf('小节里的验收项乙')
  const example = textB.indexOf('## 示例')
  check(detailIndex >= 0 && jia > detailIndex && yi > jia && example > yi, '② ## 验收细节 小节里的两条验收项原样留在小节下')
  check(textB.includes(FENCE + 'md\n- [ ] 代码块里的示例不该被搬走\n' + FENCE), '① 围栏里的 - [ ] 原样留在围栏内')

  // —— ② 只有复选框前缀：不应被并进 What to build 字段行 ——
  const renderOpts = {
    number: '03',
    createdAt: '2026-01-01T00:00:00.000Z',
    idempotencyKey: 'v1789-c',
    labels: [] as string[],
    assignees: [] as string[],
    parentKey: '',
  }
  const textC = renderTicket('issue', {
    title: '模板验收项',
    body: [
      '- [ ] 模板验收项甲',
      '- [ ] 模板验收项乙',
      '',
      '## 背景',
      '',
      '说明。',
    ].join('\n'),
  } as never, renderOpts as never)
  const backgroundC = textC.indexOf('## 背景')
  // #1790：普通票没有默认状态，不再写 Status 行；判定仍看「第一个二级标题之前」。
  const betweenC = textC.slice(0, backgroundC)
  check(/^\*\*What to build:\*\*[ \t]*$/m.test(textC), '② 复选框前缀没有被当成 What to build 的内容')
  check(!/\*\*Status:\*\*/.test(textC), '② 普通票不写状态行')
  check(betweenC.includes('- [ ] 模板验收项甲') && betweenC.includes('- [ ] 模板验收项乙'), '② 二级标题之前的复选框进模板验收项位置')
  check(checkboxLines(betweenC).length === 2, '② 一级标题与 ## 背景 之间只有两条模板验收项位置上的验收项')

  // —— ③ 围栏里的字段行示例不被当成真字段 ——
  const textD = renderTicket('issue', {
    title: '示例字段',
    body: [
      '**What to build:** 用户能看到第一步。',
      '',
      '## 写法示例',
      '',
      FENCE + 'md',
      '**Status:** resolved',
      '- [ ] 示例验收',
      FENCE,
    ].join('\n'),
  } as never, renderOpts as never)
  check((textD.match(/\*\*Status:\*\*/g) || []).length === 1, '③ 围栏里的 Status 示例不被当成真字段（普通票全文只有围栏里那一处）')
  check(textD.includes(FENCE + 'md\n**Status:** resolved\n- [ ] 示例验收\n' + FENCE), '① 围栏里的字段行示例原样保留')
  const beforeFirstFenceD = textD.slice(0, textD.indexOf(FENCE))
  check(!/- \[ \]/.test(beforeFirstFenceD), '① 围栏里的 - [ ] 没有被搬到模板验收项位置')

  // —— ① 第一个二级标题之前的围栏不能被拆散 ——
  const textE = renderTicket('issue', {
    title: '前缀围栏',
    body: [
      '写法说明。',
      '',
      FENCE + 'md',
      '- [ ] 围栏里的示例',
      FENCE,
      '',
      '## 背景',
      '',
      '说明。',
    ].join('\n'),
  } as never, renderOpts as never)
  check(/\*\*What to build:\*\* 写法说明。/.test(textE), '② 围栏前的说明仍进 What to build')
  check(textE.includes(FENCE + 'md\n- [ ] 围栏里的示例\n' + FENCE), '① 第一个二级标题之前的围栏原样保留')
  const beforeFirstFenceE = textE.slice(0, textE.indexOf(FENCE))
  check(!/- \[ \]/.test(beforeFirstFenceE), '① 围栏里的 - [ ] 没有被搬到字段行与围栏之间')

  // —— ④ 混用围栏符号：~~~ 里的 ``` 不关闭外层围栏，围栏里的内容一行都不搬 ——
  const TILDE = '~~~'
  const textF = renderTicket('issue', {
    title: '混用围栏',
    body: [
      '示例说明。',
      '',
      TILDE + 'md',
      '- [ ] 外层围栏里的验收项',
      FENCE + 'md',
      '**Status:** resolved',
      '- [ ] 内层围栏里的验收项',
      FENCE,
      TILDE,
      '',
      '## 背景',
      '',
      '说明。',
    ].join('\n'),
  } as never, renderOpts as never)
  const fenceBlockF = [TILDE + 'md', '- [ ] 外层围栏里的验收项', FENCE + 'md', '**Status:** resolved', '- [ ] 内层围栏里的验收项', FENCE, TILDE].join('\n')
  check(/\*\*What to build:\*\* 示例说明。/.test(textF), '② 混用围栏前的说明仍进 What to build')
  check(textF.includes(fenceBlockF), '④ 混用围栏（~~~ 里包 ```）整段原样保留')
  check((textF.match(/\*\*Status:\*\*/g) || []).length === 1, '④ 混用围栏里的 Status 示例不被当成真字段（全文只有围栏里那一处）')
  check(textF.indexOf('## 背景') > textF.indexOf(fenceBlockF), '④ 混用围栏后面的二级小节仍在围栏之后')
  const beforeFenceF = textF.slice(0, textF.indexOf(TILDE + 'md'))
  check(!/- \[ \]/.test(beforeFenceF), '④ 混用围栏里的 - [ ] 没有被搬到模板验收项位置')

  // —— ⑤ CRLF 正文：关闭围栏的行尾带 \r 时仍要能闭合，围栏里的示例字段也不能被当真值 ——
  const textG = renderTicket('issue', {
    title: 'CRLF 正文',
    body: [
      '说明。',
      '',
      '## 示例',
      '',
      FENCE + 'md',
      '- [ ] 围栏里的验收项',
      '**Status:** resolved',
      FENCE,
      '',
      '## 背景',
      '',
      '说明。',
    ].join('\r\n'),
  } as never, renderOpts as never)
  const fenceBlockG = [FENCE + 'md', '- [ ] 围栏里的验收项', '**Status:** resolved', FENCE].join('\r\n')
  check(textG.includes(fenceBlockG), '⑤ CRLF 正文的围栏整段原样保留（关闭行带 \\r 也能闭合）')
  check((textG.match(/\*\*Status:\*\*/g) || []).length === 1, '⑤ CRLF 围栏里的 Status 示例不被当成真字段（全文只有围栏里那一处）')
  check(textG.indexOf('## 背景') > textG.indexOf(fenceBlockG), '⑤ CRLF 围栏后面的二级小节仍在围栏之后')

  console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' verify-1789-create-preserve-sections: ' + checks + ' checks, ' + failures.length + ' failed')
  if (failures.length) {
    console.log('失败项：\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('门禁脚本自己抛了：', e)
  process.exitCode = 1
})
