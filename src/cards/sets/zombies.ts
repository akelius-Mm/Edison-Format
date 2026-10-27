// Card definitions: Zombies (Zombie Synchro / Plaguespreader engine).
import { monster, spell } from '../define';
import { aiCanSpecialSummon, cardValue } from '../helpers';
import { dataVariant, type CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import { geminiSummonEffect, isGeminiActive, searchScored, synchroOptions } from './plants';

/** Zombie-Type check. Zombie World's Type change is applied by the engine (EffectDef.dataMod), so `data.race` already has it. */
export function isZombie(_ctx: Ctx, c: CardInstance) {
  return c.isMonster && c.data.race === 'Zombie';
}

/** Value of having this monster on the field right now (AI): ATK plus a bonus if it unlocks a Synchro. */
function reviveValue(ctx: Ctx, c: CardInstance) {
  let v = (c.data.atk ?? 0) + (c.data.aiValue ?? 0) / 2;
  if (synchroOptions(ctx, [{ card: c }]).length > synchroOptions(ctx).length) v += 1200;
  if (c.name === 'Goblin Zombie') v += 300; // becomes a searcher when it leaves the field
  return v;
}

/** How willing we are to discard this card for Zombie Master. */
function zombieDiscardScore(ctx: Ctx, c: CardInstance) {
  switch (c.name) {
    case 'Mezuki':
      return 900;
    case 'Plaguespreader Zombie':
      return 850;
    case 'Red-Eyes Zombie Dragon':
    case 'Ryu Kokki':
    case 'Despair from the Dark':
    case 'Vampire Lord':
    case 'Il Blud':
      return ctx.hand('me', (h) => h.name === 'Book of Life').length || ctx.grave('me', (g) => g.name === 'Mezuki').length ? 750 : 400;
    case 'Necro Gardna':
      return 800;
    default:
      return -cardValue(ctx.game, c) / 4;
  }
}

// ==================================================================== monsters

monster('Zombie Master', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 4,
  atk: 1800,
  def: 0,
  // TAEV (Edison) text: the face-up clause is part of the card; a target must already be in a GY before the discard (2008 ruling).
  text: "Once per turn, you can discard 1 monster card to select and Special Summon 1 Level 4 or lower Zombie-Type monster from either player's Graveyard. This card must be face-up on the field to activate and to resolve this effect.",
  aiValue: 500,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard a monster: revive a Zombie',
      categories: ['specialSummon', 'discard'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.hand('me', (c) => c.isMonster).length > 0 &&
        // Ruling: a target must already be in a GY; the monster discarded for the cost does not count.
        ctx.grave('both', (c) => isZombie(ctx, c) && (c.data.level ?? 0) <= 4 && !c.isExtra && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        const disc = await ctx.select(ctx.hand('me', (c) => c.isMonster), 1, 1, 'Discard 1 monster.', 'discard', { aiScore: (c) => zombieDiscardScore(ctx, c) });
        if (!disc.length) return false;
        await ctx.discard(disc, 'cost');
        const cands = ctx.grave('both', (c) => isZombie(ctx, c) && (c.data.level ?? 0) <= 4 && !c.isExtra && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 Level 4 or lower Zombie-Type monster in either GY.', 'specialSummon', {
          aiScore: (c) => reviveValue(ctx, c) - (c.name === 'Mezuki' && c.owner === ctx.player ? 600 : 0),
        });
      },
      resolve: async (ctx) => {
        // "This card must be face-up on the field to activate and to resolve this effect."
        if (!ctx.self.faceUpMonster) return;
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0]);
      },
      ai: {
        score: (ctx) => {
          const disc = Math.max(...ctx.hand('me', (c) => c.isMonster).map((c) => zombieDiscardScore(ctx, c)));
          const cands = ctx.grave('both', (c) => isZombie(ctx, c) && (c.data.level ?? 0) <= 4 && !c.isExtra && ctx.canSummonCard(c));
          const best = Math.max(0, ...cands.map((c) => reviveValue(ctx, c)));
          if (disc >= 700) return best >= 1000 || synchroOptions(ctx, cands.map((c) => ({ card: c }))).length ? 64 : 50;
          if (best >= 2200) return 52; // turns into a Synchro: worth a real card
          return disc > -300 && best >= 1500 ? 40 : 0;
        },
      },
    },
  ],
});

function goblinSearchScore(ctx: Ctx, c: CardInstance) {
  const inHand = ctx.hand('me', (h) => h.name === c.name).length;
  let s = 0;
  switch (c.name) {
    case 'Zombie Master':
      s = 1000;
      break;
    case 'Plaguespreader Zombie':
      s = 900;
      break;
    case 'Mezuki':
      s = 750;
      break;
    case 'Goblin Zombie':
      s = 600;
      break;
    default:
      s = (c.data.atk ?? 0) / 4;
  }
  return s - inHand * 400;
}

monster('Goblin Zombie', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 4,
  atk: 1100,
  def: 1050,
  text: 'If this card inflicts battle damage to your opponent: They send the top card of their Deck to the GY. When this card is sent from the field to the GY: Add 1 Zombie-Type monster with 1200 or less DEF from your Deck to your hand.',
  aiValue: 600,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Mill 1 from opponent\'s Deck',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        await ctx.mill(1, ctx.opp);
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Search a Zombie',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.to === 'grave' && (ev.from === 'mzone'),
      resolve: async (ctx) => {
        await searchScored(ctx, (c) => c.isMonster && c.data.race === 'Zombie' && (c.data.def ?? 0) <= 1200, 'Add 1 Zombie-Type monster with 1200 or less DEF to your hand.', (c) => goblinSearchScore(ctx, c));
      },
    },
  ],
});

monster('Mezuki', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1700,
  def: 800,
  text: 'You can remove from play this card from your Graveyard to Special Summon 1 Zombie-Type monster from your Graveyard.',
  aiValue: 600,
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish: revive a Zombie',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c !== ctx.self && isZombie(ctx, c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Zombie-Type monster in your GY.', 'specialSummon', {
          aiScore: (c) => reviveValue(ctx, c),
        });
      },
      // https://edisonrul.ing/cards/m/mezuki.html — "If the target is no longer a Zombie-Type monster, it is not Special
      // Summoned."
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave' && isZombie(ctx, c));
        if (t.length) await ctx.specialSummon(t[0]);
      },
      ai: {
        score: (ctx) => {
          const cands = ctx.grave('me', (c) => c !== ctx.self && isZombie(ctx, c) && ctx.canSummonCard(c));
          const best = Math.max(0, ...cands.map((c) => reviveValue(ctx, c)));
          if (best >= 2300) return 60;
          if (best >= 1700) return 45;
          return ctx.monsters('me').length === 0 && best >= 1000 ? 35 : 0;
        },
      },
    },
  ],
});

/** Attack Position only if it would not just be a free target (AI + human default). */
export function safePos(ctx: Ctx, c: CardInstance): 'atk' | 'def' {
  const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp', (m) => m.pos === 'atk').map((m) => ctx.atk(m)));
  return (c.data.atk ?? 0) >= oppBest && ctx.isMyTurn ? 'atk' : (c.data.def ?? 0) > (c.data.atk ?? 0) || oppBest > (c.data.atk ?? 0) ? 'def' : 'atk';
}

/** Card the AI puts back on top of the Deck for Plaguespreader (higher = put back). */
function putBackScore(ctx: Ctx, c: CardInstance) {
  const dup = ctx.hand('me', (h) => h.name === c.name).length > 1 ? 400 : 0;
  return dup - cardValue(ctx.game, c) + (c.name === 'Wulf, Lightsworn Beast' ? 1500 : 0);
}

monster('Plaguespreader Zombie', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 2,
  atk: 400,
  def: 200,
  types: ['tuner'],
  text: 'You can return 1 card from your hand to the top of the Deck to Special Summon this card from the Graveyard. If you do, remove this card from play when it is removed from the field.',
  aiValue: 700,
  effects: [
    {
      // https://edisonrul.ing/cards/p/plaguespreader-zombie.html — an Ignition Effect that activates & resolves in the GY
      // (your Main Phase, not only the Standby Phase); placing the hand card on top of the Deck is the cost.
      kind: 'ignition',
      range: ['grave'],
      label: 'Return a card to the Deck: revive',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.canSummonSelf() && ctx.hand().length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand(), 1, 1, 'Place 1 card from your hand on top of your Deck.', 'cost', { aiScore: (c) => putBackScore(ctx, c) });
        if (!sel.length) return false;
        await ctx.toDeck(sel, 'top', 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        const r = await ctx.specialSummon(ctx.self, { pos: safePos(ctx, ctx.self) });
        for (const c of r) c.banishOnLeave = true;
      },
      ai: {
        score: (ctx) => {
          // (not under our own Koa'ki Meiru Drago: the card goes back to the Deck and it stays in the GY)
          if (ctx.freeMZones() <= 0 || !aiCanSpecialSummon(ctx, ctx.self)) return 0;
          // Revive it for a Synchro Summon right away, or with a Normal Summon still to make that pairs with it.
          if (synchroOptions(ctx, [{ card: ctx.self }]).length) return 55;
          const hand = ctx.hand();
          if (ctx.game.players[ctx.player].normalSummonsLeft <= 0) return 0;
          // A normal-summonable non-Tuner in hand that pairs with it.
          const pair = hand.some((h) => h.isMonster && !h.isTuner && !h.data.cannotNormalSummon && (h.data.level ?? 0) <= 4 && synchroOptions(ctx, [{ card: ctx.self }, { card: h }]).length);
          return pair && hand.length >= 2 ? 45 : 0;
        },
      },
    },
  ],
});

monster('Pyramid Turtle', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1200,
  def: 1400,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 Zombie-Type monster with 2000 or less DEF from your Deck.',
  aiValue: 500,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Summon a Zombie from Deck',
      categories: ['specialSummon'],
      // "When ... you can": an optional trigger that can miss the timing
      // (https://edisonrul.ing/cards/misc/battle-tutors-mystic-tomato-shining-angel-ufo-turtle-mother-grizzly-flying-kaminari-1-giant-rat-pyramid-turtle-etc.html).
      when: true,
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => c.isMonster && c.data.race === 'Zombie' && (c.data.def ?? 0) <= 2000 && !c.data.nomi).length > 0,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.deck('me', (c) => c.isMonster && c.data.race === 'Zombie' && (c.data.def ?? 0) <= 2000 && !c.data.nomi);
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Zombie-Type monster with 2000 or less DEF from your Deck.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.name === 'Pyramid Turtle' ? 400 : 0),
        });
        if (sel.length) await ctx.specialSummon(sel[0]);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Il Blud', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2100,
  def: 800,
  types: ['gemini'],
  text: 'Gemini: treated as a Normal Monster while face-up on the field or in the GY; you can Normal Summon it again to make it an Effect Monster with these effects.\nOnce per turn: You can Special Summon 1 Zombie-Type monster from your hand or either GY. When this card leaves the field, destroy the monsters Special Summoned by this effect.',
  aiValue: 400,
  effects: [
    geminiSummonEffect(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Summon a Zombie from hand or either GY',
      categories: ['specialSummon'],
      condition: isGeminiActive,
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        [...ctx.hand('me', (c) => c.data.race === 'Zombie'), ...ctx.grave('both', (c) => isZombie(ctx, c))].some((c) => ctx.canSummonCard(c)),
      activate: async (ctx) => {
        ctx.data.mid = ctx.self.moveId;
        ctx.data.fid = ctx.self.faceUpId;
      },
      resolve: async (ctx) => {
        // https://edisonrul.ing/cards/i/il-blud.html — the Special Summon still resolves if Il Blud is turned face-down or
        // destroyed in response; a monster Summoned that way is not destroyed later by Il Blud's effect.
        const cands = [...ctx.hand('me', (c) => c.data.race === 'Zombie'), ...ctx.grave('both', (c) => isZombie(ctx, c))].filter((c) => ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Zombie-Type monster from your hand or either GY.', 'specialSummon', { aiScore: (c) => reviveValue(ctx, c) });
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0]);
        if (!ctx.self.faceUpMonster || ctx.self.moveId !== ctx.data.mid || ctx.self.faceUpId !== ctx.data.fid) return;
        for (const c of r) c.flags.ilBludSource = ctx.self.uid;
      },
      ai: { score: () => 60 },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Destroy the monsters it summoned',
      categories: ['destroy'],
      // https://edisonrul.ing/cards/i/il-blud.html — "The ② Continuous Effect does not start a chain": if Il Blud leaves
      // the field while a Chain resolves, the Zombies are destroyed before the next link resolves (Game.applyChainless);
      // if it leaves while its effects are negated (Skill Drain), they are not destroyed (GameEvent.fromNegated).
      noChain: true,
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
      condition: (ctx) => ctx.monsters('both', (c) => c.flags.ilBludSource === ctx.self.uid).length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both', (c) => c.flags.ilBludSource === ctx.self.uid));
      },
    },
  ],
});

monster('Red-Eyes Zombie Dragon', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 7,
  atk: 2400,
  def: 2000,
  text: 'Can only be Tribute Summoned by Tributing Zombie-Type monsters. When this card destroys a Zombie-Type monster by battle and sends it to the GY: You can Special Summon that monster to your side of the field.',
  aiValue: 300,
  // Note: the engine has no per-card tribute filter; the Zombie-only Tribute restriction is not enforced.
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Take the destroyed monster',
      categories: ['specialSummon'],
      // Only a Zombie-Type monster it destroys (Zombie World makes every monster in the GY a Zombie).
      eventFilter: (ctx, ev) =>
        ev.other === ctx.self && ctx.self.location === 'mzone' && (ev.card as CardInstance).location === 'grave' && isZombie(ctx, ev.card as CardInstance),
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const c = ctx.event!.card as CardInstance;
        if (c.location === 'grave' && isZombie(ctx, c) && ctx.canSummonCard(c)) await ctx.specialSummon(c);
      },
    },
  ],
});

monster('Doomkaiser Dragon', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2400,
  def: 1500,
  types: ['synchro'],
  text: '"Plaguespreader Zombie" + 1 or more non-Tuner Zombie-Type monsters\nWhen this card is Special Summoned, you can select 1 Zombie-Type monster in your opponent\'s Graveyard and Special Summon it to your side of the field in Attack Position. Destroy it when this card is removed from the field.',
  synchro: {
    tuner: (c) => c.name === 'Plaguespreader Zombie',
    nonTuner: (c) => c.data.race === 'Zombie',
    desc: '"Plaguespreader Zombie" + 1+ non-Tuner Zombie-Type monsters',
  },
  aiValue: 700,
  effects: [
    {
      // 2010 text: on any Special Summon (not only a Synchro Summon), in Attack Position, and that monster is destroyed
      // (no Chain) when this card leaves the field. https://edisonrul.ing/cards/d/doomkaiser-dragon.html
      kind: 'trigger',
      event: 'specialSummoned',
      label: 'Steal a Zombie from the opponent\'s GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('opp', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('opp', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Zombie-Type monster in your opponent\'s GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const r = await ctx.specialSummon(t[0], { pos: 'atk' });
        if (r.length && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.game.link(r[0], ctx.self, false);
      },
    },
  ],
});

monster('Vampire Lord', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 5,
  atk: 2000,
  def: 1500,
  text: 'If this card inflicts battle damage to your opponent: Declare 1 card type (Monster, Spell or Trap); your opponent sends 1 card of that type from their Deck to the GY. If this card is destroyed by your opponent\'s card effect and sent to your GY: Special Summon it during your next Standby Phase.',
  aiValue: 300,
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Declare a type: opponent sends a card to the GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        const deck = ctx.deck('opp');
        const types = ['Monster', 'Spell', 'Trap'];
        const count = (i: number) => deck.filter((c) => (i === 0 ? c.isMonster : i === 1 ? c.isSpell : c.isTrap)).length;
        const i = await ctx.option('Declare a card type.', types, (k) => count(k));
        ctx.log(`${ctx.game.players[ctx.player].name} declares ${types[i]}.`);
        const cands = deck.filter((c) => (i === 0 ? c.isMonster : i === 1 ? c.isSpell : c.isTrap));
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, 1, `Send 1 ${types[i]} from your Deck to the GY.`, 'toGrave', { player: ctx.opp });
        if (sel.length) await ctx.sendToGrave(sel);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Return next Standby Phase',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/v/vampire-lord.html — also when destroyed in the hand or Deck by the opponent's card
      // effect; it is Special Summoned even under "Necrovalley" (it does not target).
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self &&
        (ev.from === 'mzone' || ev.from === 'hand' || ev.from === 'deck') &&
        (ev.from !== 'mzone' || ev.fromController === ctx.self.owner) &&
        ctx.self.location === 'grave' &&
        (ev.reasons ?? []).includes('effect') &&
        ev.reasonPlayer === ctx.opp,
      resolve: async (ctx) => {
        const self = ctx.self;
        const id = self.moveId;
        const offset = ctx.isMyTurn ? 2 : 1;
        ctx.later(
          'standby',
          async () => {
            if (self.location !== 'grave' || self.moveId !== id) return;
            if (ctx.game.freeMZones(self.owner) <= 0) return;
            await ctx.game.specialSummon([self], self.owner, { pos: 'atk', reasonCard: self });
          },
          offset,
        );
      },
    },
  ],
});

monster('Ryu Kokki', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2400,
  def: 2200,
  text: 'If this card battles a Warrior or Spellcaster-Type monster, destroy that monster at the end of the Damage Step.',
  aiValue: 200,
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy the Warrior/Spellcaster',
      categories: ['destroy'],
      // https://edisonrul.ing/cards/r/ryu-kokki.html — it still activates if Ryu Kokki was destroyed by that battle; the
      // monster's current Type must be Warrior / Spellcaster.
      eventFilter: (ctx, ev) => {
        if (ctx.self.location !== 'mzone' && ctx.self.location !== 'grave') return false;
        const other = ev.card === ctx.self ? (ev.other as CardInstance | undefined) : ev.other === ctx.self ? (ev.card as CardInstance) : undefined;
        return !!other && other.location === 'mzone' && other.faceUp && (other.data.race === 'Warrior' || other.data.race === 'Spellcaster');
      },
      resolve: async (ctx) => {
        const ev = ctx.event!;
        const other = (ev.card === ctx.self ? ev.other : ev.card) as CardInstance;
        if (other && other.location === 'mzone') await ctx.destroy(other);
      },
    },
  ],
});

monster('Despair from the Dark', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 8,
  atk: 2800,
  def: 3000,
  text: 'If this card is sent from your hand or Deck to the GY by an opponent\'s card effect: Special Summon it.',
  aiValue: 200,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Special Summon itself',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || (ev.from !== 'hand' && ev.from !== 'deck')) return false;
        const reasons = ev.reasons ?? [ev.reason];
        if (reasons.includes('cost') || reasons.includes('rule')) return false;
        const rc = ev.reasonCard as CardInstance | undefined;
        if (rc) return rc.controller !== ctx.self.owner;
        return ev.reasonPlayer !== undefined && ev.reasonPlayer !== ctx.self.owner;
      },
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self);
      },
    },
  ],
});

// ==================================================================== spells

spell('Book of Life', 'quickplay', {
  text: 'Target 1 Zombie-Type monster in your GY and 1 monster in your opponent\'s GY; Special Summon the first target, and banish the second target.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'banish'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.grave('me', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)).length > 0 && ctx.grave('opp', (c) => c.isMonster).length > 0,
      activate: async (ctx) => {
        const z = await ctx.selectTargets(ctx.grave('me', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Zombie-Type monster in your GY.', 'specialSummon', {
          aiScore: (c) => reviveValue(ctx, c),
        });
        ctx.data.zombie = z[0];
        const o = await ctx.selectTargets(ctx.grave('opp', (c) => c.isMonster), 1, 1, 'Target 1 monster in your opponent\'s GY to banish.', 'banish', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0) + (c.data.race === 'Zombie' ? 500 : 0) + (c.isExtra ? 600 : 0),
        });
        ctx.data.other = o[0];
      },
      resolve: async (ctx) => {
        const valid = ctx.validTargets();
        const z = ctx.data.zombie as CardInstance | undefined;
        const o = ctx.data.other as CardInstance | undefined;
        if (z && valid.includes(z) && z.location === 'grave') await ctx.specialSummon(z);
        if (o && valid.includes(o) && o.location === 'grave') await ctx.banish(o);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => isZombie(ctx, c) && ctx.canSummonCard(c)).map((c) => reviveValue(ctx, c)));
          if (ctx.isMyTurn && (ctx.phase === 'main1' || ctx.phase === 'main2') && !ctx.chainTop()) {
            if (best >= 2200) return 58;
            if (best >= 1600 && ctx.phase === 'main1') return 45;
            return 0;
          }
          // Opponent's End Phase: surprise blocker / material for next turn.
          if (!ctx.isMyTurn && ctx.phase === 'end' && !ctx.chainTop() && best >= 1600) return 40;
          // Save a dying monster? Respond to an attack on an empty board with a blocker.
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.target && !b.inDamageStep && best >= 1700 && ctx.atk(b.attacker) <= best) return 55;
          return 0;
        },
      },
    },
  ],
});

spell('Zombie World', 'field', {
  text: 'All monsters on the field and in the GYs become Zombie-Type monsters. Neither player can Tribute Summon monsters, except Zombie-Type monsters.',
  aiValue: 200,
  // The Type change is a dataMod: every check that reads `data.race` sees it (also in the GY under Necrovalley: non-targeting Type
  // changes apply, https://edisonrul.ing/cards/n/necrovalley.html).
  // Monsters in the hand keep their Type, so only Zombies can be Tribute Summoned (Tribute Sets are allowed).
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (ctx.grave('opp', (c) => c.isMonster && c.data.race !== 'Zombie').length >= 2 ? 30 : 10) },
    },
    {
      kind: 'continuous',
      range: ['fzone'],
      mods: [{ q: 'cannotTributeSummon', to: 'cards', filter: (_ctx, c: CardInstance) => c.isMonster && c.data.race !== 'Zombie' }],
    },
    {
      kind: 'continuous',
      range: ['fzone'],
      dataMod: {
        to: 'cards',
        filter: (c) => c.isMonster && (c.location === 'mzone' || c.location === 'grave'),
        apply: (d) => (d.race === 'Zombie' ? d : dataVariant(d, 'race:Zombie', { race: 'Zombie' })),
      },
    },
  ],
});

export const ZOMBIES_LOADED = true;
