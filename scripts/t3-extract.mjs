/**
 * scripts/t3-extract.mjs — T3（#96）内核迁移一次性工具（用完保留，幂等）
 *
 * 用法: node scripts/t3-extract.mjs <name> <startLine> <endLine> [--style]
 *   从 src/client/index.js 切出 [startLine, endLine]（1-based 闭区间）代码块，
 *   顶层声明（0-4 空格缩进的 const/let/var/function 行首）加 `export ` 前缀，
 *   写入 src/client/kernel/<name>.js；index.js 该区间替换为拼接标记
 *   `// ==== kernel:<name> (spliced by build) ====`。
 *   --style 特殊模式：styles 块（`styles.insert([...].join(''))` → `export const STYLE_TEXT = [...]`）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [name, sRaw, eRaw] = process.argv.slice(2)
const styleMode = process.argv.includes('--style')
if (!name || !sRaw || !eRaw) { console.error('用法: node scripts/t3-extract.mjs <name> <startLine> <endLine> [--style]'); process.exit(1) }

const INDEX = resolve(ROOT, 'src/client/index.js')
const lines = readFileSync(INDEX, 'utf8').split('\n')
const start = Number(sRaw) - 1
const end = Number(eRaw) - 1
if (start < 0 || end >= lines.length || start > end) { console.error(`行范围非法: ${sRaw}-${eRaw}（文件 ${lines.length} 行）`); process.exit(1) }

const block = lines.slice(start, end + 1)
const out = block.map((l, i) => {
  if (styleMode) {
    const t = l.trimStart()
    if (t.startsWith('styles.insert([')) return l.replace('styles.insert([', 'export const STYLE_TEXT = [')
    if (t === "].join(''))") return l.replace("].join(''))", "].join('')")
    return l
  }
  // 顶层声明（apply 闭包层 4 空格；历史遗留 0 空格如 pendingDraft）
  return l.replace(/^( {0,4})(const|let|var|function)\s/, '$1export $2 ')
}).join('\n')

const header = `/**
 * src/client/kernel/${name}.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
`
const modPath = resolve(ROOT, `src/client/kernel/${name}.js`)
if (existsSync(modPath)) { console.error(`已存在: ${modPath}（拒绝覆盖）`); process.exit(1) }
mkdirSync(dirname(modPath), { recursive: true })
writeFileSync(modPath, header + out + '\n')

lines.splice(start, end - start + 1, `    // ==== kernel:${name} (spliced by build) ====`)
writeFileSync(INDEX, lines.join('\n'))

console.log(`[t3] ${name}: 切出 ${block.length} 行 → src/client/kernel/${name}.js；index.js 已留标记`)
