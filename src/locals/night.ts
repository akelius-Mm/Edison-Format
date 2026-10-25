// Locals Night lifecycle: check-in, rounds, top cut, prizes, persistence and history.
import { grantPrize, type PrizeGrant } from '../collection/api';
import { difficultyFor, personaName, personaTitle } from '../tournament/personas';
import { classifyDeck, decksFor, drawFieldDeck, metaLabel, snapshot } from './meta';
import { REGULARS, regularById } from './regulars';
import { hash, pickOne, rand, shuffleIn, type RngState } from './rng';
import { expectedTurnout, nightDate, nightShop, swissRoundsFor, topCutFor } from './shops';
import { simMatch } from './sim';
import { computeStandings, finalPlacements, idCheck, idRecordOk, nextTopRound, pairSwissRound, seedTopCut, winnerOf, type IdCheck } from './swiss';
import type { DeckSnapshot, FieldSize, GameResult, HistoryEntry, LocalsEntrant, LocalsMatch, LocalsNight, LocalsStanding, PrizeLine, RivalRecord, Shop } from './types';

const ACTIVE_KEY = 'edison.locals.active.v1';
const HISTORY_KEY = 'edison.locals.history.v1';
const RIVALS_KEY = 'edison.locals.rivals.v1';

/** No DP spending API exists yet, so entry is free. */
export const ENTRY_FEE = 0;
export const ROUND_MINUTES = 45;

// ------------------------------------------------------------------ storage (headless-safe)

function load<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or unavailable: play continues */
  }
}

export function loadActiveNight(): LocalsNight | null {
  const n = load<LocalsNight | null>(ACTIVE_KEY, null);
  if (!n || n.version !== 1 || !Array.isArray(n.entrants) || !Array.isArray(n.rounds)) return null;
  return n;
}
export function saveNight(n: LocalsNight) {
  save(ACTIVE_KEY, n);
}
export function clearActiveNight() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
export function loadHistory(): HistoryEntry[] {
  const h = load<HistoryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
}
export function loadRivals(): Record<string, RivalRecord> {
  return load<Record<string, RivalRecord>>(RIVALS_KEY, {});
}

// ------------------------------------------------------------------ the next event

export interface Upcoming {
  number: number;
  shop: Shop;
  date: string;
  dateLabel: string;
  size: FieldSize;
}

export function upcomingNight(): Upcoming {
  const number = Math.max(0, ...loadHistory().map((x) => x.number)) + 1;
  const d = nightDate(number);
  return { number, shop: nightShop(number), date: d.iso, dateLabel: d.label, size: expectedTurnout(number) };
}

/** Regulars who come out on a given night (deterministic per night number). */
export function regularsAttending(number: number, size: FieldSize) {
  const s: RngState = { rng: hash(`regulars-${number}`) };
  const cap = size === 16 ? 5 : size === 24 ? 7 : 9;
  return shuffleIn(s, REGULARS.filter((r) => rand(s) < r.attendance)).slice(0, cap);
}

/** A regular's deck: the same list every week (rogue players bring a new one each night). */
export function regularDeck(regId: string, number: number) {
  const r = regularById(regId)!;
  const pool = decksFor(r.meta);
  const real = pool.filter((d) => d.event);
  const list = real.length ? real : pool;
  if (!list.length) return null;
  const k = r.meta === 'rogue' ? hash(`${regId}-${number}`) : hash(regId);
  return list[k % list.length];
}

// ------------------------------------------------------------------ check-in

export interface CheckInOptions {
  human: { name: string; avatar: string; sleeve: string; deck: DeckSnapshot };
  size?: FieldSize;
  number?: number;
  /** Sleeve / avatar ids to dress the field with. */
  sleeves: string[];
  avatars: string[];
  seed?: number;
}

export function createNight(o: CheckInOptions): LocalsNight {
  const up = upcomingNight();
  const number = o.number ?? up.number;
  const date = nightDate(number);
  const size: FieldSize = o.size ?? expectedTurnout(number);
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const s: RngState = { rng: seed };
  const used = new Set<string>([o.human.name, ...REGULARS.map((r) => r.name)]);
  const seeds = shuffleIn(s, Array.from({ length: size }, (_, i) => i + 1));
  const sleeves = o.sleeves.length ? o.sleeves : ['classic-red'];
  const entrants: LocalsEntrant[] = [];
  entrants.push({
    id: 'p0',
    name: o.human.name,
    avatar: o.human.avatar,
    sleeve: o.human.sleeve,
    title: 'You',
    deck: o.human.deck,
    meta: classifyDeck(o.human.deck),
    difficulty: 'hard',
    skill: 40,
    human: true,
    seed: seeds[0],
  });
  for (const r of regularsAttending(number, size)) {
    const deck = regularDeck(r.id, number);
    if (!deck) continue;
    entrants.push({
      id: `p${entrants.length}`,
      name: r.name,
      avatar: r.avatar,
      sleeve: sleeves[hash(r.id) % sleeves.length],
      title: r.title,
      deck: snapshot(deck),
      meta: classifyDeck(deck),
      difficulty: r.difficulty,
      skill: r.skill,
      human: false,
      seed: seeds[entrants.length],
      regular: r.id,
      blurb: r.blurb,
    });
  }
  const avatars = o.avatars.filter((a) => !REGULARS.some((r) => r.avatar === a));
  const rng = { next: () => rand(s) };
  while (entrants.length < size) {
    const { meta, deck } = drawFieldDeck(s);
    const t = personaTitle(rng);
    const skill = t.skill + Math.round((rand(s) - 0.5) * 40);
    entrants.push({
      id: `p${entrants.length}`,
      name: personaName(rng, used),
      avatar: avatars.length && rand(s) < 0.7 ? pickOne(s, avatars) : `persona-${Math.floor(rand(s) * 1e6)}`,
      sleeve: pickOne(s, sleeves),
      title: t.title,
      deck: snapshot(deck),
      meta,
      difficulty: difficultyFor('mixed', rng, skill),
      skill,
      human: false,
      seed: seeds[entrants.length],
    });
  }
  const n: LocalsNight = {
    version: 1,
    id: `locals-${number}-${Date.now().toString(36)}`,
    number,
    shop: nightShop(number),
    date: date.iso,
    dateLabel: date.label,
    size,
    entryFee: ENTRY_FEE,
    bestOf: 3,
    entrants,
    humanId: 'p0',
    swissRounds: swissRoundsFor(size),
    topCut: topCutFor(size),
    rounds: [],
    top: [],
    phase: 'swiss',
    step: 'pairings',
    roundStartedAt: Date.now(),
    roundMinutes: ROUND_MINUTES,
    revealed: [],
    rng: s.rng,
  };
  n.rounds.push(pairSwissRound(n, 1, n));
  return n;
}

// ------------------------------------------------------------------ queries

export const entrantOf = (n: LocalsNight, id: string | null | undefined) => n.entrants.find((e) => e.id === id);

export function currentRound(n: LocalsNight): LocalsMatch[] {
  if (n.phase === 'swiss') return n.rounds[n.rounds.length - 1] ?? [];
  return n.top[n.top.length - 1] ?? [];
}

export function roundLabel(n: LocalsNight) {
  if (n.phase === 'swiss') return `Round ${n.rounds.length} of ${n.swissRounds}`;
  if (n.phase === 'top') return currentRound(n)[0]?.label ?? `Top ${n.topCut}`;
  return 'Final standings';
}

export const involves = (m: LocalsMatch, id: string) => m.a === id || m.b === id;

export function humanMatch(n: LocalsNight): LocalsMatch | null {
  return currentRound(n).find((m) => involves(m, n.humanId)) ?? null;
}

export function pendingHumanMatch(n: LocalsNight): LocalsMatch | null {
  const m = humanMatch(n);
  return m && m.result == null ? m : null;
}

export function opponentOf(n: LocalsNight, m: LocalsMatch, id = n.humanId) {
  return entrantOf(n, m.a === id ? m.b : m.a) ?? null;
}

export const standings = (n: LocalsNight) => computeStandings(n);

export function humanStanding(n: LocalsNight): LocalsStanding {
  return computeStandings(n).find((x) => x.id === n.humanId)!;
}

export function recordString(st: Pick<LocalsStanding, 'w' | 'l' | 'd'>) {
  return `${st.w}-${st.l}${st.d ? `-${st.d}` : ''}`;
}

export function inTopCut(n: LocalsNight, id = n.humanId) {
  return !!n.top[0]?.some((m) => involves(m, id));
}

/** Out of the event: dropped, missed the cut, or lost in the bracket. */
export function humanEliminated(n: LocalsNight) {
  if (entrantOf(n, n.humanId)?.dropped != null) return true;
  if (n.phase === 'swiss') return false;
  if (!inTopCut(n)) return true;
  for (const r of n.top) for (const m of r) if (involves(m, n.humanId) && m.result && winnerOf(m) !== n.humanId) return true;
  return false;
}

/** Score from one player's perspective, e.g. "2-1" (draws appended). */
export function scoreFor(m: LocalsMatch, id: string) {
  const wa = m.games.filter((g) => g.winner === 0).length;
  const wb = m.games.filter((g) => g.winner === 1).length;
  const dr = m.games.filter((g) => g.winner == null).length;
  const [w, l] = m.a === id ? [wa, wb] : [wb, wa];
  return `${w}-${l}${dr ? `-${dr}` : ''}`;
}

export function deckLabel(e: Pick<LocalsEntrant, 'meta' | 'deck'>) {
  return metaLabel(e.meta, e.deck);
}

// ------------------------------------------------------------------ the player's match

function bumpRival(n: LocalsNight, m: LocalsMatch) {
  const opp = opponentOf(n, m);
  if (!opp?.regular || !m.result) return;
  const all = loadRivals();
  const r = all[opp.regular] ?? { w: 0, l: 0, d: 0 };
  const won = winnerOf(m);
  if (m.result === 'draw') r.d++;
  else if (won === n.humanId) r.w++;
  else r.l++;
  all[opp.regular] = r;
  save(RIVALS_KEY, all);
}

/**
 * Store the player's match. `games` and `result` use the match's own a/b orientation.
 */
export function recordHumanResult(n: LocalsNight, games: GameResult[], result: 'a' | 'b' | 'draw') {
  const m = pendingHumanMatch(n);
  if (!m) return;
  m.games = games;
  m.result = m.stage === 'top' && result === 'draw' ? (m.a === n.humanId ? 'b' : 'a') : result;
  bumpRival(n, m);
}

/** Record a result given from the player's side: won / lost / drawn, with game counts. */
export function recordHumanScore(n: LocalsNight, mine: number, theirs: number, reason = 'Result reported') {
  const m = pendingHumanMatch(n);
  if (!m) return;
  const meA = m.a === n.humanId;
  const g = (w: 0 | 1): GameResult => ({ winner: w, turns: 0, reason, how: 'human' });
  const games = [...Array(mine).fill(g(meA ? 0 : 1)), ...Array(theirs).fill(g(meA ? 1 : 0))];
  const res = mine === theirs ? 'draw' : (mine > theirs) === meA ? 'a' : 'b';
  recordHumanResult(n, games, res);
}

export interface IdOffer {
  match: LocalsMatch;
  opponent: LocalsEntrant;
  check: IdCheck;
}

/** In the last Swiss round, an X-1 (or better) opponent may offer to draw if both of you get in. */
export function humanIdOffer(n: LocalsNight): IdOffer | null {
  if (n.phase !== 'swiss' || n.rounds.length !== n.swissRounds) return null;
  const m = pendingHumanMatch(n);
  if (!m || m.b == null || n.idDeclined === m.id) return null;
  const prior = { entrants: n.entrants, rounds: n.rounds.slice(0, -1), topCut: n.topCut };
  const st = new Map(computeStandings(prior).map((x) => [x.id, x]));
  if (!idRecordOk(st.get(m.a)) || !idRecordOk(st.get(m.b))) return null;
  const check = idCheck(prior, currentRound(n), m);
  if (!check.likely) return null;
  return { match: m, opponent: opponentOf(n, m)!, check };
}

export function acceptIntentionalDraw(n: LocalsNight) {
  const m = pendingHumanMatch(n);
  if (!m || m.stage !== 'swiss') return;
  m.intentional = true;
  recordHumanResult(n, [], 'draw');
}

export function declineIntentionalDraw(n: LocalsNight) {
  const m = pendingHumanMatch(n);
  if (m) n.idDeclined = m.id;
}

export function markRevealed(n: LocalsNight, matchId: string) {
  if (!n.revealed.includes(matchId)) n.revealed.push(matchId);
}

/** Headless / auto-play: the player's deck plays its match as a strong AI. */
export function simulateHumanMatch(n: LocalsNight) {
  const m = pendingHumanMatch(n);
  if (!m || m.b == null) return;
  const s = n as RngState;
  const A = entrantOf(n, m.a)!;
  const B = entrantOf(n, m.b)!;
  simMatch(s, m, A, B);
  bumpRival(n, m);
}

// ------------------------------------------------------------------ round progression

/**
 * Resolve every other table of the current round. In the final Swiss round, AI pairs that are
 * both locked for the cut take the intentional draw. Moves the round to its results step.
 */
export function finishRound(n: LocalsNight) {
  if (pendingHumanMatch(n)) return false;
  const round = currentRound(n);
  const finalSwiss = n.phase === 'swiss' && n.rounds.length === n.swissRounds;
  if (finalSwiss) {
    const prior = { entrants: n.entrants, rounds: n.rounds.slice(0, -1), topCut: n.topCut };
    const st = new Map(computeStandings(prior).map((x) => [x.id, x]));
    for (const m of round) {
      if (m.result || m.b == null || involves(m, n.humanId)) continue;
      if (idRecordOk(st.get(m.a)) && idRecordOk(st.get(m.b)) && idCheck(prior, round, m).guaranteed) {
        m.intentional = true;
        m.games = [];
        m.result = 'draw';
      }
    }
  }
  for (const m of round) {
    if (m.result) continue;
    simMatch(n, m, entrantOf(n, m.a)!, entrantOf(n, m.b)!);
  }
  n.step = 'results';
  return true;
}

export function postStandings(n: LocalsNight) {
  if (n.step === 'results' && n.phase === 'swiss') n.step = 'standings';
}

/** AI players out of contention sometimes drop after a round (never after the last one). */
function applyDrops(n: LocalsNight) {
  const roundNo = n.rounds.length;
  if (roundNo >= n.swissRounds || roundNo < 2) return;
  const st = computeStandings(n);
  for (const x of st) {
    const e = entrantOf(n, x.id)!;
    if (e.human || e.dropped != null) continue;
    if (x.l >= 2 && x.w <= 1 && rand(n) < 0.15) e.dropped = roundNo;
  }
}

export type AdvanceResult = 'round' | 'topcut' | 'top-round' | 'done' | null;

/** Post the next pairings (or the top cut, or close the event). */
export function advance(n: LocalsNight): AdvanceResult {
  if (n.phase === 'done') return null;
  if (currentRound(n).some((m) => m.result == null)) return null;
  if (n.phase === 'swiss') {
    applyDrops(n);
    if (n.rounds.length < n.swissRounds) {
      n.rounds.push(pairSwissRound(n, n.rounds.length + 1, n));
      n.step = 'pairings';
      n.roundStartedAt = Date.now();
      return 'round';
    }
    n.phase = 'top';
    n.top.push(seedTopCut(n));
    n.step = 'pairings';
    n.roundStartedAt = Date.now();
    return 'topcut';
  }
  const last = n.top[n.top.length - 1];
  if (last.length === 1) {
    n.phase = 'done';
    n.step = 'standings';
    n.placements = finalPlacements(n);
    return 'done';
  }
  n.top.push(nextTopRound(n.top));
  n.step = 'pairings';
  n.roundStartedAt = Date.now();
  return 'top-round';
}

/** Drop from the event: an unplayed match is conceded, then the rest of the night plays out. */
export function dropHuman(n: LocalsNight) {
  const me = entrantOf(n, n.humanId)!;
  if (pendingHumanMatch(n)) recordHumanScore(n, 0, 2, 'Conceded');
  if (me.dropped == null) me.dropped = n.phase === 'swiss' ? n.rounds.length : n.swissRounds;
  runToEnd(n);
}

/** Simulate everything left (the player must not have a pending match). */
export function runToEnd(n: LocalsNight, opts: { autoPlayHuman?: boolean } = {}) {
  for (let guard = 0; guard < 40 && n.phase !== 'done'; guard++) {
    if (pendingHumanMatch(n)) {
      if (!opts.autoPlayHuman) return;
      simulateHumanMatch(n);
    }
    if (currentRound(n).some((m) => m.result == null)) finishRound(n);
    advance(n);
  }
}

// ------------------------------------------------------------------ prizes

export const PRIZE_TABLE = {
  first: { packs: 12, coins: 300 },
  second: { packs: 8, coins: 200 },
  top4: { packs: 6, coins: 150 },
  top8: { packs: 3, coins: 100 },
  xMinusOne: { packs: 2, coins: 75 },
  participation: { packs: 0, coins: 50 },
};

export function placeOf(n: LocalsNight, id = n.humanId) {
  const p = n.placements ?? computeStandings(n).map((x) => x.id);
  return p.indexOf(id) + 1;
}

/** Prize lines for a placing: one for the finish (if any) plus participation. */
export function prizesFor(n: LocalsNight, id = n.humanId): PrizeLine[] {
  const place = placeOf(n, id);
  const st = computeStandings(n).find((x) => x.id === id)!;
  const cut = inTopCut(n, id);
  const ord = (k: number) => (k === 1 ? '1st' : k === 2 ? '2nd' : k === 3 ? '3rd' : `${k}th`);
  const lines: PrizeLine[] = [];
  if (cut && place === 1) lines.push({ reason: `Locals Night · ${ord(1)} place`, ...PRIZE_TABLE.first });
  else if (cut && place === 2) lines.push({ reason: `Locals Night · ${ord(2)} place`, ...PRIZE_TABLE.second });
  else if (cut && place <= 4) lines.push({ reason: 'Locals Night · Top 4', ...PRIZE_TABLE.top4 });
  else if (cut && place <= 8) lines.push({ reason: 'Locals Night · Top 8', ...PRIZE_TABLE.top8 });
  else if (st.l <= 1 && entrantOf(n, id)?.dropped == null) lines.push({ reason: `Locals Night · Went ${recordString(st)}`, ...PRIZE_TABLE.xMinusOne });
  lines.push({ reason: 'Locals Night · Participation', ...PRIZE_TABLE.participation });
  return lines;
}

export function prizeTotals(lines: PrizeLine[]) {
  return { packs: lines.reduce((a, l) => a + l.packs, 0), coins: lines.reduce((a, l) => a + l.coins, 0) };
}

/**
 * Close the night once: award the player's prizes (via the collection contract) and write the
 * history entry. Safe to call repeatedly; it only acts the first time.
 */
export function finalizeNight(n: LocalsNight, grant: (g: PrizeGrant) => void = grantPrize) {
  if (n.phase !== 'done') return;
  n.placements ??= finalPlacements(n);
  if (!n.prizes) n.prizes = prizesFor(n);
  if (!n.prizesGranted) {
    n.prizesGranted = true;
    saveNight(n);
    for (const p of n.prizes) if (p.packs || p.coins) grant({ packs: p.packs || undefined, coins: p.coins || undefined, reason: p.reason });
  }
  if (!n.recorded) {
    n.recorded = true;
    const me = entrantOf(n, n.humanId)!;
    const champ = entrantOf(n, n.placements[0])!;
    const totals = prizeTotals(n.prizes);
    const entry: HistoryEntry = {
      id: n.id,
      number: n.number,
      shop: n.shop.name,
      date: n.date,
      dateLabel: n.dateLabel,
      size: n.size,
      deckName: me.deck.name,
      deckArchetype: deckLabel(me),
      place: placeOf(n),
      record: recordString(humanStanding(n)),
      topCut: n.topCut,
      madeCut: inTopCut(n),
      champion: { name: champ.name, deck: deckLabel(champ) },
      packs: totals.packs,
      coins: totals.coins,
      finishedAt: Date.now(),
    };
    save(HISTORY_KEY, [entry, ...loadHistory().filter((x) => x.id !== n.id)].slice(0, 100));
  }
  saveNight(n);
}

/** Leave the finished night (it stays in history). */
export function closeNight() {
  clearActiveNight();
}

// ------------------------------------------------------------------ helpers for the UI

export function metaBreakdown(n: LocalsNight) {
  const counts = new Map<string, number>();
  for (const e of n.entrants) if (!e.human) counts.set(deckLabel(e), (counts.get(deckLabel(e)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
