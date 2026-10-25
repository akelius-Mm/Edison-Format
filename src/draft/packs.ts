// Booster pack generation. A pack has 15 cards:
//   11 Commons · 2 Rares · 1 foil slot (Super / Ultra / Secret) · 1 bonus slot
// The bonus slot is often an Extra Deck monster (any rarity), otherwise another Rare.
// Commons and Rares are Main Deck cards; the foil slot can be anything.
import type { CardData } from '../engine/card';
import { Rng } from '../engine/rng';
import { cardPower, draftPool, isExtraDeck, rarityOf, rarityRank, type Rarity } from './cards';

export const PACK_SIZE = 15;

/** Where a card in a pack came from: card id + rarity it was opened at. */
export interface PackCard {
  id: string;
  r: Rarity;
}

interface Buckets {
  main: Record<Rarity, CardData[]>;
  extra: CardData[];
  all: Record<Rarity, CardData[]>;
}
let buckets: Buckets | null = null;

function getBuckets(): Buckets {
  if (buckets) return buckets;
  const empty = () => ({ C: [], R: [], SR: [], UR: [], ScR: [] }) as Record<Rarity, CardData[]>;
  const b: Buckets = { main: empty(), extra: [], all: empty() };
  for (const c of draftPool()) {
    const r = rarityOf(c);
    b.all[r].push(c);
    if (isExtraDeck(c)) b.extra.push(c);
    else b.main[r].push(c);
  }
  // Stable order so a seed always produces the same packs.
  const byName = (x: CardData, y: CardData) => x.id.localeCompare(y.id);
  for (const r of Object.keys(b.main) as Rarity[]) {
    b.main[r].sort(byName);
    b.all[r].sort(byName);
  }
  b.extra.sort(byName);
  buckets = b;
  return b;
}

function pickDistinct(rng: Rng, list: CardData[], taken: Set<string>): CardData {
  for (let i = 0; i < 30; i++) {
    const c = rng.pick(list);
    if (!taken.has(c.id)) return c;
  }
  return rng.pick(list);
}

/** Weighted pick: lower rarities are more likely for Extra Deck monsters in the bonus slot. */
function pickExtra(rng: Rng, list: CardData[], taken: Set<string>): CardData {
  const w = (c: CardData) => [5, 4, 2.4, 1.1, 0.5][rarityRank(rarityOf(c))] * (taken.has(c.id) ? 0.05 : 1);
  const total = list.reduce((a, c) => a + w(c), 0);
  let x = rng.next() * total;
  for (const c of list) {
    x -= w(c);
    if (x <= 0) return c;
  }
  return list[list.length - 1];
}

/** Generate one pack. Cards are ordered commons first, the best card last (reveal order). */
export function generatePack(rng: Rng): PackCard[] {
  const b = getBuckets();
  const taken = new Set<string>();
  const out: PackCard[] = [];
  const add = (c: CardData, r: Rarity = rarityOf(c)) => {
    taken.add(c.id);
    out.push({ id: c.id, r });
  };
  for (let i = 0; i < 11; i++) add(pickDistinct(rng, b.main.C, taken));
  for (let i = 0; i < 2; i++) add(pickDistinct(rng, b.main.R, taken));
  // bonus slot
  if (rng.next() < 0.45 && b.extra.length) add(pickExtra(rng, b.extra, taken));
  else add(pickDistinct(rng, rng.next() < 0.75 ? b.main.R : b.main.SR, taken));
  // foil slot
  const f = rng.next();
  const fr: Rarity = f < 0.07 ? 'ScR' : f < 0.28 ? 'UR' : 'SR';
  add(pickDistinct(rng, b.all[fr], taken));
  // reveal order: by rarity, then power, best last
  const card = (p: PackCard) => draftPoolCard(p.id);
  out.sort((x, y) => rarityRank(x.r) - rarityRank(y.r) || cardPower(card(x)) - cardPower(card(y)));
  return out;
}

const poolIndex = new Map<string, CardData>();
function draftPoolCard(id: string): CardData {
  if (!poolIndex.size) for (const c of draftPool()) poolIndex.set(c.id, c);
  return poolIndex.get(id)!;
}

/** Packs for a whole event: [round][seat]. */
export function generateEventPacks(seed: number, rounds: number, seats: number): PackCard[][][] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const out: PackCard[][][] = [];
  for (let r = 0; r < rounds; r++) {
    const row: PackCard[][] = [];
    for (let s = 0; s < seats; s++) row.push(generatePack(rng));
    out.push(row);
  }
  return out;
}
