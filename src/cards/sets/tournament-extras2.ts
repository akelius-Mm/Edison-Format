// Card definitions needed by the second batch of real Edison-era decklists in src/decks/tournament2.ts
// (SJC Edison 2010 Top 16: main, Extra and Side Decks) that were not yet in the pool.
// Every card here had an English TCG release before SJC Edison (April 24, 2010).
// Stats and card text follow the official English text (YGOJSON dataset).
//
// Each definition is skipped if another set file already registered the card, so this file never
// causes a duplicate definition when other card batches are merged.
//
// Approximations are marked "APPROX:" next to the card. They exist where the engine has no hook for
// the exact rule (zone locks, destruction substitutes, GY-movement negation...).
import { findCard, monster, spell, trap } from '../define';
import { bestTarget, cardValue, flip, race, selfDestroysByBattle } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink } from '../../engine/game';
import type { GameEvent } from '../../engine/types';

type C = CardInstance;

// ============================================================ shared helpers

/** Define a card only if no other set file has defined it yet. */
function once(name: string, define: () => void) {
  if (!findCard(name)) define();
}

const evc = (ev: GameEvent) => ev.card as C | undefined;
const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
/** This Continuous/Field Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** The link on top of the chain belongs to the opponent and still resolves. */
function oppTop(ctx: Ctx): ChainLink | undefined {
  const l = ctx.chainTop();
  return l && l.player === ctx.opp && !l.negated ? l : undefined;
}
const isMachine = (c: C) => c.isMonster && c.data.race === 'Machine';
const isGB = (c: C) => c.isMonster && c.inSet('gladiator');
/** The summon was performed by the effect of a "Gladiator Beast" monster. */
const byGB = (ev: GameEvent) => {
  const r = ev.reasonCard as C | undefined;
  return !!r && r.isMonster && r.inSet('gladiator');
};

/** Monsters summoned together with the event monster (same summon), as Bottomless Trap Hole does. */
function summonedBatch(ctx: Ctx, type: 'summoned' | 'specialSummoned', filter: (c: C, ev: GameEvent) => boolean): C[] {
  const evs = ctx.game.recentEvents.filter((e) => e.type === type);
  const out: C[] = [];
  for (const e of evs) {
    const c = e.card as C;
    if (c && !out.includes(c) && filter(c, e)) out.push(c);
  }
  return out;
}

/**
 * "Imprisoning Mirror" continuous trap: negate the activated effects of monsters of one Attribute on the field or in the GY.
 * APPROX: applied the moment the effect is activated (no chain link of its own), like Light-Imprisoning Mirror.
 */
function imprisoningMirror(attribute: 'DARK' | 'LIGHT'): EffectDef[] {
  return [
    {
      kind: 'activate',
      categories: ['lockdown', 'negate'],
      ai: {
        score: (ctx) => {
          if (ctx.spellTraps('me', (c) => c !== ctx.self && c.name === ctx.self.name && c.faceUp).length) return 0;
          const l = oppTop(ctx);
          if (l && !l.isCardActivation && l.card.data.attribute === attribute) return 70;
          const theirs = ctx.cards('opp', ['mzone', 'grave'], (c) => c.isMonster && c.data.attribute === attribute).length;
          const mine = ctx.cards('me', ['mzone', 'grave'], (c) => c.isMonster && c.data.attribute === attribute).length;
          return theirs >= 2 && theirs > mine && !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Negate',
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || link.negated || !stActive(ctx)) return false;
        const c = link.card;
        if (c.isMonster && !link.isCardActivation && c.data.attribute === attribute && (link.fromLocation === 'mzone' || c.location === 'mzone' || c.location === 'grave')) {
          ctx.game.negateLink(link, false, ctx.self);
        }
        return false;
      },
    },
  ];
}

/**
 * Union monster equip / unequip (old Union rules, as printed on the Machina cards).
 * APPROX: the destruction substitute only covers battle. While equipped, the host cannot be destroyed by battle; at the
 * end of a Damage Step in which the host would have been destroyed, the Union monster is destroyed instead.
 * Destruction of the host by card effects is not replaced.
 */
function unionEffects(): EffectDef[] {
  const key = (ctx: Ctx) => `union:${ctx.self.uid}`;
  const host = (ctx: Ctx) => (ctx.self.location === 'szone' ? ctx.equipTarget : undefined);
  return [
    {
      kind: 'ignition',
      label: 'Equip to a Machine monster',
      categories: ['protect'],
      condition: (ctx) => !ctx.usedThisTurn(key(ctx)),
      canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.faceUpMonsters('me', (c) => c !== ctx.self && isMachine(c)).length > 0,
      activate: async (ctx) => {
        ctx.markUsed(key(ctx));
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c !== ctx.self && isMachine(c)), 1, 1, 'Target 1 Machine monster you control to equip this card to.', 'equip', {
          aiScore: (c) => ctx.atk(c) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player)[0];
        if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp || ctx.freeSZones() <= 0) return;
        await ctx.game.moveCards([ctx.self], 'szone', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self, minor: true });
        if ((ctx.self.location as string) !== 'szone') return;
        ctx.equip(t);
        ctx.log(`${ctx.self.name} is equipped to ${t.name}.`);
      },
      ai: {
        score: (ctx) => {
          // Protect a big Machine once the battle phase is over, so it survives the opponent's turn.
          if (ctx.phase !== 'main2') return 0;
          const best = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isMachine(c)).sort((a, b) => ctx.atk(b) - ctx.atk(a))[0];
          return best && ctx.atk(best) >= 2000 && ctx.atk(ctx.self) < 1500 ? 15 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      range: ['szone'],
      label: 'Unequip and Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => !ctx.usedThisTurn(key(ctx)) && !!host(ctx),
      canActivate: (ctx) => ctx.canSpecialSummon(),
      activate: async (ctx) => {
        ctx.markUsed(key(ctx));
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'szone' || !ctx.canSpecialSummon()) return;
        await ctx.specialSummon(ctx.self, { pos: 'atk' });
      },
      ai: {
        score: (ctx) => (ctx.phase === 'main1' && ctx.turn > 1 && ctx.monsters('opp').length === 0 ? 30 : 0),
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      mods: [{ q: 'indestructibleBattle', to: 'cards', filter: (ctx, c) => !!ctx.equipTarget && c === ctx.equipTarget }],
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['szone'],
      mandatory: true,
      label: 'Destroyed instead of the equipped monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const h = host(ctx);
        if (!h || h.location !== 'mzone') return false;
        const a = evc(ev);
        const t = ev.other as C | undefined;
        if (!a || !t || (h !== a && h !== t)) return false;
        const g = ctx.game;
        if (h === a) {
          if (t.pos === 'atk') return g.getAtk(a) <= g.getAtk(t) && g.getAtk(t) > 0;
          return false;
        }
        // host was attacked
        return a.location === 'mzone' && (h.pos === 'atk' ? g.getAtk(a) >= g.getAtk(h) && g.getAtk(a) > 0 : g.getAtk(a) > g.getDef(h));
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      },
    },
  ];
}

// ============================================================ MAIN DECK MONSTERS

once('Electric Virus', () =>
  monster('Electric Virus', {
    attribute: 'LIGHT',
    race: 'Thunder',
    level: 3,
    atk: 1000,
    def: 1000,
    aiValue: 300,
    text: 'You can discard this card to the GY, then target 1 Machine or Dragon monster your opponent controls; take control of that target until the End Phase.',
    effects: [
      {
        kind: 'ignition',
        range: ['hand'],
        label: 'Discard: take control of a Machine/Dragon',
        categories: ['control'],
        canActivate: (ctx) =>
          ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => (c.data.race === 'Machine' || c.data.race === 'Dragon') && ctx.canTarget(c)).length > 0,
        activate: async (ctx) => {
          await ctx.discard(ctx.self, 'cost');
          await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => c.data.race === 'Machine' || c.data.race === 'Dragon'), 1, 1, 'Target 1 Machine or Dragon monster to take control of.', 'control');
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && (c.data.race === 'Machine' || c.data.race === 'Dragon'));
          if (t.length) await ctx.takeControl(t[0], true);
        },
        ai: {
          score: (ctx) => {
            const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => c.data.race === 'Machine' || c.data.race === 'Dragon'));
            return best && cardValue(ctx.game, best) >= 1800 ? 45 + ctx.atk(best) / 100 : 0;
          },
        },
      },
    ],
  }),
);

once("Gravekeeper's Commandant", () =>
  monster("Gravekeeper's Commandant", {
    attribute: 'EARTH',
    race: 'Spellcaster',
    level: 4,
    atk: 1600,
    def: 1500,
    sets: ['gravekeeper'],
    aiValue: 400,
    text: 'You can discard this card to the GY; add 1 "Necrovalley" from your Deck to your hand.',
    effects: [
      {
        kind: 'ignition',
        range: ['hand'],
        label: 'Discard: add "Necrovalley"',
        categories: ['search'],
        canActivate: (ctx) => ctx.deck('me', (c) => c.name === 'Necrovalley').length > 0,
        activate: async (ctx) => {
          await ctx.discard(ctx.self, 'cost');
        },
        resolve: async (ctx) => {
          await ctx.search((c) => c.name === 'Necrovalley', 1, 'Add 1 "Necrovalley" from your Deck to your hand.');
        },
        ai: {
          score: (ctx) => {
            const haveValley = ctx.cards('me', ['hand', 'fzone'], (c) => c.name === 'Necrovalley').length > 0;
            return haveValley ? 0 : 50;
          },
        },
      },
    ],
  }),
);

once("Gravekeeper's Guard", () =>
  monster("Gravekeeper's Guard", {
    attribute: 'DARK',
    race: 'Spellcaster',
    level: 4,
    atk: 1000,
    def: 1900,
    types: ['flip'],
    sets: ['gravekeeper'],
    aiValue: 500,
    text: 'FLIP: Target 1 monster your opponent controls; return that target to the hand.',
    effects: [
      flip({
        label: 'FLIP: return 1 monster to the hand',
        categories: ['toHand'],
        activate: async (ctx) => {
          const cands = ctx.monsters('opp');
          if (cands.length) await ctx.selectTargets(cands, 1, 1, 'Target 1 monster your opponent controls to return to the hand.', 'bounce');
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.location === 'mzone');
          if (t.length) await ctx.toHand(t);
        },
      }),
    ],
  }),
);

once('Gladiator Beast Samnite', () =>
  monster('Gladiator Beast Samnite', {
    attribute: 'EARTH',
    race: 'Beast',
    level: 3,
    atk: 1600,
    def: 1200,
    sets: ['gladiator'],
    aiValue: 400,
    text: 'When this card, that was Special Summoned by the effect of a "Gladiator Beast" monster, destroys an opponent\'s monster by battle and sends it to the GY: You can add 1 "Gladiator Beast" card from your Deck to your hand. At the end of the Battle Phase, if this card battled: You can shuffle it into the Deck; Special Summon 1 "Gladiator Beast" monster from your Deck, except "Gladiator Beast Samnite".',
    effects: [
      {
        // Bookkeeping: remember a Special Summon by a Gladiator Beast effect (never builds a chain link).
        kind: 'trigger',
        event: 'specialSummoned',
        eventFilter: (ctx, ev) => {
          if (ev.card === ctx.self && byGB(ev) && ctx.self.location === 'mzone') ctx.self.flags.gbSummoned = true;
          return false;
        },
      },
      {
        kind: 'trigger',
        event: 'battleDestroyed',
        when: true,
        label: 'Add 1 "Gladiator Beast" card',
        categories: ['search'],
        eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && !!ctx.self.flags.gbSummoned && evc(ev)?.location === 'grave',
        canActivate: (ctx) => ctx.deck('me', (c) => c.inSet('gladiator')).length > 0,
        resolve: async (ctx) => {
          await ctx.search((c) => c.inSet('gladiator'), 1, 'Add 1 "Gladiator Beast" card from your Deck to your hand.');
        },
      },
      {
        kind: 'trigger',
        event: 'battleEnd',
        label: 'Tag out',
        categories: ['specialSummon', 'toDeck'],
        eventFilter: (ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.attackedThisTurnOrWasAttacked,
        canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && ctx.deck('me', (c) => isGB(c) && c.name !== 'Gladiator Beast Samnite').length > 0,
        activate: async (ctx) => {
          await ctx.toDeck(ctx.self, 'shuffle', 'cost');
        },
        resolve: async (ctx) => {
          const cands = ctx.deck('me', (c) => isGB(c) && c.name !== 'Gladiator Beast Samnite' && ctx.canSummonCard(c));
          if (!cands.length || !ctx.canSpecialSummon()) {
            ctx.game.shuffleDeck(ctx.player);
            return;
          }
          const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Gladiator Beast" monster from your Deck.', 'specialSummon', {
            aiScore: (c) => {
              if (c.name === 'Gladiator Beast Bestiari') return ctx.spellTraps('opp').length ? 900 : 350;
              if (c.name === 'Gladiator Beast Murmillo') return ctx.faceUpMonsters('opp').length ? 850 : 120;
              return (c.data.atk ?? 0) / 4 + (c.data.aiValue ?? 0);
            },
          });
          if (sel.length) await ctx.specialSummon(sel[0]);
          ctx.game.shuffleDeck(ctx.player);
        },
      },
    ],
  }),
);

once('Phantom Dragon', () =>
  monster('Phantom Dragon', {
    attribute: 'LIGHT',
    race: 'Dragon',
    level: 8,
    atk: 2300,
    def: 2200,
    aiValue: 300,
    text: 'When your opponent Special Summons a monster (except during the Damage Step): You can Special Summon this card from your hand. 2 of your Monster Card Zones cannot be used.',
    effects: [
      {
        kind: 'trigger',
        event: 'specialSummoned',
        range: ['hand'],
        when: true,
        label: 'Special Summon from hand',
        categories: ['specialSummon'],
        eventFilter: (ctx, ev) => {
          const c = evc(ev);
          return !!c && c.controller === ctx.opp && c.location === 'mzone' && !ctx.battle?.inDamageStep;
        },
        condition: (ctx) => ctx.canSpecialSummon(),
        resolve: async (ctx) => {
          if (ctx.self.location === 'hand' && ctx.canSpecialSummon()) await ctx.specialSummon(ctx.self);
        },
      },
      {
        // "2 of your Monster Card Zones cannot be used" while it is face-up on the field.
        kind: 'continuous',
        mods: [{ q: 'lockedMZones', to: 'players', filter: (ctx, p) => p === ctx.player, value: 2 }],
      },
    ],
  }),
);

once('Dimensional Alchemist', () =>
  monster('Dimensional Alchemist', {
    attribute: 'LIGHT',
    race: 'Fairy',
    level: 4,
    atk: 1300,
    def: 200,
    aiValue: 300,
    text: 'Once per turn: You can activate this effect; banish the top card of your Deck, and if you do, until the end of this turn, this card gains 500 ATK. When this card you control is destroyed and sent to your GY: You can target 1 of your banished monsters; add it to your hand.',
    effects: [
      {
        kind: 'ignition',
        opt: true,
        label: 'Banish top card: +500 ATK',
        categories: ['banish', 'atkChange'],
        canActivate: (ctx) => ctx.deck('me').length > 0,
        resolve: async (ctx) => {
          const deck = ctx.deck('me');
          const top = deck[deck.length - 1];
          if (!top) return;
          const r = await ctx.banish(top);
          if (r.length && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 500, 'turn');
        },
        ai: {
          score: (ctx) => {
            if (ctx.phase !== 'main1' || ctx.turn <= 1 || ctx.deck('me').length < 15 || ctx.self.pos !== 'atk') return 0;
            const a = ctx.atk(ctx.self);
            const opp = ctx.faceUpMonsters('opp').map((c) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c)));
            return opp.some((v) => v >= a && v < a + 500) || !ctx.monsters('opp').length ? 30 : 0;
          },
        },
      },
      {
        kind: 'trigger',
        event: 'sentToGrave',
        label: 'Add 1 banished monster',
        categories: ['toHand'],
        eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && (ev.reasons ?? []).includes('destroy') && ctx.self.owner === ctx.player,
        canActivate: (ctx) => ctx.banished('me', (c) => c.isMonster).length > 0,
        activate: async (ctx) => {
          await ctx.selectTargets(ctx.banished('me', (c) => c.isMonster), 1, 1, 'Target 1 of your banished monsters to add to your hand.', 'toHand', {
            aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
          });
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.location === 'banished');
          if (t.length) await ctx.toHand(t);
        },
      },
    ],
  }),
);

once('Machina Fortress', () =>
  monster('Machina Fortress', {
    attribute: 'EARTH',
    race: 'Machine',
    level: 7,
    atk: 2500,
    def: 1600,
    sets: ['machina'],
    aiValue: 1100,
    text: 'You can discard Machine monster(s) whose total Levels equal 8 or more, then Special Summon this card (from your hand or GY). If this card is destroyed by battle and sent to the GY: Target 1 card your opponent controls; destroy that target. Before resolving an opponent\'s monster effect that targets this face-up card, look at your opponent\'s hand and discard 1 card from their hand.',
    effects: [
      {
        kind: 'ignition',
        range: ['hand', 'grave'],
        label: 'Discard Machines (Levels 8+): Special Summon',
        categories: ['specialSummon', 'discard'],
        canActivate: (ctx) => {
          if (!ctx.canSpecialSummon()) return false;
          const lv = ctx.hand('me', (c) => c !== ctx.self && isMachine(c)).reduce((a, c) => a + (c.data.level ?? 0), 0);
          return lv >= 8;
        },
        activate: async (ctx) => {
          const picked: C[] = [];
          let total = 0;
          while (total < 8) {
            const rest = ctx.hand('me', (c) => c !== ctx.self && isMachine(c) && !picked.includes(c));
            if (!rest.length) break;
            const need = 8 - total;
            const [c] = await ctx.select(rest, 1, 1, `Discard Machine monsters with total Levels of 8 or more (${total}/8).`, 'discard', {
              // Prefer a single card that finishes the total, then the lowest-value Machines.
              aiScore: (x) => ((x.data.level ?? 0) >= need ? 2000 - (x.data.level ?? 0) * 10 : 0) - cardValue(ctx.game, x) / 10 + (x.data.level ?? 0) * 20,
            });
            if (!c) break;
            picked.push(c);
            total += c.data.level ?? 0;
          }
          if (total < 8) return false;
          await ctx.discard(picked, 'cost');
        },
        resolve: async (ctx) => {
          if ((ctx.self.location === 'hand' || ctx.self.location === 'grave') && ctx.canSpecialSummon()) await ctx.specialSummon(ctx.self);
        },
        ai: {
          score: (ctx) => {
            // Discarding a second Fortress from hand to summon one from the GY is fine; avoid burning a Gearframe/Peacekeeper only.
            const fodder = ctx.hand('me', (c) => c !== ctx.self && isMachine(c));
            const hasCheap = fodder.some((c) => c.name === 'Machina Fortress' || (c.data.level ?? 0) >= 4);
            return hasCheap ? 72 : 40;
          },
        },
      },
      {
        kind: 'trigger',
        event: 'sentToGrave',
        mandatory: true,
        label: 'Destroy 1 card your opponent controls',
        categories: ['destroy'],
        eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && (ev.reasons ?? []).includes('battle'),
        canActivate: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
        activate: async (ctx) => {
          await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Target 1 card your opponent controls to destroy.', 'destroy');
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.onField);
          if (t.length) await ctx.destroy(t);
        },
      },
      {
        // "Before resolving an opponent's monster effect that targets this face-up card": not a Chain Link. The
        // targeting link's resolution is wrapped (like Spirit Reaper); the discard happens as that effect starts to
        // resolve, if it still resolves and this card is still the same face-up target.
        kind: 'trigger',
        event: 'chainActivated',
        label: 'Look at the hand and discard 1',
        categories: ['discard'],
        eventFilter: (ctx, ev) => {
          const link = ev.data?.link as (ChainLink & { fortressWatch?: Set<number> }) | undefined;
          const me = ctx.self;
          if (!link || link.player !== ctx.opp || !link.card.isMonster || link.isCardActivation) return false;
          if (me.location !== 'mzone' || !me.faceUp || !link.ctx.targets.includes(me)) return false;
          link.fortressWatch ??= new Set();
          if (link.fortressWatch.has(me.uid)) return false;
          link.fortressWatch.add(me.uid);
          const moveId = me.moveId;
          const game = ctx.game;
          const owner = ctx.player;
          const orig = link.effect;
          link.effect = {
            ...orig,
            resolve: async (c2) => {
              if (me.location === 'mzone' && me.faceUp && me.moveId === moveId && me.controller === owner && !game.isNegated(me)) {
                const hand = game.players[game.opp(owner)].hand;
                if (hand.length) {
                  game.log(`${me.name}: ${game.players[owner].name} looks at the opponent's hand.`, 'action', owner);
                  const sel = await game.select(owner, [...hand], 1, 1, "Discard 1 card from your opponent's hand.", 'discard', {
                    aiScore: (c) => cardValue(game, c),
                    source: me,
                  });
                  if (sel.length) await game.discard(sel, 'effect', owner, me);
                }
              }
              if (orig.resolve) await orig.resolve(c2);
            },
          };
          return false;
        },
      },
    ],
  }),
);

once('Machina Gearframe', () =>
  monster('Machina Gearframe', {
    attribute: 'EARTH',
    race: 'Machine',
    level: 4,
    atk: 1800,
    def: 0,
    types: ['union'],
    sets: ['machina'],
    aiValue: 700,
    text: 'When this card is Normal Summoned: You can add 1 "Machina" monster from your Deck to your hand, except "Machina Gearframe". Once per turn, you can either: Target 1 Machine monster you control; equip this card to that target, OR: Unequip this card and Special Summon it. If the equipped monster would be destroyed by battle or card effect, destroy this card instead.',
    effects: [
      {
        kind: 'trigger',
        event: 'normalSummoned',
        when: true,
        label: 'Add 1 "Machina" monster',
        categories: ['search'],
        eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone',
        canActivate: (ctx) => ctx.deck('me', (c) => c.isMonster && c.inSet('machina') && c.name !== 'Machina Gearframe').length > 0,
        resolve: async (ctx) => {
          await ctx.search((c) => c.isMonster && c.inSet('machina') && c.name !== 'Machina Gearframe', 1, 'Add 1 "Machina" monster from your Deck to your hand.');
        },
      },
      ...unionEffects(),
    ],
  }),
);

once('Machina Peacekeeper', () =>
  monster('Machina Peacekeeper', {
    attribute: 'EARTH',
    race: 'Machine',
    level: 2,
    atk: 500,
    def: 400,
    types: ['union'],
    sets: ['machina'],
    aiValue: 600,
    text: 'When this card on the field is destroyed and sent to the GY: You can add 1 Union monster from your Deck to your hand. Once per turn, you can either: Target 1 Machine monster you control; equip this card to that target, OR: Unequip this card and Special Summon it. If the equipped monster would be destroyed by battle or card effect, destroy this card instead.',
    effects: [
      {
        kind: 'trigger',
        event: 'sentToGrave',
        when: true,
        label: 'Add 1 Union monster',
        categories: ['search'],
        eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.from === 'mzone' || ev.from === 'szone') && (ev.reasons ?? []).includes('destroy'),
        canActivate: (ctx) => ctx.deck('me', (c) => c.isMonster && c.hasType('union')).length > 0,
        resolve: async (ctx) => {
          await ctx.search((c) => c.isMonster && c.hasType('union'), 1, 'Add 1 Union monster from your Deck to your hand.');
        },
      },
      ...unionEffects(),
    ],
  }),
);

once('Proto-Cyber Dragon', () => {
  /** Installed once per instance: the name reads "Cyber Dragon" while the card is face-up on the field. */
  const renamed = new WeakSet<C>();
  const install = (c: C) => {
    if (renamed.has(c)) return;
    renamed.add(c);
    Object.defineProperty(c, 'name', {
      configurable: true,
      get: () => (c.location === 'mzone' && c.faceUp ? 'Cyber Dragon' : c.data.name),
    });
  };
  monster('Proto-Cyber Dragon', {
    attribute: 'LIGHT',
    race: 'Machine',
    level: 3,
    atk: 1100,
    def: 600,
    aiValue: 200,
    text: 'This card\'s name becomes "Cyber Dragon" while on the field.',
    effects: [
      {
        // Bookkeeping only (never builds a chain link): installs the on-field name change on this card.
        kind: 'trigger',
        event: ['summoned', 'flipped', 'monsterSet', 'drawn', 'addedToHand'],
        eventFilter: (ctx, ev) => {
          if (ev.card === ctx.self) install(ctx.self);
          return false;
        },
      },
    ],
  });
});

// ============================================================ EXTRA DECK

once('Tempest Magician', () =>
  monster('Tempest Magician', {
    attribute: 'DARK',
    race: 'Spellcaster',
    level: 6,
    atk: 2200,
    def: 1400,
    types: ['synchro'],
    aiValue: 600,
    text: '1 Tuner + 1 or more non-Tuner Spellcaster-Type monsters\nWhen this card is Synchro Summoned, place 1 Spell Counter on it. Once per turn, you can discard any number of cards to place 1 Spell Counter on a monster(s) you control for each card you discarded. You can remove all Spell Counters on the field to inflict 500 damage to your opponent for each removed Spell Counter.',
    synchro: { nonTuner: race('Spellcaster'), desc: '1 Tuner + 1+ non-Tuner Spellcaster-Type monsters' },
    effects: [
      {
        kind: 'trigger',
        event: 'synchroSummoned',
        mandatory: true,
        label: 'Place 1 Spell Counter',
        categories: [],
        resolve: async (ctx) => {
          if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
          ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 1;
          ctx.log(`${ctx.self.name} gets 1 Spell Counter.`);
          ctx.game.update();
        },
      },
      {
        kind: 'ignition',
        opt: true,
        label: 'Discard: place Spell Counters',
        categories: ['discard'],
        canActivate: (ctx) => ctx.hand().length > 0,
        activate: async (ctx) => {
          const disc = await ctx.select(ctx.hand(), 1, ctx.hand().length, 'Discard any number of cards.', 'discard');
          if (!disc.length) return false;
          await ctx.discard(disc, 'cost');
          ctx.data.n = disc.length;
        },
        resolve: async (ctx) => {
          for (let i = 0; i < (ctx.data.n ?? 0); i++) {
            const mons = ctx.faceUpMonsters('me');
            if (!mons.length) return;
            const [m] = await ctx.select(mons, 1, 1, `Place a Spell Counter on a monster you control (${i + 1}/${ctx.data.n}).`, 'buff', {
              aiScore: (c) => (c === ctx.self ? 100 : 0) + (c.name === 'Arcanite Magician' ? 200 : 0),
            });
            if (m) m.counters.spell = (m.counters.spell ?? 0) + 1;
          }
          ctx.game.update();
        },
        ai: {
          score: (ctx) => {
            // Only to finish the opponent off with the burn effect.
            const counters = ctx.field('both').reduce((a, c) => a + (c.counters.spell ?? 0), 0);
            const hand = ctx.hand().length;
            return (counters + hand) * 500 >= ctx.oppLp ? 60 : 0;
          },
        },
      },
      {
        kind: 'ignition',
        label: 'Remove all Spell Counters: burn',
        categories: ['damage'],
        canActivate: (ctx) => ctx.field('both', (c) => (c.counters.spell ?? 0) > 0).length > 0,
        activate: async (ctx) => {
          let n = 0;
          for (const c of ctx.field('both', (x) => (x.counters.spell ?? 0) > 0)) {
            n += c.counters.spell ?? 0;
            c.counters.spell = 0;
          }
          ctx.data.n = n;
          ctx.game.update();
        },
        resolve: async (ctx) => {
          if (ctx.data.n) await ctx.damage(ctx.opp, 500 * ctx.data.n);
        },
        ai: {
          score: (ctx) => {
            const n = ctx.field('both').reduce((a, c) => a + (c.counters.spell ?? 0), 0);
            // Do not strip Arcanite Magician's ATK counters unless it wins the game.
            const arcanite = ctx.faceUpMonsters('me', (c) => c.name === 'Arcanite Magician' && (c.counters.spell ?? 0) > 0).length;
            if (n * 500 >= ctx.oppLp) return 90;
            return arcanite ? 0 : n >= 1 && ctx.phase === 'main2' ? 35 : 0;
          },
        },
      },
    ],
  }),
);

// ============================================================ SPELLS

/** GY effects that Special Summon or add cards without moving a card that is in the GY. */
const NECROVALLEY_SAFE = ['Dandylion'];

once('Necrovalley', () =>
  spell('Necrovalley', 'field', {
    // The GY lock negates (when activated) any effect that targets a card in a GY or that is activated by a card in the
    // GY to move itself; costs that banish from a GY (Dark Armed Dragon, Chaos Sorcerer, Necro Gardna... see
    // src/cards/gy-costs.ts) cannot be paid, so those effects are not offered. APPROX: non-targeting effects that
    // move GY cards are not stopped.
    text: 'All "Gravekeeper\'s" monsters on the field gain 500 ATK/DEF. Cards in the GY cannot be banished. Negate any card effect that would move a card in the GY to a different place. Negate any card effect that changes Types or Attributes in the GY.',
    aiValue: 600,
    effects: [
      {
        kind: 'activate',
        categories: ['lockdown'],
        ai: { score: (ctx) => (ctx.cards('me', 'fzone', (c) => c.name === 'Necrovalley').length ? 0 : 45) },
      },
      {
        kind: 'continuous',
        range: ['fzone'],
        mods: [
          { q: 'atk', to: 'cards', filter: (_ctx, c: C) => c.location === 'mzone' && c.faceUp && c.inSet('gravekeeper'), value: 500 },
          { q: 'def', to: 'cards', filter: (_ctx, c: C) => c.location === 'mzone' && c.faceUp && c.inSet('gravekeeper'), value: 500 },
          { q: 'cannotBanishFromGY', to: 'players', value: true },
        ],
      },
      {
        kind: 'trigger',
        event: 'chainActivated',
        label: 'Necrovalley (negate)',
        eventFilter: (ctx, ev) => {
          const link = ev.data?.link as ChainLink | undefined;
          if (!link || link.negated || !stActive(ctx) || ctx.self.location !== 'fzone') return false;
          // A GY effect that moves the card itself (Plaguespreader Zombie, Treeborn Frog, Necro Gardna...). Searches from the
          // Deck (Sangan) and Dandylion's Tokens do not move a card in the GY, so they are not negated.
          const cats = link.effect.categories ?? [];
          const moves = cats.some((k) => ['specialSummon', 'toHand', 'toDeck', 'banish'].includes(k));
          const targetsGY = link.ctx.targets.some((c) => c.location === 'grave');
          const fromGY = link.fromLocation === 'grave' && link.card.location === 'grave' && moves && !NECROVALLEY_SAFE.includes(link.card.name);
          if (targetsGY || fromGY) {
            ctx.game.log(`Necrovalley negates ${link.card.name}.`, 'action', ctx.player);
            ctx.game.negateLink(link, false, ctx.self);
          }
          return false;
        },
      },
    ],
  }),
);

once('Royal Tribute', () =>
  spell('Royal Tribute', 'normal', {
    text: 'If you control "Necrovalley": Both players discard any monsters in their hands.',
    effects: [
      {
        kind: 'activate',
        categories: ['discard'],
        condition: (ctx) => ctx.cards('me', 'fzone', (c) => c.name === 'Necrovalley' && c.faceUp).length > 0,
        resolve: async (ctx) => {
          if (!ctx.cards('me', 'fzone', (c) => c.name === 'Necrovalley' && c.faceUp).length) return;
          for (const p of [ctx.player, ctx.opp]) {
            const mons = ctx.game.zone(p, 'hand').filter((c) => c.isMonster);
            if (mons.length) await ctx.game.discard(mons, 'effect', ctx.player, ctx.self);
          }
        },
        ai: {
          score: (ctx) => {
            const theirs = ctx.hand('opp').length;
            const mine = ctx.hand('me', (c) => c.isMonster).length;
            return theirs >= 2 && mine <= 1 ? 40 + theirs * 5 : 0;
          },
        },
      },
    ],
  }),
);

once('Wave-Motion Cannon', () =>
  spell('Wave-Motion Cannon', 'continuous', {
    text: 'During your Main Phase: You can send this face-up card to the GY; inflict 1000 damage to your opponent for each of your Standby Phases that have passed since this card was activated.',
    aiValue: 400,
    effects: [
      { kind: 'activate', categories: ['damage'], ai: { score: () => 25 } },
      {
        // Bookkeeping (never builds a chain link): count your Standby Phases while this card is face-up.
        kind: 'trigger',
        event: 'phaseStart',
        range: ['szone'],
        eventFilter: (ctx, ev) => {
          if (ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'szone' && ctx.self.faceUp && ctx.self.activeOnField) {
            const seen: number[] = (ctx.self.flags.wmcTurns ??= []);
            if (!seen.includes(ctx.game.turn)) seen.push(ctx.game.turn);
          }
          return false;
        },
      },
      {
        kind: 'ignition',
        label: 'Fire: 1000 damage per Standby Phase',
        categories: ['damage'],
        condition: (ctx) => stActive(ctx) && (ctx.phase === 'main1' || ctx.phase === 'main2'),
        activate: async (ctx) => {
          ctx.data.n = (ctx.self.flags.wmcTurns ?? []).length;
          await ctx.sendToGrave(ctx.self, 'cost');
        },
        resolve: async (ctx) => {
          if (ctx.data.n) await ctx.damage(ctx.opp, 1000 * ctx.data.n);
        },
        ai: {
          score: (ctx) => {
            const n = (ctx.self.flags.wmcTurns ?? []).length;
            if (n * 1000 >= ctx.oppLp) return 95;
            // Cash in before it gets destroyed when the opponent has Spell/Trap removal showing.
            return n >= 4 ? 60 : 0;
          },
        },
      },
    ],
  }),
);

once('Dimensional Fissure', () =>
  spell('Dimensional Fissure', 'continuous', {
    text: 'Any monster sent to the GY is banished instead.',
    aiValue: 300,
    effects: [
      {
        kind: 'activate',
        categories: ['lockdown'],
        ai: {
          score: (ctx) =>
            ctx.spellTraps('me', (c) => c !== ctx.self && c.faceUp && (c.name === 'Dimensional Fissure' || c.name === 'Macro Cosmos')).length ? 0 : 30,
        },
      },
      {
        kind: 'continuous',
        range: ['szone'],
        active: stActive,
        // Monsters only (the card switch); Spells and Traps still go to the GY.
        mods: [{ q: 'banishInsteadOfGrave', to: 'cards', filter: (_ctx, c: C) => c.isMonster }],
      },
    ],
  }),
);

// ============================================================ TRAPS

once('Beckoning Light', () =>
  trap('Beckoning Light', 'normal', {
    text: 'Discard your entire hand, then for each card you discarded to the GY by this effect, add 1 LIGHT monster from your GY to your hand.',
    effects: [
      {
        kind: 'activate',
        categories: ['discard', 'toHand'],
        canActivate: (ctx) => ctx.hand().length > 0 && ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'LIGHT').length > 0,
        resolve: async (ctx) => {
          const hand = [...ctx.hand()];
          if (!hand.length) return;
          const disc = await ctx.discard(hand);
          const n = disc.filter((c) => c.location === 'grave').length;
          const light = ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'LIGHT');
          if (!n || !light.length) return;
          const k = Math.min(n, light.length);
          const sel = await ctx.select(light, k, k, `Add ${k} LIGHT monster(s) from your GY to your hand.`, 'toHand', {
            aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) * 2,
          });
          if (sel.length) await ctx.toHand(sel);
        },
        ai: {
          score: (ctx) => {
            const hand = ctx.hand();
            const light = ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'LIGHT');
            if (!hand.length || light.length < hand.length) return 0;
            const gain = light.sort((a, b) => cardValue(ctx.game, b) - cardValue(ctx.game, a)).slice(0, hand.length).reduce((a, c) => a + cardValue(ctx.game, c), 0);
            const lose = hand.reduce((a, c) => a + cardValue(ctx.game, c), 0);
            return gain > lose + 800 && !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 40 : 0;
          },
        },
      },
    ],
  }),
);

once('Mirror of Oaths', () =>
  trap('Mirror of Oaths', 'normal', {
    text: 'When your opponent Special Summons a monster(s) from their Main Deck: Destroy that monster(s), and if you do, draw 1 card.',
    effects: [
      {
        kind: 'activate',
        event: 'specialSummoned',
        categories: ['destroy', 'draw'],
        eventFilter: (ctx, ev) => {
          const c = evc(ev);
          return !!c && ev.from === 'deck' && c.controller === ctx.opp && c.location === 'mzone';
        },
        activate: async (ctx) => {
          const v = summonedBatch(ctx, 'specialSummoned', (c, e) => e.from === 'deck' && c.controller === ctx.opp);
          ctx.data.victims = v;
          ctx.data.ids = v.map((c) => c.moveId);
        },
        resolve: async (ctx) => {
          const victims = (ctx.data.victims as C[]).filter((c, i) => c.location === 'mzone' && c.moveId === ctx.data.ids[i]);
          const d = await ctx.destroy(victims);
          if (d.length) await ctx.draw(1);
        },
        ai: {
          score: (ctx) => {
            const c = evc(ctx.event!);
            return c ? 45 + cardValue(ctx.game, c) / 80 : 0;
          },
        },
      },
    ],
  }),
);

once('Needle Ceiling', () =>
  trap('Needle Ceiling', 'normal', {
    text: 'If there are 4 or more monsters on the field: Destroy all face-up monsters.',
    effects: [
      {
        kind: 'activate',
        categories: ['destroy', 'destroyMulti'],
        condition: (ctx) => ctx.monsters('both').length >= 4,
        resolve: async (ctx) => {
          if (ctx.monsters('both').length < 4) return;
          await ctx.destroy(ctx.faceUpMonsters('both'));
        },
        ai: {
          score: (ctx) => {
            const theirs = ctx.faceUpMonsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
            const mine = ctx.faceUpMonsters('me').reduce((a, c) => a + cardValue(ctx.game, c), 0);
            const b = ctx.battle;
            const timing = (b && b.attacker.controller === ctx.opp && !b.inDamageStep) || (!ctx.isMyTurn && ctx.phase === 'end');
            return timing && theirs > mine + 2000 ? 55 + (theirs - mine) / 200 : 0;
          },
        },
      },
    ],
  }),
);

once('Chain Disappearance', () =>
  trap('Chain Disappearance', 'normal', {
    text: 'When a monster(s) with 1000 or less ATK is Summoned: Banish that monster(s) with 1000 or less ATK, then your opponent banishes all cards with the same name as that card(s) from their hand and Deck.',
    effects: [
      {
        kind: 'activate',
        event: 'summoned',
        categories: ['banish'],
        eventFilter: (ctx, ev) => {
          const c = evc(ev);
          return !!c && c.location === 'mzone' && c.faceUp && ctx.atk(c) <= 1000 && !c.isToken;
        },
        activate: async (ctx) => {
          const v = summonedBatch(ctx, 'summoned', (c) => c.location === 'mzone' && c.faceUp && ctx.atk(c) <= 1000 && !c.isToken);
          ctx.data.victims = v;
          ctx.data.ids = v.map((c) => c.moveId);
          ctx.data.names = v.map((c) => c.name);
        },
        resolve: async (ctx) => {
          const victims = (ctx.data.victims as C[]).filter((c, i) => c.location === 'mzone' && c.moveId === ctx.data.ids[i] && ctx.atk(c) <= 1000);
          if (!victims.length) return;
          const names = victims.map((c) => c.name);
          await ctx.banish(victims);
          const copies = ctx.cards('opp', ['hand', 'deck'], (c) => names.includes(c.name));
          if (copies.length) await ctx.game.banish(copies, 'effect', ctx.opp, ctx.self);
          ctx.game.shuffleDeck(ctx.opp);
        },
        ai: {
          score: (ctx) => {
            const c = evc(ctx.event!);
            if (!c || c.controller !== ctx.opp) return 0;
            return (c.data.aiValue ?? 0) >= 400 || c.isTuner ? 60 : 35;
          },
        },
      },
    ],
  }),
);

once('The Transmigration Prophecy', () =>
  trap('The Transmigration Prophecy', 'normal', {
    text: 'Target 2 cards in the GY(s); shuffle those targets into the Deck(s).',
    effects: [
      {
        kind: 'activate',
        categories: ['toDeck'],
        canActivate: (ctx) => ctx.grave('both', (c) => ctx.canTarget(c)).length >= 2,
        activate: async (ctx) => {
          const l = oppTop(ctx);
          const wanted = l ? l.ctx.targets.filter((c) => c.location === 'grave') : [];
          await ctx.selectTargets(ctx.grave('both'), 2, 2, 'Target 2 cards in the GY(s) to shuffle into the Deck.', 'toDeck', {
            aiScore: (c) => (wanted.includes(c) ? 5000 : 0) + (c.controller === ctx.opp || c.owner === ctx.opp ? 1000 + cardValue(ctx.game, c) : -cardValue(ctx.game, c)),
          });
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets((c) => c.location === 'grave');
          if (t.length) await ctx.toDeck(t, 'shuffle');
        },
        ai: {
          score: (ctx) => {
            // Answer an opponent's effect that targets cards in the GY (Monster Reborn, Pot of Avarice, Call of the Haunted...).
            const l = oppTop(ctx);
            if (l && l.ctx.targets.some((c) => c.location === 'grave')) return 70;
            return 0;
          },
        },
      },
    ],
  }),
);

once('Shadow-Imprisoning Mirror', () =>
  trap('Shadow-Imprisoning Mirror', 'continuous', {
    text: 'Negate all DARK monster effects activated on the field or in the GY.',
    effects: imprisoningMirror('DARK'),
  }),
);

export const TOURNAMENT_EXTRAS2_LOADED = true;
