/**
 * views/pixelProps.d.ts — 像素风组件的 props 契约（887 TS 化）。
 * 只放类型，不参与转译（构建的 pixel-ts 步骤跳过 .d.ts）；各 .ts 真源用 import type 引用。
 * 跨叶子值引用一律不在这里声明——每个消费文件自己写 declare const（模块作用域，不冲突），
 * 类型全部指向这里的接口，改接口即改两边的约定。
 */
export interface PixelBtnProps {
  children?: any;
  onClick?: () => void;
  hot?: boolean;
  mini?: boolean;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
}
export interface PixelDotProps {
  level?: 'ok' | 'warn' | 'bad';
  color?: string;
}
export interface PixelNumProps {
  n?: number;
}
export interface PixelStateIconProps {
  kind?: 'ok' | 'err' | 'warn' | 'idle' | 'loading';
}
export interface PixelSkeletonProps {
  lines?: number;
}
export interface PixelBannerProps {
  kind?: 'error' | 'warn';
  text?: string;
  onRetry?: (() => void) | null;
  onClose?: (() => void) | null;
}
export interface PixelStatusLineProps {
  icon?: string;
  text?: string;
  /** 节奏话（2026-10-10 人拍板）：给了就按顺序 1 秒一句轮播，不给就只画 text。 */
  texts?: string[] | null;
}
export interface PixelSkillItem {
  name: string;
  level?: string;
  use?: string;
  recommended?: boolean;
}
export interface PixelSkillRowProps {
  name: string;
  level?: string;
  use?: string;
  recommended?: boolean;
  onDetail?: (name: string) => void;
  onLoad?: (name: string) => void;
  loading?: boolean;
}
export interface PixelSkillListProps {
  items?: PixelSkillItem[];
  onDetail?: (name: string) => void;
  onLoad?: (name: string) => void;
  loadingName?: string | null;
}
export interface PixelContentsProps {
  items?: string[];
  onJump?: (i: number) => void;
}
export interface PixelMarkdownProps {
  md?: string;
  lang?: string;
  st?: any;
  /** 点开另一篇技能（2026-10-10 人拍板）：给了它，正文里的 /技能名 才做成可点的入口。 */
  onSkill?: ((name: string) => void) | null;
  /** 哪些名字算技能：只有随包真有的那些做成入口，别的一律原样当代码。 */
  skillNames?: string[] | null;
}
export interface PixelHeading {
  level: number;
  text: string;
}
export interface PixelListFlatItem {
  indent: number;
  ordered: boolean;
  task: string | null;
  text: string;
}
export interface PixelListNode {
  task: string | null;
  text: string;
  kids: PixelListSeq | null;
}
export interface PixelListBlock {
  ordered: boolean;
  items: PixelListNode[];
}
export type PixelListSeq = PixelListBlock[];
export interface PixelDetailState {
  open?: boolean;
  name?: string;
  titleEn?: string;
  titleZh?: string;
  mdEn?: string | null;
  mdZh?: string | null;
  shortDesc?: string;
  bodyLang?: string;
  phase?: string;
  phaseText?: string;
  isMissing?: boolean;
  dshLang?: string;
  copyText?: string | null;
  docPath?: string | null;
  /** 中文译文包（SKILL.zh.md）的绝对路径；没有译文时为空。 */
  pathZh?: string | null;
  copied?: boolean;
  showSkel?: boolean;
}
export interface PixelStore {
  pixelDetail?: PixelDetailState | null;
  /**
   * 详情栈（2026-10-10 人拍板）：从详情里点开另一篇就压一层，关一层就回到上一层。
   * 最多三层，最后一个是当前看的那一层；st.pixelDetail 恒等于栈顶（老读法不用改）。
   */
  pixelDetailStack?: PixelDetailState[] | null;
  pixelImgOverlay?: { src?: string; alt?: string } | null;
}
export interface PixelSkillDetailModalProps {
  st?: PixelStore;
  onRetry?: ((name: string) => void) | null;
  /** true＝占满页签中间区域（列表已让位），不铺遮罩；缺省是盖在页面上的居中弹窗 */
  full?: boolean;
  /** 正文里点开另一篇技能：由外层接上取数与压栈（没有它，正文里的技能名只是普通代码）。 */
  onOpenSkill?: ((name: string) => void) | null;
  /** 随包真有的技能名清单，交给正文渲染器判断哪些名字可以点。 */
  skillNames?: string[] | null;
}
