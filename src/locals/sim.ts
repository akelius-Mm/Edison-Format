// Simulated tables: a rating model on deck strength, matchups, player skill and AI difficulty.
import type { Difficulty } from '../ai/ai';
import { matchOutcome } from '../tournament/simulate';
import { deckStrength, matchupEdge } from './meta';
import { rand, type RngState } from './rng';
import type { GameResult, LocalsEntrant, LocalsMatch } from './types';

const DIFF: Record<Difficulty, number> = { easy: -90, normal: 0, hard: 60 };

export function ratingOf(e: Pick<LocalsEntrant, 'meta' | 'deck' | 'skill' | 'difficulty'>) {
  return 1500 + deckStrength(e.meta, e.deck) + e.skill + DIFF[e.difficulty];
}

/** Chance that A wins one game against B. */
export function gameWinChance(a: LocalsEntrant, b: LocalsEntrant) {
  const diff = ratingOf(a) + matchupEdge(a.meta, b.meta) - ratingOf(b);
  return 1 / (1 + Math.pow(10, -diff / 400));
}

const REASONS = ['LP reduced to 0', 'LP reduced to 0', 'LP reduced to 0', 'LP reduced to 0', 'Surrender', 'Deck out'];

export function simGame(s: RngState, a: LocalsEntrant, b: LocalsEntrant): GameResult {
  // per-game form swing keeps upsets alive
  const p = gameWinChance(a, b) + (rand(s) - 0.5) * 0.18;
  const winner: 0 | 1 = rand(s) < p ? 0 : 1;
  const turns = 4 + Math.floor(rand(s) * 13);
  const reason = REASONS[Math.floor(rand(s) * REASONS.length)];
  return { winner, turns, reason, how: 'fast' };
}

/**
 * Play out a match between two AI entrants. Swiss matches can go to time: a match still level
 * after game two sometimes ends unfinished (a draw). Top cut matches always produce a winner.
 */
export function simMatch(s: RngState, m: LocalsMatch, a: LocalsEntrant, b: LocalsEntrant) {
  const top = m.stage === 'top';
  m.games = [];
  m.result = null;
  for (let guard = 0; guard < 8; guard++) {
    const out = matchOutcome(m.games, 3, top);
    if (out.result) {
      m.result = out.result;
      return m;
    }
    if (out.exhausted) break;
    if (!top && m.games.length === 2 && rand(s) < 0.07) {
      // time in round: game three unfinished after the five extra turns
      m.games.push({ winner: null, turns: 5, reason: 'Time called', how: 'fast' });
      m.time = true;
      m.result = 'draw';
      return m;
    }
    m.games.push(simGame(s, a, b));
  }
  m.result = ratingOf(a) + (rand(s) - 0.5) * 200 >= ratingOf(b) ? 'a' : 'b';
  return m;
}
