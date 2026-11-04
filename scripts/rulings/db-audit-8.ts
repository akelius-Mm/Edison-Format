// Rulings regression tests, audit group 8 (SOVR, Zombies, tournament extras 2, GY banish costs): each test pins a
// behaviour to the 2010 TCG rulings on edisonrul.ing (Edisonformat.com historical section).
// Usage: npx tsx scripts/rulings/db-audit-8.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import { GY_BANISH_COST_PROBLEMS } from '../../src/cards/gy-costs';
import type { CardInstance } from '../../src/engine/card';
import type { ChainLink, Game } from '../../src/engine/game';
import type { GameEvent, PlayerId } from '../../src/engine/types';
import { TestController, activate, canActivate, eq, newGame, report, test } from '../lib/harness';

const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  zero: findCard('Audit8 Zero') ?? normal('Audit8 Zero', 'EARTH', 'Rock', 4, 0, 1000),
  weak: findCard('Audit8 Weak') ?? normal('Audit8 Weak', 'EARTH', 'Warrior', 3, 500, 500),
  big: findCard('Audit8 Big') ?? normal('Audit8 Big', 'EARTH', 'Warrior', 4, 2600, 1000),
  beast: findCard('Audit8 Beast') ?? normal('Audit8 Beast', 'EARTH', 'Beast', 4, 1000, 1000),
  reptile: findCard('Audit8 Reptile') ?? normal('Audit8 Reptile', 'EARTH', 'Reptile', 4, 1000, 1000),
  water: findCard('Audit8 Water') ?? normal('Audit8 Water', 'WATER', 'Aqua', 4, 1000, 1000),
  fire: findCard('Audit8 Fire') ?? normal('Audit8 Fire', 'FIRE', 'Pyro', 4, 1000, 1000),
  zombie: findCard('Audit8 Zombie') ?? normal('Audit8 Zombie', 'DARK', 'Zombie', 4, 1000, 1000),
  machine: findCard('Audit8 Machine') ?? normal('Audit8 Machine', 'EARTH', 'Machine', 4, 1800, 1000),
};
const N = (n: string) => cardByName(n);
const setup = () => newGame(T.wall);
/** A face-up Spell/Trap that already resolved. */
const live = (c: CardInstance) => {
  c.faceUp = true;
  c.activeOnField = true;
  return c;
};
const linksOf = (g: Game, card: CardInstance): ChainLink[] =>
  g.eventLog.filter((e: GameEvent) => e.type === 'chainActivated' && (e.data?.link as ChainLink | undefined)?.card === card).map((e) => e.data.link as ChainLink);
const phase = async (g: Game, p: PlayerId, ph: 'standby' | 'end') => {
  g.turnPlayer = p;
  g.phase = ph;
  g.beginBatch();
  g.emit({ type: 'phaseStart', phase: ph, player: p } as any);
  await g.processTriggers(true);
  g.phase = 'main1';
};
const pickOnly = (c: TestController, want: CardInstance[]) => {
  c.pick = (_g, req) => {
    const w = req.candidates.filter((x) => want.includes(x));
    return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
  };
};
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
const gyCost = (name: string, i: number) => !!N(name).effects?.[i]?.gyBanishCost;

(async () => {
  console.log('Rulings: audit group 8');

  // ---------------------------------------------------------------- GY banish costs
  // https://edisonrul.ing/cards/c/catoblepas-and-the-witch-of-fate.html, r/reptilianne-spawn, y/yellow-baboon-archer-of-the-forest,
  // i/insect-neglect, r/ritual-of-grace, b/batteryman-industrial-strength, k/kycoo-the-ghost-destroyer
  await test('Catoblepas / Reptilianne Spawn / Yellow Baboon / Insect Neglect / Ritual of Grace / Batteryman IS / Maniacal Servant / D - Fortune: GY banish costs', async () => {
    eq(GY_BANISH_COST_PROBLEMS.join('; '), '', 'table resolves');
    for (const [n, i] of [
      ['Catoblepas and the Witch of Fate', 0],
      ['Reptilianne Spawn', 0],
      ['Yellow Baboon, Archer of the Forest', 0],
      ['Insect Neglect', 1],
      ['Ritual of Grace', 1],
      ['Batteryman Industrial Strength', 0],
      ['Batteryman Industrial Strength', 1],
      ['Maniacal Servant', 0],
      ['D - Fortune', 0],
    ] as [string, number][])
      eq(gyCost(n, i), true, `${n} [${i}]`);
    eq(gyCost('Insect Neglect', 0), false, 'Insect Neglect card activation is not a cost');
  });

  // https://edisonrul.ing/cards/b/batteryman-industrial-strength.html + https://edisonrul.ing/cards/k/kycoo-the-ghost-destroyer.html
  await test('Batteryman Industrial Strength: its Summon procedure cannot be used while the opponent controls Kycoo', async () => {
    const { g, place } = setup();
    const bis = place(0, N('Batteryman Industrial Strength'), 'hand');
    place(0, N('Batteryman Charger'), 'grave');
    place(0, N('Batteryman Micro-Cell'), 'grave');
    const proc = bis.data.effects![0];
    eq(g.canProc(0, bis, proc, 0), true, 'usable without Kycoo');
    place(1, N('Kycoo the Ghost Destroyer'), 'mzone');
    eq(g.canProc(0, bis, proc, 0), false, 'not under Kycoo');
  });

  // https://edisonrul.ing/cards/s/shutendoji.html
  await test('Shutendoji: under Necrovalley the draw mode is unusable, the deck-top mode still works', async () => {
    const { g, place } = setup();
    const sh = place(0, N('Shutendoji'), 'mzone');
    place(0, T.zombie, 'grave');
    place(0, T.zombie, 'grave');
    live(place(1, N('Necrovalley'), 'fzone'));
    eq(canActivate(g, 0, sh), false, 'only the GY-banish mode is available: not offered');
    const ban = place(0, T.zombie, 'banished');
    eq(canActivate(g, 0, sh), true, 'a banished Zombie: offered');
    const hand = g.players[0].hand.length;
    await activate(g, 0, sh);
    eq(ban.location, 'deck', 'placed on top of the Deck');
    eq(g.players[0].hand.length, hand, 'no draw');
    eq(g.players[0].grave.filter((c) => c.data === T.zombie).length, 2, 'GY Zombies stay');
  });

  // ---------------------------------------------------------------- Seal of Wickedness
  // https://edisonrul.ing/cards/s/seal-of-wickedness.html
  await test('Seal of Wickedness: the negation ends when Seal of Wickedness leaves the field', async () => {
    const { g, c0, place } = setup();
    const seal = live(place(0, N('Seal of Wickedness'), 'szone'));
    const med = place(1, N('Reptilianne Medusa'), 'mzone');
    pickOnly(c0, [med]);
    await phase(g, 1, 'standby');
    eq(g.isNegated(med), true, 'negated');
    await g.destroy([seal], 'effect', 1);
    eq(seal.location, 'grave', 'Seal destroyed');
    eq(g.isNegated(med), false, 'no longer negated');
  });

  // ---------------------------------------------------------------- Clear Vice Dragon
  // https://edisonrul.ing/cards/c/clear-vice-dragon.html
  await test("Clear Vice Dragon: discards instead of being destroyed by the opponent's effect (an effect, not a cost)", async () => {
    const { g, place } = setup();
    const cvd = place(0, N('Clear Vice Dragon'), 'mzone');
    const h = place(0, T.weak, 'hand');
    await g.destroy([cvd], 'effect', 1);
    eq(cvd.location, 'mzone', 'not destroyed');
    eq(h.location, 'grave', 'discarded');
    const ev = g.eventLog.find((e) => e.type === 'discarded' && e.card === h);
    eq(!!ev && !(ev.reasons ?? []).includes('cost'), true, 'discarded by an effect, not as a cost');
    await g.destroy([cvd], 'effect', 0);
    eq(cvd.location, 'grave', "its controller's own effect destroys it");
  });

  // ---------------------------------------------------------------- Solitaire Magician
  // https://edisonrul.ing/cards/s/solitaire-magician.html
  for (const flip of ['lady', 'victim'] as const) {
    await test(`Solitaire Magician: ${flip === 'lady' ? 'the Fortune Lady flipped face-down: nothing happens' : 'the monster to destroy flipped face-down: still destroyed'}`, async () => {
      const { g, c0, place } = setup();
      const sol = place(0, N('Solitaire Magician'), 'mzone');
      const fl = place(0, N('Fortune Lady Earth'), 'mzone');
      const victim = place(1, T.brute, 'mzone');
      pickOnly(c0, [fl, victim]);
      beforeResolve(g, () => g.changePosition(flip === 'lady' ? fl : victim, 'def', false));
      await activate(g, 0, sol);
      eq(victim.location, flip === 'lady' ? 'mzone' : 'grave', 'victim');
    });
  }

  // ---------------------------------------------------------------- Reptilianne Medusa / Gorgon
  // https://edisonrul.ing/cards/r/reptilianne-medusa.html
  await test('Reptilianne Medusa: cannot target a monster with 0 ATK', async () => {
    const { g, place } = setup();
    const med = place(0, N('Reptilianne Medusa'), 'mzone');
    place(0, T.weak, 'hand');
    place(1, T.zero, 'mzone');
    eq(canActivate(g, 0, med), false, 'only a 0-ATK monster: not offered');
    place(1, T.brute, 'mzone');
    eq(canActivate(g, 0, med), true, 'a monster with ATK: offered');
  });

  // https://edisonrul.ing/cards/r/reptilianne-gorgon.html
  await test('Reptilianne Gorgon: activates even when it destroyed the monster by battle (resolves without effect)', async () => {
    const { g, c0, place } = setup();
    const gor = place(0, N('Reptilianne Gorgon'), 'mzone');
    const t = place(1, T.weak, 'mzone');
    c0.aim = t;
    g.phase = 'battle';
    await g.conductAttack(0, gor);
    eq(t.location, 'grave', 'destroyed by battle');
    eq(linksOf(g, gor).length, 1, 'its effect still activated');
  });

  // ---------------------------------------------------------------- Vampire Lord
  // https://edisonrul.ing/cards/v/vampire-lord.html
  await test("Vampire Lord: the Special Summon is a Trigger Effect in your next Standby Phase (not a later one)", async () => {
    const { g, place } = setup();
    const vl = place(0, N('Vampire Lord'), 'mzone');
    await g.destroy([vl], 'effect', 1);
    eq(vl.location, 'grave', 'destroyed');
    eq(linksOf(g, vl).length, 0, 'no Chain when destroyed');
    g.turn = 3;
    await phase(g, 1, 'standby');
    eq(vl.location, 'grave', "not in the opponent's Standby Phase");
    g.turn = 4;
    await phase(g, 0, 'standby');
    eq(vl.location, 'mzone', 'Special Summoned');
    eq(linksOf(g, vl).length, 1, 'as a Chain Link');
    // skipped Standby Phase: not even on the following one
    await g.destroy([vl], 'effect', 1);
    g.turn = 8;
    await phase(g, 0, 'standby');
    eq(vl.location, 'grave', 'the next Standby Phase (turn 6) was skipped: not Special Summoned');
  });

  // ---------------------------------------------------------------- Inherited Fortune
  // https://edisonrul.ing/cards/i/inherited-fortune.html
  await test('Inherited Fortune: the Standby Phase Special Summon starts a Chain', async () => {
    const { g, c0, place } = setup();
    const fl = place(0, N('Fortune Lady Earth'), 'mzone');
    const inh = place(0, N('Inherited Fortune'), 'szone');
    await g.destroy([fl], 'effect', 1);
    await activate(g, 0, inh);
    eq(inh.location, 'grave', 'resolved');
    const inHand = place(0, N('Fortune Lady Earth'), 'hand');
    c0.pick = (_g, req) => req.candidates.slice(0, req.max);
    g.turn = 4;
    await phase(g, 0, 'standby');
    eq(inHand.location, 'mzone', 'Special Summoned');
    eq(linksOf(g, inh).length, 2, 'activation + the Standby Phase Chain Link');
  });

  // ---------------------------------------------------------------- Dimensional Alchemist
  // https://edisonrul.ing/cards/d/dimensional-alchemist.html
  await test('Dimensional Alchemist: its GY effect is a "When ... you can" trigger (can miss the timing)', async () => {
    eq(N('Dimensional Alchemist').effects![1].when, true, 'when');
  });

  // ---------------------------------------------------------------- Machina Gearframe / Dimensional Fissure
  // https://edisonrul.ing/cards/m/machina-gearframe.html
  await test('Machina Gearframe: cannot save the equipped monster when both are destroyed at the same time', async () => {
    for (const both of [false, true]) {
      const { g, place } = setup();
      const host = place(0, T.machine, 'mzone');
      const gear = place(0, N('Machina Gearframe'), 'szone', { faceUp: true });
      g.equip(gear, host);
      await g.destroy(both ? [host, gear] : [host], 'effect', 1);
      eq(host.location, both ? 'grave' : 'mzone', both ? 'both destroyed' : 'host saved');
      eq(gear.location, 'grave', 'Gearframe destroyed');
    }
  });

  // https://edisonrul.ing/cards/m/machina-gearframe.html (Dimensional Fissure vs. an equipped Union)
  await test('Dimensional Fissure: an equipped Union Monster sent to the GY is not banished', async () => {
    const { g, place } = setup();
    live(place(1, N('Dimensional Fissure'), 'szone'));
    const host = place(0, T.machine, 'mzone');
    const gear = place(0, N('Machina Gearframe'), 'szone', { faceUp: true });
    g.equip(gear, host);
    await g.destroy([gear], 'effect', 1);
    eq(gear.location, 'grave', 'to the GY');
    await g.destroy([host], 'effect', 1);
    eq(host.location, 'banished', 'a monster from the Monster Zone is still banished');
  });

  // ---------------------------------------------------------------- Plaguespreader Zombie
  // https://edisonrul.ing/cards/p/plaguespreader-zombie.html
  await test('Plaguespreader Zombie: the banish effect disappears once it is flipped face-down', async () => {
    for (const flip of [false, true]) {
      const { g, place } = setup();
      const pz = place(0, N('Plaguespreader Zombie'), 'grave');
      place(0, T.weak, 'hand');
      await activate(g, 0, pz);
      eq(pz.location, 'mzone', 'revived');
      if (flip) await g.changePosition(pz, 'def', false);
      await g.destroy([pz], 'effect', 1);
      eq(pz.location, flip ? 'grave' : 'banished', flip ? 'flipped face-down: to the GY' : 'banished');
    }
  });

  // ---------------------------------------------------------------- Dark Simorgh
  // https://edisonrul.ing/cards/d/dark-simorgh.html
  await test('Dark Simorgh: the opponent cannot turn monsters face-down by card effect or Special Summon face-down', async () => {
    const { g, place } = setup();
    place(0, N('Dark Simorgh'), 'mzone');
    const m = place(1, T.brute, 'mzone');
    await g.changePosition(m, 'def', false, 0);
    eq(m.faceUp, true, 'Book of Moon-style flip: stays face-up');
    const x = place(1, T.weak, 'grave');
    const r = await g.specialSummon([x], 1, { faceDown: true });
    eq(r.length, 0, 'no face-down Special Summon');
    const mine = place(0, T.brute, 'mzone');
    await g.changePosition(mine, 'def', false, 1);
    eq(mine.faceUp, false, "Dark Simorgh's controller is not restricted");
  });

  // ---------------------------------------------------------------- Clear World
  // https://edisonrul.ing/cards/c/clear-world.html
  await test('Clear World: the WATER and FIRE effects each start their own Chain', async () => {
    const { g, place } = setup();
    const cw = live(place(0, N('Clear World'), 'fzone'));
    place(0, T.water, 'mzone');
    place(0, T.fire, 'mzone');
    place(0, T.weak, 'hand');
    const lp = g.players[0].lp;
    await phase(g, 0, 'end');
    const links = linksOf(g, cw);
    const water = links.find((l) => l.effect.label === 'WATER: discard 1 card');
    const fire = links.find((l) => l.effect.label === 'FIRE: take 1000 damage');
    eq(!!water && !!fire, true, 'both activated');
    eq(fire!.index, Math.min(...links.map((l) => l.index)), 'FIRE is Chain Link 1 of its own Chain');
    eq(fire!.index < water!.index, true, 'WATER was not Chain Link 1 (the upkeep was): different Chains');
    eq(g.players[0].hand.length, 0, 'WATER: discarded');
    eq(lp - g.players[0].lp, 1000 + 500, 'FIRE damage + the 500 LP upkeep');
  });

  // https://edisonrul.ing/cards/c/clear-world.html + https://edisonrul.ing/cards/c/clear-vice-dragon.html
  await test('Clear World vs. Clear Vice Dragon: the WATER effect starts a Chain but resolves without effect', async () => {
    const { g, place } = setup();
    const cw = live(place(0, N('Clear World'), 'fzone'));
    place(0, N('Clear Vice Dragon'), 'mzone');
    place(0, T.water, 'mzone');
    place(0, T.weak, 'hand');
    await phase(g, 0, 'end');
    eq(linksOf(g, cw).some((l) => l.effect.label === 'WATER: discard 1 card'), true, 'activated');
    eq(g.players[0].hand.length, 1, 'no discard');
  });

  // ---------------------------------------------------------------- Spiritual Forest
  // https://edisonrul.ing/cards/s/spiritual-forest.html
  await test('Spiritual Forest: applies once per turn (per Spiritual Forest), not once per monster', async () => {
    const { g, c1, place } = setup();
    live(place(0, N('Spiritual Forest'), 'szone'));
    const b1 = place(0, T.beast, 'mzone');
    const b2 = place(0, T.beast, 'mzone');
    const a1 = place(1, T.big, 'mzone');
    const a2 = place(1, T.big, 'mzone');
    g.turnPlayer = 1;
    g.phase = 'battle';
    c1.aim = b1;
    await g.conductAttack(1, a1);
    eq(b1.location, 'mzone', 'first: not destroyed');
    c1.aim = b2;
    await g.conductAttack(1, a2);
    eq(b2.location, 'grave', 'second: destroyed');
  });

  // ---------------------------------------------------------------- Divine Grace - Northwemko
  // https://edisonrul.ing/cards/d/divine-grace-northwemko.html
  await test('Divine Grace - Northwemko: the face-up cards are targeted when the effect activates', async () => {
    const { g, place } = setup();
    const nw = place(0, N('Divine Grace - Northwemko'), 'hand');
    const m = place(0, T.brute, 'mzone');
    await g.specialSummon([nw], 0, { method: 'ritual', ignoreConditions: true });
    await g.processTriggers(true);
    const [l] = linksOf(g, nw);
    eq(!!l && l.ctx.targets.includes(m), true, 'target chosen on activation');
    eq(g.queryCard(nw, 'indestructibleEffect'), true, 'protected while it is face-up');
  });

  // ---------------------------------------------------------------- Red-Eyes Zombie Dragon
  // https://edisonrul.ing/cards/r/red-eyes-zombie-dragon.html
  await test('Red-Eyes Zombie Dragon: Tribute Summoned only by Tributing Zombie-Type monsters', async () => {
    const { g, place } = setup();
    const rezd = place(0, N('Red-Eyes Zombie Dragon'), 'hand');
    place(0, T.brute, 'mzone');
    place(0, T.brute, 'mzone');
    eq(g.canNormalSummon(0, rezd, false), false, 'not with non-Zombies');
    eq(g.canNormalSummon(0, rezd, true), true, 'a Tribute Set is not a Tribute Summon');
    const { g: g2, place: p2 } = setup();
    const rezd2 = p2(0, N('Red-Eyes Zombie Dragon'), 'hand');
    p2(0, T.zombie, 'mzone');
    p2(0, T.zombie, 'mzone');
    eq(g2.canNormalSummon(0, rezd2, false), true, 'with 2 Zombies');
  });

  // ---------------------------------------------------------------- Black Brutdrago
  // https://edisonrul.ing/cards/b/black-brutdrago.html
  await test('Black Brutdrago: its effect cannot be activated while Dimensional Fissure is active', async () => {
    const { g, place } = setup();
    const bb = place(0, N('Black Brutdrago'), 'mzone');
    place(0, N('Elemental Hero Neos Alius'), 'hand');
    place(1, N('Mystical Space Typhoon'), 'szone');
    eq(canActivate(g, 0, bb), true, 'without Fissure');
    live(place(1, N('Dimensional Fissure'), 'szone'));
    eq(canActivate(g, 0, bb), false, 'with Fissure');
  });

  // ---------------------------------------------------------------- Molting Escape
  // https://edisonrul.ing/cards/m/molting-escape.html
  await test('Molting Escape: no 300 ATK when the monster could not be destroyed by battle anyway', async () => {
    for (const other of [false, true]) {
      const { g, c1, place } = setup();
      const r = place(0, T.reptile, 'mzone');
      const me = live(place(0, N('Molting Escape'), 'szone'));
      g.equip(me, r);
      if (other) g.addTempMod(r, 'indestructibleBattle', true, 'turn');
      const a = place(1, T.big, 'mzone');
      g.turnPlayer = 1;
      g.phase = 'battle';
      c1.aim = r;
      await g.conductAttack(1, a);
      eq(r.location, 'mzone', 'survives');
      eq(g.getAtk(r), other ? 1000 : 1300, other ? 'other protection: no gain' : 'gains 300');
    }
  });

  // ---------------------------------------------------------------- Max Warrior
  // https://edisonrul.ing/cards/m/max-warrior.html
  await test('Max Warrior: two battle destructions in a turn leave 1/4 of its original ATK', async () => {
    const { g, c0, place } = setup();
    const mw = place(0, N('Max Warrior'), 'mzone');
    const t1 = place(1, T.zero, 'mzone');
    const t2 = place(1, T.zero, 'mzone');
    g.phase = 'battle';
    c0.aim = t1;
    await g.conductAttack(0, mw);
    eq(g.baseAtk(mw), 900, 'halved');
    mw.attacksThisTurn = 0;
    c0.aim = t2;
    await g.conductAttack(0, mw);
    eq(t2.location, 'grave', 'second destroyed');
    eq(g.baseAtk(mw), 450, 'quartered');
  });

  // ---------------------------------------------------------------- Spider Web
  // https://edisonrul.ing/cards/s/spider-web.html
  await test('Spider Web: the position lock ends once the monster is flipped face-down', async () => {
    const { g, c0, place } = setup();
    live(place(0, N('Spider Web'), 'fzone'));
    const a = place(0, T.brute, 'mzone');
    const t = place(1, T.weak, 'mzone');
    g.phase = 'battle';
    c0.aim = t;
    await g.conductAttack(0, a);
    eq(a.pos, 'def', 'changed to Defense Position');
    eq(g.queryCard(a, 'cannotChangePos'), true, 'locked');
    await g.changePosition(a, 'def', false);
    await g.changePosition(a, 'def', true);
    eq(g.queryCard(a, 'cannotChangePos'), false, 'flipped face-down and up again: no longer locked');
  });

  // ---------------------------------------------------------------- Zombie World / Zombie Master / Book of Life
  // https://edisonrul.ing/cards/z/zombie-world.html
  await test('Zombie World: face-down monsters keep their Type', async () => {
    const { g, place } = setup();
    live(place(0, N('Zombie World'), 'fzone'));
    const up = place(1, T.brute, 'mzone');
    const down = place(1, T.brute, 'mzone', { faceUp: false, pos: 'def' });
    eq(up.data.race, 'Zombie', 'face-up: Zombie');
    eq(down.data.race, 'Warrior', 'face-down: unaffected');
    void g;
  });

  // https://edisonrul.ing/cards/z/zombie-master.html
  await test('Zombie Master: a target that is no longer a Zombie is not Special Summoned', async () => {
    const { g, c0, place } = setup();
    const zw = live(place(0, N('Zombie World'), 'fzone'));
    const zm = place(0, N('Zombie Master'), 'mzone');
    place(0, T.zombie, 'hand');
    const t = place(1, T.brute, 'grave');
    pickOnly(c0, [t]);
    beforeResolve(g, () => g.destroy([zw], 'effect', 1).then(() => undefined));
    await activate(g, 0, zm);
    eq(zw.location, 'grave', 'Zombie World gone');
    eq(t.location, 'grave', 'not Special Summoned');
  });

  // https://edisonrul.ing/cards/b/book-of-life.html
  await test('Book of Life: a target no longer a Zombie is not Special Summoned; the banish still happens', async () => {
    const { g, c0, place } = setup();
    const zw = live(place(0, N('Zombie World'), 'fzone'));
    const bol = place(0, N('Book of Life'), 'hand');
    const t = place(0, T.brute, 'grave');
    const o = place(1, T.weak, 'grave');
    pickOnly(c0, [t, o]);
    beforeResolve(g, () => g.destroy([zw], 'effect', 1).then(() => undefined));
    await activate(g, 0, bol);
    eq(t.location, 'grave', 'not Special Summoned');
    eq(o.location, 'banished', 'still banished');
  });

  // ---------------------------------------------------------------- Card text (April 2010 printings quoted in the database)
  // https://edisonrul.ing/cards/d/dark-simorgh.html, v/victoria, m/moray-of-greed, d/dimensional-fissure
  await test('Dark Simorgh / Victoria / Moray of Greed / Dimensional Fissure: April 2010 card text', async () => {
    eq(N('Dark Simorgh').text.endsWith('Your opponent cannot Set any cards on the field.'), true, 'Dark Simorgh');
    eq(N('Victoria').text.includes('cannot select another face-up Fairy-Type monster as an attack target'), true, 'Victoria');
    eq(N('Moray of Greed').text, 'Return 2 WATER monsters from your hand to your Deck and draw 3 cards.', 'Moray of Greed');
    eq(N('Dimensional Fissure').text, 'Any monster sent to the Graveyard is removed from play instead.', 'Dimensional Fissure');
  });

  report();
})();
