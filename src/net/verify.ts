// Friends Locals: the organiser checks a reported match by replaying it headlessly.
//
// A game is fully determined by its seed, the two decks, who went first and both seats' decision
// logs (engine/replay.ts). The organiser rebuilds every game of a report with both seats fed from
// the logs (no AI, no UI) and compares the outcome with what was reported. It also checks that the
// seeds belong to the match, that game 1 used the registered decks and that later games used a
// legal one-for-one siding of them. A game that ended outside the engine (a concede, or a win
// claimed after the opponent disconnected) must replay cleanly up to the point where it stopped;
// the caller decides whether to trust who it was given to.
//
// Also: deck legality for registration (validateDeck on card ids). DOM-free.
import { CARDS } from '../cards';
import { sidedDeckProblems, validateDeck, type DeckIds } from '../decks';
import type { CardInstance } from '../engine/card';
import type { Action, Activation, PlayerController } from '../engine/controller';
import { Game, GameOver } from '../engine/game';
import { RecordingController, type Decision } from '../engine/replay';
import type { BattlePos, PlayerId } from '../engine/types';
import { matchOutcome } from '../tournament/simulate';
import type { GameResult } from '../tournament/types';
import { gameSeed, type GameEnd, type WireDeck } from './protocol';
import type { Report } from './tourneyProtocol';

// ------------------------------------------------------------------ decks

export function deckFromWire(w: Pick<WireDeck, 'main' | 'extra'>) {
  const main = w.main.map((id) => CARDS[id]);
  const extra = w.extra.map((id) => CARDS[id]);
  return main.every(Boolean) && extra.every(Boolean) ? { main, extra } : null;
}

const entries = (ids: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const id of ids) {
    const name = CARDS[id]?.name ?? `#${id}`;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return [...m];
};

/** Constructed legality of a registered deck (empty = legal). */
export function wireDeckProblems(w: WireDeck | null | undefined): string[] {
  if (!w || !Array.isArray(w.main) || !Array.isArray(w.extra)) return ['No deck'];
  const unknown = [...w.main, ...w.extra, ...(w.side ?? [])].find((id) => !CARDS[id]);
  if (unknown) return [`Unknown card ${unknown} (update the app)`];
  return validateDeck({ main: entries(w.main), extra: entries(w.extra), side: entries(w.side ?? []) });
}

const bag = (ids: string[]) => [...ids].sort().join(',');
const toIds = (w: WireDeck): DeckIds => ({ main: [...w.main], extra: [...w.extra], side: [...(w.side ?? [])] });

/** Problems with a deck used for a game, against the registered deck (empty = fine). */
export function usedDeckProblems(used: WireDeck, registered: WireDeck, game: number): string[] {
  if (!used || !Array.isArray(used.main) || !Array.isArray(used.extra)) return ['missing deck'];
  if (game === 0) {
    if (bag(used.main) !== bag(registered.main) || bag(used.extra) !== bag(registered.extra)) return ['game 1 was not played with the registered deck'];
    return [];
  }
  const all = (w: WireDeck) => bag([...w.main, ...w.extra, ...(w.side ?? [])]);
  if (all(used) !== all(registered)) return ['the sided deck holds cards that are not in the registered deck'];
  return sidedDeckProblems(toIds(used), toIds(registered));
}

// ------------------------------------------------------------------ replay

/** Thrown into the engine when a seat's log is used up: the game ended outside the engine. */
class LogEnd extends GameOver {
  constructor(public seat: PlayerId) {
    super(null, 'log-end');
  }
}

/** Answers nothing: reaching it means the log ran out. Reports human, like both seats online. */
function noLive(seat: PlayerId, ended: { seat: PlayerId | null }): PlayerController {
  return new Proxy({ isHuman: true } as PlayerController, {
    get(t, k) {
      if (k === 'isHuman') return true;
      if (k === 'then') return undefined;
      return () => {
        ended.seat ??= seat;
        return Promise.reject(new LogEnd(seat));
      };
    },
  });
}

/** Hands control back to the event loop now and then so a phone's UI stays responsive. */
function yielding(c: RecordingController, every = 48): PlayerController {
  let n = 0;
  return new Proxy(c, {
    get(t, k) {
      const v = (t as any)[k];
      if (typeof v !== 'function') return v;
      return async (...a: unknown[]) => {
        if (++n % every === 0) await new Promise((r) => setTimeout(r, 0));
        return v.apply(t, a);
      };
    },
  });
}

export interface GameSetup {
  seed: number;
  first: PlayerId | 'coin';
  skipFirstDraw: boolean;
  names: [string, string];
  decks: [WireDeck, WireDeck];
}

/** The Game exactly as both phones build it for a match game (duelScreen and the tests use the same options). */
export function buildMatchGame(s: GameSetup, controllers: [PlayerController, PlayerController]): Game | null {
  const a = deckFromWire(s.decks[0]);
  const b = deckFromWire(s.decks[1]);
  if (!a || !b) return null;
  return new Game([a, b], controllers, {
    seed: s.seed,
    names: s.names,
    firstPlayer: typeof s.first === 'number' ? s.first : undefined,
    skipFirstDraw: s.skipFirstDraw,
  });
}

export interface ReplayOutcome {
  /** The engine finished the game by itself. */
  finished: boolean;
  winner: PlayerId | null;
  reason: string;
  turns: number;
  /** A log entry did not fit the replayed board. */
  mismatch?: string;
  /** Entries left over after the game ended. */
  leftover: number;
}

/** Replay one game from both seats' logs, headlessly. */
export async function replayGame(s: GameSetup, logs: [Decision[], Decision[]]): Promise<ReplayOutcome> {
  const ended = { seat: null as PlayerId | null };
  const recs = [0, 1].map((i) => new RecordingController(noLive(i as PlayerId, ended), { replay: logs[i] })) as [RecordingController, RecordingController];
  const game = buildMatchGame(s, [yielding(recs[0]), yielding(recs[1])]);
  if (!game) return { finished: false, winner: null, reason: 'unknown card', turns: 0, mismatch: 'a deck holds a card this phone does not know', leftover: 0 };
  let res: { winner: PlayerId | null; reason: string; turns: number };
  try {
    res = await game.start();
  } catch (e) {
    if (e instanceof GameOver) res = { winner: e.winner, reason: e.reason, turns: game.turn };
    else return { finished: false, winner: null, reason: 'engine error', turns: game.turn, mismatch: `engine error: ${(e as Error)?.message ?? e}`, leftover: 0 };
  }
  const mismatch = recs[0].mismatch ?? recs[1].mismatch ?? undefined;
  const leftover = Math.max(0, logs[0].length - recs[0].log.length) + Math.max(0, logs[1].length - recs[1].log.length);
  if (mismatch) return { finished: false, winner: null, reason: 'mismatch', turns: game.turn, mismatch, leftover };
  if (ended.seat != null || res.reason === 'log-end') return { finished: false, winner: null, reason: 'log-end', turns: game.turn, leftover };
  return { finished: true, winner: res.winner, reason: res.reason, turns: res.turns, leftover };
}

// ------------------------------------------------------------------ a whole report

export interface VerifyContext {
  bestOf: 1 | 3;
  matchSeed: number;
  /** Registered decks, seat 0 = a. */
  decks: [WireDeck, WireDeck];
  names: [string, string];
  skipFirstDraw: boolean;
}

export interface Verdict {
  ok: boolean;
  /** Why it failed (for the organiser). */
  detail?: string;
  /** Verified game results (a/b orientation). */
  games: GameResult[];
  result: 'a' | 'b' | 'draw' | null;
  /** Games decided outside the engine: who was given the game and how. */
  external: { g: number; winner: PlayerId | null; kind: NonNullable<GameEnd['kind']> }[];
}

export async function verifyReport(rep: Report, ctx: VerifyContext): Promise<Verdict> {
  const bad = (detail: string): Verdict => ({ ok: false, detail, games: [], result: null, external: [] });
  const games = [...rep.games].sort((x, y) => x.index - y.index);
  if (!games.length) return bad('the report has no games');
  if (rep.skipFirstDraw !== ctx.skipFirstDraw) return bad('played with a different first-draw rule');
  const results: GameResult[] = [];
  const external: Verdict['external'] = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const tag = `game ${i + 1}`;
    if (g.index !== i) return bad(`${tag} is missing`);
    if (matchOutcome(results, ctx.bestOf).result) return bad(`${tag} was played after the match was decided`);
    if (g.seed !== gameSeed(ctx.matchSeed, i)) return bad(`${tag} used a seed that does not belong to this match`);
    const prev = results[i - 1];
    if (i === 0 || prev.winner == null) {
      if (g.first !== 'coin') return bad(`${tag}: the first player should come from the coin toss`);
    } else if (g.first !== 0 && g.first !== 1) return bad(`${tag}: no first player`);
    for (const s of [0, 1] as const) {
      const p = usedDeckProblems(g.decks?.[s], ctx.decks[s], i);
      if (p.length) return bad(`${tag}, ${ctx.names[s]}: ${p[0]}`);
    }
    if (!g.end || !Array.isArray(g.logs?.[0]) || !Array.isArray(g.logs?.[1])) return bad(`${tag} has no result or log`);
    const out = await replayGame({ seed: g.seed, first: g.first, skipFirstDraw: ctx.skipFirstDraw, names: ctx.names, decks: g.decks }, g.logs);
    if (out.mismatch) return bad(`${tag} does not replay: ${out.mismatch}`);
    if (out.finished) {
      if (out.leftover) return bad(`${tag}: the log continues after the game ended`);
      if (out.winner !== g.end.winner) return bad(`${tag}: reported ${who(g.end.winner, ctx.names)} but the replay gives ${who(out.winner, ctx.names)}`);
      results.push({ winner: out.winner as 0 | 1 | null, turns: out.turns, reason: out.reason, how: 'human' });
      continue;
    }
    // stopped before the engine decided it
    const kind = g.end.kind;
    if (kind === 'desync') return bad(`${tag} went out of sync between the two phones`);
    if (kind !== 'concede' && kind !== 'claim') return bad(`${tag}: the log ends before the game does`);
    if (g.end.winner == null) return bad(`${tag}: a concede without a winner`);
    external.push({ g: i, winner: g.end.winner, kind });
    results.push({ winner: g.end.winner, turns: out.turns, reason: g.end.reason, how: 'human' });
  }
  const res = matchOutcome(results, ctx.bestOf).result;
  if (!res) return bad('the match is not finished');
  return { ok: true, games: results, result: res, external };
}

const who = (w: PlayerId | null, names: [string, string]) => (w == null ? 'a draw' : `a win for ${names[w]}`);

/** A stable fingerprint of a report (to tell a re-sent report from a changed one). */
export function reportKey(rep: Report): string {
  return rep.games
    .map((g) => `${g.index}:${g.seed}:${g.first}:${g.end?.winner}:${g.end?.kind ?? ''}:${g.logs?.[0]?.length}:${g.logs?.[1]?.length}:${g.logs?.[0]?.[g.logs[0].length - 1]?.h ?? ''}`)
    .join('|');
}

void (null as unknown as CardInstance | Action | Activation | BattlePos);
