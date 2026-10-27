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
import { AIController } from '../src/ai/ai';
import { Ctx } from '../src/engine/ctx';
import { GY_BANISH_COST_PROBLEMS } from '../src/cards/gy-costs';
import { WHY_NOT_PROBLEMS, whyRow, whySentence } from '../src/cards/why-not';

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
  await fuzzRegressionTests();
  await sdmmTests();
  await geminiTests();
  await locationRulesTests();
  await extraDeckTests();
  await graveEffectTests();
  await archetypeAuditTests();
  await zombieGraveAlienAuditTests();

  await blackwingLightswornAuditTests();
  await heroDadPsychicAuditTests();
  await plantSaberSamuraiAuditTests();
  await gladiatorDeepTests();
  await deckExtras3Tests();

  await test('Giant Trunade: Set cards returned to the hand stay hidden; face-up ones are revealed', async () => {
    const { g, place } = setup();
    const gt = place(0, cardByName('Giant Trunade'), 'hand');
    const set = place(1, cardByName('Mirror Force'), 'szone');
    const up = place(1, cardByName('Swords of Revealing Light'), 'szone', { faceUp: true });
    await activateCard(g, 0, gt);
    eq(set.location, 'hand', 'Set card back in hand');
    eq(g.isPublic(set, 0), false, 'Set card hidden from the opponent');
    eq(up.location, 'hand', 'face-up card back in hand');
    eq(g.isPublic(up, 0), true, 'face-up card stays known');
  });
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

  await test('Priority (2010 rule): Judgment Dragon uses its effect before Bottomless Trap Hole; Bottomless chained to it still lets the wipe resolve', async () => {
    const { g, c0, c1, place } = setup();
    for (const n of ['Ryko, Lightsworn Hunter', 'Lumina, Lightsworn Summoner', 'Wulf, Lightsworn Beast', 'Lyla, Lightsworn Sorceress']) place(0, cardByName(n), 'grave');
    const jd = place(0, cardByName('Judgment Dragon'), 'hand');
    const bottomless = place(1, cardByName('Bottomless Trap Hole'), 'szone', { faceUp: false });
    const oppMon = place(1, T.brute, 'mzone');
    const myOther = place(0, T.wall, 'mzone');
    let priorityOffered = false;
    c0.respond = (_g, req) => {
      if (req.kind === 'priority') priorityOffered = true;
      return req.options.find((o) => o.card === jd) ?? null;
    };
    c1.respond = respondWith('Bottomless Trap Hole');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === jd);
    eq(!!proc, true, 'Judgment Dragon can be summoned');
    await g.performAction(0, proc!);
    eq(priorityOffered, true, 'the turn player gets priority after the summon');
    eq(jd.location, 'banished', 'Bottomless (chained to the effect) banishes Judgment Dragon');
    eq(bottomless.location, 'grave', 'Bottomless was used');
    eq(oppMon.location, 'grave', "Judgment Dragon's effect still resolves: opponent's monster destroyed");
    eq(myOther.location, 'grave', 'and your other cards too');
    eq(g.players[0].lp, 8000 - 1000, 'paid 1000 LP');
  });

  await test('Priority: without a usable effect, the opponent responds first as usual', async () => {
    const { g, c0, c1, place } = setup();
    const mon = place(0, T.brute, 'hand');
    place(1, cardByName('Bottomless Trap Hole'), 'szone', { faceUp: false });
    const kinds: string[] = [];
    c0.respond = (_g, req) => (kinds.push('me:' + req.kind), null);
    c1.respond = respondWith('Bottomless Trap Hole');
    const a = g.legalMainActions(0).find((x) => x.type === 'summon' && x.card === mon)!;
    await g.performAction(0, a);
    eq(kinds.includes('me:priority'), false, 'no priority window for a monster with no effect');
    eq(mon.location, 'banished', 'Bottomless banishes the 1800 ATK monster');
  });

  await test('Vayu (from the GY): banish it with a non-Tuner Blackwing, Special Summon a Blackwing Synchro of the total Level', async () => {
    const { g, c0, place } = setup();
    const vayu = place(0, cardByName('Blackwing - Vayu the Emblem of Honor'), 'grave');
    const sirocco = place(0, cardByName('Blackwing - Sirocco the Dawn'), 'grave');
    const armed = place(0, cardByName('Blackwing Armed Wing'), 'extra');
    const act = g.legalMainActions(0).find((a) => a.type === 'activate' && a.card === vayu);
    eq(!!act, true, 'offered from the GY in the Main Phase');
    c0.pick = (_g, req) => req.candidates.slice(0, Math.max(1, req.min));
    await g.performAction(0, act!);
    eq(vayu.location, 'banished', 'Vayu banished');
    eq(sirocco.location, 'banished', 'Sirocco banished');
    eq(armed.location, 'mzone', 'Level 6 Blackwing Armed Wing summoned');
    eq(g.isNegated(armed), true, 'with its effects negated');
  });

  await test('Brain Control: pay 800, take a face-up monster until the End Phase, then it goes back', async () => {
    const { g, place } = setup();
    const bc = place(0, cardByName('Brain Control'), 'hand');
    const mon = place(1, T.brute, 'mzone');
    await activateCard(g, 0, bc);
    eq(g.players[0].lp, 8000 - 800, 'paid 800');
    eq(mon.controller, 0, 'taken');
    await (g as any).setPhase('end');
    await (g as any).phaseWindow?.();
    eq(mon.controller, 1, 'returned in the End Phase');
    const { g: g2, place: place2 } = setup();
    g2.players[0].lp = 700;
    const bc2 = place2(0, cardByName('Brain Control'), 'hand');
    place2(1, T.brute, 'mzone');
    eq(g2.legalMainActions(0).some((a) => a.type === 'activate' && a.card === bc2), false, 'cannot activate with 700 LP');
  });

  await test('Card Trooper: the ATK gain lasts until the end of this turn only', async () => {
    const { g, c0, place } = setup();
    const ct = place(0, cardByName('Card Trooper'), 'mzone');
    (c0 as any).chooseOption = async (_g: unknown, _p: unknown, req: { options: unknown[] }) => req.options.length - 1;
    await activateCard(g, 0, ct);
    eq(g.getAtk(ct), 400 + 1500, '+1500 after sending 3');
    // the End Phase drops 'turn' modifiers; 'opponentEnd' ones would survive into the opponent's turn
    eq(ct.tempMods.filter((t) => t.q === 'atk').every((t) => t.until === 'turn'), true, 'expires at the end of this turn');
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

// Regressions for bugs found by the self-play fuzz (scripts/fuzz.ts).
async function fuzzRegressionTests() {
  console.log('Fuzz regressions');

  await test('AI: no Tribute Summon of Raiza / Caius when their mandatory trigger could only hit its own cards', async () => {
    for (const name of ['Raiza the Storm Monarch', 'Caius the Shadow Monarch']) {
      const { g, place } = setup();
      place(0, cardByName('Treeborn Frog'), 'mzone');
      const monarch = place(0, cardByName(name), 'hand');
      const ai = new AIController('hard', 7);
      const isMonarchSummon = (a: Action) => a.type === 'summon' && a.card === monarch;
      eq(g.legalMainActions(0).some(isMonarchSummon), true, `${name} can be Tribute Summoned`);
      eq(isMonarchSummon(await ai.chooseAction(g, 0, g.legalMainActions(0))), false, `${name} not summoned onto an empty opposing field`);
      place(1, T.brute, 'mzone');
      eq(isMonarchSummon(await ai.chooseAction(g, 0, g.legalMainActions(0))), true, `${name} summoned when the opponent has a target`);
    }
  });

  await test('Bad Reaction to Simochi + Prime Material Dragon / Rainbow Life: the LP gain is converted once (no endless loop)', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    await activateCard(g, 1, place(1, cardByName('Bad Reaction to Simochi'), 'szone', { faceUp: false }));
    eq(g.spellTraps(1).some((c) => c.name === 'Bad Reaction to Simochi' && c.faceUp), true, 'Simochi is active');
    ensurePtdnPatches(g);
    place(1, cardByName('Prime Material Dragon'), 'mzone');
    await g.recover(0, 500);
    eq(g.players[0].lp, 8500, 'gain -> Simochi damage -> Prime Material gain');
    await g.damage(0, 300, 'effect');
    eq(g.players[0].lp, 8800, 'damage -> Prime Material gain -> Simochi damage -> gain');
    await g.sendToGrave(g.monsters(1), 'effect');
    g.turnData['ptdn:rainbowLife:0'] = true;
    await g.recover(0, 200);
    eq(g.players[0].lp, 9000, 'Rainbow Life: gain -> Simochi damage -> gain');
  });

  const procAct = (g: Game, c: CardInstance) => g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === c);

  await test('Chimeratech Fortress Dragon: with full Monster Zones it needs one of your own monsters as material', async () => {
    const { g, place } = setup();
    const cfd = place(0, cardByName('Chimeratech Fortress Dragon'), 'extra');
    const mine = [0, 1, 2, 3].map(() => place(0, T.brute, 'mzone'));
    const fifth = place(0, T.brute, 'mzone');
    const cd = place(1, cardByName('Cyber Dragon'), 'mzone');
    const gadget = place(1, cardByName('Yellow Gadget'), 'mzone');
    eq(g.freeMZones(0), 0, 'Monster Zones full');
    eq(!!procAct(g, cfd), false, 'not offered when only the opponent has the materials');
    await g.sendToGrave([fifth], 'effect');
    const own = place(0, cardByName('Green Gadget'), 'mzone');
    eq(g.freeMZones(0), 0, 'Monster Zones full again');
    const act = procAct(g, cfd);
    if (!act) throw new Error('Contact Fusion not offered with an own Machine');
    await g.performAction(0, act);
    eq(cfd.location, 'mzone', 'Chimeratech Fortress Dragon Special Summoned');
    eq(own.location, 'grave', 'own Machine used');
    eq(cd.location, 'grave', "opponent's Cyber Dragon used");
    eq(gadget.location, 'mzone', 'unpicked Machine stays');
    eq(g.getAtk(cfd), 2000, '1000 x 2 materials');
    void mine;
  });

  await test('Reptilianne Vaskii: with full Monster Zones it must Tribute one of your own 0-ATK monsters', async () => {
    const { g, c0, place } = setup();
    // A player who picks the opponent's monsters first: before the fix that Tributed 2 of theirs and summoned nothing.
    c0.pick = (_g, req) => [...req.candidates].sort((a, b) => b.controller - a.controller).slice(0, req.min);
    const vaskii = place(0, cardByName('Reptilianne Vaskii'), 'hand');
    const zero = findCard('Rules Test Zero') ?? normal('Rules Test Zero', 'EARTH', 'Rock', 4, 0, 0);
    [0, 1, 2, 3].forEach(() => place(0, T.brute, 'mzone'));
    const own = place(0, zero, 'mzone');
    const opp = [place(1, zero, 'mzone'), place(1, zero, 'mzone')];
    const act = procAct(g, vaskii);
    if (!act) throw new Error('Vaskii not offered');
    await g.performAction(0, act);
    eq(vaskii.location, 'mzone', 'Vaskii Special Summoned');
    eq(own.location, 'grave', 'own 0-ATK monster Tributed');
    eq(opp.filter((c) => c.location === 'grave').length, 1, 'one opponent monster Tributed');
  });

  await test('Synchro Summon is not lost when using a material switches a Special Summon lock back on (Brain Golem / Archlord Kristya)', async () => {
    const { g, place } = setup();
    place(1, cardByName('Archlord Kristya'), 'mzone');
    const golem = place(0, cardByName('Brain Golem'), 'mzone');
    const tune = place(0, tuner, 'mzone');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), false, "Brain Golem negates Kristya's lock");
    const goyo = place(0, cardByName('Stardust Dragon'), 'extra');
    const act = g.legalMainActions(0).find((a) => a.type === 'synchro' && a.card === goyo);
    if (!act) throw new Error('Synchro Summon not offered');
    await g.performAction(0, act);
    eq(golem.location, 'grave', 'Brain Golem used');
    eq(tune.location, 'grave', 'Tuner used');
    eq(goyo.location, 'mzone', 'Stardust Dragon Synchro Summoned');
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), true, 'the lock applies again afterwards');
  });

  await test('Star Blast is not offered when the only monster in hand is already Level 1 from an earlier Star Blast', async () => {
    const { g, place } = setup();
    const low = place(0, tuner, 'hand');
    await activateCard(g, 0, place(0, cardByName('Star Blast'), 'hand'));
    eq(g.getLevel(low), 1, 'Level 2 -> 1');
    const second = place(0, cardByName('Star Blast'), 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === second), false, 'second Star Blast not offered');
  });

  await test('D.D. Warrior Lady banishes a monster it destroys before it reaches the GY (no Sangan search)', async () => {
    const { g, place } = setup();
    const lady = place(0, cardByName('D.D. Warrior Lady'), 'mzone');
    const sangan = place(1, cardByName('Sangan'), 'mzone');
    place(1, T.dark, 'deck');
    const hand = g.players[1].hand.length;
    await g.conductAttack(0, lady);
    await g.processTriggers(true);
    eq(sangan.location, 'banished', 'Sangan banished');
    eq(lady.location, 'banished', 'D.D. Warrior Lady banished');
    eq(g.players[1].hand.length, hand, 'Sangan never reached the GY, so no search');
  });

  // ---- approximation audit (premade cards)
  const live = (c: CardInstance) => {
    c.activeOnField = true;
    return c;
  };
  const ctxOf = (g: Game, src: CardInstance, p: PlayerId) => new Ctx(g, src, src.data.effects?.[0] ?? { kind: 'ignition' }, p);

  await test('Legendary Jujitsu Master returns the attacker to the top of the Deck even when it is destroyed by the battle', async () => {
    const { g, place } = setup();
    const giant = place(0, T.giant, 'mzone');
    const jujitsu = place(1, cardByName('Legendary Jujitsu Master'), 'mzone', { pos: 'def' });
    await g.conductAttack(0, giant);
    await g.processTriggers(true);
    eq(jujitsu.location, 'grave', 'Jujitsu Master destroyed');
    eq(giant.location, 'deck', 'attacker returned to the Deck');
    const deck = g.players[0].deck;
    eq(deck[deck.length - 1], giant, 'on top');
  });

  await test('Light-Imprisoning Mirror negates a LIGHT monster effect when it resolves, not if the Mirror is gone by then', async () => {
    for (const mst of [false, true]) {
      const { g, c0, place } = setup();
      place(0, T.wall, 'deck');
      live(place(1, cardByName('Light-Imprisoning Mirror'), 'szone', { faceUp: true }));
      const alch = place(0, cardByName('Dimensional Alchemist'), 'mzone');
      if (mst) {
        place(0, cardByName('Mystical Space Typhoon'), 'szone', { faceUp: false });
        c0.respond = respondWith('Mystical Space Typhoon');
      }
      await activateCard(g, 0, alch);
      eq(g.getAtk(alch), mst ? 1800 : 1300, mst ? 'Mirror destroyed in response: the effect resolves' : 'negated by the Mirror');
    }
  });

  await test('Consecrated Light: DARK monsters cannot be Normal or Special Summoned (they can be Set)', async () => {
    const { g, place } = setup();
    place(1, cardByName('Consecrated Light'), 'mzone');
    const dark = place(0, T.dark, 'hand');
    const acts = g.legalMainActions(0).filter((a) => 'card' in a && a.card === dark).map((a) => a.type);
    eq(acts.includes('summon'), false, 'no Normal Summon');
    eq(acts.includes('set'), true, 'Set allowed');
    const inGy = place(0, T.dark, 'grave');
    eq((await g.specialSummon([inGy], 0)).length, 0, 'no Special Summon');
    eq(inGy.location, 'grave', 'stays in the GY');
  });

  await test('Swap Frog: the extra Normal Summon is only for a Level 2 or lower WATER Aqua monster', async () => {
    const { g, c0, place } = setup();
    const frog = place(0, cardByName('Swap Frog'), 'mzone');
    place(0, T.brute, 'mzone');
    const raiza = place(0, cardByName('Raiza the Storm Monarch'), 'hand');
    const treeborn = place(0, cardByName('Treeborn Frog'), 'hand');
    g.players[0].normalSummonsLeft = 0;
    c0.pick = (_g, req) => (req.candidates.includes(frog) ? [frog] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, frog, 'Bounce a monster: extra Normal Summon');
    eq(frog.location, 'hand', 'Swap Frog returned to the hand');
    eq(g.canNormalSummon(0, raiza, false), false, 'not a Monarch');
    eq(g.canNormalSummon(0, treeborn, true), false, 'not a Set');
    eq(g.canNormalSummon(0, treeborn, false), true, 'Treeborn Frog can be Normal Summoned');
    await g.normalSummon(0, treeborn, false);
    eq(treeborn.location, 'mzone', 'summoned');
    eq(g.canNormalSummon(0, frog, false), false, 'the extra Summon is used up');
  });

  await test("Aurkus: neither player can target Lightsworn monsters; Turbo Warrior: no Level 6 or lower monster's effect can target it", async () => {
    const { g, place } = setup();
    place(0, cardByName('Aurkus, Lightsworn Druid'), 'mzone');
    const lumina = place(0, cardByName('Lumina, Lightsworn Summoner'), 'mzone');
    const mine = place(0, cardByName('Dimensional Alchemist'), 'mzone');
    eq(ctxOf(g, mine, 0).canTarget(lumina), false, 'own effect cannot target a Lightsworn');
    eq(ctxOf(g, place(1, T.brute, 'mzone'), 1).canTarget(lumina), false, "opponent's effect cannot target a Lightsworn");
    const turbo = place(1, cardByName('Turbo Warrior'), 'mzone');
    eq(ctxOf(g, mine, 0).canTarget(turbo), false, 'Level 4 monster effect');
    eq(ctxOf(g, place(1, cardByName('Dimensional Alchemist'), 'mzone'), 1).canTarget(turbo), false, "its controller's Level 4 monster effect");
    eq(ctxOf(g, place(0, cardByName('Dark Armed Dragon'), 'mzone'), 0).canTarget(turbo), true, 'Level 7 monster effect');
    eq(ctxOf(g, place(0, cardByName('Book of Moon'), 'hand'), 0).canTarget(turbo), true, 'Spell');
  });

  await test('Light and Darkness Dragon negates as its own Chain Link: Book of Moon on it in response lets the activation resolve', async () => {
    for (const book of [false, true]) {
      const { g, c0, place } = setup();
      const ladd = place(1, cardByName('Light and Darkness Dragon'), 'mzone');
      g.emit({ type: 'phaseStart', phase: 'main1', player: 0 });
      g.pending = [];
      place(0, T.wall, 'deck');
      place(0, T.wall, 'deck');
      if (book) {
        place(0, cardByName('Book of Moon'), 'szone', { faceUp: false });
        c0.respond = respondWith('Book of Moon');
      }
      const hand = g.players[0].hand.length;
      await activateCard(g, 0, place(0, cardByName('Upstart Goblin'), 'hand'));
      if (book) {
        eq(g.players[0].hand.length, hand + 1, 'Upstart Goblin resolved (drew 1)');
        eq(ladd.faceUp, false, 'LaDD face-down');
        eq(g.getAtk(ladd), 2800, 'no ATK lost');
      } else {
        eq(g.players[0].hand.length, hand, 'Upstart Goblin negated');
        eq(g.getAtk(ladd), 2300, 'lost 500 ATK');
      }
    }
  });

  await test('Beast King Barbaros: 2-Tribute Summon keeps 3000 ATK; without Tributes its original ATK is 1900', async () => {
    const a = setup();
    const bk = a.place(0, cardByName('Beast King Barbaros'), 'hand');
    a.place(0, T.brute, 'mzone');
    a.place(0, T.brute, 'mzone');
    const two = a.g.legalMainActions(0).find((x) => x.type === 'proc' && x.card === bk && x.act.effect.label === 'Tribute Summon (2 Tributes)');
    if (!two) throw new Error('2-Tribute Summon not offered');
    eq(a.g.legalMainActions(0).some((x) => x.type === 'proc' && x.card === bk && x.act.effect.label === 'Tribute Summon (3 Tributes)'), false, 'no 3-Tribute option with 2 monsters');
    await a.g.performAction(0, two);
    eq(bk.location, 'mzone', 'Tribute Summoned');
    eq(a.g.getAtk(bk), 3000, '3000 ATK');
    const b = setup();
    const bk2 = b.place(0, cardByName('Beast King Barbaros'), 'hand');
    const plain = b.g.legalMainActions(0).find((x) => x.type === 'summon' && x.card === bk2);
    if (!plain) throw new Error('no-Tribute Normal Summon not offered');
    await b.g.performAction(0, plain);
    eq(bk2.location, 'mzone', 'Normal Summoned without Tributes');
    eq(b.g.baseAtk(bk2), 1900, 'original ATK 1900');
    eq(b.g.getAtk(bk2), 1900, 'ATK 1900');
  });

  await test('Dimensional Fissure banishes monsters only; Necrovalley stops GY-banish costs; Zombie World stops non-Zombie Tribute Summons; Phantom Dragon locks 2 zones', async () => {
    const { g, place } = setup();
    live(place(0, cardByName('Dimensional Fissure'), 'szone', { faceUp: true }));
    const spellOnField = place(0, cardByName('Book of Moon'), 'szone', { faceUp: false });
    const mon = place(1, T.brute, 'mzone');
    await g.sendToGrave([spellOnField, mon], 'effect');
    eq(spellOnField.location, 'grave', 'Spell goes to the GY');
    eq(mon.location, 'banished', 'monster banished');

    const n = setup();
    const dad = n.place(0, cardByName('Dark Armed Dragon'), 'mzone');
    for (let i = 0; i < 3; i++) n.place(0, T.dark, 'grave');
    n.place(1, T.brute, 'mzone');
    const dadOffered = () => n.g.getActivations(0, { open: true }).some((x) => x.card === dad);
    eq(dadOffered(), true, 'offered without Necrovalley');
    const valley = live(n.place(1, cardByName('Necrovalley'), 'fzone', { faceUp: true }));
    eq(dadOffered(), false, 'not offered under Necrovalley');
    await n.g.sendToGrave([valley], 'effect');
    eq(dadOffered(), true, 'offered again');

    const z = setup();
    live(z.place(1, cardByName('Zombie World'), 'fzone', { faceUp: true }));
    z.place(0, T.brute, 'mzone');
    const raiza = z.place(0, cardByName('Raiza the Storm Monarch'), 'hand');
    const vamp = z.place(0, cardByName('Vampire Lord'), 'hand');
    eq(z.g.canNormalSummon(0, raiza, false), false, 'no Tribute Summon of a non-Zombie');
    eq(z.g.canNormalSummon(0, raiza, true), true, 'Tribute Set allowed');
    eq(z.g.canNormalSummon(0, vamp, false), true, 'Zombie can be Tribute Summoned');

    const p = setup();
    p.place(0, cardByName('Phantom Dragon'), 'mzone');
    eq(p.g.freeMZones(0), 2, '5 zones - Phantom Dragon - 2 locked');
    eq(p.g.freeMZones(1), 5, "opponent's zones not locked");
  });

  await test("Machina Fortress: the discard happens as the opponent's targeting monster effect resolves", async () => {
    const { g, c1, place } = setup();
    g.turnPlayer = 1;
    const fortress = place(0, cardByName('Machina Fortress'), 'mzone');
    const dad = place(1, cardByName('Dark Armed Dragon'), 'mzone');
    for (let i = 0; i < 3; i++) place(1, T.dark, 'grave');
    place(1, T.wall, 'hand');
    place(1, T.wall, 'hand');
    c1.pick = (_g, req) => (req.candidates.includes(fortress) ? [fortress] : req.candidates.slice(0, req.min));
    const hand = g.players[1].hand.length;
    await activateCard(g, 1, dad);
    eq(fortress.location, 'grave', 'Fortress destroyed');
    eq(g.players[1].hand.length, hand - 1, 'one card discarded from the hand');
  });

  await test('gy-costs table: every card and effect index resolves', async () => {
    eq(GY_BANISH_COST_PROBLEMS.join('; '), '', 'problems');
  });

  await test('why-not table: every card and effect index resolves; reasons follow the card checks', async () => {
    eq(WHY_NOT_PROBLEMS.join('; '), '', 'problems');
    const why = (g: Game, c: CardInstance, i = 0) => {
      const ef = c.data.effects![i];
      return ef.whyNot ? ef.whyNot(new Ctx(g, c, ef, c.controller)) : 'none';
    };
    const { g, place } = setup();
    const bc = place(0, cardByName('Brain Control'), 'hand');
    place(1, cardByName('Stardust Dragon'), 'mzone');
    eq(why(g, bc), "can't take Stardust Dragon\nIt's a Synchro Monster", 'Brain Control: only a Stardust Dragon');
    eq(JSON.stringify(whyRow('Activate', why(g, bc)!)), JSON.stringify({ label: "Activate: can't take Stardust Dragon", sub: "It's a Synchro Monster" }), 'menu row');
    const dadOpp = place(1, cardByName('Dark Armed Dragon'), 'mzone');
    eq(why(g, bc), "none of their monsters can be taken\nOnly ones that can be Normal Summoned", 'Brain Control: Stardust + Dark Armed Dragon');
    g.rawMove(dadOpp, 'grave', {});
    place(1, T.brute, 'mzone');
    eq(why(g, bc), null, 'Brain Control: a legal target');
    g.players[0].lp = 800;
    eq(/more than 800 LP/.test(why(g, bc) ?? ''), true, 'Brain Control: LP');
    const dad = place(0, cardByName('Dark Armed Dragon'), 'hand');
    place(0, cardByName('Dark Armed Dragon'), 'grave');
    eq(why(g, dad), 'needs exactly 3 DARK in your GY\nYou have 1', 'Dark Armed Dragon count');
    eq(whySentence(why(g, dad)!), 'Needs exactly 3 DARK in your GY. You have 1.', 'as a sentence');
    const frog = place(0, cardByName('Treeborn Frog'), 'grave');
    eq(why(g, frog), null, 'Treeborn: nothing stops it');
    place(0, cardByName('Heavy Storm'), 'szone', { faceUp: false });
    eq(/you control a Spell\/Trap/.test(why(g, frog) ?? ''), true, 'Treeborn: a Set card');
    // every first line fits the menu ("Activate: " + about 35 characters)
    for (const r of [why(g, bc), why(g, dad), why(g, frog)]) eq((r ?? '').split('\n')[0].length <= 40, true, `short: ${r}`);
  });

  await test('Gozen Match: no Synchro Summon that would leave monsters of another Attribute', async () => {
    const darkTuner = findCard('Rules Test Dark Tuner') ?? normal('Rules Test Dark Tuner', 'DARK', 'Fiend', 2, 800, 800);
    if (!darkTuner.mtypes!.includes('tuner')) darkTuner.mtypes!.push('tuner');
    const { g, place } = setup();
    ensureCsocPatches(g);
    live(place(1, cardByName('Gozen Match'), 'szone', { faceUp: true }));
    const dark6 = findCard('Rules Test Dark Six') ?? normal('Rules Test Dark Six', 'DARK', 'Fiend', 6, 2000, 1000);
    const stardust = place(0, cardByName('Stardust Dragon'), 'extra');
    place(0, darkTuner, 'mzone');
    place(0, dark6, 'mzone');
    eq(g.canSynchro(0, stardust), true, 'WIND Synchro using both DARK monsters');
    place(0, T.dark, 'mzone');
    eq(g.canSynchro(0, stardust), false, 'a DARK monster would stay beside the WIND Synchro');
  });

  await test("Frog the Jam: the monster that destroyed it cannot attack during its controller's next turn", async () => {
    const { g, place } = setup();
    const brute = place(0, T.brute, 'mzone');
    place(1, cardByName('Frog the Jam'), 'mzone');
    await g.conductAttack(0, brute);
    await g.processTriggers(true);
    g.turn = 4;
    g.turnPlayer = 0;
    brute.attacksThisTurn = 0;
    eq(g.canAttack(brute), false, "cannot attack in its controller's next turn (turn 4)");
    g.turn = 6;
    eq(g.canAttack(brute), true, 'can attack again afterwards');
  });
}

// ---------------------------------------------------------------- Structure Deck: Machina Mayhem (SDMM)

async function sdmmTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };

  // Machina Fortress: from the hand it can discard itself as part of the 8 Levels (OCG text: "if it discarded itself,
  // it is Special Summoned from the GY"; Macro Cosmos ruling on discarding Fortress for its own effect).
  const cog = findCard('Rules Test Cog') ?? normal('Rules Test Cog', 'EARTH', 'Machine', 1, 100, 100);
  const bigMachine = findCard('Rules Test Big Machine') ?? normal('Rules Test Big Machine', 'EARTH', 'Machine', 8, 2800, 2000);
  const fortAct = (g: Game, c: CardInstance) => g.getActivations(0, { open: true }).find((a) => a.card === c);
  const fortWhy = (g: Game, c: CardInstance) => {
    const ef = c.data.effects![0];
    return ef.whyNot ? ef.whyNot(new Ctx(g, c, ef, c.controller)) : 'none';
  };

  await test('Machina Fortress: a lone Fortress in hand cannot Summon itself (7 < 8); the reason says so', async () => {
    const { g, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'hand');
    eq(!!fortAct(g, f), false, 'not offered');
    eq(fortWhy(g, f), 'needs Machines with 8+ Levels to discard\nYour hand has 7, counting this card', 'why-not');
  });

  await test('Machina Fortress: two Fortresses in hand can Summon (discarding itself + the other: 14)', async () => {
    const { g, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'hand');
    const f2 = place(0, cardByName('Machina Fortress'), 'hand');
    eq(!!fortAct(g, f), true, 'offered');
    eq(fortWhy(g, f), null, 'no why-not');
    await activateCard(g, 0, f);
    eq([f, f2].filter((c) => c.location === 'mzone').length, 1, 'one Fortress Summoned');
    eq([f, f2].filter((c) => c.location === 'grave').length, 1, 'the other discarded');
  });

  await test('Machina Fortress: discards itself + 1 Yellow Gadget in one dialog, then Summons itself from the GY', async () => {
    const { g, c0, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'hand');
    const y1 = place(0, cardByName('Yellow Gadget'), 'hand');
    const y2 = place(0, cardByName('Yellow Gadget'), 'hand');
    const asked: { min: number; max: number; n: number; self: boolean }[] = [];
    c0.pick = (_g, req) => {
      if (req.purpose === 'discard') {
        asked.push({ min: req.min, max: req.max, n: req.candidates.length, self: req.candidates.includes(f) });
        return [f, y1];
      }
      return req.candidates.slice(0, req.min);
    };
    await activateCard(g, 0, f);
    eq(asked.length, 1, 'one discard dialog');
    eq(asked[0].self, true, 'Fortress itself is offered as fodder');
    eq(asked[0].max, 3, 'several Machines can be selected at once');
    eq(f.location, 'mzone', 'Fortress Summoned (from the GY)');
    eq(y1.location, 'grave', 'Yellow Gadget discarded');
    eq(y2.location, 'hand', 'other Yellow Gadget kept');
  });

  await test('Machina Fortress: Fortress + Fortress + Level 1 Machine in hand can Summon; a short pick is asked again', async () => {
    const { g, c0, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'hand');
    const f2 = place(0, cardByName('Machina Fortress'), 'hand');
    const k = place(0, cog, 'hand');
    let calls = 0;
    c0.pick = (_g, req) => {
      if (req.purpose !== 'discard') return req.candidates.slice(0, req.min);
      calls++;
      return calls === 1 ? [k] : [f2];
    };
    await activateCard(g, 0, f);
    eq(calls, 2, 'asked again after only 1/8');
    eq(f.location, 'mzone', 'Fortress Summoned from the hand');
    eq(f2.location, 'grave', 'second Fortress discarded');
    eq(k.location, 'grave', 'Level 1 Machine discarded');
  });

  await test('Machina Fortress: from the GY with Fortress (7) + Level 1 Machine in hand', async () => {
    const { g, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'grave');
    const f2 = place(0, cardByName('Machina Fortress'), 'hand');
    const k = place(0, cog, 'hand');
    eq(fortWhy(g, f), null, 'no why-not');
    await activateCard(g, 0, f);
    eq(f.location, 'mzone', 'GY Fortress Summoned');
    eq(f2.location, 'grave', 'hand Fortress discarded');
    eq(k.location, 'grave', 'Level 1 Machine discarded');
  });

  await test('Machina Fortress: from the GY with one Level 8 Machine in hand; not with only a Level 1', async () => {
    const { g, c0, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'grave');
    const k = place(0, cog, 'hand');
    eq(!!fortAct(g, f), false, 'Level 1 only: not offered');
    eq(fortWhy(g, f), 'needs Machines with 8+ Levels to discard\nYour hand has 1', 'why-not from the GY');
    const big = place(0, bigMachine, 'hand');
    c0.pick = (_g, req) => (req.purpose === 'discard' ? [big] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, f);
    eq(f.location, 'mzone', 'GY Fortress Summoned');
    eq(big.location, 'grave', 'Level 8 Machine discarded');
    eq(k.location, 'hand', 'Level 1 kept');
  });

  await test('Machina Fortress: the AI discards Fortress itself + 1 Gadget rather than 2 Gadgets', async () => {
    const { g, place } = setup();
    const f = place(0, cardByName('Machina Fortress'), 'hand');
    const y1 = place(0, cardByName('Yellow Gadget'), 'hand');
    const y2 = place(0, cardByName('Yellow Gadget'), 'hand');
    g.controllers[0] = new AIController('hard', 7);
    await activateCard(g, 0, f);
    eq(f.location, 'mzone', 'Fortress Summoned');
    eq([y1, y2].filter((c) => c.location === 'hand').length, 1, 'one Gadget kept');
  });

  await test('Dragon Ice: alone in hand it discards itself and is Special Summoned from the GY', async () => {
    const { g, c0, place } = setup();
    const ice = place(0, cardByName('Dragon Ice'), 'hand');
    c0.pick = (_g, req) => (req.purpose === 'discard' ? [ice] : req.candidates.slice(0, req.min));
    g.turnPlayer = 1;
    const brute = place(1, T.brute, 'hand');
    await g.specialSummon([brute], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(ice.location, 'mzone', 'Dragon Ice Summoned from the GY');
  });

  await test('SDMM: Machina Soldier Special Summons a "Machina" monster from the hand when Normal Summoned alone', async () => {
    const { g, place } = setup();
    const soldier = place(0, cardByName('Machina Soldier'), 'hand');
    const sniper = place(0, cardByName('Machina Sniper'), 'hand');
    await g.performAction(0, { type: 'summon', card: soldier });
    eq(sniper.location, 'mzone', 'Machina Sniper Special Summoned');

    const b = setup();
    b.place(0, T.wall, 'mzone');
    const s2 = b.place(0, cardByName('Machina Soldier'), 'hand');
    const sn2 = b.place(0, cardByName('Machina Sniper'), 'hand');
    await b.g.performAction(0, { type: 'summon', card: s2 });
    eq(sn2.location, 'hand', 'no Special Summon while you control another monster');
  });

  await test('SDMM: Machina Sniper — other face-up "Machina" monsters cannot be attacked', async () => {
    const { g, place } = setup();
    const sniper = place(1, cardByName('Machina Sniper'), 'mzone');
    const soldier = place(1, cardByName('Machina Soldier'), 'mzone');
    const wall = place(1, T.wall, 'mzone');
    const brute = place(0, T.brute, 'mzone');
    const t = g.attackTargets(brute);
    eq(t.targets.includes(sniper), true, 'Sniper can be attacked');
    eq(t.targets.includes(soldier), false, 'Soldier cannot be attacked');
    eq(t.targets.includes(wall), true, 'non-Machina can be attacked');
    eq(t.direct, false, 'no direct attack');
  });

  await test('SDMM: Machina Defender FLIP adds Commander Covington', async () => {
    const { g, place } = setup();
    const def = place(1, cardByName('Machina Defender'), 'mzone', { faceUp: false, pos: 'def' });
    const cov = place(1, cardByName('Commander Covington'), 'deck');
    await g.conductAttack(0, place(0, T.brute, 'mzone'));
    eq(def.location, 'mzone', 'Defender survives (1800 DEF)');
    eq(cov.location, 'hand', 'Covington added to the hand');
  });

  await test('SDMM: Machina Force — pay 1000 LP to attack; cannot attack at 1000 LP or less; revives the trio', async () => {
    const { g, place } = setup();
    const force = place(0, cardByName('Machina Force'), 'mzone');
    place(1, T.wall, 'mzone');
    eq(g.canAttack(force), true, 'can attack');
    await g.conductAttack(0, force);
    eq(g.players[0].lp, 7000, '1000 LP paid');
    force.attacksThisTurn = 0;
    g.players[0].lp = 1000;
    eq(g.canAttack(force), false, 'cannot pay 1000 LP');
    eq(g.canNormalSummon(0, place(0, cardByName('Machina Force'), 'hand'), false), false, 'cannot be Normal Summoned');

    const b = setup();
    const f2 = b.place(0, cardByName('Machina Force'), 'mzone');
    const trio = ['Machina Soldier', 'Machina Sniper', 'Machina Defender'].map((n) => b.place(0, cardByName(n), 'grave'));
    await activateCard(b.g, 0, f2);
    eq(f2.location, 'grave', 'Force sent to the GY');
    eq(trio.every((c) => c.location === 'mzone'), true, 'Soldier, Sniper and Defender Special Summoned');
  });

  await test('SDMM: Cipher Soldier gains 2000 ATK/DEF in damage calculation against a Warrior', async () => {
    const { g, place } = setup();
    const cipher = place(1, cardByName('Cipher Soldier'), 'mzone');
    const brute = place(0, T.brute, 'mzone');
    eq(g.getAtk(cipher), 1350, 'base ATK outside battle');
    await g.conductAttack(0, brute);
    eq(brute.location, 'grave', 'Warrior destroyed');
    eq(cipher.location, 'mzone', 'Cipher Soldier survives');
    eq(g.players[0].lp, 8000 - 1550, '3350 - 1800 damage');
  });

  await test('SDMM: Scrap Recycler sends a Machine to the GY on summon, then returns 2 Level 4 EARTH Machines to draw 1', async () => {
    const { g, place } = setup();
    const rec = place(0, cardByName('Scrap Recycler'), 'hand');
    const fort = place(0, cardByName('Machina Fortress'), 'deck');
    await g.performAction(0, { type: 'summon', card: rec });
    eq(fort.location, 'grave', 'Machine sent from the Deck to the GY');
    const a = place(0, cardByName('Machina Soldier'), 'grave');
    const b = place(0, cardByName('Machina Sniper'), 'grave');
    const hand = g.players[0].hand.length;
    await activateCard(g, 0, rec);
    eq(a.location === 'deck' && b.location === 'deck', true, 'both returned to the Deck');
    eq(g.players[0].hand.length, hand + 1, 'drew 1');
    eq(g.getActivations(0, { open: true }).some((x) => x.card === rec), false, 'once per turn');
  });

  await test('SDMM: Card Trader shuffles 1 card from the hand into the Deck and draws 1 in the Standby Phase', async () => {
    const { g, place } = setup();
    live(place(0, cardByName('Card Trader'), 'szone'));
    const junk = place(0, T.giant, 'hand');
    await (g as any).setPhase('standby');
    eq(junk.location, 'deck', 'card shuffled into the Deck');
    eq(g.players[0].hand.length, 1, 'drew 1');
  });

  await test('SDMM: Frontline Base Special Summons a Level 4 or lower Union monster from the hand once per turn', async () => {
    const { g, place } = setup();
    const base = live(place(0, cardByName('Frontline Base'), 'szone'));
    const pk = place(0, cardByName('Machina Peacekeeper'), 'hand');
    const pk2 = place(0, cardByName('Machina Peacekeeper'), 'hand');
    await activateCard(g, 0, base);
    eq(pk.location === 'mzone' || pk2.location === 'mzone', true, 'Union monster Special Summoned');
    eq(g.getActivations(0, { open: true }).some((x) => x.card === base), false, 'once per turn');
  });

  await test('SDMM: Machina Armored Unit Special Summons a weaker same-Attribute Machine when one is destroyed by battle', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    live(place(0, cardByName('Machina Armored Unit'), 'szone'));
    const sniper = place(0, cardByName('Machina Sniper'), 'mzone');
    const soldier = place(0, cardByName('Machina Soldier'), 'deck');
    await g.conductAttack(1, place(1, T.giant, 'mzone'));
    eq(sniper.location, 'grave', 'Sniper destroyed');
    eq(soldier.location, 'mzone', 'Soldier (1600 < 1800, EARTH) Special Summoned from the Deck');
  });

  await test('SDMM: The Big Saturn — not from the hand, +1000 ATK for a discard and 1000 LP, burns both players', async () => {
    const { g, place } = setup();
    const inHand = place(0, cardByName('The Big Saturn'), 'hand');
    eq((await g.specialSummon([inHand], 0, { pos: 'atk' })).length, 0, 'cannot be Special Summoned from the hand');
    const sat = place(0, cardByName('The Big Saturn'), 'mzone');
    await activateCard(g, 0, sat);
    eq(g.getAtk(sat), 3800, '+1000 ATK');
    eq(g.players[0].lp, 7000, 'paid 1000 LP');
    eq(inHand.location, 'grave', 'discarded');
    await g.destroy([sat], 'effect', 1);
    await g.processTriggers(true);
    eq(g.players[0].lp, 7000 - 2800, 'controller takes its GY ATK');
    eq(g.players[1].lp, 8000 - 2800, 'opponent takes its GY ATK');
  });

  await test('SDMM: Commander Covington sends the face-up Machina trio to the GY to Special Summon Machina Force from the Deck', async () => {
    const { g, place } = setup();
    const cov = place(0, cardByName('Commander Covington'), 'mzone');
    const trio = ['Machina Soldier', 'Machina Sniper', 'Machina Defender'].map((n) => place(0, cardByName(n), 'mzone'));
    const force = place(0, cardByName('Machina Force'), 'deck');
    await activateCard(g, 0, cov);
    eq(trio.every((c) => c.location === 'grave'), true, 'trio sent to the GY');
    eq(force.location, 'mzone', 'Machina Force Special Summoned');
    eq(force.properlySummoned, true, 'properly Summoned (can be revived later)');

    const b = setup();
    const cov2 = b.place(0, cardByName('Commander Covington'), 'mzone');
    b.place(0, cardByName('Machina Soldier'), 'mzone');
    b.place(0, cardByName('Machina Sniper'), 'mzone');
    b.place(0, cardByName('Machina Defender'), 'mzone', { faceUp: false, pos: 'def' });
    b.place(0, cardByName('Machina Force'), 'deck');
    eq(b.g.getActivations(0, { open: true }).some((x) => x.card === cov2), false, 'a face-down Defender does not count');
  });

  await test('SDMM: Heavy Mech Support Platform — Union equip +500 ATK/DEF, destroyed instead, unequip next turn', async () => {
    const { g, place } = setup();
    const host = place(0, cardByName('Machina Soldier'), 'mzone');
    const hm = place(0, cardByName('Heavy Mech Support Platform'), 'mzone');
    await activateCard(g, 0, hm);
    eq(hm.location, 'szone', 'equipped');
    eq(hm.equippedTo, host.uid, 'to the Machine');
    eq(g.getAtk(host), 2100, '1600 + 500 ATK');
    eq(g.getDef(host), 2000, '1500 + 500 DEF');
    eq(g.getActivations(0, { open: true }).some((x) => x.card === hm), false, 'once per turn');
    g.turn = 4;
    await activateCard(g, 0, hm);
    eq(hm.location, 'mzone', 'unequipped and Special Summoned');
    eq(hm.pos, 'atk', 'in Attack Position');
    eq(g.getAtk(host), 1600, 'boost gone');
    g.turn = 6;
    await activateCard(g, 0, hm);
    await g.destroy([host], 'effect', 1);
    eq(host.location, 'mzone', 'host survives an effect');
    eq(hm.location, 'grave', 'Heavy Mech Support Platform destroyed instead');
  });

  await test("SDMM: Blast Sphere equips to its attacker, then destroys it and burns in that player's next Standby Phase", async () => {
    const { g, place } = setup();
    const sphere = place(1, cardByName('Blast Sphere'), 'mzone', { faceUp: false, pos: 'def' });
    const brute = place(0, T.brute, 'mzone');
    await g.conductAttack(0, brute);
    eq(sphere.location, 'szone', 'Blast Sphere in the S/T zone');
    eq(sphere.equippedTo, brute.uid, 'equipped to the attacker');
    eq(brute.location, 'mzone', 'attacker still on the field');
    eq(g.players[0].lp + g.players[1].lp, 16000, 'no damage calculation');
    g.turn = 3;
    g.turnPlayer = 1;
    await (g as any).setPhase('standby');
    eq(brute.location, 'mzone', "nothing in the Blast Sphere controller's own Standby Phase");
    g.turn = 4;
    g.turnPlayer = 0;
    await (g as any).setPhase('standby');
    eq(brute.location, 'grave', 'attacker destroyed');
    eq(g.players[0].lp, 8000 - 1800, 'damage equal to its ATK');
    eq(sphere.location, 'grave', 'Blast Sphere goes to the GY');
  });

  await test('SDMM: Inferno Reckless Summon fills both fields with copies', async () => {
    const { g, place } = setup();
    place(1, T.brute, 'mzone');
    const theirs = place(1, T.brute, 'deck');
    const cipher = place(0, cardByName('Cipher Soldier'), 'hand');
    const c2 = place(0, cardByName('Cipher Soldier'), 'deck');
    const c3 = place(0, cardByName('Cipher Soldier'), 'grave');
    const irs = place(0, cardByName('Inferno Reckless Summon'), 'hand');
    await g.specialSummon([cipher], 0, { pos: 'atk' });
    await activateCard(g, 0, irs);
    eq(c2.location, 'mzone', 'copy from the Deck');
    eq(c3.location, 'mzone', 'copy from the GY');
    eq(c2.pos === 'atk' && c3.pos === 'atk', true, 'in Attack Position');
    eq(theirs.location, 'mzone', "the opponent's copy from their Deck");

    const b = setup();
    b.place(1, T.brute, 'mzone');
    const x = b.place(0, cardByName('Cipher Soldier'), 'hand');
    const y = b.place(0, cardByName('Cipher Soldier'), 'hand');
    b.place(0, cardByName('Cipher Soldier'), 'deck');
    const irs2 = b.place(0, cardByName('Inferno Reckless Summon'), 'hand');
    await b.g.specialSummon([x, y], 0, { pos: 'atk' });
    eq(b.g.getActivations(0, { open: true }).some((a) => a.card === irs2), false, 'not when 2 monsters are Special Summoned together');
  });

  await test("SDMM: Metalmorph — +300 ATK/DEF, and half the attack target's ATK when attacking", async () => {
    const { g, place } = setup();
    const brute = place(0, T.brute, 'mzone');
    const mm = place(0, cardByName('Metalmorph'), 'szone', { faceUp: false });
    await activateCard(g, 0, mm);
    eq(mm.location, 'szone', 'stays on the field as an equip');
    eq(mm.equippedTo, brute.uid, 'equipped');
    eq(g.getAtk(brute), 2100, '1800 + 300 ATK');
    eq(g.getDef(brute), 1300, '1000 + 300 DEF');
    const shade = place(1, T.dark, 'mzone');
    await g.conductAttack(0, brute);
    eq(shade.location, 'grave', 'attack target destroyed');
    eq(g.players[1].lp, 8000 - (2100 + 800 - 1600), '2900 ATK in damage calculation');
    eq(g.getAtk(brute), 2100, 'bonus only during damage calculation');
  });

  await test('SDMM: Rare Metalmorph — +500 ATK, negates the first Spell that targets the Machine, destroyed when it leaves', async () => {
    const { g, c0, place } = setup();
    const soldier = place(1, cardByName('Machina Soldier'), 'mzone');
    const rm = place(1, cardByName('Rare Metalmorph'), 'szone', { faceUp: false });
    await activateCard(g, 1, rm);
    eq(g.getAtk(soldier), 2100, '1600 + 500 ATK');
    c0.pick = (_g, req) => (req.candidates.includes(soldier) ? [soldier] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, place(0, cardByName('Book of Moon'), 'hand'));
    eq(soldier.faceUp, true, 'first Book of Moon negated');
    await activateCard(g, 0, place(0, cardByName('Book of Moon'), 'hand'));
    eq(soldier.faceUp, false, 'second Book of Moon resolves');
    await g.destroy([soldier], 'effect', 0);
    eq(rm.location, 'grave', 'Rare Metalmorph destroyed when the monster leaves the field');
  });

  await test('SDMM: Roll Out! equips a Union monster from the GY to an appropriate monster', async () => {
    const { g, place } = setup();
    const host = place(0, cardByName('Machina Soldier'), 'mzone');
    const pk = place(0, cardByName('Machina Peacekeeper'), 'grave');
    const ro = place(0, cardByName('Roll Out!'), 'szone', { faceUp: false });
    await activateCard(g, 0, ro);
    eq(pk.location, 'szone', 'Peacekeeper in the S/T zone');
    eq(pk.equippedTo, host.uid, 'equipped to the Machine');
    g.turnPlayer = 1;
    await g.conductAttack(1, place(1, T.giant, 'mzone'));
    eq(host.location, 'mzone', 'host survives the battle');
    eq(pk.location, 'grave', 'the Union is destroyed instead');
  });
}

// ---------------------------------------------------------------- Gemini monsters count as Normal Monsters

async function geminiTests() {
  await test('Gemini: Normal Monster in the GY and face-up on the field until Gemini Summoned; Effect Monster in hand and once Gemini Summoned', async () => {
    const { place } = setup();
    const inHand = place(0, cardByName('Elemental Hero Neos Alius'), 'hand');
    eq(inHand.hasType('normal'), false, 'not Normal in the hand');
    eq(inHand.hasType('effect') || !inHand.hasType('normal'), true, 'hand: not treated as Normal');
    const inGy = place(0, cardByName('Elemental Hero Neos Alius'), 'grave');
    eq(inGy.hasType('normal'), true, 'Normal in the GY');
    eq(inGy.hasType('effect'), false, 'not an Effect Monster in the GY');
    const onField = place(0, cardByName('Elemental Hero Neos Alius'), 'mzone');
    onField.faceUp = true;
    eq(onField.hasType('normal'), true, 'Normal face-up on the field');
    onField.flags.geminiSummoned = true;
    eq(onField.hasType('normal'), false, 'not Normal once Gemini Summoned');
  });

  await test('Hero Blast can add Neos Alius from the GY (a Gemini is a Normal Monster there)', async () => {
    const { g, place } = setup();
    const alius = place(0, cardByName('Elemental Hero Neos Alius'), 'grave');
    const blast = place(0, cardByName('Hero Blast'), 'szone');
    const weak = place(1, T.wall, 'mzone');
    weak.faceUp = true;
    await activateCard(g, 0, blast);
    eq(alius.location, 'hand', 'Neos Alius added to the hand');
  });
}

// ---------------------------------------------------------------- Location-dependent Type / name / kind / status (rules audit)

async function locationRulesTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);

  // 1. Zombie World
  await test('Zombie World: monsters on the field and in the GY are Zombie-Type, monsters in the hand are not', async () => {
    const { g, place } = setup();
    const onField = place(0, T.brute, 'mzone');
    const inGy = place(1, T.brute, 'grave');
    const inHand = place(0, T.brute, 'hand');
    const zw = live(place(0, cardByName('Zombie World'), 'fzone'));
    eq(onField.data.race, 'Zombie', 'field');
    eq(inGy.data.race, 'Zombie', 'GY');
    eq(inHand.data.race, 'Warrior', 'hand');
    await g.sendToGrave([zw], 'effect');
    eq(onField.data.race, 'Warrior', 'field after Zombie World left');
    eq(inGy.data.race, 'Warrior', 'GY after Zombie World left');
  });

  await test('Zombie World: Doomkaiser Dragon can use a non-Zombie as material; Book of Life can revive a non-Zombie', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Plaguespreader Zombie'), 'mzone');
    place(0, T.brute, 'mzone');
    const dk = place(0, cardByName('Doomkaiser Dragon'), 'extra');
    eq(g.canSynchro(0, dk), false, 'no Zombie World: Warrior is not a Zombie');
    live(place(0, cardByName('Zombie World'), 'fzone'));
    eq(g.canSynchro(0, dk), true, 'Zombie World: the Warrior is a Zombie');
    const mine = place(0, T.giant, 'grave');
    const theirs = place(1, T.wall, 'grave');
    c0.pick = (_g, req) => (req.candidates.includes(mine) ? [mine] : req.candidates.includes(theirs) ? [theirs] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, place(0, cardByName('Book of Life'), 'hand'));
    eq(mine.location, 'mzone', 'Book of Life revived the (Zombie World) Zombie');
    eq(theirs.location, 'banished', 'and banished the other target');
  });

  await test('Zombie World + Necrovalley: the Type change does not apply in the GY, still on the field', async () => {
    const { place } = setup();
    const onField = place(0, T.brute, 'mzone');
    const inGy = place(0, T.brute, 'grave');
    live(place(0, cardByName('Zombie World'), 'fzone'));
    live(place(1, cardByName('Necrovalley'), 'fzone'));
    eq(onField.data.race, 'Zombie', 'field');
    eq(inGy.data.race, 'Warrior', 'GY: negated by Necrovalley');
  });

  // 2. "name becomes" cards
  await test('Proto-Cyber Dragon: "Cyber Dragon" only while face-up on the field (also when placed without a Summon event)', async () => {
    const { g, place } = setup();
    const up = place(0, cardByName('Proto-Cyber Dragon'), 'mzone');
    eq(up.name, 'Cyber Dragon', 'face-up on the field');
    const down = place(0, cardByName('Proto-Cyber Dragon'), 'mzone', { faceUp: false, pos: 'def' });
    eq(down.name, 'Proto-Cyber Dragon', 'face-down');
    const inHand = place(0, cardByName('Proto-Cyber Dragon'), 'hand');
    eq(inHand.name, 'Proto-Cyber Dragon', 'hand');
    const cfd = place(0, cardByName('Chimeratech Fortress Dragon'), 'extra');
    place(0, cardByName('Cyber Valley'), 'mzone');
    eq(g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === cfd), true, 'Chimeratech Fortress Dragon can use Proto-Cyber Dragon as "Cyber Dragon"');
    await g.sendToGrave([up], 'effect');
    eq(up.name, 'Proto-Cyber Dragon', 'GY');
  });

  await test("Elemental Hero Prisma: takes the sent monster's name (and archetype) while face-up on the field this turn", async () => {
    const { g, place } = setup();
    const prisma = place(0, cardByName('Elemental Hero Prisma'), 'mzone');
    place(0, cardByName('Elemental Hero Flame Wingman'), 'extra');
    const avian = deckCard(g, 0, 'Elemental Hero Avian');
    await activateCard(g, 0, prisma);
    eq(avian.location, 'grave', 'Avian sent');
    eq(prisma.name, avian.name, 'name copied');
    eq(prisma.data.name, avian.name, 'data name copied too');
    await g.changePosition(prisma, 'def', false);
    eq(prisma.name, 'Elemental Hero Prisma', 'own name while face-down');
    await g.changePosition(prisma, 'atk', true);
    eq(prisma.name, avian.name, 'face-up again, same turn');
    g.turn++;
    eq(prisma.name, 'Elemental Hero Prisma', 'own name after the turn');
  });

  // 3. Union monsters while equipped
  await test('Union: an equipped Union is a Spell/Trap on the field (MST, Heavy Storm, Giant Trunade) and a monster again in the GY', async () => {
    const mk = () => {
      const s = setup();
      const host = s.place(0, cardByName('Machina Fortress'), 'mzone');
      const gear = s.place(0, cardByName('Machina Gearframe'), 'mzone');
      return { ...s, host, gear };
    };
    const s = mk();
    await activateCard(s.g, 0, s.gear, 'Equip to a Machine monster');
    eq(s.gear.location, 'szone', 'equipped');
    s.c1.pick = (_g, req) => (req.candidates.includes(s.gear) ? [s.gear] : req.candidates.slice(0, req.min));
    s.g.turnPlayer = 1;
    await activateCard(s.g, 1, s.place(1, cardByName('Mystical Space Typhoon'), 'hand'));
    eq(s.gear.location, 'grave', 'MST destroyed the equipped Union');
    eq(s.gear.isMonster, true, 'a monster in the GY');
    eq(s.host.location, 'mzone', 'host untouched');
    const s2 = mk();
    await activateCard(s2.g, 0, s2.gear, 'Equip to a Machine monster');
    s2.g.turnPlayer = 1;
    await activateCard(s2.g, 1, s2.place(1, cardByName('Giant Trunade'), 'hand'));
    eq(s2.gear.location, 'hand', 'Giant Trunade returned the equipped Union');
    const s3 = mk();
    await activateCard(s3.g, 0, s3.gear, 'Equip to a Machine monster');
    s3.g.turnPlayer = 1;
    await activateCard(s3.g, 1, s3.place(1, cardByName('Heavy Storm'), 'hand'));
    eq(s3.gear.location, 'grave', 'Heavy Storm destroyed it');
  });

  await test('Union: if the equipped monster would be destroyed by a card effect, the Union is destroyed instead', async () => {
    const { g, place } = setup();
    const host = place(0, cardByName('Machina Fortress'), 'mzone');
    const gear = place(0, cardByName('Machina Gearframe'), 'mzone');
    await activateCard(g, 0, gear, 'Equip to a Machine monster');
    await g.destroy([host], 'effect', 1);
    eq(host.location, 'mzone', 'host survives');
    eq(gear.location, 'grave', 'Union destroyed instead');
  });

  // 4. Judgment Dragon / Lightsworn names
  await test('Judgment Dragon needs 4 differently named "Lightsworn" monsters; Judgment Dragon, duplicates and Lightsworn Spells do not count', async () => {
    const { g, place } = setup();
    const jd = place(0, cardByName('Judgment Dragon'), 'hand');
    place(0, cardByName('Ryko, Lightsworn Hunter'), 'grave');
    place(0, cardByName('Ryko, Lightsworn Hunter'), 'grave');
    place(0, cardByName('Lumina, Lightsworn Summoner'), 'grave');
    place(0, cardByName('Wulf, Lightsworn Beast'), 'grave');
    place(0, cardByName('Judgment Dragon'), 'grave');
    place(0, cardByName('Solar Recharge'), 'grave');
    place(0, cardByName('Charge of the Light Brigade'), 'grave');
    const can = () => g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === jd);
    eq(can(), false, '3 names only');
    place(1, cardByName('Garoth, Lightsworn Warrior'), 'grave');
    eq(can(), false, "a Lightsworn in the opponent's GY does not count");
    place(0, cardByName('Garoth, Lightsworn Warrior'), 'grave');
    eq(can(), true, '4 names');
  });

  // 5. Necrovalley
  await test("Necrovalley: Gravekeeper's Stele is not negated", async () => {
    const { g, place } = setup();
    live(place(0, cardByName('Necrovalley'), 'fzone'));
    const a = place(0, cardByName("Gravekeeper's Spy"), 'grave');
    const b = place(0, cardByName("Gravekeeper's Guard"), 'grave');
    await activateCard(g, 0, place(0, cardByName("Gravekeeper's Stele"), 'hand'));
    eq(a.location, 'hand', 'Spy added');
    eq(b.location, 'hand', 'Guard added');
  });

  await test('Necrovalley: non-targeting effects that move cards out of the GY are negated (Rekindling); cards in the GY cannot be banished (Kycoo)', async () => {
    const { g, place } = setup();
    live(place(1, cardByName('Necrovalley'), 'fzone'));
    const fire = place(0, cardByName('Flamvell Firedog'), 'grave');
    await activateCard(g, 0, place(0, cardByName('Rekindling'), 'hand'));
    eq(fire.location, 'grave', 'Rekindling cannot take it out of the GY');
    const k = setup();
    live(k.place(1, cardByName('Necrovalley'), 'fzone'));
    const kycoo = k.place(0, cardByName('Kycoo the Ghost Destroyer'), 'mzone');
    const dead = k.place(1, T.brute, 'grave');
    await k.g.conductAttack(0, kycoo);
    eq(dead.location, 'grave', 'Kycoo cannot banish from the GY');
  });

  await test("Gravekeeper's Priestess: with no face-up Field Spell the field is Necrovalley (GY lock included)", async () => {
    const { g, place } = setup();
    place(1, cardByName("Gravekeeper's Priestess"), 'mzone');
    const dad = place(0, cardByName('Dark Armed Dragon'), 'mzone');
    for (let i = 0; i < 3; i++) place(0, T.dark, 'grave');
    place(1, T.brute, 'mzone');
    eq(offered(g, 0, dad), false, 'DAD cost cannot be paid under the Priestess');
    const dead = place(0, T.brute, 'grave');
    await activateCard(g, 0, place(0, cardByName('Monster Reborn'), 'hand'));
    eq(dead.location, 'grave', 'Monster Reborn negated');
    live(place(0, cardByName('Zombie World'), 'fzone'));
    eq(offered(g, 0, dad), true, 'a face-up Field Spell turns the Priestess Necrovalley off');
  });

  await test('Kycoo the Ghost Destroyer: its opponent cannot banish cards from either GY', async () => {
    const { g, place } = setup();
    place(1, cardByName('Kycoo the Ghost Destroyer'), 'mzone');
    const dad = place(0, cardByName('Dark Armed Dragon'), 'mzone');
    for (let i = 0; i < 3; i++) place(0, T.dark, 'grave');
    place(1, T.brute, 'mzone');
    eq(offered(g, 0, dad), false, "Kycoo's opponent cannot banish from the GY");
    const mine = setup();
    mine.place(0, cardByName('Kycoo the Ghost Destroyer'), 'mzone');
    const dad2 = mine.place(0, cardByName('Dark Armed Dragon'), 'mzone');
    for (let i = 0; i < 3; i++) mine.place(0, T.dark, 'grave');
    mine.place(1, T.brute, 'mzone');
    eq(offered(mine.g, 0, dad2), true, "Kycoo's controller still can");
  });

  // 6. Macro Cosmos: banished instead of sent to the GY
  await test('Macro Cosmos: no "sent to the GY" effects (Card Trooper, Sangan, Wulf)', async () => {
    const { g, place } = setup();
    live(place(1, cardByName('Macro Cosmos'), 'szone'));
    const trooper = place(0, cardByName('Card Trooper'), 'mzone');
    const sangan = place(0, cardByName('Sangan'), 'mzone');
    const hand = g.players[0].hand.length;
    await g.destroy([trooper, sangan], 'effect', 1);
    eq(trooper.location, 'banished', 'Card Trooper banished');
    eq(sangan.location, 'banished', 'Sangan banished');
    await g.processTriggers(true);
    eq(g.players[0].hand.length, hand, 'no draw, no search');
    const wulf = deckCard(g, 0, 'Wulf, Lightsworn Beast');
    await g.mill(0, 1);
    await g.processTriggers(true);
    eq(wulf.location, 'banished', 'Wulf banished, not Special Summoned');
  });

  // 7. Hand effects timing
  await test('Gorz: only while you control no cards', async () => {
    const mk = (withCard: boolean) => {
      const s = setup();
      s.g.turnPlayer = 1;
      const gorz = s.place(0, cardByName('Gorz the Emissary of Darkness'), 'hand');
      if (withCard) s.place(0, cardByName('Mirror Force'), 'szone', { faceUp: false });
      s.c0.respond = (_g, req) => req.options.find((x) => x.card === gorz) ?? null;
      return { ...s, gorz };
    };
    const a = mk(false);
    await a.g.conductAttack(1, a.place(1, T.brute, 'mzone'));
    await a.g.processTriggers(true);
    eq(a.gorz.location, 'mzone', 'Gorz Special Summoned with an empty field');
    const b = mk(true);
    await b.g.conductAttack(1, b.place(1, T.brute, 'mzone'));
    await b.g.processTriggers(true);
    eq(b.gorz.location, 'hand', 'not while controlling a Set card');
  });

  await test('Tragoedia: battle damage only; Battle Fader: direct attacks only', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const tr = place(0, cardByName('Tragoedia'), 'hand');
    await g.damage(0, 500, 'effect', undefined, 1);
    await g.processTriggers(true);
    eq(tr.location, 'hand', 'no Tragoedia on effect damage');
    const b = setup();
    b.g.turnPlayer = 1;
    const bf = b.place(0, cardByName('Battle Fader'), 'hand');
    b.c0.respond = (_g, req) => req.options.find((x) => x.card === bf) ?? null;
    b.place(0, T.wall, 'mzone', { pos: 'def' });
    await b.g.conductAttack(1, b.place(1, T.brute, 'mzone'));
    eq(bf.location, 'hand', 'no Battle Fader when a monster is attacked');
  });

  await test("D.D. Crow: needs a card in the opponent's GY; under Necrovalley the banish is negated (Crow still discarded)", async () => {
    const { g, place } = setup();
    const crow = place(0, cardByName('D.D. Crow'), 'hand');
    eq(offered(g, 0, crow), false, "nothing in the opponent's GY");
    place(0, T.brute, 'grave');
    eq(offered(g, 0, crow), false, 'a card in your own GY is not enough');
    const dead = place(1, T.brute, 'grave');
    eq(offered(g, 0, crow), true, "a card in the opponent's GY");
    live(place(1, cardByName('Necrovalley'), 'fzone'));
    await activateCard(g, 0, crow);
    eq(crow.location, 'grave', 'Crow discarded as the cost');
    eq(dead.location, 'grave', 'target not banished');
  });

  await test('Honest: from the hand in the Damage Step, only for a LIGHT monster you control that battles', async () => {
    const run = (attackerData: CardData) => {
      const s = setup();
      const honest = s.place(0, cardByName('Honest'), 'hand');
      let seen = false;
      s.c0.respond = (_g, req) => {
        const o = req.options.find((x) => x.card === honest);
        if (o) seen = true;
        return o ?? null;
      };
      const a = s.place(0, attackerData, 'mzone');
      const d = s.place(1, T.brute, 'mzone');
      return { ...s, honest, a, d, seen: () => seen };
    };
    const light = run(cardByName('Proto-Cyber Dragon'));
    await light.g.conductAttack(0, light.a);
    eq(light.seen(), true, 'offered for a LIGHT monster');
    eq(light.honest.location, 'grave', 'Honest sent');
    eq(light.d.location, 'grave', 'boosted LIGHT monster wins the battle');
    const dark = run(T.dark);
    await dark.g.conductAttack(0, dark.a);
    eq(dark.seen(), false, 'not offered for a DARK monster');
  });

  // 8. Discarded / sent / milled
  await test('Wulf: Special Summons itself only when sent from the Deck to the GY, not from the hand or the field', async () => {
    const { g, place } = setup();
    const w1 = place(0, cardByName('Wulf, Lightsworn Beast'), 'hand');
    await g.discard([w1], 'cost', 0);
    await g.processTriggers(true);
    eq(w1.location, 'grave', 'discarded Wulf stays in the GY');
    const w2 = place(0, cardByName('Wulf, Lightsworn Beast'), 'mzone');
    await g.destroy([w2], 'effect', 1);
    await g.processTriggers(true);
    eq(w2.location, 'grave', 'destroyed Wulf stays in the GY');
    const w3 = deckCard(g, 0, 'Wulf, Lightsworn Beast');
    await g.mill(0, 1);
    await g.processTriggers(true);
    eq(w3.location, 'mzone', 'milled Wulf Special Summoned');
  });

  // 9. Gladiator Beasts
  await test('Gladiator Beast Laquari: the boost needs a Gladiator Beast effect; Monster Reborn does not give it', async () => {
    const { g, c0, place } = setup();
    const laq = place(0, cardByName('Gladiator Beast Laquari'), 'grave');
    c0.pick = (_g, req) => (req.candidates.includes(laq) ? [laq] : req.candidates.slice(0, req.min));
    await activateCard(g, 0, place(0, cardByName('Monster Reborn'), 'hand'));
    eq(laq.location, 'mzone', 'revived');
    eq(g.getAtk(laq), 1800, 'no boost from Monster Reborn');
    const t = setup();
    const laq2 = deckCard(t.g, 0, 'Gladiator Beast Laquari');
    const best = t.place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    best.attackedThisTurnOrWasAttacked = true;
    t.g.beginBatch();
    t.g.emit({ type: 'battleEnd', player: 0, phase: 'battle' } as any);
    await t.g.processTriggers(true);
    eq(laq2.location, 'mzone', 'tagged in');
    eq(t.g.getAtk(laq2), 2100, 'boosted by the tag-out');
  });

  // 10. Extra Deck monsters never go to the hand / Deck
  await test('Synchro/Fusion monsters returned to the hand or Deck go to the Extra Deck', async () => {
    const { g, place } = setup();
    const sd = place(0, cardByName('Stardust Dragon'), 'mzone');
    const cfd = place(0, cardByName('Chimeratech Fortress Dragon'), 'mzone');
    await g.toHand([sd], 'effect', 1);
    await g.toDeck([cfd], 'effect', 'shuffle', 1);
    eq(sd.location, 'extra', 'Stardust Dragon to the Extra Deck');
    eq(cfd.location, 'extra', 'Chimeratech to the Extra Deck');
  });
}

// ---------------------------------------------------------------- Extra Deck rules (rules audit, items 11-14) + GY costs under Necrovalley

async function extraDeckTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const doProc = async (g: Game, p: PlayerId, card: CardInstance) => {
    const a = g.legalMainActions(p).find((x) => x.type === 'proc' && x.card === card);
    if (!a) throw new Error(`${card.name}: no Summon procedure offered`);
    await g.performAction(p, a);
  };
  const lv2 = findCard('Rules Test Lv2') ?? normal('Rules Test Lv2', 'EARTH', 'Warrior', 2, 400, 400);
  const lv3 = findCard('Rules Test Lv3') ?? normal('Rules Test Lv3', 'EARTH', 'Warrior', 3, 1200, 1000);
  /** Pick only from `want` when the request allows it. */
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };

  // 11. Proper Summon / Extra Deck returns
  await test('Extra Deck: a Synchro not properly Summoned cannot be revived; a properly Synchro Summoned one can', async () => {
    const { g, place } = setup();
    place(0, cardByName('Stardust Dragon'), 'grave');
    const reborn = place(0, cardByName('Monster Reborn'), 'hand');
    eq(offered(g, 0, reborn), false, 'Monster Reborn has no legal target');
    const call = place(0, cardByName('Call of the Haunted'), 'szone', { faceUp: false });
    eq(offered(g, 0, call), false, 'nor Call of the Haunted');
    const t = place(0, tuner, 'mzone');
    const n = place(0, lv2, 'mzone');
    n.flags.baseLevel = 6;
    const sd = place(0, cardByName('Stardust Dragon'), 'extra');
    await g.synchroSummon(0, sd, [t, n]);
    eq(sd.location, 'mzone', 'Synchro Summoned');
    await g.destroy([sd], 'effect', 1);
    eq(sd.properlySummoned, true, 'still marked properly Summoned in the GY');
    eq(offered(g, 0, reborn), true, 'Monster Reborn can target it now');
  });

  await test('Extra Deck: bounced Synchro/Fusion monsters go to the Extra Deck (Compulsory Evacuation Device, Phoenix Wing Wind Blast); Book of Moon keeps them on the field', async () => {
    const { g, c0, place } = setup();
    const sd = place(1, cardByName('Stardust Dragon'), 'mzone');
    pickOnly(c0, [sd]);
    await activateCard(g, 0, place(0, cardByName('Compulsory Evacuation Device'), 'szone', { faceUp: false }));
    eq(sd.location, 'extra', 'Compulsory: Stardust to the Extra Deck');
    const p = setup();
    const gy = p.place(1, cardByName('Gladiator Beast Gyzarus'), 'mzone');
    p.place(0, T.wall, 'hand');
    p.c0.pick = (_g, req) => (req.candidates.includes(gy) ? [gy] : req.candidates.slice(0, req.min));
    await activateCard(p.g, 0, p.place(0, cardByName('Phoenix Wing Wind Blast'), 'szone', { faceUp: false }));
    eq(gy.location, 'extra', 'Phoenix Wing: Gyzarus to the Extra Deck, not the top of the Deck');
    const b = setup();
    const goyo = b.place(1, cardByName('Goyo Guardian'), 'mzone');
    pickOnly(b.c0, [goyo]);
    await activateCard(b.g, 0, b.place(0, cardByName('Book of Moon'), 'hand'));
    eq(goyo.location, 'mzone', 'Book of Moon: stays on the field');
    eq(goyo.faceUp, false, 'face-down');
  });

  // 12. Synchro Material restrictions
  await test('Synchro: Plaguespreader Zombie revived by its effect is banished when used as Synchro Material', async () => {
    const { g, place } = setup();
    const ps = place(0, cardByName('Plaguespreader Zombie'), 'grave');
    place(0, T.wall, 'hand');
    g.phase = 'standby';
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'standby', player: 0 } as any);
    await g.processTriggers(true);
    eq(ps.location, 'mzone', 'revived');
    g.phase = 'main1';
    const a = place(0, lv3, 'mzone');
    const b = place(0, lv2, 'mzone');
    const brd = place(0, cardByName('Black Rose Dragon'), 'extra');
    await g.synchroSummon(0, brd, [ps, a, b]);
    eq(brd.location, 'mzone', 'Black Rose Dragon Synchro Summoned (2 + 3 + 2)');
    eq(ps.location, 'banished', 'Plaguespreader banished, not sent to the GY');
    eq(a.location, 'grave', 'other material in the GY');
  });

  await test('Synchro: Debris Dragon — Dragon Synchros only, no Level 4 partners; its revived monster has its effects negated', async () => {
    const { g, place } = setup();
    place(0, cardByName('Debris Dragon'), 'mzone');
    place(0, lv3, 'mzone');
    eq(g.canSynchro(0, place(0, cardByName('Black Rose Dragon'), 'extra')), true, 'Debris + Level 3 → Black Rose Dragon (Dragon)');
    const b = setup();
    b.place(0, cardByName('Debris Dragon'), 'mzone');
    b.place(0, lv2, 'mzone');
    eq(b.g.canSynchro(0, b.place(0, cardByName('Brionac, Dragon of the Ice Barrier'), 'extra')), false, 'not for a non-Dragon (Brionac)');
    const c = setup();
    c.place(0, cardByName('Debris Dragon'), 'mzone');
    c.place(0, T.brute, 'mzone');
    eq(c.g.canSynchro(0, c.place(0, cardByName('Stardust Dragon'), 'extra')), false, 'not with a Level 4 monster');
    const d = setup();
    const dandy = d.place(0, cardByName('Dandylion'), 'grave');
    const debris = d.place(0, cardByName('Debris Dragon'), 'hand');
    await d.g.performAction(0, { type: 'summon', card: debris });
    await d.g.processTriggers(true);
    eq(dandy.location, 'mzone', 'Dandylion revived');
    eq(d.g.isNegated(dandy), true, 'its effects are negated');
  });

  await test('Synchro: Quickdraw Synchron only for monsters that list a "Synchron" Tuner; Fluff Tokens can be Synchro Material', async () => {
    const { g, place } = setup();
    place(0, cardByName('Quickdraw Synchron'), 'mzone');
    place(0, lv2, 'mzone');
    eq(g.canSynchro(0, place(0, cardByName('Nitro Warrior'), 'extra')), true, 'Quickdraw + Level 2 → Nitro Warrior');
    const b = setup();
    b.place(0, cardByName('Quickdraw Synchron'), 'mzone');
    b.place(0, lv3, 'mzone');
    eq(b.g.canSynchro(0, b.place(0, cardByName('Stardust Dragon'), 'extra')), false, 'not for Stardust Dragon');
    const c = setup();
    c.place(0, tuner, 'mzone');
    c.place(0, T.brute, 'mzone');
    const dandy = c.place(0, cardByName('Dandylion'), 'hand');
    await c.g.discard([dandy], 'cost', 0);
    await c.g.processTriggers(true);
    const toks = c.g.monsters(0).filter((m) => m.isToken);
    eq(toks.length, 2, 'Dandylion made 2 Fluff Tokens');
    const brd = c.place(0, cardByName('Black Rose Dragon'), 'extra');
    eq(c.g.synchroCombos(0, brd).some((m) => m.includes(toks[0])), true, 'Fluff Token usable (2 + 4 + 1)');
  });

  await test('Synchro: Tuned Magician is a Tuner only once Gemini Summoned; Synchros use the current Level', async () => {
    const { g, place } = setup();
    const tm = place(0, cardByName('Tuned Magician'), 'mzone');
    place(0, T.brute, 'mzone');
    const sd = place(0, cardByName('Stardust Dragon'), 'extra');
    eq(g.canSynchro(0, sd), false, 'not a Tuner before the Gemini Summon');
    eq(tm.hasType('tuner'), false, 'no Tuner type yet');
    await activateCard(g, 0, tm, 'Gemini Summon (Normal Summon again)');
    eq(tm.isTuner, true, 'Tuner once Gemini Summoned');
    eq(g.canSynchro(0, sd), true, 'usable as the Tuner (4 + 4)');
    const sk = place(1, cardByName('Skill Drain'), 'szone', { faceUp: true });
    sk.activeOnField = true;
    eq(tm.isTuner, false, 'not a Tuner while its effects are negated (Skill Drain)');
    const b = setup();
    b.place(0, tuner, 'mzone');
    const big = b.place(0, T.giant, 'mzone');
    const sd2 = b.place(0, cardByName('Stardust Dragon'), 'extra');
    eq(b.g.canSynchro(0, sd2), false, '2 + 8 is not 8');
    b.g.addTempMod(big, 'level', -2, 'field');
    eq(b.g.canSynchro(0, sd2), true, '2 + (8 - 2) = 8');
  });

  // 13. Extra Deck monsters' effects
  await test('Stardust Dragon: Tributes itself to negate a destroying card, then returns from the GY in the End Phase', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const sd = place(0, cardByName('Stardust Dragon'), 'mzone');
    sd.properlySummoned = true;
    c0.respond = respondWith('Stardust Dragon');
    const hole = place(1, cardByName('Dark Hole'), 'hand');
    await activateCard(g, 1, hole);
    eq(hole.location, 'grave', 'Dark Hole negated and destroyed');
    eq(sd.location, 'grave', 'Stardust Tributed');
    g.phase = 'end';
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'end', player: 1 } as any);
    await g.processTriggers(true);
    eq(sd.location, 'mzone', 'back in the End Phase');
  });

  await test('Goyo Guardian takes the destroyed monster in face-up Defense Position; Colossal Fighter counts Warriors in both GYs and revives one', async () => {
    const { g, place } = setup();
    const goyo = place(0, cardByName('Goyo Guardian'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await g.conductAttack(0, goyo);
    await g.processTriggers(true);
    eq(v.location, 'mzone', 'stolen');
    eq(v.controller, 0, 'on your side');
    eq(v.pos, 'def', 'in Defense Position');
    eq(v.faceUp, true, 'face-up');
    const b = setup();
    const cf = b.place(0, cardByName('Colossal Fighter'), 'mzone');
    b.place(0, T.brute, 'grave');
    const theirs = b.place(1, T.brute, 'grave');
    b.place(1, T.wall, 'grave');
    eq(b.g.getAtk(cf), 2800 + 200, '+100 per Warrior in either GY');
    b.g.turnPlayer = 1;
    b.c0.pick = (_g, req) => (req.candidates.includes(theirs) ? [theirs] : req.candidates.slice(0, req.min));
    const big = b.place(1, T.giant, 'mzone');
    big.flags.baseAtk = 5000;
    await b.g.conductAttack(1, big);
    await b.g.processTriggers(true);
    eq(cf.location, 'grave', 'Colossal destroyed by battle');
    eq(theirs.location, 'mzone', "revived a Warrior from the opponent's GY");
  });

  await test('Contact Fusions: Gyzarus shuffles its materials into the Deck; Chimeratech sends "Cyber Dragon" (Proto-Cyber) + Machines from either field to the GY', async () => {
    const { g, place } = setup();
    const b = place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    const l = place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
    const gy = place(0, cardByName('Gladiator Beast Gyzarus'), 'extra');
    await doProc(g, 0, gy);
    eq(gy.location, 'mzone', 'Gyzarus summoned');
    eq(b.location, 'deck', 'Bestiari shuffled into the Deck');
    eq(l.location, 'deck', 'Laquari shuffled into the Deck');
    const c = setup();
    const proto = c.place(0, cardByName('Proto-Cyber Dragon'), 'mzone');
    const oppMachine = c.place(1, cardByName('Cyber Valley'), 'mzone');
    const cfd = c.place(0, cardByName('Chimeratech Fortress Dragon'), 'extra');
    pickOnly(c.c0, [proto, oppMachine]);
    await doProc(c.g, 0, cfd);
    eq(cfd.location, 'mzone', 'Chimeratech summoned');
    eq(proto.location, 'grave', 'Proto-Cyber Dragon sent to the GY');
    eq(oppMachine.location, 'grave', "the opponent's Machine sent to the GY");
    eq(c.g.getAtk(cfd), 2000, '1000 x 2 materials');
  });

  await test('Miracle Fusion banishes materials from the field and GY; under Necrovalley GY materials cannot be used', async () => {
    const n = setup();
    n.place(0, cardByName('Elemental Hero Avian'), 'mzone');
    n.place(0, cardByName('Elemental Hero Burstinatrix'), 'grave');
    n.place(0, cardByName('Elemental Hero Flame Wingman'), 'extra');
    live(n.place(1, cardByName('Necrovalley'), 'fzone'));
    eq(offered(n.g, 0, n.place(0, cardByName('Miracle Fusion'), 'hand')), false, 'Necrovalley: GY material unusable');
    const { g, place } = setup();
    const avian = place(0, cardByName('Elemental Hero Avian'), 'mzone');
    const burst = place(0, cardByName('Elemental Hero Burstinatrix'), 'grave');
    const fw = place(0, cardByName('Elemental Hero Flame Wingman'), 'extra');
    await activateCard(g, 0, place(0, cardByName('Miracle Fusion'), 'hand'));
    eq(fw.location, 'mzone', 'Flame Wingman summoned');
    eq(avian.location, 'banished', 'field material banished');
    eq(burst.location, 'banished', 'GY material banished');
  });

  await test('Polymerization: Prisma named "Elemental Hero Avian" is that Fusion Material', async () => {
    const { g, place } = setup();
    const prisma = place(0, cardByName('Elemental Hero Prisma'), 'mzone');
    const fw = place(0, cardByName('Elemental Hero Flame Wingman'), 'extra');
    deckCard(g, 0, 'Elemental Hero Avian');
    await activateCard(g, 0, prisma);
    const burst = place(0, cardByName('Elemental Hero Burstinatrix'), 'hand');
    await activateCard(g, 0, place(0, cardByName('Polymerization'), 'hand'));
    eq(fw.location, 'mzone', 'Flame Wingman Fusion Summoned');
    eq(prisma.location, 'grave', 'Prisma used as Avian');
    eq(burst.location, 'grave', 'Burstinatrix used');
  });

  // 14. Extra Deck visibility and size
  await test('Extra Deck: hidden from the opponent; more than 15 cards is an invalid deck', async () => {
    const { g, place } = setup();
    const sd = place(0, cardByName('Stardust Dragon'), 'extra');
    eq(g.isPublic(sd, 0), true, 'owner sees it');
    eq(g.isPublic(sd, 1), false, 'opponent does not');
    const deck = PREMADE_DECKS[0];
    const extra: [string, number][] = [...deck.extra, ['Stardust Dragon', 3], ['Goyo Guardian', 3], ['Black Rose Dragon', 3], ['Colossal Fighter', 3], ['Brionac, Dragon of the Ice Barrier', 3]];
    eq(validateDeck({ main: deck.main, extra }).some((e) => /Extra Deck has \d+ cards \(maximum 15\)/.test(e)), true, '16+ Extra Deck cards rejected');
  });

  // Costs that move cards out of a GY under Necrovalley
  await test('Necrovalley: GY-banish costs cannot be paid (Chaos Sorcerer, DAD effect); DAD itself and hand costs still work; a cost move out of the GY is not dropped like an effect', async () => {
    const { g, place } = setup();
    live(place(1, cardByName('Necrovalley'), 'fzone'));
    for (let i = 0; i < 3; i++) place(0, T.dark, 'grave');
    place(0, cardByName('Ryko, Lightsworn Hunter'), 'grave');
    const cs = place(0, cardByName('Chaos Sorcerer'), 'hand');
    eq(procOffered(g, 0, cs), false, 'Chaos Sorcerer cannot banish its cost from the GY');
    const dad = place(0, cardByName('Dark Armed Dragon'), 'hand');
    await doProc(g, 0, dad);
    eq(dad.location, 'mzone', 'Dark Armed Dragon can still be Special Summoned (no banish)');
    place(1, T.brute, 'mzone');
    eq(offered(g, 0, dad), false, "but its banish-from-GY effect can't be paid");
    const qd = place(0, cardByName('Quickdraw Synchron'), 'hand');
    place(0, T.wall, 'hand');
    eq(procOffered(g, 0, qd), true, 'a hand cost (Quickdraw Synchron) still works');
    const inGy = place(0, T.brute, 'grave');
    await g.moveCards([inGy], 'deck', { reason: 'cost', reasonPlayer: 0, reasonCard: qd });
    eq(inGy.location, 'deck', 'a cost that returns a GY card to the Deck is paid');
    const inGy2 = place(0, T.brute, 'grave');
    await g.moveCards([inGy2], 'deck', { reason: 'effect', reasonPlayer: 0, reasonCard: qd });
    eq(inGy2.location, 'grave', 'the same move by an effect is negated');
  });
}

// ---------------------------------------------------------------- effects used from the Graveyard

async function graveEffectTests() {
  await test('Mezuki: banish it from the GY to Special Summon a Zombie from the GY; not offered without one', async () => {
    const { g, place } = setup();
    const mezuki = place(0, cardByName('Mezuki'), 'grave');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === mezuki), false, 'no Zombie to revive: not offered');
    const zombie = place(0, cardByName('Goblin Zombie'), 'grave');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === mezuki), true, 'offered from the GY');
    await activateCard(g, 0, mezuki);
    eq(mezuki.location, 'banished', 'Mezuki banished as the cost');
    eq(zombie.location, 'mzone', 'Zombie Special Summoned');
  });

  await test('Plaguespreader Zombie is not offered (no card put back) when it cannot be Summoned, e.g. under Consecrated Light', async () => {
    const { g, place } = setup();
    const plague = place(0, cardByName('Plaguespreader Zombie'), 'grave');
    const card = place(0, T.giant, 'hand');
    const light = place(1, cardByName('Consecrated Light'), 'mzone');
    light.faceUp = true;
    await (g as any).setPhase('standby');
    eq(plague.location, 'grave', 'still in the GY');
    eq(card.location, 'hand', 'no card was put back on the Deck');
  });
}

// ---------------------------------------------------------------- Archetype audit: Gladiator Beasts, Machina/Gadgets, Monarchs/Frogs
async function archetypeAuditTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const battleEnd = async (g: Game) => {
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };
  const standby = async (g: Game, p: PlayerId) => {
    g.turnPlayer = p;
    g.phase = 'standby';
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'standby', player: p } as any);
    await g.processTriggers(true);
    g.phase = 'main1';
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
    g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };

  // ---- Gladiator Beasts
  await test('War Chariot: a monster effect activated from the hand (Battle Fader) is negated and destroyed in the hand', async () => {
    const { g, c0, c1, place } = setup();
    const gb = place(1, cardByName('Gladiator Beast Laquari'), 'mzone');
    const wc = place(1, cardByName('Gladiator Beast War Chariot'), 'szone');
    const bf = place(0, cardByName('Battle Fader'), 'hand');
    c0.respond = respondWith('Battle Fader');
    c1.respond = respondWith('Gladiator Beast War Chariot');
    g.turnPlayer = 1;
    g.phase = 'battle';
    await g.conductAttack(1, gb);
    eq(wc.location, 'grave', 'War Chariot used');
    eq(bf.location, 'grave', 'Battle Fader destroyed in the hand');
    eq(g.players[0].lp, 8000 - (gb.data.atk ?? 0), 'the attack went through');
  });

  await test('GB tag-out: after a real attack it shuffles itself in and tags in a different Gladiator Beast; Bestiari pops a Spell/Trap', async () => {
    const { g, c0, place } = setup();
    const best = deckCard(g, 0, 'Gladiator Beast Bestiari');
    const dar = place(0, cardByName('Gladiator Beast Darius'), 'mzone');
    deckCard(g, 0, 'Gladiator Beast Darius');
    const bystander = place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
    const v = place(1, T.wall, 'mzone', { pos: 'def' });
    const st = place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(c0, [best, st]);
    g.phase = 'battle';
    await g.conductAttack(0, dar);
    eq(v.location, 'mzone', '2000 DEF wall survives');
    await battleEnd(g);
    eq(dar.location, 'deck', 'Darius shuffled into the Deck');
    eq(best.location, 'mzone', 'Bestiari tagged in (not another Darius)');
    eq(st.location, 'grave', 'Bestiari destroyed the Set trap');
    eq(bystander.location, 'mzone', 'Laquari did not battle: no tag-out');
  });

  await test('GB tag-out: not offered when the Gladiator Beast was destroyed, or while its effects are negated', async () => {
    const { g, place } = setup();
    const laq = deckCard(g, 0, 'Gladiator Beast Laquari');
    const best = place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    place(1, T.brute, 'mzone');
    g.phase = 'battle';
    await g.conductAttack(0, best);
    eq(best.location, 'grave', 'Bestiari destroyed by battle');
    await battleEnd(g);
    eq(laq.location, 'deck', 'no tag-out from the GY');
    const n = setup();
    const laq2 = deckCard(n.g, 0, 'Gladiator Beast Laquari');
    const b2 = n.place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    b2.attackedThisTurnOrWasAttacked = true;
    b2.tempMods.push({ q: 'negated', value: true, until: 'turn', turn: n.g.turn });
    await battleEnd(n.g);
    eq(b2.location, 'mzone', 'negated: stays');
    eq(laq2.location, 'deck', 'negated: nothing tagged in');
  });

  await test("GB tag-out: Vanity's Fiend stops it (the Beast stays); Royal Oppression cannot negate the tag-out but can negate a contact fusion", async () => {
    const { g, place } = setup();
    const laq = deckCard(g, 0, 'Gladiator Beast Laquari');
    const best = place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    place(1, cardByName("Vanity's Fiend"), 'mzone');
    best.attackedThisTurnOrWasAttacked = true;
    await battleEnd(g);
    eq(best.location, 'mzone', 'Bestiari stays on the field');
    eq(laq.location, 'deck', 'no Special Summon');
    const r = setup();
    const laq2 = deckCard(r.g, 0, 'Gladiator Beast Laquari');
    const b2 = r.place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    live(r.place(1, cardByName('Royal Oppression'), 'szone'));
    r.c1.respond = respondWith('Royal Oppression');
    b2.attackedThisTurnOrWasAttacked = true;
    await battleEnd(r.g);
    eq(laq2.location, 'mzone', 'tag-out Special Summon is not negatable by Royal Oppression');
    eq(r.g.players[1].lp, 8000, 'no LP paid');
    const f = setup();
    f.place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    f.place(0, cardByName('Gladiator Beast Darius'), 'mzone');
    const gy = f.place(0, cardByName('Gladiator Beast Gyzarus'), 'extra');
    live(f.place(1, cardByName('Royal Oppression'), 'szone'));
    f.c1.respond = respondWith('Royal Oppression');
    const a = f.g.legalMainActions(0).find((x) => x.type === 'proc' && x.card === gy)!;
    await f.g.performAction(0, a);
    eq(gy.location, 'grave', 'contact fusion negated and destroyed');
    eq(f.g.players[1].lp, 7200, '800 LP paid');
  });

  await test('Darius: revives a Gladiator Beast whose effects are negated (no Bestiari trigger); it returns to the Deck when Darius leaves', async () => {
    const { g, c0, place } = setup();
    const dar = deckCard(g, 0, 'Gladiator Beast Darius');
    const best = place(0, cardByName('Gladiator Beast Bestiari'), 'grave');
    const laq = place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(c0, [dar, best, st]);
    laq.attackedThisTurnOrWasAttacked = true;
    await battleEnd(g);
    eq(dar.location, 'mzone', 'Darius tagged in');
    eq(best.location, 'mzone', 'Bestiari revived');
    eq(g.isNegated(best), true, 'its effects are negated');
    eq(st.location, 'szone', 'negated Bestiari did not destroy a Spell/Trap');
    await g.destroy([dar], 'effect', 1);
    await g.processTriggers(true);
    eq(best.location, 'deck', 'Bestiari shuffled into the Deck when Darius left the field');
  });

  await test('Test Tiger: Special Summons itself from the hand while you control a face-up Gladiator Beast; its tag gives Laquari 2100 ATK', async () => {
    const { g, c0, place } = setup();
    const tiger = place(0, cardByName('Test Tiger'), 'hand');
    eq(procOffered(g, 0, tiger), false, 'no Gladiator Beast: no Special Summon');
    const sec = place(0, cardByName('Gladiator Beast Secutor'), 'mzone');
    eq(procOffered(g, 0, tiger), true, 'with a face-up Gladiator Beast: Special Summon from the hand');
    await g.performAction(0, g.legalMainActions(0).find((x) => x.type === 'proc' && x.card === tiger)!);
    eq(tiger.location, 'mzone', 'Test Tiger Special Summoned');
    const laq = deckCard(g, 0, 'Gladiator Beast Laquari');
    pickOnly(c0, [sec, laq]);
    await activateCard(g, 0, tiger);
    eq(tiger.location, 'grave', 'Test Tiger Tributed');
    eq(sec.location, 'deck', 'Secutor shuffled into the Deck');
    eq(laq.location, 'mzone', 'Laquari Special Summoned');
    eq(g.getAtk(laq), 2100, 'treated as Summoned by a Gladiator Beast effect');
  });

  await test('Gladiator Beast War Chariot: only while you control a face-up Gladiator Beast; negates and destroys a monster effect', async () => {
    const { g, c0, c1, place } = setup();
    const wc = place(1, cardByName('Gladiator Beast War Chariot'), 'szone');
    c1.respond = respondWith('Gladiator Beast War Chariot');
    const dad = place(0, cardByName('Dark Armed Dragon'), 'mzone');
    place(0, T.dark, 'grave');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(c0, [st]);
    await activateCard(g, 0, dad);
    eq(wc.location, 'szone', 'no Gladiator Beast: War Chariot not activated');
    eq(st.location, 'grave', 'DAD resolved');
    const t = setup();
    const wc2 = t.place(1, cardByName('Gladiator Beast War Chariot'), 'szone');
    t.place(1, cardByName('Gladiator Beast Hoplomus'), 'mzone', { pos: 'def' });
    t.c1.respond = respondWith('Gladiator Beast War Chariot');
    const dad2 = t.place(0, cardByName('Dark Armed Dragon'), 'mzone');
    t.place(0, T.dark, 'grave');
    const st2 = t.place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(t.c0, [st2]);
    await activateCard(t.g, 0, dad2);
    eq(wc2.location, 'grave', 'War Chariot used');
    eq(dad2.location, 'grave', 'DAD destroyed');
    eq(st2.location, 'szone', 'its effect negated');
  });

  await test('Gyzarus: its destroy trigger is for its own Special Summon only; Heraklinos discards to negate a Spell', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Gladiator Beast Gyzarus'), 'mzone');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    const laq = place(0, cardByName('Gladiator Beast Laquari'), 'grave');
    pickOnly(c0, [laq, st]);
    await activateCard(g, 0, place(0, cardByName('Monster Reborn'), 'hand'));
    eq(laq.location, 'mzone', 'revived');
    eq(st.location, 'szone', 'Gyzarus did not trigger on another monster');
    const h = setup();
    const her = h.place(1, cardByName('Gladiator Beast Heraklinos'), 'mzone');
    const disc = h.place(1, T.wall, 'hand');
    h.c1.respond = (_g, req) => req.options.find((o) => o.card === her) ?? null;
    const target = h.place(1, T.brute, 'mzone');
    const sm = h.place(0, cardByName('Smashing Ground'), 'hand');
    await activateCard(h.g, 0, sm);
    eq(disc.location, 'grave', 'discarded 1 card');
    eq(target.location, 'mzone', 'Smashing Ground negated');
    eq(sm.location, 'grave', 'and destroyed');
  });

  // ---- Machina / Gadgets
  await test('Machina Fortress: Special Summons itself from the GY by discarding Machines with total Levels 8+; one Gadget is not enough', async () => {
    const { g, place } = setup();
    const fort = place(0, cardByName('Machina Fortress'), 'grave');
    const g1 = place(0, cardByName('Green Gadget'), 'hand');
    eq(offered(g, 0, fort), false, 'only 4 Levels in hand');
    const g2 = place(0, cardByName('Red Gadget'), 'hand');
    eq(offered(g, 0, fort), true, '4 + 4 Levels');
    await activateCard(g, 0, fort);
    eq(fort.location, 'mzone', 'Fortress revived');
    eq(g1.location, 'grave', 'Green discarded');
    eq(g2.location, 'grave', 'Red discarded');
    const h = setup();
    const f2 = h.place(0, cardByName('Machina Fortress'), 'hand');
    h.place(0, cardByName('Machina Fortress'), 'grave');
    eq(offered(h.g, 0, f2), false, 'a lone Fortress in the hand is only 7 Levels, even counting itself');
  });

  await test('Machina Fortress: destroyed by battle → destroy 1 card the opponent controls', async () => {
    const { g, c1, place } = setup();
    const fort = place(1, cardByName('Machina Fortress'), 'mzone');
    const atk = place(0, T.giant, 'mzone');
    const st = place(0, cardByName('Mirror Force'), 'szone');
    pickOnly(c1, [st]);
    g.phase = 'battle';
    await g.conductAttack(0, atk);
    eq(fort.location, 'grave', 'Fortress destroyed');
    eq(st.location, 'grave', 'it destroyed a card the attacker controls');
  });

  await test('Gadgets search the next colour on Normal and Special Summon, not on a Flip Summon', async () => {
    const { g, place } = setup();
    const red = deckCard(g, 0, 'Red Gadget');
    const green = place(0, cardByName('Green Gadget'), 'hand');
    await g.normalSummon(0, green, false);
    eq(red.location, 'hand', 'Green found Red');
    const yel = deckCard(g, 0, 'Yellow Gadget');
    await g.specialSummon([red], 0, {});
    await g.processTriggers(true);
    eq(yel.location, 'hand', 'Red Special Summoned found Yellow');
    const f = setup();
    const r2 = deckCard(f.g, 0, 'Red Gadget');
    const set = f.place(0, cardByName('Green Gadget'), 'mzone', { faceUp: false, pos: 'def' });
    await f.g.flipSummon(0, set);
    eq(set.faceUp, true, 'flipped');
    eq(r2.location, 'deck', 'no search on a Flip Summon');
  });

  await test('Machina Gearframe searches a "Machina" monster except Gearframe; Machine Duplication copies a 500-ATK Machine', async () => {
    const { g, c0, place } = setup();
    const fort = deckCard(g, 0, 'Machina Fortress');
    const gf2 = deckCard(g, 0, 'Machina Gearframe');
    const gf = place(0, cardByName('Machina Gearframe'), 'hand');
    c0.pick = (_g, req) => (req.candidates.includes(gf2) ? [gf2] : req.candidates.slice(0, Math.max(1, req.min)));
    await g.normalSummon(0, gf, false);
    eq(gf2.location, 'deck', 'Gearframe not searchable');
    eq(fort.location, 'hand', 'Fortress added');
    const d = setup();
    d.place(0, cardByName('Machina Peacekeeper'), 'mzone');
    const p2 = deckCard(d.g, 0, 'Machina Peacekeeper');
    const p3 = deckCard(d.g, 0, 'Machina Peacekeeper');
    d.c0.pick = (_g, req) => req.candidates.slice(0, req.max);
    await activateCard(d.g, 0, d.place(0, cardByName('Machine Duplication'), 'hand'));
    eq(p2.location, 'mzone', 'copy 1');
    eq(p3.location, 'mzone', 'copy 2');
  });

  await test('Limiter Removal doubles Machines and destroys them in the End Phase', async () => {
    const { g, place } = setup();
    const cd = place(0, cardByName('Cyber Dragon'), 'mzone');
    const other = place(0, T.brute, 'mzone');
    await activateCard(g, 0, place(0, cardByName('Limiter Removal'), 'hand'));
    eq(g.getAtk(cd), 4200, 'doubled');
    eq(g.getAtk(other), 1800, 'non-Machine unchanged');
    await (g as any).setPhase('end');
    eq(cd.location, 'grave', 'destroyed in the End Phase');
    eq(other.location, 'mzone', 'Warrior stays');
  });

  // ---- Monarchs / Frogs
  await test('Monarchs: Caius triggers on a Tribute Summon (1000 for a DARK), not on a Special Summon; Thestalos burns Level x 100', async () => {
    const { g, c0, place } = setup();
    place(0, cardByName('Treeborn Frog'), 'mzone');
    const caius = place(0, cardByName('Caius the Shadow Monarch'), 'hand');
    const d = place(1, T.dark, 'mzone');
    pickOnly(c0, [d]);
    await g.normalSummon(0, caius, false);
    eq(d.location, 'banished', 'banished');
    eq(g.players[1].lp, 7000, '1000 for a DARK');
    const r = setup();
    const c2 = r.place(0, cardByName('Caius the Shadow Monarch'), 'grave');
    const v = r.place(1, T.brute, 'mzone');
    pickOnly(r.c0, [c2]);
    await activateCard(r.g, 0, r.place(0, cardByName('Monster Reborn'), 'hand'));
    eq(c2.location, 'mzone', 'Caius revived');
    eq(v.location, 'mzone', 'no Tribute Summon: no banish');
    const t = setup();
    t.place(0, T.wall, 'mzone');
    const th = t.place(0, cardByName('Thestalos the Firestorm Monarch'), 'hand');
    const h = t.place(1, T.giant, 'hand');
    await t.g.normalSummon(0, th, false);
    eq(h.location, 'grave', 'random discard (only card)');
    eq(t.g.players[1].lp, 8000 - 800, 'Level 8 x 100');
  });

  await test("Monarchs: a Tribute Set then Flip Summon does not trigger; Soul Exchange Tributes the opponent's monster for Raiza", async () => {
    const { g, place } = setup();
    place(0, T.wall, 'mzone');
    const raiza = place(0, cardByName('Raiza the Storm Monarch'), 'hand');
    const v = place(1, T.brute, 'mzone');
    await g.normalSummon(0, raiza, true);
    g.turn += 1;
    await g.flipSummon(0, raiza);
    eq(raiza.faceUp, true, 'flipped');
    eq(v.location, 'mzone', 'no Raiza trigger on a Flip Summon');
    const s = setup();
    const opp = s.place(1, T.brute, 'mzone');
    const st = s.place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(s.c0, [opp, st]);
    await activateCard(s.g, 0, s.place(0, cardByName('Soul Exchange'), 'hand'));
    const r2 = s.place(0, cardByName('Raiza the Storm Monarch'), 'hand');
    eq(s.g.canNormalSummon(0, r2, false), true, "can Tribute the opponent's monster");
    await s.g.normalSummon(0, r2, false);
    eq(opp.location, 'grave', "opponent's monster Tributed (to its owner's GY)");
    eq(r2.location, 'mzone', 'Raiza Tribute Summoned');
    eq(st.location, 'deck', 'Raiza spun the Set trap');
  });

  await test("Treeborn Frog: each copy revives in your Standby Phase; any Spell/Trap you control (Set card, Field Spell) stops it; not on the opponent's Standby; Necrovalley stops it", async () => {
    const { g, place } = setup();
    const f1 = place(0, cardByName('Treeborn Frog'), 'grave');
    const f2 = place(0, cardByName('Treeborn Frog'), 'grave');
    await standby(g, 1);
    eq(f1.location, 'grave', "not in the opponent's Standby Phase");
    await standby(g, 0);
    eq(f1.location, 'mzone', 'first copy');
    eq(f2.location, 'mzone', 'second copy');
    const s = setup();
    const f3 = s.place(0, cardByName('Treeborn Frog'), 'grave');
    s.place(0, cardByName('Mirror Force'), 'szone');
    await standby(s.g, 0);
    eq(f3.location, 'grave', 'a Set card blocks it');
    const fz = setup();
    const f4 = fz.place(0, cardByName('Treeborn Frog'), 'grave');
    live(fz.place(0, cardByName('Necrovalley'), 'fzone'));
    await standby(fz.g, 0);
    eq(f4.location, 'grave', 'own Field Spell blocks it');
    const nv = setup();
    const f5 = nv.place(0, cardByName('Treeborn Frog'), 'grave');
    live(nv.place(1, cardByName('Necrovalley'), 'fzone'));
    await standby(nv.g, 0);
    eq(f5.location, 'grave', "opponent's Necrovalley blocks it");
  });

  await test('Frogs: Substitoad Tributes for a Frog from the Deck; Dupe Frog sent from the field adds a Frog', async () => {
    const { g, c0, place } = setup();
    const sub = place(0, cardByName('Substitoad'), 'mzone');
    const fodder = place(0, T.wall, 'mzone');
    const swap = deckCard(g, 0, 'Swap Frog');
    pickOnly(c0, [fodder, swap]);
    await activateCard(g, 0, sub);
    eq(fodder.location, 'grave', 'Tributed');
    eq(swap.location, 'mzone', 'Swap Frog Special Summoned');
    const d = setup();
    const dupe = d.place(0, cardByName('Dupe Frog'), 'mzone');
    const sw = deckCard(d.g, 0, 'Swap Frog');
    await d.g.destroy([dupe], 'effect', 1);
    await d.g.processTriggers(true);
    eq(sw.location, 'hand', 'Dupe Frog added Swap Frog');
  });
}

// ---------------------------------------------------------------- Pre-tournament audit: Zombies, Gravekeepers, Aliens, Fortune Ladies, Morphtronics, Koa'ki Meiru, Ancient Gear

async function zombieGraveAlienAuditTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const standby = async (g: Game, p: PlayerId) => {
    g.turnPlayer = p;
    g.phase = 'standby';
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'standby', player: p } as any);
    await g.processTriggers(true);
    g.phase = 'main1';
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };

  // ---- Zombies
  await test('Audit: Zombie Master discards a monster to revive a Level 4 or lower Zombie from either GY, once per turn', async () => {
    const { g, c0, place } = setup();
    const zm = place(0, cardByName('Zombie Master'), 'mzone');
    const fodder = place(0, T.brute, 'hand');
    place(1, cardByName('Vampire Lord'), 'grave'); // Level 5: not a target
    const target = place(1, cardByName('Goblin Zombie'), 'grave');
    pickOnly(c0, [fodder, target]);
    await activateCard(g, 0, zm);
    eq(fodder.location, 'grave', 'monster discarded as the cost');
    eq(target.location, 'mzone', "opponent's Zombie revived");
    eq(target.controller, 0, 'on my side');
    place(0, T.brute, 'hand');
    place(0, cardByName('Mezuki'), 'grave');
    eq(offered(g, 0, zm), false, 'once per turn');
    const s = setup();
    const zm2 = s.place(0, cardByName('Zombie Master'), 'mzone');
    s.place(0, cardByName('Vampire Lord'), 'grave');
    s.place(0, T.brute, 'hand');
    eq(offered(s.g, 0, zm2), false, 'no Level 4 or lower Zombie to revive');
  });

  await test('Audit: Goblin Zombie searches a 1200-or-less-DEF Zombie when sent from the field to the GY, not when discarded', async () => {
    const { g, c0, place } = setup();
    const gz = place(0, cardByName('Goblin Zombie'), 'mzone');
    const mez = deckCard(g, 0, 'Mezuki');
    pickOnly(c0, [mez]);
    await g.destroy([gz], 'effect', 1);
    await g.processTriggers(true);
    eq(mez.location, 'hand', 'Mezuki added');
    const s = setup();
    const gz2 = s.place(0, cardByName('Goblin Zombie'), 'hand');
    const mez2 = deckCard(s.g, 0, 'Mezuki');
    await s.g.discard([gz2], 'effect', 1);
    await s.g.processTriggers(true);
    eq(mez2.location, 'deck', 'no search from the hand');
  });

  await test('Audit: Red-Eyes Zombie Dragon takes only a Zombie-Type monster it destroys (any monster under Zombie World)', async () => {
    const { g, place } = setup();
    const rezd = place(0, cardByName('Red-Eyes Zombie Dragon'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    await g.conductAttack(0, rezd);
    eq(v.location, 'grave', 'a non-Zombie stays in the GY');
    const s = setup();
    const rezd2 = s.place(0, cardByName('Red-Eyes Zombie Dragon'), 'mzone');
    const z = s.place(1, cardByName('Mezuki'), 'mzone');
    await s.g.conductAttack(0, rezd2);
    eq(z.location, 'mzone', 'the Zombie is Special Summoned');
    eq(z.controller, 0, 'to my side');
    const w = setup();
    const rezd3 = w.place(0, cardByName('Red-Eyes Zombie Dragon'), 'mzone');
    live(w.place(0, cardByName('Zombie World'), 'fzone'));
    const v3 = w.place(1, T.brute, 'mzone');
    await w.g.conductAttack(0, rezd3);
    eq(v3.location, 'mzone', 'Zombie World: the destroyed monster is a Zombie');
    eq(v3.controller, 0, 'to my side');
  });

  await test('Audit: Il Blud (Gemini Summoned) revives a Zombie from either GY once per turn; they are destroyed when it leaves', async () => {
    const { g, c0, place } = setup();
    const il = place(0, cardByName('Il Blud'), 'mzone');
    const z = place(1, cardByName('Mezuki'), 'grave');
    const revive = () => g.getActivations(0, { open: true }).some((a) => a.card === il && a.label === 'Summon a Zombie from hand or either GY');
    eq(revive(), false, 'a Normal Monster until Gemini Summoned');
    il.flags.geminiSummoned = true;
    pickOnly(c0, [z]);
    await activateCard(g, 0, il);
    eq(z.location, 'mzone', "opponent's Zombie Special Summoned");
    eq(z.controller, 0, 'to my side');
    place(0, cardByName('Goblin Zombie'), 'grave');
    eq(revive(), false, 'once per turn');
    await g.destroy([il], 'effect', 1);
    await g.processTriggers(true);
    eq(z.location, 'grave', 'destroyed when Il Blud left the field');
  });

  await test('Audit: Pyramid Turtle destroyed by battle Special Summons a Zombie with 2000 or less DEF from the Deck', async () => {
    const { g, place } = setup();
    const pt = place(1, cardByName('Pyramid Turtle'), 'mzone');
    const rk = deckCard(g, 1, 'Ryu Kokki'); // DEF 2200: not eligible
    const vl = deckCard(g, 1, 'Vampire Lord');
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(pt.location, 'grave', 'Turtle destroyed');
    eq(vl.location, 'mzone', 'Vampire Lord Special Summoned');
    eq(rk.location, 'deck', 'Ryu Kokki (DEF 2200) stays');
  });

  // ---- Gravekeepers
  await test("Audit: Gravekeeper's Descendant Tributes only another face-up Gravekeeper's monster", async () => {
    const { g, c0, place } = setup();
    const desc = place(0, cardByName("Gravekeeper's Descendant"), 'mzone');
    place(0, T.brute, 'mzone');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    eq(offered(g, 0, desc), false, "a non-Gravekeeper's monster cannot be Tributed");
    place(0, cardByName("Gravekeeper's Spy"), 'mzone', { faceUp: false, pos: 'def' });
    eq(offered(g, 0, desc), false, "a face-down Gravekeeper's Spy cannot be Tributed");
    const spy = place(0, cardByName("Gravekeeper's Spy"), 'mzone');
    pickOnly(c0, [spy, st]);
    await activateCard(g, 0, desc);
    eq(spy.location, 'grave', 'Spy Tributed');
    eq(st.location, 'grave', 'target destroyed');
  });

  await test("Audit: Gravekeeper's Commandant discards itself to add Necrovalley; Royal Tribute needs Necrovalley and discards monsters from both hands", async () => {
    const { g, place } = setup();
    const cmd = place(0, cardByName("Gravekeeper's Commandant"), 'hand');
    const nv = deckCard(g, 0, 'Necrovalley');
    await activateCard(g, 0, cmd);
    eq(cmd.location, 'grave', 'Commandant discarded');
    eq(nv.location, 'hand', 'Necrovalley added');
    const s = setup();
    const rt = s.place(0, cardByName('Royal Tribute'), 'hand');
    const mine = s.place(0, T.brute, 'hand');
    const theirs = s.place(1, T.brute, 'hand');
    const spell = s.place(1, cardByName('Dark Hole'), 'hand');
    eq(offered(s.g, 0, rt), false, 'no Necrovalley: cannot activate');
    live(s.place(0, cardByName('Necrovalley'), 'fzone'));
    await activateCard(s.g, 0, rt);
    eq(mine.location, 'grave', 'my monster discarded');
    eq(theirs.location, 'grave', "opponent's monster discarded");
    eq(spell.location, 'hand', 'non-monsters stay');
  });

  // ---- Aliens
  await test('Audit: Alien Dog comes out when an Alien is Normal Summoned, places 2 real A-Counters, and its battles use them', async () => {
    const { g, place } = setup();
    const dog = place(0, cardByName('Alien Dog'), 'hand');
    const kid = place(0, cardByName('Alien Kid'), 'hand');
    const v = place(1, T.brute, 'mzone');
    await g.normalSummon(0, kid, false);
    eq(dog.location, 'mzone', 'Alien Dog Special Summoned');
    eq(v.counters.A ?? 0, 2, "2 A-Counters on the opponent's monster");
    eq(g.getAtk(v), 1800, 'no loss outside damage calculation');
    dog.pos = 'atk';
    await g.conductAttack(0, dog);
    eq(v.location, 'grave', '1500 beats 1800 - 600');
    eq(g.players[1].lp, 8000 - 300, '300 damage');
  });

  await test('Audit: Alien Overlord Special Summons itself by removing 2 A-Counters and counters every opposing face-up monster once per turn', async () => {
    const { g, place } = setup();
    const ov = place(0, cardByName('Alien Overlord'), 'hand');
    const v = place(1, T.brute, 'mzone');
    const w = place(1, T.wall, 'mzone');
    eq(procOffered(g, 0, ov), false, 'no A-Counters');
    v.counters.A = 2;
    eq(procOffered(g, 0, ov), true, '2 A-Counters on the field');
    await g.performAction(0, g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === ov)!);
    eq(ov.location, 'mzone', 'Overlord Special Summoned');
    eq(v.counters.A ?? 0, 0, 'counters removed');
    await activateCard(g, 0, ov);
    eq(v.counters.A ?? 0, 1, 'counter on the first monster');
    eq(w.counters.A ?? 0, 1, 'counter on the second monster');
    eq(offered(g, 0, ov), false, 'once per turn');
  });

  await test('Audit: Cell Explosion Virus only answers an attack by a monster with an A-Counter and destroys all Attack Position monsters', async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const cev = place(1, cardByName('Cell Explosion Virus'), 'szone', { faceUp: false });
    place(1, T.giant, 'mzone');
    c1.respond = respondWith('Cell Explosion Virus');
    await g.conductAttack(0, a);
    eq(cev.location, 'szone', 'no A-Counter: not activated');
    const s = setup();
    const a2 = s.place(0, T.brute, 'mzone');
    const b2 = s.place(0, T.dark, 'mzone');
    const d2 = s.place(0, T.wall, 'mzone', { pos: 'def' });
    s.place(1, cardByName('Cell Explosion Virus'), 'szone', { faceUp: false });
    s.place(1, T.giant, 'mzone');
    a2.counters.A = 1;
    s.c1.respond = respondWith('Cell Explosion Virus');
    await s.g.conductAttack(0, a2);
    eq(a2.location, 'grave', 'attacker destroyed');
    eq(b2.location, 'grave', 'other Attack Position monster destroyed');
    eq(d2.location, 'mzone', 'Defense Position monster survives');
  });

  // ---- Fortune Ladies
  await test("Audit: Fortune Lady ATK/DEF follow the Level, which rises in its controller's Standby Phase only", async () => {
    const { g, place } = setup();
    const fl = place(0, cardByName('Fortune Lady Light'), 'mzone');
    eq(g.getAtk(fl), 200, 'Level 1 x 200');
    await standby(g, 1);
    eq(g.getLevel(fl), 1, "not in the opponent's Standby Phase");
    await standby(g, 0);
    eq(g.getLevel(fl), 2, 'Level 2');
    eq(g.getAtk(fl), 400, 'ATK 400');
    eq(g.getDef(fl), 400, 'DEF 400');
  });

  await test('Audit: Fortune Lady Dark revives a Fortune Lady after a Fortune Lady wins a battle; Solitaire Magician lowers a Level by 3 to destroy a monster', async () => {
    const { g, c0, place } = setup();
    const dark = place(0, cardByName('Fortune Lady Dark'), 'mzone');
    const light = place(0, cardByName('Fortune Lady Light'), 'grave');
    place(1, T.wall, 'mzone');
    pickOnly(c0, [light]);
    await g.conductAttack(0, dark);
    eq(light.location, 'mzone', 'Fortune Lady Light revived');
    const s = setup();
    const sm = s.place(0, cardByName('Solitaire Magician'), 'mzone');
    const d2 = s.place(0, cardByName('Fortune Lady Dark'), 'mzone');
    const v = s.place(1, T.brute, 'mzone');
    pickOnly(s.c0, [d2, v]);
    await activateCard(s.g, 0, sm);
    eq(v.location, 'grave', 'other monster destroyed');
    eq(s.g.getLevel(d2), 2, 'Level 5 - 3');
    eq(s.g.getAtk(d2), 800, 'ATK = Level x 400');
  });

  await test("Audit: Fortune's Future returns a banished Fortune Lady to the GY and draws 2", async () => {
    const { g, place } = setup();
    const ff = place(0, cardByName("Fortune's Future"), 'hand');
    eq(offered(g, 0, ff), false, 'no banished Fortune Lady');
    const b = place(0, cardByName('Fortune Lady Light'), 'banished');
    await activateCard(g, 0, ff);
    eq(b.location, 'grave', 'returned to the GY');
    eq(g.players[0].hand.length, 2, 'drew 2');
  });

  // ---- Morphtronics
  await test('Audit: Morphtronic Radion +800 ATK in Attack Position / +1000 DEF in Defense Position; Scopen is Level 4 in Defense Position', async () => {
    const { g, place } = setup();
    const r = place(0, cardByName('Morphtronic Radion'), 'mzone');
    const bx = place(0, cardByName('Morphtronic Boomboxen'), 'mzone');
    const other = place(0, T.brute, 'mzone');
    eq(g.getAtk(bx), 2000, 'Boomboxen 1200 + 800');
    eq(g.getAtk(r), 1800, 'Radion boosts itself');
    eq(g.getAtk(other), 1800, 'non-Morphtronic unaffected');
    r.pos = 'def';
    g.update();
    eq(g.getAtk(bx), 1200, 'no ATK boost in Defense Position');
    eq(g.getDef(bx), 1400, 'Boomboxen 400 + 1000 DEF');
    const sc = place(0, cardByName('Morphtronic Scopen'), 'mzone');
    eq(g.getLevel(sc), 3, 'Level 3 in Attack Position');
    sc.pos = 'def';
    g.update();
    eq(g.getLevel(sc), 4, 'Level 4 in Defense Position');
  });

  await test('Audit: Morphtronic Boomboxen in Defense Position negates an attack on a face-up Morphtronic', async () => {
    const { g, place } = setup();
    const bx = place(1, cardByName('Morphtronic Boomboxen'), 'mzone', { pos: 'def' });
    const a = place(0, T.giant, 'mzone');
    await g.conductAttack(0, a);
    eq(bx.location, 'mzone', 'attack negated');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // ---- Koa'ki Meiru / Ancient Gear
  await test("Audit: Koa'ki Meiru Rooklord can be Tribute Summoned with 1 Koa'ki Meiru monster only", async () => {
    const { g, place } = setup();
    const rook = place(0, cardByName("Koa'ki Meiru Rooklord"), 'hand');
    place(0, T.brute, 'mzone');
    eq(procOffered(g, 0, rook), false, "no Koa'ki Meiru to Tribute");
    place(0, cardByName("Koa'ki Meiru Boulder"), 'mzone');
    eq(procOffered(g, 0, rook), true, "1 Koa'ki Meiru Tribute");
  });

  await test('Audit: Ultimate Ancient Gear Golem destroyed revives Ancient Gear Golem from the GY', async () => {
    const { g, place } = setup();
    const uagg = place(0, cardByName('Ultimate Ancient Gear Golem'), 'mzone');
    const agg = place(0, cardByName('Ancient Gear Golem'), 'grave');
    await g.destroy([uagg], 'effect', 1);
    await g.processTriggers(true);
    eq(agg.location, 'mzone', 'Ancient Gear Golem Special Summoned');
  });

  // TODO (held, engine has no per-card Tribute filter): Red-Eyes Zombie Dragon can only be Tribute Summoned by Tributing Zombies.
  // await test('Audit: Red-Eyes Zombie Dragon cannot be Tribute Summoned with non-Zombie Tributes', async () => {
  //   const { g, place } = setup();
  //   const rezd = place(0, cardByName('Red-Eyes Zombie Dragon'), 'hand');
  //   place(0, T.brute, 'mzone');
  //   place(0, T.wall, 'mzone');
  //   eq(g.canNormalSummon(0, rezd, false), false, 'non-Zombie Tributes');
  // });
}

// ---------------------------------------------------------------- Pre-tournament audit: Blackwings & Lightsworn
async function blackwingLightswornAuditTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckData = (g: Game, p: PlayerId, data: CardData) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck'); // top of the Deck
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => deckData(g, p, cardByName(name));
  const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
    g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };
  const endPhase = async (g: Game) => {
    await (g as any).setPhase('end');
  };
  const deckLen = (g: Game, p: PlayerId) => g.players[p].deck.length;

  // ---- Lightsworn
  await test('Audit LS: End Phase mills (Lumina 3, Jain 2, Aurkus 2, Ehren 3, Lyla 3, Judgment Dragon 4) only in your own End Phase, only face-up', async () => {
    const cases: [string, number][] = [
      ['Lumina, Lightsworn Summoner', 3],
      ['Jain, Lightsworn Paladin', 2],
      ['Aurkus, Lightsworn Druid', 2],
      ['Ehren, Lightsworn Monk', 3],
      ['Lyla, Lightsworn Sorceress', 3],
      ['Judgment Dragon', 4],
    ];
    for (const [name, n] of cases) {
      const { g, place } = setup();
      place(0, cardByName(name), 'mzone');
      const before = deckLen(g, 0);
      await endPhase(g);
      eq(deckLen(g, 0), before - n, `${name} mills ${n}`);
      const o = setup();
      o.place(0, cardByName(name), 'mzone');
      o.g.turnPlayer = 1;
      const b2 = deckLen(o.g, 0);
      await endPhase(o.g);
      eq(deckLen(o.g, 0), b2, `${name}: no mill in the opponent's End Phase`);
    }
    const fd = setup();
    fd.place(0, cardByName('Lumina, Lightsworn Summoner'), 'mzone', { faceUp: false, pos: 'def' });
    const b3 = deckLen(fd.g, 0);
    await endPhase(fd.g);
    eq(deckLen(fd.g, 0), b3, 'a face-down Lumina does not mill');
    const two = setup();
    two.place(0, cardByName('Jain, Lightsworn Paladin'), 'mzone');
    two.place(0, cardByName('Jain, Lightsworn Paladin'), 'mzone');
    const b4 = deckLen(two.g, 0);
    await endPhase(two.g);
    eq(deckLen(two.g, 0), b4 - 4, 'each copy mills');
  });

  await test('Audit LS: Wulf is Special Summoned when sent from the Deck (mill, Foolish Burial), not when discarded; cannot be Normal Summoned/Set', async () => {
    const { g, place } = setup();
    place(0, cardByName('Lumina, Lightsworn Summoner'), 'mzone');
    const w = deckCard(g, 0, 'Wulf, Lightsworn Beast');
    await endPhase(g);
    eq(w.location, 'mzone', 'Wulf milled by Lumina is Special Summoned');
    const f = setup();
    const w2 = deckCard(f.g, 0, 'Wulf, Lightsworn Beast');
    deckData(f.g, 0, T.wall);
    pickOnly(f.c0, [w2]);
    await activateCard(f.g, 0, f.place(0, cardByName('Foolish Burial'), 'hand'));
    eq(w2.location, 'mzone', 'Foolish Burial: Wulf Special Summoned');
    const d = setup();
    const w3 = d.place(0, cardByName('Wulf, Lightsworn Beast'), 'hand');
    eq(d.g.canNormalSummon(0, w3, false), false, 'cannot be Normal Summoned');
    eq(d.g.canNormalSummon(0, w3, true), false, 'cannot be Set');
    d.place(0, cardByName('Ryko, Lightsworn Hunter'), 'hand');
    pickOnly(d.c0, [w3]);
    await activateCard(d.g, 0, d.place(0, cardByName('Solar Recharge'), 'hand'));
    eq(w3.location, 'grave', 'discarded Wulf stays in the GY');
  });

  await test('Audit LS: Charge of the Light Brigade sends 3 as a cost, then adds a Level 4 or lower Lightsworn (not Celestia / Judgment Dragon)', async () => {
    const { g, c0, place } = setup();
    const cel = deckCard(g, 0, 'Celestia, Lightsworn Angel');
    const jd = deckCard(g, 0, 'Judgment Dragon');
    const ryko = deckCard(g, 0, 'Ryko, Lightsworn Hunter');
    for (let i = 0; i < 3; i++) deckData(g, 0, T.wall);
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      cands = req.candidates;
      return req.candidates.filter((c) => c === ryko);
    };
    const before = deckLen(g, 0);
    await activateCard(g, 0, place(0, cardByName('Charge of the Light Brigade'), 'hand'));
    eq(ryko.location, 'hand', 'Ryko added');
    eq(cands.includes(cel) || cands.includes(jd), false, 'Level 5+ / non-Lightsworn not searchable');
    eq(deckLen(g, 0), before - 4, '3 sent + 1 added');
    const e = setup();
    e.g.players[0].deck.splice(0, e.g.players[0].deck.length - 2);
    deckCard(e.g, 0, 'Ryko, Lightsworn Hunter');
    eq(offered(e.g, 0, e.place(0, cardByName('Charge of the Light Brigade'), 'hand')), false, 'needs 3 cards to send plus a Lightsworn to add');
  });

  await test('Audit LS: Solar Recharge discards a Lightsworn as a cost, draws 2, then sends the top 2', async () => {
    const { g, place } = setup();
    const sr = place(0, cardByName('Solar Recharge'), 'hand');
    const nonLs = place(0, T.brute, 'hand');
    eq(offered(g, 0, sr), false, 'not without a Lightsworn monster to discard');
    const ryko = place(0, cardByName('Ryko, Lightsworn Hunter'), 'hand');
    const before = deckLen(g, 0);
    await activateCard(g, 0, sr);
    eq(ryko.location, 'grave', 'Lightsworn discarded');
    eq(nonLs.location, 'hand', 'non-Lightsworn kept');
    eq(g.players[0].hand.length, 3, 'drew 2');
    eq(deckLen(g, 0), before - 4, 'drew 2 + sent 2');
  });

  await test("Audit LS: Garoth triggers once per Lightsworn mill (Lumina's End Phase), sends 2 and draws per Lightsworn; not for its own mill or a Spell's mill", async () => {
    const { g, place } = setup();
    place(0, cardByName('Lumina, Lightsworn Summoner'), 'mzone');
    place(0, cardByName('Garoth, Lightsworn Warrior'), 'mzone');
    deckCard(g, 0, 'Ryko, Lightsworn Hunter');
    deckCard(g, 0, 'Lyla, Lightsworn Sorceress');
    for (let i = 0; i < 3; i++) deckData(g, 0, T.wall);
    const before = deckLen(g, 0);
    const hand = g.players[0].hand.length;
    await endPhase(g);
    eq(g.players[0].hand.length, hand + 2, 'drew 2 (2 Lightsworn sent by Garoth)');
    eq(deckLen(g, 0), before - 3 - 2 - 2, 'Lumina 3 + Garoth 2 + 2 draws (Garoth does not retrigger itself)');
    const s = setup();
    s.place(0, cardByName('Garoth, Lightsworn Warrior'), 'mzone');
    deckCard(s.g, 0, 'Ryko, Lightsworn Hunter');
    for (let i = 0; i < 4; i++) deckData(s.g, 0, T.wall);
    const b2 = deckLen(s.g, 0);
    s.c0.pick = (_g, req) => req.candidates.slice(0, 1);
    await activateCard(s.g, 0, s.place(0, cardByName('Charge of the Light Brigade'), 'hand'));
    eq(deckLen(s.g, 0), b2 - 4, 'Charge (a Spell) does not trigger Garoth');
  });

  await test('Audit LS: Lumina discards, then revives a Level 4 or lower Lightsworn from the GY, once per turn', async () => {
    const { g, c0, place } = setup();
    const lumina = place(0, cardByName('Lumina, Lightsworn Summoner'), 'mzone');
    const cel = place(0, cardByName('Celestia, Lightsworn Angel'), 'grave');
    const jain = place(0, cardByName('Jain, Lightsworn Paladin'), 'grave');
    const disc = place(0, T.brute, 'hand');
    place(0, T.wall, 'hand');
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      if (req.candidates.includes(jain) || req.candidates.includes(cel)) cands = req.candidates;
      if (req.candidates.includes(disc)) return [disc];
      return req.candidates.filter((c) => c === jain);
    };
    await activateCard(g, 0, lumina);
    eq(disc.location, 'grave', 'discarded');
    eq(jain.location, 'mzone', 'Jain revived');
    eq(cands.includes(cel), false, 'Level 5 Celestia not a target');
    place(0, cardByName('Ryko, Lightsworn Hunter'), 'grave');
    eq(offered(g, 0, lumina), false, 'once per turn');
  });

  await test('Audit LS: Ryko FLIP — the destruction is optional, the top 3 are sent either way', async () => {
    const { g, c0, place } = setup();
    const ryko = place(0, cardByName('Ryko, Lightsworn Hunter'), 'mzone', { faceUp: false, pos: 'def' });
    const opp = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    pickOnly(c0, [opp]);
    const before = deckLen(g, 0);
    g.turn += 1;
    await g.flipSummon(0, ryko);
    await g.processTriggers(true);
    eq(opp.location, 'grave', 'destroyed');
    eq(deckLen(g, 0), before - 3, 'sent 3');
    const n = setup();
    const r2 = n.place(0, cardByName('Ryko, Lightsworn Hunter'), 'mzone', { faceUp: false, pos: 'def' });
    const b2 = deckLen(n.g, 0);
    n.g.turn += 1;
    await n.g.flipSummon(0, r2);
    await n.g.processTriggers(true);
    eq(deckLen(n.g, 0), b2 - 3, 'sent 3 with nothing to destroy');
  });

  await test('Audit LS: Lyla goes to Defense Position to destroy a Spell/Trap and is locked in that position', async () => {
    const { g, c0, place } = setup();
    const lyla = place(0, cardByName('Lyla, Lightsworn Sorceress'), 'mzone');
    const st = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    pickOnly(c0, [st]);
    await activateCard(g, 0, lyla);
    eq(lyla.pos, 'def', 'Defense Position');
    eq(st.location, 'grave', 'Spell/Trap destroyed');
    eq(offered(g, 0, lyla), false, 'not again while in Defense Position');
    g.turn += 2;
    eq(g.legalMainActions(0).some((a) => a.type === 'position' && a.card === lyla), false, 'position locked through your next turn');
    g.turn += 2;
    eq(g.legalMainActions(0).some((a) => a.type === 'position' && a.card === lyla), true, 'free again the turn after');
  });

  await test('Audit LS: Judgment Dragon — pay 1000, destroy all other cards; not once per turn; Special Summon only from the hand', async () => {
    const { g, place } = setup();
    const jd = place(0, cardByName('Judgment Dragon'), 'mzone');
    const a = place(1, T.brute, 'mzone');
    const b = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    const mine = place(0, T.wall, 'mzone');
    await activateCard(g, 0, jd);
    eq(g.players[0].lp, 7000, 'paid 1000');
    eq([a.location, b.location, mine.location].join(), 'grave,grave,grave', 'all other cards destroyed');
    eq(jd.location, 'mzone', 'Judgment Dragon stays');
    place(1, T.brute, 'mzone');
    eq(offered(g, 0, jd), true, 'can activate again (no once-per-turn in 2010)');
    const r = setup();
    for (const n of ['Ryko, Lightsworn Hunter', 'Lumina, Lightsworn Summoner', 'Wulf, Lightsworn Beast', 'Lyla, Lightsworn Sorceress']) r.place(0, cardByName(n), 'grave');
    const jdg = r.place(0, cardByName('Judgment Dragon'), 'grave');
    eq(procOffered(r.g, 0, jdg), false, 'not from the GY');
    const jdh = r.place(0, cardByName('Judgment Dragon'), 'hand');
    eq(procOffered(r.g, 0, jdh), true, 'from the hand');
    eq(r.g.canNormalSummon(0, jdh, false), false, 'cannot be Normal Summoned');
  });

  await test('Audit LS: Jain gains 300 only when attacking a monster (not on a direct attack)', async () => {
    const { g, place } = setup();
    const jain = place(0, cardByName('Jain, Lightsworn Paladin'), 'mzone');
    const v = place(1, T.brute, 'mzone'); // 1800
    await g.conductAttack(0, jain);
    eq(v.location, 'grave', '2100 vs 1800');
    eq(g.players[1].lp, 7700, '300 damage');
    jain.attacksThisTurn = 0;
    await g.conductAttack(0, jain);
    eq(g.players[1].lp, 7700 - 1800, 'direct attack: 1800');
  });

  // ---- Blackwings
  await test('Audit BW: Kalut adds 1400 when your Blackwing battles (from the hand), not for a non-Blackwing', async () => {
    const { g, c0, place } = setup();
    const bora = place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    const kalut = place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'hand');
    const v = place(1, T.giant, 'mzone'); // 3000
    c0.respond = respondWith('Blackwing - Kalut the Moon Shadow');
    await g.conductAttack(0, bora);
    eq(kalut.location, 'grave', 'Kalut sent');
    eq(v.location, 'grave', '3100 beats 3000');
    eq(bora.location, 'mzone', 'Bora survives');
    const n = setup();
    const br = n.place(0, T.brute, 'mzone');
    const k2 = n.place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'hand');
    n.place(1, T.giant, 'mzone');
    n.c0.respond = respondWith('Blackwing - Kalut the Moon Shadow');
    await n.g.conductAttack(0, br);
    eq(k2.location, 'hand', 'not for a non-Blackwing');
  });

  await test('Audit BW: Gale / Bora Special Summon from the hand only with another face-up Blackwing; Gale halves ATK/DEF once per turn; Bora pierces', async () => {
    const { g, c0, place } = setup();
    const gale = place(0, cardByName('Blackwing - Gale the Whirlwind'), 'hand');
    const bora = place(0, cardByName('Blackwing - Bora the Spear'), 'hand');
    eq(procOffered(g, 0, gale), false, 'Gale: no other Blackwing');
    eq(procOffered(g, 0, bora), false, 'Bora: no other Blackwing');
    place(0, cardByName('Blackwing - Gale the Whirlwind'), 'mzone', { faceUp: false, pos: 'def' });
    eq(procOffered(g, 0, bora), false, 'a face-down Blackwing does not count');
    place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'mzone');
    eq(procOffered(g, 0, gale), true, 'Gale with Kalut');
    await g.performAction(0, g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === gale)!);
    eq(gale.location, 'mzone', 'Gale summoned');
    const v = place(1, T.brute, 'mzone'); // 1800/1000
    pickOnly(c0, [v]);
    await activateCard(g, 0, gale);
    eq(g.getAtk(v), 900, 'ATK halved');
    eq(g.getDef(v), 500, 'DEF halved');
    eq(offered(g, 0, gale), false, 'once per turn');
    const p = setup();
    p.place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'mzone');
    const b2 = p.place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    p.place(1, T.dark, 'mzone', { pos: 'def' }); // DEF 1200
    await p.g.conductAttack(0, b2);
    eq(p.g.players[1].lp, 8000 - 500, 'Bora inflicts piercing damage');
  });

  await test('Audit BW: Shura — after destroying a monster by battle, Special Summons a Blackwing with 1500 or less ATK from the Deck (effects negated); not Blizzard', async () => {
    const { g, c0, place } = setup();
    const shura = place(0, cardByName('Blackwing - Shura the Blue Flame'), 'mzone');
    const gale = deckCard(g, 0, 'Blackwing - Gale the Whirlwind');
    const bliz = deckCard(g, 0, 'Blackwing - Blizzard the Far North');
    const bora = deckCard(g, 0, 'Blackwing - Bora the Spear');
    place(1, T.wall, 'mzone'); // 500 ATK, Attack Position
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      cands = req.candidates;
      return req.candidates.filter((c) => c === gale);
    };
    await g.conductAttack(0, shura);
    eq(gale.location, 'mzone', 'Gale summoned');
    eq(g.isNegated(gale), true, 'effects negated');
    eq(cands.includes(bliz), false, 'Blizzard cannot be Special Summoned');
    eq(cands.includes(bora), false, 'Bora (1700) too strong');
  });

  await test('Audit BW: Sirocco — Normal Summon without Tributing only if just the opponent controls a monster; gather ATK; only that monster can attack', async () => {
    const { g, c0, place } = setup();
    const sir = place(0, cardByName('Blackwing - Sirocco the Dawn'), 'hand');
    eq(g.legalMainActions(0).some((a) => a.type === 'summon' && a.card === sir), false, 'no Tribute-free summon with no monsters at all');
    place(1, T.brute, 'mzone');
    eq(g.legalMainActions(0).some((a) => a.type === 'summon' && a.card === sir), true, 'Tribute-free summon when only the opponent controls a monster');
    await g.normalSummon(0, sir, false);
    eq(sir.location, 'mzone', 'Summoned without Tributing');
    const bora = place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    const other = place(0, T.wall, 'mzone');
    pickOnly(c0, [bora]);
    await activateCard(g, 0, sir);
    eq(g.getAtk(bora), 1700 + 2000, 'Bora gains Sirocco ATK');
    eq(g.canAttack(sir), false, 'Sirocco cannot attack');
    eq(g.canAttack(other), false, 'other monsters cannot attack');
    eq(g.canAttack(bora), true, 'target can attack');
    eq(offered(g, 0, sir), false, 'once per turn');
  });

  await test('Audit BW: Blizzard — on Normal Summon revives a Level 4 or lower Blackwing in Defense; cannot be Special Summoned; not on a Flip Summon', async () => {
    const { g, c0, place } = setup();
    const bora = place(0, cardByName('Blackwing - Bora the Spear'), 'grave');
    const sir = place(0, cardByName('Blackwing - Sirocco the Dawn'), 'grave');
    const bliz = place(0, cardByName('Blackwing - Blizzard the Far North'), 'hand');
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      cands = req.candidates;
      return req.candidates.filter((c) => c === bora);
    };
    await g.normalSummon(0, bliz, false);
    eq(bora.location, 'mzone', 'Bora revived');
    eq(bora.pos, 'def', 'in Defense Position');
    eq(cands.includes(sir), false, 'Level 5 Sirocco not a target');
    const r = setup();
    r.place(0, cardByName('Blackwing - Blizzard the Far North'), 'grave');
    eq(offered(r.g, 0, r.place(0, cardByName('Monster Reborn'), 'hand')), false, 'Monster Reborn cannot revive Blizzard');
    const f = setup();
    const kal = f.place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'grave');
    const b3 = f.place(0, cardByName('Blackwing - Blizzard the Far North'), 'hand');
    await f.g.normalSummon(0, b3, true);
    f.g.turn += 2;
    await f.g.flipSummon(0, b3);
    await f.g.processTriggers(true);
    eq(kal.location, 'grave', 'no revive on a Flip Summon');
  });

  await test('Audit BW: Black Whirlwind searches a Blackwing with less ATK on a Normal Summon only', async () => {
    const { g, c0, place } = setup();
    live(place(0, cardByName('Black Whirlwind'), 'szone', { faceUp: true }));
    const gale = deckCard(g, 0, 'Blackwing - Gale the Whirlwind'); // 1300
    const shura = deckCard(g, 0, 'Blackwing - Shura the Blue Flame'); // 1800
    const bora2 = deckCard(g, 0, 'Blackwing - Bora the Spear'); // 1700 (equal)
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      cands = req.candidates;
      return req.candidates.filter((c) => c === gale);
    };
    await g.normalSummon(0, place(0, cardByName('Blackwing - Bora the Spear'), 'hand'), false);
    eq(gale.location, 'hand', 'Gale added');
    eq(cands.includes(shura) || cands.includes(bora2), false, 'only strictly less ATK');
    const s = setup();
    live(s.place(0, cardByName('Black Whirlwind'), 'szone', { faceUp: true }));
    s.place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'mzone');
    const g2 = deckCard(s.g, 0, 'Blackwing - Gale the Whirlwind');
    const bh = s.place(0, cardByName('Blackwing - Bora the Spear'), 'hand');
    await s.g.performAction(0, s.g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === bh)!);
    eq(g2.location, 'deck', 'no search on a Special Summon');
  });

  await test('Audit BW: Icarus Attack Tributes a Winged Beast as a cost and destroys 2 targeted cards', async () => {
    const { g, c0, place } = setup();
    const ic = place(0, cardByName('Icarus Attack'), 'szone', { faceUp: false });
    const a = place(1, T.brute, 'mzone');
    const b = place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    eq(offered(g, 0, ic), false, 'not without a Winged Beast');
    const bora = place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    pickOnly(c0, [bora, a, b]);
    await activateCard(g, 0, ic);
    eq(bora.location, 'grave', 'Tributed');
    eq(a.location, 'grave', 'monster destroyed');
    eq(b.location, 'grave', 'Set card destroyed');
  });

  await test('Audit BW: Armor Master is not destroyed by battle, takes no battle damage, and wedges the monster it battled', async () => {
    const { g, place } = setup();
    const am = place(0, cardByName('Blackwing Armor Master'), 'mzone');
    const v = place(1, T.giant, 'mzone');
    await g.conductAttack(0, am);
    eq(am.location, 'mzone', 'not destroyed');
    eq(g.players[0].lp, 8000, 'no battle damage');
    eq(v.counters.wedge, 1, 'Wedge Counter placed');
    await activateCard(g, 0, am, 'Remove Wedge Counters');
    eq(g.getAtk(v), 0, 'ATK 0');
    eq(g.getDef(v), 0, 'DEF 0');
  });

  await test('Audit BW: Sirocco — a monster Summoned after the effect resolved cannot attack either (fixed)', async () => {
    const { g, c0, place } = setup();
    const sir = place(0, cardByName('Blackwing - Sirocco the Dawn'), 'mzone');
    place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'mzone');
    pickOnly(c0, [sir]);
    await activateCard(g, 0, sir);
    const late = place(0, T.brute, 'hand');
    await g.normalSummon(0, late, false);
    eq(g.canAttack(late), false, 'a monster summoned after the effect cannot attack either');
  });

  await test('Audit BW: Vayu on the field cannot be used as Synchro Material', async () => {
    const { g, place } = setup();
    place(0, cardByName('Blackwing - Vayu the Emblem of Honor'), 'mzone');
    place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    place(0, cardByName('Blackwing - Gale the Whirlwind'), 'mzone');
    const am = place(0, cardByName('Blackwing Armor Master'), 'extra');
    eq(g.canSynchro(0, am), true, 'Gale + Bora = 7');
    const r = setup();
    r.place(0, cardByName('Blackwing - Vayu the Emblem of Honor'), 'mzone');
    r.place(0, cardByName('Blackwing - Sirocco the Dawn'), 'mzone');
    r.place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'mzone');
    const aw = r.place(0, cardByName('Blackwing Armed Wing'), 'extra');
    eq(r.g.canSynchro(0, aw), false, 'Vayu + Sirocco not usable');
  });

  await test('Audit LS: Judgment Dragon can be revived only after it was properly Summoned', async () => {
    const { g, c0, place } = setup();
    for (const n of ['Ryko, Lightsworn Hunter', 'Lumina, Lightsworn Summoner', 'Wulf, Lightsworn Beast', 'Lyla, Lightsworn Sorceress']) place(0, cardByName(n), 'grave');
    const jd = place(0, cardByName('Judgment Dragon'), 'hand');
    await g.performAction(0, g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === jd)!);
    eq(jd.location, 'mzone', 'summoned');
    await g.destroy([jd], 'effect', 1);
    pickOnly(c0, [jd]);
    eq(offered(g, 0, place(0, cardByName('Monster Reborn'), 'hand')), true, 'properly summoned JD can be revived');
    const d = setup();
    d.place(0, cardByName('Judgment Dragon'), 'grave');
    eq(offered(d.g, 0, d.place(0, cardByName('Monster Reborn'), 'hand')), false, 'not if never properly summoned');
  });

  await test('Audit BW: Armor Master wedges only a monster it attacked; defending it still takes no damage and survives (fixed)', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const am = place(0, cardByName('Blackwing Armor Master'), 'mzone');
    const v = place(1, T.giant, 'mzone');
    await g.conductAttack(1, v);
    eq(am.location, 'mzone', 'not destroyed');
    eq(g.players[0].lp, 8000, 'no damage');
    eq(v.counters.wedge ?? 0, 0, 'attacked by the opponent: no Wedge Counter');
  });

  await test('Audit: Royal Decree negates other face-up Trap effects (Mirror Force)', async () => {
    const { g, c1, place } = setup();
    live(place(0, cardByName('Royal Decree'), 'szone', { faceUp: true }));
    const a = place(0, T.brute, 'mzone');
    place(1, cardByName('Mirror Force'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mirror Force');
    await g.conductAttack(0, a);
    eq(a.location, 'mzone', 'Mirror Force negated');
    eq(g.players[1].lp, 8000 - 1800, 'direct attack goes through');
  });
}

// ---------------------------------------------------------------- HERO / Dark Armed Dragon / Psychic / Reptilianne audit

async function heroDadPsychicAuditTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const doProc = async (g: Game, p: PlayerId, card: CardInstance) => {
    const a = g.legalMainActions(p).find((x) => x.type === 'proc' && x.card === card);
    if (!a) throw new Error(`${card.name}: no Summon procedure offered`);
    await g.performAction(p, a);
  };
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };
  /** Record every candidate list offered to this controller (and pick the first `min`). */
  const recordPicks = (c: TestController) => {
    const seen: CardInstance[][] = [];
    c.pick = (_g, req) => {
      seen.push([...req.candidates]);
      return req.candidates.slice(0, req.min);
    };
    return seen;
  };

  // ---- Dark Armed Dragon engine
  await test('Dark Armed Dragon: Special Summon only from the hand with EXACTLY 3 DARK monsters in the GY; never Normal Summoned', async () => {
    const { g, place } = setup();
    const dad = place(0, cardByName('Dark Armed Dragon'), 'hand');
    place(0, T.dark, 'grave');
    place(0, T.dark, 'grave');
    place(0, T.brute, 'grave');
    eq(procOffered(g, 0, dad), false, '2 DARK (+1 EARTH) in GY');
    const third = place(0, T.dark, 'grave');
    eq(procOffered(g, 0, dad), true, 'exactly 3 DARK');
    place(0, T.dark, 'grave');
    eq(procOffered(g, 0, dad), false, '4 DARK in GY');
    eq(g.canNormalSummon(0, dad, false) || g.canNormalSummon(0, dad, true), false, 'cannot be Normal Summoned/Set');
    void third;
    const s = setup();
    const inGy = s.place(0, cardByName('Dark Armed Dragon'), 'grave');
    s.place(0, T.dark, 'grave');
    s.place(0, T.dark, 'grave');
    eq(procOffered(s.g, 0, inGy), false, 'not from the GY (3 DARK counting itself)');
  });

  await test('Dark Armed Dragon: banish 1 DARK from the GY (cost), target 1 card; usable more than once per turn', async () => {
    const { g, c0, place } = setup();
    const dad = place(0, cardByName('Dark Armed Dragon'), 'hand');
    const d1 = place(0, T.dark, 'grave');
    const d2 = place(0, T.dark, 'grave');
    const d3 = place(0, T.dark, 'grave');
    await doProc(g, 0, dad);
    eq(dad.location, 'mzone', 'summoned');
    eq(dad.properlySummoned, true, 'properly Summoned');
    const mon = place(1, T.brute, 'mzone');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    pickOnly(c0, [d1, mon]);
    await activateCard(g, 0, dad);
    eq(d1.location, 'banished', 'DARK banished');
    eq(mon.location, 'grave', 'monster destroyed');
    pickOnly(c0, [d2, st]);
    await activateCard(g, 0, dad);
    eq(d2.location, 'banished', 'second DARK banished');
    eq(st.location, 'grave', 'Set card destroyed (second use this turn)');
    eq(d3.location, 'grave', 'only one DARK banished per use');
  });

  await test('Dark Grepher: Special Summon by discarding a Level 5+ DARK (not Level 4); once per turn discard a DARK to send a DARK from the Deck', async () => {
    const { g, c0, place } = setup();
    const grepher = place(0, cardByName('Dark Grepher'), 'hand');
    const lv4 = place(0, T.dark, 'hand');
    eq(procOffered(g, 0, grepher), false, 'a Level 4 DARK cannot pay');
    const mal = place(0, cardByName('Destiny Hero - Malicious'), 'hand');
    pickOnly(c0, [mal]);
    await doProc(g, 0, grepher);
    eq(grepher.location, 'mzone', 'Grepher Special Summoned');
    eq(mal.location, 'grave', 'Malicious discarded');
    eq(g.players[0].normalSummonsLeft, 1, 'Normal Summon not used');
    const ak = deckCard(g, 0, 'Armageddon Knight');
    deckCard(g, 0, 'Krebons');
    pickOnly(c0, [lv4, ak]);
    await activateCard(g, 0, grepher);
    eq(lv4.location, 'grave', 'DARK discarded');
    eq(ak.location, 'grave', 'DARK sent from the Deck');
    place(0, T.dark, 'hand');
    eq(offered(g, 0, grepher), false, 'once per turn');
  });

  await test('Armageddon Knight: when Normal Summoned, send 1 DARK monster from the Deck to the GY', async () => {
    const { g, c0, place } = setup();
    const ak = place(0, cardByName('Armageddon Knight'), 'hand');
    const mal = deckCard(g, 0, 'Destiny Hero - Malicious');
    pickOnly(c0, [mal]);
    await g.normalSummon(0, ak, false);
    eq(mal.location, 'grave', 'Malicious milled');
  });

  await test('Destiny HERO - Malicious: banish from the GY to Special Summon another from the Deck, in the position you choose', async () => {
    const { g, c0, place } = setup();
    const mal = place(0, cardByName('Destiny Hero - Malicious'), 'grave');
    eq(offered(g, 0, mal), false, 'no copy in the Deck: not offered');
    const mal2 = deckCard(g, 0, 'Destiny Hero - Malicious');
    let asked = false;
    c0.choosePosition = async (_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) => {
      asked = allowed.includes('atk') && allowed.includes('def');
      return 'atk';
    };
    await activateCard(g, 0, mal);
    eq(mal.location, 'banished', 'banished as cost');
    eq(mal2.location, 'mzone', 'second copy Special Summoned');
    eq(asked, true, 'player chose the position');
    eq(mal2.pos, 'atk', 'Attack Position allowed');
  });

  await test('Emergency Teleport: Level 3 or lower Psychic from hand/Deck only; banished in the End Phase', async () => {
    const { g, c0, place } = setup();
    const kreb = deckCard(g, 0, 'Krebons');
    deckCard(g, 0, 'Telekinetic Shocker');
    deckCard(g, 0, 'Psychic Commander');
    const seen = recordPicks(c0);
    pickOnly(c0, [kreb]);
    const inner = c0.pick;
    c0.pick = (gg, req) => (seen.push([...req.candidates]), inner(gg, req));
    await activateCard(g, 0, place(0, cardByName('Emergency Teleport'), 'hand'));
    eq(seen.flat().some((c) => c.name === 'Psychic Commander'), true, 'Level 3 Psychic offered');
    eq(seen.flat().some((c) => c.name === 'Telekinetic Shocker'), false, 'a Level 4 Psychic is not a candidate');
    eq(kreb.location, 'mzone', 'Krebons Special Summoned');
    await (g as any).setPhase('end');
    eq(kreb.location, 'banished', 'banished during the End Phase');
  });

  await test('Krebons: pay 800 LP to negate an attack that targets it', async () => {
    const { g, place } = setup();
    const kreb = place(0, cardByName('Krebons'), 'mzone');
    const att = place(1, T.brute, 'mzone');
    g.turnPlayer = 1;
    g.phase = 'battle';
    await g.conductAttack(1, att);
    eq(kreb.location, 'mzone', 'Krebons survives');
    eq(g.players[0].lp, 8000 - 800, 'paid 800 LP only');
  });

  await test('Allure of Darkness: draw 2 then banish a DARK from the hand; with none, the whole hand goes to the GY', async () => {
    const { g, place } = setup();
    deckCard(g, 0, 'Krebons');
    deckCard(g, 0, 'Rules Test Wall');
    await activateCard(g, 0, place(0, cardByName('Allure of Darkness'), 'hand'));
    eq(g.players[0].banished.some((c) => c.name === 'Krebons'), true, 'Krebons banished');
    eq(g.players[0].hand.length, 1, 'kept the other drawn card');
    const s = setup();
    const keep = s.place(0, T.brute, 'hand');
    await activateCard(s.g, 0, s.place(0, cardByName('Allure of Darkness'), 'hand'));
    eq(s.g.players[0].hand.length, 0, 'no DARK: entire hand sent to the GY');
    eq(keep.location, 'grave', 'other hand card too');
  });

  await test('Gold Sarcophagus: the banished card arrives on your 2nd Standby Phase after activation, not the 1st', async () => {
    const { g, c0, place } = setup();
    const want = deckCard(g, 0, 'Dark Armed Dragon');
    pickOnly(c0, [want]);
    const t0 = g.turn;
    await activateCard(g, 0, place(0, cardByName('Gold Sarcophagus'), 'hand'));
    eq(want.location, 'banished', 'banished face-up');
    g.turn = t0 + 2;
    await (g as any).setPhase('standby');
    eq(want.location, 'banished', 'still banished on the 1st Standby Phase');
    g.turn = t0 + 4;
    await (g as any).setPhase('standby');
    eq(want.location, 'hand', 'added on the 2nd Standby Phase');
  });

  await test('Destiny Draw: discard a Destiny HERO as cost, draw 2; not without one', async () => {
    const { g, place } = setup();
    const dd = place(0, cardByName('Destiny Draw'), 'hand');
    place(0, T.dark, 'hand');
    eq(offered(g, 0, dd), false, 'no Destiny HERO in hand');
    const mal = place(0, cardByName('Destiny Hero - Malicious'), 'hand');
    await activateCard(g, 0, dd);
    eq(mal.location, 'grave', 'Malicious discarded');
    eq(g.players[0].hand.length, 3, 'drew 2');
  });

  // ---- Psychic
  await test('Magical Android: gains 600 LP per face-up Psychic you control in your End Phase only', async () => {
    const { g, place } = setup();
    live(place(0, cardByName('Magical Android'), 'mzone'));
    live(place(0, cardByName('Krebons'), 'mzone'));
    place(0, cardByName('Psychic Commander'), 'mzone', { faceUp: false, pos: 'def' });
    g.turnPlayer = 1;
    await (g as any).setPhase('end');
    eq(g.players[0].lp, 8000, "nothing in the opponent's End Phase");
    g.turnPlayer = 0;
    await (g as any).setPhase('end');
    eq(g.players[0].lp, 8000 + 1200, '2 face-up Psychics = 1200');
  });

  await test("Thought Ruler Archfiend: pay 1000 to negate and destroy a Spell that targets 1 Psychic", async () => {
    const { g, c0, place } = setup();
    live(place(0, cardByName('Thought Ruler Archfiend'), 'mzone'));
    const kreb = live(place(0, cardByName('Krebons'), 'mzone'));
    c0.respond = respondWith('Thought Ruler Archfiend');
    g.turnPlayer = 1;
    const bc = place(1, cardByName('Brain Control'), 'hand');
    const pick1 = (g as any).controllers[1] as TestController;
    pickOnly(pick1, [kreb]);
    await activateCard(g, 1, bc);
    eq(kreb.controller, 0, 'Krebons stays');
    eq(bc.location, 'grave', 'Brain Control destroyed');
    eq(g.players[0].lp, 8000 - 1000, 'paid 1000');
  });

  // ---- HEROes
  await test('Elemental Hero Stratos: search a HERO; with another face-up HERO, destroy up to that many Spells/Traps', async () => {
    const { g, place } = setup();
    const ocean = deckCard(g, 0, 'Elemental Hero Ocean');
    await g.normalSummon(0, place(0, cardByName('Elemental Hero Stratos'), 'hand'), false);
    eq(ocean.location, 'hand', 'no other HERO: searched');
    const s = setup();
    live(s.place(0, cardByName('Elemental Hero Wildheart'), 'mzone'));
    const st1 = s.place(1, cardByName('Mirror Force'), 'szone');
    const st2 = s.place(1, cardByName('Torrential Tribute'), 'szone');
    s.c0.pick = (_g, req) => req.candidates.slice(0, req.max);
    await s.g.normalSummon(0, s.place(0, cardByName('Elemental Hero Stratos'), 'hand'), false);
    eq([st1, st2].filter((c) => c.location === 'grave').length, 1, '1 other HERO = up to 1 Spell/Trap');
  });

  await test('E - Emergency Call searches an Elemental HERO only (not a Destiny HERO)', async () => {
    const { g, c0, place } = setup();
    deckCard(g, 0, 'Destiny Hero - Malicious');
    deckCard(g, 0, 'Elemental Hero Ocean');
    const bub = deckCard(g, 0, 'Elemental Hero Bubbleman');
    const seen = recordPicks(c0);
    pickOnly(c0, [bub]);
    const inner = c0.pick;
    c0.pick = (gg, req) => (seen.push([...req.candidates]), inner(gg, req));
    await activateCard(g, 0, place(0, cardByName('E - Emergency Call'), 'hand'));
    eq(seen.flat().some((c) => c.name === 'Elemental Hero Ocean'), true, 'Elemental HEROes offered');
    eq(seen.flat().some((c) => c.name === 'Destiny Hero - Malicious'), false, 'Malicious is not an Elemental HERO');
    eq(bub.location, 'hand', 'Bubbleman added');
  });

  await test('Elemental Hero Absolute Zero: +500 per other face-up WATER except "Absolute Zero"; leaving the field destroys all opponent monsters', async () => {
    const { g, place } = setup();
    const az = live(place(0, cardByName('Elemental Hero Absolute Zero'), 'mzone'));
    live(place(1, cardByName('Elemental Hero Absolute Zero'), 'mzone'));
    live(place(0, cardByName('Elemental Hero Ocean'), 'mzone'));
    eq(g.getAtk(az), 3000, 'counts Ocean, not the other Absolute Zero');
    const s = setup();
    const az2 = live(s.place(0, cardByName('Elemental Hero Absolute Zero'), 'mzone'));
    const a = s.place(1, T.brute, 'mzone');
    const b = s.place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await s.g.destroy([az2], 'effect', 1);
    await s.g.processTriggers(true);
    eq(a.location, 'grave', 'face-up monster destroyed');
    eq(b.location, 'grave', 'face-down monster destroyed');
  });

  await test('Hero Signal: when your monster is destroyed by battle, Special Summon a Level 4 or lower Elemental HERO from the Deck', async () => {
    const { g, c0, place } = setup();
    place(0, T.wall, 'mzone');
    const sig = place(0, cardByName('Hero Signal'), 'szone');
    const strat = deckCard(g, 0, 'Elemental Hero Stratos');
    const att = place(1, T.giant, 'mzone');
    c0.respond = respondWith('Hero Signal');
    g.turnPlayer = 1;
    g.phase = 'battle';
    await g.conductAttack(1, att);
    eq(sig.location, 'grave', 'Hero Signal activated');
    eq(strat.location, 'mzone', 'Stratos Special Summoned from the Deck');
  });

  await test('Elemental Hero Bubbleman: Special Summon only as the sole card in hand; draws 2 with no other cards', async () => {
    const { g, place } = setup();
    const bub = place(0, cardByName('Elemental Hero Bubbleman'), 'hand');
    const other = place(0, T.brute, 'hand');
    eq(procOffered(g, 0, bub), false, 'not with another card in hand');
    await g.moveCards([other], 'grave', { reason: 'effect', reasonPlayer: 0 });
    eq(procOffered(g, 0, bub), true, 'only card in hand');
    await doProc(g, 0, bub);
    eq(bub.location, 'mzone', 'Special Summoned');
    eq(g.players[0].hand.length, 2, 'drew 2');
  });

  // ---- Generic staples in these decks
  await test('Brain Control: only a monster that can be Normal Summoned/Set (not Synchro/Fusion or Dark Armed Dragon)', async () => {
    const { g, c0, place } = setup();
    const bc = place(0, cardByName('Brain Control'), 'hand');
    live(place(1, cardByName('Stardust Dragon'), 'mzone'));
    live(place(1, cardByName('Dark Armed Dragon'), 'mzone'));
    eq(offered(g, 0, bc), false, 'no legal target');
    const ok = live(place(1, T.brute, 'mzone'));
    const seen = recordPicks(c0);
    await activateCard(g, 0, bc);
    eq(seen.flat().every((c) => c === ok), true, 'only the Normal-Summonable monster is a candidate');
    eq(ok.controller, 0, 'taken');
  });

  await test('Mind Control: can take a face-down monster; it cannot attack or be Tributed', async () => {
    const { g, place } = setup();
    const fd = place(1, T.brute, 'mzone', { faceUp: false, pos: 'def' });
    await activateCard(g, 0, place(0, cardByName('Mind Control'), 'hand'));
    eq(fd.controller, 0, 'taken');
    fd.faceUp = true;
    fd.pos = 'atk';
    eq(g.canAttack(fd), false, 'cannot attack');
    eq(g.tributeCandidates(0).includes(fd), false, 'cannot be Tributed');
  });

  await test('Morphing Jar: FLIP — both players discard their hands, then each draws 5', async () => {
    const { g, place } = setup();
    const jar = place(0, cardByName('Morphing Jar'), 'mzone', { faceUp: false, pos: 'def' });
    const h0 = place(0, T.brute, 'hand');
    const h1 = place(1, T.brute, 'hand');
    place(1, T.brute, 'hand');
    await g.flipSummon(0, jar);
    eq(h0.location, 'grave', 'my hand discarded');
    eq(h1.location, 'grave', "opponent's hand discarded");
    eq(g.players[0].hand.length, 5, 'I drew 5');
    eq(g.players[1].hand.length, 5, 'opponent drew 5');
  });

  // ---- Reptilianne / Diva
  await test('Reptilianne Viper: Normal Summon takes control of a face-up 0-ATK monster permanently', async () => {
    const { g, place } = setup();
    const naga = live(place(1, cardByName('Reptilianne Naga'), 'mzone'));
    await g.normalSummon(0, place(0, cardByName('Reptilianne Viper'), 'hand'), false);
    eq(naga.controller, 0, 'taken');
    await (g as any).setPhase('end');
    eq(naga.controller, 0, 'not returned in the End Phase');
  });

  await test('Deep Sea Diva: Normal Summon Special Summons a Level 3 or lower Sea Serpent from the Deck', async () => {
    const { g, place } = setup();
    const gill = deckCard(g, 0, 'Spined Gillman');
    await g.normalSummon(0, place(0, cardByName('Deep Sea Diva'), 'hand'), false);
    eq(gill.location, 'mzone', 'Spined Gillman Special Summoned');
  });
}

// ---------------------------------------------------------------- Pre-tournament audit: Plants / Sabers / Six Samurai / Cats

async function plantSaberSamuraiAuditTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
    g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
  const procOffered = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).some((a) => a.type === 'proc' && a.card === card);
  const doProc = async (g: Game, p: PlayerId, card: CardInstance) => {
    const a = g.legalMainActions(p).find((x) => x.type === 'proc' && x.card === card);
    if (!a) throw new Error(`${card.name}: no Summon procedure offered`);
    await g.performAction(p, a);
  };
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = req.candidates.filter((x) => want.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };

  // ---- Quickdraw Plant / Dandywarrior
  await test('Quickdraw Synchron: Special Summon needs a monster sent from the hand (not a Spell); the monster goes to the GY', async () => {
    const { g, place } = setup();
    const qd = place(0, cardByName('Quickdraw Synchron'), 'hand');
    place(0, cardByName('Mystical Space Typhoon'), 'hand');
    eq(procOffered(g, 0, qd), false, 'only a Spell in hand: no Summon');
    const dandy = place(0, cardByName('Dandylion'), 'hand');
    await doProc(g, 0, qd);
    eq(qd.location, 'mzone', 'Quickdraw Special Summoned');
    eq(dandy.location, 'grave', 'Dandylion sent as the cost');
    eq(g.monsters(0).filter((m) => m.name === 'Fluff Token').length, 2, 'Dandylion triggered: 2 Fluff Tokens');
  });

  await test('Quickdraw Synchron: substitutes for a "Synchron" Tuner (Turbo Warrior yes), not material for Stardust Dragon', async () => {
    const { g, place } = setup();
    place(0, cardByName('Quickdraw Synchron'), 'mzone');
    place(0, cardByName('Lonefire Blossom'), 'mzone');
    const sd = place(0, cardByName('Stardust Dragon'), 'extra');
    eq(g.canSynchro(0, sd), false, '5 + 3 = 8 but Stardust Dragon lists no "Synchron" Tuner');
    const r = setup();
    r.place(0, cardByName('Quickdraw Synchron'), 'mzone');
    r.place(0, cardByName('Level Eater'), 'mzone');
    const tw = r.place(0, cardByName('Turbo Warrior'), 'extra');
    eq(r.g.canSynchro(0, tw), true, 'Quickdraw (5) + Level Eater (1) = Turbo Warrior');
  });

  await test('Lonefire Blossom: Tribute a face-up Plant to Special Summon a Plant from the Deck; once per turn', async () => {
    const { g, c0, place } = setup();
    const lf1 = place(0, cardByName('Lonefire Blossom'), 'mzone');
    const lf2 = place(0, cardByName('Lonefire Blossom'), 'mzone');
    const brute = place(0, T.brute, 'mzone');
    const ty = deckCard(g, 0, 'Tytannial, Princess of Camellias');
    pickOnly(c0, [lf2, ty]);
    await activateCard(g, 0, lf1);
    eq(lf2.location, 'grave', 'the other Lonefire was Tributed');
    eq(ty.location, 'mzone', 'Tytannial Special Summoned from the Deck');
    eq(brute.location, 'mzone', 'a non-Plant is never Tribute fodder');
    eq(offered(g, 0, lf1), false, 'once per turn');
  });

  await test('Dandylion: sent to the GY -> 2 Fluff Tokens in Defense; they cannot be Tributed for a Tribute Summon that turn', async () => {
    const { g, place } = setup();
    const dandy = place(0, cardByName('Dandylion'), 'hand');
    await g.discard([dandy], 'cost', 0);
    await g.processTriggers(true);
    const toks = g.monsters(0).filter((m) => m.name === 'Fluff Token');
    eq(toks.length, 2, '2 tokens');
    eq(toks.every((t) => t.pos === 'def'), true, 'in Defense Position');
    const lv4 = place(0, cardByName('Thunder King Rai-Oh'), 'hand');
    const lv6 = place(0, cardByName('Caius the Shadow Monarch'), 'hand');
    eq(g.legalMainActions(0).some((a) => a.type === 'summon' && a.card === lv6), false, 'Fluff Tokens are not Tribute Summon fodder this turn');
    eq(g.legalMainActions(0).some((a) => a.type === 'summon' && a.card === lv4), true, 'Level 4 still Normal Summonable');
  });

  await test('Tytannial: WIND; Tributes a Plant to negate and destroy a card that targets a face-up Plant', async () => {
    const { g, c0, c1, place } = setup();
    const ty = place(1, cardByName('Tytannial, Princess of Camellias'), 'mzone');
    eq(ty.data.attribute, 'WIND', 'printed Attribute');
    const lf = place(1, cardByName('Lonefire Blossom'), 'mzone');
    const bc = place(0, cardByName('Brain Control'), 'hand');
    c1.respond = respondWith('Tytannial, Princess of Camellias');
    pickOnly(c1, [lf]);
    pickOnly(c0, [ty]);
    await activateCard(g, 0, bc);
    eq(lf.location, 'grave', 'Lonefire Tributed as the cost');
    eq(bc.location, 'grave', 'Brain Control negated and destroyed');
    eq(ty.controller, 1, 'Tytannial not stolen');
  });

  await test('Level Eater: from the GY, lowers a Level 5+ monster by 1 and Special Summons itself', async () => {
    const { g, place } = setup();
    const le = place(0, cardByName('Level Eater'), 'grave');
    const qd = place(0, cardByName('Quickdraw Synchron'), 'mzone');
    await activateCard(g, 0, le);
    eq(le.location, 'mzone', 'Level Eater revived');
    eq(g.getLevel(qd), 4, 'Quickdraw is now Level 4');
    const n = setup();
    const le2 = n.place(0, cardByName('Level Eater'), 'grave');
    n.place(0, T.brute, 'mzone');
    eq(offered(n.g, 0, le2), false, 'no Level 5+ monster: not offered');
  });

  await test('Debris Dragon: Normal Summon revives a 500-or-less ATK monster in Attack Position with its effects negated', async () => {
    const { g, place } = setup();
    const debris = place(0, cardByName('Debris Dragon'), 'hand');
    const dandy = place(0, cardByName('Dandylion'), 'grave');
    await g.performAction(0, { type: 'summon', card: debris });
    eq(dandy.location, 'mzone', 'Dandylion revived');
    eq(dandy.pos, 'atk', 'in Attack Position');
    eq(g.isNegated(dandy), true, 'effects negated');
  });

  // ---- Caliber Cat
  await test('Rescue Cat: send it to Special Summon 2 Level 3 or lower Beasts from the Deck; they are destroyed in the End Phase', async () => {
    const { g, place } = setup();
    const cat = place(0, cardByName('Rescue Cat'), 'mzone');
    const a1 = deckCard(g, 0, 'X-Saber Airbellum');
    const a2 = deckCard(g, 0, 'X-Saber Airbellum');
    const dog = deckCard(g, 0, 'Flamvell Firedog'); // Beast, but Level 4
    await activateCard(g, 0, cat);
    eq(cat.location, 'grave', 'Rescue Cat sent as the cost');
    eq(a1.location, 'mzone', 'Airbellum 1 summoned');
    eq(a2.location, 'mzone', 'Airbellum 2 summoned');
    eq(dog.location, 'deck', 'Level 4 Beast not eligible');
    eq(g.isNegated(a1), false, '2010 text: effects are not negated');
    await (g as any).setPhase('end');
    eq(a1.location, 'grave', 'destroyed in the End Phase');
    eq(a2.location, 'grave', 'destroyed in the End Phase');
  });

  await test('Doomcaliber Knight: Fiend that cannot be Special Summoned; Tributes itself to negate a monster effect and destroy that monster', async () => {
    const { g, c1, place } = setup();
    const dk = place(1, cardByName('Doomcaliber Knight'), 'mzone');
    eq(dk.data.race, 'Fiend', 'printed Type');
    const trooper = place(0, cardByName('Card Trooper'), 'mzone');
    c1.respond = respondWith('Doomcaliber Knight');
    await activateCard(g, 0, trooper);
    eq(dk.location, 'grave', 'Doomcaliber Tributed');
    eq(trooper.location, 'grave', 'Card Trooper destroyed');
    const r = setup();
    r.place(0, cardByName('Doomcaliber Knight'), 'grave');
    const reborn = r.place(0, cardByName('Monster Reborn'), 'hand');
    eq(offered(r.g, 0, reborn), false, 'Monster Reborn cannot revive Doomcaliber Knight');
  });

  // ---- Fish OTK
  await test('Fishborg Blaster: discard to revive only while you control a face-up Level 3 or lower WATER monster', async () => {
    const { g, place } = setup();
    const fb = place(0, cardByName('Fishborg Blaster'), 'grave');
    const disc = place(0, T.brute, 'hand');
    eq(offered(g, 0, fb), false, 'no WATER monster: not offered');
    place(0, cardByName('Oyster Meister'), 'mzone');
    await activateCard(g, 0, fb);
    eq(fb.location, 'mzone', 'Fishborg revived');
    eq(disc.location, 'grave', 'discarded as the cost');
  });

  // ---- X-Sabers
  await test('XX-Saber Faultroll: Special Summon from the hand needs 2 face-up X-Sabers; revives a Level 4 or lower X-Saber once per turn', async () => {
    const { g, place } = setup();
    const ft = place(0, cardByName('XX-Saber Faultroll'), 'hand');
    place(0, cardByName('X-Saber Airbellum'), 'mzone');
    eq(procOffered(g, 0, ft), false, '1 X-Saber: no Summon');
    place(0, cardByName('X-Saber Galahad'), 'mzone', { faceUp: false, pos: 'def' });
    eq(procOffered(g, 0, ft), false, 'a face-down X-Saber does not count');
    place(0, cardByName('XX-Saber Emmersblade'), 'mzone');
    await doProc(g, 0, ft);
    eq(ft.location, 'mzone', 'Faultroll Special Summoned');
    const gal = place(0, cardByName('X-Saber Galahad'), 'grave');
    await activateCard(g, 0, ft);
    eq(gal.location, 'mzone', 'Galahad revived');
    eq(offered(g, 0, ft), false, 'once per turn');
  });

  await test('XX-Saber Gottoms: Level 9 from 1 Tuner + non-Tuner EARTH monsters (Faultroll + Airbellum); Tributes an X-Saber for a random discard', async () => {
    const { g, place } = setup();
    const got = place(0, cardByName('XX-Saber Gottoms'), 'extra');
    eq(got.data.level, 9, 'Level 9');
    const air = place(0, cardByName('X-Saber Airbellum'), 'mzone');
    const ft = place(0, cardByName('XX-Saber Faultroll'), 'mzone');
    eq(g.canSynchro(0, got), true, 'Faultroll (6) + Airbellum (3) = 9');
    await g.synchroSummon(0, got, [air, ft]);
    eq(got.location, 'mzone', 'Gottoms Synchro Summoned');
    const n = setup();
    const got2 = n.place(0, cardByName('XX-Saber Gottoms'), 'extra');
    n.place(0, cardByName('X-Saber Airbellum'), 'mzone');
    n.place(0, cardByName('Caius the Shadow Monarch'), 'mzone'); // DARK Level 6
    eq(n.g.canSynchro(0, got2), false, 'a non-EARTH non-Tuner cannot be used');
    const m = setup();
    const got3 = m.place(0, cardByName('XX-Saber Gottoms'), 'extra');
    m.place(0, cardByName('Dandylion'), 'mzone'); // EARTH non-X-Saber Level 3
    m.place(0, T.wall, 'mzone'); // EARTH non-X-Saber Level 4
    m.place(0, tuner, 'mzone'); // EARTH Tuner Level 2
    eq(m.g.canSynchro(0, got3), true, 'any EARTH non-Tuners work (Tuner 2 + Wall 4 + Dandylion 3 = 9)');
    const e = setup();
    const got4 = e.place(0, cardByName('XX-Saber Gottoms'), 'mzone');
    const fod = e.place(0, cardByName('X-Saber Airbellum'), 'mzone');
    const h = e.place(1, T.brute, 'hand');
    pickOnly(e.c0, [fod]);
    await activateCard(e.g, 0, got4);
    eq(fod.location, 'grave', 'X-Saber Tributed');
    eq(h.location, 'grave', "opponent's only card discarded");
  });

  await test("Gottoms' Emergency Call: needs a face-up X-Saber on the field; revives 2 X-Sabers from either GY to your field", async () => {
    const { g, c0, place } = setup();
    const call = place(0, cardByName("Gottoms' Emergency Call"), 'hand');
    const mine = place(0, cardByName('X-Saber Airbellum'), 'grave');
    const theirs = place(1, cardByName('XX-Saber Emmersblade'), 'grave');
    eq(offered(g, 0, call), false, 'no face-up X-Saber: cannot activate');
    place(1, cardByName('X-Saber Galahad'), 'mzone'); // the opponent's X-Saber counts ("on the field")
    pickOnly(c0, [mine, theirs]);
    await activateCard(g, 0, call);
    eq(mine.location, 'mzone', 'own GY X-Saber summoned');
    eq(theirs.location, 'mzone', "opponent's GY X-Saber summoned");
    eq(theirs.controller, 0, 'to your side of the field');
  });

  await test('X-Saber Airbellum: a direct attack that deals damage discards 1 random card; X-Saber Galahad is a Warrior', async () => {
    const { g, place } = setup();
    const air = place(0, cardByName('X-Saber Airbellum'), 'mzone');
    const h = place(1, T.brute, 'hand');
    g.phase = 'battle';
    await g.conductAttack(0, air);
    eq(g.players[1].lp, 8000 - 1600, 'direct damage');
    eq(h.location, 'grave', 'random discard');
    eq(cardByName('X-Saber Galahad').race, 'Warrior', 'Galahad printed Type: Warrior (Reinforcement of the Army target)');
  });

  // TODO(held, not confirmed for the April 2010 printing): Saber Slash's current text destroys face-up cards on EITHER
  // side, exactly as many as your face-up Attack Position X-Sabers, without targeting; ours targets up to that many
  // of the opponent's face-up cards.
  // await test('Saber Slash: destroys face-up cards on the field equal to the number of attacking X-Sabers', async () => {});

  // ---- Six Samurai
  await test('Gateway of the Six: 2 Bushido Counters per Summon, even when several Six Samurai are Special Summoned together', async () => {
    const { g, place } = setup();
    const gate = live(place(0, cardByName('Gateway of the Six'), 'szone'));
    const ssu = live(place(0, cardByName('Six Samurai United'), 'szone'));
    const a = place(0, cardByName('The Six Samurai - Kamon'), 'grave');
    const b = place(0, cardByName('The Six Samurai - Yaichi'), 'grave');
    await g.specialSummon([a, b], 0, { pos: 'atk' });
    await g.processTriggers(true);
    eq(a.location === 'mzone' && b.location === 'mzone', true, 'both summoned');
    eq(gate.counters.bushido ?? 0, 2, 'one Summon = 2 counters');
    eq(ssu.counters.bushido ?? 0, 1, 'United: 1 counter');
    const z = place(0, cardByName('The Six Samurai - Zanji'), 'hand');
    await g.performAction(0, { type: 'summon', card: z });
    eq(gate.counters.bushido ?? 0, 4, 'a Normal Summon adds 2 more');
    eq(ssu.counters.bushido ?? 0, 2, 'United: max 2');
  });

  await test('Hand of the Six Samurai needs another face-up Six Samurai; Enishi is Special Summoned by banishing 2 Six Samurai from the GY', async () => {
    const { g, c0, place } = setup();
    const hand = place(0, cardByName('Hand of the Six Samurai'), 'mzone');
    const v = place(1, T.brute, 'mzone');
    eq(offered(g, 0, hand), false, 'alone: not offered');
    const kamon = place(0, cardByName('The Six Samurai - Kamon'), 'mzone');
    pickOnly(c0, [kamon, v]);
    await activateCard(g, 0, hand);
    eq(kamon.location, 'grave', 'Kamon Tributed');
    eq(v.location, 'grave', 'target destroyed');
    const n = setup();
    const en = n.place(0, cardByName("Enishi, Shien's Chancellor"), 'hand');
    n.place(0, cardByName('The Six Samurai - Kamon'), 'grave');
    eq(procOffered(n.g, 0, en), false, '1 Six Samurai in the GY: no Summon');
    const y = n.place(0, cardByName('The Six Samurai - Yaichi'), 'grave');
    await doProc(n.g, 0, en);
    eq(en.location, 'mzone', 'Enishi Special Summoned');
    eq(y.location, 'banished', 'cost banished');
  });
}

// ---------------------------------------------------------------- Gladiator Beasts: deep audit (sequences)

async function gladiatorDeepTests() {
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  const deckCard = (g: Game, p: PlayerId, name: string) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, 'deck');
    return c;
  };
  const battleEnd = async (g: Game) => {
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };
  const procAct = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).find((a) => a.type === 'proc' && a.card === card);
  const pickOnly = (c: TestController, want: CardInstance[]) => {
    c.pick = (_g, req) => {
      const w = want.filter((x) => req.candidates.includes(x));
      return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
    };
  };
  /** Accept only the tag-out among optional triggers (mandatory ones never ask). */
  const onlyTagOut = (c: TestController) => {
    (c as any).confirmTrigger = async (_g: Game, _p: PlayerId, act: Activation) => act.label === 'Tag out';
  };
  const N = (name: string) => cardByName(name);

  await test('GB audit: card data matches the official text (Hoplomus, Retiari, Secutor, Laquari, Heraklinos)', async () => {
    const hop = N('Gladiator Beast Hoplomus');
    eq(`${hop.race}/${hop.atk}/${hop.def}`, 'Rock/700/2100', 'Hoplomus');
    const ret = N('Gladiator Beast Retiari');
    eq(`${ret.atk}/${ret.def}`, '1200/800', 'Retiari');
    const sec = N('Gladiator Beast Secutor');
    eq(`${sec.attribute}/${sec.race}/${sec.level}/${sec.atk}/${sec.def}`, 'WIND/Reptile/4/400/300', 'Secutor');
    eq(N('Gladiator Beast Laquari').race, 'Beast-Warrior', 'Laquari');
    const her = N('Gladiator Beast Heraklinos');
    eq(`${her.attribute}/${her.race}`, 'FIRE/Beast-Warrior', 'Heraklinos');
  });

  await test('GB audit: "Special Summoned by a Gladiator Beast effect" — tag-outs (2 at once) give Laquari 2100 / Hoplomus 2400; Monster Reborn, Call of the Haunted, Normal Summon do not', async () => {
    const a = setup();
    const laq = deckCard(a.g, 0, 'Gladiator Beast Laquari');
    const hop = deckCard(a.g, 0, 'Gladiator Beast Hoplomus');
    const best = a.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    const dar = a.place(0, N('Gladiator Beast Darius'), 'mzone');
    best.attackedThisTurnOrWasAttacked = true;
    dar.attackedThisTurnOrWasAttacked = true;
    pickOnly(a.c0, [laq, hop]);
    await battleEnd(a.g);
    eq(laq.location, 'mzone', 'Laquari tagged in');
    eq(hop.location, 'mzone', 'Hoplomus tagged in (each Beast tags out separately)');
    eq(a.g.getAtk(laq), 2100, 'Laquari 2100');
    eq(a.g.getDef(hop), 2400, 'Hoplomus 2400 DEF');
    eq(best.location, 'deck', 'Bestiari shuffled in');
    eq(dar.location, 'deck', 'Darius shuffled in');
    const r = setup();
    const l2 = r.place(0, N('Gladiator Beast Laquari'), 'grave');
    pickOnly(r.c0, [l2]);
    await activateCard(r.g, 0, r.place(0, N('Monster Reborn'), 'hand'));
    eq(l2.location, 'mzone', 'revived');
    eq(r.g.getAtk(l2), 1800, 'Monster Reborn: original 1800');
    const c = setup();
    const l3 = c.place(0, N('Gladiator Beast Laquari'), 'grave');
    const coth = c.place(0, N('Call of the Haunted'), 'szone');
    pickOnly(c.c0, [l3]);
    await activateCard(c.g, 0, coth);
    eq(l3.location, 'mzone', 'Call of the Haunted revived');
    eq(c.g.getAtk(l3), 1800, 'Call of the Haunted: 1800');
    const n = setup();
    const b4 = n.place(0, N('Gladiator Beast Bestiari'), 'hand');
    const st = n.place(1, N('Mirror Force'), 'szone');
    await n.g.normalSummon(0, b4, false);
    await n.g.processTriggers(true);
    eq(st.location, 'szone', 'Normal Summoned Bestiari: no destruction');
  });

  await test('GB audit: Bestiari / Murmillo / Equeste effects are mandatory (official text has no "You can")', async () => {
    const a = setup();
    const best = deckCard(a.g, 0, 'Gladiator Beast Bestiari');
    const laq = a.place(0, N('Gladiator Beast Laquari'), 'mzone');
    const own = a.place(0, N('Mirror Force'), 'szone');
    laq.attackedThisTurnOrWasAttacked = true;
    onlyTagOut(a.c0);
    pickOnly(a.c0, [best, own]);
    await battleEnd(a.g);
    eq(best.location, 'mzone', 'Bestiari tagged in');
    eq(own.location, 'grave', 'with only our own Set card on the field, Bestiari must destroy it');
    const m = setup();
    const mur = deckCard(m.g, 0, 'Gladiator Beast Murmillo');
    const l2 = m.place(0, N('Gladiator Beast Laquari'), 'mzone');
    l2.attackedThisTurnOrWasAttacked = true;
    const v = m.place(1, T.brute, 'mzone');
    onlyTagOut(m.c0);
    pickOnly(m.c0, [v, mur]);
    await battleEnd(m.g);
    eq(v.location, 'grave', 'Murmillo destroyed the face-up monster without being asked');
    const s = setup();
    const mur2 = deckCard(s.g, 0, 'Gladiator Beast Murmillo');
    const l3 = s.place(0, N('Gladiator Beast Laquari'), 'mzone');
    l3.attackedThisTurnOrWasAttacked = true;
    pickOnly(s.c0, [mur2]);
    await battleEnd(s.g);
    eq(mur2.location, 'grave', 'Murmillo, the only face-up monster, has to target and destroy itself');
    const e = setup();
    const equ = deckCard(e.g, 0, 'Gladiator Beast Equeste');
    const wc = e.place(0, N('Gladiator Beast War Chariot'), 'grave');
    const l4 = e.place(0, N('Gladiator Beast Laquari'), 'mzone');
    l4.attackedThisTurnOrWasAttacked = true;
    onlyTagOut(e.c0);
    pickOnly(e.c0, [equ, wc]);
    await battleEnd(e.g);
    eq(equ.location, 'mzone', 'Equeste tagged in');
    eq(wc.location, 'hand', 'Equeste added War Chariot');
  });

  await test('GB audit: Darius targets on activation — D.D. Crow in response leaves it with nothing; Necrovalley negates it', async () => {
    const a = setup();
    const dar = deckCard(a.g, 0, 'Gladiator Beast Darius');
    const best = a.place(0, N('Gladiator Beast Bestiari'), 'grave');
    const laq = a.place(0, N('Gladiator Beast Laquari'), 'mzone');
    laq.attackedThisTurnOrWasAttacked = true;
    const crow = a.place(1, N('D.D. Crow'), 'hand');
    let seen: CardInstance[] = [];
    a.c1.respond = (g, req) => {
      const top = g.chain[g.chain.length - 1];
      if (top?.card === dar) {
        seen = top.ctx.targets.slice();
        return req.options.find((o) => o.card === crow) ?? null;
      }
      return null;
    };
    pickOnly(a.c0, [dar, best]);
    pickOnly(a.c1, [best]);
    await battleEnd(a.g);
    eq(dar.location, 'mzone', 'Darius tagged in');
    eq(seen.includes(best), true, 'Bestiari was targeted when Darius activated');
    eq(best.location, 'banished', 'D.D. Crow banished the target');
    eq(a.g.monsters(0).length, 1, 'Darius revived nothing');
    const n = setup();
    const d2 = deckCard(n.g, 0, 'Gladiator Beast Darius');
    const b2 = n.place(0, N('Gladiator Beast Bestiari'), 'grave');
    const l2 = n.place(0, N('Gladiator Beast Laquari'), 'mzone');
    l2.attackedThisTurnOrWasAttacked = true;
    live(n.place(1, N('Necrovalley'), 'fzone'));
    pickOnly(n.c0, [d2, b2]);
    await battleEnd(n.g);
    eq(d2.location, 'mzone', 'Darius tagged in');
    eq(b2.location, 'grave', 'Necrovalley: Bestiari stays in the GY');
  });

  await test('GB audit: Darius tagging out returns its revived monster; Retiari banishes from the GY (Necrovalley stops it)', async () => {
    const a = setup();
    const dar = deckCard(a.g, 0, 'Gladiator Beast Darius');
    const laqG = a.place(0, N('Gladiator Beast Laquari'), 'grave');
    const ret = deckCard(a.g, 0, 'Gladiator Beast Retiari');
    const hop = a.place(0, N('Gladiator Beast Hoplomus'), 'mzone');
    hop.attackedThisTurnOrWasAttacked = true;
    pickOnly(a.c0, [dar, laqG]);
    await battleEnd(a.g);
    eq(laqG.location, 'mzone', 'Laquari revived by Darius');
    eq(a.g.getAtk(laqG), 1800, 'negated: no 2100');
    dar.attackedThisTurnOrWasAttacked = true;
    const og = a.place(1, T.brute, 'grave');
    pickOnly(a.c0, [ret, og]);
    await battleEnd(a.g);
    eq(dar.location, 'deck', 'Darius tagged out');
    eq(ret.location, 'mzone', 'Retiari tagged in');
    eq(laqG.location, 'deck', "Darius's revived Laquari shuffled into the Deck");
    eq(og.location, 'banished', 'Retiari banished a card from the GY');
    const n = setup();
    const r2 = deckCard(n.g, 0, 'Gladiator Beast Retiari');
    const l2 = n.place(0, N('Gladiator Beast Laquari'), 'mzone');
    l2.attackedThisTurnOrWasAttacked = true;
    const og2 = n.place(1, T.brute, 'grave');
    live(n.place(1, N('Necrovalley'), 'fzone'));
    pickOnly(n.c0, [r2, og2]);
    await battleEnd(n.g);
    eq(r2.location, 'mzone', 'Retiari tagged in');
    eq(og2.location, 'grave', 'Necrovalley: no banish');
  });

  await test('GB audit: tag-out needs another Gladiator Beast in the Deck; not after Book of Moon; not without battling', async () => {
    const a = setup();
    deckCard(a.g, 0, 'Gladiator Beast Bestiari');
    const best = a.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    best.attackedThisTurnOrWasAttacked = true;
    await battleEnd(a.g);
    eq(best.location, 'mzone', 'only another Bestiari in the Deck: no tag-out');
    const b = setup();
    const laq = deckCard(b.g, 0, 'Gladiator Beast Laquari');
    const b2 = b.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    b2.attackedThisTurnOrWasAttacked = true;
    await b.g.changePosition(b2, 'def', false);
    await battleEnd(b.g);
    eq(b2.location, 'mzone', 'face-down: stays');
    eq(laq.location, 'deck', 'face-down: no tag-out');
    const c = setup();
    const laq3 = deckCard(c.g, 0, 'Gladiator Beast Laquari');
    const b3 = c.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    await battleEnd(c.g);
    eq(b3.location, 'mzone', 'did not battle: stays');
    eq(laq3.location, 'deck', 'did not battle: no tag-out');
  });

  await test('GB audit: Gyzarus tag-out returns it to the Extra Deck and Special Summons 2 (not Bestiari); both arrivals get their effects', async () => {
    const { g, c0, place } = setup();
    const gyz = place(0, N('Gladiator Beast Gyzarus'), 'mzone');
    gyz.attackedThisTurnOrWasAttacked = true;
    const best = deckCard(g, 0, 'Gladiator Beast Bestiari');
    const laq = deckCard(g, 0, 'Gladiator Beast Laquari');
    const mur = deckCard(g, 0, 'Gladiator Beast Murmillo');
    const v = place(1, T.brute, 'mzone');
    pickOnly(c0, [v, best, laq, mur]);
    await battleEnd(g);
    eq(gyz.location, 'extra', 'Gyzarus returned to the Extra Deck');
    eq(best.location, 'deck', 'Bestiari cannot be summoned by it');
    eq(laq.location, 'mzone', 'Laquari');
    eq(mur.location, 'mzone', 'Murmillo');
    eq(g.getAtk(laq), 2100, 'Laquari 2100');
    eq(v.location, 'grave', 'Murmillo destroyed the opposing monster');
  });

  await test('GB audit: Secutor (official text) — only if Gladiator-Summoned: after battling it Special Summons 2 and stays; never with only 1 free zone', async () => {
    const a = setup();
    const sec = a.place(0, N('Gladiator Beast Secutor'), 'mzone');
    const laq = deckCard(a.g, 0, 'Gladiator Beast Laquari');
    deckCard(a.g, 0, 'Gladiator Beast Hoplomus');
    sec.attackedThisTurnOrWasAttacked = true;
    await battleEnd(a.g);
    eq(laq.location, 'deck', 'not Gladiator-Summoned: nothing');
    eq(sec.location, 'mzone', 'stays');
    const b = setup();
    const tiger = b.place(0, N('Test Tiger'), 'mzone');
    const laqF = b.place(0, N('Gladiator Beast Laquari'), 'mzone');
    const sec2 = deckCard(b.g, 0, 'Gladiator Beast Secutor');
    pickOnly(b.c0, [sec2, laqF]);
    await activateCard(b.g, 0, tiger);
    eq(sec2.location, 'mzone', 'Secutor tagged in by Test Tiger');
    const l2 = deckCard(b.g, 0, 'Gladiator Beast Laquari');
    const h2 = deckCard(b.g, 0, 'Gladiator Beast Hoplomus');
    sec2.attackedThisTurnOrWasAttacked = true;
    (b.c0 as any).confirmTrigger = async () => false;
    pickOnly(b.c0, [l2, h2]);
    await battleEnd(b.g);
    eq(l2.location, 'mzone', 'Laquari summoned (mandatory)');
    eq(h2.location, 'mzone', 'Hoplomus summoned');
    eq(sec2.location, 'mzone', 'Secutor stays on the field');
    eq(b.g.getAtk(l2), 2100, 'Summoned by a Gladiator Beast effect');
    const c = setup();
    const sec3 = c.place(0, N('Gladiator Beast Secutor'), 'mzone');
    sec3.flags.gbSummoned = true;
    sec3.attackedThisTurnOrWasAttacked = true;
    for (let i = 0; i < 3; i++) c.place(0, T.wall, 'mzone');
    const l3 = deckCard(c.g, 0, 'Gladiator Beast Laquari');
    deckCard(c.g, 0, 'Gladiator Beast Hoplomus');
    await battleEnd(c.g);
    eq(l3.location, 'deck', 'only 1 free zone: nothing');
  });

  await test('GB audit: contact fusion — Gyzarus with Prisma named Bestiari; Heraklinos with Prisma named Laquari; never with a face-down or un-named material', async () => {
    const a = setup();
    const prisma = a.place(0, N('Elemental Hero Prisma'), 'mzone');
    const gyz = a.place(0, N('Gladiator Beast Gyzarus'), 'extra');
    const best = deckCard(a.g, 0, 'Gladiator Beast Bestiari');
    const laq = a.place(0, N('Gladiator Beast Laquari'), 'mzone');
    eq(!!procAct(a.g, 0, gyz), false, 'no Bestiari yet');
    pickOnly(a.c0, [gyz, best]);
    await activateCard(a.g, 0, prisma);
    eq(best.location, 'grave', 'Prisma sent Bestiari');
    eq(prisma.name, 'Gladiator Beast Bestiari', 'Prisma named Bestiari');
    const st = a.place(1, N('Mirror Force'), 'szone');
    pickOnly(a.c0, [prisma, laq, st]);
    await a.g.performAction(0, procAct(a.g, 0, gyz)!);
    eq(gyz.location, 'mzone', 'Gyzarus contact-fused');
    eq(prisma.location, 'deck', 'Prisma shuffled in');
    eq(laq.location, 'deck', 'Laquari shuffled in');
    eq(st.location, 'grave', 'Gyzarus destroyed a card on Special Summon');
    const h = setup();
    const p2 = h.place(0, N('Elemental Hero Prisma'), 'mzone');
    const her = h.place(0, N('Gladiator Beast Heraklinos'), 'extra');
    const laqD = deckCard(h.g, 0, 'Gladiator Beast Laquari');
    h.place(0, N('Gladiator Beast Darius'), 'mzone');
    h.place(0, N('Gladiator Beast Hoplomus'), 'mzone', { pos: 'def' });
    pickOnly(h.c0, [her, laqD]);
    await activateCard(h.g, 0, p2);
    eq(p2.name, 'Gladiator Beast Laquari', 'Prisma named Laquari');
    await h.g.performAction(0, procAct(h.g, 0, her)!);
    eq(her.location, 'mzone', 'Heraklinos contact-fused');
    const f = setup();
    const gyz2 = f.place(0, N('Gladiator Beast Gyzarus'), 'extra');
    f.place(0, N('Gladiator Beast Bestiari'), 'mzone', { faceUp: false, pos: 'def' });
    f.place(0, N('Gladiator Beast Laquari'), 'mzone');
    eq(!!procAct(f.g, 0, gyz2), false, 'face-down Bestiari cannot be a material');
    const t = setup();
    const gyz3 = t.place(0, N('Gladiator Beast Gyzarus'), 'extra');
    t.place(0, N('Elemental Hero Prisma'), 'mzone');
    t.place(0, N('Gladiator Beast Laquari'), 'mzone');
    eq(!!procAct(t.g, 0, gyz3), false, 'un-named Prisma is not Bestiari');
  });

  await test('GB audit: Solemn Judgment negates a contact fusion (materials stay shuffled); Bottomless Trap Hole hits a tagged-in Laquari', async () => {
    const a = setup();
    a.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    a.place(0, N('Gladiator Beast Darius'), 'mzone');
    const gyz = a.place(0, N('Gladiator Beast Gyzarus'), 'extra');
    a.place(1, N('Solemn Judgment'), 'szone');
    a.c1.respond = respondWith('Solemn Judgment');
    await a.g.performAction(0, procAct(a.g, 0, gyz)!);
    eq(gyz.location, 'grave', 'Gyzarus negated and destroyed');
    eq(a.g.players[1].lp, 4000, 'half LP paid');
    eq(a.g.monsters(0).length, 0, 'materials were shuffled in as the summon procedure');
    const b = setup();
    const laq = deckCard(b.g, 0, 'Gladiator Beast Laquari');
    const best = b.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    best.attackedThisTurnOrWasAttacked = true;
    b.place(1, N('Bottomless Trap Hole'), 'szone');
    b.c1.respond = respondWith('Bottomless Trap Hole');
    await battleEnd(b.g);
    eq(laq.location, 'banished', 'Bottomless Trap Hole banished the 2100 Laquari');
  });

  await test('GB audit: Test Tiger tags out Prisma named Bestiari (Laquari still 2100) and Gyzarus (back to the Extra Deck)', async () => {
    const a = setup();
    const prisma = a.place(0, N('Elemental Hero Prisma'), 'mzone');
    a.place(0, N('Gladiator Beast Gyzarus'), 'extra');
    const best = deckCard(a.g, 0, 'Gladiator Beast Bestiari');
    pickOnly(a.c0, [best]);
    await activateCard(a.g, 0, prisma);
    const laq = deckCard(a.g, 0, 'Gladiator Beast Laquari');
    const tiger = a.place(0, N('Test Tiger'), 'hand');
    await a.g.performAction(0, procAct(a.g, 0, tiger)!);
    eq(tiger.location, 'mzone', 'Test Tiger summoned (Prisma is a Gladiator Beast by name)');
    pickOnly(a.c0, [prisma, laq]);
    await activateCard(a.g, 0, tiger);
    eq(prisma.location, 'deck', 'Prisma shuffled into the Deck');
    eq(laq.location, 'mzone', 'Laquari');
    eq(a.g.getAtk(laq), 2100, 'treated as Summoned by a Gladiator Beast effect');
    const b = setup();
    const gyz = b.place(0, N('Gladiator Beast Gyzarus'), 'mzone');
    const t2 = b.place(0, N('Test Tiger'), 'mzone');
    const mur = deckCard(b.g, 0, 'Gladiator Beast Murmillo');
    const v = b.place(1, T.brute, 'mzone');
    pickOnly(b.c0, [v, gyz, mur]);
    await activateCard(b.g, 0, t2);
    eq(gyz.location, 'extra', 'Gyzarus returned to the Extra Deck');
    eq(mur.location, 'mzone', 'Murmillo');
    eq(v.location, 'grave', 'Murmillo destroyed');
  });

  await test('GB audit: Heraklinos flipped face-down by Book of Moon in response does not negate', async () => {
    const { g, c0, c1, place } = setup();
    const her = place(1, N('Gladiator Beast Heraklinos'), 'mzone');
    place(1, T.wall, 'hand');
    place(1, T.brute, 'mzone');
    const bom = place(0, N('Book of Moon'), 'szone');
    const sm = place(0, N('Smashing Ground'), 'hand');
    c1.respond = (gg, req) => (gg.chain[gg.chain.length - 1]?.card === sm ? (req.options.find((o) => o.card === her) ?? null) : null);
    c0.respond = (gg, req) => (gg.chain[gg.chain.length - 1]?.card === her ? (req.options.find((o) => o.card === bom) ?? null) : null);
    pickOnly(c0, [her]);
    await activateCard(g, 0, sm);
    eq(her.faceUp, false, 'Heraklinos flipped face-down');
    eq(sm.location, 'grave', 'Smashing Ground resolved and went to the GY');
    eq(g.monsters(1).some((m) => m.location === 'grave') || g.monsters(1).length === 1, true, 'Smashing Ground destroyed a monster');
  });

  await test('GB audit: Samnite tagged in searches when it destroys a monster by battle; a Normal Summoned Samnite does not', async () => {
    const a = setup();
    const sam = deckCard(a.g, 0, 'Gladiator Beast Samnite');
    const laq = a.place(0, N('Gladiator Beast Laquari'), 'mzone');
    laq.attackedThisTurnOrWasAttacked = true;
    pickOnly(a.c0, [sam]);
    await battleEnd(a.g);
    eq(sam.location, 'mzone', 'Samnite tagged in');
    const wc = deckCard(a.g, 0, 'Gladiator Beast War Chariot');
    const v = a.place(1, T.dark, 'mzone', { pos: 'def' });
    pickOnly(a.c0, [wc]);
    a.g.phase = 'battle';
    await a.g.conductAttack(0, sam);
    eq(v.location, 'grave', 'destroyed by battle');
    eq(wc.location, 'hand', 'Samnite searched War Chariot');
    const n = setup();
    const s2 = n.place(0, N('Gladiator Beast Samnite'), 'hand');
    await n.g.normalSummon(0, s2, false);
    const wc2 = deckCard(n.g, 0, 'Gladiator Beast War Chariot');
    const v2 = n.place(1, T.dark, 'mzone', { pos: 'def' });
    n.g.phase = 'battle';
    await n.g.conductAttack(0, s2);
    eq(v2.location, 'grave', 'destroyed by battle');
    eq(wc2.location, 'deck', 'not Gladiator-Summoned: no search');
  });

  await test('GB audit: Gladiator Beast War Chariot negates Prisma (a monster effect) while you control a Gladiator Beast', async () => {
    const { g, c1, place } = setup();
    const prisma = place(0, N('Elemental Hero Prisma'), 'mzone');
    place(0, N('Gladiator Beast Gyzarus'), 'extra');
    const best = deckCard(g, 0, 'Gladiator Beast Bestiari');
    place(1, N('Gladiator Beast Laquari'), 'mzone');
    const wc = place(1, N('Gladiator Beast War Chariot'), 'szone');
    c1.respond = respondWith('Gladiator Beast War Chariot');
    await activateCard(g, 0, prisma);
    eq(wc.location, 'grave', 'War Chariot used');
    eq(prisma.location, 'grave', 'Prisma destroyed');
    eq(best.location, 'deck', 'nothing sent');
  });
}

// ---------------------------------------------------------------- Deck extras, wave 3 (tournament4 decks)

async function deckExtras3Tests() {
  const fish = findCard('Rules Test Fish') ?? normal('Rules Test Fish', 'WATER', 'Fish', 3, 1200, 800);
  const bigFish = findCard('Rules Test Big Fish') ?? normal('Rules Test Big Fish', 'WATER', 'Fish', 4, 1600, 800);
  const small = findCard('Rules Test Small') ?? normal('Rules Test Small', 'EARTH', 'Warrior', 3, 1400, 800);
  const dragon = findCard('Rules Test Wyrm') ?? normal('Rules Test Wyrm', 'WIND', 'Dragon', 4, 1500, 1000);
  const darkColossus = findCard('Rules Test Dark Colossus') ?? normal('Rules Test Dark Colossus', 'DARK', 'Fiend', 8, 6000, 0);
  const lightColossus = findCard('Rules Test Light Colossus') ?? normal('Rules Test Light Colossus', 'LIGHT', 'Fairy', 8, 6000, 0);

  await test('Salvage: adds 2 WATER monsters with 1500 or less ATK from the GY; needs 2', async () => {
    const { g, place } = setup();
    const sal = place(0, cardByName('Salvage'), 'hand');
    const a = place(0, fish, 'grave');
    place(0, bigFish, 'grave');
    eq(g.getActivations(0, { open: true }).some((x) => x.card === sal), false, 'not with only 1 eligible monster');
    const b = place(0, fish, 'grave');
    await activateCard(g, 0, sal);
    eq(a.location, 'hand', 'first added');
    eq(b.location, 'hand', 'second added');
  });

  await test('Terraforming: adds a Field Spell from the Deck', async () => {
    const { g, place } = setup();
    const tf = place(0, cardByName('Terraforming'), 'hand');
    const field = place(0, cardByName('Necrovalley'), 'deck');
    await activateCard(g, 0, tf);
    eq(field.location, 'hand', 'Necrovalley added');
  });

  await test('Volcanic Shell: pay 500 LP from the GY to add a Shell, once per turn', async () => {
    const { g, place } = setup();
    const gy = place(0, cardByName('Volcanic Shell'), 'grave');
    const d1 = place(0, cardByName('Volcanic Shell'), 'deck');
    place(0, cardByName('Volcanic Shell'), 'deck');
    await activateCard(g, 0, gy);
    eq(g.players[0].lp, 7500, 'paid 500 LP');
    eq(g.players[0].hand.filter((c) => c.name === 'Volcanic Shell').length, 1, 'a Shell added');
    void d1;
    eq(g.getActivations(0, { open: true }).some((x) => x.card === gy), false, 'only once per turn');
  });

  await test('King Tiger Wanghu: destroys a monster with 1400 or less ATK when it is Summoned', async () => {
    const { g, place } = setup();
    place(1, cardByName('King Tiger Wanghu'), 'mzone');
    const s = place(0, small, 'hand');
    await g.performAction(0, { type: 'summon', card: s });
    eq(s.location, 'grave', '1400 ATK monster destroyed');
    const b = setup();
    b.place(1, cardByName('King Tiger Wanghu'), 'mzone');
    const big = b.place(0, T.brute, 'hand');
    await b.g.performAction(0, { type: 'summon', card: big });
    eq(big.location, 'mzone', '1800 ATK monster stays');
  });

  await test('Tuningware: counts as Level 1 or 2 for a Synchro Summon and draws 1', async () => {
    const { g, place } = setup();
    const brionac = place(0, cardByName('Brionac, Dragon of the Ice Barrier'), 'extra');
    const tw = place(0, cardByName('Tuningware'), 'mzone');
    place(0, T.brute, 'mzone');
    eq(g.canSynchro(0, brionac), true, 'Level 2 + Level 4 = Brionac (6)');
    const hand = g.players[0].hand.length;
    await g.performAction(0, { type: 'synchro', card: brionac });
    eq(brionac.location, 'mzone', 'Brionac Synchro Summoned');
    eq(tw.location, 'grave', 'Tuningware used');
    eq(g.players[0].hand.length, hand + 1, 'drew 1 card');
  });

  await test('Five-Headed Dragon: only a LIGHT monster destroys it in battle; Future Fusion sends 5 Dragons', async () => {
    const { g, place } = setup();
    const fhd = place(1, cardByName('Five-Headed Dragon'), 'mzone');
    await g.conductAttack(0, place(0, darkColossus, 'mzone'));
    eq(fhd.location, 'mzone', 'survives a DARK 6000');
    const b = setup();
    const fhd2 = b.place(1, cardByName('Five-Headed Dragon'), 'mzone');
    await b.g.conductAttack(0, b.place(0, lightColossus, 'mzone'));
    eq(fhd2.location, 'grave', 'destroyed by a LIGHT 6000');

    const c = setup();
    c.place(0, cardByName('Five-Headed Dragon'), 'extra');
    const ds = [0, 1, 2, 3, 4].map(() => c.place(0, dragon, 'deck'));
    const ff = c.place(0, cardByName('Future Fusion'), 'hand');
    await activateCard(c.g, 0, ff);
    eq(ds.every((d) => d.location === 'grave'), true, '5 Dragons sent from the Deck');
  });
}
