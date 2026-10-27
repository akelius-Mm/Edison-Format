// Sourced rulings regression tests, group p2-5 (Snatch Steal .. Zombie Mammoth): each test pins a behaviour to the 2010
// TCG text / rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/sourced-p2-5.ts
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
  l3: findCard('Sourced Level 3') ?? normal('Sourced Level 3', 'EARTH', 'Warrior', 3, 1000, 1000),
  lamb: findCard('Sourced Lamb') ?? normal('Sourced Lamb', 'EARTH', 'Beast', 1, 100, 100),
  insect: findCard('Sourced Insect') ?? normal('Sourced Insect', 'EARTH', 'Insect', 4, 1000, 1000),
  psy: findCard('Sourced Psychic') ?? normal('Sourced Psychic', 'EARTH', 'Psychic', 3, 1000, 1000),
  neos: findCard('Elemental Hero Neos') ?? normal('Elemental Hero Neos', 'LIGHT', 'Warrior', 7, 2500, 2000),
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
  option: (req: { prompt: string; options: string[] }) => number = () => 0;
  yes: (req: { prompt: string }) => boolean = () => true;
  async chooseOption(_g: Game, _p: PlayerId, req: { prompt: string; options: string[] }) {
    return this.option(req);
  }
  async confirm(_g: Game, _p: PlayerId, req: { prompt: string }) {
    return this.yes(req);
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


/** Opponent's response hook that only inspects the chain (needs a Set Book of Moon to get a window). */
function watchChain(c: TestController, fn: (g: Game) => void) {
  c.respond = (gg) => {
    fn(gg);
    return null;
  };
}
const topLink = (g: Game) => g.chain[g.chain.length - 1];

(async () => {
  console.log('Sourced rulings tests: group p2-5');

  // https://edisonrul.ing/cards/s/spell-gear.html
  await test('Spell Gear: cannot be activated without an "Ancient Gear Golem" in the Deck', async () => {
    const { g, place } = setup();
    place(0, N('Ancient Gear Castle'), 'fzone');
    place(0, N('Ancient Gear Golem'), 'mzone');
    place(0, N('Ancient Gear Golem'), 'mzone');
    place(0, N('Ancient Gear Golem'), 'hand');
    const sg = place(0, N('Spell Gear'), 'hand');
    eq(canActivate(g, 0, sg), false, 'no Golem in the Deck');
    place(0, N('Ancient Gear Golem'), 'deck');
    eq(canActivate(g, 0, sg), true, 'Golem in the Deck');
  });

  // https://edisonrul.ing/cards/s/spellbinding-circle.html
  await test('Spellbinding Circle: stops the attacking monster; a face-down target cannot be Flip Summoned', async () => {
    const a = setup();
    a.g.turnPlayer = 1;
    a.g.phase = 'battle';
    const att = a.place(1, T.brute, 'mzone');
    a.place(0, N('Spellbinding Circle'), 'szone', { faceUp: false });
    a.c0.respond = respondWith('Spellbinding Circle');
    await a.g.conductAttack(1, att);
    eq(a.g.players[0].lp, 8000, 'the direct attack stopped');

    const b = setup();
    const fd = b.place(1, T.brute, 'mzone', { faceUp: false, pos: 'def' });
    const sc = b.place(0, N('Spellbinding Circle'), 'szone', { faceUp: false });
    await activate(b.g, 0, sc);
    eq(sc.flags.bindUid, fd.uid, 'face-down monster bound');
    b.g.turnPlayer = 1;
    b.g.turn = 3;
    eq(b.g.legalMainActions(1).some((x) => x.type === 'flip' && x.card === fd), false, 'no Flip Summon');
  });

  // https://edisonrul.ing/cards/s/spider-egg.html
  await test('Spider Egg: needs 3 free Monster Card Zones to be activated', async () => {
    const run = async (mine: number) => {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      g.phase = 'battle';
      for (let i = 0; i < 3; i++) place(0, T.insect, 'grave');
      for (let i = 0; i < mine; i++) place(0, T.wall, 'mzone', { pos: 'def' });
      place(0, N('Spider Egg'), 'szone', { faceUp: false });
      let offered = false;
      c0.respond = (gg, req) => {
        if (offers(req, 'Spider Egg')) offered = true;
        return respondWith('Spider Egg')(gg, req);
      };
      // a direct attack is only possible with no monsters: declare it by hand when the zones are occupied
      const att = place(1, T.brute, 'mzone');
      if (mine === 0) await g.conductAttack(1, att);
      else {
        (g as any).battle = { attacker: att, target: null, attackerMoveId: att.moveId, targetMoveId: -1, negated: false, inDamageStep: false, oppMonsterCount: mine };
        g.emit({ type: 'attackDeclared', card: att, player: 1 });
        await g.processTriggers(true);
        await (g as any).responseLoop('attack', 0);
        (g as any).battle = null;
      }
      return { offered, g };
    };
    const full = await run(3);
    eq(full.offered, false, 'only 2 free zones: cannot be activated');
    const ok = await run(0);
    eq(ok.offered, true, '5 free zones: can be activated');
    eq(ok.g.monsters(0).filter((c) => c.name === 'Spider Token').length, 3, '3 Spider Tokens');
  });

  // https://edisonrul.ing/cards/s/spider-web.html, https://edisonrul.ing/cards/s/spiders-lair.html
  await test("Spider Web / Spiders' Lair: a locked monster flipped face-down is no longer locked (can be Flip Summoned)", async () => {
    const { g, place } = setup();
    place(0, N('Spider Web'), 'fzone');
    const m = place(1, T.brute, 'mzone', { pos: 'def' });
    m.flags.sovrSpiderWebUntil = 99;
    eq(g.queryCard(m, 'cannotChangePos'), true, 'locked while face-up');
    await g.changePosition(m, 'def', false);
    eq(g.queryCard(m, 'cannotChangePos'), false, 'not locked once face-down');
    g.turnPlayer = 1;
    g.turn = 3;
    eq(g.legalMainActions(1).some((x) => x.type === 'flip' && x.card === m), true, 'Flip Summon allowed');

    const s = setup();
    const lair = s.place(0, N("Spiders' Lair"), 'szone', { faceUp: true });
    const v = s.place(1, T.brute, 'mzone', { pos: 'def' });
    lair.flags.lairLocked = [{ uid: v.uid, moveId: v.moveId }];
    eq(s.g.queryCard(v, 'cannotChangePos'), true, "locked by Spiders' Lair");
    await s.g.changePosition(v, 'def', false);
    eq(s.g.queryCard(v, 'cannotChangePos'), false, 'not locked once face-down');
  });

  // https://edisonrul.ing/cards/s/star-blast.html
  await test('Star Blast: the monster is chosen on resolution; the LP paid is capped by the highest Level', async () => {
    const { g, c0, c1, place } = setup();
    const first = place(0, N('Tytannial, Princess of Camellias'), 'hand');
    const eight = place(0, N('Tytannial, Princess of Camellias'), 'hand');
    const three = place(0, T.l3, 'hand');
    const sb = place(0, N('Star Blast'), 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    place(1, T.brute, 'mzone'); // a Book of Moon target, so the opponent gets a response window
    let opts: string[] = [];
    c0.option = (req) => {
      opts = req.options;
      return 3; // pay 2000 LP (-4 Levels)
    };
    // in response, the first Level 8 monster leaves the hand: the choice is only made on resolution
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card === sb && first.location === 'hand') gg.rawMove(first, 'grave');
    });
    await activate(g, 0, sb);
    eq(opts.length, 7, 'up to 3500 LP for a Level 8 monster');
    eq(g.players[0].lp, 6000, '2000 LP paid');
    eq(g.getLevel(eight), 4, 'the other Level 8 monster (the only legal choice on resolution) is now Level 4');
    eq(g.getLevel(three), 3, 'the Level 3 monster cannot take -4');
  });

  // https://edisonrul.ing/cards/s/storm-caller.html
  await test("Storm Caller: your own monster controlled by the opponent is not put on top of your Deck", async () => {
    const { g, place } = setup();
    place(0, N('Storm Caller'), 'mzone');
    const psy = place(0, N('Magical Android'), 'mzone');
    const mine = place(0, T.brute, 'mzone');
    await g.takeControl(mine, 1);
    eq(mine.controller, 1, 'opponent controls it');
    await g.conductAttack(0, psy);
    eq(mine.location, 'grave', 'sent to the GY, not the Deck');
  });

  // https://edisonrul.ing/cards/s/summon-limit.html
  await test('Summon Limit: 4 Tokens Summoned at once are 1 Summon; a negated Summon still counts', async () => {
    const { g, c1, place } = setup();
    place(0, N('Summon Limit'), 'szone', { faceUp: true });
    await g.createTokens(0, T.lamb, 4, 'def');
    eq(g.monsters(0).length, 4, 'all 4 monsters Summoned');
    const b = place(0, T.brute, 'hand');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await g.normalSummon(0, b, false);
    eq(b.location, 'grave', 'the Normal Summon was negated');
    const r = place(0, T.wall, 'grave');
    const out = await g.specialSummon([r], 0, { pos: 'def' });
    eq(out.length, 0, 'third Summon of the turn is not allowed');
  });

  // https://edisonrul.ing/cards/s/sun-dragon-inti.html
  await test('Sun Dragon Inti: revives "Moon Dragon Quilla" even when Inti is no longer in the GY', async () => {
    const { g, place } = setup();
    const inti = place(0, N('Sun Dragon Inti'), 'mzone');
    const quilla = place(0, N('Moon Dragon Quilla'), 'grave');
    quilla.properlySummoned = true; // a Synchro Monster that was Synchro Summoned
    await g.destroy([inti], 'effect', 1);
    await g.processTriggers(true);
    eq(inti.location, 'grave', 'Inti destroyed');
    await g.moveCards([inti], 'banished', { reason: 'effect', reasonPlayer: 1 });
    g.turn = 3;
    g.turnPlayer = 1;
    await (g as any).setPhase('standby');
    eq(quilla.location, 'mzone', 'Quilla Special Summoned');
  });

  // https://edisonrul.ing/cards/s/super-double-summon.html
  await test('Super Double Summon: a Gemini flipped face-down (and up again) is not returned in the End Phase', async () => {
    const { g, place } = setup();
    const elf = place(0, N('Infinity Dark'), 'mzone');
    const sds = place(0, N('Super Double Summon'), 'hand');
    await activate(g, 0, sds);
    eq(!!elf.flags.geminiSummoned, true, 'Gemini status');
    await g.changePosition(elf, 'def', false);
    await g.changePosition(elf, 'atk', true);
    await (g as any).setPhase('end');
    eq(elf.location, 'mzone', 'not returned to the hand');
  });

  // https://edisonrul.ing/cards/s/super-vehicroid-stealth-union.html
  await test('Super Vehicroid - Stealth Union: original ATK halved from the attack declaration', async () => {
    const { g, c1, place } = setup();
    const su = place(0, N('Super Vehicroid - Stealth Union'), 'mzone');
    place(1, T.wall, 'mzone', { pos: 'def' });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let atk = -1;
    watchChain(c1, (gg) => {
      if (atk < 0 && gg.battle && !gg.battle.inDamageStep) atk = gg.getAtk(su);
    });
    await g.conductAttack(0, su);
    eq(atk, 1800, 'halved in the Battle Step');
  });

  // https://edisonrul.ing/cards/s/supremacy-berry.html
  await test('Supremacy Berry: cannot be activated while both players have the same LP', async () => {
    const { g, place } = setup();
    const sb = place(0, N('Supremacy Berry'), 'hand');
    eq(canActivate(g, 0, sb), false, 'equal LP');
    g.players[0].lp = 7000;
    eq(canActivate(g, 0, sb), true, 'lower LP');
  });

  // https://edisonrul.ing/cards/s/supernatural-regeneration.html
  await test('Supernatural Regeneration: cannot be activated if no Psychic-Type monster went to the GY this turn', async () => {
    const { g, place } = setup();
    g.phase = 'end';
    const sr = place(0, N('Supernatural Regeneration'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, sr), false, 'no Psychic sent');
    const k = place(0, N('Krebons'), 'mzone');
    await g.sendToGrave([k], 'effect', 0);
    eq(canActivate(g, 0, sr), true, 'a Psychic was sent');
  });

  // https://edisonrul.ing/cards/s/swing-of-memories.html
  await test('Swing of Memories: a monster flipped face-down (and up again) is not destroyed in the End Phase', async () => {
    const { g, place } = setup();
    const n = place(0, T.brute, 'grave');
    const sw = place(0, N('Swing of Memories'), 'hand');
    await activate(g, 0, sw);
    eq(n.location, 'mzone', 'Special Summoned');
    await g.changePosition(n, 'def', false);
    await g.changePosition(n, 'atk', true);
    await (g as any).setPhase('end');
    eq(n.location, 'mzone', 'not destroyed');
  });

  // https://edisonrul.ing/cards/s/sword-master.html
  await test('Sword Master: Special Summoned when the attacked monster was destroyed by a card effect instead of by battle', async () => {
    const { g, place } = setup();
    const war = place(0, T.brute, 'mzone');
    const t = place(1, T.wall, 'mzone', { pos: 'def' });
    const sm = place(0, N('Sword Master'), 'hand');
    (g as any).battle = { attacker: war, target: t, attackerMoveId: war.moveId, targetMoveId: t.moveId, negated: false, inDamageStep: true, oppMonsterCount: 1 };
    await g.destroy([t], 'effect', 0);
    g.emit({ type: 'damageStepEnd', card: war, other: t, player: 0 });
    await g.processTriggers(true);
    (g as any).battle = null;
    eq(sm.location, 'mzone', 'Sword Master Special Summoned');
  });

  // https://edisonrul.ing/cards/s/sword-of-kusanagi.html
  await test("Sword of Kusanagi: no return to the hand when it is the opponent's card (taken with Exchange)", async () => {
    const run = async (owner: PlayerId) => {
      const { g, place } = setup();
      const tsu = place(0, N('Tsukuyomi'), 'mzone');
      const kus = place(owner, N('Sword of Kusanagi'), 'hand');
      g.rawMove(kus, 'szone', { controller: 0, faceUp: true });
      kus.activeOnField = true;
      g.equip(kus, tsu);
      await g.toHand([tsu], 'effect', 1);
      await g.ruleCleanup();
      await g.processTriggers(true);
      return kus.location;
    };
    eq(await run(0), 'hand', 'your own Kusanagi returns to the hand');
    eq(await run(1), 'grave', "the opponent's Kusanagi does not");
  });

  // https://edisonrul.ing/cards/s/synchro-deflector.html
  await test("Synchro Deflector: targets the opponent's monster it destroys when activated", async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    place(0, N('Magical Android'), 'mzone');
    const att = place(1, T.big, 'mzone');
    const other = place(1, T.wall, 'mzone');
    place(0, N('Synchro Deflector'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c0.respond = respondWith('Synchro Deflector');
    c0.pick = (_g, req) => (req.candidates.includes(other) ? [other] : req.candidates.slice(0, req.min));
    let targeted = false;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card.name === 'Synchro Deflector' && l.ctx.targets.includes(other)) targeted = true;
    });
    await g.conductAttack(1, att);
    eq(targeted, true, 'target chosen at activation');
    eq(other.location, 'grave', 'the target is destroyed');
    eq(g.players[0].lp, 8000, 'attack negated');
  });

  // https://edisonrul.ing/cards/t/tadpole.html
  await test('T.A.D.P.O.L.E.: once activated, at least 1 copy is added', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const tad = place(0, N('T.A.D.P.O.L.E.'), 'mzone');
    place(0, N('T.A.D.P.O.L.E.'), 'deck');
    place(0, N('T.A.D.P.O.L.E.'), 'deck');
    const att = place(1, T.brute, 'mzone');
    await g.conductAttack(1, att);
    eq(tad.location, 'grave', 'destroyed by battle');
    eq(g.players[0].hand.filter((c) => c.name === 'T.A.D.P.O.L.E.').length, 1, '1 added (minimum)');
  });

  // https://edisonrul.ing/cards/s/synchro-strike.html
  await test('Synchro Strike: not a Synchro Monster turned face-down and flipped face-up again', async () => {
    const { g, place } = setup();
    const an = place(0, N('Magical Android'), 'mzone');
    an.summonMethod = 'synchro';
    const ss = place(0, N('Synchro Strike'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, ss), true, 'Synchro Summoned monster');
    await g.changePosition(an, 'def', false);
    await g.changePosition(an, 'atk', true);
    eq(canActivate(g, 0, ss), false, 'flipped face-up again: not a legal target');
  });

  // https://edisonrul.ing/cards/t/telekinetic-power-well.html
  await test('Telekinetic Power Well: targets on activation; a target removed in response is not Summoned or counted', async () => {
    const { g, c0, c1, place } = setup();
    const k1 = place(0, N('Krebons'), 'grave');
    const k2 = place(0, N('Krebons'), 'grave');
    const tpw = place(0, N('Telekinetic Power Well'), 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    place(1, T.brute, 'mzone'); // a Book of Moon target, so the opponent gets a response window
    c0.pick = (_g, req) => (req.purpose === 'specialSummon' ? req.candidates : req.candidates.slice(0, req.min));
    let n = 0;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card === tpw && !n) {
        n = l.ctx.targets.length;
        gg.rawMove(k1, 'banished', { faceUp: true });
      }
    });
    await activate(g, 0, tpw);
    eq(n, 2, 'both targeted');
    eq(k2.location, 'mzone', 'the other target is Summoned');
    eq(g.players[0].lp, 8000 - 600, 'damage for 1 Level 2 monster');
  });

  // https://edisonrul.ing/cards/t/tethys-goddess-of-light.html
  await test('Tethys, Goddess of Light: can be activated in the Damage Step', async () => {
    const { g, place } = setup();
    place(0, N('Tethys, Goddess of Light'), 'mzone');
    const f = place(0, T.lightWall, 'hand');
    const before = g.players[0].hand.length;
    (g as any).battle = { attacker: f, target: null, attackerMoveId: -1, targetMoveId: -1, negated: false, inDamageStep: true, oppMonsterCount: 0 };
    g.emit({ type: 'drawn', card: f, player: 0 });
    await g.processTriggers(true);
    (g as any).battle = null;
    eq(g.players[0].hand.length, before + 1, 'drew 1 more card');
  });

  // https://edisonrul.ing/cards/t/thorn-of-malice.html
  await test("Thorn of Malice: your Thorn on the opponent's monster does not protect your monsters battling it", async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const host = place(1, N('Lonefire Blossom'), 'mzone');
    const thorn = place(0, N('Thorn of Malice'), 'szone', { faceUp: true });
    g.equip(thorn, host);
    eq(g.getAtk(host), 1100, '500 + 600');
    const mine = place(0, T.l3, 'mzone');
    g.addTempMod(mine, 'atk', 100, 'turn');
    await g.conductAttack(1, host);
    eq(mine.location, 'grave', 'your 1100 ATK monster is destroyed');
  });

  // https://edisonrul.ing/cards/t/tiger-dragon.html
  await test('Tiger Dragon: a targeted Set card that was chained (now face-up) is not destroyed', async () => {
    const { g, c1, place } = setup();
    place(0, N('Moon Dragon Quilla'), 'mzone');
    const tiger = place(0, N('Tiger Dragon'), 'hand');
    const sc = place(1, N('Spellbinding Circle'), 'szone', { faceUp: false });
    const other = place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = (gg, req) => (gg.chain.some((l) => l.card === tiger) ? respondWith('Spellbinding Circle')(gg, req) : null);
    const c0 = (g.controllers[0] as TestController);
    c0.pick = (_g, req) => (req.candidates.includes(sc) ? req.candidates.filter((c) => c === sc || c === other) : req.candidates.slice(0, req.min));
    await g.normalSummon(0, tiger, false);
    eq(sc.faceUp, true, 'Spellbinding Circle was chained');
    eq(tiger.location, 'mzone', 'Tribute Summoned');
    eq(sc.location, 'szone', 'the chained (face-up) card stays');
    eq(other.location, 'grave', 'the other target is destroyed');
  });

  // https://edisonrul.ing/cards/t/time-machine.html
  await test('Time Machine: cannot be activated when both battling monsters are destroyed', async () => {
    const { g, c0, place } = setup();
    const a = place(0, T.brute, 'mzone');
    place(1, T.brute, 'mzone');
    place(0, N('Time Machine'), 'szone', { faceUp: false });
    let offered = false;
    c0.respond = (_g, req) => {
      if (offers(req, 'Time Machine')) offered = true;
      return null;
    };
    await g.conductAttack(0, a);
    eq(a.location, 'grave', 'both destroyed');
    eq(offered, false, 'Time Machine not offered');
  });

  // https://edisonrul.ing/cards/t/totem-dragon.html
  await test('Totem Dragon: no once-per-turn on its Graveyard effect (2010 text)', async () => {
    const ef = N('Totem Dragon').effects!.find((e) => e.label === 'Revive')!;
    eq(ef.opt, undefined, 'no once-per-turn');
  });

  // https://edisonrul.ing/cards/t/tribe-infecting-virus.html
  await test('Tribe-Infecting Virus: only a Type that is face-up on the field can be declared', async () => {
    const { g, c0, place } = setup();
    const tiv = place(0, N('Tribe-Infecting Virus'), 'mzone');
    place(1, T.brute, 'mzone');
    place(0, T.wall, 'hand');
    let opts: string[] = [];
    c0.option = (req) => {
      opts = req.options;
      return req.options.indexOf('Warrior');
    };
    await activate(g, 0, tiv);
    eq(opts.includes('Dragon'), false, 'Dragon is not on the field');
    eq(opts.includes('Warrior') && opts.includes('Aqua'), true, 'Warrior and Aqua are');
    eq(g.monsters(1).length, 0, 'Warrior destroyed');
  });

  // https://edisonrul.ing/cards/t/tuner-capture.html
  await test("Tuner Capture: targets the Tuner in the opponent's GY on activation", async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1;
    const k = place(1, N('Krebons'), 'mzone');
    const l3 = place(1, T.l3, 'mzone');
    const an = place(1, N('Magical Android'), 'extra');
    place(0, N('Tuner Capture'), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c0.respond = respondWith('Tuner Capture');
    let targeted = false;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card.name === 'Tuner Capture' && l.ctx.targets.includes(k)) targeted = true;
    });
    await g.synchroSummon(1, an, [k, l3]);
    eq(an.location, 'mzone', 'Synchro Summoned');
    eq(targeted, true, 'Krebons targeted on activation');
    eq(k.location === 'mzone' && k.controller === 0, true, 'Krebons Special Summoned to your field');
  });

  // https://edisonrul.ing/cards/t/turbo-cannon.html
  await test('Turbo Cannon: targets; no effect if the target is flipped face-down in response', async () => {
    const { g, c0, c1, place } = setup();
    const tc = place(0, N('Turbo Cannon'), 'mzone');
    const t = place(1, T.brute, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(t) ? [t] : req.candidates.slice(0, req.min));
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card === tc && l.ctx.targets.includes(t)) {
        targeted = true;
        t.faceUp = false;
        t.pos = 'def';
      }
    });
    await activate(g, 0, tc);
    eq(targeted, true, 'targeted on activation');
    eq(t.location, 'mzone', 'not destroyed');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/t/twin-shield-defender.html
  await test("Twin-Shield Defender: targets the opponent's face-up monster", async () => {
    const { g, c1, place } = setup();
    g.turnPlayer = 1;
    place(0, N('Twin-Shield Defender'), 'mzone');
    const att = place(1, T.brute, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card.name === 'Twin-Shield Defender' && l.ctx.targets.includes(att)) targeted = true;
    });
    await g.conductAttack(1, att);
    eq(targeted, true, 'targeted on activation');
    eq(g.getAtk(att), 900, 'ATK halved');
  });

  // https://edisonrul.ing/cards/u/unleash-your-power.html
  await test('Unleash Your Power!: a Gemini already treated as an Effect Monster is not Set in the End Phase', async () => {
    const { g, place } = setup();
    const done = place(0, N('Infinity Dark'), 'mzone');
    done.flags.geminiSummoned = true;
    const fresh = place(0, N('Infinity Dark'), 'mzone');
    const u = place(0, N('Unleash Your Power!'), 'hand');
    await activate(g, 0, u);
    await (g as any).setPhase('end');
    eq(done.faceUp, true, 'already-Gemini-Summoned monster stays face-up');
    eq(fresh.faceUp, false, 'the other one is Set');
  });

  // https://edisonrul.ing/cards/u/urgent-tuning.html
  await test("Urgent Tuning: its Synchro Summon cannot be negated by Solemn Judgment", async () => {
    const { g, c1, place } = setup();
    g.phase = 'battle';
    place(0, N('Krebons'), 'mzone');
    place(0, T.psy, 'mzone');
    const an = place(0, N('Magical Android'), 'extra');
    const ut = place(0, N('Urgent Tuning'), 'szone', { faceUp: false });
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    let window = false;
    c1.respond = (gg, req) => {
      if (req.kind !== 'summonNegation') return null;
      window = true;
      return respondWith('Solemn Judgment')(gg, req);
    };
    await activate(g, 0, ut);
    eq(window, false, 'no summon-negation window');
    eq(an.location, 'mzone', 'Synchro Summoned');
  });

  // https://edisonrul.ing/cards/v/veil-of-darkness.html
  await test('Veil of Darkness: the DARK monster goes to the GY on resolution; drawing is optional', async () => {
    const { g, c0, place } = setup();
    g.phase = 'draw';
    place(0, N('Veil of Darkness'), 'szone', { faceUp: true });
    const d = place(0, T.dark, 'hand');
    c0.yes = () => false;
    const before = g.players[0].hand.length;
    g.emit({ type: 'drawn', card: d, player: 0 });
    await g.processTriggers(true);
    eq(d.location, 'grave', 'sent to the GY');
    eq(g.players[0].hand.length, before - 1, 'chose not to draw');
  });

  // https://edisonrul.ing/cards/v/verdant-sanctuary.html
  await test('Verdant Sanctuary: not for a face-down Insect attacked and destroyed by battle', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    place(0, N('Verdant Sanctuary'), 'szone', { faceUp: true });
    const ins = place(0, T.insect, 'mzone', { faceUp: false, pos: 'def' });
    (g.controllers[0] as TestController).pick = (_g, req) => req.candidates.slice(0, Math.max(1, req.min));
    const deckIns = place(0, T.insect, 'deck');
    const att = place(1, T.big, 'mzone');
    await g.conductAttack(1, att);
    eq(ins.location, 'grave', 'destroyed by battle');
    eq(deckIns.location, 'deck', 'no search');
    // control: a face-up Insect destroyed by battle does give the search
    const s2 = setup();
    s2.g.turnPlayer = 1;
    s2.place(0, N('Verdant Sanctuary'), 'szone', { faceUp: true });
    s2.place(0, T.insect, 'mzone', { pos: 'def' });
    const deckIns2 = s2.place(0, T.insect, 'deck');
    s2.c0.pick = (_g, req) => req.candidates.slice(0, Math.max(1, req.min));
    await s2.g.conductAttack(1, s2.place(1, T.big, 'mzone'));
    eq(deckIns2.location, 'hand', 'face-up Insect: search');
  });

  // https://edisonrul.ing/cards/v/vicious-claw.html
  await test('Vicious Claw: no damage when no monster is destroyed', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    const mine = place(0, T.brute, 'mzone');
    const claw = place(0, N('Vicious Claw'), 'szone', { faceUp: true });
    g.equip(claw, mine);
    g.addTempMod(mine, 'indestructibleEffect', true, 'turn');
    const att = place(1, T.big, 'mzone');
    await g.conductAttack(1, att);
    eq(claw.location, 'hand', 'returned to the hand');
    eq(mine.location, 'mzone', 'the only other monster is not destroyed');
    eq(g.players[1].lp, 8000, 'no 600 damage');
  });

  // https://edisonrul.ing/cards/v/viser-des.html
  await test('Viser Des: the target is not destroyed if Viser Des left the field first', async () => {
    const { g, place } = setup();
    const vd = place(0, N('Viser Des'), 'hand');
    const t = place(1, T.wall, 'mzone');
    await g.normalSummon(0, vd, false);
    eq(vd.flags.viser?.c, t, 'target marked');
    await g.toHand([vd], 'effect', 1);
    g.turn += 6;
    g.turnPlayer = 0;
    await (g as any).setPhase('standby');
    eq(t.location, 'mzone', 'not destroyed');
  });

  // https://edisonrul.ing/cards/w/wall-of-revealing-light.html
  await test('Wall of Revealing Light: activated after an attack declaration, it stops that attack', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const att = place(1, T.brute, 'mzone');
    place(0, N('Wall of Revealing Light'), 'szone', { faceUp: false });
    c0.respond = respondWith('Wall of Revealing Light');
    c0.option = () => 1; // 2000 LP
    await g.conductAttack(1, att);
    eq(g.players[0].lp, 6000, 'only the 2000 LP paid; no battle damage');
  });

  // https://edisonrul.ing/cards/w/white-night-dragon.html
  await test('White Night Dragon: its negation can be activated in the Damage Step', async () => {
    const ef = N('White Night Dragon').effects!.find((e) => e.label === 'Negate targeting Spell/Trap')!;
    eq(ef.damageStep, true, 'damageStep');
  });

  // https://edisonrul.ing/cards/w/witch-doctor-of-sparta.html
  // (already handled by the engine: a trigger activates once for monsters Summoned together)
  await test('Witch Doctor of Sparta: 2 monsters Special Summoned from the Deck together: 500 damage once', async () => {
    const { g, place } = setup();
    place(0, N('Witch Doctor of Sparta'), 'mzone');
    const a = place(1, T.brute, 'deck');
    const b = place(1, T.wall, 'deck');
    await g.specialSummon([a, b], 1, { pos: 'atk' });
    await g.processTriggers(true);
    eq(g.players[1].lp, 7500, '500 damage once');
  });

  // https://edisonrul.ing/cards/w/witch-of-the-black-forest.html
  await test('Witch of the Black Forest: no search when its Summon is negated', async () => {
    const { g, c1, place } = setup();
    const w = place(0, N('Witch of the Black Forest'), 'hand');
    const tgt = place(0, T.light, 'deck');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await g.normalSummon(0, w, false);
    await g.processTriggers(true);
    eq(w.location, 'grave', 'Summon negated');
    eq(tgt.location, 'deck', 'no search');
  });

  // https://edisonrul.ing/cards/w/wolf-in-sheeps-clothing.html
  await test("Wolf in Sheep's Clothing: with 1 free zone on resolution, Summon one; the other goes to the GY", async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const h = place(0, T.lamb, 'hand');
    const d = place(0, T.lamb, 'deck');
    for (let i = 0; i < 2; i++) place(0, T.wall, 'grave');
    const filler = [0, 1, 2, 3].map(() => place(0, T.wall, 'hand'));
    place(0, N("Wolf in Sheep's Clothing"), 'szone', { faceUp: false });
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    const att = place(1, T.brute, 'mzone');
    c0.respond = respondWith("Wolf in Sheep's Clothing");
    let filled = false;
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card.name === "Wolf in Sheep's Clothing" && !filled) {
        filled = true;
        for (const f of filler) gg.rawMove(f, 'mzone', { controller: 0, faceUp: true, pos: 'def' });
      }
    });
    await g.conductAttack(1, att);
    eq(filled, true, 'zones filled in response');
    eq([h, d].filter((c) => c.location === 'mzone').length, 1, '1 Special Summoned');
    eq([h, d].filter((c) => c.location === 'grave').length, 1, 'the other is sent to the GY');
  });

  // https://edisonrul.ing/cards/w/wrath-of-neos.html
  await test('Wrath of Neos: still resolves if the opponent took control of the targeted Neos', async () => {
    const { g, c1, place } = setup();
    const neos = place(0, T.neos, 'mzone');
    const opp = place(1, T.brute, 'mzone');
    const w = place(0, N('Wrath of Neos'), 'hand');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card === w && neos.controller === 0) void gg.takeControl(neos, 1);
    });
    await activate(g, 0, w);
    eq(neos.location, 'deck', 'Neos returned to the Deck');
    eq(opp.location, 'grave', 'all cards destroyed');
  });

  // https://edisonrul.ing/cards/y/yubel.html
  await test('Yubel: its effect activates when it is destroyed in the hand', async () => {
    const { g, place } = setup();
    const y = place(0, N('Yubel'), 'hand');
    const ti = place(0, N('Yubel - Terror Incarnate'), 'deck');
    // a card effect that destroys a card in the hand
    await g.moveCards([y], 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], reasonPlayer: 1, destroyed: true });
    await g.processTriggers(true);
    eq(ti.location, 'mzone', 'Terror Incarnate Special Summoned');
  });

  // https://edisonrul.ing/cards/y/yubel-terror-incarnate.html
  // (already handled by the engine: a card in the Deck does not activate its triggers)
  await test('Yubel - Terror Incarnate: no effect when returned to the Deck', async () => {
    const run = async (to: 'deck' | 'banished') => {
      const { g, place } = setup();
      const ti = place(0, N('Yubel - Terror Incarnate'), 'mzone');
      const un = place(0, N('Yubel - The Ultimate Nightmare'), 'hand');
      await g.moveCards([ti], to, { reason: 'effect', reasonPlayer: 1 });
      await g.processTriggers(true);
      return un.location;
    };
    eq(await run('banished'), 'mzone', 'banished: The Ultimate Nightmare Special Summoned');
    eq(await run('deck'), 'hand', 'returned to the Deck: no effect');
  });

  // https://edisonrul.ing/cards/z/zeta-reticulant.html
  await test('Zeta Reticulant: 1 Eva Token per removal, even if Zeta leaves the GY in response', async () => {
    const { g, c1, place } = setup();
    const zeta = place(0, N('Zeta Reticulant'), 'grave');
    const a = place(1, T.brute, 'mzone');
    const b = place(1, T.wall, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    place(0, T.wall, 'mzone'); // a Book of Moon target, so the opponent gets a response window
    watchChain(c1, (gg) => {
      const l = topLink(gg);
      if (l && l.card === zeta && zeta.location === 'grave') gg.rawMove(zeta, 'banished', { faceUp: true });
    });
    await g.moveCards([a, b], 'banished', { reason: 'effect', reasonPlayer: 0 });
    await g.processTriggers(true);
    eq(zeta.location, 'banished', 'Zeta removed in response');
    eq(g.monsters(0).filter((c) => c.name === 'Eva Token').length, 1, 'exactly 1 Eva Token');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
