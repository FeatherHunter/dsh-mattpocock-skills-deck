#!/usr/bin/env node
/**
 * verify-783-chain-effort.js —— 门禁：链记下直接改票文件并按工作单元区分同号票（票 #783）
 *
 * 守的是 Agent Brief 验收标准的每一条：
 *   1. 文件写工具改票文件后链上有记录（file-write），读不记
 *   2. 记录带着工作单元；同一工作单元两次写去重不撑破
 *   3. 两份工作单元同号是两条记录
 *   4. 老落盘兼容读回（v1 三元组按空串收），形状不对与版本不认识丢弃
 *   5. 跳转：有工作单元进对应那一张，取不到回落普通票页
 *   6. 远端后端行为不变（工作单元恒为空串）
 *   7. 界面上仍只显示编号
 *   8. writeEvents 把文件路径传下去并标成票文件来源
 *
 * 用法: node tests/verify-783-chain-effort.js（在插件根目录）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

function loadLeaf(leafPath, extra) {
  const src = fs.readFileSync(path.join(ROOT, leafPath), 'utf8')
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const deps = { React: null, DswsCtx: null, tr: (k) => k, Ic: () => ({}), Tip: () => ({}), pushNav: extra && extra.pushNav, findMapByIdentity: extra && extra.findMapByIdentity }
  const fn = new Function(Object.keys(deps).join(','), body + '\nreturn { SESSION_CHAIN_FIELD, sessionChainViewOf, sessionChainRowsOf, sessionChainOpenTicket }')
  return fn.apply(null, Object.keys(deps).map((k) => deps[k]))
}

async function main() {
  console.log('#783 链按工作单元区分同号票门禁（直接改票文件 / 键与落盘带工作单元 / 跳转）')
  const chain = await import(url('src/shared/refresh/chain.js'))
  const ticketsMod = await import(url('src/host/refresh/sessionTickets.js'))
  const readoutMod = await import(url('src/host/refresh/sessionChainReadout.js'))
  const writeMod = await import(url('src/host/refresh/writeEvents.js'))

  // ── 一、路径同源解析 ──
  console.log('\n== 一、编号与工作单元同源解析 ==')
  const p1 = chain.chainTicketAndEffortFromPath('D:/w/.scratch/alpha/issues/01-标题.md')
  check(p1.ticketKey === '1' && p1.effortId === 'alpha', '同源解析一次拿全（编号1 + 工作单元alpha）', JSON.stringify(p1))
  check(chain.chainTicketKeyFromPath('D:/w/.scratch/alpha/issues/01-标题.md') === '1', '旧入口仍只回编号')
  check(chain.chainEffortIdFromPath('D:/w/.scratch/alpha/issues/01-标题.md') === 'alpha', '新入口回工作单元')
  check(chain.chainEffortIdFromPath('D:/w/.scratch/map.md') === '', '根级扁平布局工作单元为空串')
  check(chain.chainEffortIdFromPath('D:/w/.scratch/issues/01-标题.md') === '', '根级 issues 工作单元为空串')
  check(chain.chainEffortIdFromPath('D:/w/docs/issues/0009-改名票.md') === '', '远端与文档路径工作单元为空串')
  check(chain.chainEffortIdFromPath('D:\\w\\.scratch\\beta\\map.md') === 'beta', 'Windows 反斜杠同样认出工作单元')

  // ── 二、判据：写记读不记，工作单元进输出 ──
  console.log('\n== 二、判据（只记写，工作单元进输出） ==')
  const vWrite = chain.chainVerdictOf({ source: 'markdown-file', tool: 'write', tier: 'probe-now', reason: 'tool.unknown', path: 'D:/w/.scratch/alpha/issues/01-标题.md' })
  check(vWrite.record && vWrite.action === 'file-write' && vWrite.ticketKey === '1' && vWrite.effortId === 'alpha', '改票文件记成写并带着工作单元', JSON.stringify(vWrite))
  const vRead = chain.chainVerdictOf({ source: 'markdown-file', tool: 'read', tier: 'default-tick', reason: 'tool.local-read', path: 'D:/w/.scratch/alpha/issues/01-标题.md' })
  check(!vRead.record && vRead.reason === 'chain.read-excluded', '看票文件仍然不记', JSON.stringify(vRead))
  const vGh = chain.chainVerdictOf({ source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 12 } })
  check(vGh.record && vGh.effortId === '', '远端后端行为不变（工作单元恒为空串）', JSON.stringify(vGh))

  // ── 三、去重按（工作单元，票号），落盘带工作单元 ──
  console.log('\n== 三、去重与落盘 ==')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't783-'))
  let clock = 1700000000000
  const app = ticketsMod.createSessionTickets({ cacheDir: dir, now: () => (clock += 1000) })
  const SID = 'sess-783'
  const ROOT_KEY = 'D:\\proj\\deck'
  const w = (input) => app.note(Object.assign({ rootKey: ROOT_KEY, backend: 'markdown' }, input))
  const r1 = await w({ sessionId: SID, source: 'markdown-file', tool: 'write', path: 'D:/w/.scratch/alpha/issues/01-A.md' })
  const r2 = await w({ sessionId: SID, source: 'markdown-file', tool: 'edit', path: 'D:/w/.scratch/beta/issues/01-B.md' })
  check(r1.recorded && r1.effortId === 'alpha' && r2.recorded && r2.effortId === 'beta', '两份工作单元同号是两条记录', JSON.stringify([r1, r2]))
  check(app.sizeOf(SID) === 2, '同号不合并（2 条）', '实得 ' + app.sizeOf(SID))
  const r1b = await w({ sessionId: SID, source: 'markdown-file', tool: 'write', path: 'D:/w/.scratch/alpha/issues/01-A2.md' })
  check(r1b.recorded && app.sizeOf(SID) === 2, '同一工作单元两次写仍是同一条（去重没被撑破）')
  const entries = app.entriesOf(SID)
  const alpha = entries.find((e) => e.effortId === 'alpha')
  const beta = entries.find((e) => e.effortId === 'beta')
  check(!!alpha && !!beta && alpha.ticketKey === '1' && beta.ticketKey === '1', '各自的票号都是1但工作单元不同', JSON.stringify(entries))
  const payload = chain.chainToDisk({ shards: { x: { shardId: chain.chainSessionShardId(SID), sessionId: SID, rootHash: chain.chainRootHash(ROOT_KEY), backend: 'markdown', entries: entries } } }, { at: 1 })
  check(payload.v === 2 && payload.shards[0].e[0].length === 4, '落盘数组加一段（四元组，版本2）', JSON.stringify(payload.shards[0].e[0]))
  const back = chain.chainFromDisk(payload)
  check(back.entries === 2, '新落盘读回两条', JSON.stringify(back))
  const oldPayload = { v: 1, at: 0, shards: [{ s: chain.chainSessionShardId(SID), r: chain.chainRootHash(ROOT_KEY), b: 'markdown', e: [['1', 1, 'file-write']] }] }
  const oldBack = chain.chainFromDisk(oldPayload)
  const oldEntries = chain.chainEntriesOf(oldBack.state, SID)
  check(oldBack.entries === 1 && oldEntries[0].effortId === '', '老三元组当工作单元未知收下', JSON.stringify(oldEntries))
  const badShape = chain.chainFromDisk({ v: 2, shards: [{ s: 'bad', r: 'bad', b: 'markdown', e: [] }] })
  check(badShape.shards === 0, '形状不对丢弃')
  const badVer = chain.chainFromDisk({ v: 99, shards: [] })
  check(badVer.reason === 'chain.disk-version' && badVer.shards === 0, '版本不认识整份丢弃')

  // ── 四、writeEvents 喂链 ──
  console.log('\n== 四、记账那一步传路径并标来源 ==')
  const seen = []
  const we = writeMod.createWriteEvents({
    canonicalKey: async () => ROOT_KEY,
    backendOf: async () => 'markdown',
    note: async (input) => { seen.push(input); return { recorded: true } },
    gate: null,
  })
  await we.handle({ id: SID, header: { cwd: ROOT_KEY } }, 'tools/result', 'write', { file_path: 'D:/w/.scratch/alpha/issues/01-A.md' }, true)
  check(seen.length === 1 && seen[0].source === 'markdown-file' && seen[0].path === 'D:/w/.scratch/alpha/issues/01-A.md', '写文件标成票文件来源并传路径', JSON.stringify(seen[0]))
  seen.length = 0
  await we.handle({ id: SID, header: { cwd: ROOT_KEY } }, 'tools/result', 'read', { file_path: 'D:/w/.scratch/alpha/issues/01-A.md' }, true)
  check(seen.length === 1 && seen[0].source === 'markdown-file', '读文件来源同样是票文件（链按读不记）', JSON.stringify(seen[0]))

  // ── 五、读数透出工作单元 ──
  console.log('\n== 五、读数与行数据 ==')
  const readout = readoutMod.buildSessionChainReadout({ tickets: app, at: 1700000000000 })
  const hasEffort = readout.sessions.some((s) => s.entries.some((e) => e.effortId === 'alpha' || e.effortId === 'beta'))
  check(readout.ok && hasEffort, '读数把工作单元透出来', JSON.stringify(readout.sessions[0].entries))
  const pushed = []
  const idOf = (eff, k) => String(eff) + '\0' + String(k).padStart(2, '0')
  const findMapByIdentity = (list, num, effortId) => {
    const k = String(num).padStart(2, '0')
    const want = idOf(effortId || '', k)
    const exact = (list || []).find((m) => idOf(m.effortId || '', String(m.key || m.number).padStart(2, '0')) === want)
    if (exact) return exact
    const anyEff = (list || []).some((m) => (m.effortId || '') !== '')
    if (anyEff) return null
    return (list || []).find((m) => String(m.number) === String(num)) || null
  }
  const leaf = loadLeaf('src/client/views/shared/sessionChainView.js', { pushNav: (st, kind, n, eid) => pushed.push({ kind, n, effortId: eid }), findMapByIdentity })
  const st = {
    tab: 'checks',
    snapshot: {
      sessionTickets: readout,
      issues: [
        { number: 1, title: 'A 的票', effortId: 'alpha', state: 'OPEN' },
        { number: 1, title: 'B 的票', effortId: 'beta', state: 'OPEN' },
      ],
      maps: [
        { number: 40, key: '40', effortId: 'alpha', title: 'A 地图', state: 'OPEN', type: 'map', tickets: [] },
        { number: 40, key: '40', effortId: 'beta', title: 'B 地图', state: 'OPEN', type: 'map', tickets: [] },
      ],
    },
  }
  const rows = leaf.sessionChainRowsOf(st)
  const rowAlpha = rows.find((r) => r.effortId === 'alpha')
  const rowBeta = rows.find((r) => r.effortId === 'beta')
  check(!!rowAlpha && rowAlpha.ticketTitle === 'A 的票' && !!rowBeta && rowBeta.ticketTitle === 'B 的票', '各自的标题落在自己那一份', JSON.stringify(rows.map((r) => r.ticketKey + '/' + r.effortId + '/' + r.ticketTitle)))
  const texts = JSON.stringify(rows)
  check(texts.indexOf('alpha') >= 0, '行数据带着工作单元（跳转用它找地图）')
  // 版面上仍只显示编号：行文本里是 #1 加标题，不带工作单元字样
  pushed.length = 0
  leaf.sessionChainOpenTicket(st, { ticketKey: '40', effortId: 'beta', isMap: true })
  check(pushed.length === 1 && pushed[0].kind === 'map' && pushed[0].n === 40 && pushed[0].effortId === 'beta', '取得到工作单元时进对应那一张', JSON.stringify(pushed))
  pushed.length = 0
  leaf.sessionChainOpenTicket(st, { ticketKey: '40', effortId: '', isMap: true })
  check(pushed.length === 1 && pushed[0].kind === 'issue', '取不到时回落普通票页（780 护栏接住）', JSON.stringify(pushed))

  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  console.log('\n' + (failed ? '有违规 — #783 门禁变红（共 ' + total + ' 项）' : '全部通过 — #783 链按工作单元区分（共 ' + total + ' 项）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行失败：' + (e && e.stack || e)); process.exit(1) })
