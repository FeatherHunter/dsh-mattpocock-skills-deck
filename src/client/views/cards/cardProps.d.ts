/**
 * views/cards/cardProps.d.ts - props contracts for the three cards (S1/S6/S7).
 * Types only; never transpiled. Every field is optional so callers pass only what they have.
 * Value references across leaves are NOT declared here - each consumer declares its own.
 */
export type CardActionKind = string;
export interface CardTagItem { text?: string; color?: string; }
export interface BlockedInfo { no?: string; title?: string; cardId?: string | null; }
export interface BlocksChipInfo { no?: string; title?: string; }
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
