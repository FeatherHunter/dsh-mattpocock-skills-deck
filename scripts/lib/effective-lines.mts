// effective-lines.mts —— 门禁共用的「有效行数」口径（#1017 立）
//
// 为什么单独放一份：文件行数这条尺子有两处门禁在读（tests/verify-file-granularity.ts 判全树、
// tests/verify-leaves.js 判叶子清单），按 AGENTS.md 的规矩，同一个判定不许在两处各写一遍——
// 一处改了另一处没改，症状是「本机全绿、另一条门禁红」。所以口径本体住这里，两个门禁都 require 它。
//
// 口径是什么：一份源码里，**既不是空行、也不是注释**的行数。做法是先把注释抹成空格（块注释跨行时
// 保留换行，这样行号不漂），再数剩下非空的行。字符串与模板串里的内容算内容——多行模板里包着的
// CSS 文本也是人要读的东西，不该被当成注释抹掉。
//
// 为什么不是「总行数」：#1017 之前那条门禁数的是总行数，同一份文件靠多写注释就能顶破上限，
// 补注释反而成了负担；换成有效行之后，注释与空行随便写，只有真内容增长才算增长。
//
// 反例（这几条是刻意这么定的）：
//   · 行尾注释 `const a = 1 // 说明` 算 1 行（说明部分被抹掉，但代码还在）。
//   · 整行块注释 `/* … */`、`/** … */`、`// …` 算 0 行（哪怕注释里写着代码示例）。
//   · 字符串里的 `//` 不是注释：`const u = 'https://x'` 算 1 行（扫描器见到引号就整段跳过）。
//   · 多行模板串算它实际占的每个非空行（内容在模板里也是内容）。
//
// 已知取舍：正则字面量里出现 `//`（例如 `split(/\//)`）会被当成行注释，把该行后半抹掉。
// 后果最多是把一行算成空行——**宁可少算，不肯多算**（少算只会让门禁偏松一点点，多算会误伤）。
// 今天 src/ 下没有这种写法；真出现了也不影响判定方向，所以不为此加一层正则识别。

/**
 * 把注释抹成空格，字符串与模板串原样保留，换行一个不丢。
 * 返回与输入等长的文本（除了被抹掉的部分变成空格），这样按行统计不会错位。
 */
export function blankComments(code: string): string {
  const out = code.split('')
  const n = code.length
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < n) {
    const ch = code[i]
    if (ch === '/' && code[i + 1] === '/') {
      let j = i
      while (j < n && code[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++
      blank(i, Math.min(n, j + 2))
      i = Math.min(n, j + 2)
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === quote) {
          j++
          break
        }
        // 单引号与双引号串不许跨行：遇到换行就当这个串结束了，后面的 `//` 仍然是注释。
        if (quote !== '`' && code[j] === '\n') break
        j++
      }
      i = j
      continue
    }
    i++
  }
  return out.join('')
}

/** 有效行数：抹掉注释之后还剩下内容的行数（空行与纯注释行都不算）。 */
export function countEffectiveLines(code: string): number {
  let n = 0
  for (const line of blankComments(code).split(/\r?\n/)) if (line.trim()) n++
  return n
}

/**
 * 基线文件里记口径用的标识。门禁读到别的值就判红，理由是「同一批数字换了口径还接着用」比没有基线更坏：
 * 总行数时代的 359 放到有效行口径里会被当成「已达标」而被清理掉，冻结就悄悄失效了。
 */
export const EFFECTIVE_LINES_METRIC = 'effective-lines'
