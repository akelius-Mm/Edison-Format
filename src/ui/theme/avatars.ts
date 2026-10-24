// Procedural duelist avatars (deterministic from id). 'avatar-1'..'avatar-12' are curated presets.
import { Rand, hashString, shade } from './util';

interface Look {
  skin: string;
  hair: string;
  hairStyle: 'spiky' | 'long' | 'bob' | 'mohawk' | 'hood' | 'swept' | 'bun' | 'helmet' | 'wild';
  eyes: string;
  eyeStyle: 'sharp' | 'round' | 'calm' | 'glow';
  mouth: 'smile' | 'smirk' | 'flat' | 'grin';
  accessory: 'none' | 'headband' | 'crown' | 'horns' | 'goggles' | 'mask' | 'earring' | 'scar' | 'visor';
  outfit: string;
  trim: string;
  bgA: string;
  bgB: string;
}

const SKINS = ['#f6d2b4', '#eabf98', '#d7a07a', '#b97b52', '#8d5a3a', '#6a4028', '#f2d7c9', '#c9b7f0'];
const HAIRS = ['#1d1a22', '#4a2c1a', '#a3561e', '#e8c55a', '#f0f0f5', '#c8323c', '#3a6ad8', '#7a3ac8', '#2fa36b', '#ff8ac0'];
const EYES = ['#2a6ad8', '#2fa36b', '#7a3ac8', '#c8323c', '#e0a020', '#20b8d8', '#5a3a20'];
const OUTFITS = ['#1d2b5c', '#5c1d1d', '#1d4a2e', '#3a1d5c', '#2b2b30', '#6a4a12', '#0f4a5a', '#5a1d48'];
const BGS: [string, string][] = [
  ['#3a5cc8', '#0d1638'],
  ['#c83a3a', '#2a0808'],
  ['#3ac87a', '#08281a'],
  ['#a03ac8', '#1c0830'],
  ['#c8a03a', '#2e2008'],
  ['#3ab4c8', '#082a30'],
  ['#c8603a', '#2e1208'],
  ['#6a6a7a', '#16161c'],
];

const PRESETS: Record<string, Look> = {
  'avatar-1': { skin: SKINS[0], hair: '#1d1a22', hairStyle: 'spiky', eyes: '#7a3ac8', eyeStyle: 'sharp', mouth: 'smirk', accessory: 'none', outfit: '#1d2b5c', trim: '#d8b45a', bgA: '#3a5cc8', bgB: '#0d1638' },
  'avatar-2': { skin: SKINS[1], hair: '#e8c55a', hairStyle: 'long', eyes: '#2a6ad8', eyeStyle: 'round', mouth: 'smile', accessory: 'earring', outfit: '#5a1d48', trim: '#f0c0e0', bgA: '#c83a7a', bgB: '#2a0818' },
  'avatar-3': { skin: SKINS[3], hair: '#f0f0f5', hairStyle: 'wild', eyes: '#c8323c', eyeStyle: 'glow', mouth: 'grin', accessory: 'scar', outfit: '#2b2b30', trim: '#c8323c', bgA: '#c83a3a', bgB: '#2a0808' },
  'avatar-4': { skin: SKINS[2], hair: '#3a6ad8', hairStyle: 'swept', eyes: '#20b8d8', eyeStyle: 'calm', mouth: 'flat', accessory: 'visor', outfit: '#0f4a5a', trim: '#5ef2ff', bgA: '#3ab4c8', bgB: '#082a30' },
  'avatar-5': { skin: SKINS[0], hair: '#c8323c', hairStyle: 'mohawk', eyes: '#e0a020', eyeStyle: 'sharp', mouth: 'grin', accessory: 'goggles', outfit: '#5c1d1d', trim: '#ffb03a', bgA: '#c8603a', bgB: '#2e1208' },
  'avatar-6': { skin: SKINS[6], hair: '#1d1a22', hairStyle: 'hood', eyes: '#c06bff', eyeStyle: 'glow', mouth: 'flat', accessory: 'none', outfit: '#3a1d5c', trim: '#c06bff', bgA: '#a03ac8', bgB: '#1c0830' },
  'avatar-7': { skin: SKINS[4], hair: '#1d1a22', hairStyle: 'bun', eyes: '#2fa36b', eyeStyle: 'calm', mouth: 'smile', accessory: 'headband', outfit: '#1d4a2e', trim: '#e8e0b0', bgA: '#3ac87a', bgB: '#08281a' },
  'avatar-8': { skin: SKINS[1], hair: '#e8c55a', hairStyle: 'swept', eyes: '#2a6ad8', eyeStyle: 'sharp', mouth: 'smirk', accessory: 'crown', outfit: '#6a4a12', trim: '#ffe080', bgA: '#c8a03a', bgB: '#2e2008' },
  'avatar-9': { skin: SKINS[7], hair: '#7a3ac8', hairStyle: 'wild', eyes: '#ff4a6a', eyeStyle: 'glow', mouth: 'grin', accessory: 'horns', outfit: '#2b2b30', trim: '#ff4a6a', bgA: '#6a1a3a', bgB: '#14040c' },
  'avatar-10': { skin: SKINS[5], hair: '#f0f0f5', hairStyle: 'bob', eyes: '#e0a020', eyeStyle: 'round', mouth: 'smile', accessory: 'earring', outfit: '#0f4a5a', trim: '#ffd27a', bgA: '#3a5cc8', bgB: '#0d1638' },
  'avatar-11': { skin: SKINS[2], hair: '#4a2c1a', hairStyle: 'helmet', eyes: '#5a3a20', eyeStyle: 'calm', mouth: 'flat', accessory: 'mask', outfit: '#2b2b30', trim: '#a0a8b8', bgA: '#6a6a7a', bgB: '#16161c' },
  'avatar-12': { skin: SKINS[0], hair: '#ff8ac0', hairStyle: 'long', eyes: '#7a3ac8', eyeStyle: 'round', mouth: 'smirk', accessory: 'headband', outfit: '#5a1d48', trim: '#ffd0ea', bgA: '#a03ac8', bgB: '#1c0830' },
};

export const AVATAR_IDS = Object.keys(PRESETS);

function lookFor(id: string): Look {
  if (PRESETS[id]) return PRESETS[id];
  const r = new Rand(hashString(id || 'anon'));
  const bg = r.pick(BGS);
  return {
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: r.pick(['spiky', 'long', 'bob', 'mohawk', 'hood', 'swept', 'bun', 'helmet', 'wild'] as const),
    eyes: r.pick(EYES),
    eyeStyle: r.pick(['sharp', 'round', 'calm', 'glow'] as const),
    mouth: r.pick(['smile', 'smirk', 'flat', 'grin'] as const),
    accessory: r.pick(['none', 'none', 'headband', 'crown', 'horns', 'goggles', 'mask', 'earring', 'scar', 'visor'] as const),
    outfit: r.pick(OUTFITS),
    trim: r.pick(['#d8b45a', '#e0e6f0', '#5ef2ff', '#ff7a4a', '#c06bff']),
    bgA: bg[0],
    bgB: bg[1],
  };
}

let uid = 0;

export function avatarSVG(id: string): string {
  const L = lookFor(id);
  const k = `av${++uid}`;
  const hairD = shade(L.hair, 0, 0, -0.12);
  const skinD = shade(L.skin, 0, 0, -0.1);
  const back: string[] = [];
  const front: string[] = [];
  switch (L.hairStyle) {
    case 'spiky':
      front.push(`<path d="M30 46 L24 30 L34 34 L32 18 L42 28 L46 10 L52 26 L60 12 L62 28 L72 18 L68 34 L78 30 L70 46 C66 36 58 32 50 32 C42 32 34 36 30 46 Z" fill="${L.hair}" stroke="${hairD}" stroke-width="1"/>`);
      break;
    case 'long':
      back.push(`<path d="M28 44 C26 64 26 80 30 92 L70 92 C74 80 74 64 72 44 Z" fill="${hairD}"/>`);
      front.push(`<path d="M30 48 C28 30 40 22 50 22 C62 22 72 30 70 48 C64 38 56 34 48 36 C40 38 34 42 30 48 Z" fill="${L.hair}"/>`);
      break;
    case 'bob':
      back.push(`<path d="M28 42 C26 56 28 66 32 70 L68 70 C72 66 74 56 72 42 Z" fill="${hairD}"/>`);
      front.push(`<path d="M30 50 C28 30 40 22 50 22 C62 22 72 30 70 50 L66 40 C60 36 54 34 50 38 C44 34 38 36 34 40 Z" fill="${L.hair}"/>`);
      break;
    case 'mohawk':
      front.push(`<path d="M44 34 L42 8 L50 16 L52 6 L56 16 L60 10 L58 34 Z" fill="${L.hair}" stroke="${hairD}" stroke-width="1"/>`);
      front.push(`<path d="M32 40 C34 32 40 28 46 28 L46 34 C40 34 36 36 32 40 Z M68 40 C66 32 60 28 54 28 L54 34 C60 34 64 36 68 40 Z" fill="${hairD}" opacity=".6"/>`);
      break;
    case 'hood':
      back.push(`<path d="M22 70 C18 40 32 18 50 18 C68 18 82 40 78 70 Z" fill="${L.outfit}" stroke="${L.trim}" stroke-width="1.2"/>`);
      front.push(`<path d="M26 66 C24 42 36 24 50 24 C64 24 76 42 74 66 C70 46 62 34 50 34 C38 34 30 46 26 66 Z" fill="${L.outfit}" stroke="${L.trim}" stroke-width="1"/>`);
      break;
    case 'swept':
      front.push(`<path d="M30 46 C28 28 42 20 54 22 C66 24 74 32 72 46 C66 38 60 34 52 36 L30 46 Z M30 46 C34 36 42 30 54 30 L34 44 Z" fill="${L.hair}" stroke="${hairD}" stroke-width="1"/>`);
      front.push(`<path d="M52 24 C62 20 74 26 78 36 C70 30 62 28 54 30 Z" fill="${L.hair}"/>`);
      break;
    case 'bun':
      back.push(`<circle cx="50" cy="16" r="9" fill="${L.hair}" stroke="${hairD}" stroke-width="1"/>`);
      front.push(`<path d="M30 46 C28 30 40 24 50 24 C62 24 72 30 70 46 C66 36 58 32 50 32 C42 32 34 36 30 46 Z" fill="${L.hair}"/>`);
      break;
    case 'helmet':
      front.push(`<path d="M28 50 C26 28 38 18 50 18 C62 18 74 28 72 50 L66 50 L66 40 L34 40 L34 50 Z" fill="#7d8796" stroke="#2b313a" stroke-width="1.2"/>`);
      front.push(`<path d="M50 18 L50 40" stroke="#c8d0dc" stroke-width="2"/>`);
      break;
    case 'wild':
      back.push(`<path d="M20 60 L24 40 L16 34 L28 28 L24 16 L38 20 L42 8 L52 18 L62 8 L64 20 L78 16 L74 30 L86 36 L76 42 L80 60 Z" fill="${L.hair}" stroke="${hairD}" stroke-width="1"/>`);
      front.push(`<path d="M30 46 L34 34 L40 38 L44 28 L50 36 L56 28 L60 38 L66 34 L70 46 C64 38 58 34 50 34 C42 34 36 38 30 46 Z" fill="${L.hair}"/>`);
      break;
  }

  let eyes = '';
  const ey = 50;
  switch (L.eyeStyle) {
    case 'sharp':
      eyes = `<path d="M37 ${ey} L46 ${ey - 2} L45 ${ey + 2} Z M63 ${ey} L54 ${ey - 2} L55 ${ey + 2} Z" fill="${L.eyes}" stroke="#111" stroke-width=".8"/>`;
      break;
    case 'round':
      eyes = `<ellipse cx="42" cy="${ey}" rx="3.2" ry="3.8" fill="#fff"/><ellipse cx="58" cy="${ey}" rx="3.2" ry="3.8" fill="#fff"/><circle cx="42.4" cy="${ey + 0.5}" r="2.3" fill="${L.eyes}"/><circle cx="58.4" cy="${ey + 0.5}" r="2.3" fill="${L.eyes}"/><circle cx="43" cy="${ey - 0.6}" r=".8" fill="#fff"/><circle cx="59" cy="${ey - 0.6}" r=".8" fill="#fff"/>`;
      break;
    case 'calm':
      eyes = `<path d="M38 ${ey} Q42 ${ey - 3} 46 ${ey} Q42 ${ey + 1.6} 38 ${ey} Z M54 ${ey} Q58 ${ey - 3} 62 ${ey} Q58 ${ey + 1.6} 54 ${ey} Z" fill="${L.eyes}" stroke="#111" stroke-width=".7"/>`;
      break;
    case 'glow':
      eyes = `<g filter="url(#${k}g)"><path d="M37 ${ey} L46 ${ey - 2.4} L45 ${ey + 2} Z M63 ${ey} L54 ${ey - 2.4} L55 ${ey + 2} Z" fill="${L.eyes}"/></g>`;
      break;
  }
  const brows = `<path d="M36 ${ey - 6} L46 ${ey - 5} M64 ${ey - 6} L54 ${ey - 5}" stroke="${hairD}" stroke-width="1.8" stroke-linecap="round"/>`;
  const mouth = {
    smile: `<path d="M44 62 Q50 66 56 62" stroke="#5a2a20" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    smirk: `<path d="M45 63 Q51 64 56 60" stroke="#5a2a20" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    flat: `<path d="M45 63 L55 63" stroke="#5a2a20" stroke-width="1.4" stroke-linecap="round"/>`,
    grin: `<path d="M43 61 Q50 68 57 61 Z" fill="#fff" stroke="#5a2a20" stroke-width="1.2"/>`,
  }[L.mouth];

  let acc = '';
  switch (L.accessory) {
    case 'headband':
      acc = `<path d="M30 40 C40 35 60 35 70 40 L70 44 C60 39 40 39 30 44 Z" fill="${L.trim}"/><path d="M70 42 L80 46 L76 50 Z" fill="${L.trim}"/>`;
      break;
    case 'crown':
      acc = `<path d="M34 30 L36 18 L43 25 L50 14 L57 25 L64 18 L66 30 Z" fill="#f3d27a" stroke="#8a5a12" stroke-width="1"/><circle cx="50" cy="24" r="1.8" fill="#c8323c"/>`;
      break;
    case 'horns':
      acc = `<path d="M34 34 C26 28 24 18 28 10 C30 20 36 26 40 30 Z M66 34 C74 28 76 18 72 10 C70 20 64 26 60 30 Z" fill="#2b2b30" stroke="${L.trim}" stroke-width="1"/>`;
      break;
    case 'goggles':
      acc = `<rect x="30" y="34" width="40" height="5" rx="2" fill="#3a2a1a"/><circle cx="41" cy="36" r="6" fill="#20b8d8" stroke="#3a2a1a" stroke-width="2" opacity=".85"/><circle cx="59" cy="36" r="6" fill="#20b8d8" stroke="#3a2a1a" stroke-width="2" opacity=".85"/>`;
      break;
    case 'mask':
      acc = `<path d="M33 56 C40 54 60 54 67 56 L64 68 C58 72 42 72 36 68 Z" fill="#2b313a" stroke="${L.trim}" stroke-width="1"/>`;
      break;
    case 'earring':
      acc = `<circle cx="31" cy="58" r="2" fill="${L.trim}"/><circle cx="69" cy="58" r="2" fill="${L.trim}"/>`;
      break;
    case 'scar':
      acc = `<path d="M58 42 L64 58" stroke="#a03a3a" stroke-width="1.4" stroke-linecap="round"/><path d="M59 47 L63 46 M60 51 L64 50" stroke="#a03a3a" stroke-width="1"/>`;
      break;
    case 'visor':
      acc = `<path d="M33 46 L67 46 L65 54 L35 54 Z" fill="${L.trim}" opacity=".55" stroke="#0a1a20" stroke-width="1"/>`;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="avatar-svg">
<defs>
<radialGradient id="${k}bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${L.bgA}"/><stop offset="1" stop-color="${L.bgB}"/></radialGradient>
<linearGradient id="${k}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.skin}"/><stop offset="1" stop-color="${skinD}"/></linearGradient>
<filter id="${k}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="${k}c"><circle cx="50" cy="50" r="50"/></clipPath>
</defs>
<g clip-path="url(#${k}c)">
<rect width="100" height="100" fill="url(#${k}bg)"/>
<g stroke="#fff" stroke-opacity=".08" fill="none"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="30"/></g>
${back.join('')}
<path d="M8 104 C12 82 30 74 50 74 C70 74 88 82 92 104 Z" fill="${L.outfit}" stroke="${L.trim}" stroke-width="1.2"/>
<path d="M40 75 L50 88 L60 75" fill="none" stroke="${L.trim}" stroke-width="1.6"/>
<rect x="43" y="62" width="14" height="14" fill="${skinD}"/>
<ellipse cx="31.5" cy="51" rx="3" ry="5" fill="${skinD}"/><ellipse cx="68.5" cy="51" rx="3" ry="5" fill="${skinD}"/>
<path d="M31 46 C31 30 40 24 50 24 C60 24 69 30 69 46 C69 60 62 70 50 70 C38 70 31 60 31 46 Z" fill="url(#${k}sk)"/>
${brows}${eyes}
<path d="M50 52 L48 58 L51 58" stroke="${skinD}" stroke-width="1.2" fill="none"/>
${mouth}
${front.join('')}
${acc}
</g>
<circle cx="50" cy="50" r="48.5" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3"/>
</svg>`;
}

/** Render a procedural avatar into a new element. */
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
