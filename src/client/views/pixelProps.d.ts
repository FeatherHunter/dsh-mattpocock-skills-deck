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
}
export interface PixelSkillListProps {
  items?: PixelSkillItem[];
  onDetail?: (name: string) => void;
}
export interface PixelContentsProps {
  items?: string[];
  onJump?: (i: number) => void;
}
export interface PixelMarkdownProps {
  md?: string;
  lang?: string;
  st?: any;
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
  mdEn?: string;
  mdZh?: string;
  shortDesc?: string;
  bodyLang?: string;
  phase?: string;
  phaseText?: string;
  isMissing?: boolean;
  dshLang?: string;
  copyText?: string;
  copied?: boolean;
  showSkel?: boolean;
}
export interface PixelStore {
  pixelDetail?: PixelDetailState | null;
  pixelImgOverlay?: { src?: string; alt?: string } | null;
}
export interface PixelSkillDetailModalProps {
  st?: PixelStore;
  onRetry?: ((name: string) => void) | null;
}
