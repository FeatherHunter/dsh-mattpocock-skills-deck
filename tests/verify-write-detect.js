// verify-write-detect.js —— 门禁：写事件判定表（#710 T6 第二批）
// 用法：在插件根目录执行 node tests/verify-write-detect.js，可独立运行。
//
// 为什么这份判定表要穷举着测（票面 #710「判定表必须是纯函数，要能被单测穷举」）：判定错了不是崩溃，
// 而是**静默漏刷或误刷** —— 漏了「你刚写完的东西五分钟还看不到」，误了「每敲一行命令就整池重建、把额度烧光」。
// 所以这里把三种形态、两类工具名、十几种命令行形态逐条钉住，另加两条反向断言：
//   ① 返回结果里不许出现命令原文（参数只做瞬时匹配，绝不外流）；
//   ② 用到的原因代号必须都在 DETECT_REASONS 那张表里（日志里只记代号，代号表要能解释它）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const OK = true
const BAD = false

/** 一条用例：[说明, 输入, 期望档位, 期望票号]（undefined 表示不查票号）。 */
const CASES = [
  // --- 我们自己的工具（票号只从具名参数取） ---
  ['自己的写工具带票号', { shape: 'tools/result', tool: 'deck_issue_patch', args: { issue: 42 }, succeeded: OK }, 'write-confirmed', '42'],
  ['自己的写工具带 # 号票号', { shape: 'tools/result', tool: 'deck_issue_patch', args: { key: '#42' }, succeeded: OK }, 'write-confirmed', '42'],
  ['自己的写工具票号认不出（数组参数）', { shape: 'tools/result', tool: 'deck_map_plan_create', args: { children: [{ number: 1 }, { number: 2 }] }, succeeded: OK }, 'write-confirmed', null],
  ['自己的读工具', { shape: 'tools/result', tool: 'deck_context', succeeded: OK }, 'default-tick', null],
  ['自己的读工具（大小写不同也认）', { shape: 'tools/result', tool: 'Deck_Issue_Get', succeeded: OK }, 'default-tick', null],

  // --- gh / glab 的写子命令 ---
  ['gh issue close 12', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['票号从正文里偷不出来（引号里的 #34 不算）', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue comment 12 --body "见 #34"', succeeded: OK }, 'write-confirmed', '12'],
  ['带值选项后面的数字不是票号', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue comment 12 -b 34', succeeded: OK }, 'write-confirmed', '12'],
  ['--add-label 不是子命令', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue edit 12 --add-label bug', succeeded: OK }, 'write-confirmed', '12'],
  ['建票：票号说不出来（未知）', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue create --title x --body y', succeeded: OK }, 'write-confirmed', null],
  ['写子命令没带票号', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue close --reason completed', succeeded: OK }, 'write-confirmed', null],
  ['票号也可以是一条链接', { shape: 'tools/result', tool: 'pwsh', command: 'gh pr merge https://github.com/o/r/pull/9', succeeded: OK }, 'write-confirmed', '9'],
  ['合并一支（--squash 不吃掉票号）', { shape: 'tools/result', tool: 'pwsh', command: 'gh pr merge 12 --squash --delete-branch', succeeded: OK }, 'write-confirmed', '12'],
  ['glab 的写子命令', { shape: 'tools/result', tool: 'pwsh', command: 'glab mr merge 7', succeeded: OK }, 'write-confirmed', '7'],
  ['glab 的读子命令', { shape: 'tools/result', tool: 'pwsh', command: 'glab issue view 3', succeeded: OK }, 'default-tick', null],
  ['gh 的读子命令', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue list --limit 12', succeeded: OK }, 'default-tick', null],
  ['gh 的求助输出', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue --help', succeeded: OK }, 'default-tick', null],
  ['认不出的子命令：立刻探一次', { shape: 'tools/result', tool: 'pwsh', command: 'gh frobnicate 1', succeeded: OK }, 'probe-now', null],

  // --- gh api：这类形态没有写动词 ---
  ['graphql 里出现 mutation：是写，但票号认不出', { shape: 'tools/result', tool: 'pwsh', command: 'gh api graphql -f query=mutation { closeIssue(input:{issueId:"I_1"}) { clientMutationId } }', succeeded: OK }, 'write-confirmed', null],
  ['graphql 里没有 mutation：认不出，立刻探一次（不丢弃）', { shape: 'tools/result', tool: 'pwsh', command: 'gh api graphql -f query=query { viewer { login } }', succeeded: OK }, 'probe-now', null],
  ['api 用 PATCH：写，票号从路径取', { shape: 'tools/result', tool: 'pwsh', command: 'gh api repos/o/r/issues/12 -X PATCH -f state=closed', succeeded: OK }, 'write-confirmed', '12'],
  ['api 用 --method DELETE', { shape: 'tools/result', tool: 'pwsh', command: 'gh api repos/o/r/issues/12 --method DELETE', succeeded: OK }, 'write-confirmed', '12'],
  ['api 带 -f（gh 里等于带请求体）', { shape: 'tools/result', tool: 'pwsh', command: 'gh api repos/o/r/issues/12 -f state=open', succeeded: OK }, 'write-confirmed', '12'],
  ['api 裸 GET：读', { shape: 'tools/result', tool: 'pwsh', command: 'gh api repos/o/r/issues/12', succeeded: OK }, 'default-tick', null],

  // --- 可疑那一档 ---
  ['git push', { shape: 'tools/result', tool: 'pwsh', command: 'git push origin main', succeeded: OK }, 'probe-now', null],
  ['git -C 之后才是子命令', { shape: 'tools/result', tool: 'pwsh', command: 'git -C D:\\repo push', succeeded: OK }, 'probe-now', null],
  ['git 的本地子命令', { shape: 'tools/result', tool: 'pwsh', command: 'git status', succeeded: OK }, 'default-tick', null],
  ['curl', { shape: 'tools/result', tool: 'pwsh', command: 'curl -X POST https://api.github.com/repos/o/r/issues', succeeded: OK }, 'probe-now', null],
  ['脚本', { shape: 'tools/result', tool: 'pwsh', command: 'node scripts/sync.mjs --push', succeeded: OK }, 'probe-now', null],
  ['包管理器跑脚本', { shape: 'tools/result', tool: 'pwsh', command: 'npm run verify', succeeded: OK }, 'probe-now', null],
  ['python 一行脚本', { shape: 'tools/result', tool: 'pwsh', command: 'python -c "import os"', succeeded: OK }, 'probe-now', null],
  ['重定向写文件（本地 Markdown 后端的票就是文件）', { shape: 'tools/result', tool: 'pwsh', command: 'echo hi > .scratch/0012-a.md', succeeded: OK }, 'probe-now', null],
  ['Set-Content 写文件', { shape: 'tools/result', tool: 'pwsh', command: 'Set-Content -Path .scratch/0012-a.md -Value x', succeeded: OK }, 'probe-now', null],
  ['认不出的命令：默认立刻探一次，不丢弃', { shape: 'tools/result', tool: 'pwsh', command: 'frobnicate --all', succeeded: OK }, 'probe-now', null],
  ['联网抓取类工具', { shape: 'tools/result', tool: 'WebFetch', succeeded: OK }, 'probe-now', null],
  ['认不出的远端类工具', { shape: 'tools/result', tool: 'mcp__tracker__do_it', succeeded: OK }, 'probe-now', null],
  ['命令工具却拿不到命令行', { shape: 'tools/result', tool: 'pwsh', succeeded: OK }, 'probe-now', null],

  // --- 只读那一档（其余） ---
  ['只读的本地工具', { shape: 'tools/result', tool: 'read', args: { file_path: 'x' }, succeeded: OK }, 'default-tick', null],
  ['只读的本地命令', { shape: 'tools/result', tool: 'pwsh', command: 'ls -la', succeeded: OK }, 'default-tick', null],
  ['目录切换那一段单独成段（不触发取数）', { shape: 'tools/result', tool: 'pwsh', command: 'cd D:\\repo', succeeded: OK }, 'default-tick', null],

  // --- 段与段之间：取最重的一档 ---
  ['多段命令里有一段是写', { shape: 'tools/result', tool: 'pwsh', command: 'cd D:\\repo; gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['管道里的一段是写', { shape: 'tools/result', tool: 'pwsh', command: 'echo x | gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['PowerShell 调用运算符', { shape: 'tools/result', tool: 'pwsh', command: "& 'gh' issue close 12", succeeded: OK }, 'write-confirmed', '12'],
  ['带目录与后缀的程序名也认得出', { shape: 'tools/result', tool: 'pwsh', command: 'D:\\tools\\gh.cmd issue close 12', succeeded: OK }, 'write-confirmed', '12'],

  // --- 形态与成功与否 ---
  ['会话事件 tool/result 形态照判', { shape: 'tool/result', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['ptc 内层派发的收尾形态', { shape: 'tool/ptc-dispatch', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['磁盘上的旧名字 code-dispatch 也认', { shape: 'tool/code-dispatch', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'write-confirmed', '12'],
  ['调用刚开始（tool/call）：什么都不做', { shape: 'tool/call', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'default-tick', null],
  ['ptc 派发的开始（*-start）：什么都不做', { shape: 'tool/ptc-dispatch-start', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'default-tick', null],
  ['失败的命令：不触发任何取数', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue close 12', succeeded: BAD }, 'default-tick', null],
  ['成功与否说不清：当没成功', { shape: 'tools/result', tool: 'pwsh', command: 'gh issue close 12' }, 'default-tick', null],
  ['形态认不出：按兜底节拍走', { shape: 'something/else', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK }, 'default-tick', null],
]

async function main() {
  console.log('写事件判定表门禁（#710 T6：三档判定穷举 + 两条反向断言）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'write-detect.js')).href)
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)

  check(mod.WRITE_DETECT_SOURCE === 'refresh-core/src/write-detect.ts', '产物带模块标识（能追溯到源码）')
  check(Array.isArray(mod.TIERS) && mod.TIERS.length === 3, '三档正好三条：' + String(mod.TIERS))
  check(mod.TIERS[0] === 'write-confirmed' && mod.TIERS[2] === 'default-tick', '三档次序是「越靠前越重」（取最重那一档靠它）')

  for (const [name, input, tier, ticket] of CASES) {
    const out = mod.detectWrite(input)
    const okTier = out && out.tier === tier
    const okTicket = (ticket === undefined) ? true : (out && out.ticket === ticket)
    check(okTier && okTicket, name + ' → ' + tier + (ticket === undefined ? '' : ' / 票号 ' + String(ticket)) +
      ((okTier && okTicket) ? '' : '（实际 ' + String(out && out.tier) + ' / ' + String(out && out.ticket) + '，原因 ' + String(out && out.reason) + '）'))
  }

  // 反向断言一：返回结果里不许出现命令原文（参数只做瞬时匹配，绝不外流）。
  const secret = 'gh issue comment 12 --body 客户甲的电话13900000000'
  const leak = mod.detectWrite({ shape: 'tools/result', tool: 'pwsh', command: secret, succeeded: OK })
  const dumped = JSON.stringify(leak)
  check(!dumped.includes('客户甲') && !dumped.includes('13900000000') && !dumped.includes('gh') && !dumped.includes('comment'),
    '返回值里一个字符的命令原文都没有：' + dumped)

  // 反向断言二：用到的原因代号必须都在 DETECT_REASONS 里（日志只记代号，代号表必须能解释它）。
  const used = new Set()
  for (const [, input] of CASES) used.add(mod.detectWrite(input).reason)
  const missing = Array.from(used).filter((r) => !mod.DETECT_REASONS[r])
  check(missing.length === 0, '用到的原因代号都在 DETECT_REASONS 表里（缺：' + (missing.join('、') || '无') + '）')
  const unused = Object.keys(mod.DETECT_REASONS).filter((r) => !used.has(r))
  check(unused.length === 0, '表里没有用不到的原因代号（多：' + (unused.join('、') || '无') + '）')

  // 判定 → 动作：数字从外面注入（本票不写额度数字）。
  const limits = { mergeWindowMs: budget.PATCH_MERGE_WINDOW_MS, probeIntervalMs: budget.PROBE_INTERVAL_MS }
  const withTicket = mod.detectWrite({ shape: 'tools/result', tool: 'pwsh', command: 'gh issue close 12', succeeded: OK })
  const p1 = mod.actionFor(withTicket, limits)
  check(p1.action === 'patch-now' && p1.ticket === '12' && p1.waitMs === budget.PATCH_MERGE_WINDOW_MS,
    '确定写且认得出票号 → 立刻补那一行，并带上合并窗口 ' + budget.PATCH_MERGE_WINDOW_MS + ' 毫秒')
  const noTicket = mod.detectWrite({ shape: 'tools/result', tool: 'pwsh', command: 'gh issue create --title x', succeeded: OK })
  const p2 = mod.actionFor(noTicket, limits)
  check(p2.action === 'probe-now' && p2.ticket === null, '确定写但票号认不出 → 降成立刻探测（补行得指名道姓）')
  const suspect = mod.detectWrite({ shape: 'tools/result', tool: 'pwsh', command: 'git push', succeeded: OK })
  check(mod.actionFor(suspect, limits).action === 'probe-now', '可疑档 → 立刻探一次')
  const idle = mod.detectWrite({ shape: 'tools/result', tool: 'read', succeeded: OK })
  const p4 = mod.actionFor(idle, limits)
  check(p4.action === 'wait-tick' && p4.waitMs === budget.PROBE_INTERVAL_MS, '其余档 → 等兜底节拍 ' + budget.PROBE_INTERVAL_MS + ' 毫秒')

  console.log(failed ? '\n存在失败 — 判定表未通过' : '\n全部通过 — 判定表 ' + CASES.length + ' 条用例逐条对上了（共 ' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
