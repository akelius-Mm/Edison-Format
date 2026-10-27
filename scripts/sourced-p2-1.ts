// Sourced rulings regression tests, group p2-1 (Cloudian - Turbulence .. Ebon Arrow): each test pins a behaviour to
// the 2010 TCG text / rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/sourced-p2-1.ts
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

const fx = (g: Game, card: CardInstance, idx: number, p: PlayerId) => {
  const ctx = new Ctx(g, card, card.data.effects![idx], p);
  ctx.effectIndex = idx;
  return ctx;
};
const efIdx = (card: CardInstance, label: string) => card.data.effects!.findIndex((e) => e.label === label);
const fakeLink = (card: any, effect: any, player: PlayerId, isCardActivation: boolean) =>
  ({ index: 0, card, effect, effectIndex: 0, player, ctx: { targets: [] }, negated: false, speed: 2, isCardActivation, fromLocation: 'szone' }) as any;

(async () => {
  console.log('Sourced rulings tests: group p2-1 (Cloudian - Turbulence .. Ebon Arrow)');

  // https://edisonrul.ing/cards/c/cloudian-squall.html
  await test('Cloudian Squall: activates each Standby Phase even with no face-up monster', async () => {
    const { g, place } = setup();
    const sq = place(0, N('Cloudian Squall'), 'szone', { faceUp: true });
    await (g as any).setPhase('standby');
    eq(activatedLinks(g, sq), 1, 'Chain Link with no monsters on the field');
  });

  // https://edisonrul.ing/cards/c/colosseum-cage-of-the-gladiator-beasts.html
  await test('Colosseum - Cage of the Gladiator Beasts: placing the Counter starts a Chain', async () => {
    const { g, place } = setup();
    const col = place(0, N('Colosseum - Cage of the Gladiator Beasts'), 'fzone', { faceUp: true });
    const b = place(0, T.brute, 'deck');
    await g.specialSummon([b], 0, { pos: 'atk' });
    await g.processTriggers(true);
    eq(col.counters.colosseum, 1, '1 Counter');
    eq(activatedLinks(g, col), 1, 'as a Chain Link');
  });

  // https://edisonrul.ing/cards/c/core-reinforcement.html
  await test('Core Reinforcement: no damage if it is destroyed first (MST) in the End Phase; damage if both go together', async () => {
    for (const together of [false, true]) {
      const { g, place } = setup();
      const cr = place(0, N('Core Reinforcement'), 'szone', { faceUp: false });
      const drago = place(0, N("Koa'ki Meiru Drago"), 'grave');
      await activate(g, 0, cr);
      eq(drago.location, 'mzone', 'Summoned');
      g.phase = 'end';
      await g.destroy(together ? [cr, drago] : [cr], 'effect', 1);
      await g.ruleCleanup();
      await g.processTriggers(true);
      eq(drago.location, 'grave', 'the monster is destroyed');
      eq(g.players[0].lp, together ? 8000 - (drago.data.atk ?? 0) : 8000, together ? 'damage (Icarus Attack case)' : 'no damage (MST case)');
    }
  });

  // https://edisonrul.ing/cards/c/confusion-chaff.html
  await test('Confusion Chaff: a face-down first attacker is flipped face-up and the battle is conducted normally', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const first = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    const att = place(1, T.lightHitter, 'mzone');
    g.turnData['csoc:direct'] = [{ card: first, moveId: first.moveId }];
    place(0, N('Confusion Chaff'), 'szone', { faceUp: false });
    c0.respond = respondWith('Confusion Chaff');
    await g.conductAttack(1, att);
    eq(first.faceUp, true, 'flipped face-up');
    eq(g.players[0].lp, 8000, 'no damage to the Chaff player');
    eq(g.players[1].lp, 7000, 'DEF 2000 vs ATK 1000: 1000 to the attacking player');
  });

  // https://edisonrul.ing/cards/c/codarus.html
  await test('Codarus: a target you gained control of is not sent to the GY; the other one is', async () => {
    const { g, place } = setup();
    const cod = place(0, N('Codarus'), 'mzone');
    const a = place(1, T.brute, 'mzone');
    const b = place(1, T.wall, 'mzone');
    const ctx = fx(g, cod, 0, 0);
    ctx.addTargets([a, b]);
    await g.takeControl(a, 0);
    await ctx.effect.resolve!(ctx);
    eq(a.location, 'mzone', 'the monster you now control stays');
    eq(b.location, 'grave', 'the other target is sent');
  });

  // https://edisonrul.ing/cards/c/cosmic-fortress-golgar.html
  await test("Cosmic Fortress Gol'gar: the A-Counter destruction targets when activated", async () => {
    const { g, c1, place } = setup();
    const gol = place(0, N("Cosmic Fortress Gol'gar"), 'mzone');
    const host = place(1, T.brute, 'mzone');
    host.counters.A = 2;
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === gol && top.ctx.targets.length === 1) targeted = true;
      return null;
    };
    await activate(g, 0, gol, 'Remove 2 A-Counters: destroy 1 card');
    eq(targeted, true, 'target chosen at activation');
    eq(host.location === 'grave' || st.location === 'grave', true, 'a card destroyed');
  });

  // https://edisonrul.ing/cards/c/cup-of-ace.html
  await test('Cup of Ace: cannot be activated while the opponent has 1 card in the Deck', async () => {
    const { g, place } = setup();
    const cup = place(0, N('Cup of Ace'), 'hand');
    eq(canActivate(g, 0, cup), true, 'both Decks have cards');
    g.players[1].deck.splice(1);
    eq(canActivate(g, 0, cup), false, 'opponent Deck 1');
  });

  // https://edisonrul.ing/cards/c/cyber-jar.html
  await test('Cyber Jar: the turn player Special Summons first', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const jar = place(0, N('Cyber Jar'), 'mzone', { faceUp: false, pos: 'def' });
    const ctx = fx(g, jar, 0, 0);
    const start = g.eventLog.length;
    await ctx.effect.resolve!(ctx);
    const first = g.eventLog.slice(start).find((e) => e.type === 'specialSummoned');
    eq((first?.card as CardInstance | undefined)?.owner, 1, "the turn player's monster comes first");
  });

  // https://edisonrul.ing/cards/c/cyber-phoenix.html
  await test('Cyber Phoenix: optional draw; none when it was attacked face-down', async () => {
    for (const [faceUp, yes, drawn] of [
      [false, true, 0],
      [true, false, 0],
      [true, true, 1],
    ] as const) {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      g.phase = 'battle';
      place(0, N('Cyber Phoenix'), 'mzone', faceUp ? { pos: 'atk' } : { faceUp: false, pos: 'def' });
      const att = place(1, T.big, 'mzone');
      c0.trigger = () => yes;
      await g.conductAttack(1, att);
      eq(g.players[0].hand.length, drawn, `face-up ${faceUp}, accepts ${yes}`);
    }
  });

  // https://edisonrul.ing/cards/c/cyborg-doctor.html
  await test('Cyborg Doctor: can Tribute a face-down Tuner; targets the monster in the GY on activation', async () => {
    const { g, c1, place } = setup();
    const doc = place(0, N('Cyborg Doctor'), 'mzone');
    place(0, N('Junk Synchron'), 'mzone', { faceUp: false, pos: 'def' });
    const other = place(0, N('Junk Synchron'), 'grave');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === doc && top.ctx.targets.length === 1) targeted = true;
      return null;
    };
    eq(canActivate(g, 0, doc), true, 'face-down Tuner usable');
    await activate(g, 0, doc);
    eq(targeted, true, 'targets on activation');
    eq(g.monsters(0).some((c) => c.name === 'Junk Synchron' && c.faceUp), true, 'a Junk Synchron is Special Summoned');
    void other;
  });

  // https://edisonrul.ing/cards/d/d-formation.html
  await test('D - Formation: not offered for a face-down Special Summon', async () => {
    for (const faceDown of [true, false]) {
      const { g, c0, place } = setup();
      const df = place(0, N('D - Formation'), 'szone', { faceUp: true });
      df.counters.d = 2;
      place(0, T.brute, 'deck');
      const b = place(0, T.brute, 'grave');
      let asked = false;
      c0.trigger = () => {
        asked = true;
        return false;
      };
      await g.specialSummon([b], 0, { pos: faceDown ? 'def' : 'atk', faceDown });
      await g.processTriggers(true);
      eq(asked, !faceDown, faceDown ? 'face-down: not offered' : 'face-up: offered');
    }
  });

  // https://edisonrul.ing/cards/d/dna-checkup.html
  await test('DNA Checkup: cannot be activated while a player has fewer than 2 cards in the Deck', async () => {
    const { g, place } = setup();
    const dna = place(0, N('DNA Checkup'), 'szone', { faceUp: false });
    place(0, T.brute, 'mzone', { faceUp: false, pos: 'def' });
    eq(canActivate(g, 0, dna), true, 'normal case');
    g.players[1].deck.splice(1);
    eq(canActivate(g, 0, dna), false, 'opponent Deck 1');
  });

  // https://edisonrul.ing/cards/d/dark-horus.html
  await test("Dark Horus: activates after a Spell that was Chain Link 1; misses the timing when it was not", async () => {
    const a = setup();
    a.g.turnPlayer = 1;
    a.place(0, N('Dark Horus'), 'mzone');
    const dark = a.place(0, T.dark, 'grave');
    const pot = a.place(1, N('Pot of Greed'), 'hand');
    await activate(a.g, 1, pot);
    eq(dark.location, 'mzone', 'revived after Pot of Greed (Chain Link 1)');

    const b = setup();
    b.g.turnPlayer = 1;
    b.place(0, N('Dark Horus'), 'mzone');
    const dark2 = b.place(0, T.dark, 'grave');
    b.place(1, T.brute, 'szone', { faceUp: false });
    const dt = b.place(0, N('Dust Tornado'), 'szone', { faceUp: false });
    b.place(1, N('Mystical Space Typhoon'), 'hand');
    b.c1.respond = respondWith('Mystical Space Typhoon');
    await activate(b.g, 0, dt);
    eq(b.g.eventLog.some((e) => e.type === 'chainActivated' && (e.card as CardInstance).name === 'Mystical Space Typhoon'), true, 'MST chained as Chain Link 2');
    eq(dark2.location, 'grave', 'missed the timing');
  });

  // https://edisonrul.ing/cards/d/dark-magician-of-chaos.html
  await test('Dark Magician of Chaos: no effect when Special Summoned face-down (already the engine behaviour; pinned)', async () => {
    const { g, c0, place } = setup();
    const dmoc = place(0, N('Dark Magician of Chaos'), 'grave');
    place(0, N('Pot of Greed'), 'grave');
    let asked = false;
    c0.trigger = () => {
      asked = true;
      return true;
    };
    await g.specialSummon([dmoc], 0, { pos: 'def', faceDown: true });
    await g.processTriggers(true);
    eq(asked, false, 'not offered');
    eq(activatedLinks(g, dmoc), 0, 'no Chain Link');
  });

  // https://edisonrul.ing/cards/d/dark-spider.html
  await test('Dark Spider: its effect targets', async () => {
    const { g, c1, place } = setup();
    const sp = place(0, N('Dark Spider'), 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === sp && top.ctx.targets.includes(sp)) targeted = true;
      return null;
    };
    await activate(g, 0, sp);
    eq(targeted, true, 'targets on activation');
    eq(g.getLevel(sp), 3, 'Level 1 + 2');
  });

  // https://edisonrul.ing/cards/d/defense-draw.html
  await test('Defense Draw: not offered when you would take no battle damage', async () => {
    for (const [atkCard, expect] of [
      [T.lightHitter, false],
      [T.big, true],
    ] as const) {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      g.phase = 'battle';
      place(0, atkCard === T.big ? T.brute : T.wall, 'mzone', atkCard === T.big ? { pos: 'atk' } : { pos: 'def' });
      place(0, N('Defense Draw'), 'szone', { faceUp: false });
      const att = place(1, atkCard, 'mzone');
      let offered = false;
      c0.respond = (_g, req) => {
        if (offers(req, 'Defense Draw')) offered = true;
        return null;
      };
      await g.conductAttack(1, att);
      eq(offered, expect, expect ? 'offered (1800 vs 2500)' : 'not offered (DEF 2000 vs 1000)');
    }
  });

  // https://edisonrul.ing/cards/d/depth-amulet.html
  await test('Depth Amulet: targets the attacker; the discard happens on resolution (not a cost)', async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const am = place(0, N('Depth Amulet'), 'szone', { faceUp: true });
    const card = place(0, T.wall, 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    const att = place(1, T.big, 'mzone');
    c0.respond = respondWith('Depth Amulet');
    let handAtLink = -1;
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top && top.card === am) {
        handAtLink = gg.players[0].hand.length;
        targeted = top.ctx.targets.includes(att);
      }
      return null;
    };
    await g.conductAttack(1, att);
    eq(handAtLink, 1, 'card still in hand when the effect is activated');
    eq(targeted, true, 'the attacker is targeted');
    eq(card.location, 'grave', 'discarded on resolution');
    eq(g.players[0].lp, 8000, 'attack negated');
  });

  // https://edisonrul.ing/cards/d/deck-lockdown.html
  await test('Deck Lockdown: destroyed in the 2nd Standby Phase without a Chain', async () => {
    const { g, place } = setup();
    const dl = place(0, N('Deck Lockdown'), 'szone', { faceUp: true });
    await (g as any).setPhase('standby');
    eq(dl.location, 'szone', '1st Standby Phase: stays');
    await (g as any).setPhase('standby');
    eq(dl.location, 'grave', '2nd Standby Phase: destroyed');
    eq(activatedLinks(g, dl), 0, 'no Chain Link');
  });

  // https://edisonrul.ing/cards/d/discord.html
  await test('Discord: sent to the GY on your 3rd End Phase without a Chain', async () => {
    const { g, place } = setup();
    const d = place(0, N('Discord'), 'szone', { faceUp: true });
    d.counters.discord = 2;
    await (g as any).setPhase('end');
    eq(d.location, 'grave', 'sent');
    eq(activatedLinks(g, d), 0, 'no Chain Link');
  });

  // https://edisonrul.ing/cards/d/desert-protector.html
  await test('Desert Protector: 1 Desert Protector saves every Insect destroyed at the same time', async () => {
    const { g, place } = setup();
    const dp = place(0, N('Desert Protector'), 'mzone');
    const k1 = place(0, N('Insect Knight'), 'mzone');
    const k2 = place(0, N('Insect Knight'), 'mzone');
    await g.destroy([k1, k2], 'effect', 1);
    eq(dp.location, 'grave', 'Desert Protector destroyed instead');
    eq(k1.location === 'mzone' && k2.location === 'mzone', true, 'both Insects stay');
  });

  // https://edisonrul.ing/cards/d/destruct-potion.html
  await test('Destruct Potion: a face-down target gives no LP', async () => {
    const { g, place } = setup();
    const dp = place(0, N('Destruct Potion'), 'szone', { faceUp: false });
    const t = place(0, T.brute, 'mzone', { faceUp: false, pos: 'def' });
    const ctx = fx(g, dp, 0, 0);
    ctx.addTargets([t]);
    await ctx.effect.resolve!(ctx);
    eq(t.location, 'grave', 'destroyed');
    eq(g.players[0].lp, 8000, 'no LP gained');
  });

  // https://edisonrul.ing/cards/d/destruction-jammer.html
  await test('Destruction Jammer: not against a Continuous Spell/Trap Ignition-like effect, nor with no monster on the field', async () => {
    const { g, place } = setup();
    const jam = place(0, N('Destruction Jammer'), 'szone', { faceUp: false });
    const ctx = fx(g, jam, 0, 0);
    const hole = place(1, N('Pot of Greed'), 'szone', { faceUp: true });
    g.chain.push(fakeLink(hole, { kind: 'activate', categories: ['destroy', 'destroyMulti'] }, 1, true));
    eq(jam.data.effects![0].condition!(ctx), false, 'no monster on the field');
    place(0, T.brute, 'mzone');
    eq(jam.data.effects![0].condition!(ctx), true, 'a monster on the field');
    g.chain = [fakeLink(hole, { kind: 'ignition', categories: ['destroy'] }, 1, false)];
    eq(jam.data.effects![0].condition!(ctx), false, 'Ignition-like effect of a face-up Spell/Trap');
    g.chain = [];
  });

  // https://edisonrul.ing/cards/d/dice-try.html
  await test('Dice Try!: not against the Ignition-like effect of a Continuous Spell/Trap', async () => {
    const { g, place } = setup();
    const dt = place(0, N('Dice Try!'), 'szone', { faceUp: false });
    const ctx = fx(g, dt, 0, 0);
    const fake = { name: 'Fake Dice Spell', isSpell: true, isTrap: false, isMonster: false, data: { text: 'Roll a six-sided die.' } };
    g.chain = [fakeLink(fake, { kind: 'ignition' }, 1, false)];
    eq(dt.data.effects![0].condition!(ctx), false, 'Ignition-like effect');
    g.chain = [fakeLink(fake, { kind: 'activate' }, 1, true)];
    eq(dt.data.effects![0].condition!(ctx), true, 'card activation');
    g.chain = [];
  });

  // https://edisonrul.ing/cards/d/diamond-dust-cyclone.html
  await test('Diamond-Dust Cyclone: needs a card in the Deck; a target flipped face-down is destroyed with no draw', async () => {
    const { g, place } = setup();
    const ddc = place(0, N('Diamond-Dust Cyclone'), 'hand');
    const m = place(1, T.brute, 'mzone');
    m.counters.fog = 8;
    eq(canActivate(g, 0, ddc), true, 'normal case');
    const ctx = fx(g, ddc, 0, 0);
    ctx.addTargets([m]);
    await g.changePosition(m, 'def', false);
    await ctx.effect.resolve!(ctx);
    eq(m.location, 'grave', 'destroyed');
    eq(g.players[0].hand.length, 1, 'no draw (only the Cyclone in hand)');
    const s = setup();
    const ddc2 = s.place(0, N('Diamond-Dust Cyclone'), 'hand');
    const m2 = s.place(1, T.brute, 'mzone');
    m2.counters.fog = 4;
    s.g.players[0].deck.length = 0;
    eq(canActivate(s.g, 0, ddc2), false, 'empty Deck');
  });

  // https://edisonrul.ing/cards/d/dimension-explosion.html
  await test('Dimension Explosion: both players need a banished monster; targets on activation', async () => {
    const { g, place } = setup();
    const de = place(0, N('Dimension Explosion'), 'hand');
    place(0, N('Cyber Twin Dragon'), 'mzone');
    const mine = place(0, T.brute, 'banished');
    eq(canActivate(g, 0, de), false, 'opponent has no banished monster');
    const theirs = place(1, T.wall, 'banished');
    eq(canActivate(g, 0, de), true, 'both have one');
    const ctx = fx(g, de, 0, 0);
    await ctx.effect.activate!(ctx);
    eq(ctx.targets.includes(mine) && ctx.targets.includes(theirs), true, 'both targeted on activation');
    await ctx.effect.resolve!(ctx);
    eq(mine.location === 'mzone' && theirs.location === 'mzone', true, 'both Special Summoned');
  });

  // https://edisonrul.ing/cards/d/disarm.html
  await test('Disarm: the "Gladiator Beast" is returned on resolution, not as a cost', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    place(0, N('Disarm'), 'szone', { faceUp: false });
    const gb = place(0, N('Gladiator Beast Laquari'), 'hand');
    const pot = place(1, N('Pot of Greed'), 'hand');
    c0.respond = respondWith('Disarm');
    const start = g.eventLog.length;
    await activate(g, 1, pot);
    const log = g.eventLog.slice(start);
    const act = log.findIndex((e) => e.type === 'chainActivated' && (e.card as CardInstance).name === 'Disarm');
    const ret = log.findIndex((e) => e.card === gb && e.to === 'deck');
    eq(act >= 0 && ret > act, true, 'returned after the activation');
    eq(gb.location, 'deck', 'returned');
    eq(pot.location, 'grave', 'Pot of Greed negated and destroyed');
    eq(g.players[1].hand.length, 0, 'no draw');
  });

  // https://edisonrul.ing/cards/d/domino-effect.html
  await test('Domino Effect: targets 1 monster your opponent controls on activation', async () => {
    const { g, place } = setup();
    const dom = place(0, N('Domino Effect'), 'szone', { faceUp: true });
    place(0, T.wall, 'mzone');
    const foe = place(1, T.brute, 'mzone');
    const ctx = fx(g, dom, efIdx(dom, 'Send 1 monster: destroy 1 opponent monster'), 0);
    await ctx.effect.activate!(ctx);
    eq(ctx.targets.includes(foe), true, 'targeted');
    await ctx.effect.resolve!(ctx);
    eq(foe.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/d/doomkaiser-dragonassault-mode.html
  await test('Doomkaiser Dragon/Assault Mode: targets the Zombies in the GYs on activation', async () => {
    const { g, c0, place } = setup();
    const dk = place(0, N('Doomkaiser Dragon/Assault Mode'), 'mzone');
    const z1 = place(0, N('Pyramid Turtle'), 'grave');
    const z2 = place(1, N('Goblin Zombie'), 'grave');
    c0.pick = (_g, req) => req.candidates.slice(0, req.max);
    const ctx = fx(g, dk, 0, 0);
    await ctx.effect.activate!(ctx);
    eq(ctx.targets.includes(z1) && ctx.targets.includes(z2), true, 'both targeted');
    await ctx.effect.resolve!(ctx);
    eq(z1.location === 'mzone' && z2.location === 'mzone' && z2.controller === 0, true, 'both Summoned to your side');
  });

  // https://edisonrul.ing/cards/d/double-summon.html
  await test('Double Summon: only 1 extra Normal Summon per turn from this card', async () => {
    const { g, place } = setup();
    const a = place(0, N('Double Summon'), 'hand');
    const b = place(0, N('Double Summon'), 'hand');
    const before = g.players[0].normalSummonsLeft;
    for (const c of [a, b]) {
      const ctx = fx(g, c, 0, 0);
      await ctx.effect.resolve!(ctx);
    }
    eq(g.players[0].normalSummonsLeft, before + 1, '+1 only');
  });

  // https://edisonrul.ing/cards/d/double-edged-sword-technique.html
  await test('Double-Edged Sword Technique: damage only for the Six Samurai actually destroyed', async () => {
    const { g, c0, place } = setup();
    c0.confirm = async () => false;
    const dest = place(0, N('Double-Edged Sword Technique'), 'szone', { faceUp: false });
    const y = place(0, N('The Six Samurai - Yaichi'), 'grave');
    const k = place(0, N('The Six Samurai - Kamon'), 'grave');
    const ctx = fx(g, dest, 0, 0);
    ctx.addTargets([y, k]);
    await ctx.effect.resolve!(ctx);
    eq(y.location === 'mzone' && k.location === 'mzone', true, 'Summoned');
    g.addTempMod(y, 'indestructibleEffect', true, 'turn');
    await (g as any).setPhase('end');
    eq(y.location, 'mzone', 'Yaichi not destroyed');
    eq(k.location, 'grave', 'Kamon destroyed');
    eq(g.players[0].lp, 8000 - (k.data.atk ?? 0), "only Kamon's ATK");
  });

  // https://edisonrul.ing/cards/d/dragon-queen-of-tragic-endings.html
  await test('Dragon Queen of Tragic Endings: no draw when the opponent has no card in hand', async () => {
    const { g, place } = setup();
    const dq = place(0, N('Dragon Queen of Tragic Endings'), 'mzone');
    const ctx = fx(g, dq, efIdx(dq, 'Hand to GY, draw 1'), 0);
    await ctx.effect.resolve!(ctx);
    eq(g.players[0].hand.length, 0, 'no draw');
  });

  // https://edisonrul.ing/cards/d/drastic-drop-off.html
  await test('Drastic Drop Off: not after Graceful Charity (draw then discard in the same resolution)', async () => {
    for (const [name, expect] of [
      ['Graceful Charity', false],
      ['Pot of Greed', true],
    ] as const) {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      place(0, N('Drastic Drop Off'), 'szone', { faceUp: false });
      const sp = place(1, N(name), 'hand');
      let offered = false;
      c0.respond = (_g, req) => {
        if (offers(req, 'Drastic Drop Off')) offered = true;
        return null;
      };
      await activate(g, 1, sp);
      eq(offered, expect, name);
    }
  });

  // https://edisonrul.ing/cards/d/destiny-end-dragoon.html
  await test('Destiny End Dragoon: the Graveyard Special Summon has no once-per-turn', async () => {
    const ded = N('Destiny End Dragoon');
    const ef = ded.effects!.find((e) => e.label === 'Banish a Destiny HERO: Special Summon this card')!;
    eq(!!ef.opt, false, 'no once per turn');
  });

  // https://edisonrul.ing/cards/e/earthbound-immortal-aslla-piscu.html
  await test('Earthbound Immortal Aslla piscu: no effect when it is returned to the Deck', async () => {
    const { g, place } = setup();
    place(0, N('Realm of Light'), 'fzone', { faceUp: true });
    const a = place(0, N('Earthbound Immortal Aslla piscu'), 'mzone');
    const foe = place(1, T.brute, 'mzone');
    await g.moveCards([a], 'deck', { reason: 'effect', reasonPlayer: 1 });
    await g.processTriggers(true);
    eq(foe.location, 'mzone', 'no destruction');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/e/earthbound-immortal-ccarayhua.html
  await test('Earthbound Immortal Ccarayhua: activates when destroyed in the hand', async () => {
    const { g, place } = setup();
    const c = place(0, N('Earthbound Immortal Ccarayhua'), 'hand');
    const foe = place(1, T.brute, 'mzone');
    await g.moveCards([c], 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], destroyed: true, reasonPlayer: 1 });
    await g.processTriggers(true);
    eq(foe.location, 'grave', 'all cards on the field destroyed');
  });

  // https://edisonrul.ing/cards/e/earthbound-immortal-cusillu.html
  await test('Earthbound Immortal Cusillu: the Tribute is part of the effect, not a cost', async () => {
    const { g, place } = setup();
    place(0, N('Realm of Light'), 'fzone', { faceUp: true });
    const cus = place(0, N('Earthbound Immortal Cusillu'), 'mzone');
    const other = place(0, T.brute, 'mzone');
    const idx = cus.data.effects!.findIndex((e) => !!e.replaceDestroy);
    const ctx = fx(g, cus, idx, 0);
    const start = g.eventLog.length;
    const saved = await ctx.effect.replaceDestroy!(ctx, [cus], 'battle');
    eq(saved.includes(cus), true, 'saved');
    const ev = g.eventLog.slice(start).find((e) => e.card === other && e.type === 'sentToGrave');
    eq(!!ev && !(ev.reasons ?? []).includes('cost'), true, 'not a cost');
    eq(g.players[1].lp, 4000, 'LP halved');
  });

  // https://edisonrul.ing/cards/e/earthbound-whirlwind.html
  await test('Earthbound Whirlwind: still applied without an Earthbound Immortal on resolution', async () => {
    const { g, place } = setup();
    const ew = place(0, N('Earthbound Whirlwind'), 'szone', { faceUp: true });
    const st = place(1, N('Dust Tornado'), 'szone', { faceUp: false });
    const ctx = fx(g, ew, 0, 0);
    await ctx.effect.resolve!(ctx);
    eq(st.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/e/ebon-arrow.html
  await test('Ebon Arrow: damage still applies when both monsters are destroyed (equal ATK); usable in the Damage Step', async () => {
    const { g, place } = setup();
    const arrow = place(0, N('Ebon Arrow'), 'szone', { faceUp: false });
    eq(!!arrow.data.effects![0].damageStep, true, 'Damage Step');
    const b = place(0, T.brute, 'mzone');
    const foe = place(1, normal('Sourced 1300 Wall', 'EARTH', 'Rock', 4, 1300, 900), 'mzone');
    const ctx = fx(g, arrow, 0, 0);
    ctx.addTargets([b]);
    await ctx.effect.resolve!(ctx);
    eq(g.getAtk(b), 1300, '-500 ATK');
    g.phase = 'battle';
    await g.conductAttack(0, b);
    eq(b.location === 'grave' && foe.location === 'grave', true, 'both destroyed');
    eq(g.players[1].lp, 8000 - 900, "original DEF of the destroyed monster");
  });

  // https://edisonrul.ing/cards/c/cross-porter.html
  await test('Cross Porter: when it sends itself, its search effect cannot be activated (missed timing; already the engine behaviour; pinned)', async () => {
    const { g, c0, place } = setup();
    const cp = place(0, N('Cross Porter'), 'mzone');
    place(0, N('Neo-Spacian Grand Mole'), 'hand');
    place(0, N('Neo-Spacian Grand Mole'), 'deck');
    c0.pick = (_g, req) => (req.candidates.includes(cp) ? [cp] : req.candidates.slice(0, Math.max(1, req.min)));
    let asked = false;
    c0.trigger = () => {
      asked = true;
      return true;
    };
    await activate(g, 0, cp);
    eq(cp.location, 'grave', 'sent itself');
    eq(asked, false, 'search not offered');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
