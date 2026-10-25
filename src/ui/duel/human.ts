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
    return this.ui.requestAction(p, actions);
  }
  chooseResponse(_g: Game, p: PlayerId, req: ResponseRequest) {
    return this.ui.requestResponse(p, req);
  }
  selectCards(_g: Game, p: PlayerId, req: SelectRequest) {
    return this.ui.requestSelect(p, req);
  }
  chooseOption(_g: Game, p: PlayerId, req: OptionRequest) {
    return this.ui.requestOption(p, req);
  }
  confirm(_g: Game, p: PlayerId, req: ConfirmRequest) {
    return this.ui.requestConfirm(p, req);
  }
  choosePosition(_g: Game, p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]) {
    if (allowed.length === 1) return Promise.resolve(allowed[0]);
    return this.ui.requestPosition(p, card, allowed);
  }
  chooseAttackTarget(_g: Game, p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return this.ui.requestAttackTarget(p, attacker, targets, canDirect);
  }
  confirmTrigger(_g: Game, p: PlayerId, act: Activation) {
    return this.ui.requestTrigger(p, act);
  }
  declareCard(_g: Game, p: PlayerId, prompt: string, names: string[]) {
    return this.ui.requestDeclare(p, prompt, names);
  }
}

export interface Pacer {
  /** Wait before an AI decision (scaled by speed; also yields to the UI and honours pause/abort). */
  pace(ms: number): Promise<void>;
}

export class PacedController implements PlayerController {
  readonly isHuman = false;
  constructor(
    private ai: PlayerController,
    private pacer: Pacer,
  ) {}

  async chooseAction(g: Game, p: PlayerId, actions: Action[]) {
    await this.pacer.pace(g.phase === 'battle' ? 380 : 330);
    const a = await this.ai.chooseAction(g, p, actions);
    return a;
  }
  async chooseResponse(g: Game, p: PlayerId, req: ResponseRequest) {
    await this.pacer.pace(0);
    const r = await this.ai.chooseResponse(g, p, req);
    if (r) await this.pacer.pace(260);
    return r;
  }
  async selectCards(g: Game, p: PlayerId, req: SelectRequest) {
    await this.pacer.pace(160);
    return this.ai.selectCards(g, p, req);
  }
  async chooseOption(g: Game, p: PlayerId, req: OptionRequest) {
    await this.pacer.pace(120);
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
    await this.pacer.pace(120);
    return this.ai.chooseAttackTarget(g, p, attacker, targets, canDirect);
  }
  async confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    await this.pacer.pace(0);
    return this.ai.confirmTrigger(g, p, act);
  }
  async declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    await this.pacer.pace(200);
    if (this.ai.declareCard) return this.ai.declareCard(g, p, prompt, names);
    return names[0];
  }
}
