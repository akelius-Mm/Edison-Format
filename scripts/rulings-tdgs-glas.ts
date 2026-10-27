// Rulings regression tests for The Duelist Genesis (tdgs.ts) and Gladiator's Assault (glas.ts).
// Usage: npx tsx scripts/rulings-tdgs-glas.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureTdgsPatches } from '../src/cards/sets/tdgs';
import { ensureGlasPatches } from '../src/cards/sets/glas';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  mite: findCard('Rulings Test Mite') ?? normal('Rulings Test Mite', 'EARTH', 'Insect', 1, 300, 300),
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
  const g = new Game([{ main: Array(20).fill(T.wall), extra: [] }, { main: Array(20).fill(T.wall), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  ensureTdgsPatches(g);
  ensureGlasPatches(g);
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
const live = (c: CardInstance) => {
  c.activeOnField = true;
  return c;
};

async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);

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
  console.log('Rulings tests: TDGS / GLAS');

  // Disarm / Parry: "negate the activation ... of a Spell/Trap Card" — card activations only.
  await test('Disarm cannot negate the effect of a face-up Continuous Spell (Summon Cloud), only a Spell activation', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Disarm'), 'szone', { faceUp: false });
    place(0, cardByName('Gladiator Beast Secutor'), 'hand');
    const cloud = live(place(1, cardByName('Summon Cloud'), 'szone', { faceUp: true }));
    const acid = place(1, cardByName('Cloudian - Acid Cloud'), 'hand');
    g.turnPlayer = 1;
    let disarmOffered = false;
    c0.respond = (_g, req) => {
      if (req.options.some((o) => o.card.name === 'Disarm')) disarmOffered = true;
      return null;
    };
    await activateCard(g, 1, cloud);
    eq(disarmOffered, false, 'Disarm offered against a Continuous Spell effect');
    eq(acid.location, 'mzone', 'Summon Cloud effect resolved');
  });

  await test('Parry cannot negate the effect of a face-up Continuous Trap (Spacegate), only a Trap activation', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Parry'), 'szone', { faceUp: false });
    place(0, cardByName('Gladiator Beast Secutor'), 'hand');
    const gate = live(place(1, cardByName('Spacegate'), 'szone', { faceUp: true }));
    gate.counters.gate = 4;
    const m = place(1, T.brute, 'hand');
    g.turnPlayer = 1;
    let parryOffered = false;
    c0.respond = (_g, req) => {
      if (req.options.some((o) => o.card.name === 'Parry')) parryOffered = true;
      return null;
    };
    await activateCard(g, 1, gate);
    eq(parryOffered, false, 'Parry offered against a Continuous Trap effect');
    eq(m.location, 'mzone', 'Spacegate effect resolved');
  });

  await test('Parry still negates the activation of a Trap Card', async () => {
    const { g, c0, place } = setup();
    const parry = place(0, cardByName('Parry'), 'szone', { faceUp: false });
    place(0, cardByName('Gladiator Beast Secutor'), 'hand');
    place(0, cardByName('Needlebug Nest'), 'grave');
    const nest = place(1, cardByName('Needlebug Nest'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    const deck = g.players[1].deck.length;
    c0.respond = (_g, req) => req.options.find((o) => o.card === parry) ?? null;
    await activateCard(g, 1, nest);
    eq(parry.location, 'grave', 'Parry used');
    eq(g.players[1].deck.length, deck, 'Needlebug Nest negated');
  });

  // Necrovalley: cards in the GY cannot be removed from play, so a cost that removes a GY card cannot be paid.
  await test('Shield Warrior cannot be activated from the GY under Necrovalley (its cost removes it from play)', async () => {
    for (const valleyUp of [false, true]) {
      const { g, c0, place } = setup();
      if (valleyUp) live(place(1, cardByName('Necrovalley'), 'fzone', { faceUp: true }));
      const sw = place(0, cardByName('Shield Warrior'), 'grave');
      const wall = place(0, T.wall, 'mzone');
      const atk = place(1, T.brute, 'mzone');
      g.turnPlayer = 1;
      g.phase = 'battle';
      let swOffered = false;
      c0.respond = (_g, req) => {
        const o = req.options.find((x) => x.card === sw);
        if (o) swOffered = true;
        return o ?? null;
      };
      await g.conductAttack(1, atk);
      eq(swOffered, !valleyUp, `Shield Warrior offered (Necrovalley ${valleyUp})`);
      eq(sw.location, valleyUp ? 'grave' : 'banished', 'Shield Warrior location');
      eq(wall.location, valleyUp ? 'grave' : 'mzone', 'defender location');
    }
  });

  await test('Battle Tuned cannot be activated under Necrovalley (its cost removes a Tuner in the GY from play)', async () => {
    const { g, place } = setup();
    const bt = place(0, cardByName('Battle Tuned'), 'hand');
    place(0, cardByName('Nitro Synchron'), 'grave');
    place(0, T.brute, 'mzone');
    eq(offered(g, 0, bt), true, 'offered without Necrovalley');
    live(place(1, cardByName('Necrovalley'), 'fzone', { faceUp: true }));
    eq(offered(g, 0, bt), false, 'not offered under Necrovalley');
  });

  await test('Trap of Darkness cannot be activated under Necrovalley (its cost removes the copied Trap from play)', async () => {
    const { g, place } = setup();
    g.players[0].lp = 3000;
    place(0, cardByName('Needlebug Nest'), 'grave');
    const tod = place(0, cardByName('Trap of Darkness'), 'szone', { faceUp: false });
    eq(offered(g, 0, tod), true, 'offered without Necrovalley');
    live(place(1, cardByName('Necrovalley'), 'fzone', { faceUp: true }));
    eq(offered(g, 0, tod), false, 'not offered under Necrovalley');
  });

  // "When this card is ... flipped face-up, you can ...": an optional "When" trigger that misses its timing when the
  // flip is not the last thing that happened.
  const flipThenMore = async (g: Game, card: CardInstance, other: CardInstance | null) => {
    g.beginBatch();
    g.emit({ type: 'flipped', card, player: card.controller });
    if (other) {
      g.beginBatch();
      g.emit({ type: 'positionChanged', card: other, reasonPlayer: 0 });
    }
    await g.processTriggers(true);
  };

  await test('Kinka-byo: its flip trigger is a "When ... you can" effect that can miss the timing', async () => {
    for (const miss of [false, true]) {
      const { g, place } = setup();
      const kb = place(0, cardByName('Kinka-byo'), 'mzone');
      const mite = place(0, T.mite, 'grave');
      const other = place(1, T.brute, 'mzone');
      await flipThenMore(g, kb, miss ? other : null);
      eq(mite.location, miss ? 'grave' : 'mzone', `Level 1 monster (missed timing: ${miss})`);
    }
  });

  await test('Izanami: its flip trigger is a "When ... you can" effect that can miss the timing', async () => {
    for (const miss of [false, true]) {
      const { g, place } = setup();
      const iz = place(0, cardByName('Izanami'), 'mzone');
      const spirit = place(0, cardByName('Izanami'), 'grave');
      place(0, T.wall, 'hand');
      const other = place(1, T.brute, 'mzone');
      await flipThenMore(g, iz, miss ? other : null);
      eq(spirit.location, miss ? 'grave' : 'hand', `Spirit in the GY (missed timing: ${miss})`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
