// Binder covers, modelled on the binders duelists carried in 2010: padded side-loading 9-pocket binders with an
// embossed dot texture and coloured stitching, a zip portfolio, and a plain vinyl 3-ring. Generic styles only: no
// brand names or logos. Like the mats and sleeves, these are material textures, not drawings.
import { svgUri } from './util';

export interface BinderCover {
  id: string;
  name: string;
  /** Short line for the picker. */
  description: string;
  /** Main colour (swatches, the spine). */
  color: string;
  /** CSS background of the front cover. */
  readonly css: string;
  /** Stitching colour around the cover. */
  stitch: string;
  /** Ink colour of the name label. */
  ink: string;
}

const grain = (alpha: number) =>
  `${svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="5" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${alpha} 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>`)} 0 0 / 160px 160px repeat`;

/** Raised dots pressed into padded vinyl: a highlight and a shadow per bump, in a staggered grid. */
const EMBOSS = [
  'radial-gradient(circle at 40% 35%, rgba(255,255,255,.22) 0 1.2px, transparent 1.9px) 0 0 / 9px 9px',
  'radial-gradient(circle at 60% 65%, rgba(0,0,0,.35) 0 1.4px, transparent 2.1px) 0 0 / 9px 9px',
  'radial-gradient(circle at 40% 35%, rgba(255,255,255,.22) 0 1.2px, transparent 1.9px) 4.5px 4.5px / 9px 9px',
  'radial-gradient(circle at 60% 65%, rgba(0,0,0,.35) 0 1.4px, transparent 2.1px) 4.5px 4.5px / 9px 9px',
].join(', ');

/** Soft light across a padded cover. */
const PADDED = 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.16), rgba(255,255,255,0) 55%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,.35) 100%)';

const padded = (id: string, name: string, color: string, light: string, dark: string, stitch: string): BinderCover => ({
  id: `padded-${id}`,
  name: `${name} padded`,
  description: 'Padded side-loading 9-pocket binder with an embossed cover.',
  color,
  stitch,
  ink: '#1a1a1a',
  get css() {
    return `${PADDED}, ${EMBOSS}, linear-gradient(160deg, ${light} 0%, ${color} 45%, ${dark} 100%)`;
  },
});

export const BINDERS: BinderCover[] = [
  padded('black', 'Black', '#1b1b20', '#34343c', '#08080a', '#7a7a86'),
  padded('red', 'Red', '#b0161f', '#e0444a', '#5a070c', '#2a0306'),
  padded('purple', 'Purple', '#5b2d91', '#8b5cc8', '#2a1046', '#e6d6ff'),
  padded('blue', 'Blue', '#1f4fa8', '#4f84e0', '#0b2156', '#cfe0ff'),
  padded('green', 'Green', '#1e7a43', '#47b06d', '#0a3a1d', '#d4f5df'),
  padded('pink', 'Pink', '#d14f86', '#f28bb4', '#6e1f42', '#fff0f6'),
  padded('orange', 'Orange', '#e06a14', '#ff9a4a', '#7a3203', '#2a1100'),
  padded('white', 'White', '#e8e6df', '#ffffff', '#a8a49a', '#5a5a62'),
  {
    id: 'zip-black',
    name: 'Zip portfolio',
    description: 'Black leatherette portfolio with a zip all the way round.',
    color: '#141416',
    stitch: '#3a3a40',
    ink: '#1a1a1a',
    get css() {
      // the zip: teeth along every edge
      const teeth = 'repeating-linear-gradient(90deg, #6d6d74 0 2px, #2a2a2e 2px 4px)';
      const teethV = 'repeating-linear-gradient(180deg, #6d6d74 0 2px, #2a2a2e 2px 4px)';
      return `${teeth} top / 100% 4px no-repeat, ${teeth} bottom / 100% 4px no-repeat, ${teethV} right / 4px 100% no-repeat, ${PADDED}, ${grain(0.09)}, linear-gradient(160deg, #2b2b30, #141416 50%, #060607)`;
    },
  },
  {
    id: 'vinyl-blue',
    name: 'Vinyl 3-ring',
    description: 'A plain glossy 3-ring binder with sheet protectors.',
    color: '#1b3d7a',
    stitch: 'transparent',
    ink: '#1a1a1a',
    get css() {
      return `linear-gradient(115deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,.08) 55%, rgba(255,255,255,0) 70%), ${grain(0.05)}, linear-gradient(160deg, #2c5bb0, #1b3d7a 50%, #0c1d40)`;
    },
  },
];

export const DEFAULT_BINDER = 'padded-black';

export function binderById(id: string | undefined): BinderCover {
  return BINDERS.find((b) => b.id === id) ?? BINDERS[0];
}

/** Each Locals regular carries their own binder (the trade screens show it). */
const REGULAR_BINDERS: Record<string, string> = {
  marcus: 'padded-black', // store champion: all business
  priya: 'padded-purple',
  dave: 'zip-black', // the phone-book-sized trade binder
  theo: 'padded-white', // Lightsworn
  nadia: 'padded-red',
  kenji: 'padded-blue',
  jonah: 'padded-green',
  felix: 'padded-orange',
  gus: 'vinyl-blue', // a plain 3-ring from the drugstore
};

export function regularBinder(id: string): BinderCover {
  const known = REGULAR_BINDERS[id];
  if (known) return binderById(known);
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BINDERS[h % BINDERS.length];
}

/** Inline style for a cover element (`.bd-cover`). */
export const coverStyle = (b: BinderCover) => ({ background: b.css, '--stitch': b.stitch, '--ink': b.ink, '--spine': b.color });
