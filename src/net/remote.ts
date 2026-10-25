// The friend's seat on this phone: answers each engine request with the next decision that
// arrived from the friend's phone, waiting for it when it has not arrived yet.
//
// Each entry is decoded with a one-entry RecordingController (engine/replay.ts), which checks the
// entry's kind and state digest against this board and maps card references back to cards.
// A mismatch means the two phones no longer play the same game: the game stops ("Out of sync").
import type { CardInstance } from '../engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../engine/controller';
import { GameOver, type Game } from '../engine/game';
import { RecordingController, ReplayMismatch, stateDigest, type Decision } from '../engine/replay';
import type { BattlePos, PlayerId } from '../engine/types';

export interface RemoteSource {
  /** The friend's decisions for this game so far (grows as entries arrive). */
  entries(): readonly Decision[];
  /** Waiting for the friend (true) or not any more (false). */
  onWaiting?(on: boolean): void;
  /** Entry `index` does not fit this board. */
  onMismatch(detail: string, index: number): void;
}

/** Never called: every request is answered from the entry. */
const NO_LIVE: PlayerController = new Proxy({ isHuman: true } as PlayerController, {
  get(t, k) {
    if (k === 'isHuman') return true;
    if (k in t) return (t as any)[k];
    return () => Promise.reject(new Error('remote entry exhausted'));
  },
});

export class RemoteController implements PlayerController {
  /** Both seats report human, exactly as on the friend's phone (card scripts branch on it). */
  readonly isHuman = true;
  /** Entries consumed so far. */
  next = 0;
  private failed: GameOver | null = null;
  private wake: (() => void) | null = null;
  private waiting = false;

  constructor(private src: RemoteSource) {}

  /** New entries arrived. */
  notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  /** End the game (surrender, the friend conceded, desync): a pending request rejects with `e`. */
  fail(e: GameOver) {
    this.failed ??= e;
    this.notify();
  }

  private async take(): Promise<{ d: Decision; n: number }> {
    for (;;) {
      if (this.failed) throw this.failed;
      const list = this.src.entries();
      if (this.next < list.length) {
        if (this.waiting) {
          this.waiting = false;
          this.src.onWaiting?.(false);
        }
        const n = this.next++;
        return { d: list[n], n };
      }
      if (!this.waiting) {
        this.waiting = true;
        this.src.onWaiting?.(true);
      }
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  private async answer<T>(game: Game, run: (rc: RecordingController) => Promise<T>): Promise<T> {
    const { d, n } = await this.take();
    const rc = new RecordingController(NO_LIVE, { replay: [d] });
    try {
      return await run(rc);
    } catch (e) {
      if (e instanceof ReplayMismatch || (e instanceof Error && e.message === 'remote entry exhausted')) {
        const detail = `entry ${n + 1} (${d.k}): ${(e as ReplayMismatch).detail?.replace(/^step \d+(?: \([a-z]+\))?: /, '') ?? e.message}; local state ${stateDigest(game)}`;
        this.src.onMismatch(detail, n);
        this.fail(new GameOver(null, 'Out of sync'));
        throw this.failed;
      }
      throw e;
    }
  }

  chooseAction(g: Game, p: PlayerId, a: Action[]) {
    return this.answer(g, (rc) => rc.chooseAction(g, p, a));
  }
  chooseResponse(g: Game, p: PlayerId, r: ResponseRequest) {
    return this.answer(g, (rc) => rc.chooseResponse(g, p, r));
  }
  selectCards(g: Game, p: PlayerId, r: SelectRequest) {
    return this.answer(g, (rc) => rc.selectCards(g, p, r));
  }
  chooseOption(g: Game, p: PlayerId, r: OptionRequest) {
    return this.answer(g, (rc) => rc.chooseOption(g, p, r));
  }
  confirm(g: Game, p: PlayerId, r: ConfirmRequest) {
    return this.answer(g, (rc) => rc.confirm(g, p, r));
  }
  choosePosition(g: Game, p: PlayerId, c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return this.answer(g, (rc) => rc.choosePosition(g, p, c, allowed));
  }
  chooseAttackTarget(g: Game, p: PlayerId, a: CardInstance, t: CardInstance[], d: boolean) {
    return this.answer(g, (rc) => rc.chooseAttackTarget(g, p, a, t, d));
  }
  confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    return this.answer(g, (rc) => rc.confirmTrigger(g, p, act));
  }
  declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    return this.answer(g, (rc) => rc.declareCard(g, p, prompt, names));
  }
}

/** An AI that reports human: drives the local seat in tests (card scripts branch on isHuman). */
export class AsHuman implements PlayerController {
  readonly isHuman = true;
  constructor(private ai: PlayerController) {}
  chooseAction(g: Game, p: PlayerId, a: Action[]) {
    return this.ai.chooseAction(g, p, a);
  }
  chooseResponse(g: Game, p: PlayerId, r: ResponseRequest) {
    return this.ai.chooseResponse(g, p, r);
  }
  selectCards(g: Game, p: PlayerId, r: SelectRequest) {
    return this.ai.selectCards(g, p, r);
  }
  chooseOption(g: Game, p: PlayerId, r: OptionRequest) {
    return this.ai.chooseOption(g, p, r);
  }
  confirm(g: Game, p: PlayerId, r: ConfirmRequest) {
    return this.ai.confirm(g, p, r);
  }
  choosePosition(g: Game, p: PlayerId, c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return this.ai.choosePosition(g, p, c, allowed);
  }
  chooseAttackTarget(g: Game, p: PlayerId, a: CardInstance, t: CardInstance[], d: boolean) {
    return this.ai.chooseAttackTarget(g, p, a, t, d);
  }
  confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    return this.ai.confirmTrigger(g, p, act);
  }
  async declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    return this.ai.declareCard ? this.ai.declareCard(g, p, prompt, names) : names[0];
  }
}
