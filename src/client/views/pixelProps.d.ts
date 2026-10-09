/**
 * views/px-props.d.ts — 像素风组件的 props 契约（887 TS 化）。
 * 只放类型，不参与转译（构建的 px-ts 步骤跳过 .d.ts）；各 .ts 真源用 import type 引用。
 * 跨叶子值引用一律不在这里声明——每个消费文件自己写 declare const（模块作用域，不冲突），
 * 类型全部指向这里的接口，改接口即改两边的约定。
 */
export interface PxBtnProps {
  children?: any;
  onClick?: () => void;
  hot?: boolean;
  mini?: boolean;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
}
export interface PxDotProps {
  level?: 'ok' | 'warn' | 'bad';
  color?: string;
}
export interface PxNumProps {
  n?: number;
}
export interface PxStateIconProps {
  kind?: 'ok' | 'err' | 'warn' | 'idle' | 'loading';
}
export interface PxSkelProps {
  lines?: number;
}
export interface PxBannerProps {
  kind?: 'error' | 'warn';
  text?: string;
  onRetry?: (() => void) | null;
  onClose?: (() => void) | null;
}
export interface PxStatusLineProps {
  icon?: string;
  text?: string;
}
export interface SkillItem {
  name: string;
  level?: string;
  use?: string;
  recommended?: boolean;
}
export interface SkillRowProps {
  name: string;
  level?: string;
  use?: string;
  recommended?: boolean;
  onDetail?: (name: string) => void;
}
export interface SkillListProps {
  items?: SkillItem[];
  onDetail?: (name: string) => void;
}
export interface PxTocProps {
  items?: string[];
  onJump?: (i: number) => void;
}
export interface PxDocProps {
  md?: string;
  lang?: string;
  st?: any;
}
export interface PxHeading {
  level: number;
  text: string;
}
export interface PxListFlatItem {
  indent: number;
  ordered: boolean;
  task: string | null;
  text: string;
}
export interface PxListNode {
  task: string | null;
  text: string;
  kids: PxListSeq | null;
}
export interface PxListBlock {
  ordered: boolean;
  items: PxListNode[];
}
export type PxListSeq = PxListBlock[];
export interface PxDetailState {
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
export interface PxStore {
  pxDetail?: PxDetailState | null;
  pxImgOverlay?: { src?: string; alt?: string } | null;
}
export interface SkillDetailModalProps {
  st?: PxStore;
  onRetry?: ((name: string) => void) | null;
}
