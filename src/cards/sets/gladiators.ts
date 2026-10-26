// Card definitions: Gladiator Beasts (archetype group B).
import { monster, spell, trap } from '../define';
import { cardValue } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { GameEvent } from '../../engine/types';

const GB = ['gladiator'];
const isGB = (c: CardInstance) => c.isMonster && c.inSet('gladiator');
const BESTIARI = 'Gladiator Beast Bestiari';
const LAQUARI = 'Gladiator Beast Laquari';

/** The summon was performed by the effect of a "Gladiator Beast" monster (tag-out, Darius, Gyzarus, Test Tiger...). */
const byGB = (ev: GameEvent) => {
  const r = ev.reasonCard as CardInstance | undefined;
  return !!r && r.isMonster && r.inSet('gladiator');
};

// ------------------------------------------------------------------ AI helpers

/** How much the AI wants to bring `c` out of the Deck right now (higher = better). */
function gbTagScore(ctx: Ctx, c: CardInstance, already: CardInstance[] = []): number {
  const oppST = ctx.spellTraps('opp').length;
  const oppFaceUp = ctx.faceUpMonsters('opp');
  const graveGB = ctx.grave('me', (g) => isGB(g) && g.name !== 'Gladiator Beast Darius');
  const hasGyzarus = ctx.extra('me', (e) => e.name === 'Gladiator Beast Gyzarus').length > 0;
  const fieldGB = ctx.faceUpMonsters('me', isGB).filter((m) => m !== ctx.self);
  const dup = already.some((a) => a.name === c.name) ? -400 : 0;
  switch (c.name) {
    case BESTIARI:
      // Its destruction is mandatory: with no opposing Spell/Trap it would have to hit one of ours.
      return dup + (oppST ? 900 : ctx.spellTraps('me').length ? 100 : 350) + (hasGyzarus && fieldGB.length ? 250 : 0);
    case 'Gladiator Beast Murmillo':
      // Mandatory: with no opposing face-up monster it destroys one of ours (or itself).
      return dup + (oppFaceUp.length ? 850 + Math.min(300, Math.max(...oppFaceUp.map((m) => cardValue(ctx.game, m))) / 10) : 20);
    case 'Gladiator Beast Darius':
      return dup + (graveGB.length ? 720 : 300);
    case LAQUARI:
      return dup + 650;
    case 'Gladiator Beast Equeste':
      return dup + (ctx.grave('me', (g) => g.inSet('gladiator')).length ? 560 : 250);
    case 'Gladiator Beast Hoplomus': {
      const oppBest = Math.max(0, ...oppFaceUp.filter((m) => m.pos === 'atk').map((m) => ctx.atk(m)));
      return dup + (oppBest > 2100 ? 700 : 280);
    }
    case 'Gladiator Beast Retiari':
      return dup + (ctx.grave('opp').length ? 420 : 150);
    case 'Gladiator Beast Andal':
      return dup + 500;
    case 'Gladiator Beast Secutor':
      return dup + 200;
    default:
      return dup + (c.data.atk ?? 0) / 10;
  }
}

/** Summon from the Deck with an explicit Gladiator Beast reason card (needed by Test Tiger). */
async function summonFromDeckBy(ctx: Ctx, cards: CardInstance[], reason: CardInstance) {
  return ctx.game.specialSummon(cards, ctx.player, { pos: 'choose', reasonCard: reason });
}

// ------------------------------------------------------------------ effect builders

/** "At the end of the Battle Phase, if this card attacked or was attacked: shuffle it into the Deck; SS n GB from Deck". */
// LODT: `exclude` names a card that cannot be Special Summoned by the tag-out (Gyzarus: "except Bestiari").
function tagOut(n = 1, excludeSelfName = true, exclude?: string): EffectDef {
  return {
    kind: 'trigger',
    event: 'battleEnd',
    label: n > 1 ? `Tag out (${n} Gladiator Beasts)` : 'Tag out',
    categories: ['specialSummon', 'toDeck'],
    eventFilter: (ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.attackedThisTurnOrWasAttacked,
    canActivate: (ctx) =>
      !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
      ctx.freeMZones() + 1 >= n &&
      ctx.deck('me', (c) => isGB(c) && (!excludeSelfName || c.name !== ctx.self.name) && c.name !== exclude).length >= n,
    activate: async (ctx) => {
      ctx.data.name = ctx.self.name;
      await ctx.toDeck(ctx.self, 'shuffle', 'cost');
    },
    resolve: async (ctx) => {
      const cands = ctx.deck('me', (c) => isGB(c) && (!excludeSelfName || c.name !== ctx.data.name) && c.name !== exclude && ctx.canSummonCard(c));
      const k = Math.min(n, ctx.freeMZones(), cands.length);
      if (k <= 0 || ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return;
      const picked: CardInstance[] = [];
      for (let i = 0; i < k; i++) {
        const rest = cands.filter((c) => !picked.includes(c));
        const sel = await ctx.select(rest, 1, 1, `Special Summon a "Gladiator Beast" from your Deck (${i + 1}/${k}).`, 'specialSummon', {
          aiScore: (c) => gbTagScore(ctx, c, picked),
        });
        if (!sel.length) break;
        picked.push(sel[0]);
      }
      if (picked.length) await ctx.specialSummon(picked);
      ctx.game.shuffleDeck(ctx.player);
    },
    ai: {
      score: (ctx) => {
        // Heavily damaged Laquari/Hoplomus boosts would be lost, but fresh effects are almost always worth it.
        const cands = ctx.deck('me', (c) => isGB(c) && (!excludeSelfName || c.name !== ctx.self.name) && c.name !== exclude);
        const best = Math.max(0, ...cands.map((c) => gbTagScore(ctx, c)));
        if (ctx.self.name === LAQUARI && ctx.self.flags.gbSummoned && best < 500) return 0;
        return best > 0 ? 1 : 0;
      },
    },
  };
}

/** "If this card is Special Summoned by the effect of a Gladiator Beast monster: ..." */
function onGBSummon(e: Omit<EffectDef, 'kind' | 'event' | 'eventFilter'>): EffectDef {
  return {
    kind: 'trigger',
    event: 'specialSummoned',
    eventFilter: (ctx, ev) => ev.card === ctx.self && byGB(ev) && ctx.self.location === 'mzone',
    ...e,
  };
}

/** Bookkeeping: remember that this card was Special Summoned by a Gladiator Beast effect (never builds a chain link). */
const markGB: EffectDef = {
  kind: 'trigger',
  event: 'specialSummoned',
  eventFilter: (ctx, ev) => {
    if (ev.card === ctx.self && byGB(ev) && ctx.self.location === 'mzone') ctx.self.flags.gbSummoned = true;
    return false;
  },
};

const statBoost = (q: 'atk' | 'def', amount: number): EffectDef => ({
  kind: 'continuous',
  active: (ctx) => !!ctx.self.flags.gbSummoned,
  mods: [{ q, value: amount }],
});

const TAG_TEXT = 'At the end of the Battle Phase, if this card attacked or was attacked: You can shuffle it into the Deck; Special Summon 1 "Gladiator Beast" monster from your Deck, except';

// ============================================================ MAIN DECK MONSTERS

monster(BESTIARI, {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 4,
  atk: 1500,
  def: 800,
  sets: GB,
  aiValue: 700,
  text: `If this card is Special Summoned by the effect of a "Gladiator Beast" monster: Target 1 Spell/Trap on the field; destroy that target. ${TAG_TEXT} "${BESTIARI}".`,
  effects: [
    onGBSummon({
      // Official text: mandatory ("Target 1 Spell/Trap"; no "You can"): with only your own Spell/Traps on the field it must target one.
      mandatory: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? 1000 : 0) - (c.faceUp ? 0 : 1) + (c.controller !== ctx.opp && c.faceUp && c.isTrap ? 200 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length ? 1 : 0) },
    }),
    tagOut(),
  ],
});

monster('Gladiator Beast Darius', {
  attribute: 'EARTH',
  race: 'Beast-Warrior', // PTDN: Darius is a Beast-Warrior (YGOJSON), not a Beast
  level: 4,
  atk: 1700,
  def: 300,
  sets: GB,
  aiValue: 500,
  text: `When this card is Special Summoned by the effect of a "Gladiator Beast" monster: You can target 1 "Gladiator Beast" monster in your GY; Special Summon that target, but its effect(s) is negated by this card, and it is shuffled into the Deck when this card leaves the field. ${TAG_TEXT} "Gladiator Beast Darius".`,
  effects: [
    onGBSummon({
      label: 'Revive Gladiator Beast',
      categories: ['specialSummon'],
      // Official text: it TARGETS the monster in the GY when the effect is activated (Necrovalley, D.D. Crow in response).
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isGB(c) && ctx.canSummonCard(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.grave('me', (c) => isGB(c) && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 "Gladiator Beast" monster in your GY to Special Summon.', 'specialSummon', {
          aiScore: (c) => (c.name === BESTIARI ? 2000 : 0) + (c.data.atk ?? 0) + (c.name === LAQUARI ? 300 : 0),
        });
      },
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const sel = ctx.validTargets((c) => c.location === 'grave' && isGB(c));
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0]);
        if (!r.length) return;
        ctx.negateEffects(r[0], 'field');
        if (ctx.self.location === 'mzone') {
          r[0].flags.dariusSrc = ctx.self.uid;
          r[0].flags.dariusSrcMove = ctx.self.moveId;
        } else {
          // Darius already left the field: the monster goes straight back.
          await ctx.toDeck(r[0], 'shuffle');
        }
      },
    }),
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      range: ['grave', 'deck', 'hand', 'banished', 'extra'],
      label: 'Return revived monster',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self &&
        ctx.game.monsters(ctx.player).concat(ctx.game.monsters(ctx.opp)).some((m) => m.flags.dariusSrc === ctx.self.uid && m.flags.dariusSrcMove === ctx.self.moveId - 1),
      activate: async (ctx) => {
        ctx.data.mons = ctx.monsters('both', (m) => m.flags.dariusSrc === ctx.self.uid && m.flags.dariusSrcMove === ctx.self.moveId - 1);
        ctx.data.ids = (ctx.data.mons as CardInstance[]).map((m) => m.moveId);
      },
      resolve: async (ctx) => {
        const mons = (ctx.data.mons as CardInstance[]).filter((m, i) => m.location === 'mzone' && m.moveId === ctx.data.ids[i]);
        if (mons.length) await ctx.toDeck(mons, 'shuffle');
      },
    },
    tagOut(),
  ],
});

monster(LAQUARI, {
  attribute: 'FIRE',
  race: 'Beast-Warrior', // YGOJSON: Beast-Warrior (was Beast)
  level: 4,
  atk: 1800,
  def: 400,
  sets: GB,
  aiValue: 300,
  text: `If this card is Special Summoned by the effect of a "Gladiator Beast" monster, its original ATK becomes 2100. ${TAG_TEXT} "${LAQUARI}".`,
  effects: [markGB, statBoost('atk', 300), tagOut()],
});

monster('Gladiator Beast Murmillo', {
  attribute: 'WATER',
  race: 'Fish',
  level: 3,
  atk: 800,
  def: 400,
  sets: GB,
  aiValue: 600,
  text: `When this card is Special Summoned by the effect of a "Gladiator Beast" monster: Target 1 face-up monster; destroy that target. ${TAG_TEXT} "Gladiator Beast Murmillo".`,
  effects: [
    onGBSummon({
      // Official text: mandatory ("Target 1 face-up monster"; no "You can"), and it can target itself.
      mandatory: true,
      label: 'Destroy 1 face-up monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? 10000 + cardValue(ctx.game, c) : c === ctx.self ? 0 : -cardValue(ctx.game, c) / 10),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length ? 1 : 0) },
    }),
    tagOut(),
  ],
});

monster('Gladiator Beast Hoplomus', {
  attribute: 'EARTH',
  race: 'Rock', // YGOJSON: Rock, 700 ATK (was Reptile, 300)
  level: 4,
  atk: 700,
  def: 2100,
  sets: GB,
  aiValue: 200,
  text: `If this card is Special Summoned by the effect of a "Gladiator Beast" monster, its original DEF becomes 2400. ${TAG_TEXT} "Gladiator Beast Hoplomus".`,
  effects: [markGB, statBoost('def', 300), tagOut()],
});

monster('Gladiator Beast Equeste', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 4,
  atk: 1600,
  def: 1200,
  sets: GB,
  aiValue: 400,
  text: `When this card is Special Summoned by the effect of a "Gladiator Beast" monster: Target 1 "Gladiator Beast" card in your GY; add that target to your hand. ${TAG_TEXT} "Gladiator Beast Equeste".`,
  effects: [
    onGBSummon({
      mandatory: true, // official text: no "You can"
      canActivate: (ctx) => ctx.grave('me', (c) => c.inSet('gladiator') && ctx.canTarget(c)).length > 0,
      label: 'Add Gladiator Beast card',
      categories: ['toHand'],
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.inSet('gladiator')), 1, 1, 'Target 1 "Gladiator Beast" card in your GY.', 'toHand', {
          aiScore: (c) => (c.name === 'Gladiator Beast War Chariot' ? 2500 : 0) + (c.name === BESTIARI ? 2200 : 0) + (c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    }),
    tagOut(),
  ],
});

monster('Gladiator Beast Retiari', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 3,
  atk: 1200, // YGOJSON: 1200/800 (was 1000/1200)
  def: 800,
  sets: GB,
  text: `If this card is Special Summoned by the effect of a "Gladiator Beast" monster: You can target 1 card in your opponent's GY; banish it. ${TAG_TEXT} "Gladiator Beast Retiari".`,
  effects: [
    onGBSummon({
      label: 'Banish from GY',
      categories: ['banish'],
      canActivate: (ctx) => ctx.grave('opp').length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('opp'), 1, 1, "Target 1 card in your opponent's GY.", 'banish', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isExtra ? 1000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.banish(t);
      },
    }),
    tagOut(),
  ],
});

// YGOJSON: WIND / Reptile / Level 4 (was EARTH / Dinosaur / Level 3). Secutor has no ordinary tag-out: only if it was
// Special Summoned by a Gladiator Beast effect, at the end of a Battle Phase in which it battled, it (mandatorily)
// Special Summons 2 Gladiator Beasts from the Deck and stays on the field itself.
const SECUTOR = 'Gladiator Beast Secutor';
const secutorCands = (ctx: Ctx) => ctx.deck('me', (c) => isGB(c) && c.name !== SECUTOR && ctx.canSummonCard(c));
monster(SECUTOR, {
  attribute: 'WIND',
  race: 'Reptile',
  level: 4,
  atk: 400,
  def: 300,
  sets: GB,
  aiValue: 400,
  text: `If this card was Special Summoned by the effect of a "Gladiator Beast" monster, then at the end of any Battle Phase in which this card attacked or was attacked: Special Summon 2 "Gladiator Beast" monsters from your Deck, except "${SECUTOR}".`,
  effects: [
    markGB,
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label: 'Special Summon 2 Gladiator Beasts',
      categories: ['specialSummon'],
      eventFilter: (ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && !!ctx.self.flags.gbSummoned && ctx.self.attackedThisTurnOrWasAttacked,
      // "Special Summon 2": nothing happens unless both can be Special Summoned.
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2 && secutorCands(ctx).length >= 2,
      resolve: async (ctx) => {
        const cands = secutorCands(ctx);
        if (ctx.freeMZones() < 2 || cands.length < 2 || !ctx.canSpecialSummon()) return;
        const picked: CardInstance[] = [];
        for (let i = 0; i < 2; i++) {
          const sel = await ctx.select(cands.filter((c) => !picked.includes(c)), 1, 1, `Special Summon a "Gladiator Beast" from your Deck (${i + 1}/2).`, 'specialSummon', {
            aiScore: (c) => gbTagScore(ctx, c, picked),
          });
          if (!sel.length) break;
          picked.push(sel[0]);
        }
        if (picked.length) await ctx.specialSummon(picked);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

// PTDN: Gladiator Beast Andal (PTDN-EN002) is a Normal Monster (Beast-Warrior/EARTH/Level 4/ATK 1900/DEF 1500) per
// YGOJSON; the previous definition gave it an effect, the Beast Type and 1100 DEF.
monster('Gladiator Beast Andal', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1900,
  def: 1500,
  sets: GB,
  text: 'This one-eyed warrior bear is an aggressive hunter that strikes down its prey with the powerful swipes of its claws. No one can bear the brunt of his tremendously fast and heavy blows.',
});

monster('Test Tiger', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 3,
  atk: 600,
  def: 300,
  aiValue: 500,
  text: 'If you control a face-up "Gladiator Beast" monster, you can Special Summon this card (from your hand). You can Tribute this card to target 1 face-up "Gladiator Beast" monster you control; shuffle that target into the Deck, then Special Summon 1 "Gladiator Beast" from your Deck, and treat it as if it was Special Summoned by the effect of a "Gladiator Beast" monster.',
  effects: [
    {
      // Inherent Special Summon from the hand (official text; was missing).
      kind: 'proc',
      label: 'Special Summon',
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', isGB).length > 0,
    },
    {
      kind: 'ignition',
      label: 'Tag a Gladiator Beast',
      categories: ['specialSummon', 'toDeck'],
      canActivate: (ctx) =>
        !ctx.query(ctx.self, 'cannotBeTributed') &&
        ctx.faceUpMonsters('me', (c) => isGB(c) && c !== ctx.self).length > 0 &&
        ctx.deck('me', isGB).length > 0 &&
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'tribute');
        await ctx.selectTargets(ctx.faceUpMonsters('me', isGB), 1, 1, 'Target 1 face-up "Gladiator Beast" you control.', 'generic', {
          aiScore: (c) => -cardValue(ctx.game, c) + (c.flags.dariusSrc ? -2000 : 0) + (c.isExtra ? -10000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && isGB(c));
        if (!t.length) return;
        const gb = t[0];
        await ctx.toDeck(gb, 'shuffle');
        if (gb.location !== 'deck' && gb.location !== 'extra') return;
        const cands = ctx.deck('me', (c) => isGB(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Gladiator Beast" from your Deck.', 'specialSummon', { aiScore: (c) => gbTagScore(ctx, c) });
        // Treated as Summoned by the returned Gladiator Beast's effect, so the new monster's effect applies.
        // (The summoned Gladiator Beast itself is the reason card: the returned monster may have been an Elemental Hero
        // Prisma that was only named "Gladiator Beast ..." on the field.)
        if (sel.length) await summonFromDeckBy(ctx, sel, isGB(gb) ? gb : sel[0]);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          if (!ctx.faceUpMonsters('me', (c) => isGB(c) && !c.isExtra).length) return 0;
          const best = Math.max(0, ...ctx.deck('me', isGB).map((c) => gbTagScore(ctx, c)));
          return best >= 800 ? 58 : best >= 600 ? 40 : 0;
        },
      },
    },
  ],
});

// ============================================================ SPELLS / TRAPS

trap('Gladiator Beast War Chariot', 'counter', {
  sets: GB,
  text: 'When an Effect Monster\'s effect is activated while you control a face-up "Gladiator Beast" monster: Negate the activation, and if you do, destroy that monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.card.isMonster && !l.isCardActivation && ctx.faceUpMonsters('me', isGB).length > 0;
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          const onField = l.card.location === 'mzone';
          if (cats.some((c) => ['destroy', 'destroyMulti', 'banish', 'control', 'negate', 'discard'].includes(c))) return 70;
          if (onField && cardValue(ctx.game, l.card) >= 1800) return 60;
          // Floaters / small revivals from the GY are not worth a Counter Trap.
          if (!onField && cats.includes('specialSummon') && (l.card.data.atk ?? 0) < 1000 && l.card.location === 'grave') return -1;
          if (cats.some((c) => ['specialSummon', 'search', 'draw', 'toHand'].includes(c))) return onField ? 60 : 40;
          return onField ? 35 : -1;
        },
      },
    },
  ],
});

const PG_PRIORITY: Record<string, number> = { [LAQUARI]: 900, 'Gladiator Beast Darius': 800, [BESTIARI]: 700, 'Gladiator Beast Equeste': 500 };

spell('Gladiator Proving Ground', 'normal', {
  text: 'Add 1 Level 4 or lower "Gladiator Beast" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', (c) => isGB(c) && (c.data.level ?? 0) <= 4).length > 0,
      resolve: async (ctx) => {
        const handNames = new Set(ctx.hand().map((c) => c.name));
        const cands = ctx.deck('me', (c) => isGB(c) && (c.data.level ?? 0) <= 4);
        if (ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck') || !cands.length) return;
        const sel = await ctx.select(cands, 1, 1, 'Add 1 Level 4 or lower "Gladiator Beast" to your hand.', 'toHand', {
          aiScore: (c) => (PG_PRIORITY[c.name] ?? 300) - (handNames.has(c.name) ? 600 : 0),
        });
        if (sel.length) await ctx.toHand(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 58 },
    },
  ],
});

spell("Gladiator Beast's Respite", 'normal', {
  sets: GB,
  text: 'Shuffle 2 "Gladiator Beast" cards from your hand into the Deck; draw 3 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'toDeck'],
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self && c.inSet('gladiator')).length >= 2,
      activate: async (ctx) => {
        const cost = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && c.inSet('gladiator')), 2, 2, 'Shuffle 2 "Gladiator Beast" cards from your hand into the Deck.', 'cost');
        await ctx.toDeck(cost, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(3);
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c !== ctx.self && c.inSet('gladiator')).length >= 3 || ctx.game.players[ctx.player].normalSummonsLeft === 0 ? 55 : 30) },
    },
  ],
});

// ============================================================ EXTRA DECK (contact fusions)

/** Face-up Gladiator Beasts the player can return for a contact fusion. */
const fieldGBs = (ctx: Ctx) => ctx.faceUpMonsters('me', isGB);

monster('Gladiator Beast Gyzarus', {
  attribute: 'DARK', // LODT: DARK per YGOJSON (was WIND)
  race: 'Winged Beast',
  level: 6,
  atk: 2400,
  def: 1500,
  types: ['fusion'],
  sets: GB,
  aiValue: 500,
  text: `"${BESTIARI}" + 1 "Gladiator Beast" monster\nMust be Special Summoned from the Extra Deck by shuffling the above cards you control into the Deck (you do not use "Polymerization"). When this card is Special Summoned: You can target up to 2 cards on the field; destroy them. At the end of the Battle Phase, if this card attacked or was attacked: You can return it to the Extra Deck; Special Summon 2 "Gladiator Beast" monsters from your Deck, except "${BESTIARI}".`,
  fusion: { materials: [(c) => c.name === BESTIARI, isGB], noPoly: true, desc: `"${BESTIARI}" + 1 "Gladiator Beast" monster` },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => {
        const f = fieldGBs(ctx);
        return f.some((b) => b.name === BESTIARI) && f.length >= 2;
      },
      perform: async (ctx) => {
        const f = fieldGBs(ctx);
        const b = await ctx.select(f.filter((c) => c.name === BESTIARI), 1, 1, `Select "${BESTIARI}" to return to the Deck.`, 'material');
        if (!b.length) return false;
        const o = await ctx.select(f.filter((c) => c !== b[0]), 1, 1, 'Select 1 other "Gladiator Beast" to return to the Deck.', 'material', {
          aiScore: (c) => -cardValue(ctx.game, c) + (c.flags.dariusSrc ? 3000 : 0),
        });
        if (!o.length) return false;
        ctx.log(`${ctx.game.players[ctx.player].name} shuffles ${b[0].name} and ${o[0].name} into the Deck.`);
        await ctx.toDeck([b[0], o[0]], 'shuffle', 'material');
        return true;
      },
      ai: {
        score: (ctx) => {
          const oppCards = ctx.field('opp').length;
          if (!oppCards) return ctx.phase === 'main1' && ctx.game.turn > 1 ? 30 : 0;
          return 72 + Math.min(oppCards, 2) * 5;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      label: 'Destroy up to 2 cards',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 2, 'Target up to 2 cards on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.validTargets((c) => c.onField));
      },
      ai: { score: (ctx) => (ctx.field('opp', (c) => ctx.canTarget(c)).length ? 1 : 0) },
    },
    tagOut(2, false, BESTIARI), // LODT: except "Gladiator Beast Bestiari"
  ],
});

monster('Gladiator Beast Heraklinos', {
  attribute: 'FIRE', // YGOJSON: FIRE / Beast-Warrior (was EARTH / Insect)
  race: 'Beast-Warrior',
  level: 8,
  atk: 3000,
  def: 2800,
  types: ['fusion'],
  sets: GB,
  aiValue: 900,
  text: `"${LAQUARI}" + 2 "Gladiator Beast" monsters\nMust be Special Summoned from the Extra Deck by shuffling the above cards you control into the Deck (you do not use "Polymerization"). When a Spell/Trap Card is activated (Quick Effect): You can discard 1 card; negate the activation, and if you do, destroy it. This card must be face-up on the field to activate and to resolve this effect.`,
  fusion: { materials: [(c) => c.name === LAQUARI, isGB, isGB], noPoly: true, desc: `"${LAQUARI}" + 2 "Gladiator Beast" monsters` },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => {
        const f = fieldGBs(ctx);
        return f.some((b) => b.name === LAQUARI) && f.length >= 3;
      },
      perform: async (ctx) => {
        const f = fieldGBs(ctx);
        const l = await ctx.select(f.filter((c) => c.name === LAQUARI), 1, 1, `Select "${LAQUARI}" to return to the Deck.`, 'material');
        if (!l.length) return false;
        const o = await ctx.select(f.filter((c) => c !== l[0]), 2, 2, 'Select 2 other "Gladiator Beast" monsters to return to the Deck.', 'material', {
          aiScore: (c) => -cardValue(ctx.game, c) + (c.flags.dariusSrc ? 3000 : 0),
        });
        if (o.length < 2) return false;
        ctx.log(`${ctx.game.players[ctx.player].name} shuffles ${[l[0], ...o].map((c) => c.name).join(', ')} into the Deck.`);
        await ctx.toDeck([l[0], ...o], 'shuffle', 'material');
        return true;
      },
      ai: {
        score: (ctx) => {
          // Prefer Gyzarus when it is available and there is something to destroy.
          const f = fieldGBs(ctx);
          const canGyz = f.some((b) => b.name === BESTIARI) && ctx.extra('me', (e) => e.name === 'Gladiator Beast Gyzarus').length > 0;
          if (canGyz && ctx.field('opp').length) return 40;
          const matValue = f.map((c) => cardValue(ctx.game, c)).sort((a, b) => a - b).slice(0, 3).reduce((a, b) => a + b, 0);
          const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((c) => ctx.atk(c)));
          if (oppBest >= 2200 || matValue < 5600) return 62;
          return 0;
        },
      },
    },
    {
      kind: 'quick',
      label: 'Discard: negate Spell/Trap',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && (l.card.isSpell || l.card.isTrap) && ctx.hand().length > 0;
      },
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
      },
      resolve: async (ctx) => {
        // "This card must be face-up on the field to activate and to resolve this effect."
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          if (cats.some((c) => ['destroy', 'destroyMulti', 'banish', 'control', 'negate', 'toHand', 'toDeck', 'position', 'specialSummon', 'draw', 'search'].includes(c))) return 70;
          return 35;
        },
      },
    },
  ],
});

export const GLADIATORS_LOADED = true;
