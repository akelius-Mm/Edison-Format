// Rulings regression tests for the database audit, group 6 (ptdn, sabers, sdmm, spells).
// Usage: npx tsx scripts/rulings/db-audit-6.ts
import '../../src/cards';
import { cardByName } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardInstance } from '../../src/engine/card';
import type { Game } from '../../src/engine/game';
import type { ResponseRequest, SelectRequest } from '../../src/engine/controller';
import { activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const N = cardByName;
const wall = normal('G6 Wall', 'EARTH', 'Rock', 4, 500, 2000);
const reptile = normal('G6 Reptile', 'EARTH', 'Reptile', 4, 1200, 1000);
const darkMon = normal('G6 Shade', 'DARK', 'Fiend', 4, 1600, 1200);
const darkBig = normal('G6 Dark Lord', 'DARK', 'Fiend', 5, 2100, 1000);
const small = normal('G6 Imp', 'EARTH', 'Fiend', 3, 1000, 1000);
const mid = normal('G6 Knight', 'EARTH', 'Warrior', 4, 2000, 1000);

/** A picker that prefers the listed cards (in order) whenever they are candidates. */
const prefer = (...cards: CardInstance[]) => (_g: Game, req: SelectRequest) => {
  const out = cards.filter((c) => req.candidates.includes(c)).slice(0, Math.max(req.min, 1));
  return out.length >= req.min ? out.slice(0, req.max) : req.candidates.slice(0, req.min);
};
/** A responder that activates each named card at most once, in the order offered. */
const respondOnce = (...names: string[]) => {
  const used = new Set<string>();
  return (_g: Game, req: ResponseRequest) => {
    const o = req.options.find((x) => names.includes(x.card.name) && !used.has(x.card.name));
    if (o) used.add(o.card.name);
    return o ?? null;
  };
};

(async () => {
  console.log('Rulings tests (database audit, group 6)');

  // https://edisonrul.ing/cards/o/offering-to-the-snake-deity.html
  await test('Offering to the Snake Deity: if a chained effect removes 1 target from the field, nothing is destroyed', async () => {
    const { g, c0, c1, place } = newGame(wall);
    const rep = place(0, reptile, 'mzone');
    const a = place(1, wall, 'mzone');
    const b = place(1, mid, 'mzone');
    const off = place(0, N('Offering to the Snake Deity'), 'szone', { faceUp: false });
    place(1, N('Compulsory Evacuation Device'), 'szone', { faceUp: false });
    c0.pick = prefer(rep, a, b);
    c1.pick = prefer(a);
    c1.respond = respondWith('Compulsory Evacuation Device');
    await activate(g, 0, off);
    eq(a.location, 'hand', 'target bounced by the chained trap');
    eq(rep.location, 'mzone', 'Reptile not destroyed');
    eq(b.location, 'mzone', 'other target not destroyed');
  });

  // https://edisonrul.ing/cards/o/offering-to-the-snake-deity.html
  await test('Offering to the Snake Deity: with all 3 targets still there, all 3 are destroyed', async () => {
    const { g, c0, place } = newGame(wall);
    const rep = place(0, reptile, 'mzone');
    const a = place(1, wall, 'mzone');
    const b = place(1, mid, 'mzone');
    const off = place(0, N('Offering to the Snake Deity'), 'szone', { faceUp: false });
    c0.pick = prefer(rep, a, b);
    await activate(g, 0, off);
    eq([rep, a, b].every((c) => c.location === 'grave'), true, 'all destroyed');
  });

  // https://edisonrul.ing/cards/p/prime-material-dragon.html
  await test('Prime Material Dragon: cannot answer Heavy Storm, but can answer Smashing Ground', async () => {
    const { g, c0, place } = newGame(wall);
    const pmd = place(0, N('Prime Material Dragon'), 'mzone');
    place(0, wall, 'hand');
    place(0, N('Mirror Force'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    let offered = false;
    c0.respond = (_g, req) => {
      if (req.options.some((o) => o.card === pmd)) offered = true;
      return null;
    };
    const hs = place(1, N('Heavy Storm'), 'hand');
    await activate(g, 1, hs);
    eq(offered, false, 'not offered against Heavy Storm');
    const sg = place(1, N('Smashing Ground'), 'hand');
    await activate(g, 1, sg);
    eq(offered, true, 'offered against Smashing Ground');
  });

  // https://edisonrul.ing/cards/c/cold-wave.html
  await test('Cold Wave: the effects of face-up Spell Cards (Mass Driver) cannot be activated either', async () => {
    const { g, place } = newGame(wall);
    place(0, wall, 'mzone');
    const md = place(0, N('Mass Driver'), 'szone', { faceUp: true });
    eq(canActivate(g, 0, md, 'Tribute: 400 damage'), true, 'usable before Cold Wave');
    const cw = place(0, N('Cold Wave'), 'hand');
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'main1', turnPlayer: 0 });
    await activate(g, 0, cw);
    eq(canActivate(g, 0, md, 'Tribute: 400 damage'), false, 'blocked by Cold Wave');
  });

  // https://edisonrul.ing/cards/s/secret-village-of-the-spellcasters.html (the engine key Cold Wave now adds is separate)
  await test('Cold Wave: Secret Village of the Spellcasters still lets you activate face-up Spell effects', async () => {
    const { g, place } = newGame(wall);
    place(0, wall, 'mzone');
    place(0, N('Secret Village of the Spellcasters'), 'fzone', { faceUp: true });
    const md = place(0, N('Mass Driver'), 'szone', { faceUp: true });
    eq(g.queryPlayer(0, 'cannotActivateSpells'), true, 'Spell Cards locked');
    eq(canActivate(g, 0, md, 'Tribute: 400 damage'), true, 'Mass Driver effect still usable');
  });

  // https://edisonrul.ing/cards/o/obsidian-dragon.html
  await test('Obsidian Dragon: an Equip Spell already equipped to your DARK monster is destroyed when it arrives', async () => {
    const { g, c0, place } = newGame(wall);
    const host = place(0, darkMon, 'mzone');
    const axe = place(0, N('Axe of Despair'), 'szone', { faceUp: true });
    g.equip(axe, host);
    const obs = place(0, N('Obsidian Dragon'), 'grave');
    const mr = place(0, N('Monster Reborn'), 'hand');
    c0.pick = prefer(obs);
    c0.trigger = () => false; // (Axe of Despair's GY effect)
    await activate(g, 0, mr);
    eq(obs.location, 'mzone', 'Obsidian Dragon revived');
    eq(axe.location, 'grave', 'Axe of Despair destroyed');
  });

  // https://edisonrul.ing/cards/o/obsidian-dragon.html
  await test('Obsidian Dragon: Snatch Steal on a DARK monster is destroyed and the monster goes back; Brain Control is not stopped', async () => {
    const { g, c0, place } = newGame(wall);
    place(0, N('Obsidian Dragon'), 'mzone', { pos: 'def' });
    const d1 = place(1, darkMon, 'mzone');
    const d2 = place(1, darkBig, 'mzone');
    const ss = place(0, N('Snatch Steal'), 'hand');
    c0.pick = prefer(d1);
    await activate(g, 0, ss);
    eq(ss.location, 'grave', 'Snatch Steal destroyed');
    eq(d1.controller, 1, 'the monster went back');
    const bc = place(0, N('Brain Control'), 'hand');
    c0.pick = prefer(d2);
    await activate(g, 0, bc);
    eq(d2.controller, 0, 'Brain Control took the DARK monster');
  });

  // https://edisonrul.ing/cards/s/soul-exchange.html
  await test('Soul Exchange: the target can also be Tributed as a cost (Mass Driver)', async () => {
    const { g, c0, place } = newGame(wall);
    const md = place(0, N('Mass Driver'), 'szone', { faceUp: true });
    const t = place(1, mid, 'mzone');
    const se = place(0, N('Soul Exchange'), 'hand');
    c0.pick = prefer(t);
    await activate(g, 0, se);
    eq(canActivate(g, 0, md, 'Tribute: 400 damage'), true, 'Mass Driver usable with no monster of your own');
    await activate(g, 0, md, 'Tribute: 400 damage');
    eq(t.location, 'grave', "opponent's monster Tributed");
    eq(g.players[1].lp, 7600, '400 damage');
  });

  // https://edisonrul.ing/cards/m/magic-planter.html
  await test('Magic Planter: a face-up Trap Monster (Metal Reflect Slime) can be sent as the cost', async () => {
    const { g, place } = newGame(wall);
    const slime = place(0, N('Metal Reflect Slime'), 'szone', { faceUp: false });
    await activate(g, 0, slime);
    eq(slime.location, 'mzone', 'Trap Monster Summoned');
    const mp = place(0, N('Magic Planter'), 'hand');
    const hand = g.players[0].hand.length;
    await activate(g, 0, mp);
    eq(slime.location, 'grave', 'Trap Monster sent');
    eq(g.players[0].hand.length, hand - 1 + 2, 'drew 2');
  });

  // https://edisonrul.ing/cards/f/future-fusion.html
  await test('Future Fusion: cannot reveal a Contact Fusion (Gladiator Beast Gyzarus)', async () => {
    const { g, place } = newGame(wall);
    place(0, N('Gladiator Beast Gyzarus'), 'extra');
    place(0, N('Gladiator Beast Bestiari'), 'deck');
    place(0, N('Gladiator Beast Laquari'), 'deck');
    const ff = place(0, N('Future Fusion'), 'hand');
    eq(canActivate(g, 0, ff), false, 'no legal Fusion Monster to reveal');
    place(0, N('Elemental Hero Flame Wingman'), 'extra');
    place(0, N('Elemental Hero Avian'), 'deck');
    place(0, N('Elemental Hero Burstinatrix'), 'deck');
    eq(canActivate(g, 0, ff), true, 'a Polymerization Fusion can be revealed');
  });

  // https://edisonrul.ing/cards/x/xx-saber-faultroll.html
  await test('XX-Saber Faultroll: cannot be Special Summoned from the GY, even after a proper Summon', async () => {
    const { g, place } = newGame(wall);
    const f = place(0, N('XX-Saber Faultroll'), 'grave');
    (f as any).properlySummoned = true;
    const r = await g.specialSummon([f], 0, {});
    eq(r.length, 0, 'not Summoned');
    eq(f.location, 'grave', 'still in the GY');
    eq(canActivate(g, 0, place(0, N('Monster Reborn'), 'hand')), false, 'Monster Reborn has no target');
  });

  // https://edisonrul.ing/cards/s/shrink.html
  await test('Shrink vs Megamorph: the one that resolved last applies (Shrink last)', async () => {
    const { g, c0, place } = newGame(wall);
    g.players[0].lp = 4000;
    const m = place(0, mid, 'mzone');
    c0.pick = prefer(m);
    await activate(g, 0, place(0, N('Megamorph'), 'hand'));
    eq(g.getAtk(m), 4000, 'Megamorph doubles');
    await activate(g, 0, place(0, N('Shrink'), 'hand'));
    eq(g.getAtk(m), 1000, 'Shrink resolved last: half the original ATK');
  });

  // https://edisonrul.ing/cards/s/shrink.html
  await test('Shrink vs Megamorph: the one that resolved last applies (Megamorph last)', async () => {
    const { g, c0, place } = newGame(wall);
    g.players[0].lp = 4000;
    const m = place(0, mid, 'mzone');
    c0.pick = prefer(m);
    await activate(g, 0, place(0, N('Shrink'), 'hand'));
    eq(g.getAtk(m), 1000, 'Shrink halves');
    await activate(g, 0, place(0, N('Megamorph'), 'hand'));
    eq(g.getAtk(m), 4000, 'Megamorph resolved last: double the original ATK');
  });

  // https://edisonrul.ing/cards/g/giant-trunade.html (Revised section; the historical one has no rulings)
  await test('Giant Trunade: a Quick-Play Spell chained to it is not returned to the hand', async () => {
    const { g, c0, c1, place } = newGame(wall);
    const mine = place(0, N('Mirror Force'), 'szone', { faceUp: false });
    const mst = place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    const other = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    const gt = place(0, N('Giant Trunade'), 'hand');
    c1.pick = prefer(mine);
    c1.respond = respondOnce('Mystical Space Typhoon');
    c0.respond = () => null;
    await activate(g, 0, gt);
    eq(mine.location, 'grave', 'MST destroyed its target');
    eq(mst.location, 'grave', 'the chained MST goes to the GY, not the hand');
    eq(other.location, 'hand', 'the other Set card is returned');
  });

  // https://edisonrul.ing/cards/m/metabo-globster.html (Revised section; the historical one has no rulings)
  await test('Metabo Globster: no tokens when Tributed face-down, or for a Tribute Set', async () => {
    {
      const { g, place } = newGame(wall);
      place(0, N('Metabo Globster'), 'mzone', { faceUp: false, pos: 'def' });
      const lord = place(0, darkBig, 'hand');
      await g.normalSummon(0, lord, false);
      eq(lord.location, 'mzone', 'Tribute Summoned');
      eq(g.monsters(0).filter((c) => c.isToken).length, 0, 'face-down: no tokens');
    }
    {
      const { g, place } = newGame(wall);
      place(0, N('Metabo Globster'), 'mzone');
      const lord = place(0, darkBig, 'hand');
      await g.normalSummon(0, lord, true);
      eq(lord.location, 'mzone', 'Tribute Set');
      eq(g.monsters(0).filter((c) => c.isToken).length, 0, 'Tribute Set: no tokens');
    }
    {
      const { g, place } = newGame(wall);
      place(0, N('Metabo Globster'), 'mzone');
      const lord = place(0, darkBig, 'hand');
      await g.normalSummon(0, lord, false);
      eq(g.monsters(0).filter((c) => c.isToken).length, 3, 'face-up, Tribute Summon of a DARK monster: 3 tokens');
    }
  });

  // https://edisonrul.ing/cards/i/inferno-reckless-summon.html
  await test('Inferno Reckless Summon: disappears when your monster and the only face-up opposing monster are both gone', async () => {
    const { g, c0, c1, place } = newGame(wall);
    const mine = place(0, small, 'grave');
    const copy = place(0, small, 'deck');
    const theirs = place(1, mid, 'mzone');
    const theirCopy = place(1, mid, 'deck');
    place(0, N('Inferno Reckless Summon'), 'hand');
    place(0, N('Book of Moon'), 'szone', { faceUp: false });
    place(1, N('Compulsory Evacuation Device'), 'szone', { faceUp: false });
    c0.pick = (gg, req) => (req.candidates.includes(theirs) && req.candidates.includes(mine) ? [theirs] : prefer(mine)(gg, req));
    c1.pick = prefer(mine);
    // You activate Inferno Reckless Summon; the opponent bounces your monster, you flip theirs face-down.
    const top = (gg: Game) => gg.chain[gg.chain.length - 1]?.card.name;
    const r0 = respondOnce('Inferno Reckless Summon', 'Book of Moon');
    const r1 = respondOnce('Compulsory Evacuation Device');
    c0.respond = (gg, req) => (top(gg) === undefined || top(gg) === 'Compulsory Evacuation Device' ? r0(gg, req) : null);
    c1.respond = (gg, req) => (top(gg) === 'Inferno Reckless Summon' ? r1(gg, req) : null);
    await activate(g, 0, place(0, N('Monster Reborn'), 'hand'));
    eq(mine.location, 'hand', 'your monster bounced');
    eq(theirs.faceUp, false, 'their monster flipped face-down');
    eq(copy.location, 'deck', 'no copies Summoned');
    eq(theirCopy.location, 'deck', 'no opposing copies Summoned');
  });

  // https://edisonrul.ing/cards/c/chain-material.html
  await test('Chain Material: using it for a Fusion Summon is optional', async () => {
    for (const use of [false, true]) {
      const { g, c0, place } = newGame(wall);
      place(0, N('Elemental Hero Flame Wingman'), 'extra');
      const av = place(0, N('Elemental Hero Avian'), 'hand');
      const bu = place(0, N('Elemental Hero Burstinatrix'), 'hand');
      await activate(g, 0, place(0, N('Chain Material'), 'szone', { faceUp: false }));
      c0.pick = prefer(av, bu);
      c0.yes = () => use;
      await activate(g, 0, place(0, N('Polymerization'), 'hand'));
      const want = use ? 'banished' : 'grave';
      eq(av.location, want, `Avian (${use ? 'used' : 'not used'})`);
      eq(bu.location, want, `Burstinatrix (${use ? 'used' : 'not used'})`);
    }
  });

  // https://edisonrul.ing/cards/x/x-saber-galahad.html (Revised section; the historical one has no text or rulings)
  await test('X-Saber Galahad: when targeted for an attack, Tribute 1 other "Saber" monster to negate the attack', async () => {
    const { g, c1, place } = newGame(wall);
    const gal = place(0, N('X-Saber Galahad'), 'mzone');
    const air = place(0, N('X-Saber Airbellum'), 'mzone');
    g.turnPlayer = 1;
    g.phase = 'battle';
    const atk = place(1, darkBig, 'mzone');
    c1.aim = gal;
    await g.conductAttack(1, atk);
    eq(air.location, 'grave', 'Airbellum Tributed');
    eq(gal.location, 'mzone', 'Galahad survives');
    eq(g.players[0].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/d/dark-horus.html
  await test('Dark Horus: revives a Level 4 DARK monster after the opponent resolves a Spell; it chooses on resolution', async () => {
    const { g, place } = newGame(wall);
    const horus = place(0, N('Dark Horus'), 'mzone');
    const dead = place(0, darkMon, 'grave');
    g.turnPlayer = 1;
    await activate(g, 1, place(1, N('Pot of Greed'), 'hand'));
    eq(horus.location, 'mzone', 'Horus on the field');
    eq(dead.location, 'mzone', 'DARK monster revived');
  });

  report();
})();
