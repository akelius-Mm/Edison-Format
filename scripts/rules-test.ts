// Deterministic rules tests: set up exact board states and drive the engine directly.
// Usage: npx tsx scripts/rules-test.ts
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
  dark: findCard('Rules Test Shade') ?? normal('Rules Test Shade', 'DARK', 'Fiend', 4, 1600, 1200),
};
const tuner = findCard('Rules Test Tuner') ?? normal('Rules Test Tuner', 'EARTH', 'Warrior', 2, 800, 800);
if (!tuner.mtypes!.includes('tuner')) tuner.mtypes!.push('tuner');

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
  const g = new Game([{ main: filler(20), extra: [cardByName('Goyo Guardian')] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
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
  console.log('Rules tests');

  await test('battle: attack position monster destroyed, damage dealt', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const d = place(1, T.wall, 'mzone');
    await g.conductAttack(0, a);
    eq(d.location, 'grave', 'defender location');
    eq(g.players[1].lp, 8000 - 1300, 'LP');
  });

  await test('battle: attacking higher DEF inflicts reflect damage, no destruction', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const d = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, a);
    eq(d.location, 'mzone', 'defender stays');
    eq(g.players[0].lp, 8000 - 200, 'attacker LP');
  });

  await test('battle: face-down defender is flipped', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const d = place(1, cardByName('Sangan'), 'mzone', { faceUp: false, pos: 'def' });
    await g.conductAttack(0, a);
    eq(d.location, 'grave', 'Sangan destroyed');
    eq(g.players[1].hand.length, 1, 'Sangan searched a card');
  });

  await test('Mirror Force destroys attack position attackers', async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const b = place(0, T.dark, 'mzone');
    place(1, T.wall, 'mzone', { pos: 'def' });
    const mf = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mirror Force');
    await g.conductAttack(0, a);
    eq(a.location, 'grave', 'attacker destroyed');
    eq(b.location, 'grave', 'other attacker destroyed');
    eq(mf.location, 'grave', 'Mirror Force to GY');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  await test('Solemn Judgment negates a Normal Summon', async () => {
    const { g, c1, place } = setup();
    const m = place(0, T.brute, 'hand');
    place(1, cardByName('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.location, 'grave', 'summoned monster destroyed');
    eq(g.players[1].lp, 4000, 'Solemn cost');
    eq(g.players[0].normalSummonsLeft, 0, 'summon used');
  });

  await test('Bottomless Trap Hole banishes a summoned 1500+ ATK monster', async () => {
    const { g, c1, place } = setup();
    const m = place(0, T.brute, 'hand');
    place(1, cardByName('Bottomless Trap Hole'), 'szone', { faceUp: false });
    c1.respond = respondWith('Bottomless Trap Hole');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.location, 'banished', 'monster banished');
  });

  await test('Chain: MST on Call of the Haunted, Call chained resolves then monster dies with Call', async () => {
    const { g, c0, c1, place } = setup();
    const call = place(1, cardByName('Call of the Haunted'), 'szone', { faceUp: false });
    const dead = place(1, T.brute, 'grave');
    const mst = place(0, cardByName('Mystical Space Typhoon'), 'hand');
    c0.pick = (_g, req) => (req.candidates.includes(call) ? [call] : req.candidates.slice(0, req.min));
    c1.respond = respondWith('Call of the Haunted');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === mst)!;
    await g.performAction(0, { type: 'activate', card: mst, act });
    eq(call.location, 'grave', 'Call destroyed');
    eq(dead.location, 'grave', 'revived monster destroyed by link');
    eq(mst.location, 'grave', 'MST in GY');
  });

  await test('Synchro Summon Goyo Guardian and steal a monster', async () => {
    const { g, place } = setup();
    place(0, tuner, 'mzone');
    place(0, T.brute, 'mzone');
    const goyo = g.players[0].extra[0];
    eq(g.canSynchro(0, goyo), true, 'can synchro');
    await g.performAction(0, { type: 'synchro', card: goyo });
    eq(goyo.location, 'mzone', 'Goyo on field');
    const victim = place(1, T.dark, 'mzone');
    await g.conductAttack(0, goyo);
    eq(victim.location, 'mzone', 'victim revived');
    eq(victim.controller, 0, 'controlled by Goyo player');
  });

  await test('Dark Hole destroys all monsters', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const b = place(1, T.dark, 'mzone');
    const dh = place(0, cardByName('Dark Hole'), 'hand');
    const act = g.getActivations(0, { open: true }).find((x) => x.card === dh)!;
    await g.performAction(0, { type: 'activate', card: dh, act });
    eq(a.location, 'grave', 'own monster');
    eq(b.location, 'grave', 'opp monster');
  });

  await test('Treeborn Frog revives in Standby Phase with no Spell/Traps', async () => {
    const { g, place } = setup();
    const frog = place(0, cardByName('Treeborn Frog'), 'grave');
    g.turn = 3;
    g.turnPlayer = 1; // playTurn flips to player 0
    // run a partial turn: draw + standby
    const p = g.playTurn();
    // the default controller passes and ends the turn
    await p;
    eq(frog.location, 'mzone', 'frog revived');
  });

  await test('Cyber Dragon proc requires opponent-only monsters', async () => {
    const { g, place } = setup();
    const cd = place(0, cardByName('Cyber Dragon'), 'hand');
    let acts = g.legalMainActions(0).filter((a) => a.type === 'proc' && a.card === cd);
    eq(acts.length, 0, 'no proc with empty field');
    place(1, T.wall, 'mzone');
    acts = g.legalMainActions(0).filter((a) => a.type === 'proc' && a.card === cd);
    eq(acts.length, 1, 'proc available');
    await g.performAction(0, acts[0]);
    eq(cd.location, 'mzone', 'summoned');
  });

  await test('Gravity Bind stops level 4+ attacks', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const gb = place(1, cardByName('Gravity Bind'), 'szone', { faceUp: true });
    gb.activeOnField = true;
    eq(g.canAttack(a), false, 'cannot attack');
  });

  await test('Deck out loses the duel', async () => {
    const { g } = setup();
    g.players[0].deck.length = 0;
    let lost = false;
    try {
      await g.draw(0, 1);
    } catch (e) {
      lost = e instanceof GameOver && e.winner === 1;
    }
    eq(lost, true, 'player 0 lost');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
