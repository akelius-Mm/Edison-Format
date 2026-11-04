// Rulings regression tests, database audit group 9 (traps, tournament extras, misc). Each test pins a behaviour fixed
// from the edisonrul.ing card page (historical edisonformat.com section first).
// Usage: npx tsx scripts/rulings/db-audit-9.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardInstance } from '../../src/engine/card';
import type { Game } from '../../src/engine/game';
import type { ResponseRequest } from '../../src/engine/controller';
import { activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  zombie: findCard('Audit9 Test Zombie') ?? normal('Audit9 Test Zombie', 'DARK', 'Zombie', 4, 1900, 1000),
};
const N = (n: string) => cardByName(n);
const setup = () => newGame(T.wall);
/** A responder that records the names offered to it, and then answers with `then`. */
const recorder = (seen: Set<string>, then: (g: Game, req: ResponseRequest) => ReturnType<ReturnType<typeof respondWith>> = () => null) =>
  (g: Game, req: ResponseRequest) => {
    for (const o of req.options) seen.add(o.card.name);
    return then(g, req);
  };
const pickFirst = (want: CardInstance) => (_g: Game, req: { candidates: CardInstance[]; min: number }) =>
  req.candidates.includes(want) ? [want] : req.candidates.slice(0, req.min);

(async () => {
  console.log('Rulings tests: database audit group 9');

  // https://edisonrul.ing/cards/d/destiny-hero-departed.html
  await test('Destiny HERO - Departed: sent to the GY as a cost it stays in the GY; discarded by an effect it is banished', async () => {
    const { g, place } = setup();
    const a = place(0, N('Destiny HERO - Departed'), 'hand');
    await g.moveCards([a], 'grave', { reason: 'discard', reasons: ['discard', 'cost'], reasonPlayer: 0 });
    eq(a.location, 'grave', 'discarded as a cost: in the GY');
    const b = place(0, N('Destiny HERO - Departed'), 'hand');
    await g.moveCards([b], 'grave', { reason: 'discard', reasons: ['discard', 'effect'], reasonPlayer: 1 });
    eq(b.location, 'banished', 'discarded by an effect: banished');
  });

  // https://edisonrul.ing/cards/s/sakuretsu-armor.html, https://edisonrul.ing/cards/d/dimensional-prison.html,
  // https://edisonrul.ing/cards/m/magic-cylinder.html
  for (const name of ['Sakuretsu Armor', 'Dimensional Prison', 'Magic Cylinder']) {
    await test(`${name}: no effect if Book of Moon turns the attacking monster face-down in response`, async () => {
      const { g, c0, c1, place } = setup();
      g.turnPlayer = 1;
      g.phase = 'battle';
      const att = place(1, T.brute, 'mzone');
      place(0, N(name), 'szone', { faceUp: false });
      place(1, N('Book of Moon'), 'szone', { faceUp: false });
      c0.respond = respondWith(name);
      c1.respond = (gg, req) => (gg.chain.some((l) => l.card.name === name) ? respondWith('Book of Moon')(gg, req) : null);
      c1.pick = pickFirst(att);
      await g.conductAttack(1, att);
      eq(att.location, 'mzone', 'attacker still on the field');
      eq(att.faceUp, false, 'face-down');
      eq(g.players[1].lp, 8000, 'no damage to the attacker\'s controller');
    });
  }

  // https://edisonrul.ing/cards/s/sakuretsu-armor.html (control-change bullet on the Dimensional Prison page)
  await test('Sakuretsu Armor: still destroys the attacker when nothing interferes', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const att = place(1, T.brute, 'mzone');
    place(0, N('Sakuretsu Armor'), 'szone', { faceUp: false });
    c0.respond = respondWith('Sakuretsu Armor');
    await g.conductAttack(1, att);
    eq(att.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/d/dust-tornado.html
  await test('Dust Tornado: no Set if the opponent destroys its target in response', async () => {
    const { g, c0, c1, place } = setup();
    const dt = place(0, N('Dust Tornado'), 'szone', { faceUp: false });
    const tgt = place(1, N('Sakuretsu Armor'), 'szone', { faceUp: false });
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    const inHand = place(0, N('Sakuretsu Armor'), 'hand');
    c0.pick = pickFirst(tgt);
    c1.pick = pickFirst(tgt);
    c1.respond = (gg, req) => (gg.chain.some((l) => l.card === dt) ? respondWith('Mystical Space Typhoon')(gg, req) : null);
    let asked = 0;
    c0.yes = () => (asked++, true);
    await activate(g, 0, dt);
    eq(tgt.location, 'grave', 'the target was destroyed by the opponent\'s MST');
    eq(asked, 0, 'not offered a Set');
    eq(inHand.location, 'hand', 'nothing Set');
  });

  await test('Dust Tornado: Sets a card after destroying its target', async () => {
    const { g, c0, place } = setup();
    const dt = place(0, N('Dust Tornado'), 'szone', { faceUp: false });
    const tgt = place(1, N('Sakuretsu Armor'), 'szone', { faceUp: false });
    const inHand = place(0, N('Sakuretsu Armor'), 'hand');
    c0.pick = pickFirst(tgt);
    await activate(g, 0, dt);
    eq(tgt.location, 'grave', 'destroyed');
    eq(inHand.location, 'szone', 'Set');
  });

  // https://edisonrul.ing/cards/m/my-body-as-a-shield.html
  await test('My Body as a Shield: not vs Heavy Storm, not vs your own card; negates the opponent\'s Dark Hole', async () => {
    let s = setup();
    s.place(0, T.brute, 'mzone');
    s.place(1, T.brute, 'mzone');
    s.place(0, N('My Body as a Shield'), 'szone', { faceUp: false });
    const seen = new Set<string>();
    s.c0.respond = recorder(seen);
    s.g.turnPlayer = 1;
    await activate(s.g, 1, s.place(1, N('Heavy Storm'), 'hand'));
    eq(seen.has('My Body as a Shield'), false, 'not offered vs Heavy Storm');

    s = setup();
    s.place(0, T.brute, 'mzone');
    s.place(1, T.brute, 'mzone');
    s.place(0, N('My Body as a Shield'), 'szone', { faceUp: false });
    const seen2 = new Set<string>();
    s.c0.respond = recorder(seen2);
    await activate(s.g, 0, s.place(0, N('Dark Hole'), 'hand'));
    eq(seen2.has('My Body as a Shield'), false, 'not offered vs your own Dark Hole');

    s = setup();
    const mine = s.place(0, T.brute, 'mzone');
    s.place(1, T.brute, 'mzone');
    s.place(0, N('My Body as a Shield'), 'szone', { faceUp: false });
    s.c0.respond = respondWith('My Body as a Shield');
    s.g.turnPlayer = 1;
    await activate(s.g, 1, s.place(1, N('Dark Hole'), 'hand'));
    eq(mine.location, 'mzone', 'Dark Hole negated');
    eq(s.g.players[0].lp, 6500, 'paid 1500');
  });

  // https://edisonrul.ing/cards/l/light-and-darkness-dragon.html
  await test('Light and Darkness Dragon: does not answer the effect of a face-up Continuous Spell (Mass Driver)', async () => {
    const { g, place } = setup();
    const ladd = place(1, N('Light and Darkness Dragon'), 'mzone');
    place(0, T.brute, 'mzone');
    const md = place(0, N('Mass Driver'), 'szone', { faceUp: true });
    await activate(g, 0, md);
    eq(g.getAtk(ladd), 2800, 'no ATK lost');
    eq(g.players[1].lp, 7600, 'Mass Driver resolved');
  });

  await test('Light and Darkness Dragon: always activates, but with under 500 ATK it negates nothing', async () => {
    const { g, place } = setup();
    const ladd = place(1, N('Light and Darkness Dragon'), 'mzone');
    g.addTempMod(ladd, 'atk', -2500, 'field');
    const before = g.eventLog.length;
    await activate(g, 0, place(0, N('Hinotama'), 'hand'));
    eq(g.eventLog.slice(before).some((e) => e.type === 'chainActivated' && e.card === ladd), true, 'its effect activated');
    eq(g.players[1].lp, 7500, 'Hinotama not negated');
    eq(g.getAtk(ladd), 300, 'no ATK lost');
  });

  await test('Light and Darkness Dragon: with 2 of them, only the one directly chained negates and loses ATK', async () => {
    const { g, place } = setup();
    const a = place(1, N('Light and Darkness Dragon'), 'mzone');
    const b = place(1, N('Light and Darkness Dragon'), 'mzone');
    await activate(g, 0, place(0, N('Hinotama'), 'hand'));
    eq(g.players[1].lp, 8000, 'Hinotama negated');
    eq(g.getAtk(a) + g.getAtk(b), 2800 + 2300, 'exactly one lost 500 ATK');
  });

  // https://edisonrul.ing/cards/c/consecrated-light.html
  await test('Consecrated Light: a face-up Light and Darkness Dragon (also DARK) cannot attack', async () => {
    const { g, place } = setup();
    place(1, N('Consecrated Light'), 'mzone');
    const ladd = place(0, N('Light and Darkness Dragon'), 'mzone');
    g.phase = 'battle';
    eq(g.canAttack(ladd), false, 'cannot attack');
  });

  // https://edisonrul.ing/cards/s/sky-scourge-norleras.html
  await test('Sky Scourge Norleras: can never be Special Summoned from the GY or from banishment', async () => {
    const { g, place } = setup();
    const a = place(0, N('Sky Scourge Norleras'), 'grave');
    a.properlySummoned = true;
    eq((await g.specialSummon([a], 0, {})).length, 0, 'not from the GY');
    const b = place(0, N('Sky Scourge Norleras'), 'banished');
    b.properlySummoned = true;
    eq((await g.specialSummon([b], 0, {})).length, 0, 'not from banishment');
  });

  // https://edisonrul.ing/cards/r/revived-king-ha-des.html
  await test('Revived King Ha Des: the negation of a monster it destroyed lasts while it stays in the GY (Treeborn Frog)', async () => {
    const { g, place } = setup();
    place(0, N('Revived King Ha Des'), 'mzone');
    const z = place(0, T.zombie, 'mzone');
    const frog = place(1, N('Treeborn Frog'), 'mzone');
    g.phase = 'battle';
    await g.conductAttack(0, z);
    eq(frog.location, 'grave', 'destroyed by battle');
    // Two turns later, the opponent's Standby Phase.
    g.turn += 2;
    g.turnPlayer = 1;
    await (g as any).setPhase('standby');
    await g.processTriggers(false);
    eq(frog.location, 'grave', 'Treeborn Frog still negated');
  });

  // https://edisonrul.ing/cards/t/tuners-scheme.html
  await test("Tuner's Scheme: when it leaves the field, control of the Synchro Monster returns", async () => {
    const { g, c0, place } = setup();
    const syn = place(1, N('Stardust Dragon'), 'mzone');
    const ts = place(0, N("Tuner's Scheme"), 'szone', { faceUp: false });
    c0.respond = respondWith("Tuner's Scheme");
    g.emit({ type: 'specialSummoned', card: syn, player: 1 });
    await g.processTriggers(true);
    eq(syn.controller, 0, 'taken');
    await g.destroy([ts], 'effect', 1);
    await g.processTriggers(false);
    eq(syn.controller, 1, 'control returned');
  });

  // https://edisonrul.ing/cards/s/spell-reactor-re.html
  await test('Spell Reactor RE: no 800 damage if the Spell Card is already gone when it resolves', async () => {
    const { g, c0, c1, place } = setup();
    place(1, N('Spell Reactor・RE'), 'mzone');
    c1.respond = respondWith('Spell Reactor・RE');
    // Field Spell-free check: a Continuous Spell destroyed in the chain before the Reactor resolves.
    const md = place(0, N('Mass Driver'), 'hand');
    const mst = place(0, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    let done = false;
    c0.respond = (gg: Game, req: ResponseRequest) => {
      if (!done && gg.chain.some((l) => l.card.name === 'Spell Reactor・RE')) {
        done = true;
        return respondWith('Mystical Space Typhoon')(gg, req);
      }
      return null;
    };
    c0.pick = pickFirst(md);
    await activate(g, 0, md);
    eq(mst.location, 'grave', 'MST used');
    eq(md.location, 'grave', 'Mass Driver destroyed by MST first');
    eq(g.players[0].lp, 8000, 'no 800 damage');
  });

  // https://edisonrul.ing/cards/t/trap-reactor-y-fi.html
  await test('Trap Reactor Y FI: can be activated during the Damage Step', async () => {
    const { g } = setup();
    const ef = N('Trap Reactor・Y FI').effects![0];
    eq(ef.damageStep, true, 'damageStep');
    void g;
  });

  // https://edisonrul.ing/cards/a/assault-mode-activate.html
  await test('Assault Mode Activate: can Tribute a face-down Synchro Monster', async () => {
    const { g, place } = setup();
    const sd = place(0, N('Red Dragon Archfiend'), 'mzone', { faceUp: false, pos: 'def' });
    const am = place(0, N('Red Dragon Archfiend/Assault Mode'), 'deck');
    const ama = place(0, N('Assault Mode Activate'), 'szone', { faceUp: false });
    await activate(g, 0, ama);
    eq(sd.location, 'grave', 'Tributed');
    eq(am.location, 'mzone', 'Assault Mode Summoned');
  });

  // https://edisonrul.ing/cards/w/waboku.html
  await test('Waboku: also protects a monster Summoned after it resolved, for the rest of the turn', async () => {
    const { g, c1, place } = setup();
    await activate(g, 0, place(0, N('Waboku'), 'szone', { faceUp: false }));
    g.turnPlayer = 1;
    const late = place(0, T.wall, 'mzone');
    late.pos = 'atk';
    const att = place(1, T.brute, 'mzone');
    g.phase = 'battle';
    c1.aim = late;
    await g.conductAttack(1, att);
    eq(late.location, 'mzone', 'not destroyed by battle');
    eq(g.players[0].lp, 8000, 'no battle damage');
  });

  // https://edisonrul.ing/cards/a/arcana-force-xxi-the-world.html
  await test('Arcana Force XXI - The World (Tails): negated by Light and Darkness Dragon, it activates again until it resolves', async () => {
    const { g, place } = setup();
    const af = place(0, N('Arcana Force XXI - The World'), 'hand');
    const orig = g.rng.int.bind(g.rng);
    g.rng.int = () => 1; // Tails
    await g.specialSummon([af], 0, {});
    await g.processTriggers(false);
    g.rng.int = orig;
    const ladd = place(1, N('Light and Darkness Dragon'), 'mzone');
    const top = place(1, T.wall, 'grave');
    g.turn = 3;
    g.turnPlayer = 1;
    await (g as any).setPhase('draw');
    await g.processTriggers(false);
    eq(top.location, 'hand', 'it finally resolved');
    eq(g.getAtk(ladd), 800, 'LADD negated it until its DEF fell below 500');
  });

  // https://edisonrul.ing/cards/b/black-garden.html
  await test("Black Garden: the Rose Token is Summoned by Black Garden's controller (Scapegoat player can't Special Summon)", async () => {
    const { g, place } = setup();
    place(1, N('Black Garden'), 'fzone');
    g.addPlayerMod(0, 'cannotSpecialSummon');
    const m = place(0, T.brute, 'hand');
    await g.normalSummon(0, m, false);
    await g.processTriggers(false);
    eq(g.getAtk(m), 900, 'ATK halved');
    eq(g.monsters(1).some((c) => c.name === 'Rose Token'), true, "Rose Token on Black Garden's controller's side");
  });

  // https://edisonrul.ing/cards/a/a-cell-incubator.html
  await test('"A" Cell Incubator: no A-Counter when a monster with A-Counters is flipped face-down; one when a counter is removed', async () => {
    const { g, place } = setup();
    const inc = place(0, N('"A" Cell Incubator'), 'szone', { faceUp: true });
    const m = place(1, T.brute, 'mzone');
    m.counters.A = 1;
    g.update();
    await g.changePosition(m, 'def', false);
    g.update();
    eq(inc.counters.A ?? 0, 0, 'flipped face-down: nothing');
    const m2 = place(1, T.brute, 'mzone');
    m2.counters.A = 2;
    g.update();
    m2.counters.A = 1;
    g.update();
    eq(inc.counters.A ?? 0, 1, 'removed by an effect: 1 A-Counter');
  });

  // https://edisonrul.ing/cards/d/dimension-fortress-weapon.html
  await test('Dimension Fortress Weapon: Card Trooper cannot activate its mill effect', async () => {
    const { g, place } = setup();
    const ct = place(0, N('Card Trooper'), 'mzone');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === ct), true, 'usable before');
    place(1, N('Dimension Fortress Weapon'), 'mzone');
    eq(g.getActivations(0, { open: true }).some((a) => a.card === ct), false, 'not with Dimension Fortress Weapon');
  });

  // https://edisonrul.ing/cards/d/divine-wrath.html
  await test("Divine Wrath: can negate its own controller's monster effect too", async () => {
    const { g, c0, place } = setup();
    const ct = place(0, N('Card Trooper'), 'mzone');
    place(0, N('Divine Wrath'), 'szone', { faceUp: false });
    place(0, T.wall, 'hand');
    const seen = new Set<string>();
    c0.respond = recorder(seen);
    await activate(g, 0, ct);
    eq(seen.has('Divine Wrath'), true, 'offered against your own Card Trooper');
  });

  // https://edisonrul.ing/cards/u/ultimate-offering.html
  await test('Ultimate Offering: its effect can be activated again in the same Chain', async () => {
    const { g, c0, place } = setup();
    g.players[0].normalSummonsLeft = 0;
    const uo = place(0, N('Ultimate Offering'), 'szone', { faceUp: true });
    const a = place(0, T.brute, 'hand');
    const b = place(0, T.wall, 'hand');
    let n = 0;
    // Chain it to its own first activation (same Chain).
    c0.respond = (gg, req) => (gg.chain.some((l) => l.card === uo) && n++ === 0 ? req.options.find((o) => o.card === uo) ?? null : null);
    await activate(g, 0, uo);
    eq(g.players[0].lp, 7000, 'paid 500 twice');
    eq(a.location === 'mzone' && b.location === 'mzone', true, 'two extra Normal Summons');
  });

  // https://edisonrul.ing/cards/m/morphtronic-magnen.html
  await test('Morphtronic Magnen: with 2 in Defense Position, the opponent cannot attack', async () => {
    const { g, place } = setup();
    place(1, N('Morphtronic Magnen'), 'mzone', { pos: 'def' });
    place(1, N('Morphtronic Magnen'), 'mzone', { pos: 'def' });
    place(1, T.wall, 'mzone');
    const att = place(0, T.brute, 'mzone');
    const r = g.attackTargets(att);
    eq(r.targets.length, 0, 'no attack target');
    eq(r.direct, false, 'no direct attack');
  });

  // https://edisonrul.ing/cards/p/phantom-of-chaos.html
  await test('Phantom of Chaos: cannot target a Gemini monster', async () => {
    const { g, place } = setup();
    const ph = place(0, N('Phantom of Chaos'), 'mzone');
    place(0, N('Elemental HERO Neos Alius'), 'grave');
    eq(canActivate(g, 0, ph), false, 'only a Gemini in the GY: cannot activate');
    place(0, N('Sangan'), 'grave');
    eq(canActivate(g, 0, ph), true, 'an Effect Monster in the GY');
  });

  // https://edisonrul.ing/cards/s/summon-reactor-sk.html
  await test('Summon Reactor SK: its attack negation targets the attacking monster', async () => {
    const { g, c0, place } = setup();
    const sk = place(0, N('Summon Reactor・SK'), 'mzone', { pos: 'def' });
    sk.flags.skBurnTurn = g.turn;
    const att = place(1, T.brute, 'mzone');
    g.turnPlayer = 1;
    g.phase = 'battle';
    let targets: CardInstance[] = [];
    c0.respond = (gg, req) => {
      const o = req.options.find((x) => x.card === sk);
      return o ?? null;
    };
    const origAct = g.activate.bind(g);
    g.activate = async (p, act) => {
      const l = await origAct(p, act);
      if (l && l.card === sk) targets = [...l.ctx.targets];
      return l;
    };
    await g.conductAttack(1, att);
    eq(targets.includes(att), true, 'targets the attacker');
    eq(g.players[0].lp, 8000, 'attack negated');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-chaos-neos.html
  await test('Elemental HERO Chaos Neos (2 Heads): the negation lasts beyond this turn', async () => {
    const { g, place } = setup();
    const cn = place(0, N('Elemental HERO Chaos Neos'), 'mzone');
    const sangan = place(1, N('Sangan'), 'mzone');
    const seq = [0.1, 0.1, 0.9];
    const orig = g.rng.next.bind(g.rng);
    g.rng.next = () => seq.shift() ?? orig();
    await activate(g, 0, cn, 'Toss a coin 3 times');
    g.rng.next = orig;
    eq(g.isNegated(sangan), true, 'negated');
    // The end-of-turn expiry of Game.playTurn (temporary changes that last "this turn" end).
    for (const c of g.allCards) c.tempMods = c.tempMods.filter((t) => t.until === 'field');
    g.turn += 1;
    eq(g.isNegated(sangan), true, 'still negated next turn');
  });

  // https://edisonrul.ing/cards/c/cloudian-turbulence.html
  await test("Cloudian - Turbulence: can Special Summon Cloudian - Smoke Ball from the opponent's GY", async () => {
    const { g, place } = setup();
    const tu = place(0, N('Cloudian - Turbulence'), 'mzone');
    tu.counters.fog = 1;
    const sb = place(1, N('Cloudian - Smoke Ball'), 'grave');
    await activate(g, 0, tu);
    eq(sb.location, 'mzone', 'Summoned');
    eq(sb.controller, 0, 'to your field');
  });

  // https://edisonrul.ing/cards/c/chimeratech-fortress-dragon.html
  await test('Chimeratech Fortress Dragon: ATK 0 after being flipped face-down, and for good once negated by Skill Drain', async () => {
    const { g, place } = setup();
    const cfd = place(0, N('Chimeratech Fortress Dragon'), 'mzone');
    cfd.flags.baseAtk = 3000;
    await g.changePosition(cfd, 'def', false);
    await g.changePosition(cfd, 'atk', true);
    eq(g.getAtk(cfd), 0, 'face-down then face-up: 0');
    const cfd2 = place(0, N('Chimeratech Fortress Dragon'), 'mzone');
    cfd2.flags.baseAtk = 2000;
    const sd = place(1, N('Skill Drain'), 'szone', { faceUp: true });
    g.update();
    await g.destroy([sd], 'effect', 0);
    g.update();
    eq(g.getAtk(cfd2), 0, 'stays 0 after Skill Drain is gone');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-laquari.html
  await test('Gladiator Beast Laquari: original ATK 2100 when Summoned by a Gladiator Beast; lost for good to Skill Drain', async () => {
    const { g, place } = setup();
    const best = place(0, N('Gladiator Beast Bestiari'), 'grave');
    const laq = place(0, N('Gladiator Beast Laquari'), 'hand');
    await g.specialSummon([laq], 0, { reasonCard: best });
    eq(g.baseAtk(laq), 2100, 'original ATK 2100');
    const sd = place(1, N('Skill Drain'), 'szone', { faceUp: true });
    g.update();
    await g.destroy([sd], 'effect', 0);
    g.update();
    eq(g.getAtk(laq), 1800, 'back to 1800 for good');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-dimacari.html
  await test('Gladiator Beast Dimacari: its double attack is lost for good to Skill Drain', async () => {
    const { g, place } = setup();
    const best = place(0, N('Gladiator Beast Bestiari'), 'grave');
    const dim = place(0, N('Gladiator Beast Dimacari'), 'hand');
    await g.specialSummon([dim], 0, { reasonCard: best });
    eq(g.queryCardNum(dim, 'extraAttacks'), 1, 'attacks twice');
    const sd = place(1, N('Skill Drain'), 'szone', { faceUp: true });
    g.update();
    await g.destroy([sd], 'effect', 0);
    g.update();
    eq(g.queryCardNum(dim, 'extraAttacks'), 0, 'not after Skill Drain is gone');
  });

  // https://edisonrul.ing/cards/f/fog-king.html
  await test('Fog King: ATK 0 once flipped face-down and face-up again', async () => {
    const { g, c0, place } = setup();
    const t = place(0, T.brute, 'mzone');
    const fk = place(0, N('Fog King'), 'hand');
    c0.option = () => 1; // Tribute 1 monster
    c0.pick = pickFirst(t);
    await g.normalSummon(0, fk, false);
    eq(g.getAtk(fk), 1800, 'ATK of the Tribute');
    await g.changePosition(fk, 'def', false);
    await g.changePosition(fk, 'atk', true);
    eq(g.getAtk(fk), 0, 'face-down then face-up: 0');
  });

  // https://edisonrul.ing/cards/g/gozen-match.html
  await test('Gozen Match: no Flip Summon of a monster of another Attribute', async () => {
    const { g, place } = setup();
    place(0, N('Gozen Match'), 'szone', { faceUp: true });
    place(0, T.brute, 'mzone');
    const fd = place(0, N('Sangan'), 'mzone', { faceUp: false, pos: 'def' });
    eq(g.legalMainActions(0).some((a) => a.type === 'flip' && a.card === fd), false, 'not offered');
  });

  report();
})();
