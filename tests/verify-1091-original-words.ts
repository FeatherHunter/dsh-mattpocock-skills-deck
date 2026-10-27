// verify-1091-original-words.ts —— #1091 防回归：维护者原话写进去要读得回来、一个字不改
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1091-original-words.ts，可独立运行。
//
// 为什么要有这一段（#1091 的验收）：改票与建票各加了 originalWords: {text, source} 参数，
// 要求把维护者的原话一字不改写进正文的「## 维护者原话」区（紧跟「## 目的」；没有目的区就放正文最前），
// 只追加、不编辑、不删除，同一段原话配同一个出处时幂等跳过，并且写后要读回逐字核对。
// 这一段分两层：
//   ① 纯函数层（shared 层）：位置、逐字引用、空行、代码块里的示例不算、幂等、60KB 硬顶、整份替换搬回；
//   ② 真工具层（真 Markdown 后端）：建票带原话、改票追加、重复写跳过、缺出处拒绝、进度与原话一起写、
//      整份正文改写保住原话区；每一层都逐条断言，失败就红。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
// 判定出口桩（#1003 单出口）：壳拿不到它时会回「判定出口这次没装上」，夹具照生产接上。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT: string = path.resolve(__dirname, '..')
// 反引号用字符码拼出来，免得这段源码里出现三连反引号把代码块围栏写死。
const FENCE = String.fromCharCode(96).repeat(3)
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

function makePlat() {
  return {
    path: path.posix,
    fs: {
      async resolve(p: any) { return String(p).replace(/\\/g, '/') },
      async readText(t: any) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: any, c: any) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: any) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: any) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: any) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
}

async function main() {
  console.log('#1091 防回归：维护者原话写进去要读得回来、一个字不改')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const words = await imp('src/shared/issue-file/src/original-words.js')
  const wordsTool = await imp('src/shared/issue-file/src/original-words-tool.js')
  const progressMod = await imp('src/shared/issue-file/src/progress.js')
  const LIMIT = progressMod.PROGRESS_BODY_LIMIT

  // ═══ 一、纯函数层：原话区的写法、位置、逐字、幂等、示例与硬顶 ═══
  const e1 = { text: '第一行原话\n\n第三行原话（中间的空行照原样保留）', source: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1091' }
  const purposeBody = '## 目的\n\n把这件事做完。\n\n## 边界\n\n只动原话区。\n'
  const placed = words.replaceOriginalWordsSection(purposeBody, e1)
  const placedHeading = placed.indexOf('## 维护者原话')
  check(placedHeading > placed.indexOf('## 目的'), '有目的区时：原话区排在目的区后面')
  check(placedHeading >= 0 && placedHeading < placed.indexOf('## 边界'), '原话区排在目的区与下一节之间，不是甩到文末')
  check(placed.indexOf('只动原话区。') > placed.indexOf('## 维护者原话'), '下一节的内容排在原话区后面、一个字没被挪动')
  const quoteBlock = '出处：' + e1.source + '\n> 第一行原话\n>\n> 第三行原话（中间的空行照原样保留）'
  check(placed.indexOf(quoteBlock) >= 0, '原话逐字写成「出处行 + 引用块」，空行写成单独一行 >')
  const placedLines = placed.split('\n')
  check(placedLines.some((l: string) => l === '出处：' + e1.source), '出处行在引用块外面单独一行')
  check(!placedLines.some((l: string) => l.indexOf('> 出处：') === 0), '出处行没有被塞进引用块里')

  // 没有目的区时放正文最前，但跳过文件头注释与一级标题。
  const headerBody = '<!-- DSH-IDEMPOTENCY-KEY: abc123 -->\n# 票标题\n\n正文内容。\n'
  const headerPlaced = words.replaceOriginalWordsSection(headerBody, e1)
  check(headerPlaced.indexOf('<!-- DSH-IDEMPOTENCY-KEY') === 0, '没有目的区时：文件头注释仍在最前面（不会被原话区挤走）')
  check(headerPlaced.indexOf('# 票标题') < headerPlaced.indexOf('## 维护者原话'), '没有目的区时：一级标题之后才是原话区')
  check(headerPlaced.indexOf('## 维护者原话') < headerPlaced.indexOf('正文内容。'), '原话区在正文内容之前（正文最前）')
  const barePlaced = words.replaceOriginalWordsSection('正文内容。\n', e1)
  check(barePlaced.indexOf('## 维护者原话') === 0, '既没有目的区也没有标题时：原话区就是正文第一行')

  // 已有区时只追加：旧条目原样保留、顺序不重排、标题不重复。
  const e2 = { text: '另一段原话', source: '本会话（2026-10-21T22:00+08:00）' }
  const appended = words.replaceOriginalWordsSection(placed, e2)
  check(appended.split(/\r?\n/).filter((l: string) => /^##\s*维护者原话\s*$/.test(l)).length === 1, '追加后仍然只有一个维护者原话标题')
  check(appended.indexOf('> 第一行原话') >= 0 && appended.indexOf('> 第一行原话') < appended.indexOf('> ' + e2.text), '旧原话在前、新原话在后，旧的原样保留')
  check(words.replaceOriginalWordsSection(purposeBody, e1).indexOf('## 目的\n\n把这件事做完。') >= 0, '写原话区不会顺手改目的区的内容')

  // 幂等：同一段原话 + 同一出处重复提交时跳过，正文一个字不改。
  const dup = words.applyOriginalWordsEntry(placed, e1, LIMIT)
  check(dup.skipped === true && dup.next === placed && dup.problem === '', '同一段原话 + 同一出处重复提交时幂等跳过（正文原样不动）')
  const fresh = words.applyOriginalWordsEntry(placed, e2, LIMIT)
  check(fresh.skipped === false && fresh.next !== null && fresh.next.indexOf(e2.text) >= 0, '新原话正常追加并写进正文')

  // 代码块里的示例标题不算真的原话区：示例原样保留，真区另起一处；示例里的原话也不算「已经写过」。
  const fenceBody = '## 目的\n\n目的内容。\n\n' + FENCE + '\n## 维护者原话\n\n出处：示例出处\n> ' + e1.text.split('\n')[0] + '\n' + FENCE + '\n'
  const fencePlaced = words.replaceOriginalWordsSection(fenceBody, e1)
  check(fencePlaced.indexOf(FENCE + '\n## 维护者原话\n\n出处：示例出处') >= 0, '代码块里的示例原话区原样保留、一个字没被改写')
  check(fencePlaced.indexOf('出处：' + e1.source) > fencePlaced.indexOf(FENCE), '真的原话区另起在示例之后（目的区一直延伸到文末，新原话追加在区末），没有把示例当成已有区')
  const fenceDup = words.applyOriginalWordsEntry(fenceBody, e1, LIMIT)
  check(fenceDup.skipped === false && fenceDup.next !== null, '示例里的文字不算「已经写过」，不会被误判成幂等跳过')

  // 60KB 硬顶：写前就超、和写进去才超，两种都拒绝且正文一个字不动。
  const bigBase = '## 目的\n\n' + 'x'.repeat(62000)
  const big = words.applyOriginalWordsEntry(bigBase, e1, LIMIT)
  check(big.next === null && big.problem.indexOf('硬顶') >= 0 && big.problem.indexOf('一个字没动') >= 0, '正文本来就超过 60KB 时拒绝写入、说清硬顶且正文没动')
  const nearBase = 'x'.repeat(LIMIT - 20)
  const near = words.applyOriginalWordsEntry(nearBase, e1, LIMIT)
  check(near.next === null && near.problem.indexOf('写进这条原话后') >= 0, '写进去才会超 60KB 时同样拒绝（不写半截）')
  const okLong = words.applyOriginalWordsEntry('## 目的\n\n短正文。\n', e1, LIMIT)
  check(okLong.next !== null && okLong.problem === '', '正常长度时照常写入')

  // 参数收口：出处必填、原话必填、出处写成一行、CRLF 归一。
  const badArgs = [
    ['没给对象', undefined], ['空对象', {}], ['原话是空串', { text: '', source: 'x' }],
    ['没给原话', { source: 'x' }], ['没给出处', { text: 'x' }], ['出处是空串', { text: 'x', source: '   ' }],
    ['出处写成两行', { text: 'x', source: 'a\nb' }],
  ]
  badArgs.forEach((one: any) => {
    const got = wordsTool.originalWordsFromArg(one[1])
    check(got.entry === null && String(got.problem).length > 0, '参数收口拒绝：' + one[0])
  })
  const goodArg = wordsTool.originalWordsFromArg({ text: '第一行\r\n第二行', source: '  https://example.com/i/1  ' })
  check(!!goodArg.entry && goodArg.entry.text === '第一行\n第二行' && goodArg.entry.source === 'https://example.com/i/1', '合法参数收成一条：CRLF 归一成换行、出处去两端空白')

  // 读回核对的两道：这一条在不在；改票那一路还要整份正文对得上。
  check(words.originalWordsPresenceProblem(e1, placed) === '', '读回核对：写进去的原话能逐字读回来')
  check(words.originalWordsPresenceProblem(e1, purposeBody) !== '', '读回核对：没写过的正文里找不到这一条时会说清')
  check(words.originalWordsReadbackProblem(e1, placed, placed) === '', '读回核对：整份正文与计划相同则通过')
  check(words.originalWordsReadbackProblem(e1, placed, purposeBody) !== '', '读回核对：别的区块被动了会判不通过')

  // 整份正文改写时搬回：递进来的新正文没有这一区时，按原位置（目的区后面）搬回、内容原样。
  const wholeIncoming = '# 票标题\n\n## 目的\n\n改写后的目的。\n\nStatus: open\n\n## Comments\n\n## Answer\n'
  const merged = words.restoreOriginalWordsSection(wholeIncoming, placed)
  check(merged.indexOf('## 维护者原话') > merged.indexOf('改写后的目的。'), '整份替换：盘上的原话区按原位置搬回来（仍在目的区后面）')
  check(merged.indexOf('## 维护者原话') < merged.indexOf('Status: open'), '整份替换：原话区在字段行之前（没有甩到文末）')
  check(merged.indexOf('出处：' + e1.source) >= 0 && merged.indexOf('> 第一行原话') >= 0 && merged.indexOf('> 第三行原话（中间的空行照原样保留）') >= 0, '整份替换：搬回来的原话逐字没变')
  check(words.restoreOriginalWordsSection(placed, purposeBody) === placed, '整份替换：新正文里已经有原话区时原样不动（不合并、不重排）')

  // ═══ 二、真工具层：建票带原话、改票追加、重复跳过、缺出处拒绝、进度一起写、整份改写保住 ═══
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), '1091-original-words-'))
  const rootAPosix = rootA.replace(/\\/g, '/')
  const issuesDir = path.join(rootA, '.scratch', 'demo', 'issues')
  fs.mkdirSync(issuesDir, { recursive: true })
  const plat = makePlat()
  const ctxA = { platform: plat, fs: plat.fs, cwd: rootAPosix, get(n: string) { return n === 'fs' ? plat.fs : undefined } }
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ctxA), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handleA = { cwd: rootAPosix, refId: '.scratch/demo' }
  chooseWorkspace(rootAPosix, 'markdown')
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ctxA, handleFor: () => handleA,
    log: { fire: () => {} }, now: () => clock,
    invalidate: () => {},
    decideBackend: makeDecideStub(registry),
    planStore: (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(id) || null }, save(id: string, s: unknown) { t.set(id, s) } } })(),
  }
  const createTool = (await imp('src/deck/tools/issue-create.ts')).createDeckIssueCreate(deps)
  const patchTool = (await imp('src/deck/tools/issue-patch.ts')).createDeckIssuePatch(deps)
  const getTool = (await imp('src/deck/tools/issue-get.ts')).createDeckIssueGet(deps)
  const execA = { agent: { session: { id: 's-1091', cwd: rootAPosix } } }
  const ticketFiles = (): string[] => { try { return fs.readdirSync(issuesDir).filter((f) => f.endsWith('.md')) } catch (e) { return [] } }

  // ① 建票带一条原话：写进正文、位置紧跟目的、写后核对那一步自报 ok。
  const created = await createTool.run(execA, { title: '原话摆放票', body: purposeBody, kind: 'issue', originalWords: e1 })
  check(!!created && created.status === 'ok', '建票带原话回 ok（实得 ' + String(created && created.status) + '，说明 ' + String((created && created.text) || '').slice(0, 160) + '）')
  const cKey = String((created.data && created.data.ticket && created.data.ticket.key) || '')
  const cItem = ((created && created.items) || []).find((i: any) => i.step === 'text') || {}
  check(cItem.status === 'ok' && !!cItem.originalWords && cItem.originalWords.source === e1.source, '建票写后核对那一步回 ok、记了写的是哪一条原话')
  const g0 = await getTool.run(execA, { key: cKey })
  const body0 = String((g0.data && g0.data.ticket && g0.data.ticket.body) || '')
  check(body0.indexOf('## 目的') >= 0 && body0.indexOf('## 维护者原话') > body0.indexOf('## 目的'), '读回正文：原话区在建出来的票上、排在目的区后面')
  check(body0.indexOf('## 维护者原话') < body0.indexOf('## 边界'), '读回正文：原话区夹在目的区与下一节之间')
  check(body0.indexOf(quoteBlock) >= 0, '读回正文：原话逐字读得回来（出处行 + 引用块，空行保留）')
  check(body0.split('\n').some((l: string) => l.indexOf('> 出处：') === 0) === false, '读回正文：出处行没有被写进引用块里')

  // ② 改票追加第二条：只追加、不重排、标题不重复。
  const w1 = await patchTool.run(execA, { key: cKey, originalWords: e2 })
  check(!!w1 && w1.status === 'ok', '改票追加原话回 ok（实得 ' + String(w1 && w1.status) + '，说明 ' + String((w1 && w1.text) || '').slice(0, 160) + '）')
  const w1Item = ((w1 && w1.items) || []).find((i: any) => i.step === 'text') || {}
  check(w1Item.status === 'ok' && Array.isArray(w1Item.fields) && w1Item.fields.indexOf('originalWords') >= 0, '改票写后核对那一步回 ok，fields 里写了 originalWords')
  const g1 = await getTool.run(execA, { key: cKey })
  const body1 = String((g1.data && g1.data.ticket && g1.data.ticket.body) || '')
  check(body1.indexOf('> 第一行原话') >= 0 && body1.indexOf('> 第一行原话') < body1.indexOf('> ' + e2.text), '读回正文：第一条在前、第二条在后，旧的原样保留')
  check(body1.split(/\r?\n/).filter((l: string) => /^##\s*维护者原话\s*$/.test(l)).length === 1, '读回正文：追加以后仍然只有一个维护者原话标题')

  // ③ 同一段原话 + 同一出处再写一次：幂等跳过，正文一个字不改。
  const w2 = await patchTool.run(execA, { key: cKey, originalWords: e2 })
  const w2Item = ((w2 && w2.items) || []).find((i: any) => i.step === 'text') || {}
  check(!!w2 && w2.status === 'ok' && w2Item.skipped === true, '重复提交同一段原话 + 同一出处时幂等跳过（实得 skipped=' + String(w2Item.skipped) + '）')
  const g2 = await getTool.run(execA, { key: cKey })
  check(String((g2.data && g2.data.ticket && g2.data.ticket.body) || '') === body1, '幂等跳过后正文一个字没动')

  // ④ 缺出处拒绝：整笔拒绝、正文一个字不动（原话是一字不改的东西，不替调用方编出处）。
  const w3 = await patchTool.run(execA, { key: cKey, originalWords: { text: '没有出处的原话' } })
  check(!!w3 && w3.status !== 'ok', '缺出处的原话被整笔拒绝（实得 ' + String(w3 && w3.status) + '）')
  check(String((w3 && w3.text) || '').indexOf('出处') >= 0 && String((w3 && w3.text) || '').indexOf('一个字都没动') >= 0, '拒绝说明里讲清出处必填、也说了一个字都没动')
  const g3 = await getTool.run(execA, { key: cKey })
  check(String((g3.data && g3.data.ticket && g3.data.ticket.body) || '') === body1, '被拒以后正文一个字没动')

  // ⑤ 建票带缺出处的原话：这张票不建（一个文件都不多）。
  const filesBefore = ticketFiles().length
  const badCreate = await createTool.run(execA, { title: '不该建出来的票', kind: 'issue', originalWords: { text: '没有出处' } })
  check(!!badCreate && badCreate.status !== 'ok', '建票带缺出处的原话被拒（实得 ' + String(badCreate && badCreate.status) + '）')
  check(ticketFiles().length === filesBefore, '被拒以后没有多建出票文件')

  // ⑥ 正文本来就超 60KB：建票直接拒绝，不写半截。
  const bigCreate = await createTool.run(execA, { title: '超长正文带原话', body: '## 目的\n\n' + 'x'.repeat(62000), kind: 'issue', originalWords: e1 })
  check(!!bigCreate && bigCreate.status !== 'ok', '正文超过 60KB 时带原话建票被拒（实得 ' + String(bigCreate && bigCreate.status) + '）')
  check(ticketFiles().length === filesBefore, '超长正文被拒以后也没有多建出票文件')

  // ⑦ 进度与原话一起写：两块都落上，写后核对一次交代两块。
  const bothTicket = await createTool.run(execA, { title: '进度与原话一起写的票', body: '## 目的\n\n一起写。\n', kind: 'issue' })
  const bothKey = String((bothTicket.data && bothTicket.data.ticket && bothTicket.data.ticket.key) || '')
  const e3 = { text: '一起写的原话', source: '文件:research/1089-progress-and-user-voice.md:1' }
  const both = await patchTool.run(execA, { key: bothKey, progress: { percent: 50, note: '一半' }, originalWords: e3 })
  check(!!both && both.status === 'ok', '进度与原话一起写回 ok（实得 ' + String(both && both.status) + '，说明 ' + String((both && both.text) || '').slice(0, 160) + '）')
  const bothItem = ((both && both.items) || []).find((i: any) => i.step === 'text') || {}
  check(bothItem.status === 'ok' && (bothItem.fields || []).indexOf('progress') >= 0 && (bothItem.fields || []).indexOf('originalWords') >= 0, '一起写时写后核对那一步报了两块（实得 ' + JSON.stringify((bothItem && bothItem.fields) || []) + '）')
  const gBoth = await getTool.run(execA, { key: bothKey })
  const bothBody = String((gBoth.data && gBoth.data.ticket && gBoth.data.ticket.body) || '')
  const bothProgress = (gBoth.data && gBoth.data.ticket && gBoth.data.ticket.progress) || null
  check(!!bothProgress && bothProgress.percent === 50 && bothProgress.note === '一半', '一起写时进度读回来是 50%（实得 ' + JSON.stringify(bothProgress) + '）')
  check(bothBody.indexOf('- 进度：50%') >= 0 && bothBody.indexOf(e3.text) >= 0, '一起写时正文里进度与原话都在')
  check(bothBody.indexOf('## 维护者原话') > bothBody.indexOf('## 目的') && bothBody.indexOf('## 维护者原话') < bothBody.indexOf('## 进度'), '一起写时原话区仍在目的区后面、进度区之前')

  // ⑧ 整份正文改写（自带一级标题）不丢原话区：搬回来时按原位置放。
  // 整段替换要带正文指纹（#1311 的正文指纹锁，docs/agents/issue-tracker.md 第 56 行）：先用
  // body:'full' 读一次，把 data.body.digest 原样放进 bodyDigest，否则工具按「怕覆盖别人的改动」一个字不动地拒绝。
  const whole = '# 原话摆放票\n\n## 目的\n\n改写后的目的。\n\nStatus: open\n\n## Comments\n\n## Answer\n'
  const beforeWhole = await getTool.run(execA, { key: cKey, body: 'full' })
  const wholeDigest = String((beforeWhole && beforeWhole.data && beforeWhole.data.body && beforeWhole.data.body.digest) || '')
  check(wholeDigest !== '', '整段改写前先读到了正文指纹（body:full 回 data.body.digest）')
  const w4 = await patchTool.run(execA, { key: cKey, body: whole, bodyDigest: wholeDigest })
  check(!!w4 && w4.status === 'ok', '整份正文改写回 ok（实得 ' + String(w4 && w4.status) + '，说明 ' + String((w4 && w4.text) || '').slice(0, 160) + '）')
  const g4 = await getTool.run(execA, { key: cKey })
  const body4 = String((g4.data && g4.data.ticket && g4.data.ticket.body) || '')
  check(body4.indexOf('## 维护者原话') >= 0, '整份正文改写以后维护者原话区还在（没有被整份覆盖丢掉）')
  check(body4.indexOf('## 维护者原话') > body4.indexOf('改写后的目的。'), '搬回来的原话区仍跟在目的区后面')
  check(body4.indexOf(quoteBlock) >= 0 && body4.indexOf(e2.text) >= 0, '搬回来的原话逐字没变（两条都在）')

  try { dispose.dispose() } catch (e) {}
  try { fs.rmSync(rootA, { recursive: true, force: true }) } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — #1091（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
