// Sourced rulings regression tests, group 1 (deck cards "A" Cell Incubator .. Gaia Knight): each test pins a
// behaviour to the 2010 TCG text / rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/sourced-1.ts
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

(async () => {
  console.log('Sourced rulings tests: group 1');

  // https://edisonrul.ing/cards/a/ally-of-justice-catastor.html
  await test('Ally of Justice Catastor: not when it attacks a face-down monster or is attacked while face-down; Dark Simorgh is hit', async () => {
    const a = setup();
    const cat = a.place(0, N('Ally of Justice Catastor'), 'mzone');
    const set = a.place(1, T.lightWall, 'mzone', { faceUp: false, pos: 'def' });
    let offered = false;
    a.c0.respond = (_g, req) => {
      if (offers(req, 'Ally of Justice Catastor')) offered = true;
      return respondWith('Ally of Justice Catastor')(_g, req);
    };
    await a.g.conductAttack(0, cat);
    eq(offered, false, 'not offered against a face-down monster');
    eq(set.location, 'mzone', 'the flipped LIGHT monster survives');

    const b = setup();
    const cat2 = b.place(0, N('Ally of Justice Catastor'), 'mzone');
    const up = b.place(1, T.lightWall, 'mzone', { pos: 'def' });
    b.c0.respond = respondWith('Ally of Justice Catastor');
    await b.g.conductAttack(0, cat2);
    eq(up.location, 'grave', 'a face-up non-DARK monster is destroyed');

    const c = setup();
    c.g.turnPlayer = 1;
    const cat3 = c.place(0, N('Ally of Justice Catastor'), 'mzone', { faceUp: false, pos: 'def' });
    const hitter = c.place(1, T.lightHitter, 'mzone');
    let offered3 = false;
    c.c0.respond = (_g, req) => {
      if (offers(req, 'Ally of Justice Catastor')) offered3 = true;
      return respondWith('Ally of Justice Catastor')(_g, req);
    };
    await c.g.conductAttack(1, hitter);
    eq(offered3, false, 'not offered when attacked while face-down');
    eq(hitter.location, 'mzone', 'the attacker survives');
    eq(cat3.location, 'mzone', 'Catastor flipped, still there');

    const d = setup();
    const cat4 = d.place(0, N('Ally of Justice Catastor'), 'mzone');
    const sim = d.place(1, N('Dark Simorgh'), 'mzone', { pos: 'def' });
    d.c0.respond = respondWith('Ally of Justice Catastor');
    await d.g.conductAttack(0, cat4);
    eq(sim.location, 'grave', 'Dark Simorgh (also WIND) is destroyed');
  });

  // https://edisonrul.ing/cards/e/ehren-lightsworn-monk.html
  await test('Ehren, Lightsworn Monk: the Defense Position monster goes back before damage calculation (no battle damage)', async () => {
    const { g, place } = setup();
    const ehren = place(0, N('Ehren, Lightsworn Monk'), 'mzone');
    const wall = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, ehren);
    eq(wall.location, 'deck', 'shuffled into the Deck');
    eq(g.players[0].lp, 8000, 'no damage calculation: Ehren (1600) takes no damage from DEF 2000');
  });

  // https://edisonrul.ing/cards/a/alien-hypno.html
  await test('Alien Hypno: End Phase A-Counter removal and destruction happen without a Chain', async () => {
    const { g, place } = setup();
    const hypno = place(0, N('Alien Hypno'), 'mzone');
    hypno.flags.geminiSummoned = true;
    const stolen = place(0, T.brute, 'mzone');
    stolen.counters.A = 1;
    stolen.flags.glasHypno = hypno.uid;
    stolen.flags.glasHypnoMove = hypno.moveId;
    await (g as any).setPhase('end');
    eq(stolen.location, 'grave', 'the monster with no A-Counter left is destroyed');
    eq(activatedLinks(g, hypno), 0, 'no Chain Link for Alien Hypno');
  });

  // https://edisonrul.ing/cards/a/alien-telepath.html (revised section)
  await test('Alien Telepath: the Spell/Trap is targeted when the effect is activated', async () => {
    const { g, c0, c1, place } = setup();
    const tele = place(0, N('Alien Telepath'), 'mzone');
    const host = place(1, T.brute, 'mzone');
    host.counters.A = 1;
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false }); // so the opponent gets a response window
    let targeted = false;
    c0.pick = (_g, req) => (req.candidates.includes(st) ? [st] : req.candidates.slice(0, req.min));
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === tele && top.ctx.targets.includes(st)) targeted = true;
      return null;
    };
    await activate(g, 0, tele);
    eq(targeted, true, 'target chosen at activation');
    eq(st.location, 'grave', 'destroyed');
    eq(host.counters.A, 0, 'A-Counter removed');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-castle.html
  await test('Ancient Gear Castle: a monster Set from the hand also puts a counter on it', async () => {
    const { g, place } = setup();
    const castle = place(0, N('Ancient Gear Castle'), 'fzone');
    const m = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'set', card: m });
    eq(castle.counters.gear ?? 0, 1, '1 counter for the Set');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-engineer.html
  await test('Ancient Gear Engineer: no Spell/Trap destruction when it is destroyed by battle', async () => {
    const { g, place } = setup();
    const eng = place(0, N('Ancient Gear Engineer'), 'mzone');
    place(1, T.brute, 'mzone');
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    await g.conductAttack(0, eng);
    eq(eng.location, 'grave', 'Engineer (1500) destroyed by the 1800 ATK monster');
    eq(st.location, 'szone', 'the Spell/Trap stays');
  });

  // https://edisonrul.ing/cards/a/arcanite-magician.html
  await test("Arcanite Magician: destroys 1 card your opponent controls (cannot target your own)", async () => {
    const { g, c0, place } = setup();
    const arc = place(0, N('Arcanite Magician'), 'mzone');
    arc.counters.spell = 2;
    const mine = place(0, N('Dust Tornado'), 'szone', { faceUp: false });
    const theirs = place(1, T.brute, 'mzone');
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      if (req.purpose === 'destroy') cands = req.candidates;
      return req.candidates.slice(0, req.min);
    };
    await activate(g, 0, arc);
    eq(cands.includes(mine), false, 'own card not a legal target');
    eq(theirs.location, 'grave', "opponent's card destroyed");
  });

  // https://edisonrul.ing/cards/a/armory-arm.html
  await test("Armory Arm: burn equal to the destroyed monster's ATK on the field (2010), not its original ATK", async () => {
    const { g, c0, place } = setup();
    const arm = place(0, N('Armory Arm'), 'mzone');
    const brute = place(0, T.brute, 'mzone');
    const wall = place(1, T.wall, 'mzone');
    g.addTempMod(wall, 'atk', 300, 'turn');
    c0.pick = (_g, req) => (req.candidates.includes(brute) ? [brute] : req.candidates.slice(0, req.min));
    await activate(g, 0, arm, 'Equip to a monster');
    eq(arm.location, 'szone', 'equipped');
    await g.conductAttack(0, brute);
    eq(wall.location, 'grave', 'destroyed by battle');
    eq(g.players[1].lp, 8000 - (2800 - 800) - 800, 'battle damage 2000 + 800 (ATK on the field)');
  });

  // https://edisonrul.ing/cards/a/aurkus-lightsworn-druid.html
  await test('Aurkus, Lightsworn Druid: "Lightsworn" monsters in the GY cannot be targeted either', async () => {
    const { g, place } = setup();
    place(0, N('Aurkus, Lightsworn Druid'), 'mzone');
    const ryko = place(0, N('Ryko, Lightsworn Hunter'), 'grave');
    const other = place(0, T.brute, 'grave');
    const crow = place(1, N('D.D. Crow'), 'hand');
    const ctx = new Ctx(g, crow, crow.data.effects![0], 1);
    eq(ctx.canTarget(ryko), false, 'Lightsworn in the GY');
    eq(ctx.canTarget(other), true, 'other monster in the GY');
  });

  // https://edisonrul.ing/cards/b/beckoning-light.html
  await test('Beckoning Light: cannot be activated with fewer LIGHT monsters in the GY than cards in hand', async () => {
    const { g, place } = setup();
    const bl = place(0, N('Beckoning Light'), 'szone', { faceUp: false });
    place(0, T.brute, 'hand');
    place(0, T.wall, 'hand');
    place(0, T.light, 'grave');
    eq(canActivate(g, 0, bl), false, '2 cards in hand, 1 LIGHT');
    place(0, T.light, 'grave');
    eq(canActivate(g, 0, bl), true, '2 cards in hand, 2 LIGHT');
  });

  // https://edisonrul.ing/cards/b/black-garden.html
  await test('Black Garden: one Rose Token for monsters Summoned together; a face-down Special Summon still gives one', async () => {
    const { g, place } = setup();
    place(0, N('Black Garden'), 'fzone');
    const a = place(1, T.brute, 'grave');
    const b = place(1, T.wall, 'grave');
    await g.specialSummon([a, b], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(g.getAtk(a), 900, 'ATK halved');
    eq(g.monsters(0).filter((c) => c.name === 'Rose Token').length, 1, 'a single Rose Token');
    const s = setup();
    s.place(0, N('Black Garden'), 'fzone');
    const d = s.place(1, T.brute, 'grave');
    await s.g.specialSummon([d], 1, { pos: 'def', faceDown: true });
    await s.g.processTriggers(true);
    eq(d.location === 'mzone' && !d.faceUp, true, 'Special Summoned face-down');
    eq(s.g.monsters(0).filter((c) => c.name === 'Rose Token').length, 1, 'Rose Token for the face-down Summon');
    const t = setup();
    const garden = t.place(0, N('Black Garden'), 'fzone');
    t.place(0, { ...T.brute } as CardData, 'grave');
    const zero = t.place(0, N('Dandylion'), 'grave');
    void zero;
    eq(canActivate(t.g, 0, garden), false, 'no Plant on the field: cannot be activated');
  });

  // https://edisonrul.ing/cards/b/black-whirlwind.html
  await test('Black Whirlwind: no search if the Summoned "Blackwing" is face-down when it resolves', async () => {
    const { g, c1, place } = setup();
    place(0, N('Black Whirlwind'), 'szone', { faceUp: true });
    const bora = place(0, N('Blackwing - Bora the Spear'), 'hand');
    const blizzard = place(0, N('Blackwing - Blizzard the Far North'), 'deck');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = (gg, req) => (gg.chain.some((l) => l.card.name === 'Black Whirlwind') ? respondWith('Book of Moon')(gg, req) : null);
    await g.performAction(0, { type: 'summon', card: bora });
    eq(bora.faceUp, false, 'Bora flipped face-down in response');
    eq(blizzard.location, 'deck', 'nothing searched');
  });

  // https://edisonrul.ing/cards/b/blackwing-silverwind-the-ascendant.html
  await test('Blackwing - Silverwind the Ascendant: Synchro Summon trigger on either side, no Battle Phase, one-time battle protection', async () => {
    const { g, c0, place } = setup();
    const sw = place(0, N('Blackwing - Silverwind the Ascendant'), 'extra');
    const mats = [
      place(0, N('Blackwing - Blizzard the Far North'), 'mzone'),
      place(0, N('Blackwing - Kalut the Moon Shadow'), 'mzone'),
      place(0, N('Blackwing - Kalut the Moon Shadow'), 'mzone'),
    ];
    const foe = place(1, T.brute, 'mzone');
    const own = place(0, T.wall, 'mzone', { pos: 'atk' });
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      if (req.purpose === 'destroy') {
        cands = req.candidates;
        return [foe];
      }
      return req.candidates.slice(0, req.min);
    };
    await g.synchroSummon(0, sw, mats);
    eq(sw.location, 'mzone', 'Synchro Summoned');
    eq(cands.includes(own), true, 'your own face-up monster can be selected too');
    eq(foe.location, 'grave', 'destroyed');
    eq(g.queryPlayer(0, 'cannotDeclareAttack'), true, 'no Battle Phase this turn');

    const s = setup();
    s.place(0, N('Blackwing - Silverwind the Ascendant'), 'mzone');
    const bora = s.place(0, N('Blackwing - Bora the Spear'), 'mzone');
    const big = s.place(1, T.big, 'mzone');
    s.g.turnPlayer = 1;
    await s.g.conductAttack(1, big);
    eq(bora.location, 'mzone', 'first battle destruction prevented');
    big.attacksThisTurn = 0;
    await s.g.conductAttack(1, big);
    eq(bora.location, 'grave', 'only once');
  });

  // https://edisonrul.ing/cards/b/blackwing-armed-wing.html
  await test('Blackwing Armed Wing: no 500 ATK when attacking an Attack Position monster', async () => {
    const { g, place } = setup();
    const aw = place(0, N('Blackwing Armed Wing'), 'mzone');
    place(1, T.big, 'mzone');
    await g.conductAttack(0, aw);
    eq(aw.location, 'grave', '2300 loses to 2500');
  });

  // https://edisonrul.ing/cards/b/blackwing-armor-master.html
  await test("Blackwing Armor Master: Wedge removal is an Ignition Effect on your opponent's monsters only", async () => {
    const { g, place } = setup();
    const am = place(0, N('Blackwing Armor Master'), 'mzone');
    const foe = place(1, T.brute, 'mzone');
    const own = place(0, T.wall, 'mzone');
    foe.counters.wedge = 1;
    own.counters.wedge = 1;
    g.turnPlayer = 1;
    eq(canActivate(g, 0, am, 'Remove Wedge Counters'), false, "not during the opponent's turn");
    g.turnPlayer = 0;
    await activate(g, 0, am, 'Remove Wedge Counters');
    eq(g.getAtk(foe), 0, "opponent's monster ATK 0");
    eq(own.counters.wedge, 1, 'own Wedge Counter stays');
    eq(g.getAtk(own), 500, 'own monster unchanged');
  });

  // https://edisonrul.ing/cards/c/caius-the-shadow-monarch.html
  await test('Caius the Shadow Monarch: banishing your own DARK monster still damages your opponent', async () => {
    const { g, c0, place } = setup();
    const caius = place(0, N('Caius the Shadow Monarch'), 'hand');
    const fodder = place(0, T.brute, 'mzone');
    const ownDark = place(0, T.dark, 'mzone');
    c0.pick = (_g, req) => (req.purpose === 'tribute' ? [fodder] : req.candidates.includes(ownDark) ? [ownDark] : req.candidates.slice(0, req.min));
    await g.performAction(0, { type: 'summon', card: caius });
    eq(ownDark.location, 'banished', 'own DARK banished');
    eq(g.players[1].lp, 7000, 'opponent takes 1000');
    eq(g.players[0].lp, 8000, 'you take none');
  });

  // https://edisonrul.ing/cards/c/card-trooper.html
  await test('Card Trooper: the cards are sent as the cost; no draw when destroyed under the opponent\'s control', async () => {
    const { g, c1, place } = setup();
    const ct = place(0, N('Card Trooper'), 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false }); // so the opponent gets a response window
    let atResponse = -1;
    c1.respond = (gg) => {
      if (gg.chain.some((l) => l.card === ct)) atResponse = gg.players[0].grave.length;
      return null;
    };
    await activate(g, 0, ct);
    eq(atResponse, 1, 'already in the GY when the opponent can respond');
    const s = setup();
    const ct2 = s.place(0, N('Card Trooper'), 'hand');
    s.g.rawMove(ct2, 'mzone', { controller: 1, faceUp: true, pos: 'atk' });
    const hand = s.g.players[0].hand.length;
    await s.g.destroy([ct2], 'effect', 0);
    await s.g.processTriggers(false);
    eq(s.g.players[0].hand.length, hand, 'no draw');
  });

  // https://edisonrul.ing/cards/c/chain-disappearance.html
  await test('Chain Disappearance: banishes Summoned Tokens too (Scapegoat)', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const goat = place(1, N('Scapegoat'), 'hand');
    place(0, N('Chain Disappearance'), 'szone', { faceUp: false });
    c0.respond = respondWith('Chain Disappearance');
    await activate(g, 1, goat);
    eq(g.monsters(1).filter((c) => c.name === 'Sheep Token').length, 0, 'all Sheep Tokens removed');
  });

  // https://edisonrul.ing/cards/c/cunning-of-the-six-samurai.html
  await test('Cunning of the Six Samurai: cannot be activated with no "Six Samurai" monster in the GY', async () => {
    const { g, place } = setup();
    const cun = place(0, N('Cunning of the Six Samurai'), 'hand');
    place(0, N('The Six Samurai - Yaichi'), 'mzone');
    place(0, N('The Six Samurai - Kamon'), 'mzone');
    eq(canActivate(g, 0, cun), false, 'none in the GY');
    place(0, N('The Six Samurai - Zanji'), 'grave');
    eq(canActivate(g, 0, cun), true, 'one in the GY');
  });

  // https://edisonrul.ing/cards/c/cyber-valley.html
  await test('Cyber Valley: banish it and 1 card from your hand (on resolution) to put a GY card on top of the Deck', async () => {
    const { g, place } = setup();
    const cv = place(0, N('Cyber Valley'), 'mzone');
    const h = place(0, T.brute, 'hand');
    const x = place(0, T.dark, 'grave');
    await activate(g, 0, cv, 'Banish this and 1 hand card: GY card to top of Deck');
    eq(cv.location, 'banished', 'Cyber Valley banished');
    eq(h.location, 'banished', 'hand card banished');
    eq(g.players[0].deck[g.players[0].deck.length - 1], x, 'GY card on top of the Deck');
  });

  // https://edisonrul.ing/cards/d/dark-bribe.html
  await test('Dark Bribe: cannot be activated if the opponent has no cards in their Deck', async () => {
    const run = async (emptyDeck: boolean) => {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      place(0, N('Dark Bribe'), 'szone', { faceUp: false });
      const mst = place(1, N('Mystical Space Typhoon'), 'hand');
      if (emptyDeck) g.players[1].deck.length = 0;
      let offered = false;
      c0.respond = (_g, req) => {
        if (offers(req, 'Dark Bribe')) offered = true;
        return null;
      };
      await activate(g, 1, mst);
      return offered;
    };
    eq(await run(true), false, 'not offered against an empty Deck');
    eq(await run(false), true, 'offered otherwise');
  });

  // https://edisonrul.ing/cards/d/doomkaiser-dragon.html
  await test('Doomkaiser Dragon: any Special Summon triggers it; the Zombie is destroyed when Doomkaiser leaves the field', async () => {
    const { g, place } = setup();
    const dk = place(0, N('Doomkaiser Dragon'), 'grave');
    dk.properlySummoned = true;
    const z = place(1, T.zombie, 'grave');
    await g.specialSummon([dk], 0, { pos: 'atk' });
    await g.processTriggers(true);
    eq(z.location, 'mzone', 'Zombie Special Summoned');
    eq(z.pos, 'atk', 'in Attack Position');
    await g.toHand([dk], 'effect', 1);
    eq(z.location, 'grave', 'destroyed when Doomkaiser left the field');
  });

  // https://edisonrul.ing/cards/d/drill-warrior.html
  await test('Drill Warrior: the ATK stays halved; the discard happens on resolution', async () => {
    const { g, c1, place } = setup();
    const dw = place(0, N('Drill Warrior'), 'mzone');
    await activate(g, 0, dw, 'Halve ATK: attack directly');
    eq(g.getAtk(dw), 1200, 'halved');
    eq(dw.tempMods.some((t) => t.q === 'atk' && t.until === 'field'), true, 'lasts while it is on the field');
    const s = setup();
    const dw2 = s.place(0, N('Drill Warrior'), 'mzone');
    const card = s.place(0, T.brute, 'hand');
    s.place(1, N('Book of Moon'), 'szone', { faceUp: false }); // so the opponent gets a response window
    let handAtResponse = -1;
    s.c1.respond = (gg) => {
      if (gg.chain.some((l) => l.card === dw2)) handAtResponse = gg.players[0].hand.length;
      return null;
    };
    void c1;
    await activate(s.g, 0, dw2, 'Discard: banish until next Standby Phase');
    eq(handAtResponse, 1, 'not discarded as a cost');
    eq(card.location, 'grave', 'discarded on resolution');
    eq(dw2.location, 'banished', 'banished');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-prisma.html
  await test('Elemental Hero Prisma: nothing is sent if Prisma is flipped face-down in response', async () => {
    const { g, c1, place } = setup();
    const prisma = place(0, N('Elemental Hero Prisma'), 'mzone');
    place(0, N('Elemental Hero Flame Wingman'), 'extra');
    const avian = place(0, N('Elemental Hero Avian'), 'deck');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = (gg, req) => (gg.chain.some((l) => l.card === prisma) ? respondWith('Book of Moon')(gg, req) : null);
    await activate(g, 0, prisma);
    eq(prisma.faceUp, false, 'flipped face-down');
    eq(avian.location, 'deck', 'nothing sent');
  });

  // https://edisonrul.ing/cards/f/fortune-lady-light.html
  await test('Fortune Lady Light: also triggers when it leaves the field face-down', async () => {
    const { g, place } = setup();
    const fl = place(0, N('Fortune Lady Light'), 'mzone', { faceUp: false, pos: 'def' });
    const water = place(0, N('Fortune Lady Water'), 'deck');
    await g.toHand([fl], 'effect', 1);
    await g.processTriggers(true);
    eq(water.location, 'mzone', 'Fortune Lady Special Summoned from the Deck');
  });

  // https://edisonrul.ing/cards/f/fortune-lady-wind.html
  await test('Fortune Lady Wind: cannot activate with fewer opponent Spells/Traps than your Fortune Ladies', async () => {
    const { g, place } = setup();
    place(0, N('Fortune Lady Light'), 'mzone');
    const wind = place(0, N('Fortune Lady Wind'), 'hand');
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    let asked = false;
    (g.controllers[0] as TestController).trigger = () => ((asked = true), true);
    await g.performAction(0, { type: 'summon', card: wind });
    eq(asked, false, 'not offered: 2 Fortune Ladies, 1 Spell/Trap');
    eq(st.location, 'szone', 'not destroyed');
  });

  // https://edisonrul.ing/cards/f/future-fusion.html
  await test('Future Fusion: needs a possible Special Summon; removing it from the field destroys the Fusion Monster', async () => {
    const { g, place } = setup();
    const ff = place(0, N('Future Fusion'), 'hand');
    place(0, N('Five-Headed Dragon'), 'extra');
    for (let i = 0; i < 5; i++) place(0, N('Debris Dragon'), 'deck');
    eq(canActivate(g, 0, ff), true, 'can be activated');
    g.addPlayerMod(0, 'cannotSpecialSummon');
    eq(canActivate(g, 0, ff), false, 'not while you cannot Special Summon');
    const s = setup();
    const ff2 = s.place(0, N('Future Fusion'), 'szone', { faceUp: true });
    const fhd = s.place(0, N('Five-Headed Dragon'), 'extra');
    ff2.flags.ffFusion = fhd.uid;
    ff2.flags.ffStandbys = 1;
    await (s.g as any).setPhase('standby');
    eq(fhd.location, 'mzone', 'Fusion Summoned in the 2nd Standby Phase');
    await s.g.toHand([ff2], 'effect', 1);
    eq(fhd.location, 'grave', 'destroyed when Future Fusion left the field');
  });

  // https://edisonrul.ing/cards/c/cactus-fighter.html (revised section)
  await test('Cactus Fighter: still gives the Needle Token when it is destroyed in the same battle', async () => {
    const { g, place } = setup();
    const cf = place(0, N('Cactus Fighter'), 'mzone');
    place(1, T.even, 'mzone');
    await g.conductAttack(0, cf);
    eq(cf.location, 'grave', 'both destroyed');
    eq(g.monsters(1).filter((c) => c.name === 'Needle Token').length, 1, 'Needle Token on the opponent\'s field');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-gaia.html
  await test('Elemental Hero Gaia: needs an "Elemental Hero" (not a Destiny Hero); its Fusion Summon trigger is mandatory', async () => {
    const { g, place } = setup();
    const gaia = place(0, N('Elemental Hero Gaia'), 'extra');
    const brute = place(0, T.brute, 'mzone');
    const dhero = place(0, N('Destiny Hero - Malicious'), 'mzone');
    eq(g.fusionMaterialSets(gaia, [dhero, brute]).length, 0, 'Destiny Hero is not an Elemental Hero');
    const bubble = place(0, N('Elemental Hero Bubbleman'), 'mzone');
    eq(g.fusionMaterialSets(gaia, [bubble, brute]).length > 0, true, 'Elemental Hero + EARTH');
    eq(gaia.data.effects!.some((e) => e.kind === 'trigger' && e.mandatory), true, 'mandatory trigger');
  });

  // https://edisonrul.ing/cards/d/dandylion.html
  await test('Dandylion: its mandatory effect still activates when the Tokens cannot be Summoned', async () => {
    const { g, place } = setup();
    for (let i = 0; i < 4; i++) place(0, T.wall, 'mzone');
    const dl = place(0, N('Dandylion'), 'hand');
    await g.moveCards([dl], 'grave', { reason: 'effect', reasonPlayer: 0 });
    await g.processTriggers(true);
    eq(activatedLinks(g, dl), 1, 'activated');
    eq(g.monsters(0).filter((c) => c.name === 'Fluff Token').length, 0, 'no Token (2 or none)');
  });

  // https://edisonrul.ing/cards/d/dimensional-alchemist.html
  await test('Dimensional Alchemist: no salvage when destroyed under the opponent\'s control', async () => {
    const { g, place } = setup();
    const da = place(0, N('Dimensional Alchemist'), 'hand');
    g.rawMove(da, 'mzone', { controller: 1, faceUp: true, pos: 'atk' });
    const ban = place(0, T.brute, 'banished');
    await g.destroy([da], 'effect', 0);
    await g.processTriggers(true);
    eq(ban.location, 'banished', 'not returned to the hand');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
