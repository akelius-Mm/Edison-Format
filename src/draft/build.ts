// Auto-build: the best 40-card Main Deck from a drafted pool with a sensible
// monster / spell / trap balance, plus up to 15 drafted Extra Deck monsters.
import type { CardData } from '../engine/card';
import { cardPower, families, isExtraDeck, isVanilla } from './cards';
import { profile, type PickProfile } from './ai';

export const MAIN_MIN = 40;
export const EXTRA_MAX = 15;

export interface BuiltDeck {
  main: CardData[];
  extra: CardData[];
}

const isHighLevel = (c: CardData) => c.kind === 'monster' && !isExtraDeck(c) && (c.level ?? 0) >= 7 && !c.cannotNormalSummon;
const isMidLevel = (c: CardData) => c.kind === 'monster' && !isExtraDeck(c) && (c.level ?? 0) >= 5 && (c.level ?? 0) <= 6 && !c.cannotNormalSummon;

/** How good a card is in a deck built from this pool. */
export function deckScore(c: CardData, p: PickProfile): number {
  let s = cardPower(c);
  for (const f of families(c)) s += Math.min(Math.max(0, (p.family.get(f) ?? 0) - 1), 8) * 2.6;
  if (c.kind === 'monster' && !isExtraDeck(c)) {
    s += Math.min(p.attr.get(c.attribute ?? '') ?? 0, 12) * 0.4;
    if (c.mtypes?.includes('tuner')) s += Math.min(p.synchros, 4) * 2.5;
  }
  if (c.name === 'Polymerization' || c.name === 'Miracle Fusion' || c.name === 'Future Fusion' || c.name === 'Overload Fusion') s += p.fusions ? 4 : -40;
  return s;
}

function extraScore(c: CardData, p: PickProfile, main: CardData[]) {
  let s = cardPower(c);
  if (c.mtypes?.includes('synchro')) s += main.some((m) => m.mtypes?.includes('tuner')) ? 20 : -20;
  if (c.mtypes?.includes('fusion')) s += main.some((m) => /polymerization|fusion/i.test(m.name)) ? 10 : -25;
  void p;
  return s;
}

/**
 * Build a deck from a drafted pool. Duplicates are allowed exactly as drafted.
 * If the pool has fewer than 40 Main Deck cards, `fillers` (if given) top the deck up.
 */
export function autoBuild(pool: CardData[], opts: { size?: number; fillers?: CardData[] } = {}): BuiltDeck {
  const size = opts.size ?? MAIN_MIN;
  const p = profile(pool);
  const mainPool = pool.filter((c) => !isExtraDeck(c));
  const ranked = mainPool.map((c, i) => ({ c, i, s: deckScore(c, p) })).sort((a, b) => b.s - a.s || a.i - b.i);

  const caps = { monster: 21, spell: 15, trap: 12, high: 3, mid: 5 };
  const chosen: typeof ranked = [];
  const rest: typeof ranked = [];
  const count = { monster: 0, spell: 0, trap: 0, high: 0, mid: 0 };
  for (const r of ranked) {
    if (chosen.length >= size) {
      rest.push(r);
      continue;
    }
    const k = r.c.kind;
    const hi = isHighLevel(r.c);
    const mid = isMidLevel(r.c);
    if (count[k] >= caps[k] || (hi && count.high >= caps.high) || (mid && count.mid >= caps.mid)) {
      rest.push(r);
      continue;
    }
    chosen.push(r);
    count[k]++;
    if (hi) count.high++;
    if (mid) count.mid++;
  }
  // Not enough cards within the caps: take the best of what is left.
  for (const r of [...rest]) {
    if (chosen.length >= size) break;
    chosen.push(r);
    rest.splice(rest.indexOf(r), 1);
    count[r.c.kind]++;
  }
  // Too few monsters: swap the weakest spells/traps for the best remaining monsters.
  const minMonsters = 15;
  while (count.monster < minMonsters) {
    const m = rest.find((r) => r.c.kind === 'monster');
    if (!m) break;
    const weakest = [...chosen].reverse().find((r) => r.c.kind !== 'monster');
    if (!weakest) break;
    chosen.splice(chosen.indexOf(weakest), 1);
    rest.splice(rest.indexOf(m), 1);
    chosen.push(m);
    count[weakest.c.kind]--;
    count.monster++;
  }
  const main = chosen.map((r) => r.c);
  // Pool too small: top up with filler monsters.
  if (main.length < size && opts.fillers?.length) {
    let i = 0;
    while (main.length < size) main.push(opts.fillers[i++ % opts.fillers.length]);
  }
  const extra = pool
    .filter(isExtraDeck)
    .map((c, i) => ({ c, i, s: extraScore(c, p, main) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, EXTRA_MAX)
    .map((r) => r.c);
  return { main: sortForDisplay(main), extra: sortForDisplay(extra) };
}

/** Monsters (by level, desc), then spells, then traps; alphabetical within. */
export function sortForDisplay(cards: CardData[]): CardData[] {
  const k = (c: CardData) => (c.kind === 'monster' ? 0 : c.kind === 'spell' ? 1 : 2);
  return [...cards].sort((a, b) => k(a) - k(b) || (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
}

/** Plain filler monsters for pools that are too small to reach 40 (very rare). */
export function fillerMonsters(pool: CardData[]): CardData[] {
  return pool
    .filter((c) => isVanilla(c) && (c.level ?? 0) <= 4)
    .sort((a, b) => (b.atk ?? 0) - (a.atk ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 6);
}

/** A rough strength rating for a built deck, used to simulate AI-vs-AI matches (Elo-like). */
export function deckRating(d: BuiltDeck): number {
  const main = d.main.length ? d.main.reduce((a, c) => a + cardPower(c), 0) / d.main.length : 40;
  const top = [...d.main].map(cardPower).sort((a, b) => b - a).slice(0, 8);
  const bombs = top.reduce((a, v) => a + v, 0) / Math.max(1, top.length);
  const extra = Math.min(d.extra.length, 6) * 4;
  return 1300 + main * 3 + bombs * 1.2 + extra;
}
