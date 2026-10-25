// The spring 2010 Edison metagame: archetype shares, how premade decks map onto them, and the
// strength / matchup model used to simulate the other tables.
import { PREMADE_DECKS, type DeckDef } from '../decks';
import { rand, weighted, type RngState } from './rng';
import type { DeckSnapshot, MetaKey } from './types';

export interface MetaArchetype {
  key: MetaKey;
  label: string;
  /** Rough share of a Friday-night field, in percent. */
  share: number;
  /** Elo-style strength offset used by the table simulator. */
  strength: number;
  /** Matches a premade deck's archetype / name / id. Rogue has none: it takes everything else. */
  match?: RegExp;
}

/**
 * Ordered: the first pattern that matches a deck wins (so "Lightsworn Monarchs" counts as
 * Lightsworn). Shares follow the post-SJC Edison (April 2010) locals scene: Plants and
 * Blackwings on top, then Lightsworn and Frog Monarchs, then the second wave, then rogues.
 */
export const META: MetaArchetype[] = [
  { key: 'plants', label: 'Plant Synchro', share: 18, strength: 60, match: /plant|quickdraw|dandy/i },
  { key: 'blackwings', label: 'Blackwings', share: 16, strength: 55, match: /blackwing/i },
  { key: 'lightsworn', label: 'Lightsworn', share: 11, strength: 38, match: /lightsworn/i },
  { key: 'monarchs', label: 'Frog Monarchs', share: 10, strength: 34, match: /monarch/i },
  { key: 'gladiators', label: 'Gladiator Beasts', share: 8, strength: 24, match: /gladiator|prismadiator/i },
  { key: 'zombies', label: 'Zombies', share: 7, strength: 14, match: /zombie/i },
  { key: 'xsabers', label: 'X-Sabers', share: 7, strength: 12, match: /x-?saber/i },
  { key: 'teledad', label: 'Tele-DAD', share: 7, strength: 20, match: /tele-?dad|dark armed dragon/i },
  { key: 'herobeat', label: 'Hero Beat', share: 6, strength: 2, match: /\bhero\b/i },
  { key: 'rogue', label: 'Rogue', share: 10, strength: -10 },
];

export const metaInfo = (k: MetaKey) => META.find((m) => m.key === k)!;

/** Which bucket a deck belongs to. */
export function classifyDeck(d: Pick<DeckDef, 'archetype' | 'name' | 'id'>): MetaKey {
  const text = `${d.archetype} ${d.name} ${d.id}`;
  for (const m of META) if (m.match?.test(text)) return m.key;
  return 'rogue';
}

/** Premade decks in a bucket (real tournament lists first). */
export function decksFor(k: MetaKey): DeckDef[] {
  return PREMADE_DECKS.filter((d) => classifyDeck(d) === k).sort((a, b) => Number(!!b.event) - Number(!!a.event));
}

export function snapshot(d: DeckDef): DeckSnapshot {
  return { id: d.id, name: d.name, archetype: d.archetype, tier: d.tier, color: d.color, main: d.main, extra: d.extra };
}

/** Real placing lists are preferred when a bucket has them (7 times in 10). */
export function pickDeck(s: RngState, k: MetaKey): DeckDef | null {
  const pool = decksFor(k);
  if (!pool.length) return null;
  const real = pool.filter((d) => d.event);
  const other = pool.filter((d) => !d.event);
  const from = real.length && (!other.length || rand(s) < 0.7) ? real : other;
  return from[Math.floor(rand(s) * from.length) % from.length];
}

/** Draw a meta bucket for one seat, then a deck for it. Empty buckets fall back to the whole pool. */
export function drawFieldDeck(s: RngState): { meta: MetaKey; deck: DeckDef } {
  const live = META.filter((m) => decksFor(m.key).length);
  const m = weighted(s, live.length ? live : META, (x) => x.share);
  const deck = pickDeck(s, m.key) ?? PREMADE_DECKS[Math.floor(rand(s) * PREMADE_DECKS.length)];
  return { meta: classifyDeck(deck), deck };
}

/** Display label for a deck's bucket ("Plant Synchro"); rogues show their own archetype. */
export function metaLabel(k: MetaKey, deck?: Pick<DeckSnapshot, 'archetype'>) {
  return k === 'rogue' ? (deck?.archetype ?? 'Rogue') : metaInfo(k).label;
}

// ------------------------------------------------------------------ matchups

/** Notable matchup edges (Elo points for the first deck), mirrored automatically. */
const EDGES: [MetaKey, MetaKey, number][] = [
  ['gladiators', 'blackwings', 25],
  ['blackwings', 'lightsworn', 20],
  ['monarchs', 'zombies', 20],
  ['lightsworn', 'monarchs', 15],
  ['plants', 'herobeat', 25],
  ['plants', 'rogue', 15],
  ['teledad', 'lightsworn', 15],
  ['zombies', 'plants', 10],
  ['xsabers', 'gladiators', 15],
  ['herobeat', 'monarchs', 15],
  ['blackwings', 'xsabers', 15],
];

export function matchupEdge(a: MetaKey, b: MetaKey): number {
  let e = 0;
  for (const [x, y, v] of EDGES) {
    if (x === a && y === b) e += v;
    else if (x === b && y === a) e -= v;
  }
  return e;
}

const TIER_ROGUE: Record<1 | 2 | 3, number> = { 1: 15, 2: 0, 3: -25 };

export function deckStrength(meta: MetaKey, deck: Pick<DeckSnapshot, 'tier'>): number {
  return meta === 'rogue' ? metaInfo('rogue').strength + TIER_ROGUE[deck.tier] : metaInfo(meta).strength;
}
