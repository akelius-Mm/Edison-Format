// Tournament lifecycle: creation, round progression and persistence.
import type { Difficulty } from '../ai/ai';
import { PREMADE_DECKS, type DeckDef } from '../decks';
import { loadJSON, saveJSON } from '../ui/settings';
import { Mulberry, difficultyFor, personaName, personaTitle, pick } from './personas';
import { simulateMatch } from './simulate';
import { computeStandings, finalPlacements, nextTopRound, pairSwissRound, roundComplete, seedTopCut, swissRoundsFor, topCutFor } from './swiss';
import type { DeckSnapshot, DifficultyMix, Entrant, GameResult, Match, SimMode, Tournament } from './types';

export * from './types';
export { computeStandings, finalPlacements, matchOutcomeLabel };

const ACTIVE_KEY = 'edison.tournament.active.v1';

export interface CreateOptions {
  name: string;
  size: 8 | 16 | 32;
  bestOf: 1 | 3;
  simMode: SimMode;
  difficultyMix: DifficultyMix;
  human: { name: string; avatar: string; sleeve: string; deck: DeckSnapshot };
  /** Sleeve/avatar ids to dress AI personas with. */
  sleeves: string[];
  avatars: string[];
  seed?: number;
}

export function snapshotPremade(d: DeckDef): DeckSnapshot {
  return { id: d.id, name: d.name, archetype: d.archetype, tier: d.tier, color: d.color, main: d.main, extra: d.extra };
}

const TIER_WEIGHT: Record<1 | 2 | 3, number> = { 1: 6, 2: 3, 3: 1.2 };

function weightedDeck(rng: Mulberry, pool: DeckDef[], counts: Map<string, number>) {
  // diminishing weight for decks already heavily represented
  const weights = pool.map((d) => TIER_WEIGHT[d.tier] / (1 + 0.35 * (counts.get(d.id) ?? 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function createTournament(o: CreateOptions): Tournament {
  const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = new Mulberry(seed);
  const pool = PREMADE_DECKS.length ? PREMADE_DECKS : [];
  if (!pool.length) throw new Error('No premade decks are available for AI entrants.');
  const used = new Set<string>([o.human.name]);
  const counts = new Map<string, number>();
  const avatars = [...o.avatars];
  const entrants: Entrant[] = [];
  const seeds = Array.from({ length: o.size }, (_, i) => i + 1).sort(() => rng.next() - 0.5);
  entrants.push({
    id: 'p0',
    name: o.human.name,
    avatar: o.human.avatar,
    sleeve: o.human.sleeve,
    title: 'You',
    deck: o.human.deck,
    difficulty: 'hard',
    skill: 40,
    human: true,
    seed: seeds[0],
  });
  for (let i = 1; i < o.size; i++) {
    const t = personaTitle(rng);
    // a few rogue picks: 1 in 6 entrants ignores the meta entirely
    const deck = rng.next() < 0.16 ? pick(pool, rng) : weightedDeck(rng, pool, counts);
    counts.set(deck.id, (counts.get(deck.id) ?? 0) + 1);
    const skill = t.skill + Math.round((rng.next() - 0.5) * 40);
    let avatar: string;
    if (avatars.length && rng.next() < 0.75) avatar = avatars.splice(Math.floor(rng.next() * avatars.length), 1)[0];
    else avatar = `persona-${Math.floor(rng.next() * 1e6)}`;
    entrants.push({
      id: `p${i}`,
      name: personaName(rng, used),
      avatar,
      sleeve: o.sleeves.length ? pick(o.sleeves, rng) : 'classic-red',
      title: t.title,
      deck: snapshotPremade(deck),
      difficulty: difficultyFor(o.difficultyMix, rng, skill),
      skill,
      human: false,
      seed: seeds[i],
    });
  }
  return {
    version: 1,
    id: 'tour-' + Date.now().toString(36),
    name: o.name.trim() || 'Edison Open',
    created: Date.now(),
    size: o.size,
    bestOf: o.bestOf,
    simMode: o.simMode,
    difficultyMix: o.difficultyMix,
    entrants,
    humanId: 'p0',
    swissRounds: swissRoundsFor(o.size),
    topCut: topCutFor(o.size),
    rounds: [],
    top: [],
    phase: 'lobby',
  };
}

// ------------------------------------------------------------------ persistence
export function loadActiveTournament(): Tournament | null {
  const t = loadJSON<Tournament | null>(ACTIVE_KEY, null);
  if (!t || t.version !== 1 || !Array.isArray(t.entrants)) return null;
  return t;
}
export function saveTournament(t: Tournament) {
  saveJSON(ACTIVE_KEY, t);
}
export function clearActiveTournament() {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ queries
export const entrant = (t: Tournament, id: string | null | undefined) => t.entrants.find((e) => e.id === id);

export function currentMatches(t: Tournament): Match[] {
  if (t.phase === 'swiss') return t.rounds[t.rounds.length - 1] ?? [];
  if (t.phase === 'top' || t.phase === 'done') return t.top[t.top.length - 1] ?? [];
  return [];
}

export function currentRoundLabel(t: Tournament) {
  if (t.phase === 'lobby') return 'Registration';
  if (t.phase === 'swiss') return `Swiss Round ${t.rounds.length} of ${t.swissRounds}`;
  if (t.phase === 'top') return currentMatches(t)[0]?.label ?? 'Top Cut';
  return 'Tournament complete';
}

/** The human's match in the current round if it still needs to be played. */
export function pendingHumanMatch(t: Tournament): Match | null {
  return currentMatches(t).find((m) => m.result == null && (m.a === t.humanId || m.b === t.humanId)) ?? null;
}

export function humanMatchThisRound(t: Tournament): Match | null {
  return currentMatches(t).find((m) => m.a === t.humanId || m.b === t.humanId) ?? null;
}

export function isRoundComplete(t: Tournament) {
  return roundComplete(currentMatches(t));
}

export function humanEliminated(t: Tournament) {
  if (t.phase === 'top' || t.phase === 'done') {
    const inCut = t.top[0]?.some((m) => m.a === t.humanId || m.b === t.humanId);
    if (!inCut) return true;
    for (const r of t.top) for (const m of r) if ((m.a === t.humanId || m.b === t.humanId) && m.result && (m.result === 'a' ? m.a : m.b) !== t.humanId) return true;
  }
  return false;
}

function matchOutcomeLabel(m: Match, perspective: string) {
  const wa = m.games.filter((g) => g.winner === 0).length;
  const wb = m.games.filter((g) => g.winner === 1).length;
  const dr = m.games.filter((g) => g.winner == null).length;
  const meA = m.a === perspective;
  const [w, l] = meA ? [wa, wb] : [wb, wa];
  return `${w}-${l}${dr ? `-${dr}` : ''}`;
}

// ------------------------------------------------------------------ progression

/** Advance to the next round (pairing it). Returns false when nothing to do. */
export function advance(t: Tournament): boolean {
  if (t.phase === 'done') return false;
  if (t.phase === 'lobby') {
    t.phase = 'swiss';
    t.rounds.push(pairSwissRound(t, 1));
    return true;
  }
  if (!isRoundComplete(t)) return false;
  if (t.phase === 'swiss') {
    if (t.rounds.length < t.swissRounds) {
      t.rounds.push(pairSwissRound(t, t.rounds.length + 1));
      return true;
    }
    t.phase = 'top';
    t.top.push(seedTopCut(t));
    return true;
  }
  if (t.phase === 'top') {
    const last = t.top[t.top.length - 1];
    if (last.length === 1) {
      t.phase = 'done';
      t.placements = finalPlacements(t);
      return true;
    }
    t.top.push(nextTopRound(t));
    return true;
  }
  return false;
}

export function recordHumanMatch(t: Tournament, matchId: string, games: GameResult[], result: 'a' | 'b' | 'draw') {
  const m = currentMatches(t).find((x) => x.id === matchId);
  if (!m) return;
  m.games = games;
  m.result = result;
}

/** Simulate every unplayed AI-vs-AI match of the current round (human match excluded). */
export async function simulateRound(
  t: Tournament,
  opts: { skipFirstDraw?: boolean; includeHuman?: boolean; onProgress?: (done: number, total: number, m: Match) => void; shouldStop?: () => boolean },
) {
  const todo = currentMatches(t).filter((m) => m.result == null && (opts.includeHuman || (m.a !== t.humanId && m.b !== t.humanId)));
  let done = 0;
  for (const m of todo) {
    if (opts.shouldStop?.()) break;
    opts.onProgress?.(done, todo.length, m);
    const A = entrant(t, m.a)!;
    const B = entrant(t, m.b)!;
    await simulateMatch(m, A, B, { bestOf: t.bestOf, mode: t.simMode, requireWinner: m.stage === 'top', skipFirstDraw: opts.skipFirstDraw });
    done++;
    saveTournament(t);
    opts.onProgress?.(done, todo.length, m);
    await new Promise((r) => setTimeout(r, 0));
  }
}

export function humanStanding(t: Tournament) {
  return computeStandings(t).find((s) => s.id === t.humanId)!;
}

export function difficultyLabel(d: Difficulty) {
  return d === 'easy' ? 'Easy' : d === 'normal' ? 'Normal' : 'Hard';
}
