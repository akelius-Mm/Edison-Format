// Sourced rulings regression tests (group 2: Garoth .. Prime Material Dragon). Each test pins a behaviour fixed from
// the edisonrul.ing card page (historical edisonformat.com section: 2010 US card text + 2010 Konami/UDE rulings).
// Usage: npx tsx scripts/sourced-2.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  bigMachine: findCard('Rules Test Big Machine') ?? normal('Rules Test Big Machine', 'EARTH', 'Machine', 8, 2800, 2000),
  darkFour: findCard('Sourced Test Dark Four') ?? normal('Sourced Test Dark Four', 'DARK', 'Fiend', 4, 1600, 1200),
  darkTuner: findCard('Sourced Test Dark Tuner') ?? normal('Sourced Test Dark Tuner', 'DARK', 'Fiend', 2, 800, 800),
  bird: findCard('Sourced Test Bird') ?? normal('Sourced Test Bird', 'WIND', 'Winged Beast', 4, 1500, 1000),
  lowMachine: findCard('Sourced Test Cog') ?? normal('Sourced Test Cog', 'EARTH', 'Machine', 3, 400, 400),
};
if (!T.darkTuner.mtypes!.includes('tuner')) T.darkTuner.mtypes!.push('tuner');

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

function setup(extra: CardData[] = []) {
  const c0 = new TestController();
  const c1 = new TestController();
  const g = new Game([{ main: Array(20).fill(T.wall), extra }, { main: Array(20).fill(T.wall), extra: [] }], [c0, c1], { seed: 1 });
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
const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;
const pickOnly = (c: TestController, want: CardInstance[]) => {
  c.pick = (_g, req) => {
    const w = want.filter((x) => req.candidates.includes(x));
    return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
  };
};
const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
const procAct = (g: Game, p: PlayerId, card: CardInstance) => g.legalMainActions(p).find((a) => a.type === 'proc' && a.card === card);
async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
const battleEnd = async (g: Game) => {
  g.beginBatch();
  g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
  await g.processTriggers(true);
};
/** Whether effect `idx` of `card` passes its own condition / canActivate checks for player `p` right now. */
function effectUsable(g: Game, card: CardInstance, idx: number, p: PlayerId) {
  const ef = card.data.effects![idx];
  const ctx = new Ctx(g, card, ef, p);
  ctx.effectIndex = idx;
  return (!ef.condition || ef.condition(ctx)) && (!ef.canActivate || ef.canActivate(ctx));
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
  console.log('Sourced rulings tests: group 2');

  // https://edisonrul.ing/cards/m/machina-fortress.html
  await test('Machina Fortress: its Special Summon is a procedure (no chain; not an effect, so Necrovalley does not stop it); it cannot discard itself under Macro Cosmos', async () => {
    const { g, place } = setup();
    const f = place(0, N('Machina Fortress'), 'grave');
    const big = place(0, T.bigMachine, 'hand');
    place(1, N('Necrovalley'), 'fzone');
    eq(offered(g, 0, f), false, 'not an activated effect');
    const act = procAct(g, 0, f);
    if (!act) throw new Error('Summon procedure not offered');
    await g.performAction(0, act);
    eq(f.location, 'mzone', 'Summoned from the GY despite Necrovalley');
    eq(big.location, 'grave', 'Machine discarded as the cost');
    eq(g.eventLog.some((e) => e.type === 'chainActivated'), false, 'no chain was started');
    const m = setup();
    const f2 = m.place(0, N('Machina Fortress'), 'hand');
    m.place(0, N('Yellow Gadget'), 'hand');
    eq(!!procAct(m.g, 0, f2), true, 'Fortress (7) + Gadget (4) normally');
    m.place(1, N('Macro Cosmos'), 'szone', { faceUp: true });
    eq(!!procAct(m.g, 0, f2), false, 'with Macro Cosmos Fortress cannot discard itself: only 4 Levels');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-secutor.html
  await test('Gladiator Beast Secutor: with only 1 free Monster Zone, 2 are chosen, 1 is Summoned and the other is destroyed', async () => {
    const { g, c0, place } = setup();
    const sec = place(0, N('Gladiator Beast Secutor'), 'mzone');
    sec.flags.gbSummoned = true;
    sec.attackedThisTurnOrWasAttacked = true;
    for (let i = 0; i < 3; i++) place(0, T.wall, 'mzone');
    const a = place(0, N('Gladiator Beast Laquari'), 'deck');
    const b = place(0, N('Gladiator Beast Hoplomus'), 'deck');
    pickOnly(c0, [a, b]);
    await battleEnd(g);
    eq(a.location, 'mzone', 'first one Summoned');
    eq(b.location, 'grave', 'second one destroyed and sent to the GY');
  });

  // https://edisonrul.ing/cards/g/gottoms-emergency-call.html
  await test("Gottoms' Emergency Call: if one target leaves the GY in response, the other is not Summoned", async () => {
    const { g, c1, place } = setup();
    place(0, N('X-Saber Airbellum'), 'mzone');
    const x1 = place(0, N('X-Saber Airbellum'), 'grave');
    const x2 = place(0, N('X-Saber Galahad'), 'grave');
    place(1, N('D.D. Crow'), 'hand');
    c1.respond = respondWith('D.D. Crow');
    pickOnly(c1, [x1]);
    await activateCard(g, 0, place(0, N("Gottoms' Emergency Call"), 'hand'));
    eq(x1.location, 'banished', 'D.D. Crow banished one target');
    eq(x2.location, 'grave', 'the other target is not Special Summoned');
  });

  // https://edisonrul.ing/cards/g/goyo-guardian.html
  await test('Goyo Guardian: Synchro Material Monsters do not need to be EARTH (2010 text)', async () => {
    const goyo = N('Goyo Guardian');
    const { g, place } = setup([goyo]);
    place(0, T.darkTuner, 'mzone');
    place(0, T.darkFour, 'mzone');
    const gy = g.players[0].extra.find((c) => c.name === 'Goyo Guardian')!;
    eq(g.synchroCombos(0, gy).length > 0, true, 'DARK Tuner + DARK non-Tuner can Synchro Summon Goyo Guardian');
  });

  // https://edisonrul.ing/cards/g/grandmaster-of-the-six-samurai.html
  await test('Grandmaster of the Six Samurai: mandatory, can target itself, does not miss the timing', async () => {
    const { g, place } = setup();
    const gm = place(0, N('Grandmaster of the Six Samurai'), 'mzone');
    await g.destroy([gm], 'effect', 1);
    await g.mill(1, 1, 'effect');
    await g.processTriggers(true);
    eq(gm.location, 'hand', 'added itself from the GY even though it was not the last thing to happen');
  });

  // https://edisonrul.ing/cards/i/icarus-attack.html
  await test('Icarus Attack: a face-down Winged Beast can be Tributed for the cost', async () => {
    const { g, c0, place } = setup();
    const bird = place(0, T.bird, 'mzone', { faceUp: false, pos: 'def' });
    const a = place(1, T.brute, 'mzone');
    const b = place(1, T.wall, 'mzone');
    const ic = place(0, N('Icarus Attack'), 'szone', { faceUp: false });
    pickOnly(c0, [bird, a, b]);
    await activateCard(g, 0, ic);
    eq(bird.location, 'grave', 'face-down Winged Beast Tributed');
    eq(a.location + b.location, 'gravegrave', 'both targets destroyed');
  });

  // https://edisonrul.ing/cards/i/il-blud.html
  await test('Il Blud: the Special Summon still resolves after Il Blud is destroyed in response; that monster stays', async () => {
    const { g, c1, place } = setup();
    const ib = place(0, N('Il Blud'), 'mzone');
    ib.flags.geminiSummoned = true;
    const z = place(0, N('Goblin Zombie'), 'grave');
    place(1, N('Mystical Space Typhoon'), 'hand');
    const bora = place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Book of Moon');
    pickOnly(c1, [ib]);
    void bora;
    await activateCard(g, 0, ib, 'Summon a Zombie from hand or either GY');
    eq(ib.faceUp, false, 'Il Blud turned face-down in response');
    eq(z.location, 'mzone', 'the Zombie is still Special Summoned');
    eq(z.flags.ilBludSource, undefined, 'not tied to Il Blud (it is not destroyed when Il Blud leaves)');
  });

  // https://edisonrul.ing/cards/i/iron-chain-dragon.html
  await test('Iron Chain Dragon: no cost; banishes ALL "Iron Chain" monsters in the GY and gains 200 ATK for each', async () => {
    const { g, place } = setup();
    const icd = place(0, N('Iron Chain Dragon'), 'mzone');
    const a = place(0, N('Iron Chain Snake'), 'grave');
    const b = place(0, N('Iron Chain Repairman'), 'grave');
    const c = place(0, N('Iron Chain Coil'), 'grave');
    await activateCard(g, 0, icd);
    eq([a, b, c].every((x) => x.location === 'banished'), true, 'all three banished');
    eq(g.getAtk(icd), 2500 + 600, '+200 per banished card');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-crusader.html
  await test("Koa'ki Meiru Crusader: targets a Koa'ki Meiru card in the GY, and activates even when both monsters are destroyed", async () => {
    const { g, c0, place } = setup();
    const cru = place(0, N("Koa'ki Meiru Crusader"), 'mzone');
    const opp = place(1, normal('Sourced Test Twin', 'EARTH', 'Warrior', 4, 1900, 1000), 'mzone');
    const core = place(0, N("Iron Core of Koa'ki Meiru"), 'grave');
    pickOnly(c0, [core]);
    g.phase = 'battle';
    await g.conductAttack(0, cru);
    eq(cru.location, 'grave', 'Crusader destroyed too');
    eq(opp.location, 'grave', 'opponent monster destroyed');
    eq(core.location, 'hand', 'Iron Core added');
    eq(g.eventLog.some((e) => e.type === 'chainActivated' && (e.data?.link?.ctx?.targets ?? []).includes(core)), true, 'it targeted the card');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-rooklord.html
  await test("Koa'ki Meiru Rooklord: targets up to 2 cards on activation", async () => {
    const { g, c0, place } = setup();
    const rook = place(0, N("Koa'ki Meiru Rooklord"), 'hand');
    const fod = place(0, N("Koa'ki Meiru Crusader"), 'mzone');
    place(0, N("Iron Core of Koa'ki Meiru"), 'grave');
    const a = place(1, T.brute, 'mzone');
    const b = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    pickOnly(c0, [fod, a, b]);
    const act = procAct(g, 0, rook);
    if (!act) throw new Error('1-Tribute Summon not offered');
    await g.performAction(0, act);
    eq(rook.location, 'mzone', 'Rooklord Tribute Summoned');
    const link = g.eventLog.find((e) => e.type === 'chainActivated' && e.data?.link?.card === rook)?.data?.link;
    eq((link?.ctx?.targets ?? []).length, 2, 'two targets chosen on activation');
    eq(a.location + b.location, 'gravegrave', 'both destroyed');
  });

  // https://edisonrul.ing/cards/k/kycoo-the-ghost-destroyer.html
  await test('Kycoo the Ghost Destroyer: its GY banish targets, and cannot be activated while Necrovalley is active', async () => {
    const { g, c0, place } = setup();
    const k = place(0, N('Kycoo the Ghost Destroyer'), 'mzone');
    const d = place(1, T.brute, 'grave');
    let asked = 0;
    c0.confirmTrigger = async () => (asked++, true);
    g.phase = 'battle';
    await g.conductAttack(0, k);
    eq(d.location, 'banished', 'banished');
    eq(g.eventLog.some((e) => e.type === 'chainActivated' && (e.data?.link?.ctx?.targets ?? []).includes(d)), true, 'targeted');
    const n = setup();
    const k2 = n.place(0, N('Kycoo the Ghost Destroyer'), 'mzone');
    n.place(1, T.brute, 'grave');
    n.place(1, N('Necrovalley'), 'fzone');
    let asked2 = 0;
    n.c0.confirmTrigger = async () => (asked2++, true);
    n.g.phase = 'battle';
    await n.g.conductAttack(0, k2);
    eq(asked2, 0, 'not even offered under Necrovalley');
    void asked;
  });

  // https://edisonrul.ing/cards/l/level-eater.html
  await test("Level Eater: the target's Level is still reduced if Level Eater left the GY before resolution", async () => {
    const { g, c1, place } = setup();
    const le = place(0, N('Level Eater'), 'grave');
    const big = place(0, T.bigMachine, 'mzone');
    place(1, N('D.D. Crow'), 'hand');
    c1.respond = respondWith('D.D. Crow');
    pickOnly(c1, [le]);
    await activateCard(g, 0, le);
    eq(le.location, 'banished', 'Level Eater removed in response');
    eq(g.getLevel(big), 7, 'Level still reduced to 7');
  });

  // https://edisonrul.ing/cards/l/light-and-darkness-dragon.html
  await test('Light and Darkness Dragon: its GY effect activates when destroyed outside the Monster Zone (e.g. in the hand)', async () => {
    const { g, c0, place } = setup();
    const ladd = place(0, N('Light and Darkness Dragon'), 'hand');
    const back = place(0, T.brute, 'grave');
    const mine = place(0, T.wall, 'mzone');
    pickOnly(c0, [back]);
    await g.moveCards([ladd], 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], destroyed: true, reasonPlayer: 1 });
    await g.processTriggers(true);
    eq(mine.location, 'grave', 'your field destroyed');
    eq(back.location, 'mzone', 'target Special Summoned');
  });

  // https://edisonrul.ing/cards/l/limiter-removal.html
  await test('Limiter Removal: a Machine flipped face-down is not destroyed in the End Phase', async () => {
    const { g, place } = setup();
    const m1 = place(0, T.bigMachine, 'mzone');
    const m2 = place(0, T.bigMachine, 'mzone');
    await activateCard(g, 0, place(0, N('Limiter Removal'), 'hand'));
    eq(g.getAtk(m1), 5600, 'ATK doubled');
    await g.changePosition(m2, 'def', false);
    await (g as any).setPhase('end');
    eq(m1.location, 'grave', 'face-up Machine destroyed');
    eq(m2.location, 'mzone', 'face-down Machine survives');
  });

  // https://edisonrul.ing/cards/l/lumina-lightsworn-summoner.html
  await test('Lumina: cannot be activated without a valid target already in the GY (a Lightsworn in hand to discard is not enough)', async () => {
    const { g, place } = setup();
    const lumina = place(0, N('Lumina, Lightsworn Summoner'), 'mzone');
    const ryko = place(0, N('Ryko, Lightsworn Hunter'), 'hand');
    eq(offered(g, 0, lumina), false, 'only a Lightsworn in hand: not offered');
    place(0, N('Ryko, Lightsworn Hunter'), 'grave');
    eq(offered(g, 0, lumina), true, 'with one in the GY: offered');
    void ryko;
  });

  // https://edisonrul.ing/cards/l/lyla-lightsworn-sorceress.html
  await test("Lyla: targets only the opponent's Spells/Traps; the position change is not a cost, and no destruction if it can't change", async () => {
    const { g, c1, place } = setup();
    const lyla = place(0, N('Lyla, Lightsworn Sorceress'), 'mzone');
    const mine = place(0, N('Mirror Force'), 'szone', { faceUp: false });
    eq(offered(g, 0, lyla), false, 'only your own Set card: not offered');
    const st = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Book of Moon');
    pickOnly(c1, [lyla]);
    await activateCard(g, 0, lyla);
    eq(lyla.faceUp, false, 'Book of Moon turned Lyla face-down in response');
    eq(st.location, 'szone', 'Lyla could not be changed to Defense Position: target not destroyed');
    eq(mine.location, 'szone', 'own card untouched');
  });

  // https://edisonrul.ing/cards/m/machine-duplication.html
  await test('Machine Duplication: still Special Summons from the Deck if the target left the field', async () => {
    const { g, c0, c1, place } = setup();
    const cog = place(0, T.lowMachine, 'mzone');
    place(0, T.lowMachine, 'deck');
    place(0, T.lowMachine, 'deck');
    c0.pick = (_g, req) => (req.purpose === 'specialSummon' ? req.candidates.slice(0, req.max) : req.candidates.slice(0, req.min));
    place(1, N('Compulsory Evacuation Device'), 'szone', { faceUp: false });
    c1.respond = respondWith('Compulsory Evacuation Device');
    pickOnly(c1, [cog]);
    await activateCard(g, 0, place(0, N('Machine Duplication'), 'hand'));
    eq(cog.location, 'hand', 'target bounced in response');
    eq(g.monsters(0).filter((c) => c.name === T.lowMachine.name).length, 2, 'two copies Special Summoned anyway');
  });

  // https://edisonrul.ing/cards/m/mind-crush.html
  await test('Mind Crush: cannot be activated while either player has no cards in hand', async () => {
    const { g, place } = setup();
    const mc = place(0, N('Mind Crush'), 'szone', { faceUp: false });
    place(0, T.brute, 'hand');
    eq(effectUsable(g, mc, 0, 0), false, 'opponent has no cards in hand');
    place(1, T.brute, 'hand');
    eq(effectUsable(g, mc, 0, 0), true, 'both players have cards');
  });

  // https://edisonrul.ing/cards/m/morphtronic-celfon.html, https://edisonrul.ing/cards/m/morphtronic-forcefield.html
  await test('Morphtronic Celfon / Forcefield: not activatable without a "Morphtronic" monster in the Deck', async () => {
    const { g, place } = setup();
    const cel = place(0, N('Morphtronic Celfon'), 'mzone');
    const ff = place(0, N('Morphtronic Forcefield'), 'szone', { faceUp: false });
    const ffIdx = ff.data.effects!.findIndex((e) => e.kind === 'activate');
    const ffCan = () => {
      const ef = ff.data.effects![ffIdx];
      return ef.canActivate!(new Ctx(g, ff, ef, 0));
    };
    eq(offered(g, 0, cel), false, 'Celfon: no Morphtronic in the Deck');
    eq(ffCan(), false, 'Forcefield: no Morphtronic in the Deck');
    place(0, N('Morphtronic Radion'), 'deck');
    eq(offered(g, 0, cel), true, 'Celfon offered');
    eq(ffCan(), true, 'Forcefield usable');
  });

  // https://edisonrul.ing/cards/n/needle-ceiling.html
  await test('Needle Ceiling: still resolves if fewer than 4 monsters remain by resolution', async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    place(0, T.brute, 'mzone');
    const c = place(1, T.brute, 'mzone');
    const d = place(1, T.wall, 'mzone');
    const nc = place(0, N('Needle Ceiling'), 'szone', { faceUp: false });
    place(1, N('Compulsory Evacuation Device'), 'szone', { faceUp: false });
    c1.respond = respondWith('Compulsory Evacuation Device');
    pickOnly(c1, [d]);
    await activateCard(g, 0, nc);
    eq(d.location, 'hand', 'one monster bounced in response (3 left)');
    eq(a.location + c.location, 'gravegrave', 'face-up monsters destroyed anyway');
  });

  // https://edisonrul.ing/cards/p/phoenix-wing-wind-blast.html
  await test('Phoenix Wing Wind Blast: cannot target a face-up non-Continuous Spell/Trap being activated; can target a face-up Swords of Revealing Light', async () => {
    for (const swords of [false, true]) {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      place(0, N('Phoenix Wing Wind Blast'), 'szone', { faceUp: false });
      place(0, T.brute, 'hand');
      if (swords) place(1, N('Swords of Revealing Light'), 'szone', { faceUp: true });
      let seen = false;
      c0.respond = (_g, req) => {
        if (req.options.some((o) => o.card.name === 'Phoenix Wing Wind Blast')) seen = true;
        return null;
      };
      const pot = place(1, N('Pot of Greed'), 'hand');
      await activateCard(g, 1, pot);
      eq(seen, swords, swords ? 'face-up Swords is a valid target' : 'the resolving Pot of Greed is not a valid target');
    }
  });

  // https://edisonrul.ing/cards/p/plaguespreader-zombie.html
  await test('Plaguespreader Zombie: an Ignition Effect from the GY in the Main Phase, not a Standby Phase trigger', async () => {
    const { g, c0, place } = setup();
    const pz = place(0, N('Plaguespreader Zombie'), 'grave');
    place(0, T.brute, 'hand');
    let asked = 0;
    c0.confirmTrigger = async () => (asked++, true);
    g.turn = 3;
    await (g as any).setPhase('standby');
    eq(asked, 0, 'no Standby Phase trigger');
    g.phase = 'main1';
    await activateCard(g, 0, pz);
    eq(pz.location, 'mzone', 'Special Summoned from the GY');
  });

  // https://edisonrul.ing/cards/p/pot-of-avarice.html
  await test('Pot of Avarice: cannot be activated with 1 or 0 cards in the Deck', async () => {
    const { g, place } = setup();
    for (let i = 0; i < 5; i++) place(0, T.brute, 'grave');
    const pot = place(0, N('Pot of Avarice'), 'hand');
    g.players[0].deck.splice(0, g.players[0].deck.length - 1);
    eq(offered(g, 0, pot), false, '1 card in the Deck');
    place(0, T.wall, 'deck');
    eq(offered(g, 0, pot), true, '2 cards in the Deck');
  });

  // https://edisonrul.ing/cards/g/gemini-spark.html
  await test('Gemini Spark: cannot be activated with no cards in the Deck', async () => {
    const { g, place } = setup();
    const elf = place(0, N('Elemental Hero Neos Alius'), 'mzone');
    elf.flags.geminiSummoned = true;
    place(1, T.brute, 'mzone');
    const gs = place(0, N('Gemini Spark'), 'hand');
    eq(offered(g, 0, gs), true, 'with a Deck');
    g.players[0].deck.splice(0);
    eq(offered(g, 0, gs), false, 'empty Deck');
  });

  // https://edisonrul.ing/cards/g/geartown.html
  await test('Geartown: activates when destroyed face-down; not when its controller replaces it with a new Field Spell', async () => {
    const { g, c0, place } = setup();
    const town = place(0, N('Geartown'), 'fzone', { faceUp: false });
    const gear = place(0, N('Ancient Gear Gadjiltron Dragon'), 'deck');
    pickOnly(c0, [gear]);
    await g.destroy([town], 'effect', 1);
    await g.processTriggers(true);
    eq(gear.location, 'mzone', 'face-down Geartown destroyed: Ancient Gear Special Summoned');
    const r = setup();
    const town2 = r.place(0, N('Geartown'), 'fzone', { faceUp: true });
    const gear2 = r.place(0, N('Ancient Gear Gadjiltron Dragon'), 'deck');
    await activateCard(r.g, 0, r.place(0, N('Necrovalley'), 'hand'));
    eq(town2.location, 'grave', 'replaced');
    eq(gear2.location, 'deck', 'no Special Summon');
  });

  // https://edisonrul.ing/cards/j/junk-archer.html
  await test('Junk Archer: the banished monster returns face-down if it was face-down, and that is not a Special Summon', async () => {
    const { g, place } = setup();
    const ja = place(0, N('Junk Archer'), 'mzone');
    const fd = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await activateCard(g, 0, ja);
    eq(fd.location, 'banished', 'banished');
    eq(fd.faceUp, false, 'banished face-down');
    const before = g.eventLog.length;
    await (g as any).setPhase('end');
    eq(fd.location, 'mzone', 'returned');
    eq(fd.faceUp, false, 'face-down again');
    eq(fd.pos, 'def', 'same position');
    eq(g.eventLog.slice(before).some((e) => e.type === 'specialSummoned' && e.card === fd), false, 'not a Special Summon');
  });

  // https://edisonrul.ing/cards/n/necro-gardna.html
  await test("Necro Gardna: activated before the attack (opponent's Main Phase), it negates the next attack this turn", async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const ng = place(0, N('Necro Gardna'), 'grave');
    const att = place(1, T.brute, 'mzone');
    eq(g.getActivations(0, { open: false }).some((a) => a.card === ng), true, 'usable in the Main Phase');
    const act = g.getActivations(0, { open: false }).find((a) => a.card === ng)!;
    await g.activate(0, act);
    await g.runChain();
    eq(ng.location, 'banished', 'banished as the cost');
    g.phase = 'battle';
    await g.conductAttack(1, att);
    eq(g.players[0].lp, 8000, 'the next attack was negated');
    att.attacksThisTurn = 0;
    await g.conductAttack(1, att);
    eq(g.players[0].lp, 8000 - 1800, 'only one attack is negated');
  });

  // https://edisonrul.ing/cards/g/gateway-of-the-six.html
  await test('Gateway of the Six: its effect does not resolve if Gateway left the field in response', async () => {
    const { g, c1, place } = setup();
    const gw = place(0, N('Gateway of the Six'), 'szone', { faceUp: true });
    gw.counters.bushido = 4;
    const sam = place(0, N('The Six Samurai - Kamon'), 'deck');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    (g.players[1].szone.find((c) => c?.name === 'Mystical Space Typhoon') as CardInstance).setTurn = 0;
    c1.respond = respondWith('Mystical Space Typhoon');
    pickOnly(c1, [gw]);
    await activateCard(g, 0, gw, 'Add a Six Samurai from Deck or GY (4 counters)');
    eq(gw.location, 'grave', 'Gateway destroyed in response');
    eq(sam.location, 'deck', 'nothing added');
  });

  // https://edisonrul.ing/cards/m/mezuki.html
  await test('Mezuki: the target is not Summoned if it is no longer a Zombie when the effect resolves', async () => {
    const { g, c1, place } = setup();
    const zw = place(1, N('Zombie World'), 'fzone');
    const mez = place(0, N('Mezuki'), 'grave');
    const war = place(0, T.brute, 'grave');
    eq(war.data.race, 'Zombie', 'a Warrior is a Zombie under Zombie World');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mystical Space Typhoon');
    pickOnly(c1, [zw]);
    void mez;
    g.players[0].grave.splice(g.players[0].grave.indexOf(mez), 1);
    g.players[0].grave.push(mez);
    const c0pick = (_g: Game, req: SelectRequest) => (req.candidates.includes(war) ? [war] : req.candidates.slice(0, req.min));
    (g.controllers[0] as TestController).pick = c0pick;
    await activateCard(g, 0, mez);
    eq(zw.location, 'grave', 'Zombie World destroyed in response');
    eq(war.location, 'grave', 'the Warrior is not Special Summoned');
  });

  // https://edisonrul.ing/cards/m/machina-gearframe.html
  await test('Machina Gearframe: unequipping with no open Monster Zone sends it to the GY', async () => {
    const { g, c0, place } = setup();
    const host = place(0, T.bigMachine, 'mzone');
    const gf = place(0, N('Machina Gearframe'), 'mzone');
    pickOnly(c0, [host]);
    await activateCard(g, 0, gf, 'Equip to a Machine monster');
    eq(gf.location, 'szone', 'equipped');
    for (let i = 0; i < 4; i++) place(0, T.wall, 'mzone');
    g.turn += 2;
    const ef = gf.data.effects!.findIndex((e) => e.label === 'Unequip and Special Summon');
    const ctx = new Ctx(g, gf, gf.data.effects![ef], 0);
    await gf.data.effects![ef].resolve!(ctx);
    eq(gf.location, 'grave', 'sent to the GY');
  });

  // https://edisonrul.ing/cards/h/herald-of-orange-light.html, https://edisonrul.ing/cards/h/honest.html
  await test('Herald of Orange Light / Honest: their send-to-GY costs cannot be paid under Macro Cosmos / Dimensional Fissure', async () => {
    const { g, place } = setup();
    const herald = place(0, N('Herald of Orange Light'), 'hand');
    place(0, N('Shining Angel'), 'hand');
    const hIdx = herald.data.effects!.findIndex((e) => e.kind === 'quick');
    const ef = herald.data.effects![hIdx];
    eq(ef.canActivate!(new Ctx(g, herald, ef, 0)), true, 'Herald payable normally');
    place(1, N('Macro Cosmos'), 'szone', { faceUp: true });
    eq(ef.canActivate!(new Ctx(g, herald, ef, 0)), false, 'not under Macro Cosmos');
    const f = setup();
    const honest = f.place(0, N('Honest'), 'hand');
    const oIdx = honest.data.effects!.findIndex((e) => e.kind === 'quick');
    const oef = honest.data.effects![oIdx];
    eq(oef.canActivate!(new Ctx(f.g, honest, oef, 0)), true, 'Honest payable normally');
    f.place(1, N('Dimensional Fissure'), 'szone', { faceUp: true });
    eq(oef.canActivate!(new Ctx(f.g, honest, oef, 0)), false, 'not under Dimensional Fissure');
  });

  // https://edisonrul.ing/cards/g/gorz-the-emissary-of-darkness.html
  await test('Gorz: after effect damage, it inflicts the same amount to the opponent (not an LP gain)', async () => {
    const { g, place } = setup();
    const gorz = place(0, N('Gorz the Emissary of Darkness'), 'hand');
    g.players[0].hand.forEach(() => undefined);
    await g.damage(0, 1000, 'effect', place(1, T.brute, 'mzone'), 1);
    await g.processTriggers(true);
    eq(gorz.location, 'mzone', 'Gorz Special Summoned');
    eq(g.players[0].lp, 7000, 'no LP gain');
    eq(g.players[1].lp, 7000, 'opponent takes 1000');
  });

  // https://edisonrul.ing/cards/l/legendary-jujitsu-master.html, https://edisonrul.ing/cards/g/goyo-guardian.html
  await test('Legendary Jujitsu Master: activates at the end of the Damage Step, chaining with Goyo Guardian', async () => {
    const goyo = N('Goyo Guardian');
    const { g, c0, place } = setup([goyo]);
    const gy = place(0, goyo, 'mzone');
    const jj = place(1, N('Legendary Jujitsu Master'), 'mzone', { pos: 'def' });
    pickOnly(c0, [jj]);
    g.phase = 'battle';
    await g.conductAttack(0, gy);
    eq(gy.location === 'mzone', false, 'Goyo Guardian returned to the Deck');
    eq(jj.location, 'mzone', 'Goyo Guardian still Special Summoned Jujitsu (same Substep 7 chain)');
    eq(jj.controller, 0, 'on the attacking player side');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-bestiari.html (tag-out rulings shared by every Gladiator Beast)
  await test('Gladiator Beast tag-out: not after a negated attack, nor after being flipped face-down', async () => {
    const { g, c1, place } = setup();
    const best = place(0, N('Gladiator Beast Bestiari'), 'mzone');
    const laq = place(0, N('Gladiator Beast Laquari'), 'deck');
    place(1, T.wall, 'mzone');
    place(1, N('Magic Cylinder'), 'szone', { faceUp: false });
    c1.respond = respondWith('Magic Cylinder');
    g.phase = 'battle';
    await g.conductAttack(0, best);
    eq(best.attackedThisTurnOrWasAttacked, false, 'attack negated before damage calculation: it did not battle');
    await battleEnd(g);
    eq(laq.location, 'deck', 'no tag-out');
    const f = setup();
    const b2 = f.place(0, N('Gladiator Beast Bestiari'), 'mzone');
    const l2 = f.place(0, N('Gladiator Beast Laquari'), 'deck');
    f.g.phase = 'battle';
    await f.g.conductAttack(0, b2);
    eq(b2.attackedThisTurnOrWasAttacked, true, 'direct attack reached damage calculation');
    await f.g.changePosition(b2, 'def', false);
    await f.g.changePosition(b2, 'atk', true);
    await battleEnd(f.g);
    eq(l2.location, 'deck', 'flipped face-down after battling: no tag-out');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
