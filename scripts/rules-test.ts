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

  await abpfTests();

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
