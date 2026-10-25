// Procedural, deterministic SVG card art. No external images.
// Palette from attribute (or spell/trap), emblem from monster Type / spell-trap motif,
// seeded variation in background pattern, glow, particles and composition.
import type { CardData } from '../../engine/card';
import { Rand, hashString, mix, polyPoints, shade, starPoints } from '../theme/util';

export interface ArtPalette {
  bg0: string; // darkest (edges)
  bg1: string; // mid
  bg2: string; // light (centre)
  glow: string;
  bodyA: string; // emblem gradient top
  bodyB: string; // emblem gradient bottom
  line: string; // outlines
  accent: string;
  eye: string; // glowing details
}

const BASE: Record<string, ArtPalette> = {
  DARK: { bg0: '#07030f', bg1: '#2a0f48', bg2: '#7a3cc2', glow: '#c48bff', bodyA: '#3a1d5c', bodyB: '#120722', line: '#05010b', accent: '#d6a6ff', eye: '#ff4fd8' },
  LIGHT: { bg0: '#5a3a08', bg1: '#d29a2c', bg2: '#fff6d2', glow: '#fffbe6', bodyA: '#fffdf2', bodyB: '#d9a94a', line: '#6b4609', accent: '#fff1b0', eye: '#4fd2ff' },
  FIRE: { bg0: '#1c0300', bg1: '#8a1a04', bg2: '#ff8a1e', glow: '#ffc04d', bodyA: '#b5340c', bodyB: '#3a0a02', line: '#1a0300', accent: '#ffd36e', eye: '#fff36a' },
  WATER: { bg0: '#010c1e', bg1: '#0a3a78', bg2: '#46b4f8', glow: '#a8ecff', bodyA: '#3d97da', bodyB: '#0b2c57', line: '#020b1c', accent: '#b9f1ff', eye: '#eaffff' },
  WIND: { bg0: '#021a0b', bg1: '#176234', bg2: '#8fe68f', glow: '#dcffc0', bodyA: '#4fb565', bodyB: '#0e3a1d', line: '#021408', accent: '#e4ffc4', eye: '#fff98a' },
  EARTH: { bg0: '#160c04', bg1: '#5c3a19', bg2: '#d29a55', glow: '#ffd9a0', bodyA: '#9c6a36', bodyB: '#2e1b0a', line: '#120902', accent: '#ffe0aa', eye: '#ffe36a' },
  DIVINE: { bg0: '#2a0a00', bg1: '#a3330c', bg2: '#ffd86a', glow: '#fff1b8', bodyA: '#ffe8a0', bodyB: '#b86a12', line: '#3a1200', accent: '#fff6cf', eye: '#ffffff' },
  SPELL: { bg0: '#021613', bg1: '#0b5a4e', bg2: '#4fe3c4', glow: '#b8fff0', bodyA: '#5fe0c8', bodyB: '#0b4a40', line: '#021512', accent: '#d8fff6', eye: '#fffbd0' },
  TRAP: { bg0: '#1a0313', bg1: '#6e0f4f', bg2: '#ff6cc4', glow: '#ffc2ea', bodyA: '#e057a8', bodyB: '#4a0a35', line: '#16020f', accent: '#ffd8f0', eye: '#fff36a' },
};

function paletteFor(data: CardData, r: Rand): ArtPalette {
  const key = data.kind === 'spell' ? 'SPELL' : data.kind === 'trap' ? 'TRAP' : data.attribute ?? 'EARTH';
  const p = BASE[key] ?? BASE.EARTH;
  const dh = data.kind === 'monster' ? r.range(-14, 14) : r.range(-26, 26);
  const ds = r.range(-0.06, 0.06);
  const out: any = {};
  for (const k of Object.keys(p) as (keyof ArtPalette)[]) {
    out[k] = k === 'line' ? p[k] : shade(p[k], dh, ds, 0);
  }
  return out as ArtPalette;
}

// ----------------------------------------------------------------- emblems
type Emblem = (p: ArtPalette, r: Rand) => string;

const B = (extra = '') => `fill="url(#body)" stroke="LINE" stroke-width="1.3" stroke-linejoin="round" ${extra}`;
const fillWith = (svg: string, p: ArtPalette) => svg.replace(/LINE/g, p.line);

function mirrorX(svg: string) {
  return `<g transform="translate(100 0) scale(-1 1)">${svg}</g>`;
}

const RACE_EMBLEMS: Record<string, Emblem> = {
  Dragon: (p) => `
    <g>
      <path d="M46 52 L22 14 Q25 29 13 33 Q22 40 8 47 Q21 52 10 62 Q27 60 33 67 Z" fill="url(#body)" opacity=".92" stroke="LINE" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M46 52 L22 14 M46 52 L13 33 M46 52 L8 47 M46 52 L10 62" stroke="${p.accent}" stroke-width=".7" opacity=".55" fill="none"/>
      <path d="M33 74 L25 70 L35 67 Z M37 63 L29 57 L40 58 Z M43 55 L37 47 L46 50 Z" ${B()}/>
      <path d="M34 94 C30 75 34 60 46 50 C52 45 54 38 52 30 L45 13 L58 25 C66 25 74 29 82 35 L91 39 C89 43 85 45 79 45 L87 52 C79 56 69 53 62 51 C58 60 60 75 68 94 Z" ${B()}/>
      <path d="M55 27 L62 9 L63 27 Z" ${B()}/>
      <path d="M58 60 q4 2 8 0 M58 68 q5 2 9 0 M60 76 q5 2 9 0 M61 84 q5 2 9 0" stroke="${p.accent}" stroke-width=".9" fill="none" opacity=".7"/>
      <path d="M74 45 l2 3 l2 -3 M80 45 l1.5 2.6 l1.5 -2.6 M76 52.5 l1.6 -2.6 l1.6 2.6" stroke="#fff" stroke-width=".8" fill="none" opacity=".9"/>
      <ellipse cx="67" cy="33" rx="3" ry="1.7" fill="${p.eye}" filter="url(#eyeglow)"/>
      <circle cx="86.5" cy="39.2" r=".9" fill="LINE"/>
      <path d="M52 34 C56 30 62 30 66 31" stroke="${p.accent}" stroke-width=".8" fill="none" opacity=".6"/>
    </g>`,
  Spellcaster: (p) => `
    <ellipse cx="50" cy="92" rx="32" ry="5" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".7"/>
    <ellipse cx="50" cy="92" rx="25" ry="3.6" fill="none" stroke="${p.glow}" stroke-width=".6" opacity=".6" stroke-dasharray="2 2"/>
    <path d="M50 34 C42 46 33 66 24 93 L76 93 C67 66 58 46 50 34 Z" ${B()}/>
    <path d="M50 40 L50 92 M38 70 Q50 74 62 70" stroke="${p.accent}" stroke-width="1" fill="none" opacity=".7"/>
    <path d="M57 50 Q67 52 72 45 L74 51 Q66 60 55 58 Z" ${B()}/>
    <line x1="76" y1="26" x2="69" y2="94" stroke="LINE" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="76" y1="26" x2="69" y2="94" stroke="${p.accent}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="50" cy="40" rx="7.5" ry="6.5" fill="#000" opacity=".8"/>
    <circle cx="47" cy="40" r="1.2" fill="${p.eye}" filter="url(#eyeglow)"/><circle cx="53" cy="40" r="1.2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M50 5 C53 16 59 26 68 34 L32 34 C41 26 47 16 50 5 Z" ${B()}/>
    <ellipse cx="50" cy="34" rx="21" ry="4.2" ${B()}/>
    <path d="M44 22 L56 22" stroke="${p.accent}" stroke-width="1.4" opacity=".7"/>
    <circle cx="76" cy="21" r="9" fill="none" stroke="${p.accent}" stroke-width=".8" opacity=".7"/>
    <circle cx="76" cy="21" r="5.5" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="74.5" cy="19.5" r="1.6" fill="#fff" opacity=".9"/>`,
  Zombie: (p) => `
    <path d="M12 94 L17 76 M17 76 L13 66 M17 76 L19 63 M17 76 L24 65 M17 76 L27 70" stroke="url(#body)" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <path d="M88 94 L83 76 M83 76 L87 66 M83 76 L81 63 M83 76 L76 65 M83 76 L73 70" stroke="url(#body)" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <path d="M27 47 C27 22 73 22 73 47 C73 56 69 62 64 64 L64 74 C64 78 36 78 36 74 L36 64 C31 62 27 56 27 47 Z" ${B()}/>
    <ellipse cx="40" cy="48" rx="7.2" ry="6.6" fill="#000" opacity=".88"/>
    <ellipse cx="60" cy="48" rx="7.2" ry="6.6" fill="#000" opacity=".88"/>
    <circle cx="40" cy="49" r="2" fill="${p.eye}" filter="url(#eyeglow)"/><circle cx="60" cy="49" r="2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M50 54 L46 62 L54 62 Z" fill="#000" opacity=".85"/>
    <path d="M40 66 L40 75 M45 66 L45 76 M50 66 L50 76 M55 66 L55 76 M60 66 L60 75 M37 69.5 L63 69.5" stroke="LINE" stroke-width=".9"/>
    <path d="M51 24 L47 32 L52 36 L48 42" stroke="LINE" stroke-width="1" fill="none"/>
    <path d="M32 40 C34 32 42 28 48 28" stroke="${p.accent}" stroke-width="1.2" fill="none" opacity=".45"/>`,
  Warrior: (p) => {
    const sword = (rot: number) => `<g transform="rotate(${rot} 50 54)">
      <path d="M50 2 L54 10 L54 62 L46 62 L46 10 Z" fill="url(#steel)" stroke="LINE" stroke-width="1"/>
      <path d="M50 6 L50 60" stroke="#fff" stroke-width=".7" opacity=".7"/>
      <rect x="37" y="62" width="26" height="4.5" rx="2" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
      <rect x="47.8" y="66.5" width="4.4" height="13" fill="#5a3418" stroke="LINE" stroke-width=".6"/>
      <circle cx="50" cy="82" r="3.2" fill="url(#gold)" stroke="LINE" stroke-width=".6"/></g>`;
    return `${sword(-38)}${sword(38)}
      <path d="M29 33 L71 33 L71 54 C71 70 61 81 50 89 C39 81 29 70 29 54 Z" ${B()}/>
      <path d="M33.5 37.5 L66.5 37.5 L66.5 54 C66.5 67 58.5 76 50 83 C41.5 76 33.5 67 33.5 54 Z" fill="none" stroke="url(#gold)" stroke-width="1.6"/>
      <polygon points="${starPoints(50, 57, 5, 10, 4.2)}" fill="url(#gold)" stroke="LINE" stroke-width=".7"/>
      <path d="M33 36 L50 36" stroke="#fff" stroke-width="1" opacity=".35"/>`;
  },
  'Beast-Warrior': (p) => {
    const axe = (rot: number) => `<g transform="rotate(${rot} 50 56)">
      <rect x="48.4" y="12" width="3.2" height="82" rx="1.4" fill="#6b4423" stroke="LINE" stroke-width=".7"/>
      <path d="M50 16 C39 9 28 14 24 25 C29 30 29 38 24 45 C35 47 44 40 50 31 Z" fill="url(#steel)" stroke="LINE" stroke-width="1"/>
      <path d="M27 26 C30 31 30 38 27 43" stroke="#fff" stroke-width=".8" fill="none" opacity=".7"/></g>`;
    return `${axe(-28)}${mirrorX(axe(-28))}
      <path d="M36 42 L27 22 L44 37 Z" ${B()}/><path d="M64 42 L73 22 L56 37 Z" ${B()}/>
      <path d="M35 40 L65 40 L69 58 L59 77 L50 82 L41 77 L31 58 Z" ${B()}/>
      <path d="M39 51 L47 54 L40 57 Z" fill="${p.eye}" filter="url(#eyeglow)"/><path d="M61 51 L53 54 L60 57 Z" fill="${p.eye}" filter="url(#eyeglow)"/>
      <path d="M44 68 L56 68 L50 73 Z" fill="LINE"/>
      <path d="M45 72 L47 79 L49 72 Z M51 72 L53 79 L55 72 Z" fill="#fff"/>
      <path d="M50 40 L50 50 M42 44 L46 48 M58 44 L54 48" stroke="${p.accent}" stroke-width="1.1" opacity=".75"/>`;
  },
  Plant: (p, r) => {
    const n = r.pick([5, 6, 8]);
    let petals = '';
    for (let i = 0; i < n; i++) {
      petals += `<ellipse cx="50" cy="${40 - 12}" rx="${n > 6 ? 5.5 : 7}" ry="13" transform="rotate(${(i * 360) / n} 50 40)" ${B()}/>`;
    }
    return `
      <path d="M50 94 C47 80 53 66 50 50" stroke="url(#leaf)" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M50 80 C38 78 27 70 22 58 C35 57 46 66 50 80 Z" fill="url(#leaf)" stroke="LINE" stroke-width="1"/>
      <path d="M50 70 C62 68 73 60 78 48 C65 48 54 56 50 70 Z" fill="url(#leaf)" stroke="LINE" stroke-width="1"/>
      <path d="M50 80 L30 62 M50 70 L70 52" stroke="${p.accent}" stroke-width=".6" opacity=".6"/>
      ${petals}
      <circle cx="50" cy="40" r="7" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
      <circle cx="48" cy="38" r="1" fill="#fff8"/><circle cx="52" cy="41" r="1" fill="LINE"/><circle cx="49" cy="43" r=".8" fill="LINE"/>`;
  },
  Machine: (p, r) => {
    const gear = (cx: number, cy: number, ro: number, ri: number, teeth: number, rot: number) => {
      const pts: string[] = [];
      for (let i = 0; i < teeth; i++) {
        const a0 = ((i / teeth) * 360 + rot) * (Math.PI / 180);
        const w = (360 / teeth) * (Math.PI / 180);
        const seq = [
          [ri, a0],
          [ro, a0 + w * 0.12],
          [ro, a0 + w * 0.45],
          [ri, a0 + w * 0.57],
        ];
        for (const [rr, a] of seq) pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${B()}/>`;
    };
    let bolts = '';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bolts += `<circle cx="${(50 + 18 * Math.cos(a)).toFixed(2)}" cy="${(54 + 18 * Math.sin(a)).toFixed(2)}" r="1.7" fill="url(#steel)" stroke="LINE" stroke-width=".5"/>`;
    }
    return `
      ${gear(77, 22, 13, 10, 8, r.range(0, 40))}
      <circle cx="77" cy="22" r="4" fill="${p.bg0}" stroke="LINE" stroke-width="1"/>
      ${gear(50, 54, 33, 26, 12, r.range(0, 30))}
      <circle cx="50" cy="54" r="22" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".55"/>
      ${bolts}
      <circle cx="50" cy="54" r="11" fill="${p.bg0}" stroke="LINE" stroke-width="1.4"/>
      <circle cx="50" cy="54" r="6" fill="${p.eye}" filter="url(#eyeglow)"/>
      <circle cx="48" cy="52" r="1.8" fill="#fff" opacity=".9"/>
      <path d="M18 92 L30 80 L42 80 M82 92 L70 80 L58 80" stroke="${p.accent}" stroke-width="1" fill="none" opacity=".6"/>`;
  },
  Fiend: (p) => `
    <path d="M34 52 C24 42 13 42 5 48 C11 52 11 58 7 64 C15 62 19 66 21 72 C25 64 31 62 36 64 Z" ${B('opacity=".9"')}/>
    <path d="M66 52 C76 42 87 42 95 48 C89 52 89 58 93 64 C85 62 81 66 79 72 C75 64 69 62 64 64 Z" ${B('opacity=".9"')}/>
    <path d="M38 37 C27 31 21 18 25 5 C30 18 38 24 47 30 Z" ${B()}/>
    <path d="M62 37 C73 31 79 18 75 5 C70 18 62 24 53 30 Z" ${B()}/>
    <path d="M33 44 C33 29 67 29 67 44 L65 60 C63 71 57 79 50 82 C43 79 37 71 35 60 Z" ${B()}/>
    <path d="M38 48 L47 51.5 L39.5 54 Z" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M62 48 L53 51.5 L60.5 54 Z" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M39 63 Q50 72 61 63 Q50 67 39 63 Z" fill="#000"/>
    <path d="M43.5 64.2 l2 4.5 l2 -3.8 Z M52.5 65 l2 3.8 l2 -4.5 Z" fill="#fff"/>
    <path d="M44 38 Q50 42 56 38" stroke="${p.accent}" stroke-width="1" fill="none" opacity=".6"/>`,
  Fairy: (p) => `
    <ellipse cx="33" cy="42" rx="17" ry="9" transform="rotate(-35 33 42)" fill="${p.accent}" opacity=".55" stroke="${p.glow}" stroke-width="1"/>
    <ellipse cx="67" cy="42" rx="17" ry="9" transform="rotate(35 67 42)" fill="${p.accent}" opacity=".55" stroke="${p.glow}" stroke-width="1"/>
    <ellipse cx="37" cy="62" rx="12" ry="6" transform="rotate(30 37 62)" fill="${p.accent}" opacity=".45" stroke="${p.glow}" stroke-width="1"/>
    <ellipse cx="63" cy="62" rx="12" ry="6" transform="rotate(-30 63 62)" fill="${p.accent}" opacity=".45" stroke="${p.glow}" stroke-width="1"/>
    <path d="M33 42 L45 48 M67 42 L55 48" stroke="${p.glow}" stroke-width=".6" opacity=".8"/>
    <path d="M50 35 C46 50 43 72 38 92 L62 92 C57 72 54 50 50 35 Z" ${B()}/>
    <path d="M44 50 Q50 54 56 50" stroke="${p.accent}" stroke-width="1" fill="none"/>
    <circle cx="50" cy="29" r="6.5" ${B()}/>
    <ellipse cx="50" cy="18" rx="10" ry="2.8" fill="none" stroke="${p.eye}" stroke-width="1.8" filter="url(#eyeglow)"/>`,
  'Winged Beast': (p) => {
    const wing = `<path d="M47 41 C36 29 22 25 6 29 L14 34 L5 38 L14 41 L6 46 L15 48 L9 54 L21 53 C31 52 40 50 47 53 Z" ${B()}/>
      <path d="M14 34 L40 44 M14 41 L40 47 M15 48 L40 50" stroke="${p.accent}" stroke-width=".7" opacity=".55"/>`;
    return `${wing}${mirrorX(wing)}
      <path d="M45 71 L40 90 L50 83 L60 90 L55 71 Z" ${B()}/>
      <path d="M50 30 C57 38 57 60 50 75 C43 60 43 38 50 30 Z" ${B()}/>
      <path d="M50 21 C55 21 58 26 56 30 L60 34 L53 33 C50 33 45 30 45 26.5 C45 23 47.5 21 50 21 Z" ${B()}/>
      <circle cx="52" cy="26" r="1.3" fill="${p.eye}" filter="url(#eyeglow)"/>
      <path d="M46 44 Q50 47 54 44 M46 52 Q50 55 54 52" stroke="${p.accent}" stroke-width=".8" fill="none" opacity=".6"/>`;
  },
  Aqua: (p) => `
    <path d="M2 86 Q12 80 22 86 T42 86 T62 86 T82 86 T102 86 L102 102 L2 102 Z" fill="${p.accent}" opacity=".35"/>
    <path d="M-4 92 Q6 86 16 92 T36 92 T56 92 T76 92 T96 92 L102 102 L-4 102 Z" fill="${p.glow}" opacity=".3"/>
    <path d="M50 8 C58 25 73 39 73 58 C73 72 63 83 50 83 C37 83 27 72 27 58 C27 39 42 25 50 8 Z" ${B()}/>
    <path d="M38 52 C38 42 44 33 47 28" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".75"/>
    <path d="M51 70 C60 70 62 59 55 55 C48 51 41 59 48 63 C52 65 55 61 52 59" stroke="${p.accent}" stroke-width="1.6" fill="none"/>
    <circle cx="22" cy="40" r="3" fill="none" stroke="${p.glow}" stroke-width=".9"/><circle cx="80" cy="30" r="4" fill="none" stroke="${p.glow}" stroke-width=".9"/>
    <circle cx="84" cy="52" r="2" fill="none" stroke="${p.glow}" stroke-width=".8"/><circle cx="17" cy="62" r="2.2" fill="none" stroke="${p.glow}" stroke-width=".8"/>`,
  Psychic: (p) => `
    <circle cx="50" cy="52" r="16" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".55"/>
    <circle cx="50" cy="52" r="25" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".38" stroke-dasharray="3 3"/>
    <circle cx="50" cy="52" r="35" fill="none" stroke="${p.accent}" stroke-width=".8" opacity=".25"/>
    <polygon points="${polyPoints(50, 54, 3, 40)}" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity=".7"/>
    <path d="M15 52 Q50 20 85 52 Q50 84 15 52 Z" ${B()}/>
    <circle cx="50" cy="52" r="13" fill="${p.accent}" stroke="LINE" stroke-width="1"/>
    <circle cx="50" cy="52" r="8" fill="${p.eye}" opacity=".8"/>
    <circle cx="50" cy="52" r="5" fill="#000"/>
    <circle cx="47" cy="49" r="2" fill="#fff"/>
    <path d="M20 86 Q28 78 36 86 T52 86 T68 86 T84 86" stroke="${p.glow}" stroke-width="1.2" fill="none" opacity=".7"/>`,
  Rock: (p) => `
    <path d="M10 94 L20 79 L39 76 L50 82 L64 76 L81 79 L90 94 Z" fill="${p.bodyB}" stroke="LINE" stroke-width="1"/>
    <polygon points="30,34 38,44 40,82 25,82 21,46" ${B()}/>
    <polygon points="72,28 80,41 78,82 61,82 63,41" ${B()}/>
    <polygon points="50,8 61,25 59,82 41,82 39,25" ${B()}/>
    <path d="M50 8 L50 82 M30 34 L32 82 M72 28 L70 82" stroke="${p.accent}" stroke-width=".8" opacity=".55"/>
    <path d="M42 28 L46 70" stroke="#fff" stroke-width="1.6" opacity=".45" stroke-linecap="round"/>
    <path d="M64 44 L66 70" stroke="#fff" stroke-width="1.2" opacity=".35" stroke-linecap="round"/>`,
  Thunder: (p) => `
    <circle cx="50" cy="50" r="30" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".5" stroke-dasharray="4 3"/>
    <path d="M30 30 L22 24 L26 20 M74 64 L84 70 L80 76 M70 26 L78 18 M26 70 L18 78" stroke="${p.eye}" stroke-width="1.2" fill="none" filter="url(#eyeglow)"/>
    <path d="M59 5 L29 52 L47 52 L37 95 L73 40 L54 40 L67 5 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M58 12 L36 48 L49 48" stroke="#fff" stroke-width="1.4" fill="none" opacity=".8"/>`,
  Pyro: (p) => `
    <path d="M50 6 C56 23 71 30 73 50 C75 69 64 85 50 89 C36 85 25 70 27 54 C29 42 37 35 40 25 C44 33 46 38 48 40 C48 28 46 17 50 6 Z" ${B()}/>
    <path d="M50 30 C54 42 64 48 64 62 C64 74 57 82 50 83 C43 82 36 75 36 64 C36 55 42 50 44 44 C47 50 48 52 49 54 C49 46 48 38 50 30 Z" fill="${p.accent}" opacity=".9"/>
    <path d="M50 52 C53 60 57 64 57 71 C57 77 54 80 50 80 C46 80 43 77 43 72 C43 66 48 62 50 52 Z" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="26" cy="30" r="1.4" fill="${p.eye}"/><circle cx="76" cy="24" r="1.1" fill="${p.eye}"/><circle cx="82" cy="44" r="1.6" fill="${p.accent}"/>`,
  Insect: (p) => `
    <path d="M33 44 L20 38 L13 29 M31 58 L18 60 L9 55 M33 73 L21 81 L15 90 M67 44 L80 38 L87 29 M69 58 L82 60 L91 55 M67 73 L79 81 L85 90" stroke="LINE" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M44 16 C40 9 34 6 28 7 M56 16 C60 9 66 6 72 7" stroke="LINE" stroke-width="1.2" fill="none"/>
    <path d="M50 34 C64 34 71 48 71 62 C71 78 61 89 50 89 C39 89 29 78 29 62 C29 48 36 34 50 34 Z" ${B()}/>
    <path d="M50 36 L50 89" stroke="LINE" stroke-width="1.4"/>
    <ellipse cx="50" cy="29" rx="12" ry="7" ${B()}/>
    <ellipse cx="50" cy="19" rx="7" ry="5" ${B()}/>
    <path d="M48 15 L50 3 L53 14 Z" ${B()}/>
    <circle cx="46" cy="18" r="1.2" fill="${p.eye}" filter="url(#eyeglow)"/><circle cx="54" cy="18" r="1.2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="40" cy="52" r="3" fill="${p.accent}" opacity=".75"/><circle cx="60" cy="52" r="3" fill="${p.accent}" opacity=".75"/>
    <circle cx="41" cy="70" r="2.4" fill="${p.accent}" opacity=".75"/><circle cx="59" cy="70" r="2.4" fill="${p.accent}" opacity=".75"/>
    <path d="M38 40 C42 37 46 36 48 36" stroke="#fff" stroke-width="1" fill="none" opacity=".5"/>`,
  Beast: (p) => `
    <path d="M50 88 L37 71 L26 61 L22 40 L29 15 L40 33 L50 29 L60 33 L71 15 L78 40 L74 61 L63 71 Z" ${B()}/>
    <path d="M30 21 L36 33 L29 36 Z M70 21 L64 33 L71 36 Z" fill="${p.accent}" opacity=".6"/>
    <path d="M26 60 L17 65 L28 66 M74 60 L83 65 L72 66 M30 50 L20 50 L29 54 M70 50 L80 50 L71 54" stroke="LINE" stroke-width="1.1" fill="none"/>
    <path d="M37 47 L45 50 L38 53 Z" fill="${p.eye}" filter="url(#eyeglow)"/><path d="M63 47 L55 50 L62 53 Z" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M43 59 L57 59 L55 71 L50 76 L45 71 Z" fill="${p.bodyB}" stroke="LINE" stroke-width="1"/>
    <path d="M45.5 60.5 L54.5 60.5 L50 65 Z" fill="#000"/>
    <path d="M50 30 L50 44 M44 36 L50 44 L56 36" stroke="${p.accent}" stroke-width=".8" fill="none" opacity=".55"/>`,
  Reptile: (p) => `
    <path d="M28 84 C8 74 18 50 40 57 C60 63 82 57 74 40 C67 25 44 28 46 42" stroke="LINE" stroke-width="13" fill="none" stroke-linecap="round"/>
    <path d="M28 84 C8 74 18 50 40 57 C60 63 82 57 74 40 C67 25 44 28 46 42" stroke="url(#body)" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M28 84 C8 74 18 50 40 57 C60 63 82 57 74 40 C67 25 44 28 46 42" stroke="${p.accent}" stroke-width="1.6" fill="none" stroke-dasharray="1.5 3" opacity=".7"/>
    <path d="M40 45 C34 38 38 28 48 27 C58 27 60 36 54 44 Z" ${B()}/>
    <ellipse cx="44" cy="35" rx="2.2" ry="1.4" fill="${p.eye}" filter="url(#eyeglow)"/><ellipse cx="53" cy="35" rx="2.2" ry="1.4" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M47 45 L46 51 L44 54 M46 51 L49 54" stroke="#e33" stroke-width="1" fill="none"/>
    <path d="M28 84 L18 92 L30 88 Z" ${B()}/>`,
  'Sea Serpent': (p) => {
    const hump = (d: string) => `<path d="${d}" stroke="LINE" stroke-width="11" fill="none" stroke-linecap="round"/><path d="${d}" stroke="url(#body)" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    return `
      ${hump('M8 76 C13 57 26 57 31 74')}
      ${hump('M40 76 C46 52 60 52 64 74')}
      ${hump('M72 80 C70 58 72 38 82 26')}
      <path d="M17 60 L20 52 L23 60 Z M49 57 L53 47 L56 57 Z M71 52 L66 46 L74 46 Z" ${B()}/>
      <path d="M76 30 C78 20 88 16 96 22 L92 26 L98 30 C92 36 84 36 80 34 Z" ${B()}/>
      <circle cx="86" cy="24" r="1.4" fill="${p.eye}" filter="url(#eyeglow)"/>
      <path d="M78 22 L70 12 L80 18 M82 19 L80 8 L86 17" stroke="LINE" stroke-width="1.4" fill="none"/>
      <path d="M-2 80 Q8 74 18 80 T38 80 T58 80 T78 80 T98 80 L102 102 L-2 102 Z" fill="${p.bg1}" opacity=".85"/>
      <path d="M-2 80 Q8 74 18 80 T38 80 T58 80 T78 80 T98 80" stroke="${p.accent}" stroke-width="1.4" fill="none"/>
      <path d="M-2 90 Q8 84 18 90 T38 90 T58 90 T78 90 T98 90" stroke="${p.glow}" stroke-width="1" fill="none" opacity=".6"/>`;
  },
  Fish: (p) => {
    let scales = '';
    for (let x = 42; x <= 66; x += 7) for (let y = 44; y <= 60; y += 7) scales += `<path d="M${x} ${y} q3 3 0 6" stroke="${p.accent}" stroke-width=".7" fill="none" opacity=".55"/>`;
    return `
      <path d="M75 52 L94 34 L89 52 L94 70 Z" ${B()}/>
      <path d="M40 34 L54 18 L61 36 Z" ${B()}/>
      <path d="M46 70 L52 83 L59 70 Z" ${B()}/>
      <path d="M16 52 C29 29 64 27 79 52 C64 77 29 75 16 52 Z" ${B()}/>
      ${scales}
      <path d="M37 41 Q32 52 37 63" stroke="LINE" stroke-width="1.2" fill="none"/>
      <circle cx="28" cy="48" r="4.2" fill="#fff" stroke="LINE" stroke-width=".8"/><circle cx="27.5" cy="48" r="2.2" fill="#000"/>
      <circle cx="26.8" cy="47" r=".8" fill="#fff"/>
      <path d="M22 40 C30 34 44 32 54 34" stroke="#fff" stroke-width="1.2" fill="none" opacity=".45"/>
      <circle cx="12" cy="40" r="2" fill="none" stroke="${p.glow}" stroke-width=".8"/><circle cx="9" cy="30" r="1.4" fill="none" stroke="${p.glow}" stroke-width=".8"/>`;
  },
  Dinosaur: (p) => `
    <path d="M30 32 L33 22 L38 30 L43 19 L48 29 L54 18 L58 29" ${B()}/>
    <path d="M12 72 C12 50 25 33 46 29 L70 29 C82 29 90 35 93 43 L93 51 L66 53 L91 57 C89 65 81 70 70 70 L45 72 C41 80 37 88 31 94 L16 94 Z" ${B()}/>
    <path d="M68 51.5 L70 55 L72 51.5 L74 55 L76 51.5 L78 55 L80 51.5 L82 55 L84 51.5 L86 55 L88 51.5" stroke="#fff" stroke-width=".9" fill="none"/>
    <path d="M66 53 L93 51" stroke="LINE" stroke-width="1"/>
    <ellipse cx="57" cy="39" rx="3.2" ry="2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M50 35 L62 34" stroke="LINE" stroke-width="1.4"/>
    <circle cx="87" cy="38" r="1.1" fill="LINE"/>
    <path d="M22 60 C30 52 40 50 50 52 M20 70 C30 64 40 62 48 64" stroke="${p.accent}" stroke-width=".9" fill="none" opacity=".55"/>`,
  'Divine-Beast': (p) => {
    let rays = '';
    for (let i = 0; i < 16; i++) rays += `<path d="M50 50 L${(50 + 46 * Math.cos((i * Math.PI) / 8)).toFixed(1)} ${(50 + 46 * Math.sin((i * Math.PI) / 8)).toFixed(1)}" stroke="${p.glow}" stroke-width="${i % 2 ? 0.6 : 1.4}" opacity=".6"/>`;
    const wing = `<path d="M36 52 C26 38 14 34 2 36 L9 41 L1 46 L10 48 L3 54 L13 55 C22 56 30 56 36 58 Z" ${B()}/>`;
    return `${rays}${wing}${mirrorX(wing)}<circle cx="50" cy="52" r="17" fill="url(#gold)" stroke="LINE" stroke-width="1.4"/><circle cx="50" cy="52" r="10" fill="${p.eye}" filter="url(#eyeglow)"/>`;
  },
};

// ------------------------------------------------------------ spell / trap motifs
const MOTIFS: Record<string, Emblem> = {
  book: (p) => `
    <path d="M12 72 L50 80 L88 72 L88 38 L50 46 L12 38 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M16 68 L50 75 L84 68 L84 36 L50 43 L16 36 Z" fill="#fdf6e0" stroke="LINE" stroke-width=".8"/>
    <path d="M50 43 L50 75" stroke="LINE" stroke-width="1"/>
    <path d="M22 44 L44 49 M22 50 L44 55 M22 56 L44 61 M56 49 L78 44 M56 55 L78 50 M56 61 L78 56" stroke="${p.bg1}" stroke-width=".8" opacity=".55"/>
    <polygon points="${starPoints(50, 24, 4, 13, 3)}" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="50" cy="24" r="8" fill="none" stroke="${p.glow}" stroke-width=".8"/>`,
  bolt: (p) => `
    <circle cx="50" cy="50" r="34" fill="none" stroke="${p.accent}" stroke-width="2.2" stroke-dasharray="18 7" opacity=".85"/>
    <circle cx="50" cy="50" r="27" fill="none" stroke="${p.glow}" stroke-width=".8" opacity=".6"/>
    <path d="M56 12 L34 52 L48 52 L40 88 L68 44 L54 44 L64 12 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M55 18 L38 48 L49 48" stroke="#fff" stroke-width="1.2" fill="none" opacity=".8"/>`,
  infinity: (p) => `
    <path d="M50 50 C40 34 16 34 16 50 C16 66 40 66 50 50 C60 34 84 34 84 50 C84 66 60 66 50 50 Z" fill="none" stroke="LINE" stroke-width="10"/>
    <path d="M50 50 C40 34 16 34 16 50 C16 66 40 66 50 50 C60 34 84 34 84 50 C84 66 60 66 50 50 Z" fill="none" stroke="url(#gold)" stroke-width="7"/>
    <path d="M50 50 C40 34 16 34 16 50 C16 66 40 66 50 50 C60 34 84 34 84 50 C84 66 60 66 50 50 Z" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="${p.glow}" stroke-width=".8" stroke-dasharray="1 4"/>`,
  sword: (p) => `
    <path d="M50 4 L55 13 L55 66 L45 66 L45 13 Z" fill="url(#steel)" stroke="LINE" stroke-width="1.2"/>
    <path d="M50 8 L50 64" stroke="#fff" stroke-width=".9" opacity=".8"/>
    <path d="M32 66 C38 62 62 62 68 66 L66 71 L34 71 Z" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <rect x="47.5" y="71" width="5" height="16" fill="#6a3a1a" stroke="LINE" stroke-width=".7"/>
    <circle cx="50" cy="90" r="4" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <circle cx="50" cy="68.5" r="2.2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M24 40 L34 40 M29 35 L29 45 M70 26 L78 26 M74 22 L74 30" stroke="${p.eye}" stroke-width="2" filter="url(#eyeglow)"/>`,
  landscape: (p, r) => `
    <circle cx="${r.range(30, 70).toFixed(1)}" cy="30" r="11" fill="${p.eye}" filter="url(#eyeglow)" opacity=".95"/>
    <path d="M0 70 L18 46 L30 58 L46 30 L62 56 L74 42 L100 70 L100 100 L0 100 Z" fill="url(#body)" stroke="LINE" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M46 30 L40 42 L46 40 L50 46 L54 38 Z M18 46 L14 54 L20 52 Z M74 42 L70 50 L76 48 Z" fill="#fff" opacity=".7"/>
    <path d="M0 80 Q25 72 50 80 T100 80 L100 100 L0 100 Z" fill="${p.bodyB}" opacity=".9"/>
    <path d="M0 88 Q25 82 50 88 T100 88" stroke="${p.accent}" stroke-width=".8" fill="none" opacity=".6"/>`,
  altar: (p) => `
    <path d="M20 92 L80 92 L76 84 L24 84 Z M28 84 L72 84 L68 76 L32 76 Z" fill="url(#body)" stroke="LINE" stroke-width="1"/>
    <rect x="38" y="52" width="24" height="24" fill="url(#body)" stroke="LINE" stroke-width="1"/>
    <path d="M42 56 L58 56 M42 60 L58 60" stroke="${p.accent}" stroke-width=".8" opacity=".6"/>
    <path d="M34 50 L66 50 L64 54 L36 54 Z" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <path d="M50 10 C55 22 64 27 64 38 C64 46 57 50 50 50 C43 50 36 46 36 38 C36 31 41 28 43 22 C45 28 47 30 48 31 C48 24 47 17 50 10 Z" fill="${p.eye}" filter="url(#eyeglow)" opacity=".95"/>
    <path d="M50 26 C53 33 57 36 57 41 C57 45 54 48 50 48 C46 48 43 45 43 41 C43 37 48 33 50 26 Z" fill="#fff" opacity=".8"/>`,
  jaws: (p) => {
    let teeth = '';
    for (let i = 0; i < 7; i++) {
      const x = 22 + i * 9.4;
      teeth += `<path d="M${x - 4} 48 L${x} 36 L${x + 4} 48 Z" fill="url(#steel)" stroke="LINE" stroke-width=".7"/>`;
      teeth += `<path d="M${x - 4 + 4.7} 56 L${x + 4.7} 68 L${x + 4 + 4.7} 56 Z" fill="url(#steel)" stroke="LINE" stroke-width=".7"/>`;
    }
    return `
      <path d="M14 48 C14 24 86 24 86 48 Z" fill="none" stroke="url(#body)" stroke-width="5"/>
      <path d="M14 56 C14 80 86 80 86 56 Z" fill="none" stroke="url(#body)" stroke-width="5"/>
      <path d="M14 48 C14 24 86 24 86 48 M14 56 C14 80 86 80 86 56" fill="none" stroke="LINE" stroke-width="1"/>
      ${teeth}
      <circle cx="12" cy="52" r="5" fill="url(#gold)" stroke="LINE" stroke-width="1"/><circle cx="88" cy="52" r="5" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
      <path d="M50 78 L50 94 M44 94 L56 94" stroke="LINE" stroke-width="2"/>`;
  },
  counter: (p) => `
    <path d="M50 14 A36 36 0 1 1 18 32" fill="none" stroke="url(#gold)" stroke-width="5" stroke-linecap="round"/>
    <path d="M10 22 L22 36 L26 22 Z" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <path d="M30 30 L70 30 L70 50 C70 64 60 74 50 80 C40 74 30 64 30 50 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3"/>
    <rect x="47" y="38" width="6" height="22" rx="2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="50" cy="67" r="3.4" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  vortex: (p) => {
    let arms = '';
    for (let i = 0; i < 5; i++) arms += `<path d="M50 52 C56 40 74 40 78 52 C82 66 64 84 46 80" fill="none" stroke="${i % 2 ? p.accent : p.glow}" stroke-width="${2.6 - i * 0.3}" opacity="${0.9 - i * 0.12}" transform="rotate(${i * 72} 50 52)"/>`;
    return `<circle cx="50" cy="52" r="36" fill="url(#body)" opacity=".55"/>${arms}<circle cx="50" cy="52" r="9" fill="#000"/><circle cx="50" cy="52" r="12" fill="none" stroke="${p.eye}" stroke-width="1.2" filter="url(#eyeglow)"/>`;
  },
  ankh: (p) => `
    <circle cx="50" cy="50" r="38" fill="none" stroke="${p.glow}" stroke-width=".8" opacity=".7"/>
    <ellipse cx="50" cy="28" rx="11" ry="14" fill="none" stroke="LINE" stroke-width="9"/>
    <ellipse cx="50" cy="28" rx="11" ry="14" fill="none" stroke="url(#gold)" stroke-width="6.5"/>
    <path d="M26 44 L74 44 L74 51 L26 51 Z M46.5 44 L53.5 44 L55 92 L45 92 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="50" cy="47.5" r="2.4" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  crescent: (p) => `
    <circle cx="50" cy="50" r="31" fill="${p.glow}" opacity=".15"/>
    <path d="M60 16 A34 34 0 1 0 60 84 A27 27 0 1 1 60 16 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.2"/>
    <polygon points="${starPoints(70, 34, 4, 6, 1.5)}" fill="${p.eye}" filter="url(#eyeglow)"/>
    <polygon points="${starPoints(78, 60, 4, 4, 1)}" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="36" cy="40" r="3" fill="${p.bg1}" opacity=".5"/><circle cx="32" cy="58" r="4" fill="${p.bg1}" opacity=".4"/>`,
  tornado: (p) => {
    let rings = '';
    for (let i = 0; i < 7; i++) {
      const y = 18 + i * 10;
      const rx = 34 - i * 4.3;
      rings += `<ellipse cx="${50 + Math.sin(i) * 4}" cy="${y}" rx="${rx}" ry="${4.5 - i * 0.3}" fill="none" stroke="${i % 2 ? p.accent : p.glow}" stroke-width="${3 - i * 0.25}"/>`;
    }
    return `<path d="M14 18 C30 30 40 60 48 90 L52 90 C58 60 70 30 86 18 Z" fill="url(#body)" opacity=".55"/>${rings}
      <path d="M12 40 L22 44 M80 30 L90 26 M18 66 L26 64 M76 62 L86 66" stroke="${p.glow}" stroke-width="1.2" opacity=".8"/>`;
  },
  shards: (p, r) => {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const cx = r.range(18, 82);
      const cy = r.range(16, 86);
      const a = r.range(0, 360);
      const sz = r.range(6, 14);
      s += `<polygon points="${cx},${cy - sz} ${cx + sz * 0.6},${cy + sz * 0.4} ${cx - sz * 0.5},${cy + sz * 0.7}" transform="rotate(${a.toFixed(0)} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="url(#steel)" stroke="${p.glow}" stroke-width=".8" opacity=".9"/>`;
    }
    return `<path d="M30 20 L70 20 L78 50 L70 82 L30 82 L22 50 Z" fill="url(#steel)" stroke="LINE" stroke-width="1.2" opacity=".85"/>
      <path d="M50 50 L30 20 M50 50 L78 50 M50 50 L44 82 M50 50 L22 44 M50 50 L66 24 M50 50 L70 78" stroke="LINE" stroke-width=".9"/>
      ${s}<circle cx="50" cy="50" r="5" fill="${p.eye}" filter="url(#eyeglow)"/>`;
  },
  jar: (p) => `
    <path d="M38 14 L62 14 L60 24 C76 30 80 46 78 60 C76 76 64 90 50 90 C36 90 24 76 22 60 C20 46 24 30 40 24 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3"/>
    <rect x="34" y="10" width="32" height="6" rx="2" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <path d="M28 46 C40 50 60 50 72 46 M26 62 C40 66 60 66 74 62" stroke="url(#gold)" stroke-width="2.2" fill="none"/>
    <path d="M40 54 Q50 60 60 54 Q50 56 40 54 Z" fill="#000" opacity=".8"/>
    <circle cx="42" cy="52" r="2" fill="${p.eye}" filter="url(#eyeglow)"/><circle cx="58" cy="52" r="2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M32 34 C30 42 30 50 32 56" stroke="#fff" stroke-width="2" fill="none" opacity=".45" stroke-linecap="round"/>`,
  eye: (p) => RACE_EMBLEMS.Psychic(p, new Rand(1)),
  chains: (p) => {
    let links = '';
    for (let i = 0; i < 6; i++) {
      const cx = 14 + i * 14.4;
      const cy = 50 + (i % 2 ? 4 : -4);
      links += `<ellipse cx="${cx}" cy="${cy}" rx="10" ry="6" transform="rotate(${i % 2 ? 25 : -25} ${cx} ${cy})" fill="none" stroke="LINE" stroke-width="5"/>
        <ellipse cx="${cx}" cy="${cy}" rx="10" ry="6" transform="rotate(${i % 2 ? 25 : -25} ${cx} ${cy})" fill="none" stroke="url(#steel)" stroke-width="3"/>`;
    }
    return `<circle cx="50" cy="50" r="22" fill="url(#body)" stroke="LINE" stroke-width="1.2"/>
      <path d="M44 48 L44 42 C44 36 56 36 56 42 L56 48" fill="none" stroke="url(#gold)" stroke-width="3"/>
      <rect x="41" y="47" width="18" height="14" rx="2" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
      <circle cx="50" cy="53" r="2" fill="LINE"/>${links}`;
  },
  scales: (p) => `
    <path d="M50 12 L50 84 M30 90 L70 90 L64 84 L36 84 Z" stroke="url(#gold)" stroke-width="4" fill="url(#gold)"/>
    <path d="M16 30 L84 30" stroke="url(#gold)" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="50" cy="14" r="4" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <path d="M18 30 L8 56 M18 30 L28 56 M82 30 L72 56 M82 30 L92 56" stroke="LINE" stroke-width=".9"/>
    <path d="M6 56 Q18 66 30 56 Z M70 56 Q82 66 94 56 Z" fill="url(#body)" stroke="LINE" stroke-width="1"/>
    <circle cx="50" cy="48" r="5" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  crown: (p) => `
    <path d="M16 72 L12 30 L32 50 L50 20 L68 50 L88 30 L84 72 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="16" y="72" width="68" height="12" rx="2" fill="url(#gold)" stroke="LINE" stroke-width="1.2"/>
    <circle cx="12" cy="28" r="3.5" fill="${p.eye}" stroke="LINE" stroke-width=".7"/><circle cx="50" cy="18" r="4" fill="${p.eye}" stroke="LINE" stroke-width=".7"/><circle cx="88" cy="28" r="3.5" fill="${p.eye}" stroke="LINE" stroke-width=".7"/>
    <circle cx="34" cy="78" r="3" fill="${p.bodyA}" stroke="LINE" stroke-width=".6"/><circle cx="50" cy="78" r="3.4" fill="#d22" stroke="LINE" stroke-width=".6"/><circle cx="66" cy="78" r="3" fill="${p.bodyA}" stroke="LINE" stroke-width=".6"/>
    <path d="M24 64 L76 64" stroke="#fff" stroke-width="1" opacity=".5"/>`,
  sheep: (p) => {
    let wool = '';
    const pts = [[34, 50], [44, 42], [56, 42], [66, 50], [68, 62], [56, 70], [44, 70], [32, 62], [50, 56]];
    for (const [x, y] of pts) wool += `<circle cx="${x}" cy="${y}" r="10" fill="#f6f3ea" stroke="LINE" stroke-width="1"/>`;
    return `<path d="M38 70 L38 86 M46 72 L46 88 M56 72 L56 88 M64 70 L64 86" stroke="LINE" stroke-width="3.4" stroke-linecap="round"/>
      ${wool}
      <ellipse cx="74" cy="44" rx="8" ry="10" fill="#3a2f2a" stroke="LINE" stroke-width="1"/>
      <path d="M68 38 C62 32 64 26 70 28 M80 38 C86 32 84 26 78 28" stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="71" cy="43" r="1.3" fill="#fff"/><circle cx="77" cy="43" r="1.3" fill="#fff"/>`;
  },
  gear: (p, r) => RACE_EMBLEMS.Machine(p, r),
  shield: (p) => `
    <circle cx="50" cy="52" r="40" fill="none" stroke="${p.glow}" stroke-width="1" opacity=".6" stroke-dasharray="2 3"/>
    <path d="M24 22 L76 22 L76 48 C76 68 64 82 50 90 C36 82 24 68 24 48 Z" fill="url(#body)" stroke="LINE" stroke-width="1.5"/>
    <path d="M29 27 L71 27 L71 48 C71 65 61 77 50 84 C39 77 29 65 29 48 Z" fill="none" stroke="url(#gold)" stroke-width="2"/>
    <path d="M50 30 L50 80 M32 46 L68 46" stroke="url(#gold)" stroke-width="3"/>
    <path d="M30 26 L50 26" stroke="#fff" stroke-width="1" opacity=".5"/>`,
  flame: (p, r) => RACE_EMBLEMS.Pyro(p, r),
  skull: (p, r) => RACE_EMBLEMS.Zombie(p, r),
  cards: (p) => `
    <g transform="rotate(-18 50 60)"><rect x="30" y="26" width="34" height="48" rx="3" fill="url(#body)" stroke="LINE" stroke-width="1.2"/></g>
    <g transform="rotate(0 50 60)"><rect x="33" y="22" width="34" height="48" rx="3" fill="url(#body)" stroke="LINE" stroke-width="1.2"/></g>
    <g transform="rotate(18 50 60)"><rect x="36" y="26" width="34" height="48" rx="3" fill="url(#body)" stroke="LINE" stroke-width="1.2"/>
      <rect x="40" y="31" width="26" height="22" fill="${p.bg1}" stroke="LINE" stroke-width=".6"/>
      <polygon points="${starPoints(53, 42, 5, 7, 3)}" fill="${p.eye}"/></g>
    <polygon points="${starPoints(20, 24, 4, 7, 1.6)}" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  hand: (p) => `
    <path d="M36 92 L36 60 L30 44 C28 40 34 37 36 41 L40 50 L40 22 C40 17 47 17 47 22 L47 46 L49 16 C49 11 56 11 56 16 L56 46 L58 20 C58 15 65 15 65 20 L65 50 L67 30 C67 25 74 25 74 30 L72 64 C71 76 66 84 64 92 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3" stroke-linejoin="round"/>
    <circle cx="54" cy="66" r="7" fill="${p.eye}" filter="url(#eyeglow)" opacity=".85"/>
    <circle cx="54" cy="66" r="11" fill="none" stroke="${p.glow}" stroke-width=".8"/>`,
  star: (p) => `
    <polygon points="${starPoints(50, 50, 8, 40, 14)}" fill="${p.glow}" opacity=".3"/>
    <polygon points="${starPoints(50, 50, 5, 32, 13)}" fill="url(#gold)" stroke="LINE" stroke-width="1.3" stroke-linejoin="round"/>
    <circle cx="50" cy="52" r="6" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  heart: (p) => `
    <path d="M50 86 C20 64 12 46 18 32 C24 20 42 18 50 34 C58 18 76 20 82 32 C88 46 80 64 50 86 Z" fill="url(#body)" stroke="LINE" stroke-width="1.4"/>
    <path d="M28 34 C30 28 36 26 40 28" stroke="#fff" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round"/>
    <circle cx="50" cy="54" r="6" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  coffin: (p) => `
    <path d="M38 8 L62 8 L72 30 L62 92 L38 92 L28 30 Z" fill="url(#body)" stroke="LINE" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M50 26 L50 64 M40 38 L60 38" stroke="url(#gold)" stroke-width="4"/>
    <path d="M40 12 L60 12 L68 30 L60 88 L40 88 L32 30 Z" fill="none" stroke="${p.accent}" stroke-width=".8" opacity=".6"/>
    <circle cx="50" cy="38" r="3" fill="${p.eye}" filter="url(#eyeglow)"/>`,
  explosion: (p) => `
    <polygon points="${starPoints(50, 52, 12, 40, 18, -75)}" fill="url(#gold)" stroke="LINE" stroke-width="1.2" stroke-linejoin="round"/>
    <polygon points="${starPoints(50, 52, 9, 24, 11, -60)}" fill="${p.eye}" filter="url(#eyeglow)"/>
    <circle cx="50" cy="52" r="7" fill="#fff"/>`,
  arrows: (p) => `
    <path d="M50 14 L66 34 L56 34 L56 50 L44 50 L44 34 L34 34 Z" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <path d="M50 90 L34 70 L44 70 L44 56 L56 56 L56 70 L66 70 Z" fill="url(#body)" stroke="LINE" stroke-width="1"/>
    <circle cx="50" cy="53" r="30" fill="none" stroke="${p.glow}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`,
  orb: (p) => `
    <path d="M30 88 L70 88 L64 78 L36 78 Z" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <path d="M38 78 C34 74 36 70 40 70 L60 70 C64 70 66 74 62 78 Z" fill="url(#body)" stroke="LINE" stroke-width="1"/>
    <circle cx="50" cy="44" r="27" fill="url(#body)" stroke="LINE" stroke-width="1.3" opacity=".9"/>
    <circle cx="50" cy="44" r="21" fill="${p.glow}" opacity=".25"/>
    <path d="M38 44 C42 34 58 34 62 44 C58 54 42 54 38 44 Z" fill="none" stroke="${p.eye}" stroke-width="1.4" filter="url(#eyeglow)"/>
    <circle cx="50" cy="44" r="4" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M34 34 C36 26 42 22 48 21" stroke="#fff" stroke-width="2.4" fill="none" opacity=".6" stroke-linecap="round"/>`,
  scroll: (p) => `
    <path d="M24 22 L76 22 L76 80 L24 80 Z" fill="#f6ecd0" stroke="LINE" stroke-width="1.2"/>
    <path d="M20 18 C14 18 14 28 20 28 L80 28 C86 28 86 18 80 18 Z M20 74 C14 74 14 84 20 84 L80 84 C86 84 86 74 80 74 Z" fill="url(#body)" stroke="LINE" stroke-width="1.2"/>
    <circle cx="50" cy="51" r="15" fill="none" stroke="${p.bg1}" stroke-width="1.4"/>
    <polygon points="${starPoints(50, 51, 6, 14, 7)}" fill="none" stroke="${p.bg1}" stroke-width="1"/>
    <circle cx="50" cy="51" r="4" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M30 36 L44 36 M56 36 L70 36 M30 68 L44 68 M56 68 L70 68" stroke="${p.bg1}" stroke-width="1" opacity=".6"/>`,
  potion: (p) => `
    <rect x="43" y="10" width="14" height="8" rx="2" fill="#8a5a2a" stroke="LINE" stroke-width="1"/>
    <path d="M44 18 L56 18 L56 34 C70 40 76 52 74 66 C72 80 62 90 50 90 C38 90 28 80 26 66 C24 52 30 40 44 34 Z" fill="${p.glow}" fill-opacity=".25" stroke="LINE" stroke-width="1.4"/>
    <path d="M28 62 C36 58 64 58 72 62 C72 78 62 88 50 88 C38 88 28 78 28 62 Z" fill="url(#body)"/>
    <circle cx="40" cy="72" r="3" fill="${p.eye}" opacity=".8"/><circle cx="56" cy="68" r="2" fill="${p.eye}" opacity=".8"/><circle cx="50" cy="78" r="2.4" fill="${p.eye}" opacity=".8"/>
    <path d="M34 50 C34 44 38 40 42 38" stroke="#fff" stroke-width="2.4" fill="none" opacity=".6" stroke-linecap="round"/>`,
  key: (p) => `
    <circle cx="50" cy="28" r="16" fill="none" stroke="LINE" stroke-width="9"/>
    <circle cx="50" cy="28" r="16" fill="none" stroke="url(#gold)" stroke-width="6.5"/>
    <polygon points="${starPoints(50, 28, 4, 8, 3)}" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M46 43 L54 43 L54 92 L46 92 Z M54 70 L64 70 L64 76 L54 76 Z M54 82 L68 82 L68 88 L54 88 Z" fill="url(#gold)" stroke="LINE" stroke-width="1.2" stroke-linejoin="round"/>`,
  hourglass: (p) => `
    <rect x="26" y="10" width="48" height="7" rx="2" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <rect x="26" y="83" width="48" height="7" rx="2" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <path d="M32 17 L68 17 C68 34 54 42 54 50 C54 58 68 66 68 83 L32 83 C32 66 46 58 46 50 C46 42 32 34 32 17 Z" fill="${p.glow}" fill-opacity=".2" stroke="LINE" stroke-width="1.3"/>
    <path d="M38 26 L62 26 C60 34 52 40 50 46 C48 40 40 34 38 26 Z M36 80 L64 80 C62 70 54 66 50 64 C46 66 38 70 36 80 Z" fill="url(#body)"/>
    <path d="M50 46 L50 70" stroke="${p.eye}" stroke-width="1.2" stroke-dasharray="1.5 2"/>`,
  feather: (p) => {
    let barbs = '';
    for (let i = 0; i < 9; i++) {
      const y = 22 + i * 7;
      barbs += `<path d="M${50 + i * 0.6} ${y} C${36 - i * 0.2} ${y + 2} ${30} ${y + 8} ${28 + i} ${y + 12}" stroke="${p.accent}" stroke-width=".8" fill="none" opacity=".7"/>`;
    }
    return `<path d="M50 8 C70 20 74 50 62 76 C58 84 52 88 46 90 C34 76 30 50 50 8 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3"/>
      <path d="M50 10 C54 40 52 70 40 96" stroke="url(#gold)" stroke-width="2.2" fill="none"/>${barbs}
      <path d="M20 30 L30 34 M16 50 L28 52 M74 22 L84 18" stroke="${p.glow}" stroke-width="1.4" opacity=".7"/>`;
  },
  mask: (p) => `
    <path d="M18 34 C30 26 70 26 82 34 C84 56 72 82 50 88 C28 82 16 56 18 34 Z" fill="url(#body)" stroke="LINE" stroke-width="1.4"/>
    <path d="M28 46 C32 40 42 40 45 48 C40 52 32 52 28 46 Z M72 46 C68 40 58 40 55 48 C60 52 68 52 72 46 Z" fill="#000"/>
    <circle cx="37" cy="47" r="2" fill="${p.eye}" filter="url(#eyeglow)"/><circle cx="63" cy="47" r="2" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M38 68 Q50 76 62 68" stroke="LINE" stroke-width="2" fill="none"/>
    <path d="M50 30 L50 40 M24 36 L34 40 M76 36 L66 40" stroke="url(#gold)" stroke-width="2"/>`,
  tower: (p) => `
    <path d="M36 92 L40 36 L60 36 L64 92 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3"/>
    <path d="M34 36 L34 26 L39 26 L39 30 L45 30 L45 26 L55 26 L55 30 L61 30 L61 26 L66 26 L66 36 Z" fill="url(#body)" stroke="LINE" stroke-width="1.2"/>
    <path d="M46 92 L46 78 C46 72 54 72 54 78 L54 92 Z" fill="#000" opacity=".8"/>
    <rect x="47" y="46" width="6" height="10" rx="3" fill="${p.eye}" filter="url(#eyeglow)"/>
    <path d="M50 26 L50 10 L62 14 L50 18" fill="url(#gold)" stroke="LINE" stroke-width=".8"/>
    <path d="M40 60 L60 60 M39 74 L61 74" stroke="${p.accent}" stroke-width=".8" opacity=".6"/>`,
  quake: (p) => `
    <path d="M0 58 L100 58 L100 100 L0 100 Z" fill="url(#body)" stroke="LINE" stroke-width="1.2"/>
    <path d="M44 58 L52 70 L46 78 L56 90 L52 100 L62 100 L64 88 L56 78 L62 68 L54 58 Z" fill="#000" opacity=".85"/>
    <path d="M10 58 L18 46 L26 54 L34 40 L42 52 L50 44 L58 54 L66 38 L76 50 L86 44 L92 58 Z" fill="url(#body)" opacity=".8" stroke="LINE" stroke-width="1"/>
    <path d="M52 70 L46 78 L56 90" stroke="${p.eye}" stroke-width="1.4" fill="none" filter="url(#eyeglow)"/>
    <path d="M22 30 l4 -6 l4 6 M70 22 l3 -5 l3 5 M40 24 l2 -4 l2 4" stroke="${p.glow}" stroke-width="1.2" fill="none"/>`,
  cloudstorm: (p) => `
    <path d="M20 46 C12 46 10 34 20 32 C20 20 36 16 42 24 C46 12 66 12 68 26 C80 24 88 34 82 44 C88 50 82 58 74 56 L26 56 C16 58 12 48 20 46 Z" fill="url(#body)" stroke="LINE" stroke-width="1.3"/>
    <path d="M30 30 C34 26 40 26 42 28" stroke="#fff" stroke-width="1.6" fill="none" opacity=".45"/>
    <path d="M48 56 L38 76 L48 76 L42 94 L62 70 L52 70 L58 56 Z" fill="url(#gold)" stroke="LINE" stroke-width="1"/>
    <path d="M26 62 L22 72 M32 64 L28 74 M70 62 L66 72 M76 60 L72 70 M80 66 L76 76" stroke="${p.glow}" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`,
  sigil: (p, r) => {
    const n = r.pick([5, 6, 7, 8]);
    return `<circle cx="50" cy="50" r="38" fill="none" stroke="url(#gold)" stroke-width="2"/>
      <circle cx="50" cy="50" r="32" fill="url(#body)" opacity=".55" stroke="LINE" stroke-width="1"/>
      <polygon points="${starPoints(50, 50, n, 32, 13, -90 + r.range(0, 20))}" fill="none" stroke="${p.eye}" stroke-width="1.6" filter="url(#eyeglow)"/>
      <polygon points="${polyPoints(50, 50, n, 18)}" fill="none" stroke="${p.accent}" stroke-width="1"/>
      <circle cx="50" cy="50" r="6" fill="${p.eye}" filter="url(#eyeglow)"/>`;
  },
};

const MOTIF_RULES: [RegExp, string][] = [
  [/sheep|goat|lamb/, 'sheep'],
  [/hole|vortex|void|abyss|dimension/, 'vortex'],
  [/reborn|revive|resurrect|premature|haunted|rebirth|reincarnation|zombie/, 'ankh'],
  [/moon|night|eclipse/, 'crescent'],
  [/storm|tempest|thunder|lightning|spark/, 'cloudstorm'],
  [/typhoon|cyclone|tornado|wind|gust|whirl/, 'tornado'],
  [/mirror|force|shatter|crystal|prism/, 'shards'],
  [/pot |pot$|jar|greed|avarice|urn/, 'jar'],
  [/brain|mind|eye|vision|psych|insight|peek|forceful/, 'eye'],
  [/chain|bind|gravity|prison|lock|shackle|seal|jail/, 'chains'],
  [/judg|solemn|law|justice|trial|verdict/, 'scales'],
  [/royal|oppression|king|queen|crown|throne|monarch|emperor|decree/, 'crown'],
  [/limiter|machine|gear|factory|cyber|mechan/, 'gear'],
  [/shield|wall|barrier|protect|guard|waboku|sakuretsu|armor/, 'shield'],
  [/fire|burn|blast|inferno|flame|lava|magma|ring of/, 'flame'],
  [/death|doom|kill|destruct|soul|ghost|skull|bury|deck devastation/, 'skull'],
  [/sarcophag|coffin|burial|tomb|crypt|grave/, 'coffin'],
  [/draw|allure|trade|charity|upstart|card of|hand destruction/, 'cards'],
  [/hand|grab|snatch|steal|thief|control|delinquent|confiscat/, 'hand'],
  [/star|light|shine|sun|ray|solar/, 'star'],
  [/heart|love|life|heal|recover|gift|blessing/, 'heart'],
  [/bomb|explos|blow|smash|torrential|raigeki|crush|trunade/, 'explosion'],
  [/sword|blade|saber|axe|lance|spear|weapon|fang/, 'sword'],
  [/swap|switch|change|book|transfer|exchange|reproduction/, 'arrows'],
  [/feather|duster|wing|sky/, 'feather'],
  [/fissure|quake|ground|earth|rift|crack/, 'quake'],
  [/time|hour|clock|turn|stall|delay/, 'hourglass'],
  [/key|unlock|gate|door/, 'key'],
  [/potion|elixir|poison|venom|cure/, 'potion'],
  [/mask|disguise|illusion|trick|fake|ruse/, 'mask'],
  [/tower|castle|fortress|temple|citadel|sanctuary/, 'tower'],
  [/scroll|ritual|rite|spell|magic|excavation|planter/, 'scroll'],
  [/orb|ball|sphere|prophecy|fortune|future/, 'orb'],
];

const FALLBACK_POOLS: Record<string, string[]> = {
  normal: ['book', 'orb', 'scroll', 'sigil', 'cards', 'potion', 'star'],
  quickplay: ['bolt', 'sigil', 'feather', 'bolt', 'explosion'],
  continuous: ['infinity', 'tower', 'sigil', 'hourglass'],
  equip: ['sword', 'shield', 'sword'],
  field: ['landscape'],
  ritual: ['altar'],
  tnormal: ['jaws', 'mask', 'sigil', 'jaws', 'key'],
  tcontinuous: ['chains', 'infinity', 'hourglass', 'tower'],
  counter: ['counter', 'shield', 'counter'],
};

function motifFor(data: CardData, r: Rand): string {
  const n = data.name.toLowerCase();
  if (data.kind === 'spell' && data.stype === 'field') return 'landscape';
  if (data.kind === 'spell' && data.stype === 'ritual') return 'altar';
  for (const [re, m] of MOTIF_RULES) if (re.test(n)) return m;
  if (data.kind === 'spell') return r.pick(FALLBACK_POOLS[data.stype ?? 'normal'] ?? FALLBACK_POOLS.normal);
  if (data.kind === 'trap') return r.pick(FALLBACK_POOLS[data.ttype === 'counter' ? 'counter' : data.ttype === 'continuous' ? 'tcontinuous' : 'tnormal']);
  return 'star';
}

// ------------------------------------------------------------ backgrounds
type Pattern = (p: ArtPalette, r: Rand) => string;

const PATTERNS: Record<string, Pattern> = {
  rays: (p, r) => {
    const n = r.pick([12, 16, 20, 24]);
    let s = '';
    const cx = 50;
    const cy = r.range(40, 60);
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      s += `<path d="M${cx} ${cy} L${(cx + 90 * Math.cos(a0)).toFixed(1)} ${(cy + 90 * Math.sin(a0)).toFixed(1)} L${(cx + 90 * Math.cos(a1)).toFixed(1)} ${(cy + 90 * Math.sin(a1)).toFixed(1)} Z"/>`;
    }
    return `<g fill="${p.glow}" opacity=".13">${s}</g>`;
  },
  rings: (p, r) => {
    let s = '';
    const cx = r.range(35, 65);
    const cy = r.range(35, 65);
    for (let i = 1; i < 9; i++) s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${i * 8}" stroke-width="${i % 3 === 0 ? 1.4 : 0.6}"/>`;
    return `<g fill="none" stroke="${p.glow}" opacity=".22">${s}</g>`;
  },
  hex: (p) => {
    let s = '';
    for (let y = 0; y < 112; y += 13) for (let x = (y / 13) % 2 ? 7.5 : 0; x < 110; x += 15) s += `<polygon points="${polyPoints(x, y, 6, 7, 0)}"/>`;
    return `<g fill="none" stroke="${p.glow}" stroke-width=".6" opacity=".2">${s}</g>`;
  },
  stars: (p, r) => {
    let s = '';
    for (let i = 0; i < 40; i++) s += `<circle cx="${r.range(0, 100).toFixed(1)}" cy="${r.range(0, 100).toFixed(1)}" r="${r.range(0.2, 0.9).toFixed(2)}" opacity="${r.range(0.3, 1).toFixed(2)}"/>`;
    return `<g fill="${p.glow}">${s}</g>`;
  },
  waves: (p, r) => {
    let s = '';
    const amp = r.range(2, 5);
    for (let y = 8; y < 104; y += 9) s += `<path d="M-5 ${y} Q7 ${y - amp} 20 ${y} T45 ${y} T70 ${y} T95 ${y} T120 ${y}"/>`;
    return `<g fill="none" stroke="${p.glow}" stroke-width=".8" opacity=".18">${s}</g>`;
  },
  shards: (p, r) => {
    let s = '';
    for (let i = 0; i < 14; i++) {
      const x = r.range(-10, 100);
      const y = r.range(-10, 100);
      s += `<polygon points="${x.toFixed(1)},${y.toFixed(1)} ${(x + r.range(8, 26)).toFixed(1)},${(y + r.range(-6, 14)).toFixed(1)} ${(x + r.range(-4, 14)).toFixed(1)},${(y + r.range(10, 28)).toFixed(1)}" opacity="${r.range(0.05, 0.2).toFixed(2)}"/>`;
    }
    return `<g fill="${p.glow}">${s}</g>`;
  },
  circle: (p, r) => {
    let ticks = '';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      ticks += `<line x1="${(50 + 40 * Math.cos(a)).toFixed(1)}" y1="${(52 + 40 * Math.sin(a)).toFixed(1)}" x2="${(50 + (i % 3 ? 43 : 46) * Math.cos(a)).toFixed(1)}" y2="${(52 + (i % 3 ? 43 : 46) * Math.sin(a)).toFixed(1)}"/>`;
    }
    return `<g fill="none" stroke="${p.glow}" opacity=".3" stroke-width=".7"><circle cx="50" cy="52" r="46"/><circle cx="50" cy="52" r="40"/><circle cx="50" cy="52" r="30" stroke-dasharray="2 2"/>
      <polygon points="${starPoints(50, 52, 6, 40, 40, -90 + r.range(0, 30))}"/><polygon points="${polyPoints(50, 52, 6, 40, -90)}"/><polygon points="${polyPoints(50, 52, 6, 40, -60)}"/>${ticks}</g>`;
  },
  grid: (p) => {
    let s = '';
    for (let i = -6; i <= 6; i++) s += `<line x1="50" y1="58" x2="${50 + i * 20}" y2="104"/>`;
    for (let k = 0; k < 6; k++) {
      const y = 60 + Math.pow(k, 1.6) * 4.2;
      s += `<line x1="-5" y1="${y.toFixed(1)}" x2="105" y2="${y.toFixed(1)}"/>`;
    }
    return `<g stroke="${p.glow}" stroke-width=".5" opacity=".28">${s}</g>`;
  },
  smoke: (p, r) => {
    let s = '';
    for (let i = 0; i < 7; i++) s += `<circle cx="${r.range(0, 100).toFixed(1)}" cy="${r.range(0, 100).toFixed(1)}" r="${r.range(10, 24).toFixed(1)}" opacity="${r.range(0.08, 0.22).toFixed(2)}"/>`;
    return `<g fill="${p.glow}" filter="url(#soft)">${s}</g>`;
  },
  circuit: (p, r) => {
    let s = '';
    for (let i = 0; i < 12; i++) {
      let x = r.int(10) * 10 + 5;
      let y = r.int(10) * 10 + 5;
      let d = `M${x} ${y}`;
      for (let k = 0; k < 4; k++) {
        if (r.chance(0.5)) x += r.pick([-10, 10, 20]);
        else y += r.pick([-10, 10, 20]);
        d += ` L${x} ${y}`;
      }
      s += `<path d="${d}"/><circle cx="${x}" cy="${y}" r="1.3" fill="${p.glow}"/>`;
    }
    return `<g fill="none" stroke="${p.glow}" stroke-width=".7" opacity=".3">${s}</g>`;
  },
};

const RACE_PATTERN_BIAS: Record<string, string[]> = {
  Machine: ['circuit', 'grid', 'hex'],
  Spellcaster: ['circle', 'stars', 'rings'],
  Fairy: ['rays', 'stars', 'rings'],
  Aqua: ['waves', 'rings'],
  Fish: ['waves', 'rings'],
  'Sea Serpent': ['waves', 'smoke'],
  Psychic: ['rings', 'circle', 'hex'],
  Thunder: ['shards', 'rays'],
  Pyro: ['smoke', 'rays'],
  Zombie: ['smoke', 'stars'],
  Fiend: ['smoke', 'shards', 'circle'],
  Dragon: ['rays', 'smoke', 'shards'],
  Rock: ['shards', 'hex'],
  Plant: ['stars', 'rings', 'smoke'],
};

// ------------------------------------------------------------ assembly
const cache = new Map<string, string>();

export function cardArtSVG(data: CardData): string {
  const hit = cache.get(data.id);
  if (hit) return hit;
  const svg = buildArt(data);
  cache.set(data.id, svg);
  return svg;
}

const srcCache = new Map<string, string>();
/** Data URI of the art, cached (cheap to reuse across many <img> elements). */
export function cardArtSrc(data: CardData): string {
  let s = srcCache.get(data.id);
  if (!s) {
    s = `data:image/svg+xml;utf8,${encodeURIComponent(cardArtSVG(data))}`;
    srcCache.set(data.id, s);
  }
  return s;
}

function buildArt(data: CardData): string {
  const r = new Rand(hashString(data.id + '|' + data.name));
  const p = paletteFor(data, r);
  const isMonster = data.kind === 'monster';
  const race = data.race ?? '';
  const level = data.level ?? 4;
  const isExtra = !!data.mtypes?.some((t) => t === 'synchro' || t === 'fusion');

  // Background pattern
  const bias = isMonster ? RACE_PATTERN_BIAS[race] : data.kind === 'spell' ? ['circle', 'rays', 'stars', 'rings'] : ['shards', 'hex', 'rings', 'smoke'];
  const patternKey = bias && r.chance(0.7) ? r.pick(bias) : r.pick(Object.keys(PATTERNS));
  const pattern = PATTERNS[patternKey](p, r);
  const pattern2 = r.chance(0.45) ? PATTERNS[r.pick(['stars', 'smoke', 'rings'])](p, r) : '';

  // Emblem
  let emblem: string;
  const name = data.name.toLowerCase();
  if (isMonster) {
    if (/sheep|goat|lamb/.test(name)) emblem = MOTIFS.sheep(p, r);
    else emblem = (RACE_EMBLEMS[race] ?? MOTIFS.star)(p, r);
  } else {
    emblem = MOTIFS[motifFor(data, r)](p, r);
  }
  emblem = fillWith(emblem, p);
  const flip = isMonster && r.chance(0.5) && race !== 'Psychic';
  const sc = r.range(0.86, 1.0) * (isMonster ? 0.9 + Math.min(level, 10) * 0.012 : 1);
  const rot = r.range(-5, 5);
  const ox = r.range(-3, 3);
  const oy = r.range(-2, 3);
  const tf = `translate(${(50 + ox).toFixed(2)} ${(52 + oy).toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${(flip ? -sc : sc).toFixed(3)} ${sc.toFixed(3)}) translate(-50 -52)`;

  // Aura & particles
  const auraR = isMonster ? 26 + Math.min(level, 10) * 2.2 : 34;
  const auraOp = isExtra ? 0.95 : isMonster ? 0.55 + level * 0.03 : 0.7;
  let sparkles = '';
  const nSpark = (isExtra ? 8 : 3) + r.int(5);
  for (let i = 0; i < nSpark; i++) {
    const x = r.range(6, 94);
    const y = r.range(6, 94);
    const s = r.range(1.2, isExtra ? 3.6 : 2.6);
    sparkles += `<polygon points="${starPoints(x, y, 4, s, s * 0.22)}" opacity="${r.range(0.5, 1).toFixed(2)}"/>`;
  }
  let halo = '';
  if (isExtra) {
    halo = `<g fill="none" stroke="${p.glow}" opacity=".55"><circle cx="50" cy="52" r="42" stroke-width="1.2"/><circle cx="50" cy="52" r="46" stroke-width=".5" stroke-dasharray="1 3"/></g>`;
  }
  const horizon = isMonster && r.chance(0.5) ? `<path d="M0 ${r.range(78, 88).toFixed(1)} Q50 ${r.range(68, 80).toFixed(1)} 100 ${r.range(78, 88).toFixed(1)} L100 100 L0 100 Z" fill="${p.bg0}" opacity=".55"/>` : '';

  const cx = r.range(40, 60).toFixed(1);
  const cy = r.range(38, 58).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
<defs>
<radialGradient id="bg" cx="${cx}%" cy="${cy}%" r="75%"><stop offset="0" stop-color="${p.bg2}"/><stop offset=".45" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg0}"/></radialGradient>
<linearGradient id="body" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${p.bodyA}"/><stop offset="1" stop-color="${p.bodyB}"/></linearGradient>
<linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(p.bodyA, '#6bd66b', 0.55)}"/><stop offset="1" stop-color="${mix(p.bodyB, '#0f4a1a', 0.6)}"/></linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f9aa8"/><stop offset=".45" stop-color="#f4f7fb"/><stop offset=".55" stop-color="#cfd6df"/><stop offset="1" stop-color="#6c7682"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b3"/><stop offset=".45" stop-color="#e8b847"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
<radialGradient id="aura"><stop offset="0" stop-color="${p.glow}" stop-opacity="${auraOp.toFixed(2)}"/><stop offset=".55" stop-color="${p.glow}" stop-opacity="${(auraOp * 0.3).toFixed(2)}"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" r="72%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<filter id="eyeglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="rim" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="b"/><feFlood flood-color="${p.glow}" flood-opacity=".85"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft"><feGaussianBlur stdDeviation="4"/></filter>
</defs>
<rect width="100" height="100" fill="url(#bg)"/>
${pattern}${pattern2}${horizon}
<circle cx="50" cy="52" r="${auraR.toFixed(1)}" fill="url(#aura)"/>
${halo}
<g transform="${tf}" filter="url(#rim)">${emblem}</g>
<g fill="${p.eye}">${sparkles}</g>
<rect width="100" height="100" fill="url(#vig)"/>
</svg>`;
}
