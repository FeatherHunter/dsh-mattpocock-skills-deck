#!/usr/bin/env node
// verify-deck-render-detail.js —— 渲染把明细交给模型的门禁（#809）
//
// #809 之前，deckAgentRender 只把 value.text 那一句摘要交给模型，value.data 里的
// 正文、评论、标签、子票清单、地图五区块、逐条边的落点证据，连同 value.notes 里
// 「这次可能没拿全」的降级警告，全部在最后一步被丢掉。工具说明与代理文档都承诺这些明细，
// 于是模型调了工具也拿不到内容，还会把残缺结果当完整结果用。
//
// 这份门禁盯住「接缝」：宿主侧的测试只看 run() 的 data（在），代理侧的测试只看有没有一句话，
// 两边各自都绿，丢明细这个事实正好落在缝里没人看见。本文件按各工具真实回包的形状手写夹具
// （deck_issue_get / deck_issue_list / deck_map_snapshot / deck_map_link / deck_issue_patch
// 的 data、items、readBack、notes 四格形状取自 src/host/tools/*.js），过一遍渲染，断言 AI 看得见。
// 手写夹具不等于活体调用，形状对不齐的风险由 tests/verify-deck-tools.js 那侧兜。
//
// 用法：node tests/verify-deck-render-detail.js（在插件根目录）
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// 两个上限直接从源文件里读，不在这里抄一份：抄一份的话，源文件改了上限而门禁还在按旧数造
// 数据，门禁会一直绿，人却以为它守着上限，其实早就守的不是那个数了。
const SRC = fs.readFileSync(path.join(ROOT, 'src/shared/deck-tools/agent-register.js'), 'utf8')
const limitOf = (name) => {
  const m = SRC.match(new RegExp('const ' + name + ' = (\\d+)'))
  if (!m) { console.log('  FAIL 源文件里读不到 ' + name + '，这条门禁得跟着改'); failed = true; return 1 }
  return Number(m[1])
}
const DETAIL_STRING_CAP = limitOf('DETAIL_STRING_CAP')
const DETAIL_TOTAL_CAP = limitOf('DETAIL_TOTAL_CAP')

async function main() {
  const agent = await imp('src/shared/deck-tools/agent-register.js')
  // 走注册时真正挂上去的那一份：deckToolsRow.js:151 与 agent-register.js:260 用的都是它。
  const render = agent.deckAgentOutputSchemaRaw().render
  const specRender = agent.deckAgentOutputSpec().render
  const all = (v) => (render({}, v) || []).map((b) => b.text).join('\n')

  // ── 1. 旧契约不破：只有状态与一句话时，仍然只回一块 ──
  //     （verify-deck-tools-agent-register.js:172 断言的就是这一格）
  const bare = render({}, { status: 'ok', text: '你好' })
  check(Array.isArray(bare) && bare.length === 1 && bare[0].type === 'text' && bare[0].text === '你好',
    '只有摘要时仍然只回一块（旧的代理侧断言不破）')

  // ── 2. 读一张票：正文、评论、标签、认领、边，都得看得见 ──
  const issueValue = {
    status: 'ok', text: '票 759 读回来了：状态 open，父票 758，被阻塞 0 条，阻塞别人 0 条。',
    data: {
      ticket: { key: '759', title: '一张票', state: 'open', labels: ['bug', 'needs-triage'], assignees: ['someone'], body: '这里是票的正文' },
      excerpt: '## 进度\n\n做了一半。',
      relations: { parentKey: '758', blockedBy: [], blocking: [{ key: '760' }] },
      comments: [{ body: '第一条评论' }, { body: '第二条评论' }],
    },
    notes: [],
  }
  const issueText = all(issueValue)
  check(issueText.indexOf('这里是票的正文') >= 0, '读票：票正文看得见')
  check(issueText.indexOf('bug') >= 0 && issueText.indexOf('needs-triage') >= 0, '读票：标签看得见')
  check(issueText.indexOf('第一条评论') >= 0 && issueText.indexOf('第二条评论') >= 0, '读票：评论看得见')
  check(issueText.indexOf('758') >= 0 && issueText.indexOf('760') >= 0, '读票：父子与阻塞边看得见')
  check(issueText.indexOf('someone') >= 0, '读票：认领人看得见')
  check(issueText.indexOf('做了一半') >= 0, '读票：正文节看得见')
  // 明细必须是能解析的 JSON，不能是拼起来的散文
  const issueDetail = JSON.parse(issueText.slice(issueText.indexOf('明细（JSON）：') + '明细（JSON）：'.length))
  check(!!issueDetail.data && issueDetail.data.ticket.key === '759', '读票：明细是合法 JSON 且带得上 data')

  // ── 3. 列薄行：每一行都得看得见 ──
  const listValue = {
    status: 'ok', text: 'ISSUE 列表：共 3 行符合（state=all），回 3 行。',
    data: { total: 3, returned: 3, truncated: false, issues: [
      { key: '758', title: '地图甲', state: 'open', type: 'map' },
      { key: '759', title: '子票乙', state: 'open', type: 'issue' },
      { key: '760', title: '子票丙', state: 'closed', type: 'issue' },
    ] },
  }
  const listText = all(listValue)
  check(listText.indexOf('地图甲') >= 0 && listText.indexOf('子票乙') >= 0 && listText.indexOf('子票丙') >= 0,
    '列票：三行薄行都看得见（#809 之前一行都没有）')

  // ── 4. 看地图：子票清单与五个区块都得看得见 ──
  const mapValue = {
    status: 'ok', text: '地图 758：子票 2 张，未关闭 1 张、已关闭 1 张、可接 0 张、被阻塞 0 张。',
    data: {
      children: [{ key: '759', title: '子票乙' }, { key: '760', title: '子票丙' }],
      blocks: { destination: '把渲染丢掉的东西找回来。', notes: ['这是备注'], decisions: ['已做决定一'], fog: ['还没想清的一块'], outOfScope: ['明确不做的那块'] },
    },
  }
  const mapText = all(mapValue)
  check(mapText.indexOf('子票乙') >= 0, '看地图：子票清单看得见')
  check(mapText.indexOf('把渲染丢掉的东西找回来') >= 0, '看地图：Destination 区块看得见')
  check(mapText.indexOf('这是备注') >= 0, '看地图：Notes 区块看得见')
  check(mapText.indexOf('已做决定一') >= 0, '看地图：Decisions so far 区块看得见')
  check(mapText.indexOf('还没想清的一块') >= 0, '看地图：Not yet specified 区块看得见')
  check(mapText.indexOf('明确不做的那块') >= 0, '看地图：Out of scope 区块看得见')

  // ── 5. 补边：逐条落点证据在 items 里，文档承诺过它 ──
  //     （docs/agents/issue-tracker.md:71 承诺「如实回报这条边落在哪一列」）
  const linkValue = {
    status: 'ok', text: '边补好了。',
    items: [{ key: '759', status: 'ok', landing: '原生 issue dependencies（界面上看得见）' }],
    data: { linked: ['759'] },
  }
  check(all(linkValue).indexOf('原生 issue dependencies') >= 0, '补边：每条边落在哪一列的证据看得见')

  // ── 6. 写后回读看得见，AI 才有办法核对改动是否真的落库 ──
  const patchValue = { status: 'ok', text: '票改好了。', readBack: { key: '759', state: 'closed', labels: ['ready-for-human'] } }
  check(all(patchValue).indexOf('ready-for-human') >= 0, '改票：写后回读看得见')

  // ── 7. 降级警告必须抬头，且排在明细前面 ──
  //     这是 #809 里比丢明细更危险的一半：没拿全却只说「读回来了」，人会把残缺当完整。
  const notesValue = {
    status: 'partial', text: '票 759 读回来了：状态 open。',
    notes: ['正文里没找到标题含「进度」的节，回的是全文前 2000 字。'],
    data: { excerpt: '……' },
  }
  const notesText = all(notesValue)
  check(notesText.indexOf('没找到标题含') >= 0, '降级警告看得见（不再静默吞掉）')
  check(notesText.indexOf('本次调用的提示') < notesText.indexOf('明细（JSON）：'), '降级警告排在明细前面')
  check(all({ status: 'unsupported', text: '没做成。', reason: 'no-backend' }).indexOf('no-backend') >= 0,
    '没做成时把 reason 一并给出')

  // ── 8. 截断必须写在明处：压掉了就要说，不许让人以为拿全了 ──
  const longString = '长'.repeat(DETAIL_STRING_CAP + 4000)
  const capped = all({ status: 'ok', text: '摘要。', data: { body: longString } })
  check(capped.indexOf('本段已截断') >= 0, '长正文被压时写明截断')
  check(capped.indexOf('原长 ' + longString.length + ' 字符') >= 0, '截断写明原有多长')
  const manyRows = { status: 'ok', text: '摘要。', data: { issues: [] } }
  for (let i = 0; i < 200; i++) manyRows.data.issues.push({ key: String(i), title: '标题' + i, body: '正文'.repeat(400) })
  const totalCapped = all(manyRows)
  check(/还有 \d+ 项未带回/.test(totalCapped), '总量超上限时写明还有几项没带回')
  check(totalCapped.length < manyRows.data.issues.length * 1000, '总量超上限后确实变小了（不是照单全收）')
  // 截断后形状必须仍然是合法 JSON：从半截 JSON 里取值，模型只能靠猜
  const cutJson = JSON.parse(totalCapped.slice(totalCapped.indexOf('明细（JSON）：') + '明细（JSON）：'.length))
  check(Array.isArray(cutJson.data.issues) && cutJson.data.issues.length < 200,
    '总量超上限后明细仍是合法 JSON（不是半截）')
  // 预算必须按共享余量往下传。曾经按值传，导致子级花掉的额度不归还父级，父级拿原额度去量子级，
  // 于是「正好填满」的子级被误判成超了而整块丢掉——200 条评论会只剩一句「issues 未带回」。
  check(!cutJson.data.__未带回, '总量超上限时被丢掉的是尾部条目，不是整块字段')
  check(totalCapped.length <= DETAIL_TOTAL_CAP * 1.1, '总量大致守住了上限（结构开销是估算，有小量超出）')

  // ── 9. readBack 与 data.ticket 是同一份时只送一次，别把预算吃两遍 ──
  //     （deckIssuePatch.js:159/161 把同一份同时放进 data.ticket 与 readBack）
  const back = { key: '759', state: 'closed', body: '正文' }
  const dedup = all({ status: 'ok', text: '票改好了。', data: { ticket: back, requested: ['state'] }, readBack: back })
  check((dedup.match(/正文/g) || []).length === 1, 'readBack 与 data.ticket 同一份时只投影一次')
  const noDup = all({ status: 'ok', text: '票改好了。', data: { ticket: back }, readBack: { key: '760' } })
  check(noDup.indexOf('760') >= 0 && noDup.indexOf('759') >= 0, '两份不同时两份都在')

  // ── 10. 畸形输入不许崩，也不许悄悄不给 ──
  const cyclic = { status: 'ok', text: '摘要。' }
  cyclic.data = { self: cyclic }
  let cycOut = null
  try { cycOut = all(cyclic) } catch (e) { cycOut = 'THREW:' + e }
  check(cycOut.indexOf('THREW') < 0, '明细里有循环引用时不抛')
  // 环回由嵌套门限挡住（展开到门限就写明没有展开），不会无限展开；真取不出来时另有交代
  check(cycOut.indexOf('取不出来') >= 0 || cycOut.indexOf('嵌套太深') >= 0,
    '明细里有循环引用时如实交代（不静默只剩摘要，也不在半截 JSON 里糊弄）')
  // 嵌套深到门限就说一声，不静默钻到底也不抛栈溢出
  let deep = { leaf: '底' }
  for (let i = 0; i < 20; i++) deep = { nest: deep }
  let deepOut = null
  try { deepOut = all({ status: 'ok', text: '摘要。', data: deep }) } catch (e) { deepOut = 'THREW:' + e }
  check(deepOut.indexOf('THREW') < 0, '嵌套很深时不抛')
  check(deepOut.indexOf('嵌套太深') >= 0, '嵌套深到门限时写明没有展开（不静默放过）')
  let nullOut = null
  try { nullOut = all(null) } catch (e) { nullOut = 'THREW:' + e }
  check(nullOut.indexOf('THREW') < 0, '返回值整个是 null 时不抛')
  check(all({ status: 'ok' }).indexOf('明细') < 0, '没有 data 就不硬造一个明细块')
  // 有明细但摘要那句话是空的：明细照样要送到，不能因为 summary 空了就整份丢掉
  check(all({ status: 'ok', text: '', data: { key: '759' } }).indexOf('759') >= 0, '摘要为空但有明细时，明细照样送到')
  // 官方写法那一份渲染走的是同一个函数，行为必须一致
  check(specRender({}, issueValue).length === render({}, issueValue).length, '两份渲染（官方写法与退路）行为一致')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
