// Simulation of AI-vs-AI matches: a fast rating model, or full headless engine games.
import { AIController, type Difficulty } from '../ai/ai';
import { buildDeckList } from '../decks';
import { Game } from '../engine/game';
import type { PlayerId } from '../engine/types';
import type { DeckSnapshot, Entrant, GameResult, Match, SimMode } from './types';

// ------------------------------------------------------------------ match logic

/**
 * Decide a match from its games. Returns null while more games are needed.
 * With requireWinner (top cut) tied matches continue until someone leads (capped; then null
 * is returned with `exhausted` so the caller can break the tie).
 */
export function matchOutcome(games: GameResult[], bestOf: 1 | 3, requireWinner = false): { result: 'a' | 'b' | 'draw' | null; exhausted: boolean } {
  const wa = games.filter((g) => g.winner === 0).length;
  const wb = games.filter((g) => g.winner === 1).length;
  const need = bestOf === 1 ? 1 : 2;
  if (wa >= need) return { result: 'a', exhausted: false };
  if (wb >= need) return { result: 'b', exhausted: false };
  if (games.length >= bestOf) {
    if (wa > wb) return { result: 'a', exhausted: false };
    if (wb > wa) return { result: 'b', exhausted: false };
    if (!requireWinner) return { result: 'draw', exhausted: false };
    if (games.length >= bestOf + 3) return { result: null, exhausted: true };
  }
  return { result: null, exhausted: false };
}

/** Who goes first in the next game: the loser of the previous game chooses (AI always goes first). */
export function nextFirstPlayer(games: GameResult[]): PlayerId | null {
  const last = games[games.length - 1];
  if (!last || last.winner == null) return null;
  return (1 - last.winner) as PlayerId;
}

// ------------------------------------------------------------------ fast model

const TIER_RATING: Record<1 | 2 | 3, number> = { 1: 1620, 2: 1530, 3: 1450 };
const DIFF_RATING: Record<Difficulty, number> = { easy: -110, normal: 0, hard: 70 };

export function ratingOf(e: Pick<Entrant, 'deck' | 'skill' | 'difficulty'>) {
  return TIER_RATING[e.deck.tier] + e.skill + DIFF_RATING[e.difficulty];
}

export function fastGame(a: Entrant, b: Entrant, rnd: () => number = Math.random): GameResult {
  if (rnd() < 0.015) return { winner: null, turns: 30, reason: 'Turn limit reached', how: 'fast' };
  // per-game form swing keeps upsets possible
  const ra = ratingOf(a) + (rnd() - 0.5) * 120;
  const rb = ratingOf(b) + (rnd() - 0.5) * 120;
  const pa = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const winner: 0 | 1 = rnd() < pa ? 0 : 1;
  const turns = 5 + Math.floor(rnd() * 12);
  const reasons = ['LP reduced to 0', 'LP reduced to 0', 'LP reduced to 0', 'Deck out', 'Surrender'];
  const reason = reasons[Math.floor(rnd() * (rnd() < 0.9 ? 3 : reasons.length))];
  return { winner, turns, reason, how: 'fast' };
}

// ------------------------------------------------------------------ full engine games

export interface HeadlessSide {
  name: string;
  deck: Pick<DeckSnapshot, 'main' | 'extra'>;
  difficulty: Difficulty;
}

/**
 * Play one complete AI-vs-AI game with the rules engine, without any animation.
 * Yields to the event loop periodically so the UI stays responsive. Returns null if the
 * game crashed or exceeded the time budget.
 */
export async function headlessGame(
  a: HeadlessSide,
  b: HeadlessSide,
  opts: { firstPlayer?: PlayerId | null; skipFirstDraw?: boolean; maxTurns?: number; timeoutMs?: number; seed?: number } = {},
): Promise<GameResult | null> {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const da = buildDeckList(a.deck);
  const db = buildDeckList(b.deck);
  if (da.main.length < 20 || db.main.length < 20) return null;
  let game: Game;
  try {
    game = new Game([da, db], [new AIController(a.difficulty, seed + 1), new AIController(b.difficulty, seed + 2)], {
      seed,
      names: [a.name, b.name],
      maxTurns: opts.maxTurns ?? 50,
      skipFirstDraw: opts.skipFirstDraw ?? false,
      ...(opts.firstPlayer != null ? { firstPlayer: opts.firstPlayer } : {}),
    });
  } catch (e) {
    console.error('headless game setup failed', e);
    return null;
  }
  const deadline = performance.now() + (opts.timeoutMs ?? 25000);
  let lastYield = performance.now();
  let aborted = false;
  game.hooks.anim = () => {
    const now = performance.now();
    if (now > deadline) {
      aborted = true;
      throw new Error('headless game timed out');
    }
    if (now - lastYield > 12) {
      lastYield = now;
      return new Promise<void>((r) => setTimeout(r, 0));
    }
  };
  // The engine logs through console.error on card-script problems; keep the console quiet.
  try {
    const res = await game.start();
    return { winner: res.winner as 0 | 1 | null, turns: res.turns, reason: res.reason, how: 'full' };
  } catch (e) {
    if (!aborted) console.warn('headless game crashed', e);
    return null;
  }
}

// ------------------------------------------------------------------ match simulation

export async function simulateMatch(
  m: Match,
  a: Entrant,
  b: Entrant,
  opts: { bestOf: 1 | 3; mode: SimMode; requireWinner?: boolean; skipFirstDraw?: boolean; onGame?: (g: GameResult) => void },
): Promise<void> {
  m.games = [];
  m.result = null;
  for (let guard = 0; guard < 8; guard++) {
    const out = matchOutcome(m.games, opts.bestOf, opts.requireWinner);
    if (out.result) {
      m.result = out.result;
      return;
    }
    if (out.exhausted) break;
    let g: GameResult | null = null;
    if (opts.mode === 'full') {
      g = await headlessGame(
        { name: a.name, deck: a.deck, difficulty: a.difficulty },
        { name: b.name, deck: b.deck, difficulty: b.difficulty },
        { firstPlayer: nextFirstPlayer(m.games), skipFirstDraw: opts.skipFirstDraw },
      );
      if (!g) g = { ...fastGame(a, b), how: 'fallback' };
    } else g = fastGame(a, b);
    m.games.push(g);
    opts.onGame?.(g);
  }
  // still tied in a must-have-a-winner match: higher rating + coin decides
  m.result = ratingOf(a) + (Math.random() - 0.5) * 200 >= ratingOf(b) ? 'a' : 'b';
}
