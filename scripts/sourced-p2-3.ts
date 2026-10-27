// Sourced rulings sweep, phase 2 group 3 (Infernity Beast .. Natural Tune): one regression test per fix.
// Source for every test: the edisonrul.ing card page named above it (historical 2010 TCG section).
// Usage: npx tsx scripts/sourced-p2-3.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal, token } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
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
  big: findCard('Sourced Big Brute') ?? normal('Sourced Big Brute', 'EARTH', 'Warrior', 4, 2500, 1000),
  twelve: findCard('Sourced P2-3 Twelve') ?? normal('Sourced P2-3 Twelve', 'LIGHT', 'Warrior', 4, 1200, 1000),
  zero: findCard('Sourced P2-3 Zero') ?? normal('Sourced P2-3 Zero', 'EARTH', 'Warrior', 4, 0, 0),
  titan: findCard('Sourced P2-3 Titan') ?? normal('Sourced P2-3 Titan', 'EARTH', 'Warrior', 4, 5000, 1000),
  eight: findCard('Sourced P2-3 Eight') ?? normal('Sourced P2-3 Eight', 'EARTH', 'Dragon', 8, 2000, 1000),
  psychic: findCard('Sourced P2-3 Psychic') ?? normal('Sourced P2-3 Psychic', 'EARTH', 'Psychic', 4, 1000, 1000),
  tok: findCard('Sourced P2-3 Token') ?? token('Sourced P2-3 Token', 'EARTH', 'Warrior', 1, 0, 0),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  trigger: (g: Game) => boolean = () => true;
  option: (g: Game, req: OptionRequest) => number = () => 0;
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption(g: Game, _p: PlayerId, req: OptionRequest) {
    return this.option(g, req);
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
  aim: CardInstance | null = null;
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    if (this.aim && targets.includes(this.aim)) return this.aim;
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
/** Records, from a response window, the targets the given card's Chain Link had at activation. */
function watchTargets(card: () => CardInstance | undefined) {
  const seen: CardInstance[][] = [];
  const responder: Responder = (g) => {
    const c = card();
    for (const l of g.chain) if (l.card === c) seen.push([...l.ctx.targets]);
    return null;
  };
  return { seen, responder };
}

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
    fail++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
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
const setPhase = (g: Game, ph: 'standby' | 'end') => (g as any).setPhase(ph) as Promise<void>;
/** A Set "Book of Moon", so that player gets a response window whenever a face-up monster is on the field. */
const windowFor = (place: ReturnType<typeof setup>['place'], p: PlayerId) => place(p, N('Book of Moon'), 'szone', { faceUp: false });

(async () => {
  console.log('Sourced rulings tests: phase 2, group 3');

  // https://edisonrul.ing/cards/i/infernity-force.html
  await test('Infernity Force: targets the attacker and a GY "Infernity"; the attacker is destroyed even if the GY target is gone', async () => {
    for (const gone of [false, true]) {
      const { g, c0, c1, place } = setup();
      const necro = place(1, N('Infernity Necromancer'), 'mzone', { pos: 'def' });
      const beast = place(1, N('Infernity Beast'), 'grave');
      place(1, N('Infernity Force'), 'szone', { faceUp: false });
      windowFor(place, 0);
      const brute = place(0, T.brute, 'mzone');
      const w = watchTargets(() => g.chain.find((l) => l.card.name === 'Infernity Force')?.card);
      c1.respond = respondWith('Infernity Force');
      c0.respond = (gg, req) => {
        w.responder(gg, req);
        if (gone && beast.location === 'grave') gg.rawMove(beast, 'banished');
        return null;
      };
      await g.conductAttack(0, brute);
      eq(w.seen.some((t) => t.includes(brute) && t.includes(beast)), true, 'both targeted at activation');
      eq(brute.location, 'grave', 'attacker destroyed');
      eq(beast.location, gone ? 'banished' : 'mzone', 'GY target Special Summoned unless it left');
      eq(necro.location, 'mzone', 'attack target untouched');
    }
  });

  // https://edisonrul.ing/cards/i/inferno-reckless-summon.html
  await test('Inferno Reckless Summon: not for a Token; the opponent cannot choose a Token', async () => {
    const a = setup();
    a.place(1, T.brute, 'mzone');
    const irs = a.place(0, N('Inferno Reckless Summon'), 'hand');
    await a.g.createTokens(0, T.tok, 1, 'atk');
    eq(canActivate(a.g, 0, irs), false, 'not offered for a Token');

    const b = setup();
    await b.g.createTokens(1, T.tok, 1, 'atk');
    const cipher = b.place(0, N('Cipher Soldier'), 'hand');
    const copy = b.place(0, N('Cipher Soldier'), 'deck');
    const irs2 = b.place(0, N('Inferno Reckless Summon'), 'hand');
    await b.g.specialSummon([cipher], 0, { pos: 'atk' });
    await activate(b.g, 0, irs2);
    eq(copy.location, 'mzone', 'you still Special Summon your copies');
    eq(b.g.monsters(1).length, 1, 'the opponent (only a Token face-up) Special Summons nothing');
  });

  // https://edisonrul.ing/cards/i/informer-spider.html
  await test('Informer Spider: targets a Defense Position monster; with no open zone the target is destroyed', async () => {
    const { g, c1, place } = setup();
    const spider = place(0, N('Informer Spider'), 'mzone');
    await g.takeControl(spider, 1, false);
    for (let i = 0; i < 5; i++) place(0, T.wall, 'mzone');
    const def = place(1, T.wall, 'mzone', { pos: 'def' });
    windowFor(place, 1);
    const w = watchTargets(() => spider);
    c1.respond = w.responder;
    await g.destroy([spider], 'effect', 1);
    await g.processTriggers(true);
    eq(w.seen.some((t) => t.includes(def)), true, 'targeted at activation');
    eq(def.location, 'grave', 'destroyed: no zone to take it');
  });

  // https://edisonrul.ing/cards/i/interplanetary-invader-a.html
  await test('Interplanetary Invader "A": no control if the attack is negated; destroyed if there is no open zone', async () => {
    const a = setup();
    const inv = a.place(1, N('Interplanetary Invader "A"'), 'mzone');
    const brute = a.place(0, T.brute, 'mzone');
    windowFor(a.place, 1);
    a.c1.respond = (gg) => {
      if (gg.battle && !gg.battle.inDamageStep) gg.battle.negated = true;
      return null;
    };
    await a.g.conductAttack(0, brute);
    await battleEnd(a.g);
    eq(inv.location, 'mzone', 'Invader not attacked');
    eq(brute.controller, 0, 'attack negated: no control change');

    const b = setup();
    b.c0.aim = b.place(1, N('Interplanetary Invader "A"'), 'mzone');
    for (let i = 0; i < 4; i++) b.place(1, T.wall, 'mzone', { pos: 'def' });
    const zero = b.place(0, T.zero, 'mzone');
    await b.g.conductAttack(0, zero);
    await battleEnd(b.g);
    eq(zero.location, 'grave', 'no open Monster Card Zone: destroyed');
  });

  // https://edisonrul.ing/cards/i/iron-chain-repairman.html
  await test('Iron Chain Repairman: cannot use its revival effect after it attacked this turn', async () => {
    const { g, place } = setup();
    const rep = place(0, N('Iron Chain Repairman'), 'mzone');
    place(0, N('Iron Chain Snake'), 'grave');
    eq(canActivate(g, 0, rep), true, 'available before attacking');
    await g.conductAttack(0, rep);
    eq(canActivate(g, 0, rep), false, 'not after attacking');
  });

  // https://edisonrul.ing/cards/i/iron-core-specimen-lab.html
  await test("Iron Core Specimen Lab: 2 of your Koa'ki Meiru destroyed together in the End Phase give 1 search", async () => {
    const { g, place } = setup();
    place(0, N('Iron Core Specimen Lab'), 'fzone');
    const a = place(0, N("Koa'ki Meiru Sea Panther"), 'mzone');
    const b = place(0, N("Koa'ki Meiru Ice"), 'mzone');
    place(0, N("Koa'ki Meiru Tornado"), 'deck');
    place(0, N("Koa'ki Meiru Speeder"), 'deck');
    g.phase = 'end';
    await g.destroy([a, b], 'effect', 1);
    await g.processTriggers(true);
    eq(g.players[0].hand.filter((c) => c.name.startsWith("Koa'ki")).length, 1, "one Koa'ki Meiru added");
  });

  // https://edisonrul.ing/cards/j/jade-knight.html
  await test('Jade Knight: no search when it was attacked face-down and destroyed; searches when face-up', async () => {
    for (const faceDown of [true, false]) {
      const { g, place } = setup();
      g.turnPlayer = 1;
      place(0, N('Jade Knight'), 'mzone', faceDown ? { faceUp: false, pos: 'def' } : { pos: 'def' });
      const target = place(0, N('Jade Knight'), 'deck');
      const big = place(1, T.big, 'mzone');
      await g.conductAttack(1, big);
      eq(target.location, faceDown ? 'deck' : 'hand', `searched (face-down when attacked: ${faceDown})`);
    }
  });

  // https://edisonrul.ing/cards/j/jester-confit.html
  await test('Jester Confit: neither returns if the target is no longer face-up; it activates with no target', async () => {
    const a = setup();
    a.g.turnPlayer = 1;
    const confit = a.place(0, N('Jester Confit'), 'mzone');
    confit.flags.confitTurn = 1;
    const t = a.place(1, T.brute, 'mzone');
    windowFor(a.place, 1);
    a.c1.respond = (gg) => {
      if (gg.chain.some((l) => l.card === confit)) t.faceUp = false;
      return null;
    };
    await setPhase(a.g, 'end');
    eq(confit.location, 'mzone', 'Confit stays (target not face-up)');
    eq(t.location, 'mzone', 'target stays');

    const b = setup();
    b.g.turnPlayer = 1;
    const confit2 = b.place(0, N('Jester Confit'), 'mzone');
    confit2.flags.confitTurn = 1;
    await setPhase(b.g, 'end');
    eq(activatedLinks(b.g, confit2), 1, 'activates with no face-up opponent monster');
    eq(confit2.location, 'mzone', 'nothing returns');
  });

  // https://edisonrul.ing/cards/j/jinzo-returner.html
  await test('Jinzo - Returner: the Special Summoned "Jinzo" is not destroyed if it was flipped face-down', async () => {
    const { g, place } = setup();
    const ret = place(0, N('Jinzo - Returner'), 'mzone');
    const jinzo = place(0, N('Jinzo'), 'grave');
    await g.destroy([ret], 'effect', 1);
    await g.processTriggers(true);
    eq(jinzo.location, 'mzone', 'Jinzo Special Summoned');
    await g.setFaceDown(jinzo);
    await setPhase(g, 'end');
    eq(jinzo.location, 'mzone', 'face-down Jinzo stays');
  });

  // https://edisonrul.ing/cards/j/junk-box.html
  await test('Junk Box: the monster is not destroyed in the End Phase if it was flipped face-down', async () => {
    const { g, place } = setup();
    const m = place(0, N('Morphtronic Datatron'), 'grave');
    const box = place(0, N('Junk Box'), 'hand');
    await activate(g, 0, box);
    eq(m.location, 'mzone', 'Special Summoned');
    await g.setFaceDown(m);
    await setPhase(g, 'end');
    eq(m.location, 'mzone', 'face-down monster stays');
  });

  // https://edisonrul.ing/cards/k/kinka-byo.html
  await test('Kinka-byo: flipped face-down its effect disappears; the monster stays when it later leaves', async () => {
    const { g, place } = setup();
    const kb = place(0, N('Kinka-byo'), 'mzone');
    const lv1 = place(0, N('Magical Scientist'), 'grave');
    g.beginBatch();
    g.emit({ type: 'flipped', card: kb, player: 0 });
    await g.processTriggers(true);
    eq(lv1.location, 'mzone', 'Level 1 monster Special Summoned');
    await g.setFaceDown(kb);
    eq(lv1.location, 'mzone', 'still there after Kinka-byo is flipped face-down');
    await g.destroy([kb], 'effect', 1);
    eq(lv1.location, 'mzone', 'still there after Kinka-byo leaves the field');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-hydro-barrier.html
  await test("Koa'ki Meiru Hydro Barrier: monsters Summoned later are negated too, even after it leaves the field", async () => {
    const { g, place } = setup();
    const hb = place(0, N("Koa'ki Meiru Hydro Barrier"), 'mzone');
    place(0, N("Iron Core of Koa'ki Meiru"), 'hand');
    const before = place(1, N('Jutte Fighter'), 'mzone');
    await activate(g, 0, hb);
    eq(g.isNegated(before), true, 'face-up Effect Monster negated');
    await g.destroy([hb], 'effect', 1);
    const later = place(1, N('Jutte Fighter'), 'hand');
    await g.specialSummon([later], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(g.isNegated(later), true, 'Summoned while it applies: negated');
    eq(g.isNegated(before), true, 'still negated after it left the field');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-ice.html
  await test("Koa'ki Meiru Ice: targets the Special Summoned monster on activation", async () => {
    const { g, c1, place } = setup();
    const ice = place(0, N("Koa'ki Meiru Ice"), 'mzone');
    place(0, T.wall, 'hand');
    const ss = place(1, T.brute, 'mzone');
    ss.summonMethod = 'special';
    windowFor(place, 1);
    const w = watchTargets(() => ice);
    c1.respond = w.responder;
    await activate(g, 0, ice);
    eq(w.seen.some((t) => t.includes(ss)), true, 'targeted at activation');
    eq(ss.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-sea-panther.html
  await test("Koa'ki Meiru Sea Panther: targets the Spell Card in the GY on activation", async () => {
    const { g, c1, place } = setup();
    const sp = place(0, N("Koa'ki Meiru Sea Panther"), 'mzone');
    place(0, N("Iron Core of Koa'ki Meiru"), 'hand');
    const spell = place(0, N('Book of Moon'), 'grave');
    windowFor(place, 1);
    const w = watchTargets(() => sp);
    c1.respond = w.responder;
    await activate(g, 0, sp);
    eq(w.seen.some((t) => t.includes(spell)), true, 'targeted at activation');
    const deck = g.players[0].deck;
    eq(deck[deck.length - 1], spell, 'on top of the Deck');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-tornado.html
  await test("Koa'ki Meiru Tornado: also destroys a face-down Special Summoned monster", async () => {
    const { g, place } = setup();
    const tor = place(0, N("Koa'ki Meiru Tornado"), 'mzone');
    place(0, N("Iron Core of Koa'ki Meiru"), 'hand');
    const fd = place(1, T.brute, 'hand');
    await g.specialSummon([fd], 1, { pos: 'def', faceDown: true });
    await activate(g, 0, tor);
    eq(fd.location, 'grave', 'face-down Special Summoned monster destroyed');
  });

  // https://edisonrul.ing/cards/k/kunoichi.html
  await test('Kunoichi: if it leaves the field in response, its new controller still discards', async () => {
    const { g, c0, place } = setup();
    const k = place(0, N('Kunoichi'), 'mzone');
    const h0 = place(0, T.wall, 'hand');
    const h1 = place(1, T.wall, 'hand');
    windowFor(place, 0);
    place(1, T.brute, 'mzone');
    c0.respond = (gg) => {
      if (k.location === 'mzone' && gg.chain.some((l) => l.card === k)) gg.rawMove(k, 'grave');
      return null;
    };
    await g.takeControl(k, 1, false);
    await g.processTriggers(true);
    eq(k.location, 'grave', 'Kunoichi left the field');
    eq(h1.location, 'grave', 'new controller discarded');
    eq(h0.location, 'hand', 'owner did not discard');
  });

  // https://edisonrul.ing/cards/l/last-turn.html
  await test('Last Turn: can be activated in the End Phase, no Battle Damage, still resolves with no monster of yours', async () => {
    const a = setup();
    a.g.phase = 'end';
    a.g.players[1].lp = 1000;
    a.place(1, T.wall, 'mzone', { pos: 'def' });
    const lt = a.place(1, N('Last Turn'), 'szone', { faceUp: false });
    eq(canActivate(a.g, 1, lt), true, 'offered in the End Phase');
    await activate(a.g, 1, lt);
    eq(a.g.players[1].lp, 1000, 'no Battle Damage in the special battle');
    eq(a.g.over, false, 'both players still control a monster');

    const b = setup();
    b.g.phase = 'end';
    b.g.players[1].lp = 1000;
    const wall = b.place(1, T.wall, 'mzone', { pos: 'def' });
    const lt2 = b.place(1, N('Last Turn'), 'szone', { faceUp: false });
    windowFor(b.place, 0);
    b.c0.respond = (gg) => {
      if (wall.location === 'mzone' && gg.chain.some((l) => l.card === lt2)) gg.rawMove(wall, 'grave');
      return null;
    };
    let winner: PlayerId | null | undefined;
    try {
      await activate(b.g, 1, lt2);
    } catch (e) {
      if (!(e instanceof GameOver)) throw e;
      winner = e.winner;
    }
    eq(winner, 0, 'the opponent Special Summons and wins the End Phase check');
  });

  // https://edisonrul.ing/cards/l/legendary-fiend.html
  await test('Legendary Fiend: Special Summoned during your Standby Phase, it gains 700 ATK in that Standby Phase', async () => {
    const { g, place } = setup();
    g.phase = 'standby';
    const lf = place(0, N('Legendary Fiend'), 'hand');
    await g.specialSummon([lf], 0, { pos: 'atk' });
    await g.processTriggers(true);
    eq(g.getAtk(lf), 2200, '1500 + 700');
  });

  // https://edisonrul.ing/cards/l/level-retuner.html
  await test('Level Retuner: targets the monster on activation', async () => {
    const { g, c1, place } = setup();
    const m = place(0, T.brute, 'mzone');
    const lr = place(0, N('Level Retuner'), 'szone', { faceUp: false });
    windowFor(place, 1);
    const w = watchTargets(() => lr);
    c1.respond = w.responder;
    await activate(g, 0, lr);
    eq(w.seen.some((t) => t.includes(m)), true, 'targeted at activation');
    eq(g.getLevel(m) < 4, true, 'Level reduced');
  });

  // https://edisonrul.ing/cards/l/light-end-dragon.html
  await test('Light End Dragon: cannot be activated against a monster with 0 ATK and 0 DEF', async () => {
    const { g, c0, place } = setup();
    const led = place(0, N('Light End Dragon'), 'mzone');
    place(1, T.zero, 'mzone');
    let asked = false;
    c0.trigger = () => {
      asked = true;
      return true;
    };
    await g.conductAttack(0, led);
    eq(asked, false, 'not offered');
    eq(g.getAtk(led), 2600, 'no ATK lost');
  });

  // https://edisonrul.ing/cards/l/lightsworn-barrier.html + https://edisonrul.ing/cards/l/lightsworn-sabre.html
  await test('Lightsworn Barrier: the 2 cards are a cost (Lightsworn Sabre sent this way does not activate) and the attacker is targeted', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, N('Lightsworn Barrier'), 'szone', { faceUp: true });
    place(0, N('Ryko, Lightsworn Hunter'), 'mzone');
    const sabre = place(0, N('Lightsworn Sabre'), 'deck');
    const big = place(1, T.big, 'mzone');
    windowFor(place, 1);
    const w = watchTargets(() => g.chain.find((l) => l.card.name === 'Lightsworn Barrier')?.card);
    g.controllers[1] = Object.assign(g.controllers[1], { respond: w.responder });
    c0.trigger = () => true;
    await g.conductAttack(1, big);
    eq(sabre.location, 'grave', 'Sabre sent as a cost');
    eq(activatedLinks(g, sabre), 0, 'Sabre does not activate');
    eq(w.seen.some((t) => t.includes(big)), true, 'attacker targeted');
    eq(g.players[0].lp, 8000, 'attack negated');
  });

  // https://edisonrul.ing/cards/l/lineage-of-destruction.html
  await test('Lineage of Destruction: cannot target a monster that can already attack twice', async () => {
    const { g, place } = setup();
    g.turnData['csoc:defKills'] = [{ by: 0, ctrl: 1 }];
    const m = place(0, T.eight, 'mzone');
    const lin = place(0, N('Lineage of Destruction'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, lin), true, 'a Level 8 monster that attacks once');
    g.addTempMod(m, 'extraAttacks', 1, 'turn');
    eq(canActivate(g, 0, lin), false, 'not if it can already attack twice');
  });

  // https://edisonrul.ing/cards/l/lord-british-space-fighter.html
  await test('Lord British Space Fighter: still activates when both monsters destroy each other', async () => {
    const { g, place } = setup();
    const lb = place(0, N('Lord British Space Fighter'), 'mzone');
    place(1, T.twelve, 'mzone');
    await g.conductAttack(0, lb);
    eq(lb.location, 'grave', 'destroyed by battle');
    eq(g.monsters(0).some((c) => c.name === 'Multi Token'), true, 'Multi Token Special Summoned');
  });

  // https://edisonrul.ing/cards/l/lucky-chance.html
  await test('Lucky Chance: with 2 face-up copies you call the coin toss only once', async () => {
    const { g, c0, place } = setup();
    place(0, N('Lucky Chance'), 'szone', { faceUp: true });
    place(0, N('Lucky Chance'), 'szone', { faceUp: true });
    let calls = 0;
    c0.option = (_g, req) => {
      if (req.prompt.includes('Lucky Chance')) calls++;
      return 0;
    };
    const hand = g.players[0].hand.length;
    const af = place(0, N('Arcana Force I - The Magician'), 'hand');
    await g.specialSummon([af], 0, { pos: 'atk' });
    await g.processTriggers(true);
    eq(calls, 1, 'one call');
    eq(g.players[0].hand.length - hand <= 1, true, 'at most 1 card drawn');
  });

  // https://edisonrul.ing/cards/m/machina-armored-unit.html
  await test('Machina Armored Unit: a Machine sent to your GY counts even if your opponent controlled it', async () => {
    const { g, place } = setup();
    place(0, N('Machina Armored Unit'), 'szone', { faceUp: true });
    const soldier = place(0, N('Machina Soldier'), 'mzone');
    await g.takeControl(soldier, 1, false);
    const defender = place(0, N('Machina Defender'), 'deck');
    const brute = place(0, T.brute, 'mzone');
    await g.conductAttack(0, brute);
    eq(soldier.location, 'grave', 'destroyed and sent to its owner\'s GY');
    eq(defender.location, 'mzone', 'Machina Defender (EARTH, 1200 < 1600) Special Summoned');
  });

  // https://edisonrul.ing/cards/m/magic-hole-golem.html
  await test('Magic Hole Golem: 2 Golems targeting different monsters: neither can attack', async () => {
    const { g, c0, place } = setup();
    const g1 = place(0, N('Magic Hole Golem'), 'mzone');
    const g2 = place(0, N('Magic Hole Golem'), 'mzone');
    const a = place(0, T.brute, 'mzone');
    const b = place(0, T.big, 'mzone');
    let want = a;
    c0.pick = (_g, req) => (req.candidates.includes(want) ? [want] : req.candidates.slice(0, req.min));
    await activate(g, 0, g1);
    eq(g.canAttack(a), true, 'first target can attack');
    want = b;
    await activate(g, 0, g2);
    eq(g.canAttack(a), false, 'first target cannot');
    eq(g.canAttack(b), false, 'second target cannot');
  });

  // https://edisonrul.ing/cards/m/magical-scientist.html
  await test('Magical Scientist: the Fusion Monster cannot attack directly; face-down it is not returned', async () => {
    const { g, place } = setup();
    const ms = place(0, N('Magical Scientist'), 'mzone');
    const fus = place(0, N('Elemental Hero Flame Wingman'), 'extra');
    await activate(g, 0, ms);
    eq(fus.location, 'mzone', 'Special Summoned');
    eq(g.attackTargets(fus).direct, false, 'cannot attack directly');
    await g.setFaceDown(fus);
    await setPhase(g, 'end');
    eq(fus.location, 'mzone', 'flipped face-down: not returned');
  });

  // https://edisonrul.ing/cards/m/magicat.html
  await test('Magicat: targets the Spell Card in the GY on activation', async () => {
    const { g, c1, place } = setup();
    const cat = place(0, N('Magicat'), 'grave');
    const arc = place(0, N('Arcanite Magician'), 'mzone');
    const spell = place(0, N('Book of Moon'), 'grave');
    windowFor(place, 1);
    const w = watchTargets(() => cat);
    c1.respond = w.responder;
    g.beginBatch();
    g.emit({ type: 'usedAsMaterial', card: cat, reason: 'synchro', reasonCard: arc, player: 0 });
    await g.processTriggers(true);
    eq(w.seen.some((t) => t.includes(spell)), true, 'targeted at activation');
    const deck = g.players[0].deck;
    eq(deck[deck.length - 1], spell, 'on top of the Deck');
  });

  // https://edisonrul.ing/cards/m/majestic-red-dragon.html
  await test('Majestic Red Dragon: Effect Monsters only; gains the ATK left after negation; destroys DEF monsters even if it loses the battle', async () => {
    const a = setup();
    const mrd = a.place(0, N('Majestic Red Dragon'), 'mzone');
    a.place(1, T.brute, 'mzone');
    eq(canActivate(a.g, 0, mrd), false, 'no Effect Monster to target');
    const maiden = a.place(1, N('Maiden of Macabre'), 'mzone');
    maiden.counters.spell = 2;
    eq(a.g.getAtk(maiden), 2100, 'Maiden 1700 + 400');
    await activate(a.g, 0, mrd);
    eq(a.g.getAtk(mrd), 4000 + 1700, 'gains its ATK once negated');

    const b = setup();
    const mrd2 = b.place(0, N('Majestic Red Dragon'), 'mzone');
    b.c0.aim = b.place(1, T.titan, 'mzone');
    const def = b.place(1, T.wall, 'mzone', { pos: 'def' });
    await b.g.conductAttack(0, mrd2);
    eq(mrd2.location === 'extra' || mrd2.location === 'grave', true, 'Majestic Red Dragon destroyed by battle');
    eq(def.location, 'grave', 'Defense Position monster destroyed');
  });

  // https://edisonrul.ing/cards/m/majestic-star-dragon.html
  await test('Majestic Star Dragon: returns to the Extra Deck with no Stardust Dragon in the GY; cannot target a negated monster', async () => {
    const { g, place } = setup();
    const msd = place(0, N('Majestic Star Dragon'), 'mzone');
    const opp = place(1, N('Jutte Fighter'), 'mzone');
    g.addTempMod(opp, 'negated', true, 'turn');
    eq(canActivate(g, 0, msd, 'Negate a monster and copy its effect'), false, 'already negated: no target');
    await setPhase(g, 'end');
    eq(msd.location, 'extra', 'returned to the Extra Deck');
  });

  // https://edisonrul.ing/cards/m/makiu-the-magical-mist.html
  await test('Makiu, the Magical Mist: a second copy can be activated in the same turn', async () => {
    const { g, place } = setup();
    place(0, N('Mist Valley Thunderbird'), 'mzone');
    place(1, T.wall, 'mzone', { pos: 'def' });
    const m1 = place(0, N('Makiu, the Magical Mist'), 'hand');
    const m2 = place(0, N('Makiu, the Magical Mist'), 'hand');
    await activate(g, 0, m1);
    place(1, T.wall, 'mzone', { pos: 'def' });
    eq(canActivate(g, 0, m2), true, 'second copy offered');
  });

  // https://edisonrul.ing/cards/m/makyura-the-destructor.html
  await test('Makyura the Destructor: a Continuous Effect (no Chain Link)', async () => {
    const { g, place } = setup();
    const mk = place(0, N('Makyura the Destructor'), 'mzone');
    await g.destroy([mk], 'effect', 1);
    await g.processTriggers(true);
    eq(activatedLinks(g, mk), 0, 'no Chain Link');
    eq(g.turnData['trapsFromHand:0'], true, 'permission recorded');
  });

  // https://edisonrul.ing/cards/m/master-gig.html
  await test('Master Gig: cannot be activated while the opponent controls fewer monsters than your face-up Psychics', async () => {
    const { g, place } = setup();
    const gig = place(0, N('Master Gig'), 'mzone');
    place(0, T.psychic, 'mzone');
    place(1, T.brute, 'mzone');
    eq(canActivate(g, 0, gig), false, '2 Psychics vs 1 monster');
    place(1, T.wall, 'mzone');
    eq(canActivate(g, 0, gig), true, '2 Psychics vs 2 monsters');
  });

  // https://edisonrul.ing/cards/m/megamorph.html
  await test('Megamorph: 2 copies on one monster are the same as one', async () => {
    const { g, place } = setup();
    g.players[0].lp = 4000;
    const m = place(0, T.brute, 'mzone');
    for (let i = 0; i < 2; i++) {
      const mm = place(0, N('Megamorph'), 'szone', { faceUp: true });
      g.equip(mm, m);
    }
    eq(g.getAtk(m), 3600, 'double the original ATK once');
  });

  // https://edisonrul.ing/cards/m/metamorphosis.html
  await test('Metamorphosis: a face-down monster can be Tributed', async () => {
    const { g, place } = setup();
    const fd = place(0, N('Infernity Beast'), 'mzone', { faceUp: false, pos: 'def' });
    const fus = place(0, N('Elemental Hero Flame Wingman'), 'extra');
    fd.flags.baseLevel = 6;
    const meta = place(0, N('Metamorphosis'), 'hand');
    await activate(g, 0, meta);
    eq(fd.location, 'grave', 'face-down monster Tributed');
    eq(fus.location, 'mzone', 'Level 6 Fusion Monster Special Summoned');
  });

  // https://edisonrul.ing/cards/m/miracle-fertilizer.html
  await test('Miracle Fertilizer: you can still Normal Summon if the target is removed in response', async () => {
    const { g, c1, place } = setup();
    place(0, N('Miracle Fertilizer'), 'szone', { faceUp: true });
    const mf = g.players[0].szone.find((c) => c?.name === 'Miracle Fertilizer')!;
    const plant = place(0, N('Inmato'), 'grave');
    place(0, T.brute, 'mzone');
    windowFor(place, 1);
    c1.respond = (gg) => {
      if (plant.location === 'grave' && gg.chain.some((l) => l.card === mf)) gg.rawMove(plant, 'banished');
      return null;
    };
    await activate(g, 0, mf);
    eq(plant.location, 'banished', 'target removed');
    eq(g.queryPlayer(0, 'cannotNormalSummon'), false, 'Normal Summon still allowed');
  });

  // https://edisonrul.ing/cards/m/miracle-flipper.html
  await test('Miracle Flipper: removed from play by battle, it is still Special Summoned to the opponent\'s side', async () => {
    const { g, place } = setup();
    g.addPlayerMod(1, 'banishInsteadOfGrave', true);
    g.addPlayerMod(0, 'banishInsteadOfGrave', true);
    const flip = place(1, N('Miracle Flipper'), 'mzone');
    const brute = place(0, T.brute, 'mzone');
    await g.conductAttack(0, brute);
    eq(flip.location, 'banished', 'removed from play');
    await battleEnd(g);
    eq(flip.location === 'mzone' && flip.controller === 0, true, "Special Summoned to the opponent's side");
  });

  // https://edisonrul.ing/cards/m/miracle-locus.html
  await test('Miracle Locus: can be activated in the Damage Step', async () => {
    const { g, c0, place } = setup();
    place(0, N('Miracle Locus'), 'szone', { faceUp: false });
    const brute = place(0, T.brute, 'mzone');
    place(1, T.big, 'mzone');
    let offered = false;
    c0.respond = (gg, req) => {
      if (gg.battle?.inDamageStep && offers(req, 'Miracle Locus')) offered = true;
      return null;
    };
    await g.conductAttack(0, brute);
    eq(offered, true, 'offered in the Damage Step');
  });

  // https://edisonrul.ing/cards/m/mind-trust.html
  await test('Mind Trust: targets the Tuner in the GY on activation', async () => {
    const { g, c1, place } = setup();
    place(0, T.brute, 'mzone');
    const tuner = place(0, N('Jutte Fighter'), 'grave');
    const mt = place(0, N('Mind Trust'), 'hand');
    place(1, T.wall, 'mzone');
    windowFor(place, 1);
    const w = watchTargets(() => mt);
    c1.respond = w.responder;
    await activate(g, 0, mt);
    eq(w.seen.some((t) => t.includes(tuner)), true, 'targeted at activation');
    eq(tuner.location, 'hand', 'added to the hand');
  });

  // https://edisonrul.ing/cards/m/monster-gate.html
  await test('Monster Gate: with no monster to pick up, the cards are shuffled back into the Deck', async () => {
    const { g, place } = setup();
    for (const c of [...g.players[0].deck]) g.rawMove(c, 'banished');
    const spells = [place(0, N('Book of Moon'), 'deck'), place(0, N('Book of Moon'), 'deck')];
    place(0, T.brute, 'mzone');
    const gate = place(0, N('Monster Gate'), 'hand');
    await activate(g, 0, gate);
    eq(spells.every((c) => c.location === 'deck'), true, 'nothing sent to the GY');
  });

  // https://edisonrul.ing/cards/m/montage-dragon.html
  await test('Montage Dragon: flipped face-down and face-up again, its ATK is 0', async () => {
    const { g, place } = setup();
    const md = place(0, N('Montage Dragon'), 'hand');
    for (let i = 0; i < 3; i++) place(0, T.brute, 'hand');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === md);
    if (!proc) throw new Error('no summoning procedure');
    await g.performAction(0, proc);
    eq(g.getAtk(md), 12 * 300, 'ATK from the Levels');
    await g.setFaceDown(md);
    await g.changePosition(md, 'atk', true);
    eq(g.getAtk(md), 0, 'ATK 0 once flipped face-up again');
  });

  // https://edisonrul.ing/cards/m/moon-dragon-quilla.html
  await test('Moon Dragon Quilla: no LP if the attacker is no longer face-up on the field', async () => {
    const { g, c0, place } = setup();
    place(1, N('Moon Dragon Quilla'), 'mzone');
    const big = place(0, T.big, 'mzone');
    windowFor(place, 0);
    c0.respond = (gg) => {
      if (big.location === 'mzone' && gg.chain.some((l) => l.card.name === 'Moon Dragon Quilla')) gg.rawMove(big, 'grave');
      return null;
    };
    await g.conductAttack(0, big);
    eq(g.players[1].lp, 8000, 'no LP gained');
  });

  // https://edisonrul.ing/cards/m/morphtransition.html
  await test('Morphtransition: targets both monsters; no position change if the attacker left the field', async () => {
    for (const gone of [false, true]) {
      const { g, c0, c1, place } = setup();
      const dt = place(1, N('Morphtronic Datatron'), 'mzone');
      place(1, N('Morphtransition'), 'szone', { faceUp: false });
      const brute = place(0, T.brute, 'mzone');
      windowFor(place, 0);
      const w = watchTargets(() => g.chain.find((l) => l.card.name === 'Morphtransition')?.card);
      c1.respond = respondWith('Morphtransition');
      c0.respond = (gg, req) => {
        w.responder(gg, req);
        if (gone && brute.location === 'mzone' && gg.chain.some((l) => l.card.name === 'Morphtransition')) gg.rawMove(brute, 'grave');
        return null;
      };
      await g.conductAttack(0, brute);
      eq(w.seen.some((t) => t.includes(brute) && t.includes(dt)), true, 'both targeted');
      eq(dt.pos, gone ? 'atk' : 'def', `position changed unless the attacker left (${gone})`);
    }
  });

  // https://edisonrul.ing/cards/m/morphtronic-clocken.html
  await test('Morphtronic Clocken: the Tribute damage effect is a Defense Position effect', async () => {
    const { g, place } = setup();
    const ck = place(0, N('Morphtronic Clocken'), 'mzone');
    ck.counters.morph = 2;
    eq(canActivate(g, 0, ck, '(Defense) Tribute: 1000 damage per Morph Counter'), false, 'not in Attack Position');
    await g.changePosition(ck, 'def', true);
    eq(canActivate(g, 0, ck, '(Defense) Tribute: 1000 damage per Morph Counter'), true, 'in Defense Position');
  });

  // https://edisonrul.ing/cards/m/morphtronic-cord.html
  await test('Morphtronic Cord: targets the Spell/Trap on activation', async () => {
    const { g, c1, place } = setup();
    const dt = place(0, N('Morphtronic Datatron'), 'mzone');
    const cord = place(0, N('Morphtronic Cord'), 'szone', { faceUp: true });
    g.equip(cord, dt);
    const st = place(1, N('Book of Moon'), 'szone', { faceUp: false });
    const w = watchTargets(() => cord);
    c1.respond = w.responder;
    await g.changePosition(dt, 'def', true);
    await g.processTriggers(true);
    eq(w.seen.some((t) => t.length === 1 && t[0].isSpell), true, 'Chain Link with a Spell/Trap target');
    eq(st.location === 'grave' || cord.location === 'grave', true, 'a targeted Spell/Trap destroyed');
  });

  // https://edisonrul.ing/cards/m/morphtronic-engine.html
  await test('Morphtronic Engine: a second copy on the same monster is redundant', async () => {
    const { g, place } = setup();
    const dt = place(0, N('Morphtronic Datatron'), 'mzone');
    for (let i = 0; i < 2; i++) g.equip(place(0, N('Morphtronic Engine'), 'szone', { faceUp: true }), dt);
    eq(g.getAtk(dt), 2400, 'twice the original ATK, not three times');
  });

  // https://edisonrul.ing/cards/m/morphtronic-magnen-bar.html
  await test('Morphtronic Magnen Bar: its Attack Position effect cannot be activated in Main Phase 2', async () => {
    const { g, place } = setup();
    const bar = place(0, N('Morphtronic Magnen Bar'), 'mzone');
    place(0, T.brute, 'mzone');
    place(0, T.big, 'mzone');
    eq(canActivate(g, 0, bar), true, 'Main Phase 1');
    g.phase = 'main2';
    eq(canActivate(g, 0, bar), false, 'Main Phase 2');
  });

  // https://edisonrul.ing/cards/m/morphtronic-map.html
  await test('Morphtronic Map: its Special Summon effect targets', async () => {
    const { g, c0, c1, place } = setup();
    const map = place(0, N('Morphtronic Map'), 'fzone');
    const dt = place(0, N('Morphtronic Datatron'), 'grave');
    place(1, T.brute, 'mzone');
    windowFor(place, 1);
    const w = watchTargets(() => map);
    c1.respond = w.responder;
    c0.trigger = () => true;
    await g.destroy([map], 'effect', 1);
    await g.processTriggers(true);
    eq(w.seen.some((t) => t.includes(dt)), true, 'targeted at activation');
    eq(dt.location, 'mzone', 'Special Summoned');
  });

  // https://edisonrul.ing/cards/m/morphtronic-repair-unit.html
  await test('Morphtronic Repair Unit: needs a "Morphtronic" target in the GY before you pay the cost', async () => {
    const { g, place } = setup();
    place(0, N('Morphtronic Datatron'), 'hand');
    const ru = place(0, N('Morphtronic Repair Unit'), 'hand');
    eq(canActivate(g, 0, ru), false, 'no Morphtronic in the GY');
    place(0, N('Morphtronic Clocken'), 'grave');
    eq(canActivate(g, 0, ru), true, 'with one in the GY');
  });

  // https://edisonrul.ing/cards/m/mosaic-manticore.html
  await test("Mosaic Manticore: a Tributed monster of your opponent's is Special Summoned to your side", async () => {
    const { g, place } = setup();
    const mm = place(0, N('Mosaic Manticore'), 'mzone');
    const theirs = place(1, T.brute, 'grave');
    const mine = place(0, T.wall, 'grave');
    mm.summonMethod = 'tribute';
    mm.summonTurn = 0;
    mm.flags.tributedMonsters = [
      { uid: theirs.uid, moveId: theirs.moveId },
      { uid: mine.uid, moveId: mine.moveId },
    ];
    await setPhase(g, 'standby');
    eq(theirs.location === 'mzone' && theirs.controller === 0, true, "opponent's monster on your side");
    eq(mine.location, 'mzone', 'your monster too');
  });

  // https://edisonrul.ing/cards/m/mysterious-triangle.html
  await test('Mysterious Triangle: targets; nothing happens if the target lost its A-Counter', async () => {
    const { g, c1, place } = setup();
    const t = place(1, T.brute, 'mzone');
    t.counters.A = 1;
    const alien = place(0, N('Alien Hypno'), 'deck');
    const tri = place(0, N('Mysterious Triangle'), 'hand');
    windowFor(place, 1);
    c1.respond = (gg) => {
      if (gg.chain.some((l) => l.card === tri && l.ctx.targets.includes(t))) t.counters.A = 0;
      return null;
    };
    await activate(g, 0, tri);
    eq(t.location, 'mzone', 'not destroyed');
    eq(alien.location, 'deck', 'no Alien Special Summoned');
  });

  // https://edisonrul.ing/cards/m/mystical-cards-of-light.html
  await test('Mystical Cards of Light: cannot be activated without a Spell & Trap Zone to make unusable', async () => {
    const { g, place } = setup();
    for (let i = 0; i < 4; i++) place(0, N('Book of Moon'), 'szone', { faceUp: false });
    const mc = place(0, N('Mystical Cards of Light'), 'hand');
    eq(canActivate(g, 0, mc), false, '1 free zone: no zone to lock');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
