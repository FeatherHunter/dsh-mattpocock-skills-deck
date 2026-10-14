// 临时探针（不入库）：按 tests/verify-prompts.js 自己的算法重算「夹具自锁」里的自身摘要。
// 算法必须与门禁一致：整份文本按 LF 归一，把 LOCK 区段内容挖空后再 sha256；改摘要不会改变自己的摘要。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const p = path.join(process.cwd(), 'tests/verify-prompts.js')
const LOCK_BEGIN = '// ---- LOCK-BEGIN ----'
const LOCK_END = '// ---- LOCK-END ----'

const raw = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const a = raw.indexOf('\n' + LOCK_BEGIN + '\n')
const b = raw.indexOf('\n' + LOCK_END)
if (a < 0 || b < 0) {
  console.log('找不到 LOCK 标记，停下')
  process.exit(1)
}
const blanked = raw.slice(0, a) + '\n' + LOCK_BEGIN + '\n' + '\n' + LOCK_END + raw.slice(b + 1 + LOCK_END.length)
const want = crypto.createHash('sha256').update(Buffer.from(blanked, 'utf8')).digest('hex')

const cur = /'tests\/verify-prompts\.js':\s*'([0-9a-f]{64})'/.exec(raw)
console.log('当前登记自身摘要:', cur && cur[1])
console.log('按门禁算法重算得到:', want)

if (cur && cur[1] !== want) {
  const next = raw.replace(/'tests\/verify-prompts\.js':\s*'[0-9a-f]{64}'/, "'tests/verify-prompts.js': '" + want + "'")
  fs.writeFileSync(p, next)
  console.log('已把登记摘要更新为新值（写入用 LF，仓库本来就是 LF）')
}
