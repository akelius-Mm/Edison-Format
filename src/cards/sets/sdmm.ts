// Structure Deck: Machina Mayhem (SDMM, TCG 2010-02-18): the cards of the deck that no other set file defines.
//
// Already defined elsewhere and reused: Machina Fortress, Machina Gearframe, Machina Peacekeeper, Proto-Cyber Dragon
// (tournament-extras2.ts), Machine Duplication (archetype-extras2.ts), Armored Cybern (ptdn.ts), Time Machine (csoc.ts),
// Cyber Dragon, the Gadgets, Prohibition, Swords of Revealing Light, Solidarity... (other set files).
//
// Card text is the Edison-era (SDMM printing, pre-errata) wording; effects follow the 2010 TCG rulings as far as the
// engine allows. Approximations are marked "APPROX:".
//
// Engine hooks added for this set (src/engine): CardData.attackLpCost (Machina Force) and CardData.noSpecialFrom
// (The Big Saturn).
import { monster, spell, trap } from '../define';
import { cardValue, flip, named } from '../helpers';
import type { CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { GameEvent, PlayerId } from '../../engine/types';

type C = CardInstance;

// ============================================================ names & helpers

const SOLDIER = 'Machina Soldier';
const SNIPER = 'Machina Sniper';
const DEFENDER = 'Machina Defender';
const FORCE = 'Machina Force';
const COVINGTON = 'Commander Covington';
const TRIO = [SOLDIER, SNIPER, DEFENDER];

const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
const isMachine = (c: C) => c.isMonster && c.data.race === 'Machine';
const isMachina = (c: C) => c.isMonster && (c.inSet('machina') || c.name.includes('Machina'));
const isUnion = (c: C) => c.isMonster && c.hasType('union');
const evc = (ev: GameEvent) => ev.card as C | undefined;
/** This Continuous Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
const hasUnionEquipped = (ctx: Ctx, c: C) => ctx.game.equipsOf(c).some((e) => isUnion(e));

/**
 * The monster a Union monster can be equipped to "for that Union monster's effect" (Roll Out!). Every Union monster in
 * the pool equips to a Machine, except these.
 */
const UNION_HOSTS: Record<string, (c: C) => boolean> = {
  'Armored Cybern': (c) => c.name === 'Cyber Dragon' || (c.hasType('fusion') && /"Cyber Dragon"/.test(c.data.text.split('\n')[0])),
  'Spirit of the Six Samurai': (c) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai')),
};
export const unionHostOk = (union: C, host: C) => host !== union && host.isMonster && (UNION_HOSTS[union.name] ?? isMachine)(host);

/** Equip a Union monster (from the field or the GY) to `host` by a Union effect. */
function equipUnion(ctx: Ctx, union: C, host: C): boolean {
  if (ctx.game.freeSZones(ctx.player) <= 0) return false;
  ctx.game.rawMove(union, 'szone', { controller: ctx.player, faceUp: true });
  ctx.game.equip(union, host);
  union.flags.unionEquipped = true;
  ctx.log(`${union.name} is equipped to ${host.name}.`);
  ctx.game.update();
  return true;
}

/** Both players take `amount` damage at the same time (The Big Saturn): both at 0 is a draw. */
async function damageBoth(ctx: Ctx, amount: number) {
  const g = ctx.game;
  for (const p of [ctx.player, ctx.opp] as PlayerId[]) {
    if (amount <= 0 || g.queryPlayer(p, 'noEffectDamage')) continue;
    g.players[p].lp = Math.max(0, g.players[p].lp - amount);
    g.log(`${g.players[p].name} takes ${amount} damage. (LP ${g.players[p].lp})`, 'damage', p);
    await g.anim({ type: 'damage', player: p, amount, kind: 'effect' });
    g.beginBatch();
    g.emit({ type: 'damage', player: p, amount, reasonCard: ctx.self, reason: 'effect', reasonPlayer: ctx.player });
  }
  g.checkLp();
}

// ============================================================ Monsters

monster('Scrap Recycler', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 900,
  def: 1200,
  aiValue: 300,
  text: 'When this card is Normal or Special Summoned, you can send 1 Machine-Type monster from your Deck to the Graveyard. Once per turn, you can return 2 Level 4 EARTH Machine-Type monsters from your Graveyard to the Deck, shuffle the Deck, and draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      when: true,
      label: 'Send 1 Machine from the Deck to the GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.deck('me', isMachine).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', isMachine);
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Send 1 Machine-Type monster from your Deck to the GY.', 'toGrave', {
          // Fuel: Machina Fortress, a Level 4 EARTH Machine for the draw, or a Gadget.
          aiScore: (x) => (x.name === 'Machina Fortress' ? 300 : 0) + (x.data.level === 4 && x.data.attribute === 'EARTH' ? 200 : 0) + (x.data.atk ?? 0) / 100,
        });
        if (c) await ctx.sendToGrave(c);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Return 2 Level 4 EARTH Machines; draw 1',
      categories: ['draw', 'toDeck'],
      canActivate: (ctx) => ctx.grave('me', (c) => isMachine(c) && c.data.level === 4 && c.data.attribute === 'EARTH').length >= 2,
      activate: async (ctx) => {
        const cands = ctx.grave('me', (c) => isMachine(c) && c.data.level === 4 && c.data.attribute === 'EARTH');
        const sel = await ctx.select(cands, 2, 2, 'Return 2 Level 4 EARTH Machine-Type monsters from your GY to the Deck.', 'cost');
        if (sel.length < 2) return false;
        await ctx.toDeck(sel, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
      ai: { score: () => 45 },
    },
  ],
});

monster(SOLDIER, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1600,
  def: 1500,
  sets: ['machina'],
  aiValue: 200,
  text: 'When this card is Normal Summoned while you control no other monsters, you can Special Summon 1 "Machina" monster from your hand, except "Machina Soldier".',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Special Summon 1 "Machina" monster from your hand',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.monsters('me', (c) => c !== ctx.self).length === 0,
      canActivate: (ctx) => ctx.hand('me', (c) => isMachina(c) && c.name !== SOLDIER && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isMachina(c) && c.name !== SOLDIER && ctx.canSummonCard(c));
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Machina" monster from your hand.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
    },
  ],
});

monster(SNIPER, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1800,
  def: 800,
  sets: ['machina'],
  aiValue: 300,
  text: 'Your opponent cannot select another "Machina" monster as an attack target, except "Machina Sniper".',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c: C) => c.controller === ctx.player && faceUpOn(c) && isMachina(c) && c.name !== SNIPER,
        },
      ],
    },
  ],
});

monster(DEFENDER, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 1800,
  types: ['flip'],
  sets: ['machina'],
  aiValue: 300,
  text: 'FLIP: Add 1 "Commander Covington" from your Deck to your hand.',
  effects: [
    flip({
      label: 'Add "Commander Covington"',
      categories: ['search'],
      resolve: async (ctx) => {
        await ctx.search(named(COVINGTON), 1, 'Add 1 "Commander Covington" from your Deck to your hand.');
      },
    }),
  ],
});

monster(FORCE, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 10,
  atk: 4600,
  def: 4100,
  sets: ['machina'],
  nomi: true,
  cannotNormalSummon: true,
  attackLpCost: 1000,
  aiValue: 900,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by the effect of "Commander Covington". Pay 1000 Life Points to declare an attack with this card. You can send this face-up card to the Graveyard to Special Summon 1 "Machina Soldier", 1 "Machina Sniper", and 1 "Machina Defender" from your Graveyard.',
  effects: [
    {
      // APPROX (Edison wording): no targets; the three monsters are chosen as the effect resolves.
      kind: 'ignition',
      label: 'Send to the GY: Special Summon the Machina trio',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        ctx.freeMZones() + 1 >= 3 &&
        TRIO.every((n) => ctx.grave('me', named(n)).length > 0),
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const picks: C[] = [];
        for (const n of TRIO) {
          const [c] = ctx.grave('me', named(n));
          if (c) picks.push(c);
        }
        if (picks.length) await ctx.specialSummon(picks, { pos: 'choose' });
      },
      ai: { score: (ctx) => (ctx.lp <= 1000 || (ctx.phase === 'main2' && ctx.monsters('opp').some((c) => faceUpOn(c) && ctx.atk(c) > 4600)) ? 40 : 0) },
    },
  ],
});

monster('Cipher Soldier', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 1350,
  def: 1800,
  aiValue: 100,
  text: 'When this card battles with a Warrior-Type monster, this card\'s ATK and DEF increase by 2000 during damage calculation only.',
  effects: [
    {
      kind: 'continuous',
      mods: (['atk', 'def'] as const).map((q) => ({
        q,
        value: (ctx: Ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep || !b.target) return 0;
          const other = b.attacker === ctx.self ? b.target : b.target === ctx.self ? b.attacker : undefined;
          return other && faceUpOn(other) && other.data.race === 'Warrior' ? 2000 : 0;
        },
      })),
    },
  ],
});

monster('The Big Saturn', {
  attribute: 'DARK',
  race: 'Machine',
  level: 8,
  atk: 2800,
  def: 2200,
  noSpecialFrom: ['hand', 'deck'],
  aiValue: 400,
  text: 'This card cannot be Special Summoned from your hand or Deck. Once per turn, you can discard 1 card and pay 1000 Life Points to increase this card\'s ATK by 1000 until the End Phase. When this card in your possession is destroyed by your opponent\'s card effect and sent to your Graveyard, both players take damage equal to this card\'s ATK in the Graveyard.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard 1, pay 1000 LP: +1000 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.lp > 1000,
      activate: async (ctx) => {
        const [d] = await ctx.select(ctx.hand('me'), 1, 1, 'Discard 1 card.', 'discard');
        if (!d) return false;
        await ctx.discard(d, 'cost');
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'atk', 1000, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.lp <= 3000) return 0;
          const atk = ctx.atk(ctx.self);
          return ctx.faceUpMonsters('opp', (c) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)) >= atk && (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)) < atk + 1000).length ? 40 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['grave'],
      mandatory: true,
      label: 'Both players take damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self &&
        ev.from === 'mzone' &&
        ev.fromController === ctx.self.owner &&
        (ev.reasons ?? []).includes('destroy') &&
        ev.reason === 'effect' &&
        ev.reasonPlayer !== undefined &&
        ev.reasonPlayer !== ctx.self.owner,
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        await damageBoth(ctx, ctx.self.data.atk ?? 0);
      },
    },
  ],
});

// ============================================================ Spells

spell('Machina Armored Unit', 'continuous', {
  text: 'Once per turn, when a Machine-Type monster you control is destroyed by battle and sent to the Graveyard, you can Special Summon 1 Machine-Type monster from your Deck with the same Attribute and less ATK than the destroyed monster.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone', 'deck'], isMachine).length >= 4 ? 30 : 5) } },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      opt: true,
      label: 'Special Summon a Machine from your Deck',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const d = evc(ev);
        return !!d && stActive(ctx) && isMachine(d) && ev.fromController === ctx.player && d.owner === ctx.player && d.location === 'grave';
      },
      canActivate: (ctx) => {
        const d = evc(ctx.event!);
        return !!d && ctx.canSpecialSummon() && ctx.deck('me', (c) => isMachine(c) && c.data.attribute === d.data.attribute && (c.data.atk ?? 0) < (d.data.atk ?? 0) && ctx.canSummonCard(c)).length > 0;
      },
      resolve: async (ctx) => {
        const d = evc(ctx.event!);
        if (!d || !ctx.canSpecialSummon()) return;
        const cands = ctx.deck('me', (c) => isMachine(c) && c.data.attribute === d.data.attribute && (c.data.atk ?? 0) < (d.data.atk ?? 0) && ctx.canSummonCard(c));
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, `Special Summon 1 ${d.data.attribute} Machine-Type monster with less than ${d.data.atk ?? 0} ATK from your Deck.`, 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

spell('Frontline Base', 'continuous', {
  text: 'Once per turn, during your Main Phase, you can Special Summon 1 Level 4 or lower Union Monster from your hand.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'deck'], isUnion).length >= 2 ? 30 : 4) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon 1 Union monster from your hand',
      categories: ['specialSummon'],
      condition: (ctx) => stActive(ctx),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isUnion(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isUnion(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower Union monster from your hand.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Card Trader', 'continuous', {
  text: 'Once per turn, during your Standby Phase, you can return 1 card from your hand to the Deck and shuffle it. Then, draw 1 card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: () => 8 } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      opt: true,
      label: 'Shuffle 1 card from your hand into the Deck; draw 1',
      categories: ['draw', 'toDeck'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.game.turnPlayer === ctx.player && stActive(ctx),
      canActivate: (ctx) => ctx.hand('me').length > 0,
      resolve: async (ctx) => {
        const hand = ctx.hand('me');
        if (!hand.length) return;
        const [c] = await ctx.select(hand, 1, 1, 'Return 1 card from your hand to the Deck.', 'toDeck', { aiScore: (x) => -cardValue(ctx.game, x) });
        if (!c) return;
        await ctx.toDeck(c, 'shuffle');
        await ctx.draw(1);
      },
      ai: {
        // Trade away a card the AI cannot use (a Level 7+ monster without Tributes, or a dead duplicate Field Spell).
        score: (ctx) =>
          ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) >= 7 && ctx.monsters('me').length < 2).length > 0 ? 30 : 0,
      },
    },
  ],
});

// ============================================================ Traps

trap('Roll Out!', 'normal', {
  text: 'Equip 1 Union Monster from your Graveyard to an appropriate monster on your side of the field.',
  effects: [
    {
      kind: 'activate',
      label: 'Equip a Union monster from your GY',
      categories: ['atkChange'],
      canActivate: (ctx) =>
        ctx.freeSZones() > 0 &&
        ctx.grave('me', (u) => isUnion(u) && ctx.canTarget(u) && ctx.faceUpMonsters('me', (h) => unionHostOk(u, h) && !hasUnionEquipped(ctx, h)).length > 0).length > 0,
      activate: async (ctx) => {
        const cands = ctx.grave('me', (u) => isUnion(u) && ctx.faceUpMonsters('me', (h) => unionHostOk(u, h) && !hasUnionEquipped(ctx, h)).length > 0);
        await ctx.selectTargets(cands, 1, 1, 'Target 1 Union monster in your GY.', 'target', { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        const u = ctx.validTargets((c) => c.location === 'grave' && isUnion(c))[0];
        if (!u || ctx.freeSZones() <= 0) return;
        const hosts = ctx.faceUpMonsters('me', (h) => unionHostOk(u, h) && !hasUnionEquipped(ctx, h));
        if (!hosts.length) return;
        const [h] = await ctx.select(hosts, 1, 1, `Equip ${u.name} to a monster you control.`, 'equip', { aiScore: (c) => ctx.atk(c) + (c.data.aiValue ?? 0) });
        if (h) equipUnion(ctx, u, h);
      },
      ai: {
        score: (ctx) => (ctx.phase === 'end' && !ctx.isMyTurn ? 30 : ctx.battle && ctx.battle.target && ctx.battle.target.controller === ctx.player ? 25 : 0),
      },
    },
  ],
});

export const SDMM_LOADED = true;
