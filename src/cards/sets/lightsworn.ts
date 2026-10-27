// Card definitions: Lightsworn.
import { monster, spell } from '../define';
import { cardValue } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import { searchScored, synchroOptions } from './plants';

const isLS = (c: CardInstance) => c.isMonster && c.inSet('lightsworn');
const LS = ['lightsworn'];

/** "During each of your End Phases: Send the top N cards of your Deck to the GY." */
function endPhaseMill(n: number): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    range: ['mzone'],
    mandatory: true,
    label: `End Phase: send top ${n} to GY`,
    categories: ['mill'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.faceUp,
    resolve: async (ctx) => {
      await ctx.mill(n);
    },
  };
}

/** Distinct Lightsworn monster names in this player's GY. */
export function lightswornNamesInGrave(ctx: Ctx) {
  return new Set(ctx.grave('me', isLS).map((c) => c.name)).size;
}

/** AI: how useful is it to have this card in the GY (higher = happier to discard/send). */
function lsDumpScore(ctx: Ctx, c: CardInstance) {
  const names = new Set(ctx.grave('me', isLS).map((g) => g.name));
  const dupInHand = ctx.hand('me', (h) => h.name === c.name && h !== c).length > 0;
  let s = -cardValue(ctx.game, c) / 5;
  if (c.name === 'Judgment Dragon') return -5000;
  if (c.name === 'Necro Gardna') s += 900;
  if (c.name === 'Wulf, Lightsworn Beast') s += 700; // cannot be Normal Summoned anyway
  if (c.name === 'Celestia, Lightsworn Angel') s += 350;
  if (c.name === 'Plaguespreader Zombie') s += 500;
  if (isLS(c) && !names.has(c.name)) s += 400 + (names.size === 3 && ctx.hand('me', (h) => h.name === 'Judgment Dragon').length ? 1000 : 0);
  if (dupInHand) s += 250;
  if (c.name === 'Lumina, Lightsworn Summoner' && !ctx.monsters('me', (m) => m.name === c.name).length) s -= 300;
  return s;
}

function lsReviveValue(ctx: Ctx, c: CardInstance) {
  let v = (c.data.atk ?? 0) + (c.data.aiValue ?? 0) / 3;
  if (synchroOptions(ctx, [{ card: c }]).length > synchroOptions(ctx).length) v += 900;
  return v;
}

// ==================================================================== monsters

monster('Ryko, Lightsworn Hunter', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 2, // LODT: Level 2 per YGOJSON (was 4)
  atk: 200,
  def: 100,
  types: ['flip'],
  sets: LS,
  text: 'FLIP: You can target 1 card on the field; destroy it. Then send the top 3 cards of your Deck to the GY.',
  aiValue: 900,
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      label: 'FLIP: destroy 1 card, send top 3 to GY',
      categories: ['destroy', 'mill'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone',
      activate: async (ctx) => {
        const cands = ctx.field('both', (c) => c !== ctx.self);
        if (cands.length) await ctx.selectTargets(cands, 0, 1, 'You can target 1 card on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
        await ctx.mill(3);
      },
    },
  ],
});

monster('Lumina, Lightsworn Summoner', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 3,
  atk: 1000,
  def: 1000,
  sets: LS,
  text: 'Once per turn: You can discard 1 card, then target 1 Level 4 or lower "Lightsworn" monster in your GY; Special Summon that target. During each of your End Phases: Send the top 3 cards of your Deck to the GY.',
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard 1: revive a Lightsworn',
      categories: ['specialSummon', 'discard'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.hand().length > 0 &&
        (ctx.grave('me', (c) => isLS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0 || ctx.hand('me', (c) => isLS(c) && (c.data.level ?? 0) <= 4).length > 0),
      activate: async (ctx) => {
        const disc = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard', { aiScore: (c) => lsDumpScore(ctx, c) });
        if (!disc.length) return false;
        await ctx.discard(disc, 'cost');
        const cands = ctx.grave('me', (c) => isLS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 Level 4 or lower "Lightsworn" monster in your GY.', 'specialSummon', { aiScore: (c) => lsReviveValue(ctx, c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0]);
      },
      ai: {
        score: (ctx) => {
          const hand = ctx.hand();
          const disc = Math.max(...hand.map((c) => lsDumpScore(ctx, c)));
          const fromHand = hand.filter((c) => isLS(c) && (c.data.level ?? 0) <= 4 && lsDumpScore(ctx, c) === disc);
          const cands = [...ctx.grave('me', (c) => isLS(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)), ...fromHand];
          const best = Math.max(0, ...cands.map((c) => lsReviveValue(ctx, c)));
          if (disc >= 300) return best >= 1500 ? 66 : best >= 800 ? 52 : 0;
          if (disc >= -250) return best >= 1700 ? 55 : 0;
          return best >= 2500 ? 45 : 0;
        },
      },
    },
    endPhaseMill(3),
  ],
});

monster('Wulf, Lightsworn Beast', {
  attribute: 'LIGHT',
  race: 'Beast-Warrior', // LODT: Beast-Warrior per YGOJSON (was Beast)
  level: 4,
  atk: 2100,
  def: 300,
  sets: LS,
  cannotNormalSummon: true,
  text: 'Cannot be Normal Summoned/Set. If this card is sent from your Deck to the GY: Special Summon it.',
  aiValue: 200,
  effects: [
    {
      kind: 'trigger',
      event: 'milled',
      mandatory: true,
      label: 'Special Summon itself',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'deck' && ctx.self.location === 'grave',
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSpecialSummon()) await ctx.specialSummon(ctx.self);
      },
    },
  ],
});

monster('Jain, Lightsworn Paladin', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 1200,
  sets: LS,
  text: "If this card attacks an opponent's monster, it gains 300 ATK during the Damage Step only. During each of your End Phases: Send the top 2 cards of your Deck to the GY.",
  aiValue: 200,
  effects: [
    {
      kind: 'continuous',
      // LODT: only when attacking a monster (YGOJSON), not on direct attacks.
      mods: [{ q: 'atk', value: (ctx) => (ctx.battle && ctx.battle.inDamageStep && ctx.battle.attacker === ctx.self && !!ctx.battle.target ? 300 : 0) }],
    },
    endPhaseMill(2),
  ],
});

monster('Garoth, Lightsworn Warrior', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1850,
  def: 1300,
  sets: LS,
  text: 'If a card(s) is sent from your Deck to the GY by the effect of a "Lightsworn" monster you control, except "Garoth, Lightsworn Warrior": Send the top 2 cards of your Deck to the GY, then draw 1 card for each "Lightsworn" monster sent to the GY by this effect.',
  aiValue: 400,
  effects: [
    {
      kind: 'trigger',
      event: 'milled',
      range: ['mzone'],
      mandatory: true,
      label: 'Send top 2, draw per Lightsworn',
      categories: ['mill', 'draw'],
      eventFilter: (ctx, ev) => {
        const rc = ev.reasonCard as CardInstance | undefined;
        const c = ev.card as CardInstance;
        // LODT: the Lightsworn monster must be one you control (YGOJSON).
        return ctx.self.faceUp && c.owner === ctx.player && !!rc && rc.isMonster && rc.inSet('lightsworn') && rc.name !== 'Garoth, Lightsworn Warrior' && rc.controller === ctx.player;
      },
      resolve: async (ctx) => {
        const sent = await ctx.mill(2); // LODT: top 2 per YGOJSON (was 5)
        const n = sent.filter((c) => c.location === 'grave' && isLS(c)).length;
        if (n) await ctx.draw(n);
      },
    },
  ],
});

monster('Ehren, Lightsworn Monk', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1000,
  sets: LS,
  text: 'If this card attacks a Defense Position monster, return that monster to the Deck after damage calculation. During each of your End Phases: Send the top 3 cards of your Deck to the GY.',
  aiValue: 200,
  // Resolves right after damage calculation, before a monster it destroys by battle leaves the field, so that
  // monster goes back to the Deck instead of the GY (no "destroyed" / "sent to the GY" effects). It does not target.
  effects: [
    {
      kind: 'trigger',
      event: 'damageCalculated',
      mandatory: true,
      label: 'Shuffle the attacked monster into the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => {
        const t = ev.other as CardInstance | undefined;
        return ev.card === ctx.self && ctx.self.location === 'mzone' && !!t && t.location === 'mzone' && ctx.game.battle?.calc?.targetPos === 'def';
      },
      resolve: async (ctx) => {
        const t = ctx.event!.other as CardInstance;
        if (t && t.location === 'mzone') await ctx.toDeck(t, 'shuffle');
      },
    },
    endPhaseMill(3),
  ],
});

// LODT: corrected against YGOJSON — Level 5 (was 7), the effect needs a "Lightsworn" Tribute, sending the top
// 4 cards is the cost, only the opponent's cards can be targeted, and there is no End Phase mill.
monster('Celestia, Lightsworn Angel', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 5,
  atk: 2300,
  def: 200,
  sets: LS,
  text: 'When you Tribute Summon this card by Tributing a "Lightsworn" monster: You can send the top 4 cards of your Deck to the GY, then target up to 2 cards your opponent controls; destroy those targets.',
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      when: true,
      label: 'Send top 4: destroy up to 2 cards',
      categories: ['destroy', 'mill'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.tributes ?? []).some((t) => isLS(t as CardInstance)),
      condition: (ctx) => ctx.deck().length >= 4 && ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.game.mill(ctx.player, 4, 'cost', ctx.self);
        await ctx.selectTargets(ctx.field('opp'), 1, 2, 'Target up to 2 cards your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.field('opp').length > 0 && ctx.deck().length > 12 ? 1 : 0) },
    },
  ],
});

monster('Lyla, Lightsworn Sorceress', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 4,
  atk: 1700,
  def: 200,
  sets: LS,
  text: 'You can change this face-up Attack Position card to Defense Position, then target 1 Spell/Trap on the field; destroy it. This card\'s battle position cannot be changed until the end of your next turn. During each of your End Phases: Send the top 3 cards of your Deck to the GY.',
  aiValue: 500,
  effects: [
    {
      kind: 'ignition',
      label: 'To Defense: destroy 1 Spell/Trap',
      categories: ['destroy'],
      condition: (ctx) => ctx.self.pos === 'atk' && ctx.self.faceUp,
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.changePos(ctx.self, 'def', true);
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
        if (ctx.self.location === 'mzone') ctx.self.flags.lylaLockUntil = ctx.turn + 2;
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.spellTraps('opp');
          if (!opp.length) return 0;
          return opp.some((c) => !c.faceUp || c.data.stype === 'continuous' || c.data.ttype === 'continuous' || c.data.stype === 'field') ? 58 : 30;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotChangePos', value: (ctx) => ctx.self.flags.lylaLockUntil !== undefined && ctx.turn <= ctx.self.flags.lylaLockUntil }],
    },
    endPhaseMill(3),
  ],
});

monster('Aurkus, Lightsworn Druid', {
  attribute: 'LIGHT',
  race: 'Beast-Warrior',
  level: 3,
  atk: 1200,
  def: 1800,
  sets: LS,
  text: 'Neither player can target "Lightsworn" monsters with card effects. During each of your End Phases: Send the top 2 cards of your Deck to the GY.',
  aiValue: 300,
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'untargetableByAll', to: 'cards', filter: (_ctx, c: CardInstance) => c.faceUpMonster && c.inSet('lightsworn') }],
    },
    endPhaseMill(2),
  ],
});

/** Total value of the other cards a player controls (AI). */
function fieldValue(ctx: Ctx, side: 'me' | 'opp', except?: CardInstance) {
  return ctx.field(side, (c) => c !== except).reduce((a, c) => a + cardValue(ctx.game, c), 0);
}

monster('Judgment Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2600,
  cannotNormalSummon: true,
  nomi: true,
  text: 'Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) while you have 4 or more "Lightsworn" monsters with different names in your GY. You can pay 1000 LP; destroy all other cards on the field. During each of your End Phases: Send the top 4 cards of your Deck to the GY.',
  aiValue: 1600,
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && lightswornNamesInGrave(ctx) >= 4,
      ai: { score: () => 88 },
    },
    {
      kind: 'ignition',
      label: 'Pay 1000: destroy all other cards',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.field('both', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.field('both', (c) => c !== ctx.self));
      },
      ai: {
        score: (ctx) => {
          const theirs = fieldValue(ctx, 'opp');
          const mine = fieldValue(ctx, 'me', ctx.self);
          if (!ctx.field('opp').length) return 0;
          // Clearing the way for a lethal attack is always worth it.
          if (ctx.phase === 'main1' && ctx.oppLp <= ctx.atk(ctx.self) && ctx.monsters('opp').length) return 90;
          if (ctx.lp <= 2000 && theirs < 4000) return 0;
          return theirs - mine >= 1800 ? 60 + (theirs - mine) / 200 : 0;
        },
      },
    },
    endPhaseMill(4),
  ],
});

// ==================================================================== spells

function chargeScore(ctx: Ctx, c: CardInstance) {
  const inHand = ctx.hand('me', (h) => h.name === c.name).length;
  const onField = ctx.monsters('me', (m) => m.name === c.name).length;
  let s = 0;
  switch (c.name) {
    case 'Lumina, Lightsworn Summoner':
      s = 1000;
      break;
    case 'Ryko, Lightsworn Hunter':
      s = 850 + (ctx.field('opp').length ? 100 : 0);
      break;
    case 'Lyla, Lightsworn Sorceress':
      s = ctx.spellTraps('opp').length ? 950 : 600;
      break;
    case 'Garoth, Lightsworn Warrior':
      s = 650;
      break;
    case 'Jain, Lightsworn Paladin':
      s = 550;
      break;
    case 'Ehren, Lightsworn Monk':
      s = 450;
      break;
    case 'Aurkus, Lightsworn Druid':
      s = 400;
      break;
    case 'Wulf, Lightsworn Beast':
      s = -1000;
      break;
    default:
      s = (c.data.atk ?? 0) / 5;
  }
  return s - inHand * 500 - onField * 200;
}

spell('Charge of the Light Brigade', 'normal', {
  text: 'Send the top 3 cards of your Deck to the GY; add 1 Level 4 or lower "Lightsworn" monster from your Deck to your hand.',
  sets: LS,
  effects: [
    {
      kind: 'activate',
      categories: ['search', 'mill'],
      canActivate: (ctx) => ctx.deck().length >= 4 && ctx.deck('me', (c) => isLS(c) && (c.data.level ?? 0) <= 4).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck'),
      activate: async (ctx) => {
        await ctx.game.mill(ctx.player, 3, 'cost', ctx.self);
      },
      resolve: async (ctx) => {
        await searchScored(ctx, (c) => isLS(c) && (c.data.level ?? 0) <= 4, 'Add 1 Level 4 or lower "Lightsworn" monster to your hand.', (c) => chargeScore(ctx, c));
      },
      ai: { score: (ctx) => (ctx.deck().length > 10 ? 68 : 0) },
    },
  ],
});

spell('Solar Recharge', 'normal', {
  text: 'Discard 1 "Lightsworn" monster; draw 2 cards, then send the top 2 cards of your Deck to the GY.',
  sets: LS,
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'mill', 'discard'],
      // https://edisonrul.ing/cards/s/solar-recharge.html — cannot be activated with 3 or fewer cards left in the Deck.
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self && isLS(c)).length > 0 && ctx.deck().length >= 4,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && isLS(c)), 1, 1, 'Discard 1 "Lightsworn" monster.', 'discard', { aiScore: (c) => lsDumpScore(ctx, c) });
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
        await ctx.mill(2);
      },
      ai: {
        score: (ctx) => {
          if (ctx.deck().length < 8) return 0;
          const best = Math.max(...ctx.hand('me', (c) => c !== ctx.self && isLS(c)).map((c) => lsDumpScore(ctx, c)));
          return best >= 0 ? 64 : 45;
        },
      },
    },
  ],
});

spell('Lightsworn Sabre', 'equip', {
  text: 'Equip only to a "Lightsworn" monster. It gains 700 ATK. If this card is sent from your Deck to the GY: You can target 1 "Lightsworn" monster you control; equip this card to that target.',
  sets: LS,
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isLS(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isLS), 1, 1, 'Target 1 "Lightsworn" monster you control.', 'equip');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.faceUpMonster && isLS(c));
        if (t.length && ctx.self.onField) ctx.equip(t[0]);
      },
      ai: {
        score: (ctx) => {
          const best = ctx.faceUpMonsters('me', (c) => isLS(c) && c.pos === 'atk');
          if (!best.length || ctx.phase !== 'main1') return 0;
          const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((m) => (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m))));
          return best.some((m) => ctx.atk(m) <= oppBest && ctx.atk(m) + 700 > oppBest) || !ctx.monsters('opp').length ? 40 : 15;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: CardInstance) => c === ctx.equipTarget, value: 700 }],
    },
    {
      kind: 'trigger',
      event: 'milled',
      label: 'Equip from the GY',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.freeSZones() > 0 && ctx.faceUpMonsters('me', (c) => isLS(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isLS), 1, 1, 'Target 1 "Lightsworn" monster you control.', 'equip');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.faceUpMonster && isLS(c));
        if (!t.length || ctx.self.location !== 'grave' || ctx.freeSZones() <= 0) return;
        ctx.game.rawMove(ctx.self, 'szone', { controller: ctx.player, faceUp: true });
        ctx.self.activeOnField = true;
        ctx.equip(t[0]);
        ctx.log(`${ctx.self.name} is equipped to ${t[0].name}.`);
      },
    },
  ],
});

spell('Realm of Light', 'field', {
  // LODT: corrected against YGOJSON — counters for every card sent from your Deck to the GY (not only by
  // "Lightsworn" effects), the boost applies to all "Lightsworn" monsters, and the 2-counter destruction
  // replacement (card effects only) uses the ANPR replaceDestroy hook.
  text: 'Each time a card(s) is sent from your Deck to the Graveyard, place 1 Shine Counter on this card. All "Lightsworn" monsters gain 100 ATK for each Shine Counter on this card. If this card would be destroyed by a card effect, remove 2 Shine Counters from this card instead.',
  sets: LS,
  aiValue: 200,
  // Approximation: counters are placed without using the chain (via the event filter).
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isLS).length ? 25 : 12) } },
    {
      kind: 'trigger',
      event: 'milled',
      range: ['fzone'],
      label: 'Shine Counter',
      eventFilter: (ctx, ev) => {
        const self = ctx.self;
        if (!self.faceUp || !self.activeOnField || ctx.game.isNegated(self)) return false;
        const c = ev.card as CardInstance;
        if (c.owner !== self.controller) return false;
        if (self.flags.realmBatch !== ev.batch) {
          self.flags.realmBatch = ev.batch;
          self.counters.light = (self.counters.light ?? 0) + 1;
        }
        return false; // counters only; never starts a chain
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (_ctx, c: CardInstance) => c.faceUpMonster && c.inSet('lightsworn'),
          value: (ctx) => 100 * (ctx.self.counters.light ?? 0),
        },
      ],
    },
    {
      kind: 'continuous',
      range: ['fzone'],
      replaceDestroy: async (ctx, cards, reason) => {
        const self = ctx.self;
        if (reason !== 'effect' || !cards.includes(self) || (self.counters.light ?? 0) < 2) return [];
        self.counters.light = (self.counters.light ?? 0) - 2;
        ctx.log(`${self.name}: 2 Shine Counters are removed instead of destroying it.`);
        return [self];
      },
    },
  ],
});

export const LIGHTSWORN_LOADED = true;
