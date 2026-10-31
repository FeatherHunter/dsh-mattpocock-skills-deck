// scripts/lib/bundled-skills-manifest.mts —— 随包技能哈希清单的共用口径（#1734）
//
// 为什么单开一份：同步脚本要「按上游源树算清单」，门禁要「按同样口径复核清单」，
// 两边必须算得一模一样。以前这段口径各写各的（同步脚本一份、verify-bundled-skills-upstream 一份、
// verify-1490 一份），改一处漏两处时检查会假绿；现在算法名与哈希实现只在这里定义一次，
// 其它位置一律导入（docs/adr/20261021-config-ownership.md §2.1 与 §2.5「导入第一」）。
//
// 口径本身：先把 CRLF 折成 LF（抹掉 Windows 检出的换行差异，语义差一个字哈希就不同），
// 再对 UTF-8 文本算 SHA256，取小写十六进制。算法名 MANIFEST_ALGO 会写进清单的 algo 字段供人读，
// 判定仍以哈希值为准。

import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 写进清单 algo 字段的算法名，也是门禁断言「清单算法与代码一致」时比对的唯一来源。 */
export const MANIFEST_ALGO: string = 'sha256-of-LF-normalized-utf8'

/** 换行归一化：只抹掉 CRLF 与 LF 的差异，其它字符一个都不动。 */
export function normText(text: string): string { return text.replace(/\r\n/g, '\n') }

/** 按清单口径算一个文件的哈希：先换行归一化，再对 UTF-8 文本算 SHA256。 */
export function sha256Text(text: string): string {
  return createHash('sha256').update(normText(text), 'utf8').digest('hex')
}

/**
 * 递归列出目录下所有文件的相对路径（用 / 分隔，不含目录本身）。
 *
 * 顺序交给调用方排序：清单的排序规则由生成方决定，不要在这里悄悄排一遍，
 * 否则两个调用方对同一份目录可能拿到不同顺序。符号链接按文件处理（readdir 给的就是链接项）。
 */
export function listFilesRel(dirAbs: string, relPrefix: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const rel: string = relPrefix ? relPrefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...listFilesRel(join(dirAbs, entry.name), rel))
    else out.push(rel)
  }
  return out
}
