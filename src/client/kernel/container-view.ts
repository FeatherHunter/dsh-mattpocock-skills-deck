/**
 * src/client/kernel/container-view.ts —— 面板里「容器」这一概念的客户端单一真源（#1286）。
 *
 * 容器 = 能装子票的票。现在有两种：
 * - 探索地图：type 是 map，或带 wayfinder:map 标签（老数据都走这条）。
 * - 规格（实施地图）：type 是 spec；宿主按正文首行独占一行的隐藏标记
 *   <!-- DSH-ISSUE-KIND: spec --> 认出来（识别口径归 #1274/#1275，本票只消费结果）。
 *
 * 认种类的顺序在宿主那边定，客户端只读它给的那一格 type。顺序按 GLOSSARY.md
 * 「对象类型（objectKind）」词条：正文首行的隐藏标记 → 表达对象类型的标签 → 正文形状。
 * 也就是说标记优先于标签：一张既带隐藏标记又带 wayfinder:map 标签的票按规格算。
 * 客户端这一层不再自己判一遍「是不是容器」，一律调 containerKindOf。
 *
 * 两种容器在面板里共用同一套行渲染与详情页骨架，差的是身份颜色、角标、
 * 三态按钮（文字、底色、注入的提示词）与计数文案。
 *
 * 为什么单独一份：容器这个词横跨列表页、详情页与提示词注入。
 * 各处各判一次就会出「列表说它是地图、详情说它是普通票」这种自相矛盾，
 * 所以判定、取色与提示词只在这里做一次，别处不再各写一份。
 *
 * 数据来源：快照里的 maps 数组。这个数组名是历史名——它现在装的是「容器」，
 * 探索地图与规格都住在里面，靠各自的 type 字段分辨种类。
 * 口径（2026-10-20 定）：不另开 specs 数组。拆开要动二十来处读点，
 * 收益只有数组名好看，代价是「列表页多一行」「实施票散成孤儿票」这类真 bug。
 */
declare function inspectPrompt(...args: any[]): string;
declare function completePrompt(...args: any[]): string;
declare function startText(...args: any[]): string;

// 身份色：探索紫、实施贵族蓝（2026-10-20 当面拍板）
export const CONTAINER_ACCENT: any = { map: '#c084fc', spec: '#1D4ED8' };
// 行底色：身份色同色系的一层薄底（探索沿用现状，实施是新加的）
export const CONTAINER_TINT: any = { map: 'rgba(188,140,255,.07)', spec: 'rgba(29,78,216,.10)' };
// 角标 chip 的样式类与词表键（角标图标两种容器都用地图图标，区别在那两个字）
export const CONTAINER_CHIP_CLASS: any = { map: 'dsws-chip-m', spec: 'dsws-chip-s' };
export const CONTAINER_CHIP_LABEL_KEY: any = { map: 'list.mapChip', spec: 'list.specChip' };
// 两种容器角标共用的 DOM 标记类：列表页靠它一眼认出「这一行的编号列里是容器角标」
// （src/client/views/ListTab.ts 的宽行横排与护栏查的就是这个类，别改回去查 .dsws-chip-m）
export const CONTAINER_CHIP_MARKER_CLASS = 'dsws-chip-container';
// 三态里的两枚固定色：空态橙、完成态绿；执行态按容器类型取（见 containerTriState）
export const CONTAINER_EMPTY_COLOR = '#f59e0b';
export const CONTAINER_DONE_COLOR = '#3fb950';

/** 这张票是不是容器、是哪种容器？普通票返回 null。 */
export const containerKindOf = function (x: any): string | null {
  if (!x) return null;
  if (x.type === 'spec') return 'spec';
  const labels: any[] = Array.isArray(x.labels) ? x.labels : [];
  const isMapTag: boolean = labels.some(function (l: any): boolean {
    return (typeof l === 'string') ? l === 'wayfinder:map' : !!(l && l.name === 'wayfinder:map');
  });
  if (x.type === 'map' || isMapTag) return 'map';
  return null;
};

/** 容器三态：没有子票 empty，还有未关子票 open，子票全关 done。
  * 判据用容器自带的 stats（与地图同形状：{ total, closed }），宿主负责算好。
  * 注意：只有 GitHub 那条通路会在宿主侧补 stats（src/host/sessionSnapshot.ts），
  * 别的后端里 stats 可能整个不存在——那时一律按 empty 走，跟地图今天的处境一样。 */
export const containerStateOf = function (container: any): string {
  const stats: any = container && container.stats;
  if (!stats || !stats.total) return 'empty';
  return stats.closed === stats.total ? 'done' : 'open';
};

/** 三态按钮的取色与话术：探索是 检查/执行/完成，规格是 拆票/执行/完成。
  * labelKey 与 titleKey 是词表键（由界面自己 tr() 出来），color 是按钮底色，icon 是图标名。
  * 点下去注入什么不在这里，见下面的 containerPromptText。 */
export const containerTriState = function (kind: string, state: string): any {
  if (kind === 'spec') {
    if (state === 'empty') return { labelKey: 'act.split', color: CONTAINER_EMPTY_COLOR, icon: 'branch', titleKey: 'spec.splitTitle' };
    if (state === 'done') return { labelKey: 'act.done', color: CONTAINER_DONE_COLOR, icon: 'check', titleKey: 'spec.doneTitle' };
    return { labelKey: 'act.execute', color: CONTAINER_ACCENT.spec, icon: 'play', titleKey: 'spec.executeTitle' };
  }
  if (state === 'empty') return { labelKey: 'act.inspect', color: CONTAINER_EMPTY_COLOR, icon: 'search', titleKey: 'map.inspectTitle' };
  if (state === 'done') return { labelKey: 'act.done', color: CONTAINER_DONE_COLOR, icon: 'check', titleKey: 'map.doneTitle' };
  return { labelKey: 'act.execute', color: CONTAINER_ACCENT.map, icon: 'play', titleKey: 'map.executeTitle' };
};

/** 编号徽章取色：完成态绿、空态橙，未完成时按容器身份取色。
  * fallback 是调用方按老口径算出的颜色（探索地图今天走 actionColorOf），
  * 传进来是为了让探索地图的观感一字不变。
  * 注意：身份色 #1D4ED8 当 11px 小字对比度只有约 2.6:1（设计文档 §3.3 记过这笔账）；
  * 徽章照 2026-10-20 的拍板继续用身份色，浅蓝 #93c5fd 只给角标小字。 */
export const containerNumberColor = function (kind: string, state: string, fallback: string): string {
  if (state === 'done') return CONTAINER_DONE_COLOR;
  if (state === 'empty') return CONTAINER_EMPTY_COLOR;
  return kind === 'spec' ? CONTAINER_ACCENT.spec : fallback;
};

/** 详情页计数文案的词表键：本图 N 张子票 / 本规格 N 张实施票。 */
export const containerCountKey = function (kind: string): string {
  return kind === 'spec' ? 'map.specSubCount' : 'map.subCount';
};

/** 列表行悬停提示的词表键：探索是 list.mapTitle，规格是 list.specTitle。 */
export const containerTitleKey = function (kind: string): string {
  return kind === 'spec' ? 'list.specTitle' : 'list.mapTitle';
};

/** 这一态该注入什么提示词。列表页与详情页共用这一份，
  * 这样「按钮上写什么」与「点下去注入什么」永远对得上。
  * url 由调用方给（issueUrlFor 在各视图里已经算过一次链接）。 */
export const containerPromptText = function (st: any, c: any, kind: string, state: string, url: string): string {
  const num: any = c && c.number;
  const title: string = String((c && c.title) || '');
  const stats: any = (c && c.stats) || {};
  try {
    if (state === 'done') return completePrompt(st, num, title, stats.total || 0, stats.closed || 0);
    if (kind === 'spec') {
      // 规格空态：还没有实施票，按钮是「拆票」，注入的是 to-tickets 技能调用。
      // 这条技能调用的正式文案归 #1281（提示词那条线），这里是临时形态。
      if (state === 'empty') return '/to-tickets ' + url;
      // 规格未完成：注入 implement-spec 技能调用（不是通用「执行这张票」模板）。
      // 为什么不用那个模板：它正文首行就是 "/wayfinder"（wayfinder 是探索地图的路子——
      // 规划一张决策地图，不是实施一张规格），用在规格上不对；而本仓本来就带着
      // implement-spec 技能（package/bundled-skills/implement-spec），它开的场就是
      // 「你拿到了一张规格，它下面挂着实施票」，与规格容器正好对上。
      // 正式文案归 #1281（提示词那条线），这里先给最小可用的技能调用形式。
      return '/implement-spec ' + url;
    }
    if (state === 'empty') return inspectPrompt(st, num, title);
    return startText(st, c);
  } catch (e) {
    // 提示词取不到时退回推进式提示词，跟今天地图侧的行为一致（不静默吞掉）。
    try { return startText(st, c); } catch (e2) { return ''; }
  }
};
