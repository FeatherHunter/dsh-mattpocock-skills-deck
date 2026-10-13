/**
 * src/tracker/label-names.ts —— 单源标签清单的派生查询：名单、集合与子集计算。
 *
 * ── 为什么这份文件住在这里 ──────────────────────────────────────────────────
 * 标签清单本身（`CANONICAL_LABELS` 那 10 个名字）是契约自己的数据，住在
 * `src/tracker/contract/canonical-labels.ts`。而“由清单现算名单、判子集”这几样是
 * **行为**（`.map` 现算、顶层 `new Set`、两个函数），按地图02开发票（#1026）的裁决
 * 搬到这里：不在契约目录、两个后端都能引用；行为一个字不改。
 *
 * ── 读法 ────────────────────────────────────────────────────────────────────
 * 只比名字，不卡颜色与描述（#188 定版：校验与文档的单源只管名集合）。
 * 大小写不敏感：`missingCanonicalLabels` 按“转小写再比”算缺席（GitHub 侧的大小写抖动不算缺）。
 */

import { CANONICAL_LABELS } from './contract/canonical-labels.js'

/** 10 个单源标签的名字（与清单同序；GitHub 房拼装提示词名单时读这一份，不手抄第二份）。 */
export const CANONICAL_LABEL_NAMES: string[] = CANONICAL_LABELS.map((l) => l.name)

/** 同上，集合形态（判“是不是单源标签”走这一份，O(1)；构造时只遍历一次，不重复算）。 */
export const CANONICAL_LABEL_SET: ReadonlySet<string> = new Set(CANONICAL_LABEL_NAMES)

/**
 * 是不是单源标签（首尾空白忽略；空值按“不是”处理，不抛异常）。
 */
export function isCanonicalLabel(name: unknown): boolean {
  // 与搬家前逐字一致：`||`（0、false、空串都按空处理，不是 `??`）。
  return CANONICAL_LABEL_SET.has(String(name || '').trim())
}

/**
 * 给一份“已有名字”，回单源里缺了哪些（与清单同序；大小写不敏感）。
 *
 * 入参不是数组也认（按空处理，回全部 10 个）；元素转成串、去首尾空白、转小写再比。
 */
export function missingCanonicalLabels(existingNames: unknown): string[] {
  const list: unknown[] = Array.isArray(existingNames) ? existingNames : []
  // 与搬家前逐字一致：元素按 `String(n || '')` 归一（0、false 按空处理，不是 `??`）。
  const have = new Set(
    list.map((n) => String(n || '').trim().toLowerCase()),
  )
  return CANONICAL_LABEL_NAMES.filter((n) => !have.has(n.toLowerCase()))
}
