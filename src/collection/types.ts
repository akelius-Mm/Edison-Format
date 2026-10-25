// Shared types for the era collection (real 2007–2010 TCG products).

/**
 * Printed rarities of the era.
 * C Common · SP Short Print (a common printed less often) · R Rare · SR Super Rare · UR Ultra Rare ·
 * UtR Ultimate Rare · ScR Secret Rare · GR Ghost Rare · GUR Gold Rare (Gold Series).
 */
export type Rarity = 'C' | 'SP' | 'R' | 'SR' | 'UR' | 'UtR' | 'ScR' | 'GR' | 'GUR';

/** Low → high. Used for sorting, "best copy" and the empty-pool fallback in packs. */
export const RARITY_ORDER: Rarity[] = ['C', 'SP', 'R', 'SR', 'UR', 'UtR', 'ScR', 'GR', 'GUR'];

export const RARITY_NAMES: Record<Rarity, string> = {
  C: 'Common',
  SP: 'Short Print',
  R: 'Rare',
  SR: 'Super Rare',
  UR: 'Ultra Rare',
  UtR: 'Ultimate Rare',
  ScR: 'Secret Rare',
  GR: 'Ghost Rare',
  GUR: 'Gold Rare',
};

/** Pack layouts (see packs.ts for slots, odds and sources). */
export type PackFormat = 'core' | 'core-tshd' | 'hidden-arsenal' | 'turbo' | 'gold';

/** One real booster product, exactly as printed (all cards, implemented or not). */
export interface EraSetData {
  code: string;
  name: string;
  format: PackFormat;
  /** ISO date of the TCG release. */
  released: string;
  /** [deep, light] accent colours for the drawn fallback pack. */
  colors: [string, string];
  /** A chase card shown on the drawn fallback pack. */
  featured?: string;
  /** [card name, ...every rarity it was printed in within this set] */
  cards: [string, ...Rarity[]][];
}

/** A preconstructed Structure Deck. */
export interface StructureDeckData {
  code: string;
  name: string;
  released: string;
  colors: [string, string];
  featured?: string;
  /** [card name, rarity, copies] */
  cards: [string, Rarity, number][];
}

/** One card pulled from a pack. */
export interface Pull {
  name: string;
  rarity: Rarity;
}
