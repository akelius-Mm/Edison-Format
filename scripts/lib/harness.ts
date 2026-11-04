// Shared harness for the rules test scripts: a scriptable PlayerController, a game in Main Phase 1 with cards
// placed by hand, and a tiny test runner. Each script keeps only its own test cards and helpers.
import type { CardData, CardInstance } from '../../src/engine/card';
import type { Action, Activation, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../../src/engine/controller';
import { Game, GameOver } from '../../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../../src/engine/types';

/** A controller whose every decision a test can script. The defaults: pass, pick the minimum, say yes, first option. */
export class TestController implements PlayerController {
  isHuman = false;
  respond: (g: Game, req: ResponseRequest) => Activation | null = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  option: (req: OptionRequest) => number = () => 0;
  /** Answer to yes/no questions and optional triggers, unless `yes` / `trigger` say otherwise. */
  confirmAnswer = true;
  yes: (req: { prompt: string }) => boolean = () => this.confirmAnswer;
  trigger: (act: Activation, g: Game) => boolean = () => this.confirmAnswer;
  /** Names of the cards whose optional triggers this player was asked about. */
  triggersAsked: string[] = [];
  /** Attack this monster when it is a legal target. */
  aim: CardInstance | null = null;
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption(_g: Game, _p: PlayerId, req: OptionRequest) {
    return this.option(req);
  }
  async confirm(_g: Game, _p: PlayerId, req: { prompt: string }) {
    return this.yes(req);
  }
  async confirmTrigger(g: Game, _p: PlayerId, act: Activation) {
    this.triggersAsked.push(act.card.name);
    return this.trigger(act, g);
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    if (this.aim && targets.includes(this.aim)) return this.aim;
    return targets[0] ?? (canDirect ? null : 'cancel');
  }
}

let passed = 0;
let failed = 0;

/** Run one test. A console.error during it fails it; a GameOver passes it (the duel ended as the test drove it). */
export async function test(name: string, fn: () => Promise<void>) {
  const errs: string[] = [];
  const orig = console.error;
  console.error = (...a: any[]) => errs.push(a.join(' '));
  try {
    await fn();
    if (errs.length) throw new Error('console.error: ' + errs.join(' | '));
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    if (e instanceof GameOver) {
      passed++;
      console.log(`  ✓ ${name} (game over: ${e.reason})`);
    } else {
      failed++;
      console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
    }
  } finally {
    console.error = orig;
  }
}

export function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}

/** Print the totals and exit (1 if anything failed). */
export function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Put a card straight into a zone (no Summon, no events), ready to use this turn. */
export function placeCard(g: Game, p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) {
  const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
  c.location = 'none';
  g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? loc !== 'szone', pos: opts.pos ?? 'atk' });
  if (loc === 'szone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
  c.summonTurn = 0;
  if ((loc === 'szone' || loc === 'fzone') && c.faceUp) c.activeOnField = true;
  return c;
}

/** A game on turn 2, player 0's Main Phase 1, both Decks made of `filler`. */
export function newGame(filler: CardData, opts: { deckSize?: number; seed?: number } = {}) {
  const c0 = new TestController();
  const c1 = new TestController();
  const deck = () => ({ main: Array<CardData>(opts.deckSize ?? 20).fill(filler), extra: [] });
  const g = new Game([deck(), deck()], [c0, c1], { seed: opts.seed ?? 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, o: { faceUp?: boolean; pos?: BattlePos } = {}) => placeCard(g, p, data, loc, o);
  return { g, c0, c1, place };
}

/** Activate `card` (optionally the effect with `label`) as player `p`'s action; throws if it cannot be activated. */
export async function activate(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}

export const canActivate = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));

/** A responder that activates the offered card named `name`, if any. */
export const respondWith = (name: string) => (_g: Game, req: ResponseRequest) => req.options.find((o) => o.card.name === name) ?? null;
