// Deterministic record / replay of one player's decisions.
//
// A Game is fully determined by its seed, the two deck lists, the options, the AI seeds and the
// sequence of decisions the human makes. RecordingController wraps the human's controller: live, it
// forwards every request to the wrapped controller and appends the answer to a JSON-serialisable
// log; given a log, it first answers requests from the log (instantly, no UI) and hands over to
// the wrapped controller once the log is used up. Every entry also carries a small digest of the
// game state at the moment of the request, so a replay that drifts is detected at the first
// decision that differs instead of silently producing a different board.
//
// Cards are referenced by their index in game.allCards (registration order), which is stable for
// the same seed, decks and decisions. CardInstance.uid is a process-wide counter, so it differs
// between page loads and must not be stored.
import type { CardInstance } from './card';
import type {
  Action,
  Activation,
  ConfirmRequest,
  OptionRequest,
  PlayerController,
  ResponseRequest,
  SelectRequest,
} from './controller';
import { GameOver, type Game } from './game';
import type { BattlePos, PlayerId } from './types';

/** One recorded decision. `h` is the state digest at the time the decision was requested. */
export type Decision =
  /** Main action: index into the offered actions, plus its type / card for validation. */
  | { k: 'act'; i: number; t: Action['type']; c?: number; to?: string; h: string }
  /** Response window: index into the offered activations, or -1 to pass. */
  | { k: 'resp'; i: number; c?: number; e?: number; h: string }
  /** Selected cards (allCards indices), in the order chosen. */
  | { k: 'sel'; c: number[]; h: string }
  /** Option index. */
  | { k: 'opt'; i: number; h: string }
  /** Yes / no confirmation. */
  | { k: 'yes'; v: boolean; h: string }
  /** Battle position. */
  | { k: 'pos'; v: BattlePos | 'set'; h: string }
  /** Attack target: a card, null for a direct attack, 'cancel' to stop. */
  | { k: 'atk'; c: number | null | 'cancel'; h: string }
  /** Optional trigger: activate or skip. */
  | { k: 'trg'; v: boolean; c: number; h: string }
  /** Declared card name. */
  | { k: 'name'; v: string; h: string };

export type DecisionKind = Decision['k'];

/** Thrown into the engine when a recorded decision cannot be applied (ends the game). */
export class ReplayMismatch extends GameOver {
  constructor(public detail: string) {
    super(null, 'Restore failed');
  }
}

/** Stable reference to a card within one game. */
export function cardRef(game: Game, c: CardInstance): number {
  return game.allCards.indexOf(c);
}

export function cardAt(game: Game, ref: number): CardInstance | undefined {
  return game.allCards[ref];
}

/** Compact digest of the public game state, compared on replay. */
export function stateDigest(game: Game): string {
  const [a, b] = game.players;
  const f = (p: typeof a) => p.mzone.filter(Boolean).length + p.szone.filter(Boolean).length * 10 + (p.fzone ? 100 : 0);
  return [
    game.turn,
    game.phase,
    game.turnPlayer,
    a.lp,
    b.lp,
    a.hand.length,
    b.hand.length,
    a.deck.length,
    b.deck.length,
    a.grave.length,
    b.grave.length,
    f(a),
    f(b),
    game.chain.length,
  ].join('.');
}

export interface RecordingOptions {
  /** Decisions to replay before handing over to the wrapped controller. */
  replay?: Decision[];
  /** Called after every live decision with the complete log so far. */
  onDecision?: (log: Decision[], game: Game) => void;
  /** Called once when the replay log is used up (before the first live request). */
  onReplayEnd?: () => void;
  /** Called when a recorded decision does not fit the game (the game then ends). */
  onMismatch?: (detail: string) => void;
  /**
   * Called when a decision is requested, replayed or live, before it is answered. `index` is the
   * position the decision will take in the log (engine/undo.ts marks its undo points here).
   */
  onRequest?: (kind: DecisionKind, game: Game, index: number) => void;
}

export class RecordingController implements PlayerController {
  readonly isHuman: boolean;
  /** Every decision so far (replayed ones first). */
  readonly log: Decision[] = [];
  private queue: Decision[];
  private ended = false;
  /** Set when replay failed; the reason. */
  mismatch: string | null = null;

  constructor(
    private inner: PlayerController,
    private o: RecordingOptions = {},
  ) {
    this.isHuman = inner.isHuman;
    this.queue = [...(o.replay ?? [])];
    if (!this.queue.length) this.ended = true;
  }

  get replaying() {
    return this.queue.length > 0;
  }

  /** Next recorded decision of kind `k`, or null when live. Throws on mismatch. */
  private next<K extends DecisionKind>(game: Game, k: K): Extract<Decision, { k: K }> | null {
    if (this.mismatch) throw new ReplayMismatch(this.mismatch);
    this.o.onRequest?.(k, game, this.log.length);
    if (!this.queue.length) {
      if (!this.ended) {
        this.ended = true;
        this.o.onReplayEnd?.();
      }
      return null;
    }
    const d = this.queue.shift()!;
    if (d.k !== k) this.fail(`step ${this.log.length + 1}: expected a ${k} decision, log has ${d.k}`);
    const h = stateDigest(game);
    if (d.h !== h) this.fail(`step ${this.log.length + 1} (${k}): state ${h} differs from recorded ${d.h}`);
    return d as Extract<Decision, { k: K }>;
  }

  private fail(detail: string): never {
    this.mismatch = detail;
    this.queue = [];
    this.ended = true;
    this.o.onMismatch?.(detail);
    throw new ReplayMismatch(detail);
  }

  private push(game: Game, d: Decision, replayed: boolean) {
    this.log.push(d);
    if (!replayed) this.o.onDecision?.(this.log, game);
  }

  async chooseAction(game: Game, p: PlayerId, actions: Action[]): Promise<Action> {
    const r = this.next(game, 'act');
    if (r) {
      let a = actions[r.i];
      const fits = (x: Action | undefined) =>
        !!x && x.type === r.t && (x.type === 'phase' ? x.to === r.to : x.type === 'surrender' || cardRef(game, x.card) === r.c);
      if (!fits(a)) a = actions.find(fits) as Action;
      if (!fits(a)) this.fail(`step ${this.log.length + 1}: action ${r.t} #${r.i} is not available`);
      this.push(game, r, true);
      return a;
    }
    const h = stateDigest(game);
    const a = await this.inner.chooseAction(game, p, actions);
    let i = actions.indexOf(a);
    if (i < 0) i = actions.findIndex((x) => x.type === a.type && ('card' in x && 'card' in a ? x.card === a.card : x.type !== 'phase' || (a.type === 'phase' && x.to === a.to)));
    const d: Decision = { k: 'act', i, t: a.type, h };
    if (a.type === 'phase') d.to = a.to;
    else if (a.type !== 'surrender') d.c = cardRef(game, a.card);
    this.push(game, d, false);
    return a;
  }

  async chooseResponse(game: Game, p: PlayerId, req: ResponseRequest): Promise<Activation | null> {
    const r = this.next(game, 'resp');
    if (r) {
      if (r.i < 0) {
        this.push(game, r, true);
        return null;
      }
      let o = req.options[r.i];
      const fits = (x: Activation | undefined) => !!x && cardRef(game, x.card) === r.c && x.effectIndex === r.e;
      if (!fits(o)) o = req.options.find(fits) as Activation;
      if (!fits(o)) this.fail(`step ${this.log.length + 1}: response #${r.i} is not available`);
      this.push(game, r, true);
      return o;
    }
    const h = stateDigest(game);
    const o = await this.inner.chooseResponse(game, p, req);
    const d: Decision = o ? { k: 'resp', i: req.options.indexOf(o), c: cardRef(game, o.card), e: o.effectIndex, h } : { k: 'resp', i: -1, h };
    this.push(game, d, false);
    return o;
  }

  async selectCards(game: Game, p: PlayerId, req: SelectRequest): Promise<CardInstance[]> {
    const r = this.next(game, 'sel');
    if (r) {
      const picks = r.c.map((ref) => cardAt(game, ref));
      if (picks.some((c) => !c || !req.candidates.includes(c))) this.fail(`step ${this.log.length + 1}: selected card is not a candidate`);
      this.push(game, r, true);
      return picks as CardInstance[];
    }
    const h = stateDigest(game);
    const picks = await this.inner.selectCards(game, p, req);
    this.push(game, { k: 'sel', c: picks.map((c) => cardRef(game, c)), h }, false);
    return picks;
  }

  async chooseOption(game: Game, p: PlayerId, req: OptionRequest): Promise<number> {
    const r = this.next(game, 'opt');
    if (r) {
      if (!(r.i >= 0 && r.i < req.options.length)) this.fail(`step ${this.log.length + 1}: option ${r.i} out of range`);
      this.push(game, r, true);
      return r.i;
    }
    const h = stateDigest(game);
    const i = await this.inner.chooseOption(game, p, req);
    this.push(game, { k: 'opt', i, h }, false);
    return i;
  }

  async confirm(game: Game, p: PlayerId, req: ConfirmRequest): Promise<boolean> {
    const r = this.next(game, 'yes');
    if (r) {
      this.push(game, r, true);
      return r.v;
    }
    const h = stateDigest(game);
    const v = await this.inner.confirm(game, p, req);
    this.push(game, { k: 'yes', v, h }, false);
    return v;
  }

  async choosePosition(game: Game, p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]): Promise<BattlePos | 'set'> {
    const r = this.next(game, 'pos');
    if (r) {
      if (!allowed.includes(r.v)) this.fail(`step ${this.log.length + 1}: position ${r.v} not allowed`);
      this.push(game, r, true);
      return r.v;
    }
    const h = stateDigest(game);
    const v = await this.inner.choosePosition(game, p, card, allowed);
    this.push(game, { k: 'pos', v, h }, false);
    return v;
  }

  async chooseAttackTarget(game: Game, p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean): Promise<CardInstance | null | 'cancel'> {
    const r = this.next(game, 'atk');
    if (r) {
      let v: CardInstance | null | 'cancel';
      if (r.c === 'cancel') v = 'cancel';
      else if (r.c === null) {
        if (!canDirect) this.fail(`step ${this.log.length + 1}: direct attack not allowed`);
        v = null;
      } else {
        const c = cardAt(game, r.c);
        if (!c || !targets.includes(c)) this.fail(`step ${this.log.length + 1}: attack target not available`);
        v = c;
      }
      this.push(game, r, true);
      return v;
    }
    const h = stateDigest(game);
    const v = await this.inner.chooseAttackTarget(game, p, attacker, targets, canDirect);
    this.push(game, { k: 'atk', c: v === 'cancel' || v === null ? v : cardRef(game, v), h }, false);
    return v;
  }

  async confirmTrigger(game: Game, p: PlayerId, act: Activation): Promise<boolean> {
    const r = this.next(game, 'trg');
    if (r) {
      if (r.c !== cardRef(game, act.card)) this.fail(`step ${this.log.length + 1}: trigger for a different card`);
      this.push(game, r, true);
      return r.v;
    }
    const h = stateDigest(game);
    const v = await this.inner.confirmTrigger(game, p, act);
    this.push(game, { k: 'trg', v, c: cardRef(game, act.card), h }, false);
    return v;
  }

  async declareCard(game: Game, p: PlayerId, prompt: string, names: string[]): Promise<string> {
    const r = this.next(game, 'name');
    if (r) {
      if (!names.includes(r.v)) this.fail(`step ${this.log.length + 1}: name ${r.v} not declarable`);
      this.push(game, r, true);
      return r.v;
    }
    const h = stateDigest(game);
    const v = this.inner.declareCard ? await this.inner.declareCard(game, p, prompt, names) : names[0];
    this.push(game, { k: 'name', v, h }, false);
    return v;
  }
}
