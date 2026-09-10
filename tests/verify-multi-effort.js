/**
 * tests/verify-multi-effort.js — 本地 Markdown 多 effort 门禁（2026-09-09 定版）
 *
 * 背景：契约规定 `.scratch/<effort>/` 一个 effort 一目录、
 * 每个 effort 的票各自从 01 编号（package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md）。
 * 旧实现把每张地图都当成 key='00'、每张子票都当成 parentKey='00'，宿主又按编号摊平，
 * 于是多个 effort 在面板上撞成一份：只能打开第一个 effort，给第二个 effort 的票写评论会落到第一个 effort 的同号文件。
 *
 * 本门禁断言（全部在真实适配器上跑，不 mock）：
 *  ① 两个 effort 的地图各自只挂本 effort 的票（不串、不重复）；
 *  ② 按 (effort, 编号) 能各自定位到自己的文件（getIssue 带 effortId）；
 *  ③ 给第二个 effort 的票写评论只改第二个 effort 的文件；
 *  ④ 不带 effortId 的写操作在多 effort 同号时诚实报 conflict，绝不猜文件；
 *  ⑤ 建票落在指定 effort 内并按该 effort 取号（每个 effort 从 01 起）；
 *  ⑥ 单 effort / 扁平布局（.scratch/map.md）行为不变（effortId 为空串，老路径照走）。
 *
 * 运行：node tests/verify-multi-effort.js
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const ROOT = resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const plat = {
  path: path.posix,
  fs: {
    async resolve(p) { return p },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch { return null } },
    async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
    async stat(t) { try { return fs.statSync(t) } catch { return null } },
  },
}
const mkCtx = (cwd) => ({ platform: plat, fs: plat.fs, cwd, get(name) { if (name === 'fs') return plat.fs; return undefined } })

const { listIssues, getIssue, createIssue, closeIssue } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/markdown/issues.js')).href)
const { addComment } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/markdown/comments.js')).href)
const { createSnapshotComposer } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/snapshot.js')).href)
const { createMarkdownBackend } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/markdown/index.js')).href)
const { idOf, idOfParts, effortOf } = await import(pathToFileURL(resolve(ROOT, 'src/shared/tracker/constants.js')).href)

function writeEffort(root, name, mapTitle, tickets) {
  const dir = name ? path.join(root, '.scratch', name) : path.join(root, '.scratch')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), `# ${mapTitle}\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n\n## Destination\n\n${mapTitle} destination\n`, 'utf8')
  for (const [key, title] of tickets) {
    fs.writeFileSync(path.join(dir, 'issues', key + '-ticket.md'), `# ${title}\n\nStatus: ready-for-agent\nType: task\nLabels: wayfinder:task\n\n## What to build\n\n${title} body\n`, 'utf8')
  }
}

console.log('== ① 多 effort：地图各自只挂本 effort 的票 ==')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-multi-effort-verify-'))
  writeEffort(tmp, 'alpha', 'Alpha Map', [['01', 'Alpha First'], ['02', 'Alpha Second']])
  writeEffort(tmp, 'beta', 'Beta Map', [['01', 'Beta First']])
  const ctx = mkCtx(tmp)
  const repo = { backend: 'markdown', refId: tmp, name: path.basename(tmp), url: '' }

  const lr = await listIssues(ctx, repo, {})
  check(lr.ok === true, 'listIssues 成功')
  const maps = lr.ok ? lr.data.filter((x) => x.type === 'map') : []
  const tickets = lr.ok ? lr.data.filter((x) => x.type !== 'map') : []
  check(maps.length === 2, `两张地图（实际 ${maps.length}）`)
  check(maps.every((m) => typeof m.effortId === 'string'), '每张地图都带 effortId（核心字段）')
  check(tickets.every((t) => typeof t.effortId === 'string'), '每张票都带 effortId（核心字段）')
  check(maps.map((m) => m.effortId).sort().join(',') === 'alpha,beta', '两张地图分属 alpha / beta')

  const backend = createMarkdownBackend(ctx)
  const composer = createSnapshotComposer({ get: (id) => (id === 'markdown' ? backend : undefined) })
  const res = await composer.composeSnapshot('markdown', repo, ctx, { force: true })
  check(res.ok === true, 'composeSnapshot 成功')
  const snap = res.snapshot || {}
  const byEffort = {}
  for (const m of snap.maps || []) byEffort[effortOf(m)] = (m.tickets || []).map((t) => t.key).sort().join(',')
  check(byEffort.alpha === '01,02', `alpha 地图只挂 alpha 的票（实际 ${byEffort.alpha}）`)
  check(byEffort.beta === '01', `beta 地图只挂 beta 的票（实际 ${byEffort.beta}）`)

  console.log('== ② 按 (effort, 编号) 各自定位 ==')
  const a1 = await getIssue(ctx, { ...repo, effortId: 'alpha' }, '01', {})
  const b1 = await getIssue(ctx, { ...repo, effortId: 'beta' }, '01', {})
  check(a1.ok && a1.data.title === 'Alpha First', `alpha#01 = Alpha First（实际 ${a1.ok ? a1.data.title : 'err'}）`)
  check(b1.ok && b1.data.title === 'Beta First', `beta#01 = Beta First（实际 ${b1.ok ? b1.data.title : 'err'}）`)
  check(a1.ok && a1.data.effortId === 'alpha' && b1.ok && b1.data.effortId === 'beta', '返回的票带自己的 effortId')

  console.log('== ③ 写评论只改目标 effort 的文件 ==')
  const alphaFile = path.join(tmp, '.scratch', 'alpha', 'issues', '01-ticket.md')
  const betaFile = path.join(tmp, '.scratch', 'beta', 'issues', '01-ticket.md')
  const beforeAlpha = fs.readFileSync(alphaFile, 'utf8')
  const cm = await addComment(ctx, { ...repo, effortId: 'beta' }, '01', '给 Beta 的评论')
  check(cm.ok === true, 'addComment(beta#01) 成功')
  check(fs.readFileSync(betaFile, 'utf8').includes('给 Beta 的评论'), '评论落在 beta 文件里')
  check(fs.readFileSync(alphaFile, 'utf8') === beforeAlpha, 'alpha 文件未被改动')

  console.log('== ④ 不带 effortId 的写操作：多 effort 同号 → 诚实 conflict ==')
  const cm2 = await addComment(ctx, repo, '01', '不该落盘的评论')
  check(cm2.ok === false && cm2.error && cm2.error.kind === 'conflict', `addComment 无 effort 返回 conflict（实际 ${cm2.ok ? 'ok' : cm2.error.kind}）`)
  const cl2 = await closeIssue(ctx, repo, '01')
  check(cl2.ok === false && cl2.error && cl2.error.kind === 'conflict', `closeIssue 无 effort 返回 conflict（实际 ${cl2.ok ? 'ok' : cl2.error.kind}）`)
  check(!fs.readFileSync(betaFile, 'utf8').includes('不该落盘的评论'), 'conflict 时不写任何文件')

  console.log('== ⑤ 建票落在指定 effort、按该 effort 取号 ==')
  const cr = await createIssue(ctx, { ...repo, effortId: 'beta' }, { title: 'Beta New', type: 'task' })
  check(cr.ok === true, 'createIssue(beta) 成功')
  check(cr.ok && cr.data.effortId === 'beta', '新建票带 effortId=beta')
  check(cr.ok && cr.data.key === '02', `beta 内编号取 max+1 = 02（实际 ${cr.ok ? cr.data.key : 'err'}）`)
  check(fs.existsSync(path.join(tmp, '.scratch', 'beta', 'issues', '02-beta-new.md')), '文件落在 beta/issues 下')
  check(!fs.existsSync(path.join(tmp, '.scratch', 'alpha', 'issues', '02-beta-new.md')), '没有落到 alpha 下')
  const crNo = await createIssue(ctx, repo, { title: 'No Effort' })
  check(crNo.ok === false && crNo.error && crNo.error.kind === 'conflict', `无 effortId 建票返回 conflict（实际 ${crNo.ok ? 'ok' : crNo.error.kind}）`)
  // 指了一个不存在的 effort：必须诚实失败，绝不能落到根目录（否则票写进面板永远看不见的地方）
  const crBad = await createIssue(ctx, { ...repo, effortId: 'typo-effort' }, { title: 'Typo Effort' })
  check(crBad.ok === false && crBad.error && crBad.error.kind === 'not-found', `effortId 不存在时建票返回 not-found（实际 ${crBad.ok ? 'ok' : crBad.error.kind}）`)
  check(!fs.existsSync(path.join(tmp, '.scratch', 'issues')), '没有落到根目录 .scratch/issues（不猜位置）')

  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('== ⑥ 单 effort / 扁平布局行为不变 ==')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-single-effort-verify-'))
  writeEffort(tmp, '', 'Flat Map', [['01', 'Flat First']])
  const ctx = mkCtx(tmp)
  const repo = { backend: 'markdown', refId: tmp, name: path.basename(tmp), url: '' }
  const lr = await listIssues(ctx, repo, {})
  check(lr.ok && lr.data.length === 2, `扁平布局列出 2 条（实际 ${lr.ok ? lr.data.length : 'err'}）`)
  check(lr.ok && lr.data.every((x) => x.effortId === ''), '扁平布局 effortId 为空串（EMPTY，不是 MISSING）')
  const g = await getIssue(ctx, repo, '01', {})
  check(g.ok && g.data.title === 'Flat First', `无 effort 也能读（实际 ${g.ok ? g.data.title : 'err'}）`)
  const cm = await addComment(ctx, repo, '01', '扁平布局评论')
  check(cm.ok === true, '无 effort 的写操作在单 effort 仓库照常成功')
  check(fs.readFileSync(path.join(tmp, '.scratch', 'issues', '01-ticket.md'), 'utf8').includes('扁平布局评论'), '评论落在扁平布局文件里')

  console.log('== 身份函数自检 ==')
  check(idOf({ effortId: 'a', key: '01' }) !== idOf({ effortId: 'b', key: '01' }), '不同 effort 的同号票身份不同')
  check(idOf({ effortId: '', key: '01' }) === '01', '单 effort 后端身份退化为 key')
  check(idOfParts('a', '01') === idOf({ effortId: 'a', key: '01' }), 'idOf 与 idOfParts 同源')

  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('== ⑦ 宿主电话接线：三个按票寻址的电话都把 effortId 放进 ref ==')
{
  const ct = fs.readFileSync(resolve(ROOT, 'src/host/commentThreads.js'), 'utf8')
  const hits = ct.split('repoRef.effortId = String(args.effortId)').length - 1
  check(hits === 3, `wf.issueDetail / wf.issueComments / wf.commentIssue 三处都透传 effortId（实际 ${hits} 处）`)
  const read = fs.readFileSync(resolve(ROOT, 'src/host/tracker/backends/markdown/issues-read.js'), 'utf8')
  check(read.includes('resolveIssueFile') && read.includes('resolveMapFile'), '读路径经统一解析器（带 effort 范围）')
  const write = fs.readFileSync(resolve(ROOT, 'src/host/tracker/backends/markdown/comments.js'), 'utf8')
  check(write.includes("mode:'write'"), '写路径用 write 模式（多命中即 conflict，不猜文件）')
}

if (failed) { console.log('\n存在失败 — verify-multi-effort 未通过'); process.exit(1) }
console.log('\n全部通过 — 本地 Markdown 多 effort 维度成立（身份/读取/写入/建票/兼容）')
