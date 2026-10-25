// Card definitions: Monarchs and Frogs (Frog Monarchs). Treeborn Frog lives in core.ts.
import { monster } from '../define';
import { attr, bestTarget, cardValue, destroyTargets, flip, selfFieldToGrave, selfSummoned } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

// ------------------------------------------------------------------ helpers

/** A "Frog" monster (Frog the Jam is not part of the archetype). */
const isFrog = (c: CardInstance) => c.isMonster && c.inSet('frog');
const isMonarch = (c: CardInstance) => c.inSet('monarch');
const isLowAquaWater = (c: CardInstance) => c.isMonster && c.data.attribute === 'WATER' && c.data.race === 'Aqua' && (c.data.level ?? 0) <= 2 && !c.isExtra;

/** "When this card is Tribute Summoned" trigger used by every Monarch. */
function monarchTrigger(e: Omit<EffectDef, 'kind' | 'event'>): EffectDef {
  return { kind: 'trigger', event: 'tributeSummoned', eventFilter: selfSummoned('tribute'), ...e };
}

/** Can the player Tribute Summon a Monarch from hand with the monsters they control (+ extra bodies)? */
function monarchReady(ctx: Ctx, extraBodies = 0) {
  if (ctx.game.players[ctx.player].normalSummonsLeft <= 0) return false;
  const bodies = ctx.game.tributeCandidates(ctx.player).length + extraBodies;
  return ctx.hand('me', (c) => isMonarch(c) && bodies >= ctx.game.tributesNeeded(c) && ctx.game.hasNormalSummonFor(ctx.player, c, false)).length > 0;
}

/**
 * AI hint for a Monarch whose Tribute Summon trigger is mandatory and targets "1 card on the field" (Caius, Raiza):
 * with no opponent card to hit it would have to banish / spin one of our own cards (itself, if nothing else),
 * so don't Tribute Summon it face-up. Two AIs with Treeborn Frog otherwise re-summon and re-spin Raiza forever.
 */
const mandatoryMonarchSummon = (ctx: Ctx) => (ctx.field('opp', (c) => ctx.canTarget(c)).length ? 0 : -1);

/** Tribute monsters for a card effect's cost. */
async function tributeForCost(ctx: Ctx, cards: CardInstance[]) {
  if (!cards.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const canTribute = (ctx: Ctx, c: CardInstance) => !ctx.query(c, 'cannotBeTributed');

/** Value of a frog to fetch from the Deck (higher = better). */
function frogPriority(ctx: Ctx, c: CardInstance, dest: 'hand' | 'grave' | 'field') {
  const inGrave = (n: string) => ctx.grave('me', (x) => x.name === n).length;
  switch (c.name) {
    case 'Swap Frog':
      return dest === 'grave' ? 200 : 900;
    case 'Treeborn Frog':
      return dest === 'grave' ? 1000 : 300;
    case 'Ronintoadin':
      return dest === 'grave' ? 800 - inGrave('Ronintoadin') * 200 : 400;
    case 'Dupe Frog':
      return dest === 'grave' ? 300 : dest === 'field' ? 700 : 500;
    case 'Substitoad':
      return dest === 'grave' ? 250 : 600;
    case 'Flip Flop Frog':
      return 350;
    default:
      return 100;
  }
}

// ============================================================ MONARCHS

monster('Caius the Shadow Monarch', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 500,
  text: 'When this card is Tribute Summoned: Target 1 card on the field; banish it, and if it was a DARK monster, inflict 1000 damage to its controller.',
  effects: [
    monarchTrigger({
      mandatory: true,
      label: 'Banish 1 card',
      ai: { summon: mandatoryMonarchSummon },
      categories: ['banish', 'damage'],
      canActivate: (ctx) => ctx.field('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both'), 1, 1, 'Target 1 card on the field to banish.', 'banish', {
          aiScore: (c) => {
            const v = cardValue(ctx.game, c);
            if (ctx.mine(c)) return -5000 - v + (c === ctx.self ? -3000 : 0);
            return v + (c.isMonster && c.data.attribute === 'DARK' ? 900 : 0);
          },
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (!t.length) return;
        const c = t[0];
        const ctrl = c.controller;
        const r = await ctx.banish(c);
        if (r.length && c.location === 'banished' && c.isMonster && c.data.attribute === 'DARK') await ctx.damage(ctrl, 1000);
      },
    }),
  ],
});

monster('Raiza the Storm Monarch', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 6,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 500,
  text: 'When this card is Tribute Summoned: Target 1 card on the field; place it on the top of the Deck.',
  effects: [
    monarchTrigger({
      mandatory: true,
      label: 'Spin 1 card to the top of the Deck',
      ai: { summon: mandatoryMonarchSummon },
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.field('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both'), 1, 1, 'Target 1 card to place on top of the Deck.', 'toDeck', {
          aiScore: (c) => {
            const v = cardValue(ctx.game, c);
            if (ctx.mine(c)) return -5000 - v + (c === ctx.self ? -3000 : 0) + (c.isToken ? 2000 : 0);
            // Extra Deck monsters and tokens leave for good.
            return v + (c.isExtra ? 1500 : 0) + (c.isToken ? -800 : 0);
          },
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.toDeck(t[0], 'top');
      },
    }),
  ],
});

monster('Mobius the Frost Monarch', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 6,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 400,
  text: 'When this card is Tribute Summoned: You can target up to 2 Spells/Traps on the field; destroy them.',
  effects: [
    monarchTrigger({
      when: true,
      label: 'Destroy up to 2 Spells/Traps',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 2, 'Target up to 2 Spells/Traps to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 60 : 0) },
    }),
  ],
});

monster('Thestalos the Firestorm Monarch', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 6,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 450,
  text: "When this card is Tribute Summoned: Discard 1 random card from your opponent's hand. If it was a monster, inflict damage to your opponent equal to its original Level x 100.",
  effects: [
    monarchTrigger({
      mandatory: true,
      label: 'Random discard',
      categories: ['discard', 'damage'],
      canActivate: (ctx) => ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        ctx.log(`${ctx.self.name} discards ${c.name} from ${ctx.game.players[ctx.opp].name}'s hand at random.`);
        const r = await ctx.discard(c);
        if (r.length && c.isMonster) await ctx.damage(ctx.opp, (c.data.level ?? 0) * 100);
      },
    }),
  ],
});

monster('Zaborg the Thunder Monarch', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 5,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 400,
  text: 'When this card is Tribute Summoned: Target 1 monster on the field; destroy it.',
  effects: [
    monarchTrigger({
      mandatory: true,
      label: 'Destroy 1 monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster to destroy.', 'destroy', {
          aiScore: (c) => (ctx.mine(c) ? -5000 - cardValue(ctx.game, c) + (c === ctx.self ? -3000 : 0) + (c.name === 'Dupe Frog' ? 3000 : 0) : cardValue(ctx.game, c)),
        });
      },
      resolve: destroyTargets,
    }),
  ],
});

monster('Granmarg the Rock Monarch', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 6,
  atk: 2400,
  def: 1000,
  sets: ['monarch'],
  aiValue: 350,
  text: 'When this card is Tribute Summoned: Target 1 Set card on the field; destroy it.',
  effects: [
    monarchTrigger({
      mandatory: true,
      label: 'Destroy 1 Set card',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.field('both', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => !c.faceUp), 1, 1, 'Target 1 Set card to destroy.', 'destroy');
      },
      resolve: destroyTargets,
    }),
  ],
});

// ============================================================ FROGS

monster('Swap Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 1000,
  def: 500,
  sets: ['frog'],
  aiValue: 500,
  text: 'You can Special Summon this card from your hand by sending 1 other WATER monster from your hand to the GY. When this card is Normal or Special Summoned: You can send 1 Level 2 or lower WATER Aqua monster from your Deck to the GY. Once per turn: You can return 1 monster you control to the hand; this turn, you can Normal Summon 1 Level 2 or lower WATER Aqua-Type monster in addition to your Normal Summon or Set.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send 1 WATER)',
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self && attr('WATER')(c)).length > 0,
      perform: async (ctx) => {
        const cands = ctx.hand('me', (c) => c !== ctx.self && attr('WATER')(c));
        const sel = await ctx.select(cands, 1, 1, 'Send 1 WATER monster from your hand to the GY.', 'cost', {
          cancelable: true,
          aiScore: (c) => -cardValue(ctx.game, c) + (isFrog(c) ? 400 : 0) + (c.name === 'Ronintoadin' ? 300 : 0),
        });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const fodder = ctx.hand('me', (c) => c !== ctx.self && attr('WATER')(c) && !isMonarch(c));
          if (!fodder.length) return 0;
          return 66;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Send a Level 2 or lower WATER Aqua to the GY',
      categories: ['mill'],
      eventFilter: selfSummoned('normal', 'special'),
      canActivate: (ctx) => ctx.deck('me', isLowAquaWater).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', isLowAquaWater);
        const sel = await ctx.select(cands, 1, 1, 'Send 1 Level 2 or lower WATER Aqua monster from your Deck to the GY.', 'toGrave', {
          aiScore: (c) => frogPriority(ctx, c, 'grave'),
        });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Bounce a monster: extra Normal Summon',
      categories: ['toHand'],
      canActivate: (ctx) => !ctx.usedThisTurn('swapFrogExtraSummon') && ctx.monsters('me').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me'), 1, 1, 'Return 1 monster you control to the hand.', 'cost', {
          aiScore: (c) => (c === ctx.self ? 1000 : c.isToken ? 800 : c.name === 'Swap Frog' ? 900 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await ctx.toHand(sel, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.usedThisTurn('swapFrogExtraSummon')) return;
        ctx.markUsed('swapFrogExtraSummon');
        // Only for a Level 2 or lower WATER Aqua monster, and only a Normal Summon (not a Set).
        ctx.gainRestrictedNormalSummon((c, set) => !set && isLowAquaWater(c));
        ctx.log('You may Normal Summon 1 additional Level 2 or lower WATER Aqua-Type monster this turn.');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          if (ctx.game.players[ctx.player].normalSummonsLeft > 0) return 0;
          // Loop: bounce Swap Frog, then Special Summon it again by sending a WATER (another mill),
          // and use the extra Normal Summon on a Level 2 or lower WATER Aqua (Frogs: Tribute fodder for a Monarch).
          const water = ctx.hand('me', (c) => attr('WATER')(c) && !isMonarch(c));
          const deckFodder = ctx.deck('me', isLowAquaWater).length;
          if (water.length && deckFodder && ctx.hand('me', isLowAquaWater).length) return 48;
          return 0;
        },
      },
    },
  ],
});

monster('Substitoad', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 1,
  atk: 100,
  def: 2000,
  sets: ['frog'],
  aiValue: 500,
  // LODT: no once-per-turn clause and the battle protection covers every "Frog" monster (YGOJSON).
  text: 'You can Tribute 1 monster; Special Summon 1 "Frog" monster from your Deck, except "Substitoad". "Frog" monsters, except "Substitoad", cannot be destroyed by battle.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute 1: Special Summon a Frog',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.monsters('me', (c) => canTribute(ctx, c)).length > 0 &&
        ctx.deck('me', (c) => isFrog(c) && c.name !== 'Substitoad').length > 0 &&
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me', (c) => canTribute(ctx, c)), 1, 1, 'Tribute 1 monster.', 'tribute', {
          aiScore: (c) => -cardValue(ctx.game, c) + (c.isToken ? 600 : 0) + (c.name === 'Swap Frog' && c.summonTurn !== ctx.turn ? 300 : 0),
        });
        if (!sel.length) return false;
        await tributeForCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.deck('me', (c) => isFrog(c) && c.name !== 'Substitoad');
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Frog" monster from your Deck.', 'specialSummon', {
          aiScore: (c) => frogPriority(ctx, c, 'field'),
        });
        if (sel.length) await ctx.specialSummon(sel[0]);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          // Turn a low-value body into Swap Frog (which mills another Frog) or a wall.
          const deckSwap = ctx.deck('me', (c) => c.name === 'Swap Frog').length;
          const cheap = ctx.monsters('me', (c) => canTribute(ctx, c) && cardValue(ctx.game, c) <= 2500 && !isMonarch(c));
          if (!cheap.length) return 0;
          return deckSwap ? 52 : 30;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'indestructibleBattle',
          to: 'cards',
          filter: (_ctx, c) => c.location === 'mzone' && c.faceUp && isFrog(c) && c.name !== 'Substitoad',
        },
      ],
    },
  ],
});

monster('Ronintoadin', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 100,
  def: 2000,
  sets: ['frog'],
  aiValue: 300,
  text: 'Cannot be used as Synchro Material. If this card is in your GY: You can banish 1 other "Frog" monster from your GY; Special Summon this card.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotBeSynchroMaterial', value: true }] },
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish a Frog: revive',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSummonCard(ctx.self) && ctx.grave('me', (c) => c !== ctx.self && isFrog(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', (c) => c !== ctx.self && isFrog(c)), 1, 1, 'Banish 1 "Frog" monster from your GY.', 'cost', {
          aiScore: (c) => (c.name === 'Treeborn Frog' ? -3000 : c.name === 'Swap Frog' ? -800 : c.name === 'Ronintoadin' ? 200 : 0) - (c.data.atk ?? 0) / 10,
        });
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self, { pos: 'def' });
      },
      ai: {
        score: (ctx) => {
          const fodder = ctx.grave('me', (c) => c !== ctx.self && isFrog(c) && c.name !== 'Treeborn Frog');
          if (!fodder.length) return 0;
          if (monarchReady(ctx, 1) && !monarchReady(ctx, 0)) return 58;
          if (ctx.monsters('me').length === 0 && ctx.monsters('opp').length > 0) return 40;
          // Swap Frog can bounce something to set up a second Monarch.
          return 0;
        },
      },
    },
  ],
});

monster('Dupe Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 100,
  def: 2000,
  sets: ['frog'],
  aiValue: 450,
  text: 'This card\'s name is treated as "Des Frog" while on the field. Your opponent cannot target monsters you control for attacks, except "Dupe Frog". When this card is sent from the field to the GY: You can add 1 "Frog" monster from your Deck or GY to your hand, except "Dupe Frog".',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c) => c.location === 'mzone' && c.controller === ctx.player && c.name !== 'Dupe Frog',
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add a Frog to hand',
      categories: ['search', 'toHand'],
      eventFilter: selfFieldToGrave,
      canActivate: (ctx) => ctx.cards('me', ['deck', 'grave'], (c) => isFrog(c) && c.name !== 'Dupe Frog').length > 0,
      resolve: async (ctx) => {
        const blocked = ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck');
        const cands = ctx.cards('me', ['deck', 'grave'], (c) => isFrog(c) && c.name !== 'Dupe Frog' && !(blocked && c.location === 'deck'));
        const sel = await ctx.select(cands, 1, 1, 'Add 1 "Frog" monster from your Deck or GY to your hand.', 'toHand', {
          aiScore: (c) => frogPriority(ctx, c, 'hand') + (c.location === 'grave' && c.name !== 'Treeborn Frog' ? 50 : 0) - (c.location === 'grave' && c.name === 'Treeborn Frog' ? 2000 : 0),
        });
        const fromDeck = sel.some((c) => c.location === 'deck');
        if (sel.length) await ctx.toHand(sel);
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Flip Flop Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 500,
  def: 200,
  // CRMS: an Effect Monster (not a FLIP monster) per YGOJSON; the bounce is a "when flipped face-up" trigger (same timing as the flip() helper).
  sets: ['frog'],
  aiValue: 500,
  text: 'Once per turn, you can flip this card into face-down Defense Position. When this card is flipped face-up, you can return monsters your opponent controls to their owners\' hand up to the number of face-up "Frog" monsters you control, except "Frog the Jam".',
  effects: [
    flip({
      optional: true,
      label: 'Bounce opponent\'s monsters',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.monsters('opp').length > 0,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', isFrog).length;
        if (!n) return;
        const sel = await ctx.select(ctx.monsters('opp'), 1, n, `Return up to ${n} of your opponent's monsters to the hand.`, 'bounce');
        if (sel.length) await ctx.toHand(sel);
      },
    }),
    {
      kind: 'ignition',
      opt: true,
      label: 'Flip face-down',
      categories: ['position'],
      condition: (ctx) => ctx.self.faceUp && ctx.self.summonTurn !== ctx.turn && ctx.self.posChangedTurn !== ctx.turn,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.changePos(ctx.self, 'def', false);
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' && ctx.monsters('opp').length ? 25 : 0) },
    },
  ],
});

monster('Frog the Jam', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 700,
  def: 500,
  aiValue: 0,
  // Not a member of the "Frog" archetype (Frog support excludes it), so no 'frog' tag.
  text: 'Cannot be Special Summoned. If this card is destroyed by battle, the monster that destroyed it cannot attack during its controller\'s next turn.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Stick to the attacker',
      categories: ['lockdown'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const o = ctx.event?.other as CardInstance | undefined;
        if (o && o.location === 'mzone') ctx.addTempMod(o, 'cannotAttack', true, 'opponentEnd');
      },
    },
  ],
});

monster('Des Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 5,
  atk: 1900,
  def: 0,
  sets: ['frog'],
  text: 'When this card is Tribute Summoned: You can Special Summon "Des Frog" from your hand or Deck, up to the number of "T.A.D.P.O.L.E." in your GY.',
  effects: [
    monarchTrigger({
      when: true,
      label: 'Summon more Des Frogs',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.grave('me', (c) => c.name === 'T.A.D.P.O.L.E.').length > 0 && ctx.cards('me', ['hand', 'deck'], (c) => c.name === 'Des Frog').length > 0,
      resolve: async (ctx) => {
        const n = Math.min(ctx.grave('me', (c) => c.name === 'T.A.D.P.O.L.E.').length, ctx.freeMZones());
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => c.name === 'Des Frog');
        const sel = await ctx.select(cands, 1, n, 'Special Summon "Des Frog" monsters.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    }),
  ],
});

monster('T.A.D.P.O.L.E.', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 1,
  atk: 0,
  def: 0,
  text: 'When this card is destroyed by battle and sent to the GY: You can add any number of "T.A.D.P.O.L.E." from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Add T.A.D.P.O.L.E.s',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.deck('me', (c) => c.name === 'T.A.D.P.O.L.E.').length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === 'T.A.D.P.O.L.E.', 3, 'Add any number of "T.A.D.P.O.L.E." to your hand.', 0);
      },
    },
  ],
});

void bestTarget;
