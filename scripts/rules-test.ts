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
import { ensureRgbtPatches } from '../src/cards/sets/rgbt';
import { ensureCrmsPatches } from '../src/cards/sets/crms';
import { ensurePtdnPatches } from '../src/cards/sets/ptdn';
import { ensureLodtPatches } from '../src/cards/sets/lodt';
import { ensureGlasPatches } from '../src/cards/sets/glas';
import { ensureCsocPatches } from '../src/cards/sets/csoc';
import { PREMADE_DECKS, aiSideDeck, buildDeckList, canSwap, moveToDeck, moveToSide, sideSummary, sidedDeckProblems, swapCards, validateDeck, type DeckIds } from '../src/decks';
import { ensureTdgsPatches } from '../src/cards/sets/tdgs';
import { ensureArchetypeExtrasPatches } from '../src/cards/sets/archetype-extras';
import { ensureArchetypeExtras2Patches } from '../src/cards/sets/archetype-extras2';

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
  await rgbtTests();
  await crmsTests();
  await ptdnTests();
  await lodtTests();
  await glasTests();
  await csocTests();
  await sidingTests();
  await tdgsTests();
  await archetypeExtrasTests();
  await archetypeExtras2Tests();

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

// ---------------------------------------------------------------- Raging Battle (RGBT)

async function rgbtTests() {
  const pebble = findCard('Rules Test Pebble') ?? normal('Rules Test Pebble', 'EARTH', 'Rock', 2, 400, 400);
  const CORE = "Iron Core of Koa'ki Meiru";

  await test("RGBT: Iron Core of Koa'ki Meiru — replaces the draw from the GY, then pays a Koa'ki Meiru upkeep", async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    g.turn = 3;
    const core = place(0, cardByName(CORE), 'grave');
    const crusader = place(0, cardByName("Koa'ki Meiru Crusader"), 'mzone');
    const deckBefore = g.players[0].deck.length;
    await g.playTurn();
    eq(g.players[0].deck.length, deckBefore, 'no normal draw');
    eq(crusader.location, 'mzone', 'Crusader kept');
    eq(core.location, 'grave', 'Iron Core sent for the upkeep');
  });

  await test("RGBT: Iron Core works with Boulder, Core Compression and Koa'ki Meiru Tornado", async () => {
    const a = setup();
    const boulder = a.place(1, cardByName("Koa'ki Meiru Boulder"), 'mzone');
    const deckCore = a.place(1, cardByName(CORE), 'deck');
    await a.g.conductAttack(0, a.place(0, T.brute, 'mzone'));
    eq(boulder.location, 'grave', 'Boulder destroyed');
    eq(deckCore.location, 'hand', 'Boulder searched Iron Core');

    const b = setup();
    const cc = b.place(0, cardByName('Core Compression'), 'hand');
    const core = b.place(0, cardByName(CORE), 'hand');
    const drago = b.place(0, cardByName("Koa'ki Meiru Drago"), 'hand');
    await activateCard(b.g, 0, cc);
    eq(drago.location, 'grave', "Koa'ki Meiru discarded");
    eq(core.location, 'hand', 'Iron Core only revealed');
    eq(b.g.players[0].hand.length, 3, 'drew 2');

    const c = setup();
    const tornado = c.place(0, cardByName("Koa'ki Meiru Tornado"), 'mzone');
    const core2 = c.place(0, cardByName(CORE), 'hand');
    const ss = c.place(1, T.brute, 'mzone');
    ss.summonMethod = 'special';
    await activateCard(c.g, 0, tornado);
    eq(ss.location, 'grave', 'Special Summoned monster destroyed');
    const deck = c.g.players[0].deck;
    eq(deck[deck.length - 1], core2, 'Iron Core on top of the Deck');
  });

  await test("RGBT: Iron Core cannot be activated; Koa'ki Meiru Valafar — 1-Tribute Summon, immune to Trap destruction", async () => {
    const { g, place } = setup();
    const core = place(0, cardByName(CORE), 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === core), false, 'Iron Core has no activation');
    const ice = place(0, cardByName("Koa'ki Meiru Ice"), 'mzone');
    const val = place(0, cardByName("Koa'ki Meiru Valafar"), 'hand');
    eq(g.canNormalSummon(0, val), true, "can Tribute Summon with 1 Koa'ki Meiru");
    await g.performAction(0, { type: 'summon', card: val });
    eq(val.location, 'mzone', 'Valafar summoned');
    eq(ice.location, 'grave', 'Ice tributed');
    const mf = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    await g.destroy([val], 'effect', 1, mf);
    eq(val.location, 'mzone', 'not destroyed by a Trap');
    const dh = place(1, cardByName('Dark Hole'), 'hand');
    await g.destroy([val], 'effect', 1, dh);
    eq(val.location, 'grave', 'destroyed by a Spell');
  });

  await test("RGBT: Koa'ki Meiru Drago — no LIGHT/DARK Special Summons; G.B. Hunter — field cards stay out of the Deck", async () => {
    const { g, place } = setup();
    ensureRgbtPatches(g);
    place(0, cardByName("Koa'ki Meiru Drago"), 'mzone');
    const dark = place(0, T.dark, 'grave');
    const earth = place(0, T.brute, 'grave');
    eq((await g.specialSummon([dark], 0, { pos: 'atk' })).length, 0, 'DARK monster not summoned');
    eq((await g.specialSummon([earth], 0, { pos: 'atk' })).length, 1, 'EARTH monster summoned');
    place(1, cardByName('G.B. Hunter'), 'mzone');
    const victim = place(1, T.wall, 'mzone');
    const inHand = place(1, T.wall, 'hand');
    await g.toDeck([victim, inHand], 'effect', 'shuffle', 0);
    eq(victim.location, 'mzone', 'field card not returned');
    eq(inHand.location, 'deck', 'hand card returned');
  });

  await test('RGBT: Grave of the Super Ancient Organism — Special Summoned Level 6+ monsters cannot attack or activate effects', async () => {
    const { g, place } = setup();
    ensureRgbtPatches(g);
    const st = place(1, cardByName('Grave of the Super Ancient Organism'), 'szone', { faceUp: true });
    st.activeOnField = true;
    const gig = place(0, cardByName('Master Gig'), 'mzone');
    place(1, T.wall, 'mzone');
    gig.summonMethod = 'special';
    eq(g.canAttack(gig), false, 'cannot attack');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === gig), false, 'cannot activate');
    gig.summonMethod = 'tribute';
    eq(g.canAttack(gig), true, 'Tribute Summoned one can attack');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === gig), true, 'and activate');
  });

  await test("RGBT: Fake Feather copies Mirror Force from the opponent's GY", async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const b = place(0, T.dark, 'mzone');
    place(0, cardByName('Mirror Force'), 'grave');
    const ff = place(1, cardByName('Fake Feather'), 'szone', { faceUp: false });
    const bw = place(1, cardByName('Blackwing - Gale the Whirlwind'), 'hand');
    c1.respond = respondWith('Fake Feather');
    await g.conductAttack(0, a);
    eq(bw.location, 'grave', 'Blackwing sent as cost');
    eq(a.location, 'grave', 'attacker destroyed');
    eq(b.location, 'grave', 'other attacker destroyed');
    eq(ff.location, 'grave', 'Fake Feather to GY');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  await test('RGBT: Crimson Fire doubles and reflects burn; Spell of Pain reflects it', async () => {
    const { g, c1, place } = setup();
    ensureRgbtPatches(g);
    place(1, cardByName('Red Dragon Archfiend'), 'mzone');
    place(1, cardByName('Crimson Fire'), 'szone', { faceUp: false });
    c1.respond = respondWith('Crimson Fire');
    await activateCard(g, 0, place(0, cardByName('Ookazi'), 'hand'));
    eq(g.players[1].lp, 8000, 'no damage to the Crimson Fire player');
    eq(g.players[0].lp, 8000 - 1600, 'twice the damage reflected');
    c1.respond = respondWith('Spell of Pain');
    place(1, cardByName('Spell of Pain'), 'szone', { faceUp: false });
    await activateCard(g, 0, place(0, cardByName('Ookazi'), 'hand'));
    eq(g.players[1].lp, 8000, 'Spell of Pain: no damage');
    eq(g.players[0].lp, 8000 - 1600 - 800, 'damage reflected');
  });

  await test('RGBT: Hardened Armed Dragon — the Level 7+ monster Tributed with it cannot be destroyed by card effects', async () => {
    const { g, place } = setup();
    place(0, cardByName('Hardened Armed Dragon'), 'mzone');
    place(0, T.brute, 'mzone');
    const giant = place(0, T.giant, 'hand');
    await g.performAction(0, { type: 'summon', card: giant });
    eq(giant.location, 'mzone', 'Tribute Summoned');
    await g.destroy([giant], 'effect', 1);
    eq(giant.location, 'mzone', 'not destroyed by a card effect');
  });

  await test('RGBT: Emissary from Pandemonium — 1 Tribute: Level 5, 1300/900; Level Warrior Levels', async () => {
    const { g, place } = setup();
    place(0, T.brute, 'mzone');
    const em = place(0, cardByName('Emissary from Pandemonium'), 'hand');
    eq(g.canNormalSummon(0, em), true, 'summonable with 1 Tribute');
    await g.performAction(0, { type: 'summon', card: em });
    eq(em.location, 'mzone', 'summoned');
    eq(g.getLevel(em), 5, 'Level 5');
    eq(g.getAtk(em), 1300, 'ATK halved');
    eq(g.getDef(em), 900, 'DEF halved');

    const b = setup();
    const lw = b.place(0, cardByName('Level Warrior'), 'hand');
    await b.g.performAction(0, { type: 'summon', card: lw });
    eq(b.g.getLevel(lw), 2, 'Normal Summoned onto an empty field: Level 2');
    const c = setup();
    c.place(1, T.brute, 'mzone');
    const lw2 = c.place(0, cardByName('Level Warrior'), 'hand');
    const proc = c.g.legalMainActions(0).find((x) => x.type === 'proc' && x.card === lw2)!;
    await c.g.performAction(0, proc);
    eq(lw2.location, 'mzone', 'Special Summoned');
    eq(c.g.getLevel(lw2), 4, 'Level 4');
  });

  await test('RGBT: Mermaid Archer equips a Level 3 monster (+800) and destroys it instead', async () => {
    const { g, place } = setup();
    const ma = place(0, cardByName('Mermaid Archer'), 'mzone');
    const small = place(0, cardByName('Spined Gillman'), 'mzone');
    await activateCard(g, 0, ma);
    eq(small.location, 'szone', 'equipped');
    eq(g.getAtk(ma), 2000, '1200 + 800');
    await g.destroy([ma], 'effect', 1);
    eq(ma.location, 'mzone', 'Archer survives');
    eq(small.location, 'grave', 'equipped monster destroyed instead');
  });

  await test('RGBT: Sphere of Chaos survives one battle per turn', async () => {
    const { g, place } = setup();
    const sp = place(1, cardByName('Sphere of Chaos'), 'mzone', { pos: 'def' });
    const a1 = place(0, T.brute, 'mzone');
    const a2 = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a1);
    eq(sp.location, 'mzone', 'first battle: survives');
    await g.conductAttack(0, a2);
    eq(sp.location, 'grave', 'second battle: destroyed');
  });

  await test('RGBT: Torapart — Warrior Synchros only; their attacks cannot be answered with Traps', async () => {
    const { g, c1, place } = setup();
    place(0, cardByName('Torapart'), 'mzone');
    place(0, T.brute, 'mzone');
    const goyo = place(0, cardByName('Gaia Knight, the Force of Earth'), 'extra');
    eq(g.canSynchro(0, goyo), true, 'Gaia Knight (Warrior) can use Torapart');
    await g.performAction(0, { type: 'synchro', card: goyo });
    eq(goyo.location, 'mzone', 'Gaia Knight summoned');
    place(1, T.wall, 'mzone', { pos: 'def' });
    const mf = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mirror Force');
    await g.conductAttack(0, goyo);
    eq(mf.location, 'szone', 'Mirror Force could not be activated');
    eq(goyo.location, 'mzone', 'Gaia Knight survives');

    const b = setup();
    b.place(0, cardByName('Torapart'), 'mzone');
    const gish = b.place(0, cardByName('Sea Dragon Lord Gishilnodon'), 'extra');
    b.place(0, cardByName('Spined Gillman'), 'mzone');
    eq(b.g.canSynchro(0, gish), false, 'not for a non-Warrior Synchro');
  });

  await test('RGBT: Natural Tune makes a Normal Monster a Tuner; Sea Dragon Lord Gishilnodon becomes 3000 ATK', async () => {
    const { g, place } = setup();
    const brute = place(0, T.brute, 'mzone');
    const peb = place(0, pebble, 'mzone');
    const goyo = g.players[0].extra[0];
    eq(g.canSynchro(0, goyo), false, 'no Tuner yet');
    await activateCard(g, 0, place(0, cardByName('Natural Tune'), 'hand'));
    eq([brute, peb].filter((c) => c.isTuner).length, 1, 'one Normal Monster treated as a Tuner');
    eq(g.canSynchro(0, goyo), true, 'Synchro now possible');

    const b = setup();
    const gish = b.place(0, cardByName('Sea Dragon Lord Gishilnodon'), 'mzone');
    const small = b.place(1, pebble, 'mzone');
    await b.g.destroy([small], 'effect', 0);
    await b.g.processTriggers(false);
    eq(b.g.getAtk(gish), 3000, 'ATK becomes 3000');
  });

  await test("RGBT: Koa'ki Meiru Doom negates a DARK monster's effect in the Main Phase", async () => {
    const { g, place } = setup();
    place(1, cardByName("Koa'ki Meiru Doom"), 'mzone');
    const thorn = place(0, cardByName('Evil Thorn'), 'mzone');
    await activateCard(g, 0, thorn);
    eq(thorn.location, 'grave', 'Evil Thorn Tributed (cost)');
    eq(g.players[1].lp, 8000, 'its 300 damage was negated');
  });

  await test('RGBT: Wicked Rebirth — Synchro revived with negated effects, destroyed with the Trap', async () => {
    const { g, place } = setup();
    const goyo = g.players[0].extra[0];
    g.rawMove(goyo, 'grave');
    goyo.properlySummoned = true;
    const wr = place(0, cardByName('Wicked Rebirth'), 'szone', { faceUp: false });
    await activateCard(g, 0, wr);
    eq(goyo.location, 'mzone', 'Synchro revived');
    eq(g.players[0].lp, 7200, '800 LP paid');
    eq(g.isNegated(goyo), true, 'effects negated');
    eq(g.canAttack(goyo), false, 'cannot attack this turn');
    await g.destroy([wr], 'effect', 1);
    eq(goyo.location, 'grave', 'destroyed with Wicked Rebirth');
  });

  await test('RGBT: Miracle Locus — +1000, a second attack only on monsters, no battle damage to the opponent', async () => {
    const { g, place } = setup();
    ensureRgbtPatches(g);
    const a = place(0, T.brute, 'mzone');
    place(1, T.wall, 'mzone');
    const ml = place(0, cardByName('Miracle Locus'), 'szone', { faceUp: false });
    await activateCard(g, 0, ml);
    eq(g.getAtk(a), 2800, '+1000 ATK');
    eq(g.players[1].hand.length, 1, 'opponent drew 1');
    await g.conductAttack(0, a);
    eq(g.players[1].lp, 8000, 'no battle damage');
    eq(g.canAttack(a), true, 'can attack again');
    eq(g.attackTargets(a).direct, false, 'second attack cannot be direct');
  });

  await test('RGBT: Rockstone Warrior — no battle damage; 2 Rockstone Tokens when destroyed attacking', async () => {
    const { g, place } = setup();
    const rw = place(0, cardByName('Rockstone Warrior'), 'mzone');
    place(1, T.giant, 'mzone');
    await g.conductAttack(0, rw);
    eq(rw.location, 'grave', 'destroyed');
    eq(g.players[0].lp, 8000, 'no battle damage');
    const toks = g.monsters(0).filter((c) => c.name === 'Rockstone Token');
    eq(toks.length, 2, '2 Tokens');
    eq(g.tributeCandidates(0).filter((c) => toks.includes(c)).length, 0, 'cannot be Tributed for a Tribute Summon');
  });

  await test('RGBT: Delta Crow - Anti Reverse from the hand with exactly 3 Blackwings', async () => {
    const { g, place } = setup();
    const dc = place(0, cardByName('Delta Crow - Anti Reverse'), 'hand');
    const set1 = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    place(0, cardByName('Blackwing - Gale the Whirlwind'), 'mzone');
    place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === dc), false, 'not from the hand with 2 Blackwings');
    place(0, cardByName('Blackwing - Shura the Blue Flame'), 'mzone');
    await activateCard(g, 0, dc);
    eq(set1.location, 'grave', 'Set card destroyed');
  });
}

// ---------------------------------------------------------------- Crimson Crisis (CRMS)

async function crmsTests() {
  const five = findCard('Rules Test Five') ?? normal('Rules Test Five', 'EARTH', 'Warrior', 5, 2100, 1000);
  const seven = findCard('Rules Test Seven') ?? normal('Rules Test Seven', 'EARTH', 'Dragon', 7, 2600, 2000);
  const faceUpST = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const setThisTurn = (g: Game, c: CardInstance) => {
    c.setTurn = g.turn;
    return c;
  };

  await test('CRMS: Assault Mode Activate needs Night Wing Sorceress to be used the turn it is Set; Tributes RDA for RDA/Assault Mode', async () => {
    const { g, place } = setup();
    ensureCrmsPatches(g);
    const rda = place(0, cardByName('Red Dragon Archfiend'), 'mzone');
    rda.properlySummoned = true;
    const am = place(0, cardByName('Red Dragon Archfiend/Assault Mode'), 'deck');
    const ama = setThisTurn(g, place(0, cardByName('Assault Mode Activate'), 'szone', { faceUp: false }));
    eq(g.getActivations(0, { open: true }).some((a) => a.card === ama), false, 'not activatable the turn it is Set');
    place(0, cardByName('Night Wing Sorceress'), 'mzone');
    await activateCard(g, 0, ama);
    eq(rda.location, 'grave', 'Red Dragon Archfiend Tributed');
    eq(am.location, 'mzone', 'Assault Mode summoned from the Deck');
    eq(am.pos, 'atk', 'in Attack Position');
    eq(g.canNormalSummon(0, place(0, cardByName('Colossal Fighter/Assault Mode'), 'hand')), false, '/Assault Mode cannot be Normal Summoned');
  });

  await test('CRMS: Red Dragon Archfiend/Assault Mode wipes the field after attacking and revives Red Dragon Archfiend when destroyed', async () => {
    const { g, place } = setup();
    const am = place(0, cardByName('Red Dragon Archfiend/Assault Mode'), 'mzone');
    const mine = place(0, T.brute, 'mzone');
    const a = place(1, T.wall, 'mzone', { pos: 'def' });
    const b = place(1, T.dark, 'mzone');
    const rda = place(0, cardByName('Red Dragon Archfiend'), 'grave');
    rda.properlySummoned = true;
    await g.conductAttack(0, am);
    eq(a.location, 'grave', 'battled monster destroyed');
    eq(b.location, 'grave', 'other opponent monster destroyed');
    eq(mine.location, 'grave', 'own other monster destroyed');
    eq(am.location, 'mzone', 'Assault Mode survives');
    await g.destroy([am], 'effect', 1);
    await g.processTriggers(false);
    eq(rda.location, 'mzone', 'Red Dragon Archfiend revived');
  });

  await test('CRMS: Hyper Synchron gives a Dragon Synchro 800 ATK, banished in the End Phase', async () => {
    const { g, place } = setup();
    place(0, cardByName('Hyper Synchron'), 'mzone');
    place(0, T.brute, 'mzone');
    const rda = place(0, cardByName('Red Dragon Archfiend'), 'extra');
    eq(g.canSynchro(0, rda), true, 'can Synchro Summon');
    await g.performAction(0, { type: 'synchro', card: rda });
    eq(g.getAtk(rda), 3800, '3000 + 800');
    await (g as any).setPhase('end');
    eq(rda.location, 'banished', 'banished in the End Phase');
  });

  await test('CRMS: Turret Warrior gains the Tributed Warrior\'s original ATK', async () => {
    const { g, place } = setup();
    const w = place(0, T.brute, 'mzone');
    const tw = place(0, cardByName('Turret Warrior'), 'hand');
    const act = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === tw)!;
    eq(!!act, true, 'proc available');
    await g.performAction(0, act);
    eq(w.location, 'grave', 'Warrior tributed');
    eq(tw.location, 'mzone', 'Turret Warrior summoned');
    eq(g.getAtk(tw), 3000, '1200 + 1800');
  });

  await test('CRMS: Summon Reactor・SK burns 800 once per turn and can then negate an attack', async () => {
    const { g, c1, place } = setup();
    const sk = place(1, cardByName('Summon Reactor・SK'), 'mzone');
    await g.performAction(0, { type: 'summon', card: place(0, T.brute, 'hand') });
    eq(g.players[0].lp, 7200, '800 damage for the first summon');
    g.players[0].normalSummonsLeft = 1;
    await g.performAction(0, { type: 'summon', card: place(0, T.dark, 'hand') });
    eq(g.players[0].lp, 7200, 'only the first time each turn');
    const atk = g.monsters(0).find((c) => c.name === 'Rules Test Brute')!;
    c1.respond = respondWith('Summon Reactor・SK');
    g.phase = 'battle';
    await g.conductAttack(0, atk);
    eq(sk.location, 'mzone', 'Summon Reactor・SK survives');
    eq(g.players[1].lp, 8000, 'attack negated');
  });

  await test('CRMS: Summon Reactor・SK + the other Reactors summon Flying Fortress SKY FIRE, which destroys a Set Spell/Trap', async () => {
    const { g, c1, place } = setup();
    ensureCrmsPatches(g);
    const sk = place(0, cardByName('Summon Reactor・SK'), 'mzone');
    place(0, cardByName('Trap Reactor・Y FI'), 'mzone');
    place(0, cardByName('Spell Reactor・RE'), 'mzone');
    const sf = place(0, cardByName('Flying Fortress SKY FIRE'), 'deck');
    await activateCard(g, 0, sk, 'Summon Flying Fortress SKY FIRE');
    eq(sf.location, 'mzone', 'SKY FIRE summoned');
    eq(g.monsters(0).length, 1, 'the three Reactors were sent to the GY');
    // Opponent's turn: they Set a Spell.
    g.turnPlayer = 1;
    g.turn = 3;
    const set = place(1, cardByName('Dark Hole'), 'hand');
    void c1;
    const c0 = g.controllers[0] as any;
    c0.respond = respondWith('Flying Fortress SKY FIRE');
    await g.performAction(1, { type: 'setST', card: set });
    eq(set.location, 'grave', 'Set card destroyed');
    eq(g.players[1].lp, 7200, '800 damage');
  });

  await test('CRMS: Hydra Viper Tributes an Aqua-Type monster for each attack', async () => {
    const { g, place } = setup();
    ensureCrmsPatches(g);
    const hv = place(0, cardByName('Hydra Viper'), 'mzone');
    const frog = place(0, cardByName('Submarine Frog'), 'mzone');
    await g.conductAttack(0, hv);
    eq(frog.location, 'grave', 'Aqua Tributed');
    eq(g.players[1].lp, 8000 - 1800, 'direct attack');
    eq(g.canAttack(hv), false, 'no Aqua left: cannot attack again');
  });

  await test('CRMS: Dimension Fortress Weapon stops cards going from the Deck to the GY', async () => {
    const { g, place } = setup();
    ensureCrmsPatches(g);
    place(1, cardByName('Dimension Fortress Weapon'), 'mzone');
    const n = g.players[0].deck.length;
    await g.mill(0, 3);
    eq(g.players[0].deck.length, n, 'nothing milled');
    eq(g.players[0].grave.length, 0, 'GY empty');
  });

  await test('CRMS: Star Blast lowers a Level 5 monster in hand so it can be Normal Summoned without Tributing', async () => {
    const { g, place } = setup();
    const m = place(0, five, 'hand');
    const sb = place(0, cardByName('Star Blast'), 'hand');
    eq(g.canNormalSummon(0, m), false, 'needs a Tribute');
    await activateCard(g, 0, sb);
    eq(g.players[0].lp, 7500, 'paid 500');
    eq(g.canNormalSummon(0, m), true, 'no Tribute needed');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.location, 'mzone', 'summoned');
    eq(g.getLevel(m), 4, 'Level stays reduced on the field this turn');
  });

  await test('CRMS: Ido stops your Summons and revives itself the next Standby Phase, destroying your other monsters', async () => {
    const { g, place } = setup();
    ensureCrmsPatches(g);
    const ido = place(0, cardByName('Ido the Supreme Magical Force'), 'mzone');
    const b = place(0, T.brute, 'hand');
    eq(g.canNormalSummon(0, b), false, 'cannot Normal Summon');
    eq(g.legalMainActions(0).some((a) => a.type === 'set'), false, 'cannot Set a monster');
    await g.destroy([ido], 'effect', 1);
    const other = place(0, T.dark, 'mzone');
    g.turn = 3;
    g.turnPlayer = 1;
    await (g as any).setPhase('standby');
    eq(ido.location, 'mzone', 'Ido revived');
    eq(other.location, 'grave', 'other monster destroyed');
  });

  await test('Ehren, Lightsworn Monk: a Defense Position monster it attacks goes back to the Deck, even one it destroys (no GY effects)', async () => {
    const { g, place } = setup();
    const ehren = place(0, cardByName('Ehren, Lightsworn Monk'), 'mzone');
    const qd = place(1, cardByName('Quickdraw Synchron'), 'mzone', { pos: 'def' });
    await g.conductAttack(0, ehren);
    eq(qd.location, 'deck', 'Quickdraw Synchron (DEF 1400) shuffled into the Deck, not the GY');
    eq(g.players[1].grave.includes(qd), false, 'not in the GY');
    const { g: g2, place: place2 } = setup();
    const e2 = place2(0, cardByName('Ehren, Lightsworn Monk'), 'mzone');
    const sangan = place2(1, cardByName('Sangan'), 'mzone', { pos: 'def' });
    const before = g2.players[1].hand.length;
    await g2.conductAttack(0, e2);
    eq(sangan.location, 'deck', 'Sangan back to the Deck');
    eq(g2.players[1].hand.length, before, 'Sangan does not search (never sent to the GY)');
    const { g: g3, place: place3 } = setup();
    const e3 = place3(0, cardByName('Ehren, Lightsworn Monk'), 'mzone');
    const wall = place3(1, T.wall, 'mzone', { pos: 'def' });
    await g3.conductAttack(0, e3);
    eq(wall.location, 'deck', 'a monster that survives the battle is returned too');
    const { g: g4, place: place4 } = setup();
    const e4 = place4(0, cardByName('Ehren, Lightsworn Monk'), 'mzone');
    const atk = place4(1, T.wall, 'mzone');
    await g4.conductAttack(0, e4);
    eq(atk.location, 'grave', 'an Attack Position monster is destroyed, not returned');
  });

  await test('Plaguespreader Zombie: offered in your Standby Phase only (a hand card goes on top of the Deck); not in the Main Phase', async () => {
    const { g, c0, place } = setup();
    const pz = place(0, cardByName('Plaguespreader Zombie'), 'grave');
    const h1 = place(0, T.brute, 'hand');
    let asked = 0;
    c0.confirmTrigger = async () => (asked++, true);
    eq(g.legalMainActions(0).some((x) => x.type === 'activate' && x.card === pz), false, 'no Main Phase activation from the GY');
    g.turn = 3;
    await (g as any).setPhase('standby');
    eq(asked, 1, 'asked once in the Standby Phase');
    eq(pz.location, 'mzone', 'Special Summoned');
    eq(pz.banishOnLeave, true, 'banished when it leaves the field');
    eq(g.players[0].deck[g.players[0].deck.length - 1] === h1 || g.players[0].deck[0] === h1, true, 'hand card on top of the Deck');
  });

  await test('CRMS: Alien Kid places A-Counters; the countered monster loses 300 ATK when battling an Alien', async () => {
    const { g, place } = setup();
    const kid = place(0, cardByName('Alien Kid'), 'mzone');
    const b = place(1, T.brute, 'hand');
    await g.specialSummon([b], 1, { pos: 'atk' });
    await g.processTriggers(false);
    eq(b.counters.A ?? 0, 1, 'A-Counter placed');
    eq(g.getAtk(b), 1800, 'no loss outside damage calculation');
    await g.conductAttack(0, kid);
    eq(b.location, 'grave', '1600 beats 1800 - 300');
    eq(g.players[1].lp, 8000 - 100, '100 damage');
  });

  await test('CRMS: Desert Protector is destroyed instead of another Insect', async () => {
    const { g, c0, place } = setup();
    const dp = place(0, cardByName('Desert Protector'), 'mzone');
    const beetle = place(0, cardByName('Cross-Sword Beetle'), 'mzone');
    place(0, cardByName('Mirror Force'), 'szone', { faceUp: false });
    eq(g.getDef(dp), 1300, '+300 DEF per Spell/Trap');
    c0.pick = (_g, req) => req.candidates.slice(0, Math.max(1, req.min));
    await g.destroy([beetle], 'effect', 1);
    eq(beetle.location, 'mzone', 'Beetle saved');
    eq(dp.location, 'grave', 'Desert Protector destroyed instead');
  });

  await test('CRMS: Spirit Force makes the battle damage 0 and returns a Warrior Tuner', async () => {
    const { g, c1, place } = setup();
    ensureCrmsPatches(g);
    const a = place(0, T.brute, 'mzone');
    place(1, cardByName('Spirit Force'), 'szone', { faceUp: false });
    const t = place(1, tuner, 'grave');
    c1.respond = respondWith('Spirit Force');
    await g.conductAttack(0, a);
    eq(g.players[1].lp, 8000, 'no battle damage');
    eq(t.location, 'hand', 'Warrior Tuner added');
  });

  await test('CRMS: Dark Voltanis comes out after a Counter Trap resolves', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const dark = place(0, T.dark, 'mzone');
    const volt = place(0, cardByName('Dark Voltanis'), 'hand');
    place(0, cardByName('Solemn Judgment'), 'szone', { faceUp: false });
    const victim = place(1, T.wall, 'mzone');
    ensureCrmsPatches(g);
    c0.respond = respondWith('Solemn Judgment');
    const dh = place(1, cardByName('Dark Hole'), 'hand');
    await activateCard(g, 1, dh);
    eq(dh.location, 'grave', 'Dark Hole negated');
    eq(dark.location, 'grave', 'DARK monster Tributed');
    eq(volt.location, 'mzone', 'Dark Voltanis summoned');
    eq(victim.location, 'grave', '1 card destroyed');
  });

  await test('CRMS: Psychic Tuning summons a Psychic as a Tuner; losing it burns Level x 400', async () => {
    const { g, place } = setup();
    const m = place(0, cardByName('Lifeforce Harmonizer'), 'grave');
    const pt = place(0, cardByName('Psychic Tuning'), 'szone', { faceUp: false });
    await activateCard(g, 0, pt);
    eq(m.location, 'mzone', 'Psychic summoned');
    eq(m.isTuner, true, 'treated as a Tuner');
    await g.destroy([pt], 'effect', 1);
    await g.processTriggers(false);
    eq(m.location, 'grave', 'monster destroyed with the card');
    eq(m.isTuner, false, 'no longer a Tuner');
    eq(g.players[0].lp, 8000 - 800, 'Level 2 x 400 damage');
  });

  await test('CRMS: Totem Dragon counts as 2 Tributes for a Dragon; Blackwing - Sirocco is Normal Summoned without Tributing', async () => {
    const { g, place } = setup();
    const totem = place(0, cardByName('Totem Dragon'), 'mzone');
    const dragon = place(0, seven, 'hand');
    eq(g.canNormalSummon(0, dragon), true, 'Level 7 Dragon with 1 Tribute');
    await g.performAction(0, { type: 'summon', card: dragon });
    eq(totem.location, 'grave', 'Totem Dragon Tributed');
    eq(dragon.location, 'mzone', 'Dragon summoned');
    const s = setup();
    s.place(1, T.wall, 'mzone');
    const sir = s.place(0, cardByName('Blackwing - Sirocco the Dawn'), 'hand');
    eq(s.g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === sir), false, 'no Special Summon procedure');
    await s.g.performAction(0, { type: 'summon', card: sir });
    eq(sir.location, 'mzone', 'Normal Summoned without Tributing');
    eq(sir.summonMethod, 'normal', 'Normal Summon');
  });

  await test('CRMS: Nightmare Archfiends gives 3 Tokens; each destroyed one burns its controller 800', async () => {
    const { g, place } = setup();
    const b = place(0, T.brute, 'mzone');
    const na = place(0, cardByName('Nightmare Archfiends'), 'szone', { faceUp: false });
    await activateCard(g, 0, na);
    eq(b.location, 'grave', 'monster Tributed');
    const toks = g.monsters(1).filter((c) => c.name === 'Nightmare Archfiend Token');
    eq(toks.length, 3, '3 Tokens on the opponent\'s field');
    await g.destroy([toks[0]], 'effect', 0);
    await g.processTriggers(false);
    eq(g.players[1].lp, 7200, '800 damage to their controller');
  });

  await test('CRMS: Greed Quasar grows by the Level of the monster it destroys', async () => {
    const { g, place } = setup();
    const q = place(0, cardByName('Greed Quasar'), 'mzone');
    eq(g.getAtk(q), 2100, 'Level 7 x 300');
    place(1, T.dark, 'mzone');
    await g.conductAttack(0, q);
    eq(g.getLevel(q), 11, 'Level 7 + 4');
    eq(g.getAtk(q), 3300, 'Level 11 x 300');
  });

  await test('CRMS: B.E.S. Big Core MK-2 loses a counter per battle and is destroyed when it has none', async () => {
    const { g, place } = setup();
    const bes = place(0, cardByName('B.E.S. Big Core MK-2'), 'hand');
    eq(g.canNormalSummon(0, bes), true, 'no Tribute with an empty field');
    await g.specialSummon([bes], 0, { pos: 'atk' });
    await g.processTriggers(false);
    eq(bes.counters.bes, 3, '3 counters');
    place(1, cardByName('Rules Test Giant'), 'mzone');
    await g.conductAttack(0, bes);
    eq(bes.location, 'mzone', 'not destroyed by battle');
    eq(bes.counters.bes, 2, '1 counter removed');
  });

  await test('CRMS: Morphtronic Slingen in Defense Position destroys another Morphtronic instead', async () => {
    const { g, place } = setup();
    const sl = place(0, cardByName('Morphtronic Slingen'), 'mzone', { pos: 'def' });
    const bo = place(0, cardByName('Morphtronic Boarden'), 'mzone');
    await g.destroy([sl], 'effect', 1);
    eq(sl.location, 'mzone', 'Slingen survives');
    eq(bo.location, 'grave', 'Boarden destroyed instead');
  });

  await test('CRMS: Prevention Star locks a monster and banishes it when the equipped monster is destroyed', async () => {
    const { g, c0, place } = setup();
    ensureCrmsPatches(g);
    const m = place(0, T.wall, 'mzone');
    const opp = place(1, T.brute, 'mzone');
    await g.performAction(0, { type: 'position', card: m });
    const ps = place(0, cardByName('Prevention Star'), 'hand');
    c0.pick = (_g, req) => req.candidates.slice(0, Math.max(1, req.min));
    await activateCard(g, 0, ps);
    eq(ps.equippedTo, m.uid, 'equipped');
    g.turnPlayer = 1;
    eq(g.canAttack(opp), false, 'selected monster cannot attack');
    await g.destroy([m], 'effect', 1);
    await g.processTriggers(false);
    eq(opp.location, 'banished', 'selected monster removed from play');
  });

  await test('CRMS: Arcanite Magician/Assault Mode gets 2 Spell Counters (2900 ATK) and removes them to destroy all opponent\'s cards', async () => {
    const { g, place } = setup();
    const arc = place(0, cardByName('Arcanite Magician'), 'mzone');
    arc.properlySummoned = true;
    place(0, cardByName('Arcanite Magician/Assault Mode'), 'deck');
    place(0, cardByName('Assault Mode Activate'), 'szone', { faceUp: false });
    const a = place(1, T.brute, 'mzone');
    const b = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    await activateCard(g, 0, g.players[0].szone.find((c) => c?.name === 'Assault Mode Activate')!);
    const am = g.monsters(0).find((c) => c.name === 'Arcanite Magician/Assault Mode')!;
    eq(g.getAtk(am), 2900, '900 + 2 x 1000');
    await activateCard(g, 0, am);
    eq(a.location, 'grave', 'monster destroyed');
    eq(b.location, 'grave', 'Spell/Trap destroyed');
    eq(g.getAtk(am), 900, 'counters removed');
  });

  await test('CRMS: Doomkaiser Dragon/Assault Mode revives Zombies from both GYs with effects negated (Bone Crusher cannot trigger); all die in the End Phase', async () => {
    const { g, c0, place } = setup();
    const am = place(0, cardByName('Doomkaiser Dragon/Assault Mode'), 'hand');
    const bc = place(0, cardByName('Bone Crusher'), 'grave');
    const pz = place(1, cardByName('Plaguespreader Zombie'), 'grave');
    const st = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => req.candidates.slice(0, Math.max(req.max, req.min));
    await g.specialSummon([am], 0, { pos: 'atk', ignoreConditions: true, proper: true });
    await g.processTriggers(false);
    eq(bc.location, 'mzone', 'Bone Crusher revived');
    eq(pz.location, 'mzone', 'opponent\'s Zombie revived');
    eq(pz.controller, 0, 'on your side');
    eq(st.location, 'szone', 'negated Bone Crusher cannot destroy a Spell/Trap');
    eq(g.isNegated(pz), true, 'effects negated');
    await (g as any).setPhase('end');
    eq(bc.location, 'grave', 'Bone Crusher destroyed');
    eq(pz.location, 'grave', 'revived Zombie destroyed');
  });

  await test("CRMS: Cosmic Fortress Gol'gar bounces Spells/Traps for A-Counters, then removes 2 to destroy a card", async () => {
    const { g, c0, place } = setup();
    const gg = place(0, cardByName("Cosmic Fortress Gol'gar"), 'mzone');
    const ivy = place(1, cardByName('Ivy Shackles'), 'szone', { faceUp: true });
    ivy.activeOnField = true;
    const v = place(1, T.brute, 'mzone');
    c0.pick = (_g, req) => req.candidates.filter((c) => c.controller === 1).slice(0, Math.max(1, req.min));
    await activateCard(g, 0, gg, 'Return Spells/Traps, place A-Counters');
    eq(ivy.location, 'hand', 'Spell/Trap returned');
    eq(v.counters.A ?? 0, 1, 'A-Counter placed');
    v.counters.A = 2;
    await activateCard(g, 0, gg, 'Remove 2 A-Counters: destroy 1 card');
    eq(v.location, 'grave', 'card destroyed');
  });

  await test('CRMS: Planet Pollutant Virus destroys monsters without A-Counters and counters later Summons', async () => {
    const { g, place } = setup();
    place(0, cardByName('Alien Kid'), 'mzone');
    const a = place(1, T.brute, 'mzone');
    const b = place(1, T.dark, 'mzone');
    b.counters.A = 1;
    const ppv = place(0, cardByName('Planet Pollutant Virus'), 'szone', { faceUp: false });
    await activateCard(g, 0, ppv);
    eq(a.location, 'grave', 'no A-Counter: destroyed');
    eq(b.location, 'mzone', 'with A-Counter: survives');
    g.turnPlayer = 1;
    g.turn = 3;
    const s = place(1, T.wall, 'hand');
    await g.performAction(1, { type: 'summon', card: s });
    eq(s.counters.A ?? 0, 1, 'A-Counter on the new Summon');
  });

  await test('CRMS: Half or Nothing — the opponent ends the Battle Phase or halves their ATK', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'mzone');
    g.phase = 'battle';
    const hon = place(1, cardByName('Half or Nothing'), 'szone', { faceUp: false });
    const act = g.getActivations(1, { open: false }).find((x) => x.card === hon)!;
    eq(!!act, true, 'activatable in the opponent\'s Battle Phase');
    const link = await g.activate(1, act);
    await g.runChain();
    void link;
    // TestController.chooseOption → 0: halve.
    eq(g.getAtk(a), 900, 'ATK halved');
    await (g as any).setPhase('main2');
    eq(g.getAtk(a), 1800, 'restored after the Battle Phase');
  });

  await test('CRMS: Assault Revival destroys your monsters and revives an /Assault Mode monster that is banished when it leaves', async () => {
    const { g, place } = setup();
    const mine = place(0, T.brute, 'mzone');
    place(0, cardByName('Assault Mode Activate'), 'grave');
    const am = place(0, cardByName('Colossal Fighter/Assault Mode'), 'grave');
    const ar = place(0, cardByName('Assault Revival'), 'hand');
    await activateCard(g, 0, ar);
    eq(mine.location, 'grave', 'own monster destroyed');
    eq(am.location, 'mzone', '/Assault Mode revived ignoring conditions');
    eq(g.isNegated(am), true, 'effects negated');
    await g.destroy([am], 'effect', 1);
    eq(am.location, 'banished', 'removed from play when it leaves');
  });

  await test('CRMS: Morphtronic Forcefield negates a Spell that would destroy a Morphtronic and searches', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const bo = place(0, cardByName('Morphtronic Boarden'), 'mzone');
    place(0, cardByName('Morphtronic Forcefield'), 'szone', { faceUp: false });
    const sl = place(0, cardByName('Morphtronic Slingen'), 'deck');
    c0.respond = respondWith('Morphtronic Forcefield');
    const dh = place(1, cardByName('Dark Hole'), 'hand');
    await activateCard(g, 1, dh);
    eq(bo.location, 'mzone', 'Morphtronic survives');
    eq(dh.location, 'grave', 'Dark Hole negated');
    eq(sl.location, 'hand', 'Morphtronic added');
  });

  await test('CRMS: Assault Armor is sent to the GY to let the Warrior attack twice', async () => {
    const { g, place } = setup();
    const w = place(0, T.brute, 'mzone');
    const aa = place(0, cardByName('Assault Armor'), 'hand');
    await activateCard(g, 0, aa);
    eq(g.getAtk(w), 2100, '+300 ATK');
    await activateCard(g, 0, aa);
    eq(aa.location, 'grave', 'sent to the GY');
    eq(g.queryCardNum(w, 'extraAttacks'), 1, 'can attack twice');
  });

  await test('CRMS: Scanner copies a removed-from-play monster until the End Phase and is removed from play if it leaves', async () => {
    const { g, place } = setup();
    const sc = place(0, cardByName('Scanner'), 'mzone');
    place(1, T.giant, 'banished');
    await activateCard(g, 0, sc);
    eq(sc.name, 'Rules Test Giant', 'name copied');
    eq(g.getAtk(sc), 3000, 'ATK copied');
    eq(g.getLevel(sc), 8, 'Level copied');
    await g.destroy([sc], 'effect', 1);
    eq(sc.location, 'banished', 'removed from play');
    eq(sc.name, 'Scanner', 'own name again');
  });

  await test('CRMS: Trap Reactor・Y FI destroys an activated Trap and burns 800', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, cardByName('Trap Reactor・Y FI'), 'mzone');
    const a = place(1, T.brute, 'mzone');
    const mf = place(1, cardByName('Dust Tornado'), 'szone', { faceUp: false });
    place(0, cardByName('Mirror Force'), 'szone', { faceUp: false });
    c0.respond = respondWith('Trap Reactor・Y FI');
    await activateCard(g, 1, mf);
    eq(g.players[1].lp, 7200, '800 damage');
    eq(mf.location, 'grave', 'Trap destroyed');
    void a;
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

// ---------------------------------------------------------------- Light of Destruction (LODT)

async function lodtTests() {
  const lodtSetup = () => {
    const s = setup();
    ensureLodtPatches(s.g);
    return s;
  };
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const gust = findCard('Rules Test Gust') ?? normal('Rules Test Gust', 'WIND', 'Winged Beast', 6, 2200, 1000);
  const battleEnd = async (g: Game) => {
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };
  const LB = cardByName('Light Barrier');

  await test('LODT: Light Barrier picks Heads for The Emperor, Reversal of Fate turns it into Tails', async () => {
    const { g, c0, place } = lodtSetup();
    live(place(0, LB, 'fzone'));
    const mag = place(0, cardByName('Arcana Force I - The Magician'), 'mzone');
    const emp = place(0, cardByName('Arcana Force IV - The Emperor'), 'hand');
    await g.performAction(0, { type: 'summon', card: emp });
    eq(g.getAtk(emp), 1900, 'Emperor (Heads): +500 to itself');
    eq(g.getAtk(mag), 1600, 'Emperor (Heads): +500 to another Arcana Force');
    const rof = place(0, cardByName('Reversal of Fate'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => (req.candidates.includes(emp) ? [emp] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, rof);
    eq(g.getAtk(emp), 900, 'Tails: -500');
    eq(g.getAtk(mag), 600, 'Tails: -500 to the other Arcana Force');
  });

  await test("LODT: Arcana Call — The Emperor uses The Moon's effect until the End Phase", async () => {
    const { g, c0, place } = lodtSetup();
    live(place(0, LB, 'fzone'));
    const emp = place(0, cardByName('Arcana Force IV - The Emperor'), 'hand');
    await g.performAction(0, { type: 'summon', card: emp });
    const moon = place(1, cardByName('Arcana Force XVIII - The Moon'), 'grave');
    const call = place(0, cardByName('Arcana Call'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => (req.candidates.includes(emp) ? [emp] : req.candidates.includes(moon) ? [moon] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, call);
    eq(moon.location, 'banished', 'The Moon banished');
    eq(g.getAtk(emp), 1400, 'the +500 effect is replaced');
    g.turn++;
    eq(g.getAtk(emp), 1900, 'its own effect is back after the turn');
  });

  await test('LODT: Arcana Force EX (Tails) destroys all cards on the field when destroyed', async () => {
    const { g, c0, place } = lodtSetup();
    (c0 as any).chooseOption = async () => 1;
    live(place(0, LB, 'fzone'));
    for (let i = 0; i < 3; i++) place(0, T.wall, 'mzone');
    const ex = place(0, cardByName('Arcana Force EX - The Dark Ruler'), 'hand');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === ex);
    if (!proc) throw new Error('no summoning procedure');
    await g.performAction(0, proc);
    eq(ex.location, 'mzone', 'Special Summoned by sending 3 monsters');
    eq(g.monsters(0).length, 1, 'the 3 monsters were sent');
    const st = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    const om = place(1, T.brute, 'mzone');
    await g.destroy([ex], 'effect', 1);
    await g.processTriggers(false);
    eq(om.location, 'grave', 'monster destroyed');
    eq(st.location, 'grave', 'Spell/Trap destroyed');
    eq((await g.specialSummon([ex], 0, { pos: 'atk' })).length, 0, 'cannot be Special Summoned by a card effect');
  });

  await test('LODT: Arcana Force XIV - Temperance (Heads) halves battle damage you take', async () => {
    const { g, c1, place } = lodtSetup();
    live(place(0, LB, 'fzone'));
    const temp = place(0, cardByName('Arcana Force XIV - Temperance'), 'hand');
    await g.specialSummon([temp], 0, { pos: 'atk' });
    await g.processTriggers(true);
    const wall = place(0, T.wall, 'mzone');
    const a = place(1, T.brute, 'mzone');
    g.turnPlayer = 1;
    c1.chooseAttackTarget = async () => wall;
    await g.conductAttack(1, a);
    eq(g.players[0].lp, 8000 - 650, '1300 damage halved');
  });

  await test("LODT: Arcana Force XXI - The World (Heads) skips the opponent's next turn", async () => {
    const { g, c0, place } = lodtSetup();
    live(place(0, LB, 'fzone'));
    const world = place(0, cardByName('Arcana Force XXI - The World'), 'hand');
    await g.specialSummon([world], 0, { pos: 'atk' });
    await g.processTriggers(true);
    const others = [place(0, T.brute, 'mzone'), place(0, T.dark, 'mzone')];
    c0.pick = (_g, req) => req.candidates.filter((c) => c !== world).slice(0, req.min);
    await (g as any).setPhase('end');
    eq(others.every((c) => c.location === 'grave'), true, '2 monsters sent');
    const hand1 = g.players[1].hand.length;
    await g.playTurn();
    eq(g.turn, 3, 'the skipped turn counts');
    eq(g.players[1].hand.length, hand1, 'the skipped player did not draw');
    await g.playTurn();
    eq(g.turnPlayer, 0, 'the World player takes the next turn');
  });

  await test('LODT: Volcanic Queen — Tributes an opponent monster, lands on their field, burns its controller', async () => {
    const { g, place } = lodtSetup();
    const q = place(0, cardByName('Volcanic Queen'), 'hand');
    const victim = place(1, T.giant, 'mzone');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === q);
    if (!proc) throw new Error('no summoning procedure');
    await g.performAction(0, proc);
    eq(victim.location, 'grave', 'opponent monster Tributed');
    eq(q.location, 'mzone', 'Volcanic Queen on the field');
    eq(q.controller, 1, "on the opponent's field");
    eq(g.canNormalSummon(0, place(0, T.brute, 'hand')), false, 'no Normal Summon this turn');
    g.turnPlayer = 1;
    await (g as any).setPhase('end');
    eq(g.players[1].lp, 7000, 'its controller takes 1000 in their End Phase');
  });

  await test('LODT: Fog King — 1-Tribute Normal Summon, ATK of the Tribute, nothing can be Tributed', async () => {
    const { g, c0, place } = lodtSetup();
    const b = place(0, T.brute, 'mzone');
    const opp = place(1, T.wall, 'mzone');
    const fk = place(0, cardByName('Fog King'), 'hand');
    eq(g.canNormalSummon(0, fk, true), false, 'cannot be Set with 1 Tribute');
    eq(g.canNormalSummon(0, fk), true, 'can be Normal Summoned');
    (c0 as any).chooseOption = async () => 1;
    await g.performAction(0, { type: 'summon', card: fk });
    eq(fk.location, 'mzone', 'summoned');
    eq(b.location, 'grave', '1 Tribute');
    eq(g.getAtk(fk), 1800, 'ATK = original ATK of the Tribute');
    eq(g.tributeCandidates(1).includes(opp), false, 'neither player can Tribute');
  });

  await test('LODT: Simorgh — WIND monsters need 1 less Tribute', async () => {
    const { g, place } = lodtSetup();
    const w = place(0, gust, 'hand');
    eq(g.tributesNeeded(w), 1, 'Level 6 normally needs 1 Tribute');
    place(1, cardByName('Simorgh, Bird of Ancestry'), 'mzone');
    eq(g.tributesNeeded(w), 0, 'Simorgh: no Tribute');
    eq(g.tributesNeeded(place(0, T.giant, 'hand')), 2, 'non-WIND unchanged');
  });

  await test('LODT: Divine Knight Ishzark banishes the monster it destroys by battle', async () => {
    const { g, place } = lodtSetup();
    const ish = place(0, cardByName('Divine Knight Ishzark'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await g.conductAttack(0, ish);
    eq(v.location, 'banished', 'banished');
    eq(g.players[1].lp, 7500, 'battle damage');
  });

  await test("LODT: Miracle Flipper — only it can be attacked; it returns on the destroyer's field", async () => {
    const { g, place } = lodtSetup();
    const flipper = place(1, cardByName('Miracle Flipper'), 'mzone');
    const wall = place(1, T.wall, 'mzone');
    const a = place(0, T.brute, 'mzone');
    const targets = g.attackTargets(a).targets;
    eq(targets.includes(wall), false, 'other face-up monster cannot be attacked');
    eq(targets.includes(flipper), true, 'Miracle Flipper can');
    await g.conductAttack(0, a);
    eq(flipper.location, 'grave', 'destroyed by battle');
    await battleEnd(g);
    eq(flipper.location, 'mzone', 'Special Summoned at the end of the Battle Phase');
    eq(flipper.controller, 0, "on the opponent's field");
  });

  await test('LODT: Interplanetary Invader "A" takes the monster that attacked it', async () => {
    const { g, place } = lodtSetup();
    const inv = place(1, cardByName('Interplanetary Invader "A"'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(inv.location, 'grave', 'Invader destroyed');
    await battleEnd(g);
    eq(a.controller, 1, 'control of the attacker taken');
  });

  await test('LODT: Summon Limit — a third Summon in one turn is not allowed', async () => {
    const { g, place } = lodtSetup();
    live(place(1, cardByName('Summon Limit'), 'szone', { faceUp: true }));
    await g.performAction(0, { type: 'summon', card: place(0, T.brute, 'hand') });
    eq((await g.specialSummon([place(0, T.dark, 'hand')], 0, { pos: 'atk' })).length, 1, 'second Summon allowed');
    const third = place(0, T.wall, 'hand');
    eq((await g.specialSummon([third], 0, { pos: 'atk' })).length, 0, 'third Summon blocked');
    g.players[0].normalSummonsLeft = 1;
    eq(g.canNormalSummon(0, third), false, 'no third Normal Summon');
    eq(g.canNormalSummon(0, third, true), true, 'a Set is not a Summon');
  });

  await test('LODT: Angel O7 Tribute Summoned — monster effects cannot be activated', async () => {
    const { g, c0, place } = lodtSetup();
    const trooper = place(0, cardByName('Card Trooper'), 'mzone');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === trooper), true, 'Card Trooper usable before');
    place(0, T.brute, 'mzone');
    place(0, T.wall, 'mzone');
    const o7 = place(0, cardByName('Angel O7'), 'hand');
    c0.pick = (_g, req) => req.candidates.filter((c) => c !== trooper).slice(0, req.min);
    await g.performAction(0, { type: 'summon', card: o7 });
    eq(o7.location, 'mzone', 'Tribute Summoned');
    eq(g.getActivations(0, { open: true }).some((a) => a.card.isMonster), false, 'no monster effects');
  });

  await test('LODT: Dark General Freed — searches instead of drawing, negates a Spell that targets it', async () => {
    const { g, c1, place } = lodtSetup();
    const freed = place(0, cardByName('Dark General Freed'), 'mzone');
    const dark = place(0, T.dark, 'deck');
    g.phase = 'draw';
    const before = g.players[0].hand.length;
    await g.draw(0, 1);
    eq(dark.location, 'hand', 'Level 4 DARK monster added');
    eq(g.players[0].hand.length, before + 1, 'no card drawn');
    g.phase = 'main1';
    const bom = place(1, cardByName('Book of Moon'), 'szone', { faceUp: false });
    c1.pick = (_g, req) => (req.candidates.includes(freed) ? [freed] : req.candidates.slice(0, req.min));
    await activateCard(g, 1, bom);
    eq(freed.faceUp, true, 'Book of Moon negated');
    eq(bom.location, 'grave', 'Book of Moon in the GY');
    const other = place(0, cardByName('Dark General Freed'), 'grave');
    eq((await g.specialSummon([other], 0, { pos: 'atk' })).length, 0, 'cannot be Special Summoned');
  });

  await test('LODT: Realm of Light — Shine Counters from any Deck-to-GY send, 2 counters instead of destruction', async () => {
    const { g, place } = lodtSetup();
    const realm = live(place(0, cardByName('Realm of Light'), 'fzone'));
    const opp = place(1, cardByName('Ehren, Lightsworn Monk'), 'mzone');
    await g.mill(0, 2);
    eq(realm.counters.light, 1, '1 counter per send');
    eq(g.getAtk(opp), 1700, "boosts the opponent's Lightsworn too");
    realm.counters.light = 2;
    await g.destroy([realm], 'effect', 1);
    eq(realm.location, 'fzone', 'survives');
    eq(realm.counters.light, 0, '2 counters removed');
    await g.destroy([realm], 'effect', 1);
    eq(realm.location, 'grave', 'destroyed without counters');
  });

  await test('LODT: Celestia, Lightsworn Angel — 1 Lightsworn Tribute, send 4, destroy an opponent card', async () => {
    const { g, place } = lodtSetup();
    const jain = place(0, cardByName('Jain, Lightsworn Paladin'), 'mzone');
    const cel = place(0, cardByName('Celestia, Lightsworn Angel'), 'hand');
    const v = place(1, T.brute, 'mzone');
    const deck = g.players[0].deck.length;
    await g.performAction(0, { type: 'summon', card: cel });
    eq(jain.location, 'grave', 'Lightsworn Tributed');
    eq(g.players[0].deck.length, deck - 4, 'top 4 sent');
    eq(v.location, 'grave', 'opponent card destroyed');
  });

  await test('LODT: Sanguine Swamp — no face-down Spell/Trap activations, destroyed when you Set another', async () => {
    const { g, place } = lodtSetup();
    place(1, T.brute, 'grave');
    const call = place(1, cardByName('Call of the Haunted'), 'szone', { faceUp: false });
    const ef = call.data.effects![0];
    eq(!!g.canActivateEffect(1, call, ef, 0, { open: true }), true, 'Call usable before');
    const sw = live(place(0, cardByName('Sanguine Swamp'), 'szone', { faceUp: true }));
    eq(g.canActivateEffect(1, call, ef, 0, { open: true }), null, 'face-down Trap blocked');
    await g.performAction(0, { type: 'setST', card: place(0, cardByName('Dark Hole'), 'hand') });
    eq(sw.location, 'grave', 'Swamp destroyed');
  });

  await test('LODT: Mystical Cards of Light — 2 copies: draw 2 for the normal draw, 1 zone each is locked', async () => {
    const { g, place } = lodtSetup();
    live(place(0, cardByName('Mystical Cards of Light'), 'szone', { faceUp: true }));
    live(place(0, cardByName('Mystical Cards of Light'), 'szone', { faceUp: true }));
    eq(g.freeSZones(0), 1, '5 zones - 2 used - 2 locked');
    g.phase = 'draw';
    const before = g.players[0].hand.length;
    await g.draw(0, 1);
    eq(g.players[0].hand.length, before + 2, 'drew 2');
  });

  await test('LODT: Tualatin — Special Summoned after the Battle Phase wipe, destroys and locks an Attribute', async () => {
    const { g, place } = lodtSetup();
    const tual = place(1, cardByName('Tualatin'), 'hand');
    place(1, T.wall, 'mzone');
    place(1, T.wall, 'mzone');
    const myDark = place(0, T.dark, 'mzone');
    const a1 = place(0, T.brute, 'mzone');
    const a2 = place(0, T.brute, 'mzone');
    await (g as any).setPhase('battle');
    await g.conductAttack(0, a1);
    await g.conductAttack(0, a2);
    eq(tual.location, 'mzone', 'Tualatin Special Summoned');
    eq(myDark.location, 'grave', 'DARK (chosen) monster destroyed');
    eq(g.canNormalSummon(0, place(0, T.dark, 'hand')), false, 'cannot Summon DARK monsters');
    eq(g.canNormalSummon(0, place(0, T.brute, 'hand')), true, 'other Attributes are fine');
  });

  await test('LODT: Union Attack — ATK sum in the Battle Phase only, no battle damage, others cannot attack', async () => {
    const { g, c0, place } = lodtSetup();
    const b = place(0, T.brute, 'mzone');
    const d = place(0, T.dark, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(b) ? [b] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, place(0, cardByName('Union Attack'), 'hand'));
    eq(g.getAtk(b), 1800, 'no boost in the Main Phase');
    g.phase = 'battle';
    eq(g.getAtk(b), 3400, 'boosted in the Battle Phase');
    eq(g.canAttack(d), false, 'the other monster cannot attack');
    await g.conductAttack(0, b);
    eq(g.players[1].lp, 8000, 'no battle damage to the opponent');
  });

  await test('LODT: Magical Exemplar — 2 Spell Counters per Spell, removes 4 to revive a Level 4 Spellcaster', async () => {
    const { g, place } = lodtSetup();
    const ex = place(0, cardByName('Magical Exemplar'), 'mzone');
    const lyla = place(0, cardByName('Lyla, Lightsworn Sorceress'), 'grave');
    await activateCard(g, 0, place(0, cardByName('Level Tuning'), 'hand'));
    await activateCard(g, 0, place(0, cardByName('Level Tuning'), 'hand'));
    eq(ex.counters.spell, 4, '4 Spell Counters');
    await activateCard(g, 0, ex);
    eq(lyla.location, 'mzone', 'Lyla Special Summoned');
    eq(ex.counters.spell, 0, 'counters removed');
  });

  await test('LODT: Dice Try! negates Dangerous Machine Type-6 and destroys it', async () => {
    const { g, c1, place } = lodtSetup();
    const dmt = live(place(0, cardByName('Dangerous Machine Type-6'), 'szone', { faceUp: true }));
    const dt = place(1, cardByName('Dice Try!'), 'szone', { faceUp: false });
    c1.respond = respondWith('Dice Try!');
    await (g as any).setPhase('standby');
    eq(dt.location, 'grave', 'Dice Try! used');
    eq(dmt.location, 'grave', 'Dangerous Machine Type-6 destroyed');
  });
}

// ---------------------------------------------------------------- Side decking
async function sidingTests() {
  const id = (n: string) => cardByName(n).id;
  const ids = (e: [string, number][]) => e.flatMap(([n, k]) => Array(k).fill(id(n)) as string[]);
  const forty: [string, number][] = [
    ['Card Trooper', 1],
    ['Marauding Captain', 3],
    ['Elemental HERO Stratos', 1],
    ['Sangan', 1],
    ['Cyber Dragon', 2],
    ['Mystical Space Typhoon', 1],
    ['Pot of Avarice', 2],
    ['Bottomless Trap Hole', 2],
    ['Solemn Judgment', 1],
    ['Torrential Tribute', 1],
    ['Mirror Force', 1],
    ['Brain Control', 1],
    ['Monster Reborn', 1],
    ['Heavy Storm', 1],
    ['Book of Moon', 2],
    ['Dimensional Prison', 2],
    ['Gold Sarcophagus', 1],
    ['Smashing Ground', 2],
    ['Trap Hole', 3],
    ['Gemini Elf', 3],
    ['Vorse Raider', 3],
    ['Spirit Reaper', 1],
    ['Morphing Jar', 1],
    ['Exiled Force', 3],
  ];
  const side: [string, number][] = [
    ['D.D. Crow', 2],
    ['Royal Decree', 2],
    ['Light-Imprisoning Mirror', 1],
    ['Shadow-Imprisoning Mirror', 1],
    ['Trap Stun', 2],
    ['Macro Cosmos', 2],
    ['Kycoo the Ghost Destroyer', 2],
    ['Chimeratech Fortress Dragon', 1],
    ['Thunder King Rai-Oh', 2],
  ];
  const extra: [string, number][] = [
    ['Stardust Dragon', 1],
    ['Goyo Guardian', 1],
  ];
  const count = (e: [string, number][]) => e.reduce((a, [, n]) => a + n, 0);

  await test('Siding: validation enforces Side ≤15 (waived for Limited)', async () => {
    eq(count(forty), 40, 'test deck has 40 cards');
    eq(validateDeck({ main: forty, extra, side }).length, 0, `legal deck: ${validateDeck({ main: forty, extra, side }).join(' ')}`);
    const big = [...side, ['Dust Tornado', 2] as [string, number]];
    eq(count(big), 17, '17 side cards');
    eq(validateDeck({ main: forty, extra, side: big }).some((e) => /Side Deck has 17 cards \(maximum 15\)/.test(e)), true, 'Side 17 is rejected');
    eq(validateDeck({ main: forty, extra, side: big }, { ignoreLimits: true }).some((e) => /Side Deck/.test(e)), false, 'Limited has no side cap');
  });

  await test('Siding: card limits count Main + Extra + Side together', async () => {
    const s2: [string, number][] = [['Gemini Elf', 1]];
    eq(validateDeck({ main: forty, extra, side: s2 }).some((e) => /Gemini Elf: 4 copies/.test(e)), true, '3 main + 1 side Gemini Elf is over the limit');
    const s3: [string, number][] = [['Stardust Dragon', 3]];
    eq(validateDeck({ main: forty, extra, side: s3 }).some((e) => /Stardust Dragon: 4 copies/.test(e)), true, 'Extra + Side counted together');
    const s4: [string, number][] = [['Brain Control', 1]];
    eq(validateDeck({ main: forty, extra, side: s4 }).some((e) => /Brain Control: 2 copies \(limit 1\)/.test(e)), true, 'Limited card in main and side');
  });

  const deck: DeckIds = { main: ids(forty), extra: ids(extra), side: ids(side) };

  await test('Siding: a one-for-one swap keeps every count', async () => {
    const d1 = swapCards(deck, id('Trap Hole'), id('D.D. Crow'))!;
    eq(!!d1, true, 'swap allowed');
    eq(d1.main.length, 40, 'Main stays 40');
    eq(d1.extra.length, 2, 'Extra stays 2');
    eq(d1.side.length, 15, 'Side stays 15');
    eq(d1.main.filter((x) => x === id('D.D. Crow')).length, 1, 'D.D. Crow in');
    eq(d1.side.filter((x) => x === id('Trap Hole')).length, 1, 'Trap Hole to the side');
    eq(d1.main.indexOf(id('D.D. Crow')), deck.main.lastIndexOf(id('Trap Hole')), 'the incoming card takes the outgoing card’s slot');
    const d2 = swapCards(d1, id('Trap Hole'), id('D.D. Crow'))!;
    eq(sideSummary(deck, d2), '+2 D.D. Crow, \u22122 Trap Hole', 'summary');
    eq(sidedDeckProblems(d2, deck).length, 0, 'still legal');
    eq(swapCards(deck, id('Trap Hole'), id('Dust Tornado')), null, 'a card that is not in the side cannot come in');
    eq(deck.main.length + deck.side.length, 55, 'the original deck is untouched');
  });

  await test('Siding: Extra Deck monsters swap only with Extra-type cards', async () => {
    eq(canSwap(cardByName('Stardust Dragon'), cardByName('Chimeratech Fortress Dragon')), true, 'Synchro ↔ Fusion');
    eq(canSwap(cardByName('Stardust Dragon'), cardByName('D.D. Crow')), false, 'Synchro ↔ Main Deck monster');
    eq(swapCards(deck, id('Stardust Dragon'), id('D.D. Crow')), null, 'Extra out, Main card in is refused');
    eq(swapCards(deck, id('Card Trooper'), id('Chimeratech Fortress Dragon')), null, 'Main out, Fusion in is refused');
    const d = swapCards(deck, id('Goyo Guardian'), id('Chimeratech Fortress Dragon'))!;
    eq(d.extra.includes(id('Chimeratech Fortress Dragon')) && d.side.includes(id('Goyo Guardian')), true, 'Extra ↔ Extra works');
    eq(d.extra.length, 2, 'Extra count kept');
  });

  await test('Siding: Limited moves keep the Main Deck at 40 or more', async () => {
    eq(moveToSide(deck, id('Trap Hole')), null, 'cannot drop to 39');
    const up = moveToDeck(deck, id('D.D. Crow'))!;
    eq(up.main.length, 41, 'added to 41');
    eq(up.side.length, 14, 'pool shrinks');
    const down = moveToSide(up, id('Trap Hole'))!;
    eq(down.main.length, 40, 'back to 40');
    eq(moveToDeck(deck, id('Chimeratech Fortress Dragon'))!.extra.length, 3, 'Fusion goes to the Extra Deck');
  });

  await test('Siding: AI sides deterministically and sensibly', async () => {
    const lightsworn = PREMADE_DECKS.find((d) => d.id === 'lightsworn')!;
    const opp = buildDeckList(lightsworn);
    const oppIds = { main: opp.main.map((c) => c.id), extra: opp.extra.map((c) => c.id) };
    const a = aiSideDeck(deck, oppIds, 1234);
    const b = aiSideDeck(deck, oppIds, 1234);
    eq(JSON.stringify(a), JSON.stringify(b), 'same seed, same deck');
    eq(a.main.length, 40, 'Main count kept');
    eq(a.side.length, 15, 'Side count kept');
    eq(a.main.filter((x) => x === id('D.D. Crow') || x === id('Macro Cosmos') || x === id('Kycoo the Ghost Destroyer')).length >= 2, true, `graveyard hate sided in vs Lightsworn (${sideSummary(deck, a)})`);
    eq(a.main.includes(id('Royal Decree')), false, 'no Royal Decree vs a deck with few traps');
    // every premade pairing keeps legal counts
    for (const x of PREMADE_DECKS) {
      if (!x.side?.length) continue;
      const own = buildDeckList(x);
      const mine: DeckIds = { main: own.main.map((c) => c.id), extra: own.extra.map((c) => c.id), side: (own.side ?? []).map((c) => c.id) };
      for (const y of PREMADE_DECKS) {
        const o = buildDeckList(y);
        const r = aiSideDeck(mine, { main: o.main.map((c) => c.id), extra: o.extra.map((c) => c.id) }, 7);
        const probs = sidedDeckProblems(r, mine);
        if (probs.length) throw new Error(`${x.id} vs ${y.id}: ${probs.join(' ')}`);
      }
    }
  });
}

// ---------------------------------------------------------------- The Duelist Genesis (TDGS)

async function tdgsTests() {
  const tdgsSetup = () => {
    const s = setup();
    ensureTdgsPatches(s.g);
    return s;
  };
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const setPhase = (g: Game, ph: string) => (g as any).setPhase(ph);

  await test('TDGS: Big Piece Golem — Normal Summon without Tributing only when you control no monsters', async () => {
    const { g, place } = tdgsSetup();
    const bpg = place(0, cardByName('Big Piece Golem'), 'hand');
    eq(g.canNormalSummon(0, bpg), false, 'opponent controls no monster: needs a Tribute');
    place(1, T.brute, 'mzone');
    eq(g.canNormalSummon(0, bpg), true, 'opponent controls a monster, you control none');
    eq(g.canNormalSummon(0, bpg, true), false, 'cannot be Set without Tributing');
    await g.performAction(0, { type: 'summon', card: bpg });
    eq(bpg.location, 'mzone', 'Normal Summoned with no Tribute');
  });

  await test('TDGS: Power Filter — monsters with 1000 or less ATK cannot be Special Summoned', async () => {
    const { g, place } = tdgsSetup();
    live(place(1, cardByName('Power Filter'), 'szone', { faceUp: true }));
    const w = place(0, T.wall, 'grave');
    eq((await g.specialSummon([w], 0, { pos: 'atk' })).length, 0, '500 ATK blocked');
    const b = place(0, T.brute, 'grave');
    eq((await g.specialSummon([b], 0, { pos: 'atk' })).length, 1, '1800 ATK allowed');
  });

  await test('TDGS: Quillbolt Hedgehog — revives with a Tuner, removed from play when it leaves the field', async () => {
    const { g, place } = tdgsSetup();
    const q = place(0, cardByName('Quillbolt Hedgehog'), 'grave');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === q), false, 'no Tuner: cannot activate');
    place(0, tuner, 'mzone');
    await activateCard(g, 0, q);
    eq(q.location, 'mzone', 'Special Summoned');
    await g.destroy([q], 'effect', 1);
    eq(q.location, 'banished', 'removed from play');
  });

  await test('TDGS: Handcuffs Dragon — equips to its attacker (-1800 ATK), revives when that monster is destroyed', async () => {
    const { g, c1, place } = tdgsSetup();
    const hd = place(0, cardByName('Handcuffs Dragon'), 'mzone');
    const a = place(1, T.giant, 'mzone');
    g.turnPlayer = 1;
    c1.chooseAttackTarget = async () => hd;
    await g.conductAttack(1, a);
    eq(hd.location, 'szone', 'equipped from the GY');
    eq(g.getAtk(a), 1200, '3000 - 1800');
    await g.destroy([a], 'effect', 0);
    await g.processTriggers(false);
    eq(hd.location, 'mzone', 'Special Summoned after the equipped monster was destroyed');
  });

  await test('TDGS: Montage Dragon — sends 3 monsters, ATK = their Levels x 300', async () => {
    const { g, place } = tdgsSetup();
    const md = place(0, cardByName('Montage Dragon'), 'hand');
    const fodder = [place(0, T.giant, 'hand'), place(0, T.brute, 'hand'), place(0, tuner, 'hand')];
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === md);
    if (!proc) throw new Error('no summoning procedure');
    await g.performAction(0, proc);
    eq(md.location, 'mzone', 'Special Summoned');
    eq(fodder.every((c) => c.location === 'grave'), true, '3 monsters sent');
    eq(g.getAtk(md), (8 + 4 + 2) * 300, 'ATK from the Levels');
  });

  await test('TDGS: Dharc the Dark Charmer — takes a DARK monster while face-up, control returns when it leaves', async () => {
    const { g, place } = tdgsSetup();
    const dh = place(0, cardByName('Dharc the Dark Charmer'), 'mzone', { faceUp: false, pos: 'def' });
    const shade = place(1, T.dark, 'mzone');
    await g.performAction(0, { type: 'flip', card: dh });
    eq(shade.controller, 0, 'control taken');
    await g.destroy([dh], 'effect', 1);
    eq(shade.controller, 1, 'control returned');
  });

  await test('TDGS: Telekinetic Shocker — pays 500 and is destroyed instead of a Psychic', async () => {
    const { g, place } = tdgsSetup();
    const ts = place(0, cardByName('Telekinetic Shocker'), 'mzone');
    const snail = place(0, cardByName('Psychic Snail'), 'mzone');
    await g.destroy([snail], 'effect', 1);
    eq(snail.location, 'mzone', 'Psychic saved');
    eq(ts.location, 'grave', 'Shocker destroyed instead');
    eq(g.players[0].lp, 7500, '500 LP paid');
  });

  await test('TDGS: Defense Draw — no battle damage from this battle, draw 1', async () => {
    const { g, c0, place } = tdgsSetup();
    const dd = place(0, cardByName('Defense Draw'), 'szone', { faceUp: false });
    const a = place(1, T.brute, 'mzone');
    g.turnPlayer = 1;
    c0.respond = (_g, req) => (req.kind === 'damage' ? req.options.find((o) => o.card === dd) ?? null : null);
    const hand = g.players[0].hand.length;
    await g.conductAttack(1, a);
    eq(dd.location, 'grave', 'Defense Draw used');
    eq(g.players[0].lp, 8000, 'no battle damage');
    eq(g.players[0].hand.length, hand + 1, 'drew 1');
  });

  await test("TDGS: Splendid Venus — Solemn Judgment cannot negate (or destroy) your Trap's activation", async () => {
    const { g, c1, place } = tdgsSetup();
    const venus = place(0, cardByName('Splendid Venus'), 'mzone');
    const b = place(1, T.brute, 'mzone');
    eq(g.getAtk(b), 1300, 'non-Fairy monsters lose 500 ATK');
    eq(g.getAtk(venus), 2800, 'Fairy unaffected');
    const nest = place(0, cardByName('Needlebug Nest'), 'szone', { faceUp: false });
    const sj = place(1, cardByName('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    const deck = g.players[0].deck.length;
    await activateCard(g, 0, nest);
    eq(sj.location, 'grave', 'Solemn Judgment was activated');
    eq(g.players[1].lp, 4000, 'Solemn cost paid');
    eq(g.players[0].deck.length, deck - 5, 'Needlebug Nest still resolved');
  });

  await test('TDGS: Kinka-byo — revives a Level 1; Izanagi lets it stay; without Izanagi it returns and the monster is removed', async () => {
    const { g, place } = tdgsSetup();
    const iz = place(0, cardByName('Izanagi'), 'mzone');
    const kb = place(0, cardByName('Kinka-byo'), 'hand');
    const dc = place(0, cardByName('Doctor Cranium'), 'grave');
    await g.performAction(0, { type: 'summon', card: kb });
    eq(dc.location, 'mzone', 'Level 1 monster Special Summoned');
    await setPhase(g, 'end');
    eq(kb.location, 'mzone', 'Izanagi: the Spirit stays');
    await g.destroy([iz], 'effect', 1);
    g.turn += 2;
    kb.flags.spiritTurn = g.turn;
    await setPhase(g, 'end');
    eq(kb.location, 'hand', 'returned to the hand');
    eq(dc.location, 'banished', 'the revived monster is removed from play');
  });

  await test('TDGS: Trap of Darkness — pays 1000, copies Needlebug Nest from the GY and removes it', async () => {
    const { g, place } = tdgsSetup();
    g.players[0].lp = 3000;
    const nest = place(0, cardByName('Needlebug Nest'), 'grave');
    const tod = place(0, cardByName('Trap of Darkness'), 'szone', { faceUp: false });
    const deck = g.players[0].deck.length;
    await activateCard(g, 0, tod);
    eq(g.players[0].lp, 2000, '1000 LP paid');
    eq(nest.location, 'banished', 'copied card removed from play');
    eq(g.players[0].deck.length, deck - 5, 'the copied effect resolved');
  });

  await test('TDGS: Telekinetic Charging Cell — Destructotron activates without paying LP', async () => {
    const { g, place } = tdgsSetup();
    const d = place(0, cardByName('Destructotron'), 'mzone');
    const cell = live(place(0, cardByName('Telekinetic Charging Cell'), 'szone', { faceUp: true }));
    g.equip(cell, d);
    const mf = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    await activateCard(g, 0, d);
    eq(mf.location, 'grave', 'face-down card destroyed');
    eq(g.players[0].lp, 8000, 'no LP paid');
  });

  await test('TDGS: Ghost Gardna — takes the attack, then the attacker loses 1000 ATK', async () => {
    const { g, c1, place } = tdgsSetup();
    const gg = place(0, cardByName('Ghost Gardna'), 'mzone', { pos: 'def' });
    const b = place(0, T.brute, 'mzone');
    const a = place(1, T.giant, 'mzone');
    g.turnPlayer = 1;
    c1.chooseAttackTarget = async () => b;
    await g.conductAttack(1, a);
    eq(b.location, 'mzone', 'original target untouched');
    eq(gg.location, 'grave', 'Ghost Gardna destroyed instead');
    eq(g.getAtk(a), 2000, 'attacker lost 1000 ATK');
  });

  await test('TDGS: Toy Magician — Set as a Spell, destroyed by the opponent, Special Summoned in the End Phase', async () => {
    const { g, place } = tdgsSetup();
    const tm = place(0, cardByName('Toy Magician'), 'hand');
    const set = g.legalMainActions(0).find((a) => a.type === 'setST' && a.card === tm);
    if (!set) throw new Error('cannot be Set in the Spell & Trap Zone');
    await g.performAction(0, set);
    eq(tm.location, 'szone', 'Set as a Spell');
    await g.destroy([tm], 'effect', 1);
    eq(tm.location, 'grave', 'destroyed');
    await setPhase(g, 'end');
    eq(tm.location, 'mzone', 'Special Summoned during the End Phase');
  });

  await test('TDGS: De-Synchro — returns the Synchro Monster and Special Summons its materials', async () => {
    const { g, place } = tdgsSetup();
    const t = place(0, tuner, 'mzone');
    const b = place(0, T.brute, 'mzone');
    const goyo = g.players[0].extra.find((c) => c.name === 'Goyo Guardian')!;
    await g.synchroSummon(0, goyo, [t, b]);
    eq(goyo.location, 'mzone', 'Synchro Summoned');
    await activateCard(g, 0, place(0, cardByName('De-Synchro'), 'hand'));
    eq(goyo.location, 'extra', 'returned to the Extra Deck');
    eq(t.location === 'mzone' && b.location === 'mzone', true, 'materials Special Summoned');
  });

  await test('TDGS: Geartown — "Ancient Gear" monsters need 1 less Tribute to Normal Summon', async () => {
    const { g, place } = tdgsSetup();
    const ag = findCard('Ancient Gear Golem');
    if (!ag) return;
    live(place(1, cardByName('Geartown'), 'fzone'));
    const agg = place(0, ag, 'hand');
    eq(g.tributesNeeded(agg), 1, 'Level 8: 1 Tribute');
  });
}

// ---------------------------------------------------------------- Crossroads of Chaos (CSOC)

async function csocTests() {
  const csocSetup = () => {
    const s = setup();
    ensureCsocPatches(s.g);
    return s;
  };
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const battleEnd = async (g: Game) => {
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };

  await test('CSOC: Black Garden halves a Summoned monster and gives the opponent a Rose Token', async () => {
    const { g, place } = csocSetup();
    live(place(0, cardByName('Black Garden'), 'fzone'));
    const b = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'summon', card: b });
    eq(g.getAtk(b), 900, 'ATK halved');
    const rose = g.monsters(1).find((c) => c.name === 'Rose Token');
    eq(!!rose, true, "Rose Token on the opponent's field");
    eq(rose && g.getAtk(rose), 800, 'the Rose Token is not halved');
    eq(rose?.pos, 'atk', 'in Attack Position');
  });

  await test('CSOC: Machine Lord Ür attacks every monster once, no battle damage to the opponent', async () => {
    const { g, place } = csocSetup();
    const ur = place(0, cardByName('Machine Lord Ür'), 'mzone');
    const w1 = place(1, T.wall, 'mzone');
    const w2 = place(1, T.wall, 'mzone');
    await g.conductAttack(0, ur);
    eq([w1, w2].filter((w) => w.location === 'grave').length, 1, 'first monster destroyed');
    eq(g.players[1].lp, 8000, 'no battle damage');
    eq(g.canAttack(ur), true, 'can attack the other monster');
    eq(g.attackTargets(ur).targets.length, 1, 'only the monster not attacked yet');
    await g.conductAttack(0, ur);
    eq([w1, w2].every((w) => w.location === 'grave'), true, 'second monster destroyed');
    eq(g.canAttack(ur), false, 'no third attack');
  });

  await test('CSOC: Morphtronic Magnen — only the highest ATK target (Attack), must be attacked (Defense)', async () => {
    const { g, place } = csocSetup();
    const mag = place(0, cardByName('Morphtronic Magnen'), 'mzone');
    const brute = place(1, T.brute, 'mzone');
    place(1, T.wall, 'mzone');
    const t = g.attackTargets(mag).targets;
    eq(t.length === 1 && t[0] === brute, true, 'only the highest ATK monster');
    const mag2 = place(1, cardByName('Morphtronic Magnen'), 'mzone', { pos: 'def' });
    const a = place(0, T.giant, 'mzone');
    const t2 = g.attackTargets(a).targets;
    eq(t2.length === 1 && t2[0] === mag2, true, 'Defense Position Magnen must be attacked');
  });

  await test('CSOC: Storm Caller returns a monster destroyed by another Psychic to the top of the Deck', async () => {
    const { g, place } = csocSetup();
    place(0, cardByName('Storm Caller'), 'mzone');
    const inj = place(0, cardByName('Power Injector'), 'mzone');
    const w = place(1, T.wall, 'mzone');
    await g.conductAttack(0, inj);
    eq(w.location, 'deck', 'placed in the Deck');
    const deck = g.players[1].deck;
    eq(deck[deck.length - 1], w, 'on top');
    eq(g.players[1].lp, 8000 - 800, 'battle damage still applies');
  });

  await test('CSOC: Revived King Ha Des negates the effect of a monster it destroys by battle', async () => {
    const { g, place } = csocSetup();
    const hd = place(0, cardByName('Revived King Ha Des'), 'mzone');
    place(1, cardByName('Sangan'), 'mzone');
    await g.conductAttack(0, hd);
    eq(g.players[1].hand.length, 0, 'Sangan does not search');
  });

  await test('CSOC: Wall of Ivy gives the opponent an Ivy Token that burns its controller', async () => {
    const { g, place } = csocSetup();
    const ivy = place(0, cardByName('Wall of Ivy'), 'mzone', { faceUp: false, pos: 'def' });
    await g.flipSummon(0, ivy);
    const tok = g.monsters(1).find((c) => c.name === 'Ivy Token');
    eq(!!tok, true, "Ivy Token on the opponent's field");
    await g.destroy([tok!], 'effect', 0);
    await g.processTriggers(false);
    eq(g.players[1].lp, 7700, 'its controller takes 300');
  });

  await test('CSOC: Cursed Fig locks 2 Set Spell/Trap Cards while it is in the GY', async () => {
    const { g, place } = csocSetup();
    const fig = place(1, cardByName('Cursed Fig'), 'mzone');
    const mst = place(1, cardByName('Mystical Space Typhoon'), 'szone', { faceUp: false });
    place(0, cardByName('Dust Tornado'), 'szone', { faceUp: false });
    eq(g.getActivations(1, { open: false }).some((a) => a.card === mst), true, 'MST can be activated before');
    const b = place(0, T.brute, 'mzone');
    await g.conductAttack(0, b);
    eq(fig.location, 'grave', 'Cursed Fig destroyed');
    eq(g.getActivations(1, { open: false }).some((a) => a.card === mst), false, 'MST is locked');
  });

  await test('CSOC: Mark of the Rose — control, End Phase return, Standby retake, returns when it leaves', async () => {
    const { g, place } = csocSetup();
    place(0, cardByName('Botanical Girl'), 'grave');
    const v = place(1, T.brute, 'mzone');
    const mark = place(0, cardByName('Mark of the Rose'), 'hand');
    await activateCard(g, 0, mark);
    eq(v.controller, 0, 'control taken');
    await (g as any).setPhase('end');
    eq(v.controller, 1, 'returned in the End Phase');
    g.turn += 2;
    await (g as any).setPhase('standby');
    eq(v.controller, 0, 'taken again in the Standby Phase');
    await g.destroy([mark], 'effect', 1);
    eq(v.controller, 1, 'control returns when Mark of the Rose leaves the field');
  });

  await test('CSOC: Zombie Mammoth is destroyed with no Zombie in the GY and burns its controller', async () => {
    const { g, place } = csocSetup();
    const m = place(0, cardByName('Zombie Mammoth'), 'mzone');
    await g.ruleCleanup();
    await g.processTriggers(false);
    eq(m.location, 'grave', 'destroyed');
    eq(g.players[0].lp, 8000 - 1900, 'its controller takes 1900');
  });

  await test('CSOC: Urgent Tuning Synchro Summons during the Battle Phase', async () => {
    const { g, place } = csocSetup();
    place(0, tuner, 'mzone');
    place(0, T.brute, 'mzone');
    const ut = place(0, cardByName('Urgent Tuning'), 'szone', { faceUp: false });
    g.phase = 'battle';
    await activateCard(g, 0, ut);
    eq(g.monsters(0).some((c) => c.name === 'Goyo Guardian'), true, 'Goyo Guardian Synchro Summoned');
  });

  await test('CSOC: Gozen Match — one Attribute per player', async () => {
    const { g, place } = csocSetup();
    place(1, T.brute, 'mzone');
    place(1, T.dark, 'mzone');
    const gm = place(0, cardByName('Gozen Match'), 'szone', { faceUp: false });
    place(0, T.brute, 'mzone');
    await activateCard(g, 0, gm);
    eq(g.monsters(1).length, 1, 'the other Attribute was sent to the GY');
    eq(g.canNormalSummon(0, place(0, T.dark, 'hand')), false, 'cannot Summon another Attribute');
    eq(g.canNormalSummon(0, place(0, T.wall, 'hand')), true, 'same Attribute is fine');
  });

  await test('CSOC: Queen of Thorns — 1000 LP per non-Plant monster Summoned from the hand', async () => {
    const { g, place } = csocSetup();
    place(1, cardByName('Queen of Thorns'), 'mzone');
    await g.performAction(0, { type: 'summon', card: place(0, T.brute, 'hand') });
    eq(g.players[0].lp, 7000, 'paid 1000');
    g.players[0].normalSummonsLeft = 1;
    await g.performAction(0, { type: 'summon', card: place(0, cardByName('Botanical Girl'), 'hand') });
    eq(g.players[0].lp, 7000, 'Plant-Type monsters are free');
  });

  await test('CSOC: Search Striker destroys a face-down monster without damage calculation, then goes to Defense', async () => {
    const { g, place } = csocSetup();
    const s = place(0, cardByName('Search Striker'), 'mzone');
    const w = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await g.conductAttack(0, s);
    eq(w.location, 'grave', 'destroyed');
    eq(g.players[0].lp, 8000, 'no damage calculation');
    await battleEnd(g);
    eq(s.pos, 'def', 'changed to Defense Position');
    eq(g.queryCard(s, 'cannotChangePos'), true, 'position locked');
  });

  await test('CSOC: Iron Chain Snake — -800 ATK, mills Level cards when the monster is destroyed by battle', async () => {
    const { g, place } = csocSetup();
    const snake = place(0, cardByName('Iron Chain Snake'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await activateCard(g, 0, snake);
    eq(snake.location, 'szone', 'equipped');
    eq(g.getAtk(v), 1000, '-800 ATK');
    const before = g.players[1].deck.length;
    const giant = place(0, T.giant, 'mzone');
    await g.conductAttack(0, giant);
    eq(v.location, 'grave', 'destroyed');
    eq(g.players[1].deck.length, before - 4, '4 cards sent from the Deck');
  });

  await test('CSOC: Jade Knight protects low-ATK Machines from Trap effects only', async () => {
    const { g, place } = csocSetup();
    place(0, cardByName('Jade Knight'), 'mzone');
    const hw = place(0, cardByName('Healing Wave Generator'), 'mzone');
    const tr = place(1, cardByName('Dust Tornado'), 'szone');
    await g.destroy([hw], 'effect', 1, tr);
    eq(hw.location, 'mzone', 'not destroyed by a Trap');
    const sp = place(1, cardByName('Mystical Space Typhoon'), 'szone');
    await g.destroy([hw], 'effect', 1, sp);
    eq(hw.location, 'grave', 'destroyed by a Spell');
  });

  await test('CSOC: Pollinosis Tributes a Plant to negate a Summon', async () => {
    const { g, c1, place } = csocSetup();
    const plant = place(1, cardByName('Botanical Girl'), 'mzone');
    place(1, cardByName('Pollinosis'), 'szone', { faceUp: false });
    c1.respond = respondWith('Pollinosis');
    const b = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'summon', card: b });
    eq(b.location, 'grave', 'Summon negated');
    eq(plant.location, 'grave', 'Plant Tributed');
  });
}

// ---------------------------------------------------------------- Gladiator's Assault (GLAS)

async function glasTests() {
  const glasSetup = () => {
    const s = setup();
    ensureGlasPatches(s.g);
    return s;
  };
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const battleEnd = async (g: Game) => {
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };

  await test('GLAS: Gladiator Beast Octavius — destroys a face-down Spell/Trap, then returns to the Deck after battle', async () => {
    const { g, place } = glasSetup();
    const bestiari = place(0, cardByName('Gladiator Beast Bestiari'), 'grave');
    const oct = deckCard(g, 0, 'Gladiator Beast Octavius');
    const st = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    await g.specialSummon([oct], 0, { pos: 'atk', reasonCard: bestiari });
    await g.processTriggers(true);
    eq(st.location, 'grave', 'face-down Spell/Trap destroyed');
    oct.attackedThisTurnOrWasAttacked = true;
    await battleEnd(g);
    eq(oct.location, 'deck', 'no card to discard: shuffled into the Deck');
  });

  await test('GLAS: Alexander / Spartacus can only be Special Summoned by Dimacari / Hoplomus; Spartacus searches an equip', async () => {
    const { g, place } = glasSetup();
    const alex = deckCard(g, 0, 'Gladiator Beast Alexander');
    const sp = deckCard(g, 0, 'Gladiator Beast Spartacus');
    const gladius = deckCard(g, 0, "Gladiator Beast's Battle Gladius");
    const dim = place(0, cardByName('Gladiator Beast Dimacari'), 'grave');
    const hop = place(0, cardByName('Gladiator Beast Hoplomus'), 'grave');
    eq((await g.specialSummon([alex], 0, { pos: 'atk', reasonCard: hop })).length, 0, 'Alexander by Hoplomus: no');
    eq((await g.specialSummon([sp], 0, { pos: 'atk', reasonCard: dim })).length, 0, 'Spartacus by Dimacari: no');
    eq((await g.specialSummon([alex], 0, { pos: 'atk', reasonCard: dim })).length, 1, 'Alexander by Dimacari');
    eq(g.queryCard(alex, 'unaffectedBySpells'), true, 'Special Summoned Alexander is unaffected by Spells');
    await g.specialSummon([sp], 0, { pos: 'atk', reasonCard: hop });
    await g.processTriggers(true);
    eq(sp.location, 'mzone', 'Spartacus by Hoplomus');
    eq(gladius.location, 'hand', 'Gladiator Beast Equip Spell added');
  });

  await test('GLAS: Dimacari tags out into Alexander; Colosseum counts it, Witch Doctor of Sparta burns', async () => {
    const { g, place } = glasSetup();
    const alex = deckCard(g, 0, 'Gladiator Beast Alexander');
    const dim = place(0, cardByName('Gladiator Beast Dimacari'), 'mzone');
    const col = live(place(0, cardByName('Colosseum - Cage of the Gladiator Beasts'), 'fzone', { faceUp: true }));
    place(1, cardByName('Witch Doctor of Sparta'), 'mzone');
    dim.attackedThisTurnOrWasAttacked = true;
    await battleEnd(g);
    eq(dim.location, 'deck', 'Dimacari returned');
    eq(alex.location, 'mzone', 'Alexander Special Summoned from the Deck');
    eq(col.counters.colosseum, 1, 'Colosseum counter');
    eq(g.getAtk(alex), 2500, 'Alexander +100');
    eq(g.players[0].lp, 7500, 'Witch Doctor: 500 to its opponent');
  });

  await test("GLAS: Gladiator Beast's Battle Gladius returns to the hand when its monster tags out", async () => {
    const { g, place } = glasSetup();
    deckCard(g, 0, 'Gladiator Beast Laquari');
    const b = place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    const gl = live(place(0, cardByName("Gladiator Beast's Battle Gladius"), 'szone', { faceUp: true }));
    g.equip(gl, b);
    eq(g.getAtk(b), 1800, '+300 ATK');
    b.attackedThisTurnOrWasAttacked = true;
    await battleEnd(g);
    eq(b.location, 'deck', 'Bestiari tagged out');
    eq(gl.location, 'hand', 'Gladius back in hand');
  });

  await test('GLAS: Gladiator Beast Gaiodiaz — contact fusion, burn equal to the DEF of the destroyed monster', async () => {
    const { g, place } = glasSetup();
    place(0, cardByName('Gladiator Beast Spartacus'), 'mzone');
    place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
    const gaio = place(0, cardByName('Gladiator Beast Gaiodiaz'), 'extra');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === gaio);
    if (!proc) throw new Error('no contact fusion');
    await g.performAction(0, proc);
    eq(gaio.location, 'mzone', 'Gaiodiaz summoned');
    eq(g.monsters(0).length, 1, 'materials returned');
    const w = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, gaio);
    await g.processTriggers(true);
    eq(w.location, 'grave', 'wall destroyed');
    eq(g.players[1].lp, 6000, '2000 burn');
  });

  await test('GLAS: Disarm returns a Gladiator Beast card to negate a Spell', async () => {
    const { g, c0, place } = glasSetup();
    const disarm = place(0, cardByName('Disarm'), 'szone', { faceUp: false });
    const gb = place(0, cardByName('Gladiator Beast Secutor'), 'hand');
    const mine = place(0, T.brute, 'mzone');
    const dh = place(1, cardByName('Dark Hole'), 'hand');
    g.turnPlayer = 1;
    c0.respond = respondWith('Disarm');
    await activateCard(g, 1, dh);
    eq(disarm.location, 'grave', 'Disarm used');
    eq(gb.location, 'deck', 'Gladiator Beast returned to the Deck');
    eq(dh.location, 'grave', 'Dark Hole negated');
    eq(mine.location, 'mzone', 'monster survived');
  });

  await test('GLAS: Cloudian - Nimbusman Tributes 2 WATER monsters; Updraft burns the Fog Counters away', async () => {
    const { g, c0, place } = glasSetup();
    place(0, cardByName('Cloudian - Smoke Ball'), 'mzone');
    place(0, cardByName('Cloudian - Smoke Ball'), 'mzone');
    const nim = place(0, cardByName('Cloudian - Nimbusman'), 'hand');
    (c0 as any).chooseOption = async () => 1;
    await g.performAction(0, { type: 'summon', card: nim });
    eq(nim.location, 'mzone', 'summoned');
    eq(g.monsters(0).length, 1, '2 Tributes');
    eq(nim.counters.fog, 2, '2 Fog Counters');
    eq(g.getAtk(nim), 2000, '+500 per Fog Counter');
    const up = place(0, cardByName('Updraft'), 'szone', { faceUp: false });
    await activateCard(g, 0, up);
    eq(g.players[1].lp, 7400, '600 damage');
    eq(g.getAtk(nim), 1000, 'counters removed');
  });

  await test('GLAS: Cloudian - Cirrostratus removes 2 Fog Counters to destroy a monster; Natural Disaster burns', async () => {
    const { g, c0, place } = glasSetup();
    place(0, cardByName('Cloudian - Smoke Ball'), 'mzone');
    live(place(0, cardByName('Natural Disaster'), 'szone', { faceUp: true }));
    const cs = place(0, cardByName('Cloudian - Cirrostratus'), 'hand');
    const v = place(1, T.brute, 'mzone');
    await g.performAction(0, { type: 'summon', card: cs });
    eq(cs.counters.fog, 2, '2 Cloudians on the field');
    c0.pick = (_g, req) => (req.candidates.includes(v) ? [v] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, cs);
    eq(v.location, 'grave', 'destroyed');
    eq(cs.counters.fog, 0, 'counters removed');
    eq(g.players[1].lp, 7500, 'Natural Disaster: 500');
  });

  await test('GLAS: Sheep Cloud tokens only Tribute for Cloudians; Ghost Fog blocks damage and spreads Fog Counters', async () => {
    const { g, place } = glasSetup();
    const sheep = place(1, cardByName('Cloudian - Sheep Cloud'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    await g.processTriggers(true);
    eq(sheep.location, 'grave', 'Sheep Cloud destroyed');
    eq(g.monsters(1).length, 2, '2 Cloudian Tokens');
    eq(g.tributeCandidates(1, place(1, T.giant, 'hand')).length, 0, 'no Tribute for a non-Cloudian');
    eq(g.tributeCandidates(1, place(1, cardByName('Cloudian - Nimbusman'), 'hand')).length, 2, 'Tribute for a Cloudian');

    const s2 = glasSetup();
    const fogC = s2.place(1, cardByName('Cloudian - Ghost Fog'), 'mzone');
    const b = s2.place(0, T.brute, 'mzone');
    await s2.g.conductAttack(0, b);
    await s2.g.processTriggers(true);
    eq(fogC.location, 'grave', 'Ghost Fog destroyed');
    eq(s2.g.players[1].lp, 8000, 'no battle damage');
    eq(b.counters.fog, 4, 'Fog Counters equal to the Level of the destroyer');
    eq((await s2.g.specialSummon([fogC], 1, { pos: 'atk' })).length, 0, 'cannot be Special Summoned');
  });

  await test('GLAS: Truckroid equips the monster it destroyed and gains its ATK', async () => {
    const { g, place } = glasSetup();
    const tr = place(0, cardByName('Truckroid'), 'mzone');
    const v = place(1, cardByName('Cloudian - Smoke Ball'), 'mzone');
    await g.conductAttack(0, tr);
    await g.processTriggers(true);
    eq(v.location, 'szone', 'equipped');
    eq(v.equippedTo, tr.uid, 'to Truckroid');
    eq(g.getAtk(tr), 1200, '+200 ATK');
  });

  await test('GLAS: Dark Fusion summons Evil HERO Inferno Wing (Polymerization cannot); piercing + burn', async () => {
    const { g, place } = glasSetup();
    place(0, cardByName('Elemental Hero Avian'), 'hand');
    place(0, cardByName('Elemental Hero Burstinatrix'), 'hand');
    const iw = place(0, cardByName('Evil HERO Inferno Wing'), 'extra');
    const poly = place(0, cardByName('Polymerization'), 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === poly), false, 'Polymerization cannot');
    await activateCard(g, 0, place(0, cardByName('Dark Fusion'), 'hand'));
    eq(iw.location, 'mzone', 'Inferno Wing Fusion Summoned');
    eq(g.queryCard(iw, 'untargetable'), true, 'cannot be targeted this turn');
    const w = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, iw);
    await g.processTriggers(true);
    eq(w.location, 'grave', 'destroyed');
    eq(g.players[1].lp, 8000 - 100 - 2000, 'piercing 100 + burn 2000');
  });

  await test('GLAS: Elemental HERO Chaos Neos returns in the End Phase and Sets all face-up monsters', async () => {
    const { g, place } = glasSetup();
    const cn = place(0, cardByName('Elemental HERO Chaos Neos'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await (g as any).setPhase('end');
    eq(cn.location, 'extra', 'back to the Extra Deck');
    eq(v.faceUp, false, 'opponent monster Set');
  });

  await test('GLAS: Energy-Absorbing Monolith turns burn damage into a gain', async () => {
    const { g, c0, place } = glasSetup();
    place(0, cardByName('Energy-Absorbing Monolith'), 'szone', { faceUp: false });
    const ok = place(1, cardByName('Ookazi'), 'hand');
    g.turnPlayer = 1;
    c0.respond = respondWith('Energy-Absorbing Monolith');
    await activateCard(g, 1, ok);
    eq(g.players[0].lp, 8800, 'gained 800');
  });

  await test('GLAS: Magical Reflect Slime reflects battle damage; Raptinus makes Gemini monsters Effect Monsters', async () => {
    const { g, place } = glasSetup();
    const slime = place(1, cardByName('Magical Reflect Slime'), 'mzone');
    slime.flags.geminiSummoned = true;
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(g.players[1].lp, 8000, 'Slime controller takes nothing');
    eq(g.players[0].lp, 8000 - 1100, 'attacker takes the damage');

    const s2 = glasSetup();
    const knight = s2.place(0, cardByName('Ancient Gear Knight'), 'mzone');
    const rap = s2.place(0, cardByName('Superalloy Beast Raptinus'), 'mzone');
    s2.g.update();
    eq(!!knight.flags.geminiSummoned, true, 'Gemini is an Effect Monster');
    await s2.g.destroy([rap], 'effect', 1);
    eq(!!knight.flags.geminiSummoned, false, 'back to a Normal Monster');
  });

  await test('GLAS: "A" Cell Incubator gains an A-Counter when one is removed and spreads them when destroyed', async () => {
    const { g, c0, place } = glasSetup();
    const inc = live(place(0, cardByName('"A" Cell Incubator'), 'szone', { faceUp: true }));
    const tel = place(0, cardByName('Alien Telepath'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    v.counters.A = 1;
    const st = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    g.update();
    c0.pick = (_g, req) => (req.candidates.includes(st) ? [st] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, tel);
    eq(st.location, 'grave', 'Spell/Trap destroyed');
    eq(v.counters.A ?? 0, 0, 'A-Counter removed');
    eq(inc.counters.A, 1, 'Incubator got an A-Counter');
    c0.pick = (_g, req) => (req.candidates.includes(v) ? [v] : req.candidates.slice(0, req.min));
    await g.destroy([inc], 'effect', 1);
    await g.processTriggers(true);
    eq(v.counters.A, 1, 'counter placed on a face-up monster');
  });

  await test('GLAS: Defensive Tactics — no battle destruction or damage, then to the bottom of the Deck', async () => {
    const { g, c0, place } = glasSetup();
    const gb = place(0, cardByName('Gladiator Beast Hoplomus'), 'mzone');
    const dt = place(0, cardByName('Defensive Tactics'), 'szone', { faceUp: false });
    const a = place(1, T.giant, 'mzone');
    g.turnPlayer = 1;
    c0.respond = respondWith('Defensive Tactics');
    await g.conductAttack(1, a);
    eq(gb.location, 'mzone', 'not destroyed by battle');
    eq(dt.location, 'deck', 'Defensive Tactics in the Deck');
    eq(g.players[0].deck[0], dt, 'at the bottom');
    eq(g.players[0].lp, 8000, 'no battle damage');
  });
}

// ---------------------------------------------------------------- Archetype extras (src/cards/sets/archetype-extras.ts)

async function archetypeExtrasTests() {
  const xSetup = () => {
    const s = setup();
    ensureArchetypeExtrasPatches(s.g);
    return s;
  };
  const procOf = (g: Game, c: CardInstance) => g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === c);
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };

  await test('Extras: Grandmaster of the Six Samurai — Special Summon with a Six Samurai, only 1 face-up, GY recovery', async () => {
    const { g, place } = xSetup();
    const gm = place(0, cardByName('Grandmaster of the Six Samurai'), 'hand');
    const gm2 = place(0, cardByName('Grandmaster of the Six Samurai'), 'hand');
    eq(!!procOf(g, gm), false, 'no Six Samurai: no Summon');
    place(0, cardByName('The Six Samurai - Kamon'), 'mzone');
    const act = procOf(g, gm);
    if (!act) throw new Error('proc not offered');
    await g.performAction(0, act);
    eq(gm.location, 'mzone', 'Grandmaster Special Summoned');
    eq(!!procOf(g, gm2), false, 'second Grandmaster cannot be Special Summoned');
    eq(g.canNormalSummon(0, gm2), false, 'second Grandmaster cannot be Normal Summoned');
    const fromGy = place(0, cardByName('The Six Samurai - Zanji'), 'grave');
    await g.destroy([gm], 'effect', 1);
    await g.processTriggers(true);
    eq(gm.location, 'grave', 'Grandmaster destroyed');
    eq(fromGy.location, 'hand', 'Six Samurai added from the GY');
  });

  await test('Extras: Kamon / Yaichi destroy Spells/Traps only beside another Six Samurai, then cannot attack', async () => {
    const { g, place } = xSetup();
    const kamon = place(0, cardByName('The Six Samurai - Kamon'), 'mzone');
    const faceUpST = live(place(1, cardByName('Swords of Revealing Light'), 'szone', { faceUp: true }));
    const setST = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    eq(g.getActivations(0, { open: true }).some((a) => a.card === kamon), false, 'Kamon alone: no effect');
    const yaichi = place(0, cardByName('The Six Samurai - Yaichi'), 'mzone');
    await activateCard(g, 0, kamon);
    eq(faceUpST.location, 'grave', 'Kamon destroyed the face-up Spell');
    eq(g.canAttack(kamon), false, 'Kamon cannot attack this turn');
    await activateCard(g, 0, yaichi);
    eq(setST.location, 'grave', 'Yaichi destroyed the Set Trap');
  });

  await test('Extras: Six Samurai destruction substitution (another face-up Six Samurai is destroyed instead)', async () => {
    const { g, place } = xSetup();
    const zanji = place(0, cardByName('The Six Samurai - Zanji'), 'mzone');
    const nisashi = place(0, cardByName('The Six Samurai - Nisashi'), 'mzone');
    await g.destroy([zanji], 'effect', 1);
    eq(zanji.location, 'mzone', 'Zanji survives');
    eq(nisashi.location, 'grave', 'Nisashi destroyed instead');
  });

  await test('Extras: Irou destroys a face-down Defense Position monster without damage calculation', async () => {
    const { g, place } = xSetup();
    const irou = place(0, cardByName('The Six Samurai - Irou'), 'mzone');
    place(0, cardByName('The Six Samurai - Kamon'), 'mzone');
    const wall = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await g.conductAttack(0, irou);
    eq(wall.location, 'grave', 'face-down monster destroyed');
    eq(g.players[0].lp, 8000, 'no damage calculation (no reflect damage)');
  });

  await test('Extras: Zanji destroys the monster it attacked at the end of the Damage Step; Nisashi attacks twice', async () => {
    const { g, place } = xSetup();
    const zanji = place(0, cardByName('The Six Samurai - Zanji'), 'mzone');
    const nisashi = place(0, cardByName('The Six Samurai - Nisashi'), 'mzone');
    const wall = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, zanji);
    eq(wall.location, 'grave', '2000 DEF wall destroyed after battle');
    eq(g.players[0].lp, 8000 - 200, 'damage calculation still happened');
    await g.conductAttack(0, nisashi);
    eq(g.canAttack(nisashi), true, 'Nisashi can attack a second time');
    await g.conductAttack(0, nisashi);
    eq(g.canAttack(nisashi), false, 'no third attack');
    eq(g.players[1].lp, 8000 - 2800, 'two direct attacks');
  });

  await test('Extras: Backs to the Wall — pay down to 100 LP, revive Six Samurai with different names', async () => {
    const { g, place } = xSetup();
    const btw = place(0, cardByName('Backs to the Wall'), 'szone', { faceUp: false });
    const k1 = place(0, cardByName('The Six Samurai - Kamon'), 'grave');
    const k2 = place(0, cardByName('The Six Samurai - Kamon'), 'grave');
    const z = place(0, cardByName('The Six Samurai - Zanji'), 'grave');
    const onField = place(0, cardByName('The Six Samurai - Irou'), 'mzone');
    const irouGy = place(0, cardByName('The Six Samurai - Irou'), 'grave');
    await activateCard(g, 0, btw);
    eq(g.players[0].lp, 100, 'LP paid down to 100');
    eq(z.location, 'mzone', 'Zanji revived');
    eq([k1, k2].filter((c) => c.location === 'mzone').length, 1, 'one Kamon (names must differ)');
    eq(irouGy.location, 'grave', 'no second Irou (same name as a monster you control)');
    eq(onField.location, 'mzone', 'Irou stays');
  });

  await test('Extras: Evil HERO Infernal Prodigy — Summon with an empty field, draw after a HERO Tribute Summon', async () => {
    const { g, place } = xSetup();
    const ip = place(0, cardByName('Evil HERO Infernal Prodigy'), 'hand');
    const act = procOf(g, ip);
    if (!act) throw new Error('proc not offered');
    await g.performAction(0, act);
    eq(ip.location, 'mzone', 'Special Summoned');
    eq(ip.pos, 'atk', 'in Attack Position');
    const ip2 = place(0, cardByName('Evil HERO Infernal Prodigy'), 'hand');
    eq(!!procOf(g, ip2), false, 'not with a monster on the field');
    place(1, T.brute, 'mzone');
    const edge = place(0, cardByName('Evil HERO Malicious Edge'), 'hand');
    await g.performAction(0, { type: 'summon', card: edge });
    eq(edge.location, 'mzone', 'Malicious Edge Tribute Summoned');
    eq(ip.location, 'grave', 'Prodigy Tributed');
    const hand = g.players[0].hand.length;
    await (g as any).setPhase('end');
    eq(g.players[0].hand.length, hand + 1, 'drew 1 card in the End Phase');
  });

  await test('Extras: Red-Eyes Darkness Metal Dragon — banish a Dragon to Summon, then revive a Dragon', async () => {
    const { g, place } = xSetup();
    const wy = place(0, cardByName('Red-Eyes Wyvern'), 'mzone');
    const redmd = place(0, cardByName('Red-Eyes Darkness Metal Dragon'), 'hand');
    const rebd = place(0, cardByName('Red-Eyes B. Dragon'), 'grave');
    const act = procOf(g, redmd);
    if (!act) throw new Error('proc not offered');
    await g.performAction(0, act);
    eq(redmd.location, 'mzone', 'REDMD Special Summoned');
    eq(wy.location, 'banished', 'Wyvern removed from play');
    await activateCard(g, 0, redmd);
    eq(rebd.location, 'mzone', 'Red-Eyes B. Dragon Special Summoned from the GY');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === redmd), false, 'once per turn');
  });

  await test('Extras: Red-Eyes Wyvern revives a Red-Eyes in the End Phase only without a Normal Summon', async () => {
    const a = xSetup();
    const wy = a.place(0, cardByName('Red-Eyes Wyvern'), 'grave');
    const redmd = a.place(0, cardByName('Red-Eyes Darkness Metal Dragon'), 'grave');
    await (a.g as any).setPhase('end');
    eq(wy.location, 'banished', 'Wyvern banished');
    eq(redmd.location, 'mzone', 'REDMD revived');

    const b = xSetup();
    const wy2 = b.place(0, cardByName('Red-Eyes Wyvern'), 'grave');
    b.place(0, cardByName('Red-Eyes Darkness Metal Dragon'), 'grave');
    const body = b.place(0, T.brute, 'hand');
    await b.g.performAction(0, { type: 'summon', card: body });
    await (b.g as any).setPhase('end');
    eq(wy2.location, 'grave', 'no effect after a Normal Summon');
  });

  await test('Extras: Phantom of Chaos copies a GY monster until the End Phase; no battle damage to the opponent', async () => {
    const { g, place } = xSetup();
    const ph = place(0, cardByName('Phantom of Chaos'), 'mzone');
    const src = place(0, cardByName('Red-Eyes Darkness Metal Dragon'), 'grave');
    await activateCard(g, 0, ph);
    eq(src.location, 'banished', 'copied monster removed from play');
    eq(ph.name, 'Red-Eyes Darkness Metal Dragon', 'name copied');
    eq(g.getAtk(ph), 2800, 'ATK copied');
    const rebd = place(0, cardByName('Red-Eyes B. Dragon'), 'grave');
    await activateCard(g, 0, ph, 'Special Summon 1 Dragon from hand or GY');
    eq(rebd.location, 'mzone', 'copied effect used');
    const v = place(1, T.brute, 'mzone');
    await g.conductAttack(0, ph);
    eq(v.location, 'grave', 'battle won');
    eq(g.players[1].lp, 8000, 'no battle damage to the opponent');
    await (g as any).setPhase('end');
    eq(ph.name, 'Phantom of Chaos', 'back to Phantom of Chaos');
    eq(g.getAtk(ph), 0, 'back to 0 ATK');
  });

  await test('Extras: Sky Scourge Norleras — banish 1 LIGHT Fairy + 3 DARK Fiends, then wipe hands and field', async () => {
    const { g, place } = xSetup();
    const nor = place(0, cardByName('Sky Scourge Norleras'), 'hand');
    place(0, cardByName('Honest'), 'grave');
    eq(!!procOf(g, nor), false, 'needs 3 DARK Fiends');
    for (let i = 0; i < 3; i++) place(0, cardByName('Phantom of Chaos'), 'grave');
    const act = procOf(g, nor);
    if (!act) throw new Error('proc not offered');
    await g.performAction(0, act);
    eq(nor.location, 'mzone', 'Norleras Special Summoned');
    eq(g.players[0].banished.length, 4, '4 monsters removed from play');
    const opp = place(1, T.brute, 'mzone');
    const oppHand = place(1, T.wall, 'hand');
    const myHand = place(0, T.wall, 'hand');
    await activateCard(g, 0, nor);
    eq(g.players[0].lp, 7000, 'paid 1000');
    eq(nor.location, 'grave', 'Norleras sent too');
    eq(opp.location, 'grave', 'opponent field cleared');
    eq(oppHand.location, 'grave', 'opponent hand cleared');
    eq(myHand.location, 'grave', 'own hand cleared');
    eq(g.players[0].hand.length, 1, 'then drew 1');
  });

  await test("Extras: Dark Dust Spirit wipes face-up monsters and returns; Vanity's Fiend stops Special Summons", async () => {
    const { g, place } = xSetup();
    const fodder = place(0, T.wall, 'mzone');
    const theirs = place(1, T.brute, 'mzone');
    const dds = place(0, cardByName('Dark Dust Spirit'), 'hand');
    await g.performAction(0, { type: 'summon', card: dds });
    eq(dds.location, 'mzone', 'Tribute Summoned');
    eq(fodder.location, 'grave', 'Tribute used');
    eq(theirs.location, 'grave', 'opponent monster destroyed');
    await (g as any).setPhase('end');
    eq(dds.location, 'hand', 'Spirit returned to the hand');
    await g.sendToGrave([dds], 'effect');
    eq((await g.specialSummon([dds], 0, { pos: 'atk' })).length, 0, 'Dark Dust Spirit cannot be Special Summoned');

    const v = xSetup();
    v.place(0, cardByName("Vanity's Fiend"), 'mzone');
    const rev = v.place(1, T.brute, 'grave');
    eq(v.g.queryPlayer(1, 'cannotSpecialSummon'), true, 'opponent cannot Special Summon');
    eq(v.g.queryPlayer(0, 'cannotSpecialSummon'), true, 'controller cannot Special Summon either');
    eq((await v.g.specialSummon([rev], 1, { pos: 'atk' })).length, 0, 'Special Summon blocked');
  });
}

// ---------------------------------------------------------------- Archetype extras, wave 2 (group E)

async function archetypeExtras2Tests() {
  const ySetup = () => {
    const s = setup();
    ensureTdgsPatches(s.g);
    ensureArchetypeExtras2Patches(s.g);
    return s;
  };
  const procOf = (g: Game, c: CardInstance) => g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === c);

  await test('Extras2: Ancient Gear Golem — piercing, no Spell/Trap responses to its attack, cannot be Special Summoned', async () => {
    const { g, c1, place } = ySetup();
    const golem = place(0, cardByName('Ancient Gear Golem'), 'mzone');
    const mf = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    const wall = place(1, T.wall, 'mzone', { pos: 'def' });
    c1.respond = respondWith('Mirror Force');
    await g.conductAttack(0, golem);
    eq(mf.location, 'szone', 'Mirror Force could not be activated');
    eq(golem.location, 'mzone', 'Golem survives');
    eq(wall.location, 'grave', 'wall destroyed');
    eq(g.players[1].lp, 8000 - 1000, 'piercing damage 3000 - 2000');
    await g.sendToGrave([golem], 'effect');
    eq((await g.specialSummon([golem], 0, { pos: 'atk' })).length, 0, 'cannot be Special Summoned from the GY');
    await g.banish([wall], 'effect', 0);
    const reborn = place(0, cardByName('Monster Reborn'), 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === reborn), false, 'Monster Reborn has no target');
  });

  await test('Extras2: Ancient Gear Castle — +300 ATK, counters on Normal Summons, sent instead of Tributes', async () => {
    const { g, place } = ySetup();
    const castle = place(0, cardByName('Ancient Gear Castle'), 'fzone', { faceUp: true });
    castle.activeOnField = true;
    const soldier = place(0, cardByName('Ancient Gear Soldier'), 'mzone');
    eq(g.getAtk(soldier), 1600, 'Ancient Gear Soldier 1300 + 300');
    const body = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'summon', card: body });
    eq(castle.counters.gear, 1, '1 counter after a Normal Summon');
    castle.counters.gear = 2;
    g.players[0].normalSummonsLeft = 1;
    await g.sendToGrave([soldier], 'effect');
    const golem = place(0, cardByName('Ancient Gear Golem'), 'hand');
    eq(g.canNormalSummon(0, golem), true, 'Golem can be Summoned with 1 monster and a 2-counter Castle');
    await g.performAction(0, { type: 'summon', card: golem });
    eq(golem.location, 'mzone', 'Golem Tribute Summoned');
    eq(castle.location, 'grave', 'Castle sent to the GY');
    eq(body.location, 'mzone', 'no monster Tributed');
  });

  await test('Extras2: Gadjiltron Dragon / Chimera gain effects from the Gadgets Tributed', async () => {
    const a = ySetup();
    a.place(0, cardByName('Green Gadget'), 'mzone');
    a.place(0, cardByName('Red Gadget'), 'mzone');
    const dragon = a.place(0, cardByName('Ancient Gear Gadjiltron Dragon'), 'hand');
    await a.g.performAction(0, { type: 'summon', card: dragon });
    eq(dragon.location, 'mzone', 'Dragon Tribute Summoned');
    a.place(1, T.wall, 'mzone', { pos: 'def' });
    await a.g.conductAttack(0, dragon);
    eq(a.g.players[1].lp, 8000 - 1000 - 400, 'Green: piercing 1000, Red: +400');

    const b = ySetup();
    b.place(0, cardByName('Yellow Gadget'), 'mzone');
    const chim = b.place(0, cardByName('Ancient Gear Gadjiltron Chimera'), 'hand');
    await b.g.performAction(0, { type: 'summon', card: chim });
    eq(b.g.getAtk(chim), 2300, 'no Green Gadget: 2300 ATK');
    b.place(1, T.brute, 'mzone');
    await b.g.conductAttack(0, chim);
    eq(b.g.players[1].lp, 8000 - 500 - 700, 'Yellow: +700 after destroying a monster');

    const c = ySetup();
    c.place(0, cardByName('Green Gadget'), 'mzone');
    const chim2 = c.place(0, cardByName('Ancient Gear Gadjiltron Chimera'), 'hand');
    await c.g.performAction(0, { type: 'summon', card: chim2 });
    eq(c.g.getAtk(chim2), 2600, 'Green: 2600 ATK');
  });

  await test('Extras2: Ancient Gear Beast negates a monster it destroys; Engineer destroys a Spell/Trap after attacking', async () => {
    const a = ySetup();
    const beast = a.place(0, cardByName('Ancient Gear Beast'), 'mzone');
    const sangan = a.place(1, cardByName('Sangan'), 'mzone');
    const hand = a.g.players[1].hand.length;
    await a.g.conductAttack(0, beast);
    await a.g.processTriggers(true);
    eq(sangan.location, 'grave', 'Sangan destroyed');
    eq(a.g.players[1].hand.length, hand, 'Sangan did not search');

    const b = ySetup();
    const eng = b.place(0, cardByName('Ancient Gear Engineer'), 'mzone');
    const st = b.place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    b.c1.respond = respondWith('Mirror Force');
    await b.g.conductAttack(0, eng);
    eq(st.location, 'grave', 'Set Mirror Force destroyed');
    eq(eng.location, 'mzone', 'Engineer survives');
  });

  await test('Extras2: Ancient Gear Special Summons itself; Machine Duplication Summons 2 copies; Geartown fetches Gadjiltron', async () => {
    const { g, c0, place } = ySetup();
    c0.pick = (_g, req) => req.candidates.slice(0, req.max);
    place(0, cardByName('Ancient Gear'), 'mzone');
    const h = place(0, cardByName('Ancient Gear'), 'hand');
    const act = procOf(g, h);
    if (!act) throw new Error('proc not offered');
    await g.performAction(0, act);
    eq(h.location, 'mzone', 'Special Summoned from the hand');
    eq(h.pos, 'atk', 'in Attack Position');
    const d1 = place(0, cardByName('Ancient Gear'), 'deck');
    const d2 = place(0, cardByName('Ancient Gear'), 'deck');
    await activateCard(g, 0, place(0, cardByName('Machine Duplication'), 'hand'));
    eq(d1.location === 'mzone' && d2.location === 'mzone', true, 'both copies Special Summoned from the Deck');

    const b = ySetup();
    const town = b.place(0, cardByName('Geartown'), 'fzone', { faceUp: true });
    town.activeOnField = true;
    const golem = b.place(0, cardByName('Ancient Gear Golem'), 'deck');
    const drag = b.place(0, cardByName('Ancient Gear Gadjiltron Dragon'), 'deck');
    await b.g.destroy([town], 'effect', 1);
    await b.g.processTriggers(true);
    eq(drag.location, 'mzone', 'Gadjiltron Dragon Special Summoned from the Deck');
    eq(golem.location, 'deck', 'Golem cannot be');
  });

  await test('Extras2: Call of the Mummy Special Summons a Zombie from the hand only with no monsters, once per turn', async () => {
    const { g, place } = ySetup();
    const mummy = place(0, cardByName('Call of the Mummy'), 'szone', { faceUp: true });
    mummy.activeOnField = true;
    const vl = place(0, cardByName('Vampire Lord'), 'hand');
    const rk = place(0, cardByName('Ryu Kokki'), 'hand');
    const body = place(0, T.brute, 'mzone');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === mummy), false, 'not while you control a monster');
    await g.sendToGrave([body], 'effect');
    await activateCard(g, 0, mummy);
    eq([vl, rk].filter((c) => c.location === 'mzone').length, 1, 'one Zombie Special Summoned');
    await g.sendToGrave(g.monsters(0), 'effect');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === mummy), false, 'once per turn');
  });
}
