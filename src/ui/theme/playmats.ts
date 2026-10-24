// Themed playmats. Each provides a background (layered gradients + SVG ornament) and zone colours.
import { Rand, polyPoints, starPoints, svgUri } from './util';

export interface Playmat {
  id: string;
  name: string;
  /** Short flavour line for menus. */
  description: string;
  /** Primary / accent colours. */
  base: string;
  accent: string;
  /** Zone outline & fill colours. */
  zoneLine: string;
  zoneFill: string;
  /** CSS background value. */
  readonly css: string;
}

interface Def {
  id: string;
  name: string;
  description: string;
  base: string;
  accent: string;
  zoneLine: string;
  zoneFill: string;
  gradient: string;
  svg: () => string;
}

const VW = 1600;
const VH = 1000;
const wrap = (inner: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid slice"><defs><filter id="b"><feGaussianBlur stdDeviation="6"/></filter><filter id="b2"><feGaussianBlur stdDeviation="22"/></filter>${defs}</defs>${inner}</svg>`;

function starfield(seed: string, n: number, color: string) {
  const r = new Rand(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${r.range(0, VW).toFixed(0)}" cy="${r.range(0, VH).toFixed(0)}" r="${r.range(0.5, 2).toFixed(1)}" opacity="${r.range(0.15, 0.7).toFixed(2)}"/>`;
  return `<g fill="${color}">${s}</g>`;
}

function seal(cx: number, cy: number, R: number, color: string, op: number) {
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r2 = i % 6 ? R - 8 : R - 18;
    ticks += `<line x1="${(cx + R * Math.cos(a)).toFixed(1)}" y1="${(cy + R * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy + r2 * Math.sin(a)).toFixed(1)}"/>`;
  }
  return `<g fill="none" stroke="${color}" opacity="${op}" stroke-width="1.5"><circle cx="${cx}" cy="${cy}" r="${R}"/><circle cx="${cx}" cy="${cy}" r="${R * 0.82}"/><circle cx="${cx}" cy="${cy}" r="${R * 0.5}" stroke-dasharray="6 8"/>
    <polygon points="${starPoints(cx, cy, 8, R * 0.82, R * 0.5)}"/><polygon points="${polyPoints(cx, cy, 4, R * 0.82)}"/><polygon points="${polyPoints(cx, cy, 4, R * 0.82, -45)}"/>${ticks}</g>`;
}

const DEFS: Def[] = [
  {
    id: 'edison-night',
    name: 'Edison Night',
    description: 'Midnight blue with a golden duelling seal.',
    base: '#0b1224',
    accent: '#d8b45a',
    zoneLine: 'rgba(216,180,90,.55)',
    zoneFill: 'rgba(10,18,40,.45)',
    gradient: 'radial-gradient(ellipse at 50% 50%, #1b2a52 0%, #0d1530 45%, #05080f 100%)',
    svg: () =>
      wrap(
        `${starfield('edison', 220, '#cfe0ff')}
        ${seal(800, 500, 380, '#d8b45a', 0.16)}
        <g stroke="#d8b45a" stroke-width="1.2" opacity=".22" fill="none"><path d="M0 500 L560 500 M1040 500 L1600 500"/><path d="M0 60 L1600 60 M0 940 L1600 940" stroke-dasharray="2 10"/></g>`,
      ),
  },
  {
    id: 'crimson-arena',
    name: 'Crimson Arena',
    description: 'A blood-red coliseum floor scattered with embers.',
    base: '#2a0606',
    accent: '#ff7a4a',
    zoneLine: 'rgba(255,122,74,.55)',
    zoneFill: 'rgba(40,6,6,.45)',
    gradient: 'radial-gradient(ellipse at 50% 50%, #5a1010 0%, #2a0606 50%, #0e0202 100%)',
    svg: () => {
      let hex = '';
      for (let y = 0; y < VH + 60; y += 52) for (let x = (y / 52) % 2 ? 30 : 0; x < VW + 60; x += 60) hex += `<polygon points="${polyPoints(x, y, 6, 30, 0)}"/>`;
      return wrap(`<g fill="none" stroke="#ff6a3a" stroke-width="1" opacity=".09">${hex}</g>${starfield('ember', 140, '#ffb070')}
        <g fill="none" stroke="#ff7a4a" opacity=".2" stroke-width="3"><ellipse cx="800" cy="500" rx="700" ry="430"/><ellipse cx="800" cy="500" rx="660" ry="400" stroke-width="1"/></g>`);
    },
  },
  {
    id: 'verdant-grove',
    name: 'Verdant Grove',
    description: 'Sunlight filtering through an ancient forest.',
    base: '#0b2414',
    accent: '#a6e36a',
    zoneLine: 'rgba(166,227,106,.5)',
    zoneFill: 'rgba(6,26,12,.45)',
    gradient: 'radial-gradient(ellipse at 50% 0%, #2d6a35 0%, #123a1d 45%, #04140a 100%)',
    svg: () => {
      const r = new Rand('grove');
      let leaves = '';
      for (let i = 0; i < 40; i++) {
        const x = r.range(0, VW);
        const y = r.range(0, VH);
        const s = r.range(0.6, 1.8);
        leaves += `<path d="M0 0 C20 -30 60 -30 80 0 C60 30 20 30 0 0 Z M0 0 L80 0" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${r.range(0, 360).toFixed(0)}) scale(${s.toFixed(2)})"/>`;
      }
      let rays = '';
      for (let i = 0; i < 7; i++) rays += `<polygon points="${200 + i * 200},0 ${260 + i * 200},0 ${120 + i * 230},1000 ${40 + i * 230},1000"/>`;
      return wrap(`<g fill="#e8ffb0" opacity=".05">${rays}</g><g fill="none" stroke="#a6e36a" stroke-width="2" opacity=".12">${leaves}</g>`);
    },
  },
  {
    id: 'abyssal-depths',
    name: 'Abyssal Depths',
    description: 'Caustic light dancing on the ocean floor.',
    base: '#021a26',
    accent: '#5ee0ff',
    zoneLine: 'rgba(94,224,255,.5)',
    zoneFill: 'rgba(2,20,32,.45)',
    gradient: 'linear-gradient(180deg, #0b4a66 0%, #04293b 45%, #010a12 100%)',
    svg: () => {
      const r = new Rand('abyss');
      let caustic = '';
      for (let i = 0; i < 60; i++) {
        const x = r.range(0, VW);
        const y = r.range(0, VH);
        caustic += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${r.range(20, 60).toFixed(0)} ${r.range(-30, 30).toFixed(0)} ${r.range(60, 120).toFixed(0)} ${r.range(-10, 10).toFixed(0)}"/>`;
      }
      let bubbles = '';
      for (let i = 0; i < 50; i++) bubbles += `<circle cx="${r.range(0, VW).toFixed(0)}" cy="${r.range(0, VH).toFixed(0)}" r="${r.range(2, 9).toFixed(1)}"/>`;
      return wrap(`<g fill="none" stroke="#8ff0ff" stroke-width="3" opacity=".08" filter="url(#b)">${caustic}</g><g fill="none" stroke="#bff6ff" stroke-width="1.2" opacity=".18">${bubbles}</g>`);
    },
  },
  {
    id: 'molten-core',
    name: 'Molten Core',
    description: 'Obsidian plates split by rivers of lava.',
    base: '#120604',
    accent: '#ff8a1e',
    zoneLine: 'rgba(255,138,30,.55)',
    zoneFill: 'rgba(16,6,4,.55)',
    gradient: 'radial-gradient(ellipse at 50% 120%, #6a1c04 0%, #200805 45%, #070202 100%)',
    svg: () => {
      const r = new Rand('lava');
      let cracks = '';
      for (let i = 0; i < 26; i++) {
        let x = r.range(0, VW);
        let y = r.range(0, VH);
        let d = `M${x.toFixed(0)} ${y.toFixed(0)}`;
        for (let k = 0; k < 6; k++) {
          x += r.range(-90, 90);
          y += r.range(-60, 60);
          d += ` L${x.toFixed(0)} ${y.toFixed(0)}`;
        }
        cracks += `<path d="${d}"/>`;
      }
      return wrap(`<g fill="none" stroke="#ff6a00" stroke-width="10" opacity=".25" filter="url(#b)">${cracks}</g><g fill="none" stroke="#ffc04a" stroke-width="2" opacity=".35">${cracks}</g>`);
    },
  },
  {
    id: 'celestial-temple',
    name: 'Celestial Temple',
    description: 'Golden orbits over a violet sky.',
    base: '#1c1238',
    accent: '#f3d27a',
    zoneLine: 'rgba(243,210,122,.55)',
    zoneFill: 'rgba(28,18,56,.45)',
    gradient: 'radial-gradient(ellipse at 50% 40%, #4b3592 0%, #241650 50%, #0b0619 100%)',
    svg: () =>
      wrap(`${starfield('celestial', 260, '#fff4d0')}
        <g fill="none" stroke="#f3d27a" opacity=".2" stroke-width="1.5"><ellipse cx="800" cy="500" rx="720" ry="200" transform="rotate(-12 800 500)"/><ellipse cx="800" cy="500" rx="640" ry="300" transform="rotate(18 800 500)"/><ellipse cx="800" cy="500" rx="300" ry="300"/></g>
        <circle cx="800" cy="500" r="120" fill="#f3d27a" opacity=".07" filter="url(#b2)"/>`),
  },
  {
    id: 'cyber-grid',
    name: 'Cyber Grid',
    description: 'Neon lattice of a virtual duel arena.',
    base: '#04070c',
    accent: '#3ef0ff',
    zoneLine: 'rgba(62,240,255,.6)',
    zoneFill: 'rgba(2,10,18,.55)',
    gradient: 'radial-gradient(ellipse at 50% 50%, #0d2233 0%, #050b14 55%, #010204 100%)',
    svg: () => {
      let g = '';
      for (let x = 0; x <= VW; x += 50) g += `<line x1="${x}" y1="0" x2="${x}" y2="${VH}"/>`;
      for (let y = 0; y <= VH; y += 50) g += `<line x1="0" y1="${y}" x2="${VW}" y2="${y}"/>`;
      return wrap(`<g stroke="#3ef0ff" stroke-width="1" opacity=".08">${g}</g>
        <g stroke="#ff3ec8" stroke-width="2" opacity=".18" fill="none"><path d="M0 500 L1600 500"/><rect x="40" y="40" width="1520" height="920" rx="20"/></g>
        <circle cx="800" cy="500" r="200" fill="#3ef0ff" opacity=".05" filter="url(#b2)"/>`);
    },
  },
  {
    id: 'desert-ruins',
    name: 'Desert Ruins',
    description: 'Sun-baked sandstone carved with ancient glyphs.',
    base: '#3a2810',
    accent: '#f0c46a',
    zoneLine: 'rgba(255,224,160,.55)',
    zoneFill: 'rgba(46,30,10,.45)',
    gradient: 'radial-gradient(ellipse at 50% 30%, #8a6430 0%, #4e3416 50%, #1c1006 100%)',
    svg: () => {
      const r = new Rand('glyph');
      let glyphs = '';
      for (let row of [70, 930]) {
        for (let x = 40; x < VW; x += 70) {
          const t = r.int(5);
          const shapes = [
            `<circle cx="${x}" cy="${row}" r="16"/><line x1="${x}" y1="${row + 16}" x2="${x}" y2="${row + 40}"/>`,
            `<polygon points="${x - 18},${row + 20} ${x},${row - 20} ${x + 18},${row + 20}"/>`,
            `<path d="M${x - 18} ${row} Q${x} ${row - 30} ${x + 18} ${row} Q${x} ${row + 30} ${x - 18} ${row} Z"/><circle cx="${x}" cy="${row}" r="5"/>`,
            `<rect x="${x - 14}" y="${row - 20}" width="28" height="40"/><line x1="${x - 14}" y1="${row}" x2="${x + 14}" y2="${row}"/>`,
            `<path d="M${x - 16} ${row + 20} L${x - 16} ${row - 10} Q${x} ${row - 30} ${x + 16} ${row - 10} L${x + 16} ${row + 20}"/>`,
          ];
          glyphs += shapes[t];
        }
      }
      return wrap(`<g fill="none" stroke="#ffe2a0" stroke-width="3" opacity=".16">${glyphs}</g>
        <g fill="none" stroke="#ffe2a0" opacity=".12" stroke-width="2"><rect x="20" y="20" width="1560" height="960"/><line x1="0" y1="120" x2="1600" y2="120"/><line x1="0" y1="880" x2="1600" y2="880"/></g>
        ${seal(800, 500, 300, '#ffe2a0', 0.1)}`);
    },
  },
  {
    id: 'frozen-tundra',
    name: 'Frozen Tundra',
    description: 'Glacial ice fractured into crystal facets.',
    base: '#0e2233',
    accent: '#bfeaff',
    zoneLine: 'rgba(191,234,255,.6)',
    zoneFill: 'rgba(10,30,46,.45)',
    gradient: 'linear-gradient(160deg, #3d6f92 0%, #16344d 50%, #071422 100%)',
    svg: () => {
      const r = new Rand('tundra');
      let facets = '';
      for (let i = 0; i < 60; i++) {
        const x = r.range(-100, VW);
        const y = r.range(-100, VH);
        facets += `<polygon points="${x.toFixed(0)},${y.toFixed(0)} ${(x + r.range(80, 260)).toFixed(0)},${(y + r.range(-60, 120)).toFixed(0)} ${(x + r.range(-40, 160)).toFixed(0)},${(y + r.range(100, 280)).toFixed(0)}" opacity="${r.range(0.02, 0.08).toFixed(3)}"/>`;
      }
      return wrap(`<g fill="#ffffff" stroke="#e6f7ff" stroke-width="1" stroke-opacity=".08">${facets}</g>${starfield('snow', 160, '#ffffff')}`);
    },
  },
  {
    id: 'shadow-realm',
    name: 'Shadow Realm',
    description: 'Violet mist swirling around a watching sigil.',
    base: '#0c0414',
    accent: '#c06bff',
    zoneLine: 'rgba(192,107,255,.55)',
    zoneFill: 'rgba(16,4,26,.5)',
    gradient: 'radial-gradient(ellipse at 50% 50%, #3a1260 0%, #160626 50%, #050108 100%)',
    svg: () => {
      const r = new Rand('shadow');
      let mist = '';
      for (let i = 0; i < 26; i++) mist += `<circle cx="${r.range(0, VW).toFixed(0)}" cy="${r.range(0, VH).toFixed(0)}" r="${r.range(60, 180).toFixed(0)}" opacity="${r.range(0.04, 0.12).toFixed(2)}"/>`;
      return wrap(`<g fill="#9a4ae0" filter="url(#b2)">${mist}</g>
        <g fill="none" stroke="#c06bff" opacity=".22" stroke-width="2"><path d="M560 500 Q800 330 1040 500 Q800 670 560 500 Z"/><circle cx="800" cy="500" r="60"/><circle cx="800" cy="500" r="20" fill="#c06bff" opacity=".5"/></g>
        ${seal(800, 500, 360, '#c06bff', 0.12)}`);
    },
  },
];

const cache = new Map<string, string>();

export const PLAYMATS: Playmat[] = DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  description: d.description,
  base: d.base,
  accent: d.accent,
  zoneLine: d.zoneLine,
  zoneFill: d.zoneFill,
  get css() {
    let c = cache.get(d.id);
    if (!c) {
      c = `${svgUri(d.svg())} center / cover no-repeat, ${d.gradient}`;
      cache.set(d.id, c);
    }
    return c;
  },
}));

export function playmatById(id: string): Playmat {
  return PLAYMATS.find((p) => p.id === id) ?? PLAYMATS[0];
}

/** Apply a playmat to an element: sets its background and the zone colour custom properties. */
export function applyPlaymat(el: HTMLElement, id: string) {
  const m = playmatById(id);
  el.style.background = m.css;
  el.style.setProperty('--mat-accent', m.accent);
  el.style.setProperty('--zone-line', m.zoneLine);
  el.style.setProperty('--zone-fill', m.zoneFill);
  el.style.setProperty('--mat-base', m.base);
  el.dataset.playmat = m.id;
}
