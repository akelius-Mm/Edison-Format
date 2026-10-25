// The optional Circuit: a 12-week season of 2010 Organized Play. Locals every Friday, Regional
// Qualifiers on some Saturdays, an SJC mid-season and an invite-only Nationals finale in week 12.
// Placings earn circuit points; your circuit rank counts only your best results
// from the last 8 weeks, so you have to keep proving yourself. ~200 AI duelists play the same
// season: regulars at your Locals, travellers at Regionals and SJCs.
import { hash, rand, shuffleIn, type RngState } from '../locals/rng';
import { metaLabel } from '../locals/meta';
import { deckById } from '../decks';
import { computeStandings } from '../locals/swiss';
import {
  CIRCUIT_INVITE_RANK,
  EVENT_SPECS,
  SJC_INVITE_CUT,
  bandFor,
  eventDate,
  regionalInviteCut,
  topCutFor,
  venueFor,
  venueList,
  type EventKind,
} from './catalog';
import { SKILL_MEAN, buildCircuit, type CircuitDuelist } from './field';
import { aiRating, loadRatings } from './ratings';
import { clearActiveEvent, createEvent, deckLabel, entrantOf, eventSeed, finalizeEvent, inTopCut, loadActiveEvent, night, placeOf, saveEvent, type EventRun, type HumanEntry } from './run';
import { KEYS, load, remove, save } from './storage';

export const SEASON_WEEKS = 12;
/** Rolling window, in weeks, for the circuit rank. */
export const RANK_WINDOW = 8;
/** How many results inside the window count. */
export const BEST_OF = 4;
/** Nationals registration closes after this week; the circuit Top 16 get at-large invites. */
export const INVITE_DEADLINE_WEEK = 11;
/** The season finale. */
export const NATIONALS_WEEK = 12;

export const YOU = 'you';

export type SeasonEventStatus = 'upcoming' | 'active' | 'played' | 'skipped';

export interface SeasonEvent {
  id: string;
  week: number;
  kind: EventKind;
  title: string;
  city: string;
  venueId: string;
  size: number;
  date: string;
  dateLabel: string;
  status: SeasonEventStatus;
  /** Your result (played events). */
  result?: { place: number; placing: string; points: number; record: string; madeCut: boolean; deck: string };
  champion?: { id: string; name: string; deck: string };
}

/** One placing that earned circuit points. */
export interface PointsRow {
  /** Week. */
  w: number;
  /** Event id. */
  e: string;
  k: EventKind;
  /** Place. */
  p: number;
  pts: number;
}

export interface Invite {
  nationals?: string;
}

export interface SeasonSummary {
  finalRank: number;
  score: number;
  totalPoints: number;
  field: number;
  trophies: { title: string; week: number }[];
  invites: Invite;
  best: { title: string; placing: string; place: number; size: number } | null;
  played: number;
  champion: { name: string; id: string };
}

export interface Season {
  version: 1;
  id: string;
  number: number;
  seed: number;
  startedAt: number;
  /** Current week, 1-based; SEASON_WEEKS + 1 once the season is over. */
  week: number;
  done: boolean;
  events: SeasonEvent[];
  points: Record<string, PointsRow[]>;
  invites: Record<string, Invite>;
  /** Your rank and score at the end of each week. */
  rankHistory: { week: number; rank: number; score: number }[];
  summary?: SeasonSummary;
}

export interface SeasonArchiveEntry extends SeasonSummary {
  id: string;
  number: number;
  finishedAt: number;
}

// ------------------------------------------------------------------ storage

export function loadSeason(): Season | null {
  const s = load<Season | null>(KEYS.season, null);
  if (!s || s.version !== 1 || !Array.isArray(s.events)) return null;
  // Worlds was retired: drop it from seasons saved before, and end the season with Nationals
  s.events = s.events.filter((e) => e.kind in EVENT_SPECS);
  for (const inv of Object.values(s.invites ?? {})) delete (inv as { worlds?: string }).worlds;
  for (const e of s.events)
    if (e.kind === 'nationals' && e.week !== NATIONALS_WEEK && e.status === 'upcoming' && s.week <= e.week) {
      const d = eventDate('nationals', NATIONALS_WEEK);
      Object.assign(e, { week: NATIONALS_WEEK, date: d.iso, dateLabel: d.label });
    }
  return s;
}
export const saveSeason = (s: Season) => save(KEYS.season, s);
export function loadSeasonArchive(): SeasonArchiveEntry[] {
  const a = load<SeasonArchiveEntry[]>(KEYS.seasonArchive, []);
  return Array.isArray(a) ? a : [];
}

// ------------------------------------------------------------------ calendar

/** Which weeks hold which events (Locals run every week). */
export const CALENDAR: Record<number, EventKind[]> = {
  1: ['locals'],
  2: ['locals', 'regional'],
  3: ['locals'],
  4: ['locals', 'regional'],
  5: ['locals', 'sjc'],
  6: ['locals'],
  7: ['locals', 'regional'],
  8: ['locals'],
  9: ['locals', 'regional'],
  10: ['locals'],
  11: ['locals', 'regional'],
  12: ['locals', 'nationals'],
};

function sizeFor(kind: EventKind, key: string): number {
  const r = hash(`size-${key}`) % 100;
  switch (kind) {
    case 'locals':
      return r < 35 ? 16 : r < 75 ? 24 : 32;
    case 'regional':
      return r < 30 ? 64 : r < 70 ? 96 : 128;
    case 'sjc':
      return 512;
    default:
      return EVENT_SPECS[kind].defaultSize;
  }
}

export function buildCalendar(seed: number): SeasonEvent[] {
  const out: SeasonEvent[] = [];
  const regionals = shuffleIn({ rng: hash(`regionals-${seed}`) }, [...venueList('regional')]);
  let ri = 0;
  for (let w = 1; w <= SEASON_WEEKS; w++)
    for (const kind of CALENDAR[w]) {
      const id = `w${w}-${kind}`;
      const venue =
        kind === 'regional' ? regionals[ri++ % regionals.length] : kind === 'sjc' ? venueList('sjc')[0] : kind === 'locals' ? venueFor('locals', `${seed}-${w}`) : venueFor(kind, id);
      const d = eventDate(kind, w);
      out.push({ id, week: w, kind, title: venue.name, city: venue.city, venueId: venue.id, size: sizeFor(kind, `${seed}-${id}`), date: d.iso, dateLabel: d.label, status: 'upcoming' });
    }
  return out;
}

// ------------------------------------------------------------------ starting a season

export function startSeason(seed = Math.floor(Math.random() * 2 ** 31)): Season {
  const prev = loadSeason();
  const active = loadActiveEvent();
  if (active?.season && active.season.seasonId === prev?.id) clearActiveEvent();
  const number = Math.max(0, ...loadSeasonArchive().map((a) => a.number), prev?.number ?? 0) + 1;
  const s: Season = {
    version: 1,
    id: `season-${number}-${(seed >>> 0).toString(36)}`,
    number,
    seed: seed >>> 0,
    startedAt: Date.now(),
    week: 1,
    done: false,
    events: buildCalendar(seed >>> 0),
    points: {},
    invites: {},
    rankHistory: [],
  };
  saveSeason(s);
  return s;
}

export function abandonSeason() {
  const s = loadSeason();
  const active = loadActiveEvent();
  if (s && active?.season?.seasonId === s.id) clearActiveEvent();
  remove(KEYS.season);
}

// ------------------------------------------------------------------ the circuit and its scores

export const circuitOf = (s: Season) => buildCircuit(s.seed);
export const duelistById = (s: Season, id: string) => circuitOf(s).find((d) => d.id === id);

/** Rolling circuit score: the best BEST_OF results from weeks (week-RANK_WINDOW, week]. */
export function rollingScore(rows: PointsRow[] | undefined, week: number) {
  if (!rows?.length) return 0;
  const inWin = rows.filter((r) => r.w > week - RANK_WINDOW && r.w <= week).map((r) => r.pts);
  return inWin
    .sort((a, b) => b - a)
    .slice(0, BEST_OF)
    .reduce((a, b) => a + b, 0);
}

/** Which of a player's rows count toward the rolling score right now. */
export function countingRows(rows: PointsRow[] | undefined, week: number): PointsRow[] {
  if (!rows?.length) return [];
  return rows
    .filter((r) => r.w > week - RANK_WINDOW && r.w <= week)
    .sort((a, b) => b.pts - a.pts || b.w - a.w)
    .slice(0, BEST_OF);
}

export const totalPoints = (rows: PointsRow[] | undefined) => (rows ?? []).reduce((a, r) => a + r.pts, 0);

/** The week whose results the standings reflect (the last completed week). */
export const standingsWeek = (s: Season) => Math.min(SEASON_WEEKS, s.week);

export interface CircuitRow {
  id: string;
  name: string;
  rank: number;
  score: number;
  total: number;
  events: number;
  you: boolean;
  duelist?: CircuitDuelist;
  invite: Invite;
}

export function circuitStandings(s: Season, week = standingsWeek(s)): CircuitRow[] {
  const rows: CircuitRow[] = circuitOf(s).map((d) => ({
    id: d.id,
    name: d.name,
    rank: 0,
    score: rollingScore(s.points[d.id], week),
    total: totalPoints(s.points[d.id]),
    events: s.points[d.id]?.length ?? 0,
    you: false,
    duelist: d,
    invite: s.invites[d.id] ?? {},
  }));
  rows.push({ id: YOU, name: 'You', rank: 0, score: rollingScore(s.points[YOU], week), total: totalPoints(s.points[YOU]), events: s.points[YOU]?.length ?? 0, you: true, invite: s.invites[YOU] ?? {} });
  rows.sort((a, b) => b.score - a.score || b.total - a.total || Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
  // equal scores and totals share a rank
  rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1].score === r.score && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1));
  return rows;
}

export function yourRow(s: Season, week?: number) {
  return circuitStandings(s, week).find((r) => r.you)!;
}

// ------------------------------------------------------------------ who shows up

export const eventsThisWeek = (s: Season) => s.events.filter((e) => e.week === s.week);
export const eventById = (s: Season, id: string) => s.events.find((e) => e.id === id);

export function hasInvite(s: Season, kind: EventKind, id = YOU) {
  if (kind === 'nationals') return !!s.invites[id]?.nationals;
  return true;
}

/** Circuit duelists entered in an event (deterministic per season and event). */
export function attendeesFor(s: Season, ev: SeasonEvent, humanPlays: boolean): CircuitDuelist[] {
  const all = circuitOf(s);
  const st: RngState = { rng: hash(`attend-${s.seed}-${ev.id}`) };
  const seats = ev.size - (humanPlays ? 1 : 0);
  if (ev.kind === 'nationals') {
    const order = circuitStandings(s, ev.week - 1);
    const invited = order.filter((r) => !r.you && s.invites[r.id]?.nationals).map((r) => r.duelist!);
    const rest = order.filter((r) => !r.you && !s.invites[r.id]?.nationals).map((r) => r.duelist!);
    return [...invited, ...rest].slice(0, seats);
  }
  const key = ev.kind === 'locals' ? 'locals' : ev.kind === 'regional' ? 'regional' : 'sjc';
  const cap = Math.floor(ev.size * (ev.kind === 'locals' ? 0.85 : ev.kind === 'regional' ? 0.6 : 0.4));
  const going = all.filter((d) => rand(st) < d.attend[key]);
  // regulars first at Locals so the familiar faces always make it in
  const ordered = ev.kind === 'locals' ? [...going.filter((d) => d.regular), ...shuffleIn(st, going.filter((d) => !d.regular))] : shuffleIn(st, going);
  return ordered.slice(0, Math.min(cap, seats));
}

// ------------------------------------------------------------------ results → points and invites

interface Finish {
  id: string;
  place: number;
  losses?: number;
  madeCut?: boolean;
  dropped?: boolean;
}

function award(s: Season, ev: SeasonEvent, finishes: Finish[]) {
  const cut = topCutFor(ev.kind, ev.size);
  for (const f of finishes) {
    const b = bandFor(ev.kind, f.place, ev.size, cut, { madeCut: f.madeCut, losses: f.losses, dropped: f.dropped });
    (s.points[f.id] ??= []).push({ w: ev.week, e: ev.id, k: ev.kind, p: f.place, pts: b.points });
    const inv = (s.invites[f.id] ??= {});
    const made = f.madeCut ?? f.place <= cut;
    if (ev.kind === 'regional' && made && f.place <= regionalInviteCut(ev.size)) inv.nationals ??= `Top ${regionalInviteCut(ev.size)} · ${ev.title}`;
    if (ev.kind === 'sjc' && made && f.place <= SJC_INVITE_CUT) inv.nationals ??= `Top ${SJC_INVITE_CUT} · ${ev.title}`;
  }
}

/** Rating-model placings for an event the player skipped (no Swiss needed: one noisy sort). */
function simulateEvent(s: Season, ev: SeasonEvent) {
  const st: RngState = { rng: hash(`sim-${s.seed}-${ev.id}`) };
  const attendees = attendeesFor(s, ev, false);
  const tier = EVENT_SPECS[ev.kind].tier;
  const noise = () => (rand(st) + rand(st) + rand(st) - 1.5) * 190;
  const perf: { id: string | null; v: number }[] = attendees.map((d) => ({ id: d.id, v: d.rating + noise() }));
  // anonymous seats: the tier's typical rating
  const anonMean = aiRating(tier >= 2 ? 'hard' : 'normal', SKILL_MEAN[tier]);
  while (perf.length < ev.size) perf.push({ id: null, v: anonMean + (rand(st) - 0.5) * 220 + noise() });
  perf.sort((a, b) => b.v - a.v);
  const finishes: Finish[] = [];
  perf.forEach((p, i) => p.id && finishes.push({ id: p.id, place: i + 1 }));
  award(s, ev, finishes);
  const champ = perf[0].id ? duelistById(s, perf[0].id) : null;
  ev.champion = champ ? { id: champ.id, name: champ.name, deck: metaLabel(champ.meta, deckById(champ.deckId)) } : { id: '', name: 'An unknown traveller', deck: '' };
  ev.status = 'skipped';
}

// ------------------------------------------------------------------ playing a season event

export function canEnter(s: Season, ev: SeasonEvent) {
  if (s.done || ev.week !== s.week || ev.status !== 'upcoming') return false;
  return hasInvite(s, ev.kind);
}

/** Check in to one of this week's events. */
export function startSeasonEvent(s: Season, eventId: string, human: HumanEntry, sleeves: string[], avatars: string[]): EventRun | null {
  const ev = eventById(s, eventId);
  if (!ev || !canEnter(s, ev)) return null;
  const active = loadActiveEvent();
  if (active && active.phase !== 'done') return null;
  const run = createEvent({
    kind: ev.kind,
    size: ev.size,
    human,
    sleeves,
    avatars,
    seed: eventSeed(s.seed, ev.id),
    number: ev.week,
    venue: venueFor(ev.kind, ev.kind === 'locals' ? `${s.seed}-${ev.week}` : ev.id),
    date: { iso: ev.date, label: ev.dateLabel },
    season: { seasonId: s.id, eventId: ev.id, week: ev.week },
    attendees: attendeesFor(s, ev, true),
  });
  // keep the calendar's venue (regional rotation)
  run.title = ev.title;
  run.venue = { ...run.venue, name: ev.title, city: ev.city };
  run.shop = run.venue;
  ev.status = 'active';
  saveSeason(s);
  saveEvent(run);
  return run;
}

/** Fold a finished season event into the season (idempotent). */
export function recordSeasonEvent(s: Season, run: EventRun) {
  if (!run.season || run.season.seasonId !== s.id || run.phase !== 'done') return false;
  const ev = eventById(s, run.season.eventId);
  if (!ev || ev.status === 'played' || ev.status === 'skipped') return false;
  const placements = run.placements!;
  const st = new Map(computeStandings(night(run)).map((x) => [x.id, x]));
  const finishes: Finish[] = [];
  placements.forEach((id, i) => {
    const e = entrantOf(run, id)!;
    const cid = e.human ? YOU : e.circuitId;
    if (!cid) return;
    finishes.push({ id: cid, place: i + 1, losses: st.get(id)!.l, madeCut: inTopCut(run, id), dropped: e.dropped != null });
  });
  award(s, ev, finishes);
  const me = entrantOf(run, run.humanId)!;
  const myRows = s.points[YOU] ?? [];
  const mine = myRows.find((r) => r.e === ev.id);
  ev.result = {
    place: placeOf(run),
    placing: run.placing ?? '',
    points: mine?.pts ?? 0,
    record: `${st.get(run.humanId)!.w}-${st.get(run.humanId)!.l}${st.get(run.humanId)!.d ? `-${st.get(run.humanId)!.d}` : ''}`,
    madeCut: inTopCut(run),
    deck: me.deck.name,
  };
  const champ = entrantOf(run, placements[0])!;
  ev.champion = { id: champ.human ? YOU : (champ.circuitId ?? ''), name: champ.human ? 'You' : champ.name, deck: deckLabel(champ) };
  ev.status = 'played';
  return true;
}

/** Close a finished event: prizes and history (any event), plus the season if it belongs to one. */
export function closeOutEvent(run: EventRun, s: Season | null = loadSeason()) {
  finalizeEvent(run);
  if (s && run.season?.seasonId === s.id && recordSeasonEvent(s, run)) saveSeason(s);
}

// ------------------------------------------------------------------ time

export type AdvanceBlock = 'active-event' | 'season-over' | null;

export function advanceBlocked(s: Season): AdvanceBlock {
  if (s.done) return 'season-over';
  const run = loadActiveEvent();
  if (run && run.season?.seasonId === s.id && run.phase !== 'done') return 'active-event';
  return null;
}

/**
 * Finish the week: events you skipped are simulated, at-large invites go out after the deadline
 * week, your rank is logged, and the calendar moves on (or the season ends).
 */
export function advanceWeek(s: Season): AdvanceBlock {
  const block = advanceBlocked(s);
  if (block) return block;
  const run = loadActiveEvent();
  if (run?.season?.seasonId === s.id && run.phase === 'done') {
    closeOutEvent(run, s);
    clearActiveEvent();
  }
  for (const ev of eventsThisWeek(s)) {
    if (ev.status === 'upcoming' || ev.status === 'active') simulateEvent(s, ev);
  }
  if (s.week === INVITE_DEADLINE_WEEK) {
    for (const r of circuitStandings(s, s.week).slice(0, CIRCUIT_INVITE_RANK)) (s.invites[r.id] ??= {}).nationals ??= `Circuit Top ${CIRCUIT_INVITE_RANK} after week ${INVITE_DEADLINE_WEEK}`;
    // ties at the edge go in too
    const edge = circuitStandings(s, s.week)[CIRCUIT_INVITE_RANK - 1];
    for (const r of circuitStandings(s, s.week)) if (edge && r.rank <= edge.rank) (s.invites[r.id] ??= {}).nationals ??= `Circuit Top ${CIRCUIT_INVITE_RANK} after week ${INVITE_DEADLINE_WEEK}`;
  }
  const me = yourRow(s, s.week);
  s.rankHistory = [...s.rankHistory.filter((x) => x.week !== s.week), { week: s.week, rank: me.rank, score: me.score }];
  s.week++;
  if (s.week > SEASON_WEEKS) finishSeason(s);
  saveSeason(s);
  return null;
}

function finishSeason(s: Season) {
  s.done = true;
  const rows = circuitStandings(s, SEASON_WEEKS);
  const me = rows.find((r) => r.you)!;
  const played = s.events.filter((e) => e.status === 'played' && e.result);
  const best = [...played].sort((a, b) => b.result!.points - a.result!.points || a.result!.place - b.result!.place)[0];
  s.summary = {
    finalRank: me.rank,
    score: me.score,
    totalPoints: me.total,
    field: rows.length,
    trophies: played.filter((e) => e.result!.place === 1).map((e) => ({ title: e.title, week: e.week })),
    invites: s.invites[YOU] ?? {},
    best: best ? { title: best.title, placing: best.result!.placing, place: best.result!.place, size: best.size } : null,
    played: played.length,
    champion: { name: rows[0].name, id: rows[0].id },
  };
  const archive = loadSeasonArchive().filter((a) => a.id !== s.id);
  save(KEYS.seasonArchive, [{ ...s.summary, id: s.id, number: s.number, finishedAt: Date.now() }, ...archive].slice(0, 30));
}

/** Weeks until an event kind next appears (0 = this week), or null. */
export function nextOf(s: Season, kind: EventKind) {
  const e = s.events.find((x) => x.kind === kind && x.week >= s.week);
  return e ? e.week - s.week : null;
}

/** The hidden rating of the player, for the standings sidebar. */
export const yourRating = () => loadRatings().constructed.rating;
