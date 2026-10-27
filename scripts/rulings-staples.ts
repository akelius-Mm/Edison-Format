// Rulings regression tests for the "staples" card files (spells, traps, monsters, core, extra, ha01, sdmm).
// Usage: npx tsx scripts/rulings-staples.ts
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
  console.log('Rulings tests: staples');

  // Call of the Haunted: "When that monster is destroyed, destroy this card" — Tributing it is not destroying it.
  await test('Call of the Haunted stays on the field when its monster is Tributed; still destroyed when the monster is destroyed', async () => {
    const { g, c0, place } = setup();
    const dead = place(0, T.brute, 'grave');
    const call = place(0, N('Call of the Haunted'), 'szone', { faceUp: false });
    await activate(g, 0, call);
    eq(dead.location, 'mzone', 'revived');
    await g.moveCards([dead], 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: 0 });
    eq(call.location, 'szone', 'Call stays after a Tribute');
    eq(call.linkedTo, null, 'link broken (spent Call, Magic Planter fodder)');

    const dead2 = place(0, T.brute, 'grave');
    const call2 = place(0, N('Call of the Haunted'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => (req.candidates.includes(dead2) ? [dead2] : req.candidates.slice(0, req.min));
    await activate(g, 0, call2);
    eq(dead2.location, 'mzone', 'second revival');
    await g.destroy([dead2], 'effect', 1);
    eq(call2.location, 'grave', 'Call destroyed with its destroyed monster');
  });

  await test('Call of the Haunted: bouncing the Call still destroys the monster ("When this card leaves the field")', async () => {
    const { g, place } = setup();
    const dead = place(0, T.brute, 'grave');
    const call = place(0, N('Call of the Haunted'), 'szone', { faceUp: false });
    await activate(g, 0, call);
    await g.toHand([call], 'effect', 1);
    eq(call.location, 'hand', 'Call bounced');
    eq(dead.location, 'grave', 'monster destroyed');
  });

  // Premature Burial: "When this card is destroyed, destroy the equipped monster" — Giant Trunade keeps the monster.
  await test('Premature Burial returned to the hand (Giant Trunade) keeps the monster; destroying it destroys the monster', async () => {
    const { g, place } = setup();
    const dead = place(0, T.brute, 'grave');
    const pb = place(0, N('Premature Burial'), 'hand');
    await activate(g, 0, pb);
    eq(dead.location, 'mzone', 'revived');
    eq(g.players[0].lp, 7200, 'paid 800');
    const trunade = place(0, N('Giant Trunade'), 'hand');
    await activate(g, 0, trunade);
    eq(pb.location, 'hand', 'Premature Burial bounced');
    eq(dead.location, 'mzone', 'monster stays');

    const dead2 = place(0, T.brute, 'grave');
    await activate(g, 0, pb);
    eq(dead2.location === 'mzone' || dead.location === 'mzone', true, 'revived again');
    const host = pb.equippedTo != null ? g.card(pb.equippedTo)! : dead2;
    await g.destroy([pb], 'effect', 1);
    eq(host.location, 'grave', 'equipped monster destroyed with Premature Burial');
  });

  // Scapegoat: "You cannot Summon other monsters the turn you activate this card" (Setting is still allowed).
  await test('Scapegoat: 4 Sheep Tokens, then no Normal/Special Summon this turn (Set still allowed)', async () => {
    const { g, place } = setup();
    const goat = place(0, N('Scapegoat'), 'hand');
    const mon = place(0, T.brute, 'hand');
    await activate(g, 0, goat);
    eq(g.monsters(0).length, 4, 'Sheep Tokens');
    const acts = g.legalMainActions(0);
    eq(acts.some((a) => a.type === 'summon' && a.card === mon), false, 'no Normal Summon');
    eq(acts.some((a) => a.type === 'set' && a.card === mon), true, 'Setting is not a Summon');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), true, 'no Special Summon');
    eq(g.queryPlayer(0, 'cannotSet'), false, 'Setting not blocked');
  });

  // Cold Wave: "neither player can activate or Set Spell/Trap Cards".
  await test('Cold Wave: neither player can Set Spell/Trap Cards until the next turn', async () => {
    const { g, place } = setup();
    const cw = place(0, N('Cold Wave'), 'hand');
    const myTrap = place(0, N('Mirror Force'), 'hand');
    const oppTrap = place(1, N('Mirror Force'), 'hand');
    const mon = place(0, T.brute, 'hand');
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'main1', turnPlayer: 0 });
    await activate(g, 0, cw);
    const acts = g.legalMainActions(0);
    eq(acts.some((a) => a.type === 'setST' && a.card === myTrap), false, 'cannot Set a Trap');
    eq(acts.some((a) => a.type === 'set' && a.card === mon), true, 'monsters can still be Set');
    eq(g.legalMainActions(1).some((a) => a.type === 'setST' && a.card === oppTrap), false, 'opponent cannot Set either');
  });

  // Royal Oppression: "Any player can pay 800 LP to negate the Special Summon of a monster(s)".
  await test('Royal Oppression can be used by the player who does not control it', async () => {
    const { g, c0, place } = setup();
    const ro = place(1, N('Royal Oppression'), 'szone', { faceUp: true });
    ro.activeOnField = true;
    g.turnPlayer = 1;
    place(0, T.brute, 'mzone');
    const m = place(1, N('Cyber Dragon'), 'hand');
    c0.respond = respondWith('Royal Oppression');
    const proc = g.legalMainActions(1).find((a) => a.type === 'proc' && a.card === m);
    if (!proc) throw new Error('Cyber Dragon proc not offered');
    await g.performAction(1, proc);
    eq(m.location, 'grave', 'Special Summon negated and the monster destroyed');
    eq(g.players[0].lp, 7200, 'the non-controller paid 800 LP');
    eq(g.players[1].lp, 8000, 'controller paid nothing');
  });

  // Dark Magician of Chaos: "When this card is Normal or Special Summoned" — not on a Flip Summon.
  await test('Dark Magician of Chaos: no Spell recovery on a Flip Summon, but still banished when it leaves the field', async () => {
    const { g, place } = setup();
    place(0, N('Pot of Greed'), 'grave');
    const dmoc = place(0, N('Dark Magician of Chaos'), 'mzone', { faceUp: false, pos: 'def' });
    const before = g.eventLog.length;
    await g.flipSummon(0, dmoc);
    const used = g.eventLog.slice(before).some((e) => e.type === 'chainActivated' && (e.data?.link as any)?.card === dmoc);
    eq(used, false, 'Spell recovery not activated');
    eq(dmoc.banishOnLeave, true, 'face-up: banished instead of leaving');
    await g.destroy([dmoc], 'effect', 1);
    eq(dmoc.location, 'banished', 'banished');
  });

  // Armory Arm: "Once per turn, you can equip this card ... or unequip it to Special Summon this card in face-up Attack Position."
  await test('Armory Arm: equip, then (next turn) unequip and Special Summon it in Attack Position; one or the other per turn', async () => {
    const { g, place } = setup();
    const arm = place(0, N('Armory Arm'), 'mzone');
    arm.properlySummoned = true;
    const host = place(0, T.brute, 'mzone');
    await activate(g, 0, arm, 0);
    eq(arm.location, 'szone', 'equipped');
    eq(g.getAtk(host), 2800, 'host +1000');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === arm), false, 'no unequip the same turn');
    g.turn = 4;
    await activate(g, 0, arm, 3);
    eq(arm.location, 'mzone', 'unequipped and Special Summoned');
    eq(arm.pos, 'atk', 'Attack Position');
    eq(g.getAtk(host), 1800, 'host back to 1800');
    eq(arm.properlySummoned, true, 'still properly Summoned (can be revived)');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
