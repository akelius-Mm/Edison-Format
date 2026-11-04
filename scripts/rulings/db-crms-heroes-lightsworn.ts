// Rulings regression tests from the edisonrul.ing database audit, group 3 (CRMS, HEROes, Lightsworn, Red Dragon
// Archfiend, the shared selfDestroysByBattle helper). Each test cites the card page it pins.
// Usage: npx tsx scripts/rulings/db-crms-heroes-lightsworn.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardData, CardInstance } from '../../src/engine/card';
import type { Game } from '../../src/engine/game';
import type { BattlePos, PlayerId } from '../../src/engine/types';
import { activate, eq, newGame, report, respondWith, test } from '../lib/harness';

const N = (n: string) => cardByName(n);
const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  seven: findCard('Audit3 Test Seven') ?? normal('Audit3 Test Seven', 'EARTH', 'Rock', 3, 700, 700),
  hero: findCard('Audit3 Test Hero') ?? normal('Audit3 Test Hero', 'EARTH', 'Warrior', 4, 1000, 1000),
};
if (!T.hero.sets?.includes('hero')) (T.hero.sets ??= []).push('hero');

const setPhase = (g: Game, ph: string) => (g as any).setPhase(ph) as Promise<void>;

/** A card owned by `owner` but controlled by the other player (as after Creature Swap). */
function stolen(g: Game, owner: PlayerId, data: CardData, pos: BattlePos = 'atk') {
  const c = g.registerCard(new (g.allCards[0].constructor as any)(data, owner)) as CardInstance;
  c.location = 'none';
  g.rawMove(c, 'mzone', { controller: (1 - owner) as PlayerId, faceUp: true, pos });
  c.summonTurn = 0;
  return c;
}

/** The opponent (player 1) flips `victim` face-down with a Set Book of Moon in response to the first chain link. */
function bookOfMoonOn(s: ReturnType<typeof newGame>, victim: CardInstance) {
  s.place(1, N('Book of Moon'), 'szone', { faceUp: false });
  s.c1.respond = (g, req) => (g.chain.length && !g.chain.some((l) => l.card.name === 'Book of Moon') ? respondWith('Book of Moon')(g, req) : null);
  s.c1.pick = (_g, req) => (req.candidates.includes(victim) ? [victim] : req.candidates.slice(0, req.min));
}

(async () => {
  console.log('Rulings tests: database audit group 3');

  // https://edisonrul.ing/cards/e/elemental-hero-flame-wingman.html — "If your 'Elemental Hero Flame Wingman' destroys
  // your monster that your opponent controlled, the effect is still activated"
  await test('Elemental Hero Flame Wingman: burns for your own monster your opponent controlled', async () => {
    const { g, c0, place } = newGame(T.wall);
    const fw = place(0, N('Elemental Hero Flame Wingman'), 'mzone');
    const mine = stolen(g, 0, T.brute);
    c0.aim = mine;
    g.phase = 'battle';
    await g.conductAttack(0, fw);
    eq(mine.location, 'grave', 'the stolen monster is destroyed');
    eq(g.players[1].lp, 8000 - 300 - 1800, 'opponent takes 300 battle damage + 1800 burn');
  });

  // https://edisonrul.ing/cards/g/goyo-guardian.html — "VS. 'Creature Swap': If Goyo destroys your monster that your
  // opponent controlled, this effect can still Special Summon it from your Graveyard."
  await test('Goyo Guardian: can Special Summon your own monster your opponent controlled', async () => {
    const { g, c0, place } = newGame(T.wall);
    const goyo = place(0, N('Goyo Guardian'), 'mzone');
    const mine = stolen(g, 0, T.brute);
    c0.aim = mine;
    g.phase = 'battle';
    await g.conductAttack(0, goyo);
    eq(mine.location, 'mzone', 'Special Summoned back');
    eq(mine.controller, 0, 'to your side of the field');
    eq(mine.pos, 'def', 'in Defense Position');
  });

  // https://edisonrul.ing/cards/g/goyo-guardian.html (control: an opponent-owned monster still works)
  await test('Goyo Guardian: still takes an opponent-owned monster', async () => {
    const { g, c0, place } = newGame(T.wall);
    const goyo = place(0, N('Goyo Guardian'), 'mzone');
    const theirs = place(1, T.brute, 'mzone');
    c0.aim = theirs;
    g.phase = 'battle';
    await g.conductAttack(0, goyo);
    eq(theirs.location, 'mzone', 'Special Summoned');
    eq(theirs.controller, 0, 'to your side of the field');
  });

  // https://edisonrul.ing/cards/j/jain-lightsworn-paladin.html — "must remain face-up on the field in order to activate
  // and resolve this effect"; https://edisonrul.ing/cards/j/judgment-dragon.html
  await test('Jain, Lightsworn Paladin: End Phase mill does not resolve if Jain is flipped face-down in response', async () => {
    const ctl = newGame(T.wall);
    ctl.place(0, N('Jain, Lightsworn Paladin'), 'mzone');
    await setPhase(ctl.g, 'end');
    eq(ctl.g.players[0].deck.length, 18, 'control: 2 cards milled');
    const s = newGame(T.wall);
    const jain = s.place(0, N('Jain, Lightsworn Paladin'), 'mzone');
    bookOfMoonOn(s, jain);
    await setPhase(s.g, 'end');
    eq(jain.faceUp, false, 'Book of Moon resolved');
    eq(s.g.players[0].deck.length, 20, 'nothing is milled');
  });

  // https://edisonrul.ing/cards/g/garoth-lightsworn-warrior.html — "by the effect of" (historical); "Celestia's effect to
  // send cards to the GY is a cost, not an effect, Garoth's effect won't trigger" (revised)
  await test("Garoth, Lightsworn Warrior: not triggered by Celestia's cost, triggered by an effect mill", async () => {
    const { g, place } = newGame(T.wall);
    place(0, N('Garoth, Lightsworn Warrior'), 'mzone');
    const cel = place(0, N('Celestia, Lightsworn Angel'), 'mzone');
    const lyla = place(0, N('Lyla, Lightsworn Sorceress'), 'grave');
    place(1, T.wall, 'mzone');
    g.beginBatch();
    g.emit({ type: 'tributeSummoned', card: cel, player: 0, method: 'tribute', tributes: [lyla] } as any);
    await g.processTriggers(true);
    eq(g.players[0].deck.length, 16, 'only the 4 Celestia cost cards');
    g.beginBatch();
    await g.mill(0, 3, 'effect', cel);
    await g.processTriggers(true);
    eq(g.players[0].deck.length, 11, 'control: an effect mill makes Garoth send 2 more');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-gaia.html — "This effect does not apply if either Hero Gaia or the
  // target is flipped face-down / leaves the field."
  await test('Elemental Hero Gaia: no ATK change if Gaia is flipped face-down in response', async () => {
    const s = newGame(T.wall);
    const gaia = s.place(0, N('Elemental Hero Gaia'), 'mzone');
    const foe = s.place(1, T.brute, 'mzone');
    bookOfMoonOn(s, gaia);
    s.g.beginBatch();
    s.g.emit({ type: 'fusionSummoned', card: gaia, player: 0, method: 'fusion' });
    await s.g.processTriggers(true);
    eq(gaia.faceUp, false, 'Gaia was flipped face-down');
    eq(s.g.getAtk(foe), 1800, 'the target keeps its ATK');
  });

  await test('Elemental Hero Gaia: control, the target ATK is halved', async () => {
    const { g, place } = newGame(T.wall);
    const gaia = place(0, N('Elemental Hero Gaia'), 'mzone');
    const foe = place(1, T.brute, 'mzone');
    g.beginBatch();
    g.emit({ type: 'fusionSummoned', card: gaia, player: 0, method: 'fusion' });
    await g.processTriggers(true);
    eq(g.getAtk(foe), 900, 'halved');
    eq(g.getAtk(gaia), 3100, 'Gaia gains 900');
  });

  // https://edisonrul.ing/cards/r/red-dragon-archfiend.html — "A monster whose attack was negated (by 'Magic Cylinder')
  // is destroyed by this effect."
  await test('Red Dragon Archfiend: a monster whose attack was negated is destroyed in the End Phase', async () => {
    const { g, c1, place } = newGame(T.wall);
    place(0, N('Red Dragon Archfiend'), 'mzone');
    const negated = place(0, T.brute, 'mzone');
    const hit = place(0, T.hero, 'mzone');
    place(1, N('Magic Cylinder'), 'szone', { faceUp: false });
    c1.respond = (gg, req) => (gg.battle?.attacker === negated ? respondWith('Magic Cylinder')(gg, req) : null);
    g.phase = 'battle';
    await g.conductAttack(0, negated);
    await g.conductAttack(0, hit);
    eq(g.players[1].lp, 7000, 'the second attack hit');
    await setPhase(g, 'end');
    eq(negated.location, 'grave', 'the monster whose attack was negated is destroyed');
    eq(hit.location, 'mzone', 'the monster that attacked stays');
  });

  // https://edisonrul.ing/cards/p/puppet-king.html — "is then flipped face-down ... its effect resets ... will not destroy
  // itself during the End Phase."
  for (const flip of [false, true]) {
    await test(`Puppet King: ${flip ? 'not destroyed after being flipped face-down' : 'control, destroyed in your next End Phase'}`, async () => {
      const { g, place } = newGame(T.wall);
      const pk = place(0, N('Puppet King'), 'hand');
      g.beginBatch();
      await g.moveCards([g.players[1].deck[g.players[1].deck.length - 1]], 'hand', { reason: 'effect', reasonPlayer: 1 });
      await g.processTriggers(true);
      eq(pk.location, 'mzone', 'Special Summoned');
      if (flip) {
        await g.setFaceDown(pk);
        await g.changePosition(pk, 'atk', true);
      }
      g.turn = 4;
      await setPhase(g, 'end');
      eq(pk.location, flip ? 'mzone' : 'grave', flip ? 'stays on the field' : 'destroyed');
    });
  }

  // https://edisonrul.ing/cards/d/descending-lost-star.html — "If the Synchro Monster is flipped face-down while on the
  // field, all effects of 'Descending Lost Star' are wiped ... its Level and DEF are restored"
  await test('Descending Lost Star: DEF 0 ends when the monster is flipped face-down', async () => {
    const { g, place } = newGame(T.wall);
    const sd = place(0, N('Stardust Dragon'), 'grave');
    sd.properlySummoned = true;
    const dls = place(0, N('Descending Lost Star'), 'szone', { faceUp: false });
    await activate(g, 0, dls);
    eq(sd.location, 'mzone', 'Special Summoned');
    eq(g.getDef(sd), 0, 'DEF 0');
    await g.setFaceDown(sd);
    await g.changePosition(sd, 'def', true);
    eq(g.getDef(sd), 2000, 'DEF restored');
  });

  // https://edisonrul.ing/cards/m/morphtronic-map.html — "If you activate another Field Spell Card to replace your
  // 'Morphtronic Map', the effect ... misses the timing"; "if you Set a Field Spell Card to replace [it], the timing is
  // not missed"
  for (const how of ['set', 'activate'] as const) {
    await test(`Morphtronic Map: ${how === 'set' ? 'Setting a Field Spell over it, it Special Summons' : 'activating a Field Spell over it, it misses the timing'}`, async () => {
      const { g, place } = newGame(T.wall);
      place(0, N('Morphtronic Map'), 'fzone');
      const radion = place(0, N('Morphtronic Radion'), 'grave');
      const next = place(0, N('Morphtronic Map'), 'hand');
      if (how === 'set') await g.performAction(0, { type: 'setST', card: next } as any);
      else await activate(g, 0, next);
      eq(radion.location, how === 'set' ? 'mzone' : 'grave', how === 'set' ? 'Radion Special Summoned' : 'no Special Summon');
    });
  }

  // https://edisonrul.ing/cards/m/morphtronic-map.html — "If multiple monsters have their battle positions changed at
  // the same time, only 1 Morph Counter is placed on this card."
  await test('Morphtronic Map: one Morph Counter for monsters changed at the same time', async () => {
    const { g, place } = newGame(T.wall);
    const map = place(0, N('Morphtronic Map'), 'fzone');
    const a = place(0, T.brute, 'mzone');
    const b = place(1, T.brute, 'mzone');
    const link = {} as any;
    g.resolvingLink = link;
    await g.changePosition(a, 'def', true);
    await g.changePosition(b, 'def', true);
    g.resolvingLink = null;
    eq(map.counters.morph ?? 0, 1, 'one counter for one effect');
    await g.changePosition(a, 'atk', true);
    eq(map.counters.morph ?? 0, 2, 'a separate change adds another');
  });

  // https://edisonrul.ing/cards/c/code-a-ancient-ruins.html — "The ② Ignition-like Effect targets an 'Alien' monster in
  // your Graveyard"; "This card must remain face-up on the field in order to resolve this effect."
  await test('Code A Ancient Ruins: the revive targets, and needs Code A on the field to resolve', async () => {
    const s = newGame(T.wall);
    const code = s.place(0, N('Code A Ancient Ruins'), 'szone', { faceUp: true });
    code.counters.A = 2;
    const kid = s.place(0, N('Alien Kid'), 'grave');
    s.place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    let targeted = false;
    s.c1.respond = (g, req) => {
      const top = g.chain[g.chain.length - 1];
      if (top?.card === code && top.ctx.targets.includes(kid)) targeted = true;
      return top?.card === code ? respondWith('Mystical Space Typhoon')(g, req) : null;
    };
    s.c1.pick = (_g, req) => (req.candidates.includes(code) ? [code] : req.candidates.slice(0, req.min));
    await activate(s.g, 0, code);
    eq(targeted, true, 'Alien Kid was targeted on activation');
    eq(code.location, 'grave', 'Code A destroyed in response');
    eq(kid.location, 'grave', 'nothing is Special Summoned');
  });

  // https://edisonrul.ing/cards/c/code-a-ancient-ruins.html — "No A-Counter is placed on this card if an 'Alien' monster
  // [is] face-down when an attack is declared."
  for (const set of [true, false]) {
    await test(`Code A Ancient Ruins: ${set ? 'no' : 'an'} A-Counter when ${set ? 'a Set' : 'a face-up'} Alien is destroyed by battle`, async () => {
      const { g, c0, place } = newGame(T.wall);
      const code = place(1, N('Code A Ancient Ruins'), 'szone', { faceUp: true });
      const att = place(0, N('Goyo Guardian'), 'mzone');
      const kid = place(1, N('Alien Kid'), 'mzone', set ? { faceUp: false, pos: 'def' } : {});
      g.phase = 'battle';
      c0.aim = kid;
      c0.confirmAnswer = false; // Goyo does not take it
      await g.conductAttack(0, att);
      eq(kid.location, 'grave', 'Alien Kid destroyed');
      eq(code.counters.A ?? 0, set ? 0 : 1, 'A-Counters on Code A');
    });
  }

  // https://edisonrul.ing/cards/a/alien-kid.html — "If this card is not on the field, a monster with an A-Counter won't
  // lose ATK when battling an 'Alien'" (the rule applies to any Alien's battle while Kid is face-up);
  // https://edisonrul.ing/cards/a/alien-grey.html — 2 cards with the A-Counter text stack.
  await test('Alien Kid: the A-Counter rule applies to other Aliens, and stacks', async () => {
    for (const kids of [0, 1, 2]) {
      const { g, c0, place } = newGame(T.wall);
      const att = place(0, N('Alien Ammonite'), 'mzone'); // 500, no A-Counter text of its own
      for (let i = 0; i < kids; i++) place(0, N('Alien Kid'), 'mzone', { pos: 'def' });
      const foe = place(1, T.seven, 'mzone'); // 700
      foe.counters.A = 1;
      c0.aim = foe;
      g.phase = 'battle';
      await g.conductAttack(0, att);
      if (kids === 0) eq(att.location, 'grave', 'no Kid: Ammonite loses to the 700 ATK monster');
      else eq(foe.location, 'grave', `${kids} Kid(s): it loses ${300 * kids} ATK and is destroyed`);
      if (kids > 0) eq(g.players[1].lp, 8000 - (500 - (700 - 300 * kids)), `${kids} Kid(s): battle damage`);
    }
  });

  // https://edisonrul.ing/cards/a/alien-ammonite.html — Ammonite has no A-Counter battle text.
  await test('Alien Ammonite: no A-Counter ATK loss from Ammonite', async () => {
    const { g, c0, place } = newGame(T.wall);
    const amm = place(0, N('Alien Ammonite'), 'mzone'); // 500
    const foe = place(1, N('Morphtronic Celfon'), 'mzone'); // 100 ATK
    foe.counters.A = 1;
    c0.aim = foe;
    g.phase = 'battle';
    await g.conductAttack(0, amm);
    eq(g.players[1].lp, 8000 - 400, 'Celfon fought at its full 100 ATK');
  });

  // https://edisonrul.ing/cards/h/hyper-psychic-blaster.html — "This effect activates in Substep 7 - End of the Damage
  // Step, even if this card is no longer face-up."
  await test('Hyper Psychic Blaster: gains LP even if it left the field during the Damage Step', async () => {
    const { g, c0, c1, place } = newGame(T.wall);
    const hpb = place(0, N('Hyper Psychic Blaster'), 'mzone');
    const ryko = place(1, N('Ryko, Lightsworn Hunter'), 'mzone', { faceUp: false, pos: 'def' });
    c0.aim = ryko;
    c1.pick = (_g, req) => (req.candidates.includes(hpb) ? [hpb] : req.candidates.slice(0, req.min));
    g.phase = 'battle';
    await g.conductAttack(0, hpb);
    eq(hpb.location, 'grave', "Ryko's flip effect destroyed it");
    eq(g.players[0].lp, 8000 + 2900, 'gains 2900 (its printed 3000 ATK minus Ryko 100 DEF)');
  });

  // https://edisonrul.ing/cards/e/elemental-hero-ocean.html (revised section; the historical one is silent) — "You can
  // target 1 'HERO' monster you control or in your GY"
  await test('Elemental Hero Ocean: targets the HERO it returns', async () => {
    const { g, c1, place } = newGame(T.wall);
    const ocean = place(0, N('Elemental Hero Ocean'), 'mzone');
    const h = place(0, T.hero, 'grave');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top?.card === ocean && top.ctx.targets.includes(h)) targeted = true;
      return null;
    };
    await setPhase(g, 'standby');
    eq(targeted, true, 'targeted on activation');
    eq(h.location, 'hand', 'returned to the hand');
  });

  // https://edisonrul.ing/cards/m/morphtronic-slingen.html (revised section; the historical one is silent) — "Tribute 1
  // 'Morphtronic' monster ... then target 1 card on the field; destroy it."
  await test('Morphtronic Slingen: targets the card it destroys', async () => {
    const { g, c0, c1, place } = newGame(T.wall);
    const sl = place(0, N('Morphtronic Slingen'), 'mzone');
    const fodder = place(0, N('Morphtronic Radion'), 'mzone');
    const foe = place(1, T.brute, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => (req.candidates.includes(fodder) ? [fodder] : req.candidates.includes(foe) ? [foe] : req.candidates.slice(0, req.min));
    let targeted = false;
    c1.respond = (gg) => {
      const top = gg.chain[gg.chain.length - 1];
      if (top?.card === sl && top.ctx.targets.includes(foe)) targeted = true;
      return null;
    };
    await activate(g, 0, sl);
    eq(targeted, true, 'targeted on activation');
    eq(foe.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/p/prevention-star.html — "can be equipped to any monster that was changed from face-up
  // Attack Position to face-up Defense position this turn, even if the monster is currently in Attack Position"
  await test('Prevention Star: equips to a monster changed to Defense and back to Attack this turn', async () => {
    const { g, place } = newGame(T.wall);
    const m = place(0, T.brute, 'mzone');
    const foe = place(1, T.brute, 'mzone');
    const ps = place(0, N('Prevention Star'), 'hand');
    await g.changePosition(m, 'def', true);
    await g.changePosition(m, 'atk', true);
    await activate(g, 0, ps);
    eq(ps.location, 'szone', 'Prevention Star stays as an Equip');
    eq(g.queryCard(foe, 'cannotAttack'), true, 'the selected monster cannot attack');
  });

  // https://edisonrul.ing/cards/t/turret-warrior.html — "Tributing a Warrior to Special Summon 'Turret Warrior' is not a
  // cost; both the Tribute and the ATK increase are part of the effect."
  await test('Turret Warrior: the Tribute is not a cost', async () => {
    const { g, place } = newGame(T.wall);
    const tw = place(0, N('Turret Warrior'), 'hand');
    const w = place(0, T.brute, 'mzone');
    const act = g.legalMainActions(0).find((a) => a.type === 'proc' && (a as any).card === tw);
    if (!act) throw new Error('Turret Warrior proc not offered');
    await g.performAction(0, act);
    eq(tw.location, 'mzone', 'Special Summoned');
    eq(g.getAtk(tw), 3000, 'gains the Tributed ATK');
    const ev = g.eventLog.find((e) => e.type === 'tributed' && e.card === w);
    eq(!!ev, true, 'tributed event');
    eq((ev!.reasons ?? []).includes('cost'), false, 'not a cost');
  });

  report();
})();
