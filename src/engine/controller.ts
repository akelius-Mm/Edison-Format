import type { CardInstance, EffectDef } from './card';
import type { Game } from './game';
import type { BattlePos, GameEvent, Phase, PlayerId } from './types';

/** An effect the player could activate right now. */
export interface Activation {
  card: CardInstance;
  effect: EffectDef;
  effectIndex: number;
  label: string;
  /** Event that makes this activation legal (for responses). */
  event?: GameEvent;
}

export type Action =
  | { type: 'summon'; card: CardInstance }
  | { type: 'set'; card: CardInstance }
  | { type: 'flip'; card: CardInstance }
  | { type: 'position'; card: CardInstance }
  | { type: 'setST'; card: CardInstance }
  | { type: 'activate'; card: CardInstance; act: Activation }
  | { type: 'proc'; card: CardInstance; act: Activation }
  | { type: 'synchro'; card: CardInstance }
  | { type: 'attack'; card: CardInstance }
  | { type: 'phase'; to: Phase }
  | { type: 'surrender' };

export type SelectPurpose =
  | 'destroy'
  | 'banish'
  | 'toHand' // add own card to hand (search / salvage)
  | 'bounce' // return opponent's card to hand
  | 'specialSummon'
  | 'tribute'
  | 'discard'
  | 'cost'
  | 'target'
  | 'material'
  | 'toGrave'
  | 'toDeck'
  | 'equip'
  | 'control'
  | 'negate'
  | 'position'
  | 'buff'
  | 'generic';

export interface SelectRequest {
  prompt: string;
  candidates: CardInstance[];
  min: number;
  max: number;
  purpose: SelectPurpose;
  /** If true the player may choose nothing even when min > 0 (cancel). */
  cancelable?: boolean;
  /** Optional AI scorer: higher = more desirable to pick. */
  aiScore?: (c: CardInstance) => number;
  /** Source card (for UI). */
  source?: CardInstance;
}

export interface OptionRequest {
  prompt: string;
  options: string[];
  source?: CardInstance;
  /** AI hint: preferred option index scorer. */
  aiScore?: (i: number) => number;
}

export interface ConfirmRequest {
  prompt: string;
  source?: CardInstance;
  /** Default for AI. */
  aiDefault?: boolean;
}

export type WindowKind =
  | 'chain' // responding to a chain link
  | 'response' // after something happened (summon etc.)
  | 'priority' // the turn player's priority right after their own summon (2010 rule): Spell Speed 1 effects of that monster first
  | 'summonNegation'
  | 'attack' // attack declaration
  | 'damage' // damage step
  | 'phase'; // phase transition / open state for the non-turn player

export interface ResponseRequest {
  kind: WindowKind;
  options: Activation[];
  /** Human readable description of what's being responded to. */
  prompt: string;
}

export interface PlayerController {
  readonly isHuman: boolean;
  chooseAction(game: Game, player: PlayerId, actions: Action[]): Promise<Action>;
  chooseResponse(game: Game, player: PlayerId, req: ResponseRequest): Promise<Activation | null>;
  selectCards(game: Game, player: PlayerId, req: SelectRequest): Promise<CardInstance[]>;
  chooseOption(game: Game, player: PlayerId, req: OptionRequest): Promise<number>;
  confirm(game: Game, player: PlayerId, req: ConfirmRequest): Promise<boolean>;
  choosePosition(
    game: Game,
    player: PlayerId,
    card: CardInstance,
    allowed: (BattlePos | 'set')[],
  ): Promise<BattlePos | 'set'>;
  chooseAttackTarget(
    game: Game,
    player: PlayerId,
    attacker: CardInstance,
    targets: CardInstance[],
    canDirect: boolean,
  ): Promise<CardInstance | null | 'cancel'>;
  /** Choose order/which optional triggers: called per optional trigger. */
  confirmTrigger(game: Game, player: PlayerId, act: Activation): Promise<boolean>;
  /**
   * Order the player's own simultaneous triggers of one SEGOC group (2+ different effects that will all be activated).
   * Returns the same activations in the order they go on the Chain: the first becomes the lowest Chain Link, the last
   * one resolves first. Optional: a controller without it keeps the order given (Official Rulebook v7.0 p.43,
   * https://www.edisonformat.com/rulebook.html).
   */
  chooseTriggerOrder?(game: Game, player: PlayerId, acts: Activation[]): Promise<Activation[]>;
  /** Declare a card name (Mind Crush etc.). */
  declareCard?(game: Game, player: PlayerId, prompt: string, names: string[]): Promise<string>;
}
