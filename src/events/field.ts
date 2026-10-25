// Fields for every event tier. Bigger events draw higher-tier decks (and more real SJC lists),
// stronger personas and harder AI. Also the persistent AI circuit: ~200 named duelists with
// hidden ratings and fixed decks, rebuilt deterministically from a season seed.
import type { Difficulty } from '../ai/ai';
import { PREMADE_DECKS, deckById, type DeckDef } from '../decks';
import { META, classifyDeck, decksFor, snapshot } from '../locals/meta';
import { REGULARS } from '../locals/regulars';
import { hash, pickOne, rand, weighted, type RngState } from '../locals/rng';
import type { LocalsEntrant, MetaKey } from '../locals/types';
import { difficultyFor, personaName, personaTitle } from '../tournament/personas';
import { aiRating, skillForRating } from './ratings';

export interface EventEntrant extends LocalsEntrant {
  /** Hidden Elo rating (the player's live rating for the human). */
  rating: number;
  /** Set when the entrant is a circuit duelist. */
  circuitId?: string;
}

export type CircuitTier = 'local' | 'regional' | 'pro' | 'world';

export interface CircuitDuelist {
  id: string;
  name: string;
  title: string;
  tier: CircuitTier;
  rating: number;
  skill: number;
  difficulty: Difficulty;
  meta: MetaKey;
  deckId: string;
  avatar: string;
  /** Locals regular id (reuses the Locals Night cast). */
  regular?: string;
  blurb?: string;
  /** Country, for the international Worlds field. */
  country?: string;
  /** Chance to show up at each kind of open event. */
  attend: { locals: number; regional: number; sjc: number };
}

// ------------------------------------------------------------------ decks by tier

/** How strongly a tier leans to the strong archetypes (per Elo point of archetype strength). */
const STRENGTH_BIAS = [0, 0.012, 0.02, 0.028, 0.034];
/** How often a seat brings a real placing list when its archetype has one. */
const REAL_PREF = [0.7, 0.8, 0.88, 0.94, 0.98];
/** Rogue share multiplier by tier. */
const ROGUE_SHARE = [1, 0.6, 0.4, 0.25, 0.15];

export function drawTierDeck(s: RngState, tier: number): { meta: MetaKey; deck: DeckDef } {
  const t = Math.max(0, Math.min(4, tier));
  const live = META.filter((m) => decksFor(m.key).length);
  const m = weighted(s, live.length ? live : META, (x) => x.share * Math.exp(x.strength * STRENGTH_BIAS[t]) * (x.key === 'rogue' ? ROGUE_SHARE[t] : 1));
  const pool = decksFor(m.key);
  if (!pool.length) {
    const d = PREMADE_DECKS[Math.floor(rand(s) * PREMADE_DECKS.length)];
    return { meta: classifyDeck(d), deck: d };
  }
  const real = pool.filter((d) => d.event);
  // at higher tiers, rogue seats skip the weakest builds
  const other = pool.filter((d) => !d.event && (t < 2 || d.tier < 3 || m.key !== 'rogue'));
  const from = real.length && (!other.length || rand(s) < REAL_PREF[t]) ? real : other.length ? other : pool;
  const deck = from[Math.floor(rand(s) * from.length) % from.length];
  return { meta: classifyDeck(deck), deck };
}

// ------------------------------------------------------------------ personas by tier

/** Mean skill and spread of an anonymous seat by tier. */
export const SKILL_MEAN = [0, 25, 35, 50, 70];
const SKILL_SPREAD = [80, 70, 70, 60, 50];

const TIER_TITLES: string[][] = [
  [],
  ['Store Champion', 'Road Warrior', 'Regional Regular', 'Weekend Grinder', 'Deck Tinkerer', 'Locals Legend', 'First Big Event'],
  ['Regional Top 8', 'Former SJC Top 32', 'Road Warrior', 'Store Champion', 'Team Captain', 'Grinder', 'National Qualifier'],
  ['National Qualifier', 'Regional Champion', 'SJC Top 8', 'Circuit Grinder', 'Former Top 16'],
  ['National Champion', 'National Finalist', 'World Qualifier'],
];

export function difficultyForTier(s: RngState, tier: number, skill: number): Difficulty {
  if (tier >= 3) return 'hard';
  if (tier === 2) return skill > 5 ? 'hard' : 'normal';
  if (tier === 1) return skill > 20 ? 'hard' : skill < -15 ? 'easy' : 'normal';
  return difficultyFor('mixed', { next: () => rand(s) }, skill);
}

export interface FieldOptions {
  tier: number;
  size: number;
  sleeves: string[];
  avatars: string[];
  /** Names already taken (the player, circuit duelists). */
  used: Set<string>;
}

/** An anonymous seat for a given tier (walk-ins, travellers, the rest of a big open). */
export function anonymousEntrant(s: RngState, o: FieldOptions, id: string, seed: number): EventEntrant {
  const t = Math.max(0, Math.min(4, o.tier));
  const { meta, deck } = drawTierDeck(s, t);
  const rng = { next: () => rand(s) };
  const base = t === 0 ? personaTitle(rng) : { title: pickOne(s, TIER_TITLES[t]), skill: SKILL_MEAN[t] };
  const skill = Math.round((t === 0 ? base.skill : SKILL_MEAN[t]) + (rand(s) - 0.5) * SKILL_SPREAD[t]);
  const difficulty = difficultyForTier(s, t, skill);
  return {
    id,
    name: personaName(rng, o.used),
    avatar: o.avatars.length && rand(s) < 0.7 ? pickOne(s, o.avatars) : `persona-${Math.floor(rand(s) * 1e6)}`,
    sleeve: pickOne(s, o.sleeves.length ? o.sleeves : ['classic-red']),
    title: base.title,
    deck: snapshot(deck),
    meta,
    difficulty,
    skill,
    human: false,
    seed,
    rating: aiRating(difficulty, skill),
  };
}

/** A regular's deck: the same list every week (the rogue regular brings a new one each week). */
export function regularDeckFor(regId: string, meta: MetaKey, week: number) {
  const pool = decksFor(meta);
  const real = pool.filter((d) => d.event);
  const list = real.length ? real : pool;
  if (!list.length) return null;
  const k = meta === 'rogue' ? hash(`${regId}-${week}`) : hash(regId);
  return list[k % list.length];
}

/** Circuit duelist as an event entrant. */
export function duelistEntrant(d: CircuitDuelist, id: string, seed: number, sleeves: string[], week = 1): EventEntrant {
  const deck = (d.regular ? regularDeckFor(d.regular, d.meta, week) : null) ?? deckById(d.deckId) ?? PREMADE_DECKS[0];
  return {
    id,
    name: d.name,
    avatar: d.avatar,
    sleeve: sleeves.length ? sleeves[hash(d.id) % sleeves.length] : 'classic-red',
    title: d.country ? `${d.title} · ${d.country}` : d.title,
    deck: snapshot(deck),
    meta: classifyDeck(deck),
    difficulty: d.difficulty,
    skill: d.skill,
    human: false,
    seed,
    regular: d.regular,
    blurb: d.blurb,
    rating: d.rating,
    circuitId: d.id,
  };
}

// ------------------------------------------------------------------ the AI circuit

const COUNTRIES = ['Japan', 'Germany', 'Italy', 'France', 'United Kingdom', 'Spain', 'Mexico', 'Brazil', 'Canada', 'Australia', 'Netherlands', 'Sweden', 'Portugal', 'Chile', 'Belgium', 'Peru'];

const LOCAL_TITLES = ['Locals regular', 'Binder trader', 'Friday grinder', 'New to the scene', 'Deck tinkerer', 'Weekend duelist', 'Store veteran'];
const REGIONAL_TITLES = ['Road warrior', 'Regional regular', 'Store champion', 'Team captain', 'Weekend grinder', 'Regional Top 16'];
const PRO_TITLES = ['National qualifier', 'SJC Top 8', 'Regional champion', 'Circuit grinder', 'Former Top 16 at Nationals', 'Feature-match regular'];

/** Circuit sizes by tier (local includes the nine Locals regulars). */
export const CIRCUIT_SHAPE = { local: 60, regional: 90, pro: 50, world: 24 } as const;

const circuitCache = new Map<number, CircuitDuelist[]>();

/** ~200 domestic duelists plus the international Worlds field, rebuilt from the season seed. */
export function buildCircuit(seed: number): CircuitDuelist[] {
  const hit = circuitCache.get(seed);
  if (hit) return hit;
  const s: RngState = { rng: hash(`circuit-${seed}`) };
  const used = new Set<string>(REGULARS.map((r) => r.name));
  const out: CircuitDuelist[] = [];
  for (const r of REGULARS) {
    const deck = regularDeckFor(r.id, r.meta, 1);
    if (!deck) continue;
    out.push({
      id: `reg-${r.id}`,
      name: r.name,
      title: r.title,
      tier: 'local',
      rating: aiRating(r.difficulty, r.skill),
      skill: r.skill,
      difficulty: r.difficulty,
      meta: r.meta,
      deckId: deck.id,
      avatar: r.avatar,
      regular: r.id,
      blurb: r.blurb,
      attend: { locals: r.attendance, regional: r.skill >= 40 ? 0.55 : 0.2, sjc: r.skill >= 50 ? 0.5 : 0.1 },
    });
  }
  const rng = { next: () => rand(s) };
  const add = (tier: CircuitTier, n: number, deckTier: number, lo: number, hi: number, titles: string[], attend: CircuitDuelist['attend']) => {
    for (let i = 0; i < n; i++) {
      const skill = Math.round(lo + rand(s) * (hi - lo));
      const difficulty = tier === 'local' ? difficultyFor('mixed', rng, skill) : tier === 'regional' ? (skill > 30 ? 'hard' : 'normal') : 'hard';
      const { meta, deck } = drawTierDeck(s, deckTier);
      const country = tier === 'world' ? COUNTRIES[i % COUNTRIES.length] : undefined;
      out.push({
        id: `${tier[0]}${i + 1}`,
        name: personaName(rng, used),
        title: tier === 'world' ? (i < COUNTRIES.length ? 'National Champion' : 'National Finalist') : pickOne(s, titles),
        tier,
        rating: aiRating(difficulty, skill),
        skill,
        difficulty,
        meta,
        deckId: deck.id,
        avatar: `persona-${Math.floor(rand(s) * 1e6)}`,
        country,
        attend: {
          locals: attend.locals * (0.6 + rand(s) * 0.8),
          regional: attend.regional * (0.6 + rand(s) * 0.8),
          sjc: Math.min(1, attend.sjc * (0.7 + rand(s) * 0.6)),
        },
      });
    }
  };
  add('local', CIRCUIT_SHAPE.local - out.length, 0, -45, 35, LOCAL_TITLES, { locals: 0.33, regional: 0.15, sjc: 0.05 });
  add('regional', CIRCUIT_SHAPE.regional, 1, -5, 60, REGIONAL_TITLES, { locals: 0.04, regional: 0.45, sjc: 0.45 });
  add('pro', CIRCUIT_SHAPE.pro, 3, 35, 100, PRO_TITLES, { locals: 0, regional: 0.35, sjc: 0.9 });
  add('world', CIRCUIT_SHAPE.world, 4, 60, 110, [], { locals: 0, regional: 0, sjc: 0 });
  circuitCache.set(seed, out);
  return out;
}

/** Domestic circuit (standings exclude the international Worlds field). */
export const domestic = (all: CircuitDuelist[]) => all.filter((d) => d.tier !== 'world');

export { skillForRating };
