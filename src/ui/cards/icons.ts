// Small inline SVG icons used on card frames and in the UI.
import type { Attribute, SpellType, TrapType } from '../../engine/types';

export const ATTR_COLORS: Record<string, [string, string]> = {
  DARK: ['#7d3fc4', '#1f0838'],
  LIGHT: ['#fff1a8', '#c08a12'],
  FIRE: ['#ff7b3a', '#9a1606'],
  WATER: ['#6cc4ff', '#0d3f8a'],
  WIND: ['#8ff08a', '#1c6b2a'],
  EARTH: ['#d9a46a', '#5a3614'],
  DIVINE: ['#ffe28a', '#a85d00'],
  SPELL: ['#5cf0cf', '#0a5c4e'],
  TRAP: ['#ff86cf', '#7a0f52'],
};

const GLYPHS: Record<string, string> = {
  DARK: '<path d="M14 5.5 A7 7 0 1 0 14 18.5 A5.4 5.4 0 1 1 14 5.5 Z" fill="#f2e2ff"/><circle cx="15.5" cy="12" r="1.4" fill="#ff7ae6"/>',
  LIGHT:
    '<circle cx="12" cy="12" r="3.6" fill="#fff"/><g stroke="#fff" stroke-width="1.5" stroke-linecap="round"><path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.8 1.8M16.2 16.2L18 18M6 18l1.8-1.8M16.2 7.8L18 6"/></g>',
  FIRE: '<path d="M12 3.5c1.4 3.4 5 4.6 5 9 0 3-2.2 5.4-5 5.4S7 15.5 7 12.8c0-2.2 1.4-3.2 2-5 .8 1.6 1.4 2 2 2.4 0-2.4-.4-4.2 1-6.7Z" fill="#ffe7b0"/><path d="M12 11c.8 1.6 2.4 2.2 2.4 4 0 1.4-1 2.4-2.4 2.4s-2.4-1-2.4-2.3c0-1.6 1.6-2.2 2.4-4.1Z" fill="#fff"/>',
  WATER: '<path d="M12 3.5c2.2 4 5.2 6.4 5.2 10a5.2 5.2 0 0 1-10.4 0c0-3.6 3-6 5.2-10Z" fill="#e4f6ff"/><path d="M9.6 13.6c0-1.6.9-3 1.6-4" stroke="#6cc4ff" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  WIND: '<g stroke="#eaffdf" stroke-width="1.7" fill="none" stroke-linecap="round"><path d="M4 9h10a2.6 2.6 0 1 0-2.6-2.6"/><path d="M4 13h13a2.6 2.6 0 1 1-2.6 2.6"/><path d="M5 17h6"/></g>',
  EARTH: '<path d="M3.5 18 9.5 7.5l3 5 2-3 6 8.5Z" fill="#ffe9c8"/><path d="M9.5 7.5 8 10.2h3Z" fill="#fff"/>',
  DIVINE: '<path d="M12 4l2.2 5.2L20 9.6l-4.4 3.7 1.4 5.7L12 16l-5 3 1.4-5.7L4 9.6l5.8-.4Z" fill="#fff6d0"/>',
  SPELL: '<path d="M12 3.5l1.9 6.6 6.6 1.9-6.6 1.9L12 20.5l-1.9-6.6L3.5 12l6.6-1.9Z" fill="#eafffa"/>',
  TRAP: '<path d="M12 4 21 19H3Z" fill="none" stroke="#ffe8f6" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.5v4.5" stroke="#ffe8f6" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.1" fill="#ffe8f6"/>',
};

export function attributeIconSVG(attr: Attribute | 'SPELL' | 'TRAP'): string {
  ensureIconDefs();
  return `<svg viewBox="0 0 24 24" class="yc-attr-svg" aria-label="${attr}"><circle cx="12" cy="12" r="11" fill="url(#yc-ag-${attr in ATTR_COLORS ? attr : 'EARTH'})" stroke="#1a1208" stroke-width="1"/><circle cx="12" cy="12" r="9.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>${GLYPHS[attr] ?? ''}</svg>`;
}

let defsDone = false;
/** Inject shared gradient definitions once (inline SVGs reference them by id). */
export function ensureIconDefs() {
  if (defsDone || typeof document === 'undefined') return;
  defsDone = true;
  const grads = Object.entries(ATTR_COLORS)
    .map(([k, [a, b]]) => `<radialGradient id="yc-ag-${k}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`)
    .join('');
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  holder.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs>${grads}<radialGradient id="yc-lvs" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff9a4a"/><stop offset="1" stop-color="#a5180a"/></radialGradient></defs></svg>`;
  document.body.appendChild(holder);
}

export const LEVEL_STAR_SVG =
  '<svg viewBox="0 0 20 20" class="yc-star-svg"><circle cx="10" cy="10" r="9.2" fill="url(#yc-lvs)" stroke="#3a0a02" stroke-width=".9"/><path d="M10 3.6l1.8 4 4.4.4-3.3 2.9 1 4.3L10 13l-3.9 2.2 1-4.3-3.3-2.9 4.4-.4Z" fill="#ffe27a" stroke="#8a4a00" stroke-width=".5"/></svg>';

export function spellTypeIcon(t: SpellType | TrapType | undefined): string {
  switch (t) {
    case 'quickplay':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><path d="M9.5 1.5 3.5 9h4l-1 5.5 6-8h-4Z" fill="currentColor"/></svg>';
    case 'continuous':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><path d="M8 8c-1.6-2.4-5.5-2.4-5.5 0s3.9 2.4 5.5 0 5.5-2.4 5.5 0-3.9 2.4-5.5 0Z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    case 'equip':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
    case 'field':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.4"/></svg>';
    case 'ritual':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><path d="M8 1.5c1 2.6 4 3.6 4 7a4 4 0 0 1-8 0c0-1.8 1.2-2.6 1.6-4 .6 1.2 1 1.6 1.6 1.8 0-1.8-.4-3 .8-4.8Z" fill="currentColor"/></svg>';
    case 'counter':
      return '<svg viewBox="0 0 16 16" class="yc-st-icon"><path d="M12.5 5A5 5 0 1 0 13 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M13.8 1.8 13 6 9 5Z" fill="currentColor"/></svg>';
    default:
      return '';
  }
}

export const ICONS = {
  sword: '<svg viewBox="0 0 24 24"><path d="M14.5 3H21v6.5L10 20.5 3.5 14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 21l3.5-3.5M7 13l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2.5 20 5.5v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  log: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12Z" fill="currentColor"/></svg>',
  chain: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.5v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.3" fill="currentColor"/></svg>',
};
