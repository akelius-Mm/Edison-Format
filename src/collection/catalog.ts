// Resolves the real set lists against the simulator's card pool. Only implemented cards
// (findCard) can be pulled or owned; everything else is counted as "left out".
import { findCard } from '../cards';
import { ERA_SETS, STRUCTURE_DECKS } from './sets';
import { RARITY_ORDER, type EraSetData, type Rarity, type StructureDeckData } from './types';

/** Official product image for a set code (loads on the phone; may be blocked in sandboxes). */
/** Full-size English booster artwork (Yugipedia, via the YGOJSON set data). */
const PACK_ART: Record<string, string> = {
  ABPF: 'https://ms.yugipedia.com//2/2c/ABPF-BoosterEN.png',
  ANPR: 'https://ms.yugipedia.com//4/42/ANPR-BoosterEN.jpg',
  CRMS: 'https://ms.yugipedia.com//b/b8/CRMS-BoosterEN.jpg',
  CSOC: 'https://ms.yugipedia.com//0/0e/CSOC-Booster-EN-1E.jpg',
  GLAS: 'https://ms.yugipedia.com//4/47/GLAS-BoosterEN.png',
  GLD1: 'https://ms.yugipedia.com//0/0c/GLD1-BoosterEN.png',
  GLD2: 'https://ms.yugipedia.com//4/4b/GLD2-BoosterEN.png',
  GLD3: 'https://ms.yugipedia.com//7/73/GLD3-BoosterEN.png',
  HA01: 'https://ms.yugipedia.com//f/fd/HA01-BoosterEN.png',
  LODT: 'https://ms.yugipedia.com//1/15/LODT-Booster-EN-1E.png',
  PTDN: 'https://ms.yugipedia.com//0/07/PTDN-BoosterEN.png',
  RGBT: 'https://ms.yugipedia.com//5/52/RGBT-BoosterEN.png',
  SOVR: 'https://ms.yugipedia.com//4/4e/SOVR-BoosterEN.jpg',
  TDGS: 'https://ms.yugipedia.com//5/53/TDGS-BoosterEN.jpg',
  TSHD: 'https://ms.yugipedia.com//9/93/TSHD-BoosterEN.png',
  TU01: 'https://ms.yugipedia.com//6/6f/TU01-BoosterEN.jpg',
  TU02: 'https://ms.yugipedia.com//2/25/TU02-BoosterEN.jpg',
  TU03: 'https://ms.yugipedia.com//9/93/TU03-BoosterEN.jpg',
};
/** Small fallback pack image (YGOPRODeck). */
export const packThumbUrl = (code: string) => `https://images.ygoprodeck.com/images/sets/${code}.jpg`;
/** Best pack image for a set: the full-size artwork when known, else the small one. */
export const packImageUrl = (code: string) => PACK_ART[code] ?? packThumbUrl(code);

/** Names the pool spells differently from the printed English name. */
const ALIASES: Record<string, string> = {
  'Red-Eyes Black Dragon': 'Red-Eyes B. Dragon',
};

/** The pool's card name for a printed name, or null when the card isn't implemented. */
export function poolName(printed: string): string | null {
  return findCard(ALIASES[printed] ?? printed)?.name ?? null;
}

export interface PlayableSet {
  data: EraSetData;
  code: string;
  /** Playable card names per printed rarity. */
  pools: Partial<Record<Rarity, string[]>>;
  /** Unique playable card names in set order. */
  playable: string[];
  /** Every rarity each playable card was printed in, in this set. */
  rarities: Map<string, Rarity[]>;
  /** Unique cards printed in the set. */
  printed: number;
  /** Printed cards that aren't implemented yet. */
  leftOut: number;
  /** Released by the Edison cut-off (TSHD and later never are). */
  legal: boolean;
  /** Complete enough to sell and draft: at least READY_SHARE of its printed cards are playable. */
  ready: boolean;
  /** On the spring-2010 shelf (EDISON_SHELF) with enough playable cards. Starter gifts and prizes use these. */
  onShelf: boolean;
  /** Sold in the shop: the shelf, plus complete older legal sets when "Shop shows" is "All Edison-legal sets". */
  readonly available: boolean;
  /** Unopened packs of this set can be kept and opened (shelf, or any complete legal set). */
  readonly openable: boolean;
}

/** A set needs at least this many playable cards before its packs are offered. */
export const MIN_PLAYABLE = 5;

/**
 * Packs on the shelf at Edison time (spring 2010): the current boosters plus that season's Turbo Packs.
 * Older boosters stay in the data (so the Binder knows their cards) but aren't sold, opened or awarded;
 * The Shining Darkness, Gold Series 3 and Turbo Pack 3 came out after Edison.
 */
export const EDISON_SHELF = new Set(['ABPF', 'SOVR', 'ANPR', 'HA01', 'TU01', 'TU02']);

/** Last day of the Edison Format (the April 2010 list); later products are never offered. */
export const EDISON_CUTOFF = '2010-04-24';

/** A set counts as complete (shop and draft) once this share of its printed cards is playable. */
export const READY_SHARE = 0.85;

export const isEdisonLegalDate = (iso: string) => iso <= EDISON_CUTOFF;

// ------------------------------------------------------------------ shop preference

/** What the Packs shop sells: the spring-2010 shelf (default) or every complete Edison-legal set. */
export type ShopShows = 'shelf' | 'legal';
const SHOP_KEY = 'edison.shop.shows.v1';
let shopPref: ShopShows | null = null;

export function shopShows(): ShopShows {
  if (shopPref) return shopPref;
  try {
    shopPref = typeof localStorage !== 'undefined' && localStorage.getItem(SHOP_KEY) === 'legal' ? 'legal' : 'shelf';
  } catch {
    shopPref = 'shelf';
  }
  return shopPref;
}

export function setShopShows(v: ShopShows) {
  shopPref = v;
  try {
    if (v === 'legal') localStorage.setItem(SHOP_KEY, 'legal');
    else localStorage.removeItem(SHOP_KEY);
  } catch {
    /* storage unavailable: keep for this session */
  }
}

/** Complete Edison-legal sets that are not on the 2010 shelf (what "All Edison-legal sets" adds). */
export function olderLegalSets(): { ready: PlayableSet[]; soon: PlayableSet[] } {
  const older = playableSets().filter((s) => s.legal && !s.onShelf && s.data.format !== 'turbo');
  return { ready: older.filter((s) => s.ready), soon: older.filter((s) => !s.ready) };
}

let cache: Map<string, PlayableSet> | null = null;

function build(): Map<string, PlayableSet> {
  const m = new Map<string, PlayableSet>();
  for (const data of ERA_SETS) {
    const pools: Partial<Record<Rarity, string[]>> = {};
    const playable: string[] = [];
    const rarities = new Map<string, Rarity[]>();
    for (const [printed, ...rs] of data.cards) {
      const name = poolName(printed);
      if (!name) continue;
      if (!rarities.has(name)) playable.push(name);
      rarities.set(name, [...(rarities.get(name) ?? []), ...rs]);
      for (const r of rs) (pools[r] ??= []).push(name);
    }
    const enough = playable.length >= MIN_PLAYABLE;
    const legal = isEdisonLegalDate(data.released);
    const ready = legal && enough && playable.length / Math.max(1, data.cards.length) >= READY_SHARE;
    const onShelf = EDISON_SHELF.has(data.code) && enough;
    m.set(data.code, {
      data,
      code: data.code,
      pools,
      playable,
      rarities,
      printed: data.cards.length,
      leftOut: data.cards.length - playable.length,
      legal,
      ready,
      onShelf,
      get available() {
        return onShelf || (ready && shopShows() === 'legal');
      },
      get openable() {
        return onShelf || ready;
      },
    });
  }
  return m;
}

export function playableSets(): PlayableSet[] {
  cache ??= build();
  return [...cache.values()];
}

export function playableSet(code: string): PlayableSet | undefined {
  cache ??= build();
  return cache.get(code.toUpperCase());
}

/** Structure deck contents limited to implemented cards. */
export function structureDeckCards(d: StructureDeckData): { name: string; rarity: Rarity; copies: number }[] {
  const out: { name: string; rarity: Rarity; copies: number }[] = [];
  for (const [printed, rarity, copies] of d.cards) {
    const name = poolName(printed);
    if (name) out.push({ name, rarity, copies });
  }
  return out;
}

export function structureDeck(code: string) {
  return STRUCTURE_DECKS.find((d) => d.code === code.toUpperCase());
}

/** Every era set a card appears in (for the binder). */
export function setsForCard(name: string): { code: string; rarities: Rarity[] }[] {
  const out: { code: string; rarities: Rarity[] }[] = [];
  for (const s of playableSets()) {
    const rs = s.rarities.get(name);
    if (rs) out.push({ code: s.code, rarities: rs });
  }
  return out;
}

export const rarityRank = (r: Rarity) => RARITY_ORDER.indexOf(r);
