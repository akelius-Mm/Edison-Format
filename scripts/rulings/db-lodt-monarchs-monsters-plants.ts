// Rulings database audit, group 5 (LODT, Monarchs/Frogs, generic monsters, Plants): one regression test per fix.
// Source for every test: the edisonrul.ing card page named above it (historical 2010 TCG section).
// Usage: npx tsx scripts/rulings/db-lodt-monarchs-monsters-plants.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal, spell } from '../../src/cards/define';
import type { CardInstance } from '../../src/engine/card';
import { Ctx } from '../../src/engine/ctx';
import type { ChainLink, Game } from '../../src/engine/game';
import type { GameEvent } from '../../src/engine/types';
import { activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const N = (n: string) => cardByName(n);
const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  water: findCard('Audit5 Water') ?? normal('Audit5 Water', 'WATER', 'Aqua', 4, 1000, 1000),
  plant: findCard('Audit5 Plant') ?? normal('Audit5 Plant', 'EARTH', 'Plant', 4, 1600, 1000),
  bat1: findCard('Batteryman Audit5 One') ?? normal('Batteryman Audit5 One', 'LIGHT', 'Thunder', 3, 1000, 1000),
  bat2: findCard('Batteryman Audit5 Two') ?? normal('Batteryman Audit5 Two', 'LIGHT', 'Thunder', 3, 1000, 1000),
  beast: findCard('Audit5 Beast') ?? normal('Audit5 Beast', 'EARTH', 'Beast', 3, 1000, 1000),
  neo: findCard('Neo-Spacian Audit5') ?? normal('Neo-Spacian Audit5', 'LIGHT', 'Warrior', 3, 900, 900),
  // Effect damage that is the last thing to happen, and effect damage followed by a draw (Gorz can miss the timing).
  burnLast:
    findCard('Audit5 Burn Last') ??
    spell('Audit5 Burn Last', 'normal', {
      text: 'Inflict 500 damage to your opponent.',
      effects: [{ kind: 'activate', categories: ['damage'], resolve: async (ctx) => void (await ctx.damage(ctx.opp, 500)) }],
    }),
  burnThenDraw:
    findCard('Audit5 Burn Then Draw') ??
    spell('Audit5 Burn Then Draw', 'normal', {
      text: 'Inflict 500 damage to your opponent, then draw 1 card.',
      effects: [
        {
          kind: 'activate',
          categories: ['damage', 'draw'],
          resolve: async (ctx) => {
            await ctx.damage(ctx.opp, 500);
            await ctx.draw(1);
          },
        },
      ],
    }),
};

const setup = () => newGame(T.wall);
/** Chain links activated for `card` (from the event log). */
const linksOf = (g: Game, card: CardInstance): ChainLink[] =>
  g.eventLog.filter((e: GameEvent) => e.type === 'chainActivated' && (e.data?.link as ChainLink | undefined)?.card === card).map((e) => e.data.link as ChainLink);
/** Run `fn` once, just before the next Chain starts to resolve. */
function beforeResolve(g: Game, fn: () => void | Promise<void>) {
  const anyG = g as any;
  const orig = anyG.resolveChain.bind(g);
  let done = false;
  anyG.resolveChain = async (...a: any[]) => {
    if (!done) {
      done = true;
      await fn();
    }
    return orig(...a);
  };
}
const pickOnly = (c: { pick: any }, want: CardInstance[]) => {
  c.pick = (_g: Game, req: { candidates: CardInstance[]; min: number; max: number }) => {
    const w = req.candidates.filter((x) => want.includes(x));
    return w.length ? w.slice(0, Math.max(req.min, 1)) : req.candidates.slice(0, req.min);
  };
};

(async () => {
  console.log('Rulings tests: database audit, group 5');

  // https://edisonrul.ing/cards/d/doomcaliber-knight.html
  await test('Doomcaliber Knight: mandatory — it Tributes itself to negate and destroy a monster effect, unasked', async () => {
    const { g, c0, c1, place } = setup();
    const doom = place(1, N('Doomcaliber Knight'), 'mzone');
    const snipe = place(0, N('Snipe Hunter'), 'mzone');
    place(0, T.wall, 'hand');
    const victim = place(1, T.brute, 'mzone');
    pickOnly(c0, [victim]);
    c1.trigger = () => false; // declining would not matter: it is mandatory
    await activate(g, 0, snipe);
    eq(doom.location, 'grave', 'Doomcaliber Knight Tributed');
    eq(snipe.location, 'grave', 'the monster whose effect was negated is destroyed');
    eq(victim.location, 'mzone', 'the negated effect did not resolve');
  });

  // https://edisonrul.ing/cards/d/doomcaliber-knight.html
  await test('Doomcaliber Knight: with 2 face-up, both are Tributed; only the one chained to the monster effect negates', async () => {
    const { g, c0, place } = setup();
    const d1 = place(1, N('Doomcaliber Knight'), 'mzone');
    const d2 = place(1, N('Doomcaliber Knight'), 'mzone');
    const snipe = place(0, N('Snipe Hunter'), 'mzone');
    place(0, T.wall, 'hand');
    const victim = place(1, T.brute, 'mzone');
    pickOnly(c0, [victim]);
    await activate(g, 0, snipe);
    eq(d1.location, 'grave', 'first Knight Tributed');
    eq(d2.location, 'grave', 'second Knight Tributed');
    eq(snipe.location, 'grave', 'monster effect negated, monster destroyed');
    const negators = [...linksOf(g, d1), ...linksOf(g, d2)];
    eq(negators.length, 2, 'two Doomcaliber Chain Links');
    const target = (l: ChainLink) => l.ctx.data.link as ChainLink;
    eq(negators.filter((l) => target(l).card === snipe).length, 1, 'only one is chained directly to Snipe Hunter');
  });

  // https://edisonrul.ing/cards/n/neo-spacian-grand-mole.html
  await test('Neo-Spacian Grand Mole: activates at the start of the Damage Step, so a Set Flip monster is returned without flipping', async () => {
    const { g, c0, c1, place } = setup();
    const mole = place(0, N('Neo-Spacian Grand Mole'), 'mzone');
    const mine = place(0, T.brute, 'mzone');
    const na = place(1, N('Night Assailant'), 'mzone', { faceUp: false, pos: 'def' });
    c0.aim = na;
    pickOnly(c1, [mine]);
    let flipped = false;
    const origEmit = g.emit.bind(g);
    g.emit = (ev) => {
      if (ev.type === 'flipped' && ev.card === na) flipped = true;
      return origEmit(ev);
    };
    await g.conductAttack(0, mole);
    eq(c0.triggersAsked.includes('Neo-Spacian Grand Mole'), true, 'Grand Mole trigger offered');
    eq(mole.location, 'hand', 'Grand Mole returned');
    eq(na.location, 'hand', 'the Set monster returned');
    eq(flipped, false, 'the Set monster was never flipped face-up');
    eq(mine.location, 'mzone', 'no Flip Effect');
  });

  // https://edisonrul.ing/cards/m/marshmallon.html
  await test('Marshmallon: the 1000 damage activates after damage calculation (Substep 5), not at the end of the Damage Step', async () => {
    const { g, place } = setup();
    const att = place(0, T.brute, 'mzone');
    const mm = place(1, N('Marshmallon'), 'mzone', { faceUp: false, pos: 'def' });
    await g.conductAttack(0, att);
    const ls = linksOf(g, mm);
    eq(ls.length, 1, 'Marshmallon activated once');
    eq(ls[0].ctx.event?.type, 'damageCalculated', 'activated in Substep 5');
    eq(g.players[0].lp, 7000, 'attacking player took 1000');
    eq(mm.location, 'mzone', 'not destroyed by battle');
  });

  // https://edisonrul.ing/cards/t/thestalos-the-firestorm-monarch.html
  await test('Thestalos the Firestorm Monarch: no damage if the discarded monster is banished instead (Banisher)', async () => {
    const { g, c0, place } = setup();
    place(1, N('Banisher of the Radiance'), 'mzone');
    const fodder = place(0, T.brute, 'mzone');
    const th = place(0, N('Thestalos the Firestorm Monarch'), 'hand');
    const handMon = place(1, T.brute, 'hand');
    for (const c of g.zone(1, 'hand')) if (c !== handMon) g.rawMove(c, 'deck');
    pickOnly(c0, [fodder]);
    await g.performAction(0, { type: 'summon', card: th });
    eq(th.location, 'mzone', 'Tribute Summoned');
    eq(handMon.location, 'banished', 'the discarded monster was banished');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/g/granmarg-the-rock-monarch.html
  await test('Granmarg the Rock Monarch: a target flipped face-up in response is not destroyed', async () => {
    const { g, c0, place } = setup();
    const fodder = place(0, T.brute, 'mzone');
    const gm = place(0, N('Granmarg the Rock Monarch'), 'hand');
    const set = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    c0.pick = (_g, req) => (req.candidates.includes(fodder) ? [fodder] : req.candidates.includes(set) ? [set] : req.candidates.slice(0, req.min));
    beforeResolve(g, async () => {
      await g.changePosition(set, 'def', true);
    });
    await g.performAction(0, { type: 'summon', card: gm });
    eq(gm.location, 'mzone', 'Tribute Summoned');
    eq(set.location, 'mzone', 'flipped face-up target not destroyed');
  });

  // https://edisonrul.ing/cards/d/destruction-jammer.html
  await test('Destruction Jammer: cannot be chained to Snipe Hunter (it may or may not destroy)', async () => {
    const { g, c0, c1, place } = setup();
    const snipe = place(0, N('Snipe Hunter'), 'mzone');
    place(0, T.wall, 'hand');
    const victim = place(1, T.brute, 'mzone');
    const jam = place(1, N('Destruction Jammer'), 'szone', { faceUp: false });
    place(1, T.wall, 'hand');
    pickOnly(c0, [victim]);
    let offered = false;
    c1.respond = (_g, req) => {
      if (req.options.some((o) => o.card === jam)) offered = true;
      return null;
    };
    await activate(g, 0, snipe);
    eq(offered, false, 'Destruction Jammer not offered');
    eq(jam.location, 'szone', 'still Set');
  });

  // https://edisonrul.ing/cards/d/dupe-frog.html
  await test('Dupe Frog: with 2 face-up Dupe Frogs, neither can be attacked', async () => {
    const { g, place } = setup();
    const att = place(0, T.brute, 'mzone');
    place(1, N('Dupe Frog'), 'mzone', { pos: 'def' });
    place(1, N('Dupe Frog'), 'mzone', { pos: 'def' });
    eq(g.attackTargets(att).targets.length, 0, 'no attack targets');
    const one = setup();
    const att2 = one.place(0, T.brute, 'mzone');
    const df = one.place(1, N('Dupe Frog'), 'mzone', { pos: 'def' });
    one.place(1, T.wall, 'mzone');
    const ts = one.g.attackTargets(att2).targets;
    eq(ts.length === 1 && ts[0] === df, true, 'a single Dupe Frog is the only target');
  });

  // https://edisonrul.ing/cards/d/dupe-frog.html
  await test('Dupe Frog: cannot add "Frog the Jam"', async () => {
    const { g, place } = setup();
    const df = place(0, N('Dupe Frog'), 'mzone');
    for (const c of g.zone(0, 'deck')) g.rawMove(c, 'grave');
    place(0, N('Frog the Jam'), 'deck');
    await g.destroy([df], 'effect', 1);
    await g.processTriggers(true);
    eq(g.zone(0, 'hand').some((c) => c.name === 'Frog the Jam'), false, 'Frog the Jam not added');
  });

  // https://edisonrul.ing/cards/p/portable-battery-pack.html
  await test('Portable Battery Pack: a Batteryman flipped face-down stays; when the other leaves, the Pack is destroyed', async () => {
    const { g, place } = setup();
    const pbp = place(0, N('Portable Battery Pack'), 'szone', { faceUp: false });
    const b1 = place(0, T.bat1, 'grave');
    const b2 = place(0, T.bat2, 'grave');
    await activate(g, 0, pbp);
    eq(b1.location === 'mzone' && b2.location === 'mzone', true, 'both Special Summoned');
    await g.changePosition(b1, 'def', false);
    await g.processTriggers(true);
    await g.destroy([b2], 'effect', 1);
    await g.processTriggers(true);
    eq(pbp.location, 'grave', 'Portable Battery Pack destroyed');
    eq(b1.location, 'mzone', 'the face-down Batteryman remains on the field');
  });

  // https://edisonrul.ing/cards/l/limit-reverse.html
  await test('Limit Reverse: if the monster is flipped face-down, the effect disappears (neither is destroyed)', async () => {
    const { g, place } = setup();
    const lr = place(0, N('Limit Reverse'), 'szone', { faceUp: false });
    const low = place(0, N('Marshmallon'), 'grave');
    await activate(g, 0, lr);
    eq(low.location, 'mzone', 'Special Summoned');
    await g.changePosition(low, 'def', false);
    await g.processTriggers(true);
    eq(low.location, 'mzone', 'face-down monster not destroyed');
    eq(lr.location, 'szone', 'Limit Reverse not destroyed');
    await g.destroy([lr], 'effect', 1);
    await g.processTriggers(true);
    eq(low.location, 'mzone', 'no longer linked: the monster stays when Limit Reverse leaves');
  });

  // https://edisonrul.ing/cards/g/gorz-the-emissary-of-darkness.html
  await test('Gorz the Emissary of Darkness: "When... you can" — misses the timing if the damage was not the last thing to happen', async () => {
    const a = setup();
    for (const c of [...a.g.monsters(1)]) a.g.rawMove(c, 'grave');
    const gorz = a.place(1, N('Gorz the Emissary of Darkness'), 'hand');
    const burn = a.place(0, T.burnThenDraw, 'hand');
    await activate(a.g, 0, burn);
    eq(a.g.players[1].lp, 7500, 'damage dealt');
    eq(a.c1.triggersAsked.includes('Gorz the Emissary of Darkness'), false, 'Gorz missed the timing');
    eq(gorz.location, 'hand', 'Gorz still in hand');
    const b = setup();
    const gorz2 = b.place(1, N('Gorz the Emissary of Darkness'), 'hand');
    const burn2 = b.place(0, T.burnLast, 'hand');
    await activate(b.g, 0, burn2);
    eq(gorz2.location, 'mzone', 'Gorz Special Summoned when the damage is the last thing');
  });

  // https://edisonrul.ing/cards/b/big-shield-gardna.html
  await test('Big Shield Gardna: face-down, it negates a Spell that targets only it and turns face-up Defense Position', async () => {
    const { g, c0, place } = setup();
    const bsg = place(1, N('Big Shield Gardna'), 'mzone', { faceUp: false, pos: 'def' });
    const nob = place(0, N('Nobleman of Crossout'), 'hand');
    pickOnly(c0, [bsg]);
    await activate(g, 0, nob);
    eq(bsg.location, 'mzone', 'not destroyed');
    eq(bsg.faceUp, true, 'face-up');
    eq(bsg.pos, 'def', 'Defense Position');
    eq(nob.location, 'grave', 'Nobleman sent to the GY');
  });

  // https://edisonrul.ing/cards/c/cyber-valley.html
  await test('Cyber Valley: the attack-target effect activates and resolves under Skill Drain', async () => {
    const { g, c0, place } = setup();
    place(1, N('Skill Drain'), 'szone', { faceUp: true });
    const cv = place(1, N('Cyber Valley'), 'mzone');
    const att = place(0, T.brute, 'mzone');
    c0.aim = cv;
    const hand1 = g.zone(1, 'hand').length;
    g.phase = 'battle';
    await g.conductAttack(0, att);
    eq(cv.location, 'banished', 'Cyber Valley banished');
    eq(g.zone(1, 'hand').length, hand1 + 1, 'drew 1');
    eq(g.players[1].lp, 8000, 'no battle');
  });

  // https://edisonrul.ing/cards/b/battle-fader.html
  await test('Battle Fader: only one copy can be activated in response to a single attack declaration', async () => {
    const { g, c1, place } = setup();
    for (const c of [...g.monsters(1)]) g.rawMove(c, 'grave');
    const f1 = place(1, N('Battle Fader'), 'hand');
    const f2 = place(1, N('Battle Fader'), 'hand');
    const att = place(0, T.brute, 'mzone');
    c1.respond = respondWith('Battle Fader');
    g.phase = 'battle';
    await g.conductAttack(0, att);
    eq([f1, f2].filter((f) => f.location === 'mzone').length, 1, 'one Battle Fader Special Summoned');
    eq(g.players[1].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/b/black-luster-soldier-envoy-of-the-beginning.html
  await test('Black Luster Soldier - Envoy of the Beginning: can banish itself with its first effect', async () => {
    const { g, c0, place } = setup();
    for (const c of [...g.monsters(1)]) g.rawMove(c, 'grave');
    const bls = place(0, N('Black Luster Soldier - Envoy of the Beginning'), 'mzone');
    pickOnly(c0, [bls]);
    eq(canActivate(g, 0, bls, 'Banish 1 monster'), true, 'activatable with only itself on the field');
    await activate(g, 0, bls, 'Banish 1 monster');
    eq(bls.location, 'banished', 'banished itself');
  });

  // https://edisonrul.ing/cards/n/nettles.html
  await test('Nettles: returns to the hand instead of a face-up Plant (itself included) being destroyed', async () => {
    const { g, place } = setup();
    const net = place(0, N('Nettles'), 'mzone');
    const pl = place(0, T.plant, 'mzone');
    await g.destroy([pl], 'effect', 1);
    eq(pl.location, 'mzone', 'Plant not destroyed');
    eq(net.location, 'hand', 'Nettles returned to the hand');
    const b = setup();
    const net2 = b.place(0, N('Nettles'), 'mzone');
    await b.g.destroy([net2], 'effect', 1);
    eq(net2.location, 'hand', 'Nettles protects itself');
  });

  // https://edisonrul.ing/cards/n/nettles.html
  await test('Nettles: attacked while face-down, it is destroyed by battle', async () => {
    const { g, c1, place } = setup();
    const net = place(1, N('Nettles'), 'mzone', { faceUp: false, pos: 'def' });
    const att = place(0, T.brute, 'mzone');
    c1.confirmAnswer = true;
    g.phase = 'battle';
    await g.conductAttack(0, att);
    eq(net.location, 'grave', 'destroyed by battle');
  });

  // https://edisonrul.ing/cards/g/gragonith-lightsworn-dragon.html
  await test('Gragonith, Lightsworn Dragon: no cards sent if it is no longer face-up when the End Phase effect resolves', async () => {
    const { g, place } = setup();
    const gr = place(0, N('Gragonith, Lightsworn Dragon'), 'mzone');
    const deck0 = g.zone(0, 'deck').length;
    beforeResolve(g, async () => {
      await g.changePosition(gr, 'def', false);
    });
    g.phase = 'end';
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'end', player: 0 } as any);
    await g.processTriggers(true);
    eq(linksOf(g, gr).length, 1, 'the effect activated');
    eq(g.zone(0, 'deck').length, deck0, 'no cards sent to the GY');
  });

  // https://edisonrul.ing/cards/t/twin-headed-behemoth.html
  await test('Twin-Headed Behemoth: revived by Monster Reborn before the End Phase, its once-per-Duel effect is not used', async () => {
    const { g, c0, place } = setup();
    const thb = place(0, N('Twin-Headed Behemoth'), 'mzone');
    await g.destroy([thb], 'effect', 1);
    await g.processTriggers(true);
    eq(c0.triggersAsked.filter((n) => n === 'Twin-Headed Behemoth').length, 1, 'trigger used once');
    await g.specialSummon([thb], 0, {});
    await g.destroy([thb], 'effect', 1);
    await g.processTriggers(true);
    eq(c0.triggersAsked.filter((n) => n === 'Twin-Headed Behemoth').length, 2, 'it activates again');
    await (g as any).setPhase('end');
    eq(thb.location, 'mzone', 'Special Summoned in the End Phase');
    eq(g.getAtk(thb), 1000, 'ATK 1000');
    await g.destroy([thb], 'effect', 1);
    await g.processTriggers(true);
    eq(c0.triggersAsked.filter((n) => n === 'Twin-Headed Behemoth').length, 2, 'used: no third activation');
  });

  // https://edisonrul.ing/cards/c/cross-porter.html
  await test('Cross Porter: another target flipped face-down makes it resolve without effect', async () => {
    const { g, c0, place } = setup();
    const cp = place(0, N('Cross Porter'), 'mzone');
    const other = place(0, T.brute, 'mzone');
    const neo = place(0, T.neo, 'hand');
    pickOnly(c0, [other]);
    beforeResolve(g, async () => {
      await g.changePosition(other, 'def', false);
    });
    await activate(g, 0, cp, 'Send 1 monster: Special Summon a Neo-Spacian');
    eq(other.location, 'mzone', 'face-down target not sent');
    eq(neo.location, 'hand', 'no Neo-Spacian Special Summoned');
  });

  // https://edisonrul.ing/cards/c/cross-porter.html
  await test('Cross Porter: targeting itself, it still resolves if flipped face-down', async () => {
    const { g, c0, place } = setup();
    const cp = place(0, N('Cross Porter'), 'mzone');
    const neo = place(0, T.neo, 'hand');
    pickOnly(c0, [cp]);
    beforeResolve(g, async () => {
      await g.changePosition(cp, 'def', false);
    });
    await activate(g, 0, cp, 'Send 1 monster: Special Summon a Neo-Spacian');
    eq(cp.location, 'grave', 'sent to the GY');
    eq(neo.location, 'mzone', 'Neo-Spacian Special Summoned');
  });

  // https://edisonrul.ing/cards/r/rescue-cat.html , https://edisonrul.ing/cards/t/thunder-king-rai-oh.html
  await test('Rescue Cat / Thunder King Rai-Oh: their send-to-GY costs cannot be paid under Macro Cosmos', async () => {
    const { g, place } = setup();
    place(1, N('Macro Cosmos'), 'szone', { faceUp: true });
    const cat = place(0, N('Rescue Cat'), 'mzone');
    place(0, T.beast, 'deck');
    place(0, T.beast, 'deck');
    eq(canActivate(g, 0, cat), false, 'Rescue Cat cannot be activated');
    const raio = place(0, N('Thunder King Rai-Oh'), 'mzone');
    const ef = raio.data.effects!.find((e) => e.label === 'Send: negate Special Summon')!;
    eq(ef.canActivate!(new Ctx(g, raio, ef, 0)), false, 'Rai-Oh cannot pay its cost');
  });

  // https://edisonrul.ing/cards/n/night-assailant.html
  await test('Night Assailant: the FLIP effect activates even if the opponent controls no monster', async () => {
    const { g, place } = setup();
    for (const c of [...g.monsters(1)]) g.rawMove(c, 'grave');
    const na = place(0, N('Night Assailant'), 'mzone', { faceUp: false, pos: 'def' });
    await g.changePosition(na, 'atk', true);
    await g.processTriggers(true);
    eq(linksOf(g, na).length, 1, 'Flip Effect activated');
  });

  // https://edisonrul.ing/cards/s/swap-frog.html
  await test('Swap Frog: its Special Summon cost is a discard', async () => {
    const { g, c0, place } = setup();
    const sf = place(0, N('Swap Frog'), 'hand');
    const w = place(0, T.water, 'hand');
    pickOnly(c0, [w]);
    c0.trigger = () => false;
    const action = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === sf);
    if (!action) throw new Error('Swap Frog procedure not offered');
    await g.performAction(0, action);
    eq(sf.location, 'mzone', 'Special Summoned');
    eq(g.eventLog.some((e) => e.type === 'discarded' && e.card === w), true, 'the WATER monster was discarded');
  });

  // https://edisonrul.ing/cards/l/level-eater.html
  await test('Level Eater: April 2010 text includes the Tribute restriction', async () => {
    eq(N('Level Eater').text.includes('cannot be Tributed except for a Tribute Summon'), true, 'text');
  });

  report();
})();
