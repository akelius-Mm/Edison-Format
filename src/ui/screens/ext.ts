/// <reference types="vite/client" />
// Bridge to the graphics modules owned by the duel-screen agent (card renderer, sleeves,
// playmats, avatars). Modules are resolved with import.meta.glob so the shell keeps working
// (with simple local fallbacks) if one of them is missing or fails to load.
import type { CardData } from '../../engine/card';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export interface RenderCardOpts {
  size?: CardSize;
  faceDown?: boolean;
  sleeve?: string;
  showLimit?: boolean;
}
export interface ThemeItem {
  id: string;
  name: string;
  [k: string]: unknown;
}

const renderMod = import.meta.glob('../cards/render.ts', { eager: true }) as Record<string, any>;
const sleeveMod = import.meta.glob('../theme/sleeves.ts', { eager: true }) as Record<string, any>;
const playmatMod = import.meta.glob('../theme/playmats.ts', { eager: true }) as Record<string, any>;
const avatarMod = import.meta.glob('../theme/avatars.ts', { eager: true }) as Record<string, any>;

const first = (m: Record<string, any>) => Object.values(m)[0] as any | undefined;
const R = first(renderMod);
const S = first(sleeveMod);
const P = first(playmatMod);
const A = first(avatarMod);

export const hasExternalRenderer = !!R?.renderCard;

// ------------------------------------------------------------------ cards
const SIZE_W: Record<CardSize, number> = { xs: 54, sm: 80, md: 132, lg: 210, xl: 300 };

export function renderCard(data: CardData, opts: RenderCardOpts = {}): HTMLElement {
  if (R?.renderCard) {
    try {
      return R.renderCard(data, opts) as HTMLElement;
    } catch (e) {
      console.error('renderCard failed', e);
    }
  }
  return fallbackCard(data, opts);
}

function frameOf(c: CardData) {
  if (c.kind === 'spell') return 'spell';
  if (c.kind === 'trap') return 'trap';
  const t = c.mtypes ?? [];
  if (t.includes('synchro')) return 'synchro';
  if (t.includes('fusion')) return 'fusion';
  if (t.includes('ritual')) return 'ritual';
  if (t.includes('token')) return 'token';
  if (t.includes('normal')) return 'normal';
  return 'effect';
}

function fallbackCard(c: CardData, opts: RenderCardOpts) {
  const size = opts.size ?? 'md';
  const el = document.createElement('div');
  el.className = `fb-card fb-${size} ${opts.faceDown ? 'fb-back' : 'fb-' + frameOf(c)}`;
  el.style.setProperty('--w', SIZE_W[size] + 'px');
  if (opts.faceDown) {
    if (opts.sleeve) applySleeve(el, opts.sleeve);
    return el;
  }
  const lv = c.kind === 'monster' && c.level ? '★'.repeat(Math.min(12, c.level)) : '';
  const sub =
    c.kind === 'monster'
      ? `${c.race ?? ''} / ${c.attribute ?? ''}`
      : `${c.kind === 'spell' ? 'Spell' : 'Trap'}${(c.stype ?? c.ttype) && (c.stype ?? c.ttype) !== 'normal' ? ' · ' + (c.stype ?? c.ttype) : ''}`;
  el.innerHTML = `<div class="fb-name"></div><div class="fb-stars">${lv}</div><div class="fb-art"><span>${c.kind === 'monster' ? (c.attribute ?? '')[0] ?? '' : c.kind === 'spell' ? '✦' : '⚠'}</span></div><div class="fb-sub"></div>${
    c.kind === 'monster' ? `<div class="fb-stats">ATK ${c.atk ?? '?'} / DEF ${c.def ?? '?'}</div>` : ''
  }`;
  (el.querySelector('.fb-name') as HTMLElement).textContent = c.name;
  (el.querySelector('.fb-sub') as HTMLElement).textContent = sub;
  if (opts.showLimit && c.limit != null && c.limit < 3) {
    const b = document.createElement('div');
    b.className = `fb-limit lim-${c.limit}`;
    b.textContent = c.limit === 0 ? '✕' : String(c.limit);
    el.appendChild(b);
  }
  el.title = c.name;
  return el;
}

// ------------------------------------------------------------------ sleeves
const FALLBACK_SLEEVES: ThemeItem[] = [
  { id: 'classic-red', name: 'Classic Crimson', colors: ['#7a1220', '#c0303f'] },
  { id: 'midnight-blue', name: 'Midnight Blue', colors: ['#0d1b3d', '#2c4f9e'] },
  { id: 'royal-gold', name: 'Royal Gold', colors: ['#5a4310', '#d4af37'] },
  { id: 'emerald', name: 'Emerald', colors: ['#0b3d2a', '#2f9e6d'] },
  { id: 'obsidian', name: 'Obsidian', colors: ['#0b0b0f', '#3a3a48'] },
  { id: 'amethyst', name: 'Amethyst', colors: ['#2e1046', '#8a4fc7'] },
];

export const SLEEVES: ThemeItem[] = (S?.SLEEVES as ThemeItem[] | undefined)?.length ? S.SLEEVES : FALLBACK_SLEEVES;

export function applySleeve(el: HTMLElement, id: string) {
  if (S?.applySleeve) {
    try {
      S.applySleeve(el, id);
      return;
    } catch (e) {
      console.error(e);
    }
  }
  const s = FALLBACK_SLEEVES.find((x) => x.id === id) ?? FALLBACK_SLEEVES[0];
  const [a, b] = s.colors as string[];
  el.style.background = `repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0 6px, transparent 6px 12px), radial-gradient(circle at 50% 50%, ${b}, ${a})`;
}

/** A face-down card preview showing a sleeve. */
export function sleevePreview(id: string, size: CardSize = 'md'): HTMLElement {
  const dummy = { id: 'sleeve-preview', name: 'Sleeve', kind: 'spell', text: '' } as CardData;
  return renderCard(dummy, { size, faceDown: true, sleeve: id });
}

// ------------------------------------------------------------------ playmats
const FALLBACK_PLAYMATS: ThemeItem[] = [
  { id: 'edison-night', name: 'Edison Night', colors: ['#0c1424', '#1e3358'] },
  { id: 'arcane-violet', name: 'Arcane Violet', colors: ['#150c24', '#4a2a7a'] },
  { id: 'verdant', name: 'Verdant Grove', colors: ['#0b1a12', '#1f5a3b'] },
  { id: 'ember', name: 'Ember Arena', colors: ['#1c0b08', '#7a2a14'] },
];

export const PLAYMATS: ThemeItem[] = (P?.PLAYMATS as ThemeItem[] | undefined)?.length ? P.PLAYMATS : FALLBACK_PLAYMATS;

export function applyPlaymat(el: HTMLElement, id: string) {
  if (P?.applyPlaymat) {
    try {
      P.applyPlaymat(el, id);
      return;
    } catch (e) {
      console.error(e);
    }
  }
  const m = FALLBACK_PLAYMATS.find((x) => x.id === id) ?? FALLBACK_PLAYMATS[0];
  const [a, b] = m.colors as string[];
  el.style.background = `radial-gradient(ellipse at 50% 40%, ${b}, ${a} 75%)`;
}

// ------------------------------------------------------------------ avatars
export const AVATAR_PRESETS = Array.from({ length: 12 }, (_, i) => `avatar-${i + 1}`);

export function renderAvatar(id: string, size = 64): HTMLElement {
  if (A?.renderAvatar) {
    try {
      return A.renderAvatar(id, size) as HTMLElement;
    } catch (e) {
      console.error(e);
    }
  }
  let hsh = 0;
  for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hsh % 360;
  const el = document.createElement('div');
  el.className = 'fb-avatar';
  el.style.width = el.style.height = size + 'px';
  el.style.background = `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 50) % 360} 60% 18%))`;
  el.textContent = id.replace(/^avatar-/, '#').slice(0, 3).toUpperCase();
  el.style.fontSize = size * 0.32 + 'px';
  return el;
}
