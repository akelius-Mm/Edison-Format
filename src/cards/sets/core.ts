// Reference implementations covering every effect pattern the engine supports.
// Other card files follow these patterns.
import { monster, spell, token, trap } from '../define';
import {
  and,
  attr,
  bestTarget,
  cardValue,
  destroyTargets,
  faceUp,
  flip,
  isMonster,
  isST,
  levelMax,
  selfDestroysByBattle,
  selfFieldToGrave,
} from '../helpers';
import type { CardInstance } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

// ============================================================ SPELLS

spell('Mystical Space Typhoon', 'quickplay', {
  text: 'Target 1 Spell/Trap on the field; destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both', (c) => c !== ctx.self), 1, 1, 'Target 1 Spell/Trap to destroy.', 'destroy');
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          // Only fire at the opponent's cards. Prefer chaining to an opponent's activation or at end phase.
          const opp = ctx.spellTraps('opp', (c) => c !== ctx.self);
          if (!opp.length) return 0;
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && top.card.onField && top.card.isTrap === false && top.card.data.stype === 'quickplay') return 0;
          if (top && top.player === ctx.opp && top.card.onField && (top.card.data.ttype === 'continuous' || top.card.data.stype === 'continuous' || top.card.data.stype === 'equip')) return 80;
          return 40;
        },
      },
    },
  ],
});

spell('Heavy Storm', 'normal', {
  text: 'Destroy all Spell and Trap Cards on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c !== ctx.self).length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.spellTraps('both', (c) => c !== ctx.self));
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.spellTraps('me', (c) => c !== ctx.self).length;
          const theirs = ctx.spellTraps('opp').length;
          return theirs >= 2 && theirs > mine ? 60 + 10 * (theirs - mine) : theirs >= 1 && mine === 0 ? 45 : 0;
        },
      },
    },
  ],
});

spell('Dark Hole', 'normal', {
  text: 'Destroy all monsters on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.monsters('both').length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both'));
      },
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const mine = ctx.monsters('me').reduce((a, c) => a + cardValue(g, c), 0);
          const theirs = ctx.monsters('opp').reduce((a, c) => a + cardValue(g, c), 0);
          return theirs > mine + 1500 ? 50 + (theirs - mine) / 100 : 0;
        },
      },
    },
  ],
});

spell('Monster Reborn', 'normal', {
  text: 'Target 1 monster in either GY; Special Summon it.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('both', (c) => c.isMonster && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('both', (c) => c.isMonster && ctx.canSummonCard(c)), 1, 1, 'Target 1 monster in either GY to Special Summon.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isExtra ? 800 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0]);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('both', (c) => c.isMonster && ctx.canSummonCard(c)).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0)));
          return best >= 1900 ? 45 + best / 200 : 0;
        },
      },
    },
  ],
});

spell('Pot of Avarice', 'normal', {
  text: 'Select 5 Monster Cards in your Graveyard. Return those cards to the Deck, then draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'toDeck'],
      // https://edisonrul.ing/cards/p/pot-of-avarice.html — "This card CANNOT be activated while the player has 1 or 0
      // cards remaining in their Deck."
      canActivate: (ctx) => ctx.grave('me', isMonster).length >= 5 && ctx.deck().length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isMonster), 5, 5, 'Target 5 monsters in your GY.', 'toDeck', {
          aiScore: (c) => (c.isExtra ? 2000 : 0) + (c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length !== 5) return;
        await ctx.toDeck(t, 'shuffle');
        await ctx.draw(2);
      },
      ai: { score: () => 70 },
    },
  ],
});

spell('Book of Moon', 'quickplay', {
  text: 'Target 1 face-up monster on the field; change it to face-down Defense Position.',
  effects: [
    {
      kind: 'activate',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to flip face-down.', 'position');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], 'def', false);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          // Stop an attack on your turn's defence: flip the attacker.
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep) {
            return ctx.atk(b.attacker) >= 1500 || !b.target ? 70 : 0;
          }
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && top.card.location === 'mzone' && top.card.faceUp && top.card.isMonster) return 75;
          return 0;
        },
      },
    },
  ],
});

/** Brain Control: only a monster that can be Normal Summoned/Set (no Fusion/Synchro/Ritual/nomi monsters or Tokens). */
// Edison text: any face-up monster (the "can be Normal Summoned/Set" restriction is a later erratum)
const brainControllable = (c: CardInstance) => c.isMonster;
spell('Brain Control', 'normal', {
  text: 'Pay 800 Life Points. Select 1 face-up monster your opponent controls and take control of it until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.lp > 800 && ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => brainControllable(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.faceUpMonsters('opp', brainControllable), 1, 1, 'Target 1 face-up monster to take control of.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.takeControl(t[0], true);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', brainControllable));
          return best && ctx.atk(best) >= 1800 ? 40 + ctx.atk(best) / 100 : 0;
        },
      },
    },
  ],
});

spell('Limiter Removal', 'quickplay', {
  text: 'Double the ATK of all face-up Machine-Type monsters you control, until the end of this turn. During the End Phase, destroy all monsters that were affected by this effect.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c.data.race === 'Machine').length > 0,
      resolve: async (ctx) => {
        const machines = ctx.faceUpMonsters('me', (c) => c.data.race === 'Machine');
        for (const m of machines) {
          ctx.addTempMod(m, 'atk', ctx.atk(m), 'turn');
          const id = m.moveId;
          const fid = m.faceUpId;
          // https://edisonrul.ing/cards/l/limiter-removal.html — affected monsters are not destroyed if they were flipped
          // face-down, left the field, or are no longer Machine-Type.
          ctx.later('end', async () => {
            if (m.location === 'mzone' && m.moveId === id && m.faceUp && m.faceUpId === fid && m.data.race === 'Machine') await ctx.game.destroy([m], 'effect', ctx.player, ctx.self);
          });
        }
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || mine.data.race !== 'Machine' || !mine.faceUp) return 0;
          if (!theirs) return ctx.oppLp <= ctx.atk(mine) * 2 ? 100 : 0;
          const their = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
          return ctx.atk(mine) <= their && ctx.atk(mine) * 2 > their ? 90 : 0;
        },
      },
    },
  ],
});

const sheep = token('Sheep Token', 'EARTH', 'Beast', 1, 0, 0);
spell('Scapegoat', 'quickplay', {
  text: 'Special Summon 4 "Sheep Tokens" in Defense Position. They cannot be Tributed for a Tribute Summon. You cannot Summon other monsters the turn you activate this card (except by this effect).',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'protect'],
      canActivate: (ctx) => ctx.freeMZones() >= 4 && ctx.canSpecialSummon(),
      activate: async (ctx) => {
        // "You cannot Summon other monsters the turn you activate this card": applies from activation (even if this card
        // is negated). Setting is not a Summon and stays legal. The Sheep Tokens themselves are exempt (see resolve).
        ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
        ctx.addPlayerMod(ctx.player, 'cannotSpecialSummon');
        ctx.data.lock = ctx.game.playerMods.slice(-2);
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const lock = (ctx.data.lock ?? []) as typeof g.playerMods;
        const ss = lock.find((m) => m.q === 'cannotSpecialSummon' && g.playerMods.includes(m));
        if (ss) g.playerMods = g.playerMods.filter((m) => m !== ss);
        try {
          const toks = await ctx.createTokens(sheep, 4, 'def');
          for (const t of toks) t.flags.noTributeSummonFodder = true;
        } finally {
          if (ss && !g.playerMods.includes(ss)) g.playerMods.push(ss);
          g.update();
        }
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.target && !b.inDamageStep) return 85;
          if (!ctx.isMyTurn && ctx.phase === 'end') return 30;
          return 0;
        },
      },
    },
  ],
});

// ============================================================ TRAPS

trap('Mirror Force', 'normal', {
  text: 'When an opponent\'s monster declares an attack: Destroy all Attack Position monsters your opponent controls.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => (ev.card as CardInstance).controller === ctx.opp,
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('opp', (c) => c.pos === 'atk' && c.faceUp));
      },
      ai: {
        score: (ctx) => {
          const atks = ctx.monsters('opp', (c) => c.pos === 'atk' && c.faceUp);
          const total = atks.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return atks.length >= 2 || total >= 2000 ? 70 + total / 200 : 30;
        },
      },
    },
  ],
});

trap('Bottomless Trap Hole', 'normal', {
  text: 'When your opponent Summons a monster(s) with 1500 or more ATK: Destroy that monster(s) with 1500 or more ATK, and if you do, banish it.',
  effects: [
    {
      kind: 'activate',
      event: ['summoned'],
      categories: ['destroy', 'banish'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as CardInstance;
        return c.controller === ctx.opp && c.location === 'mzone' && c.faceUp && ctx.atk(c) >= 1500;
      },
      activate: async (ctx) => {
        // Remember every monster summoned in that summon.
        const summoned = ctx.game.recentEvents.filter((e) => e.type === 'summoned').map((e) => e.card as CardInstance);
        ctx.data.victims = summoned.filter((c) => c.controller === ctx.opp && c.faceUp && ctx.atk(c) >= 1500);
        ctx.data.ids = (ctx.data.victims as CardInstance[]).map((c) => c.moveId);
      },
      resolve: async (ctx) => {
        const victims = (ctx.data.victims as CardInstance[]).filter(
          (c, i) => c.location === 'mzone' && c.moveId === ctx.data.ids[i] && c.faceUp && ctx.atk(c) >= 1500,
        );
        const destroyed = await ctx.destroy(victims);
        const inGrave = destroyed.filter((c) => c.location === 'grave');
        if (inGrave.length) await ctx.banish(inGrave);
      },
      ai: {
        score: (ctx) => {
          const c = ctx.event?.card as CardInstance | undefined;
          return c ? 40 + cardValue(ctx.game, c) / 60 : 0;
        },
      },
    },
  ],
});

const solemnAi = (ctx: any) => {
  const lp = ctx.lp as number;
  return lp >= 2000 ? 1 : 0;
};
trap('Solemn Judgment', 'counter', {
  text: 'When a monster(s) would be Summoned, OR a Spell/Trap Card is activated: Pay half your LP; negate the Summon or activation, and if you do, destroy that card.',
  effects: [
    {
      kind: 'activate',
      label: 'Negate Summon',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && ctx.game.pendingSummon.player === ctx.opp,
      activate: async (ctx) => {
        await ctx.payLp(Math.floor(ctx.lp / 2));
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          if (!solemnAi(ctx)) return 0;
          const cards = ctx.game.pendingSummon?.cards ?? [];
          const v = Math.max(0, ...cards.map((c) => cardValue(ctx.game, c)));
          return v >= 2400 ? 60 + v / 100 : 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Negate Spell/Trap',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && l.player === ctx.opp;
      },
      activate: async (ctx) => {
        await ctx.payLp(Math.floor(ctx.lp / 2));
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          if (!solemnAi(ctx)) return 0;
          const l = ctx.prevLink();
          if (!l) return 0;
          const cats = l.effect.categories ?? [];
          if (cats.includes('destroyMulti') || cats.includes('control') || (l.card.data.aiValue ?? 0) >= 500) return 75;
          return 0;
        },
      },
    },
  ],
});

trap('Call of the Haunted', 'continuous', {
  text: 'Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position. When this card leaves the field, destroy that monster. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)), 1, 1, 'Target 1 monster in your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const r = await ctx.specialSummon(t[0], { pos: 'atk' });
        // "When that monster is destroyed, destroy this card": Tributed / used as material / bounced, Call stays.
        if (r.length && ctx.self.onField) ctx.game.link(ctx.self, r[0], true, { cardOnlyIfDestroyed: true });
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0)));
          if (best < 1500) return 0;
          // Prefer opponent's end phase or in response to attacks
          if (!ctx.isMyTurn && ctx.phase === 'end') return 60;
          if (ctx.isMyTurn && (ctx.phase === 'main1')) return 50;
          return 10;
        },
      },
    },
  ],
});

trap('Royal Oppression', 'continuous', {
  text: 'Any player can pay 800 LP to negate the Special Summon of a monster(s), and destroy that monster(s).',
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.isMyTurn ? 0 : 20) } },
    {
      kind: 'quick',
      label: 'Pay 800: negate Special Summon',
      negateSummon: true,
      anyPlayer: true, // "Any player can pay 800 LP..."; the opponent can use your Royal Oppression too.
      categories: ['negateSummon'],
      condition: (ctx) => {
        const ps = ctx.game.pendingSummon;
        return !!ps && ps.method !== 'normal' && ps.method !== 'tribute' && ps.method !== 'flip' && ctx.lp > 800;
      },
      activate: async (ctx) => {
        await ctx.payLp(800);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps || ps.player === ctx.player) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          return v >= 1800 && ctx.lp > 2000 ? 60 : 0;
        },
      },
    },
  ],
});

trap('Gravity Bind', 'continuous', {
  text: 'Level 4 or higher monsters cannot declare an attack.',
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.monsters('opp', (c) => (c.data.level ?? 0) >= 4).length ? 50 : 5) } },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && ctx.level(c) >= 4 }],
    },
  ],
});

// ============================================================ MONSTERS

monster('Sangan', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 1000,
  def: 600,
  text: 'If this card is sent from the field to the GY: Add 1 monster with 1500 or less ATK from your Deck to your hand.',
  aiValue: 400,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Search',
      categories: ['search'],
      eventFilter: selfFieldToGrave,
      resolve: async (ctx) => {
        await ctx.search((c) => c.isMonster && (c.data.atk ?? 0) <= 1500, 1, 'Add 1 monster with 1500 or less ATK to your hand.');
      },
    },
  ],
});

monster('Card Trooper', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 400,
  def: 400,
  text: 'Once per turn: You can send up to 3 cards from the top of your Deck to the GY; this card gains 500 ATK for each card sent, until the end of this turn. When this card is destroyed and sent to the GY: Draw 1 card.',
  aiValue: 400,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Mill up to 3',
      categories: ['mill', 'atkChange'],
      canActivate: (ctx) => ctx.deck().length > 1,
      activate: async (ctx) => {
        const max = Math.min(3, ctx.deck().length - 1);
        const opts = Array.from({ length: max }, (_, i) => `${i + 1} card(s)`);
        ctx.data.n = (await ctx.option('Send how many cards?', opts, (i) => i)) + 1;
      },
      resolve: async (ctx) => {
        const milled = await ctx.mill(ctx.data.n);
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 500 * milled.length, 'turn');
      },
      ai: { score: () => 55 },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.reasons ?? []).includes('destroy') && ev.from === 'mzone',
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Cyber Dragon', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 5,
  atk: 2100,
  def: 1600,
  text: 'If only your opponent controls a monster, you can Special Summon this card (from your hand).',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0,
    },
  ],
});

monster('Dark Armed Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 7,
  atk: 2800,
  def: 1000,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) while you have exactly 3 DARK monsters in your GY. You can banish 1 DARK monster from your GY, then target 1 card on the field; destroy that target.',
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1500,
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      condition: (ctx) => ctx.grave('me', attr('DARK')).length === 3 && ctx.freeMZones() > 0,
    },
    {
      kind: 'ignition',
      label: 'Banish DARK: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.grave('me', attr('DARK')).length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.grave('me', attr('DARK')), 1, 1, 'Banish 1 DARK monster from your GY.', 'cost');
        await ctx.banish(cost, 'cost');
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card to destroy.', 'destroy');
      },
      resolve: destroyTargets,
      ai: { score: (ctx) => (ctx.field('opp').length ? 65 : 0) },
    },
  ],
});

monster('Morphing Jar', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 2,
  atk: 700,
  def: 600,
  types: ['flip'],
  text: 'FLIP: Both players discard their entire hands, then draw 5 cards.',
  aiValue: 300,
  effects: [
    flip({
      categories: ['draw', 'discard'],
      resolve: async (ctx) => {
        for (const p of [ctx.player, ctx.opp]) {
          const hand = [...ctx.game.zone(p, 'hand')];
          if (hand.length) await ctx.game.discard(hand, 'effect', ctx.player, ctx.self);
        }
        await ctx.draw(5, ctx.player);
        await ctx.draw(5, ctx.opp);
      },
    }),
  ],
});

const faceUpTreeborn = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c.name === 'Treeborn Frog').length > 0;

monster('Treeborn Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 1,
  atk: 100,
  def: 100,
  sets: ['frog'],
  text: 'During your Standby Phase, if this card is in your Graveyard and you do not control any Spell or Trap Cards, you can Special Summon this card. This effect cannot be activated if there is a face-up "Treeborn Frog" on your side of the field.',
  aiValue: 200,
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      opt: true,
      label: 'Revive',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      // Edison text: not while you control a face-up "Treeborn Frog", so only one comes back per Standby Phase (checked
      // again on resolution, when two were chained together)
      condition: (ctx) => ctx.spellTraps('me').length === 0 && !faceUpTreeborn(ctx) && ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.spellTraps('me').length === 0 && !faceUpTreeborn(ctx)) await ctx.specialSummon(ctx.self);
      },
    },
  ],
});

monster('Honest', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 4,
  atk: 1100,
  def: 1900,
  text: 'During your Main Phase: You can return this face-up card to the hand. During the Damage Step, when a LIGHT monster you control battles: You can send this card from your hand to the GY; that monster gains ATK equal to the ATK of the opponent\'s monster it is battling, until the end of this turn.',
  aiValue: 900,
  effects: [
    {
      kind: 'ignition',
      label: 'Return to hand',
      categories: ['toHand'],
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.toHand(ctx.self);
      },
      ai: { score: () => 0 },
    },
    {
      kind: 'quick',
      range: ['hand'],
      damageStep: true,
      label: 'Boost LIGHT monster',
      categories: ['atkChange'],
      condition: (ctx) => {
        const b = ctx.battle;
        if (!b || !b.inDamageStep || !b.target) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        return mine.controller === ctx.player && mine.faceUp && mine.data.attribute === 'LIGHT';
      },
      // https://edisonrul.ing/cards/h/honest.html — sending Honest to the GY is the cost: "This effect cannot be activated
      // while "Dimensional Fissure" is active".
      canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'banishInsteadOfGrave') && !ctx.game.queryCard(ctx.self, 'banishInsteadOfGrave'),
      activate: async (ctx) => {
        const b = ctx.battle!;
        ctx.data.mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        ctx.data.theirs = ctx.data.mine === b.attacker ? b.target : b.attacker;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const m = ctx.data.mine as CardInstance;
        const t = ctx.data.theirs as CardInstance;
        if (m.location === 'mzone' && m.faceUp && t?.location === 'mzone') ctx.addTempMod(m, 'atk', ctx.atk(t), 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle!;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target!;
          const theirs = mine === b.attacker ? b.target! : b.attacker;
          const theirStat = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
          return ctx.atk(mine) <= theirStat ? 95 : 0;
        },
      },
    },
  ],
});

// ============================================================ EXTRA DECK

monster('Goyo Guardian', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 2800,
  def: 2000,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nWhen this card destroys an opponent\'s monster by battle and sends it to the Graveyard, you can Special Summon that monster to your side of the field in face-up Defense Position.',
  // https://edisonrul.ing/cards/g/goyo-guardian.html — "The Synchro Material Monsters do not need to be EARTH
  // monsters, contrary to recent Errata."
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Steal destroyed monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && (ev.card as CardInstance).location === 'grave',
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const c = ctx.event!.card as CardInstance;
        if (c.location === 'grave' && ctx.canSummonCard(c)) await ctx.specialSummon(c, { pos: 'def' });
      },
    },
  ],
});

monster('Brionac, Dragon of the Ice Barrier', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 6,
  atk: 2300,
  def: 1400,
  types: ['synchro'],
  text: '1 Tuner + 1 or more non-Tuner monsters\nYou can discard any number of cards to select the same number of cards on the field, and return those cards to the hand. This effect can only be used once per turn.',
  synchro: { desc: '1 Tuner + 1+ non-Tuner monsters' },
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      // Edison text: "This effect can only be used once per turn" (per copy); the hard once per turn by name is later errata.
      opt: true,
      label: 'Discard & bounce',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const maxN = Math.min(ctx.hand().length, ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length);
        const disc = await ctx.select(ctx.hand(), 1, maxN, 'Discard any number of cards.', 'discard');
        await ctx.discard(disc, 'cost');
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), disc.length, disc.length, `Target ${disc.length} card(s) to return to the hand.`, 'bounce');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (ctx.field('opp').length && ctx.hand().length >= 2 ? 45 : 0) },
    },
  ],
});

export const CORE_LOADED = true;
void isST;
void faceUp;
void levelMax;
void and;
