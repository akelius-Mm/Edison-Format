// The singles market: what every card is worth, the card shop's glass case (buy and sell singles), and the
// Locals regulars' trade binders. Prices are in DP (100 DP ≈ US$1, like the pack prices in index.ts).
//
// A card's price is its rarity's base price plus a demand premium: how much of the 2010 field plays it, measured
// over the bundled decklists (real tournament lists count double). Like the real 2010 singles market, a staple
// that was also printed as a common (Mystical Space Typhoon) is cheap in that common printing and expensive as a
// foil, while one that only came as a foil (Dark Armed Dragon) is expensive in every printing. Prices drift a
// little each week, and the shop's stock and the regulars' binders change every Friday.
import { allCards } from '../cards';
import { isPostEdison, limitOf } from '../cards/banlist';
import { PREMADE_DECKS } from '../decks';
import { regularById, REGULARS, type Regular } from '../locals/regulars';
import { decksFor } from '../locals/meta';
import { hash } from '../locals/rng';
import { loadJSON, saveJSON } from '../ui/settings';
import { playableSets, rarityRank, structureDeckCards } from './catalog';
import { getCollection, transact, type Copies } from './index';
import { mixSeed } from './packs';
import { STRUCTURE_DECKS } from './sets';
import { RARITY_ORDER, type Rarity } from './types';

// ------------------------------------------------------------------ prices

/** Price of a card with no demand, by rarity. */
export const RARITY_BASE: Record<Rarity, number> = { C: 10, SP: 15, R: 25, SR: 50, UR: 100, UtR: 250, ScR: 200, GR: 500, GUR: 60 };

/** Demand premium of the most-played card in its highest-demand printing. */
const STAPLE_MAX = 2400;

/** Share of the demand premium a printing carries: commons are plentiful, foils are what people chase. */
const PRINTING_SHARE: Record<Rarity, number> = { C: 0.08, SP: 0.12, R: 0.4, SR: 0.8, UR: 1, UtR: 1.15, ScR: 1.2, GR: 1.4, GUR: 0.25 };

/** The shop buys singles at half its selling price (store credit, like a 2010 buylist). */
export const BUYLIST_SHARE = 0.5;

/** Weekly price drift, up to ±8%. */
const DRIFT = 0.08;

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

let printings: Map<string, Rarity[]> | null = null;
let older: Set<string> | null = null;

/**
 * Every printing the shop can carry: name → rarities, lowest first. Cards from the era's boosters and Structure
 * Decks have their real rarities. Legal cards from older sets and promos (Gorz the Emissary of Darkness, Dandylion,
 * Call of the Haunted…) aren't in the app's set lists, so they're carried as one "older printing", stored as a Rare.
 */
export function cardPrintings(): Map<string, Rarity[]> {
  if (printings) return printings;
  const m = new Map<string, Set<Rarity>>();
  const add = (name: string, r: Rarity) => (m.get(name) ?? m.set(name, new Set()).get(name)!).add(r);
  for (const s of playableSets()) for (const [name, rs] of s.rarities) for (const r of rs) add(name, r);
  for (const d of STRUCTURE_DECKS) for (const c of structureDeckCards(d)) add(c.name, c.rarity);
  older = new Set();
  for (const c of allCards()) {
    if (m.has(c.name) || !limitOf(c.name) || isPostEdison(c.name)) continue;
    older.add(c.name);
    add(c.name, 'R');
  }
  printings = new Map([...m].map(([n, rs]) => [n, [...rs].sort((a, b) => rarityRank(a) - rarityRank(b))]));
  return printings;
}

/** True for a card the shop carries as an older-set printing (see cardPrintings). */
export function isOlderPrinting(name: string): boolean {
  cardPrintings();
  return older!.has(name);
}

let demandCache: Map<string, number> | null = null;

/**
 * How much of the field plays a card, 0..1: the weighted share of decklists running it, where a full playset
 * (or 1 copy of a Limited card) counts as 1. Side Deck copies count half. Forbidden cards have no demand.
 */
export function demand(name: string): number {
  if (!demandCache) {
    const sum = new Map<string, number>();
    let total = 0;
    for (const d of PREMADE_DECKS) {
      const w = d.event ? 2 : 1;
      total += w;
      const per = new Map<string, number>();
      for (const [n, c] of [...d.main, ...d.extra]) per.set(n, (per.get(n) ?? 0) + c);
      for (const [n, c] of d.side ?? []) per.set(n, (per.get(n) ?? 0) + c / 2);
      for (const [n, c] of per) {
        const lim = limitOf(n);
        if (lim) sum.set(n, (sum.get(n) ?? 0) + w * Math.min(1, c / Math.min(3, lim)));
      }
    }
    demandCache = new Map([...sum].map(([n, v]) => [n, total ? v / total : 0]));
  }
  return demandCache.get(name) ?? 0;
}

/** Market week: a new one starts every Friday (00:00 UTC), when the shop restocks. */
export function marketWeek(now = Date.now()): number {
  const FRIDAY = Date.UTC(1970, 0, 2);
  return Math.floor((now - FRIDAY) / (7 * 864e5));
}

/** 0..1, fixed for a key and a week. */
function roll(key: string, week: number, salt = 0) {
  return mixSeed(hash(key) ^ salt, week) / 4294967296;
}

/** What the shop sells one copy for this week. */
export function price(name: string, rarity: Rarity, week = marketWeek()): number {
  // an older-set staple was long out of print by 2010, so it carries the full premium
  const share = isOlderPrinting(name) ? 1 : PRINTING_SHARE[rarity];
  const base = RARITY_BASE[rarity] + STAPLE_MAX * Math.pow(demand(name), 1.15) * share;
  const drift = 1 + DRIFT * (roll(`${name}|${rarity}`, week, 0x5eed) * 2 - 1);
  return round5(base * drift);
}

/** What the shop pays for one copy this week. */
export function buyPrice(name: string, rarity: Rarity, week = marketWeek()): number {
  return round5(price(name, rarity, week) * BUYLIST_SHARE);
}

/** Price change from last week, as a fraction (0.06 = up 6%). */
export function priceTrend(name: string, rarity: Rarity, week = marketWeek()): number {
  const before = price(name, rarity, week - 1);
  return before ? (price(name, rarity, week) - before) / before : 0;
}

// ------------------------------------------------------------------ persisted state

const KEY = 'edison.market.v1';

export interface MarketLog {
  at: number;
  kind: 'buy' | 'sell' | 'trade';
  /** e.g. "Bought Brionac, Dragon of the Ice Barrier (Super Rare)" */
  text: string;
  dp: number;
}

interface MarketState {
  v: 1;
  week: number;
  /** "name|rarity" → copies bought from the glass case this week */
  bought: Record<string, number>;
  /** regular id → "name|rarity" keys traded out of their binder this week */
  traded: Record<string, string[]>;
  log: MarketLog[];
}

function load(week = marketWeek()): MarketState {
  const s = loadJSON<MarketState | null>(KEY, null);
  if (!s || s.v !== 1) return { v: 1, week, bought: {}, traded: {}, log: [] };
  if (s.week !== week) return { ...s, week, bought: {}, traded: {} };
  return { ...s, bought: s.bought ?? {}, traded: s.traded ?? {}, log: s.log ?? [] };
}

function logEntry(s: MarketState, e: MarketLog) {
  s.log.unshift(e);
  s.log.length = Math.min(s.log.length, 30);
  saveJSON(KEY, s);
}

export function marketLog(): MarketLog[] {
  return load().log;
}

const key = (name: string, rarity: Rarity) => `${name}|${rarity}`;

// ------------------------------------------------------------------ the glass case

/** Below this price a printing is bulk: always in stock. */
export const BULK_PRICE = 150;

/** Copies of a printing the shop has this week (Infinity for bulk). */
export function stock(name: string, rarity: Rarity, week = marketWeek()): number {
  const p = price(name, rarity, week);
  if (p < BULK_PRICE) return Infinity;
  const r = roll(key(name, rarity), week, 0x57c);
  // pricier cards are scarcer: a 2,000 DP card is in the case about a third of the weeks
  const chance = Math.max(0.3, 0.85 - p / 4000);
  const have = r < chance ? 1 + Math.floor((r / chance) * 3) : 0;
  const s = load(week);
  return Math.max(0, have - (s.bought[key(name, rarity)] ?? 0));
}

export interface Listing {
  name: string;
  rarity: Rarity;
  price: number;
  stock: number;
}

/** Every printing of a card the shop lists this week (in stock or not), lowest rarity first. */
export function listings(name: string, week = marketWeek()): Listing[] {
  return (cardPrintings().get(name) ?? []).map((r) => ({ name, rarity: r, price: price(name, r, week), stock: stock(name, r, week) }));
}

/** The case's headline cards this week: the most valuable printings in stock. */
export function featured(n = 8, week = marketWeek()): Listing[] {
  const out: Listing[] = [];
  for (const [name, rs] of cardPrintings()) {
    for (const r of rs) {
      const p = price(name, r, week);
      if (p >= BULK_PRICE * 2 && stock(name, r, week) > 0) out.push({ name, rarity: r, price: p, stock: stock(name, r, week) });
    }
  }
  return out.sort((a, b) => b.price - a.price).slice(0, n);
}

export type MarketResult = { ok: true } | { ok: false; reason: string };

export function buySingle(name: string, rarity: Rarity): MarketResult {
  const week = marketWeek();
  const p = price(name, rarity, week);
  if (!cardPrintings().get(name)?.includes(rarity)) return { ok: false, reason: 'The shop doesn’t carry that printing.' };
  if (stock(name, rarity, week) <= 0) return { ok: false, reason: 'Sold out this week. New stock arrives Friday.' };
  if (!transact({ dp: -p, add: [{ name, rarity, n: 1 }] })) return { ok: false, reason: 'Not enough Duel Points.' };
  const s = load(week);
  s.bought[key(name, rarity)] = (s.bought[key(name, rarity)] ?? 0) + 1;
  logEntry(s, { at: Date.now(), kind: 'buy', text: `Bought ${name} (${rarity})`, dp: -p });
  return { ok: true };
}

export function sellSingle(name: string, rarity: Rarity, n = 1): MarketResult {
  const week = marketWeek();
  const each = buyPrice(name, rarity, week);
  if (!transact({ dp: each * n, remove: [{ name, rarity, n }] })) return { ok: false, reason: 'You don’t have that many copies.' };
  logEntry(load(week), { at: Date.now(), kind: 'sell', text: `Sold ${n > 1 ? `${n}× ` : ''}${name} (${rarity})`, dp: each * n });
  return { ok: true };
}

/** Total shop value of the collection (at the shop's selling prices). */
export function collectionValue(week = marketWeek()): number {
  let v = 0;
  for (const [name, rs] of Object.entries(getCollection().owned)) for (const r of RARITY_ORDER) if (rs[r]) v += rs[r]! * price(name, r, week);
  return v;
}

// ------------------------------------------------------------------ trading with the regulars

/** How hard each regular bargains: they take a trade when what they get ≥ what they give × this. */
const GREED: Record<string, number> = { marcus: 1.1, priya: 1.05, dave: 1.15, theo: 1, nadia: 1.05, kenji: 1, jonah: 1, felix: 0.9, gus: 0.95 };

/** A card a regular wants counts this much more to them. */
export const WANT_BONUS = 1.25;

export interface TradeCard {
  name: string;
  rarity: Rarity;
  value: number;
}

export interface Trader {
  regular: Regular;
  greed: number;
  /** Trade binder this week (cards already traded away are gone). */
  binder: TradeCard[];
  /** Cards for their deck they're looking for. */
  wants: string[];
}

/** Cards a regular's archetype plays: they keep these out of the trade binder and want the ones they lack. */
function archetypeCards(r: Regular): Set<string> {
  const out = new Set<string>();
  for (const d of decksFor(r.meta)) for (const [n] of [...d.main, ...d.extra, ...(d.side ?? [])]) out.add(n);
  return out;
}

export function trader(id: string, week = marketWeek()): Trader | null {
  const r = regularById(id);
  if (!r) return null;
  const own = archetypeCards(r);
  const seed = hash(r.id) ^ 0x7a11e;
  let i = 0;
  const rnd = () => mixSeed(seed, week * 1000 + i++) / 4294967296;

  // binder: 14 printings worth trading, favouring valuable ones, none of their own deck's cards
  const pool: TradeCard[] = [];
  for (const [name, rs] of cardPrintings()) {
    if (own.has(name)) continue;
    for (const rarity of rs) {
      const value = price(name, rarity, week);
      if (value >= 40) pool.push({ name, rarity, value });
    }
  }
  pool.sort((a, b) => b.value - a.value);
  const binder: TradeCard[] = [];
  const names = new Set<string>();
  const taken = new Set(load(week).traded[r.id] ?? []);
  for (let tries = 0; binder.length < 14 && tries < 400 && pool.length; tries++) {
    // skewed toward the valuable end of the pool: more staples than chaff, but not only staples
    const c = pool[Math.floor(Math.pow(rnd(), 1.8) * pool.length * 0.999)];
    if (names.has(c.name)) continue;
    names.add(c.name);
    if (!taken.has(key(c.name, c.rarity))) binder.push(c);
  }
  binder.sort((a, b) => b.value - a.value);

  // wants: 6 cards their archetype plays, its signature cards before the staples every deck runs,
  // shuffled a little each week
  const lists = decksFor(r.meta);
  const share = (n: string) => lists.filter((d) => [...d.main, ...d.extra].some(([x]) => x === n)).length / Math.max(1, lists.length);
  const wants = [...own]
    .filter((n) => cardPrintings().has(n) && demand(n) > 0 && limitOf(n) > 0)
    .map((n) => ({ n, w: (share(n) - 0.6 * demand(n) + 0.15) * (0.6 + 0.8 * rnd()) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 6)
    .map((x) => x.n);

  return { regular: r, greed: GREED[r.id] ?? 1, binder, wants };
}

export function traders(week = marketWeek()): Trader[] {
  return REGULARS.map((r) => trader(r.id, week)!).filter(Boolean);
}

export interface TradeOffer {
  /** Your cards going to them. */
  give: Copies[];
  /** Their cards coming to you (one copy each). */
  get: { name: string; rarity: Rarity }[];
  /** Duel Points you add to your side. */
  dp: number;
}

export interface TradeVerdict {
  accept: boolean;
  /** What your side is worth to them (wants count extra, DP at face value). */
  offered: number;
  /** What they'd want for their side (their cards × greed). */
  asked: number;
  /** DP of value still missing, rounded up to 10 (0 when accepted). */
  short: number;
}

export function evaluateTrade(t: Trader, o: TradeOffer, week = marketWeek()): TradeVerdict {
  const wants = new Set(t.wants);
  let offered = Math.max(0, o.dp);
  for (const c of o.give) offered += c.n * price(c.name, c.rarity, week) * (wants.has(c.name) ? WANT_BONUS : 1);
  let asked = 0;
  for (const c of o.get) asked += price(c.name, c.rarity, week);
  asked *= t.greed;
  const empty = !o.get.length && !o.give.length;
  const accept = !empty && o.get.length > 0 && offered >= asked;
  return { accept, offered: Math.round(offered), asked: Math.round(asked), short: accept ? 0 : Math.ceil(Math.max(0, asked - offered) / 10) * 10 };
}

export function makeTrade(id: string, o: TradeOffer): MarketResult & { verdict?: TradeVerdict } {
  const week = marketWeek();
  const t = trader(id, week);
  if (!t) return { ok: false, reason: 'They’re not here.' };
  const inBinder = new Set(t.binder.map((c) => key(c.name, c.rarity)));
  if (o.get.some((c) => !inBinder.has(key(c.name, c.rarity)))) return { ok: false, reason: 'That card isn’t in their binder anymore.' };
  const verdict = evaluateTrade(t, o, week);
  if (!verdict.accept) return { ok: false, reason: 'They passed.', verdict };
  const add = o.get.map((c) => ({ ...c, n: 1 }));
  if (!transact({ dp: -Math.max(0, o.dp), add, remove: o.give })) return { ok: false, reason: 'You no longer have everything in this offer.' };
  const s = load(week);
  s.traded[id] = [...(s.traded[id] ?? []), ...o.get.map((c) => key(c.name, c.rarity))];
  const gave = o.give.reduce((n, c) => n + c.n, 0);
  logEntry(s, {
    at: Date.now(),
    kind: 'trade',
    text: `Traded ${gave} card${gave === 1 ? '' : 's'}${o.dp > 0 ? ` + ${o.dp} DP` : ''} to ${t.regular.name} for ${o.get.map((c) => c.name).join(', ')}`,
    dp: -Math.max(0, o.dp),
  });
  return { ok: true, verdict };
}

/** Test hook: forget the cached demand and printings (the deck and card lists are fixed at runtime). */
export function _resetMarketCaches() {
  printings = null;
  older = null;
  demandCache = null;
}
