// verify-log-guards.js —— #494 第三件事：日志门禁之外层是否开启判断（#489 附录第 4 节断言二）。
// 用法：在插件根目录执行 node tests/verify-log-guards.js，可独立运行。
// 断言文字：扫描高频路径的日志调用，调用前有外层是否开启判断；无判断即红。
// 日志函数体内仍保留内部拦截做兜底。
// 做法：全部调试级调用必须同行带是否开启判断（唯一的例外是归一函数，
// 它的判断写在外层函数入口并附带结果变化才记）；房内三点六个事件与
// 执行 gh 的外层判断逐项点名；命名守护启动调度那一行单独锁死。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志外层判断门禁（#494：高频调用处先判开关再组装字段，体内兜底仍在）')

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) out.push(p)
    }
  }
  walk(dir)
  return out
}
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 一、高频路径：全部调试级调用同行带是否开启判断。
// 调试级事件共 16 个（按需），关闭时一律不产生；同行判断保证字段函数不求值。
{
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
  const bad = []
  let debugSites = 0
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const isDebugCall = /['"]debug['"]\s*,\s*['"][a-z]+\./.test(line) &&
        /(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog|logEvent|backendLogEvent|roomLogEvent)\s*\(|(?:^|[^A-Za-z0-9_$])f\s*\(/.test(line)
      if (!isDebugCall) return
      debugSites += 1
      if (!/isEnabled\s*\(/.test(line)) bad.push({ where: rel + ' 第 ' + (i + 1) + ' 行', line: line.trim() })
    })
  }
  check(debugSites >= 16, '调试级调用点不少于 16 处（实得 ' + debugSites + ' 处，覆盖全部按需事件）')
  // 两处例外都在下面逐项点名：归一函数（判断在入口），
  // 链谓词（判断在外层大括号，附带 15 秒节流与逐个变化才记）。
  const isExcused = (b) => b.where.includes('backends' + path.sep + 'github' + path.sep + 'errors.js') ||
    (b.where.includes('detectChain.js') && b.line.includes("'debug', 'chain.predicate'"))
  const show = (b) => b.where + '：' + b.line.slice(0, 120)
  const unexplained = bad.filter((b) => !isExcused(b))
  check(unexplained.length === 0, '调试级调用同行带是否开启判断' + (unexplained.length ? ' —— 缺判断：' + unexplained.map(show).join('；') : '（' + debugSites + ' 处仅两处点名例外）'))
  check(unexplained.length === 0 && bad.length === 2, '例外恰为点名的两处（归一函数、链谓词）' + (bad.length === 2 ? '' : ' —— 实得 ' + bad.length + ' 处：' + bad.map(show).join('；')))
}

// 二、归一函数的入口判断与变化才记（例外的两项要求都在）。
{
  const src = readSrc(path.join('src', 'host', 'tracker', 'backends', 'github', 'errors.js'))
  check(src.includes('classifyGhError(err, ctx)'), '归一函数签名带调用方上下文（err、ctx 两参）')
  check(/isEnabled\s*\(\s*['"]debug['"]\s*\)/.test(src), '归一记法先判调试开关是否打开')
  check(src.includes('lastNormalizeKind'), '归一记法带上次结果记忆（结果不变不重复记）')
  check(/mapped\s*===\s*lastNormalizeKind/.test(src), '归一记法结果相同时直接返回')
  // 房内三路调用（执行、列表、单票）都把上下文传给归一，归一才有机会记。
  const roomCallSites = ['github' + path.sep + 'client.js', 'github' + path.sep + 'issues.js']
    .map((r) => readSrc(path.join('src', 'host', 'tracker', 'backends', r)))
  const withCtx = roomCallSites.reduce((n, t) => n + ((t.match(/classifyGhError\([\s\S]{0,120}?,\s*ctx\s*\)/g) || []).length), 0)
  check(withCtx >= 5, '房内调用归一都传上下文（实得 ' + withCtx + ' 处，执行、列表、单票三路）')
}

// 三、执行 gh 的外层判断：高频的信息事件关闭时不组装字段。
{
  const src = readSrc(path.join('src', 'host', 'tracker', 'backends', 'github', 'client.js'))
  check(/function roomInfoEnabled[\s\S]{0,300}isEnabled\s*\(\s*['"]info['"]\s*\)/.test(src), '信息是否开启判断函数存在（读调用方上下文的信息开关）')
  const emitAt = src.indexOf('function emitGhExec')
  const emitBody = emitAt >= 0 ? src.slice(emitAt, emitAt + 800) : ''
  const guardAt = emitBody.indexOf('roomInfoEnabled')
  const fireAt = emitBody.indexOf('roomLogEvent')
  check(guardAt >= 0 && fireAt >= 0 && guardAt < fireAt, '记执行事件先判信息开关再落事件（关闭时直接返回）')
  const emitCalls = (src.match(/emitGhExec\s*\(/g) || []).length - 1
  check(emitCalls >= 5, '执行 gh 的全部返回路都记执行事件（实得 ' + emitCalls + ' 处：解析失败、无执行器、失败、成功、抛错）')
  check(/isTimeoutText[\s\S]{0,200}emitGhTimeout/.test(src) || (src.includes('emitGhTimeout(timeout)')), '超时输出另记超时事件（只记命令名与超时毫秒）')
}

// 四、降级分支的两同名事件是常驻直发：函数体内无是否开启判断。
{
  const src = readSrc(path.join('src', 'host', 'tracker', 'backends', 'github', 'issues.js'))
  const fnAt = src.indexOf('function emitRestFallback')
  check(fnAt >= 0, '降级记法函数存在（列表与单票共用）')
  const fnBody = fnAt >= 0 ? src.slice(fnAt, src.indexOf('}', src.indexOf('catch', fnAt)) + 1) : ''
  check(fnBody.includes("'warn', 'graphql.fallback'") && fnBody.includes("'info', 'issues.fallback'"), '降级一次落两个同名事件（告警接信息）')
  check(!fnBody.includes('isEnabled'), '常驻直发不判开关（库体内兜底，无上下文时静默跳过）')
}

// 五、命名守护启动调度那一行带判断（此前单行整改锁死，退化即红）。
{
  const src = readSrc(path.join('src', 'host', 'namingGuardian.js'))
  const lines = src.split('\n')
  const startLine = lines.find((l) => l.includes("'timer.schedule'") && l.includes('naming-guardian'))
  check(!!startLine, '命名守护启动记调度事件')
  check(!!startLine && startLine.includes('isEnabled') && startLine.includes('debug'), '启动调度同行判调试开关（与跳过分支一致）')
}

// 六、链谓词例外：判断在外层大括号，15 秒节流加逐个变化才记。
{
  const src = readSrc(path.join('src', 'host', 'detectChain.js'))
  const fireAt = src.indexOf("'debug', 'chain.predicate'")
  const above = fireAt >= 0 ? src.slice(Math.max(0, fireAt - 600), fireAt) : ''
  check(above.includes("isEnabled('debug')"), '链谓词外层大括号先判调试开关')
  check(above.includes('15000'), '链谓词 15 秒节流（超时只记状态变化）')
  check(above.includes('lastPredStatus'), '链谓词逐个记变化（与上次不同才落事件）')
}

// 七、体内兜底仍在：两底座的记函数第一行就是级别判断。
{
  const hostSrc = readSrc(path.join('src', 'host', 'logStore.js'))
  const hostAt = hostSrc.indexOf('function log(level')
  const hostFirst = hostAt >= 0 ? hostSrc.slice(hostAt).split('\n').slice(1, 4).map((l) => l.trim()).filter(Boolean) : []
  check(hostFirst.length > 0 && hostFirst[0].includes('isEnabled'), '宿主记函数第一行判级别（体内兜底）')
  const cliSrc = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  const cliAt = cliSrc.indexOf('export const log = function')
  const cliFirst = cliAt >= 0 ? cliSrc.slice(cliAt).split('\n').slice(1, 4).map((l) => l.trim()).filter(Boolean) : []
  check(cliFirst.length > 0 && cliFirst[0].includes('isEnabled'), '客户端记函数第一行判级别（体内兜底）')
}

console.log(failed ? '\n存在失败 — verify-log-guards 未通过' : '\n全部通过 — 外层判断门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
