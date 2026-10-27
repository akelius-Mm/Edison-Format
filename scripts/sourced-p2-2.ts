// Sourced rulings regression tests, phase 2 group 2 (Elemental HERO Chaos Neos .. Indomitable Gladiator Beast): each
// test pins a behaviour to the 2010 TCG text / rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/sourced-p2-2.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal, token } from '../src/cards/define';
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
  five: findCard('Sourced Level Five') ?? normal('Sourced Level Five', 'LIGHT', 'Fairy', 5, 2000, 1000),
  caster: findCard('Sourced Caster') ?? normal('Sourced Caster', 'DARK', 'Spellcaster', 4, 1500, 1000),
  even15: findCard('Sourced Even Fifteen') ?? normal('Sourced Even Fifteen', 'EARTH', 'Warrior', 4, 1500, 1000),
  fish: findCard('Sourced Fish') ?? normal('Sourced Fish', 'WATER', 'Fish', 4, 1000, 1000),
  tok: token('Sourced Token', 'EARTH', 'Warrior', 1, 2000, 0),
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
const battleEnd = async (g: Game) => {
  g.beginBatch();
  g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
  await g.processTriggers(true);
};
const setPhase = (g: Game, ph: string) => (g as any).setPhase(ph) as Promise<void>;
/** Records `probe(link)` when the opponent gets a response window while `card` is on top of the Chain. */
const spyTop =
  (card: CardInstance, probe: (top: any) => void): Responder =>
  (gg) => {
    const top = gg.chain[gg.chain.length - 1];
    if (top && top.card === card) probe(top);
    return null;
  };

(async () => {
  console.log('Sourced rulings tests: phase 2 group 2');

  // https://edisonrul.ing/cards/e/evil-hero-dark-gaia.html
  await test('Evil HERO Dark Gaia: the position change is mandatory; it cannot be Special Summoned from the GY', async () => {
    const { g, c0, place } = setup();
    c0.trigger = () => false;
    const gaia = place(0, N('Evil HERO Dark Gaia'), 'mzone');
    gaia.flags.baseAtk = 3000;
    place(1, T.wall, 'mzone', { pos: 'def' });
    const other = place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, gaia);
    eq(other.pos, 'atk', 'the other Defense Position monster was changed to Attack Position');
    const gy = place(0, N('Evil HERO Dark Gaia'), 'grave');
    eq((await g.specialSummon([gy], 0, { pos: 'atk' })).length, 0, 'not Special Summoned from the GY');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-captain-gold.html
  await test('Elemental Hero Captain Gold: destroyed without a Chain as soon as Skyscraper leaves', async () => {
    const { g, place } = setup();
    const sky = place(1, N('Skyscraper'), 'fzone');
    const gold = place(0, N('Elemental Hero Captain Gold'), 'mzone');
    await setPhase(g, 'main1');
    eq(gold.location, 'mzone', 'stays while Skyscraper is face-up');
    await g.destroy([sky], 'effect', 0);
    eq(gold.location, 'grave', 'destroyed');
    eq(activatedLinks(g, gold), 0, 'no Chain Link');
  });

  // https://edisonrul.ing/cards/e/emergency-assistance.html
  await test('Emergency Assistance: targets the monster on activation', async () => {
    const { g, c1, place } = setup();
    g.phase = 'main2';
    const m = place(0, T.brute, 'mzone');
    await g.destroy([m], 'effect', 1);
    const ea = place(0, N('Emergency Assistance'), 'hand');
    place(1, T.wall, 'mzone'); // a Book of Moon target, so the opponent gets a response window
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = spyTop(ea, (top) => (targeted = top.ctx.targets.includes(m)));
    await activate(g, 0, ea);
    eq(targeted, true, 'target chosen at activation');
    eq(m.location, 'mzone', 'Special Summoned');
  });

  // https://edisonrul.ing/cards/e/emissary-from-pandemonium.html
  await test('Emissary from Pandemonium: Normal Summon with 1 Tribute, but no 1-Tribute Set', async () => {
    const { g, place } = setup();
    place(0, T.brute, 'mzone');
    const em = place(0, N('Emissary from Pandemonium'), 'hand');
    eq(g.canNormalSummon(0, em, false), true, 'Normal Summon with 1 Tribute');
    eq(g.canNormalSummon(0, em, true), false, 'no Set with 1 Tribute');
  });

  // https://edisonrul.ing/cards/e/emperor-sem.html
  await test('Emperor Sem: optional, needs a card in your GY; each player targets 1 card', async () => {
    const a = setup();
    const sem = a.place(0, N('Emperor Sem'), 'mzone');
    const fod = a.place(0, T.brute, 'mzone');
    const five = a.place(0, T.five, 'hand');
    a.c0.pick = (_g, req) => (req.purpose === 'tribute' ? [fod] : req.candidates.slice(0, req.min));
    await a.g.performAction(0, { type: 'summon', card: five });
    eq(five.location, 'mzone', 'Tribute Summoned');
    eq(activatedLinks(a.g, sem), 1, "activated with an empty opponent's GY");
    eq(fod.location, 'deck', 'the Tributed monster returned to the top of the Deck');

    const b = setup();
    const sem2 = b.place(0, N('Emperor Sem'), 'mzone');
    const fod2 = b.place(0, T.brute, 'mzone');
    const mine = b.place(0, T.light, 'grave');
    const theirs = b.place(1, T.dark, 'grave');
    const five2 = b.place(0, T.five, 'hand');
    b.c0.pick = (_g, req) => (req.purpose === 'tribute' ? [fod2] : req.candidates.includes(mine) ? [mine] : req.candidates.slice(0, req.min));
    await b.g.performAction(0, { type: 'summon', card: five2 });
    eq(activatedLinks(b.g, sem2), 1, 'activated');
    eq(mine.location, 'deck', 'your card returned to the Deck');
    eq(theirs.location, 'deck', "the opponent's card returned to the Deck");

    const c = setup();
    const sem3 = c.place(0, N('Emperor Sem'), 'mzone');
    c.place(0, T.brute, 'mzone');
    const five3 = c.place(0, T.five, 'hand');
    c.c0.trigger = () => false;
    c.c0.pick = (_g, req) => (req.purpose === 'tribute' ? req.candidates.filter((x) => x !== sem3).slice(0, 1) : req.candidates.slice(0, req.min));
    await c.g.performAction(0, { type: 'summon', card: five3 });
    eq(activatedLinks(c.g, sem3), 0, 'optional: not activated when declined');
  });

  // https://edisonrul.ing/cards/e/enlightenment.html
  await test('Enlightenment: the Spellcaster-Type monster must survive the battle', async () => {
    const a = setup();
    const cast = a.place(0, T.caster, 'mzone');
    a.place(1, T.even15, 'mzone');
    a.place(0, N('Enlightenment'), 'szone', { faceUp: false });
    let offered = false;
    a.c0.respond = (_g, req) => {
      if (offers(req, 'Enlightenment')) offered = true;
      return null;
    };
    await a.g.conductAttack(0, cast);
    eq(cast.location, 'grave', 'both destroyed');
    eq(offered, false, 'not offered when the Spellcaster did not survive');

    const b = setup();
    const cast2 = b.place(0, T.caster, 'mzone');
    b.place(1, T.lightHitter, 'mzone');
    b.place(0, N('Enlightenment'), 'szone', { faceUp: false });
    let offered2 = false;
    b.c0.respond = (_g, req) => {
      if (offers(req, 'Enlightenment')) offered2 = true;
      return null;
    };
    await b.g.conductAttack(0, cast2);
    eq(offered2, true, 'offered when it survived');
  });

  // https://edisonrul.ing/cards/e/exchange-of-the-spirit.html
  await test('Exchange of the Spirit: only your GY needs 15 cards', async () => {
    const { g, place } = setup();
    for (let i = 0; i < 15; i++) place(0, T.wall, 'grave');
    const ex = place(0, N('Exchange of the Spirit'), 'szone', { faceUp: false });
    eq(g.players[1].grave.length, 0, "opponent's GY is empty");
    eq(canActivate(g, 0, ex), true, 'can be activated');
  });

  // https://edisonrul.ing/cards/f/fake-feather.html
  await test('Fake Feather: cannot be activated during the Damage Step', async () => {
    eq(!!N('Fake Feather').effects![0].damageStep, false, 'no Damage Step activation');
  });

  // https://edisonrul.ing/cards/f/faustian-bargain.html
  await test('Faustian Bargain: no Special Summon if the monster was not sent to the GY (Macro Cosmos)', async () => {
    const { g, place } = setup();
    place(1, N('Macro Cosmos'), 'szone', { faceUp: true });
    const ss = place(1, T.brute, 'mzone');
    ss.summonMethod = 'special';
    const nm = place(0, T.wall, 'hand');
    const fb = place(0, N('Faustian Bargain'), 'hand');
    await activate(g, 0, fb);
    eq(ss.location, 'banished', 'removed from play instead');
    eq(nm.location, 'hand', 'Normal Monster not Summoned');
  });

  // https://edisonrul.ing/cards/f/fish-depth-charge.html
  await test('Fish Depth Charge: targets 1 card your opponent controls', async () => {
    const { g, place } = setup();
    place(0, T.fish, 'mzone');
    place(0, N('Dust Tornado'), 'szone', { faceUp: false });
    const fdc = place(0, N('Fish Depth Charge'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, fdc), false, 'your own cards are not targets');
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, fdc), true, 'an opponent card is');
    await activate(g, 0, fdc);
    eq(st.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/f/flying-fortress-sky-fire.html
  await test('Flying Fortress SKY FIRE: the discard effect targets; all monsters Summoned together are destroyed', async () => {
    const a = setup();
    const sky = a.place(0, N('Flying Fortress SKY FIRE'), 'mzone');
    a.place(0, T.wall, 'hand');
    const st = a.place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    a.place(1, N('Book of Moon'), 'szone', { faceUp: false });
    a.c0.pick = (_g, req) => (req.candidates.includes(st) ? [st] : req.candidates.slice(0, req.min));
    let targeted = false;
    a.c1.respond = spyTop(sky, (top) => (targeted = top.ctx.targets.includes(st)));
    await activate(a.g, 0, sky, 'Discard: destroy 1 card');
    eq(targeted, true, 'target chosen at activation');
    eq(st.location, 'grave', 'destroyed');

    const b = setup();
    b.g.turnPlayer = 1;
    b.place(0, N('Flying Fortress SKY FIRE'), 'mzone');
    const goat = b.place(1, N('Scapegoat'), 'hand');
    b.c0.respond = respondWith('Flying Fortress SKY FIRE');
    await activate(b.g, 1, goat);
    eq(b.g.monsters(1).length, 0, 'all 4 tokens destroyed');
    eq(b.g.players[1].lp, 7200, '800 damage once');
  });

  // https://edisonrul.ing/cards/f/future-visions.html
  await test('Future Visions: the monster only returns while Future Visions is still face-up', async () => {
    for (const keep of [true, false]) {
      const { g, place } = setup();
      const fv = place(1, N('Future Visions'), 'fzone');
      const m = place(0, T.brute, 'hand');
      await g.performAction(0, { type: 'summon', card: m });
      eq(m.location, 'banished', 'removed from play');
      if (!keep) await g.destroy([fv], 'effect', 0);
      g.turn = 4;
      await setPhase(g, 'standby');
      eq(m.location, keep ? 'mzone' : 'banished', keep ? 'returned' : 'not returned without Future Visions');
    }
  });

  // https://edisonrul.ing/cards/g/gaap-the-divine-soldier.html
  await test('Gaap the Divine Soldier: revealing the Fiends is the cost', async () => {
    const { g, c1, place } = setup();
    const gaap = place(0, N('Gaap the Divine Soldier'), 'mzone');
    place(0, T.dark, 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let n: unknown;
    c1.respond = spyTop(gaap, (top) => (n = top.ctx.data.n));
    await activate(g, 0, gaap, 'Reveal Fiends');
    eq(n, 1, 'revealed on activation');
    eq(g.getAtk(gaap), 2500, '+300 ATK');
  });

  // https://edisonrul.ing/cards/g/gadget-hauler.html
  await test('Gadget Hauler: sending the Morphtronic monsters is not a cost', async () => {
    const { g, c1, place } = setup();
    const gh = place(0, N('Gadget Hauler'), 'mzone');
    const mm = place(0, N('Morphtronic Magnen'), 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let inHand: unknown;
    c1.respond = spyTop(gh, () => (inHand = mm.location === 'hand'));
    await activate(g, 0, gh);
    eq(inHand, true, 'still in the hand while the effect is on the Chain');
    eq(mm.location, 'grave', 'sent on resolution');
    eq(g.getAtk(gh), 2100, '+800 ATK');
  });

  // https://edisonrul.ing/cards/g/gemini-counter.html
  await test('Gemini Counter: targets the Gemini monster and flips it face-down on resolution', async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1;
    const gem = place(0, N('Future Samurai'), 'mzone');
    const gc = place(0, N('Gemini Counter'), 'szone', { faceUp: false });
    place(1, N('Dark Bribe'), 'szone', { faceUp: false });
    const dh = place(1, N('Dark Hole'), 'hand');
    c0.respond = respondWith('Gemini Counter');
    let up: unknown;
    let targeted = false;
    c1.respond = spyTop(gc, (top) => {
      up = gem.faceUp;
      targeted = top.ctx.targets.includes(gem);
    });
    await activate(g, 1, dh);
    eq(up, true, 'face-up while Gemini Counter is on the Chain');
    eq(targeted, true, 'targeted');
    eq(gem.faceUp, false, 'face-down after resolution');
    eq(gem.location, 'mzone', 'Dark Hole negated');
  });

  // https://edisonrul.ing/cards/g/gemini-booster.html
  await test('Gemini Booster: its GY effect activates when the equipped monster is destroyed by battle', async () => {
    const { g, c1, place } = setup();
    g.turnPlayer = 1;
    const g1 = place(0, N('Future Samurai'), 'mzone');
    const g2 = place(0, N('Gemini Lancer'), 'mzone');
    const gb = place(0, N('Gemini Booster'), 'szone', { faceUp: true });
    g.equip(gb, g1);
    gb.flags.staysOnField = true;
    eq(g.getAtk(g1), 2300, '+700 ATK');
    const big = place(1, T.big, 'mzone');
    c1.chooseAttackTarget = async () => g1;
    await g.conductAttack(1, big);
    eq(g1.location, 'grave', 'equipped monster destroyed');
    eq(gb.location, 'grave', 'Gemini Booster destroyed');
    eq(!!g2.flags.geminiSummoned, true, 'the other Gemini monster is now an Effect Monster');
    eq(!!N('Gemini Booster').effects![0].damageStep, true, 'can be activated in the Damage Step');
  });

  // https://edisonrul.ing/cards/g/ghost-gardna.html
  await test('Ghost Gardna: the ATK loss targets on activation', async () => {
    const { g, c1, place } = setup();
    const gg = place(0, N('Ghost Gardna'), 'mzone');
    const foe = place(1, T.brute, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = spyTop(gg, (top) => (targeted = top.ctx.targets.includes(foe)));
    await g.destroy([gg], 'effect', 1);
    await g.processTriggers(true);
    eq(targeted, true, 'targeted');
    eq(g.getAtk(foe), 800, '-1000 ATK');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-alexander.html (same ruling on Dimacari / Gaiodiaz)
  await test('Gladiator Beast tag-out: not after a negated attack (no damage calculation)', async () => {
    const a = setup();
    const dima = a.place(0, N('Gladiator Beast Dimacari'), 'mzone');
    a.place(0, N('Gladiator Beast Torax'), 'deck');
    a.place(1, T.lightHitter, 'mzone');
    a.place(1, N('Negate Attack'), 'szone', { faceUp: false });
    a.c1.respond = respondWith('Negate Attack');
    await a.g.conductAttack(0, dima);
    await battleEnd(a.g);
    eq(dima.location, 'mzone', 'no tag-out');

    const b = setup();
    const dima2 = b.place(0, N('Gladiator Beast Dimacari'), 'mzone');
    const torax = b.place(0, N('Gladiator Beast Torax'), 'deck');
    b.place(1, T.lightHitter, 'mzone');
    await b.g.conductAttack(0, dima2);
    await battleEnd(b.g);
    eq(dima2.location, 'deck', 'tagged out after battling');
    eq(torax.location, 'mzone', 'Torax Special Summoned');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-gaiodiaz.html
  await test('Gladiator Beast Gaiodiaz: face-down Fusion Material Monsters can be used', async () => {
    const { g, place } = setup();
    place(0, N('Gladiator Beast Spartacus'), 'mzone', { faceUp: false, pos: 'def' });
    place(0, N('Gladiator Beast Torax'), 'mzone');
    const gaio = place(0, N('Gladiator Beast Gaiodiaz'), 'extra');
    eq(g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === gaio), true, 'Contact Fusion available');
  });

  // https://edisonrul.ing/cards/g/gladiator-beasts-respite.html
  await test('Gladiator Beast\'s Respite: any card with "Gladiator Beast" in its name can be returned', async () => {
    const { g, place } = setup();
    const r = place(0, N("Gladiator Beast's Respite"), 'hand');
    const a = place(0, N("Gladiator Beast's Battle Gladius"), 'hand');
    const b = place(0, N("Gladiator Beast's Battle Manica"), 'hand');
    eq(canActivate(g, 0, r), true, 'can be activated');
    await activate(g, 0, r);
    eq(a.location, 'deck', 'Gladius returned');
    eq(b.location, 'deck', 'Manica returned');
    eq(g.players[0].hand.length, 3, 'drew 3');
  });

  // https://edisonrul.ing/cards/g/golden-ladybug.html
  await test('Golden Ladybug: revealing it is the cost', async () => {
    const { g, c1, place } = setup();
    const lb = place(0, N('Golden Ladybug'), 'hand');
    place(1, T.wall, 'mzone'); // a Book of Moon target, so the opponent gets a response window
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let shown: unknown;
    c1.respond = spyTop(lb, () => (shown = lb.revealedUntil === g.turn));
    await setPhase(g, 'standby');
    eq(shown, true, 'revealed on activation');
    eq(g.players[0].lp, 8500, '+500 LP');
  });

  // https://edisonrul.ing/cards/g/gozen-match.html
  await test('Gozen Match: Tribute Summon of another Attribute by Tributing the face-up monster', async () => {
    const { g, place } = setup();
    place(1, N('Gozen Match'), 'szone', { faceUp: true });
    place(0, T.dark, 'mzone');
    const five = place(0, T.five, 'hand');
    const four = place(0, T.light, 'hand');
    eq(g.canNormalSummon(0, five, false), true, 'LIGHT Tribute Summon by Tributing the DARK monster');
    eq(g.canNormalSummon(0, four, false), false, 'LIGHT monster without Tribute still blocked');
  });

  // https://edisonrul.ing/cards/g/guardian-eatos.html
  await test("Guardian Eatos: an opponent's Equip Spell equipped to it can be sent as the cost", async () => {
    const { g, place } = setup();
    const eatos = place(0, N('Guardian Eatos'), 'mzone');
    const fs = place(1, N('Fighting Spirit'), 'szone', { faceUp: true });
    g.equip(fs, eatos);
    const m = place(1, T.brute, 'grave');
    eq(canActivate(g, 0, eatos), true, 'can be activated');
    await activate(g, 0, eatos);
    eq(fs.location, 'grave', 'Equip Spell sent');
    eq(m.location, 'banished', 'removed from play');
    eq(g.getAtk(eatos), 3000, '+500 ATK');
  });

  // https://edisonrul.ing/cards/h/hand-destruction.html
  await test('Hand Destruction: the cards are sent to the GY, not discarded', async () => {
    const { g, place } = setup();
    const hd = place(0, N('Hand Destruction'), 'hand');
    for (const p of [0, 1] as PlayerId[]) for (let i = 0; i < 2; i++) place(p, T.wall, 'hand');
    const before = g.eventLog.length;
    await activate(g, 0, hd);
    eq(g.eventLog.slice(before).filter((e) => e.type === 'discarded').length, 0, 'no discard');
    eq(g.players[0].hand.length, 2, 'drew 2');
    eq(g.players[1].grave.length, 2, 'opponent sent 2');
  });

  // https://edisonrul.ing/cards/h/hate-buster.html
  await test('Hate Buster: a Monster Token deals no damage', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const fiend = place(0, T.dark, 'mzone');
    place(0, N('Hate Buster'), 'szone', { faceUp: false });
    const tok = place(1, T.tok, 'mzone');
    c0.respond = respondWith('Hate Buster');
    await g.conductAttack(1, tok);
    eq(fiend.location, 'grave', 'your Fiend destroyed');
    eq(tok.location === 'mzone', false, 'Token destroyed');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/h/herculean-power.html
  await test('Herculean Power: no Summon if your opponent controls no monster on resolution', async () => {
    const { g, c1, place } = setup();
    const hp = place(0, N('Herculean Power'), 'szone', { faceUp: true });
    const gem = place(0, N('Future Samurai'), 'hand');
    place(1, T.brute, 'mzone');
    place(1, N('Compulsory Evacuation Device'), 'szone', { faceUp: false });
    c1.respond = respondWith('Compulsory Evacuation Device');
    await activate(g, 0, hp);
    eq(g.monsters(1).length, 0, 'opponent monster bounced');
    eq(gem.location, 'hand', 'no Special Summon');
  });

  // https://edisonrul.ing/cards/h/hero-barrier.html
  await test("Hero Barrier: activated before an attack, it negates the opponent's first attack this turn", async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const hb = place(0, N('Hero Barrier'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, hb), true, 'can be activated with no Elemental Hero');
    const spark = place(0, N('Elemental Hero Sparkman'), 'mzone');
    await activate(g, 0, hb);
    const big = place(1, T.big, 'mzone');
    await g.conductAttack(1, big);
    eq(spark.location, 'mzone', 'attack negated');
    eq(g.players[0].lp, 8000, 'no damage');
    const big2 = place(1, T.big, 'mzone');
    await g.conductAttack(1, big2);
    eq(spark.location, 'grave', 'only once');
  });

  // https://edisonrul.ing/cards/i/ice-queen.html
  await test('Ice Queen: cannot be Special Summoned from the GY (a condition, not an effect)', async () => {
    const { g, place } = setup();
    const iq = place(0, N('Ice Queen'), 'grave');
    eq((await g.specialSummon([iq], 0, { pos: 'atk' })).length, 0, 'not Summoned');
    eq(activatedLinks(g, iq), 0, 'no Chain Link');
  });

  // https://edisonrul.ing/cards/i/ido-the-supreme-magical-force.html
  await test('Ido the Supreme Magical Force: returns during YOUR next Standby Phase', async () => {
    const { g, place } = setup();
    const ido = place(0, N('Ido the Supreme Magical Force'), 'mzone');
    await g.destroy([ido], 'effect', 1);
    eq(ido.location, 'grave', 'destroyed on your turn');
    g.turn = 3;
    g.turnPlayer = 1;
    await setPhase(g, 'standby');
    eq(ido.location, 'grave', "not during the opponent's Standby Phase");
    g.turn = 4;
    g.turnPlayer = 0;
    await setPhase(g, 'standby');
    eq(ido.location, 'mzone', 'during your next Standby Phase');
  });

  // https://edisonrul.ing/cards/i/imperial-custom.html
  await test('Imperial Custom: Trap Monsters protected; an unpaid Imperial Order is still destroyed', async () => {
    const { g, place } = setup();
    place(0, N('Imperial Custom'), 'szone', { faceUp: true });
    const zoma = place(0, N('Zoma the Spirit'), 'mzone');
    await g.destroy([zoma], 'effect', 1);
    eq(zoma.location, 'mzone', 'Trap Monster not destroyed');
    const io = place(0, N('Imperial Order'), 'szone', { faceUp: true });
    g.players[0].lp = 500;
    await setPhase(g, 'standby');
    eq(io.location, 'grave', 'Imperial Order destroyed for its unpaid maintenance');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();

