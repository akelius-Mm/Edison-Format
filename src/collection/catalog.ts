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
  /** Enough playable cards to make opening a pack worthwhile. */
  available: boolean;
}

/** A set needs at least this many playable cards before its packs are offered. */
export const MIN_PLAYABLE = 5;

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
    m.set(data.code, {
      data,
      code: data.code,
      pools,
      playable,
      rarities,
      printed: data.cards.length,
      leftOut: data.cards.length - playable.length,
      available: playable.length >= MIN_PLAYABLE,
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
