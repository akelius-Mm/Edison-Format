// One live event of any tier, built on the Locals Night engine: the same Swiss pairings,
// Konami tiebreakers, intentional draws, drops, simulated tables and top cut — scaled from a
// 16-player Friday to a 512-player SJC. Only the player's matches are played; every other table
// is resolved by the rating model, so even the biggest open stays fast.
import { grantPrize, type PrizeGrant } from '../collection/api';
import {
  acceptIntentionalDraw,
  advance as advanceNight,
  computeStandings,
  currentRound as nightRound,
  declineIntentionalDraw,
  dropHuman as dropNight,
  entrantOf as nightEntrant,
  finishRound as finishNightRound,
  humanEliminated as nightEliminated,
  humanIdOffer as nightIdOffer,
  humanMatch as nightHumanMatch,
  inTopCut as nightInTopCut,
  markRevealed as nightMarkRevealed,
  pendingHumanMatch as nightPending,
  recordHumanResult,
  recordHumanScore,
  recordString,
  runToEnd as nightRunToEnd,
  simulateHumanMatch,
  winnerOf,
  deckLabel,
  type AdvanceResult,
  type GameResult,
  type IdOffer,
  type LocalsMatch,
  type LocalsNight,
  type LocalsStanding,
  type PrizeLine,
} from '../locals';
import { finalPlacements, pairSwissRound } from '../locals/swiss';
import { hash, shuffleIn, type RngState } from '../locals/rng';
import type { DeckSnapshot } from '../locals/types';
import { classifyDeck } from '../locals/meta';
import { EVENT_SPECS, bandFor, standaloneDate, swissRoundsFor, topCutFor, venueFor, type EventKind, type Venue } from './catalog';
import { anonymousEntrant, duelistEntrant, type CircuitDuelist, type EventEntrant } from './field';
import { loadRatings, recordConstructedResult, type MatchScore, type RatingChange } from './ratings';
import { KEYS, load, remove, save } from './storage';

export interface SeasonLink {
  seasonId: string;
  eventId: string;
  week: number;
}

export interface EventRun extends Omit<LocalsNight, 'size' | 'topCut' | 'entrants' | 'version'> {
  version: 1;
  kind: EventKind;
  /** "SJC Edison, NJ", "Regional Qualifier · Dallas, TX", "Kettle Hill Cards & Games". */
  title: string;
  venue: Venue;
  size: number;
  topCut: number;
  entrants: EventEntrant[];
  season?: SeasonLink;
  /** Player match ids already applied to the Constructed rating. */
  rated: string[];
  /** Net rating change at this event. */
  ratingDelta: number;
  /** Set when the event closes. */
  placing?: string;
  points?: number;
}

export interface EventHistoryEntry {
  id: string;
  kind: EventKind;
  title: string;
  city: string;
  date: string;
  dateLabel: string;
  size: number;
  topCut: number;
  deckName: string;
  deckArchetype: string;
  place: number;
  placing: string;
  record: string;
  madeCut: boolean;
  champion: { name: string; deck: string };
  packs: number;
  coins: number;
  points?: number;
  seasonId?: string;
  week?: number;
  ratingDelta: number;
  finishedAt: number;
}

/** The Locals Night engine works on the shared fields; an EventRun is a superset of them. */
export const night = (r: EventRun) => r as unknown as LocalsNight;

// ------------------------------------------------------------------ storage

export function loadActiveEvent(): EventRun | null {
  const r = load<EventRun | null>(KEYS.activeEvent, null);
  if (!r || r.version !== 1 || !r.kind || !Array.isArray(r.entrants) || !Array.isArray(r.rounds)) return null;
  r.rated ??= [];
  r.ratingDelta ??= 0;
  return r;
}
export const saveEvent = (r: EventRun) => save(KEYS.activeEvent, r);
export const clearActiveEvent = () => remove(KEYS.activeEvent);

export function loadEventHistory(): EventHistoryEntry[] {
  const h = load<EventHistoryEntry[]>(KEYS.eventHistory, []);
  return Array.isArray(h) ? h : [];
}

// ------------------------------------------------------------------ check-in

export interface HumanEntry {
  name: string;
  avatar: string;
  sleeve: string;
  deck: DeckSnapshot;
}

export interface CreateEventOptions {
  kind: EventKind;
  size?: number;
  human: HumanEntry;
  sleeves: string[];
  avatars: string[];
  seed?: number;
  /** Running number for stand-alone events (date and venue rotate with it). */
  number?: number;
  venue?: Venue;
  date?: { iso: string; label: string };
  season?: SeasonLink;
  /** Circuit duelists entered in this event (the rest of the field is anonymous). */
  attendees?: CircuitDuelist[];
}

export function nextStandaloneNumber(kind: EventKind) {
  return loadEventHistory().filter((x) => x.kind === kind && !x.seasonId).length + 1;
}

export function createEvent(o: CreateEventOptions): EventRun {
  const spec = EVENT_SPECS[o.kind];
  const size = o.size ?? spec.defaultSize;
  const number = o.number ?? nextStandaloneNumber(o.kind);
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const s: RngState = { rng: seed };
  const venue = o.venue ?? venueFor(o.kind, String(number));
  const date = o.date ?? standaloneDate(o.kind, number);
  const week = o.season?.week ?? 1;
  const seeds = shuffleIn(s, Array.from({ length: size }, (_, i) => i + 1));
  const attendees = (o.attendees ?? []).slice(0, size - 1);
  const used = new Set<string>([o.human.name, ...attendees.map((a) => a.name)]);
  const sleeves = o.sleeves.length ? o.sleeves : ['classic-red'];
  const entrants: EventEntrant[] = [
    {
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
      rating: loadRatings().constructed.rating,
    },
  ];
  for (const d of attendees) entrants.push(duelistEntrant(d, `p${entrants.length}`, seeds[entrants.length], sleeves, week));
  const fo = { tier: spec.tier, size, sleeves, avatars: o.avatars, used };
  while (entrants.length < size) entrants.push(anonymousEntrant(s, fo, `p${entrants.length}`, seeds[entrants.length]));

  const r: EventRun = {
    version: 1,
    kind: o.kind,
    id: `${o.kind}-${o.season ? `${o.season.seasonId}-${o.season.eventId}` : number}-${Date.now().toString(36)}`,
    number,
    title: venue.name,
    venue,
    shop: venue,
    date: date.iso,
    dateLabel: date.label,
    size,
    entryFee: 0,
    bestOf: 3,
    entrants,
    humanId: 'p0',
    swissRounds: swissRoundsFor(o.kind, size),
    topCut: topCutFor(o.kind, size),
    rounds: [],
    top: [],
    phase: 'swiss',
    step: 'pairings',
    roundStartedAt: Date.now(),
    roundMinutes: spec.roundMinutes,
    revealed: [],
    rng: s.rng,
    season: o.season,
    rated: [],
    ratingDelta: 0,
  };
  r.rounds.push(pairSwissRound(night(r), 1, r));
  return r;
}

// ------------------------------------------------------------------ queries (typed wrappers)

export const currentRound = (r: EventRun) => nightRound(night(r));
export const humanMatch = (r: EventRun) => nightHumanMatch(night(r));
export const pendingHumanMatch = (r: EventRun) => nightPending(night(r));
export const entrantOf = (r: EventRun, id: string | null | undefined) => r.entrants.find((e) => e.id === id);
export const opponentOf = (r: EventRun, m: LocalsMatch) => entrantOf(r, m.a === r.humanId ? m.b : m.a) ?? null;
export const standingsOf = (r: EventRun): LocalsStanding[] => computeStandings(night(r));
export const humanStanding = (r: EventRun) => standingsOf(r).find((x) => x.id === r.humanId)!;
export const inTopCut = (r: EventRun, id = r.humanId) => nightInTopCut(night(r), id);
export const humanEliminated = (r: EventRun) => nightEliminated(night(r));
export const humanIdOffer = (r: EventRun): IdOffer | null => nightIdOffer(night(r));
export const markRevealed = (r: EventRun, matchId: string) => nightMarkRevealed(night(r), matchId);
export const finishRound = (r: EventRun) => finishNightRound(night(r));
export const advance = (r: EventRun): AdvanceResult => advanceNight(night(r));
export const declineId = (r: EventRun) => declineIntentionalDraw(night(r));
export { deckLabel, recordString, winnerOf };

export function roundLabel(r: EventRun) {
  if (r.phase === 'swiss') return `Round ${r.rounds.length} of ${r.swissRounds}`;
  if (r.phase === 'top') return currentRound(r)[0]?.label ?? `Top ${r.topCut}`;
  return 'Final standings';
}

export function placeOf(r: EventRun, id = r.humanId) {
  const p = r.placements ?? standingsOf(r).map((x) => x.id);
  return p.indexOf(id) + 1;
}

// ------------------------------------------------------------------ the player's match

function scoreOf(r: EventRun, m: LocalsMatch): MatchScore {
  if (m.result === 'draw') return 'D';
  return winnerOf(m) === r.humanId ? 'W' : 'L';
}

/** Apply a finished player match to the Constructed rating (once). Byes and IDs are unrated. */
export function rateHumanMatch(r: EventRun, m: LocalsMatch): RatingChange | null {
  if (!m.result || m.b == null || m.intentional || r.rated.includes(m.id)) return null;
  const opp = opponentOf(r, m);
  if (!opp) return null;
  r.rated.push(m.id);
  const ch = recordConstructedResult(opp.rating, scoreOf(r, m));
  r.ratingDelta += ch.delta;
  const me = entrantOf(r, r.humanId);
  if (me) me.rating = ch.after;
  return ch;
}

/** The player played the match out (games and result in the match's own a/b orientation). */
export function reportPlayed(r: EventRun, games: GameResult[], result: 'a' | 'b' | 'draw'): RatingChange | null {
  const m = pendingHumanMatch(r);
  if (!m) return null;
  recordHumanResult(night(r), games, result);
  return rateHumanMatch(r, m);
}

/** Concede the match 0-2 (rated as a loss). */
export function concede(r: EventRun): RatingChange | null {
  const m = pendingHumanMatch(r);
  if (!m) return null;
  recordHumanScore(night(r), 0, 2, 'Conceded');
  return rateHumanMatch(r, m);
}

/** Let the player's deck play the match as an AI (unrated). */
export function autoPlay(r: EventRun) {
  simulateHumanMatch(night(r));
}

export function acceptId(r: EventRun) {
  acceptIntentionalDraw(night(r));
}

export function dropHuman(r: EventRun) {
  dropNight(night(r));
}

/** Simulate everything left. With autoPlayHuman the player's matches are simulated (unrated). */
export function runToEnd(r: EventRun, opts: { autoPlayHuman?: boolean } = {}) {
  nightRunToEnd(night(r), opts);
}

/** Headless helper: report a player result from the player's side with a seeded coin. */
export function reportScore(r: EventRun, mine: number, theirs: number): RatingChange | null {
  const m = pendingHumanMatch(r);
  if (!m) return null;
  recordHumanScore(night(r), mine, theirs, 'Result reported');
  return rateHumanMatch(r, m);
}

// ------------------------------------------------------------------ closing the event

export function humanBand(r: EventRun, id = r.humanId) {
  const place = placeOf(r, id);
  const st = standingsOf(r).find((x) => x.id === id)!;
  const e = entrantOf(r, id)!;
  return bandFor(r.kind, place, r.size, r.topCut, { madeCut: inTopCut(r, id), losses: st.l, dropped: e.dropped != null });
}

export function prizesFor(r: EventRun): PrizeLine[] {
  const spec = EVENT_SPECS[r.kind];
  const b = humanBand(r);
  const lines: PrizeLine[] = [];
  const part = bandFor(r.kind, r.size, r.size, r.topCut, { madeCut: false, losses: 99 });
  if (b.label !== part.label) lines.push({ reason: `${spec.short} · ${b.label}`, packs: b.packs, coins: b.coins });
  lines.push({ reason: `${spec.short} · Participation`, packs: part.packs, coins: part.coins });
  return lines;
}

export function prizeTotals(lines: PrizeLine[]) {
  return { packs: lines.reduce((a, l) => a + l.packs, 0), coins: lines.reduce((a, l) => a + l.coins, 0) };
}

/**
 * Close the event once: placements, prizes (via grantPrize), placing label, circuit points and the
 * history entry. Safe to call repeatedly.
 */
export function finalizeEvent(r: EventRun, grant: (g: PrizeGrant) => void = grantPrize) {
  if (r.phase !== 'done') return;
  r.placements ??= finalPlacements(night(r));
  if (!r.prizes) {
    r.prizes = prizesFor(r);
    const b = humanBand(r);
    r.placing = b.label;
    r.points = b.points;
  }
  if (!r.prizesGranted) {
    r.prizesGranted = true;
    saveEvent(r);
    for (const p of r.prizes) if (p.packs || p.coins) grant({ packs: p.packs || undefined, coins: p.coins || undefined, reason: `${p.reason} · ${r.title}` });
  }
  if (!r.recorded) {
    r.recorded = true;
    const me = entrantOf(r, r.humanId)!;
    const champ = entrantOf(r, r.placements[0])!;
    const totals = prizeTotals(r.prizes);
    const entry: EventHistoryEntry = {
      id: r.id,
      kind: r.kind,
      title: r.title,
      city: r.venue.city,
      date: r.date,
      dateLabel: r.dateLabel,
      size: r.size,
      topCut: r.topCut,
      deckName: me.deck.name,
      deckArchetype: deckLabel(me),
      place: placeOf(r),
      placing: r.placing ?? '',
      record: recordString(humanStanding(r)),
      madeCut: inTopCut(r),
      champion: { name: champ.name, deck: deckLabel(champ) },
      packs: totals.packs,
      coins: totals.coins,
      points: r.season ? r.points : undefined,
      seasonId: r.season?.seasonId,
      week: r.season?.week,
      ratingDelta: r.ratingDelta,
      finishedAt: Date.now(),
    };
    save(KEYS.eventHistory, [entry, ...loadEventHistory().filter((x) => x.id !== r.id)].slice(0, 200));
  }
  saveEvent(r);
}

/** Field mix for the check-in / ceremony: archetype counts, most played first. */
export function metaBreakdown(r: EventRun) {
  const counts = new Map<string, number>();
  for (const e of r.entrants) if (!e.human) counts.set(deckLabel(e), (counts.get(deckLabel(e)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Seed of a top-cut player (1-based), 0 if not in the cut. */
export function seedOf(r: EventRun, id: string) {
  const first = r.top[0] ?? [];
  const pairs: string[] = first.flatMap((m) => [m.a, m.b ?? '']);
  const i = pairs.indexOf(id);
  if (i < 0) return 0;
  const seeds = computeStandings(night(r)).filter((x) => !x.dropped).slice(0, r.topCut).map((x) => x.id);
  return seeds.indexOf(id) + 1;
}

/** Stable per-event seed for season events. */
export const eventSeed = (seasonSeed: number, eventId: string) => hash(`${seasonSeed}-${eventId}`);
