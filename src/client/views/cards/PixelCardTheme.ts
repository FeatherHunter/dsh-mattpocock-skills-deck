/** views/cards/PixelCardTheme.ts - card theme truth (S1/S6/S7). Pure functions, no Chinese. */
export const CARD_ACTION_COLORS: Record<string, string> = {
  diagnose: 'fbca04', fix: 'd73a4a', execute: '10b981', claim: 'b60205',
  supplement: '5319e7', research: '0ea5e9', grill: '9d7cd8', proto: 'f59e0b',
  map: '8b5cf6', block: 'a3231a',
};
export interface CardActionStyle { colorKey: string; icon: string; hollow: boolean; }
export const CARD_ACTION_STYLE: Record<string, CardActionStyle> = {
  diagnose: { colorKey: 'needs-triage', icon: 'chat', hollow: false },
  fix: { colorKey: 'bug', icon: 'hammer', hollow: false },
  execute: { colorKey: 'wayfinder:task', icon: 'play', hollow: false },
  claim: { colorKey: 'ready-for-human', icon: 'play', hollow: false },
  supplement: { colorKey: 'needs-info', icon: 'play', hollow: false },
  research: { colorKey: 'wayfinder:research', icon: 'search', hollow: true },
  grill: { colorKey: 'wayfinder:grilling', icon: 'chat', hollow: true },
  proto: { colorKey: 'wayfinder:prototype', icon: 'proto', hollow: true },
};
export const cardColorOf = function (c: string, m?: Record<string, string> | null): string {
  const tab = m || {};
  const v = tab[c] || CARD_ACTION_COLORS[c] || '8b5cf6';
  return String(v).replace(/^#/, '').toLowerCase();
};
export const cardLum = function (hex: string): number {
  const h = String(hex).split('#').join('');
  const ch = function (i: number): number { return parseInt(h.substr(i * 2, 2), 16) / 255; };
  const f = function (x: number): number {
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(ch(0)) + 0.7152 * f(ch(1)) + 0.0722 * f(ch(2));
};
export const cardInkOn = function (hex: string): string {
  const l = cardLum(hex);
  return ((l + 0.05) / 0.05) >= (1.05 / (l + 0.05)) ? '#1c1004' : '#fff9ec';
};
