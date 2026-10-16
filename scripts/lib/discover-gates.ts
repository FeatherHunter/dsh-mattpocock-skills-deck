// scripts/lib/discover-gates.ts —— 门禁自动发现：目录约定加显式排除表（#1125）。
//
// 为什么要有它：`package.json` 里那条单行长串同时记着「有哪些门禁」和「按什么顺序跑」，
// 这两件是能从磁盘算出来的派生信息。人手写派生信息，必然抢同一个文件、打出无人能审的 diff
// （#1106 的收尾就卡在这里）。本文件只回答「有哪些门禁」：扫 `tests/` 下符合约定的文件，
// 减去排除表里写明理由的那几项。顺序与执行仍由阶段表决定，不管发现。
//
// 约定：文件名以 `verify-` 开头、后缀是可跑的脚本（.js/.mjs/.cjs/.ts/.mts/.cts），
// 且不是本文件头里排除表点名的那几类。注意 `.html` 与 `.json` 不可跑，从不进链。
//
// 用法（只新增文件阶段，三个执行器尚未接入）：
//   node --import ./scripts/ts-hook.mjs scripts/lib/discover-gates.ts --list
import fs from 'node:fs'
import path from 'node:path'

export const RUNNABLE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']

// 可跑的门禁文件名：verify- 开头。大小写按磁盘原样，不做归一化。
export function isGateFileName(name: string): boolean {
  if (!name.startsWith('verify-')) return false
  const ext = name.slice(name.lastIndexOf('.'))
  return RUNNABLE_EXTS.includes(ext)
}

// 扫出磁盘上全部符合约定的门禁（仓库相对路径，斜杠统一，正序排好）。
// 只读目录，不读文件内容，所以另一会话正在改门禁内容时，扫出来的名单不受影响。
export function discoverGateFiles(root: string): string[] {
  const dir = path.join(root, 'tests')
  const names = fs.readdirSync(dir)
  return names
    .filter((n) => isGateFileName(n))
    .map((n) => 'tests/' + n)
    .sort()
}
