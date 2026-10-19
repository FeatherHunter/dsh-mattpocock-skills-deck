/**
 * src/client/kernel/locale-spec.ts —— 规格（实施地图）一族的中英词条真源（#1286）。
 *
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的拼接标记处，与 locale-cards.ts 同模式（源码树里只有这一份真源）。
 * 由 locale.ts 的合并器一起并进 L，界面只认 tr(...)。
 *
 * 为什么单独一份：locale-flow.ts 已贴 350 行上限（见 tests/file-granularity-baseline.json 的
 * 零增长口径），照 #621/#690/#842/#879 的做法自成一个片段，别再往 flow 里塞。
 *
 * 键口径：
 * - list.specChip 是列表行与详情页角标上的那两个字（探索那边是 list.mapChip「地图」）。
 * - list.specTitle 是列表行悬停提示（探索那边是 list.mapTitle）。
 * - map.specSubCount 是规格详情页的计数句（本规格 N 张实施票（已关闭 M 张））。
 * - act.split 是规格空态那颗主按钮（拆票；探索空态是 act.inspect「检查」）。
 * - spec.*Title 是三态按钮悬停时的那句解释。
 * - type.spec 是类型角标上那个词（探索那边是 type.map）。
 */
export const L_SPEC: { zh: Record<string, string>; en: Record<string, string> } = {
  zh: {
    'list.specChip': '规格',
    'list.specTitle': '查看规格详情',
    'map.specSubCount': '本规格 {n} 张实施票（已关闭 {c} 张）',
    'act.split': '拆票',
    'spec.splitTitle': '该规格还没有实施票，拆成实施票并注入拆票提示词',
    'spec.executeTitle': '推进该规格，注入执行提示词',
    'spec.doneTitle': '实施票全部关闭，注入收尾确认提示词',
    'type.spec': '规格',
  },
  en: {
    'list.specChip': 'Spec',
    'list.specTitle': 'View spec details',
    'map.specSubCount': 'This spec has {n} implementation tickets ({c} closed)',
    'act.split': 'Split',
    'spec.splitTitle': 'This spec has no implementation tickets yet; split it and inject the split prompt',
    'spec.executeTitle': 'Advance this spec; inject the execute prompt',
    'spec.doneTitle': 'All implementation tickets are closed; inject the wrap-up prompt',
    'type.spec': 'Spec',
  },
};
