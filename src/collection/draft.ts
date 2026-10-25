// UI-free API for Draft Mode: draft with real era booster packs.
// Pure: generating a draft pack never touches the player's collection.
import type { Rng } from '../engine/rng';
import { findCard } from '../cards';
import { packImageUrl, playableSets } from './catalog';
import { PACK_FORMATS, rollPack } from './packs';
import type { Rarity } from './types';

/** Draft Mode's rarity scale (same as Rarity in src/draft/cards.ts). */
export type DraftRarity = 'C' | 'R' | 'SR' | 'UR' | 'ScR';

/**
 * Printed rarity → draft rarity. Short Prints are commons; Ultimate and Gold Rares count as
 * Ultra; Ghost Rares count as Secret.
 */
export function toDraftRarity(r: Rarity): DraftRarity {
  switch (r) {
    case 'C':
    case 'SP':
      return 'C';
    case 'R':
      return 'R';
    case 'SR':
      return 'SR';
    case 'UR':
    case 'UtR':
    case 'GUR':
      return 'UR';
    case 'ScR':
    case 'GR':
      return 'ScR';
  }
}

/**
 * A core booster needs at least this many implemented cards to be draftable. Below that a
 * 9-card pack is mostly repeats (SOVR has 5, TSHD 6, ABPF 2 at the time of writing). The list
 * is computed at load, so a set joins automatically once enough of its cards are scripted.
 */
export const DRAFT_MIN_PLAYABLE = 8;

export interface DraftSet {
  code: string;
  name: string;
  /** ISO date of the TCG release. */
  released: string;
  /** Official product image; render a fallback if it fails to load. */
  image: string;
  /** Cards per pack (9 for every core booster of the era). */
  cardsPerPack: number;
  /** Implemented cards in the set. */
  playable: number;
  /** Cards printed in the set. */
  printed: number;
}

function draftSets(): DraftSet[] {
  return playableSets()
    .filter((s) => (s.data.format === 'core' || s.data.format === 'core-tshd') && s.playable.length >= DRAFT_MIN_PLAYABLE)
    .map((s) => ({
      code: s.code,
      name: s.data.name,
      released: s.data.released,
      image: packImageUrl(s.code),
      cardsPerPack: PACK_FORMATS[s.data.format].cardsPerPack,
      playable: s.playable.length,
      printed: s.printed,
    }));
}

/** Era core boosters with enough implemented cards to draft, in release order. */
export const DRAFT_SETS: readonly DraftSet[] = draftSets();

/**
 * One real booster of `code`, with the set's printed rarities and pack odds (the same generator
 * as pack opening). Deterministic for a seeded Rng, which it advances. Returns card ids
 * (CardData.id), commons first. Empty for an unknown set. Never adds cards to the collection.
 */
export function generateSetPack(code: string, rng: Rng): { id: string; r: DraftRarity }[] {
  const out: { id: string; r: DraftRarity }[] = [];
  for (const p of rollPack(code, rng)) {
    const c = findCard(p.name);
    if (c) out.push({ id: c.id, r: toDraftRarity(p.rarity) });
  }
  return out;
}
