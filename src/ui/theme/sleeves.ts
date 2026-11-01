// Card sleeves, as players actually sleeved their decks in 2010: solid matte colours, gloss colours, foil, and art
// sleeves (a card's official artwork on the back, with a gloss finish). Nothing is drawn: the plain sleeves are a
// colour with plastic grain and sheen, and art sleeves use the card's official artwork (YGOPRODeck, the same source
// as the card images; see ../cards/officialArt.ts). Without the artwork an art sleeve shows as a plain dark sleeve.
import { cachedOfficialImage, getOfficialImage, officialArtEnabled } from '../cards/officialArt';
import { customSrc } from './customImages';
import { svgUri } from './util';

export interface Sleeve {
  id: string;
  name: string;
  /** Dominant colour (for UI chips / fallbacks). */
  color: string;
  /** Card whose official artwork is on the back (art sleeves). */
  art?: string;
  /** CSS `background` value for the card back. */
  readonly css: string;
  render(el: HTMLElement): void;
}

const W = 100;
const H = 146;

/** The plastic: grain, a diagonal sheen and the sleeve's clear edge. `gloss` 0..1. */
function plastic(gloss: number, grain: number, seed: number) {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs>
<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 ${grain} 0"/></filter>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${(0.12 + gloss * 0.35).toFixed(2)}"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity="${(0.03 + gloss * 0.17).toFixed(2)}"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="4" filter="url(#g)"/>
<rect width="${W}" height="${H}" rx="4" fill="url(#s)"/>
<rect x=".7" y=".7" width="${W - 1.4}" height="${H - 1.4}" rx="3.6" fill="none" stroke="#fff" stroke-opacity="${(0.18 + gloss * 0.12).toFixed(2)}" stroke-width="1.1"/>
<rect x="2.2" y="2.2" width="${W - 4.4}" height="${H - 4.4}" rx="2.8" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".6"/>
</svg>`);
}

const MATTE = plastic(0, 0.55, 11);
const GLOSS = plastic(1, 0.25, 13);
const FOIL = plastic(0.8, 0.35, 17);

interface Def {
  id: string;
  name: string;
  color: string;
  /** Colour body (a soft light falloff over the colour). */
  body?: string;
  finish: string;
  art?: string;
}

const solid = (id: string, name: string, color: string, light: string, dark: string, finish = MATTE): Def => ({
  id,
  name,
  color,
  body: `radial-gradient(ellipse at 32% 22%, ${light} 0%, ${color} 55%, ${dark} 100%)`,
  finish,
});

const PLAIN: Def[] = [
  solid('matte-black', 'Matte Black', '#18181d', '#3a3a44', '#050507'),
  solid('matte-red', 'Matte Red', '#9e1b22', '#d6454a', '#4a070c'),
  solid('matte-blue', 'Matte Blue', '#1f448f', '#4e7fd6', '#0b1d47'),
  solid('matte-purple', 'Matte Purple', '#52307f', '#8a5fc4', '#22103c'),
  solid('matte-white', 'Matte White', '#e4e1d8', '#ffffff', '#a9a59a'),
  solid('matte-green', 'Matte Green', '#1e6b3c', '#46a86a', '#0a2f19'),
  solid('matte-sky', 'Matte Sky Blue', '#3b8fd1', '#7cc0f2', '#174a78'),
  solid('matte-pink', 'Matte Pink', '#c2557f', '#ec8db0', '#6a1f3e'),
  solid('gloss-blue', 'Gloss Blue', '#1747b5', '#3f7af0', '#0a2263', GLOSS),
  solid('gloss-red', 'Gloss Red', '#b3141c', '#f04a4a', '#5a060b', GLOSS),
  solid('gold-foil', 'Gold Foil', '#b8892b', '#f6dc8e', '#6a4810', FOIL),
  solid('silver-foil', 'Silver Foil', '#8d96a3', '#f1f4f8', '#3e4652', FOIL),
];

export const ART_SLEEVE_PREFIX = 'art:';
export const artSleeveId = (card: string) => ART_SLEEVE_PREFIX + card;
export const isArtSleeveId = (id: string) => id.startsWith(ART_SLEEVE_PREFIX);

/** Art sleeves offered in the picker; any other card can be chosen from the search there. */
export const ART_SLEEVE_CARDS = ['Stardust Dragon', 'Dark Armed Dragon', 'Black Rose Dragon', 'Judgment Dragon', 'Blackwing Armor Master', 'Gladiator Beast Gyzarus'];

const artDef = (card: string): Def => ({ id: artSleeveId(card), name: card, color: '#15161a', finish: GLOSS, art: card });

/** Older saves name sleeves that were drawn designs: each maps to the closest real sleeve. */
const LEGACY: Record<string, string> = {
  'classic-red': 'matte-red',
  'midnight-stars': 'matte-blue',
  'emerald-filigree': 'matte-green',
  'obsidian-deco': 'matte-black',
  'arcane-circle': 'matte-purple',
  'dragon-eye': 'matte-red',
  'frost-crystal': 'matte-sky',
  'solar-flare': 'gold-foil',
  'carbon-circuit': 'matte-black',
  'sakura-bloom': 'matte-pink',
  'ocean-tide': 'matte-sky',
  'royal-azure': 'matte-blue',
  'classic-back': 'matte-black',
  'stardust-wings': artSleeveId('Stardust Dragon'),
  'black-feather': artSleeveId('Blackwing Armor Master'),
  'synchro-rings': 'matte-green',
  'crimson-mark': artSleeveId('Black Rose Dragon'),
  'championship-gold': 'gold-foil',
};

function cssOf(d: Def): string {
  const url = d.art && officialArtEnabled() ? cachedOfficialImage(d.art)?.art : undefined;
  const layers = [`${d.finish} center / 100% 100% no-repeat`];
  if (url) layers.push(`url("${url}") center / cover no-repeat`);
  layers.push(d.body ?? `radial-gradient(ellipse at 32% 22%, #2c2d33 0%, ${d.color} 60%, #050507 100%)`);
  return layers.join(', ');
}

function build(d: Def): Sleeve {
  return {
    id: d.id,
    name: d.name,
    color: d.color,
    art: d.art,
    get css() {
      return cssOf(d);
    },
    render(el: HTMLElement) {
      applySleeve(el, d.id);
    },
  };
}

export const CUSTOM_ID = 'custom';

export const SLEEVES: Sleeve[] = [...PLAIN, ...ART_SLEEVE_CARDS.map(artDef)].map(build);

const artCache = new Map<string, Sleeve>();

export function sleeveById(id: string): Sleeve {
  if (id.startsWith('custom')) {
    const src = customSrc('sleeve', id);
    if (src) return { id, name: 'Your sleeve', color: '#222', css: `url("${src}") center / cover no-repeat, #222`, render: (el) => applySleeve(el, id) };
  }
  const real = LEGACY[id] ?? id;
  const found = SLEEVES.find((s) => s.id === real);
  if (found) return found;
  if (isArtSleeveId(real) && real.length > ART_SLEEVE_PREFIX.length) {
    let s = artCache.get(real);
    if (!s) artCache.set(real, (s = build(artDef(real.slice(ART_SLEEVE_PREFIX.length)))));
    return s;
  }
  return SLEEVES[0];
}

/** Paint a card back onto `el` (sets its background). Art sleeves repaint once their artwork is looked up. */
export function applySleeve(el: HTMLElement, id: string) {
  const s = sleeveById(id);
  el.style.background = s.css;
  el.dataset.sleeve = s.id;
  if (s.art && officialArtEnabled() && cachedOfficialImage(s.art) === undefined)
    void getOfficialImage(s.art).then((img) => {
      if (img && el.dataset.sleeve === s.id) el.style.background = s.css;
    });
}
