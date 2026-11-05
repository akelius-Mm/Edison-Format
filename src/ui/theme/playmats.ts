// Playmats, modelled on what people actually duelled on in 2010: plain neoprene, the paper starter-deck mat,
// felt and a kitchen table, deck mats (several of a top deck's cards side by side), and card-art mats (the official card artwork printed on neoprene, the way prize mats
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
  /** Card whose official artwork is printed on the mat (a deck mat's centre card). */
  art?: string;
  /** A deck mat's three cards, left to right: the official artwork of each, collaged across the mat. */
  collage?: readonly string[];
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
/** Pushes a deck mat's side cards back behind its centre card. */
const SIDE_SCRIM = 'linear-gradient(rgba(0,0,0,.28), rgba(0,0,0,.28))';
/** A deck mat's centre panel is square (sized like the artwork) and this shades its two edges, so the cards
 *  behind meet it in a soft dark band with a thin printed line, not a hard seam. */
const collageSeam = (line: string) =>
  `${svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><linearGradient id="s"><stop offset="0" stop-color="#000" stop-opacity=".85"/><stop offset=".07" stop-color="#000" stop-opacity=".35"/><stop offset=".13" stop-color="#000" stop-opacity="0"/><stop offset=".87" stop-color="#000" stop-opacity="0"/><stop offset=".93" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient></defs><rect width="100" height="100" fill="url(#s)"/><g stroke="${line}" stroke-opacity=".55" stroke-width=".6"><line x1="1.2" y1="0" x2="1.2" y2="100"/><line x1="98.8" y1="0" x2="98.8" y2="100"/></g></svg>`)} center / auto 100% no-repeat`;

const WOOD = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><filter id="w" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0035 .09" numOctaves="4" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 .55 .2  0 0 0 .32 .11  0 0 0 .16 .05  0 0 0 0 .55"/></filter><rect width="1600" height="1000" filter="url(#w)"/><g stroke="#000" stroke-opacity=".28" stroke-width="3">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="${i * 200 + 40}" x2="1600" y2="${i * 200 + 40}"/>`).join('')}</g></svg>`,
);

/** Printed text in a mat's corner (an event mat's name and date). */
const printLayer = (text: string, color: string) =>
  `${svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(200, text.length * 17)} 30"><text x="100%" y="21" text-anchor="end" font-family="Arial Narrow, Arial, Helvetica, sans-serif" font-weight="700" font-size="18" letter-spacing="3" fill="${color}" fill-opacity=".85">${text}</text></svg>`)} right 3.5% bottom 4% / auto 5.5% no-repeat`;

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
  /** Deck mat: three cards, left / centre / right (centre = art). */
  collage?: readonly string[];
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

// ---------------------------------------------------------------- deck mats
// Archetype mats, like the official ones that put a deck's monsters side by side on one mat: three official
// artworks of a top Edison deck's key cards, the centre card in front and its two partners behind, with the deck's
// name printed in the corner. Each deck is one of the real 2010 tournament decks in src/decks/tournament*.ts.

/** A deck mat: [left, centre, right] cards on coloured neoprene. */
function deckDef(id: string, name: string, cards: readonly [string, string, string], c: { base: string; mid: string; dark: string; edge: string; line: string }, description: string): Def {
  return artDef(cards[1], {
    id,
    name,
    description,
    base: c.base,
    accent: c.edge,
    surface: neoprene(c.base, c.mid, c.dark),
    print: name.toUpperCase(),
    edge: c.edge,
    printedZones: true,
    zoneLine: c.line,
    collage: cards,
  });
}

const DECK: Def[] = [
  deckDef('deck-gladiator', 'Gladiator Beasts', ['Gladiator Beast Bestiari', 'Gladiator Beast Gyzarus', 'Gladiator Beast Heraklinos'], { base: '#2b1206', mid: '#4a2410', dark: '#0e0502', edge: '#e0a35a', line: 'rgba(240,196,140,.72)' }, 'Bestiari, Gyzarus and Heraklinos tagging in across bronze neoprene.'),
  deckDef('deck-blackwings', 'Blackwings', ['Blackwing - Shura the Blue Flame', 'Blackwing Armor Master', 'Blackwing - Kalut the Moon Shadow'], { base: '#0b0b14', mid: '#1c1a30', dark: '#030306', edge: '#9d8cff', line: 'rgba(196,186,255,.68)' }, 'Shura, Armor Master and Kalut on a midnight mat.'),
  deckDef('deck-lightsworn', 'Lightsworn', ['Ryko, Lightsworn Hunter', 'Judgment Dragon', 'Lyla, Lightsworn Sorceress'], { base: '#1d1a10', mid: '#3a3320', dark: '#0a0904', edge: '#f4e2a0', line: 'rgba(250,236,186,.75)' }, 'Ryko and Lyla flank Judgment Dragon on white-gold stitching.'),
  deckDef('deck-twilight', 'Twilight', ['Chaos Sorcerer', 'Dark Armed Dragon', 'Judgment Dragon'], { base: '#140d1c', mid: '#2a1c3a', dark: '#05030a', edge: '#d8c7ff', line: 'rgba(226,214,255,.7)' }, 'Light and dark together: Chaos Sorcerer, Dark Armed Dragon and Judgment Dragon.'),
  deckDef('deck-plant-synchro', 'Quickdraw Dandywarrior', ['Dandylion', 'Quickdraw Synchron', 'Lonefire Blossom'], { base: '#0c2212', mid: '#1a4224', dark: '#030c05', edge: '#9fe08a', line: 'rgba(196,240,180,.72)' }, 'The deck that won Edison: Dandylion, Quickdraw Synchron and Lonefire Blossom.'),
  deckDef('deck-machina-gadgets', 'Machina Gadgets', ['Green Gadget', 'Machina Fortress', 'Red Gadget'], { base: '#14181c', mid: '#2a3238', dark: '#05070a', edge: '#c9d4dc', line: 'rgba(214,224,232,.7)' }, 'Green and Red Gadget either side of Machina Fortress, on gunmetal neoprene.'),
  deckDef('deck-monarchs', 'Frog Monarchs', ['Raiza the Storm Monarch', 'Caius the Shadow Monarch', 'Treeborn Frog'], { base: '#170b22', mid: '#2e1844', dark: '#06030c', edge: '#c69bff', line: 'rgba(218,196,255,.7)' }, 'Raiza and Caius, with the Treeborn Frog that brings them back every turn.'),
  deckDef('deck-x-sabers', 'X-Sabers', ['XX-Saber Emmersblade', 'XX-Saber Faultroll', 'XX-Saber Hyunlei'], { base: '#20160a', mid: '#3f2b12', dark: '#0b0703', edge: '#f0b54a', line: 'rgba(246,206,140,.72)' }, 'Emmersblade, Faultroll and Hyunlei under amber stitching.'),
  deckDef('deck-gravekeepers', 'Gravekeepers', ["Gravekeeper's Spy", "Gravekeeper's Descendant", "Gravekeeper's Commandant"], { base: '#1e170c', mid: '#3a2d18', dark: '#0a0704', edge: '#d9b779', line: 'rgba(232,208,160,.7)' }, 'Spy, Descendant and Commandant guarding the valley.'),
  deckDef('deck-zombies', 'Zombies', ['Goblin Zombie', 'Zombie Master', 'Mezuki'], { base: '#0f1a12', mid: '#1f3424', dark: '#040805', edge: '#a8d6a0', line: 'rgba(196,232,190,.68)' }, 'Goblin Zombie, Zombie Master and Mezuki crawling out of the grave.'),
];

/** The deck mats, in the order they're offered. */
export const DECK_MAT_IDS = DECK.map((d) => d.id);

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
  if (d.collage) {
    // Deck mat: three square artworks at full height, left / centre / right. On a mat half (about 2–2.5 times as
    // wide as tall) they overlap a little, and the centre card sits in front with shaded edges.
    const [left, centre, right] = d.collage.map(artUrl);
    if (left || centre || right) layers.push(ART_SCRIM);
    if (centre) layers.push(collageSeam(d.edge ?? d.accent), `url("${centre}") center / auto 100% no-repeat`);
    if (left || right) layers.push(SIDE_SCRIM);
    if (left) layers.push(`url("${left}") left center / auto 100% no-repeat`);
    if (right) layers.push(`url("${right}") right center / auto 100% no-repeat`);
    layers.push(d.surface);
    return layers.join(', ');
  }
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
    collage: d.collage,
    edge: d.edge,
    get css() {
      return cssOf(d);
    },
  };
}

export const CUSTOM_MAT_ID = 'custom';

/** Every offered mat: plain surfaces, the art mats, the deck mats, then the six event mats. */
export const PLAYMATS: Playmat[] = [...PLAIN, ...ART_MAT_CARDS.map((c) => artDef(c)), ...DECK, ...PRESTIGE].map(build);

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
  if (!officialArtEnabled()) return;
  const unknown = (m.collage ?? (m.art ? [m.art] : [])).filter((c) => cachedOfficialImage(c) === undefined);
  if (!unknown.length) return;
  // a deck mat repaints once all three are known (one repaint, not three)
  void Promise.all(unknown.map(getOfficialImage)).then((imgs) => {
    if (imgs.some(Boolean) && el.dataset.playmat === m.id && el.dataset.playmatReq === id) paint();
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
