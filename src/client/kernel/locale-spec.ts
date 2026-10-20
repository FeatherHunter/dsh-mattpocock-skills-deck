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
 * - spec.section.* 是规格正文七段的段标题（问题陈述 / 解决方案 / 用户故事 / 实现决策 /
 *   测试决策 / 不在范围内 / 补充说明），七段的形状见 to-spec 技能的规格模板。
 */
export const L_SPEC: { zh: Record<string, string>; en: Record<string, string> } = {
  zh: {
    'list.specChip': '规格',
    'list.specTitle': '查看规格详情',
    'map.specSubCount': '本规格 {n} 张实施票（已关闭 {c} 张）',
    'act.split': '拆票',
    'act.implement': '实施',
    'tip.implement': '按这张票的验收判据实施（注入 /implement 提示词）',
    'spec.splitTitle': '该规格还没有实施票：按 to-tickets 规则把它拆成实施票',
    'spec.executeTitle': '这张规格已有实施票：按 implement-spec 规则逐票推进',
    'spec.doneTitle': '实施票已全部关闭：逐张核对验收判据，通过后关闭规格（人可重开）',
    'type.spec': '规格',
    'panel.newSpec': '写规格',
    'panel.newSpecTitle': '适合已经想清的需求：没有待决定的取舍，边界与验收都能说清',
    'nav.takeableSpec': '写规格',
    'nav.takeableSpecTitle': '适合已经想清的需求：没有待决定的取舍，边界与验收都能说清',
    'spec.section.problem': '问题陈述',
    'spec.section.solution': '解决方案',
    'spec.section.userStories': '用户故事',
    'spec.section.implDecisions': '实现决策',
    'spec.section.testDecisions': '测试决策',
    'spec.section.outOfScope': '不在范围内',
    'spec.section.notes': '补充说明',
  },
  en: {
    'list.specChip': 'Spec',
    'list.specTitle': 'View spec details',
    'map.specSubCount': 'This spec has {n} implementation tickets ({c} closed)',
    'act.split': 'Split',
    'act.implement': 'Implement',
    'tip.implement': 'Implement against this ticket’s acceptance criteria (inject the /implement prompt)',
    'spec.splitTitle': 'No implementation tickets yet: split this spec with the to-tickets rules',
    'spec.executeTitle': 'This spec has implementation tickets: advance them with the implement-spec rules',
    'spec.doneTitle': 'All implementation tickets are closed: verify the acceptance criteria, then close the spec (the human can reopen it)',
    'type.spec': 'Spec',
    'panel.newSpec': 'Write Spec',
    'panel.newSpecTitle': 'For requirements that are already clear: no open trade-offs, scope and acceptance can be stated',
    'nav.takeableSpec': 'Write Spec',
    'nav.takeableSpecTitle': 'For requirements that are already clear: no open trade-offs, scope and acceptance can be stated',
    'spec.section.problem': 'Problem Statement',
    'spec.section.solution': 'Solution',
    'spec.section.userStories': 'User Stories',
    'spec.section.implDecisions': 'Implementation Decisions',
    'spec.section.testDecisions': 'Testing Decisions',
    'spec.section.outOfScope': 'Out of Scope',
    'spec.section.notes': 'Further Notes',
  },
};
