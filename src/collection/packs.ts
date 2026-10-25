// Era-accurate pack contents and pull rates.
//
// Source for every layout below: the YGOJSON v1 "distributions" data
// (github.com/iconmaster5326/YGOJSON), which encodes Yugipedia's documented pack odds.
// Each set's distribution is the one YGOJSON assigns to its English printing:
//
//  core       "TCG Core Booster Pre-TSHD" (GLAS … ABPF): 9 cards = 7 commons + 1 Rare + 1 slot that is a
//             common unless a foil replaces it: Super 1:5, Ultra 1:12, Secret 1:31, Ultimate 1:31,
//             Ghost 1:288. Short Prints sit in the common slots at 1/3 the weight of a normal common.
//  core-tshd  "TCG Core Booster Pre-BOSH" (TSHD): same, but Secret 1:23 and Ultimate 1:23.
//  hidden-arsenal  "Hidden Arsenal Pack": 5 cards = 1 Secret + 4 Super (all foil).
//  turbo      "TCG Turbo Pack": 3 cards = 2 commons + 1 Rare, upgraded to Super 1:12, Ultra 1:32,
//             Ultimate 1:32.
//  gold       Gold Series: 25 cards = 22 commons + 3 Gold Rares (ICv2 / Yugipedia product
//             description; YGOJSON lists 23 commons, the press description says 22).
//
// Only implemented cards are in the pools. When a slot's rarity has no playable card in a set,
// the slot falls to the nearest lower rarity that has one (then the nearest higher one), so a
// pack is always full-size. Cards inside one pack are distinct while the pool allows it.
import { Rng } from '../engine/rng';
import { playableSet, rarityRank, type PlayableSet } from './catalog';
import { RARITY_ORDER, type PackFormat, type Pull, type Rarity } from './types';

export interface FoilOdds {
  rarity: Rarity;
  /** "1 in N packs". */
  oneIn: number;
}

export interface Slot {
  count: number;
  /** Rarity (or rarities, pooled) of this slot when no foil replaces it. */
  base: Rarity | Rarity[];
  /** Independent replacement odds for this slot. */
  foil?: FoilOdds[];
}

export interface PackFormatDef {
  id: PackFormat;
  label: string;
  cardsPerPack: number;
  packsPerBox: number;
  slots: Slot[];
  /** Weight of a Short Print relative to a normal common. */
  shortPrintWeight: number;
}

const COMMON: Rarity[] = ['C', 'SP'];

export const PACK_FORMATS: Record<PackFormat, PackFormatDef> = {
  core: {
    id: 'core',
    label: 'Booster Pack',
    cardsPerPack: 9,
    packsPerBox: 24,
    shortPrintWeight: 1 / 3,
    slots: [
      { count: 7, base: COMMON },
      { count: 1, base: 'R' },
      {
        count: 1,
        base: COMMON,
        foil: [
          { rarity: 'SR', oneIn: 5 },
          { rarity: 'UR', oneIn: 12 },
          { rarity: 'ScR', oneIn: 31 },
          { rarity: 'UtR', oneIn: 31 },
          { rarity: 'GR', oneIn: 288 },
        ],
      },
    ],
  },
  'core-tshd': {
    id: 'core-tshd',
    label: 'Booster Pack',
    cardsPerPack: 9,
    packsPerBox: 24,
    shortPrintWeight: 1 / 3,
    slots: [
      { count: 7, base: COMMON },
      { count: 1, base: 'R' },
      {
        count: 1,
        base: COMMON,
        foil: [
          { rarity: 'SR', oneIn: 5 },
          { rarity: 'UR', oneIn: 12 },
          { rarity: 'ScR', oneIn: 23 },
          { rarity: 'UtR', oneIn: 23 },
          { rarity: 'GR', oneIn: 288 },
        ],
      },
    ],
  },
  'hidden-arsenal': {
    id: 'hidden-arsenal',
    label: 'Hidden Arsenal',
    cardsPerPack: 5,
    packsPerBox: 36,
    shortPrintWeight: 1,
    slots: [
      { count: 1, base: 'ScR' },
      { count: 4, base: ['SR', 'UR'] },
    ],
  },
  turbo: {
    id: 'turbo',
    label: 'Turbo Pack',
    cardsPerPack: 3,
    packsPerBox: 100,
    shortPrintWeight: 1,
    slots: [
      { count: 2, base: COMMON },
      {
        count: 1,
        base: 'R',
        foil: [
          { rarity: 'SR', oneIn: 12 },
          { rarity: 'UR', oneIn: 32 },
          { rarity: 'UtR', oneIn: 32 },
        ],
      },
    ],
  },
  gold: {
    id: 'gold',
    label: 'Gold Series',
    cardsPerPack: 25,
    packsPerBox: 5,
    shortPrintWeight: 1,
    slots: [
      { count: 22, base: COMMON },
      { count: 3, base: 'GUR' },
    ],
  },
};

export function formatOf(code: string): PackFormatDef {
  const s = playableSet(code);
  return PACK_FORMATS[s?.data.format ?? 'core'];
}

/** Human-readable odds lines for a set ("Ultra Rare · 1 in 12 packs"). */
export function oddsLines(code: string): { rarity: Rarity; text: string }[] {
  const f = formatOf(code);
  const out: { rarity: Rarity; text: string }[] = [];
  for (const s of f.slots) {
    const b = Array.isArray(s.base) ? s.base[0] : s.base;
    if (s.foil) {
      for (const o of s.foil) out.push({ rarity: o.rarity, text: `1 in ${o.oneIn} packs` });
      if (b !== 'C') out.push({ rarity: b, text: 'Every pack, unless upgraded' });
    } else if (b !== 'C') out.push({ rarity: b, text: s.count === 1 ? 'Every pack' : `${s.count} in every pack` });
  }
  return out.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
}

// ------------------------------------------------------------------ generation

/** Resolve which printed rarity tier a slot draws from in this set (empty-pool fallback). */
export function resolveTier(set: PlayableSet, want: Rarity[]): Rarity[] {
  const has = (rs: Rarity[]) => rs.some((r) => set.pools[r]?.length);
  if (has(want)) return want;
  const i = Math.min(...want.map(rarityRank));
  for (let k = i - 1; k >= 0; k--) if (set.pools[RARITY_ORDER[k]]?.length) return RARITY_ORDER[k] === 'SP' ? COMMON : [RARITY_ORDER[k]];
  for (let k = i + 1; k < RARITY_ORDER.length; k++) if (set.pools[RARITY_ORDER[k]]?.length) return [RARITY_ORDER[k]];
  return [];
}

/** Weighted candidates for a tier: [name, rarity, weight]. */
function candidates(set: PlayableSet, tier: Rarity[], spWeight: number): [string, Rarity, number][] {
  const out: [string, Rarity, number][] = [];
  for (const r of tier) for (const n of set.pools[r] ?? []) out.push([n, r, r === 'SP' ? spWeight : 1]);
  return out;
}

function weightedPick<T extends [string, Rarity, number]>(rng: Rng, list: T[]): T {
  let total = 0;
  for (const x of list) total += x[2];
  let u = rng.next() * total;
  for (const x of list) {
    u -= x[2];
    if (u < 0) return x;
  }
  return list[list.length - 1];
}

/** The rarity a slot rolls before pool fallback (exported for the odds test). */
export function rollSlot(rng: Rng, slot: Slot): Rarity[] {
  if (slot.foil) {
    const u = rng.next();
    let acc = 0;
    for (const o of slot.foil) {
      acc += 1 / o.oneIn;
      if (u < acc) return [o.rarity];
    }
  }
  return Array.isArray(slot.base) ? slot.base : [slot.base];
}

/** Open one pack of `code` with a deterministic seed. Pulls are ordered commons → best (reveal order). */
export function openPack(code: string, seed: number): Pull[] {
  const set = playableSet(code);
  if (!set || !set.playable.length) return [];
  const f = PACK_FORMATS[set.data.format];
  const rng = new Rng(seed);
  const used = new Set<string>();
  const pulls: Pull[] = [];
  for (const slot of f.slots) {
    for (let i = 0; i < slot.count; i++) {
      const tier = resolveTier(set, rollSlot(rng, slot));
      const all = candidates(set, tier, f.shortPrintWeight);
      if (!all.length) continue;
      const fresh = all.filter(([n]) => !used.has(n));
      const [name, rarity] = weightedPick(rng, fresh.length ? fresh : all);
      used.add(name);
      pulls.push({ name, rarity: rarity === 'SP' ? 'C' : rarity });
    }
  }
  return pulls.map((p, i) => [p, i] as const).sort((a, b) => rarityRank(a[0].rarity) - rarityRank(b[0].rarity) || a[1] - b[1]).map(([p]) => p);
}

/** Mix two integers into a well-spread 32-bit seed. */
export function mixSeed(a: number, b: number) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Best rarity in a list of pulls. */
export function bestRarity(pulls: Pull[]): Rarity | null {
  let best: Rarity | null = null;
  for (const p of pulls) if (!best || rarityRank(p.rarity) > rarityRank(best)) best = p.rarity;
  return best;
}
