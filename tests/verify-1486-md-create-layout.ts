// verify-1486-md-create-layout.ts —— Markdown 建票落盘布局门禁（#1486，父票 #1480）。
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/create-layout.ts
// 门禁归属: src/tracker/rooms/markdown/format/generated.ts
//
// 这一扇门禁守的是 #1486 的验收五条：
//   ① 建规格落成 `.scratch/<feature>/spec.md`；建实施票与普通票落成
//      `.scratch/<feature>/issues/NN-<slug>.md`；同一幂等键重复创建不重复落盘。
//   ② 同一目录内编号从 01 连续递增；并发创建不丢号、不重号。
//   ③ 可见正文只有原文模板；插件信息只在第一个一级标题之前、一行一条。
//   ④ 返回里有人话说明落在哪个目录、哪一号；目录名无法确定时如实报错。
//   ⑤ 旧行为（落工作区根 `issues/`）不再出现。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1486-md-create-layout.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIssue } from '../src/tracker/rooms/markdown/issues.ts'
import { renderSpec, renderTicket } from '../src/tracker/rooms/markdown/create-render.ts'
import { MD_FORMAT } from '../src/tracker/rooms/markdown/format/generated.ts'

let checks = 0
const failures: string[] = []

function check(ok: boolean, message: string): void {
  checks += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
  if (!ok) failures.push(message)
}

/** 最小平台文件层：与 markdown 后端现有门禁用的是同一套形状（resolve/readText/writeText/lstat/listDir/stat）。 */
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

function listFiles(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return [] }
}

/** 第一个一级标题之前的所有 DSH 隐藏注释行；顺序原样保留。 */
function headerComments(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^#\s+/.test(line)) break
    if (/^\s*<!--\s*DSH-[A-Z-]+:/.test(line)) out.push(line.trim())
  }
  return out
}

function h1IndexOf(text: string): number {
  return text.split('\n').findIndex((line) => /^#\s+/.test(line))
}

function commentsBeforeH1(text: string): boolean {
  const lines = text.split('\n')
  const h1 = lines.findIndex((line) => /^#\s+/.test(line))
  if (h1 < 0) return false
  let seen = false
  for (let i = 0; i < lines.length; i += 1) {
    const isComment = /^\s*<!--\s*DSH-[A-Z-]+:/.test(lines[i])
    if (isComment && i > h1) return false
    if (isComment) seen = true
  }
  return seen
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1486-layout-'))
  const ctx = mkctx(tmp)

  // —— ① 建规格：没给 feature 时按标题建目录，落成 spec.md ——
  const specInput = {
    title: '买咖啡积分',
    body: '## Problem Statement\n\n用户想用积分买咖啡。\n\n## Solution\n\n积分可以直接抵扣。',
    type: 'spec',
    status: 'ready-for-agent',
    labels: ['ready-for-agent'],
    idempotencyKey: 'spec-1486-a',
  }
  const spec = await create(ctx, repoOf(), specInput)
  check(!!(spec && spec.ok), '① 建规格返回 ok：' + (spec && spec.ok ? '' : JSON.stringify(spec)))
  const specPath = path.join(tmp, '.scratch', '买咖啡积分', 'spec.md')
  check(fs.existsSync(specPath), '① 规格落在 .scratch/买咖啡积分/spec.md')
  if (spec && spec.ok) {
    check(spec.data.key === '00', '① 规格是容器编号 00：' + spec.data.key)
    check(spec.data.type === 'spec', '① 规格读回来是 spec：' + spec.data.type)
    check(spec.data.effortId === '买咖啡积分', '① 回执说清目录：' + spec.data.effortId)
  }

  const specText = readText(specPath)
  check(specText.startsWith('<!-- DSH-FORMAT: md-v1 -->'), '③ 规格文件第一行是 DSH-FORMAT')
  check(commentsBeforeH1(specText), '③ 规格的隐藏注释都在第一个一级标题之前')
  const specHeader = headerComments(specText)
  check(specHeader.length === 5, '③ 规格隐藏注释一行一条，共 5 条：' + JSON.stringify(specHeader))
  check(specHeader[0] === '<!-- DSH-FORMAT: md-v1 -->', '③ 第一条是 DSH-FORMAT')
  check(specHeader.indexOf('<!-- DSH-STATUS: ready-for-agent -->') >= 0, '③ 规格状态写进 DSH-STATUS')
  check(specHeader.indexOf('<!-- DSH-LABELS: ready-for-agent -->') >= 0, '③ 规格标签写进 DSH-LABELS')
  check(specHeader.some((l) => /^<!-- DSH-IDEMPOTENCY-KEY: spec-1486-a -->$/.test(l)), '③ 幂等键写进隐藏注释')
  check(specHeader.some((l) => /^<!-- DSH-CREATED: \d{4}-\d{2}-\d{2}T/.test(l)), '③ 创建时间写进 DSH-CREATED')
  check(!/DSH-ISSUE-KIND/.test(specText), '③ 新文件不再写旧的 DSH-ISSUE-KIND 标记')
  check(!/^\s*Status\s*[:\uFF1A]/m.test(specText), '③ 规格正文没有可见 Status 行')
  check(!/##\s*Comments/.test(specText), '③ 规格正文没有旧的 Comments 骨架')
  check(!/<!--\s*created\s*:/.test(specText), '③ 规格正文没有旧的 created 注释')
  check(/^# 买咖啡积分$/m.test(specText), '③ 一级标题是规格标题')
  check(/## Problem Statement/.test(specText) && /## Solution/.test(specText), '③ 原文段落保留')
  check(specText.indexOf('用户想用积分买咖啡。') > specText.indexOf('## Problem Statement'), '③ 段落正文保留')

  // 同一幂等键重复创建：不重复落盘，返回同一个结果。
  const specAgain = await create(ctx, repoOf(), specInput)
  check(!!(specAgain && specAgain.ok && specAgain.data.key === '00'), '① 同一幂等键重复建规格仍回 00')
  check(fs.existsSync(specPath), '① 重复建规格仍指向同一个 spec.md')
  check(!fs.existsSync(path.join(tmp, '.scratch', '买咖啡积分-2')), '① 重复建规格没有多出目录')
  const specDirs = fs.readdirSync(path.join(tmp, '.scratch')).filter((d) => d.startsWith('买咖啡积分'))
  check(specDirs.length === 1, '① 重复建规格只落一份：' + JSON.stringify(specDirs))

  // —— ① 建实施票：给 feature，落成 issues/01-<slug>.md ——
  const featureRepo = repoOf('买咖啡积分', 'feature')
  const ticketBody = '<!-- DSH-ISSUE-KIND: ticket -->\n\n**What to build:** 用户能看到第一步。\n\n- [ ] 能看到结果'
  const ticket = await create(ctx, featureRepo, {
    title: '第一步',
    body: ticketBody,
    type: 'issue',
    parentKey: '00',
    status: 'ready-for-agent',
    labels: ['ready-for-agent'],
    idempotencyKey: 'ticket-1486-a',
  })
  check(!!(ticket && ticket.ok), '① 建实施票返回 ok：' + (ticket && ticket.ok ? '' : JSON.stringify(ticket)))
  const ticketPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '01-第一步.md')
  check(fs.existsSync(ticketPath), '① 实施票落在 issues/01-第一步.md')
  if (ticket && ticket.ok) {
    check(ticket.data.key === '01', '② 实施票编号从 01 起：' + ticket.data.key)
    check(ticket.data.parentKey === '00', '① 实施票父票读回来是 00：' + String(ticket.data.parentKey))
  }
  const ticketText = readText(ticketPath)
  check(/^# 01: 第一步$/m.test(ticketText), '③ 实施票标题按原文形状 # NN: 标题')
  check(/\*\*What to build:\*\* 用户能看到第一步。/.test(ticketText), '③ 实施票正文有 What to build 字段行')
  check(/\*\*Blocked by:\*\* None \(can start immediately\)/.test(ticketText), '③ 实施票正文有 Blocked by 字段行')
  check(/\*\*Status:\*\* ready-for-agent/.test(ticketText), '③ 实施票正文有可见 Status 行')
  check(/- \[ \] 能看到结果/.test(ticketText), '③ 验收项保留')
  check(!/DSH-ISSUE-KIND/.test(ticketText), '③ 实施票不再写旧的 DSH-ISSUE-KIND 标记')
  check(!/##\s*Comments|##\s*Answer/.test(ticketText), '③ 实施票没有旧骨架')
  const ticketHeader = headerComments(ticketText)
  check(ticketHeader.length === 5, '③ 实施票隐藏注释共 5 条：' + JSON.stringify(ticketHeader))
  check(ticketHeader.indexOf('<!-- DSH-PARENT: 00 -->') >= 0, '③ 实施票父票写进 DSH-PARENT')
  check(ticketHeader.indexOf('<!-- DSH-STATUS: ready-for-agent -->') < 0, '③ 实施票不写隐藏状态（可见 Status 行就是状态）')
  check(commentsBeforeH1(ticketText), '③ 实施票隐藏注释都在一级标题之前')

  const ticketAgain = await create(ctx, featureRepo, {
    title: '第一步',
    body: ticketBody,
    type: 'issue',
    parentKey: '00',
    status: 'ready-for-agent',
    labels: ['ready-for-agent'],
    idempotencyKey: 'ticket-1486-a',
  })
  check(!!(ticketAgain && ticketAgain.ok && ticketAgain.data.key === '01'), '① 同一幂等键重复建实施票仍回 01')
  check(listFiles(path.join(tmp, '.scratch', '买咖啡积分', 'issues')).length === 1, '① 重复建实施票没有多落一份')

  // —— ① 建普通票：同目录接着 02，没有父票就不写 DSH-PARENT ——
  const plain = await create(ctx, featureRepo, {
    title: '补一条说明',
    body: '**What to build:** 补一条说明。',
    type: 'issue',
    idempotencyKey: 'issue-1486-a',
  })
  check(!!(plain && plain.ok), '① 建普通票返回 ok：' + (plain && plain.ok ? '' : JSON.stringify(plain)))
  const plainPath = path.join(tmp, '.scratch', '买咖啡积分', 'issues', '02-补一条说明.md')
  check(fs.existsSync(plainPath), '② 同一目录编号连续到 02')
  if (plain && plain.ok) {
    check(plain.data.key === '02', '② 普通票编号是 02：' + plain.data.key)
    check(plain.data.parentKey === null, '① 普通票没有父票：' + String(plain.data.parentKey))
    check(!headerComments(readText(plainPath)).some((l) => l.startsWith('<!-- DSH-PARENT')), '③ 普通票不写空的 DSH-PARENT')
  }

  // —— ③ 目录撞名：同名标题的第二份规格加 -2 后缀并如实回报 ——
  const specSecond = await create(ctx, repoOf(), Object.assign({}, specInput, { idempotencyKey: 'spec-1486-b' }))
  check(!!(specSecond && specSecond.ok), '④ 同名标题第二份规格建得成')
  check(fs.existsSync(path.join(tmp, '.scratch', '买咖啡积分-2', 'spec.md')), '④ 目录撞名自动加 -2 后缀')
  if (specSecond && specSecond.ok) {
    check(specSecond.data.effortId === '买咖啡积分-2', '④ 回执如实回报 -2 目录：' + specSecond.data.effortId)
  }

  // —— ② 并发建票：同一目录 8 路同时建，不丢号不重号 ——
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, i) => create(ctx, featureRepo, {
      title: '并发 ' + i,
      body: '**What to build:** 并发第 ' + i + ' 条。',
      type: 'issue',
      idempotencyKey: 'concurrent-1486-' + i,
    })),
  )
  const keys = concurrent.map((r) => (r && r.ok ? r.data.key : '失败')).sort()
  check(keys.every((k) => /^\d{2}$/.test(k)), '② 8 路并发全部有编号：' + JSON.stringify(keys))
  check(new Set(keys).size === 8, '② 8 路并发编号不重号：' + JSON.stringify(keys))
  check(JSON.stringify(keys) === JSON.stringify(['03', '04', '05', '06', '07', '08', '09', '10']), '② 8 路并发编号从 03 连续到 10：' + JSON.stringify(keys))
  check(listFiles(path.join(tmp, '.scratch', '买咖啡积分', 'issues')).length === 10, '② 目录里共 10 份票文件')

  // —— ⑤ 旧行为不再出现：工作区根没有 issues/ ——
  check(!fs.existsSync(path.join(tmp, '.scratch', 'issues')), '⑤ 旧行为不再落到工作区根 issues/')
  check(!fs.existsSync(path.join(tmp, 'issues')), '⑤ 工作区根也没有 issues/')

  // —— ④ 目录名无法确定时如实报错：两个规格并存、建实施票没给 feature ——
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1486-ambiguous-'))
  const ctx2 = mkctx(tmp2)
  await create(ctx2, repoOf(), { title: '规格甲', body: '## Problem Statement\n\n甲。', type: 'spec', labels: ['ready-for-agent'], idempotencyKey: 'amb-a' })
  await create(ctx2, repoOf(), { title: '规格乙', body: '## Problem Statement\n\n乙。', type: 'spec', labels: ['ready-for-agent'], idempotencyKey: 'amb-b' })
  const ambiguous = await create(ctx2, repoOf(), {
    title: '没给目录的实施票',
    body: '<!-- DSH-ISSUE-KIND: ticket -->\n\n**What to build:** 没有指定目录。',
    type: 'issue',
    parentKey: '00',
    idempotencyKey: 'amb-ticket',
  })
  check(!!(ambiguous && ambiguous.ok === false), '④ 两个规格并存时建实施票拒绝猜目录')
  if (ambiguous && ambiguous.ok === false) {
    const message = String(ambiguous.error && ambiguous.error.message || '')
    check(/feature|规格/.test(message), '④ 错误信息是一句人话说清要先选目录：' + message)
  }
  check(!fs.existsSync(path.join(tmp2, '.scratch', '没给目录的实施票')), '④ 拒绝时不落到按标题猜的目录')

  // —— ⑥ 模板文字必须从 MD_FORMAT 渲染，不能再手写一份：运行时改掉配置里的标题/字段形状，
  //       渲染结果必须跟着变；不跟着变就说明代码又抄了一份模板，和 YAML 分叉了。——
  const specObject = (MD_FORMAT as unknown as { objects: Record<string, Record<string, unknown>> }).objects.spec
  const specTitleShape = String(specObject['title-shape'])
  specObject['title-shape'] = '# 模板哨兵: <spec 标题>'
  try {
    const probe = renderSpec({ title: '哨兵标题', body: '' }, { createdAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'probe', labels: [], assignees: [] })
    check(probe.indexOf('# 模板哨兵: 哨兵标题') >= 0, '⑥ 规格标题从 MD_FORMAT 渲染（改配置，输出跟着变）')
  } finally {
    specObject['title-shape'] = specTitleShape
  }
  const plainObject = (MD_FORMAT as unknown as { objects: Record<string, Record<string, unknown>> }).objects['implementation-ticket']
  const plainFields = plainObject.fields as Array<Record<string, unknown>>
  const plainFirstShape = String(plainFields[0]['line-shape'])
  plainFields[0]['line-shape'] = '**模板哨兵:** <>'
  try {
    const probe = renderTicket('issue', { title: '哨兵票', body: '' }, { number: '09', createdAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'probe', labels: [], assignees: [], parentKey: '' })
    check(probe.indexOf('**模板哨兵:**') >= 0, '⑥ 普通票字段行从 MD_FORMAT 渲染（改配置，输出跟着变）')
  } finally {
    plainFields[0]['line-shape'] = plainFirstShape
  }

  console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' verify-1486-md-create-layout: ' + checks + ' checks, ' + failures.length + ' failed')
  if (failures.length) {
    console.log('失败项：\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('门禁脚本自己抛了：', e)
  process.exitCode = 1
})
