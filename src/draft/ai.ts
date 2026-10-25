// AI drafters: pick the best card by draft power, leaning towards the archetypes,
// attributes and types they have already taken.
import type { CardData } from '../engine/card';
import type { Attribute } from '../engine/types';
import { Rng } from '../engine/rng';
import { cardPower, families, isExtraDeck } from './cards';

/** Personal taste of an AI drafter, so the table doesn't all draft the same way. */
export interface DrafterBias {
  attr?: Attribute;
  kind?: 'monster' | 'spell' | 'trap';
  family?: string;
  /** How much randomness goes into each pick (0–1). */
  noise: number;
}

const FAMILY_POOL = ['blackwing', 'lightsworn', 'gladiator', 'saber', 'hero', 'zombie', 'plant', 'monarch'];
const ATTRS: Attribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND'];

export function randomBias(rng: Rng): DrafterBias {
  const b: DrafterBias = { noise: 0.3 + rng.next() * 0.5 };
  if (rng.next() < 0.5) b.attr = rng.pick(ATTRS);
  if (rng.next() < 0.35) b.kind = rng.pick(['monster', 'spell', 'trap'] as const);
  if (rng.next() < 0.45) b.family = rng.pick(FAMILY_POOL);
  return b;
}

const FUSION_ENABLERS = new Set(['Polymerization', 'Miracle Fusion', 'Future Fusion', 'Overload Fusion', 'E - Emergency Call']);

/** Summary of what a drafter has taken so far. */
export interface PickProfile {
  n: number;
  monsters: number;
  spells: number;
  traps: number;
  extra: number;
  tuners: number;
  synchros: number;
  fusions: number;
  fusionEnablers: number;
  family: Map<string, number>;
  attr: Map<string, number>;
  race: Map<string, number>;
  highLevel: number;
}

export function profile(picks: CardData[]): PickProfile {
  const p: PickProfile = {
    n: picks.length,
    monsters: 0,
    spells: 0,
    traps: 0,
    extra: 0,
    tuners: 0,
    synchros: 0,
    fusions: 0,
    fusionEnablers: 0,
    family: new Map(),
    attr: new Map(),
    race: new Map(),
    highLevel: 0,
  };
  const inc = (m: Map<string, number>, k: string | undefined) => k && m.set(k, (m.get(k) ?? 0) + 1);
  for (const c of picks) {
    for (const f of families(c)) inc(p.family, f);
    if (FUSION_ENABLERS.has(c.name)) p.fusionEnablers++;
    if (c.kind === 'spell') p.spells++;
    else if (c.kind === 'trap') p.traps++;
    else if (isExtraDeck(c)) {
      p.extra++;
      if (c.mtypes?.includes('synchro')) p.synchros++;
      else p.fusions++;
    } else {
      p.monsters++;
      inc(p.attr, c.attribute);
      inc(p.race, c.race);
      if (c.mtypes?.includes('tuner')) p.tuners++;
      if ((c.level ?? 0) >= 7 && !c.cannotNormalSummon) p.highLevel++;
    }
  }
  return p;
}

/** How much a card fits a drafted pool (positive = good fit). */
export function synergy(c: CardData, p: PickProfile, bias?: DrafterBias): number {
  let s = 0;
  const fams = families(c);
  for (const f of fams) {
    const n = p.family.get(f) ?? 0;
    s += Math.min(n, 7) * 4.5;
    if (bias?.family === f) s += 6;
  }
  // Archetype cards are weaker when you are not in the archetype (late in the draft).
  if (fams.length && p.n >= 20 && fams.every((f) => (p.family.get(f) ?? 0) < 2)) s -= 8;

  if (c.kind === 'monster' && !isExtraDeck(c)) {
    s += Math.min(p.attr.get(c.attribute ?? '') ?? 0, 10) * 1.1;
    s += Math.min(p.race.get(c.race ?? '') ?? 0, 8) * 0.8;
    if (bias?.attr && c.attribute === bias.attr) s += 5;
    if (c.mtypes?.includes('tuner')) s += Math.min(p.synchros, 4) * 3;
    if ((c.level ?? 0) >= 7 && !c.cannotNormalSummon) s -= p.highLevel * 4;
  }
  if (c.mtypes?.includes('synchro')) s += p.tuners ? Math.min(p.tuners, 4) * 3 : p.n > 25 ? -14 : -4;
  if (c.mtypes?.includes('fusion')) s += p.fusionEnablers ? 6 : -16;
  if (FUSION_ENABLERS.has(c.name)) s += p.fusions ? 10 : -10;
  if (isExtraDeck(c) && p.extra >= 6) s -= 10 + (p.extra - 6) * 6;

  // Keep a playable balance of monsters / spells / traps.
  const main = p.monsters + p.spells + p.traps;
  if (main >= 8 && !isExtraDeck(c)) {
    const mr = p.monsters / main;
    if (c.kind === 'monster' && mr < 0.42) s += 8;
    if (c.kind !== 'monster' && mr > 0.62) s += 6;
    if (c.kind === 'monster' && mr > 0.7) s -= 6;
  }
  if (bias?.kind && c.kind === bias.kind && !isExtraDeck(c)) s += 4;
  return s;
}

/** Choose the index of the card an AI drafter takes from `pack`. */
export function aiPick(pack: CardData[], picks: CardData[], bias: DrafterBias, rng: Rng): number {
  const p = profile(picks);
  let best = 0;
  let bestScore = -Infinity;
  pack.forEach((c, i) => {
    const score = cardPower(c) + synergy(c, p, bias) + (rng.next() - 0.5) * 14 * bias.noise;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
