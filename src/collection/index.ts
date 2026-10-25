// Collection state and economy: owned cards (per rarity), unopened packs, Duel Points (DP).
// Persisted in localStorage. Other modes award prizes through grantPrize() (./api), which
// this module handles; match results call rewardForDuel().
import { registerPrizeHandler, type PrizeGrant } from './api';
import { playableSet, playableSets, rarityRank, structureDeck, structureDeckCards } from './catalog';
import { mixSeed, openPack } from './packs';
import { STRUCTURE_DECKS } from './sets';
import { RARITY_ORDER, type Pull, type Rarity } from './types';

export { grantPrize, type PrizeGrant } from './api';
export type { Pull, Rarity } from './types';
export { RARITY_NAMES, RARITY_ORDER } from './types';

// ------------------------------------------------------------------ economy constants

/**
 * Shop prices in DP. 100 DP ≈ US$1 at the era's MSRP:
 * core booster $3.99 and Hidden Arsenal $3.99 (5 foils) per ICv2/Konami press releases,
 * Gold Series $19.99 per pack (ICv2), Structure Deck $9.99. Turbo Packs were never sold;
 * Konami handed them out at Turbo tournaments, so here they are prize-only.
 */
export const PRICES = {
  core: 400,
  'core-tshd': 400,
  'hidden-arsenal': 400,
  gold: 2000,
  turbo: null,
  structureDeck: 1000,
} as const;

/** A sealed box costs 22 packs' worth (the era's typical hobby-store discount). */
export const BOX_DISCOUNT_PACKS = 22;

/** DP for each copy beyond 3 when converting extras, by rarity. */
export const EXTRA_COPY_DP: Record<Rarity, number> = { C: 5, SP: 5, R: 10, SR: 20, UR: 40, UtR: 60, ScR: 80, GR: 200, GUR: 40 };

/** Starting gift: three copies each of three era Structure Decks, 12 booster packs and 1,000 DP. */
export const STARTER = {
  structureDecks: ['SDZW', 'SDWS', 'SDMM'],
  copiesEach: 3,
  packs: 12,
  dp: 1000,
};

// ------------------------------------------------------------------ state

export interface Grant {
  at: number;
  reason: string;
  coins: number;
  packs: { set: string; count: number }[];
  /** Extra line shown with the grant (e.g. the starter Structure Decks). */
  note?: string;
}

export interface CollectionState {
  v: 1;
  dp: number;
  /** card name → rarity → copies */
  owned: Record<string, Partial<Record<Rarity, number>>>;
  /** set code → unopened packs */
  packs: Record<string, number>;
  /** Base seed for pack generation; packs are seeded by (seed, opened). */
  seed: number;
  opened: number;
  /** Counter for reward rolls (bonus packs), so rewards are reproducible too. */
  rolls: number;
  collectionMode: boolean;
  starterGiven: boolean;
  /** Latest grants, newest first (shown by the packs screen). */
  grants: Grant[];
  /** Best pulls (Ultra and above), newest first. */
  hits: { name: string; rarity: Rarity; set: string; at: number }[];
  stats: { packsOpened: number; dpEarned: number; dpSpent: number };
}

const KEY = 'edison.collection.v1';
let state: CollectionState | null = null;
const listeners = new Set<(s: CollectionState) => void>();

function fresh(): CollectionState {
  return {
    v: 1,
    dp: 0,
    owned: {},
    packs: {},
    seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
    opened: 0,
    rolls: 0,
    collectionMode: false,
    starterGiven: false,
    grants: [],
    hits: [],
    stats: { packsOpened: 0, dpEarned: 0, dpSpent: 0 },
  };
}

function load(): CollectionState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const s = JSON.parse(raw) as CollectionState;
      if (s && s.v === 1) return { ...fresh(), ...s, stats: { ...fresh().stats, ...s.stats } };
    }
  } catch {
    /* corrupt or unavailable storage: start over */
  }
  return fresh();
}

function S(): CollectionState {
  if (!state) {
    state = load();
    if (!state.starterGiven) giveStarter(state);
    else swapOffShelfPacks(state);
  }
  return state;
}

/** Unopened packs from sets no longer on the shelf (older boosters, given before the Edison-era shelf) become current boosters. */
function swapOffShelfPacks(s: CollectionState) {
  const core = playableSets().filter((p) => p.available && p.data.format.startsWith('core'));
  if (!core.length) return;
  let i = 0;
  for (const [code, n] of Object.entries(s.packs)) {
    const set = playableSet(code);
    if (set?.available || !n) continue;
    delete s.packs[code];
    for (let k = 0; k < n; k++, i++) {
      const to = core[i % core.length].code;
      s.packs[to] = (s.packs[to] ?? 0) + 1;
    }
  }
  if (i) save();
}

function save() {
  const s = S();
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / unavailable */
  }
  for (const l of listeners) {
    try {
      l(s);
    } catch (e) {
      console.error(e);
    }
  }
}

export function getCollection(): Readonly<CollectionState> {
  return S();
}

export function onCollectionChange(fn: (s: CollectionState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wipe everything (a new starter gift is given). */
export function resetCollection() {
  state = fresh();
  giveStarter(state);
  save();
}

// ------------------------------------------------------------------ owned cards

export function ownedCount(name: string): number {
  const r = S().owned[name];
  if (!r) return 0;
  let n = 0;
  for (const k in r) n += r[k as Rarity] ?? 0;
  return n;
}

export function ownedRarities(name: string): Partial<Record<Rarity, number>> {
  return { ...(S().owned[name] ?? {}) };
}

/** Highest rarity owned of a card. */
export function bestOwnedRarity(name: string): Rarity | null {
  const r = S().owned[name];
  if (!r) return null;
  let best: Rarity | null = null;
  for (const k of RARITY_ORDER) if ((r[k] ?? 0) > 0) best = k;
  return best;
}

export function ownedNames(): string[] {
  return Object.keys(S().owned).filter((n) => ownedCount(n) > 0);
}

/** Total number of cards owned. */
export function totalOwned(): number {
  let n = 0;
  for (const name in S().owned) n += ownedCount(name);
  return n;
}

function addCard(s: CollectionState, name: string, rarity: Rarity, n = 1) {
  const r = (s.owned[name] ??= {});
  r[rarity] = (r[rarity] ?? 0) + n;
}

// ------------------------------------------------------------------ collection mode (deck building)

/** When on, the player's custom decks are limited to the cards they own. Premade/AI decks are unaffected. */
export function isCollectionMode(): boolean {
  return S().collectionMode;
}

export function setCollectionMode(on: boolean) {
  S().collectionMode = on;
  save();
}

/**
 * How many copies of a card a custom deck may hold under Collection mode
 * (Infinity when Collection mode is off). The ban-list limit still applies separately.
 */
export function collectionCap(name: string): number {
  return isCollectionMode() ? ownedCount(name) : Infinity;
}

/** Cards a decklist uses beyond what is owned: [name, missing copies]. Empty when it is fully owned. */
export function missingFromCollection(entries: [string, number][]): [string, number][] {
  const need = new Map<string, number>();
  for (const [n, c] of entries) need.set(n, (need.get(n) ?? 0) + c);
  const out: [string, number][] = [];
  for (const [n, c] of need) {
    const have = ownedCount(n);
    if (c > have) out.push([n, c - have]);
  }
  return out;
}

// ------------------------------------------------------------------ currency & packs

export function dp(): number {
  return S().dp;
}

function earn(s: CollectionState, n: number) {
  s.dp += n;
  s.stats.dpEarned += n;
}

export function packCount(code: string): number {
  return S().packs[code] ?? 0;
}

/** Unopened packs, in set release order. */
export function unopenedPacks(): { code: string; count: number }[] {
  const s = S();
  return playableSets()
    .map((p) => ({ code: p.code, count: s.packs[p.code] ?? 0 }))
    .filter((x) => x.count > 0);
}

export function totalUnopened(): number {
  return unopenedPacks().reduce((a, x) => a + x.count, 0);
}

/** Price of one pack of a set in DP, or null when it isn't sold. */
export function packPrice(code: string): number | null {
  const set = playableSet(code);
  if (!set || !set.available) return null;
  return PRICES[set.data.format];
}

export function boxPrice(code: string): number | null {
  const p = packPrice(code);
  return p == null ? null : p * BOX_DISCOUNT_PACKS;
}

/** Buy `n` packs (or a box when n = packs per box). Returns false if not enough DP. */
export function buyPacks(code: string, n: number, box = false): boolean {
  const price = box ? boxPrice(code) : packPrice(code);
  if (price == null) return false;
  const cost = box ? price : price * n;
  const s = S();
  if (s.dp < cost) return false;
  s.dp -= cost;
  s.stats.dpSpent += cost;
  s.packs[code] = (s.packs[code] ?? 0) + n;
  save();
  return true;
}

export function buyStructureDeck(code: string): boolean {
  const d = structureDeck(code);
  const s = S();
  if (!d || s.dp < PRICES.structureDeck) return false;
  s.dp -= PRICES.structureDeck;
  s.stats.dpSpent += PRICES.structureDeck;
  for (const c of structureDeckCards(d)) addCard(s, c.name, c.rarity, c.copies);
  save();
  return true;
}

export interface OpenedPull extends Pull {
  /** First copy of this card in the collection. */
  isNew: boolean;
  /** First copy in this rarity (but not the first copy overall). */
  isNewRarity: boolean;
}

export interface OpenResult {
  code: string;
  seed: number;
  pulls: OpenedPull[];
}

/** Open one unopened pack of `code`. Returns null when none is left. */
export function openNextPack(code: string): OpenResult | null {
  const s = S();
  if ((s.packs[code] ?? 0) <= 0) return null;
  const seed = mixSeed(s.seed, s.opened);
  const pulls = openPack(code, seed);
  s.packs[code]--;
  if (s.packs[code] <= 0) delete s.packs[code];
  s.opened++;
  s.stats.packsOpened++;
  const out: OpenedPull[] = [];
  for (const p of pulls) {
    const isNew = ownedCount(p.name) === 0;
    const isNewRarity = !isNew && !(s.owned[p.name]?.[p.rarity] ?? 0);
    addCard(s, p.name, p.rarity);
    out.push({ ...p, isNew, isNewRarity });
    if (rarityRank(p.rarity) >= rarityRank('UR')) s.hits.unshift({ name: p.name, rarity: p.rarity, set: code, at: Date.now() });
  }
  s.hits.length = Math.min(s.hits.length, 24);
  save();
  return { code, seed, pulls: out };
}

// ------------------------------------------------------------------ dupes

/**
 * Convert every copy beyond 3 of a card into DP. The three best-rarity copies are kept.
 * With apply = false nothing changes (preview).
 */
export function convertExtras(apply = true): { copies: number; dp: number } {
  const s = S();
  let copies = 0;
  let gained = 0;
  for (const name in s.owned) {
    const r = s.owned[name];
    let keep = 3;
    for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
      const k = RARITY_ORDER[i];
      const have = r[k] ?? 0;
      if (!have) continue;
      const kept = Math.min(have, keep);
      keep -= kept;
      const extra = have - kept;
      if (extra > 0) {
        copies += extra;
        gained += extra * EXTRA_COPY_DP[k];
        if (apply) {
          if (kept) r[k] = kept;
          else delete r[k];
        }
      }
    }
  }
  if (apply && copies) {
    earn(s, gained);
    s.grants.unshift({ at: Date.now(), reason: `Traded ${copies} extra cop${copies === 1 ? 'y' : 'ies'}`, coins: gained, packs: [] });
    s.grants.length = Math.min(s.grants.length, 12);
    save();
  }
  return { copies, dp: gained };
}

// ------------------------------------------------------------------ prizes & rewards

/** Core booster sets that can currently be opened (prize packs default to these). */
function prizeSets(): string[] {
  return playableSets()
    .filter((p) => p.available && (p.data.format === 'core' || p.data.format === 'core-tshd'))
    .map((p) => p.code);
}

function randomPrizeSet(s: CollectionState): string {
  const pool = prizeSets();
  const i = mixSeed(s.seed ^ 0x5bd1e995, s.rolls++) % pool.length;
  return pool[i];
}

function applyGrant(s: CollectionState, g: PrizeGrant): Grant {
  const packs = new Map<string, number>();
  const n = Math.max(0, Math.floor(g.packs ?? 0));
  for (let i = 0; i < n; i++) {
    const want = g.set && playableSet(g.set)?.playable.length ? g.set.toUpperCase() : randomPrizeSet(s);
    packs.set(want, (packs.get(want) ?? 0) + 1);
  }
  for (const [code, c] of packs) s.packs[code] = (s.packs[code] ?? 0) + c;
  const coins = Math.max(0, Math.floor(g.coins ?? 0));
  if (coins) earn(s, coins);
  const grant: Grant = { at: Date.now(), reason: g.reason, coins, packs: [...packs].map(([set, count]) => ({ set, count })) };
  s.grants.unshift(grant);
  s.grants.length = Math.min(s.grants.length, 12);
  return grant;
}

registerPrizeHandler((g) => {
  applyGrant(S(), g);
  save();
});

export type DuelMode = 'duel' | 'match' | 'tournament' | 'locals' | 'draft' | (string & {});

export interface RewardSummary extends Grant {}

/**
 * Award (and return) the prize for a finished duel or event.
 *   duel   single duel vs the AI: win 100 DP, loss 30 DP; a win has a 1-in-4 chance of a bonus pack.
 *   match  best-of-3 vs the AI: win 200 DP, loss 60 DP; a win has a 1-in-2 chance of a bonus pack.
 *   tournament / locals / draft: pass `place` (1 = winner) when the event ends for the player.
 *     Without `place` a round win pays 60 DP (loss 20) and the event payout comes later.
 */
export function rewardForDuel(o: { won: boolean; mode: DuelMode; place?: number; players?: number }): RewardSummary {
  const s = S();
  const roll = () => (mixSeed(s.seed ^ 0x27d4eb2f, s.rolls++) % 10000) / 10000;
  let coins = 0;
  let packs = 0;
  let set: string | undefined;
  let reason = '';
  const place = o.place;
  const label = (m: string) => (place ? `${m} · ${ordinal(place)} place` : m);
  switch (o.mode) {
    case 'tournament': {
      reason = label('Tournament');
      if (place == null) [coins, reason] = [o.won ? 60 : 20, o.won ? 'Tournament round win' : 'Tournament round'];
      else if (place === 1) [coins, packs] = [1500, 6];
      else if (place === 2) [coins, packs] = [1000, 4];
      else if (place <= 4) [coins, packs] = [700, 3];
      else if (place <= 8) [coins, packs] = [450, 2];
      else [coins, packs, set] = [200, 1, turboSet(s)];
      break;
    }
    case 'locals': {
      reason = label('Locals');
      if (place == null) [coins, reason] = [o.won ? 50 : 15, o.won ? 'Locals round win' : 'Locals round'];
      else if (place === 1) [coins, packs] = [800, 4];
      else if (place === 2) [coins, packs] = [500, 2];
      else if (place <= 4) [coins, packs] = [300, 1];
      else [coins, packs, set] = [100, 1, turboSet(s)];
      break;
    }
    case 'draft': {
      reason = label('Draft');
      if (place == null) [coins, reason] = [o.won ? 60 : 20, o.won ? 'Draft round win' : 'Draft round'];
      else if (place === 1) [coins, packs] = [600, 3];
      else if (place === 2) [coins, packs] = [400, 2];
      else [coins, packs] = [150, 1];
      break;
    }
    case 'match': {
      reason = o.won ? 'Match win' : 'Match played';
      coins = o.won ? 200 : 60;
      if (o.won && roll() < 0.5) packs = 1;
      break;
    }
    default: {
      reason = o.won ? 'Duel win' : 'Duel played';
      coins = o.won ? 100 : 30;
      if (o.won && roll() < 0.25) packs = 1;
    }
  }
  const g = applyGrant(s, { coins, packs, set, reason });
  save();
  return g;
}

function turboSet(s: CollectionState): string | undefined {
  const t = playableSets().filter((p) => p.available && p.data.format === 'turbo');
  if (!t.length) return undefined;
  return t[mixSeed(s.seed ^ 0x165667b1, s.rolls++) % t.length].code;
}

function ordinal(n: number) {
  const v = n % 100;
  return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th');
}

/** Latest grants, newest first. */
export function recentGrants(): Grant[] {
  return S().grants;
}

// ------------------------------------------------------------------ starter gift

function giveStarter(s: CollectionState) {
  s.starterGiven = true;
  for (const code of STARTER.structureDecks) {
    const d = STRUCTURE_DECKS.find((x) => x.code === code);
    if (!d) continue;
    for (const c of structureDeckCards(d)) addCard(s, c.name, c.rarity, c.copies * STARTER.copiesEach);
  }
  // Mostly the current boosters (3 each), then Hidden Arsenal and a Turbo Pack, up to 12.
  const avail = playableSets().filter((p) => p.available);
  const core = avail.filter((p) => p.data.format.startsWith('core'));
  const ha = avail.filter((p) => p.data.format === 'hidden-arsenal');
  const order = [...core, ...core, ...core, ...ha, ...ha, ...avail.filter((p) => p.data.format === 'turbo')];
  let left = STARTER.packs;
  for (let i = 0; left > 0 && order.length; i++, left--) {
    const code = order[i % order.length].code;
    s.packs[code] = (s.packs[code] ?? 0) + 1;
  }
  earn(s, STARTER.dp);
  s.grants.unshift({
    at: Date.now(),
    reason: 'Welcome gift',
    coins: STARTER.dp,
    packs: Object.entries(s.packs).map(([set, count]) => ({ set, count })),
    note: `Plus ${STARTER.copiesEach} copies each of the ${listNames(STARTER.structureDecks.map((c) => STRUCTURE_DECKS.find((d) => d.code === c)?.name ?? c))} Structure Decks.`,
  });
}

function listNames(a: string[]) {
  return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

// ------------------------------------------------------------------ binder helpers

/** Owned / playable / printed for one set (a card counts once whatever its rarity). */
export function setCompletion(code: string): { owned: number; playable: number; printed: number } {
  const set = playableSet(code);
  if (!set) return { owned: 0, playable: 0, printed: 0 };
  const owned = set.playable.filter((n) => ownedCount(n) > 0).length;
  return { owned, playable: set.playable.length, printed: set.printed };
}
