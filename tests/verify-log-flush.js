// verify-log-flush.js —— #494 第三件事：日志门禁之错误与告警直通（#489 附录第 4 节断言四）。
// 用法：在插件根目录执行 node tests/verify-log-flush.js，可独立运行。
// 断言文字：错误与告警走直通刷盘路径；进入批量合并等待即红；
// 调用处等待写盘完成即红（必须只进队列就返回）。
// 做法：锁死两底座的分流形状（错误告警取消等待立刻写，普通走 1000 毫秒合并）；
// 全仓扫描调用处等待写法，出现一处即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志直通刷盘门禁（#494：错误告警不等批量，调用处只进队列就返回）')

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
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

// 一、宿主分流：错误与告警取消本次等待立刻写，普通走 1000 毫秒防抖合并。
{
  const src = readSrc(path.join('src', 'host', 'logStore.js'))
  check(/if\s*\(\s*level\s*===\s*['"]error['"]\s*\|\|\s*level\s*===\s*['"]warn['"]\s*\)\s*scheduleFlush\s*\(\s*true\s*\)/.test(src), '宿主错误与告警走直通（取消防抖等待）')
  check(/else\s*scheduleFlush\s*\(\s*false\s*\)/.test(src), '宿主普通走批量合并等待')
  check(src.includes('LOG_DEBOUNCE_MS = 1000'), '宿主合并窗口为 1000 毫秒')
  const immediate = src.match(/if\s*\(\s*immediate\s*\)\s*\{[\s\S]{0,300}?later\s*\(\s*\w+\s*,\s*(\d+)\s*\)/)
  check(!!immediate && immediate[1] === '0', '宿主直通本轮事件循环末就写（延迟 0 毫秒）')
  const logBody = src.slice(src.indexOf('function log(level'), src.indexOf('function scheduleFlush'))
  check(!/\bawait\b/.test(logBody), '宿主记函数内无等待（只进队列就返回）')
}

// 二、客户端分流：同宿主，错误与告警立刻发，普通走 1000 毫秒。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  check(/if\s*\(\s*level\s*===\s*['"]error['"]\s*\|\|\s*level\s*===\s*['"]warn['"]\s*\)\s*scheduleLogFlush\s*\(\s*true\s*\)/.test(src), '客户端错误与告警走直通（取消本次等待）')
  check(/else\s*scheduleLogFlush\s*\(\s*false\s*\)/.test(src), '客户端普通走批量合并等待')
  check(src.includes('LOG_FLUSH_MS = 1000'), '客户端合并窗口为 1000 毫秒')
  check(/later\s*\(\s*sendLogBatch\s*,\s*0\s*\)/.test(src), '客户端直通本轮事件循环末就发（延迟 0 毫秒）')
  const logBody = src.slice(src.indexOf('export const log = function'), src.indexOf('export const scheduleLogFlush'))
  check(!/\bawait\b/.test(logBody), '客户端记函数内无等待（只进队列就返回）')
}

// 三、告警直发不判开关：全部告警级调用行都不带是否开启判断。
// 告警始终落盘，判了反而拖慢直通；调试级才需要外层判断（见外层判断门禁）。
{
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
  let warnSites = 0
  const guarded = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const isWarnCall = /['"]warn['"]\s*,\s*['"][a-z]+\./.test(line) &&
        /(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog|logEvent|backendLogEvent|roomLogEvent)\s*\(|(?:^|[^A-Za-z0-9_$])f\s*\(/.test(line)
      if (!isWarnCall) return
      warnSites += 1
      if (/isEnabled\s*\(/.test(line)) guarded.push(rel + ' 第 ' + (i + 1) + ' 行')
    })
  }
  check(warnSites > 0, '告警级调用存在（实得 ' + warnSites + ' 处）')
  check(guarded.length === 0, '告警直发不判开关（崩溃窗口只剩毫秒级）' + (guarded.length ? ' —— 带判断：' + guarded.join('；') : ''))
}

// 四、调用处不等写盘：全仓无等待记、等待发、等待转发的写法。
{
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
  const hits = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/await\s+(log|fire|rlog|sendLogBatch)\s*\(/.test(line)) hits.push(rel + ' 第 ' + (i + 1) + ' 行：' + line.trim().slice(0, 100))
      if (/await\s+host\.call\s*\(\s*['"]wf\.logBatch['"]/.test(line)) hits.push(rel + ' 第 ' + (i + 1) + ' 行：' + line.trim().slice(0, 100))
      // 模块懒加载（_log 等动态 import 的承诺）只等模块文本不等落盘，不算等待写盘。
      if (/(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog)\s*\([^();]*\)\s*\.then\s*\(/.test(line) && !/(_log|_boot|_plat|_repo|_naming)\(\)\.then|import\s*\(/.test(line)) hits.push(rel + ' 第 ' + (i + 1) + ' 行：' + line.trim().slice(0, 100))
    })
  }
  check(hits.length === 0, '调用处不等写盘完成（无等待记、无等待发、无回调链）' + (hits.length ? ' —— 命中：' + hits.join('；') : ''))
}

console.log(failed ? '\n存在失败 — verify-log-flush 未通过' : '\n全部通过 — 直通刷盘门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
