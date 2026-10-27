// Structure Deck: Machina Mayhem (SDMM, TCG 2010-02-18): the cards of the deck that no other set file defines.
//
// Already defined elsewhere and reused: Machina Fortress, Machina Gearframe, Machina Peacekeeper, Proto-Cyber Dragon
// (tournament-extras2.ts), Machine Duplication (archetype-extras2.ts), Armored Cybern (ptdn.ts), Time Machine (csoc.ts),
// Cyber Dragon, the Gadgets, Prohibition, Swords of Revealing Light, Solidarity... (other set files).
//
// Card text is the Edison-era (SDMM printing, pre-errata) wording; effects follow the 2010 TCG rulings as far as the
// engine allows. Approximations are marked "APPROX:".
//
// Engine hooks added for this set (src/engine): CardData.attackLpCost (Machina Force), CardData.noSpecialFrom
// (The Big Saturn) and EffectDef.faceDownAttacked (Blast Sphere).
import { monster, spell, trap } from '../define';
import { cardValue, flip, named } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink } from '../../engine/game';
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

/** Pick `n` cards (exactly as many as possible) and Special Summon them for `p`. */
async function summonAsManyAsPossible(ctx: Ctx, p: PlayerId, cands: C[], pos: 'atk' | 'choose', prompt: string) {
  const g = ctx.game;
  const n = Math.min(cands.length, g.freeMZones(p));
  if (n <= 0) return [];
  const sel = cands.length > n ? await ctx.select(cands, n, n, prompt, 'specialSummon', { player: p }) : cands;
  const fromDeck = sel.some((c) => c.location === 'deck');
  const r = await g.specialSummon(sel, p, { pos, reasonCard: ctx.self });
  if (fromDeck) g.shuffleDeck(p);
  return r;
}

// ============================================================ Union: Heavy Mech Support Platform

const hmspHosts = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isMachine(c) && !hasUnionEquipped(ctx, c));

monster('Heavy Mech Support Platform', {
  attribute: 'DARK',
  race: 'Machine',
  level: 3,
  atk: 500,
  def: 500,
  types: ['union'],
  aiValue: 300,
  text: 'Once per turn, you can equip this card to a Machine-Type monster on your side of the field, or unequip it and Special Summon it in face-up Attack Position. While equipped to a monster by this card\'s effect, that monster gains 500 ATK and DEF. (1 monster can only be equipped with 1 Union Monster at a time. If the monster this card is equipped to is destroyed, destroy this card instead.)',
  effects: [
    {
      kind: 'ignition',
      range: ['mzone', 'szone'],
      opt: true,
      label: 'Equip / Unequip',
      categories: ['atkChange'],
      condition: (ctx) =>
        ctx.self.location === 'mzone'
          ? ctx.self.faceUp && ctx.freeSZones() > 0 && hmspHosts(ctx).some((c) => ctx.canTarget(c))
          : ctx.self.location === 'szone' && !!ctx.self.flags.unionEquipped && ctx.equipTarget !== undefined && ctx.canSummonSelf(),
      activate: async (ctx) => {
        ctx.data.mode = ctx.self.location === 'mzone' ? 'equip' : 'unequip';
        if (ctx.data.mode === 'equip')
          await ctx.selectTargets(hmspHosts(ctx), 1, 1, 'Target 1 Machine-Type monster you control to equip Heavy Mech Support Platform to.', 'equip', {
            aiScore: (c) => ctx.atk(c) + (c.data.aiValue ?? 0),
          });
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'equip') {
          const t = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player && isMachine(c))[0];
          if (!t || !faceUpOn(ctx.self) || hasUnionEquipped(ctx, t)) return;
          equipUnion(ctx, ctx.self, t);
        } else if (ctx.self.location === 'szone') {
          await ctx.specialSummon(ctx.self, { pos: 'atk' });
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.self.location !== 'mzone' || (ctx.phase !== 'main1' && ctx.phase !== 'main2')) return 0;
          return hmspHosts(ctx).some((c) => ctx.atk(c) >= 1500) ? 35 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      active: (ctx) => !!ctx.self.flags.unionEquipped,
      mods: [
        { q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 500 },
        { q: 'def', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 500 },
      ],
    },
    {
      kind: 'continuous',
      range: ['szone'],
      replaceDestroyOne: async (ctx, card) => {
        if (!ctx.self.flags.unionEquipped || card !== ctx.equipTarget || !ctx.self.onField) return false;
        ctx.log(`${ctx.self.name} is destroyed instead.`);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return ctx.self.location !== 'szone';
      },
    },
  ],
});

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

monster(COVINGTON, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1000,
  def: 600,
  aiValue: 300,
  text: 'By sending 1 face-up "Machina Soldier", "Machina Sniper", and "Machina Defender" you control to the Graveyard, Special Summon 1 "Machina Force" from your hand or Deck.',
  effects: [
    {
      kind: 'ignition',
      label: 'Special Summon "Machina Force"',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        TRIO.every((n) => ctx.faceUpMonsters('me', named(n)).length > 0) &&
        ctx.cards('me', ['hand', 'deck'], named(FORCE)).length > 0,
      activate: async (ctx) => {
        const cost: C[] = [];
        for (const n of TRIO) {
          const cands = ctx.faceUpMonsters('me', named(n));
          const [c] = cands.length > 1 ? await ctx.select(cands, 1, 1, `Send 1 face-up "${n}" you control to the GY.`, 'cost') : cands;
          if (!c) return false;
          cost.push(c);
        }
        await ctx.sendToGrave(cost, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'deck'], named(FORCE));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [f] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Machina Force" from your hand or Deck.', 'specialSummon', {
          aiScore: (c) => (c.location === 'deck' ? 1 : 0),
        });
        if (!f) return;
        const fromDeck = f.location === 'deck';
        await ctx.specialSummon(f, { pos: 'choose', proper: true });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 80 },
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

monster('Blast Sphere', {
  attribute: 'DARK',
  race: 'Machine',
  level: 4,
  atk: 1400,
  def: 1400,
  aiValue: 300,
  text: 'When this face-down Defense Position card is attacked by an opponent\'s monster, equip this card to the attacking monster during the Damage Step. During your opponent\'s next Standby Phase, destroy the monster equipped with this card and inflict damage to your opponent equal to its ATK.',
  effects: [
    {
      // Activated by Game.damageStep at the start of the Damage Step, before the card would be flipped face-up: it
      // never flips, and the attack ends with no damage calculation.
      kind: 'trigger',
      faceDownAttacked: true,
      mandatory: true,
      label: 'Equip to the attacking monster',
      categories: ['destroy', 'damage'],
      condition: (ctx) => {
        const b = ctx.battle;
        return !!b && b.target === ctx.self && ctx.self.location === 'mzone' && !ctx.self.faceUp && ctx.self.pos === 'def' && faceUpOn(b.attacker) && b.attacker.controller === ctx.opp;
      },
      canActivate: (ctx) => ctx.freeSZones() > 0,
      resolve: async (ctx) => {
        const a = ctx.battle?.attacker;
        if (!a || !faceUpOn(a) || a.controller !== ctx.opp || ctx.self.location !== 'mzone' || ctx.self.faceUp || ctx.freeSZones() <= 0) return;
        ctx.game.rawMove(ctx.self, 'szone', { controller: ctx.player, faceUp: true });
        ctx.equip(a);
        ctx.self.flags.blastTurn = ctx.turn;
        ctx.log(`${ctx.self.name} is equipped to ${a.name}.`);
        ctx.game.update();
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy the equipped monster and inflict damage',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) =>
        ev.phase === 'standby' &&
        ctx.game.turnPlayer === ctx.opp &&
        ctx.self.flags.blastTurn !== undefined &&
        ctx.turn > ctx.self.flags.blastTurn &&
        !ctx.self.flags.blastDone &&
        !!ctx.equipTarget,
      resolve: async (ctx) => {
        ctx.self.flags.blastDone = true;
        const host = ctx.equipTarget;
        if (!host || !faceUpOn(host)) return;
        const atk = ctx.atk(host);
        await ctx.destroy(host);
        if (host.location !== 'mzone') await ctx.damage(ctx.opp, atk);
      },
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
  // 2010 text and rulings: "sent to your Graveyard" (whoever controlled it); the destroyed monster must still be in the
  // GY when the effect resolves. https://edisonrul.ing/cards/m/machina-armored-unit.html
  text: 'Once per turn, when a Machine-Type monster is destroyed by battle and sent to your Graveyard, you can Special Summon 1 Machine-Type monster from your Deck that has the same Attribute and less ATK than the destroyed monster.',
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
        return !!d && stActive(ctx) && isMachine(d) && d.owner === ctx.player && d.location === 'grave';
      },
      canActivate: (ctx) => {
        const d = evc(ctx.event!);
        return !!d && ctx.canSpecialSummon() && ctx.deck('me', (c) => isMachine(c) && c.data.attribute === d.data.attribute && (c.data.atk ?? 0) < (d.data.atk ?? 0) && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        ctx.data.dMoveId = evc(ctx.event!)?.moveId;
      },
      resolve: async (ctx) => {
        const d = evc(ctx.event!);
        if (!d || d.location !== 'grave' || d.moveId !== ctx.data.dMoveId || !ctx.canSpecialSummon()) return;
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

spell('Inferno Reckless Summon', 'quickplay', {
  text: 'When a monster with 1500 or less ATK is Special Summoned to your side of the field while your opponent controls a face-up monster: Special Summon as many monsters as possible with the same name as that Special Summoned monster from your hand, Deck, and Graveyard in face-up Attack Position. Your opponent selects 1 face-up monster they control, and Special Summons as many monsters with that name as possible from their hand, Deck, and Graveyard.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      label: 'Special Summon copies',
      categories: ['specialSummon'],
      // Edison ruling: only when exactly 1 monster was Special Summoned (to your field) by that Summon.
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        // 2010 ruling: not when a monster Token is Special Summoned, and the opponent cannot choose a Token.
        // https://edisonrul.ing/cards/i/inferno-reckless-summon.html
        if (!c || c.isToken || c.location !== 'mzone' || !c.faceUp || c.controller !== ctx.player || ctx.atk(c) > 1500) return false;
        const same = ctx.game.recentEvents.filter((e) => e.type === 'specialSummoned' && e.batch === ev.batch);
        return same.length === 1;
      },
      condition: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      activate: async (ctx) => {
        ctx.data.name = evc(ctx.event!)?.name;
      },
      resolve: async (ctx) => {
        const name = ctx.data.name as string | undefined;
        if (!name) return;
        const g = ctx.game;
        // Your side: every copy (face-up Attack Position).
        if (ctx.canSpecialSummon()) {
          const mine = ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.isMonster && c.name === name && ctx.canSummonCard(c));
          await summonAsManyAsPossible(ctx, ctx.player, mine, 'atk', `Special Summon ${g.freeMZones(ctx.player)} "${name}".`);
        }
        // Their side: they pick 1 face-up monster they control and Summon every copy of it.
        const opp = ctx.opp;
        const faceUps = ctx.faceUpMonsters('opp', (c) => !c.isToken);
        if (!faceUps.length || g.queryPlayer(opp, 'cannotSpecialSummon') || g.freeMZones(opp) <= 0) return;
        const theirCopies = (n: string) =>
          ctx.cards('opp', ['hand', 'deck', 'grave'], (c) => {
            if (!c.isMonster || c.name !== n || c.isExtra) return false;
            if (g.queryCard(c, 'cannotBeSummoned') || c.data.noSpecialFrom?.includes(c.location)) return false;
            if (c.data.nomi && (c.location !== 'grave' || !c.properlySummoned)) return false;
            return true;
          });
        const [pick] = await ctx.select(faceUps, 1, 1, 'Select 1 face-up monster you control: Special Summon as many monsters with its name as possible.', 'generic', {
          player: opp,
          aiScore: (c) => theirCopies(c.name).length * 1000 + cardValue(g, c),
        });
        if (!pick) return;
        await summonAsManyAsPossible(ctx, opp, theirCopies(pick.name), 'choose', `Special Summon "${pick.name}".`);
      },
      ai: {
        score: (ctx) => {
          const c = evc(ctx.event!);
          if (!c) return 0;
          const n = ctx.cards('me', ['hand', 'deck', 'grave'], (x) => x.name === c.name && x !== c && ctx.canSummonCard(x)).length;
          return n >= 1 ? 40 + n * 10 : 0;
        },
      },
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

/** Metalmorph's attack boost: "If it attacks, it gains ATK equal to half the ATK of the attack target, during damage calculation only." */
const metalmorphAttackBonus = (ctx: Ctx, c: C) => {
  const b = ctx.battle;
  if (!b || !b.inDamageStep || b.attacker !== c || !b.target) return 0;
  return Math.floor(ctx.atk(b.target) / 2);
};

trap('Metalmorph', 'normal', {
  text: 'Equip only to a face-up monster. It gains 300 ATK/DEF. If it attacks, it gains ATK equal to half the ATK of the attack target, during damage calculation only.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      label: 'Equip: +300 ATK/DEF',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip Metalmorph to.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? 5000 : -5000) + (ctx.battle && (ctx.battle.attacker === c || ctx.battle.target === c) ? 2000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (!t || !ctx.self.onField) return;
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
        ctx.equip(t);
        ctx.log(`${ctx.self.name} is equipped to ${t.name}.`);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || !theirs || mine.controller !== ctx.player || !faceUpOn(mine)) return 0;
          if (b.inDamageStep && b.calc) return 0;
          const s = theirs.pos === 'atk' || !theirs.faceUp ? ctx.atk(theirs) : ctx.def(theirs);
          const bonus = 300 + (mine === b.attacker ? Math.floor(ctx.atk(theirs) / 2) : 0);
          return ctx.atk(mine) <= s && ctx.atk(mine) + bonus > s ? 65 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: (ctx, c: C) => 300 + metalmorphAttackBonus(ctx, c) },
        { q: 'def', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 300 },
      ],
    },
  ],
});

/** The monster Rare Metalmorph selected, while it is still the same card on the field. */
const rareHost = (ctx: Ctx): C | undefined => {
  const uid = ctx.self.flags.rareHost as number | undefined;
  if (uid === undefined) return undefined;
  const c = ctx.game.card(uid);
  return c && c.location === 'mzone' && c.moveId === ctx.self.flags.rareHostMove ? c : undefined;
};

trap('Rare Metalmorph', 'continuous', {
  text: 'Activate only by selecting 1 Machine-Type monster on the field. While this card remains face-up on the field, the selected monster gains 500 ATK and negates the first Spell Card effect that targets it. When the selected monster is removed from the field, destroy this card.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      label: 'Select a Machine: +500 ATK',
      categories: ['atkChange', 'protect'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isMachine(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', isMachine), 1, 1, 'Target 1 Machine-Type monster on the field.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? 5000 : -5000) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && isMachine(c))[0];
        if (!t || !ctx.self.onField) return;
        ctx.self.flags.rareHost = t.uid;
        ctx.self.flags.rareHostMove = t.moveId;
        // "When the selected monster is removed from the field, destroy this card."
        ctx.game.link(ctx.self, t, false);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || !theirs || mine.controller !== ctx.player || !faceUpOn(mine) || !isMachine(mine)) return 0;
          if (b.inDamageStep && b.calc) return 0;
          const s = theirs.pos === 'atk' || !theirs.faceUp ? ctx.atk(theirs) : ctx.def(theirs);
          return ctx.atk(mine) <= s && ctx.atk(mine) + 500 > s ? 60 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === rareHost(ctx), value: 500 }],
    },
    {
      // APPROX (as the "Imprisoning Mirror" cards): the negation is applied as the Spell effect is activated, without a
      // chain link of its own.
      kind: 'trigger',
      event: 'chainActivated',
      range: ['szone'],
      label: 'Negate the first Spell effect that targets the monster',
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || link.negated || !link.card.isSpell || !stActive(ctx) || ctx.self.flags.rareUsed) return false;
        const h = rareHost(ctx);
        if (h && faceUpOn(h) && link.ctx.targets.includes(h)) {
          ctx.self.flags.rareUsed = true;
          ctx.game.negateLink(link, false, ctx.self);
        }
        return false;
      },
    },
  ],
});

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
