// Card definitions: Hidden Arsenal (HA01).
//
// Every HA01 card that was not already in the pool. Stats, Types and card text come from the
// YGOJSON v1 dataset (official English text). Behaviour follows the 2010 TCG rulings.
// Cards already defined elsewhere: Flamvell Magician, Flamvell Uruquizas (tournament-extras.ts),
// X-Saber Airbellum, X-Saber Uruz (sabers.ts), Brionac (core.ts), Mist Wurm, Ally of Justice
// Catastor (extra.ts).
//
// Approximations are marked "APPROX:" next to the card.
import { monster, spell } from '../define';
import { bestTarget, cardValue, flip, selfDestroysByBattle } from '../helpers';
import type { CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { GameEvent } from '../../engine/types';

type C = CardInstance;

// ============================================================ shared helpers

const IB = ['ice-barrier'];
const MV = ['mist-valley'];
const FV = ['flamvell'];
const XS = ['x-saber'];
const AOJ = ['ally-of-justice'];
const WORM = ['worm'];

const isIceBarrier = (c: C) => c.isMonster && (c.inSet('ice-barrier') || c.name.includes('of the Ice Barrier'));
/** "Saber" monsters: X-Saber / XX-Saber and anything else with "Saber" in its name. */
const isSaber = (c: C) => c.isMonster && (c.inSet('x-saber') || c.name.includes('Saber'));
/** Reptile-Type "Worm" monster. */
const isReptileWorm = (c: C) => c.isMonster && c.data.race === 'Reptile' && (c.inSet('worm') || c.name.startsWith('Worm '));

/** The monster this card is battling (if any). */
function battlePartner(ctx: Ctx): C | null {
  const b = ctx.battle;
  if (!b || !b.target) return null;
  if (b.attacker === ctx.self) return b.target;
  if (b.target === ctx.self) return b.attacker;
  return null;
}

/** "If this card battles a LIGHT monster, it gains N ATK during the Damage Step only." */
function lightHunter(n: number) {
  return {
    kind: 'continuous' as const,
    mods: [
      {
        q: 'atk' as const,
        value: (ctx: Ctx) => {
          if (!ctx.battle?.inDamageStep) return 0;
          const o = battlePartner(ctx);
          return o && o.location === 'mzone' && o.faceUp && o.data.attribute === 'LIGHT' ? n : 0;
        },
      },
    ],
  };
}

/** This card was destroyed by battle and is now in the GY. */
const selfBattleToGrave = (ctx: Ctx, ev: GameEvent) => ev.card === ctx.self && ctx.self.location === 'grave';

// ============================================================ ICE BARRIER / WATER

monster('Blizzed, Defender of the Ice Barrier', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 1,
  atk: 300,
  def: 500,
  sets: IB,
  aiValue: 300,
  text: 'If this card is destroyed by battle and sent to the GY: Draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: selfBattleToGrave,
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Blizzard Warrior', {
  attribute: 'WATER',
  race: 'Warrior',
  level: 3,
  atk: 1400,
  def: 400,
  aiValue: 100,
  text: "If this card destroys an opponent's monster by battle: Look at the top card of their Deck and place it on the top or bottom of the Deck.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: "Look at the top of the opponent's Deck",
      categories: ['toDeck'],
      eventFilter: selfDestroysByBattle,
      resolve: async (ctx) => {
        const deck = ctx.game.players[ctx.opp].deck;
        const top = deck[deck.length - 1];
        if (!top) return;
        // Only the activating player sees the card (the prompt names it; the log does not).
        const v = cardValue(ctx.game, top);
        const weak = top.isMonster && !top.hasType('effect') && !top.isExtra && (top.data.atk ?? 0) < 1600;
        const bottom = await ctx.option(`Top card of your opponent's Deck: ${top.name}. Where should it go?`, ['Leave it on top', 'Place it on the bottom'], (i) =>
          i === 1 ? (weak ? -1 : v) : weak ? 1 : 0,
        );
        if (bottom === 1 && top.location === 'deck') {
          await ctx.toDeck(top, 'bottom');
          ctx.log(`${ctx.game.players[ctx.player].name} places the top card of the opponent's Deck on the bottom.`);
        } else {
          ctx.log(`${ctx.game.players[ctx.player].name} leaves the card on top of the opponent's Deck.`);
        }
      },
    },
  ],
});

monster('Cryomancer of the Ice Barrier', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 1300,
  def: 0,
  types: ['tuner'],
  sets: IB,
  aiValue: 400,
  text: 'While you control another "Ice Barrier" monster, Level 4 or higher monsters cannot declare an attack.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isIceBarrier(c)).length > 0,
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.isMonster && ctx.level(c) >= 4 }],
    },
  ],
});

// ============================================================ MIST VALLEY / WIND

monster('Mist Valley Thunderbird', {
  attribute: 'WIND',
  race: 'Thunder',
  level: 3,
  atk: 1100,
  def: 700,
  sets: MV,
  aiValue: 300,
  text: 'If this face-up card on the field returns to the hand: Special Summon it, but it cannot attack this turn.',
  effects: [
    {
      kind: 'trigger',
      event: 'returnedToHand',
      mandatory: true,
      label: 'Special Summon itself',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp && ctx.self.location === 'hand',
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ctx.self);
        for (const m of r) m.flags.cannotAttackTurn = ctx.turn;
      },
    },
  ],
});

monster('Mist Valley Shaman', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 3,
  atk: 1200,
  def: 1200,
  types: ['tuner'],
  sets: MV,
  aiValue: 200,
  text: 'Once per turn: You can return 1 other monster you control to the hand; this card gains 500 ATK until the end of this turn.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Return a monster: +500 ATK',
      categories: ['toHand', 'atkChange'],
      canActivate: (ctx) => ctx.monsters('me', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        const cands = ctx.monsters('me', (c) => c !== ctx.self);
        const [m] = await ctx.select(cands, 1, 1, 'Return 1 other monster you control to the hand.', 'cost', {
          aiScore: (c) => (c.name === 'Mist Valley Thunderbird' && c.faceUp ? 10000 : 0) - cardValue(ctx.game, c) - (c.isExtra || c.isToken ? 3000 : 0),
        });
        if (!m) return false;
        await ctx.toHand(m, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 500, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1 || ctx.self.pos !== 'atk' || !ctx.self.faceUp) return 0;
          const bird = ctx.faceUpMonsters('me', (c) => c.name === 'Mist Valley Thunderbird' && c.attacksThisTurn === 0);
          // Free with Thunderbird only when it lets the Shaman win a battle Thunderbird could not.
          const a = ctx.atk(ctx.self);
          const opp = ctx.monsters('opp');
          if (!opp.length) {
            const others = ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.pos === 'atk').reduce((s, c) => s + ctx.atk(c), 0);
            if (a + others < ctx.oppLp && a + 500 + others >= ctx.oppLp) return 60;
            return 0;
          }
          if (!bird.length) return 0;
          const beatable = ctx.faceUpMonsters('opp', (c) => {
            const v = c.pos === 'atk' ? ctx.atk(c) : ctx.def(c);
            return v >= a && v < a + 500 && v > ctx.atk(bird[0]);
          });
          return beatable.length ? 45 : 0;
        },
      },
    },
  ],
});

monster('Mist Valley Soldier', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 4,
  atk: 1700,
  def: 300,
  types: ['tuner'],
  sets: MV,
  aiValue: 300,
  text: "At the end of the Damage Step, if this card battled an opponent's monster that was not destroyed: Return that opponent's monster to the hand. You must control this face-up card to activate and to resolve this effect.",
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Return the battled monster',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return false;
        const b = ctx.battle;
        if (!b || !b.target || !ev.other) return false;
        let o: C | null = null;
        if (ev.card === ctx.self && b.attacker === ctx.self) o = b.target.moveId === b.targetMoveId ? b.target : null;
        else if (ev.other === ctx.self && b.target === ctx.self) o = b.attacker.moveId === b.attackerMoveId ? b.attacker : null;
        return !!o && o.location === 'mzone' && o.controller === ctx.opp;
      },
      activate: async (ctx) => {
        const b = ctx.battle;
        const o = b ? (b.attacker === ctx.self ? b.target : b.attacker) : null;
        ctx.data.o = o;
        ctx.data.id = o?.moveId;
      },
      resolve: async (ctx) => {
        const o = ctx.data.o as C | null;
        if (!o || o.location !== 'mzone' || o.moveId !== ctx.data.id) return;
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp || ctx.self.controller !== ctx.player) return;
        await ctx.toHand(o);
      },
    },
  ],
});

// ============================================================ FLAMVELL / FIRE

monster('Flamvell Dragnov', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 2,
  atk: 1100,
  def: 200,
  sets: FV,
  aiValue: 200,
  text: 'If this card is destroyed by battle and sent to the GY: Inflict 500 damage to your opponent. You can banish this card from your GY and 1 face-up FIRE monster you control; add 1 "Flamvell Dragnov" from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: '500 damage',
      categories: ['damage'],
      eventFilter: selfBattleToGrave,
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish with a FIRE monster: search Dragnov',
      categories: ['search', 'banish'],
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => c.data.attribute === 'FIRE').length > 0 && ctx.deck('me', (c) => c.name === 'Flamvell Dragnov').length > 0,
      activate: async (ctx) => {
        const [fire] = await ctx.select(ctx.faceUpMonsters('me', (c) => c.data.attribute === 'FIRE'), 1, 1, 'Banish 1 face-up FIRE monster you control.', 'cost');
        if (!fire) return false;
        await ctx.banish([ctx.self, fire], 'cost');
      },
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === 'Flamvell Dragnov', 1, 'Add 1 "Flamvell Dragnov" from your Deck to your hand.');
      },
      ai: {
        score: (ctx) => {
          // Trade a spent, weak FIRE monster for a fresh Dragnov.
          if (ctx.phase !== 'main2') return 0;
          const cheap = ctx.faceUpMonsters('me', (c) => c.data.attribute === 'FIRE' && !c.isExtra && ctx.atk(c) <= 1200);
          return cheap.length ? 30 : 0;
        },
      },
    },
  ],
});

monster('Flamvell Guard', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 1,
  atk: 100,
  def: 2000,
  types: ['tuner'],
  sets: FV,
  text: 'A Flamvell guardian who commands fire with his will. His magma-hot barrier protects his troops from intruders.',
});

// ============================================================ X-SABERS

monster('X-Saber Axel', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 1,
  atk: 400,
  def: 100,
  sets: XS,
  aiValue: 200,
  text: 'While you control this face-up card, when a "Saber" monster is destroyed by battle and sent to the Graveyard, draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['mzone'],
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as C | undefined;
        return !!c && c !== ctx.self && isSaber(c) && c.location === 'grave' && ctx.self.faceUp;
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Commander Gottoms, Swordmaster', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 6,
  atk: 2100,
  def: 1600,
  aiValue: 300,
  text: 'All face-up "Saber" monsters you control gain 400 ATK.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c.faceUpMonster && c.controller === ctx.player && isSaber(c), value: 400 }],
    },
  ],
});

monster('X-Saber Urbellum', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 7,
  atk: 2200,
  def: 1300,
  types: ['synchro'],
  sets: XS,
  aiValue: 300,
  text: '1 Tuner + 1 or more non-Tuner monsters\nWhen this card inflicts Battle Damage to your opponent while they have 4 or more cards in their hand, place 1 random card from their hand on top of their Deck.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Random card to the top of the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp && ev.reasonCard === ctx.self && ctx.self.location === 'mzone' && ctx.hand('opp').length >= 4,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        await ctx.toDeck(c, 'top');
        ctx.log(`A random card from the opponent's hand is placed on top of their Deck.`);
      },
    },
  ],
});

// ============================================================ ALLY OF JUSTICE

monster('Ally of Justice Clausolas', {
  attribute: 'DARK',
  race: 'Machine',
  level: 6,
  atk: 2300,
  def: 1200,
  sets: AOJ,
  text: 'A mighty monster in Mist Valley, and the ultimate weapon designed from Claiomh Solais. Its surprise attacks from above baffle invaders.',
});

monster('Ally of Justice Garadholg', {
  attribute: 'DARK',
  race: 'Machine',
  level: 4,
  atk: 1600,
  def: 400,
  sets: AOJ,
  aiValue: 100,
  text: 'If this card battles a LIGHT monster, it gains 200 ATK during the Damage Step only.',
  effects: [lightHunter(200)],
});

monster('Ally of Justice Rudra', {
  attribute: 'DARK',
  race: 'Machine',
  level: 5,
  atk: 1900,
  def: 1200,
  sets: AOJ,
  aiValue: 200,
  text: 'If this card battles a LIGHT monster, it gains 700 ATK during the Damage Step only.',
  effects: [lightHunter(700)],
});

// ============================================================ WORMS

monster('Worm Apocalypse', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 1,
  atk: 300,
  def: 200,
  types: ['flip'],
  sets: WORM,
  aiValue: 300,
  text: 'FLIP: Target 1 Spell/Trap Card on the field; destroy that target.',
  effects: [
    flip({
      categories: ['destroy'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap Card on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    }),
  ],
});

monster('Worm Barses', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 3,
  atk: 1400,
  def: 1500,
  sets: WORM,
  aiValue: 100,
  text: 'When this card is Normal Summoned: Target 1 Defense Position monster; change that target to face-up Attack Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Change to Attack Position',
      categories: ['position'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c.pos === 'def' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => c.pos === 'def'), 1, 1, 'Target 1 Defense Position monster to change to face-up Attack Position.', 'position', {
          aiScore: (c) => {
            const mine = c.controller === ctx.player;
            // Expose the opponent's walls; flipping your own Flip monster is a bonus.
            if (mine) return c.hasType('flip') && !c.faceUp ? 500 : -5000;
            return 1000 + (c.faceUp ? 3000 - ctx.atk(c) : 1500);
          },
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.pos === 'def');
        if (t.length) await ctx.changePos(t[0], 'atk', true);
      },
    },
  ],
});

monster('Worm Cartaros', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 4,
  atk: 1200,
  def: 500,
  types: ['flip'],
  sets: WORM,
  aiValue: 400,
  text: 'FLIP: Add 1 Level 4 or lower Reptile-Type "Worm" monster from your Deck to your hand.',
  effects: [
    flip({
      categories: ['search'],
      resolve: async (ctx) => {
        await ctx.search((c) => isReptileWorm(c) && !c.isExtra && (c.data.level ?? 0) <= 4, 1, 'Add 1 Level 4 or lower Reptile-Type "Worm" monster to your hand.');
      },
    }),
  ],
});

monster('Worm Dimikles', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 4,
  atk: 1700,
  def: 1400,
  types: ['flip'],
  sets: WORM,
  aiValue: 100,
  text: 'FLIP: This card gains 300 ATK and DEF.',
  effects: [
    flip({
      categories: ['atkChange'],
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        ctx.addTempMod(ctx.self, 'atk', 300, 'field');
        ctx.addTempMod(ctx.self, 'def', 300, 'field');
      },
    }),
  ],
});

monster('Worm Erokin', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 6,
  atk: 2400,
  def: 1200,
  sets: WORM,
  aiValue: 300,
  // "Cannot be Special Summoned": nomi without a proper summon procedure blocks every
  // Special Summon that goes through ctx.canSummonCard / Game.specialSummon's nomi check.
  nomi: true,
  text: 'This card cannot be Special Summoned. Once per turn, select 1 face-up Reptile-Type "Worm" monster on the field and change it to face-down Defense Position.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Change a Worm face-down',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isReptileWorm(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', isReptileWorm), 1, 1, 'Select 1 face-up Reptile-Type "Worm" monster to change to face-down Defense Position.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? 2000 + ctx.atk(c) : c === ctx.self ? -5000 : c.hasType('flip') ? 1000 + (c.data.aiValue ?? 0) : -1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], 'def', false);
      },
      ai: {
        score: (ctx) => {
          if (ctx.faceUpMonsters('opp', isReptileWorm).length) return 40;
          const own = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isReptileWorm(c) && c.hasType('flip'));
          if (!own.length) return 0;
          // Main 1: flip it down and Flip Summon it again. Main 2: re-use the FLIP next turn.
          if (ctx.phase === 'main1' && own.some((c) => c.summonTurn !== ctx.turn && c.posChangedTurn !== ctx.turn && c.attacksThisTurn === 0)) return 45;
          return ctx.phase === 'main2' ? 30 : 0;
        },
      },
    },
  ],
});

// ============================================================ SPELLS

const isNeos = (c: C) =>
  c.location === 'mzone' &&
  c.faceUp &&
  (c.name.toLowerCase() === 'elemental hero neos' || (c.name === 'Elemental Hero Neos Alius' && !!c.flags.geminiSummoned));

spell('Wrath of Neos', 'normal', {
  text: 'Target 1 "Elemental HERO Neos" in your Monster Zone; shuffle that "Elemental HERO Neos" into the Deck, and if you do, destroy all cards on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.monsters('me', (c) => isNeos(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('me', isNeos), 1, 1, 'Target 1 "Elemental HERO Neos" you control.', 'toDeck', { aiScore: () => 1 });
      },
      resolve: async (ctx) => {
        // 2010 ruling: if the opponent gains control of the targeted Neos first, it still returns to the Deck and all
        // cards are destroyed. https://edisonrul.ing/cards/w/wrath-of-neos.html
        const t = ctx.validTargets((c) => isNeos(c));
        if (!t.length) return;
        const moved = await ctx.toDeck(t[0], 'shuffle');
        if (!moved.length || (t[0].location !== 'deck' && t[0].location !== 'extra')) return;
        await ctx.destroy(ctx.field('both', (c) => c !== ctx.self));
      },
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const mine = ctx.field('me', (c) => c !== ctx.self).reduce((a, c) => a + cardValue(g, c), 0);
          const theirs = ctx.field('opp').reduce((a, c) => a + cardValue(g, c), 0);
          return theirs > mine + 1500 ? 50 + (theirs - mine) / 150 : 0;
        },
      },
    },
  ],
});

const isKuriboh = (c: C) => c.faceUpMonster && (c.name === 'Kuriboh' || c.name === 'Kuriboh Token');

spell('Detonate', 'quickplay', {
  text: 'Destroy as many "Kuriboh" and "Kuriboh Tokens" you control as possible, then destroy cards your opponent controls, up to the number of cards destroyed by this effect.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.monsters('me', isKuriboh).length > 0,
      resolve: async (ctx) => {
        const own = ctx.monsters('me', isKuriboh);
        if (!own.length) return;
        const destroyed = await ctx.destroy(own);
        const n = destroyed.length;
        const opp = ctx.field('opp');
        if (!n || !opp.length) return;
        const sel = await ctx.select(opp, 0, n, `Destroy up to ${n} card(s) your opponent controls.`, 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const n = ctx.monsters('me', isKuriboh).length;
          const opp = ctx.field('opp').map((c) => cardValue(ctx.game, c)).sort((a, b) => b - a).slice(0, n);
          const gain = opp.reduce((a, v) => a + v, 0) - n * 600;
          return gain > 1000 ? 45 + gain / 200 : 0;
        },
      },
    },
  ],
});

spell('Berserker Crush', 'quickplay', {
  text: 'Banish 1 monster from your GY, then target 1 "Winged Kuriboh" you control; that target\'s ATK/DEF become equal to the ATK/DEF of the monster that was banished, until the end of this turn.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange', 'banish'],
      canActivate: (ctx) =>
        ctx.grave('me', (c) => c.isMonster).length > 0 && ctx.faceUpMonsters('me', (c) => c.name === 'Winged Kuriboh' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [cost] = await ctx.select(ctx.grave('me', (c) => c.isMonster), 1, 1, 'Banish 1 monster from your GY.', 'toHand', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.def ?? 0) / 10,
        });
        if (!cost) return false;
        ctx.data.atk = cost.data.atk ?? 0;
        ctx.data.def = cost.data.def ?? 0;
        await ctx.banish(cost, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c.name === 'Winged Kuriboh'), 1, 1, 'Target 1 "Winged Kuriboh" you control.', 'buff');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t) return;
        t.flags.setAtk = ctx.data.atk;
        t.flags.setAtkTurn = ctx.turn;
        // APPROX: the engine has no "set DEF until end of turn"; a temporary DEF modifier
        // that brings the current DEF to the new value is used instead.
        ctx.addTempMod(t, 'def', (ctx.data.def as number) - ctx.def(t), 'turn');
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const k = battleKuriboh(ctx);
          if (!k) return 0;
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isMonster).map((c) => c.data.atk ?? 0));
          const o = k === b.attacker ? b.target : b.attacker;
          if (!o) return best > ctx.atk(k) ? 60 : 0;
          const ov = o.pos === 'atk' ? ctx.atk(o) : ctx.def(o);
          return best > ov && ctx.atk(k) <= ov ? 90 : 0;
        },
      },
    },
  ],
});

/** A face-up Winged Kuriboh of mine in the current battle. */
function battleKuriboh(ctx: Ctx): C | null {
  const b = ctx.battle;
  if (!b) return null;
  for (const c of [b.attacker, b.target]) if (c && c.controller === ctx.player && c.faceUp && c.name === 'Winged Kuriboh') return c;
  return null;
}

const evoKey = (p: number) => `evolutionBurst:${p}`;
spell('Evolution Burst', 'normal', {
  text: 'If you control "Cyber Dragon": Target 1 card your opponent controls; destroy that target. "Cyber Dragon" cannot attack the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c.name === 'Cyber Dragon').length > 0,
      canActivate: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        // The attack restriction applies for the turn of activation, even if this card is negated.
        ctx.game.turnData[evoKey(ctx.player)] = true;
        await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Target 1 card your opponent controls to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.field('opp', (c) => ctx.canTarget(c)));
          if (!best) return 0;
          const v = cardValue(ctx.game, best);
          // Worth giving up Cyber Dragon's attack in Main 2, or for a big target.
          if (ctx.phase === 'main2') return 50 + v / 200;
          const cdCanAttack = ctx.faceUpMonsters('me', (c) => c.name === 'Cyber Dragon' && c.pos === 'atk' && c.attacksThisTurn === 0).length > 0;
          return !cdCanAttack || v >= 2000 ? 50 + v / 200 : 0;
        },
      },
    },
    {
      // "Cyber Dragon" cannot attack the turn this card was activated. turnData resets every turn.
      kind: 'continuous',
      range: ['hand', 'deck', 'szone', 'grave', 'banished'],
      active: (ctx) => !!ctx.game.turnData[evoKey(ctx.self.owner)],
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.controller === ctx.self.owner && c.name === 'Cyber Dragon' }],
    },
  ],
});

export const HA01_LOADED = true;
