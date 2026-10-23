/**
 * views/cards/cardProps.d.ts - props contracts for the three cards (S1/S6/S7).
 * Types only; never transpiled. Every field is optional so callers pass only what they have.
 * Value references across leaves are NOT declared here - each consumer declares its own.
 */
export type CardActionKind = string;
export interface CardTagItem { text?: string; color?: string; }
export interface BlockedInfo {
  /** 挡路票编号；封条第一行画它。 */
  no?: string;
  /** 挡路票标题；封条第二行画它（#1401），过长时由样式单行省略。 */
  title?: string;
  cardId?: string | null;
  /** 红封条被点按（只有可跳转的卡会传：整卡点击已用于进详情，点亮挡路关系落在封条上）。 */
  onActivate?: (() => void) | null;
}
export interface BlocksChipInfo { no?: string; title?: string; }
/** 整卡暗层的 props：有挡路票标题时封条占两行，暗层只压暗、不再写居中的点击提示（#1401）。 */
export interface DimVeilProps { quiet?: boolean; }
export interface CardActionStyle { colorKey?: string; icon?: string; hollow?: boolean; }
export interface IssueCardProps {
  action?: CardActionKind;
  noText?: string;
  title?: string;
  tags?: CardTagItem[];
  note?: string;
  updatedText?: string;
  footActionText?: string;
  closed?: boolean;
  claimedBy?: string | null;
  bugCorner?: boolean;
  pickCorner?: string | null;
  blockedBy?: BlockedInfo | null;
  blocksChip?: BlocksChipInfo | null;
  cardId?: string | null;
  lit?: boolean;
  colorOf?: Record<string, string> | null;
  onMain?: (() => void) | null;
  onNew?: (() => void) | null;
  onCopy?: (() => void) | null;
  onOpen?: (() => void) | null;
  /** 整张卡点按（进这张票的详情页）。给了它，整张卡才可点、可聚焦、键盘回车能进；不给时整卡不接点按。 */
  onCard?: (() => void) | null;
  onLitChange?: ((lit: boolean) => void) | null;
}
export interface IssueMapCardProps {
  mapNo?: string; title?: string; open?: boolean;
  kids?: number; ready?: number; blocked?: number;
  updatedText?: string; claimedBy?: string | null;
  dots?: { color: string; n: number }[];
  sign?: string | null;
  blockedBy?: BlockedInfo | null; blocksChip?: BlocksChipInfo | null;
  cardId?: string | null; lit?: boolean;
  onLitChange?: ((lit: boolean) => void) | null;
}
export interface MapDotItem { no?: string; cls?: string; stateText?: string; title?: string; }
export interface MapCardProps {
  mapNo?: string; title?: string; open?: boolean;
  updatedText?: string; dateText?: string;
  dots?: MapDotItem[];
  hoverNo?: string | null;
  onHover?: ((no: string | null) => void) | null;
}
