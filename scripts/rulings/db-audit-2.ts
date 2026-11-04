// Rulings regression tests, database audit group 2 (ANPR, extra, gladiators, teledad, deck-extras3): each test pins a
// behaviour to the 2010 TCG rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/rulings/db-audit-2.ts
import '../../src/cards';
import { cardByName } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardInstance } from '../../src/engine/card';
import type { Game } from '../../src/engine/game';
import type { ResponseRequest } from '../../src/engine/controller';
import { activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const N = (n: string) => cardByName(n);
const wall = normal('Audit2 Wall', 'EARTH', 'Rock', 4, 500, 2000);
const brute = normal('Audit2 Brute', 'EARTH', 'Warrior', 4, 1800, 1000);
const weak = normal('Audit2 Weakling', 'EARTH', 'Warrior', 4, 1000, 1000);
const lvl2 = normal('Audit2 Level 2', 'EARTH', 'Warrior', 2, 600, 600);
const psychic = normal('Audit2 Psychic', 'EARTH', 'Psychic', 4, 1500, 1000);
const tuner2 = normal('Audit2 Tuner', 'EARTH', 'Warrior', 2, 800, 800);
tuner2.mtypes!.push('tuner');

const setup = () => newGame(wall);
/** A responder that answers only while a card named `onChain` is on the chain. */
const whenChained = (onChain: string, name: string) => (g: Game, req: ResponseRequest) =>
  g.chain.some((l) => l.card.name === onChain) ? respondWith(name)(g, req) : null;
const linkOf = (g: Game, card: CardInstance) => g.eventLog.find((e) => e.type === 'chainActivated' && e.card === card)?.data?.link as { ctx: { targets: CardInstance[] } } | undefined;

(async () => {
  console.log('Rulings tests: database audit group 2');

  // https://edisonrul.ing/cards/s/stardust-dragon.html
  await test('Stardust Dragon: no End Phase revival when its negation was itself negated (Divine Wrath)', async () => {
    for (const wrath of [false, true]) {
      const { g, c0, c1, place } = setup();
      const hole = place(0, N('Dark Hole'), 'hand');
      place(0, wall, 'hand');
      if (wrath) place(0, N('Divine Wrath'), 'szone', { faceUp: false });
      const sd = place(1, N('Stardust Dragon'), 'mzone');
      place(0, brute, 'mzone');
      c1.respond = respondWith('Stardust Dragon');
      c0.respond = whenChained('Stardust Dragon', 'Divine Wrath');
      await activate(g, 0, hole);
      eq(sd.location, 'grave', 'Stardust Tributed');
      eq(sd.flags.stardustRevive === g.turn, !wrath, wrath ? 'no revival after Divine Wrath' : 'revival after a successful negation');
    }
  });

  // https://edisonrul.ing/cards/a/ancient-fairy-dragon.html
  await test('Ancient Fairy Dragon: no Battle Phase lock when the activation is negated (Divine Wrath)', async () => {
    for (const wrath of [false, true]) {
      const { g, c1, place } = setup();
      const afd = place(0, N('Ancient Fairy Dragon'), 'mzone');
      place(0, weak, 'hand');
      if (wrath) {
        place(1, N('Divine Wrath'), 'szone', { faceUp: false });
        place(1, wall, 'hand');
      }
      c1.respond = respondWith('Divine Wrath');
      await activate(g, 0, afd, 'Special Summon from hand');
      eq(g.queryPlayer(0, 'cannotDeclareAttack'), !wrath, wrath ? 'activation negated: Battle Phase allowed' : 'Battle Phase locked');
    }
  });

  // https://edisonrul.ing/cards/d/destiny-hero-diamond-dude.html
  await test('Destiny Hero - Diamond Dude: the Normal Spell effect is a Chain Link from the GY in either Main Phase of the next turn', async () => {
    const { g, place } = setup();
    const dd = place(0, N('Destiny Hero - Diamond Dude'), 'mzone');
    const pot = place(0, N('Pot of Greed'), 'deck');
    const deck = g.players[0].deck;
    eq(deck[deck.length - 1], pot, 'Pot of Greed on top');
    await activate(g, 0, dd);
    eq(pot.location, 'grave', 'sent to the GY');
    eq(canActivate(g, 0, pot), false, 'not this turn');
    g.turn += 2;
    g.phase = 'main2';
    dd.flags = {};
    eq(canActivate(g, 0, pot), true, 'next turn, Main Phase 2 too');
    const hand = g.players[0].hand.length;
    await activate(g, 0, pot);
    eq(!!linkOf(g, pot), true, 'activated as a Chain Link');
    eq(g.players[0].hand.length, hand + 2, 'drew 2');
    eq(pot.location, 'grave', 'stays in the GY');
    eq(canActivate(g, 0, pot), false, 'only once');
  });

  // https://edisonrul.ing/cards/s/slip-of-fortune.html
  await test('Slip of Fortune: targets the attacker too; a face-down target is banished and returns face-down', async () => {
    const { g, c0, place } = setup();
    const slip = place(0, N('Slip of Fortune'), 'szone', { faceUp: false });
    const fd = place(0, brute, 'mzone', { faceUp: false, pos: 'def' });
    const att = place(1, brute, 'mzone');
    g.turnPlayer = 1;
    c0.respond = respondWith('Slip of Fortune');
    await g.conductAttack(1, att);
    const link = linkOf(g, slip);
    eq(link?.ctx.targets.includes(att), true, 'the attacker is targeted');
    eq(link?.ctx.targets.includes(fd), true, 'the attack target is targeted');
    eq(fd.location, 'banished', 'banished');
    eq(fd.faceUp, false, 'banished face-down');
    g.turn++;
    g.turnPlayer = 0;
    await (g as any).setPhase('standby');
    eq(fd.location, 'mzone', 'returned');
    eq(fd.faceUp, false, 'face-down');
    eq(fd.pos, 'def', 'Defense Position');
  });

  // https://edisonrul.ing/cards/s/shiny-black-c.html
  await test('Shiny Black "C": the Synchro Monster is not destroyed if it was flipped face-down in response', async () => {
    for (const moon of [false, true]) {
      const { g, c0, place } = setup();
      const aa = place(0, N('Armory Arm'), 'extra');
      const mats = [place(0, tuner2, 'mzone'), place(0, lvl2, 'mzone')];
      place(1, N('Shiny Black "C"'), 'grave');
      if (moon) place(0, N('Book of Moon'), 'hand');
      c0.respond = whenChained('Shiny Black "C"', 'Book of Moon');
      c0.pick = (_g, req) => (req.candidates.includes(aa) ? [aa] : req.candidates.slice(0, req.min));
      await g.synchroSummon(0, aa, mats);
      eq(aa.location, moon ? 'mzone' : 'grave', moon ? 'face-down: not destroyed' : 'destroyed');
    }
  });

  // https://edisonrul.ing/cards/t/turbo-warrior.html
  await test('Turbo Warrior: no ATK halving against a face-down Synchro Monster', async () => {
    for (const faceDown of [false, true]) {
      const { g, place } = setup();
      const tw = place(0, N('Turbo Warrior'), 'mzone');
      const sd = place(1, N('Stardust Dragon'), 'mzone', faceDown ? { faceUp: false, pos: 'def' } : {});
      let atk = -1;
      const anim = g.anim.bind(g);
      g.anim = async (a: any) => {
        if (a.type === 'battle') atk = g.getAtk(sd);
        return anim(a);
      };
      await g.conductAttack(0, tw);
      eq(atk, faceDown ? 2500 : 1250, faceDown ? 'face-down at the attack: not halved' : 'halved');
    }
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-gyzarus.html, https://edisonrul.ing/cards/g/gladiator-beast-heraklinos.html
  await test('Gladiator Beast Gyzarus / Heraklinos: face-down materials can be used (revealed)', async () => {
    const { g, place } = setup();
    const best = place(0, N('Gladiator Beast Bestiari'), 'mzone', { faceUp: false, pos: 'def' });
    place(0, N('Gladiator Beast Secutor'), 'mzone');
    const gyz = place(0, N('Gladiator Beast Gyzarus'), 'extra');
    const act = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === gyz);
    eq(!!act, true, 'Gyzarus Contact Fusion available');
    await g.performAction(0, act!);
    eq(gyz.location, 'mzone', 'Gyzarus summoned');
    eq(best.location, 'deck', 'face-down Bestiari shuffled');

    const s = setup();
    s.place(0, N('Gladiator Beast Laquari'), 'mzone', { faceUp: false, pos: 'def' });
    s.place(0, N('Gladiator Beast Secutor'), 'mzone', { faceUp: false, pos: 'def' });
    s.place(0, N('Gladiator Beast Darius'), 'mzone');
    const her = s.place(0, N('Gladiator Beast Heraklinos'), 'extra');
    eq(s.g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === her), true, 'Heraklinos Contact Fusion available');
  });

  // https://edisonrul.ing/cards/g/gladiator-beast-darius.html
  await test('Gladiator Beast Darius: the negation and the shuffle end if Darius or its target is flipped face-down', async () => {
    const link = (darius: CardInstance, t: CardInstance) => {
      t.flags.gbSummoned = true;
      t.flags.dariusSrc = darius.uid;
      t.flags.dariusSrcMove = darius.moveId;
      t.flags.dariusSrcFace = darius.faceUpId;
    };
    const { g, place } = setup();
    const darius = place(0, N('Gladiator Beast Darius'), 'mzone');
    const laq = place(0, N('Gladiator Beast Laquari'), 'mzone');
    link(darius, laq);
    eq(g.isNegated(laq), true, 'negated while Darius is face-up');
    eq(g.getAtk(laq), 1800, 'Laquari stays at 1800');
    await g.changePosition(darius, 'def', false, 1);
    eq(g.isNegated(laq), false, 'Darius face-down: no longer negated');
    await g.changePosition(darius, 'atk', true, 0);
    eq(g.isNegated(laq), false, 'still not negated once Darius is face-up again');
    await g.destroy([darius], 'effect', 1);
    await g.processTriggers(false);
    eq(laq.location, 'mzone', 'not shuffled into the Deck when Darius leaves');

    const s = setup();
    const d2 = s.place(0, N('Gladiator Beast Darius'), 'mzone');
    const l2 = s.place(0, N('Gladiator Beast Laquari'), 'mzone');
    link(d2, l2);
    await s.g.changePosition(l2, 'def', false, 1);
    await s.g.changePosition(l2, 'atk', true, 0);
    eq(s.g.isNegated(l2), false, 'target flipped face-down and up: no longer negated');
    await s.g.destroy([d2], 'effect', 1);
    await s.g.processTriggers(false);
    eq(l2.location, 'mzone', 'not shuffled when Darius leaves');

    const t = setup();
    const d3 = t.place(0, N('Gladiator Beast Darius'), 'mzone');
    const l3 = t.place(0, N('Gladiator Beast Laquari'), 'mzone');
    link(d3, l3);
    await t.g.destroy([d3], 'effect', 1);
    await t.g.processTriggers(false);
    eq(l3.location, 'deck', 'control: shuffled when Darius leaves while linked');
  });

  // https://edisonrul.ing/cards/d/darksea-rescue.html, https://edisonrul.ing/cards/t/tuningware.html
  await test('Darksea Rescue / Tuningware: no draw when the Synchro Summon is negated (Solemn Judgment)', async () => {
    for (const solemn of [false, true]) {
      const { g, c1, place } = setup();
      const aa = place(0, N('Armory Arm'), 'extra');
      const tw = place(0, N('Tuningware'), 'mzone');
      const dr = place(0, N('Darksea Rescue'), 'mzone');
      if (solemn) place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
      c1.respond = respondWith('Solemn Judgment');
      const hand = g.players[0].hand.length;
      await g.synchroSummon(0, aa, [tw, dr]);
      eq(aa.location, solemn ? 'grave' : 'mzone', solemn ? 'Summon negated' : 'Synchro Summoned');
      eq(g.players[0].hand.length, hand + (solemn ? 0 : 2), solemn ? 'no draws' : 'both drew');
    }
  });

  // https://edisonrul.ing/cards/t/tuningware.html
  await test('Tuningware: cannot be treated as Level 2 while its effects are negated (Skill Drain)', async () => {
    for (const drain of [false, true]) {
      const { g, place } = setup();
      const aa = place(0, N('Armory Arm'), 'extra');
      place(0, N('Tuningware'), 'mzone');
      place(0, lvl2, 'mzone');
      if (drain) place(1, N('Skill Drain'), 'szone', { faceUp: true });
      eq(g.synchroCombos(0, aa).length > 0, !drain, drain ? 'Level 1 only: no Level 4 Synchro' : '2 + 2 = 4');
    }
  });

  // https://edisonrul.ing/cards/a/armory-arm.html
  await test('Armory Arm: destroyed if its equip target leaves the field before resolution', async () => {
    const { g, place } = setup();
    const aa = place(0, N('Armory Arm'), 'mzone');
    const t = place(0, brute, 'mzone');
    // the target leaves the field in response (just before the chain resolves)
    const anim = g.anim.bind(g);
    g.anim = async (a: any) => {
      if (a.type === 'resolve' && t.location === 'mzone') await g.sendToGrave([t], 'effect', 1);
      return anim(a);
    };
    await activate(g, 0, aa, 'Equip to a monster');
    eq(aa.location, 'grave', 'Armory Arm destroyed');
  });

  // https://edisonrul.ing/cards/k/kuribon.html
  await test('Kuribon: cannot be activated when you cannot take battle damage (Waboku)', async () => {
    for (const waboku of [false, true]) {
      const { g, c0, place } = setup();
      const kb = place(0, N('Kuribon'), 'mzone');
      const att = place(1, brute, 'mzone');
      g.turnPlayer = 1;
      if (waboku) g.addPlayerMod(0, 'noBattleDamage', true, 'turn');
      let offered = false;
      c0.respond = (gg, req) => {
        if (gg.battle?.inDamageStep && req.options.some((o) => o.card === kb)) offered = true;
        return null;
      };
      await g.conductAttack(1, att);
      eq(offered, !waboku, waboku ? 'not offered under Waboku' : 'offered');
    }
  });

  // https://edisonrul.ing/cards/n/nitro-warrior.html
  await test('Nitro Warrior: the second attack is only on the monster it changed to Attack Position, and only as the attacker', async () => {
    const { g, c0, place } = setup();
    const nw = place(0, N('Nitro Warrior'), 'mzone');
    const victim = place(1, weak, 'mzone');
    const def = place(1, wall, 'mzone', { pos: 'def' });
    const other = place(1, weak, 'mzone');
    c0.aim = victim;
    await g.conductAttack(0, nw);
    eq(victim.location, 'grave', 'destroyed by battle');
    eq(def.pos, 'atk', 'changed to Attack Position');
    eq(g.canAttack(nw), true, 'can attack again');
    const t = g.attackTargets(nw);
    eq(t.targets.length === 1 && t.targets[0] === def, true, 'only that monster can be attacked');
    eq(t.direct, false, 'no direct attack');
    void other;
    await g.changePosition(def, 'def', false, 1);
    eq(g.canAttack(nw), false, 'no second attack once it is face-down');

    const s = setup();
    const nw2 = s.place(0, N('Nitro Warrior'), 'mzone');
    s.place(0, wall, 'mzone', { pos: 'def' });
    s.place(0, wall, 'mzone', { pos: 'def' });
    const att = s.place(1, weak, 'mzone');
    s.place(1, wall, 'mzone', { pos: 'def' });
    s.g.turnPlayer = 1;
    s.c1.aim = nw2;
    await s.g.conductAttack(1, att);
    eq(att.location, 'grave', 'the attacker was destroyed by Nitro Warrior');
    eq(s.c0.triggersAsked.includes('Nitro Warrior'), false, 'no trigger when Nitro Warrior was attacked');
  });

  // https://edisonrul.ing/cards/b/battle-teleportation.html
  await test('Battle Teleportation: not while you cannot conduct your Battle Phase', async () => {
    for (const locked of [false, true]) {
      const { g, place } = setup();
      const bt = place(0, N('Battle Teleportation'), 'szone', { faceUp: false });
      place(0, psychic, 'mzone');
      if (locked) g.addPlayerMod(0, 'cannotDeclareAttack', true, 'turn');
      eq(canActivate(g, 0, bt), !locked, locked ? 'cannot be activated' : 'can be activated');
    }
  });

  // https://edisonrul.ing/cards/f/fairy-wind.html
  await test('Fairy Wind: a chained Heavy Storm does not count as a face-up Spell/Trap', async () => {
    for (const other of [false, true]) {
      const { g, c1, place } = setup();
      const hs = place(0, N('Heavy Storm'), 'hand');
      place(1, N('Fairy Wind'), 'szone', { faceUp: false });
      if (other) place(0, N('Skill Drain'), 'szone', { faceUp: true });
      let offered = false;
      c1.respond = (gg, req) => {
        if (gg.chain.some((l) => l.card === hs) && req.options.some((o) => o.card.name === 'Fairy Wind')) offered = true;
        return null;
      };
      await activate(g, 0, hs);
      eq(offered, other, other ? 'another face-up card: offered' : 'only Heavy Storm: not offered');
    }
  });

  // https://edisonrul.ing/cards/e/earthbound-immortal-chacu-challhua.html
  await test('Earthbound Immortal Chacu Challhua: changed to Defense Position during the Battle Phase, the Battle Phase continues', async () => {
    const { g, place } = setup();
    place(0, N('Ancient Forest'), 'fzone');
    place(0, N('Earthbound Immortal Chacu Challhua'), 'mzone', { pos: 'def' });
    g.turnPlayer = 1;
    eq(g.queryPlayer(1, 'cannotDeclareAttack'), true, 'cannot enter the Battle Phase');
    g.phase = 'battle';
    eq(g.queryPlayer(1, 'cannotDeclareAttack'), false, 'already in the Battle Phase: it continues');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-speeder.html
  await test("Koa'ki Meiru Speeder: revealing Iron Core is the cost (done on activation)", async () => {
    const { g, place } = setup();
    place(0, N("Koa'ki Meiru Speeder"), 'mzone');
    const core = place(0, N("Iron Core of Koa'ki Meiru"), 'deck');
    g.phase = 'draw';
    let revealedAtResolve: boolean | null = null;
    const anim = g.anim.bind(g);
    g.anim = async (a: any) => {
      if (a.type === 'resolve' && revealedAtResolve === null) revealedAtResolve = core.revealedUntil === g.turn;
      return anim(a);
    };
    const hand = g.players[0].hand.length;
    await g.draw(0, 1);
    await g.processTriggers(false);
    eq(revealedAtResolve, true, 'revealed before the effect resolves');
    eq(g.players[0].hand.length, hand + 2, 'drew 1 more');
  });

  // https://edisonrul.ing/cards/e/emergency-assistance.html
  await test('Emergency Assistance: a monster destroyed in the hand by a card effect can be Special Summoned', async () => {
    const { g, place } = setup();
    const ea = place(0, N('Emergency Assistance'), 'hand');
    const m = place(0, brute, 'hand');
    await g.moveCards([m], 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], reasonPlayer: 1, destroyed: true });
    g.phase = 'main2';
    eq(canActivate(g, 0, ea), true, 'can be activated');
    await activate(g, 0, ea);
    eq(m.location, 'mzone', 'Special Summoned');
  });

  report();
})();
