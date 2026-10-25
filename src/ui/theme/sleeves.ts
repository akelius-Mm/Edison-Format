// Card-back (sleeve) designs. Pure SVG, rendered as CSS background images.
import { getCustomImage } from './customImages';
import { Rand, polyPoints, starPoints, svgUri } from './util';

export interface Sleeve {
  id: string;
  name: string;
  /** Dominant colour (for UI chips / fallbacks). */
  color: string;
  /** CSS `background` value for the card back. */
  css: string;
  render(el: HTMLElement): void;
}

const W = 100;
const H = 146;

function frame(inner: string, opts: { border: string; border2?: string; bg: string; defs?: string }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".3" stop-color="#d8a43a"/><stop offset=".6" stop-color="#fbe39a"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
<linearGradient id="silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#9aa7b8"/><stop offset=".65" stop-color="#eef3f9"/><stop offset="1" stop-color="#5d6878"/></linearGradient>
<radialGradient id="vig" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${opts.defs ?? ''}
</defs>
<rect width="${W}" height="${H}" fill="${opts.bg}"/>
${inner}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect x="2.2" y="2.2" width="${W - 4.4}" height="${H - 4.4}" rx="3.5" fill="none" stroke="${opts.border}" stroke-width="2.6"/>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="2" fill="none" stroke="${opts.border2 ?? opts.border}" stroke-width=".8" opacity=".85"/>
</svg>`;
}

function corners(color: string, size = 9) {
  const c = (x: number, y: number, sx: number, sy: number) =>
    `<path d="M${x} ${y + sy * size} L${x} ${y} L${x + sx * size} ${y} M${x + sx * 2.5} ${y + sy * 2.5} L${x + sx * 5} ${y + sy * 2.5} M${x + sx * 2.5} ${y + sy * 2.5} L${x + sx * 2.5} ${y + sy * 5}" stroke="${color}" stroke-width="1.2" fill="none"/>`;
  return c(9, 9, 1, 1) + c(W - 9, 9, -1, 1) + c(9, H - 9, 1, -1) + c(W - 9, H - 9, -1, -1);
}

const DESIGNS: { id: string; name: string; color: string; svg: () => string }[] = [
  {
    id: 'classic-red',
    name: 'Classic Crimson',
    color: '#8c1414',
    svg: () => {
      let spiral = '';
      for (let i = 0; i < 6; i++)
        spiral += `<path d="M50 73 C58 62 74 64 74 76 C74 90 56 96 44 88" fill="none" stroke="url(#gold)" stroke-width="${1.8 - i * 0.18}" opacity="${1 - i * 0.1}" transform="rotate(${i * 60} 50 73)"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#rad)"/>
        <g opacity=".18" stroke="#ffcf7a" stroke-width=".5">${Array.from({ length: 30 }, (_, i) => `<line x1="50" y1="73" x2="${50 + 90 * Math.cos((i / 30) * Math.PI * 2)}" y2="${73 + 90 * Math.sin((i / 30) * Math.PI * 2)}"/>`).join('')}</g>
        <ellipse cx="50" cy="73" rx="34" ry="44" fill="#3a0505" stroke="url(#gold)" stroke-width="2.6"/>
        <ellipse cx="50" cy="73" rx="29" ry="39" fill="none" stroke="url(#gold)" stroke-width=".7"/>
        ${spiral}
        <circle cx="50" cy="73" r="6" fill="#120000" stroke="url(#gold)" stroke-width="1.2"/>
        ${corners('url(#gold)')}`,
        {
          border: 'url(#gold)',
          bg: '#5a0808',
          defs: '<radialGradient id="rad" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#d42a1a"/><stop offset=".6" stop-color="#7c0b0b"/><stop offset="1" stop-color="#2e0202"/></radialGradient>',
        },
      );
    },
  },
  {
    id: 'midnight-stars',
    name: 'Midnight Constellation',
    color: '#13204a',
    svg: () => {
      const r = new Rand('midnight');
      let stars = '';
      for (let i = 0; i < 70; i++) stars += `<circle cx="${r.range(7, 93).toFixed(1)}" cy="${r.range(7, 139).toFixed(1)}" r="${r.range(0.2, 0.9).toFixed(2)}" fill="#fff" opacity="${r.range(0.3, 1).toFixed(2)}"/>`;
      const pts = [
        [24, 30],
        [36, 22],
        [46, 34],
        [62, 26],
        [76, 38],
        [70, 112],
        [56, 120],
        [40, 110],
        [28, 122],
      ];
      const lines = pts.slice(0, 5).map((p, i, a) => (i ? `L${p[0]} ${p[1]}` : `M${p[0]} ${p[1]}`)).join(' ') + ' ' + pts.slice(5).map((p, i) => (i ? `L${p[0]} ${p[1]}` : `M${p[0]} ${p[1]}`)).join(' ');
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#sky)"/>${stars}
        <path d="${lines}" stroke="#bcd3ff" stroke-width=".5" fill="none" opacity=".7"/>
        ${pts.map((p) => `<polygon points="${starPoints(p[0], p[1], 4, 2.4, 0.6)}" fill="#e8f0ff" filter="url(#glow)"/>`).join('')}
        <circle cx="50" cy="73" r="20" fill="none" stroke="url(#silver)" stroke-width="1.4"/>
        <path d="M56 56 A18 18 0 1 0 56 90 A14 14 0 1 1 56 56 Z" fill="url(#silver)"/>
        <circle cx="50" cy="73" r="26" fill="none" stroke="url(#silver)" stroke-width=".5" stroke-dasharray="1 2.5"/>`,
        {
          border: 'url(#silver)',
          bg: '#0a1230',
          defs: '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1440"/><stop offset=".55" stop-color="#1b2c6e"/><stop offset="1" stop-color="#05081c"/></linearGradient>',
        },
      );
    },
  },
  {
    id: 'emerald-filigree',
    name: 'Emerald Filigree',
    color: '#0d5a3a',
    svg: () => {
      let lattice = '';
      for (let y = -10; y < 160; y += 14) for (let x = -10; x < 110; x += 14) lattice += `<path d="M${x} ${y + 7} L${x + 7} ${y} L${x + 14} ${y + 7} L${x + 7} ${y + 14} Z"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#em)"/>
        <g fill="none" stroke="#e9c766" stroke-width=".45" opacity=".45">${lattice}</g>
        <polygon points="50,33 82,73 50,113 18,73" fill="#063322" stroke="url(#gold)" stroke-width="2.2"/>
        <polygon points="50,42 74,73 50,104 26,73" fill="none" stroke="url(#gold)" stroke-width=".7"/>
        <polygon points="${starPoints(50, 73, 8, 15, 6)}" fill="url(#gold)"/>
        <circle cx="50" cy="73" r="4" fill="#0f7a4e" stroke="#fff3c4" stroke-width=".7"/>
        ${corners('url(#gold)', 11)}`,
        {
          border: 'url(#gold)',
          bg: '#04301e',
          defs: '<radialGradient id="em" r="75%"><stop offset="0" stop-color="#1aa36a"/><stop offset=".6" stop-color="#0a5a3a"/><stop offset="1" stop-color="#032417"/></radialGradient>',
        },
      );
    },
  },
  {
    id: 'obsidian-deco',
    name: 'Obsidian Deco',
    color: '#151515',
    svg: () => {
      let fan = '';
      for (let i = 0; i <= 18; i++) {
        const a = Math.PI + (i / 18) * Math.PI;
        fan += `<line x1="50" y1="118" x2="${(50 + 70 * Math.cos(a)).toFixed(1)}" y2="${(118 + 70 * Math.sin(a)).toFixed(1)}"/>`;
      }
      let arcs = '';
      for (let k = 1; k <= 4; k++) arcs += `<path d="M${50 - k * 11} 118 A${k * 11} ${k * 11} 0 0 1 ${50 + k * 11} 118"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#obs)"/>
        <g stroke="url(#gold)" stroke-width=".6" opacity=".85">${fan}</g>
        <g fill="none" stroke="url(#gold)" stroke-width="1.3">${arcs}</g>
        <path d="M14 14 L86 14 L86 30 L50 46 L14 30 Z" fill="none" stroke="url(#gold)" stroke-width="1.2"/>
        <path d="M22 20 L78 20 L78 27 L50 39 L22 27 Z" fill="url(#gold)" opacity=".9"/>
        <path d="M50 46 L50 70" stroke="url(#gold)" stroke-width="1"/>
        <polygon points="${polyPoints(50, 74, 4, 5)}" fill="url(#gold)"/>
        <rect x="10" y="122" width="80" height="2" fill="url(#gold)"/><rect x="10" y="127" width="80" height=".8" fill="url(#gold)"/>`,
        {
          border: 'url(#gold)',
          bg: '#0b0b0b',
          defs: '<linearGradient id="obs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a2e"/><stop offset=".5" stop-color="#0c0c0e"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>',
        },
      );
    },
  },
  {
    id: 'arcane-circle',
    name: 'Arcane Circle',
    color: '#4a1a7a',
    svg: () => {
      let ticks = '';
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const r1 = 34;
        const r2 = i % 4 ? 36 : 39;
        ticks += `<line x1="${(50 + r1 * Math.cos(a)).toFixed(1)}" y1="${(73 + r1 * Math.sin(a)).toFixed(1)}" x2="${(50 + r2 * Math.cos(a)).toFixed(1)}" y2="${(73 + r2 * Math.sin(a)).toFixed(1)}"/>`;
      }
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#arc)"/>
        <g fill="none" stroke="#d9a8ff" stroke-width=".8" filter="url(#glow)">
          <circle cx="50" cy="73" r="40"/><circle cx="50" cy="73" r="34"/><circle cx="50" cy="73" r="22"/>
          <polygon points="${polyPoints(50, 73, 3, 34)}"/><polygon points="${polyPoints(50, 73, 3, 34, 90)}"/>
          <polygon points="${starPoints(50, 73, 6, 22, 11)}"/>${ticks}
        </g>
        <circle cx="50" cy="73" r="6" fill="#f3d9ff" filter="url(#glow)"/>
        ${corners('#c58cff')}`,
        {
          border: '#b57bff',
          border2: '#7c3fc4',
          bg: '#1b0632',
          defs: '<radialGradient id="arc" r="75%"><stop offset="0" stop-color="#6a2bb0"/><stop offset=".55" stop-color="#2a0c4f"/><stop offset="1" stop-color="#0c0219"/></radialGradient>',
        },
      );
    },
  },
  {
    id: 'dragon-eye',
    name: 'Dragon Eye',
    color: '#3a0606',
    svg: () => {
      let scales = '';
      for (let y = 4; y < 150; y += 7) for (let x = (y / 7) % 2 ? 0 : 5; x < 105; x += 10) scales += `<path d="M${x - 5} ${y} Q${x} ${y + 8} ${x + 5} ${y}"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="#160404"/>
        <g fill="none" stroke="#7a1a10" stroke-width=".8" opacity=".9">${scales}</g>
        <path d="M10 73 Q50 28 90 73 Q50 118 10 73 Z" fill="url(#iris)" stroke="url(#gold)" stroke-width="2"/>
        <ellipse cx="50" cy="73" rx="5" ry="26" fill="#050000"/>
        <ellipse cx="50" cy="73" rx="1.6" ry="20" fill="#3a0000"/>
        <circle cx="40" cy="62" r="3" fill="#fff" opacity=".7"/>
        ${corners('url(#gold)')}`,
        {
          border: 'url(#gold)',
          bg: '#120202',
          defs: '<radialGradient id="iris" r="60%"><stop offset="0" stop-color="#ffe066"/><stop offset=".45" stop-color="#ff7a10"/><stop offset="1" stop-color="#6a0a00"/></radialGradient>',
        },
      );
    },
  },
  {
    id: 'frost-crystal',
    name: 'Frost Crystal',
    color: '#5aa8d8',
    svg: () => {
      let flake = '';
      for (let i = 0; i < 6; i++) {
        flake += `<g transform="rotate(${i * 60} 50 73)"><line x1="50" y1="73" x2="50" y2="37"/><line x1="50" y1="49" x2="42" y2="42"/><line x1="50" y1="49" x2="58" y2="42"/><line x1="50" y1="60" x2="44" y2="55"/><line x1="50" y1="60" x2="56" y2="55"/></g>`;
      }
      const r = new Rand('frost');
      let facets = '';
      for (let i = 0; i < 18; i++) {
        const x = r.range(0, 100);
        const y = r.range(0, 146);
        facets += `<polygon points="${x.toFixed(1)},${y.toFixed(1)} ${(x + r.range(10, 30)).toFixed(1)},${(y + r.range(-10, 20)).toFixed(1)} ${(x + r.range(-5, 18)).toFixed(1)},${(y + r.range(14, 34)).toFixed(1)}" fill="#fff" opacity="${r.range(0.04, 0.16).toFixed(2)}"/>`;
      }
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#ice)"/>${facets}
        <polygon points="${polyPoints(50, 73, 6, 40, 0)}" fill="none" stroke="#eaf8ff" stroke-width=".8" opacity=".7"/>
        <g stroke="#ffffff" stroke-width="2" stroke-linecap="round" filter="url(#glow)">${flake}</g>
        <polygon points="${polyPoints(50, 73, 6, 7, 0)}" fill="#d9f4ff"/>`,
        {
          border: 'url(#silver)',
          bg: '#0b2a48',
          defs: '<linearGradient id="ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fd8ff"/><stop offset=".45" stop-color="#2a74b8"/><stop offset="1" stop-color="#0a2546"/></linearGradient>',
        },
      );
    },
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    color: '#e0801a',
    svg: () => {
      let rays = '';
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * Math.PI * 2;
        const a1 = a0 + Math.PI / 48;
        const a2 = a0 - Math.PI / 48;
        const R = i % 2 ? 46 : 60;
        rays += `<polygon points="${(50 + 18 * Math.cos(a1)).toFixed(1)},${(73 + 18 * Math.sin(a1)).toFixed(1)} ${(50 + R * Math.cos(a0)).toFixed(1)},${(73 + R * Math.sin(a0)).toFixed(1)} ${(50 + 18 * Math.cos(a2)).toFixed(1)},${(73 + 18 * Math.sin(a2)).toFixed(1)}"/>`;
      }
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#sun)"/>
        <g fill="#ffe9a0" opacity=".75">${rays}</g>
        <circle cx="50" cy="73" r="19" fill="url(#core)" stroke="#fff3c4" stroke-width="1.2"/>
        <circle cx="50" cy="73" r="24" fill="none" stroke="#fff3c4" stroke-width=".6"/>
        ${corners('#fff1b8')}`,
        {
          border: 'url(#gold)',
          bg: '#6a1c00',
          defs: '<radialGradient id="sun" r="75%"><stop offset="0" stop-color="#ffb43a"/><stop offset=".5" stop-color="#d9480f"/><stop offset="1" stop-color="#4a0d00"/></radialGradient><radialGradient id="core" r="60%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".6" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff8a00"/></radialGradient>',
        },
      );
    },
  },
  {
    id: 'carbon-circuit',
    name: 'Carbon Circuit',
    color: '#1c262e',
    svg: () => {
      const r = new Rand('circuit');
      let paths = '';
      for (let i = 0; i < 16; i++) {
        let x = 10 + r.int(9) * 10;
        let y = 10 + r.int(14) * 9;
        let d = `M${x} ${y}`;
        for (let k = 0; k < 4; k++) {
          if (r.chance(0.5)) x = Math.max(8, Math.min(92, x + r.pick([-10, 10, 20])));
          else y = Math.max(8, Math.min(138, y + r.pick([-9, 9, 18])));
          d += ` L${x} ${y}`;
        }
        paths += `<path d="${d}"/><circle cx="${x}" cy="${y}" r="1.3" fill="#5ef2ff"/>`;
      }
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#cf)"/>
        <g fill="none" stroke="#38d6ef" stroke-width=".7" opacity=".75" filter="url(#glow)">${paths}</g>
        <polygon points="${polyPoints(50, 73, 6, 18, 0)}" fill="#0b1418" stroke="#5ef2ff" stroke-width="1.6" filter="url(#glow)"/>
        <polygon points="${polyPoints(50, 73, 6, 11, 0)}" fill="none" stroke="#5ef2ff" stroke-width=".7"/>
        <circle cx="50" cy="73" r="4" fill="#bdfaff" filter="url(#glow)"/>`,
        {
          border: '#5ef2ff',
          border2: '#2a6c7a',
          bg: '#0d1216',
          defs: '<pattern id="cfp" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#161d22"/><rect width="2" height="2" fill="#222c33"/><rect x="2" y="2" width="2" height="2" fill="#222c33"/></pattern><linearGradient id="cfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient><pattern id="cf" width="100" height="146" patternUnits="userSpaceOnUse"><rect width="100" height="146" fill="url(#cfp)"/><rect width="100" height="146" fill="url(#cfg)"/></pattern>',
        },
      );
    },
  },
  {
    id: 'sakura-bloom',
    name: 'Sakura Bloom',
    color: '#d86a9a',
    svg: () => {
      const r = new Rand('sakura');
      const petal = (x: number, y: number, a: number, s: number, o: number) =>
        `<path d="M0 0 C3 -4 7 -3 7 1 C7 4 3 6 0 4 C-3 6 -7 4 -7 1 C-7 -3 -3 -4 0 0 Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(0)}) scale(${s.toFixed(2)})" fill="#ffe4ef" opacity="${o.toFixed(2)}"/>`;
      let petals = '';
      for (let i = 0; i < 22; i++) petals += petal(r.range(8, 92), r.range(8, 138), r.range(0, 360), r.range(0.4, 0.9), r.range(0.4, 0.9));
      let flower = '';
      for (let i = 0; i < 5; i++) flower += `<ellipse cx="50" cy="58" rx="8" ry="14" transform="rotate(${i * 72} 50 73)" fill="#ffd1e3" stroke="#b84a7c" stroke-width=".8"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#sk)"/>${petals}
        <circle cx="50" cy="73" r="30" fill="none" stroke="#fff0f6" stroke-width=".8" opacity=".8"/>
        ${flower}<circle cx="50" cy="73" r="5" fill="#f7c948" stroke="#b84a7c" stroke-width=".7"/>`,
        {
          border: '#fff0f6',
          border2: '#f4a9c8',
          bg: '#6a1f45',
          defs: '<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08bb5"/><stop offset=".6" stop-color="#b13d76"/><stop offset="1" stop-color="#4f1031"/></linearGradient>',
        },
      );
    },
  },
  {
    id: 'ocean-tide',
    name: 'Ocean Tide',
    color: '#0e6a78',
    svg: () => {
      let waves = '';
      for (let y = 14; y < 146; y += 8) waves += `<path d="M0 ${y} Q6 ${y - 4} 12.5 ${y} T25 ${y} T37.5 ${y} T50 ${y} T62.5 ${y} T75 ${y} T87.5 ${y} T100 ${y}"/>`;
      let compass = '';
      for (let i = 0; i < 8; i++) compass += `<polygon points="50,${73 - (i % 2 ? 16 : 26)} 53,73 50,76 47,73" transform="rotate(${i * 45} 50 73)" fill="${i % 2 ? '#bff4ff' : 'url(#gold)'}"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="url(#sea)"/>
        <g fill="none" stroke="#9feeff" stroke-width=".6" opacity=".35">${waves}</g>
        <circle cx="50" cy="73" r="30" fill="#073840" stroke="url(#gold)" stroke-width="2"/>
        <circle cx="50" cy="73" r="25" fill="none" stroke="#9feeff" stroke-width=".5" stroke-dasharray="1 2"/>
        ${compass}<circle cx="50" cy="73" r="3" fill="url(#gold)"/>
        ${corners('url(#gold)')}`,
        {
          border: 'url(#gold)',
          bg: '#04323a',
          defs: '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fb4c4"/><stop offset=".5" stop-color="#0b5f6e"/><stop offset="1" stop-color="#02262e"/></linearGradient>',
        },
      );
    },
  },
  {
    id: 'royal-azure',
    name: 'Royal Azure',
    color: '#1d3f8f',
    svg: () => {
      let checks = '';
      for (let y = 6; y < 140; y += 6) for (let x = 6; x < 94; x += 6) if (((x + y) / 6) % 2 === 0) checks += `<rect x="${x}" y="${y}" width="6" height="6"/>`;
      return frame(
        `<rect x="6" y="6" width="88" height="134" fill="#173480"/>
        <g fill="#2a52b8" opacity=".55">${checks}</g>
        <rect x="14" y="14" width="72" height="118" rx="3" fill="url(#roy)" stroke="url(#gold)" stroke-width="1.6"/>
        <path d="M34 52 L66 52 L66 74 C66 88 58 96 50 102 C42 96 34 88 34 74 Z" fill="#0d1f52" stroke="url(#gold)" stroke-width="1.8"/>
        <polygon points="${starPoints(50, 74, 5, 10, 4)}" fill="url(#gold)"/>
        <path d="M36 46 L38 34 L44 40 L50 30 L56 40 L62 34 L64 46 Z" fill="url(#gold)"/>
        <path d="M24 118 L76 118" stroke="url(#gold)" stroke-width="1"/>`,
        {
          border: 'url(#gold)',
          bg: '#0f2460',
          defs: '<radialGradient id="roy" r="75%"><stop offset="0" stop-color="#3567d6"/><stop offset="1" stop-color="#0d2463"/></radialGradient>',
        },
      );
    },
  },
  ...matteSleeves(),
  ...eraSleeves(),
  {
    id: 'classic-back',
    name: 'Classic Card Back',
    color: '#2a160a',
    svg: () => {
      let swirl = '';
      for (let i = 0; i < 9; i++) {
        const a = i * 40;
        swirl += `<path d="M50 73 C${56 + i} ${58 - i} ${74 - i} ${60} ${70 - i * 0.6} ${78 + i * 0.4}" fill="none" stroke="${i % 2 ? '#ffb15a' : '#5a1e05'}" stroke-opacity="${i % 2 ? 0.35 : 0.5}" stroke-width="${2.6 - i * 0.15}" transform="rotate(${a} 50 73)"/>`;
      }
      return sleeveSvg(
        `<rect width="${W}" height="${H}" rx="4" fill="url(#cbbg)"/>
        <ellipse cx="50" cy="73" rx="36" ry="50" fill="#120803" opacity=".55"/>
        <ellipse cx="50" cy="73" rx="33" ry="47" fill="url(#cboval)"/>
        <g clip-path="url(#cbclip)">${swirl}</g>
        <ellipse cx="50" cy="73" rx="33" ry="47" fill="none" stroke="#1a0b03" stroke-width="1.6"/>
        <ellipse cx="50" cy="73" rx="7" ry="9" fill="url(#cbcore)"/>`,
        `<radialGradient id="cbbg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#3b200d"/><stop offset="1" stop-color="#140a04"/></radialGradient>
        <radialGradient id="cboval" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#f08a2c"/><stop offset=".45" stop-color="#b8480f"/><stop offset="1" stop-color="#4a1804"/></radialGradient>
        <radialGradient id="cbcore"><stop offset="0" stop-color="#ffe0a0"/><stop offset="1" stop-color="#e07020" stop-opacity="0"/></radialGradient>
        <clipPath id="cbclip"><ellipse cx="50" cy="73" rx="33" ry="47"/></clipPath>`,
        '#1e0f05',
        0.2,
      );
    },
  },
];

/** Sleeve wrapper with a plastic finish: grain, sheen and a clear sleeve edge. */
function sleeveSvg(inner: string, defs: string, bg: string, gloss = 0.22) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs>
<filter id="sgrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .4 0"/></filter>
<linearGradient id="ssheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${gloss}"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".56" stop-color="#fff" stop-opacity="${gloss / 3}"/><stop offset=".68" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
${defs}
</defs>
<rect width="${W}" height="${H}" rx="4" fill="${bg}"/>
${inner}
<rect width="${W}" height="${H}" rx="4" filter="url(#sgrain)" opacity=".35"/>
<rect width="${W}" height="${H}" rx="4" fill="url(#ssheen)"/>
<rect x=".7" y=".7" width="${W - 1.4}" height="${H - 1.4}" rx="3.6" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.1"/>
</svg>`;
}

/** Original designs in the style of the art sleeves duelists used around 2010. */
function eraSleeves() {
  const feather = (x: number, y: number, len: number, rot: number, fill: string, op: number) => {
    const barbs = Array.from({ length: 9 }, (_, i) => {
      const t = (i + 1) / 10;
      const yy = -len * t;
      const w = len * 0.17 * Math.sin(Math.PI * t);
      return `<path d="M0 ${yy.toFixed(1)} q${(w * 0.9).toFixed(1)} ${(-len * 0.05).toFixed(1)} ${w.toFixed(1)} ${(-len * 0.11).toFixed(1)} M0 ${yy.toFixed(1)} q${(-w * 0.9).toFixed(1)} ${(-len * 0.05).toFixed(1)} ${(-w).toFixed(1)} ${(-len * 0.11).toFixed(1)}"/>`;
    }).join('');
    return `<g transform="translate(${x} ${y}) rotate(${rot})" opacity="${op}"><path d="M0 0 C${len * 0.2} ${-len * 0.35} ${len * 0.16} ${-len * 0.8} 0 ${-len} C${-len * 0.16} ${-len * 0.8} ${-len * 0.2} ${-len * 0.35} 0 0 Z" fill="${fill}"/><g fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".35">${barbs}</g><line x1="0" y1="4" x2="0" y2="${-len}" stroke="#fff" stroke-opacity=".25" stroke-width=".5"/></g>`;
  };
  const wing = (flip: boolean, color: string, edge: string) => {
    let f = '';
    for (let i = 0; i < 7; i++) {
      const len = 40 - i * 3.6;
      f += `<path d="M50 78 Q${30 - i * 2} ${70 - i * 7} ${14 - i * 1.2} ${58 - i * 8} Q${24 - i} ${66 - i * 5} ${50 - len * 0.1} ${80 + i * 0.5} Z" fill="${color}" opacity="${0.55 + i * 0.06}" stroke="${edge}" stroke-width=".5"/>`;
    }
    return `<g ${flip ? 'transform="translate(100 0) scale(-1 1)"' : ''}>${f}</g>`;
  };
  const stars = (seed: string, n: number, color: string) => {
    const r = new Rand(seed);
    let o = '';
    for (let i = 0; i < n; i++) {
      const x = r.range(6, 94);
      const y = r.range(6, 140);
      const sz = r.range(0.6, 2.2);
      o += `<path d="M${x} ${y - sz * 2} L${x + sz * 0.5} ${y - sz * 0.5} L${x + sz * 2} ${y} L${x + sz * 0.5} ${y + sz * 0.5} L${x} ${y + sz * 2} L${x - sz * 0.5} ${y + sz * 0.5} L${x - sz * 2} ${y} L${x - sz * 0.5} ${y - sz * 0.5} Z" fill="${color}" opacity="${r.range(0.4, 1).toFixed(2)}"/>`;
    }
    return o;
  };
  return [
    {
      id: 'stardust-wings',
      name: 'Stardust Wings',
      color: '#c9d6ec',
      svg: () =>
        sleeveSvg(
          `<rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="url(#sdbg)"/>
          <ellipse cx="50" cy="76" rx="44" ry="56" fill="url(#sdglow)"/>
          ${wing(false, '#e9f2ff', '#7fa4d8')}${wing(true, '#e9f2ff', '#7fa4d8')}
          <path d="M50 30 L53 74 L50 112 L47 74 Z" fill="#fff" opacity=".9"/>
          ${stars('stardust', 26, '#ffffff')}`,
          `<linearGradient id="sdbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b4a86"/><stop offset=".5" stop-color="#9fb6de"/><stop offset="1" stop-color="#1b2f5c"/></linearGradient>
          <radialGradient id="sdglow"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
          '#9fb6de',
          0.3,
        ),
    },
    {
      id: 'black-feather',
      name: 'Black Feather',
      color: '#101422',
      svg: () => {
        const r = new Rand('blackfeather');
        let f = '';
        for (let i = 0; i < 14; i++) f += feather(r.range(8, 92), r.range(30, 150), r.range(26, 48), r.range(-40, 40), i % 3 ? '#2a3456' : '#4a5f9e', r.range(0.6, 1));
        return sleeveSvg(
          `${f}<circle cx="50" cy="73" r="22" fill="none" stroke="#5d7bd6" stroke-opacity=".35" stroke-width=".8"/>`,
          '',
          '#070910',
          0.28,
        );
      },
    },
    {
      id: 'synchro-rings',
      name: 'Synchro Rings',
      color: '#0d2a1a',
      svg: () => {
        let rings = '';
        for (let i = 0; i < 6; i++)
          rings += `<ellipse cx="50" cy="${40 + i * 13}" rx="${38 - Math.abs(i - 2.5) * 5}" ry="5.5" fill="none" stroke="#5cff9d" stroke-width="${1.6 - i * 0.12}" opacity="${0.9 - i * 0.08}"/>`;
        return sleeveSvg(
          `<rect width="${W}" height="${H}" rx="4" fill="url(#syn)"/>
          <path d="M50 18 L50 128" stroke="#c9ffe0" stroke-width="2.2" opacity=".75"/>
          <path d="M50 18 L50 128" stroke="#5cff9d" stroke-width="7" opacity=".18"/>
          ${rings}
          ${stars('synchro', 16, '#d9ffe9')}`,
          '<radialGradient id="syn" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#1d6b3f"/><stop offset=".6" stop-color="#0b2d1a"/><stop offset="1" stop-color="#030d07"/></radialGradient>',
          '#0b2d1a',
        );
      },
    },
    {
      id: 'crimson-mark',
      name: 'Crimson Mark',
      color: '#3a0508',
      svg: () =>
        sleeveSvg(
          `<rect width="${W}" height="${H}" rx="4" fill="url(#crm)"/>
          <g fill="none" stroke="#ff3b3b" stroke-linecap="round" filter="url(#cglow)">
            <path d="M28 48 C40 40 60 40 72 48 C64 50 58 56 56 64" stroke-width="3"/>
            <path d="M34 92 C42 104 58 104 66 92 C58 94 52 90 50 82" stroke-width="3"/>
            <path d="M50 58 L50 86 M40 72 L60 72" stroke-width="2.4"/>
            <path d="M22 70 C26 62 30 60 36 62 M78 70 C74 62 70 60 64 62" stroke-width="2"/>
          </g>`,
          `<radialGradient id="crm" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#5c0a10"/><stop offset=".65" stop-color="#22030a"/><stop offset="1" stop-color="#0b0103"/></radialGradient>
          <filter id="cglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
          '#22030a',
        ),
    },
    {
      id: 'championship-gold',
      name: 'Championship Prize',
      color: '#15110a',
      svg: () => {
        let laurel = '';
        for (let i = 0; i < 9; i++) {
          const a = 200 + i * 15;
          const rad = (a * Math.PI) / 180;
          const x = 50 + 26 * Math.cos(rad);
          const y = 78 + 26 * Math.sin(rad);
          laurel += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.2" ry="5" transform="rotate(${a + 100} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#gold)"/>`;
          const x2 = 100 - x;
          laurel += `<ellipse cx="${x2.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.2" ry="5" transform="rotate(${-(a + 100)} ${x2.toFixed(1)} ${y.toFixed(1)})" fill="url(#gold)"/>`;
        }
        return sleeveSvg(
          `<rect x="5" y="5" width="90" height="136" rx="3" fill="none" stroke="url(#gold)" stroke-width="1.6"/>
          <rect x="8" y="8" width="84" height="130" rx="2" fill="none" stroke="url(#gold)" stroke-width=".5"/>
          ${laurel}
          <path d="M50 58 L54 70 L66 70 L56 77 L60 89 L50 82 L40 89 L44 77 L34 70 L46 70 Z" fill="url(#gold)"/>
          <rect x="22" y="104" width="56" height="9" rx="1.5" fill="url(#gold)"/>
          <text x="50" y="110.6" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="5.4" letter-spacing="1.2" fill="#1a1206">CHAMPION</text>
          <text x="50" y="125" text-anchor="middle" font-family="Georgia, serif" font-size="4" letter-spacing="1.6" fill="#d8b45a">EDISON · 2010</text>`,
          `<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".3" stop-color="#d8a43a"/><stop offset=".6" stop-color="#fbe39a"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>`,
          '#121010',
        );
      },
    },
    {
      id: 'gloss-blue',
      name: 'Classic Gloss Blue',
      color: '#1747b5',
      svg: () => sleeveSvg(`<rect width="${W}" height="${H}" rx="4" fill="url(#gb)"/>`, '<linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f7af0"/><stop offset=".5" stop-color="#1747b5"/><stop offset="1" stop-color="#0a2263"/></linearGradient>', '#1747b5', 0.55),
    },
    {
      id: 'gloss-red',
      name: 'Classic Gloss Red',
      color: '#b3141c',
      svg: () => sleeveSvg(`<rect width="${W}" height="${H}" rx="4" fill="url(#gr)"/>`, '<linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f04a4a"/><stop offset=".5" stop-color="#b3141c"/><stop offset="1" stop-color="#5a060b"/></linearGradient>', '#b3141c', 0.55),
    },
  ];
}

/** Solid matte sleeves like the ones players actually sleeve their decks in. */
function matteSleeves() {
  const mk = (id: string, name: string, color: string, light: string, dark: string, foil = false) => ({
    id,
    name,
    color,
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="${id.length * 7}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter>
<radialGradient id="body" cx="32%" cy="22%" r="95%"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></radialGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${foil ? 0.45 : 0.16}"/><stop offset=".32" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity="${foil ? 0.22 : 0.05}"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="4" fill="url(#body)"/>
<rect width="${W}" height="${H}" rx="4" filter="url(#grain)" opacity="${foil ? 0.35 : 0.6}"/>
<g fill="none" stroke="#000" stroke-opacity=".22" stroke-width=".9" transform="translate(50 120)"><path d="M0 -7 L7 0 L0 7 L-7 0 Z"/><path d="M0 -3.5 L3.5 0 L0 3.5 L-3.5 0 Z"/></g>
<g fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".9" transform="translate(50.4 120.4)"><path d="M0 -7 L7 0 L0 7 L-7 0 Z"/></g>
<rect width="${W}" height="${H}" rx="4" fill="url(#sheen)"/>
<rect x=".7" y=".7" width="${W - 1.4}" height="${H - 1.4}" rx="3.6" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.1"/>
<rect x="2.2" y="2.2" width="${W - 4.4}" height="${H - 4.4}" rx="2.8" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".6"/>
</svg>`,
  });
  return [
    mk('matte-black', 'Matte Black', '#18181d', '#3a3a44', '#050507'),
    mk('matte-red', 'Matte Red', '#9e1b22', '#d6454a', '#4a070c'),
    mk('matte-blue', 'Matte Blue', '#1f448f', '#4e7fd6', '#0b1d47'),
    mk('matte-white', 'Matte White', '#e4e1d8', '#ffffff', '#a9a59a'),
    mk('matte-purple', 'Matte Purple', '#52307f', '#8a5fc4', '#22103c'),
    mk('matte-green', 'Matte Green', '#1e6b3c', '#46a86a', '#0a2f19'),
    mk('matte-sky', 'Matte Sky Blue', '#3b8fd1', '#7cc0f2', '#174a78'),
    mk('gold-foil', 'Gold Foil', '#b8892b', '#f6dc8e', '#6a4810', true),
    mk('silver-foil', 'Silver Foil', '#8d96a3', '#f1f4f8', '#3e4652', true),
  ];
}

const uriCache = new Map<string, string>();

function sleeveUri(id: string): string {
  const d = DESIGNS.find((x) => x.id === id) ?? DESIGNS[0];
  let u = uriCache.get(d.id);
  if (!u) {
    u = svgUri(d.svg());
    uriCache.set(d.id, u);
  }
  return u;
}

export const CUSTOM_ID = 'custom';

/** Only plain, real-world sleeves are offered: solid matte/gloss colours and the classic card back. */
const OFFERED = ['matte-black', 'classic-back', 'matte-red', 'matte-blue', 'matte-purple', 'matte-white', 'matte-green', 'matte-sky', 'gloss-blue', 'gloss-red', 'gold-foil', 'silver-foil'];
const ORDERED = OFFERED.map((id) => DESIGNS.find((d) => d.id === id)).filter((d): d is (typeof DESIGNS)[number] => !!d);

export const SLEEVES: Sleeve[] = [
  ...ORDERED.map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color,
    get css() {
      return `${sleeveUri(d.id)} center / 100% 100% no-repeat, ${d.color}`;
    },
    render(el: HTMLElement) {
      applySleeve(el, d.id);
    },
  })),
  {
    id: CUSTOM_ID,
    name: 'Your Upload',
    color: '#333',
    get css() {
      const img = getCustomImage('sleeve');
      if (!img) return `${sleeveUri(DESIGNS[0].id)} center / 100% 100% no-repeat, ${DESIGNS[0].color}`;
      return `url("${img}") center / cover no-repeat, #222`;
    },
    render(el: HTMLElement) {
      applySleeve(el, CUSTOM_ID);
    },
  },
];

export function sleeveById(id: string): Sleeve {
  return SLEEVES.find((s) => s.id === id) ?? SLEEVES[0];
}

/** Paint a card back onto `el` (sets its background). */
export function applySleeve(el: HTMLElement, id: string) {
  const s = sleeveById(id);
  el.style.background = s.css;
  el.dataset.sleeve = s.id;
}
