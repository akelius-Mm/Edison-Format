// Resolves the real set lists against the simulator's card pool. Only implemented cards
// (findCard) can be pulled or owned; everything else is counted as "left out".
import { findCard } from '../cards';
import { ERA_SETS, STRUCTURE_DECKS } from './sets';
import { RARITY_ORDER, type EraSetData, type Rarity, type StructureDeckData } from './types';

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
