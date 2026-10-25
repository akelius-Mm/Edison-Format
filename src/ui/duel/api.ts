// Contract between the app shell (menus/tournament) and the duel screen.
import type { Difficulty } from '../../ai/ai';
import type { DeckList } from '../../engine/game';
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
  /** Who goes first; 'coin' = random. */
  firstPlayer?: PlayerId | 'coin';
  seed?: number;
  /** Header text, e.g. "Game 2 of 3". */
  caption?: string;
  /** Allow surrendering (always true for humans). */
  allowSurrender?: boolean;
}

export interface DuelResult {
  winner: PlayerId | null;
  reason: string;
  turns: number;
  surrendered?: boolean;
}

/**
 * Mount a duel into `container`, run it to completion and resolve with the result.
 * Implemented in ./duelScreen.ts.
 */
export type StartDuel = (container: HTMLElement, opts: DuelOptions) => Promise<DuelResult>;
