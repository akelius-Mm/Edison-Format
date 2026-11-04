// Rulings regression tests, DB audit group 1 (ABPF, archetype extras, Blackwings, core): each test pins a behaviour to
// the 2010 TCG text / rulings on edisonrul.ing (Edisonformat.com historical section unless a comment says otherwise).
// Usage: npx tsx scripts/rulings/db-audit-1.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { monster, normal, token } from '../../src/cards/define';
import type { CardInstance, EffectDef } from '../../src/engine/card';
import { Ctx } from '../../src/engine/ctx';
import type { Game } from '../../src/engine/game';
import type { Phase, PlayerId } from '../../src/engine/types';
import { activate, canActivate, eq, newGame, report, respondWith, test } from '../lib/harness';

const N = (n: string) => cardByName(n);
const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  lv1: findCard('DB1 Level 1') ?? normal('DB1 Level 1', 'EARTH', 'Warrior', 1, 100, 100),
  even: findCard('DB1 Even 2300') ?? normal('DB1 Even 2300', 'EARTH', 'Warrior', 4, 2300, 1000),
  big: findCard('DB1 Big') ?? normal('DB1 Big', 'EARTH', 'Warrior', 4, 2500, 1000),
  machine: findCard('DB1 Machine') ?? normal('DB1 Machine', 'EARTH', 'Machine', 2, 300, 300),
  synchro:
    findCard('DB1 Synchro') ??
    monster('DB1 Synchro', { attribute: 'EARTH', race: 'Warrior', level: 4, atk: 2000, def: 1000, types: ['synchro'], synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' } }),
  // Test helper: removes "Reptilianne Naga" from the field right after damage calculation (substep 5).
  nagaKiller:
    findCard('DB1 Naga Remover') ??
    monster('DB1 Naga Remover', {
      attribute: 'EARTH',
      race: 'Warrior',
      level: 1,
      atk: 0,
      def: 0,
      effects: [
        {
          kind: 'trigger',
          event: 'damageCalculated',
          eventFilter: (ctx, ev) => {
            for (const c of [ev.card, ev.other] as CardInstance[]) if (c?.name === 'Reptilianne Naga' && c.location === 'mzone') ctx.game.rawMove(c, 'grave');
            return false;
          },
        },
      ],
    }),
  token: findCard('DB1 Token') ?? token('DB1 Token', 'EARTH', 'Rock', 1, 0, 0),
  // +1000 ATK to every monster its controller's opponent controls (a continuous modifier, like an Equip Spell).
  booster:
    findCard('DB1 Booster') ??
    monster('DB1 Booster', {
      attribute: 'EARTH',
      race: 'Warrior',
      level: 1,
      atk: 0,
      def: 0,
      text: 'Monsters your opponent controls gain 1000 ATK.',
      effects: [{ kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: CardInstance) => c.controller !== ctx.player, value: 1000 }] }],
    }),
};

const setPhase = (g: Game, ph: Phase) => (g as any).setPhase(ph) as Promise<void>;
const ctxFor = (g: Game, c: CardInstance, i = 0, p: PlayerId = c.controller) => new Ctx(g, c, (c.data.effects as EffectDef[])[i], p);
const activations = (g: Game, c: CardInstance) => g.eventLog.filter((e) => e.type === 'chainActivated' && e.card === c).length;

(async () => {
  console.log('Rulings tests (DB audit group 1)');

  // https://edisonrul.ing/cards/m/majestic-dragon.html
  await test('Majestic Red Dragon: can be Synchro Summoned with "Majestic Dragon" + "Red Dragon Archfiend" + 1 non-Tuner', async () => {
    const { g, place } = newGame(T.wall);
    place(0, N('Majestic Dragon'), 'mzone');
    place(0, N('Red Dragon Archfiend'), 'mzone');
    place(0, T.lv1, 'mzone');
    const mrd = place(0, N('Majestic Red Dragon'), 'extra');
    eq(mrd.inSet('majestic'), true, 'a "Majestic" monster');
    eq(g.synchroCombos(0, mrd).length, 1, 'one material combination');
  });

  // https://edisonrul.ing/cards/m/majestic-red-dragon.html (Revised section)
  await test('Majestic Red Dragon: cannot target an already-negated monster; returns to the Extra Deck with no RDA in the GY', async () => {
    const { g, place } = newGame(T.wall);
    const mrd = place(0, N('Majestic Red Dragon'), 'mzone');
    const s = place(1, N('Sangan'), 'mzone');
    eq(canActivate(g, 0, mrd, 'Negate & absorb ATK'), true, 'can target an Effect Monster');
    s.flags.negatedTurn = g.turn;
    eq(canActivate(g, 0, mrd, 'Negate & absorb ATK'), false, 'not an already-negated one');
    await setPhase(g, 'end');
    eq(mrd.location, 'extra', 'returned to the Extra Deck');
  });

  // https://edisonrul.ing/cards/d/dark-armed-dragon.html
  await test('Dark Armed Dragon: cannot be Special Summoned from the GY or removed from play, even if properly Summoned', async () => {
    const { g, place } = newGame(T.wall);
    const d1 = place(0, N('Dark Armed Dragon'), 'grave');
    d1.properlySummoned = true;
    const d2 = place(0, N('Dark Armed Dragon'), 'banished');
    d2.properlySummoned = true;
    const helper = place(0, T.wall, 'mzone');
    const ctx = new Ctx(g, helper, { kind: 'ignition' } as EffectDef, 0);
    eq(ctx.canSummonCard(d1), false, 'not from the GY');
    eq(ctx.canSummonCard(d2), false, 'not from banishment');
    eq((await g.specialSummon([d1], 0, {})).length, 0, 'Special Summon from the GY fails');
  });

  // https://edisonrul.ing/cards/r/reptilianne-vaskii.html
  await test('Reptilianne Vaskii: cannot be Special Summoned from the Deck / GY; a target flipped face-down is not destroyed', async () => {
    const { g, c1, place } = newGame(T.wall);
    const vd = place(0, N('Reptilianne Vaskii'), 'deck');
    const vg = place(0, N('Reptilianne Vaskii'), 'grave');
    vg.properlySummoned = true;
    eq((await g.specialSummon([vd], 0, {})).length, 0, 'not from the Deck');
    eq((await g.specialSummon([vg], 0, {})).length, 0, 'not from the GY');

    const v = place(0, N('Reptilianne Vaskii'), 'mzone');
    const t = place(1, T.brute, 'mzone');
    place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Book of Moon');
    c1.pick = (_g, req) => (req.candidates.includes(t) ? [t] : req.candidates.slice(0, req.min));
    await activate(g, 0, v, 'Destroy 1 monster');
    eq(t.faceUp, false, 'flipped face-down by Book of Moon');
    eq(t.location, 'mzone', 'not destroyed');
  });

  // https://edisonrul.ing/cards/b/bottomless-trap-hole.html
  await test('Bottomless Trap Hole: the monster is removed from play without ever being sent to the GY', async () => {
    const { g, c1, place } = newGame(T.wall);
    const s = place(0, T.brute, 'hand');
    place(1, N('Bottomless Trap Hole'), 'szone', { faceUp: false });
    c1.respond = respondWith('Bottomless Trap Hole');
    await g.normalSummon(0, s, false);
    eq(s.location, 'banished', 'removed from play');
    eq(g.eventLog.some((e) => e.type === 'sentToGrave' && e.card === s), false, 'never sent to the GY');
    eq(g.eventLog.some((e) => e.type === 'destroyed' && e.card === s), true, 'destroyed');
  });

  // https://edisonrul.ing/cards/b/blackwing-gale-the-whirlwind.html
  await test('Blackwing - Gale the Whirlwind: the halved ATK/DEF are locked; earlier modifiers leaving do not change them', async () => {
    const { g, place } = newGame(T.wall);
    const gale = place(0, N('Blackwing - Gale the Whirlwind'), 'mzone');
    const boost = place(0, T.booster, 'mzone');
    const t = place(1, T.brute, 'mzone');
    eq(g.getAtk(t), 2800, 'boosted');
    await activate(g, 0, gale, 'Halve ATK/DEF');
    eq(g.getAtk(t), 1400, 'ATK halved');
    eq(g.getDef(t), 500, 'DEF halved');
    g.rawMove(boost, 'grave');
    g.update();
    eq(g.getAtk(t), 1400, 'still 1400 after the booster left');
    g.addTempMod(t, 'atk', 300, 'turn');
    eq(g.getAtk(t), 1700, 'later modifiers still apply');
  });

  // https://edisonrul.ing/cards/b/blackwing-sirocco-the-dawn.html
  await test('Blackwing - Sirocco the Dawn: with the target gone at resolution, your other monsters still cannot attack', async () => {
    const { g, c0, c1, place } = newGame(T.wall);
    const sir = place(0, N('Blackwing - Sirocco the Dawn'), 'mzone');
    const bora = place(0, N('Blackwing - Bora the Spear'), 'mzone');
    eq(g.canAttack(sir), true, 'can attack before');
    place(1, N('Book of Moon'), 'szone', { faceUp: false }); // gives the opponent a response window
    c0.pick = (_g, req) => (req.candidates.includes(bora) ? [bora] : req.candidates.slice(0, req.min));
    c1.respond = (gg) => {
      if (bora.location === 'mzone' && gg.chain.some((l) => l.card === sir)) gg.rawMove(bora, 'grave');
      return null;
    };
    await activate(g, 0, sir, 'Gather Blackwing ATK');
    eq(bora.location, 'grave', 'target gone');
    eq(g.canAttack(sir), false, 'Sirocco cannot attack');
  });

  // https://edisonrul.ing/cards/b/book-of-moon.html
  await test('Book of Moon: a Monster Token cannot be flipped face-down', async () => {
    const { g, place } = newGame(T.wall);
    place(1, T.token, 'mzone');
    const bom = place(0, N('Book of Moon'), 'szone', { faceUp: false });
    eq(canActivate(g, 0, bom), false, 'no legal target');
    place(1, T.brute, 'mzone');
    eq(canActivate(g, 0, bom), true, 'a non-Token monster can be targeted');
  });

  // https://edisonrul.ing/cards/o/offering-to-the-immortals.html
  await test('Offering to the Immortals: needs 2 open Monster Zones and an "Earthbound Immortal" card in the Deck', async () => {
    const { g, place } = newGame(T.wall);
    const off = place(0, N('Offering to the Immortals'), 'szone', { faceUp: false });
    const ef = off.data.effects![0];
    const ok = () => ef.canActivate!(new Ctx(g, off, ef, 0));
    eq(ok(), false, 'no "Earthbound Immortal" in the Deck');
    place(0, N('Earthbound Immortal Uru'), 'deck');
    eq(ok(), true, 'with one in the Deck');
    for (let i = 0; i < 4; i++) place(0, T.wall, 'mzone');
    eq(ok(), false, 'only 1 open Monster Zone');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-beast.html
  await test('Ancient Gear Beast: cannot be Special Summoned', async () => {
    const { g, place } = newGame(T.wall);
    const b = place(0, N('Ancient Gear Beast'), 'grave');
    b.properlySummoned = true;
    eq((await g.specialSummon([b], 0, {})).length, 0, 'not from the GY');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-beast.html
  await test('Ancient Gear Beast: a monster it destroys by battle has its GY effects negated (Sangan, Treeborn Frog)', async () => {
    const { g, place } = newGame(T.wall);
    const beast = place(0, N('Ancient Gear Beast'), 'mzone');
    const s = place(1, N('Sangan'), 'mzone');
    place(1, T.lv1, 'deck');
    const hand = g.players[1].hand.length;
    await g.conductAttack(0, beast);
    eq(s.location, 'grave', 'Sangan destroyed');
    eq(g.players[1].hand.length, hand, 'no search');

    const frog = place(1, N('Treeborn Frog'), 'mzone');
    await g.conductAttack(0, beast);
    eq(frog.location, 'grave', 'Treeborn Frog destroyed');
    g.turnPlayer = 1;
    await setPhase(g, 'standby');
    eq(frog.location, 'grave', 'Treeborn Frog does not revive');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-engineer.html
  await test('Ancient Gear Engineer: a Trap that targets it is negated and destroyed', async () => {
    const { g, c1, place } = newGame(T.wall);
    const eng = place(0, N('Ancient Gear Engineer'), 'mzone');
    const chain = place(1, N('Fiendish Chain'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    c1.pick = (_g, req) => (req.candidates.includes(eng) ? [eng] : req.candidates.slice(0, req.min));
    await activate(g, 1, chain);
    eq(g.isNegated(eng), false, 'not negated');
    eq(chain.location, 'grave', 'Fiendish Chain destroyed');
  });

  // https://edisonrul.ing/cards/a/ancient-gear-gadjiltron-chimera.html
  await test('Ancient Gear Gadjiltron Chimera: the "Yellow Gadget" burn activates even if it is destroyed in the same battle', async () => {
    const { g, place } = newGame(T.wall);
    place(0, N('Yellow Gadget'), 'mzone');
    const ch = place(0, N('Ancient Gear Gadjiltron Chimera'), 'hand');
    await g.normalSummon(0, ch, false);
    eq(ch.location, 'mzone', 'Tribute Summoned');
    const t = place(1, T.even, 'mzone');
    await g.conductAttack(0, ch);
    eq(ch.location, 'grave', 'Chimera destroyed');
    eq(t.location, 'grave', 'opponent monster destroyed');
    eq(g.players[1].lp, 8000 - 700, '700 damage');
  });

  // https://edisonrul.ing/cards/e/evil-hero-infernal-prodigy.html
  await test('Evil HERO Infernal Prodigy: no draw for a Tribute Set; draws for a Tribute Summon even if then removed from play', async () => {
    for (const set of [true, false]) {
      const { g, place } = newGame(T.wall);
      const p = place(0, N('Evil HERO Infernal Prodigy'), 'mzone');
      const hero = place(0, N('Destiny Hero - Malicious'), 'hand');
      await g.normalSummon(0, hero, set);
      eq(p.location, 'grave', 'Prodigy Tributed');
      if (!set) await g.banish([p], 'effect', 1);
      const before = g.players[0].hand.length;
      await setPhase(g, 'end');
      eq(g.players[0].hand.length, before + (set ? 0 : 1), set ? 'no draw after a Tribute Set' : 'draws 1');
    }
  });

  // https://edisonrul.ing/cards/s/sangan.html
  await test('Sangan: no search when its Summon is negated', async () => {
    const { g, c1, place } = newGame(T.wall);
    const s = place(0, N('Sangan'), 'hand');
    place(0, T.lv1, 'deck');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await g.normalSummon(0, s, false);
    await g.processTriggers(false);
    eq(s.location, 'grave', 'Summon negated');
    eq(g.players[0].hand.length, 0, 'no search');
  });

  // https://edisonrul.ing/cards/d/delta-crow-anti-reverse.html
  await test('Delta Crow - Anti Reverse: still destroys if you no longer control a "Blackwing" monster when it resolves', async () => {
    const { g, c1, place } = newGame(T.wall);
    const bw = place(0, N('Blackwing - Bora the Spear'), 'mzone');
    const dc = place(0, N('Delta Crow - Anti Reverse'), 'szone', { faceUp: false });
    const st = place(1, N('Book of Moon'), 'szone', { faceUp: false });
    c1.respond = (gg) => {
      if (bw.location === 'mzone' && gg.chain.some((l) => l.card === dc)) gg.rawMove(bw, 'grave');
      return null;
    };
    await activate(g, 0, dc);
    eq(bw.location, 'grave', 'Blackwing gone');
    eq(st.location, 'grave', 'Set card destroyed');
  });

  // https://edisonrul.ing/cards/b/backs-to-the-wall.html
  await test('Backs to the Wall: no monster with the same name as a monster on either side of the field', async () => {
    const { g, place } = newGame(T.wall);
    place(1, N('The Six Samurai - Yaichi'), 'mzone');
    const y = place(0, N('The Six Samurai - Yaichi'), 'grave');
    const k = place(0, N('The Six Samurai - Kamon'), 'grave');
    const btw = place(0, N('Backs to the Wall'), 'szone', { faceUp: false });
    await activate(g, 0, btw);
    eq(g.players[0].lp, 100, 'LP paid');
    eq(k.location, 'mzone', 'Kamon Summoned');
    eq(y.location, 'grave', 'not Yaichi (the opponent controls one)');
  });

  // https://edisonrul.ing/cards/c/chimera-the-flying-mythical-beast.html
  await test('Chimera the Flying Mythical Beast: revives when destroyed as a Spell & Trap Zone card; not a "Phantom Beast"', async () => {
    const { g, c0, place } = newGame(T.wall);
    const ch = place(0, N('Chimera the Flying Mythical Beast'), 'szone', { faceUp: true });
    const b = place(0, N('Berfomet'), 'grave');
    eq(ch.inSet('phantom-beast'), false, 'not a Phantom Beast');
    await g.destroy([ch], 'effect', 1);
    await g.processTriggers(true);
    eq(c0.triggersAsked.includes(ch.name), true, 'asked');
    eq(b.location, 'mzone', 'Berfomet revived');
  });

  // https://edisonrul.ing/cards/t/the-six-samurai-yaichi.html
  await test('Six Samurai: no substitute that is destroyed at the same time; one destroyed alone can be substituted', async () => {
    const a = newGame(T.wall);
    const y = a.place(0, N('The Six Samurai - Yaichi'), 'mzone');
    const k = a.place(0, N('The Six Samurai - Kamon'), 'mzone');
    await a.g.destroy([y, k], 'effect', 1);
    eq(y.location, 'grave', 'Yaichi destroyed');
    eq(k.location, 'grave', 'Kamon destroyed');

    const b = newGame(T.wall);
    const y2 = b.place(0, N('The Six Samurai - Yaichi'), 'mzone');
    const k2 = b.place(0, N('The Six Samurai - Kamon'), 'mzone');
    b.c0.pick = (_g, req) => (req.candidates.includes(k2) ? [k2] : req.candidates.slice(0, req.min));
    await b.g.destroy([y2], 'effect', 1);
    eq(y2.location, 'mzone', 'Yaichi saved');
    eq(k2.location, 'grave', 'Kamon destroyed instead');
  });

  // https://edisonrul.ing/cards/v/viser-des.html
  await test('Viser Des: its effect no longer applies once the opponent takes control of it', async () => {
    const { g, place } = newGame(T.wall);
    const t = place(1, T.brute, 'mzone');
    const vd = place(0, N('Viser Des'), 'hand');
    await g.normalSummon(0, vd, false);
    eq(g.queryCard(vd, 'indestructibleBattle'), true, 'protected while the target is on the field');
    void t;
    await g.takeControl(vd, 1, true);
    eq(g.queryCard(vd, 'indestructibleBattle'), false, 'not under the opponent\'s control');
  });

  // https://edisonrul.ing/cards/s/spiders-lair.html
  await test("Spiders' Lair: a targeted Insect flipped face-down is no longer targeted; no lock for a monster already in DEF", async () => {
    const { g, place } = newGame(T.wall);
    const lair = place(0, N("Spiders' Lair"), 'szone', { faceUp: true });
    const ins = place(0, N('Insect Knight'), 'mzone');
    await activate(g, 0, lair, 'Select an Insect');
    eq((lair.flags.lair ?? []).length, 1, 'Insect targeted');
    await g.changePosition(ins, 'def', false);
    eq((lair.flags.lair ?? []).length, 0, 'no longer targeted after being flipped face-down');

    const d = place(1, T.wall, 'mzone', { pos: 'def' });
    lair.flags.lairPending = [{ uid: d.uid, moveId: d.moveId, c: d }];
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: 0 } as any);
    await g.processTriggers(false);
    eq(d.pos, 'def', 'still in Defense Position');
    eq(g.queryCard(d, 'cannotChangePos'), false, 'not locked: Spiders\' Lair did not change it');
  });

  // https://edisonrul.ing/cards/g/gundari.html
  await test('Gundari: battling a Synchro Monster returns both at the start of the Damage Step (mandatory)', async () => {
    const { g, c0, place } = newGame(T.wall);
    const gun = place(0, N('Gundari'), 'mzone');
    const sy = place(1, T.synchro, 'mzone');
    await g.conductAttack(0, gun);
    eq(gun.location, 'hand', 'Gundari returned');
    eq(sy.location, 'extra', 'Synchro returned to the Extra Deck');
    eq(c0.triggersAsked.includes('Gundari'), false, 'mandatory');
    eq(g.players[1].lp, 8000, 'no damage calculation');
  });

  // https://edisonrul.ing/cards/r/rose-fairy.html
  await test('Rose Fairy: its effect cannot be activated during the Damage Step', async () => {
    const { g, place } = newGame(T.wall);
    const rf = place(0, N('Rose Fairy'), 'hand');
    const a = place(0, T.brute, 'mzone');
    const ctx = ctxFor(g, rf, 0, 0);
    eq(rf.data.effects![0].condition!(ctx), true, 'outside the Damage Step');
    g.battle = { attacker: a, target: null, inDamageStep: true } as any;
    eq(rf.data.effects![0].condition!(ctx), false, 'not in the Damage Step');
    g.battle = null;
  });

  // https://edisonrul.ing/cards/c/card-trooper.html, https://edisonrul.ing/cards/b/brionac-dragon-of-the-ice-barrier.html
  await test('Card Trooper / Brionac: their costs cannot be paid while "Macro Cosmos" (or "Dimensional Fissure") applies', async () => {
    const a = newGame(T.wall);
    const ct = a.place(0, N('Card Trooper'), 'mzone');
    const br = a.place(0, N('Brionac, Dragon of the Ice Barrier'), 'mzone');
    a.place(0, T.lv1, 'hand');
    a.place(1, T.brute, 'mzone');
    eq(canActivate(a.g, 0, ct, 'Mill up to 3'), true, 'Card Trooper usable');
    eq(canActivate(a.g, 0, br, 'Discard & bounce'), true, 'Brionac usable');
    a.place(1, N('Macro Cosmos'), 'szone', { faceUp: true });
    a.g.update();
    eq(canActivate(a.g, 0, ct, 'Mill up to 3'), false, 'Card Trooper under Macro Cosmos');
    eq(canActivate(a.g, 0, br, 'Discard & bounce'), false, 'Brionac under Macro Cosmos');

    const b = newGame(T.wall);
    const ct2 = b.place(0, N('Card Trooper'), 'mzone');
    b.place(1, N('Dimensional Fissure'), 'szone', { faceUp: true });
    b.g.update();
    eq(canActivate(b.g, 0, ct2, 'Mill up to 3'), false, 'Card Trooper under Dimensional Fissure');
  });

  // https://edisonrul.ing/cards/b/blackwing-mistral-the-silver-shield.html
  await test('Blackwing - Mistral the Silver Shield: only the next battle damage this turn becomes 0', async () => {
    const { g, place } = newGame(T.wall);
    const m = place(0, N('Blackwing - Mistral the Silver Shield'), 'mzone');
    await g.destroy([m], 'effect', 1);
    await g.processTriggers(false);
    g.turnPlayer = 1;
    const a1 = place(1, T.brute, 'mzone');
    const a2 = place(1, T.brute, 'mzone');
    await g.conductAttack(1, a1);
    eq(g.players[0].lp, 8000, 'first battle damage is 0');
    await g.conductAttack(1, a2);
    eq(g.players[0].lp, 8000 - 1800, 'second battle damage applies');
  });

  // https://edisonrul.ing/cards/r/reptilianne-naga.html
  await test('Reptilianne Naga: the ATK of the monster it battled still becomes 0 if Naga left the field during the Damage Step', async () => {
    const { g, c1, place } = newGame(T.wall);
    const naga = place(0, N('Reptilianne Naga'), 'mzone');
    place(0, T.nagaKiller, 'mzone');
    g.turnPlayer = 1;
    const a = place(1, T.brute, 'mzone');
    c1.aim = naga;
    await g.conductAttack(1, a);
    eq(naga.location, 'grave', 'Naga left the field in the Damage Step');
    await setPhase(g, 'main2');
    eq(g.getAtk(a), 0, 'ATK became 0');
  });

  // https://edisonrul.ing/cards/b/break-draw.html
  await test('Break! Draw!: destroying it in your 3rd End Phase does not start a Chain', async () => {
    const { g, place } = newGame(T.wall);
    const m = place(0, T.machine, 'mzone');
    const bd = place(0, N('Break! Draw!'), 'szone', { faceUp: true });
    g.equip(bd, m);
    bd.flags.breakDrawEnds = 2;
    await setPhase(g, 'end');
    eq(bd.location, 'grave', 'destroyed');
    eq(activations(g, bd), 0, 'no Chain');
  });

  // https://edisonrul.ing/cards/i/inverse-universe.html
  await test('Inverse Universe: the switched ATK/DEF stay frozen when a modifier that applied before leaves', async () => {
    const { g, place } = newGame(T.wall);
    const boost = place(0, T.booster, 'mzone');
    const s = place(1, N('Sangan'), 'mzone');
    eq(g.getAtk(s), 2000, 'boosted');
    const iu = place(0, N('Inverse Universe'), 'szone', { faceUp: false });
    await activate(g, 0, iu);
    eq(g.getAtk(s), 600, 'ATK = old DEF');
    eq(g.getDef(s), 2000, 'DEF = old ATK');
    g.rawMove(boost, 'grave');
    g.update();
    eq(g.getAtk(s), 600, 'ATK unchanged after the booster left');
    eq(g.getDef(s), 2000, 'DEF unchanged');
  });

  // https://edisonrul.ing/cards/r/rocket-pilder.html
  await test('Rocket Pilder: its effect activates even if the equipped monster destroyed its attack target', async () => {
    const { g, place } = newGame(T.wall);
    const a = place(0, T.brute, 'mzone');
    const rp = place(0, N('Rocket Pilder'), 'szone', { faceUp: true });
    g.equip(rp, a);
    const t = place(1, T.lv1, 'mzone');
    await g.conductAttack(0, a);
    eq(t.location, 'grave', 'target destroyed');
    eq(activations(g, rp), 1, 'the effect started a Chain');
  });

  // https://edisonrul.ing/cards/m/machine-duplication.html
  await test('Machine Duplication: cannot target a Machine with no copy in the Deck', async () => {
    const { g, c0, place } = newGame(T.wall);
    const lone = place(0, N('Card Trooper'), 'mzone');
    const m = place(0, T.machine, 'mzone');
    const copy = place(0, T.machine, 'deck');
    const md = place(0, N('Machine Duplication'), 'hand');
    const offered: CardInstance[] = [];
    c0.pick = (_g, req) => {
      offered.push(...req.candidates);
      return req.candidates.includes(m) ? [m] : req.candidates.slice(0, Math.max(1, req.min));
    };
    await activate(g, 0, md);
    eq(offered.includes(lone), false, 'Card Trooper (no copy in the Deck) not offered');
    eq(copy.location, 'mzone', 'the copy of the other Machine is Special Summoned');
  });

  report();
})();
