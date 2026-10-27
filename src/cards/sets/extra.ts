// Card definitions: generic Extra Deck (Synchro + Fusion monsters).
import { monster } from '../define';
import { attr, cardValue, named, race, selfDestroysByBattle } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink } from '../../engine/game';
import type { GameEvent } from '../../engine/types';

// ============================================================ shared helpers

type C = CardInstance;

/** Quickdraw Synchron can be treated as any "Synchron" Tuner. */
const isQuickdraw = (c: C) => c.name === 'Quickdraw Synchron';
/** A specific "X Synchron" Tuner (or a card that substitutes for it). */
const synchronNamed = (n: string) => (c: C) => c.name === n || isQuickdraw(c);
/** Any "Synchron" Tuner. */
const anySynchron = (c: C) => c.inSet('synchron') || c.name.includes('Synchron');

const total = (ctx: Ctx, cards: C[]) => cards.reduce((a, c) => a + cardValue(ctx.game, c), 0);

/** The monster this card is battling (if any). */
function battleOpponent(ctx: Ctx): C | null {
  const b = ctx.battle;
  if (!b || !b.target) return null;
  if (b.attacker === ctx.self) return b.target;
  if (b.target === ctx.self) return b.attacker;
  return null;
}

/** Tribute cards as a cost. */
async function tributeCost(ctx: Ctx, cards: C[]) {
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

/** Total Spell Counters on your side of the field. */
const spellCounters = (ctx: Ctx) => ctx.field('me').reduce((a, c) => a + (c.counters.spell ?? 0), 0);

/** Remove n Spell Counters from cards on your side of the field (player chooses where from). */
async function removeSpellCounters(ctx: Ctx, n: number) {
  for (let i = 0; i < n; i++) {
    const holders = ctx.field('me', (c) => (c.counters.spell ?? 0) > 0);
    if (!holders.length) return false;
    const [h] = await ctx.select(holders, 1, 1, 'Remove a Spell Counter from which card?', 'cost', {
      // Prefer taking counters off cards that don't use them for ATK.
      aiScore: (c) => (c === ctx.self ? 0 : 100) + (c.counters.spell ?? 0),
    });
    if (!h) return false;
    h.counters.spell = (h.counters.spell ?? 1) - 1;
  }
  ctx.game.update();
  return true;
}

/** Number of Fusion Materials used for a Fusion Summon that just happened. */
function fusionMaterialCount(ctx: Ctx, card: C): number {
  const mats = card.flags.materials as unknown[] | undefined;
  if (Array.isArray(mats) && mats.length) return mats.length;
  // Fallback: count the 'usedAsMaterial' events right before this summon.
  const log = ctx.game.eventLog;
  const skip = new Set(['specialSummoned', 'fusionSummoned', 'summoned', 'sentToGrave', 'leftField', 'banished', 'cardActivated', 'chainActivated', 'returnedToDeck']);
  let n = 0;
  for (let i = log.length - 1; i >= 0 && i > log.length - 60; i--) {
    const ev = log[i];
    if (ev.type === 'usedAsMaterial') {
      n++;
      continue;
    }
    if (skip.has(ev.type)) continue;
    break;
  }
  return n;
}

/** Stardust-style check: does this chain link destroy a card on the field? */
const isDestroyLink = (l: ChainLink | undefined) => !!l && !l.negated && (l.effect.categories ?? []).includes('destroy');

/** AI: how much of mine is threatened by a destroy-link. */
function destroyThreat(ctx: Ctx, l: ChainLink): number {
  if (l.player === ctx.player) return 0;
  const cats = l.effect.categories ?? [];
  const mine = ctx.field('me');
  if (!mine.length) return 0;
  if (cats.includes('destroyMulti')) return 90;
  if (l.ctx.targets.some((t) => t.controller === ctx.player && t.onField)) return 85;
  return 50;
}

// ============================================================ SYNCHRO MONSTERS

monster('Stardust Dragon', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 8,
  atk: 2500,
  def: 2000,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nWhen a card or effect is activated that would destroy a card(s) on the field: You can Tribute this card; negate the activation, and if you do, destroy that card. During the End Phase of a turn in which this effect was used, you can Special Summon this card that was Tributed by it from your GY.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 1200,
  effects: [
    {
      kind: 'quick',
      label: 'Tribute: negate destruction',
      damageStep: true,
      categories: ['negate', 'destroy'],
      condition: (ctx) => isDestroyLink(ctx.prevLink()) && !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
        if (ctx.self.location === 'grave') ctx.self.flags.stardustRevive = ctx.turn;
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          return l ? destroyThreat(ctx, l) : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Return from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.flags.stardustRevive === ctx.turn,
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self, { ignoreConditions: true });
      },
    },
  ],
});

monster('Black Rose Dragon', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 7,
  atk: 2400,
  def: 1800,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nWhen this card is Synchro Summoned: You can destroy every card on the field. Once per turn: You can banish 1 Plant-Type monster from your GY to target 1 Defense Position monster your opponent controls; change it to face-up Attack Position, and its ATK becomes 0 until the end of this turn.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 800,
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      when: true,
      label: 'Destroy all cards on the field',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.field('both', (c) => c !== ctx.self).length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.field('both'));
      },
      ai: {
        score: (ctx) => {
          const mine = total(ctx, ctx.field('me', (c) => c !== ctx.self)) + cardValue(ctx.game, ctx.self);
          const theirs = total(ctx, ctx.field('opp'));
          return theirs > mine + 1000 ? 1 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish Plant: ATK 0',
      categories: ['position', 'atkChange', 'banish'],
      canActivate: (ctx) => ctx.grave('me', race('Plant')).length > 0 && ctx.monsters('opp', (c) => c.pos === 'def' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', race('Plant')), 1, 1, 'Banish 1 Plant-Type monster from your GY.', 'cost');
        await ctx.banish(cost, 'cost');
        await ctx.selectTargets(ctx.monsters('opp', (c) => c.pos === 'def'), 1, 1, 'Target 1 Defense Position monster.', 'position', {
          aiScore: (c) => (c.faceUp ? ctx.def(c) : 1500),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.pos === 'def')[0];
        if (!t) return;
        await ctx.changePos(t, 'atk', true);
        if (t.location === 'mzone') {
          t.flags.setAtk = 0;
          t.flags.setAtkTurn = ctx.turn;
          ctx.game.update();
        }
      },
      ai: {
        score: (ctx) =>
          ctx.phase === 'main1' && ctx.turn > 1 && ctx.monsters('opp', (c) => c.pos === 'def' && (!c.faceUp || ctx.def(c) >= 1500)).length ? 45 : 0,
      },
    },
  ],
});

monster('Red Dragon Archfiend', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2000,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nAfter damage calculation, if this card attacked a Defense Position monster: destroy every Defense Position monster your opponent controls. During your End Phase: destroy all other monsters you control that did not declare an attack this turn.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy Defense Position monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && !!ev.other && (ev.other as C).pos === 'def' && ctx.self.location === 'mzone',
      condition: (ctx) => ctx.monsters('opp', (c) => c.pos === 'def').length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('opp', (c) => c.pos === 'def'));
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'Destroy idle monsters',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn,
      condition: (ctx) => ctx.monsters('me', (c) => c !== ctx.self && c.attacksThisTurn === 0).length > 0,
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        await ctx.destroy(ctx.monsters('me', (c) => c !== ctx.self && c.attacksThisTurn === 0));
      },
    },
  ],
});

monster('Colossal Fighter', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 8,
  atk: 2800,
  def: 1000,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nGains 100 ATK for each Warrior-Type monster in either GY. When this card is destroyed by battle and sent to the GY: You can target 1 Warrior-Type monster in either GY; Special Summon it.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 600,
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => 100 * ctx.grave('both', race('Warrior')).length }],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Revive a Warrior',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('both', (c) => race('Warrior')(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('both', (c) => race('Warrior')(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Warrior-Type monster in either GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isExtra ? 600 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t);
      },
    },
  ],
});

monster('Thought Ruler Archfiend', {
  attribute: 'DARK',
  race: 'Psychic',
  level: 8,
  atk: 2700,
  def: 2300,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner Psychic-Type monsters\nWhen this card destroys an opponent\'s monster by battle and sends it to the GY: gain LP equal to that monster\'s original ATK. When a Spell/Trap Card is activated that targets exactly 1 Psychic-Type monster on the field: You can pay 1000 LP; negate the activation, and if you do, destroy it.',
  synchro: { nonTuner: race('Psychic'), desc: '1 Tuner + 1+ non-Tuner Psychic-Type monsters' },
  aiValue: 500,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && (ev.card as C).location === 'grave',
      resolve: async (ctx) => {
        const c = ctx.event!.card as C;
        await ctx.recover(ctx.player, c.data.atk ?? 0);
      },
    },
    {
      kind: 'quick',
      label: 'Pay 1000: protect Psychic',
      damageStep: true,
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated || !l.isCardActivation || !(l.card.isSpell || l.card.isTrap)) return false;
        const t = l.ctx.targets;
        return t.length === 1 && t[0].location === 'mzone' && t[0].faceUp && t[0].data.race === 'Psychic' && ctx.lp > 1000;
      },
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          return l && l.player === ctx.opp && l.ctx.targets[0]?.controller === ctx.player && ctx.lp > 2500 ? 80 : 0;
        },
      },
    },
  ],
});

monster('Ancient Fairy Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 7,
  atk: 2100,
  def: 3000,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nOnce per turn: You can Special Summon 1 Level 4 or lower monster from your hand; you cannot conduct your Battle Phase the turn you use this effect. Once per turn: You can destroy 1 Field Spell Card on the field and gain 1000 LP, then you can add 1 Field Spell Card from your Deck to your hand.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 700,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon from hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
      },
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower monster from your hand.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isTuner ? 800 : 0),
        });
        if (sel.length) await ctx.specialSummon(sel);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) <= 4).map((c) => (c.data.atk ?? 0) + (c.isTuner ? 800 : 0)));
          if (best < 1000) return 0;
          if (ctx.turn <= 1) return 45;
          const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((c) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c))));
          const canHit = ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.atk(c) > oppBest).length;
          return canHit ? 0 : 40;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy Field Spell',
      categories: ['destroy', 'recover', 'search'],
      canActivate: (ctx) => ctx.cards('both', 'fzone').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('both', 'fzone');
        const sel = await ctx.select(cands, 1, 1, 'Destroy 1 Field Spell Card.', 'destroy');
        const d = await ctx.destroy(sel);
        if (!d.length) return;
        await ctx.recover(ctx.player, 1000);
        const fields = ctx.deck('me', (c) => c.isSpell && c.data.stype === 'field');
        if (fields.length && (await ctx.confirm('Add 1 Field Spell Card from your Deck to your hand?'))) {
          await ctx.search((c) => c.isSpell && c.data.stype === 'field', 1, 'Add 1 Field Spell Card to your hand.');
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.cards('opp', 'fzone').length) return 55;
          if (ctx.deck('me', (c) => c.isSpell && c.data.stype === 'field').length) return 30;
          return 0;
        },
      },
    },
  ],
});

monster('Arcanite Magician', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 7,
  atk: 400,
  def: 1800,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner Spellcaster-Type monsters\nWhen this card is Synchro Summoned: place 2 Spell Counters on it. Gains 1000 ATK for each Spell Counter on it. You can remove 1 Spell Counter from your side of the field to target 1 card on the field; destroy it.',
  synchro: { nonTuner: race('Spellcaster'), desc: '1 Tuner + 1+ non-Tuner Spellcaster-Type monsters' },
  aiValue: 2200,
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      mandatory: true,
      label: 'Place 2 Spell Counters',
      categories: [],
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 2;
        ctx.log(`${ctx.self.name} gets 2 Spell Counters.`);
        ctx.game.update();
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => 1000 * (ctx.self.counters.spell ?? 0) }],
    },
    {
      kind: 'ignition',
      label: 'Remove Spell Counter: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => spellCounters(ctx) > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        if (!(await removeSpellCounters(ctx, 1))) return false;
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.field('opp', (c) => ctx.canTarget(c)).map((c) => cardValue(ctx.game, c)));
          return best >= 1000 ? 50 + best / 200 : 0;
        },
      },
    },
  ],
});

monster('Magical Android', {
  attribute: 'LIGHT',
  race: 'Psychic',
  level: 5,
  atk: 2400,
  def: 1700,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nDuring each of your End Phases: gain 600 LP for each face-up Psychic-Type monster you control.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', race('Psychic')).length;
        if (n) await ctx.recover(ctx.player, 600 * n);
      },
    },
  ],
});

monster('Mist Wurm', {
  attribute: 'WIND',
  race: 'Thunder', // HA01: printed Type is Thunder (YGOJSON), was Aqua
  level: 9,
  atk: 2500,
  def: 1500,
  types: ['synchro'],
  text: '1 Tuner + 2 or more non-Tuner monsters\nWhen this card is Synchro Summoned: target up to 3 cards your opponent controls; return them to the hand.',
  synchro: { minNonTuners: 2, desc: '1 Tuner + 2+ non-Tuner monsters' },
  aiValue: 1200,
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      mandatory: true,
      label: 'Bounce up to 3',
      categories: ['toHand'],
      condition: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('opp'), 1, 3, 'Target up to 3 cards your opponent controls.', 'bounce');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster('Nitro Warrior', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 7,
  atk: 2800,
  def: 1800,
  types: ['synchro'],
  text: '"Nitro Synchron" + 1 or more non-Tuner monsters\nOnce per turn, if you activate a Spell Card during your turn, this card gains 1000 ATK during damage calculation of its next battle this turn. Once per turn, when this card destroys an opponent\'s monster by battle: You can target 1 face-up Defense Position monster your opponent controls; change it to Attack Position, and this card can attack once again in a row.',
  synchro: { tuner: synchronNamed('Nitro Synchron'), desc: '"Nitro Synchron" + 1+ non-Tuner monsters' },
  aiValue: 400,
  effects: [
    {
      // Not an activated effect: the eventFilter only records the Spell activation.
      kind: 'trigger',
      event: 'cardActivated',
      range: ['mzone'],
      label: 'Nitro charge',
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || !link.isCardActivation || !link.card.isSpell || link.player !== ctx.player || !ctx.isMyTurn) return false;
        if (!ctx.self.faceUp || ctx.isNegated(ctx.self) || ctx.self.flags.nitroUsed === ctx.turn) return false;
        ctx.self.flags.nitroUsed = ctx.turn;
        ctx.self.flags.nitroCharge = ctx.turn;
        ctx.log(`${ctx.self.name} will gain 1000 ATK in its next battle this turn.`);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: 'Nitro charge used',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self || ev.other === ctx.self) delete ctx.self.flags.nitroCharge;
        return false;
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => (ctx.self.flags.nitroCharge === ctx.turn && !!ctx.battle?.inDamageStep && battleOpponent(ctx) ? 1000 : 0),
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      opt: true,
      label: 'Attack again',
      categories: ['position'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev),
      canActivate: (ctx) => ctx.monsters('opp', (c) => c.faceUp && c.pos === 'def' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp', (c) => c.faceUp && c.pos === 'def'), 1, 1, 'Target 1 face-up Defense Position monster.', 'position', {
          aiScore: (c) => 3000 - ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.pos === 'def')[0];
        if (!t) return;
        await ctx.changePos(t, 'atk', true);
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'extraAttacks', 1, 'turn');
      },
      ai: {
        score: (ctx) => (ctx.monsters('opp', (c) => c.faceUp && c.pos === 'def' && ctx.atk(c) < ctx.atk(ctx.self)).length ? 1 : 0),
      },
    },
  ],
});

monster('Power Tool Dragon', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 7,
  atk: 2300,
  def: 2500,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nOnce per turn: You can reveal 3 Equip Spell Cards from your Deck; your opponent randomly picks 1 to add to your hand and the rest are shuffled back. If this card would be destroyed while equipped with an Equip Spell(s), you can send 1 of those cards to the GY instead.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 500,
  effects: [
    {
      // RGBT: the destruction replacement was in the text but not scripted (ABPF replaceDestroyOne hook).
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card) => {
        if (card !== ctx.self) return false;
        const eqs = ctx.game.equipsOf(ctx.self).filter((c) => c.isSpell && c.data.stype === 'equip' && c.faceUp);
        if (!eqs.length) return false;
        if (!(await ctx.confirm(`Send an Equip Spell to the GY instead of destroying ${ctx.self.name}?`, true))) return false;
        const [e] = await ctx.select(eqs, 1, 1, 'Send 1 Equip Spell equipped to this card to the GY.', 'cost');
        if (!e) return false;
        await ctx.sendToGrave(e, 'effect');
        return true;
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Reveal 3 Equip Spells',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', (c) => c.isSpell && c.data.stype === 'equip').length >= 3 && !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck'),
      resolve: async (ctx) => {
        const equips = ctx.deck('me', (c) => c.isSpell && c.data.stype === 'equip');
        if (equips.length < 3) return;
        const shown = await ctx.select(equips, 3, 3, 'Reveal 3 Equip Spell Cards from your Deck.', 'toHand');
        if (shown.length < 3) return;
        ctx.log(`${ctx.game.players[ctx.player].name} reveals ${shown.map((c) => c.name).join(', ')}.`);
        const pick = ctx.game.rng.pick(shown);
        await ctx.toHand(pick);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 55 },
    },
  ],
});

/** Armory Arm: equipping and unequipping share one "once per turn" (per copy). */
const armoryKey = (ctx: Ctx) => `armory:${ctx.self.uid}`;
monster('Armory Arm', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1800,
  def: 1200,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nOnce per turn, you can either: Target 1 monster on the field; equip this card to it, OR: Unequip this card and Special Summon it in face-up Attack Position. While equipped by this effect, the equipped monster gains 1000 ATK. When the equipped monster destroys a monster by battle and sends it to the GY: inflict damage to your opponent equal to that monster\'s original ATK.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 500,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Equip to a monster',
      categories: ['atkChange'],
      condition: (ctx) => !ctx.usedThisTurn(armoryKey(ctx)),
      canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.faceUpMonsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.markUsed(armoryKey(ctx));
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster to equip Armory Arm to.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp || ctx.freeSZones() <= 0) return;
        const proper = ctx.self.properlySummoned;
        await ctx.game.moveCards([ctx.self], 'szone', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self, minor: true });
        if ((ctx.self.location as string) !== 'szone') return;
        // Still the properly Synchro Summoned card: it can be revived later from the GY.
        ctx.self.properlySummoned = proper;
        ctx.equip(t);
        ctx.log(`${ctx.self.name} is equipped to ${t.name}.`);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1) return 0;
          const mine = ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.pos === 'atk');
          if (!mine.length) return 0;
          const best = Math.max(...mine.map((c) => ctx.atk(c)));
          const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((c) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c))));
          // Worth it when the boost lets a monster win a battle it would otherwise lose.
          return best + 1000 > oppBest && best <= oppBest ? 40 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c) => c === ctx.equipTarget, value: 1000 }],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['szone'],
      mandatory: true,
      label: 'Burn',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const host = ctx.equipTarget;
        return !!host && ev.other === host && (ev.card as C).location === 'grave' && host.location === 'mzone';
      },
      resolve: async (ctx) => {
        const c = ctx.event!.card as C;
        await ctx.damage(ctx.opp, c.data.atk ?? 0);
      },
    },
    {
      // "...or unequip it to Special Summon this card in face-up Attack Position" (shares the once per turn).
      kind: 'ignition',
      range: ['szone'],
      label: 'Unequip: Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.self.location === 'szone' && ctx.equipTarget !== undefined && !ctx.usedThisTurn(armoryKey(ctx)) && ctx.canSummonSelf(),
      activate: async (ctx) => {
        ctx.markUsed(armoryKey(ctx));
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'szone' || !ctx.canSpecialSummon()) return;
        await ctx.specialSummon(ctx.self, { pos: 'atk', ignoreConditions: true, proper: ctx.self.properlySummoned });
      },
      ai: {
        // Come back as a monster when the equipped monster is now the opponent's.
        score: (ctx) => {
          const h = ctx.equipTarget;
          return h && h.controller !== ctx.player ? 30 : 0;
        },
      },
    },
  ],
});

monster('Ally of Justice Catastor', {
  attribute: 'DARK',
  race: 'Machine',
  level: 5,
  atk: 2200,
  def: 1200,
  types: ['synchro'],
  sets: ['ally-of-justice'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nAt the start of the Damage Step, if this card battles a face-up non-DARK monster: destroy that monster.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 900,
  effects: [
    {
      // Engine has no "start of the Damage Step" event: used in the Damage Step window before damage calculation.
      kind: 'quick',
      damageStep: true,
      label: 'Destroy non-DARK opponent',
      categories: ['destroy'],
      condition: (ctx) => {
        const o = battleOpponent(ctx);
        return !!ctx.battle?.inDamageStep && !!o && o.location === 'mzone' && o.faceUp && o.data.attribute !== 'DARK';
      },
      resolve: async (ctx) => {
        const o = battleOpponent(ctx);
        if (o && o.location === 'mzone' && o.faceUp && o.data.attribute !== 'DARK' && ctx.self.location === 'mzone') await ctx.destroy(o);
      },
      ai: { score: (ctx) => (battleOpponent(ctx)?.controller === ctx.opp ? 100 : 0) },
    },
  ],
});

monster('Junk Warrior', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 5,
  atk: 2300,
  def: 1300,
  types: ['synchro'],
  text: '"Junk Synchron" + 1 or more non-Tuner monsters\nWhen this card is Synchro Summoned: it gains ATK equal to the total ATK of all Level 2 or lower monsters you control.',
  synchro: { tuner: synchronNamed('Junk Synchron'), desc: '"Junk Synchron" + 1+ non-Tuner monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      mandatory: true,
      label: 'Power of Friendship',
      categories: ['atkChange'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.level(c) <= 2).length > 0,
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        const sum = ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.level(c) <= 2).reduce((a, c) => a + ctx.atk(c), 0);
        if (sum > 0) ctx.addTempMod(ctx.self, 'atk', sum, 'field');
      },
    },
  ],
});

monster('Junk Destroyer', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 8,
  atk: 2600,
  def: 2500,
  types: ['synchro'],
  text: '1 "Synchron" Tuner + 1 or more non-Tuner monsters\nWhen this card is Synchro Summoned: You can target cards on the field, up to the number of non-Tuner Synchro Materials used; destroy them.',
  synchro: { tuner: anySynchron, desc: '1 "Synchron" Tuner + 1+ non-Tuner monsters' },
  aiValue: 900,
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      when: true,
      label: 'Destroy cards',
      categories: ['destroy'],
      condition: (ctx) => ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const mats = (ctx.self.flags.materials ?? []) as { card?: C }[];
        const n = Math.max(1, mats.filter((m) => m.card && !m.card.isTuner).length || mats.length - 1);
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, n, `Target up to ${n} card(s) to destroy.`, 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.field('opp', (c) => ctx.canTarget(c)).length ? 1 : 0) },
    },
  ],
});

let turboGuard = false;
monster('Turbo Warrior', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 6,
  atk: 2500,
  def: 1500,
  types: ['synchro'],
  text: '"Turbo Synchron" + 1 or more non-Tuner monsters\nIf this card attacks a Level 6 or higher Synchro Monster, that monster\'s ATK is halved during the Damage Step only. Cannot be targeted by the effects of Level 6 or lower monsters.',
  synchro: { tuner: synchronNamed('Turbo Synchron'), desc: '"Turbo Synchron" + 1+ non-Tuner monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c) => {
            const b = ctx.battle;
            return !!b && b.inDamageStep && b.attacker === ctx.self && b.target === c && c.faceUp && c.hasType('synchro') && ctx.level(c) >= 6;
          },
          value: (ctx, c) => {
            if (turboGuard) return 0;
            turboGuard = true;
            try {
              return -Math.floor(ctx.atk(c) / 2);
            } finally {
              turboGuard = false;
            }
          },
        },
      ],
    },
  ],
  // "Cannot be targeted by the effects of Level 6 or lower monsters" (either player's).
  targetImmunity: (_self, source, ctx) => source.isMonster && (source.onField ? ctx.level(source) : source.data.level ?? 0) <= 6,
});

/** An "Iron Chain" monster (Iron Chain Dragon's effect). */
const isIronChainMon = (c: CardInstance) => c.isMonster && (c.inSet('iron-chain') || c.name.includes('Iron Chain'));
monster('Iron Chain Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 6,
  atk: 2500,
  def: 1300,
  types: ['synchro'],
  sets: ['iron-chain'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nYou can remove from play all "Iron Chain" monsters from your Graveyard to have this card gain 200 ATK for each card removed, until the End Phase. When this card inflicts Battle Damage to your opponent, send the top 3 cards of your opponent\'s Deck to the Graveyard.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 200,
  effects: [
    {
      kind: 'ignition',
      label: 'Banish all "Iron Chain": +200 ATK each',
      categories: ['atkChange'],
      // https://edisonrul.ing/cards/i/iron-chain-dragon.html — no cost and no target: when it resolves, remove from play
      // ALL "Iron Chain" monsters in your GY; this card gains 200 ATK for each card removed, until the End Phase.
      canActivate: (ctx) => ctx.grave('me', isIronChainMon).length > 0,
      resolve: async (ctx) => {
        const all = ctx.grave('me', isIronChainMon);
        if (!all.length) return;
        const r = await ctx.banish(all);
        const n = r.filter((c) => c.location === 'banished').length;
        if (n && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 200 * n, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1 || ctx.self.pos !== 'atk') return 0;
          const a = ctx.atk(ctx.self);
          const gain = 200 * ctx.grave('me', isIronChainMon).length;
          return ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.atk(c) >= a && ctx.atk(c) < a + gain).length ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['mzone'],
      mandatory: true,
      label: 'Mill 3',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp && ev.reasonCard === ctx.self,
      resolve: async (ctx) => {
        await ctx.mill(3, ctx.opp);
      },
    },
  ],
});

monster('Ancient Sacred Wyvern', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 7,
  atk: 2100,
  def: 2000,
  types: ['synchro'],
  text: '1 LIGHT Tuner + 1 or more non-Tuner monsters\nIf your LP is higher than your opponent\'s, this card gains ATK equal to the difference; if lower, it loses ATK equal to the difference. When this card is destroyed by battle and sent to the GY: You can pay 1000 LP; Special Summon it.',
  synchro: { tuner: attr('LIGHT'), desc: '1 LIGHT Tuner + 1+ non-Tuner monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => ctx.lp - ctx.oppLp }],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Pay 1000: revive',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.canSummonSelf() && ctx.lp > 1000,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self, { ignoreConditions: true });
      },
      ai: { score: (ctx) => (ctx.lp > 3000 && 2100 + (ctx.lp - 1000 - ctx.oppLp) >= 0 ? 1 : 0) },
    },
  ],
});

monster('Gaia Knight, the Force of Earth', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 2600,
  def: 800,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\n(This card has no effect.)',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
});

monster('Exploder Dragonwing', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 7,
  atk: 2400,
  def: 1600,
  types: ['synchro'],
  // RGBT: the non-Tuner material must be Dragon-Type (YGOJSON text).
  text: '1 Tuner + 1 or more non-Tuner Dragon-Type monsters\nAt the start of the Damage Step, if this card battles a monster: You can destroy that monster, and if you do, inflict damage to your opponent equal to the ATK the destroyed monster had on the field. This card\'s ATK must be greater than or equal to the ATK of that monster to activate and to resolve this effect.',
  synchro: { nonTuner: (c) => c.isMonster && c.data.race === 'Dragon', desc: '1 Tuner + 1+ non-Tuner Dragon-Type monsters' },
  aiValue: 700,
  effects: [
    {
      // Used in the Damage Step window, before damage calculation.
      kind: 'quick',
      damageStep: true,
      label: 'Destroy & burn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => {
        const o = battleOpponent(ctx);
        return !!ctx.battle?.inDamageStep && !!o && o.controller === ctx.opp && o.location === 'mzone' && o.faceUp && ctx.atk(o) <= ctx.atk(ctx.self);
      },
      resolve: async (ctx) => {
        const o = battleOpponent(ctx);
        if (!o || o.location !== 'mzone' || ctx.self.location !== 'mzone' || ctx.atk(o) > ctx.atk(ctx.self)) return;
        const atk = ctx.atk(o);
        const d = await ctx.destroy(o);
        if (d.length) await ctx.damage(ctx.opp, atk);
      },
      ai: { score: () => 90 },
    },
  ],
});

monster('Avenging Knight Parshath', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 8,
  atk: 2600,
  def: 2100,
  types: ['synchro'],
  sets: ['parshath'],
  text: '1 Tuner + 1 or more non-Tuner LIGHT monsters\nIf this card attacks a Defense Position monster, inflict piercing battle damage. Once per turn: You can target 1 face-up monster your opponent controls; change its battle position.',
  synchro: { nonTuner: attr('LIGHT'), desc: '1 Tuner + 1+ non-Tuner LIGHT monsters' },
  aiValue: 500,
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'ignition',
      opt: true,
      label: 'Change battle position',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const a = ctx.atk(ctx.self);
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster to change its battle position.', 'position', {
          // Prefer flipping a strong attacker into a weak defender (then pierce it).
          aiScore: (c) => (c.pos === 'atk' ? ctx.atk(c) - ctx.def(c) + (ctx.def(c) < a ? 1000 : 0) : -ctx.def(c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (t) await ctx.changePos(t, t.pos === 'atk' ? 'def' : 'atk', true);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1) return 0;
          const a = ctx.atk(ctx.self);
          return ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && (ctx.atk(c) >= a || ctx.def(c) < a - 500)).length ? 35 : 0;
        },
      },
    },
  ],
});

monster('Dewloren, Tiger King of the Ice Barrier', {
  attribute: 'WATER',
  race: 'Beast',
  level: 6,
  atk: 2000,
  def: 1400,
  types: ['synchro'],
  sets: ['ice-barrier'],
  text: '1 Tuner + 1 or more non-Tuner WATER monsters\nOnce per turn: You can return any number of face-up cards you control to the hand; this card gains 500 ATK for each card returned, until the end of this turn.',
  synchro: { nonTuner: attr('WATER'), desc: '1 Tuner + 1+ non-Tuner WATER monsters' },
  aiValue: 300,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Return cards: +500 ATK each',
      categories: ['toHand', 'atkChange'],
      canActivate: (ctx) => ctx.field('me', (c) => c !== ctx.self && c.faceUp).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.field('me', (c) => c !== ctx.self && c.faceUp);
        const sel = await ctx.select(cands, 1, cands.length, 'Return any number of face-up cards you control to the hand.', 'toHand', {
          aiScore: (c) => 1000 - cardValue(ctx.game, c),
        });
        const r = await ctx.toHand(sel);
        const n = r.filter((c) => c.location === 'hand' || c.location === 'extra').length;
        if (n && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 500 * n, 'turn');
      },
      ai: {
        score: (ctx) => {
          // Only go for it when it is lethal.
          if (ctx.phase !== 'main1' || ctx.turn <= 1 || ctx.monsters('opp').length || ctx.self.pos !== 'atk') return 0;
          const n = ctx.field('me', (c) => c !== ctx.self && c.faceUp).length;
          const others = ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.pos === 'atk').reduce((a, c) => a + ctx.atk(c), 0);
          const a = ctx.atk(ctx.self);
          return a < ctx.oppLp - others && a + 500 * n >= ctx.oppLp ? 70 : 0;
        },
      },
    },
  ],
});

monster('Explosive Magician', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 6,
  atk: 2500,
  def: 1800,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner Spellcaster-Type monsters\nYou can remove 2 Spell Counters from your side of the field to target 1 Spell/Trap Card on the field; destroy it.',
  synchro: { nonTuner: race('Spellcaster'), desc: '1 Tuner + 1+ non-Tuner Spellcaster-Type monsters' },
  aiValue: 400,
  effects: [
    {
      kind: 'ignition',
      label: 'Remove 2 Spell Counters: destroy S/T',
      categories: ['destroy'],
      canActivate: (ctx) => spellCounters(ctx) >= 2 && ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        if (!(await removeSpellCounters(ctx, 2))) return false;
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap Card to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length ? 45 : 0) },
    },
  ],
});

monster('Dark Strike Fighter', {
  attribute: 'DARK',
  race: 'Machine',
  level: 7,
  atk: 2600,
  def: 1800,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nOnce per turn, during your Main Phase 1: You can Tribute 1 monster; inflict damage to your opponent equal to that monster\'s Level on the field x 200.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 600,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute: burn',
      categories: ['damage'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed')).length > 0,
      activate: async (ctx) => {
        const lethal = (c: C) => ctx.level(c) * 200 >= ctx.oppLp;
        const sel = await ctx.select(ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed')), 1, 1, 'Tribute 1 monster.', 'tribute', {
          aiScore: (c) => (lethal(c) ? 10000 : 0) + ctx.level(c) * 200 - cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        ctx.data.dmg = (sel[0].faceUp ? ctx.level(sel[0]) : sel[0].data.level ?? 0) * 200;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.dmg ?? 0);
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed'));
          if (mons.some((c) => ctx.level(c) * 200 >= ctx.oppLp)) return 95;
          if (ctx.turn > 1 && ctx.phase === 'main1') return 0; // keep attackers before battle
          return mons.some((c) => c !== ctx.self && (c.isToken || cardValue(ctx.game, c) < 900)) ? 30 : 0;
        },
      },
    },
  ],
});

// ============================================================ FUSION MONSTERS

monster('Thousand-Eyes Restrict', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 1,
  atk: 0,
  def: 0,
  types: ['fusion'],
  text: '"Relinquished" + "Thousand-Eyes Idol"\nOther monsters on the field cannot change their battle positions or attack. Once per turn: You can target 1 monster your opponent controls; equip it to this card (only 1 at a time). This card\'s ATK/DEF become the equipped monster\'s. If this card would be destroyed by battle, destroy the equipped monster instead.',
  fusion: { materials: [named('Relinquished'), named('Thousand-Eyes Idol')], desc: '"Relinquished" + "Thousand-Eyes Idol"' },
  aiValue: 2500,
  effects: (() => {
    const equipped = (ctx: Ctx) => ctx.game.equipsOf(ctx.self).find((c) => c.isMonster && c.flags.terEquip);
    const effs: EffectDef[] = [
      {
        kind: 'continuous',
        mods: [
          { q: 'cannotAttack', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && c !== ctx.self },
          { q: 'cannotChangePos', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && c !== ctx.self },
          { q: 'atk', value: (ctx) => equipped(ctx)?.data.atk ?? 0 },
          { q: 'def', value: (ctx) => equipped(ctx)?.data.def ?? 0 },
          { q: 'indestructibleBattle', value: (ctx) => !!equipped(ctx) },
        ],
      },
      {
        kind: 'ignition',
        opt: true,
        label: 'Absorb a monster',
        categories: ['control', 'atkChange'],
        condition: (ctx) => !equipped(ctx),
        canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
        activate: async (ctx) => {
          await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls to equip.', 'control', {
            aiScore: (c) => (c.faceUp ? (c.data.atk ?? 0) + cardValue(ctx.game, c) : 1500),
          });
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.location === 'mzone')[0];
          if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp || ctx.freeSZones() <= 0 || equipped(ctx)) return;
          ctx.game.rawMove(t, 'szone', { controller: ctx.player, faceUp: true });
          if (t.location !== 'szone') return;
          t.flags.terEquip = true;
          ctx.equip(ctx.self, t);
          ctx.log(`${ctx.self.name} absorbs ${t.name}.`);
          await ctx.game.ruleCleanup();
          ctx.game.update();
        },
        ai: { score: () => 80 },
      },
      {
        // Destruction substitute: approximated as battle-indestructible while equipped, then the equip is destroyed.
        kind: 'trigger',
        event: 'damageStepEnd',
        mandatory: true,
        label: 'Destroy equipped monster instead',
        categories: ['destroy'],
        eventFilter: (ctx, ev) => {
          const self = ctx.self;
          if (self.location !== 'mzone' || !equipped(ctx)) return false;
          const other = (ev.card === self ? ev.other : ev.other === self ? ev.card : undefined) as C | undefined;
          if (!other) return false;
          const a = ctx.atk(self);
          const o = ctx.atk(other);
          if (ev.card === self) return other.pos === 'atk' && (o > a || (o === a && a > 0));
          return self.pos === 'atk' ? o > a || (o === a && o > 0) : o > ctx.def(self);
        },
        resolve: async (ctx) => {
          const e = equipped(ctx);
          if (e) await ctx.destroy(e);
        },
      },
    ];
    return effs;
  })(),
});

monster('Cyber Twin Dragon', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 8,
  atk: 2800,
  def: 2100,
  types: ['fusion'],
  sets: ['cyber'],
  text: '"Cyber Dragon" + "Cyber Dragon"\nA Fusion Summon of this card can only be done with the above Fusion Materials. This card can make a second attack during each Battle Phase.',
  fusion: { materials: [named('Cyber Dragon'), named('Cyber Dragon')], desc: '"Cyber Dragon" + "Cyber Dragon"' },
  aiValue: 800,
  effects: [{ kind: 'continuous', mods: [{ q: 'extraAttacks', value: 1 }] }],
});

monster('Cyber End Dragon', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 10,
  atk: 4000,
  def: 2800,
  types: ['fusion'],
  sets: ['cyber'],
  text: '"Cyber Dragon" + "Cyber Dragon" + "Cyber Dragon"\nA Fusion Summon of this card can only be done with the above Fusion Materials. If this card attacks a Defense Position monster, inflict piercing battle damage.',
  fusion: { materials: [named('Cyber Dragon'), named('Cyber Dragon'), named('Cyber Dragon')], desc: '"Cyber Dragon" x3' },
  aiValue: 600,
  effects: [{ kind: 'continuous', mods: [{ q: 'piercing' }] }],
});

monster('Chimeratech Overdragon', {
  attribute: 'DARK',
  race: 'Machine',
  level: 9,
  atk: 0,
  def: 0,
  types: ['fusion'],
  nomi: true,
  text: '"Cyber Dragon" + 1 or more Machine-Type monsters\nMust be Fusion Summoned. When Fusion Summoned: send all other cards you control to the GY. Its original ATK/DEF are 800 x the number of Fusion Materials used. It can attack that many times each Battle Phase.',
  fusion: { materials: [named('Cyber Dragon'), race('Machine')], desc: '"Cyber Dragon" + 1+ Machine-Type monsters' },
  aiValue: 1500,
  effects: [
    {
      kind: 'trigger',
      event: 'fusionSummoned',
      mandatory: true,
      label: 'Send all other cards to the GY',
      categories: [],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self) return false;
        ctx.self.flags.overdragonN = Math.max(2, fusionMaterialCount(ctx, ctx.self));
        ctx.game.update();
        return true;
      },
      resolve: async (ctx) => {
        const others = ctx.field('me', (c) => c !== ctx.self);
        if (others.length) await ctx.sendToGrave(others);
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 800 * (ctx.self.flags.overdragonN ?? 0) },
        { q: 'def', value: (ctx) => 800 * (ctx.self.flags.overdragonN ?? 0) },
        { q: 'extraAttacks', value: (ctx) => Math.max(0, (ctx.self.flags.overdragonN ?? 1) - 1) },
      ],
    },
  ],
});

monster('Dark Balter the Terrible', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 5,
  atk: 2000,
  def: 1200,
  types: ['fusion'],
  text: '"Possessed Dark Soul" + "Frontier Wiseman"\nWhen a Normal Spell Card is activated: You can pay 1000 LP; negate its activation and effect. The effects of Effect Monsters destroyed by battle with this card are negated.',
  fusion: { materials: [named('Possessed Dark Soul'), named('Frontier Wiseman')], desc: '"Possessed Dark Soul" + "Frontier Wiseman"' },
  aiValue: 400,
  effects: [
    {
      kind: 'quick',
      label: 'Pay 1000: negate Normal Spell',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && l.card.isSpell && l.card.data.stype === 'normal' && ctx.lp > 1000;
      },
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        ctx.negate(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp || ctx.lp <= 2000) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroyMulti', 'control', 'specialSummon', 'draw', 'search'].includes(c)) || l.ctx.targets.some((t) => t.controller === ctx.player)
            ? 65
            : 0;
        },
      },
    },
    {
      // Negates effects of monsters it destroys by battle: drop their pending triggers before they chain.
      kind: 'trigger',
      event: ['battleDestroyed', 'damageStepEnd'],
      label: 'Negate destroyed monster',
      eventFilter: (ctx, ev: GameEvent) => {
        if (ev.type === 'battleDestroyed' && ev.other === ctx.self && !ctx.isNegated(ctx.self)) {
          const c = ev.card as C;
          if (c.hasType('effect')) c.flags.balterNegated = true;
        } else if (ev.type === 'damageStepEnd' && (ev.card === ctx.self || ev.other === ctx.self)) {
          ctx.game.pending = ctx.game.pending.filter((t) => !t.card.flags.balterNegated);
          for (const p of [0, 1] as const) for (const c of ctx.game.players[p].grave) delete c.flags.balterNegated;
        }
        return false;
      },
    },
  ],
});

export const EXTRA_LOADED = true;
