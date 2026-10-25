// PlayerController implementations used by the duel screen:
//  - HumanController: every decision is a promise fulfilled by UI interaction.
//  - PacedController: wraps an AI so its decisions are paced for watching (and abortable).
import type { CardInstance } from '../../engine/card';
import type {
  Action,
  Activation,
  ConfirmRequest,
  OptionRequest,
  PlayerController,
  ResponseRequest,
  SelectRequest,
} from '../../engine/controller';
import type { Game } from '../../engine/game';
import type { BattlePos, PlayerId } from '../../engine/types';
import { perfTrace } from './fx';

/** Trace how long a decision waits on the player (perf-check only). */
function traced<T>(type: string, p: Promise<T>): Promise<T> {
  const tr = perfTrace();
  if (!tr) return p;
  const t0 = performance.now();
  const done = () => tr.push({ k: 'human', type, t0, t1: performance.now() });
  p.then(done, done);
  return p;
}

/** What the duel screen must provide to drive a human player. */
export interface HumanUI {
  requestAction(p: PlayerId, actions: Action[]): Promise<Action>;
  requestResponse(p: PlayerId, req: ResponseRequest): Promise<Activation | null>;
  requestSelect(p: PlayerId, req: SelectRequest): Promise<CardInstance[]>;
  requestOption(p: PlayerId, req: OptionRequest): Promise<number>;
  requestConfirm(p: PlayerId, req: ConfirmRequest): Promise<boolean>;
  requestPosition(p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]): Promise<BattlePos | 'set'>;
  requestAttackTarget(p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean): Promise<CardInstance | null | 'cancel'>;
  requestTrigger(p: PlayerId, act: Activation): Promise<boolean>;
  requestDeclare(p: PlayerId, prompt: string, names: string[]): Promise<string>;
}

export class HumanController implements PlayerController {
  readonly isHuman = true;
  constructor(private ui: HumanUI) {}

  chooseAction(_g: Game, p: PlayerId, actions: Action[]) {
    return traced('action', this.ui.requestAction(p, actions));
  }
  chooseResponse(_g: Game, p: PlayerId, req: ResponseRequest) {
    return traced('response', this.ui.requestResponse(p, req));
  }
  selectCards(_g: Game, p: PlayerId, req: SelectRequest) {
    return traced('select', this.ui.requestSelect(p, req));
  }
  chooseOption(_g: Game, p: PlayerId, req: OptionRequest) {
    return traced('option', this.ui.requestOption(p, req));
  }
  confirm(_g: Game, p: PlayerId, req: ConfirmRequest) {
    return traced('confirm', this.ui.requestConfirm(p, req));
  }
  choosePosition(_g: Game, p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]) {
    if (allowed.length === 1) return Promise.resolve(allowed[0]);
    return traced('position', this.ui.requestPosition(p, card, allowed));
  }
  chooseAttackTarget(_g: Game, p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return traced('attackTarget', this.ui.requestAttackTarget(p, attacker, targets, canDirect));
  }
  confirmTrigger(_g: Game, p: PlayerId, act: Activation) {
    return traced('trigger', this.ui.requestTrigger(p, act));
  }
  declareCard(_g: Game, p: PlayerId, prompt: string, names: string[]) {
    return traced('declare', this.ui.requestDeclare(p, prompt, names));
  }
}

export interface Pacer {
  /** Wait before an AI decision (scaled by speed; also yields to the UI and honours pause/abort). */
  pace(ms: number): Promise<void>;
}

export class PacedController implements PlayerController {
  readonly isHuman = false;
  private pacer: Pacer;
  constructor(
    private ai: PlayerController,
    pacer: Pacer,
  ) {
    this.pacer = {
      pace: async (ms) => {
        const tr = perfTrace();
        if (!tr) return pacer.pace(ms);
        const t0 = performance.now();
        try {
          await pacer.pace(ms);
        } finally {
          tr.push({ k: 'pace', ms, t0, t1: performance.now() });
        }
      },
    };
  }

  async chooseAction(g: Game, p: PlayerId, actions: Action[]) {
    await this.pacer.pace(g.phase === 'battle' ? 170 : 140);
    const a = await this.ai.chooseAction(g, p, actions);
    return a;
  }
  async chooseResponse(g: Game, p: PlayerId, req: ResponseRequest) {
    await this.pacer.pace(0);
    const r = await this.ai.chooseResponse(g, p, req);
    if (r) await this.pacer.pace(150);
    return r;
  }
  async selectCards(g: Game, p: PlayerId, req: SelectRequest) {
    await this.pacer.pace(100);
    return this.ai.selectCards(g, p, req);
  }
  async chooseOption(g: Game, p: PlayerId, req: OptionRequest) {
    await this.pacer.pace(80);
    return this.ai.chooseOption(g, p, req);
  }
  async confirm(g: Game, p: PlayerId, req: ConfirmRequest) {
    await this.pacer.pace(0);
    return this.ai.confirm(g, p, req);
  }
  async choosePosition(g: Game, p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]) {
    await this.pacer.pace(0);
    return this.ai.choosePosition(g, p, card, allowed);
  }
  async chooseAttackTarget(g: Game, p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean) {
    await this.pacer.pace(80);
    return this.ai.chooseAttackTarget(g, p, attacker, targets, canDirect);
  }
  async confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    await this.pacer.pace(0);
    return this.ai.confirmTrigger(g, p, act);
  }
  async declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    await this.pacer.pace(140);
    if (this.ai.declareCard) return this.ai.declareCard(g, p, prompt, names);
    return names[0];
  }
}
