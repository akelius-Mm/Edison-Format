// Rulings regression tests from the edisonrul.ing database audit, group 7 (rgbt.ts, tdgs.ts).
// Usage: npx tsx scripts/rulings/db-audit-7.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardInstance } from '../../src/engine/card';
import type { Game } from '../../src/engine/game';
import type { Phase } from '../../src/engine/types';
import { TestController, activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  mite: findCard('Rulings Test Mite') ?? normal('Rulings Test Mite', 'EARTH', 'Insect', 1, 300, 300),
  plant: findCard('Audit7 Plant') ?? normal('Audit7 Plant', 'EARTH', 'Plant', 4, 1000, 1000),
  fortress: findCard('Audit7 Fortress') ?? normal('Audit7 Fortress', 'EARTH', 'Rock', 4, 0, 4000),
  twin: findCard('Audit7 Twin') ?? normal('Audit7 Twin', 'EARTH', 'Warrior', 6, 2200, 1000),
  lv3: findCard('Audit7 Lv3') ?? normal('Audit7 Lv3', 'EARTH', 'Warrior', 3, 1000, 1000),
  psychic: findCard('Audit7 Psychic') ?? normal('Audit7 Psychic', 'EARTH', 'Psychic', 4, 1600, 1000),
};
const card = (n: string) => cardByName(n);
const setPhase = (g: Game, ph: Phase) => (g as any).setPhase(ph) as Promise<void>;
const attack = (g: Game, a: CardInstance, target: CardInstance | null) => {
  (g.controllers[0] as TestController).aim = target;
  return g.performAction(0, { type: 'attack', card: a });
};

(async () => {
  console.log('Rulings tests: database audit, group 7');

  // https://edisonrul.ing/cards/g/gb-hunter.html
  await test('G.B. Hunter: Compulsory Evacuation Device / De-Synchro cannot target a Synchro Monster', async () => {
    const { g, place } = newGame(T.wall);
    const ced = place(0, card('Compulsory Evacuation Device'), 'szone');
    const des = place(0, card('De-Synchro'), 'hand');
    place(1, card('Stardust Dragon'), 'mzone').properlySummoned = true;
    eq(canActivate(g, 0, ced), true, 'control: CED can target the Synchro');
    eq(canActivate(g, 0, des), true, 'control: De-Synchro can target the Synchro');
    place(1, card('G.B. Hunter'), 'mzone');
    eq(canActivate(g, 0, des), false, 'De-Synchro cannot be activated');
    // CED can still target G.B. Hunter itself (a Main Deck monster returns to the hand), but not the Synchro
    eq(canActivate(g, 0, ced), true, 'CED can still target the Main Deck monster');
    let cands: string[] = [];
    (g.controllers[0] as TestController).pick = (_g, req) => {
      cands = req.candidates.map((c) => c.name);
      return req.candidates.slice(0, 1);
    };
    await activate(g, 0, ced);
    eq(cands.includes('Stardust Dragon'), false, `the Synchro is not a legal target (candidates: ${cands.join(',')})`);
  });

  // https://edisonrul.ing/cards/g/gb-hunter.html
  await test('G.B. Hunter: a Synchro bounced to the "hand" stays; a destroyed card that would go to the Deck goes to the GY', async () => {
    const { g, place } = newGame(T.wall);
    place(1, card('G.B. Hunter'), 'mzone');
    const sd = place(0, card('Stardust Dragon'), 'mzone');
    await g.moveCards([sd], 'hand', { reason: 'effect' });
    eq(sd.location, 'mzone', 'the Synchro is not returned to the Extra Deck');
    const m = place(0, T.brute, 'mzone');
    await g.moveCards([m], 'deck', { reason: 'battle', reasons: ['battle', 'destroy'], destroyed: true });
    eq(m.location, 'grave', 'destroyed and kept out of the Deck: sent to the GY');
  });

  // https://edisonrul.ing/cards/g/gb-hunter.html
  await test('G.B. Hunter: Multiple Piece Golem cannot return itself to the Extra Deck', async () => {
    for (const hunter of [false, true]) {
      const { g, c0, place } = newGame(T.wall);
      g.phase = 'battle';
      const mpg = place(0, card('Multiple Piece Golem'), 'mzone');
      mpg.properlySummoned = true;
      mpg.attackedThisTurnOrWasAttacked = true;
      if (hunter) place(1, card('G.B. Hunter'), 'mzone');
      g.beginBatch();
      g.emit({ type: 'battleEnd', player: 0, phase: 'battle' });
      await g.processTriggers(true);
      eq(mpg.location, hunter ? 'mzone' : 'extra', hunter ? 'stays with G.B. Hunter' : 'control: returns without G.B. Hunter');
      eq(c0.triggersAsked.includes('Multiple Piece Golem'), !hunter, hunter ? 'its effect is not offered' : 'control: offered');
    }
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-drago.html
  await test("Koa'ki Meiru Drago: Monster Reborn cannot be activated to target a LIGHT/DARK monster", async () => {
    const { g, place } = newGame(T.wall);
    const mr = place(0, card('Monster Reborn'), 'hand');
    place(1, card('Dark Armed Dragon'), 'grave').properlySummoned = true;
    place(0, card('Sangan'), 'grave');
    eq(canActivate(g, 0, mr), true, 'control: activatable');
    place(1, card("Koa'ki Meiru Drago"), 'mzone');
    eq(canActivate(g, 0, mr), false, 'no legal target while Drago is face-up');
    const ok = place(0, T.brute, 'grave');
    eq(canActivate(g, 0, mr), true, 'an EARTH monster is a legal target');
    await activate(g, 0, mr);
    eq(ok.location, 'mzone', 'the EARTH monster is Special Summoned');
  });

  // https://edisonrul.ing/cards/h/herald-of-orange-light.html
  await test('Herald of Orange Light: its effect can be activated in the Damage Step', async () => {
    const ef = card('Herald of Orange Light').effects!.find((e) => e.kind === 'quick')!;
    eq(ef.damageStep, true, 'damageStep');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-powerhand.html
  await test("Koa'ki Meiru Powerhand: the battled LIGHT/DARK monster is negated from attack declaration", async () => {
    const { g, place } = newGame(T.wall);
    g.phase = 'battle';
    const ph = place(0, card("Koa'ki Meiru Powerhand"), 'mzone');
    const sangan = place(1, card('Sangan'), 'mzone');
    eq(g.isNegated(sangan), false, 'control: not negated before the attack');
    // attack declared on Sangan, not yet in the Damage Step
    g.battle = { attacker: ph, target: sangan, attackerMoveId: ph.moveId, targetMoveId: sangan.moveId, negated: false, inDamageStep: false, oppMonsterCount: 1, flags: {} } as any;
    eq(g.isNegated(sangan), true, 'negated from attack declaration');
  });

  // https://edisonrul.ing/cards/r/rose-tentacles.html
  for (const [plants, attacks] of [
    [0, 2],
    [1, 2],
    [2, 3],
  ] as const) {
    await test(`Rose Tentacles + Wonder Clover: ${plants} opposing Plant(s) = ${attacks} attacks`, async () => {
      const { g, place } = newGame(T.wall);
      const rt = place(0, card('Rose Tentacles'), 'mzone');
      place(0, T.plant, 'hand');
      const wc = place(0, card('Wonder Clover'), 'hand');
      for (let i = 0; i < plants; i++) place(1, card('Lonefire Blossom'), 'mzone');
      await activate(g, 0, wc);
      await setPhase(g, 'battle');
      eq(1 + g.queryCardNum(rt, 'extraAttacks'), attacks, 'attacks');
    });
  }
  await test('Rose Tentacles: without Wonder Clover, 2 Plants = 3 attacks (control)', async () => {
    const { g, place } = newGame(T.wall);
    const rt = place(0, card('Rose Tentacles'), 'mzone');
    for (let i = 0; i < 2; i++) place(1, card('Lonefire Blossom'), 'mzone');
    await setPhase(g, 'battle');
    eq(1 + g.queryCardNum(rt, 'extraAttacks'), 3, 'attacks');
  });

  // https://edisonrul.ing/cards/f/fake-feather.html
  await test("Fake Feather: the copied Trap's cost (Raigeki Break's discard) is not paid", async () => {
    const { g, place } = newGame(T.wall);
    const ff = place(0, card('Fake Feather'), 'szone');
    place(0, card('Blackwing - Bora the Spear'), 'hand');
    const keep = place(0, T.mite, 'hand');
    place(1, card('Raigeki Break'), 'grave');
    const victim = place(1, T.brute, 'mzone');
    await activate(g, 0, ff);
    eq(keep.location, 'hand', 'no card discarded for the copied cost');
    eq(victim.location, 'grave', 'the copied effect resolves');
  });

  // https://edisonrul.ing/cards/m/mermaid-archer.html
  await test('Mermaid Archer: cannot destroy its equipped monster instead when both are destroyed at once', async () => {
    for (const both of [false, true]) {
      const { g, place } = newGame(T.wall);
      const ma = place(0, card('Mermaid Archer'), 'mzone');
      const m = place(0, T.mite, 'mzone');
      await activate(g, 0, ma);
      eq(m.location, 'szone', 'equipped');
      await g.destroy(both ? [ma, m] : [ma], 'effect', 1);
      eq(ma.location, both ? 'grave' : 'mzone', both ? 'both destroyed' : 'control: saved by destroying the equip');
      eq(m.location, 'grave', 'equipped monster destroyed');
    }
  });

  // https://edisonrul.ing/cards/l/light-end-dragon.html
  await test("Light End Dragon: Enemy Controller chained -> it loses 500, the opponent's monster loses nothing", async () => {
    for (const econ of [false, true]) {
      const { g, c1, place } = newGame(T.wall);
      g.phase = 'battle';
      const led = place(0, card('Light End Dragon'), 'mzone');
      led.properlySummoned = true;
      const opp = place(1, T.fortress, 'mzone', { pos: 'def' });
      if (econ) {
        place(1, card('Enemy Controller'), 'szone');
        c1.respond = respondWith('Enemy Controller');
      }
      await attack(g, led, opp);
      eq(led.tempMods.filter((t) => t.q === 'atk').reduce((a, t) => a + Number(t.value), 0), -500, 'Light End Dragon -500');
      eq(opp.location, 'mzone', 'the opponent monster survives');
      eq(g.getDef(opp), econ ? 4000 : 2500, econ ? 'opponent monster unchanged' : 'control: opponent monster -1500 DEF');
    }
  });

  // https://edisonrul.ing/cards/y/yamato-no-kami.html (Revised section)
  await test('Yamato-no-Kami: its effect activates even when it is destroyed in the same battle', async () => {
    const { g, place } = newGame(T.wall);
    g.phase = 'battle';
    const y = place(0, card('Yamato-no-Kami'), 'mzone');
    y.properlySummoned = true;
    const opp = place(1, T.twin, 'mzone');
    const st = place(1, card('Mirror Force'), 'szone');
    await attack(g, y, opp);
    eq(y.location, 'grave', 'Yamato destroyed');
    eq(opp.location, 'grave', 'opponent monster destroyed');
    eq(st.location, 'grave', 'the Spell/Trap is destroyed');
  });

  // https://edisonrul.ing/cards/s/sea-dragon-lord-gishilnodon.html
  await test('Sea Dragon Lord Gishilnodon: needs Level 3 or lower both on the field and in the Graveyard', async () => {
    const cases = [
      { name: 'Level 3', data: T.lv3, mod: 0, fires: true },
      { name: 'Level 4 made Level 3', data: T.brute, mod: -1, fires: false },
      { name: 'Level 3 made Level 4', data: T.lv3, mod: 1, fires: false },
    ];
    for (const k of cases) {
      const { g, place } = newGame(T.wall);
      const sd = place(0, card('Sea Dragon Lord Gishilnodon'), 'mzone');
      const m = place(1, k.data, 'mzone');
      if (k.mod) g.addTempMod(m, 'level', k.mod, 'field');
      await g.destroy([m], 'effect', 0);
      await g.processTriggers(true);
      eq(g.getAtk(sd), k.fires ? 3000 : 2300, k.name);
    }
  });

  // https://edisonrul.ing/cards/a/alien-dog.html
  await test('Alien Dog: only 1 copy can use its effect per Normal Summon', async () => {
    const { g, place } = newGame(T.wall);
    const a = place(0, card('Alien Dog'), 'hand');
    const d1 = place(0, card('Alien Dog'), 'hand');
    const d2 = place(0, card('Alien Dog'), 'hand');
    place(1, T.brute, 'mzone');
    await g.performAction(0, { type: 'summon', card: a });
    eq(a.location, 'mzone', 'Normal Summoned');
    eq([d1, d2].filter((c) => c.location === 'mzone').length, 1, 'exactly 1 Alien Dog Special Summoned');
  });

  // https://edisonrul.ing/cards/o/overdoom-line.html
  await test('Overdoom Line: a boosted monster flipped face-down and face-up again loses the boost', async () => {
    const { g, place } = newGame(T.wall);
    place(0, card('Overdoom Line'), 'szone', { faceUp: true });
    const p = place(0, card('Lonefire Blossom'), 'grave');
    await g.specialSummon([p], 0, { pos: 'atk' } as any);
    await g.processTriggers(true);
    eq(g.getAtk(p), 1500, 'boosted');
    await g.changePosition(p, 'def', false, 0);
    await g.changePosition(p, 'atk', true, 0);
    eq(g.getAtk(p), 500, 'boost lost after face-down');
  });

  // https://edisonrul.ing/cards/m/montage-dragon.html
  await test('Montage Dragon: ATK stays 0 after Skill Drain leaves the field', async () => {
    const { g, place } = newGame(T.wall);
    const md = place(0, card('Montage Dragon'), 'hand');
    for (let i = 0; i < 3; i++) place(0, T.brute, 'hand');
    const proc = g.legalMainActions(0).find((a) => a.type === 'proc' && a.card === md);
    if (!proc) throw new Error('no Montage Dragon procedure');
    await g.performAction(0, proc);
    eq(g.getAtk(md), 3600, 'ATK = 12 Levels x 300');
    const sd = place(1, card('Skill Drain'), 'szone', { faceUp: true });
    eq(g.getAtk(md), 0, 'negated: 0');
    await g.moveCards([sd], 'grave', { reason: 'effect' });
    eq(g.getAtk(md), 0, 'stays 0 after Skill Drain leaves');
  });

  // https://edisonrul.ing/cards/u/unstable-evolution.html
  await test("Unstable Evolution: changes the ORIGINAL ATK (Overworked doesn't see a gain)", async () => {
    const { g, place } = newGame(T.wall);
    g.players[0].lp = 4000;
    const m = place(0, T.mite, 'mzone');
    const ue = place(0, card('Unstable Evolution'), 'hand');
    await activate(g, 0, ue);
    eq(g.baseAtk(m), 2400, 'original ATK 2400');
    eq(g.getAtk(m), 2400, 'ATK 2400');
    const ow = place(1, card('Overworked'), 'szone');
    eq(canActivate(g, 1, ow), false, 'Overworked has nothing to destroy');
    g.addTempMod(m, 'atk', 300);
    eq(canActivate(g, 1, ow), true, 'control: a further gain counts');
  });

  // https://edisonrul.ing/cards/r/remote-revenge.html
  await test('Remote Revenge: can be chained to Icarus Attack targeting 1 monster + 1 Spell/Trap', async () => {
    const { g, c0, c1, place } = newGame(T.wall);
    const ica = place(1, card('Icarus Attack'), 'szone');
    place(1, card('Blackwing - Bora the Spear'), 'mzone');
    const theirs = place(1, T.brute, 'mzone');
    const mine = place(0, T.brute, 'mzone');
    const myST = place(0, card('Mirror Force'), 'szone');
    const rr = place(0, card('Remote Revenge'), 'szone');
    c1.pick = (_g, req) => {
      if (req.max === 2) return [mine, myST];
      return req.candidates.slice(0, req.min);
    };
    c0.respond = respondWith('Remote Revenge');
    c0.pick = (_g, req) => (req.candidates.includes(theirs) ? [theirs] : req.candidates.slice(0, req.min));
    await activate(g, 1, ica);
    eq(rr.location, 'grave', 'Remote Revenge was activated');
    eq(mine.location, 'mzone', 'my monster is safe');
    eq(theirs.location, 'grave', 'the new monster target is destroyed');
    eq(myST.location, 'grave', 'the Spell/Trap target is still destroyed');
  });

  // https://edisonrul.ing/cards/a/attack-of-the-cornered-rat.html
  await test("Attack of the Cornered Rat: targets the opponent's monster", async () => {
    const { g, c1, place } = newGame(T.wall);
    g.phase = 'battle';
    const rat = place(0, card('Attack of the Cornered Rat'), 'szone', { faceUp: true });
    const mine = place(0, T.mite, 'mzone');
    const theirs = place(1, T.brute, 'mzone');
    g.battle = { attacker: theirs, target: mine, attackerMoveId: theirs.moveId, targetMoveId: mine.moveId, negated: false, inDamageStep: true, oppMonsterCount: 1, flags: {} } as any;
    let targeted = false;
    const origAct = g.activate.bind(g);
    g.activate = async (p, act) => {
      const l = await origAct(p, act);
      if (l?.card === rat) targeted = l.ctx.targets.includes(theirs);
      return l;
    };
    await activate(g, 0, rat, 'Pay LP: reduce ATK');
    eq(targeted, true, 'the opponent monster is a target');
    eq(g.getAtk(theirs) < 1800, true, 'ATK reduced');
  });

  // https://edisonrul.ing/cards/p/psi-station.html
  await test('Psi-Station: targets the Normal Summoned Psychic-Type monster', async () => {
    const { g, c1, place } = newGame(T.wall);
    place(0, card('Psi-Station'), 'szone', { faceUp: true });
    const psy = place(0, T.psychic, 'hand');
    let targeted = false;
    const origAct = g.activate.bind(g);
    g.activate = async (p, act) => {
      const l = await origAct(p, act);
      if (l?.card.name === 'Psi-Station') targeted = l.ctx.targets.includes(psy);
      return l;
    };
    await g.performAction(0, { type: 'summon', card: psy });
    eq(targeted, true, 'the summoned monster is a target');
    eq(g.getAtk(psy), 1900, '+300 ATK');
    eq(g.getLevel(psy), 5, 'Level +1');
  });

  // https://edisonrul.ing/cards/e/earthbound-immortal-aslla-piscu.html
  await test('Earthbound Immortal Aslla piscu: flipped face-up with another Earthbound Immortal -> destroyed, its effect activates', async () => {
    const { g, place } = newGame(T.wall);
    place(0, card('Earthbound Immortal Ccapac Apu'), 'mzone');
    place(0, card('Ancient Forest'), 'fzone', { faceUp: true });
    const ap = place(0, card('Earthbound Immortal Aslla piscu'), 'mzone', { faceUp: false, pos: 'def' });
    const opp = place(1, T.brute, 'mzone');
    await g.changePosition(ap, 'atk', true, 0);
    await g.processTriggers(true);
    eq(ap.location, 'grave', 'Aslla piscu removed by the 1-Earthbound-Immortal rule');
    eq(opp.location, 'grave', "the opponent's face-up monster is destroyed");
    eq(g.players[1].lp, 8000 - 800, '800 damage');
  });

  report();
})();
