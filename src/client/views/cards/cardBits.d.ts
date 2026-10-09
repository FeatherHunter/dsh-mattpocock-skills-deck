/**
 * views/cards/cardBits.d.ts - props contracts for the smallest card bits.
 * Types only; never transpiled. Each bit file imports exactly the one it needs.
 * Every field is optional: callers pass only what they have.
 */
import type { CardTagItem } from './cardProps';
export interface PinProps { kind?: string; }
export interface CardTitleProps { text?: string; tall?: boolean; suffix?: any; }
export interface CardNoProps { text?: string; action?: string; hollow?: boolean; colorOf?: Record<string, string> | null; }
export interface CardTagsProps { tags?: CardTagItem[]; }
export interface CardNoteProps { text?: string; }
export interface CardFootProps { left?: string; right?: string; }
export interface CornerMarkProps { kind?: string; }
export interface CardHeadProps { no?: any; sign?: string | null; closed?: boolean; }
export interface CardBtnsProps {
  mainLabel?: string; icon?: string; mainColor?: string;
  onMain?: (() => void) | null; onNew?: (() => void) | null;
  onCopy?: (() => void) | null; onOpen?: (() => void) | null;
}
export interface CardIconProps { n?: string; }
export interface MapDotsProps { cells?: { color: string; n: number }[]; }
export interface MapStatsProps { kids?: number; ready?: number; blocked?: number; }
