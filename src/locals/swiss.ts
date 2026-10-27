// Swiss pairings, Konami-style standings (match points, then opponents' match win %, then
// opponents' opponents' match win %), byes, intentional-draw math and the single-elimination cut.
import { topRoundLabel } from '../tournament/swiss';
import { shuffleIn, type RngState } from './rng';
import type { LocalsEntrant, LocalsMatch, LocalsNight, LocalsStanding } from './types';

export const MATCH_WIN = 3;
export const MATCH_DRAW = 1;

type NightLike = Pick<LocalsNight, 'entrants' | 'rounds'>;

/** Swiss standings. Only Swiss matches count; byes are wins but not opponents. */
export function computeStandings(n: NightLike): LocalsStanding[] {
  const rows = new Map<string, LocalsStanding>();
  const played = new Map<string, number>();
  for (const e of n.entrants)
    rows.set(e.id, { id: e.id, rank: 0, mp: 0, w: 0, l: 0, d: 0, byes: 0, gw: 0, gl: 0, mwp: 0, omw: 0, oomw: 0, opponents: [], dropped: e.dropped != null });
  for (const round of n.rounds)
    for (const m of round) {
      if (!m.result) continue;
      const A = rows.get(m.a)!;
      played.set(m.a, (played.get(m.a) ?? 0) + 1);
      if (m.b == null) {
        A.mp += MATCH_WIN;
        A.w++;
        A.byes++;
        continue;
      }
      const B = rows.get(m.b)!;
      played.set(m.b, (played.get(m.b) ?? 0) + 1);
      A.opponents.push(m.b);
      B.opponents.push(m.a);
      for (const g of m.games) {
        if (g.winner === 0) (A.gw++, B.gl++);
        else if (g.winner === 1) (B.gw++, A.gl++);
      }
      if (m.result === 'a') (A.mp += MATCH_WIN, A.w++, B.l++);
      else if (m.result === 'b') (B.mp += MATCH_WIN, B.w++, A.l++);
      else (A.mp += MATCH_DRAW, B.mp += MATCH_DRAW, A.d++, B.d++);
    }
  for (const r of rows.values()) {
    const rp = played.get(r.id) ?? 0;
    r.mwp = rp ? r.mp / (MATCH_WIN * rp) : 0;
  }
  const avg = (ids: string[], f: (s: LocalsStanding) => number) => (ids.length ? ids.reduce((a, o) => a + f(rows.get(o)!), 0) / ids.length : 0);
  for (const r of rows.values()) r.omw = avg(r.opponents, (o) => o.mwp);
  for (const r of rows.values()) r.oomw = avg(r.opponents, (o) => o.omw);
  const seed = new Map(n.entrants.map((e) => [e.id, e.seed]));
  const out = [...rows.values()].sort(compareStandings(seed));
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

const EPS = 1e-9;
export function compareStandings(seed: Map<string, number>) {
  return (x: LocalsStanding, y: LocalsStanding) =>
    y.mp - x.mp || cmp(y.omw, x.omw) || cmp(y.oomw, x.oomw) || seed.get(x.id)! - seed.get(y.id)!;
}
const cmp = (a: number, b: number) => (Math.abs(a - b) < EPS ? 0 : a - b);

/** Opponents everyone has already faced in Swiss (byes excluded). */
export function playedPairs(n: NightLike) {
  const played = new Map<string, Set<string>>();
  for (const e of n.entrants) played.set(e.id, new Set());
  const byes = new Set<string>();
  for (const r of n.rounds)
    for (const m of r) {
      if (m.b == null) byes.add(m.a);
      else {
        played.get(m.a)!.add(m.b);
        played.get(m.b)!.add(m.a);
      }
    }
  return { played, byes };
}

/**
 * Pair a Swiss round. Active players are ordered by match points (random inside each score group,
 * fully random in round one) and paired top-down with backtracking so nobody meets an opponent
 * twice. With an odd number of active players the lowest-ranked player without a bye gets one.
 * Table 1 is the top pairing.
 */
export function pairSwissRound(n: NightLike, roundNo: number, s: RngState): LocalsMatch[] {
  const active = new Set(n.entrants.filter((e) => e.dropped == null).map((e) => e.id));
  const standings = computeStandings(n).filter((x) => active.has(x.id));
  const { played, byes } = playedPairs(n);

  const groups = new Map<number, string[]>();
  for (const st of standings) (groups.get(st.mp) ?? groups.set(st.mp, []).get(st.mp)!).push(st.id);
  let order: string[] = [];
  for (const mp of [...groups.keys()].sort((a, b) => b - a)) order.push(...shuffleIn(s, groups.get(mp)!));
  if (roundNo === 1) order = shuffleIn(s, [...order]);

  const solve = (list: string[], allowRematch: boolean, budget: { n: number }): [string, string][] | null => {
    if (!list.length) return [];
    if (--budget.n < 0) return null;
    const [a, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i];
      if (!allowRematch && played.get(a)!.has(b)) continue;
      const sub = solve([...rest.slice(0, i), ...rest.slice(i + 1)], allowRematch, budget);
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };

  let bye: string | null = null;
  let pairs: [string, string][] | null = null;
  if (order.length % 2 === 1) {
    // lowest-ranked first; players who already had a bye go last
    const candidates = [...order].reverse().sort((x, y) => Number(byes.has(x)) - Number(byes.has(y)));
    for (const c of candidates) {
      const rest = order.filter((x) => x !== c);
      pairs = solve(rest, false, { n: 100000 });
      if (pairs) {
        bye = c;
        break;
      }
    }
    if (!pairs) {
      bye = candidates[0];
      pairs = solve(order.filter((x) => x !== bye), true, { n: 100000 })!;
    }
  } else {
    pairs = solve(order, false, { n: 200000 }) ?? solve(order, true, { n: 200000 })!;
  }

  const label = `Round ${roundNo}`;
  const matches: LocalsMatch[] = pairs.map(([a, b], i) => ({ id: `s${roundNo}-${i + 1}`, stage: 'swiss', round: roundNo, table: i + 1, a, b, games: [], result: null, label }));
  if (bye) matches.push({ id: `s${roundNo}-bye`, stage: 'swiss', round: roundNo, table: 0, a: bye, b: null, games: [], result: 'a', label });
  return matches;
}

// ------------------------------------------------------------------ intentional draws

export interface IdCheck {
  /** Both players make the cut whatever happens at the other tables. */
  guaranteed: boolean;
  /** Only ties on points (decided by tiebreakers) could keep them out. */
  likely: boolean;
}

/**
 * Can the two players of a final-round Swiss match draw and still make the top cut?
 * For each other table we take the outcome that pushes the most players to or above our total.
 */
export function idCheck(n: NightLike & Pick<LocalsNight, 'topCut'>, round: LocalsMatch[], m: LocalsMatch): IdCheck {
  if (m.b == null) return { guaranteed: false, likely: false };
  const st = new Map(computeStandings(n).map((x) => [x.id, x]));
  const A = st.get(m.a)!;
  const B = st.get(m.b)!;
  const others = round.filter((x) => x !== m);
  const worst = (threshold: number, strict: boolean) => {
    const reach = (pts: number) => (strict ? pts > threshold : pts >= threshold);
    let count = 0;
    for (const x of others) {
      const pa = st.get(x.a)!.mp;
      if (x.b == null) {
        count += Number(reach(pa + MATCH_WIN));
        continue;
      }
      const pb = st.get(x.b)!.mp;
      count += Math.max(
        Number(reach(pa + MATCH_WIN)) + Number(reach(pb)),
        Number(reach(pa)) + Number(reach(pb + MATCH_WIN)),
        Number(reach(pa + MATCH_DRAW)) + Number(reach(pb + MATCH_DRAW)),
      );
    }
    return count;
  };
  const safe = (me: LocalsStanding, partner: LocalsStanding, strict: boolean) => {
    const total = me.mp + MATCH_DRAW;
    const partnerAbove = strict ? partner.mp + MATCH_DRAW > total : partner.mp + MATCH_DRAW >= total;
    return worst(total, strict) + Number(partnerAbove) <= n.topCut - 1;
  };
  const guaranteed = safe(A, B, false) && safe(B, A, false);
  const likely = guaranteed || (safe(A, B, true) && safe(B, A, true));
  return { guaranteed, likely };
}

/** X-1 or better without draws: the records that usually ask for an ID in the last round. */
export function idRecordOk(s: LocalsStanding | undefined) {
  return !!s && s.l <= 1 && s.d === 0;
}

// ------------------------------------------------------------------ top cut

/** Top cut seeds: Swiss standings, skipping anyone who dropped. */
export function topCutSeeds(n: NightLike & Pick<LocalsNight, 'topCut'>): string[] {
  return computeStandings(n)
    .filter((x) => !x.dropped)
    .slice(0, n.topCut)
    .map((x) => x.id);
}

/**
 * Standard bracket order for a power-of-two cut, as 0-based seed pairs: Top 8 gives 1v8, 4v5,
 * 2v7, 3v6; Top 4 gives 1v4, 2v3; larger cuts (Events: Top 16/32/64) follow the same pattern so
 * the top seeds can only meet late.
 */
export function bracketPairs(size: number): [number, number][] {
  // a damaged save (a cut of 0, 12 or a huge number) must not spin here allocating forever
  if (!Number.isInteger(size) || size < 2 || size > 1024 || (size & (size - 1)) !== 0) throw new Error(`Top cut of ${size} is not a power of two from 2 to 1024`);
  let order = [0, 1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n - 1 - s]);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < order.length; i += 2) out.push([order[i], order[i + 1]]);
  return out;
}

/** First bracket round: 1v8, 4v5, 2v7, 3v6 (or 1v4, 2v3; or any larger power-of-two cut). */
export function seedTopCut(n: NightLike & Pick<LocalsNight, 'topCut'>): LocalsMatch[] {
  const s = topCutSeeds(n);
  const order = bracketPairs(n.topCut);
  const label = topRoundLabel(n.topCut);
  return order.map(([x, y], i) => ({ id: `t1-${i + 1}`, stage: 'top', round: 1, table: i + 1, a: s[x], b: s[y], games: [], result: null, label }));
}

export const winnerOf = (m: LocalsMatch) => (m.result === 'a' ? m.a : m.result === 'b' ? m.b : null);
export const loserOf = (m: LocalsMatch) => (m.result === 'a' ? m.b : m.result === 'b' ? m.a : null);

export function nextTopRound(top: LocalsMatch[][]): LocalsMatch[] {
  const prev = top[top.length - 1];
  const winners = prev.map(winnerOf) as string[];
  const r = top.length + 1;
  const label = topRoundLabel(winners.length);
  const out: LocalsMatch[] = [];
  for (let i = 0; i < winners.length; i += 2)
    out.push({ id: `t${r}-${i / 2 + 1}`, stage: 'top', round: r, table: i / 2 + 1, a: winners[i], b: winners[i + 1], games: [], result: null, label });
  return out;
}

/** Champion, finalist, semifinal losers, quarterfinal losers (each by Swiss rank), then Swiss order. */
export function finalPlacements(n: NightLike & Pick<LocalsNight, 'top'>): string[] {
  const standings = computeStandings(n);
  const rank = new Map(standings.map((x) => [x.id, x.rank]));
  const out: string[] = [];
  const final = n.top[n.top.length - 1]?.[0];
  if (final && final.result) {
    out.push(winnerOf(final)!, loserOf(final)!);
    for (let r = n.top.length - 2; r >= 0; r--) {
      const losers = n.top[r].map(loserOf).filter((x): x is string => !!x);
      losers.sort((a, b) => rank.get(a)! - rank.get(b)!);
      out.push(...losers);
    }
  }
  for (const x of standings) if (!out.includes(x.id)) out.push(x.id);
  return out;
}

export const isActive = (e: LocalsEntrant) => e.dropped == null;
