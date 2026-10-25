// Optional Elo-style ratings. Constructed: event matches plus ranked Duel vs AI. Limited: Draft
// (call recordLimitedResult from the draft flow). Every player starts at 1500; the K-factor
// shrinks as matches are played so a new rating moves quickly and then settles.
// AI duelists carry hidden ratings derived from their difficulty and skill.
import type { Difficulty } from '../ai/ai';
import { KEYS, load, save } from './storage';

export type RatingFormat = 'constructed' | 'limited';
export type MatchScore = 'W' | 'L' | 'D';

export interface RatingPoint {
  /** Timestamp. */
  t: number;
  /** Rating after the match. */
  r: number;
}

export interface RatingTrack {
  rating: number;
  peak: number;
  matches: number;
  w: number;
  l: number;
  d: number;
  /** Rating after each match, oldest first (capped). */
  history: RatingPoint[];
}

export interface RatingsState {
  version: 1;
  constructed: RatingTrack;
  limited: RatingTrack;
}

export interface RatingChange {
  format: RatingFormat;
  before: number;
  after: number;
  delta: number;
  opponent: number;
  k: number;
}

export const START_RATING = 1500;
const HISTORY_CAP = 300;

const freshTrack = (): RatingTrack => ({ rating: START_RATING, peak: START_RATING, matches: 0, w: 0, l: 0, d: 0, history: [] });

export function loadRatings(): RatingsState {
  const s = load<Partial<RatingsState>>(KEYS.ratings, {});
  const fix = (t?: Partial<RatingTrack>): RatingTrack => ({ ...freshTrack(), ...(t ?? {}), history: Array.isArray(t?.history) ? t!.history : [] });
  return { version: 1, constructed: fix(s.constructed), limited: fix(s.limited) };
}

/** K-factor by matches already played: 40 → 32 → 24 → 16. */
export function kFactor(matches: number) {
  return matches < 10 ? 40 : matches < 30 ? 32 : matches < 80 ? 24 : 16;
}

/** Elo expectation of A against B. */
export function expectedScore(a: number, b: number) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** Pure rating step (no storage). */
export function eloStep(rating: number, matches: number, opponent: number, score: MatchScore) {
  const k = kFactor(matches);
  const s = score === 'W' ? 1 : score === 'D' ? 0.5 : 0;
  const delta = Math.round(k * (s - expectedScore(rating, opponent)));
  return { k, delta, after: rating + delta };
}

function record(format: RatingFormat, opponent: number, score: MatchScore, when = Date.now()): RatingChange {
  const st = loadRatings();
  const t = st[format];
  const before = t.rating;
  const { k, delta, after } = eloStep(before, t.matches, opponent, score);
  t.rating = after;
  t.peak = Math.max(t.peak, after);
  t.matches++;
  if (score === 'W') t.w++;
  else if (score === 'L') t.l++;
  else t.d++;
  t.history.push({ t: when, r: after });
  if (t.history.length > HISTORY_CAP) t.history.splice(0, t.history.length - HISTORY_CAP);
  save(KEYS.ratings, st);
  return { format, before, after, delta, opponent, k };
}

/** A rated Constructed match: an event match, or Duel vs AI with Ranked on. */
export function recordConstructedResult(opponentRating: number, score: MatchScore, when?: number): RatingChange {
  return record('constructed', opponentRating, score, when);
}

/**
 * A rated Limited (Draft) match. Draft wiring: call this once per finished draft match with the
 * AI opponent's hidden rating (aiRating(difficulty)) and the match result from the human's side.
 */
export function recordLimitedResult(opponentRating: number, score: MatchScore, when?: number): RatingChange {
  return record('limited', opponentRating, score, when);
}

const DIFF_RATING: Record<Difficulty, number> = { easy: -180, normal: 0, hard: 150 };
const SKILL_SCALE = 2.2;

/** Hidden rating of an AI duelist from its difficulty and persona skill (Elo offset). */
export function aiRating(difficulty: Difficulty, skill = 0) {
  return Math.round(START_RATING + DIFF_RATING[difficulty] + skill * SKILL_SCALE);
}

/** The persona skill that gives an AI duelist a target hidden rating. */
export function skillForRating(rating: number, difficulty: Difficulty) {
  return Math.round((rating - START_RATING - DIFF_RATING[difficulty]) / SKILL_SCALE);
}

/** Display helper: "+12" / "−8" / "±0". */
export function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0';
}
