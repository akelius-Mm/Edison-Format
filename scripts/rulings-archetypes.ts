// Rulings sweep regression tests: archetype files (tournament-extras*, deck-extras3, archetype-extras*, heroes,
// gladiators, blackwings, monarchs, lightsworn, zombies, sabers, teledad, plants).
// Usage: npx tsx scripts/rulings-archetypes.ts
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
  console.log('Rulings tests: archetypes');

  await test('Swap Frog: a Flip Summon triggers its "When this card is Summoned" send effect', async () => {
    const { g, place } = setup();
    const frog = place(0, cardByName('Swap Frog'), 'mzone', { faceUp: false, pos: 'def' });
    const toad = place(0, cardByName('Substitoad'), 'deck');
    await g.performAction(0, { type: 'flip', card: frog });
    eq(frog.faceUp, true, 'Swap Frog Flip Summoned');
    eq(toad.location, 'grave', 'Level 2 or lower WATER Aqua sent from the Deck');
  });

  await test("Gladiator Beast's Respite: the 2 cards are shuffled in on resolution, not as a cost", async () => {
    const { g, c1, place } = setup();
    const a = place(0, cardByName('Gladiator Beast Bestiari'), 'hand');
    const b = place(0, cardByName('Gladiator Beast Darius'), 'hand');
    const resp = place(0, cardByName("Gladiator Beast's Respite"), 'hand');
    let inHandOnChain = -1;
    void c1;
    beforeResolve(g, () => {
      if (inHandOnChain < 0) inHandOnChain = [a, b].filter((c) => c.location === 'hand').length;
    });
    const before = g.players[0].hand.length; // includes Respite
    await activateCard(g, 0, resp);
    eq(inHandOnChain, 2, 'both Gladiator Beasts still in hand while Respite is on the chain');
    eq(a.location, 'deck', 'Bestiari shuffled in');
    eq(b.location, 'deck', 'Darius shuffled in');
    eq(g.players[0].hand.length, before - 3 + 3, 'drew 3');
  });

  await test('Phantom of Chaos: the GY monster is targeted, banished on resolution; D.D. Crow in response stops the copy', async () => {
    for (const crow of [false, true]) {
      const { g, c1, place } = setup();
      const ph = place(0, cardByName('Phantom of Chaos'), 'mzone');
      const src = place(0, cardByName('Red-Eyes Darkness Metal Dragon'), 'grave');
      let srcOnChain: Location | undefined;
      if (crow) {
        place(1, cardByName('D.D. Crow'), 'hand');
        c1.respond = (gg, req) => {
          srcOnChain ??= src.location;
          return respondWith('D.D. Crow')(gg, req);
        };
      } else {
        beforeResolve(g, () => {
          srcOnChain ??= src.location;
        });
      }
      await activateCard(g, 0, ph);
      eq(srcOnChain, 'grave', 'still in the GY while the effect is on the chain (no cost)');
      eq(src.location, 'banished', 'banished either way');
      eq(ph.name, crow ? 'Phantom of Chaos' : 'Red-Eyes Darkness Metal Dragon', crow ? 'no copy after D.D. Crow' : 'copied');
    }
  });

  await test('Light and Darkness Dragon: GY effect is mandatory and still destroys your field with no monster to revive', async () => {
    const { g, place } = setup();
    const ladd = place(1, cardByName('Light and Darkness Dragon'), 'mzone');
    const mine = place(1, T.brute, 'mzone');
    await g.destroy([ladd], 'effect', 0);
    await g.processTriggers(true);
    eq(ladd.location, 'grave', 'LaDD destroyed');
    eq(mine.location, 'grave', 'its controller\'s other cards destroyed');
  });

  await test('Soul Taker: no LP gain for the opponent when the target is gone at resolution', async () => {
    const { g, c1, place } = setup();
    const v = place(1, T.brute, 'mzone');
    place(1, cardByName('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Book of Moon');
    await activateCard(g, 0, place(0, cardByName('Soul Taker'), 'hand'));
    eq(v.location, 'mzone', 'target survived (face-down)');
    eq(g.players[1].lp, 8000, 'no LP gained');
  });

  await test('Grandmaster of the Six Samurai: "When ... you can" misses the timing if not the last thing to happen', async () => {
    for (const miss of [false, true]) {
      const { g, place } = setup();
      const gm = place(0, cardByName('Grandmaster of the Six Samurai'), 'mzone');
      const sam = place(0, cardByName('The Six Samurai - Kamon'), 'grave');
      place(1, T.wall, 'deck');
      await g.destroy([gm], 'effect', 1);
      if (miss) await g.mill(1, 1, 'effect');
      await g.processTriggers(true);
      eq(gm.location, 'grave', 'Grandmaster destroyed');
      eq(sam.location, miss ? 'grave' : 'hand', miss ? 'missed the timing' : 'Six Samurai added');
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
