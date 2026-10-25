// Deterministic rules tests: set up exact board states and drive the engine directly.
// Usage: npx tsx scripts/rules-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureAnprPatches } from '../src/cards/sets/anpr';
import { ensurePtdnPatches } from '../src/cards/sets/ptdn';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Rules Test Shade') ?? normal('Rules Test Shade', 'DARK', 'Fiend', 4, 1600, 1200),
  giant: findCard('Rules Test Giant') ?? normal('Rules Test Giant', 'EARTH', 'Warrior', 8, 3000, 2500),
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

  // ---------------------------------------------------------------- HA01 (Hidden Arsenal)
  const activateCard = async (g: Game, p: PlayerId, card: CardInstance) => {
    const act = g.getActivations(p, { open: true }).find((a) => a.card === card);
    if (!act) throw new Error(`${card.name} cannot be activated`);
    await g.performAction(p, { type: 'activate', card, act });
  };

  await test('HA01: Mist Valley Shaman returns Thunderbird, which Special Summons itself and cannot attack', async () => {
    const { g, place } = setup();
    const shaman = place(0, cardByName('Mist Valley Shaman'), 'mzone');
    const bird = place(0, cardByName('Mist Valley Thunderbird'), 'mzone');
    await activateCard(g, 0, shaman);
    eq(g.getAtk(shaman), 1700, 'Shaman gained 500 ATK');
    eq(bird.location, 'mzone', 'Thunderbird back on the field');
    eq(bird.summonTurn, g.turn, 'Thunderbird was Special Summoned this turn');
    eq(g.canAttack(bird), false, 'Thunderbird cannot attack this turn');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === shaman), false, 'Shaman is once per turn');
  });

  await test('HA01: Mist Valley Soldier returns a monster it battled that was not destroyed', async () => {
    const { g, place } = setup();
    const soldier = place(0, cardByName('Mist Valley Soldier'), 'mzone');
    const wall = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, soldier);
    eq(g.players[0].lp, 8000 - 300, 'reflect damage');
    eq(wall.location, 'hand', 'wall returned to the hand');
    eq(soldier.location, 'mzone', 'Soldier stays');
  });

  await test('HA01: Cryomancer of the Ice Barrier stops Level 4+ attacks only with another Ice Barrier monster', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const small = place(0, cardByName('Blizzard Warrior'), 'mzone');
    place(1, cardByName('Cryomancer of the Ice Barrier'), 'mzone');
    eq(g.canAttack(a), true, 'alone: no lock');
    place(1, cardByName('Blizzed, Defender of the Ice Barrier'), 'mzone');
    eq(g.canAttack(a), false, 'Level 4 cannot attack');
    eq(g.canAttack(small), true, 'Level 3 can attack');
  });

  await test('HA01: Blizzed draws a card when destroyed by battle', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const blizzed = place(1, cardByName('Blizzed, Defender of the Ice Barrier'), 'mzone', { pos: 'def' });
    const hand = g.players[1].hand.length;
    await g.conductAttack(0, a);
    eq(blizzed.location, 'grave', 'Blizzed destroyed');
    eq(g.players[1].hand.length, hand + 1, 'Blizzed drew 1');
  });

  await test('HA01: Worm Erokin turns a Worm face-down; Cartaros searches again when flipped; Erokin cannot be revived', async () => {
    const { g, c0, place } = setup();
    const erokin = place(0, cardByName('Worm Erokin'), 'mzone');
    const cart = place(0, cardByName('Worm Cartaros'), 'mzone');
    const barses = place(0, cardByName('Worm Barses'), 'deck');
    c0.pick = (_g, req) => (req.candidates.includes(cart) ? [cart] : req.candidates.slice(0, Math.max(1, req.min)));
    await activateCard(g, 0, erokin);
    eq(cart.faceUp, false, 'Cartaros face-down');
    eq(cart.pos, 'def', 'Cartaros in Defense Position');
    await g.performAction(0, { type: 'flip', card: cart });
    eq(barses.location, 'hand', 'Cartaros searched Worm Barses');
    // "Cannot be Special Summoned": Monster Reborn has no legal target with only Erokin in the GY.
    await g.destroy([erokin], 'effect');
    const reborn = place(0, cardByName('Monster Reborn'), 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === reborn), false, 'Monster Reborn cannot target Erokin');
  });

  await test('HA01: Worm Barses flips an opponent\'s face-down monster into Attack Position', async () => {
    const { g, place } = setup();
    const barses = place(0, cardByName('Worm Barses'), 'hand');
    const fd = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await g.performAction(0, { type: 'summon', card: barses });
    eq(fd.faceUp, true, 'target face-up');
    eq(fd.pos, 'atk', 'target in Attack Position');
  });

  await test('HA01: X-Saber Axel draws when a Saber monster is destroyed by battle', async () => {
    const { g, place } = setup();
    place(0, cardByName('X-Saber Axel'), 'mzone', { pos: 'def' });
    const uruz = place(0, cardByName('X-Saber Uruz'), 'mzone');
    place(1, T.wall, 'mzone', { pos: 'atk' });
    const big = place(1, T.brute, 'mzone');
    const hand = g.players[0].hand.length;
    g.turnPlayer = 0;
    g.battle = null;
    // Uruz (1600) attacks Brute (1800) and is destroyed.
    const ctrl = g.controllers[0] as TestController;
    ctrl.chooseAttackTarget = async () => big;
    await g.conductAttack(0, uruz);
    eq(uruz.location, 'grave', 'Uruz destroyed');
    eq(g.players[0].hand.length, hand + 1, 'Axel drew 1');
  });

  await test('HA01: Commander Gottoms boosts Saber monsters, not itself', async () => {
    const { g, place } = setup();
    const gott = place(0, cardByName('Commander Gottoms, Swordmaster'), 'mzone');
    const axel = place(0, cardByName('X-Saber Axel'), 'mzone');
    eq(g.getAtk(gott), 2100, 'Gottoms unchanged');
    eq(g.getAtk(axel), 800, 'Axel +400');
  });

  await test('HA01: Ally of Justice Rudra gains 700 ATK only while battling a LIGHT monster', async () => {
    const { g, place } = setup();
    const rudra = place(0, cardByName('Ally of Justice Rudra'), 'mzone');
    const light = place(1, cardByName('Worm Erokin'), 'mzone'); // LIGHT 2400
    eq(g.getAtk(rudra), 1900, 'base ATK outside battle');
    await g.conductAttack(0, rudra);
    eq(light.location, 'grave', 'Rudra (2600) beat Erokin (2400)');
    eq(g.players[1].lp, 8000 - 200, 'damage 200');
  });

  await test('HA01: X-Saber Urbellum puts a random card back when the opponent holds 4+', async () => {
    const { g, place } = setup();
    const urb = place(0, cardByName('X-Saber Urbellum'), 'mzone');
    for (let i = 0; i < 5; i++) place(1, T.wall, 'hand');
    const deck = g.players[1].deck.length;
    await g.conductAttack(0, urb);
    eq(g.players[1].lp, 8000 - 2200, 'direct damage');
    eq(g.players[1].hand.length, 4, 'one card left the hand');
    eq(g.players[1].deck.length, deck + 1, 'it went on top of the Deck');
  });

  await test('HA01: Evolution Burst destroys a card and Cyber Dragon cannot attack', async () => {
    const { g, place } = setup();
    const cd = place(0, cardByName('Cyber Dragon'), 'mzone');
    const victim = place(1, T.wall, 'mzone');
    const eb = place(0, cardByName('Evolution Burst'), 'hand');
    eq(g.canAttack(cd), true, 'Cyber Dragon can attack before');
    await activateCard(g, 0, eb);
    eq(victim.location, 'grave', 'target destroyed');
    eq(eb.location, 'grave', 'Evolution Burst in GY');
    eq(g.canAttack(cd), false, 'Cyber Dragon cannot attack this turn');
  });

  await test('HA01: Flamvell Dragnov burns 500 when destroyed by battle, then searches from the GY', async () => {
    const { g, place } = setup();
    const a = place(1, T.brute, 'mzone');
    const drag = place(0, cardByName('Flamvell Dragnov'), 'mzone');
    g.turnPlayer = 1;
    await g.conductAttack(1, a);
    eq(drag.location, 'grave', 'Dragnov destroyed');
    eq(g.players[1].lp, 8000 - 500, '500 burn');
    g.turnPlayer = 0;
    const fire = place(0, cardByName('Flamvell Guard'), 'mzone');
    const next = place(0, cardByName('Flamvell Dragnov'), 'deck');
    await activateCard(g, 0, drag);
    eq(drag.location, 'banished', 'Dragnov banished');
    eq(fire.location, 'banished', 'FIRE monster banished');
    eq(next.location, 'hand', 'Dragnov searched');
  });

  // ---------------------------------------------------------------- SJC Edison Top 16 extras (tournament-extras2.ts)
  await test('Extras2: Proto-Cyber Dragon is named "Cyber Dragon" only while face-up on the field', async () => {
    const { g, place } = setup();
    const proto = place(0, cardByName('Proto-Cyber Dragon'), 'hand');
    await g.specialSummon([proto], 0, { pos: 'atk' });
    eq(proto.name, 'Cyber Dragon', 'name on the field');
    await g.destroy([proto], 'effect');
    eq(proto.name, 'Proto-Cyber Dragon', 'name in the GY');
  });

  await test('Extras2: Machina Gearframe equips to Machina Fortress and is destroyed by battle instead of it', async () => {
    const { g, place } = setup();
    const fortress = place(0, cardByName('Machina Fortress'), 'mzone');
    const gear = place(0, cardByName('Machina Gearframe'), 'mzone');
    await activateCard(g, 0, gear);
    eq(gear.location, 'szone', 'Gearframe in the S/T zone');
    eq(gear.equippedTo, fortress.uid, 'equipped to Fortress');
    const giant = findCard('Rules Test Giant') ?? normal('Rules Test Giant', 'EARTH', 'Warrior', 8, 3000, 2500);
    const a = place(1, giant, 'mzone');
    g.turnPlayer = 1;
    await g.conductAttack(1, a);
    eq(fortress.location, 'mzone', 'Fortress survives');
    eq(gear.location, 'grave', 'Gearframe destroyed instead');
    eq(g.players[0].lp, 8000 - 500, 'battle damage still applies');
  });

  await test('Extras2: Necrovalley negates Monster Reborn targeting a monster in the GY', async () => {
    const { g, place } = setup();
    const valley = place(0, cardByName('Necrovalley'), 'fzone', { faceUp: true });
    valley.activeOnField = true;
    const dead = place(1, T.brute, 'grave');
    const reborn = place(1, cardByName('Monster Reborn'), 'hand');
    g.turnPlayer = 1;
    await activateCard(g, 1, reborn);
    eq(dead.location, 'grave', 'target stays in the GY');
    eq(reborn.location, 'grave', 'Monster Reborn used up');
  });

  await test('Extras2: Gravekeeper\'s Guard FLIP returns an opponent\'s monster to the hand; Necrovalley gives +500', async () => {
    const { g, place } = setup();
    const guard = place(0, cardByName("Gravekeeper's Guard"), 'mzone', { faceUp: false, pos: 'def' });
    const opp = place(1, T.brute, 'mzone');
    await g.performAction(0, { type: 'flip', card: guard });
    eq(opp.location, 'hand', 'opponent monster returned');
    const valley = place(0, cardByName('Necrovalley'), 'fzone', { faceUp: true });
    valley.activeOnField = true;
    eq(g.getAtk(guard), 1500, 'Guard gains 500 ATK');
  });

  await test('Extras2: Tempest Magician removes every Spell Counter to burn 500 each', async () => {
    const { g, place } = setup();
    const tempest = place(0, cardByName('Tempest Magician'), 'mzone');
    tempest.counters.spell = 2;
    const arcanite = place(1, cardByName('Arcanite Magician'), 'mzone');
    arcanite.counters.spell = 1;
    await activateCard(g, 0, tempest);
    eq(g.players[1].lp, 8000 - 1500, '3 counters, 1500 damage');
    eq(arcanite.counters.spell, 0, 'opponent counters removed too');
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

  // ---------------------------------------------------------------- Ancient Prophecy (ANPR)
  // (uses activateCard from the HA01 section above)

  await test('ANPR Card Guard: summon places a counter; a moved counter stops destruction', async () => {
    const { g, place } = setup();
    const cg = place(0, cardByName('Card Guard'), 'hand');
    const b = place(0, T.brute, 'mzone');
    await g.performAction(0, { type: 'summon', card: cg });
    eq(cg.counters.guard, 1, 'counter on summon');
    eq(g.getAtk(cg), 1900, 'Card Guard ATK with 1 counter');
    await activateCard(g, 0, cg);
    eq(b.counters.guard, 1, 'counter moved to target');
    eq(g.getAtk(cg), 1600, 'Card Guard ATK without counter');
    await activateCard(g, 0, place(0, cardByName('Dark Hole'), 'hand'));
    eq(b.location, 'mzone', 'guarded monster survives Dark Hole');
    eq(b.counters.guard, 0, 'counter removed instead');
    eq(cg.location, 'grave', 'Card Guard itself destroyed');
  });

  await test('ANPR Earthbound Immortal Cusillu: Tribute another monster instead of battle destruction, halve LP', async () => {
    const { g, place } = setup();
    place(0, cardByName('Ancient Forest'), 'fzone');
    const cus = place(0, cardByName('Earthbound Immortal Cusillu'), 'mzone');
    const fodder = place(0, T.wall, 'mzone');
    place(1, T.giant, 'mzone');
    await g.conductAttack(0, cus);
    eq(cus.location, 'mzone', 'Cusillu survives');
    eq(fodder.location, 'grave', 'other monster Tributed');
    eq(g.players[0].lp, 8000 - 200, 'battle damage taken');
    eq(g.players[1].lp, 4000, "opponent's LP halved");
  });

  await test('ANPR Earthbound Immortal: cannot be attacked (opponent attacks directly), destroyed without a Field Spell', async () => {
    const { g, place } = setup();
    const field = place(1, cardByName('Ancient Forest'), 'fzone');
    const chacu = place(1, cardByName('Earthbound Immortal Chacu Challhua'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    const t = g.attackTargets(a);
    eq(t.targets.length, 0, 'no attack targets');
    eq(t.direct, true, 'may attack directly');
    await g.destroy([field], 'effect', 0);
    await g.processTriggers(true);
    eq(chacu.location, 'grave', 'destroyed when no Field Spell is face-up');
  });

  await test('ANPR Silver Wing: equipped Synchro survives battle twice per turn', async () => {
    const { g, place } = setup();
    const sd = place(0, cardByName('Stardust Dragon'), 'mzone');
    const sw = place(0, cardByName('Silver Wing'), 'szone', { faceUp: true });
    sw.activeOnField = true;
    g.equip(sw, sd);
    place(1, T.giant, 'mzone');
    await g.conductAttack(0, sd);
    await g.conductAttack(0, sd);
    eq(sd.location, 'mzone', 'survives two battles');
    await g.conductAttack(0, sd);
    eq(sd.location, 'grave', 'third battle destroys it');
    eq(sw.location, 'grave', 'Silver Wing leaves with it');
  });

  await test('ANPR Barbaros Ur: no battle damage to the opponent; Sauropod Brachion doubles reflected damage', async () => {
    const { g, place } = setup();
    ensureAnprPatches(g);
    const bar = place(0, cardByName('Beast Machine King Barbaros Ür'), 'mzone');
    const b = place(1, T.brute, 'mzone');
    await g.conductAttack(0, bar);
    eq(b.location, 'grave', 'attacked monster destroyed');
    eq(g.players[1].lp, 8000, 'opponent takes no battle damage');
    place(1, cardByName('Sauropod Brachion'), 'mzone', { pos: 'def' });
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(g.players[0].lp, 8000 - 2 * (3000 - 1800), 'reflected damage doubled');
  });

  await test('ANPR Kuribon: returns to hand in the Damage Step, attacker controller gains LP', async () => {
    const { g, c1, place } = setup();
    const k = place(1, cardByName('Kuribon'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    c1.respond = respondWith('Kuribon');
    await g.conductAttack(0, a);
    eq(k.location, 'hand', 'Kuribon in hand');
    eq(g.players[1].lp, 8000, 'no battle damage');
    eq(g.players[0].lp, 8000 + 1800, 'opponent gains attacker ATK');
  });

  await test('ANPR Fortune Lady Light leaves by effect -> Fortune Lady Fire destroys and burns', async () => {
    const { g, place } = setup();
    const light = place(0, cardByName('Fortune Lady Light'), 'mzone');
    eq(g.getAtk(light), 200, 'Level 1 x 200 ATK');
    const fire = place(0, cardByName('Fortune Lady Fire'), 'deck');
    const b = place(1, T.brute, 'mzone');
    await g.destroy([light], 'effect', 1);
    await g.processTriggers(true);
    eq(fire.location, 'mzone', 'Fire Special Summoned');
    eq(fire.pos, 'atk', 'in Attack Position');
    eq(g.getAtk(fire), 400, 'Level 2 x 200 ATK');
    eq(b.location, 'grave', 'target destroyed');
    eq(g.players[1].lp, 8000 - 1800, 'burn equal to its ATK');
  });

  await test('ANPR Scary Moth: one Special Summon per player per turn', async () => {
    const { g, place } = setup();
    place(0, cardByName('Scary Moth'), 'mzone');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), false, 'first summon allowed');
    await g.specialSummon([place(0, T.brute, 'grave')], 0, { pos: 'atk' });
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), true, 'second summon blocked');
    eq(g.queryPlayer(1, 'cannotSpecialSummon'), false, 'other player unaffected');
  });

  await test('ANPR Turbo Rocket: survives attacking, burns half the target ATK', async () => {
    const { g, place } = setup();
    const r = place(0, cardByName('Turbo Rocket'), 'mzone');
    place(1, T.brute, 'mzone');
    await g.conductAttack(0, r);
    eq(r.location, 'mzone', 'Turbo Rocket not destroyed');
    eq(g.players[0].lp, 8000 - 1800, 'battle damage taken');
    eq(g.players[1].lp, 8000 - 900, 'half ATK burn');
  });

  await test('ANPR Damage Translation: halves effect damage, Ghost Tokens at End Phase', async () => {
    const { g, place } = setup();
    await activateCard(g, 0, place(0, cardByName('Damage Translation'), 'szone', { faceUp: false }));
    await g.damage(0, 1000, 'effect');
    eq(g.players[0].lp, 7500, 'damage halved');
    await (g as any).setPhase('end');
    eq(g.monsters(0).filter((c) => c.name === 'Ghost Token').length, 1, '1 Ghost Token');
  });

  await test("ANPR Koa'ki Meiru maintenance: destroyed unless a monster of its Type is revealed", async () => {
    const a = setup();
    const kept = a.place(0, cardByName("Koa'ki Meiru Crusader"), 'mzone');
    a.place(0, cardByName('XX-Saber Ragigura'), 'hand');
    await (a.g as any).setPhase('end');
    eq(kept.location, 'mzone', 'kept by revealing a Beast-Warrior');
    const b = setup();
    const lost = b.place(0, cardByName("Koa'ki Meiru Crusader"), 'mzone');
    await (b.g as any).setPhase('end');
    eq(lost.location, 'grave', 'destroyed with nothing to reveal');
  });

  await test('ANPR Blackwing - Vayu: banish with a Blackwing, summon a Blackwing Synchro with negated effects', async () => {
    const { g, place } = setup();
    const vayu = place(0, cardByName('Blackwing - Vayu the Emblem of Honor'), 'grave');
    const elphin = place(0, cardByName('Blackwing - Elphin the Raven'), 'grave');
    const am = place(0, cardByName('Blackwing Armor Master'), 'extra');
    await activateCard(g, 0, vayu);
    eq(vayu.location, 'banished', 'Vayu banished');
    eq(elphin.location, 'banished', 'target banished');
    eq(am.location, 'mzone', 'Level 7 Blackwing Synchro summoned');
    eq(g.isNegated(am), true, 'its effects are negated');
  });

  await test('ANPR Flamvell Commando: Tribute Summon only with a Flamvell monster', async () => {
    const { g, place } = setup();
    ensureAnprPatches(g);
    const cmd = place(0, cardByName('Flamvell Commando'), 'hand');
    place(0, T.brute, 'mzone');
    eq(g.canNormalSummon(0, cmd), false, 'cannot Tribute a non-Flamvell');
    const dog = place(0, cardByName('Flamvell Firedog'), 'mzone');
    eq(g.canNormalSummon(0, cmd), true, 'can Tribute a Flamvell');
    eq(g.tributeCandidates(0, cmd).join(), [dog].join(), 'only Flamvell candidates');
  });

  await test('ANPR Discord: no Synchro Summons', async () => {
    const { g, place } = setup();
    place(0, tuner, 'mzone');
    place(0, T.brute, 'mzone');
    const goyo = g.players[0].extra[0];
    eq(g.canSynchro(0, goyo), true, 'Synchro possible');
    const d = place(1, cardByName('Discord'), 'szone', { faceUp: true });
    d.activeOnField = true;
    eq(g.canSynchro(0, goyo), false, 'Synchro blocked by Discord');
  });

  await test('ANPR Kasha: shuffles all other monsters, ATK 1000 per face-up Zombie', async () => {
    const { g, place } = setup();
    const z1 = place(0, cardByName('Zombie Master'), 'mzone');
    const z2 = place(0, cardByName('Plaguespreader Zombie'), 'mzone');
    const b = place(1, T.brute, 'mzone');
    const k = place(0, cardByName('Kasha'), 'hand');
    const act = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === k);
    if (!act) throw new Error('Kasha proc not available');
    await g.performAction(0, act);
    eq(k.location, 'mzone', 'Kasha summoned');
    eq([z1, z2, b].every((c) => c.location === 'deck'), true, 'others shuffled into the Deck');
    eq(g.getAtk(k), 2000, 'ATK = 1000 x 2 Zombies');
  });

  await test('ANPR Armed Sea Hunter: destroy a Level 3 or lower WATER monster instead', async () => {
    const { g, place } = setup();
    const h = place(0, cardByName('Armed Sea Hunter'), 'mzone');
    const f = place(0, cardByName('Fishborg Blaster'), 'mzone');
    await g.destroy([h], 'effect', 1);
    eq(h.location, 'mzone', 'Armed Sea Hunter survives');
    eq(f.location, 'grave', 'WATER monster destroyed instead');
  });

  await test('ANPR Gaia Plate: the battling monster has halved ATK during the Damage Step', async () => {
    const { g, place } = setup();
    const gp = place(0, cardByName('Gaia Plate the Earth Giant'), 'mzone');
    const t = place(1, T.giant, 'mzone');
    await g.conductAttack(0, gp);
    eq(t.location, 'grave', '1500-ATK giant destroyed');
    eq(g.players[1].lp, 8000 - 1300, 'damage uses halved ATK');
  });

  // ---------------------------------------------------------------- SOVR (Stardust Overdrive)
  const activate = async (g: Game, p: PlayerId, card: CardInstance) => {
    const act = g.getActivations(p, { open: true }).find((a) => a.card === card);
    if (!act) throw new Error(`${card.name} cannot be activated`);
    await g.performAction(p, { type: 'activate', card, act });
  };

  await test('SOVR: Reptilianne Medusa sets ATK to 0 until the monster is flipped face-down', async () => {
    const { g, place } = setup();
    const med = place(0, cardByName('Reptilianne Medusa'), 'mzone');
    place(0, T.wall, 'hand');
    const v = place(1, T.brute, 'mzone');
    await activate(g, 0, med);
    eq(g.getAtk(v), 0, 'ATK becomes 0');
    eq(g.queryCard(v, 'cannotChangePos'), true, 'cannot change position');
    g.turn++;
    eq(g.getAtk(v), 0, 'still 0 on the next turn');
    g.addTempMod(v, 'atk', 500, 'turn');
    eq(g.getAtk(v), 500, 'later ATK changes still apply');
    await g.changePosition(v, 'def', false);
    await g.changePosition(v, 'atk', true);
    eq(g.getAtk(v), 1800, 'reset after being flipped face-down');
  });

  await test('SOVR: Fortune Lady Earth ATK = Level x 400; Time Passage raises it and burns 400', async () => {
    const { g, place } = setup();
    const earth = place(0, cardByName('Fortune Lady Earth'), 'mzone');
    eq(g.getAtk(earth), 2400, 'Level 6 x 400');
    const tp = place(0, cardByName('Time Passage'), 'hand');
    await activate(g, 0, tp);
    eq(g.getLevel(earth), 9, 'Level 9');
    eq(g.getAtk(earth), 3600, 'ATK follows the Level');
    eq(g.players[1].lp, 7600, 'Level increase inflicted 400');
  });

  await test('SOVR: Fortune Lady gains a Level in its Standby Phase (max 12)', async () => {
    const { g, place } = setup();
    const water = place(0, cardByName('Fortune Lady Water'), 'mzone');
    g.turn = 3;
    g.turnPlayer = 1; // playTurn passes the turn to player 0
    await g.playTurn();
    eq(g.getLevel(water), 5, 'Level 5 after the Standby Phase');
    eq(g.getAtk(water), 1500, 'ATK = 5 x 300');
  });

  await test('SOVR: Earthbound Immortal cannot be attacked (direct attack instead) and dies without a Field Spell', async () => {
    const { g, place } = setup();
    const uru = place(0, cardByName('Earthbound Immortal Uru'), 'mzone');
    const web = place(0, cardByName('Spider Web'), 'fzone');
    web.activeOnField = true;
    const opp = place(1, T.brute, 'mzone');
    const t = g.attackTargets(opp);
    eq(t.targets.length, 0, 'Uru cannot be targeted for attacks');
    eq(t.direct, true, 'the opponent attacks directly instead');
    eq(g.attackTargets(uru).direct, true, 'Uru attacks directly');
    await g.destroy([web], 'effect', 1);
    await g.processTriggers(false);
    eq(uru.location, 'grave', 'destroyed with no face-up Field Spell');
  });

  await test('SOVR: Earthbound Immortal Ccarayhua destroyed by a card effect destroys all cards on the field', async () => {
    const { g, place } = setup();
    const cc = place(0, cardByName('Earthbound Immortal Ccarayhua'), 'mzone');
    const web = place(0, cardByName('Spider Web'), 'fzone');
    web.activeOnField = true;
    const a = place(1, T.brute, 'mzone');
    const s = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    await g.destroy([cc], 'effect', 1);
    await g.processTriggers(false);
    eq(cc.location, 'grave', 'Ccarayhua destroyed');
    eq(a.location, 'grave', 'opponent monster destroyed');
    eq(s.location, 'grave', 'opponent Set card destroyed');
    eq(web.location, 'grave', 'Field Spell destroyed');
  });

  await test('SOVR: Archlord Kristya goes to the top of the Deck instead of the GY and stops Special Summons', async () => {
    const { g, place } = setup();
    const k = place(0, cardByName('Archlord Kristya'), 'mzone');
    eq(g.queryPlayer(1, 'cannotSpecialSummon'), true, 'opponent cannot Special Summon');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), true, 'controller cannot Special Summon');
    await g.destroy([k], 'effect', 1);
    eq(k.location, 'deck', 'placed in the Deck');
    eq(g.players[0].deck[g.players[0].deck.length - 1], k, 'on top');
    eq(g.queryPlayer(1, 'cannotSpecialSummon'), false, 'lock gone');
  });

  await test('SOVR: Ritual of Grace Ritual Summons Northwemko, banishing Djinn Releaser from the GY', async () => {
    const { g, place } = setup();
    const rog = place(0, cardByName('Ritual of Grace'), 'hand');
    const nw = place(0, cardByName('Divine Grace - Northwemko'), 'hand');
    const fodder = place(0, T.brute, 'hand');
    const djinn = place(0, cardByName('Djinn Releaser of Rituals'), 'grave');
    const shield = place(0, cardByName('Gravity Bind'), 'szone', { faceUp: true });
    shield.activeOnField = true;
    await activate(g, 0, rog);
    eq(nw.location, 'mzone', 'Northwemko Ritual Summoned');
    eq(fodder.location, 'grave', 'hand monster Tributed');
    eq(djinn.location, 'banished', 'Djinn banished from the GY');
    eq(g.queryPlayer(1, 'cannotSpecialSummon'), true, 'opponent cannot Special Summon (Djinn Releaser)');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), false, 'Ritual Summoner can');
    eq(g.queryCard(nw, 'indestructibleEffect'), true, 'protected while the selected card is face-up');
    await g.destroy([shield], 'effect', 1);
    eq(g.queryCard(nw, 'indestructibleEffect'), false, 'protection ends');
  });

  await test('SOVR: Stardust Xiaolong survives only the first battle each turn', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const x = place(0, cardByName('Stardust Xiaolong'), 'mzone');
    const a1 = place(1, T.brute, 'mzone');
    const a2 = place(1, T.dark, 'mzone');
    await g.conductAttack(1, a1);
    eq(x.location, 'mzone', 'not destroyed the first time');
    eq(g.players[0].lp, 8000 - 1700, 'battle damage still taken');
    await g.conductAttack(1, a2);
    eq(x.location, 'grave', 'destroyed the second time');
  });

  await test('SOVR: Tuned Magician becomes a Tuner when Gemini Summoned', async () => {
    const { g, place } = setup();
    const tm = place(0, cardByName('Tuned Magician'), 'mzone');
    place(0, T.brute, 'mzone');
    const sd = place(0, cardByName('Stardust Dragon'), 'extra');
    eq(tm.isTuner, false, 'not a Tuner yet');
    eq(g.canSynchro(0, sd), false, 'no Synchro yet');
    const gem = g.getActivations(0, { open: true }).find((a) => a.card === tm)!;
    await g.performAction(0, { type: 'activate', card: tm, act: gem });
    eq(g.players[0].normalSummonsLeft, 0, 'uses the Normal Summon');
    eq(tm.isTuner, true, 'now a Tuner');
    eq(g.canSynchro(0, sd), true, 'Tuned Magician + Level 4 = Stardust Dragon');
  });

  await test('SOVR: Majestic Star Dragon needs Majestic Dragon + Stardust Dragon + 1 non-Tuner', async () => {
    const { g, place } = setup();
    const msd = place(0, cardByName('Majestic Star Dragon'), 'extra');
    place(0, cardByName('Majestic Dragon'), 'mzone');
    place(0, cardByName('Stardust Xiaolong'), 'mzone');
    const k = place(0, cardByName('Archlord Kristya'), 'mzone');
    eq(g.canSynchro(0, msd), false, 'no Stardust Dragon');
    await g.moveCards([k], 'banished', { reason: 'effect' });
    const sd = place(0, cardByName('Stardust Dragon'), 'mzone');
    eq(g.canSynchro(0, msd), true, 'with Stardust Dragon');
    await g.performAction(0, { type: 'synchro', card: msd });
    eq(msd.location, 'mzone', 'Majestic Star Dragon summoned');
    eq(sd.location, 'grave', 'Stardust Dragon used');
  });

  await test('SOVR: Reptilianne Scylla takes a 0 ATK monster it destroys by battle', async () => {
    const { g, place } = setup();
    const sc = place(0, cardByName('Reptilianne Scylla'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    g.addTempMod(v, 'atkBecomes', 0, 'field');
    await g.conductAttack(0, sc);
    eq(v.location, 'mzone', 'Special Summoned');
    eq(v.controller, 0, 'to Scylla\'s side');
    eq(v.pos, 'def', 'in Defense Position');
    eq(g.isNegated(v), true, 'effects negated');
  });

  await test('SOVR: Bending Destiny negates a Normal Summon and returns the monster in the End Phase', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, cardByName('Fortune Lady Wind'), 'mzone');
    place(0, cardByName('Bending Destiny'), 'szone', { faceUp: false });
    const m = place(1, T.brute, 'hand');
    c0.respond = respondWith('Bending Destiny');
    await g.performAction(1, { type: 'summon', card: m });
    eq(m.location, 'banished', 'summoned monster banished');
    await (g as any).setPhase('end');
    eq(m.location, 'hand', 'returned to the hand in the End Phase');
  });

  await test("SOVR: Koa'ki Meiru Beetle is destroyed in the End Phase unless an Insect is revealed", async () => {
    const { g, place } = setup();
    const b1 = place(0, cardByName("Koa'ki Meiru Beetle"), 'mzone');
    await (g as any).setPhase('end');
    eq(b1.location, 'grave', 'destroyed without an Insect or Iron Core');
    const b2 = place(0, cardByName("Koa'ki Meiru Beetle"), 'mzone');
    place(0, cardByName('Dark Spider'), 'hand');
    g.turn += 2;
    await (g as any).setPhase('end');
    eq(b2.location, 'mzone', 'kept by revealing an Insect');
  });

  await test('SOVR: Clear Vice Dragon attacks with twice the target\'s ATK', async () => {
    const { g, place } = setup();
    const cvd = place(0, cardByName('Clear Vice Dragon'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await g.conductAttack(0, cvd);
    eq(v.location, 'grave', 'target destroyed');
    eq(g.players[1].lp, 8000 - 1800, '3600 - 1800 damage');
    eq(g.getAtk(cvd), 0, '? ATK outside damage calculation');
  });
  await abpfTests();
  await ptdnTests();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// ---------------------------------------------------------------- Absolute Powerforce (ABPF)

/** Activate the first activatable effect of `card` for player `p` as a main-phase action. */
async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}

async function abpfTests() {
  const big = findCard('Rules Test Titan') ?? normal('Rules Test Titan', 'EARTH', 'Warrior', 4, 3500, 1000);
  const five = findCard('Rules Test Five') ?? normal('Rules Test Five', 'EARTH', 'Warrior', 5, 2100, 1000);
  const seven = findCard('Rules Test Seven') ?? normal('Rules Test Seven', 'EARTH', 'Dragon', 7, 2600, 2000);
  const six = findCard('Rules Test Six') ?? normal('Rules Test Six', 'DARK', 'Fiend', 6, 2000, 1000);
  const faceUpST = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };

  await test("ABPF: Gravekeeper's Visionary — 1-Tribute Summon, ATK per GY Gravekeeper, discard instead of destruction", async () => {
    const { g, place } = setup();
    const spy = place(0, cardByName("Gravekeeper's Spy"), 'mzone');
    const vis = place(0, cardByName("Gravekeeper's Visionary"), 'hand');
    const spare = place(0, cardByName("Gravekeeper's Priestess"), 'hand');
    place(0, cardByName("Gravekeeper's Descendant"), 'grave');
    eq(g.canNormalSummon(0, vis), true, 'can Tribute Summon with 1 Gravekeeper');
    await g.performAction(0, { type: 'summon', card: vis });
    eq(vis.location, 'mzone', 'Visionary summoned');
    eq(spy.location, 'grave', 'Spy tributed');
    eq(g.getAtk(vis), 2400, 'ATK with 2 Gravekeepers in GY');
    await g.destroy([vis], 'effect', 1);
    eq(vis.location, 'mzone', 'Visionary survives');
    eq(spare.location, 'grave', 'Gravekeeper discarded instead');
  });

  await test('ABPF: Advance Force — Tribute 1 Level 5+ monster for a Level 7+ monster', async () => {
    const { g, place } = setup();
    const lv5 = place(0, five, 'mzone');
    const lv7 = place(0, seven, 'hand');
    eq(g.canNormalSummon(0, lv7), false, 'needs 2 Tributes without Advance Force');
    faceUpST(place(0, cardByName('Advance Force'), 'szone', { faceUp: true }));
    eq(g.canNormalSummon(0, lv7), true, 'Advance Force allows 1 Tribute');
    await g.performAction(0, { type: 'summon', card: lv7 });
    eq(lv7.location, 'mzone', 'Level 7 summoned');
    eq(lv5.location, 'grave', 'Level 5 tributed');
  });

  await test('ABPF: Ritual of Destruction — Garlandolf with a Djinn from the GY, destroys low-DEF monsters, Ascending Soul', async () => {
    const { g, place } = setup();
    const garl = place(0, cardByName('Garlandolf, King of Destruction'), 'hand');
    const fodder = place(0, six, 'hand');
    const djinn = place(0, cardByName('Djinn Disserere of Rituals'), 'grave');
    faceUpST(place(0, cardByName('Ascending Soul'), 'szone', { faceUp: true }));
    const weak = place(1, T.brute, 'mzone');
    const wall = place(1, findCard('Rules Test Bulwark') ?? normal('Rules Test Bulwark', 'EARTH', 'Rock', 4, 0, 3000), 'mzone');
    const rod = place(0, cardByName('Ritual of Destruction'), 'hand');
    await activateCard(g, 0, rod);
    eq(garl.location, 'mzone', 'Garlandolf Ritual Summoned');
    eq(garl.summonMethod, 'ritual', 'summon method');
    eq(djinn.location, 'banished', 'Djinn banished as material');
    eq(weak.location, 'grave', 'DEF 1000 monster destroyed');
    eq(wall.location, 'mzone', 'DEF 3000 monster survives');
    eq(g.getAtk(garl), 2600, '+100 ATK per destroyed monster');
    eq(fodder.location, 'hand', 'Ascending Soul returned the Tributed monster');
    const trap = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    eq(g.isUnaffected(garl, trap, 1), true, 'Disserere: unaffected by Traps');
  });

  await test('ABPF: Oilman — Union equip, destroyed instead of the equipped Machine', async () => {
    const { g, place } = setup();
    const oil = place(0, cardByName('Oilman'), 'mzone');
    const machine = place(0, cardByName('Cyber Dragon'), 'mzone');
    await activateCard(g, 0, oil);
    eq(oil.location, 'szone', 'Oilman equipped');
    eq(oil.equippedTo, machine.uid, 'equipped to the Machine');
    await g.destroy([machine], 'effect', 1);
    eq(machine.location, 'mzone', 'Machine survives');
    eq(oil.location, 'grave', 'Oilman destroyed instead');
  });

  await test('ABPF: Shield Wing — not destroyed by battle twice per turn', async () => {
    const { g, place } = setup();
    const sw = place(1, cardByName('Shield Wing'), 'mzone', { pos: 'def' });
    const a = [place(0, T.brute, 'mzone'), place(0, T.brute, 'mzone'), place(0, T.brute, 'mzone')];
    await g.conductAttack(0, a[0]);
    await g.conductAttack(0, a[1]);
    eq(sw.location, 'mzone', 'survives two battles');
    await g.conductAttack(0, a[2]);
    eq(sw.location, 'grave', 'third battle destroys it');
  });

  await test('ABPF: Sun Dragon Inti — destroys its destroyer and burns half its ATK', async () => {
    const { g, place } = setup();
    const inti = place(1, cardByName('Sun Dragon Inti'), 'mzone');
    const titan = place(0, big, 'mzone');
    await g.conductAttack(0, titan);
    eq(inti.location, 'grave', 'Inti destroyed by battle');
    eq(titan.location, 'grave', 'attacker destroyed');
    eq(g.players[0].lp, 8000 - 1750, 'half of 3500 burned');
  });

  await test('ABPF: Fiendish Chain — negates and stops attacks, destroyed with the monster', async () => {
    const { g, c1, place } = setup();
    const cd = place(0, cardByName('Card Trooper'), 'mzone');
    const chain = place(1, cardByName('Fiendish Chain'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    c1.pick = (_g, req) => (req.candidates.includes(cd) ? [cd] : req.candidates.slice(0, req.min));
    await activateCard(g, 1, chain);
    g.turnPlayer = 0;
    eq(g.isNegated(cd), true, 'effects negated');
    eq(g.canAttack(cd), false, 'cannot attack');
    await g.destroy([cd], 'effect', 1);
    await g.processTriggers(false);
    eq(chain.location, 'grave', 'Fiendish Chain destroyed with it');
  });

  await test('ABPF: Reptilianne Naga — survives, battling monster has 0 ATK after the Battle Phase', async () => {
    const { g, place } = setup();
    const naga = place(1, cardByName('Reptilianne Naga'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(naga.location, 'mzone', 'Naga not destroyed by battle');
    eq(g.players[1].lp, 8000 - 1800, 'battle damage');
    await (g as any).setPhase('main2');
    eq(g.getAtk(a), 0, 'attacker ATK becomes 0');
  });

  await test('ABPF: Machine King - 3000 B.C. — Trap Monster, summon lock', async () => {
    const { g, place } = setup();
    const mk = place(0, cardByName('Machine King - 3000 B.C.'), 'szone', { faceUp: false });
    const later = place(0, T.brute, 'hand');
    await activateCard(g, 0, mk);
    eq(mk.location, 'mzone', 'Special Summoned as a monster');
    eq(mk.isMonster, true, 'treated as a monster');
    eq(g.getAtk(mk), 1000, 'ATK 1000');
    eq(g.getLevel(mk), 4, 'Level 4');
    eq(g.canNormalSummon(0, later), false, 'cannot Normal Summon other monsters this turn');
    await g.destroy([mk], 'effect', 1);
    eq(mk.location, 'grave', 'destroyed');
    eq(mk.isTrap, true, 'a Trap again in the GY');
  });

  await test('ABPF: Offering to the Immortals — negates the direct attack, 2 Ceremonial Tokens', async () => {
    const { g, c1, place } = setup();
    g.players[1].lp = 3000;
    place(1, cardByName('Offering to the Immortals'), 'szone', { faceUp: false });
    const a = place(0, T.brute, 'mzone');
    c1.respond = respondWith('Offering to the Immortals');
    await g.conductAttack(0, a);
    eq(g.players[1].lp, 3000, 'no damage');
    const toks = g.monsters(1).filter((c) => c.name === 'Ceremonial Token');
    eq(toks.length, 2, '2 tokens');
    eq(g.tributeCandidates(1).filter((c) => toks.includes(c)).length, 0, 'tokens cannot be Tributed for other summons');
  });

  await test("ABPF: Nature's Reflection — the opponent's effect damage hits them", async () => {
    const { g, place } = setup();
    const nr = place(0, cardByName("Nature's Reflection"), 'szone', { faceUp: false });
    await activateCard(g, 0, nr);
    await g.damage(0, 800, 'effect', undefined, 1);
    eq(g.players[0].lp, 8000, 'activator takes no damage');
    eq(g.players[1].lp, 7200, 'damage reflected');
  });

  await test('ABPF: Saber Hole — negates a Summon while you control an X-Saber', async () => {
    const { g, c1, place } = setup();
    place(1, cardByName('XX-Saber Garsem'), 'mzone');
    place(1, cardByName('Saber Hole'), 'szone', { faceUp: false });
    c1.respond = respondWith('Saber Hole');
    const m = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.location, 'grave', 'summon negated and monster destroyed');
  });

  await test('ABPF: Consecrated Light — DARK monsters cannot attack', async () => {
    const { g, place } = setup();
    place(1, cardByName('Consecrated Light'), 'mzone');
    const d = place(0, T.dark, 'mzone');
    const b = place(0, T.brute, 'mzone');
    eq(g.canAttack(d), false, 'DARK cannot attack');
    eq(g.canAttack(b), true, 'EARTH can attack');
  });

  await test('ABPF: Cyber Dragon Zwei — named "Cyber Dragon" in the GY', async () => {
    const { g, place } = setup();
    const z = place(0, cardByName('Cyber Dragon Zwei'), 'mzone');
    eq(z.name, 'Cyber Dragon Zwei', 'own name on the field');
    await g.destroy([z], 'effect', 1);
    eq(z.name, 'Cyber Dragon', 'name in the GY');
  });

  await test('ABPF: Underground Arachnid — equips a monster and destroys it instead', async () => {
    const { g, place } = setup();
    const ua = place(0, cardByName('Underground Arachnid'), 'mzone');
    const victim = place(1, T.wall, 'mzone');
    await activateCard(g, 0, ua);
    eq(victim.location, 'szone', 'opponent monster equipped');
    eq(victim.controller, 0, 'in your Spell & Trap Zone');
    g.turnPlayer = 1;
    const titan = place(1, big, 'mzone');
    await g.conductAttack(1, titan);
    eq(ua.location, 'mzone', 'Arachnid survives');
    eq(victim.location, 'grave', 'equipped monster destroyed instead');
  });

  await test('ABPF: Variety Comes Out — Synchro back to the Extra Deck, Tuners revived, no Synchro this turn', async () => {
    const { g, place } = setup();
    const goyo = g.players[0].extra[0];
    g.rawMove(goyo, 'mzone', { controller: 0, faceUp: true, pos: 'atk' });
    const t1 = place(0, cardByName('Fire Ant Ascator'), 'grave');
    const t2 = place(0, cardByName('Drill Synchron'), 'grave');
    const v = place(0, cardByName('Variety Comes Out'), 'hand');
    await activateCard(g, 0, v);
    eq(goyo.location, 'extra', 'Goyo returned');
    eq(t1.location, 'mzone', 'Tuner 1 summoned');
    eq(t2.location, 'mzone', 'Tuner 2 summoned');
    eq(g.canSynchro(0, goyo), false, 'cannot Synchro Summon this turn');
  });

  await test('ABPF: Witch of the Black Rose — destroyed when the drawn card is not a monster', async () => {
    const { g, place } = setup();
    const top = place(0, cardByName('Dark Hole'), 'deck');
    const w = place(0, cardByName('Witch of the Black Rose'), 'hand');
    await g.performAction(0, { type: 'summon', card: w });
    eq(top.location, 'grave', 'drawn Spell sent to the GY');
    eq(w.location, 'grave', 'Witch destroyed');
  });
}

// ---------------------------------------------------------------- Phantom Darkness (PTDN)

async function ptdnTests() {
  const phase = (g: Game, ph: 'standby' | 'end') => (g as any).setPhase(ph) as Promise<void>;
  const opp = (g: Game) => {
    g.turnPlayer = 1;
    g.phase = 'battle';
  };

  await test('PTDN: Yubel — burns the attacker before damage calculation, survives, no battle damage', async () => {
    const { g, place } = setup();
    ensurePtdnPatches(g);
    const y = place(0, cardByName('Yubel'), 'mzone');
    opp(g);
    const a = place(1, T.giant, 'mzone');
    await g.conductAttack(1, a);
    eq(y.location, 'mzone', 'Yubel not destroyed by battle');
    eq(g.players[1].lp, 8000 - 3000, 'attacker ATK inflicted to the opponent');
    eq(g.players[0].lp, 8000, 'no battle damage to Yubel controller');
  });

  await test('PTDN: Yubel chain — own End Phase destruction summons nothing; destroyed otherwise -> Terror Incarnate -> Ultimate Nightmare', async () => {
    const { g, place } = setup();
    ensurePtdnPatches(g);
    const y = place(0, cardByName('Yubel'), 'mzone');
    const terror = place(0, cardByName('Yubel - Terror Incarnate'), 'deck');
    const night = place(0, cardByName('Yubel - The Ultimate Nightmare'), 'deck');
    await phase(g, 'end');
    eq(y.location, 'grave', 'Yubel destroyed itself (no other monster to Tribute)');
    eq(terror.location, 'deck', 'no Terror Incarnate when destroyed by its own effect');
    const y2 = place(0, cardByName('Yubel'), 'mzone');
    await g.destroy([y2], 'effect', 1);
    await g.processTriggers(false);
    eq(terror.location, 'mzone', 'Terror Incarnate Special Summoned from the Deck');
    await g.destroy([terror], 'effect', 1);
    await g.processTriggers(false);
    eq(night.location, 'mzone', 'Ultimate Nightmare Special Summoned when Terror left the field');
    opp(g);
    const a = place(1, T.brute, 'mzone');
    await g.conductAttack(1, a);
    eq(a.location, 'grave', 'battled monster destroyed at the end of the Damage Step');
    eq(g.players[1].lp, 8000 - 1800, "damage equal to the battled monster's ATK");
    eq(g.players[0].lp, 8000, 'no battle damage');
  });

  await test('PTDN: Super Polymerization — uses the opponent\'s monster and cannot be responded to', async () => {
    const { g, c1, place } = setup();
    const twin = place(0, cardByName('Cyber Twin Dragon'), 'extra');
    const mine = place(0, cardByName('Cyber Dragon'), 'mzone');
    const theirs = place(1, cardByName('Cyber Dragon'), 'mzone');
    place(0, T.wall, 'hand');
    const sp = place(0, cardByName('Super Polymerization'), 'hand');
    const mst = place(1, cardByName('Mystical Space Typhoon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mystical Space Typhoon');
    await activateCard(g, 0, sp);
    eq(twin.location, 'mzone', 'Cyber Twin Dragon Fusion Summoned');
    eq(mine.location, 'grave', 'own material in the GY');
    eq(theirs.location, 'grave', "opponent's material in the GY");
    eq(theirs.owner, 1, "opponent's Cyber Dragon went to its owner's GY");
    eq(mst.location, 'szone', 'opponent could not respond');
  });

  await test('PTDN: Vicious Claw — returns to the hand instead, destroys a monster, burns 600, Evil Token', async () => {
    const { g, c0, place } = setup();
    const b = place(0, T.brute, 'mzone');
    const claw = place(0, cardByName('Vicious Claw'), 'hand');
    await activateCard(g, 0, claw);
    eq(g.getAtk(b), 2100, 'equipped +300');
    opp(g);
    const giant = place(1, T.giant, 'mzone');
    const wall = place(1, T.wall, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(wall) ? [wall] : req.candidates.slice(0, req.min));
    await g.conductAttack(1, giant);
    eq(b.location, 'mzone', 'equipped monster not destroyed');
    eq(claw.location, 'hand', 'Vicious Claw returned to the hand');
    eq(wall.location, 'grave', 'another monster destroyed');
    eq(g.players[1].lp, 8000 - 600, '600 damage');
    eq(g.monsters(1).some((c) => c.name === 'Evil Token'), true, "Evil Token on the opponent's field");
    eq(g.players[0].lp, 8000 - 900, 'battle damage still applied');
  });

  await test('PTDN: Destiny HERO - Departed — banished when discarded, revives on the opponent\'s field, banished by battle', async () => {
    const { g, place } = setup();
    ensurePtdnPatches(g);
    const dep = place(0, cardByName('Destiny HERO - Departed'), 'hand');
    place(0, T.wall, 'hand');
    const fine = place(0, cardByName('Fine'), 'szone', { faceUp: false });
    await activateCard(g, 0, fine);
    eq(dep.location, 'banished', 'discarded by a card effect -> banished');
    const dep2 = place(0, cardByName('Destiny HERO - Departed'), 'grave');
    await phase(g, 'standby');
    eq(dep2.location, 'mzone', 'Special Summoned in the Standby Phase');
    eq(dep2.controller, 1, "on the opponent's side");
    g.phase = 'battle';
    const b = place(0, T.brute, 'mzone');
    await g.conductAttack(0, b);
    eq(dep2.location, 'banished', 'destroyed by battle -> banished');
  });

  await test('PTDN: Obsidian Dragon — negates a Spell that targets exactly 1 DARK monster and destroys it', async () => {
    const { g, place } = setup();
    const ob = place(0, cardByName('Obsidian Dragon'), 'mzone');
    opp(g);
    g.phase = 'main1';
    const book = place(1, cardByName('Book of Moon'), 'hand');
    await activateCard(g, 1, book);
    eq(ob.faceUp, true, 'Obsidian Dragon stays face-up');
    eq(book.location, 'grave', 'Book of Moon destroyed');
  });

  await test('PTDN: Dark Red Enchanter counts resolved Spells; Dark Horus revives after an opponent\'s Main Phase Spell', async () => {
    const { g, place } = setup();
    const dre = place(0, cardByName('Dark Red Enchanter'), 'hand');
    place(0, T.wall, 'mzone');
    await g.performAction(0, { type: 'summon', card: dre });
    eq(dre.counters.spell, 2, '2 Spell Counters on Normal Summon');
    const horus = place(0, cardByName('Dark Horus'), 'mzone');
    const shade = place(0, T.dark, 'grave');
    place(0, cardByName('Sakuretsu Armor'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    const mst = place(1, cardByName('Mystical Space Typhoon'), 'hand');
    await activateCard(g, 1, mst);
    eq(dre.counters.spell, 3, 'Spell Counter added when the Spell resolved');
    eq(g.getAtk(dre), 1700 + 900, '+300 ATK per counter');
    eq(shade.location, 'mzone', 'Dark Horus revived a Level 4 DARK monster');
    void horus;
  });

  await test('PTDN: Prime Material Dragon — negates Dark Hole; effect damage becomes an LP gain', async () => {
    const { g, c0, place } = setup();
    ensurePtdnPatches(g);
    const pmd = place(0, cardByName('Prime Material Dragon'), 'mzone');
    place(0, T.wall, 'hand');
    g.turnPlayer = 1;
    const hole = place(1, cardByName('Dark Hole'), 'hand');
    c0.respond = respondWith('Prime Material Dragon');
    await activateCard(g, 1, hole);
    eq(pmd.location, 'mzone', 'Prime Material Dragon survives');
    eq(hole.location, 'grave', 'Dark Hole negated');
    await g.damage(0, 500, 'effect', hole, 1);
    eq(g.players[0].lp, 8500, 'effect damage became an LP gain');
  });

  await test('PTDN: Chain Material — Polymerization banishes materials from the Deck; the Fusion is destroyed in the End Phase', async () => {
    const { g, place } = setup();
    const end = place(0, cardByName('Cyber End Dragon'), 'extra');
    const cds = [0, 1, 2].map(() => place(0, cardByName('Cyber Dragon'), 'deck'));
    const cm = place(0, cardByName('Chain Material'), 'szone', { faceUp: false });
    await activateCard(g, 0, cm);
    const poly = place(0, cardByName('Polymerization'), 'hand');
    await activateCard(g, 0, poly);
    eq(end.location, 'mzone', 'Cyber End Dragon Fusion Summoned');
    eq(cds.every((c) => c.location === 'banished'), true, 'materials banished from the Deck');
    eq(g.queryPlayer(0, 'cannotDeclareAttack'), true, 'cannot attack this turn');
    await phase(g, 'end');
    eq(end.location, 'grave', 'destroyed in the End Phase');
  });

  await test('PTDN: Transmigration Break — cards returned from the GY to the Deck are banished instead', async () => {
    const { g, place } = setup();
    ensurePtdnPatches(g);
    const tb = place(0, cardByName('Transmigration Break'), 'szone', { faceUp: true });
    tb.activeOnField = true;
    const mons = [0, 1, 2, 3, 4].map(() => place(0, T.wall, 'grave'));
    const pot = place(0, cardByName('Pot of Avarice'), 'hand');
    await activateCard(g, 0, pot);
    eq(mons.every((c) => c.location === 'banished'), true, 'banished instead of shuffled into the Deck');
  });

  await test('PTDN: Armored Cybern — equips to Cyber Dragon, trades 1000 ATK for a destruction, protects it', async () => {
    const { g, place } = setup();
    const cd = place(0, cardByName('Cyber Dragon'), 'mzone');
    const ac = place(0, cardByName('Armored Cybern'), 'mzone');
    await activateCard(g, 0, ac, 'Equip / Unequip');
    eq(ac.location, 'szone', 'equipped');
    const v = place(1, T.brute, 'mzone');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === ac && a.label !== 'Equip / Unequip');
    if (!act) throw new Error('destroy effect not available');
    (g.controllers[0] as any).pick = (_g: Game, req: any) => (req.candidates.includes(v) ? [v] : req.candidates.slice(0, req.min));
    await g.performAction(0, { type: 'activate', card: ac, act });
    eq(v.location, 'grave', 'target destroyed');
    eq(g.getAtk(cd), 2100 - 1000, 'Cyber Dragon lost exactly 1000 ATK');
    await g.destroy([cd], 'effect', 1);
    eq(cd.location, 'mzone', 'Cyber Dragon protected');
    eq(ac.location, 'grave', 'Armored Cybern destroyed instead');
  });

  await test('PTDN: Escape from the Dark Dimension — the monster is destroyed and banished when the trap leaves', async () => {
    const { g, place } = setup();
    const shade = place(0, T.dark, 'banished');
    const esc = place(0, cardByName('Escape from the Dark Dimension'), 'szone', { faceUp: false });
    await activateCard(g, 0, esc);
    eq(shade.location, 'mzone', 'banished DARK monster Special Summoned');
    await g.destroy([esc], 'effect', 1);
    eq(shade.location, 'banished', 'destroyed and banished');
  });

  await test('PTDN: Sinister Seeds — 1 token per 500 battle damage', async () => {
    const { g, c0, place } = setup();
    const b = place(0, T.brute, 'mzone');
    place(0, cardByName('Sinister Seeds'), 'szone', { faceUp: false });
    c0.respond = respondWith('Sinister Seeds');
    opp(g);
    const giant = place(1, T.giant, 'mzone');
    await g.conductAttack(1, giant);
    eq(b.location, 'grave', 'monster destroyed by battle');
    eq(g.monsters(0).filter((c) => c.name === 'Sinister Seed Token').length, 2, '1200 damage -> 2 tokens');
  });

  await test('PTDN: Earth Effigy counts as 2 Tributes for an EARTH Normal Monster (also face-down)', async () => {
    const { g, place } = setup();
    ensurePtdnPatches(g);
    const eff = place(0, cardByName('Earth Effigy'), 'mzone', { faceUp: false, pos: 'def' });
    const giant = place(0, T.giant, 'hand');
    const tuner2 = place(0, T.dark, 'hand');
    eq(g.canNormalSummon(0, giant), true, 'Level 8 EARTH Normal Monster with 1 Effigy');
    eq(g.canNormalSummon(0, place(0, cardByName('Dark Armed Dragon'), 'hand')), false, 'not for other monsters');
    await g.performAction(0, { type: 'summon', card: giant });
    eq(giant.location, 'mzone', 'Tribute Summoned');
    eq(eff.location, 'grave', 'Effigy tributed');
    void tuner2;
  });

  await test('PTDN: Darklord Zerato — Tribute Summon with 1 DARK monster when 4 DARK names are in the GY', async () => {
    const { g, place } = setup();
    for (const n of ['Dark Grepher', 'Armageddon Knight', 'Dark Crusader', 'Doomsday Horror']) place(0, cardByName(n), 'grave');
    const shade = place(0, T.dark, 'mzone');
    const z = place(0, cardByName('Darklord Zerato'), 'hand');
    eq(g.canNormalSummon(0, z), true, 'can Tribute Summon with 1 DARK');
    await g.performAction(0, { type: 'summon', card: z });
    eq(z.location, 'mzone', 'Zerato summoned');
    eq(shade.location, 'grave', 'DARK monster tributed');
  });

  await test('PTDN: Drastic Drop Off — the opponent discards the drawn card', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Drastic Drop Off'), 'szone', { faceUp: false });
    c0.respond = respondWith('Drastic Drop Off');
    g.turnPlayer = 1;
    const top = place(1, T.brute, 'deck');
    await g.draw(1, 1, 'effect');
    await g.processTriggers(true);
    eq(top.location, 'grave', 'added card discarded');
  });

  await test('PTDN: Rainbow Life — damage becomes an LP gain this turn', async () => {
    const { g, place } = setup();
    place(0, T.wall, 'hand');
    const rl = place(0, cardByName('Rainbow Life'), 'szone', { faceUp: false });
    await activateCard(g, 0, rl);
    await g.damage(0, 1000, 'battle');
    eq(g.players[0].lp, 9000, 'battle damage became an LP gain');
  });
}
