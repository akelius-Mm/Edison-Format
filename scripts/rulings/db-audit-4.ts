// Rulings DB audit, group 4 (CSOC / GLAS): each test pins a behaviour to the 2010 TCG rulings on edisonrul.ing
// (Edisonformat.com historical section).
// Usage: npx tsx scripts/rulings/db-audit-4.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { Activation } from '../../src/engine/controller';
import type { PlayerId } from '../../src/engine/types';
import { activate, eq, newGame, report, respondWith, test } from '../lib/harness';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  hitter: findCard('DB4 Hitter') ?? normal('DB4 Hitter', 'EARTH', 'Warrior', 4, 1000, 2000),
  small: findCard('DB4 Small') ?? normal('DB4 Small', 'EARTH', 'Warrior', 4, 800, 1000),
  psy3: findCard('DB4 Psychic') ?? normal('DB4 Psychic', 'EARTH', 'Psychic', 3, 1000, 1000),
  plant: findCard('DB4 Plant') ?? normal('DB4 Plant', 'EARTH', 'Plant', 4, 1500, 1000),
};
const N = (n: string) => cardByName(n);
const setup = () => newGame(T.wall);

(async () => {
  console.log('Rulings DB audit: group 4 (CSOC / GLAS)');

  // https://edisonrul.ing/cards/u/urgent-tuning.html
  await test('Urgent Tuning: the Synchro Summon happens while Urgent Tuning resolves, not after the Chain', async () => {
    const { g, place } = setup();
    g.phase = 'battle';
    place(0, N('Krebons'), 'mzone');
    place(0, T.psy3, 'mzone');
    const an = place(0, N('Magical Android'), 'extra');
    const ut = place(0, N('Urgent Tuning'), 'szone', { faceUp: false });
    let during: string | undefined;
    const orig = g.inherentSpecialSummon.bind(g);
    g.inherentSpecialSummon = async (...args: Parameters<typeof g.inherentSpecialSummon>) => {
      if (args[1] === an) during = g.resolvingLink?.card.name;
      return orig(...args);
    };
    await activate(g, 0, ut);
    eq(during, 'Urgent Tuning', 'summoned inside the Urgent Tuning Chain Link');
    eq(an.location, 'mzone', 'Synchro Summoned');
  });

  // https://edisonrul.ing/cards/m/mark-of-the-rose.html
  await test('Mark of the Rose: a host flipped face-down stays with its current controller', async () => {
    const { g, place } = setup();
    place(0, T.plant, 'grave');
    const v = place(1, T.brute, 'mzone');
    const mark = place(0, N('Mark of the Rose'), 'hand');
    await activate(g, 0, mark);
    eq(v.controller, 0, 'control taken');
    await g.setFaceDown(v);
    eq(mark.location, 'grave', 'Mark of the Rose destroyed (no face-up host)');
    eq(v.controller, 0, 'the face-down monster stays on its current controller\'s side');
  });

  // https://edisonrul.ing/cards/a/alien-hypno.html
  for (const which of ['Alien Hypno', 'the taken monster'] as const) {
    await test(`Alien Hypno: control returns when ${which} is flipped face-down`, async () => {
      const { g, place } = setup();
      const hypno = place(0, N('Alien Hypno'), 'mzone');
      hypno.flags.geminiSummoned = true;
      const v = place(1, T.brute, 'mzone');
      v.counters.A = 2;
      await activate(g, 0, hypno, 'Take control of a monster with an A-Counter');
      eq(v.controller, 0, 'control taken');
      await g.setFaceDown(which === 'Alien Hypno' ? hypno : v);
      eq(v.controller, 1, 'returned to the opponent');
    });
  }

  // https://edisonrul.ing/cards/t/turbo-synchron.html
  for (const changePos of [false, true]) {
    await test(`Turbo Synchron: ${changePos ? 'survives the battle: can Special Summon' : 'destroyed by battle: cannot Special Summon'}`, async () => {
      const { g, c0, place } = setup();
      g.phase = 'battle';
      const turbo = place(0, N('Turbo Synchron'), 'mzone');
      const foe = place(1, T.hitter, 'mzone');
      const inHand = place(0, T.small, 'hand');
      c0.aim = foe;
      const labels: string[] = [];
      c0.trigger = (act: Activation) => {
        labels.push(act.label ?? '');
        return act.label === 'Change the attack target to Defense Position' ? changePos : true;
      };
      await g.conductAttack(0, turbo);
      if (changePos) {
        eq(g.players[0].lp, 8000 - 1900, 'took 1900 (DEF 2000)');
        eq(inHand.location, 'mzone', 'Special Summoned');
        eq(turbo.location, 'mzone', 'Turbo Synchron survived');
      } else {
        eq(g.players[0].lp, 8000 - 900, 'took 900');
        eq(labels.includes('Special Summon a monster from your hand'), false, 'effect not offered');
        eq(inHand.location, 'hand', 'nothing Summoned');
        eq(turbo.location, 'grave', 'Turbo Synchron destroyed');
      }
    });
  }

  // https://edisonrul.ing/cards/b/battle-mania.html
  await test('Battle Mania: with a face-up Attack Position monster, the opponent must conduct the Battle Phase', async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    g.turn = 3;
    g.phase = 'standby';
    const m = place(1, T.brute, 'mzone', { pos: 'def' });
    const bm = place(0, N('Battle Mania'), 'szone', { faceUp: false });
    await activate(g, 0, bm);
    eq(m.pos, 'atk', 'changed to Attack Position');
    g.phase = 'main1';
    const acts = g.legalMainActions(1);
    eq(acts.some((a) => a.type === 'phase' && a.to === 'battle'), true, 'can go to the Battle Phase');
    eq(acts.some((a) => a.type === 'phase' && a.to === 'end'), false, 'cannot skip to the End Phase');
    // a later turn is not affected
    g.turn = 5;
    eq(g.legalMainActions(1).some((a) => a.type === 'phase' && a.to === 'end'), true, 'next turn: free again');
  });

  // https://edisonrul.ing/cards/m/miracle-fertilizer.html
  await test('Miracle Fertilizer: destroyed when any monster it Summoned leaves the field, not only the latest', async () => {
    const { g, place } = setup();
    const mf = place(0, N('Miracle Fertilizer'), 'szone', { faceUp: true });
    const a = place(0, T.plant, 'grave');
    const b = place(0, T.plant, 'grave');
    await activate(g, 0, mf, 'Special Summon a Plant-Type monster from the GY');
    const first = a.location === 'mzone' ? a : b;
    eq(first.location, 'mzone', 'first Plant Summoned');
    g.turn += 2;
    await activate(g, 0, mf, 'Special Summon a Plant-Type monster from the GY');
    eq(a.location === 'mzone' && b.location === 'mzone', true, 'second Plant Summoned');
    await g.banish([first], 'effect', 1);
    eq(mf.location, 'grave', 'Miracle Fertilizer destroyed');
  });

  // https://edisonrul.ing/cards/g/gigantic-cephalotus.html
  await test('Gigantic Cephalotus: only destroyed Plant-Type monsters count; text is the 2010 printing', async () => {
    const { g, place } = setup();
    const ceph = place(0, N('Gigantic Cephalotus'), 'mzone');
    eq(ceph.data.text, 'Each time a Plant-Type monster is destroyed and sent to the Graveyard, this card gains 200 ATK.', 'text');
    const p1 = place(1, T.plant, 'mzone');
    await g.sendToGrave([p1], 'effect', 0);
    eq(g.getAtk(ceph), 1850, 'a Plant sent to the GY without being destroyed does not count');
    const p2 = place(1, T.plant, 'mzone');
    await g.destroy([p2], 'effect', 0);
    eq(g.getAtk(ceph), 2050, 'a destroyed Plant counts');
    const w = place(1, T.brute, 'mzone');
    await g.destroy([w], 'effect', 0);
    eq(g.getAtk(ceph), 2050, 'a non-Plant does not count');
  });

  // https://edisonrul.ing/cards/g/gigantic-cephalotus.html
  await test('Gigantic Cephalotus: ATK gained is lost under Skill Drain and not regained when Skill Drain leaves', async () => {
    const { g, place } = setup();
    const ceph = place(0, N('Gigantic Cephalotus'), 'mzone');
    const p = place(1, T.plant, 'mzone');
    await g.destroy([p], 'effect', 0);
    eq(g.getAtk(ceph), 2050, 'gained 200');
    const sd = place(1, N('Skill Drain'), 'szone', { faceUp: true });
    await g.ruleCleanup();
    eq(g.getAtk(ceph), 1850, 'negated');
    await g.destroy([sd], 'effect', 0);
    eq(g.getAtk(ceph), 1850, 'not regained');
  });

  // https://edisonrul.ing/cards/p/plant-food-chain.html
  await test('Plant Food Chain: does not miss timing when other things happen after it is destroyed', async () => {
    const { g, place } = setup();
    place(0, T.plant, 'mzone');
    const target = place(0, T.plant, 'grave');
    const pfc = place(0, N('Plant Food Chain'), 'szone', { faceUp: false });
    await activate(g, 0, pfc);
    eq(pfc.onField && pfc.faceUp, true, 'equipped');
    const other = place(1, T.brute, 'mzone');
    await g.destroy([pfc], 'effect', 1);
    await g.destroy([other], 'effect', 0); // the destruction is no longer the last thing that happened
    await g.processTriggers(true);
    eq(target.location, 'mzone', 'Plant Special Summoned');
  });

  // https://edisonrul.ing/cards/c/confusion-chaff.html
  await test('Confusion Chaff: a direct attack that was negated is not the first direct attack', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1 as PlayerId;
    g.phase = 'battle';
    const first = place(1, T.brute, 'mzone');
    const second = place(1, T.hitter, 'mzone');
    place(0, N('Negate Attack'), 'szone', { faceUp: false });
    place(0, N('Confusion Chaff'), 'szone', { faceUp: false });
    let offered = false;
    c0.respond = (gg, req) => {
      if (req.options.some((o) => o.card.name === 'Confusion Chaff')) offered = true;
      return gg.battle?.attacker === first ? respondWith('Negate Attack')(gg, req) : null;
    };
    await g.conductAttack(1, first);
    eq(g.players[0].lp, 8000, 'first attack negated');
    await g.conductAttack(1, second);
    eq(offered, false, 'Confusion Chaff not offered');
    eq(g.players[0].lp, 7000, 'second direct attack hits');
  });

  report();
})();
