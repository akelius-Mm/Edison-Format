// Headless Events + Circuit check: every event tier end to end, then a full 12-week season with
// every event entered, verifying Swiss/top-cut shape, prizes, circuit points, the rolling 8-week
// window, invites, Constructed rating updates and determinism.
// Usage: tsx scripts/events-test.ts [--seasons 2]
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

import { PREMADE_DECKS } from '../src/decks';
import { snapshot } from '../src/locals/meta';
import { rand, type RngState } from '../src/locals/rng';
import { bracketPairs, computeStandings } from '../src/locals/swiss';
import {
  BEST_OF,
  EVENT_KINDS,
  EVENT_SPECS,
  RANK_WINDOW,
  SEASON_WEEKS,
  NATIONALS_WEEK,
  YOU,
  acceptId,
  advance,
  advanceWeek,
  attendeesFor,
  bandFor,
  buildCircuit,
  canEnter,
  circuitStandings,
  closeOutEvent,
  createEvent,
  eloStep,
  eventsThisWeek,
  finishRound,
  humanIdOffer,
  kFactor,
  loadActiveEvent,
  loadEventHistory,
  loadRatings,
  loadSeason,
  night,
  pendingHumanMatch,
  placeOf,
  regionalInviteCut,
  reportScore,
  rollingScore,
  standingsOf,
  startSeason,
  startSeasonEvent,
  swissRoundsFor,
  topCutFor,
  clearActiveEvent,
  type EventRun,
  type PointsRow,
  type Season,
} from '../src/events';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const SEASONS = arg('--seasons', 2);

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else if (failures.length < 40) failures.push(msg);
}

const HUMAN = { name: 'You', avatar: 'avatar-1', sleeve: 'classic-red', deck: snapshot(PREMADE_DECKS.find((d) => d.event) ?? PREMADE_DECKS[0]) };
const SLEEVES = ['classic-red', 'midnight', 'forest'];
const AVATARS = ['avatar-2', 'avatar-3', 'avatar-4'];

// ------------------------------------------------------------------ brackets
for (const size of [4, 8, 16, 32, 64]) {
  const pairs = bracketPairs(size);
  const seeds = pairs.flat().sort((a, b) => a - b);
  check(pairs.length === size / 2 && seeds.every((s, i) => s === i), `bracket ${size}: every seed once`);
  check(pairs.every(([a, b]) => a + b === size - 1), `bracket ${size}: 1 plays ${size}, 2 plays ${size - 1}`);
  const half = pairs.slice(0, size / 4).flat();
  check(half.includes(0) && !half.includes(1), `bracket ${size}: seeds 1 and 2 in opposite halves`);
}
check(JSON.stringify(bracketPairs(8)) === JSON.stringify([[0, 7], [3, 4], [1, 6], [2, 5]]), 'bracket 8 keeps the Locals order');

// ------------------------------------------------------------------ Elo
check(kFactor(0) === 40 && kFactor(10) === 32 && kFactor(30) === 24 && kFactor(80) === 16, 'K-factor steps 40/32/24/16');
check(eloStep(1500, 0, 1500, 'W').delta === 20 && eloStep(1500, 0, 1500, 'L').delta === -20 && eloStep(1500, 0, 1500, 'D').delta === 0, 'Elo even match ±20 at K 40');
check(eloStep(1500, 100, 1900, 'W').delta > eloStep(1500, 100, 1500, 'W').delta, 'upset wins pay more');

// ------------------------------------------------------------------ playing an event headlessly

/** Resolve the player's matches with a seeded coin (p = win chance) until the event ends. */
function playOut(r: EventRun, s: RngState, p = 0.62) {
  for (let guard = 0; guard < 60 && r.phase !== 'done'; guard++) {
    const m = pendingHumanMatch(r);
    if (m) {
      const offer = humanIdOffer(r);
      if (offer && offer.check.guaranteed) acceptId(r);
      else {
        const x = rand(s);
        if (x < p) reportScore(r, 2, x < p * 0.4 ? 0 : 1);
        else if (x < p + 0.04 && m.stage === 'swiss') reportScore(r, 1, 1);
        else reportScore(r, x > 0.95 ? 0 : 1, 2);
      }
    }
    finishRound(r);
    advance(r);
  }
}

function verifyEvent(r: EventRun, tag: string) {
  check(r.phase === 'done', `${tag}: event finished`);
  check(r.rounds.length === r.swissRounds, `${tag}: ${r.rounds.length} Swiss rounds, expected ${r.swissRounds}`);
  check(r.swissRounds === swissRoundsFor(r.kind, r.size) && r.topCut === topCutFor(r.kind, r.size), `${tag}: format`);
  check(r.top[0]?.length === r.topCut / 2, `${tag}: top cut of ${r.topCut}`);
  const met = new Map<string, Set<string>>(r.entrants.map((e) => [e.id, new Set()]));
  r.rounds.forEach((round, ri) => {
    const active = r.entrants.filter((e) => e.dropped == null || e.dropped >= ri + 1).length;
    const seen = new Set<string>();
    let dup = false;
    for (const m of round) {
      for (const id of [m.a, m.b]) if (id) (seen.has(id) ? (dup = true) : seen.add(id));
      if (m.b) {
        check(!met.get(m.a)!.has(m.b), `${tag} R${ri + 1}: rematch`);
        met.get(m.a)!.add(m.b);
        met.get(m.b)!.add(m.a);
      }
      check(m.result != null, `${tag} R${ri + 1}: unfinished match`);
    }
    check(!dup && seen.size === active, `${tag} R${ri + 1}: ${seen.size} paired vs ${active} active`);
  });
  check(r.placements?.length === r.size && new Set(r.placements).size === r.size, `${tag}: placements cover the field`);
  // the champion won the final
  const final = r.top[r.top.length - 1][0];
  check(final.result != null && (final.result === 'a' ? final.a : final.b) === r.placements![0], `${tag}: champion won the final`);
  // field gets tougher with tier
  return r.entrants.filter((e) => !e.human).reduce((a, e) => a + e.rating, 0) / (r.size - 1);
}

function freshStorage() {
  store.clear();
}

// ------------------------------------------------------------------ every tier, stand-alone
freshStorage();
const t0 = performance.now();
const avgRating: number[] = [];
const realShare: number[] = [];
for (const kind of EVENT_KINDS) {
  for (const size of EVENT_SPECS[kind].sizes) {
    const s: RngState = { rng: 1000 + size };
    const before = loadRatings().constructed;
    const r = createEvent({ kind, size, human: HUMAN, sleeves: SLEEVES, avatars: AVATARS, seed: 4242 + size });
    playOut(r, s);
    const grants: number[] = [];
    closeOutEvent(r, null);
    const after = loadRatings().constructed;
    const tag = `${kind} ${size}`;
    avgRating.push(verifyEvent(r, tag));
    realShare.push(r.entrants.filter((e) => !e.human && PREMADE_DECKS.find((d) => d.id === e.deck.id)?.event).length / (r.size - 1));
    // rating: one rated match per played (non-bye, non-ID) player match
    const played = [...r.rounds.flat(), ...r.top.flat()].filter((m) => (m.a === r.humanId || m.b === r.humanId) && m.b != null && !m.intentional && m.games.every((g) => g.how === 'human'));
    check(r.rated.length === played.length, `${tag}: ${r.rated.length} rated vs ${played.length} played`);
    check(after.matches - before.matches === played.length, `${tag}: rating match count`);
    check(after.rating - before.rating === r.ratingDelta, `${tag}: rating delta ${r.ratingDelta} vs ${after.rating - before.rating}`);
    // prizes
    const b = bandFor(r.kind, placeOf(r), r.size, r.topCut, { madeCut: r.top[0].some((m) => m.a === r.humanId || m.b === r.humanId), losses: standingsOf(r).find((x) => x.id === r.humanId)!.l, dropped: false });
    check(r.placing === b.label && (r.prizes?.length ?? 0) >= 1, `${tag}: placing ${r.placing}`);
    void grants;
  }
}
// tiers by field: locals sizes (3), regional (3), sjc (3), nationals (1)
const tierAvg = [avgRating.slice(0, 3), avgRating.slice(3, 6), avgRating.slice(6, 9), avgRating.slice(9, 10)].map((a) => a.reduce((x, y) => x + y, 0) / a.length);
for (let i = 1; i < tierAvg.length; i++) check(tierAvg[i] > tierAvg[i - 1], `field rating rises by tier: ${tierAvg.map((x) => x.toFixed(0)).join(' < ')}`);
check(realShare[9] > realShare[0], `more real lists at Nationals (${(realShare[9] * 100).toFixed(0)}%) than at Locals (${(realShare[0] * 100).toFixed(0)}%)`);
check(loadEventHistory().length === 10, `history has ${loadEventHistory().length} events`);
const tEvents = performance.now() - t0;

// ------------------------------------------------------------------ rolling window (synthetic)
{
  const rows: PointsRow[] = [
    { w: 1, e: 'a', k: 'sjc', p: 1, pts: 100 },
    { w: 2, e: 'b', k: 'locals', p: 1, pts: 8 },
    { w: 5, e: 'c', k: 'regional', p: 4, pts: 25 },
    { w: 6, e: 'd', k: 'locals', p: 2, pts: 6 },
    { w: 7, e: 'e', k: 'locals', p: 1, pts: 8 },
    { w: 8, e: 'f', k: 'locals', p: 3, pts: 4 },
    { w: 9, e: 'g', k: 'locals', p: 9, pts: 1 },
  ];
  check(rollingScore(rows, 8) === 100 + 25 + 8 + 8, `week 8 window counts the week-1 SJC: ${rollingScore(rows, 8)}`);
  check(rollingScore(rows, 9) === 25 + 8 + 8 + 6, `week 9 window drops week 1: ${rollingScore(rows, 9)}`);
  check(rollingScore(rows, 12) === 25 + 8 + 6 + 4, `week 12 window keeps weeks 5..12 only: ${rollingScore(rows, 12)}`);
  check(RANK_WINDOW === 8 && BEST_OF === 4, 'window 8 weeks, best 4');
}

// ------------------------------------------------------------------ the season

function playSeason(seed: number, policy: { enter: boolean; p: number }) {
  freshStorage();
  const season = startSeason(seed);
  const s: RngState = { rng: seed ^ 0x5bd1e995 };
  let ratedMatches = 0;
  const weekly: { week: number; you: number; rows: number }[] = [];
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    const cur = loadSeason()!;
    check(cur.week === w, `season week ${cur.week} vs ${w}`);
    for (const ev of eventsThisWeek(cur)) {
      const sNow = loadSeason()!;
      const e = sNow.events.find((x) => x.id === ev.id)!;
      if (!policy.enter || !canEnter(sNow, e)) continue;
      const run = startSeasonEvent(sNow, e.id, HUMAN, SLEEVES, AVATARS);
      check(!!run, `could not enter ${e.id}`);
      if (!run) continue;
      check(run.size === e.size && run.entrants.length === e.size, `${e.id}: field size`);
      const circuitIn = run.entrants.filter((x) => x.circuitId);
      check(circuitIn.length > 0, `${e.id}: circuit duelists attend`);
      if (e.kind === 'locals') check(circuitIn.some((x) => x.regular), `${e.id}: regulars at Locals`);
      playOut(run, s, policy.p);
      ratedMatches += run.rated.length;
      closeOutEvent(run, sNow);
      clearActiveEvent();
      const after = loadSeason()!.events.find((x) => x.id === e.id)!;
      check(after.status === 'played' && !!after.result, `${e.id}: recorded as played`);
      const band = bandFor(e.kind, after.result!.place, e.size, topCutFor(e.kind, e.size), { madeCut: after.result!.madeCut, losses: Number(after.result!.record.split('-')[1]), dropped: false });
      check(after.result!.points === band.points, `${e.id}: ${after.result!.points} points vs band ${band.points}`);
    }
    const before = loadSeason()!;
    // Nationals needs an invite
    for (const ev of eventsThisWeek(before)) {
      if (ev.kind === 'nationals') {
        const invited = !!before.invites[YOU]?.nationals;
        check(canEnter(before, ev) === (invited && ev.status === 'upcoming'), `${ev.id}: entry follows the invite`);
        if (!policy.enter) check(ev.status === 'upcoming', `${ev.id}: not entered`);
      }
    }
    check(advanceWeek(before) === null, `advance week ${w}`);
    const after = loadSeason()!;
    check(eventsThisWeek({ ...after, week: w } as Season).every((e) => e.status === 'played' || e.status === 'skipped'), `week ${w}: every event resolved`);
    weekly.push({ week: w, you: (after.points[YOU] ?? []).length, rows: Object.keys(after.points).length });
  }
  const end = loadSeason()!;
  return { end, ratedMatches, weekly };
}

const tSeason0 = performance.now();
const seasonResults: string[] = [];
for (let i = 0; i < SEASONS; i++) {
  const seed = 777 + i * 1013;
  const r1 = playSeason(seed, { enter: true, p: 0.66 });
  const end = r1.end;
  const tag = `season ${seed}`;
  check(end.done && end.week === SEASON_WEEKS + 1 && !!end.summary, `${tag}: season ends after ${SEASON_WEEKS} weeks`);
  check(end.rankHistory.length === SEASON_WEEKS, `${tag}: weekly rank log`);
  // the player's points rows match their played events
  const played = end.events.filter((e) => e.status === 'played');
  check((end.points[YOU] ?? []).length === played.length, `${tag}: one points row per played event`);
  check(played.filter((e) => e.kind === 'locals').length === SEASON_WEEKS, `${tag}: Locals every week`);
  // final score uses the last 8 weeks only
  const rows = end.points[YOU] ?? [];
  const manual = rows
    .filter((r) => r.w > SEASON_WEEKS - RANK_WINDOW)
    .map((r) => r.pts)
    .sort((a, b) => b - a)
    .slice(0, BEST_OF)
    .reduce((a, b) => a + b, 0);
  check(end.summary!.score === manual, `${tag}: final score ${end.summary!.score} vs ${manual}`);
  const st = circuitStandings(end, SEASON_WEEKS);
  check(st.length === buildCircuit(end.seed).length + 1, `${tag}: standings hold ${st.length} players`);
  check(st.every((x, j) => j === 0 || st[j - 1].score >= x.score), `${tag}: standings sorted by rolling score`);
  check(st.find((x) => x.you)!.rank === end.summary!.finalRank, `${tag}: final rank`);
  // invites: regional top cut → Nationals
  for (const ev of end.events.filter((e) => e.kind === 'regional')) {
    const cut = regionalInviteCut(ev.size);
    for (const [id, prs] of Object.entries(end.points)) {
      const row = prs.find((r) => r.e === ev.id);
      if (row && row.p <= cut) check(!!end.invites[id]?.nationals, `${tag}: ${id} top ${cut} at ${ev.id} has a Nationals invite`);
    }
  }
  // Nationals is the week-12 finale and everyone invited (AI) got a seat
  const nats = end.events.find((e) => e.kind === 'nationals')!;
  check(nats.week === NATIONALS_WEEK && NATIONALS_WEEK === SEASON_WEEKS, `${tag}: Nationals closes the season`);
  check(!end.events.some((e) => !(e.kind in EVENT_SPECS)), `${tag}: only known event kinds`);
  const natsRows = Object.entries(end.points).filter(([, prs]) => prs.some((r) => r.e === nats.id));
  check(natsRows.length >= Math.min(nats.size - 1, 100), `${tag}: Nationals field ${natsRows.length}`);
  const invitedAI = Object.entries(end.invites).filter(([id, inv]) => id !== YOU && inv.nationals && !inv.nationals.startsWith('Top 4'));
  const natsIds = new Set(natsRows.map(([id]) => id));
  check(invitedAI.filter(([id]) => !natsIds.has(id)).length === 0 || invitedAI.length > nats.size - 1, `${tag}: invited AI play Nationals`);
  // player entry rules
  const you = end.invites[YOU] ?? {};
  check((nats.status === 'played') === !!you.nationals, `${tag}: you played Nationals only with an invite (${nats.status}, ${you.nationals ?? 'none'})`);
  // ratings
  const ratings = loadRatings().constructed;
  check(ratings.matches === r1.ratedMatches && ratings.history.length === r1.ratedMatches && ratings.matches > 50, `${tag}: ${ratings.matches} rated matches (${r1.ratedMatches} expected)`);
  check(ratings.rating !== 1500, `${tag}: rating moved (${ratings.rating})`);
  // determinism: same seed, same choices, same season
  const fp = JSON.stringify({ pts: end.points, inv: end.invites, rank: end.rankHistory, r: ratings.rating, champs: end.events.map((e) => e.champion?.name) });
  const r2 = playSeason(seed, { enter: true, p: 0.66 });
  const fp2 = JSON.stringify({ pts: r2.end.points, inv: r2.end.invites, rank: r2.end.rankHistory, r: loadRatings().constructed.rating, champs: r2.end.events.map((e) => e.champion?.name) });
  check(fp === fp2, `${tag}: deterministic replay`);
  seasonResults.push(`${tag}: rank ${end.summary!.finalRank}/${st.length}, ${end.summary!.score} pts (${end.summary!.totalPoints} total), rating ${ratings.rating}, invites ${you.nationals ? 'Nationals' : 'none'}, trophies ${end.summary!.trophies.length}`);
}

// a season skipped entirely: the AI circuit still plays, you sit unranked at 0
{
  const r = playSeason(31337, { enter: false, p: 0 });
  const st = circuitStandings(r.end, SEASON_WEEKS);
  check(r.end.done && st.find((x) => x.you)!.score === 0, 'skipped season: you score 0');
  check(st[0].score > 0 && r.end.events.every((e) => e.status === 'skipped'), 'skipped season: AI earned points, all events simulated');
  // attendance shape
  const s = r.end;
  const ev = s.events.find((e) => e.kind === 'sjc')!;
  const pros = attendeesFor(s, ev, true).filter((d) => d.tier === 'pro').length;
  const locs = attendeesFor(s, s.events[0], true).filter((d) => d.tier === 'local').length;
  check(pros > 30, `pros travel to the SJC (${pros})`);
  check(locs >= 8, `locals at Locals (${locs})`);
}
const tSeason = performance.now() - tSeason0;

void computeStandings;
void night;
void loadActiveEvent;

console.log(`Events: every tier played in ${(tEvents / 1000).toFixed(2)}s · field rating by tier ${tierAvg.map((x) => x.toFixed(0)).join(' / ')}`);
console.log(`Circuit: ${SEASONS * 2 + 1} seasons (12 weeks, every event entered) in ${(tSeason / 1000).toFixed(2)}s`);
for (const l of seasonResults) console.log(`  ${l}`);
console.log(`  ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
