// 临时探针（不入库）：验证钩子会不会把 readFileSync 里的 .js 路径改指同名 .ts。
// 结论决定修法：钩子若已兜住，就不该再改门禁；没兜住才需要把门禁里的旧后缀改过来。
import fs from 'node:fs'
import path from 'node:path'

const p = path.join(process.cwd(), 'src/tracker/rooms/gitlab/index.js')
console.log('readFileSync 目标:', p)
try {
  const s = fs.readFileSync(p, 'utf8')
  console.log('读到内容长度:', s.length, '→ 钩子把这处 .js 指到了别处（或磁盘上真有一份 .js）')
} catch (e) {
  console.log('读不到:', e.code, e.message)
}
console.log('磁盘上真有 index.js 吗:', fs.existsSync(p))
console.log('磁盘上真有 index.ts 吗:', fs.existsSync(path.join(process.cwd(), 'src/tracker/rooms/gitlab/index.ts')))
