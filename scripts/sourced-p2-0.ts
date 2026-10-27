// Sourced rulings regression tests, group p2-0 (A Hero Emerges .. Cloudian - Storm Dragon): each test pins a
// behaviour to the 2010 TCG text / rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/sourced-p2-0.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureAnprPatches } from '../src/cards/sets/anpr';
import { ensureRgbtPatches } from '../src/cards/sets/rgbt';
import { ensureCrmsPatches } from '../src/cards/sets/crms';
import { ensurePtdnPatches } from '../src/cards/sets/ptdn';
import { ensureLodtPatches } from '../src/cards/sets/lodt';
import { ensureGlasPatches } from '../src/cards/sets/glas';
import { ensureCsocPatches } from '../src/cards/sets/csoc';
import { ensureTdgsPatches } from '../src/cards/sets/tdgs';
import { ensureArchetypeExtrasPatches } from '../src/cards/sets/archetype-extras';
import { ensureArchetypeExtras2Patches } from '../src/cards/sets/archetype-extras2';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  lightWall: findCard('Sourced Light Wall') ?? normal('Sourced Light Wall', 'LIGHT', 'Fairy', 4, 500, 2500),
  lightHitter: findCard('Sourced Light Hitter') ?? normal('Sourced Light Hitter', 'LIGHT', 'Warrior', 4, 1000, 1000),
  big: findCard('Sourced Big Brute') ?? normal('Sourced Big Brute', 'EARTH', 'Warrior', 4, 2500, 1000),
  even: findCard('Sourced Even Brute') ?? normal('Sourced Even Brute', 'EARTH', 'Warrior', 4, 1900, 1000),
  dark: findCard('Sourced Dark Brute') ?? normal('Sourced Dark Brute', 'DARK', 'Fiend', 4, 1600, 1000),
  zombie: findCard('Sourced Zombie') ?? normal('Sourced Zombie', 'DARK', 'Zombie', 4, 1700, 1000),
  light: findCard('Sourced Light Monster') ?? normal('Sourced Light Monster', 'LIGHT', 'Fairy', 4, 1200, 1000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  trigger: (g: Game) => boolean = () => true;
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
  async confirmTrigger(g: Game) {
    return this.trigger(g);
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
  for (const ensure of [
    ensureAnprPatches,
    ensureRgbtPatches,
    ensureCrmsPatches,
    ensurePtdnPatches,
    ensureLodtPatches,
    ensureGlasPatches,
    ensureCsocPatches,
    ensureTdgsPatches,
    ensureArchetypeExtrasPatches,
    ensureArchetypeExtras2Patches,
  ])
    ensure(g);
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? loc !== 'szone', pos: opts.pos ?? 'atk' });
    if (loc === 'szone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
    c.summonTurn = 0;
    if ((loc === 'szone' || loc === 'fzone') && c.faceUp) c.activeOnField = true;
    return c;
  };
  return { g, c0, c1, place };
}

const N = (n: string) => cardByName(n);
const offers = (req: ResponseRequest, name: string) => req.options.some((o) => o.card.name === name);
const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;
const activatedLinks = (g: Game, c: CardInstance) => g.eventLog.filter((e) => e.type === 'chainActivated' && e.card === c).length;

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

async function activate(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
const canActivate = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));


const X = {
  waterSmall: findCard('Sourced Water Small') ?? normal('Sourced Water Small', 'WATER', 'Aqua', 3, 1000, 1000),
  water4: findCard('Sourced Water Four') ?? normal('Sourced Water Four', 'WATER', 'Aqua', 4, 1000, 1000),
  zero: findCard('Sourced Zero Attacker') ?? normal('Sourced Zero Attacker', 'EARTH', 'Rock', 4, 0, 2000),
  psychic: findCard('Sourced Psychic') ?? normal('Sourced Psychic', 'EARTH', 'Psychic', 4, 1500, 1000),
  psychic2: findCard('Sourced Psychic Two') ?? normal('Sourced Psychic Two', 'EARTH', 'Psychic', 3, 1200, 1000),
  reptile: findCard('Sourced Reptile') ?? normal('Sourced Reptile', 'EARTH', 'Reptile', 4, 1800, 1000),
  smallNormal: findCard('Sourced Small Normal') ?? normal('Sourced Small Normal', 'EARTH', 'Warrior', 3, 1000, 1000),
  six: findCard('Sourced Level Six') ?? normal('Sourced Level Six', 'EARTH', 'Warrior', 6, 2300, 1000),
};
const linksOf = (g: Game, name: string) =>
  g.eventLog.filter((e) => e.type === 'chainActivated' && (e.card as CardInstance | undefined)?.name === name).map((e) => e.data?.link as any);

(async () => {
  console.log('Sourced rulings tests: group p2-0');

  // https://edisonrul.ing/cards/a/a-hero-emerges.html
  await test('A Hero Emerges: a card that is not a monster is sent to the Graveyard', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, N('A Hero Emerges'), 'szone', { faceUp: false });
    const mst = place(0, N('Mystical Space Typhoon'), 'hand');
    const a = place(1, T.brute, 'mzone');
    c0.respond = respondWith('A Hero Emerges');
    await g.conductAttack(1, a);
    eq(mst.location, 'grave', 'the Spell Card picked at random is sent to the GY');
  });

  // https://edisonrul.ing/cards/a/aegis-of-the-ocean-dragon-lord.html
  await test('Aegis of the Ocean Dragon Lord: activates with no WATER monster and covers ones Summoned afterwards', async () => {
    const { g, place } = setup();
    const aegis = place(0, N('Aegis of the Ocean Dragon Lord'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, aegis), true, 'can be activated without a Level 3 or lower WATER monster');
    await activate(g, 0, aegis);
    const w = place(0, X.waterSmall, 'hand');
    await g.specialSummon([w], 0, { pos: 'atk' });
    await g.destroy([w], 'effect', 1);
    eq(w.location, 'mzone', 'a WATER monster Summoned later is not destroyed');
    const brute = place(0, T.brute, 'mzone');
    await g.destroy([brute], 'effect', 1);
    eq(brute.location, 'grave', 'other monsters are not protected');
  });

  // https://edisonrul.ing/cards/a/against-the-wind.html
  await test('Against the Wind: when the damage becomes 0, the Blackwing is not added to the hand', async () => {
    const { g, place } = setup();
    const bora = place(0, N('Blackwing - Bora the Spear'), 'grave');
    const atw = place(0, N('Against the Wind'), 'hand');
    g.addPlayerMod(0, 'noEffectDamage');
    await activate(g, 0, atw);
    eq(g.players[0].lp, 8000, 'no damage taken');
    eq(bora.location, 'grave', 'not added to the hand');
  });

  // https://edisonrul.ing/cards/a/alchemy-cycle.html
  await test('Alchemy Cycle: a monster whose original ATK is already 0 is not affected (no draw)', async () => {
    const { g, c1, place } = setup();
    const zero = place(0, X.zero, 'mzone');
    const brute = place(0, T.brute, 'mzone');
    const ac = place(0, N('Alchemy Cycle'), 'szone', { faceUp: false });
    await activate(g, 0, ac);
    eq(g.getAtk(brute), 0, 'original ATK becomes 0');
    g.turnPlayer = 1;
    const big = place(1, T.big, 'mzone');
    c1.chooseAttackTarget = async () => zero;
    const hand0 = g.players[0].hand.length;
    await g.conductAttack(1, big);
    eq(zero.location, 'grave', '0 ATK monster destroyed');
    eq(g.players[0].hand.length, hand0, 'no draw for it');
    big.attacksThisTurn = 0;
    c1.chooseAttackTarget = async () => brute;
    await g.conductAttack(1, big);
    eq(brute.location, 'grave', 'reduced monster destroyed');
    eq(g.players[0].hand.length, hand0 + 1, 'draw for the reduced monster');
  });

  // https://edisonrul.ing/cards/a/all-out-attacks.html
  await test('All-Out Attacks: its effect starts a Chain, even for an Attack Position Special Summon; face-down monsters are flipped', async () => {
    const { g, place } = setup();
    place(0, N('All-Out Attacks'), 'szone', { faceUp: true });
    const a = place(1, T.brute, 'grave');
    await g.specialSummon([a], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(linksOf(g, 'All-Out Attacks').length, 1, 'a Chain Link for the Attack Position Summon');
    const b = place(1, T.wall, 'grave');
    await g.specialSummon([b], 1, { pos: 'def', faceDown: true });
    await g.processTriggers(true);
    eq(b.faceUp && b.pos === 'atk', true, 'face-down monster changed to face-up Attack Position');
  });

  // https://edisonrul.ing/cards/a/ancient-forest.html
  await test('Ancient Forest: an attack negated by Magic Cylinder is not destroyed; an attack while it is negated still is', async () => {
    const battleEnd = async (g: Game) => {
      g.beginBatch();
      g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
      await g.processTriggers(true);
    };
    const a = setup();
    a.place(0, N('Ancient Forest'), 'fzone');
    const brute = a.place(0, T.brute, 'mzone');
    a.place(1, N('Magic Cylinder'), 'szone', { faceUp: false });
    a.c1.respond = respondWith('Magic Cylinder');
    await a.g.conductAttack(0, brute);
    eq(a.g.players[0].lp, 8000 - 1800, 'Magic Cylinder resolved');
    await battleEnd(a.g);
    eq(brute.location, 'mzone', 'negated attacker survives');

    const b = setup();
    const forest = b.place(0, N('Ancient Forest'), 'fzone');
    const brute2 = b.place(0, T.brute, 'mzone');
    forest.flags.negatedTurn = b.g.turn;
    await b.g.conductAttack(0, brute2);
    delete forest.flags.negatedTurn;
    await battleEnd(b.g);
    eq(brute2.location, 'grave', 'destroyed once the negation is gone');
  });

  // https://edisonrul.ing/cards/a/angel-o7.html
  await test('Angel O7: its gained effect is lost when it is flipped face-down and Flip Summoned', async () => {
    const { g, place } = setup();
    place(0, T.brute, 'mzone');
    place(0, T.wall, 'mzone');
    const o7 = place(0, N('Angel O7'), 'hand');
    await g.performAction(0, { type: 'summon', card: o7 });
    eq(o7.location, 'mzone', 'Tribute Summoned');
    eq(!!o7.flags.o7, true, 'effect gained');
    await g.changePosition(o7, 'def', false);
    await g.changePosition(o7, 'def', true);
    eq(!!o7.flags.o7, true, 'kept when flipped face-up by a card effect');
    await g.changePosition(o7, 'def', false);
    o7.setTurn = 0;
    o7.posChangedTurn = -1;
    await g.flipSummon(0, o7);
    eq(o7.faceUp, true, 'Flip Summoned');
    eq(!!o7.flags.o7, false, 'lost after a Flip Summon');
  });

  // https://edisonrul.ing/cards/a/appointer-of-the-red-lotus.html
  await test("Appointer of the Red Lotus: needs a card in your hand; on your opponent's turn it returns at the end of their NEXT turn", async () => {
    const a = setup();
    const ap = a.place(0, N('Appointer of the Red Lotus'), 'szone', { faceUp: false });
    a.place(1, T.brute, 'hand');
    eq(canActivate(a.g, 0, ap), false, 'no card in hand to reveal');
    a.place(0, T.wall, 'hand');
    eq(canActivate(a.g, 0, ap), true, 'with a card in hand');

    const b = setup();
    b.g.turnPlayer = 1;
    const ap2 = b.place(0, N('Appointer of the Red Lotus'), 'szone', { faceUp: false });
    b.place(0, T.wall, 'hand');
    const victim = b.place(1, T.brute, 'hand');
    await activate(b.g, 0, ap2);
    eq(victim.location, 'banished', 'banished');
    await (b.g as any).setPhase('end');
    eq(victim.location, 'banished', 'still banished at the end of this turn');
  });

  // https://edisonrul.ing/cards/a/arcana-force-ex-the-dark-ruler.html
  await test('Arcana Force EX - The Dark Ruler: Monster Tokens cannot be sent for its Summon', async () => {
    const { g, place } = setup();
    place(0, T.brute, 'mzone');
    place(0, T.wall, 'mzone');
    const tok = place(0, T.dark, 'mzone');
    (tok as any).data = { ...tok.data, isToken: true };
    const ex = place(0, N('Arcana Force EX - The Dark Ruler'), 'hand');
    eq(g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === ex), false, '2 monsters + 1 Token is not enough');
    place(0, T.dark, 'mzone');
    eq(g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === ex), true, '3 monsters');
  });

  // https://edisonrul.ing/cards/a/arcana-force-i-the-magician.html
  await test('Arcana Force I - The Magician (Heads): ATK doubles right after the Spell resolves, without a Chain Link', async () => {
    const { g, c0, place } = setup();
    place(0, N('Light Barrier'), 'fzone');
    const mag = place(0, N('Arcana Force I - The Magician'), 'hand');
    await g.performAction(0, { type: 'summon', card: mag });
    eq(g.getAtk(mag), 1100, 'Summoned');
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    const mst = place(0, N('Mystical Space Typhoon'), 'hand');
    c0.pick = (_g, req) => (req.candidates.includes(st) ? [st] : req.candidates.slice(0, req.min));
    await activate(g, 0, mst);
    eq(st.location, 'grave', 'Spell resolved');
    eq(g.getAtk(mag), 2200, 'ATK doubled');
    eq(g.eventLog.filter((e) => e.type === 'chainActivated' && e.card === mag && e.data?.link?.effect?.label !== 'Toss a coin').length, 0, 'no Chain Link for the Heads effect');
  });

  // https://edisonrul.ing/cards/a/arcana-knight-joker.html
  await test('Arcana Knight Joker: its negation can be activated during the Damage Step', async () => {
    const ef = N('Arcana Knight Joker').effects!.find((e) => e.kind === 'quick');
    eq(ef?.damageStep, true, 'damageStep flag');
  });

  // https://edisonrul.ing/cards/a/armed-sea-hunter.html
  await test('Armed Sea Hunter: negates the monster it battled even when it is destroyed by that battle; no indestructible substitute', async () => {
    const { g, c1, place } = setup();
    g.turnPlayer = 1;
    const ash = place(0, N('Armed Sea Hunter'), 'mzone');
    place(0, X.water4, 'mzone');
    const cd = place(1, N('Cyber Dragon'), 'mzone');
    c1.chooseAttackTarget = async () => ash;
    await g.conductAttack(1, cd);
    eq(ash.location, 'grave', 'Armed Sea Hunter destroyed by battle');
    eq(g.isNegated(cd), true, "Cyber Dragon's effects are negated");

    const s = setup();
    const ash2 = s.place(0, N('Armed Sea Hunter'), 'mzone');
    const w = s.place(0, X.waterSmall, 'mzone');
    s.g.addTempMod(w, 'indestructibleEffect', true, 'turn');
    await s.g.destroy([ash2], 'effect', 1);
    eq(ash2.location, 'grave', 'cannot substitute a monster that cannot be destroyed');
  });

  // https://edisonrul.ing/cards/a/armored-cybern.html
  await test('Armored Cybern: the 1000 ATK loss stops applying when it leaves the field', async () => {
    const { g, c0, place } = setup();
    const cd = place(0, N('Cyber Dragon'), 'mzone');
    const ac = place(0, N('Armored Cybern'), 'mzone');
    await activate(g, 0, ac, 'Equip / Unequip');
    eq(ac.location, 'szone', 'equipped');
    const v = place(1, T.brute, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(v) ? [v] : req.candidates.slice(0, req.min));
    const act = g.getActivations(0, { open: true }).find((a) => a.card === ac && a.label !== 'Equip / Unequip');
    if (!act) throw new Error('destroy effect not available');
    await g.performAction(0, { type: 'activate', card: ac, act });
    eq(v.location, 'grave', 'target destroyed');
    eq(g.getAtk(cd), 1100, 'loses 1000 ATK');
    await g.destroy([ac], 'effect', 1);
    eq(g.getAtk(cd), 2100, 'ATK back once Armored Cybern left the field');
  });

  // https://edisonrul.ing/cards/a/assault-mercenary.html
  await test('Assault Mercenary: the Spell/Trap is targeted when the effect is activated', async () => {
    const { g, c0, c1, place } = setup();
    const merc = place(0, N('Assault Mercenary'), 'mzone');
    place(0, N('Assault Mode Activate'), 'grave');
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => (req.candidates.includes(st) ? [st] : req.candidates.slice(0, req.min));
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === merc && top.ctx.targets.includes(st)) targeted = true;
      return null;
    };
    await activate(g, 0, merc);
    eq(targeted, true, 'target chosen at activation');
    eq(st.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/a/assault-revival.html
  await test('Assault Revival: only an "/Assault Mode" monster that was properly Special Summoned before; needs your monsters destroyed', async () => {
    const a = setup();
    a.place(0, T.brute, 'mzone');
    a.place(0, N('Assault Mode Activate'), 'grave');
    const am = a.place(0, N('Colossal Fighter/Assault Mode'), 'grave');
    const ar = a.place(0, N('Assault Revival'), 'hand');
    eq(canActivate(a.g, 0, ar), false, 'sent to the GY without being Summoned');
    am.properlySummoned = true;
    eq(canActivate(a.g, 0, ar), true, 'properly Summoned before');

    const b = setup();
    const keep = b.place(0, T.brute, 'mzone');
    b.g.addTempMod(keep, 'indestructibleEffect', true, 'turn');
    b.place(0, N('Assault Mode Activate'), 'grave');
    const am2 = b.place(0, N('Colossal Fighter/Assault Mode'), 'grave');
    am2.properlySummoned = true;
    const ar2 = b.place(0, N('Assault Revival'), 'hand');
    await activate(b.g, 0, ar2);
    eq(am2.location, 'grave', 'not Summoned: your monster was not destroyed');
  });

  // https://edisonrul.ing/cards/a/attack-pheromones.html
  await test('Attack Pheromones: the Defense Position monster is targeted', async () => {
    const { g, place } = setup();
    place(0, N('Attack Pheromones'), 'szone', { faceUp: true });
    const rep = place(0, X.reptile, 'mzone');
    const wall = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, rep);
    const links = linksOf(g, 'Attack Pheromones');
    eq(links.length, 1, 'activated');
    eq(links[0].ctx.targets.includes(wall), true, 'targets the monster');
    eq(wall.pos, 'atk', 'changed to Attack Position');
  });

  // https://edisonrul.ing/cards/a/attack-of-the-cornered-rat.html
  await test('Attack of the Cornered Rat: only once during the same Damage Step', async () => {
    const { g, place } = setup();
    const rat = place(0, N('Attack of the Cornered Rat'), 'szone', { faceUp: true });
    const small = place(0, X.smallNormal, 'mzone');
    const foe = place(1, T.brute, 'mzone');
    g.battle = { attacker: small, target: foe, attackerMoveId: small.moveId, targetMoveId: foe.moveId, negated: false, inDamageStep: true } as any;
    eq(canActivate(g, 0, rat), true, 'in the Damage Step');
    await activate(g, 0, rat);
    eq(g.getAtk(foe), 1700, 'ATK reduced by the LP paid');
    eq(canActivate(g, 0, rat), false, 'not again in the same Damage Step');
    g.battle = { attacker: small, target: foe, attackerMoveId: small.moveId, targetMoveId: foe.moveId, negated: false, inDamageStep: true } as any;
    eq(canActivate(g, 0, rat), true, 'again in another Damage Step');
  });

  // https://edisonrul.ing/cards/b/battle-teleportation.html
  await test('Battle Teleportation: can be activated in the Standby Phase; destroyed if the opponent has no open Monster Zone', async () => {
    const { g, place } = setup();
    g.phase = 'standby';
    const psy = place(0, X.psychic, 'mzone');
    const bt = place(0, N('Battle Teleportation'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, bt), true, 'Standby Phase');
    await activate(g, 0, bt);
    for (let i = 0; i < 5; i++) place(1, T.wall, 'mzone');
    g.phase = 'battle';
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: 0, phase: 'battle' });
    await g.processTriggers(true);
    eq(psy.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/b/battle-tuned.html
  await test('Battle Tuned: targets the Tuner in your Graveyard, which is removed from play on resolution', async () => {
    const { g, c1, place } = setup();
    const tuner = place(0, N('Nitro Synchron'), 'grave');
    const brute = place(0, T.brute, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    const bt = place(0, N('Battle Tuned'), 'hand');
    let targeted = false;
    let stillInGy = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === bt && top.ctx.targets.includes(tuner)) targeted = true;
      if (tuner.location === 'grave') stillInGy = true;
      return null;
    };
    await activate(g, 0, bt);
    eq(targeted, true, 'Tuner targeted');
    eq(stillInGy, true, 'not removed as a cost');
    eq(tuner.location, 'banished', 'removed from play on resolution');
    eq(g.getAtk(brute), 1800 + (tuner.data.atk ?? 0), 'ATK gain');
  });

  // https://edisonrul.ing/cards/b/battle-of-the-elements.html
  await test('Battle of the Elements: needs a face-up monster on both sides of the field', async () => {
    const { g, place } = setup();
    const boe = place(0, N('Battle of the Elements'), 'szone', { faceUp: false });
    place(0, T.brute, 'mzone');
    place(0, T.dark, 'mzone');
    eq(canActivate(g, 0, boe), false, 'opponent controls no monster');
    place(1, T.brute, 'mzone');
    eq(canActivate(g, 0, boe), true, 'both sides');
  });

  // https://edisonrul.ing/cards/b/black-luster-soldier-envoy-of-the-beginning.html
  await test('Black Luster Soldier - Envoy of the Beginning: flipped face-down and face-up again, it can use its effect again', async () => {
    const { g, place } = setup();
    const bls = place(0, N('Black Luster Soldier - Envoy of the Beginning'), 'mzone');
    place(1, T.brute, 'mzone');
    place(1, T.wall, 'mzone');
    await activate(g, 0, bls, 'Banish 1 monster');
    eq(canActivate(g, 0, bls, 'Banish 1 monster'), false, 'once per turn');
    await g.changePosition(bls, 'def', false);
    await g.changePosition(bls, 'atk', true);
    eq(canActivate(g, 0, bls, 'Banish 1 monster'), true, 'a new card after the face-down turn');
  });

  // https://edisonrul.ing/cards/b/blue-thunder-t-45.html
  await test('Blue Thunder T-45: still Summons the Token if it was destroyed by a card effect after damage calculation', async () => {
    const { g, place } = setup();
    const bt = place(0, N('Blue Thunder T-45'), 'grave');
    const victim = place(1, T.wall, 'grave');
    g.beginBatch();
    g.emit({ type: 'battleDestroyed', card: victim, other: bt, from: 'mzone', to: 'grave', fromController: 1, reason: 'battle', reasons: ['battle', 'destroy'] });
    await g.processTriggers(true);
    eq(g.monsters(0).filter((c) => c.name === 'Thunder Option Token').length, 1, 'Thunder Option Token');
  });

  // https://edisonrul.ing/cards/b/bone-temple-block.html
  await test('Bone Temple Block: the discard happens on resolution, and the monsters are targeted on activation', async () => {
    const { g, c1, place } = setup();
    const btb = place(0, N('Bone Temple Block'), 'szone', { faceUp: false });
    const h = place(0, T.brute, 'hand');
    const mineGy = place(0, T.wall, 'grave');
    const theirGy = place(1, T.dark, 'grave');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    let handDuringChain = -1;
    let targets: CardInstance[] = [];
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === btb) {
        handDuringChain = gg.players[0].hand.length;
        targets = [...top.ctx.targets];
      }
      return null;
    };
    await activate(g, 0, btb);
    eq(handDuringChain, 1, 'nothing discarded as a cost');
    eq(targets.includes(theirGy) && targets.includes(mineGy), true, 'both monsters targeted');
    eq(h.location, 'grave', 'discarded on resolution');
    eq(theirGy.location === 'mzone' && theirGy.controller === 0, true, 'Summoned to your side');
    eq(mineGy.location === 'mzone' && mineGy.controller === 1, true, "Summoned to your opponent's side");
  });

  // https://edisonrul.ing/cards/b/brain-research-lab.html
  await test('Brain Research Lab: the extra Psychic Normal Summon needs no activation and can come before the regular one', async () => {
    const { g, place } = setup();
    const lab = place(0, N('Brain Research Lab'), 'fzone');
    const p1 = place(0, X.psychic, 'hand');
    const other = place(0, T.brute, 'hand');
    const p2 = place(0, X.psychic2, 'hand');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === lab), false, 'nothing to activate');
    await g.performAction(0, { type: 'summon', card: p1 });
    eq(p1.location, 'mzone', 'Psychic Normal Summoned');
    eq(lab.counters.psychic ?? 0, 1, 'Psychic Counter placed');
    eq(linksOf(g, 'Brain Research Lab').length, 0, 'no Chain');
    eq(g.canNormalSummon(0, other), true, 'regular Normal Summon still available');
    await g.performAction(0, { type: 'summon', card: other });
    eq(g.canNormalSummon(0, p2), false, 'only once per turn');
  });

  // https://edisonrul.ing/cards/b/broken-blocker.html
  await test("Broken Blocker: compares the destroyed monster's ATK and DEF on the field", async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const wall = place(0, T.wall, 'mzone', { pos: 'def' });
    g.addTempMod(wall, 'atk', 2000, 'turn');
    place(0, T.wall, 'deck');
    place(0, N('Broken Blocker'), 'szone', { faceUp: false });
    const big = place(1, T.big, 'mzone');
    let offered = false;
    c0.respond = (_g, req) => {
      if (offers(req, 'Broken Blocker')) offered = true;
      return null;
    };
    await g.conductAttack(1, big);
    eq(wall.location, 'grave', 'destroyed');
    eq(offered, false, 'ATK 2500 on the field is not lower than its DEF');
  });

  // https://edisonrul.ing/cards/b/butterfly-dagger-elma.html
  await test('Butterfly Dagger - Elma: not returned when it is sent to the GY because the equipped monster was destroyed', async () => {
    const { g, place } = setup();
    const mon = place(0, T.brute, 'mzone');
    const dagger = place(0, N('Butterfly Dagger - Elma'), 'szone', { faceUp: true });
    g.equip(dagger, mon);
    await g.destroy([mon], 'effect', 1);
    await g.processTriggers(true);
    eq(dagger.location, 'grave', 'stays in the GY');
  });

  // https://edisonrul.ing/cards/c/card-blocker.html
  await test('Card Blocker: the Deck cards are sent as a cost; only 1 copy can change the attack target', async () => {
    const a = setup();
    a.g.turnPlayer = 1;
    const cb = a.place(0, N('Card Blocker'), 'mzone', { pos: 'def' });
    for (let i = 0; i < 4; i++) a.place(0, T.wall, 'deck');
    const atk = a.place(1, T.brute, 'mzone');
    a.place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let deckDuringChain = -1;
    a.c0.respond = respondWith('Card Blocker');
    a.c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === cb) deckDuringChain = gg.players[0].deck.length;
      return null;
    };
    const deck0 = a.g.players[0].deck.length;
    a.c1.chooseAttackTarget = async () => cb;
    await a.g.conductAttack(1, atk);
    eq(deckDuringChain >= 0 && deckDuringChain < deck0, true, 'cards already sent when the effect is activated');

    const b = setup();
    b.g.turnPlayer = 1;
    b.place(0, N('Card Blocker'), 'mzone', { pos: 'def' });
    b.place(0, N('Card Blocker'), 'mzone', { pos: 'def' });
    const other = b.place(0, T.wall, 'mzone');
    const atk2 = b.place(1, T.brute, 'mzone');
    b.c0.respond = respondWith('Card Blocker');
    b.c1.chooseAttackTarget = async () => other;
    await b.g.conductAttack(1, atk2);
    eq(linksOf(b.g, 'Card Blocker').filter((l) => l.effect.label === 'Become the attack target').length, 1, 'one target change');
  });

  // https://edisonrul.ing/cards/c/card-trader.html
  await test('Card Trader: the card is shuffled into the Deck as a cost', async () => {
    const { g, c1, place } = setup();
    place(0, N('Card Trader'), 'szone', { faceUp: true });
    const junk = place(0, T.big, 'hand');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    let where = '';
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card.name === 'Card Trader') where = junk.location;
      return null;
    };
    await (g as any).setPhase('standby');
    eq(where, 'deck', 'already in the Deck while the effect is on the Chain');
    eq(g.players[0].hand.length, 1, 'drew 1');
  });

  // https://edisonrul.ing/cards/c/card-of-safe-return.html
  await test('Card of Safe Return: you draw when your opponent Special Summons a monster from your Graveyard', async () => {
    const { g, place } = setup();
    place(0, N('Card of Safe Return'), 'szone', { faceUp: true });
    const m = place(0, T.brute, 'grave');
    const hand0 = g.players[0].hand.length;
    await g.specialSummon([m], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(m.controller, 1, "on the opponent's field");
    eq(g.players[0].hand.length, hand0 + 1, 'drew 1');
  });

  // https://edisonrul.ing/cards/c/castle-gate.html
  await test('Castle Gate: a monster whose Level was reduced to 5 can be Tributed (damage = original ATK)', async () => {
    const { g, place } = setup();
    const gate = place(0, N('Castle Gate'), 'mzone');
    const six = place(0, X.six, 'mzone');
    eq(canActivate(g, 0, gate), false, 'Level 6');
    g.addTempMod(six, 'level', -1, 'turn');
    g.addTempMod(six, 'atk', 500, 'turn');
    eq(canActivate(g, 0, gate), true, 'Level reduced to 5');
    await activate(g, 0, gate);
    eq(g.players[1].lp, 8000 - 2300, 'original ATK');
  });

  // https://edisonrul.ing/cards/c/changing-destiny.html
  await test('Changing Destiny: if the attacker cannot be changed to Defense Position, the rest is not applied', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, N('Changing Destiny'), 'szone', { faceUp: false });
    place(0, T.wall, 'mzone');
    const a = place(1, T.brute, 'mzone');
    c0.respond = (_gg, req) => {
      const o = req.options.find((x) => x.card.name === 'Changing Destiny');
      if (o) a.pos = 'def'; // e.g. "Total Defense Shogun" attacking in Defense Position
      return o ?? null;
    };
    await g.conductAttack(1, a);
    eq(g.players[0].lp, 8000, 'no damage');
    eq(g.players[1].lp, 8000, 'no LP gain');
    eq(g.queryCard(a, 'cannotChangePos'), false, 'no position lock');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
