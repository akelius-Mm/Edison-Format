// Edison-text (errata) regression tests for the "staples" card files: each card follows its April 2010 printing.
// Usage: npx tsx scripts/edison-text-staples.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption() {
    return 0;
  }
  async confirm() {
    return true;
  }
  async confirmTrigger() {
    return true;
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return targets[0] ?? (canDirect ? null : 'cancel');
  }
}

function filler(n: number): CardData[] {
  return Array(n).fill(T.wall);
}

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
  const g = new Game([{ main: filler(20), extra: [] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? loc !== 'szone', pos: opts.pos ?? 'atk' });
    if (loc === 'szone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
    c.summonTurn = 0;
    return c;
  };
  return { g, c0, c1, place };
}

const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;
const N = (n: string) => cardByName(n);

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void>) {
  const errs: string[] = [];
  const orig = console.error;
  console.error = (...a: any[]) => errs.push(a.join(' '));
  try {
    await fn();
    if (errs.length) throw new Error('console.error: ' + errs.join(' | '));
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    if (e instanceof GameOver) {
      pass++;
      console.log(`  ✓ ${name} (game over: ${e.reason})`);
    } else {
      fail++;
      console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
    }
  } finally {
    console.error = orig;
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}

async function activate(g: Game, p: PlayerId, card: CardInstance, effectIndex?: number) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (effectIndex === undefined || a.effectIndex === effectIndex));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}

(async () => {
  console.log('Edison text: staples');

  // Brionac, 2010 ruling: can be activated multiple times per turn (https://edisonrul.ing/cards/b/brionac-dragon-of-the-ice-barrier.html)
  await test('Brionac: no once-per-turn limit (2010 ruling)', async () => {
    const { g, c0, place } = setup();
    c0.pick = (_g, req) => {
      const opp = req.candidates.filter((c) => c.controller === 1);
      return opp.length ? opp.slice(0, req.min) : req.candidates.slice(0, req.min);
    };
    const b1 = place(0, N('Brionac, Dragon of the Ice Barrier'), 'mzone');
    const b2 = place(0, N('Brionac, Dragon of the Ice Barrier'), 'mzone');
    place(0, T.brute, 'hand');
    place(0, T.brute, 'hand');
    place(1, T.wall, 'mzone');
    place(1, T.wall, 'mzone');
    await activate(g, 0, b1);
    eq(g.monsters(1).length, 1, 'first Brionac bounced 1');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === b1), true, 'the same copy can activate again');
    await activate(g, 0, b1);
    eq(g.monsters(1).length, 0, 'the same Brionac bounced the other');
    void b2;
  });

  // Drill Warrior: "Once per turn" on each effect is per copy, not shared by name.
  await test('Drill Warrior: a second copy can still use its effects after the first used them', async () => {
    const { g, place } = setup();
    const d1 = place(0, N('Drill Warrior'), 'mzone');
    const d2 = place(0, N('Drill Warrior'), 'mzone');
    place(1, T.wall, 'mzone');
    const halve = (c: CardInstance) => g.getActivations(0, { open: true }).find((a) => a.card === c && a.effectIndex === 0);
    await activate(g, 0, d1, 0);
    eq(halve(d1), undefined, 'first copy used');
    eq(!!halve(d2), true, 'second copy still available');
    await activate(g, 0, d2, 0);
    eq(g.getAtk(d2), 1200, 'second copy halved');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
