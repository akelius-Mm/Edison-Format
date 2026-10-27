// Card definitions: X-Sabers / XX-Sabers (archetype group B).
import { monster, normal, spell, trap } from '../define';
import { attr, cardValue, selfDestroysByBattle } from '../helpers';
import type { CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

const XS = ['x-saber'];
const XXS = ['x-saber', 'xx-saber'];
const isXS = (c: CardInstance) => c.isMonster && c.inSet('x-saber');
const faceUpXS = (ctx: Ctx) => ctx.faceUpMonsters('me', isXS);

/** A Normal Spell/Trap currently resolving on the chain (destroying it achieves nothing). */
function spentOnChain(ctx: Ctx, c: CardInstance) {
  return ctx.game.chain.some(
    (l) => l.card === c && l.isCardActivation && !['continuous', 'equip', 'field'].includes(c.data.stype ?? '') && c.data.ttype !== 'continuous',
  );
}

/** AI preference for which X-Saber to bring back / summon (higher = better). */
function xsPriority(ctx: Ctx, c: CardInstance): number {
  const tunerOnBoard = ctx.faceUpMonsters('me', (m) => m.isTuner).length > 0;
  let s = (c.data.atk ?? 0) + (c.data.aiValue ?? 0);
  if (c.isTuner && !tunerOnBoard) s += 1200;
  if (c.name === 'XX-Saber Darksoul') s += 500;
  return s;
}

// ============================================================ MAIN DECK

monster('X-Saber Airbellum', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 3,
  atk: 1600,
  def: 200,
  types: ['tuner'],
  sets: XS,
  aiValue: 300,
  text: 'When this card inflicts battle damage to your opponent by a direct attack: Your opponent discards 1 random card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Random discard',
      categories: ['discard'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && !!ctx.battle && ctx.battle.attacker === ctx.self && !ctx.battle.target,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        await ctx.discard(c);
      },
    },
  ],
});

monster('XX-Saber Faultroll', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 2400,
  def: 1800,
  sets: XXS,
  aiValue: 700,
  cannotNormalSummon: true,
  nomi: true,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) while you control 2 or more face-up "X-Saber" monsters. Once per turn: You can target 1 Level 4 or lower "X-Saber" monster in your GY; Special Summon it.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && faceUpXS(ctx).length >= 2,
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Revive X-Saber',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isXS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(
          ctx.grave('me', (c) => isXS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)),
          1,
          1,
          'Target 1 Level 4 or lower "X-Saber" in your GY.',
          'specialSummon',
          { aiScore: (c) => xsPriority(ctx, c) },
        );
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0]);
      },
      ai: { score: () => 62 },
    },
  ],
});

monster('XX-Saber Boggart Knight', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1900,
  def: 1000,
  sets: XXS,
  aiValue: 300,
  text: 'When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower "X-Saber" monster from your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Summon X-Saber from hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isXS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.hand('me', (c) => isXS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "X-Saber" from your hand.', 'specialSummon', {
          aiScore: (c) => xsPriority(ctx, c),
        });
        if (sel.length) await ctx.specialSummon(sel[0]);
      },
    },
  ],
});

monster('XX-Saber Darksoul', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 3,
  atk: 100,
  def: 100,
  sets: XXS,
  aiValue: 600,
  text: 'During the End Phase, if this card was sent from the field to the GY this turn: You can add 1 "X-Saber" monster from your Deck to your hand.',
  effects: [
    {
      // Bookkeeping only: remember that this card went field -> GY this turn (never builds a chain link).
      kind: 'trigger',
      event: 'sentToGrave',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ev.from === 'mzone' && ctx.self.location === 'grave') ctx.self.flags.darksoulTurn = ctx.turn;
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Search X-Saber',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.flags.darksoulTurn === ctx.turn,
      condition: (ctx) => ctx.deck('me', isXS).length > 0,
      resolve: async (ctx) => {
        await ctx.search(isXS, 1, 'Add 1 "X-Saber" monster from your Deck to your hand.', 1);
      },
    },
  ],
});

monster('X-Saber Galahad', {
  attribute: 'EARTH',
  race: 'Warrior', // printed Type (YGOJSON), was Beast-Warrior
  level: 4,
  atk: 1800,
  def: 800,
  sets: XS,
  text: 'If this card attacks, it gains 300 ATK during the Damage Step only. If this card is attacked, it loses 500 ATK during the Damage Step only.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const b = ctx.battle;
            if (!b || !b.inDamageStep) return 0;
            if (b.attacker === ctx.self) return 300;
            if (b.target === ctx.self) return -500;
            return 0;
          },
        },
      ],
    },
  ],
});

monster('X-Saber Pashuul', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 2,
  atk: 1100,
  def: 0,
  sets: XS,
  aiValue: 200,
  text: 'Cannot be destroyed by battle. During each of your Standby Phases, you take 1000 damage.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Take 1000 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        await ctx.damage(ctx.player, 1000);
      },
    },
  ],
});

normal('X-Saber Anu Piranha', 'EARTH', 'Warrior', 4, 1800, 1100, 'A swordsman of the X-Saber band who strikes faster than the eye can follow.', XS);

monster('X-Saber Palomuro', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 1,
  atk: 200,
  def: 300,
  types: ['tuner'],
  sets: XS,
  aiValue: 300,
  text: 'When an "X-Saber" monster you control is destroyed by battle and sent to the GY, while this card is in your GY: You can pay 500 LP; Special Summon this card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['grave'],
      label: 'Pay 500: revive',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as CardInstance;
        return c !== ctx.self && isXS(c) && ev.fromController === ctx.player && c.location === 'grave';
      },
      condition: (ctx) => ctx.lp > 500 && ctx.canSummonSelf(),
      activate: async (ctx) => {
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self);
      },
      ai: { score: (ctx) => (ctx.lp > 2500 ? 40 : 0) },
    },
  ],
});

monster('X-Saber Uruz', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1600,
  // HA01: DEF and effect corrected to the printed card (YGOJSON: 1600/1000, the Tribute is a cost).
  def: 1000,
  sets: XS,
  text: 'When this card destroys an opponent\'s monster by battle and sends it to the Graveyard, you can Tribute this card to return the destroyed card to the top of its owner\'s Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Tribute: return to top of Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && (ev.card as CardInstance).location === 'grave',
      canActivate: (ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        await ctx.game.moveCards([ctx.self], 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
      resolve: async (ctx) => {
        const c = ctx.event!.card as CardInstance;
        if (c.location === 'grave') await ctx.toDeck(c, 'top');
      },
      ai: {
        // Worth a 1600 body only to strip a Synchro/Fusion monster from the GY for good.
        score: (ctx) => {
          const c = ctx.event?.card as CardInstance | undefined;
          return c && c.isExtra && (c.data.atk ?? 0) + (c.data.aiValue ?? 0) >= 2200 ? 40 : 0;
        },
      },
    },
  ],
});

// ============================================================ SPELLS / TRAPS

spell("Gottoms' Emergency Call", 'normal', {
  // Printed card: needs a face-up "X-Saber" on the field and targets 2 "X-Saber" monsters in either GY.
  text: 'Activate only if there is a face-up "X-Saber" monster(s) on the field. Select 2 "X-Saber" monsters in either player\'s Graveyard(s). Special Summon those monsters to your side of the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.freeMZones() >= 2 &&
        ctx.faceUpMonsters('both', isXS).length > 0 &&
        ctx.grave('both', (c) => isXS(c) && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('both', (c) => isXS(c) && ctx.canSummonCard(c)), 2, 2, 'Target 2 "X-Saber" monsters in any GY.', 'specialSummon', {
          aiScore: (c) => xsPriority(ctx, c),
        });
      },
      resolve: async (ctx) => {
        // https://edisonrul.ing/cards/g/gottoms-emergency-call.html — if either target is no longer in the GY when this
        // resolves, the other target is not Summoned either.
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length === 2) await ctx.specialSummon(t);
      },
      ai: {
        score: (ctx) => {
          const g = ctx.grave('both', (c) => isXS(c) && ctx.canSummonCard(c));
          const hasTuner = g.some((c) => c.isTuner) || ctx.faceUpMonsters('me', (c) => c.isTuner).length > 0;
          return 58 + (hasTuner ? 10 : 0);
        },
      },
    },
  ],
});

trap('Saber Slash', 'normal', {
  text: 'Target face-up cards your opponent controls, up to the number of face-up Attack Position "X-Saber" monsters you control; destroy them.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => isXS(c) && c.pos === 'atk').length > 0 && ctx.field('opp', (c) => c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const n = ctx.faceUpMonsters('me', (c) => isXS(c) && c.pos === 'atk').length;
        await ctx.selectTargets(ctx.field('opp', (c) => c.faceUp), 1, n, `Target up to ${n} face-up cards your opponent controls.`, 'destroy', {
          aiScore: (c) => cardValue(ctx.game, c) - (spentOnChain(ctx, c) ? 5000 : 0),
        });
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.validTargets((c) => c.onField && c.faceUp));
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.field('opp', (c) => c.faceUp && ctx.canTarget(c) && !spentOnChain(ctx, c));
          if (!opp.length) return -1;
          const val = opp.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && top.ctx.targets.some((t) => t.controller === ctx.player && isXS(t))) return 70;
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep) return 60;
          if (ctx.isMyTurn && ctx.phase === 'main1' && val >= 1800) return 50;
          if (!ctx.isMyTurn && ctx.phase === 'end') return 40;
          return -1;
        },
      },
    },
  ],
});

// ============================================================ EXTRA DECK

monster('XX-Saber Gottoms', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  // Printed card: Level 9, 1 Tuner + 1+ non-Tuner EARTH monsters (YGOJSON; was Level 7 / X-Saber non-Tuners).
  level: 9,
  atk: 3100,
  def: 2600,
  types: ['synchro'],
  sets: XXS,
  aiValue: 400,
  text: '1 Tuner + 1 or more non-Tuner EARTH monsters\nYou can Tribute 1 "X-Saber" monster; discard 1 random card from your opponent\'s hand.',
  synchro: { nonTuner: attr('EARTH'), desc: '1 Tuner + 1+ non-Tuner EARTH monsters' },
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute X-Saber: random discard',
      categories: ['discard'],
      canActivate: (ctx) => ctx.hand('opp').length > 0 && ctx.monsters('me', (c) => c.faceUp && isXS(c) && !ctx.query(c, 'cannotBeTributed')).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(
          ctx.monsters('me', (c) => c.faceUp && isXS(c) && !ctx.query(c, 'cannotBeTributed')),
          1,
          1,
          'Tribute 1 "X-Saber" monster.',
          'tribute',
          { aiScore: (c) => (c === ctx.self ? -100000 : -cardValue(ctx.game, c)) },
        );
        await ctx.sendToGrave(cost, 'tribute');
      },
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        await ctx.discard(hand[ctx.game.rng.int(hand.length)]);
      },
      ai: {
        score: (ctx) => {
          if (!ctx.hand('opp').length) return 0;
          const fodder = ctx.monsters('me', (c) => c !== ctx.self && c.faceUp && isXS(c)).sort((a, b) => cardValue(ctx.game, a) - cardValue(ctx.game, b))[0];
          if (!fodder) return 0;
          const v = cardValue(ctx.game, fodder);
          // Darksoul is the dream fodder (searches at End Phase).
          if (fodder.name === 'XX-Saber Darksoul') return 60;
          if (ctx.game.phase === 'main2' && v < 1700) return 45;
          return 0;
        },
      },
    },
  ],
});

monster('XX-Saber Hyunlei', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 2300,
  def: 1300,
  types: ['synchro'],
  sets: XXS,
  aiValue: 900,
  text: '1 Tuner + 1 or more non-Tuner "X-Saber" monsters\nWhen this card is Synchro Summoned: You can target up to 3 Spell/Trap Cards on the field; destroy them.',
  synchro: { nonTuner: (c) => c.inSet('x-saber'), desc: '1 Tuner + 1+ non-Tuner "X-Saber" monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      label: 'Destroy up to 3 Spell/Traps',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 3, 'Target up to 3 Spells/Traps to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.validTargets((c) => c.onField));
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 80 : 0) },
    },
  ],
});

export const SABERS_LOADED = true;
