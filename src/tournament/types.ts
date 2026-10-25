import type { Difficulty } from '../ai/ai';

export type SimMode = 'fast' | 'full';
export type DifficultyMix = Difficulty | 'mixed';
export type Entry = [string, number];

export interface DeckSnapshot {
  /** Premade deck id, or 'custom:<id>' for the human's custom deck. */
  id: string;
  name: string;
  archetype: string;
  tier: 1 | 2 | 3;
  color: string;
  main: Entry[];
  extra: Entry[];
  /** Side Deck (missing in snapshots saved before siding: looked up by id). */
  side?: Entry[];
}

export interface Entrant {
  id: string;
  name: string;
  avatar: string;
  sleeve: string;
  /** Flavour title, e.g. "Regional Finalist". */
  title: string;
  deck: DeckSnapshot;
  difficulty: Difficulty;
  /** Persona skill rating offset (Elo points) used by the fast simulation. */
  skill: number;
  human: boolean;
  /** Seed position (random tiebreak of last resort). */
  seed: number;
}

export interface GameResult {
  /** 0 = player A of the match, 1 = player B, null = draw. */
  winner: 0 | 1 | null;
  turns: number;
  reason: string;
  how: 'human' | 'fast' | 'full' | 'fallback';
}

export interface Match {
  id: string;
  stage: 'swiss' | 'top';
  /** Swiss round number (1-based) or top-cut round index (1-based). */
  round: number;
  table: number;
  a: string;
  /** null = bye. */
  b: string | null;
  games: GameResult[];
  result: 'a' | 'b' | 'draw' | null;
  /** Human-readable label, e.g. "Quarterfinal". */
  label: string;
}

export type Phase = 'lobby' | 'swiss' | 'top' | 'done';

export interface Tournament {
  version: 1;
  id: string;
  name: string;
  created: number;
  size: 8 | 16 | 32;
  bestOf: 1 | 3;
  simMode: SimMode;
  difficultyMix: DifficultyMix;
  entrants: Entrant[];
  humanId: string;
  swissRounds: number;
  topCut: 4 | 8;
  rounds: Match[][];
  top: Match[][];
  phase: Phase;
  /** Entrant ids in final order (index 0 = champion). */
  placements?: string[];
  /** History written to the profile. */
  recorded?: boolean;
}

export interface Standing {
  id: string;
  rank: number;
  mp: number;
  w: number;
  l: number;
  d: number;
  byes: number;
  gw: number;
  gl: number;
  gd: number;
  mwp: number;
  omw: number;
  gwp: number;
  ogw: number;
  opponents: string[];
}
