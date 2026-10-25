// Duelist badges: plain monogram-style marks (no characters). Deterministic from the id;
// 'avatar-1'..'avatar-12' are the presets offered in Customize.
import { hashString } from './util';

const TONES = ['#2c2f36', '#33465c', '#4f2a2e', '#3f4630', '#43344d', '#2b4a48', '#5a4a33', '#3a3d45', '#283a52', '#4d3a2a', '#2f3b33', '#4a2f3f'];
const MARKS = ['ring', 'diamond', 'triangle', 'square', 'hex', 'cross', 'chevron', 'bars', 'dots', 'arc', 'star', 'split'] as const;
type Mark = (typeof MARKS)[number];

export const AVATAR_IDS = Array.from({ length: 12 }, (_, i) => `avatar-${i + 1}`);

function markPath(m: Mark): string {
  const s = 'fill="none" stroke="#e9e6df" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
  switch (m) {
    case 'ring':
      return `<circle cx="50" cy="50" r="17" ${s}/>`;
    case 'diamond':
      return `<path d="M50 30 L70 50 L50 70 L30 50 Z" ${s}/>`;
    case 'triangle':
      return `<path d="M50 31 L70 66 L30 66 Z" ${s}/>`;
    case 'square':
      return `<rect x="33" y="33" width="34" height="34" rx="3" ${s}/>`;
    case 'hex':
      return `<path d="M50 30 L67 40 L67 60 L50 70 L33 60 L33 40 Z" ${s}/>`;
    case 'cross':
      return `<path d="M50 32 V68 M32 50 H68" ${s}/>`;
    case 'chevron':
      return `<path d="M33 42 L50 58 L67 42" ${s}/>`;
    case 'bars':
      return `<path d="M38 34 V66 M50 34 V66 M62 34 V66" ${s}/>`;
    case 'dots':
      return `<g fill="#e9e6df">${[38, 50, 62].flatMap((x) => [38, 50, 62].map((y) => `<circle cx="${x}" cy="${y}" r="3.4"/>`)).join('')}</g>`;
    case 'arc':
      return `<path d="M32 60 A18 18 0 0 1 68 60" ${s}/><circle cx="50" cy="60" r="3.5" fill="#e9e6df"/>`;
    case 'star':
      return `<path d="M50 30 L55 45 L70 50 L55 55 L50 70 L45 55 L30 50 L45 45 Z" ${s}/>`;
    case 'split':
      return `<circle cx="50" cy="50" r="17" ${s}/><path d="M38 62 L62 38" ${s}/>`;
  }
}

function initials(id: string): string {
  const words = id.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}

export function avatarSVG(id: string): string {
  const preset = /^avatar-(\d+)$/.exec(id);
  const h = hashString(id || 'anon');
  const idx = preset ? (Number(preset[1]) - 1) % 12 : h % 12;
  const tone = TONES[idx];
  // Names (AI opponents) show initials; presets and seeds show a mark.
  const ini = preset ? '' : initials(id);
  const inner = ini
    ? `<text x="50" y="58" text-anchor="middle" font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif" font-size="27" font-weight="600" letter-spacing="1" fill="#e9e6df">${ini}</text>`
    : markPath(MARKS[preset ? idx : (h >> 4) % 12]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="50" fill="${tone}"/>
<circle cx="50" cy="50" r="49" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
${inner}
</svg>`;
}

/** Render a duelist badge into a new element. */
export function renderAvatar(id: string, size = 64): HTMLElement {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = '50%';
  el.style.overflow = 'hidden';
  el.style.flex = 'none';
  el.innerHTML = avatarSVG(id);
  const svg = el.firstElementChild as SVGElement | null;
  if (svg) {
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
  }
  return el;
}
