// Contract between the app shell (menus/tournament) and the duel screen.
import type { Difficulty } from '../../ai/ai';
import type { DeckList, Game } from '../../engine/game';
import type { Decision } from '../../engine/replay';
import type { PlayerId } from '../../engine/types';

export interface DuelSide {
  name: string;
  deck: DeckList;
  /** Avatar id / seed. */
  avatar: string;
  /** Sleeve id from SLEEVES. */
  sleeve: string;
  /** 'human' or an AI difficulty. */
  control: 'human' | Difficulty;
  /** Optional title shown under the name (e.g. "Tournament – Round 2"). */
  title?: string;
}

export interface DuelOptions {
  /** Index 0 is the bottom side of the screen (the human, or spectated AI). */
  sides: [DuelSide, DuelSide];
  playmat: string;
  /** The opponent's own mat (top half). Defaults to a different mat picked from the opponent's name. */
  oppPlaymat?: string;
  /** Who goes first; 'coin' = random. */
  firstPlayer?: PlayerId | 'coin';
  seed?: number;
  /** Header text, e.g. "Game 2 of 3". */
  caption?: string;
  /** Allow surrendering (always true for humans). */
  allowSurrender?: boolean;
  /** Overrides the "first player skips draw" setting (a resumed duel keeps the rule it started with). */
  skipFirstDraw?: boolean;
  /**
   * Resume support. `replay` holds the human's recorded decisions: they are fed back instantly
   * (no animation or sound) and the live board takes over when they run out.
   */
  replay?: Decision[];
  /** Called after every live human decision with the full decision log. */
  onDecision?: (log: Decision[], game: Game) => void;
  /** Called when the game is decided (before the result screen), not when the player leaves. */
  onGameOver?: (result: DuelResult) => void;
  /** The duel is saved: the exit button offers "Leave and save" next to "Concede". */
  resumable?: boolean;
}

export interface DuelResult {
  winner: PlayerId | null;
  reason: string;
  turns: number;
  surrendered?: boolean;
  /** The player left with "Leave and save": the duel was not decided and stays resumable. */
  left?: boolean;
  /** Replaying the saved decisions did not reproduce the game (nothing was decided). */
  restoreFailed?: boolean;
  /** Card ids each player showed: face-up on the field, in the Graveyard or banished at the end. */
  seen?: [string[], string[]];
}

/**
 * Mount a duel into `container`, run it to completion and resolve with the result.
 * Implemented in ./duelScreen.ts.
 */
export type StartDuel = (container: HTMLElement, opts: DuelOptions) => Promise<DuelResult>;
