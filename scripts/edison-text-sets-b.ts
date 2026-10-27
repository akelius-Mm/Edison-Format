// Edison-text (errata) sweep regression tests, group "sets-b": cards whose code followed modern (post-2010)
// wording or rulings instead of the text legal at SJC Edison (2010-04-24).
// Usage: npx tsx scripts/edison-text-sets-b.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureArchetypeExtrasPatches } from '../src/cards/sets/archetype-extras';

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

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
  const filler = (n: number): CardData[] => Array(n).fill(T.wall);
  const g = new Game([{ main: filler(20), extra: [] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  ensureArchetypeExtrasPatches(g);
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

/** Run `fn` right before the chain starts resolving (after every response). */
function beforeResolve(g: Game, fn: () => void) {
  const orig = (g as any).resolveChain.bind(g);
  (g as any).resolveChain = async (...a: any[]) => {
    fn();
    return orig(...a);
  };
}

const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;

async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}

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

(async () => {
  console.log('Edison-text tests: sets-b');

  const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);

  await test('Zombie Master (TAEV): cannot activate with no Level 4 or lower Zombie in a GY, even by discarding one', async () => {
    const { g, place } = setup();
    const zm = place(0, cardByName('Zombie Master'), 'mzone');
    place(0, cardByName('Goblin Zombie'), 'hand');
    eq(offered(g, 0, zm), false, 'the monster discarded for the cost does not count as a target');
    place(1, cardByName('Mezuki'), 'grave');
    eq(offered(g, 0, zm), true, 'offered once a target is in a GY');
  });

  await test('Zombie Master (TAEV): must be face-up to resolve (Book of Moon in response stops the revival)', async () => {
    for (const moon of [false, true]) {
      const { g, c0, c1, place } = setup();
      const zm = place(0, cardByName('Zombie Master'), 'mzone');
      const fodder = place(0, T.brute, 'hand');
      const target = place(0, cardByName('Goblin Zombie'), 'grave');
      c0.pick = (_g, req) => {
        const w = req.candidates.filter((c) => c === fodder || c === target);
        return w.length ? w.slice(0, 1) : req.candidates.slice(0, req.min);
      };
      if (moon) {
        place(1, cardByName('Book of Moon'), 'szone', { faceUp: false });
        c1.respond = respondWith('Book of Moon');
      }
      await activateCard(g, 0, zm);
      eq(fodder.location, 'grave', 'cost paid');
      eq(zm.faceUp, !moon, moon ? 'Zombie Master flipped face-down' : 'Zombie Master face-up');
      eq(target.location, moon ? 'grave' : 'mzone', moon ? 'no revival while face-down' : 'Goblin Zombie revived');
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
