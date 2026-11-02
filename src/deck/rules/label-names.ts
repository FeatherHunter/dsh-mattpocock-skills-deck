// src/deck/rules/label-names.ts —— 标签清单收口（纯规则侧）
//
// 写票的几条路径（建票补标签、改标签时判旧状态、位置表里找类型标签、幂等锚算哈希）都要把
// 「字符串、{name} 对象、两种混着来」的标签清单收成干净的名字数组。这种收口以前在 anchor.ts、
// minimal-spec.ts、object-kind.ts 各写一份，同一件事抄三遍，改一处容易漏另外两处（#1832 审查指出）。
// 现在只有这一份，其余文件都引它。
//
// 收法：字符串原样、对象取 name、去首尾空白、空串丢掉。顺序不动 —— 幂等锚按调用方给的顺序拼标签，
// 重排会让「本来同一个锚」变成两个锚、去重失效。大小写也不改：GitHub 的标签名不分大小写，
// 但拼写要保留调用方/后端给的原样，判断是不是同一枚由调用方按小写比。
export function labelNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map((one) => (typeof one === 'string' ? one : (one && (one as { name?: unknown }).name) || ''))
    .map((name) => String(name).trim())
    .filter(Boolean)
}
