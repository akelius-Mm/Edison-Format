// Draft / Sealed event state: the pod, packs, picks, decks and the 3-round tournament.
// Pure logic (no DOM); the screen in src/ui/screens/draft.ts drives it and persists it.
import type { CardData } from '../engine/card';
import { Rng } from '../engine/rng';
import { Mulberry, personaName, personaTitle } from '../tournament/personas';
import { headlessGame } from '../tournament/simulate';
import { computeStandings, pairSwissRound } from '../tournament/swiss';
import type { GameResult, Match, Standing, Tournament } from '../tournament/types';
import { aiPick, randomBias, type DrafterBias } from './ai';
import { autoBuild, deckRating, fillerMonsters, type BuiltDeck } from './build';
import { draftCard, draftPool, isExtraDeck } from './cards';
import { generateEventPacks, type PackCard } from './packs';
import { EDISON_PACK, planLabel, roundsFor, type AiLevel, type RealSize, type TourneyKind } from './sets';

export type DraftMode = 'draft' | 'sealed';
export type DraftPhase = 'draft' | 'build' | 'tournament' | 'done';

/** Default table size; an event can seat 4, 6 or 8 (see DraftState.players). */
export const SEATS = 8;
export const SEALED_PACKS = 6;
/** Swiss rounds (single elimination uses roundsFor). */
export const TOURNEY_ROUNDS = 3;

export interface DraftPlayer {
  id: string;
  name: string;
  title: string;
  avatar: string;
  sleeve: string;
  human: boolean;
  bias: DrafterBias;
  /** Elo-style skill offset for simulated matches. */
  skill: number;
}

export interface DeckIds {
  main: string[];
  extra: string[];
}

export interface DraftState {
  version: 1;
  id: string;
  seed: number;
  mode: DraftMode;
  created: number;
  /** Packs per player. */
  packCount: number;
  /** Booster for each pack round: EDISON_PACK or a real set code (missing in old saves = Edison). */
  plan?: string[];
  bestOf: 1 | 3;
  players: DraftPlayer[];
  /** Packs as opened: [pack number][seat]. */
  packs: PackCard[][][];
  /** Draft: what is left of the pack each seat currently holds. */
  current: PackCard[][];
  /** Draft: pack number (0-based). */
  round: number;
  /** Draft: pick within the pack (0-based). */
  pick: number;
  /** Number of packs the human has opened (watched the opening). */
  opened: number;
  /** Picks per seat, in pick order. */
  picks: PackCard[][];
  phase: DraftPhase;
  /** The human's deck (card ids, duplicates as drafted). */
  deck?: DeckIds;
  /** AI decks by seat (index 0 unused). */
  aiDecks?: (DeckIds | null)[];
  savedDeckId?: string;
  /** Tournament rounds (Swiss, 3 rounds; or single elimination). */
  rounds: Match[][];
  recorded?: boolean;
  /** Custom setup (missing in old saves = Swiss, normal AI, fillers on, 9-card boosters). */
  opts?: DraftEventOptions;
}

export interface DraftEventOptions {
  tourney: TourneyKind;
  ai: AiLevel;
  /** Free basic monsters may top decks up to 40. */
  fillers: boolean;
  realSize: RealSize;
  /** Edison Pack limited to these era sets (null = whole Edison pool). */
  edisonSets: string[] | null;
}

export const DEFAULT_EVENT_OPTIONS: DraftEventOptions = { tourney: 'swiss', ai: 'normal', fillers: true, realSize: 9, edisonSets: null };
export const optsOf = (s: DraftState): DraftEventOptions => ({ ...DEFAULT_EVENT_OPTIONS, ...s.opts });
/** Players at the table. */
export const seatsOf = (s: DraftState) => s.players.length;
/** Rounds in this event's tournament. */
export const totalRounds = (s: DraftState) => roundsFor(seatsOf(s), optsOf(s).tourney);

export interface NewDraftOptions {
  mode: DraftMode;
  /** Number of Edison Packs (ignored when `plan` is given). */
  packCount?: number;
  /** Booster per pack round; overrides packCount. */
  plan?: string[];
  bestOf?: 1 | 3;
  /** Players at the table (4, 6 or 8; default 8). */
  seats?: number;
  opts?: Partial<DraftEventOptions>;
  seed?: number;
  human: { name: string; avatar: string; sleeve: string };
  avatars: string[];
  sleeves: string[];
}

// ------------------------------------------------------------------ helpers

/** AI difficulty: Easy drafters pick loosely and play weaker; Hard ones pick tight and play stronger. */
const NOISE_BY_LEVEL: Record<AiLevel, number> = { easy: 1.9, normal: 1, hard: 0.35 };
const SKILL_BY_LEVEL: Record<AiLevel, number> = { easy: -60, normal: 0, hard: 50 };
function levelBias(b: DrafterBias, level: AiLevel): DrafterBias {
  return { ...b, noise: Math.min(1.4, b.noise * NOISE_BY_LEVEL[level]) };
}

export const card = (id: string): CardData => draftCard(id) ?? draftPool()[0];
export const cardsOf = (ids: string[]) => ids.map(card);
export const pickCards = (s: DraftState, seat = 0) => s.picks[seat].map((p) => card(p.id));

/** Pass direction for a pack: 1 = left (to the next seat), -1 = right. */
export const passDir = (round: number) => (round % 2 === 0 ? 1 : -1);

export function createDraft(o: NewDraftOptions): DraftState {
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const rng = new Rng(seed);
  const mrng = new Mulberry(seed ^ 0x2545f491);
  const used = new Set<string>([o.human.name]);
  const firsts = new Set<string>([o.human.name.split(' ')[0]]);
  const avatars = o.avatars.filter((a) => a !== o.human.avatar);
  const players: DraftPlayer[] = [
    { id: 'p0', name: o.human.name, title: 'You', avatar: o.human.avatar, sleeve: o.human.sleeve, human: true, bias: { noise: 0 }, skill: 0 },
  ];
  const seats = [4, 6, 8].includes(o.seats ?? 0) ? o.seats! : SEATS;
  const opts: DraftEventOptions = { ...DEFAULT_EVENT_OPTIONS, ...o.opts };
  for (let i = 1; i < seats; i++) {
    const t = personaTitle(mrng);
    let name = personaName(mrng, used);
    for (let tries = 0; firsts.has(name.split(' ')[0]) && tries < 30; tries++) name = personaName(mrng, used);
    firsts.add(name.split(' ')[0]);
    players.push({
      id: `p${i}`,
      name,
      title: t.title,
      avatar: avatars.length ? avatars[(i - 1) % avatars.length] : `avatar-${i}`,
      sleeve: o.sleeves.length ? rng.pick(o.sleeves) : o.human.sleeve,
      human: false,
      bias: levelBias(randomBias(rng), opts.ai),
      skill: Math.round(t.skill / 2) + SKILL_BY_LEVEL[opts.ai],
    });
  }
  const plan = o.plan?.length ? [...o.plan] : Array.from({ length: o.mode === 'sealed' ? SEALED_PACKS : (o.packCount ?? 4) }, () => EDISON_PACK);
  const packCount = plan.length;
  const packs = generateEventPacks(seed, plan, seats, { realSize: opts.realSize, edisonSets: opts.edisonSets });
  const s: DraftState = {
    version: 1,
    id: `draft-${seed.toString(36)}-${Date.now().toString(36)}`,
    seed,
    mode: o.mode,
    created: Date.now(),
    packCount,
    plan,
    bestOf: o.bestOf ?? 1,
    players,
    packs,
    current: o.mode === 'draft' ? packs[0].map((p) => [...p]) : [],
    round: 0,
    pick: 0,
    opened: 0,
    picks: players.map(() => []),
    phase: 'draft',
    rounds: [],
    opts,
  };
  if (o.mode === 'sealed') {
    // Everyone keeps all of their own packs.
    for (let seat = 0; seat < seats; seat++) s.picks[seat] = packs.flatMap((round) => round[seat]);
  }
  return s;
}

/** Draft: does the human need to open a pack before picking? */
export function needsOpening(s: DraftState) {
  if (s.phase !== 'draft') return false;
  if (s.mode === 'sealed') return s.opened < s.packCount;
  return s.pick === 0 && s.opened <= s.round;
}

/** The pack the human is looking at. */
export function humanPack(s: DraftState): PackCard[] {
  return s.current[0] ?? [];
}

/** Cards the human ends up with: every pick (Draft) or every card opened (Sealed). */
export function totalPicks(s: DraftState) {
  return s.packs.reduce((a, round) => a + (round[0]?.length ?? 0), 0);
}

/** Booster of each pack round. */
export const planOf = (s: DraftState): string[] => s.plan ?? Array.from({ length: s.packCount }, () => EDISON_PACK);
export const eventPacksLabel = (s: DraftState) => planLabel(planOf(s));

/** Human takes card `index` from their pack; every AI picks; packs are passed. */
export function makePick(s: DraftState, index: number) {
  if (s.phase !== 'draft' || s.mode !== 'draft') return;
  const pack = s.current[0];
  if (!pack || index < 0 || index >= pack.length) return;
  s.picks[0].push(pack.splice(index, 1)[0]);
  const seats = seatsOf(s);
  for (let seat = 1; seat < seats; seat++) {
    const p = s.current[seat];
    if (!p.length) continue;
    const rng = new Rng(s.seed + s.round * 7919 + s.pick * 131 + seat * 17);
    const i = aiPick(p.map((x) => card(x.id)), pickCards(s, seat), s.players[seat].bias, rng);
    s.picks[seat].push(p.splice(i, 1)[0]);
  }
  // pass
  const dir = passDir(s.round);
  const next: PackCard[][] = Array.from({ length: seats }, () => []);
  for (let seat = 0; seat < seats; seat++) next[(seat + dir + seats) % seats] = s.current[seat];
  s.current = next;
  s.pick++;
  if (!s.current[0].length) {
    s.round++;
    s.pick = 0;
    if (s.round >= s.packCount) {
      s.current = [];
      s.phase = 'build';
    } else s.current = s.packs[s.round].map((p) => [...p]);
  }
}

/** Sealed: mark the next pack opened; after the last one the event moves to deck building. */
export function markOpened(s: DraftState) {
  s.opened++;
  if (s.mode === 'sealed' && s.opened >= s.packCount) s.phase = 'build';
}

// ------------------------------------------------------------------ decks

/**
 * Plain vanilla monsters anyone may add to a deck, like basic lands: they keep a deck playable
 * when a pool (e.g. 45 picks from 9-card boosters) has fewer than 40 Main Deck cards.
 * Empty when the event turned them off.
 */
export function fillerIds(s?: DraftState): string[] {
  if (s && !optsOf(s).fillers) return [];
  return fillerMonsters(draftPool()).map((c) => c.id);
}

export function buildFromPool(pool: CardData[], fillers = true): BuiltDeck {
  return autoBuild(pool, { fillers: fillers ? fillerMonsters(draftPool()) : [] });
}

export const toIds = (d: BuiltDeck): DeckIds => ({ main: d.main.map((c) => c.id), extra: d.extra.map((c) => c.id) });
export const fromIds = (d: DeckIds): BuiltDeck => ({ main: cardsOf(d.main), extra: cardsOf(d.extra) });

export function autoBuildHuman(s: DraftState): DeckIds {
  return toIds(buildFromPool(pickCards(s, 0), optsOf(s).fillers));
}

/** Problems with the human's deck (empty = ready to play). */
export function deckProblems(s: DraftState, d: DeckIds): string[] {
  const out: string[] = [];
  if (d.main.length < 40) out.push(`Main Deck needs at least 40 cards (${d.main.length}).`);
  if (d.main.length > 60) out.push(`Main Deck can have at most 60 cards (${d.main.length}).`);
  if (d.extra.length > 15) out.push(`Extra Deck can have at most 15 cards (${d.extra.length}).`);
  // only cards you drafted, as many copies as you drafted
  const have = new Map<string, number>();
  for (const p of s.picks[0]) have.set(p.id, (have.get(p.id) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const id of [...d.main, ...d.extra]) used.set(id, (used.get(id) ?? 0) + 1);
  const free = new Set(fillerIds(s));
  for (const [id, n] of used) if (n > (have.get(id) ?? 0) && !free.has(id)) out.push(`${card(id).name}: ${n} used, ${have.get(id) ?? 0} drafted.`);
  for (const id of d.main) if (isExtraDeck(card(id))) out.push(`${card(id).name} belongs in the Extra Deck.`);
  return [...new Set(out)];
}

/** Lock in the human deck, auto-build the AI decks and pair round 1. */
export function startTournament(s: DraftState, deck: DeckIds) {
  s.deck = deck;
  s.aiDecks = s.players.map((p, seat) => (seat === 0 ? null : toIds(buildFromPool(pickCards(s, seat), optsOf(s).fillers))));
  s.phase = 'tournament';
  s.rounds = [];
  pairNextRound(s);
}

function asTournament(s: DraftState): Tournament {
  return {
    entrants: s.players.map((p, i) => ({ id: p.id, seed: i })),
    rounds: s.rounds,
  } as unknown as Tournament;
}

export function standings(s: DraftState): Standing[] {
  return computeStandings(asTournament(s));
}

/**
 * Pair the next round (round 1: across the table). The human is always side "a".
 * Single elimination pairs the previous round's winners in table order; an odd one out gets a bye.
 */
export function pairNextRound(s: DraftState) {
  const n = s.rounds.length + 1;
  const seats = seatsOf(s);
  let ms: Match[];
  if (n === 1) {
    ms = [];
    for (let i = 0; i < seats / 2; i++)
      ms.push({ id: `s1-${i + 1}`, stage: 'swiss', round: 1, table: i + 1, a: `p${i}`, b: `p${i + seats / 2}`, games: [], result: null, label: 'Round 1' });
  } else if (optsOf(s).tourney === 'single') {
    const alive = s.rounds[n - 2].map((m) => (m.result === 'b' ? m.b! : m.a));
    ms = [];
    for (let i = 0; i + 1 < alive.length; i += 2)
      ms.push({ id: `k${n}-${i / 2 + 1}`, stage: 'swiss', round: n, table: i / 2 + 1, a: alive[i], b: alive[i + 1], games: [], result: null, label: `Round ${n}` });
    if (alive.length % 2) ms.push({ id: `k${n}-bye`, stage: 'swiss', round: n, table: ms.length + 1, a: alive[alive.length - 1], b: null, games: [], result: 'a', label: `Round ${n}` });
  } else {
    const rng = new Rng(s.seed + n * 104729);
    ms = pairSwissRound(asTournament(s), n, () => rng.next());
  }
  for (const m of ms)
    if (m.b === 'p0') {
      m.b = m.a;
      m.a = 'p0';
    }
  ms.sort((x, y) => (x.a === 'p0' ? -1 : y.a === 'p0' ? 1 : x.table - y.table));
  ms.forEach((m, i) => (m.table = i + 1));
  s.rounds.push(ms);
}

export function currentRound(s: DraftState): Match[] | undefined {
  return s.rounds[s.rounds.length - 1];
}

export function humanMatch(s: DraftState): Match | undefined {
  return currentRound(s)?.find((m) => m.a === 'p0' || m.b === 'p0');
}

export function playerById(s: DraftState, id: string) {
  return s.players[Number(id.slice(1))];
}

export function deckOf(s: DraftState, id: string): BuiltDeck {
  const seat = Number(id.slice(1));
  const d = seat === 0 ? s.deck : s.aiDecks?.[seat];
  return d ? fromIds(d) : { main: [], extra: [] };
}

function fastGame(ra: number, rb: number, rng: Rng): GameResult {
  if (rng.next() < 0.015) return { winner: null, turns: 30, reason: 'Turn limit reached', how: 'fast' };
  const a = ra + (rng.next() - 0.5) * 140;
  const b = rb + (rng.next() - 0.5) * 140;
  const pa = 1 / (1 + Math.pow(10, (b - a) / 400));
  return { winner: rng.next() < pa ? 0 : 1, turns: 5 + rng.int(12), reason: 'LP reduced to 0', how: 'fast' };
}

const entries = (ids: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const id of ids) {
    const n = card(id).name;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m];
};

/**
 * Resolve all AI-vs-AI matches of the current round. With `full` the games are played by the
 * real engine (headless, a few ms each); a game that fails falls back to the rating model.
 */
export async function simulateAIMatches(s: DraftState, full = true) {
  const ms = currentRound(s);
  if (!ms) return;
  const need = s.bestOf === 1 ? 1 : 2;
  for (const m of ms) {
    if (m.result || m.a === 'p0' || m.b === 'p0') continue;
    if (m.b == null) {
      m.result = 'a';
      continue;
    }
    const rng = new Rng(s.seed + m.round * 977 + m.table * 31);
    const da = deckOf(s, m.a);
    const db = deckOf(s, m.b);
    const ra = deckRating(da) + playerById(s, m.a).skill;
    const rb = deckRating(db) + playerById(s, m.b).skill;
    m.games = [];
    for (let g = 0; g < s.bestOf; g++) {
      let res: GameResult | null = null;
      if (full) {
        const last = m.games[m.games.length - 1];
        res = await headlessGame(
          { name: playerById(s, m.a).name, deck: { main: entries(da.main.map((c) => c.id)), extra: entries(da.extra.map((c) => c.id)) }, difficulty: optsOf(s).ai },
          { name: playerById(s, m.b).name, deck: { main: entries(db.main.map((c) => c.id)), extra: entries(db.extra.map((c) => c.id)) }, difficulty: optsOf(s).ai },
          { seed: rng.int(2 ** 30), maxTurns: 50, timeoutMs: 6000, firstPlayer: last?.winner != null ? ((1 - last.winner) as 0 | 1) : undefined },
        );
      }
      m.games.push(res ?? fastGame(ra, rb, rng));
      const wa = m.games.filter((x) => x.winner === 0).length;
      const wb = m.games.filter((x) => x.winner === 1).length;
      if (wa >= need || wb >= need) break;
    }
    const wa = m.games.filter((x) => x.winner === 0).length;
    const wb = m.games.filter((x) => x.winner === 1).length;
    m.result = wa > wb ? 'a' : wb > wa ? 'b' : 'draw';
    if (m.result === 'draw' && optsOf(s).tourney === 'single') m.result = rng.next() < 1 / (1 + Math.pow(10, (rb - ra) / 400)) ? 'a' : 'b';
  }
}

/** Is the human still in a single-elimination event (always true for Swiss)? */
export function humanAlive(s: DraftState) {
  if (optsOf(s).tourney !== 'single') return true;
  return s.rounds.every((r) => {
    const m = r.find((x) => x.a === 'p0' || x.b === 'p0');
    return !!m && (!m.result || (m.a === 'p0' ? m.result === 'a' : m.result === 'b'));
  });
}

/**
 * Play out the rest of the current round (and, once the human is knocked out of a
 * single-elimination event, every remaining round). Marks the event done after the last round.
 */
export async function finishRound(s: DraftState, full = true) {
  await simulateAIMatches(s, full);
  while (!humanAlive(s) && s.rounds.length < totalRounds(s)) {
    pairNextRound(s);
    await simulateAIMatches(s, full);
  }
  if (s.rounds.length >= totalRounds(s)) s.phase = 'done';
}

/** Store the human's match result and play out the rest of the round. */
export async function recordHumanMatch(s: DraftState, games: GameResult[], result: 'a' | 'b' | 'draw', full = true) {
  const m = humanMatch(s);
  if (!m) return;
  m.games = games;
  // A knockout match needs a winner: a drawn match is settled by a coin flip.
  if (result === 'draw' && optsOf(s).tourney === 'single') result = new Rng(s.seed + s.rounds.length * 613).next() < 0.5 ? 'a' : 'b';
  m.result = result;
  await finishRound(s, full);
}

/** Move on to the next round (after looking at the standings). */
export function advanceRound(s: DraftState) {
  if (s.phase !== 'tournament') return;
  const r = currentRound(s);
  if (!r || r.some((m) => !m.result)) return;
  if (s.rounds.length >= totalRounds(s)) s.phase = 'done';
  else pairNextRound(s);
}

/** Human's record, e.g. "2-1". */
export function humanRecord(s: DraftState) {
  let w = 0;
  let l = 0;
  let d = 0;
  for (const r of s.rounds)
    for (const m of r) {
      if (m.a !== 'p0' || !m.result) continue;
      if (m.result === 'a') w++;
      else if (m.result === 'b') l++;
      else d++;
    }
  return { w, l, d, text: d ? `${w}-${l}-${d}` : `${w}-${l}` };
}

/** Is the round's human match still to be played? */
export function roundPending(s: DraftState) {
  const m = humanMatch(s);
  return !!m && !m.result;
}
