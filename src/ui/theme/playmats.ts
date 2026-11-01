// Playmats, modelled on what people actually duelled on in 2010: plain neoprene, the paper starter-deck mat,
// felt and a kitchen table, and card-art mats (the official card artwork printed on neoprene, the way prize mats
// and most players' own mats looked). Nothing here is drawn: surfaces are material textures, and every picture is
// the card's official artwork (YGOPRODeck, the same source as the card images; see ../cards/officialArt.ts).
// When the artwork can't load (offline before it was ever cached, or official images turned off) an art mat
// shows as plain neoprene in its base colour, with its event print and stitched edge.
import { cachedOfficialImage, getOfficialImage, officialArtEnabled } from '../cards/officialArt';
import { customSrc } from './customImages';
import { svgUri } from './util';

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
  /** Print official-style zone names ("Monster Card Zone"...) inside the zones. */
  printedZones?: boolean;
  /** Card whose official artwork is printed on the mat. */
  art?: string;
  /** Colour of the stitched edge. */
  edge?: string;
  /** CSS background value (reads the artwork cache, so it can change once the artwork is known). */
  readonly css: string;
}

// ---------------------------------------------------------------- materials (textures, not pictures)

const noiseTile = (size: number, freq: string, alpha: number, octaves = 3, seed = 7) =>
  svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${alpha} 0"/></filter><rect width="${size}" height="${size}" filter="url(#n)"/></svg>`,
  );

/** Neoprene: a fine, slightly uneven rubber grain. */
const NEOPRENE = `${noiseTile(240, '.95', 0.075)} 0 0 / 240px 240px repeat`;
/** Felt: a soft, directional nap. */
const FELT = `${noiseTile(200, '1.4 .9', 0.12, 4)} 0 0 / 200px 200px repeat`;
/** Paper: very fine grain. */
const PAPER = `${noiseTile(180, '1.6', 0.06, 2)} 0 0 / 180px 180px repeat`;
/** Overhead light: a soft hot spot and darker edges, like a photo of a mat on a table. */
const LIGHT = 'radial-gradient(ellipse at 50% 38%, rgba(255,255,255,.07), rgba(255,255,255,0) 60%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%)';
/** Where an art mat's picture is anchored when it is cropped: centred across, near the top (heads and faces). */
export const ART_FOCUS = 'center 15%';
/** Keeps zone lines readable over busy artwork. */
const ART_SCRIM = 'linear-gradient(rgba(0,0,0,.30), rgba(0,0,0,.30))';

const WOOD = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><filter id="w" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0035 .09" numOctaves="4" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 .55 .2  0 0 0 .32 .11  0 0 0 .16 .05  0 0 0 0 .55"/></filter><rect width="1600" height="1000" filter="url(#w)"/><g stroke="#000" stroke-opacity=".28" stroke-width="3">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="${i * 200 + 40}" x2="1600" y2="${i * 200 + 40}"/>`).join('')}</g></svg>`,
);

/** Printed text in a mat's corner (an event mat's name and date). */
const printLayer = (text: string, color: string) =>
  `${svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(200, text.length * 13)} 30"><text x="100%" y="21" text-anchor="end" font-family="Arial Narrow, Arial, Helvetica, sans-serif" font-weight="700" font-size="18" letter-spacing="3" fill="${color}" fill-opacity=".85">${text}</text></svg>`)} right 3.5% bottom 4% / auto 5.5% no-repeat`;

// ---------------------------------------------------------------- definitions

interface Def {
  id: string;
  name: string;
  description: string;
  base: string;
  accent: string;
  zoneLine: string;
  zoneFill: string;
  printedZones?: boolean;
  /** Surface under everything (also what an art mat shows while its artwork is missing). */
  surface: string;
  /** Material texture over the surface. */
  texture?: string;
  art?: string;
  print?: string;
  edge?: string;
}

const neoprene = (base: string, mid: string, dark: string) => `radial-gradient(ellipse at 50% 45%, ${mid} 0%, ${base} 60%, ${dark} 100%)`;

const PLAIN: Def[] = [
  {
    id: 'tournament-black',
    name: 'Black Neoprene',
    description: 'A plain black rubber-backed mat with white zone printing.',
    base: '#111215',
    accent: '#e8e8e8',
    zoneLine: 'rgba(240,240,240,.62)',
    zoneFill: 'rgba(255,255,255,.025)',
    surface: neoprene('#121316', '#202227', '#08090b'),
    texture: NEOPRENE,
    edge: 'rgba(255,255,255,.16)',
  },
  {
    id: 'neo-navy',
    name: 'Navy Neoprene',
    description: 'Plain navy rubber-backed mat.',
    base: '#101a33',
    accent: '#dfe7f5',
    zoneLine: 'rgba(225,235,250,.6)',
    zoneFill: 'rgba(255,255,255,.03)',
    surface: neoprene('#121d3a', '#1c2c55', '#070c1a'),
    texture: NEOPRENE,
    edge: 'rgba(225,235,250,.2)',
  },
  {
    id: 'neo-red',
    name: 'Red Neoprene',
    description: 'Plain deep red rubber-backed mat.',
    base: '#3a0a0f',
    accent: '#ffe1dc',
    zoneLine: 'rgba(255,225,220,.58)',
    zoneFill: 'rgba(0,0,0,.08)',
    surface: neoprene('#3a0a0f', '#561219', '#170306'),
    texture: NEOPRENE,
    edge: 'rgba(255,225,220,.2)',
  },
  {
    id: 'starter-game-mat',
    name: 'Starter Deck Game Mat',
    description: 'The fold-out paper mat from a starter deck, zones printed and labelled.',
    base: '#1b3f73',
    accent: '#9fd2ff',
    zoneLine: 'rgba(190,226,255,.75)',
    zoneFill: 'rgba(120,180,255,.10)',
    printedZones: true,
    // the fold lines of a mat that lives folded in the deck box
    surface:
      'linear-gradient(180deg, rgba(0,0,0,0) 49.6%, rgba(8,22,44,.55) 50%, rgba(255,255,255,.06) 50.4%, rgba(0,0,0,0) 51%), linear-gradient(90deg, rgba(0,0,0,0) 49.8%, rgba(8,22,44,.35) 50%, rgba(0,0,0,0) 50.3%), linear-gradient(180deg, #24508f 0%, #1b3f73 48%, #16365f 52%, #1e477f 100%)',
    texture: PAPER,
  },
  {
    id: 'green-felt',
    name: 'Green Felt',
    description: 'Card-room felt with a soft woven nap.',
    base: '#0f3d26',
    accent: '#e9d9a6',
    zoneLine: 'rgba(240,226,180,.5)',
    zoneFill: 'rgba(0,0,0,.12)',
    surface: 'radial-gradient(ellipse at 50% 45%, #1d6b42 0%, #12472c 55%, #072316 100%)',
    texture: FELT,
  },
  {
    id: 'walnut-table',
    name: 'Walnut Table',
    description: 'No mat: duelling on the wooden kitchen table.',
    base: '#3b2414',
    accent: '#f0c98a',
    zoneLine: 'rgba(255,226,170,.5)',
    zoneFill: 'rgba(20,10,4,.28)',
    surface: `linear-gradient(135deg, rgba(255,255,255,.1) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,.25) 100%), ${WOOD} center / cover no-repeat, linear-gradient(180deg, #5a361d 0%, #3d2412 50%, #4d2e17 100%)`,
  },
];

/** An art mat: a card's official artwork printed on black neoprene. */
function artDef(card: string, extra: Partial<Def> = {}): Def {
  return {
    id: artMatId(card),
    name: card,
    description: `${card} printed on a neoprene mat.`,
    base: '#0e0f12',
    accent: '#f0f0f0',
    zoneLine: 'rgba(255,255,255,.66)',
    zoneFill: 'rgba(0,0,0,.18)',
    surface: neoprene('#121316', '#1c1d22', '#08090b'),
    texture: NEOPRENE,
    art: card,
    edge: 'rgba(0,0,0,.55)',
    ...extra,
  };
}

export const ART_MAT_PREFIX = 'art:';
export const artMatId = (card: string) => ART_MAT_PREFIX + card;
export const isArtMatId = (id: string) => id.startsWith(ART_MAT_PREFIX);

/** Art mats offered in the picker; any other card can be printed from the search there. */
export const ART_MAT_CARDS = [
  'Dark Armed Dragon',
  'Stardust Dragon',
  'Black Rose Dragon',
  'Judgment Dragon',
  'Gladiator Beast Gyzarus',
  'Blackwing Armor Master',
  'Caius the Shadow Monarch',
  'Machina Fortress',
];

// ---------------------------------------------------------------- prestige mats
// Six tournament mats earned by playing the big events (unlock rules: src/events/matUnlocks.ts). Each is an art mat
// with the event printed in the corner and a coloured stitched edge, like the prize mats handed out in 2010.

const SILVER = '#dfe7f5';
const GOLD = '#f2d27a';

const PRESTIGE: Def[] = [
  artDef('Brionac, Dragon of the Ice Barrier', {
    id: 'regional-silver',
    name: 'Regional Qualifier · Silver Series',
    description: 'Brionac on navy neoprene, silver stitching and the 2010 Regional print.',
    base: '#0c1632',
    accent: SILVER,
    surface: neoprene('#0c1632', '#1a2b55', '#04081a'),
    print: 'REGIONAL QUALIFIER · 2010 SEASON',
    edge: SILVER,
    printedZones: true,
    zoneLine: 'rgba(214,224,242,.7)',
  }),
  artDef('Goyo Guardian', {
    id: 'regional-top16',
    name: 'Regional Top Cut',
    description: 'Goyo Guardian with gold stitching: handed to the Regional top cut.',
    base: '#0f1d44',
    accent: GOLD,
    surface: neoprene('#0f1d44', '#203a75', '#050a1d'),
    print: 'REGIONAL QUALIFIER · TOP CUT',
    edge: GOLD,
    printedZones: true,
    zoneLine: 'rgba(240,214,140,.75)',
  }),
  artDef('Black Luster Soldier - Envoy of the Beginning', {
    id: 'championship-edison',
    name: 'Championship Series · Edison',
    description: 'Black Luster Soldier, dated for the weekend the format is named after.',
    base: '#2a070d',
    accent: '#ffd9cf',
    surface: neoprene('#2a070d', '#4a0f18', '#0b0204'),
    print: 'EDISON, NJ · APRIL 24–25, 2010',
    edge: '#c2333f',
    printedZones: true,
    zoneLine: 'rgba(255,214,200,.65)',
  }),
  artDef('Arcanite Magician', {
    id: 'feature-table',
    name: 'Feature Table',
    description: 'The mat on the camera tables: Arcanite Magician under the lights.',
    base: '#0a1a33',
    accent: '#cfe6ff',
    surface: neoprene('#0a1a33', '#173a66', '#030812'),
    print: 'FEATURE MATCH',
    edge: '#cfe6ff',
    printedZones: true,
    zoneLine: 'rgba(190,224,255,.65)',
  }),
  artDef('Red Dragon Archfiend', {
    id: 'nationals-indy',
    name: 'National Championship 2010',
    description: 'Red Dragon Archfiend with gold stitching, from Nationals in Indianapolis.',
    base: '#0e0b05',
    accent: GOLD,
    surface: neoprene('#0e0b05', '#2a2210', '#030201'),
    print: 'NATIONAL CHAMPIONSHIP · INDIANAPOLIS 2010',
    edge: GOLD,
    printedZones: true,
    zoneLine: 'rgba(242,210,122,.75)',
  }),
  artDef('Ancient Fairy Dragon', {
    id: 'national-champion',
    name: 'National Champion',
    description: 'Ancient Fairy Dragon, gold stitching, numbered one of one.',
    base: '#0b0904',
    accent: '#f6dc8e',
    surface: neoprene('#0b0904', '#262012', '#000000'),
    print: 'NATIONAL CHAMPION 2010 · No. 001/001',
    edge: '#f6dc8e',
    printedZones: true,
    zoneLine: 'rgba(250,224,150,.8)',
  }),
];

/** Mats you earn at Regionals, the Championship Series and Nationals; locked until then. */
export const PRESTIGE_MAT_IDS = ['regional-silver', 'regional-top16', 'championship-edison', 'feature-table', 'nationals-indy', 'national-champion'] as const;
export type PrestigeMatId = (typeof PRESTIGE_MAT_IDS)[number];
export const isPrestigeMat = (id: string): id is PrestigeMatId => (PRESTIGE_MAT_IDS as readonly string[]).includes(id);

/** Older saves name mats that were drawn designs: each maps to the closest real mat. */
const LEGACY: Record<string, string> = {
  'edison-2010': artMatId('Dark Armed Dragon'),
  'championship-prize-mat': artMatId('Stardust Dragon'),
  'regional-qualifier-mat': artMatId('Black Rose Dragon'),
  'edison-night': 'neo-navy',
  'crimson-arena': 'neo-red',
  'verdant-grove': 'green-felt',
  'abyssal-depths': 'neo-navy',
  'molten-core': 'neo-red',
  'celestial-temple': 'neo-navy',
  'cyber-grid': 'tournament-black',
  'desert-ruins': 'walnut-table',
  'frozen-tundra': 'neo-navy',
  'shadow-realm': 'tournament-black',
};

// ---------------------------------------------------------------- building

/** The artwork's URL, once looked up (undefined while unknown or when official images are off). */
function artUrl(card: string | undefined): string | undefined {
  if (!card || !officialArtEnabled()) return undefined;
  return cachedOfficialImage(card)?.art;
}

function cssOf(d: Def): string {
  const layers: string[] = [];
  if (d.texture) layers.push(d.texture);
  layers.push(LIGHT);
  if (d.print) layers.push(printLayer(d.print, d.edge ?? d.accent));
  const url = artUrl(d.art);
  // A mat half is about twice as wide as the (square) artwork, so cover crops its top and bottom. Anchor near the
  // top, where card art keeps the head and face, instead of the middle (which cut Judgment Dragon's head off).
  if (url) layers.push(ART_SCRIM, `url("${url}") ${ART_FOCUS} / cover no-repeat`);
  layers.push(d.surface);
  return layers.join(', ');
}

function build(d: Def): Playmat {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    base: d.base,
    accent: d.accent,
    zoneLine: d.zoneLine,
    zoneFill: d.zoneFill,
    printedZones: d.printedZones,
    art: d.art,
    edge: d.edge,
    get css() {
      return cssOf(d);
    },
  };
}

export const CUSTOM_MAT_ID = 'custom';

/** Every offered mat: plain surfaces, the art mats, then the six event mats. */
export const PLAYMATS: Playmat[] = [...PLAIN, ...ART_MAT_CARDS.map((c) => artDef(c)), ...PRESTIGE].map(build);

const artCache = new Map<string, Playmat>();

export function playmatById(id: string): Playmat {
  if (id.startsWith('custom')) {
    const src = customSrc('mat', id);
    if (src)
      return { id, name: 'Your mat', description: 'Your own playmat photo.', base: '#111', accent: '#e8e8e8', zoneLine: 'rgba(255,255,255,.55)', zoneFill: 'rgba(0,0,0,.16)', edge: 'rgba(0,0,0,.5)', css: `url("${src}") center / cover no-repeat, #111` };
  }
  const real = LEGACY[id] ?? id;
  const found = PLAYMATS.find((p) => p.id === real);
  if (found) return found;
  if (isArtMatId(real) && real.length > ART_MAT_PREFIX.length) {
    let m = artCache.get(real);
    if (!m) artCache.set(real, (m = build(artDef(real.slice(ART_MAT_PREFIX.length)))));
    return m;
  }
  return PLAYMATS[0];
}

/** Once an art mat's artwork is looked up, paint it again (if the element still shows that mat). */
function whenArtKnown(el: HTMLElement, id: string, m: Playmat, paint: () => void) {
  if (!m.art || !officialArtEnabled() || cachedOfficialImage(m.art) !== undefined) return;
  void getOfficialImage(m.art).then((img) => {
    if (img && el.dataset.playmat === m.id && el.dataset.playmatReq === id) paint();
  });
}

function setVars(el: HTMLElement, id: string, m: Playmat) {
  el.style.setProperty('--mat-accent', m.accent);
  el.style.setProperty('--zone-line', m.zoneLine);
  el.style.setProperty('--zone-fill', m.zoneFill);
  el.style.setProperty('--mat-base', m.base);
  el.style.setProperty('--mat-edge', m.edge ?? 'rgba(255,255,255,.13)');
  el.dataset.playmat = m.id;
  el.dataset.playmatReq = id;
  el.dataset.matLabels = m.printedZones ? '1' : '';
}

/** Apply a playmat to an element: sets its background and the zone colour custom properties. */
export function applyPlaymat(el: HTMLElement, id: string) {
  const m = playmatById(id);
  el.style.background = m.css;
  setVars(el, id, m);
  // repaint only where the picture is still shown (the duel screen clears it and uses the zone colours only)
  whenArtKnown(el, id, m, () => {
    if (el.style.backgroundImage) applyPlaymat(el, id);
  });
}

/** Set a mat's zone colours on an element and expose its picture as --mat-bg (for one player's half). */
export function applyMatVars(el: HTMLElement, id: string) {
  const m = playmatById(id);
  el.style.setProperty('--mat-bg', m.css);
  setVars(el, id, m);
  whenArtKnown(el, id, m, () => applyMatVars(el, id));
}

/** The opponent brings their own mat: a stable pick per opponent name, never the same as yours. */
export function opponentMat(oppName: string, mine: string): string {
  const pool = PLAYMATS.filter((m) => m.id !== mine && m.id !== 'green-felt' && m.id !== 'walnut-table' && m.id !== 'starter-game-mat' && !isPrestigeMat(m.id));
  let h = 0;
  for (const ch of oppName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (pool[h % pool.length] ?? PLAYMATS[0]).id;
}
