// Contract between the app shell (menus/tournament) and the duel screen.
import type { Difficulty } from '../../ai/ai';
import type { PlayerController } from '../../engine/controller';
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
  /**
   * Offer Undo for misclicks (engine/undo.ts). Only honoured in a human-vs-AI duel: never with a
   * `remote` seat, spectating, or two humans. An undo rebuilds the duel from its seed and the log
   * minus the undone decisions and reports the shortened log through `onDecision`.
   */
  allowUndo?: boolean;
  /** @internal Set by startDuel when rebuilding after an undo: the previous screen, kept on top until the rebuild is shown. */
  undoCover?: HTMLElement;

  // ---- Play a friend (src/net, src/ui/screens/friend.ts) ---------------------------------
  /** Controller for the seat that is not 'human' in place of an AI: the friend's phone. */
  remote?: PlayerController;
  /** Test hook: answers the local human's decisions (still recorded) instead of taps. */
  localDriver?: PlayerController;
  /** Called once the screen is built: lets the caller end the game and decorate the board. */
  onMount?: (ctl: DuelControl) => void;
  /**
   * Friends Locals spectating: both seats are played from the network (the two players' decision
   * logs); the board shows public information only. With `catchUp` the decisions already made are
   * fed instantly behind a "Catching up" cover until the caller calls `endCatchUp()`.
   */
  spectate?: { controllers: [PlayerController, PlayerController]; catchUp?: boolean };
  /** Overrides the result screen title (e.g. "Out of sync"). */
  resultTitle?: (res: { winner: PlayerId | null; reason: string }) => string | undefined;
}

export interface DuelControl {
  game: Game;
  root: HTMLElement;
  /** The seat this phone plays. */
  me: PlayerId;
  /** End the game now with this result (the friend conceded, a desync, a claimed win). */
  abort(winner: PlayerId | null, reason: string): void;
  /** Leave without deciding the game (the duel stays saved): the duel resolves with `left`. */
  leave(): void;
  /** Called whenever the game is ended from outside the engine, including the player surrendering. */
  onAbort(fn: (winner: PlayerId | null, reason: string) => void): void;
  /** The duel is replaying saved decisions (no animation yet). */
  readonly restoring: boolean;
  /** Spectating: the stream caught up with the live game; start showing it. */
  endCatchUp(): void;
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
