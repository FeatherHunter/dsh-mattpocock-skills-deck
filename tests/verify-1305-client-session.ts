// tests/verify-1305-client-session.ts —— #1305 门禁：客户端每条会触发「写工作区文件」的电话，都必须带上这次操作的会话号。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1305-client-session.ts，可独立运行。
//
// 为什么要有它：宿主写工作区文件要按「这一次请求的会话」算沙箱许可。客户端漏带会话号时，宿主只能在
// 这个工作区名下找活会话——正好一个才写得进，两个以上就分不清、如实失败。这类漏带在单元测试里看不见
// （电话参数是运行时拼的），所以用静态扫描把「每一条写工作区文件的电话都带 sessionId」钉成门禁。
// 唯一例外：设置页的工作区总览是只读循环，不写文件，不需要会话号（见 SettingsWorkspaces.ts 那一条）。
const path = require('path')
const fs = require('fs')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }

function walk(dir: string, out: string[]): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function rel(p: string): string { return path.relative(ROOT, p).replace(/\\/g, '/') }

// 找出所有 `host.call('电话名'` 的位置，连同它后面 320 个字符（够覆盖单行拼出来的参数对象）。
function callsOf(files: { file: string, src: string }[], phone: string) {
  const hits: { file: string, snippet: string }[] = []
  const needles = ["host.call('" + phone + "'", 'host.call("' + phone + '"']
  for (const one of files) {
    for (const needle of needles) {
      let at = one.src.indexOf(needle)
      while (at >= 0) { hits.push({ file: one.file, snippet: one.src.slice(at, at + 320) }); at = one.src.indexOf(needle, at + 1) }
    }
  }
  return hits
}

async function main() {
  console.log('#1305 客户端写工作区文件的电话要带会话号')
  // #1428 起九个客户端房文件住 src/refresh/rooms/client/：两棵一起扫，旧根不动（文件集合不变，只是换了住处，各条计数不受影响）。
  const files = walk(path.join(ROOT, 'src', 'client'), []).concat(walk(path.join(ROOT, 'src', 'refresh', 'rooms', 'client'), [])).map((p: string) => ({ file: rel(p), src: fs.readFileSync(p, 'utf8') }))

  // 1. wf.bind：切换后端四条执行点（Dock / 状态栏 / 切后端内核 / 面板门控叶），一条都不许漏会话号。
  const binds = callsOf(files, 'wf.bind')
  check(binds.length === 4, 'wf.bind 的执行点仍是四处（全仓客户端；新增一处要一起看这条门禁）', binds.map((b) => b.file).join(', '))
  const bindLeaks = binds.filter((b) => !/sessionId/.test(b.snippet)).map((b) => b.file)
  check(bindLeaks.length === 0, '四条 wf.bind 都带上了 sessionId（漏带时宿主分不清是哪个会话，写不进工作区文件）', bindLeaks.join(', '))

  // 2. wf.setupLayout：写布局的只有状态栏一处，同样要带会话号。
  const layouts = callsOf(files, 'wf.setupLayout')
  check(layouts.length === 1, 'wf.setupLayout 的执行点仍是一处（状态栏保存布局）', layouts.map((b) => b.file).join(', '))
  check(layouts.length === 1 && /sessionId/.test(layouts[0].snippet), '这一处 wf.setupLayout 带上了 sessionId', layouts.length ? layouts[0].snippet.slice(0, 160) : '')

  // 3. wf.selection：补问判定结论的那条要带会话号（它会顺手把旧选择迁进工作区文件）；
  //    那条的电话名是个变量（const method = 'wf.selection'），所以单独认它；
  //    设置页工作区总览是只读循环，不需要会话号，是唯一例外。
  const literalSels = callsOf(files, 'wf.selection')
  check(literalSels.length === 1 && literalSels[0].file.endsWith('/views/SettingsWorkspaces.ts'), '字面量 wf.selection 只剩设置页总览一处（补问那条走了变量，见下一条）', literalSels.map((s) => s.file).join(', '))
  const selOverview = literalSels[0]
  check(!!selOverview && !/sessionId/.test(selOverview.snippet), '设置页工作区总览仍然是只读循环、不带会话号（唯一例外，改动它前先想清楚：它不写文件）')
  const probeFile = files.filter((f) => f.file.endsWith('/rooms/client/probe-scope-selection.ts'))[0]
  const probeAt = probeFile ? probeFile.src.indexOf('host.call(method') : -1
  const probeSnippet = (probeFile && probeAt >= 0) ? probeFile.src.slice(probeAt, probeAt + 200) : ''
  check(!!probeFile && probeFile.src.indexOf("'wf.selection'") >= 0 && probeAt >= 0 && /sessionId/.test(probeSnippet), '进工作区补问 wf.selection（会顺带迁移旧选择）带上了 sessionId', probeSnippet.slice(0, 160))

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
