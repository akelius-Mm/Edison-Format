// Sourced rulings: Necrovalley (2010 text) and the shared-mechanics pages in edisonrul.ing/cards/misc/.
// Source for every test: the edisonrul.ing card page named in the test (historical 2010 TCG section).
// Usage: npx tsx scripts/sourced-necrovalley.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game, GameOver, type ChainLink } from '../src/engine/game';
import type { BattlePos, GameEvent, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Sourced Test Dark') ?? normal('Sourced Test Dark', 'DARK', 'Fiend', 4, 1000, 1000),
  big: findCard('Sourced Test Big') ?? normal('Sourced Test Big', 'EARTH', 'Rock', 4, 2300, 1000),
  knight: findCard('Sourced Test Knight') ?? normal('Sourced Test Knight', 'EARTH', 'Warrior', 4, 2600, 1000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  option: (req: OptionRequest) => number = () => 0;
  trigger: (act: Activation) => boolean = () => true;
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption(_g: Game, _p: PlayerId, req: OptionRequest) {
    return this.option(req);
  }
  async confirm() {
    return true;
  }
  async confirmTrigger(_g: Game, _p: PlayerId, act: Activation) {
    return this.trigger(act);
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
  /** A face-up Continuous Spell/Trap or Field Spell that already resolved. */
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  return { g, c0, c1, place, live };
}

const N = (n: string) => cardByName(n);
const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;
const pickOnly = (c: TestController, want: CardInstance[]) => {
  c.pick = (_g, req) => {
    const w = req.candidates.filter((x) => want.includes(x));
    return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
  };
};
const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
async function activate(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
/** Chain links activated for `card` (from the event log). */
const linksOf = (g: Game, card: CardInstance): ChainLink[] =>
  g.eventLog.filter((e: GameEvent) => e.type === 'chainActivated' && (e.data?.link as ChainLink | undefined)?.card === card).map((e) => e.data.link as ChainLink);
function beforeResolve(g: Game, fn: () => void | Promise<void>) {
  const orig = (g as any).resolveChain.bind(g);
  let done = false;
  (g as any).resolveChain = async (...a: any[]) => {
    if (!done) {
      done = true;
      await fn();
    }
    return orig(...a);
  };
}
const standby = async (g: Game, p: PlayerId) => {
  g.turnPlayer = p;
  g.phase = 'standby';
  g.beginBatch();
  g.emit({ type: 'phaseStart', phase: 'standby', player: p } as any);
  await g.processTriggers(true);
  g.phase = 'main1';
};
const setPhase = (g: Game, ph: string) => (g as any).setPhase(ph);
const URL = (l: string, slug: string) => `https://edisonrul.ing/cards/${l}/${slug}.html`;
void URL;

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


const MISC = (slug: string) => `https://edisonrul.ing/cards/misc/${slug}.html`;
void MISC;
const valleyFor = (s: ReturnType<typeof setup>, p: PlayerId = 1) => s.live(s.place(p, N('Necrovalley'), 'fzone'));

(async () => {
  console.log('Sourced rulings tests: Necrovalley + misc mechanics');

  // ---------------------------------------------------------------- Necrovalley: negates effects that TARGET the GY
  // https://edisonrul.ing/cards/n/necrovalley.html (+ each card's page)

  // https://edisonrul.ing/cards/d/debris-dragon.html
  await test('Necrovalley: Debris Dragon (targets a monster in the GY) is negated', async () => {
    const s = setup();
    valleyFor(s);
    const dd = s.place(0, N('Debris Dragon'), 'hand');
    const t = s.place(0, N('Lonefire Blossom'), 'grave');
    await s.g.performAction(0, { type: 'summon', card: dd });
    eq(linksOf(s.g, dd).length, 1, 'it activates');
    eq(linksOf(s.g, dd)[0].negated, true, 'negated by Necrovalley');
    eq(t.location, 'grave', 'the target stays in the GY');
  });

  // https://edisonrul.ing/cards/p/pot-of-avarice.html
  await test('Necrovalley: Pot of Avarice (targets 5 monsters in the GY) is negated', async () => {
    const s = setup();
    valleyFor(s);
    const gy = Array.from({ length: 5 }, () => s.place(0, T.brute, 'grave'));
    const pot = s.place(0, N('Pot of Avarice'), 'hand');
    const hand = s.g.players[0].hand.length;
    await activate(s.g, 0, pot);
    eq(gy.every((c) => c.location === 'grave'), true, 'the monsters stay in the GY');
    eq(s.g.players[0].hand.length, hand - 1, 'no draw');
  });

  // https://edisonrul.ing/cards/n/night-assailant.html
  await test("Necrovalley: Night Assailant's GY effect (targets a Flip monster) is negated", async () => {
    const s = setup();
    valleyFor(s);
    const na = s.place(0, N('Night Assailant'), 'hand');
    const flip = s.place(0, N("Gravekeeper's Spy"), 'grave');
    s.g.beginBatch();
    await s.g.moveCards([na], 'grave', { reason: 'effect', reasons: ['effect', 'discard'], reasonPlayer: 0 });
    await s.g.processTriggers(true);
    eq(linksOf(s.g, na).length, 1, 'it activates');
    eq(flip.location, 'grave', 'the Flip monster stays in the GY');
  });

  // https://edisonrul.ing/cards/l/lumina-lightsworn-summoner.html
  await test('Necrovalley: Lumina (targets a Lightsworn in the GY) is negated', async () => {
    const s = setup();
    valleyFor(s);
    const lumina = s.place(0, N('Lumina, Lightsworn Summoner'), 'mzone');
    s.place(0, T.wall, 'hand');
    const ryko = s.place(0, N('Ryko, Lightsworn Hunter'), 'grave');
    pickOnly(s.c0, [ryko]);
    await activate(s.g, 0, lumina);
    eq(ryko.location, 'grave', 'the Lightsworn stays in the GY');
  });

  await test("Gravekeeper's Priestess (field treated as Necrovalley): Monster Reborn negated, Plaguespreader Zombie is not", async () => {
    const s = setup();
    s.place(1, N("Gravekeeper's Priestess"), 'mzone');
    const dead = s.place(0, T.brute, 'grave');
    await activate(s.g, 0, s.place(0, N('Monster Reborn'), 'hand'));
    eq(dead.location, 'grave', 'Monster Reborn negated');
    const pz = s.place(0, N('Plaguespreader Zombie'), 'grave');
    s.place(0, T.wall, 'hand');
    await activate(s.g, 0, pz);
    eq(pz.location, 'mzone', 'Plaguespreader Zombie (does not target) Special Summons itself');
  });

  // ---------------------------------------------------------------- not negated: no target in the GY

  // https://edisonrul.ing/cards/p/plaguespreader-zombie.html
  await test('Necrovalley: Plaguespreader Zombie is not negated', async () => {
    const s = setup();
    valleyFor(s);
    const pz = s.place(0, N('Plaguespreader Zombie'), 'grave');
    s.place(0, T.wall, 'hand');
    await activate(s.g, 0, pz);
    eq(pz.location, 'mzone', 'Special Summoned from the GY');
  });

  // https://edisonrul.ing/cards/g/gigaplant.html
  await test('Necrovalley: Gigaplant (Gemini Summoned) Special Summons a Plant from the GY', async () => {
    const s = setup();
    valleyFor(s);
    const gp = s.place(0, N('Gigaplant'), 'mzone');
    const plant = s.place(0, N('Lonefire Blossom'), 'grave');
    await s.g.geminiSummon(0, gp);
    pickOnly(s.c0, [plant]);
    await activate(s.g, 0, gp, 'Summon an Insect/Plant from hand or GY');
    eq(plant.location, 'mzone', 'Summoned from the GY');
  });

  // https://edisonrul.ing/cards/v/vampire-lord.html
  await test('Necrovalley: Vampire Lord Special Summons itself in the next Standby Phase', async () => {
    const s = setup();
    valleyFor(s);
    const vl = s.place(0, N('Vampire Lord'), 'mzone');
    const src = s.place(1, T.brute, 'mzone');
    s.g.beginBatch();
    await s.g.destroy([vl], 'effect', 1, src);
    await s.g.processTriggers(true);
    eq(vl.location, 'grave', "destroyed by the opponent's card effect");
    s.g.turn += 2;
    s.g.turnPlayer = 0;
    await setPhase(s.g, 'standby');
    eq(vl.location, 'mzone', 'Special Summoned despite Necrovalley');
  });

  // https://edisonrul.ing/cards/n/necrovalley.html: "Cards in the Graveyard can have their Type / Attribute changed by
  // card effects that do not target."
  await test('Necrovalley: Zombie World still makes monsters in the GY Zombie-Type', async () => {
    const s = setup();
    const gy = s.place(0, T.brute, 'grave');
    s.live(s.place(0, N('Zombie World'), 'fzone'));
    s.live(s.place(1, N('Necrovalley'), 'fzone'));
    eq(gy.data.race, 'Zombie', 'Zombie in the GY');
  });

  // ---------------------------------------------------------------- "cannot be removed from play"

  // https://edisonrul.ing/cards/t/tongue-twister.html
  await test('Necrovalley: Tongue Twister draws 2, then fails to remove itself from play', async () => {
    const s = setup();
    valleyFor(s);
    const tt = s.place(0, N('Tongue Twister'), 'hand');
    s.place(0, T.brute, 'mzone');
    s.place(0, T.brute, 'mzone');
    await s.g.performAction(0, { type: 'summon', card: tt });
    eq(tt.location, 'mzone', 'Tribute Summoned');
    const hand = s.g.players[0].hand.length;
    s.g.beginBatch();
    await s.g.destroy([tt], 'effect', 1);
    await s.g.processTriggers(true);
    eq(s.g.players[0].hand.length, hand + 2, 'drew 2');
    eq(tt.location, 'grave', 'stays in the GY');
  });

  // https://edisonrul.ing/cards/d/djinn-releaser-of-rituals.html
  await test('Necrovalley: Djinn Releaser of Rituals cannot be removed from the GY as Ritual material', async () => {
    const s = setup();
    const rog = s.place(0, N('Ritual of Grace'), 'hand');
    s.place(0, N('Divine Grace - Northwemko'), 'hand');
    s.place(0, T.brute, 'hand');
    s.place(0, N('Djinn Releaser of Rituals'), 'grave');
    eq(offered(s.g, 0, rog), true, 'without Necrovalley: brute (4) + Djinn (3) make 7 Levels');
    valleyFor(s);
    eq(offered(s.g, 0, rog), false, 'under Necrovalley the Djinn in the GY cannot be used');
  });

  // https://edisonrul.ing/cards/e/exchange-of-the-spirit.html
  await test('Necrovalley negates Exchange of the Spirit', async () => {
    const s = setup();
    valleyFor(s);
    for (let i = 0; i < 15; i++) {
      s.place(0, T.brute, 'grave');
      s.place(1, T.brute, 'grave');
    }
    const ex = s.place(0, N('Exchange of the Spirit'), 'szone', { faceUp: false });
    await activate(s.g, 0, ex);
    eq(s.g.players[0].grave.filter((c) => c.name === T.brute.name).length, 15, 'the GY is not swapped');
  });

  // ---------------------------------------------------------------- Gemini monsters
  // https://edisonrul.ing/cards/misc/gemini-monsters-gigaplant-elemental-hero-neos-alius-etc.html

  await test('Gemini Summon: a main action that does not start a chain; uses the Normal Summon; not under Skill Drain', async () => {
    const s = setup();
    const gp = s.place(0, N('Gigaplant'), 'mzone');
    const act = s.g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === gp);
    eq(!!act, true, 'offered as a main action');
    eq(s.g.getActivations(0, { open: true }).some((a) => a.card === gp), false, 'not an activated effect');
    await s.g.performAction(0, act!);
    eq(linksOf(s.g, gp).length, 0, 'no chain link');
    eq(!!gp.flags.geminiSummoned, true, 'Gemini Summoned');
    eq(s.g.players[0].normalSummonsLeft, 0, 'the Normal Summon is used');
    eq(
      s.g.eventLog.some((e) => e.type === 'normalSummoned' && e.card === gp),
      true,
      'counts as a Normal Summon',
    );
    const k = setup();
    const gp2 = k.place(0, N('Gigaplant'), 'mzone');
    k.live(k.place(1, N('Skill Drain'), 'szone'));
    eq(k.g.canGeminiSummon(0, gp2), false, 'Skill Drain: cannot Gemini Summon');
  });

  // Fuzz regression (seed 5 game 10, seed 6 game 18): a Gemini Summon keeps the monster in its zone, so the fuzzer took
  // a successful one for a fizzle. Whenever it is offered it must work: the monster stays put and becomes an Effect Monster.
  await test('Gemini Summon: offered for a Gemini monster summoned this turn, and it works in place (Il Blud, Neos Alius)', async () => {
    for (const name of ['Il Blud', 'Elemental Hero Neos Alius']) {
      const s = setup();
      const m = s.place(0, N(name), 'mzone');
      m.summonTurn = s.g.turn; // Special / Flip Summoned earlier this turn
      const act = s.g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === m && a.act.effect.geminiSummon);
      eq(!!act, true, `${name}: offered`);
      const moveId = m.moveId;
      await s.g.performAction(0, act!);
      eq(m.location, 'mzone', `${name}: stays on the field`);
      eq(m.moveId, moveId, `${name}: same card instance`);
      eq(!!m.flags.geminiSummoned, true, `${name}: Gemini Summoned`);
      eq(s.g.players[0].normalSummonsLeft, 0, `${name}: the Normal Summon is used`);
      eq(
        s.g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === m && a.act.effect.geminiSummon),
        false,
        `${name}: not offered again`,
      );
    }
  });

  await test('Gemini Summon: Solemn Judgment can negate it, destroying the Gemini monster', async () => {
    const s = setup();
    const gp = s.place(0, N('Gigaplant'), 'mzone');
    s.place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    s.c1.respond = respondWith('Solemn Judgment');
    await s.g.geminiSummon(0, gp);
    eq(gp.location, 'grave', 'destroyed');
    eq(s.g.players[1].lp, 4000, 'Solemn Judgment paid half');
  });

  // ---------------------------------------------------------------- Battle tutors
  // https://edisonrul.ing/cards/misc/battle-tutors-mystic-tomato-shining-angel-ufo-turtle-mother-grizzly-flying-kaminari-1-giant-rat-pyramid-turtle-etc.html
  await test('Battle tutors: "When ... you can" (can miss the timing); still recruit after a battle', async () => {
    for (const n of ['Mystic Tomato', 'Shining Angel', 'Giant Rat', 'Mother Grizzly', 'Pyramid Turtle']) {
      eq(N(n).effects?.some((ef) => ef.kind === 'trigger' && ef.categories?.includes('specialSummon') && ef.when === true), true, n);
    }
    const s = setup();
    const tomato = s.place(0, N('Mystic Tomato'), 'mzone');
    const dark = s.place(0, T.dark, 'deck');
    const big = s.place(1, T.big, 'mzone');
    s.g.turnPlayer = 1;
    s.g.phase = 'battle';
    await s.g.conductAttack(1, big);
    eq(tomato.location, 'grave', 'destroyed by battle');
    eq(dark.location, 'mzone', 'recruits');
  });

  // ---------------------------------------------------------------- Trap Monsters
  // https://edisonrul.ing/cards/misc/trap-monsters.html
  await test('Trap Monsters: an activated Trap Monster also uses up 1 Spell & Trap Zone', async () => {
    const s = setup();
    const zoma = s.place(0, N('Zoma the Spirit'), 'szone', { faceUp: false });
    eq(s.g.freeSZones(0), 4, 'Set: 1 zone used');
    await activate(s.g, 0, zoma);
    eq(zoma.location, 'mzone', 'Special Summoned');
    eq(s.g.freeSZones(0), 4, 'still 1 Spell & Trap Zone used');
  });

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
