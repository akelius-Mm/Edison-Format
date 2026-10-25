// Swiss pairings, standings with tiebreakers, and single-elimination top cut.
import type { Match, Standing, Tournament } from './types';

export const MATCH_WIN = 3;
export const MATCH_DRAW = 1;
const FLOOR = 1 / 3;

export function swissRoundsFor(n: number) {
  return Math.max(1, Math.ceil(Math.log2(n)));
}

export function topCutFor(n: number): 4 | 8 {
  return n <= 8 ? 4 : 8;
}

/** Compute Swiss standings (only Swiss matches count). */
export function computeStandings(t: Tournament): Standing[] {
  const rows = new Map<string, Standing>();
  for (const e of t.entrants)
    rows.set(e.id, { id: e.id, rank: 0, mp: 0, w: 0, l: 0, d: 0, byes: 0, gw: 0, gl: 0, gd: 0, mwp: 0, omw: 0, gwp: 0, ogw: 0, opponents: [] });
  let roundsPlayed = new Map<string, number>();
  for (const round of t.rounds) {
    for (const m of round) {
      if (!m.result) continue;
      const A = rows.get(m.a)!;
      roundsPlayed.set(m.a, (roundsPlayed.get(m.a) ?? 0) + 1);
      if (m.b == null) {
        A.mp += MATCH_WIN;
        A.w++;
        A.byes++;
        continue;
      }
      const B = rows.get(m.b)!;
      roundsPlayed.set(m.b, (roundsPlayed.get(m.b) ?? 0) + 1);
      A.opponents.push(m.b);
      B.opponents.push(m.a);
      for (const g of m.games) {
        if (g.winner === 0) (A.gw++, B.gl++);
        else if (g.winner === 1) (B.gw++, A.gl++);
        else (A.gd++, B.gd++);
      }
      if (m.result === 'a') (A.mp += MATCH_WIN, A.w++, B.l++);
      else if (m.result === 'b') (B.mp += MATCH_WIN, B.w++, A.l++);
      else (A.mp += MATCH_DRAW, B.mp += MATCH_DRAW, A.d++, B.d++);
    }
  }
  for (const r of rows.values()) {
    const rp = roundsPlayed.get(r.id) ?? 0;
    r.mwp = rp ? Math.max(FLOOR, r.mp / (MATCH_WIN * rp)) : 0;
    const gp = r.gw + r.gl + r.gd;
    r.gwp = gp ? Math.max(FLOOR, (r.gw + r.gd / 3) / gp) : 0;
  }
  for (const r of rows.values()) {
    const opps = r.opponents.map((o) => rows.get(o)!);
    r.omw = opps.length ? opps.reduce((a, o) => a + o.mwp, 0) / opps.length : 0;
    r.ogw = opps.length ? opps.reduce((a, o) => a + o.gwp, 0) / opps.length : 0;
  }
  const seed = new Map(t.entrants.map((e) => [e.id, e.seed]));
  const out = [...rows.values()].sort(
    (x, y) => y.mp - x.mp || y.omw - x.omw || y.gwp - x.gwp || y.ogw - x.ogw || seed.get(x.id)! - seed.get(y.id)!,
  );
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pair the next Swiss round: players are ordered by match points (random order inside a score
 * group), then paired top-down with backtracking so nobody meets the same opponent twice.
 * Odd player counts give a bye to the lowest-ranked player that has not had one.
 */
export function pairSwissRound(t: Tournament, roundNo: number, rnd: () => number = Math.random): Match[] {
  const standings = computeStandings(t);
  const played = new Map<string, Set<string>>();
  const hadBye = new Set<string>();
  for (const e of t.entrants) played.set(e.id, new Set());
  for (const r of t.rounds)
    for (const m of r) {
      if (m.b == null) hadBye.add(m.a);
      else {
        played.get(m.a)!.add(m.b);
        played.get(m.b)!.add(m.a);
      }
    }
  // order: by points, shuffled within each score group
  const groups = new Map<number, string[]>();
  for (const s of standings) (groups.get(s.mp) ?? groups.set(s.mp, []).get(s.mp)!).push(s.id);
  let order: string[] = [];
  for (const mp of [...groups.keys()].sort((a, b) => b - a)) order.push(...shuffle(groups.get(mp)!, rnd));
  if (roundNo === 1) order = shuffle([...order], rnd);

  let bye: string | null = null;
  if (order.length % 2 === 1) {
    for (let i = order.length - 1; i >= 0; i--)
      if (!hadBye.has(order[i])) {
        bye = order[i];
        break;
      }
    bye ??= order[order.length - 1];
    order = order.filter((x) => x !== bye);
  }

  let budget = 200000;
  const solve = (list: string[], allowRematch: boolean): [string, string][] | null => {
    if (!list.length) return [];
    if (--budget < 0) return null;
    const [a, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i];
      if (!allowRematch && played.get(a)!.has(b)) continue;
      const sub = solve([...rest.slice(0, i), ...rest.slice(i + 1)], allowRematch);
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };
  let pairs = solve(order, false);
  if (!pairs) {
    budget = 200000;
    pairs = solve(order, true)!;
  }
  const matches: Match[] = pairs.map(([a, b], i) => ({
    id: `s${roundNo}-${i + 1}`,
    stage: 'swiss',
    round: roundNo,
    table: i + 1,
    a,
    b,
    games: [],
    result: null,
    label: `Round ${roundNo}`,
  }));
  if (bye) matches.push({ id: `s${roundNo}-bye`, stage: 'swiss', round: roundNo, table: matches.length + 1, a: bye, b: null, games: [], result: 'a', label: `Round ${roundNo}` });
  return matches;
}

export function topRoundLabel(playersLeft: number) {
  if (playersLeft <= 2) return 'Final';
  if (playersLeft <= 4) return 'Semifinal';
  if (playersLeft <= 8) return 'Quarterfinal';
  return `Top ${playersLeft}`;
}

/** First round of the single-elimination bracket from Swiss standings (1v8, 4v5, 2v7, 3v6). */
export function seedTopCut(t: Tournament): Match[] {
  const s = computeStandings(t).slice(0, t.topCut).map((x) => x.id);
  const order = t.topCut === 8 ? [[0, 7], [3, 4], [1, 6], [2, 5]] : [[0, 3], [1, 2]];
  const label = topRoundLabel(t.topCut);
  return order.map(([x, y], i) => ({ id: `t1-${i + 1}`, stage: 'top', round: 1, table: i + 1, a: s[x], b: s[y], games: [], result: null, label }));
}

export function winnerOf(m: Match): string | null {
  if (m.result === 'a') return m.a;
  if (m.result === 'b') return m.b;
  return null;
}
export function loserOf(m: Match): string | null {
  if (m.result === 'a') return m.b;
  if (m.result === 'b') return m.a;
  return null;
}

export function nextTopRound(t: Tournament): Match[] {
  const prev = t.top[t.top.length - 1];
  const winners = prev.map(winnerOf) as string[];
  const n = t.top.length + 1;
  const label = topRoundLabel(winners.length);
  const out: Match[] = [];
  for (let i = 0; i < winners.length; i += 2)
    out.push({ id: `t${n}-${i / 2 + 1}`, stage: 'top', round: n, table: i / 2 + 1, a: winners[i], b: winners[i + 1], games: [], result: null, label });
  return out;
}

/** Final order: champion, finalist, semifinal losers, quarterfinal losers, then Swiss standings. */
export function finalPlacements(t: Tournament): string[] {
  const standings = computeStandings(t);
  const rank = new Map(standings.map((s) => [s.id, s.rank]));
  const out: string[] = [];
  const final = t.top[t.top.length - 1]?.[0];
  if (final) {
    out.push(winnerOf(final)!, loserOf(final)!);
    for (let r = t.top.length - 2; r >= 0; r--) {
      const losers = t.top[r].map(loserOf).filter((x): x is string => !!x);
      losers.sort((a, b) => rank.get(a)! - rank.get(b)!);
      out.push(...losers);
    }
  }
  for (const s of standings) if (!out.includes(s.id)) out.push(s.id);
  return out;
}

export function roundComplete(ms: Match[] | undefined) {
  return !!ms && ms.every((m) => m.result != null);
}
