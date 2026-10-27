// Deck extras, wave 3: the cards the Format Library Edison decklists in src/decks/tournament4.ts need that no other set
// file defines.
//
// First English printings (all before the Edison cut-off, 2010-04-24):
//  * Salvage: Magic Ruler (MRL), 2002.
//  * Five-Headed Dragon: Structure Deck: Dinosaur's Rage Special Set, 2006-10-25.
//  * King Tiger Wanghu: Champion Pack: Game One, 2006-11-11.
//  * Terraforming: Champion Pack: Game Two, 2007-02-06.
//  * Volcanic Shell: Force of the Breaker (FOTB), 2007-05-16.
//  * Tuningware: Duelist Pack: Yusei (DP08-EN011), 2009-02-24.
// None of them was on the March 2010 Forbidden & Limited list, so all are Unlimited.
// Card text is the Edison-era (pre-errata) wording; effects follow the 2010 TCG rulings as far as the engine allows.
//
// Engine hook added for this wave (src/engine): CardData.synchroLevel (Tuningware's "can be treated as a Level 2
// monster when used for a Synchro Summon").
import { monster, spell } from '../define';
import { race } from '../helpers';
import type { CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

type C = CardInstance;

const isField = (c: C) => c.isSpell && c.data.stype === 'field';
const salvageable = (c: C) => c.isMonster && c.data.attribute === 'WATER' && (c.data.atk ?? 0) <= 1500;
const evc = (ctx: Ctx) => ctx.event?.card as C | undefined;

monster('Five-Headed Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 12,
  atk: 5000,
  def: 5000,
  types: ['fusion'],
  nomi: true,
  text: '5 Dragon-Type monsters\nThis card can only be Special Summoned by Fusion Summon. This card cannot be destroyed by battle with a DARK, EARTH, WATER, FIRE, or WIND monster.',
  fusion: { materials: [race('Dragon'), race('Dragon'), race('Dragon'), race('Dragon'), race('Dragon')], desc: '5 Dragon-Type monsters' },
  aiValue: 1800,
  effects: [
    {
      kind: 'continuous',
      // only a LIGHT monster can destroy it in battle
      active: (ctx) => {
        const b = ctx.game.battle;
        if (!b) return false;
        const other = b.attacker === ctx.self ? b.target : b.target === ctx.self ? b.attacker : null;
        return !!other && other.data.attribute !== 'LIGHT';
      },
      mods: [{ q: 'indestructibleBattle' }],
    },
  ],
});

spell('Salvage', 'normal', {
  text: 'Select 2 WATER monsters with 1500 or less ATK in your Graveyard and add them to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => salvageable(c) && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => salvageable(c) && ctx.canTarget(c)), 2, 2, 'Target 2 WATER monsters with 1500 or less ATK in your GY.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 10,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (ctx.grave('me', salvageable).length >= 2 ? 55 : 0) },
    },
  ],
});

monster('King Tiger Wanghu', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 1700,
  def: 1000,
  text: 'When a monster with 1400 or less ATK is Normal or Special Summoned, destroy it.',
  aiValue: 700,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      range: ['mzone'],
      mandatory: true,
      label: 'Destroy the Summoned monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as C | undefined;
        return !!c && ev.method !== 'flip' && ctx.self.faceUp && c.location === 'mzone' && c.faceUp && ctx.atk(c) <= 1400;
      },
      activate: async (ctx) => {
        const c = evc(ctx)!;
        ctx.data.mon = c;
        ctx.data.mid = c.moveId;
      },
      resolve: async (ctx) => {
        const c = ctx.data.mon as C;
        if (!c || c.location !== 'mzone' || c.moveId !== ctx.data.mid || !c.faceUp || ctx.atk(c) > 1400) return;
        await ctx.destroy(c);
      },
    },
  ],
});

spell('Terraforming', 'normal', {
  text: 'Add 1 Field Spell Card from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', isField).length > 0,
      resolve: async (ctx) => {
        await ctx.search(isField, 1, 'Add 1 Field Spell Card from your Deck to your hand.');
      },
      // better before the Field Spell is out
      ai: { score: (ctx) => (!ctx.deck('me', isField).length ? 0 : ctx.spellTraps('me', isField).length ? 30 : 56) },
    },
  ],
});

monster('Volcanic Shell', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 1,
  atk: 100,
  def: 0,
  text: 'If this card is in your Graveyard, you can pay 500 Life Points during your Main Phase to add 1 "Volcanic Shell" from your Deck to your hand. This effect can only be used once per turn.',
  aiValue: 300,
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      opt: true,
      label: 'Pay 500 LP: add a "Volcanic Shell"',
      categories: ['search'],
      canActivate: (ctx) => ctx.lp > 500 && ctx.deck('me', (c) => c.name === 'Volcanic Shell').length > 0,
      // https://edisonrul.ing/cards/v/volcanic-shell.html — if this card left the GY before resolution, nothing is added.
      activate: async (ctx) => {
        ctx.data.mid = ctx.self.moveId;
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || ctx.self.moveId !== ctx.data.mid) return;
        await ctx.search((c) => c.name === 'Volcanic Shell', 1, 'Add 1 "Volcanic Shell" from your Deck to your hand.');
      },
      // discard fodder for Quickdraw Synchron, Lightning Vortex... worth 500 LP while LP are healthy
      ai: { score: (ctx) => (ctx.lp > 2500 ? 40 : 0) },
    },
  ],
});

monster('Tuningware', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 1,
  atk: 100,
  def: 300,
  types: ['tuner'],
  synchroLevel: 2,
  text: 'When this card is used as a Synchro Material Monster, it can be treated as a Level 2 monster. When this card is sent to the Graveyard as a Synchro Material Monster, draw 1 card.',
  aiValue: 350,
  effects: [
    {
      kind: 'trigger',
      event: 'usedAsMaterial',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.reason === 'synchro' && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});
