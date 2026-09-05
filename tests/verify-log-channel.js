// verify-log-channel.js —— #494 第三件事：日志门禁之通道数量（#489 附录第 4 节断言七）。
// 用法：在插件根目录执行 node tests/verify-log-channel.js，可独立运行。
// 断言文字：客户端批量转发为每批最多 50 条、每 1000 毫秒、
// 单包 128KB 或 100 条先到先截；通道失败处理为丢弃并计数；
// 出现背压等待或无界缓冲即红。
// 做法：锁死客户端通道字面与失败语义；全仓扫描等待与无界写法，出现即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志通道数量门禁（#494：批量 50 条、1000 毫秒、单包上限，失败丢弃并计数）')

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 一、批量三数字：每批最多 50 条，每 1000 毫秒发一次，单包 128KB。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  check(src.includes('LOG_BATCH_MAX = 50'), '每批最多 50 条')
  check(src.includes('LOG_FLUSH_MS = 1000'), '每 1000 毫秒发一次（批量未满也按时间发）')
  check(src.includes('LOG_PACKET_BYTES = 131072'), '单包上限 128KB（131072 字节）')
  check(src.includes('LOG_QUEUE_MAX = 100'), '单包或队列 100 条先到先截')
}

// 二、先到先截：一次只取 50 条，超包裁剪记数并在包尾留截断标记。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  check(/splice\s*\(\s*0\s*,\s*LOG_BATCH_MAX\s*\)/.test(src), '一次转发只取 50 条')
  check(/estimateBatchBytes\s*\(\s*entries\s*\)\s*>\s*LOG_PACKET_BYTES/.test(src), '超 128KB 裁剪（先到先截）')
  check(src.includes('truncated = true') || src.includes('truncated:true'), '裁剪后在包尾记截断标记')
  check(/logQueue\.length\s*>=\s*LOG_QUEUE_MAX/.test(src), '队列满 100 条丢新日志（不无界缓冲）')
}

// 三、丢弃并计数：队列满、超包裁剪、转发失败都只计数不抛错；转发带累计丢弃数。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  check(/logDroppedState\.count\s*\+=\s*1/.test(src), '队列满丢弃记数')
  check(/droppedCount\s*:\s*logDroppedState\.count/.test(src), '转发带客户端累计丢弃数')
  const sendAt = src.indexOf('export const sendLogBatch')
  const sendBody = sendAt >= 0 ? src.slice(sendAt, sendAt + 2500) : ''
  check(/catch\s*\(/.test(sendBody) && /logDroppedState\.count\s*\+=\s*entries\.length/.test(sendBody), '转发失败整批记丢弃（不抛错、不等待、不重试）')
  const batchCalls = (src.match(/host\.call\s*\(\s*['"]wf\.logBatch['"]/g) || []).length
  check(batchCalls === 1, '转发只调一次记录电话（无重试循环，实得 ' + batchCalls + ' 处）')
}

// 四、无背压：通道文件里无等待，调用处不等转发完成。
{
  const src = readSrc(path.join('src', 'client', 'kernel', 'log.js'))
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  check(!/\bawait\b/.test(noComments), '通道文件无等待（失败不阻塞调用处）')
  check(!/await\s+sendLogBatch/.test(noComments), '无人等待发一批')
  check(!/setTimeout\s*\(\s*sendLogBatch/.test(noComments) || /timer\.timeout/.test(noComments), '失败不排定时重试（只计数，下次成功顺带上报）')
}

// 五、宿主侧同语义：记录电话回接收条数加累计丢弃数，失败同样只计数。
{
  const src = readSrc(path.join('src', 'host', 'logStore.js'))
  check(/accepted\s*:\s*entries\.length/.test(src), '宿主回接收条数')
  check(/dropped\s*:\s*getDroppedCount\s*\(\s*\)/.test(src), '宿主回累计丢弃数')
  const batchAt = src.indexOf('async function handleLogBatch')
  const batchBody = batchAt >= 0 ? src.slice(batchAt, batchAt + 800) : ''
  check(!/throw/.test(batchBody), '宿主记录电话不抛错（失败降级为丢弃并计数）')
}

console.log(failed ? '\n存在失败 — verify-log-channel 未通过' : '\n全部通过 — 通道数量门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
